//! What happens in a project, for its page: boards made, edited, renamed,
//! deleted and restored, comments, and people joining. Recorded by the routes
//! that do these (`record`); edits by one person to one board within half an
//! hour are one entry, counted.

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{Activity, ActivityKind, Role};
use serde::Deserialize;

use super::projects::ms;
use crate::access::require_project;
use crate::auth::Caller;
use crate::error::ApiResult;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/projects/{id}/activity", get(list))
}

fn kind_str(k: ActivityKind) -> &'static str {
    match k {
        ActivityKind::Created => "created",
        ActivityKind::Edited => "edited",
        ActivityKind::Renamed => "renamed",
        ActivityKind::Deleted => "deleted",
        ActivityKind::Restored => "restored",
        ActivityKind::Commented => "commented",
        ActivityKind::Joined => "joined",
    }
}

fn parse_kind(s: &str) -> Option<ActivityKind> {
    Some(match s {
        "created" => ActivityKind::Created,
        "edited" => ActivityKind::Edited,
        "renamed" => ActivityKind::Renamed,
        "deleted" => ActivityKind::Deleted,
        "restored" => ActivityKind::Restored,
        "commented" => ActivityKind::Commented,
        "joined" => ActivityKind::Joined,
        _ => return None,
    })
}

/// Who did it, from the request: a user, or a guest by the name they gave.
pub fn actor(caller: &Caller) -> (Option<String>, String) {
    match (&caller.user, &caller.guest) {
        (Some(u), _) => (Some(u.id.clone()), u.name.clone()),
        (None, Some(g)) => (None, g.name.clone()),
        _ => (None, "Someone".into()),
    }
}

/// Writes one entry. Never fails the request it is part of: the history is a
/// courtesy, the change itself is what matters.
pub async fn record(state: &AppState, project_id: &str, caller: &Caller, kind: ActivityKind, document: Option<(&str, &str)>, detail: Option<&str>) {
    let (user, name) = actor(caller);
    let (doc_id, doc_name) = document.map_or((None, None), |(i, n)| (Some(i), Some(n)));
    // An edit right after another edit of the same board by the same person
    if kind == ActivityKind::Edited {
        let merged = sqlx::query(
            "UPDATE activity SET at = now(), count = count + 1, document_name = $4 WHERE id = (
               SELECT id FROM activity WHERE project_id = $1 AND document_id = $2 AND actor_user_id IS NOT DISTINCT FROM $3
               AND kind = 'edited' AND at > now() - interval '30 minutes' ORDER BY at DESC LIMIT 1)",
        )
        .bind(project_id)
        .bind(doc_id)
        .bind(&user)
        .bind(doc_name)
        .execute(&state.db)
        .await;
        if matches!(merged, Ok(r) if r.rows_affected() > 0) {
            return;
        }
    }
    let result = sqlx::query("INSERT INTO activity (project_id, actor_user_id, actor_name, kind, document_id, document_name, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(project_id)
        .bind(&user)
        .bind(&name)
        .bind(kind_str(kind))
        .bind(doc_id)
        .bind(doc_name)
        .bind(detail)
        .execute(&state.db)
        .await;
    if let Err(e) = result {
        tracing::warn!("activity not recorded: {e}");
    }
}

#[derive(Deserialize)]
struct Page {
    /// Older than this time, in ms (for more)
    before: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    kind: String,
    actor_name: String,
    avatar_url: Option<String>,
    document_id: Option<String>,
    document_name: Option<String>,
    detail: Option<String>,
    at: DateTime<Utc>,
    count: i32,
}

/// The latest 40 entries (or those before `before`). For the project's viewers
/// and up; someone with only some of its boards sees nothing here.
async fn list(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Query(p): Query<Page>) -> ApiResult<Json<Vec<Activity>>> {
    require_project(&state, &caller, &id, Role::Viewer).await?;
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT a.id, a.kind, coalesce(u.name, a.actor_name) AS actor_name, u.avatar_url, a.document_id, a.document_name, a.detail, a.at, a.count
         FROM activity a LEFT JOIN users u ON u.id = a.actor_user_id
         WHERE a.project_id = $1 AND ($2::bigint IS NULL OR a.at < to_timestamp($2 / 1000.0)) ORDER BY a.at DESC, a.id DESC LIMIT 40",
    )
    .bind(&id)
    .bind(p.before)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .filter_map(|r| {
                Some(Activity {
                    id: r.id.to_string(),
                    kind: parse_kind(&r.kind)?,
                    actor: r.actor_name,
                    actor_avatar: r.avatar_url,
                    document_id: r.document_id,
                    document_name: r.document_name,
                    detail: r.detail,
                    at: ms(r.at),
                    count: r.count.max(1) as u32,
                })
            })
            .collect(),
    ))
}
