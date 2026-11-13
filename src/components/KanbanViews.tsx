// Above a kanban board: the view (summary, backlog, board, list, timeline), the
// sprint the board shows, and the filter. And the list view: every card in a
// table that sorts by any column.

import { createMemo, createSignal, For, Show } from "solid-js";
import { me } from "../lib/auth";
import { canEdit } from "../lib/access";
import { allCards, boardKey, cardKey, findCard, formatHours, isArchived, kanban, labelById, labels, plannedSprints, setBoardKey, setOpenCardId, sprintById, sprintOf, sprints } from "../lib/kanban";
import { filter, scope, setFilter, setScope, setView, updateFilter, view, visible, type KanbanView } from "../lib/kanbanView";
import { stateOf } from "../lib/tickets";
import { toast } from "../lib/toast";
import { openSprintDialog, sprintDates, sprintLeft } from "./KanbanBacklog";
import { personById } from "../lib/people";
import { isFiltering, NO_FILTER, PRIORITIES, priorityRank } from "../lib/planning";
import type { KanbanCard, Priority } from "../lib/types";
import { openDoc } from "../lib/workspace";
import { Avatar } from "./AccountMenu";
import { IconBacklog, IconKanban, IconList, IconSummary, IconTimeline } from "./icons";
import { LabelContent } from "./KanbanCardDialog";
import { BlockedChip, DueChip, PriorityIcon } from "./Planning";

const VIEWS: { view: KanbanView; label: string; icon: () => any }[] = [
  { view: "summary", label: "Summary", icon: IconSummary },
  { view: "backlog", label: "Backlog", icon: IconBacklog },
  { view: "board", label: "Board", icon: IconKanban },
  { view: "list", label: "List", icon: IconList },
  { view: "timeline", label: "Timeline", icon: IconTimeline },
];

export function KanbanToolbar() {
  const shown = () => allCards().filter(visible).length;
  return (
    <div class="kanban-toolbar">
      <div class="segmented">
        <For each={VIEWS}>
          {(v) => (
            <button classList={{ active: view() === v.view }} onClick={() => setView(v.view, openDoc()?.id)}>
              {v.icon()}
              {v.label}
            </button>
          )}
        </For>
      </div>
      <Show when={view() === "board"}>
        <SprintScope />
      </Show>
      {/* The summary is about every card */}
      <Show when={view() !== "summary"}>
      <input
        class="kanban-search"
        type="search"
        placeholder="Filter cards…"
        value={filter().text}
        onInput={(e) => updateFilter({ text: e.currentTarget.value })}
      />
      <Show when={me()}>
        <button class="chip-toggle" classList={{ on: !!filter().mine }} onClick={() => updateFilter({ mine: filter().mine ? null : me()!.user.id })}>
          Mine
        </button>
      </Show>
      <Show when={labels().length}>
        <select class="kanban-filter-select" value={filter().labelId ?? ""} onChange={(e) => updateFilter({ labelId: e.currentTarget.value || null })}>
          <option value="">Any label</option>
          <For each={labels()}>{(l) => <option value={l.id}>{l.name}</option>}</For>
        </select>
      </Show>
      <select
        class="kanban-filter-select"
        value={filter().priority ?? ""}
        onChange={(e) => updateFilter({ priority: (e.currentTarget.value || null) as Priority | null })}
      >
        <option value="">Any priority</option>
        <For each={PRIORITIES}>{(x) => <option value={x.value}>{x.label}</option>}</For>
      </select>
      <button class="chip-toggle" classList={{ on: filter().overdue }} onClick={() => updateFilter({ overdue: !filter().overdue })}>
        Overdue
      </button>
      <Show when={isFiltering(filter())}>
        <span class="kanban-filter-count">
          {shown()} of {allCards().length}
        </span>
        <button class="kd-link" onClick={() => setFilter(NO_FILTER)}>
          Clear
        </button>
      </Show>
      </Show>
      <span class="spacer" />
      <TicketKey />
    </div>
  );
}

/** Which cards the board shows: a sprint, the backlog, or everything. With what is left of a running sprint. */
function SprintScope() {
  const sprint = () => sprintById(scope());
  const left = () => (sprint() ? sprintLeft(sprint()!) : null);
  return (
    <Show when={sprints().length}>
      <select class="kanban-filter-select sprint-scope" title="What the board shows" aria-label="What the board shows" value={scope()} onChange={(e) => setScope(e.currentTarget.value, openDoc()?.id)}>
        <For each={plannedSprints()}>{(s) => <option value={s.id}>{stateOf(s) === "active" ? `${s.name} (active)` : s.name}</option>}</For>
        <option value="backlog">Backlog</option>
        <option value="all">All cards</option>
      </select>
      <Show when={sprint()}>
        {(s) => (
          <>
            <Show when={sprintDates(s())}>
              <span class="backlog-dates" title={s().goal || undefined}>
                {sprintDates(s())}
              </span>
            </Show>
            <Show when={left()}>{(l) => <span class="backlog-left" classList={{ over: l().over }}>{l().text}</span>}</Show>
            <Show when={canEdit()}>
              <Show
                when={stateOf(s()) === "active"}
                fallback={
                  <button class="text-btn small" onClick={() => openSprintDialog("start", s().id)}>
                    Start sprint
                  </button>
                }
              >
                <button class="text-btn small" onClick={() => openSprintDialog("complete", s().id)}>
                  Complete sprint
                </button>
              </Show>
            </Show>
          </>
        )}
      </Show>
    </Show>
  );
}

