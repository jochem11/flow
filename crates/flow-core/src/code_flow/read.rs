//! Reading a codebase: every file parsed (tree-sitter), into one model for all
//! languages: the classes with the types of their fields, and the functions with
//! their bodies as steps, decisions, loops, choices and tries, and the calls each
//! step makes (to follow them, see activity.rs).

use std::collections::HashMap;

use tree_sitter::Node as TsNode;

use super::lang::Lang;

/// A call in a step: `receiver.name(...)`.
#[derive(Debug, Clone)]
pub struct Call {
    /// What it is called on, as written (`editLendService`, `this.repo`, `self.b`), if anything
    pub receiver: Option<String>,
    pub name: String,
    /// The call as written (shortened)
    pub text: String,
}

/// One step of a function body.
#[derive(Debug, Clone)]
pub enum Stmt {
    /// A statement that is not control flow; `declares`: a local with its type
    Simple { text: String, calls: Vec<Call>, declares: Option<(String, String)> },
    If { cond: String, calls: Vec<Call>, then: Vec<Stmt>, els: Option<Vec<Stmt>> },
    /// `head`: as written (`for (Item i : items)`, `while ok`); `test_after`: do-while
    Loop { head: String, calls: Vec<Call>, body: Vec<Stmt>, test_after: bool },
    /// A switch / when / match: the cases with their labels (`else` for the default)
    Switch { subject: String, calls: Vec<Call>, cases: Vec<(String, Vec<Stmt>)>, has_default: bool },
    Try { body: Vec<Stmt>, catches: Vec<(String, Vec<Stmt>)>, finally: Option<Vec<Stmt>> },
    Return { text: Option<String>, calls: Vec<Call> },
    Throw { text: String, calls: Vec<Call> },
    Break,
    Continue,
    /// Steps in a block of their own (`synchronized`, `using`, `with`, `{ … }`)
    Block(Vec<Stmt>),
}

#[derive(Debug, Clone)]
pub struct Function {
    pub id: String,
    pub file: String,
    pub line: u32,
    pub lang: Lang,
    /// The class (or struct, object) it is in
    pub class: Option<String>,
    pub name: String,
    /// Parameters with their types, when written
    pub params: Vec<(String, Option<String>)>,
    /// A web route it answers (`PUT /api/lends/{id}`), from its annotations
    pub route: Option<String>,
    /// Go: the receiver's name (`s` in `func (s *S) F()`)
    pub receiver: Option<String>,
    pub constructor: bool,
    pub body: Vec<Stmt>,
}

#[derive(Debug, Clone, Default)]
pub struct ClassInfo {
    pub name: String,
    /// Field name → its type name (generics and nullability off)
    pub fields: HashMap<String, String>,
    /// What it extends or implements
    pub supers: Vec<String>,
}

#[derive(Debug, Default)]
pub struct Codebase {
    pub functions: Vec<Function>,
    pub classes: HashMap<String, ClassInfo>,
    pub files: usize,
    /// Files that could not be read, and why
    pub skipped: Vec<String>,
}

/// Files bigger than this are not read (generated or bundled code)
pub const MAX_FILE: usize = 400_000;

/// Reads source files (path, text); files in other languages are left out.
pub fn read(files: &[(String, String)]) -> Codebase {
    let mut out = Codebase::default();
    for (path, text) in files {
        let Some(lang) = Lang::of(path) else { continue };
        if text.len() > MAX_FILE {
            out.skipped.push(format!("{path}: too big to read"));
            continue;
        }
        let Some(tree) = lang.parser().parse(text, None) else {
            out.skipped.push(format!("{path}: could not be parsed"));
            continue;
        };
        out.files += 1;
        let mut r = Reader { lang, src: text.as_bytes(), path, functions: vec![], classes: vec![] };
        r.visit(tree.root_node(), None, None);
        out.functions.extend(r.functions);
        for c in r.classes {
            // A class split over files (partial, extensions, Go methods): one
            let into = out.classes.entry(c.name.clone()).or_insert_with(|| ClassInfo { name: c.name.clone(), ..Default::default() });
            into.fields.extend(c.fields);
            for s in c.supers {
                if !into.supers.contains(&s) {
                    into.supers.push(s);
                }
            }
        }
    }
    out
}

// ---------- kinds of syntax, per language (the grammars name things differently) ----------

const CLASSES: &[&str] = &[
    "class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "object_declaration",
    "struct_declaration", "class_definition", "abstract_class_declaration", "class",
];
const FUNCTIONS: &[&str] = &[
    "method_declaration", "constructor_declaration", "function_declaration", "secondary_constructor",
    "local_function_statement", "function_definition", "method_definition", "generator_function_declaration",
];
/// Functions written as values: not entered when reading a step (their body is not a step)
const LAMBDAS: &[&str] = &[
    "lambda_expression", "arrow_function", "function_expression", "function", "lambda_literal", "annotated_lambda",
    "anonymous_function", "func_literal", "lambda", "anonymous_method_expression", "class_body", "object_literal_expression",
];
const BLOCKS: &[&str] = &["block", "constructor_body", "statement_block", "statement_list", "function_body", "control_structure_body"];
const COMMENTS: &[&str] = &["comment", "line_comment", "block_comment", "multiline_comment", "pass_statement", "empty_statement", ";"];

struct Reader<'a> {
    lang: Lang,
    src: &'a [u8],
    path: &'a str,
    functions: Vec<Function>,
    classes: Vec<ClassInfo>,
}

fn named_children<'t>(n: TsNode<'t>) -> Vec<TsNode<'t>> {
    let mut c = n.walk();
    n.named_children(&mut c).collect()
}

fn children<'t>(n: TsNode<'t>) -> Vec<TsNode<'t>> {
    let mut c = n.walk();
    n.children(&mut c).collect()
}

/// The children of a node under a field name (Python's `alternative` comes more than once)
fn field_children<'t>(n: TsNode<'t>, name: &str) -> Vec<TsNode<'t>> {
    let mut c = n.walk();
    n.children_by_field_name(name, &mut c).collect()
}

