//! SVG export of a flowchart: the same drawing as the canvas in the app.
//!
//! Where edges attach and how they are routed is a port of `src/lib/geometry.ts`,
//! and the shapes follow `NodeView.tsx` and `styles.css`. Keep them in step.
//!
//! Drawing order, as in the app: frames (sections, swimlanes, ...) at the back,
//! then edges, then blocks, then all labels so they are never hidden.

use std::collections::HashMap;

use crate::models::{
    Edge, EdgeCap, EdgeStyle, FlowDoc, LabelSide, LinePattern, Node, NodeColor, NodeKind, Point,
};

const PAD: f64 = 40.0;
const FONT_SIZE: f64 = 14.0;
const LINE_H: f64 = 18.0;
const FONT: &str = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO: &str = "ui-monospace, Menlo, Consolas, monospace";

// Light theme colors from styles.css
const EDGE: &str = "#4a4a52";
const TEXT: &str = "#1f1f24";
const MUTED: &str = "#77767f";
const BG: &str = "#ffffff";

/// Height of the head of a lifeline, and of the headers of a swimlane pool.
const LIFELINE_HEAD: f64 = 44.0;
const LANE_HEADER: f64 = 34.0;

/// Fill and border per color (see `--yellow-fill` etc. in styles.css).
fn colors(c: NodeColor) -> (&'static str, &'static str) {
    match c {
        NodeColor::White => ("#ffffff", "#b7b5ae"),
        NodeColor::Yellow => ("#fff3bf", "#e3c55a"),
        NodeColor::Green => ("#daf3e2", "#78c294"),
        NodeColor::Blue => ("#dde9ff", "#7fa3e8"),
        NodeColor::Purple => ("#ebe4ff", "#a48ee8"),
        NodeColor::Pink => ("#ffe1ea", "#e48fab"),
    }
}

/// Color of solid marks (start point, bar, crosses): white means the edge color.
fn dot_color(c: NodeColor) -> &'static str {
    match c {
        NodeColor::White => EDGE,
        other => colors(other).1,
    }
}

fn is_frame(kind: NodeKind) -> bool {
    matches!(
        kind,
        NodeKind::Section
            | NodeKind::Lanes
            | NodeKind::Boundary
            | NodeKind::Package
            | NodeKind::Fragment
    )
}

pub fn to_svg(flow: &FlowDoc) -> String {
    // Bounding box of all nodes (a package tab sticks out above) and free line ends, plus padding.
    let boxes = flow.nodes.iter().map(|n| {
        let top = if n.kind == NodeKind::Package { n.y - 28.0 } else { n.y };
        (n.x, top, n.x + n.w, n.y + n.h)
    });
    let points = flow
        .edges
        .iter()
        .flat_map(|e| [e.from_point, e.to_point])
        .flatten()
        .map(|p| (p.x, p.y, p.x, p.y));
    let (min_x, min_y, max_x, max_y) = boxes.chain(points).fold(
        (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        |(a, b, c, d), (x0, y0, x1, y1)| (a.min(x0), b.min(y0), c.max(x1), d.max(y1)),
    );
    let (min_x, min_y, w, h) = if min_x.is_infinite() {
        (0.0, 0.0, 200.0, 100.0)
    } else {
        (
            min_x - PAD,
            min_y - PAD,
            max_x - min_x + 2.0 * PAD,
            max_y - min_y + 2.0 * PAD,
        )
    };

    let mut s = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{min_x} {min_y} {w} {h}" font-family="{FONT}" font-size="{FONT_SIZE}">
<rect x="{min_x}" y="{min_y}" width="{w}" height="{h}" fill="{BG}"/>
"##
    );

    // Frames at the back, the largest first so nested ones stay visible
    let mut frames: Vec<&Node> = flow.nodes.iter().filter(|n| is_frame(n.kind)).collect();
    frames.sort_by(|a, b| (b.w * b.h).total_cmp(&(a.w * a.h)));
    let seq = analyze(&flow.nodes, &flow.edges);
    let paint = flow.call_colors == Some(true);
    for n in frames {
        s.push_str(&node_svg(n, &seq, paint));
    }

    let by_id: HashMap<&str, &Node> = flow.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    // A node, or a point for an end that is not attached to one
    let end = |node: &str, point: Option<Point>| match point {
        Some(p) => Some(Shape::point(pt(p.x, p.y))),
        None => by_id.get(node).map(|n| Shape::of(n)),
    };
    let mut labels = String::new();
    // Messages of sequence diagrams go above the lifelines: stacked activation bars
    // would hide their ends (as MessagesLayer in Edges.tsx)
    let mut messages = String::new();
    for edge in &flow.edges {
        let (Some(a), Some(b)) = (end(&edge.from, edge.from_point), end(&edge.to, edge.to_point)) else {
            continue;
        };
        // A message in a sequence diagram, or a regular connector
        let message = edge
            .message_y
            .and(by_id.get(edge.from.as_str()).zip(by_id.get(edge.to.as_str())));
        let geom = match message {
            Some((from, to)) => message_line(edge, from, to, &seq.bars),
            None => {
                // A right-angle line goes around the other blocks (not frames: lines run inside those)
                let obstacles: Vec<Shape> = flow
                    .nodes
                    .iter()
                    .filter(|n| n.id != edge.from && n.id != edge.to && !is_frame(n.kind))
                    .map(Shape::of)
                    .collect();
                edge_geom(edge, &a, &b, &obstacles)
            }
        };
        let stroke = seq
            .color(paint && message.is_some(), Some(&edge.id))
            .map_or(EDGE, |c| colors(c).1);
        let svg = edge_svg(edge, &geom, stroke);
        if message.is_some() {
            messages.push_str(&svg)
        } else {
            s.push_str(&svg)
        }
        labels.push_str(&edge_labels_svg(edge, &geom));
    }

    for n in flow.nodes.iter().filter(|n| !is_frame(n.kind)) {
        s.push_str(&node_svg(n, &seq, paint));
    }
    s.push_str(&messages);
    s.push_str(&labels);
    s.push_str("</svg>\n");
    s
}

// ---------------------------------------------------------------------------
// Geometry (port of src/lib/geometry.ts)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
struct Pt {
    x: f64,
    y: f64,
}

const fn pt(x: f64, y: f64) -> Pt {
    Pt { x, y }
}

/// A node's rectangle plus its kind, which decides the outline edges attach to.
#[derive(Debug, Clone, Copy)]
struct Shape {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    kind: Option<NodeKind>,
}

impl Shape {
    fn of(n: &Node) -> Self {
        Self { x: n.x, y: n.y, w: n.w, h: n.h, kind: Some(n.kind) }
    }
    fn point(p: Pt) -> Self {
        Self { x: p.x, y: p.y, w: 0.0, h: 0.0, kind: None }
    }
    fn center(&self) -> Pt {
        pt(self.x + self.w / 2.0, self.y + self.h / 2.0)
    }
}

