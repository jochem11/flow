//! Arrange (auto-layout) of a flowchart.
//!
//! Sections and other frames are laid out from the inside out: what is in a frame
//! is arranged on its own, the frame is fitted around it, and then the frame is
//! one block among the others around it. Lines between a block in a frame and
//! one outside count, for the outer arrangement, as lines to the frame.
//!
//! On each level, separate flows are laid out side by side, each as layers top to
//! bottom (a simplified Sugiyama: break loops, layers by longest path, invisible
//! stand-ins where lines skip layers, order against crossings, place). Mind maps
//! (topics only) become a tree to the right. Blocks without lines keep their
//! rows, packed without overlap. In a swimlane every block stays in its lane.
//!
//! Notes, labels, comments, pictures and pins move along with the block they
//! belong to (the one they are joined to, or sit next to). Sequence diagrams and
//! locked items stay where they are.

use std::collections::{HashMap, HashSet, VecDeque};

use crate::flow::{bezier, bezier_point};
use crate::models::{Arranged, Edge, EdgeCap, EdgePorts, Node, NodeKind, Position};

/// Space between two rows, and between two blocks next to each other
const GAP_Y: f64 = 70.0;
const GAP_X: f64 = 50.0;
/// Width kept free for a line where it passes through a row
const DUMMY_W: f64 = 30.0;
/// Between separate flows
const GAP_PARTS: f64 = 120.0;
/// Mind maps (as src/lib/mindmap.ts)
const TREE_GAP_X: f64 = 70.0;
const TREE_GAP_Y: f64 = 16.0;
/// Room around what is in a frame
const FRAME_PAD: f64 = 30.0;
/// In a swimlane: below the pool's and the lanes' titles
const POOL_TOP: f64 = 34.0 + 34.0 + 24.0;
/// How far a note may be from a block to go along with it
const FOLLOW_REACH: f64 = 240.0;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Role {
    /// Arranged
    Block,
    /// A section, boundary or package: arranged inside, then fitted around that
    Frame,
    /// A swimlane: arranged inside per lane
    Pool,
    /// Goes along with a block (notes, labels, comments, loose pictures)
    Follower,
    /// On the border of a block: goes along with it
    Pin,
    /// Stays where it is
    Fixed,
}

/// A rectangle to place: its size, and where it was (for keeping the order)
#[derive(Clone, Copy, Debug)]
struct Bx {
    w: f64,
    h: f64,
    x: f64,
    y: f64,
}

struct Ctx<'a> {
    nodes: &'a [Node],
    role: Vec<Role>,
    /// The frame (or swimlane) an arranged node is in
    group: Vec<Option<usize>>,
    /// Lines between arranged nodes (a generalization reversed, so the parent class is on top)
    links: Vec<(usize, usize)>,
    size: Vec<(f64, f64)>,
    /// Top-left, relative to the top-left of the group's content
    rel: Vec<(f64, f64)>,
    lanes: HashMap<usize, Vec<f64>>,
    /// Lines that go back up a flow (closing a loop), by node
    back: HashSet<(usize, usize)>,
}

