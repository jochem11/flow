// The board without a mouse or without seeing it: Tab goes through the blocks
// in reading order (top to bottom, left to right), and what is selected is said
// in words (Canvas.tsx puts `selectionText` in a live region).

import { focusOn, viewportRect } from "./camera";
import { board, isContainer, nodeById, select, ui } from "./store";
import type { FlowNode, NodeKind } from "./types";
import { nodeName } from "./links";

const KIND: Partial<Record<NodeKind, string>> = {
  box: "Block",
  diamond: "Decision",
  pill: "Terminal",
  start: "Start",
  end: "End",
  note: "Note",
  label: "Text",
  callout: "Callout",
  section: "Section",
  lanes: "Swimlanes",
  class: "Class",
  lifeline: "Lifeline",
  fragment: "Fragment",
  topic: "Topic",
  actor: "Actor",
  usecase: "Use case",
  image: "Picture",
  chart: "Chart",
};

const kindName = (k: NodeKind) => KIND[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

/** Blocks in reading order: by rows (40px bands), then left to right; frames after what is in them */
function readingOrder(): FlowNode[] {
  return [...board.nodes].sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || a.x - b.x || Number(isContainer(a.kind)) - Number(isContainer(b.kind)));
}

/** Tab: the next block (Shift: the one before), brought into view when it is not. */
export function selectNextBlock(back: boolean): boolean {
  const order = readingOrder();
  if (!order.length) return false;
  const current = ui.selected.length ? order.findIndex((n) => n.id === ui.selected[ui.selected.length - 1]) : -1;
  const i = current < 0 ? (back ? order.length - 1 : 0) : (current + (back ? -1 : 1) + order.length) % order.length;
  const n = order[i];
  select([n.id]);
  const r = viewportRect();
  const c = board.camera;
  const sx = n.x * c.zoom + c.x;
  const sy = n.y * c.zoom + c.y;
  if (sx < 40 || sy < 40 || sx + n.w * c.zoom > r.width - 40 || sy + n.h * c.zoom > r.height - 40) focusOn(n);
  return true;
}

/** What is selected, in words: "Decision “Paid?”, 2 lines out, 1 in" */
export function selectionText(): string {
  if (ui.selectedEdge) {
    const e = board.edges.find((x) => x.id === ui.selectedEdge);
    if (!e) return "";
    const a = nodeById(e.from);
    const b = nodeById(e.to);
    const label = e.label ? ` “${e.label}”` : "";
    return `Line${label} from ${a ? nodeName(a) : "a spot"} to ${b ? nodeName(b) : "a spot"}`;
  }
  if (ui.selected.length > 1) return `${ui.selected.length} blocks selected`;
  const n = ui.selected.length ? nodeById(ui.selected[0]) : undefined;
  if (!n) return "";
  const outs = board.edges.filter((e) => e.from === n.id).length;
  const ins = board.edges.filter((e) => e.to === n.id).length;
  const lines = [outs && `${outs} ${outs === 1 ? "line" : "lines"} out`, ins && `${ins} in`].filter(Boolean).join(", ");
  const text = n.text.trim() ? ` “${nodeName(n)}”` : "";
  const focus = n.focal ? ", in focus" : "";
  return `${kindName(n.kind)}${text}${focus}${lines ? `, ${lines}` : ""}. Enter to edit, arrows to move.`;
}
