//! Folders inside a project. The rules for the tree are in `flow_core::folders`
//! (shared with the server); every command loads the project, applies one and
//! saves it again.

use flow_core::folders;
use tauri::AppHandle;

use super::projects::{load_project, save_project};
use crate::models::{Document, Folder};
use crate::{CmdResult, storage};

/// Creates a folder at the end of its parent (`None` = project root).
#[tauri::command]
#[specta::specta]
pub fn create_folder(app: AppHandle, project_id: String, name: String, parent_id: Option<String>) -> CmdResult<Folder> {
    let mut project = load_project(&app, &project_id)?;
    let folder = folders::add_folder(&mut project, storage::new_id(), name, parent_id)?;
    save_project(&app, &mut project)?;
    Ok(folder)
}

#[tauri::command]
#[specta::specta]
pub fn rename_folder(app: AppHandle, project_id: String, folder_id: String, name: String) -> CmdResult<()> {
    let mut project = load_project(&app, &project_id)?;
    folders::rename_folder(&mut project, &folder_id, name)?;
    save_project(&app, &mut project)
}

/// Moves a folder to another parent (`None` = project root) and/or position.
#[tauri::command]
#[specta::specta]
pub fn move_folder(app: AppHandle, project_id: String, folder_id: String, parent_id: Option<String>, order: f64) -> CmdResult<()> {
    let mut project = load_project(&app, &project_id)?;
    folders::move_folder(&mut project, &folder_id, parent_id, order)?;
    save_project(&app, &mut project)
}

/// Deletes a folder. Its contents (subfolders and documents) move up one level.
#[tauri::command]
#[specta::specta]
pub fn delete_folder(app: AppHandle, project_id: String, folder_id: String) -> CmdResult<()> {
    let mut project = load_project(&app, &project_id)?;
    let new_parent = folders::remove_folder(&mut project, &folder_id)?;
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
