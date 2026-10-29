// All communication with the Rust backend goes through this file.
//
// In the desktop app (`npm run tauri dev`) it uses the generated, typed
// `commands` from `src/bindings.ts`, so renaming a command or changing a
// parameter in Rust is a type error here.
//
// In a plain browser (`npm run dev`) it falls back to `browserApi` below, which
// stores everything in localStorage and mirrors the behaviour of the Rust commands.

import { commands } from "../bindings";
import type {
  Document,
  DocumentKind,
  DocumentMeta,
  CodeFile,
  CodeImport,
  CodeLanguage,
  DocContent,
  EerDoc,
  ExportFormat,
  FlowDoc,
  FlowEdge,
  FlowNode,
  Folder,
  Position,
  Project,
  SqlDialect,
  SqlImport,
} from "./types";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface Api {
  // projects
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  updateProject(id: string, name: string, description: string): Promise<void>;
  deleteProject(id: string): Promise<void>;
  // folders
  createFolder(projectId: string, name: string, parentId: string | null): Promise<Folder>;
  renameFolder(projectId: string, folderId: string, name: string): Promise<void>;
  moveFolder(projectId: string, folderId: string, parentId: string | null, order: number): Promise<void>;
  deleteFolder(projectId: string, folderId: string): Promise<void>;
  // documents
  listDocuments(projectId: string): Promise<DocumentMeta[]>;
  loadDocument(projectId: string, id: string): Promise<Document>;
  createDocument(projectId: string, folderId: string | null, name: string, kind: DocumentKind): Promise<Document>;
  saveDocument(doc: Document): Promise<void>;
  renameDocument(projectId: string, id: string, name: string): Promise<void>;
  moveDocument(projectId: string, id: string, folderId: string | null, order: number): Promise<void>;
  deleteDocument(projectId: string, id: string): Promise<void>;
  // flowchart
  autoLayout(nodes: FlowNode[], edges: FlowEdge[]): Promise<Position[]>;
  /** Returns the path of the file that was written */
  exportDocument(doc: Document, format: ExportFormat): Promise<string>;
  // EER
  /** The SQL for an EER diagram, to preview */
  eerSql(doc: EerDoc, dialect: SqlDialect): Promise<string>;
  /** Code for the UML classes in a flowchart, to preview */
  classCode(flow: FlowDoc, language: CodeLanguage): Promise<CodeFile[]>;
  /** The document as Mermaid: one block per diagram in it */
  mermaidPreview(doc: Document): Promise<CodeFile[]>;
  /** The tables and relations in a SQL script, to add to an EER diagram */
  importSql(sql: string): Promise<SqlImport>;
  /** UML classes from source code; without a language it is guessed */
  importCode(code: string, language: CodeLanguage | null): Promise<CodeImport>;
}

type CmdResult<T> = { status: "ok"; data: T } | { status: "error"; error: string };

/** Turns `{ status: "error" }` into a thrown error, so callers can use try/catch. */
async function unwrap<T>(p: Promise<CmdResult<T>>): Promise<T> {
  const r = await p;
  if (r.status === "error") throw r.error;
  return r.data;
}

/** For commands that return `()` (`null` in TS). */
const done = async (p: Promise<CmdResult<null>>) => void (await unwrap(p));

