// Sidebar: a collapsible tree of projects → folders → documents.
// Double-click to rename, drag to move, and use the + on a project or folder to add items.

import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import type { DocumentKind, DocumentMeta, Folder, Project } from "../lib/types";
import {
  createDocument,
  createFolder,
  createProject,
  deleteDocument,
  deleteFolder,
  deleteProject,
  docsOf,
  moveDocument,
  moveFolder,
  openDocument,
  openProject,
  projectById,
  projects,
  renameDocument,
  renameFolder,
  updateProject,
  view,
} from "../lib/workspace";
import { IconChevronRight, IconFolder, IconNewFolder, IconPlus, IconProject, IconTrash } from "./icons";
import { KIND_LABEL, KINDS, KindIcon } from "./kinds";
import { Menu } from "./Menu";
import { TimerIndicator } from "./TimerIndicator";

// ---------- sidebar UI state (local only, not saved to the backend) ----------

const COLLAPSED_KEY = "flowapp:collapsed";

function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

const [collapsed, setCollapsed] = createSignal(loadCollapsed());
const isOpen = (id: string) => !collapsed().has(id);

function toggle(id: string, open?: boolean) {
  const next = new Set(collapsed());
  const shouldOpen = open ?? next.has(id);
  if (shouldOpen) next.delete(id);
  else next.add(id);
  setCollapsed(next);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
}

/** Id of the item being renamed (project, folder or document). */
const [renaming, setRenaming] = createSignal<string | null>(null);
/** Id of the item whose delete button was clicked once and awaits confirmation. */
const [confirming, setConfirming] = createSignal<string | null>(null);
let confirmTimer: ReturnType<typeof setTimeout> | undefined;

function askConfirm(id: string) {
  setConfirming(id);
  clearTimeout(confirmTimer);
  confirmTimer = setTimeout(() => setConfirming(null), 3000);
}

// ---------- drag and drop ----------

type DragItem = { type: "doc" | "folder"; projectId: string; id: string };
let dragging: DragItem | null = null;
/**
 * Where the dragged item would land, for the highlight.
 * `into` = inside a project/folder, `before`/`after` = above or below a document.
 */
type DropPos = "into" | "before" | "after";
const [dropTarget, setDropTarget] = createSignal<{ key: string; pos: DropPos } | null>(null);

/** Is `folderId` the same as `ancestorId`, or nested inside it at any depth? */
function isInside(project: Project, folderId: string | null, ancestorId: string): boolean {
  let current = folderId;
  while (current) {
    if (current === ancestorId) return true;
    current = project.folders.find((f) => f.id === current)?.parentId ?? null;
  }
  return false;
}

const lastOrder = (xs: { order: number }[]) => xs.reduce((m, x) => Math.max(m, x.order), 0) + 1;

/**
 * Handles a drop. `targetFolder` is where the item goes (`null` = project root);
 * `near` is set when dropped onto a document, to place it above or below that one.
 */
function drop(
  projectId: string,
  targetFolder: string | null,
  near?: { doc: DocumentMeta; pos: DropPos },
) {
  const item = dragging;
  dragging = null;
  setDropTarget(null);
  if (!item || item.projectId !== projectId) return;
  if (near?.doc.id === item.id) return; // dropped onto itself
  const project = projectById(projectId);
  if (!project) return;

  if (item.type === "folder") {
    if (isInside(project, targetFolder, item.id)) return; // not into its own subtree
    const siblings = project.folders.filter((f) => f.parentId === targetFolder && f.id !== item.id);
    moveFolder(projectId, item.id, targetFolder, lastOrder(siblings));
    if (targetFolder) toggle(targetFolder, true);
    return;
  }

  const siblings = docsOf(projectId)
    .filter((d) => d.folderId === targetFolder && d.id !== item.id)
    .sort((a, b) => a.order - b.order);
  let order = lastOrder(siblings);
  if (near) {
    // Halfway between the target and its neighbour on that side (or target ± 1 at the ends).
    const i = siblings.findIndex((d) => d.id === near.doc.id);
    if (near.pos === "after") {
      const next = siblings[i + 1]?.order ?? near.doc.order + 1;
      order = (near.doc.order + next) / 2;
    } else {
      const prev = siblings[i - 1]?.order ?? near.doc.order - 1;
      order = (prev + near.doc.order) / 2;
    }
  }
  moveDocument(projectId, item.id, targetFolder, order);
  if (targetFolder) toggle(targetFolder, true);
}

/**
 * Props for a row that accepts drops.
 * With `around`, the top half of the row means "before" and the bottom half
 * "after"; otherwise the item goes into the row (a project or folder).
 */
