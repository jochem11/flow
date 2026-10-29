//! Kanban board: columns with cards, in the style of Azure Boards.
//!
//! Subtasks are regular cards with a `parent_id`, so each one can move through
//! the columns on its own. A card counts as done when its column has `done` set. Labels are defined once per board and cards refer
//! to them by id, so renaming a label updates every card that uses it.
//!
//! Fields added after the first version have `#[serde(default)]`, so boards
//! saved before they existed still load.

use serde::{Deserialize, Serialize};
use specta::Type;

use super::NodeColor;

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KanbanDoc {
    pub columns: Vec<KanbanColumn>,
    /// Labels that cards on this board can use
    #[serde(default)]
    pub labels: Vec<KanbanLabel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KanbanColumn {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub color: Option<NodeColor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub icon: Option<KanbanIcon>,
    /// Cards in this column count as done (e.g. "Done", "Archived").
    #[serde(default)]
    pub done: bool,
    pub cards: Vec<KanbanCard>,
}

/// A link from a card to a document of the same project, or to a part of one:
/// a group (section, swimlane, ...) in a flowchart, or a table in an EER diagram.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CardLink {
    /// The document
    pub doc_id: String,
    /// The group or table in it; missing means the whole document
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KanbanCard {
    pub id: String,
    pub title: String,
    pub description: String,
    /// Original estimate, in hours
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub expected_hours: Option<f64>,
    /// Time actually spent so far, in hours
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub spent_hours: Option<f64>,
    /// The parent card when this card is a subtask
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub parent_id: Option<String>,
    /// Ids of labels in `KanbanDoc::labels`
    #[serde(default)]
    pub label_ids: Vec<String>,
    /// Documents of the same project this card is about, or groups / tables in them
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<CardLink>,
    #[serde(default)]
    pub comments: Vec<KanbanComment>,

    #[serde(default)]
    pub time_entries: Vec<KanbanTimeEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KanbanLabel {
    pub id: String,
    pub name: String,
    pub color: NodeColor,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub icon: Option<KanbanIcon>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KanbanComment {
    pub id: String,
    /// Markdown
    pub text: String,
    /// Milliseconds since 1970
    #[specta(type = f64)]
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Option<f64>)]
    pub edited_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KanbanTimeEntry {
    pub id: String,
    #[specta(type = f64)]
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Option<f64>)]
    pub ended_at: Option<u64>,
    #[serde(default)]
    pub note: String,
}

/// The icons a column or label can have. The drawings live in the frontend
/// (`KANBAN_ICONS` in src/components/icons.tsx).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum KanbanIcon {
    Bug,
    Feature,
    Idea,
    Design,
    Research,
    Docs,
    Test,
    Deploy,
    Star,
    Flag,
}