// Workspace state: projects, folders, documents, which document is open, and
// autosaving it. Everything that touches the backend goes through `api`.

import { batch, createEffect, createRoot, createSignal, on } from "solid-js";
import { api, errMsg } from "./api";
import { fitView } from "./camera";
import { kanbanRev, kanbanSnapshot, replaceKanban } from "./kanban";
import { eerRev, eerSnapshot, replaceEer } from "./eer";
import { applyLayout, board, boardSnapshot, replaceBoard, rev, starterFlow } from "./store";
import { toast } from "./toast";
import type { DocContent, Document, DocumentKind, DocumentMeta, ExportFormat, FlowDoc, Project } from "./types";

// ---------- state ----------

/** What the main area shows. */
export type View =
  | { type: "empty" }
  | { type: "project"; projectId: string }
  | { type: "doc"; projectId: string; docId: string };

/** The open document without its content; the content lives in a per-kind store. */
export type OpenDoc = Omit<Document, "content"> & { kind: DocumentKind };

const [projects, setProjects] = createSignal<Project[]>([]);
const [docsByProject, setDocsByProject] = createSignal<Record<string, DocumentMeta[]>>({});
const [view, setView] = createSignal<View>({ type: "empty" });
const [openDoc, setOpenDoc] = createSignal<OpenDoc | null>(null);
const [ready, setReady] = createSignal(false);

export { docsByProject, openDoc, projects, ready, view };

export const projectById = (id: string) => projects().find((p) => p.id === id);
export const docsOf = (projectId: string) => docsByProject()[projectId] ?? [];

// Where the content of the open document lives, per kind:
//   flow    -> `board` in store.ts
//   text    -> `text` below
//   kanban  -> `kanban` in kanban.ts
//   eer     -> `eer` in eer.ts
const [text, setTextRaw] = createSignal("");
export { text };
let otherContent: DocContent | null = null;

// ---------- saving ----------

export type SaveState =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

const [saveState, setSaveState] = createSignal<SaveState>({ kind: "saved" });
export { saveState };

const AUTOSAVE_MS = 800;
let timer: ReturnType<typeof setTimeout> | undefined;

function markDirty() {
  if (!openDoc()) return;
  setSaveState({ kind: "dirty" });
  clearTimeout(timer);
  timer = setTimeout(saveNow, AUTOSAVE_MS);
}

export function setText(value: string) {
  setTextRaw(value);
  markDirty();
}

/** The open document as a complete `Document`, ready to send to the backend. */
export function currentDocument(): Document | null {
  const d = openDoc();
  if (!d) return null;
  const { kind, ...rest } = d;
  let content: DocContent;
  if (kind === "flow") content = { kind, data: boardSnapshot() };
  else if (kind === "text") content = { kind, data: { markdown: text() } };
  else if (kind === "kanban") content = { kind, data: kanbanSnapshot() };
  else if (kind === "eer") content = { kind, data: eerSnapshot() };
  else if (otherContent) content = otherContent;
  else return null;
  return { ...rest, content };
}

export async function saveNow() {
  clearTimeout(timer);
  const doc = currentDocument();
  if (!doc) return;
  setSaveState({ kind: "saving" });
  try {
    await api.saveDocument(doc);
    setSaveState({ kind: "saved" });
  } catch (e) {
    setSaveState({ kind: "error", message: errMsg(e) });
  }
}

async function flushIfDirty() {
  const s = saveState().kind;
  if (s === "dirty" || s === "saving") await saveNow();
}

/** Closes the open document without saving it (e.g. after deleting it). */
function dropOpenDoc() {
  clearTimeout(timer);
  setOpenDoc(null);
  otherContent = null;
  setSaveState({ kind: "saved" });
}

// Every change to the flowchart or kanban store schedules a save.
createRoot(() => {
  createEffect(on(rev, markDirty, { defer: true }));
  createEffect(on(kanbanRev, markDirty, { defer: true }));
  createEffect(on(eerRev, markDirty, { defer: true }));
});

