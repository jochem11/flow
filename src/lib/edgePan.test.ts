import { describe, expect, it } from "vitest";
import { EDGE_SPEED, EDGE_ZONE, edgeSpeed } from "./edgePan";

const LOW = 100;
const HIGH = 1100;

describe("edgeSpeed", () => {
  it("leaves the board alone away from the edges", () => {
    expect(edgeSpeed(600, LOW, HIGH, 500)).toBe(0);
    expect(edgeSpeed(LOW + EDGE_ZONE, LOW, HIGH, 500)).toBe(0);
    expect(edgeSpeed(HIGH - EDGE_ZONE, LOW, HIGH, 500)).toBe(0);
  });
  it("moves the board towards the edge the pointer is at", () => {
    expect(edgeSpeed(LOW + 10, LOW, HIGH, 500)).toBeGreaterThan(0);
    expect(edgeSpeed(HIGH - 10, LOW, HIGH, 500)).toBeLessThan(0);
  });
  it("goes faster nearer the edge, up to the fastest, also past it", () => {
    const far = edgeSpeed(LOW + 40, LOW, HIGH, 500);
    const near = edgeSpeed(LOW + 5, LOW, HIGH, 500);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThan(0);
    expect(edgeSpeed(LOW, LOW, HIGH, 500)).toBe(EDGE_SPEED);
    expect(edgeSpeed(LOW - 300, LOW, HIGH, 500)).toBe(EDGE_SPEED);
    expect(edgeSpeed(HIGH + 300, LOW, HIGH, 500)).toBe(-EDGE_SPEED);
  });
  it("does not move for a drag going away from the edge it started at", () => {
    expect(edgeSpeed(LOW + 20, LOW, HIGH, LOW + 10)).toBe(0);
    expect(edgeSpeed(HIGH - 20, LOW, HIGH, HIGH - 10)).toBe(0);
    expect(edgeSpeed(LOW + 5, LOW, HIGH, LOW + 10)).toBeGreaterThan(0);
  });
  it("never moves on a board without width", () => {
    expect(edgeSpeed(100, 100, 100, 50)).toBe(0);
  });
});
