// The card dialog, laid out like a work item in Azure Boards: description,
// subtasks and discussion on the left; status, parent, labels and effort on the right.

import { canComment, canEdit } from "../lib/access";
import { startThread } from "../lib/comments";
import { openDoc } from "../lib/workspace";
import { createSignal, For, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import {
  addComment,
  addLabel,
  addSubtask,
  cardById,
  deleteCard,
  deleteComment,
  deleteTimeEntry,
  entryMs,
  deleteLabel,
  editComment,
  findCard,
  formatClock,
  formatHours,
  isDone,
  kanban,
  labels,
  moveCardToColumn,
  possibleParents,
  setDone,
  subtaskProgress,
  subtasksOf,
  toggleCardLabel,
  updateCard,
  timeEntries,
  updateLabel,
  updateTimeEntry,
  addTimeEntry,
  isMine,
  timeByPerson,
  toggleAssignee,
} from "../lib/kanban";
import { me } from "../lib/auth";
import { people, personById } from "../lib/people";
import { Avatar } from "./AccountMenu";
import { Menu } from "./Menu";
import { activeTimer, now, startTimer, stopTimer } from "../lib/timer";
import type { KanbanCard, KanbanComment, KanbanLabel, KanbanTimeEntry, NodeColor } from "../lib/types";
import { ConfirmButton } from "./ConfirmButton";
import { IconClose, IconPlay, IconStop, IconSubtasks, IconTrash, KANBAN_ICON_KEYS, KANBAN_ICONS } from "./icons";
import { MarkdownView, onMarkdownKeyDown } from "./Markdown";
import { RichTextEditor } from "./RichTextEditor";
import { Links } from "./CardLinks";
import { PlanningFields } from "./Planning";

const COLORS: NodeColor[] = ["white", "yellow", "green", "blue", "purple", "pink"];

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Parses an hours input: empty means "not set", negative numbers become 0. */
function parseHours(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) ? Math.max(0, n) : undefined;
}

