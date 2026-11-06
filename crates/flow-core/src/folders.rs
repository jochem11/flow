//! The folder tree inside a project, as rules on `Project` (shared by the desktop
//! app's file storage and the server's database).
//!
//! Folders are a flat list in `project.folders`; the tree comes from each
//! folder's `parent_id`.

use crate::models::{Folder, Project};

/// The position after the last of these orders (1 for none).
pub fn next_order(orders: impl Iterator<Item = f64>) -> f64 {
    orders.fold(0.0, f64::max) + 1.0
}

/// Errors if `folder_id` is given but is not a folder of this project.
/// `None` (the project root) always exists.
pub fn ensure_folder_exists(project: &Project, folder_id: Option<&str>) -> Result<(), String> {
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
pub fn is_inside(folders: &[Folder], folder: Option<&str>, ancestor: &str) -> bool {
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

/// A new folder at the end of its parent (`None` = project root).
pub fn add_folder(
    project: &mut Project,
    id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<Folder, String> {
    ensure_folder_exists(project, parent_id.as_deref())?;
    let order = next_order(
        project
            .folders
            .iter()
            .filter(|f| f.parent_id == parent_id)
            .map(|f| f.order),
    );
    let folder = Folder {
        id,
        name,
        parent_id,
        order,
    };
    project.folders.push(folder.clone());
    Ok(folder)
}

pub fn rename_folder(project: &mut Project, folder_id: &str, name: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("name cannot be empty".into());
    }
    project
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("folder not found")?
        .name = name;
    Ok(())
}

/// Moves a folder to another parent (`None` = project root) and/or position.
pub fn move_folder(
    project: &mut Project,
    folder_id: &str,
    parent_id: Option<String>,
    order: f64,
) -> Result<(), String> {
    ensure_folder_exists(project, parent_id.as_deref())?;
    if is_inside(&project.folders, parent_id.as_deref(), folder_id) {
        return Err("cannot move a folder into itself".into());
    }
    let folder = project
        .folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or("folder not found")?;
    folder.parent_id = parent_id;
    folder.order = order;
    Ok(())
}

/// Removes a folder; its subfolders move up one level. Returns that level (the
/// folder's parent), where the caller moves the folder's documents too.
///
/// Only the direct children need a new parent: anything deeper stays attached
/// to those children and moves along with them.
pub fn remove_folder(project: &mut Project, folder_id: &str) -> Result<Option<String>, String> {
    let new_parent = project
        .folders
        .iter()
        .find(|f| f.id == folder_id)
        .ok_or("folder not found")?
        .parent_id
        .clone();
    for f in project.folders.iter_mut() {
        if f.parent_id.as_deref() == Some(folder_id) {
            f.parent_id = new_parent.clone();
        }
    }
    project.folders.retain(|f| f.id != folder_id);
    Ok(new_parent)
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

    #[test]
    fn removing_moves_children_up() {
        let mut p = Project {
            id: "p".into(),
            name: "p".into(),
            description: String::new(),
            folders: vec![
                folder("a", None),
                folder("b", Some("a")),
                folder("c", Some("b")),
            ],
            order: 1.0,
            updated_at: None,
            role: None,
            brand: None,
        };
        assert_eq!(remove_folder(&mut p, "b").unwrap().as_deref(), Some("a"));
        assert_eq!(
            p.folders
                .iter()
                .find(|f| f.id == "c")
                .unwrap()
                .parent_id
                .as_deref(),
            Some("a")
        );
    }
}