/// Where everything goes. Nodes not in the result stay where they are.
pub fn arrange(nodes: &[Node], edges: &[Edge]) -> Arranged {
    let index: HashMap<&str, usize> = nodes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let parent = |i: usize| {
        nodes[i]
            .parent
            .as_deref()
            .and_then(|p| index.get(p).copied())
    };
    let linked: HashSet<usize> = edges
        .iter()
        .filter(|e| e.from != e.to)
        .flat_map(|e| {
            [
                index.get(e.from.as_str()).copied(),
                index.get(e.to.as_str()).copied(),
            ]
        })
        .flatten()
        .collect();

    // What each node does
    let own_role = |i: usize| -> Role {
        let n = &nodes[i];
        if n.locked == Some(true) {
            return Role::Fixed;
        }
        match n.kind {
            NodeKind::Lifeline | NodeKind::Activation | NodeKind::Destroy | NodeKind::Fragment => {
                Role::Fixed
            }
            NodeKind::Section | NodeKind::Boundary | NodeKind::Package => Role::Frame,
            NodeKind::Lanes => Role::Pool,
            NodeKind::Pin => Role::Pin,
            NodeKind::Note | NodeKind::Label | NodeKind::Comment | NodeKind::Callout => Role::Follower,
            NodeKind::Image | NodeKind::Icon if !linked.contains(&i) => Role::Follower,
            _ => Role::Block,
        }
    };
    let mut role: Vec<Role> = (0..nodes.len()).map(own_role).collect();
    // In a frame that stays where it is (a locked section, a fragment): stays too
    for i in 0..nodes.len() {
        let mut p = parent(i);
        for _ in 0..32 {
            let Some(q) = p else { break };
            if own_role(q) == Role::Fixed {
                role[i] = Role::Fixed;
                break;
            }
            p = parent(q);
        }
    }
    let arranged = |i: usize| matches!(role[i], Role::Block | Role::Frame | Role::Pool);

    // The frame each arranged node is in (the nearest arranged frame up its parents)
    let group: Vec<Option<usize>> = (0..nodes.len())
        .map(|i| {
            let mut p = parent(i);
            for _ in 0..32 {
                match p {
                    Some(q) if matches!(role[q], Role::Frame | Role::Pool) => return Some(q),
                    Some(q) => p = parent(q),
                    None => return None,
                }
            }
            None
        })
        .collect();

    let links: Vec<(usize, usize)> = edges
        .iter()
        .filter_map(|e| {
            let a = *index.get(e.from.as_str())?;
            let b = *index.get(e.to.as_str())?;
            if a == b || !arranged(a) || !arranged(b) {
                return None;
            }
            // Inheritance points up to the parent class: that goes on top
            Some(if e.end_cap == Some(EdgeCap::Triangle) {
                (b, a)
            } else {
                (a, b)
            })
        })
        .collect();

    let mut ctx = Ctx {
        nodes,
        role: role.clone(),
        group,
        links,
        size: nodes.iter().map(|n| (n.w, n.h)).collect(),
        rel: vec![(0.0, 0.0); nodes.len()],
        lanes: HashMap::new(),
        back: HashSet::new(),
    };

    let top: Vec<usize> = ctx.children(None);
    if top.is_empty() {
        return Arranged::default();
    }
    let (w, _) = ctx.arrange_group(None);

    // Where it was: keep it there (the middle across, the top)
    let (lo, hi, y0) = top.iter().fold(
        (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY),
        |(lo, hi, y0), &i| {
            let n = &nodes[i];
            (lo.min(n.x), hi.max(n.x + n.w), y0.min(n.y))
        },
    );
    let origin = ((lo + hi) / 2.0 - w / 2.0, y0);

    // Absolute places, from the outside in
    let mut abs: HashMap<usize, (f64, f64)> = HashMap::new();
    let mut todo: Vec<(usize, (f64, f64))> = top.iter().map(|&i| (i, origin)).collect();
    while let Some((i, (ox, oy))) = todo.pop() {
        let at = (ox + ctx.rel[i].0, oy + ctx.rel[i].1);
        abs.insert(i, at);
        if matches!(ctx.role[i], Role::Frame | Role::Pool) {
            for k in ctx.children(Some(i)) {
                todo.push((k, at));
            }
        }
    }

    // Notes and pins: along with their block
    let delta = |i: usize| abs.get(&i).map(|&(x, y)| (x - nodes[i].x, y - nodes[i].y));
    let mut moved: Vec<(usize, (f64, f64))> = abs.iter().map(|(&i, &p)| (i, p)).collect();
    for i in 0..nodes.len() {
        let host = match role[i] {
            Role::Follower => follower_host(nodes, &role, edges, &index, i),
            Role::Pin => pin_host(nodes, &role, i),
            _ => continue,
        };
        if let Some(d) = host.and_then(delta) {
            moved.push((i, (nodes[i].x + d.0, nodes[i].y + d.1)));
        }
    }
    moved.sort_by_key(|&(i, _)| i);

    let positions = moved
        .iter()
        .map(|&(i, (x, y))| {
            let resized = matches!(ctx.role[i], Role::Frame | Role::Pool);
            Position {
                id: nodes[i].id.clone(),
                x: x.round(),
                y: y.round(),
                w: resized.then(|| ctx.size[i].0.round()),
                h: resized.then(|| ctx.size[i].1.round()),
                lanes: ctx.lanes.get(&i).cloned(),
            }
        })
        .collect();

    // Lines between nodes that moved: their own route goes; a loop goes around a side
    let new_at: HashMap<usize, (f64, f64)> = moved.iter().copied().collect();
    let center_x = |i: usize| new_at[&i].0 + nodes[i].w / 2.0;
    let (min_x, max_x) = new_at.iter().fold(
        (f64::INFINITY, f64::NEG_INFINITY),
        |(a, b), (&i, &(x, _))| (a.min(x), b.max(x + ctx.size[i].0)),
    );
    let middle = (min_x + max_x) / 2.0;
    let ports = edges
        .iter()
        .filter_map(|e| {
            let a = *index.get(e.from.as_str())?;
            let b = *index.get(e.to.as_str())?;
            if !new_at.contains_key(&a) || !new_at.contains_key(&b) {
                return None;
            }
            let topics = nodes[a].kind == NodeKind::Topic && nodes[b].kind == NodeKind::Topic;
            let (from_angle, to_angle) = if topics {
                // A mind map: out of the right side, into the left side of the subtopic
                if new_at[&b].0 >= new_at[&a].0 {
                    (Some(0.0), Some(180.0))
                } else {
                    (Some(180.0), Some(0.0))
                }
            } else if ctx.back.contains(&(a, b)) {
                // Out of the side away from the rest, and back in on that side
                let (ca, cb) = (center_x(a), center_x(b));
                let right = if (ca - cb).abs() > 1.0 {
                    ca > cb
                } else {
                    ca >= middle
                };
                let side = if right { 0.0 } else { 180.0 };
                (Some(side), Some(side))
            } else {
                (None, None)
            };
            Some(EdgePorts {
                id: e.id.clone(),
                from_angle,
                to_angle,
            })
        })
        .collect();

    Arranged {
        nodes: positions,
        edges: ports,
    }
}

