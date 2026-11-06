// All communication with the backend goes through this file.
//
// Projects and boards live on the Flow server (`httpApi`, see server.ts). What
// is made from a board (layout, exports, SQL, code, Mermaid, imports) runs in
// Rust: in the desktop app locally through the generated, typed `commands` from
// `src/bindings.ts`, in the web version on the server (`/api/tools`).
//
// `localFiles` reads the projects the desktop app kept on disk before accounts
// existed, to upload them (see upload.ts).

import { commands } from "../bindings";
import { del, get, inTauri, post, put, rawRequest } from "./server";
import type { Brand, DocContent,
  Document,
  DocumentKind,
  DocumentMeta,
  CodeFile,
  CodeImport,
  DiagramImport,
  CodeLanguage,
  EerDoc,
  ExportFormat,
  FlowDoc,
  FlowEdge,
  FlowNode,
  Folder,
  Arranged,
  Project,
  SqlDialect,
  SqlImport,
} from "./types";

export { inTauri };

export interface Api {
  // projects
  listProjects(): Promise<Project[]>;
  createProject(name: string): Promise<Project>;
  updateProject(id: string, name: string, description: string): Promise<void>;
  /** The project's look for all its boards (empty: the app's own) */
  setProjectBrand(id: string, brand: Brand): Promise<void>;
  deleteProject(id: string): Promise<void>;
  // folders
  createFolder(projectId: string, name: string, parentId: string | null): Promise<Folder>;
  renameFolder(projectId: string, folderId: string, name: string): Promise<void>;
  moveFolder(projectId: string, folderId: string, parentId: string | null, order: number): Promise<void>;
  deleteFolder(projectId: string, folderId: string): Promise<void>;
  // documents
  listDocuments(projectId: string): Promise<DocumentMeta[]>;
  loadDocument(projectId: string, id: string): Promise<Document>;
  /** `content`: what it starts with (from a template); empty when left out */
  createDocument(projectId: string, folderId: string | null, name: string, kind: DocumentKind, content?: DocContent): Promise<Document>;
  saveDocument(doc: Document): Promise<void>;
  renameDocument(projectId: string, id: string, name: string): Promise<void>;
  moveDocument(projectId: string, id: string, folderId: string | null, order: number): Promise<void>;
  deleteDocument(projectId: string, id: string): Promise<void>;
  // flowchart
  /** Arrange: where the nodes go, and how the lines between them attach */
  autoLayout(nodes: FlowNode[], edges: FlowEdge[]): Promise<Arranged>;
  /** Returns the path of the file that was written */
  exportDocument(doc: Document, format: ExportFormat, brand?: Brand | null): Promise<string>;
  // EER
  /** The SQL for an EER diagram, to preview */
  eerSql(doc: EerDoc, dialect: SqlDialect): Promise<string>;
  /** Code for the UML classes in a flowchart, to preview */
  classCode(flow: FlowDoc, language: CodeLanguage): Promise<CodeFile[]>;
  /** The document as Mermaid: one block per diagram in it */
  mermaidPreview(doc: Document): Promise<CodeFile[]>;
  /** The tables and relations in a SQL script, to add to an EER diagram */
  importSql(sql: string): Promise<SqlImport>;
  /** The diagram as DBML (dbdiagram.io) */
  eerDbml(doc: EerDoc): Promise<string>;
  /** The tables, relations and groups in DBML */
  importDbml(dbml: string): Promise<SqlImport>;
  /** UML classes from source code; without a language it is guessed */
  importCode(code: string, language: CodeLanguage | null): Promise<CodeImport>;
  /** Blocks and lines from a Mermaid diagram, a draw.io file or an Excalidraw drawing */
  importDiagram(text: string): Promise<DiagramImport>;
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

/** The desktop app's own files and Rust tools. */
export const localFiles: Api = {
  listProjects: () => unwrap(commands.listProjects()),
  createProject: (name) => unwrap(commands.createProject(name)),
  updateProject: (id, name, description) => done(commands.updateProject(id, name, description)),
  setProjectBrand: async () => {
    throw new Error("A look of its own needs a project on the server");
  },
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
  exportDocument: (doc, format, brand) => unwrap(commands.exportDocument(doc, format, brand ?? null)),
  eerSql: (doc, dialect) => commands.eerSql(doc, dialect),
  classCode: (flow, language) => commands.classCode(flow, language),
  mermaidPreview: (doc) => commands.mermaidPreview(doc),
  importSql: (sql) => commands.importSql(sql),
  eerDbml: (doc) => commands.eerDbml(doc),
  importDbml: (dbml) => commands.importDbml(dbml),
  importCode: (code, language) => commands.importCode(code, language),
  importDiagram: (text) => commands.importDiagram(text),
};

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

/** A download in the browser, of what the server sent. */
async function download(res: Response): Promise<string> {
  const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1];
  const file = name ? decodeURIComponent(name) : "export";
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: file });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return file;
}

