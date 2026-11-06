//! Java: classes, interfaces, enums and records, also nested ones.

use super::scan::{group, items, modifiers, split_top, strip_comments};
use super::*;

const MODS: &[&str] = &[
    "public", "private", "protected", "static", "final", "abstract", "synchronized", "native", "transient", "volatile", "default", "strictfp",
    "sealed", "non-sealed",
];

pub fn read(code: &str) -> Read {
    let mut r = Read::default();
    block(&strip_comments(code), &mut r);
    r
}

fn block(src: &str, r: &mut Read) {
    for item in items(src, false) {
        let decl = item.decl();
        if let Some(p) = decl.strip_prefix("package ") {
            r.package.get_or_insert(p.trim().to_string());
        } else if let Some(body) = &item.body {
            type_decl(&decl, body, r);
        }
    }
}

/// A class, interface, enum or record; false when `decl` is none of those.
fn type_decl(decl: &str, body: &str, r: &mut Read) -> bool {
    let (mods, rest) = modifiers(decl, MODS);
    let (kind, rest) = if let Some(x) = rest.strip_prefix("class ") {
        (if mods.contains(&"abstract") { Kind::Abstract } else { Kind::Class }, x)
    } else if let Some(x) = rest.strip_prefix("interface ") {
        (Kind::Interface, x)
    } else if let Some(x) = rest.strip_prefix("enum ") {
        (Kind::Enum, x)
    } else if let Some(x) = rest.strip_prefix("record ") {
        (Kind::Record, x)
    } else {
        return false;
    };
    let mut c = class(bare(rest), kind);
    c.type_params = type_params_after(rest);
    let list = |s: &str| split_top(s, ',').iter().map(|x| pascal(bare(x))).collect::<Vec<_>>();
    if let Some((_, ext)) = rest.split_once(" extends ") {
        let ext = list(ext.split(" implements ").next().unwrap_or(ext));
        if kind == Kind::Interface {
            c.implements = ext;
        } else {
            c.extends = ext.first().cloned();
        }
    }
    if let Some((_, imp)) = rest.split_once(" implements ") {
        c.implements.extend(list(imp));
    }
    // record Point(int x, int y): its components are fields
    if decl.contains("record ") {
        if let Some((_, comps, _)) = group(rest, '(') {
            for (n, t) in params_of(comps) {
                c.fields.push(field(Vis::Private, &n, t, None, false));
            }
        }
    }
    let mut list = items(body, false);
    if kind == Kind::Enum && !list.is_empty() {
        let first = list.remove(0);
        if first.body.is_none() {
            // PAID or PAID(2): the name, and what it stands for
            for v in split_top(&first.decl(), ',') {
                let name = bare(&v).to_string();
                if name.is_empty() {
                    continue;
                }
                c.enum_values.push(enum_value(&name, group(&v, '(').map(|g| g.1)));
                c.values.push(name);
            }
        }
    }
    for item in list {
        let decl = item.decl();
        if let Some(b) = &item.body {
            if type_decl(&decl, b, r) {
                continue;
            }
        }
        member(&mut c, &decl, item.body.is_some(), r);
    }
    // An enum's values with their own field: that field and its getter are how Flow writes it
    if kind == Kind::Enum && c.enum_values.iter().any(Option::is_some) {
        c.fields.retain(|f| f.name != "value");
        c.methods.retain(|m| m.name != "getValue");
    }
    r.classes.push(c);
    true
}

fn member(c: &mut Class, decl: &str, has_body: bool, r: &mut Read) {
    let (mods, rest) = modifiers(decl, MODS);
    let interface = c.kind == Kind::Interface;
    let vis = if mods.contains(&"public") || interface {
        Vis::Public
    } else if mods.contains(&"private") {
        Vis::Private
    } else if mods.contains(&"protected") {
        Vis::Protected
    } else {
        Vis::Package
    };
    let is_static = mods.contains(&"static");
    // Type parameters of a generic method: <T> T first(...)
    let rest = if rest.starts_with('<') { group(rest, '<').map_or(rest, |g| g.2.trim()) } else { rest };
    if rest.is_empty() || rest.starts_with('{') {
        return; // an initializer block
    }
    let paren = rest.find('(');
    if let Some(p) = paren.filter(|p| rest.find('=').is_none_or(|e| *p < e)) {
        let before = rest[..p].trim();
        let Some((ty, name)) = before.rsplit_once(' ') else { return }; // a constructor
        let (_, params, _) = group(&rest[p..], '(').unwrap_or(("", "", ""));
        let ret = Some(uml_type(ty, L::Java));
        let is_abstract = !interface && (mods.contains(&"abstract") || (!has_body && c.kind == Kind::Abstract));
        c.methods.push(method(vis, name, params_of(params), ret, is_static, is_abstract));
    } else {
        // int a = 1, b;
        let mut parts = split_top(rest, ',').into_iter();
        let first = parts.next().unwrap_or_default();
        let (decl, default) = split_default(&first);
        let Some((ty, name)) = decl.trim().rsplit_once(' ') else {
            r.skipped.push(format!("{}: could not read `{rest}`", c.name));
            return;
        };
        let ty = uml_type(ty, L::Java);
        let is_static = is_static || (interface && mods.contains(&"final"));
        // final (not static): set once
        let read_only = mods.contains(&"final") && !is_static;
        c.fields.push(Field { read_only, ..field(vis, name, ty.clone(), default, is_static) });
        for more in parts {
            let (n, d) = split_default(&more);
            c.fields.push(Field { read_only, ..field(vis, n.trim(), ty.clone(), d, is_static) });
        }
    }
}

fn split_default(s: &str) -> (String, Option<String>) {
    match split_top(s, '=').as_slice() {
        [d, v, ..] => (d.clone(), Some(v.clone())),
        _ => (s.to_string(), None),
    }
}

/// `final List<String> names, int n`
fn params_of(s: &str) -> Vec<(String, String)> {
    split_top(s, ',')
        .iter()
        .filter_map(|p| {
            let p = p.trim_start_matches("final ").replace("...", "[] ");
            let (t, n) = p.trim().rsplit_once(' ')?;
            Some((n.to_string(), uml_type(t, L::Java)))
        })
        .collect()
}
