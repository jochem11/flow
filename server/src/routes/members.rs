//! People in a project, and inviting them. The owner (or a co-owner) invites by
//! email with a role, for the whole project or for one board. The person always
//! gets a mail asking whether they want to join, saying what they will be able to
//! do; nothing changes until they accept (from the mail's page, or in the app).
//! The one who invited them hears back either way.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post, put};
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use flow_core::models::{Invite, Member, Role, User};
use serde::{Deserialize, Serialize};

use super::projects::{ms, next_sidebar_order};
use crate::access::require_project;
use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::{mail, tokens};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/projects/{id}/members", get(list))
        .route("/projects/{id}/members/{user}", put(set_role).delete(remove))
        .route("/projects/{id}/invites", get(invites).post(invite))
        .route("/projects/{id}/invites/{invite}", delete(revoke))
        .route("/projects/{id}/invites/{invite}/resend", post(resend))
        .route("/projects/{id}/board-roles", get(board_roles))
        .route("/invites/mine", get(mine))
        .route("/invites/respond", post(respond))
        .route("/invites/{token}", get(invite_info))
}

#[derive(sqlx::FromRow)]
struct MemberRow {
    id: String,
    email: String,
    name: String,
    avatar_url: Option<String>,
    role: String,
}

impl MemberRow {
    fn user(&self) -> User {
        User { id: self.id.clone(), email: self.email.clone(), name: self.name.clone(), avatar_url: self.avatar_url.clone() }
    }
}

