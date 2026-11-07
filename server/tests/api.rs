//! The API end to end against a fresh database per test (`sqlx::test` makes one
//! on the server in DATABASE_URL), with mail captured in memory.
//! Run: `DATABASE_URL=postgres://localhost/postgres cargo test -p flow-server`

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use flow_server::config::Config;
use flow_server::mail::Mailer;
use flow_server::{AppState, routes};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

fn config() -> Config {
    Config {
        database_url: String::new(),
        public_url: "http://flow.test".into(),
        bind: String::new(),
        web_dir: None,
        allowed_origins: vec![],
        google: None,
        smtp: None,
        mail_from: "Flow <no-reply@flow.test>".into(),
        mail_outbox: None,
        desktop_scheme: "flowapp".into(),
        trust_proxy: true,
    }
}

struct Server {
    app: Router,
    state: AppState,
}

/// One person's way of calling the API: as the desktop app (a token), as a
/// browser (cookies), or with nothing.
#[derive(Clone, Default)]
struct As {
    token: Option<String>,
    cookies: Vec<String>,
    share: Option<String>,
    /// Leave out the X-Flow header (to test the CSRF rule)
    no_header: bool,
}

impl Server {
    fn new(pool: PgPool) -> Server {
        let state = AppState::new(pool, config(), Mailer::Memory(Default::default()));
        Server { app: routes::app(state.clone()), state }
    }

