// Node kinds and sizes, and making new nodes. No state here.

import type { FlowDoc, FlowNode, Lane, NodeColor, NodeKind } from "../types";

export const uid = (): string =>
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

export const SIZES: Record<NodeKind, { w: number; h: number }> = {
  // Multiples of 20, so the center also lands on the grid
  box: { w: 180, h: 60 },
  diamond: { w: 180, h: 120 },
  note: { w: 180, h: 140 },
  pill: { w: 160, h: 60 },
  label: { w: 160, h: 40 },
  start: { w: 40, h: 40 },
  end: { w: 40, h: 40 },
  section: { w: 480, h: 320 },
  lanes: { w: 720, h: 480 },
  // UML
  bar: { w: 160, h: 8 },
  flowfinal: { w: 40, h: 40 },
  object: { w: 160, h: 60 },
  pin: { w: 14, h: 14 },
  sendsignal: { w: 180, h: 60 },
  receivesignal: { w: 180, h: 60 },
  timeevent: { w: 60, h: 80 },
  circle: { w: 40, h: 40 },
  comment: { w: 180, h: 100 },
  actor: { w: 60, h: 100 },
  usecase: { w: 180, h: 80 },
  boundary: { w: 480, h: 360 },
  class: { w: 200, h: 140 },
  package: { w: 360, h: 260 },
  lifeline: { w: 140, h: 400 },
  activation: { w: 16, h: 120 },
  fragment: { w: 480, h: 240 },
  destroy: { w: 30, h: 30 },
  // Content
  image: { w: 240, h: 160 },
  icon: { w: 60, h: 60 },
  chart: { w: 320, h: 200 },
  topic: { w: 160, h: 48 },
};

/** Smallest size when resizing. Bars and activations are thin on purpose. */
export function minSize(kind: NodeKind) {
  if (kind === "bar") return { w: 20, h: 4 };
  if (kind === "activation") return { w: 8, h: 30 };
  return { w: 30, h: 30 };
}
export const MIN_LANE = 60;
/** @internal Width of a new lane, for the store files */
export const LANE_SIZE = 240;

const CONTAINERS: NodeKind[] = ["section", "lanes", "boundary", "package", "fragment"];
const NO_TEXT: NodeKind[] = ["start", "end", "bar", "flowfinal", "activation", "destroy", "pin", "image", "icon", "chart"];

/** Frames (sections, swimlanes, ...): drawn behind everything, and they carry the nodes inside them along. */
export const isContainer = (kind: NodeKind) => CONTAINERS.includes(kind);
/** Can have arrows to and from it. */
export const isConnectable = (kind: NodeKind) => !isContainer(kind) && kind !== "label" && kind !== "note";
export const hasText = (kind: NodeKind) => !NO_TEXT.includes(kind);
export const isResizable = (kind: NodeKind) => kind !== "start" && kind !== "end" && kind !== "pin";

const DEFAULT_COLOR: Record<NodeKind, NodeColor> = {
  box: "white",
  diamond: "blue",
  note: "yellow",
  pill: "green",
  label: "white",
  start: "white",
  end: "white",
  section: "white",
  lanes: "white",
  bar: "white",
  flowfinal: "white",
  object: "white",
  pin: "white",
  sendsignal: "white",
  receivesignal: "white",
  timeevent: "white",
  circle: "white",
  comment: "white",
  actor: "white",
  usecase: "white",
  boundary: "white",
  class: "white",
  package: "white",
  lifeline: "white",
  activation: "white",
  fragment: "white",
  destroy: "white",
  image: "white",
  icon: "white",
  chart: "white",
  topic: "white",
};

/** Text a new node starts with, so it shows how the shape is meant to be filled in. */
const DEFAULT_TEXT: Partial<Record<NodeKind, string>> = {
  class: "ClassName\n--\n+ attribute: Type\n--\n+ operation()",
  fragment: "alt",
  circle: "A",
};

/** Creates a node centered on (cx, cy) in world coordinates. */
export function createNode(kind: NodeKind, cx: number, cy: number, partial?: Partial<FlowNode>): FlowNode {
  const { w, h } = SIZES[kind];
  // A pin snaps with its center, so it can sit exactly on the border of a block
  if (kind === "pin") [cx, cy] = [snap(cx), snap(cy)];
  const lanes: Lane[] | undefined =
    kind === "lanes" ? Array.from({ length: w / LANE_SIZE }, () => ({ id: uid(), title: "", size: LANE_SIZE })) : undefined;
  return {
    ...(lanes && { lanes }),
    id: uid(),
    kind,
    x: snap(cx - w / 2),
    y: snap(cy - h / 2),
    w,
    h,
    text: DEFAULT_TEXT[kind] ?? "",
    color: DEFAULT_COLOR[kind],
    ...partial,
  };
}

/** Example flowchart for the first project. */
export function starterFlow(): FlowDoc {
  const start = createNode("pill", 0, 0, { text: "Start" });
  const idea = createNode("box", 0, 130, { text: "Work out the idea" });
  const check = createNode("diamond", 0, 280, { text: "Approved?" });
  const build = createNode("box", 0, 440, { text: "Build it" });
  const feedback = createNode("box", 300, 280, { text: "Process feedback", color: "pink" });
  const note = createNode("note", -320, 140, {
    text: "Double-click to edit text.\nDrag from a dot to connect.",
  });
  return {
    nodes: [start, idea, check, build, feedback, note],
    edges: [
      { id: uid(), from: start.id, to: idea.id },
      { id: uid(), from: idea.id, to: check.id },
      { id: uid(), from: check.id, to: build.id, label: "Yes" },
      { id: uid(), from: check.id, to: feedback.id, label: "No" },
      { id: uid(), from: feedback.id, to: idea.id },
    ],
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

export function emptyFlow(): FlowDoc {
  return { nodes: [], edges: [], camera: { x: 0, y: 0, zoom: 1 } };
}
