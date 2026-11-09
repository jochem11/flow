//! Diagrams from a codebase (flow_core::code_flow): a git repository cloned
//! here, or a folder's source files sent from the browser, read and kept for an
//! hour, to draw activity diagrams of its functions.
//!
//!   POST /api/code/repo            { url, branch? }  → CodeSource
//!   POST /api/code/files           { name, files }   → CodeSource
//!   POST /api/code/{id}/activity   { entry, depth }  → CodeActivity

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use flow_core::code_flow::{self, Codebase};
use flow_core::models::{CodeActivity, CodeSource, SourceFile};
use serde::Deserialize;

use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

/// How long a codebase read is kept
const KEEP: Duration = Duration::from_secs(60 * 60);
/// At most this many kept at once (the oldest goes)
const MAX_KEPT: usize = 20;
/// A clone that takes longer is stopped
const CLONE_TIME: Duration = Duration::from_secs(120);

struct Kept {
    user: String,
    at: Instant,
    code: Arc<Codebase>,
}

/// The codebases read, by id
#[derive(Default)]
pub struct CodeCache(Mutex<HashMap<String, Kept>>);

impl CodeCache {
    fn keep(&self, user: &str, code: Codebase) -> String {
        let id = crate::tokens::new_id();
        let mut map = self.0.lock().unwrap();
        map.retain(|_, k| k.at.elapsed() < KEEP);
        while map.len() >= MAX_KEPT {
            let Some(oldest) = map.iter().min_by_key(|(_, k)| k.at).map(|(id, _)| id.clone()) else { break };
            map.remove(&oldest);
        }
        map.insert(id.clone(), Kept { user: user.to_string(), at: Instant::now(), code: Arc::new(code) });
        id
    }

