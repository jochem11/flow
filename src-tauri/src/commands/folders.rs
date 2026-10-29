//! Folders inside a project.
//!
//! Folders are not directories on disk: they are a flat list in
//! `project.folders`, and the tree comes from each folder's `parent_id`.
//! Every command loads the project, changes that list and saves it again.

use tauri::AppHandle;

use super::projects::{load_project, save_project};
use crate::models::{Document, Folder, Project};
use crate::{CmdResult, storage};

/// Creates a folder at the end of its parent (`None` = project root).
#[tauri::command]
#[specta::specta]
pub fn create_folder(
    app: AppHandle,
    project_id: String,
    name: String,
    parent_id: Option<String>,
) -> CmdResult<Folder> {
    let mut project = load_project(&app, &project_id)?;
    ensure_folder_exists(&project, parent_id.as_deref())?;

    let order = project
        .folders
        .iter()
        .filter(|f| f.parent_id == parent_id)
        .map(|f| f.order)
        .fold(0.0, f64::max)
        + 1.0;

    let folder = Folder {
        id: storage::new_id(),
        name,
        parent_id,
        order,
    };
    // `push` takes ownership, and we still return `folder`, so push a clone.
    project.folders.push(folder.clone());
    save_project(&app, &mut project)?;
    Ok(folder)
}

#[tauri::command]
#[specta::specta]
pub fn rename_folder(
    app: AppHandle,
    project_id: String,
    folder_id: String,
    name: String,
) -> CmdResult<()> {
    if name.trim().is_empty() {
        return Err("name cannot be empty".into());
    }
    let mut project = load_project(&app, &project_id)?;
    // A `&mut` into `project.folders`: changing it changes the project.
    let folder = project
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("folder not found")?;
    folder.name = name;
    save_project(&app, &mut project)
}

/// Moves a folder to another parent (`None` = project root) and/or position.
#[tauri::command]
#[specta::specta]
pub fn move_folder(
    app: AppHandle,
    project_id: String,
    folder_id: String,
    parent_id: Option<String>,
    order: f64,
) -> CmdResult<()> {
    let mut project = load_project(&app, &project_id)?;
    ensure_folder_exists(&project, parent_id.as_deref())?;
    if is_inside(&project.folders, parent_id.as_deref(), &folder_id) {
        return Err("cannot move a folder into itself".into());
    }

    let folder = project
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("folder not found")?;
    folder.parent_id = parent_id;
    folder.order = order;
    save_project(&app, &mut project)
}

/// Deletes a folder. Its contents (subfolders and documents) move up one level.
///
/// Only the direct children need a new parent: anything deeper stays attached
/// to those children and moves along with them.
#[tauri::command]
#[specta::specta]
pub fn delete_folder(app: AppHandle, project_id: String, folder_id: String) -> CmdResult<()> {
    let mut project = load_project(&app, &project_id)?;
    let new_parent = project
        .folders
        .iter()
        .find(|f| f.id == folder_id)
        .ok_or("folder not found")?
        .parent_id
        .clone();

    for f in project.folders.iter_mut() {
        if f.parent_id.as_deref() == Some(folder_id.as_str()) {
            f.parent_id = new_parent.clone();
        }
    }
    project.folders.retain(|f| f.id != folder_id);
    save_project(&app, &mut project)?;

    let dir = storage::docs_dir(&app, &project_id)?;
    let docs: Vec<Document> = storage::read_all_json(&dir)?;
    for mut doc in docs {
        if doc.folder_id.as_deref() == Some(folder_id.as_str()) {
            doc.folder_id = new_parent.clone();
            storage::write_json(&storage::doc_path(&app, &project_id, &doc.id)?, &doc)?;
        }
    }
    Ok(())
}

/// Errors if `folder_id` is given but is not a folder of this project.
/// `None` (the project root) always exists.
pub(crate) fn ensure_folder_exists(project: &Project, folder_id: Option<&str>) -> CmdResult<()> {
    match folder_id {
        Some(id) if !project.folders.iter().any(|f| f.id == id) => {
            Err(format!("folder {id} does not exist"))
        }
        _ => Ok(()),
    }
}

/// Is `folder` the same as `ancestor`, or nested inside it at any depth?
///
/// Walks up from `folder` via `parent_id` until the root. Used to prevent a
/// folder from being moved into its own subtree, which would create a cycle
/// (A inside B, B inside A) and make both disappear from the tree.
fn is_inside(folders: &[Folder], folder: Option<&str>, ancestor: &str) -> bool {
    let mut current = folder;
    while let Some(id) = current {
        if id == ancestor {
            return true;
        }
        current = folders
            .iter()
            .find(|f| f.id == id)
            .and_then(|f| f.parent_id.as_deref());
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(id: &str, parent: Option<&str>) -> Folder {
        Folder {
            id: id.into(),
            name: id.into(),
            parent_id: parent.map(Into::into),
            order: 1.0,
        }
    }

    #[test]
    fn detects_moves_into_own_subtree() {
        // a > b > c, and d at the root
        let folders = vec![
            folder("a", None),
            folder("b", Some("a")),
            folder("c", Some("b")),
            folder("d", None),
        ];
        assert!(is_inside(&folders, Some("a"), "a")); // into itself
        assert!(is_inside(&folders, Some("c"), "a")); // into a grandchild
        assert!(!is_inside(&folders, Some("d"), "a")); // into a sibling
        assert!(!is_inside(&folders, None, "a")); // to the root
        assert!(!is_inside(&folders, Some("a"), "c")); // child up into an ancestor
    }
}
