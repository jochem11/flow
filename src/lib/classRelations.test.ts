import { describe, expect, it } from "vitest";
import { isMany, relationMeaning } from "./classRelations";
import type { FlowEdge } from "./types";

const order = { name: "Order", kind: "class" as const };
const line = { name: "OrderLine", kind: "class" as const };
const payable = { name: "Payable", kind: "interface" as const };
const edge = (props: Partial<FlowEdge>): FlowEdge => ({ id: "e", from: "a", to: "b", ...props });

describe("what a line between classes means in UML", () => {
  it("reads multiplicities", () => {
    expect([isMany("*"), isMany("0..*"), isMany("1..5"), isMany("0..1"), isMany("1"), isMany(undefined)]).toEqual([true, true, true, false, false, false]);
  });

  it("says what an association, aggregation or composition holds", () => {
    expect(relationMeaning(edge({ endCap: "open", endLabel: "*" }), order, line)).toBe("Order has a list of OrderLine.");
    expect(relationMeaning(edge({ startCap: "diamond", endCap: "none" }), order, line)).toBe("Order owns one OrderLine (or none).");
    // A diamond at the end: the class there is the whole
    expect(relationMeaning(edge({ endCap: "hollowDiamond", startLabel: "1..*" }), line, order)).toBe("Order has a list of OrderLine.");
  });

  it("inheritance, realization and dependency", () => {
    expect(relationMeaning(edge({ endCap: "triangle" }), order, line)).toBe("Order extends OrderLine.");
    expect(relationMeaning(edge({ endCap: "triangle" }), order, payable)).toBe("Order implements Payable.");
    expect(relationMeaning(edge({ endCap: "open", pattern: "dashed" }), order, line)).toBe("Order uses OrderLine (a dependency).");
  });
});
