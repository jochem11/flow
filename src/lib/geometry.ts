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

const NORMAL: Record<Side, Pt> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Midden van een zijde. Bij een ruit is dat precies de punt. */
export function anchor(r: Rect, side: Side): Pt {
  switch (side) {
    case "left":
      return { x: r.x, y: r.y + r.h / 2 };
    case "right":
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case "top":
      return { x: r.x + r.w / 2, y: r.y };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h };
  }
}

/** Kies welke zijdes van a en b naar elkaar wijzen. */
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
  mid: Pt;
}

/** Bezier-curve die loodrecht uit beide zijdes vertrekt. */
function curve(p1: Pt, n1: Pt, p2: Pt, n2: Pt): EdgeGeom {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const k = Math.max(20, Math.min(dist * 0.45, 140));
  const c1 = { x: p1.x + n1.x * k, y: p1.y + n1.y * k };
  const c2 = { x: p2.x + n2.x * k, y: p2.y + n2.y * k };
  return {
    d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
    // punt op t = 0.5
    mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 },
  };
}

export function edgeBetween(a: Rect, b: Rect): EdgeGeom {
  const [sa, sb] = pickSides(a, b);
  return curve(anchor(a, sa), NORMAL[sa], anchor(b, sb), NORMAL[sb]);
}

/** Voor de lijn die je aan het slepen bent: van node naar cursor. */
export function edgeToPoint(a: Rect, p: Pt): EdgeGeom {
  const [sa] = pickSides(a, { x: p.x, y: p.y, w: 0, h: 0 });
  const n = NORMAL[sa];
  return curve(anchor(a, sa), n, p, { x: -n.x, y: -n.y });
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

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
