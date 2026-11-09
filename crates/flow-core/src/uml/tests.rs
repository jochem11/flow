use super::*;
use crate::models::NodeKind;

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

/// The same as the level of detail test in src/lib/classModel.test.ts.
#[test]
fn rows_at_a_level_of_detail() {
    use crate::models::ClassDetail as D;
    assert_eq!([row_shown(1, false, "- id: int", D::Public), row_shown(1, false, "+ name: string", D::Public), row_shown(1, false, "id: int", D::Public)], [false, true, false]);
    assert_eq!([row_shown(2, false, "- check()", D::Public), row_shown(2, false, "total(): int", D::Public)], [false, true]);
    assert_eq!([row_shown(1, true, "Paid", D::Public), row_shown(1, false, "+ name: string", D::Names), row_shown(0, false, "Order", D::Names)], [true, false, true]);
}

#[test]
fn getters_setters_and_constructors() {
    let n: Node = serde_json::from_value(serde_json::json!({ "id": "c", "kind": "class", "x": 0, "y": 0, "w": 1, "h": 1, "color": "white",
        "text": "Greeting\n--\n- hoi: String\n- paid: bool\n--\n+ getHoi: hoi\n+ isPaid()\n+ setHoi(value: String)\n+ Greeting(hoi: String)\n+ wave()\nnot a row" })).unwrap();
    assert_eq!(n.kind, NodeKind::Class);
    let c = read_class(&n);
    let body = |name: &str| c.methods.iter().find(|m| m.name == name).unwrap().body.clone();
    assert_eq!(body("getHoi"), Body::Get("hoi".into()));
    assert_eq!(body("isPaid"), Body::Get("paid".into()));
    assert_eq!(body("setHoi"), Body::Set("hoi".into(), "value".into()));
    assert_eq!(body("Greeting"), Body::Init(vec![("hoi".into(), "hoi".into())]));
    assert_eq!(body("wave"), Body::Todo);
    assert_eq!(c.unreadable, vec!["Not in UML notation, skipped: not a row"]);
}

#[test]
fn names_and_types() {
    assert_eq!(pascal("order_line"), "OrderLine");
    assert_eq!(named("LocalDate"), "date");
    assert_eq!(named("java.util.Order"), "Order");
    assert_eq!(named("Integer"), "int");
    assert_eq!(named("models::Order"), "Order");
}
