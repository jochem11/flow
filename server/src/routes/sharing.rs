//! A board's Share dialog: who has access (with the board's own role per person),
//! its public link, and opening a link — also as a guest without an account.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use flow_core::models::{BoardAccess, BoardMember, LinkAccess, Role, ShareLink, SharedBoard, User};
use serde::Deserialize;

use super::members::pending;
use crate::access::{document_role, require_document};
use crate::auth::{Caller, GUEST_COOKIE, Guest};
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::{mail, tokens};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/documents/{id}/access", get(access))
        .route("/documents/{id}/roles/{user}", put(set_board_role))
        .route("/documents/{id}/link", put(set_link))
        .route("/documents/{id}/link/rotate", post(rotate_link))
        .route("/documents/{id}/request-access", post(request_access))
        .route("/share/{token}", get(open_link))
        .route("/share/{token}/request-access", post(request_access_by_link))
        .route("/guest", get(guest).post(become_guest))
}

/// The board's link, made on first use (restricted: only people with access).
async fn link(state: &AppState, document_id: &str) -> ApiResult<ShareLink> {
    sqlx::query(
        "INSERT INTO share_links (document_id, token, created_by)
         SELECT d.id, $2, p.owner_id FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = $1
         ON CONFLICT (document_id) DO NOTHING",
    )
    .bind(document_id)
    .bind(tokens::short_token())
    .execute(&state.db)
    .await?;
    let (token, access): (String, String) = sqlx::query_as("SELECT token, access FROM share_links WHERE document_id = $1").bind(document_id).fetch_one(&state.db).await?;
    Ok(ShareLink { token, access: LinkAccess::parse(&access).unwrap_or(LinkAccess::Restricted) })
}

#[derive(sqlx::FromRow)]
struct AccessRow {
    id: String,
    email: String,
    name: String,
    avatar_url: Option<String>,
    project_role: String,
    board_role: Option<String>,
}

