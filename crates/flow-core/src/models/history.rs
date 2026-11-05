//! Saved states of a board (version history) and boards to start from (templates).

use serde::{Deserialize, Serialize};
use specta::Type;

use super::{DocContent, DocumentKind};

/// A saved state of a board, without its content (the history list).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VersionMeta {
    pub id: String,
    /// Given when saved by hand; none for the ones kept automatically
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub name: Option<String>,
    /// The name of who saved it (or whose change was kept)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub created_by: Option<String>,
    /// Milliseconds since 1970
    #[specta(type = f64)]
    pub created_at: u64,
}

/// A saved state of a board, with its content.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub meta: VersionMeta,
    pub content: DocContent,
}

/// A board someone saved to start new boards from, without its content.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TemplateMeta {
    pub id: String,
    pub name: String,
    pub kind: DocumentKind,
    #[specta(type = f64)]
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub meta: TemplateMeta,
    pub content: DocContent,
}
