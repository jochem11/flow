use std::io::Write;

use base64::Engine;

use super::import_diagram;
use crate::models::{Cardinality, DiagramType, DocContent, Document, EdgeCap, FlowDoc, ImportFormat, LinePattern, NodeColor, NodeKind};

fn texts(imp: &crate::models::DiagramImport, kind: NodeKind) -> Vec<String> {
    let mut t: Vec<String> = imp.nodes.iter().filter(|n| n.kind == kind).map(|n| n.text.clone()).collect();
    t.sort();
    t
}

fn text_of<'a>(imp: &'a crate::models::DiagramImport, id: &str) -> &'a str {
    imp.nodes.iter().find(|n| n.id == id).map_or("", |n| n.text.as_str())
}

#[test]
fn mermaid_flowchart() {
    let imp = import_diagram(
        "%% a comment\nflowchart TD\n  A([Start]) --> B{Paid?}\n  B -->|yes| C[Ship it]\n  B -- no --> D(\"Ask again\")\n  C & D -.-> E(((  )))\n  subgraph Warehouse\n    C\n  end\n  classDef red fill:#f00\n",
    );
    assert_eq!(imp.format, Some(ImportFormat::Mermaid));
    assert_eq!(imp.diagram, Some(DiagramType::Flowchart));
    assert_eq!(texts(&imp, NodeKind::Pill), ["Start"]);
    assert_eq!(texts(&imp, NodeKind::Diamond), ["Paid?"]);
    assert_eq!(texts(&imp, NodeKind::Box), ["Ask again", "Ship it"]);
    assert_eq!(texts(&imp, NodeKind::End), [""]);
    assert_eq!(texts(&imp, NodeKind::Section), ["Warehouse"]);
    assert_eq!(imp.edges.len(), 5);
    let yes = imp.edges.iter().find(|e| e.label.as_deref() == Some("yes")).unwrap();
    assert_eq!(text_of(&imp, &yes.to), "Ship it");
    assert!(imp.edges.iter().any(|e| e.label.as_deref() == Some("no")));
    assert_eq!(imp.edges.iter().filter(|e| e.pattern == Some(LinePattern::Dashed)).count(), 2);
    // Laid out: no two blocks on the same spot, and "Ship it" in its section
    let ship = imp.nodes.iter().find(|n| n.text == "Ship it").unwrap();
    let section = imp.nodes.iter().find(|n| n.kind == NodeKind::Section).unwrap();
    assert_eq!(ship.parent.as_deref(), Some(section.id.as_str()));
    assert!(ship.x >= section.x && ship.x + ship.w <= section.x + section.w);
    let start = imp.nodes.iter().find(|n| n.text == "Start").unwrap();
    let paid = imp.nodes.iter().find(|n| n.text == "Paid?").unwrap();
    assert!(paid.y > start.y);
    assert!(imp.skipped.iter().any(|s| s.contains("classDef")));
}

