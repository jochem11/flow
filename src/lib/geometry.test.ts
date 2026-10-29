import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/routing.json";
import { angleAt, elbow, nearestT, pointAlong, portAt } from "./geometry";

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
