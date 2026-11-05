//! Projects and their folders. A project lists for everyone in it (and for
//! people invited to some of its boards); its folders are edited by editors.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::folders;
use flow_core::models::{Folder, Project, Role};
use serde::Deserialize;
use sqlx::types::Json as Db;

use crate::access::require_project;
use crate::auth::Caller;
use crate::error::ApiResult;
use crate::state::AppState;
use crate::tokens;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/projects", get(list).post(create))
        .route("/projects/{id}", put(update).delete(delete))
        .route("/projects/{id}/folders", post(create_folder))
        .route("/projects/{id}/folders/{folder}", put(rename_folder).delete(delete_folder))
        .route("/projects/{id}/folders/{folder}/move", put(move_folder))
}

pub fn ms(t: DateTime<Utc>) -> i64 {
    t.timestamp_millis()
}

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: String,
    name: String,
    description: String,
    folders: Db<Vec<Folder>>,
    updated_at: DateTime<Utc>,
    role: String,
    sidebar_order: f64,
}

impl ProjectRow {
    fn project(self) -> Project {
        Project {
            id: self.id,
            name: self.name,
            description: self.description,
            folders: self.folders.0,
            order: self.sidebar_order,
            updated_at: Some(ms(self.updated_at) as u64),
            role: Role::parse(&self.role),
        }
    }
}

macro_rules! project_columns {
    () => {
        "p.id, p.name, p.description, p.folders, p.updated_at, pm.role, pm.sidebar_order"
    };
}

/// The projects of the logged-in user, own and shared, in their sidebar order.
async fn list(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Vec<Project>>> {
    let user = caller.user()?;
    let rows = sqlx::query_as::<_, ProjectRow>(concat!("SELECT ", project_columns!(), " FROM projects p JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $1
         WHERE p.deleted_at IS NULL AND (pm.role <> 'none' OR EXISTS (
           SELECT 1 FROM document_roles r JOIN documents d ON d.id = r.document_id
           WHERE d.project_id = p.id AND r.user_id = $1 AND r.role <> 'none' AND d.deleted_at IS NULL))
         ORDER BY pm.sidebar_order"))
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.into_iter().map(ProjectRow::project).collect()))
}

/// The position after the user's last project.
pub async fn next_sidebar_order(state: &AppState, user_id: &str) -> ApiResult<f64> {
    let (max,): (Option<f64>,) = sqlx::query_as("SELECT max(sidebar_order) FROM project_members WHERE user_id = $1").bind(user_id).fetch_one(&state.db).await?;
    Ok(max.unwrap_or(0.0) + 1.0)
}

#[derive(Deserialize)]
struct NewProject {
    name: String,
    /// Keeps the id of a project uploaded from the desktop app
    id: Option<String>,
    description: Option<String>,
    folders: Option<Vec<Folder>>,
}

async fn create(State(state): State<AppState>, caller: Caller, Json(p): Json<NewProject>) -> ApiResult<Json<Project>> {
    let user = caller.user()?;
    let id = p.id.filter(|id| uuid::Uuid::parse_str(id).is_ok()).unwrap_or_else(tokens::new_id);
    let order = next_sidebar_order(&state, &user.id).await?;
    let mut tx = state.db.begin().await?;
    sqlx::query("INSERT INTO projects (id, owner_id, name, description, folders) VALUES ($1, $2, $3, $4, $5)")
        .bind(&id)
        .bind(&user.id)
        .bind(p.name.trim())
        .bind(p.description.unwrap_or_default())
        .bind(Db(p.folders.unwrap_or_default()))
        .execute(&mut *tx)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(d) if d.is_unique_violation() => crate::error::AppError::conflict("A project with this id already exists"),
            e => e.into(),
        })?;
    sqlx::query("INSERT INTO project_members (project_id, user_id, role, sidebar_order) VALUES ($1, $2, 'owner', $3)").bind(&id).bind(&user.id).bind(order).execute(&mut *tx).await?;
    tx.commit().await?;
    load(&state, &user.id, &id).await.map(Json)
}

