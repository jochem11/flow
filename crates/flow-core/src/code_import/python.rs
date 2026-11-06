//! Python: classes by indentation. Fields come from class-level annotations
//! (dataclasses) and from `self.x = ...` in `__init__`; `ABC` / `Protocol` with only
//! abstract methods is an interface, an `Enum` subclass an enum.

use super::scan::{group, split_top};
use super::*;

/// Logical lines (indent, text): without comments and docstrings, and with
/// lines inside brackets joined.
fn lines(code: &str) -> Vec<(usize, String)> {
    let chars: Vec<char> = code.chars().collect();
    let mut out = vec![];
    let mut cur = String::new();
    let mut depth = 0i32;
    let mut i = 0;
    let mut push = |cur: &mut String| {
        let indent = cur.chars().take_while(|c| *c == ' ' || *c == '\t').map(|c| if c == '\t' { 4 } else { 1 }).sum();
        let text = cur.trim().to_string();
        // A string on its own (a docstring) does nothing
        let only_string = text.len() >= 2 && (text.starts_with('"') || text.starts_with('\'')) && (text.ends_with('"') || text.ends_with('\''));
        if !text.is_empty() && !only_string {
            out.push((indent, text));
        }
        cur.clear();
    };
    while i < chars.len() {
        let c = chars[i];
        match c {
            '#' => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
                continue;
            }
            '"' | '\'' => {
                let triple = chars.get(i + 1) == Some(&c) && chars.get(i + 2) == Some(&c);
                let end = if triple {
                    (i + 3..chars.len().saturating_sub(2)).find(|&j| chars[j] == c && chars[j + 1] == c && chars[j + 2] == c).map_or(chars.len(), |j| j + 3)
                } else {
                    let mut j = i + 1;
                    while j < chars.len() && chars[j] != c && chars[j] != '\n' {
                        j += if chars[j] == '\\' { 2 } else { 1 };
                    }
                    (j + 1).min(chars.len())
                };
                if triple {
                    cur.push_str("\"\"");
                } else {
                    cur.extend(&chars[i..end]);
                }
                i = end;
                continue;
            }
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            '\\' if chars.get(i + 1) == Some(&'\n') => {
                i += 2;
                continue;
            }
            '\n' if depth <= 0 => {
                push(&mut cur);
                i += 1;
                continue;
            }
            '\n' => {
                cur.push(' ');
                i += 1;
                continue;
            }
            _ => {}
        }
        cur.push(c);
        i += 1;
    }
    push(&mut cur);
    out
}

pub fn read(code: &str) -> Read {
    let mut r = Read::default();
    let all = lines(code);
    let mut i = 0;
    while i < all.len() {
        if all[i].1.starts_with("class ") {
            i = class_at(&all, i, &mut r);
        } else {
            i += 1;
        }
    }
    r
}

/// The end of the block that starts after line `i`.
fn block_end(all: &[(usize, String)], i: usize) -> usize {
    (i + 1..all.len()).find(|&j| all[j].0 <= all[i].0).unwrap_or(all.len())
}

/// Reads the class on line `i`; returns the line after it.
fn class_at(all: &[(usize, String)], i: usize, r: &mut Read) -> usize {
    let end = block_end(all, i);
    let head = all[i].1.trim_start_matches("class ").trim_end_matches(':');
    let name = bare(head);
    let bases: Vec<String> = group(head, '(').map(|g| split_top(g.1, ',')).unwrap_or_default();
    let last = |b: &str| b.rsplit('.').next().unwrap_or(b).to_string();
    let is_enum = bases.iter().any(|b| matches!(last(b).as_str(), "Enum" | "IntEnum" | "StrEnum" | "Flag" | "IntFlag"));
    let is_abc = bases.iter().any(|b| matches!(last(b).as_str(), "ABC" | "metaclass=ABCMeta" | "metaclass=abc.ABCMeta") || b.contains("ABCMeta"));
    let is_protocol = bases.iter().any(|b| last(b) == "Protocol");
    // @dataclass(frozen=True) on the line above: a record
    let frozen = i > 0 && all[i - 1].1.starts_with("@dataclass") && all[i - 1].1.contains("frozen=True");
    let mut c = class(name, if is_enum { Kind::Enum } else if frozen { Kind::Record } else { Kind::Class });
    // Generic[T, K]: its type parameters
    if let Some(g) = bases.iter().find(|b| last(bare(b)) == "Generic") {
        c.type_params = group(g, '[').map(|x| split_top(x.1, ',')).unwrap_or_default().into_iter().map(|t| t.trim().to_string()).collect();
    }
    let others: Vec<String> = bases
        .iter()
        .filter(|b| !b.contains('=') && !matches!(last(bare(b)).as_str(), "ABC" | "Protocol" | "object" | "Generic" | "Enum" | "IntEnum" | "StrEnum" | "Flag" | "IntFlag" | "NamedTuple" | "TypedDict"))
        .map(|b| bare(b).to_string())
        .collect();

    let mut decorators: Vec<String> = vec![];
    let mut j = i + 1;
    while j < end {
        let (indent, text) = (&all[j].0, all[j].1.as_str());
        let inner_end = block_end(all, j);
        if let Some(d) = text.strip_prefix('@') {
            decorators.push(d.to_string());
            j += 1;
            continue;
        }
        if text.starts_with("class ") {
            j = class_at(all, j, r);
            decorators.clear();
            continue;
        }
        let def = text.strip_prefix("async def ").or_else(|| text.strip_prefix("def "));
        if let Some(def) = def {
            function(&mut c, def, &decorators, &all[j + 1..inner_end], *indent);
        } else if let Some((target, value)) = assignment(text) {
            let (n, ty) = match target.split_once(':') {
                Some((n, t)) => (n.trim().to_string(), Some(t.trim().to_string())),
                None => (target.trim().to_string(), None),
            };
            if super::super::codegen::is_ident(&n) {
                if is_enum {
                    c.enum_values.push(enum_value(&n, value.as_deref()));
                    c.values.push(n);
                } else {
                    let is_static = ty.is_none() || ty.as_deref().is_some_and(|t| t.starts_with("ClassVar"));
                    let ty = ty.map_or_else(|| super::typescript::guess(value.as_deref()), |t| uml_type(&t, L::Python));
                    let ty = if value.as_deref() == Some("None") { ty.trim_end_matches('?').to_string() } else { ty };
                    let vis = if n.starts_with('_') { Vis::Private } else { Vis::Public };
                    c.fields.push(field(vis, &member(&n), ty, value, is_static));
                }
            }
        }
        decorators.clear();
        j = inner_end;
    }

    if is_protocol || (is_abc && c.fields.is_empty() && !c.methods.is_empty() && c.methods.iter().all(|m| m.is_abstract)) {
        c.kind = Kind::Interface;
        for m in &mut c.methods {
            m.is_abstract = false;
        }
    } else if is_abc {
        c.kind = Kind::Abstract;
    }
    if !others.is_empty() {
        r.bases.insert(c.name.clone(), others);
    }
    r.classes.push(c);
    end
}

