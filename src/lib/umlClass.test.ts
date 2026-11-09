import { describe, expect, it } from "vitest";
import { classKind, className, fixOperation, rowProblem, withClassKind } from "./umlClass";

describe("UML notation of rows", () => {
  it("accepts attributes and operations in UML notation, with any type", () => {
    for (const row of ["- total: Money = 0", "+ lines: List<OrderLine>", "+ customer: Customer?", "{static} count: int", "- owner: SomeClassElsewhere"]) {
      expect(rowProblem("class", 1, row), row).toBeNull();
    }
    for (const row of ["+ pay(amount: double, note: string): bool", "+ cancel()", "+ find(id: uuid): Order?"]) {
      expect(rowProblem("class", 2, row), row).toBeNull();
    }
  });
  it("marks rows that are not UML notation", () => {
    expect(rowProblem("class", 1, "int total")).toMatch(/Write an attribute as/);
    expect(rowProblem("class", 1, "- total price: int")).toMatch(/Write an attribute as/);
    expect(rowProblem("class", 2, "+ pay(double amount): bool")).toMatch(/Write an operation as/);
    expect(rowProblem("enum", 1, "Paid = 2")).toBeNull();
    expect(rowProblem("enum", 1, "not a value")).toMatch(/An enum value/);
  });
});

describe("class text", () => {
  it("sets and reads the kind", () => {
    const text = withClassKind("Payable\n--\n--\n+ pay(): bool", "interface");
    expect(text.startsWith("«interface»\nPayable")).toBe(true);
    expect(classKind(text)).toBe("interface");
    expect(classKind(withClassKind(text, "class"))).toBe("class");
    expect(className(text)).toBe("Payable");
  });

  it("adds the () to an operation written without them", () => {
    expect(fixOperation("+ getHoi: hoi")).toBe("+ getHoi(): hoi");
    expect(fixOperation("+ pay(amount: double): bool")).toBe("+ pay(amount: double): bool");
  });
});
