// Header above an open document: breadcrumb (project / folders / document),
// editable name, save status, and actions for the document kind.

import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { codeFlow, codeImport, diagramImport, setBarFold, setCodeFlow, setCodeImport, setDiagramImport, setSqlImport, sqlImport } from "../lib/topActions";
import { canRedoEer, canUndoEer, redoEer, undoEer } from "../lib/eer";
import { DIALECTS, SqlDialog, type SchemaFormat } from "./SqlDialog";
import { board, canRedo, canUndo, redo, undo } from "../lib/store";
import { CodeDialog, LANGUAGES } from "./CodeDialog";
import { MermaidDialog } from "./MermaidDialog";
import { currentFlowType } from "./Toolbar";
import { SqlImportDialog } from "./SqlImportDialog";
import { CodeImportDialog } from "./CodeImportDialog";
import { DiagramImportDialog } from "./DiagramImportDialog";
import { CodeFlowDialog } from "./CodeFlowDialog";
import { DesignChecks } from "./DesignChecks";
import { setAccessOpen } from "./ShareDialog";
import { CardLinksMenu } from "./CardLinksMenu";
import type { CodeLanguage, ExportFormat, Folder } from "../lib/types";
import {
  openDoc,
  openProject,
  projectById,
  renameDocument,
  runAutoLayout,
  runExport,
  saveState,
} from "../lib/workspace";
import { IconExport, IconImport, IconLayout, IconRedo, IconUndo } from "./icons";
import { BoardIcon } from "./kinds";
import { canEdit, ROLE_LABEL } from "../lib/access";
import { ShareActions } from "./ShareDialog";
import { Menu } from "./Menu";

export function SaveIndicator() {
  const label = () => {
    const s = saveState();
    switch (s.kind) {
      case "saved":
        return "Saved";
      case "dirty":
        return "Unsaved changes";
      case "saving":
        return "Saving…";
      case "error":
        return "Not saved";
      case "offline":
        return "Offline: kept here";
    }
  };
  const title = () => {
    const s = saveState();
    return s.kind === "error" ? s.message : s.kind === "offline" ? "No connection: your changes are kept on this device and saved when it is back" : "Saved on the server";
  };
  return (
    <span class={`save-state ${saveState().kind}`} title={title()}>
      <span class="dot" />
      {label()}
    </span>
  );
}

const EXPORTS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "svg", label: "SVG", hint: "Vector image" },
  { format: "png", label: "PNG", hint: "Image" },
  { format: "pdf", label: "PDF", hint: "To print or send, text stays sharp" },
  { format: "mermaid", label: "Mermaid", hint: "Text for READMEs, per diagram" },
];

/** Folders from the root down to and including `folderId`. */
function folderPath(folders: Folder[], folderId: string | null): Folder[] {
  const path: Folder[] = [];
  let current = folderId;
  while (current) {
    const f = folders.find((x) => x.id === current);
    if (!f) break;
    path.unshift(f);
    current = f.parentId;
  }
  return path;
}

// The Mermaid preview, for a flowchart or an EER diagram
const [mermaidOpen, setMermaidOpen] = createSignal(false);

/** Undo/redo, SQL import and SQL export for an EER diagram. */
function EerActions() {
  const [preview, setPreview] = createSignal<SchemaFormat | null>(null);
  return (
    <div class="header-actions">
      <Show when={canEdit()}>
        <button class="icon-btn hdr-undo" title="Undo (Ctrl+Z)" disabled={!canUndoEer()} onClick={undoEer}>
          <IconUndo />
        </button>
        <button class="icon-btn hdr-undo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedoEer()} onClick={redoEer}>
          <IconRedo />
        </button>
        <span class="divider hdr-undo" />
        <button class="text-btn hdr-import" title="Add tables from a SQL script or DBML (dbdiagram.io)" onClick={() => setSqlImport(true)}>
          <IconImport />
          <span>Import SQL / DBML</span>
        </button>
      </Show>
      <Menu
        align="right"
        button={(toggle) => (
          <button class="text-btn primary" onClick={toggle}>
            <IconExport />
            <span>Export</span>
          </button>
        )}
      >
        {(close) => (
          <>
            <div class="menu-title">SQL for</div>
            <For each={DIALECTS}>
              {(d) => (
                <button
                  class="menu-item"
                  onClick={() => {
                    setPreview(d.value);
                    close();
                  }}
                >
                  <span>{d.label}</span>
                  <small>.sql</small>
                </button>
              )}
            </For>
            <div class="menu-sep" />
            <button
              class="menu-item"
              onClick={() => {
                setPreview("dbml");
                close();
              }}
            >
              <span>DBML</span>
              <small>dbdiagram.io and others</small>
            </button>
            <button
              class="menu-item"
              onClick={() => {
                setMermaidOpen(true);
                close();
              }}
            >
              <span>Mermaid</span>
              <small>ER diagram as text</small>
            </button>
          </>
        )}
      </Menu>
      <Show when={preview()}>{(d) => <SqlDialog initial={d()} onClose={() => setPreview(null)} />}</Show>
      <Show when={mermaidOpen()}>
        <MermaidDialog onClose={() => setMermaidOpen(false)} />
      </Show>
      <Show when={sqlImport()}>
        <SqlImportDialog onClose={() => setSqlImport(false)} />
      </Show>
    </div>
  );
}

