// All drag interactions on the canvas. Pattern: pointerdown starts the gesture,
// then move/up are tracked on window so it keeps working when the cursor leaves the element.

import { panBy, toWorld } from "./camera";
import type { FlowEdge } from "./types";
import { angleAt, containsRect, intersects, nearestT, normRect, pickSides, type EdgeGeom, type Pt } from "./geometry";
import {
  addConnectedNode,
  addEdge,
  board,
  checkpoint,
  clearSelection,
  GRID,
  connect,
  createNode,
  dropEdge,
  isBetweenLifelines,
  isConnectable,
  makeMessage,
  isContainer,
  minSize,
  moveNodesTo,
  nodeById,
  resizeLane,
  resizeNode,
  selectEdge,
  setEdgeEnd,
  setFreeEnd,
  setBend,
  setEdgeProps,
  setMessageY,
  umlDefaults,
  styleIfReturn,
  setLabelPos,
  setUi,
  snap,
  uid,
  ui,
  assignParents,
  frameAt,
  freeEndsIn,
  moveFreeEnds,
  refreshFrame,
  updateFrames,
  withContents,
} from "./store";
import { messageYAt, SELF_H, SEQUENCE_KINDS } from "./sequence";

const DRAG_THRESHOLD = 3;

export function trackPointer(
  down: PointerEvent,
  move: (ev: PointerEvent) => void,
  up?: (ev: PointerEvent) => void,
) {
  const id = down.pointerId;
  const onMove = (ev: PointerEvent) => ev.pointerId === id && move(ev);
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    up?.(ev);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

const movedEnough = (a: PointerEvent, b: PointerEvent) =>
  Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) >= DRAG_THRESHOLD;

/** Closes an open text field (blur => commit). */
export function blurActive() {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body) el.blur();
}

/** The node under the pointer that an edge can connect to. */
export function nodeAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  const id = el?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
  const n = id ? nodeById(id) : undefined;
  if (n && isConnectable(n.kind)) return n.id;
  return lifelineNear(toWorld(clientX, clientY))?.id ?? null;
}

/** How close (screen pixels) to the dashed line of a lifeline still counts as on it */
const LIFELINE_REACH = 24;

/** The lifeline whose dashed line is closest to `p`, if it is within reach: the line itself is thin. */
function lifelineNear(p: Pt) {
  let best: { id: string } | undefined;
  let bestDist = LIFELINE_REACH / board.camera.zoom;
  for (const n of board.nodes) {
    if (n.kind !== "lifeline" || p.y < n.y || p.y > n.y + n.h) continue;
    const dist = Math.abs(p.x - (n.x + n.w / 2));
    if (dist < bestDist) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
}

export function beginPan(e: PointerEvent) {
  let last = { x: e.clientX, y: e.clientY };
  setUi("panning", true);
  trackPointer(
    e,
    (ev) => {
      panBy(ev.clientX - last.x, ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY };
    },
    () => setUi("panning", false),
  );
}

/**
 * Drags all selected nodes, plus whatever lies inside a selected section or swimlane.
 * The grabbed node snaps to the grid (hold Alt to move freely).
 */
export function beginNodeDrag(e: PointerEvent, grabbedId: string) {
  const start = toWorld(e.clientX, e.clientY);
  const moving = withContents(ui.selected);
  const origin = new Map(board.nodes.filter((n) => moving.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
  // Lines drawn freely inside a moving section come along
  const freeEnds = freeEndsIn(moving);
  const grabbed = origin.get(grabbedId);
  // A pin snaps with its center (see createNode), everything else with its top-left corner
  const grabbedNode = nodeById(grabbedId);
  const snapOffset = grabbedNode?.kind === "pin" ? grabbedNode.w / 2 : 0;
  if (!grabbed) return;
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const w = toWorld(ev.clientX, ev.clientY);
      let dx = w.x - start.x;
      let dy = w.y - start.y;
      if (!ev.altKey) {
        dx = snap(grabbed.x + snapOffset + dx) - grabbed.x - snapOffset;
        dy = snap(grabbed.y + snapOffset + dy) - grabbed.y - snapOffset;
      }
      const pos = new Map<string, { x: number; y: number }>();
      for (const [id, o] of origin) pos.set(id, { x: o.x + dx, y: o.y + dy });
      moveNodesTo(pos);
      moveFreeEnds(freeEnds, dx, dy);
      // Show which frame the grabbed block lands in
      setUi("dropTarget", grabbedNode ? (frameAt(grabbedNode, moving)?.id ?? null) : null);
    },
    () => {
      setUi({ dragging: false, dropTarget: null });
      // Dropped in (or out of) a section: it belongs there now
      if (started) assignParents(ui.selected);
    },
  );
}

export function beginResize(e: PointerEvent, id: string) {
  const n = nodeById(id);
  if (!n) return;
  const start = toWorld(e.clientX, e.clientY);
  const w0 = n.w;
  const h0 = n.h;
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const w = toWorld(ev.clientX, ev.clientY);
      const round = ev.altKey ? (v: number) => v : snap;
      const min = minSize(n.kind);
      // Thin shapes are not snapped, the grid would make them disappear
      const roundW = n.w < GRID * 2 ? (v: number) => v : round;
      const roundH = n.h < GRID * 2 ? (v: number) => v : round;
      resizeNode(id, Math.max(min.w, roundW(w0 + w.x - start.x)), Math.max(min.h, roundH(h0 + w.y - start.y)));
    },
    () => {
      setUi("dragging", false);
      if (started) updateFrames([id]);
    },
  );
}

