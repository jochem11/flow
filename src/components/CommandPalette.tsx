// Quick open and commands (Cmd+K): boards and projects by name, boards by what
// is in them (the server searches blocks, cards, tables and text), and commands
// for what is open. Arrow keys and Enter, or the mouse.

import { createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { BOARD_TYPES, boardTypeOf } from "../lib/boardTypes";
import { canEdit } from "../lib/access";
import { recent } from "../lib/personal";
import { startPresenting } from "../lib/present";
import { get } from "../lib/server";
import { matchScore } from "../lib/match";
import { MOD } from "../lib/shortcuts";
import { board, setCallColors, setCodeLanguage } from "../lib/store";
import { LANGUAGES as CODE_LANGUAGES } from "./CodeDialog";
import { setTheme, THEME_NAMES, type Theme } from "../lib/theme";
import type { ExportFormat, SearchHit } from "../lib/types";
import {
  changeBoardType,
  createProject,
  docsOf,
  openDoc,
  openDocument,
  openProject,
  projectById,
  projects,
  runAutoLayout,
  runExport,
  view,
} from "../lib/workspace";
import { NewBoardDialog } from "./BoardDialogs";
import { openFind } from "./FindAndMap";
import { IconProject } from "./icons";
import { BoardIcon } from "./kinds";
import { Keys, openShortcuts } from "./Shortcuts";

const [open, setOpen] = createSignal(false);
export const openPalette = () => setOpen(true);

type Group = "Recent" | "Boards" | "Projects" | "Inside boards" | "Commands";
const ORDER: Group[] = ["Recent", "Boards", "Projects", "Inside boards", "Commands"];
const LIMIT: Record<Group, number> = { Recent: 6, Boards: 8, Projects: 5, "Inside boards": 8, Commands: 8 };

interface Item {
  key: string;
  group: Group;
  label: string;
  sub?: string;
  icon?: JSX.Element;
  keys?: string[];
  score: number;
  run: () => void;
}

/** The project new boards go into: the open one, else the first own one. */
function currentProjectId(): string | null {
  const doc = openDoc();
  if (doc) return doc.projectId;
  const v = view();
  if (v.type === "project") return v.projectId;
  return (projects().find((p) => !p.role || p.role === "owner") ?? projects()[0])?.id ?? null;
}

export function CommandPalette() {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const [newBoardIn, setNewBoardIn] = createSignal<string | null>(null);
  let input!: HTMLInputElement;
  let list!: HTMLDivElement;

  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const run = (item: Item) => {
    close();
    item.run();
  };

  // Searching inside boards: on the server, shortly after typing stops
  const [debounced, setDebounced] = createSignal("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(query, (q) => {
      clearTimeout(timer);
      timer = setTimeout(() => setDebounced(q.trim()), 200);
    }),
  );
  onCleanup(() => clearTimeout(timer));
  const [hits] = createResource(
    () => (open() && debounced().length >= 2 ? debounced() : null),
    (q) => get<SearchHit[]>(`/search?q=${encodeURIComponent(q)}`).catch(() => [] as SearchHit[]),
  );

  const commands = (): Omit<Item, "score" | "group">[] => {
    const doc = openDoc();
    const flow = doc?.kind === "flow";
    const edit = canEdit();
    const type = flow ? boardTypeOf("flow", board.diagram) : null;
    const out: Omit<Item, "score" | "group">[] = [];
    const project = currentProjectId();
    if (project) out.push({ key: "new-board", label: "New board…", sub: projectById(project)?.name, run: () => setNewBoardIn(project) });
    out.push({ key: "new-project", label: "New project", run: () => void createProject() });
    if (flow || doc?.kind === "eer") out.push({ key: "find", label: "Find on this board", keys: [MOD, "F"], run: openFind });
    if (doc?.kind === "chart") {
      for (const f of ["png", "svg"] as ExportFormat[]) out.push({ key: `export-${f}`, label: `Export as ${f.toUpperCase()}`, run: () => void runExport(f) });
    }
    if (flow) {
      for (const f of ["png", "svg"] as ExportFormat[]) out.push({ key: `export-${f}`, label: `Export as ${f.toUpperCase()}`, run: () => void runExport(f) });
      if (edit) out.push({ key: "arrange", label: "Arrange automatically", run: () => void runAutoLayout() });
      out.push({ key: "present", label: "Present", run: startPresenting });
      if (edit) {
        for (const t of BOARD_TYPES.filter((t) => t.kind === "flow" && t.id !== type?.id)) {
          out.push({ key: `type-${t.id}`, label: `Board type: ${t.label}`, run: () => void changeBoardType(t.diagram!) });
        }
        if (type?.id === "class" || type?.id === "whiteboard") {
          out.push({ key: "lang-uml", label: "Class types: UML (no language)", run: () => setCodeLanguage(null) });
          for (const l of CODE_LANGUAGES.filter((l) => l.value !== board.codeLanguage)) {
            out.push({ key: `lang-${l.value}`, label: `Class types: ${l.label}`, run: () => setCodeLanguage(l.value) });
          }
        }
        if (type?.id === "sequence" || type?.id === "whiteboard") {
          out.push({ key: "call-colors", label: board.callColors ? "Color calls: off" : "Color calls: on", run: () => setCallColors(!board.callColors) });
        }
      }
    }
    for (const t of ["light", "dark", "system"] as Theme[]) out.push({ key: `theme-${t}`, label: `Theme: ${THEME_NAMES[t]}`, run: () => setTheme(t) });
    out.push({ key: "shortcuts", label: "Keyboard shortcuts", keys: ["?"], run: openShortcuts });
    return out;
  };

  const items = createMemo((): Item[] => {
    if (!open()) return [];
    const q = query();
    const all: Item[] = [];
    const add = (group: Group, item: Omit<Item, "score" | "group">, text: string) => {
      const score = matchScore(text, q);
      if (score !== null) all.push({ ...item, group, score });
    };
    const boards = projects().flatMap((p) => docsOf(p.id).map((d) => ({ d, p })));
    if (!q.trim()) {
      // Nothing typed yet: the boards opened last, then the commands
      for (const r of recent()) {
        const found = boards.find((b) => b.d.id === r.documentId);
        if (!found) continue;
        add("Recent", { key: `r:${r.documentId}`, label: found.d.name, sub: found.p.name, icon: <BoardIcon kind={found.d.kind} diagram={found.d.diagram} />, run: () => void openDocument(found.p.id, found.d.id) }, "");
      }
    } else {
      for (const { d, p } of boards) {
        add("Boards", { key: `d:${d.id}`, label: d.name, sub: p.name, icon: <BoardIcon kind={d.kind} diagram={d.diagram} />, run: () => void openDocument(p.id, d.id) }, d.name);
      }
      for (const p of projects()) add("Projects", { key: `p:${p.id}`, label: p.name, icon: <IconProject />, run: () => void openProject(p.id) }, p.name);
      // Boards found by their content (not those already found by name)
      const byName = new Set(all.filter((i) => i.group === "Boards").map((i) => i.key.slice(2)));
      for (const h of hits() ?? []) {
        if (byName.has(h.documentId)) continue;
        all.push({
          key: `h:${h.documentId}`,
          group: "Inside boards",
          label: h.name,
          sub: h.snippet,
          icon: <BoardIcon kind={h.kind} diagram={h.diagram} />,
          score: 0,
          run: () => void openDocument(h.projectId, h.documentId),
        });
      }
    }
    for (const c of commands()) add("Commands", c, c.label);
    // Per group: the best first, at most LIMIT
    return ORDER.flatMap((g) => all.filter((i) => i.group === g).sort((a, b) => b.score - a.score).slice(0, LIMIT[g]));
  });

  // The first item again when the list changes; it stays in view while moving
  createEffect(on(items, () => setSelected(0)));
  createEffect(() => {
    const i = selected();
    list?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
  });
  createEffect(() => {
    if (open()) queueMicrotask(() => input?.focus());
  });

  const onKey = (e: KeyboardEvent) => {
    const n = items().length;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (n) setSelected((selected() + 1) % n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (n) setSelected((selected() - 1 + n) % n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items()[selected()];
      if (item) run(item);
    }
  };

  return (
    <>
      <Show when={open()}>
        <Portal>
          <div class="palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
            <div class="palette panel" role="dialog" aria-label="Quick open and commands">
              <input
                ref={input}
                class="palette-input"
                placeholder="Go to a board or project, search inside boards, or run a command…"
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={onKey}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
              />
              <div class="palette-list" id="palette-list" role="listbox" ref={list}>
                <For each={items()} fallback={<p class="palette-empty">{hits.loading ? "Searching…" : "Nothing found"}</p>}>
                  {(item, i) => (
                    <>
                      <Show when={i() === 0 || items()[i() - 1].group !== item.group}>
                        <div class="palette-group">{item.group}</div>
                      </Show>
                      <button
                        class="palette-item"
                        classList={{ selected: selected() === i() }}
                        data-index={i()}
                        role="option"
                        aria-selected={selected() === i()}
                        onPointerMove={() => setSelected(i())}
                        onClick={() => run(item)}
                      >
                        <span class="palette-icon">{item.icon}</span>
                        <span class="palette-label">{item.label}</span>
                        <Show when={item.sub}>
                          <small class="palette-sub">{item.sub}</small>
                        </Show>
                        <Show when={item.keys}>{(k) => <Keys keys={k()} />}</Show>
                      </button>
                    </>
                  )}
                </For>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
      <Show when={newBoardIn()}>
        {(projectId) => <NewBoardDialog projectId={projectId()} folderId={null} onClose={() => setNewBoardIn(null)} />}
      </Show>
    </>
  );
}
