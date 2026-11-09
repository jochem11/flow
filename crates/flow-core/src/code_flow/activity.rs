//! A function's activity diagram: start, its steps as actions, `if`s and
//! `switch`es as decisions (with a merge after), loops as a decision the body
//! goes back to, a `throw` ending in a flow final. A call to another function in
//! the codebase is followed (up to `depth` calls deep): a section with that
//! function's own steps, after which the caller goes on. Laid out with Arrange.

use std::collections::{HashMap, HashSet};

use serde_json::json;

use super::read::{type_name, Call, Codebase, Function, Stmt};
use crate::import::{arranged, edge, fit, node};
use crate::models::{CodeActivity, Edge, Node, NodeKind};

/// More blocks than this, and no more calls are followed
pub const MAX_BLOCKS: usize = 300;

/// A line still to be drawn from a block (with its label) to whatever comes next
type Pending = Vec<(usize, Option<String>)>;

struct Block {
    kind: NodeKind,
    text: String,
    parent: Option<usize>,
}

/// Where a `break` and a `continue` go
struct Frame {
    /// The loop's decision (none for a switch)
    cont: Option<usize>,
    breaks: Pending,
}

/// How a function is being drawn
struct Cx<'a> {
    f: &'a Function,
    /// Locals and parameters with a known type
    locals: HashMap<String, String>,
    /// The section it is drawn in
    section: Option<usize>,
    /// How many more calls deep to follow
    depth: u8,
    /// Its returns: to the end (the entry function), or on after the call
    returns: Option<Pending>,
}

/// Lookup tables over a codebase's functions
struct Index<'a> {
    code: &'a Codebase,
    by_class: HashMap<(&'a str, &'a str), Vec<usize>>,
    top_level: HashMap<&'a str, Vec<usize>>,
}

impl<'a> Index<'a> {
    fn new(code: &'a Codebase) -> Self {
        let mut by_class: HashMap<(&str, &str), Vec<usize>> = HashMap::new();
        let mut top_level: HashMap<&str, Vec<usize>> = HashMap::new();
        for (i, f) in code.functions.iter().enumerate() {
            match &f.class {
                Some(c) => by_class.entry((c.as_str(), f.name.as_str())).or_default().push(i),
                None => top_level.entry(f.name.as_str()).or_default().push(i),
            }
        }
        Index { code, by_class, top_level }
    }

    /// A method of a class, also from what it extends; for an interface, its one implementation
    fn method(&self, class: &str, name: &str) -> Option<usize> {
        let mut seen = HashSet::new();
        if let Some(i) = self.method_up(class, name, &mut seen) {
            return Some(i);
        }
        // `LendService` as an interface, with `LendServiceImpl` doing it
        let implementors: Vec<usize> = self
            .code
            .classes
            .values()
            .filter(|c| c.supers.iter().any(|s| s == class))
            .filter_map(|c| self.method_up(&c.name, name, &mut HashSet::new()))
            .collect();
        match implementors.as_slice() {
            [one] => Some(*one),
            _ => None,
        }
    }

    fn method_up(&self, class: &str, name: &str, seen: &mut HashSet<String>) -> Option<usize> {
        if !seen.insert(class.to_string()) {
            return None;
        }
        if let Some(found) = self.by_class.get(&(class, name)) {
            return found.first().copied();
        }
        let supers = self.code.classes.get(class).map(|c| c.supers.clone()).unwrap_or_default();
        supers.iter().find_map(|s| self.method_up(s, name, seen))
    }

    /// A field's type, also from what the class extends
    fn field(&self, class: &str, field: &str) -> Option<String> {
        let mut at = Some(class.to_string());
        let mut seen = HashSet::new();
        while let Some(c) = at.take() {
            if !seen.insert(c.clone()) {
                break;
            }
            let info = self.code.classes.get(&c)?;
            if let Some(t) = info.fields.get(field) {
                return Some(t.clone());
            }
            at = info.supers.first().cloned();
        }
        None
    }