const tauriApi: Api = {
  listProjects: () => unwrap(commands.listProjects()),
  createProject: (name) => unwrap(commands.createProject(name)),
  updateProject: (id, name, description) => done(commands.updateProject(id, name, description)),
  deleteProject: (id) => done(commands.deleteProject(id)),

  createFolder: (projectId, name, parentId) => unwrap(commands.createFolder(projectId, name, parentId)),
  renameFolder: (projectId, folderId, name) => done(commands.renameFolder(projectId, folderId, name)),
  moveFolder: (projectId, folderId, parentId, order) =>
    done(commands.moveFolder(projectId, folderId, parentId, order)),
  deleteFolder: (projectId, folderId) => done(commands.deleteFolder(projectId, folderId)),

  listDocuments: (projectId) => unwrap(commands.listDocuments(projectId)),
  loadDocument: (projectId, id) => unwrap(commands.loadDocument(projectId, id)),
  createDocument: (projectId, folderId, name, kind) =>
    unwrap(commands.createDocument(projectId, folderId, name, kind)),
  saveDocument: (doc) => done(commands.saveDocument(doc)),
  renameDocument: (projectId, id, name) => done(commands.renameDocument(projectId, id, name)),
  moveDocument: (projectId, id, folderId, order) => done(commands.moveDocument(projectId, id, folderId, order)),
  deleteDocument: (projectId, id) => done(commands.deleteDocument(projectId, id)),

  autoLayout: (nodes, edges) => unwrap(commands.autoLayout(nodes, edges)),
  exportDocument: (doc, format) => unwrap(commands.exportDocument(doc, format)),
  eerSql: (doc, dialect) => commands.eerSql(doc, dialect),
  classCode: (flow, language) => commands.classCode(flow, language),
  mermaidPreview: (doc) => commands.mermaidPreview(doc),
  importSql: (sql) => commands.importSql(sql),
  importCode: (code, language) => commands.importCode(code, language),
};

// ---------------------------------------------------------------------------
// Browser fallback (localStorage), mirroring the Rust commands.
// ---------------------------------------------------------------------------

const KEY = "flowapp:workspace";

interface Store {
  projects: Project[];
  docs: Record<string, Document>;
}

const read = (): Store => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "") as Store;
  } catch {
    return { projects: [], docs: {} };
  }
};
const write = (s: Store) => localStorage.setItem(KEY, JSON.stringify(s));
const newId = () => crypto.randomUUID();
const maxOrder = (xs: { order: number }[]) => xs.reduce((m, x) => Math.max(m, x.order), 0);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function getProject(s: Store, id: string): Project {
  const p = s.projects.find((p) => p.id === id);
  if (!p) throw `project ${id} not found`;
  return p;
}

function getFolder(p: Project, id: string): Folder {
  const f = p.folders.find((f) => f.id === id);
  if (!f) throw `folder ${id} not found`;
  return f;
}

/** Empty content for a new document (`DocContent::empty` in Rust). */
export function emptyContent(kind: DocumentKind): DocContent {
  const camera = { x: 0, y: 0, zoom: 1 };
  switch (kind) {
    case "flow":
      return { kind, data: { nodes: [], edges: [], camera } };
    case "text":
      return { kind, data: { markdown: "" } };
    case "kanban":
      return { kind, data: { columns: [], labels: [] } };
    case "eer":
      return { kind, data: { entities: [], relations: [], camera } };
  }
}

const meta = (d: Document): DocumentMeta => ({
  id: d.id,
  projectId: d.projectId,
  folderId: d.folderId,
  order: d.order,
  name: d.name,
  kind: d.content.kind,
  updatedAt: d.updatedAt ?? 0,
});

