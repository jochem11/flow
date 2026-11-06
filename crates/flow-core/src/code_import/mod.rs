//! Source code into a UML class diagram, for the same languages the code export
//! writes: TypeScript, Java, C#, Python, Kotlin, Rust and Go.
//!
//! Each language has a small reader (no full parser: declarations are found with
//! the scanner in `scan.rs`, Python by indentation) into the code export's own
//! model (`codegen::Class`), with types translated back to UML. The rest is
//! shared: supertypes, rows in the editor's notation, lines and layout.

mod csharp;
mod go;
mod java;
mod kotlin;
mod python;
mod rust;
mod scan;
#[cfg(test)]
mod tests;
mod typescript;

use std::collections::{BTreeSet, HashMap, HashSet};

use super::codegen::{camel, pascal, Class, Field, Kind, Method, Vis};
use crate::models::{CodeImport, CodeLanguage as L, Edge, Node};

/// The classes in source code, as a class diagram. Without a language it is guessed.
pub fn import_guessing(code: &str, language: Option<L>) -> CodeImport {
    import(code, language.unwrap_or_else(|| detect(code)))
}

/// What one reader found.
#[derive(Default)]
pub(super) struct Read {
    pub classes: Vec<Class>,
    /// Supertypes written without saying class or interface (C#, Python), per class
    pub bases: HashMap<String, Vec<String>>,
    pub package: Option<String>,
    pub skipped: Vec<String>,
}

