//! Who is calling, and logging in.
//!
//! The web version keeps its session in an `HttpOnly` cookie; the desktop app
//! sends `Authorization: Bearer <token>`. A request with a cookie that changes
//! something must also carry the `X-Flow` header: another site cannot add that
//! header without our CORS permission, so it cannot act for a logged-in user.
//! Someone who opened a share link sends its token in `X-Flow-Share`; a guest
//! (no account) is recognised by the `flow_guest` cookie.

use argon2::Argon2;
use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};
use axum::extract::{ConnectInfo, FromRequestParts, Query, State};
use axum::Extension;
use std::net::SocketAddr;
use axum::http::request::Parts;
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{DateTime, Duration, Utc};
use flow_core::models::{Me, User};
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::{mail, tokens};

pub const SESSION_COOKIE: &str = "flow_session";
pub const GUEST_COOKIE: &str = "flow_guest";
const SESSION_DAYS: i64 = 30;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct UserRow {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub password_hash: Option<String>,
    pub google_sub: Option<String>,
    pub email_verified_at: Option<DateTime<Utc>>,
}

impl UserRow {
    pub fn public(&self) -> User {
        User { id: self.id.clone(), email: self.email.clone(), name: self.name.clone(), avatar_url: self.avatar_url.clone() }
    }
    pub fn me(&self) -> Me {
        Me { user: self.public(), email_verified: self.email_verified_at.is_some(), has_password: self.password_hash.is_some(), has_google: self.google_sub.is_some() }
    }
}

#[macro_export]
macro_rules! user_columns {
    () => {
        "id, email, name, avatar_url, password_hash, google_sub, email_verified_at"
    };
}

/// Whoever sent the request.
#[derive(Debug, Clone)]
pub struct Caller {
    pub user: Option<UserRow>,
    /// The session token, when logged in
    pub session: Option<String>,
    /// A guest who chose a name (no account)
    pub guest: Option<Guest>,
    /// The token of the share link the request came through
    pub share: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Guest {
    pub id: String,
    pub name: String,
}

impl Caller {
    /// The logged-in user, or 401.
    pub fn user(&self) -> ApiResult<&UserRow> {
        self.user.as_ref().ok_or_else(AppError::unauthorized)
    }
}

impl FromRequestParts<AppState> for Caller {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let bearer = parts.headers.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).map(str::to_string);
        let share = parts.headers.get("x-flow-share").and_then(|v| v.to_str().ok()).map(str::to_string);
        let jar = CookieJar::from_headers(&parts.headers);
        // Against cross-site requests: a change sent with a cookie needs our header
        let changes = !matches!(parts.method, Method::GET | Method::HEAD | Method::OPTIONS);
        let cookies = jar.get(SESSION_COOKIE).is_some() || jar.get(GUEST_COOKIE).is_some();
        if changes && bearer.is_none() && cookies && !parts.headers.contains_key("x-flow") {
            return Err(AppError::forbidden("Missing the X-Flow header"));
        }
        identify(state, &parts.headers, bearer, share).await
    }
}

/// Who is calling: from a bearer token (the desktop app) or the session cookie,
/// a guest cookie, and a share link token. The WebSocket gives the token and
/// share link in its address instead of headers (browsers cannot add headers there).
pub async fn identify(state: &AppState, headers: &HeaderMap, bearer: Option<String>, share: Option<String>) -> ApiResult<Caller> {
    let jar = CookieJar::from_headers(headers);
    let cookie = jar.get(SESSION_COOKIE).map(|c| c.value().to_string());
    let guest_cookie = jar.get(GUEST_COOKIE).map(|c| c.value().to_string());
    let session = bearer.or(cookie);
    let user = match &session {
        Some(token) => sqlx::query_as::<_, UserRow>(concat!(
            "SELECT ",
            user_columns!(),
            " FROM users WHERE id = (SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now())"
        ))
        .bind(tokens::hash(token))
        .fetch_optional(&state.db)
        .await?,
        None => None,
    };
    let guest = match (&user, guest_cookie) {
        (None, Some(id)) => sqlx::query_as::<_, Guest>("SELECT id, name FROM guests WHERE id = $1").bind(id).fetch_optional(&state.db).await?,
        _ => None,
    };
    Ok(Caller { session: user.as_ref().and(session), user, guest, share })
}