impl Ctx<'_> {
    /// The arranged nodes directly in `group` (None: on the board itself)
    fn children(&self, group: Option<usize>) -> Vec<usize> {
        (0..self.nodes.len())
            .filter(|&i| {
                matches!(self.role[i], Role::Block | Role::Frame | Role::Pool)
                    && self.group[i] == group
            })
            .collect()
    }

    /// Node `i`, or the frame around it that is directly in `group`
    fn lift(&self, i: usize, group: Option<usize>) -> Option<usize> {
        let mut x = i;
        for _ in 0..32 {
            if self.group[x] == group {
                return Some(x);
            }
            x = self.group[x]?;
        }
        None
    }

    /// The lines between the nodes directly in `group`, by their place in `kids`
    fn level_links(
        &self,
        group: Option<usize>,
        kids: &[usize],
    ) -> (Vec<(usize, usize)>, Vec<(usize, usize)>) {
        let at: HashMap<usize, usize> = kids.iter().enumerate().map(|(k, &i)| (i, k)).collect();
        let mut out = vec![];
        let mut direct = vec![];
        for &(a, b) in &self.links {
            if let (Some(x), Some(y)) = (self.lift(a, group), self.lift(b, group)) {
                if x != y {
                    out.push((at[&x], at[&y]));
                    direct.push((a, b));
                }
            }
        }
        (out, direct)
    }

    /// Arranges what is directly in `group`: places relative to (0, 0), and the size of it all
    fn arrange_group(&mut self, group: Option<usize>) -> (f64, f64) {
        let kids = self.children(group);
        for &k in &kids {
            match self.role[k] {
                Role::Frame => self.size[k] = self.arrange_frame(k),
                Role::Pool => self.size[k] = self.arrange_pool(k),
                _ => {}
            }
        }
        let (links, direct) = self.level_links(group, &kids);
        let boxes: Vec<Bx> = kids.iter().map(|&i| self.bx(i)).collect();
        let topic: Vec<bool> = kids
            .iter()
            .map(|&i| self.nodes[i].kind == NodeKind::Topic)
            .collect();
        let (placed, back) = place_parts(&boxes, &links, &topic);
        for (k, &i) in kids.iter().enumerate() {
            self.rel[i] = placed[k];
        }
        // Loops at this level, between the blocks themselves (not through a frame)
        for (l, &(a, b)) in links.iter().zip(&direct) {
            if back.contains(l) && kids[l.0] == a && kids[l.1] == b {
                self.back.insert((a, b));
            }
        }
        extent(&boxes, &placed)
    }

    fn bx(&self, i: usize) -> Bx {
        let n = &self.nodes[i];
        Bx {
            w: self.size[i].0,
            h: self.size[i].1,
            x: n.x,
            y: n.y,
        }
    }

    /// A section (boundary, package): its contents arranged, and it fitted around them
    fn arrange_frame(&mut self, f: usize) -> (f64, f64) {
        let n = &self.nodes[f];
        if self.children(Some(f)).is_empty() {
            return (n.w, n.h);
        }
        // Room for the title on top (a package has its tab above the frame)
        let top = match n.kind {
            NodeKind::Package => FRAME_PAD + 10.0,
            _ => 60.0,
        };
        let (w, h) = self.arrange_group(Some(f));
        for k in self.children(Some(f)) {
            self.rel[k].0 += FRAME_PAD;
            self.rel[k].1 += top;
        }
        (
            (w + FRAME_PAD * 2.0).max(160.0),
            (h + top + FRAME_PAD).max(100.0),
        )
    }

    /// A swimlane: every block stays in its lane; rows by the flow, top to bottom
    fn arrange_pool(&mut self, p: usize) -> (f64, f64) {
        let pool = &self.nodes[p];
        let lane_sizes: Vec<f64> = pool.lanes.iter().flatten().map(|l| l.size).collect();
        let kids = self.children(Some(p));
        if lane_sizes.is_empty() || kids.is_empty() {
            return (pool.w, pool.h);
        }
        for &k in &kids {
            match self.role[k] {
                Role::Frame => self.size[k] = self.arrange_frame(k),
                Role::Pool => self.size[k] = self.arrange_pool(k),
                _ => {}
            }
        }
        // The lane each block is in now
        let lane_of = |n: &Node| {
            let cx = n.x + n.w / 2.0 - pool.x;
            let mut left = 0.0;
            for (k, s) in lane_sizes.iter().enumerate() {
                if cx < left + s {
                    return k;
                }
                left += s;
            }
            lane_sizes.len() - 1
        };
        let (links, direct) = self.level_links(Some(p), &kids);
        let boxes: Vec<Bx> = kids.iter().map(|&i| self.bx(i)).collect();
        let (kept, back) = remove_back_edges(boxes.len(), &links, &boxes);
        for (l, &(a, b)) in links.iter().zip(&direct) {
            if back.contains(l) {
                self.back.insert((a, b));
            }
        }
        let layer = layers(boxes.len(), &kept);
        let rows = layer.iter().max().map_or(0, |m| m + 1);

        // Per row and lane, the blocks left to right as they were
        let mut cells: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
        for (k, &i) in kids.iter().enumerate() {
            cells
                .entry((layer[k], lane_of(&self.nodes[i])))
                .or_default()
                .push(k);
        }
        for list in cells.values_mut() {
            list.sort_by(|&a, &b| boxes[a].x.total_cmp(&boxes[b].x));
        }
        let cell_w = |list: &[usize]| {
            list.iter().map(|&k| boxes[k].w).sum::<f64>()
                + GAP_X * list.len().saturating_sub(1) as f64
        };
        let sizes: Vec<f64> = (0..lane_sizes.len())
            .map(|lane| {
                let need = (0..rows)
                    .filter_map(|r| cells.get(&(r, lane)))
                    .map(|l| cell_w(l) + FRAME_PAD * 2.0)
                    .fold(0.0, f64::max);
                lane_sizes[lane].max(need).round()
            })
            .collect();
        let row_h: Vec<f64> = (0..rows)
            .map(|r| {
                (0..boxes.len())
                    .filter(|&k| layer[k] == r)
                    .map(|k| boxes[k].h)
                    .fold(0.0, f64::max)
            })
            .collect();
        let mut row_top = vec![POOL_TOP; rows];
        for r in 1..rows {
            row_top[r] = row_top[r - 1] + row_h[r - 1] + GAP_Y;
        }
        let mut lane_left = vec![0.0; sizes.len()];
        for k in 1..sizes.len() {
            lane_left[k] = lane_left[k - 1] + sizes[k - 1];
        }
        for (&(r, lane), list) in &cells {
            let mut x = lane_left[lane] + (sizes[lane] - cell_w(list)) / 2.0;
            for &k in list {
                self.rel[kids[k]] = (x, row_top[r] + (row_h[r] - boxes[k].h) / 2.0);
                x += boxes[k].w + GAP_X;
            }
        }
        let bottom =
            row_top.last().copied().unwrap_or(POOL_TOP) + row_h.last().copied().unwrap_or(0.0);
        self.lanes.insert(p, sizes.clone());
        (sizes.iter().sum(), (bottom + FRAME_PAD + 10.0).max(200.0))
    }
}

