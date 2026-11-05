//! Flowchart features: the files an export makes
//! (`export`: Mermaid, SVG, PNG, SQL, code). Drawing the SVG lives in flow_svg.rs,
//! Arrange (auto-layout) in arrange.rs.
//! Where the files go is up to the caller: the desktop app writes them to
//! Downloads, the server sends them to the browser.

use std::collections::HashMap;

use super::flow_svg::to_svg;
use super::{codegen, eer, mermaid};
use crate::models::{
    CodeLanguage, DocContent, Document, ExportFormat, FlowDoc, Node, NodeKind, SqlDialect,
};

// ===========================================================================
// Export
// ===========================================================================

/// A file an export makes.
pub struct ExportFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

/// The files for `doc` in `format`: one, or for Java one per class (to keep
/// together in a folder named after the document).
pub fn export(doc: &Document, format: ExportFormat) -> Result<Vec<ExportFile>, String> {
    let named = |ext: &str, bytes: Vec<u8>| {
        vec![ExportFile {
            name: format!("{}.{ext}", safe_file_name(&doc.name)),
            bytes,
        }]
    };
    let sql = |d: SqlDialect| -> Result<Vec<ExportFile>, String> {
        let DocContent::Eer(eer) = &doc.content else {
            return Err("SQL can only be made from an EER diagram".into());
        };
        Ok(named("sql", eer::to_sql(eer, d, &doc.name).into_bytes()))
    };
    let flow = || match &doc.content {
        DocContent::Flow(flow) => Ok(flow),
        _ => Err("only flowcharts can be exported as an image or code".to_string()),
    };

    let lang = match format {
        ExportFormat::TypeScript => Some(CodeLanguage::TypeScript),
        ExportFormat::Java => Some(CodeLanguage::Java),
        ExportFormat::CSharp => Some(CodeLanguage::CSharp),
        ExportFormat::Python => Some(CodeLanguage::Python),
        ExportFormat::Kotlin => Some(CodeLanguage::Kotlin),
        ExportFormat::Rust => Some(CodeLanguage::Rust),
        ExportFormat::Go => Some(CodeLanguage::Go),
        _ => None,
    };
    if let Some(lang) = lang {
        let files = codegen::generate(flow()?, lang, &doc.name);
        if files.is_empty() {
            return Err("there are no UML classes in this flowchart".into());
        }
        return Ok(files
            .into_iter()
            .map(|f| ExportFile {
                name: safe_file_name(&f.name),
                bytes: f.content.into_bytes(),
            })
            .collect());
    }

    Ok(match format {
        ExportFormat::Mermaid => {
            let blocks = mermaid::blocks(doc);
            match blocks.as_slice() {
                [] => return Err("there is nothing in this document Mermaid can draw".into()),
                [one] => named("mmd", one.content.clone().into_bytes()),
                _ => named("md", mermaid::markdown(&doc.name, &blocks).into_bytes()),
            }
        }
        ExportFormat::Svg => named("svg", to_svg(flow()?).into_bytes()),
        ExportFormat::Png => named("png", to_png(flow()?)?),
        ExportFormat::Postgres => sql(SqlDialect::Postgres)?,
        ExportFormat::Mysql => sql(SqlDialect::Mysql)?,
        ExportFormat::Sqlite => sql(SqlDialect::Sqlite)?,
        ExportFormat::SqlServer => sql(SqlDialect::SqlServer)?,
        ExportFormat::Oracle => sql(SqlDialect::Oracle)?,
        _ => unreachable!("code formats are handled above"),
    })
}

/// Replaces characters that are not allowed in file names.
pub fn safe_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "flowchart".into()
    } else {
        trimmed.into()
    }
}

// ---------------------------------------------------------------------------
// Mermaid
// ---------------------------------------------------------------------------