    /// Which function a call goes to, when it is one in the codebase
    fn resolve(&self, call: &Call, cx: &Cx) -> Option<usize> {
        let f = cx.f;
        let own = f.class.as_deref();
        let Some(r) = call.receiver.as_deref() else {
            // `foo()`: a method of this class, a function in this file, or the only one by that name
            if let Some(i) = own.and_then(|c| self.method(c, &call.name)) {
                return Some(i);
            }
            let tops = self.top_level.get(call.name.as_str())?;
            return tops.iter().find(|&&i| self.code.functions[i].file == f.file).or(match tops.as_slice() {
                [one] => Some(one),
                _ => None,
            }).copied();
        };
        // What it is called on, without `this.` / `self.` / Go's receiver
        let mut r = r.trim().trim_start_matches("await ").to_string();
        for p in ["this.", "this?.", "self.", "super.", "this!!."] {
            if let Some(x) = r.strip_prefix(p) {
                r = x.to_string();
            }
        }
        if let Some(x) = f.receiver.as_deref().and_then(|g| r.strip_prefix(&format!("{g}."))) {
            r = x.to_string();
        }
        if matches!(r.as_str(), "this" | "self" | "super" | "base") || f.receiver.as_deref() == Some(r.as_str()) {
            return own.and_then(|c| self.method(c, &call.name));
        }
        // A plain name: a local, a parameter or a field, with its type
        if r.chars().all(|c| c.is_alphanumeric() || c == '_') {
            let ty = cx.locals.get(&r).cloned().or_else(|| own.and_then(|c| self.field(c, &r)));
            if let Some(ty) = ty {
                return self.method(&ty, &call.name);
            }
            // A class: `OrderService.create()`
            if r.chars().next().is_some_and(char::is_uppercase) {
                if let Some(i) = self.method(&r, &call.name) {
                    return Some(i);
                }
            }
            // A Go package or a module: `orders.Create()`, the only top-level one by that name
            if let Some([one]) = self.top_level.get(call.name.as_str()).map(|v| v.as_slice()) {
                if !self.code.classes.contains_key(&r) && self.code.functions[*one].file != f.file {
                    return Some(*one);
                }
            }
        }
        None
    }
}

struct Builder<'a> {
    index: Index<'a>,
    blocks: Vec<Block>,
    lines: Vec<(usize, usize, Option<String>)>,
    frames: Vec<Frame>,
    /// The functions being drawn, outermost first (a call back into one is not followed)
    stack: Vec<usize>,
    end: usize,
    notes: Vec<String>,
    /// Calls not followed for size
    cut: usize,
    /// Actions of plain steps, which the next plain step may join
    plain: HashSet<usize>,
}

impl<'a> Builder<'a> {
    fn block(&mut self, kind: NodeKind, text: &str, cx: &Cx) -> usize {
        self.blocks.push(Block { kind, text: text.to_string(), parent: cx.section });
        self.blocks.len() - 1
    }

    fn join(&mut self, pending: Pending, to: usize) {
        for (from, label) in pending {
            self.lines.push((from, to, label));
        }
    }

    /// A block after what is pending
    fn step(&mut self, kind: NodeKind, text: &str, pending: Pending, cx: &Cx) -> usize {
        let b = self.block(kind, text, cx);
        self.join(pending, b);
        b
    }

    /// Several ways in: a merge, so one line goes on
    fn merge(&mut self, ways: Pending, cx: &Cx) -> Pending {
        if ways.len() <= 1 {
            return ways;
        }
        let m = self.step(NodeKind::Diamond, "", ways, cx);
        vec![(m, None)]
    }

    fn steps(&mut self, stmts: &[Stmt], mut pending: Pending, cx: &mut Cx) -> Pending {
        for s in stmts {
            // Nothing leads here (after a return, a throw, a break)
            if pending.is_empty() {
                break;
            }
            pending = self.stmt(s, pending, cx);
        }
        pending
    }

