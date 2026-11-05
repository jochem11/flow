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
    Set(Box<Ty>),
    Map(Box<Ty>, Box<Ty>),
    Optional(Box<Ty>),
    Generic(String, Vec<Ty>),
}

/// Generic types read as a list, a set or a map of their arguments
pub(crate) const LIST_TYPES: [&str; 5] = ["list", "collection", "array", "vec", "sequence"];
pub(crate) const SET_TYPES: [&str; 2] = ["set", "hashset"];
pub(crate) const MAP_TYPES: [&str; 4] = ["map", "dict", "dictionary", "hashmap"];

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
        let lower = base.to_lowercase();
        if LIST_TYPES.contains(&lower.as_str()) && args.len() == 1 {
            return Ty::List(Box::new(parse_ty(&args[0])));
        }
        if SET_TYPES.contains(&lower.as_str()) && args.len() == 1 {
            return Ty::Set(Box::new(parse_ty(&args[0])));
        }
        if MAP_TYPES.contains(&lower.as_str()) && args.len() == 2 {
            return Ty::Map(Box::new(parse_ty(&args[0])), Box::new(parse_ty(&args[1])));
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

/// One built-in type from fixtures/types.json: its names and how each language writes it.
#[derive(serde::Deserialize)]
struct Builtin {
    name: String,
    aliases: Vec<String>,
    #[serde(rename = "in")]
    langs: [String; 7],
}

#[derive(serde::Deserialize)]
struct TypeList {
    types: Vec<Builtin>,
}

/// The built-in types (fixtures/types.json, shared with src/lib/classTypes.ts), by
/// every name they go by, lowercase.
fn builtins() -> &'static HashMap<String, [String; 7]> {
    static TYPES: std::sync::OnceLock<HashMap<String, [String; 7]>> = std::sync::OnceLock::new();
    TYPES.get_or_init(|| {
        let list: TypeList = serde_json::from_str(include_str!("../../../../fixtures/types.json")).expect("fixtures/types.json");
        list.types
            .into_iter()
            .flat_map(|t| {
                let names: Vec<String> = std::iter::once(t.name).chain(t.aliases).map(|n| n.to_lowercase()).collect();
                names.into_iter().map(move |n| (n, t.langs.clone()))
            })
            .collect()
    })
}

/// A built-in type, per language: [TypeScript, Java, C#, Python, Kotlin, Rust, Go].
pub(super) fn builtin(name: &str) -> Option<&'static [String; 7]> {
    builtins().get(&name.to_lowercase())
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
                let s = names[slot(l)].as_str();
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
        Ty::Set(inner) => {
            let i = ty(inner, l, true);
            match l {
                L::CSharp => format!("HashSet<{i}>"),
                L::Python => format!("set[{i}]"),
                L::Rust => format!("HashSet<{i}>"),
                L::Go => format!("map[{i}]bool"),
                _ => format!("Set<{i}>"),
            }
        }
        Ty::Map(k, v) => {
            let (k, v) = (ty(k, l, true), ty(v, l, true));
            match l {
                L::CSharp => format!("Dictionary<{k}, {v}>"),
                L::Python => format!("dict[{k}, {v}]"),
                L::Rust => format!("HashMap<{k}, {v}>"),
                L::Go => format!("map[{k}]{v}"),
                _ => format!("Map<{k}, {v}>"),
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

#[cfg(test)]
mod fixture_tests {
    use super::*;

    /// The same cases as src/lib/classTypes.test.ts.
    #[test]
    fn types_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../fixtures/types.json")).unwrap();
        let langs = [L::TypeScript, L::Java, L::CSharp, L::Python, L::Kotlin, L::Rust, L::Go];
        use CodeLanguage as L;
        for case in fixture["cases"].as_array().unwrap() {
            let uml = case["uml"].as_str().unwrap();
            for (i, l) in langs.iter().enumerate() {
                assert_eq!(ty(&parse_ty(uml), *l, false), case["in"][i].as_str().unwrap(), "{uml} in {l:?}");
            }
        }
    }
}
