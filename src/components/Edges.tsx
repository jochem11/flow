import { createMemo, For, onMount, Show } from "solid-js";
import type { FlowEdge } from "../lib/types";
import { edgeBetween, edgeToPoint, normRect } from "../lib/geometry";
import { blurActive } from "../lib/interactions";
import { board, nodeById, selectEdge, setEdgeLabel, setUi, ui } from "../lib/store";

function useGeom(edge: FlowEdge) {
  return createMemo(() => {
    const a = nodeById(edge.from);
    const b = nodeById(edge.to);
    return a && b ? edgeBetween(a, b) : null;
  });
}

/** SVG-laag in schermruimte; de camera zit in de <g transform>. */
export function EdgesLayer() {
  const connectingPath = createMemo(() => {
    const c = ui.connecting;
    if (!c) return null;
    const from = nodeById(c.from);
    if (!from) return null;
    const target = c.target ? nodeById(c.target) : undefined;
    return (target ? edgeBetween(from, target) : edgeToPoint(from, c)).d;
  });

  const marquee = createMemo(() => {
    const m = ui.marquee;
    return m ? normRect(m.x0, m.y0, m.x1, m.y1) : null;
  });

  return (
    <svg class="edges-layer">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0.5 L 10 5 L 0 9.5 z" class="arrow-head" />
        </marker>
        <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0.5 L 10 5 L 0 9.5 z" class="arrow-head active" />
        </marker>
      </defs>
      <g transform={`translate(${board.camera.x} ${board.camera.y}) scale(${board.camera.zoom})`}>
        <For each={board.edges}>{(e) => <EdgeView edge={e} />}</For>

        <Show when={connectingPath()}>
          {(d) => <path class="edge-line preview" d={d()} marker-end="url(#arrow-active)" />}
        </Show>

        <Show when={marquee()}>
          {(r) => <rect class="marquee" x={r().x} y={r().y} width={r().w} height={r().h} rx={2} />}
        </Show>
      </g>
    </svg>
  );
}

function EdgeView(p: { edge: FlowEdge }) {
  const geom = useGeom(p.edge);
  const active = () => ui.selectedEdge === p.edge.id;

  return (
    <Show when={geom()}>
      {(g) => (
        <g class="edge" classList={{ selected: active() }}>
          <path
            class="edge-hit"
            d={g().d}
            onPointerDown={(e) => {
              if (e.button !== 0 || ui.spaceDown) return;
              e.stopPropagation();
              blurActive();
              selectEdge(p.edge.id);
            }}
            onDblClick={(e) => {
              e.stopPropagation();
              selectEdge(p.edge.id);
              setUi("editingEdge", p.edge.id);
            }}
          />
          <path class="edge-line" d={g().d} marker-end={active() ? "url(#arrow-active)" : "url(#arrow)"} />
        </g>
      )}
    </Show>
  );
}

/** Labels staan in de HTML-laag zodat tekst en invoer makkelijk zijn. */
export function EdgeLabels() {
  return <For each={board.edges}>{(e) => <EdgeLabel edge={e} />}</For>;
}

function EdgeLabel(p: { edge: FlowEdge }) {
  const geom = useGeom(p.edge);
  const editing = () => ui.editingEdge === p.edge.id;

  return (
    <Show when={geom() && (p.edge.label || editing()) ? geom() : null}>
      {(g) => (
        <div
          class="edge-label"
          classList={{ selected: ui.selectedEdge === p.edge.id }}
          style={{ transform: `translate(${g().mid.x}px, ${g().mid.y}px) translate(-50%, -50%)` }}
          onPointerDown={(e) => {
            if (e.button !== 0 || ui.spaceDown) return;
            e.stopPropagation();
            if (!editing()) {
              blurActive();
              selectEdge(p.edge.id);
            }
          }}
          onDblClick={(e) => {
            e.stopPropagation();
            setUi("editingEdge", p.edge.id);
          }}
        >
          <Show when={editing()} fallback={p.edge.label}>
            <LabelInput edge={p.edge} />
          </Show>
        </div>
      )}
    </Show>
  );
}

function LabelInput(p: { edge: FlowEdge }) {
  let ref!: HTMLInputElement;
  let cancelled = false;
  onMount(() => {
    ref.focus();
    ref.select();
  });
  const finish = () => {
    if (!cancelled) setEdgeLabel(p.edge.id, ref.value);
    if (ui.editingEdge === p.edge.id) setUi("editingEdge", null);
  };
  return (
    <input
      ref={ref}
      class="label-input"
      value={p.edge.label ?? ""}
      placeholder="Label"
      size={Math.max(4, (p.edge.label ?? "").length + 1)}
      onInput={(e) => (e.currentTarget.size = Math.max(4, e.currentTarget.value.length + 1))}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") ref.blur();
        if (e.key === "Escape") {
          cancelled = true;
          ref.blur();
        }
      }}
    />
  );
}
