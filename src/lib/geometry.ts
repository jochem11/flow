import type { EdgeStyle, FlowEdge, NodeKind } from "./types";

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "left" | "right" | "top" | "bottom";

export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** A node's rectangle plus its kind, which decides the outline that edges attach to. */
export interface Shape extends Rect {
  kind?: NodeKind;
}

/** A point on the outline of a node, and the direction an edge leaves it in. */
interface Port {
  p: Pt;
  n: Pt;
}

/** Height of the head of a UML lifeline (see `.node-lifeline` in styles.css) */
const LIFELINE_HEAD = 44;

const SIDE_ANGLE: Record<Side, number> = { right: 0, bottom: 90, left: 180, top: 270 };

/**
 * The point on a node's outline at `angle` degrees. The angle is measured as if
 * the node were square, so 45 is always the bottom-right corner of a box and
 * 0/90/180/270 are always the middles of the sides (the tips of a diamond).
 */
export function portAt(s: Shape, angle: number): Port {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const c = center(s);
  const hw = s.w / 2;
  const hh = s.h / 2;
  const radial = (from: Pt, p: Pt) => {
    const len = Math.hypot(p.x - from.x, p.y - from.y) || 1;
    return { x: (p.x - from.x) / len, y: (p.y - from.y) / len };
  };

  if (s.kind === "diamond") {
    const k = 1 / (Math.abs(dx) + Math.abs(dy));
    const p = { x: c.x + dx * k * hw, y: c.y + dy * k * hh };
    return { p, n: radial(c, p) };
  }
  if (s.kind === "start" || s.kind === "end" || s.kind === "flowfinal" || s.kind === "circle") {
    const p = { x: c.x + dx * hw, y: c.y + dy * hh };
    return { p, n: radial(c, p) };
  }

  // Box (and everything else): where the ray from the center leaves the rectangle
  const k = 1 / Math.max(Math.abs(dx), Math.abs(dy));
  const p = { x: c.x + dx * k * hw, y: c.y + dy * k * hh };
  // Straight out of the side, or diagonally out of a corner
  const n =
    Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.05
      ? { x: Math.sign(dx) * Math.SQRT1_2, y: Math.sign(dy) * Math.SQRT1_2 }
      : Math.abs(dx) > Math.abs(dy)
        ? { x: Math.sign(dx), y: 0 }
        : { x: 0, y: Math.sign(dy) };

  // A lifeline: messages attach to the dashed line, below the head
  if (s.kind === "lifeline" && n.x !== 0 && p.y > s.y + LIFELINE_HEAD) return { p: { x: c.x, y: p.y }, n };

  // A pill has round ends: move points there from the rectangle onto the circle
  const r = hh;
  if (s.kind === "pill" && s.w >= s.h && Math.abs(p.x - c.x) > hw - r) {
    const cc = { x: c.x + Math.sign(dx) * (hw - r), y: c.y };
    // Solve |c + t·d - cc| = r for the ray d from the center
    const d = { x: dx * hw, y: dy * hh };
    const f = { x: c.x - cc.x, y: c.y - cc.y };
    const a = d.x * d.x + d.y * d.y;
    const b = 2 * (f.x * d.x + f.y * d.y);
    const cq = f.x * f.x + f.y * f.y - r * r;
    const t = (-b + Math.sqrt(Math.max(0, b * b - 4 * a * cq))) / (2 * a);
    const q = { x: c.x + d.x * t, y: c.y + d.y * t };
    return { p: q, n: radial(cc, q) };
  }
  return { p, n };
}

/** Inverse of `portAt`: the angle of the outline point in the direction of `p`. */
export function angleAt(s: Rect, p: Pt): number {
  const c = center(s);
  const a = (Math.atan2((p.y - c.y) / (s.h / 2 || 1), (p.x - c.x) / (s.w / 2 || 1)) * 180) / Math.PI;
  return (a + 360) % 360;
}

