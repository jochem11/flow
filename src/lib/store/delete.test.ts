import { describe, expect, it } from "vitest";
import type { FlowNode } from "../types";
import { board, deleteSelection, replaceBoard, select, unwrapSelection } from "./index";

const n = (id: string, kind: FlowNode["kind"], x: number, y: number, w: number, h: number, extra: Partial<FlowNode> = {}): FlowNode =>
  ({ id, kind, x, y, w, h, text: id, color: "white", ...extra }) as FlowNode;

/** An outer section holding an inner section with a block, a block of its own and a locked note */
function start() {
  replaceBoard({
    nodes: [
      n("outer", "section", 0, 0, 800, 600),
      n("inner", "section", 40, 40, 400, 300, { parent: "outer" }),
      n("a", "box", 80, 100, 180, 60, { parent: "inner" }),
      n("b", "box", 500, 100, 180, 60, { parent: "outer" }),
      n("pinned", "note", 500, 400, 180, 80, { parent: "outer", locked: true }),
      n("c", "box", 1000, 100, 180, 60),
    ],
    edges: [
      { id: "ab", from: "a", to: "b" },
      { id: "bc", from: "b", to: "c" },
    ],
    camera: { x: 0, y: 0, zoom: 1 },
  } as never);
}

const ids = () => board.nodes.map((x) => x.id).sort();

describe("deleting frames", () => {
  it("deletes a section with what is in it (a locked item stays)", () => {
    start();
    select(["outer"]);
    deleteSelection();
    expect(ids()).toEqual(["c", "pinned"]);
    expect(board.edges).toEqual([]);
    expect(board.nodes.find((x) => x.id === "pinned")?.parent).toBeUndefined();
  });

  it("unwraps a section: only the frame goes", () => {
    start();
    select(["inner"]);
    unwrapSelection();
    expect(ids()).toEqual(["a", "b", "c", "outer", "pinned"]);
    // What was in it belongs to the frame around it now
    expect(board.nodes.find((x) => x.id === "a")?.parent).toBe("outer");
    expect(board.edges.map((e) => e.id)).toEqual(["ab", "bc"]);
  });

  it("deletes a plain block as before", () => {
    start();
    select(["b"]);
    deleteSelection();
    expect(ids()).toEqual(["a", "c", "inner", "outer", "pinned"]);
    expect(board.edges).toEqual([]);
  });
});
