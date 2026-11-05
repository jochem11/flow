// Smart guides: while moving or resizing, edges and centers snap to those of the
// other items close by, and a line shows what they line up with.

import type { Rect } from "./geometry";

/** A guide line: vertical (`x`) at `at` from `from` to `to`, or horizontal (`y`) */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

const xsOf = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
const ysOf = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];

/** The lines of the other items that things snap to */
export function snapLines(others: Rect[]): { xs: number[]; ys: number[] } {
  return { xs: others.flatMap(xsOf), ys: others.flatMap(ysOf) };
}

/** The line closest to `v`, if one is within `reach`. */
export function nearestLine(v: number, lines: number[], reach: number): number | null {
  let best: number | null = null;
  for (const l of lines) if (Math.abs(l - v) <= reach && (best === null || Math.abs(l - v) < Math.abs(best - v))) best = l;
  return best;
}

/**
 * How far to shift a moving box so one of its edges or its center lines up with
 * those of the others, per axis (null: nothing within reach on that axis).
 */
export function snapBox(box: Rect, lines: { xs: number[]; ys: number[] }, reach: number): { dx: number | null; dy: number | null } {
  const shift = (own: number[], targets: number[]) => {
    let best: number | null = null;
    for (const v of own) {
      const l = nearestLine(v, targets, reach);
      if (l !== null && (best === null || Math.abs(l - v) < Math.abs(best))) best = l - v;
    }
    return best;
  };
  return { dx: shift(xsOf(box), lines.xs), dy: shift(ysOf(box), lines.ys) };
}

/** The guide lines for a box that is where it snapped to: one per line it shares with others. */
export function guidesFor(box: Rect, others: Rect[]): Guide[] {
  const out: Guide[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
  for (const at of xsOf(box)) {
    const hits = others.filter((o) => xsOf(o).some((x) => near(x, at)));
    if (hits.length) {
      const ys = [box.y, box.y + box.h, ...hits.flatMap((o) => [o.y, o.y + o.h])];
      out.push({ axis: "x", at, from: Math.min(...ys), to: Math.max(...ys) });
    }
  }
  for (const at of ysOf(box)) {
    const hits = others.filter((o) => ysOf(o).some((y) => near(y, at)));
    if (hits.length) {
      const xs = [box.x, box.x + box.w, ...hits.flatMap((o) => [o.x, o.x + o.w])];
      out.push({ axis: "y", at, from: Math.min(...xs), to: Math.max(...xs) });
    }
  }
  return out;
}

/** How close (screen pixels) an edge must come to snap */
export const SNAP_REACH = 6;
