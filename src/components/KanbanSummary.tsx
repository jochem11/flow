// The summary of a kanban board, as in Jira: how much there is and how much is
// done, the running sprint, the cards by status, priority, person and label,
// the hours, every sprint so far, and what needs attention.
//
// The bars are one colour: they show how many, the name beside each says what.

import { createMemo, For, Show, type JSX } from "solid-js";
import { canEdit } from "../lib/access";
import { allCards, blockersOf, boardKey, cardKey, cardsIn, formatHours, isDone, kanban, labels, plannedSprints, reopenSprint, setOpenCardId, sprints } from "../lib/kanban";
import { setScope, setView } from "../lib/kanbanView";
import { personById } from "../lib/people";
import { isDueSoon, isOverdue, PRIORITIES } from "../lib/planning";
import { progressOf, stateOf } from "../lib/tickets";
import type { KanbanCard, Sprint } from "../lib/types";
import { openDoc } from "../lib/workspace";
import { openSprintDialog, sprintDates, sprintLeft } from "./KanbanBacklog";
import { DueChip, PriorityIcon } from "./Planning";

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function KanbanSummary() {
  const cards = createMemo(() => allCards());
  const done = (c: KanbanCard) => isDone(c.id);
  const open = createMemo(() => cards().filter((c) => !done(c)));
  const total = createMemo(() => progressOf(cards(), done));
  const overdue = createMemo(() => open().filter((c) => isOverdue(c, false)));
  const blocked = createMemo(() => open().filter((c) => blockersOf(c.id).length));
  const active = () => sprints().filter((s) => stateOf(s) === "active");
  const next = () => plannedSprints().find((s) => stateOf(s) === "planned");
  const goTo = (view: "board" | "backlog", sprintId?: string) => {
    if (sprintId) setScope(sprintId, openDoc()?.id);
    setView(view, openDoc()?.id);
  };

  // ---------- the breakdowns ----------
  const byStatus = () => kanban.columns.map((col) => ({ label: col.title, value: col.cards.length, note: col.done ? "done" : "" }));
  const byPriority = () => [
    ...PRIORITIES.map((p) => ({ label: p.label, value: open().filter((c) => c.priority === p.value).length, icon: () => <PriorityIcon priority={p.value} /> })),
    { label: "None", value: open().filter((c) => !c.priority).length },
  ];
  const byPerson = createMemo(() => {
    const count = new Map<string, number>();
    let nobody = 0;
    for (const c of open()) {
      if (!c.assigneeIds?.length) nobody++;
      for (const id of c.assigneeIds ?? []) count.set(id, (count.get(id) ?? 0) + 1);
    }
    const rows = [...count].map(([id, value]) => ({ label: personById(id)?.name ?? "Former member", value })).sort((a, b) => b.value - a.value);
    return count.size ? [...rows, { label: "Unassigned", value: nobody }] : [];
  });
  const byLabel = () =>
    labels()
      .map((l) => ({ label: l.name, value: cards().filter((c) => (c.labelIds ?? []).includes(l.id)).length }))
      .filter((r) => r.value)
      .sort((a, b) => b.value - a.value);
  const attention = createMemo(() =>
    open()
      .filter((c) => isOverdue(c, false) || isDueSoon(c, false))
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 8),
  );
  /** Every sprint: running, planned, then the completed ones, the last one first */
  const sprintRows = createMemo(() => [
    ...plannedSprints(),
    ...sprints()
      .filter((s) => stateOf(s) === "done")
      .sort((a, b) => (b.completedOn ?? "").localeCompare(a.completedOn ?? "")),
  ]);

  return (
    <div class="kanban-summary">
      <div class="sum-tiles">
        <Tile label="Cards" value={total().total} note={`Ticket ids start with ${boardKey()}`} />
        <Tile label="Done" value={total().done} note={`${pct(total().done, total().total)}% of all cards`} />
        <Tile label="Open" value={open().length} note={plural(cardsIn(null).filter((c) => !done(c)).length, "in the backlog", "in the backlog")} />
        <Tile label="Overdue" value={overdue().length} warn={overdue().length > 0} note={overdue().length ? "Past their due date" : "Nothing is late"} />
        <Tile label="Blocked" value={blocked().length} warn={blocked().length > 0} note={blocked().length ? "Waiting for another card" : "Nothing is waiting"} />
      </div>

      <For
        each={active()}
        fallback={
          <section class="sum-panel sum-wide sum-nosprint">
            <Show
              when={next()}
              fallback={
                <p>
                  <strong>No sprints yet.</strong> Plan the work in sprints from the backlog.
                </p>
              }
            >
              {(s) => (
                <p>
                  <strong>No sprint is running.</strong> Next up: {s().name}, with {plural(cardsIn(s().id).length, "card", "cards")}.
                </p>
              )}
            </Show>
            <button class="text-btn small" onClick={() => goTo("backlog")}>
              Open the backlog
            </button>
          </section>
        }
      >
        {(s) => <ActiveSprint sprint={s} onBoard={() => goTo("board", s.id)} />}
      </For>

      <Panel title="Status" note="All cards, by column">
        <Bars rows={byStatus()} unit={["card", "cards"]} />
      </Panel>
      <Panel title="Priority" note="Cards that are not done">
        <Bars rows={byPriority()} unit={["card", "cards"]} />
      </Panel>
      <Show when={byPerson().length}>
        <Panel title="Workload" note="Cards that are not done, by who works on them">
          <Bars rows={byPerson()} unit={["card", "cards"]} />
        </Panel>
      </Show>
      <Show when={byLabel().length}>
        <Panel title="Labels" note="All cards">
          <Bars rows={byLabel()} unit={["card", "cards"]} />
        </Panel>
      </Show>
      <Show when={total().expected || total().spent}>
        <Panel title="Time" note="Hours on all cards">
          <div class="sum-time">
            <div>
              <strong>{formatHours(total().spent)}</strong>
              <span>spent</span>
            </div>
            <div>
              <strong>{formatHours(total().expected)}</strong>
              <span>estimated</span>
            </div>
            <div>
              <strong>{formatHours(Math.max(0, total().expected - total().expectedDone))}</strong>
              <span>estimated on open cards</span>
            </div>
          </div>
          <Show when={total().expected}>
            <Meter part={total().spent} whole={total().expected} label={`${pct(total().spent, total().expected)}% of the estimate spent`} />
          </Show>
        </Panel>
      </Show>
      <Show when={attention().length}>
        <Panel title="Needs attention" note="Overdue, or due today or tomorrow">
          <div class="sum-cards">
            <For each={attention()}>
              {(c) => (
                <button class="sum-card" onClick={() => setOpenCardId(c.id)}>
                  <span class="ticket-key">{cardKey(c)}</span>
                  <span class="sum-card-title">{c.title}</span>
                  <DueChip card={c} />
                </button>
              )}
            </For>
          </div>
        </Panel>
      </Show>

      <Show when={sprintRows().length}>
        <section class="sum-panel sum-wide">
          <h3>Sprints</h3>
          <div class="sum-table-wrap">
            <table class="sum-table">
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th>State</th>
                  <th>Dates</th>
                  <th class="num">Done</th>
                  <th class="num">Carried over</th>
                  <th class="num">Hours spent</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <For each={sprintRows()}>
                  {(s) => {
                    const p = () => progressOf(cardsIn(s.id), done);
                    const state = () => stateOf(s);
                    return (
                      <tr>
                        <td class="sum-sprint-name" title={s.goal || undefined}>
                          {s.name}
                        </td>
                        <td>
                          <span class={`sprint-state ${state()}`}>{state() === "done" ? "Completed" : state() === "active" ? "Active" : "Planned"}</span>
                        </td>
                        <td>{state() === "done" && s.completedOn && !s.startDate ? `Completed ${s.completedOn}` : sprintDates(s)}</td>
                        <td class="num">
                          {/* What was not done went on to another sprint when it was completed */}
                          {state() === "done" ? p().total : `${p().done} of ${p().total}`}
                        </td>
                        <td class="num">{state() === "done" ? (s.carriedOver ?? 0) : ""}</td>
                        <td class="num">{p().spent ? formatHours(p().spent) : ""}</td>
                        <td class="sum-row-action">
                          <Show when={canEdit() && state() === "done"}>
                            <button class="kd-link" title="Run this sprint again, with its cards back on the board" onClick={() => reopenSprint(s.id)}>
                              Reopen
                            </button>
                          </Show>
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </section>
      </Show>
    </div>
  );
}

function Tile(p: { label: string; value: number; note?: string; warn?: boolean }) {
  return (
    <div class="sum-tile panel" classList={{ warn: p.warn }}>
      <span class="sum-tile-label">{p.label}</span>
      <strong>{p.value}</strong>
      <Show when={p.note}>
        <span class="sum-tile-note">{p.note}</span>
      </Show>
    </div>
  );
}

function Panel(p: { title: string; note?: string; children: JSX.Element }) {
  return (
    <section class="sum-panel">
      <h3>{p.title}</h3>
      <Show when={p.note}>
        <p class="sum-note">{p.note}</p>
      </Show>
      {p.children}
    </section>
  );
}

/** Rows of a name, a bar and a number; the longest bar is the highest number. */
function Bars(p: { rows: { label: string; value: number; note?: string; icon?: () => JSX.Element }[]; unit: [string, string] }) {
  const max = () => Math.max(1, ...p.rows.map((r) => r.value));
  const sum = () => p.rows.reduce((n, r) => n + r.value, 0);
  return (
    <div class="sum-bars">
      <For each={p.rows}>
        {(r) => (
          <div class="sum-bar-row" title={`${r.label}: ${plural(r.value, ...p.unit)} (${pct(r.value, sum())}%)`}>
            <span class="sum-bar-label">
              {r.icon?.()}
              <span>{r.label}</span>
              <Show when={r.note}>
                <small>{r.note}</small>
              </Show>
            </span>
            <span class="sum-bar-track">
              <span class="sum-bar" style={{ width: `${(r.value / max()) * 100}%` }} />
            </span>
            <span class="sum-bar-value">{r.value}</span>
          </div>
        )}
      </For>
    </div>
  );
}

/** How much of a whole: a bar with what it says under it. More than the whole shows as over. */
function Meter(p: { part: number; whole: number; label: string }) {
  return (
    <div class="sum-meter" classList={{ over: p.part > p.whole }}>
      <div class="sum-meter-track" role="img" aria-label={p.label}>
        <div style={{ width: `${Math.min(100, pct(p.part, p.whole))}%` }} />
      </div>
      <span>{p.label}</span>
    </div>
  );
}

function ActiveSprint(p: { sprint: Sprint; onBoard: () => void }) {
  const cards = () => cardsIn(p.sprint.id);
  const progress = () => progressOf(cards(), (c) => isDone(c.id));
  const left = () => sprintLeft(p.sprint);
  return (
    <section class="sum-panel sum-wide sum-sprint">
      <header>
        <h3>{p.sprint.name}</h3>
        <span class="sprint-state active">Active</span>
        <span class="backlog-dates">{sprintDates(p.sprint)}</span>
        <Show when={left()}>{(l) => <span class="backlog-left" classList={{ over: l().over }}>{l().text}</span>}</Show>
        <span class="spacer" />
        <button class="text-btn small" onClick={p.onBoard}>
          Open the board
        </button>
        <Show when={canEdit()}>
          <button class="text-btn small" onClick={() => openSprintDialog("complete", p.sprint.id)}>
            Complete sprint
          </button>
        </Show>
      </header>
      <Show when={p.sprint.goal}>
        <p class="backlog-goal">{p.sprint.goal}</p>
      </Show>
      <div class="sum-sprint-meters">
        <Meter part={progress().done} whole={progress().total} label={`${progress().done} of ${plural(progress().total, "card", "cards")} done`} />
        <Show when={progress().expected}>
          <Meter part={progress().spent} whole={progress().expected} label={`${formatHours(progress().spent)} spent of ${formatHours(progress().expected)} estimated`} />
        </Show>
      </div>
    </section>
  );
}