/** Drags the border right of a lane to change its width. */
export function beginLaneResize(e: PointerEvent, id: string, index: number) {
  const size0 = nodeById(id)?.lanes?.[index]?.size;
  if (size0 === undefined) return;
  const start = toWorld(e.clientX, e.clientY);
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const w = toWorld(ev.clientX, ev.clientY);
      const round = ev.altKey ? (v: number) => v : snap;
      resizeLane(id, index, round(size0 + w.x - start.x));
    },
    () => {
      setUi("dragging", false);
      if (started) refreshFrame(id);
    },
  );
}

/** Slides an edge label along its line. It clicks into the middle when it gets close. */
export function beginLabelDrag(e: PointerEvent, id: string, geom: () => EdgeGeom | null) {
  let started = false;

  trackPointer(
    e,
    (ev) => {
      const g = geom();
      if (!g) return;
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const t = nearestT(g.points, toWorld(ev.clientX, ev.clientY));
      setLabelPos(id, Math.abs(t - 0.5) < 0.03 ? 0.5 : Math.round(t * 1000) / 1000);
    },
    () => setUi("dragging", false),
  );
}

/** Snaps to the middles of the sides and the corners (every 45°) when within a few degrees. */
function snapAngle(a: number): number {
  const nearest = Math.round(a / 45) * 45;
  return Math.abs(a - nearest) < 6 ? nearest % 360 : Math.round(a);
}

const snapPt = (p: Pt, free: boolean): Pt => (free ? p : { x: snap(p.x), y: snap(p.y) });

/**
 * Puts one end of an edge under the pointer: on the node there, or free on the
 * canvas. With `pin` the end is fixed at the spot on the outline it points at
 * (snapping to sides and corners), otherwise the side is picked automatically.
 * Over the node at the other end, the edge becomes a loop back to it (a self-message).
 */
function placeEnd(ev: PointerEvent, id: string, end: "from" | "to", pin: boolean, messageAt?: number) {
  const w = toWorld(ev.clientX, ev.clientY);
  const node = nodeById(nodeAt(ev.clientX, ev.clientY) ?? "");
  if (!node) {
    setFreeEnd(id, end, snapPt(w, ev.altKey));
    return;
  }
  const angle = angleAt(node, w);
  setEdgeEnd(id, end, node.id, pin ? (ev.altKey ? Math.round(angle) : snapAngle(angle)) : null);

  // Between two lifelines it is a message: a horizontal line, right away while
  // dragging, at `messageAt` (where a new line started) or at the pointer
  const edge = board.edges.find((x) => x.id === id);
  if (edge && isBetweenLifelines(edge)) makeMessage(id, messageAt ?? (ev.altKey ? w.y : snap(w.y)));
  else if (edge?.messageY != null) setMessageY(id, undefined);
}

/**
 * Drags one end of an edge: around the outline of its node, onto another node,
 * or off into empty space. Hold Alt to turn off snapping.
 */
