// Kanban editor state. `kanban` is the board that is currently open; which
// document that is, and saving it, is handled by workspace.ts.
//
// Subtasks are regular cards with a `parentId`. A card counts as done when its
// column is marked as a done column (`column.done`), like "Done" in Azure Boards.
//
// As in Jira: every card has a ticket id (`WEB-12`: the board's key and the
// card's number), and is in a sprint or in the backlog (tickets.ts).

import { createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { me } from "./auth";
import { uid } from "./store";
import type { KanbanCard, KanbanColumn, KanbanDoc, KanbanIcon, KanbanLabel, KanbanTimeEntry, NodeColor, Priority, Sprint } from "./types";
import { addDays, makesLoop, openBlockers, today } from "./planning";
import { byRank, cleanKey, keyFromName, lastRank, needsNumbers, nextNumber, nextSprintName, numberCards, openSprints, rankBetween, stateOf, ticketId } from "./tickets";

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
  return { ...doc, labels: doc.labels ?? [], sprints: doc.sprints ?? [], columns };
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

/** A new card at the bottom of a column, and last in its sprint (`sprintId`; none: the backlog). */
export function addCard(columnId: string, title: string, parentId?: string, sprintId?: string | null): string | null {
  const value = title.trim();
  if (!value) return null;
  const number = nextNumber(kanban);
  const card: KanbanCard = { id: uid(), number, rank: lastRank(allCards()), title: value, description: "", parentId, labelIds: [], comments: [] };
  if (sprintId && sprintById(sprintId)) card.sprintId = sprintId;
  setKanban(
    produce((board) => {
      board.columns.find((c) => c.id === columnId)?.cards.push(card);
      board.nextNumber = number + 1;
    }),
  );
  touch();
  return card.id;
}

/** Adds a subtask in the first column, in the parent's sprint and with its labels. */
export function addSubtask(parentId: string, title: string): string | null {
  const first = kanban.columns[0];
  const parent = cardById(parentId);
  if (!first || !parent) return null;
  const id = addCard(first.id, title, parentId, parent.sprintId);
  if (id && parent.labelIds?.length) updateCard(id, { labelIds: [...parent.labelIds] });
  return id;
}

export function updateCard(cardId: string, changes: Partial<Omit<KanbanCard, "id">>) {
  const found = findCard(cardId);
  if (!found) return;
  setKanban("columns", (c) => c.id === found.column.id, "cards", (c) => c.id === cardId, changes);
  touch();
}

/** Deletes a card. Its subtasks stay, but no longer have a parent; cards it blocked no longer wait for it. */
export function deleteCard(cardId: string) {
  setKanban(
    produce((board) => {
      for (const col of board.columns) {
        col.cards = col.cards.filter((c) => c.id !== cardId);
        for (const c of col.cards) {
          if (c.parentId === cardId) c.parentId = undefined;
          if (c.blockedBy?.includes(cardId)) c.blockedBy = c.blockedBy.filter((id) => id !== cardId);
        }
      }
    }),
  );
  touch();
}

// ---------- planning ----------

/** Start and due date (`YYYY-MM-DD`; null clears it). A start after the due date moves the due date along. */
export function setCardDates(cardId: string, dates: { startDate?: string | null; dueDate?: string | null }) {
  mutateCard(cardId, (card) => {
    if (dates.startDate !== undefined) card.startDate = dates.startDate ?? undefined;
    if (dates.dueDate !== undefined) card.dueDate = dates.dueDate ?? undefined;
    if (card.startDate && card.dueDate && card.startDate > card.dueDate) {
      if (dates.startDate !== undefined) card.dueDate = card.startDate;
      else card.startDate = card.dueDate;
    }
  });
}

export function setPriority(cardId: string, priority: Priority | null) {
  mutateCard(cardId, (card) => (card.priority = priority ?? undefined));
}

/** `blockerId` must be done before `cardId` can be (or no longer). False when that would make a loop. */
export function toggleBlocker(cardId: string, blockerId: string): boolean {
  const card = cardById(cardId);
  if (!card) return false;
  const has = (card.blockedBy ?? []).includes(blockerId);
  if (!has && makesLoop(cardId, blockerId, cardById)) return false;
  mutateCard(cardId, (c) => {
    const ids = c.blockedBy ?? [];
    c.blockedBy = has ? ids.filter((id) => id !== blockerId) : [...ids, blockerId];
  });
  return true;
}

/** The cards that block this one and are not done yet */
export const blockersOf = (cardId: string) => {
  const card = cardById(cardId);
  return card ? openBlockers(card, cardById, isDone) : [];
};
/** The cards waiting for this one */
export const blockingOf = (cardId: string) => allCards().filter((c) => (c.blockedBy ?? []).includes(cardId));

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
//
// Every session says who spent the time (`userId`, `userName`). Each person has
// their own timer: several people can track time on one card at once, and
// "the running session" is always yours. (The desktop app's own files have no
// users; sessions there have no owner and are all yours.)

const HOUR = 3_600_000;

export const timeEntries = (card: KanbanCard): KanbanTimeEntry[] => card.timeEntries ?? [];

/** Duration of a session in ms; a running one counts until `now`. */
export const entryMs = (e: KanbanTimeEntry, now = Date.now()) => (e.endedAt ?? now) - e.startedAt;

/** The logged-in user, as a session's owner (none in the desktop app's own files) */
const owner = () => {
  const u = me()?.user;
  return u ? { userId: u.id, userName: u.name } : {};
};

/** Is this session yours? (Sessions without an owner are from before accounts.) */
export const isMine = (e: KanbanTimeEntry, userId = me()?.user.id) => !e.userId || e.userId === userId;

/** Your running session on this board, if any. */
export function runningEntry(): { card: KanbanCard; entry: KanbanTimeEntry } | undefined {
  for (const card of allCards()) {
    const entry = timeEntries(card).find((e) => e.endedAt == null && isMine(e));
    if (entry) return { card, entry };
  }
  return undefined;
}

/** Time spent on a card per person (running sessions count until `now`), most first. */
export function timeByPerson(card: KanbanCard, now = Date.now()): { userId: string | null; name: string; ms: number }[] {
  const by = new Map<string, { userId: string | null; name: string; ms: number }>();
  for (const e of timeEntries(card)) {
    const key = e.userId ?? "";
    const row = by.get(key) ?? { userId: e.userId ?? null, name: e.userName ?? "Unknown", ms: 0 };
    row.ms += entryMs(e, now);
    if (e.userName) row.name = e.userName;
    by.set(key, row);
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms);
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
export function closeRunningEntry(card: KanbanCard, at: number, userId = me()?.user.id): boolean {
  const entry = (card.timeEntries ?? []).find((e) => e.endedAt == null && isMine(e, userId));
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

/**
 * Stops your timer on this board, then starts a session of yours on `cardId`
 * (and assigns you to the card if you were not). Returns the start time.
 */
export function startEntry(cardId: string): number {
  stopRunningEntry();
  const startedAt = Date.now();
  const who = owner();
  mutateCard(cardId, (card) => {
    card.timeEntries = [...(card.timeEntries ?? []), { id: uid(), startedAt, note: "", ...who }];
    if (who.userId && !(card.assigneeIds ?? []).includes(who.userId)) card.assigneeIds = [...(card.assigneeIds ?? []), who.userId];
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
    card.timeEntries = [...(card.timeEntries ?? []), { id: uid(), startedAt, endedAt, note, ...owner() }];
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

/** An older state of the board (version history), as a change that everyone gets. */
export function restoreKanban(doc: KanbanDoc) {
  setKanban(reconcile(normalize(doc)));
  touch();
}

/** Changes from someone else (editing together): the board as it is now. */
export function applyRemoteKanban(doc: KanbanDoc) {
  setKanban(reconcile(normalize(doc)));
}

// ---------- people ----------

/** Assigns someone to a card, or takes them off it. */
export function toggleAssignee(cardId: string, userId: string) {
  mutateCard(cardId, (card) => {
    const ids = card.assigneeIds ?? [];
    card.assigneeIds = ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId];
  });
}

// ---------- ticket ids ----------

/** The board's key: `WEB` in `WEB-12` */
export const boardKey = () => kanban.key || "CARD";
/** A card's ticket id (`WEB-12`); nothing while it has no number yet */
export const cardKey = (card: KanbanCard) => ticketId(kanban.key, card);

/** Is a key or a number missing (a board from before ticket ids, a card added from elsewhere)? */
export const needsTickets = () => !kanban.key || needsNumbers(kanban);

/**
 * Gives the board its key (from its name) and every card its number, where they
 * are missing. A change like any other: it is saved, and everyone gets it.
 */
export function ensureTickets(boardName: string) {
  if (!needsTickets()) return;
  let changed = false;
  setKanban(
    produce((board) => {
      if (!board.key) {
        board.key = keyFromName(boardName);
        changed = true;
      }
      if (numberCards(board)) changed = true;
    }),
  );
  if (changed) touch();
}

/** Another key for the board: every ticket id changes with it. False when it is not a key. */
export function setBoardKey(text: string): boolean {
  const key = cleanKey(text);
  if (key.length < 2) return false;
  if (key !== kanban.key) {
    setKanban("key", key);
    touch();
  }
  return true;
}

// ---------- sprints ----------

export const sprints = (): Sprint[] => kanban.sprints ?? [];
export const sprintById = (id: string | null | undefined) => (id ? sprints().find((s) => s.id === id) : undefined);
/** The sprints still to do: running first, then the planned ones */
export const plannedSprints = () => openSprints(sprints());
export const activeSprints = () => sprints().filter((s) => stateOf(s) === "active");

/** The sprint a card is in (not one that was deleted meanwhile) */
export const sprintOf = (card: KanbanCard) => sprintById(card.sprintId);
/** In a completed sprint: no longer on the board or in the backlog */
export const isArchived = (card: KanbanCard) => {
  const s = sprintOf(card);
  return !!s && stateOf(s) === "done";
};

/** The cards of a sprint, or (null) of the backlog, in order */
export function cardsIn(sprintId: string | null): KanbanCard[] {
  return allCards()
    .filter((c) => (sprintOf(c)?.id ?? null) === sprintId)
    .sort(byRank);
}

export function addSprint(): string {
  const id = uid();
  setKanban("sprints", (list) => [...(list ?? []), { id, name: nextSprintName(list ?? []), goal: "", state: "planned" as const }]);
  touch();
  return id;
}

export function updateSprint(id: string, changes: Partial<Pick<Sprint, "name" | "goal" | "startDate" | "endDate">>) {
  setKanban(
    "sprints",
    (s) => s.id === id,
    produce((sprint) => {
      if (changes.name !== undefined && changes.name.trim()) sprint.name = changes.name.trim();
      if (changes.goal !== undefined) sprint.goal = changes.goal ?? "";
      if (changes.startDate !== undefined) sprint.startDate = changes.startDate || undefined;
      if (changes.endDate !== undefined) sprint.endDate = changes.endDate || undefined;
      // It cannot end before it starts
      if (sprint.startDate && sprint.endDate && sprint.endDate < sprint.startDate) sprint.endDate = sprint.startDate;
    }),
  );
  touch();
}

/** Starts a sprint. Without dates it runs for two weeks from today. */
export function startSprint(id: string) {
  setKanban(
    "sprints",
    (s) => s.id === id,
    produce((sprint) => {
      sprint.state = "active";
      sprint.startDate ??= today();
      sprint.endDate ??= addDays(sprint.startDate, 13);
      sprint.completedOn = undefined;
      sprint.carriedOver = undefined;
    }),
  );
  touch();
}

/**
 * Completes a sprint. Its cards that are done stay with it (and leave the
 * board); the others go on to `moveTo`: another sprint, "new" for a new one, or
 * (null) the backlog. Returns how many went on.
 */
export function completeSprint(id: string, moveTo: string | "new" | null): number {
  if (!sprintById(id)) return 0;
  const open = cardsIn(id).filter((c) => !isDone(c.id));
  const target = moveTo === "new" ? addSprint() : sprintById(moveTo)?.id;
  // After what is in the sprint they go to, in the order they were in
  let rank = lastRank(target ? cardsIn(target) : []);
  const ranks = new Map(open.map((c) => [c.id, rank++]));
  setKanban(
    produce((board) => {
      for (const card of board.columns.flatMap((c) => c.cards)) {
        if (!ranks.has(card.id)) continue;
        card.sprintId = target;
        if (target) card.rank = ranks.get(card.id);
      }
      const sprint = (board.sprints ?? []).find((s) => s.id === id);
      if (!sprint) return;
      sprint.state = "done";
      sprint.completedOn = today();
      sprint.carriedOver = open.length;
    }),
  );
  touch();
  return open.length;
}

/** A completed sprint that is not over after all: it runs again, with its cards back on the board. */
export function reopenSprint(id: string) {
  setKanban(
    "sprints",
    (s) => s.id === id,
    produce((sprint) => {
      sprint.state = "active";
      sprint.completedOn = undefined;
      sprint.carriedOver = undefined;
    }),
  );
  touch();
}

/** Deletes a sprint; its cards go back to the backlog. */
export function deleteSprint(id: string) {
  setKanban(
    produce((board) => {
      board.sprints = (board.sprints ?? []).filter((s) => s.id !== id);
      for (const card of board.columns.flatMap((c) => c.cards)) if (card.sprintId === id) card.sprintId = undefined;
    }),
  );
  touch();
}

/** Moves a sprint one place earlier (-1) or later (1) among the sprints still to do. */
export function moveSprint(id: string, by: -1 | 1) {
  const open = plannedSprints();
  const other = open[open.findIndex((s) => s.id === id) + by];
  if (!other) return;
  setKanban(
    produce((board) => {
      const list = board.sprints ?? [];
      const a = list.findIndex((s) => s.id === id);
      const b = list.findIndex((s) => s.id === other.id);
      if (a < 0 || b < 0) return;
      [list[a], list[b]] = [list[b], list[a]];
    }),
  );
  touch();
}

/**
 * Puts a card in a sprint (null: the backlog), before the card `beforeId` there
 * or, without one, last. Its subtasks that were in the same sprint come along.
 */
export function planCard(cardId: string, sprintId: string | null, beforeId?: string | null) {
  const card = cardById(cardId);
  if (!card) return;
  const target = sprintById(sprintId)?.id ?? null;
  const from = sprintOf(card)?.id ?? null;
  const list = cardsIn(target).filter((c) => c.id !== cardId);
  const at = beforeId ? list.findIndex((c) => c.id === beforeId) : -1;
  const index = at < 0 ? list.length : at;
  // Dropped where it already is
  if (from === target && cardsIn(target).findIndex((c) => c.id === cardId) === index) return;
  let rank = rankBetween(list, index);
  // No room between its neighbours: the whole list is ranked again, 1, 2, 3, ...
  const spread = new Map<string, number>();
  if (rank === null) {
    const order = [...list.slice(0, index).map((c) => c.id), cardId, ...list.slice(index).map((c) => c.id)];
    order.forEach((id, i) => spread.set(id, i + 1));
    rank = spread.get(cardId)!;
  }
  const along = from === target ? new Set<string>() : new Set([...withDescendants(cardId)].filter((id) => id !== cardId && (sprintOf(cardById(id)!)?.id ?? null) === from));
  setKanban(
    produce((board) => {
      for (const c of board.columns.flatMap((col) => col.cards)) {
        if (spread.has(c.id)) c.rank = spread.get(c.id);
        if (c.id === cardId) {
          c.sprintId = target ?? undefined;
          c.rank = rank!;
        } else if (along.has(c.id)) c.sprintId = target ?? undefined;
      }
    }),
  );
  touch();
}

