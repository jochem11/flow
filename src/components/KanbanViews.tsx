// Above a kanban board: the view (board, list, timeline) and the filter. And the
// list view: every card in a table that sorts by any column.

import { createMemo, createSignal, For, Show } from "solid-js";
import { me } from "../lib/auth";
import { allCards, findCard, formatHours, kanban, labelById, labels, setOpenCardId } from "../lib/kanban";
import { filter, setFilter, setView, updateFilter, view, visible, type KanbanView } from "../lib/kanbanView";
import { personById } from "../lib/people";
import { isFiltering, NO_FILTER, PRIORITIES, priorityRank } from "../lib/planning";
import type { KanbanCard, Priority } from "../lib/types";
import { openDoc } from "../lib/workspace";
import { Avatar } from "./AccountMenu";
import { IconKanban, IconList, IconTimeline } from "./icons";
import { LabelContent } from "./KanbanCardDialog";
import { BlockedChip, DueChip, PriorityIcon } from "./Planning";

const VIEWS: { view: KanbanView; label: string; icon: () => any }[] = [
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
    </div>
  );
}

type SortKey = "status" | "title" | "assignees" | "priority" | "due" | "labels" | "time";
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
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