// ---------- passwords and sessions ----------

pub fn hash_password(password: &str) -> ApiResult<String> {
    Argon2::default().hash_password(password.as_bytes()).map(|h| h.to_string()).map_err(AppError::internal)
}

pub(crate) fn password_matches(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|h| Argon2::default().verify_password(password.as_bytes(), &h).is_ok())
}

/// A new session for the user; returns its token.
pub async fn create_session(state: &AppState, user_id: &str, user_agent: Option<&str>) -> ApiResult<String> {
    let token = tokens::random_token();
    sqlx::query("INSERT INTO sessions (token_hash, user_id, user_agent, expires_at) VALUES ($1, $2, $3, $4)")
        .bind(tokens::hash(&token))
        .bind(user_id)
        .bind(user_agent)
        .bind(Utc::now() + Duration::days(SESSION_DAYS))
        .execute(&state.db)
        .await?;
    Ok(token)
}

pub fn session_cookie(state: &AppState, token: String) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(state.config.secure_cookies())
        .max_age(time_days(SESSION_DAYS))
        .build()
}

fn time_days(days: i64) -> cookie::time::Duration {
    cookie::time::Duration::days(days)
}

/// What logging in returns. The desktop app (`X-Flow-Client: desktop`) also
/// gets the token, which it keeps itself; the web version only gets the cookie.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedIn {
    pub me: Me,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

fn is_desktop(headers: &HeaderMap) -> bool {
    headers.get("x-flow-client").and_then(|v| v.to_str().ok()) == Some("desktop")
}

fn user_agent(headers: &HeaderMap) -> Option<&str> {
    headers.get("user-agent").and_then(|v| v.to_str().ok())
}

/// Logs the user in: a session, as cookie and (desktop) as token.
async fn log_in(state: &AppState, headers: &HeaderMap, jar: CookieJar, user: &UserRow) -> ApiResult<(CookieJar, Json<LoggedIn>)> {
    let token = create_session(state, &user.id, user_agent(headers)).await?;
    let desktop = is_desktop(headers);
    let jar = if desktop { jar } else { jar.add(session_cookie(state, token.clone())) };
    Ok((jar, Json(LoggedIn { me: user.me(), token: desktop.then_some(token) })))
}

pub async fn user_by_email(state: &AppState, email: &str) -> ApiResult<Option<UserRow>> {
    Ok(sqlx::query_as::<_, UserRow>(concat!("SELECT ", user_columns!(), " FROM users WHERE email = $1")).bind(email.trim().to_lowercase()).fetch_optional(&state.db).await?)
}

pub(crate) async fn user_by_id(state: &AppState, id: &str) -> ApiResult<UserRow> {
    Ok(sqlx::query_as::<_, UserRow>(concat!("SELECT ", user_columns!(), " FROM users WHERE id = $1")).bind(id).fetch_one(&state.db).await?)
}

/// A one-time token (mail links, desktop login); returns it.
async fn one_time(state: &AppState, purpose: &str, user_id: &str, payload: Option<&str>, valid: Duration) -> ApiResult<String> {
    let token = tokens::random_token();
    sqlx::query("INSERT INTO one_time_tokens (token_hash, purpose, user_id, payload, expires_at) VALUES ($1, $2, $3, $4, $5)")
        .bind(tokens::hash(&token))
        .bind(purpose)
        .bind(user_id)
        .bind(payload)
        .bind(Utc::now() + valid)
        .execute(&state.db)
        .await?;
    Ok(token)
}

