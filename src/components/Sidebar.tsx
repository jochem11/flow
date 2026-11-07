// Sidebar: a filter on top, then sections: Recent, Starred, My projects (a
// collapsible tree of projects → folders → boards), Shared with me, and Trash.
// Double-click to rename, drag to move, and use the + on a project or folder to add items.

import { roleCanEdit, roleOwns } from "../lib/roles";
import { createSignal, For, onMount, Show, type JSX } from "solid-js";
import type { DocumentMeta, Folder, Project } from "../lib/types";
import {
  createFolder,
  createProject,
  reloadProjects,
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
import { IconChevronRight, IconClose, IconFolder, IconNewFolder, IconPlus, IconProject, IconStar, IconTrash, IconUndo } from "./icons";
import { deleteForever, isStarred, recent, restoreItem, stars, toggleStar, trash } from "../lib/personal";
import { when } from "../lib/history";
import { errMsg } from "../lib/api";
import { toast } from "../lib/toast";
import { ConfirmButton } from "./ConfirmButton";
import type { DocumentKind, ItemKind, TrashItem } from "../lib/types";
import { BoardIcon } from "./kinds";
import { Menu } from "./Menu";
import { TimerIndicator } from "./TimerIndicator";
import { AccountMenu } from "./AccountMenu";
import { NewBoardDialog } from "./BoardDialogs";
import { boardTypeOf } from "../lib/boardTypes";
import { InboxButton } from "./InboxButton";

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
/** Open unless closed; while filtering everything is open, so what matches shows. */
const isOpen = (id: string) => filtering() || !collapsed().has(id);

function saveCollapsed(next: Set<string>) {
  setCollapsed(next);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
}

function toggle(id: string, open?: boolean) {
  const next = new Set(collapsed());
  const shouldOpen = open ?? next.has(id);
  if (shouldOpen) next.delete(id);
  else next.add(id);
  saveCollapsed(next);
}

// ---------- filter (the box and chips on top) ----------

const [query, setQuery] = createSignal("");
/** Only boards of this kind (null: all) */
const [kindFilter, setKindFilter] = createSignal<DocumentKind | null>(null);
const filtering = () => !!query().trim() || kindFilter() !== null;
const nameHit = (name: string) => name.toLowerCase().includes(query().trim().toLowerCase());
const docHit = (d: DocumentMeta) => (kindFilter() === null || d.kind === kindFilter()) && nameHit(d.name);
/** A project or folder whose own name matches shows all it holds (no kind chip on) */
const containerHit = (name: string) => kindFilter() === null && !!query().trim() && nameHit(name);

/** Whether a folder, or anything in it, matches. */
function folderHit(project: Project, folder: Folder): boolean {
  if (containerHit(folder.name)) return true;
  if (docsOf(project.id).some((d) => d.folderId === folder.id && docHit(d))) return true;
  return project.folders.some((f) => f.parentId === folder.id && folderHit(project, f));
}

const projectHit = (p: Project) =>
  !filtering() || containerHit(p.name) || docsOf(p.id).some(docHit) || p.folders.some((f) => folderHit(p, f));

const KIND_CHIPS: { kind: DocumentKind; label: string }[] = [
  { kind: "flow", label: "Diagrams" },
  { kind: "text", label: "Docs" },
  { kind: "kanban", label: "Kanban" },
  { kind: "eer", label: "EER" },
  { kind: "chart", label: "Charts" },
];

function FilterBar() {
  let input!: HTMLInputElement;
  return (
    <div class="sidebar-filter">
      <div class="filter-box">
        <input
          ref={input}
          type="search"
          placeholder="Filter boards…"
          aria-label="Filter boards by name"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setQuery("");
              input.blur();
            }
          }}
        />
        <Show when={filtering()}>
          <button
            class="icon-btn small"
            title="Clear the filter"
            onClick={() => {
              setQuery("");
              setKindFilter(null);
            }}
          >
            <IconClose />
          </button>
        </Show>
      </div>
      <div class="filter-chips" role="group" aria-label="Only boards of one kind">
        <For each={KIND_CHIPS}>
          {(c) => (
            <button
              class="chip-toggle small"
              classList={{ on: kindFilter() === c.kind }}
              aria-pressed={kindFilter() === c.kind}
              onClick={() => setKindFilter(kindFilter() === c.kind ? null : c.kind)}
            >
              {c.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

// ---------- sections ----------

/** A section of the sidebar with a title that opens and closes it (remembered). */
function Section(p: { id: string; title: string; count?: number; defaultOpen?: boolean; children: JSX.Element }) {
  const key = () => `section:${p.id}`;
  // Remembered as the opposite of the default; open while filtering, so what matches shows
  const open = () => filtering() || (p.defaultOpen === false ? collapsed().has(key()) : !collapsed().has(key()));
  const flip = () => {
    const next = new Set(collapsed());
    if (next.has(key())) next.delete(key());
    else next.add(key());
    saveCollapsed(next);
  };
  return (
    <section class="sidebar-section">
      <button class="tree-heading section-toggle" aria-expanded={open()} onClick={flip}>
        <span class="twisty" classList={{ open: open() }}>
          <IconChevronRight />
        </span>
        <span>{p.title}</span>
        <Show when={p.count}>
          <span class="section-count">{p.count}</span>
        </Show>
      </button>
      <Show when={open()}>{p.children}</Show>
    </section>
  );
}

/** The star of a project or board (in its row's actions; always shown when starred). */
function StarButton(p: { id: string; kind: ItemKind }) {
  return (
    <button
      class="icon-btn small star-btn"
      classList={{ starred: isStarred(p.id) }}
      title={isStarred(p.id) ? "Unstar" : "Star (shows it under Starred)"}
      aria-pressed={isStarred(p.id)}
      onClick={() => toggleStar(p.id, p.kind)}
    >
      <IconStar />
    </button>
  );
}

/** A board by its id, wherever it is in the loaded projects. */
const findDoc = (id: string) => projects().flatMap((p) => docsOf(p.id)).find((d) => d.id === id);

function RecentList() {
  // Only boards still in the sidebar (not deleted, still shared)
  const items = () => recent().filter((r) => findDoc(r.documentId));
  return (
    <Show when={items().length}>
      <Section id="recent" title="Recent">
        <For each={items()}>
          {(r) => (
            <Row
              key={`recent:${r.documentId}`}
              depth={0}
              active={(() => {
                const v = view();
                return v.type === "doc" && v.docId === r.documentId;
              })()}
              onClick={() => openDocument(r.projectId, r.documentId)}
              icon={<BoardIcon kind={r.kind} diagram={r.diagram} />}
              name={findDoc(r.documentId)?.name ?? r.name}
              sub={projectById(r.projectId)?.name}
            />
          )}
        </For>
      </Section>
    </Show>
  );
}

/** A starred project or board that is still in the sidebar. */
type StarredItem = { id: string; project?: Project; doc?: DocumentMeta };

function StarredList() {
  const items = () =>
    stars().flatMap((s): StarredItem[] => {
      if (s.kind === "project") {
        const project = projectById(s.itemId);
        return project ? [{ id: s.itemId, project }] : [];
      }
      const doc = findDoc(s.itemId);
      return doc ? [{ id: s.itemId, doc }] : [];
    });
  const viewing = (docId: string) => {
    const v = view();
    return v.type === "doc" && v.docId === docId;
  };
  return (
    <Show when={items().length}>
      <Section id="starred" title="Starred">
        <For each={items()}>
          {(item) => (
            <Show
              when={item.doc}
              fallback={
                <Row
                  key={`star:${item.id}`}
                  depth={0}
                  onClick={() => openProject(item.id)}
                  icon={<IconProject />}
                  name={item.project?.name ?? ""}
                  actions={<StarButton id={item.id} kind="project" />}
                />
              }
            >
              {(d) => (
                <Row
                  key={`star:${item.id}`}
                  depth={0}
                  active={viewing(d().id)}
                  onClick={() => openDocument(d().projectId, d().id)}
                  icon={<BoardIcon kind={d().kind} diagram={d().diagram} />}
                  name={d().name}
                  sub={projectById(d().projectId)?.name}
                  actions={<StarButton id={item.id} kind="document" />}
                />
              )}
            </Show>
          )}
        </For>
      </Section>
    </Show>
  );
}

function TrashList() {
  const restore = async (item: TrashItem) => {
    try {
      await restoreItem(item);
      await reloadProjects();
      toast(`“${item.name}” is back`);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  const remove = async (item: TrashItem) => {
    try {
      await deleteForever(item);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Show when={trash().length}>
      <Section id="trash" title="Trash" count={trash().length} defaultOpen={false}>
        <p class="tree-note">Deleted boards and projects stay here for 30 days.</p>
        <For each={trash()}>
          {(item) => (
            <Row
              key={`trash:${item.id}`}
              depth={0}
              onClick={() => restore(item)}
              title="Click to restore"
              icon={item.kind === "project" ? <IconProject /> : <BoardIcon kind={item.docKind ?? "flow"} diagram={item.diagram} />}
              name={item.name}
              sub={`${item.projectName ? `${item.projectName} · ` : ""}${when(item.deletedAt)}`}
              actions={
                <>
                  <button class="icon-btn small" title="Restore" onClick={() => restore(item)}>
                    <IconUndo />
                  </button>
                  <ConfirmButton class="icon-btn small danger" title="Delete for good (click twice)" onConfirm={() => remove(item)}>
                    <IconTrash />
                  </ConfirmButton>
                </>
              }
            />
          )}
        </For>
      </Section>
    </Show>
  );
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

// Projects of others (a role other than owner) are listed under "Shared with me";
// the desktop app's own files have no role and count as own.
/** May the user change this project's folders and boards? (owner or editor; the desktop app's own files: yes) */
const editsProject = (p: Project | undefined) => roleCanEdit(p?.role);
const ownsProject = (p: Project | undefined) => roleOwns(p?.role);

const ownProjects = () => projects().filter((p) => !p.role || p.role === "owner");
const sharedProjects = () => projects().filter((p) => p.role && p.role !== "owner");

export function Sidebar() {
  return (
    <aside class="sidebar">
      <div class="sidebar-head">
        <span class="logo" aria-hidden="true" />
        <span class="app-name">Flow</span>
        <InboxButton />
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
      <FilterBar />
      <nav class="tree" aria-label="Projects">
        <Show when={!filtering()}>
          <RecentList />
          <StarredList />
        </Show>
        <Section id="mine" title="My projects">
          <For
            each={ownProjects().filter(projectHit)}
            fallback={<p class="tree-empty">{filtering() ? "Nothing matches" : "No projects yet"}</p>}
          >
            {(p) => <ProjectNode project={p} />}
          </For>
        </Section>
        <Show when={sharedProjects().filter(projectHit).length}>
          <Section id="shared" title="Shared with me">
            <For each={sharedProjects().filter(projectHit)}>{(p) => <ProjectNode project={p} />}</For>
          </Section>
        </Show>
        <Show when={!filtering()}>
          <TrashList />
        </Show>
      </nav>
      <TimerIndicator />
      <AccountMenu />
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
        onRename={editsProject(p.project) ? (name) => updateProject(id(), { name }) : undefined}
        drop={editsProject(p.project) ? dropProps(id(), id(), false, () => drop(id(), null)) : undefined}
        actions={
          <>
            <StarButton id={id()} kind="project" />
            <Show when={editsProject(p.project)}>
              <AddMenu projectId={id()} folderId={null} />
            </Show>
            <Show when={ownsProject(p.project)}>
              <DeleteButton id={id()} title="Move the project to the trash" onConfirm={() => deleteProject(id())} />
            </Show>
          </>
        }
      />
      <Show when={isOpen(id())}>
        <Level project={p.project} parentId={null} depth={1} />
      </Show>
    </div>
  );
}

/**
 * All folders and documents directly inside one parent (a folder or the project
 * root). While filtering, only what matches (all of it under a matching name).
 */
function Level(p: { project: Project; parentId: string | null; depth: number; all?: boolean }) {
  const parentHit = () => p.all || containerHit(p.parentId ? (p.project.folders.find((f) => f.id === p.parentId)?.name ?? "") : p.project.name);
  const show = () => !filtering() || parentHit();
  const folders = () =>
    p.project.folders
      .filter((f) => f.parentId === p.parentId && (show() || folderHit(p.project, f)))
      .sort((a, b) => a.order - b.order);
  const docs = () =>
    docsOf(p.project.id)
      .filter((d) => d.folderId === p.parentId && (show() || docHit(d)))
      .sort((a, b) => a.order - b.order);
  return (
    <>
      <For each={folders()}>{(f) => <FolderNode project={p.project} folder={f} depth={p.depth} all={filtering() && parentHit()} />}</For>
      <For each={docs()}>{(d) => <DocNode doc={d} depth={p.depth} />}</For>
      <Show when={!folders().length && !docs().length && p.depth > 0 && !filtering()}>
        <p class="tree-empty" style={{ "padding-left": `${p.depth * 14 + 30}px` }}>
          Empty
        </p>
      </Show>
    </>
  );
}

function FolderNode(p: { project: Project; folder: Folder; depth: number; all?: boolean }) {
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
        onRename={editsProject(p.project) ? (name) => renameFolder(pid(), id(), name) : undefined}
        drag={editsProject(p.project) ? dragProps({ type: "folder", projectId: pid(), id: id() }) : undefined}
        drop={editsProject(p.project) ? dropProps(id(), pid(), false, () => drop(pid(), id())) : undefined}
        actions={
          <Show when={editsProject(p.project)}>
            <AddMenu projectId={pid()} folderId={id()} />
            <DeleteButton
              id={id()}
              title="Delete folder (its contents move up one level)"
              onConfirm={() => deleteFolder(pid(), id())}
            />
          </Show>
        }
      />
      <Show when={isOpen(id())}>
        <Level project={p.project} parentId={id()} depth={p.depth + 1} all={p.all} />
      </Show>
    </div>
  );
}

function DocNode(p: { doc: DocumentMeta; depth: number }) {
  const editsDoc = () => roleCanEdit(p.doc.role);
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
      icon={<BoardIcon kind={p.doc.kind} diagram={p.doc.diagram} />}
      name={p.doc.name}
      title={boardTypeOf(p.doc.kind, p.doc.diagram).label}
      onRename={editsDoc() ? (name) => renameDocument(p.doc.projectId, p.doc.id, name) : undefined}
      drag={editsDoc() && editsProject(projectById(p.doc.projectId)) ? dragProps({ type: "doc", projectId: p.doc.projectId, id: p.doc.id }) : undefined}
      drop={
        editsProject(projectById(p.doc.projectId))
          ? dropProps(p.doc.id, p.doc.projectId, true, (pos) => drop(p.doc.projectId, p.doc.folderId, { doc: p.doc, pos }))
          : undefined
      }
      actions={
        <>
          <StarButton id={p.doc.id} kind="document" />
          <Show when={editsProject(projectById(p.doc.projectId))}>
            <DeleteButton id={p.doc.id} title="Move to the trash" onConfirm={() => deleteDocument(p.doc.projectId, p.doc.id)} />
          </Show>
        </>
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
  /** Small text after the name (a board's project, when it was deleted) */
  sub?: string;
  strong?: boolean;
  active?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onClick: () => void;
  /** None: cannot be renamed (viewing only) */
  onRename?: (name: string) => void;
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
        if (p.onRename) setRenaming(p.key);
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
      <Show
        when={editing()}
        fallback={
          <>
            <span class="row-name">{p.name}</span>
            <Show when={p.sub}>
              <small class="row-sub">{p.sub}</small>
            </Show>
          </>
        }
      >
        <RenameInput
          value={p.name}
          onDone={(name) => {
            setRenaming(null);
            if (name !== null && name.trim() && name !== p.name) p.onRename?.(name);
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
  // A new board: first its type, then what it starts with (blank or a template)
  const [picking, setPicking] = createSignal(false);
  return (
    <>
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
                expand();
                setPicking(true);
              }}
            >
              <span class="with-icon">
                <IconPlus /> New board…
              </span>
            </button>
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
          </>
        )}
      </Menu>
      <Show when={picking()}>
        <NewBoardDialog
          projectId={p.projectId}
          folderId={p.folderId}
          onClose={(id) => {
            setPicking(false);
            if (id) setRenaming(id);
          }}
        />
      </Show>
    </>
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
