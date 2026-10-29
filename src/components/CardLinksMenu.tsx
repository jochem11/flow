// The "Cards" menu: kanban cards linked to the open document or a part of it.

import { createResource, createSignal, For, Show } from "solid-js";
import { Menu } from "./Menu";
import {
  boardDocs,
  cardsLinkedTo,
  createLinkedCard,
  linkCard,
  loadBoard,
  openLinkedCard,
  unlinkCard,
} from "../lib/links";
import { IconClose, IconKanban } from "./icons";

/**
 * Kanban cards linked to a part of the open document (a group, a table), or with
 * `nodeId` null to the whole document: open or unlink them, link an existing card
 * from one of the project's boards, or create a new one there.
 */
export function CardLinksMenu(p: { nodeId: string | null; label?: string }) {
  const linked = () => cardsLinkedTo(p.nodeId);
  const [boardId, setBoardId] = createSignal(boardDocs()[0]?.id ?? "");
  const [query, setQuery] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [boardData, { refetch }] = createResource(boardId, (id) => (id ? loadBoard(id) : null));

  const run = async (job: Promise<void>) => {
    setBusy(true);
    try {
      await job;
      await refetch();
    } finally {
      setBusy(false);
    }
  };

  /** Cards on the chosen board that are not linked to this group yet */
  const choices = () => {
    const done = new Set(linked().filter((c) => c.boardId === boardId()).map((c) => c.cardId));
    const q = query().trim().toLowerCase();
    return (boardData()?.columns ?? []).flatMap((col) =>
      col.cards
        .filter((c) => !done.has(c.id) && (!q || c.title.toLowerCase().includes(q)))
        .map((c) => ({ id: c.id, title: c.title, column: col.title })),
    );
  };

  return (
    <Menu
      button={(toggle, open) => (
        <button
          class={p.nodeId ? "icon-btn" : "text-btn"}
          classList={{ pressed: open() }}
          title={p.nodeId ? "Kanban cards linked to this" : "Kanban cards linked to this document"}
          onClick={toggle}
        >
          <IconKanban />
          <span>
            {p.label ?? "Cards"}
            {linked().length ? ` (${linked().length})` : ""}
          </span>
        </button>
      )}
    >
      {() => (
        <div class="card-links-menu" classList={{ busy: busy() }}>
          <div class="menu-title">Linked cards</div>
          <For each={linked()} fallback={<div class="menu-empty">None yet</div>}>
            {(c) => (
              <div class="menu-row">
                <button class="menu-item" onClick={() => openLinkedCard(c.boardId, c.cardId)}>
                  <span>{c.title}</span>
                  <small>{c.column}</small>
                </button>
                <button
                  class="icon-btn small"
                  title="Unlink"
                  onClick={() => run(unlinkCard(c.boardId, c.cardId, p.nodeId))}
                >
                  <IconClose />
                </button>
              </div>
            )}
          </For>
          <div class="menu-sep" />
          <Show when={boardDocs().length} fallback={<div class="menu-empty">No kanban boards in this project</div>}>
            <div class="menu-title">Link a card</div>
            <div class="card-links-fields">
              <select class="kd-select" value={boardId()} onChange={(e) => setBoardId(e.currentTarget.value)}>
                <For each={boardDocs()}>{(d) => <option value={d.id}>{d.name}</option>}</For>
              </select>
              <input
                class="kd-input"
                placeholder="Search cards…"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div class="card-links-list">
              <For each={choices()} fallback={<div class="menu-empty">{boardData.loading ? "Loading…" : "No cards to link"}</div>}>
                {(c) => (
                  <button class="menu-item" onClick={() => run(linkCard(boardId(), c.id, p.nodeId))}>
                    <span>{c.title}</span>
                    <small>{c.column}</small>
                  </button>
                )}
              </For>
            </div>
            <div class="card-links-fields">
              <input
                class="kd-input"
                placeholder="New card, press Enter…"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key !== "Enter" || !e.currentTarget.value.trim()) return;
                  const title = e.currentTarget.value;
                  e.currentTarget.value = "";
                  void run(createLinkedCard(boardId(), title, p.nodeId));
                }}
              />
            </div>
          </Show>
        </div>
      )}
    </Menu>
  );
}
