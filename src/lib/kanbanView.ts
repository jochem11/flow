// How the open kanban board is looked at: as a summary, the backlog, columns, a
// list or a timeline; which sprint the columns show; and the filter above it.
// Per viewer: kept in this browser, never in the board.

import { createSignal } from "solid-js";
import { activeSprints, cardKey, isArchived, isDone, sprintById, sprintOf } from "./kanban";
import { matches, NO_FILTER, type CardFilter } from "./planning";
import { stateOf } from "./tickets";
import type { KanbanCard } from "./types";

export type KanbanView = "summary" | "backlog" | "board" | "list" | "timeline";
const VIEWS: KanbanView[] = ["summary", "backlog", "board", "list", "timeline"];

const [view, setViewSignal] = createSignal<KanbanView>("board");
export { view };
const key = (docId: string) => `flow:kanban-view:${docId}`;
const scopeKey = (docId: string) => `flow:kanban-scope:${docId}`;

const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // no storage here
  }
};
const store = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* no storage here */
  }
};

/** The view this browser last used for the board */
export function loadView(docId: string) {
  const v = stored(key(docId)) as KanbanView | null;
  setViewSignal(v && VIEWS.includes(v) ? v : "board");
  setPicked(stored(scopeKey(docId)));
}

export function setView(v: KanbanView, docId?: string) {
  setViewSignal(v);
  if (docId) store(key(docId), v);
}

// ---------- which cards the columns show ----------

/** Everything on the board, only the backlog, or one sprint (its id) */
export type Scope = "all" | "backlog" | string;

/** What was picked for this board, if anything */
const [picked, setPicked] = createSignal<string | null>(null);

/**
 * What the columns show: what was picked, while that sprint is still to do;
 * else the running sprint, as in Jira; else (no sprint running) everything.
 */
export function scope(): Scope {
  const p = picked();
  if (p === "all" || p === "backlog") return p;
  const s = sprintById(p);
  if (s && stateOf(s) !== "done") return s.id;
  return activeSprints()[0]?.id ?? "all";
}

export function setScope(s: Scope, docId?: string) {
  setPicked(s);
  if (docId) store(scopeKey(docId), s);
}

/** Is the card on the board as it is shown now? Never one of a completed sprint. */
export function onBoard(card: KanbanCard): boolean {
  if (isArchived(card)) return false;
  const s = scope();
  if (s === "all") return true;
  return (sprintOf(card)?.id ?? "backlog") === s;
}

/** The sprint new cards on the board go in: the one that is shown */
export const scopeSprint = (): string | null => {
  const s = scope();
  return s === "all" || s === "backlog" ? null : s;
};

// ---------- the filter ----------

export const [filter, setFilter] = createSignal<CardFilter>(NO_FILTER);
export const updateFilter = (f: Partial<CardFilter>) => setFilter({ ...filter(), ...f });

/** Does the card pass the filter? Its ticket id counts as part of its title. */
export const visible = (card: KanbanCard) => {
  const f = filter();
  return matches(f.text.trim() ? { ...card, title: `${cardKey(card)} ${card.title}` } : card, f, isDone(card.id));
};
