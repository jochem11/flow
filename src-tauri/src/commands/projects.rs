//! Projects. Each project is a directory with a `project.json` (see storage.rs).

use tauri::AppHandle;

use crate::models::Project;
use crate::{CmdResult, storage};

/// All projects, in sidebar order.
#[tauri::command]
#[specta::specta]
pub fn list_projects(app: AppHandle) -> CmdResult<Vec<Project>> {
    let dir = storage::projects_dir(&app)?;

    let mut projects: Vec<Project> = std::fs::read_dir(&dir)
        .map_err(|e| format!("cannot read {}: {e}", dir.display()))?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        // Skip directories without a readable project.json instead of failing.
        .filter_map(|path| storage::read_json(&path.join("project.json")).ok())
        .collect();

    // f64 has no total order because of NaN; `total_cmp` defines one.
    projects.sort_by(|a, b| a.order.total_cmp(&b.order));
    Ok(projects)
}

/// Creates an empty project at the end of the list.
#[tauri::command]
#[specta::specta]
pub fn create_project(app: AppHandle, name: String) -> CmdResult<Project> {
    // The list is sorted, so the last project has the highest order.
    let order = list_projects(app.clone())?
        .last()
        .map(|p| p.order + 1.0)
        .unwrap_or(1.0);

    let mut project = Project {
        id: storage::new_id(),
        name,
        description: String::new(),
        folders: vec![],
        order,
        updated_at: None,
    };
    save_project(&app, &mut project)?;
    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub fn update_project(
    app: AppHandle,
    id: String,
    name: String,
    description: String,
) -> CmdResult<()> {
    let mut project = load_project(&app, &id)?;
    project.name = name;
    project.description = description;
    save_project(&app, &mut project)
}

/// Deletes a project including all of its documents.
#[tauri::command]
#[specta::specta]
pub fn delete_project(app: AppHandle, id: String) -> CmdResult<()> {
    // `project_dir` validates the id, which matters a lot before `remove_dir_all`.
    let path = storage::project_dir(&app, &id)?;
    std::fs::remove_dir_all(&path)
        .map_err(|e| format!("cannot delete project {}: {e}", path.display()))
}

pub(crate) fn load_project(app: &AppHandle, id: &str) -> CmdResult<Project> {
    storage::read_json(&storage::project_file(app, id)?)
}

/// Saves the project and sets its `updated_at`.
pub(crate) fn save_project(app: &AppHandle, project: &mut Project) -> CmdResult<()> {
    let path = storage::project_file(app, &project.id)?;
    project.updated_at = Some(storage::now_ms()?);
    storage::write_json(&path, project)
}