    fn stmt(&mut self, s: &Stmt, pending: Pending, cx: &mut Cx) -> Pending {
        match s {
            Stmt::Simple { text, calls, declares } => {
                if let Some((name, ty)) = declares {
                    cx.locals.insert(name.clone(), ty.clone());
                }
                let (pending, followed) = self.follow(calls, pending, cx);
                // A statement that is just the call followed: the section says it all
                let just_call = calls.len() == 1 && followed == 1 && same_call(text, &calls[0].text);
                if just_call || pending.is_empty() {
                    return pending;
                }
                // Plain steps one after another: one action, a line each (up to 4)
                if let [(prev, None)] = pending.as_slice() {
                    let prev = *prev;
                    // (in the same section: not the last step of a function followed just before)
                    if self.plain.contains(&prev) && self.blocks[prev].parent == cx.section && self.blocks[prev].text.lines().count() < 4 && followed == 0 {
                        self.blocks[prev].text.push('\n');
                        self.blocks[prev].text.push_str(text);
                        return pending;
                    }
                }
                let b = self.step(NodeKind::Box, text, pending, cx);
                if followed == 0 {
                    self.plain.insert(b);
                }
                vec![(b, None)]
            }
            Stmt::If { cond, calls, then, els } => {
                let (pending, _) = self.follow(calls, pending, cx);
                if pending.is_empty() {
                    return pending;
                }
                let d = self.step(NodeKind::Diamond, cond, pending, cx);
                let mut ways = self.steps(then, vec![(d, Some("yes".into()))], cx);
                match els {
                    Some(e) => ways.extend(self.steps(e, vec![(d, Some("no".into()))], cx)),
                    None => ways.push((d, Some("no".into()))),
                }
                self.merge(ways, cx)
            }
            Stmt::Loop { head, calls, body, test_after } => {
                let (yes, no) = if is_for_each(head) { ("next", "done") } else { ("yes", "no") };
                if *test_after {
                    // do … while: the body first, then the test, back to the body's start
                    let first = self.blocks.len();
                    let d = self.block(NodeKind::Diamond, head, cx);
                    self.frames.push(Frame { cont: Some(d), breaks: vec![] });
                    let after = self.steps(body, pending.clone(), cx);
                    let frame = self.frames.pop().expect("the loop's frame");
                    let entry = (first + 1..self.blocks.len()).next();
                    match entry {
                        Some(e) => {
                            self.join(after, d);
                            self.lines.push((d, e, Some(yes.into())));
                        }
                        None => self.join(pending, d),
                    }
                    let mut out = vec![(d, Some(no.into()))];
                    out.extend(frame.breaks);
                    return self.merge(out, cx);
                }
                let (pending, _) = self.follow(calls, pending, cx);
                if pending.is_empty() {
                    return pending;
                }
                let d = self.step(NodeKind::Diamond, head, pending, cx);
                self.frames.push(Frame { cont: Some(d), breaks: vec![] });
                let back = self.steps(body, vec![(d, Some(yes.into()))], cx);
                let frame = self.frames.pop().expect("the loop's frame");
                // An empty body: the loop goes round on itself
                self.join(back, d);
                let mut out = vec![(d, Some(no.into()))];
                out.extend(frame.breaks);
                self.merge(out, cx)
            }
            Stmt::Switch { subject, calls, cases, has_default } => {
                let (pending, _) = self.follow(calls, pending, cx);
                if pending.is_empty() {
                    return pending;
                }
                let d = self.step(NodeKind::Diamond, subject, pending, cx);
                self.frames.push(Frame { cont: None, breaks: vec![] });
                let mut ways = vec![];
                for (label, body) in cases {
                    ways.extend(self.steps(body, vec![(d, Some(label.clone()))], cx));
                }
                let frame = self.frames.pop().expect("the switch's frame");
                ways.extend(frame.breaks);
                if !has_default {
                    ways.push((d, Some("else".into())));
                }
                self.merge(ways, cx)
            }
            Stmt::Try { body, catches, finally } => {
                let after = self.steps(body, pending, cx);
                let mut ways = after.clone();
                if !catches.is_empty() && !after.is_empty() {
                    // What went wrong in it: handled here
                    let d = self.step(NodeKind::Diamond, "error?", after, cx);
                    ways = vec![(d, Some("no".into()))];
                    for (what, steps) in catches {
                        ways.extend(self.steps(steps, vec![(d, Some(what.clone()))], cx));
                    }
                }
                let ways = self.merge(ways, cx);
                match finally {
                    Some(f) => self.steps(f, ways, cx),
                    None => ways,
                }
            }
            Stmt::Return { text, calls } => {
                let (mut pending, followed) = self.follow(calls, pending, cx);
                // What a followed function returns goes back to its caller: not shown
                let inlined = cx.returns.is_some();
                let shown = text.as_deref().filter(|t| !inlined && !(followed == 1 && calls.len() == 1 && same_call(t, &calls[0].text)));
                if let (Some(t), false) = (shown, pending.is_empty()) {
                    let b = self.step(NodeKind::Box, &format!("return {t}"), pending, cx);
                    pending = vec![(b, None)];
                }
                match &mut cx.returns {
                    // On after the call
                    Some(back) => back.extend(pending),
                    None => {
                        let end = self.end;
                        self.join(pending, end);
                    }
                }
                vec![]
            }
            Stmt::Throw { text, calls } => {
                let (pending, _) = self.follow(calls, pending, cx);
                if pending.is_empty() {
                    return pending;
                }
                let b = self.step(NodeKind::Box, text, pending, cx);
                self.step(NodeKind::FlowFinal, "", vec![(b, None)], cx);
                vec![]
            }
            Stmt::Break => {
                match self.frames.last_mut() {
                    Some(f) => f.breaks.extend(pending),
                    None => return pending,
                }
                vec![]
            }
            Stmt::Continue => {
                match self.frames.iter().rev().find_map(|f| f.cont) {
                    Some(d) => self.join(pending, d),
                    None => return pending,
                }
                vec![]
            }
            Stmt::Block(steps) => self.steps(steps, pending, cx),
        }
    }

