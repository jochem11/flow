// Mind maps on a flowchart: topics joined by lines without arrowheads, laid out
// as a tree from the root to the right. Tab adds a subtopic, Enter a topic next
// to the selected one; the tree is laid out again after every add or delete.

import { batch } from "solid-js";
import type { FlowEdge, FlowNode } from "./types";
import { addConnectedNode, assignParents, board, createNode, deleteSelection, growFrames, moveNodesTo, nodeById, select, setUi, snap, ui } from "./store";

const GAP_X = 70;
const GAP_Y = 16;

const isTopic = (n?: FlowNode) => n?.kind === "topic";

/** The topic this one hangs from (the line into it from another topic) */
export function parentOf(id: string, nodes: FlowNode[], edges: FlowEdge[]): string | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges.find((e) => e.to === id && e.from !== id && isTopic(byId.get(e.from)))?.from;
}

/** The subtopics of a topic, top to bottom */
export function childrenOf(id: string, nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((e) => e.from === id && e.to !== id)
    .map((e) => byId.get(e.to))
    .filter((n): n is FlowNode => isTopic(n))
    .sort((a, b) => a.y - b.y);
}

export function rootOf(id: string, nodes: FlowNode[], edges: FlowEdge[]): string {
  const seen = new Set<string>();
  let at = id;
  for (let p = parentOf(at, nodes, edges); p && !seen.has(p); p = parentOf(at, nodes, edges)) {
    seen.add(at);
    at = p;
  }
  return at;
}

/**
 * Where every topic of the tree goes: the root stays; each topic's subtopics in a
 * column to its right, stacked and centered on it, each with room for its own subtree.
 */
export function layoutTree(rootId: string, nodes: FlowNode[], edges: FlowEdge[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, { x: number; y: number }>();
  const seen = new Set<string>();
  /** How tall the topic with everything under it is */
  const heights = new Map<string, number>();
  const height = (id: string): number => {
    if (heights.has(id)) return heights.get(id)!;
    seen.add(id);
    const kids = childrenOf(id, nodes, edges).filter((k) => !seen.has(k.id));
    const own = byId.get(id)!.h;
    const sum = kids.reduce((s, k) => s + height(k.id), 0) + GAP_Y * Math.max(0, kids.length - 1);
    const h = Math.max(own, sum);
    heights.set(id, h);
    return h;
  };
  height(rootId);
  const place = (id: string, x: number, centerY: number) => {
    const n = byId.get(id)!;
    out.set(id, { x: snap(x), y: snap(centerY - n.h / 2) });
    const kids = childrenOf(id, nodes, edges).filter((k) => heights.has(k.id) && !out.has(k.id));
    let y = centerY - (kids.reduce((s, k) => s + heights.get(k.id)!, 0) + GAP_Y * Math.max(0, kids.length - 1)) / 2;
    for (const k of kids) {
      const h = heights.get(k.id)!;
      place(k.id, x + n.w + GAP_X, y + h / 2);
      y += h + GAP_Y;
    }
  };
  const root = byId.get(rootId)!;
  place(rootId, root.x, root.y + root.h / 2);
  return out;
}

/** Lays out the tree a topic is in (part of the change that caused it: no checkpoint). */
export function relayout(id: string) {
  if (!nodeById(id)) return;
  const pos = layoutTree(rootOf(id, board.nodes, board.edges), board.nodes, board.edges);
  batch(() => {
    moveNodesTo(pos);
    assignParents(pos.keys());
    growFrames(pos.keys());
  });
}

function addTopic(parentId: string, belowId?: string) {
  const parent = nodeById(parentId);
  if (!parent) return;
  const below = belowId ? nodeById(belowId) : undefined;
  // Placed so it sorts right after `below` (or last), the layout does the rest
  const kids = childrenOf(parentId, board.nodes, board.edges);
  const y = below ? below.y + 1 : (kids[kids.length - 1]?.y ?? parent.y) + 1;
  const node: FlowNode = { ...createNode("topic", 0, 0), x: parent.x + parent.w + GAP_X, y, color: parent.color };
  // Out of the parent's right side, into the topic's left side
  addConnectedNode(node, parentId, { style: "curved", endCap: "none", fromAngle: 0, toAngle: 180 });
  relayout(node.id);
  select([node.id]);
  setUi("editingNode", node.id);
}

/** Tab: a subtopic of the selected topic */
export function addSubtopic() {
  const n = ui.selected.length === 1 ? nodeById(ui.selected[0]) : undefined;
  if (!isTopic(n)) return false;
  addTopic(n!.id);
  return true;
}

/** Enter: a topic below the selected one, under the same parent (under the root: a subtopic) */
export function addSiblingTopic() {
  const n = ui.selected.length === 1 ? nodeById(ui.selected[0]) : undefined;
  if (!isTopic(n)) return false;
  const parent = parentOf(n!.id, board.nodes, board.edges);
  if (parent) addTopic(parent, n!.id);
  else addTopic(n!.id);
  return true;
}

/** Deletes the selection; trees that lost topics are laid out again (in the same undo step). */
export function deleteSelectionTidy() {
  const topics = ui.selected.filter((id) => isTopic(nodeById(id)));
  const parents = topics.map((id) => parentOf(id, board.nodes, board.edges)).filter((p): p is string => !!p && !topics.includes(p));
  deleteSelection();
  for (const p of parents) relayout(p);
}
