import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/classRows.json";
import { formatAttribute, formatClass, formatOperation, parseAttribute, parseClass, parseOperation, type Attribute, type Operation } from "./classModel";

describe("class rows (shared with codegen/read.rs)", () => {
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

describe("rows in a programming language", () => {
  it("shows types as the board's language writes them", async () => {
    const { rowIn } = await import("./classModel");
    expect(rowIn(1, "class", "- lines: List<OrderLine>", "java")).toBe("- lines: List<OrderLine>");
    expect(rowIn(1, "class", "- owner: Customer?", "typescript")).toBe("- owner: Customer | null");
    expect(rowIn(2, "class", "+ find(id: uuid): Order?", "go")).toBe("+ find(id: string): *Order");
    expect(rowIn(1, "class", "not uml", "go")).toBe("not uml");
  });

  it("reads what is typed back to neutral, keeping types that read the same", async () => {
    const { rowFrom } = await import("./classModel");
    expect(rowFrom(1, "class", "- owner: Customer | null", "typescript")).toBe("- owner: Customer?");
    // `number` stays `int` when it was `int`; a new name keeps the type
    expect(rowFrom(1, "class", "- total: number", "typescript", "- count: int")).toBe("- total: int");
    expect(rowFrom(2, "class", "+ find(id: string): *Order", "go", "+ find(id: uuid): Order?")).toBe("+ find(id: uuid): Order?");
    expect(rowFrom(2, "class", "+ all(): []Order", "go")).toBe("+ all(): List<Order>");
  });
});

describe("generating members", () => {
  it("getters and setters, not twice, and no setter for read-only", async () => {
    const { formatClass, parseClass, withAccessors } = await import("./classModel");
    const c = parseClass("Order\n--\n- id: int {readOnly}\n- paid: bool\n- static count: int\n--\n+ getId(): int");
    expect(formatClass(withAccessors(c))).toBe("Order\n--\n- id: int {readOnly}\n- paid: bool\n- static count: int\n--\n+ getId(): int\n+ isPaid(): bool\n+ setPaid(paid: bool)");
  });

  it("a constructor with every attribute, first, once", async () => {
    const { formatClass, parseClass, withConstructor } = await import("./classModel");
    const c = withConstructor(parseClass("Order\n--\n- id: int\n- lines: List<OrderLine>\n--\n+ total(): decimal"));
    expect(formatClass(c)).toBe("Order\n--\n- id: int\n- lines: List<OrderLine>\n--\n+ Order(id: int, lines: List<OrderLine>)\n+ total(): decimal");
    expect(withConstructor(c)).toBe(c);
  });

  it("what an interface or abstract class asks for", async () => {
    const { missingOperations, parseClass } = await import("./classModel");
    const shape = parseClass("«abstract»\nShape\n--\n--\n+ area(): double {abstract}\n+ name(): string");
    const drawable = parseClass("«interface»\nDrawable\n--\n--\n+ draw(): void");
    const circle = parseClass("Circle\n--\n- r: double\n--\n+ name(): string");
    expect(missingOperations(circle, [shape, drawable]).map((o) => `${o.name}:${o.abstract}`)).toEqual(["area:false", "draw:false"]);
  });
});
