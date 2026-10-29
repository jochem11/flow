// Types are generated from Rust (src-tauri/src/models/) by tauri-specta into
// `src/bindings.ts`, on `npm run tauri dev` or `npm run bindings`.
// To change a type, change the Rust model, not this file.

export type {
  // workspace
  Project,
  Folder,
  Document,
  DocumentMeta,
  DocumentKind,
  DocContent,
  // flowchart
  FlowDoc,
  Camera,
  Point,
  ExportFormat,
  CodeLanguage,
  CodeFile,
  CodeImport,
  NodeColor,
  NodeKind,
  Position,
  // `Node` clashes with the DOM's `Node` type, so the frontend calls them FlowNode/FlowEdge
  Node as FlowNode,
  Edge as FlowEdge,
  EdgeStyle,
  EdgeCap,
  LinePattern,
  LabelSide,
  Lane,
  // other document kinds
  TextDoc,
  KanbanDoc,
  KanbanColumn,
  KanbanCard,
  CardLink,
  KanbanLabel,
  KanbanComment,
  KanbanTimeEntry,
  KanbanIcon,
  EerDoc,
  Entity,
  Attribute,
  Relation,
  Cardinality,
  ColumnPair,
  DataType,
  RefAction,
  SqlDialect,
  SqlImport,
} from "../bindings";
