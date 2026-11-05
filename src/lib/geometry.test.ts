import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/routing.json";
import { alignRects, angleAt, distributeRects, elbow, nearestT, pointAlong, portAt, resizeRect } from "./geometry";

describe("right-angle routes (shared with flow_svg.rs)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(elbow(c.p1, c.n1, c.p2, c.n2, c.obstacles).points).toEqual(c.points);
    });
  }
});

/** Equal up to floating point rounding */
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("outline points", () => {
  const box = { x: 0, y: 0, w: 200, h: 100, kind: "box" as const };
  it("angles map to sides and corners", () => {
    near(portAt(box, 0).p, { x: 200, y: 50 });
    near(portAt(box, 45).p, { x: 200, y: 100 });
    near(portAt({ ...box, kind: "diamond" }, 45).p, { x: 150, y: 75 });
  });
  it("angleAt is the inverse of portAt", () => {
    for (const a of [10, 80, 135, 200, 300]) {
      expect(angleAt(box, portAt(box, a).p)).toBeCloseTo(a, 6);
    }
  });
});

describe("along a line", () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
  it("finds points by fraction and back", () => {
    expect(pointAlong(line, 0.5)).toMatchObject({ x: 100, y: 0 });
    expect(nearestT(line, { x: 100, y: 50 })).toBeCloseTo(0.75);
  });
});

describe("resizing by a side or corner", () => {
  const r = { x: 100, y: 100, w: 200, h: 100 };
  const min = { w: 50, h: 40 };
  const grid = (v: number) => Math.round(v / 10) * 10;

  it("moves only the dragged sides", () => {
    expect(resizeRect(r, "e", 30, 99, min)).toEqual({ x: 100, y: 100, w: 230, h: 100 });
    expect(resizeRect(r, "n", 99, -20, min)).toEqual({ x: 100, y: 80, w: 200, h: 120 });
    expect(resizeRect(r, "sw", -40, 15, min)).toEqual({ x: 60, y: 100, w: 240, h: 115 });
    expect(resizeRect(r, "nw", 20, 20, min)).toEqual({ x: 120, y: 120, w: 180, h: 80 });
  });

  it("keeps the opposite side in place at the smallest size", () => {
    expect(resizeRect(r, "w", 500, 0, min)).toEqual({ x: 250, y: 100, w: 50, h: 100 });
    expect(resizeRect(r, "s", 0, -500, min)).toEqual({ x: 100, y: 100, w: 200, h: 40 });
  });

  it("puts the moved side on the grid", () => {
    expect(resizeRect(r, "ne", 13, -7, min, grid)).toEqual({ x: 100, y: 90, w: 210, h: 110 });
  });
});

describe("align and distribute", () => {
  const a = { id: "a", x: 0, y: 0, w: 100, h: 40 };
  const b = { id: "b", x: 200, y: 50, w: 60, h: 20 };
  const c = { id: "c", x: 500, y: 10, w: 100, h: 40 };

  it("lines up on the outer edge or the middle", () => {
    expect(alignRects([a, b], "left").get("b")).toEqual({ x: 0, y: 50 });
    expect(alignRects([a, b], "right").get("a")).toEqual({ x: 160, y: 0 });
    expect(alignRects([a, b], "middle").get("b")).toEqual({ x: 200, y: 25 });
  });

  it("makes the gaps equal, the outer ones staying", () => {
    const d = distributeRects([c, a, b], "x");
    expect(d.get("a")).toEqual({ x: 0, y: 0 });
    expect(d.get("c")).toEqual({ x: 500, y: 10 });
    // 600 wide, 260 of items: two gaps of 170
    expect(d.get("b")).toEqual({ x: 270, y: 50 });
    expect(distributeRects([a, b], "x").size).toBe(0);
  });
});