    async fn call(&self, who: &As, method: &str, path: &str, body: Option<Value>) -> (StatusCode, Value, Vec<String>) {
        let mut req = Request::builder().method(method).uri(format!("/api{path}")).header("content-type", "application/json");
        if let Some(t) = &who.token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        if !who.cookies.is_empty() {
            req = req.header("cookie", who.cookies.join("; "));
        }
        if let Some(s) = &who.share {
            req = req.header("x-flow-share", s);
        }
        if !who.no_header {
            req = req.header("x-flow", "1");
        }
        let body = body.map_or(Body::empty(), |b| Body::from(b.to_string()));
        let res = self.app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let cookies = res.headers().get_all("set-cookie").iter().map(|v| v.to_str().unwrap().split(';').next().unwrap().to_string()).collect();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), cookies)
    }

    async fn ok(&self, who: &As, method: &str, path: &str, body: Option<Value>) -> Value {
        let (status, v, _) = self.call(who, method, path, body).await;
        assert!(status.is_success(), "{method} {path}: {status} {v}");
        v
    }

    async fn status(&self, who: &As, method: &str, path: &str, body: Option<Value>) -> StatusCode {
        self.call(who, method, path, body).await.0
    }

    /// Registers as the desktop app would (gets a token back).
    async fn register(&self, email: &str, name: &str) -> As {
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/register")
            .header("content-type", "application/json")
            .header("x-flow-client", "desktop")
            .body(Body::from(json!({ "email": email, "name": name, "password": "correct horse" }).to_string()))
            .unwrap();
        let res = self.app.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let v: Value = serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
        As { token: Some(v["token"].as_str().unwrap().to_string()), ..As::default() }
    }

    /// The token from the last mail to someone that has a link with `path` in it.
    fn link_token(&self, to: &str, path: &str) -> String {
        let mail = self.state.mailer.sent().into_iter().rev().find(|m| m.to == to && m.text.contains(path)).unwrap_or_else(|| panic!("no mail to {to} with {path}"));
        let start = mail.text.find(path).unwrap() + path.len();
        mail.text[start..].split_whitespace().next().unwrap().to_string()
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn accounts(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("Ann@Example.com", "Ann").await;
    let me = s.ok(&ann, "GET", "/auth/me", None).await;
    assert_eq!((me["user"]["email"].as_str(), me["emailVerified"].as_bool()), (Some("ann@example.com"), Some(false)));

    // Verifying with the mailed link
    let token = s.link_token("ann@example.com", "/verify/");
    assert_eq!(s.ok(&As::default(), "POST", "/auth/verify", Some(json!({ "token": token }))).await["emailVerified"], true);
    assert_eq!(s.status(&As::default(), "POST", "/auth/verify", Some(json!({ "token": token }))).await, StatusCode::BAD_REQUEST, "only once");

    // Same address again, wrong password, logged out
    assert_eq!(s.status(&As::default(), "POST", "/auth/register", Some(json!({ "email": "ann@example.com", "name": "X", "password": "12345678" }))).await, StatusCode::CONFLICT);
    assert_eq!(s.status(&As::default(), "POST", "/auth/login", Some(json!({ "email": "ann@example.com", "password": "wrong one" }))).await, StatusCode::UNAUTHORIZED);
    assert_eq!(s.status(&As::default(), "GET", "/auth/me", None).await, StatusCode::UNAUTHORIZED);

    // In a browser: a cookie, and changes need the X-Flow header
    let (status, _, cookies) = s.call(&As::default(), "POST", "/auth/login", Some(json!({ "email": "ann@example.com", "password": "correct horse" }))).await;
    assert_eq!(status, StatusCode::OK);
    let browser = As { cookies, ..As::default() };
    s.ok(&browser, "GET", "/projects", None).await;
    assert_eq!(s.status(&As { no_header: true, ..browser.clone() }, "POST", "/projects", Some(json!({ "name": "P" }))).await, StatusCode::FORBIDDEN);

    // Forgot the password: a new one logs out everywhere else
    s.ok(&As::default(), "POST", "/auth/forgot", Some(json!({ "email": "ann@example.com" }))).await;
    s.ok(&As::default(), "POST", "/auth/forgot", Some(json!({ "email": "nobody@example.com" }))).await;
    let reset = s.link_token("ann@example.com", "/reset/");
    s.ok(&As::default(), "POST", "/auth/reset", Some(json!({ "token": reset, "password": "a new password" }))).await;
    assert_eq!(s.status(&ann, "GET", "/auth/me", None).await, StatusCode::UNAUTHORIZED);
    s.ok(&As::default(), "POST", "/auth/login", Some(json!({ "email": "ann@example.com", "password": "a new password" }))).await;
}

/// A project with one flowchart board, owned by Ann.
async fn project(s: &Server, ann: &As) -> (String, String) {
    let p = s.ok(ann, "POST", "/projects", Some(json!({ "name": "Shop" }))).await;
    let id = p["id"].as_str().unwrap().to_string();
    assert_eq!(p["role"], "owner");
    let d = s.ok(ann, "POST", &format!("/projects/{id}/documents"), Some(json!({ "folderId": null, "name": "Flow", "kind": "flow" }))).await;
    (id, d["id"].as_str().unwrap().to_string())
}

fn flow_doc(project: &str, doc: &str, text: &str) -> Value {
    json!({ "id": doc, "projectId": project, "folderId": null, "order": 1, "name": "Flow",
            "content": { "kind": "flow", "data": { "camera": { "x": 0, "y": 0, "zoom": 1 }, "edges": [],
              "nodes": [{ "id": "n", "kind": "box", "x": 0, "y": 0, "w": 100, "h": 50, "text": text, "color": "white" }] } } })
}

#[sqlx::test(migrations = "./migrations")]
async fn roles(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let bob = s.register("bob@example.com", "Bob").await;
    let (pid, did) = project(&s, &ann).await;
    let doc = format!("/documents/{did}");

    // Bob is not in it: nothing to see, not even that it exists
    assert_eq!(s.ok(&bob, "GET", "/projects", None).await, json!([]));
    assert_eq!(s.status(&bob, "GET", &doc, None).await, StatusCode::NOT_FOUND);

    // Ann invites Bob: a mail asking whether he wants to join; nothing changes until he accepts
    let invited = s.ok(&ann, "POST", &format!("/projects/{pid}/invites"), Some(json!({ "email": "bob@example.com", "role": "viewer" }))).await;
    assert_eq!(invited["email"], "bob@example.com");
    let mail = s.state.mailer.sent().into_iter().rev().find(|m| m.to == "bob@example.com" && m.text.contains("/invite/")).unwrap();
    assert!(mail.text.contains("you can view") && mail.text.contains("accept or decline"), "{}", mail.text);
    let verify = s.link_token("bob@example.com", "/verify/");
    s.ok(&As::default(), "POST", "/auth/verify", Some(json!({ "token": verify }))).await;
    assert_eq!(s.status(&bob, "GET", &doc, None).await, StatusCode::NOT_FOUND, "not before he accepts");
    // He sees it in the app too, and accepts there
    let mine = s.ok(&bob, "GET", "/invites/mine", None).await;
    assert_eq!((mine.as_array().unwrap().len(), mine[0]["role"].as_str()), (1, Some("viewer")));
    s.ok(&bob, "POST", "/invites/respond", Some(json!({ "id": mine[0]["id"], "accept": true }))).await;
    assert!(s.state.mailer.sent().iter().any(|m| m.to == "ann@example.com" && m.subject.contains("accepted")));
    let projects = s.ok(&bob, "GET", "/projects", None).await;
    assert_eq!(projects[0]["role"], "viewer");

    // A viewer reads but cannot change anything
    s.ok(&bob, "GET", &doc, None).await;
    assert_eq!(s.status(&bob, "PUT", &doc, Some(flow_doc(&pid, &did, "Bob was here"))).await, StatusCode::FORBIDDEN);
    assert_eq!(s.status(&bob, "POST", &format!("{doc}/comments"), Some(json!({ "body": "hi" }))).await, StatusCode::FORBIDDEN);
    assert_eq!(s.status(&bob, "PUT", &format!("/projects/{pid}/members/{}", "x"), Some(json!({ "role": "editor" }))).await, StatusCode::FORBIDDEN);

    // Editor in the project
    let bob_id = s.ok(&bob, "GET", "/auth/me", None).await["user"]["id"].as_str().unwrap().to_string();
    s.ok(&ann, "PUT", &format!("/projects/{pid}/members/{bob_id}"), Some(json!({ "role": "editor" }))).await;
    s.ok(&bob, "PUT", &doc, Some(flow_doc(&pid, &did, "Bob was here"))).await;
    assert_eq!(s.ok(&ann, "GET", &doc, None).await["content"]["data"]["nodes"][0]["text"], "Bob was here");

    // This board only: commenter, then hidden
    s.ok(&ann, "PUT", &format!("{doc}/roles/{bob_id}"), Some(json!({ "role": "commenter" }))).await;
    assert_eq!(s.status(&bob, "PUT", &doc, Some(flow_doc(&pid, &did, "again"))).await, StatusCode::FORBIDDEN);
    s.ok(&bob, "POST", &format!("{doc}/comments"), Some(json!({ "body": "Looks good", "anchor": { "kind": "node", "id": "n" } }))).await;
    s.ok(&ann, "PUT", &format!("{doc}/roles/{bob_id}"), Some(json!({ "role": "none" }))).await;
    assert_eq!(s.ok(&bob, "GET", &format!("/projects/{pid}/documents"), None).await, json!([]));
    assert_eq!(s.status(&bob, "GET", &doc, None).await, StatusCode::NOT_FOUND);
    // Back to the project role
    s.ok(&ann, "PUT", &format!("{doc}/roles/{bob_id}"), Some(json!({ "role": null }))).await;
    assert_eq!(s.ok(&bob, "GET", &format!("/projects/{pid}/documents"), None).await[0]["role"], "editor");

    // The Share dialog
    let access = s.ok(&ann, "GET", &format!("{doc}/access"), None).await;
    assert_eq!(access["members"].as_array().unwrap().len(), 2);
    assert_eq!(access["link"]["access"], "restricted");
    // A co-owner manages people, but does not delete the project
    s.ok(&ann, "PUT", &format!("/projects/{pid}/members/{bob_id}"), Some(json!({ "role": "coOwner" }))).await;
    s.ok(&bob, "GET", &format!("/projects/{pid}/invites"), None).await;
    s.ok(&bob, "PUT", &format!("{doc}/link"), Some(json!({ "access": "view" }))).await;
    assert_eq!(s.ok(&bob, "GET", &format!("{doc}/access"), None).await["role"], "coOwner");
    assert_eq!(s.status(&bob, "PUT", &format!("{doc}/roles/{bob_id}"), Some(json!({ "role": "viewer" }))).await, StatusCode::BAD_REQUEST, "co-owners keep full access");
    let ann_id = s.ok(&ann, "GET", "/auth/me", None).await["user"]["id"].as_str().unwrap().to_string();
    assert_eq!(s.status(&bob, "PUT", &format!("/projects/{pid}/members/{ann_id}"), Some(json!({ "role": "viewer" }))).await, StatusCode::NOT_FOUND, "the owner stays owner");
    // Only the owner deletes the project; Bob can leave it
    assert_eq!(s.status(&bob, "DELETE", &format!("/projects/{pid}"), None).await, StatusCode::FORBIDDEN);
    s.ok(&bob, "DELETE", &format!("/projects/{pid}/members/{bob_id}"), None).await;
    assert_eq!(s.ok(&bob, "GET", "/projects", None).await, json!([]));
}

#[sqlx::test(migrations = "./migrations")]
async fn invite_to_one_board(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let (pid, did) = project(&s, &ann).await;
    let other = s.ok(&ann, "POST", &format!("/projects/{pid}/documents"), Some(json!({ "folderId": null, "name": "Secret", "kind": "text" }))).await;
    s.ok(&ann, "POST", &format!("/projects/{pid}/invites"), Some(json!({ "email": "cat@example.com", "role": "editor", "documentId": did }))).await;

    // Cat signs up later and opens the invitation from the mail
    let token = s.link_token("cat@example.com", "/invite/");
    assert_eq!(s.ok(&As::default(), "GET", &format!("/invites/{token}"), None).await["documentName"], "Flow");
    let cat = s.register("cat@example.com", "Cat").await;
    let dan = s.register("dan@example.com", "Dan").await;
    assert_eq!(s.status(&dan, "POST", "/invites/respond", Some(json!({ "token": token, "accept": true }))).await, StatusCode::FORBIDDEN, "not his address");
    s.ok(&cat, "POST", "/invites/respond", Some(json!({ "token": token, "accept": true }))).await;

    // She sees the project with only that board, and can edit it
    let docs = s.ok(&cat, "GET", &format!("/projects/{pid}/documents"), None).await;
    assert_eq!((docs.as_array().unwrap().len(), docs[0]["role"].as_str()), (1, Some("editor")));
    s.ok(&cat, "PUT", &format!("/documents/{did}"), Some(flow_doc(&pid, &did, "Cat"))).await;
    assert_eq!(s.status(&cat, "GET", &format!("/documents/{}", other["id"].as_str().unwrap()), None).await, StatusCode::NOT_FOUND);
    // but not create boards in the project
    assert_eq!(s.status(&cat, "POST", &format!("/projects/{pid}/documents"), Some(json!({ "folderId": null, "name": "X", "kind": "flow" }))).await, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn share_links_and_guests(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let eve = s.register("eve@example.com", "Eve").await;
    let (_, did) = project(&s, &ann).await;
    let doc = format!("/documents/{did}");
    let link = s.ok(&ann, "GET", &format!("{doc}/access"), None).await["link"].clone();
    let token = link["token"].as_str().unwrap().to_string();
    let nobody = As::default();

    // Restricted: log in first, and then only with access
    assert_eq!(s.status(&nobody, "GET", &format!("/share/{token}"), None).await, StatusCode::UNAUTHORIZED);
    assert_eq!(s.status(&eve, "GET", &format!("/share/{token}"), None).await, StatusCode::FORBIDDEN);
    assert_eq!(s.status(&As { share: Some(token.clone()), ..As::default() }, "GET", &doc, None).await, StatusCode::UNAUTHORIZED);

    // Anyone with the link can comment
    s.ok(&ann, "PUT", &format!("{doc}/link"), Some(json!({ "access": "comment" }))).await;
    assert_eq!(s.ok(&nobody, "GET", &format!("/share/{token}"), None).await["role"], "commenter");
    let guest = As { share: Some(token.clone()), ..As::default() };
    s.ok(&guest, "GET", &doc, None).await;
    assert_eq!(s.status(&guest, "PUT", &doc, Some(json!({}))).await, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(s.status(&guest, "POST", &format!("{doc}/comments"), Some(json!({ "body": "Nice" }))).await, StatusCode::UNAUTHORIZED, "a guest needs a name");
    let (_, g, cookies) = s.call(&guest, "POST", "/guest", Some(json!({ "name": "Gus" }))).await;
    assert_eq!(g["name"], "Gus");
    let gus = As { cookies, ..guest.clone() };
    let c = s.ok(&gus, "POST", &format!("{doc}/comments"), Some(json!({ "body": "Nice", "anchor": { "kind": "point", "x": 10, "y": 20 } }))).await;
    assert_eq!((c["author"]["name"].as_str(), c["author"]["userId"].is_null()), (Some("Gus"), true));
    assert_eq!(s.status(&As { no_header: true, ..gus.clone() }, "POST", &format!("{doc}/comments"), Some(json!({ "body": "x" }))).await, StatusCode::FORBIDDEN);
    // A reply from Ann, and she resolves the thread
    let cid = c["id"].as_str().unwrap();
    s.ok(&ann, "POST", &format!("{doc}/comments"), Some(json!({ "body": "Thanks", "parentId": cid }))).await;
    s.ok(&ann, "PUT", &format!("/comments/{cid}/resolve"), Some(json!({ "resolved": true }))).await;
    assert_eq!(s.status(&eve, "GET", &format!("{doc}/comments"), None).await, StatusCode::NOT_FOUND, "Eve has no access without the link");
    let all = s.ok(&gus, "GET", &format!("{doc}/comments"), None).await;
    assert_eq!((all.as_array().unwrap().len(), all[1]["anchor"]["kind"].as_str()), (2, Some("point")));
    // Gus cannot edit Ann's reply
    let reply = all[1]["id"].as_str().unwrap();
    assert_eq!(s.status(&gus, "PUT", &format!("/comments/{reply}"), Some(json!({ "body": "changed" }))).await, StatusCode::FORBIDDEN);

    // A new link: the old one stops working
    s.ok(&ann, "POST", &format!("{doc}/link/rotate"), None).await;
    assert_eq!(s.status(&nobody, "GET", &format!("/share/{token}"), None).await, StatusCode::NOT_FOUND);
    assert_eq!(s.status(&gus, "GET", &doc, None).await, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn folders_and_upload(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    // A project from the desktop app keeps its ids
    let pid = "11111111-1111-4111-8111-111111111111";
    s.ok(&ann, "POST", "/projects", Some(json!({ "name": "Old", "id": pid, "folders": [{ "id": "f1", "name": "Design", "parentId": null, "order": 1 }] }))).await;
    let did = "d1d1d1d1-0000-4000-8000-000000000001";
    let mut doc = flow_doc(pid, did, "Hi");
    doc["folderId"] = json!("f1");
    assert_eq!(s.status(&ann, "POST", &format!("/projects/{pid}/upload"), Some(doc.clone())).await, StatusCode::CREATED);
    assert_eq!(s.status(&ann, "POST", &format!("/projects/{pid}/upload"), Some(doc)).await, StatusCode::CONFLICT);

    let sub = s.ok(&ann, "POST", &format!("/projects/{pid}/folders"), Some(json!({ "name": "Sub", "parentId": "f1" }))).await;
    assert_eq!(s.status(&ann, "PUT", &format!("/projects/{pid}/folders/f1/move"), Some(json!({ "parentId": sub["id"], "order": 1 }))).await, StatusCode::BAD_REQUEST);
    s.ok(&ann, "DELETE", &format!("/projects/{pid}/folders/f1"), None).await;
    let docs = s.ok(&ann, "GET", &format!("/projects/{pid}/documents"), None).await;
    assert!(docs[0]["folderId"].is_null(), "the board moved up to the root");

    // Tools for the web version
    let arranged = s.ok(&ann, "POST", "/tools/layout", Some(json!({ "nodes": [], "edges": [] }))).await;
    assert_eq!(arranged, json!({ "nodes": [], "edges": [] }));
    assert_eq!(s.status(&As::default(), "POST", "/tools/layout", Some(json!({ "nodes": [], "edges": [] }))).await, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrations = "./migrations")]
async fn declining(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let (pid, did) = project(&s, &ann).await;
    let eve = s.register("eve@example.com", "Eve").await;
    s.ok(&ann, "POST", &format!("/projects/{pid}/invites"), Some(json!({ "email": "eve@example.com", "role": "editor", "documentId": did }))).await;
    let token = s.link_token("eve@example.com", "/invite/");
    s.ok(&eve, "POST", "/invites/respond", Some(json!({ "token": token, "accept": false }))).await;
    assert!(s.state.mailer.sent().iter().any(|m| m.to == "ann@example.com" && m.subject.contains("declined")));
    assert_eq!(s.status(&eve, "GET", &format!("/documents/{did}"), None).await, StatusCode::NOT_FOUND);
    assert_eq!(s.status(&eve, "POST", "/invites/respond", Some(json!({ "token": token, "accept": true }))).await, StatusCode::NOT_FOUND, "answered already");
    assert_eq!(s.ok(&ann, "GET", &format!("/projects/{pid}/invites"), None).await, json!([]));
}

#[sqlx::test(migrations = "./migrations")]
async fn versions_and_templates(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let bob = s.register("bob@example.com", "Bob").await;
    let (pid, did) = project(&s, &ann).await;
    let doc = format!("/documents/{did}");

    // The first save keeps a version by itself; the next one within half an hour does not
    s.ok(&ann, "PUT", &doc, Some(flow_doc(&pid, &did, "First"))).await;
    s.ok(&ann, "PUT", &doc, Some(flow_doc(&pid, &did, "Second"))).await;
    let versions = s.ok(&ann, "GET", &format!("{doc}/versions"), None).await;
    assert_eq!(versions.as_array().unwrap().len(), 1);
    assert_eq!((versions[0]["name"].as_str(), versions[0]["createdBy"].as_str()), (None, Some("Ann")));

    // One kept by hand, with a name; it has the board as it is now
    let named = s.ok(&ann, "POST", &format!("{doc}/versions"), Some(json!({ "name": "Before the review" }))).await;
    assert_eq!(named["name"], "Before the review");
    let v = s.ok(&ann, "GET", &format!("{doc}/versions/{}", named["id"].as_str().unwrap()), None).await;
    assert_eq!(v["content"]["data"]["nodes"][0]["text"], "Second");
    assert_eq!(s.status(&ann, "POST", &format!("{doc}/versions"), Some(json!({ "name": "  " }))).await, StatusCode::BAD_REQUEST);
    // Not for someone without access
    assert_eq!(s.status(&bob, "GET", &format!("{doc}/versions"), None).await, StatusCode::NOT_FOUND);

    // A template from the board, then a new board from it
    let t = s.ok(&ann, "POST", "/templates", Some(json!({ "name": "My flow", "documentId": did }))).await;
    assert_eq!((t["name"].as_str(), t["kind"].as_str()), (Some("My flow"), Some("flow")));
    let full = s.ok(&ann, "GET", &format!("/templates/{}", t["id"].as_str().unwrap()), None).await;
    let made = s
        .ok(&ann, "POST", &format!("/projects/{pid}/documents"), Some(json!({ "folderId": null, "name": "Copy", "kind": "flow", "content": full["content"] })))
        .await;
    let copy = s.ok(&ann, "GET", &format!("/documents/{}", made["id"].as_str().unwrap()), None).await;
    assert_eq!(copy["content"]["data"]["nodes"][0]["text"], "Second");
    // Content of another kind is refused
    assert_eq!(
        s.status(&ann, "POST", &format!("/projects/{pid}/documents"), Some(json!({ "folderId": null, "name": "X", "kind": "text", "content": full["content"] }))).await,
        StatusCode::BAD_REQUEST
    );
    // Templates are one's own; Bob cannot make one from a board he cannot see
    assert_eq!(s.ok(&bob, "GET", "/templates", None).await, json!([]));
    assert_eq!(s.status(&bob, "GET", &format!("/templates/{}", t["id"].as_str().unwrap()), None).await, StatusCode::NOT_FOUND);
    assert_eq!(s.status(&bob, "POST", "/templates", Some(json!({ "name": "Mine", "documentId": did }))).await, StatusCode::NOT_FOUND);
    s.ok(&ann, "DELETE", &format!("/templates/{}", t["id"].as_str().unwrap()), None).await;
    assert_eq!(s.ok(&ann, "GET", "/templates", None).await, json!([]));
}

#[sqlx::test(migrations = "./migrations")]
async fn images(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let bob = s.register("bob@example.com", "Bob").await;
    let (pid, did) = project(&s, &ann).await;
    let upload = |who: &As, doc: &str, mime: &str, body: Vec<u8>| {
        let mut req = Request::builder()
            .method("POST")
            .uri(format!("/api/documents/{doc}/files"))
            .header("content-type", mime)
            .header("x-file-name", "my%20photo.png")
            .header("x-flow", "1");
        if let Some(t) = &who.token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let app = s.app.clone();
        async move {
            let res = app.oneshot(req.body(Body::from(body)).unwrap()).await.unwrap();
            let status = res.status();
            let v: Value = serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap_or(Value::Null);
            (status, v)
        }
    };
    let png = vec![0x89, b'P', b'N', b'G', 1, 2, 3];
    let (status, file) = upload(&ann, &did, "image/png", png.clone()).await;
    assert_eq!(status, StatusCode::OK, "{file}");
    assert_eq!(file["name"], "my photo.png");
    let id = file["id"].as_str().unwrap().to_string();

    // Ann gets it back as it was; Bob, who cannot see the board, does not
    let req = Request::builder().uri(format!("/api/files/{id}")).header("authorization", format!("Bearer {}", ann.token.as_ref().unwrap())).body(Body::empty()).unwrap();
    let res = s.app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.headers()["content-type"], "image/png");
    assert_eq!(res.into_body().collect().await.unwrap().to_bytes().to_vec(), png);
    assert_eq!(s.status(&bob, "GET", &format!("/files/{id}"), None).await, StatusCode::NOT_FOUND);

    // No SVG (scripts), nothing empty, not on a board Bob cannot edit
    assert_eq!(upload(&ann, &did, "image/svg+xml", b"<svg/>".to_vec()).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(upload(&ann, &did, "image/png", vec![]).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(upload(&bob, &did, "image/png", png.clone()).await.0, StatusCode::NOT_FOUND);

    // Pasted on another board: a copy that belongs to that board
    let other = s.ok(&ann, "POST", &format!("/projects/{pid}/documents"), Some(json!({ "folderId": null, "name": "Other", "kind": "flow" }))).await;
    let copied = s.ok(&ann, "POST", &format!("/files/{id}/copy"), Some(json!({ "documentId": other["id"] }))).await;
    assert_ne!(copied["id"], file["id"]);
    s.ok(&ann, "DELETE", &format!("/documents/{did}"), None).await;
    assert_eq!(s.status(&ann, "GET", &format!("/files/{id}"), None).await, StatusCode::NOT_FOUND, "gone with its board");
    assert_eq!(s.status(&ann, "GET", &format!("/files/{}", copied["id"].as_str().unwrap()), None).await, StatusCode::OK);
}

#[sqlx::test(migrations = "./migrations")]
async fn trash_stars_recent(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let (pid, did) = project(&s, &ann).await;
    let doc = format!("/documents/{did}");

    // Opened and starred
    s.ok(&ann, "POST", &format!("{doc}/opened"), Some(json!({}))).await;
    assert_eq!(s.ok(&ann, "GET", "/recent", None).await[0]["documentId"], did.as_str());
    s.ok(&ann, "PUT", &format!("/stars/{did}"), Some(json!({ "kind": "document" }))).await;
    s.ok(&ann, "PUT", &format!("/stars/{pid}"), Some(json!({ "kind": "project" }))).await;
    assert_eq!(s.ok(&ann, "GET", "/stars", None).await.as_array().unwrap().len(), 2);
    s.ok(&ann, "DELETE", &format!("/stars/{pid}"), None).await;
    assert_eq!(s.ok(&ann, "GET", "/stars", None).await, json!([{ "itemId": did, "kind": "document" }]));

    // Deleting a board puts it in the trash: gone everywhere, back with restore
    s.ok(&ann, "DELETE", &doc, None).await;
    assert_eq!(s.status(&ann, "GET", &doc, None).await, StatusCode::NOT_FOUND);
    assert_eq!(s.ok(&ann, "GET", &format!("/projects/{pid}/documents"), None).await, json!([]));
    assert_eq!(s.ok(&ann, "GET", "/recent", None).await, json!([]));
    let trash = s.ok(&ann, "GET", "/trash", None).await;
    assert_eq!((trash[0]["id"].as_str(), trash[0]["kind"].as_str(), trash[0]["projectName"].as_str()), (Some(did.as_str()), Some("document"), Some("Shop")));
    s.ok(&ann, "POST", &format!("/trash/{did}/restore"), Some(json!({}))).await;
    s.ok(&ann, "GET", &doc, None).await;
    assert_eq!(s.ok(&ann, "GET", "/trash", None).await, json!([]));

    // Someone else cannot see or restore Ann's trash
    let bob = s.register("bob@example.com", "Bob").await;
    s.ok(&ann, "DELETE", &doc, None).await;
    assert_eq!(s.ok(&bob, "GET", "/trash", None).await, json!([]));
    assert_eq!(s.status(&bob, "POST", &format!("/trash/{did}/restore"), Some(json!({}))).await, StatusCode::NOT_FOUND);
    // Deleted for good
    s.ok(&ann, "DELETE", &format!("/trash/{did}"), None).await;
    assert_eq!(s.status(&ann, "POST", &format!("/trash/{did}/restore"), Some(json!({}))).await, StatusCode::NOT_FOUND);

    // A project too, for its owner
    s.ok(&ann, "DELETE", &format!("/projects/{pid}"), None).await;
    assert_eq!(s.ok(&ann, "GET", "/projects", None).await, json!([]));
    assert_eq!(s.ok(&ann, "GET", "/trash", None).await[0]["kind"], "project");
    s.ok(&ann, "POST", &format!("/trash/{pid}/restore"), Some(json!({}))).await;
    assert_eq!(s.ok(&ann, "GET", "/projects", None).await[0]["id"], pid.as_str());
}

#[sqlx::test(migrations = "./migrations")]
async fn search_inside_boards(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let (pid, did) = project(&s, &ann).await;
    s.ok(&ann, "PUT", &format!("/documents/{did}"), Some(flow_doc(&pid, &did, "Check the stock levels"))).await;

    let hits = s.ok(&ann, "GET", "/search?q=STOCK", None).await;
    assert_eq!((hits[0]["documentId"].as_str(), hits[0]["snippet"].as_str()), (Some(did.as_str()), Some("Check the stock levels")));
    // Too short, no match, % taken literally
    assert_eq!(s.ok(&ann, "GET", "/search?q=s", None).await, json!([]));
    assert_eq!(s.ok(&ann, "GET", "/search?q=nothing%20like%20it", None).await, json!([]));
    assert_eq!(s.ok(&ann, "GET", "/search?q=%25", None).await, json!([]));
    // Not for someone without access, nor once it is in the trash
    let bob = s.register("bob@example.com", "Bob").await;
    assert_eq!(s.ok(&bob, "GET", "/search?q=stock", None).await, json!([]));
    s.ok(&ann, "DELETE", &format!("/documents/{did}"), None).await;
    assert_eq!(s.ok(&ann, "GET", "/search?q=stock", None).await, json!([]));
}

#[sqlx::test(migrations = "./migrations")]
async fn sign_up_limit_per_address(pool: PgPool) {
    let s = Server::new(pool);
    // Behind the (trusted) proxy: the address is the first in X-Forwarded-For
    let sign_up = |n: usize, ip: &'static str| {
        let req = Request::builder()
            .method("POST")
            .uri("/api/auth/register")
            .header("content-type", "application/json")
            .header("x-forwarded-for", format!("{ip}, 10.0.0.1"))
            .body(Body::from(json!({ "email": format!("user{n}@example.com"), "name": "U", "password": "correct horse" }).to_string()))
            .unwrap();
        s.app.clone().oneshot(req)
    };
    for n in 0..10 {
        assert_eq!(sign_up(n, "203.0.113.7").await.unwrap().status(), StatusCode::OK, "sign-up {n}");
    }
    assert_eq!(sign_up(10, "203.0.113.7").await.unwrap().status(), StatusCode::TOO_MANY_REQUESTS);
    // Someone else is not affected
    assert_eq!(sign_up(11, "198.51.100.2").await.unwrap().status(), StatusCode::OK);
}

/// Bob (in the project) and Cy (not) are mentioned: only Bob hears of it, in his
/// inbox and by mail; Ann hears of Bob's answer; the project's activity tells it all.
#[sqlx::test(migrations = "./migrations")]
async fn mentions_inbox_activity(pool: PgPool) {
    let s = Server::new(pool);
    let ann = s.register("ann@example.com", "Ann").await;
    let bob = s.register("bob@example.com", "Bob").await;
    let cy = s.register("cy@example.com", "Cy").await;
    let (pid, did) = project(&s, &ann).await;
    let doc = format!("/documents/{did}");
    s.ok(&ann, "POST", &format!("/projects/{pid}/invites"), Some(json!({ "email": "bob@example.com", "role": "editor" }))).await;
    let verify = s.link_token("bob@example.com", "/verify/");
    s.ok(&As::default(), "POST", "/auth/verify", Some(json!({ "token": verify }))).await;
    let mine = s.ok(&bob, "GET", "/invites/mine", None).await;
    s.ok(&bob, "POST", "/invites/respond", Some(json!({ "id": mine[0]["id"], "accept": true }))).await;
    let id_of = |v: Value| v["user"]["id"].as_str().unwrap().to_string();
    let (bob_id, cy_id) = (id_of(s.ok(&bob, "GET", "/auth/me", None).await), id_of(s.ok(&cy, "GET", "/auth/me", None).await));

    let body = format!("@[Bob]({bob_id}) and @[Cy]({cy_id}): is this right?");
    let thread = s.ok(&ann, "POST", &format!("{doc}/comments"), Some(json!({ "body": body, "anchor": { "kind": "node", "id": "n" } }))).await;
    let inbox = s.ok(&bob, "GET", "/inbox", None).await;
    assert_eq!(inbox["unread"], 1);
    assert_eq!((inbox["items"][0]["kind"].as_str(), inbox["items"][0]["actor"].as_str()), (Some("mention"), Some("Ann")));
    assert_eq!(inbox["items"][0]["excerpt"], "@Bob and @Cy: is this right?");
    assert_eq!(inbox["items"][0]["documentName"], "Flow");
    assert!(s.state.mailer.sent().iter().any(|m| m.to == "bob@example.com" && m.subject == "Ann mentioned you on Flow"));
    // Cy cannot see the board: nothing for him
    assert_eq!(s.ok(&cy, "GET", "/inbox", None).await["unread"], 0);
    assert!(!s.state.mailer.sent().iter().any(|m| m.to == "cy@example.com" && m.subject.contains("mentioned")));

    // Bob answers: Ann hears of it (not Bob himself)
    s.ok(&bob, "POST", &format!("{doc}/comments"), Some(json!({ "body": "Yes", "parentId": thread["id"] }))).await;
    let inbox = s.ok(&ann, "GET", "/inbox", None).await;
    assert_eq!((inbox["unread"].as_u64(), inbox["items"][0]["kind"].as_str()), (Some(1), Some("reply")));
    assert_eq!(s.ok(&bob, "GET", "/inbox", None).await["unread"], 1);
    // Read
    s.ok(&bob, "PUT", "/inbox/read", Some(json!({}))).await;
    assert_eq!(s.ok(&bob, "GET", "/inbox", None).await["unread"], 0);

    // Activity: edits close together are one entry; renames keep the old name
    s.ok(&bob, "PUT", &doc, Some(flow_doc(&pid, &did, "one"))).await;
    s.ok(&bob, "PUT", &doc, Some(flow_doc(&pid, &did, "two"))).await;
    s.ok(&ann, "PUT", &format!("{doc}/name"), Some(json!({ "name": "Order flow" }))).await;
    let feed = s.ok(&ann, "GET", &format!("/projects/{pid}/activity"), None).await;
    let kinds: Vec<&str> = feed.as_array().unwrap().iter().map(|a| a["kind"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["renamed", "edited", "commented", "commented", "joined", "created"]);
    assert_eq!((feed[0]["detail"].as_str(), feed[0]["documentName"].as_str()), (Some("Flow"), Some("Order flow")));
    assert_eq!((feed[1]["actor"].as_str(), feed[1]["count"].as_u64()), (Some("Bob"), Some(2)));
    // Not for someone outside the project
    assert_eq!(s.status(&cy, "GET", &format!("/projects/{pid}/activity"), None).await, StatusCode::NOT_FOUND);
}
