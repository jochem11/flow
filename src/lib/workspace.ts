// Workspace state: projects, folders, documents, which document is open, and
// autosaving it. Everything that touches the backend goes through `api`.

import { batch, createEffect, createRoot, createSignal, on, onCleanup } from "solid-js";
import { me } from "./auth";
import { isOffline, online, sendUnsaved } from "./offline";
import { api, errMsg } from "./api";
import { showPath, type Route } from "./route";
import { get, ServerError, useShareToken } from "./server";
import { ROLE_LABEL, roleCanEdit } from "./roles";
import { fitView } from "./camera";
import { kanbanRev, kanbanSnapshot, replaceKanban } from "./kanban";
import { chartRev, chartSnapshot, emptyChart, replaceChart } from "./chart/store";
import { storedSvg } from "./chart/render";
import { eerRev, eerSnapshot, replaceEer } from "./eer";
import { loadPersonal, loadTrash, noteOpened } from "./personal";
import { addNode, applyLayout, board, boardSnapshot, createNode, replaceBoard, rev, setChartBlockSvg, setDiagram } from "./store";
import { WELCOME } from "../templates";
import { toast } from "./toast";
import type { Brand, ChartDoc, DiagramType, DocContent, Document, DocumentKind, DocumentMeta, ExportFormat, Project, Role, SharedBoard } from "./types";

// ---------- state ----------

/** What the main area shows. */
export type View =
  | { type: "empty" }
  | { type: "project"; projectId: string }
  | { type: "doc"; projectId: string; docId: string };

/**
 * The open document without its content (that lives in a per-kind store), with
 * what the user may do with it, and the share link it was opened through.
 */
export type OpenDoc = Omit<Document, "content"> & { kind: DocumentKind; role: Role; share?: string };

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
  | { kind: "error"; message: string }
  /** No connection: kept on this device, saved when it is back */
  | { kind: "offline" };

const [saveState, setSaveState] = createSignal<SaveState>({ kind: "saved" });
export { saveState };

const AUTOSAVE_MS = 800;
let timer: ReturnType<typeof setTimeout> | undefined;

/** The open board changed: saved soon. */
export function markDirty() {
  const doc = openDoc();
  if (!doc) return;
  if (!roleCanEdit(doc.role)) return;
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
  // A chart keeps its drawing (light) for exports and chart blocks
  else if (kind === "chart") content = { kind, data: { ...chartSnapshot(), svg: storedSvg(chartSnapshot()) } };
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
    setSaveState(isOffline(e) ? { kind: "offline" } : { kind: "error", message: errMsg(e) });
  }
}

/** The connection is back: what waited is saved (also from before a reload). */
async function backOnline() {
  if (!me()) return;
  // Each into its room too, when people are on it (collab is loaded here, not imported: it imports this file)
  const { saveKept } = await import("./collab");
  const sent = await sendUnsaved(saveKept);
  if (saveState().kind === "offline" || saveState().kind === "dirty") await saveNow();
  if (sent) toast(`Back online: saved ${sent} ${sent === 1 ? "board" : "boards"} changed while offline`);
}
createRoot(() => {
  // Back online: as soon as a request gets through, or the system says so
  createEffect(on(online, (on) => on && void backOnline(), { defer: true }));
  // Logged in (on startup): saves left from last time
  createEffect(on(() => me()?.user.id, (id) => id && online() && void backOnline()));
  // While offline, try now and then (the system does not always tell)
  const timer = setInterval(() => {
    if (!online() && saveState().kind === "offline") void saveNow();
  }, 15_000);
  onCleanup(() => clearInterval(timer));
});

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
  createEffect(on(chartRev, markDirty, { defer: true }));
});

// ---------- loading ----------

const LAST_VIEW_KEY = "flowapp:lastView";