function dropProps(key: string, projectId: string, around: boolean, onDrop: (pos: DropPos) => void) {
  const posOf = (e: DragEvent): DropPos => {
    if (!around) return "into";
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? "before" : "after";
  };
  return {
    onDragOver: (e: DragEvent) => {
      if (!dragging || dragging.projectId !== projectId) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = posOf(e);
      const cur = dropTarget();
      if (cur?.key !== key || cur.pos !== pos) setDropTarget({ key, pos });
    },
    onDragLeave: () => dropTarget()?.key === key && setDropTarget(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDrop(posOf(e));
    },
  };
}

function dragProps(item: DragItem) {
  return {
    // A getter, so Solid re-reads it when `renaming` changes
    get draggable() {
      return renaming() !== item.id;
    },
    onDragStart: (e: DragEvent) => {
      dragging = item;
      e.dataTransfer?.setData("text/plain", item.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      dragging = null;
      setDropTarget(null);
    },
  };
}

// ---------- components ----------

export function Sidebar() {
  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <span class="logo" aria-hidden="true" />
        <span class="app-name">Flow</span>
        <button
          class="icon-btn small"
          title="New project"
          onClick={async () => {
            const id = await createProject();
            if (id) setRenaming(id);
          }}
        >
          <IconPlus />
        </button>
      </div>
      <nav class="tree" aria-label="Projects">
        <For each={projects()} fallback={<p class="tree-empty">No projects yet</p>}>
          {(p) => <ProjectNode project={p} />}
        </For>
      </nav>
      <TimerIndicator />
    </aside>
  );
}

function ProjectNode(p: { project: Project }) {
  const id = () => p.project.id;
  const active = () => {
    const v = view();
    return v.type === "project" && v.projectId === id();
  };
  return (
    <div class="tree-group">
      <Row
        key={id()}
        depth={0}
        active={active()}
        open={isOpen(id())}
        onToggle={() => toggle(id())}
        onClick={() => openProject(id())}
        icon={<IconProject />}
        name={p.project.name}
        strong
        onRename={(name) => updateProject(id(), { name })}
        drop={dropProps(id(), id(), false, () => drop(id(), null))}
        actions={
          <>
            <AddMenu projectId={id()} folderId={null} />
            <DeleteButton id={id()} title="Delete project" onConfirm={() => deleteProject(id())} />
          </>
        }
      />
      <Show when={isOpen(id())}>
        <Level project={p.project} parentId={null} depth={1} />
      </Show>
    </div>
  );
}

/** All folders and documents directly inside one parent (a folder or the project root). */
function Level(p: { project: Project; parentId: string | null; depth: number }) {
  const folders = () =>
    p.project.folders.filter((f) => f.parentId === p.parentId).sort((a, b) => a.order - b.order);
  const docs = () =>
    docsOf(p.project.id)
      .filter((d) => d.folderId === p.parentId)
      .sort((a, b) => a.order - b.order);
  return (
    <>
      <For each={folders()}>{(f) => <FolderNode project={p.project} folder={f} depth={p.depth} />}</For>
      <For each={docs()}>{(d) => <DocNode doc={d} depth={p.depth} />}</For>
      <Show when={!folders().length && !docs().length && p.depth > 0}>
        <p class="tree-empty" style={{ "padding-left": `${p.depth * 14 + 30}px` }}>
          Empty
        </p>
      </Show>
    </>
  );
}

function FolderNode(p: { project: Project; folder: Folder; depth: number }) {
  const id = () => p.folder.id;
  const pid = () => p.project.id;
  return (
    <div class="tree-group">
      <Row
        key={id()}
        depth={p.depth}
        open={isOpen(id())}
        onToggle={() => toggle(id())}
        onClick={() => toggle(id())}
        icon={<IconFolder />}
        name={p.folder.name}
        onRename={(name) => renameFolder(pid(), id(), name)}
        drag={dragProps({ type: "folder", projectId: pid(), id: id() })}
        drop={dropProps(id(), pid(), false, () => drop(pid(), id()))}
        actions={
          <>
            <AddMenu projectId={pid()} folderId={id()} />
            <DeleteButton
              id={id()}
              title="Delete folder (its contents move up one level)"
              onConfirm={() => deleteFolder(pid(), id())}
            />
          </>
        }
      />
      <Show when={isOpen(id())}>
        <Level project={p.project} parentId={id()} depth={p.depth + 1} />
      </Show>
    </div>
  );
}

