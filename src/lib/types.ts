// De types komen uit Rust (src-tauri/src/models.rs) via tauri-specta.
// `src/bindings.ts` wordt gegenereerd bij `npm run tauri dev` of `cargo test`.
// Wil je een type aanpassen? Doe dat in Rust, niet hier.

export type {
  Board,
  BoardMeta,
  Camera,
  ExportFormat,
  NodeColor,
  NodeKind,
  Position,
  // `Node` botst met de DOM-type `Node`, dus in de frontend heten ze FlowNode/FlowEdge
  Node as FlowNode,
  Edge as FlowEdge,
} from "../bindings";
