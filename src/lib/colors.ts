// The colors of blocks, tables, sections, kanban columns and labels: ten named
// ones (their fill and border are in styles.css, per theme), or one of one's
// own from the color wheel (`tint`, `#rrggbb`), which is used instead.

import type { NodeColor } from "./types";

export const COLORS: NodeColor[] = ["white", "gray", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"];
export const COLOR_NAMES: Record<NodeColor, string> = {
  white: "White",
  gray: "Gray",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

/** The class for a color: the named one's, or (with a color of one's own, shown by `tintVars`) just "has a color" */
export const colorClass = (color?: NodeColor | null, tint?: string | null) => (cleanHex(tint) ? "color-own" : color ? `color-${color}` : "");

/** What a color picker gives: a named color (null: none), a color of one's own (null: not that), or both */
export interface ColorChoice {
  color?: NodeColor | null;
  tint?: string | null;
}

/** `#rrggbb`, in lower case; null when it is not a color */
export function cleanHex(text: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec((text ?? "").trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `#${h.length === 3 ? [...h].map((c) => c + c).join("") : h}`;
}

/**
 * The style that shows a color of one's own: a light fill of it (on the panel
 * color, so it also fits the dark theme) and the color itself as the border.
 * Nothing for no (or a broken) tint: the named color's class does it then.
 */
export function tintVars(tint: string | null | undefined): Record<string, string> | undefined {
  const hex = cleanHex(tint);
  return hex ? { "--fill": `color-mix(in srgb, ${hex} 24%, var(--panel))`, "--stroke": hex } : undefined;
}

// ---------- the wheel: hue around, saturation outwards, with a brightness ----------

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  v: number;
}

export function hexToHsv(hex: string): Hsv {
  const c = cleanHex(hex) ?? "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}
