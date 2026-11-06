//! Excalidraw drawings (`.excalidraw`, or elements copied from it): rectangles,
//! ellipses and diamonds with their text, free text, arrows and lines (attached
//! to what they are bound to, else with free ends) and frames. Free-hand
//! strokes, pictures and embeds are left out.

use std::collections::HashMap;

use serde_json::{Value, json};

use super::{color_of, edge, empty, node, skip, to_origin};
use crate::models::{DiagramImport, ImportFormat, NodeKind, Point};

pub fn read(src: &str) -> DiagramImport {
    let mut out = empty(None);
    let Ok(doc) = serde_json::from_str::<Value>(src) else {
        out.skipped.push("This JSON could not be read".into());
        return out;
    };
    let kind = doc["type"].as_str().unwrap_or("");
    let Some(elements) = doc["elements"].as_array().filter(|_| kind.starts_with("excalidraw") || doc["source"].as_str().is_some_and(|s| s.contains("excalidraw"))) else {
        out.skipped.push("This JSON is not an Excalidraw drawing".into());
        return out;
    };
    out.format = Some(ImportFormat::Excalidraw);
    let live: Vec<&Value> = elements.iter().filter(|e| !e["isDeleted"].as_bool().unwrap_or(false)).collect();
    let f = |e: &Value, k: &str| e[k].as_f64().filter(|v| v.is_finite()).unwrap_or(0.0);

    // Text inside a shape or on an arrow belongs to it
    let mut bound_text: HashMap<&str, String> = HashMap::new();
    for e in &live {
        if e["type"] == "text" {
            if let Some(c) = e["containerId"].as_str() {
                bound_text.insert(c, text_of(e));
            }
        }
    }

    let mut ids: HashMap<&str, String> = HashMap::new();
    let mut frames: HashMap<&str, String> = HashMap::new();
    let mut frame_of: Vec<(usize, &str)> = vec![];
    for e in &live {
        let id = e["id"].as_str().unwrap_or("");
        let t = e["type"].as_str().unwrap_or("");
        let (x, y, w, h) = (f(e, "x"), f(e, "y"), f(e, "width").abs().max(10.0), f(e, "height").abs().max(10.0));
        let text = bound_text.get(id).cloned().unwrap_or_default();
        let kind = match t {
            "rectangle" => NodeKind::Box,
            "diamond" => NodeKind::Diamond,
            "ellipse" if text.is_empty() && w <= 60.0 && h <= 60.0 => NodeKind::Circle,
            "ellipse" => NodeKind::Pill,
            "text" if e["containerId"].is_string() => continue,
            "text" => NodeKind::Label,
            "frame" | "magicframe" => NodeKind::Section,
            "freedraw" => {
                skip(&mut out.skipped, "Free-hand strokes are not imported");
                continue;
            }
            "image" => {
                skip(&mut out.skipped, "Pictures are not imported");
                continue;
            }
            "embeddable" | "iframe" => {
                skip(&mut out.skipped, "Embedded pages are not imported");
                continue;
            }
            _ => continue,
        };
        if e["angle"].as_f64().is_some_and(|a| a.abs() > 0.01) {
            skip(&mut out.skipped, "Rotated shapes are imported upright");
        }
        let label = match kind {
            NodeKind::Label => text_of(e),
            NodeKind::Section => e["name"].as_str().unwrap_or("Frame").to_string(),
            _ => text,
        };
        // Text needs a little more room than Excalidraw gives it
        let (w, h) = if kind == NodeKind::Label { (w + 20.0, h.max(40.0)) } else { (w, h) };
        let mut n = node(kind, x, y, w, h, &label);
        if !matches!(kind, NodeKind::Label | NodeKind::Section) {
            if let Some(bg) = e["backgroundColor"].as_str() {
                n.color = color_of(bg);
            }
        }
        if kind == NodeKind::Section {
            frames.insert(id, n.id.clone());
        } else if let Some(fr) = e["frameId"].as_str() {
            frame_of.push((out.nodes.len(), fr));
        }
        ids.insert(id, n.id.clone());
        out.nodes.push(n);
    }
    for (i, fr) in frame_of {
        if let Some(p) = frames.get(fr) {
            out.nodes[i].parent = Some(p.clone());
        }
    }

    for e in &live {
        let t = e["type"].as_str().unwrap_or("");
        if t != "arrow" && t != "line" {
            continue;
        }
        let pts: Vec<(f64, f64)> = e["points"].as_array().map_or(vec![], |ps| {
            ps.iter().filter_map(|p| Some((p[0].as_f64()?, p[1].as_f64()?))).filter(|(a, b)| a.is_finite() && b.is_finite()).collect()
        });
        let (Some(first), Some(last)) = (pts.first(), pts.last()) else { continue };
        let (x, y) = (f(e, "x"), f(e, "y"));
        let bound = |k: &str| e[k]["elementId"].as_str().and_then(|b| ids.get(b)).cloned();
        let (from, to) = (bound("startBinding"), bound("endBinding"));
        let head = |k: &str, default: Option<&str>| {
            let v = if e[k].is_null() && !e.as_object().is_some_and(|o| o.contains_key(k)) { default } else { e[k].as_str() };
            match v {
                None => "none",
                Some("triangle" | "triangle_outline") => "triangle",
                Some("dot" | "circle" | "circle_outline") => "dot",
                Some("diamond" | "diamond_outline") => "hollowDiamond",
                Some("bar") => "none",
                Some(_) => "arrow",
            }
        };
        let (start_default, end_default) = if t == "arrow" { (None, Some("arrow")) } else { (None, None) };
        let pattern = match e["strokeStyle"].as_str() {
            Some("dashed") => Some("dashed"),
            Some("dotted") => Some("dotted"),
            _ => None,
        };
        let style = if e["elbowed"].as_bool().unwrap_or(false) {
            "elbow"
        } else if pts.len() > 2 && !e["roundness"].is_null() {
            "curved"
        } else {
            "straight"
        };
        let label = bound_text.get(e["id"].as_str().unwrap_or("")).cloned().filter(|l| !l.is_empty());
        let mut l = edge(
            from.as_deref().unwrap_or(""),
            to.as_deref().unwrap_or(""),
            json!({ "style": style, "pattern": pattern, "startCap": head("startArrowhead", start_default), "endCap": head("endArrowhead", end_default), "label": label }),
        );
        if from.is_none() {
            l.from_point = Some(Point { x: x + first.0, y: y + first.1 });
        }
        if to.is_none() {
            l.to_point = Some(Point { x: x + last.0, y: y + last.1 });
        }
        out.edges.push(l);
    }
    if out.nodes.is_empty() && out.edges.is_empty() {
        out.skipped.push("Nothing in this drawing could be imported".into());
    }
    to_origin(&mut out.nodes, &mut out.edges);
    out
}

fn text_of(e: &Value) -> String {
    e["originalText"].as_str().or(e["text"].as_str()).unwrap_or("").trim().to_string()
}
