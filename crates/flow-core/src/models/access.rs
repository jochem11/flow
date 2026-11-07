//! Accounts and sharing: who may do what with a project or board, and the
//! comments people leave on boards. Used by the server and the frontend.

use serde::{Deserialize, Serialize};
use specta::Type;

/// What someone may do with a project or a board. Each role can do everything
/// the ones before it can (`Role::Editor >= Role::Commenter`).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Type,
)]
#[serde(rename_all = "camelCase")]
pub enum Role {
    /// Not even visible (a board hidden from a project member)
    None,
    Viewer,
    /// View, and add comments
    Commenter,
    Editor,
    /// Everything the owner can do (also inviting and removing people), except
    /// deleting the project or changing the owner
    CoOwner,
    /// Edit, and decide who has access
    Owner,
}

impl Role {
    pub fn can_view(self) -> bool {
        self >= Role::Viewer
    }
    pub fn can_comment(self) -> bool {
        self >= Role::Commenter
    }
    pub fn can_edit(self) -> bool {
        self >= Role::Editor
    }
    /// Invite people, change their roles, change the board's link
    pub fn can_manage(self) -> bool {
        self >= Role::CoOwner
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Role::None => "none",
            Role::Viewer => "viewer",
            Role::Commenter => "commenter",
            Role::Editor => "editor",
            Role::CoOwner => "coOwner",
            Role::Owner => "owner",
        }
    }
    pub fn parse(s: &str) -> Option<Role> {
        Some(match s {
            "none" => Role::None,
            "viewer" => Role::Viewer,
            "commenter" => Role::Commenter,
            "editor" => Role::Editor,
            "coOwner" => Role::CoOwner,
            "owner" => Role::Owner,
            _ => return None,
        })
    }
}

/// What a board's public link allows people who are not invited (also guests).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LinkAccess {
    /// Only people with access can open the link
    Restricted,
    /// Anyone with the link can view
    View,
    /// Anyone with the link can view and comment
    Comment,
}

impl LinkAccess {
    /// The most the link gives someone.
    pub fn role(self) -> Role {
        match self {
            LinkAccess::Restricted => Role::None,
            LinkAccess::View => Role::Viewer,
            LinkAccess::Comment => Role::Commenter,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            LinkAccess::Restricted => "restricted",
            LinkAccess::View => "view",
            LinkAccess::Comment => "comment",
        }
    }
    pub fn parse(s: &str) -> Option<LinkAccess> {
        Some(match s {
            "restricted" => LinkAccess::Restricted,
            "view" => LinkAccess::View,
            "comment" => LinkAccess::Comment,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

/// The logged-in user, as the app needs it.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub user: User,
    pub email_verified: bool,
    pub has_password: bool,
    pub has_google: bool,
}

/// Someone in a project, with their role there.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub user: User,
    pub role: Role,
}

/// Someone's access to one board: their project role, and the board's own
/// setting for them if it has one (which then counts instead).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardMember {
    pub user: User,
    pub project_role: Role,
    pub board_role: Option<Role>,
}

/// An invitation that has not been accepted yet.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub id: String,
    pub email: String,
    pub role: Role,
    /// Set for an invite to one board only
    pub document_id: Option<String>,
    pub invited_by: String,
    #[specta(type = f64)]
    pub created_at: i64,
}

/// A board's public link.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShareLink {
    pub token: String,
    pub access: LinkAccess,
}

/// Who has access to a board, for its Share dialog.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardAccess {
    pub members: Vec<BoardMember>,
    pub invites: Vec<Invite>,
    pub link: ShareLink,
    /// What the person asking may do
    pub role: Role,
}

/// What a share link opens.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SharedBoard {
    pub document_id: String,
    pub project_id: String,
    pub name: String,
    /// What the person who opened the link may do
    pub role: Role,
}

/// Where a comment is attached.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CommentAnchor {
    /// The board as a whole
    Board,
    /// A flowchart block
    Node { id: String },
    /// An EER table
    Entity { id: String },
    /// A kanban card
    Card { id: String },
    /// A spot on a flowchart or EER canvas
    Point { x: f64, y: f64 },
    /// A passage of a text document: the words, and a little of what is around
    /// them to find the right place when they occur more than once (as the W3C
    /// text quote selector)
    Text { quote: String, prefix: String, suffix: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CommentAuthor {
    /// None for a guest
    pub user_id: Option<String>,
    pub name: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub id: String,
    pub document_id: String,
    /// The comment this replies to; replies have the anchor of their thread
    pub parent_id: Option<String>,
    pub anchor: CommentAnchor,
    pub body: String,
    pub author: CommentAuthor,
    #[specta(type = f64)]
    pub created_at: i64,
    #[specta(type = Option<f64>)]
    pub edited_at: Option<i64>,
    #[specta(type = Option<f64>)]
    pub resolved_at: Option<i64>,
}