pub(super) fn class(name: &str, kind: Kind) -> Class {
    Class {
        name: pascal(name),
        kind,
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

pub(super) fn field(vis: Vis, name: &str, ty: String, default: Option<String>, is_static: bool) -> Field {
    Field { vis, name: name.to_string(), ty, default: default.and_then(|d| clean_default(&d)), is_static, read_only: false }
}

pub(super) fn method(vis: Vis, name: &str, params: Vec<(String, String)>, ret: Option<String>, is_static: bool, is_abstract: bool) -> Method {
    let ret = ret.filter(|r| r != "void" && !r.is_empty());
    Method { vis, name: name.to_string(), params, ret, is_static, is_abstract, body: super::codegen::Body::Todo }
}

/// The class name without type parameters: `Box<T>` → `Box`.
pub(super) fn bare(name: &str) -> &str {
    name.split(['<', '[', '(', ' ', ':']).next().unwrap_or(name).trim()
}

/// The type parameters right after a type's name: `Repository<T, K extends X>`
/// and Go's `Repository[T any]` both give [T, K].
pub(super) fn type_params_after(decl: &str) -> Vec<String> {
    let d = decl.trim_start();
    let after = d[bare(d).len()..].trim_start();
    let Some(open) = after.chars().next().filter(|c| *c == '<' || *c == '[') else { return vec![] };
    match scan::group(after, open) {
        Some((before, inner, _)) if before.is_empty() => scan::split_top(inner, ',')
            .iter()
            .filter_map(|p| p.split([' ', ':']).next().map(str::to_string))
            .filter(|p| crate::codegen::is_ident(p))
            .collect(),
        _ => vec![],
    }
}

/// What an enum value stands for, as written in code, if it is more than its own
/// name (`PAID("Paid")` and `Paid = "Paid"` stand for nothing more).
pub(super) fn enum_value(name: &str, raw: Option<&str>) -> Option<String> {
    let v = raw?.trim().trim_end_matches(',').trim();
    let unquoted = v.trim_matches(['"', '\'']);
    (!v.is_empty() && !unquoted.eq_ignore_ascii_case(name)).then(|| v.to_string())
}

/// Guesses the language from what is typical for each.
pub fn detect(code: &str) -> L {
    let has = |s: &str| code.contains(s) as i32;
    let lines_start = |s: &str| code.lines().filter(|l| l.trim_start().starts_with(s)).count().min(3) as i32;
    // `class X:` / `def f(...):` lines, which only Python ends with a colon
    let python_blocks = code
        .lines()
        .map(str::trim)
        .filter(|l| (l.starts_with("class ") || l.starts_with("def ") || l.starts_with("async def ")) && l.ends_with(':'))
        .count()
        .min(3) as i32;
    let scores = [
        (L::Rust, 3 * has("fn ") + 2 * has("pub struct") + 2 * has("impl ") + 2 * has("#[derive") + has("-> ") + has("&self")),
        (L::Go, 3 * has("func ") + 3 * (has(" struct {") & !has("pub struct")) + 2 * lines_start("package ") * (1 - has("package ;")) + has(" := ")),
        (L::Python, 3 * python_blocks + 2 * has("self") + has("import ") * has("from ")),
        (L::Kotlin, 3 * has("fun ") + 2 * has("val ") + 2 * has("var ") + 2 * has("data class") + has(": Unit")),
        (L::CSharp, 3 * has("namespace ") + 3 * has("{ get;") + 2 * has("using System") + has("public override")),
        (L::Java, 3 * has("import java.") + 2 * (has("package ") & has(";")) + 2 * has("public class ") + has("@Override") + has("extends ")),
        (L::TypeScript, 3 * has("export ") + 2 * has(": string") + 2 * has(": number") + has("interface ") + has("readonly ")),
    ];
    // Kotlin's `fun` and Go's `func` look alike; `func ` contains no `fun `, so that is fine
    scores.iter().max_by_key(|(_, s)| *s).map_or(L::TypeScript, |(l, _)| *l)
}

pub fn import(code: &str, lang: L) -> CodeImport {
    let mut read = match lang {
        L::TypeScript => typescript::read(code),
        L::Java => java::read(code),
        L::CSharp => csharp::read(code),
        L::Python => python::read(code),
        L::Kotlin => kotlin::read(code),
        L::Rust => rust::read(code),
        L::Go => go::read(code),
    };
    resolve_bases(&mut read);
    let (nodes, edges) = diagram(&read.classes);
    CodeImport { nodes, edges, language: lang, package: read.package, skipped: read.skipped }
}

/// Supertypes in a list that does not say which is the class: an interface (known
/// from this code, or named `IThing`) is implemented, the first other one extended.
fn resolve_bases(read: &mut Read) {
    let kinds: HashMap<String, Kind> = read.classes.iter().map(|c| (c.name.clone(), c.kind)).collect();
    for c in &mut read.classes {
        let Some(bases) = read.bases.get(&c.name) else { continue };
        for b in bases {
            let b = pascal(bare(b));
            let looks_interface = b.len() > 1 && b.starts_with('I') && b[1..].starts_with(char::is_uppercase);
            let interface = kinds.get(&b).map_or(looks_interface, |k| *k == Kind::Interface);
            if interface || c.kind == Kind::Interface || c.extends.is_some() {
                c.implements.push(b);
            } else {
                c.extends = Some(b);
            }
        }
    }
}

// ---------- types ----------

/// A type as written in a language, as a UML type (the reverse of `codegen::types::ty`).
pub(super) fn uml_type(t: &str, l: L) -> String {
    let t = t.trim().trim_start_matches("readonly ").trim();
    if t.is_empty() {
        return "object".into();
    }
    // Unions with null: `X | null`, `X | None`
    let parts = scan::split_top(t, '|');
    if parts.len() > 1 {
        let real: Vec<&String> = parts.iter().filter(|p| !matches!(p.as_str(), "null" | "undefined" | "None")).collect();
        return match real.as_slice() {
            [one] => optional(uml_type(one, l)),
            _ => "object".into(),
        };
    }
    // Quoted forward references (Python), references and pointers
    let t = t.trim_matches(|c| c == '"' || c == '\'');
    if let Some(r) = t.strip_prefix('&') {
        let r = r.trim_start_matches("mut ").trim();
        let r = if r.starts_with('\'') { r.split_once(' ').map_or(r, |x| x.1) } else { r };
        if let Some(inner) = r.strip_prefix('[').and_then(|x| x.strip_suffix(']')) {
            return format!("List<{}>", uml_type(inner, l));
        }
        return uml_type(r, l);
    }
    if let Some(r) = t.strip_prefix("dyn ").or_else(|| t.strip_prefix("impl ")) {
        return uml_type(r.split('+').next().unwrap_or(r), l);
    }
    if let Some(inner) = t.strip_suffix('?') {
        return optional(uml_type(inner, l));
    }
    if let Some(inner) = t.strip_prefix("[]") {
        return format!("List<{}>", uml_type(inner.trim_start_matches('*'), l));
    }
    if let Some(inner) = t.strip_prefix('*') {
        return optional(uml_type(inner, l));
    }
    if let Some(inner) = t.strip_suffix("[]") {
        return format!("List<{}>", uml_type(inner, l));
    }
    // Go: map[K]V
    if let Some(rest) = t.strip_prefix("map[") {
        if let Some((k, v)) = rest.split_once(']') {
            return format!("Map<{}, {}>", uml_type(k, l), uml_type(v, l));
        }
    }
    let open = if matches!(l, L::Python | L::Go) { '[' } else { '<' };
    if let Some((base, args, _)) = scan::group(t, open) {
        let base = base.trim().rsplit(['.', ':']).next().unwrap_or(base).trim();
        let args: Vec<String> = scan::split_top(args, ',').iter().map(|a| uml_type(a, l)).collect();
        return match (base.to_lowercase().as_str(), args.as_slice()) {
            ("option" | "optional", [a]) => optional(a.clone()),
            ("box" | "rc" | "arc" | "refcell" | "cell" | "lazy" | "ref" | "promise" | "task" | "future", [a]) => a.clone(),
            (
                "list" | "vec" | "array" | "arraylist" | "mutablelist" | "ilist" | "ienumerable" | "icollection" | "collection" | "iterable"
                | "readonlyarray" | "ireadonlylist" | "set" | "hashset" | "mutableset" | "iset" | "sortedset" | "treeset" | "btreeset"
                | "linkedlist" | "sequence" | "tuple" | "deque" | "vecdeque" | "frozenset",
                [a],
            ) => format!("List<{a}>"),
            (
                "map" | "hashmap" | "btreemap" | "dictionary" | "idictionary" | "mutablemap" | "dict" | "record" | "treemap" | "linkedhashmap"
                | "ireadonlydictionary" | "mapping",
                [k, v],
            ) => format!("Map<{k}, {v}>"),
            ("classvar" | "final", [a]) => a.clone(),
            _ => format!("{}<{}>", pascal(base), args.join(", ")),
        };
    }
    named(t, l)
}

fn optional(t: String) -> String {
    if t.ends_with('?') { t } else { format!("{t}?") }
}

/// A plain type name as a UML type: built-in types by their UML name, classes as they are.
fn named(t: &str, l: L) -> String {
    let lower = t.to_lowercase();
    let uml = match lower.as_str() {
        "number" if l == L::TypeScript => "double",
        "int" | "integer" | "int32" | "i32" | "i16" | "i8" | "u8" | "u16" | "u32" | "short" | "byte" | "sbyte" | "uint" | "ushort" | "int16"
        | "int8" | "uint8" | "uint16" | "uint32" => "int",
        "long" | "int64" | "i64" | "u64" | "usize" | "isize" | "uint64" | "ulong" | "bigint" | "i128" | "u128" => "long",
        "double" | "float" | "f64" | "f32" | "float64" | "float32" | "single" | "number" => "double",
        "decimal" | "bigdecimal" => "decimal",
        "bool" | "boolean" => "bool",
        "string" | "str" | "char" | "character" | "rune" | "charsequence" => "string",
        "localdate" | "dateonly" => "date",
        "date" if l == L::TypeScript => "datetime",
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

/// A default as UML text, or None for "nothing set yet" (null, empty lists, ...).
fn clean_default(d: &str) -> Option<String> {
    let d = d.trim().trim_end_matches(';').trim();
    let lower = d.to_lowercase();
    let empty = ["null", "none", "nil", "undefined", "[]", "{}", "new()", "list()", "dict()", "set()", "default", "default!", "null!", "\"\"", "''", "string.empty"];
    if empty.contains(&lower.as_str())
        || lower.starts_with("field(")
        || lower.starts_with("new arraylist")
        || lower.starts_with("new hashmap")
        || lower.starts_with("new list")
        || lower.starts_with("mutablelistof")
        || lower.starts_with("listof")
        || lower.starts_with("vec::new")
        || lower.starts_with("default::default")
        || lower.ends_with("::new()")
    {
        return None;
    }
    // new BigDecimal("0"), Decimal("1.5"), BigDecimal("0") → 0
    if let Some((_, inner, _)) = scan::group(d, '(') {
        let inner = inner.trim().trim_matches('"');
        if inner.parse::<f64>().is_ok() {
            return Some(inner.into());
        }
        return None;
    }
    // 0m, 1.5f, 10L
    let number = d.trim_end_matches(['m', 'M', 'f', 'F', 'L', 'l', 'd', 'D']);
    if number.parse::<f64>().is_ok() {
        return Some(number.into());
    }
    match lower.as_str() {
        "true" => Some("true".into()),
        "false" => Some("false".into()),
        _ => Some(d.to_string()),
    }
}

/// Member names as the diagram writes them (camelCase): `order_lines`, `OrderLines` → `orderLines`.
pub(super) fn member(name: &str) -> String {
    let n = name.trim_start_matches('_');
    if n.contains('_') || n.starts_with(char::is_uppercase) { camel(n) } else { n.to_string() }
}

// ---------- the diagram ----------

fn vis_mark(v: Vis) -> &'static str {
    match v {
        Vis::Public => "+ ",
        Vis::Private => "- ",
        Vis::Protected => "# ",
        Vis::Package => "~ ",
        Vis::Unset => "",
    }
}

/// The class as node text in the editor's notation (see `read_class`).
fn class_text(c: &Class) -> String {
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

/// The class named in a type, if it is one of `names`, and whether it is a list of them.
fn refers_to<'a>(t: &str, names: &'a BTreeSet<String>) -> Option<(&'a String, bool)> {
    let many = t.starts_with("List<");
    let inner = t.strip_prefix("List<").and_then(|x| x.strip_suffix('>')).unwrap_or(t).trim_end_matches('?');
    names.get(inner).map(|n| (n, many))
}

fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn diagram(classes: &[Class]) -> (Vec<Node>, Vec<Edge>) {
    let names: BTreeSet<String> = classes.iter().map(|c| c.name.clone()).collect();
    let ids: HashMap<&str, String> = classes.iter().map(|c| (c.name.as_str(), uid())).collect();
    let mut edges: Vec<serde_json::Value> = vec![];
    let mut linked: HashSet<(String, String)> = HashSet::new();
    let link = |edges: &mut Vec<serde_json::Value>, linked: &mut HashSet<(String, String)>, a: &str, b: &str, extra: serde_json::Value| {
        let mut e = serde_json::json!({ "id": uid(), "from": ids[a], "to": ids[b], "style": "elbow" });
        e.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        edges.push(e);
        linked.insert((a.to_string(), b.to_string()));
        linked.insert((b.to_string(), a.to_string()));
    };

    let mut shown: Vec<Class> = vec![];
    for c in classes {
        let mut c = c.clone();
        if let Some(sup) = c.extends.clone().filter(|s| names.contains(s) && *s != c.name) {
            link(&mut edges, &mut linked, &c.name, &sup, serde_json::json!({ "endCap": "triangle" }));
        }
        for i in c.implements.iter().filter(|s| names.contains(*s) && **s != c.name) {
            // An interface that extends another: a solid line
            let pattern = if c.kind == Kind::Interface { "solid" } else { "dashed" };
            link(&mut edges, &mut linked, &c.name, i, serde_json::json!({ "endCap": "triangle", "pattern": pattern }));
        }
        // A field that holds another class: a line. When the line says it all (the
        // export makes the same field from it), the row goes.
        let mut rows = vec![];
        for f in std::mem::take(&mut c.fields) {
            let Some((part, many)) = refers_to(&f.ty, &names).filter(|(p, _)| **p != c.name) else {
                rows.push(f);
                continue;
            };
            let derived = camel(&if many { super::codegen::plural(part) } else { part.clone() });
            // A getter or setter needs the row: it is linked to it before lines add fields
            let accessor = c.methods.iter().any(|m| [format!("get{}", pascal(&f.name)), format!("set{}", pascal(&f.name))].contains(&m.name));
            let plain = f.name == derived && matches!(f.vis, Vis::Private | Vis::Unset) && !f.is_static && f.default.is_none() && !accessor;
            if plain && many {
                link(&mut edges, &mut linked, &c.name, part, serde_json::json!({ "startCap": "hollowDiamond", "endCap": "none", "endLabel": "*" }));
            } else if plain {
                link(&mut edges, &mut linked, &c.name, part, serde_json::json!({ "endCap": "open", "endLabel": "0..1" }));
            } else {
                if !linked.contains(&(c.name.clone(), part.clone())) {
                    link(&mut edges, &mut linked, &c.name, part, serde_json::json!({ "endCap": "open" }));
                }
                rows.push(f);
            }
        }
        c.fields = rows;
        // Types of parameters and results need a line too (a dependency) to be allowed
        let used: BTreeSet<String> = c
            .methods
            .iter()
            .flat_map(|m| m.params.iter().map(|p| p.1.clone()).chain(m.ret.clone()))
            .chain(c.fields.iter().map(|f| f.ty.clone()))
            .flat_map(|t| t.split(|ch: char| !(ch.is_alphanumeric() || ch == '_')).map(String::from).collect::<Vec<_>>())
            .filter(|w| names.contains(w) && *w != c.name)
            .collect();
        for u in used {
            if !linked.contains(&(c.name.clone(), u.clone())) {
                link(&mut edges, &mut linked, &c.name, &u, serde_json::json!({ "endCap": "open", "pattern": "dashed" }));
            }
        }
        shown.push(c);
    }

    let nodes = layout(&shown, &ids);
    let edges = edges.into_iter().map(|e| serde_json::from_value(e).expect("a valid edge")).collect();
    (nodes, edges)
}

/// Rows: supertypes on top, the classes that extend or implement them below.
fn layout(classes: &[Class], ids: &HashMap<&str, String>) -> Vec<Node> {
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
