import { describe, expect, it } from "vitest";
import type { DocContent } from "./types";
import { diffVersion } from "./versionDiff";

const flow = (nodes: { id: string; text: string }[], edges: { id: string; from: string; to: string }[] = []) =>
  ({ kind: "flow", data: { nodes: nodes.map((n) => ({ ...n, kind: "box", x: 0, y: 0, w: 1, h: 1, color: "white" })), edges, camera: { x: 0, y: 0, zoom: 1 } } }) as unknown as DocContent;

describe("what changed since a version", () => {
  it("marks blocks gone or changed since, and counts what was added", () => {
    const old = flow([{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], [{ id: "e", from: "a", to: "b" }]);
    const now = flow([{ id: "a", text: "A" }, { id: "b", text: "B changed" }, { id: "d", text: "D" }, { id: "f", text: "F" }]);
    const d = diffVersion(old, now);
    expect([...d.marks]).toEqual([["b", "changed"], ["c", "gone"], ["e", "gone"]]);
    expect(d.summary).toBe("2 blocks added, 1 removed, 1 changed; 1 line removed");
  });
  it("nothing changed", () => {
    const same = flow([{ id: "a", text: "A" }]);
    expect(diffVersion(same, same)).toEqual({ marks: new Map(), summary: "" });
  });
  it("kanban cards, also moved to another column", () => {
    const board = (cols: [string, string[]][]) =>
      ({ kind: "kanban", data: { columns: cols.map(([id, cards]) => ({ id, title: id, cards: cards.map((c) => ({ id: c, title: c })) })) } }) as unknown as DocContent;
    const d = diffVersion(board([["todo", ["x", "y"]], ["done", []]]), board([["todo", ["y"]], ["done", ["x", "z"]]]));
    expect(d.marks.get("x")).toBe("changed");
    expect(d.summary).toBe("1 card added, 1 changed");
  });
  it("a document's lines", () => {
    const text = (markdown: string) => ({ kind: "text", data: { markdown } }) as unknown as DocContent;
    expect(diffVersion(text("# Title\nOne\nTwo"), text("# Title\nOne\nThree\nFour")).summary).toBe("2 lines added, 1 removed");
  });
});