/// The width and height of boxes at these places
fn extent(boxes: &[Bx], at: &[(f64, f64)]) -> (f64, f64) {
    boxes
        .iter()
        .zip(at)
        .fold((0.0, 0.0), |(w, h), (b, &(x, y))| {
            (f64::max(w, x + b.w), f64::max(h, y + b.h))
        })
}

/// Places boxes joined by `links`: each flow on its own, side by side (in the order
/// they were, left to right), then the boxes without lines, in their rows.
/// Top-left corners, the whole starting at (0, 0); and the links that close a loop.
fn place_parts(
    boxes: &[Bx],
    links: &[(usize, usize)],
    topic: &[bool],
) -> (Vec<(f64, f64)>, HashSet<(usize, usize)>) {
    let n = boxes.len();
    let mut out = vec![(0.0, 0.0); n];
    let mut back = HashSet::new();
    if n == 0 {
        return (out, back);
    }

    // Flows: boxes joined by lines, directly or not
    let mut root: Vec<usize> = (0..n).collect();
    fn find(root: &mut [usize], i: usize) -> usize {
        if root[i] != i {
            let r = find(root, root[i]);
            root[i] = r;
        }
        root[i]
    }
    for &(a, b) in links {
        let (ra, rb) = (find(&mut root, a), find(&mut root, b));
        root[ra] = rb;
    }
    let mut parts: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let r = find(&mut root, i);
        parts.entry(r).or_default().push(i);
    }
    let (mut flows, loose): (Vec<Vec<usize>>, Vec<Vec<usize>>) =
        parts.into_values().partition(|p| p.len() > 1);
    flows.sort_by(|a, b| {
        let x = |p: &Vec<usize>| p.iter().map(|&i| boxes[i].x).fold(f64::INFINITY, f64::min);
        x(a).total_cmp(&x(b))
    });

    let mut x = 0.0;
    for part in &flows {
        let local: HashMap<usize, usize> = part.iter().enumerate().map(|(k, &i)| (i, k)).collect();
        let sub: Vec<Bx> = part.iter().map(|&i| boxes[i]).collect();
        let sub_links: Vec<(usize, usize)> = links
            .iter()
            .filter(|(a, _)| local.contains_key(a))
            .map(|&(a, b)| (local[&a], local[&b]))
            .collect();
        let (at, loops) = if part.iter().all(|&i| topic[i]) {
            (tree(&sub, &sub_links), vec![])
        } else {
            layered(&sub, &sub_links)
        };
        for (a, b) in loops {
            back.insert((part[a], part[b]));
        }
        let (w, _) = extent(&sub, &at);
        for (k, &i) in part.iter().enumerate() {
            out[i] = (x + at[k].0, at[k].1);
        }
        x += w + GAP_PARTS;
    }

    // Boxes without lines: rows as they were, packed left to right without overlap
    let mut alone: Vec<usize> = loose.into_iter().flatten().collect();
    if !alone.is_empty() {
        alone.sort_by(|&a, &b| boxes[a].y.total_cmp(&boxes[b].y));
        let mut rows: Vec<Vec<usize>> = vec![];
        for i in alone {
            match rows.last_mut() {
                // In the row when its top is above the middle of the row's first box
                Some(row) if boxes[i].y < boxes[row[0]].y + boxes[row[0]].h / 2.0 => row.push(i),
                _ => rows.push(vec![i]),
            }
        }
        let x0 = x;
        let mut y = 0.0;
        for mut row in rows {
            row.sort_by(|&a, &b| boxes[a].x.total_cmp(&boxes[b].x));
            let mut cx = x0;
            let h = row.iter().map(|&i| boxes[i].h).fold(0.0, f64::max);
            for i in row {
                out[i] = (cx, y);
                cx += boxes[i].w + GAP_X;
            }
            y += h + GAP_Y;
        }
    }
    (out, back)
}

