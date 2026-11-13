//! Mermaid into a board: flowcharts (`flowchart` / `graph`), sequence, class,
//! state and ER diagrams, and mind maps. Styling (`classDef`, `style`, themes)
//! and interaction (`click`) are left out; what else is left out is said in
//! `skipped`.

use std::collections::{BTreeSet, HashMap};

use serde_json::json;

use super::{arranged, edge, empty, fit, node, round20, skip, uid};
use crate::uml::{layout, named, Body, Class, Field, Kind, Method, Vis};
use crate::models::{
    Attribute, Cardinality, ColumnPair, DataType, DiagramImport, DiagramType, Edge, Entity, ImportFormat, Lane, NodeKind, RefAction, Relation, SqlImport,
};
use crate::sql_import;

/// One Mermaid diagram.
pub fn read(src: &str) -> DiagramImport {
    let lines = clean(src);
    let Some(head) = lines.first() else { return empty(None) };
    let word = head.split_whitespace().next().unwrap_or("").to_lowercase();
    let body = &lines[1..];
    let mut out = match word.as_str() {
        "flowchart" | "graph" => flowchart(body),
        "sequencediagram" => sequence(body),
        "classdiagram" | "classdiagram-v2" => class_diagram(body),
        "statediagram" | "statediagram-v2" => state_diagram(body),
        "erdiagram" => er_diagram(body),
        "mindmap" => mindmap_raw(src),
        "pie" | "gantt" | "journey" | "gitgraph" | "quadrantchart" | "requirementdiagram" | "c4context" | "c4container" | "c4component"
        | "c4dynamic" | "c4deployment" | "timeline" | "sankey-beta" | "sankey" | "xychart-beta" | "xychart" | "block-beta" | "block" | "packet-beta"
        | "packet" | "kanban" | "architecture-beta" | "radar-beta" | "treemap-beta" | "zenuml" => {
            let mut out = empty(Some(ImportFormat::Mermaid));
            out.skipped.push(format!("Mermaid's \"{}\" diagrams can't be imported yet (flowcharts, sequence, class, state and ER diagrams and mind maps can)", head.split_whitespace().next().unwrap_or("")));
            return out;
        }
        _ => return empty(None),
    };
    out.format = Some(ImportFormat::Mermaid);
    if word == "flowchart" || word == "graph" {
        let dir = head.split_whitespace().nth(1).unwrap_or("TD").to_uppercase();
        if dir == "LR" || dir == "RL" {
            out.skipped.push("Laid out top to bottom (the diagram said left to right)".into());
        }
    }
    out
}

/// Several diagrams (from Markdown): side by side, one board type (the first's).
pub fn read_blocks(blocks: &[String]) -> DiagramImport {
    let mut out = empty(Some(ImportFormat::Mermaid));
    let mut x = 0.0;
    for b in blocks {
        let mut one = read(b);
        if out.diagram.is_none() {
            out.diagram = one.diagram;
        }
        if one.eer.is_some() && out.eer.is_none() {
            out.eer = one.eer.take();
        }
        let right = one.nodes.iter().map(|n| n.x + n.w).fold(0.0, f64::max);
        for n in &mut one.nodes {
            n.x += x;
        }
        for e in &mut one.edges {
            for p in [e.from_point.as_mut(), e.to_point.as_mut()].into_iter().flatten() {
                p.x += x;
            }
        }
        if !one.nodes.is_empty() {
            x += right + 160.0;
        }
        out.nodes.extend(one.nodes);
        out.edges.extend(one.edges);
        out.skipped.extend(one.skipped);
    }
    out
}

/// The lines that say something: no comments (`%%`), directives or front matter
/// (`---` … `---`), trimmed. The first is the diagram's type.
fn clean(src: &str) -> Vec<String> {
    let mut lines = vec![];
    let mut front = false;
    for (i, raw) in src.lines().enumerate() {
        let t = raw.trim();
        if t == "---" && (i == 0 || front) {
            front = !front;
            continue;
        }
        if front || t.is_empty() || t.starts_with("%%") {
            continue;
        }
        // A comment at the end of a line
        let t = match t.find("%%") {
            Some(i) if !t[..i].contains('"') => t[..i].trim_end(),
            _ => t,
        };
        lines.push(t.to_string());
    }
    lines
}

/// Text as Mermaid writes it in labels: `<br>` for a new line, `#quot;` for a
/// quote, Markdown strings in backticks.
fn label_text(s: &str) -> String {
    let s = s.trim();
    let s = s.strip_prefix('"').and_then(|x| x.strip_suffix('"')).unwrap_or(s);
    let s = s.strip_prefix('`').and_then(|x| x.strip_suffix('`')).unwrap_or(s);
    let mut t = s.to_string();
    for br in ["<br/>", "<br />", "<br>", "<BR>", "<BR/>", "\\n"] {
        t = t.replace(br, "\n");
    }
    let t = t.replace("#quot;", "\"").replace("#35;", "#").replace("#59;", ";").replace("**", "");
    // Icons (`fa:fa-car Car`) are not drawn
    let t: String = t.split(' ').filter(|w| !(w.starts_with("fa:") || w.starts_with("fab:") || w.starts_with("fas:"))).collect::<Vec<_>>().join(" ");
    t.lines().map(str::trim).collect::<Vec<_>>().join("\n").trim().to_string()
}

