import { describe, expect, it } from "vitest";
import { matchScore } from "./match";

describe("quick open matching", () => {
  it("finds the query in one piece, in order, or not at all", () => {
    expect(matchScore("Order process", "")).toBe(0);
    expect(matchScore("Order process", "proc")).not.toBeNull();
    expect(matchScore("Order process", "ordpro")).not.toBeNull();
    expect(matchScore("Order process", "xyz")).toBeNull();
  });

  it("prefers the start of a word, then fewer letters in between", () => {
    const start = matchScore("Order process", "proc")!;
    const middle = matchScore("Reprocess order", "proc")!;
    expect(start).toBeGreaterThan(middle);
    expect(matchScore("Sequence diagram", "seq")!).toBeGreaterThan(matchScore("Some equal queue", "seq")!);
  });
});
