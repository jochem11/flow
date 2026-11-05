//! Flow's server: accounts (email + password, Google), projects and their boards
//! in PostgreSQL, who may do what (`access`), invites, public links with guests,
//! comments, and the tools from `flow_core` for the web version.
//! It also serves the web build (`WEB_DIR`).
//!
//!   config    settings from the environment       state     what every handler gets
//!   error     errors as JSON responses             tokens    random tokens, hashes, ids
//!   mail      verification, reset and invite mail  auth      sessions, logging in, Google
//!   access    roles: who may do what               routes/   the HTTP API under /api
//!   collab    editing together (WebSocket, Yjs)

pub mod access;
pub mod auth;
pub mod collab;
pub mod config;
pub mod error;
pub mod events;
pub mod mail;
pub mod routes;
pub mod state;
pub mod tokens;

pub use state::AppState;
