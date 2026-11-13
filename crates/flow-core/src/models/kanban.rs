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
    /// The prefix of the cards' ticket ids: `WEB` in `WEB-12`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub key: Option<String>,
    /// The number the next new card gets (numbers are never used twice)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub next_number: Option<u32>,
    /// Sprints, in the order they are planned. A card without a sprint is in the backlog.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[specta(optional)]
    pub sprints: Vec<Sprint>,
}

/// A sprint: a few weeks of work, with the cards picked for it (`KanbanCard::sprint_id`).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Sprint {
    pub id: String,
    pub name: String,
    /// What the sprint is for
    #[serde(default)]
    pub goal: String,
    /// `YYYY-MM-DD`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub start_date: Option<String>,
    /// `YYYY-MM-DD`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub state: SprintState,
    /// The day it was completed, `YYYY-MM-DD`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub completed_on: Option<String>,
    /// How many cards were not done when it was completed (they moved on)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub carried_over: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum SprintState {
    /// Planned, not started
    #[default]
    Planned,
    Active,
    /// Completed: its cards no longer show on the board
    Done,
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
    /// The number in its ticket id (`12` in `WEB-12`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub number: Option<u32>,
    /// The sprint it is planned in; none: the backlog
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub sprint_id: Option<String>,
    /// Its place in the backlog and in its sprint: lower comes first
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub rank: Option<f64>,
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
    /// The people working on it (user ids of people with access to the board)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[specta(optional)]
    pub assignee_ids: Vec<String>,
    /// When work on it starts, `YYYY-MM-DD` (for the timeline)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub start_date: Option<String>,
    /// When it must be done, `YYYY-MM-DD`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub due_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub priority: Option<Priority>,
    /// Cards on this board that must be done before this one can be
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[specta(optional)]
    pub blocked_by: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Priority {
    Urgent,
    High,
    Medium,
    Low,
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
    /// Who spent the time (the user id; none in the desktop app's own files)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub user_id: Option<String>,
    /// Their name when they logged it, so it still reads after they leave
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub user_name: Option<String>,
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