/// A point on the outline of a node, and the direction an edge leaves it in.
struct Port {
    p: Pt,
    n: Pt,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Side {
    Left,
    Right,
    Top,
    Bottom,
}

fn side_angle(s: Side) -> f64 {
    match s {
        Side::Right => 0.0,
        Side::Bottom => 90.0,
        Side::Left => 180.0,
        Side::Top => 270.0,
    }
}

/// The sides of a and b that face each other.
fn pick_sides(a: &Shape, b: &Shape) -> (Side, Side) {
    let (ca, cb) = (a.center(), b.center());
    let (dx, dy) = (cb.x - ca.x, cb.y - ca.y);
    let horizontal = dx.abs() / non_zero((a.w + b.w) / 2.0) > dy.abs() / non_zero((a.h + b.h) / 2.0);
    match (horizontal, dx > 0.0, dy > 0.0) {
        (true, true, _) => (Side::Right, Side::Left),
        (true, false, _) => (Side::Left, Side::Right),
        (false, _, true) => (Side::Bottom, Side::Top),
        (false, _, false) => (Side::Top, Side::Bottom),
    }
}

/// `v`, or 1 when it is 0 (like `v || 1` in TypeScript).
fn non_zero(v: f64) -> f64 {
    if v == 0.0 { 1.0 } else { v }
}

/// Elbow edges: straight across when the blocks overlap horizontally or
/// vertically, otherwise out of the side and into the top or bottom (an L).
fn elbow_sides(a: &Shape, b: &Shape) -> (Side, Side) {
    let overlap_x = a.x < b.x + b.w && b.x < a.x + a.w;
    let overlap_y = a.y < b.y + b.h && b.y < a.y + a.h;
    if overlap_x || overlap_y {
        return pick_sides(a, b);
    }
    let (ca, cb) = (a.center(), b.center());
    (
        if cb.x > ca.x { Side::Right } else { Side::Left },
        if cb.y > ca.y { Side::Top } else { Side::Bottom },
    )
}

fn unit(from: Pt, to: Pt) -> Pt {
    let len = non_zero((to.x - from.x).hypot(to.y - from.y));
    pt((to.x - from.x) / len, (to.y - from.y) / len)
}

/// The point on a node's outline at `angle` degrees, measured as if the node
/// were square: 45 is always the bottom-right corner of a box.
fn port_at(s: &Shape, angle: f64) -> Port {
    let rad = angle.to_radians();
    let (dx, dy) = (rad.cos(), rad.sin());
    let c = s.center();
    let (hw, hh) = (s.w / 2.0, s.h / 2.0);

    match s.kind {
        Some(NodeKind::Diamond) => {
            let k = 1.0 / (dx.abs() + dy.abs());
            let p = pt(c.x + dx * k * hw, c.y + dy * k * hh);
            return Port { p, n: unit(c, p) };
        }
        Some(NodeKind::Start | NodeKind::End | NodeKind::FlowFinal | NodeKind::Circle) => {
            let p = pt(c.x + dx * hw, c.y + dy * hh);
            return Port { p, n: unit(c, p) };
        }
        _ => {}
    }

    // Box (and everything else): where the ray from the center leaves the rectangle
    let k = 1.0 / dx.abs().max(dy.abs());
    let p = pt(c.x + dx * k * hw, c.y + dy * k * hh);
    let n = if (dx.abs() - dy.abs()).abs() < 0.05 {
        pt(dx.signum() * std::f64::consts::FRAC_1_SQRT_2, dy.signum() * std::f64::consts::FRAC_1_SQRT_2)
    } else if dx.abs() > dy.abs() {
        pt(dx.signum(), 0.0)
    } else {
        pt(0.0, dy.signum())
    };

    // A lifeline: messages attach to the dashed line, below the head
    if s.kind == Some(NodeKind::Lifeline) && n.x != 0.0 && p.y > s.y + LIFELINE_HEAD {
        return Port { p: pt(c.x, p.y), n };
    }

    // A pill has round ends: move points there from the rectangle onto the circle
    let r = hh;
    if s.kind == Some(NodeKind::Pill) && s.w >= s.h && (p.x - c.x).abs() > hw - r {
        let cc = pt(c.x + dx.signum() * (hw - r), c.y);
        let d = pt(dx * hw, dy * hh);
        let f = pt(c.x - cc.x, c.y - cc.y);
        let a = d.x * d.x + d.y * d.y;
        let b = 2.0 * (f.x * d.x + f.y * d.y);
        let cq = f.x * f.x + f.y * f.y - r * r;
        let t = (-b + (b * b - 4.0 * a * cq).max(0.0).sqrt()) / (2.0 * a);
        let q = pt(c.x + d.x * t, c.y + d.y * t);
        return Port { p: q, n: unit(cc, q) };
    }
    Port { p, n }
}

/// Rounds a direction to the nearest of right, down, left and up.
fn axis(n: Pt) -> Pt {
    let sign = |v: f64| if v < 0.0 { -1.0 } else { 1.0 };
    if n.x.abs() >= n.y.abs() { pt(sign(n.x), 0.0) } else { pt(0.0, sign(n.y)) }
}

/// The line of an edge: an SVG path, plus the same line as a polyline for labels and arrowheads.
struct Geom {
    d: String,
    points: Vec<Pt>,
}

fn edge_geom(edge: &Edge, sa: &Shape, sb: &Shape, obstacles: &[Shape]) -> Geom {
    let (sa, sb) = (*sa, *sb);
    // Both ends on the same node (free ends have no node)
    if !edge.from.is_empty() && edge.from == edge.to {
        let from = port_at(&sa, edge.from_angle.unwrap_or(335.0));
        let to = port_at(&sa, edge.to_angle.unwrap_or(25.0));
        return elbow(from.p, axis(from.n), to.p, axis(to.n));
    }
    let style = edge.style.unwrap_or(EdgeStyle::Curved);
    let sides = if style == EdgeStyle::Elbow { elbow_sides } else { pick_sides };
    // An end with an angle is attached there; an end without one picks the
    // side that faces the other end (or the other node).
    let pa = edge.from_angle.map(|t| port_at(&sa, t));
    let pb = edge.to_angle.map(|t| port_at(&sb, t));
    let facing_a = pa.as_ref().map_or(sa, |p| Shape::point(p.p));
    let facing_b = pb.as_ref().map_or(sb, |p| Shape::point(p.p));
    let from = pa.unwrap_or_else(|| port_at(&sa, side_angle(sides(&sa, &facing_b).0)));
    let to = pb.unwrap_or_else(|| port_at(&sb, side_angle(sides(&facing_a, &sb).1)));

    let bend = edge.bend.map(|b| pt(b.x, b.y));
    match (style, bend) {
        (EdgeStyle::Straight, None) => Geom {
            d: format!("M {} {} L {} {}", from.p.x, from.p.y, to.p.x, to.p.y),
            points: vec![from.p, to.p],
        },
        // A corner where the middle was dragged to
        (EdgeStyle::Straight, Some(b)) => {
            let mid = pt((from.p.x + to.p.x) / 2.0 + b.x, (from.p.y + to.p.y) / 2.0 + b.y);
            Geom {
                d: format!("M {} {} L {} {} L {} {}", from.p.x, from.p.y, mid.x, mid.y, to.p.x, to.p.y),
                points: vec![from.p, mid, to.p],
            }
        }
        (EdgeStyle::Elbow, None) => route(from.p, axis(from.n), to.p, axis(to.n), obstacles),
        (EdgeStyle::Elbow, Some(b)) => bent_elbow(from.p, axis(from.n), to.p, axis(to.n), b),
        (EdgeStyle::Curved, _) => curve(from.p, from.n, to.p, to.n, bend),
    }
}

/// An elbow line moved by `bend`: through the point where its middle would be
/// (the corner of an L), moved by that much.
fn bent_elbow(p1: Pt, n1: Pt, p2: Pt, n2: Pt, bend: Pt) -> Geom {
    let plain = elbow(p1, n1, p2, n2);
    let r = if plain.points.len() == 3 { plain.points[1] } else { point_along(&plain.points, 0.5).0 };
    let b = pt(r.x + bend.x, r.y + bend.y);
    let raw = match (n1.x != 0.0, n2.x != 0.0) {
        (true, true) => vec![p1, pt(b.x, p1.y), pt(b.x, p2.y), p2],
        (false, false) => vec![p1, pt(p1.x, b.y), pt(p2.x, b.y), p2],
        (true, false) => vec![p1, pt(b.x, p1.y), b, pt(p2.x, b.y), p2],
        (false, true) => vec![p1, pt(p1.x, b.y), b, pt(b.x, p2.y), p2],
    };
    polyline(&raw)
}

/// Bezier curve leaving both ends in their direction. With `bend` the middle of
/// the curve moves by that much: both control points shift by 4/3 of it.
fn curve(p1: Pt, n1: Pt, p2: Pt, n2: Pt, bend: Option<Pt>) -> Geom {
    let k = ((p2.x - p1.x).hypot(p2.y - p1.y) * 0.45).clamp(20.0, 140.0);
    let shift = bend.map_or(pt(0.0, 0.0), |b| pt(b.x * 4.0 / 3.0, b.y * 4.0 / 3.0));
    let c1 = pt(p1.x + n1.x * k + shift.x, p1.y + n1.y * k + shift.y);
    let c2 = pt(p2.x + n2.x * k + shift.x, p2.y + n2.y * k + shift.y);
    let points = (0..=24)
        .map(|i| {
            let t = i as f64 / 24.0;
            let u = 1.0 - t;
            let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            pt(
                a * p1.x + b * c1.x + c * c2.x + d * p2.x,
                a * p1.y + b * c1.y + c * c2.y + d * p2.y,
            )
        })
        .collect();
    Geom {
        d: format!(
            "M {} {} C {} {}, {} {}, {} {}",
            p1.x, p1.y, c1.x, c1.y, c2.x, c2.y, p2.x, p2.y
        ),
        points,
    }
}

/// How far an elbow line goes straight out of a node before its first corner.
const STUB: f64 = 20.0;

/// Horizontal and vertical segments from p1 (leaving in direction n1) to p2 (arriving from n2).
fn elbow(p1: Pt, n1: Pt, p2: Pt, n2: Pt) -> Geom {
    let a = pt(p1.x + n1.x * STUB, p1.y + n1.y * STUB);
    let b = pt(p2.x + n2.x * STUB, p2.y + n2.y * STUB);
    // Is `to` in front of `from`, looking in direction n?
    let ahead = |from: Pt, n: Pt, to: Pt| (to.x - from.x) * n.x + (to.y - from.y) * n.y > 0.0;
    let (h1, h2) = (n1.x != 0.0, n2.x != 0.0);

    let mid = if h1 && h2 {
        if n1.x == -n2.x && ahead(p1, n1, p2) {
            let mx = (p1.x + p2.x) / 2.0;
            vec![pt(mx, p1.y), pt(mx, p2.y)]
        } else if n1.x == n2.x {
            let x = if n1.x > 0.0 { a.x.max(b.x) } else { a.x.min(b.x) };
            vec![pt(x, p1.y), pt(x, p2.y)]
        } else {
            let my = (p1.y + p2.y) / 2.0;
            vec![a, pt(a.x, my), pt(b.x, my), b]
        }
    } else if !h1 && !h2 {
        if n1.y == -n2.y && ahead(p1, n1, p2) {
            let my = (p1.y + p2.y) / 2.0;
            vec![pt(p1.x, my), pt(p2.x, my)]
        } else if n1.y == n2.y {
            let y = if n1.y > 0.0 { a.y.max(b.y) } else { a.y.min(b.y) };
            vec![pt(p1.x, y), pt(p2.x, y)]
        } else {
            let mx = (p1.x + p2.x) / 2.0;
            vec![a, pt(mx, a.y), pt(mx, b.y), b]
        }
    } else {
        let corner = if h1 { pt(p2.x, p1.y) } else { pt(p1.x, p2.y) };
        if ahead(p1, n1, corner) && ahead(p2, n2, corner) {
            vec![corner]
        } else {
            vec![a, if h1 { pt(a.x, b.y) } else { pt(b.x, a.y) }, b]
        }
    };

    let mut raw = vec![p1];
    raw.extend(mid);
    raw.push(p2);
    polyline(&raw)
}

// ---------- going around blocks (port of `elbow` in src/lib/geometry.ts) ----------

/// Room kept around a block a line goes past
const CLEARANCE: f64 = 8.0;
/// How far past a block the moved middle segment runs
const CHANNEL: f64 = 20.0;
/// Blocks further than this from the line's ends are not looked at
const REACH: f64 = 300.0;

/// How many blocks a right-angle route crosses (each segment against each block).
fn crossings(points: &[Pt], blocks: &[Shape]) -> usize {
    let mut n = 0;
    for w in points.windows(2) {
        let (a, b) = (w[0], w[1]);
        for r in blocks {
            let (x0, x1, y0, y1) = (r.x - CLEARANCE, r.x + r.w + CLEARANCE, r.y - CLEARANCE, r.y + r.h + CLEARANCE);
            let hit = if a.y == b.y {
                a.y > y0 && a.y < y1 && a.x.max(b.x) > x0 && a.x.min(b.x) < x1
            } else {
                a.x > x0 && a.x < x1 && a.y.max(b.y) > y0 && a.y.min(b.y) < y1
            };
            if hit {
                n += 1;
            }
        }
    }
    n
}

/// Length of a right-angle route (exact: the segments are horizontal or vertical).
fn route_length(points: &[Pt]) -> f64 {
    points.windows(2).map(|w| (w[1].x - w[0].x).abs() + (w[1].y - w[0].y).abs()).sum()
}

/// Horizontal and vertical segments from p1 to p2 that go around `obstacles`: the usual
/// route when it is free, otherwise a detour just around a block, or the middle in a
/// channel past it. Fewest crossings wins, then the shortest; on a tie the earlier one.
fn route(p1: Pt, n1: Pt, p2: Pt, n2: Pt, obstacles: &[Shape]) -> Geom {
    let plain = elbow(p1, n1, p2, n2);
    if obstacles.is_empty() {
        return plain;
    }
    let area = (p1.x.min(p2.x) - REACH, p1.y.min(p2.y) - REACH, p1.x.max(p2.x) + REACH, p1.y.max(p2.y) + REACH);
    // Only blocks near the line matter
    let near: Vec<Shape> = obstacles
        .iter()
        .filter(|r| r.x < area.2 && r.x + r.w > area.0 && r.y < area.3 && r.y + r.h > area.1)
        .copied()
        .collect();
    // Only the blocks the usual route hits make detours, which keeps it fast
    let blockers: Vec<Shape> = near.iter().filter(|r| crossings(&plain.points, std::slice::from_ref(*r)) > 0).copied().collect();
    if blockers.is_empty() {
        return plain;
    }

    let a = pt(p1.x + n1.x * STUB, p1.y + n1.y * STUB);
    let b = pt(p2.x + n2.x * STUB, p2.y + n2.y * STUB);
    let sorted = |mut v: Vec<f64>| {
        v.sort_by(f64::total_cmp);
        v.dedup();
        v
    };
    let xs = sorted(blockers.iter().flat_map(|r| [r.x - CHANNEL, r.x + r.w + CHANNEL]).collect());
    let ys = sorted(blockers.iter().flat_map(|r| [r.y - CHANNEL, r.y + r.h + CHANNEL]).collect());
    let mut candidates: Vec<Vec<Pt>> = vec![];
    for r in &blockers {
        let (left, right, top, bottom) = (r.x - CHANNEL, r.x + r.w + CHANNEL, r.y - CHANNEL, r.y + r.h + CHANNEL);
        candidates.push(vec![p1, a, pt(left, a.y), pt(left, top), pt(right, top), pt(right, b.y), b, p2]);
        candidates.push(vec![p1, a, pt(left, a.y), pt(left, bottom), pt(right, bottom), pt(right, b.y), b, p2]);
        candidates.push(vec![p1, a, pt(a.x, top), pt(left, top), pt(left, bottom), pt(b.x, bottom), b, p2]);
        candidates.push(vec![p1, a, pt(a.x, top), pt(right, top), pt(right, bottom), pt(b.x, bottom), b, p2]);
    }
    candidates.extend(xs.iter().map(|&x| vec![p1, a, pt(x, a.y), pt(x, b.y), b, p2]));
    candidates.extend(ys.iter().map(|&y| vec![p1, a, pt(a.x, y), pt(b.x, y), b, p2]));

    let mut best_cost = (crossings(&plain.points, &near), route_length(&plain.points));
    let mut best = plain;
    for raw in candidates {
        let c = polyline(&raw);
        let cost = (crossings(&c.points, &near), route_length(&c.points));
        if cost.0 < best_cost.0 || (cost.0 == best_cost.0 && cost.1 < best_cost.1) {
            best = c;
            best_cost = cost;
        }
    }
    best
}

/// Polyline with slightly rounded corners.
fn polyline(raw: &[Pt]) -> Geom {
    // Drop duplicate points and points in the middle of a straight run
    let mut pts: Vec<Pt> = vec![];
    for &p in raw {
        if let Some(&last) = pts.last() {
            if (last.x - p.x).abs() < 0.5 && (last.y - p.y).abs() < 0.5 {
                continue;
            }
            if pts.len() >= 2 {
                let prev = pts[pts.len() - 2];
                if (prev.x - last.x) * (last.y - p.y) == (prev.y - last.y) * (last.x - p.x) {
                    pts.pop();
                }
            }
        }
        pts.push(p);
    }

    let towards = |from: Pt, to: Pt, r: f64| {
        let u = unit(from, to);
        pt(from.x + u.x * r, from.y + u.y * r)
    };
    let mut d = format!("M {} {}", pts[0].x, pts[0].y);
    for i in 1..pts.len().saturating_sub(1) {
        let (a, b, c) = (pts[i - 1], pts[i], pts[i + 1]);
        let r = 8.0_f64
            .min((b.x - a.x).hypot(b.y - a.y) / 2.0)
            .min((c.x - b.x).hypot(c.y - b.y) / 2.0);
        let (into, out) = (towards(b, a, r), towards(b, c, r));
        d.push_str(&format!(" L {} {} Q {} {}, {} {}", into.x, into.y, b.x, b.y, out.x, out.y));
    }
    let end = pts[pts.len() - 1];
    d.push_str(&format!(" L {} {}", end.x, end.y));
    Geom { d, points: pts }
}

/// The point at fraction `t` of a polyline, and whether the line runs mostly horizontal there.
fn point_along(points: &[Pt], t: f64) -> (Pt, bool) {
    let lengths: Vec<f64> = points
        .windows(2)
        .map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y))
        .collect();
    let mut rest = lengths.iter().sum::<f64>() * t.clamp(0.0, 1.0);
    for (i, &len) in lengths.iter().enumerate() {
        if rest <= len || i == lengths.len() - 1 {
            let k = if len > 0.0 { (rest / len).min(1.0) } else { 0.0 };
            let (a, b) = (points[i], points[i + 1]);
            let horizontal = (b.x - a.x).abs() >= (b.y - a.y).abs();
            return (pt(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k), horizontal);
        }
        rest -= len;
    }
    (points[0], true)
}

