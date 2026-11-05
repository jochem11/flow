//! Version history of a board: saved states, kept by hand (named) or
//! automatically on save, to look back at and to restore. Editors only.
//! Restoring is done by the app: it puts the old content on the board as a
//! normal change, so everyone editing together gets it (see collab.rs).

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{DocContent, Role, Version, VersionMeta};
use serde::Deserialize;
use sqlx::types::Json as Db;

use super::projects::ms;
use crate::access::require_document;
use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::tokens;

/// Automatic versions: at most one per this many minutes of changes
const AUTO_EVERY_MINUTES: i32 = 30;
/// Automatic versions kept per board (named ones are always kept)
const AUTO_KEEP: i64 = 100;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/documents/{id}/versions", get(list).post(create))
        .route("/documents/{id}/versions/{version}", get(read))
}

macro_rules! version_columns {
    () => {
        "v.id, v.name, u.name AS created_by, v.created_at FROM document_versions v LEFT JOIN users u ON u.id = v.created_by"
    };
}

#[derive(sqlx::FromRow)]
struct VersionRow {
    id: String,
    name: Option<String>,
    created_by: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<VersionRow> for VersionMeta {
    fn from(r: VersionRow) -> Self {
        VersionMeta { id: r.id, name: r.name, created_by: r.created_by, created_at: ms(r.created_at) as u64 }
    }
}

async fn list(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Vec<VersionMeta>>> {
    require_document(&state, &caller, &id, Role::Editor).await?;
    let rows = sqlx::query_as::<_, VersionRow>(concat!("SELECT ", version_columns!(), " WHERE v.document_id = $1 ORDER BY v.created_at DESC LIMIT 300"))
        .bind(&id)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(rows.into_iter().map(Into::into).collect()))
}

#[derive(Deserialize)]
struct NewVersion {
    name: String,
}

/// Keeps the board as it is now, under a name.
async fn create(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(v): Json<NewVersion>) -> ApiResult<Json<VersionMeta>> {
    require_document(&state, &caller, &id, Role::Editor).await?;
    let name = v.name.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(AppError::bad("Give the version a name (at most 200 characters)"));
    }
    let version = tokens::new_id();
    sqlx::query("INSERT INTO document_versions (id, document_id, name, content, created_by) SELECT $1, id, $2, content, $3 FROM documents WHERE id = $4")
        .bind(&version)
        .bind(name)
        .bind(&caller.user()?.id)
        .bind(&id)
        .execute(&state.db)
        .await?;
    let row = sqlx::query_as::<_, VersionRow>(concat!("SELECT ", version_columns!(), " WHERE v.id = $1")).bind(&version).fetch_one(&state.db).await?;
    Ok(Json(row.into()))
}

#[derive(sqlx::FromRow)]
struct ContentRow {
    content: Db<DocContent>,
}

async fn read(State(state): State<AppState>, caller: Caller, Path((id, version)): Path<(String, String)>) -> ApiResult<Json<Version>> {
    require_document(&state, &caller, &id, Role::Editor).await?;
    let meta = sqlx::query_as::<_, VersionRow>(concat!("SELECT ", version_columns!(), " WHERE v.id = $1 AND v.document_id = $2"))
        .bind(&version)
        .bind(&id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found("Version"))?;
    let ContentRow { content } = sqlx::query_as("SELECT content FROM document_versions WHERE id = $1").bind(&version).fetch_one(&state.db).await?;
    Ok(Json(Version { meta: meta.into(), content: content.0 }))
}

/// After a save: keeps the board as it is now when the last version is older than
/// half an hour (or there is none), and lets go of the oldest automatic ones.
pub async fn keep_automatically(state: &AppState, document_id: &str, user_id: &str) -> ApiResult<()> {
    let inserted = sqlx::query(
        "INSERT INTO document_versions (id, document_id, content, created_by)
         SELECT $1, d.id, d.content, $2 FROM documents d
         WHERE d.id = $3 AND NOT EXISTS (
             SELECT 1 FROM document_versions v WHERE v.document_id = d.id AND v.created_at > now() - make_interval(mins => $4)
         )",
    )
    .bind(tokens::new_id())
    .bind(user_id)
    .bind(document_id)
    .bind(AUTO_EVERY_MINUTES)
    .execute(&state.db)
    .await?
    .rows_affected();
    if inserted > 0 {
        sqlx::query(
            "DELETE FROM document_versions WHERE id IN (
                 SELECT id FROM document_versions WHERE document_id = $1 AND name IS NULL ORDER BY created_at DESC OFFSET $2
             )",
        )
        .bind(document_id)
        .bind(AUTO_KEEP)
        .execute(&state.db)
        .await?;
    }
    Ok(())
}
