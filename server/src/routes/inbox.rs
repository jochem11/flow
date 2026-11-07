//! A person's inbox: who @mentioned them in a comment, and answers in threads
//! they wrote in. Made when a comment is written (`notify_comment`); a live
//! notice (events.rs) and, for a mention, a mail tell them at once.
//!
//! A mention is written in the comment as `@[Name](user id)`. Only people who can
//! see the board are notified: naming anyone else tells them nothing.

use std::collections::BTreeSet;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{Inbox, Notification, NotificationKind, Role};
use serde::Deserialize;

use super::projects::ms;
use crate::auth::Caller;
use crate::error::ApiResult;
use crate::mail;
use crate::state::AppState;
use crate::tokens;

pub fn routes() -> Router<AppState> {
    Router::new().route("/inbox", get(inbox)).route("/inbox/read", put(read))
}

/// The user ids in `@[Name](id)` mentions, in the order written.
pub fn mentioned(body: &str) -> Vec<String> {
    let mut out = vec![];
    let mut rest = body;
    while let Some(i) = rest.find("@[") {
        rest = &rest[i + 2..];
        let Some(close) = rest.find("](") else { break };
        let after = &rest[close + 2..];
        let Some(end) = after.find(')') else { break };
        let id = &after[..end];
        if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !out.iter().any(|x| x == id) {
            out.push(id.to_string());
        }
        rest = &after[end..];
    }
    out
}

/// The comment as plain text: mentions as `@Name`, shortened.
pub fn excerpt(body: &str) -> String {
    let mut s = String::new();
    let mut rest = body;
    while let Some(i) = rest.find("@[") {
        s.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        match (after.find("]("), after.find(')')) {
            (Some(close), Some(end)) if close < end => {
                s.push('@');
                s.push_str(&after[..close]);
                rest = &after[end + 1..];
            }
            _ => {
                s.push_str("@[");
                rest = after;
            }
        }
    }
    s.push_str(rest);
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() > 140 { format!("{}…", flat.chars().take(139).collect::<String>()) } else { flat }
}

/// Can this user see the board? (Its project's role, or a role on the board itself.)
async fn can_see(state: &AppState, user_id: &str, document_id: &str) -> ApiResult<bool> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT pm.role, dr.role FROM documents d
         JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
         LEFT JOIN project_members pm ON pm.project_id = d.project_id AND pm.user_id = $2
         LEFT JOIN document_roles dr ON dr.document_id = d.id AND dr.user_id = $2
         WHERE d.id = $1 AND d.deleted_at IS NULL",
    )
    .bind(document_id)
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;
    Ok(row.is_some_and(|(p, b)| crate::access::combine(p.as_deref().and_then(Role::parse), b.as_deref().and_then(Role::parse)).can_view()))
}

/// A comment was written: its mentions, and (for a reply) the others in the
/// thread, get a notice. Not the writer.
pub async fn notify_comment(state: &AppState, author: Option<&str>, author_name: &str, document_id: &str, comment_id: &str, thread: Option<&str>, body: &str) -> ApiResult<()> {
    let mut told: BTreeSet<String> = author.map(String::from).into_iter().collect();
    let text = excerpt(body);
    let (board,): (String,) = sqlx::query_as("SELECT name FROM documents WHERE id = $1").bind(document_id).fetch_one(&state.db).await?;
    for id in mentioned(body) {
        if told.contains(&id) || !can_see(state, &id, document_id).await? {
            continue;
        }
        add(state, &id, NotificationKind::Mention, document_id, comment_id, author_name, &text).await?;
        // A mail too, with a link to the board
        let to: Option<(String, String)> = sqlx::query_as("SELECT email, name FROM users WHERE id = $1").bind(&id).fetch_optional(&state.db).await?;
        if let Some((email, name)) = to {
            let link = format!("{}/d/{document_id}", state.config.public_url.trim_end_matches('/'));
            mail::send_later(&state.mailer, mail::mentioned(&email, &name, author_name, &board, &text, &link)).await;
        }
        told.insert(id);
    }
    // Everyone who wrote in the thread
    if let Some(root) = thread {
        let writers: Vec<(String,)> = sqlx::query_as("SELECT DISTINCT author_user_id FROM comments WHERE (id = $1 OR parent_id = $1) AND author_user_id IS NOT NULL")
            .bind(root)
            .fetch_all(&state.db)
            .await?;
        for (id,) in writers {
            if told.contains(&id) || !can_see(state, &id, document_id).await? {
                continue;
            }
            add(state, &id, NotificationKind::Reply, document_id, comment_id, author_name, &text).await?;
            told.insert(id);
        }
    }
    Ok(())
}

