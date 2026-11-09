//! UML classes as written in a class node's text: its name (with an optional
//! «interface», «abstract», «enum» or «record» line above it), then a `--` line,
//! its attributes, another `--`, and its operations. Rows use UML notation, the
//! same rules as the editor (`src/lib/classModel.ts`, `src/lib/umlClass.ts`):
//!
//!   attribute   [+|-|#|~] name: Type [= default]
//!   operation   [+|-|#|~] name(param: Type, ...)[: ReturnType]
//!
//! `static` (or `{static}`), `{abstract}` and `{readOnly}` may be added. Types are
//! free text in UML style (`int`, `Money`, `List<Line>`, `Customer?`).
//!
//! Read for the Mermaid export, the Mermaid import (which also lays classes out
//! here) and the SVG export (rows at a board's level of detail).

use std::collections::HashMap;

use crate::models::Node;

#[cfg(test)]
mod tests;

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
    /// Rows that are not UML notation, with why (the Mermaid export leaves them out)
    pub unreadable: Vec<String>,
}

/// What is written around a row's declaration: `+`, `-`, `#`, `~` in front, and
/// `static` / `{static}`, `{abstract}`, `{readOnly}`.
pub(crate) struct Modifiers {
    pub vis: Vis,
    pub is_static: bool,
    pub is_abstract: bool,
    pub read_only: bool,
}

