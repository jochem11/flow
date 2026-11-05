// Planning on a kanban board: dates, priority, what blocks what, and the filter
// above the board. Pure functions; the board itself is in kanban.ts.

import type { KanbanCard, Priority } from "./types";

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
/** Urgent first; no priority last */
export const priorityRank = (p?: Priority | null) => (p ? PRIORITIES.findIndex((x) => x.value === p) : PRIORITIES.length);

// ---------- days (`YYYY-MM-DD`, local time) ----------

const pad = (n: number) => String(n).padStart(2, "0");
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => dayOf(new Date());
/** Noon, so a change to or from summer time never moves it to another day */
export const dateOf = (day: string) => new Date(`${day}T12:00:00`);
export const addDays = (day: string, n: number) => {
  const d = dateOf(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
};
export const daysBetween = (a: string, b: string) => Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86_400_000);

/** "Mar 4", or "Mar 4, 2027" in another year */
export function shortDay(day: string, now = today()): string {
  const d = dateOf(day);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (day.slice(0, 4) !== now.slice(0, 4)) opts.year = "numeric";
  return d.toLocaleDateString(undefined, opts);
}

// ---------- state of a card ----------

/** Past its due date and not done */
export const isOverdue = (card: KanbanCard, done: boolean, now = today()) => !done && !!card.dueDate && card.dueDate < now;
/** Due today or tomorrow and not done */
export const isDueSoon = (card: KanbanCard, done: boolean, now = today()) =>
  !done && !!card.dueDate && card.dueDate >= now && daysBetween(now, card.dueDate) <= 1;

/** The cards that block this one and are not done yet */
export function openBlockers(card: KanbanCard, find: (id: string) => KanbanCard | undefined, isDone: (id: string) => boolean): KanbanCard[] {
  return (card.blockedBy ?? []).map(find).filter((c): c is KanbanCard => !!c && !isDone(c.id));
}

/** Would `blocker` blocking `card` make a loop (`card` already, directly or not, blocking `blocker`)? */
export function makesLoop(cardId: string, blockerId: string, find: (id: string) => KanbanCard | undefined): boolean {
  if (cardId === blockerId) return true;
  const seen = new Set<string>();
  const todo = [blockerId];
  while (todo.length) {
    const id = todo.pop()!;
    if (id === cardId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    todo.push(...(find(id)?.blockedBy ?? []));
  }
  return false;
}

// ---------- the filter above the board ----------

export interface CardFilter {
  text: string;
  /** Only cards assigned to this user */
  mine: string | null;
  labelId: string | null;
  priority: Priority | null;
  overdue: boolean;
}
export const NO_FILTER: CardFilter = { text: "", mine: null, labelId: null, priority: null, overdue: false };
export const isFiltering = (f: CardFilter) => !!(f.text.trim() || f.mine || f.labelId || f.priority || f.overdue);

export function matches(card: KanbanCard, f: CardFilter, done: boolean, now = today()): boolean {
  const text = f.text.trim().toLowerCase();
  if (text && !`${card.title}\n${card.description}`.toLowerCase().includes(text)) return false;
  if (f.mine && !(card.assigneeIds ?? []).includes(f.mine)) return false;
  if (f.labelId && !(card.labelIds ?? []).includes(f.labelId)) return false;
  if (f.priority && card.priority !== f.priority) return false;
  if (f.overdue && !isOverdue(card, done, now)) return false;
  return true;
}

// ---------- the timeline ----------

/** The days a card takes on the timeline: from its start (else its due date) to its due date (else its start). */
export function cardSpan(card: KanbanCard): { from: string; to: string } | null {
  const from = card.startDate ?? card.dueDate;
  const to = card.dueDate ?? card.startDate;
  if (!from || !to) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** The days the timeline shows: around all cards with dates, at least two weeks from a few days ago. */
export function timelineRange(cards: KanbanCard[], now = today()): { from: string; days: number } {
  let from = addDays(now, -3);
  let to = addDays(now, 14);
  for (const c of cards) {
    const s = cardSpan(c);
    if (!s) continue;
    if (s.from < from) from = s.from;
    if (s.to > to) to = s.to;
  }
  // A little room on both sides
  from = addDays(from, -2);
  return { from, days: daysBetween(from, addDays(to, 3)) + 1 };
}
