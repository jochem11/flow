//! Everything made from a document, done by `flow_core` (which the server shares).
//! Only writing export files to the Downloads folder is the app's own work.

use std::path::{Path, PathBuf};

use flow_core::flow::{self, safe_file_name};
use flow_core::models::{
    Arranged, CodeFile, CodeImport, CodeLanguage, DiagramImport, Document, Edge, EerDoc, ExportFormat, FlowDoc, Node, SqlDialect, SqlImport,
};
use flow_core::{arrange, code_import, codegen, dbml, eer, import, mermaid, sql_import};
use tauri::{AppHandle, Manager};

use crate::CmdResult;

#[tauri::command]
#[specta::specta]
pub fn auto_layout(nodes: Vec<Node>, edges: Vec<Edge>) -> CmdResult<Arranged> {
    Ok(arrange::arrange(&nodes, &edges))
}

/// Writes the export to the Downloads folder: one file, or several (Java) in a
/// new folder. Returns the path of the file or folder.
#[tauri::command]
#[specta::specta]
pub fn export_document(app: AppHandle, doc: Document, format: ExportFormat) -> CmdResult<String> {
    let dir = app.path().download_dir().map_err(|e| format!("cannot find the Downloads folder: {e}"))?;
    let files = flow::export(&doc, format)?;
    let write = |path: &Path, bytes: &[u8]| std::fs::write(path, bytes).map_err(|e| format!("cannot write {}: {e}", path.display()));
    if let [file] = files.as_slice() {
        let (stem, ext) = file.name.rsplit_once('.').unwrap_or((&file.name, "txt"));
        let path = unique_path(&dir, stem, ext);
        write(&path, &file.bytes)?;
        return Ok(path.display().to_string());
    }
    let base = safe_file_name(&doc.name);
    let folder = (1..)
        .map(|i| if i == 1 { dir.join(&base) } else { dir.join(format!("{base} ({i})")) })
        .find(|p| !p.exists())
        .expect("an infinite sequence always finds one");
    std::fs::create_dir_all(&folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
    for f in &files {
        write(&folder.join(&f.name), &f.bytes)?;
    }
    Ok(folder.display().to_string())
}

/// `name.ext`, or `name (2).ext`, `name (3).ext`, ... if it already exists.
fn unique_path(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{name}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|i| dir.join(format!("{name} ({i}).{ext}")))
        .find(|p| !p.exists())
        .expect("an infinite sequence always finds one")
}

/// The SQL for a diagram, as a preview in the app.
#[tauri::command]
#[specta::specta]
pub fn eer_sql(doc: EerDoc, dialect: SqlDialect) -> String {
    eer::to_sql(&doc, dialect, "")
}

/// Code for the UML classes in a flowchart, to preview.
#[tauri::command]
#[specta::specta]
pub fn class_code(flow: FlowDoc, language: CodeLanguage) -> Vec<CodeFile> {
    codegen::generate(&flow, language, "model")
}

/// The Mermaid blocks for a document, to preview: one per diagram in it.
#[tauri::command]
#[specta::specta]
pub fn mermaid_preview(doc: Document) -> Vec<CodeFile> {
    mermaid::blocks(&doc)
}

/// The tables and relations in a SQL script, to add to an EER diagram.
#[tauri::command]
#[specta::specta]
pub fn import_sql(sql: String) -> SqlImport {
    sql_import::read_sql(&sql)
}

/// The diagram as DBML (dbdiagram.io), as a preview in the app.
#[tauri::command]
#[specta::specta]
pub fn eer_dbml(doc: EerDoc) -> String {
    dbml::to_dbml(&doc)
}

/// The tables, relations and table groups in DBML, to add to an EER diagram.
#[tauri::command]
#[specta::specta]
pub fn import_dbml(dbml: String) -> SqlImport {
    dbml::read_dbml(&dbml)
}

/// The classes in source code, as a class diagram. Without a language it is guessed.
#[tauri::command]
#[specta::specta]
pub fn import_code(code: String, language: Option<CodeLanguage>) -> CodeImport {
    code_import::import_guessing(&code, language)
}

/// A Mermaid diagram, a draw.io file or an Excalidraw drawing, as blocks and lines.
#[tauri::command]
#[specta::specta]
pub fn import_diagram(text: String) -> DiagramImport {
    import::import_diagram(&text)
}