/// A type as a class name: `List<Item>` → `List`, `*pkg.Store` → `Store`, `B?` → `B`
pub fn type_name(t: &str) -> String {
    let t = t.trim().trim_start_matches(['*', '&', ':']).trim();
    let t = t.trim_start_matches("readonly ").trim_start_matches("final ").trim();
    let base = t.split(['<', '[', '?', '(', ' ', '|']).next().unwrap_or("");
    base.rsplit('.').next().unwrap_or("").to_string()
}

impl<'a> Reader<'a> {
    fn text(&self, n: TsNode) -> String {
        n.utf8_text(self.src).unwrap_or("").to_string()
    }

    fn field_text(&self, n: TsNode, field: &str) -> Option<String> {
        n.child_by_field_name(field).map(|c| self.text(c))
    }

    /// A node as one short line: functions written in it as `…`, spaces collapsed
    fn short(&self, n: TsNode) -> String {
        let mut cut: Vec<(usize, usize)> = vec![];
        fn find(n: TsNode, cut: &mut Vec<(usize, usize)>, top: bool) {
            if !top && LAMBDAS.contains(&n.kind()) {
                cut.push((n.start_byte(), n.end_byte()));
                return;
            }
            let mut c = n.walk();
            for ch in n.named_children(&mut c) {
                find(ch, cut, false);
            }
        }
        find(n, &mut cut, true);
        let (start, end) = (n.start_byte(), n.end_byte());
        let mut s = String::new();
        let mut at = start;
        for (a, b) in cut {
            s.push_str(&String::from_utf8_lossy(&self.src[at..a]));
            s.push('…');
            at = b;
        }
        s.push_str(&String::from_utf8_lossy(&self.src[at..end]));
        shorten(&one_line(&s))
    }

    /// The text of a node up to where its body starts (a loop's or a switch's head)
    fn head(&self, n: TsNode, body: Option<TsNode>) -> String {
        let end = body.map(|b| b.start_byte()).unwrap_or(n.end_byte());
        let s = String::from_utf8_lossy(&self.src[n.start_byte()..end]).to_string();
        one_line(s.trim_end_matches(['{', ':', ' ', '\n']))
    }

    // ---------- declarations ----------

    fn visit(&mut self, n: TsNode, class: Option<&str>, prefix: Option<&str>) {
        let kind = n.kind();
        if CLASSES.contains(&kind) {
            let name = self.field_text(n, "name").or_else(|| named_children(n).into_iter().find(|c| c.kind() == "identifier" || c.kind() == "type_identifier").map(|c| self.text(c)));
            if let Some(name) = name {
                let info = self.class_info(n, &name);
                self.classes.push(info);
                let route = self.route_prefix(n);
                for c in named_children(n) {
                    self.visit(c, Some(&name), route.as_deref().or(prefix));
                }
                return;
            }
        }
        // Go: `type S struct { … }`
        if kind == "type_spec" {
            if let (Some(name), Some(t)) = (self.field_text(n, "name"), n.child_by_field_name("type")) {
                if t.kind() == "struct_type" || t.kind() == "interface_type" {
                    let mut info = ClassInfo { name: name.clone(), ..Default::default() };
                    self.go_fields(t, &mut info);
                    self.classes.push(info);
                }
            }
            return;
        }
        if FUNCTIONS.contains(&kind) {
            self.function(n, class, prefix);
            // Functions in functions (local functions, nested defs) are found too
            if let Some(body) = n.child_by_field_name("body") {
                self.nested(body, class, prefix);
            }
            return;
        }
        // `const f = (…) => {…}` / `f = function () {…}` / class fields holding arrows
        if matches!(kind, "variable_declarator" | "public_field_definition" | "field_definition") {
            let value = n.child_by_field_name("value");
            if let (Some(name), Some(v)) = (n.child_by_field_name("name").or_else(|| n.child_by_field_name("property")), value) {
                if matches!(v.kind(), "arrow_function" | "function_expression" | "function") {
                    self.function_from(v, &self.text(name), class, prefix, Some(n));
                    return;
                }
            }
        }
        // Python: decorators belong to the definition
        if kind == "decorated_definition" {
            if let Some(def) = n.child_by_field_name("definition") {
                self.visit(def, class, prefix);
            }
            return;
        }
        for c in named_children(n) {
            self.visit(c, class, prefix);
        }
    }

    /// Functions declared inside a body (not the lambdas)
    fn nested(&mut self, n: TsNode, class: Option<&str>, prefix: Option<&str>) {
        for c in named_children(n) {
            if FUNCTIONS.contains(&c.kind()) || CLASSES.contains(&c.kind()) {
                self.visit(c, class, prefix);
            } else if !LAMBDAS.contains(&c.kind()) {
                self.nested(c, class, prefix);
            }
        }
    }

    fn function(&mut self, n: TsNode, class: Option<&str>, prefix: Option<&str>) {
        let Some(name) = self.field_text(n, "name").or_else(|| {
            // Kotlin: `secondary_constructor` has none; C# constructors have one
            (n.kind() == "secondary_constructor").then(|| "constructor".to_string())
        }) else {
            return;
        };
        self.function_from(n, &name, class, prefix, None);
    }

