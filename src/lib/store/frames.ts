// Which frame (section, swimlane, ...) a node belongs to (`parent`), and what moves along with it.

import { batch } from "solid-js";
import { center, containsPt, containsRect } from "../geometry";
import type { FlowNode } from "../types";
import { isContainer } from "./nodes";
import { board, nodeById, setBoard } from "./state";

/** Everything inside frame `id`, at any depth (by `parent`). */
function descendants(id: string): Set<string> {
  const out = new Set<string>();
  const todo = [id];
  while (todo.length) {
    const p = todo.pop()!;
    for (const n of board.nodes) {
      if (n.parent === p && !out.has(n.id)) {
        out.add(n.id);
        todo.push(n.id);
      }
    }
  }
  return out;
}

/**
 * The frame a node would belong to where it is now: the smallest frame around it.
 * A block belongs to a frame when its center is inside; a frame only when it fits
 * in completely, so two overlapping sections (like a duplicate) stay separate.
 */
export function frameAt(n: FlowNode, exclude: Set<string>): FlowNode | undefined {
  const c = center(n);
  let best: FlowNode | undefined;
  for (const f of board.nodes) {
    if (!isContainer(f.kind) || f.id === n.id || exclude.has(f.id)) continue;
    const inside = isContainer(n.kind) ? containsRect(f, n) && f.w * f.h > n.w * n.h : containsPt(f, c);
    if (inside && (!best || f.w * f.h < best.w * best.h)) best = f;
  }
  return best;
}

/** Sets the frame of the given nodes from where they are now. No checkpoint: part of a move or add. */
export function assignParents(ids: Iterable<string>) {
  batch(() => {
    for (const id of ids) {
      const n = nodeById(id);
      if (!n) continue;
      // Never into something inside itself
      const parent = frameAt(n, descendants(id))?.id;
      if ((n.parent ?? undefined) !== parent) setBoard("nodes", (x) => x.id === id, "parent", parent);
    }
  });
}

/**
 * A frame that was added or resized: it takes in the nodes at its own level that
 * now lie inside it, and lets go of children that no longer do.
 */
export function refreshFrame(id: string) {
  const f = nodeById(id);
  if (!f) return;
  const level = f.parent ?? undefined;
  assignParents(board.nodes.filter((n) => n.parent === id || (n.id !== id && (n.parent ?? undefined) === level)).map((n) => n.id));
}

/** After nodes were moved, added or resized: their frames, and for frames what they hold. */
export function updateFrames(ids: string[]) {
  assignParents(ids);
  for (const id of ids) if (isContainer(nodeById(id)?.kind ?? "box")) refreshFrame(id);
}

/**
 * The given nodes plus what belongs to them: everything in a selected frame
 * (section, swimlane, ...), and the pins on the border of a selected block.
 */
export function withContents(ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  for (const id of [...out]) for (const d of descendants(id)) out.add(d);
  const hosts = board.nodes.filter((n) => out.has(n.id) && !isContainer(n.kind) && n.kind !== "pin");
  const PIN_REACH = 10;
  for (const n of board.nodes) {
    if (n.kind !== "pin" || out.has(n.id)) continue;
    const c = center(n);
    const grown = (h: FlowNode) => ({ x: h.x - PIN_REACH, y: h.y - PIN_REACH, w: h.w + 2 * PIN_REACH, h: h.h + 2 * PIN_REACH });
    if (hosts.some((h) => containsPt(grown(h), c))) out.add(n.id);
  }
  return out;
}