pub(crate) fn modifiers(line: &str) -> (Modifiers, String) {
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
pub(crate) fn is_type(s: &str) -> bool {
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
pub(crate) fn link_accessors(c: &mut Class) {
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
pub(crate) fn link_constructors(c: &mut Class) {
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

/// How a row that is not UML notation is reported
const SKIPPED: &str = "Not in UML notation, skipped: ";


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

fn vis_mark(v: Vis) -> &'static str {
    match v {
        Vis::Public => "+ ",
        Vis::Private => "- ",
        Vis::Protected => "# ",
        Vis::Package => "~ ",
        Vis::Unset => "",
    }
}


fn words(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_alphanumeric() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        let boundary = c.is_uppercase()
            && !cur.is_empty()
            && (chars[i - 1].is_lowercase() || chars.get(i + 1).is_some_and(|n| n.is_lowercase()));
        if boundary {
            out.push(std::mem::take(&mut cur));
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn cap(w: &str) -> String {
    let mut c = w.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase()).unwrap_or_default()
}

/// `order_line` → `OrderLine`
pub fn pascal(s: &str) -> String {
    words(s).iter().map(|w| cap(w)).collect()
}

/// The arguments of a generic type, split on the top-level commas.
pub(crate) fn split_args(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut depth) = (vec![], String::new(), 0);
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth -= 1,
            ',' if depth == 0 => {
                out.push(std::mem::take(&mut cur).trim().to_string());
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// A class as a class node's text (for the Mermaid import).
pub(crate) fn class_text(c: &Class) -> String {
    let mut s = match c.kind {
        Kind::Interface => "«interface»\n".to_string(),
        Kind::Abstract => "«abstract»\n".to_string(),
        Kind::Enum => "«enum»\n".to_string(),
        Kind::Record => "«record»\n".to_string(),
        Kind::Class => String::new(),
    };
    s.push_str(&c.name);
    s.push_str(&c.generics());
    s.push_str("\n--\n");
    let mut rows: Vec<String> = vec![];
    if c.kind == Kind::Enum {
        rows.extend(c.values.iter().enumerate().map(|(i, v)| match c.enum_value(i) {
            Some(x) => format!("{v} = {x}"),
            None => v.clone(),
        }));
    }
    for f in &c.fields {
        let st = if f.is_static { "{static} " } else { "" };
        let default = f.default.as_deref().map_or(String::new(), |d| format!(" = {d}"));
        let ro = if f.read_only { " {readOnly}" } else { "" };
        rows.push(format!("{}{st}{}: {}{default}{ro}", vis_mark(f.vis), f.name, f.ty));
    }
    s.push_str(&rows.join("\n"));
    s.push_str("\n--\n");
    let ops: Vec<String> = c
        .methods
        .iter()
        .map(|m| {
            let st = if m.is_static { "{static} " } else { "" };
            let params: Vec<String> = m.params.iter().map(|(n, t)| format!("{n}: {t}")).collect();
            let ret = m.ret.as_deref().map_or(String::new(), |r| format!(": {r}"));
            let abs = if m.is_abstract { " {abstract}" } else { "" };
            format!("{}{st}{}({}){ret}{abs}", vis_mark(m.vis), m.name, params.join(", "))
        })
        .collect();
    s.push_str(&ops.join("\n"));
    s
}

/// How wide a row of classes gets before it goes on below
const ROW_WIDTH: f64 = 1600.0;

/// Rows: supertypes on top, the classes that extend or implement them below.
pub(crate) fn layout(classes: &[Class], ids: &HashMap<&str, String>) -> Vec<Node> {
    let by_name: HashMap<&str, &Class> = classes.iter().map(|c| (c.name.as_str(), c)).collect();
    fn level<'a>(c: &'a Class, by_name: &HashMap<&str, &'a Class>, seen: &mut Vec<&'a str>) -> usize {
        if seen.contains(&c.name.as_str()) {
            return 0;
        }
        seen.push(&c.name);
        let l = c.extends.iter().chain(&c.implements).filter_map(|s| by_name.get(s.as_str())).map(|s| level(s, by_name, seen) + 1).max().unwrap_or(0);
        seen.pop();
        l
    }
    let mut rows: Vec<Vec<(&Class, String, f64, f64)>> = vec![];
    for c in classes {
        let l = level(c, &by_name, &mut vec![]);
        if rows.len() <= l {
            rows.resize_with(l + 1, Vec::new);
        }
        let text = class_text(c);
        let longest = text.lines().map(|l| l.chars().count()).max().unwrap_or(10) as f64;
        let w = ((longest * 8.0 + 40.0).clamp(160.0, 480.0) / 10.0).ceil() * 10.0;
        let count = |i: usize| text.split("\n--\n").nth(i).map_or(1, |p| p.lines().count().max(1)) as f64;
        let h = ((34.0 + count(0) * 18.0 + 12.0 + count(1) * 19.0 + 12.0 + count(2) * 19.0 + 10.0) / 10.0).ceil() * 10.0;
        rows[l].push((c, text, w, h));
    }
    let mut out = vec![];
    let mut y = 0.0;
    for row in rows {
        let mut x = 0.0;
        let mut tallest: f64 = 0.0;
        for (c, text, w, h) in row {
            // A long row goes on below itself
            if x > 0.0 && x + w > ROW_WIDTH {
                x = 0.0;
                y += tallest + 60.0;
                tallest = 0.0;
            }
            out.push(
                serde_json::from_value(serde_json::json!({
                    "id": ids[c.name.as_str()], "kind": "class", "x": x, "y": y, "w": w, "h": h, "text": text, "color": "white"
                }))
                .expect("a valid node"),
            );
            x += w + 60.0;
            tallest = tallest.max(h);
        }
        y += tallest + 100.0;
    }
    out
}

/// A plain type name as a UML type: built-in types by their UML name, classes as they are.
pub(crate) fn named(t: &str) -> String {
    let lower = t.to_lowercase();
    let uml = match lower.as_str() {
        "int" | "integer" | "int32" | "i32" | "i16" | "i8" | "u8" | "u16" | "u32" | "short" | "byte" | "sbyte" | "uint" | "ushort" | "int16"
        | "int8" | "uint8" | "uint16" | "uint32" => "int",
        "long" | "int64" | "i64" | "u64" | "usize" | "isize" | "uint64" | "ulong" | "bigint" | "i128" | "u128" => "long",
        "double" | "float" | "f64" | "f32" | "float64" | "float32" | "single" | "number" => "double",
        "decimal" | "bigdecimal" => "decimal",
        "bool" | "boolean" => "bool",
        "string" | "str" | "char" | "character" | "rune" | "charsequence" => "string",
        "localdate" | "dateonly" => "date",
        "date" => "date",
        "localdatetime" | "datetime" | "instant" | "time.time" | "timestamp" | "offsetdatetime" | "datetimeoffset" | "zoneddatetime" => "datetime",
        "uuid" | "guid" => "uuid",
        "object" | "any" | "unknown" | "interface{}" => "object",
        "void" | "unit" | "none" | "()" | "nothing" | "never" => "void",
        _ => "",
    };
    if !uml.is_empty() {
        return uml.into();
    }
    // `java.util.Foo`, `models::Foo`, `pkg.Foo`
    let last = t.rsplit(['.', ':']).next().unwrap_or(t);
    pascal(last)
}
