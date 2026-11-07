//! Data model shared with the frontend.
//!
//! This is the source of truth: `specta::Type` generates `src/bindings.ts` from
//! these types (on `npm run tauri dev` or `npm run bindings`).
//!
//!   Project ── has ──> Folder   (a tree via `parent_id`)
//!      └────── has ──> Document (in a folder via `folder_id`, or at the root)
//!                         └── content: Flow | Text | Kanban | Eer

// Re-export everything so callers write `crate::models::Project`
// instead of `crate::models::project::Project`.
mod access;
mod account;
mod chart;
mod document;
mod eer;
mod flow;
mod history;
mod inbox;
mod kanban;
mod personal;
mod project;
mod text;

pub use access::*;
pub use account::*;
pub use chart::*;
pub use document::*;
pub use eer::*;
pub use flow::*;
pub use history::*;
pub use inbox::*;
pub use kanban::*;
pub use personal::*;
pub use project::*;
pub use text::*;

#[cfg(test)]
mod tests {
    use super::*;

    /// A flowchart document exactly as the frontend sends it.
    #[test]
    fn document_from_frontend_json() {
        let json = r#"{
            "id": "d1", "projectId": "p1", "folderId": null, "order": 1, "name": "Test",
            "content": {
                "kind": "flow",
                "data": {
                    "nodes": [
                        { "id": "a", "kind": "pill", "x": -80, "y": -30, "w": 160, "h": 60, "text": "Start", "color": "green" },
                        { "id": "b", "kind": "diamond", "x": -90, "y": 70, "w": 180, "h": 120, "text": "Done?", "color": "blue" }
                    ],
                    "edges": [
                        { "id": "e1", "from": "a", "to": "b" },
                        { "id": "e2", "from": "b", "to": "a", "label": "No" }
                    ],
                    "camera": { "x": 10, "y": 20, "zoom": 1.5 }
                }
            },
            "updatedAt": 1761490000000
        }"#;

        let doc: Document = serde_json::from_str(json).expect("frontend JSON should parse");
        assert_eq!(doc.folder_id, None);
        assert_eq!(doc.content.kind(), DocumentKind::Flow);

        let DocContent::Flow(flow) = &doc.content else {
            panic!("expected a flowchart");
        };
        assert_eq!(flow.nodes[1].kind, NodeKind::Diamond);
        assert_eq!(flow.edges[1].label.as_deref(), Some("No"));

        // Round trip: camelCase and the "kind"/"data" shape are preserved,
        // and a missing label is omitted rather than written as null.
        let out = serde_json::to_string(&doc).unwrap();
        assert!(out.contains("\"projectId\""));
        assert!(out.contains("\"kind\":\"flow\""));
        assert!(!out.contains("\"label\":null"));
    }

    #[test]
    fn text_document() {
        let json = r#"{
            "id": "d2", "projectId": "p1", "folderId": "f1", "order": 2, "name": "Notes",
            "content": { "kind": "text", "data": { "markdown": "Hello" } }
        }"#;
        let doc: Document = serde_json::from_str(json).unwrap();
        assert_eq!(doc.folder_id.as_deref(), Some("f1"));
        assert_eq!(doc.content.kind(), DocumentKind::Text);
    }

    /// A kanban board saved before labels, times, subtasks and comments existed.
    #[test]
    fn old_kanban_board_still_loads() {
        let json = r#"{ "columns": [
            { "id": "c1", "title": "To do", "cards": [
                { "id": "k1", "title": "Login page", "description": "" }
            ] }
        ] }"#;
        let board: KanbanDoc = serde_json::from_str(json).expect("old board should load");
        let card = &board.columns[0].cards[0];
        assert!(board.labels.is_empty());
        assert_eq!(card.parent_id, None);
        assert!(card.label_ids.is_empty() && card.comments.is_empty());
        assert_eq!(card.expected_hours, None);

        // Unset optional fields are left out when saving again
        let out = serde_json::to_string(&board).unwrap();
        assert!(!out.contains("parentId") && !out.contains("expectedHours"));
    }
}