function DocNode(p: { doc: DocumentMeta; depth: number }) {
  const active = () => {
    const v = view();
    return v.type === "doc" && v.docId === p.doc.id;
  };
  return (
    <Row
      key={p.doc.id}
      depth={p.depth}
      active={active()}
      onClick={() => openDocument(p.doc.projectId, p.doc.id)}
      icon={<KindIcon kind={p.doc.kind} />}
      name={p.doc.name}
      title={KIND_LABEL[p.doc.kind]}
      onRename={(name) => renameDocument(p.doc.projectId, p.doc.id, name)}
      drag={dragProps({ type: "doc", projectId: p.doc.projectId, id: p.doc.id })}
      drop={dropProps(p.doc.id, p.doc.projectId, true, (pos) =>
        drop(p.doc.projectId, p.doc.folderId, { doc: p.doc, pos }),
      )}
      actions={
        <DeleteButton
          id={p.doc.id}
          title="Delete document"
          onConfirm={() => deleteDocument(p.doc.projectId, p.doc.id)}
        />
      }
    />
  );
}

/** One row in the tree. */
function Row(p: {
  key: string;
  depth: number;
  name: string;
  icon: JSX.Element;
  title?: string;
  strong?: boolean;
  active?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  onRename: (name: string) => void;
  actions?: JSX.Element;
  drag?: ReturnType<typeof dragProps>;
  drop?: ReturnType<typeof dropProps>;
}) {
  const editing = () => renaming() === p.key;
  return (
    <div
      class="tree-row"
      classList={{
        active: p.active,
        strong: p.strong,
        "drop-target": dropTarget()?.key === p.key && dropTarget()?.pos === "into",
        "drop-before": dropTarget()?.key === p.key && dropTarget()?.pos === "before",
        "drop-after": dropTarget()?.key === p.key && dropTarget()?.pos === "after",
        confirming: confirming() === p.key,
      }}
      style={{ "padding-left": `${p.depth * 14 + 6}px` }}
      title={p.title}
      onClick={() => !editing() && p.onClick()}
      onDblClick={(e) => {
        e.stopPropagation();
        setRenaming(p.key);
      }}
      {...p.drag}
      {...p.drop}
    >
      <Show when={p.onToggle} fallback={<span class="twisty-space" />}>
        <button
          class="twisty"
          classList={{ open: p.open }}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            p.onToggle?.();
          }}
        >
          <IconChevronRight />
        </button>
      </Show>
      <span class="row-icon">{p.icon}</span>
      <Show when={editing()} fallback={<span class="row-name">{p.name}</span>}>
        <RenameInput
          value={p.name}
          onDone={(name) => {
            setRenaming(null);
            if (name !== null && name.trim() && name !== p.name) p.onRename(name);
          }}
        />
      </Show>
      <span class="row-actions" onClick={(e) => e.stopPropagation()}>
        {p.actions}
      </span>
    </div>
  );
}

function RenameInput(p: { value: string; onDone: (name: string | null) => void }) {
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
      class="rename-input"
      value={p.value}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(ref.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(ref.value);
        if (e.key === "Escape") finish(null);
      }}
    />
  );
}

/** The + menu: add a folder or document to a project or folder. */
function AddMenu(p: { projectId: string; folderId: string | null }) {
  // Expand the parent so the new item is visible, then start renaming it.
  const expand = () => toggle(p.folderId ?? p.projectId, true);
  const addFolder = async () => {
    expand();
    const id = await createFolder(p.projectId, p.folderId);
    if (id) setRenaming(id);
  };
  const addDocument = async (kind: DocumentKind) => {
    expand();
    const id = await createDocument(p.projectId, p.folderId, kind);
    if (id) setRenaming(id);
  };
  return (
    <Menu
      button={(toggleMenu, open) => (
        <button class="icon-btn small" classList={{ pressed: open() }} title="Add" onClick={toggleMenu}>
          <IconPlus />
        </button>
      )}
    >
      {(close) => (
        <>
          <button
            class="menu-item"
            onClick={() => {
              close();
              addFolder();
            }}
          >
            <span class="with-icon">
              <IconNewFolder /> New folder
            </span>
          </button>
          <div class="menu-sep" />
          <For each={KINDS}>
            {(kind) => (
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  addDocument(kind);
                }}
              >
                <span class="with-icon">
                  <KindIcon kind={kind} /> {KIND_LABEL[kind]}
                </span>
              </button>
            )}
          </For>
        </>
      )}
    </Menu>
  );
}

/** Delete button that asks for a second click to confirm (window.confirm does not work in Tauri). */
function DeleteButton(p: { id: string; title: string; onConfirm: () => void }) {
  return (
    <Show
      when={confirming() === p.id}
      fallback={
        <button class="icon-btn small danger" title={p.title} onClick={() => askConfirm(p.id)}>
          <IconTrash />
        </button>
      }
    >
      <button
        class="confirm-delete"
        onClick={() => {
          setConfirming(null);
          p.onConfirm();
        }}
      >
        Delete?
      </button>
    </Show>
  );
}
