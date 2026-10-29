//! Tauri commands called by the frontend, one file per area.
//!
//! Every command has `#[specta::specta]`, which generates a typed function in
//! `src/bindings.ts` (`list_projects` becomes `commands.listProjects()`).
//! New command? Also add it to `collect_commands!` in lib.rs.
//!
//! An `Err(String)` arrives in TypeScript as `{ status: "error", error }`;
//! `src/lib/api.ts` turns that into a regular exception.
//!
//!   projects.rs   projects, plus the `load_project` / `save_project` helpers
//!   folders.rs    folders inside a project (a tree via `parent_id`)
//!   documents.rs  documents: list, load, save, create, rename, move, delete
//!   flow.rs       flowchart auto-layout and export (Mermaid, SVG, PNG)
//!   flow_svg.rs   drawing a flowchart as SVG (no commands)
//!   eer.rs        SQL from an EER diagram, for several databases
//!   codegen.rs    code from the UML classes in a flowchart, for several languages

pub mod code_import;
pub mod codegen;
pub mod documents;
pub mod eer;
pub mod flow;
mod flow_svg;
pub mod mermaid;
pub mod sql_import;
pub mod folders;
pub mod projects;