    /// Follows the calls of a step that go to functions in the codebase: each a
    /// section with that function's steps. Returns what is pending after them,
    /// and how many were followed.
    fn follow(&mut self, calls: &[Call], mut pending: Pending, cx: &mut Cx) -> (Pending, usize) {
        let mut followed = 0;
        for call in calls {
            if pending.is_empty() || cx.depth == 0 {
                break;
            }
            let Some(i) = self.index.resolve(call, cx) else { continue };
            if self.stack.contains(&i) {
                continue;
            }
            let callee = &self.index.code.functions[i];
            // A one-liner (a getter, `return db`) says no more than its call does
            if !worth_following(&callee.body) {
                continue;
            }
            if self.blocks.len() >= MAX_BLOCKS {
                self.cut += 1;
                continue;
            }
            let title = match &callee.class {
                Some(c) => format!("{c}.{}", callee.name),
                None => callee.name.clone(),
            };
            let section = self.block(NodeKind::Section, &title, cx);
            let mut inner = Cx {
                f: callee,
                locals: params(callee),
                section: Some(section),
                depth: cx.depth - 1,
                returns: Some(vec![]),
            };
            self.stack.push(i);
            let frames = std::mem::take(&mut self.frames);
            let fell_through = self.steps(&callee.body, pending, &mut inner);
            self.frames = frames;
            self.stack.pop();
            let mut after = inner.returns.take().unwrap_or_default();
            after.extend(fell_through);
            // Several ways out of it: they meet after it
            pending = self.merge(after, cx);
            followed += 1;
        }
        (pending, followed)
    }
}

