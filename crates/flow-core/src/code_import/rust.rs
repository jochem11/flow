//! Rust: structs, enums and traits; methods from `impl Name` and `impl Trait for
//! Name` (the trait is then implemented). A `base: Other` field is how the code
//! export writes "extends", so it is read back that way.

use super::scan::{group, items, modifiers, split_top, strip_comments, Item};
use super::*;

pub fn read(code: &str) -> Read {
    let mut r = Read::default();
    let mut impls: Vec<(String, Option<String>, String)> = vec![];
    file(&items(&strip_comments(code), false), &mut r, &mut impls);
    for (name, tr, body) in impls {
        let Some(i) = r.classes.iter().position(|c| c.name == pascal(&name)) else { continue };
        if let Some(t) = &tr {
            let t = pascal(bare(t));
            if !r.classes[i].implements.contains(&t) {
                r.classes[i].implements.push(t);
            }
        }
        for item in items(&body, false) {
            let decl = item.decl();
            let (mods, rest) = modifiers(&decl, &["pub", "pub(crate)", "pub(super)", "async", "const", "unsafe", "default"]);
            let vis = if tr.is_some() || mods.contains(&"pub") { Vis::Public } else if mods.iter().any(|m| m.starts_with("pub(")) { Vis::Package } else { Vis::Private };
            if let Some(f) = rest.strip_prefix("fn ") {
                if let Some(mut m) = function(f, vis, false) {
                    // `Self` is the type itself
                    let own = r.classes[i].name.clone();
                    for t in m.params.iter_mut().map(|p| &mut p.1).chain(m.ret.as_mut()) {
                        *t = t.replace("Self", &own);
                    }
                    r.classes[i].methods.push(m);
                }
            } else if decl.contains("const ") {
                // pub const MAX: u32 = 10;
                let after = decl.split("const ").nth(1).unwrap_or("");
                let (d, v) = after.split_once('=').map_or((after, None), |(d, v)| (d, Some(v.trim().to_string())));
                if let Some((n, t)) = d.split_once(':') {
                    r.classes[i].fields.push(field(vis, &member(n.trim()), uml_type(t, L::Rust), v, true));
                }
            }
        }
    }
    r
}

fn file(list: &[Item], r: &mut Read, impls: &mut Vec<(String, Option<String>, String)>) {
    for item in list {
        let decl = item.decl();
        let (_, rest) = modifiers(&decl, &["pub", "pub(crate)", "pub(super)", "unsafe"]);
        let Some(body) = &item.body else { continue };
        if rest.starts_with("mod ") {
            file(&items(body, false), r, impls);
        } else if let Some(x) = rest.strip_prefix("struct ") {
            let mut c = class(bare(x), Kind::Class);
            c.type_params = type_params_after(x);
            for f in split_top(body, ',') {
                let (mods, f) = modifiers(&f, &["pub", "pub(crate)", "pub(super)"]);
                let Some((n, t)) = f.split_once(':') else { continue };
                let (n, t) = (n.trim(), t.trim());
                if n == "base" {
                    c.extends = Some(pascal(bare(&uml_type(t, L::Rust))));
                    continue;
                }
                let vis = if mods.contains(&"pub") { Vis::Public } else if !mods.is_empty() { Vis::Package } else { Vis::Private };
                c.fields.push(field(vis, &member(n), uml_type(t, L::Rust), None, false));
            }
            r.classes.push(c);
        } else if let Some(x) = rest.strip_prefix("enum ") {
            let mut c = class(bare(x), Kind::Enum);
            for v in split_top(body, ',') {
                let v = Item { head: v.clone(), body: None, tail: String::new() }.decl();
                let name = bare(&v).to_string();
                if !name.is_empty() {
                    // `Paid = 2`: what it stands for
                    c.enum_values.push(enum_value(&name, v.split_once('=').map(|x| x.1)));
                    c.values.push(name);
                }
            }
            r.classes.push(c);
        } else if let Some(x) = rest.strip_prefix("trait ") {
            let mut c = class(bare(x), Kind::Interface);
            if let Some((_, sup)) = x.split_once(':') {
                c.implements = sup.split('+').map(|s| pascal(bare(s.trim()))).filter(|s| !s.is_empty()).collect();
            }
            for m in items(body, false) {
                if let Some(f) = m.decl().strip_prefix("fn ") {
                    if let Some(m) = function(f, Vis::Public, false) {
                        c.methods.push(m);
                    }
                }
            }
            r.classes.push(c);
        } else if let Some(x) = rest.strip_prefix("impl") {
            // impl<T> Trait for Name<T> / impl Name
            let x = x.trim_start();
            let x = if x.starts_with('<') { group(x, '<').map_or(x, |g| g.2.trim()) } else { x };
            let x = x.split(" where ").next().unwrap_or(x);
            match x.split_once(" for ") {
                Some((tr, name)) => impls.push((bare(name).to_string(), Some(tr.trim().to_string()), body.clone())),
                None => impls.push((bare(x).to_string(), None, body.clone())),
            }
        }
    }
}

/// `name<T>(&self, a: T) -> R` after `fn`.
fn function(f: &str, vis: Vis, is_abstract: bool) -> Option<Method> {
    let (name, params, after) = group(f, '(')?;
    let name = bare(name);
    let mut is_static = true;
    let mut out = vec![];
    for p in split_top(params, ',') {
        if p.trim_start_matches('&').trim_start_matches("mut ").trim_start_matches('\'').split_whitespace().any(|w| w.trim_start_matches("mut") == "self" || w == "self" || w.ends_with("self")) && !p.contains(':') {
            is_static = false;
            continue;
        }
        let (n, t) = p.split_once(':')?;
        if n.trim() == "self" {
            is_static = false;
            continue;
        }
        out.push((member(n.trim().trim_start_matches("mut ")), uml_type(t, L::Rust)));
    }
    let ret = after.split(" where ").next().unwrap_or(after).trim().strip_prefix("->").map(|t| uml_type(t, L::Rust));
    Some(method(vis, &member(name), out, ret, is_static, is_abstract))
}