/// Statements split at `;` (outside quotes and brackets).
fn statements(line: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let (mut quote, mut depth) = (false, 0i32);
    for c in line.chars() {
        match c {
            '"' => quote = !quote,
            '[' | '(' | '{' if !quote => depth += 1,
            ']' | ')' | '}' if !quote => depth -= 1,
            ';' if !quote && depth <= 0 => {
                out.push(std::mem::take(&mut cur));
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

// ---------- flowchart ----------

/// A line between blocks, as read from `-->`, `-.->|text|`, `-- text --->`, ...
struct Link {
    dashed: bool,
    invisible: bool,
    start: Option<&'static str>,
    end: Option<&'static str>,
    text: Option<String>,
}

/// The part of a link made of `-`, `=` and `.`, from `i`: its length, whether it
/// is dotted, and the arrowhead after it (if any) with the chars it takes.
fn link_body(c: &[char], i: usize) -> Option<(usize, bool, Option<&'static str>, usize)> {
    let mut j = i;
    while j < c.len() && matches!(c[j], '-' | '=' | '.' | '~') {
        j += 1;
    }
    let n = j - i;
    if n < 2 || !c[i..j].iter().any(|&ch| ch == '-' || ch == '=' || ch == '~') {
        return None;
    }
    let dashed = c[i..j].contains(&'.');
    let next_ok = |k: usize| k >= c.len() || !(c[k].is_alphanumeric() || c[k] == '_');
    let (end, used) = match c.get(j) {
        Some('>') => (Some("arrow"), 1),
        Some('o') if next_ok(j + 1) => (Some("dot"), 1),
        Some('x') if next_ok(j + 1) => (Some("arrow"), 1),
        _ => (None, 0),
    };
    Some((n, dashed, end, used))
}

fn parse_link(c: &[char], mut i: usize) -> Option<(Link, usize)> {
    while i < c.len() && c[i].is_whitespace() {
        i += 1;
    }
    let mut start = None;
    if c.get(i) == Some(&'<') {
        start = Some("arrow");
        i += 1;
    } else if matches!(c.get(i), Some('o') | Some('x')) && matches!(c.get(i + 1), Some('-') | Some('=')) {
        start = Some(if c[i] == 'o' { "dot" } else { "arrow" });
        i += 1;
    }
    let (n, mut dashed, mut end, used) = link_body(c, i)?;
    let invisible = c[i..i + n].iter().all(|&ch| ch == '~');
    let mut j = i + n + used;
    let mut text = None;
    // `A -- text --> B`: the text, then the rest of the link
    if end.is_none() && n == 2 && c.get(j).is_some_and(|ch| ch.is_whitespace()) {
        let mut k = j;
        while k < c.len() {
            if matches!(c[k], '-' | '=' | '.') {
                if let Some((m, d, e, u)) = link_body(c, k) {
                    text = Some(c[j..k].iter().collect::<String>());
                    dashed = dashed || d;
                    end = e;
                    j = k + m + u;
                    break;
                }
            }
            k += 1;
        }
    }
    // `-->|text|`
    let mut k = j;
    while k < c.len() && c[k].is_whitespace() {
        k += 1;
    }
    if c.get(k) == Some(&'|') {
        // The closing `|`, not one inside quotes
        let mut quote = false;
        let close = c[k + 1..].iter().position(|&ch| {
            if ch == '"' {
                quote = !quote;
            }
            ch == '|' && !quote
        });
        if let Some(close) = close {
            text = Some(c[k + 1..k + 1 + close].iter().collect());
            j = k + 2 + close;
        }
    }
    let text = text.map(|t| label_text(&t)).filter(|t| !t.is_empty());
    Some((Link { dashed, invisible, start, end, text }, j))
}

/// Shapes: opening, closing, the kind of block.
const SHAPES: [(&str, &str, NodeKind); 15] = [
    ("(((", ")))", NodeKind::End),
    ("((", "))", NodeKind::Start),
    ("([", "])", NodeKind::Pill),
    ("[[", "]]", NodeKind::Box),
    ("[(", ")]", NodeKind::Box),
    ("{{", "}}", NodeKind::Box),
    ("[/", "/]", NodeKind::Box),
    ("[/", "\\]", NodeKind::Box),
    ("[\\", "\\]", NodeKind::Box),
    ("[\\", "/]", NodeKind::Box),
    ("[", "]", NodeKind::Box),
    ("(", ")", NodeKind::Box),
    (">", "]", NodeKind::SendSignal),
    ("{", "}", NodeKind::Diamond),
    ("@{", "}", NodeKind::Box),
];

/// A block in a statement: its id, and its kind and text when they are given.
fn parse_node(c: &[char], mut i: usize) -> Option<(String, Option<(NodeKind, String)>, usize)> {
    while i < c.len() && c[i].is_whitespace() {
        i += 1;
    }
    let start = i;
    while i < c.len() {
        let ch = c[i];
        // A `-` only inside an id (`a-b`), not where a line starts (`a-->b`)
        let id_char = ch.is_alphanumeric() || ch == '_' || ch == '$' || (ch == '-' && c.get(i + 1).is_some_and(|n| n.is_alphanumeric()) && i > start);
        if !id_char {
            break;
        }
        i += 1;
    }
    if i == start {
        return None;
    }
    let id: String = c[start..i].iter().collect();
    let rest: String = c[i..].iter().collect();
    for (open, close, kind) in SHAPES {
        if !rest.starts_with(open) {
            continue;
        }
        let inner_start = i + open.chars().count();
        let inner: String = c[inner_start..].iter().collect();
        // A quoted text may hold the closing characters
        let trimmed = inner.trim_start();
        let lead = inner.len() - trimmed.len();
        let (text, used) = if open != "@{" && trimmed.starts_with('"') {
            let Some(q) = trimmed[1..].find('"') else { continue };
            let after = &trimmed[q + 2..];
            let after_trim = after.trim_start();
            if !after_trim.starts_with(close) {
                continue;
            }
            (trimmed[..q + 2].to_string(), lead + q + 2 + (after.len() - after_trim.len()) + close.len())
        } else {
            let Some(end) = inner.find(close) else { continue };
            (inner[..end].to_string(), end + close.len())
        };
        let mut j = inner_start + inner[..used].chars().count();
        // `:::className` after a block
        if c[j..].starts_with(&[':', ':', ':']) {
            j += 3;
            while j < c.len() && (c[j].is_alphanumeric() || c[j] == '_' || c[j] == '-') {
                j += 1;
            }
        }
        if open == "@{" {
            return Some((id, Some(shape_props(&text)), j));
        }
        let text = label_text(&text);
        // `(( ))` with nothing in it is a start, `((( )))` an end; with text, a pill
        let kind = match kind {
            NodeKind::Start | NodeKind::End if !text.is_empty() => NodeKind::Pill,
            k => k,
        };
        return Some((id, Some((kind, text)), j));
    }
    let mut j = i;
    if c[j..].starts_with(&[':', ':', ':']) {
        j += 3;
        while j < c.len() && (c[j].is_alphanumeric() || c[j] == '_' || c[j] == '-') {
            j += 1;
        }
    }
    Some((id, None, j))
}

/// `A@{ shape: diamond, label: "Ok?" }`
fn shape_props(props: &str) -> (NodeKind, String) {
    let mut kind = NodeKind::Box;
    let mut text = String::new();
    for part in props.split(',') {
        let Some((k, v)) = part.split_once(':') else { continue };
        let v = v.trim().trim_matches('"').to_string();
        match k.trim() {
            "shape" => {
                kind = match v.as_str() {
                    "diamond" | "decision" | "diam" | "question" | "rhombus" => NodeKind::Diamond,
                    "stadium" | "pill" | "terminal" | "circle" | "circ" | "rounded" | "event" => NodeKind::Pill,
                    "sm-circ" | "start" | "small-circle" => NodeKind::Start,
                    "fr-circ" | "stop" | "framed-circle" | "dbl-circ" | "double-circle" => NodeKind::End,
                    "fork" | "join" => NodeKind::Bar,
                    "text" => NodeKind::Label,
                    "doc" | "document" | "notch-rect" | "card" => NodeKind::Note,
                    _ => NodeKind::Box,
                }
            }
            "label" => text = label_text(&v),
            _ => {}
        }
    }
    (kind, text)
}

fn caps(link: &Link) -> serde_json::Value {
    json!({
        "pattern": if link.dashed { Some("dashed") } else { None },
        "startCap": link.start,
        "endCap": link.end.unwrap_or("none"),
        "label": link.text,
    })
}

const FLOW_STYLING: [&str; 9] = ["classDef", "class", "style", "linkStyle", "click", "accTitle", "accDescr", "direction", "title"];

fn flowchart(lines: &[String]) -> DiagramImport {
    let mut out = empty(None);
    out.diagram = Some(DiagramType::Flowchart);
    let mut ids: HashMap<String, usize> = HashMap::new();
    let mut frames: Vec<usize> = vec![];

    for line in lines {
        for st in statements(line) {
            let first = st.split_whitespace().next().unwrap_or("");
            if FLOW_STYLING.contains(&first) {
                if first != "direction" {
                    skip(&mut out.skipped, "Styles and links (classDef, style, click) are not imported");
                }
                continue;
            }
            if first == "subgraph" {
                let rest = st["subgraph".len()..].trim();
                let c: Vec<char> = rest.chars().collect();
                // `subgraph id [title]`, `subgraph id["title"]`, `subgraph Some title`
                let bracket = rest.find('[').filter(|_| rest.ends_with(']'));
                let (id, title) = match (parse_node(&c, 0), bracket) {
                    (_, Some(b)) if !rest[..b].trim().contains(' ') && !rest[..b].trim().is_empty() => {
                        (rest[..b].trim().to_string(), label_text(&rest[b + 1..rest.len() - 1]))
                    }
                    (Some((id, None, used)), _) if used == c.len() => (id.clone(), id),
                    _ => (rest.to_string(), label_text(rest)),
                };
                let mut n = node(NodeKind::Section, 0.0, 0.0, 480.0, 320.0, &title);
                n.parent = frames.last().map(|&f| out.nodes[f].id.clone());
                ids.insert(id, out.nodes.len());
                frames.push(out.nodes.len());
                out.nodes.push(n);
                continue;
            }
            if st == "end" {
                frames.pop();
                continue;
            }
            let c: Vec<char> = st.chars().collect();
            let mut at = 0;
            let mut prev: Vec<usize> = vec![];
            let mut pending: Option<Link> = None;
            loop {
                // A group of blocks: `A & B`
                let mut group = vec![];
                loop {
                    let Some((id, shape, used)) = parse_node(&c, at) else { break };
                    at = used;
                    let i = *ids.entry(id.clone()).or_insert_with(|| {
                        let mut n = node(NodeKind::Box, 0.0, 0.0, 180.0, 60.0, &id);
                        n.parent = frames.last().map(|&f| out.nodes[f].id.clone());
                        out.nodes.push(n);
                        out.nodes.len() - 1
                    });
                    // Named inside a subgraph: in it (also when it was named before)
                    if let Some(&f) = frames.last() {
                        if f != i {
                            out.nodes[i].parent = Some(out.nodes[f].id.clone());
                        }
                    }
                    if let Some((kind, text)) = shape {
                        let n = &mut out.nodes[i];
                        n.kind = kind;
                        n.text = if matches!(kind, NodeKind::Start | NodeKind::End | NodeKind::Bar) { String::new() } else { text };
                    }
                    group.push(i);
                    let mut k = at;
                    while k < c.len() && c[k].is_whitespace() {
                        k += 1;
                    }
                    if c.get(k) == Some(&'&') {
                        at = k + 1;
                    } else {
                        break;
                    }
                }
                if group.is_empty() {
                    break;
                }
                if let Some(link) = pending.take() {
                    if !link.invisible {
                        for &a in &prev {
                            for &b in &group {
                                let (from, to) = (out.nodes[a].id.clone(), out.nodes[b].id.clone());
                                out.edges.push(edge(&from, &to, caps(&link)));
                            }
                        }
                    }
                }
                prev = group;
                match parse_link(&c, at) {
                    Some((link, used)) => {
                        pending = Some(link);
                        at = used;
                    }
                    None => break,
                }
            }
            if c[at..].iter().any(|ch| !ch.is_whitespace()) {
                skip(&mut out.skipped, &format!("Not understood: {}", st.chars().take(60).collect::<String>()));
            }
        }
    }
    for n in &mut out.nodes {
        if n.kind != NodeKind::Section {
            (n.w, n.h) = fit(n.kind, &n.text);
        }
    }
    arranged(&mut out.nodes, &mut out.edges);
    out
}

// ---------- state diagram ----------

fn state_diagram(lines: &[String]) -> DiagramImport {
    let mut out = empty(None);
    out.diagram = Some(DiagramType::State);
    let mut ids: HashMap<String, usize> = HashMap::new();
    // Composite states, and their start and end
    let mut frames: Vec<(usize, Option<usize>, Option<usize>)> = vec![];
    let mut top_start: Option<usize> = None;
    let mut top_end: Option<usize> = None;
    let mut in_note = false;

    fn state(out: &mut DiagramImport, ids: &mut HashMap<String, usize>, parent: Option<String>, id: &str) -> usize {
        *ids.entry(id.to_string()).or_insert_with(|| {
            let mut n = node(NodeKind::Pill, 0.0, 0.0, 160.0, 60.0, id);
            n.parent = parent;
            out.nodes.push(n);
            out.nodes.len() - 1
        })
    }

    for line in lines {
        let st = line.trim();
        if in_note {
            if st.eq_ignore_ascii_case("end note") {
                in_note = false;
            }
            continue;
        }
        let parent = frames.last().map(|f| out.nodes[f.0].id.clone());
        let first = st.split_whitespace().next().unwrap_or("");
        if ["classDef", "class", "style", "direction", "click", "accTitle", "accDescr", "title"].contains(&first) || st.starts_with("--") || st.starts_with("||") {
            if first == "classDef" || first == "style" || first == "class" {
                skip(&mut out.skipped, "Styles (classDef, style) are not imported");
            }
            continue;
        }
        if first == "note" {
            // `note right of A : text`, or a note over several lines up to `end note`
            if let Some((_, text)) = st.split_once(':') {
                let mut n = node(NodeKind::Note, 0.0, 0.0, 180.0, 100.0, &label_text(text));
                n.parent = parent;
                let target = st.split_whitespace().nth(3).map(|t| t.trim_end_matches(':').to_string());
                let to = target.and_then(|t| ids.get(&t).copied());
                out.nodes.push(n);
                if let Some(to) = to {
                    let (a, b) = (out.nodes.last().unwrap().id.clone(), out.nodes[to].id.clone());
                    out.edges.push(edge(&a, &b, json!({ "pattern": "dashed", "endCap": "none" })));
                }
            } else {
                in_note = true;
                skip(&mut out.skipped, "Notes over several lines are not imported");
            }
            continue;
        }
        if st == "}" {
            frames.pop();
            continue;
        }
        if let Some(rest) = st.strip_prefix("state ") {
            let rest = rest.trim();
            let opens = rest.ends_with('{');
            let rest = rest.trim_end_matches('{').trim();
            // `state "Long name" as A`, `state A <<choice>>`, `state A {`
            let (id, text) = if let Some((name, id)) = rest.split_once(" as ") {
                (id.trim().to_string(), label_text(name))
            } else {
                let id = rest.split_whitespace().next().unwrap_or(rest).to_string();
                (id.clone(), id)
            };
            if opens {
                let mut n = node(NodeKind::Section, 0.0, 0.0, 480.0, 320.0, &text);
                n.parent = parent;
                // A state named before as a plain state becomes the frame
                let i = match ids.get(&id) {
                    Some(&i) => {
                        out.nodes[i].kind = NodeKind::Section;
                        out.nodes[i].text = text;
                        i
                    }
                    None => {
                        ids.insert(id, out.nodes.len());
                        out.nodes.push(n);
                        out.nodes.len() - 1
                    }
                };
                frames.push((i, None, None));
                continue;
            }
            let i = state(&mut out, &mut ids, parent, &id);
            let n = &mut out.nodes[i];
            n.text = text;
            if rest.contains("<<choice>>") {
                n.kind = NodeKind::Diamond;
                n.text = String::new();
            } else if rest.contains("<<fork>>") || rest.contains("<<join>>") {
                n.kind = NodeKind::Bar;
                n.text = String::new();
            } else if rest.contains("<<") {
                skip(&mut out.skipped, "Some state stereotypes are drawn as plain states");
            }
            continue;
        }
        // `A --> B : label`
        if let Some((a, rest)) = st.split_once("-->") {
            let (b, text) = match rest.split_once(':') {
                Some((b, t)) => (b.trim(), Some(label_text(t))),
                None => (rest.trim(), None),
            };
            let mut end_of = |which: bool, out: &mut DiagramImport| -> usize {
                // `[*]` as a start or an end, one per composite state
                let slot = match frames.last_mut() {
                    Some(f) => if which { &mut f.1 } else { &mut f.2 },
                    None => if which { &mut top_start } else { &mut top_end },
                };
                if let Some(i) = *slot {
                    return i;
                }
                let kind = if which { NodeKind::Start } else { NodeKind::End };
                let mut n = node(kind, 0.0, 0.0, 40.0, 40.0, "");
                n.parent = parent.clone();
                out.nodes.push(n);
                *slot = Some(out.nodes.len() - 1);
                out.nodes.len() - 1
            };
            let a = a.trim();
            let from = if a == "[*]" { end_of(true, &mut out) } else { state(&mut out, &mut ids, parent.clone(), a) };
            let to = if b == "[*]" { end_of(false, &mut out) } else { state(&mut out, &mut ids, parent.clone(), b) };
            let (f, t) = (out.nodes[from].id.clone(), out.nodes[to].id.clone());
            out.edges.push(edge(&f, &t, json!({ "label": text.filter(|t| !t.is_empty()) })));
            continue;
        }
        // `A : description`
        if let Some((id, text)) = st.split_once(':') {
            let i = state(&mut out, &mut ids, parent, id.trim());
            let text = label_text(text);
            let n = &mut out.nodes[i];
            n.text = if n.text == id.trim() { format!("{}\n{text}", id.trim()) } else { format!("{}\n{text}", n.text) };
            continue;
        }
        if !st.contains(' ') {
            state(&mut out, &mut ids, parent, st);
            continue;
        }
        skip(&mut out.skipped, &format!("Not understood: {}", st.chars().take(60).collect::<String>()));
    }
    for n in &mut out.nodes {
        if n.kind != NodeKind::Section {
            (n.w, n.h) = fit(n.kind, &n.text);
        }
    }
    arranged(&mut out.nodes, &mut out.edges);
    out
}

// ---------- mind map ----------

/// A mind map from its raw lines (indentation matters).
fn mindmap_raw(src: &str) -> DiagramImport {
    let mut out = empty(Some(ImportFormat::Mermaid));
    out.diagram = Some(DiagramType::Mindmap);
    let mut stack: Vec<(usize, String)> = vec![];
    let mut seen_head = false;
    for raw in src.lines() {
        let t = raw.trim();
        if t.is_empty() || t.starts_with("%%") {
            continue;
        }
        if !seen_head {
            seen_head = t.eq_ignore_ascii_case("mindmap");
            continue;
        }
        if t.starts_with("::icon(") || t.starts_with(":::") {
            skip(&mut out.skipped, "Icons and classes are not imported");
            continue;
        }
        let indent = raw.len() - raw.trim_start().len();
        // `id((text))`, `id[text]`, `id)text(`, … or just the text
        let text = topic_text(t);
        let n = node(NodeKind::Topic, 0.0, 0.0, 160.0, 48.0, &text);
        let id = n.id.clone();
        while stack.last().is_some_and(|(i, _)| *i >= indent) {
            stack.pop();
        }
        if let Some((_, parent)) = stack.last() {
            out.edges.push(edge(parent, &id, json!({ "style": "curved", "endCap": "none", "fromAngle": 0, "toAngle": 180 })));
        } else if !out.nodes.is_empty() {
            skip(&mut out.skipped, "A mind map has one root: later roots are their own trees");
        }
        stack.push((indent, id));
        out.nodes.push(n);
    }
    for n in &mut out.nodes {
        (n.w, n.h) = fit(NodeKind::Topic, &n.text);
    }
    arranged(&mut out.nodes, &mut out.edges);
    out
}

fn topic_text(t: &str) -> String {
    let t = t.split(":::").next().unwrap_or(t).trim();
    for (open, close) in [("((", "))"), ("))", "(("), ("{{", "}}"), ("[", "]"), ("(", ")"), (")", "(")] {
        if let Some(i) = t.find(open) {
            if t.ends_with(close) && i + open.len() <= t.len() - close.len() {
                return label_text(&t[i + open.len()..t.len() - close.len()]);
            }
        }
    }
    label_text(t)
}

// ---------- sequence diagram ----------

const ARROWS: [&str; 10] = ["<<-->>", "<<->>", "-->>", "->>", "--x", "--)", "-->", "-x", "-)", "->"];

enum Block {
    /// A fragment (its node), the lifelines its messages reach, and its parts' tops
    Fragment(usize, Option<(usize, usize)>, Vec<(f64, String)>),
    /// `box`, `rect`: grouping that is not drawn
    Other,
}

fn sequence(lines: &[String]) -> DiagramImport {
    let mut out = empty(None);
    out.diagram = Some(DiagramType::Sequence);
    const STEP: f64 = 50.0;
    const GAP: f64 = 220.0;
    let mut order: Vec<String> = vec![];
    let mut heads: HashMap<String, (String, bool)> = HashMap::new();
    let mut y = 80.0;
    let mut blocks: Vec<Block> = vec![];
    // Messages and notes, placed once all lifelines are known
    let mut messages: Vec<(String, String, f64, serde_json::Value)> = vec![];
    let mut notes: Vec<(String, Vec<String>, f64, String)> = vec![];

    let lifeline = |order: &mut Vec<String>, heads: &mut HashMap<String, (String, bool)>, id: &str| -> usize {
        if let Some(i) = order.iter().position(|o| o == id) {
            return i;
        }
        order.push(id.to_string());
        heads.entry(id.to_string()).or_insert((id.to_string(), false));
        order.len() - 1
    };
    let reach = |blocks: &mut Vec<Block>, a: usize, b: usize| {
        for bl in blocks.iter_mut() {
            if let Block::Fragment(_, r, _) = bl {
                let (lo, hi) = (a.min(b), a.max(b));
                *r = Some(r.map_or((lo, hi), |(x, z)| (x.min(lo), z.max(hi))));
            }
        }
    };

    for line in lines {
        let st = line.trim();
        let first = st.split_whitespace().next().unwrap_or("").to_lowercase();
        let rest = st[first.len().min(st.len())..].trim();
        match first.as_str() {
            "participant" | "actor" => {
                let (id, name) = match rest.split_once(" as ") {
                    Some((id, name)) => (id.trim().to_string(), label_text(name)),
                    None => (rest.to_string(), label_text(rest)),
                };
                let id = id.split("@{").next().unwrap_or(&id).trim().to_string();
                lifeline(&mut order, &mut heads, &id);
                heads.insert(id, (name, first == "actor"));
                continue;
            }
            "create" => {
                let r = rest.trim_start_matches("participant").trim_start_matches("actor").trim();
                let id = r.split(" as ").next().unwrap_or(r).trim().to_string();
                lifeline(&mut order, &mut heads, &id);
                skip(&mut out.skipped, "Lifelines made later (create) start at the top");
                continue;
            }
            "autonumber" | "activate" | "deactivate" | "title" | "link" | "links" | "properties" | "details" | "accTitle" | "accDescr" => {
                if first == "destroy" {
                    skip(&mut out.skipped, "destroy is not imported");
                }
                continue;
            }
            "destroy" => {
                skip(&mut out.skipped, "Ends of lifelines (destroy) are not imported");
                continue;
            }
            "note" => {
                // `Note right of A: text`, `Note over A,B: text`
                let Some((place, text)) = rest.split_once(':') else { continue };
                let words: Vec<&str> = place.split_whitespace().collect();
                let (side, who) = match words.as_slice() {
                    [s, "of", w @ ..] => (s.to_lowercase(), w.join(" ")),
                    [s, w @ ..] => (s.to_lowercase(), w.join(" ")),
                    _ => continue,
                };
                let who: Vec<String> = who.split(',').map(|w| w.trim().to_string()).filter(|w| !w.is_empty()).collect();
                for w in &who {
                    lifeline(&mut order, &mut heads, w);
                }
                notes.push((side, who, y - 15.0, label_text(text)));
                y += STEP + 20.0;
                continue;
            }
            "loop" | "alt" | "opt" | "par" | "critical" | "break" => {
                let n = node(NodeKind::Fragment, 0.0, y - 20.0, 480.0, 100.0, &first);
                blocks.push(Block::Fragment(out.nodes.len(), None, vec![(y - 20.0, label_text(rest))]));
                out.nodes.push(n);
                y += 20.0;
                continue;
            }
            "else" | "and" | "option" => {
                if let Some(Block::Fragment(_, _, parts)) = blocks.last_mut() {
                    parts.push((y - 20.0, label_text(rest)));
                    y += 20.0;
                }
                continue;
            }
            "rect" | "box" => {
                blocks.push(Block::Other);
                skip(&mut out.skipped, "Colored areas and boxes (rect, box) are not imported");
                continue;
            }
            "end" => {
                if let Some(Block::Fragment(i, reach_of, parts)) = blocks.pop() {
                    let bottom = y - 20.0;
                    let n = &mut out.nodes[i];
                    n.h = (bottom - n.y).max(60.0);
                    // Which lifelines it spans: those its messages reach (all when none)
                    n.lanes = Some(fragment_parts(&parts, n.y, n.h));
                    if let Some((lo, hi)) = reach_of {
                        n.x = lo as f64 * GAP + 70.0 - 110.0;
                        n.w = (hi - lo) as f64 * GAP + 220.0;
                    } else {
                        n.w = -1.0;
                    }
                    y += 10.0;
                }
                continue;
            }
            _ => {}
        }
        // A message: `A->>+B: text`
        let found = (0..st.len()).filter(|&i| st.is_char_boundary(i)).find_map(|i| ARROWS.iter().find(|a| st[i..].starts_with(**a)).map(|a| (i, *a)));
        let Some((at, arrow)) = found.filter(|(i, _)| *i > 0) else {
            skip(&mut out.skipped, &format!("Not understood: {}", st.chars().take(60).collect::<String>()));
            continue;
        };
        let from = st[..at].trim().to_string();
        let mut after = st[at + arrow.len()..].trim_start();
        if after.starts_with('+') || after.starts_with('-') {
            after = &after[1..];
        }
        let (to, text) = match after.split_once(':') {
            Some((to, text)) => (to.trim().to_string(), label_text(text)),
            None => (after.trim().to_string(), String::new()),
        };
        let (a, b) = (lifeline(&mut order, &mut heads, &from), lifeline(&mut order, &mut heads, &to));
        reach(&mut blocks, a, b);
        let dashed = arrow.contains("--");
        let end = if arrow.ends_with(">>") {
            "arrow"
        } else if arrow.ends_with(')') {
            "open"
        } else if arrow.ends_with('x') {
            "arrow"
        } else {
            "none"
        };
        let start = arrow.starts_with("<<").then_some("arrow");
        let extra = json!({
            "pattern": if dashed { Some("dashed") } else { None },
            "endCap": end,
            "startCap": start,
            "label": (!text.is_empty()).then_some(text),
        });
        messages.push((from, to, y, extra));
        y += STEP;
    }
    if !blocks.is_empty() {
        skip(&mut out.skipped, "A block was not closed with end");
    }

    // The lifelines, left to right, tall enough for every message
    let height = y + 20.0;
    let mut node_of: HashMap<String, String> = HashMap::new();
    let mut lifelines = vec![];
    for (i, id) in order.iter().enumerate() {
        let (name, person) = heads.get(id).cloned().unwrap_or((id.clone(), false));
        let mut n = node(NodeKind::Lifeline, i as f64 * GAP, 0.0, 140.0, height, &name);
        n.person = person.then_some(true);
        node_of.insert(id.clone(), n.id.clone());
        lifelines.push(n);
    }
    let all_w = (order.len().max(1) - 1) as f64 * GAP + 220.0;
    for n in &mut out.nodes {
        if n.w < 0.0 {
            n.x = -40.0;
            n.w = all_w;
        }
    }
    for (from, to, y, extra) in messages {
        let mut extra = extra;
        extra["messageY"] = json!(y);
        out.edges.push(edge(&node_of[&from], &node_of[&to], extra));
    }
    for (side, who, y, text) in notes {
        let idx: Vec<usize> = who.iter().filter_map(|w| order.iter().position(|o| o == w)).collect();
        let Some(&first) = idx.iter().min() else { continue };
        let last = *idx.iter().max().unwrap();
        let center = |i: usize| i as f64 * GAP + 70.0;
        let (x, w) = match side.as_str() {
            "right" => (center(first) + 20.0, 160.0),
            "left" => (center(first) - 180.0, 160.0),
            _ if last > first => (center(first) - 60.0, center(last) - center(first) + 120.0),
            _ => (center(first) - 80.0, 160.0),
        };
        let mut n = node(NodeKind::Note, x, y, w, 60.0, &text);
        n.h = round20(text.lines().count() as f64 * 19.0 + 30.0).max(60.0);
        out.nodes.push(n);
    }
    let mut nodes = lifelines;
    nodes.extend(std::mem::take(&mut out.nodes));
    out.nodes = nodes;
    super::to_origin(&mut out.nodes, &mut out.edges);
    out
}

/// A fragment's parts (as `Node.lanes`): each with its condition and height.
fn fragment_parts(parts: &[(f64, String)], top: f64, h: f64) -> Vec<Lane> {
    let mut lanes = vec![];
    for (i, (y, cond)) in parts.iter().enumerate() {
        let next = parts.get(i + 1).map_or(top + h, |p| p.0);
        lanes.push(Lane { id: uid(), title: cond.clone(), size: (next - y).max(30.0) });
    }
    // One part without a condition: nothing to show
    if lanes.len() == 1 && lanes[0].title.is_empty() {
        lanes.clear();
    }
    lanes
}

// ---------- class diagram ----------

/// `List~int~` → `List<int>`, with the types as UML names (`String` → `string`).
fn uml_type(t: &str) -> String {
    let t = t.trim();
    // `~` opens (before a name) and closes (`List~List~int~~` is `List<List<int>>`)
    let chars: Vec<char> = t.chars().collect();
    let mut src = String::new();
    for (i, &ch) in chars.iter().enumerate() {
        if ch == '~' {
            let opens = chars.get(i + 1).is_some_and(|n| n.is_alphanumeric() || *n == '_');
            src.push(if opens { '<' } else { '>' });
        } else {
            src.push(ch);
        }
    }
    let src = match src.strip_suffix("[]") {
        Some(inner) => format!("List<{inner}>"),
        None => src,
    };
    let mut s = String::new();
    let mut word = String::new();
    let flush = |word: &mut String, s: &mut String| {
        if !word.is_empty() {
            let w = match word.as_str() {
                "ArrayList" | "LinkedList" | "Vec" | "IList" | "IEnumerable" | "Collection" | "Iterable" | "list" | "Array" => "List".to_string(),
                "HashSet" | "TreeSet" | "set" | "ISet" => "Set".to_string(),
                "HashMap" | "TreeMap" | "Dictionary" | "dict" | "IDictionary" => "Map".to_string(),
                "List" | "Set" | "Map" => word.clone(),
                w => named(w),
            };
            s.push_str(&w);
            word.clear();
        }
    };
    for c in src.chars() {
        if c.is_alphanumeric() || c == '_' || c == '.' {
            word.push(c);
        } else {
            flush(&mut word, &mut s);
            s.push(c);
            if c == ',' {
                s.push(' ');
            }
        }
    }
    flush(&mut word, &mut s);
    s.split_whitespace().collect::<Vec<_>>().join(" ").replace("< ", "<").replace(" >", ">").replace(" ,", ",")
}

fn vis_of(c: char) -> Option<Vis> {
    match c {
        '+' => Some(Vis::Public),
        '-' => Some(Vis::Private),
        '#' => Some(Vis::Protected),
        '~' => Some(Vis::Package),
        _ => None,
    }
}

/// A member line: an attribute (`+String name`, `name: String`) or an operation
/// (`+pay(amount: double) bool`, `+find(int id)$ Order`).
fn member(c: &mut Class, line: &str) {
    let mut s = line.trim().to_string();
    if s.is_empty() {
        return;
    }
    if s.starts_with("<<") {
        c.kind = stereotype(&s).unwrap_or(c.kind);
        return;
    }
    if c.kind == Kind::Enum {
        let v = s.trim_end_matches(',').trim().to_string();
        let (name, value) = match v.split_once('=') {
            Some((n, x)) => (n.trim().to_string(), Some(x.trim().to_string())),
            None => (v, None),
        };
        c.values.push(name);
        c.enum_values.push(value);
        return;
    }
    let vis = s.chars().next().and_then(vis_of).unwrap_or(Vis::Unset);
    if vis != Vis::Unset {
        s.remove(0);
    }
    if let (Some(open), Some(close)) = (s.find('('), s.rfind(')')) {
        let name = s[..open].trim().to_string();
        let params: Vec<(String, String)> = s[open + 1..close]
            .split(',')
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .map(|p| match p.split_once(':') {
                Some((n, t)) => (n.trim().to_string(), uml_type(t)),
                None => match p.rsplit_once(' ') {
                    Some((t, n)) => (n.trim().to_string(), uml_type(t)),
                    None => (p.to_string(), String::new()),
                },
            })
            .collect();
        let mut after = s[close + 1..].trim().to_string();
        let (mut is_static, mut is_abstract) = (false, false);
        loop {
            if let Some(r) = after.strip_prefix('$') {
                is_static = true;
                after = r.trim().to_string();
            } else if let Some(r) = after.strip_prefix('*') {
                is_abstract = true;
                after = r.trim().to_string();
            } else {
                break;
            }
        }
        let after = after.trim_start_matches(':').trim();
        let ret = (!after.is_empty()).then(|| uml_type(after)).filter(|r| r != "void");
        c.methods.push(Method { vis, name, params, ret, is_static, is_abstract, body: Body::Todo });
        return;
    }
    let is_static = s.ends_with('$');
    let s = s.trim_end_matches(['$', '*']).trim();
    let (name, ty) = match s.split_once(':') {
        Some((n, t)) => (n.trim().to_string(), uml_type(t)),
        None => match s.rsplit_once(' ') {
            Some((t, n)) => (n.trim().to_string(), uml_type(t)),
            None => (s.to_string(), "string".to_string()),
        },
    };
    c.fields.push(Field { vis, name, ty, default: None, is_static, read_only: false });
}

fn stereotype(s: &str) -> Option<Kind> {
    let t = s.trim().trim_start_matches("<<").split(">>").next().unwrap_or("").trim().to_lowercase();
    match t.as_str() {
        "interface" => Some(Kind::Interface),
        "abstract" => Some(Kind::Abstract),
        "enumeration" | "enum" => Some(Kind::Enum),
        "record" | "datatype" | "struct" => Some(Kind::Record),
        _ => None,
    }
}

fn new_class(name: &str) -> Class {
    Class {
        name: name.to_string(),
        kind: Kind::Class,
        fields: vec![],
        methods: vec![],
        values: vec![],
        enum_values: vec![],
        type_params: vec![],
        extends: None,
        implements: vec![],
        package: None,
        unreadable: vec![],
    }
}

/// `Repository~T~` → ("Repository", ["T"])
fn class_name(s: &str) -> (String, Vec<String>) {
    let s = s.trim().trim_matches('`');
    let s = s.split("[\"").next().unwrap_or(s).split(":::").next().unwrap_or(s).trim();
    match s.split_once('~') {
        Some((n, rest)) => (n.trim().to_string(), rest.trim_end_matches('~').split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect()),
        None => (s.to_string(), vec![]),
    }
}

const RELATIONS: [&str; 16] = ["<|--", "--|>", "<|..", "..|>", "*--", "--*", "o--", "--o", "<--", "-->", "<..", "..>", "--", "..", "<-->", "<..>"];

fn class_diagram(lines: &[String]) -> DiagramImport {
    let mut out = empty(None);
    out.diagram = Some(DiagramType::Class);
    let mut classes: Vec<Class> = vec![];
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut relations: Vec<(String, String, serde_json::Value)> = vec![];
    let mut open: Option<usize> = None;
    let mut namespaces = 0;

    fn class_at(classes: &mut Vec<Class>, index: &mut HashMap<String, usize>, name: &str) -> usize {
        let (n, params) = class_name(name);
        let i = *index.entry(n.clone()).or_insert_with(|| {
            classes.push(new_class(&n));
            classes.len() - 1
        });
        if !params.is_empty() {
            classes[i].type_params = params;
        }
        i
    }

    for line in lines {
        let st = line.trim();
        if let Some(i) = open {
            if st == "}" {
                open = None;
            } else {
                member(&mut classes[i], st);
            }
            continue;
        }
        let first = st.split_whitespace().next().unwrap_or("");
        match first {
            "direction" | "click" | "link" | "callback" | "style" | "classDef" | "cssClass" | "accTitle" | "accDescr" | "title" => {
                if ["style", "classDef", "cssClass"].contains(&first) {
                    skip(&mut out.skipped, "Styles (classDef, style) are not imported");
                }
                continue;
            }
            "note" => {
                skip(&mut out.skipped, "Notes are not imported");
                continue;
            }
            "namespace" => {
                namespaces += 1;
                skip(&mut out.skipped, "Namespaces are not drawn as packages yet");
                continue;
            }
            "}" if namespaces > 0 => {
                namespaces -= 1;
                continue;
            }
            "class" => {
                let rest = st["class".len()..].trim();
                let opens = rest.ends_with('{');
                let rest = rest.trim_end_matches('{').trim();
                let i = class_at(&mut classes, &mut index, rest);
                if opens {
                    open = Some(i);
                }
                continue;
            }
            _ => {}
        }
        // `<<interface>> Shape`
        if st.starts_with("<<") {
            if let (Some(kind), Some(name)) = (stereotype(st), st.split(">>").nth(1)) {
                let i = class_at(&mut classes, &mut index, name.trim());
                classes[i].kind = kind;
            }
            continue;
        }
        // A relation: `A "1" *-- "many" B : label`
        let (body, text) = match st.split_once(" : ").or_else(|| st.split_once(':').filter(|(a, _)| RELATIONS.iter().any(|r| a.contains(r)))) {
            Some((b, t)) => (b.trim(), Some(label_text(t)).filter(|t| !t.is_empty())),
            None => (st, None),
        };
        let rel = RELATIONS.iter().filter_map(|r| body.find(r).map(|i| (i, *r))).min_by_key(|(i, r)| (*i, std::cmp::Reverse(r.len())));
        if let Some((at, rel)) = rel {
            let (left, right) = (body[..at].trim(), body[at + rel.len()..].trim());
            let split_card = |s: &str, card_first: bool| -> (String, Option<String>) {
                let s = s.trim();
                if let (Some(a), Some(b)) = (s.find('"'), s.rfind('"')) {
                    if a < b {
                        let card = s[a + 1..b].to_string();
                        let name = if card_first { s[b + 1..].trim() } else { s[..a].trim() };
                        return (name.to_string(), Some(card));
                    }
                }
                (s.to_string(), None)
            };
            let (a, ca) = split_card(left, false);
            let (b, cb) = split_card(right, true);
            if a.is_empty() || b.is_empty() {
                skip(&mut out.skipped, &format!("Not understood: {}", st.chars().take(60).collect::<String>()));
                continue;
            }
            class_at(&mut classes, &mut index, &a);
            class_at(&mut classes, &mut index, &b);
            let (a, b) = (class_name(&a).0, class_name(&b).0);
            let dashed = rel.contains("..");
            let pattern = dashed.then_some("dashed");
            // (from, to, start cap, end cap, from's label, to's label)
            let (from, to, sc, ec, fl, tl) = match rel {
                "<|--" | "<|.." => (b, a, None, "triangle", cb, ca),
                "--|>" | "..|>" => (a, b, None, "triangle", ca, cb),
                "*--" => (a, b, Some("diamond"), "none", ca, cb),
                "--*" => (b, a, Some("diamond"), "none", cb, ca),
                "o--" => (a, b, Some("hollowDiamond"), "none", ca, cb),
                "--o" => (b, a, Some("hollowDiamond"), "none", cb, ca),
                "-->" | "..>" => (a, b, None, "open", ca, cb),
                "<--" | "<.." => (b, a, None, "open", cb, ca),
                "<-->" | "<..>" => (a, b, Some("open"), "open", ca, cb),
                _ => (a, b, None, "none", ca, cb),
            };
            relations.push((
                from,
                to,
                json!({ "style": "elbow", "pattern": pattern, "startCap": sc, "endCap": ec, "startLabel": fl, "endLabel": tl, "label": text }),
            ));
            continue;
        }
        // `Animal : +int age`
        if let Some((name, m)) = st.split_once(':') {
            let i = class_at(&mut classes, &mut index, name.trim());
            member(&mut classes[i], m);
            continue;
        }
        if !st.contains(' ') && !st.is_empty() {
            class_at(&mut classes, &mut index, st);
            continue;
        }
        skip(&mut out.skipped, &format!("Not understood: {}", st.chars().take(60).collect::<String>()));
    }

    // Supertypes from the lines, for the layout (supertypes on top)
    for (from, to, extra) in &relations {
        if extra["endCap"] == "triangle" {
            let (Some(&f), Some(&t)) = (index.get(from), index.get(to)) else { continue };
            let interface = classes[t].kind == Kind::Interface && classes[f].kind != Kind::Interface;
            if interface || extra["pattern"] == "dashed" {
                classes[f].implements.push(to.clone());
            } else {
                classes[f].extends = Some(to.clone());
            }
        }
    }
    let ids: HashMap<&str, String> = classes.iter().map(|c| (c.name.as_str(), uid())).collect();
    // In rows, supertypes on top, each with its text in the board's notation
    let mut nodes = layout(&classes, &ids);
    let names: BTreeSet<&str> = classes.iter().map(|c| c.name.as_str()).collect();
    let mut edges: Vec<Edge> = vec![];
    for (from, to, extra) in relations {
        if names.contains(from.as_str()) && names.contains(to.as_str()) {
            edges.push(edge(&ids[from.as_str()], &ids[to.as_str()], extra));
        }
    }
    out.nodes = std::mem::take(&mut nodes);
    out.edges = edges;
    out
}

// ---------- ER diagram ----------

/// `||`, `|o`, `}o`, `}|` (left) and `||`, `o|`, `o{`, `|{` (right)
fn cardinality(mark: &str) -> Option<Cardinality> {
    match mark {
        "||" => Some(Cardinality::One),
        "|o" | "o|" => Some(Cardinality::ZeroOrOne),
        "}o" | "o{" => Some(Cardinality::Many),
        "}|" | "|{" => Some(Cardinality::OneOrMany),
        _ => None,
    }
}

fn er_type(t: &str) -> (DataType, Option<u32>, Option<u32>, bool) {
    if let Some(m) = sql_import::map_type(t) {
        return m;
    }
    match t.to_lowercase().as_str() {
        "string" | "str" => (DataType::Varchar, Some(255), None, false),
        "number" | "integer" => (DataType::Int, None, None, false),
        "bool" | "boolean" => (DataType::Boolean, None, None, false),
        "datetime" => (DataType::DateTime, None, None, false),
        "float" | "double" => (DataType::Float, None, None, false),
        _ => (DataType::Text, None, None, false),
    }
}

fn er_diagram(lines: &[String]) -> DiagramImport {
    let mut out = empty(None);
    let mut entities: Vec<Entity> = vec![];
    let mut fk_cols: HashMap<String, Vec<String>> = HashMap::new();
    let mut relations: Vec<Relation> = vec![];
    let mut open: Option<usize> = None;

    fn entity_at(entities: &mut Vec<Entity>, name: &str) -> usize {
        let name = name.trim().split('[').next().unwrap_or(name).trim().trim_matches('"').to_string();
        if let Some(i) = entities.iter().position(|e| e.name == name) {
            return i;
        }
        entities.push(Entity { id: uid(), name, x: 0.0, y: 0.0, attributes: vec![], color: None, tint: None, comment: None, indexes: vec![] });
        entities.len() - 1
    }

    for line in lines {
        let st = line.trim();
        if let Some(i) = open {
            if st == "}" {
                open = None;
                continue;
            }
            // `string name PK, FK "comment"`
            let (decl, comment) = match st.find('"') {
                Some(q) => (st[..q].trim(), Some(st[q..].trim().trim_matches('"').to_string())),
                None => (st, None),
            };
            let mut words = decl.split_whitespace();
            let (Some(ty), Some(name)) = (words.next(), words.next()) else { continue };
            let keys: Vec<String> = words.collect::<Vec<_>>().join(" ").split(',').map(|k| k.trim().to_uppercase()).filter(|k| !k.is_empty()).collect();
            let (data_type, mut length, mut scale, auto) = er_type(ty);
            let pk = keys.iter().any(|k| k == "PK");
            let mut nullable = !pk;
            let mut default_value = None;
            // What Flow's own export writes in the comment
            for note in comment.as_deref().unwrap_or("").split(',').map(str::trim) {
                if note.eq_ignore_ascii_case("not null") {
                    nullable = false;
                } else if let Some(d) = note.strip_prefix("default ") {
                    default_value = Some(d.trim().to_string());
                } else if data_type == DataType::Decimal {
                    if let Ok(n) = note.parse::<u32>() {
                        if length.is_none() {
                            length = Some(n);
                        }
                    }
                }
            }
            if data_type == DataType::Decimal {
                if let Some((p, s)) = comment.as_deref().and_then(|c| c.split(", ").find(|x| x.contains(',') || x.chars().all(|c| c.is_ascii_digit() || c == ','))).and_then(|x| x.split_once(',')) {
                    length = p.trim().parse().ok().or(length);
                    scale = s.trim().parse().ok().or(scale);
                }
            }
            let a = Attribute {
                id: uid(),
                name: name.to_string(),
                data_type,
                length,
                scale,
                primary_key: pk,
                nullable,
                unique: keys.iter().any(|k| k == "UK"),
                auto_increment: auto,
                default_value,
            };
            if keys.iter().any(|k| k == "FK") {
                fk_cols.entry(entities[i].id.clone()).or_default().push(a.id.clone());
            }
            entities[i].attributes.push(a);
            continue;
        }
        let first = st.split_whitespace().next().unwrap_or("");
        if ["direction", "style", "classDef", "class", "title", "accTitle", "accDescr"].contains(&first) {
            continue;
        }
        if st.ends_with('{') {
            open = Some(entity_at(&mut entities, st.trim_end_matches('{')));
            continue;
        }
        // `CUSTOMER ||--o{ ORDER : places`
        let (body, text) = match st.split_once(':') {
            Some((b, t)) => (b.trim(), Some(t.trim().trim_matches('"').to_string()).filter(|t| !t.is_empty())),
            None => (st, None),
        };
        let link = body.find("--").or_else(|| body.find(".."));
        if let Some(at) = link.filter(|&at| at >= 2 && at + 4 <= body.len()) {
            let (l, r) = (&body[at - 2..at], &body[at + 2..at + 4]);
            let (a, b) = (body[..at - 2].trim(), body[at + 4..].trim());
            let (Some(lc), Some(rc)) = (cardinality(l), cardinality(r)) else {
                skip(&mut out.skipped, &format!("Not understood: {}", st.chars().take(60).collect::<String>()));
                continue;
            };
            let (ia, ib) = (entity_at(&mut entities, a), entity_at(&mut entities, b));
            // The table with the foreign key is `from`: the many side of a one-to-many
            let (from, to, fc, tc) = if !lc.is_many() && rc.is_many() { (ib, ia, rc, lc) } else { (ia, ib, lc, rc) };
            relations.push(Relation {
                id: uid(),
                from: entities[from].id.clone(),
                to: entities[to].id.clone(),
                from_cardinality: fc,
                to_cardinality: tc,
                label: text,
                columns: vec![],
                on_delete: RefAction::NoAction,
                on_update: RefAction::NoAction,
            });
            continue;
        }
        if !st.is_empty() && !st.contains(' ') {
            entity_at(&mut entities, st);
            continue;
        }
        skip(&mut out.skipped, &format!("Not understood: {}", st.chars().take(60).collect::<String>()));
    }

    // Join columns: a foreign key column named after the table it refers to
    // (`customer_id` → CUSTOMER), else the only one left, onto that table's key
    for r in relations.iter_mut().filter(|r| !(r.from_cardinality.is_many() && r.to_cardinality.is_many())) {
        let Some(to) = entities.iter().find(|e| e.id == r.to) else { continue };
        let pks: Vec<&Attribute> = to.attributes.iter().filter(|a| a.primary_key).collect();
        let [pk] = pks.as_slice() else { continue };
        let Some(from) = entities.iter().find(|e| e.id == r.from) else { continue };
        let cols = fk_cols.get(&from.id).cloned().unwrap_or_default();
        let simple = |s: &str| s.to_lowercase().replace('_', "");
        let target = simple(&to.name);
        let by_name = cols.iter().find(|id| {
            from.attributes.iter().find(|a| &a.id == *id).is_some_and(|a| {
                let n = simple(&a.name);
                n == format!("{target}id") || n == format!("{}id", target.trim_end_matches('s')) || n == format!("{target}{}", simple(&pk.name))
            })
        });
        let pick = by_name.cloned().or_else(|| (cols.len() == 1).then(|| cols[0].clone()));
        if let Some(col) = pick {
            r.columns.push(ColumnPair { from: col.clone(), to: pk.id.clone() });
            fk_cols.get_mut(&from.id).map(|v| v.retain(|c| c != &col));
        }
    }
    sql_import::layout(&mut entities, &relations);
    if !entities.is_empty() {
        out.eer = Some(SqlImport { entities, relations, sections: vec![], skipped: vec![] });
    }
    out
}
