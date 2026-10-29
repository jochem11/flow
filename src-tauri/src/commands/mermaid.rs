//! Mermaid for every kind of diagram in a document: a flowchart, a class diagram
//! and a sequence diagram (one flowchart document can hold all three), or an ER
//! diagram for an EER document. Mermaid draws one diagram per block, so this
//! returns one block per diagram; the export writes them to one Markdown file.

use std::collections::{HashMap, HashSet};

use super::codegen::{self, Kind, Vis};
use super::flow::to_mermaid;
use super::flow_svg::analyze;
use crate::models::{
    Cardinality, CodeFile, DataType, DocContent, Document, EdgeCap, EerDoc, FlowDoc, LinePattern, NodeKind,
};

/// The Mermaid blocks for a document, to preview: one per diagram in it.
#[tauri::command]
#[specta::specta]
pub fn mermaid_preview(doc: Document) -> Vec<CodeFile> {
    blocks(&doc)
}

pub fn blocks(doc: &Document) -> Vec<CodeFile> {
    let block = |name: &str, content: String| CodeFile { name: name.into(), content };
    match &doc.content {
        DocContent::Flow(flow) => {
            let mut out = vec![];
            if flow.nodes.iter().any(|n| is_flowchart_node(n.kind)) {
                out.push(block("Flowchart", to_mermaid(flow)));
            }
            if flow.nodes.iter().any(|n| n.kind == NodeKind::Class) {
                out.push(block("Class diagram", class_diagram(flow)));
            }
            if flow.nodes.iter().any(|n| n.kind == NodeKind::Lifeline) {
                out.push(block("Sequence diagram", sequence_diagram(flow)));
            }
            out
        }
        DocContent::Eer(eer) if !eer.entities.is_empty() => vec![block("ER diagram", er_diagram(eer))],
        _ => vec![],
    }
}

/// Is this a step of a plain flowchart (and not part of a class or sequence diagram)?
pub fn is_flowchart_node(kind: NodeKind) -> bool {
    !matches!(
        kind,
        NodeKind::Class
            | NodeKind::Package
            | NodeKind::Lifeline
            | NodeKind::Activation
            | NodeKind::Fragment
            | NodeKind::Destroy
            | NodeKind::Note
            | NodeKind::Label
            | NodeKind::Comment
            | NodeKind::Section
            | NodeKind::Lanes
            | NodeKind::Boundary
    )
}

/// The Markdown file the export writes: each block under its own heading.
pub fn markdown(title: &str, blocks: &[CodeFile]) -> String {
    let mut s = format!("# {title}\n");
    for b in blocks {
        s.push_str(&format!("\n## {}\n\n```mermaid\n{}```\n", b.name, b.content));
    }
    s
}

/// A name Mermaid accepts as an identifier.
fn ident(s: &str) -> String {
    let id: String = s.chars().map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' }).collect();
    if id.is_empty() || id.starts_with(|c: char| c.is_ascii_digit()) { format!("_{id}") } else { id }
}

/// Text for a Mermaid label: no quotes or line breaks.
fn label(s: &str) -> String {
    s.replace('"', "'").replace('\n', " ")
}

// ---------- class diagram ----------

/// `List<OrderLine>` is written `List~OrderLine~` in Mermaid.
fn generic(t: &str) -> String {
    t.replace(['<', '>'], "~")
}

fn vis(v: Vis) -> &'static str {
    match v {
        Vis::Public => "+",
        Vis::Private => "-",
        Vis::Protected => "#",
        Vis::Package => "~",
        Vis::Unset => "",
    }
}

