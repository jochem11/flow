//! TypeScript.

use super::*;

pub(super) fn typescript(classes: &[Class]) -> String {
    let l = CodeLanguage::TypeScript;
    let t = |s: &str| ty(&parse_ty(s), l, false);
    let params = |m: &Method| m.params.iter().map(|(n, ty)| format!("{}: {}", camel(n), t(ty))).collect::<Vec<_>>().join(", ");
    let ret = |m: &Method| m.ret.as_deref().map_or("void".into(), t);
    let supers = supertypes(classes);
    let mut s = String::new();
    for c in classes {
        match c.kind {
            Kind::Enum => {
                s.push_str(&format!("export enum {} {{\n", c.name));
                for v in &c.values {
                    s.push_str(&format!("  {} = \"{}\",\n", pascal(v), v));
                }
            }
            Kind::Interface => {
                let ext = if c.implements.is_empty() { String::new() } else { format!(" extends {}", c.implements.join(", ")) };
                s.push_str(&format!("export interface {}{ext} {{\n", c.name));
                for f in &c.fields {
                    s.push_str(&format!("  {}: {};\n", camel(&f.name), t(&f.ty)));
                }
                for m in &c.methods {
                    s.push_str(&format!("  {}({}): {};\n", camel(&m.name), params(m), ret(m)));
                }
            }
            _ => {
                let abs = if c.kind == Kind::Abstract { "abstract " } else { "" };
                let ext = c.extends.as_ref().map_or(String::new(), |e| format!(" extends {e}"));
                let imp = if c.implements.is_empty() { String::new() } else { format!(" implements {}", c.implements.join(", ")) };
                s.push_str(&format!("export {abs}class {}{ext}{imp} {{\n", c.name));
                for f in &c.fields {
                    let parsed = parse_ty(&f.ty);
                    let init = match (&f.default, &parsed) {
                        (Some(d), _) => format!(" = {}", default_value(l, &t(&f.ty), d)),
                        (None, Ty::List(_)) => " = []".into(),
                        (None, Ty::Set(_)) => " = new Set()".into(),
                        (None, Ty::Map(..)) => " = new Map()".into(),
                        (None, Ty::Optional(_)) => " = null".into(),
                        _ => String::new(),
                    };
                    // Set later (for example by a constructor): tell the compiler
                    let bang = if init.is_empty() && !f.is_static { "!" } else { "" };
                    let st = if f.is_static { "static " } else { "" };
                    // Read-only, and every field of a record
                    let ro = if f.read_only || c.kind == Kind::Record { "readonly " } else { "" };
                    s.push_str(&format!("  {} {st}{ro}{}{bang}: {}{init};\n", vis_word(field_vis(f), "public"), camel(&f.name), t(&f.ty)));
                }
                // A record without a constructor in the diagram: one with all its fields
                if c.kind == Kind::Record && !c.methods.iter().any(|m| matches!(m.body, Body::Init(_))) {
                    let fields: Vec<&Field> = c.fields.iter().filter(|f| !f.is_static).collect();
                    let ps: Vec<String> = fields.iter().map(|f| format!("{}: {}", camel(&f.name), t(&f.ty))).collect();
                    let set: String = fields.iter().map(|f| format!("\n    this.{n} = {n};", n = camel(&f.name))).collect();
                    s.push_str(&format!("  constructor({}) {{{set}\n  }}\n", ps.join(", ")));
                }
                for m in &c.methods {
                    // The constructor: a subclass calls its superclass's first
                    if let Body::Init(sets) = &m.body {
                        let sup = if c.extends.is_some() { "\n    super();" } else { "" };
                        // Subclasses call super() without arguments: then the parameters are optional
                        let optional = supers.contains(&c.name);
                        let set: String = sets
                            .iter()
                            .map(|(f, p)| {
                                if optional {
                                    format!("\n    if ({p} !== undefined) this.{} = {p};", camel(f), p = camel(p))
                                } else {
                                    format!("\n    this.{} = {};", camel(f), camel(p))
                                }
                            })
                            .collect();
                        let ps = if optional {
                            m.params.iter().map(|(n, ty)| format!("{}?: {}", camel(n), t(ty))).collect::<Vec<_>>().join(", ")
                        } else {
                            params(m)
                        };
                        s.push_str(&format!("  {} constructor({ps}) {{{sup}{set}\n  }}\n", vis_word(method_vis(m), "public")));
                        continue;
                    }
                    let st = if m.is_static { "static " } else { "" };
                    let head = format!("  {} {st}", vis_word(method_vis(m), "public"));
                    if m.is_abstract && c.kind == Kind::Abstract {
                        s.push_str(&format!("{head}abstract {}({}): {};\n", camel(&m.name), params(m), ret(m)));
                    } else {
                        let body = match &m.body {
                            Body::Get(f) => format!("return this.{};", camel(f)),
                            Body::Set(f, p) => format!("this.{} = {};", camel(f), camel(p)),
                            Body::Todo | Body::Init(_) => "throw new Error(\"Not implemented\");".into(),
                        };
                        s.push_str(&format!("{head}{}({}): {} {{\n    {body}\n  }}\n", camel(&m.name), params(m), ret(m)));
                    }
                }
            }
        }
        s.push_str(&unreadable(c, "//", "  "));
        s.push_str("}\n\n");
    }
    s
}
