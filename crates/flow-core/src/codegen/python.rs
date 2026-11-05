//! Python: dataclasses, ABC for interfaces.

use super::*;

/// A type in Python, noting the import it needs.
pub(super) fn python_ty(t: &str, imports: &mut BTreeSet<String>) -> String {
    let out = ty(&parse_ty(t), CodeLanguage::Python, false);
    let words: Vec<&str> = out.split(|c: char| !c.is_alphanumeric()).collect();
    for (word, import) in [
        ("UUID", "from uuid import UUID"),
        ("Decimal", "from decimal import Decimal"),
        ("datetime", "from datetime import datetime"),
        ("date", "from datetime import date"),
        ("time", "from datetime import time"),
        ("timedelta", "from datetime import timedelta"),
        ("Any", "from typing import Any"),
    ] {
        if words.contains(&word) {
            imports.insert(import.to_string());
        }
    }
    out
}

pub(super) fn python(classes: &[Class]) -> String {
    let mut imports = BTreeSet::new();
    let mut body = String::new();
    for c in classes {
        if c.kind == Kind::Enum {
            imports.insert("from enum import Enum".to_string());
            body.push_str(&format!("\n\nclass {}(Enum):\n", c.name));
            for v in &c.values {
                body.push_str(&format!("    {} = \"{}\"\n", snake(v).to_uppercase(), v));
            }
            if c.values.is_empty() {
                body.push_str("    pass\n");
            }
            body.push_str(&unreadable(c, "#", "    "));
            continue;
        }
        let mut bases: Vec<String> = c.extends.iter().chain(&c.implements).cloned().collect();
        if matches!(c.kind, Kind::Interface | Kind::Abstract) {
            imports.insert("from abc import ABC, abstractmethod".to_string());
            bases.push("ABC".into());
        }
        let bases = if bases.is_empty() { String::new() } else { format!("({})", bases.join(", ")) };
        body.push_str("\n\n");
        if c.kind != Kind::Interface {
            imports.insert("from dataclasses import dataclass, field".to_string());
            body.push_str("@dataclass\n");
        }
        body.push_str(&format!("class {}{bases}:\n", c.name));
        let mut empty = true;
        for f in &c.fields {
            let t = python_ty(&f.ty, &mut imports);
            let name = snake(&f.name);
            let name = if f.vis == Vis::Private { format!("_{name}") } else { name };
            let list = t.starts_with("list[");
            let init = match &f.default {
                Some(d) => format!(" = {}", default_value(CodeLanguage::Python, &t, d)),
                None if list => " = field(default_factory=list)".into(),
                None => " = None".into(),
            };
            // No default in the diagram: None until it is set
            let t = if f.default.is_none() && !list && !t.ends_with("| None") { format!("{t} | None") } else { t };
            let t = if f.is_static {
                imports.insert("from typing import ClassVar".to_string());
                format!("ClassVar[{t}]")
            } else {
                t
            };
            body.push_str(&format!("    {name}: {t}{init}\n"));
            empty = false;
        }
        for m in &c.methods {
            let mut params: Vec<String> = if m.is_static { vec![] } else { vec!["self".into()] };
            for (n, t) in &m.params {
                params.push(format!("{}: {}", snake(n), python_ty(t, &mut imports)));
            }
            let ret = m.ret.as_deref().map_or("None".into(), |t| python_ty(t, &mut imports));
            let name = snake(&m.name);
            let name = if m.vis == Vis::Private { format!("_{name}") } else { name };
            body.push('\n');
            if m.is_static {
                body.push_str("    @staticmethod\n");
            }
            if c.kind == Kind::Interface || (m.is_abstract && c.kind == Kind::Abstract) {
                body.push_str(&format!("    @abstractmethod\n    def {name}({}) -> {ret}:\n        ...\n", params.join(", ")));
            } else {
                // Private attributes are written with a _ in front (see above)
                let attr = |f: &str| {
                    let private = c.fields.iter().any(|x| x.name == f && x.vis == Vis::Private);
                    format!("self.{}{}", if private { "_" } else { "" }, snake(f))
                };
                let code = match &m.body {
                    Body::Get(f) => format!("return {}", attr(f)),
                    Body::Set(f, p) => format!("{} = {}", attr(f), snake(p)),
                    Body::Todo => "raise NotImplementedError".into(),
                };
                body.push_str(&format!("    def {name}({}) -> {ret}:\n        {code}\n", params.join(", ")));
            }
            empty = false;
        }
        if empty {
            body.push_str("    pass\n");
        }
        body.push_str(&unreadable(c, "#", "    "));
    }
    // `from __future__` must come first
    let mut lines: Vec<String> = imports.into_iter().collect();
    lines.insert(0, "from __future__ import annotations".into());
    format!("\n{}\n{body}", lines.join("\n"))
}