/// A mind map: the root (the topic nothing leads to) on the left, every topic's
/// subtopics in a column to its right, stacked and centered on it.
fn tree(boxes: &[Bx], links: &[(usize, usize)]) -> Vec<(f64, f64)> {
    let n = boxes.len();
    let mut kids: Vec<Vec<usize>> = vec![vec![]; n];
    let mut has_parent = vec![false; n];
    for &(a, b) in links {
        if !has_parent[b] && a != b {
            has_parent[b] = true;
            kids[a].push(b);
        }
    }
    for k in &mut kids {
        k.sort_by(|&a, &b| boxes[a].y.total_cmp(&boxes[b].y));
    }
    let root = (0..n)
        .filter(|&i| !has_parent[i])
        .min_by(|&a, &b| boxes[a].x.total_cmp(&boxes[b].x))
        .unwrap_or(0);

    let mut height = vec![0.0; n];
    let mut seen = vec![false; n];
    fn measure(
        i: usize,
        kids: &[Vec<usize>],
        boxes: &[Bx],
        height: &mut [f64],
        seen: &mut [bool],
    ) -> f64 {
        seen[i] = true;
        let own: Vec<usize> = kids[i].iter().copied().filter(|&k| !seen[k]).collect();
        let sum: f64 = own
            .iter()
            .map(|&k| measure(k, kids, boxes, height, seen))
            .sum::<f64>()
            + TREE_GAP_Y * own.len().saturating_sub(1) as f64;
        height[i] = boxes[i].h.max(sum);
        height[i]
    }
    measure(root, &kids, boxes, &mut height, &mut seen);

    let mut out = vec![(0.0, 0.0); n];
    let mut placed = vec![false; n];
    fn place(
        i: usize,
        x: f64,
        mid: f64,
        kids: &[Vec<usize>],
        boxes: &[Bx],
        height: &[f64],
        out: &mut [(f64, f64)],
        placed: &mut [bool],
    ) {
        placed[i] = true;
        out[i] = (x, mid - boxes[i].h / 2.0);
        let own: Vec<usize> = kids[i]
            .iter()
            .copied()
            .filter(|&k| !placed[k] && height[k] > 0.0)
            .collect();
        let total: f64 = own.iter().map(|&k| height[k]).sum::<f64>()
            + TREE_GAP_Y * own.len().saturating_sub(1) as f64;
        let mut y = mid - total / 2.0;
        for k in own {
            place(
                k,
                x + boxes[i].w + TREE_GAP_X,
                y + height[k] / 2.0,
                kids,
                boxes,
                height,
                out,
                placed,
            );
            y += height[k] + TREE_GAP_Y;
        }
    }
    place(
        root,
        0.0,
        height[root] / 2.0,
        &kids,
        boxes,
        &height,
        &mut out,
        &mut placed,
    );
    // A topic not reached from the root (a second root): below it all
    let mut y = height[root] + GAP_Y;
    for i in 0..n {
        if !placed[i] {
            out[i] = (0.0, y);
            y += boxes[i].h + TREE_GAP_Y;
        }
    }
    normalize(out)
}

/// Moves positions so the smallest x and y are 0
fn normalize(mut at: Vec<(f64, f64)>) -> Vec<(f64, f64)> {
    let (mx, my) = at
        .iter()
        .fold((f64::INFINITY, f64::INFINITY), |(a, b), &(x, y)| {
            (a.min(x), b.min(y))
        });
    if mx.is_finite() {
        for p in &mut at {
            *p = (p.0 - mx, p.1 - my);
        }
    }
    at
}

/// The layer of every box: the longest path to it from a box nothing leads to
fn layers(n: usize, links: &[(usize, usize)]) -> Vec<usize> {
    let mut children: Vec<Vec<usize>> = vec![vec![]; n];
    let mut waiting = vec![0usize; n];
    for &(a, b) in links {
        children[a].push(b);
        waiting[b] += 1;
    }
    let mut layer = vec![0usize; n];
    let mut queue: VecDeque<usize> = (0..n).filter(|&i| waiting[i] == 0).collect();
    while let Some(i) = queue.pop_front() {
        for &c in &children[i] {
            layer[c] = layer[c].max(layer[i] + 1);
            waiting[c] -= 1;
            if waiting[c] == 0 {
                queue.push_back(c);
            }
        }
    }
    layer
}

