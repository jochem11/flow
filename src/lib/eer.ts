// EER editor state: the open diagram, selection, undo/redo and edits.
// Tables are entities with attributes (columns); relations are foreign keys.
// SQL is made from this in Rust (src-tauri/src/commands/eer.rs).

import { batch, createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { Attribute, Camera, Cardinality, ColumnPair, DataType, EerDoc, Entity, Relation, SqlImport } from "./types";
import { snap, uid } from "./store";

export const [eer, setEer] = createStore<EerDoc>({ entities: [], relations: [], camera: { x: 0, y: 0, zoom: 1 } });

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

export type EerSelection = { kind: "entity" | "relation"; id: string } | null;
export const [eerSelected, setEerSelected] = createSignal<EerSelection>(null);

export const entityById = (id: string) => eer.entities.find((e) => e.id === id);
export const relationById = (id: string) => eer.relations.find((r) => r.id === id);

/** Is this column a foreign key (part of the join of one of its table's relations)? */
export const isForeignKey = (entityId: string, attrId: string) =>
  eer.relations.some((r) => r.from === entityId && (r.columns ?? []).some((c) => c.from === attrId));

// ---------- undo / redo ----------

type Snapshot = Pick<EerDoc, "entities" | "relations">;
const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const [histRev, setHistRev] = createSignal(0);
export const canUndoEer = () => (histRev(), undoStack.length > 0);
export const canRedoEer = () => (histRev(), redoStack.length > 0);

const take = (): Snapshot => JSON.parse(JSON.stringify({ entities: unwrap(eer.entities), relations: unwrap(eer.relations) }));

/** Call before a change that should be undoable. */
export function eerCheckpoint() {
  undoStack.push(take());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}

function restore(s: Snapshot) {
  batch(() => {
    setEer("entities", reconcile(s.entities, { key: "id" }));
    setEer("relations", reconcile(s.relations, { key: "id" }));
    const sel = eerSelected();
    if (sel && !(sel.kind === "entity" ? entityById(sel.id) : relationById(sel.id))) setEerSelected(null);
  });
  setHistRev((v) => v + 1);
  touch();
}

export function undoEer() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(take());
  restore(s);
}

export function redoEer() {
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
      }),
    );
    setEerSelected(null);
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
  touch();
  return e.id;
}

/** While dragging: no checkpoint. */
export function moveEntity(id: string, x: number, y: number) {
  setEer("entities", (e) => e.id === id, { x, y });
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

export function deleteEerSelection() {
  const sel = eerSelected();
  if (sel?.kind === "entity") deleteEntity(sel.id);
  else if (sel?.kind === "relation") deleteRelation(sel.id);
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
  const right = eer.entities.length ? Math.max(...eer.entities.map((e) => e.x + ENTITY_W)) + 120 : 0;
  const top = eer.entities.length ? Math.min(...eer.entities.map((e) => e.y)) : 0;
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

