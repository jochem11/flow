// The backlog of a kanban board, as in Jira: the sprints still to do, each with
// its cards, and under them the backlog (the cards in no sprint). Cards are
// dragged between them and into order. And the dialogs for a sprint: its name
// and dates (also to start it), and completing it.

import { colorClass, tintVars } from "../lib/colors";
import { createSignal, For, Show } from "solid-js";
import { canEdit } from "../lib/access";
import {
  addCard,
  addSprint,
  cardKey,
  cardsIn,
  completeSprint,
  deleteSprint,
  findCard,
  formatHours,
  isDone,
  kanban,
  labelById,
  moveCardToColumn,
  moveSprint,
  planCard,
  plannedSprints,
  setOpenCardId,
  sprintById,
  sprints,
  startSprint,
  updateSprint,
} from "../lib/kanban";
import { filter, setScope, setView, visible } from "../lib/kanbanView";
import { people, personById } from "../lib/people";
import { addDays, daysBetween, isFiltering, shortDay, today } from "../lib/planning";
import { progressOf, sprintDays, stateOf } from "../lib/tickets";
import { toast } from "../lib/toast";
import type { KanbanCard, Sprint } from "../lib/types";
import { openDoc } from "../lib/workspace";
import { Avatar } from "./AccountMenu";
import { ConfirmButton } from "./ConfirmButton";
import { Dialog } from "./Dialog";
import { IconChevron, IconChevronRight, IconClock, IconMore, IconPlus, IconSubtasks, IconTrash } from "./icons";
import { LabelContent } from "./KanbanCardDialog";
import { Menu } from "./Menu";
import { BlockedChip, DueChip, PriorityIcon } from "./Planning";

// ---------- the sprint dialogs (opened from here, the board and the summary) ----------

type SprintDialogKind = "edit" | "start" | "complete";
const [dialog, setDialog] = createSignal<{ kind: SprintDialogKind; id: string } | null>(null);
export const openSprintDialog = (kind: SprintDialogKind, id: string) => setDialog({ kind, id });

/** "Mar 2 – Mar 15", or what there is of it */
export function sprintDates(s: Sprint): string {
  if (s.startDate && s.endDate) return `${shortDay(s.startDate)} – ${shortDay(s.endDate)}`;
  if (s.startDate) return `From ${shortDay(s.startDate)}`;
  if (s.endDate) return `Until ${shortDay(s.endDate)}`;
  return "";
}

/** "5 days left", "Ends today", "3 days over" for a running sprint */
export function sprintLeft(s: Sprint): { text: string; over: boolean } | null {
  if (stateOf(s) !== "active") return null;
  const d = sprintDays(s, today());
  if (!d) return null;
  if (d.left < 0) return { text: `${-d.left} ${d.left === -1 ? "day" : "days"} over`, over: true };
  if (d.left === 0) return { text: "Ends today", over: false };
  return { text: `${d.left} ${d.left === 1 ? "day" : "days"} left`, over: false };
}

export function SprintDialogs() {
  return (
    <Show when={dialog()} keyed>
      {(d) => (
        <Show when={sprintById(d.id)} keyed>
          {(s) => (d.kind === "complete" ? <CompleteDialog sprint={s} onClose={() => setDialog(null)} /> : <SprintDialog sprint={s} start={d.kind === "start"} onClose={() => setDialog(null)} />)}
        </Show>
      )}
    </Show>
  );
}

const WEEKS = [1, 2, 3, 4];

