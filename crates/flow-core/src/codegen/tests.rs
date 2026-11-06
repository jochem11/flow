use super::*;

#[test]
fn rows_in_uml_notation() {
    let f = parse_attribute("- total: Money = 0").unwrap();
    assert_eq!((f.vis, f.name.as_str(), f.ty.as_str(), f.default.as_deref()), (Vis::Private, "total", "Money", Some("0")));
    assert!(parse_attribute("+ lines: List<OrderLine>").is_some());
    assert!(parse_attribute("+ customer: Customer?").is_some());
    assert!(parse_attribute("{static} count: int").unwrap().is_static);
    // Not UML: type before name, no type, spaces in names
    assert!(parse_attribute("int total").is_none());
    assert!(parse_attribute("- total").is_none());
    assert!(parse_attribute("- total price: int").is_none());

    let m = parse_operation("+ pay(amount: double, note: string): bool").unwrap();
    assert_eq!(m.params, vec![("amount".into(), "double".into()), ("note".into(), "string".into())]);
    assert_eq!(m.ret.as_deref(), Some("bool"));
    assert!(parse_operation("+ cancel()").unwrap().ret.is_none());
    assert!(parse_operation("+ pay(double amount): bool").is_none());
    // Without the (): an operation without parameters
    let m = parse_operation("+ pay: bool").unwrap();
    assert!(m.params.is_empty() && m.ret.as_deref() == Some("bool"));
    assert!(parse_operation("+ pay bool").is_none());
}

/// The same cases as src/lib/umlClass.test.ts, so the editor and the export agree.
#[test]
fn uml_rows_fixture() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../fixtures/uml-rows.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        // The class, plus each related class connected with a dependency (which adds no field)
        let mut nodes = vec![serde_json::json!({ "id": "main", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": case["text"] })];
        let mut edges = vec![];
        for (i, r) in case["related"].as_array().unwrap().iter().enumerate() {
            nodes.push(serde_json::json!({ "id": format!("r{i}"), "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": r }));
            edges.push(serde_json::json!({ "id": format!("e{i}"), "from": "main", "to": format!("r{i}"), "pattern": "dashed", "endCap": "open" }));
        }
        let flow: FlowDoc = serde_json::from_value(serde_json::json!({ "camera": { "x": 0, "y": 0, "zoom": 1 }, "nodes": nodes, "edges": edges })).unwrap();
        let classes = read_classes(&flow);
        let main = classes.iter().find(|c| c.name == pascal(case["text"].as_str().unwrap().lines().next().unwrap())).unwrap();
        let names = |key: &str| -> Vec<String> { case[key].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect() };
        assert_eq!(main.fields.iter().map(|f| f.name.clone()).collect::<Vec<_>>(), names("fields"), "{name}: fields");
        assert_eq!(main.methods.iter().map(|m| m.name.clone()).collect::<Vec<_>>(), names("methods"), "{name}: methods");
    }
}

#[test]
fn getters_and_setters() {
    let flow: FlowDoc = serde_json::from_str(r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 }, "edges": [],
      "nodes": [{ "id": "c", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white",
        "text": "Greeting\n--\n- hoi: String\n- paid: bool\n--\n+ getHoi: hoi\n+ isPaid()\n+ setHoi(value: String)\n+ wave()" }] }"#).unwrap();
    let c = &read_classes(&flow)[0];
    let body = |n: &str| c.methods.iter().find(|m| m.name == n).unwrap().body.clone();
    assert_eq!(body("getHoi"), Body::Get("hoi".into()));
    assert_eq!(c.methods[0].ret.as_deref(), Some("String"));
    assert_eq!(body("isPaid"), Body::Get("paid".into()));
    assert_eq!(body("setHoi"), Body::Set("hoi".into(), "value".into()));
    assert_eq!(body("wave"), Body::Todo);
    let java = generate(&flow, CodeLanguage::Java, "x").remove(0).content;
    assert!(java.contains("public String getHoi() {\n        return this.hoi;"));
    assert!(java.contains("this.hoi = value;"));
    let rs = generate(&flow, CodeLanguage::Rust, "x").remove(0).content;
    assert!(rs.contains("fn set_hoi(&mut self, value: String) {"));
}

