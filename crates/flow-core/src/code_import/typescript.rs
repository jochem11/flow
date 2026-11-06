//! TypeScript: classes, interfaces and enums.

use super::scan::{group, items, modifiers, split_top, strip_comments, Item};
use super::*;

const MODS: &[&str] = &["export", "default", "declare", "public", "private", "protected", "static", "readonly", "abstract", "override", "async", "accessor"];

pub fn read(code: &str) -> Read {
    let mut r = Read::default();
    file(&items(&strip_comments(code), true), &mut r);
    r
}

fn file(list: &[Item], r: &mut Read) {
    for item in list {
        let decl = item.decl();
        let (mods, rest) = modifiers(&decl, MODS);
        let Some(body) = &item.body else { continue };
        if let Some(rest) = rest.strip_prefix("namespace ").or_else(|| rest.strip_prefix("module ")) {
            let _ = rest;
            file(&items(body, true), r);
        } else if let Some(rest) = rest.strip_prefix("class ") {
            let kind = if mods.contains(&"abstract") { Kind::Abstract } else { Kind::Class };
            let mut c = class(bare(rest), kind);
            c.type_params = type_params_after(rest);
            let (ext, imp) = supers(rest);
            c.extends = ext.first().cloned();
            c.implements = imp;
            members(&mut c, body, r);
            r.classes.push(c);
        } else if let Some(rest) = rest.strip_prefix("interface ") {
            let mut c = class(bare(rest), Kind::Interface);
            c.type_params = type_params_after(rest);
            c.implements = supers(rest).0;
            members(&mut c, body, r);
            r.classes.push(c);
        } else if let Some(rest) = rest.strip_prefix("enum ").or_else(|| rest.strip_prefix("const enum ")) {
            let mut c = class(bare(rest), Kind::Enum);
            for v in split_top(body, ',') {
                let (name, value) = v.split_once('=').map_or((v.as_str(), None), |(n, x)| (n, Some(x)));
                let name = name.trim().trim_matches('"').to_string();
                if !name.is_empty() {
                    c.enum_values.push(enum_value(&name, value));
                    c.values.push(name);
                }
            }
            r.classes.push(c);
        }
    }
}

/// `Name<T> extends A implements B, C` → ([A], [B, C])
fn supers(head: &str) -> (Vec<String>, Vec<String>) {
    let list = |s: &str| split_top(s, ',').iter().map(|x| pascal(bare(x))).collect::<Vec<_>>();
    let ext = head.split_once(" extends ").map(|(_, r)| r.split(" implements ").next().unwrap_or(r)).map(list).unwrap_or_default();
    let imp = head.split_once(" implements ").map(|(_, r)| list(r)).unwrap_or_default();
    (ext, imp)
}

fn members(c: &mut Class, body: &str, r: &mut Read) {
    let interface = c.kind == Kind::Interface;
    for item in items(body, true) {
        let decl = item.decl();
        let (mods, rest) = modifiers(&decl, MODS);
        let vis = if mods.contains(&"private") || rest.starts_with('#') {
            Vis::Private
        } else if mods.contains(&"protected") {
            Vis::Protected
        } else {
            Vis::Public
        };
        let is_static = mods.contains(&"static");
        let rest = rest.trim_start_matches('#');
        if rest.starts_with("constructor") || rest.starts_with('[') || rest.is_empty() {
            continue;
        }
        // get name(): T / set name(value: T)
        let (accessor, rest) = match rest.split_once(' ') {
            Some((a @ ("get" | "set"), r)) if r.contains('(') => (Some(a), r),
            _ => (None, rest),
        };
        let paren = rest.find('(');
        let colon_or_eq = rest.find([':', '=']);
        if let Some(p) = paren.filter(|p| colon_or_eq.is_none_or(|c| *p < c)) {
            let name = rest[..p].trim().trim_end_matches('?');
            let name = bare(name);
            let Some((_, params, after)) = group(&rest[p..], '(') else { continue };
            let ret = after.trim().strip_prefix(':').map(|t| uml_type(t.split("=>").next().unwrap_or(t), L::TypeScript));
            let name = match accessor {
                Some(a) => format!("{a}{}", pascal(name)),
                None => name.to_string(),
            };
            let is_abstract = mods.contains(&"abstract") && !interface;
            c.methods.push(method(vis, &name, params_of(params), ret, is_static, is_abstract));
        } else {
            let (decl, default) = match split_top(rest, '=').as_slice() {
                [d, v, ..] => (d.clone(), Some(v.clone())),
                [d] => (d.clone(), None),
                _ => continue,
            };
            let (name, ty) = match decl.split_once(':') {
                Some((n, t)) => (n.trim().trim_end_matches(['?', '!']).to_string(), uml_type(t, L::TypeScript)),
                None => (decl.trim().trim_end_matches(['?', '!']).to_string(), guess(default.as_deref())),
            };
            if default.as_deref().is_some_and(|d| d.contains("=>")) || !super::super::codegen::is_ident(&name) {
                r.skipped.push(format!("{}: could not read `{decl}`", c.name));
                continue;
            }
            c.fields.push(Field { read_only: mods.contains(&"readonly"), ..field(vis, &name, ty, default, is_static) });
        }
    }
}

/// `a: T, b?: U = 1, ...rest: V[]`
fn params_of(s: &str) -> Vec<(String, String)> {
    split_top(s, ',')
        .iter()
        .filter_map(|p| {
            let p = split_top(p, '=').first().cloned().unwrap_or_default();
            let (_, p) = modifiers(&p, MODS);
            let (n, t) = p.split_once(':').unwrap_or((p, "any"));
            let n = n.trim().trim_start_matches("...").trim_end_matches('?');
            let n = if n.starts_with('{') { "options" } else { n };
            Some((n.to_string(), uml_type(t, L::TypeScript)))
        })
        .collect()
}

/// The type of a field written without one, from its value.
pub(super) fn guess(default: Option<&str>) -> String {
    match default.map(str::trim) {
        Some(d) if d.parse::<i64>().is_ok() => "int".into(),
        Some(d) if d.parse::<f64>().is_ok() => "double".into(),
        Some(d) if d.starts_with(['"', '\'', '`']) => "string".into(),
        Some("true" | "false" | "True" | "False") => "bool".into(),
        _ => "object".into(),
    }
}
