use super::*;
use crate::models::{CodeActivity, NodeKind};

fn files(list: &[(&str, &str)]) -> Vec<(String, String)> {
    list.iter().map(|(p, t)| (p.to_string(), t.to_string())).collect()
}

/// The diagram as text: each block, and each line with its label
fn dump(a: &CodeActivity) -> String {
    let name = |id: &str| {
        let n = a.nodes.iter().find(|n| n.id == id).unwrap();
        let k = serde_json::to_value(n.kind).unwrap();
        format!("{}[{}]", k.as_str().unwrap(), n.text.lines().next().unwrap_or(""))
    };
    let mut s = String::new();
    for n in &a.nodes {
        let parent = n.parent.as_deref().map(|p| format!(" in {}", name(p))).unwrap_or_default();
        s.push_str(&format!("{}{parent}\n", name(&n.id)));
    }
    for e in &a.edges {
        s.push_str(&format!("{} -{}-> {}\n", name(&e.from), e.label.as_deref().unwrap_or(""), name(&e.to)));
    }
    s
}

fn kinds(a: &CodeActivity, kind: NodeKind) -> Vec<String> {
    a.nodes.iter().filter(|n| n.kind == kind).map(|n| n.text.clone()).collect()
}

fn entry(code: &Codebase, class: Option<&str>, name: &str) -> String {
    code.functions.iter().find(|f| f.name == name && f.class.as_deref() == class).unwrap_or_else(|| panic!("no {name}")).id.clone()
}

const JAVA: &[(&str, &str)] = &[
    (
        "src/LendController.java",
        r#"
@RestController
@RequestMapping("/api/v1/lends")
public class LendController {
    private final EditLendService editLendService;

    @PutMapping("/{id}")
    public ResponseEntity<ApiMessageResponse> editLend(@PathVariable Long id, @RequestBody @Valid EditLendRequest request) {
        editLendService.editLend(id, request);
        return ResponseEntity.ok(new ApiMessageResponse("Lend updated"));
    }
}"#,
    ),
    (
        "src/EditLendService.java",
        r#"
@Service
public class EditLendService {
    private final LendRepository lendRepository;
    private final ItemRepository itemRepository;

    public void editLend(Long lendId, EditLendRequest request) {
        Lend lend = lendRepository.findById(lendId)
                .orElseThrow(() -> new EntityNotFoundException("Lend with id " + lendId + " not found"));
        var conflicts = lendRepository.findActiveAssignmentsForItems(request.getItemIds());
        if (!conflicts.isEmpty()) {
            throw new EntityAlreadyExistsException("One or more items are already assigned");
        }
        Set<Item> items = new HashSet<>(itemRepository.findAllById(request.getItemIds()));
        for (Item item : items) {
            if (item.isBroken()) continue;
            check(item);
        }
        lend.setItems(items);
        lendRepository.save(lend);
    }

    private void check(Item item) {
        switch (item.getStatus()) {
            case LENT: throw new IllegalStateException("lent");
            case FREE: break;
            default: log(item);
        }
    }
}"#,
    ),
];

