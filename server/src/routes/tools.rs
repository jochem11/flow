//! The tools of the desktop app for the web version: layout, export, SQL, code,
//! Mermaid and imports, all from `flow_core`. Open to anyone who is logged in,
//! a guest, or on a share link (they only compute; nothing is stored).

use std::io::Write;

use axum::Json;
use axum::Router;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use flow_core::flow::{self, ExportFile, safe_file_name};
use flow_core::models::{Arranged, Brand, CodeFile, CodeImport, CodeLanguage, DiagramImport, Document, Edge, EerDoc, ExportFormat, FlowDoc, Node, SqlDialect, SqlImport};
use flow_core::{arrange, code_import, codegen, dbml, eer, import, mermaid, sql_import};
use serde::Deserialize;

use crate::auth::Caller;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/tools/layout", post(layout))
        .route("/tools/export", post(export))
        .route("/tools/sql", post(sql))
        .route("/tools/code", post(code))
        .route("/tools/mermaid", post(mermaid_blocks))
        .route("/tools/import-sql", post(import_sql))
        .route("/tools/dbml", post(to_dbml))
        .route("/tools/import-dbml", post(import_dbml))
        .route("/tools/import-code", post(import_code))
        .route("/tools/import-diagram", post(import_diagram))
}

fn allowed(caller: &Caller) -> ApiResult<()> {
    if caller.user.is_none() && caller.guest.is_none() && caller.share.is_none() {
        return Err(AppError::unauthorized());
    }
    Ok(())
}

#[derive(Deserialize)]
struct Layout {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
}

async fn layout(caller: Caller, Json(l): Json<Layout>) -> ApiResult<Json<Arranged>> {
    allowed(&caller)?;
    Ok(Json(arrange::arrange(&l.nodes, &l.edges)))
}

#[derive(Deserialize)]
struct Export {
    doc: Document,
    format: ExportFormat,
    /// The look of the project the document is in
    #[serde(default)]
    brand: Option<Brand>,
}

fn content_type(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or("") {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "md" => "text/markdown; charset=utf-8",
        _ => "text/plain; charset=utf-8",
    }
}

/// The export as a download: the file, or (several, as for Java) a zip of them.
async fn export(caller: Caller, Json(e): Json<Export>) -> ApiResult<Response> {
    allowed(&caller)?;
    let mut files = flow::export_with(&e.doc, e.format, e.brand.as_ref())?;
    let file = if files.len() == 1 {
        files.remove(0)
    } else {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for f in &files {
            zip.start_file(f.name.as_str(), zip::write::SimpleFileOptions::default()).map_err(AppError::internal)?;
            zip.write_all(&f.bytes).map_err(AppError::internal)?;
        }
        let bytes = zip.finish().map_err(AppError::internal)?.into_inner();
        ExportFile { name: format!("{}.zip", safe_file_name(&e.doc.name)), bytes }
    };
    let disposition = format!("attachment; filename=\"{}\"; filename*=UTF-8''{}", file.name.replace('"', ""), percent(&file.name));
    let mut res = file.bytes.into_response();
    res.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type(&file.name)));
    res.headers_mut().insert(header::CONTENT_DISPOSITION, HeaderValue::from_str(&disposition).map_err(AppError::internal)?);
    Ok(res)
}

/// A file name for `filename*=` (RFC 5987).
fn percent(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

#[derive(Deserialize)]
struct Sql {
    doc: EerDoc,
    dialect: SqlDialect,
}

async fn sql(caller: Caller, Json(s): Json<Sql>) -> ApiResult<Json<String>> {
    allowed(&caller)?;
    Ok(Json(eer::to_sql(&s.doc, s.dialect, "")))
}

#[derive(Deserialize)]
struct Code {
    flow: FlowDoc,
    language: CodeLanguage,
    /// The board's name, for the header and the file names
    #[serde(default)]
    title: Option<String>,
}

async fn code(caller: Caller, Json(c): Json<Code>) -> ApiResult<Json<Vec<CodeFile>>> {
    allowed(&caller)?;
    Ok(Json(codegen::generate(&c.flow, c.language, c.title.as_deref().unwrap_or("model"))))
}

#[derive(Deserialize)]
struct Doc {
    doc: Document,
}

async fn mermaid_blocks(caller: Caller, Json(d): Json<Doc>) -> ApiResult<Json<Vec<CodeFile>>> {
    allowed(&caller)?;
    Ok(Json(mermaid::blocks(&d.doc)))
}

#[derive(Deserialize)]
struct ImportSql {
    sql: String,
}

async fn import_sql(caller: Caller, Json(i): Json<ImportSql>) -> ApiResult<Json<SqlImport>> {
    allowed(&caller)?;
    Ok(Json(sql_import::read_sql(&i.sql)))
}

#[derive(Deserialize)]
struct Dbml {
    doc: EerDoc,
}

async fn to_dbml(caller: Caller, Json(d): Json<Dbml>) -> ApiResult<Json<String>> {
    allowed(&caller)?;
    Ok(Json(dbml::to_dbml(&d.doc)))
}

#[derive(Deserialize)]
struct ImportDbml {
    dbml: String,
}

async fn import_dbml(caller: Caller, Json(i): Json<ImportDbml>) -> ApiResult<Json<SqlImport>> {
    allowed(&caller)?;
    Ok(Json(dbml::read_dbml(&i.dbml)))
}

#[derive(Deserialize)]
struct ImportCode {
    code: String,
    language: Option<CodeLanguage>,
}

async fn import_code(caller: Caller, Json(i): Json<ImportCode>) -> ApiResult<Json<CodeImport>> {
    allowed(&caller)?;
    Ok(Json(code_import::import_guessing(&i.code, i.language)))
}

#[derive(Deserialize)]
struct ImportDiagram {
    text: String,
}

/// At most this much text (a big draw.io file is a few MB)
const MAX_IMPORT: usize = 20 * 1024 * 1024;

async fn import_diagram(caller: Caller, Json(i): Json<ImportDiagram>) -> ApiResult<Json<DiagramImport>> {
    allowed(&caller)?;
    if i.text.len() > MAX_IMPORT {
        return Err(AppError::bad("This file is too big to import"));
    }
    Ok(Json(import::import_diagram(&i.text)))
}
