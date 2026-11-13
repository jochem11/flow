// The EER editor: tables (entities) on a canvas with crow's-foot relations between
// them, and an inspector on the right to edit columns and joins.
//
// Drag a table by its header; drag the dot beside a column's row onto another
// table (or one of its rows) to join them: the foreign key columns are added for
// you (see `connectRows`). Double-click the canvas to add a table.
//
// Selecting works as in a flowchart: drag a rectangle on the canvas, Shift-click,
// Ctrl+A; Ctrl+G wraps the selection in a section, which moves what lies in it.

import { colorClass, tintVars } from "../lib/colors";
import { ColorPicker } from "./ColorPicker";
import { EerPresence, trackPointer as trackPresence } from "./Presence";
import { EerCommentPins, PlacingOverlay } from "./Comments";
import { canEdit } from "../lib/access";
import { batch, createMemo, createSignal, For, on, onCleanup, onMount, Show, createEffect } from "solid-js";
import {
  addAttribute,
  addEntity,
  addIndex,
  removeIndex,
  toggleIndexColumn,
  updateIndex,
  addSection,
  editingSection,
  eerSelectedIds,
  eerWithContents,
  growEerSections,
  isEerSelected,
  restoreEerSections,
  sectionsAround,
  sectionSizes,
  setEerPointer,
  setEerViewport,
  moveEerItems,
  setSectionRect,
  SECTION_MIN,
  SECTION_HEADER,
  sectionById,
  selectEer,
  setEditingSection,
  setEerSelectionColor,
  setEntityColor,
  setSectionTitle,
  setSectionTitleLive,
  toggleEerSelected,
  wrapEerSelection,
  deleteEerSelection,
  alignEerSelection,
  distributeEerSelection,
  CARDINALITIES,
  connectRows,
  DATA_TYPES,
  deleteEntity,
  deleteRelation,
  eer,
  eerCheckpoint,
  eerSelected,
  entityById,
  entityHeight,
  entityRect,
  ENTITY_W,
  hasLength,
  HEADER_H,
  isForeignKey,
  isInteger,
  isKey,
  isManyToMany,
  moveAttribute,
  removeAttribute,
  ROW_H,
  rowY,
  setEerCamera,
  setEerSelected,
  typeLabel,
  updateAttribute,
  updateEntity,
  updateRelation,
} from "../lib/eer";
import {
  bounds,
  containsRect,
  crossings,
  edgeBetween,
  elbow,
  intersects,
  lineEnd,
  normRect,
  ownBlock,
  RESIZE_DIRS,
  resizeRect,
  type ResizeDir,
  routeLength,
  type EdgeGeom,
  type Pt,
} from "../lib/geometry";
import type { AutoPan } from "../lib/edgePan";
import { trackPointer } from "../lib/interactions";
import { snap, ui } from "../lib/store";
import type { Attribute, Cardinality, EerSection, Entity, RefAction, Relation } from "../lib/types";
import { IconClose, IconPlus, IconRename, IconSection, IconTrash } from "./icons";
import { cardsLinkedTo } from "../lib/links";
import { LinkedCardsBadge, renameOnClick, TextEditor } from "./NodeView";
import { FloatingBar, grow } from "./FloatingBar";
import { SnapGuides } from "./Edges";
import { checkSchema, type Problem } from "../lib/eerChecks";
import { AlignMenu } from "./AlignMenu";
import { guidesFor, nearestLine, snapBox, snapLines, SNAP_REACH, type Guide } from "../lib/snapping";
import { CardLinksMenu } from "./CardLinksMenu";
import { versionMark } from "../lib/workspace";


const ACTIONS: { value: RefAction; label: string }[] = [
  { value: "noAction", label: "No action" },
  { value: "restrict", label: "Restrict" },
  { value: "cascade", label: "Cascade" },
  { value: "setNull", label: "Set null" },
  { value: "setDefault", label: "Set default" },
];

