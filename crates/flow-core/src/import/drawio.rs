//! draw.io / diagrams.net files (`.drawio`, also an exported `.drawio.svg`): the
//! first page's shapes and connectors. Shapes become the nearest kind of block
//! (rhombus → decision, ellipse → pill, note, actor, lifeline, swimlane and
//! container → section), with their position, size, text and fill color.

use std::collections::HashMap;
use std::io::Read;

use base64::Engine;
use serde_json::json;

use super::{color_of, edge, empty, node, plain_text, skip, to_origin};
use crate::models::{DiagramImport, ImportFormat, NodeKind, Point};

pub fn read(src: &str) -> DiagramImport {
    let mut out = empty(None);
    let Ok(doc) = roxmltree::Document::parse(src) else {
        out.skipped.push("This XML could not be read".into());
        return out;
    };
    let root = doc.root_element();
    // An SVG exported by draw.io keeps the drawing in its `content`
    if root.tag_name().name() == "svg" {
        return match root.attribute("content") {
            Some(c) if c.contains("<mxfile") || c.contains("<mxGraphModel") => read(c),
            _ => {
                out.skipped.push("This SVG has no draw.io drawing in it".into());
                out
            }
        };
    }
    let model = match root.tag_name().name() {
        "mxGraphModel" => Some(src.to_string()),
        "mxfile" => {
            let pages: Vec<_> = root.children().filter(|n| n.has_tag_name("diagram")).collect();
            if pages.len() > 1 {
                out.skipped.push(format!("Only the first of {} pages", pages.len()));
            }
            pages.first().and_then(|page| {
                // Plain, or compressed: base64 of deflated, URL-encoded XML
                match page.children().find(|n| n.has_tag_name("mxGraphModel")) {
                    Some(m) => Some(src[m.range()].to_string()),
                    None => inflate(page.text().unwrap_or("").trim()),
                }
            })
        }
        _ => None,
    };
    let Some(model) = model else {
        if root.tag_name().name() == "mxfile" {
            out.skipped.push("The drawing in this file could not be read".into());
        }
        return out;
    };
    let Ok(doc) = roxmltree::Document::parse(&model) else {
        out.skipped.push("The drawing in this file could not be read".into());
        return out;
    };
    out.format = Some(ImportFormat::Drawio);
    cells(&doc, &mut out);
    out
}

/// A compressed page: base64 → raw deflate → `encodeURIComponent`d XML.
fn inflate(data: &str) -> Option<String> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(data.split_whitespace().collect::<String>()).ok()?;
    let mut xml = String::new();
    flate2::read::DeflateDecoder::new(&bytes[..]).read_to_string(&mut xml).ok()?;
    Some(percent_decode(&xml))
}

fn percent_decode(s: &str) -> String {
    let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `rounded=0;whiteSpace=wrap;fillColor=#dae8fc;` → its keys; a first word
/// without `=` (`ellipse;…`, `text;…`) is the shape.
fn style_map(style: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for (i, part) in style.split(';').map(str::trim).filter(|p| !p.is_empty()).enumerate() {
        match part.split_once('=') {
            Some((k, v)) => {
                m.insert(k.trim().to_string(), v.trim().to_string());
            }
            None if i == 0 => {
                m.insert("shape".into(), part.to_string());
            }
            None => {
                m.insert(part.to_string(), "1".into());
            }
        }
    }
    m
}

struct Cell<'a> {
    id: String,
    label: String,
    style: HashMap<String, String>,
    parent: String,
    vertex: bool,
    edge: bool,
    source: Option<String>,
    target: Option<String>,
    geo: Option<roxmltree::Node<'a, 'a>>,
}

fn num(n: Option<roxmltree::Node>, attr: &str) -> f64 {
    n.and_then(|g| g.attribute(attr)).and_then(|v| v.parse().ok()).filter(|v: &f64| v.is_finite()).unwrap_or(0.0)
}

