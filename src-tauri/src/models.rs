//! Datamodel, gedeeld met de frontend.
//!
//! Dit is de bron van waarheid: `specta::Type` genereert hieruit `src/bindings.ts`
//! (bij `npm run tauri dev` of `cargo test`). Pas types dus alleen hier aan.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Box,
    Diamond,
    Note,
    Pill,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeColor {
    White,
    Yellow,
    Green,
    Blue,
    Purple,
    Pink,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
    /// Linkerbovenhoek in wereld-coördinaten
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub text: String,
    pub color: NodeColor,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl Default for Camera {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, zoom: 1.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub camera: Camera,
    /// Unix-tijd in milliseconden. Handig om in save_board zelf in te vullen.
    /// u64 zou in TypeScript `bigint` worden; ms-tijdstempels passen prima in een JS-number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Option<f64>)]
    pub updated_at: Option<u64>,
}

/// Wat list_boards teruggeeft: genoeg voor het menu, zonder alle nodes.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BoardMeta {
    pub id: String,
    pub name: String,
    #[specta(type = f64)]
    pub updated_at: u64,
}

/// Resultaat van auto_layout: nieuwe linkerbovenhoek per node.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct Position {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Svg,
    Png,
    Mermaid,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Zo ziet een bord eruit zoals de frontend het stuurt.
    #[test]
    fn board_from_frontend_json() {
        let json = r#"{
            "id": "b1", "name": "Test",
            "nodes": [
                { "id": "a", "kind": "pill", "x": -80, "y": -30, "w": 160, "h": 60, "text": "Start", "color": "green" },
                { "id": "b", "kind": "diamond", "x": -90, "y": 70, "w": 180, "h": 120, "text": "Klaar?", "color": "blue" }
            ],
            "edges": [
                { "id": "e1", "from": "a", "to": "b" },
                { "id": "e2", "from": "b", "to": "a", "label": "Nee" }
            ],
            "camera": { "x": 10, "y": 20, "zoom": 1.5 },
            "updatedAt": 1761490000000
        }"#;

        let board: Board = serde_json::from_str(json).expect("frontend-JSON moet parsen");
        assert_eq!(board.nodes[1].kind, NodeKind::Diamond);
        assert_eq!(board.edges[0].label, None);
        assert_eq!(board.edges[1].label.as_deref(), Some("Nee"));
        assert_eq!(board.updated_at, Some(1761490000000));

        // En terug: camelCase, geen "label": null
        let out = serde_json::to_string(&board).unwrap();
        assert!(out.contains("\"updatedAt\""));
        assert!(!out.contains("\"label\":null"));
    }
}