    fn function_from(&mut self, n: TsNode, name: &str, class: Option<&str>, prefix: Option<&str>, holder: Option<TsNode>) {
        let mut class = class.map(String::from);
        let mut receiver = None;
        // Go methods: the class is the receiver's type
        if n.kind() == "method_declaration" && self.lang == Lang::Go {
            if let Some(r) = n.child_by_field_name("receiver").and_then(|r| named_children(r).into_iter().next()) {
                class = r.child_by_field_name("type").map(|t| type_name(&self.text(t)));
                receiver = r.child_by_field_name("name").map(|x| self.text(x));
            }
        }
        let constructor = matches!(n.kind(), "constructor_declaration" | "secondary_constructor")
            || name == "constructor"
            || name == "__init__"
            || class.as_deref() == Some(name) && self.lang != Lang::Go;
        let params = self.params(n);
        let body = match n.child_by_field_name("body") {
            Some(b) if BLOCKS.contains(&b.kind()) || b.kind() == "function_body" => self.stmts(b),
            // An expression body: `=> x`, `= x`
            Some(b) => vec![self.returning(Some(b))],
            None => match named_children(n).into_iter().find(|c| c.kind() == "function_body" || c.kind() == "block") {
                Some(b) => self.stmts(b),
                // No body: abstract, an interface's, a declaration only
                None => return,
            },
        };
        let route = self.route(holder.unwrap_or(n), prefix);
        let line = n.start_position().row as u32 + 1;
        self.functions.push(Function {
            id: format!("{}:{}:{}", self.path, line, name),
            file: self.path.to_string(),
            line,
            lang: self.lang,
            class,
            name: name.to_string(),
            params,
            route,
            receiver,
            constructor,
            body,
        });
    }

    fn params(&self, n: TsNode) -> Vec<(String, Option<String>)> {
        let list = n
            .child_by_field_name("parameters")
            .or_else(|| named_children(n).into_iter().find(|c| matches!(c.kind(), "function_value_parameters" | "parameter_list" | "formal_parameters" | "parameters")));
        let Some(list) = list else { return vec![] };
        let mut out = vec![];
        for p in named_children(list) {
            let name = p
                .child_by_field_name("name")
                .or_else(|| p.child_by_field_name("pattern"))
                .or_else(|| named_children(p).into_iter().find(|c| c.kind() == "identifier" || c.kind() == "simple_identifier"));
            let ty = p
                .child_by_field_name("type")
                .or_else(|| named_children(p).into_iter().find(|c| c.kind() == "user_type" || c.kind() == "type"))
                .map(|t| type_name(&self.text(t)));
            let name = match (name, p.kind()) {
                (Some(x), _) => self.text(x),
                (None, "identifier") => self.text(p),
                _ => continue,
            };
            out.push((name, ty));
        }
        out
    }

    fn class_info(&self, n: TsNode, name: &str) -> ClassInfo {
        let mut info = ClassInfo { name: name.to_string(), ..Default::default() };
        // What it extends or implements
        for c in children(n) {
            if matches!(
                c.kind(),
                "superclass" | "super_interfaces" | "extends_interfaces" | "delegation_specifiers" | "base_list" | "class_heritage" | "argument_list" | "delegation_specifier"
            ) {
                let mut names = vec![];
                collect_types(c, self.src, &mut names);
                info.supers.extend(names);
            }
        }
        // Kotlin and TypeScript: fields made in the constructor's parameters
        for c in named_children(n) {
            if c.kind() == "primary_constructor" {
                for p in descendants(c, "class_parameter") {
                    let id = named_children(p).into_iter().find(|x| x.kind() == "identifier").map(|x| self.text(x));
                    let ty = named_children(p).into_iter().find(|x| x.kind() == "user_type" || x.kind() == "nullable_type").map(|x| type_name(&self.text(x)));
                    if let (Some(id), Some(ty)) = (id, ty) {
                        info.fields.insert(id, ty);
                    }
                }
            }
        }
        let body = n.child_by_field_name("body").or_else(|| named_children(n).into_iter().find(|c| c.kind().ends_with("body") || c.kind() == "declaration_list" || c.kind() == "block"));
        let Some(body) = body else { return info };
        for m in named_children(body) {
            match m.kind() {
                // Java, C#
                "field_declaration" => {
                    let decl = descendants(m, "variable_declaration").into_iter().next();
                    let ty = decl.and_then(|d| d.child_by_field_name("type")).or_else(|| m.child_by_field_name("type")).map(|t| type_name(&self.text(t)));
                    for d in descendants(m, "variable_declarator") {
                        if let (Some(name), Some(ty)) = (d.child_by_field_name("name").or_else(|| named_children(d).into_iter().next()), &ty) {
                            info.fields.insert(self.text(name), ty.clone());
                        }
                    }
                }
                // C#
                "property_declaration" if self.lang == Lang::CSharp => {
                    if let (Some(n), Some(t)) = (m.child_by_field_name("name"), m.child_by_field_name("type")) {
                        info.fields.insert(self.text(n), type_name(&self.text(t)));
                    }
                }
                // Kotlin
                "property_declaration" => {
                    if let Some(v) = named_children(m).into_iter().find(|c| c.kind() == "variable_declaration") {
                        let id = named_children(v).into_iter().find(|x| x.kind() == "identifier").map(|x| self.text(x));
                        let ty = named_children(v).into_iter().find(|x| x.kind() == "user_type" || x.kind() == "nullable_type").map(|x| type_name(&self.text(x)));
                        if let (Some(id), Some(ty)) = (id, ty) {
                            info.fields.insert(id, ty);
                        }
                    }
                }
                // TypeScript
                "public_field_definition" | "field_definition" => {
                    if let (Some(n), Some(t)) = (m.child_by_field_name("name"), m.child_by_field_name("type")) {
                        info.fields.insert(self.text(n), type_name(&self.text(t)));
                    }
                }
                "method_definition" if self.field_text(m, "name").as_deref() == Some("constructor") => {
                    // `constructor(private repo: Repo)`
                    if let Some(ps) = m.child_by_field_name("parameters") {
                        for p in named_children(ps) {
                            let has_mod = named_children(p).iter().any(|c| c.kind() == "accessibility_modifier" || c.kind() == "override_modifier")
                                || self.text(p).starts_with("readonly");
                            if let (true, Some(n), Some(t)) = (has_mod, p.child_by_field_name("pattern"), p.child_by_field_name("type")) {
                                info.fields.insert(self.text(n), type_name(&self.text(t)));
                            }
                        }
                    }
                }
                // Python: `self.x = x` in __init__, with the parameter's type
                "function_definition" if self.field_text(m, "name").as_deref() == Some("__init__") => {
                    let types: HashMap<String, String> = self.params(m).into_iter().filter_map(|(n, t)| t.map(|t| (n, t))).collect();
                    for a in descendants(m, "assignment") {
                        let (Some(l), Some(r)) = (a.child_by_field_name("left"), a.child_by_field_name("right")) else { continue };
                        let lt = self.text(l);
                        if let Some(field) = lt.strip_prefix("self.") {
                            let ty = a.child_by_field_name("type").map(|t| type_name(&self.text(t))).or_else(|| types.get(&self.text(r)).cloned()).or_else(|| {
                                // `self.repo = Repo()`
                                (r.kind() == "call").then(|| r.child_by_field_name("function").map(|f| type_name(&self.text(f)))).flatten()
                            });
                            if let Some(ty) = ty {
                                info.fields.insert(field.to_string(), ty);
                            }
                        }
                    }
                }
                // Python class attributes with a type: `repo: Repo`
                "expression_statement" if self.lang == Lang::Python => {
                    if let Some(a) = named_children(m).into_iter().find(|c| c.kind() == "assignment") {
                        if let (Some(l), Some(t)) = (a.child_by_field_name("left"), a.child_by_field_name("type")) {
                            info.fields.insert(self.text(l), type_name(&self.text(t)));
                        }
                    }
                }
                _ => {}
            }
        }
        info
    }

