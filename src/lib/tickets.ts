// Ticket ids and sprints on a kanban board, as in Jira. Pure functions on a
// board's content; the open board itself is in kanban.ts.
//
// Every card has a number that is never used twice on its board; with the
// board's key it is the card's ticket id (`WEB-12`). A card is in a sprint
// (`sprintId`) or, without one, in the backlog. `rank` is its place in those
// lists: lower comes first.

import type { KanbanCard, KanbanDoc, Sprint } from "./types";

// ---------- ticket ids ----------

export const MAX_KEY = 6;

/** A key as it is kept: capitals and digits, starting with a letter, at most six. */
export function cleanKey(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, MAX_KEY);
}

/** A key for a board by its name: "Web shop" → WS, "Website" → WEB, "Q3 planning board" → QPB. */
export function keyFromName(name: string): string {
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => cleanKey(w.normalize("NFD")))
    .filter(Boolean);
  if (!words.length) return "CARD";
  if (words.length === 1) return words[0].slice(0, 3);
  return cleanKey(words.map((w) => w[0]).join("")).slice(0, 4);
}

const cardsOf = (doc: KanbanDoc): KanbanCard[] => doc.columns.flatMap((c) => c.cards);

/** The number a new card gets: after every number given so far. */
export function nextNumber(doc: KanbanDoc): number {
  let n = doc.nextNumber ?? 1;
  for (const c of cardsOf(doc)) if (c.number != null && c.number >= n) n = c.number + 1;
  return n;
}

/** Does a card lack a number, or do two have the same one (added by two people at once)? */
export function needsNumbers(doc: KanbanDoc): boolean {
  const seen = new Set<number>();
  for (const c of cardsOf(doc)) {
    if (c.number == null || seen.has(c.number)) return true;
    seen.add(c.number);
  }
  return false;
}

/**
 * Gives every card without a number one, in board order. Of two cards with the
 * same number, the one with the lower id keeps it (so everyone who repairs it
 * gets the same result). Changes `doc`; says whether it did.
 */
export function numberCards(doc: KanbanDoc): boolean {
  const cards = cardsOf(doc);
  const owner = new Map<number, KanbanCard>();
  for (const c of cards) {
    if (c.number == null) continue;
    const other = owner.get(c.number);
    if (!other || c.id < other.id) owner.set(c.number, c);
  }
  let next = nextNumber(doc);
  let changed = false;
  for (const c of cards) {
    if (c.number != null && owner.get(c.number) === c) continue;
    c.number = next++;
    changed = true;
  }
  if (changed || (doc.nextNumber ?? 1) < next) {
    changed ||= doc.nextNumber !== next;
    doc.nextNumber = next;
  }
  return changed;
}

/** `WEB-12`; nothing while the card has no number yet */
export const ticketId = (key: string | null | undefined, card: Pick<KanbanCard, "number">) => (card.number != null ? `${key || "CARD"}-${card.number}` : "");

// ---------- order ----------

/** A card's place in the lists: its rank, else (cards from before ranks) its number */
export const rankOf = (c: KanbanCard) => c.rank ?? c.number ?? Number.MAX_SAFE_INTEGER;

export const byRank = (a: KanbanCard, b: KanbanCard) => rankOf(a) - rankOf(b) || (a.number ?? 0) - (b.number ?? 0);

/** The rank that puts a card last */
export const lastRank = (cards: KanbanCard[]) => cards.reduce((m, c) => Math.max(m, c.rank ?? c.number ?? 0), 0) + 1;

/**
 * The rank for a card dropped in `list` (in order, without the card itself)
 * before the card at `index`. Null: no room between its neighbours, the list
 * has to be ranked again (`spread`).
 */
export function rankBetween(list: KanbanCard[], index: number): number | null {
  const prev = list[index - 1];
  const next = list[index];
  if (!prev && !next) return 1;
  if (!prev) return rankOf(next) - 1;
  if (!next) return rankOf(prev) + 1;
  const a = rankOf(prev);
  const b = rankOf(next);
  return b - a > 1e-6 ? (a + b) / 2 : null;
}

// ---------- sprints ----------

export const sprintsOf = (doc: KanbanDoc): Sprint[] => doc.sprints ?? [];
export const stateOf = (s: Sprint) => s.state ?? "planned";

/** "Sprint 4": one more than the highest number in a sprint's name */
export function nextSprintName(sprints: Sprint[]): string {
  let n = sprints.length;
  for (const s of sprints) {
    const m = /(\d+)\s*$/.exec(s.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `Sprint ${n + 1}`;
}

/** The sprints still to do: the running ones first, then the planned ones as they are ordered */
export function openSprints(sprints: Sprint[]): Sprint[] {
  return [...sprints.filter((s) => stateOf(s) === "active"), ...sprints.filter((s) => stateOf(s) === "planned")];
}

export interface Progress {
  total: number;
  done: number;
  /** Hours estimated, and spent */
  expected: number;
  spent: number;
  /** Hours estimated on the cards that are done */
  expectedDone: number;
}

export function progressOf(cards: KanbanCard[], isDone: (c: KanbanCard) => boolean): Progress {
  const p: Progress = { total: cards.length, done: 0, expected: 0, spent: 0, expectedDone: 0 };
  for (const c of cards) {
    const done = isDone(c);
    if (done) p.done++;
    p.expected += c.expectedHours ?? 0;
    p.spent += c.spentHours ?? 0;
    if (done) p.expectedDone += c.expectedHours ?? 0;
  }
  return p;
}

const DAY = 86_400_000;
const noon = (day: string) => new Date(`${day}T12:00:00`).getTime();

/** Where a sprint is in its days: how many it has, how many are gone, how many are left (0 on its last day) */
export function sprintDays(s: Sprint, today: string): { total: number; gone: number; left: number } | null {
  if (!s.startDate || !s.endDate) return null;
  const total = Math.round((noon(s.endDate) - noon(s.startDate)) / DAY) + 1;
  const gone = Math.min(total, Math.max(0, Math.round((noon(today) - noon(s.startDate)) / DAY)));
  const left = Math.round((noon(s.endDate) - noon(today)) / DAY);
  return { total, gone, left };
}