export function beginEndDrag(e: PointerEvent, id: string, end: "from" | "to") {
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      placeEnd(ev, id, end, true);
    },
    () => setUi("dragging", false),
  );
}

/**
 * The line tool: draws a connector from where the pointer goes down to where it
 * is released. Either end attaches to a node when it is on one, and stays free otherwise.
 */
export function beginLine(e: PointerEvent) {
  const start = toWorld(e.clientX, e.clientY);
  const startNode = nodeAt(e.clientX, e.clientY);
  let id: string | null = null;

  trackPointer(
    e,
    (ev) => {
      if (!id) {
        if (!movedEnough(e, ev)) return;
        checkpoint();
        id = uid();
        const from = startNode ? { from: startNode } : { from: "", fromPoint: snapPt(start, ev.altKey) };
        addEdge({ id, to: "", toPoint: start, style: ui.edgeStyle, ...from });
        setUi("dragging", true);
      }
      placeEnd(ev, id, "to", false, snap(start.y));
    },
    () => {
      setUi({ dragging: false, tool: "select" });
      const edge = id ? board.edges.find((x) => x.id === id) : undefined;
      if (!edge) return;
      // Between lifelines it is a message, at the height where it started
      if (isBetweenLifelines(edge)) {
        makeMessage(edge.id, snap(start.y));
        styleIfReturn(edge.id);
        selectEdge(edge.id);
        return;
      }
      if (edge.endCap == null && edge.from && edge.to) setEdgeProps(edge.id, umlDefaults(edge.from, edge.to), false);
      // Back onto the node it started from, or no length at all: not a line
      const a = edge.fromPoint;
      const b = edge.toPoint;
      if ((edge.from && edge.from === edge.to) || (a && b && a.x === b.x && a.y === b.y)) dropEdge(edge.id);
      else selectEdge(edge.id);
    },
  );
}

/** Drags a message up or down its lifelines. */
function beginMessageMove(e: PointerEvent, id: string, messageY: number) {
  const start = toWorld(e.clientX, e.clientY);
  let started = false;

  trackPointer(
    e,
    (ev) => {
      const edge = board.edges.find((x) => x.id === id);
      const from = edge && nodeById(edge.from);
      if (!from) return;
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const y = from.y + messageY + toWorld(ev.clientX, ev.clientY).y - start.y;
      setMessageY(id, messageYAt(from, ev.altKey ? y : snap(y)));
    },
    () => setUi("dragging", false),
  );
}

/** Drags the middle of a line to another spot; its ends stay where they are attached. */
function beginBendDrag(e: PointerEvent, id: string, bend0: Pt) {
  const start = toWorld(e.clientX, e.clientY);
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const w = toWorld(ev.clientX, ev.clientY);
      const round = ev.altKey ? (v: number) => v : snap;
      setBend(id, { x: round(bend0.x + w.x - start.x), y: round(bend0.y + w.y - start.y) });
    },
    () => setUi("dragging", false),
  );
}

/**
 * Drags a whole edge by its line: a message moves up or down; a line with free
 * ends moves those ends along; a line attached at both ends changes its route.
 */
export function beginEdgeMove(e: PointerEvent, id: string) {
  const edge = board.edges.find((x) => x.id === id);
  if (edge?.messageY != null) {
    beginMessageMove(e, id, edge.messageY);
    return;
  }
  // A loop back to the same node keeps its shape
  if (edge && !edge.fromPoint && !edge.toPoint && edge.from !== edge.to) {
    // A copy: the store merges updates into the stored object, so the start would move along
    beginBendDrag(e, id, { x: edge.bend?.x ?? 0, y: edge.bend?.y ?? 0 });
    return;
  }
  const from0 = edge?.fromPoint ? { ...edge.fromPoint } : null;
  const to0 = edge?.toPoint ? { ...edge.toPoint } : null;
  const ref = from0 ?? to0;
  if (!ref) return;
  const start = toWorld(e.clientX, e.clientY);
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const w = toWorld(ev.clientX, ev.clientY);
      let dx = w.x - start.x;
      let dy = w.y - start.y;
      if (!ev.altKey) {
        dx = snap(ref.x + dx) - ref.x;
        dy = snap(ref.y + dy) - ref.y;
      }
      if (from0) setFreeEnd(id, "from", { x: from0.x + dx, y: from0.y + dy });
      if (to0) setFreeEnd(id, "to", { x: to0.x + dx, y: to0.y + dy });
    },
    () => setUi("dragging", false),
  );
}


