// Selection and the other edits: adding, moving, deleting, duplicating, opening a flowchart.

import { batch } from "solid-js";
import { produce, reconcile, unwrap } from "solid-js/store";
import { portAt } from "../geometry";
import type { CodeImport, FlowDoc, FlowEdge, FlowNode, NodeColor, Position } from "../types";
import { freeEndsIn, isBetweenLifelines, makeMessage, moveFreeEnds } from "./edges";
import { assignParents, updateFrames, withContents } from "./frames";
import { checkpoint, resetHistory } from "./history";
import { isContainer, uid } from "./nodes";
import { board, derived, nodeById, setBoard, setUi, touch, ui } from "./state";

// ---------- selection ----------

export function select(ids: string[]) {
  setUi({ selected: ids, selectedEdge: null });
}

export function toggleSelect(id: string) {
  setUi("selected", (s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  setUi("selectedEdge", null);
}

export function selectEdge(id: string) {
  setUi({ selected: [], selectedEdge: id });
}

export function clearSelection() {
  setUi({ selected: [], selectedEdge: null });
}

export function selectAll() {
  select(board.nodes.map((n) => n.id));
}

// ---------- mutations ----------

export function addNode(node: FlowNode) {
  checkpoint();
  setBoard("nodes", (ns) => [...ns, node]);
  // Added inside a section: it belongs to it. A new frame takes in what it covers.
  updateFrames([node.id]);
  select([node.id]);
  touch();
}

/**
 * Classes read from code (`api.importCode`), added to the right of the board in
 * a new frame as one undo step: a package with the package's name when the code
 * has one (so the code export puts them in it again), else a section.
 */
export function insertClasses(imp: CodeImport, title: string): FlowNode | null {
  if (!imp.nodes.length) return null;
  const right = board.nodes.length ? Math.max(...board.nodes.map((n) => n.x + n.w)) + 120 : 0;
  const top = board.nodes.length ? Math.min(...board.nodes.map((n) => n.y)) : 0;
  const w = Math.max(...imp.nodes.map((n) => n.x + n.w));
  const h = Math.max(...imp.nodes.map((n) => n.y + n.h));
  const frame: FlowNode = {
    id: uid(),
    kind: imp.package ? "package" : "section",
    x: right,
    y: top,
    w: w + 80,
    h: h + 100,
    text: imp.package ?? title,
    color: "white",
  };
  const nodes = imp.nodes.map((n) => ({ ...n, x: right + 40 + n.x, y: top + 60 + n.y, parent: frame.id }));
  checkpoint();
  batch(() => {
    setBoard("nodes", (ns) => [...ns, frame, ...nodes]);
    setBoard("edges", (es) => [...es, ...imp.edges]);
    select([frame.id]);
  });
  touch();
  return frame;
}

/** Adds a node plus an edge to it, as a single undo step. */
export function addConnectedNode(node: FlowNode, from: string, extra?: Partial<FlowEdge>) {
  checkpoint();
  batch(() => {
    setBoard("nodes", (ns) => [...ns, node]);
    setBoard("edges", (es) => [...es, { id: uid(), from, to: node.id, style: ui.edgeStyle, ...extra }]);
    updateFrames([node.id]);
    select([node.id]);
  });
  touch();
}

export function moveNodesTo(pos: Map<string, { x: number; y: number }>) {
  setBoard(
    "nodes",
    (n) => pos.has(n.id),
    produce((n) => {
      const p = pos.get(n.id)!;
      n.x = p.x;
      n.y = p.y;
    }),
  );
  touch();
}

export function setNodeText(id: string, text: string) {
  const n = nodeById(id);
  if (!n || n.text === text) return;
  checkpoint();
  setBoard("nodes", (x) => x.id === id, "text", text);
  touch();
}

export function setSelectionColor(color: NodeColor) {
  const sel = derived.selectedSet();
  if (!sel.size) return;
  checkpoint();
  setBoard("nodes", (n) => sel.has(n.id), "color", color);
  touch();
}

export function deleteSelection() {
  const sel = derived.selectedSet();
  const edge = ui.selectedEdge;
  if (!sel.size && !edge) return;
  checkpoint();
  batch(() => {
    setBoard("nodes", (ns) => ns.filter((n) => !sel.has(n.id)));
    setBoard("edges", (es) => es.filter((e) => e.id !== edge && !sel.has(e.from) && !sel.has(e.to)));
    // What was in a deleted frame now belongs to the frame around it (if any)
    assignParents(board.nodes.filter((n) => n.parent && sel.has(n.parent)).map((n) => n.id));
    clearSelection();
  });
  touch();
}

export function duplicateSelection() {
  const sel = withContents(ui.selected);
  if (!sel.size) return;
  checkpoint();
  const idMap = new Map<string, string>();
  const nodes: FlowNode[] = board.nodes
    .filter((n) => sel.has(n.id))
    .map((n) => {
      const id = uid();
      idMap.set(n.id, id);
      return { ...unwrap(n), id, x: n.x + 30, y: n.y + 30 };
    })
    // The copy of a frame holds the copies of its contents
    .map((n) => (n.parent && idMap.has(n.parent) ? { ...n, parent: idMap.get(n.parent) } : n));
  const edges: FlowEdge[] = board.edges
    .filter((e) => idMap.has(e.from) && idMap.has(e.to))
    .map((e) => ({ ...unwrap(e), id: uid(), from: idMap.get(e.from)!, to: idMap.get(e.to)! }));
  const picked = new Set(ui.selected);
  batch(() => {
    setBoard("nodes", (ns) => [...ns, ...nodes]);
    setBoard("edges", (es) => [...es, ...edges]);
    select([...idMap].filter(([old]) => picked.has(old)).map(([, id]) => id));
  });
  touch();
}

export function nudgeSelection(dx: number, dy: number) {
  const ids = withContents(ui.selected);
  const sel = board.nodes.filter((n) => ids.has(n.id));
  if (!sel.length) return;
  checkpoint();
  moveFreeEnds(freeEndsIn(ids), dx, dy);
  moveNodesTo(new Map(sel.map((n) => [n.id, { x: n.x + dx, y: n.y + dy }])));
  assignParents(ui.selected);
}

export function applyLayout(positions: Position[]) {
  const map = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
  if (!map.size) return;
  checkpoint();
  moveNodesTo(map);
  assignParents(map.keys());
}

/** Replaces the whole flowchart (when opening a document). Does not count as a change. */
export function replaceBoard(b: FlowDoc) {
  batch(() => {
    setBoard(reconcile(b));
    // Saved before frames remembered their contents: take what lies inside them now
    if (!b.nodes.some((n) => n.parent) && b.nodes.some((n) => isContainer(n.kind))) {
      assignParents(board.nodes.map((n) => n.id));
    }
    // Lines between lifelines drawn before messages existed: make them messages
    // at the height where they leave their lifeline
    for (const e of board.edges) {
      const from = nodeById(e.from);
      if (e.messageY != null || !from || !isBetweenLifelines(e)) continue;
      makeMessage(e.id, e.fromAngle != null ? portAt(from, e.fromAngle).p.y : from.y + from.h / 2);
    }
    setUi({
      selected: [],
      selectedEdge: null,
      editingNode: null,
      editingEdge: null,
      editingLane: null,
      editingRow: null,
      tool: "select",
    });
  });
  resetHistory();
}