#[test]
fn java_follows_the_service_and_routes() {
    let code = read(&files(JAVA));
    let controller = code.functions.iter().find(|f| f.name == "editLend" && f.class.as_deref() == Some("LendController")).unwrap();
    assert_eq!(controller.route.as_deref(), Some("PUT /api/v1/lends/{id}"));
    let a = activity(&code, &controller.id, 2).unwrap();
    let d = dump(&a);
    // The service is followed (a section), and check() in it too
    let sections = kinds(&a, NodeKind::Section);
    assert!(sections.iter().any(|s| s.starts_with("LendController.editLend\nPUT /api/v1/lends/{id}")), "{d}");
    assert!(sections.contains(&"EditLendService.editLend".to_string()), "{d}");
    assert!(sections.contains(&"EditLendService.check".to_string()), "{d}");
    let decisions = kinds(&a, NodeKind::Diamond);
    assert!(decisions.contains(&"!conflicts.isEmpty()".to_string()), "{d}");
    assert!(decisions.iter().any(|t| t.starts_with("for (Item item : items)")), "{d}");
    assert!(decisions.iter().any(|t| t.starts_with("switch item.getStatus()")), "{d}");
    // Throws end in a flow final; find-or-throw is a decision with the throw on its `no` side
    assert_eq!(kinds(&a, NodeKind::FlowFinal).len(), 3, "{d}");
    assert!(d.contains("diamond[lend found?] -no-> box[throw new EntityNotFoundException(\"Lend with id \" + lendId + \" not found\")]"), "{d}");
    // Plain steps one after another: one action
    assert!(kinds(&a, NodeKind::Box).contains(&"lend.setItems(items)\nlendRepository.save(lend)".to_string()), "{d}");
    assert!(d.contains("-yes-> box[throw new EntityAlreadyExistsException"), "{d}");
    assert!(d.contains("-next->"), "{d}");
    // After the service: the controller's return, then the end
    assert!(d.contains("box[return ResponseEntity.ok(new ApiMessageResponse(\"Lend updated\"))] --> end[]"), "{d}");
    // A step after a followed function is not joined to that function's last step
    let svc = activity(&code, &code.functions.iter().find(|f| f.name == "editLend" && f.class.as_deref() == Some("EditLendService")).unwrap().id, 2).unwrap();
    for n in &svc.nodes {
        if n.kind == NodeKind::Box && n.text.contains("log(item)") {
            assert!(!n.text.contains("lend.setItems"), "{}", dump(&svc));
        }
    }
    // Depth 0: the service call is a step
    let flat = activity(&code, &controller.id, 0).unwrap();
    assert_eq!(kinds(&flat, NodeKind::Section).len(), 1);
    assert!(kinds(&flat, NodeKind::Box).contains(&"editLendService.editLend(id, request)".to_string()));
}

#[test]
fn typescript_and_python_and_go() {
    let ts = read(&files(&[(
        "src/orders.ts",
        r#"
export class OrderService {
  constructor(private repo: OrderRepo) {}
  async place(id: string) {
    const order = await this.repo.find(id);
    if (!order) { throw new Error("missing"); }
    for (const line of order.lines) { this.reserve(line); }
    return order;
  }
  private reserve(line: Line) { stock.take(line.sku); audit(line); }
}
export const handler = async (req: Request) => {
  const svc = new OrderService(repo);
  try { await svc.place(req.id); } catch (e) { log(e); }
};"#,
    )]));
    let a = activity(&ts, &entry(&ts, None, "handler"), 2).unwrap();
    let d = dump(&a);
    // `svc` has no written type: the call stays a step
    assert!(kinds(&a, NodeKind::Box).iter().any(|t| t.lines().any(|l| l == "await svc.place(req.id)")), "{d}");
    assert_eq!(a.edges.iter().filter(|e| e.label.as_deref() == Some("e")).count(), 1, "{d}");
    assert!(kinds(&a, NodeKind::Diamond).contains(&"error?".to_string()), "{d}");
    let a = activity(&ts, &entry(&ts, Some("OrderService"), "place"), 2).unwrap();
    let d = dump(&a);
    assert!(kinds(&a, NodeKind::Section).contains(&"OrderService.reserve".to_string()), "{d}");
    assert!(kinds(&a, NodeKind::Diamond).iter().any(|t| t.starts_with("for (const line of order.lines)")), "{d}");

    let py = read(&files(&[(
        "app/service.py",
        r#"
class Repo:
    def get(self, id):
        audit(id)
        return db.query(id)

class Service:
    def __init__(self, repo: Repo):
        self.repo = repo

    def run(self, id):
        item = self.repo.get(id)
        if item is None:
            raise NotFound(id)
        elif item.done:
            return item
        else:
            while item.busy:
                item.wait()
        return item

@app.get("/items/{id}")
def read_item(id: int, svc: Service):
    return svc.run(id)
"#,
    )]));
    let f = py.functions.iter().find(|f| f.name == "read_item").unwrap();
    assert_eq!(f.route.as_deref(), Some("GET /items/{id}"));
    let a = activity(&py, &f.id, 3).unwrap();
    let d = dump(&a);
    let sections = kinds(&a, NodeKind::Section);
    assert!(sections.contains(&"Service.run".to_string()) && sections.contains(&"Repo.get".to_string()), "{d}");
    assert!(kinds(&a, NodeKind::Diamond).contains(&"item is None".to_string()), "{d}");
    assert!(kinds(&a, NodeKind::Diamond).contains(&"item.done".to_string()), "{d}");

    let go = read(&files(&[
        (
            "store/store.go",
            "package store\ntype Store struct { db *DB }\nfunc (s *Store) Load(id int) (*Item, error) {\n\tif id <= 0 {\n\t\treturn nil, ErrBad\n\t}\n\treturn s.db.Get(id)\n}\nfunc Open() *Store {\n\ts := &Store{}\n\treturn s\n}\n",
        ),
        (
            "main.go",
            "package main\ntype App struct { store *store.Store }\nfunc (a *App) Show(id int) {\n\titem, err := a.store.Load(id)\n\tif err != nil {\n\t\tpanic(err)\n\t}\n\tfor _, p := range item.Parts {\n\t\tfmt.Println(p)\n\t}\n}\nfunc main() {\n\ts := store.Open()\n\t_ = s\n}\n",
        ),
    ]));
    let a = activity(&go, &entry(&go, Some("App"), "Show"), 2).unwrap();
    let d = dump(&a);
    assert!(kinds(&a, NodeKind::Section).contains(&"Store.Load".to_string()), "{d}");
    assert!(kinds(&a, NodeKind::Diamond).iter().any(|t| t.starts_with("for _, p := range item.Parts")), "{d}");
    assert_eq!(kinds(&a, NodeKind::FlowFinal).len(), 1, "{d}");
    // A package's function, called by its package name
    let a = activity(&go, &entry(&go, None, "main"), 2).unwrap();
    assert!(kinds(&a, NodeKind::Section).contains(&"Open".to_string()), "{}", dump(&a));
}