#[test]
fn mermaid_sequence_with_fragments() {
    let imp = import_diagram(
        "sequenceDiagram\n  actor C as Customer\n  participant S as Shop\n  C->>+S: Order\n  alt paid\n    S-->>-C: Confirmation\n  else\n    S--)C: Failed\n  end\n  Note right of S: done\n",
    );
    assert_eq!(imp.diagram, Some(DiagramType::Sequence));
    let lifelines: Vec<_> = imp.nodes.iter().filter(|n| n.kind == NodeKind::Lifeline).collect();
    assert_eq!(lifelines.iter().map(|n| n.text.as_str()).collect::<Vec<_>>(), ["Customer", "Shop"]);
    assert_eq!(lifelines[0].person, Some(true));
    assert!(lifelines[1].x > lifelines[0].x);
    let order = imp.edges.iter().find(|e| e.label.as_deref() == Some("Order")).unwrap();
    let conf = imp.edges.iter().find(|e| e.label.as_deref() == Some("Confirmation")).unwrap();
    let failed = imp.edges.iter().find(|e| e.label.as_deref() == Some("Failed")).unwrap();
    assert!(order.message_y.unwrap() < conf.message_y.unwrap() && conf.message_y.unwrap() < failed.message_y.unwrap());
    assert_eq!(conf.pattern, Some(LinePattern::Dashed));
    assert_eq!(failed.end_cap, Some(EdgeCap::Open));
    let alt = imp.nodes.iter().find(|n| n.kind == NodeKind::Fragment).unwrap();
    assert_eq!(alt.text, "alt");
    let parts = alt.lanes.as_ref().unwrap();
    assert_eq!(parts.iter().map(|p| p.title.as_str()).collect::<Vec<_>>(), ["paid", ""]);
    // Each message in its own part
    let top = lifelines[0].y;
    let split = alt.y + parts[0].size;
    assert!(top + conf.message_y.unwrap() > alt.y && top + conf.message_y.unwrap() < split);
    assert!(top + failed.message_y.unwrap() > split && top + failed.message_y.unwrap() < alt.y + alt.h);
    assert_eq!(texts(&imp, NodeKind::Note), ["done"]);
}

#[test]
fn mermaid_class_diagram() {
    let imp = import_diagram(
        "classDiagram\n  class Shape {\n    <<interface>>\n    +area() double\n  }\n  class Circle {\n    -double radius\n    +area() double\n  }\n  class Order {\n    +List~Line~ lines\n    +total()$ decimal\n  }\n  Shape <|.. Circle\n  Order \"1\" *-- \"many\" Line : has\n",
    );
    assert_eq!(imp.diagram, Some(DiagramType::Class));
    let shape = imp.nodes.iter().find(|n| n.text.contains("Shape")).unwrap();
    assert!(shape.text.starts_with("«interface»\nShape"), "{}", shape.text);
    assert!(shape.text.contains("+ area(): double"));
    let circle = imp.nodes.iter().find(|n| n.text.contains("Circle")).unwrap();
    assert!(circle.text.contains("- radius: double"), "{}", circle.text);
    let order = imp.nodes.iter().find(|n| n.text.contains("Order")).unwrap();
    assert!(order.text.contains("+ lines: List<Line>"), "{}", order.text);
    assert!(order.text.contains("+ {static} total(): decimal"), "{}", order.text);
    let real = imp.edges.iter().find(|e| e.end_cap == Some(EdgeCap::Triangle)).unwrap();
    assert_eq!((real.from.as_str(), real.to.as_str()), (circle.id.as_str(), shape.id.as_str()));
    assert_eq!(real.pattern, Some(LinePattern::Dashed));
    let comp = imp.edges.iter().find(|e| e.start_cap == Some(EdgeCap::Diamond)).unwrap();
    assert_eq!(comp.from, order.id);
    assert_eq!((comp.start_label.as_deref(), comp.end_label.as_deref(), comp.label.as_deref()), (Some("1"), Some("many"), Some("has")));
    // The interface above the class that implements it
    assert!(shape.y < circle.y);
}

#[test]
fn mermaid_state_diagram_and_mindmap() {
    let imp = import_diagram("stateDiagram-v2\n  [*] --> Draft\n  Draft --> Sent : send\n  state check <<choice>>\n  Sent --> check\n  check --> Paid\n  Paid --> [*]\n");
    assert_eq!(imp.diagram, Some(DiagramType::State));
    assert_eq!(texts(&imp, NodeKind::Pill), ["Draft", "Paid", "Sent"]);
    assert_eq!(imp.nodes.iter().filter(|n| n.kind == NodeKind::Start).count(), 1);
    assert_eq!(imp.nodes.iter().filter(|n| n.kind == NodeKind::End).count(), 1);
    assert_eq!(imp.nodes.iter().filter(|n| n.kind == NodeKind::Diamond).count(), 1);
    assert_eq!(imp.edges.len(), 5);

    let mm = import_diagram("mindmap\n  root((Launch))\n    Marketing\n      Posts\n    Product\n");
    assert_eq!(mm.diagram, Some(DiagramType::Mindmap));
    assert_eq!(texts(&mm, NodeKind::Topic), ["Launch", "Marketing", "Posts", "Product"]);
    let root = mm.nodes.iter().find(|n| n.text == "Launch").unwrap();
    assert_eq!(mm.edges.iter().filter(|e| e.from == root.id).count(), 2);
    let posts = mm.nodes.iter().find(|n| n.text == "Posts").unwrap();
    assert!(posts.x > root.x);
}

