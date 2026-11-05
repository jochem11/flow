//! The session token for the Flow server, kept in the system keychain
//! (macOS Keychain, Windows Credential Manager, Secret Service on Linux) rather
//! than in a file or the web view's storage.

use crate::CmdResult;

const ACCOUNT: &str = "session";

/// Kept under the app's identifier, so Flow and Flow Dev each have their own sign-in.
fn entry(app: &tauri::AppHandle) -> CmdResult<keyring::Entry> {
    keyring::Entry::new(&app.config().identifier, ACCOUNT).map_err(|e| format!("keychain: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn get_session_token(app: tauri::AppHandle) -> CmdResult<Option<String>> {
    match entry(&app)?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keychain: {e}")),
    }
}

#[tauri::command]
#[specta::specta]
pub fn set_session_token(app: tauri::AppHandle, token: String) -> CmdResult<()> {
    entry(&app)?.set_password(&token).map_err(|e| format!("keychain: {e}"))
}

#[tauri::command]
#[specta::specta]
pub fn clear_session_token(app: tauri::AppHandle) -> CmdResult<()> {
    match entry(&app)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keychain: {e}")),
    }
}

/// Google sign-in for the desktop app (the "loopback" flow for native apps):
/// listens once on 127.0.0.1 for the browser coming back from the server with a
/// one-time code, answers with a "you can close this" page, and sends the code to
/// the frontend as the `login-code` event. Returns the port to give the server.
#[tauri::command]
#[specta::specta]
pub fn start_login_listener(app: tauri::AppHandle) -> CmdResult<u16> {
    use std::io::{Read, Write};
    use tauri::Emitter;

    let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("cannot listen for the sign-in: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        // Give up after 10 minutes
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(600);
        while std::time::Instant::now() < deadline {
            let Ok((mut stream, _)) = listener.accept() else {
                std::thread::sleep(std::time::Duration::from_millis(100));
                continue;
            };
            let _ = stream.set_nonblocking(false);
            let mut buf = [0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            // GET /auth?code=... HTTP/1.1
            let target = request.split_whitespace().nth(1).unwrap_or("");
            let code = target.split_once("code=").map(|(_, c)| c.split('&').next().unwrap_or("").to_string());
            let body = if code.is_some() {
                "<!doctype html><meta charset=utf-8><title>Signed in</title><body style=\"font:15px system-ui;margin:20vh auto;max-width:420px\"><h2>You are signed in</h2><p>You can close this tab and go back to Flow.</p>"
            } else {
                "<!doctype html><meta charset=utf-8><title>Flow</title><body>Waiting for the sign-in…"
            };
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            if let Some(code) = code {
                let _ = app.emit("login-code", code);
                return;
            }
        }
    });
    Ok(port)
}
