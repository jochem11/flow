//! Go: structs with methods, embedding instead of inheritance.

use super::*;

// Go has no classes: a class is a struct with methods (pointer receivers), an
// interface a Go interface (with a check that the struct really implements it),
// inheritance becomes embedding, an enum a typed constant with iota. Exported
// (capitalized) is public; static members live on the package.

pub(super) const GO_KEYWORDS: [&str; 25] = [
    "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough", "for", "func", "go", "goto",
    "if", "import", "interface", "map", "package", "range", "return", "select", "struct", "switch", "type", "var",
];

/// A name for Go: exported (capitalized) or not, never a keyword.
pub(super) fn go_name(name: &str, exported: bool) -> String {
    let n = if exported { pascal(name) } else { camel(name) };
    if GO_KEYWORDS.contains(&n.as_str()) { format!("{n}_") } else { n }
}

pub(super) fn go(classes: &[Class]) -> String {
    let structs: BTreeSet<String> =
        classes.iter().filter(|c| matches!(c.kind, Kind::Class | Kind::Abstract)).map(|c| c.name.clone()).collect();
    // A type in Go: structs by pointer (so they can refer to each other), interfaces and enums by value
    fn go_ty(t: &Ty, structs: &BTreeSet<String>) -> String {
        match t {
            Ty::Named(n) if builtin(n).is_some() => builtin(n).unwrap()[6].clone(),
            Ty::Named(n) if structs.contains(&pascal(n)) => format!("*{}", pascal(n)),
            Ty::Named(n) => pascal(n),
            Ty::List(inner) => format!("[]{}", go_ty(inner, structs)),
            Ty::Set(inner) => format!("map[{}]bool", go_ty(inner, structs)),
            Ty::Map(k, v) => format!("map[{}]{}", go_ty(k, structs), go_ty(v, structs)),
            // Pointers and interfaces can already be nil
            Ty::Optional(inner) => {
                let i = go_ty(inner, structs);
                if i.starts_with('*') || !i.chars().next().is_some_and(char::is_lowercase) && !structs.contains(&i) && builtin(&i).is_none() {
                    i
                } else {
                    format!("*{i}")
                }
            }
            Ty::Generic(base, _) => pascal(base),
        }
    }
    let t = |s: &str| go_ty(&parse_ty(s), &structs);
    let params = |m: &Method| m.params.iter().map(|(n, pt)| format!("{} {}", go_name(n, false), t(pt))).collect::<Vec<_>>().join(", ");
    let ret = |m: &Method, c: &Class| {
        let r = match &m.body {
            Body::Get(f) => c.fields.iter().find(|x| &x.name == f).map(|x| t(&x.ty)),
            _ => m.ret.as_deref().map(t),
        };
        r.filter(|r| !r.is_empty()).map_or(String::new(), |r| format!(" {r}"))
    };
    // A default from the diagram as a Go literal (Go has no field defaults: they go in NewX())
    let literal = |ty: &str, raw: &str| -> Option<String> {
        match ty {
            "string" if raw.starts_with('"') => Some(raw.into()),
            "string" => Some(format!("{:?}", raw.trim_matches('\''))),
            "int" | "int64" | "float64" if raw.parse::<f64>().is_ok() => Some(raw.into()),
            "bool" if raw == "true" || raw == "false" => Some(raw.into()),
            _ => None,
        }
    };

    let mut body = String::new();
    for c in classes {
        let recv = c.name.chars().next().map_or("x".into(), |ch| ch.to_lowercase().to_string());
        match c.kind {
            Kind::Enum => {
                body.push_str(&format!("\ntype {} int\n\nconst (\n", c.name));
                for (i, v) in c.values.iter().enumerate() {
                    let tail = if i == 0 { format!(" {} = iota", c.name) } else { String::new() };
                    body.push_str(&format!("\t{}{}{tail}\n", c.name, pascal(v)));
                }
                body.push_str(&unreadable(c, "//", "\t"));
                body.push_str(")\n");
            }
            Kind::Interface => {
                body.push_str(&format!("\ntype {} interface {{\n", c.name));
                for i in &c.implements {
                    body.push_str(&format!("\t{i}\n"));
                }
                for m in &c.methods {
                    body.push_str(&format!("\t{}({}){}\n", go_name(&m.name, true), params(m), ret(m, c)));
                }
                body.push_str(&unreadable(c, "//", "\t"));
                body.push_str("}\n");
            }
            _ => {
                if c.kind == Kind::Abstract {
                    body.push_str(&format!("\n// {} is abstract in the diagram: embed it, and implement its abstract methods there.", c.name));
                }
                body.push_str(&format!("\ntype {} struct {{\n", c.name));
                // Inheritance: the supertype is embedded, so its fields and methods come along
                if let Some(e) = &c.extends {
                    body.push_str(&format!("\t{e}\n"));
                }
                for f in c.fields.iter().filter(|f| !f.is_static) {
                    body.push_str(&format!("\t{} {}\n", go_name(&f.name, field_vis(f) == Vis::Public), t(&f.ty)));
                }
                body.push_str(&unreadable(c, "//", "\t"));
                body.push_str("}\n");

                // Static attributes: package variables
                for f in c.fields.iter().filter(|f| f.is_static) {
                    let ft = t(&f.ty);
                    let init = f.default.as_deref().and_then(|d| literal(&ft, d)).map_or(String::new(), |v| format!(" = {v}"));
                    let name = go_name(&format!("{}_{}", c.name, f.name), field_vis(f) == Vis::Public);
                    body.push_str(&format!("\nvar {name} {ft}{init}\n"));
                }

                // Defaults: a constructor
                let defaults: Vec<String> = c
                    .fields
                    .iter()
                    .filter(|f| !f.is_static)
                    .filter_map(|f| {
                        let v = literal(&t(&f.ty), f.default.as_deref()?)?;
                        Some(format!("{}: {v}", go_name(&f.name, field_vis(f) == Vis::Public)))
                    })
                    .collect();
                // The constructor from the diagram sets its parameters too
                if let Some((m, sets)) = c.methods.iter().find_map(|m| if let Body::Init(s) = &m.body { Some((m, s)) } else { None }) {
                    let mut values = defaults.clone();
                    for (f, p) in sets {
                        if let Some(x) = c.fields.iter().find(|x| &x.name == f) {
                            values.push(format!("{}: {}", go_name(&x.name, field_vis(x) == Vis::Public), go_name(p, false)));
                        }
                    }
                    body.push_str(&format!(
                        "\n// New{n} makes {a} {n}.\nfunc New{n}({}) *{n} {{\n\treturn &{n}{{{}}}\n}}\n",
                        params(m),
                        values.join(", "),
                        n = c.name,
                        a = if c.name.starts_with(['A', 'E', 'I', 'O', 'U']) { "an" } else { "a" }
                    ));
                } else if !defaults.is_empty() {
                    body.push_str(&format!(
                        "\n// New{n} makes a {n} with the default values from the diagram.\nfunc New{n}() *{n} {{\n\treturn &{n}{{{}}}\n}}\n",
                        defaults.join(", "),
                        n = c.name
                    ));
                }

                for m in &c.methods {
                    let field = |f: &str| c.fields.iter().find(|x| x.name == f);
                    let fname = |f: &Field| go_name(&f.name, field_vis(f) == Vis::Public);
                    let code = match &m.body {
                        Body::Get(f) => field(f).map_or("panic(\"not implemented\")".into(), |x| format!("return {recv}.{}", fname(x))),
                        Body::Set(f, p) => field(f).map_or("panic(\"not implemented\")".into(), |x| {
                            // An optional field takes the address of the value
                            let amp = if t(&x.ty).starts_with('*') && !m.params.first().is_some_and(|(_, pt)| t(pt).starts_with('*')) { "&" } else { "" };
                            format!("{recv}.{} = {amp}{}", fname(x), go_name(p, false))
                        }),
                        Body::Todo if m.is_abstract => "panic(\"abstract: implement in a type that embeds this one\")".into(),
                        Body::Todo => "panic(\"not implemented\")".into(),
                        // Made above, as NewX
                        Body::Init(_) => continue,
                    };
                    let name = go_name(&m.name, method_vis(m) == Vis::Public);
                    if m.is_static {
                        let fname = go_name(&format!("{}_{}", c.name, m.name), method_vis(m) == Vis::Public);
                        body.push_str(&format!("\nfunc {fname}({}){} {{\n\t{code}\n}}\n", params(m), ret(m, c)));
                    } else {
                        body.push_str(&format!("\nfunc ({recv} *{}) {name}({}){} {{\n\t{code}\n}}\n", c.name, params(m), ret(m, c)));
                    }
                }

                // Go implements interfaces implicitly: let the compiler check it
                for i in &c.implements {
                    body.push_str(&format!("\n// {} implements {i}.\nvar _ {i} = (*{})(nil)\n", c.name, c.name));
                }
            }
        }
    }

    let pkg = classes
        .iter()
        .find_map(|c| c.package.clone())
        .and_then(|p| p.rsplit('.').next().map(|s| s.chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()))
        .filter(|p| !p.is_empty() && p.starts_with(char::is_alphabetic))
        .unwrap_or_else(|| "model".into());
    let imports = if body.contains("time.") { "\nimport \"time\"\n" } else { "" };
    format!("package {pkg}\n{imports}{body}")
}
