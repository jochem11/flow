//! The trash: deleted boards and projects, restorable for 30 days.
//!
//! Deleting (documents.rs, projects.rs) only sets `deleted_at`; access checks and
//! lists skip those (access.rs). Here the trash is listed, restored and emptied,
//! and `purge` removes what has been in it for longer than 30 days.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{DocumentKind, ItemKind, Role, TrashItem};

use super::projects::ms;
use crate::access::require_project;
use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

/// How long things stay in the trash.
const KEEP_DAYS: i32 = 30;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/trash", get(list))
        .route("/trash/{id}/restore", post(restore))
        .route("/trash/{id}", delete(remove))
}

#[derive(sqlx::FromRow)]
struct DocRow {
    id: String,
    name: String,
    kind: String,
    diagram: Option<String>,
    project_id: String,
    project_name: String,
    role: String,
    deleted_at: DateTime<Utc>,
}

/// What the caller can restore: boards deleted from projects they edit (that are
/// not in the trash themselves), and projects they own. Newest first.
async fn list(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Vec<TrashItem>>> {
    let user = caller.user()?;
    let docs = sqlx::query_as::<_, DocRow>(
        "SELECT d.id, d.name, d.kind, d.content->'data'->>'diagram' AS diagram, d.project_id, p.name AS project_name, pm.role, d.deleted_at
         FROM documents d
         JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
         JOIN project_members pm ON pm.project_id = d.project_id AND pm.user_id = $1
         WHERE d.deleted_at IS NOT NULL",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    let projects: Vec<(String, String, DateTime<Utc>)> = sqlx::query_as(
        "SELECT p.id, p.name, p.deleted_at FROM projects p
         JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1 AND pm.role = 'owner'
         WHERE p.deleted_at IS NOT NULL",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;

    let mut items: Vec<TrashItem> = docs
        .into_iter()
        .filter(|d| Role::parse(&d.role).is_some_and(|r| r >= Role::Editor))
        .map(|d| TrashItem {
            id: d.id,
            kind: ItemKind::Document,
            name: d.name,
            project_id: Some(d.project_id),
            project_name: Some(d.project_name),
            doc_kind: serde_json::from_value::<DocumentKind>(serde_json::Value::String(d.kind)).ok(),
            diagram: d.diagram.and_then(|t| serde_json::from_value(serde_json::Value::String(t)).ok()),
            deleted_at: ms(d.deleted_at) as u64,
        })
        .collect();
    items.extend(projects.into_iter().map(|(id, name, at)| TrashItem {
        id,
        kind: ItemKind::Project,
        name,
        project_id: None,
        project_name: None,
        doc_kind: None,
        diagram: None,
        deleted_at: ms(at) as u64,
    }));
    items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(Json(items))
}

/// A deleted board's project, or None when `id` is not a deleted board.
async fn deleted_board(state: &AppState, id: &str) -> ApiResult<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT project_id FROM documents WHERE id = $1 AND deleted_at IS NOT NULL")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    Ok(row.map(|(p,)| p))
}

/// Whether `id` is a deleted project the caller owns.
async fn owns_deleted_project(state: &AppState, caller: &Caller, id: &str) -> ApiResult<bool> {
    let row: Option<(String,)> = sqlx::query_as(
        "SELECT p.id FROM projects p JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.role = 'owner'
         WHERE p.id = $1 AND p.deleted_at IS NOT NULL",
    )
    .bind(id)
    .bind(&caller.user()?.id)
    .fetch_optional(&state.db)
    .await?;
    Ok(row.is_some())
}

/// Back where it was. A board whose folder is gone meanwhile goes to the project's root.
async fn restore(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    if let Some(project_id) = deleted_board(&state, &id).await? {
        require_project(&state, &caller, &project_id, Role::Editor).await?;
        sqlx::query(
            "UPDATE documents d SET deleted_at = NULL,
               folder_id = CASE WHEN EXISTS (
                 SELECT 1 FROM projects p, jsonb_array_elements(p.folders) f
                 WHERE p.id = d.project_id AND f->>'id' = d.folder_id) THEN d.folder_id ELSE NULL END
             WHERE d.id = $1",
        )
        .bind(&id)
        .execute(&state.db)
        .await?;
        let (name,): (String,) = sqlx::query_as("SELECT name FROM documents WHERE id = $1").bind(&id).fetch_one(&state.db).await?;
        super::activity::record(&state, &project_id, &caller, flow_core::models::ActivityKind::Restored, Some((&id, &name)), None).await;
        crate::events::project_changed(&state, &project_id).await;
        return Ok(StatusCode::NO_CONTENT);
    }
    if owns_deleted_project(&state, &caller, &id).await? {
        sqlx::query("UPDATE projects SET deleted_at = NULL WHERE id = $1").bind(&id).execute(&state.db).await?;
        // Everyone in it sees it again
        let members: Vec<(String,)> = sqlx::query_as("SELECT user_id FROM project_members WHERE project_id = $1").bind(&id).fetch_all(&state.db).await?;
        for (user,) in members {
            state.events.access_changed(&user, &id);
        }
        return Ok(StatusCode::NO_CONTENT);
    }
    Err(AppError::not_found("In the trash"))
}

/// Deletes a board or project in the trash for good.
async fn remove(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    if let Some(project_id) = deleted_board(&state, &id).await? {
        require_project(&state, &caller, &project_id, Role::Editor).await?;
        sqlx::query("DELETE FROM documents WHERE id = $1").bind(&id).execute(&state.db).await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    if owns_deleted_project(&state, &caller, &id).await? {
        sqlx::query("DELETE FROM projects WHERE id = $1").bind(&id).execute(&state.db).await?;
        return Ok(StatusCode::NO_CONTENT);
    }
    Err(AppError::not_found("In the trash"))
}

/// Removes what has been in the trash for longer than 30 days (run every hour, see main.rs).
pub async fn purge(state: &AppState) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM documents WHERE deleted_at < now() - make_interval(days => $1)").bind(KEEP_DAYS).execute(&state.db).await?;
    sqlx::query("DELETE FROM projects WHERE deleted_at < now() - make_interval(days => $1)").bind(KEEP_DAYS).execute(&state.db).await?;
    Ok(())
}
