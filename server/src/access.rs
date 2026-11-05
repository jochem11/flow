//! Who may do what. Every handler asks here; nothing else decides.
//!
//! Someone's role on a board:
//!   1. the project's owner or a co-owner: that (a board cannot take it away)
//!   2. else the board's own role for them (`document_roles`), if set — also `none`
//!   3. else their role in the project (`project_members`)
//!   4. and a share link the request came through can raise that to its access
//!      (view or comment), never lower it.
//! Without a role (or `none`) a board does not exist for them: 404, not 403, so
//! nobody learns which boards there are.

use flow_core::models::{LinkAccess, Role};

use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

/// The combination of a project role and a board's own role for someone.
pub fn combine(project: Option<Role>, board: Option<Role>) -> Role {
    match (project, board) {
        (Some(r @ (Role::Owner | Role::CoOwner)), _) => r,
        (_, Some(b)) => b,
        (Some(p), None) => p,
        (None, None) => Role::None,
    }
}

fn parse(s: Option<String>) -> Option<Role> {
    s.as_deref().and_then(Role::parse)
}

/// The user's role in a project (None: not a member, or the project is in the trash).
pub async fn project_role(state: &AppState, user_id: &str, project_id: &str) -> ApiResult<Option<Role>> {
    let role: Option<(String,)> = sqlx::query_as(
        "SELECT pm.role FROM project_members pm JOIN projects p ON p.id = pm.project_id AND p.deleted_at IS NULL
         WHERE pm.project_id = $1 AND pm.user_id = $2",
    )
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;
    Ok(role.and_then(|(r,)| Role::parse(&r)))
}

/// The caller's role in a project, which must be at least `need`. A project
/// someone cannot see at all is "not found".
pub async fn require_project(state: &AppState, caller: &Caller, project_id: &str, need: Role) -> ApiResult<Role> {
    let user = caller.user()?;
    let role = project_role(state, &user.id, project_id).await?;
    // Only invited to some of its boards: the project shows, but only those boards
    let has_boards = match role {
        Some(Role::None) => sqlx::query_as::<_, (i64,)>(
            "SELECT count(*) FROM document_roles r JOIN documents d ON d.id = r.document_id WHERE d.project_id = $1 AND r.user_id = $2 AND r.role <> 'none' AND d.deleted_at IS NULL",
        )
        .bind(project_id)
        .bind(&user.id)
        .fetch_one(&state.db)
        .await?
        .0 > 0,
        _ => false,
    };
    match role {
        Some(r) if r >= need => Ok(r),
        Some(r) if r.can_view() || has_boards => Err(AppError::forbidden(denied(need))),
        _ => Err(AppError::not_found("Project")),
    }
}

/// A board's project, and the caller's role on it. A board in the trash (or in a
/// project in the trash) is not found.
pub async fn document_role(state: &AppState, caller: &Caller, document_id: &str) -> ApiResult<(String, Role)> {
    let row: Option<(String, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT d.project_id, pm.role, dr.role, s.token, s.access
         FROM documents d
         JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
         LEFT JOIN project_members pm ON pm.project_id = d.project_id AND pm.user_id = $2
         LEFT JOIN document_roles dr ON dr.document_id = d.id AND dr.user_id = $2
         LEFT JOIN share_links s ON s.document_id = d.id
         WHERE d.id = $1 AND d.deleted_at IS NULL",
    )
    .bind(document_id)
    .bind(caller.user.as_ref().map(|u| u.id.as_str()))
    .fetch_optional(&state.db)
    .await?;
    let Some((project_id, project, board, token, access)) = row else { return Err(AppError::not_found("Board")) };
    let mut role = if caller.user.is_some() { combine(parse(project), parse(board)) } else { Role::None };
    // Through the board's link
    let link = access.as_deref().and_then(LinkAccess::parse).unwrap_or(LinkAccess::Restricted);
    if caller.share.is_some() && caller.share == token && link.role() > role {
        role = link.role();
    }
    Ok((project_id, role))
}

/// The caller's role on a board, which must be at least `need`. Without access,
/// the board is "not found"; logged out (and no link), "log in first".
pub async fn require_document(state: &AppState, caller: &Caller, document_id: &str, need: Role) -> ApiResult<(String, Role)> {
    let (project_id, role) = document_role(state, caller, document_id).await?;
    if role >= need {
        return Ok((project_id, role));
    }
    if !role.can_view() {
        return Err(if caller.user.is_none() { AppError::unauthorized() } else { AppError::not_found("Board") });
    }
    Err(AppError::forbidden(denied(need)))
}

fn denied(need: Role) -> &'static str {
    match need {
        Role::Owner => "Only the owner can do this",
        Role::CoOwner => "Only the owner and co-owners can do this",
        Role::Editor => "You can only view this; ask the owner for edit access",
        Role::Commenter => "You can only view this; ask the owner to let you comment",
        _ => "You have no access to this",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn board_role_counts_instead_of_project_role() {
        assert_eq!(combine(Some(Role::Owner), Some(Role::None)), Role::Owner);
        assert_eq!(combine(Some(Role::Editor), Some(Role::None)), Role::None);
        assert_eq!(combine(Some(Role::Viewer), Some(Role::Editor)), Role::Editor);
        assert_eq!(combine(Some(Role::Commenter), None), Role::Commenter);
        assert_eq!(combine(None, None), Role::None);
        // Invited to one board only
        assert_eq!(combine(Some(Role::None), Some(Role::Viewer)), Role::Viewer);
    }
}
