//! What is someone's own: starred projects and boards, the boards they opened
//! lately ("Recent", the same on every device), and searching inside the boards
//! they can see (Cmd+K).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use flow_core::models::{DocumentKind, ItemKind, RecentBoard, SearchHit, Star};
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
        .route("/search", get(search))
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

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

#[derive(sqlx::FromRow)]
struct HitRow {
    id: String,
    project_id: String,
    name: String,
    kind: String,
    diagram: Option<String>,
    hit: String,
    project_role: Option<String>,
    board_role: Option<String>,
}

/// How many boards a search returns.
const HITS: usize = 20;

/// The text around the first match, at most about 80 characters, on one line.
fn snippet(text: &str, q: &str) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = flat.to_lowercase();
    let at = lower.find(&q.to_lowercase()).unwrap_or(0);
    // Character positions, so a cut never splits a letter
    let chars: Vec<char> = flat.chars().collect();
    let start_char = lower[..at].chars().count().saturating_sub(30);
    let end_char = (start_char + 80).min(chars.len());
    let mut out: String = chars[start_char..end_char].iter().collect();
    if start_char > 0 {
        out.insert(0, '…');
    }
    if end_char < chars.len() {
        out.push('…');
    }
    out
}

/// Boards the caller can see with `q` in a block, a card, a table or the text:
/// one hit per board, the first matching text as its snippet.
async fn search(State(state): State<AppState>, caller: Caller, Query(sq): Query<SearchQuery>) -> ApiResult<Json<Vec<SearchHit>>> {
    let user = caller.user()?;
    let q = sq.q.trim();
    if q.chars().count() < 2 {
        return Ok(Json(vec![]));
    }
    // ILIKE with the user's text taken literally
    let pattern = format!("%{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let rows = sqlx::query_as::<_, HitRow>(
        "SELECT d.id, d.project_id, d.name, d.kind, d.content->'data'->>'diagram' AS diagram, m.hit,
                pm.role AS project_role, dr.role AS board_role
         FROM documents d
         JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
         LEFT JOIN project_members pm ON pm.project_id = d.project_id AND pm.user_id = $1
         LEFT JOIN document_roles dr ON dr.document_id = d.id AND dr.user_id = $1
         CROSS JOIN LATERAL (
           SELECT t #>> '{}' AS hit FROM jsonb_path_query(d.content, 'lax $.data.nodes[*].text') t
           UNION ALL SELECT t #>> '{}' FROM jsonb_path_query(d.content, 'lax $.data.columns[*].cards[*].title') t
           UNION ALL SELECT t #>> '{}' FROM jsonb_path_query(d.content, 'lax $.data.entities[*].name') t
           UNION ALL SELECT d.content->'data'->>'markdown'
         ) m
         WHERE d.deleted_at IS NULL AND (pm.user_id IS NOT NULL OR dr.user_id IS NOT NULL) AND m.hit ILIKE $2
         ORDER BY d.updated_at DESC
         LIMIT 200",
    )
    .bind(&user.id)
    .bind(&pattern)
    .fetch_all(&state.db)
    .await?;
    let mut seen = std::collections::HashSet::new();
    let hits = rows
        .into_iter()
        .filter(|r| combine(r.project_role.as_deref().and_then(Role::parse), r.board_role.as_deref().and_then(Role::parse)).can_view())
        .filter(|r| seen.insert(r.id.clone()))
        .take(HITS)
        .map(|r| SearchHit {
            snippet: snippet(&r.hit, q),
            document_id: r.id,
            project_id: r.project_id,
            name: r.name,
            kind: serde_json::from_value::<DocumentKind>(serde_json::Value::String(r.kind)).unwrap_or(DocumentKind::Flow),
            diagram: r.diagram.and_then(|t| serde_json::from_value(serde_json::Value::String(t)).ok()),
        })
        .collect();
    Ok(Json(hits))
}

#[cfg(test)]
mod tests {
    use super::snippet;

    #[test]
    fn snippet_around_the_match() {
        assert_eq!(snippet("Check stock", "stock"), "Check stock");
        let long = format!("{} needle {}", "a ".repeat(40), "b ".repeat(40));
        let s = snippet(&long, "NEEDLE");
        assert!(s.starts_with('…') && s.ends_with('…') && s.contains("needle"), "{s}");
        // Letters beyond ASCII are never cut in half
        assert!(snippet(&"é".repeat(200), "é").chars().count() <= 82);
    }
}
