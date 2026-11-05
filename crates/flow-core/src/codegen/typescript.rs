//! TypeScript.

use super::*;

pub(super) fn typescript(classes: &[Class]) -> String {
    let l = CodeLanguage::TypeScript;
    let t = |s: &str| ty(&parse_ty(s), l, false);
    let params = |m: &Method| m.params.iter().map(|(n, ty)| format!("{}: {}", camel(n), t(ty))).collect::<Vec<_>>().join(", ");
    let ret = |m: &Method| m.ret.as_deref().map_or("void".into(), t);
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
                        (None, Ty::Optional(_)) => " = null".into(),
                        _ => String::new(),
                    };
                    // Set later (for example by a constructor): tell the compiler
                    let bang = if init.is_empty() && !f.is_static { "!" } else { "" };
                    let st = if f.is_static { "static " } else { "" };
                    s.push_str(&format!("  {} {st}{}{bang}: {}{init};\n", vis_word(field_vis(f), "public"), camel(&f.name), t(&f.ty)));
                }
                for m in &c.methods {
                    let st = if m.is_static { "static " } else { "" };
                    let head = format!("  {} {st}", vis_word(method_vis(m), "public"));
                    if m.is_abstract && c.kind == Kind::Abstract {
                        s.push_str(&format!("{head}abstract {}({}): {};\n", camel(&m.name), params(m), ret(m)));
                    } else {
                        let body = match &m.body {
                            Body::Get(f) => format!("return this.{};", camel(f)),
                            Body::Set(f, p) => format!("this.{} = {};", camel(f), camel(p)),
                            Body::Todo => "throw new Error(\"Not implemented\");".into(),
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