/// One flow in layers, top to bottom (a simplified Sugiyama):
///   1. break loops; 2. layers by longest path; 3. invisible stand-ins where lines
///   skip layers; 4. order each layer against crossings (barycenter); 5. y per
///   layer; 6. x per box, near its neighbours without overlap.
/// Top-left corners from (0, 0), and the links that were taken out to break loops.
fn layered(boxes: &[Bx], all_links: &[(usize, usize)]) -> (Vec<(f64, f64)>, Vec<(usize, usize)>) {
    let n = boxes.len();
    let (links, back) = remove_back_edges(n, all_links, boxes);
    let mut layer = layers(n, &links);

    // ---- 3. stand-ins for lines that skip layers ----
    let mut width: Vec<f64> = boxes.iter().map(|b| b.w).collect();
    let mut height: Vec<f64> = boxes.iter().map(|b| b.h).collect();
    let mut out: Vec<Vec<usize>> = vec![vec![]; n];
    let mut inc: Vec<Vec<usize>> = vec![vec![]; n];
    let mut start_x: Vec<f64> = boxes.iter().map(|b| b.x + b.w / 2.0).collect();
    let mut chain: Vec<(usize, usize)> = vec![];
    for &(a, b) in &links {
        let mut prev = a;
        for l in layer[a] + 1..layer[b] {
            let d = width.len();
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

    let layer_count = layer.iter().max().unwrap_or(&0) + 1;
    let mut rows: Vec<Vec<usize>> = vec![vec![]; layer_count];
    for i in 0..total {
        rows[layer[i]].push(i);
    }
    for row in &mut rows {
        row.sort_by(|&a, &b| start_x[a].total_cmp(&start_x[b]));
    }

    // ---- 4. fewer crossings ----
    for round in 0..8 {
        let down = round % 2 == 0;
        let order: Vec<usize> = if down {
            (1..layer_count).collect()
        } else {
            (0..layer_count.saturating_sub(1)).rev().collect()
        };
        for l in order {
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
                    let key = if ns.is_empty() {
                        p as f64
                    } else {
                        ns.iter().map(|&j| pos[j]).sum::<f64>() / ns.len() as f64
                    };
                    (key, i)
                })
                .collect();
            keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
            rows[l] = keyed.into_iter().map(|(_, i)| i).collect();
        }
    }

    // ---- 5. y per layer ----
    let row_h: Vec<f64> = rows
        .iter()
        .map(|row| row.iter().map(|&i| height[i]).fold(0.0, f64::max))
        .collect();
    let mut row_top = vec![0.0; layer_count];
    for l in 1..layer_count {
        row_top[l] = row_top[l - 1] + row_h[l - 1] + GAP_Y;
    }
    let rect = |i: usize, cx: f64| {
        let l = layer[i];
        [
            cx - boxes[i].w / 2.0,
            row_top[l] + (row_h[l] - boxes[i].h) / 2.0,
            boxes[i].w,
            boxes[i].h,
        ]
    };

    // ---- 6. x per box ----
    let gap = |a: usize, b: usize| {
        if is_dummy(a) || is_dummy(b) {
            GAP_X / 2.0
        } else {
            GAP_X
        }
    };
    let mut x = vec![0.0; total];
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
            let want: Vec<f64> = row
                .iter()
                .map(|&i| {
                    if is_dummy(i) {
                        // Where the line crosses this row, over its whole height
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
            let mut placed = want.clone();
            for k in 1..row.len() {
                let (p, c) = (row[k - 1], row[k]);
                let min = placed[k - 1] + width[p] / 2.0 + gap(p, c) + width[c] / 2.0;
                placed[k] = placed[k].max(min);
            }
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

    let at: Vec<(f64, f64)> = (0..n)
        .map(|i| {
            let [rx, ry, ..] = rect(i, x[i]);
            (rx, ry)
        })
        .collect();
    (normalize(at), back)
}

/// The x where the line between rectangles `a` and `b` crosses height `y`
fn curve_x_at(a: [f64; 4], b: [f64; 4], y: f64) -> f64 {
    let pts = bezier(a, b);
    (0..=64)
        .map(|k| bezier_point(pts, k as f64 / 64.0))
        .min_by(|p, q| (p.1 - y).abs().total_cmp(&(q.1 - y).abs()))
        .map(|p| p.0)
        .unwrap_or(pts[0].0)
}

/// The links without those that close a loop (and without doubles), and the loop closers.
///
/// Depth-first from the boxes nothing leads to, top to bottom as they were: a link
/// to a box still on the current path goes back up, so it closes a loop.
fn remove_back_edges(
    n: usize,
    links: &[(usize, usize)],
    boxes: &[Bx],
) -> (Vec<(usize, usize)>, Vec<(usize, usize)>) {
    let mut out: Vec<Vec<usize>> = vec![vec![]; n];
    for &(a, b) in links {
        out[a].push(b);
    }
    let mut has_incoming = vec![false; n];
    for &(_, b) in links {
        has_incoming[b] = true;
    }
    let mut starts: Vec<usize> = (0..n).collect();
    starts.sort_by(|&a, &b| {
        has_incoming[a]
            .cmp(&has_incoming[b])
            .then(boxes[a].y.total_cmp(&boxes[b].y))
    });

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
    let mut state = vec![0u8; n];
    let mut back = vec![];
    for s in starts {
        if state[s] == 0 {
            dfs(s, &out, &mut state, &mut back);
        }
    }
    let mut kept: Vec<(usize, usize)> = links
        .iter()
        .copied()
        .filter(|l| !back.contains(l))
        .collect();
    kept.sort_unstable();
    kept.dedup();
    (kept, back)
}

/// The space between two rectangles (0 when they touch or overlap)
fn gap_between(a: &Node, b: &Node) -> f64 {
    let dx = ((a.x + a.w / 2.0) - (b.x + b.w / 2.0)).abs() - (a.w + b.w) / 2.0;
    let dy = ((a.y + a.h / 2.0) - (b.y + b.h / 2.0)).abs() - (a.h + b.h) / 2.0;
    dx.max(0.0).hypot(dy.max(0.0))
}

/// What a note (label, comment, loose picture) goes along with: the block it is
/// joined to by a line, else the nearest block close by, else the frame it is in.
fn follower_host(
    nodes: &[Node],
    role: &[Role],
    edges: &[Edge],
    index: &HashMap<&str, usize>,
    i: usize,
) -> Option<usize> {
    let movable = |j: usize| matches!(role[j], Role::Block | Role::Frame | Role::Pool);
    let id = nodes[i].id.as_str();
    let joined = edges.iter().find_map(|e| {
        let other = if e.from == id {
            e.to.as_str()
        } else if e.to == id {
            e.from.as_str()
        } else {
            return None;
        };
        index
            .get(other)
            .copied()
            .filter(|&j| matches!(role[j], Role::Block))
    });
    if joined.is_some() {
        return joined;
    }
    let near = (0..nodes.len())
        .filter(|&j| role[j] == Role::Block)
        .map(|j| (j, gap_between(&nodes[i], &nodes[j])))
        .filter(|&(_, d)| d <= FOLLOW_REACH)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(j, _)| j);
    near.or_else(|| {
        let p = nodes[i].parent.as_deref()?;
        index.get(p).copied().filter(|&j| movable(j))
    })
}

/// The block a pin is on: the one whose border it sits on
fn pin_host(nodes: &[Node], role: &[Role], i: usize) -> Option<usize> {
    let (cx, cy) = (nodes[i].x + nodes[i].w / 2.0, nodes[i].y + nodes[i].h / 2.0);
    (0..nodes.len()).find(|&j| {
        let n = &nodes[j];
        role[j] == Role::Block
            && cx >= n.x - 10.0
            && cx <= n.x + n.w + 10.0
            && cy >= n.y - 10.0
            && cy <= n.y + n.h + 10.0
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Lane, NodeColor};

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
            chart: None,
            person: None,
            focal: None,
        }
    }

    pub(crate) fn edge(from: &str, to: &str) -> Edge {
        serde_json::from_value(
            serde_json::json!({ "id": format!("{from}-{to}"), "from": from, "to": to }),
        )
        .unwrap()
    }

    fn at(r: &Arranged) -> HashMap<String, (f64, f64)> {
        r.nodes.iter().map(|p| (p.id.clone(), (p.x, p.y))).collect()
    }

    fn inside(child: (f64, f64, f64, f64), frame: (f64, f64, f64, f64)) -> bool {
        child.0 >= frame.0
            && child.1 >= frame.1
            && child.0 + child.2 <= frame.0 + frame.2
            && child.1 + child.3 <= frame.1 + frame.3
    }

    #[test]
    fn chain_branches_and_loops() {
        // A loop has no start: the one highest up now goes on top
        let nodes = vec![
            node("c", NodeKind::Box, 0.0, 200.0),
            node("a", NodeKind::Box, 500.0, 0.0),
            node("b", NodeKind::Box, 0.0, 100.0),
            node("d", NodeKind::Box, 0.0, 200.0),
        ];
        let r = arrange(
            &nodes,
            &[
                edge("a", "b"),
                edge("b", "c"),
                edge("b", "d"),
                edge("c", "a"),
            ],
        );
        let p = at(&r);
        assert!(p["a"].1 < p["b"].1 && p["b"].1 < p["c"].1, "{p:?}");
        assert_eq!(p["c"].1, p["d"].1);
        assert_ne!(p["c"].0, p["d"].0);
        // The loop c → a goes around a side; the other lines lose their own routes
        let lp = r.edges.iter().find(|e| e.id == "c-a").unwrap();
        assert!(lp.from_angle.is_some() && lp.from_angle == lp.to_angle);
        assert!(
            r.edges
                .iter()
                .filter(|e| e.id != "c-a")
                .all(|e| e.from_angle.is_none())
        );
    }

    #[test]
    fn empty_and_fixed() {
        assert!(arrange(&[], &[]).nodes.is_empty());
        let mut locked = node("l", NodeKind::Box, 0.0, 0.0);
        locked.locked = Some(true);
        let life = node("life", NodeKind::Lifeline, 0.0, 0.0);
        let r = arrange(
            &[locked, life, node("a", NodeKind::Box, 0.0, 0.0)],
            &[edge("l", "a")],
        );
        let ids: Vec<&str> = r.nodes.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["a"]);
    }

    /// A section's blocks are arranged inside it, and it fits around them
    #[test]
    fn sections_keep_their_blocks() {
        let mut sec = node("sec", NodeKind::Section, -40.0, -60.0);
        (sec.w, sec.h) = (520.0, 300.0);
        let mut nodes = vec![
            sec,
            node("a", NodeKind::Box, 0.0, 0.0),
            node("b", NodeKind::Box, 240.0, 0.0),
            node("c", NodeKind::Box, 0.0, 120.0),
            node("out", NodeKind::Box, 600.0, 300.0),
        ];
        for n in &mut nodes[1..4] {
            n.parent = Some("sec".into());
        }
        let r = arrange(&nodes, &[edge("a", "b"), edge("b", "c"), edge("c", "out")]);
        let p = at(&r);
        let s = r.nodes.iter().find(|p| p.id == "sec").unwrap();
        let frame = (s.x, s.y, s.w.unwrap(), s.h.unwrap());
        for id in ["a", "b", "c"] {
            assert!(
                inside((p[id].0, p[id].1, 160.0, 60.0), frame),
                "{id} in the section: {p:?} {frame:?}"
            );
        }
        assert!(p["a"].1 < p["b"].1 && p["b"].1 < p["c"].1);
        // The block after the section is below it, not inside
        assert!(p["out"].1 >= frame.1 + frame.3);
    }

    #[test]
    fn mind_map_is_a_tree_to_the_right() {
        let t = |id: &str, y: f64| Node {
            kind: NodeKind::Topic,
            h: 48.0,
            ..node(id, NodeKind::Topic, 0.0, y)
        };
        let nodes = vec![
            t("root", 0.0),
            t("a", -50.0),
            t("b", 50.0),
            t("a1", -60.0),
            t("a2", -40.0),
        ];
        let r = arrange(
            &nodes,
            &[
                edge("root", "a"),
                edge("root", "b"),
                edge("a", "a1"),
                edge("a", "a2"),
            ],
        );
        let p = at(&r);
        assert!(p["a"].0 > p["root"].0 && p["a"].0 == p["b"].0 && p["a1"].0 > p["a"].0);
        // Lines from the right side into the left side
        assert!(
            r.edges
                .iter()
                .all(|e| e.from_angle == Some(0.0) && e.to_angle == Some(180.0))
        );
        assert!(p["a"].1 < p["b"].1 && p["a1"].1 < p["a2"].1);
    }

    #[test]
    fn swimlane_blocks_stay_in_their_lane() {
        let mut pool = node("pool", NodeKind::Lanes, 0.0, 0.0);
        (pool.w, pool.h) = (600.0, 500.0);
        pool.lanes = Some(vec![
            Lane {
                id: "l1".into(),
                title: "A".into(),
                size: 300.0,
            },
            Lane {
                id: "l2".into(),
                title: "B".into(),
                size: 300.0,
            },
        ]);
        let mut nodes = vec![
            pool,
            node("x", NodeKind::Box, 50.0, 300.0),
            node("y", NodeKind::Box, 350.0, 100.0),
            node("z", NodeKind::Box, 60.0, 50.0),
        ];
        for n in &mut nodes[1..] {
            n.parent = Some("pool".into());
        }
        let r = arrange(&nodes, &[edge("x", "y"), edge("y", "z")]);
        let p = at(&r);
        let pool = r.nodes.iter().find(|p| p.id == "pool").unwrap();
        let lane = |id: &str| {
            if p[id].0 + 80.0 < pool.x + 300.0 {
                0
            } else {
                1
            }
        };
        assert_eq!((lane("x"), lane("y"), lane("z")), (0, 1, 0));
        assert!(p["x"].1 < p["y"].1 && p["y"].1 < p["z"].1);
        assert!(p["x"].1 >= pool.y + POOL_TOP);
    }

    #[test]
    fn notes_and_pins_go_along() {
        let mut pin = node("pin", NodeKind::Pin, 155.0, 20.0);
        (pin.w, pin.h) = (14.0, 14.0);
        let nodes = vec![
            node("a", NodeKind::Box, 0.0, 0.0),
            node("b", NodeKind::Box, 900.0, 900.0),
            node("n", NodeKind::Note, 200.0, 0.0),
            pin,
            node("far", NodeKind::Note, 5000.0, 5000.0),
        ];
        let r = arrange(&nodes, &[edge("a", "b")]);
        let p = at(&r);
        let d = (p["a"].0 - 0.0, p["a"].1 - 0.0);
        assert_eq!(p["n"], (200.0 + d.0, d.1));
        assert_eq!(p["pin"], (155.0 + d.0, 20.0 + d.1));
        assert!(!p.contains_key("far"), "nothing near it: stays");
    }

    #[test]
    fn loose_blocks_keep_their_rows() {
        let s = |id: &str, x: f64| {
            let mut n = node(id, NodeKind::Section, x, 0.0);
            (n.w, n.h) = (260.0, 560.0);
            n
        };
        let p = at(&arrange(&[s("a", 0.0), s("b", 300.0), s("c", 600.0)], &[]));
        assert!(
            p["a"].1 == p["b"].1
                && p["b"].1 == p["c"].1
                && p["a"].0 < p["b"].0
                && p["b"].0 < p["c"].0
        );
    }

    #[test]
    fn parent_classes_on_top() {
        let nodes = vec![
            node("child", NodeKind::Class, 0.0, 0.0),
            node("parent", NodeKind::Class, 0.0, 400.0),
        ];
        let mut e = edge("child", "parent");
        e.end_cap = Some(EdgeCap::Triangle);
        let p = at(&arrange(&nodes, &[e]));
        assert!(p["parent"].1 < p["child"].1);
    }
}
