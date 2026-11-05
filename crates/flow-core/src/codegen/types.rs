//! Names (camelCase, snake_case, ...) and types, translated per language.

use super::*;

pub(super) fn words(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let chars: Vec<char> = s.chars().collect();
    for (i, &c) in chars.iter().enumerate() {
        if !c.is_alphanumeric() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            continue;
        }
        let boundary = c.is_uppercase()
            && !cur.is_empty()
            && (chars[i - 1].is_lowercase() || chars.get(i + 1).is_some_and(|n| n.is_lowercase()));
        if boundary {
            out.push(std::mem::take(&mut cur));
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

pub(super) fn cap(w: &str) -> String {
    let mut c = w.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + &c.as_str().to_lowercase()).unwrap_or_default()
}

pub fn pascal(s: &str) -> String {
    words(s).iter().map(|w| cap(w)).collect()
}

pub fn camel(s: &str) -> String {
    let p = pascal(s);
    let mut c = p.chars();
    c.next().map(|f| f.to_lowercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

pub fn snake(s: &str) -> String {
    words(s).iter().map(|w| w.to_lowercase()).collect::<Vec<_>>().join("_")
}

pub fn plural(s: &str) -> String {
    if s.ends_with('s') { format!("{s}es") } else if s.ends_with('y') { format!("{}ies", &s[..s.len() - 1]) } else { format!("{s}s") }
}

/// A UML type, split into what matters for translating it.
pub(super) enum Ty {
    Named(String),
    List(Box<Ty>),
    Optional(Box<Ty>),
    Generic(String, Vec<Ty>),
}

pub(super) fn parse_ty(s: &str) -> Ty {
    let s = s.trim();
    if let Some(inner) = s.strip_suffix('?') {
        return Ty::Optional(Box::new(parse_ty(inner)));
    }
    if let Some(inner) = s.strip_suffix("[]") {
        return Ty::List(Box::new(parse_ty(inner)));
    }
    if let Some(i) = s.find('<') {
        let base = &s[..i];
        let args = split_args(&s[i + 1..s.len() - 1]);
        if matches!(base.to_lowercase().as_str(), "list" | "set" | "collection" | "array" | "vec" | "sequence") && args.len() == 1 {
            return Ty::List(Box::new(parse_ty(&args[0])));
        }
        return Ty::Generic(base.to_string(), args.iter().map(|a| parse_ty(a)).collect());
    }
    Ty::Named(s.to_string())
}

/// Splits `A, Map<B, C>` on the top-level commas.
pub(super) fn split_args(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut depth) = (vec![], String::new(), 0);
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth -= 1,
            ',' if depth == 0 => {
                out.push(std::mem::take(&mut cur).trim().to_string());
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// Built-in types, per language: [TypeScript, Java, C#, Python, Kotlin, Rust, Go].
pub(super) fn builtin(name: &str) -> Option<[&'static str; 7]> {
    Some(match name.to_lowercase().as_str() {
        "int" | "integer" | "short" | "byte" => ["number", "int", "int", "int", "Int", "i32", "int"],
        "long" | "bigint" => ["number", "long", "long", "int", "Long", "i64", "int64"],
        "float" | "double" | "real" | "number" => ["number", "double", "double", "float", "Double", "f64", "float64"],
        "decimal" | "money" | "bigdecimal" => ["number", "BigDecimal", "decimal", "Decimal", "BigDecimal", "f64", "float64"],
        "bool" | "boolean" => ["boolean", "boolean", "bool", "bool", "Boolean", "bool", "bool"],
        "string" | "str" | "text" | "char" => ["string", "String", "string", "str", "String", "String", "string"],
        "date" => ["Date", "LocalDate", "DateOnly", "date", "LocalDate", "String", "time.Time"],
        "datetime" | "timestamp" | "instant" => ["Date", "LocalDateTime", "DateTime", "datetime", "LocalDateTime", "String", "time.Time"],
        "uuid" | "guid" => ["string", "UUID", "Guid", "UUID", "UUID", "String", "string"],
        "void" => ["void", "void", "void", "None", "Unit", "()", ""],
        "any" | "object" => ["unknown", "Object", "object", "Any", "Any", "String", "any"],
        _ => return None,
    })
}

pub(super) const fn slot(l: CodeLanguage) -> usize {
    match l {
        CodeLanguage::TypeScript => 0,
        CodeLanguage::Java => 1,
        CodeLanguage::CSharp => 2,
        CodeLanguage::Python => 3,
        CodeLanguage::Kotlin => 4,
        CodeLanguage::Rust => 5,
        CodeLanguage::Go => 6,
    }
}

/// A type in language `l`. Java needs boxed types inside generics (`List<Integer>`).
pub(super) fn ty(t: &Ty, l: CodeLanguage, boxed: bool) -> String {
    use CodeLanguage as L;
    match t {
        Ty::Named(n) => match builtin(n) {
            Some(names) => {
                let s = names[slot(l)];
                if l == L::Java && boxed {
                    match s {
                        "int" => "Integer".into(),
                        "long" => "Long".into(),
                        "double" => "Double".into(),
                        "boolean" => "Boolean".into(),
                        other => other.into(),
                    }
                } else {
                    s.into()
                }
            }
            None => pascal(n),
        },
        Ty::List(inner) => {
            let i = ty(inner, l, true);
            match l {
                L::TypeScript => format!("{i}[]"),
                L::Python => format!("list[{i}]"),
                L::Rust => format!("Vec<{i}>"),
                L::Go => format!("[]{i}"),
                _ => format!("List<{i}>"),
            }
        }
        Ty::Optional(inner) => {
            let i = ty(inner, l, true);
            match l {
                L::TypeScript => format!("{i} | null"),
                L::Python => format!("{i} | None"),
                L::Rust => format!("Option<{i}>"),
                L::Go => format!("*{i}"),
                L::Java => i,
                _ => format!("{i}?"),
            }
        }
        Ty::Generic(base, args) => {
            let a: Vec<String> = args.iter().map(|a| ty(a, l, true)).collect();
            match l {
                L::Python => format!("{}[{}]", base, a.join(", ")),
                L::Go => format!("{}[{}]", pascal(base), a.join(", ")),
                _ => format!("{}<{}>", pascal(base), a.join(", ")),
            }
        }
    }
}