// ---------- loading ----------

const LAST_VIEW_KEY = "flowapp:lastView";

function rememberView(v: View) {
  setView(v);
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: not important */
  }
}

async function refreshProjects() {
  setProjects(await api.listProjects());
}

async function refreshDocs(projectId: string) {
  const docs = await api.listDocuments(projectId);
  setDocsByProject((all) => ({ ...all, [projectId]: docs }));
}

/** On startup: load everything and reopen the last viewed document or project. */
export async function initWorkspace() {
  try {
    await refreshProjects();
    if (!projects().length) await createStarterProject();
    await Promise.all(projects().map((p) => refreshDocs(p.id)));
    await restoreView();
  } catch (e) {
    toast(`Loading failed: ${errMsg(e)}`, "error");
  } finally {
    setReady(true);
  }
}

async function createStarterProject() {
  const project = await api.createProject("My first project");
  const doc = await api.createDocument(project.id, null, "My first flowchart", "flow");
  await api.saveDocument({ ...doc, content: { kind: "flow", data: starterFlow() } });
  await refreshProjects();
}

async function restoreView() {
  let last: View | null = null;
  try {
    last = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) ?? "null");
  } catch {
    /* ignore */
  }
  if (last?.type === "doc" && docsOf(last.projectId).some((d) => d.id === last.docId)) {
    return openDocument(last.projectId, last.docId);
  }
  if (last?.type === "project" && projectById(last.projectId)) return openProject(last.projectId);
  const first = projects()[0];
  if (!first) return setView({ type: "empty" });
  const firstDoc = docsOf(first.id)[0];
  return firstDoc ? openDocument(first.id, firstDoc.id) : openProject(first.id);
}

export async function openProject(projectId: string) {
  await flushIfDirty();
  dropOpenDoc();
  rememberView({ type: "project", projectId });
}

export async function openDocument(projectId: string, docId: string) {
  const v = view();
  if (v.type === "doc" && v.docId === docId) return;
  await flushIfDirty();
  try {
    const doc = await api.loadDocument(projectId, docId);
    const { content, ...rest } = doc;
    batch(() => {
      dropOpenDoc();
      if (content.kind === "flow") replaceBoard(content.data);
      else if (content.kind === "text") setTextRaw(content.data.markdown);
      else if (content.kind === "kanban") replaceKanban(content.data);
      else if (content.kind === "eer") replaceEer(content.data);
      else otherContent = content;
      setOpenDoc({ ...rest, kind: content.kind });
      rememberView({ type: "doc", projectId, docId });
    });
    if (content.kind === "flow") requestAnimationFrame(() => fitIfNeeded());
  } catch (e) {
    toast(`Could not open document: ${errMsg(e)}`, "error");
  }
}

/** A new flowchart has no saved camera position yet: fit it to the content. */
function fitIfNeeded() {
  const c = board.camera;
  if (c.x === 0 && c.y === 0 && c.zoom === 1) fitView();
}

// ---------- projects ----------

export async function createProject(): Promise<string | null> {
  try {
    const p = await api.createProject("New project");
    await refreshProjects();
    setDocsByProject((all) => ({ ...all, [p.id]: [] }));
    await openProject(p.id);
    return p.id;
  } catch (e) {
    toast(errMsg(e), "error");
    return null;
  }
}

export async function updateProject(id: string, changes: { name?: string; description?: string }) {
  const p = projectById(id);
  if (!p) return;
  const name = changes.name?.trim() || p.name;
  const description = changes.description ?? p.description;
  if (name === p.name && description === p.description) return;
  // Optimistic update so typing feels instant; rolled back on error.
  setProjects((ps) => ps.map((x) => (x.id === id ? { ...x, name, description } : x)));
  try {
    await api.updateProject(id, name, description);
  } catch (e) {
    setProjects((ps) => ps.map((x) => (x.id === id ? p : x)));
    toast(errMsg(e), "error");
  }
}

