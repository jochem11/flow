// Edges: connecting, line style, free ends, labels, and messages in sequence diagrams.

import { batch } from "solid-js";
import { containsPt, edgeGeom, type EdgeGeom, type Pt, type Shape } from "../geometry";
import { analyze, messageLine, messageYAt, SEQUENCE_KINDS } from "../sequence";
import type { FlowEdge } from "../types";
import { checkpoint } from "./history";
import { isContainer, uid } from "./nodes";
import { board, derived, nodeById, setBoard, setUi, touch, ui } from "./state";

/**
 * The free ends of lines that lie inside the given frames: they move along with
 * the frame. As `[edge, end, x, y]` at their current position.
 */
export function freeEndsIn(ids: Set<string>): [string, "from" | "to", number, number][] {
  const frames = board.nodes.filter((n) => ids.has(n.id) && isContainer(n.kind));
  if (!frames.length) return [];
  const out: [string, "from" | "to", number, number][] = [];
  for (const e of board.edges) {
    for (const [end, p] of [["from", e.fromPoint], ["to", e.toPoint]] as const) {
      if (p && frames.some((f) => containsPt(f, p))) out.push([e.id, end, p.x, p.y]);
    }
  }
  return out;
}

/** Moves free line ends (from `freeEndsIn`) by dx, dy. No checkpoint. */
export function moveFreeEnds(ends: [string, "from" | "to", number, number][], dx: number, dy: number) {
  batch(() => {
    for (const [id, end, x, y] of ends) {
      setBoard("edges", (e) => e.id === id, end === "from" ? "fromPoint" : "toPoint", { x: x + dx, y: y + dy });
    }
  });
}

/**
 * Adds an edge. A second edge between the same two nodes is ignored, unless it
 * is attached at fixed points (`extra.fromAngle`), like messages in a sequence diagram.
 */
export function connect(from: string, to: string, extra?: Partial<FlowEdge>) {
  // Edges at fixed points (like messages) may repeat and may loop back to the same node
  const fixed = extra?.fromAngle != null || extra?.messageY != null;
  if (from === to && !fixed) return;
  if (!fixed && board.edges.some((e) => e.from === from && e.to === to)) return;
  checkpoint();
  const id = uid();
  setBoard("edges", (es) => [...es, { id, from, to, style: ui.edgeStyle, ...umlDefaults(from, to), ...extra }]);
  if (extra?.messageY != null) styleIfReturn(id);
  touch();
}

/**
 * A class uses another (picked as a type in the class panel): draws the line
 * between them when there is none yet, so the diagram shows it. An attribute is
 * an association (with its multiplicity: `*` for a list or set, `0..1` when
 * optional), a parameter or return type a dependency (dashed).
 */
