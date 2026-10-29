import { describe, expect, it } from "vitest";
import rows from "../../fixtures/uml-rows.json";
import { attributeNames, classKind, className, classParts, fixOperation, rowProblem, withClassKind } from "./umlClass";

/** The name of an attribute row (`- total: int` → total) or an operation row (`+ pay(…)` → pay). */
const rowName = (line: string) =>
  line
    .trim()
    .replace(/^[+\-#~]\s*/, "")
    .replace(/\{static\}|\{abstract\}|^static\s+/g, "")
    .trim()
    .split(/[(:]/)[0]
    .trim();

describe("UML rows (shared with codegen.rs)", () => {
  for (const c of rows.cases) {
    it(c.name, () => {
      const parts = classParts(c.text);
      const ctx = { self: className(c.text), related: c.related, attributes: attributeNames(c.text) };
      const accepted = (part: number) =>
        parts[part].filter((line) => rowProblem(classKind(c.text), part, line, ctx) === null).map(rowName);
      expect(accepted(1)).toEqual(c.fields);
      expect(accepted(2)).toEqual(c.methods);
    });
  }
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
