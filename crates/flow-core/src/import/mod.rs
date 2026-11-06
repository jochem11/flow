//! Diagrams made elsewhere, onto a board: Mermaid (flowchart, sequence, class,
//! state, mind map and ER diagrams, also as ```mermaid blocks in Markdown),
//! draw.io / diagrams.net files and Excalidraw drawings.
//!
//! Each reader turns what it understands into the board's own blocks and lines
//! and says what it left out (`skipped`). Mermaid has no positions, so those
//! diagrams are laid out here (sequence diagrams by their order, the rest with
//! Arrange); draw.io and Excalidraw keep theirs, moved to start at (0, 0).

mod drawio;
mod excalidraw;
mod mermaid;
#[cfg(test)]
mod tests;

use std::collections::HashMap;

use serde_json::{Value, json};

use crate::arrange;
use crate::models::{DiagramImport, Edge, ImportFormat, Node, NodeColor, NodeKind};

/// Reads `src` as whichever of the formats it is.
pub fn import_diagram(src: &str) -> DiagramImport {
    let text = src.trim_start_matches('\u{feff}').trim();
    let mut out = if text.starts_with('<') {
        drawio::read(text)
    } else if text.starts_with('{') {
        excalidraw::read(text)
    } else {
        let blocks = markdown_blocks(text);
        if blocks.is_empty() { mermaid::read(text) } else { mermaid::read_blocks(&blocks) }
    };
    if out.format.is_none() && out.skipped.is_empty() {
        out.skipped.push("This is not a Mermaid diagram, a draw.io file or an Excalidraw drawing".into());
    }
    out
}

/// The ```mermaid blocks of a Markdown file (Flow's own Mermaid export writes one
/// per diagram), or none when it is not Markdown with such blocks.
fn markdown_blocks(text: &str) -> Vec<String> {
    let mut blocks = vec![];
    let mut current: Option<String> = None;
    for line in text.lines() {
        let t = line.trim();
        match &mut current {
            None if t.starts_with("```mermaid") || t.starts_with("~~~mermaid") => current = Some(String::new()),
            Some(b) if t.starts_with("```") || t.starts_with("~~~") => {
                blocks.push(std::mem::take(b));
                current = None;
            }
            Some(b) => {
                b.push_str(line);
                b.push('\n');
            }
            None => {}
        }
    }
    blocks
}

pub(crate) fn empty(format: Option<ImportFormat>) -> DiagramImport {
    DiagramImport { format, diagram: None, nodes: vec![], edges: vec![], eer: None, skipped: vec![] }
}

/// A note in `skipped`, once.
pub(crate) fn skip(out: &mut Vec<String>, note: &str) {
    if !out.iter().any(|s| s == note) {
        out.push(note.to_string());
    }
}

pub(crate) fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(crate) fn kind_name(kind: NodeKind) -> String {
    serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_else(|| "box".into())
}

/// A node, with what is not given left out.
pub(crate) fn node(kind: NodeKind, x: f64, y: f64, w: f64, h: f64, text: &str) -> Node {
    serde_json::from_value(json!({
        "id": uid(), "kind": kind_name(kind), "x": x, "y": y, "w": w, "h": h, "text": text, "color": "white"
    }))
    .expect("a valid node")
}

/// A line between two nodes, with more fields (`endCap`, `pattern`, ...) as JSON.
pub(crate) fn edge(from: &str, to: &str, extra: Value) -> Edge {
    let mut e = json!({ "id": uid(), "from": from, "to": to });
    if let (Some(e), Some(x)) = (e.as_object_mut(), extra.as_object()) {
        for (k, v) in x {
            if !v.is_null() {
                e.insert(k.clone(), v.clone());
            }
        }
    }
    serde_json::from_value(e).expect("a valid edge")
}

/// The size a block needs for its text: at least the usual size of its kind,
/// wider for long lines (up to a limit, then the text wraps) and taller for more
/// lines. Multiples of 20, as the app's sizes.
pub(crate) fn fit(kind: NodeKind, text: &str) -> (f64, f64) {
    let (w0, h0) = match kind {
        NodeKind::Diamond => (180.0, 120.0),
        NodeKind::Pill => (160.0, 60.0),
        NodeKind::Start | NodeKind::End | NodeKind::Circle | NodeKind::FlowFinal => return (40.0, 40.0),
        NodeKind::Bar => return (160.0, 8.0),
        NodeKind::Topic => (160.0, 48.0),
        NodeKind::Note => (180.0, 100.0),
        NodeKind::Label => (160.0, 40.0),
        NodeKind::Actor => return (60.0, 100.0),
        NodeKind::UseCase => (180.0, 80.0),
        _ => (180.0, 60.0),
    };
    let longest = text.lines().map(|l| l.chars().count()).max().unwrap_or(0) as f64;
    let max_w = if kind == NodeKind::Diamond { 360.0 } else { 320.0 };
    let extra = if kind == NodeKind::Diamond { 2.0 } else { 1.0 };
    let w = (longest * 7.5 * extra + 40.0).clamp(w0, max_w);
    // Lines that do not fit wrap
    let per_line = ((w - 30.0) / (7.5 * extra)).max(1.0);
    let lines: f64 = text.lines().map(|l| (l.chars().count() as f64 / per_line).ceil().max(1.0)).sum::<f64>().max(1.0);
    let h = (lines * 19.0 + 26.0) * if kind == NodeKind::Diamond { 2.0 } else { 1.0 };
    (round20(w), round20(h.max(h0)))
}