function rememberView(v: View) {
  setView(v);
  // The address bar (web): a link to what is open (a share link stays as it is)
  if (v.type === "doc" && !openDoc()?.share) showPath(`/d/${v.docId}`);
  else if (v.type === "project") showPath(`/p/${v.projectId}`);
  else if (v.type === "empty") showPath("/");
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: not important */
  }
}

/** Loads the projects and their boards again (after uploading projects, accepting an invite). */
export async function reloadProjects() {
  await refreshProjects();
  await Promise.all([...projects().map((p) => refreshDocs(p.id)), loadPersonal()]);
}

/**
 * A reloaded list, keeping the objects that did not change: the sidebar keeps
 * their rows as they are (a name being typed in a row stays there).
 */
function keepSame<T extends { id: string }>(old: T[] | undefined, next: T[]): T[] {
  const byId = new Map((old ?? []).map((o) => [o.id, o]));
  return next.map((n) => {
    const o = byId.get(n.id);
    return o && JSON.stringify(o) === JSON.stringify(n) ? o : n;
  });
}

async function refreshProjects() {
  const next = await api.listProjects();
  setProjects((old) => keepSame(old, next));
}

async function refreshDocs(projectId: string) {
  const docs = await api.listDocuments(projectId);
  setDocsByProject((all) => ({ ...all, [projectId]: keepSame(all[projectId], docs) }));
}

/**
 * After logging in: load the user's projects, then open what the start path
 * asks for (a board, a project), else the last viewed one.
 */
export async function initWorkspace(route: Route = { kind: "home" }) {
  try {
    await refreshProjects();
    if (!projects().length) await createStarterProject();
    await Promise.all([...projects().map((p) => refreshDocs(p.id)), loadPersonal()]);
    if (route.kind === "doc") await openDocumentById(route.id);
    else if (route.kind === "project" && projectById(route.id)) await openProject(route.id);
    else await restoreView();
  } catch (e) {
    toast(`Loading failed: ${errMsg(e)}`, "error");
  } finally {
    setReady(true);
  }
}