    fn get(&self, user: &str, id: &str) -> Option<Arc<Codebase>> {
        let mut map = self.0.lock().unwrap();
        let k = map.get_mut(id).filter(|k| k.user == user && k.at.elapsed() < KEEP)?;
        // Used: kept longer
        k.at = Instant::now();
        Some(k.code.clone())
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/code/repo", post(from_repo))
        .route("/code/files", post(from_files))
        .route("/code/{id}/activity", post(activity))
}

#[derive(Deserialize)]
struct Repo {
    url: String,
    #[serde(default)]
    branch: Option<String>,
}

/// A repository's address: https only, not a machine on the server's own network
/// (the server fetches it, so it must not be a way into what only it can reach)
fn check_url(url: &str) -> Result<reqwest::Url, AppError> {
    let bad = || AppError::bad("Give the repository's https address, e.g. https://github.com/owner/project");
    let u = reqwest::Url::parse(url.trim()).map_err(|_| bad())?;
    if u.scheme() != "https" || url.len() > 500 {
        return Err(bad());
    }
    let host = u.host_str().ok_or_else(bad)?.trim_matches(['[', ']']).to_lowercase();
    let local = host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") || host.ends_with(".localhost") || !host.contains('.');
    let private_ip = host.parse::<IpAddr>().is_ok_and(|ip| match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified() || v4.is_broadcast(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified() || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80,
    });
    if local || private_ip {
        return Err(AppError::bad("That address is not a public repository"));
    }
    Ok(u)
}

/// The repository's name from its address: `https://github.com/a/shop.git` → shop
fn repo_name(u: &reqwest::Url) -> String {
    u.path_segments().and_then(|mut s| s.next_back().map(String::from)).unwrap_or_default().trim_end_matches(".git").to_string()
}

async fn from_repo(State(state): State<AppState>, caller: Caller, Json(r): Json<Repo>) -> ApiResult<Json<CodeSource>> {
    let user = caller.user()?.id.clone();
    if !state.limits.allow(&format!("code:{user}")) {
        return Err(AppError::new(axum::http::StatusCode::TOO_MANY_REQUESTS, "Too many repositories at once; try again in a few minutes"));
    }
    let url = check_url(&r.url)?;
    let branch = r.branch.map(|b| b.trim().to_string()).filter(|b| !b.is_empty());
    if branch.as_deref().is_some_and(|b| b.starts_with('-') || b.contains(char::is_whitespace)) {
        return Err(AppError::bad("That is not a branch name"));
    }
    let dir = std::env::temp_dir().join(format!("flow-code-{}", crate::tokens::new_id()));
    let mut git = tokio::process::Command::new("git");
    git.args(["-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "core.symlinks=false", "clone", "--depth", "1", "--single-branch", "--no-tags", "--quiet"]);
    if let Some(b) = &branch {
        git.args(["--branch", b]);
    }
    git.arg("--").arg(url.as_str()).arg(&dir);
    // Never asks for a password (a private repository fails instead)
    git.env("GIT_TERMINAL_PROMPT", "0").env("GIT_ASKPASS", "true").env("GCM_INTERACTIVE", "never").kill_on_drop(true);
    let out = tokio::time::timeout(CLONE_TIME, git.output()).await;
    let result = match out {
        Err(_) => Err(AppError::bad("The repository took too long to download")),
        Ok(Err(e)) => Err(AppError::internal(format!("git: {e}"))),
        Ok(Ok(o)) if !o.status.success() => {
            let err = String::from_utf8_lossy(&o.stderr).to_lowercase();
            Err(AppError::bad(if err.contains("not found") || err.contains("could not read") || err.contains("authentication") {
                "Repository not found, or it is private (give its address with an access token in it: https://TOKEN@github.com/owner/project)"
            } else if err.contains("remote branch") {
                "That branch is not in the repository"
            } else {
                "The repository could not be downloaded"
            }))
        }
        Ok(Ok(_)) => {
            let at = dir.clone();
            let name = repo_name(&url);
            tokio::task::spawn_blocking(move || {
                let (files, skipped) = code_flow::read_folder(&at);
                let mut code = code_flow::read(&files);
                code.skipped.extend(skipped);
                (name, code)
            })
            .await
            .map_err(AppError::internal)
        }
    };
    let _ = tokio::fs::remove_dir_all(&dir).await;
    let (name, code) = result?;
    Ok(Json(finish(&state, &user, &name, code)))
}

#[derive(Deserialize)]
struct Files {
    name: String,
    files: Vec<SourceFile>,
}

async fn from_files(State(state): State<AppState>, caller: Caller, Json(f): Json<Files>) -> ApiResult<Json<CodeSource>> {
    let user = caller.user()?.id.clone();
    if f.files.len() > code_flow::MAX_FILES {
        return Err(AppError::bad(format!("More than {} source files: pick a smaller folder", code_flow::MAX_FILES)));
    }
    let files: Vec<(String, String)> = f.files.into_iter().map(|s| (s.path, s.text)).collect();
    let code = tokio::task::spawn_blocking(move || code_flow::read(&files)).await.map_err(AppError::internal)?;
    Ok(Json(finish(&state, &user, f.name.trim(), code)))
}

fn finish(state: &AppState, user: &str, name: &str, code: Codebase) -> CodeSource {
    let probe = code_flow::source("", name, &code);
    let id = state.code.keep(user, code);
    flow_core::models::CodeSource { id, ..probe }
}

#[derive(Deserialize)]
struct Activity {
    entry: String,
    #[serde(default = "two")]
    depth: u8,
}

fn two() -> u8 {
    2
}

async fn activity(State(state): State<AppState>, caller: Caller, Path(id): Path<String>, Json(a): Json<Activity>) -> ApiResult<Json<CodeActivity>> {
    let user = caller.user()?.id.clone();
    let code = state.code.get(&user, &id).ok_or_else(|| AppError::not_found("The code (read it again: it is kept for an hour)"))?;
    let depth = a.depth.min(4);
    let drawn = tokio::task::spawn_blocking(move || code_flow::activity(&code, &a.entry, depth)).await.map_err(AppError::internal)?;
    drawn.map(Json).ok_or_else(|| AppError::not_found("That function"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_https_repositories() {
        assert!(check_url("https://github.com/spring-projects/spring-petclinic").is_ok());
        assert!(check_url("https://TOKEN@github.com/me/private.git").is_ok());
        for bad in ["http://github.com/a/b", "file:///etc", "ssh://git@github.com/a/b", "https://localhost/a", "https://127.0.0.1/a", "https://10.0.0.4/a", "https://192.168.1.2/a", "https://[::1]/a", "https://intranet/a", "git@github.com:a/b.git"] {
            assert!(check_url(bad).is_err(), "{bad}");
        }
        assert_eq!(repo_name(&check_url("https://github.com/a/shop.git").unwrap()), "shop");
    }
}