pub(crate) fn round20(v: f64) -> f64 {
    (v / 20.0).ceil() * 20.0
}

/// Lays out the nodes with Arrange, as the button does: positions, sizes of the
/// frames, and where the lines attach.
pub(crate) fn arranged(nodes: &mut [Node], edges: &mut [Edge]) {
    let a = arrange::arrange(nodes, edges);
    let pos: HashMap<&str, _> = a.nodes.iter().map(|p| (p.id.as_str(), p)).collect();
    for n in nodes.iter_mut() {
        if let Some(p) = pos.get(n.id.as_str()) {
            n.x = p.x;
            n.y = p.y;
            if let Some(w) = p.w {
                n.w = w;
            }
            if let Some(h) = p.h {
                n.h = h;
            }
        }
    }
    let ports: HashMap<&str, _> = a.edges.iter().map(|p| (p.id.as_str(), p)).collect();
    for e in edges.iter_mut() {
        if let Some(p) = ports.get(e.id.as_str()) {
            e.from_angle = p.from_angle;
            e.to_angle = p.to_angle;
            e.bend = None;
        }
    }
    to_origin(nodes, edges);
}

/// Moves everything so the top-left of the drawing is at (0, 0).
pub(crate) fn to_origin(nodes: &mut [Node], edges: &mut [Edge]) {
    let points = edges.iter().flat_map(|e| [e.from_point.as_ref(), e.to_point.as_ref()]).flatten();
    let xs = nodes.iter().map(|n| n.x).chain(points.clone().map(|p| p.x));
    let ys = nodes.iter().map(|n| n.y).chain(points.map(|p| p.y));
    let (dx, dy) = (xs.fold(f64::INFINITY, f64::min), ys.fold(f64::INFINITY, f64::min));
    if !dx.is_finite() || !dy.is_finite() {
        return;
    }
    for n in nodes.iter_mut() {
        n.x -= dx;
        n.y -= dy;
    }
    for e in edges.iter_mut() {
        for p in [e.from_point.as_mut(), e.to_point.as_mut()].into_iter().flatten() {
            p.x -= dx;
            p.y -= dy;
        }
    }
}

/// The board color nearest to a CSS color (`#dae8fc`, `#a5d8ff`, `transparent`):
/// by hue, white for grays, very light or no fill.
pub(crate) fn color_of(css: &str) -> NodeColor {
    let s = css.trim().trim_start_matches('#');
    let hex = match s.len() {
        3 => s.chars().flat_map(|c| [c, c]).collect::<String>(),
        6 | 8 => s[..6].to_string(),
        _ => return NodeColor::White,
    };
    let Ok(v) = u32::from_str_radix(&hex, 16) else { return NodeColor::White };
    let (r, g, b) = (((v >> 16) & 255) as f64 / 255.0, ((v >> 8) & 255) as f64 / 255.0, (v & 255) as f64 / 255.0);
    let (max, min) = (r.max(g).max(b), r.min(g).min(b));
    let sat = if max == 0.0 { 0.0 } else { (max - min) / max };
    if sat < 0.08 {
        return NodeColor::White;
    }
    let d = max - min;
    let hue = if max == r {
        60.0 * (((g - b) / d).rem_euclid(6.0))
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    match hue {
        h if h < 20.0 => NodeColor::Pink,
        h if h < 70.0 => NodeColor::Yellow,
        h if h < 170.0 => NodeColor::Green,
        h if h < 255.0 => NodeColor::Blue,
        h if h < 300.0 => NodeColor::Purple,
        _ => NodeColor::Pink,
    }
}

/// Text from HTML labels (draw.io): line breaks kept, tags dropped, entities read.
pub(crate) fn plain_text(html: &str) -> String {
    let mut s = String::new();
    let mut tag = String::new();
    let mut in_tag = false;
    for c in html.chars() {
        match (in_tag, c) {
            (false, '<') => {
                in_tag = true;
                tag.clear();
            }
            (true, '>') => {
                in_tag = false;
                let name = tag.trim_start_matches('/').split(|c: char| c.is_whitespace() || c == '/').next().unwrap_or("").to_lowercase();
                // A new line for <br>, and between blocks
                if name == "br" || (tag.starts_with('/') && matches!(name.as_str(), "div" | "p" | "li" | "h1" | "h2" | "h3")) {
                    s.push('\n');
                }
            }
            (true, c) => tag.push(c),
            (false, c) => s.push(c),
        }
    }
    let s = entities(&s);
    let lines: Vec<&str> = s.lines().map(str::trim).collect();
    lines.join("\n").trim().to_string()
}

/// `&amp;`, `&nbsp;`, `&#39;`, `&#x2F;` and the like.
pub(crate) fn entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let name = &rest[1..end];
        let c = match name {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ if name.starts_with("#x") || name.starts_with("#X") => u32::from_str_radix(&name[2..], 16).ok().and_then(char::from_u32),
            _ if name.starts_with('#') => name[1..].parse().ok().and_then(char::from_u32),
            _ => None,
        };
        match c {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}
