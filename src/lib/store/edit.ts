// Selection and the other edits: adding, moving, deleting, duplicating, opening a flowchart.

import { batch } from "solid-js";
import { produce, reconcile, unwrap } from "solid-js/store";
import { alignRects, bounds, distributeRects, intersects, portAt, type AlignTo, type Pt } from "../geometry";
import type { Arranged, CodeImport, FlowDoc, FlowEdge, FlowNode, NodeColor } from "../types";
import { freeEndsIn, isBetweenLifelines, makeMessage, moveFreeEnds } from "./edges";
import { assignParents, frameAt, growFrames, updateFrames, withContents } from "./frames";
import { checkpoint, resetHistory } from "./history";
import { createNode, hasText, isConnectable, isContainer, isResizable, snap, uid } from "./nodes";
import { board, derived, nodeById, setBoard, setUi, touch, ui, type FlowSettings } from "./state";

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
  // Added inside a section: it belongs to it (and the section grows to fit it). A new frame takes in what it covers.
  updateFrames([node.id]);
  growFrames([node.id]);
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
    // Drawn out of a block in a section: the new block is in that section too (unless it
    // was dropped in a smaller frame), also when it lies past its edge; the section grows
    const home = nodeById(from)?.parent;
    const fit = frameAt(node, new Set());
    const homeNode = home ? nodeById(home) : undefined;
    if (homeNode && (!fit || fit.w * fit.h >= homeNode.w * homeNode.h)) setBoard("nodes", (n) => n.id === node.id, "parent", home);
    growFrames([node.id]);
    select([node.id]);
  });
  touch();
}

/**
 * Alt+Arrow: a block like the selected one (kind, size, color) beside it in that
 * direction, joined to it by a line, its text ready to type. When something is in
 * the way it goes beside that, so several in a row from one block fan out.
 */
export function quickAdd(dir: "left" | "right" | "up" | "down") {
  const src = ui.selected.length === 1 ? nodeById(ui.selected[0]) : undefined;
  if (!src || !isConnectable(src.kind) || src.kind === "lifeline") return;
  const GAP = 80;
  const [ux, uy] = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir];
  // Start, end, pins and the like: a normal block follows them
  const proto = hasText(src.kind) && isResizable(src.kind) ? src : createNode("box", 0, 0);
  const w = proto.w;
  const h = proto.h;
  let x = ux > 0 ? src.x + src.w + GAP : ux < 0 ? src.x - GAP - w : src.x + src.w / 2 - w / 2;
  let y = uy > 0 ? src.y + src.h + GAP : uy < 0 ? src.y - GAP - h : src.y + src.h / 2 - h / 2;
  const taken = (r: { x: number; y: number; w: number; h: number }) =>
    board.nodes.some((n) => !isContainer(n.kind) && intersects(n, { x: r.x - 10, y: r.y - 10, w: r.w + 20, h: r.h + 20 }));
  for (let i = 0; i < 30 && taken({ x, y, w, h }); i++) {
    // Beside what is in the way: below it going across, to the right of it going up or down
    if (ux) y += h + GAP / 2;
    else x += w + GAP / 2;
  }
  const node: FlowNode = { ...createNode(proto.kind, 0, 0), x: snap(x), y: snap(y), w, h, color: proto.color };
  if (proto.kind === "class") node.text = "";
  addConnectedNode(node, src.id, src.kind === "class" ? { endCap: "open" } : undefined);
  setUi("editingNode", node.id);
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

/** The block whose text is being typed live (its undo checkpoint is taken) */
let liveTextOf: string | null = null;

/** Finishes editing a block's text. */
export function setNodeText(id: string, text: string) {
  const live = liveTextOf === id;
  liveTextOf = null;
  const n = nodeById(id);
  if (!n || n.text === text) return;
  if (!live) checkpoint();
  setBoard("nodes", (x) => x.id === id, "text", text);
  touch();
}

/**
 * Typing in a block: the text goes onto the board with every key, so it is saved
 * and others editing together see it as it is typed. One undo step per edit.
 */
export function setNodeTextLive(id: string, text: string) {
  const n = nodeById(id);
  if (!n || n.text === text) return;
  if (liveTextOf !== id) {
    checkpoint();
    liveTextOf = id;
  }
  setBoard("nodes", (x) => x.id === id, "text", text);
  touch();
}

export function setSelectionColor(color: NodeColor) {
  const sel = derived.selectedSet();
  if (!sel.size) return;
  checkpoint();
  setBoard("nodes", (n) => sel.has(n.id) && !n.locked, "color", color);
  touch();
}

