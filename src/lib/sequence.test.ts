import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/sequence.json";
import { analyze } from "./sequence";
import type { FlowEdge, FlowNode } from "./types";

describe("activation bars (shared with flow_svg.rs)", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const { bars, colors } = analyze(c.nodes as FlowNode[], c.edges as FlowEdge[]);
      expect(Object.fromEntries(bars)).toEqual(c.bars);
      expect(Object.fromEntries(colors)).toEqual(c.colors);
    });
  }

  it("a message back to the caller is its return", () => {
    const c = fixture.cases[0];
    const { returns } = analyze(c.nodes as FlowNode[], c.edges as FlowEdge[]);
    expect([...returns].sort()).toEqual(["m3", "m4"]);
  });
});

describe("where messages attach", () => {
  it("a return leaves its own call's bar, also when another bar is on top", async () => {
    const { analyze, messageLine, BAR_W, NEST } = await import("./sequence");
    // Board 5 of the sequence tests: A and C both call B; A's call returns first
    const n = (id: string, x: number) => ({ id, kind: "lifeline" as const, x, y: 0, w: 140, h: 380, text: id, color: "white" as const });
    const nodes = [n("A", 0), n("B", 260), n("C", 520)];
    const edges = [
      { id: "m1", from: "A", to: "B", messageY: 100 },
      { id: "m2", from: "C", to: "B", messageY: 150 },
      { id: "m3", from: "B", to: "A", messageY: 200, pattern: "dashed" as const },
      { id: "m4", from: "B", to: "C", messageY: 260, pattern: "dashed" as const },
    ];
    const { bars } = analyze(nodes, edges);
    const centerB = 260 + 70;
    // "to A" leaves B's first bar (level 0) on its left side, not the one on top of it
    expect(messageLine(edges[2], nodes[1], nodes[0], bars).points[0].x).toBe(centerB - BAR_W / 2);
    // "from C" arrives at the bar it starts (level 1), on its right side
    expect(messageLine(edges[1], nodes[2], nodes[1], bars).points[1].x).toBe(centerB + NEST + BAR_W / 2);
  });
});
