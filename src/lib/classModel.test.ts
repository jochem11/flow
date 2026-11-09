import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/classRows.json";
import { formatAttribute, formatClass, formatOperation, parseAttribute, parseClass, parseOperation, type Attribute, type Operation } from "./classModel";

describe("class rows (shared with crates/flow-core/src/uml)", () => {
  for (const c of fixture.attributes) {
    it(`attribute: ${c.row}`, () => {
      const a = parseAttribute(c.row);
      expect(a).toEqual(c.parsed);
      if (a) expect(formatAttribute(a)).toBe(c.written ?? c.row);
    });
  }
  for (const c of fixture.operations) {
    it(`operation: ${c.row}`, () => {
      const o = parseOperation(c.row);
      expect(o).toEqual(c.parsed);
      if (o) expect(formatOperation(o)).toBe(c.written ?? c.row);
    });
  }
});

describe("a class as a structure", () => {
  it("reads and writes a whole class, keeping rows it does not understand", () => {
    const text = "«entity»\nRepository<T, K>\n--\n- items: Map<K, T>\nnot an attribute\n--\n+ find(id: K): T?";
    const c = parseClass(text);
    expect(c.name).toBe("Repository");
    expect(c.typeParams).toEqual(["T", "K"]);
    expect(c.stereotypes).toEqual(["«entity»"]);
    expect((c.attributes[0] as Attribute).type).toBe("Map<K, T>");
    expect(c.attributes[1]).toEqual({ raw: "not an attribute" });
    expect((c.operations[0] as Operation).returns).toBe("T?");
    expect(formatClass(c)).toBe(text);
  });

  it("an enum has values, with or without one", () => {
    const c = parseClass("«enum»\nStatus\n--\nNew\nPaid = 2\n--\n");
    expect(c.kind).toBe("enum");
    expect(c.values).toEqual([{ name: "New", value: null }, { name: "Paid", value: "2" }]);
    expect(formatClass({ ...c, values: [...c.values, { name: "Shipped", value: null }] })).toBe("«enum»\nStatus\n--\nNew\nPaid = 2\nShipped\n--\n");
  });
});

describe("level of detail (as row_shown in crates/flow-core/src/uml)", () => {
  it("public members only, or names only", async () => {
    const { rowShown } = await import("./classModel");
    expect([rowShown(1, "class", "- id: int", "public"), rowShown(1, "class", "+ name: string", "public"), rowShown(1, "class", "id: int", "public")]).toEqual([false, true, false]);
    expect([rowShown(2, "class", "- check()", "public"), rowShown(2, "class", "total(): int", "public")]).toEqual([false, true]);
    expect([rowShown(1, "enum", "Paid", "public"), rowShown(1, "class", "+ name: string", "names"), rowShown(0, "class", "Order", "names")]).toEqual([true, false, true]);
  });
});