#[test]
fn mermaid_er_diagram() {
    let imp = import_diagram(
        "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  CUSTOMER {\n    int id PK\n    string email UK\n  }\n  ORDER {\n    int id PK\n    int customer_id FK\n    decimal total \"not null, 12,2\"\n  }\n",
    );
    let eer = imp.eer.expect("tables");
    assert!(imp.nodes.is_empty());
    let customer = eer.entities.iter().find(|e| e.name == "CUSTOMER").unwrap();
    let order = eer.entities.iter().find(|e| e.name == "ORDER").unwrap();
    assert!(customer.attributes[1].unique);
    let total = &order.attributes[2];
    assert!(!total.nullable);
    assert_eq!((total.length, total.scale), (Some(12), Some(2)));
    let r = &eer.relations[0];
    // ORDER holds the key: it is `from`, the many side
    assert_eq!((r.from.as_str(), r.to.as_str()), (order.id.as_str(), customer.id.as_str()));
    assert_eq!((r.from_cardinality, r.to_cardinality), (Cardinality::Many, Cardinality::One));
    assert_eq!(r.columns.len(), 1);
    assert_eq!(r.columns[0].from, order.attributes[1].id);
    assert_eq!(r.columns[0].to, order_pk(customer));
    assert_eq!(r.label.as_deref(), Some("places"));

    fn order_pk(e: &crate::models::Entity) -> String {
        e.attributes.iter().find(|a| a.primary_key).unwrap().id.clone()
    }
}

/// What Flow exports as Mermaid comes back as the same diagram.
#[test]
fn mermaid_round_trip() {
    let doc: Document = serde_json::from_str(
        r#"{ "id": "d", "projectId": "p", "folderId": null, "order": 1, "name": "T",
             "content": { "kind": "flow", "data": { "camera": { "x": 0, "y": 0, "zoom": 1 },
               "nodes": [
                 { "id": "a", "kind": "box", "x": 0, "y": 0, "w": 180, "h": 60, "color": "white", "text": "Order \"now\"" },
                 { "id": "b", "kind": "diamond", "x": 0, "y": 200, "w": 180, "h": 120, "color": "white", "text": "In stock?" },
                 { "id": "s", "kind": "start", "x": 0, "y": -100, "w": 40, "h": 40, "color": "white", "text": "" }
               ],
               "edges": [
                 { "id": "e1", "from": "s", "to": "a" },
                 { "id": "e2", "from": "a", "to": "b", "label": "check" }
               ] } } }"#,
    )
    .unwrap();
    let blocks = crate::mermaid::blocks(&doc);
    let md: String = blocks.iter().map(|b| format!("## {}\n\n```mermaid\n{}```\n\n", b.name, b.content)).collect();
    let imp = import_diagram(&md);
    assert_eq!(texts(&imp, NodeKind::Box), ["Order \"now\""]);
    assert_eq!(texts(&imp, NodeKind::Diamond), ["In stock?"]);
    assert_eq!(imp.nodes.iter().filter(|n| n.kind == NodeKind::Start).count(), 1);
    assert_eq!(imp.edges.iter().filter(|e| e.label.as_deref() == Some("check")).count(), 1);
    let _ = FlowDoc::default();
    let _ = DocContent::Flow(FlowDoc::default());
}

