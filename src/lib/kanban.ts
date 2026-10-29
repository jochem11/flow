// Kanban editor state. `kanban` is the board that is currently open; which
// document that is, and saving it, is handled by workspace.ts.
//
// Subtasks are regular cards with a `parentId`. A card counts as done when its
// column is marked as a done column (`column.done`), like "Done" in Azure Boards.

import { createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { uid } from "./store";
import type { KanbanCard, KanbanColumn, KanbanDoc, KanbanIcon, KanbanLabel, KanbanTimeEntry, NodeColor } from "./types";

export const [kanban, setKanban] = createStore<KanbanDoc>({ columns: [], labels: [] });

/** Increments on every change; workspace.ts watches it for autosave. */
const [kanbanRev, setKanbanRev] = createSignal(0);
export { kanbanRev };
const touch = () => setKanbanRev((r) => r + 1);

const DONE_TITLE = /^(done|klaar|gereed|afgerond|finished|closed)$/i;

/**
 * Fills in fields that boards saved by older versions may lack, so the rest
 * of the editor can rely on them being there. Boards without a done column
 * get one: the column called "Done" (or similar), otherwise the last column.
 */
function normalize(doc: KanbanDoc): KanbanDoc {
  const columns = doc.columns.map((col) => ({
    ...col,
    done: col.done ?? false,
    cards: col.cards.map((card) => ({
      ...card,
      labelIds: card.labelIds ?? [],
      comments: card.comments ?? [],
      timeEntries: card.timeEntries ?? [],
    })),
  }));
  if (columns.length && !columns.some((c) => c.done)) {
    const byTitle = columns.find((c) => DONE_TITLE.test(c.title.trim()));
    (byTitle ?? columns[columns.length - 1]).done = true;
  }
  return { ...doc, labels: doc.labels ?? [], columns };
}

/** Replaces the whole board (when opening a document). Does not count as a change. */
export function replaceKanban(doc: KanbanDoc) {
  setKanban(reconcile(normalize(doc)));
}

/** Plain copy without Solid proxies, ready to send to the backend. */
export const kanbanSnapshot = (): KanbanDoc => JSON.parse(JSON.stringify(unwrap(kanban)));

export const DEFAULT_COLUMNS = ["To do", "In progress", "Done"];

/** The card open in the dialog (UI state, lives here so the sidebar timer can open a card). */
export const [openCardId, setOpenCardId] = createSignal<string | null>(null);

// ---------- lookups ----------

export const labels = (): KanbanLabel[] => kanban.labels ?? [];
export const allCards = (): KanbanCard[] => kanban.columns.flatMap((c) => c.cards);

export function findCard(cardId: string): { column: KanbanColumn; index: number; card: KanbanCard } | undefined {
  for (const column of kanban.columns) {
    const index = column.cards.findIndex((c) => c.id === cardId);
    if (index >= 0) return { column, index, card: column.cards[index] };
  }
  return undefined;
}

export const cardById = (id: string) => findCard(id)?.card;
export const labelById = (id: string) => labels().find((l) => l.id === id);
export const subtasksOf = (cardId: string) => allCards().filter((c) => c.parentId === cardId);

export const isDone = (cardId: string) => findCard(cardId)?.column.done === true;

export function subtaskProgress(cardId: string): { done: number; total: number } {
  const subs = subtasksOf(cardId);
  return { done: subs.filter((s) => isDone(s.id)).length, total: subs.length };
}

/** Counts markdown task-list items ("- [ ]" / "- [x]") in a card description. */
export function taskProgress(text: string): { done: number; total: number } {
  const items = text.match(/^\s*[-*+] \[[ xX]\]/gm) ?? [];
  const done = items.filter((i) => /\[[xX]\]/.test(i)).length;
  return { done, total: items.length };
}

/** `cardId` itself plus all of its subtasks, at any depth. */
function withDescendants(cardId: string): Set<string> {
  const ids = new Set([cardId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of allCards()) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Cards that may become the parent of `cardId`: anything but itself and its own subtasks. */
export function possibleParents(cardId: string): KanbanCard[] {
  const excluded = withDescendants(cardId);
  return allCards().filter((c) => !excluded.has(c.id));
}

/** Total estimated and spent hours of the cards in a column. */
export function columnHours(column: KanbanColumn): { expected: number; spent: number } {
  let expected = 0;
  let spent = 0;
  for (const c of column.cards) {
    expected += c.expectedHours ?? 0;
    spent += c.spentHours ?? 0;
  }
  return { expected, spent };
}

/** 1.5 -> "1.5h", 0.25 -> "15m", 2 -> "2h" */
/** 2.25 -> "2h 15m", 0.5 -> "30m", 8 -> "8h" */
export function formatHours(h: number): string {
  const total = Math.round(h * 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Milliseconds as a running clock: "4:05" or "1:02:09". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

// ---------- columns ----------

export function addColumn(title = "New column"): string {
  const id = uid();
  setKanban("columns", (cols) => [...cols, { id, title, done: false, cards: [] }]);
  touch();
  return id;
}

export function addDefaultColumns() {
  setKanban("columns", (cols) => [
    ...cols,
    ...DEFAULT_COLUMNS.map((title, i) => ({ id: uid(), title, done: i === DEFAULT_COLUMNS.length - 1, cards: [] })),
  ]);
  touch();
}

export function renameColumn(id: string, title: string) {
  const value = title.trim();
  if (!value) return;
  setKanban("columns", (c) => c.id === id, "title", value);
  touch();
}

/** Sets or clears (`null`) the color or icon of a column. */
export function setColumnStyle(id: string, style: { color?: NodeColor | null; icon?: KanbanIcon | null }) {
  setKanban(
    "columns",
    (c) => c.id === id,
    produce((col) => {
      if (style.color !== undefined) col.color = style.color ?? undefined;
      if (style.icon !== undefined) col.icon = style.icon ?? undefined;
    }),
  );
  touch();
}

/** Marks whether cards in a column count as done. */
export function setColumnDone(id: string, done: boolean) {
  setKanban("columns", (c) => c.id === id, "done", done);
  touch();
}

/** Deletes a column and its cards. Subtasks elsewhere lose their parent. */
export function deleteColumn(id: string) {
  const removed = new Set(kanban.columns.find((c) => c.id === id)?.cards.map((c) => c.id));
  setKanban(
    produce((board) => {
      board.columns = board.columns.filter((c) => c.id !== id);
      for (const card of board.columns.flatMap((c) => c.cards))
        if (card.parentId && removed.has(card.parentId)) card.parentId = undefined;
    }),
  );
  touch();
}

/**
 * Moves a column so it ends up before the column currently at `toIndex`
 * (`toIndex === columns.length` moves it to the end).
 */
export function moveColumn(id: string, toIndex: number) {
  const from = kanban.columns.findIndex((c) => c.id === id);
  if (from < 0) return;
  const to = from < toIndex ? toIndex - 1 : toIndex; // account for removing it first
  if (to === from) return;
  setKanban(
    "columns",
    produce((cols) => {
      const [col] = cols.splice(from, 1);
      cols.splice(to, 0, col);
    }),
  );
  touch();
}

// ---------- cards ----------

export function addCard(columnId: string, title: string, parentId?: string): string | null {
  const value = title.trim();
  if (!value) return null;
  const card: KanbanCard = { id: uid(), title: value, description: "", parentId, labelIds: [], comments: [] };
  setKanban("columns", (c) => c.id === columnId, "cards", (cards) => [...cards, card]);
  touch();
  return card.id;
}

/** Adds a subtask in the first column, inheriting the parent's labels. */
export function addSubtask(parentId: string, title: string): string | null {
  const first = kanban.columns[0];
  const parent = cardById(parentId);
  if (!first || !parent) return null;
  const id = addCard(first.id, title, parentId);
  if (id && parent.labelIds?.length) updateCard(id, { labelIds: [...parent.labelIds] });
  return id;
}

export function updateCard(cardId: string, changes: Partial<Omit<KanbanCard, "id">>) {
  const found = findCard(cardId);
  if (!found) return;
  setKanban("columns", (c) => c.id === found.column.id, "cards", (c) => c.id === cardId, changes);
  touch();
}

/** Deletes a card. Its subtasks stay, but no longer have a parent. */
export function deleteCard(cardId: string) {
  setKanban(
    produce((board) => {
      for (const col of board.columns) {
        col.cards = col.cards.filter((c) => c.id !== cardId);
        for (const c of col.cards) if (c.parentId === cardId) c.parentId = undefined;
      }
    }),
  );
  touch();
}

/**
 * Moves a card into `toColumnId`, before the card currently at `toIndex`
 * (`toIndex === cards.length` puts it at the bottom).
 */
export function moveCard(cardId: string, toColumnId: string, toIndex: number) {
  const found = findCard(cardId);
  if (!found) return;
  const sameColumn = found.column.id === toColumnId;
  const to = sameColumn && found.index < toIndex ? toIndex - 1 : toIndex;
  if (sameColumn && to === found.index) return;

  setKanban(
    "columns",
    produce((cols) => {
      const source = cols.find((c) => c.id === found.column.id)!;
      const target = cols.find((c) => c.id === toColumnId);
      if (!target) return;
      const [card] = source.cards.splice(found.index, 1);
      target.cards.splice(Math.min(to, target.cards.length), 0, card);
    }),
  );
  touch();
}

/** Moves a card to the end of another column. */
export function moveCardToColumn(cardId: string, columnId: string) {
  const col = kanban.columns.find((c) => c.id === columnId);
  if (col && findCard(cardId)?.column.id !== columnId) moveCard(cardId, columnId, col.cards.length);
}

/** Marks a card done (moves it to the first done column) or not done (to the first other column). */
export function setDone(cardId: string, done: boolean) {
  const target = kanban.columns.find((c) => (c.done ?? false) === done);
  if (target) moveCardToColumn(cardId, target.id);
}

// ---------- labels ----------

const LABEL_COLORS: NodeColor[] = ["blue", "green", "yellow", "pink", "purple", "white"];

export function addLabel(name: string): string | null {
  const value = name.trim();
  if (!value) return null;
  const id = uid();
  const color = LABEL_COLORS[labels().length % LABEL_COLORS.length];
  setKanban("labels", (ls) => [...(ls ?? []), { id, name: value, color, description: "" }]);
  touch();
  return id;
}

export function updateLabel(id: string, changes: Partial<Omit<KanbanLabel, "id">>) {
  setKanban(
    "labels",
    (l) => l.id === id,
    produce((label) => {
      Object.assign(label, changes);
      if (changes.icon === null) label.icon = undefined;
    }),
  );
  touch();
}

/** Deletes a label and removes it from every card. */
export function deleteLabel(id: string) {
  setKanban(
    produce((board) => {
      board.labels = (board.labels ?? []).filter((l) => l.id !== id);
      for (const card of board.columns.flatMap((c) => c.cards))
        card.labelIds = (card.labelIds ?? []).filter((l) => l !== id);
    }),
  );
  touch();
}

export function toggleCardLabel(cardId: string, labelId: string) {
  const card = cardById(cardId);
  if (!card) return;
  const ids = card.labelIds ?? [];
  updateCard(cardId, { labelIds: ids.includes(labelId) ? ids.filter((l) => l !== labelId) : [...ids, labelId] });
}

// ---------- comments ----------

export function addComment(cardId: string, text: string) {
  const value = text.trim();
  const card = cardById(cardId);
  if (!value || !card) return;
  updateCard(cardId, { comments: [...(card.comments ?? []), { id: uid(), text: value, createdAt: Date.now() }] });
}

export function editComment(cardId: string, commentId: string, text: string) {
  const value = text.trim();
  const card = cardById(cardId);
  if (!value || !card) return;
  updateCard(cardId, {
    comments: (card.comments ?? []).map((c) => (c.id === commentId ? { ...c, text: value, editedAt: Date.now() } : c)),
  });
}

export function deleteComment(cardId: string, commentId: string) {
  const card = cardById(cardId);
  if (!card) return;
  updateCard(cardId, { comments: (card.comments ?? []).filter((c) => c.id !== commentId) });
}

// ---------- time tracking ----------
//
// Each card keeps a log of work sessions. A session without `endedAt` is a
// running timer; storing the start time (instead of a counter) keeps it correct
// when the app is closed in between. When a session ends, its duration is
// added to `spentHours`, which stays the card's total and can still be edited by hand.

const HOUR = 3_600_000;

export const timeEntries = (card: KanbanCard): KanbanTimeEntry[] => card.timeEntries ?? [];

/** Duration of a session in ms; a running one counts until `now`. */
export const entryMs = (e: KanbanTimeEntry, now = Date.now()) => (e.endedAt ?? now) - e.startedAt;

/** The running session on this board, if any. */
export function runningEntry(): { card: KanbanCard; entry: KanbanTimeEntry } | undefined {
  for (const card of allCards()) {
    const entry = timeEntries(card).find((e) => e.endedAt == null);
    if (entry) return { card, entry };
  }
  return undefined;
}

/** Adds (or with a negative value, removes) hours from a card's total. */
function addSpent(card: KanbanCard, hours: number) {
  const total = Math.max(0, (card.spentHours ?? 0) + hours);
  card.spentHours = Math.round(total * 1000) / 1000;
}

/**
 * Ends the running session on `card` at `at` and adds it to the total.
 * Works on a plain card or a store draft; returns whether anything changed.
 * Also used by timer.ts to stop a timer in a board that is not open.
 */
export function closeRunningEntry(card: KanbanCard, at: number): boolean {
  const entry = (card.timeEntries ?? []).find((e) => e.endedAt == null);
  if (!entry) return false;
  entry.endedAt = Math.max(at, entry.startedAt);
  addSpent(card, (entry.endedAt - entry.startedAt) / HOUR);
  return true;
}

/** Applies `fn` to a store draft of the card and schedules a save. */
function mutateCard(cardId: string, fn: (card: KanbanCard) => void) {
  const found = findCard(cardId);
  if (!found) return;
  setKanban("columns", (c) => c.id === found.column.id, "cards", (c) => c.id === cardId, produce(fn));
  touch();
}

/** Stops whatever runs on this board, then starts a session on `cardId`. Returns the start time. */
export function startEntry(cardId: string): number {
  stopRunningEntry();
  const startedAt = Date.now();
  mutateCard(cardId, (card) => {
    card.timeEntries = [...(card.timeEntries ?? []), { id: uid(), startedAt, note: "" }];
  });
  return startedAt;
}

export function stopRunningEntry() {
  const running = runningEntry();
  if (running) mutateCard(running.card.id, (card) => closeRunningEntry(card, Date.now()));
}

/** Logs a session afterwards ("worked on this yesterday from 2 to 4"). */
export function addTimeEntry(cardId: string, startedAt: number, endedAt: number, note = "") {
  if (endedAt <= startedAt) return;
  mutateCard(cardId, (card) => {
    card.timeEntries = [...(card.timeEntries ?? []), { id: uid(), startedAt, endedAt, note }];
    card.timeEntries.sort((a, b) => a.startedAt - b.startedAt);
    addSpent(card, (endedAt - startedAt) / HOUR);
  });
}

/** Edits a session; the card's total moves along with any change in duration. */
export function updateTimeEntry(
  cardId: string,
  entryId: string,
  changes: { startedAt?: number; endedAt?: number; note?: string },
) {
  mutateCard(cardId, (card) => {
    const entry = card.timeEntries?.find((e) => e.id === entryId);
    if (!entry) return;
    const before = entry.endedAt == null ? 0 : entry.endedAt - entry.startedAt;
    const next = { ...entry, ...changes };
    if (next.endedAt != null && next.endedAt <= next.startedAt) return; // ignore an impossible range
    Object.assign(entry, changes);
    if (entry.endedAt != null) addSpent(card, (entry.endedAt - entry.startedAt - before) / HOUR);
  });
}

/** Deletes a session and takes its duration off the card's total. */
export function deleteTimeEntry(cardId: string, entryId: string) {
  mutateCard(cardId, (card) => {
    const entry = card.timeEntries?.find((e) => e.id === entryId);
    if (!entry) return;
    if (entry.endedAt != null) addSpent(card, -(entry.endedAt - entry.startedAt) / HOUR);
    card.timeEntries = card.timeEntries!.filter((e) => e.id !== entryId);
  });
}