export function ensureRelation(from: string, to: string, use: "attribute" | "operation", type = "") {
  if (from === to) return;
  if (board.edges.some((e) => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return;
  if (use === "operation") return connect(from, to, { pattern: "dashed", endCap: "open" });
  const many = /^(List|Set)</.test(type) || /^Map</.test(type);
  const optional = type.trim().endsWith("?");
  connect(from, to, { endCap: "open", ...(many ? { endLabel: "*" } : optional ? { endLabel: "0..1" } : {}) });
}

/** Between two UML classes a new line is an association: an open arrow, not a flowchart arrow. */
export function umlDefaults(from: string, to: string): Partial<FlowEdge> {
  return nodeById(from)?.kind === "class" && nodeById(to)?.kind === "class" ? { endCap: "open" } : {};
}

/**
 * A new message that answers an earlier call gets the UML look of a return:
 * dashed, with an open arrowhead. Only when no line style was picked yet. No checkpoint.
 */
export function styleIfReturn(id: string) {
  const edge = board.edges.find((e) => e.id === id);
  if (!edge || edge.pattern != null || !analyze(board.nodes, board.edges).returns.has(id)) return;
  setBoard("edges", (e) => e.id === id, { pattern: "dashed", endCap: "open" });
  touch();
}

type EdgeProps = Partial<
  Pick<FlowEdge, "style" | "pattern" | "startCap" | "endCap" | "labelSide" | "label" | "startLabel" | "endLabel">
>;

/** Connector style, line pattern, arrowheads and label side. Picking a style also makes it the default for new edges. */
export function setEdgeProps(id: string, props: EdgeProps, undoable = true) {
  if (!board.edges.some((e) => e.id === id)) return;
  if (undoable) checkpoint();
  setBoard("edges", (e) => e.id === id, props);
  if (props.style) setUi("edgeStyle", props.style);
  touch();
}

/**
 * What both ends of an edge are attached to: a node, or (for a free end) a
 * zero-size shape at its point. `null` when an end's node no longer exists.
 */
export function edgeEnds(edge: FlowEdge): [Shape, Shape] | null {
  const resolve = (node: string, point: Pt | null | undefined): Shape | undefined =>
    point ? { x: point.x, y: point.y, w: 0, h: 0 } : nodeById(node);
  const a = resolve(edge.from, edge.fromPoint);
  const b = resolve(edge.to, edge.toPoint);
  return a && b ? [a, b] : null;
}

/** The line of an edge: a message in a sequence diagram, or a regular connector. */
export function edgeLine(edge: FlowEdge): EdgeGeom | null {
  if (edge.messageY != null) {
    const a = nodeById(edge.from);
    const b = nodeById(edge.to);
    if (a && b) return messageLine(edge, a, b, derived.bars());
  }
  const ends = edgeEnds(edge);
  if (!ends) return null;
  // A right-angle line goes around the other blocks (not frames: lines run inside those)
  const obstacles =
    edge.style === "elbow" && !edge.bend
      ? board.nodes.filter((n) => n.id !== edge.from && n.id !== edge.to && !isContainer(n.kind))
      : [];
  return edgeGeom(edge, ...ends, obstacles);
}

/** Is this edge between two lifelines (or activations), so it should be a message? */
export function isBetweenLifelines(edge: FlowEdge): boolean {
  const a = nodeById(edge.from);
  const b = nodeById(edge.to);
  return !!a && !!b && !edge.fromPoint && !edge.toPoint && SEQUENCE_KINDS.has(a.kind) && SEQUENCE_KINDS.has(b.kind);
}

/**
 * Turns an edge between lifelines into a message at world height `y`: a horizontal
 * line, which gives the lifelines their activation bars. No checkpoint.
 */
export function makeMessage(id: string, y: number) {
  const edge = board.edges.find((e) => e.id === id);
  const from = edge && nodeById(edge.from);
  if (!from) return;
  setBoard("edges", (e) => e.id === id, {
    messageY: messageYAt(from, y),
    style: "straight",
    fromAngle: undefined,
    toAngle: undefined,
  });
  touch();
}

/** Moves the middle of a line (see `Edge.bend`), or `undefined` for its normal route. No checkpoint. */
export function setBend(id: string, bend: Pt | undefined) {
  setBoard("edges", (e) => e.id === id, "bend", bend);
  touch();
}

/** Moves a message up or down (height below its `from` node), or `undefined` to make it a regular edge. */
export function setMessageY(id: string, messageY: number | undefined) {
  setBoard("edges", (e) => e.id === id, "messageY", messageY);
  touch();
}

export const isFreeEnd = (edge: FlowEdge, end: "from" | "to") => !!(end === "from" ? edge.fromPoint : edge.toPoint);

/**
 * Attaches one end of an edge to a node at an angle on its outline (see `portAt`),
 * or `null` to pick the side automatically. Called while dragging, so no checkpoint here.
 */
export function setEdgeEnd(id: string, end: "from" | "to", node: string, angle: number | null) {
  setBoard(
    "edges",
    (e) => e.id === id,
    end === "from"
      ? { from: node, fromAngle: angle, fromPoint: undefined }
      : { to: node, toAngle: angle, toPoint: undefined },
  );
  touch();
}

/** Detaches one end of an edge and puts it at a point on the canvas. No checkpoint (dragging). */
export function setFreeEnd(id: string, end: "from" | "to", p: Pt) {
  const point = { x: p.x, y: p.y };
  // A free end is no longer a message between lifelines
  setBoard(
    "edges",
    (e) => e.id === id,
    end === "from"
      ? { from: "", fromAngle: undefined, fromPoint: point, messageY: undefined }
      : { to: "", toAngle: undefined, toPoint: point, messageY: undefined },
  );
  touch();
}

/** A new connector from the line tool. The caller takes the checkpoint. */
export function addEdge(edge: FlowEdge) {
  setBoard("edges", (es) => [...es, edge]);
  touch();
}

/** Removes an edge without a checkpoint (e.g. a line that was drawn without moving). */
export function dropEdge(id: string) {
  setBoard("edges", (es) => es.filter((e) => e.id !== id));
  if (ui.selectedEdge === id) setUi("selectedEdge", null);
  touch();
}

/** Text at one end of an edge, while typing: the caller takes the checkpoint (once, on focus). */
export function setEndLabel(id: string, end: "start" | "end", text: string) {
  setBoard("edges", (e) => e.id === id, end === "start" ? "startLabel" : "endLabel", text.trim() || undefined);
  touch();
}

/** Where the label sits along the edge, 0..1. Called while dragging, so no checkpoint here. */
export function setLabelPos(id: string, t: number) {
  setBoard("edges", (e) => e.id === id, "labelPos", t);
  touch();
}

/** The line whose label is being typed live (its undo checkpoint is taken) */
let liveLabelOf: string | null = null;

/** Finishes editing a line's label. */
export function setEdgeLabel(id: string, label: string) {
  const live = liveLabelOf === id;
  liveLabelOf = null;
  const edge = board.edges.find((e) => e.id === id);
  const value = label.trim() || undefined;
  if (!edge || (edge.label ?? undefined) === value) return;
  if (!live) checkpoint();
  setBoard("edges", (e) => e.id === id, "label", value);
  touch();
}

/** Typing a line's label: on the board with every key (saved, and seen by others). One undo step. */
export function setEdgeLabelLive(id: string, label: string) {
  const edge = board.edges.find((e) => e.id === id);
  const value = label || undefined;
  if (!edge || (edge.label ?? undefined) === value) return;
  if (liveLabelOf !== id) {
    checkpoint();
    liveLabelOf = id;
  }
  setBoard("edges", (e) => e.id === id, "label", value);
  touch();
}
