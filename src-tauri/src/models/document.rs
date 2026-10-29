use serde::{Deserialize, Serialize};
use specta::Type;

use super::{Camera, EerDoc, FlowDoc, KanbanDoc, TextDoc};

/// A document, stored as `projects/<project_id>/docs/<id>.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub project_id: String,
    /// `None` = at the root of the project
    pub folder_id: Option<String>,
    /// Position within its folder
    pub order: f64,
    pub name: String,
    pub content: DocContent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Option<f64>)]
    pub updated_at: Option<u64>,
}

/// The content of a document; each kind has its own data.
///
/// `tag` + `content` produce this shape in JSON (and TypeScript):
///   { "kind": "flow", "data": { "nodes": [...], ... } }
///   { "kind": "text", "data": { "markdown": "..." } }
/// In TypeScript this becomes a discriminated union on `kind`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", content = "data", rename_all = "lowercase")]
pub enum DocContent {
    Flow(FlowDoc),
    Text(TextDoc),
    Kanban(KanbanDoc),
    Eer(EerDoc),
}

/// Just the kind of a document, without its data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DocumentKind {
    Flow,
    Text,
    Kanban,
    Eer,
}

impl DocContent {
    pub fn kind(&self) -> DocumentKind {
        match self {
            Self::Flow(_) => DocumentKind::Flow,
            Self::Text(_) => DocumentKind::Text,
            Self::Kanban(_) => DocumentKind::Kanban,
            Self::Eer(_) => DocumentKind::Eer,
        }
    }

    /// Empty content for a new document of the given kind.
    pub fn empty(kind: DocumentKind) -> Self {
        match kind {
            DocumentKind::Flow => Self::Flow(FlowDoc {
                nodes: vec![],
                edges: vec![],
                camera: Camera::default(),
            }),
            DocumentKind::Text => Self::Text(TextDoc::default()),
            DocumentKind::Kanban => Self::Kanban(KanbanDoc::default()),
            DocumentKind::Eer => Self::Eer(EerDoc::default()),
        }
    }
}

/// What `list_documents` returns: everything the sidebar needs, without the content.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub id: String,
    pub project_id: String,
    pub folder_id: Option<String>,
    pub order: f64,
    pub name: String,
    pub kind: DocumentKind,
    #[specta(type = f64)]
    pub updated_at: u64,
}

impl Document {
    /// Consumes the document (`self`, not `&self`) so the strings can be moved
    /// into the meta instead of cloned. Rust convention: `into_*` takes ownership.
    pub fn into_meta(self) -> DocumentMeta {
        // Read the kind first: after this we move fields out of `self`.
        let kind = self.content.kind();
        DocumentMeta {
            id: self.id,
            project_id: self.project_id,
            folder_id: self.folder_id,
            order: self.order,
            name: self.name,
            kind,
            updated_at: self.updated_at.unwrap_or(0),
        }
    }
}
