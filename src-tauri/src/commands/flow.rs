//! Flowchart features: auto-layout ("Arrange") and export (Mermaid, SVG, PNG).
//! Drawing the SVG lives in flow_svg.rs.
//!
//! The commands are thin wrappers. The real work happens in plain functions
//! without an `AppHandle` (`layout`, `to_mermaid`, `to_svg`, `to_png`), so they
//! can be unit-tested without starting the app.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::{codegen, eer, mermaid};
use super::flow_svg::to_svg;
use crate::CmdResult;
use crate::models::{
    CodeFile, CodeLanguage, DocContent, Document, Edge, ExportFormat, FlowDoc, Node, NodeKind, Position,
    SqlDialect,
};

/// Not a block in the flow: left out of auto-layout and the Mermaid export.
fn is_decoration(kind: NodeKind) -> bool {
    matches!(
        kind,
        NodeKind::Note
            | NodeKind::Label
            | NodeKind::Comment
            | NodeKind::Section
            | NodeKind::Lanes
            | NodeKind::Boundary
            | NodeKind::Package
            | NodeKind::Fragment
    )
}

// ===========================================================================
// Auto-layout
// ===========================================================================

/// Space between two rows, and between two nodes next to each other.
const GAP_Y: f64 = 70.0;
const GAP_X: f64 = 50.0;
/// Width reserved for a long edge where it passes through a row.
const DUMMY_W: f64 = 30.0;

#[tauri::command]
#[specta::specta]
pub fn auto_layout(nodes: Vec<Node>, edges: Vec<Edge>) -> CmdResult<Vec<Position>> {
    Ok(layout(&nodes, &edges))
}

