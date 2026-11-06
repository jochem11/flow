//! Java: one file per class.

use super::*;

/// A type in Java, noting the import it needs.
pub(super) fn java_ty(t: &str, imports: &mut BTreeSet<&'static str>) -> String {
    let out = ty(&parse_ty(t), CodeLanguage::Java, false);
    let words: Vec<&str> = out.split(|c: char| !c.is_alphanumeric()).collect();
    for (word, import) in [
        ("List", "java.util.List"),
        ("Set", "java.util.Set"),
        ("Map", "java.util.Map"),
        ("LocalTime", "java.time.LocalTime"),
        ("Duration", "java.time.Duration"),
        ("BigDecimal", "java.math.BigDecimal"),
        ("LocalDateTime", "java.time.LocalDateTime"),
        ("LocalDate", "java.time.LocalDate"),
        ("UUID", "java.util.UUID"),
    ] {
        if words.contains(&word) {
            imports.insert(import);
        }
    }
    out
}

/// The Java package of a class. Classes outside any package go into the diagram's
/// first package: Java cannot reach classes without a package from inside one.
pub(super) fn java_package(c: &Class, classes: &[Class]) -> Option<String> {
    c.package.clone().or_else(|| classes.iter().find_map(|x| x.package.clone())).map(|p| p.to_lowercase())
}