/// An end of a polyline, with the angle (degrees) pointing out of the line.
fn line_end(points: &[Pt], at_start: bool) -> (Pt, f64) {
    let (inner, tip) = if at_start {
        (points.get(1).copied(), points[0])
    } else {
        (points.len().checked_sub(2).map(|i| points[i]), points[points.len() - 1])
    };
    let angle = inner.map_or(0.0, |i| (tip.y - i.y).atan2(tip.x - i.x).to_degrees());
    (tip, angle)
}

/// Where the small text at one end goes: a bit along the line, beside it.
fn end_label_point(points: &[Pt], at_start: bool) -> Pt {
    let (tip, angle) = line_end(points, at_start);
    let rad = angle.to_radians();
    let dir = pt(rad.cos(), rad.sin());
    let mut side = pt(dir.y, -dir.x);
    if side.y > 0.01 || (side.y.abs() <= 0.01 && side.x < 0.0) {
        side = pt(-side.x, -side.y);
    }
    pt(tip.x - dir.x * 26.0 + side.x * 12.0, tip.y - dir.y * 26.0 + side.y * 12.0)
}

// ---------------------------------------------------------------------------
// Sequence diagrams (port of src/lib/sequence.ts)
// ---------------------------------------------------------------------------

/** Width of an automatic activation bar */
const BAR_W: f64 = 14.0;
/** How far a bar inside another bar (a call inside a call) moves to the right */
const NEST: f64 = BAR_W / 2.0;
/** Where the bar of the lifeline that starts it all stops, above the end of its lifeline */
const BASE_END: f64 = 16.0;
/** How far a self-message goes out, and how much lower it comes back */
const SELF_W: f64 = 30.0;
const SELF_H: f64 = 30.0;

