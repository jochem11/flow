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
//!   session.rs    the Flow server session token, in the system keychain
//!   tools.rs      layout, export, SQL, Mermaid and imports: wrappers around
//!                 `flow_core`, where all of that lives (shared with the server)

pub mod documents;
pub mod folders;
pub mod projects;
pub mod session;
pub mod tools;