fn class_diagram(flow: &FlowDoc) -> String {
    let mut s = String::from("classDiagram\n");
    let classes: Vec<(&str, codegen::Class)> =
        flow.nodes.iter().filter(|n| n.kind == NodeKind::Class).map(|n| (n.id.as_str(), codegen::read_class(n))).collect();
    let names: HashMap<&str, String> = classes.iter().map(|(id, c)| (*id, ident(&c.name))).collect();

    for (_, c) in &classes {
        s.push_str(&format!("  class {} {{\n", ident(&c.name)));
        match c.kind {
            Kind::Interface => s.push_str("    <<interface>>\n"),
            Kind::Abstract => s.push_str("    <<abstract>>\n"),
            Kind::Enum => s.push_str("    <<enumeration>>\n"),
            Kind::Class => {}
        }
        for v in &c.values {
            s.push_str(&format!("    {v}\n"));
        }
        for f in &c.fields {
            let st = if f.is_static { "$" } else { "" };
            s.push_str(&format!("    {}{} {}{st}\n", vis(f.vis), generic(&f.ty), f.name));
        }
        for m in &c.methods {
            let params: Vec<String> = m.params.iter().map(|(n, t)| format!("{n}: {}", generic(t))).collect();
            let marker = if m.is_abstract { "*" } else if m.is_static { "$" } else { "" };
            let ret = m.ret.as_deref().map_or(String::new(), |r| format!(" {}", generic(r)));
            s.push_str(&format!("    {}{}({}){marker}{ret}\n", vis(m.vis), m.name, params.join(", ")));
        }
        for u in &c.unreadable {
            s.push_str(&format!("    %% {u}\n"));
        }
        s.push_str("  }\n");
    }

    for e in &flow.edges {
        let (Some(a), Some(b)) = (names.get(e.from.as_str()), names.get(e.to.as_str())) else { continue };
        let start = e.start_cap.unwrap_or(EdgeCap::None);
        let end = e.end_cap.unwrap_or(EdgeCap::Arrow);
        let dashed = e.pattern == Some(LinePattern::Dashed);
        let quoted = |l: &Option<String>| l.as_deref().filter(|l| !l.trim().is_empty()).map_or(String::new(), |l| format!("\"{}\" ", label(l)));
        let (sl, el) = (quoted(&e.start_label), quoted(&e.end_label));
        let text = e.label.as_deref().filter(|l| !l.trim().is_empty()).map_or(String::new(), |l| format!(" : {}", label(l)));
        let line = match (start, end) {
            (_, EdgeCap::Triangle) => format!("{b} {} {a}", if dashed { "<|.." } else { "<|--" }),
            (EdgeCap::Diamond, _) => format!("{a} {sl}*-- {el}{b}"),
            (EdgeCap::HollowDiamond, _) => format!("{a} {sl}o-- {el}{b}"),
            (_, EdgeCap::Diamond) => format!("{b} {el}*-- {sl}{a}"),
            (_, EdgeCap::HollowDiamond) => format!("{b} {el}o-- {sl}{a}"),
            (_, EdgeCap::Arrow | EdgeCap::Open) if dashed => format!("{a} ..> {b}"),
            (_, EdgeCap::Arrow | EdgeCap::Open) => format!("{a} {sl}--> {el}{b}"),
            _ if dashed => format!("{a} .. {b}"),
            _ => format!("{a} {sl}-- {el}{b}"),
        };
        s.push_str(&format!("  {}{text}\n", line.replace("  ", " ")));
    }
    s
}

// ---------- sequence diagram ----------

fn sequence_diagram(flow: &FlowDoc) -> String {
    let mut s = String::from("sequenceDiagram\n");
    let mut lifelines: Vec<_> = flow.nodes.iter().filter(|n| n.kind == NodeKind::Lifeline).collect();
    lifelines.sort_by(|a, b| a.x.total_cmp(&b.x));
    let ids: HashMap<&str, String> = lifelines.iter().enumerate().map(|(i, n)| (n.id.as_str(), format!("P{}", i + 1))).collect();
    for n in &lifelines {
        let name = n.text.lines().next().unwrap_or("").trim();
        let name = if name.is_empty() { "Lifeline" } else { name };
        s.push_str(&format!("  participant {} as {}\n", ids[n.id.as_str()], label(name)));
    }

    let by_id: HashMap<&str, _> = flow.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let (_, returns) = analyze(&flow.nodes, &flow.edges);
    let mut messages: Vec<_> = flow
        .edges
        .iter()
        .filter_map(|e| {
            let from = by_id.get(e.from.as_str())?;
            Some((from.y + e.message_y?, e))
        })
        .filter(|(_, e)| ids.contains_key(e.from.as_str()) && ids.contains_key(e.to.as_str()))
        .collect();
    messages.sort_by(|a, b| a.0.total_cmp(&b.0));

    // A call activates the lifeline it reaches (`+`); its return ends that (`-`)
    let mut active: HashMap<&str, usize> = HashMap::new();
    let called: HashSet<&str> = messages.iter().filter(|(_, e)| !returns.contains(&e.id) && e.from != e.to).map(|(_, e)| e.id.as_str()).collect();
    for (_, e) in &messages {
        let (a, b) = (&ids[e.from.as_str()], &ids[e.to.as_str()]);
        let is_return = returns.contains(&e.id);
        let arrow = if is_return || e.pattern == Some(LinePattern::Dashed) {
            "-->>"
        } else if e.end_cap == Some(EdgeCap::Open) {
            "-)"
        } else {
            "->>"
        };
        let mark = if is_return && active.get(e.from.as_str()).is_some_and(|n| *n > 0) {
            *active.get_mut(e.from.as_str()).unwrap() -= 1;
            "-"
        } else if called.contains(e.id.as_str()) && arrow != "-->>" {
            *active.entry(e.to.as_str()).or_default() += 1;
            "+"
        } else {
            ""
        };
        let text = e.label.as_deref().map_or(String::new(), label);
        s.push_str(&format!("  {a}{arrow}{mark}{b}: {text}\n"));
    }
    s
}