const browserApi: Api = {
  async listProjects() {
    return read().projects.sort((a, b) => a.order - b.order);
  },
  async createProject(name) {
    const s = read();
    const p: Project = {
      id: newId(),
      name,
      description: "",
      folders: [],
      order: maxOrder(s.projects) + 1,
      updatedAt: Date.now(),
    };
    s.projects.push(p);
    write(s);
    return p;
  },
  async updateProject(id, name, description) {
    const s = read();
    Object.assign(getProject(s, id), { name, description, updatedAt: Date.now() });
    write(s);
  },
  async deleteProject(id) {
    const s = read();
    s.projects = s.projects.filter((p) => p.id !== id);
    for (const d of Object.values(s.docs)) if (d.projectId === id) delete s.docs[d.id];
    write(s);
  },

  async createFolder(projectId, name, parentId) {
    const s = read();
    const p = getProject(s, projectId);
    if (parentId) getFolder(p, parentId);
    const f: Folder = {
      id: newId(),
      name,
      parentId,
      order: maxOrder(p.folders.filter((f) => f.parentId === parentId)) + 1,
    };
    p.folders.push(f);
    write(s);
    return f;
  },
  async renameFolder(projectId, folderId, name) {
    if (!name.trim()) throw "name cannot be empty";
    const s = read();
    getFolder(getProject(s, projectId), folderId).name = name;
    write(s);
  },
  async moveFolder(projectId, folderId, parentId, order) {
    const s = read();
    const p = getProject(s, projectId);
    const f = getFolder(p, folderId);
    if (parentId) getFolder(p, parentId);
    // Walk up from the new parent; reaching the folder itself means a cycle.
    let current = parentId;
    while (current) {
      if (current === folderId) throw "cannot move a folder into itself";
      current = getFolder(p, current).parentId;
    }
    Object.assign(f, { parentId, order });
    write(s);
  },
  async deleteFolder(projectId, folderId) {
    const s = read();
    const p = getProject(s, projectId);
    const parent = getFolder(p, folderId).parentId;
    for (const f of p.folders) if (f.parentId === folderId) f.parentId = parent;
    p.folders = p.folders.filter((f) => f.id !== folderId);
    for (const d of Object.values(s.docs))
      if (d.projectId === projectId && d.folderId === folderId) d.folderId = parent;
    write(s);
  },

  async listDocuments(projectId) {
    return Object.values(read().docs)
      .filter((d) => d.projectId === projectId)
      .map(meta)
      .sort((a, b) => a.order - b.order);
  },
  async loadDocument(_projectId, id) {
    const d = read().docs[id];
    if (!d) throw `document ${id} not found`;
    return d;
  },
  async createDocument(projectId, folderId, name, kind) {
    const s = read();
    const p = getProject(s, projectId);
    if (folderId) getFolder(p, folderId);
    const siblings = Object.values(s.docs).filter((d) => d.projectId === projectId && d.folderId === folderId);
    const doc: Document = {
      id: newId(),
      projectId,
      folderId,
      order: maxOrder(siblings) + 1,
      name,
      content: emptyContent(kind),
      updatedAt: Date.now(),
    };
    s.docs[doc.id] = doc;
    write(s);
    return clone(doc);
  },
  async saveDocument(doc) {
    const s = read();
    s.docs[doc.id] = { ...clone(doc), updatedAt: Date.now() };
    write(s);
  },
  async renameDocument(_projectId, id, name) {
    if (!name.trim()) throw "name cannot be empty";
    const s = read();
    const d = s.docs[id];
    if (!d) throw `document ${id} not found`;
    d.name = name;
    write(s);
  },
  async moveDocument(projectId, id, folderId, order) {
    const s = read();
    const d = s.docs[id];
    if (!d) throw `document ${id} not found`;
    if (folderId) getFolder(getProject(s, projectId), folderId);
    Object.assign(d, { folderId, order });
    write(s);
  },
  async deleteDocument(_projectId, id) {
    const s = read();
    delete s.docs[id];
    write(s);
  },

  autoLayout: () => Promise.reject("Auto-layout runs in Rust. Start the app with `npm run tauri dev`."),
  exportDocument: () => Promise.reject("Export runs in Rust. Start the app with `npm run tauri dev`."),
  eerSql: () => Promise.reject("SQL is generated in Rust. Start the app with `npm run tauri dev`."),
  classCode: () => Promise.reject("Code is generated in Rust. Start the app with `npm run tauri dev`."),
  mermaidPreview: () => Promise.reject("Mermaid is generated in Rust. Start the app with `npm run tauri dev`."),
  importSql: () => Promise.reject("SQL is read in Rust. Start the app with `npm run tauri dev`."),
  importCode: () => Promise.reject("Code is read in Rust. Start the app with `npm run tauri dev`."),
};

export const api: Api = inTauri ? tauriApi : browserApi;

/** Tauri passes `Err(String)` through as a string; always produce readable text. */
export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