pub fn to_mermaid(flow: &FlowDoc) -> String {
    let mut out = String::from("flowchart TD\n");
    // Real id -> short Mermaid id (Mermaid does not like the `-` in UUIDs)
    let mut ids: HashMap<&str, String> = HashMap::new();

    // Top to bottom, left to right, so the file reads in a logical order.
    let mut nodes: Vec<&Node> = flow
        .nodes
        .iter()
        .filter(|n| mermaid::is_flowchart_node(n.kind))
        .collect();
    nodes.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)));

    for (i, node) in nodes.iter().enumerate() {
        let id = format!("n{i}");
        // Mermaid does not accept an empty label
        let text = if node.text.trim().is_empty() { " ".to_string() } else { mermaid_escape(&node.text) };
        let shape = match node.kind {
            NodeKind::Box => format!("[\"{text}\"]"),
            NodeKind::Diamond => format!("{{\"{text}\"}}"), // `{{` is a literal `{` in format!
            NodeKind::Pill => format!("([\"{text}\"])"),
            NodeKind::Start => "((\" \"))".to_string(),
            NodeKind::End | NodeKind::FlowFinal => "(((\" \")))".to_string(),
            NodeKind::Circle => format!("((\"{text}\"))"),
            NodeKind::UseCase => format!("([\"{text}\"])"),
            NodeKind::SendSignal => format!(">\"{text}\"]"),
            NodeKind::Note
            | NodeKind::Label
            | NodeKind::Comment
            | NodeKind::Section
            | NodeKind::Lanes
            | NodeKind::Boundary
            | NodeKind::Package
            | NodeKind::Fragment
            | NodeKind::Class
            | NodeKind::Lifeline
            | NodeKind::Activation
            | NodeKind::Destroy => unreachable!("filtered out above"),
            // Everything else as a plain box
            _ => format!("[\"{text}\"]"),
        };
        out.push_str(&format!("  {id}{shape}\n"));
        ids.insert(&node.id, id);
    }

    for edge in &flow.edges {
        // Skip edges whose ends were not exported (e.g. notes)
        let (Some(from), Some(to)) = (ids.get(edge.from.as_str()), ids.get(edge.to.as_str()))
        else {
            continue;
        };
        match &edge.label {
            Some(label) if !label.trim().is_empty() => out.push_str(&format!(
                "  {from} -->|\"{}\"| {to}\n",
                mermaid_escape(label)
            )),
            _ => out.push_str(&format!("  {from} --> {to}\n")),
        }
    }
    out
}

fn mermaid_escape(s: &str) -> String {
    s.replace('"', "#quot;").replace('\n', "<br>")
}

// ---------------------------------------------------------------------------
// SVG: see flow_svg.rs
// ---------------------------------------------------------------------------

/// Bezier helpers for the layout: the same curve as an automatic edge in the app.
/// Bezier between the facing sides of rectangles a and b (x, y, w, h); the same
/// math as `edgeBetween` in src/lib/geometry.ts.
/// Returns [start, control point 1, control point 2, end].
pub(crate) fn bezier(a: [f64; 4], b: [f64; 4]) -> [(f64, f64); 4] {
    let [ax, ay, aw, ah] = a;
    let [bx, by, bw, bh] = b;
    let (ca, cb) = (
        (ax + aw / 2.0, ay + ah / 2.0),
        (bx + bw / 2.0, by + bh / 2.0),
    );
    let (dx, dy) = (cb.0 - ca.0, cb.1 - ca.1);
    let horizontal = dx.abs() / ((aw + bw) / 2.0).max(1.0) > dy.abs() / ((ah + bh) / 2.0).max(1.0);

    // (point, direction) for both ends
    let ((p1, n1), (p2, n2)) = if horizontal {
        if dx > 0.0 {
            (((ax + aw, ca.1), (1.0, 0.0)), ((bx, cb.1), (-1.0, 0.0)))
        } else {
            (((ax, ca.1), (-1.0, 0.0)), ((bx + bw, cb.1), (1.0, 0.0)))
        }
    } else if dy > 0.0 {
        (((ca.0, ay + ah), (0.0, 1.0)), ((cb.0, by), (0.0, -1.0)))
    } else {
        (((ca.0, ay), (0.0, -1.0)), ((cb.0, by + bh), (0.0, 1.0)))
    };

    let dist = ((p2.0 - p1.0).powi(2) + (p2.1 - p1.1).powi(2)).sqrt();
    let k = (dist * 0.45).clamp(20.0, 140.0);
    let c1 = (p1.0 + n1.0 * k, p1.1 + n1.1 * k);
    let c2 = (p2.0 + n2.0 * k, p2.1 + n2.1 * k);
    [p1, c1, c2, p2]
}