const [codePreview, setCodePreview] = createSignal<CodeLanguage | null>(null);

/** Removes the fold classes, then adds them up to `level` (each level hides more, see topActions.ts) */
function setFoldClasses(header: HTMLElement, level: number) {
  for (let l = 1; l <= MAX_FOLD; l++) header.classList.toggle(`fold-${l}`, l <= level);
}
const MAX_FOLD = 6;

/** Folds the bar as little as possible so that it fits (measured: what fits depends on the board and the window) */
function fitBar(header: HTMLElement) {
  let level = 0;
  for (; level <= MAX_FOLD; level++) {
    setFoldClasses(header, level);
    if (header.scrollWidth <= header.clientWidth + 1) break;
  }
  setBarFold(Math.min(level, MAX_FOLD));
}

export function TopBar() {
  let observer: ResizeObserver | undefined;
  let changes: MutationObserver | undefined;
  onCleanup(() => {
    observer?.disconnect();
    changes?.disconnect();
  });
  // Measured again when the window changes size, and when the bar's content does
  // (its text, a button more or less: folded, the bar's parts keep their size, so
  // only measuring again shows that it fits unfolded again)
  const watch = (header: HTMLElement) => {
    observer?.disconnect();
    changes?.disconnect();
    let queued = false;
    const later = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fitBar(header);
      });
    };
    observer = new ResizeObserver(later);
    observer.observe(header);
    changes = new MutationObserver(later);
    changes.observe(header, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(later);
    later();
  };
  createEffect(on([() => openDoc()?.id, () => openDoc()?.name, () => board.diagram, () => canEdit()], () => {
    const header = document.querySelector<HTMLElement>(".doc-header");
    if (header) requestAnimationFrame(() => fitBar(header));
  }));
  return (
    <Show when={openDoc()}>
      {(doc) => {
        const project = () => projectById(doc().projectId);
        return (
          <header class="doc-header" ref={watch}>
            <div class="crumbs">
              <button class="crumb" onClick={() => openProject(doc().projectId)}>
                {project()?.name ?? "Project"}
              </button>
              <For each={folderPath(project()?.folders ?? [], doc().folderId)}>
                {(f) => (
                  <>
                    <span class="crumb-sep">/</span>
                    <span class="crumb muted">{f.name}</span>
                  </>
                )}
              </For>
              <span class="crumb-sep">/</span>
              <BoardIcon kind={doc().kind} diagram={doc().kind === "flow" ? board.diagram : undefined} />
              <input
                class="doc-name"
                value={doc().name}
                aria-label="Document name"
                readOnly={!canEdit()}
                size={Math.max(6, doc().name.length)}
                onChange={(e) => renameDocument(doc().projectId, doc().id, e.currentTarget.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                }}
              />
              <Show
                when={canEdit()}
                fallback={
                  <button class="role-chip" title="What you can do here, and who else has access" onClick={() => setAccessOpen(true)}>
                    {ROLE_LABEL[doc().role]}
                  </button>
                }
              >
                <SaveIndicator />
              </Show>
            </div>

            {/* Cards about this whole document (a board links its own cards from the card dialog) */}
            <Show when={doc().kind !== "kanban" && canEdit()}>
              <div class="header-actions header-cards">
                <CardLinksMenu nodeId={null} />
              </div>
            </Show>
            <ShareActions />
            <Show when={doc().kind === "eer"}>
              <EerActions />
            </Show>
            {/* A chart: its drawing as an image */}
            <Show when={doc().kind === "chart"}>
              <div class="header-actions">
                <Menu
                  align="right"
                  button={(toggle) => (
                    <button class="text-btn primary" onClick={toggle}>
                      <IconExport />
                      <span>Export</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <For each={EXPORTS.filter((x) => x.format !== "mermaid")}>
                      {(x) => (
                        <button
                          class="menu-item"
                          onClick={() => {
                            void runExport(x.format);
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
            </Show>
            <Show when={doc().kind === "flow"}>
              <div class="header-actions">
                <Show when={canEdit()}>
                  <button class="icon-btn hdr-undo" title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={undo}>
                    <IconUndo />
                  </button>
                  <button class="icon-btn hdr-undo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo()} onClick={redo}>
                    <IconRedo />
                  </button>
                  <span class="divider hdr-undo" />
                  <DesignChecks />
                  <button class="text-btn hdr-arrange" title="Arrange automatically" onClick={runAutoLayout}>
                    <IconLayout />
                    <span>Arrange</span>
                  </button>
                  <Menu
                    align="right"
                    button={(toggle) => (
                      <button class="text-btn hdr-import" title="Add a diagram from Mermaid, draw.io or Excalidraw, classes from code, or an activity from a codebase" onClick={toggle}>
                        <IconImport />
                        <span>Import</span>
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <button
                          class="menu-item"
                          onClick={() => {
                            setDiagramImport(true);
                            close();
                          }}
                        >
                          <span>Diagram…</span>
                          <small>Mermaid, draw.io, Excalidraw</small>
                        </button>
                        <Show when={currentFlowType().code || board.nodes.some((n) => n.kind === "class")}>
                          <button
                            class="menu-item"
                            onClick={() => {
                              setCodeImport(true);
                              close();
                            }}
                          >
                            <span>Classes from code…</span>
                            <small>TypeScript, Java, C#, Python, Kotlin, Rust, Go</small>
                          </button>
                        </Show>
                        <Show when={["activity", "flowchart", "whiteboard"].includes(currentFlowType().id)}>
                          <button
                            class="menu-item"
                            onClick={() => {
                              setCodeFlow(true);
                              close();
                            }}
                          >
                            <span>Activity from a codebase…</span>
                            <small>A folder or git repository</small>
                          </button>
                        </Show>
                      </>
                    )}
                  </Menu>
                </Show>
                <Menu
                  align="right"
                  button={(toggle) => (
                    <button class="text-btn primary" onClick={toggle}>
                      <IconExport />
                      <span>Export</span>
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <For each={EXPORTS}>
                        {(x) => (
                          <button
                            class="menu-item"
                            onClick={() => {
                              // Mermaid first shows a preview, with a tab per diagram
                              if (x.format === "mermaid") setMermaidOpen(true);
                              else runExport(x.format);
                              close();
                            }}
                          >
                            <span>{x.label}</span>
                            <small>{x.hint}</small>
                          </button>
                        )}
                      </For>
                      {/* Code, when there are UML classes */}
                      <Show when={board.nodes.some((n) => n.kind === "class")}>
                        <div class="menu-sep" />
                        <div class="menu-title">Class diagram as code</div>
                        {/* The board's language first */}
                        <For each={[...LANGUAGES].sort((a, b) => Number(b.value === board.codeLanguage) - Number(a.value === board.codeLanguage))}>
                          {(l) => (
                            <button
                              class="menu-item"
                              onClick={() => {
                                setCodePreview(l.value);
                                close();
                              }}
                            >
                              <span>{l.label}</span>
                              <small>{l.value === board.codeLanguage ? "this board" : l.hint}</small>
                            </button>
                          )}
                        </For>
                      </Show>
                    </>
                  )}
                </Menu>
                <Show when={codePreview()}>
                  {(l) => <CodeDialog initial={l()} onClose={() => setCodePreview(null)} />}
                </Show>
                <Show when={mermaidOpen()}>
                  <MermaidDialog onClose={() => setMermaidOpen(false)} />
                </Show>
                <Show when={codeImport()}>
                  <CodeImportDialog onClose={() => setCodeImport(false)} />
                </Show>
                <Show when={diagramImport()}>
                  <DiagramImportDialog onClose={() => setDiagramImport(false)} />
                </Show>
                <Show when={codeFlow()}>
                  <CodeFlowDialog onClose={() => setCodeFlow(false)} />
                </Show>
              </div>
            </Show>
          </header>
        );
      }}
    </Show>
  );
}