export function CardDialog(p: { cardId: string; onOpen: (id: string) => void; onClose: () => void }) {
  const found = () => findCard(p.cardId);

  const close = () => {
    const card = cardById(p.cardId);
    if (card && !card.title.trim()) updateCard(p.cardId, { title: "Untitled" });
    p.onClose();
  };

  return (
    <Show when={found()}>
      {(f) => {
        const card = () => f().card;
        const parent = () => (card().parentId ? cardById(card().parentId!) : undefined);
        return (
          <Portal>
            <div class="kanban-dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
              <div class="kanban-dialog panel" role="dialog" aria-label="Card">
                <div class="kd-top">
                  <Show when={parent()} fallback={<span class="kd-kind">Card</span>}>
                    {(par) => (
                      <button class="kd-parent-link" onClick={() => p.onOpen(par().id)} title="Open parent card">
                        <IconSubtasks /> Subtask of <strong>{par().title}</strong>
                      </button>
                    )}
                  </Show>
                  <button class="icon-btn small" title="Close (Esc)" onClick={close}>
                    <IconClose />
                  </button>
                </div>

                <textarea
                  class="kanban-dialog-title"
                  rows={1}
                  value={card().title}
                  placeholder="Card title"
                  readOnly={!canEdit()}
                  ref={(el) => queueMicrotask(() => autosize(el))}
                  onInput={(e) => {
                    autosize(e.currentTarget);
                    updateCard(p.cardId, { title: e.currentTarget.value });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                />

                {/* Viewing only: every field and button in it is off */}
                <fieldset class="kd-fields" disabled={!canEdit()}>
                <div class="kd-body">
                  <div class="kd-main">
                    <Description card={card()} />
                    <Subtasks card={card()} onOpen={p.onOpen} />
                    <TimeLog card={card()} />
                    <Discussion card={card()} />
                  </div>
                  <aside class="kd-aside">
                    <Assignees card={card()} />
                    <PlanningFields card={card()} />
                    <Field label="Status">
                      <select
                        class="kd-select"
                        value={f().column.id}
                        onChange={(e) => moveCardToColumn(p.cardId, e.currentTarget.value)}
                      >
                        <For each={kanban.columns}>{(c) => <option value={c.id}>{c.title}</option>}</For>
                      </select>
                    </Field>
                    <Field label="Parent">
                      <select
                        class="kd-select"
                        value={card().parentId ?? ""}
                        onChange={(e) => updateCard(p.cardId, { parentId: e.currentTarget.value || undefined })}
                      >
                        <option value="">None</option>
                        <For each={possibleParents(p.cardId)}>{(c) => <option value={c.id}>{c.title}</option>}</For>
                      </select>
                    </Field>
                    <Labels card={card()} />
                    <Links card={card()} />
                    <Effort card={card()} />
                  </aside>
                </div>
                </fieldset>

                <div class="kanban-dialog-footer">
                  <Show when={canEdit()} fallback={<span />}>
                    <ConfirmButton
                      class="text-btn danger-text"
                      onConfirm={() => {
                        p.onClose();
                        deleteCard(p.cardId);
                      }}
                    >
                      <IconTrash /> Delete card
                    </ConfirmButton>
                  </Show>
                  <Show when={canComment() && openDoc()?.role}>
                    <button
                      class="text-btn"
                      onClick={() => {
                        close();
                        startThread({ kind: "card", id: p.cardId });
                      }}
                    >
                      Comment on this card
                    </button>
                  </Show>
                  <button class="text-btn primary" onClick={close}>
                    Done
                  </button>
                </div>
              </div>
            </div>
          </Portal>
        );
      }}
    </Show>
  );
}

/** Who works on the card: the people with access to the board, picked from a menu. */
function Assignees(p: { card: KanbanCard }) {
  const ids = () => p.card.assigneeIds ?? [];
  const myId = () => me()?.user.id;
  return (
    // Only boards from the server have people
    <Show when={openDoc()?.role}>
      <div class="kd-field">
        <div class="kd-label">
          Assigned to
          <Menu
            align="right"
            button={(toggle) => (
              <button class="kd-link kd-label-action" onClick={toggle} disabled={!people().length}>
                + Assign
              </button>
            )}
          >
            {(close) => (
              <>
                <div class="menu-title">People on this board</div>
                <For each={people()}>
                  {(u) => (
                    <button
                      class="menu-item"
                      onClick={() => {
                        toggleAssignee(p.card.id, u.id);
                        close();
                      }}
                    >
                      <span class="assign-option">
                        <Avatar name={u.name} url={u.avatarUrl} size={20} />
                        {u.name}
                        <Show when={u.id === myId()}> (you)</Show>
                      </span>
                      <small>{ids().includes(u.id) ? "✓ assigned" : ""}</small>
                    </button>
                  )}
                </For>
              </>
            )}
          </Menu>
        </div>
        <div class="kd-assignees">
          <For each={ids()} fallback={<span class="kd-empty">Nobody yet</span>}>
            {(id) => {
              const u = () => personById(id);
              return (
                <span class="kd-assignee" title={u()?.email ?? "No longer on this board"}>
                  <Avatar name={u()?.name ?? "?"} url={u()?.avatarUrl} size={22} />
                  <span>{u()?.name ?? "Former member"}</span>
                  <button class="kd-assignee-remove" title="Unassign" onClick={() => toggleAssignee(p.card.id, id)}>
                    ×
                  </button>
                </span>
              );
            }}
          </For>
        </div>
        <Show when={myId() && !ids().includes(myId()!)}>
          <button class="kd-link" onClick={() => toggleAssignee(p.card.id, myId()!)}>
            Assign me
          </button>
        </Show>
      </div>
    </Show>
  );
}

function Field(p: { label: string; children: JSX.Element }) {
  return (
    <div class="kd-field">
      <div class="kd-label">{p.label}</div>
      {p.children}
    </div>
  );
}

// ---------- main column ----------

function Description(p: { card: KanbanCard }) {
  return (
    <section>
      <div class="kd-label">Description</div>
      <Show when={p.card.id} keyed>
        <RichTextEditor
          class="kd-description"
          value={p.card.description}
          placeholder="Add more details… Type ## for a heading, - for a list or [ ] for a checklist."
          onChange={(description) => updateCard(p.card.id, { description })}
          readOnly={!canEdit()}
        />
      </Show>
    </section>
  );
}

function Subtasks(p: { card: KanbanCard; onOpen: (id: string) => void }) {
  let input!: HTMLInputElement;
  const progress = () => subtaskProgress(p.card.id);
  const columnOf = (id: string) => findCard(id)?.column.title ?? "";
  return (
    <section>
      <div class="kd-label">
        Subtasks
        <Show when={progress().total}>
          <span class="kd-label-count">
            {progress().done}/{progress().total}
          </span>
        </Show>
      </div>
      <Show when={progress().total}>
        <div class="kd-progress">
          <div style={{ width: `${(progress().done / progress().total) * 100}%` }} />
        </div>
      </Show>
      <div class="kd-subtasks">
        <For each={subtasksOf(p.card.id)}>
          {(sub) => (
            <div class="kd-subtask" classList={{ done: isDone(sub.id) }}>
              <input
                type="checkbox"
                checked={isDone(sub.id)}
                title="Checking moves it to a done column"
                onChange={(e) => setDone(sub.id, e.currentTarget.checked)}
              />
              <button class="kd-subtask-title" onClick={() => p.onOpen(sub.id)}>
                {sub.title}
              </button>
              <span class="kd-subtask-meta">{columnOf(sub.id)}</span>
            </div>
          )}
        </For>
      </div>
      <input
        ref={input}
        class="kd-input"
        placeholder="Add a subtask and press Enter…"
        onKeyDown={(e) => {
          if (e.key === "Enter" && addSubtask(p.card.id, input.value)) input.value = "";
        }}
      />
    </section>
  );
}

function Discussion(p: { card: KanbanCard }) {
  let input!: HTMLTextAreaElement;
  const submit = () => {
    addComment(p.card.id, input.value);
    input.value = "";
  };
  // Newest first, like Azure
  const comments = () => [...(p.card.comments ?? [])].reverse();
  return (
    <section>
      <div class="kd-label">
        Discussion
        <Show when={p.card.comments?.length}>
          <span class="kd-label-count">{p.card.comments!.length}</span>
        </Show>
      </div>
      <div class="kd-comment-composer">
        <textarea
          ref={input}
          class="kd-input kd-comment-input"
          rows={2}
          placeholder="Add a comment… (Cmd+Enter to post)"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            } else onMarkdownKeyDown(e);
          }}
        />
        <button class="text-btn primary small" onClick={submit}>
          Comment
        </button>
      </div>
      <For each={comments()}>{(c) => <Comment cardId={p.card.id} comment={c} />}</For>
    </section>
  );
}