/// Point on a bezier at t (0 = start, 1 = end).
pub(crate) fn bezier_point([p0, p1, p2, p3]: [(f64, f64); 4], t: f64) -> (f64, f64) {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    (
        a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
        a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
    )
}

// ---------------------------------------------------------------------------
// PNG: render our own SVG with resvg
// ---------------------------------------------------------------------------

/// Render at 2x so the image is sharp on high-DPI screens.
const PNG_SCALE: f32 = 2.0;

fn to_png(flow: &FlowDoc) -> Result<Vec<u8>, String> {
    let svg = to_svg(flow);

    // Without fonts all text disappears, so load the system fonts.
    let mut opt = resvg::usvg::Options::default();
    let db = opt.fontdb_mut();
    db.load_system_fonts();
    // "sans-serif" and "monospace" mean Arial and Courier New unless told otherwise,
    // and a Linux server often has neither (the Docker image has DejaVu): then all
    // text is left out. Point them at the first font this computer has.
    let has = |db: &resvg::usvg::fontdb::Database, name: &str| db.faces().any(|f| f.families.iter().any(|(n, _)| n == name));
    let sans = ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans", "Liberation Sans", "Noto Sans"];
    if let Some(family) = sans.into_iter().find(|n| has(db, n)) {
        db.set_sans_serif_family(family);
    }
    let mono = ["Menlo", "Consolas", "Courier New", "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono"];
    if let Some(family) = mono.into_iter().find(|n| has(db, n)) {
        db.set_monospace_family(family);
    }

    let tree =
        resvg::usvg::Tree::from_str(&svg, &opt).map_err(|e| format!("cannot parse SVG: {e}"))?;
    let size = tree
        .size()
        .to_int_size()
        .scale_by(PNG_SCALE)
        .ok_or("image too large")?;
    let mut pixmap =
        resvg::tiny_skia::Pixmap::new(size.width(), size.height()).ok_or("cannot create image")?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(PNG_SCALE, PNG_SCALE),
        &mut pixmap.as_mut(),
    );
    pixmap
        .encode_png()
        .map_err(|e| format!("cannot encode PNG: {e}"))
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Camera, Edge, NodeColor};

    fn node(id: &str, kind: NodeKind, x: f64, y: f64) -> Node {
        Node {
            id: id.into(),
            kind,
            x,
            y,
            w: 160.0,
            h: 60.0,
            text: id.to_uppercase(),
            color: NodeColor::White,
            parent: None,
            lanes: None,
            locked: None,
            image: None,
            icon: None,
        }
    }

    fn edge(from: &str, to: &str) -> Edge {
        Edge {
            id: format!("{from}-{to}"),
            from: from.into(),
            to: to.into(),
            from_point: None,
            to_point: None,
            from_angle: None,
            to_angle: None,
            bend: None,
            message_y: None,
            label: None,
            style: None,
            pattern: None,
            start_cap: None,
            end_cap: None,
            label_pos: None,
            label_side: None,
            start_label: None,
            end_label: None,
        }
    }

    fn flow() -> FlowDoc {
        let mut d = node("d", NodeKind::Diamond, 0.0, 100.0);
        d.text = "Done \"really\"?".into();
        FlowDoc {
            nodes: vec![
                node("s", NodeKind::Pill, 0.0, 0.0),
                d,
                node("note", NodeKind::Note, 300.0, 0.0),
            ],
            edges: vec![
                edge("s", "d"),
                Edge {
                    label: Some("Yes".into()),
                    ..edge("d", "s")
                },
                edge("note", "s"),
            ],
            camera: Camera::default(),
            ..Default::default()
        }
    }

    #[test]
    fn mermaid() {
        let m = to_mermaid(&flow());
        assert_eq!(
            m,
            "flowchart TD\n  n0([\"S\"])\n  n1{\"Done #quot;really#quot;?\"}\n  n0 --> n1\n  n1 -->|\"Yes\"| n0\n"
        );
    }

    #[test]
    fn svg_and_png() {
        let svg = to_svg(&flow());
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("&quot;really&quot;"));
        let png = to_png(&flow()).unwrap();
        assert_eq!(&png[1..4], b"PNG");
    }

    #[test]
    fn file_names() {
        assert_eq!(safe_file_name("a/b: c"), "a-b- c");
        assert_eq!(safe_file_name("  "), "flowchart");
    }

    /// A chain with two edges that skip rows (plan -> build, plan -> check).
    /// Laid out naively, those edges run straight through the blocks in between.
    fn chain_with_skipping_edges() -> FlowDoc {
        let b = |id: &str, x, y| node(id, NodeKind::Box, x, y);
        let mut check = node("check", NodeKind::Diamond, -320.0, 50.0);
        check.h = 120.0;
        FlowDoc {
            nodes: vec![
                b("start", -120.0, -150.0),
                b("plan", -120.0, -20.0),
                b("review", 200.0, 0.0),
                b("build", 30.0, 160.0),
                check,
                b("done", -320.0, 260.0),
            ],
            edges: vec![
                edge("start", "plan"),
                edge("plan", "review"),
                edge("review", "build"),
                edge("plan", "build"),
                edge("plan", "check"),
                edge("build", "check"),
                edge("check", "done"),
            ],
            camera: Camera::default(),
            ..Default::default()
        }
    }

    /// Applies the layout and returns the updated flowchart.
    fn apply(mut flow: FlowDoc) -> FlowDoc {
        let pos = crate::arrange::arrange(&flow.nodes, &flow.edges).nodes;
        for p in pos {
            let n = flow.nodes.iter_mut().find(|n| n.id == p.id).unwrap();
            n.x = p.x;
            n.y = p.y;
        }
        flow
    }

    #[test]
    fn edges_do_not_cross_blocks() {
        let flow = apply(chain_with_skipping_edges());
        let by_id: HashMap<&str, &Node> = flow.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
        for e in &flow.edges {
            let (a, b) = (by_id[e.from.as_str()], by_id[e.to.as_str()]);
            let pts = bezier_points(a, b);
            for other in flow.nodes.iter().filter(|n| n.id != a.id && n.id != b.id) {
                let hit = pts.iter().any(|&(x, y)| {
                    x > other.x + 4.0
                        && x < other.x + other.w - 4.0
                        && y > other.y + 4.0
                        && y < other.y + other.h - 4.0
                });
                assert!(!hit, "edge {} -> {} crosses {}", a.id, b.id, other.id);
            }
        }
    }

    /// Points along an edge, to test where it runs.
    fn bezier_points(a: &Node, b: &Node) -> Vec<(f64, f64)> {
        let pts = bezier([a.x, a.y, a.w, a.h], [b.x, b.y, b.w, b.h]);
        (0..=50)
            .map(|k| bezier_point(pts, k as f64 / 50.0))
            .collect()
    }

    #[test]
    #[ignore] // run manually: cargo test render_example -- --ignored
    fn render_example() {
        let flow = apply(chain_with_skipping_edges());
        std::fs::write(
            std::env::temp_dir().join("flow-layout.png"),
            to_png(&flow).unwrap(),
        )
        .unwrap();
    }
}
