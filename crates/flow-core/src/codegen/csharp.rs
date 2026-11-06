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
            for (i, v) in c.values.iter().enumerate() {
                match (c.enum_numbers(), c.enum_value(i)) {
                    (Some(true), _) => s.push_str(&format!("    {} = {},\n", pascal(v), c.enum_literal(i))),
                    // A C# enum holds numbers only
                    (Some(false), Some(text)) => s.push_str(&format!("    {}, // {text}\n", pascal(v))),
                    _ => s.push_str(&format!("    {},\n", pascal(v))),
                }
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
            Kind::Record => "public record",
            _ => "public class",
        };
        // A record's attributes are its parameters (positional record)
        let comps = if c.kind == Kind::Record {
            let p: Vec<String> = c.fields.iter().filter(|f| !f.is_static).map(|f| format!("{} {}", t(&f.ty), pascal(&f.name))).collect();
            format!("({})", p.join(", "))
        } else {
            String::new()
        };
        s.push_str(&format!("{head} {}{}{comps}{bases}\n{{\n", c.name, c.generics()));
        // Methods that a base class (not an interface) already has
        let base_methods: BTreeSet<String> = c
            .extends
            .iter()
            .filter_map(|e| classes.iter().find(|x| &x.name == e))
            .flat_map(|b| b.methods.iter().map(|m| m.name.clone()).chain(inherited(classes, b)))
            .collect();
        for f in c.fields.iter().filter(|f| c.kind != Kind::Record || f.is_static) {
            let ft = t(&f.ty);
            let st = if f.is_static { "static " } else { "" };
            // Read-only: set once, when the object is made
            let set = if f.read_only { "init" } else { "set" };
            let init = match &f.default {
                Some(d) => format!(" = {};", default_value(l, &ft, d)),
                None if ft.starts_with("List<") || ft.starts_with("HashSet<") || ft.starts_with("Dictionary<") => " = new();".into(),
                None if ft == "string" => " = \"\";".into(),
                _ => String::new(),
            };
            if c.kind == Kind::Interface {
                s.push_str(&format!("    {ft} {} {{ get; set; }}\n", pascal(&f.name)));
            } else {
                s.push_str(&format!("    {} {st}{ft} {} {{ get; {set}; }}{init}\n", vis_word(field_vis(f), "private"), pascal(&f.name)));
            }
        }
        for m in &c.methods {
            let params: Vec<String> = m.params.iter().map(|(n, pt)| format!("{} {}", t(pt), camel(n))).collect();
            if let Body::Init(sets) = &m.body {
                if c.kind == Kind::Record {
                    s.push_str(&format!("    // {}(...): a record's constructor takes all its components\n", c.name));
                    continue;
                }
                let set: String = sets.iter().map(|(f, p)| format!("\n        {} = {};", pascal(f), camel(p))).collect();
                // Subclasses call base() without arguments
                if supers.contains(&c.name) && !params.is_empty() {
                    s.push_str(&format!("    protected {}()\n    {{\n    }}\n\n", c.name));
                }
                s.push_str(&format!("    {} {}({})\n    {{{set}\n    }}\n", vis_word(method_vis(m), "public"), c.name, params.join(", ")));
                continue;
            }
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
                    Body::Todo | Body::Init(_) => "throw new NotImplementedException()".into(),
                };
                s.push_str(&format!("    {vis} {st}{modifier}{sig} => {code};\n"));
            }
        }
        s.push_str(&unreadable(c, "//", "    "));
        s.push_str("}\n");
    }
    s
}