#[test]
fn only_known_types() {
    let flow: FlowDoc = serde_json::from_str(r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 },
      "nodes": [
        { "id": "a", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white",
          "text": "Order\n--\n- id: int\n- owner: Customer\n- ghost: Ghost\n--\n+ getId(): id\n+ copy(): Order\n+ find(c: Customer): Invoice\n+ items(): List<Thing>" },
        { "id": "b", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": "Customer" },
        { "id": "c", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": "Invoice" }
      ],
      "edges": [{ "id": "e", "from": "a", "to": "b", "endCap": "none" }] }"#).unwrap();
    let classes = read_classes(&flow);
    let order = classes.iter().find(|c| c.name == "Order").unwrap();
    let fields: Vec<&str> = order.fields.iter().map(|f| f.name.as_str()).collect();
    let methods: Vec<&str> = order.methods.iter().map(|m| m.name.as_str()).collect();
    // Customer and Invoice are on the board (connected or not), Ghost and Thing are not
    assert_eq!(fields, ["id", "owner"]);
    assert_eq!(methods, ["getId", "copy", "find"]);
    assert!(order.unreadable.iter().any(|u| u.contains("`Thing`") && u.contains("items()")));
    assert!(order.unreadable.iter().any(|u| u.contains("`Ghost`")));
}

#[test]
fn names() {
    assert_eq!(camel("OrderLine"), "orderLine");
    assert_eq!(snake("totalPrice"), "total_price");
    assert_eq!(pascal("order_line"), "OrderLine");
    assert_eq!(snake("HTTPServer"), "http_server");
}

/// The class part of the "All shapes & options" board.
pub(crate) fn shop() -> FlowDoc {
    let json = r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 },
      "nodes": [
        { "id": "pk", "kind": "package", "x": 0, "y": 0, "w": 600, "h": 400, "text": "shop.domain", "color": "white" },
        { "id": "pay", "kind": "class", "x": 0, "y": 0, "w": 200, "h": 100, "text": "«interface»\nPayable\n--\n--\n+ pay(amount: double): bool", "color": "white", "parent": "pk" },
        { "id": "order", "kind": "class", "x": 0, "y": 0, "w": 200, "h": 100, "text": "Order\n--\n- id: UUID\n- total: Money = 0\n# status: Status\n--\n+ pay(amount: double): bool\n+ cancel()\n+ total price is wrong", "color": "white", "parent": "pk" },
        { "id": "rush", "kind": "class", "x": 0, "y": 0, "w": 200, "h": 100, "text": "RushOrder\n--\n- fee: Money", "color": "white", "parent": "pk" },
        { "id": "line", "kind": "class", "x": 0, "y": 0, "w": 200, "h": 100, "text": "OrderLine\n--\n- qty: int\n--\n+ total(): Money", "color": "white" },
        { "id": "cust", "kind": "class", "x": 0, "y": 0, "w": 200, "h": 100, "text": "Customer\n--\n- name: string\n--\n+ getName(): name\n+ setName(value: string)", "color": "white" },
        { "id": "status", "kind": "class", "x": 0, "y": 0, "w": 200, "h": 100, "text": "«enum»\nStatus\n--\nOpen\nPaid\nShipped", "color": "white" }
      ],
      "edges": [
        { "id": "e1", "from": "order", "to": "pay", "pattern": "dashed", "endCap": "triangle" },
        { "id": "e2", "from": "rush", "to": "order", "endCap": "triangle" },
        { "id": "e3", "from": "order", "to": "line", "startCap": "diamond", "endCap": "none", "startLabel": "1", "endLabel": "1..*" },
        { "id": "e4", "from": "order", "to": "cust", "endCap": "open", "endLabel": "1" },
        { "id": "e5", "from": "order", "to": "status", "endCap": "open" }
      ] }"#;
    serde_json::from_str(json).unwrap()
}