#[test]
fn steps_stay_in_their_function() {
    let js = read(&files(&[("a.js", "function a() { b(); x(); }\nfunction b() { y(); z(); }\n")]));
    let a = activity(&js, &entry(&js, None, "a"), 1).unwrap();
    let boxes = kinds(&a, NodeKind::Box);
    assert_eq!(boxes, ["y()\nz()", "x()"], "{}", dump(&a));
    let inner = a.nodes.iter().find(|n| n.text == "y()\nz()").unwrap();
    let section = a.nodes.iter().find(|n| n.text == "b").unwrap();
    assert_eq!(inner.parent.as_deref(), Some(section.id.as_str()));
}

#[test]
fn csharp_and_kotlin() {
    let cs = read(&files(&[(
        "Orders/OrderController.cs",
        r#"
[ApiController]
[Route("api/orders")]
public class OrderController : ControllerBase {
    private readonly IOrderService _service;
    public OrderController(IOrderService service) { _service = service; }

    [HttpPost("{id}/pay")]
    public async Task<IActionResult> Pay(int id) {
        var ok = await _service.PayAsync(id);
        if (!ok) return BadRequest();
        return Ok();
    }
}
public interface IOrderService { Task<bool> PayAsync(int id); }
public class OrderService : IOrderService {
    public async Task<bool> PayAsync(int id) {
        foreach (var line in Lines(id)) { if (line.Total < 0) return false; }
        return true;
    }
}"#,
    )]));
    let f = cs.functions.iter().find(|f| f.name == "Pay").unwrap();
    assert_eq!(f.route.as_deref(), Some("POST /api/orders/{id}/pay"));
    let a = activity(&cs, &f.id, 2).unwrap();
    let d = dump(&a);
    // The interface's one implementation is followed
    assert!(kinds(&a, NodeKind::Section).contains(&"OrderService.PayAsync".to_string()), "{d}");
    assert!(kinds(&a, NodeKind::Diamond).iter().any(|t| t.starts_with("foreach (var line in Lines(id))")), "{d}");

    let kt = read(&files(&[(
        "src/Orders.kt",
        "class OrderService(private val repo: OrderRepo) {\n    fun place(id: Long): Order {\n        val order = repo.find(id) ?: throw NotFound(id)\n        when (order.state) {\n            State.NEW -> order.confirm()\n            State.PAID -> return order\n            else -> log(order)\n        }\n        for (line in order.lines) {\n            if (line.qty == 0) break\n            reserve(line)\n        }\n        return order\n    }\n    private fun reserve(line: Line) {\n        stock.take(line.sku)\n        audit(line)\n    }\n}\n",
    )]));
    let a = activity(&kt, &entry(&kt, Some("OrderService"), "place"), 2).unwrap();
    let d = dump(&a);
    assert!(kinds(&a, NodeKind::Diamond).iter().any(|t| t.starts_with("when order.state")), "{d}");
    assert!(kinds(&a, NodeKind::Diamond).iter().any(|t| t.starts_with("for (line in order.lines)")), "{d}");
    assert!(kinds(&a, NodeKind::Section).contains(&"OrderService.reserve".to_string()), "{d}");
}