/** Locks or unlocks the selection: a locked item is not moved, resized, changed or deleted. */
export function setSelectionLocked(locked: boolean) {
  const sel = derived.selectedSet();
  if (!sel.size) return;
  checkpoint();
  setBoard("nodes", (n) => sel.has(n.id), "locked", locked || undefined);
  touch();
}

/** The selected items that may be moved, without those inside another selected one (they go along with it). */
function movableSelected(): FlowNode[] {
  const sel = derived.selectedSet();
  const inside = new Set<string>();
  for (const id of sel) for (const d of withContents([id])) if (d !== id) inside.add(d);
  return board.nodes.filter((n) => sel.has(n.id) && !inside.has(n.id) && !n.locked);
}

/** Puts these nodes where given, with what is in them; their sections make room. One undo step. */
function placeWithContents(pos: Map<string, Pt>) {
  const all = new Map<string, Pt>();
  for (const [id, p] of pos) {
    const n = nodeById(id);
    if (!n || (p.x === n.x && p.y === n.y)) continue;
    for (const c of withContents([id])) {
      const m = nodeById(c);
      if (m && !m.locked) all.set(c, { x: m.x + p.x - n.x, y: m.y + p.y - n.y });
    }
  }
  if (!all.size) return;
  checkpoint();
  batch(() => {
    moveNodesTo(all);
    assignParents(pos.keys());
    growFrames(pos.keys());
  });
}

/** Lines up the selected items on their outer left, right, top or bottom edge, or their middle. */
export function alignSelection(to: AlignTo) {
  const items = movableSelected();
  if (items.length > 1) placeWithContents(alignRects(items, to));
}

/** Equal gaps between the selected items (at least three), across or down. */
export function distributeSelection(axis: "x" | "y") {
  placeWithContents(distributeRects(movableSelected(), axis));
}

export function deleteSelection() {
  // Locked items stay
  const sel = new Set(board.nodes.filter((n) => derived.selectedSet().has(n.id) && !n.locked).map((n) => n.id));
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
  const nodes = board.nodes.filter((n) => sel.has(n.id)).map((n) => unwrap(n));
  const edges = board.edges.filter((e) => sel.has(e.from) && sel.has(e.to)).map((e) => unwrap(e));
  insertCopies(nodes, edges, 30, 30, ui.selected);
}

/**
 * Adds copies of these nodes, moved by (dx, dy), and of the edges between them, all
 * with new ids (as one undo step), and selects the copies of `picked` (default: those
 * not inside another copied frame). The copy of a frame holds the copies of its
 * contents; the others go into the frame where they land, which grows to fit them.
 * Returns the ids of the copies.
 */
export function insertCopies(nodes: FlowNode[], edges: FlowEdge[], dx: number, dy: number, picked?: Iterable<string>): string[] {
  if (!nodes.length) return [];
  const ids = new Map(nodes.map((n) => [n.id, uid()]));
  const copies: FlowNode[] = nodes.map((n) => {
    const c: FlowNode = { ...(JSON.parse(JSON.stringify(n)) as FlowNode), id: ids.get(n.id)!, x: n.x + dx, y: n.y + dy };
    if (n.parent && ids.has(n.parent)) c.parent = ids.get(n.parent);
    else delete c.parent;
    return c;
  });
  const lines: FlowEdge[] = edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ ...(JSON.parse(JSON.stringify(e)) as FlowEdge), id: uid(), from: ids.get(e.from)!, to: ids.get(e.to)! }));
  // The copies that stand on their own (not inside a copied frame)
  const top = copies.filter((c) => !c.parent).map((c) => c.id);
  const chosen = picked ? [...picked].map((id) => ids.get(id)).filter((id): id is string => !!id) : top;
  checkpoint();
  batch(() => {
    setBoard("nodes", (ns) => [...ns, ...copies]);
    setBoard("edges", (es) => [...es, ...lines]);
    assignParents(top);
    growFrames(top);
    select(chosen);
  });
  touch();
  return copies.map((c) => c.id);
}

export function nudgeSelection(dx: number, dy: number) {
  const ids = withContents(ui.selected);
  const sel = board.nodes.filter((n) => ids.has(n.id) && !n.locked);
  if (!sel.length) return;
  checkpoint();
  moveFreeEnds(freeEndsIn(ids), dx, dy);
  moveNodesTo(new Map(sel.map((n) => [n.id, { x: n.x + dx, y: n.y + dy }])));
  assignParents(ui.selected);
  growFrames(ui.selected);
}

