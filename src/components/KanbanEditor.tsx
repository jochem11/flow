// Kanban editor: columns with cards. Cards and columns can be dragged around;
// clicking a card opens it in a dialog (KanbanCardDialog.tsx).

import { colorClass, tintVars } from "../lib/colors";
import { ColorPicker } from "./ColorPicker";
import { personById } from "../lib/people";
import { Avatar } from "./AccountMenu";
import { threadsOn } from "../lib/comments";
import { canEdit } from "../lib/access";
import { createEffect, createSignal, For, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { filter, loadView, onBoard, scopeSprint, setFilter, view, visible } from "../lib/kanbanView";
import { isFiltering, NO_FILTER } from "../lib/planning";
import { KanbanList, KanbanToolbar } from "./KanbanViews";
import { KanbanTimeline } from "./KanbanTimeline";
import { KanbanBacklog, SprintDialogs } from "./KanbanBacklog";
import { KanbanSummary } from "./KanbanSummary";
import {
  addCard,
  addColumn,
  addDefaultColumns,
  cardById,
  cardKey,
  ensureTickets,
  needsTickets,
  DEFAULT_COLUMNS,
  deleteColumn,
  formatHours,
  formatClock,
  kanban,
  kanbanRev,
  labelById,
  moveCard,
  moveColumn,
  openCardId,
  renameColumn,
  setColumnDone,
  setColumnStyle,
  setOpenCardId,
  subtaskProgress,
  taskProgress,
} from "../lib/kanban";
import { activeTimer, now, startTimer, stopTimer, syncTimerWithBoard } from "../lib/timer";
import type { KanbanCard, KanbanColumn } from "../lib/types";
import { openDoc, versionMark } from "../lib/workspace";
import { ConfirmButton } from "./ConfirmButton";
import {
  IconCheck,
  IconChecklist,
  IconClock,
  IconComment,
  IconFlow,
  IconKanban,
  IconMore,
  IconPlay,
  IconPlus,
  IconStop,
  IconSubtasks,
  IconTrash,
  KANBAN_ICONS,
} from "./icons";
import { CardDialog, IconPicker, LabelContent } from "./KanbanCardDialog";
import { BlockedChip, DueChip, PriorityIcon } from "./Planning";
import { Menu } from "./Menu";


// ---------- editor UI state ----------

/** Column whose title is being edited. */
const [renamingColumn, setRenamingColumn] = createSignal<string | null>(null);
/** Column with the "new card" composer open. */
const [composing, setComposing] = createSignal<string | null>(null);

// ---------- drag and drop ----------
//
// Dropping is index-based: a card lands *before* the card at `index` in a
// column (`index === cards.length` = at the bottom); same for columns. The
// indicator is drawn with pseudo-elements so it never shifts the layout.

type Drag = { type: "card" | "column"; id: string };
type DropAt = { type: "card"; column: string; index: number } | { type: "column"; index: number };

let drag: Drag | null = null;
const [dragging, setDragging] = createSignal<string | null>(null);
const [dropAt, setDropAt] = createSignal<DropAt | null>(null);

function setDrop(d: DropAt) {
  const cur = dropAt();
  const same =
    cur?.type === d.type && cur.index === d.index && (cur.type === "column" || cur.column === (d as typeof cur).column);
  if (!same) setDropAt(d);
}

function endDrag() {
  drag = null;
  setDragging(null);
  setDropAt(null);
}

function performDrop() {
  const d = drag;
  const at = dropAt();
  endDrag();
  if (!d || !at || !canEdit()) return;
  if (d.type === "card" && at.type === "card") moveCard(d.id, at.column, at.index);
  if (d.type === "column" && at.type === "column") moveColumn(d.id, at.index);
}

/** Is `e` in the first half of its target (top half, or left half with `horizontal`)? */
function firstHalf(e: DragEvent, horizontal = false): boolean {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
}

/** Where the indicator for a drop at `index` is drawn: before item `index`, or after the last item. */
function indicator(index: number, i: number, count: number): "before" | "after" | null {
  if (index === i) return "before";
  if (index === count && i === count - 1) return "after";
  return null;
}

// ---------- components ----------

export function KanbanEditor() {
  // Escape first leaves a focused field inside the dialog, then closes the dialog.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !openCardId()) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest(".kanban-dialog") && active.matches("input:not([type=checkbox]), textarea, select, [contenteditable=true]")) active.blur();
    else setOpenCardId(null);
  };
  onMount(() => window.addEventListener("keydown", onKey));
  // Keep the sidebar timer in sync with the board (picked up on open, cleared when stopped or deleted).
  createEffect(on([() => openDoc()?.id, kanbanRev], syncTimerWithBoard));
  onCleanup(() => {
    window.removeEventListener("keydown", onKey);
    setOpenCardId(null);
    setComposing(null);
    setRenamingColumn(null);
  });

  // A board from before ticket ids, or a card that came without one: numbered
  // now, by whoever may change the board (not while looking at an old version)
  createEffect(() => {
    const doc = openDoc();
    if (doc?.kind !== "kanban" || !canEdit() || !needsTickets()) return;
    queueMicrotask(() => openDoc()?.id === doc.id && canEdit() && ensureTickets(doc.name));
  });

  // Another board: its own view (remembered per board), and no filter
  createEffect(
    on(
      () => openDoc()?.id,
      (id) => {
        if (id) loadView(id);
        setFilter(NO_FILTER);
      },
    ),
  );

  return (
    <div class="kanban">
      <Show when={kanban.columns.length} fallback={<EmptyBoard />}>
        <KanbanToolbar />
        <Switch>
          <Match when={view() === "summary"}>
            <KanbanSummary />
          </Match>
          <Match when={view() === "backlog"}>
            <KanbanBacklog />
          </Match>
          <Match when={view() === "list"}>
            <KanbanList />
          </Match>
          <Match when={view() === "timeline"}>
            <KanbanTimeline />
          </Match>
          <Match when={view() === "board"}>
            <div class="kanban-board" onDragEnd={endDrag}>
              <For each={kanban.columns}>{(col, i) => <Column column={col} index={i()} />}</For>
              <Show when={canEdit()}>
                <button class="kanban-add-column" onClick={() => setRenamingColumn(addColumn())}>
                  <IconPlus /> Add column
                </button>
              </Show>
            </div>
          </Match>
        </Switch>
      </Show>
      <Show when={openCardId()}>
        {(id) => <CardDialog cardId={id()} onOpen={setOpenCardId} onClose={() => setOpenCardId(null)} />}
      </Show>
      <SprintDialogs />
    </div>
  );
}

