//! C#.

use super::*;

pub(super) fn csharp(classes: &[Class]) -> String {
    let l = CodeLanguage::CSharp;
    let t = |s: &str| ty(&parse_ty(s), l, false);
    let supers = supertypes(classes);
    let ns = classes.iter().find_map(|c| c.package.clone()).map_or("Model".into(), |p| p.split('.').map(pascal).collect::<Vec<_>>().join("."));
    let mut s = format!("using System;\nusing System.Collections.Generic;\n\nnamespace {ns};\n");
    for c in classes {
        s.push('\n');
        if c.kind == Kind::Enum {
            s.push_str(&format!("public enum {}\n{{\n", c.name));
            for v in &c.values {
                s.push_str(&format!("    {},\n", pascal(v)));
            }
            s.push_str(&unreadable(c, "//", "    "));
            s.push_str("}\n");
            continue;
        }
        let bases: Vec<String> = c.extends.iter().chain(&c.implements).cloned().collect();
        let bases = if bases.is_empty() { String::new() } else { format!(" : {}", bases.join(", ")) };
        let head = match c.kind {
            Kind::Interface => "public interface",
            Kind::Abstract => "public abstract class",
            _ => "public class",
        };
        s.push_str(&format!("{head} {}{bases}\n{{\n", c.name));
        // Methods that a base class (not an interface) already has
        let base_methods: BTreeSet<String> = c
            .extends
            .iter()
            .filter_map(|e| classes.iter().find(|x| &x.name == e))
            .flat_map(|b| b.methods.iter().map(|m| m.name.clone()).chain(inherited(classes, b)))
            .collect();
        for f in &c.fields {
            let ft = t(&f.ty);
            let st = if f.is_static { "static " } else { "" };
            let init = match &f.default {
                Some(d) => format!(" = {};", default_value(l, &ft, d)),
                None if ft.starts_with("List<") => " = new();".into(),
                None if ft == "string" => " = \"\";".into(),
                _ => String::new(),
            };
            if c.kind == Kind::Interface {
                s.push_str(&format!("    {ft} {} {{ get; set; }}\n", pascal(&f.name)));
            } else {
                s.push_str(&format!("    {} {st}{ft} {} {{ get; set; }}{init}\n", vis_word(field_vis(f), "private"), pascal(&f.name)));
            }
        }
        for m in &c.methods {
            let params: Vec<String> = m.params.iter().map(|(n, pt)| format!("{} {}", t(pt), camel(n))).collect();
            let ret = m.ret.as_deref().map_or("void".into(), t);
            let sig = format!("{ret} {}({})", pascal(&m.name), params.join(", "));
            let st = if m.is_static { "static " } else { "" };
            let vis = vis_word(method_vis(m), "public");
            if c.kind == Kind::Interface {
                s.push_str(&format!("    {sig};\n"));
            } else if m.is_abstract && c.kind == Kind::Abstract {
                s.push_str(&format!("    {vis} abstract {sig};\n"));
            } else {
                // Overriding a base class method, or open for subclasses to override
                let modifier = if base_methods.contains(&m.name) {
                    "override "
                } else if supers.contains(&c.name) && !m.is_static {
                    "virtual "
                } else {
                    ""
                };
                let code = match &m.body {
                    Body::Get(f) => pascal(f),
                    Body::Set(f, p) => format!("{} = {}", pascal(f), camel(p)),
                    Body::Todo => "throw new NotImplementedException()".into(),
                };
                s.push_str(&format!("    {vis} {st}{modifier}{sig} => {code};\n"));
            }
        }
        s.push_str(&unreadable(c, "//", "    "));
        s.push_str("}\n");
    }
    s
}
