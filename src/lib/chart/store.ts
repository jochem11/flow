// The open chart board: its table of data and how it is drawn. Like the kanban
// store: every change bumps `chartRev` (autosave, editing together) and can be
// undone.

import { batch, createSignal } from "solid-js";
import { createStore, reconcile, unwrap } from "solid-js/store";
import type { ChartDoc, ChartType } from "../types";

export const uid = () => crypto.randomUUID();

export const [chart, setChart] = createStore<ChartDoc>(emptyChart());

const [chartRev, setChartRev] = createSignal(0);
export { chartRev };
const touch = () => setChartRev((r) => r + 1);

/** A new chart: three months of two series, so there is something to see and change. */
export function emptyChart(): ChartDoc {
  const s1 = uid();
  const s2 = uid();
  return {
    chart: "column",
    title: "",
    series: [
      { id: s1, name: "This year" },
      { id: s2, name: "Last year" },
    ],
    rows: [
      { id: uid(), label: "Jan", values: [12, 9] },
      { id: uid(), label: "Feb", values: [15, 11] },
      { id: uid(), label: "Mar", values: [18, 14] },
    ],
  };
}

export const chartSnapshot = (): ChartDoc => JSON.parse(JSON.stringify(unwrap(chart)));

// ---------- undo ----------

const undoStack: ChartDoc[] = [];
const redoStack: ChartDoc[] = [];
const [histRev, setHistRev] = createSignal(0);
export const canUndoChart = () => (histRev(), undoStack.length > 0);
export const canRedoChart = () => (histRev(), redoStack.length > 0);

/** Before a change: what to go back to. */
function checkpoint() {
  undoStack.push(chartSnapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}

export function undoChart() {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(chartSnapshot());
  setChart(reconcile(prev));
  setHistRev((v) => v + 1);
  touch();
}

export function redoChart() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(chartSnapshot());
  setChart(reconcile(next));
  setHistRev((v) => v + 1);
  touch();
}

/** Opening a chart board: its content, a fresh history. Not a change. */
export function replaceChart(doc: ChartDoc) {
  setChart(reconcile({ ...emptyChart(), ...doc }));
  undoStack.length = 0;
  redoStack.length = 0;
  setHistRev((v) => v + 1);
}

/** Someone else changed it (editing together): not a change of ours. */
export function applyRemoteChart(doc: ChartDoc) {
  setChart(reconcile(doc));
}

/** An older version back (version history): one undoable change. */
export function restoreChart(doc: ChartDoc) {
  change(() => setChart(reconcile({ ...emptyChart(), ...doc })));
}

/** One undoable change. */
function change(fn: () => void) {
  checkpoint();
  batch(fn);
  touch();
}

// ---------- changes ----------

export const setChartType = (t: ChartType) => change(() => setChart("chart", t));
export const setChartTitle = (title: string) => change(() => setChart("title", title));
export const setAxisLabel = (axis: "x" | "y", label: string) =>
  change(() => setChart(axis === "x" ? "xLabel" : "yLabel", label.trim() || undefined));
export const setFocal = (id: string | null) => change(() => setChart("focal", id ?? undefined));

export const setRowLabel = (row: number, label: string) => change(() => setChart("rows", row, "label", label));
export const setSeriesName = (series: number, name: string) => change(() => setChart("series", series, "name", name));

/** A cell: a number, or empty (null). */
export function setCell(row: number, series: number, value: number | null) {
  change(() =>
    setChart("rows", row, "values", (vs) => {
      const next = [...vs];
      while (next.length < chart.series.length) next.push(null);
      next[series] = value;
      return next;
    }),
  );
}

export function addRow() {
  const label = chart.chart === "scatter" ? String(chart.rows.length + 1) : `Row ${chart.rows.length + 1}`;
  change(() => setChart("rows", (rs) => [...rs, { id: uid(), label, values: chart.series.map(() => null) }]));
}

export function removeRow(row: number) {
  change(() => setChart("rows", (rs) => rs.filter((_, i) => i !== row)));
}

/** At most eight series: a ninth colour would be told apart from the others by nobody. */
export const MAX_SERIES = 8;

export function addSeries() {
  if (chart.series.length >= MAX_SERIES) return;
  change(() => {
    setChart("series", (ss) => [...ss, { id: uid(), name: `Series ${ss.length + 1}` }]);
    setChart("rows", {}, "values", (vs) => [...vs, null]);
  });
}

export function removeSeries(series: number) {
  const id = chart.series[series]?.id;
  change(() => {
    setChart("series", (ss) => ss.filter((_, i) => i !== series));
    setChart("rows", {}, "values", (vs) => vs.filter((_, i) => i !== series));
    if (chart.focal === id) setChart("focal", undefined);
  });
}

/**
 * Pasted cells (from a spreadsheet: tab-separated, or CSV). With a header row
 * (its first cell empty or text, the rest names) the series are named after it;
 * the first column is the row labels. Replaces the table.
 */
export function pasteTable(text: string): boolean {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return false;
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
  const num = (s: string) => {
    const n = Number(s.replace(/\s/g, "").replace(/(\d),(\d{1,2})$/, "$1.$2").replace(/,/g, ""));
    return s.trim() === "" || Number.isNaN(n) ? null : n;
  };
  const header = cells[0].slice(1).some((c) => c && num(c) === null);
  const width = Math.max(...cells.map((r) => r.length)) - 1;
  if (width < 1) return false;
  const names = header ? cells[0].slice(1) : [];
  const body = header ? cells.slice(1) : cells;
  const series = Array.from({ length: Math.min(width, MAX_SERIES) }, (_, i) => ({ id: uid(), name: names[i] || `Series ${i + 1}` }));
  const rows = body.map((r) => ({ id: uid(), label: r[0] ?? "", values: series.map((_, i) => num(r[i + 1] ?? "")) }));
  change(() => {
    setChart("series", series);
    setChart("rows", rows);
    setChart("focal", undefined);
  });
  return true;
}
