import { describe, expect, it } from "vitest";
import { checkDesign, MAX_PER_GROUP } from "./designChecks";
import type { FlowEdge, FlowNode, NodeKind } from "./types";

const node = (id: string, kind: NodeKind, text = id, extra: Partial<FlowNode> = {}): FlowNode =>
  ({ id, kind, x: 0, y: 0, w: 180, h: 60, text, color: "white", ...extra }) as FlowNode;
const line = (from: string, to: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({ id: `${from}-${to}`, from, to, ...extra }) as FlowEdge;
const messages = (ps: ReturnType<typeof checkDesign>) => ps.map((p) => p.message);

describe("design checks", () => {
  it("checks nothing on a whiteboard", () => {
    expect(checkDesign([node("a", "diamond"), node("b", "box")], [line("a", "b")], "whiteboard")).toEqual([]);
    expect(checkDesign([node("a", "diamond")], [], null)).toEqual([]);
  });

  it("wants decisions with two labelled ways out, and joined, reachable steps", () => {
    const nodes = [node("s", "start", ""), node("a", "box", "Order"), node("d", "diamond", "Paid?"), node("b", "box", "Ship"), node("c", "box", "Cancel"), node("x", "box", "Lonely"), node("u", "box", "Orphan"), node("v", "box", "Orphan 2")];
    const edges = [line("s", "a"), line("a", "d"), line("d", "b", { label: "yes" }), line("d", "c"), line("u", "v")];
    const msgs = messages(checkDesign(nodes, edges, "flowchart"));
    expect(msgs).toContain("“Lonely” is not joined to anything");
    expect(msgs).toContain("Say which way is which out of “Paid?” (yes / no on its lines)");
    expect(msgs).toContain("2 blocks can't be reached from the start");
    expect(msgs.some((m) => m.includes("only one way out"))).toBe(false);

    const one = messages(checkDesign([node("d", "diamond", "Ok?"), node("b", "box")], [line("d", "b")], "flowchart"));
    expect(one).toContain("“Ok?” has only one way out: a decision needs two or more");
    // A merge: two in, one out
    const merge = messages(checkDesign([node("a", "box"), node("b", "box"), node("m", "diamond", ""), node("c", "box")], [line("a", "m"), line("b", "m"), line("m", "c")], "activity"));
    expect(merge.some((m) => m.includes("only one way out"))).toBe(false);
  });

  it("follows lines into and out of sections", () => {
    const nodes = [node("s", "start", ""), node("g", "section", "Shop"), node("a", "box", "In", { parent: "g" }), node("b", "box", "Also in", { parent: "g" }), node("c", "box", "After")];
    // Into the section reaches both blocks in it; out of the section leaves them
    expect(messages(checkDesign(nodes, [line("s", "g"), line("a", "b"), line("g", "c")], "flowchart")).filter((m) => m.includes("reached"))).toEqual([]);
    // Into one block in it does not reach the other
    expect(messages(checkDesign(nodes, [line("s", "a"), line("b", "c")], "flowchart"))).toContain("2 blocks can't be reached from the start");
  });

  it("says when too much is in focus", () => {
    const ns = ["a", "b", "c"].map((id) => node(id, "box", id, { focal: true }));
    const edges = [line("a", "b"), line("b", "c")];
    expect(messages(checkDesign(ns, edges, "flowchart"))).toContain("3 blocks are in focus: one or two stand out, more do not");
    expect(messages(checkDesign(ns.slice(0, 2), edges.slice(0, 1), "flowchart")).some((m) => m.includes("focus"))).toBe(false);
  });

  it("finds lines into a start and out of an end", () => {
    const msgs = messages(checkDesign([node("s", "start", ""), node("e", "end", ""), node("a", "box")], [line("a", "s"), line("e", "a")], "state"));
    expect(msgs).toContain("A line goes into the start");
    expect(msgs).toContain("A line leaves an end");
  });

  it("says when a section holds too much", () => {
    const section = node("g", "section", "Warehouse");
    const inside = Array.from({ length: MAX_PER_GROUP + 1 }, (_, i) => node(`n${i}`, "box", `Step ${i}`, { parent: "g" }));
    const edges = inside.slice(1).map((n, i) => line(inside[i].id, n.id));
    expect(messages(checkDesign([section, ...inside], edges, "flowchart"))).toContain(`“Warehouse” holds ${MAX_PER_GROUP + 1} blocks: split it, so each part reads at a glance`);
  });

  it("finds doubled class names and empty enums", () => {
    const ps = checkDesign([node("a", "class", "Order\n--\n--"), node("b", "class", "order\n--\n--"), node("e", "class", "«enum»\nStatus\n--\n--")], [], "class");
    expect(ps[0]).toMatchObject({ nodeIds: ["a", "b"], level: "warning", message: "There are two classes called order" });
    expect(messages(ps)).toContain("The enum Status has no values");
  });

  it("finds silent lifelines and calls without a name", () => {
    const nodes = [node("a", "lifeline", "Client"), node("b", "lifeline", "Server"), node("c", "lifeline", "Cache")];
    const edges = [line("a", "b", { messageY: 80 }), line("b", "a", { messageY: 120, pattern: "dashed" })];
    const msgs = messages(checkDesign(nodes, edges, "sequence"));
    expect(msgs).toContain("“Cache” sends and gets no messages");
    // The call has no name; its (dashed) return does not need one
    expect(msgs).toContain("A call has no name");
  });
});
