// Which frame (section, swimlane, ...) a node belongs to (`parent`), and what moves along with it.

import { batch } from "solid-js";
import { center, containsPt, containsRect } from "../geometry";
import type { FlowNode, NodeKind } from "../types";
import { GRID, isContainer } from "./nodes";
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

const area = (r: FlowNode) => r.w * r.h;

/**
 * Sets the frame of the given nodes from where they are now. No checkpoint: part of a move or add.
 * A frame dragged partly out of the frame it was in stays in it while its center is
 * (that frame then grows around it, see `growFrames`), unless a smaller frame now holds it.
 */
export function assignParents(ids: Iterable<string>) {
  batch(() => {
    for (const id of ids) {
      const n = nodeById(id);
      if (!n) continue;
      // Never into something inside itself
      const fit = frameAt(n, descendants(id));
      const was = n.parent ? nodeById(n.parent) : undefined;
      const keep = isContainer(n.kind) && was && containsPt(was, center(n)) && (!fit || area(fit) >= area(was));
      const parent = keep && was ? was.id : fit?.id;
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

/** Frames that grow to keep what is put in them (a swimlane keeps the sizes of its lanes) */
const GROWS: NodeKind[] = ["section", "boundary", "package", "fragment"];
/** Room kept around what is in a frame, and above it for the frame's title */
const FIT_PAD = 30;
const FIT_TOP: Partial<Record<NodeKind, number>> = { section: 50, boundary: 50, fragment: 40 };

/**
 * Grows the frames these nodes are in (and the frames around those) so the nodes fit
 * with some room to spare, in whichever direction they stick out. It never shrinks a
 * frame: one made smaller by hand stays so until something in it is moved, added or
 * resized again. No checkpoint: part of that move, add or resize.
 */
export function growFrames(ids: Iterable<string>) {
  const down = (v: number) => Math.floor(v / GRID) * GRID;
  const up = (v: number) => Math.ceil(v / GRID) * GRID;
  batch(() => {
    const todo = [...ids];
    while (todo.length) {
      const n = nodeById(todo.pop()!);
      const f = n?.parent ? nodeById(n.parent) : undefined;
      if (!n || !f || !GROWS.includes(f.kind)) continue;
      const top = FIT_TOP[f.kind] ?? FIT_PAD;
      const x0 = Math.min(f.x, down(n.x - FIT_PAD));
      const y0 = Math.min(f.y, down(n.y - top));
      const x1 = Math.max(f.x + f.w, up(n.x + n.w + FIT_PAD));
      const y1 = Math.max(f.y + f.h, up(n.y + n.h + FIT_PAD));
      if (x0 === f.x && y0 === f.y && x1 === f.x + f.w && y1 === f.y + f.h) continue;
      setBoard("nodes", (x) => x.id === f.id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      // Now it may stick out of the frame around it
      todo.push(f.id);
    }
  });
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * While dragging: the frames that may grow, as they are now (not those in `moving`).
 * Put back with `restoreFrames` before every step, so a frame that grew while
 * something was dragged to its edge shrinks again when it is dragged on, out of it.
 */
export function frameSizes(moving: Set<string>): Map<string, Box> {
  return new Map(board.nodes.filter((n) => GROWS.includes(n.kind) && !moving.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y, w: n.w, h: n.h }]));
}

export function restoreFrames(sizes: Map<string, Box>) {
  batch(() => {
    for (const n of board.nodes) {
      const b = sizes.get(n.id);
      if (b && (b.x !== n.x || b.y !== n.y || b.w !== n.w || b.h !== n.h)) setBoard("nodes", (x) => x.id === n.id, b);
    }
  });
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
