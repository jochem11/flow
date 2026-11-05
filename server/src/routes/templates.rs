//! Templates: boards someone saved to start new boards from. Each person has
//! their own; the app also has built-in ones (src/templates/).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{DocContent, Role, Template, TemplateMeta};
use serde::Deserialize;
use sqlx::types::Json as Db;

use super::documents::{kind_str, load_document, parse_kind};
use super::projects::ms;
use crate::access::require_document;
use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::tokens;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/templates", get(list).post(create))
        .route("/templates/{id}", post(rename).get(read).delete(remove))
}

#[derive(sqlx::FromRow)]
struct TemplateRow {
    id: String,
    name: String,
    kind: String,
    created_at: DateTime<Utc>,
}

impl From<TemplateRow> for TemplateMeta {
    fn from(r: TemplateRow) -> Self {
        TemplateMeta { id: r.id, name: r.name, kind: parse_kind(&r.kind), created_at: ms(r.created_at) as u64 }
    }
}

async fn list(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Vec<TemplateMeta>>> {
    let rows = sqlx::query_as::<_, TemplateRow>("SELECT id, name, kind, created_at FROM templates WHERE owner_id = $1 ORDER BY created_at DESC")
        .bind(&caller.user()?.id)
        .fetch_all(&state.db)
        .await?;
    Ok(Json(rows.into_iter().map(Into::into).collect()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewTemplate {
    name: String,
    /// The board to make it from (as it is now)
    document_id: String,
}

fn check_name(name: &str) -> ApiResult<&str> {
    let name = name.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(AppError::bad("Give the template a name (at most 200 characters)"));
    }
    Ok(name)
}

async fn create(State(state): State<AppState>, caller: Caller, Json(t): Json<NewTemplate>) -> ApiResult<Json<TemplateMeta>> {
    let user = caller.user()?;
    // Anyone who can see a board may start their own boards from it
    require_document(&state, &caller, &t.document_id, Role::Viewer).await?;
    let name = check_name(&t.name)?;
    let doc = load_document(&state, &t.document_id).await?;
    let id = tokens::new_id();
    let row = sqlx::query_as::<_, TemplateRow>(
        "INSERT INTO templates (id, owner_id, name, kind, content) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, kind, created_at",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(name)
    .bind(kind_str(doc.content.kind()))
    .bind(Db(&doc.content))
    .fetch_one(&state.db)
    .await?;
    Ok(Json(row.into()))
}

#[derive(sqlx::FromRow)]
struct FullRow {
    id: String,
    name: String,
    kind: String,
    created_at: DateTime<Utc>,
    content: Db<DocContent>,
}

async fn read(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Template>> {
    let r = sqlx::query_as::<_, FullRow>("SELECT id, name, kind, created_at, content FROM templates WHERE id = $1 AND owner_id = $2")
        .bind(&id)
        .bind(&caller.user()?.id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found("Template"))?;
    let content = r.content.0;
    Ok(Json(Template { meta: TemplateRow { id: r.id, name: r.name, kind: r.kind, created_at: r.created_at }.into(), content }))
}

#[derive(Deserialize)]
struct Rename {
    name: String,
}

async fn rename(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(r): Json<Rename>) -> ApiResult<StatusCode> {
    let name = check_name(&r.name)?;
    let done = sqlx::query("UPDATE templates SET name = $3 WHERE id = $1 AND owner_id = $2").bind(&id).bind(&caller.user()?.id).bind(name).execute(&state.db).await?;
    if done.rows_affected() == 0 {
        return Err(AppError::not_found("Template"));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    sqlx::query("DELETE FROM templates WHERE id = $1 AND owner_id = $2").bind(&id).bind(&caller.user()?.id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
