//! Reading the diagram: classes, their rows and the lines between them.

use super::*;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind {
    Class,
    Abstract,
    Interface,
    Enum,
    /// `«record»`: a value type (Java and C# records, a Kotlin data class, a frozen dataclass)
    Record,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Vis {
    Public,
    Private,
    Protected,
    Package,
    /// Not written: each language picks its usual default
    Unset,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Field {
    pub vis: Vis,
    pub name: String,
    pub ty: String,
    pub default: Option<String>,
    pub is_static: bool,
    /// `{readOnly}`: set once (final, readonly, val), no setter
    pub read_only: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Method {
    pub vis: Vis,
    pub name: String,
    pub params: Vec<(String, String)>,
    pub ret: Option<String>,
    pub is_static: bool,
    pub is_abstract: bool,
    pub body: Body,
}

/// What a generated method does.
#[derive(Debug, Clone, PartialEq)]
pub enum Body {
    /// Throws "not implemented"
    Todo,
    /// Returns this attribute
    Get(String),
    /// Sets this attribute to this parameter
    Set(String, String),
    /// A constructor (an operation named after the class): sets these
    /// attributes (first) to these parameters (second)
    Init(Vec<(String, String)>),
}

#[derive(Debug, Clone)]
pub struct Class {
    pub name: String,
    pub kind: Kind,
    pub fields: Vec<Field>,
    pub methods: Vec<Method>,
    /// Enum values
    pub values: Vec<String>,
    /// What each enum value stands for, when the diagram says (`Paid = 2`), in
    /// the order of `values` (may be shorter: the rest have none)
    pub enum_values: Vec<Option<String>>,
    /// Generic type parameters: `Repository<T>` has ["T"]
    pub type_params: Vec<String>,
    pub extends: Option<String>,
    pub implements: Vec<String>,
    pub package: Option<String>,
    /// Rows that could not be used, with why: written as a comment in the code
    pub unreadable: Vec<String>,
}

/// What is written around a row's declaration: `+`, `-`, `#`, `~` in front, and
/// `static` / `{static}`, `{abstract}`, `{readOnly}`.
pub(super) struct Modifiers {
    pub vis: Vis,
    pub is_static: bool,
    pub is_abstract: bool,
    pub read_only: bool,
}

pub(super) fn modifiers(line: &str) -> (Modifiers, String) {
    let mut s = line.trim().to_string();
    let vis = match s.chars().next() {
        Some('+') => Vis::Public,
        Some('-') => Vis::Private,
        Some('#') => Vis::Protected,
        Some('~') => Vis::Package,
        _ => Vis::Unset,
    };
    if vis != Vis::Unset {
        s = s[1..].trim().to_string();
    }
    let mut is_static = false;
    for marker in ["{static}", "static "] {
        if s.contains(marker) {
            is_static = true;
            s = s.replace(marker, "").trim().to_string();
        }
    }
    let is_abstract = s.contains("{abstract}");
    s = s.replace("{abstract}", "").trim().to_string();
    let read_only = s.to_lowercase().contains("{readonly}");
    if read_only {
        let at = s.to_lowercase().find("{readonly}").unwrap();
        s.replace_range(at..at + "{readonly}".len(), "");
        s = s.trim().to_string();
    }
    (Modifiers { vis, is_static, is_abstract, read_only }, s)
}

pub fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_alphabetic() || c == '_') && chars.all(|c| c.is_alphanumeric() || c == '_')
}

/// A type: an identifier, optionally `Name<...>`, `Name[]` or `Name?`.
pub(super) fn is_type(s: &str) -> bool {
    let s = s.trim().trim_end_matches('?').trim_end_matches("[]");
    match s.find('<') {
        Some(i) if s.ends_with('>') => is_ident(&s[..i]) && split_args(&s[i + 1..s.len() - 1]).iter().all(|a| is_type(a)),
        Some(_) => false,
        None => is_ident(s),
    }
}

/// `[+] name: Type [= default]`
pub fn parse_attribute(line: &str) -> Option<Field> {
    let (Modifiers { vis, is_static, read_only, .. }, rest) = modifiers(line);
    let (decl, default) = match rest.split_once('=') {
        Some((d, v)) => (d.trim(), Some(v.trim().to_string()).filter(|v| !v.is_empty())),
        None => (rest.as_str(), None),
    };
    let (name, ty) = decl.split_once(':')?;
    let (name, ty) = (name.trim().trim_start_matches('/'), ty.trim());
    (is_ident(name) && is_type(ty)).then(|| Field { vis, name: name.into(), ty: ty.into(), default, is_static, read_only })
}

/// `[+] name(param: Type, ...)[: ReturnType]`
pub fn parse_operation(line: &str) -> Option<Method> {
    let (Modifiers { vis, is_static, is_abstract, .. }, rest) = modifiers(line);
    // `getName: String`, without the (): an operation without parameters
    if !rest.contains('(') {
        let (name, ret) = rest.split_once(':')?;
        let (name, ret) = (name.trim(), ret.trim());
        return (is_ident(name) && is_type(ret)).then(|| Method {
            vis,
            name: name.into(),
            params: vec![],
            ret: Some(ret.into()),
            is_static,
            is_abstract,
            body: Body::Todo,
        });
    }
    let open = rest.find('(')?;
    let close = rest.rfind(')')?;
    let name = rest[..open].trim();
    if !is_ident(name) || close < open {
        return None;
    }
    let mut params = vec![];
    // On the top-level commas: `index(map: Map<string, int>)` has one parameter
    for p in split_args(&rest[open + 1..close]).iter().map(|p| p.trim()).filter(|p| !p.is_empty()) {
        let (n, t) = p.split_once(':')?;
        let (n, t) = (n.trim(), t.trim());
        if !is_ident(n) || !is_type(t) {
            return None;
        }
        params.push((n.to_string(), t.to_string()));
    }
    let after = rest[close + 1..].trim();
    let ret = match after.strip_prefix(':') {
        Some(t) if is_type(t.trim()) => Some(t.trim().to_string()),
        Some(_) => return None,
        None if after.is_empty() => None,
        None => return None,
    };
    Some(Method { vis, name: name.into(), params, ret, is_static, is_abstract, body: Body::Todo })
}

/// Getters and setters: an operation that returns an attribute (by name, or
/// `getX()` / `isX()` for attribute `x`) returns it; `setX(value)` sets it.
pub(super) fn link_accessors(c: &mut Class) {
    let field = |name: &str| c.fields.iter().find(|f| f.name.eq_ignore_ascii_case(name)).cloned();
    let prop = |method: &str, prefix: &str| method.strip_prefix(prefix).filter(|r| r.starts_with(char::is_uppercase)).and_then(field);
    let mut out = c.methods.clone();
    for m in out.iter_mut().filter(|m| !m.is_static && !m.is_abstract) {
        let returned = m.ret.as_deref().and_then(field);
        if let (Some(f), true) = (returned, m.params.is_empty()) {
            m.ret = Some(f.ty.clone());
            m.body = Body::Get(f.name);
        } else if let (Some(f), true) = (prop(&m.name, "get").or_else(|| prop(&m.name, "is")), m.params.is_empty()) {
            m.ret.get_or_insert(f.ty.clone());
            m.body = Body::Get(f.name);
        } else if let (Some(f), [(p, _)]) = (prop(&m.name, "set"), m.params.as_slice()) {
            m.body = Body::Set(f.name, p.clone());
        }
    }
    c.methods = out;
}

/// Name, kind and rows of one class node.
/// One class node as written: its name, kind and rows, without what the lines add.
pub fn read_class(n: &Node) -> Class {
    let mut parts: Vec<Vec<&str>> = vec![vec![]];
    for line in n.text.lines() {
        if line.trim() == "--" {
            parts.push(vec![]);
        } else if !line.trim().is_empty() {
            parts.last_mut().unwrap().push(line.trim());
        }
    }
    parts.resize(3, vec![]);
    let mut kind = Kind::Class;
    let mut name = String::new();
    for line in &parts[0] {
        match line.to_lowercase().as_str() {
            "«interface»" | "<<interface>>" => kind = Kind::Interface,
            "«abstract»" | "<<abstract>>" => kind = Kind::Abstract,
            "«enum»" | "<<enum>>" | "«enumeration»" => kind = Kind::Enum,
            "«record»" | "<<record>>" => kind = Kind::Record,
            _ if name.is_empty() => name = line.to_string(),
            _ => {}
        }
    }
    // `Repository<T, K>`: the name, and its type parameters
    let (name, type_params) = match name.split_once('<') {
        Some((base, rest)) if rest.trim_end().ends_with('>') => {
            let params = split_args(rest.trim_end().trim_end_matches('>')).into_iter().filter(|p| is_ident(p)).collect();
            (base.trim().to_string(), params)
        }
        _ => (name, vec![]),
    };
    let name = pascal(if name.is_empty() { "Unnamed" } else { &name });
    let mut class = Class {
        name,
        kind,
        fields: vec![],
        methods: vec![],
        values: vec![],
        enum_values: vec![],
        type_params,
        extends: None,
        implements: vec![],
        package: None,
        unreadable: vec![],
    };
    for row in &parts[1] {
        if kind == Kind::Enum {
            let v = row.trim_start_matches(['+', '-', '#', '~']).trim();
            // `Paid`, or `Paid = 2` / `Paid = "paid"`
            let (v, value) = match v.split_once('=') {
                Some((n, val)) => (n.trim(), Some(val.trim().to_string()).filter(|x| !x.is_empty())),
                None => (v, None),
            };
            if is_ident(v) {
                class.values.push(v.to_string());
                class.enum_values.push(value);
            } else {
                class.unreadable.push(format!("{SKIPPED}{row}"));
            }
        } else if let Some(f) = parse_attribute(row) {
            class.fields.push(f);
        } else {
            class.unreadable.push(format!("{SKIPPED}{row}"));
        }
    }
    for row in &parts[2] {
        match parse_operation(row) {
            Some(m) => class.methods.push(m),
            None => class.unreadable.push(format!("{SKIPPED}{row}")),
        }
    }
    for row in parts.iter().skip(3).flatten() {
        class.unreadable.push(format!("{SKIPPED}{row}"));
    }
    link_accessors(&mut class);
    link_constructors(&mut class);
    class
}

/// An operation named after the class is its constructor: it sets the attributes
/// whose names its parameters have (`+ Order(id: int, customer: Customer)`).
pub(super) fn link_constructors(c: &mut Class) {
    let fields: Vec<String> = c.fields.iter().filter(|f| !f.is_static).map(|f| f.name.clone()).collect();
    for m in c.methods.iter_mut().filter(|m| pascal(&m.name) == c.name && !m.is_static) {
        let sets = m
            .params
            .iter()
            .filter_map(|(p, _)| fields.iter().find(|f| f.eq_ignore_ascii_case(p)).map(|f| (f.clone(), p.clone())))
            .collect();
        m.ret = None;
        m.body = Body::Init(sets);
    }
}

/// How a row that is not UML notation is reported (the code export writes it as a comment)
const SKIPPED: &str = "Not in UML notation, skipped: ";

/// Generic types that are lists, sets and maps of their arguments (not classes)
pub(super) const CONTAINERS: [&str; 11] = ["list", "collection", "array", "vec", "sequence", "set", "hashset", "map", "dict", "dictionary", "hashmap"];

/// The first name in type `t` that is not a built-in type, the class itself, or a class on the board.
pub(super) fn unknown_in(t: &str, own: &str, related: &BTreeSet<String>) -> Option<String> {
    t.split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .filter(|w| !w.is_empty() && !CONTAINERS.contains(&w.to_lowercase().as_str()))
        .find(|w| builtin(w).is_none() && pascal(w) != own && !related.contains(&pascal(w)))
        .map(String::from)
}

/// Moves attributes and operations with types the class cannot use to `unreadable`,
/// with why (the editor marks the same rows, see `rowProblem` in umlClass.ts).
/// `known`: the classes on the board (the editor draws a line to one when it is used).
pub(super) fn check_types(c: &mut Class, known: &BTreeSet<String>) {
    let related = known;
    let why = |t: &str| format!("Unknown type `{t}` (not built in, and no class on this board), skipped:");
    let (own, mut skipped) = (c.name.clone(), vec![]);
    c.fields.retain(|f| match unknown_in(&f.ty, &own, related) {
        Some(t) => {
            skipped.push(format!("{} attribute {}: {}", why(&t), f.name, f.ty));
            false
        }
        None => true,
    });
    c.methods.retain(|m| {
        let types = m.params.iter().map(|p| p.1.as_str()).chain(m.ret.as_deref());
        match types.filter_map(|t| unknown_in(t, &own, related)).next() {
            Some(t) => {
                skipped.push(format!("{} operation {}()", why(&t), m.name));
                false
            }
            None => true,
        }
    });
    c.unreadable.extend(skipped);
}

/// Is this multiplicity more than one? (`*`, `0..*`, `1..5`)
pub(super) fn is_many(label: Option<&str>) -> bool {
    let Some(l) = label else { return false };
    l.contains('*') || l.rsplit("..").next().and_then(|u| u.trim().parse::<u32>().ok()).is_some_and(|u| u > 1)
}

/// All classes in the diagram, with what the lines between them say.
pub fn read_classes(flow: &FlowDoc) -> Vec<Class> {
    let by_id: HashMap<&str, &Node> = flow.nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut classes: Vec<(String, Class)> = flow
        .nodes
        .iter()
        .filter(|n| n.kind == NodeKind::Class)
        .map(|n| {
            let mut c = read_class(n);
            // The package it is drawn in
            c.package = n
                .parent
                .as_deref()
                .and_then(|p| by_id.get(p))
                .filter(|p| p.kind == NodeKind::Package)
                .map(|p| p.text.lines().next().unwrap_or("").trim().to_string())
                .filter(|p| !p.is_empty());
            (n.id.clone(), c)
        })
        .collect();
    let index: HashMap<String, usize> = classes.iter().enumerate().map(|(i, (id, _))| (id.clone(), i)).collect();
    let name_of = |i: usize, classes: &[(String, Class)]| classes[i].1.name.clone();

    // A class may use built-in types, the classes on the board and its own type parameters.
    // A relaxed board shows only the focus points: other types are classes elsewhere,
    // and rows in free text are notes
    let known: BTreeSet<String> = classes.iter().map(|(_, c)| c.name.clone()).collect();
    for (_, c) in classes.iter_mut() {
        if flow.relaxed == Some(true) {
            for u in c.unreadable.iter_mut() {
                if let Some(row) = u.strip_prefix(SKIPPED) {
                    *u = format!("Note: {row}");
                }
            }
            continue;
        }
        let mut own = known.clone();
        own.extend(c.type_params.iter().cloned());
        check_types(c, &own);
    }

    for e in &flow.edges {
        let (Some(&a), Some(&b)) = (index.get(&e.from), index.get(&e.to)) else { continue };
        let start = e.start_cap.unwrap_or(EdgeCap::None);
        let end = e.end_cap.unwrap_or(EdgeCap::Arrow);
        let dashed = e.pattern == Some(LinePattern::Dashed);

        if end == EdgeCap::Triangle {
            // Generalization or realization: from is the subtype
            let sup = name_of(b, &classes);
            if dashed || classes[b].1.kind == Kind::Interface {
                classes[a].1.implements.push(sup);
            } else {
                classes[a].1.extends = Some(sup);
            }
            continue;
        }
        let (whole, part, label) = match (start, end) {
            (EdgeCap::Diamond | EdgeCap::HollowDiamond, _) => (a, b, e.end_label.as_deref()),
            (_, EdgeCap::Diamond | EdgeCap::HollowDiamond) => (b, a, e.start_label.as_deref()),
            // A dependency (dashed arrow) is not a field
            (_, EdgeCap::Arrow | EdgeCap::Open) if !dashed => (a, b, e.end_label.as_deref()),
            (EdgeCap::None, EdgeCap::None) if !dashed => (a, b, e.end_label.as_deref()),
            _ => continue,
        };
        let part_name = name_of(part, &classes);
        let many = is_many(label);
        let field = camel(&if many { plural(&part_name) } else { part_name.clone() });
        let w = &mut classes[whole].1;
        // Not when an attribute already refers to that class (`owner: Customer`)
        let refers = |f: &Field| f.ty.split(|c: char| !(c.is_alphanumeric() || c == '_')).any(|t| pascal(t) == part_name);
        if w.kind != Kind::Enum && !w.fields.iter().any(|f| f.name == field || refers(f)) {
            let ty = if many { format!("List<{part_name}>") } else { format!("{part_name}?") };
            w.fields.push(Field { vis: Vis::Private, name: field, ty, default: None, is_static: false, read_only: false });
        }
    }

    // Supertypes before subtypes (Python and TypeScript need that)
    let mut out: Vec<Class> = vec![];
    let mut rest: Vec<Class> = classes.into_iter().map(|(_, c)| c).collect();
    while !rest.is_empty() {
        let names: BTreeSet<String> = rest.iter().map(|c| c.name.clone()).collect();
        let ready = rest
            .iter()
            .position(|c| c.extends.iter().chain(&c.implements).all(|s| !names.contains(s) || *s == c.name))
            .unwrap_or(0);
        out.push(rest.remove(ready));
    }
    out
}

// ---------- rows as a board's language shows them (as rowIn in src/lib/classModel.ts) ----------

fn vis_mark(v: Vis) -> &'static str {
    match v {
        Vis::Public => "+ ",
        Vis::Private => "- ",
        Vis::Protected => "# ",
        Vis::Package => "~ ",
        Vis::Unset => "",
    }
}

