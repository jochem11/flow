// Shows the running timer at the bottom of the sidebar, from any document.
// Clicking it opens the card; the stop button works even when the board is closed.

import { Show } from "solid-js";
import { formatClock, setOpenCardId } from "../lib/kanban";
import { activeTimer, now, stopTimer } from "../lib/timer";
import { openDocument } from "../lib/workspace";
import { IconStop } from "./icons";

export function TimerIndicator() {
  return (
    <Show when={activeTimer()}>
      {(t) => (
        <div class="timer-indicator">
          <button
            class="timer-indicator-info"
            title="Open card"
            onClick={async () => {
              await openDocument(t().projectId, t().docId);
              setOpenCardId(t().cardId);
            }}
          >
            <span class="timer-indicator-dot" />
            <span class="timer-indicator-text">
              <strong>{t().cardTitle}</strong>
              <small>{t().docName}</small>
            </span>
            <span class="timer-indicator-clock">{formatClock(now() - t().startedAt)}</span>
          </button>
          <button class="timer-indicator-stop" title="Stop timer" onClick={() => stopTimer()}>
            <IconStop />
          </button>
        </div>
      )}
    </Show>
  );
}