async fn list(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Vec<Member>>> {
    require_project(&state, &caller, &id, Role::Viewer).await?;
    let rows = sqlx::query_as::<_, MemberRow>(
        "SELECT u.id, u.email, u.name, u.avatar_url, pm.role FROM project_members pm JOIN users u ON u.id = pm.user_id
         WHERE pm.project_id = $1 ORDER BY pm.role = 'owner' DESC, u.name",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows.into_iter().map(|r| Member { user: r.user(), role: Role::parse(&r.role).unwrap_or(Role::None) }).collect()))
}

#[derive(Deserialize)]
struct SetRole {
    role: Role,
}

/// Roles the owner and co-owners can give (there is one owner; co-owner is for
/// the whole project, not one board).
fn grantable(role: Role, board: bool) -> ApiResult<Role> {
    match role {
        Role::Owner => Err(AppError::bad("A project has one owner")),
        Role::CoOwner if board => Err(AppError::bad("Make someone co-owner of the whole project, not of one board")),
        r => Ok(r),
    }
}

async fn set_role(State(state): State<AppState>, caller: Caller, Path((id, user)): Path<(String, String)>, Json(s): Json<SetRole>) -> ApiResult<StatusCode> {
    require_project(&state, &caller, &id, Role::CoOwner).await?;
    let role = grantable(s.role, false)?;
    let changed = sqlx::query("UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'")
        .bind(&id)
        .bind(&user)
        .bind(role.as_str())
        .execute(&state.db)
        .await?
        .rows_affected();
    if changed == 0 {
        return Err(AppError::not_found("Member"));
    }
    crate::events::access_changed(&state, &user, &id).await;
    Ok(StatusCode::NO_CONTENT)
}

/// The owner removes someone, or someone leaves.
async fn remove(State(state): State<AppState>, caller: Caller, Path((id, user)): Path<(String, String)>) -> ApiResult<StatusCode> {
    let me = caller.user()?;
    if me.id != user {
        require_project(&state, &caller, &id, Role::CoOwner).await?;
    }
    let removed = sqlx::query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'").bind(&id).bind(&user).execute(&state.db).await?.rows_affected();
    if removed == 0 {
        return Err(AppError::bad("The owner cannot leave their own project"));
    }
    sqlx::query("DELETE FROM document_roles WHERE user_id = $2 AND document_id IN (SELECT id FROM documents WHERE project_id = $1)").bind(&id).bind(&user).execute(&state.db).await?;
    // They are no longer a member, so tell them directly too
    state.events.access_changed(&user, &id);
    crate::events::access_changed(&state, &user, &id).await;
    Ok(StatusCode::NO_CONTENT)
}

// ---------- per board ----------

#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct BoardRole {
    document_id: String,
    user_id: String,
    role: String,
}

/// Every board's own role per person (for the People dialog: who may do what where).
async fn board_roles(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Vec<BoardRole>>> {
    require_project(&state, &caller, &id, Role::CoOwner).await?;
    let rows = sqlx::query_as::<_, BoardRole>(
        "SELECT r.document_id, r.user_id, r.role FROM document_roles r JOIN documents d ON d.id = r.document_id WHERE d.project_id = $1",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

// ---------- invites ----------

#[derive(sqlx::FromRow)]
struct InviteRow {
    id: String,
    email: String,
    role: String,
    document_id: Option<String>,
    invited_by: String,
    created_at: DateTime<Utc>,
}

impl InviteRow {
    fn invite(self) -> Invite {
        Invite { id: self.id, email: self.email, role: Role::parse(&self.role).unwrap_or(Role::Viewer), document_id: self.document_id, invited_by: self.invited_by, created_at: ms(self.created_at) }
    }
}

macro_rules! invite_columns {
    () => {
        "i.id, i.email, i.role, i.document_id, u.name AS invited_by, i.created_at"
    };
}

/// Pending invites of a project (and of its boards).
pub async fn pending(state: &AppState, project_id: &str, document_id: Option<&str>) -> ApiResult<Vec<Invite>> {
    let rows = sqlx::query_as::<_, InviteRow>(concat!(
        "SELECT ",
        invite_columns!(),
        " FROM invites i JOIN users u ON u.id = i.invited_by
         WHERE i.project_id = $1 AND i.accepted_at IS NULL AND i.expires_at > now() AND ($2::text IS NULL OR i.document_id IS NULL OR i.document_id = $2)
         ORDER BY i.created_at"
    ))
    .bind(project_id)
    .bind(document_id)
    .fetch_all(&state.db)
    .await?;
    Ok(rows.into_iter().map(InviteRow::invite).collect())
}

async fn invites(State(state): State<AppState>, caller: Caller, Path(id): Path<String>) -> ApiResult<Json<Vec<Invite>>> {
    require_project(&state, &caller, &id, Role::CoOwner).await?;
    Ok(Json(pending(&state, &id, None).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInvite {
    pub email: String,
    pub role: Role,
    /// Only this board of the project
    pub document_id: Option<String>,
}

/// The project's (or board's) name for mails.
async fn what(state: &AppState, project_id: &str, document_id: Option<&str>) -> ApiResult<String> {
    let (name,): (String,) = match document_id {
        Some(d) => sqlx::query_as("SELECT name FROM documents WHERE id = $1 AND project_id = $2").bind(d).bind(project_id).fetch_one(&state.db).await?,
        None => sqlx::query_as("SELECT name FROM projects WHERE id = $1").bind(project_id).fetch_one(&state.db).await?,
    };
    Ok(match document_id {
        Some(_) => format!("the board \u{201c}{name}\u{201d}"),
        None => format!("the project \u{201c}{name}\u{201d}"),
    })
}

/// Invites someone: a mail asking whether they want to join. An earlier open
/// invite of them to the same project or board is replaced.
pub async fn invite(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(i): Json<NewInvite>) -> ApiResult<Json<Invite>> {
    require_project(&state, &caller, &id, Role::CoOwner).await?;
    let me = caller.user()?;
    let role = grantable(i.role, i.document_id.is_some())?;
    if !role.can_view() {
        return Err(AppError::bad("Invite someone as viewer, commenter, editor or co-owner"));
    }
    let email = i.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::bad("Enter a valid email address"));
    }
    if email == me.email {
        return Err(AppError::bad("That is you"));
    }
    sqlx::query("DELETE FROM invites WHERE project_id = $1 AND email = $2 AND document_id IS NOT DISTINCT FROM $3 AND accepted_at IS NULL")
        .bind(&id)
        .bind(&email)
        .bind(&i.document_id)
        .execute(&state.db)
        .await?;
    let token = tokens::random_token();
    let invite_id = tokens::new_id();
    sqlx::query("INSERT INTO invites (id, project_id, document_id, email, role, token_hash, invited_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)")
        .bind(&invite_id)
        .bind(&id)
        .bind(&i.document_id)
        .bind(&email)
        .bind(role.as_str())
        .bind(tokens::hash(&token))
        .bind(&me.id)
        .bind(Utc::now() + Duration::days(14))
        .execute(&state.db)
        .await?;
    let what = what(&state, &id, i.document_id.as_deref()).await?;
    state.mailer.send(mail::invite(&email, &me.name, &what, mail::role_words(role), &state.link(&format!("/invite/{token}")))).await;
    let invite = pending(&state, &id, None).await?.into_iter().find(|x| x.id == invite_id).ok_or_else(|| AppError::not_found("Invite"))?;
    Ok(Json(invite))
}

/// Gives a user a role in the project, or (with a board) on that board only.
/// A project role is never lowered by this, and the owner stays owner.
pub async fn grant(state: &AppState, project_id: &str, document_id: Option<&str>, user_id: &str, role: Role) -> ApiResult<()> {
    let order = next_sidebar_order(state, user_id).await?;
    match document_id {
        Some(doc) => {
            sqlx::query("INSERT INTO project_members (project_id, user_id, role, sidebar_order) VALUES ($1, $2, 'none', $3) ON CONFLICT DO NOTHING")
                .bind(project_id)
                .bind(user_id)
                .bind(order)
                .execute(&state.db)
                .await?;
            sqlx::query("INSERT INTO document_roles (document_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (document_id, user_id) DO UPDATE SET role = EXCLUDED.role")
                .bind(doc)
                .bind(user_id)
                .bind(role.as_str())
                .execute(&state.db)
                .await?;
        }
        None => match crate::access::project_role(state, user_id, project_id).await? {
            Some(current) if current >= role => {}
            Some(_) => {
                sqlx::query("UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2").bind(project_id).bind(user_id).bind(role.as_str()).execute(&state.db).await?;
            }
            None => {
                sqlx::query("INSERT INTO project_members (project_id, user_id, role, sidebar_order) VALUES ($1, $2, $3, $4)")
                    .bind(project_id)
                    .bind(user_id)
                    .bind(role.as_str())
                    .bind(order)
                    .execute(&state.db)
                    .await?;
            }
        },
    }
    crate::events::access_changed(state, user_id, project_id).await;
    Ok(())
}

async fn revoke(State(state): State<AppState>, caller: Caller, Path((id, invite)): Path<(String, String)>) -> ApiResult<StatusCode> {
    require_project(&state, &caller, &id, Role::CoOwner).await?;
    sqlx::query("DELETE FROM invites WHERE id = $1 AND project_id = $2").bind(&invite).bind(&id).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Sends the mail again, with a new link (the old one stops working).
async fn resend(State(state): State<AppState>, caller: Caller, Path((id, invite)): Path<(String, String)>) -> ApiResult<StatusCode> {
    require_project(&state, &caller, &id, Role::CoOwner).await?;
    let me = caller.user()?;
    let token = tokens::random_token();
    let (email, role, document_id): (String, String, Option<String>) = sqlx::query_as(
        "UPDATE invites SET token_hash = $3, expires_at = $4 WHERE id = $1 AND project_id = $2 AND accepted_at IS NULL RETURNING email, role, document_id",
    )
    .bind(&invite)
    .bind(&id)
    .bind(tokens::hash(&token))
    .bind(Utc::now() + Duration::days(14))
    .fetch_one(&state.db)
    .await?;
    let what = what(&state, &id, document_id.as_deref()).await?;
    let role = Role::parse(&role).unwrap_or(Role::Viewer);
    state.mailer.send(mail::invite(&email, &me.name, &what, mail::role_words(role), &state.link(&format!("/invite/{token}")))).await;
    Ok(StatusCode::NO_CONTENT)
}

/// An invitation as the person invited sees it.
#[derive(Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct InviteInfo {
    id: String,
    email: String,
    role: String,
    invited_by: String,
    project_name: String,
    document_name: Option<String>,
}

macro_rules! info_select {
    () => {
        "SELECT i.id, i.email, i.role, u.name AS invited_by, p.name AS project_name, d.name AS document_name
         FROM invites i JOIN users u ON u.id = i.invited_by JOIN projects p ON p.id = i.project_id LEFT JOIN documents d ON d.id = i.document_id
         WHERE i.accepted_at IS NULL AND i.expires_at > now() AND "
    };
}

/// What an invitation link is for, for the page it opens (before logging in).
async fn invite_info(State(state): State<AppState>, Path(token): Path<String>) -> ApiResult<Json<InviteInfo>> {
    sqlx::query_as::<_, InviteInfo>(concat!(info_select!(), "i.token_hash = $1"))
        .bind(tokens::hash(&token))
        .fetch_optional(&state.db)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::not_found("This invitation (it may have expired or been answered)"))
}

/// The open invitations for the logged-in user's address (shown in the app).
async fn mine(State(state): State<AppState>, caller: Caller) -> ApiResult<Json<Vec<InviteInfo>>> {
    let user = caller.user()?;
    if user.email_verified_at.is_none() {
        return Ok(Json(vec![]));
    }
    Ok(Json(sqlx::query_as::<_, InviteInfo>(concat!(info_select!(), "i.email = $1 ORDER BY i.created_at")).bind(&user.email).fetch_all(&state.db).await?))
}

#[derive(Deserialize)]
struct Respond {
    /// From the mail's link
    token: Option<String>,
    /// From the app (their own confirmed address)
    id: Option<String>,
    accept: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Responded {
    project_id: String,
    document_id: Option<String>,
}

/// Accepting or declining. With the mail's link, having it proves the address is
/// theirs; from the app, their confirmed address must be the one invited.
async fn respond(State(state): State<AppState>, caller: Caller, Json(r): Json<Respond>) -> ApiResult<Json<Responded>> {
    let user = caller.user()?;
    let row: Option<(String, String, String, Option<String>, String, String)> = match (&r.token, &r.id) {
        (Some(t), _) => sqlx::query_as("SELECT id, email, project_id, document_id, role, invited_by FROM invites WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()")
            .bind(tokens::hash(t))
            .fetch_optional(&state.db)
            .await?,
        (None, Some(id)) if user.email_verified_at.is_some() => sqlx::query_as("SELECT id, email, project_id, document_id, role, invited_by FROM invites WHERE id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > now()")
            .bind(id)
            .bind(&user.email)
            .fetch_optional(&state.db)
            .await?,
        _ => None,
    };
    let (id, email, project_id, document_id, role, invited_by) = row.ok_or_else(|| AppError::not_found("This invitation (it may have expired or been answered)"))?;
    if email != user.email {
        return Err(AppError::forbidden(format!("This invitation is for {email}; log in with that address")));
    }
    let what = what(&state, &project_id, document_id.as_deref()).await?;
    let (inviter,): (String,) = sqlx::query_as("SELECT email FROM users WHERE id = $1").bind(&invited_by).fetch_one(&state.db).await?;
    if r.accept {
        // The link came to their mailbox, so the address is theirs
        sqlx::query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1").bind(&user.id).execute(&state.db).await?;
        sqlx::query("UPDATE invites SET accepted_at = now() WHERE id = $1").bind(&id).execute(&state.db).await?;
        grant(&state, &project_id, document_id.as_deref(), &user.id, Role::parse(&role).unwrap_or(Role::Viewer)).await?;
        let board: Option<(String, String)> = match document_id.as_deref() {
            Some(d) => sqlx::query_as("SELECT id, name FROM documents WHERE id = $1").bind(d).fetch_optional(&state.db).await?,
            None => None,
        };
        super::activity::record(&state, &project_id, &caller, flow_core::models::ActivityKind::Joined, board.as_ref().map(|(i, n)| (i.as_str(), n.as_str())), None).await;
    } else {
        sqlx::query("DELETE FROM invites WHERE id = $1").bind(&id).execute(&state.db).await?;
    }
    state.mailer.send(mail::answered(&inviter, &user.name, &user.email, &what, r.accept)).await;
    Ok(Json(Responded { project_id, document_id }))
}
