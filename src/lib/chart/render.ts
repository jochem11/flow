// Drawing a chart board: a pure function from the table to SVG text, plus where
// each mark is (for the hover tooltip). The same text is shown in the editor and
// kept with the board (light, 640×400) for exports and chart blocks.
//
// The rules (from the data-viz guidelines this follows):
// - categorical colours in a fixed order, by the series' place in the table (never
//   by rank), at most eight; scatter at most three (every pair must differ);
// - bars at most 24px thick, a 4px rounded end, square at the baseline; a 2px gap
//   in the surface colour between touching bars and stacked segments;
// - 2px lines with round joins; dots r=4 with a 2px surface ring; area washes at 10%;
// - hairline solid gridlines, one y axis; a legend from two series on; few direct
//   labels (a single series' bar values, line ends); text never in a series colour;
// - "one series is the story": that one in the accent, the rest in gray.

import type { ChartDoc } from "../types";

export interface Theme {
  surface: string;
  text: string;
  secondary: string;
  muted: string;
  grid: string;
  axis: string;
  /** The categorical colours, in their fixed order (validated: see colours below) */
  series: string[];
  /** The series that are context when one is the story */
  context: string;
}

// The validated default palette of the data-viz guidelines: passes the lightness,
// chroma, colour-blind and normal-vision checks for adjacent series in both modes
// (checked against Flow's surfaces, #ffffff and #232327). In light mode three are
// under 3:1 against the surface, so values stay in the tooltip and the table.
export const LIGHT: Theme = {
  surface: "#ffffff",
  text: "#1f1f24",
  secondary: "#52514e",
  muted: "#77767f",
  grid: "#ecebe6",
  axis: "#c3c2b7",
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  context: "#c3c2b7",
};

export const DARK: Theme = {
  surface: "#232327",
  text: "#ececf0",
  secondary: "#c3c2b7",
  muted: "#94939c",
  grid: "#303036",
  axis: "#46464d",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  context: "#5a5a62",
};

/** White on a fill, near-black on the light ones (yellow) */
const inkOn = (fill: string) => (fill === "#eda100" || fill === "#c98500" ? "#0b0b0b" : "#ffffff");

/** Where the pointer shows what: an area of the drawing and what it holds. */
export interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  rows: { name: string; value: string; color: string }[];
  /** Lines and areas: the vertical hairline that follows the pointer */
  crosshair?: number;
}

