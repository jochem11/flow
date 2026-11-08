//! Account settings: name, password, email (confirmed again), the devices one is
//! logged in on, and deleting the account. And giving a project to someone else.
//!
//! What needs proof asks for the current password (when the account has one): a
//! session left open on someone else's computer is not enough to take it over.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, post, put};
use axum::{Json, Router};
use axum_extra::extract::cookie::{Cookie, CookieJar};
use chrono::{DateTime, Utc};
use flow_core::models::{AccountSession, Me, Role};
use serde::Deserialize;

use super::projects::ms;
use crate::access::require_project;
use crate::auth::{check_password, hash_password, password_matches, send_verification, user_by_email, user_by_id, Caller, UserRow, SESSION_COOKIE};
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::tokens;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/account/name", put(set_name))
        .route("/account/password", put(set_password))
        .route("/account/email", put(set_email))
        .route("/account/sessions", axum::routing::get(sessions).delete(log_out_others))
        .route("/account/sessions/{id}", delete(log_out_one))
        .route("/account", delete(delete_account))
        .route("/projects/{id}/transfer", post(transfer))
}

/// The current password, when the account has one.
fn proven(user: &UserRow, password: Option<&str>) -> ApiResult<()> {
    match &user.password_hash {
        Some(hash) if password.is_some_and(|p| password_matches(p, hash)) => Ok(()),
        Some(_) => Err(AppError::new(StatusCode::FORBIDDEN, "Your current password is not right")),
        None => Ok(()),
    }
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

async fn set_name(State(state): State<AppState>, caller: Caller, Json(n): Json<Name>) -> ApiResult<Json<Me>> {
    let user = caller.user()?;
    let name = n.name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::bad("A name of 1 to 80 characters"));
    }
    sqlx::query("UPDATE users SET name = $2 WHERE id = $1").bind(&user.id).bind(name).execute(&state.db).await?;
    Ok(Json(user_by_id(&state, &user.id).await?.me()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Password {
    current: Option<String>,
    new_password: String,
}

/// A new password (or a first one, for an account that logs in with Google).
/// Other devices are logged out: whoever knew the old one is out.
async fn set_password(State(state): State<AppState>, caller: Caller, Json(p): Json<Password>) -> ApiResult<StatusCode> {
    let user = caller.user()?;
    if !state.limits.allow(&format!("password:{}", user.id)) {
        return Err(AppError::new(StatusCode::TOO_MANY_REQUESTS, "Too many attempts; try again in a few minutes"));
    }
    proven(user, p.current.as_deref())?;
    check_password(&p.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $2 WHERE id = $1").bind(&user.id).bind(hash_password(&p.new_password)?).execute(&state.db).await?;
    others_out(&state, &caller).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Email {
    email: String,
    password: Option<String>,
}

/// Another address: confirmed again by a mail to it before it counts as theirs.
async fn set_email(State(state): State<AppState>, caller: Caller, Json(e): Json<Email>) -> ApiResult<Json<Me>> {
    let user = caller.user()?;
    if user.password_hash.is_none() {
        return Err(AppError::bad("Choose a password first: it confirms changes like this one"));
    }
    if !state.limits.allow(&format!("email:{}", user.id)) {
        return Err(AppError::new(StatusCode::TOO_MANY_REQUESTS, "Too many attempts; try again in a few minutes"));
    }
    proven(user, e.password.as_deref())?;
    let email = e.email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 3 || email.len() > 254 {
        return Err(AppError::bad("That is not an email address"));
    }
    if email == user.email {
        return Ok(Json(user.me()));
    }
    if user_by_email(&state, &email).await?.is_some() {
        return Err(AppError::conflict("Another account uses that address"));
    }
    sqlx::query("UPDATE users SET email = $2, email_verified_at = NULL WHERE id = $1").bind(&user.id).bind(&email).execute(&state.db).await?;
    let updated = user_by_id(&state, &user.id).await?;
    send_verification(&state, &updated).await?;
    Ok(Json(updated.me()))
}

/// The start of a session's hash: names it without being anything to log in with.
fn short(hash: &str) -> String {
    hash.chars().take(16).collect()
}

async fn sessions(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Vec<AccountSession>>> {
    let user = caller.user()?;
    let current = caller.session.as_deref().map(tokens::hash);
    let rows: Vec<(String, Option<String>, DateTime<Utc>)> = sqlx::query_as(
        "SELECT token_hash, user_agent, created_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY created_at DESC",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(
        rows.into_iter()
            .map(|(hash, user_agent, created)| AccountSession { id: short(&hash), current: current.as_deref() == Some(hash.as_str()), user_agent, created_at: ms(created) })
            .collect(),
    ))
}

async fn others_out(state: &AppState, caller: &Caller) -> ApiResult<()> {
    let user = caller.user()?;
    let current = caller.session.as_deref().map(tokens::hash).unwrap_or_default();
    sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2").bind(&user.id).bind(&current).execute(&state.db).await?;
    // Their open boards go too, and their apps show the login screen
    state.rooms.kick_user(&user.id);
    state.events.sessions_ended(&user.id, |s| s != current);
    Ok(())
}

/// Logs out every other device.
async fn log_out_others(State(state): State<AppState>, caller: Caller) -> ApiResult<StatusCode> {
    others_out(&state, &caller).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn log_out_one(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<StatusCode> {
    let user = caller.user()?;
    if id.len() != 16 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::not_found("Session"));
    }
    let gone = sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND left(token_hash, 16) = $2").bind(&user.id).bind(&id).execute(&state.db).await?.rows_affected();
    if gone == 0 {
        return Err(AppError::not_found("Session"));
    }
    // That device shows the login screen now (not at its next request)
    state.events.sessions_ended(&user.id, |s| s.starts_with(&id));
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Confirm {
    password: Option<String>,
    /// For an account without a password: its email address, typed to confirm
    email: Option<String>,
}

/// Deletes the account, with the projects it owns. Not while others are in one
/// of those: give it to one of them first (or remove them), so nobody loses work
/// they share.
async fn delete_account(State(state): State<AppState>, caller: Caller, jar: CookieJar, Json(c): Json<Confirm>) -> ApiResult<(CookieJar, StatusCode)> {
    let user = caller.user()?;
    match &user.password_hash {
        Some(_) => proven(user, c.password.as_deref())?,
        None if c.email.as_deref().map(|e| e.trim().to_lowercase()) == Some(user.email.clone()) => {}
        None => return Err(AppError::new(StatusCode::FORBIDDEN, "Type your email address to confirm")),
    }
    let shared: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT p.name FROM projects p JOIN project_members pm ON pm.project_id = p.id
         WHERE p.owner_id = $1 AND pm.user_id <> $1 ORDER BY p.name",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;
    if !shared.is_empty() {
        let names: Vec<String> = shared.into_iter().map(|(n,)| format!("“{n}”")).collect();
        return Err(AppError::conflict(format!(
            "Others are in {}: give it to one of them first (People → Make owner), or remove them",
            names.join(", ")
        )));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM projects WHERE owner_id = $1").bind(&user.id).execute(&mut *tx).await?;
    sqlx::query("DELETE FROM users WHERE id = $1").bind(&user.id).execute(&mut *tx).await?;
    tx.commit().await?;
    state.rooms.kick_user(&user.id);
    Ok((jar.remove(Cookie::build(SESSION_COOKIE).path("/")), StatusCode::NO_CONTENT))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Transfer {
    user_id: String,
}

/// The owner gives the project to someone in it, and becomes a co-owner.
async fn transfer(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(t): Json<Transfer>) -> ApiResult<StatusCode> {
    require_project(&state, &caller, &id, Role::Owner).await?;
    let me = caller.user()?;
    if t.user_id == me.id {
        return Err(AppError::bad("It is yours already"));
    }
    let target = crate::access::project_role(&state, &t.user_id, &id).await?;
    if !target.is_some_and(|r| r != Role::None) {
        return Err(AppError::bad("Give it to someone who is in the whole project"));
    }
    let mut tx = state.db.begin().await?;
    sqlx::query("UPDATE projects SET owner_id = $2 WHERE id = $1").bind(&id).bind(&t.user_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE project_members SET role = 'owner' WHERE project_id = $1 AND user_id = $2").bind(&id).bind(&t.user_id).execute(&mut *tx).await?;
    sqlx::query("UPDATE project_members SET role = 'coOwner' WHERE project_id = $1 AND user_id = $2").bind(&id).bind(&me.id).execute(&mut *tx).await?;
    // Their own board roles no longer apply to an owner
    sqlx::query("DELETE FROM document_roles WHERE user_id = $2 AND document_id IN (SELECT id FROM documents WHERE project_id = $1)").bind(&id).bind(&t.user_id).execute(&mut *tx).await?;
    tx.commit().await?;
    crate::events::access_changed(&state, &t.user_id, &id).await;
    crate::events::access_changed(&state, &me.id, &id).await;
    Ok(StatusCode::NO_CONTENT)
}