/// A vertical span (top, bottom).
pub(crate) type Span = (f64, f64);
/// An activation bar: (top, bottom, level, call). Level 0 is on the lifeline, 1 on top
/// of that, ...; `call` is the message that started it (none: the lifeline started
/// something itself).
pub(crate) type Bar = (f64, f64, u32, Option<String>);
/// A bar while it is worked out: (top, bottom, the call that started it)
type Own = (f64, f64, Option<String>);

/// Colors for calls, in turn (as CALL_COLORS in src/lib/sequence.ts)
const CALL_COLORS: [NodeColor; 5] = [
    NodeColor::Blue,
    NodeColor::Green,
    NodeColor::Purple,
    NodeColor::Pink,
    NodeColor::Yellow,
];

/// What follows from the messages of a sequence diagram (see `analyze`).
pub(crate) struct Sequence {
    /// Activation bars per lifeline, top to bottom
    pub bars: HashMap<String, Vec<Bar>>,
    /// Messages that answer an earlier call
    pub returns: std::collections::HashSet<String>,
    /// Per call and per return: the number of the call, top to bottom (a return has its call's)
    pub colors: HashMap<String, usize>,
}

impl Sequence {
    /// The color of a call or return, when the board colors them.
    fn color(&self, on: bool, id: Option<&str>) -> Option<NodeColor> {
        let n = self.colors.get(id?)?;
        on.then(|| CALL_COLORS[n % CALL_COLORS.len()])
    }
}

/// Activation bars per lifeline, reading the messages top to bottom:
/// - a message from B back to A answers the latest open call from A to B: a
///   return, solid or dashed. Any other message is a call (a dashed one that
///   answers nothing is just a message).
/// - a call activates the lifeline it arrives at, until its return; without a
///   return, to just past that lifeline's last message.
/// - a lifeline that never receives a call (the one that starts it all) is
///   active from its first message all the way down its lifeline. So is one that
///   sends a message while none of its bars is active: it started something itself.
///
/// A bar that starts while another bar of the lifeline is still active (a call
/// inside a call) lies on top of it, one level further: see `levels`.
#[cfg(test)]
fn activations(nodes: &[Node], edges: &[Edge]) -> HashMap<String, Vec<Bar>> {
    analyze(nodes, edges).bars
}

/// The activation bars per lifeline, which messages are returns, and the calls'
/// numbers for their colors (see `activations`).
pub(crate) fn analyze(nodes: &[Node], edges: &[Edge]) -> Sequence {
    struct Call<'a> {
        id: &'a str,
        caller: &'a str,
        callee: &'a str,
        y: f64,
    }
    let by_id: HashMap<&str, &Node> = nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut messages: Vec<(&Edge, f64)> = edges
        .iter()
        .filter_map(|e| {
            let from = by_id.get(e.from.as_str())?;
            by_id.get(e.to.as_str())?;
            Some((e, from.y + e.message_y?))
        })
        .collect();
    messages.sort_by(|a, b| a.1.total_cmp(&b.1));

    let mut spans: HashMap<&str, Vec<Own>> = HashMap::new();
    // First and last height at which each node sends or receives a message
    let mut seen: HashMap<&str, Span> = HashMap::new();
    fn see<'a>(seen: &mut HashMap<&'a str, Span>, id: &'a str, y: f64) {
        let s = seen.entry(id).or_insert((y, y));
        *s = (s.0.min(y), s.1.max(y));
    }
    let mut called: Vec<&str> = vec![];
    // Heights at which each node sends a message to another node
    let mut sends: HashMap<&str, Vec<f64>> = HashMap::new();
    let mut open: Vec<Call> = vec![];
    let mut returns = std::collections::HashSet::new();
    let mut colors: HashMap<String, usize> = HashMap::new();
    let mut calls = 0;

    for &(e, y) in &messages {
        if e.from == e.to {
            see(&mut seen, &e.from, y);
            see(&mut seen, &e.from, y + SELF_H);
            continue;
        }
        see(&mut seen, &e.from, y);
        see(&mut seen, &e.to, y);
        sends.entry(&e.from).or_default().push(y);
        // The latest open call this message answers
        if let Some(i) = open.iter().rposition(|c| c.caller == e.to && c.callee == e.from) {
            let call = open.remove(i);
            spans
                .entry(&e.from)
                .or_default()
                .push((call.y, y, Some(call.id.to_string())));
            returns.insert(e.id.clone());
            let n = colors[call.id];
            colors.insert(e.id.clone(), n);
        } else if e.pattern != Some(LinePattern::Dashed) {
            open.push(Call {
                id: &e.id,
                caller: &e.from,
                callee: &e.to,
                y,
            });
            called.push(&e.to);
            colors.insert(e.id.clone(), calls);
            calls += 1;
        }
    }
    for c in &open {
        let last = seen.get(c.callee).map_or(c.y, |s| s.1);
        spans.entry(c.callee).or_default().push((
            c.y,
            (c.y + 30.0).max(last + 16.0),
            Some(c.id.to_string()),
        ));
    }

    let mut out = HashMap::new();
    for l in nodes.iter().filter(|n| n.kind == NodeKind::Lifeline) {
        let mut own = spans.remove(l.id.as_str()).unwrap_or_default();
        if let Some(&(first, last)) = seen.get(l.id.as_str()) {
            // Active by itself: from its first message when nobody calls it, else from
            // the first message it sends outside the bars of its calls
            let start = if !called.contains(&l.id.as_str()) {
                Some(first)
            } else {
                sends.get(l.id.as_str()).and_then(|ys| {
                    ys.iter()
                        .copied()
                        .find(|&y| !own.iter().any(|(a, b, _)| y >= *a && y <= *b))
                })
            };
            if let Some(start) = start {
                own.push((start - 10.0, (l.y + l.h - BASE_END).max(last + 10.0), None));
            }
        }
        // Within the lifeline, below its head
        let (top, bottom) = (l.y + LIFELINE_HEAD, l.y + l.h);
        let own: Vec<Own> = own
            .into_iter()
            .map(|(a, b, call)| (a.max(top), b.min(bottom), call))
            .filter(|(a, b, _)| b > a)
            .collect();
        if !own.is_empty() {
            out.insert(l.id.clone(), levels(own));
        }
    }
    Sequence {
        bars: out,
        returns,
        colors,
    }
}

/// Top to bottom, each bar on the lowest level that is free where it starts: a bar
/// that starts inside another lies on top of it. Of two that start together, the
/// longer is underneath.
fn levels(mut spans: Vec<Own>) -> Vec<Bar> {
    spans.sort_by(|p, q| p.0.total_cmp(&q.0).then(q.1.total_cmp(&p.1)));
    let mut out: Vec<Bar> = vec![];
    for (a, b, call) in spans {
        let taken: Vec<u32> = out
            .iter()
            .filter(|bar| bar.1 > a)
            .map(|bar| bar.2)
            .collect();
        let level = (0..).find(|l| !taken.contains(l)).unwrap_or(0);
        out.push((a, b, level, call));
    }
    out
}

/// Where a message meets node `n` at height `y`, coming from the side of `toward_x`.
fn attach_x(n: &Node, bars: &[Bar], y: f64, toward_x: f64) -> f64 {
    let c = n.x + n.w / 2.0;
    let right = toward_x >= c;
    if n.kind == NodeKind::Lifeline {
        // The top bar that is active there
        let Some(level) = bars
            .iter()
            .filter(|bar| y >= bar.0 && y <= bar.1)
            .map(|bar| bar.2)
            .max()
        else {
            return c;
        };
        let x = c + f64::from(level) * NEST;
        return if right {
            x + BAR_W / 2.0
        } else {
            x - BAR_W / 2.0
        };
    }
    if right { n.x + n.w } else { n.x }
}