/// Uses up a one-time token: its user and payload, if it is valid.
async fn redeem(state: &AppState, purpose: &str, token: &str) -> ApiResult<(String, Option<String>)> {
    sqlx::query_as::<_, (String, Option<String>)>(
        "DELETE FROM one_time_tokens WHERE token_hash = $1 AND purpose = $2 AND expires_at > now() RETURNING user_id, payload",
    )
    .bind(tokens::hash(token))
    .bind(purpose)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::bad("This link has expired or was already used"))
}

pub(crate) async fn send_verification(state: &AppState, user: &UserRow) -> ApiResult<()> {
    let token = one_time(state, "verify", &user.id, None, Duration::days(2)).await?;
    state.mailer.send(mail::verify(&user.email, &user.name, &state.link(&format!("/verify/{token}")))).await;
    Ok(())
}

// ---------- routes ----------

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/register", post(register))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/me", get(me))
        .route("/auth/verify", post(verify))
        .route("/auth/resend-verification", post(resend_verification))
        .route("/auth/forgot", post(forgot))
        .route("/auth/reset", post(reset))
        .route("/auth/exchange", post(exchange))
        .route("/auth/google/start", get(google_start))
        .route("/auth/google/callback", get(google_callback))
        .route("/auth/providers", get(providers))
}

#[derive(Deserialize)]
struct Register {
    email: String,
    name: String,
    password: String,
}

pub(crate) fn check_password(password: &str) -> ApiResult<()> {
    if password.chars().count() < 8 {
        return Err(AppError::bad("Use a password of at least 8 characters"));
    }
    Ok(())
}

/// Where a request comes from (for rate limits): behind a trusted proxy the first
/// address in X-Forwarded-For, else the connection's. None in tests (no connection).
pub fn client_ip(state: &AppState, headers: &HeaderMap, conn: Option<SocketAddr>) -> Option<String> {
    if state.config.trust_proxy {
        let forwarded = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()).and_then(|v| v.split(',').next()).map(str::trim);
        if let Some(ip) = forwarded.filter(|ip| !ip.is_empty()) {
            return Some(ip.to_string());
        }
    }
    conn.map(|c| c.ip().to_string())
}

async fn register(
    State(state): State<AppState>,
    conn: Option<Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    jar: CookieJar,
    Json(r): Json<Register>,
) -> ApiResult<(CookieJar, Json<LoggedIn>)> {
    // Each sign-up sends a mail: not too many from one place (or Flow's mail account gets blocked)
    if let Some(ip) = client_ip(&state, &headers, conn.map(|Extension(ConnectInfo(addr))| addr)) {
        if !state.limits.allow(&format!("register:{ip}")) {
            return Err(AppError::new(StatusCode::TOO_MANY_REQUESTS, "Too many new accounts from here; try again in a few minutes"));
        }
    }
    let email = r.email.trim().to_lowercase();
    let name = r.name.trim();
    if !email.contains('@') || email.len() < 3 {
        return Err(AppError::bad("Enter a valid email address"));
    }
    if name.is_empty() {
        return Err(AppError::bad("Enter your name"));
    }
    check_password(&r.password)?;
    if let Some(existing) = user_by_email(&state, &email).await? {
        let hint = if existing.google_sub.is_some() && existing.password_hash.is_none() { " Log in with Google instead." } else { " Log in instead." };
        return Err(AppError::conflict(format!("There is already an account with this email.{hint}")));
    }
    let user = sqlx::query_as::<_, UserRow>(concat!("INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4) RETURNING ", user_columns!()))
        .bind(tokens::new_id())
        .bind(&email)
        .bind(name)
        .bind(hash_password(&r.password)?)
        .fetch_one(&state.db)
        .await?;
    send_verification(&state, &user).await?;
    log_in(&state, &headers, jar, &user).await
}

