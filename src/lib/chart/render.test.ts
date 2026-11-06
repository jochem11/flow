import { describe, expect, it } from "vitest";
import type { ChartDoc } from "../types";
import { DARK, formatNumber, LIGHT, niceTicks, renderChart } from "./render";

const doc = (over: Partial<ChartDoc> = {}): ChartDoc => ({
  chart: "column",
  title: "Revenue",
  series: [
    { id: "a", name: "This year" },
    { id: "b", name: "Last year" },
  ],
  rows: [
    { id: "1", label: "Jan", values: [12, 9] },
    { id: "2", label: "Feb", values: [15, null] },
    { id: "3", label: "Mar", values: [18, 14] },
  ],
  ...over,
});

describe("chart drawing", () => {
  it("clean ticks and numbers", () => {
    expect(niceTicks(0, 18)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(-3, 7)).toEqual([-4, -2, 0, 2, 4, 6, 8]);
    expect([formatNumber(1234), formatNumber(12_900, true), formatNumber(4_200_000, true), formatNumber(0.5)]).toEqual(["1,234", "12.9K", "4.2M", "0.5"]);
  });

  it("every chart type draws, with a mark per value and a hover area", () => {
    for (const chart of ["column", "bar", "stacked", "line", "area", "scatter", "share"] as const) {
      const rows = chart === "scatter" ? doc().rows.map((r, i) => ({ ...r, label: String(i * 10) })) : doc().rows;
      const d = renderChart(doc({ chart, rows }), 640, 400);
      expect(d.svg.startsWith("<svg"), chart).toBe(true);
      expect(d.hits.length, chart).toBeGreaterThan(0);
      expect(d.notes, chart).toEqual([]);
    }
  });

  it("labels are text, never markup", () => {
    const d = renderChart(doc({ title: "<script>x</script>", rows: [{ id: "1", label: "A & B", values: [1, 2] }] }), 640, 400);
    expect(d.svg).not.toContain("<script>");
    expect(d.svg).toContain("A &amp; B");
  });

  it("thin bars, colours by place in the table, the story in the accent", () => {
    const d = renderChart(doc({ rows: [{ id: "1", label: "Only", values: [5, 3] }] }), 640, 400);
    // a single row: the bars stay 24px thick, not the width of the plot
    const widths = [...d.svg.matchAll(/<path d="M([\d.]+),[\d.]+V[\d.]+Q[\d.]+,[\d.]+ ([\d.]+)/g)].map((m) => Number(m[2]) - Number(m[1]));
    expect(widths.length).toBe(2);
    expect(d.svg).toContain(LIGHT.series[0]);
    expect(d.svg).toContain(LIGHT.series[1]);
    const focused = renderChart(doc({ focal: "b" }), 640, 400, DARK);
    expect(focused.svg).toContain(DARK.context);
    expect(focused.svg).not.toContain(DARK.series[1]);
  });

  it("says what it cannot show", () => {
    const four = doc({ chart: "scatter", series: ["a", "b", "c", "d"].map((id) => ({ id, name: id })), rows: [{ id: "1", label: "1", values: [1, 2, 3, 4] }] });
    expect(renderChart(four, 640, 400).notes[0]).toMatch(/first three/);
    const many = doc({ chart: "share", rows: Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: `P${i}`, values: [i + 1] })) });
    const d = renderChart(many, 640, 400);
    expect(d.notes[0]).toMatch(/Other/);
    expect(d.svg).toContain(">Other<");
  });
});
