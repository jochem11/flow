// EER editor state: the open diagram, selection, undo/redo and edits.
// Tables are entities with attributes (columns); relations are foreign keys.
// SQL is made from this in Rust (src-tauri/src/commands/eer.rs).

import { batch, createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { Attribute, Camera, Cardinality, ColumnPair, DataType, EerDoc, EerSection, Entity, NodeColor, Relation, SqlImport, TableIndex } from "./types";
import { GRID, snap, uid, type SharedUndo } from "./store";
import { alignRects, bounds, center, containsPt, containsRect, distributeRects, type AlignTo, type Pt, type Rect } from "./geometry";

export const [eer, setEer] = createStore<EerDoc & { sections: EerSection[] }>({
  entities: [],
  relations: [],
  sections: [],
  camera: { x: 0, y: 0, zoom: 1 },
});

/** Increments on every change; workspace.ts watches it for autosave. */
const [eerRev, setEerRev] = createSignal(0);
export { eerRev };
const touch = () => setEerRev((r) => r + 1);

export const eerSnapshot = (): EerDoc => JSON.parse(JSON.stringify(unwrap(eer)));

// ---------- layout ----------

export const ENTITY_W = 280;
export const HEADER_H = 38;
export const ROW_H = 26;
const BOTTOM_PAD = 6;

export const entityHeight = (e: Entity) => HEADER_H + Math.max(1, e.attributes.length) * ROW_H + BOTTOM_PAD;
export const entityRect = (e: Entity) => ({ x: e.x, y: e.y, w: ENTITY_W, h: entityHeight(e) });

// ---------- types ----------

export const DATA_TYPES: { type: DataType; label: string }[] = [
  { type: "int", label: "int" },
  { type: "bigint", label: "bigint" },
  { type: "smallint", label: "smallint" },
  { type: "decimal", label: "decimal" },
  { type: "float", label: "float" },
  { type: "boolean", label: "boolean" },
  { type: "varchar", label: "varchar" },
  { type: "char", label: "char" },
  { type: "text", label: "text" },
  { type: "date", label: "date" },
  { type: "time", label: "time" },
  { type: "datetime", label: "datetime" },
  { type: "timestamp", label: "timestamp (with time zone)" },
  { type: "uuid", label: "uuid" },
  { type: "json", label: "json" },
  { type: "blob", label: "blob" },
];

export const hasLength = (t: DataType) => t === "varchar" || t === "char" || t === "decimal";
export const isInteger = (t: DataType) => t === "int" || t === "bigint" || t === "smallint";

/** How a column type reads in the diagram: `varchar(120)`, `decimal(10,2)`. */
export function typeLabel(a: Attribute): string {
  if (a.dataType === "decimal") return `decimal(${a.length ?? 10},${a.scale ?? 2})`;
  if (a.dataType === "varchar" || a.dataType === "char") return `${a.dataType}(${a.length ?? 255})`;
  return a.dataType;
}

export const CARDINALITIES: { value: Cardinality; label: string; short: string }[] = [
  { value: "one", label: "Exactly one", short: "1" },
  { value: "zeroOrOne", label: "Zero or one", short: "0..1" },
  { value: "many", label: "Zero or more", short: "0..*" },
  { value: "oneOrMany", label: "One or more", short: "1..*" },
];
export const isMany = (c: Cardinality) => c === "many" || c === "oneOrMany";
export const isManyToMany = (r: Relation) => isMany(r.fromCardinality) && isMany(r.toCardinality);

// ---------- selection ----------

export const entityById = (id: string) => eer.entities.find((e) => e.id === id);
export const relationById = (id: string) => eer.relations.find((r) => r.id === id);
export const sectionById = (id: string) => eer.sections.find((s) => s.id === id);

/** What is selected: tables and sections (several at once, as in a flowchart), or one relation. */
const [selection, setSelection] = createSignal<{ ids: string[]; relation: string | null }>({ ids: [], relation: null });
export const eerSelectedIds = () => selection().ids;
export const isEerSelected = (id: string) => selection().ids.includes(id);

export function selectEer(ids: string[]) {
  setSelection({ ids, relation: null });
}

/** Shift-click: in or out of the selection. */
export function toggleEerSelected(id: string) {
  const ids = selection().ids;
  selectEer(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
}

export const selectAllEer = () => selectEer([...eer.sections.map((s) => s.id), ...eer.entities.map((e) => e.id)]);

export type EerSelection = { kind: "entity" | "section" | "relation"; id: string } | null;

/** The one thing selected, if exactly one thing is (the inspector shows it). */
export function eerSelected(): EerSelection {
  const s = selection();
  if (s.relation) return { kind: "relation", id: s.relation };
  if (s.ids.length !== 1) return null;
  return { kind: sectionById(s.ids[0]) ? "section" : "entity", id: s.ids[0] };
}

export function setEerSelected(sel: EerSelection) {
  setSelection(sel?.kind === "relation" ? { ids: [], relation: sel.id } : { ids: sel ? [sel.id] : [], relation: null });
}

/** After an undo or someone else's change: forget what is no longer there. */
function pruneSelection() {
  const s = selection();
  const ids = s.ids.filter((id) => entityById(id) || sectionById(id));
  const relation = s.relation && relationById(s.relation) ? s.relation : null;
  if (ids.length !== s.ids.length || relation !== s.relation) setSelection({ ids, relation });
  if (editingSection() && !sectionById(editingSection()!)) setEditingSection(null);
}

/** The section whose title is being typed */
export const [editingSection, setEditingSection] = createSignal<string | null>(null);

/** Is this column a foreign key (part of the join of one of its table's relations)? */
export const isForeignKey = (entityId: string, attrId: string) =>
  eer.relations.some((r) => r.from === entityId && (r.columns ?? []).some((c) => c.from === attrId));

// ---------- undo / redo ----------

type Snapshot = Pick<EerDoc, "entities" | "relations"> & { sections: EerSection[] };
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const [histRev, setHistRev] = createSignal(0);
/** Editing together: undo through the shared document (see SharedUndo in store/history.ts) */
let shared: SharedUndo | null = null;
export function useSharedEerUndo(u: SharedUndo | null) {
  shared = u;
  setHistRev((v) => v + 1);
}
export const eerHistoryChanged = () => setHistRev((v) => v + 1);
export const canUndoEer = () => (histRev(), shared ? shared.canUndo() : undoStack.length > 0);
export const canRedoEer = () => (histRev(), shared ? shared.canRedo() : redoStack.length > 0);

const take = (): Snapshot =>
  JSON.parse(JSON.stringify({ entities: unwrap(eer.entities), relations: unwrap(eer.relations), sections: unwrap(eer.sections) }));

/** Call before a change that should be undoable. */
export function eerCheckpoint() {
  if (shared) return shared.stopCapturing();
  undoStack.push(take());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}

function restore(s: Snapshot) {
  batch(() => {
    setEer("entities", reconcile(s.entities, { key: "id" }));
    setEer("relations", reconcile(s.relations, { key: "id" }));
    setEer("sections", reconcile(s.sections ?? [], { key: "id" }));
    pruneSelection();
  });
  setHistRev((v) => v + 1);
  touch();
}

export function undoEer() {
  if (shared) return shared.undo();
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(take());
  restore(s);
}

export function redoEer() {
  if (shared) return shared.redo();
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(take());
  restore(s);
}

/** Replaces the whole diagram (when opening a document). Does not count as a change. */
export function replaceEer(doc: EerDoc) {
  batch(() => {
    // Older files may lack the newer fields: fill them in, so the rest can rely on them
    setEer(
      reconcile({
        camera: doc.camera ?? { x: 0, y: 0, zoom: 1 },
        entities: doc.entities ?? [],
        relations: (doc.relations ?? []).map((r) => ({
          ...r,
          columns: r.columns ?? [],
          onDelete: r.onDelete ?? "noAction",
          onUpdate: r.onUpdate ?? "noAction",
        })),
        sections: doc.sections ?? [],
      }),
    );
    setEerSelected(null);
    setEditingSection(null);
  });
  undoStack.length = 0;
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}

export function setEerCamera(c: Partial<Camera>) {
  setEer("camera", c);
  touch();
}

// ---------- tables ----------

/** A name that is not used yet: `base`, `base_2`, `base_3`, ... */
function freeName(base: string, used: string[]): string {
  if (!used.includes(base)) return base;
  let i = 2;
  while (used.includes(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

const column = (name: string, dataType: DataType, extra?: Partial<Attribute>): Attribute => ({
  id: uid(),
  name,
  dataType,
  primaryKey: false,
  nullable: true,
  unique: false,
  autoIncrement: false,
  ...extra,
});

/** A new table with an `id` primary key, its top-left corner at (x, y). */
export function addEntity(x: number, y: number): string {
  eerCheckpoint();
  const e: Entity = {
    id: uid(),
    name: freeName("table", eer.entities.map((t) => t.name)),
    x: snap(x),
    y: snap(y),
    attributes: [column("id", "int", { primaryKey: true, nullable: false, autoIncrement: true })],
  };
  setEer("entities", (es) => [...es, e]);
  setEerSelected({ kind: "entity", id: e.id });
  // Added in a section: the section makes room for it
  growEerSections([e.id]);
  touch();
  return e.id;
}

/** While dragging: puts tables and sections at these positions (no checkpoint). */
export function moveEerItems(pos: Map<string, Pt>) {
  batch(() => {
    setEer("entities", (e) => pos.has(e.id), produce((e) => Object.assign(e, pos.get(e.id))));
    setEer("sections", (s) => pos.has(s.id), produce((s) => Object.assign(s, pos.get(s.id))));
  });
  touch();
}

/** The arrow keys: the selection (and what is in its sections) a bit further. */
export function nudgeEerSelection(dx: number, dy: number) {
  const moving = eerWithContents(selection().ids);
  if (!moving.size) return;
  const was = sectionsAround(selection().ids, moving);
  eerCheckpoint();
  const pos = new Map<string, Pt>();
  for (const x of [...eer.entities, ...eer.sections]) if (moving.has(x.id)) pos.set(x.id, { x: x.x + dx, y: x.y + dy });
  moveEerItems(pos);
  growEerSections(selection().ids, was);
}

export function setEerSelectionColor(color: NodeColor) {
  const ids = new Set(selection().ids);
  if (!ids.size) return;
  eerCheckpoint();
  batch(() => {
    setEer("entities", (e) => ids.has(e.id), "color", color);
    setEer("sections", (s) => ids.has(s.id), "color", color);
  });
  touch();
}

export function updateEntity(id: string, changes: Partial<Pick<Entity, "name" | "color" | "comment">>) {
  eerCheckpoint();
  setEer("entities", (e) => e.id === id, changes);
  touch();
}

export function deleteEntity(id: string) {
  eerCheckpoint();
  batch(() => {
    setEer("entities", (es) => es.filter((e) => e.id !== id));
    setEer("relations", (rs) => rs.filter((r) => r.from !== id && r.to !== id));
    setEerSelected(null);
  });
  touch();
}

// ---------- columns ----------

export function addAttribute(entityId: string): string {
  const e = entityById(entityId);
  eerCheckpoint();
  const a = column(freeName("column", e?.attributes.map((x) => x.name) ?? []), "varchar");
  setEer("entities", (x) => x.id === entityId, "attributes", (as) => [...as, a]);
  // The table is taller now: its section too, if it no longer fits
  growEerSections([entityId]);
  touch();
  return a.id;
}

export function updateAttribute(entityId: string, attrId: string, changes: Partial<Omit<Attribute, "id">>) {
  eerCheckpoint();
  setEer(
    "entities",
    (e) => e.id === entityId,
    "attributes",
    (a) => a.id === attrId,
    produce((a) => {
      Object.assign(a, changes);
      // A primary key is never null; auto increment only for whole numbers
      if (a.primaryKey) a.nullable = false;
      if (!isInteger(a.dataType)) a.autoIncrement = false;
      if (!hasLength(a.dataType)) delete a.length;
      if (a.dataType !== "decimal") delete a.scale;
    }),
  );
  touch();
}

export function removeAttribute(entityId: string, attrId: string) {
  eerCheckpoint();
  batch(() => {
    setEer("entities", (e) => e.id === entityId, "attributes", (as) => as.filter((a) => a.id !== attrId));
    // Indexes without it (and without those left with no column)
    setEer("entities", (e) => e.id === entityId, "indexes", (ix) =>
      (ix ?? []).map((i) => ({ ...i, columns: i.columns.filter((c) => c !== attrId) })).filter((i) => i.columns.length),
    );
    // Joins on this column are gone too
    setEer("relations", (r) => r.from === entityId || r.to === entityId, "columns", (cs) =>
      (cs ?? []).filter((c) => c.from !== attrId && c.to !== attrId),
    );
  });
  touch();
}

export function moveAttribute(entityId: string, attrId: string, by: -1 | 1) {
  const e = entityById(entityId);
  const i = e?.attributes.findIndex((a) => a.id === attrId) ?? -1;
  if (!e || i < 0 || i + by < 0 || i + by >= e.attributes.length) return;
  eerCheckpoint();
  setEer(
    "entities",
    (x) => x.id === entityId,
    "attributes",
    produce((as) => {
      const [a] = as.splice(i, 1);
      as.splice(i + by, 0, a);
    }),
  );
  touch();
}

// ---------- indexes ----------

/** A new index on the table, on its first column that is not the primary key. */
export function addIndex(entityId: string) {
  const e = entityById(entityId);
  const col = e?.attributes.find((a) => !a.primaryKey) ?? e?.attributes[0];
  if (!e || !col) return;
  eerCheckpoint();
  setEer("entities", (x) => x.id === entityId, "indexes", (ix) => [...(ix ?? []), { id: uid(), name: "", columns: [col.id], unique: false }]);
  touch();
}

export function updateIndex(entityId: string, indexId: string, changes: Partial<Omit<TableIndex, "id">>) {
  eerCheckpoint();
  setEer("entities", (x) => x.id === entityId, "indexes", (i) => i.id === indexId, changes);
  touch();
}

/** A column in or out of an index (an index keeps at least one) */
export function toggleIndexColumn(entityId: string, indexId: string, attrId: string) {
  const ix = entityById(entityId)?.indexes?.find((i) => i.id === indexId);
  if (!ix) return;
  const columns = ix.columns.includes(attrId) ? ix.columns.filter((c) => c !== attrId) : [...ix.columns, attrId];
  if (columns.length) updateIndex(entityId, indexId, { columns });
}

export function removeIndex(entityId: string, indexId: string) {
  eerCheckpoint();
  setEer("entities", (x) => x.id === entityId, "indexes", (ix) => (ix ?? []).filter((i) => i.id !== indexId));
  touch();
}

// ---------- relations ----------

/** The middle of a column's row, in world coordinates (null if the column is gone). */
export function rowY(e: Entity, attrId: string): number | null {
  const i = e.attributes.findIndex((a) => a.id === attrId);
  return i < 0 ? null : e.y + HEADER_H + i * ROW_H + ROW_H / 2;
}

/** Can other tables refer to this column? Primary keys and unique columns. */
export const isKey = (a: Attribute) => a.primaryKey || !!a.unique;

/**
 * A relation made by dragging a column's row onto another table (or onto one of its rows):
 * - from a key (primary key or unique): the other table refers to it. Dropped on a row,
 *   that row becomes the foreign key; dropped on the table, foreign key columns are
 *   added there, one per part of the primary key, named `<table>_<column>`.
 * - from any other column: that column refers to the row it was dropped on, or to
 *   the primary key of the table it was dropped on.
 * Returns the new relation, or null when there is nothing to join.
 */
export function connectRows(srcId: string, attrId: string, targetId: string, targetAttrId: string | null): string | null {
  const src = entityById(srcId);
  const target = entityById(targetId);
  const attr = src?.attributes.find((a) => a.id === attrId);
  if (!src || !target || !attr || (srcId === targetId && attrId === targetAttrId)) return null;

  let from: Entity;
  let to: Entity;
  let columns: ColumnPair[];
  const fkColumns: Attribute[] = [];
  if (isKey(attr)) {
    // The target table refers to this key
    from = target;
    to = src;
    const keys = attr.primaryKey ? src.attributes.filter((a) => a.primaryKey) : [attr];
    if (targetAttrId && keys.length === 1) {
      columns = [{ from: targetAttrId, to: attr.id }];
    } else {
      const used = target.attributes.map((a) => a.name);
      columns = keys.map((k) => {
        const name = freeName(`${src.name.toLowerCase()}_${k.name}`, [...used, ...fkColumns.map((c) => c.name)]);
        const fk = column(name, k.dataType, { length: k.length, scale: k.scale, nullable: false });
        fkColumns.push(fk);
        return { from: fk.id, to: k.id };
      });
    }
  } else {
    // This column refers to the target
    const ref = targetAttrId ?? target.attributes.find((a) => a.primaryKey)?.id;
    if (!ref) return null;
    from = src;
    to = target;
    columns = [{ from: attr.id, to: ref }];
  }

  eerCheckpoint();
  const r: Relation = {
    id: uid(),
    from: from.id,
    to: to.id,
    fromCardinality: "many",
    toCardinality: "one",
    columns,
    onDelete: "noAction",
    onUpdate: "noAction",
  };
  batch(() => {
    if (fkColumns.length) setEer("entities", (e) => e.id === from.id, "attributes", (as) => [...as, ...fkColumns]);
    setEer("relations", (rs) => [...rs, r]);
    setEerSelected({ kind: "relation", id: r.id });
    if (fkColumns.length) growEerSections([from.id]);
  });
  touch();
  return r.id;
}

export function updateRelation(id: string, changes: Partial<Omit<Relation, "id">>) {
  const r = relationById(id);
  if (!r) return;
  eerCheckpoint();
  batch(() => {
    setEer("relations", (x) => x.id === id, changes);
    // The foreign key may be empty exactly when the referenced side is optional
    if (changes.toCardinality && !isMany(changes.toCardinality)) {
      const nullable = changes.toCardinality === "zeroOrOne";
      const fkIds = new Set((r.columns ?? []).map((c) => c.from));
      setEer("entities", (e) => e.id === r.from, "attributes", (a) => fkIds.has(a.id), "nullable", nullable);
    }
  });
  touch();
}

/** Deletes a relation, and the foreign key columns that only it used. */
export function deleteRelation(id: string) {
  const r = relationById(id);
  if (!r) return;
  eerCheckpoint();
  const usedElsewhere = new Set(
    eer.relations.filter((x) => x.id !== id).flatMap((x) => (x.columns ?? []).map((c) => c.from)),
  );
  const drop = new Set((r.columns ?? []).map((c) => c.from).filter((c) => !usedElsewhere.has(c)));
  batch(() => {
    setEer("relations", (rs) => rs.filter((x) => x.id !== id));
    setEer("entities", (e) => e.id === r.from, "attributes", (as) => as.filter((a) => !drop.has(a.id)));
    setEerSelected(null);
  });
  touch();
}

/** Deletes the selected tables (with their relations) and sections; what was in a section stays. */
export function deleteEerSelection() {
  const s = selection();
  if (s.relation) return deleteRelation(s.relation);
  if (!s.ids.length) return;
  const ids = new Set(s.ids);
  eerCheckpoint();
  batch(() => {
    setEer("entities", (es) => es.filter((e) => !ids.has(e.id)));
    setEer("relations", (rs) => rs.filter((r) => !ids.has(r.from) && !ids.has(r.to)));
    setEer("sections", (ss) => ss.filter((x) => !ids.has(x.id)));
    selectEer([]);
  });
  touch();
}

// ---------- align and distribute ----------

/** The selected tables and sections, without those inside a selected section (they go along with it) */
function outerSelected(): (Rect & { id: string })[] {
  const ids = selection().ids;
  const inside = new Set<string>();
  for (const id of ids) if (sectionById(id)) for (const d of eerWithContents([id])) if (d !== id) inside.add(d);
  const keep = (id: string) => ids.includes(id) && !inside.has(id);
  return [
    ...eer.entities.filter((e) => keep(e.id)).map((e) => ({ id: e.id, ...entityRect(e) })),
    ...eer.sections.filter((s) => keep(s.id)).map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
  ];
}

/** Puts these tables and sections where given, with what is in the sections. One undo step. */
function placeWithContents(pos: Map<string, Pt>) {
  const all = new Map<string, Pt>();
  const items = new Map([...eer.entities, ...eer.sections].map((x) => [x.id, x]));
  for (const [id, p] of pos) {
    const it = items.get(id);
    if (!it || (p.x === it.x && p.y === it.y)) continue;
    for (const c of eerWithContents([id])) {
      const m = items.get(c);
      if (m) all.set(c, { x: m.x + p.x - it.x, y: m.y + p.y - it.y });
    }
  }
  if (!all.size) return;
  const was = sectionsAround(pos.keys(), new Set(all.keys()));
  eerCheckpoint();
  batch(() => {
    moveEerItems(all);
    growEerSections(pos.keys(), was);
  });
}

export function alignEerSelection(to: AlignTo) {
  const items = outerSelected();
  if (items.length > 1) placeWithContents(alignRects(items, to));
}

export function distributeEerSelection(axis: "x" | "y") {
  placeWithContents(distributeRects(outerSelected(), axis));
}

// ---------- copy and paste ----------

export interface EerClip {
  kind: "eer";
  entities: Entity[];
  relations: Relation[];
  sections: EerSection[];
}

/** The selection (with what is in its sections) and the relations between its tables. */
export function copyEerSelection(): EerClip | null {
  const ids = eerWithContents(selection().ids);
  if (!ids.size) return null;
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  return {
    kind: "eer",
    entities: clone(eer.entities.filter((e) => ids.has(e.id))),
    relations: clone(eer.relations.filter((r) => ids.has(r.from) && ids.has(r.to))),
    sections: clone(eer.sections.filter((s) => ids.has(s.id))),
  };
}

/**
 * Pastes copied tables, relations and sections around `at`, with new ids and, for
 * tables whose name is taken, a new name (`orders_2`). One undo step.
 */
export function pasteEer(clip: EerClip, at: Pt) {
  const box = bounds([...clip.entities.map(entityRect), ...clip.sections]);
  if (!box) return;
  const dx = snap(at.x - box.x - box.w / 2);
  const dy = snap(at.y - box.y - box.h / 2);
  const ids = new Map<string, string>();
  const used = eer.entities.map((e) => e.name);
  const entities: Entity[] = clip.entities.map((e) => {
    const name = freeName(e.name, used);
    used.push(name);
    ids.set(e.id, uid());
    const attributes = e.attributes.map((a) => {
      ids.set(a.id, uid());
      return { ...a, id: ids.get(a.id)! };
    });
    return { ...e, id: ids.get(e.id)!, name, x: e.x + dx, y: e.y + dy, attributes };
  });
  const relations: Relation[] = clip.relations.map((r) => ({
    ...r,
    id: uid(),
    from: ids.get(r.from)!,
    to: ids.get(r.to)!,
    columns: (r.columns ?? []).map((c) => ({ from: ids.get(c.from) ?? c.from, to: ids.get(c.to) ?? c.to })),
  }));
  const sections: EerSection[] = clip.sections.map((s) => ({ ...s, id: uid(), x: s.x + dx, y: s.y + dy }));
  const added = [...sections.map((s) => s.id), ...entities.map((e) => e.id)];
  eerCheckpoint();
  batch(() => {
    setEer("sections", (ss) => [...ss, ...sections]);
    setEer("entities", (es) => [...es, ...entities]);
    setEer("relations", (rs) => [...rs, ...relations]);
    // Pasted in a section: it makes room
    growEerSections(added);
    selectEer(added);
  });
  touch();
}

/** Where the pointer last was over the diagram (world coordinates), and the diagram's viewport */
let pointer: Pt | null = null;
let viewport: HTMLElement | null = null;
export const setEerPointer = (p: Pt | null) => (pointer = p);
export const setEerViewport = (el: HTMLElement | null) => (viewport = el);
export const eerViewportRect = () => viewport?.getBoundingClientRect() ?? null;

/** Where pasted things go: under the pointer, else the middle of the view. */
export function eerPastePoint(): Pt {
  if (pointer) return pointer;
  const r = viewport?.getBoundingClientRect();
  const c = eer.camera;
  return r ? { x: (r.width / 2 - c.x) / c.zoom, y: (r.height / 2 - c.y) / c.zoom } : { x: 0, y: 0 };
}

// ---------- sections ----------

export const SECTION_MIN = { w: 160, h: 100 };
/** Room around what a new section is wrapped around, and above it for the title */
const SECTION_PAD = 30;
const SECTION_TITLE = 50;
/** The strip at the top of a section where a double-click renames it */
export const SECTION_HEADER = 48;

/**
 * The given tables and sections, plus what lies in those sections: tables whose
 * center is inside, and smaller sections that fit in completely (with what they hold).
 */
export function eerWithContents(ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (const f of eer.sections.filter((s) => out.has(s.id))) {
    for (const e of eer.entities) if (containsPt(f, center(entityRect(e)))) out.add(e.id);
    for (const s of eer.sections) if (s.id !== f.id && containsRect(f, s) && s.w * s.h < f.w * f.h) out.add(s.id);
  }
  return out;
}

function newSection(x: number, y: number, w: number, h: number) {
  const s: EerSection = { id: uid(), title: "", x: snap(x), y: snap(y), w: snap(w), h: snap(h) };
  eerCheckpoint();
  // Typing its title belongs to this same undo step
  liveTitleOf = s.id;
  batch(() => {
    setEer("sections", (ss) => [...ss, s]);
    selectEer([s.id]);
    setEditingSection(s.id);
  });
  touch();
  return s.id;
}

/** An empty section around (x, y), its title being typed. */
export function addSection(x: number, y: number) {
  newSection(x - 240, y - 160, 480, 320);
}

/** A new section around the selection (Ctrl+G), its title being typed. */
export function wrapEerSelection() {
  const all = eerWithContents(selection().ids);
  const box = bounds([...eer.entities.filter((e) => all.has(e.id)).map(entityRect), ...eer.sections.filter((s) => all.has(s.id))]);
  if (!box) return;
  // The section all of it was in: the new one goes in there, which grows if it has to
  const host = smallestSection((f) => !all.has(f.id) && containsRect(f, box));
  const x = snap(box.x - SECTION_PAD);
  const y = snap(box.y - SECTION_TITLE);
  const id = newSection(x, y, snap(box.x + box.w + SECTION_PAD) - x, snap(box.y + box.h + SECTION_PAD) - y);
  if (host) growEerSections([id], new Map([[id, host.id]]));
}

const area = (r: Rect) => r.w * r.h;

function smallestSection(test: (f: EerSection) => boolean): EerSection | undefined {
  let best: EerSection | undefined;
  for (const f of eer.sections) if (test(f) && (!best || area(f) < area(best))) best = f;
  return best;
}

/**
 * The section a table or section is in: for a table the smallest one around its
 * center, for a section the smallest one it fits in completely. Not one of `exclude`.
 */
export function eerSectionOf(id: string, exclude?: Set<string>): EerSection | undefined {
  const s = sectionById(id);
  const t = entityById(id);
  const r = s ?? (t && entityRect(t));
  if (!r) return undefined;
  return smallestSection(
    (f) => f.id !== id && !exclude?.has(f.id) && (s ? containsRect(f, s) && area(f) > area(s) : containsPt(f, center(r))),
  );
}

/** Before a move or resize: the section each of these sections is in (not one that moves along). */
export function sectionsAround(ids: Iterable<string>, moving: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of ids) {
    const f = sectionById(id) && eerSectionOf(id, moving);
    if (f) out.set(id, f.id);
  }
  return out;
}

/**
 * Grows the sections these tables and sections are in (and the sections around
 * those) so they fit with room to spare, in whichever direction they stick out.
 * It never shrinks a section: one made smaller by hand stays so until something in
 * it is moved, added or grows again. A section dragged partly out of the one it was
 * in (`was`, from `sectionsAround`) stays in that while its center is. No checkpoint:
 * part of the move or add.
 */
export function growEerSections(ids: Iterable<string>, was: Map<string, string> = new Map()) {
  const down = (v: number) => Math.floor(v / GRID) * GRID;
  const up = (v: number) => Math.ceil(v / GRID) * GRID;
  batch(() => {
    for (const id of ids) {
      const s = sectionById(id);
      const t = entityById(id);
      let first = eerSectionOf(id);
      const before = was.get(id) ? sectionById(was.get(id)!) : undefined;
      if (s && before && containsPt(before, center(s)) && (!first || area(first) >= area(before))) first = before;
      if (!first) continue;
      // Which sections are around which, before any of them grows
      const chain = [first];
      for (let f = eerSectionOf(first.id); f && !chain.includes(f); f = eerSectionOf(f.id)) chain.push(f);
      let inner: Rect = s ?? entityRect(t!);
      for (const f of chain) {
        const x0 = Math.min(f.x, down(inner.x - SECTION_PAD));
        const y0 = Math.min(f.y, down(inner.y - SECTION_TITLE));
        const x1 = Math.max(f.x + f.w, up(inner.x + inner.w + SECTION_PAD));
        const y1 = Math.max(f.y + f.h, up(inner.y + inner.h + SECTION_PAD));
        // Fits already: so does it in the sections around this one
        if (x0 === f.x && y0 === f.y && x1 === f.x + f.w && y1 === f.y + f.h) break;
        setEer("sections", (x) => x.id === f.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        inner = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
    }
  });
  touch();
}

/**
 * While dragging: the sections as they are now (not those in `moving`). Put back with
 * `restoreEerSections` before every step, so a section that grew while a table was
 * dragged to its edge shrinks again when the table is dragged on, out of it.
 */
export function sectionSizes(moving: Set<string>): Map<string, Rect> {
  return new Map(eer.sections.filter((s) => !moving.has(s.id)).map((s) => [s.id, { x: s.x, y: s.y, w: s.w, h: s.h }]));
}

export function restoreEerSections(sizes: Map<string, Rect>) {
  batch(() => {
    for (const s of eer.sections) {
      const b = sizes.get(s.id);
      if (b && (b.x !== s.x || b.y !== s.y || b.w !== s.w || b.h !== s.h)) setEer("sections", (x) => x.id === s.id, b);
    }
  });
}

/** While dragging a side or corner: no checkpoint. */
export function setSectionRect(id: string, r: Rect) {
  setEer("sections", (s) => s.id === id, { x: r.x, y: r.y, w: r.w, h: r.h });
  touch();
}

/** The section whose title is being typed live (its undo checkpoint is taken) */
let liveTitleOf: string | null = null;

/** Typing a section's title: on the board with every key, for others editing together. One undo step per edit. */
export function setSectionTitleLive(id: string, title: string) {
  const s = sectionById(id);
  if (!s || s.title === title) return;
  if (liveTitleOf !== id) {
    eerCheckpoint();
    liveTitleOf = id;
  }
  setEer("sections", (x) => x.id === id, "title", title);
  touch();
}

/** Finishes editing a section's title. */
export function setSectionTitle(id: string, title: string) {
  const live = liveTitleOf === id;
  liveTitleOf = null;
  const s = sectionById(id);
  if (!s || s.title === title) return;
  if (!live) eerCheckpoint();
  setEer("sections", (x) => x.id === id, "title", title);
  touch();
}

// ---------- import ----------

/**
 * Adds tables read from SQL (`api.importSql`) to the right of the diagram, as one
 * undo step. A table whose name is already in the diagram is not added again:
 * relations to it go to the table that is there, matching columns by name.
 * Returns the tables added and the names of those already there.
 */
export function insertImport(imp: SqlImport): { added: Entity[]; existing: string[] } {
  const byName = new Map(eer.entities.map((e) => [e.name.toLowerCase(), e]));
  const existing = imp.entities.filter((e) => byName.has(e.name.toLowerCase()));
  const fresh = imp.entities.filter((e) => !byName.has(e.name.toLowerCase()));
  const result = { added: [] as Entity[], existing: existing.map((e) => e.name) };
  if (!fresh.length) return result;

  // Ids in the import → ids in the diagram, for the tables (and their columns) already there
  const ids = new Map<string, string>();
  const oldColumns = new Set<string>();
  for (const e of existing) {
    const there = byName.get(e.name.toLowerCase())!;
    ids.set(e.id, there.id);
    for (const a of e.attributes) {
      oldColumns.add(a.id);
      const col = there.attributes.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
      if (col) ids.set(a.id, col.id);
    }
  }
  const known = (id: string) => !oldColumns.has(id) || ids.has(id);
  const to = (id: string) => ids.get(id) ?? id;
  const oldTables = new Set(existing.map((e) => e.id));
  const relations: Relation[] = [];
  for (const r of imp.relations) {
    // Between two tables that were already there: the diagram has its own lines for that
    if (oldTables.has(r.from) && oldTables.has(r.to)) continue;
    const pairs = r.columns ?? [];
    const columns = pairs.filter((c) => known(c.from) && known(c.to)).map((c) => ({ from: to(c.from), to: to(c.to) }));
    // A foreign key whose columns are not in the table that is there
    if (pairs.length && !columns.length) continue;
    relations.push({ ...r, from: to(r.from), to: to(r.to), columns });
  }

  // To the right of what is there, level with its top
  const right = eer.entities.length ? Math.max(...eer.entities.map((e) => e.x + ENTITY_W), ...eer.sections.map((s) => s.x + s.w)) + 120 : 0;
  const top = eer.entities.length ? Math.min(...eer.entities.map((e) => e.y)) : 0;
  // With groups (DBML's table groups, as sections): everything moved as laid out, so the groups stay around their tables
  const imported = imp.sections ?? [];
  if (imported.length) {
    const dx = snap(right - Math.min(...imp.entities.map((e) => e.x), ...imported.map((s) => s.x)));
    const dy = snap(top - Math.min(...imp.entities.map((e) => e.y), ...imported.map((s) => s.y)));
    const added = fresh.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
    const sections = imported.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    eerCheckpoint();
    batch(() => {
      setEer("entities", (es) => [...es, ...added]);
      setEer("relations", (rs) => [...rs, ...relations]);
      setEer("sections", (ss) => [...ss, ...sections]);
      setEerSelected(null);
    });
    touch();
    return { ...result, added };
  }
  // The import's columns of tables, without the gaps of the tables that are not added
  const xs = [...new Set(fresh.map((e) => e.x))].sort((a, b) => a - b);
  const bottom = new Map<number, number>();
  // (within a column the import stacks them in order, top to bottom)
  const added = fresh.map((e) => {
    const y = bottom.get(e.x) ?? 0;
    bottom.set(e.x, y + entityHeight(e) + 40);
    return { ...e, x: snap(right + xs.indexOf(e.x) * (ENTITY_W + 100)), y: snap(top + y) };
  });

  eerCheckpoint();
  batch(() => {
    setEer("entities", (es) => [...es, ...added]);
    setEer("relations", (rs) => [...rs, ...relations]);
    setEerSelected(null);
  });
  touch();
  return { ...result, added };
}

/** An older state of the diagram (version history), as one change that can be undone and that everyone gets. */
export function restoreEer(doc: EerDoc) {
  eerCheckpoint();
  batch(() => {
    setEer("entities", reconcile(doc.entities ?? [], { key: "id" }));
    setEer("relations", reconcile(doc.relations ?? [], { key: "id" }));
    setEer("sections", reconcile(doc.sections ?? [], { key: "id" }));
    pruneSelection();
  });
  touch();
}

/** Changes from someone else (editing together): the tables and relations as they are now. */
export function applyRemoteEer(entities: Entity[], relations: Relation[], sections: EerSection[]) {
  batch(() => {
    setEer("entities", reconcile(entities, { key: "id" }));
    setEer("relations", reconcile(relations, { key: "id" }));
    setEer("sections", reconcile(sections, { key: "id" }));
    pruneSelection();
  });
}