/// Layered layout (a simplified Sugiyama):
///   1. break cycles (DFS)
///   2. layer per node = longest path from a start node (topological order)
///   3. split long edges with invisible dummy nodes
///   4. order nodes within each layer to reduce crossings (barycenter)
///   5. y per layer
///   6. x per node: as close to its neighbours as possible, without overlap
///   7. return the positions
///
/// Notes, labels, sections and swimlanes are ignored and stay where they are.
pub fn layout(nodes: &[Node], edges: &[Edge]) -> Vec<Position> {
    // Only real blocks. From here on nodes are referred to by index rather
    // than by string id, which makes the per-node vectors below simple.
    let items: Vec<&Node> = nodes.iter().filter(|n| !is_decoration(n.kind)).collect();
    let n = items.len();
    if n == 0 {
        return vec![];
    }

    // id -> index
    let index: HashMap<&str, usize> = items
        .iter()
        .enumerate()
        .map(|(i, node)| (node.id.as_str(), i))
        .collect();

    // Edges as (from, to) indices. Edges touching notes or unknown ids return
    // `None` through `?` and are dropped by `filter_map`, as are self-loops.
    let links: Vec<(usize, usize)> = edges
        .iter()
        .filter_map(|e| {
            let a = *index.get(e.from.as_str())?;
            let b = *index.get(e.to.as_str())?;
            (a != b).then_some((a, b))
        })
        .collect();

    // ---- 1. break cycles ---------------------------------------------------
    let links = remove_back_edges(n, &links, &items);

    // Children per node, and the number of incoming edges per node.
    let mut children: Vec<Vec<usize>> = vec![vec![]; n];
    let mut waiting = vec![0usize; n];
    for &(a, b) in &links {
        children[a].push(b);
        waiting[b] += 1;
    }

    // ---- 2. layers -----------------------------------------------------------
    // Kahn's algorithm: start with the nodes without incoming edges and visit a
    // node only once all of its parents are done, so their layers are final.
    let mut layer = vec![0usize; n];
    let mut queue: VecDeque<usize> = (0..n).filter(|&i| waiting[i] == 0).collect();
    while let Some(i) = queue.pop_front() {
        for &child in &children[i] {
            layer[child] = layer[child].max(layer[i] + 1);
            waiting[child] -= 1;
            if waiting[child] == 0 {
                queue.push_back(child);
            }
        }
    }

    // ---- 3. split long edges -------------------------------------------------
    // An edge that skips rows (layer 1 -> layer 3) gets an invisible dummy node
    // in every row it passes. The dummy takes up space, so the real blocks in
    // that row move aside instead of the edge being drawn across them.
    //
    // From here on indices `0..n` are real nodes and `n..` are dummies.
    let mut width: Vec<f64> = items.iter().map(|n| n.w).collect();
    let mut height: Vec<f64> = items.iter().map(|n| n.h).collect();
    let mut out: Vec<Vec<usize>> = vec![vec![]; n];
    let mut inc: Vec<Vec<usize>> = vec![vec![]; n];
    // Initial ordering: dummies start at the x of their source node.
    let mut start_x: Vec<f64> = items.iter().map(|n| center_x(n)).collect();
    // Per dummy: the real (from, to) nodes of the edge it belongs to.
    let mut chain: Vec<(usize, usize)> = vec![];

    for &(a, b) in &links {
        let mut prev = a;
        for l in layer[a] + 1..layer[b] {
            let d = width.len(); // index of the new dummy
            width.push(DUMMY_W);
            height.push(0.0);
            layer.push(l);
            start_x.push(start_x[a]);
            chain.push((a, b));
            out.push(vec![]);
            inc.push(vec![]);
            out[prev].push(d);
            inc[d].push(prev);
            prev = d;
        }
        out[prev].push(b);
        inc[b].push(prev);
    }
    let total = width.len();
    let is_dummy = |i: usize| i >= n;

    // Nodes per layer, initially ordered by their current x so the result
    // stays close to how the user arranged things.
    let layer_count = layer.iter().max().unwrap_or(&0) + 1;
    let mut rows: Vec<Vec<usize>> = vec![vec![]; layer_count];
    for i in 0..total {
        rows[layer[i]].push(i);
    }
    for row in &mut rows {
        row.sort_by(|&a, &b| start_x[a].total_cmp(&start_x[b]));
    }

    // ---- 4. reduce crossings -------------------------------------------------
    // Barycenter heuristic: sort each layer by the average position of each
    // node's neighbours, sweeping down (parents) and up (children) a few times.
    for round in 0..8 {
        let down = round % 2 == 0;
        let order: Vec<usize> = if down {
            (1..layer_count).collect()
        } else {
            (0..layer_count.saturating_sub(1)).rev().collect()
        };
        for l in order {
            // Position of every node within its own row
            let mut pos = vec![0.0; total];
            for row in &rows {
                for (p, &i) in row.iter().enumerate() {
                    pos[i] = p as f64;
                }
            }
            let neighbours = if down { &inc } else { &out };
            let mut keyed: Vec<(f64, usize)> = rows[l]
                .iter()
                .enumerate()
                .map(|(p, &i)| {
                    let ns = &neighbours[i];
                    // No neighbours: keep roughly the current position.
                    let key = if ns.is_empty() {
                        p as f64
                    } else {
                        ns.iter().map(|&j| pos[j]).sum::<f64>() / ns.len() as f64
                    };
                    (key, i)
                })
                .collect();
            // `sort_by` is stable, so ties keep their previous order.
            keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
            rows[l] = keyed.into_iter().map(|(_, i)| i).collect();
        }
    }

    // ---- 5. y per layer --------------------------------------------------------
    // Only depends on node heights, so it is known before any x is computed.
    let row_h: Vec<f64> = rows
        .iter()
        .map(|row| row.iter().map(|&i| height[i]).fold(0.0, f64::max))
        .collect();
    let mut row_top = vec![0.0; layer_count];
    for l in 1..layer_count {
        row_top[l] = row_top[l - 1] + row_h[l - 1] + GAP_Y;
    }
    // Rectangle (x, y, w, h) of real node `i` when its center is at `cx`
    let rect = |i: usize, cx: f64| {
        let (l, node) = (layer[i], items[i]);
        [
            cx - node.w / 2.0,
            row_top[l] + (row_h[l] - node.h) / 2.0,
            node.w,
            node.h,
        ]
    };

    // ---- 6. x per node ----------------------------------------------------------
    // Start with each row packed and centered. Then iterate:
    //  - a real node wants to sit centered under/over its neighbours;
    //  - a dummy wants to sit exactly where its edge (a bezier curve, drawn the
    //    same way as in the app) crosses the row, keeping that space free;
    //  - nothing may overlap. Dummies weigh more when re-centering a row, so
    //    blocks move out of the way of edges rather than the other way around.
    let gap = |a: usize, b: usize| {
        if is_dummy(a) || is_dummy(b) {
            GAP_X / 2.0
        } else {
            GAP_X
        }
    };
    let mut x = vec![0.0; total]; // center x
    for row in &rows {
        let mut cursor = 0.0;
        for (k, &i) in row.iter().enumerate() {
            if k > 0 {
                cursor += gap(row[k - 1], i);
            }
            x[i] = cursor + width[i] / 2.0;
            cursor += width[i];
        }
        let shift = cursor / 2.0;
        for &i in row {
            x[i] -= shift;
        }
    }
    for round in 0..12 {
        let down = round % 2 == 0;
        let neighbours = if down { &inc } else { &out };
        let order: Vec<usize> = if down {
            (1..layer_count).collect()
        } else {
            (0..layer_count.saturating_sub(1)).rev().collect()
        };
        for l in order {
            let row = &rows[l];
            // Where does each node want to be?
            let want: Vec<f64> = row
                .iter()
                .map(|&i| {
                    if is_dummy(i) {
                        // Where does the edge cross this row? Check the whole
                        // height, since a curve runs diagonally, and reserve it all.
                        let (a, b) = chain[i - n];
                        let (ra, rb) = (rect(a, x[a]), rect(b, x[b]));
                        let (lo, hi) = (0..=8)
                            .map(|k| curve_x_at(ra, rb, row_top[l] + row_h[l] * k as f64 / 8.0))
                            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), x| {
                                (lo.min(x), hi.max(x))
                            });
                        width[i] = hi - lo + DUMMY_W;
                        return (lo + hi) / 2.0;
                    }
                    let ns = &neighbours[i];
                    if ns.is_empty() {
                        x[i]
                    } else {
                        ns.iter().map(|&j| x[j]).sum::<f64>() / ns.len() as f64
                    }
                })
                .collect();
            // Place left to right, pushing a node right if it would overlap
            // the previous one.
            let mut placed = want.clone();
            for k in 1..row.len() {
                let (p, c) = (row[k - 1], row[k]);
                let min = placed[k - 1] + width[p] / 2.0 + gap(p, c) + width[c] / 2.0;
                placed[k] = placed[k].max(min);
            }
            // Pushing skews the row to the right; shift it back so that, on
            // weighted average, nodes (dummies most of all) are where they want.
            let weight = |i: usize| if is_dummy(i) { 10.0 } else { 1.0 };
            let (sum, wsum) = row.iter().enumerate().fold((0.0, 0.0), |(s, ws), (k, &i)| {
                (s + (want[k] - placed[k]) * weight(i), ws + weight(i))
            });
            let shift = sum / wsum;
            for (k, &i) in row.iter().enumerate() {
                x[i] = placed[k] + shift;
            }
        }
    }

    // ---- 7. positions ------------------------------------------------------------
    // Keep the result roughly where the nodes were before.
    let (orig_cx, top) = {
        let min_x = items.iter().map(|n| n.x).fold(f64::INFINITY, f64::min);
        let max_x = items
            .iter()
            .map(|n| n.x + n.w)
            .fold(f64::NEG_INFINITY, f64::max);
        let min_y = items.iter().map(|n| n.y).fold(f64::INFINITY, f64::min);
        ((min_x + max_x) / 2.0, min_y)
    };
    let (lo, hi) = (0..n).fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), i| {
        (lo.min(x[i] - width[i] / 2.0), hi.max(x[i] + width[i] / 2.0))
    });
    let dx = orig_cx - (lo + hi) / 2.0;

    // Dummies only exist inside the layout and are not returned.
    (0..n)
        .map(|i| {
            let [rx, ry, ..] = rect(i, x[i]);
            Position {
                id: items[i].id.clone(),
                x: rx + dx,
                y: ry + top,
            }
        })
        .collect()
}