pub(super) fn java(c: &Class, classes: &[Class]) -> String {
    let mut imports: BTreeSet<&'static str> = BTreeSet::new();
    let over = inherited(classes, c);
    // Subclasses call super() without arguments: a superclass with a constructor
    // that takes some also gets one that takes none
    let is_super = supertypes(classes).contains(&c.name);
    let own_package = java_package(c, classes);
    // Classes from another package that this one uses
    let used: BTreeSet<String> = c
        .fields
        .iter()
        .map(|f| f.ty.clone())
        .chain(c.methods.iter().flat_map(|m| m.params.iter().map(|p| p.1.clone()).chain(m.ret.clone())))
        .chain(c.extends.clone())
        .chain(c.implements.clone())
        .flat_map(|t| t.split(|ch: char| !ch.is_alphanumeric() && ch != '_').map(String::from).collect::<Vec<_>>())
        .collect();
    let class_imports: Vec<String> = classes
        .iter()
        .filter(|x| x.name != c.name && used.contains(&x.name))
        .filter_map(|x| java_package(x, classes).filter(|p| Some(p) != own_package.as_ref()).map(|p| format!("{p}.{}", x.name)))
        .collect();
    let mut body = String::new();
    let head = match c.kind {
        Kind::Interface => {
            let ext = if c.implements.is_empty() { String::new() } else { format!(" extends {}", c.implements.join(", ")) };
            format!("public interface {}{ext}", c.name)
        }
        Kind::Enum => format!("public enum {}", c.name),
        // Its attributes are its components; a record cannot extend a class
        Kind::Record => {
            let comps: Vec<String> = c.fields.iter().filter(|f| !f.is_static).map(|f| format!("{} {}", java_ty(&f.ty, &mut imports), camel(&f.name))).collect();
            let imp = if c.implements.is_empty() { String::new() } else { format!(" implements {}", c.implements.join(", ")) };
            format!("public record {}({}){imp}", c.name, comps.join(", "))
        }
        _ => {
            let abs = if c.kind == Kind::Abstract { "abstract " } else { "" };
            let ext = c.extends.as_ref().map_or(String::new(), |e| format!(" extends {e}"));
            let imp = if c.implements.is_empty() { String::new() } else { format!(" implements {}", c.implements.join(", ")) };
            format!("public {abs}class {}{ext}{imp}", c.name)
        }
    };
    if c.kind == Kind::Enum {
        let values: Vec<String> = c.values.iter().map(|v| snake(v).to_uppercase()).collect();
        body.push_str(&format!("    {}\n", values.join(",\n    ")));
    }
    // Attributes a constructor sets
    let set_by_constructor: BTreeSet<&str> = c
        .methods
        .iter()
        .filter_map(|m| if let Body::Init(sets) = &m.body { Some(sets) } else { None })
        .flatten()
        .map(|(f, _)| f.as_str())
        .collect();
    // A record's attributes are its components (in its header), only static ones stay here
    for f in c.fields.iter().filter(|f| c.kind != Kind::Record || f.is_static) {
        let t = java_ty(&f.ty, &mut imports);
        let st = if f.is_static { "static " } else { "" };
        let init = match &f.default {
            Some(d) => format!(" = {}", default_value(CodeLanguage::Java, &t, d)),
            None if t.starts_with("List<") => {
                imports.insert("java.util.ArrayList");
                " = new ArrayList<>()".into()
            }
            None if t.starts_with("Set<") => {
                imports.insert("java.util.HashSet");
                " = new HashSet<>()".into()
            }
            None if t.starts_with("Map<") => {
                imports.insert("java.util.HashMap");
                " = new HashMap<>()".into()
            }
            None => String::new(),
        };
        // Read-only: final, when it gets a value (a default, or every constructor sets it)
        let fin = if f.read_only && (f.default.is_some() || (set_by_constructor.contains(f.name.as_str()) && !is_super)) { "final " } else { "" };
        body.push_str(&format!("    {} {st}{fin}{t} {}{init};\n", vis_word(field_vis(f), "private"), camel(&f.name)));
    }
    if !c.fields.is_empty() && !c.methods.is_empty() {
        body.push('\n');
    }
    for m in &c.methods {
        let params: Vec<String> = m.params.iter().map(|(n, t)| format!("{} {}", java_ty(t, &mut imports), camel(n))).collect();
        if let Body::Init(sets) = &m.body {
            // A record already has a constructor with all its components
            if c.kind == Kind::Record {
                body.push_str(&format!("    // {}(...): a record's constructor takes all its components\n", c.name));
                continue;
            }
            let set: String = sets.iter().map(|(f, p)| format!("\n        this.{} = {};", camel(f), camel(p))).collect();
            if is_super && !params.is_empty() {
                body.push_str(&format!("    protected {}() {{\n    }}\n\n", c.name));
            }
            body.push_str(&format!("    {} {}({}) {{{set}\n    }}\n", vis_word(method_vis(m), "public"), c.name, params.join(", ")));
            continue;
        }
        let ret = m.ret.as_deref().map_or("void".into(), |t| java_ty(t, &mut imports));
        let sig = format!("{ret} {}({})", camel(&m.name), params.join(", "));
        let st = if m.is_static { "static " } else { "" };
        if c.kind == Kind::Interface {
            body.push_str(&format!("    {sig};\n"));
        } else if m.is_abstract && c.kind == Kind::Abstract {
            body.push_str(&format!("    {} abstract {sig};\n", vis_word(method_vis(m), "public")));
        } else {
            let at = if over.contains(&m.name) { "    @Override\n" } else { "" };
            let code = match &m.body {
                Body::Get(f) => format!("return this.{};", camel(f)),
                Body::Set(f, p) => format!("this.{} = {};", camel(f), camel(p)),
                Body::Todo | Body::Init(_) => "throw new UnsupportedOperationException(\"Not implemented\");".into(),
            };
            body.push_str(&format!("{at}    {} {st}{sig} {{\n        {code}\n    }}\n", vis_word(method_vis(m), "public")));
        }
    }
    body.push_str(&unreadable(c, "//", "    "));

    let mut s = String::new();
    if let Some(p) = &own_package {
        s.push_str(&format!("package {p};\n\n"));
    }
    for i in imports.iter().map(|i| i.to_string()).chain(class_imports) {
        s.push_str(&format!("import {i};\n"));
    }
    if !s.ends_with("\n\n") && s.contains("import ") {
        s.push('\n');
    }
    s.push_str(&format!("{head} {{\n{body}}}\n"));
    s
}