async fn access(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<BoardAccess>> {
    let (project_id, role) = require_document(&state, &caller, &id, Role::Viewer).await?;
    caller.user()?;
    let rows = sqlx::query_as::<_, AccessRow>(
        "SELECT u.id, u.email, u.name, u.avatar_url, pm.role AS project_role, dr.role AS board_role
         FROM project_members pm JOIN users u ON u.id = pm.user_id
         LEFT JOIN document_roles dr ON dr.document_id = $1 AND dr.user_id = pm.user_id
         WHERE pm.project_id = $2 AND (pm.role <> 'none' OR dr.role IS NOT NULL)
         ORDER BY pm.role = 'owner' DESC, u.name",
    )
    .bind(&id)
    .bind(&project_id)
    .fetch_all(&state.db)
    .await?;
    let members = rows
        .into_iter()
        .map(|r| BoardMember {
            user: User { id: r.id, email: r.email, name: r.name, avatar_url: r.avatar_url },
            project_role: Role::parse(&r.project_role).unwrap_or(Role::None),
            board_role: r.board_role.as_deref().and_then(Role::parse),
        })
        .collect();
    // Only the owner sees pending invites
    let invites = if role.can_manage() { pending(&state, &project_id, Some(&id)).await? } else { vec![] };
    Ok(Json(BoardAccess { members, invites, link: link(&state, &id).await?, role }))
}

#[derive(Deserialize)]
struct BoardRole {
    /// None: the project role counts again
    role: Option<Role>,
}

/// The board's own role for someone (owner only); `none` hides the board from them.
async fn set_board_role(State(state): State<AppState>, caller: Caller, Path((id, user)): Path<(String, String)>, Json(b): Json<BoardRole>) -> ApiResult<StatusCode> {
    let (project_id, _) = require_document(&state, &caller, &id, Role::CoOwner).await?;
    match crate::access::project_role(&state, &user, &project_id).await? {
        Some(Role::Owner | Role::CoOwner) => return Err(AppError::bad("The owner and co-owners always have full access")),
        // Someone new is invited (by email), not given a role here
        None => return Err(AppError::not_found("Member")),
        Some(_) => {}
    }
    match b.role {
        Some(Role::Owner | Role::CoOwner) => return Err(AppError::bad("Make someone owner or co-owner of the whole project, not of one board")),
        Some(role) => {
            super::members::grant(&state, &project_id, Some(&id), &user, role).await?;
        }
        None => {
            sqlx::query("DELETE FROM document_roles WHERE document_id = $1 AND user_id = $2").bind(&id).bind(&user).execute(&state.db).await?;
        }
    }
    crate::events::access_changed(&state, &user, &project_id).await;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct SetLink {
    access: LinkAccess,
}

async fn set_link(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(s): Json<SetLink>) -> ApiResult<Json<ShareLink>> {
    require_document(&state, &caller, &id, Role::CoOwner).await?;
    link(&state, &id).await?;
    sqlx::query("UPDATE share_links SET access = $2 WHERE document_id = $1").bind(&id).bind(s.access.as_str()).execute(&state.db).await?;
    state.rooms.kick_board(&id);
    Ok(Json(link(&state, &id).await?))
}

/// A new link; the old one stops working.
async fn rotate_link(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<ShareLink>> {
    require_document(&state, &caller, &id, Role::CoOwner).await?;
    link(&state, &id).await?;
    sqlx::query("UPDATE share_links SET token = $2 WHERE document_id = $1").bind(&id).bind(tokens::short_token()).execute(&state.db).await?;
    state.rooms.kick_board(&id);
    Ok(Json(link(&state, &id).await?))
}

/// Opening a share link: what it is, and what the caller may do with it.
/// Not allowed: 401 when logged out (they may have access after logging in), else 403.
async fn open_link(State(state): State<AppState>, caller: Caller, Path(token): Path<String>) -> ApiResult<Json<SharedBoard>> {
    let (document_id, project_id, name): (String, String, String) =
        sqlx::query_as("SELECT d.id, d.project_id, d.name FROM share_links s JOIN documents d ON d.id = s.document_id WHERE s.token = $1")
            .bind(&token)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::not_found("This link (it may have been replaced)"))?;
    let caller = Caller { share: Some(token), ..caller };
    let (_, role) = document_role(&state, &caller, &document_id).await?;
    if !role.can_view() {
        return Err(if caller.user.is_none() { AppError::unauthorized() } else { AppError::forbidden("You don't have access to this board") });
    }
    Ok(Json(SharedBoard { document_id, project_id, name, role }))
}

#[derive(Deserialize)]
struct RequestAccess {
    message: Option<String>,
}

/// Someone without access asks the owner for it (by mail).
async fn request_access(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(r): Json<RequestAccess>) -> ApiResult<StatusCode> {
    ask_owner(&state, &caller, &id, r.message).await
}

/// The same from a share link that does not let them in (they do not know the board's id).
async fn request_access_by_link(State(state): State<AppState>, caller: Caller, Path(token): Path<String>, Json(r): Json<RequestAccess>) -> ApiResult<StatusCode> {
    let (id,): (String,) = sqlx::query_as("SELECT document_id FROM share_links WHERE token = $1").bind(&token).fetch_optional(&state.db).await?.ok_or_else(|| AppError::not_found("This link"))?;
    ask_owner(&state, &caller, &id, r.message).await
}

async fn ask_owner(state: &AppState, caller: &Caller, id: &str, message: Option<String>) -> ApiResult<StatusCode> {
    let user = caller.user()?;
    if !state.limits.allow(&format!("request:{}:{id}", user.id)) {
        return Err(AppError::new(StatusCode::TOO_MANY_REQUESTS, "You asked already; give the owner some time"));
    }
    let (owner_email, board): (String, String) = sqlx::query_as("SELECT u.email, d.name FROM documents d JOIN projects p ON p.id = d.project_id JOIN users u ON u.id = p.owner_id WHERE d.id = $1")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::not_found("Board"))?;
    let note = message.filter(|m| !m.trim().is_empty()).map_or(String::new(), |m| format!("\n\nTheir message:\n{m}"));
    state
        .mailer
        .send(mail::Mail {
            to: owner_email,
            subject: format!("{} asks for access to \u{201c}{board}\u{201d}", user.name),
            text: format!("{} ({}) would like access to \u{201c}{board}\u{201d} in Flow.{note}\n\nOpen the board and use Share to give them access:\n\n{}", user.name, user.email, state.link(&format!("/d/{id}"))),
        })
        .await;
    Ok(StatusCode::NO_CONTENT)
}

async fn guest(caller: Caller) -> Json<Option<Guest>> {
    Json(caller.guest)
}

#[derive(Deserialize)]
struct GuestName {
    name: String,
}

/// A name for commenting without an account, remembered in a cookie.
async fn become_guest(State(state): State<AppState>, caller: Caller, jar: CookieJar, Json(g): Json<GuestName>) -> ApiResult<(CookieJar, Json<Guest>)> {
    let name: String = g.name.trim().chars().take(60).collect();
    if name.is_empty() {
        return Err(AppError::bad("Enter a name"));
    }
    if let Some(existing) = caller.guest {
        sqlx::query("UPDATE guests SET name = $2 WHERE id = $1").bind(&existing.id).bind(&name).execute(&state.db).await?;
        return Ok((jar, Json(Guest { id: existing.id, name })));
    }
    let id = tokens::random_token();
    sqlx::query("INSERT INTO guests (id, name) VALUES ($1, $2)").bind(&id).bind(&name).execute(&state.db).await?;
    let cookie = Cookie::build((GUEST_COOKIE, id.clone()))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(state.config.secure_cookies())
        .max_age(cookie::time::Duration::days(365))
        .build();
    Ok((jar.add(cookie), Json(Guest { id, name })))
}