const DRAWIO_MODEL: &str = r##"<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="p" value="Pool" style="swimlane;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="400" height="300" as="geometry"/></mxCell>
<mxCell id="a" value="&lt;b&gt;Start&lt;/b&gt;&lt;br&gt;here" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;" vertex="1" parent="p"><mxGeometry x="20" y="40" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="b" value="OK?" style="rhombus;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="600" y="140" width="80" height="80" as="geometry"/></mxCell>
<mxCell id="e" value="" style="edgeStyle=orthogonalEdgeStyle;dashed=1;endArrow=block;endFill=0;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="l" value="go" style="edgeLabel;" vertex="1" connectable="0" parent="e"><mxGeometry x="-0.2" relative="1" as="geometry"/></mxCell>
<mxCell id="f" value="" style="endArrow=classic;" edge="1" parent="1" source="b"><mxGeometry relative="1" as="geometry"><mxPoint x="800" y="180" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel>"##;

#[test]
fn drawio_plain_and_compressed() {
    let check = |imp: crate::models::DiagramImport| {
        assert_eq!(imp.format, Some(ImportFormat::Drawio), "{:?}", imp.skipped);
        let pool = imp.nodes.iter().find(|n| n.kind == NodeKind::Section).unwrap();
        let a = imp.nodes.iter().find(|n| n.text == "Start\nhere").expect("html label as text");
        let b = imp.nodes.iter().find(|n| n.kind == NodeKind::Diamond).unwrap();
        assert_eq!(a.parent.as_deref(), Some(pool.id.as_str()));
        // In the pool's own coordinates in the file; moved to start at 0
        assert_eq!((pool.x, pool.y), (0.0, 0.0));
        assert_eq!((a.x, a.y), (20.0, 40.0));
        assert_eq!(b.x, 500.0);
        assert_eq!(a.color, NodeColor::Green);
        assert_eq!(pool.color, NodeColor::Blue);
        let e = imp.edges.iter().find(|e| e.from == a.id).unwrap();
        assert_eq!((e.end_cap, e.pattern, e.label.as_deref()), (Some(EdgeCap::Triangle), Some(LinePattern::Dashed), Some("go")));
        let free = imp.edges.iter().find(|e| e.from == b.id).unwrap();
        assert_eq!(free.to, "");
        assert_eq!(free.to_point.as_ref().map(|p| (p.x, p.y)), Some((700.0, 80.0)));
    };
    check(import_diagram(&format!("<mxfile><diagram name=\"Page-1\">{DRAWIO_MODEL}</diagram></mxfile>")));

    // As draw.io saves it compressed: deflate, then base64, of the URL-encoded XML
    let encoded: String = DRAWIO_MODEL
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    let mut z = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
    z.write_all(encoded.as_bytes()).unwrap();
    let data = base64::engine::general_purpose::STANDARD.encode(z.finish().unwrap());
    check(import_diagram(&format!("<mxfile><diagram name=\"Page-1\">{data}</diagram><diagram name=\"Page-2\"/></mxfile>")));

    // An SVG exported from draw.io, with the drawing in its `content`
    let file = format!("<mxfile><diagram name=\"Page-1\">{DRAWIO_MODEL}</diagram></mxfile>");
    let attr = file.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
    check(import_diagram(&format!("<svg xmlns=\"http://www.w3.org/2000/svg\" content=\"{attr}\"><g/></svg>")));
}