function EmptyBoard() {
  return (
    <div class="kanban-empty">
      <div class="kanban-empty-card panel">
        <IconKanban />
        <h2>This board has no columns yet</h2>
        <p>Start with the usual three, or add your own.</p>
        <div class="kanban-empty-actions" hidden={!canEdit()}>
          <button class="text-btn primary" onClick={addDefaultColumns}>
            {DEFAULT_COLUMNS.join(" · ")}
          </button>
          <button class="text-btn" onClick={() => setRenamingColumn(addColumn())}>
            Empty column
          </button>
        </div>
      </div>
    </div>
  );
}

function Column(p: { column: KanbanColumn; index: number }) {
  let el!: HTMLDivElement;
  const id = () => p.column.id;
  const colIndicator = () => {
    const at = dropAt();
    return at?.type === "column" ? indicator(at.index, p.index, kanban.columns.length) : null;
  };
  const cardDropIndex = () => {
    const at = dropAt();
    return at?.type === "card" && at.column === id() ? at.index : null;
  };
  // The cards the board shows now: of the sprint that is picked, never of a completed one
  const shown = () => p.column.cards.filter(onBoard);
  const hours = () => {
    let expected = 0;
    let spent = 0;
    for (const c of shown()) {
      expected += c.expectedHours ?? 0;
      spent += c.spentHours ?? 0;
    }
    return { expected, spent };
  };

  return (
    <div
      ref={el}
      class={`kanban-column ${colorClass(p.column.color, p.column.tint)}`}
      style={tintVars(p.column.tint)}
      classList={{
        colored: !!colorClass(p.column.color, p.column.tint),
        "drop-before": colIndicator() === "before",
        "drop-after": colIndicator() === "after",
        dragging: dragging() === id(),
        "drop-empty": cardDropIndex() !== null && shown().length === 0,
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        if (drag.type === "column") {
          setDrop({ type: "column", index: firstHalf(e, true) ? p.index : p.index + 1 });
        } else {
          // Not over a card (those handle it themselves): drop at the bottom.
          setDrop({ type: "card", column: id(), index: p.column.cards.length });
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        performDrop();
      }}
    >
      <header
        class="kanban-column-head"
        draggable={canEdit() && renamingColumn() !== id()}
        onDragStart={(e) => {
          drag = { type: "column", id: id() };
          setDragging(id());
          e.dataTransfer?.setData("text/plain", p.column.title);
          e.dataTransfer?.setDragImage(el, 20, 20);
        }}
      >
        <Show when={p.column.icon}>{(icon) => <span class="kanban-column-icon">{KANBAN_ICONS[icon()].icon()}</span>}</Show>
        <Show
          when={renamingColumn() === id()}
          fallback={
            <button class="kanban-column-title" title="Rename" disabled={!canEdit()} onClick={() => setRenamingColumn(id())}>
              {p.column.title}
            </button>
          }
        >
          <InlineInput
            value={p.column.title}
            class="kanban-column-input"
            onDone={(v) => {
              setRenamingColumn(null);
              if (v !== null) renameColumn(id(), v);
            }}
          />
        </Show>
        <span class="kanban-count">
          {isFiltering(filter()) ? `${shown().filter(visible).length}/${shown().length}` : shown().length}
        </span>
        <Show when={p.column.done}>
          <span class="kanban-done-mark" title="Cards in this column count as done">
            <IconCheck />
          </span>
        </Show>
        <Show when={hours().expected || hours().spent}>
          <span class="kanban-hours" title={hours().expected ? "Completed / estimated hours" : "Completed hours"}>
            {formatHours(hours().spent)}
            <Show when={hours().expected}> / {formatHours(hours().expected)}</Show>
          </span>
        </Show>
        <span class="kanban-column-actions">
          <Show when={canEdit()}>
            <button class="icon-btn small" title="Add card" onClick={() => setComposing(id())}>
              <IconPlus />
            </button>
            <ColumnMenu column={p.column} />
          </Show>
        </span>
      </header>

      <div class="kanban-cards">
        <For each={p.column.cards}>
          {(card, i) => (
            // Filtered out: not shown, but the others keep their place for dragging
            <Show when={onBoard(card) && visible(card)}>
              <Card
                card={card}
                columnId={id()}
                index={i()}
                indicator={cardDropIndex() === null ? null : indicator(cardDropIndex()!, i(), p.column.cards.length)}
              />
            </Show>
          )}
        </For>
        <Show
          when={composing() === id()}
          fallback={
            // Only for those who may change the board (not when viewing it, or an old version of it)
            <Show when={canEdit()}>
              <button class="kanban-add-card" onClick={() => setComposing(id())}>
                <IconPlus /> Add card
              </button>
            </Show>
          }
        >
          <Show when={canEdit()}>
            <CardComposer columnId={id()} />
          </Show>
        </Show>
      </div>
    </div>
  );
}

function ColumnMenu(p: { column: KanbanColumn }) {
  return (
    <Menu
      align="right"
      button={(toggle, open) => (
        <button class="icon-btn small" classList={{ pressed: open() }} title="Column options" onClick={toggle}>
          <IconMore />
        </button>
      )}
    >
      {(close) => (
        <div class="kanban-column-menu">
          <div class="kd-label">Color</div>
          <div class="kd-swatches">
            <ColorPicker none color={p.column.color} tint={p.column.tint} onPick={(c) => setColumnStyle(p.column.id, c)} />
          </div>
          <div class="kd-label">Icon</div>
          <IconPicker value={p.column.icon ?? null} onChange={(icon) => setColumnStyle(p.column.id, { icon })} />
          <div class="menu-sep" />
          <label class="kanban-menu-toggle">
            <input
              type="checkbox"
              checked={p.column.done ?? false}
              onChange={(e) => setColumnDone(p.column.id, e.currentTarget.checked)}
            />
            <span>
              Cards here count as done
              <small>Used for subtask progress</small>
            </span>
          </label>
          <div class="menu-sep" />
          <ConfirmButton
            class="menu-item danger-text"
            confirmLabel={p.column.cards.length ? `Delete with ${p.column.cards.length} cards?` : "Delete?"}
            onConfirm={() => {
              close();
              deleteColumn(p.column.id);
            }}
          >
            <span class="with-icon">
              <IconTrash /> Delete column
            </span>
          </ConfirmButton>
        </div>
      )}
    </Menu>
  );
}

function Card(p: { card: KanbanCard; columnId: string; index: number; indicator: "before" | "after" | null }) {
  const parent = () => (p.card.parentId ? cardById(p.card.parentId) : undefined);
  const cardLabels = () => (p.card.labelIds ?? []).map(labelById).filter((l) => l !== undefined);
  const subtasks = () => subtaskProgress(p.card.id);
  const checklist = () => taskProgress(p.card.description);
  // The card's own discussion, and comment threads on it
  const comments = () => (p.card.comments?.length ?? 0) + threadsOn("card", p.card.id).length;
  const hasHours = () => p.card.expectedHours != null || p.card.spentHours != null;
  const overEstimate = () =>
    p.card.expectedHours != null && (p.card.spentHours ?? 0) > p.card.expectedHours;
  const snippet = () =>
    p.card.description
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links: keep the text, drop the url
      .replace(/^\s*[-*+] \[[ xX]\]\s*/gm, "") // task markers
      .replace(/[#>*_`~\[\]()-]/g, "") // rough markdown cleanup for a plain-text preview
      .replace(/\s+/g, " ")
      .trim();

  return (
    <div
      class="kanban-card"
      classList={{
        "version-gone": versionMark(p.card.id) === "gone",
        "version-changed": versionMark(p.card.id) === "changed",
        "drop-before": p.indicator === "before",
        "drop-after": p.indicator === "after",
        dragging: dragging() === p.card.id,
      }}
      tabIndex={0}
      draggable={canEdit()}
      onClick={() => setOpenCardId(p.card.id)}
      onKeyDown={(e) => e.key === "Enter" && setOpenCardId(p.card.id)}
      onDragStart={(e) => {
        e.stopPropagation();
        drag = { type: "card", id: p.card.id };
        setDragging(p.card.id);
        e.dataTransfer?.setData("text/plain", p.card.title);
      }}
      onDragOver={(e) => {
        if (drag?.type !== "card") return;
        e.preventDefault();
        e.stopPropagation();
        setDrop({ type: "card", column: p.columnId, index: firstHalf(e) ? p.index : p.index + 1 });
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        performDrop();
      }}
    >
      <Show when={cardLabels().length}>
        <div class="kanban-card-labels">
          <For each={cardLabels()}>
            {(l) => (
              <span class={`label-chip small ${colorClass(l!.color, l!.tint)}`} style={tintVars(l!.tint)}>
                <LabelContent label={l!} />
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={parent()}>
        {(par) => (
          <div class="kanban-card-parent">
            <IconSubtasks /> {par().title}
          </div>
        )}
      </Show>
      <div class="kanban-card-title">
        <Show when={p.card.priority}>{(pr) => <PriorityIcon priority={pr()} />}</Show>
        {p.card.title}
      </div>
      <Show when={canEdit()}>
        <TimerButton cardId={p.card.id} />
      </Show>
      <Show when={snippet()}>
        <div class="kanban-card-snippet">{snippet()}</div>
      </Show>
      <Show
        when={
          subtasks().total ||
          checklist().total ||
          comments() ||
          hasHours() ||
          p.card.links?.length ||
          p.card.assigneeIds?.length ||
          p.card.dueDate ||
          p.card.blockedBy?.length ||
          p.card.number != null
        }
      >
        <div class="kanban-card-badges">
          <Show when={cardKey(p.card)}>
            <span class="ticket-key">{cardKey(p.card)}</span>
          </Show>
          <BlockedChip card={p.card} />
          <DueChip card={p.card} />
          <Show when={subtasks().total}>
            <span class="badge" classList={{ complete: subtasks().done === subtasks().total }} title="Subtasks done">
              <IconSubtasks /> {subtasks().done}/{subtasks().total}
            </span>
          </Show>
          <Show when={checklist().total}>
            <span class="badge" classList={{ complete: checklist().done === checklist().total }} title="Checklist">
              <IconChecklist /> {checklist().done}/{checklist().total}
            </span>
          </Show>
          <Show when={hasHours()}>
            <span class="badge" classList={{ over: overEstimate() }} title="Completed / estimated hours">
              <IconClock /> {formatHours(p.card.spentHours ?? 0)}
              <Show when={p.card.expectedHours != null}> / {formatHours(p.card.expectedHours!)}</Show>
            </span>
          </Show>
          <Show when={comments()}>
            <span class="badge" title="Comments">
              <IconComment /> {comments()}
            </span>
          </Show>
          <Show when={p.card.links?.length}>
            <span class="badge" title="Linked flowchart blocks">
              <IconFlow /> {p.card.links!.length}
            </span>
          </Show>
          {/* Who works on it */}
          <Show when={p.card.assigneeIds?.length}>
            <span class="kanban-card-assignees" title={(p.card.assigneeIds ?? []).map((id) => personById(id)?.name ?? "Former member").join(", ")}>
              <For each={(p.card.assigneeIds ?? []).slice(0, 3)}>
                {(id) => <Avatar name={personById(id)?.name ?? "?"} url={personById(id)?.avatarUrl} size={20} />}
              </For>
              <Show when={(p.card.assigneeIds ?? []).length > 3}>
                <span class="kanban-card-more">+{(p.card.assigneeIds ?? []).length - 3}</span>
              </Show>
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * Start/stop button on a card. Hidden until hover, unless the timer runs on
 * this card: then it shows the running time.
 */
function TimerButton(p: { cardId: string }) {
  const running = () => activeTimer()?.cardId === p.cardId;
  return (
    <button
      class="kanban-timer"
      classList={{ running: running() }}
      title={running() ? "Stop timer" : "Start timer"}
      draggable={false}
      onClick={(e) => {
        e.stopPropagation();
        running() ? stopTimer() : startTimer(p.cardId);
      }}
    >
      <Show when={running()} fallback={<IconPlay />}>
        <IconStop /> {formatClock(now() - activeTimer()!.startedAt)}
      </Show>
    </button>
  );
}

/** Textarea at the bottom of a column for adding cards. Enter adds and stays open for the next one. */
function CardComposer(p: { columnId: string }) {
  let ref!: HTMLTextAreaElement;
  let cancelled = false;
  onMount(() => ref.focus());
  const submit = () => {
    addCard(p.columnId, ref.value, undefined, scopeSprint());
    ref.value = "";
    ref.focus();
  };
  return (
    <div class="kanban-composer">
      <textarea
        ref={ref}
        class="kanban-composer-input"
        rows={2}
        placeholder="Card title…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            cancelled = true;
            setComposing(null);
          }
        }}
        onBlur={() => {
          // Keep what was typed when clicking elsewhere (but not after Escape).
          if (!cancelled && ref.value.trim()) addCard(p.columnId, ref.value, undefined, scopeSprint());
          setComposing(null);
        }}
      />
      <div class="kanban-composer-actions">
        <button class="text-btn primary small" onMouseDown={(e) => e.preventDefault()} onClick={submit}>
          Add
        </button>
        <span class="hint">Enter to add · Esc to close</span>
      </div>
    </div>
  );
}

/** Single-line input that commits on Enter or blur, and cancels on Escape (`null`). */
function InlineInput(p: { value: string; class?: string; onDone: (value: string | null) => void }) {
  let ref!: HTMLInputElement;
  let finished = false;
  const finish = (v: string | null) => {
    if (finished) return;
    finished = true;
    p.onDone(v);
  };
  onMount(() => {
    ref.focus();
    ref.select();
  });
  return (
    <input
      ref={ref}
      class={p.class}
      value={p.value}
      onBlur={() => finish(ref.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(ref.value);
        if (e.key === "Escape") finish(null);
      }}
    />
  );
}
