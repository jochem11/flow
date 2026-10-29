use serde::{Deserialize, Serialize};
use specta::Type;

/// A project, stored as `projects/<id>/project.json`.
///
/// Folders live inside the project file rather than as real directories on
/// disk, so moving or renaming a folder only touches this one file.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    /// Project description in markdown
    pub description: String,
    pub folders: Vec<Folder>,
    /// Position in the sidebar
    pub order: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Option<f64>)]
    pub updated_at: Option<u64>,
}

/// A folder inside a project. Folders nest via `parent_id`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    /// `None` = at the root of the project
    pub parent_id: Option<String>,
    /// Position within the parent. An f64, so an item can be placed between
    /// 1 and 2 as 1.5 without renumbering its siblings.
    pub order: f64,
}
