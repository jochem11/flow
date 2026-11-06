// A project's look (models::Brand): an accent color for focal blocks and
// callouts, and a typeface for all its boards. The same stacks as the export
// (flow_svg.rs, `Look`), so a board and its picture match.

import type { BrandFont } from "./types";

export const BRAND_FONTS: Record<BrandFont, string> = {
  sans: "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, Menlo, Consolas, monospace",
  rounded: "ui-rounded, 'SF Pro Rounded', Nunito, 'Varela Round', sans-serif",
};

export const BRAND_FONT_NAMES: Record<BrandFont, string> = { sans: "Sans", serif: "Serif", mono: "Mono", rounded: "Rounded" };

/** Accents to pick from: the chart palette (validated for color blindness), in its order */
export const ACCENTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

export const isColor = (s: string) => /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s);