export async function deleteProject(id: string) {
  if (view().type !== "empty" && (view() as { projectId: string }).projectId === id) {
    dropOpenDoc();
    setView({ type: "empty" });
  }
  try {
    await api.deleteProject(id);
    await refreshProjects();
    setDocsByProject(({ [id]: _, ...rest }) => rest);
    if (view().type === "empty" && projects()[0]) await openProject(projects()[0].id);
    toast("Project deleted");
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

// ---------- folders ----------

export async function createFolder(projectId: string, parentId: string | null): Promise<string | null> {
  try {
    const f = await api.createFolder(projectId, "New folder", parentId);
    await refreshProjects();
    return f.id;
  } catch (e) {
    toast(errMsg(e), "error");
    return null;
  }
}

export async function renameFolder(projectId: string, folderId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    await api.renameFolder(projectId, folderId, trimmed);
    await refreshProjects();
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

export async function moveFolder(projectId: string, folderId: string, parentId: string | null, order: number) {
  try {
    await api.moveFolder(projectId, folderId, parentId, order);
    await refreshProjects();
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

export async function deleteFolder(projectId: string, folderId: string) {
  try {
    await flushIfDirty();
    await api.deleteFolder(projectId, folderId);
    await Promise.all([refreshProjects(), refreshDocs(projectId)]);
    // If the open document was in this folder, its folderId has changed.
    const d = openDoc();
    if (d?.folderId === folderId) {
      const moved = docsOf(projectId).find((x) => x.id === d.id);
      if (moved) setOpenDoc({ ...d, folderId: moved.folderId });
    }
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

// ---------- documents ----------

const DEFAULT_NAMES: Record<DocumentKind, string> = {
  flow: "New flowchart",
  text: "New document",
  kanban: "New kanban board",
  eer: "New EER diagram",
};

export async function createDocument(
  projectId: string,
  folderId: string | null,
  kind: DocumentKind,
): Promise<string | null> {
  try {
    const doc = await api.createDocument(projectId, folderId, DEFAULT_NAMES[kind], kind);
    await refreshDocs(projectId);
    await openDocument(projectId, doc.id);
    return doc.id;
  } catch (e) {
    toast(errMsg(e), "error");
    return null;
  }
}

export async function renameDocument(projectId: string, id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    await api.renameDocument(projectId, id, trimmed);
    // Update the open copy too, or the next autosave would restore the old name.
    const d = openDoc();
    if (d?.id === id) setOpenDoc({ ...d, name: trimmed });
    await refreshDocs(projectId);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

export async function moveDocument(projectId: string, id: string, folderId: string | null, order: number) {
  try {
    await api.moveDocument(projectId, id, folderId, order);
    const d = openDoc();
    if (d?.id === id) setOpenDoc({ ...d, folderId, order });
    await refreshDocs(projectId);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

export async function deleteDocument(projectId: string, id: string) {
  if (openDoc()?.id === id) {
    dropOpenDoc();
    rememberView({ type: "project", projectId });
  }
  try {
    await api.deleteDocument(projectId, id);
    await refreshDocs(projectId);
    toast("Document deleted");
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

// ---------- flowchart actions (run in Rust) ----------

export async function runAutoLayout() {
  if (!board.nodes.length) return;
  try {
    const snap = boardSnapshot();
    applyLayout(await api.autoLayout(snap.nodes, snap.edges));
    requestAnimationFrame(() => fitView());
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

/** Code for some of the classes: the open flowchart, with only those in it. */
export async function exportClasses(flow: FlowDoc, format: ExportFormat) {
  const doc = currentDocument();
  if (!doc) return;
  try {
    const path = await api.exportDocument({ ...doc, content: { kind: "flow", data: flow } }, format);
    toast(`Exported to ${path}`);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

export async function runExport(format: ExportFormat) {
  const doc = currentDocument();
  if (!doc) return;
  try {
    const path = await api.exportDocument(doc, format);
    toast(`Exported to ${path}`);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}
