use super::*;
use crate::codegen::{generate, read_classes, tests::{members, shop}};
use crate::models::{Camera, FlowDoc};

const ALL: [L; 7] = [L::TypeScript, L::Java, L::CSharp, L::Python, L::Kotlin, L::Rust, L::Go];

/// A type as language `l` writes it, without what only says "may be empty"
/// (`?`, `| null`, `Option<..>`, pointers): languages differ in when they add that.
fn norm(t: &str, l: L) -> String {
    let mut s = crate::codegen::ty_in(t, l);
    for x in [" | null", " | None", "?", "*", "&"] {
        s = s.replace(x, "");
    }
    while let Some(inner) = s.strip_prefix("Option<").or_else(|| s.strip_prefix("Box<")).and_then(|x| x.strip_suffix('>')) {
        s = inner.to_string();
    }
    s
}

fn as_flow(imp: &CodeImport) -> FlowDoc {
    FlowDoc {
        nodes: imp.nodes.clone(),
        edges: imp.edges.clone(),
        camera: Camera::default(),
        ..Default::default()
    }
}

/// The code export of the test diagram, imported again, reads as the same classes.
#[test]
fn round_trip() {
    let want = read_classes(&shop());
    for l in ALL {
        let code: String = generate(&shop(), l, "Shop").iter().map(|f| f.content.clone()).collect::<Vec<_>>().join("\n");
        assert_eq!(detect(&code), l, "detect\n{code}");
        let imp = import(&code, l);
        let got = read_classes(&as_flow(&imp));
        let ctx = |what: &str| format!("{l:?} {what}\n{code}\n{:#?}", imp.nodes.iter().map(|n| &n.text).collect::<Vec<_>>());
        let mut names: Vec<&str> = got.iter().map(|c| c.name.as_str()).collect();
        names.sort();
        assert_eq!(names, ["Customer", "Order", "OrderLine", "Payable", "RushOrder", "Status"], "{}", ctx("classes"));
        for w in &want {
            let g = got.iter().find(|c| c.name == w.name).unwrap();
            let c = |what: &str| ctx(&format!("{}.{what}", w.name));
            assert_eq!(g.kind, w.kind, "{}", c("kind"));
            assert_eq!(g.extends, w.extends, "{}", c("extends"));
            assert_eq!(g.implements, w.implements, "{}", c("implements"));
            let values = |c: &Class| c.values.iter().map(|v| v.to_lowercase()).collect::<Vec<_>>();
            assert_eq!(values(g), values(w), "{}", c("values"));
            assert!(g.unreadable.is_empty(), "{}: {:?}", c("unreadable"), g.unreadable);
            assert_eq!(g.fields.len(), w.fields.len(), "{}", c("fields"));
            for f in &w.fields {
                let h = g.fields.iter().find(|x| x.name == f.name).unwrap_or_else(|| panic!("{}", c(&f.name)));
                assert_eq!(norm(&h.ty, l), norm(&f.ty, l), "{}", c(&f.name));
                if matches!(l, L::Java | L::CSharp | L::TypeScript | L::Kotlin) {
                    assert_eq!(h.vis, f.vis, "{}", c(&format!("{} visibility", f.name)));
                }
                if !matches!(l, L::Rust | L::Go) {
                    assert_eq!(h.default, f.default, "{}", c(&format!("{} default", f.name)));
                }
            }
            assert_eq!(g.methods.len(), w.methods.len(), "{}", c("methods"));
            for m in &w.methods {
                let h = g.methods.iter().find(|x| x.name == m.name).unwrap_or_else(|| panic!("{}", c(&m.name)));
                let params = |m: &Method| m.params.iter().map(|(n, t)| (n.clone(), norm(t, l))).collect::<Vec<_>>();
                assert_eq!(params(h), params(m), "{}", c(&m.name));
                assert_eq!(h.ret.as_deref().map(|t| norm(t, l)), m.ret.as_deref().map(|t| norm(t, l)), "{}", c(&format!("{}()", m.name)));
                assert_eq!(h.body, m.body, "{}", c(&format!("{} body", m.name)));
            }
        }
        if matches!(l, L::Java | L::Kotlin) {
            assert_eq!(imp.package.as_deref(), Some("shop.domain"), "{l:?}");
        }
        assert!(imp.skipped.is_empty(), "{l:?}: {:?}", imp.skipped);
    }
}

