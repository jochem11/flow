//! Files and paths. Commands only go through these helpers, so path handling
//! and id validation live in one place.
//!
//! Layout inside the app data directory:
//!
//!   projects/
//!     <project-id>/
//!       project.json        name, description, folders
//!       docs/
//!         <doc-id>.json     one document (flow, text, kanban or EER)
//!
//! Where the app data directory is:
//!   macOS:   ~/Library/Application Support/nl.jochem.flowapp/
//!   Windows: C:\Users\<you>\AppData\Roaming\nl.jochem.flowapp\
//!   Linux:   ~/.local/share/nl.jochem.flowapp/

use std::path::{Path, PathBuf};

use serde::{Serialize, de::DeserializeOwned};
// `Manager` is the trait that provides `app.path()`; it has to be in scope.
use tauri::{AppHandle, Manager};

use crate::CmdResult;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

fn data_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("cannot find the app data directory: {e}"))
}

/// Creates `dir` (including missing parents) and returns it.
fn ensure_dir(dir: PathBuf) -> CmdResult<PathBuf> {
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("cannot create directory {}: {e}", dir.display()))?;
    Ok(dir)
}

/// `projects/`, created if missing.
pub fn projects_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    ensure_dir(data_dir(app)?.join("projects"))
}

/// `projects/<project_id>/`, created if missing.
pub fn project_dir(app: &AppHandle, project_id: &str) -> CmdResult<PathBuf> {
    validate_id(project_id)?;
    ensure_dir(projects_dir(app)?.join(project_id))
}

/// `projects/<project_id>/project.json`
pub fn project_file(app: &AppHandle, project_id: &str) -> CmdResult<PathBuf> {
    Ok(project_dir(app, project_id)?.join("project.json"))
}

/// `projects/<project_id>/docs/`, created if missing.
pub fn docs_dir(app: &AppHandle, project_id: &str) -> CmdResult<PathBuf> {
    ensure_dir(project_dir(app, project_id)?.join("docs"))
}

/// `projects/<project_id>/docs/<doc_id>.json`
pub fn doc_path(app: &AppHandle, project_id: &str, doc_id: &str) -> CmdResult<PathBuf> {
    validate_id(doc_id)?;
    Ok(docs_dir(app, project_id)?.join(format!("{doc_id}.json")))
}

/// Checks that an id is safe to use as a file or directory name.
///
/// Ids come from the frontend, so without this check an id like `../../x`
/// could read or write outside the data directory. We only create UUIDs
/// (letters, digits and `-`), so that is all we accept.
pub fn validate_id(id: &str) -> CmdResult<()> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');

    if ok {
        Ok(())
    } else {
        Err(format!("invalid id: {id:?}"))
    }
}

/// A new unique id (UUID v4), e.g. "0f8c2e1a-3b4d-4c5e-9f60-718293a4b5c6".
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Milliseconds since 1970, the same as `Date.now()` in JS.
pub fn now_ms() -> CmdResult<u64> {
    Ok(std::time::SystemTime::now()
        // Only fails if the system clock is set before 1970.
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("cannot read the system time: {e}"))?
        // u128 -> u64: fits for the next few hundred million years.
        .as_millis() as u64)
}

// ---------------------------------------------------------------------------
// JSON
//
// Generic over `T`, so the same functions read and write a `Project`, a
// `Document`, or anything else serde can handle.
// ---------------------------------------------------------------------------

/// Reads a JSON file as `T`. Usage: `let project: Project = read_json(&path)?;`
pub fn read_json<T: DeserializeOwned>(path: &Path) -> CmdResult<T> {
    let json = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    // On a shape mismatch serde reports the exact field and line.
    serde_json::from_str(&json).map_err(|e| format!("{} is corrupt: {e}", path.display()))
}

/// Writes `value` as pretty-printed JSON, safe against crashes halfway through.
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> CmdResult<()> {
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value)
        .map_err(|e| format!("cannot serialize to JSON: {e}"))?;

    // Write to a temp file first, then rename over the real file. A rename is
    // atomic, so a crash leaves either the old or the new file, never half of one.
    std::fs::write(&tmp, json).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("cannot save {}: {e}", path.display()))
}

/// Deletes a file. A file that is already gone counts as success.
pub fn remove_file(path: &Path) -> CmdResult<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete {}: {e}", path.display())),
    }
}

/// Reads every `.json` file in `dir` as `T`. Unreadable or corrupt files are
/// skipped, so one broken file does not break the whole list.
pub fn read_all_json<T: DeserializeOwned>(dir: &Path) -> CmdResult<Vec<T>> {
    let items = std::fs::read_dir(dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        // Leftover `.json.tmp` files have the extension "tmp" and are skipped here.
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .filter_map(|path| read_json(&path).ok())
        .collect();
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_ids() {
        assert!(validate_id("0f8c2e1a-3b4d-4c5e-9f60-718293a4b5c6").is_ok());
        assert!(validate_id("board-1").is_ok());
        assert!(validate_id(&new_id()).is_ok());
    }

    #[test]
    fn dangerous_ids_are_rejected() {
        for id in ["", "../secret", "a/b", "a\\b", "board.json", "has space"] {
            assert!(validate_id(id).is_err(), "{id:?} should be rejected");
        }
    }

    #[test]
    fn json_round_trip() {
        let dir = std::env::temp_dir().join(format!("flowapp-test-{}", new_id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("x.json");

        let value = vec!["a".to_string(), "b".to_string()];
        write_json(&path, &value).unwrap();
        let back: Vec<String> = read_json(&path).unwrap();
        assert_eq!(back, value);

        // A corrupt file next to it is skipped by read_all_json
        std::fs::write(dir.join("corrupt.json"), "{ not valid").unwrap();
        let all: Vec<Vec<String>> = read_all_json(&dir).unwrap();
        assert_eq!(all.len(), 1);

        remove_file(&path).unwrap();
        remove_file(&path).unwrap(); // already gone: still Ok
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