/// A class row with its types as `lang` writes them: `part` 1 is attributes, 2
/// operations. Enum values and rows that are not UML notation stay as they are.
pub fn row_in(part: usize, is_enum: bool, line: &str, lang: CodeLanguage) -> String {
    let t = |s: &str| ty(&parse_ty(s), lang, false);
    match part {
        1 if !is_enum => match parse_attribute(line) {
            Some(f) => format!(
                "{}{}{}: {}{}{}",
                vis_mark(f.vis),
                if f.is_static { "static " } else { "" },
                f.name,
                t(&f.ty),
                f.default.map_or(String::new(), |d| format!(" = {d}")),
                if f.read_only { " {readOnly}" } else { "" }
            ),
            None => line.to_string(),
        },
        2 => match parse_operation(line) {
            Some(m) => format!(
                "{}{}{}({}){}{}",
                vis_mark(m.vis),
                if m.is_static { "static " } else { "" },
                m.name,
                m.params.iter().map(|(n, p)| format!("{n}: {}", t(p))).collect::<Vec<_>>().join(", "),
                m.ret.map_or(String::new(), |r| format!(": {}", t(&r))),
                if m.is_abstract { " {abstract}" } else { "" }
            ),
            None => line.to_string(),
        },
        _ => line.to_string(),
    }
}

