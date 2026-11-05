//! Real-time co-editing: one "room" per open board, holding its live Yjs
//! document (`yrs`), and a WebSocket per person on it, speaking the y-websocket
//! protocol (sync and awareness, as `y-websocket` in the browser expects).
//!
//! - Everyone who may view the board gets its state and everyone's changes;
//!   only changes from editors are applied (others' are dropped).
//! - Presence (who is here, their cursor) goes to everyone, viewers included.
//! - The state is saved to `documents.ydoc` while edited and when the last
//!   person leaves. The board's JSON (`documents.content`), which reads and
//!   exports use, is still saved by the editors' apps.
//! - A new board (no state yet) is filled by the first editor that connects:
//!   the server tells exactly one client to do so (message 100), so two people
//!   opening it at once do not both fill it.
//! - Changing someone's access closes their connections; they reconnect and
//!   get their new role. New or changed comments are announced (message 101).

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::{Message as WsMessage, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use flow_core::models::Role;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::sync::{Notify, broadcast};
use yrs::sync::{Awareness, Message, MessageReader, SyncMessage};
use yrs::updates::decoder::{Decode, DecoderV1};
use yrs::updates::encoder::Encode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::access::document_role;
use crate::auth::identify;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

/// Tells one client to fill an empty board from the JSON it loaded.
const MSG_SEED: u8 = 100;
/// The board's comments changed: load them again.
const MSG_COMMENTS: u8 = 101;

/// How often a changed board is saved while people edit it.
const SAVE_EVERY: Duration = Duration::from_secs(2);

struct Conn {
    user_id: Option<String>,
    /// Notified to close this connection (access changed)
    kick: Arc<Notify>,
}

pub struct Room {
    document_id: String,
    awareness: Awareness,
    /// (sender connection, encoded message) to everyone in the room
    tx: broadcast::Sender<(u64, Arc<Vec<u8>>)>,
    conns: Mutex<HashMap<u64, Conn>>,
    dirty: AtomicBool,
    /// The connection asked to fill the empty board, if any
    seeder: Mutex<Option<u64>>,
}

impl Room {
    fn doc(&self) -> &Doc {
        self.awareness.doc()
    }
    fn is_empty(&self) -> bool {
        self.doc().transact().state_vector().is_empty()
    }
    fn send_all(&self, from: u64, msg: &Message) {
        let _ = self.tx.send((from, Arc::new(msg.encode_v1())));
    }
}

#[derive(Default)]
pub struct Rooms {
    rooms: tokio::sync::Mutex<HashMap<String, Arc<Room>>>,
    next_conn: AtomicU64,
}

impl Rooms {
    /// The room of a board, loading its saved state the first time.
    async fn open(&self, state: &AppState, document_id: &str) -> ApiResult<Arc<Room>> {
        let mut rooms = self.rooms.lock().await;
        if let Some(room) = rooms.get(document_id) {
            return Ok(room.clone());
        }
        let (saved,): (Option<Vec<u8>>,) = sqlx::query_as("SELECT ydoc FROM documents WHERE id = $1").bind(document_id).fetch_one(&state.db).await?;
        let doc = Doc::new();
        if let Some(bytes) = saved.filter(|b| !b.is_empty()) {
            let update = Update::decode_v1(&bytes).map_err(AppError::internal)?;
            doc.transact_mut().apply_update(update).map_err(AppError::internal)?;
        }
        let (tx, _) = broadcast::channel(512);
        let room = Arc::new(Room {
            document_id: document_id.to_string(),
            awareness: Awareness::new(doc),
            tx,
            conns: Mutex::new(HashMap::new()),
            dirty: AtomicBool::new(false),
            seeder: Mutex::new(None),
        });
        rooms.insert(document_id.to_string(), room.clone());
        tokio::spawn(keep_saved(state.clone(), room.clone()));
        Ok(room)
    }

    /// Closes someone's connections everywhere (their access changed).
    pub fn kick_user(&self, user_id: &str) {
        if let Ok(rooms) = self.rooms.try_lock() {
            for room in rooms.values() {
                for c in room.conns.lock().unwrap().values().filter(|c| c.user_id.as_deref() == Some(user_id)) {
                    c.kick.notify_one();
                }
            }
        }
    }

    /// Closes every connection to a board (its link changed: everyone checks again).
    pub fn kick_board(&self, document_id: &str) {
        if let Ok(rooms) = self.rooms.try_lock() {
            if let Some(room) = rooms.get(document_id) {
                for c in room.conns.lock().unwrap().values() {
                    c.kick.notify_one();
                }
            }
        }
    }

    /// Tells everyone on a board that its comments changed.
    pub fn comments_changed(&self, document_id: &str) {
        if let Ok(rooms) = self.rooms.try_lock() {
            if let Some(room) = rooms.get(document_id) {
                room.send_all(u64::MAX, &Message::Custom(MSG_COMMENTS, vec![]));
            }
        }
    }
}

async fn save(state: &AppState, room: &Room) {
    if !room.dirty.swap(false, Ordering::SeqCst) {
        return;
    }
    let bytes = room.doc().transact().encode_state_as_update_v1(&StateVector::default());
    if let Err(e) = sqlx::query("UPDATE documents SET ydoc = $2 WHERE id = $1").bind(&room.document_id).bind(bytes).execute(&state.db).await {
        tracing::error!("cannot save the live state of {}: {e}", room.document_id);
        room.dirty.store(true, Ordering::SeqCst);
    }
}

/// Saves a room while it changes; closes it (saving once more) when everyone left.
async fn keep_saved(state: AppState, room: Arc<Room>) {
    loop {
        tokio::time::sleep(SAVE_EVERY).await;
        save(&state, &room).await;
        let mut rooms = state.rooms.rooms.lock().await;
        if room.conns.lock().unwrap().is_empty() {
            save(&state, &room).await;
            rooms.remove(&room.document_id);
            return;
        }
    }
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/ws/documents/{id}", get(connect))
}

#[derive(Deserialize)]
struct WsQuery {
    /// The desktop app's session token (it cannot send headers here)
    token: Option<String>,
    /// The share link it came through
    share: Option<String>,
}

/// A WebSocket for a board. With a cookie, it must come from our own pages:
/// browsers send cookies to WebSockets from any site, so the Origin is checked.
async fn connect(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<WsQuery>, headers: HeaderMap, ws: WebSocketUpgrade) -> ApiResult<Response> {
    if q.token.is_none() && !crate::events::from_our_pages(&state, &headers) {
        return Err(AppError::forbidden("Not from a Flow page"));
    }
    let caller = identify(&state, &headers, q.token, q.share).await?;
    let (_, role) = document_role(&state, &caller, &id).await?;
    if !role.can_view() {
        return Err(if caller.user.is_none() { AppError::unauthorized() } else { AppError::not_found("Board") });
    }
    let room = state.rooms.open(&state, &id).await?;
    let user_id = caller.user.map(|u| u.id);
    Ok(ws.on_upgrade(move |socket| run(state, room, socket, role, user_id)))
}

async fn run(state: AppState, room: Arc<Room>, socket: WebSocket, role: Role, user_id: Option<String>) {
    let conn = state.rooms.next_conn.fetch_add(1, Ordering::SeqCst);
    let kick = Arc::new(Notify::new());
    room.conns.lock().unwrap().insert(conn, Conn { user_id, kick: kick.clone() });
    let can_edit = role.can_edit();
    let (mut sink, mut stream) = socket.split();
    let mut from_room = room.tx.subscribe();
    // Awareness ids this connection announced, to remove when it leaves
    let mut clients: HashSet<yrs::block::ClientID> = HashSet::new();

    // Start: our state vector (the client answers with what we miss) and who is here,
    // each in its own frame (y-websocket reads one message per frame)
    let sv = Message::Sync(SyncMessage::SyncStep1(room.doc().transact().state_vector())).encode_v1();
    let mut ok = sink.send(WsMessage::Binary(sv.into())).await.is_ok();
    if let (true, Ok(update)) = (ok, room.awareness.update()) {
        ok = sink.send(WsMessage::Binary(Message::Awareness(update).encode_v1().into())).await.is_ok();
    }
    // An empty board: the first editor fills it
    if ok && can_edit && room.is_empty() {
        let seed = {
            let mut seeder = room.seeder.lock().unwrap();
            seeder.is_none() && {
                *seeder = Some(conn);
                true
            }
        };
        if seed {
            ok = sink.send(WsMessage::Binary(Message::Custom(MSG_SEED, vec![]).encode_v1().into())).await.is_ok();
        }
    }

    while ok {
        tokio::select! {
            _ = kick.notified() => break,
            msg = from_room.recv() => match msg {
                Ok((from, bytes)) if from != conn => ok = sink.send(WsMessage::Binary(bytes.as_ref().clone().into())).await.is_ok(),
                Ok(_) => {}
                // Fell behind: start over (the client reconnects and syncs)
                Err(broadcast::error::RecvError::Lagged(_)) => break,
                Err(broadcast::error::RecvError::Closed) => break,
            },
            incoming = stream.next() => match incoming {
                Some(Ok(WsMessage::Binary(data))) => {
                    for reply in handle(&room, conn, can_edit, &data, &mut clients) {
                        if sink.send(WsMessage::Binary(reply.into())).await.is_err() {
                            ok = false;
                        }
                    }
                }
                Some(Ok(WsMessage::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
        }
    }

    // Leaving: no longer present, and someone else may fill the board now
    room.conns.lock().unwrap().remove(&conn);
    {
        let mut seeder = room.seeder.lock().unwrap();
        if *seeder == Some(conn) && room.is_empty() {
            *seeder = None;
        }
    }
    for id in &clients {
        room.awareness.remove_state(*id);
    }
    if let Ok(update) = room.awareness.update_with_clients(clients.iter().copied()) {
        room.send_all(conn, &Message::Awareness(update));
    }
}

/// One message from a client: the replies for it (the rest goes to the room).
fn handle(room: &Room, conn: u64, can_edit: bool, data: &[u8], clients: &mut HashSet<yrs::block::ClientID>) -> Vec<Vec<u8>> {
    let mut replies = vec![];
    let mut decoder = DecoderV1::from(data);
    for msg in MessageReader::new(&mut decoder) {
        let Ok(msg) = msg else { break };
        match msg {
            // What the client misses
            Message::Sync(SyncMessage::SyncStep1(sv)) => {
                let update = room.doc().transact().encode_state_as_update_v1(&sv);
                replies.push(Message::Sync(SyncMessage::SyncStep2(update)).encode_v1());
            }
            // Changes: only from editors
            Message::Sync(SyncMessage::SyncStep2(update)) | Message::Sync(SyncMessage::Update(update)) => {
                if !can_edit {
                    continue;
                }
                let Ok(decoded) = Update::decode_v1(&update) else { continue };
                if room.doc().transact_mut().apply_update(decoded).is_ok() {
                    room.dirty.store(true, Ordering::SeqCst);
                    room.send_all(conn, &Message::Sync(SyncMessage::Update(update)));
                }
            }
            Message::Awareness(update) => {
                clients.extend(update.clients.keys().copied());
                let encoded = Message::Awareness(update.clone());
                if room.awareness.apply_update(update).is_ok() {
                    room.send_all(conn, &encoded);
                }
            }
            Message::AwarenessQuery => {
                if let Ok(update) = room.awareness.update() {
                    replies.push(Message::Awareness(update).encode_v1());
                }
            }
            Message::Auth(_) | Message::Custom(..) => {}
        }
    }
    replies
}
