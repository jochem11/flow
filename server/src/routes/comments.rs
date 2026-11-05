//! Comments on a board: threads attached to an item or a spot (`CommentAnchor`),
//! with replies. Commenters and up write them; guests can when the board's link
//! allows comments. People edit and delete their own; the owner can delete any.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{Comment, CommentAnchor, CommentAuthor, Role};
use serde::Deserialize;
use sqlx::types::Json as Db;

use super::projects::ms;
use crate::access::require_document;
use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::tokens;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/documents/{id}/comments", get(list).post(create))
        .route("/comments/{id}", put(edit).delete(delete))
        .route("/comments/{id}/resolve", put(resolve))
}

#[derive(sqlx::FromRow)]
struct CommentRow {
    id: String,
    document_id: String,
    parent_id: Option<String>,
    anchor: Db<CommentAnchor>,
    body: String,
    author_user_id: Option<String>,
    guest_id: Option<String>,
    author_name: String,
    avatar_url: Option<String>,
    created_at: DateTime<Utc>,
    edited_at: Option<DateTime<Utc>>,
    resolved_at: Option<DateTime<Utc>>,
}

impl CommentRow {
    fn comment(self) -> Comment {
        Comment {
            id: self.id,
            document_id: self.document_id,
            parent_id: self.parent_id,
            anchor: self.anchor.0,
            body: self.body,
            author: CommentAuthor { user_id: self.author_user_id, name: self.author_name, avatar_url: self.avatar_url },
            created_at: ms(self.created_at),
            edited_at: self.edited_at.map(ms),
            resolved_at: self.resolved_at.map(ms),
        }
    }
}

macro_rules! comment_select {
    () => {
        "SELECT c.id, c.document_id, c.parent_id, c.anchor, c.body, c.author_user_id, c.guest_id, coalesce(u.name, c.author_name) AS author_name,
    u.avatar_url, c.created_at, c.edited_at, c.resolved_at FROM comments c LEFT JOIN users u ON u.id = c.author_user_id"
    };
}

async fn load(state: &AppState, id: &str) -> ApiResult<CommentRow> {
    sqlx::query_as::<_, CommentRow>(concat!(comment_select!(), " WHERE c.id = $1")).bind(id).fetch_optional(&state.db).await?.ok_or_else(|| AppError::not_found("Comment"))
}

async fn list(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Vec<Comment>>> {
    require_document(&state, &caller, &id, Role::Viewer).await?;
    let rows = sqlx::query_as::<_, CommentRow>(concat!(comment_select!(), " WHERE c.document_id = $1 ORDER BY c.created_at")).bind(&id).fetch_all(&state.db).await?;
    Ok(Json(rows.into_iter().map(CommentRow::comment).collect()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewComment {
    anchor: Option<CommentAnchor>,
    body: String,
    parent_id: Option<String>,
}

fn clean(body: &str) -> ApiResult<String> {
    let body = body.trim();
    if body.is_empty() {
        return Err(AppError::bad("Write something first"));
    }
    if body.chars().count() > 5000 {
        return Err(AppError::bad("A comment can be at most 5000 characters"));
    }
    Ok(body.to_string())
}

async fn create(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(c): Json<NewComment>) -> ApiResult<Json<Comment>> {
    require_document(&state, &caller, &id, Role::Commenter).await?;
    let (user_id, guest_id, name) = match (&caller.user, &caller.guest) {
        (Some(u), _) => (Some(u.id.clone()), None, u.name.clone()),
        (None, Some(g)) => (None, Some(g.id.clone()), g.name.clone()),
        (None, None) => return Err(AppError::new(StatusCode::UNAUTHORIZED, "Choose a name to comment as a guest")),
    };
    // A reply goes in its thread, with the thread's anchor
    let anchor = match &c.parent_id {
        Some(p) => {
            let parent = load(&state, p).await?;
            if parent.document_id != id || parent.parent_id.is_some() {
                return Err(AppError::bad("Reply to a thread on this board"));
            }
            parent.anchor.0
        }
        None => c.anchor.unwrap_or(CommentAnchor::Board),
    };
    let comment_id = tokens::new_id();
    sqlx::query("INSERT INTO comments (id, document_id, parent_id, anchor, body, author_user_id, guest_id, author_name) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(&comment_id)
        .bind(&id)
        .bind(&c.parent_id)
        .bind(Db(&anchor))
        .bind(clean(&c.body)?)
        .bind(user_id)
        .bind(guest_id)
        .bind(name)
        .execute(&state.db)
        .await?;
    state.rooms.comments_changed(&id);
    Ok(Json(load(&state, &comment_id).await?.comment()))
}

fn is_author(caller: &Caller, c: &CommentRow) -> bool {
    match (&caller.user, &caller.guest) {
        (Some(u), _) => c.author_user_id.as_deref() == Some(u.id.as_str()),
        (None, Some(g)) => c.guest_id.as_deref() == Some(g.id.as_str()),
        _ => false,
    }
}

#[derive(Deserialize)]
struct Body {
    body: String,
}

async fn edit(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(b): Json<Body>) -> ApiResult<Json<Comment>> {
    let c = load(&state, &id).await?;
    require_document(&state, &caller, &c.document_id, Role::Commenter).await?;
    if !is_author(&caller, &c) {
        return Err(AppError::forbidden("You can only change your own comments"));
    }
    sqlx::query("UPDATE comments SET body = $2, edited_at = now() WHERE id = $1").bind(&id).bind(clean(&b.body)?).execute(&state.db).await?;
    state.rooms.comments_changed(&c.document_id);
    Ok(Json(load(&state, &id).await?.comment()))
}

async fn delete(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    let c = load(&state, &id).await?;
    let (_, role) = require_document(&state, &caller, &c.document_id, Role::Viewer).await?;
    if !is_author(&caller, &c) && !role.can_manage() {
        return Err(AppError::forbidden("You can only delete your own comments"));
    }
    sqlx::query("DELETE FROM comments WHERE id = $1").bind(&id).execute(&state.db).await?;
    state.rooms.comments_changed(&c.document_id);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Resolve {
    resolved: bool,
}

/// Marks a thread done (or open again).
async fn resolve(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(r): Json<Resolve>) -> ApiResult<Json<Comment>> {
    let c = load(&state, &id).await?;
    require_document(&state, &caller, &c.document_id, Role::Commenter).await?;
    if c.parent_id.is_some() {
        return Err(AppError::bad("Resolve the thread, not a reply"));
    }
    sqlx::query("UPDATE comments SET resolved_at = CASE WHEN $2 THEN now() END WHERE id = $1").bind(&id).bind(r.resolved).execute(&state.db).await?;
    state.rooms.comments_changed(&c.document_id);
    Ok(Json(load(&state, &id).await?.comment()))
}
