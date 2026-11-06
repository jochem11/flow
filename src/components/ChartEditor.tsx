// A chart board: the chart on the left, its table on the right (which is also how
// the values are read without hovering). Paste cells from a spreadsheet into the
// table. The drawing itself is lib/chart/render.ts.

import { createMemo, createSignal, For, Index, onCleanup, onMount, Show } from "solid-js";
import { canEdit } from "../lib/access";
import {
  addRow,
  addSeries,
  canRedoChart,
  canUndoChart,
  chart,
  MAX_SERIES,
  pasteTable,
  redoChart,
  removeRow,
  removeSeries,
  setAxisLabel,
  setCell,
  setChartTitle,
  setChartType,
  setFocal,
  setRowLabel,
  setSeriesName,
  undoChart,
} from "../lib/chart/store";
import { DARK, formatNumber, LIGHT, renderChart, type Hit } from "../lib/chart/render";
import { theme } from "../lib/theme";
import type { ChartType } from "../lib/types";
import { IconClose, IconPlus, IconRedo, IconUndo } from "./icons";

const TYPES: { type: ChartType; label: string; hint: string }[] = [
  { type: "column", label: "Columns", hint: "Compare values per row" },
  { type: "bar", label: "Bars", hint: "Many rows, or long labels" },
  { type: "stacked", label: "Stacked", hint: "Parts adding up, per row" },
  { type: "line", label: "Line", hint: "A trend over the rows, in order" },
  { type: "area", label: "Area", hint: "A trend, with how much under it" },
  { type: "scatter", label: "Scatter", hint: "Row labels are numbers (x); up to three series" },
  { type: "share", label: "Share", hint: "One whole split into parts (the first series)" },
];

/** Light or dark, as the app is shown now */
const isDark = () => theme() === "dark" || (theme() === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

/** A cell typed as text: a number (1,5 and 1 500 are fine), or empty */
const parseCell = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, "").replace(/(\d),(\d{1,2})$/, "$1.$2").replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
};

