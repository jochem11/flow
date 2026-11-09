// While something is dragged (a block, a selection rectangle, a line) and the
// pointer gets to the edge of the board, the board moves along, so the drag can
// go on past what is on screen. The closer to the edge the faster, for as long
// as the pointer stays there, also when it does not move.

import { batch } from "solid-js";

/** How far from the edge the board starts to move (px) */
export const EDGE_ZONE = 48;
/** The fastest it goes, at the edge and past it (px per second) */
export const EDGE_SPEED = 1100;
/** The slowest, just inside the zone: a share of the fastest */
const CREEP = 0.12;
/** The pointer has to have moved this far first (px): a press near the edge is not a drag */
const MOVED = 3;

/** The board a gesture is on */
export interface AutoPan {
  /** The board on screen */
  rect: () => DOMRect;
  /** Moves the board by this many pixels */
  pan: (dx: number, dy: number) => void;
}

/**
 * Speed on one axis, for a pointer at `at` on a board from `low` to `high`, whose
 * drag started at `from`. Positive: the board moves up the axis, showing what is
 * on the low side. Only towards an edge the drag went to: one started near an
 * edge and going away from it leaves the board where it is.
 */
export function edgeSpeed(at: number, low: number, high: number, from: number): number {
  // On a small board the zones keep clear of each other
  const zone = Math.min(EDGE_ZONE, (high - low) / 4);
  if (zone <= 0) return 0;
  const speed = (depth: number) => EDGE_SPEED * (CREEP + (1 - CREEP) * Math.min(1, depth) ** 2);
  if (at < low + zone && at < from) return speed((low + zone - at) / zone);
  if (at > high - zone && at > from) return -speed((at - (high - zone)) / zone);
  return 0;
}

/** Panels floating over the board's right side: the board ends where they start */
const OVER_BOARD = ".comments-panel, .class-panel";

function visible(r: DOMRect): DOMRect {
  let right = r.right;
  for (const el of document.querySelectorAll(OVER_BOARD)) {
    const left = el.getBoundingClientRect().left;
    // Not one that fills the board (on a phone)
    if (left > r.left + r.width / 2) right = Math.min(right, left);
  }
  return new DOMRect(r.left, r.top, right - r.left, r.height);
}

/**
 * Keeps the board moving during one gesture. `at`: where the pointer is now.
 * `replay`: runs the gesture's move again, as the same pointer is now on another
 * spot of the board.
 */
export function edgePanner(down: PointerEvent, board: AutoPan, replay: (ev: PointerEvent) => void) {
  let last: PointerEvent | null = null;
  let moved = false;
  let frame = 0;
  let then = 0;

  const speed = (ev: PointerEvent) => {
    const r = visible(board.rect());
    return { x: edgeSpeed(ev.clientX, r.left, r.right, down.clientX), y: edgeSpeed(ev.clientY, r.top, r.bottom, down.clientY) };
  };
  const step = (now: number) => {
    frame = 0;
    if (!last) return;
    const v = speed(last);
    if (!v.x && !v.y) return;
    // In time, not per frame: as fast on every screen. A long pause is not a jump
    const dt = Math.max(0, Math.min(50, now - then)) / 1000;
    then = now;
    const ev = last;
    batch(() => {
      board.pan(v.x * dt, v.y * dt);
      replay(ev);
    });
    frame = requestAnimationFrame(step);
  };

  return {
    at(ev: PointerEvent) {
      last = ev;
      moved ||= Math.hypot(ev.clientX - down.clientX, ev.clientY - down.clientY) >= MOVED;
      if (frame || !moved) return;
      const v = speed(ev);
      if (!v.x && !v.y) return;
      then = performance.now();
      frame = requestAnimationFrame(step);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      last = null;
    },
  };
}