/// The x where the edge between rectangles `a` and `b` crosses height `y`.
fn curve_x_at(a: [f64; 4], b: [f64; 4], y: f64) -> f64 {
    let [p0, p1, p2, p3] = bezier(a, b);
    // Sample the curve and take the point closest to `y`; 64 steps is plenty.
    (0..=64)
        .map(|k| bezier_point([p0, p1, p2, p3], k as f64 / 64.0))
        .min_by(|p, q| (p.1 - y).abs().total_cmp(&(q.1 - y).abs()))
        .map(|p| p.0)
        .unwrap_or(p0.0)
}

fn center_x(n: &Node) -> f64 {
    n.x + n.w / 2.0
}

/// Removes back edges so the graph has no cycles left.
///
/// DFS with three states: 0 = unvisited, 1 = in progress (on the current
/// path), 2 = done. An edge to a node that is still in progress points back
/// to an ancestor, so it closes a cycle and is dropped.
fn remove_back_edges(n: usize, links: &[(usize, usize)], items: &[&Node]) -> Vec<(usize, usize)> {
    let mut out: Vec<Vec<usize>> = vec![vec![]; n];
    for &(a, b) in links {
        out[a].push(b);
    }

    // Start from real start nodes (no incoming edges), top to bottom. That way
    // the edge that points "up" in a loop is the one treated as the back edge.
    let mut has_incoming = vec![false; n];
    for &(_, b) in links {
        has_incoming[b] = true;
    }
    let mut starts: Vec<usize> = (0..n).collect();
    starts.sort_by(|&a, &b| {
        has_incoming[a]
            .cmp(&has_incoming[b])
            .then(items[a].y.total_cmp(&items[b].y))
    });

    let mut state = vec![0u8; n];
    let mut back: Vec<(usize, usize)> = vec![];
    for s in starts {
        if state[s] == 0 {
            dfs(s, &out, &mut state, &mut back);
        }
    }

    // Everything except back edges; duplicate edges (a->b twice) count once.
    let mut kept: Vec<(usize, usize)> = links
        .iter()
        .copied()
        .filter(|l| !back.contains(l))
        .collect();
    kept.sort_unstable();
    kept.dedup();
    kept
}

