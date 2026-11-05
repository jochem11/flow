//! Go: struct and interface types, methods by their receiver, `type X int` with
//! constants of that type as an enum. An embedded struct is "extends"; a struct
//! implements an interface when it has all of its methods (as Go itself decides).

use super::scan::{group, items, split_top, strip_comments};
use super::*;

/// Go types: exported (capitalised) names are public.
fn vis(name: &str) -> Vis {
    if name.starts_with(char::is_uppercase) { Vis::Public } else { Vis::Private }
}

pub fn read(code: &str) -> Read {
    let mut r = Read::default();
    // Named basic types (`type Status int`): enums if there are constants of that type
    let mut named: Vec<String> = vec![];
    let mut consts: Vec<(String, String)> = vec![];
    let mut methods: Vec<(String, Method)> = vec![];
    for item in items(&strip_comments(code), true) {
        let raw = item.head.clone();
        let decl = item.decl();
        if let Some(p) = decl.strip_prefix("package ") {
            r.package.get_or_insert(p.trim().to_string());
        } else if let Some(t) = decl.strip_prefix("type ") {
            let (name, rest) = t.split_once(' ').unwrap_or((t, ""));
            let name = bare(name);
            let rest = rest.trim();
            match (rest, &item.body) {
                ("struct", Some(body)) => {
                    let mut c = class(name, Kind::Class);
                    for line in body.lines().flat_map(|l| l.split(';')).map(str::trim).filter(|l| !l.is_empty()) {
                        // Struct tags: `json:"name"`
                        let line = line.split('`').next().unwrap_or(line).trim();
                        // `a, b int`: the names end at the first word not followed by a comma
                        let words: Vec<&str> = line.split_whitespace().collect();
                        let count = words.iter().position(|w| !w.ends_with(',')).map_or(words.len(), |p| p + 1);
                        if words.len() == 1 {
                            let embedded = words[0].trim_start_matches('*');
                            c.extends = Some(pascal(embedded.rsplit('.').next().unwrap_or(embedded)));
                        } else if count < words.len() {
                            let ty = words[count..].join(" ");
                            for n in words[..count].iter().map(|n| n.trim_end_matches(',')).filter(|n| !n.is_empty()) {
                                c.fields.push(field(vis(n), &member(n), uml_type(&ty, L::Go), None, false));
                            }
                        }
                    }
                    r.classes.push(c);
                }
                ("interface", Some(body)) => {
                    let mut c = class(name, Kind::Interface);
                    for line in body.lines().flat_map(|l| l.split(';')).map(str::trim).filter(|l| !l.is_empty()) {
                        match signature(line) {
                            Some(m) => c.methods.push(m),
                            None if !line.contains(' ') => c.implements.push(pascal(line.rsplit('.').next().unwrap_or(line))),
                            None => {}
                        }
                    }
                    r.classes.push(c);
                }
                (basic, None) if !basic.starts_with('=') && !basic.contains(['{', '(']) => named.push(name.to_string()),
                _ => {}
            }
        } else if let Some(f) = decl.strip_prefix("func ") {
            // func (o *Order) Pay(amount float64) bool
            if f.starts_with('(') {
                if let Some((_, recv, rest)) = group(f, '(') {
                    let ty = recv.split_whitespace().last().unwrap_or("").trim_start_matches('*');
                    if let Some(m) = signature(rest.trim()) {
                        methods.push((pascal(bare(ty)), m));
                    }
                }
            }
        } else if decl.starts_with("var _ ") {
            // var _ Payable = (*Order)(nil)
            let words: Vec<&str> = decl.split_whitespace().collect();
            if let (Some(iface), Some(value)) = (words.get(2), decl.split('=').nth(1)) {
                let target = value.trim().trim_start_matches("(*").split(')').next().unwrap_or("").trim_start_matches('&');
                let target = target.split('{').next().unwrap_or(target);
                r.bases.entry(pascal(bare(target))).or_default().push(iface.to_string());
            }
        } else if decl.starts_with("const") {
            // const ( StatusOpen Status = iota \n StatusPaid ... ): one per line
            let inner = group(&raw, '(').map_or(raw.trim_start_matches("const").to_string(), |g| g.1.to_string());
            let mut last_type = String::new();
            for line in inner.lines().map(str::trim).filter(|l| !l.is_empty()) {
                let words: Vec<&str> = line.split_whitespace().collect();
                match words.as_slice() {
                    [n, t, "=", ..] => {
                        last_type = t.to_string();
                        consts.push((n.to_string(), last_type.clone()));
                    }
                    // An untyped constant: the ones after it are untyped too
                    [n, "=", ..] => {
                        last_type.clear();
                        consts.push((n.to_string(), String::new()));
                    }
                    [n] => consts.push((n.to_string(), last_type.clone())),
                    _ => {}
                }
            }
        }
    }
    for n in named {
        let values: Vec<String> = consts.iter().filter(|(_, t)| *t == n).map(|(v, _)| v.strip_prefix(n.as_str()).filter(|s| !s.is_empty()).unwrap_or(v).to_string()).collect();
        if !values.is_empty() {
            let mut c = class(&n, Kind::Enum);
            c.values = values;
            r.classes.push(c);
        }
    }
    for (ty, m) in methods {
        // NewOrder() and the like are constructors, not methods
        if let Some(c) = r.classes.iter_mut().find(|c| c.name == ty) {
            c.methods.push(m);
        }
    }
    // Implicit interfaces: a struct with all the methods of an interface implements it
    let interfaces: Vec<(String, Vec<String>)> =
        r.classes.iter().filter(|c| c.kind == Kind::Interface && !c.methods.is_empty()).map(|c| (c.name.clone(), c.methods.iter().map(|m| m.name.clone()).collect())).collect();
    for c in r.classes.iter_mut().filter(|c| c.kind == Kind::Class) {
        for (i, needs) in &interfaces {
            let has = needs.iter().all(|n| c.methods.iter().any(|m| &m.name == n));
            let listed = r.bases.get(&c.name).is_some_and(|b| b.iter().any(|x| pascal(x) == *i));
            if has && !listed {
                c.implements.push(i.clone());
            }
        }
    }
    r
}

/// `Name(a, b int, c string) (int, error)`
fn signature(s: &str) -> Option<Method> {
    let (name, params, results) = group(s, '(')?;
    let name = name.trim();
    if !super::super::codegen::is_ident(name) {
        return None;
    }
    let mut out: Vec<(String, String)> = vec![];
    let mut pending: Vec<String> = vec![];
    for p in split_top(params, ',') {
        match p.split_once(' ') {
            Some((n, t)) => {
                let t = uml_type(t.trim_start_matches("..."), L::Go);
                for q in pending.drain(..) {
                    out.push((member(&q), t.clone()));
                }
                out.push((member(n), t));
            }
            None => pending.push(p),
        }
    }
    let results = results.trim();
    let results = results.strip_prefix('(').and_then(|r| r.strip_suffix(')')).unwrap_or(results);
    let ret = split_top(results, ',')
        .iter()
        .map(|r| r.split_whitespace().last().unwrap_or("").to_string())
        .find(|r| !r.is_empty() && r != "error")
        .map(|r| uml_type(&r, L::Go));
    Some(method(vis(name), &member(name), out, ret, false, false))
}