#[derive(Deserialize)]
struct Login {
    email: String,
    password: String,
}

async fn login(State(state): State<AppState>, headers: HeaderMap, jar: CookieJar, Json(l): Json<Login>) -> ApiResult<(CookieJar, Json<LoggedIn>)> {
    let email = l.email.trim().to_lowercase();
    if !state.limits.allow(&format!("login:{email}")) {
        return Err(AppError::new(StatusCode::TOO_MANY_REQUESTS, "Too many attempts; try again in a few minutes"));
    }
    let user = user_by_email(&state, &email).await?;
    match user {
        Some(u) if u.password_hash.as_deref().is_some_and(|h| password_matches(&l.password, h)) => log_in(&state, &headers, jar, &u).await,
        Some(u) if u.password_hash.is_none() => Err(AppError::new(StatusCode::UNAUTHORIZED, "This account logs in with Google")),
        _ => Err(AppError::new(StatusCode::UNAUTHORIZED, "Wrong email or password")),
    }
}

async fn logout(State(state): State<AppState>, caller: Caller, jar: CookieJar) -> ApiResult<(CookieJar, StatusCode)> {
    if let Some(token) = &caller.session {
        sqlx::query("DELETE FROM sessions WHERE token_hash = $1").bind(tokens::hash(token)).execute(&state.db).await?;
    }
    Ok((jar.remove(Cookie::build(SESSION_COOKIE).path("/")), StatusCode::NO_CONTENT))
}

async fn me(caller: Caller) -> ApiResult<Json<Me>> {
    Ok(Json(caller.user()?.me()))
}

#[derive(Deserialize)]
struct TokenBody {
    token: String,
}

async fn verify(State(state): State<AppState>, Json(b): Json<TokenBody>) -> ApiResult<Json<Me>> {
    let (user_id, _) = redeem(&state, "verify", &b.token).await?;
    sqlx::query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1").bind(&user_id).execute(&state.db).await?;
    let user = user_by_id(&state, &user_id).await?;
    Ok(Json(user.me()))
}

