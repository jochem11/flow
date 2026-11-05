import { describe, expect, it } from "vitest";
import { guidesFor, nearestLine, snapBox, snapLines } from "./snapping";

describe("smart guides", () => {
  const other = { x: 100, y: 100, w: 100, h: 50 };
  const lines = snapLines([other]);

  it("snaps the closest edge or center within reach", () => {
    // Left edge 3 away from the other's left edge
    expect(snapBox({ x: 103, y: 300, w: 80, h: 40 }, lines, 6)).toEqual({ dx: -3, dy: null });
    // Right edge 197 is 3 from the other's right edge 200
    expect(snapBox({ x: 117, y: 300, w: 80, h: 40 }, lines, 6).dx).toBe(3);
    // Of 122 / 127 / 132, the center 127 is closest to the other's center 125
    expect(snapBox({ x: 400, y: 122, w: 80, h: 10 }, lines, 6)).toEqual({ dx: null, dy: -2 });
  });

  it("does not snap from further away", () => {
    // 120 / 140 / 160 against 100 / 150 / 200: all 10 or more away
    expect(snapBox({ x: 120, y: 300, w: 40, h: 40 }, lines, 6)).toEqual({ dx: null, dy: null });
    expect(nearestLine(50, [0, 100], 10)).toBeNull();
    expect(nearestLine(95, [0, 100], 10)).toBe(100);
  });

  it("draws a guide over both items for each shared line", () => {
    const g = guidesFor({ x: 100, y: 300, w: 80, h: 40 }, [other]);
    expect(g).toEqual([{ axis: "x", at: 100, from: 100, to: 340 }]);
  });
});