/// Reads a folder (CODE_FLOW_DIR) and draws its biggest functions: for trying
/// real codebases. `cargo test -p flow-core real_codebase -- --ignored --nocapture`
#[test]
#[ignore]
fn real_codebase() {
    let Ok(dir) = std::env::var("CODE_FLOW_DIR") else { return };
    let started = std::time::Instant::now();
    let (files, skipped) = read_folder(std::path::Path::new(&dir));
    let code = read(&files);
    let src = source("x", "x", &code);
    println!(
        "{dir}: {} files read, {} functions, {} with a route, {} skipped, {:?}",
        code.files,
        src.functions.len(),
        src.functions.iter().filter(|f| f.route.is_some()).count(),
        skipped.len() + code.skipped.len(),
        started.elapsed()
    );
    // Every function, 3 calls deep: no crash, and how big and slow the biggest is
    if std::env::var("CODE_FLOW_ALL").is_ok() {
        let t = std::time::Instant::now();
        let (mut most, mut slowest) = ((0, String::new()), std::time::Duration::ZERO);
        for f in &code.functions {
            let t1 = std::time::Instant::now();
            let a = activity(&code, &f.id, 3).unwrap();
            slowest = slowest.max(t1.elapsed());
            if a.nodes.len() > most.0 {
                most = (a.nodes.len(), f.name.clone());
            }
        }
        println!("  all {} drawn in {:?}; biggest {} blocks ({}), slowest {:?}", code.functions.len(), t.elapsed(), most.0, most.1, slowest);
        return;
    }
    let mut big: Vec<_> = src.functions.iter().collect();
    big.sort_by_key(|f| std::cmp::Reverse(f.steps));
    let only = std::env::var("CODE_FLOW_ENTRY").ok();
    for f in big.iter().filter(|f| only.as_deref().is_none_or(|o| f.name == o)).take(if only.is_some() { 1 } else { 3 }) {
        let t = std::time::Instant::now();
        let a = activity(&code, &f.id, 2).unwrap();
        let count = |k: NodeKind| a.nodes.iter().filter(|n| n.kind == k).count();
        println!(
            "  {}{} ({}:{}) {} steps -> {} blocks: {} actions, {} decisions, {} sections, {} lines, {:?} {}",
            f.class.as_deref().map(|c| format!("{c}.")).unwrap_or_default(),
            f.name,
            f.file,
            f.line,
            f.steps,
            a.nodes.len(),
            count(NodeKind::Box),
            count(NodeKind::Diamond),
            count(NodeKind::Section),
            a.edges.len(),
            t.elapsed(),
            a.notes.join("; ")
        );
        if std::env::var("CODE_FLOW_DUMP").is_ok() {
            println!("{}", dump(&a));
        }
        // Every line joins two blocks of the diagram
        let ids: std::collections::HashSet<&str> = a.nodes.iter().map(|n| n.id.as_str()).collect();
        assert!(a.edges.iter().all(|e| ids.contains(e.from.as_str()) && ids.contains(e.to.as_str())));
    }
}
