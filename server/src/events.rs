//! Live notices to logged-in people (`/api/ws/events`), so their app follows
//! changes made by others right away:
//!
//!   {"type":"project","projectId":…}   the project's boards, folders or people changed:
//!                                       load the sidebar again
//!   {"type":"access","projectId":…}    your own access changed: check the open board
//!                                       (closed when gone, read-only when lowered)
//!   {"type":"inbox"}                    your inbox changed: load it again
//!   {"type":"session"}                  this device may have been logged out
//!                                       elsewhere: check (the login screen if so)
//!
//! Access itself is never decided here: every request still goes through
//! `access.rs`, and changing someone's access also cuts their board connections
//! (`collab::Rooms::kick_user`). This only makes the screen follow immediately.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;

use crate::auth::identify;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

struct Conn {
    /// The hash of the session it was opened with
    session: String,
    tx: mpsc::UnboundedSender<String>,
}

#[derive(Default)]
pub struct Events {
    /// Open event connections per user (one per open app)
    conns: Mutex<HashMap<String, Vec<Conn>>>,
}

impl Events {
    fn send_user(&self, user_id: &str, msg: &str) {
        let mut conns = self.conns.lock().unwrap();
        if let Some(list) = conns.get_mut(user_id) {
            list.retain(|c| c.tx.send(msg.to_string()).is_ok());
        }
    }

    /// Sessions of someone were logged out (`ended` says which, by their hash):
    /// the apps using them check now, and show the login screen.
    pub fn sessions_ended(&self, user_id: &str, ended: impl Fn(&str) -> bool) {
        let msg = json!({ "type": "session" }).to_string();
        let mut conns = self.conns.lock().unwrap();
        if let Some(list) = conns.get_mut(user_id) {
            list.retain(|c| !ended(&c.session) || c.tx.send(msg.clone()).is_ok());
        }
    }

    /// Something new in someone's inbox (or read elsewhere).
    pub fn inbox_changed(&self, user_id: &str) {
        self.send_user(user_id, &json!({ "type": "inbox" }).to_string());
    }

    /// Someone's own access changed (in this project).
    pub fn access_changed(&self, user_id: &str, project_id: &str) {
        self.send_user(user_id, &json!({ "type": "access", "projectId": project_id }).to_string());
    }
}

/// Tells everyone in a project that it changed (boards, folders, people).
pub async fn project_changed(state: &AppState, project_id: &str) {
    let members: Vec<(String,)> = sqlx::query_as("SELECT user_id FROM project_members WHERE project_id = $1").bind(project_id).fetch_all(&state.db).await.unwrap_or_default();
    let msg = json!({ "type": "project", "projectId": project_id }).to_string();
    for (user,) in members {
        state.events.send_user(&user, &msg);
    }
}

/// Someone's access changed: their app checks it now, and their board connections are cut.
pub async fn access_changed(state: &AppState, user_id: &str, project_id: &str) {
    state.events.access_changed(user_id, project_id);
    state.rooms.kick_user(user_id);
    project_changed(state, project_id).await;
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/ws/events", get(connect))
}

#[derive(Deserialize)]
struct EventsQuery {
    /// The desktop app's session token
    token: Option<String>,
}

/// With a cookie, a WebSocket must come from one of our own pages: browsers send
/// cookies to WebSockets from any site. Same origin (the page and the server are
/// one address), or an origin allowed in the settings.
pub fn from_our_pages(state: &AppState, headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) else { return true };
    let host = headers.get("host").and_then(|v| v.to_str().ok()).unwrap_or("");
    let origin_host = origin.split("://").nth(1).unwrap_or("");
    origin_host == host || origin == state.config.public_url || state.config.allowed_origins.iter().any(|o| o == origin)
}

async fn connect(State(state): State<AppState>, Query(q): Query<EventsQuery>, headers: HeaderMap, ws: WebSocketUpgrade) -> ApiResult<Response> {
    if q.token.is_none() && !from_our_pages(&state, &headers) {
        return Err(AppError::forbidden("Not from a Flow page"));
    }
    let caller = identify(&state, &headers, q.token, None).await?;
    let user_id = caller.user()?.id.clone();
    let session = caller.session.as_deref().map(crate::tokens::hash).unwrap_or_default();
    Ok(ws.on_upgrade(move |socket| run(state, user_id, session, socket)))
}

async fn run(state: AppState, user_id: String, session: String, socket: WebSocket) {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    state.events.conns.lock().unwrap().entry(user_id.clone()).or_default().push(Conn { session, tx });
    let (mut sink, mut stream) = socket.split();
    let mut ping = tokio::time::interval(Duration::from_secs(25));
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Some(text) => if sink.send(WsMessage::Text(text.into())).await.is_err() { break },
                None => break,
            },
            // Keeps proxies from closing a quiet connection
            _ = ping.tick() => if sink.send(WsMessage::Ping(Vec::new().into())).await.is_err() { break },
            incoming = stream.next() => match incoming {
                Some(Ok(WsMessage::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
        }
    }
    // Drop closed senders (this one) for the user
    let mut conns = state.events.conns.lock().unwrap();
    if let Some(list) = conns.get_mut(&user_id) {
        list.retain(|c| !c.tx.is_closed());
        if list.is_empty() {
            conns.remove(&user_id);
        }
    }
}