export interface Drawing {
  svg: string;
  hits: Hit[];
  /** What the chart could not show, said in the editor */
  notes: string[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`;

/** A number for a label: in full under 10,000, compact above (12K, 1.2M). */
export function formatNumber(v: number, compact = false): string {
  const a = Math.abs(v);
  if (compact && a >= 10_000) {
    const [d, s] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : [1e3, "K"];
    return `${(v / d).toLocaleString("en-US", { maximumFractionDigits: 1 })}${s}`;
  }
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Clean ticks from lo to hi (1, 2 or 5 times a power of ten). */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.floor(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Math.round(t / step) * step);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

/** About how wide a text is at this size (no measuring in a pure function) */
const textWidth = (s: string, size: number) => s.length * size * 0.56;

const clip = (s: string, max: number, size: number) => {
  if (textWidth(s, size) <= max) return s;
  const n = Math.max(1, Math.floor(max / (size * 0.56)) - 1);
  return `${s.slice(0, n)}…`;
};

/** A bar with a 4px rounded end away from the baseline, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, end: "top" | "bottom" | "right" | "left"): string {
  const r = Math.min(4, w / 2, h / 2);
  if (h <= 0 || w <= 0) return "";
  switch (end) {
    case "top":
      return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    case "bottom":
      return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
    case "right":
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    case "left":
      return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
  }
}

/** Draws the chart at this size in this theme. */
export function renderChart(doc: ChartDoc, width: number, height: number, t: Theme = LIGHT): Drawing {
  const out: string[] = [];
  const hits: Hit[] = [];
  const notes: string[] = [];
  const kind = doc.chart ?? "column";
  const allSeries = doc.series.slice(0, 8);
  // Every pair of colours must differ in a scatter: three at most
  const series = kind === "scatter" ? allSeries.slice(0, 3) : kind === "share" ? allSeries.slice(0, 1) : allSeries;
  if (kind === "scatter" && allSeries.length > 3) notes.push("A scatter shows the first three series: more colours cannot all be told apart.");
  if (doc.series.length > 8) notes.push("At most eight series are drawn.");
  const focalIndex = series.findIndex((s) => s.id === doc.focal);
  const colorOf = (i: number) => (focalIndex >= 0 ? (i === focalIndex ? t.series[0] : t.context) : t.series[i]);
  const value = (r: ChartDoc["rows"][number], i: number) => r.values[i] ?? null;

  out.push(`<rect width="${width}" height="${height}" fill="${t.surface}"/>`);
  let top = 16;
  if (doc.title.trim()) {
    out.push(`<text x="16" y="${top + 14}" font-size="15" font-weight="600" fill="${t.text}" ${FONT}>${esc(clip(doc.title.trim(), width - 32, 15))}</text>`);
    top += 28;
  }

  // ---------- the legend: from two series on (a share lists its parts under the bar) ----------
  const legendItems = series.map((s, i) => ({ name: s.name, color: colorOf(i), key: kind === "line" || kind === "scatter" ? ("line" as const) : ("rect" as const) }));
  if (legendItems.length >= 2 && kind !== "share") {
    let x = 16;
    for (const item of legendItems) {
      const name = clip(item.name, 140, 12);
      const w = 18 + textWidth(name, 12) + 16;
      if (x + w > width - 16) break;
      out.push(
        item.key === "line"
          ? `<line x1="${x}" y1="${top + 6}" x2="${x + 12}" y2="${top + 6}" stroke="${item.color}" stroke-width="2" stroke-linecap="round"/>`
          : `<rect x="${x}" y="${top + 1}" width="10" height="10" rx="2" fill="${item.color}"/>`,
      );
      out.push(`<text x="${x + 18}" y="${top + 10}" font-size="12" fill="${t.secondary}" ${FONT}>${esc(name)}</text>`);
      x += w;
    }
    top += 24;
  }

  if (!doc.rows.length || !series.length) {
    out.push(`<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="13" fill="${t.muted}" ${FONT}>Add rows and series in the table</text>`);
    return { svg: wrap(out, width, height), hits, notes };
  }

  if (kind === "share") return share();

  // ---------- the plot area and the value scale ----------
  const horizontal = kind === "bar";
  const stacked = kind === "stacked";
  const values: number[] = [];
  for (const r of doc.rows) {
    if (stacked) {
      values.push(series.reduce((sum, _, i) => sum + Math.max(0, value(r, i) ?? 0), 0));
    } else {
      for (let i = 0; i < series.length; i++) {
        const v = value(r, i);
        if (v !== null) values.push(v);
      }
    }
  }
  if (stacked && doc.rows.some((r) => series.some((_, i) => (value(r, i) ?? 0) < 0))) notes.push("A stacked chart leaves out negative values.");
  // Bars and areas start at zero; lines and dots may start where the data does
  const fromZero = kind !== "line" && kind !== "scatter";
  let lo = Math.min(...values, fromZero ? 0 : Infinity);
  let hi = Math.max(...values, fromZero ? 0 : -Infinity);
  if (!Number.isFinite(lo)) [lo, hi] = [0, 1];
  const ticks = niceTicks(lo, hi);
  const [y0, y1] = [ticks[0], ticks[ticks.length - 1]];
  const compact = Math.max(Math.abs(y0), Math.abs(y1)) >= 10_000;
  const tickText = (v: number) => formatNumber(v, compact);

  const labelW = horizontal ? Math.min(140, Math.max(...doc.rows.map((r) => textWidth(r.label, 12))) + 12) : Math.max(...ticks.map((v) => textWidth(tickText(v), 11))) + 12;
  // Line ends carry the series names (up to four series)
  const endLabels = kind === "line" && series.length <= 4 && focalIndex < 0;
  const right = endLabels ? Math.min(120, Math.max(...series.map((s) => textWidth(s.name, 12))) + 16) : 16;
  const bottom = ((horizontal ? doc.yLabel : doc.xLabel) ? 18 : 0) + 24;
  const plot = { x: 16 + labelW + (doc.yLabel && !horizontal ? 14 : 0), y: top + 6, w: 0, h: 0 };
  plot.w = width - plot.x - right;
  plot.h = height - plot.y - bottom;
  if (plot.w < 40 || plot.h < 40) return { svg: wrap(out, width, height), hits, notes: [...notes, "Too small to draw."] };

  // value → position along the value axis
  const scale = (v: number) => (horizontal ? plot.x + ((v - y0) / (y1 - y0)) * plot.w : plot.y + plot.h - ((v - y0) / (y1 - y0)) * plot.h);
  const base = scale(Math.max(y0, Math.min(0, y1)));

  // gridlines and value ticks
  for (const v of ticks) {
    const p = scale(v);
    out.push(
      horizontal
        ? `<line x1="${p}" y1="${plot.y}" x2="${p}" y2="${plot.y + plot.h}" stroke="${t.grid}" stroke-width="1"/><text x="${p}" y="${plot.y + plot.h + 16}" text-anchor="middle" font-size="11" fill="${t.muted}" ${FONT} style="font-variant-numeric: tabular-nums">${tickText(v)}</text>`
        : `<line x1="${plot.x}" y1="${p}" x2="${plot.x + plot.w}" y2="${p}" stroke="${t.grid}" stroke-width="1"/><text x="${plot.x - 8}" y="${p + 4}" text-anchor="end" font-size="11" fill="${t.muted}" ${FONT} style="font-variant-numeric: tabular-nums">${tickText(v)}</text>`,
    );
  }
  // the baseline
  out.push(
    horizontal
      ? `<line x1="${base}" y1="${plot.y}" x2="${base}" y2="${plot.y + plot.h}" stroke="${t.axis}" stroke-width="1"/>`
      : `<line x1="${plot.x}" y1="${base}" x2="${plot.x + plot.w}" y2="${base}" stroke="${t.axis}" stroke-width="1"/>`,
  );
  // The captions: the values' along the value axis, the rows' along the other one
  // (with horizontal bars the values run along the bottom)
  const [left, under] = horizontal ? [doc.xLabel, doc.yLabel] : [doc.yLabel, doc.xLabel];
  if (left && !horizontal) {
    const cy = plot.y + plot.h / 2;
    out.push(`<text x="14" y="${cy}" transform="rotate(-90 14 ${cy})" text-anchor="middle" font-size="11" fill="${t.secondary}" ${FONT}>${esc(left)}</text>`);
  }
  if (under) out.push(`<text x="${plot.x + plot.w / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${t.secondary}" ${FONT}>${esc(under)}</text>`);

  const tipRows = (r: ChartDoc["rows"][number]) =>
    series.map((s, i) => ({ name: s.name, value: value(r, i) === null ? "—" : formatNumber(value(r, i)!), color: colorOf(i) }));

  if (kind === "scatter") {
    scatter();
  } else if (kind === "line" || kind === "area") {
    lines();
  } else {
    bars();
  }
  return { svg: wrap(out, width, height), hits, notes };

  // ---------- bars: column, bar, stacked ----------
  function bars() {
    const n = doc.rows.length;
    const band = (horizontal ? plot.h : plot.w) / n;
    const groups = stacked ? 1 : series.length;
    // Thin bars with air around them: at most 24px, a 2px gap between neighbours
    const thick = Math.max(2, Math.min(24, (band * 0.72 - (groups - 1) * 2) / groups));
    const groupW = groups * thick + (groups - 1) * 2;
    const oneSeries = series.length === 1 && !stacked;
    const labelAll = oneSeries && n <= 12;
    const maxRow = oneSeries ? doc.rows.reduce((m, r, i) => ((value(r, 0) ?? -Infinity) > (value(doc.rows[m], 0) ?? -Infinity) ? i : m), 0) : -1;
    doc.rows.forEach((r, ri) => {
      const start = (horizontal ? plot.y : plot.x) + ri * band + (band - groupW) / 2;
      // category label
      if (horizontal) {
        out.push(`<text x="${plot.x - 8}" y="${plot.y + ri * band + band / 2 + 4}" text-anchor="end" font-size="12" fill="${t.secondary}" ${FONT}>${esc(clip(r.label, labelW - 12, 12))}</text>`);
      } else if (band >= textWidth(r.label, 11) || ri % Math.ceil(textWidth(r.label, 11) / band) === 0) {
        out.push(`<text x="${plot.x + ri * band + band / 2}" y="${plot.y + plot.h + 16}" text-anchor="middle" font-size="11" fill="${t.muted}" ${FONT}>${esc(clip(r.label, Math.max(band * 2, 40), 11))}</text>`);
      }
      if (stacked) {
        // segments from the baseline up, a 2px surface gap between them
        let acc = 0;
        const parts = series.map((_, i) => Math.max(0, value(r, i) ?? 0));
        const lastIdx = parts.reduce((li, v, i) => (v > 0 ? i : li), -1);
        parts.forEach((v, i) => {
          if (v <= 0) return;
          const a = scale(acc);
          const b = scale(acc + v);
          acc += v;
          const gap = i === lastIdx ? 0 : 2;
          const [y, h] = [b + gap, a - b - gap];
          out.push(`<path d="${i === lastIdx ? barPath(start, y, thick, h, "top") : `M${start},${y}h${thick}v${h}h${-thick}Z`}" fill="${colorOf(i)}"/>`);
        });
        if (acc > 0) out.push(`<text x="${start + thick / 2}" y="${scale(acc) - 6}" text-anchor="middle" font-size="11" fill="${t.secondary}" ${FONT}>${formatNumber(acc)}</text>`);
        hits.push({ x: start - 6, y: plot.y, w: thick + 12, h: plot.h, title: r.label, rows: tipRows(r) });
        return;
      }
      series.forEach((_, i) => {
        const v = value(r, i);
        if (v === null) return;
        const at = start + i * (thick + 2);
        const p = scale(v);
        if (horizontal) {
          const [x, w] = v >= 0 ? [base, p - base] : [p, base - p];
          out.push(`<path d="${barPath(x, at, w, thick, v >= 0 ? "right" : "left")}" fill="${colorOf(i)}"/>`);
          if (labelAll || ri === maxRow) out.push(`<text x="${v >= 0 ? p + 6 : p - 6}" y="${at + thick / 2 + 4}" text-anchor="${v >= 0 ? "start" : "end"}" font-size="11" fill="${t.secondary}" ${FONT}>${formatNumber(v)}</text>`);
        } else {
          const [y, h] = v >= 0 ? [p, base - p] : [base, p - base];
          out.push(`<path d="${barPath(at, y, thick, h, v >= 0 ? "top" : "bottom")}" fill="${colorOf(i)}"/>`);
          if (labelAll || ri === maxRow) out.push(`<text x="${at + thick / 2}" y="${v >= 0 ? p - 6 : p + 14}" text-anchor="middle" font-size="11" fill="${t.secondary}" ${FONT}>${formatNumber(v)}</text>`);
        }
      });
      hits.push(
        horizontal
          ? { x: plot.x, y: start - 4, w: plot.w, h: groupW + 8, title: r.label, rows: tipRows(r) }
          : { x: start - 6, y: plot.y, w: groupW + 12, h: plot.h, title: r.label, rows: tipRows(r) },
      );
    });
  }

  // ---------- lines and areas ----------
  function lines() {
    const n = doc.rows.length;
    const xAt = (i: number) => (n === 1 ? plot.x + plot.w / 2 : plot.x + (i / (n - 1)) * plot.w);
    const step = n > 1 ? plot.w / (n - 1) : plot.w;
    doc.rows.forEach((r, i) => {
      if (step >= textWidth(r.label, 11) + 6 || i % Math.ceil((textWidth(r.label, 11) + 6) / step) === 0) {
        out.push(`<text x="${xAt(i)}" y="${plot.y + plot.h + 16}" text-anchor="middle" font-size="11" fill="${t.muted}" ${FONT}>${esc(clip(r.label, 80, 11))}</text>`);
      }
    });
    // context first, the story on top
    const order = series.map((_, i) => i).sort((a, b) => Number(a === focalIndex) - Number(b === focalIndex));
    const ends: { y: number; name: string; color: string }[] = [];
    for (const i of order) {
      const pts = doc.rows.map((r, ri) => [xAt(ri), value(r, i)] as const).filter((p): p is readonly [number, number] => p[1] !== null);
      if (!pts.length) continue;
      const d = pts.map(([x, v], k) => `${k ? "L" : "M"}${x},${scale(v)}`).join("");
      if (kind === "area") {
        out.push(`<path d="${d}L${pts[pts.length - 1][0]},${base}L${pts[0][0]},${base}Z" fill="${colorOf(i)}" fill-opacity="0.1"/>`);
      }
      out.push(`<path d="${d}" fill="none" stroke="${colorOf(i)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`);
      const [ex, ev] = pts[pts.length - 1];
      out.push(`<circle cx="${ex}" cy="${scale(ev)}" r="4" fill="${colorOf(i)}" stroke="${t.surface}" stroke-width="2"/>`);
      ends.push({ y: scale(ev), name: series[i].name, color: colorOf(i) });
    }
    // Names at the line ends, unless they would collide (then the legend carries them)
    if (endLabels) {
      const sorted = [...ends].sort((a, b) => a.y - b.y);
      const apart = sorted.every((e, k) => k === 0 || e.y - sorted[k - 1].y >= 14);
      if (apart) for (const e of ends) out.push(`<text x="${plot.x + plot.w + 8}" y="${e.y + 4}" font-size="12" fill="${t.secondary}" ${FONT}>${esc(clip(e.name, right - 12, 12))}</text>`);
    }
    // The crosshair finds the x: a band per row
    doc.rows.forEach((r, i) => {
      const x = xAt(i);
      hits.push({ x: x - step / 2, y: plot.y, w: step, h: plot.h, title: r.label, rows: tipRows(r), crosshair: x });
    });
  }

  // ---------- dots ----------
  function scatter() {
    const xs = doc.rows.map((r) => Number(r.label));
    const ok = xs.filter((x) => Number.isFinite(x));
    if (ok.length < doc.rows.length) notes.push("A scatter needs a number as each row's label (its x).");
    if (!ok.length) return;
    const xt = niceTicks(Math.min(...ok), Math.max(...ok));
    const [x0, x1] = [xt[0], xt[xt.length - 1]];
    const sx = (v: number) => plot.x + ((v - x0) / (x1 - x0)) * plot.w;
    const xCompact = Math.max(Math.abs(x0), Math.abs(x1)) >= 10_000;
    for (const v of xt) {
      out.push(`<line x1="${sx(v)}" y1="${plot.y}" x2="${sx(v)}" y2="${plot.y + plot.h}" stroke="${t.grid}" stroke-width="1"/>`);
      out.push(`<text x="${sx(v)}" y="${plot.y + plot.h + 16}" text-anchor="middle" font-size="11" fill="${t.muted}" ${FONT}>${formatNumber(v, xCompact)}</text>`);
    }
    doc.rows.forEach((r, ri) => {
      const x = xs[ri];
      if (!Number.isFinite(x)) return;
      series.forEach((s, i) => {
        const v = value(r, i);
        if (v === null) return;
        out.push(`<circle cx="${sx(x)}" cy="${scale(v)}" r="4" fill="${colorOf(i)}" stroke="${t.surface}" stroke-width="2"/>`);
        // A hit area of 24px: an 8px dot alone is too small to point at
        hits.push({ x: sx(x) - 12, y: scale(v) - 12, w: 24, h: 24, title: `${doc.xLabel || "x"} ${formatNumber(x)}`, rows: [{ name: s.name, value: formatNumber(v), color: colorOf(i) }] });
      });
    });
  }

  // ---------- one whole, split into parts ----------
  function share(): Drawing {
    const parts = doc.rows.map((r) => ({ name: r.label, v: Math.max(0, r.values[0] ?? 0) }));
    // More than six parts: the rest as "Other"
    const shown = parts.length > 6 ? [...parts.slice(0, 5), { name: "Other", v: parts.slice(5).reduce((s, p) => s + p.v, 0) }] : parts;
    if (parts.length > 6) notes.push("Past six parts, the rest are added up as “Other”.");
    const total = shown.reduce((s, p) => s + p.v, 0);
    if (total <= 0) {
      out.push(`<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-size="13" fill="${t.muted}" ${FONT}>The first series has no values above zero</text>`);
      return { svg: wrap(out, width, height), hits, notes };
    }
    const x0 = 16;
    const w = width - 32;
    const y = top + 10;
    const h = 28;
    const gaps = (shown.filter((p) => p.v > 0).length - 1) * 2;
    let x = x0;
    shown.forEach((p, i) => {
      if (p.v <= 0) return;
      const pw = ((w - gaps) * p.v) / total;
      const fill = t.series[i % 8];
      out.push(`<rect x="${x}" y="${y}" width="${pw}" height="${h}" rx="4" fill="${fill}"/>`);
      const pct = `${Math.round((p.v / total) * 100)}%`;
      if (textWidth(pct, 12) + 12 <= pw) out.push(`<text x="${x + 6}" y="${y + 18}" font-size="12" font-weight="600" fill="${inkOn(fill)}" ${FONT}>${pct}</text>`);
      hits.push({ x, y: y - 6, w: pw, h: h + 12, title: p.name, rows: [{ name: series[0]?.name ?? "", value: `${formatNumber(p.v)} · ${pct}`, color: fill }] });
      x += pw + 2;
    });
    // The names and amounts below, in block order
    shown.forEach((p, i) => {
      const ly = y + h + 28 + i * 22;
      if (ly > height - 8) return;
      out.push(`<rect x="${x0}" y="${ly - 9}" width="10" height="10" rx="2" fill="${t.series[i % 8]}"/>`);
      out.push(`<text x="${x0 + 18}" y="${ly}" font-size="12" fill="${t.text}" ${FONT}>${esc(clip(p.name, w / 2, 12))}</text>`);
      out.push(`<text x="${x0 + w}" y="${ly}" text-anchor="end" font-size="12" fill="${t.secondary}" ${FONT} style="font-variant-numeric: tabular-nums">${formatNumber(p.v)} · ${Math.round((p.v / total) * 100)}%</text>`);
    });
    return { svg: wrap(out, width, height), hits, notes };
  }
}

function wrap(parts: string[], width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join("")}</svg>`;
}

/** The size kept with the board, for exports and chart blocks */
export const STORED = { width: 640, height: 400 };

/** The drawing kept with the board: light, at the stored size. */
export const storedSvg = (doc: ChartDoc) => renderChart(doc, STORED.width, STORED.height, LIGHT).svg;
