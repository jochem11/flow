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
