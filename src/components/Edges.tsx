import { createEffect, createMemo, createRoot, For, onMount, Show, type Accessor } from "solid-js";
import type { EdgeCap, FlowEdge, LabelSide } from "../lib/types";
import { edgeBetween, edgeToPoint, endLabelPoint, lineEnd, normRect, pointAlong, type EdgeGeom, type Pt } from "../lib/geometry";
import { SEQUENCE_KINDS } from "../lib/sequence";
import { beginEdgeMove, beginEndDrag, beginLabelDrag, blurActive } from "../lib/interactions";
import {
  board,
  checkpoint,
  DEFAULT_CAPS,
  edgeLine,
  isFreeEnd,
  nodeById,
  selectEdge,
  setEdgeEnd,
  setEdgeLabel,
  setUi,
  ui,
} from "../lib/store";

/**
 * The line of an edge, computed once and shared by everything that draws it (the
 * line, its label, its end texts and end dots): routing around blocks is not free.
 */
const lines = new Map<string, { line: Accessor<EdgeGeom | null>; dispose: () => void }>();
export function useGeom(edge: FlowEdge): Accessor<EdgeGeom | null> {
  let entry = lines.get(edge.id);
  if (!entry) {
    createRoot((dispose) => {
      entry = { line: createMemo(() => edgeLine(edge)), dispose };
      lines.set(edge.id, entry);
    });
  }
  return entry!.line;
}

// Forget the lines of edges that are gone (deleted, or another flowchart opened)
createRoot(() =>
  createEffect(() => {
    const ids = new Set(board.edges.map((e) => e.id));
    for (const [id, entry] of lines) {
      if (!ids.has(id)) {
        entry.dispose();
        lines.delete(id);
      }
    }
  }),
);

/** Where the label sits, in world coordinates. */
export const labelPoint = (edge: FlowEdge, points: { x: number; y: number }[]) =>
  pointAlong(points, edge.labelPos ?? 0.5);

/**
 * Arrowhead or dot at one end of a line, pointing out of it.
 * Drawn as plain shapes rather than SVG markers: WebKit (the Tauri webview on macOS)
 * does not redraw markers when they change.
 */
function Cap(p: { cap: EdgeCap; points: Pt[]; end: "start" | "end" }) {
  const at = () => lineEnd(p.points, p.end);
  return (
    <Show when={p.cap !== "none"}>
      <g
        class="arrow-head"
        classList={{ [p.cap]: true }}
        transform={`translate(${at().x} ${at().y}) rotate(${at().angle})`}
      >
        <Show when={p.cap !== "dot"} fallback={<circle cx={-4} r={3.5} />}>
          <path d={CAP_PATHS[p.cap]} />
        </Show>
      </g>
    </Show>
  );
}

/** Cap shapes pointing right, with the tip at (0, 0). */
export const CAP_PATHS: Record<EdgeCap, string> = {
  none: "",
  dot: "",
  arrow: "M -10 -5 L 0 0 L -10 5 z",
  open: "M -11 -6 L 0 0 L -11 6",
  triangle: "M -13 -7.5 L 0 0 L -13 7.5 z",
  diamond: "M 0 0 L -9 -5.5 L -18 0 L -9 5.5 z",
  hollowDiamond: "M 0 0 L -9 -5.5 L -18 0 L -9 5.5 z",
};

