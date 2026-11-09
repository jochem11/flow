//! Diagrams from a codebase: its functions found (read.rs, with tree-sitter for
//! Java, Kotlin, C#, Go, Python, TypeScript and JavaScript), and the activity
//! diagram of one of them, following the calls it makes (activity.rs).
//!
//! The codebase comes as files: from a folder (the desktop app, or a git
//! repository the server cloned) or sent from the browser.

pub mod activity;
pub mod lang;
pub mod read;
#[cfg(test)]
mod tests;

use std::path::Path;

pub use activity::activity;
pub use read::{read, Codebase};

use crate::models::{CodeFunction, CodeSource};

/// Folders that hold no code of the project itself
pub const SKIP_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", "out", "bin", "obj", "vendor", "__pycache__", ".venv", "venv", "env",
    ".idea", ".vscode", ".gradle", ".next", ".nuxt", ".svelte-kit", "coverage", ".mvn", "Pods", "DerivedData", ".tox",
];

/// At most this many source files are read
pub const MAX_FILES: usize = 5000;

/// The source files under a folder (paths relative to it), in the languages read.
pub fn read_folder(root: &Path) -> (Vec<(String, String)>, Vec<String>) {
    let mut files = vec![];
    let mut skipped = vec![];
    let mut todo = vec![root.to_path_buf()];
    while let Some(dir) = todo.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let path = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(kind) = e.file_type() else { continue };
            // Links are not followed (they may lead out of the folder)
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                    todo.push(path);
                }
                continue;
            }
            let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            if lang::Lang::of(&rel).is_none() {
                continue;
            }
            if files.len() >= MAX_FILES {
                skipped.push(format!("More than {MAX_FILES} source files: the rest was not read"));
                return (files, skipped);
            }
            match std::fs::metadata(&path) {
                Ok(m) if m.len() as usize > read::MAX_FILE => {
                    skipped.push(format!("{rel}: too big to read"));
                    continue;
                }
                Err(_) => continue,
                _ => {}
            }
            match std::fs::read_to_string(&path) {
                Ok(text) => files.push((rel, text)),
                Err(_) => skipped.push(format!("{rel}: not text")),
            }
        }
    }
    (files, skipped)
}

/// What a read codebase holds, to pick a function from (with routes first, then by file).
pub fn source(id: &str, name: &str, code: &Codebase) -> CodeSource {
    let mut functions: Vec<CodeFunction> = code
        .functions
        .iter()
        .map(|f| CodeFunction {
            id: f.id.clone(),
            name: f.name.clone(),
            class: f.class.clone(),
            file: f.file.clone(),
            line: f.line,
            route: f.route.clone(),
            steps: count(&f.body),
        })
        .collect();
    functions.sort_by(|a, b| (a.route.is_none(), &a.file, a.line).cmp(&(b.route.is_none(), &b.file, b.line)));
    CodeSource { id: id.to_string(), name: name.to_string(), files: code.files as u32, functions, skipped: code.skipped.clone() }
}

fn count(stmts: &[read::Stmt]) -> u32 {
    use read::Stmt::*;
    stmts
        .iter()
        .map(|s| {
            1 + match s {
                If { then, els, .. } => count(then) + els.as_deref().map(count).unwrap_or(0),
                Loop { body, .. } | Block(body) => count(body),
                Switch { cases, .. } => cases.iter().map(|(_, b)| count(b)).sum(),
                Try { body, catches, finally } => count(body) + catches.iter().map(|(_, b)| count(b)).sum::<u32>() + finally.as_deref().map(count).unwrap_or(0),
                _ => 0,
            }
        })
        .sum()
}
