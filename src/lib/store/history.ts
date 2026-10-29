// Undo / redo: snapshots of the nodes and edges.

import { batch, createSignal } from "solid-js";
import { reconcile, unwrap } from "solid-js/store";
import type { FlowEdge, FlowNode } from "../types";
import { board, setBoard, setUi, touch, ui } from "./state";

// ---------- undo / redo ----------

interface Snapshot {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];
const [histRev, setHistRev] = createSignal(0);

export const canUndo = () => (histRev(), undoStack.length > 0);
export const canRedo = () => (histRev(), redoStack.length > 0);

const takeSnapshot = (): Snapshot =>
  JSON.parse(JSON.stringify({ nodes: unwrap(board.nodes), edges: unwrap(board.edges) }));

/** Call before a change that should be undoable. */
export function checkpoint() {
  undoStack.push(takeSnapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}

function restore(s: Snapshot) {
  batch(() => {
    setBoard("nodes", reconcile(s.nodes, { key: "id" }));
    setBoard("edges", reconcile(s.edges, { key: "id" }));
    const ids = new Set(s.nodes.map((n) => n.id));
    setUi("selected", (sel) => sel.filter((id) => ids.has(id)));
    if (ui.selectedEdge && !s.edges.some((e) => e.id === ui.selectedEdge)) setUi("selectedEdge", null);
    setUi({ editingNode: null, editingEdge: null, editingLane: null, editingRow: null });
  });
  setHistRev((v) => v + 1);
  touch();
}

export function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(takeSnapshot());
  restore(s);
}

export function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(takeSnapshot());
  restore(s);
}

/** @internal Used when a flowchart is opened */
export function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}
