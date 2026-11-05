//! Helpers the language writers share.

use super::*;

/// Names of the methods `c` gets from its supertypes and interfaces (at any depth).
pub(super) fn inherited(classes: &[Class], c: &Class) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut todo: Vec<String> = c.extends.iter().chain(&c.implements).cloned().collect();
    let mut seen = BTreeSet::new();
    while let Some(name) = todo.pop() {
        if !seen.insert(name.clone()) {
            continue;
        }
        if let Some(sup) = classes.iter().find(|x| x.name == name) {
            out.extend(sup.methods.iter().map(|m| m.name.clone()));
            todo.extend(sup.extends.iter().chain(&sup.implements).cloned());
        }
    }
    out
}

/// Classes that others extend.
pub(super) fn supertypes(classes: &[Class]) -> BTreeSet<String> {
    classes.iter().filter_map(|c| c.extends.clone()).collect()
}

/// A default value from the diagram, made to fit the translated type `t`:
/// `0` for a BigDecimal becomes `new BigDecimal("0")`, `0` for a Double `0.0`.
pub(super) fn default_value(l: CodeLanguage, t: &str, raw: &str) -> String {
    let number = raw.parse::<f64>().is_ok();
    match (l, t) {
        (CodeLanguage::Java, "BigDecimal") if number => format!("new BigDecimal(\"{raw}\")"),
        (CodeLanguage::Kotlin, "BigDecimal") if number => format!("BigDecimal(\"{raw}\")"),
        (CodeLanguage::Python, "Decimal") if number => format!("Decimal(\"{raw}\")"),
        (CodeLanguage::Kotlin, "Double") if number && !raw.contains('.') => format!("{raw}.0"),
        (CodeLanguage::CSharp, "decimal") if number => format!("{raw}m"),
        (CodeLanguage::Python, "bool") if raw == "true" || raw == "false" => format!("{}{}", raw[..1].to_uppercase(), &raw[1..]),
        _ => raw.to_string(),
    }
}

pub(super) fn unreadable(c: &Class, comment: &str, indent: &str) -> String {
    c.unreadable
        .iter()
        .map(|r| format!("{indent}{comment} {r}\n"))
        .collect()
}

pub(super) fn vis_word(v: Vis, default: &'static str) -> &'static str {
    match v {
        Vis::Public => "public",
        Vis::Private => "private",
        Vis::Protected => "protected",
        Vis::Package | Vis::Unset => default,
    }
}

/// Attributes are private and operations public unless the diagram says otherwise.
pub(super) fn field_vis(f: &Field) -> Vis {
    if f.vis == Vis::Unset { Vis::Private } else { f.vis }
}
pub(super) fn method_vis(m: &Method) -> Vis {
    if m.vis == Vis::Unset { Vis::Public } else { m.vis }
}