/// The line of a message: horizontal from a to b, or a small loop when a calls itself.
fn message_line(edge: &Edge, a: &Node, b: &Node, bars: &HashMap<String, Vec<Bar>>) -> Geom {
    let y = a.y + edge.message_y.unwrap_or(0.0);
    let none = vec![];
    let bars_a = bars.get(&a.id).unwrap_or(&none);
    if a.id == b.id {
        let x1 = attach_x(a, bars_a, y, f64::INFINITY);
        let x2 = attach_x(a, bars_a, y + SELF_H, f64::INFINITY);
        let out = x1.max(x2) + SELF_W;
        let r = 6.0;
        return Geom {
            d: format!(
                "M {x1} {y} L {} {y} Q {out} {y}, {out} {} L {out} {} Q {out} {}, {} {} L {x2} {}",
                out - r,
                y + r,
                y + SELF_H - r,
                y + SELF_H,
                out - r,
                y + SELF_H,
                y + SELF_H
            ),
            points: vec![pt(x1, y), pt(out, y), pt(out, y + SELF_H), pt(x2, y + SELF_H)],
        };
    }
    let (ca, cb) = (a.x + a.w / 2.0, b.x + b.w / 2.0);
    let p1 = pt(attach_x(a, bars_a, y, cb), y);
    let p2 = pt(attach_x(b, bars.get(&b.id).unwrap_or(&none), y, ca), y);
    Geom {
        d: format!("M {} {} L {} {}", p1.x, p1.y, p2.x, p2.y),
        points: vec![p1, p2],
    }
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

/// A line with its ends, in `stroke` (EDGE, or a call's color).
fn edge_svg(edge: &Edge, g: &Geom, stroke: &str) -> String {
    let dash = match edge.pattern.unwrap_or(LinePattern::Solid) {
        LinePattern::Solid => r#" stroke-width="1.75""#,
        LinePattern::Dashed => r#" stroke-width="1.75" stroke-dasharray="8 6""#,
        LinePattern::Dotted => r#" stroke-width="2.5" stroke-dasharray="0 6""#,
    };
    let mut s = format!(
        r#"<path d="{}" fill="none" stroke="{stroke}" stroke-linecap="round"{dash}/>"#,
        g.d
    );
    s.push_str(&cap_svg(
        edge.start_cap.unwrap_or(EdgeCap::None),
        &g.points,
        true,
        stroke,
    ));
    s.push_str(&cap_svg(
        edge.end_cap.unwrap_or(EdgeCap::Arrow),
        &g.points,
        false,
        stroke,
    ));
    s.push('\n');
    s
}

/// Arrowhead, diamond or dot at one end, pointing out of the line (as `Cap` in Edges.tsx).
fn cap_svg(cap: EdgeCap, points: &[Pt], at_start: bool, stroke: &str) -> String {
    let (tip, angle) = line_end(points, at_start);
    let shape = match cap {
        EdgeCap::None => return String::new(),
        EdgeCap::Arrow => format!(r#"<path d="M -10 -5 L 0 0 L -10 5 z" fill="{stroke}"/>"#),
        EdgeCap::Open => format!(
            r#"<path d="M -11 -6 L 0 0 L -11 6" fill="none" stroke="{stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>"#
        ),
        EdgeCap::Triangle => format!(
            r#"<path d="M -13 -7.5 L 0 0 L -13 7.5 z" fill="{BG}" stroke="{stroke}" stroke-width="1.75" stroke-linejoin="round"/>"#
        ),
        EdgeCap::Diamond => {
            format!(r#"<path d="M 0 0 L -9 -5.5 L -18 0 L -9 5.5 z" fill="{stroke}"/>"#)
        }
        EdgeCap::HollowDiamond => format!(
            r#"<path d="M 0 0 L -9 -5.5 L -18 0 L -9 5.5 z" fill="{BG}" stroke="{stroke}" stroke-width="1.75" stroke-linejoin="round"/>"#
        ),
        EdgeCap::Dot => format!(r#"<circle cx="-4" cy="0" r="3.5" fill="{stroke}"/>"#),
    };
    format!(
        r#"<g transform="translate({} {}) rotate({angle})">{shape}</g>"#,
        tip.x, tip.y
    )
}

/// The label (on, above or below the line) and the texts at both ends.
fn edge_labels_svg(edge: &Edge, g: &Geom) -> String {
    let mut s = String::new();
    if let Some(label) = edge.label.as_deref().filter(|l| !l.trim().is_empty()) {
        let (p, horizontal) = point_along(&g.points, edge.label_pos.unwrap_or(0.5));
        let lw = text_width(label, 12.5) + 16.0;
        let side = edge.label_side.unwrap_or(LabelSide::On);
        // Center of the label, moved off the line like `sideOffset` in Edges.tsx
        let (cx, cy) = match (side, horizontal) {
            (LabelSide::On, _) => (p.x, p.y),
            (LabelSide::Above, true) => (p.x, p.y - 14.0),
            (LabelSide::Below, true) => (p.x, p.y + 14.0),
            (LabelSide::Above, false) => (p.x - 6.0 - lw / 2.0, p.y),
            (LabelSide::Below, false) => (p.x + 6.0 + lw / 2.0, p.y),
        };
        if side == LabelSide::On {
            s.push_str(&format!(
                r#"<rect x="{}" y="{}" width="{lw}" height="20" rx="6" fill="{BG}"/>"#,
                cx - lw / 2.0,
                cy - 10.0
            ));
        }
        s.push_str(&text(cx, cy + 4.5, "middle", 12.5, 600, MUTED, label));
    }
    for (value, at_start) in [(&edge.start_label, true), (&edge.end_label, false)] {
        if let Some(value) = value.as_deref().filter(|v| !v.trim().is_empty()) {
            let p = end_label_point(&g.points, at_start);
            s.push_str(&text(p.x, p.y + 4.0, "middle", 12.0, 600, MUTED, value));
        }
    }
    if !s.is_empty() {
        s.push('\n');
    }
    s
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

fn node_svg(n: &Node, seq: &Sequence, paint: bool) -> String {
    let (fill, stroke) = colors(n.color);
    let dot = dot_color(n.color);
    let (x, y, w, h) = (n.x, n.y, n.w, n.h);
    let (cx, cy) = (x + w / 2.0, y + h / 2.0);
    let border = format!(r#"fill="{fill}" stroke="{stroke}" stroke-width="1.5""#);
    let rect = |rx: f64| format!(r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" {border}/>"#);
    // Text centered in the node, wrapped to `inner` pixels
    let centered = |inner: f64| centered_text(&n.text, cx, cy, inner, FONT_SIZE, 550);

    let out = match n.kind {
        NodeKind::Box => rect(10.0) + &centered(w - 24.0),
        NodeKind::Pill => rect(h / 2.0) + &centered(w - 36.0),
        NodeKind::Object | NodeKind::Activation => rect(2.0) + &centered(w - 24.0),
        NodeKind::Pin => rect(1.0),
        NodeKind::Diamond => {
            format!(
                r#"<polygon points="{cx},{y} {},{cy} {cx},{} {x},{cy}" {border} stroke-linejoin="round"/>"#,
                x + w,
                y + h
            ) + &centered(w * 0.6)
        }
        NodeKind::SendSignal | NodeKind::ReceiveSignal => {
            let points = if n.kind == NodeKind::SendSignal {
                [(0.0, 0.0), (0.86, 0.0), (1.0, 0.5), (0.86, 1.0), (0.0, 1.0)]
            } else {
                [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.14, 0.5)]
            };
            let points: Vec<String> = points
                .iter()
                .map(|(px, py)| format!("{},{}", x + px * w, y + py * h))
                .collect();
            format!(r#"<polygon points="{}" {border} stroke-linejoin="round"/>"#, points.join(" "))
                + &centered(w * 0.7)
        }
        NodeKind::Note => {
            format!(
                r##"<rect x="{}" y="{}" width="{w}" height="{h}" rx="3" fill="#000000" opacity="0.06"/><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{fill}"/>"##,
                x + 2.0,
                y + 3.0
            ) + &left_text(&n.text, x + 16.0, y + 14.0, w - 32.0, FONT_SIZE, 450, TEXT, FONT)
        }
        NodeKind::Comment => {
            let (r, b) = (x + w, y + h);
            format!(
                r#"<path d="M {x} {y} H {} L {r} {} V {b} H {x} Z" {border} stroke-linejoin="round"/><path d="M {} {y} V {} H {r}" fill="none" stroke="{stroke}" stroke-width="1.5"/>"#,
                r - 14.0,
                y + 14.0,
                r - 14.0,
                y + 14.0
            ) + &left_text(&n.text, x + 12.0, y + 10.0, w - 32.0, FONT_SIZE, 450, TEXT, FONT)
        }
        NodeKind::Label => centered_text(&n.text, cx, cy, w - 16.0, 16.0, 650),
        NodeKind::Start => format!(r#"<circle cx="{cx}" cy="{cy}" r="{}" fill="{dot}"/>"#, w.min(h) / 2.0),
        NodeKind::End => {
            let r = w.min(h) / 2.0;
            format!(
                r#"<circle cx="{cx}" cy="{cy}" r="{}" fill="{BG}" stroke="{dot}" stroke-width="2.5"/><circle cx="{cx}" cy="{cy}" r="{}" fill="{dot}"/>"#,
                r - 1.25,
                (r - 5.0).max(1.0)
            )
        }
        NodeKind::FlowFinal => {
            let r = w.min(h) / 2.0 - 1.0;
            let k = r * 0.65;
            format!(
                r#"<circle cx="{cx}" cy="{cy}" r="{r}" fill="{fill}" stroke="{dot}" stroke-width="2"/><path d="M {} {} L {} {} M {} {} L {} {}" stroke="{dot}" stroke-width="2"/>"#,
                cx - k, cy - k, cx + k, cy + k, cx + k, cy - k, cx - k, cy + k
            )
        }
        NodeKind::Destroy => format!(
            r#"<path d="M {x} {y} L {} {} M {} {y} L {x} {}" stroke="{dot}" stroke-width="2.5"/>"#,
            x + w,
            y + h,
            x + w,
            y + h
        ),
        NodeKind::Bar => {
            format!(r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" fill="{dot}"/>"#)
        }
        // The picture itself is on the server: its frame, with its name
        NodeKind::Image => {
            format!(
                r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="1.5" stroke-dasharray="6 4"/>"#
            ) + &centered_text(&format!("Image: {}", n.text), cx, cy, w - 16.0, 13.0, 500)
        }
        NodeKind::Icon => icon_svg(n, dot),
        NodeKind::Topic => rect(h / 2.0) + &centered(w - 28.0),
        NodeKind::Circle => {
            format!(r#"<ellipse cx="{cx}" cy="{cy}" rx="{}" ry="{}" {border}/>"#, w / 2.0, h / 2.0)
                + &centered(w - 4.0)
        }
        NodeKind::UseCase => {
            format!(r#"<ellipse cx="{cx}" cy="{cy}" rx="{}" ry="{}" {border}/>"#, w / 2.0, h / 2.0)
                + &centered(w * 0.75)
        }
        NodeKind::Actor | NodeKind::TimeEvent => figure_svg(n, fill),
        NodeKind::Class => class_svg(n, &border, stroke),
        NodeKind::Lifeline => {
            let line = if n.color == NodeColor::White {
                EDGE
            } else {
                stroke
            };
            let bar_fill = if n.color == NodeColor::White {
                BG
            } else {
                fill
            };
            let activation: String = seq
                .bars
                .get(&n.id)
                .into_iter()
                .flatten()
                .map(|(top, bottom, level, call)| {
                    // A call's own colors, when the board colors them
                    let (fill, line) = seq.color(paint, call.as_deref()).map_or((bar_fill, line), colors);
                    format!(
                        r#"<rect x="{}" y="{top}" width="{BAR_W}" height="{}" rx="1" fill="{fill}" stroke="{line}" stroke-width="1.5"/>"#,
                        cx - BAR_W / 2.0 + f64::from(*level) * NEST,
                        bottom - top
                    )
                })
                .collect();
            format!(
                r#"<path d="M {cx} {} V {}" stroke="{line}" stroke-width="1.5" stroke-dasharray="5 4"/>{activation}<rect x="{x}" y="{y}" width="{w}" height="{LIFELINE_HEAD}" rx="2" {border}/>"#,
                y + LIFELINE_HEAD,
                y + h
            ) + &centered_text(&n.text, cx, y + LIFELINE_HEAD / 2.0, w - 20.0, FONT_SIZE, 550)
        }
        NodeKind::Section | NodeKind::Lanes | NodeKind::Boundary | NodeKind::Package | NodeKind::Fragment => {
            frame_svg(n, fill, stroke)
        }
    };
    out + "\n"
}

/// Stick figure or hourglass in the top part, the name below.
/// An icon: its shapes (24×24) stretched over the node, drawn as lines. Only plain
/// shapes and their geometry are written, whatever else the board may hold.
fn icon_svg(n: &Node, color: &str) -> String {
    const TAGS: [&str; 7] = [
        "path", "circle", "rect", "line", "polyline", "polygon", "ellipse",
    ];
    const ATTRS: [&str; 14] = [
        "d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2",
    ];
    let mut parts = String::new();
    for (tag, attrs) in n.icon.iter().flatten() {
        if !TAGS.contains(&tag.as_str()) {
            continue;
        }
        parts.push('<');
        parts.push_str(tag);
        for (k, v) in attrs {
            if ATTRS.contains(&k.as_str()) || k == "points" {
                parts.push_str(&format!(r#" {k}="{}""#, xml_escape(v)));
            }
        }
        parts.push_str("/>");
    }
    let s = (n.w / 24.0).min(n.h / 24.0);
    let (ox, oy) = (n.x + (n.w - 24.0 * s) / 2.0, n.y + (n.h - 24.0 * s) / 2.0);
    format!(
        r#"<g transform="translate({ox} {oy}) scale({s})" fill="none" stroke="{color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke">{parts}</g>"#
    )
}

fn figure_svg(n: &Node, fill: &str) -> String {
    let (x, y, w, h) = (n.x, n.y, n.w, n.h);
    // Fit the drawing (viewBox 40×64 or 40×40) in the area above the caption
    let (vw, vh) = if n.kind == NodeKind::Actor { (40.0, 64.0) } else { (40.0, 40.0) };
    let area_h = (h - 22.0).max(1.0);
    let k = (w / vw).min(area_h / vh);
    let (ox, oy) = (x + (w - vw * k) / 2.0, y + (area_h - vh * k) / 2.0);
    let drawing = if n.kind == NodeKind::Actor {
        format!(
            r#"<circle cx="20" cy="9" r="7" fill="{fill}"/><path d="M 20 16 V 40 M 5 25 H 35 M 20 40 L 8 62 M 20 40 L 32 62" fill="none" stroke-linecap="round"/>"#
        )
    } else {
        format!(r#"<path d="M 6 2 H 34 L 6 38 H 34 Z" fill="{fill}" stroke-linejoin="round"/>"#)
    };
    format!(
        r#"<g transform="translate({ox} {oy}) scale({k})" stroke="{EDGE}" stroke-width="{}">{drawing}</g>"#,
        1.75 / k
    ) + &text(x + w / 2.0, y + h - 5.0, "middle", 13.0, 550, TEXT, &n.text)
}

/// Class box: the name, then attributes and operations, split on lines that are just `--`.
fn class_svg(n: &Node, border: &str, stroke: &str) -> String {
    let (x, y, w, h) = (n.x, n.y, n.w, n.h);
    let mut parts: Vec<Vec<&str>> = vec![vec![]];
    for line in n.text.split('\n') {
        if line.trim() == "--" {
            parts.push(vec![]);
        } else {
            parts.last_mut().unwrap().push(line);
        }
    }

    let mut s = format!(r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" {border}/>"#);
    let mut top = y;
    for (i, lines) in parts.iter().enumerate() {
        if i > 0 {
            s.push_str(&format!(
                r#"<path d="M {x} {top} H {}" stroke="{stroke}" stroke-width="1.5"/>"#,
                x + w
            ));
        }
        let (pad, line_h) = if i == 0 { (7.0, LINE_H) } else { (5.0, 18.0) };
        for (j, line) in lines.iter().enumerate() {
            let baseline = top + pad + j as f64 * line_h + 13.0;
            s.push_str(&if i == 0 {
                text(x + w / 2.0, baseline, "middle", FONT_SIZE, 650, TEXT, line)
            } else {
                styled_text(x + 10.0, baseline, "start", 12.5, 450, TEXT, MONO, line)
            });
        }
        top += pad * 2.0 + lines.len().max(1) as f64 * line_h;
    }
    s
}

/// Sections, swimlanes, system boundaries, packages and fragments.
fn frame_svg(n: &Node, fill: &str, stroke: &str) -> String {
    let (x, y, w, h) = (n.x, n.y, n.w, n.h);
    // Frames are see-through, like in the app
    let opacity = if n.color == NodeColor::White { 0.45 } else { 0.55 };
    let body = |rx: f64, extra: &str| {
        format!(
            r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" stroke-width="1.5"{extra}/>"#
        )
    };
    let title = if n.text.is_empty() { None } else { Some(n.text.as_str()) };

    match n.kind {
        NodeKind::Section => {
            let mut s = body(14.0, r#" stroke-dasharray="6 4""#);
            if let Some(t) = title {
                let tw = text_width(t, 13.0) + 20.0;
                s.push_str(&format!(
                    r#"<rect x="{}" y="{}" width="{tw}" height="24" rx="7" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>"#,
                    x + 12.0,
                    y + 10.0
                ));
                s.push_str(&text(x + 22.0, y + 26.5, "start", 13.0, 650, TEXT, t));
            }
            s
        }
        NodeKind::Boundary => {
            body(2.0, "") + &title.map_or(String::new(), |t| text(x + w / 2.0, y + 22.0, "middle", FONT_SIZE, 650, TEXT, t))
        }
        NodeKind::Package => {
            let tw = title.map_or(60.0, |t| text_width(t, 13.0) + 20.0);
            format!(
                r#"<rect x="{x}" y="{}" width="{tw}" height="28" rx="3" fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>"#,
                y - 27.0
            ) + &body(2.0, "")
                + &title.map_or(String::new(), |t| text(x + 10.0, y - 8.5, "start", 13.0, 650, TEXT, t))
        }
        NodeKind::Fragment => {
            let tw = title.map_or(40.0, |t| text_width(t, FONT_SIZE) + 32.0);
            let th = 26.0;
            body(2.0, "")
                + &format!(
                    r#"<polygon points="{x},{y} {},{y} {},{} {},{} {x},{}" fill="{fill}" stroke="{stroke}" stroke-width="1.5" stroke-linejoin="round"/>"#,
                    x + tw,
                    x + tw,
                    y + th * 0.6,
                    x + tw * 0.82,
                    y + th,
                    y + th
                )
                + &title.map_or(String::new(), |t| text(x + 10.0, y + 18.0, "start", FONT_SIZE, 700, TEXT, t))
        }
        NodeKind::Lanes => {
            let mut s = body(6.0, "");
            // Pool header across the top, then a header per lane below it
            s.push_str(&format!(
                r#"<path d="M {x} {} H {}" stroke="{stroke}" stroke-width="1.5"/><path d="M {x} {} H {}" stroke="{stroke}" stroke-opacity="0.6" stroke-width="1"/>"#,
                y + LANE_HEADER,
                x + w,
                y + LANE_HEADER * 2.0,
                x + w
            ));
            if let Some(t) = title {
                s.push_str(&text(x + w / 2.0, y + 22.0, "middle", FONT_SIZE, 650, TEXT, t));
            }
            let mut left = x;
            for (i, lane) in n.lanes.iter().flatten().enumerate() {
                if i > 0 {
                    s.push_str(&format!(
                        r#"<path d="M {left} {} V {}" stroke="{stroke}" stroke-width="1.5"/>"#,
                        y + LANE_HEADER,
                        y + h
                    ));
                }
                let (name, color) = if lane.title.is_empty() { ("Lane", "#b4b3ba") } else { (lane.title.as_str(), MUTED) };
                s.push_str(&text(left + lane.size / 2.0, y + LANE_HEADER + 21.5, "middle", 12.5, 650, color, name));
                left += lane.size;
            }
            s
        }
        _ => unreachable!("only frames"),
    }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

fn text(x: f64, y: f64, anchor: &str, size: f64, weight: u32, color: &str, s: &str) -> String {
    styled_text(x, y, anchor, size, weight, color, FONT, s)
}

#[allow(clippy::too_many_arguments)]
fn styled_text(x: f64, y: f64, anchor: &str, size: f64, weight: u32, color: &str, font: &str, s: &str) -> String {
    format!(
        r#"<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}" font-weight="{weight}" font-family="{font}" fill="{color}" xml:space="preserve">{}</text>"#,
        xml_escape(s)
    )
}

/// Wrapped lines, vertically centered on (cx, cy).
fn centered_text(s: &str, cx: f64, cy: f64, max: f64, size: f64, weight: u32) -> String {
    let lines = wrap(s, max, size);
    let line_h = size * LINE_H / FONT_SIZE;
    let first = cy - (lines.len() as f64 - 1.0) * line_h / 2.0 + size * 0.35;
    lines
        .iter()
        .enumerate()
        .map(|(i, l)| text(cx, first + i as f64 * line_h, "middle", size, weight, TEXT, l))
        .collect()
}

/// Wrapped lines from the top-left corner (x, top).
#[allow(clippy::too_many_arguments)]
fn left_text(s: &str, x: f64, top: f64, max: f64, size: f64, weight: u32, color: &str, font: &str) -> String {
    let line_h = size * LINE_H / FONT_SIZE;
    wrap(s, max, size)
        .iter()
        .enumerate()
        .map(|(i, l)| styled_text(x, top + size + i as f64 * line_h, "start", size, weight, color, font, l))
        .collect()
}

/// Rough text width estimate: ~0.55 × font size per character. Measuring
/// exactly would require loading the font.
fn text_width(s: &str, size: f64) -> f64 {
    s.chars().count() as f64 * size * 0.55
}

/// Wraps text into lines that fit within `max` pixels. Existing line breaks are kept.
fn wrap(text: &str, max: f64, size: f64) -> Vec<String> {
    if text.is_empty() {
        return vec![];
    }
    let mut lines = vec![];
    for paragraph in text.split('\n') {
        let mut line = String::new();
        for word in paragraph.split_whitespace() {
            let candidate = if line.is_empty() {
                word.to_string()
            } else {
                format!("{line} {word}")
            };
            if text_width(&candidate, size) > max && !line.is_empty() {
                lines.push(std::mem::take(&mut line)); // moves the string out, leaving an empty one
                line = word.to_string();
            } else {
                line = candidate;
            }
        }
        lines.push(line);
    }
    lines
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(kind: NodeKind) -> Shape {
        Shape { x: 0.0, y: 0.0, w: 200.0, h: 100.0, kind: Some(kind) }
    }

    #[test]
    fn ports_follow_the_outline() {
        let close = |a: Pt, b: Pt| (a.x - b.x).abs() < 1e-6 && (a.y - b.y).abs() < 1e-6;
        // Box: sides and corners
        assert!(close(port_at(&shape(NodeKind::Box), 0.0).p, pt(200.0, 50.0)));
        assert!(close(port_at(&shape(NodeKind::Box), 45.0).p, pt(200.0, 100.0)));
        assert!(close(port_at(&shape(NodeKind::Box), 270.0).p, pt(100.0, 0.0)));
        // Diamond: halfway along the edge between two tips
        assert!(close(port_at(&shape(NodeKind::Diamond), 45.0).p, pt(150.0, 75.0)));
        // Lifeline: on the dashed line, below the head
        let lifeline = Shape { h: 400.0, ..shape(NodeKind::Lifeline) };
        assert!(close(port_at(&lifeline, 10.0).p, pt(100.0, 200.0 + 100.0 * 10f64.to_radians().tan() * 2.0)));
    }

    /// Every kind of node and edge, as the frontend saves it.
    const ALL_KINDS: &str = r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 },
      "nodes": [
        { "id": "st", "kind": "start", "x": 20, "y": 20, "w": 40, "h": 40, "text": "", "color": "white" },
        { "id": "fork", "kind": "bar", "x": 0, "y": 100, "w": 160, "h": 8, "text": "", "color": "white" },
        { "id": "o", "kind": "object", "x": 200, "y": 60, "w": 140, "h": 50, "text": "Order", "color": "white" },
        { "id": "pin", "kind": "pin", "x": 333, "y": 78, "w": 14, "h": 14, "text": "", "color": "white" },
        { "id": "ss", "kind": "sendsignal", "x": 0, "y": 160, "w": 160, "h": 50, "text": "Notify", "color": "yellow" },
        { "id": "rs", "kind": "receivesignal", "x": 200, "y": 160, "w": 160, "h": 50, "text": "Paid", "color": "green" },
        { "id": "te", "kind": "timeevent", "x": 400, "y": 40, "w": 60, "h": 80, "text": "1 day", "color": "white" },
        { "id": "ci", "kind": "circle", "x": 420, "y": 160, "w": 40, "h": 40, "text": "H*", "color": "white" },
        { "id": "ff", "kind": "flowfinal", "x": 520, "y": 60, "w": 40, "h": 40, "text": "", "color": "white" },
        { "id": "en", "kind": "end", "x": 520, "y": 160, "w": 40, "h": 40, "text": "", "color": "white" },
        { "id": "cm", "kind": "comment", "x": 600, "y": 30, "w": 180, "h": 80, "text": "Only for new customers", "color": "white" },
        { "id": "nt", "kind": "note", "x": 820, "y": 30, "w": 160, "h": 100, "text": "Sticky note", "color": "yellow" },
        { "id": "lb", "kind": "label", "x": 820, "y": 160, "w": 160, "h": 40, "text": "Free label", "color": "white" },
        { "id": "bx", "kind": "box", "x": 600, "y": 160, "w": 160, "h": 60, "text": "Box", "color": "blue" },
        { "id": "di", "kind": "diamond", "x": 1000, "y": 20, "w": 160, "h": 100, "text": "Decide?", "color": "blue" },
        { "id": "pi", "kind": "pill", "x": 1000, "y": 160, "w": 160, "h": 60, "text": "Pill", "color": "green" },
        { "id": "bd", "kind": "boundary", "x": 0, "y": 280, "w": 480, "h": 260, "text": "Webshop", "color": "white" },
        { "id": "ac", "kind": "actor", "x": -110, "y": 360, "w": 60, "h": 100, "text": "Customer", "color": "white" },
        { "id": "uc1", "kind": "usecase", "x": 60, "y": 340, "w": 180, "h": 70, "text": "Place order", "color": "white" },
        { "id": "uc2", "kind": "usecase", "x": 260, "y": 440, "w": 180, "h": 70, "text": "Log in", "color": "white" },
        { "id": "pk", "kind": "package", "x": 560, "y": 300, "w": 520, "h": 260, "text": "shop.domain", "color": "white" },
        { "id": "c1", "kind": "class", "x": 600, "y": 340, "w": 200, "h": 140, "text": "«interface»\nPayable\n--\n--\n+ pay(): void", "color": "white" },
        { "id": "c2", "kind": "class", "x": 860, "y": 340, "w": 200, "h": 160, "text": "Order\n--\n- id: UUID\n- total: Money\n--\n+ pay(): void", "color": "white" },
        { "id": "ll1", "kind": "lifeline", "x": 0, "y": 620, "w": 140, "h": 300, "text": ":Client", "color": "white" },
        { "id": "ll2", "kind": "lifeline", "x": 260, "y": 620, "w": 140, "h": 300, "text": ":Server", "color": "white" },
        { "id": "act", "kind": "activation", "x": 322, "y": 700, "w": 16, "h": 120, "text": "", "color": "white" },
        { "id": "fr", "kind": "fragment", "x": -20, "y": 760, "w": 460, "h": 120, "text": "loop", "color": "white" },
        { "id": "ds", "kind": "destroy", "x": 315, "y": 890, "w": 30, "h": 30, "text": "", "color": "white" },
        { "id": "sec", "kind": "section", "x": 560, "y": 620, "w": 300, "h": 200, "text": "Section", "color": "purple" },
        { "id": "pool", "kind": "lanes", "x": 900, "y": 620, "w": 400, "h": 300, "text": "Pool", "color": "white",
          "lanes": [ { "id": "l1", "title": "Customer", "size": 200 }, { "id": "l2", "title": "", "size": 200 } ] }
      ],
      "edges": [
        { "id": "r1", "from": "ac", "to": "uc1", "endCap": "none" },
        { "id": "r2", "from": "uc1", "to": "uc2", "pattern": "dashed", "endCap": "open", "label": "«include»" },
        { "id": "r3", "from": "c2", "to": "c1", "pattern": "dashed", "endCap": "triangle" },
        { "id": "r4", "from": "c1", "to": "cm", "pattern": "dotted", "endCap": "none" },
        { "id": "r5", "from": "c2", "to": "pi", "startCap": "diamond", "endCap": "hollowDiamond", "style": "elbow",
          "startLabel": "1", "endLabel": "0..*", "label": "has", "labelSide": "above" },
        { "id": "r6", "from": "st", "to": "o", "startCap": "dot", "style": "straight", "fromAngle": 0, "toAngle": 180 },
        { "id": "m1", "from": "ll1", "to": "ll2", "messageY": 80, "label": "request()", "labelSide": "above" },
        { "id": "m2", "from": "ll2", "to": "ll2", "messageY": 110, "label": "check()", "labelSide": "above" },
        { "id": "m3", "from": "ll2", "to": "ll1", "messageY": 200, "pattern": "dashed", "endCap": "open", "label": "reply", "labelSide": "above" },
        { "id": "d1", "from": "di", "to": "pi", "style": "elbow", "label": "Yes", "labelPos": 0.3 },
        { "id": "b1", "from": "bx", "to": "lb", "bend": { "x": 0, "y": 60 } },
        { "id": "b2", "from": "en", "to": "bx", "style": "elbow", "bend": { "x": 0, "y": 50 } },
        { "id": "f1", "from": "", "to": "", "fromPoint": { "x": 1200, "y": 300 }, "toPoint": { "x": 1350, "y": 420 }, "style": "straight", "label": "free" },
        { "id": "f2", "from": "", "to": "pi", "fromPoint": { "x": 1350, "y": 100 }, "pattern": "dashed" }
      ] }"#;

    #[test]
    fn every_kind_renders() {
        let flow: FlowDoc = serde_json::from_str(ALL_KINDS).expect("valid flow");
        let svg = to_svg(&flow);
        // resvg parses it, so the markup is valid
        let tree = resvg::usvg::Tree::from_str(&svg, &resvg::usvg::Options::default());
        assert!(tree.is_ok(), "{:?}", tree.err());
        assert!(svg.contains("0..*") && svg.contains("«include»"));
    }

    /// Writes the example to the temp dir to look at: `cargo test render_all_kinds -- --ignored`
    #[test]
    #[ignore]
    fn render_all_kinds() {
        let flow: FlowDoc = serde_json::from_str(ALL_KINDS).unwrap();
        std::fs::write(std::env::temp_dir().join("flow-all-kinds.svg"), to_svg(&flow)).unwrap();
    }

    /// A solid arrow back to the caller is its return: the caller keeps its
    /// full-length bar, and the callee is active from the call to the return.
    /// With "Color calls" on, a call, its bar and its return share a color; off, all is plain.
    #[test]
    fn call_colors() {
        let json = r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 },
          "nodes": [
            { "id": "a", "kind": "lifeline", "x": 0, "y": 0, "w": 140, "h": 500, "text": "", "color": "white" },
            { "id": "b", "kind": "lifeline", "x": 300, "y": 0, "w": 140, "h": 500, "text": "", "color": "white" }
          ],
          "edges": [
            { "id": "call", "from": "a", "to": "b", "messageY": 100 },
            { "id": "back", "from": "b", "to": "a", "messageY": 200, "pattern": "dashed" }
          ] }"#;
        let mut flow: FlowDoc = serde_json::from_str(json).unwrap();
        let (fill, stroke) = colors(CALL_COLORS[0]);
        let plain = to_svg(&flow);
        assert!(!plain.contains(stroke) && !plain.contains(fill));
        flow.call_colors = Some(true);
        let colored = to_svg(&flow);
        // The lines of the call and its return, and the bar's border
        assert_eq!(
            colored.matches(&format!(r#"stroke="{stroke}""#)).count(),
            3,
            "{colored}"
        );
        // Their two (filled) arrowheads
        assert_eq!(colored.matches(&format!(r#"fill="{stroke}""#)).count(), 2);
        // The bar
        assert_eq!(colored.matches(&format!(r#"fill="{fill}""#)).count(), 1);
    }

    #[test]
    fn solid_return_ends_the_call() {
        let json = r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 },
          "nodes": [
            { "id": "a", "kind": "lifeline", "x": 0, "y": 0, "w": 140, "h": 500, "text": "", "color": "white" },
            { "id": "b", "kind": "lifeline", "x": 300, "y": 0, "w": 140, "h": 500, "text": "", "color": "white" }
          ],
          "edges": [
            { "id": "call", "from": "a", "to": "b", "messageY": 100 },
            { "id": "back", "from": "b", "to": "a", "messageY": 200 }
          ] }"#;
        let flow: FlowDoc = serde_json::from_str(json).unwrap();
        let bars = activations(&flow.nodes, &flow.edges);
        assert_eq!(bars["a"], vec![(90.0, 500.0 - BASE_END, 0, None)]);
        assert_eq!(bars["b"], vec![(100.0, 200.0, 0, Some("call".to_string()))]);
    }

    /// The same cases as src/lib/sequence.test.ts, so the app and the export agree.
    #[test]
    fn sequence_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/sequence.json")).unwrap();
        for case in fixture["cases"].as_array().unwrap() {
            let flow: FlowDoc = serde_json::from_value(serde_json::json!({
                "camera": { "x": 0, "y": 0, "zoom": 1 }, "nodes": case["nodes"], "edges": case["edges"]
            }))
            .unwrap();
            let seq = analyze(&flow.nodes, &flow.edges);
            let expected: HashMap<String, Vec<Bar>> =
                serde_json::from_value(case["bars"].clone()).unwrap();
            assert_eq!(seq.bars, expected, "{}", case["name"]);
            let colors: HashMap<String, usize> =
                serde_json::from_value(case["colors"].clone()).unwrap();
            assert_eq!(seq.colors, colors, "{}", case["name"]);
        }
    }

    /// The same cases as src/lib/geometry.test.ts.
    #[test]
    fn routing_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../fixtures/routing.json")).unwrap();
        let p = |v: &serde_json::Value| pt(v["x"].as_f64().unwrap(), v["y"].as_f64().unwrap());
        for case in fixture["cases"].as_array().unwrap() {
            let obstacles: Vec<Shape> = case["obstacles"]
                .as_array()
                .unwrap()
                .iter()
                .map(|o| Shape { x: o["x"].as_f64().unwrap(), y: o["y"].as_f64().unwrap(), w: o["w"].as_f64().unwrap(), h: o["h"].as_f64().unwrap(), kind: None })
                .collect();
            let g = route(p(&case["p1"]), p(&case["n1"]), p(&case["p2"]), p(&case["n2"]), &obstacles);
            let expected: Vec<Pt> = case["points"].as_array().unwrap().iter().map(p).collect();
            assert_eq!(g.points, expected, "{}", case["name"]);
        }
    }

    #[test]
    fn elbow_is_orthogonal() {
        let g = elbow(pt(0.0, 0.0), pt(1.0, 0.0), pt(100.0, 80.0), pt(-1.0, 0.0));
        for w in g.points.windows(2) {
            assert!(w[0].x == w[1].x || w[0].y == w[1].y, "diagonal segment {w:?}");
        }
        assert_eq!(g.points.len(), 4); // a Z: out, down, in
    }
}