// ---------- enum values and type parameters, as the generators write them ----------

impl Class {
    /// The value an enum value stands for, if the diagram gives one.
    pub fn enum_value(&self, i: usize) -> Option<&str> {
        self.enum_values.get(i).and_then(|v| v.as_deref())
    }

    /// Do the enum's values stand for numbers (all that are given)? None: no values given.
    pub fn enum_numbers(&self) -> Option<bool> {
        let given: Vec<&str> = (0..self.values.len()).filter_map(|i| self.enum_value(i)).collect();
        (!given.is_empty()).then(|| given.iter().all(|v| v.parse::<i64>().is_ok()))
    }

    /// Enum value `i` as a literal: its number, or its text in quotes (the name when none is given).
    pub fn enum_literal(&self, i: usize) -> String {
        match (self.enum_numbers(), self.enum_value(i)) {
            (Some(true), Some(v)) => v.to_string(),
            (Some(true), None) => i.to_string(),
            (_, Some(v)) if v.starts_with('"') => v.to_string(),
            (_, Some(v)) => format!("{:?}", v.trim_matches('\'')),
            (_, None) => format!("{:?}", self.values[i]),
        }
    }

    /// `<T, K>` after the name (empty without type parameters).
    pub fn generics(&self) -> String {
        if self.type_params.is_empty() { String::new() } else { format!("<{}>", self.type_params.join(", ")) }
    }
}

/// Whether a class row is shown at a board's level of detail (as rowShown in
/// src/lib/classModel.ts): `part` 1 is attributes (or enum values), 2 operations.
pub fn row_shown(part: usize, is_enum: bool, line: &str, detail: crate::models::ClassDetail) -> bool {
    use crate::models::ClassDetail as D;
    match (detail, part) {
        (D::All, _) | (_, 0) => true,
        (D::Names, _) => false,
        (D::Public, 1) if is_enum => true,
        // Attributes are private, operations public, when not written
        (D::Public, 1) => parse_attribute(line).is_none_or(|f| f.vis == Vis::Public),
        (D::Public, _) => parse_operation(line).is_none_or(|m| matches!(m.vis, Vis::Public | Vis::Unset)),
    }
}