function Comment(p: { cardId: string; comment: KanbanComment }) {
  const [editing, setEditing] = createSignal(false);
  let input!: HTMLTextAreaElement;
  const save = () => {
    editComment(p.cardId, p.comment.id, input.value);
    setEditing(false);
  };
  return (
    <div class="kd-comment">
      <div class="kd-comment-head">
        <span>
          {formatDate(p.comment.createdAt)}
          <Show when={p.comment.editedAt}> · edited</Show>
        </span>
        <span class="kd-comment-actions">
          <button class="kd-link" onClick={() => setEditing(!editing())}>
            {editing() ? "Cancel" : "Edit"}
          </button>
          <ConfirmButton class="kd-link" onConfirm={() => deleteComment(p.cardId, p.comment.id)}>
            Delete
          </ConfirmButton>
        </span>
      </div>
      <Show when={editing()} fallback={<MarkdownView text={p.comment.text} class="kd-comment-text" />}>
        <textarea
          ref={(el) => {
            input = el;
            queueMicrotask(() => el.focus());
          }}
          class="kd-input kd-comment-input"
          rows={3}
          value={p.comment.text}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            } else onMarkdownKeyDown(e);
          }}
        />
        <button class="text-btn primary small" onClick={save}>
          Save
        </button>
      </Show>
    </div>
  );
}

