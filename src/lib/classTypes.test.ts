import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/types.json";
import { LANGUAGES, pickerTypes, typeFrom, typeIn } from "./classTypes";

describe("class diagram types (shared with codegen/types.rs)", () => {
  for (const c of fixture.cases) {
    it(`${c.uml} in every language`, () => {
      LANGUAGES.forEach((l, i) => expect(typeIn(c.uml, l), l).toBe(c.in[i]));
    });

    it(`${c.uml} read back reads the same`, () => {
      // Some languages write several types the same (TypeScript: number); reading
      // back gives one of them, which is written the same again
      for (const l of LANGUAGES) {
        const written = typeIn(c.uml, l);
        if (!written) continue;
        expect(typeIn(typeFrom(written, l), l), `${l}: ${written}`).toBe(written);
        // Knowing what it was keeps it exactly
        expect(typeFrom(written, l, c.uml)).toBe(c.uml);
      }
    });
  }

  it("reads what people type in a language", () => {
    expect(typeFrom("List<Integer>", "java")).toBe("List<int>");
    expect(typeFrom("Optional<Customer>", "java")).toBe("Customer?");
    expect(typeFrom("map[string]int", "go")).toBe("Map<string, int>");
    expect(typeFrom("*Order", "go")).toBe("Order?");
    expect(typeFrom("dict[str, list[Order]]", "python")).toBe("Map<string, List<Order>>");
    expect(typeFrom("Order | null", "typescript")).toBe("Order?");
    expect(typeFrom("Option<Vec<Order>>", "rust")).toBe("List<Order>?");
    expect(typeFrom("IEnumerable<Guid>", "csharp")).toBe("List<uuid>");
    expect(typeFrom("Repository<T>", "kotlin")).toBe("Repository<T>");
    // Neutral, with aliases written the usual way
    expect(typeFrom("list<integer>", null)).toBe("List<int>");
  });

  it("offers each language's own names", () => {
    const java = pickerTypes("java").map((t) => t.label);
    expect(java.slice(0, 3)).toEqual(["String", "int", "long"]);
    expect(java).not.toContain("Integer");
    expect(pickerTypes("typescript").find((t) => t.label === "number")?.uml).toBe("double");
  });
});
