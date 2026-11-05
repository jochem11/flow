// The timeline view of a kanban board: a bar per card from its start to its due
// date, on a row of days. Drag a bar to move it, its ends to change the start or
// the due date; drag along an empty row to give a card its dates. Arrows run from
// a card to the cards waiting for it ("blocked by").

import { createMemo, For, onMount, Show } from "solid-js";
import { canEdit } from "../lib/access";
import { trackPointer } from "../lib/interactions";
import { cardById, findCard, isDone, kanban, setCardDates, setOpenCardId } from "../lib/kanban";
import { visible } from "../lib/kanbanView";
import { addDays, cardSpan, dateOf, daysBetween, isOverdue, shortDay, timelineRange, today } from "../lib/planning";
import type { KanbanCard } from "../lib/types";
import { PriorityIcon } from "./Planning";

const DAY_W = 34;
const ROW_H = 36;
const HEAD_H = 46;
const TITLE_W = 260;

export function KanbanTimeline() {
  let scroller!: HTMLDivElement;
  // Board order: by column, then as the cards are in it
  const order = createMemo(() => new Map(kanban.columns.flatMap((c, ci) => c.cards.map((card, i) => [card.id, ci * 10_000 + i] as const))));
  /** The cards shown: those with dates first (by start), then the others in board order */
  const rows = createMemo(() =>
    kanban.columns
      .flatMap((c) => c.cards)
      .filter(visible)
      .sort((a, b) => {
        const sa = cardSpan(a);
        const sb = cardSpan(b);
        if (sa && sb && sa.from !== sb.from) return sa.from < sb.from ? -1 : 1;
        if (!!sa !== !!sb) return sa ? -1 : 1;
        return (order().get(a.id) ?? 0) - (order().get(b.id) ?? 0);
      }),
  );
  const range = createMemo(() => timelineRange(rows()));
  const days = createMemo(() => Array.from({ length: range().days }, (_, i) => addDays(range().from, i)));
  const xOf = (day: string) => daysBetween(range().from, day) * DAY_W;
  const rowOf = createMemo(() => new Map(rows().map((c, i) => [c.id, i])));

  onMount(() => {
    // Today a little in from the left
    scroller.scrollLeft = Math.max(0, xOf(today()) - 3 * DAY_W);
  });

  /** The months over the days: where each starts and how many of its days are shown */
  const months = createMemo(() => {
    const out: { label: string; x: number; w: number }[] = [];
    for (const d of days()) {
      const label = dateOf(d).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const last = out[out.length - 1];
      if (last?.label === label) last.w += DAY_W;
      else out.push({ label, x: xOf(d), w: DAY_W });
    }
    return out;
  });

  /** Arrows from each blocking card's bar end to the start of the bar waiting for it */
  const arrows = createMemo(() => {
    const out: { d: string; late: boolean }[] = [];
    for (const c of rows()) {
      const to = cardSpan(c);
      if (!to) continue;
      for (const id of c.blockedBy ?? []) {
        const b = cardById(id);
        const from = b && cardSpan(b);
        if (!from || !rowOf().has(id)) continue;
        const x1 = xOf(from.to) + DAY_W - 3;
        const y1 = rowOf().get(id)! * ROW_H + ROW_H / 2;
        const x2 = xOf(to.from) + 3;
        const y2 = rowOf().get(c.id)! * ROW_H + ROW_H / 2;
        // Out of the blocker's end, down (or up) to the waiting card's row, into its start;
        // red when it is planned to start before the blocker is due
        out.push({ d: `M ${x1} ${y1} H ${x1 + 8} V ${y2} H ${x2}`, late: to.from <= from.to && !isDone(id) });
      }
    }
    return out;
  });

  return (
    <div class="kt" ref={scroller}>
      <div class="kt-inner" style={{ width: `${TITLE_W + days().length * DAY_W}px` }}>
        <div class="kt-head" style={{ height: `${HEAD_H}px` }}>
          <div class="kt-corner" style={{ width: `${TITLE_W}px` }}>
            {rows().length} card{rows().length === 1 ? "" : "s"}
          </div>
          <div class="kt-scale">
            <For each={months()}>
              {(m) => (
                <div class="kt-month" style={{ left: `${m.x}px`, width: `${m.w}px` }}>
                  <span>{m.label}</span>
                </div>
              )}
            </For>
            <For each={days()}>
              {(d) => {
                const date = dateOf(d);
                const weekend = date.getDay() === 0 || date.getDay() === 6;
                return (
                  <div class="kt-day" classList={{ weekend, today: d === today() }} style={{ left: `${xOf(d)}px`, width: `${DAY_W}px` }}>
                    {date.getDate()}
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        <div class="kt-body">
          {/* Weekends and today, behind the rows */}
          <div class="kt-grid" style={{ left: `${TITLE_W}px`, height: `${rows().length * ROW_H}px` }}>
            <For each={days().filter((d) => [0, 6].includes(dateOf(d).getDay()))}>
              {(d) => <div class="kt-weekend" style={{ left: `${xOf(d)}px`, width: `${DAY_W}px` }} />}
            </For>
            <div class="kt-today" style={{ left: `${xOf(today()) + DAY_W / 2}px` }} />
          </div>
          <For each={rows()} fallback={<div class="kt-empty">No cards</div>}>
            {(c) => <Row card={c} xOf={xOf} from={range().from} />}
          </For>
          <svg class="kt-arrows" style={{ left: `${TITLE_W}px`, width: `${days().length * DAY_W}px`, height: `${rows().length * ROW_H}px` }}>
            <defs>
              <marker id="kt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0 L8 4 L0 8 z" />
              </marker>
            </defs>
            <For each={arrows()}>{(a) => <path classList={{ late: a.late }} d={a.d} marker-end="url(#kt-arrow)" />}</For>
          </svg>
        </div>
      </div>
    </div>
  );
}

function Row(p: { card: KanbanCard; xOf: (day: string) => number; from: string }) {
  const span = () => cardSpan(p.card);
  const column = () => findCard(p.card.id)?.column;
  const done = () => isDone(p.card.id);
  /** The day under the pointer, on this row's track */
  const dayAt = (track: HTMLElement, clientX: number) =>
    addDays(p.from, Math.floor((clientX - track.getBoundingClientRect().left) / DAY_W));

  /** Drags the bar (`move`) or one of its ends; a click without moving opens the card */
  const drag = (e: PointerEvent, what: "move" | "start" | "due") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = span();
    if (!s || !canEdit()) {
      if (what === "move") setOpenCardId(p.card.id);
      return;
    }
    const x0 = e.clientX;
    let moved = false;
    trackPointer(
      e,
      (ev) => {
        const d = Math.round((ev.clientX - x0) / DAY_W);
        if (!d && !moved) return;
        moved = true;
        if (what === "start") setCardDates(p.card.id, { startDate: addDays(s.from, Math.min(d, daysBetween(s.from, s.to))) });
        else if (what === "due") setCardDates(p.card.id, { dueDate: addDays(s.to, Math.max(d, -daysBetween(s.from, s.to))) });
        else
          setCardDates(p.card.id, {
            startDate: p.card.startDate ? addDays(s.from, d) : undefined,
            dueDate: p.card.dueDate ? addDays(s.to, d) : undefined,
          });
      },
      () => {
        if (!moved && what === "move") setOpenCardId(p.card.id);
      },
    );
  };

  /** On a row without dates: drag along it to give the card a start and a due date */
  const draw = (e: PointerEvent) => {
    if (e.button !== 0 || span() || !canEdit()) return;
    const track = e.currentTarget as HTMLElement;
    const first = dayAt(track, e.clientX);
    setCardDates(p.card.id, { startDate: first, dueDate: first });
    trackPointer(e, (ev) => {
      const day = dayAt(track, ev.clientX);
      setCardDates(p.card.id, day < first ? { startDate: day, dueDate: first } : { startDate: first, dueDate: day });
    });
  };

  return (
    <div class="kt-row" style={{ height: `${ROW_H}px` }}>
      <button class="kt-title" style={{ width: `${TITLE_W}px` }} onClick={() => setOpenCardId(p.card.id)} classList={{ done: done() }}>
        <Show when={p.card.priority}>{(pr) => <PriorityIcon priority={pr()} />}</Show>
        <span class="kt-title-text">{p.card.title}</span>
        <span class={`kt-status ${column()?.color ? `color-${column()!.color}` : ""}`}>{column()?.title}</span>
      </button>
      <div class="kt-track" classList={{ empty: !span(), editable: canEdit() }} onPointerDown={draw} title={span() ? undefined : canEdit() ? "Drag here to plan this card" : undefined}>
        <Show when={span()}>
          {(s) => (
            <div
              class={`kt-bar ${column()?.color ? `color-${column()!.color}` : ""}`}
              classList={{
                done: done(),
                overdue: isOverdue(p.card, done()),
                point: !p.card.startDate || !p.card.dueDate,
                // Too short for its name: that goes beside it
                narrow: daysBetween(s().from, s().to) < 3,
              }}
              style={{ left: `${p.xOf(s().from) + 2}px`, width: `${(daysBetween(s().from, s().to) + 1) * DAY_W - 4}px` }}
              title={`${p.card.title}: ${shortDay(s().from)}${s().to !== s().from ? ` – ${shortDay(s().to)}` : ""}`}
              onPointerDown={(e) => drag(e, "move")}
            >
              <Show when={canEdit()}>
                <span class="kt-handle start" onPointerDown={(e) => drag(e, "start")} />
              </Show>
              <span class="kt-bar-label">{p.card.title}</span>
              <Show when={canEdit()}>
                <span class="kt-handle due" onPointerDown={(e) => drag(e, "due")} />
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
