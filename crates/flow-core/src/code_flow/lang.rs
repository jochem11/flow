//! The languages a codebase is read in, by file extension, with their parsers.

use tree_sitter::{Language, Parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Lang {
    Java,
    Kotlin,
    CSharp,
    Go,
    Python,
    TypeScript,
    Tsx,
    JavaScript,
}

impl Lang {
    /// The language of a file, by its name (`.d.ts` files have no code)
    pub fn of(path: &str) -> Option<Lang> {
        let p = path.to_lowercase();
        if p.ends_with(".d.ts") || p.ends_with(".min.js") {
            return None;
        }
        let ext = p.rsplit('.').next()?;
        Some(match ext {
            "java" => Lang::Java,
            "kt" | "kts" => Lang::Kotlin,
            "cs" => Lang::CSharp,
            "go" => Lang::Go,
            "py" => Lang::Python,
            "ts" | "mts" | "cts" => Lang::TypeScript,
            "tsx" => Lang::Tsx,
            "js" | "jsx" | "mjs" | "cjs" => Lang::JavaScript,
            _ => return None,
        })
    }

    pub fn grammar(self) -> Language {
        match self {
            Lang::Java => tree_sitter_java::LANGUAGE.into(),
            Lang::Kotlin => tree_sitter_kotlin_ng::LANGUAGE.into(),
            Lang::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            Lang::Go => tree_sitter_go::LANGUAGE.into(),
            Lang::Python => tree_sitter_python::LANGUAGE.into(),
            Lang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
        }
    }

    pub fn parser(self) -> Parser {
        let mut p = Parser::new();
        p.set_language(&self.grammar()).expect("a grammar this tree-sitter can load");
        p
    }
}

#[cfg(test)]
mod dump {
    use super::*;

    fn sexp(lang: Lang, code: &str) -> String {
        let tree = lang.parser().parse(code, None).unwrap();
        tree.root_node().to_sexp()
    }

    #[test]
    #[ignore]
    fn print_trees() {
        let samples = [
            (Lang::Java, "class A { private final B b; void f(int x) { if (x > 1) { b.g(x); } else if (x < 0) return; else { throw new E(\"no\"); } for (int i = 0; i < 3; i++) { h(); } for (var y : ys) continue; while (ok) { break; } switch (x) { case 1: a(); break; default: b(); } try { t(); } catch (E e) { c(); } finally { d(); } var z = repo.find(1).orElseThrow(() -> new E()); do { k(); } while (z); } A(B b) { this.b = b; } }"),
            (Lang::Kotlin, "class A(private val b: B) {\n    fun f(x: Int): Int {\n        if (x > 1) {\n            b.g(x)\n        } else {\n            return 2\n        }\n        for (y in ys) {\n            h(y)\n        }\n        while (ok) {\n            break\n        }\n        when (x) {\n            1 -> a()\n            else -> b()\n        }\n        try {\n            t()\n        } catch (e: E) {\n            c()\n        }\n        val z = repo.find(1) ?: throw E()\n        return 1\n    }\n}\nfun top() {\n    A(B()).f(1)\n}\n"),
            (Lang::Kotlin, "class X(private val b: B) { fun f(x: Int): Int { if (x > 1) { b.g(x) } else { return 2 } for (y in ys) { h(y) } while (ok) { break } when (x) { 1 -> a() else -> b() } try { t() } catch (e: E) { c() } val z = repo.find(1) ?: throw E() ; return 1 } }\nfun top() { A(B()).f(1) }"),
            (Lang::CSharp, "class A { private readonly B _b; public A(B b) { _b = b; } public int F(int x) { if (x > 1) { _b.G(x); } else { return 2; } foreach (var y in ys) { H(y); } while (ok) { break; } switch (x) { case 1: A(); break; default: B(); break; } try { T(); } catch (E e) { C(); } throw new E(); } }"),
            (Lang::Go, "package p\ntype S struct { b *B }\nfunc (s *S) F(x int) int { if x > 1 { s.b.G(x) } else if x < 0 { return 1 } else { panic(\"no\") }\n for i := 0; i < 3; i++ { h() }\n for _, y := range ys { continue }\n switch x { case 1: a()\n default: b() }\n return 2 }\nfunc Top() { New().F(1) }"),
            (Lang::Python, "class A:\n    def __init__(self, b: B):\n        self.b = b\n    def f(self, x):\n        if x > 1:\n            self.b.g(x)\n        elif x < 0:\n            return 1\n        else:\n            raise E('no')\n        for y in ys:\n            h(y)\n        while ok:\n            break\n        try:\n            t()\n        except E as e:\n            c()\n        match x:\n            case 1:\n                a()\n        return 2\ndef top():\n    A(B()).f(1)\n"),
            (Lang::TypeScript, "class A { constructor(private b: B) {} async f(x: number): Promise<number> { if (x > 1) { await this.b.g(x); } else { return 2; } for (const y of ys) { h(y); } for (let i = 0; i < 3; i++) {} while (ok) { break; } switch (x) { case 1: a(); break; default: b(); } try { t(); } catch (e) { c(); } throw new Error('no'); } }\nexport function top() { new A(new B()).f(1); }\nexport const arrow = async (id: string) => { const r = await api.get(id); return r; };"),
            (Lang::JavaScript, "function top(x) { if (x) { a(); } return b(x); }\nconst f = (y) => y + 1;"),
        ];
        for (l, c) in samples {
            println!("==== {l:?}\n{}\n", sexp(l, c));
        }
    }
}