// ---------- ER diagram ----------

fn er_type(t: DataType, length: Option<u32>) -> String {
    let name = format!("{t:?}").to_lowercase();
    match (t, length) {
        (DataType::Varchar | DataType::Char, Some(n)) => format!("{name}({n})"),
        _ => name,
    }
}

/// Crow's foot for the left and the right end of a relationship.
fn left(c: Cardinality) -> &'static str {
    match c {
        Cardinality::One => "||",
        Cardinality::ZeroOrOne => "|o",
        Cardinality::Many => "}o",
        Cardinality::OneOrMany => "}|",
    }
}
fn right(c: Cardinality) -> &'static str {
    match c {
        Cardinality::One => "||",
        Cardinality::ZeroOrOne => "o|",
        Cardinality::Many => "o{",
        Cardinality::OneOrMany => "|{",
    }
}

fn er_diagram(eer: &EerDoc) -> String {
    let mut s = String::from("erDiagram\n");
    let names: HashMap<&str, String> = eer.entities.iter().map(|e| (e.id.as_str(), ident(&e.name))).collect();
    // Columns that are a foreign key
    let fks: HashSet<&str> = eer.relations.iter().flat_map(|r| r.columns.iter().map(|c| c.from.as_str())).collect();
    for e in &eer.entities {
        s.push_str(&format!("  {} {{\n", names[e.id.as_str()]));
        for a in &e.attributes {
            let mut keys = vec![];
            if a.primary_key {
                keys.push("PK");
            }
            if fks.contains(a.id.as_str()) {
                keys.push("FK");
            }
            if a.unique && !a.primary_key {
                keys.push("UK");
            }
            let mut notes = vec![];
            if !a.nullable && !a.primary_key {
                notes.push("not null".to_string());
            }
            if let Some(d) = a.default_value.as_deref().filter(|d| !d.trim().is_empty()) {
                notes.push(format!("default {}", label(d)));
            }
            if a.data_type == DataType::Decimal {
                notes.push(format!("{},{}", a.length.unwrap_or(10), a.scale.unwrap_or(2)));
            }
            let keys = if keys.is_empty() { String::new() } else { format!(" {}", keys.join(",")) };
            let notes = if notes.is_empty() { String::new() } else { format!(" \"{}\"", notes.join(", ")) };
            s.push_str(&format!("    {} {}{keys}{notes}\n", er_type(a.data_type, a.length), ident(&a.name)));
        }
        s.push_str("  }\n");
    }
    for r in &eer.relations {
        let (Some(a), Some(b)) = (names.get(r.from.as_str()), names.get(r.to.as_str())) else { continue };
        let text = r.label.as_deref().filter(|l| !l.trim().is_empty()).map_or("references".to_string(), label);
        s.push_str(&format!("  {a} {}--{} {b} : \"{text}\"\n", left(r.from_cardinality), right(r.to_cardinality)));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flow(json: &str) -> Document {
        serde_json::from_str(&format!(
            r#"{{ "id": "d", "projectId": "p", "folderId": null, "order": 1, "name": "Test",
                 "content": {{ "kind": "flow", "data": {json} }} }}"#
        ))
        .unwrap()
    }

    #[test]
    fn class_and_sequence_blocks() {
        let doc = flow(
            r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 },
              "nodes": [
                { "id": "o", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": "Order\n--\n- lines: List<OrderLine>\n--\n+ pay(amount: double): bool" },
                { "id": "l", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": "OrderLine" },
                { "id": "p", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": "«interface»\nPayable" },
                { "id": "a", "kind": "lifeline", "x": 0, "y": 0, "w": 140, "h": 400, "color": "white", "text": ":Client" },
                { "id": "b", "kind": "lifeline", "x": 300, "y": 0, "w": 140, "h": 400, "color": "white", "text": ":Server" }
              ],
              "edges": [
                { "id": "e1", "from": "o", "to": "l", "startCap": "diamond", "endCap": "none", "endLabel": "1..*" },
                { "id": "e2", "from": "o", "to": "p", "pattern": "dashed", "endCap": "triangle" },
                { "id": "m1", "from": "a", "to": "b", "messageY": 100, "label": "request()" },
                { "id": "m2", "from": "b", "to": "a", "messageY": 200, "label": "answer" }
              ] }"#,
        );
        let b = blocks(&doc);
        assert_eq!(b.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["Class diagram", "Sequence diagram"]);
        let class = &b[0].content;
        assert!(class.contains("    -List~OrderLine~ lines\n"));
        assert!(class.contains("    +pay(amount: double) bool\n"));
        assert!(class.contains("    <<interface>>\n"));
        assert!(class.contains("  Order *-- \"1..*\" OrderLine\n"));
        assert!(class.contains("  Payable <|.. Order\n"));
        let seq = &b[1].content;
        assert!(seq.contains("  participant P1 as :Client\n"));
        assert!(seq.contains("  P1->>+P2: request()\n"));
        assert!(seq.contains("  P2-->>-P1: answer\n"));
    }

    #[test]
    fn er_block() {
        let doc: Document = serde_json::from_str(
            r#"{ "id": "d", "projectId": "p", "folderId": null, "order": 1, "name": "Schema",
              "content": { "kind": "eer", "data": { "camera": { "x": 0, "y": 0, "zoom": 1 },
                "entities": [
                  { "id": "c", "name": "customer", "x": 0, "y": 0, "attributes": [
                    { "id": "c.id", "name": "id", "dataType": "int", "primaryKey": true, "nullable": false },
                    { "id": "c.e", "name": "email", "dataType": "varchar", "length": 120, "primaryKey": false, "nullable": false, "unique": true } ] },
                  { "id": "o", "name": "order", "x": 0, "y": 0, "attributes": [
                    { "id": "o.id", "name": "id", "dataType": "int", "primaryKey": true, "nullable": false },
                    { "id": "o.c", "name": "customer_id", "dataType": "int", "primaryKey": false, "nullable": false },
                    { "id": "o.t", "name": "total", "dataType": "decimal", "primaryKey": false, "nullable": true, "defaultValue": "0" } ] } ],
                "relations": [{ "id": "r", "from": "o", "to": "c", "fromCardinality": "many", "toCardinality": "one",
                  "columns": [{ "from": "o.c", "to": "c.id" }] }] } } }"#,
        )
        .unwrap();
        let er = &blocks(&doc)[0].content;
        assert!(er.contains("    int id PK\n"));
        assert!(er.contains("    varchar(120) email UK \"not null\"\n"));
        assert!(er.contains("    int customer_id FK \"not null\"\n"));
        assert!(er.contains("    decimal total \"default 0, 10,2\"\n"));
        assert!(er.contains("  order }o--|| customer : \"references\"\n"));
    }

    /// Writes the Mermaid of a saved document to `OUT`, as JSON (to check it with the real parser):
    /// `FLOW_DOC=doc.json OUT=blocks.json cargo test mermaid_from_file -- --ignored`
    #[test]
    #[ignore]
    fn mermaid_from_file() {
        let doc: Document = serde_json::from_str(&std::fs::read_to_string(std::env::var("FLOW_DOC").unwrap()).unwrap()).unwrap();
        let out: Vec<_> = blocks(&doc).into_iter().map(|b| serde_json::json!({ "name": b.name, "content": b.content })).collect();
        std::fs::write(std::env::var("OUT").unwrap(), serde_json::to_string_pretty(&out).unwrap()).unwrap();
    }
}
