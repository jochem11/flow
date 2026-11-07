//! What reaches a person and what happens in a project: the inbox (mentions and
//! replies) and the activity of a project.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationKind {
    /// Someone @mentioned you in a comment
    Mention,
    /// Someone answered in a thread you wrote in
    Reply,
}

/// One notice in someone's inbox.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: String,
    pub kind: NotificationKind,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub document_id: Option<String>,
    pub document_name: Option<String>,
    /// The comment it is about (for mentions and replies), to show its thread
    pub comment_id: Option<String>,
    /// Who did it
    pub actor: String,
    /// The start of the comment
    pub excerpt: String,
    #[specta(type = f64)]
    pub created_at: i64,
    #[specta(type = Option<f64>)]
    pub read_at: Option<i64>,
}

/// The inbox: the latest notices, and how many are unread.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    pub items: Vec<Notification>,
    pub unread: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ActivityKind {
    Created,
    Edited,
    Renamed,
    Deleted,
    Restored,
    Commented,
    /// Someone joined the project or was given a board in it
    Joined,
}

/// One thing that happened in a project.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub kind: ActivityKind,
    pub actor: String,
    pub actor_avatar: Option<String>,
    pub document_id: Option<String>,
    /// The board's name then (it may be renamed or deleted since)
    pub document_name: Option<String>,
    /// A renamed board's old name, a comment's start
    pub detail: Option<String>,
    #[specta(type = f64)]
    pub at: i64,
    /// Edits by one person to one board close together are one entry: how many
    pub count: u32,
}