fn cells(doc: &roxmltree::Document, out: &mut DiagramImport) {
    let mut list: Vec<Cell> = vec![];
    for c in doc.descendants().filter(|n| n.has_tag_name("mxCell")) {
        // `<UserObject label=… id=…><mxCell …/></UserObject>`
        let wrap = c.parent().filter(|p| p.has_tag_name("UserObject") || p.has_tag_name("object"));
        let id = wrap.and_then(|w| w.attribute("id")).or(c.attribute("id")).unwrap_or("").to_string();
        let style = style_map(c.attribute("style").unwrap_or(""));
        let raw = wrap.and_then(|w| w.attribute("label")).or(c.attribute("value")).unwrap_or("");
        let label = if style.get("html").is_some_and(|v| v == "1") || raw.contains('<') { plain_text(raw) } else { raw.trim().to_string() };
        list.push(Cell {
            id,
            label,
            style,
            parent: c.attribute("parent").unwrap_or("").to_string(),
            vertex: c.attribute("vertex") == Some("1"),
            edge: c.attribute("edge") == Some("1"),
            source: c.attribute("source").map(String::from),
            target: c.attribute("target").map(String::from),
            geo: c.children().find(|g| g.has_tag_name("mxGeometry")),
        });
    }
    let by_id: HashMap<&str, usize> = list.iter().enumerate().map(|(i, c)| (c.id.as_str(), i)).collect();

    // Where a cell's own coordinates start: the corner of the shape it is in
    fn origin(i: usize, list: &[Cell], by_id: &HashMap<&str, usize>, depth: usize) -> (f64, f64) {
        let Some(&p) = by_id.get(list[i].parent.as_str()) else { return (0.0, 0.0) };
        if !list[p].vertex || depth > 32 {
            return (0.0, 0.0);
        }
        let (x, y) = origin(p, list, by_id, depth + 1);
        (x + num(list[p].geo, "x"), y + num(list[p].geo, "y"))
    }

    let mut ids: HashMap<String, String> = HashMap::new();
    let mut labels: HashMap<String, Vec<String>> = HashMap::new();
    let mut node_index: HashMap<String, usize> = HashMap::new();
    for (i, c) in list.iter().enumerate().filter(|(_, c)| c.vertex) {
        let s = &c.style;
        let shape = s.get("shape").map(String::as_str).unwrap_or("");
        // Text on a connector
        if shape == "edgeLabel" || s.contains_key("edgeLabel") || by_id.get(c.parent.as_str()).is_some_and(|&p| list[p].edge) {
            if !c.label.is_empty() {
                labels.entry(c.parent.clone()).or_default().push(c.label.clone());
            }
            continue;
        }
        if shape == "image" || s.contains_key("image") {
            skip(&mut out.skipped, "Pictures are not imported");
            continue;
        }
        if shape == "line" {
            continue;
        }
        let (ox, oy) = origin(i, &list, &by_id, 0);
        let (x, y, w, h) = (ox + num(c.geo, "x"), oy + num(c.geo, "y"), num(c.geo, "width").max(10.0), num(c.geo, "height").max(10.0));
        let no_fill = s.get("fillColor").is_some_and(|v| v == "none");
        let no_stroke = s.get("strokeColor").is_some_and(|v| v == "none");
        let kind = match shape {
            _ if shape == "swimlane" || s.contains_key("swimlane") || s.get("container").is_some_and(|v| v == "1") || shape == "group" => NodeKind::Section,
            "text" => NodeKind::Label,
            "rhombus" | "mxgraph.flowchart.decision" => NodeKind::Diamond,
            "ellipse" | "doubleEllipse" if c.label.is_empty() && w <= 60.0 && h <= 60.0 => {
                if shape == "doubleEllipse" || s.contains_key("endFill") { NodeKind::End } else { NodeKind::Start }
            }
            "ellipse" | "doubleEllipse" | "mxgraph.flowchart.terminator" | "mxgraph.flowchart.start_1" | "mxgraph.flowchart.start_2" => NodeKind::Pill,
            "umlActor" => NodeKind::Actor,
            "umlLifeline" => NodeKind::Lifeline,
            "note" | "mxgraph.flowchart.document" => NodeKind::Note,
            _ if no_fill && no_stroke => NodeKind::Label,
            _ if s.get("rounded").is_some_and(|v| v == "1") && s.get("arcSize").and_then(|a| a.parse::<f64>().ok()).is_some_and(|a| a >= 40.0) => NodeKind::Pill,
            _ => NodeKind::Box,
        };
        if !matches!(shape, "" | "text" | "rhombus" | "ellipse" | "doubleEllipse" | "swimlane" | "group" | "umlActor" | "umlLifeline" | "note")
            && !shape.starts_with("mxgraph.flowchart")
        {
            skip(&mut out.skipped, "Some shapes are drawn as plain blocks");
        }
        let (w, h) = if kind == NodeKind::Label { (w, h.max(40.0)) } else { (w, h) };
        let mut n = node(kind, x, y, w, h, &c.label);
        if kind == NodeKind::Lifeline {
            n.person = s.get("participant").is_some_and(|p| p == "umlActor").then_some(true);
        }
        if !matches!(kind, NodeKind::Label | NodeKind::Start | NodeKind::End) {
            if let Some(f) = s.get("fillColor").or(s.get("swimlaneFillColor")) {
                n.color = color_of(f);
            }
        }
        ids.insert(c.id.clone(), n.id.clone());
        node_index.insert(c.id.clone(), out.nodes.len());
        out.nodes.push(n);
    }
    // In a container: its section is the node's frame
    for c in list.iter().filter(|c| c.vertex) {
        let (Some(&i), Some(pid)) = (node_index.get(&c.id), ids.get(&c.parent)) else { continue };
        if node_index.get(&c.parent).is_some_and(|&p| out.nodes[p].kind == NodeKind::Section) {
            out.nodes[i].parent = Some(pid.clone());
        }
    }

    for (i, c) in list.iter().enumerate().filter(|(_, c)| c.edge) {
        let s = &c.style;
        let (ox, oy) = origin(i, &list, &by_id, 0);
        let point = |name: &str| {
            c.geo.and_then(|g| g.children().find(|p| p.has_tag_name("mxPoint") && p.attribute("as") == Some(name))).map(|p| Point { x: ox + num(Some(p), "x"), y: oy + num(Some(p), "y") })
        };
        let from = c.source.as_ref().and_then(|s| ids.get(s));
        let to = c.target.as_ref().and_then(|t| ids.get(t));
        let (fp, tp) = (if from.is_none() { point("sourcePoint") } else { None }, if to.is_none() { point("targetPoint") } else { None });
        if (from.is_none() && fp.is_none()) || (to.is_none() && tp.is_none()) {
            skip(&mut out.skipped, "Connectors without both ends are left out");
            continue;
        }
        let cap = |which: &str, default: &str| {
            let arrow = s.get(which).map(String::as_str).unwrap_or(default);
            let fill = s.get(if which == "endArrow" { "endFill" } else { "startFill" }).map_or(true, |f| f != "0");
            match arrow {
                "none" | "" => "none",
                "block" | "blockThin" if !fill => "triangle",
                "open" | "openThin" | "openAsync" => "open",
                "diamond" | "diamondThin" if !fill => "hollowDiamond",
                "diamond" | "diamondThin" => "diamond",
                "oval" | "circle" | "dash" => "dot",
                a if a.starts_with("ER") => "none",
                _ => "arrow",
            }
        };
        let style = match s.get("edgeStyle").map(String::as_str) {
            Some("orthogonalEdgeStyle" | "elbowEdgeStyle" | "entityRelationEdgeStyle" | "isometricEdgeStyle") => "elbow",
            _ if s.get("curved").is_some_and(|v| v == "1") => "curved",
            _ => "straight",
        };
        let mut text: Vec<String> = vec![];
        if !c.label.is_empty() {
            text.push(c.label.clone());
        }
        text.extend(labels.remove(&c.id).unwrap_or_default());
        let label = (!text.is_empty()).then(|| text.join(" "));
        let mut e = edge(
            from.map_or("", |s| s.as_str()),
            to.map_or("", |s| s.as_str()),
            json!({
                "style": style,
                "pattern": if s.get("dashed").is_some_and(|v| v == "1") { Some("dashed") } else { None },
                "startCap": cap("startArrow", "none"),
                "endCap": cap("endArrow", "classic"),
                "label": label,
            }),
        );
        e.from_point = fp;
        e.to_point = tp;
        out.edges.push(e);
    }
    if out.nodes.is_empty() && out.edges.is_empty() {
        out.skipped.push("No shapes found on the first page".into());
    }
    to_origin(&mut out.nodes, &mut out.edges);
}
