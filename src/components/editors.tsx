// The editor for each document kind, plus the project page.

import { roleCanEdit } from "../lib/roles";
import { CommentsPanel } from "./Comments";
import { createSignal, For, onCleanup, Show } from "solid-js";
import type { DocumentKind } from "../lib/types";
import {
  docsOf,
  openDocument,
  openDoc,
  projectById,
  setText,
  text,
  updateProject,
} from "../lib/workspace";
import { Canvas } from "./Canvas";
import { EerEditor } from "./EerEditor";
import { KanbanEditor } from "./KanbanEditor";
import { BoardIcon, KIND_LABEL, KindIcon, TypeIcon } from "./kinds";
import { BOARD_TYPES, boardTypeOf, type BoardType, type BoardTypeId } from "../lib/boardTypes";
import { NewBoardDialog } from "./BoardDialogs";
import { MarkdownView, onMarkdownKeyDown } from "./Markdown";
import { RichTextEditor } from "./RichTextEditor";
import { Toolbar } from "./Toolbar";
import { canEdit } from "../lib/access";
import { me } from "../lib/auth";
import { colorFor, textDoc } from "../lib/collab";
import { guest } from "../lib/comments";
import { MembersDialog } from "./ShareDialog";
import { ZoomControls } from "./ZoomControls";
import { ClassPanel } from "./ClassPanel";
import { FindBar, Minimap } from "./FindAndMap";

export function FlowEditor() {
  return (
    <>
      <Canvas />
      <Show when={canEdit()}>
        <Toolbar />
      </Show>
      <ZoomControls />
      <Minimap />
      <FindBar />
      <ClassPanel />
    </>
  );
}

/**
 * Text document: a full-page WYSIWYG editor. Keyed on the document id, so
 * every document gets a fresh editor with its own undo history.
 */
export function TextEditor() {
  return (
    <div class="text-editor">
      {/* Again for each document, and when editing together starts or stops */}
      <Show when={`${openDoc()?.id}|${textDoc() ? "live" : "local"}`} keyed>
        <RichTextEditor
          variant="page"
          value={text()}
          placeholder="Start writing… Type # for a heading, - for a list or [ ] for a checklist."
          onChange={setText}
          readOnly={!canEdit()}
          collab={(() => {
            const t = textDoc();
            if (!t) return undefined;
            const id = me()?.user.id ?? guest()?.id ?? "guest";
            return { ...t, user: { name: me()?.user.name ?? guest()?.name ?? "Guest", color: colorFor(id) } };
          })()}
        />
      </Show>
    </div>
  );
}

/** Placeholder for document kinds whose editor has not been built yet. */
export function ComingSoon(p: { kind: DocumentKind }) {
  return (
    <div class="coming-soon">
      <div class="coming-soon-card panel">
        <KindIcon kind={p.kind} />
        <h2>{KIND_LABEL[p.kind]} editor coming soon</h2>
        <p>This document already exists and is saved normally; only its editor has not been built yet.</p>
      </div>
    </div>
  );
}

/** Project page: name, description, and quick access to documents. */
export function ProjectView(p: { projectId: string }) {
  const project = () => projectById(p.projectId);

  // Keep the description draft locally and save once typing pauses.
  const [draft, setDraft] = createSignal<string | null>(null);
  const [editingDescription, setEditingDescription] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    const d = draft();
    if (d !== null) updateProject(p.projectId, { description: d });
    setDraft(null);
  };
  onCleanup(flush);

  /** Boards per type, for the "New in this project" cards */
  const counts = () => {
    const c: Partial<Record<BoardTypeId, number>> = {};
    for (const d of docsOf(p.projectId)) {
      const t = boardTypeOf(d.kind, d.diagram).id;
      c[t] = (c[t] ?? 0) + 1;
    }
    return c;
  };
  const [newType, setNewType] = createSignal<BoardType | null>(null);

  // Viewers and commenters of the project only read its name and description
  const editable = () => {
    const role = project()?.role;
    return roleCanEdit(role);
  };
  const [people, setPeople] = createSignal(false);

  return (
    <Show when={project()}>
      {(proj) => (
        <div class="project-view">
          <div class="project-title-row">
            <input
              class="project-title"
              value={proj().name}
              aria-label="Project name"
              readOnly={!editable()}
              onChange={(e) => updateProject(p.projectId, { name: e.currentTarget.value })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <Show when={proj().role}>
              <button class="text-btn share-btn" onClick={() => setPeople(true)}>
                People
              </button>
            </Show>
          </div>
          <Show when={people()}>
            <MembersDialog projectId={p.projectId} onClose={() => setPeople(false)} />
          </Show>
          {/* Shown rendered; click to edit. An empty description shows the textarea directly. */}
          <Show
            when={editable() && (editingDescription() || !(draft() ?? proj().description).trim())}
            fallback={
              <div
                class="project-description rendered"
                title="Click to edit"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a") || !editable()) return;
                  setEditingDescription(true);
                }}
              >
                <MarkdownView text={proj().description} />
              </div>
            }
          >
            <textarea
              ref={(el) => editingDescription() && queueMicrotask(() => el.focus())}
              class="project-description"
              value={draft() ?? proj().description}
              placeholder="Describe the project… (markdown)"
              onInput={(e) => {
                setDraft(e.currentTarget.value);
                clearTimeout(timer);
                timer = setTimeout(flush, 600);
              }}
              onKeyDown={onMarkdownKeyDown}
              onFocus={() => setEditingDescription(true)}
              onBlur={() => {
                flush();
                setEditingDescription(false);
              }}
            />
          </Show>

          <h3 class="section-title">New in this project</h3>
          <div class="new-doc-grid">
            <For each={BOARD_TYPES}>
              {(t) => (
                <button class="new-doc panel" title={t.description} onClick={() => setNewType(t)}>
                  <TypeIcon type={t.id} />
                  <span>{t.label}</span>
                  <small>{counts()[t.id] ?? 0} in project</small>
                </button>
              )}
            </For>
          </div>
          <Show when={newType()}>
            {(t) => <NewBoardDialog projectId={p.projectId} folderId={null} type={t()} onClose={() => setNewType(null)} />}
          </Show>

          <Show when={docsOf(p.projectId).length}>
            <h3 class="section-title">Recently edited</h3>
            <div class="recent-list">
              <For each={[...docsOf(p.projectId)].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6)}>
                {(d) => (
                  <button class="recent-item" onClick={() => openDocument(d.projectId, d.id)}>
                    <BoardIcon kind={d.kind} diagram={d.diagram} />
                    <span>{d.name}</span>
                    <small>{d.updatedAt ? new Date(d.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</small>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

/** The main area when a document is open. */
export function DocumentEditor() {
  return (
    <Show when={openDoc()}>
      {(doc) => (
        <div class="editor" classList={{ "editor-canvas": doc().kind === "flow" }}>
          <Show when={doc().kind === "flow"}>
            <FlowEditor />
          </Show>
          <Show when={doc().kind === "text"}>
            <TextEditor />
          </Show>
          <Show when={doc().kind === "kanban"}>
            <KanbanEditor />
          </Show>
          <Show when={doc().kind === "eer"}>
            <EerEditor />
            <Minimap />
            <FindBar />
          </Show>
          <CommentsPanel />
        </div>
      )}
    </Show>
  );
}