/// `name: T = value`, `name = value`, `name: T` (not `==`, `+=`, ...)
fn assignment(text: &str) -> Option<(String, Option<String>)> {
    let parts = split_top(text, '=');
    match parts.as_slice() {
        [t] if t.contains(':') && !t.ends_with(':') => Some((t.clone(), None)),
        [t, v] if !t.ends_with(['!', '<', '>', '+', '-', '*', '/', '%', '|', '&']) && !v.is_empty() => Some((t.clone(), Some(v.clone()))),
        _ => None,
    }
}

fn function(c: &mut Class, def: &str, decorators: &[String], body: &[(usize, String)], _indent: usize) {
    let Some((name, params, after)) = group(def, '(') else { return };
    let name = name.trim();
    let is_static = decorators.iter().any(|d| d == "staticmethod" || d == "classmethod");
    let is_abstract = decorators.iter().any(|d| d.ends_with("abstractmethod"));
    let mut types: HashMap<String, String> = HashMap::new();
    let mut ps: Vec<(String, String)> = vec![];
    for (k, p) in split_top(params, ',').iter().enumerate() {
        let p = split_top(p, '=').first().cloned().unwrap_or_default();
        if (k == 0 && !decorators.iter().any(|d| d == "staticmethod")) && matches!(p.trim(), "self" | "cls") || p.starts_with('*') || p == "/" {
            continue;
        }
        let (n, t) = p.split_once(':').map_or((p.trim().to_string(), "object".to_string()), |(n, t)| (n.trim().to_string(), uml_type(t, L::Python)));
        types.insert(n.clone(), t.clone());
        ps.push((member(&n), t));
    }
    // `-> str:` or, with the body on the same line, `-> str: ...`
    let after = after.trim();
    let after = after.rsplit_once(':').map_or(after, |x| x.0).trim();
    let ret = after.strip_prefix("->").map(|t| uml_type(t, L::Python));
    if name == "__init__" {
        // self.x: T = value / self.x = param
        for (_, line) in body {
            let Some(rest) = line.strip_prefix("self.") else { continue };
            let Some((target, value)) = assignment(rest) else { continue };
            let (n, ty) = match target.split_once(':') {
                Some((n, t)) => (n.trim().to_string(), uml_type(t, L::Python)),
                None => {
                    let v = value.clone().unwrap_or_default();
                    (target.trim().to_string(), types.get(v.trim()).cloned().unwrap_or_else(|| super::typescript::guess(Some(&v))))
                }
            };
            let m = member(&n);
            if super::super::codegen::is_ident(&n) && !c.fields.iter().any(|f| f.name == m) {
                let default = value.filter(|v| !types.contains_key(v.trim()));
                let vis = if n.starts_with('_') { Vis::Private } else { Vis::Public };
                c.fields.push(field(vis, &m, ty, default, false));
            }
        }
        return;
    }
    if name.starts_with("__") && name.ends_with("__") {
        return;
    }
    let vis = if name.starts_with('_') { Vis::Private } else { Vis::Public };
    let shown = if decorators.iter().any(|d| d == "property") {
        format!("get{}", pascal(name))
    } else if decorators.iter().any(|d| d.ends_with(".setter")) {
        format!("set{}", pascal(name))
    } else {
        member(name)
    };
    c.methods.push(method(vis, &shown, ps, ret, is_static, is_abstract));
}