#[test]
fn excalidraw_drawing() {
    let imp = import_diagram(
        r##"{ "type": "excalidraw", "version": 2, "elements": [
          { "id": "r", "type": "rectangle", "x": 100, "y": 50, "width": 200, "height": 80, "backgroundColor": "#ffec99", "boundElements": [{ "id": "t", "type": "text" }] },
          { "id": "t", "type": "text", "x": 120, "y": 70, "width": 100, "height": 20, "text": "Idea", "originalText": "Idea", "containerId": "r" },
          { "id": "d", "type": "diamond", "x": 400, "y": 40, "width": 120, "height": 100, "backgroundColor": "transparent" },
          { "id": "a", "type": "arrow", "x": 300, "y": 90, "width": 100, "height": 0, "points": [[0, 0], [100, 0]], "strokeStyle": "dashed",
            "startBinding": { "elementId": "r" }, "endBinding": { "elementId": "d" }, "startArrowhead": null, "endArrowhead": "arrow" },
          { "id": "l", "type": "line", "x": 100, "y": 300, "width": 50, "height": 0, "points": [[0, 0], [50, 0]] },
          { "id": "x", "type": "text", "x": 600, "y": 60, "width": 80, "height": 20, "text": "Note to self" },
          { "id": "f", "type": "freedraw", "x": 0, "y": 0, "width": 10, "height": 10, "points": [[0, 0]] },
          { "id": "gone", "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10, "isDeleted": true }
        ] }"##,
    );
    assert_eq!(imp.format, Some(ImportFormat::Excalidraw));
    let r = imp.nodes.iter().find(|n| n.kind == NodeKind::Box).unwrap();
    assert_eq!((r.text.as_str(), r.color, r.x, r.y), ("Idea", NodeColor::Yellow, 0.0, 10.0));
    let d = imp.nodes.iter().find(|n| n.kind == NodeKind::Diamond).unwrap();
    assert_eq!(d.color, NodeColor::White);
    assert_eq!(texts(&imp, NodeKind::Label), ["Note to self"]);
    let a = imp.edges.iter().find(|e| e.from == r.id).unwrap();
    assert_eq!((a.to.as_str(), a.pattern, a.end_cap, a.start_cap), (d.id.as_str(), Some(LinePattern::Dashed), Some(EdgeCap::Arrow), Some(EdgeCap::None)));
    let line = imp.edges.iter().find(|e| e.from.is_empty()).unwrap();
    assert_eq!(line.end_cap, Some(EdgeCap::None));
    assert_eq!(line.from_point.as_ref().map(|p| (p.x, p.y)), Some((0.0, 260.0)));
    assert!(imp.skipped.iter().any(|s| s.contains("Free-hand")));
    assert_eq!(imp.nodes.len(), 3);
}

#[test]
fn not_a_diagram() {
    let imp = import_diagram("Just some words");
    assert!(imp.format.is_none() || imp.nodes.is_empty());
    assert!(!imp.skipped.is_empty());
    let imp = import_diagram("{ \"a\": 1 }");
    assert!(imp.format.is_none());
    assert!(!imp.skipped.is_empty());
}

/// `FLOW_IMPORT=file cargo test -p flow-core import_from_file -- --ignored --nocapture`
#[test]
#[ignore]
fn import_from_file() {
    let imp = import_diagram(&std::fs::read_to_string(std::env::var("FLOW_IMPORT").unwrap()).unwrap());
    println!("{:?} {:?}", imp.format, imp.diagram);
    for n in &imp.nodes {
        println!("{:?} {:>6.0} {:>6.0} {:>4.0}x{:<4.0} {:?} parent={}", n.kind, n.x, n.y, n.w, n.h, n.text, n.parent.is_some());
    }
    let name = |id: &str| imp.nodes.iter().find(|n| n.id == id).map_or("·".to_string(), |n| n.text.lines().next().unwrap_or("").to_string());
    for e in &imp.edges {
        println!("  {} -> {} {:?} {:?} {:?} y={:?}", name(&e.from), name(&e.to), e.label, e.pattern, e.end_cap, e.message_y);
    }
    if let Some(eer) = &imp.eer {
        for e in &eer.entities {
            println!("table {} {:?}", e.name, e.attributes.iter().map(|a| a.name.as_str()).collect::<Vec<_>>());
        }
        println!("{} relations", eer.relations.len());
    }
    println!("skipped: {:?}", imp.skipped);
}
