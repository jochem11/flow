//! Rust: structs, traits for interfaces, the supertype as a field.

use super::*;

pub(super) fn rust(classes: &[Class]) -> String {
    let structs: BTreeSet<String> =
        classes.iter().filter(|c| matches!(c.kind, Kind::Class | Kind::Abstract)).map(|c| c.name.clone()).collect();
    let traits: BTreeSet<String> = classes.iter().filter(|c| c.kind == Kind::Interface).map(|c| c.name.clone()).collect();
    // A type in Rust: an interface is a trait, so it is used as `Box<dyn Trait>`
    fn rs(t: &Ty, traits: &BTreeSet<String>) -> String {
        match t {
            Ty::Named(n) if traits.contains(&pascal(n)) => format!("Box<dyn {}>", pascal(n)),
            Ty::List(inner) => format!("Vec<{}>", rs(inner, traits)),
            Ty::Optional(inner) => format!("Option<{}>", rs(inner, traits)),
            other => ty(other, CodeLanguage::Rust, false),
        }
    }
    // A struct field pointing to another struct is boxed, so structs that refer
    // to each other still have a size; an interface field is optional, so it has a default
    let field_ty = |raw: &str| match parse_ty(raw) {
        Ty::Optional(inner) => match *inner {
            Ty::Named(n) if structs.contains(&pascal(&n)) => format!("Option<Box<{}>>", pascal(&n)),
            other => format!("Option<{}>", rs(&other, &traits)),
        },
        Ty::Named(n) if structs.contains(&pascal(&n)) => format!("Box<{}>", pascal(&n)),
        Ty::Named(n) if traits.contains(&pascal(&n)) => format!("Option<Box<dyn {}>>", pascal(&n)),
        other => rs(&other, &traits),
    };
    // Structs holding a trait object cannot derive Clone or Debug (also via their base)
    let mut dyn_structs: BTreeSet<String> = BTreeSet::new();
    for c in classes {
        let own = c.fields.iter().any(|f| field_ty(&f.ty).contains("dyn "));
        if own || c.extends.as_ref().is_some_and(|e| dyn_structs.contains(e)) {
            dyn_structs.insert(c.name.clone());
        }
    }
    let t = |s: &str| rs(&parse_ty(s), &traits);
    let vis = |v: Vis| if v == Vis::Public { "pub " } else { "" };
    let params = |m: &Method| {
        let mut p: Vec<String> = if m.is_static { vec![] } else { vec!["&self".into()] };
        p.extend(m.params.iter().map(|(n, pt)| format!("{}: {}", snake(n), t(pt))));
        p.join(", ")
    };
    let ret = |m: &Method| m.ret.as_deref().map(t).filter(|r| r != "()").map_or(String::new(), |r| format!(" -> {r}"));

    let mut s = String::new();
    for c in classes {
        match c.kind {
            Kind::Enum => {
                // Default to the first value, so structs with this field can derive Default
                s.push_str(&format!("#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]\npub enum {} {{\n", c.name));
                for (i, v) in c.values.iter().enumerate() {
                    let def = if i == 0 { "#[default]\n    " } else { "" };
                    s.push_str(&format!("    {def}{},\n", pascal(v)));
                }
                s.push_str(&unreadable(c, "//", "    "));
                s.push_str("}\n\n");
            }
            Kind::Interface => {
                let sup = if c.implements.is_empty() { String::new() } else { format!(": {}", c.implements.join(" + ")) };
                s.push_str(&format!("pub trait {}{sup} {{\n", c.name));
                for m in &c.methods {
                    s.push_str(&format!("    fn {}({}){};\n", snake(&m.name), params(m), ret(m)));
                }
                s.push_str(&unreadable(c, "//", "    "));
                s.push_str("}\n\n");
            }
            _ => {
                if c.kind == Kind::Abstract {
                    s.push_str("/// Abstract in the diagram; Rust has no abstract types, so this is a plain struct\n");
                }
                let derive = if dyn_structs.contains(&c.name) { "Default" } else { "Debug, Clone, Default" };
                s.push_str(&format!("#[derive({derive})]\npub struct {} {{\n", c.name));
                // Rust has no inheritance: the supertype becomes a field
                if let Some(e) = &c.extends {
                    s.push_str(&format!("    /// Extends {e} in the diagram\n    pub base: {e},\n"));
                }
                for f in c.fields.iter().filter(|f| !f.is_static) {
                    s.push_str(&format!("    {}{}: {},\n", vis(f.vis), snake(&f.name), field_ty(&f.ty)));
                }
                s.push_str(&unreadable(c, "//", "    "));
                s.push_str("}\n");
                let consts: Vec<&Field> = c.fields.iter().filter(|f| f.is_static).collect();
                if !c.methods.is_empty() || !consts.is_empty() {
                    s.push_str(&format!("\nimpl {} {{\n", c.name));
                    for f in consts {
                        // A const needs a value that is known when compiling
                        let ft = field_ty(&f.ty);
                        let value = f.default.clone().or_else(|| ft.starts_with("Option<").then(|| "None".into()));
                        match value {
                            Some(v) if !ft.contains("Box<") => {
                                s.push_str(&format!("    {}const {}: {ft} = {v};\n", vis(f.vis), snake(&f.name).to_uppercase()))
                            }
                            _ => s.push_str(&format!("    // static {}: {ft} (keep it in a OnceLock or pass it around)\n", snake(&f.name))),
                        }
                    }
                    for m in &c.methods {
                        // Interface methods go in the `impl Trait for` blocks below
                        let from_trait = c.implements.iter().filter_map(|i| classes.iter().find(|x| &x.name == i)).any(|i| i.methods.iter().any(|x| x.name == m.name));
                        if from_trait {
                            continue;
                        }
                        let field_of = |f: &str| c.fields.iter().find(|x| x.name == f);
                        let (params, ret, code) = match &m.body {
                            // A reference: works for every type, also ones that cannot be cloned
                            Body::Get(f) => (
                                params(m),
                                field_of(f).map_or(ret(m), |x| format!(" -> &{}", field_ty(&x.ty))),
                                format!("&self.{}", snake(f)),
                            ),
                            Body::Set(f, p) => {
                                // An optional field takes the value as Some(..)
                                let optional = field_of(f).is_some_and(|x| field_ty(&x.ty).starts_with("Option<"))
                                    && !m.params.first().is_some_and(|(_, pt)| t(pt).starts_with("Option<"));
                                let v = if optional { format!("Some({})", snake(p)) } else { snake(p) };
                                (params(m).replacen("&self", "&mut self", 1), ret(m), format!("self.{} = {v};", snake(f)))
                            }
                            Body::Todo => (params(m), ret(m), "todo!()".into()),
                        };
                        s.push_str(&format!("    {}fn {}({params}){ret} {{\n        {code}\n    }}\n", vis(method_vis(m)), snake(&m.name)));
                    }
                    s.push_str("}\n");
                }
                for i in &c.implements {
                    let methods = classes.iter().find(|x| &x.name == i).map(|x| x.methods.clone()).unwrap_or_default();
                    s.push_str(&format!("\nimpl {i} for {} {{\n", c.name));
                    for m in &methods {
                        s.push_str(&format!("    fn {}({}){} {{\n        todo!()\n    }}\n", snake(&m.name), params(m), ret(m)));
                    }
                    s.push_str("}\n");
                }
                s.push('\n');
            }
        }
    }
    s
}
