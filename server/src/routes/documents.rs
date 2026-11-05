//! Boards (documents): listed with the caller's role on each, read by anyone who
//! may view them (also through a share link), changed by editors.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::folders::{ensure_folder_exists, next_order};
use flow_core::models::{DocContent, Document, DocumentKind, DocumentMeta, Role};
use serde::Deserialize;
use sqlx::types::Json as Db;

use super::projects::{Move, load, ms};
use crate::access::{combine, require_document, require_project};
use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::tokens;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/projects/{id}/documents", get(list).post(create))
        .route("/documents/{id}", get(read).put(save).delete(delete))
        .route("/documents/{id}/name", put(rename))
        .route("/documents/{id}/move", put(move_to))
        .route("/projects/{id}/upload", post(upload))
}

pub fn kind_str(k: DocumentKind) -> &'static str {
    match k {
        DocumentKind::Flow => "flow",
        DocumentKind::Text => "text",
        DocumentKind::Kanban => "kanban",
        DocumentKind::Eer => "eer",
    }
}

pub fn parse_kind(s: &str) -> DocumentKind {
    match s {
        "text" => DocumentKind::Text,
        "kanban" => DocumentKind::Kanban,
        "eer" => DocumentKind::Eer,
        _ => DocumentKind::Flow,
    }
}

#[derive(sqlx::FromRow)]
struct MetaRow {
    id: String,
    project_id: String,
    folder_id: Option<String>,
    sort_order: f64,
    name: String,
    kind: String,
    updated_at: DateTime<Utc>,
    project_role: Option<String>,
    board_role: Option<String>,
    /// A flow board's type, read from its content
    diagram: Option<String>,
}

