// How the open kanban board is looked at: as columns, a list or a timeline, and
// the filter above it. Per viewer: kept in this browser, never in the board.

import { createSignal } from "solid-js";
import { isDone } from "./kanban";
import { matches, NO_FILTER, type CardFilter } from "./planning";
import type { KanbanCard } from "./types";

export type KanbanView = "board" | "list" | "timeline";

const [view, setViewSignal] = createSignal<KanbanView>("board");
export { view };
const key = (docId: string) => `flow:kanban-view:${docId}`;

/** The view this browser last used for the board */
export function loadView(docId: string) {
  let v: string | null = null;
  try {
    v = localStorage.getItem(key(docId));
  } catch {
    /* no storage here */
  }
  setViewSignal(v === "list" || v === "timeline" ? v : "board");
}

export function setView(v: KanbanView, docId?: string) {
  setViewSignal(v);
  try {
    if (docId) localStorage.setItem(key(docId), v);
  } catch {
    /* no storage here */
  }
}

export const [filter, setFilter] = createSignal<CardFilter>(NO_FILTER);
export const updateFilter = (f: Partial<CardFilter>) => setFilter({ ...filter(), ...f });

/** Does the card pass the filter? */
export const visible = (card: KanbanCard) => matches(card, filter(), isDone(card.id));