async fn add(state: &AppState, user_id: &str, kind: NotificationKind, document_id: &str, comment_id: &str, actor: &str, excerpt: &str) -> ApiResult<()> {
    let kind = match kind {
        NotificationKind::Mention => "mention",
        NotificationKind::Reply => "reply",
    };
    sqlx::query("INSERT INTO notifications (id, user_id, kind, document_id, comment_id, actor_name, excerpt) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(tokens::new_id())
        .bind(user_id)
        .bind(kind)
        .bind(document_id)
        .bind(comment_id)
        .bind(actor)
        .bind(excerpt)
        .execute(&state.db)
        .await?;
    state.events.inbox_changed(user_id);
    Ok(())
}

#[derive(sqlx::FromRow)]
struct Row {
    id: String,
    kind: String,
    project_id: Option<String>,
    project_name: Option<String>,
    document_id: Option<String>,
    document_name: Option<String>,
    comment_id: Option<String>,
    actor_name: String,
    excerpt: String,
    created_at: DateTime<Utc>,
    read_at: Option<DateTime<Utc>>,
}

/// The latest 50, and how many are unread. Only those on boards they can still see.
async fn inbox(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Inbox>> {
    let user = caller.user()?;
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT n.id, n.kind, d.project_id, p.name AS project_name, n.document_id, d.name AS document_name, n.comment_id, n.actor_name, n.excerpt, n.created_at, n.read_at
         FROM notifications n JOIN documents d ON d.id = n.document_id AND d.deleted_at IS NULL
         JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
         WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 50",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    let mut items = vec![];
    for r in rows {
        if !can_see(&state, &user.id, r.document_id.as_deref().unwrap_or("")).await? {
            continue;
        }
        items.push(Notification {
            id: r.id,
            kind: if r.kind == "reply" { NotificationKind::Reply } else { NotificationKind::Mention },
            project_id: r.project_id,
            project_name: r.project_name,
            document_id: r.document_id,
            document_name: r.document_name,
            comment_id: r.comment_id,
            actor: r.actor_name,
            excerpt: r.excerpt,
            created_at: ms(r.created_at),
            read_at: r.read_at.map(ms),
        });
    }
    let unread = items.iter().filter(|n| n.read_at.is_none()).count() as u32;
    Ok(Json(Inbox { items, unread }))
}

#[derive(Deserialize)]
struct Read {
    /// These; none: all of them
    ids: Option<Vec<String>>,
}

async fn read(State(state): State<AppState>, caller: Caller, Json(r): Json<Read>) -> ApiResult<StatusCode> {
    let user = caller.user()?;
    match r.ids {
        Some(ids) => sqlx::query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2) AND read_at IS NULL").bind(&user.id).bind(&ids).execute(&state.db).await?,
        None => sqlx::query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL").bind(&user.id).execute(&state.db).await?,
    };
    state.events.inbox_changed(&user.id);
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mentions_and_excerpts() {
        let body = "Hi @[Ann Lee](a1-b2), see this. @[Bo](b9) and @[Ann Lee](a1-b2) again; @[x](bad id) @[ok";
        assert_eq!(mentioned(body), ["a1-b2", "b9"]);
        assert_eq!(excerpt("Hi @[Ann Lee](a1)!\n\nLook."), "Hi @Ann Lee! Look.");
        assert_eq!(excerpt(&"x".repeat(200)).chars().count(), 140);
    }
}