    fn go_fields(&self, t: TsNode, info: &mut ClassInfo) {
        for f in descendants(t, "field_declaration") {
            let ty = f.child_by_field_name("type").map(|x| type_name(&self.text(x)));
            let names = field_children(f, "name");
            match (names.is_empty(), ty) {
                // Embedded: `*Base`
                (true, Some(ty)) => info.supers.push(ty),
                (false, Some(ty)) => {
                    for n in names {
                        info.fields.insert(self.text(n), ty.clone());
                    }
                }
                _ => {}
            }
        }
    }

    // ---------- web routes ----------

    /// The annotations, attributes or decorators written on a declaration
    fn annotations(&self, n: TsNode) -> String {
        let mut s = String::new();
        for c in children(n) {
            if matches!(c.kind(), "modifiers" | "attribute_list" | "decorator" | "annotation" | "marker_annotation") {
                s.push_str(&self.text(c));
                s.push('\n');
            }
        }
        // Python and TypeScript decorators sit on the parent
        if let Some(p) = n.parent() {
            if p.kind() == "decorated_definition" || p.kind() == "export_statement" {
                for c in children(p) {
                    if c.kind() == "decorator" {
                        s.push_str(&self.text(c));
                        s.push('\n');
                    }
                }
            }
        }
        // TypeScript class members: decorators are siblings before it
        let mut prev = n.prev_named_sibling();
        while let Some(p) = prev {
            if p.kind() != "decorator" {
                break;
            }
            s.push_str(&self.text(p));
            s.push('\n');
            prev = p.prev_named_sibling();
        }
        s
    }

    /// A class's route prefix: `@RequestMapping("/api/lends")`, `[Route("api/lends")]`, `@Controller('lends')`
    fn route_prefix(&self, n: TsNode) -> Option<String> {
        let a = self.annotations(n);
        a.lines().find(|l| l.contains("RequestMapping") || l.contains("Route(") || l.contains("Controller(") || l.contains("APIRouter(")).and_then(first_string)
    }

    fn route(&self, n: TsNode, prefix: Option<&str>) -> Option<String> {
        let a = self.annotations(n);
        for line in a.lines() {
            let verb = ["Get", "Post", "Put", "Delete", "Patch"].into_iter().find(|v| {
                let l = v.to_lowercase();
                line.contains(&format!("{v}Mapping")) || line.contains(&format!("Http{v}")) || line.contains(&format!(".{l}(")) || line.contains(&format!("@{v}("))
            });
            let verb = verb.map(|v| v.to_uppercase()).or_else(|| line.contains("RequestMapping").then(|| "ANY".to_string()));
            if let Some(verb) = verb {
                let path = first_string(line).unwrap_or_default();
                let full = join_route(prefix.unwrap_or(""), &path);
                return Some(format!("{verb} {full}"));
            }
        }
        None
    }

    // ---------- bodies ----------

    fn stmts(&self, n: TsNode) -> Vec<Stmt> {
        if BLOCKS.contains(&n.kind()) {
            let mut out = vec![];
            for c in named_children(n) {
                if BLOCKS.contains(&c.kind()) {
                    out.extend(self.stmts(c));
                } else if let Some(s) = self.stmt(c) {
                    out.push(s);
                }
            }
            out
        } else {
            self.stmt(n).into_iter().collect()
        }
    }

    /// The steps of an optional body
    fn body_of(&self, n: Option<TsNode>) -> Vec<Stmt> {
        n.map(|b| self.stmts(b)).unwrap_or_default()
    }

    fn cond(&self, n: Option<TsNode>) -> (String, Vec<Call>) {
        match n {
            Some(c) => {
                let t = self.short(c);
                let t = t.strip_prefix('(').and_then(|x| x.strip_suffix(')')).map(String::from).unwrap_or(t);
                (t, self.calls(c))
            }
            None => (String::new(), vec![]),
        }
    }

