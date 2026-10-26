import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { inTauri } from "../lib/api";
import {
  boards,
  newBoard,
  openBoard,
  refreshBoards,
  removeBoard,
  runAutoLayout,
  runExport,
  saveState,
} from "../lib/persistence";
import { board, canRedo, canUndo, redo, renameBoard, undo } from "../lib/store";
import type { ExportFormat } from "../lib/types";
import {
  IconChevron,
  IconExport,
  IconLayout,
  IconPlus,
  IconRedo,
  IconTrash,
  IconUndo,
} from "./icons";

/** Klein dropdown-menu dat sluit bij klikken buiten het menu. */
function Menu(p: { button: (open: () => void) => JSX.Element; children: (close: () => void) => JSX.Element; align?: "left" | "right" }) {
  const [open, setOpen] = createSignal(false);
  let ref!: HTMLDivElement;
  const onDoc = (e: PointerEvent) => {
    if (!ref.contains(e.target as Node)) setOpen(false);
  };
  onMount(() => document.addEventListener("pointerdown", onDoc));
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));
  return (
    <div class="menu-wrap" ref={ref}>
      {p.button(() => setOpen((o) => !o))}
      <Show when={open()}>
        <div class="menu panel" classList={{ right: p.align === "right" }}>
          {p.children(() => setOpen(false))}
        </div>
      </Show>
    </div>
  );
}

function SaveIndicator() {
  const label = () => {
    const s = saveState();
    switch (s.kind) {
      case "saved":
        return "Opgeslagen";
      case "dirty":
        return "Wijzigingen…";
      case "saving":
        return "Opslaan…";
      case "error":
        return "Niet opgeslagen";
    }
  };
  const title = () => {
    const s = saveState();
    return s.kind === "error" ? s.message : inTauri ? "Opslag via Rust" : "Opslag in de browser (localStorage)";
  };
  return (
    <span class={`save-state ${saveState().kind}`} title={title()}>
      <span class="dot" />
      {label()}
    </span>
  );
}

const fmtDate = (ms: number) =>
  ms ? new Date(ms).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

const EXPORTS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "svg", label: "SVG", hint: "Vectorafbeelding" },
  { format: "png", label: "PNG", hint: "Afbeelding" },
  { format: "mermaid", label: "Mermaid", hint: "Tekst voor README's" },
];

export function TopBar() {
  return (
    <header class="topbar">
      <div class="topbar-left panel">
        <span class="logo" aria-hidden="true" />
        <input
          class="board-name"
          value={board.name}
          aria-label="Naam van het bord"
          size={Math.max(8, board.name.length)}
          onChange={(e) => renameBoard(e.currentTarget.value.trim() || "Naamloos bord")}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
        />
        <Menu
          button={(toggle) => (
            <button
              class="icon-btn"
              title="Borden"
              onClick={() => {
                refreshBoards();
                toggle();
              }}
            >
              <IconChevron />
            </button>
          )}
        >
          {(close) => (
            <>
              <div class="menu-title">Borden</div>
              <For each={boards()} fallback={<div class="menu-empty">Nog geen opgeslagen borden</div>}>
                {(b) => (
                  <div class="menu-row" classList={{ current: b.id === board.id }}>
                    <button
                      class="menu-item"
                      onClick={() => {
                        openBoard(b.id);
                        close();
                      }}
                    >
                      <span>{b.name}</span>
                      <small>{fmtDate(b.updatedAt)}</small>
                    </button>
                    <button
                      class="icon-btn danger small"
                      title="Bord verwijderen"
                      onClick={() => {
                        if (confirm(`"${b.name}" verwijderen?`)) removeBoard(b.id);
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                )}
              </For>
              <div class="menu-sep" />
              <button
                class="menu-item"
                onClick={() => {
                  newBoard();
                  close();
                }}
              >
                <span class="with-icon">
                  <IconPlus /> Nieuw bord
                </span>
              </button>
            </>
          )}
        </Menu>
        <SaveIndicator />
      </div>

      <div class="topbar-right panel">
        <button class="icon-btn" title="Ongedaan maken (Ctrl+Z)" disabled={!canUndo()} onClick={undo}>
          <IconUndo />
        </button>
        <button class="icon-btn" title="Opnieuw (Ctrl+Shift+Z)" disabled={!canRedo()} onClick={redo}>
          <IconRedo />
        </button>
        <span class="divider" />
        <button class="text-btn" title="Automatisch ordenen (Rust)" onClick={runAutoLayout}>
          <IconLayout />
          <span>Ordenen</span>
        </button>
        <Menu
          align="right"
          button={(toggle) => (
            <button class="text-btn primary" onClick={toggle}>
              <IconExport />
              <span>Exporteren</span>
            </button>
          )}
        >
          {(close) => (
            <For each={EXPORTS}>
              {(x) => (
                <button
                  class="menu-item"
                  onClick={() => {
                    runExport(x.format);
                    close();
                  }}
                >
                  <span>{x.label}</span>
                  <small>{x.hint}</small>
                </button>
              )}
            </For>
          )}
        </Menu>
      </div>
    </header>
  );
}
