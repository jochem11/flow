// The EER editor: tables (entities) on a canvas with crow's-foot relations between
// them, and an inspector on the right to edit columns and joins.
//
// Drag a table by its header; drag the dot beside a column's row onto another
// table (or one of its rows) to join them: the foreign key columns are added for
// you (see `connectRows`). Double-click the canvas to add a table.

import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import {
  addAttribute,
  addEntity,
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
  moveEntity,
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
import { crossings, edgeBetween, elbow, lineEnd, ownBlock, routeLength, type EdgeGeom, type Pt } from "../lib/geometry";
import { trackPointer } from "../lib/interactions";
import { snap } from "../lib/store";
import type { Attribute, Cardinality, Entity, NodeColor, RefAction, Relation } from "../lib/types";
import { IconClose, IconPlus, IconTrash } from "./icons";
import { cardsLinkedTo } from "../lib/links";
import { LinkedCardsBadge } from "./NodeView";
import { CardLinksMenu } from "./CardLinksMenu";

const COLORS: NodeColor[] = ["white", "yellow", "green", "blue", "purple", "pink"];

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
    onCleanup(() => el.removeEventListener("wheel", onWheel));
    // A new diagram: start with the origin a bit in from the corner
    if (!eer.entities.length && cam().x === 0 && cam().y === 0) setEerCamera({ x: 80, y: 80 });
  });

  /** Empty canvas: deselect, and drag to pan. */
  const onCanvasDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setEerSelected(null);
    let last = { x: e.clientX, y: e.clientY };
    trackPointer(e, (ev) => {
      setEerCamera({ x: cam().x + ev.clientX - last.x, y: cam().y + ev.clientY - last.y });
      last = { x: ev.clientX, y: ev.clientY };
    });
  };

  /** The table under the pointer, and the column row if it is on one */
  const targetAt = (cx: number, cy: number) => {
    const el = document.elementFromPoint(cx, cy);
    const entity = el?.closest<HTMLElement>("[data-entity-id]")?.dataset.entityId;
    if (!entity) return null;
    return { entity, attr: el?.closest<HTMLElement>("[data-attr-id]")?.dataset.attrId ?? null };
  };

  const beginTableDrag = (e: PointerEvent, ent: Entity) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setEerSelected({ kind: "entity", id: ent.id });
    const start = toWorld(e.clientX, e.clientY);
    const origin = { x: ent.x, y: ent.y };
    let started = false;
    trackPointer(e, (ev) => {
      const w = toWorld(ev.clientX, ev.clientY);
      if (!started) {
        if (Math.hypot(w.x - start.x, w.y - start.y) * cam().zoom < 3) return;
        started = true;
        eerCheckpoint();
      }
      const round = ev.altKey ? (v: number) => v : snap;
      moveEntity(ent.id, round(origin.x + w.x - start.x), round(origin.y + w.y - start.y));
    });
  };

  const beginConnect = (e: PointerEvent, from: string, attr: string) => {
    if (e.button !== 0) return;
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
    <div class="eer-editor">
      <div
        ref={el}
        class="viewport eer-viewport"
        style={{
          "background-size": `${20 * cam().zoom}px ${20 * cam().zoom}px`,
          "background-position": `${cam().x}px ${cam().y}px`,
        }}
        onPointerDown={onCanvasDown}
        onDblClick={(e) => {
          const w = toWorld(e.clientX, e.clientY);
          addEntity(w.x - ENTITY_W / 2, w.y - 20);
        }}
      >
        <svg class="edges-layer">
          <g transform={`translate(${cam().x} ${cam().y}) scale(${cam().zoom})`}>
            <For each={eer.relations}>{(r) => <RelationLine relation={r} />}</For>
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
                onHeaderDown={(e) => beginTableDrag(e, ent)}
                onConnect={(e, attr) => beginConnect(e, ent.id, attr)}
              />
            )}
          </For>
        </div>

        <div class="eer-toolbar panel" onPointerDown={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
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
          <span class="eer-hint">Drag the dot beside a column onto another table to join them</span>
        </div>
      </div>

      <Show when={selectedEntity() || selectedRelation()}>
        <aside class="eer-inspector">
          <Show when={selectedEntity()}>{(e) => <EntityInspector entity={e()} />}</Show>
          <Show when={selectedRelation()}>{(r) => <RelationInspector relation={r()} />}</Show>
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
}) {
  const e = p.entity;
  const selected = () => eerSelected()?.kind === "entity" && eerSelected()?.id === e.id;
  return (
    <div
      class={`eer-entity color-${e.color ?? "white"}`}
      classList={{ selected: selected(), target: p.target === "table" }}
      data-entity-id={e.id}
      style={{ transform: `translate(${e.x}px, ${e.y}px)`, width: `${ENTITY_W}px`, height: `${entityHeight(e)}px` }}
      onPointerDown={(ev) => {
        ev.stopPropagation();
        setEerSelected({ kind: "entity", id: e.id });
      }}
      onDblClick={(ev) => ev.stopPropagation()}
    >
      <div class="eer-header" style={{ height: `${HEADER_H}px` }} onPointerDown={p.onHeaderDown}>
        {e.name}
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
        <For each={COLORS}>
          {(c) => (
            <button
              class={`swatch color-${c}`}
              classList={{ active: (p.entity.color ?? "white") === c }}
              title={c}
              onClick={() => updateEntity(p.entity.id, { color: c })}
            />
          )}
        </For>
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
