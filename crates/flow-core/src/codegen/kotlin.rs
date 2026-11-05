//! Kotlin.

use super::*;

pub(super) fn kotlin(classes: &[Class]) -> String {
    let l = CodeLanguage::Kotlin;
    let t = |s: &str| ty(&parse_ty(s), l, false);
    let supers = supertypes(classes);
    let mut s = String::new();
    if let Some(p) = classes.iter().find_map(|c| c.package.clone()) {
        s.push_str(&format!("package {}\n", p.to_lowercase()));
    }
    // Imports for the JVM types that are used
    let used: BTreeSet<String> = classes
        .iter()
        .flat_map(|c| {
            c.fields.iter().map(|f| t(&f.ty)).chain(c.methods.iter().flat_map(|m| m.params.iter().map(|p| t(&p.1)).chain(m.ret.as_deref().map(t))))
        })
        .flat_map(|x| x.split(|c: char| !c.is_alphanumeric()).map(String::from).collect::<Vec<_>>())
        .collect();
    let imports: Vec<&str> = [
        ("BigDecimal", "java.math.BigDecimal"),
        ("LocalDateTime", "java.time.LocalDateTime"),
        ("LocalDate", "java.time.LocalDate"),
        ("LocalTime", "java.time.LocalTime"),
        ("Duration", "java.time.Duration"),
        ("UUID", "java.util.UUID"),
    ]
        .into_iter()
        .filter(|(w, _)| used.contains(*w))
        .map(|(_, i)| i)
        .collect();
    if !imports.is_empty() {
        s.push('\n');
        for i in imports {
            s.push_str(&format!("import {i}\n"));
        }
    }
    for c in classes {
        s.push('\n');
        if c.kind == Kind::Enum {
            let values: Vec<String> = c.values.iter().map(|v| snake(v).to_uppercase()).collect();
            s.push_str(&format!("enum class {} {{\n    {},\n{}}}\n", c.name, values.join(",\n    "), unreadable(c, "//", "    ")));
            continue;
        }
        let over = inherited(classes, c);
        let mut bases: Vec<String> = c.extends.iter().map(|e| format!("{e}()")).collect();
        bases.extend(c.implements.iter().cloned());
        let bases = if bases.is_empty() { String::new() } else { format!(" : {}", bases.join(", ")) };
        let open = supers.contains(&c.name) && c.kind == Kind::Class;
        let head = match c.kind {
            Kind::Interface => format!("interface {}", c.name),
            Kind::Abstract => format!("abstract class {}", c.name),
            _ if open => format!("open class {}", c.name),
            _ => format!("class {}", c.name),
        };
        s.push_str(&format!("{head}{bases} {{\n"));
        let mut field_types: HashMap<String, String> = HashMap::new();
        for f in &c.fields {
            let mut ft = t(&f.ty);
            let init = match &f.default {
                Some(d) => format!(" = {}", default_value(l, &ft, d)),
                None if ft.starts_with("List<") => {
                    ft = format!("Mutable{ft}");
                    " = mutableListOf()".into()
                }
                None if c.kind == Kind::Interface => String::new(),
                None => {
                    if !ft.ends_with('?') {
                        ft.push('?');
                    }
                    " = null".into()
                }
            };
            let vis = match field_vis(f) {
                Vis::Private if c.kind != Kind::Interface => "private ",
                Vis::Protected => "protected ",
                _ => "",
            };
            s.push_str(&format!("    {vis}var {}: {ft}{init}\n", camel(&f.name)));
            field_types.insert(f.name.clone(), ft);
        }
        for m in &c.methods {
            let params: Vec<String> = m.params.iter().map(|(n, pt)| format!("{}: {}", camel(n), t(pt))).collect();
            let ret = match &m.body {
                Body::Get(f) => field_types.get(f).cloned().unwrap_or_else(|| m.ret.as_deref().map_or("Unit".into(), t)),
                _ => m.ret.as_deref().map_or("Unit".into(), t),
            };
            let sig = format!("fun {}({}): {ret}", camel(&m.name), params.join(", "));
            if c.kind == Kind::Interface {
                s.push_str(&format!("    {sig}\n"));
            } else if m.is_abstract && c.kind == Kind::Abstract {
                s.push_str(&format!("    abstract {sig}\n"));
            } else {
                let modifier = if over.contains(&m.name) {
                    "override "
                } else {
                    match method_vis(m) {
                        Vis::Private => "private ",
                        Vis::Protected => "protected ",
                        _ if open => "open ",
                        _ => "",
                    }
                };
                // A public property already has getX()/setX() on the JVM: a second one would clash
                let accessor_of = match &m.body {
                    Body::Get(f) | Body::Set(f, _) => c.fields.iter().find(|x| &x.name == f),
                    Body::Todo => None,
                };
                if let Some(f) = accessor_of.filter(|f| field_vis(f) != Vis::Private) {
                    s.push_str(&format!("    // {}(): the property `{}` provides it\n", camel(&m.name), camel(&f.name)));
                    continue;
                }
                let code = match &m.body {
                    Body::Get(f) => format!(" = {}", camel(f)),
                    Body::Set(f, p) => format!(" {{\n        this.{} = {}\n    }}", camel(f), camel(p)),
                    Body::Todo => " = TODO(\"Not implemented\")".into(),
                };
                s.push_str(&format!("    {modifier}{sig}{code}\n"));
            }
        }
        s.push_str(&unreadable(c, "//", "    "));
        s.push_str("}\n");
    }
    s
}
