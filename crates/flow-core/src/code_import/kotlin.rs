//! Kotlin: classes (with a primary constructor), interfaces, enum classes and
//! companion objects (their members are static).

use super::scan::{group, items, modifiers, split_top, strip_comments};
use super::*;

const MODS: &[&str] = &[
    "public", "private", "protected", "internal", "open", "abstract", "final", "override", "data", "sealed", "inner", "value", "annotation",
    "lateinit", "const", "suspend", "inline", "operator", "infix", "tailrec", "external", "enum", "expect", "actual",
];

pub fn read(code: &str) -> Read {
    let mut r = Read::default();
    block(&strip_comments(code), &mut r);
    r
}

fn block(src: &str, r: &mut Read) {
    for item in items(src, true) {
        let decl = item.decl();
        if let Some(p) = decl.strip_prefix("package ") {
            r.package.get_or_insert(p.trim().to_string());
        } else {
            type_decl(&decl, item.body.as_deref(), r);
        }
    }
}

fn type_decl(decl: &str, body: Option<&str>, r: &mut Read) -> bool {
    let (mods, rest) = modifiers(decl, MODS);
    let (kind, rest) = if let Some(x) = rest.strip_prefix("class ") {
        let kind = if mods.contains(&"enum") {
            Kind::Enum
        } else if mods.contains(&"data") {
            Kind::Record
        } else if mods.contains(&"abstract") || mods.contains(&"sealed") {
            Kind::Abstract
        } else {
            Kind::Class
        };
        (kind, x)
    } else if let Some(x) = rest.strip_prefix("interface ").or_else(|| rest.strip_prefix("fun interface ")) {
        (Kind::Interface, x)
    } else {
        return false;
    };
    let name = bare(rest);
    let mut c = class(name, kind);
    c.type_params = type_params_after(rest);
    let mut after = rest[name.len()..].trim_start();
    if after.starts_with('<') {
        after = group(after, '<').map_or(after, |g| g.2).trim_start();
    }
    // Primary constructor: its `val` / `var` parameters are fields
    if after.starts_with('(') || after.starts_with("constructor") {
        let after_kw = after.trim_start_matches("constructor").trim_start();
        if let Some((_, params, rest)) = group(after_kw, '(') {
            for p in split_top(params, ',') {
                let (pm, p) = modifiers(&p, MODS);
                // An enum's `val value` is what its values stand for (read below), not a field
                if kind == Kind::Enum {
                    continue;
                }
                let read_only = p.starts_with("val ") && kind != Kind::Record;
                if let Some(p) = p.strip_prefix("val ").or_else(|| p.strip_prefix("var ")) {
                    let (decl, default) = split_default(p);
                    if let Some((n, t)) = decl.split_once(':') {
                        c.fields.push(Field { read_only, ..field(vis_of(&pm, false), n.trim(), uml_type(t, L::Kotlin), default, false) });
                    }
                }
            }
            after = rest.trim_start();
        }
    }
    // : Base(), Iface — a supertype that is called is the class
    if let Some(list) = after.strip_prefix(':') {
        for s in split_top(list.split(" where ").next().unwrap_or(list), ',') {
            let n = pascal(bare(&s));
            if s.contains('(') && kind != Kind::Interface {
                c.extends = Some(n);
            } else {
                c.implements.push(n);
            }
        }
    }
    if let Some(body) = body {
        let mut list = items(body, true);
        if kind == Kind::Enum && !list.is_empty() {
            let first = list.remove(0);
            for v in split_top(first.decl().trim_end_matches(';'), ',') {
                let name = bare(&v).to_string();
                if !name.is_empty() {
                    c.enum_values.push(enum_value(&name, group(&v, '(').map(|g| g.1)));
                    c.values.push(name);
                }
            }
        }
        for item in list {
            let decl = item.decl();
            if type_decl(&decl, item.body.as_deref(), r) {
                continue;
            }
            if decl.contains("companion object") || decl.starts_with("object ") {
                if let Some(b) = &item.body {
                    for inner in items(b, true) {
                        member(&mut c, &inner.decl(), true, r);
                    }
                }
                continue;
            }
            member(&mut c, &decl, false, r);
        }
        // `class X : Base` with `constructor(...) : super(...)`: Base is the class it extends
        if c.extends.is_none() && body.contains(": super(") && !c.implements.is_empty() {
            c.extends = Some(c.implements.remove(0));
        }
    }
    r.classes.push(c);
    true
}

fn vis_of(mods: &[&str], interface: bool) -> Vis {
    if mods.contains(&"private") {
        Vis::Private
    } else if mods.contains(&"protected") && !interface {
        Vis::Protected
    } else if mods.contains(&"internal") {
        Vis::Package
    } else {
        Vis::Public
    }
}

fn split_default(s: &str) -> (String, Option<String>) {
    match split_top(s, '=').as_slice() {
        [d, v, ..] => (d.clone(), Some(v.clone())),
        _ => (s.to_string(), None),
    }
}

fn member(c: &mut Class, decl: &str, in_companion: bool, r: &mut Read) {
    let interface = c.kind == Kind::Interface;
    let (mods, rest) = modifiers(decl, MODS);
    let vis = vis_of(&mods, interface);
    let is_static = in_companion || mods.contains(&"const");
    // A `val` property: read-only
    let is_val = rest.starts_with("val ");
    if let Some(rest) = rest.strip_prefix("fun ") {
        let rest = if rest.starts_with('<') { group(rest, '<').map_or(rest, |g| g.2.trim()) } else { rest };
        let Some((name, params, after)) = group(rest, '(') else { return };
        // fun Receiver.name(): extension functions are not members
        if name.contains('.') {
            return;
        }
        let after = split_top(after, '=').first().cloned().unwrap_or_default();
        let ret = after.trim().strip_prefix(':').map(|t| uml_type(t, L::Kotlin));
        let params = split_top(params, ',')
            .iter()
            .filter_map(|p| {
                let p = split_default(p).0;
                let (_, p) = modifiers(&p, &["vararg", "noinline", "crossinline"]);
                let (n, t) = p.split_once(':')?;
                Some((n.trim().to_string(), uml_type(t, L::Kotlin)))
            })
            .collect();
        let is_abstract = mods.contains(&"abstract") && !interface;
        c.methods.push(method(vis, name.trim(), params, ret, is_static, is_abstract));
    } else if let Some(rest) = rest.strip_prefix("val ").or_else(|| rest.strip_prefix("var ")) {
        let (decl, default) = split_default(rest);
        let decl = decl.split(" by ").next().unwrap_or(&decl).to_string();
        let (name, ty) = match decl.split_once(':') {
            Some((n, t)) => (n.trim().to_string(), uml_type(t, L::Kotlin)),
            None => (decl.trim().to_string(), super::typescript::guess(default.as_deref())),
        };
        if !super::super::codegen::is_ident(&name) {
            r.skipped.push(format!("{}: could not read `{decl}`", c.name));
            return;
        }
        // `x: T? = null` means "not set yet", not that the diagram allows no value
        let ty = if default.as_deref() == Some("null") { ty.trim_end_matches('?').to_string() } else { ty };
        c.fields.push(Field { read_only: is_val, ..field(vis, &name, ty, default, is_static) });
    }
}