#[test]
fn reads_the_relations() {
    let classes = read_classes(&shop());
    let get = |n: &str| classes.iter().find(|c| c.name == n).unwrap();
    let order = get("Order");
    assert_eq!(order.implements, vec!["Payable"]);
    assert_eq!(get("RushOrder").extends.as_deref(), Some("Order"));
    assert!(order.fields.iter().any(|f| f.name == "orderLines" && f.ty == "List<OrderLine>"));
    assert!(order.fields.iter().any(|f| f.name == "customer" && f.ty == "Customer?"));
    assert_eq!(order.unreadable, vec!["Not in UML notation, skipped: + total price is wrong"]);
    assert_eq!(order.package.as_deref(), Some("shop.domain"));
    assert_eq!(get("Status").values, vec!["Open", "Paid", "Shipped"]);
    // Supertypes first
    let pos = |n: &str| classes.iter().position(|c| c.name == n).unwrap();
    assert!(pos("Payable") < pos("Order") && pos("Order") < pos("RushOrder"));
}

/// Writes the test diagram's code for every language to `<temp>/flow-code/<language>/`,
/// to compile with the real compilers: `cargo test write_shop_code -- --ignored`
#[test]
#[ignore]
fn write_shop_code() {
    let root = std::env::temp_dir().join("flow-code");
    for (l, dir) in [
        (CodeLanguage::TypeScript, "typescript"),
        (CodeLanguage::Java, "java"),
        (CodeLanguage::CSharp, "csharp"),
        (CodeLanguage::Python, "python"),
        (CodeLanguage::Kotlin, "kotlin"),
        (CodeLanguage::Rust, "rust"),
        (CodeLanguage::Go, "go"),
    ] {
        let d = root.join(dir);
        std::fs::create_dir_all(&d).unwrap();
        for f in generate(&shop(), l, "Shop") {
            std::fs::write(d.join(&f.name), f.content).unwrap();
        }
    }
}

/// The code for a document saved by the app, for every language, to
/// `<temp>/flow-code-doc/<language>/`; prints the rows that were skipped:
/// `FLOW_DOC=path/to/doc.json cargo test code_from_file -- --ignored --nocapture`
#[test]
#[ignore]
fn code_from_file() {
    let path = std::env::var("FLOW_DOC").expect("set FLOW_DOC to a saved flowchart document");
    let doc: crate::models::Document = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let crate::models::DocContent::Flow(flow) = doc.content else { panic!("not a flowchart") };
    for c in read_classes(&flow) {
        for u in &c.unreadable {
            println!("SKIPPED in {}: {u}", c.name);
        }
    }
    let root = std::env::temp_dir().join("flow-code-doc");
    let _ = std::fs::remove_dir_all(&root);
    for (l, dir) in [
        (CodeLanguage::TypeScript, "typescript"),
        (CodeLanguage::Java, "java"),
        (CodeLanguage::CSharp, "csharp"),
        (CodeLanguage::Python, "python"),
        (CodeLanguage::Kotlin, "kotlin"),
        (CodeLanguage::Rust, "rust"),
        (CodeLanguage::Go, "go"),
    ] {
        let d = root.join(dir);
        std::fs::create_dir_all(&d).unwrap();
        for f in generate(&flow, l, "patterns") {
            std::fs::write(d.join(&f.name), f.content).unwrap();
        }
    }
}