fn dfs(i: usize, out: &[Vec<usize>], state: &mut [u8], back: &mut Vec<(usize, usize)>) {
    state[i] = 1;
    for &j in &out[i] {
        match state[j] {
            0 => dfs(j, out, state, back),
            1 => back.push((i, j)),
            _ => {}
        }
    }
    state[i] = 2;
}

// ===========================================================================
// Export
// ===========================================================================

#[tauri::command]
#[specta::specta]
pub fn export_document(app: AppHandle, doc: Document, format: ExportFormat) -> CmdResult<String> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("cannot find the Downloads folder: {e}"))?;

    let sql = |d: SqlDialect| -> CmdResult<(&'static str, Vec<u8>)> {
        let DocContent::Eer(eer) = &doc.content else {
            return Err("SQL can only be made from an EER diagram".into());
        };
        Ok(("sql", eer::to_sql(eer, d, &doc.name).into_bytes()))
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
        return write_code(&dir, &doc.name, codegen::generate(flow()?, lang, &doc.name));
    }

    let (ext, bytes) = match format {
        ExportFormat::Mermaid => {
            let blocks = mermaid::blocks(&doc);
            match blocks.as_slice() {
                [] => return Err("there is nothing in this document Mermaid can draw".into()),
                [one] => ("mmd", one.content.clone().into_bytes()),
                _ => ("md", mermaid::markdown(&doc.name, &blocks).into_bytes()),
            }
        }
        ExportFormat::Svg => ("svg", to_svg(flow()?).into_bytes()),
        ExportFormat::Png => ("png", to_png(flow()?)?),
        ExportFormat::Postgres => sql(SqlDialect::Postgres)?,
        ExportFormat::Mysql => sql(SqlDialect::Mysql)?,
        ExportFormat::Sqlite => sql(SqlDialect::Sqlite)?,
        ExportFormat::SqlServer => sql(SqlDialect::SqlServer)?,
        ExportFormat::Oracle => sql(SqlDialect::Oracle)?,
        _ => unreachable!("code formats are written above"),
    };

    let path = unique_path(&dir, &safe_file_name(&doc.name), ext);
    std::fs::write(&path, bytes).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// Writes generated code: one file directly in `dir`, several (Java) in a new folder.