// ---------- side column ----------

function Labels(p: { card: KanbanCard }) {
  const [managing, setManaging] = createSignal(false);
  let input!: HTMLInputElement;
  const has = (id: string) => (p.card.labelIds ?? []).includes(id);
  const create = () => {
    const id = addLabel(input.value);
    if (id) {
      toggleCardLabel(p.card.id, id);
      input.value = "";
    }
  };
  return (
    <div class="kd-field">
      <div class="kd-label">
        Labels
        <Show when={labels().length}>
          <button class="kd-link kd-label-action" onClick={() => setManaging(!managing())}>
            {managing() ? "Done" : "Edit"}
          </button>
        </Show>
      </div>
      <Show
        when={managing()}
        fallback={
          <div class="kd-label-list">
            <For each={labels()}>
              {(l) => (
                <button
                  class={`label-chip color-${l.color}`}
                  classList={{ off: !has(l.id) }}
                  title={l.description || (has(l.id) ? "Remove label" : "Add label")}
                  onClick={() => toggleCardLabel(p.card.id, l.id)}
                >
                  <LabelContent label={l} />
                </button>
              )}
            </For>
          </div>
        }
      >
        <For each={labels()}>{(l) => <LabelEditor label={l} />}</For>
      </Show>
      <input
        ref={input}
        class="kd-input"
        placeholder="New label…"
        onKeyDown={(e) => e.key === "Enter" && create()}
      />
    </div>
  );
}

export function LabelContent(p: { label: KanbanLabel }) {
  return (
    <>
      <Show when={p.label.icon}>{(icon) => KANBAN_ICONS[icon()].icon()}</Show>
      <span>{p.label.name}</span>
    </>
  );
}

function LabelEditor(p: { label: KanbanLabel }) {
  return (
    <div class="kd-label-editor">
      <div class="kd-label-editor-row">
        <input
          class="kd-input"
          value={p.label.name}
          onChange={(e) => e.currentTarget.value.trim() && updateLabel(p.label.id, { name: e.currentTarget.value.trim() })}
        />
        <ConfirmButton class="icon-btn small danger" title="Delete label" onConfirm={() => deleteLabel(p.label.id)}>
          <IconTrash />
        </ConfirmButton>
      </div>
      <div class="kd-swatches">
        <For each={COLORS}>
          {(c) => (
            <button
              class={`swatch color-${c}`}
              classList={{ active: p.label.color === c }}
              title={c}
              onClick={() => updateLabel(p.label.id, { color: c })}
            />
          )}
        </For>
      </div>
      <IconPicker value={p.label.icon ?? null} onChange={(icon) => updateLabel(p.label.id, { icon: icon ?? undefined })} />
    </div>
  );
}

/** A row of icon buttons; clicking the selected one clears it. */
export function IconPicker(p: { value: string | null; onChange: (icon: (typeof KANBAN_ICON_KEYS)[number] | null) => void }) {
  return (
    <div class="icon-picker">
      <For each={KANBAN_ICON_KEYS}>
        {(key) => (
          <button
            classList={{ active: p.value === key }}
            title={KANBAN_ICONS[key].label}
            onClick={() => p.onChange(p.value === key ? null : key)}
          >
            {KANBAN_ICONS[key].icon()}
          </button>
        )}
      </For>
    </div>
  );
}

