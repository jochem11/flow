import { describe, expect, it } from "vitest";
import { cleanHex, COLOR_NAMES, COLORS, hexToHsv, hsvToHex, tintVars } from "./colors";

describe("colors", () => {
  it("has a name for every color it offers", () => {
    expect(COLORS.length).toBe(Object.keys(COLOR_NAMES).length);
    expect(new Set(COLORS).size).toBe(COLORS.length);
  });
  it("reads a hex color, and nothing else", () => {
    expect(cleanHex("#FFAA00")).toBe("#ffaa00");
    expect(cleanHex("fa0")).toBe("#ffaa00");
    expect(cleanHex(" #12ab34 ")).toBe("#12ab34");
    for (const bad of ["", null, "red", "#12345", "#12345g", "#fff; background: url(x)"]) expect(cleanHex(bad)).toBeNull();
  });
  it("styles a color of one's own, and nothing for a broken one", () => {
    expect(tintVars("#FF0000")).toEqual({ "--fill": "color-mix(in srgb, #ff0000 24%, var(--panel))", "--stroke": "#ff0000" });
    expect(tintVars(null)).toBeUndefined();
    expect(tintVars("javascript:1")).toBeUndefined();
  });
  it("goes to the wheel and back", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#00ff00").h).toBe(120);
    expect(hexToHsv("#0000ff").h).toBe(240);
    expect(hexToHsv("#808080")).toMatchObject({ h: 0, s: 0 });
    for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#5b4cf0", "#123456", "#ffffff", "#000000", "#e48fab"]) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
});