export function EerEditor() {
  let el!: HTMLDivElement;
  /** A row being dragged onto another table: where it starts, the pointer, and what is under it */
  const [connecting, setConnecting] = createSignal<{
    from: string;
    attr: string;
    at: Pt;
    target: { entity: string; attr: string | null } | null;
  } | null>(null);
  /** The selection rectangle being dragged (world coordinates) */
  const [marquee, setMarquee] = createSignal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [dragging, setDragging] = createSignal(false);
  const [panning, setPanning] = createSignal(false);
  /** While moving or resizing: what lines up (see snapping.ts) */
  const [guides, setGuides] = createSignal<Guide[]>([]);
  /** Tables and sections, as rectangles */
  const itemRects = (keep: (id: string) => boolean) => [
    ...eer.entities.filter((e) => keep(e.id)).map(entityRect),
    ...eer.sections.filter((s) => keep(s.id)).map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
  ];

  const cam = () => eer.camera;
  const toWorld = (cx: number, cy: number): Pt => {
    const r = el.getBoundingClientRect();
    return { x: (cx - r.left - cam().x) / cam().zoom, y: (cy - r.top - cam().y) / cam().zoom };
  };
  const zoomAt = (cx: number, cy: number, factor: number) => {
    const r = el.getBoundingClientRect();
    const zoom = Math.min(3, Math.max(0.2, cam().zoom * factor));
    const k = zoom / cam().zoom;
    const sx = cx - r.left;
    const sy = cy - r.top;
    setEerCamera({ zoom, x: sx - (sx - cam().x) * k, y: sy - (sy - cam().y) * k });
  };

  onMount(() => {
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, Math.exp(-Math.max(-25, Math.min(25, e.deltaY)) * 0.01));
      else setEerCamera({ x: cam().x - e.deltaX, y: cam().y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    trackPresence(el, toWorld);
    setEerViewport(el);
    onCleanup(() => {
      el.removeEventListener("wheel", onWheel);
      setEerViewport(null);
      setEerPointer(null);
    });
    // A new diagram: start with the origin a bit in from the corner
    if (!eer.entities.length && cam().x === 0 && cam().y === 0) setEerCamera({ x: 80, y: 80 });
  });

  /** For the gestures that reach across the board: it moves along at its edge */
  const follow = (): AutoPan => ({
    rect: () => el.getBoundingClientRect(),
    pan: (dx, dy) => setEerCamera({ x: cam().x + dx, y: cam().y + dy }),
  });

  const beginPan = (e: PointerEvent) => {
    let last = { x: e.clientX, y: e.clientY };
    setPanning(true);
    trackPointer(
      e,
      (ev) => {
        setEerCamera({ x: cam().x + ev.clientX - last.x, y: cam().y + ev.clientY - last.y });
        last = { x: ev.clientX, y: ev.clientY };
      },
      () => setPanning(false),
    );
  };

  /**
   * Empty canvas: a selection rectangle (Shift adds to the selection). The middle
   * button, or Space held, pans; so does any drag when viewing only.
   */
  const onCanvasDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (e.button === 1 || ui.spaceDown || !canEdit()) {
      e.preventDefault();
      if (!canEdit() && e.button === 0) setEerSelected(null);
      beginPan(e);
      return;
    }
    const additive = e.shiftKey;
    const base = additive ? eerSelectedIds() : [];
    if (!additive) setEerSelected(null);
    const w0 = toWorld(e.clientX, e.clientY);
    let started = false;
    trackPointer(
      e,
      (ev) => {
        if (!started && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
        started = true;
        const w = toWorld(ev.clientX, ev.clientY);
        setMarquee({ x0: w0.x, y0: w0.y, x1: w.x, y1: w.y });
        const r = normRect(w0.x, w0.y, w.x, w.y);
        // A section only when it is completely inside, otherwise every selection inside one would take it too
        const hits = [
          ...eer.sections.filter((s) => containsRect(r, s)).map((s) => s.id),
          ...eer.entities.filter((t) => intersects(entityRect(t), r)).map((t) => t.id),
        ];
        selectEer([...new Set([...base, ...hits])]);
      },
      () => setMarquee(null),
      follow(),
    );
  };

  /**
   * A table (by its header) or a section (by its title): Shift-click adds it to the
   * selection or takes it out; dragging moves the whole selection, and what lies in
   * the sections in it. Snaps to the grid (hold Alt to move freely).
   */
  const beginItemsDrag = (e: PointerEvent, id: string) => {
    if (e.button !== 0 || ui.spaceDown) return;
    e.stopPropagation();
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (e.shiftKey) {
      toggleEerSelected(id);
      return;
    }
    if (!isEerSelected(id)) selectEer([id]);
    if (!canEdit()) return;
    const moving = eerWithContents(eerSelectedIds());
    const origin = new Map([...eer.entities, ...eer.sections].filter((x) => moving.has(x.id)).map((x) => [x.id, { x: x.x, y: x.y }]));
    const grabbed = origin.get(id);
    if (!grabbed) return;
    // The sections the moved sections are in: they stay in them while their center is
    const was = sectionsAround(eerSelectedIds(), moving);
    // The sections as they were: they grow while a table is dragged to their edge, and shrink back when it goes on, out
    const sizes = sectionSizes(moving);
    // Smart guides: the edges and centers of what stays put
    const others = itemRects((x) => !moving.has(x));
    const lines = snapLines(others);
    const box0 = bounds(itemRects((x) => moving.has(x)))!;
    const start = toWorld(e.clientX, e.clientY);
    let started = false;
    trackPointer(
      e,
      (ev) => {
        if (!started) {
          if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return;
          started = true;
          eerCheckpoint();
          setDragging(true);
        }
        const w = toWorld(ev.clientX, ev.clientY);
        let dx = w.x - start.x;
        let dy = w.y - start.y;
        if (!ev.altKey) {
          // Lined up with something close by, else on the grid
          const s = snapBox({ ...box0, x: box0.x + dx, y: box0.y + dy }, lines, SNAP_REACH / cam().zoom);
          dx = s.dx !== null ? dx + s.dx : snap(grabbed.x + dx) - grabbed.x;
          dy = s.dy !== null ? dy + s.dy : snap(grabbed.y + dy) - grabbed.y;
        }
        setGuides(ev.altKey ? [] : guidesFor({ ...box0, x: box0.x + dx, y: box0.y + dy }, others));
        const pos = new Map<string, Pt>();
        for (const [k, o] of origin) pos.set(k, { x: o.x + dx, y: o.y + dy });
        batch(() => {
          restoreEerSections(sizes);
          moveEerItems(pos);
          // In a section (or partly out of one): it grows to fit
          growEerSections(eerSelectedIds(), was);
        });
      },
      () => {
        setDragging(false);
        setGuides([]);
      },
      follow(),
    );
  };

  /** A side or corner of a section: its size (by the left or top side, also where it is). */
  const beginSectionResize = (e: PointerEvent, s: EerSection, dir: ResizeDir) => {
    if (e.button !== 0 || !canEdit()) return;
    e.stopPropagation();
    const start = toWorld(e.clientX, e.clientY);
    const r0 = { x: s.x, y: s.y, w: s.w, h: s.h };
    const was = sectionsAround([s.id], new Set([s.id]));
    const sizes = sectionSizes(new Set([s.id]));
    const others = itemRects((x) => x !== s.id);
    const lines = snapLines(others);
    let started = false;
    trackPointer(
      e,
      (ev) => {
        if (!started) {
          started = true;
          eerCheckpoint();
          setDragging(true);
        }
        const w = toWorld(ev.clientX, ev.clientY);
        const reach = SNAP_REACH / cam().zoom;
        // A side lines up with an edge or center close by, else goes on the grid
        const roundX = (v: number) => (ev.altKey ? v : (nearestLine(v, lines.xs, reach) ?? snap(v)));
        const roundY = (v: number) => (ev.altKey ? v : (nearestLine(v, lines.ys, reach) ?? snap(v)));
        const r = resizeRect(r0, dir, w.x - start.x, w.y - start.y, SECTION_MIN, roundX, roundY);
        setGuides(ev.altKey ? [] : guidesFor(r, others));
        batch(() => {
          restoreEerSections(sizes);
          setSectionRect(s.id, r);
          // Made larger than the section it is in: that one grows too
          growEerSections([s.id], was);
        });
      },
      () => {
        setDragging(false);
        setGuides([]);
      },
      follow(),
    );
  };

  /** Double-click: in the strip at the top of a section, rename it; anywhere else, a new table. */
  const onCanvasDblClick = (e: MouseEvent) => {
    if (!canEdit()) return;
    const w = toWorld(e.clientX, e.clientY);
    const section = eer.sections
      .filter((s) => w.x >= s.x && w.x <= s.x + s.w && w.y >= s.y && w.y <= s.y + SECTION_HEADER)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    if (section) {
      selectEer([section.id]);
      setEditingSection(section.id);
      return;
    }
    addEntity(w.x - ENTITY_W / 2, w.y - 20);
  };

  // Schema checks (see eerChecks.ts): a list in the toolbar, a mark on the tables
  const problems = createMemo(() => checkSchema(eer.entities, eer.relations));
  const warningsOn = (id: string) => problems().filter((x) => x.entityId === id && x.level === "warning");
  const [checksOpen, setChecksOpen] = createSignal(false);
  const showProblem = (x: Problem) => {
    setChecksOpen(false);
    if (x.relationId) setEerSelected({ kind: "relation", id: x.relationId });
    else if (x.entityId) setEerSelected({ kind: "entity", id: x.entityId });
    const e = x.entityId ? entityById(x.entityId) : undefined;
    if (!e) return;
    const r = el.getBoundingClientRect();
    const box = entityRect(e);
    setEerCamera({ x: r.width / 2 - (box.x + box.w / 2) * cam().zoom, y: r.height / 2 - (box.y + box.h / 2) * cam().zoom });
  };

  // Sections behind the lines and tables, the largest at the back
  const sections = createMemo(() => [...eer.sections].sort((a, b) => b.w * b.h - a.w * a.h));

  /** The table under the pointer, and the column row if it is on one */
  const targetAt = (cx: number, cy: number) => {
    const el = document.elementFromPoint(cx, cy);
    const entity = el?.closest<HTMLElement>("[data-entity-id]")?.dataset.entityId;
    if (!entity) return null;
    return { entity, attr: el?.closest<HTMLElement>("[data-attr-id]")?.dataset.attrId ?? null };
  };

  const beginConnect = (e: PointerEvent, from: string, attr: string) => {
    if (e.button !== 0 || !canEdit()) return;
    e.stopPropagation();
    trackPointer(
      e,
      (ev) => {
        const t = targetAt(ev.clientX, ev.clientY);
        // Not onto the row it started from
        const target = t && !(t.entity === from && t.attr === attr) ? t : null;
        setConnecting({ from, attr, at: toWorld(ev.clientX, ev.clientY), target });
      },
      () => {
        const c = connecting();
        setConnecting(null);
        if (c?.target) connectRows(from, attr, c.target.entity, c.target.attr);
      },
      follow(),
    );
  };

  const selectedEntity = () => {
    const s = eerSelected();
    return s?.kind === "entity" ? entityById(s.id) : undefined;
  };
  const selectedRelation = () => {
    const s = eerSelected();
    return s?.kind === "relation" ? eer.relations.find((r) => r.id === s.id) : undefined;
  };

  return (
    <div class="eer-editor" classList={{ "read-only": !canEdit() }}>
      <div
        ref={el}
        class="viewport eer-viewport"
        classList={{ "can-pan": ui.spaceDown, panning: panning() }}
        style={{
          "background-size": `${20 * cam().zoom}px ${20 * cam().zoom}px`,
          "background-position": `${cam().x}px ${cam().y}px`,
        }}
        onPointerDown={onCanvasDown}
        onPointerMove={(e) => setEerPointer(toWorld(e.clientX, e.clientY))}
        onPointerLeave={() => setEerPointer(null)}
        onDblClick={onCanvasDblClick}
      >
        <div class="world" style={{ transform: `translate(${cam().x}px, ${cam().y}px) scale(${cam().zoom})` }}>
          <For each={sections()}>
            {(s) => (
              <SectionView
                section={s}
                onTitleDown={(e) => beginItemsDrag(e, s.id)}
                onResizeDown={(e, dir) => beginSectionResize(e, s, dir)}
              />
            )}
          </For>
        </div>
        <svg class="edges-layer">
          <g transform={`translate(${cam().x} ${cam().y}) scale(${cam().zoom})`}>
            <For each={eer.relations}>{(r) => <RelationLine relation={r} />}</For>
            <Show when={marquee()}>
              {(m) => {
                const r = () => normRect(m().x0, m().y0, m().x1, m().y1);
                return <rect class="marquee" x={r().x} y={r().y} width={r().w} height={r().h} rx={2} />;
              }}
            </Show>
            <SnapGuides guides={guides()} />
            <Show when={connecting()}>
              {(c) => {
                // From the side of the row that faces the pointer
                const d = () => {
                  const f = entityById(c().from);
                  const y = f && rowY(f, c().attr);
                  if (!f || y == null) return "";
                  const right = c().at.x > f.x + ENTITY_W / 2;
                  const p1 = { x: right ? f.x + ENTITY_W : f.x, y };
                  return elbow(p1, { x: right ? 1 : -1, y: 0 }, c().at, { x: right ? -1 : 1, y: 0 }).d;
                };
                return <path class="edge-line preview" d={d()} />;
              }}
            </Show>
          </g>
        </svg>
        <div class="world" style={{ transform: `translate(${cam().x}px, ${cam().y}px) scale(${cam().zoom})` }}>
          <For each={eer.entities}>
            {(ent) => (
              <EntityView
                entity={ent}
                target={connecting()?.target?.entity === ent.id ? (connecting()?.target?.attr ?? "table") : null}
                onHeaderDown={(e) => beginItemsDrag(e, ent.id)}
                warnings={warningsOn(ent.id).map((x) => x.message)}
                onConnect={(e, attr) => beginConnect(e, ent.id, attr)}
              />
            )}
          </For>
          <EerCommentPins />
          <EerPresence />
        </div>
        <PlacingOverlay kind="eer" toWorldPoint={toWorld} />
        <Show when={canEdit() && !dragging() && !marquee() && !connecting() && !editingSection()}>
          <EerBar view={() => el.getBoundingClientRect()} />
        </Show>

        <div class="eer-toolbar panel" hidden={!canEdit()} onPointerDown={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
          <button
            class="text-btn"
            title="Add a table (or double-click the canvas)"
            onClick={() => {
              const r = el.getBoundingClientRect();
              const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
              addEntity(w.x - ENTITY_W / 2, w.y - 60);
            }}
          >
            <IconPlus />
            <span>Table</span>
          </button>
          <button
            class="text-btn"
            title="Add a section to group tables in (or select tables and press Ctrl+G)"
            onClick={() => {
              const r = el.getBoundingClientRect();
              const w = toWorld(r.left + r.width / 2, r.top + r.height / 2);
              addSection(w.x, w.y);
            }}
          >
            <IconSection />
            <span>Section</span>
          </button>
          <span class="eer-hint">Drag the dot beside a column onto another table to join them</span>
          <Show when={problems().length}>
            <span class="uml-wrap">
              <button
                class="text-btn eer-checks-btn"
                classList={{ warn: problems().some((x) => x.level === "warning"), pressed: checksOpen() }}
                onClick={() => setChecksOpen(!checksOpen())}
                title="What may be wrong with the schema"
              >
                Checks <span class="eer-checks-count">{problems().length}</span>
              </button>
              <Show when={checksOpen()}>
                <div class="eer-checks panel">
                  <For each={problems()}>
                    {(x) => (
                      <button class="eer-check" classList={{ warning: x.level === "warning" }} onClick={() => showProblem(x)}>
                        <span class="eer-check-mark">{x.level === "warning" ? "!" : "i"}</span>
                        {x.message}
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </span>
          </Show>
        </div>
      </div>

      <Show when={selectedEntity() || selectedRelation()}>
        <aside class="eer-inspector">
          {/* Viewing only: every field and button in it is off */}
          <fieldset class="eer-inspector-fields" disabled={!canEdit()}>
            <Show when={selectedEntity()}>{(e) => <EntityInspector entity={e()} />}</Show>
            <Show when={selectedRelation()}>{(r) => <RelationInspector relation={r()} />}</Show>
          </fieldset>
        </aside>
      </Show>
    </div>
  );
}

// ---------- canvas ----------

function EntityView(p: {
  entity: Entity;
  /** While a row is dragged here: the row under the pointer, or "table" */
  target: string | null;
  onHeaderDown: (e: PointerEvent) => void;
  onConnect: (e: PointerEvent, attr: string) => void;
  /** What the schema checks found wrong with this table */
  warnings: string[];
}) {
  const e = p.entity;
  const selected = () => isEerSelected(e.id);
  return (
    <div
      class={`eer-entity ${colorClass(e.color ?? "white", e.tint)}`}
      classList={{ selected: selected(), target: p.target === "table", "version-gone": versionMark(e.id) === "gone", "version-changed": versionMark(e.id) === "changed" }}
      data-entity-id={e.id}
      style={{ ...tintVars(e.tint), transform: `translate(${e.x}px, ${e.y}px)`, width: `${ENTITY_W}px`, height: `${entityHeight(e)}px` }}
      onPointerDown={(ev) => {
        if (ev.button !== 0 || ui.spaceDown) return;
        ev.stopPropagation();
        (document.activeElement as HTMLElement | null)?.blur?.();
        if (ev.shiftKey) toggleEerSelected(e.id);
        else selectEer([e.id]);
      }}
      onDblClick={(ev) => ev.stopPropagation()}
    >
      <div class="eer-header" style={{ height: `${HEADER_H}px` }} onPointerDown={p.onHeaderDown}>
        {e.name}
        <Show when={p.warnings.length}>
          <span class="eer-warning" title={p.warnings.join("\n")}>
            !
          </span>
        </Show>
      </div>
      <Show when={cardsLinkedTo(e.id).length}>
        <LinkedCardsBadge nodeId={e.id} />
      </Show>
      <For each={e.attributes} fallback={<div class="eer-row eer-empty">No columns</div>}>
        {(a) => (
          <div
            class="eer-row"
            classList={{ target: p.target === a.id }}
            data-attr-id={a.id}
            style={{ height: `${ROW_H}px` }}
          >
            {/* Drag to another table to join; a key is referred to, another column refers */}
            <For each={["left", "right"]}>
              {(side) => (
                <span
                  class={`eer-row-handle ${side}`}
                  classList={{ key: isKey(a) }}
                  title={isKey(a) ? "Drag onto a table to refer to this key from there" : "Drag onto a table or column this one refers to"}
                  onPointerDown={(e) => p.onConnect(e, a.id)}
                />
              )}
            </For>
            <span class="eer-key">
              <Show when={a.primaryKey}>
                <span class="key pk" title="Primary key">PK</span>
              </Show>
              <Show when={isForeignKey(e.id, a.id)}>
                <span class="key fk" title="Foreign key">FK</span>
              </Show>
            </span>
            <span class="eer-name" classList={{ "is-pk": a.primaryKey }}>
              {a.name}
            </span>
            <span class="eer-type" title={a.defaultValue ? `default ${a.defaultValue}` : undefined}>
              {typeLabel(a)}
              {!a.nullable && !a.primaryKey ? " NN" : ""}
              {a.unique ? " UQ" : ""}
              {a.autoIncrement ? " AI" : ""}
              {a.defaultValue ? ` = ${a.defaultValue}` : ""}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * A section: a titled frame behind the tables. Only its title catches the pointer
 * (drag it to move the section with what is in it); its inside lets clicks through.
 */
function SectionView(p: {
  section: EerSection;
  onTitleDown: (e: PointerEvent) => void;
  onResizeDown: (e: PointerEvent, dir: ResizeDir) => void;
}) {
  const s = p.section;
  const selected = () => isEerSelected(s.id);
  const only = () => selected() && eerSelectedIds().length === 1;
  const editing = () => editingSection() === s.id;
  /** The title before this edit: Escape goes back to it */
  let before = s.title;
  createEffect(on(editing, (ed) => ed && (before = s.title)));
  const rename = renameOnClick(only, () => setEditingSection(s.id));
  return (
    <div
      class={`node node-section ${colorClass(s.color ?? "white", s.tint)}`}
      classList={{ selected: selected(), editing: editing() }}
      data-section-id={s.id}
      style={{ ...tintVars(s.tint), transform: `translate(${s.x}px, ${s.y}px)`, width: `${s.w}px`, height: `${s.h}px` }}
    >
      <div class="node-body" />
      <div
        class="frame-title"
        title={editing() ? undefined : "Click again or double-click to rename"}
        onPointerDown={(e) => {
          rename.onPointerDown(e);
          if (!editing()) p.onTitleDown(e);
          else e.stopPropagation();
        }}
        onClick={rename.onClick}
        onDblClick={(e) => {
          e.stopPropagation();
          selectEer([s.id]);
          if (canEdit()) setEditingSection(s.id);
        }}
      >
        <Show
          when={editing()}
          fallback={
            <div class="node-text" classList={{ placeholder: !s.title }}>
              {s.title || "Section"}
            </div>
          }
        >
          <TextEditor
            class="node-text editor"
            value={s.title}
            onInput={(t) => setSectionTitleLive(s.id, t.replace(/\n/g, " "))}
            onDone={(t, key) => {
              setSectionTitle(s.id, key === "Escape" ? before : t.replace(/\n/g, " ").trim());
              if (editingSection() === s.id) setEditingSection(null);
            }}
          />
        </Show>
      </div>
      <Show when={only() && !editing() && canEdit()}>
        <For each={RESIZE_DIRS}>{(dir) => <div class={`resize-handle ${dir}`} onPointerDown={(e) => p.onResizeDown(e, dir)} />}</For>
      </Show>
    </div>
  );
}

/** The bar above the selected tables and sections: color, rename, wrap in a section, delete. */
function EerBar(p: { view: () => DOMRect }) {
  const box = createMemo(() => {
    const ids = new Set(eerSelectedIds());
    const b = bounds([...eer.entities.filter((e) => ids.has(e.id)).map(entityRect), ...eer.sections.filter((s) => ids.has(s.id))]);
    return b && grow(b, 20);
  });
  const items = () => {
    const ids = new Set(eerSelectedIds());
    return [...eer.entities.filter((e) => ids.has(e.id)), ...eer.sections.filter((s) => ids.has(s.id))];
  };
  const currentColor = () => {
    const c = items().map((x) => x.color ?? "white");
    return c.length && c.every((x) => x === c[0]) ? c[0] : null;
  };
  const currentTint = () => {
    const t = items().map((x) => x.tint ?? null);
    return t.length && t[0] && t.every((x) => x === t[0]) ? t[0] : null;
  };
  const section = () => {
    const ids = eerSelectedIds();
    return ids.length === 1 ? sectionById(ids[0]) : undefined;
  };
  return (
    <Show when={box()}>
      {(b) => (
        <FloatingBar box={b()} camera={eer.camera} view={p.view}>
          <ColorPicker compact color={currentColor()} tint={currentTint()} onPick={setEerSelectionColor} />
          <span class="divider" />
          <Show when={section()}>
            {(s) => (
              <button class="icon-btn" title="Rename (Enter)" onClick={() => setEditingSection(s().id)}>
                <IconRename />
                <span>Rename</span>
              </button>
            )}
          </Show>
          <Show when={eerSelectedIds().length > 1}>
            <AlignMenu count={eerSelectedIds().length} onAlign={alignEerSelection} onDistribute={distributeEerSelection} />
          </Show>
          <button class="icon-btn" title="Wrap in a section (Ctrl+G)" onClick={wrapEerSelection}>
            <IconSection />
          </button>
          <button class="icon-btn danger" title="Delete (Delete)" onClick={deleteEerSelection}>
            <IconTrash />
          </button>
        </FloatingBar>
      )}
    </Show>
  );
}

/**
 * The line of a relation: from the foreign key's row to the row it refers to.
 * Without join columns (many-to-many) from table to table.
 */
function relationGeom(r: Relation): EdgeGeom | null {
  const a = entityById(r.from);
  const b = entityById(r.to);
  if (!a || !b) return null;
  // The other tables: the line goes around them
  const others = eer.entities.filter((e) => e.id !== a.id && e.id !== b.id).map(entityRect);
  const pair = r.columns?.[0];
  const ya = pair ? rowY(a, pair.from) : null;
  const yb = pair ? rowY(b, pair.to) : null;
  if (ya == null || yb == null) {
    if (a.id === b.id) return edgeBetween(entityRect(a), entityRect(a), "elbow", 350, 10);
    return edgeBetween(entityRect(a), entityRect(b), "elbow", null, null, null, others);
  }
  // From the row on the left or the right of each table: whichever crosses the
  // fewest tables (its own two included), then the shortest
  const own = (a.id === b.id ? [a] : [a, b]).map((e) => ownBlock(entityRect(e)));
  const all = [...others, ...own];
  let best: EdgeGeom | null = null;
  let bestCost = [Infinity, Infinity];
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      const g = elbow(
        { x: sa > 0 ? a.x + ENTITY_W : a.x, y: ya },
        { x: sa, y: 0 },
        { x: sb > 0 ? b.x + ENTITY_W : b.x, y: yb },
        { x: sb, y: 0 },
        others,
      );
      const cost = [crossings(g.points, all), routeLength(g.points)];
      if (cost[0] < bestCost[0] || (cost[0] === bestCost[0] && cost[1] < bestCost[1])) {
        best = g;
        bestCost = cost;
      }
    }
  }
  return best;
}

/** A relation line with crow's-foot ends; click it to select. */
function RelationLine(p: { relation: Relation }) {
  const geom = createMemo(() => relationGeom(p.relation));
  const selected = () => eerSelected()?.kind === "relation" && eerSelected()?.id === p.relation.id;
  return (
    <Show when={geom()}>
      {(g) => (
        <g class="edge eer-relation" classList={{ selected: selected() }}>
          <path
            class="edge-hit"
            d={g().d}
            onPointerDown={(e) => {
              e.stopPropagation();
              setEerSelected({ kind: "relation", id: p.relation.id });
            }}
          />
          <path class="edge-line" classList={{ dashed: isManyToMany(p.relation) }} d={g().d} />
          <CrowFoot card={p.relation.fromCardinality} points={g().points} end="start" />
          <CrowFoot card={p.relation.toCardinality} points={g().points} end="end" />
          <Show when={p.relation.label}>
            <text class="eer-label" x={g().points[Math.floor(g().points.length / 2)].x} y={g().points[Math.floor(g().points.length / 2)].y - 6}>
              {p.relation.label}
            </text>
          </Show>
        </g>
      )}
    </Show>
  );
}

/**
 * Crow's-foot notation at one end of a relation, drawn pointing into the table:
 * one = two bars, zero or one = circle and bar, many = circle and crow's foot,
 * one or more = bar and crow's foot.
 */
function CrowFoot(p: { card: Cardinality; points: Pt[]; end: "start" | "end" }) {
  const at = () => lineEnd(p.points, p.end);
  const many = () => p.card === "many" || p.card === "oneOrMany";
  const zero = () => p.card === "zeroOrOne" || p.card === "many";
  return (
    <g class="crow" transform={`translate(${at().x} ${at().y}) rotate(${at().angle})`}>
      <Show when={many()} fallback={<path d="M -6 -7 V 7" />}>
        <path d="M -14 0 L 0 -8 M -14 0 L 0 8 M -14 0 L 0 0" />
      </Show>
      <Show when={zero()} fallback={<path d={many() ? "M -18 -7 V 7" : "M -12 -7 V 7"} />}>
        <circle cx={many() ? -21 : -17} cy={0} r={4.5} />
      </Show>
    </g>
  );
}

// ---------- inspector ----------

function EntityInspector(p: { entity: Entity }) {
  const relations = () => eer.relations.filter((r) => r.from === p.entity.id || r.to === p.entity.id);
  const otherName = (r: Relation) => entityById(r.from === p.entity.id ? r.to : r.from)?.name ?? "?";
  const short = (c: Cardinality) => CARDINALITIES.find((x) => x.value === c)?.short ?? "";

  return (
    <>
      <div class="eer-insp-head">
        <span class="eer-insp-kind">Table</span>
        <button class="icon-btn small danger" title="Delete table" onClick={() => deleteEntity(p.entity.id)}>
          <IconTrash />
        </button>
      </div>
      <input
        class="eer-input eer-title-input"
        value={p.entity.name}
        onChange={(e) => e.currentTarget.value.trim() && updateEntity(p.entity.id, { name: e.currentTarget.value.trim() })}
      />
      <div class="eer-insp-cards">
        <CardLinksMenu nodeId={p.entity.id} />
      </div>
      <div class="eer-colors">
        <ColorPicker color={p.entity.color ?? "white"} tint={p.entity.tint} onPick={(c) => setEntityColor(p.entity.id, c)} />
      </div>

      <div class="eer-section-title">
        Columns
        <button class="kd-link" onClick={() => addAttribute(p.entity.id)}>
          + Column
        </button>
      </div>
      <For each={p.entity.attributes}>
        {(a, i) => <AttributeEditor entity={p.entity} attr={a} first={i() === 0} last={i() === p.entity.attributes.length - 1} />}
      </For>

      <IndexEditor entity={p.entity} />

      <div class="eer-section-title">Comment</div>
      <textarea
        class="eer-input eer-textarea"
        placeholder="Written above the table in the SQL"
        value={p.entity.comment ?? ""}
        onChange={(e) => updateEntity(p.entity.id, { comment: e.currentTarget.value || undefined })}
      />

      <Show when={relations().length}>
        <div class="eer-section-title">Relations</div>
        <For each={relations()}>
          {(r) => (
            <button class="eer-rel-link" onClick={() => setEerSelected({ kind: "relation", id: r.id })}>
              {r.from === p.entity.id ? "→" : "←"} {otherName(r)}
              <small>
                {short(r.fromCardinality)} : {short(r.toCardinality)}
              </small>
            </button>
          )}
        </For>
      </Show>
    </>
  );
}

/** The table's indexes: which columns, in which order, unique or not, and a name if wanted */
function IndexEditor(p: { entity: Entity }) {
  const name = (id: string) => p.entity.attributes.find((a) => a.id === id)?.name ?? "?";
  return (
    <>
      <div class="eer-section-title">
        Indexes
        <button class="kd-link" onClick={() => addIndex(p.entity.id)}>
          + Index
        </button>
      </div>
      <For each={p.entity.indexes ?? []} fallback={<p class="eer-note">None. Primary keys and unique columns have their own.</p>}>
        {(ix) => (
          <div class="eer-attr">
            <div class="eer-attr-row">
              <input
                class="eer-input eer-attr-name"
                placeholder={`idx_${p.entity.name}_${ix.columns.map(name).join("_")}`}
                value={ix.name}
                onChange={(e) => updateIndex(p.entity.id, ix.id, { name: e.currentTarget.value.trim() })}
              />
              <label class="eer-flag" classList={{ on: ix.unique }} title="Unique: no two rows with the same values">
                <input type="checkbox" checked={ix.unique} onChange={(e) => updateIndex(p.entity.id, ix.id, { unique: e.currentTarget.checked })} />
                UQ
              </label>
              <span class="eer-attr-actions">
                <button class="icon-btn small danger" title="Remove index" onClick={() => removeIndex(p.entity.id, ix.id)}>
                  <IconClose />
                </button>
              </span>
            </div>
            {/* In index order; click a column to take it in or out */}
            <div class="eer-index-columns">
              <For each={ix.columns}>{(id) => <span class="eer-index-col on">{name(id)}</span>}</For>
              <For each={p.entity.attributes.filter((a) => !ix.columns.includes(a.id))}>
                {(a) => (
                  <button class="eer-index-col" title="Add to the index" onClick={() => toggleIndexColumn(p.entity.id, ix.id, a.id)}>
                    + {a.name}
                  </button>
                )}
              </For>
              <Show when={ix.columns.length > 1}>
                <button class="kd-link" title="Take the last column out" onClick={() => toggleIndexColumn(p.entity.id, ix.id, ix.columns[ix.columns.length - 1])}>
                  − last
                </button>
              </Show>
            </div>
          </div>
        )}
      </For>
    </>
  );
}

function AttributeEditor(p: { entity: Entity; attr: Attribute; first: boolean; last: boolean }) {
  const set = (changes: Partial<Attribute>) => updateAttribute(p.entity.id, p.attr.id, changes);
  const flag = (label: string, title: string, value: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <label class="eer-flag" classList={{ on: value, disabled }} title={title}>
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
      {label}
    </label>
  );
  const num = (v: string) => (v.trim() === "" ? undefined : Math.max(0, Math.round(Number(v)) || 0));

  return (
    <div class="eer-attr">
      <div class="eer-attr-row">
        <input
          class="eer-input eer-attr-name"
          value={p.attr.name}
          onChange={(e) => e.currentTarget.value.trim() && set({ name: e.currentTarget.value.trim() })}
        />
        <select class="eer-input eer-attr-type" value={p.attr.dataType} onChange={(e) => set({ dataType: e.currentTarget.value as Attribute["dataType"] })}>
          <For each={DATA_TYPES}>{(t) => <option value={t.type}>{t.label}</option>}</For>
        </select>
        <Show when={hasLength(p.attr.dataType)}>
          <input
            class="eer-input eer-attr-len"
            type="number"
            min="1"
            title={p.attr.dataType === "decimal" ? "Precision (digits)" : "Length"}
            placeholder={p.attr.dataType === "decimal" ? "10" : "255"}
            value={p.attr.length ?? ""}
            onChange={(e) => set({ length: num(e.currentTarget.value) })}
          />
        </Show>
        <Show when={p.attr.dataType === "decimal"}>
          <input
            class="eer-input eer-attr-len"
            type="number"
            min="0"
            title="Scale (digits after the point)"
            placeholder="2"
            value={p.attr.scale ?? ""}
            onChange={(e) => set({ scale: num(e.currentTarget.value) })}
          />
        </Show>
      </div>
      <div class="eer-attr-row">
        {flag("PK", "Primary key", p.attr.primaryKey, (v) => set({ primaryKey: v }))}
        {flag("NN", "Not null", !p.attr.nullable, (v) => set({ nullable: !v }), p.attr.primaryKey)}
        {flag("UQ", "Unique", p.attr.unique ?? false, (v) => set({ unique: v }), p.attr.primaryKey)}
        {flag("AI", "Auto increment", p.attr.autoIncrement ?? false, (v) => set({ autoIncrement: v }), !isInteger(p.attr.dataType))}
        <input
          class="eer-input eer-attr-default"
          placeholder="Default"
          title="Default value: 0, 'text', CURRENT_TIMESTAMP, true… Plain text is quoted on export."
          value={p.attr.defaultValue ?? ""}
          onChange={(e) => set({ defaultValue: e.currentTarget.value.trim() || undefined })}
        />
        <span class="eer-attr-actions">
          <button class="icon-btn small" title="Move up" disabled={p.first} onClick={() => moveAttribute(p.entity.id, p.attr.id, -1)}>
            ↑
          </button>
          <button class="icon-btn small" title="Move down" disabled={p.last} onClick={() => moveAttribute(p.entity.id, p.attr.id, 1)}>
            ↓
          </button>
          <button class="icon-btn small danger" title="Remove column" onClick={() => removeAttribute(p.entity.id, p.attr.id)}>
            <IconClose />
          </button>
        </span>
      </div>
    </div>
  );
}

function RelationInspector(p: { relation: Relation }) {
  const r = () => p.relation;
  const from = () => entityById(r().from);
  const to = () => entityById(r().to);
  const columns = () => r().columns ?? [];
  const setPair = (i: number, side: "from" | "to", id: string) =>
    updateRelation(r().id, { columns: columns().map((c, j) => (j === i ? { ...c, [side]: id } : c)) });

  return (
    <>
      <div class="eer-insp-head">
        <span class="eer-insp-kind">Relation</span>
        <button class="icon-btn small danger" title="Delete relation (and its foreign key columns)" onClick={() => deleteRelation(r().id)}>
          <IconTrash />
        </button>
      </div>
      <div class="eer-rel-title">
        <strong>{from()?.name}</strong> references <strong>{to()?.name}</strong>
      </div>

      <div class="eer-section-title">Cardinality</div>
      <div class="eer-card-grid">
        <span>{from()?.name} side</span>
        <select class="eer-input" value={r().fromCardinality} onChange={(e) => updateRelation(r().id, { fromCardinality: e.currentTarget.value as Cardinality })}>
          <For each={CARDINALITIES}>{(c) => <option value={c.value}>{c.label}</option>}</For>
        </select>
        <span>{to()?.name} side</span>
        <select class="eer-input" value={r().toCardinality} onChange={(e) => updateRelation(r().id, { toCardinality: e.currentTarget.value as Cardinality })}>
          <For each={CARDINALITIES}>{(c) => <option value={c.value}>{c.label}</option>}</For>
        </select>
      </div>

      <Show
        when={!isManyToMany(r())}
        fallback={
          <p class="eer-note">Many on both sides: the SQL export adds a junction table with the primary keys of both tables.</p>
        }
      >
        <div class="eer-section-title">
          Join
          <button
            class="kd-link"
            onClick={() =>
              updateRelation(r().id, {
                columns: [...columns(), { from: from()?.attributes[0]?.id ?? "", to: to()?.attributes.find((a) => a.primaryKey)?.id ?? "" }],
              })
            }
          >
            + Column pair
          </button>
        </div>
        <For each={columns()} fallback={<p class="eer-note">No join columns: no foreign key is created.</p>}>
          {(c, i) => (
            <div class="eer-join-row">
              <select class="eer-input" value={c.from} onChange={(e) => setPair(i(), "from", e.currentTarget.value)}>
                <For each={from()?.attributes ?? []}>{(a) => <option value={a.id}>{a.name}</option>}</For>
              </select>
              <span>=</span>
              <select class="eer-input" value={c.to} onChange={(e) => setPair(i(), "to", e.currentTarget.value)}>
                <For each={to()?.attributes ?? []}>{(a) => <option value={a.id}>{a.name}</option>}</For>
              </select>
              <button
                class="icon-btn small danger"
                title="Remove pair"
                onClick={() => updateRelation(r().id, { columns: columns().filter((_, j) => j !== i()) })}
              >
                <IconClose />
              </button>
            </div>
          )}
        </For>

        <div class="eer-card-grid">
          <span>On delete</span>
          <select class="eer-input" value={r().onDelete ?? "noAction"} onChange={(e) => updateRelation(r().id, { onDelete: e.currentTarget.value as RefAction })}>
            <For each={ACTIONS}>{(a) => <option value={a.value}>{a.label}</option>}</For>
          </select>
          <span>On update</span>
          <select class="eer-input" value={r().onUpdate ?? "noAction"} onChange={(e) => updateRelation(r().id, { onUpdate: e.currentTarget.value as RefAction })}>
            <For each={ACTIONS}>{(a) => <option value={a.value}>{a.label}</option>}</For>
          </select>
        </div>
      </Show>

      <div class="eer-section-title">Label</div>
      <input
        class="eer-input"
        placeholder="e.g. places"
        value={r().label ?? ""}
        onChange={(e) => updateRelation(r().id, { label: e.currentTarget.value.trim() || undefined })}
      />
    </>
  );
}
