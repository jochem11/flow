import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { listIn, positions, readList, writeList } from "./ylist";

/** Two people's copies of a document, kept in sync like the server does. */
function pair() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(b, u, "remote"));
  b.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(a, u, "remote"));
  return { a, b };
}

const shape = { children: { attributes: {} } };
const list = (d: Y.Doc) => listIn(d.getMap("root"), "items");
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("ylist", () => {
  it("keeps positions of items that stay in order", () => {
    const cur = new Map([["a", 1], ["b", 2], ["c", 3]]);
    // c moved to the front: only c gets a new position
    const p = positions(["c", "a", "b"], (id) => cur.get(id));
    expect([p.get("a"), p.get("b")]).toEqual([1, 2]);
    expect(p.get("c")!).toBeLessThan(1);
  });

  it("round-trips items with nested lists", () => {
    const d = new Y.Doc();
    const items = [{ id: "t", name: "order", x: 1, attributes: [{ id: "c1", name: "id" }, { id: "c2", name: "total", nullable: true }] }];
    writeList(list(d), items, shape);
    expect(readList(list(d), shape)).toEqual(items);
  });

  it("merges changes to different fields and items", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    writeList(list(a), [{ id: "n1", x: 0, text: "A" }, { id: "n2", x: 0, text: "B" }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // At the same time (before either sees the other): Ann moves n1, Bob renames n1 and adds n3
    writeList(list(a), [{ id: "n1", x: 50, text: "A" }, { id: "n2", x: 0, text: "B" }]);
    writeList(list(b), [{ id: "n1", x: 0, text: "Start" }, { id: "n2", x: 0, text: "B" }, { id: "n3", x: 9, text: "C" }]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ra = readList(list(a));
    expect(ra).toEqual(readList(list(b)));
    expect(ra.find((n) => n.id === "n1")).toMatchObject({ x: 50, text: "Start" });
    expect(ids(ra)).toEqual(["n1", "n2", "n3"]);
  });

  it("never doubles or loses an item moved by two people at once", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    writeList(list(a), [{ id: "1" }, { id: "2" }, { id: "3" }, { id: "4" }]);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    // Offline from each other: both move item 1, to different places
    writeList(list(a), [{ id: "2" }, { id: "1" }, { id: "3" }, { id: "4" }]);
    writeList(list(b), [{ id: "2" }, { id: "3" }, { id: "4" }, { id: "1" }]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const order = ids(readList(list(a)));
    expect(order).toEqual(ids(readList(list(b))));
    expect([...order].sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("deletes win over edits of a removed item, and removed fields go", () => {
    const { a, b } = pair();
    writeList(list(a), [{ id: "n", text: "x", color: "blue" }]);
    writeList(list(b), [{ id: "n", text: "x" }]);
    expect(readList(list(a))[0]).toEqual({ id: "n", text: "x" });
    writeList(list(a), []);
    expect(readList(list(b))).toEqual([]);
  });
});
