//! The HTTP API, all under `/api`, and the web version for everything else.
//!
//!   auth.rs (crate root)  /api/auth/...   accounts and logging in
//!   projects.rs           projects and folders
//!   documents.rs          boards
//!   members.rs            people in a project, invites
//!   sharing.rs            a board's access, public link, guests
//!   comments.rs           comments on boards
//!   tools.rs              layout, export, SQL, code, Mermaid, imports
//!   trash.rs              deleted boards and projects (30 days)
//!   personal.rs           stars and recently opened boards

pub mod activity;
pub mod comments;
pub mod documents;
pub mod files;
pub mod history;
pub mod inbox;
pub mod members;
pub mod personal;
pub mod projects;
pub mod sharing;
pub mod templates;
pub mod tools;
pub mod trash;

use axum::Router;
use axum::extract::{DefaultBodyLimit, Request};
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::middleware::{self, Next};
use axum::response::Response;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::state::AppState;

/// Boards can be large (big diagrams, long texts)
const MAX_BODY: usize = 32 * 1024 * 1024;

/// The web version's files: the built scripts and styles have their content's hash in
/// their names, so they never change and may be kept; the pages must always be asked
/// for again, or a browser keeps running an old version after an update.
async fn cache_headers(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let mut res = next.run(req).await;
    if !path.starts_with("/api/") {
        let value = if path.starts_with("/assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
        res.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static(value));
    }
    res
}

pub fn api() -> Router<AppState> {
    Router::new()
        .merge(crate::auth::routes())
        .merge(projects::routes())
        .merge(documents::routes())
        .merge(members::routes())
        .merge(sharing::routes())
        .merge(comments::routes())
        .merge(files::routes())
        .merge(history::routes())
        .merge(templates::routes())
        .merge(tools::routes())
        .merge(trash::routes())
        .merge(personal::routes())
        .merge(inbox::routes())
        .merge(activity::routes())
        .merge(crate::collab::routes())
        .merge(crate::events::routes())
}

pub fn app(state: AppState) -> Router {
    let origins: Vec<HeaderValue> = state.config.allowed_origins.iter().filter_map(|o| o.parse().ok()).collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("x-flow"),
            HeaderName::from_static("x-flow-share"),
            HeaderName::from_static("x-flow-client"),
        ])
        .expose_headers([header::CONTENT_DISPOSITION]);

    let mut app = Router::new().nest("/api", api());
    // The web version: files from the build, and index.html for its own paths (/d/..., /b/...)
    if let Some(dir) = &state.config.web_dir {
        let index = dir.join("index.html");
        app = app.fallback_service(ServeDir::new(dir).fallback(ServeFile::new(index))).layer(middleware::from_fn(cache_headers));
    }
    app.layer(DefaultBodyLimit::max(MAX_BODY)).layer(cors).layer(TraceLayer::new_for_http()).with_state(state)
}