    fn stmt(&self, n: TsNode) -> Option<Stmt> {
        let kind = n.kind();
        if COMMENTS.contains(&kind) || FUNCTIONS.contains(&kind) || CLASSES.contains(&kind) {
            return None;
        }
        match kind {
            "if_statement" | "if_expression" => Some(self.if_stmt(n)),
            "for_statement" | "enhanced_for_statement" | "foreach_statement" | "for_in_statement" | "while_statement" | "do_statement" | "do_while_statement" => {
                let body = n.child_by_field_name("body").or_else(|| named_children(n).into_iter().rev().find(|c| BLOCKS.contains(&c.kind())));
                let test_after = matches!(kind, "do_statement" | "do_while_statement");
                let head = if test_after {
                    let cond = n.child_by_field_name("condition").or_else(|| named_children(n).into_iter().last());
                    format!("while {}", self.cond(cond).0)
                } else {
                    self.head(n, body)
                };
                let calls = if test_after { self.calls_in(n.child_by_field_name("condition")) } else { self.calls_before(n, body) };
                Some(Stmt::Loop { head, calls, body: self.body_of(body), test_after })
            }
            "switch_expression" | "switch_statement" | "expression_switch_statement" | "type_switch_statement" | "when_expression" | "match_statement" | "select_statement" => Some(self.switch(n)),
            "try_statement" | "try_with_resources_statement" | "try_expression" => Some(self.try_stmt(n)),
            "return_statement" | "return_expression" => {
                let value = named_children(n).into_iter().find(|c| !COMMENTS.contains(&c.kind()));
                Some(self.returning(value))
            }
            "throw_statement" | "throw_expression" | "raise_statement" => {
                let value = named_children(n).into_iter().next();
                let word = if kind == "raise_statement" { "raise" } else { "throw" };
                let text = value.map(|v| format!("{word} {}", self.short(v))).unwrap_or_else(|| word.to_string());
                Some(Stmt::Throw { text, calls: self.calls_in(value) })
            }
            "break_statement" => Some(Stmt::Break),
            "continue_statement" => Some(Stmt::Continue),
            // Kotlin: `break` / `continue` (a jump)
            "jump_expression" | "identifier" if matches!(self.text(n).as_str(), "break" | "continue") || self.text(n).starts_with("break@") || self.text(n).starts_with("continue@") => {
                Some(if self.text(n).starts_with("break") { Stmt::Break } else { Stmt::Continue })
            }
            "jump_expression" if self.text(n).starts_with("return") => Some(self.returning(named_children(n).into_iter().next())),
            "jump_expression" if self.text(n).starts_with("throw") => Some(Stmt::Throw { text: self.short(n), calls: self.calls(n) }),
            // A statement holding control flow: `expression_statement (switch_expression)`, `await`ed …
            "expression_statement" => {
                let inner = named_children(n);
                if let [only] = inner.as_slice() {
                    if matches!(only.kind(), "switch_expression" | "if_expression" | "when_expression" | "try_expression") {
                        return self.stmt(*only);
                    }
                    // A docstring, `'use strict'`: not a step
                    if matches!(only.kind(), "string" | "string_literal" | "template_string") {
                        return None;
                    }
                    // Go: `panic(…)` ends the function as a throw does
                    if self.lang == Lang::Go && only.kind() == "call_expression" && only.child_by_field_name("function").is_some_and(|f| self.text(f) == "panic") {
                        return Some(Stmt::Throw { text: self.short(*only), calls: vec![] });
                    }
                }
                Some(self.simple(n))
            }
            // Blocks of their own: `synchronized`, `using`, `with`, `lock`, `defer`
            "synchronized_statement" | "using_statement" | "with_statement" | "lock_statement" | "unsafe_statement" | "checked_statement" | "fixed_statement" => {
                let body = n.child_by_field_name("body").or_else(|| named_children(n).into_iter().rev().find(|c| BLOCKS.contains(&c.kind())));
                let head = self.head(n, body);
                let mut out = vec![Stmt::Simple { text: head, calls: self.calls_before(n, body), declares: None }];
                out.extend(self.body_of(body));
                Some(Stmt::Block(out))
            }
            "labeled_statement" => named_children(n).into_iter().last().and_then(|s| self.stmt(s)),
            _ if BLOCKS.contains(&kind) => Some(Stmt::Block(self.stmts(n))),
            _ => Some(self.simple(n)),
        }
    }

    /// `return x`; `return if (c) a else b` / `return when …`: the choice, each way returning
    fn returning(&self, value: Option<TsNode>) -> Stmt {
        if let Some(v) = value {
            if matches!(v.kind(), "if_expression" | "when_expression" | "switch_expression" | "conditional_expression" | "ternary_expression") && v.kind() != "conditional_expression" && v.kind() != "ternary_expression" {
                if let Some(choice) = self.stmt(v) {
                    return each_returns(choice);
                }
            }
        }
        Stmt::Return { text: value.map(|v| self.short(v)), calls: self.calls_in(value) }
    }

    fn simple(&self, n: TsNode) -> Stmt {
        let mut declares = None;
        // A local with its type: `Lend lend = …`, `val x: T = …`, `const x: T = …`
        let decl = match n.kind() {
            "local_variable_declaration" => n.child_by_field_name("type").zip(n.child_by_field_name("declarator").and_then(|d| d.child_by_field_name("name"))),
            "local_declaration_statement" => descendants(n, "variable_declaration").into_iter().next().and_then(|v| {
                v.child_by_field_name("type").filter(|t| self.text(*t) != "var").zip(descendants(v, "variable_declarator").into_iter().next().and_then(|d| d.child_by_field_name("name").or_else(|| named_children(d).into_iter().next())))
            }),
            "lexical_declaration" | "variable_declaration" => descendants(n, "variable_declarator").into_iter().next().and_then(|d| {
                d.child_by_field_name("type").zip(d.child_by_field_name("name"))
            }),
            "property_declaration" => named_children(n).into_iter().find(|c| c.kind() == "variable_declaration").and_then(|v| {
                let ty = named_children(v).into_iter().find(|x| x.kind() == "user_type" || x.kind() == "nullable_type");
                let id = named_children(v).into_iter().find(|x| x.kind() == "identifier");
                ty.zip(id)
            }),
            _ => None,
        };
        if let Some((t, name)) = decl {
            declares = Some((self.text(name), type_name(&self.text(t))));
        }
        let simple = Stmt::Simple { text: self.short(n), calls: self.calls(n), declares };
        self.or_throw(n, simple)
    }