async fn resend_verification(State(state): State<AppState>, caller: Caller) -> ApiResult<StatusCode> {
    let user = caller.user()?;
    if user.email_verified_at.is_none() {
        if !state.limits.allow(&format!("verify:{}", user.id)) {
            return Err(AppError::new(StatusCode::TOO_MANY_REQUESTS, "Too many mails; try again in a few minutes"));
        }
        send_verification(&state, user).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Forgot {
    email: String,
}

/// Always answers the same, so it does not tell who has an account.
async fn forgot(State(state): State<AppState>, Json(f): Json<Forgot>) -> ApiResult<StatusCode> {
    let email = f.email.trim().to_lowercase();
    if state.limits.allow(&format!("reset:{email}")) {
        if let Some(user) = user_by_email(&state, &email).await? {
            let token = one_time(&state, "reset", &user.id, None, Duration::hours(1)).await?;
            state.mailer.send(mail::reset(&user.email, &user.name, &state.link(&format!("/reset/{token}")))).await;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Reset {
    token: String,
    password: String,
}

/// A new password: logs out everywhere else, and logs in here. Having the
/// mail also proves the address.
async fn reset(State(state): State<AppState>, headers: HeaderMap, jar: CookieJar, Json(r): Json<Reset>) -> ApiResult<(CookieJar, Json<LoggedIn>)> {
    check_password(&r.password)?;
    let (user_id, _) = redeem(&state, "reset", &r.token).await?;
    sqlx::query("UPDATE users SET password_hash = $2, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1")
        .bind(&user_id)
        .bind(hash_password(&r.password)?)
        .execute(&state.db)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id = $1").bind(&user_id).execute(&state.db).await?;
    let user = user_by_id(&state, &user_id).await?;
    log_in(&state, &headers, jar, &user).await
}

/// The desktop app trades the one-time code from Google sign-in for its session token.
#[derive(Deserialize)]
struct Exchange {
    code: String,
}

async fn exchange(State(state): State<AppState>, Json(e): Json<Exchange>) -> ApiResult<Json<LoggedIn>> {
    let (user_id, token) = redeem(&state, "login", &e.code).await?;
    let user = user_by_id(&state, &user_id).await?;
    Ok(Json(LoggedIn { me: user.me(), token }))
}

/// Which ways of logging in this server offers.
async fn providers(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({ "google": state.config.google.is_some() }))
}

// ---------- Google ----------
// Authorization code flow with PKCE: we send people to Google with a random
// `state`; Google sends them back with a code, which we trade for their profile.

const GOOGLE_AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO: &str = "https://openidconnect.googleapis.com/v1/userinfo";

#[derive(Deserialize)]
struct GoogleStart {
    client: Option<String>,
    /// The desktop app's local port to come back to (see `start_login_listener`)
    port: Option<u16>,
}

fn google_redirect(state: &AppState) -> String {
    state.link("/api/auth/google/callback")
}

async fn google_start(State(state): State<AppState>, Query(q): Query<GoogleStart>) -> ApiResult<Redirect> {
    let google = state.config.google.as_ref().ok_or_else(|| AppError::not_found("Google sign-in"))?;
    // Where to go afterwards: the web version, the desktop app on a local port, or its link scheme
    let client = match (q.client.as_deref(), q.port) {
        (Some("desktop"), Some(port)) => format!("desktop:{port}"),
        (Some("desktop"), None) => "desktop".to_string(),
        _ => "web".to_string(),
    };
    let (oauth_state, verifier) = (tokens::random_token(), tokens::random_token());
    sqlx::query("DELETE FROM oauth_states WHERE created_at < now() - interval '10 minutes'").execute(&state.db).await?;
    sqlx::query("INSERT INTO oauth_states (state, verifier, client) VALUES ($1, $2, $3)").bind(&oauth_state).bind(&verifier).bind(&client).execute(&state.db).await?;
    let url = reqwest::Url::parse_with_params(
        GOOGLE_AUTH,
        &[
            ("client_id", google.client_id.as_str()),
            ("redirect_uri", &google_redirect(&state)),
            ("response_type", "code"),
            ("scope", "openid email profile"),
            ("state", &oauth_state),
            ("code_challenge", &tokens::pkce_challenge(&verifier)),
            ("code_challenge_method", "S256"),
            ("prompt", "select_account"),
        ],
    )
    .map_err(AppError::internal)?;
    Ok(Redirect::to(url.as_str()))
}

#[derive(Deserialize)]
struct GoogleBack {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct GoogleTokens {
    access_token: String,
}

#[derive(Deserialize)]
struct GoogleProfile {
    sub: String,
    email: String,
    #[serde(default)]
    email_verified: bool,
    name: Option<String>,
    picture: Option<String>,
}

async fn google_callback(State(state): State<AppState>, headers: HeaderMap, jar: CookieJar, Query(q): Query<GoogleBack>) -> Response {
    match google_finish(&state, &headers, jar, q).await {
        Ok(r) => r,
        Err(e) => Html(page("Signing in with Google failed", &format!("<p>{}</p><p><a href=\"/\">Back to Flow</a></p>", html_escape(&e.message)))).into_response(),
    }
}

async fn google_finish(state: &AppState, headers: &HeaderMap, jar: CookieJar, q: GoogleBack) -> ApiResult<Response> {
    let google = state.config.google.as_ref().ok_or_else(|| AppError::not_found("Google sign-in"))?;
    if let Some(e) = q.error {
        return Err(AppError::bad(format!("Google said: {e}")));
    }
    let (Some(code), Some(oauth_state)) = (q.code, q.state) else { return Err(AppError::bad("Google sent no code")) };
    let (verifier, client) = sqlx::query_as::<_, (String, String)>(
        "DELETE FROM oauth_states WHERE state = $1 AND created_at > now() - interval '10 minutes' RETURNING verifier, client",
    )
    .bind(&oauth_state)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::bad("This sign-in took too long or was already used; try again"))?;

    let tokens: GoogleTokens = state
        .http
        .post(GOOGLE_TOKEN)
        .form(&[
            ("code", code.as_str()),
            ("client_id", &google.client_id),
            ("client_secret", &google.client_secret),
            ("redirect_uri", &google_redirect(state)),
            ("grant_type", "authorization_code"),
            ("code_verifier", &verifier),
        ])
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| AppError::bad(format!("Google did not accept the sign-in: {e}")))?
        .json()
        .await
        .map_err(AppError::internal)?;
    let profile: GoogleProfile = state
        .http
        .get(GOOGLE_USERINFO)
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(AppError::internal)?
        .json()
        .await
        .map_err(AppError::internal)?;

    let user = google_user(state, profile).await?;
    let token = create_session(state, &user.id, user_agent(headers)).await?;
    if let Some(rest) = client.strip_prefix("desktop") {
        // Back to the app with a code that is only good once, for a short while
        let code = one_time(state, "login", &user.id, Some(&token), Duration::minutes(2)).await?;
        if let Some(port) = rest.strip_prefix(':').and_then(|p| p.parse::<u16>().ok()) {
            return Ok(Redirect::to(&format!("http://127.0.0.1:{port}/auth?code={code}")).into_response());
        }
        let link = format!("{}://auth?code={code}", state.config.desktop_scheme);
        let body = format!(
            "<p>You are signed in. Flow opens by itself; if it does not, <a href=\"{link}\">open Flow</a>.</p><script>location.href = {};</script>",
            serde_json::to_string(&link).unwrap_or_default()
        );
        return Ok(Html(page("Signed in", &body)).into_response());
    }
    Ok((jar.add(session_cookie(state, token)), Redirect::to("/")).into_response())
}

/// The account for a Google profile: found by Google id, else by (verified)
/// email, which then gets Google linked to it, else a new account.
async fn google_user(state: &AppState, p: GoogleProfile) -> ApiResult<UserRow> {
    if let Some(u) = sqlx::query_as::<_, UserRow>(concat!("SELECT ", user_columns!(), " FROM users WHERE google_sub = $1")).bind(&p.sub).fetch_optional(&state.db).await? {
        return Ok(u);
    }
    let email = p.email.trim().to_lowercase();
    if let Some(u) = user_by_email(state, &email).await? {
        if !p.email_verified {
            return Err(AppError::conflict("There is already an account with this email; log in with your password"));
        }
        return Ok(sqlx::query_as::<_, UserRow>(concat!("UPDATE users SET google_sub = $2, email_verified_at = coalesce(email_verified_at, now()), avatar_url = coalesce(avatar_url, $3) WHERE id = $1 RETURNING ", user_columns!()))
        .bind(&u.id)
        .bind(&p.sub)
        .bind(&p.picture)
        .fetch_one(&state.db)
        .await?);
    }
    let name = p.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| email.split('@').next().unwrap_or("").to_string());
    Ok(sqlx::query_as::<_, UserRow>(concat!("INSERT INTO users (id, email, name, avatar_url, google_sub, email_verified_at) VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() END) RETURNING ", user_columns!()))
    .bind(tokens::new_id())
    .bind(&email)
    .bind(name)
    .bind(&p.picture)
    .bind(&p.sub)
    .bind(p.email_verified)
    .fetch_one(&state.db)
    .await?)
}

pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// A small standalone page (sign-in results).
pub fn page(title: &str, body: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{t} – Flow</title>\
         <style>body{{font:15px system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#222}}a{{color:#5b4bdb}}</style></head>\
         <body><h2>{t}</h2>{body}</body></html>",
        t = html_escape(title)
    )
}
