import { describe, expect, it } from "vitest";
import { mergeList, mergeSnap, sameSnap } from "./merge";

const a = { id: "a", text: "A", x: 0 };
const b = { id: "b", text: "B", x: 10 };
const c = { id: "c", text: "C", x: 20 };

describe("merging changes from before a board was live", () => {
  it("keeps a block we added and one they added", () => {
    const out = mergeList([a, b], [a, { id: "n", text: "Made offline" }, b], [a, b, c]);
    expect(out.map((i) => i.id)).toEqual(["a", "n", "b", "c"]);
  });
  it("takes our changed fields and their other fields", () => {
    const out = mergeList([a], [{ ...a, text: "Ours" }], [{ ...a, x: 99 }]);
    expect(out).toEqual([{ id: "a", text: "Ours", x: 99 }]);
  });
  it("drops what we deleted, keeps what they deleted deleted", () => {
    expect(mergeList([a, b], [b], [a, b]).map((i) => i.id)).toEqual(["b"]);
    expect(mergeList([a, b], [a, b], [a]).map((i) => i.id)).toEqual(["a"]);
  });
  it("keeps an item they deleted when we changed it", () => {
    expect(mergeList([a, b], [a, { ...b, text: "Kept" }], [a]).map((i) => i.text)).toEqual(["A", "Kept"]);
  });
  it("removes a field we removed", () => {
    expect(mergeList([{ ...a, svg: "old" }], [a], [{ ...a, svg: "old" }])).toEqual([a]);
  });
  it("merges settings: ours when we changed them, else theirs", () => {
    const base = { lists: { nodes: [a] }, values: { look: null, diagram: "flowchart" } };
    const ours = { lists: { nodes: [a] }, values: { look: "sketch", diagram: "flowchart" } };
    const theirs = { lists: { nodes: [a] }, values: { diagram: "activity" } };
    expect(mergeSnap(base, ours, theirs).values).toEqual({ look: "sketch", diagram: "activity" });
  });
  it("sees nothing to merge when only theirs changed", () => {
    const base = { lists: { nodes: [a] }, values: {} };
    const theirs = { lists: { nodes: [a, b] }, values: {} };
    expect(sameSnap(mergeSnap(base, base, theirs), theirs)).toBe(true);
  });
});