    /// `find(id).orElseThrow(() -> new NotFound())`, `find(id) ?: throw NotFound()`,
    /// `find(id) ?? throw new NotFound()`: the step, then a decision (found?) with the
    /// throw on its `no` side
    fn or_throw(&self, n: TsNode, simple: Stmt) -> Stmt {
        let Stmt::Simple { text, calls, declares } = simple else { return simple };
        let what = declares.as_ref().map(|(v, _)| v.clone()).or_else(|| assigned_name(&text));
        let found = |what: &Option<String>| match what {
            Some(v) => format!("{v} found?"),
            None => "found?".to_string(),
        };
        // Java's Optional
        if let Some(call) = descendants_and_self(n, "method_invocation").into_iter().find(|c| c.child_by_field_name("name").is_some_and(|x| self.text(x) == "orElseThrow")) {
            let thrown = call
                .child_by_field_name("arguments")
                .and_then(|a| named_children(a).into_iter().next())
                .map(|l| l.child_by_field_name("body").map(|b| self.short(b)).unwrap_or_else(|| self.short(l)))
                .unwrap_or_else(|| "new NoSuchElementException()".into());
            let thrown = format!("throw {thrown}");
            let cut = text.find(".orElseThrow(").map(|i| text[..i].trim_end().to_string()).unwrap_or(text.clone());
            let calls: Vec<Call> = calls.into_iter().filter(|c| c.name != "orElseThrow").collect();
            return Stmt::Block(vec![
                Stmt::Simple { text: cut, calls, declares },
                Stmt::If { cond: found(&what), calls: vec![], then: vec![], els: Some(vec![Stmt::Throw { text: thrown, calls: vec![] }]) },
            ]);
        }
        // Kotlin `?: throw`, C# `?? throw`
        for op in ["?: throw ", "?? throw "] {
            if let Some(i) = text.find(op) {
                let thrown = format!("throw {}", text[i + op.len()..].trim());
                return Stmt::Block(vec![
                    Stmt::Simple { text: text[..i].trim_end().to_string(), calls, declares },
                    Stmt::If { cond: found(&what), calls: vec![], then: vec![], els: Some(vec![Stmt::Throw { text: thrown, calls: vec![] }]) },
                ]);
            }
        }
        Stmt::Simple { text, calls, declares }
    }

    fn if_stmt(&self, n: TsNode) -> Stmt {
        let cond_node = n.child_by_field_name("condition");
        let (cond, calls) = self.cond(cond_node);
        let mut then = n.child_by_field_name("consequence");
        let mut els: Option<Vec<Stmt>> = None;
        let alts = field_children(n, "alternative");
        if !alts.is_empty() {
            els = Some(self.alternatives(&alts));
        } else if self.lang == Lang::Kotlin {
            // Kotlin: `if (c) a else b` without field names: the bodies after the condition
            let bodies: Vec<TsNode> = named_children(n).into_iter().filter(|c| Some(*c) != cond_node).collect();
            then = bodies.first().copied();
            if let Some(e) = bodies.get(1) {
                els = Some(if e.kind() == "if_expression" { vec![self.if_stmt(*e)] } else { self.stmts(*e) });
            }
        }
        let stmt = Stmt::If { cond, calls, then: self.body_of(then), els };
        // Go: `if err := f(); err != nil` runs `err := f()` first
        match n.child_by_field_name("initializer") {
            Some(init) => Stmt::Block(vec![self.simple(init), stmt]),
            None => stmt,
        }
    }

    /// `else …`, `elif …` (Python lists each as an alternative)
    fn alternatives(&self, alts: &[TsNode]) -> Vec<Stmt> {
        let Some((first, rest)) = alts.split_first() else { return vec![] };
        match first.kind() {
            "elif_clause" => {
                let (cond, calls) = self.cond(first.child_by_field_name("condition"));
                let then = self.body_of(first.child_by_field_name("consequence"));
                let els = (!rest.is_empty()).then(|| self.alternatives(rest));
                vec![Stmt::If { cond, calls, then, els }]
            }
            "else_clause" => {
                let body = first.child_by_field_name("body").or_else(|| named_children(*first).into_iter().next());
                self.body_of(body)
            }
            _ => self.stmts(*first),
        }
    }

    fn switch(&self, n: TsNode) -> Stmt {
        let body = n.child_by_field_name("body").or_else(|| named_children(n).into_iter().find(|c| matches!(c.kind(), "switch_block" | "switch_body" | "block")));
        let subject = n
            .child_by_field_name("condition")
            .or_else(|| n.child_by_field_name("value"))
            .or_else(|| n.child_by_field_name("subject"))
            .or_else(|| named_children(n).into_iter().find(|c| c.kind() == "when_subject"));
        let (subject_text, calls) = self.cond(subject);
        let mut cases = vec![];
        let mut has_default = false;
        // Go keeps the cases on the statement itself
        let holder = body.unwrap_or(n);
        for c in named_children(holder) {
            let (label, steps): (String, Vec<Stmt>) = match c.kind() {
                // Java: `case 1: …` / `case 1 -> …`
                "switch_block_statement_group" | "switch_rule" => {
                    let labels: Vec<TsNode> = named_children(c).into_iter().filter(|x| x.kind() == "switch_label").collect();
                    let label = labels.iter().map(|l| self.short(*l).trim_start_matches("case ").trim_end_matches(':').to_string()).collect::<Vec<_>>().join(", ");
                    let steps = named_children(c).into_iter().filter(|x| x.kind() != "switch_label").flat_map(|x| self.stmts(x)).collect();
                    (if label.is_empty() || label == "default" { "else".into() } else { label }, steps)
                }
                // C#: patterns then statements
                "switch_section" => {
                    let (labels, rest): (Vec<TsNode>, Vec<TsNode>) = named_children(c).into_iter().partition(|x| x.kind().ends_with("pattern") || x.kind() == "case_switch_label" || x.kind() == "when_clause");
                    let label = labels.iter().map(|l| self.short(*l)).collect::<Vec<_>>().join(", ");
                    (if label.is_empty() { "else".into() } else { label }, rest.into_iter().flat_map(|x| self.stmts(x)).collect())
                }
                // TypeScript / JavaScript
                "switch_case" => {
                    let label = self.field_text(c, "value").map(|v| one_line(&v)).unwrap_or_default();
                    let steps = field_children(c, "body").into_iter().flat_map(|x| self.stmts(x)).collect();
                    (label, steps)
                }
                "switch_default" => ("else".into(), field_children(c, "body").into_iter().flat_map(|x| self.stmts(x)).collect()),
                // Go
                "expression_case" | "type_case" | "communication_case" => {
                    let label = c.child_by_field_name("value").or_else(|| c.child_by_field_name("type")).or_else(|| c.child_by_field_name("communication")).map(|v| self.short(v)).unwrap_or_default();
                    (label, named_children(c).into_iter().filter(|x| x.kind() == "statement_list" || x.kind() == "block").flat_map(|x| self.stmts(x)).collect())
                }
                "default_case" => ("else".into(), named_children(c).into_iter().flat_map(|x| self.stmts(x)).collect()),
                // Kotlin
                "when_entry" => {
                    let conds: Vec<String> = field_children(c, "condition").into_iter().map(|x| self.short(x)).collect();
                    let body = named_children(c).into_iter().filter(|x| !field_children(c, "condition").contains(x)).last();
                    let label = if conds.is_empty() { "else".to_string() } else { conds.join(", ") };
                    (label, body.map(|b| self.stmts(b)).unwrap_or_default())
                }
                // Python
                "case_clause" => {
                    let label = named_children(c).into_iter().filter(|x| x.kind() == "case_pattern").map(|x| self.short(x)).collect::<Vec<_>>().join(", ");
                    let label = if label == "_" { "else".into() } else { label };
                    (label, self.body_of(c.child_by_field_name("consequence")))
                }
                _ => continue,
            };
            if label == "else" {
                has_default = true;
            }
            cases.push((label, steps));
        }
        let head = match n.kind() {
            "when_expression" => format!("when {subject_text}"),
            "match_statement" => format!("match {subject_text}"),
            _ => format!("switch {subject_text}"),
        };
        Stmt::Switch { subject: head.trim().to_string(), calls, cases, has_default }
    }