#[test]
fn every_language() {
    let code = |l| generate(&shop(), l, "Shop").into_iter().map(|f| f.content).collect::<String>();
    let ts = code(CodeLanguage::TypeScript);
    assert!(ts.contains("export class Order implements Payable {"));
    assert!(ts.contains("export class RushOrder extends Order {"));
    assert!(ts.contains("private orderLines: OrderLine[] = [];"));
    assert!(ts.contains("// Not in UML notation, skipped: + total price is wrong"));
    let java = generate(&shop(), CodeLanguage::Java, "Shop");
    assert!(java.iter().any(|f| f.name == "Order.java" && f.content.contains("package shop.domain;") && f.content.contains("private List<OrderLine> orderLines = new ArrayList<>();")));
    let cs = code(CodeLanguage::CSharp);
    assert!(cs.contains("namespace Shop.Domain;"));
    assert!(cs.contains("private Guid Id { get; set; }"));
    assert!(cs.contains("private decimal Total { get; set; } = 0m;"));
    assert!(code(CodeLanguage::Python).contains("class Order(Payable):"));
    let kt = code(CodeLanguage::Kotlin);
    assert!(kt.contains("open class Order : Payable {"));
    assert!(kt.contains("override fun pay(amount: Double): Boolean"));
    assert!(code(CodeLanguage::Rust).contains("impl Payable for Order {"));
    let go = code(CodeLanguage::Go);
    assert!(go.contains("package domain"));
    assert!(go.contains("type RushOrder struct {\n\tOrder"));
    assert!(go.contains("var _ Payable = (*Order)(nil)"));
    assert!(go.contains("func (c *Customer) GetName() string {\n\treturn c.name"));
}

/// The same rows as src/lib/classModel.test.ts, so the class panel and the code agree.
#[test]
fn class_rows_fixture() {
    let fixture: serde_json::Value = serde_json::from_str(include_str!("../../../../fixtures/classRows.json")).unwrap();
    let vis = |v: Vis| match v {
        Vis::Public => "+",
        Vis::Private => "-",
        Vis::Protected => "#",
        Vis::Package => "~",
        Vis::Unset => "",
    };
    for case in fixture["attributes"].as_array().unwrap() {
        let row = case["row"].as_str().unwrap();
        let parsed = parse_attribute(row).map(|f| {
            serde_json::json!({ "vis": vis(f.vis), "name": f.name, "type": f.ty, "default": f.default, "static": f.is_static, "readOnly": f.read_only })
        });
        assert_eq!(parsed.unwrap_or(serde_json::Value::Null), case["parsed"], "{row}");
    }
    for case in fixture["operations"].as_array().unwrap() {
        let row = case["row"].as_str().unwrap();
        let parsed = parse_operation(row).map(|m| {
            serde_json::json!({ "vis": vis(m.vis), "name": m.name, "params": m.params, "returns": m.ret, "static": m.is_static, "abstract": m.is_abstract })
        });
        assert_eq!(parsed.unwrap_or(serde_json::Value::Null), case["parsed"], "{row}");
    }
}

/// Rows shown in a board's language: the same as rowIn in src/lib/classModel.test.ts.
#[test]
fn rows_in_a_language() {
    use CodeLanguage as L;
    assert_eq!(row_in(1, false, "- owner: Customer?", L::TypeScript), "- owner: Customer | null");
    assert_eq!(row_in(2, false, "+ find(id: uuid): Order?", L::Go), "+ find(id: string): *Order");
    assert_eq!(row_in(1, false, "- id: int {readOnly}", L::Kotlin), "- id: Int {readOnly}");
    assert_eq!(row_in(1, true, "Paid", L::Java), "Paid");
    assert_eq!(row_in(1, false, "not uml", L::Go), "not uml");
}

