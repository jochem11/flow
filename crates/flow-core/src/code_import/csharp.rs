//! C#: classes, interfaces, enums, records and structs, with properties.

use super::scan::{group, items, modifiers, split_top, strip_comments};
use super::*;

const MODS: &[&str] = &[
    "public", "private", "protected", "internal", "static", "virtual", "override", "abstract", "sealed", "readonly", "async", "new", "extern",
    "partial", "const", "volatile", "required", "unsafe", "file",
];

pub fn read(code: &str) -> Read {
    let mut r = Read::default();
    block(&strip_comments(code), &mut r);
    r
}

fn block(src: &str, r: &mut Read) {
    for item in items(src, false) {
        let decl = attributes(&item.decl());
        if let Some(ns) = decl.strip_prefix("namespace ") {
            r.package.get_or_insert(ns.trim().to_string());
            if let Some(body) = &item.body {
                block(body, r);
            }
        } else if let Some(body) = &item.body {
            type_decl(&decl, body, r);
        }
    }
}

/// Without `[Attribute]` lists in front.
fn attributes(decl: &str) -> String {
    let mut s = decl.trim();
    while s.starts_with('[') {
        s = group(s, '[').map_or("", |g| g.2).trim();
    }
    s.to_string()
}

fn type_decl(decl: &str, body: &str, r: &mut Read) -> bool {
    let (mods, rest) = modifiers(decl, MODS);
    let rest = rest.strip_prefix("record ").map_or(rest, |x| x.trim_start_matches("class ").trim_start_matches("struct "));
    let (kind, rest) = if let Some(x) = rest.strip_prefix("class ").or_else(|| rest.strip_prefix("struct ")) {
        (if mods.contains(&"abstract") { Kind::Abstract } else { Kind::Class }, x)
    } else if let Some(x) = rest.strip_prefix("interface ") {
        (Kind::Interface, x)
    } else if let Some(x) = rest.strip_prefix("enum ") {
        (Kind::Enum, x)
    } else if decl.contains("record ") {
        (Kind::Record, rest)
    } else {
        return false;
    };
    let name = bare(rest);
    // `record class` and `record struct` are records too
    let kind = if decl.contains("record ") && kind == Kind::Class { Kind::Record } else { kind };
    let mut c = class(name, kind);
    c.type_params = type_params_after(rest);
    // : Base, IThing where T : ...
    let after = rest[name.len()..].trim_start();
    let after = if after.starts_with('<') { group(after, '<').map_or(after, |g| g.2) } else { after };
    // A positional record: its parameters are its properties
    if kind == Kind::Record && after.trim_start().starts_with('(') {
        if let Some((_, comps, _)) = group(after, '(') {
            for (n, t) in params_of(comps) {
                c.fields.push(field(Vis::Public, &member_name(&n), t, None, false));
            }
        }
    }
    let after = if after.trim_start().starts_with('(') { group(after, '(').map_or(after, |g| g.2) } else { after };
    if let Some(list) = after.trim().strip_prefix(':') {
        let list = list.split(" where ").next().unwrap_or(list);
        if kind != Kind::Enum {
            r.bases.insert(c.name.clone(), split_top(list, ',').iter().map(|b| bare(b).to_string()).collect());
        }
    }
    if kind == Kind::Enum {
        for v in split_top(body, ',') {
            let name = bare(&v).to_string();
            if !name.is_empty() {
                c.enum_values.push(enum_value(&name, v.split_once('=').map(|x| x.1)));
                c.values.push(name);
            }
        }
        r.classes.push(c);
        return true;
    }
    for item in items(body, false) {
        let decl = attributes(&item.decl());
        if let Some(b) = &item.body {
            if type_decl(&decl, b, r) {
                continue;
            }
        }
        member(&mut c, &decl, item.body.as_deref(), &item.tail, r);
    }
    r.classes.push(c);
    true
}

fn member(c: &mut Class, decl: &str, body: Option<&str>, tail: &str, r: &mut Read) {
    let interface = c.kind == Kind::Interface;
    let (mods, rest) = modifiers(decl, MODS);
    let vis = if mods.contains(&"public") || interface {
        Vis::Public
    } else if mods.contains(&"protected") {
        Vis::Protected
    } else if mods.contains(&"internal") {
        Vis::Package
    } else {
        Vis::Private
    };
    let is_static = mods.contains(&"static") || mods.contains(&"const");
    // `=> expression` bodies
    let rest = rest.split(" => ").next().unwrap_or(rest).trim();
    if rest.is_empty() {
        return;
    }
    let paren = rest.find('(');
    if let Some(p) = paren.filter(|p| rest.find('=').is_none_or(|e| *p < e)) {
        let before = rest[..p].trim();
        let Some((ty, name)) = before.rsplit_once(' ') else { return }; // a constructor
        let name = bare(name);
        let (_, params, _) = group(&rest[p..], '(').unwrap_or(("", "", ""));
        let is_abstract = mods.contains(&"abstract") && !interface;
        c.methods.push(method(vis, &member_name(name), params_of(params), Some(uml_type(ty, L::CSharp)), is_static, is_abstract));
        return;
    }
    // A property (`Type Name { get; set; } = x`) or a field (`Type name = x`)
    let (decl, default) = match split_top(rest, '=').as_slice() {
        [d, v, ..] => (d.clone(), Some(v.clone())),
        _ => (rest.to_string(), (!tail.is_empty()).then(|| tail.to_string())),
    };
    let Some((ty, name)) = decl.trim().rsplit_once(' ') else {
        r.skipped.push(format!("{}: could not read `{rest}`", c.name));
        return;
    };
    // Read-only: a readonly field, or a property without set (`{ get; }`, `{ get; init; }`)
    let read_only = mods.contains(&"readonly") || body.is_some_and(|b| b.contains("get") && !b.contains("set"));
    c.fields.push(Field { read_only, ..field(vis, &member_name(name), uml_type(ty, L::CSharp), default, is_static) });
}

fn member_name(n: &str) -> String {
    camel(n.trim_start_matches('_'))
}

fn params_of(s: &str) -> Vec<(String, String)> {
    split_top(s, ',')
        .iter()
        .filter_map(|p| {
            let p = split_top(p, '=').first().cloned().unwrap_or_default();
            let (_, p) = modifiers(&p, &["ref", "out", "in", "params", "this", "scoped", "readonly"]);
            let (t, n) = p.trim().rsplit_once(' ')?;
            Some((n.to_string(), uml_type(t, L::CSharp)))
        })
        .collect()
}