/** A sprint's name, goal and dates; with `start`, saving it starts the sprint. */
function SprintDialog(p: { sprint: Sprint; start: boolean; onClose: () => void }) {
  const from0 = p.sprint.startDate ?? (p.start ? today() : "");
  const [name, setName] = createSignal(p.sprint.name);
  const [goal, setGoal] = createSignal(p.sprint.goal ?? "");
  const [from, setFrom] = createSignal(from0);
  const [to, setTo] = createSignal(p.sprint.endDate ?? (p.start ? addDays(from0, 13) : ""));
  /** Whole weeks, when the dates are that; "none" without dates */
  const weeks = () => {
    if (!from() && !to()) return "none";
    if (!from() || !to()) return "";
    const days = daysBetween(from(), to()) + 1;
    return days > 0 && days % 7 === 0 && WEEKS.includes(days / 7) ? String(days / 7) : "";
  };
  const count = () => cardsIn(p.sprint.id).length;
  const save = (e: Event) => {
    e.preventDefault();
    if (!name().trim()) return;
    updateSprint(p.sprint.id, { name: name(), goal: goal().trim(), startDate: from() || null, endDate: to() || null });
    if (p.start) {
      startSprint(p.sprint.id);
      // On to the board, with the sprint on it
      setScope(p.sprint.id, openDoc()?.id);
      setView("board", openDoc()?.id);
      toast(`${name().trim()} started`);
    }
    p.onClose();
  };
  return (
    <Dialog title={p.start ? "Start sprint" : "Edit sprint"} onClose={p.onClose}>
      <form class="sprint-form" onSubmit={save}>
        <Show when={p.start}>
          <p class="sprint-form-note">
            {count()} {count() === 1 ? "card is" : "cards are"} in this sprint. The board shows them once it has started.
          </p>
        </Show>
        <label>
          <span>Name</span>
          <input class="kd-input" value={name()} onInput={(e) => setName(e.currentTarget.value)} autofocus required />
        </label>
        <label>
          <span>Duration</span>
          <select
            class="kd-select"
            value={weeks()}
            onChange={(e) => {
              if (e.currentTarget.value === "none") {
                setFrom("");
                setTo("");
                return;
              }
              const n = Number(e.currentTarget.value);
              if (!n) return;
              const start = from() || today();
              setFrom(start);
              setTo(addDays(start, n * 7 - 1));
            }}
          >
            <option value="none">No dates</option>
            <option value="">Custom</option>
            <For each={WEEKS}>{(n) => <option value={n}>{n === 1 ? "1 week" : `${n} weeks`}</option>}</For>
          </select>
        </label>
        <div class="sprint-form-dates">
          <label>
            <span>Start (optional)</span>
            <input
              class="kd-input"
              type="date"
              value={from()}
              onChange={(e) => {
                // The same number of days from the new start
                const length = from() && to() ? daysBetween(from(), to()) : null;
                setFrom(e.currentTarget.value);
                if (length !== null && length >= 0 && from()) setTo(addDays(from(), length));
              }}
            />
          </label>
          <label>
            <span>End (optional)</span>
            <input class="kd-input" type="date" value={to()} min={from() || undefined} onChange={(e) => setTo(e.currentTarget.value)} />
          </label>
        </div>
        <label>
          <span>Goal</span>
          <textarea class="kd-input sprint-goal-input" rows={3} value={goal()} placeholder="What should be done when this sprint ends?" onInput={(e) => setGoal(e.currentTarget.value)} />
        </label>
        <div class="sprint-form-actions">
          <button type="button" class="text-btn" onClick={p.onClose}>
            Cancel
          </button>
          <button type="submit" class="text-btn primary" disabled={!name().trim()}>
            {p.start ? "Start sprint" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Completing a sprint: what is done stays with it, the rest goes on to where is picked here. */
function CompleteDialog(p: { sprint: Sprint; onClose: () => void }) {
  const cards = () => cardsIn(p.sprint.id);
  const open = () => cards().filter((c) => !isDone(c.id));
  const others = () => plannedSprints().filter((s) => s.id !== p.sprint.id);
  // As in Jira: on to the next sprint when there is one
  const [moveTo, setMoveTo] = createSignal<string>(others()[0]?.id ?? "backlog");
  const complete = () => {
    const target = moveTo();
    const name = p.sprint.name;
    const where = target === "backlog" ? "the backlog" : target === "new" ? "a new sprint" : (sprintById(target)?.name ?? "the backlog");
    const moved = completeSprint(p.sprint.id, target === "backlog" ? null : target);
    toast(moved ? `${name} completed: ${moved} ${moved === 1 ? "card" : "cards"} moved to ${where}` : `${name} completed`);
    p.onClose();
  };
  return (
    <Dialog title={`Complete ${p.sprint.name}`} onClose={p.onClose}>
      <div class="sprint-form">
        <div class="sprint-complete-counts">
          <div>
            <strong>{cards().length - open().length}</strong>
            <span>done</span>
          </div>
          <div>
            <strong>{open().length}</strong>
            <span>not done</span>
          </div>
        </div>
        <p class="sprint-form-note">The cards that are done stay with the sprint and leave the board. They stay in the list and the summary.</p>
        <Show when={open().length}>
          <label>
            <span>
              Move the {open().length} {open().length === 1 ? "card that is" : "cards that are"} not done to
            </span>
            <select class="kd-select" value={moveTo()} onChange={(e) => setMoveTo(e.currentTarget.value)}>
              <For each={others()}>{(s) => <option value={s.id}>{s.name}</option>}</For>
              <option value="new">A new sprint</option>
              <option value="backlog">The backlog</option>
            </select>
          </label>
        </Show>
        <div class="sprint-form-actions">
          <button class="text-btn" onClick={p.onClose}>
            Cancel
          </button>
          <button class="text-btn primary" onClick={complete}>
            Complete sprint
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- drag and drop ----------
//
// A card lands in a list (a sprint, or the backlog) before the card `before`,
// or (null) at its end.

const BACKLOG = "backlog";
let drag: string | null = null;
const [dragging, setDragging] = createSignal<string | null>(null);
const [dropAt, setDropAt] = createSignal<{ list: string; before: string | null } | null>(null);

function setDrop(list: string, before: string | null) {
  const cur = dropAt();
  if (cur?.list !== list || cur.before !== before) setDropAt({ list, before });
}
function endDrag() {
  drag = null;
  setDragging(null);
  setDropAt(null);
}
function performDrop() {
  const id = drag;
  const at = dropAt();
  endDrag();
  if (!id || !at || !canEdit()) return;
  planCard(id, at.list === BACKLOG ? null : at.list, at.before);
}

// ---------- the view ----------

export function KanbanBacklog() {
  /** The lists that are folded */
  const [folded, setFolded] = createSignal<Set<string>>(new Set());
  const toggle = (id: string) => {
    const next = new Set(folded());
    if (!next.delete(id)) next.add(id);
    setFolded(next);
  };
  return (
    <div class="kanban-backlog" onDragEnd={endDrag}>
      <For each={plannedSprints()}>{(s) => <List sprint={s} folded={folded().has(s.id)} onToggle={() => toggle(s.id)} />}</For>
      <List sprint={null} folded={folded().has(BACKLOG)} onToggle={() => toggle(BACKLOG)} />
    </div>
  );
}

/** A sprint with its cards, or (without a sprint) the backlog. */
function List(p: { sprint: Sprint | null; folded: boolean; onToggle: () => void }) {
  const id = () => p.sprint?.id ?? BACKLOG;
  const all = () => cardsIn(p.sprint?.id ?? null);
  const rows = () => all().filter(visible);
  const progress = () => progressOf(all(), (c) => isDone(c.id));
  const state = () => (p.sprint ? stateOf(p.sprint) : null);
  const left = () => (p.sprint ? sprintLeft(p.sprint) : null);
  const dropHere = () => dropAt()?.list === id();
  /** Where a drop on row `i` lands: before it, or before the next one */
  const beforeOf = (i: number, first: boolean) => (first ? rows()[i].id : (rows()[i + 1]?.id ?? null));
  const open = plannedSprints;
  const place = () => (p.sprint ? open().findIndex((s) => s.id === p.sprint!.id) : -1);

  return (
    <section
      class="backlog-list panel"
      classList={{ active: state() === "active", "drop-end": dropHere() && dropAt()!.before === null && !!drag }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        // Not over a card (those say where themselves): at the end
        setDrop(id(), null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        performDrop();
      }}
    >
      <header class="backlog-head">
        <button class="backlog-fold" title={p.folded ? "Show the cards" : "Hide the cards"} aria-expanded={!p.folded} onClick={p.onToggle}>
          {p.folded ? <IconChevronRight /> : <IconChevron />}
        </button>
        <h3>{p.sprint?.name ?? "Backlog"}</h3>
        <Show when={state() === "active"}>
          <span class="sprint-state active">Active</span>
        </Show>
        <Show
          when={p.sprint && sprintDates(p.sprint)}
          fallback={
            // No dates yet: they are optional, set from here
            <Show when={p.sprint && canEdit()}>
              <button class="kd-link backlog-add-dates" onClick={() => openSprintDialog("edit", p.sprint!.id)}>
                Add dates
              </button>
            </Show>
          }
        >
          <button class="backlog-dates as-button" disabled={!canEdit()} title="Change the dates" onClick={() => openSprintDialog("edit", p.sprint!.id)}>
            {sprintDates(p.sprint!)}
          </button>
        </Show>
        <Show when={left()}>{(l) => <span class="backlog-left" classList={{ over: l().over }}>{l().text}</span>}</Show>
        <span class="backlog-count">
          {isFiltering(filter()) ? `${rows().length} of ${all().length}` : all().length} {all().length === 1 ? "card" : "cards"}
        </span>
        <span class="spacer" />
        <Show when={p.sprint && progress().total}>
          <span class="badge" classList={{ complete: progress().done === progress().total }} title="Cards done">
            {progress().done}/{progress().total} done
          </span>
        </Show>
        <Show when={progress().expected}>
          <span class="badge" title="Hours estimated">
            <IconClock /> {formatHours(progress().expected)}
          </span>
        </Show>
        <Show when={canEdit()}>
          <Show
            when={p.sprint}
            fallback={
              <button class="text-btn small" onClick={() => addSprint()}>
                <IconPlus /> Create sprint
              </button>
            }
          >
            {(s) => (
              <>
                <Show
                  when={state() === "active"}
                  fallback={
                    <button
                      class="text-btn small"
                      classList={{ primary: !sprints().some((x) => stateOf(x) === "active") && place() === 0 }}
                      disabled={!all().length}
                      title={all().length ? "" : "Add cards to the sprint first"}
                      onClick={() => openSprintDialog("start", s().id)}
                    >
                      Start sprint
                    </button>
                  }
                >
                  <button class="text-btn small primary" onClick={() => openSprintDialog("complete", s().id)}>
                    Complete sprint
                  </button>
                </Show>
                <Menu
                  align="right"
                  button={(toggle, isOpen) => (
                    <button class="icon-btn small" classList={{ pressed: isOpen() }} title="Sprint options" onClick={toggle}>
                      <IconMore />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <button
                        class="menu-item"
                        onClick={() => {
                          close();
                          openSprintDialog("edit", s().id);
                        }}
                      >
                        Edit sprint…
                      </button>
                      <button
                        class="menu-item"
                        disabled={place() <= 0}
                        onClick={() => {
                          close();
                          moveSprint(s().id, -1);
                        }}
                      >
                        Move up
                      </button>
                      <button
                        class="menu-item"
                        disabled={place() < 0 || place() >= open().length - 1}
                        onClick={() => {
                          close();
                          moveSprint(s().id, 1);
                        }}
                      >
                        Move down
                      </button>
                      <div class="menu-sep" />
                      <ConfirmButton
                        class="menu-item danger-text"
                        confirmLabel={all().length ? `Delete? ${all().length} ${all().length === 1 ? "card goes" : "cards go"} to the backlog` : "Delete?"}
                        onConfirm={() => {
                          close();
                          deleteSprint(s().id);
                        }}
                      >
                        <span class="with-icon">
                          <IconTrash /> Delete sprint
                        </span>
                      </ConfirmButton>
                    </>
                  )}
                </Menu>
              </>
            )}
          </Show>
        </Show>
      </header>
      <Show when={p.sprint?.goal && !p.folded}>
        <p class="backlog-goal">{p.sprint!.goal}</p>
      </Show>
      <Show when={!p.folded}>
        <div class="backlog-rows">
          <For
            each={rows()}
            fallback={
              <div class="backlog-empty">
                {all().length
                  ? "No cards here pass the filter."
                  : p.sprint
                    ? "Plan this sprint: drag cards here from the backlog, or create one below."
                    : sprints().length
                      ? "The backlog is empty."
                      : "Every card of the board is listed here. Create a sprint to plan the work in."}
              </div>
            }
          >
            {(card, i) => (
              <Row
                card={card}
                dropBefore={dropHere() && dropAt()!.before === card.id}
                onOver={(first) => setDrop(id(), beforeOf(i(), first))}
              />
            )}
          </For>
        </div>
        <Show when={canEdit() && kanban.columns.length}>
          <Composer sprintId={p.sprint?.id ?? null} />
        </Show>
      </Show>
    </section>
  );
}

function Row(p: { card: KanbanCard; dropBefore: boolean; onOver: (firstHalf: boolean) => void }) {
  const column = () => findCard(p.card.id)?.column;
  const done = () => !!column()?.done;
  const cardLabels = () => (p.card.labelIds ?? []).map(labelById).filter((l) => l !== undefined);
  return (
    <div
      class="backlog-row"
      classList={{ done: done(), "drop-before": p.dropBefore, dragging: dragging() === p.card.id }}
      tabIndex={0}
      draggable={canEdit()}
      onClick={() => setOpenCardId(p.card.id)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && setOpenCardId(p.card.id)}
      onDragStart={(e) => {
        drag = p.card.id;
        setDragging(p.card.id);
        e.dataTransfer?.setData("text/plain", `${cardKey(p.card)} ${p.card.title}`.trim());
      }}
      onDragOver={(e) => {
        if (!drag) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        p.onOver(e.clientY < r.top + r.height / 2);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        performDrop();
      }}
    >
      <span class="ticket-key">{cardKey(p.card)}</span>
      <span class="backlog-title">
        <Show when={p.card.parentId}>
          <span class="backlog-sub" title="Subtask">
            <IconSubtasks />
          </span>
        </Show>
        <Show when={p.card.priority}>{(pr) => <PriorityIcon priority={pr()} />}</Show>
        <span class="backlog-title-text">{p.card.title}</span>
        <For each={cardLabels()}>
          {(l) => (
            <span class={`label-chip small ${colorClass(l!.color, l!.tint)}`} style={tintVars(l!.tint)}>
              <LabelContent label={l!} />
            </span>
          )}
        </For>
        <BlockedChip card={p.card} />
      </span>
      <DueChip card={p.card} />
      <Show when={p.card.expectedHours != null}>
        <span class="badge" title="Hours estimated">
          {formatHours(p.card.expectedHours!)}
        </span>
      </Show>
      <Show when={people().length && p.card.assigneeIds?.length}>
        <span class="kanban-card-assignees" title={(p.card.assigneeIds ?? []).map((id) => personById(id)?.name ?? "Former member").join(", ")}>
          <For each={(p.card.assigneeIds ?? []).slice(0, 3)}>{(id) => <Avatar name={personById(id)?.name ?? "?"} url={personById(id)?.avatarUrl} size={20} />}</For>
        </span>
      </Show>
      <select
        class={`backlog-status ${colorClass(column()?.color, column()?.tint)}`} style={tintVars(column()?.tint)}
        title="Status"
        aria-label="Status"
        value={column()?.id}
        disabled={!canEdit()}
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => moveCardToColumn(p.card.id, e.currentTarget.value)}
      >
        <For each={kanban.columns}>{(c) => <option value={c.id}>{c.title}</option>}</For>
      </select>
    </div>
  );
}

/** "+ Create card" under a list: Enter adds one there, and stays for the next. */
function Composer(p: { sprintId: string | null }) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show
      when={open()}
      fallback={
        <button class="backlog-add" onClick={() => setOpen(true)}>
          <IconPlus /> Create card
        </button>
      }
    >
      <input
        class="kd-input backlog-add-input"
        placeholder="What needs to be done? Enter to add, Esc to close"
        ref={(el) => queueMicrotask(() => el.focus())}
        onKeyDown={(e) => {
          if (e.key === "Enter" && addCard(kanban.columns[0].id, e.currentTarget.value, undefined, p.sprintId)) e.currentTarget.value = "";
          if (e.key === "Escape") {
            e.currentTarget.value = "";
            setOpen(false);
          }
        }}
        onBlur={(e) => {
          addCard(kanban.columns[0].id, e.currentTarget.value, undefined, p.sprintId);
          setOpen(false);
        }}
      />
    </Show>
  );
}