#[test]
fn hand_written() {
    let ts = import(
        "export abstract class Shape { protected name = 'shape'; abstract area(): number; static count = 0 }
         export class Circle extends Shape implements Drawable {
           constructor(private r: number) { super() }
           area(): number { return Math.PI * this.r ** 2 }
           get radius(): number { return this.r }
         }
         interface Drawable { draw(ctx?: CanvasRenderingContext2D): void }",
        L::TypeScript,
    );
    let classes = read_classes(&as_flow(&ts));
    let get = |n: &str| classes.iter().find(|c| c.name == n).unwrap();
    assert_eq!(get("Shape").kind, Kind::Abstract);
    assert_eq!(get("Circle").extends.as_deref(), Some("Shape"));
    assert!(get("Circle").methods.iter().any(|m| m.name == "getRadius"));
    assert!(get("Shape").fields.iter().any(|f| f.name == "count" && f.is_static));

    let py = import(
        "from abc import ABC, abstractmethod\n\nclass Animal(ABC):\n    \"\"\"An animal.\"\"\"\n    def __init__(self, name: str, legs: int = 4):\n        self.name = name\n        self._legs = legs\n        self.sound = 'quiet'\n\n    @abstractmethod\n    def speak(self) -> str: ...\n\n    @property\n    def legs(self) -> int:\n        return self._legs\n\nclass Dog(Animal):\n    def speak(self) -> str:\n        return 'woof'  # loud\n",
        L::Python,
    );
    let classes = read_classes(&as_flow(&py));
    let get = |n: &str| classes.iter().find(|c| c.name == n).unwrap();
    let animal = get("Animal");
    assert_eq!(animal.kind, Kind::Abstract);
    assert_eq!(animal.fields.iter().map(|f| (f.name.as_str(), f.ty.as_str())).collect::<Vec<_>>(), [("name", "string"), ("legs", "int"), ("sound", "string")]);
    assert!(animal.methods.iter().any(|m| m.name == "getLegs"));
    assert!(animal.methods.iter().any(|m| m.name == "speak" && m.is_abstract && m.ret.as_deref() == Some("string")));
    assert_eq!(get("Dog").extends.as_deref(), Some("Animal"));

    let go = import(
        "package zoo\n\ntype Speaker interface {\n\tSpeak() string\n}\n\ntype Dog struct {\n\tName string `json:\"name\"`\n\tage, weight int\n}\n\nfunc (d Dog) Speak() string { return \"woof\" }\n",
        L::Go,
    );
    let classes = read_classes(&as_flow(&go));
    let dog = classes.iter().find(|c| c.name == "Dog").unwrap();
    assert_eq!(dog.implements, ["Speaker"]);
    assert_eq!(dog.fields.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["name", "age", "weight"]);
    assert_eq!(dog.fields[0].vis, Vis::Public);

    let java = import(
        "package com.acme;\nimport java.util.*;\n@Entity\npublic class Team<T> extends Base implements Comparable<Team<T>> {\n  @Id private Long id;\n  private final List<Player> players = new ArrayList<>();\n  public static final int MAX = 11;\n  public Team(Long id) { this.id = id; }\n  @Override public int compareTo(Team<T> o) { return 0; }\n  public Optional<Player> captain() { return Optional.empty(); }\n}\nclass Player { String name; }\nabstract class Base { protected abstract void validate(); }",
        L::Java,
    );
    let classes = read_classes(&as_flow(&java));
    let get = |n: &str| classes.iter().find(|c| c.name == n).unwrap();
    let team = get("Team");
    assert_eq!(team.extends.as_deref(), Some("Base"));
    assert!(team.fields.iter().any(|f| f.name == "players" && f.ty == "List<Player>"));
    assert!(team.fields.iter().any(|f| f.name == "MAX" && f.is_static && f.default.as_deref() == Some("11")));
    assert!(team.methods.iter().any(|m| m.name == "captain" && m.ret.as_deref() == Some("Player?")));
    assert_eq!(get("Player").fields[0].vis, Vis::Package);
    assert!(get("Base").methods[0].is_abstract);
    assert_eq!(java.package.as_deref(), Some("com.acme"));

    let cs = import(
        "namespace Zoo {\n  public interface IAnimal { string Name { get; } void Feed(int grams); }\n  [Serializable]\n  public sealed class Cat : Pet, IAnimal {\n    public string Name { get; init; } = \"Tom\";\n    private readonly List<Toy> _toys = new();\n    public Cat(string name) => Name = name;\n    public void Feed(int grams) { }\n  }\n  public class Pet { }\n  public class Toy { }\n}",
        L::CSharp,
    );
    let classes = read_classes(&as_flow(&cs));
    let cat = classes.iter().find(|c| c.name == "Cat").unwrap();
    assert_eq!((cat.extends.as_deref(), cat.implements.as_slice()), (Some("Pet"), ["IAnimal".to_string()].as_slice()));
    assert!(cat.fields.iter().any(|f| f.name == "name" && f.default.as_deref() == Some("\"Tom\"")));
    assert!(cat.fields.iter().any(|f| f.name == "toys" && f.ty == "List<Toy>"));
    assert_eq!(cs.package.as_deref(), Some("Zoo"));

    let kt = import(
        "data class Point(val x: Int, val y: Int = 0)\nsealed class Shape {\n  abstract fun area(): Double\n  companion object { const val UNIT = 1 }\n}\nclass Square(private val side: Double) : Shape() {\n  override fun area(): Double = side * side\n}",
        L::Kotlin,
    );
    let classes = read_classes(&as_flow(&kt));
    let get = |n: &str| classes.iter().find(|c| c.name == n).unwrap();
    assert_eq!(get("Point").fields.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), ["x", "y"]);
    assert_eq!(get("Shape").kind, Kind::Abstract);
    assert!(get("Shape").fields.iter().any(|f| f.name == "UNIT" && f.is_static));
    assert_eq!(get("Square").extends.as_deref(), Some("Shape"));
    assert_eq!(get("Square").fields[0].vis, Vis::Private);

    let rs = import(
        "use std::collections::HashMap;\n#[derive(Debug)]\npub struct Library<'a> {\n    pub name: &'a str,\n    books: Vec<Book>,\n    index: HashMap<String, usize>,\n}\npub struct Book { pub title: String }\npub trait Search { fn find(&self, q: &str) -> Option<&Book>; }\nimpl<'a> Library<'a> {\n    pub fn new(name: &'a str) -> Self { todo!() }\n    pub fn add(&mut self, b: Book) { }\n}\nimpl Search for Library<'_> { fn find(&self, q: &str) -> Option<&Book> { None } }",
        L::Rust,
    );
    let classes = read_classes(&as_flow(&rs));
    let lib = classes.iter().find(|c| c.name == "Library").unwrap();
    assert_eq!(lib.implements, ["Search"]);
    assert!(lib.methods.iter().any(|m| m.name == "new" && m.is_static));
    assert!(lib.methods.iter().any(|m| m.name == "add" && !m.is_static && m.params == [("b".to_string(), "Book".to_string())]));
    assert!(lib.fields.iter().any(|f| f.name == "name" && f.ty == "string" && f.vis == Vis::Public));
    assert!(lib.methods.iter().any(|m| m.name == "find" && m.ret.as_deref() == Some("Book?")));
}