/// Returns the path of the file or folder.
fn write_code(dir: &Path, name: &str, files: Vec<CodeFile>) -> CmdResult<String> {
    if files.is_empty() {
        return Err("there are no UML classes in this flowchart".into());
    }
    let write = |path: &Path, content: &str| std::fs::write(path, content).map_err(|e| format!("cannot write {}: {e}", path.display()));
    if let [file] = files.as_slice() {
        let (stem, ext) = file.name.rsplit_once('.').unwrap_or((&file.name, "txt"));
        let path = unique_path(dir, stem, ext);
        write(&path, &file.content)?;
        return Ok(path.display().to_string());
    }
    let base = safe_file_name(name);
    let folder = (1..)
        .map(|i| if i == 1 { dir.join(&base) } else { dir.join(format!("{base} ({i})")) })
        .find(|p| !p.exists())
        .expect("an infinite sequence always finds one");
    std::fs::create_dir_all(&folder).map_err(|e| format!("cannot create {}: {e}", folder.display()))?;
    for f in &files {
        write(&folder.join(safe_file_name(&f.name)), &f.content)?;
    }
    Ok(folder.display().to_string())
}

/// Replaces characters that are not allowed in file names.
fn safe_file_name(name: &str) -> String {
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

/// `name.ext`, or `name (2).ext`, `name (3).ext`, ... if it already exists.
fn unique_path(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{name}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|i| dir.join(format!("{name} ({i}).{ext}")))
        .find(|p| !p.exists())
        .expect("an infinite sequence always finds one")
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
fn bezier(a: [f64; 4], b: [f64; 4]) -> [(f64, f64); 4] {
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
fn bezier_point([p0, p1, p2, p3]: [(f64, f64); 4], t: f64) -> (f64, f64) {
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

fn to_png(flow: &FlowDoc) -> CmdResult<Vec<u8>> {
    let svg = to_svg(flow);

    // Without fonts all text disappears, so load the system fonts.
    let mut opt = resvg::usvg::Options::default();
    opt.fontdb_mut().load_system_fonts();

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
    use crate::models::{Camera, NodeColor};

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

    /// y per node id, to compare layers easily
    fn ys(pos: &[Position]) -> HashMap<String, f64> {
        pos.iter().map(|p| (p.id.clone(), p.y)).collect()
    }

    #[test]
    fn chain_becomes_three_layers() {
        let nodes = vec![
            node("c", NodeKind::Box, 0.0, 0.0),
            node("a", NodeKind::Box, 500.0, 300.0),
            node("b", NodeKind::Box, 0.0, 0.0),
        ];
        let edges = vec![edge("a", "b"), edge("b", "c")];
        let y = ys(&layout(&nodes, &edges));
        assert!(y["a"] < y["b"] && y["b"] < y["c"]);
    }

    #[test]
    fn branches_side_by_side() {
        let nodes = vec![
            node("s", NodeKind::Box, 0.0, 0.0),
            node("l", NodeKind::Box, 0.0, 0.0),
            node("r", NodeKind::Box, 0.0, 0.0),
        ];
        let edges = vec![edge("s", "l"), edge("s", "r")];
        let pos = layout(&nodes, &edges);
        let y = ys(&pos);
        assert_eq!(y["l"], y["r"]);
        let x: HashMap<_, _> = pos.iter().map(|p| (p.id.as_str(), p.x)).collect();
        assert_ne!(x["l"], x["r"]);
    }

    #[test]
    fn cycle_terminates() {
        // a -> b -> c -> a: without cycle breaking this would never finish
        let nodes = vec![
            node("a", NodeKind::Box, 0.0, 0.0),
            node("b", NodeKind::Box, 0.0, 100.0),
            node("c", NodeKind::Box, 0.0, 200.0),
        ];
        let edges = vec![edge("a", "b"), edge("b", "c"), edge("c", "a")];
        let y = ys(&layout(&nodes, &edges));
        assert!(y["a"] < y["b"] && y["b"] < y["c"]);
    }

    #[test]
    fn notes_and_empty_graph() {
        assert!(layout(&[], &[]).is_empty());
        let nodes = vec![
            node("n", NodeKind::Note, 0.0, 0.0),
            node("a", NodeKind::Box, 0.0, 0.0),
        ];
        let pos = layout(&nodes, &[edge("n", "a")]);
        assert_eq!(pos.len(), 1);
        assert_eq!(pos[0].id, "a");
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
        }
    }

    /// Applies the layout and returns the updated flowchart.
    fn apply(mut flow: FlowDoc) -> FlowDoc {
        let pos = layout(&flow.nodes, &flow.edges);
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
