// Header above an open document: breadcrumb (project / folders / document),
// editable name, save status, and actions for the document kind.

import { createSignal, For, Show } from "solid-js";
import { canRedoEer, canUndoEer, redoEer, undoEer } from "../lib/eer";
import { DIALECTS, SqlDialog, type SchemaFormat } from "./SqlDialog";
import { board, canRedo, canUndo, redo, undo } from "../lib/store";
import { MermaidDialog } from "./MermaidDialog";
import { SqlImportDialog } from "./SqlImportDialog";
import { DiagramImportDialog } from "./DiagramImportDialog";
import { DesignChecks } from "./DesignChecks";
import { setAccessOpen } from "./ShareDialog";
import { CardLinksMenu } from "./CardLinksMenu";
import type { ExportFormat, Folder } from "../lib/types";
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
  const [importing, setImporting] = createSignal(false);
  return (
    <div class="header-actions">
      <Show when={canEdit()}>
        <button class="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndoEer()} onClick={undoEer}>
          <IconUndo />
        </button>
        <button class="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedoEer()} onClick={redoEer}>
          <IconRedo />
        </button>
        <span class="divider" />
        <button class="text-btn" title="Add tables from a SQL script or DBML (dbdiagram.io)" onClick={() => setImporting(true)}>
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
      <Show when={importing()}>
        <SqlImportDialog onClose={() => setImporting(false)} />
      </Show>
    </div>
  );
}

const [diagramImport, setDiagramImport] = createSignal(false);

export function TopBar() {
  return (
    <Show when={openDoc()}>
      {(doc) => {
        const project = () => projectById(doc().projectId);
        return (
          <header class="doc-header">
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
                  <button class="icon-btn" title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={undo}>
                    <IconUndo />
                  </button>
                  <button class="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo()} onClick={redo}>
                    <IconRedo />
                  </button>
                  <span class="divider" />
                  <DesignChecks />
                  <button class="text-btn" title="Arrange automatically" onClick={runAutoLayout}>
                    <IconLayout />
                    <span>Arrange</span>
                  </button>
                  <button class="text-btn" title="Add a diagram from Mermaid, draw.io or Excalidraw" onClick={() => setDiagramImport(true)}>
                    <IconImport />
                    <span>Import</span>
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
                    </>
                  )}
                </Menu>
                <Show when={mermaidOpen()}>
                  <MermaidDialog onClose={() => setMermaidOpen(false)} />
                </Show>
                <Show when={diagramImport()}>
                  <DiagramImportDialog onClose={() => setDiagramImport(false)} />
                </Show>
              </div>
            </Show>
          </header>
        );
      }}
    </Show>
  );
}
