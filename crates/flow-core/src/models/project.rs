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
    /// What the logged-in user may do in this project (from the server; None in the desktop app's own files)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub role: Option<super::Role>,
    /// The project's look, for all its boards and their exports
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub brand: Option<Brand>,
}

/// A project's own look: an accent color (focal blocks, callouts) and a typeface.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Brand {
    /// A CSS hex color, `#2a78d6`; missing means the app's own
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub accent: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub font: Option<BrandFont>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum BrandFont {
    Sans,
    Serif,
    Mono,
    Rounded,
}

impl Brand {
    /// The accent when it is a valid `#rgb` / `#rrggbb` color (it goes into SVG and CSS)
    pub fn accent_color(&self) -> Option<&str> {
        self.accent.as_deref().filter(|a| {
            let h = a.strip_prefix('#').unwrap_or("");
            (h.len() == 3 || h.len() == 6) && h.chars().all(|c| c.is_ascii_hexdigit())
        })
    }
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