/// The boards of a project the user can see, with their role on each.
async fn list(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Vec<DocumentMeta>>> {
    require_project(&state, &caller, &id, Role::None).await?;
    let rows = sqlx::query_as::<_, MetaRow>(
        "SELECT d.id, d.project_id, d.folder_id, d.sort_order, d.name, d.kind, d.updated_at, pm.role AS project_role, dr.role AS board_role,
                d.content->'data'->>'diagram' AS diagram
         FROM documents d
         LEFT JOIN project_members pm ON pm.project_id = d.project_id AND pm.user_id = $2
         LEFT JOIN document_roles dr ON dr.document_id = d.id AND dr.user_id = $2
         WHERE d.project_id = $1 AND d.deleted_at IS NULL ORDER BY d.sort_order",
    )
    .bind(&id)
    .bind(&caller.user()?.id)
    .fetch_all(&state.db)
    .await?;
    let metas = rows
        .into_iter()
        .filter_map(|r| {
            let role = combine(r.project_role.as_deref().and_then(Role::parse), r.board_role.as_deref().and_then(Role::parse));
            role.can_view().then(|| DocumentMeta {
                id: r.id,
                project_id: r.project_id,
                folder_id: r.folder_id,
                order: r.sort_order,
                name: r.name,
                kind: parse_kind(&r.kind),
                updated_at: ms(r.updated_at) as u64,
                role: Some(role),
                diagram: r.diagram.and_then(|d| serde_json::from_value(serde_json::Value::String(d)).ok()),
            })
        })
        .collect();
    Ok(Json(metas))
}

#[derive(sqlx::FromRow)]
struct DocRow {
    id: String,
    project_id: String,
    folder_id: Option<String>,
    sort_order: f64,
    name: String,
    content: Db<DocContent>,
    updated_at: DateTime<Utc>,
}

pub async fn load_document(state: &AppState, id: &str) -> ApiResult<Document> {
    let r = sqlx::query_as::<_, DocRow>("SELECT id, project_id, folder_id, sort_order, name, content, updated_at FROM documents WHERE id = $1").bind(id).fetch_one(&state.db).await?;
    Ok(Document { id: r.id, project_id: r.project_id, folder_id: r.folder_id, order: r.sort_order, name: r.name, content: r.content.0, updated_at: Some(ms(r.updated_at) as u64) })
}

async fn read(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Document>> {
    require_document(&state, &caller, &id, Role::Viewer).await?;
    Ok(Json(load_document(&state, &id).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewDocument {
    folder_id: Option<String>,
    name: String,
    kind: DocumentKind,
    /// What it starts with (from a template); empty when missing
    #[serde(default)]
    content: Option<DocContent>,
}

async fn create(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(d): Json<NewDocument>) -> ApiResult<Json<Document>> {
    require_project(&state, &caller, &id, Role::Editor).await?;
    let project = load(&state, &caller.user()?.id, &id).await?;
    ensure_folder_exists(&project, d.folder_id.as_deref())?;
    let (max,): (Option<f64>,) = sqlx::query_as("SELECT max(sort_order) FROM documents WHERE project_id = $1 AND folder_id IS NOT DISTINCT FROM $2").bind(&id).bind(&d.folder_id).fetch_one(&state.db).await?;
    let content = match d.content {
        Some(c) if c.kind() != d.kind => return Err(AppError::bad("The content is not of the board's kind")),
        Some(c) => c,
        None => DocContent::empty(d.kind),
    };
    let doc_id = tokens::new_id();
    insert(&state, &doc_id, &id, d.folder_id.as_deref(), next_order(max.into_iter()), &d.name, &content).await?;
    crate::events::project_changed(&state, &id).await;
    Ok(Json(load_document(&state, &doc_id).await?))
}

async fn insert(state: &AppState, id: &str, project_id: &str, folder_id: Option<&str>, order: f64, name: &str, content: &DocContent) -> ApiResult<()> {
    sqlx::query("INSERT INTO documents (id, project_id, folder_id, sort_order, name, kind, content) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(id)
        .bind(project_id)
        .bind(folder_id)
        .bind(order)
        .bind(name)
        .bind(kind_str(content.kind()))
        .bind(Db(content))
        .execute(&state.db)
        .await?;
    Ok(())
}

/// Autosave: the board's content (its name and place have their own calls).
async fn save(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(doc): Json<Document>) -> ApiResult<StatusCode> {
    require_document(&state, &caller, &id, Role::Editor).await?;
    let (kind,): (String,) = sqlx::query_as("SELECT kind FROM documents WHERE id = $1").bind(&id).fetch_one(&state.db).await?;
    if kind != kind_str(doc.content.kind()) {
        return Err(AppError::bad("A board cannot change its kind"));
    }
    sqlx::query("UPDATE documents SET content = $2, updated_at = now() WHERE id = $1").bind(&id).bind(Db(&doc.content)).execute(&state.db).await?;
    // Now and then the board as it is now goes in its history
    super::history::keep_automatically(&state, &id, &caller.user()?.id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

async fn rename(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(n): Json<Name>) -> ApiResult<StatusCode> {
    let (project_id, _) = require_document(&state, &caller, &id, Role::Editor).await?;
    if n.name.trim().is_empty() {
        return Err(AppError::bad("name cannot be empty"));
    }
    sqlx::query("UPDATE documents SET name = $2 WHERE id = $1").bind(&id).bind(n.name.trim()).execute(&state.db).await?;
    crate::events::project_changed(&state, &project_id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Moves a board to another folder (`parentId`: the folder, None = project root) and/or position.
async fn move_to(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(m): Json<Move>) -> ApiResult<StatusCode> {
    let (project_id, _) = require_document(&state, &caller, &id, Role::Editor).await?;
    let project = load(&state, &caller.user()?.id, &project_id).await?;
    ensure_folder_exists(&project, m.parent_id.as_deref())?;
    sqlx::query("UPDATE documents SET folder_id = $2, sort_order = $3 WHERE id = $1").bind(&id).bind(m.parent_id).bind(m.order).execute(&state.db).await?;
    crate::events::project_changed(&state, &project_id).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    let (project_id, _) = require_document(&state, &caller, &id, Role::Editor).await?;
    // Deleting is for editors of the project, not of this one board only
    require_project(&state, &caller, &project_id, Role::Editor).await?;
    // To the trash: restorable for 30 days (see routes/trash.rs)
    sqlx::query("UPDATE documents SET deleted_at = now() WHERE id = $1").bind(&id).execute(&state.db).await?;
    // Whoever has it open loses it now
    state.rooms.kick_board(&id);
    crate::events::project_changed(&state, &project_id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Uploads a board from the desktop app as it is, keeping its id (other boards link to it).
async fn upload(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(doc): Json<Document>) -> ApiResult<StatusCode> {
    require_project(&state, &caller, &id, Role::Editor).await?;
    if uuid::Uuid::parse_str(&doc.id).is_err() {
        return Err(AppError::bad("A board id must be a UUID"));
    }
    let exists: Option<(String,)> = sqlx::query_as("SELECT id FROM documents WHERE id = $1").bind(&doc.id).fetch_optional(&state.db).await?;
    if exists.is_some() {
        return Err(AppError::conflict("This board was already uploaded"));
    }
    insert(&state, &doc.id, &id, doc.folder_id.as_deref(), doc.order, &doc.name, &doc.content).await?;
    crate::events::project_changed(&state, &id).await;
    Ok(StatusCode::CREATED)
}