/// Constructors, a record, read-only attributes, sets and maps, and subclasses
/// with and without a constructor of their own.
pub(crate) fn members() -> FlowDoc {
    let json = r#"{ "camera": { "x": 0, "y": 0, "zoom": 1 },
      "nodes": [
        { "id": "o", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white",
          "text": "Order\n--\n- id: int {readOnly}\n- lines: List<OrderLine>\n- tags: Set<string>\n- prices: Map<string, decimal>\n- note: string = \"x\"\n--\n+ Order(id: int)\n+ getId(): int\n+ total(): decimal" },
        { "id": "s", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white",
          "text": "SpecialOrder\n--\n- discount: decimal\n--\n+ SpecialOrder(discount: decimal)" },
        { "id": "g", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white", "text": "Gift\n--\n- message: string\n--\n" },
        { "id": "l", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white",
          "text": "«record»\nOrderLine\n--\n- quantity: int\n- price: decimal\n--\n+ subtotal(): decimal" }
      ],
      "edges": [
        { "id": "e1", "from": "s", "to": "o", "endCap": "triangle" },
        { "id": "e2", "from": "g", "to": "o", "endCap": "triangle" }
      ] }"#;
    serde_json::from_str(json).unwrap()
}

/// `cargo test write_members_code -- --ignored`: the code for `members()` in
/// `<temp>/flow-members/<language>/`, to compile with the real compilers.
#[test]
#[ignore]
fn write_members_code() {
    let root = std::env::temp_dir().join("flow-members");
    for (l, dir) in [
        (CodeLanguage::TypeScript, "typescript"),
        (CodeLanguage::Java, "java"),
        (CodeLanguage::CSharp, "csharp"),
        (CodeLanguage::Python, "python"),
        (CodeLanguage::Kotlin, "kotlin"),
        (CodeLanguage::Rust, "rust"),
        (CodeLanguage::Go, "go"),
    ] {
        let d = root.join(dir);
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        for f in generate(&members(), l, "Members") {
            std::fs::write(d.join(&f.name), f.content).unwrap();
        }
    }
}

/// What `members()` must make in each language (compiled for real with
/// `write_members_code`: TypeScript, Java, Python and Rust compile).
#[test]
fn constructors_records_and_read_only() {
    let code = |l: CodeLanguage| generate(&members(), l, "Members").into_iter().map(|f| f.content).collect::<Vec<_>>().join("\n");
    let has = |l: CodeLanguage, parts: &[&str]| {
        let c = code(l);
        for p in parts {
            assert!(c.contains(p), "{l:?} lacks {p:?}:\n{c}");
        }
    };
    use CodeLanguage as L;
    has(L::TypeScript, &["constructor(id?: number) {\n    if (id !== undefined) this.id = id;", "constructor(discount: number) {\n    super();", "private readonly id!: number;", "private readonly quantity!: number;", "constructor(quantity: number, price: number)"]);
    has(L::Java, &["protected Order() {", "public Order(int id) {\n        this.id = id;", "public record OrderLine(int quantity, BigDecimal price)", "private Set<String> tags = new HashSet<>();"]);
    has(L::CSharp, &["protected Order()", "public Order(int id)\n    {\n        Id = id;", "private int Id { get; init; }", "public record OrderLine(int Quantity, decimal Price)", "HashSet<string> Tags { get; set; } = new();"]);
    has(L::Kotlin, &["open class Order {", "    constructor()\n    constructor(id: Int) {", "class SpecialOrder : Order {", "constructor(discount: BigDecimal) : super() {", "class Gift : Order() {", "data class OrderLine(val quantity: Int, val price: BigDecimal)"]);
    has(L::Python, &["@dataclass(frozen=True)\nclass OrderLine:", "# Order(...): the dataclass's own __init__ takes the fields"]);
    has(L::Rust, &["pub fn new(id: i32) -> Self {\n        Self { id, ..Default::default() }", "#[derive(Debug, Clone, PartialEq, Default)]\npub struct OrderLine", "use std::collections::{HashMap, HashSet};"]);
    has(L::Go, &["func NewOrder(id int) *Order {\n\treturn &Order{note: \"x\", id: id}", "func NewSpecialOrder(discount float64) *SpecialOrder", "tags map[string]bool"]);
}