/**
 * Between two lifelines (or activations) a message is a horizontal line at the
 * height where it was dropped, attached at fixed points so it stays there.
 */
function sequenceMessage(fromId: string, toId: string, y: number): Partial<FlowEdge> | undefined {
  const a = nodeById(fromId);
  const b = nodeById(toId);
  if (!a || !b || !SEQUENCE_KINDS.has(a.kind) || !SEQUENCE_KINDS.has(b.kind)) return undefined;
  return { style: "straight", messageY: messageYAt(a, snap(y)) };
}

/** A self-message on a lifeline or activation: out of the right side at `y`, back in a bit lower. */
function selfMessage(id: string, y: number): Partial<FlowEdge> | undefined {
  const n = nodeById(id);
  if (!n || !SEQUENCE_KINDS.has(n.kind)) return undefined;
  return { style: "straight", messageY: Math.min(n.h - SELF_H - 1, messageYAt(n, snap(y))) };
}

/**
 * Draws an edge from a node. Releasing on another node connects them;
 * releasing on empty space creates a new block there.
 */
export function beginConnect(e: PointerEvent, fromId: string) {
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
      }
      const w = toWorld(ev.clientX, ev.clientY);
      const hit = nodeAt(ev.clientX, ev.clientY);
      setUi("connecting", { from: fromId, x: w.x, y: w.y, target: hit && hit !== fromId ? hit : null });
    },
    (ev) => {
      const c = ui.connecting;
      setUi("connecting", null);
      if (!started || !c) return;
      const dropY = toWorld(ev.clientX, ev.clientY).y;
      if (c.target) {
        connect(fromId, c.target, sequenceMessage(fromId, c.target, dropY));
        return;
      }
      // Released on the lifeline it started from: a message to itself
      if (nodeAt(ev.clientX, ev.clientY) === fromId) {
        const self = selfMessage(fromId, dropY);
        if (self) connect(fromId, fromId, self);
        return;
      }
      const src = nodeById(fromId);
      if (!src) return;
      const w = toWorld(ev.clientX, ev.clientY);
      // From a lifeline into empty space: a new lifeline there, with the message to it
      if (SEQUENCE_KINDS.has(src.kind)) {
        const top = src.kind === "lifeline" ? src : { y: dropY - 100, h: 400 };
        const node = createNode("lifeline", w.x, 0, { y: top.y, h: top.h });
        addConnectedNode(node, fromId, { style: "straight", messageY: messageYAt(src, snap(dropY)) });
        setUi("editingNode", node.id);
        return;
      }
      // Place the new block so the edge arrives where the pointer was released.
      // Out of a UML class comes a new class, joined by an association.
      const kind = src.kind === "class" ? "class" : "box";
      const probe = createNode(kind, w.x, w.y);
      const [, side] = pickSides(src, { x: w.x, y: w.y, w: 0, h: 0 });
      const off = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] }[side];
      const node = createNode(kind, w.x + (off[0] * probe.w) / 2, w.y + (off[1] * probe.h) / 2);
      addConnectedNode(node, fromId, kind === "class" ? { endCap: "open" } : undefined);
      setUi("editingNode", node.id);
    },
  );
}

/** Selection rectangle on the empty canvas. Shift adds to the selection. */
export function beginMarquee(e: PointerEvent) {
  const additive = e.shiftKey;
  const base = additive ? [...ui.selected] : [];
  if (!additive) clearSelection();
  const w0 = toWorld(e.clientX, e.clientY);
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
      }
      const w = toWorld(ev.clientX, ev.clientY);
      setUi("marquee", { x0: w0.x, y0: w0.y, x1: w.x, y1: w.y });
      const r = normRect(w0.x, w0.y, w.x, w.y);
      // Sections and swimlanes only when they are completely inside the rectangle,
      // otherwise every selection inside one would select it too
      const hits = board.nodes
        .filter((n) => (isContainer(n.kind) ? containsRect(r, n) : intersects(n, r)))
        .map((n) => n.id);
      setUi({ selected: additive ? [...new Set([...base, ...hits])] : hits, selectedEdge: null });
    },
    () => setUi("marquee", null),
  );
}