/** A new account: a welcome project with a guide and one board of each main kind. */
async function createStarterProject() {
  const project = await api.createProject(WELCOME.name);
  await api.updateProject(project.id, WELCOME.name, WELCOME.description);
  for (const b of WELCOME.boards) {
    const content = b.make();
    await api.createDocument(project.id, null, b.name, content.kind, content);
  }
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

/** Opens a board by its id alone (a link), wherever it is. */
export async function openDocumentById(docId: string) {
  const known = Object.values(docsByProject()).flat().find((d) => d.id === docId);
  if (known) return openDocument(known.projectId, docId);
  try {
    const doc = await api.loadDocument("", docId);
    await openDocument(doc.projectId, docId);
  } catch (e) {
    toast(`Could not open the board: ${errMsg(e)}`, "error");
    await restoreView();
  }
}

/**
 * Opens a board. Through a share link, `shared` gives its token and what the
 * link lets this person do; else their role comes with the project's boards.
 */
export async function openDocument(projectId: string, docId: string, shared?: { token: string; role: Role }) {
  const v = view();
  if (v.type === "doc" && v.docId === docId && openDoc()?.share === shared?.token) return;
  await flushIfDirty();
  useShareToken(shared?.token ?? null);
  try {
    const doc = await api.loadDocument(projectId, docId);
    const { content, ...rest } = doc;
    batch(() => {
      dropOpenDoc();
      if (content.kind === "flow") replaceBoard(content.data);
      else if (content.kind === "text") setTextRaw(content.data.markdown);
      else if (content.kind === "kanban") replaceKanban(content.data);
      else if (content.kind === "chart") replaceChart(content.data);
      else if (content.kind === "eer") replaceEer(content.data);
      else otherContent = content;
      // From the server's list of this project's boards; boards of the desktop app's own files are the user's own
      const role = shared?.role ?? docsOf(projectId).find((d) => d.id === docId)?.role ?? "owner";
      setOpenDoc({ ...rest, kind: content.kind, role, share: shared?.token });
      rememberView({ type: "doc", projectId, docId });
    });
    // "Recent" in the sidebar (not for a board seen through its link only)
    if (!shared) noteOpened({ documentId: docId, projectId, name: rest.name, kind: content.kind, diagram: content.kind === "flow" ? content.data.diagram : undefined });
    if (content.kind === "flow") requestAnimationFrame(() => fitIfNeeded());
    if (content.kind === "flow") void refreshChartBlocks(docId);
    // A chart not drawn yet (made from a template, or before charts kept their drawing):
    // saved once, so exports and chart blocks have its drawing
    if (content.kind === "chart" && !content.data.svg) markDirty();
  } catch (e) {
    toast(`Could not open document: ${errMsg(e)}`, "error");
  }
}

/** A chart board's drawing: the one it keeps, or drawn now (not drawn yet). */
const chartDrawing = (data: ChartDoc) => data.svg ?? storedSvg(data);

/**
 * The chart blocks on the open board show their chart boards as they are now:
 * each is loaded, and a drawing that changed is put on the block (saved when
 * the one looking may edit the board; a chart they cannot see stays as it was).
 */
async function refreshChartBlocks(boardId: string) {
  const blocks = board.nodes.filter((n) => n.kind === "chart" && n.chart);
  await Promise.all(
    blocks.map(async (n) => {
      try {
        const doc = await api.loadDocument("", n.chart!.documentId);
        if (doc.content.kind !== "chart" || openDoc()?.id !== boardId) return;
        const svg = chartDrawing(doc.content.data);
        if (svg !== n.chart!.svg) setChartBlockSvg(n.id, svg, roleCanEdit(openDoc()?.role));
      } catch {
        /* deleted, or not shared with this person: keep the drawing it has */
      }
    }),
  );
}

/** Puts a chart board on the open board, as a block showing its drawing (at the middle of the view). */
export async function addChartBlock(chartId: string, at: { x: number; y: number }) {
  try {
    const doc = await api.loadDocument("", chartId);
    if (doc.content.kind !== "chart") return;
    const node = createNode("chart", at.x, at.y, { text: doc.name, chart: { documentId: chartId, svg: chartDrawing(doc.content.data) } });
    addNode(node);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

/** A new chart board in the open board's project, put on the board straight away. */
export async function addNewChartBlock(at: { x: number; y: number }) {
  const d = openDoc();
  if (!d) return;
  try {
    const data = emptyChart();
    const doc = await api.createDocument(d.projectId, d.folderId, "Chart", "chart", { kind: "chart", data: { ...data, svg: storedSvg(data) } });
    await refreshDocs(d.projectId);
    await addChartBlock(doc.id, at);
    toast("A new chart board, in the sidebar: double-click the block to change its data");
  } catch (e) {
    toast(errMsg(e), "error");
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

/** The project's look (accent and typeface) for all its boards and exports. */
export async function setProjectBrand(id: string, brand: Brand) {
  try {
    await api.setProjectBrand(id, brand);
    await refreshProjects();
  } catch (e) {
    toast(errMsg(e), "error");
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
    await loadTrash();
    toast("Project moved to the trash (restore it from Trash in the sidebar)");
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
  chart: "New chart",
};

/** A new board, empty or with what `start` gives it (a template: its name and content). */
export async function createDocument(
  projectId: string,
  folderId: string | null,
  kind: DocumentKind,
  start?: { name: string; content: DocContent },
): Promise<string | null> {
  // A blank chart starts with example data (to change in its table), drawn
  if (!start && kind === "chart") {
    const data = emptyChart();
    start = { name: DEFAULT_NAMES[kind], content: { kind: "chart", data: { ...data, svg: storedSvg(data) } } };
  }
  try {
    const doc = await api.createDocument(projectId, folderId, start?.name ?? DEFAULT_NAMES[kind], kind, start?.content);
    await refreshDocs(projectId);
    await openDocument(projectId, doc.id);
    return doc.id;
  } catch (e) {
    toast(errMsg(e), "error");
    return null;
  }
}

/** Changes the open flow board's type: its tools and actions change with it, its blocks stay. */
export async function changeBoardType(diagram: DiagramType) {
  const d = openDoc();
  if (!d || d.kind !== "flow" || board.diagram === diagram) return;
  setDiagram(diagram);
  await saveNow();
  await refreshDocs(d.projectId);
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
    await Promise.all([refreshDocs(projectId), loadTrash()]);
    toast("Moved to the trash (restore it from Trash in the sidebar)");
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
export async function runExport(format: ExportFormat) {
  const doc = currentDocument();
  if (!doc) return;
  try {
    const path = await api.exportDocument(doc, format, projectById(doc.projectId)?.brand);
    toast(`Exported to ${path}`);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

/**
 * A guest (not logged in) opening a board through its share link: only that
 * board, without projects or a sidebar.
 */
export async function openAsGuest(board: SharedBoard, token: string) {
  setReady(true);
  await openDocument(board.projectId, board.documentId, { token, role: board.role });
}

// ---------- when others change things ----------

/** Set when the open board was taken away while open (Gate shows it to guests). */
const [accessLost, setAccessLost] = createSignal<string | null>(null);
export { accessLost };

/**
 * Checks the open board against the server right now (after someone changed
 * access): closed when it is gone, read-only (or more) when the role changed.
 * The live connection then reconnects with the new role (collab/).
 */
export async function checkOpenAccess() {
  const doc = openDoc();
  // The desktop app's own files have no role: nothing to check
  if (!doc?.role) return;
  let role: Role | null = null;
  try {
    if (doc.share) role = (await get<SharedBoard>(`/share/${doc.share}`)).role;
    else role = (await api.listDocuments(doc.projectId)).find((d) => d.id === doc.id)?.role ?? null;
  } catch (e) {
    if (!(e instanceof ServerError) || e.status === 0) return; // offline: decide when back
    role = null;
  }
  if (openDoc()?.id !== doc.id) return;
  if (!role || role === "none") {
    const name = doc.name;
    batch(() => {
      dropOpenDoc();
      setAccessLost(name);
      const project = projectById(doc.projectId);
      rememberView(project ? { type: "project", projectId: project.id } : { type: "empty" });
    });
    toast(`You no longer have access to \u201c${name}\u201d`, "error");
    return;
  }
  if (role !== doc.role) {
    setOpenDoc({ ...doc, role });
    toast(`Your access to \u201c${doc.name}\u201d changed: ${ROLE_LABEL[role].toLowerCase()}`);
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * A project changed (someone added, moved or renamed a board or folder, or
 * people changed): load the sidebar again, shortly (several notices come at once).
 */
export function projectsChanged(alsoCheckAccess = false) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(async () => {
    try {
      await reloadProjects();
    } catch {
      return;
    }
    // A project that is open but no longer there
    const v = view();
    if (v.type === "project" && !projectById(v.projectId)) rememberView({ type: "empty" });
    const doc = openDoc();
    // People may have joined or left: who can be assigned on a kanban board
    if (doc?.kind === "kanban") void import("./people").then((m) => m.loadPeople());
    if (doc && (alsoCheckAccess || !docsOf(doc.projectId).some((d) => d.id === doc.id))) await checkOpenAccess();
    else if (doc) {
      // Renamed or moved by someone else
      const meta = docsOf(doc.projectId).find((d) => d.id === doc.id);
      if (meta && (meta.name !== doc.name || meta.folderId !== doc.folderId)) setOpenDoc({ ...doc, name: meta.name, folderId: meta.folderId });
      if (meta?.role && meta.role !== doc.role) await checkOpenAccess();
    }
  }, 150);
}