/// Has a function more than one plain step (a decision, a loop, or several steps)?
fn worth_following(body: &[Stmt]) -> bool {
    match body {
        [] => false,
        [Stmt::Simple { .. } | Stmt::Return { .. }] => false,
        [Stmt::Block(inner)] => worth_following(inner),
        _ => true,
    }
}

/// Parameters with a type, as locals
fn params(f: &Function) -> HashMap<String, String> {
    f.params.iter().filter_map(|(n, t)| t.as_ref().map(|t| (n.clone(), type_name(t)))).collect()
}

/// Is the statement just this call (maybe awaited, or assigned nowhere)?
fn same_call(statement: &str, call: &str) -> bool {
    let s = statement.trim().trim_start_matches("await ").trim_start_matches("return ").trim_end_matches(['?', '!']).trim();
    s == call.trim()
}

fn is_for_each(head: &str) -> bool {
    let h = head.trim_start();
    (h.starts_with("for") && (h.contains(" in ") || h.contains(" of ") || h.contains(" : ") || h.contains("range "))) || h.starts_with("foreach")
}

/// The activity diagram of a function, following calls `depth` deep.
pub fn activity(code: &Codebase, entry: &str, depth: u8) -> Option<CodeActivity> {
    let at = code.functions.iter().position(|f| f.id == entry)?;
    let f = &code.functions[at];
    let mut b = Builder { index: Index::new(code), blocks: vec![], lines: vec![], frames: vec![], stack: vec![at], end: 0, notes: vec![], cut: 0, plain: HashSet::new() };
    let title = match (&f.class, &f.route) {
        (Some(c), Some(r)) => format!("{c}.{}\n{r}", f.name),
        (Some(c), None) => format!("{c}.{}", f.name),
        (None, Some(r)) => format!("{}\n{r}", f.name),
        (None, None) => f.name.clone(),
    };
    // The function itself: a section with a start and an end
    let top = Cx { f, locals: HashMap::new(), section: None, depth, returns: None };
    let section = b.block(NodeKind::Section, &title, &top);
    let mut cx = Cx { f, locals: params(f), section: Some(section), depth, returns: None };
    let start = b.block(NodeKind::Start, "", &cx);
    b.end = b.block(NodeKind::End, "", &cx);
    let rest = b.steps(&f.body, vec![(start, None)], &mut cx);
    let end = b.end;
    b.join(rest, end);
    if b.cut > 0 {
        b.notes.push(format!("{} calls were not followed: the diagram has {MAX_BLOCKS} blocks already", b.cut));
    }
    Some(to_diagram(b))
}

fn to_diagram(b: Builder) -> CodeActivity {
    let mut nodes: Vec<Node> = b
        .blocks
        .iter()
        .map(|blk| {
            let (w, h) = match blk.kind {
                // A merge: small
                NodeKind::Diamond if blk.text.is_empty() => (40.0, 40.0),
                NodeKind::Section => (200.0, 120.0),
                k => fit(k, &blk.text),
            };
            node(blk.kind, 0.0, 0.0, w, h, &blk.text)
        })
        .collect();
    for (i, blk) in b.blocks.iter().enumerate() {
        if let Some(p) = blk.parent {
            nodes[i].parent = Some(nodes[p].id.clone());
        }
    }
    // The end is drawn last (after the steps), a lone end left out
    let mut edges: Vec<Edge> = b
        .lines
        .iter()
        .map(|(from, to, label)| edge(&nodes[*from].id, &nodes[*to].id, json!({ "label": label })))
        .collect();
    let reached: HashSet<&str> = edges.iter().map(|e| e.to.as_str()).collect();
    let end_id = nodes[b.end].id.clone();
    if !reached.contains(end_id.as_str()) {
        nodes.retain(|n| n.id != end_id);
        edges.retain(|e| e.from != end_id);
    }
    arranged(&mut nodes, &mut edges);
    CodeActivity { nodes, edges, notes: b.notes }
}
