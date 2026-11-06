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
            match c.enum_numbers() {
                None => {
                    let values: Vec<String> = c.values.iter().map(|v| snake(v).to_uppercase()).collect();
                    s.push_str(&format!("enum class {} {{\n    {},\n{}}}\n", c.name, values.join(",\n    "), unreadable(c, "//", "    ")));
                }
                // Values that stand for something: a property
                Some(numbers) => {
                    let ty = if numbers { "Int" } else { "String" };
                    let values: Vec<String> = c.values.iter().enumerate().map(|(i, v)| format!("{}({})", snake(v).to_uppercase(), c.enum_literal(i))).collect();
                    s.push_str(&format!("enum class {}(val value: {ty}) {{\n    {},\n{}}}\n", c.name, values.join(",\n    "), unreadable(c, "//", "    ")));
                }
            }
            continue;
        }
        let over = inherited(classes, c);
        // With a constructor of its own, the superclass is called from that constructor
        let has_constructor = c.methods.iter().any(|m| matches!(m.body, Body::Init(_)));
        let call = if has_constructor { "" } else { "()" };
        let mut bases: Vec<String> = c.extends.iter().map(|e| format!("{e}{call}")).collect();
        bases.extend(c.implements.iter().cloned());
        let bases = if bases.is_empty() { String::new() } else { format!(" : {}", bases.join(", ")) };
        let open = supers.contains(&c.name) && c.kind == Kind::Class;
        let head = match c.kind {
            Kind::Interface => format!("interface {}{}", c.name, c.generics()),
            Kind::Abstract => format!("abstract class {}{}", c.name, c.generics()),
            // A record: a data class with its attributes as `val`s in its constructor
            Kind::Record => {
                let props: Vec<String> = c
                    .fields
                    .iter()
                    .filter(|f| !f.is_static)
                    .map(|f| {
                        let ft = t(&f.ty);
                        let init = f.default.as_ref().map_or(String::new(), |d| format!(" = {}", default_value(l, &ft, d)));
                        format!("val {}: {ft}{init}", camel(&f.name))
                    })
                    .collect();
                format!("data class {}{}({})", c.name, c.generics(), props.join(", "))
            }
            _ if open => format!("open class {}{}", c.name, c.generics()),
            _ => format!("class {}{}", c.name, c.generics()),
        };
        s.push_str(&format!("{head}{bases} {{\n"));
        let mut field_types: HashMap<String, String> = HashMap::new();
        for f in c.fields.iter().filter(|f| c.kind != Kind::Record || f.is_static) {
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
            // Read-only: a val when it has its value, else only this class sets it
            if f.read_only && f.default.is_some() {
                s.push_str(&format!("    {vis}val {}: {ft}{init}\n", camel(&f.name)));
            } else if f.read_only && vis != "private " {
                s.push_str(&format!("    {vis}var {}: {ft}{init}\n        private set\n", camel(&f.name)));
            } else {
                s.push_str(&format!("    {vis}var {}: {ft}{init}\n", camel(&f.name)));
            }
            field_types.insert(f.name.clone(), ft);
        }
        for m in &c.methods {
            let params: Vec<String> = m.params.iter().map(|(n, pt)| format!("{}: {}", camel(n), t(pt))).collect();
            if let Body::Init(sets) = &m.body {
                if c.kind == Kind::Record {
                    s.push_str(&format!("    // {}(...): a data class's constructor takes all its properties\n", c.name));
                    continue;
                }
                let sup = if c.extends.is_some() { " : super()" } else { "" };
                let set: String = sets.iter().map(|(f, p)| format!("\n        this.{} = {}", camel(f), camel(p))).collect();
                // Subclasses call super() without arguments
                if supers.contains(&c.name) && !params.is_empty() {
                    s.push_str(&format!("    constructor(){sup}\n"));
                }
                s.push_str(&format!("    constructor({}){sup} {{{set}\n    }}\n", params.join(", ")));
                continue;
            }
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
                    Body::Todo | Body::Init(_) => None,
                };
                if let Some(f) = accessor_of.filter(|f| field_vis(f) != Vis::Private) {
                    s.push_str(&format!("    // {}(): the property `{}` provides it\n", camel(&m.name), camel(&f.name)));
                    continue;
                }
                let code = match &m.body {
                    Body::Get(f) => format!(" = {}", camel(f)),
                    Body::Set(f, p) => format!(" {{\n        this.{} = {}\n    }}", camel(f), camel(p)),
                    Body::Todo | Body::Init(_) => " = TODO(\"Not implemented\")".into(),
                };
                s.push_str(&format!("    {modifier}{sig}{code}\n"));
            }
        }
        s.push_str(&unreadable(c, "//", "    "));
        s.push_str("}\n");
    }
    s
}
