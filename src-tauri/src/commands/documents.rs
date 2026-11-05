//! Documents. Each document is one JSON file in `projects/<id>/docs/`.

use tauri::AppHandle;

use flow_core::folders::ensure_folder_exists;
use super::projects::load_project;
use crate::CmdResult;
use crate::models::{DocContent, Document, DocumentKind, DocumentMeta};
use crate::storage;

/// All documents of a project without their content, sorted by `order`.
#[tauri::command]
#[specta::specta]
pub fn list_documents(app: AppHandle, project_id: String) -> CmdResult<Vec<DocumentMeta>> {
    let dir = storage::docs_dir(&app, &project_id)?;
    let docs: Vec<Document> = storage::read_all_json(&dir)?;

    // `into_iter` hands each document over to `into_meta`, so nothing is cloned.
    let mut metas: Vec<DocumentMeta> = docs.into_iter().map(Document::into_meta).collect();
    metas.sort_by(|a, b| a.order.total_cmp(&b.order));
    Ok(metas)
}

#[tauri::command]
#[specta::specta]
pub fn load_document(app: AppHandle, project_id: String, id: String) -> CmdResult<Document> {
    storage::read_json(&storage::doc_path(&app, &project_id, &id)?)
}

/// Called by the frontend's autosave, shortly after every change.
#[tauri::command]
#[specta::specta]
pub fn save_document(app: AppHandle, mut doc: Document) -> CmdResult<()> {
    let path = storage::doc_path(&app, &doc.project_id, &doc.id)?;
    doc.updated_at = Some(storage::now_ms()?);
    storage::write_json(&path, &doc)
}

/// Creates an empty document of the given kind at the end of its folder.
#[tauri::command]
#[specta::specta]
pub fn create_document(
    app: AppHandle,
    project_id: String,
    folder_id: Option<String>,
    name: String,
    kind: DocumentKind,
) -> CmdResult<Document> {
    ensure_folder_exists(&load_project(&app, &project_id)?, folder_id.as_deref())?;

    let order = list_documents(app.clone(), project_id.clone())?
        .iter()
        .filter(|d| d.folder_id == folder_id)
        .map(|d| d.order)
        .fold(0.0, f64::max)
        + 1.0;

    let doc = Document {
        id: storage::new_id(),
        project_id,
        folder_id,
        order,
        name,
        content: DocContent::empty(kind),
        updated_at: None,
    };
    // `save_document` takes ownership, and we still return `doc`, so pass a clone.
    save_document(app, doc.clone())?;
    Ok(doc)
}

/// Renames a document without the frontend having to send its content.
#[tauri::command]
#[specta::specta]
pub fn rename_document(
    app: AppHandle,
    project_id: String,
    id: String,
    name: String,
) -> CmdResult<()> {
    if name.trim().is_empty() {
        return Err("name cannot be empty".into());
    }
    let path = storage::doc_path(&app, &project_id, &id)?;
    let mut doc: Document = storage::read_json(&path)?;
    doc.name = name;
    storage::write_json(&path, &doc)
}

/// Moves a document to another folder (`None` = project root) and/or position.
#[tauri::command]
#[specta::specta]
pub fn move_document(
    app: AppHandle,
    project_id: String,
    id: String,
    folder_id: Option<String>,
    order: f64,
) -> CmdResult<()> {
    ensure_folder_exists(&load_project(&app, &project_id)?, folder_id.as_deref())?;

    let path = storage::doc_path(&app, &project_id, &id)?;
    let mut doc: Document = storage::read_json(&path)?;
    doc.folder_id = folder_id;
    doc.order = order;
    storage::write_json(&path, &doc)
}

/// Deletes a document. A document that is already gone counts as success.
#[tauri::command]
#[specta::specta]
pub fn delete_document(app: AppHandle, project_id: String, id: String) -> CmdResult<()> {
    storage::remove_file(&storage::doc_path(&app, &project_id, &id)?)
}