    fn try_stmt(&self, n: TsNode) -> Stmt {
        let body = n.child_by_field_name("body").or_else(|| named_children(n).into_iter().find(|c| BLOCKS.contains(&c.kind())));
        let mut catches = vec![];
        let mut finally = None;
        for c in named_children(n) {
            match c.kind() {
                "catch_clause" | "except_clause" | "catch_block" => {
                    let what = c
                        .child_by_field_name("parameter")
                        .or_else(|| named_children(c).into_iter().find(|x| matches!(x.kind(), "catch_formal_parameter" | "catch_declaration" | "as_pattern" | "user_type" | "identifier")))
                        .map(|x| {
                            // The type of what is caught, not its name
                            descendants(x, "type_identifier").into_iter().chain(descendants(x, "user_type")).next().map(|t| self.text(t)).unwrap_or_else(|| self.short(x))
                        })
                        .unwrap_or_else(|| "error".into());
                    let b = c.child_by_field_name("body").or_else(|| named_children(c).into_iter().rev().find(|x| BLOCKS.contains(&x.kind())));
                    catches.push((what, self.body_of(b)));
                }
                "finally_clause" | "finally_block" => {
                    let b = named_children(c).into_iter().find(|x| BLOCKS.contains(&x.kind()));
                    finally = Some(self.body_of(b));
                }
                _ => {}
            }
        }
        // TypeScript names its catch (found above already as a `catch_clause`)
        if let Some(h) = n.child_by_field_name("handler").filter(|_| catches.is_empty()) {
            let what = h.child_by_field_name("parameter").map(|p| self.text(p)).unwrap_or_else(|| "error".into());
            catches.push((what, self.body_of(h.child_by_field_name("body"))));
        }
        if let Some(f) = n.child_by_field_name("finalizer") {
            finally = Some(self.body_of(named_children(f).into_iter().next()));
        }
        Stmt::Try { body: self.body_of(body), catches, finally }
    }

    // ---------- calls ----------

    fn calls_in(&self, n: Option<TsNode>) -> Vec<Call> {
        n.map(|x| self.calls(x)).unwrap_or_default()
    }

    /// The calls in a loop's or block's head (before its body)
    fn calls_before(&self, n: TsNode, body: Option<TsNode>) -> Vec<Call> {
        named_children(n).into_iter().filter(|c| Some(*c) != body).flat_map(|c| self.calls(c)).collect()
    }

    /// The calls in a node, in the order they run (arguments and receivers first)
    fn calls(&self, n: TsNode) -> Vec<Call> {
        let mut out = vec![];
        self.collect_calls(n, &mut out);
        out
    }

    fn collect_calls(&self, n: TsNode, out: &mut Vec<Call>) {
        if LAMBDAS.contains(&n.kind()) || FUNCTIONS.contains(&n.kind()) {
            return;
        }
        for c in named_children(n) {
            self.collect_calls(c, out);
        }
        if let Some(call) = self.call(n) {
            out.push(call);
        }
    }

    fn call(&self, n: TsNode) -> Option<Call> {
        let (receiver, name) = match n.kind() {
            // Java
            "method_invocation" => (n.child_by_field_name("object"), n.child_by_field_name("name").map(|x| self.text(x))?),
            // C#
            "invocation_expression" => {
                let f = n.child_by_field_name("function")?;
                match f.kind() {
                    "member_access_expression" => (f.child_by_field_name("expression"), f.child_by_field_name("name").map(|x| generic_base(&self.text(x)))?),
                    _ => (None, generic_base(&self.text(f))),
                }
            }
            // Go, TypeScript, JavaScript, Kotlin
            "call_expression" => {
                let f = n.child_by_field_name("function").or_else(|| named_children(n).into_iter().next())?;
                match f.kind() {
                    "member_expression" => (f.child_by_field_name("object"), f.child_by_field_name("property").map(|x| self.text(x))?),
                    "selector_expression" => (f.child_by_field_name("operand"), f.child_by_field_name("field").map(|x| self.text(x))?),
                    "navigation_expression" => {
                        let parts = named_children(f);
                        let last = parts.last()?;
                        (parts.first().copied().filter(|p| p != last), self.text(*last).trim_start_matches(['.', '?']).to_string())
                    }
                    "identifier" | "simple_identifier" => (None, self.text(f)),
                    _ => return None,
                }
            }
            // Python
            "call" => {
                let f = n.child_by_field_name("function")?;
                match f.kind() {
                    "attribute" => (f.child_by_field_name("object"), f.child_by_field_name("attribute").map(|x| self.text(x))?),
                    "identifier" => (None, self.text(f)),
                    _ => return None,
                }
            }
            _ => return None,
        };
        let receiver = receiver.map(|r| one_line(&self.text(r)));
        Some(Call { receiver, name, text: self.short(n) })
    }
}