/** Picks the sides of a and b that face each other. */
export function pickSides(a: Rect, b: Rect): [Side, Side] {
  const ca = center(a);
  const cb = center(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const horizontal = Math.abs(dx) / ((a.w + b.w) / 2 || 1) > Math.abs(dy) / ((a.h + b.h) / 2 || 1);
  if (horizontal) return dx > 0 ? ["right", "left"] : ["left", "right"];
  return dy > 0 ? ["bottom", "top"] : ["top", "bottom"];
}

export interface EdgeGeom {
  d: string;
  /** The line as a polyline, for placing and dragging the label along it */
  points: Pt[];
}

/**
 * Bezier curve leaving both sides perpendicularly. With `bend` the middle of the
 * curve (t = 0.5) moves by that much: both control points shift by 4/3 of it.
 */
function curve(p1: Pt, n1: Pt, p2: Pt, n2: Pt, bend?: Pt | null): EdgeGeom {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const k = Math.max(20, Math.min(dist * 0.45, 140));
  const s = bend ? 4 / 3 : 0;
  const c1 = { x: p1.x + n1.x * k + s * (bend?.x ?? 0), y: p1.y + n1.y * k + s * (bend?.y ?? 0) };
  const c2 = { x: p2.x + n2.x * k + s * (bend?.x ?? 0), y: p2.y + n2.y * k + s * (bend?.y ?? 0) };
  const points: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    points.push({ x: a * p1.x + b * c1.x + c * c2.x + d * p2.x, y: a * p1.y + b * c1.y + c * c2.y + d * p2.y });
  }
  return { d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`, points };
}

/** Polyline with slightly rounded corners. */
function polyline(raw: Pt[]): EdgeGeom {
  // Drop duplicate points and points in the middle of a straight run
  const pts: Pt[] = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    const prev = pts[pts.length - 2];
    if (prev && last && (prev.x - last.x) * (last.y - p.y) === (prev.y - last.y) * (last.x - p.x)) pts.pop();
    pts.push(p);
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const r = Math.min(8, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
    const into = towards(b, a, r);
    const out = towards(b, c, r);
    d += ` L ${into.x} ${into.y} Q ${b.x} ${b.y}, ${out.x} ${out.y}`;
  }
  const end = pts[pts.length - 1];
  d += ` L ${end.x} ${end.y}`;
  return { d, points: pts };
}

/** The point at distance `r` from `from` in the direction of `to`. */
function towards(from: Pt, to: Pt, r: number): Pt {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: from.x + ((to.x - from.x) / len) * r, y: from.y + ((to.y - from.y) / len) * r };
}

/**
 * Sides for an elbow connector: straight across when the blocks overlap
 * horizontally or vertically (a Z shape), otherwise out of the side and into
 * the top or bottom (an L shape, like the "No" branch of a decision).
 */
function elbowSides(a: Rect, b: Rect): [Side, Side] {
  const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
  const overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
  if (overlapX || overlapY) return pickSides(a, b);
  const ca = center(a);
  const cb = center(b);
  return [cb.x > ca.x ? "right" : "left", cb.y > ca.y ? "top" : "bottom"];
}

/** Rounds a direction to the nearest of right, down, left and up. */
const axis = (n: Pt): Pt =>
  Math.abs(n.x) >= Math.abs(n.y) ? { x: Math.sign(n.x) || 1, y: 0 } : { x: 0, y: Math.sign(n.y) || 1 };

/** How far an elbow line goes straight out of a node before its first corner. */
const STUB = 20;

/** Horizontal and vertical segments from p1 (leaving in direction n1) to p2 (arriving from direction n2). */
function plainElbow(p1: Pt, n1: Pt, p2: Pt, n2: Pt): EdgeGeom {
  const a = { x: p1.x + n1.x * STUB, y: p1.y + n1.y * STUB };
  const b = { x: p2.x + n2.x * STUB, y: p2.y + n2.y * STUB };
  // Is `to` in front of `from`, looking in direction n?
  const ahead = (from: Pt, n: Pt, to: Pt) => (to.x - from.x) * n.x + (to.y - from.y) * n.y > 0;
  const h1 = n1.x !== 0;
  const h2 = n2.x !== 0;
  let mid: Pt[];

  if (h1 && h2) {
    if (n1.x === -n2.x && ahead(p1, n1, p2)) {
      // Facing each other: a Z
      const mx = (p1.x + p2.x) / 2;
      mid = [{ x: mx, y: p1.y }, { x: mx, y: p2.y }];
    } else if (n1.x === n2.x) {
      // Both out of the same side: go around past the furthest one
      const x = n1.x > 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x);
      mid = [{ x, y: p1.y }, { x, y: p2.y }];
    } else {
      // Back to back: out, across through the middle, and in
      const my = (p1.y + p2.y) / 2;
      mid = [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
    }
  } else if (!h1 && !h2) {
    if (n1.y === -n2.y && ahead(p1, n1, p2)) {
      const my = (p1.y + p2.y) / 2;
      mid = [{ x: p1.x, y: my }, { x: p2.x, y: my }];
    } else if (n1.y === n2.y) {
      const y = n1.y > 0 ? Math.max(a.y, b.y) : Math.min(a.y, b.y);
      mid = [{ x: p1.x, y }, { x: p2.x, y }];
    } else {
      const mx = (p1.x + p2.x) / 2;
      mid = [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
    }
  } else {
    // One horizontal, one vertical: an L when the corner is in front of both ends
    const corner = h1 ? { x: p2.x, y: p1.y } : { x: p1.x, y: p2.y };
    if (ahead(p1, n1, corner) && ahead(p2, n2, corner)) mid = [corner];
    else mid = [a, h1 ? { x: a.x, y: b.y } : { x: b.x, y: a.y }, b];
  }
  return polyline([p1, ...mid, p2]);
}

const pointRect = (p: Pt): Rect => ({ x: p.x, y: p.y, w: 0, h: 0 });

/**
 * The line from node a to node b. An end with an angle is attached there;
 * an end without one picks the side that faces the other end.
 */
// ---------- going around blocks ----------
// The same algorithm is in flow_svg.rs (`route`); fixtures/routing.json checks both.

/** Room kept around a block a line goes past */
const CLEARANCE = 8;
/** How far past a block the moved middle segment runs */
const CHANNEL = 20;
/** Blocks further than this from the line's ends are not looked at */
const REACH = 300;

/** How many blocks a right-angle route crosses (each segment against each block). */
export function crossings(points: Pt[], blocks: Rect[]): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    for (const r of blocks) {
      const x0 = r.x - CLEARANCE, x1 = r.x + r.w + CLEARANCE, y0 = r.y - CLEARANCE, y1 = r.y + r.h + CLEARANCE;
      const horizontal = a.y === b.y;
      const hit = horizontal
        ? a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1
        : a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
      if (hit) n++;
    }
  }
  return n;
}

/** Length of a right-angle route (exact: the segments are horizontal or vertical) */
export const routeLength = (points: Pt[]) =>
  points.slice(1).reduce((s, p, i) => s + Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y), 0);

/**
 * Block `r` as seen from a line that starts or ends on its border: without the
 * clearance `crossings` keeps, so leaving through its side is not a crossing,
 * but running back through it is.
 */
export const ownBlock = (r: Rect): Rect => ({ x: r.x + CLEARANCE + 1, y: r.y + CLEARANCE + 1, w: r.w - 2 * (CLEARANCE + 1), h: r.h - 2 * (CLEARANCE + 1) });

/** Does this right-angle route cross block `r`? */
const crosses = (points: Pt[], r: Rect) => crossings(points, [r]) > 0;

/**
 * Horizontal and vertical segments from p1 to p2 that go around `obstacles`:
 * the usual route when it is free, otherwise a detour around a block it hits, or
 * the middle in a channel past one. The route with the fewest crossings wins, then
 * the shortest. Only the blocks the usual route hits make detours, which keeps it fast.
 */
export function elbow(p1: Pt, n1: Pt, p2: Pt, n2: Pt, obstacles: Rect[] = []): EdgeGeom {
  const plain = plainElbow(p1, n1, p2, n2);
  if (!obstacles.length) return plain;
  // Only blocks near the line matter
  const box = { x: Math.min(p1.x, p2.x) - REACH, y: Math.min(p1.y, p2.y) - REACH, w: Math.abs(p2.x - p1.x) + 2 * REACH, h: Math.abs(p2.y - p1.y) + 2 * REACH };
  const near = obstacles.filter((r) => intersects(r, box));
  const blockers = near.filter((r) => crosses(plain.points, r));
  if (!blockers.length) return plain;

  const a = { x: p1.x + n1.x * STUB, y: p1.y + n1.y * STUB };
  const b = { x: p2.x + n2.x * STUB, y: p2.y + n2.y * STUB };
  const sorted = (vs: number[]) => [...new Set(vs)].sort((u, v) => u - v);
  const xs = sorted(blockers.flatMap((r) => [r.x - CHANNEL, r.x + r.w + CHANNEL]));
  const ys = sorted(blockers.flatMap((r) => [r.y - CHANNEL, r.y + r.h + CHANNEL]));
  // First a detour just around each block (over, under, left, right of it), then the
  // whole middle in a channel; on equal length the earlier one wins, so the line hugs the block
  const detours = blockers.flatMap((r) => {
    const [left, right, top, bottom] = [r.x - CHANNEL, r.x + r.w + CHANNEL, r.y - CHANNEL, r.y + r.h + CHANNEL];
    return [
      [p1, a, { x: left, y: a.y }, { x: left, y: top }, { x: right, y: top }, { x: right, y: b.y }, b, p2],
      [p1, a, { x: left, y: a.y }, { x: left, y: bottom }, { x: right, y: bottom }, { x: right, y: b.y }, b, p2],
      [p1, a, { x: a.x, y: top }, { x: left, y: top }, { x: left, y: bottom }, { x: b.x, y: bottom }, b, p2],
      [p1, a, { x: a.x, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: b.x, y: bottom }, b, p2],
    ];
  });
  const candidates = [
    ...detours.map(polyline),
    ...xs.map((x) => polyline([p1, a, { x, y: a.y }, { x, y: b.y }, b, p2])),
    ...ys.map((y) => polyline([p1, a, { x: a.x, y }, { x: b.x, y }, b, p2])),
  ];

  let best = plain;
  let bestCost = [crossings(plain.points, near), routeLength(plain.points)];
  for (const c of candidates) {
    const cost = [crossings(c.points, near), routeLength(c.points)];
    if (cost[0] < bestCost[0] || (cost[0] === bestCost[0] && cost[1] < bestCost[1])) {
      best = c;
      bestCost = cost;
    }
  }
  return best;
}

/**
 * An elbow line moved by `bend`: through the point where its middle would be
 * (the corner of an L), moved by that much. Still only horizontal and vertical segments.
 */
function bentElbow(p1: Pt, n1: Pt, p2: Pt, n2: Pt, bend: Pt): EdgeGeom {
  const plain = plainElbow(p1, n1, p2, n2);
  const ref = plain.points.length === 3 ? plain.points[1] : pointAlong(plain.points, 0.5);
  const b = { x: ref.x + bend.x, y: ref.y + bend.y };
  const h1 = n1.x !== 0;
  const h2 = n2.x !== 0;
  if (h1 && h2) return polyline([p1, { x: b.x, y: p1.y }, { x: b.x, y: p2.y }, p2]);
  if (!h1 && !h2) return polyline([p1, { x: p1.x, y: b.y }, { x: p2.x, y: b.y }, p2]);
  if (h1) return polyline([p1, { x: b.x, y: p1.y }, b, { x: p2.x, y: b.y }, p2]);
  return polyline([p1, { x: p1.x, y: b.y }, b, { x: b.x, y: p2.y }, p2]);
}

export function edgeBetween(
  a: Shape,
  b: Shape,
  style: EdgeStyle = "curved",
  fromAngle?: number | null,
  toAngle?: number | null,
  bend?: Pt | null,
  /** Blocks a right-angle line goes around (not for a line with a manual bend) */
  obstacles: Rect[] = [],
): EdgeGeom {
  const sides = style === "elbow" ? elbowSides : pickSides;
  const pa = fromAngle != null ? portAt(a, fromAngle) : null;
  const pb = toAngle != null ? portAt(b, toAngle) : null;
  const from = pa ?? portAt(a, SIDE_ANGLE[sides(a, pb ? pointRect(pb.p) : b)[0]]);
  const to = pb ?? portAt(b, SIDE_ANGLE[sides(pa ? pointRect(pa.p) : a, b)[1]]);

  if (style === "straight") {
    if (!bend) return { d: `M ${from.p.x} ${from.p.y} L ${to.p.x} ${to.p.y}`, points: [from.p, to.p] };
    // A corner where the middle was dragged to
    const mid = { x: (from.p.x + to.p.x) / 2 + bend.x, y: (from.p.y + to.p.y) / 2 + bend.y };
    return { d: `M ${from.p.x} ${from.p.y} L ${mid.x} ${mid.y} L ${to.p.x} ${to.p.y}`, points: [from.p, mid, to.p] };
  }
  if (style === "elbow") {
    return bend
      ? bentElbow(from.p, axis(from.n), to.p, axis(to.n), bend)
      : elbow(from.p, axis(from.n), to.p, axis(to.n), obstacles);
  }
  return curve(from.p, from.n, to.p, to.n, bend);
}

/** The line of an edge, given its two nodes (and the blocks a right-angle line goes around). */
export function edgeGeom(edge: FlowEdge, a: Shape, b: Shape, obstacles: Rect[] = []): EdgeGeom {
  // Both ends on the same node (free ends have no node)
  if (edge.from && edge.from === edge.to) return selfLoop(a, edge.fromAngle ?? 335, edge.toAngle ?? 25);
  return edgeBetween(a, b, edge.style ?? "curved", edge.fromAngle, edge.toAngle, edge.bend, obstacles);
}

/** An edge from a node back to itself: out, around and back in, with right angles. */
function selfLoop(s: Shape, fromAngle: number, toAngle: number): EdgeGeom {
  const from = portAt(s, fromAngle);
  const to = portAt(s, toAngle);
  return elbow(from.p, axis(from.n), to.p, axis(to.n));
}

/**
 * Where the small text at one end of an edge goes (multiplicity, role):
 * a bit along the line, beside it. Above a horizontal line, right of a vertical one.
 */
export function endLabelPoint(points: Pt[], end: "start" | "end"): Pt {
  const tip = lineEnd(points, end);
  const rad = (tip.angle * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };
  let side = { x: dir.y, y: -dir.x };
  if (side.y > 0.01 || (Math.abs(side.y) <= 0.01 && side.x < 0)) side = { x: -side.x, y: -side.y };
  // Past the longest cap (a diamond is 18 long), and beside the line
  return { x: tip.x - dir.x * 26 + side.x * 12, y: tip.y - dir.y * 26 + side.y * 12 };
}

/** For the edge being dragged: from a node to the cursor. */
export function edgeToPoint(a: Shape, p: Pt, style: EdgeStyle = "curved"): EdgeGeom {
  return edgeBetween(a, pointRect(p), style);
}

/** The point at fraction `t` (0..1) of the length of a polyline, and whether the line runs mostly horizontal there. */
export function pointAlong(points: Pt[], t: number): Pt & { horizontal: boolean } {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let rest = lengths.reduce((s, l) => s + l, 0) * Math.min(1, Math.max(0, t));
  for (let i = 0; i < lengths.length; i++) {
    if (rest <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] ? Math.min(1, rest / lengths[i]) : 0;
      const a = points[i];
      const b = points[i + 1];
      const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, horizontal };
    }
    rest -= lengths[i];
  }
  return { ...points[0], horizontal: true };
}

/** An end of a polyline, with the angle (degrees) pointing out of the line. For drawing arrowheads. */
export function lineEnd(points: Pt[], end: "start" | "end"): Pt & { angle: number } {
  const [inner, tip] = end === "end" ? points.slice(-2) : [points[1], points[0]];
  if (!inner) return { ...tip, angle: 0 };
  return { ...tip, angle: (Math.atan2(tip.y - inner.y, tip.x - inner.x) * 180) / Math.PI };
}

/** Inverse of `pointAlong`: the fraction of the polyline closest to `p`. */
export function nearestT(points: Pt[], p: Pt): number {
  let best = Infinity;
  let bestAt = 0;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const k = len ? Math.min(1, Math.max(0, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len))) : 0;
    const dist = Math.hypot(a.x + (b.x - a.x) * k - p.x, a.y + (b.y - a.y) * k - p.y);
    if (dist < best) {
      best = dist;
      bestAt = walked + len * k;
    }
    walked += len;
  }
  return walked ? bestAt / walked : 0.5;
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** True when `inner` lies completely inside `outer`. */
export const containsRect = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const containsPt = (r: Rect, p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
