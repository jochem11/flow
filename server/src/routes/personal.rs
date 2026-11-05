//! What is someone's own in the sidebar: starred projects and boards, and the
//! boards they opened lately ("Recent", the same on every device).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{DocumentKind, ItemKind, RecentBoard, Star};
use serde::Deserialize;

use super::projects::ms;
use crate::access::{combine, require_document};
use crate::auth::Caller;
use crate::error::ApiResult;
use crate::state::AppState;
use flow_core::models::Role;

/// How many boards "Recent" shows.
const RECENT: i64 = 8;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/stars", get(stars))
        .route("/stars/{id}", put(star).delete(unstar))
        .route("/recent", get(recent))
        .route("/documents/{id}/opened", post(opened))
}

async fn stars(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Vec<Star>>> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT item_id, kind FROM stars WHERE user_id = $1 ORDER BY created_at")
        .bind(&caller.user()?.id)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(rows.into_iter().filter_map(|(item_id, kind)| Some(Star { item_id, kind: ItemKind::parse(&kind)? })).collect()))
}

#[derive(Deserialize)]
struct NewStar {
    kind: ItemKind,
}

/// Stars a project or board (one the caller can see; the sidebar hides stars of
/// things that are gone or no longer shared).
async fn star(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(s): Json<NewStar>) -> ApiResult<StatusCode> {
    let user = caller.user()?;
    sqlx::query("INSERT INTO stars (user_id, item_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING")
        .bind(&user.id)
        .bind(&id)
        .bind(s.kind.as_str())
        .execute(&state.db)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unstar(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM stars WHERE user_id = $1 AND item_id = $2").bind(&caller.user()?.id).bind(&id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The app says a board was opened (for "Recent").
async fn opened(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    let Some(user) = caller.user.as_ref() else { return Ok(StatusCode::NO_CONTENT) };
    require_document(&state, &caller, &id, Role::Viewer).await?;
    sqlx::query(
        "INSERT INTO document_opens (user_id, document_id) VALUES ($1, $2)
         ON CONFLICT (user_id, document_id) DO UPDATE SET opened_at = now()",
    )
    .bind(&user.id)
    .bind(&id)
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(sqlx::FromRow)]
struct RecentRow {
    id: String,
    project_id: String,
    name: String,
    kind: String,
    diagram: Option<String>,
    opened_at: DateTime<Utc>,
    project_role: Option<String>,
    board_role: Option<String>,
}

/// The boards the caller opened last that they can still see, newest first.
async fn recent(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Vec<RecentBoard>>> {
    let user = caller.user()?;
    let rows = sqlx::query_as::<_, RecentRow>(
        "SELECT d.id, d.project_id, d.name, d.kind, d.content->'data'->>'diagram' AS diagram, o.opened_at,
                pm.role AS project_role, dr.role AS board_role
         FROM document_opens o
         JOIN documents d ON d.id = o.document_id AND d.deleted_at IS NULL
         JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
         LEFT JOIN project_members pm ON pm.project_id = d.project_id AND pm.user_id = $1
         LEFT JOIN document_roles dr ON dr.document_id = d.id AND dr.user_id = $1
         WHERE o.user_id = $1
         ORDER BY o.opened_at DESC
         LIMIT $2",
    )
    .bind(&user.id)
    .bind(RECENT * 2)
    .fetch_all(&state.db)
    .await?;
    let boards = rows
        .into_iter()
        .filter(|r| combine(r.project_role.as_deref().and_then(Role::parse), r.board_role.as_deref().and_then(Role::parse)).can_view())
        .take(RECENT as usize)
        .map(|r| RecentBoard {
            document_id: r.id,
            project_id: r.project_id,
            name: r.name,
            kind: serde_json::from_value::<DocumentKind>(serde_json::Value::String(r.kind)).unwrap_or(DocumentKind::Flow),
            diagram: r.diagram.and_then(|t| serde_json::from_value(serde_json::Value::String(t)).ok()),
            opened_at: ms(r.opened_at) as u64,
        })
        .collect();
    Ok(Json(boards))
}