/// Writes what the command returns for a file (language guessed) to `OUT`:
/// `CODE_FILE=shop.py OUT=import.json cargo test code_import::tests::from_file -- --ignored`
#[test]
#[ignore]
fn from_file() {
    let code = std::fs::read_to_string(std::env::var("CODE_FILE").unwrap()).unwrap();
    let imp = import(&code, detect(&code));
    std::fs::write(std::env::var("OUT").unwrap(), serde_json::to_string(&imp).unwrap()).unwrap();
}

/// Generics, enum values, records and read-only attributes survive the code export
/// and the import, in each language that can write them.
#[test]
fn round_trip_new_notation() {
    for l in ALL {
        let code: String = generate(&members(), l, "Members").iter().map(|f| f.content.clone()).collect::<Vec<_>>().join("\n");
        let got = read_classes(&as_flow(&import(&code, l)));
        let get = |n: &str| got.iter().find(|c| c.name == n).unwrap_or_else(|| panic!("{l:?}: no {n}\n{code}"));
        // Generic: every language
        assert_eq!(get("Repository").type_params, ["T"], "{l:?} generics\n{code}");
        assert!(get("Repository").unreadable.is_empty(), "{l:?}: {:?}", get("Repository").unreadable);
        // Enum values that stand for numbers (Go writes them, but reads only the names)
        if l != L::Go {
            let status = get("Status");
            assert_eq!((status.values.len(), status.enum_value(1)), (3, Some("2")), "{l:?} enum values\n{code}");
            assert!(status.fields.is_empty() && status.methods.is_empty(), "{l:?}: {:?} {:?}", status.fields, status.methods);
        }
        // Records, where the language has them
        if matches!(l, L::Java | L::CSharp | L::Kotlin | L::Python) {
            assert_eq!(get("OrderLine").kind, Kind::Record, "{l:?} record\n{code}");
            assert_eq!(get("OrderLine").fields.len(), 2, "{l:?} record fields");
        }
        // Read-only, where the code says so
        if matches!(l, L::TypeScript | L::CSharp) {
            assert!(get("Order").fields.iter().find(|f| f.name == "id").unwrap().read_only, "{l:?} read-only\n{code}");
        }
        // Kotlin: a subclass with its own constructor still extends
        if l == L::Kotlin {
            assert_eq!(get("SpecialOrder").extends.as_deref(), Some("Order"), "{code}");
        }
    }
}