/// A project as the user sees it.
pub async fn load(state: &AppState, user_id: &str, id: &str) -> ApiResult<Project> {
    Ok(sqlx::query_as::<_, ProjectRow>(concat!("SELECT ", project_columns!(), " FROM projects p JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = $2 WHERE p.id = $1"))
        .bind(id)
        .bind(user_id)
        .fetch_one(&state.db)
        .await?
        .project())
}

#[derive(Deserialize)]
struct UpdateProject {
    name: String,
    description: String,
}

async fn update(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(u): Json<UpdateProject>) -> ApiResult<StatusCode> {
    require_project(&state, &caller, &id, Role::Editor).await?;
    sqlx::query("UPDATE projects SET name = $2, description = $3, updated_at = now() WHERE id = $1").bind(&id).bind(u.name.trim()).bind(u.description).execute(&state.db).await?;
    crate::events::project_changed(&state, &id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Deletes a project with all its boards (owner only).
async fn delete(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    require_project(&state, &caller, &id, Role::Owner).await?;
    // Everyone in it loses it at once
    let members: Vec<(String,)> = sqlx::query_as("SELECT user_id FROM project_members WHERE project_id = $1").bind(&id).fetch_all(&state.db).await?;
    // To the trash: restorable by the owner for 30 days (see routes/trash.rs)
    sqlx::query("UPDATE projects SET deleted_at = now() WHERE id = $1").bind(&id).execute(&state.db).await?;
    for (user,) in members {
        state.events.access_changed(&user, &id);
        state.rooms.kick_user(&user);
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---------- folders ----------

async fn load_for_edit(state: &AppState, caller: &Caller, id: &str) -> ApiResult<Project> {
    require_project(state, caller, id, Role::Editor).await?;
    load(state, &caller.user()?.id, id).await
}

async fn save_folders(state: &AppState, p: &Project) -> ApiResult<()> {
    sqlx::query("UPDATE projects SET folders = $2, updated_at = now() WHERE id = $1").bind(&p.id).bind(Db(&p.folders)).execute(&state.db).await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewFolder {
    name: String,
    parent_id: Option<String>,
}

async fn create_folder(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(f): Json<NewFolder>) -> ApiResult<Json<Folder>> {
    let mut p = load_for_edit(&state, &caller, &id).await?;
    let folder = folders::add_folder(&mut p, tokens::new_id(), f.name, f.parent_id)?;
    save_folders(&state, &p).await?;
    crate::events::project_changed(&state, &id).await;
    Ok(Json(folder))
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

async fn rename_folder(State(state): State<AppState>, caller: Caller, Path((id, folder)): Path<(String, String)>, Json(n): Json<Name>) -> ApiResult<StatusCode> {
    let mut p = load_for_edit(&state, &caller, &id).await?;
    folders::rename_folder(&mut p, &folder, n.name)?;
    save_folders(&state, &p).await?;
    crate::events::project_changed(&state, &id).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Move {
    pub parent_id: Option<String>,
    pub order: f64,
}

async fn move_folder(State(state): State<AppState>, caller: Caller, Path((id, folder)): Path<(String, String)>, Json(m): Json<Move>) -> ApiResult<StatusCode> {
    let mut p = load_for_edit(&state, &caller, &id).await?;
    folders::move_folder(&mut p, &folder, m.parent_id, m.order)?;
    save_folders(&state, &p).await?;
    crate::events::project_changed(&state, &id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// Deletes a folder; what was in it moves up one level.
async fn delete_folder(State(state): State<AppState>, caller: Caller, Path((id, folder)): Path<(String, String)>) -> ApiResult<StatusCode> {
    let mut p = load_for_edit(&state, &caller, &id).await?;
    let parent = folders::remove_folder(&mut p, &folder)?;
    save_folders(&state, &p).await?;
    sqlx::query("UPDATE documents SET folder_id = $3 WHERE project_id = $1 AND folder_id = $2").bind(&id).bind(&folder).bind(parent).execute(&state.db).await?;
    crate::events::project_changed(&state, &id).await;
    Ok(StatusCode::NO_CONTENT)
}
