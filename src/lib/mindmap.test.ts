import { describe, expect, it } from "vitest";
import { childrenOf, layoutTree, parentOf, rootOf } from "./mindmap";
import type { FlowEdge, FlowNode } from "./types";

const topic = (id: string, x = 0, y = 0): FlowNode => ({ id, kind: "topic", x, y, w: 160, h: 40, text: id, color: "white" });
const line = (from: string, to: string): FlowEdge => ({ id: `${from}-${to}`, from, to });

describe("mind map", () => {
  const nodes = [topic("root"), topic("a", 0, 10), topic("b", 0, 20), topic("a1", 0, 5), topic("a2", 0, 6)];
  const edges = [line("root", "a"), line("root", "b"), line("a", "a1"), line("a", "a2")];

  it("knows parents, children and the root", () => {
    expect(parentOf("a1", nodes, edges)).toBe("a");
    expect(childrenOf("root", nodes, edges).map((n) => n.id)).toEqual(["a", "b"]);
    expect(rootOf("a2", nodes, edges)).toBe("root");
  });

  it("puts subtopics in a column to the right, centered on their topic, without overlap", () => {
    const pos = layoutTree("root", nodes, edges);
    expect(pos.get("root")).toEqual({ x: 0, y: 0 });
    // One column further per level
    expect(pos.get("a")!.x).toBe(pos.get("b")!.x);
    expect(pos.get("a1")!.x).toBeGreaterThan(pos.get("a")!.x);
    // a's subtree (two topics) is taller than b: a above b, no overlap, a in the middle of a1 and a2
    expect(pos.get("a")!.y + 40).toBeLessThanOrEqual(pos.get("b")!.y);
    expect(pos.get("a1")!.y + 40).toBeLessThanOrEqual(pos.get("a2")!.y);
    const mid = (pos.get("a1")!.y + pos.get("a2")!.y + 40) / 2;
    expect(Math.abs(pos.get("a")!.y + 20 - mid)).toBeLessThanOrEqual(10);
  });
});
