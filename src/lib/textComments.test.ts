import { describe, expect, it } from "vitest";
import { findPassage } from "./textComments";

describe("text comments", () => {
  it("finds a passage by its words, and by what is around it when they occur twice", () => {
    const text = "We ship on Monday.\nIf it rains we ship on Tuesday.";
    expect(findPassage(text, { quote: "ship on", prefix: "We ", suffix: " Monday" })).toBe(3);
    expect(findPassage(text, { quote: "ship on", prefix: "rains we ", suffix: " Tuesday" })).toBe(text.lastIndexOf("ship on"));
    // Edits elsewhere: still found
    expect(findPassage(`Intro.\n${text}`, { quote: "ship on", prefix: "rains we ", suffix: " Tuesday" })).toBe(`Intro.\n${text}`.lastIndexOf("ship on"));
    // Gone
    expect(findPassage(text, { quote: "Friday", prefix: "", suffix: "" })).toBeNull();
  });
});