function Effort(p: { card: KanbanCard }) {
  const expected = () => p.card.expectedHours;
  const spent = () => p.card.spentHours ?? 0;
  const remaining = () => (expected() == null ? undefined : Math.max(0, expected()! - spent()));
  const over = () => expected() != null && spent() > expected()!;
  const running = () => activeTimer()?.cardId === p.card.id;

  return (
    <div class="kd-field">
      <div class="kd-label">Effort (hours)</div>
      <div class="kd-effort">
        <label>
          <span>Original estimate</span>
          <input
            class="kd-input kd-number"
            type="number"
            min="0"
            step="0.5"
            value={expected() ?? ""}
            onChange={(e) => updateCard(p.card.id, { expectedHours: parseHours(e.currentTarget.value) })}
          />
        </label>
        <label>
          <span>Completed</span>
          <input
            class="kd-input kd-number"
            type="number"
            min="0"
            step="0.5"
            value={p.card.spentHours == null ? "" : Math.round(p.card.spentHours * 100) / 100}
            onChange={(e) => updateCard(p.card.id, { spentHours: parseHours(e.currentTarget.value) })}
          />
        </label>
        <button
          class="kd-timer-btn"
          classList={{ running: running() }}
          onClick={() => (running() ? stopTimer() : startTimer(p.card.id))}
        >
          <Show when={running()} fallback={<><IconPlay /> Start timer</>}>
            <IconStop /> Stop <span class="kd-timer-clock">{formatClock(now() - activeTimer()!.startedAt)}</span>
          </Show>
        </button>
        <Show when={expected() != null}>
          <div class="kd-remaining" classList={{ over: over() }}>
            {over()
              ? `${formatHours(spent() - expected()!)} over estimate`
              : `${formatHours(remaining()!)} remaining`}
          </div>
          <div class="kd-progress" classList={{ over: over() }}>
            <div style={{ width: `${Math.min(100, expected()! ? (spent() / expected()!) * 100 : 100)}%` }} />
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------- time log ----------

const HOUR = 3_600_000;

const formatDay = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const formatTime = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** ms -> value for <input type="datetime-local">, in local time */
function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}
const fromLocalInput = (value: string) => new Date(value).getTime();

function TimeLog(p: { card: KanbanCard }) {
  const [adding, setAdding] = createSignal(false);
  // Newest first; `now()` makes a running session tick
  const entries = () => [...timeEntries(p.card)].reverse();
  const total = () => timeEntries(p.card).reduce((sum, e) => sum + entryMs(e, now()), 0);
  // Who spent how much (only worth showing when someone is named)
  const perPerson = () => timeByPerson(p.card, now()).filter((r) => r.userId);
  return (
    <section>
      <div class="kd-label">
        Time log
        <Show when={entries().length}>
          <span class="kd-label-count">{formatHours(total() / HOUR)}</span>
        </Show>
        <button class="kd-link kd-label-action" onClick={() => setAdding(!adding())}>
          {adding() ? "Cancel" : "+ Add time"}
        </button>
      </div>
      <Show when={adding()}>
        <TimeEntryForm
          startedAt={Date.now() - HOUR}
          endedAt={Date.now()}
          submitLabel="Add"
          onSubmit={(start, end, note) => {
            addTimeEntry(p.card.id, start, end, note);
            setAdding(false);
          }}
        />
      </Show>
      <Show when={perPerson().length}>
        <div class="kd-time-people">
          <For each={perPerson()}>
            {(r) => (
              <span class="kd-time-person" title={`${r.name}: ${formatHours(r.ms / HOUR)} on this card`}>
                <Avatar name={r.name} url={personById(r.userId!)?.avatarUrl} size={20} />
                <span>{r.name}</span>
                <strong>{formatHours(r.ms / HOUR)}</strong>
              </span>
            )}
          </For>
        </div>
      </Show>
      <Show when={entries().length} fallback={<Show when={!adding()}><p class="kd-empty">Start the timer, or add time you already spent.</p></Show>}>
        <div class="kd-time-log">
          <For each={entries()}>{(e) => <TimeEntryRow cardId={p.card.id} entry={e} />}</For>
        </div>
      </Show>
    </section>
  );
}

function TimeEntryRow(p: { cardId: string; entry: KanbanTimeEntry }) {
  const [editing, setEditing] = createSignal(false);
  const running = () => p.entry.endedAt == null;
  // People change their own time; the board's owner can correct anyone's
  const mayChange = () => isMine(p.entry) || openDoc()?.role === "owner" || openDoc()?.role === "coOwner";
  return (
    <Show
      when={!editing()}
      fallback={
        <TimeEntryForm
          startedAt={p.entry.startedAt}
          endedAt={p.entry.endedAt!}
          note={p.entry.note}
          submitLabel="Save"
          onSubmit={(startedAt, endedAt, note) => {
            updateTimeEntry(p.cardId, p.entry.id, { startedAt, endedAt, note });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      }
    >
      <div class="kd-time-row" classList={{ running: running() }}>
        <Show when={p.entry.userName}>
          <span class="kd-time-who" title={p.entry.userName!}>
            <Avatar name={p.entry.userName!} url={personById(p.entry.userId ?? "")?.avatarUrl} size={18} />
          </span>
        </Show>
        <span class="kd-time-day">{formatDay(p.entry.startedAt)}</span>
        <span class="kd-time-range">
          {formatTime(p.entry.startedAt)} – {running() ? "now" : formatTime(p.entry.endedAt!)}
        </span>
        <span class="kd-time-duration">
          {running() ? formatClock(entryMs(p.entry, now())) : formatHours(entryMs(p.entry) / HOUR)}
        </span>
        <input
          class="kd-time-note"
          value={p.entry.note ?? ""}
          placeholder="What did you do?"
          disabled={!mayChange()}
          onChange={(e) => updateTimeEntry(p.cardId, p.entry.id, { note: e.currentTarget.value })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
        <span class="kd-time-actions" hidden={!mayChange()}>
          <Show when={!running()}>
            <button class="kd-link" onClick={() => setEditing(true)}>
              Edit
            </button>
          </Show>
          <ConfirmButton class="kd-link" onConfirm={() => deleteTimeEntry(p.cardId, p.entry.id)}>
            Delete
          </ConfirmButton>
        </span>
      </div>
    </Show>
  );
}

/** From / to / note, used for adding time afterwards and for editing a session. */
function TimeEntryForm(p: {
  startedAt: number;
  endedAt: number;
  note?: string;
  submitLabel: string;
  onSubmit: (startedAt: number, endedAt: number, note: string) => void;
  onCancel?: () => void;
}) {
  let from!: HTMLInputElement;
  let to!: HTMLInputElement;
  let note!: HTMLInputElement;
  const [error, setError] = createSignal("");
  const submit = () => {
    const start = fromLocalInput(from.value);
    const end = fromLocalInput(to.value);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return setError("Fill in both times.");
    if (end <= start) return setError("The end has to be after the start.");
    p.onSubmit(start, end, note.value.trim());
  };
  return (
    <div class="kd-time-form">
      <label>
        <span>From</span>
        <input ref={from} class="kd-input" type="datetime-local" value={toLocalInput(p.startedAt)} />
      </label>
      <label>
        <span>To</span>
        <input ref={to} class="kd-input" type="datetime-local" value={toLocalInput(p.endedAt)} />
      </label>
      <input
        ref={note}
        class="kd-input"
        value={p.note ?? ""}
        placeholder="What did you do? (optional)"
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <div class="kd-time-form-actions">
        <Show when={error()}>
          <span class="kd-error">{error()}</span>
        </Show>
        <Show when={p.onCancel}>
          <button class="text-btn small" onClick={p.onCancel}>
            Cancel
          </button>
        </Show>
        <button class="text-btn primary small" onClick={submit}>
          {p.submitLabel}
        </button>
      </div>
    </div>
  );
}

/** Grows a textarea to fit its content. */
function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
