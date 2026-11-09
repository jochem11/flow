//! Diagrams from a codebase in the desktop app: a folder's source files (picked
//! in the app) read here, without sending them anywhere, and kept while the app
//! runs, to draw activity diagrams of its functions (flow_core::code_flow).

use std::sync::{Arc, LazyLock, Mutex};

use flow_core::code_flow::{self, Codebase};
use flow_core::models::{CodeActivity, CodeSource, SourceFile};

use crate::CmdResult;

/// The codebases read, by id (the last few)
static KEPT: LazyLock<Mutex<Vec<(String, Arc<Codebase>)>>> = LazyLock::new(|| Mutex::new(vec![]));
const MAX_KEPT: usize = 5;

#[tauri::command]
#[specta::specta]
pub async fn code_read_files(name: String, files: Vec<SourceFile>) -> CmdResult<CodeSource> {
    let files: Vec<(String, String)> = files.into_iter().map(|f| (f.path, f.text)).collect();
    let code = tauri::async_runtime::spawn_blocking(move || code_flow::read(&files)).await.map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let source = code_flow::source(&id, name.trim(), &code);
    let mut kept = KEPT.lock().unwrap();
    if kept.len() >= MAX_KEPT {
        kept.remove(0);
    }
    kept.push((id, Arc::new(code)));
    Ok(source)
}

#[tauri::command]
#[specta::specta]
pub async fn code_activity(id: String, entry: String, depth: u8) -> CmdResult<CodeActivity> {
    let code = KEPT.lock().unwrap().iter().find(|(k, _)| *k == id).map(|(_, c)| c.clone()).ok_or("The code is no longer here: read it again")?;
    tauri::async_runtime::spawn_blocking(move || code_flow::activity(&code, &entry, depth.min(4)))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "That function is not in the code".into())
}
