//! What is someone's own in the sidebar: starred items, recently opened boards,
//! and the trash (boards and projects deleted in the last 30 days).

use serde::{Deserialize, Serialize};
use specta::Type;

use super::{DiagramType, DocumentKind};

/// What a star or a trash item is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ItemKind {
    Project,
    Document,
}

impl ItemKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemKind::Project => "project",
            ItemKind::Document => "document",
        }
    }

    pub fn parse(s: &str) -> Option<ItemKind> {
        match s {
            "project" => Some(ItemKind::Project),
            "document" => Some(ItemKind::Document),
            _ => None,
        }
    }
}

/// A project or board someone starred.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Star {
    pub item_id: String,
    pub kind: ItemKind,
}

/// A board someone opened lately (newest first).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RecentBoard {
    pub document_id: String,
    pub project_id: String,
    pub name: String,
    pub kind: DocumentKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub diagram: Option<DiagramType>,
    /// Milliseconds since 1970
    #[specta(type = f64)]
    pub opened_at: u64,
}

/// A deleted board or project, which can be restored for 30 days.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub kind: ItemKind,
    pub name: String,
    /// A board's project (its id and name)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub project_name: Option<String>,
    /// A board's kind and type, for its icon
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub doc_kind: Option<DocumentKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub diagram: Option<DiagramType>,
    /// Milliseconds since 1970
    #[specta(type = f64)]
    pub deleted_at: u64,
}