type Tools = Pick<
  Api,
  "autoLayout" | "exportDocument" | "eerSql" | "classCode" | "mermaidPreview" | "importSql" | "importCode" | "eerDbml" | "importDbml" | "importDiagram"
>;

/** In the desktop app: Rust, locally (exports go to Downloads). */
const localTools: Tools = {
  autoLayout: localFiles.autoLayout,
  exportDocument: localFiles.exportDocument,
  eerSql: localFiles.eerSql,
  classCode: localFiles.classCode,
  mermaidPreview: localFiles.mermaidPreview,
  importSql: localFiles.importSql,
  eerDbml: localFiles.eerDbml,
  importDbml: localFiles.importDbml,
  importCode: localFiles.importCode,
  importDiagram: localFiles.importDiagram,
};

/** In the web version: the same Rust, on the server (exports download in the browser). */
const webTools: Tools = {
  autoLayout: (nodes, edges) => post("/tools/layout", { nodes, edges }),
  exportDocument: async (doc, format, brand) => download(await rawRequest("POST", "/tools/export", { doc, format, brand: brand ?? null })),
  eerSql: (doc, dialect) => post("/tools/sql", { doc, dialect }),
  classCode: (flow, language) => post("/tools/code", { flow, language }),
  mermaidPreview: (doc) => post("/tools/mermaid", { doc }),
  importSql: (sql) => post("/tools/import-sql", { sql }),
  eerDbml: (doc) => post("/tools/dbml", { doc }),
  importDbml: (dbml) => post("/tools/import-dbml", { dbml }),
  importCode: (code, language) => post("/tools/import-code", { code, language }),
  importDiagram: (text) => post("/tools/import-diagram", { text }),
};

const httpApi: Api = {
  listProjects: () => get("/projects"),
  createProject: (name) => post("/projects", { name }),
  updateProject: (id, name, description) => put(`/projects/${id}`, { name, description }),
  setProjectBrand: (id, brand) => put(`/projects/${id}/brand`, brand),
  deleteProject: (id) => del(`/projects/${id}`),

  createFolder: (projectId, name, parentId) => post(`/projects/${projectId}/folders`, { name, parentId }),
  renameFolder: (projectId, folderId, name) => put(`/projects/${projectId}/folders/${folderId}`, { name }),
  moveFolder: (projectId, folderId, parentId, order) => put(`/projects/${projectId}/folders/${folderId}/move`, { parentId, order }),
  deleteFolder: (projectId, folderId) => del(`/projects/${projectId}/folders/${folderId}`),

  listDocuments: (projectId) => get(`/projects/${projectId}/documents`),
  loadDocument: (_projectId, id) => get(`/documents/${id}`),
  createDocument: (projectId, folderId, name, kind, content) => post(`/projects/${projectId}/documents`, { folderId, name, kind, content }),
  saveDocument: (doc) => put(`/documents/${doc.id}`, doc),
  renameDocument: (_projectId, id, name) => put(`/documents/${id}/name`, { name }),
  moveDocument: (_projectId, id, folderId, order) => put(`/documents/${id}/move`, { parentId: folderId, order }),
  deleteDocument: (_projectId, id) => del(`/documents/${id}`),

  ...(inTauri ? localTools : webTools),
};

export const api: Api = httpApi;

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
