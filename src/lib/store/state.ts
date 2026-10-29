// The open flowchart (`board`), the editor UI state (`ui`), and what is derived from them.

import { createMemo, createRoot, createSignal } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { activations, type Span } from "../sequence";
import type { Camera, EdgeStyle, FlowDoc, FlowNode, NodeKind } from "../types";
import { emptyFlow } from "./nodes";

// ---------- state ----------

export const [board, setBoard] = createStore<FlowDoc>(emptyFlow());

/** `line` draws a connector that does not need a node at either end. */
export type Tool = "select" | "line" | NodeKind;

/** Arrowheads when an edge leaves them unset */
export const DEFAULT_CAPS = { start: "none", end: "arrow" } as const;

export interface UiState {
  tool: Tool;
  selected: string[];
  selectedEdge: string | null;
  editingNode: string | null;
  editingEdge: string | null;
  /** Lane whose title is being edited */
  editingLane: string | null;
  /** Attribute or operation of a UML class being edited; with `insert` a new row at `index` */
  editingRow: { node: string; part: number; index: number; insert?: boolean } | null;
  /** While dragging: the frame the dragged blocks will belong to when dropped */
  dropTarget: string | null;
  /** Style for new edges: the last one picked in the context bar */
  edgeStyle: EdgeStyle;
  spaceDown: boolean;
  panning: boolean;
  dragging: boolean;
  /** The edge being drawn from a handle (world coordinates) */
  connecting: { from: string; x: number; y: number; target: string | null } | null;
  /** Selection rectangle (world coordinates) */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
}

export const [ui, setUi] = createStore<UiState>({
  tool: "select",
  selected: [],
  selectedEdge: null,
  editingNode: null,
  editingEdge: null,
  editingLane: null,
  editingRow: null,
  dropTarget: null,
  edgeStyle: "curved",
  spaceDown: false,
  panning: false,
  dragging: false,
  connecting: null,
  marquee: null,
});

/** @internal Derived values, for the store files */
export const derived = createRoot(() => ({
  selectedSet: createMemo(() => new Set(ui.selected)),
  nodeMap: createMemo(() => new Map(board.nodes.map((n) => [n.id, n]))),
  /** Activation bars of every lifeline, from the messages (see sequence.ts) */
  bars: createMemo(() => activations(board.nodes, board.edges)),
}));

const NO_BARS: Span[] = [];
export const activationsOf = (id: string) => derived.bars().get(id) ?? NO_BARS;

export const isSelected = (id: string) => derived.selectedSet().has(id);
export const nodeById = (id: string): FlowNode | undefined => derived.nodeMap().get(id);
export const selectedNodes = () => board.nodes.filter((n) => derived.selectedSet().has(n.id));

/** Increments on every change; workspace.ts watches it for autosave. */
const [rev, setRev] = createSignal(0);
export { rev };
/** @internal Marks the board as changed (autosave), for the store files */
export const touch = () => setRev((r) => r + 1);

/** Plain copy without Solid proxies, ready to send to the backend. */
export const boardSnapshot = (): FlowDoc => JSON.parse(JSON.stringify(unwrap(board)));

export function setCamera(c: Partial<Camera>) {
  setBoard("camera", c);
  touch();
}
