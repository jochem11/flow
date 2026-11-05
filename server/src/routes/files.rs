//! Images on boards: uploaded by editors, shown to whoever may see the board.
//! The file is the request body as it is, its type in Content-Type and its name
//! in X-File-Name. Only plain image types: no SVG, which can carry scripts.

use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::access::require_document;
use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::tokens;
use flow_core::models::Role;

/// Largest image
const MAX_SIZE: usize = 10 * 1024 * 1024;
const TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/documents/{id}/files", post(upload))
        .route("/files/{id}", get(download))
        .route("/files/{id}/copy", post(copy))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Uploaded {
    id: String,
    name: String,
    mime: String,
    size: usize,
}

async fn upload(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, headers: HeaderMap, body: Bytes) -> ApiResult<Json<Uploaded>> {
    require_document(&state, &caller, &id, Role::Editor).await?;
    let mime = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if !TYPES.contains(&mime.as_str()) {
        return Err(AppError::bad("Only PNG, JPEG, GIF and WebP images can be added"));
    }
    if body.is_empty() || body.len() > MAX_SIZE {
        return Err(AppError::bad("An image can be at most 10 MB"));
    }
    let name = headers
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .map(|n| percent_decode(n).chars().take(200).collect::<String>())
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "image".into());
    let file = tokens::new_id();
    sqlx::query("INSERT INTO files (id, document_id, name, mime, size, data, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)")
        .bind(&file)
        .bind(&id)
        .bind(&name)
        .bind(&mime)
        .bind(body.len() as i32)
        .bind(body.as_ref())
        .bind(caller.user.as_ref().map(|u| u.id.as_str()))
        .execute(&state.db)
        .await?;
    Ok(Json(Uploaded { id: file, name, mime, size: body.len() }))
}

async fn download(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Response> {
    let row: Option<(String, String, String, Vec<u8>)> = sqlx::query_as("SELECT document_id, name, mime, data FROM files WHERE id = $1").bind(&id).fetch_optional(&state.db).await?;
    let Some((document, _name, mime, data)) = row else { return Err(AppError::not_found("Image")) };
    // Not there for whoever may not see its board
    require_document(&state, &caller, &document, Role::Viewer).await.map_err(|_| AppError::not_found("Image"))?;
    let mut res = data.into_response();
    let h = res.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    // A file never changes (a new image is a new file)
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable"));
    Ok(res)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyTo {
    document_id: String,
}

/// An image pasted on another board: a copy that belongs to that board.
async fn copy(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(to): Json<CopyTo>) -> ApiResult<Json<Uploaded>> {
    let row: Option<(String,)> = sqlx::query_as("SELECT document_id FROM files WHERE id = $1").bind(&id).fetch_optional(&state.db).await?;
    let Some((from,)) = row else { return Err(AppError::not_found("Image")) };
    require_document(&state, &caller, &from, Role::Viewer).await.map_err(|_| AppError::not_found("Image"))?;
    require_document(&state, &caller, &to.document_id, Role::Editor).await?;
    let file = tokens::new_id();
    let (name, mime, size): (String, String, i32) = sqlx::query_as(
        "INSERT INTO files (id, document_id, name, mime, size, data, created_by)
         SELECT $1, $2, name, mime, size, data, $3 FROM files WHERE id = $4 RETURNING name, mime, size",
    )
    .bind(&file)
    .bind(&to.document_id)
    .bind(caller.user.as_ref().map(|u| u.id.as_str()))
    .bind(&id)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(Uploaded { id: file, name, mime, size: size as usize }))
}

/// `%20` and the like back to characters (the name is sent URL-encoded, headers being ASCII)
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