/** SVG layer in screen space; the camera is applied via the <g transform>. */
export function EdgesLayer() {
  const connectingPath = createMemo(() => {
    const c = ui.connecting;
    if (!c) return null;
    const from = nodeById(c.from);
    if (!from) return null;
    const target = c.target ? nodeById(c.target) : undefined;
    // From a lifeline: a horizontal message at the height of the pointer
    if (SEQUENCE_KINDS.has(from.kind) && (!target || SEQUENCE_KINDS.has(target.kind))) {
      const cx = from.x + from.w / 2;
      const x0 = from.kind === "lifeline" ? cx : c.x > cx ? from.x + from.w : from.x;
      const p1 = { x: x0, y: c.y };
      const p2 = { x: c.x, y: c.y };
      return { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`, points: [p1, p2] };
    }
    return target ? edgeBetween(from, target, ui.edgeStyle) : edgeToPoint(from, c, ui.edgeStyle);
  });

  const marquee = createMemo(() => {
    const m = ui.marquee;
    return m ? normRect(m.x0, m.y0, m.x1, m.y1) : null;
  });

  return (
    <svg class="edges-layer">
      <g transform={`translate(${board.camera.x} ${board.camera.y}) scale(${board.camera.zoom})`}>
        <For each={board.edges}>{(e) => <EdgeView edge={e} />}</For>

        <Show when={connectingPath()}>
          {(g) => (
            <g class="edge selected">
              <path class="edge-line preview" d={g().d} />
              <Cap cap="arrow" points={g().points} end="end" />
            </g>
          )}
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
              // With the line tool, a new line may start on top of this one
              if (e.button !== 0 || ui.spaceDown || ui.tool === "line") return;
              e.stopPropagation();
              blurActive();
              selectEdge(p.edge.id);
              beginEdgeMove(e, p.edge.id);
            }}
            onDblClick={(e) => {
              e.stopPropagation();
              selectEdge(p.edge.id);
              setUi("editingEdge", p.edge.id);
            }}
          />
          <path class="edge-line" classList={{ [p.edge.pattern ?? "solid"]: true }} d={g().d} />
          <Cap cap={p.edge.startCap ?? DEFAULT_CAPS.start} points={g().points} end="start" />
          <Cap cap={p.edge.endCap ?? DEFAULT_CAPS.end} points={g().points} end="end" />
        </g>
      )}
    </Show>
  );
}

/** Labels live in the HTML layer, which makes text rendering and editing easier. */
export function EdgeLabels() {
  return (
    <For each={board.edges}>
      {(e) => (
        <>
          <EdgeLabel edge={e} />
          <EndLabels edge={e} />
        </>
      )}
    </For>
  );
}

/** The small texts at both ends of an edge, like multiplicities ("1", "0..*"). */
function EndLabels(p: { edge: FlowEdge }) {
  const geom = useGeom(p.edge);
  return (
    <For each={["start", "end"] as const}>
      {(end) => {
        const text = () => (end === "start" ? p.edge.startLabel : p.edge.endLabel);
        const at = () => {
          const g = geom();
          return g && text() ? endLabelPoint(g.points, end) : null;
        };
        return (
          <Show when={at()}>
            {(pt) => (
              <div class="edge-end-label" style={{ transform: `translate(${pt().x}px, ${pt().y}px) translate(-50%, -50%)` }}>
                {text()}
              </div>
            )}
          </Show>
        );
      }}
    </For>
  );
}

function EdgeLabel(p: { edge: FlowEdge }) {
  const geom = useGeom(p.edge);
  const editing = () => ui.editingEdge === p.edge.id;
  const at = createMemo(() => {
    const g = geom();
    return g && (p.edge.label || editing()) ? labelPoint(p.edge, g.points) : null;
  });

  return (
    <Show when={at()}>
      {(pt) => (
        <div
          class="edge-label"
          classList={{ selected: ui.selectedEdge === p.edge.id, "off-line": (p.edge.labelSide ?? "on") !== "on" }}
          style={{
            transform: `translate(${pt().x}px, ${pt().y}px) ${sideOffset(p.edge.labelSide ?? "on", pt().horizontal)}`,
          }}
          title="Drag to move along the line"
          onPointerDown={(e) => {
            if (e.button !== 0 || ui.spaceDown) return;
            e.stopPropagation();
            if (!editing()) {
              blurActive();
              selectEdge(p.edge.id);
              beginLabelDrag(e, p.edge.id, geom);
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

/**
 * Dots on both ends of the selected edge. Drag one along the outline of its node
 * to attach the edge there; double-click it to let the side be picked automatically again.
 * In the HTML layer, above the nodes, so the half inside the node can be grabbed too.
 */
export function EdgeEnds() {
  const edge = () => (ui.selectedEdge ? board.edges.find((e) => e.id === ui.selectedEdge) : undefined);
  return (
    <Show when={!ui.editingEdge && edge()} keyed>
      {(e) => <EndDots edge={e} />}
    </Show>
  );
}

function EndDots(p: { edge: FlowEdge }) {
  const geom = useGeom(p.edge);
  const dot = (end: "from" | "to", at: Pt) => (
    <div
      class="edge-end"
      classList={{
        pinned: (end === "from" ? p.edge.fromAngle : p.edge.toAngle) != null,
        free: isFreeEnd(p.edge, end),
        // Out of the way while dragging, so the node under the pointer can be found
        moving: ui.dragging,
      }}
      style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)` }}
      title="Drag along a block to attach this end there, or into empty space to leave it free. Double-click: automatic side."
      onPointerDown={(e) => {
        if (e.button !== 0 || ui.spaceDown) return;
        e.stopPropagation();
        blurActive();
        beginEndDrag(e, p.edge.id, end);
      }}
      onDblClick={(e) => {
        e.stopPropagation();
        if (isFreeEnd(p.edge, end)) return;
        checkpoint();
        setEdgeEnd(p.edge.id, end, end === "from" ? p.edge.from : p.edge.to, null);
      }}
    />
  );
  return (
    <Show when={geom()}>
      {(g) => (
        <>
          {dot("from", g().points[0])}
          {dot("to", g().points[g().points.length - 1])}
        </>
      )}
    </Show>
  );
}

/** Moves the label from the line to just above or below it (left or right on a vertical part). */
function sideOffset(side: LabelSide, horizontal: boolean): string {
  if (side === "on") return "translate(-50%, -50%)";
  if (horizontal) return side === "above" ? "translate(-50%, calc(-100% - 4px))" : "translate(-50%, 4px)";
  return side === "above" ? "translate(calc(-100% - 6px), -50%)" : "translate(6px, -50%)";
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