/// A choice whose ways each give the value returned: their last step returns it
fn each_returns(s: Stmt) -> Stmt {
    fn last_returns(mut steps: Vec<Stmt>) -> Vec<Stmt> {
        match steps.pop() {
            Some(Stmt::Simple { text, calls, .. }) => steps.push(Stmt::Return { text: Some(text), calls }),
            Some(other @ (Stmt::If { .. } | Stmt::Switch { .. })) => steps.push(each_returns(other)),
            Some(other) => {
                let ends = matches!(other, Stmt::Return { .. } | Stmt::Throw { .. });
                steps.push(other);
                if !ends {
                    steps.push(Stmt::Return { text: None, calls: vec![] });
                }
            }
            None => steps.push(Stmt::Return { text: None, calls: vec![] }),
        }
        steps
    }
    match s {
        Stmt::If { cond, calls, then, els } => Stmt::If { cond, calls, then: last_returns(then), els: Some(last_returns(els.unwrap_or_default())) },
        Stmt::Switch { subject, calls, cases, has_default } => {
            Stmt::Switch { subject, calls, cases: cases.into_iter().map(|(l, b)| (l, last_returns(b))).collect(), has_default }
        }
        other => other,
    }
}

/// The name a statement assigns: `var x = …`, `Lend lend = …`, `val x: T = …` → x
fn assigned_name(text: &str) -> Option<String> {
    let left = text.split_once(" = ").map(|(l, _)| l)?;
    let name = left.split([' ', ':']).filter(|w| !w.is_empty()).last()?;
    let name = left.split(':').next().and_then(|l| l.split_whitespace().last()).unwrap_or(name);
    name.chars().all(|c| c.is_alphanumeric() || c == '_').then(|| name.to_string())
}

/// The node itself and its descendants of a kind (lambdas not entered)
fn descendants_and_self<'t>(n: TsNode<'t>, kind: &str) -> Vec<TsNode<'t>> {
    let mut out = if n.kind() == kind { vec![n] } else { vec![] };
    for d in descendants(n, kind) {
        if !out.contains(&d) {
            out.push(d);
        }
    }
    out.retain(|d| {
        let mut p = d.parent();
        while let Some(x) = p {
            if x == n {
                return true;
            }
            if LAMBDAS.contains(&x.kind()) {
                return false;
            }
            p = x.parent();
        }
        true
    });
    out
}

/// Long strings shortened, and the whole kept to a readable length
fn shorten(s: &str) -> String {
    let mut out = String::new();
    let mut in_str: Option<char> = None;
    let mut len = 0;
    for ch in s.chars() {
        match in_str {
            Some(q) => {
                if ch == q {
                    in_str = None;
                    if len > 28 {
                        out.push('…');
                    }
                    out.push(ch);
                } else {
                    len += 1;
                    if len <= 28 {
                        out.push(ch);
                    }
                }
            }
            None => {
                if ch == '"' || ch == '\'' || ch == '`' {
                    in_str = Some(ch);
                    len = 0;
                }
                out.push(ch);
            }
        }
    }
    if out.chars().count() > 110 {
        out = out.chars().take(108).collect::<String>() + "…";
    }
    out
}

/// `Get<T>` → `Get`
fn generic_base(s: &str) -> String {
    s.split('<').next().unwrap_or(s).trim().to_string()
}

/// All descendants of a kind (not looking inside them)
fn descendants<'t>(n: TsNode<'t>, kind: &str) -> Vec<TsNode<'t>> {
    let mut out = vec![];
    fn go<'t>(n: TsNode<'t>, kind: &str, out: &mut Vec<TsNode<'t>>) {
        let mut c = n.walk();
        for ch in n.named_children(&mut c) {
            if ch.kind() == kind {
                out.push(ch);
            } else {
                go(ch, kind, out);
            }
        }
    }
    go(n, kind, &mut out);
    out
}

fn collect_types(n: TsNode, src: &[u8], out: &mut Vec<String>) {
    let mut c = n.walk();
    for ch in n.named_children(&mut c) {
        match ch.kind() {
            "type_identifier" | "identifier" | "user_type" | "simple_identifier" if ch.parent().is_some_and(|p| p.kind() != "type_arguments") => {
                let t = type_name(ch.utf8_text(src).unwrap_or(""));
                if !t.is_empty() && !out.contains(&t) {
                    out.push(t);
                }
            }
            "type_arguments" | "value_arguments" => {}
            _ => collect_types(ch, src, out),
        }
    }
}

/// Spaces and line breaks collapsed, a trailing `;` off
pub fn one_line(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            space = true;
        } else {
            if space && !out.is_empty() {
                out.push(' ');
            }
            space = false;
            out.push(ch);
        }
    }
    out.trim_end_matches(';').trim().to_string()
}

/// The first string literal in a line: `@GetMapping("/{id}")` → `/{id}`
fn first_string(line: &str) -> Option<String> {
    for q in ['"', '\''] {
        if let Some(a) = line.find(q) {
            if let Some(b) = line[a + 1..].find(q) {
                return Some(line[a + 1..a + 1 + b].to_string());
            }
        }
    }
    None
}

fn join_route(prefix: &str, path: &str) -> String {
    let p = prefix.trim_end_matches('/');
    let s = path.trim_start_matches('/');
    let joined = match (p.is_empty(), s.is_empty()) {
        (true, true) => "/".to_string(),
        (true, false) => format!("/{s}"),
        (false, true) => p.to_string(),
        (false, false) => format!("{p}/{s}"),
    };
    if joined.starts_with('/') { joined } else { format!("/{joined}") }
}
