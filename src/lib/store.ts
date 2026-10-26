import { batch, createMemo, createRoot, createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import type { Board, Camera, FlowEdge, FlowNode, NodeColor, NodeKind, Position } from "./types";

// ---------- helpers ----------

export const uid = (): string =>
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

export const SIZES: Record<NodeKind, { w: number; h: number }> = {
  // Veelvouden van 20, zodat het middelpunt ook op het grid valt
  box: { w: 180, h: 60 },
  diamond: { w: 180, h: 120 },
  note: { w: 180, h: 140 },
  pill: { w: 160, h: 60 },
};

export const MIN_SIZE = { w: 50, h: 30 };

const DEFAULT_COLOR: Record<NodeKind, NodeColor> = {
  box: "white",
  diamond: "blue",
  note: "yellow",
  pill: "green",
};

/** Maak een node met het middelpunt op (cx, cy) in wereld-coördinaten. */
export function createNode(kind: NodeKind, cx: number, cy: number, partial?: Partial<FlowNode>): FlowNode {
  const { w, h } = SIZES[kind];
  return {
    id: uid(),
    kind,
    x: snap(cx - w / 2),
    y: snap(cy - h / 2),
    w,
    h,
    text: "",
    color: DEFAULT_COLOR[kind],
    ...partial,
  };
}

function starterBoard(): Board {
  const start = createNode("pill", 0, 0, { text: "Start" });
  const idee = createNode("box", 0, 130, { text: "Idee uitwerken" });
  const check = createNode("diamond", 0, 280, { text: "Goedgekeurd?" });
  const bouwen = createNode("box", 0, 440, { text: "Bouwen" });
  const feedback = createNode("box", 300, 280, { text: "Feedback verwerken", color: "pink" });
  const note = createNode("note", -320, 140, {
    text: "Dubbelklik om tekst te bewerken.\nSleep vanaf een bolletje om te verbinden.",
  });
  return {
    id: uid(),
    name: "Mijn eerste flow",
    nodes: [start, idee, check, bouwen, feedback, note],
    edges: [
      { id: uid(), from: start.id, to: idee.id },
      { id: uid(), from: idee.id, to: check.id },
      { id: uid(), from: check.id, to: bouwen.id, label: "Ja" },
      { id: uid(), from: check.id, to: feedback.id, label: "Nee" },
      { id: uid(), from: feedback.id, to: idee.id },
    ],
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

export function emptyBoard(): Board {
  return { id: uid(), name: "Naamloos bord", nodes: [], edges: [], camera: { x: 0, y: 0, zoom: 1 } };
}

// ---------- state ----------

export const [board, setBoard] = createStore<Board>(starterBoard());

export type Tool = "select" | NodeKind;

export interface UiState {
  tool: Tool;
  selected: string[];
  selectedEdge: string | null;
  editingNode: string | null;
  editingEdge: string | null;
  spaceDown: boolean;
  panning: boolean;
  dragging: boolean;
  /** Lijn die je aan het trekken bent vanaf een handle (wereld-coördinaten) */
  connecting: { from: string; x: number; y: number; target: string | null } | null;
  /** Selectie-rechthoek (wereld-coördinaten) */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
}

export const [ui, setUi] = createStore<UiState>({
  tool: "select",
  selected: [],
  selectedEdge: null,
  editingNode: null,
  editingEdge: null,
  spaceDown: false,
  panning: false,
  dragging: false,
  connecting: null,
  marquee: null,
});

const derived = createRoot(() => ({
  selectedSet: createMemo(() => new Set(ui.selected)),
  nodeMap: createMemo(() => new Map(board.nodes.map((n) => [n.id, n]))),
}));

export const isSelected = (id: string) => derived.selectedSet().has(id);
export const nodeById = (id: string): FlowNode | undefined => derived.nodeMap().get(id);
export const selectedNodes = () => board.nodes.filter((n) => derived.selectedSet().has(n.id));

/** Telt op bij elke wijziging; App gebruikt dit voor autosave. */
const [rev, setRev] = createSignal(0);
export { rev };
const touch = () => setRev((r) => r + 1);

/** Platte kopie zonder Solid-proxies, klaar om naar Rust te sturen. */
export const boardSnapshot = (): Board => JSON.parse(JSON.stringify(unwrap(board)));

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

/** Roep aan vóór een wijziging die je ongedaan wilt kunnen maken. */
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
    setUi({ editingNode: null, editingEdge: null });
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

function resetHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}

// ---------- selectie ----------

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

// ---------- mutaties ----------

export function addNode(node: FlowNode) {
  checkpoint();
  setBoard("nodes", (ns) => [...ns, node]);
  select([node.id]);
  touch();
}

/** Nieuwe node plus een pijl ernaartoe, als één undo-stap. */
export function addConnectedNode(node: FlowNode, from: string) {
  checkpoint();
  batch(() => {
    setBoard("nodes", (ns) => [...ns, node]);
    setBoard("edges", (es) => [...es, { id: uid(), from, to: node.id }]);
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

export function resizeNode(id: string, w: number, h: number) {
  setBoard("nodes", (n) => n.id === id, { w, h });
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
    clearSelection();
  });
  touch();
}

export function connect(from: string, to: string) {
  if (from === to) return;
  if (board.edges.some((e) => e.from === from && e.to === to)) return;
  checkpoint();
  setBoard("edges", (es) => [...es, { id: uid(), from, to }]);
  touch();
}

export function setEdgeLabel(id: string, label: string) {
  const edge = board.edges.find((e) => e.id === id);
  const value = label.trim() || undefined;
  if (!edge || (edge.label ?? undefined) === value) return;
  checkpoint();
  setBoard("edges", (e) => e.id === id, "label", value);
  touch();
}

export function duplicateSelection() {
  const sel = derived.selectedSet();
  if (!sel.size) return;
  checkpoint();
  const idMap = new Map<string, string>();
  const nodes: FlowNode[] = board.nodes
    .filter((n) => sel.has(n.id))
    .map((n) => {
      const id = uid();
      idMap.set(n.id, id);
      return { ...unwrap(n), id, x: n.x + 30, y: n.y + 30 };
    });
  const edges: FlowEdge[] = board.edges
    .filter((e) => idMap.has(e.from) && idMap.has(e.to))
    .map((e) => ({ ...unwrap(e), id: uid(), from: idMap.get(e.from)!, to: idMap.get(e.to)! }));
  batch(() => {
    setBoard("nodes", (ns) => [...ns, ...nodes]);
    setBoard("edges", (es) => [...es, ...edges]);
    select(nodes.map((n) => n.id));
  });
  touch();
}

export function nudgeSelection(dx: number, dy: number) {
  const sel = selectedNodes();
  if (!sel.length) return;
  checkpoint();
  moveNodesTo(new Map(sel.map((n) => [n.id, { x: n.x + dx, y: n.y + dy }])));
}

export function applyLayout(positions: Position[]) {
  const map = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
  if (!map.size) return;
  checkpoint();
  moveNodesTo(map);
}

export function setCamera(c: Partial<Camera>) {
  setBoard("camera", c);
  touch();
}

export function renameBoard(name: string) {
  if (name === board.name) return;
  setBoard("name", name);
  touch();
}

/** Vervang het hele bord (bij laden of nieuw bord). Telt niet als wijziging. */
export function replaceBoard(b: Board) {
  batch(() => {
    setBoard(reconcile({ ...b, camera: b.camera ?? { x: 0, y: 0, zoom: 1 } }));
    setUi({ selected: [], selectedEdge: null, editingNode: null, editingEdge: null, tool: "select" });
  });
  resetHistory();
}
