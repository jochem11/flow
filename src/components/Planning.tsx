// Planning on kanban cards: dates, priority, and what blocks what. The chips on
// the cards and in the list, and the fields in the card dialog.

import { createSignal, For, Show } from "solid-js";
import { allCards, blockersOf, cardById, findCard, isDone, setCardDates, setPriority, toggleBlocker } from "../lib/kanban";
import { isDueSoon, isOverdue, PRIORITIES, shortDay } from "../lib/planning";
import { toast } from "../lib/toast";
import type { KanbanCard, Priority } from "../lib/types";
import { IconBlocked, IconCalendar, IconPriority } from "./icons";
import { Menu } from "./Menu";

const priorityLabel = (p: Priority) => PRIORITIES.find((x) => x.value === p)?.label ?? p;

export function PriorityIcon(p: { priority: Priority }) {
  return (
    <span class={`priority-icon priority-${p.priority}`} title={`Priority: ${priorityLabel(p.priority)}`}>
      <IconPriority level={p.priority} />
    </span>
  );
}

/** The due date: red when overdue, amber when due today or tomorrow, struck through when done. */
export function DueChip(p: { card: KanbanCard }) {
  const done = () => isDone(p.card.id);
  return (
    <Show when={p.card.dueDate}>
      {(due) => (
        <span
          class="badge due-chip"
          classList={{ overdue: isOverdue(p.card, done()), soon: isDueSoon(p.card, done()), done: done() }}
          title={`${p.card.startDate ? `${shortDay(p.card.startDate)} – ` : "Due "}${shortDay(due())}${isOverdue(p.card, done()) ? " (overdue)" : ""}`}
        >
          <IconCalendar /> {shortDay(due())}
        </span>
      )}
    </Show>
  );
}

/** "Blocked" while a card it waits for is not done. */
export function BlockedChip(p: { card: KanbanCard }) {
  const open = () => blockersOf(p.card.id);
  return (
    <Show when={open().length}>
      <span class="badge blocked-chip" title={`Waiting for: ${open().map((c) => c.title).join(", ")}`}>
        <IconBlocked /> Blocked
      </span>
    </Show>
  );
}

/** The card dialog's planning fields: dates, priority, blocked by. */
export function PlanningFields(p: { card: KanbanCard }) {
  return (
    <>
      <div class="kd-field">
        <div class="kd-label">Dates</div>
        <div class="kd-dates">
          <label>
            <span>Start</span>
            <input
              type="date"
              class="kd-input"
              value={p.card.startDate ?? ""}
              onChange={(e) => setCardDates(p.card.id, { startDate: e.currentTarget.value || null })}
            />
          </label>
          <label>
            <span>Due</span>
            <input
              type="date"
              class="kd-input"
              classList={{ overdue: isOverdue(p.card, isDone(p.card.id)) }}
              value={p.card.dueDate ?? ""}
              onChange={(e) => setCardDates(p.card.id, { dueDate: e.currentTarget.value || null })}
            />
          </label>
        </div>
      </div>
      <div class="kd-field">
        <div class="kd-label">Priority</div>
        <select class="kd-select" value={p.card.priority ?? ""} onChange={(e) => setPriority(p.card.id, (e.currentTarget.value || null) as Priority | null)}>
          <option value="">None</option>
          <For each={PRIORITIES}>{(x) => <option value={x.value}>{x.label}</option>}</For>
        </select>
      </div>
      <BlockedBy card={p.card} />
    </>
  );
}

/** The cards that must be done first: a list, and a menu to search and add one. */
function BlockedBy(p: { card: KanbanCard }) {
  const [query, setQuery] = createSignal("");
  const ids = () => p.card.blockedBy ?? [];
  const candidates = () => {
    const q = query().trim().toLowerCase();
    return allCards()
      .filter((c) => c.id !== p.card.id && !ids().includes(c.id) && (!q || c.title.toLowerCase().includes(q)))
      .slice(0, 12);
  };
  return (
    <div class="kd-field">
      <div class="kd-label">
        Blocked by
        <Menu
          align="right"
          button={(toggle) => (
            <button class="kd-link kd-label-action" onClick={toggle}>
              + Add
            </button>
          )}
        >
          {(close) => (
            <>
              <input
                class="kd-input menu-search"
                placeholder="Search cards…"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                ref={(el) => setTimeout(() => el.focus())}
              />
              <For each={candidates()} fallback={<div class="menu-title">No cards</div>}>
                {(c) => (
                  <button
                    class="menu-item"
                    onClick={() => {
                      if (!toggleBlocker(p.card.id, c.id)) toast(`“${c.title}” already waits for this card`, "error");
                      setQuery("");
                      close();
                    }}
                  >
                    <span>{c.title}</span>
                    <small>{findCard(c.id)?.column.title}</small>
                  </button>
                )}
              </For>
            </>
          )}
        </Menu>
      </div>
      <div class="kd-blockers">
        <For each={ids()} fallback={<span class="kd-empty">Nothing</span>}>
          {(id) => (
            <span class="kd-blocker" classList={{ done: isDone(id) }}>
              <IconBlocked />
              <span>{cardById(id)?.title ?? "Deleted card"}</span>
              <button class="kd-assignee-remove" title="Remove" onClick={() => toggleBlocker(p.card.id, id)}>
                ×
              </button>
            </span>
          )}
        </For>
      </div>
    </div>
  );
}
