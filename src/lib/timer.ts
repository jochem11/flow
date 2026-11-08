// The running timer, across documents.
//
// The session itself is stored on the card (see "time tracking" in kanban.ts).
// This file remembers *where* it runs, so the sidebar can show and stop it
// while you are in another document, and so starting a timer in one board
// stops the one running in another.

import { createSignal } from "solid-js";
import { errMsg } from "./api";
import { closeRunningEntry, kanban, runningEntry, startEntry, stopRunningEntry } from "./kanban";
import { toast } from "./toast";
import { openDoc } from "./workspace";
import { changeClosedBoard } from "./collab";

export interface ActiveTimer {
  projectId: string;
  docId: string;
  docName: string;
  cardId: string;
  cardTitle: string;
  startedAt: number;
}

const KEY = "flowapp:activeTimer";

function load(): ActiveTimer | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}

const [activeTimer, setActiveTimerRaw] = createSignal<ActiveTimer | null>(load());
export { activeTimer };

function setActiveTimer(t: ActiveTimer | null) {
  setActiveTimerRaw(t);
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the timer still works while the app is open */
  }
}

/** Ticks every second, for live timer displays. */
const [now, setNow] = createSignal(Date.now());
setInterval(() => setNow(Date.now()), 1000);
export { now };

const isOpen = (t: ActiveTimer) => openDoc()?.id === t.docId;

/** Starts a timer on a card of the open board, stopping any other running timer first. */
export async function startTimer(cardId: string) {
  const doc = openDoc();
  const card = kanban.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);
  if (!doc || !card) return;
  const current = activeTimer();
  if (current && !isOpen(current)) await stopTimer();
  const startedAt = startEntry(cardId);
  setActiveTimer({
    projectId: doc.projectId,
    docId: doc.id,
    docName: doc.name,
    cardId,
    cardTitle: card.title,
    startedAt,
  });
}

/** Stops the running timer, also when it runs in a board that is not open. */
export async function stopTimer() {
  const t = activeTimer();
  if (!t) return;
  if (isOpen(t)) {
    stopRunningEntry();
  } else {
    try {
      const now = Date.now();
      await changeClosedBoard(t.projectId, t.docId, (content) => {
        if (content.kind !== "kanban") return false;
        const card = content.data.columns.flatMap((c) => c.cards).find((c) => c.id === t.cardId);
        return !!card && closeRunningEntry(card, now);
      });
    } catch (e) {
      toast(`Could not stop the timer: ${errMsg(e)}`, "error");
      return;
    }
  }
  setActiveTimer(null);
}

/**
 * Brings `activeTimer` in line with the open board: picks up a timer that is
 * running there, and forgets one that was stopped or deleted. Called by the
 * kanban editor whenever the board changes.
 */
export function syncTimerWithBoard() {
  const doc = openDoc();
  if (!doc || doc.kind !== "kanban") return;
  const running = runningEntry();
  const current = activeTimer();
  if (running) {
    const next: ActiveTimer = {
      projectId: doc.projectId,
      docId: doc.id,
      docName: doc.name,
      cardId: running.card.id,
      cardTitle: running.card.title,
      startedAt: running.entry.startedAt,
    };
    if (JSON.stringify(next) !== JSON.stringify(current)) setActiveTimer(next);
  } else if (current?.docId === doc.id) {
    setActiveTimer(null);
  }
}