/** The key the ticket ids start with (`WEB` in `WEB-12`); click to change it. */
function TicketKey() {
  const [editing, setEditing] = createSignal(false);
  const commit = (value: string) => {
    setEditing(false);
    if (value.trim() && !setBoardKey(value)) toast("A key is 2 to 6 letters or digits, starting with a letter", "error");
  };
  return (
    <Show when={kanban.key}>
      <Show
        when={editing()}
        fallback={
          <button class="ticket-key-btn" disabled={!canEdit()} title="The key every ticket id starts with. Click to change it" onClick={() => setEditing(true)}>
            Key <strong>{boardKey()}</strong>
          </button>
        }
      >
        <input
          class="kanban-search ticket-key-input"
          aria-label="Ticket key"
          value={boardKey()}
          maxLength={6}
          ref={(el) =>
            queueMicrotask(() => {
              el.focus();
              el.select();
            })
          }
          onInput={(e) => (e.currentTarget.value = e.currentTarget.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = "";
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => commit(e.currentTarget.value)}
        />
      </Show>
    </Show>
  );
}

type SortKey = "id" | "status" | "sprint" | "title" | "assignees" | "priority" | "due" | "labels" | "time";
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "sprint", label: "Sprint" },
  { key: "assignees", label: "Assigned to" },
  { key: "priority", label: "Priority" },
  { key: "due", label: "Due" },
  { key: "labels", label: "Labels" },
  { key: "time", label: "Time" },
];

/** Every card that passes the filter, in a table; click a heading to sort by it. */
export function KanbanList() {
  const [sort, setSort] = createSignal<{ key: SortKey; desc: boolean }>({ key: "status", desc: false });
  // Board order: by column, then as the cards are in it
  const order = createMemo(() => new Map(kanban.columns.flatMap((c, ci) => c.cards.map((card, i) => [card.id, ci * 10_000 + i] as const))));
  const value = (c: KanbanCard, key: SortKey): string | number => {
    switch (key) {
      case "id":
        return c.number ?? Number.MAX_SAFE_INTEGER;
      case "sprint": {
        // As they are planned; the backlog after them, the completed ones last
        const s = sprintOf(c);
        if (!s) return 1e6;
        return (stateOf(s) === "done" ? 2e6 : 0) + sprints().indexOf(s);
      }
      case "status":
        return order().get(c.id) ?? 0;
      case "title":
        return c.title.toLowerCase();
      case "assignees":
        return (c.assigneeIds ?? []).map((id) => personById(id)?.name ?? "").join(", ").toLowerCase() || "￿";
      case "priority":
        return priorityRank(c.priority);
      case "due":
        return c.dueDate ?? "9999";
      case "labels":
        return (c.labelIds ?? []).map((id) => labelById(id)?.name ?? "").join(", ").toLowerCase() || "￿";
      case "time":
        return c.spentHours ?? 0;
    }
  };
  const rows = createMemo(() => {
    const { key, desc } = sort();
    const list = allCards().filter(visible);
    list.sort((a, b) => {
      const x = value(a, key);
      const y = value(b, key);
      const d = x < y ? -1 : x > y ? 1 : (order().get(a.id) ?? 0) - (order().get(b.id) ?? 0);
      return desc ? -d : d;
    });
    return list;
  });
  return (
    <div class="kanban-list">
      <table>
        <thead>
          <tr>
            <For each={COLUMNS}>
              {(col) => (
                <th
                  classList={{ sorted: sort().key === col.key }}
                  onClick={() => setSort({ key: col.key, desc: sort().key === col.key ? !sort().desc : false })}
                >
                  {col.label}
                  <Show when={sort().key === col.key}>{sort().desc ? " ↓" : " ↑"}</Show>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={rows()} fallback={<tr><td class="kanban-list-empty" colSpan={COLUMNS.length}>No cards</td></tr>}>
            {(c) => {
              const col = () => findCard(c.id)?.column;
              return (
                <tr onClick={() => setOpenCardId(c.id)} classList={{ done: !!col()?.done }}>
                  <td>
                    <span class="ticket-key">{cardKey(c)}</span>
                  </td>
                  <td class="kanban-list-title">
                    <Show when={c.parentId}>
                      <span class="kanban-list-sub">↳ </span>
                    </Show>
                    {c.title}
                    <BlockedChip card={c} />
                  </td>
                  <td>
                    <span class={`kanban-list-status ${col()?.color ? `color-${col()!.color}` : ""}`}>{col()?.title}</span>
                  </td>
                  <td class="kanban-list-sprint" classList={{ archived: isArchived(c) }}>
                    {sprintOf(c)?.name ?? ""}
                  </td>
                  <td>
                    <span class="kanban-card-assignees">
                      <For each={c.assigneeIds ?? []}>
                        {(id) => <Avatar name={personById(id)?.name ?? "?"} url={personById(id)?.avatarUrl} size={20} />}
                      </For>
                    </span>
                  </td>
                  <td>
                    <Show when={c.priority}>
                      {(p) => (
                        <span class="kanban-list-priority">
                          <PriorityIcon priority={p()} />
                          {PRIORITIES.find((x) => x.value === p())?.label}
                        </span>
                      )}
                    </Show>
                  </td>
                  <td>
                    <DueChip card={c} />
                  </td>
                  <td>
                    <For each={(c.labelIds ?? []).map(labelById).filter((l) => !!l)}>
                      {(l) => (
                        <span class={`label-chip small color-${l!.color}`}>
                          <LabelContent label={l!} />
                        </span>
                      )}
                    </For>
                  </td>
                  <td class="kanban-list-time">
                    <Show when={c.spentHours || c.expectedHours}>
                      {formatHours(c.spentHours ?? 0)}
                      <Show when={c.expectedHours}> / {formatHours(c.expectedHours!)}</Show>
                    </Show>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
}