export function ChartEditor() {
  const edit = () => canEdit();
  let area!: HTMLDivElement;
  const [size, setSize] = createSignal({ w: 640, h: 400 });
  onMount(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(280, Math.floor(e.contentRect.width)), h: Math.max(240, Math.floor(e.contentRect.height)) }));
    ro.observe(area);
    onCleanup(() => ro.disconnect());
  });
  // Follows the system theme while "System" is chosen
  const [osDark, setOsDark] = createSignal(window.matchMedia("(prefers-color-scheme: dark)").matches);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onMq = () => setOsDark(mq.matches);
  mq.addEventListener("change", onMq);
  onCleanup(() => mq.removeEventListener("change", onMq));

  const drawing = createMemo(() => {
    osDark();
    return renderChart(chart, size().w, size().h, isDark() ? DARK : LIGHT);
  });

  // ---------- the tooltip ----------
  const [hover, setHover] = createSignal<{ hit: Hit; x: number; y: number } | null>(null);
  const onMove = (e: PointerEvent) => {
    const r = area.getBoundingClientRect();
    const [x, y] = [e.clientX - r.left, e.clientY - r.top];
    const hit = drawing().hits.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h);
    setHover(hit ? { hit, x, y } : null);
  };

  const onPaste = (e: ClipboardEvent) => {
    if (!edit()) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // More than one cell: the whole table
    if (text.includes("\t") || text.includes("\n")) {
      e.preventDefault();
      pasteTable(text);
    }
  };

  return (
    <div class="chart-editor">
      <div class="chart-toolbar">
        <div class="segmented" role="group" aria-label="Chart type">
          <For each={TYPES}>
            {(t) => (
              <button classList={{ on: (chart.chart ?? "column") === t.type }} title={t.hint} disabled={!edit()} onClick={() => setChartType(t.type)}>
                {t.label}
              </button>
            )}
          </For>
        </div>
        <span class="spacer" />
        <Show when={edit()}>
          <button class="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndoChart()} onClick={undoChart}>
            <IconUndo />
          </button>
          <button class="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedoChart()} onClick={redoChart}>
            <IconRedo />
          </button>
        </Show>
      </div>

      <div class="chart-body">
        <div class="chart-main">
          <div class="chart-fields">
            <input class="panel-field chart-title" value={chart.title} placeholder="Title" readOnly={!edit()} onChange={(e) => setChartTitle(e.currentTarget.value.trim())} />
            <Show when={chart.chart !== "share"}>
              <input class="panel-field" value={chart.xLabel ?? ""} placeholder="x axis" readOnly={!edit()} onChange={(e) => setAxisLabel("x", e.currentTarget.value)} />
              <input class="panel-field" value={chart.yLabel ?? ""} placeholder="y axis" readOnly={!edit()} onChange={(e) => setAxisLabel("y", e.currentTarget.value)} />
              <Show when={chart.series.length > 1}>
                <select class="panel-field" title="One series the story is about: it gets the colour, the others gray" disabled={!edit()} value={chart.focal ?? ""} onChange={(e) => setFocal(e.currentTarget.value || null)}>
                  <option value="">All series in colour</option>
                  <For each={chart.series}>{(s) => <option value={s.id}>{`Story: ${s.name}`}</option>}</For>
                </select>
              </Show>
            </Show>
          </div>
          <div class="chart-area" ref={area} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
            {/* The drawing: its labels are escaped (render.ts), the rest is our own markup */}
            <div class="chart-svg" innerHTML={drawing().svg} />
            <Show when={hover()}>
              {(h) => (
                <>
                  <Show when={h().hit.crosshair !== undefined}>
                    <div class="chart-crosshair" style={{ left: `${h().hit.crosshair}px` }} />
                  </Show>
                  <div
                    class="chart-tooltip panel"
                    style={{
                      left: `${Math.min(h().x + 14, size().w - 200)}px`,
                      top: `${Math.max(8, h().y - 12)}px`,
                    }}
                  >
                    <div class="tip-title">{h().hit.title}</div>
                    <For each={h().hit.rows}>
                      {(r) => (
                        <div class="tip-row">
                          <span class="tip-key" style={{ background: r.color }} />
                          <strong>{r.value}</strong>
                          <span>{r.name}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </>
              )}
            </Show>
          </div>
          <Show when={drawing().notes.length}>
            <p class="chart-notes">{drawing().notes.join(" ")}</p>
          </Show>
        </div>

        {/* ---------- the table: the data, and the values without hovering ---------- */}
        <div class="chart-table-wrap" onPaste={onPaste}>
          <table class="chart-table">
            <thead>
              <tr>
                <th class="row-head">{chart.chart === "scatter" ? "x" : ""}</th>
                <Index each={chart.series}>
                  {(s, i) => (
                    <th>
                      <div class="series-head">
                        <span class="tip-key" style={{ background: (isDark() ? DARK : LIGHT).series[i] }} />
                        <input value={s().name} readOnly={!edit()} aria-label="Series name" onChange={(e) => setSeriesName(i, e.currentTarget.value.trim() || s().name)} />
                        <Show when={edit() && chart.series.length > 1}>
                          <button class="icon-btn small remove-btn" title="Remove this series" onClick={() => removeSeries(i)}>
                            <IconClose />
                          </button>
                        </Show>
                      </div>
                    </th>
                  )}
                </Index>
                <Show when={edit() && chart.series.length < MAX_SERIES}>
                  <th class="add-col">
                    <button class="icon-btn small" title="Add a series" onClick={addSeries}>
                      <IconPlus />
                    </button>
                  </th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <Index each={chart.rows}>
                {(r, ri) => (
                  <tr>
                    <td class="row-head">
                      <input value={r().label} readOnly={!edit()} aria-label="Row label" onChange={(e) => setRowLabel(ri, e.currentTarget.value.trim())} />
                    </td>
                    <Index each={chart.series}>
                      {(_, si) => (
                        <td>
                          <input
                            class="num"
                            value={r().values[si] === null || r().values[si] === undefined ? "" : formatNumber(r().values[si]!).replace(/,/g, "")}
                            readOnly={!edit()}
                            inputmode="decimal"
                            aria-label={`${r().label}, ${chart.series[si]?.name}`}
                            onChange={(e) => setCell(ri, si, parseCell(e.currentTarget.value))}
                            onKeyDown={(e) => {
                              // Enter: the cell below, as in a spreadsheet
                              if (e.key === "Enter") {
                                const next = e.currentTarget.closest("tr")?.nextElementSibling?.children[si + 1]?.querySelector("input");
                                (next as HTMLInputElement | undefined)?.focus();
                              }
                            }}
                          />
                        </td>
                      )}
                    </Index>
                    <Show when={edit()}>
                      <td class="add-col">
                        <button class="icon-btn small remove-btn" title="Remove this row" onClick={() => removeRow(ri)}>
                          <IconClose />
                        </button>
                      </td>
                    </Show>
                  </tr>
                )}
              </Index>
            </tbody>
          </table>
          <Show when={edit()}>
            <button class="text-btn small add-row" onClick={addRow}>
              + Row
            </button>
            <p class="panel-hint">Paste cells from a spreadsheet to fill the whole table (the first row may be the series' names, the first column the row labels).</p>
          </Show>
        </div>
      </div>
    </div>
  );
}