/**
 * Arrange's result (crates/flow-core/src/arrange.rs), as one undo step: nodes to
 * their places, sections and swimlanes to their new sizes, and the lines between
 * them without their own routes (a loop goes around a side).
 */
export function applyLayout(r: Arranged) {
  if (!r.nodes.length) return;
  checkpoint();
  batch(() => {
    for (const p of r.nodes) {
      setBoard(
        "nodes",
        (n) => n.id === p.id,
        produce((n) => {
          n.x = p.x;
          n.y = p.y;
          if (p.w != null) n.w = p.w;
          if (p.h != null) n.h = p.h;
          if (p.lanes && n.lanes) p.lanes.forEach((size, i) => n.lanes![i] && (n.lanes![i].size = size));
        }),
      );
    }
    const ports = new Map(r.edges.map((e) => [e.id, e]));
    setBoard(
      "edges",
      (e) => ports.has(e.id),
      produce((e) => {
        const p = ports.get(e.id)!;
        e.bend = undefined;
        e.fromAngle = p.fromAngle ?? undefined;
        e.toAngle = p.toAngle ?? undefined;
      }),
    );
    // Notes that ended up in a section belong to it now
    assignParents(r.nodes.map((p) => p.id));
  });
  touch();
}

/** An older state of the flowchart (version history), as one change that can be undone and that everyone gets. */
export function restoreBoard(doc: FlowDoc) {
  checkpoint();
  batch(() => {
    setBoard("nodes", reconcile(doc.nodes ?? [], { key: "id" }));
    setBoard("edges", reconcile(doc.edges ?? [], { key: "id" }));
    setBoard("callColors", doc.callColors ?? undefined);
    setBoard("diagram", doc.diagram ?? undefined);
    setBoard("codeLanguage", doc.codeLanguage ?? undefined);
    setUi({ selected: [], selectedEdge: null, editingNode: null, editingEdge: null });
  });
  touch();
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

/**
 * Changes from someone else (editing together, see collab/): the board's blocks
 * and lines as they are now, and its settings when the shared state has them.
 * Not a change of ours: no undo step, no autosave.
 */
export function applyRemoteFlow(nodes: FlowNode[], edges: FlowEdge[], settings: FlowSettings = {}) {
  batch(() => {
    if (settings.callColors !== undefined) setBoard("callColors", settings.callColors || undefined);
    if (settings.diagram !== undefined) setBoard("diagram", settings.diagram);
    if (settings.codeLanguage !== undefined) setBoard("codeLanguage", settings.codeLanguage ?? undefined);
    setBoard("nodes", reconcile(nodes, { key: "id" }));
    setBoard("edges", reconcile(edges, { key: "id" }));
    const ids = new Set(nodes.map((n) => n.id));
    if (ui.selected.some((id) => !ids.has(id))) setUi("selected", (sel) => sel.filter((id) => ids.has(id)));
    if (ui.selectedEdge && !edges.some((e) => e.id === ui.selectedEdge)) setUi("selectedEdge", null);
    if (ui.editingNode && !ids.has(ui.editingNode)) setUi("editingNode", null);
  });
}

/**
 * Puts the selected blocks (with what is in selected frames) in a new section
 * around them, as one undo step. The section goes where they were (inside their
 * frame, if they shared one), becomes their frame, and its title is edited.
 */
export function wrapSelectionInSection() {
  const all = withContents(ui.selected);
  const nodes = board.nodes.filter((n) => all.has(n.id));
  const box = bounds(nodes);
  if (!box) return;
  // The selection's outer items: those not inside something else that is selected
  const outer = nodes.filter((n) => !n.parent || !all.has(n.parent));
  const levels = new Set(outer.map((n) => n.parent ?? null));
  const parent = levels.size === 1 ? ([...levels][0] ?? undefined) : undefined;
  // Room around them, and above for the section's title
  const PAD = 30;
  const TITLE = 50;
  const x = snap(box.x - PAD);
  const y = snap(box.y - TITLE);
  const section = createNode("section", 0, 0, {
    x,
    y,
    w: snap(box.x + box.w + PAD) - x,
    h: snap(box.y + box.h + PAD) - y,
    ...(parent ? { parent } : {}),
  });
  checkpoint();
  // Typing its title belongs to this same undo step
  liveTextOf = section.id;
  batch(() => {
    setBoard("nodes", (ns) => [section, ...ns]);
    const ids = new Set(outer.map((n) => n.id));
    setBoard("nodes", (n) => ids.has(n.id), "parent", section.id);
    select([section.id]);
    setUi("editingNode", section.id);
    // Wrapped inside a section: that one makes room for the new one
    growFrames([section.id]);
  });
  touch();
}

