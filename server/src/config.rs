//! Settings, all from environment variables (or a `.env` file next to the server):
//!
//!   DATABASE_URL       postgres://...                                      (required)
//!   PUBLIC_URL         where people reach the server, for links in mail    (http://localhost:8080)
//!   BIND               address to listen on                                (0.0.0.0:8080)
//!   WEB_DIR            the web build to serve (`npm run build` → dist)     (none: API only)
//!   ALLOWED_ORIGINS    other origins allowed to call the API, comma-separated
//!                      (the desktop app and the Vite dev server)
//!   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   Google sign-in               (none: off)
//!   SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, MAIL_FROM        sending mail
//!   MAIL_OUTBOX        a folder to write mails to instead (development)
//!   DESKTOP_SCHEME     the desktop app's link scheme                       (flowapp)
//!   TRUST_PROXY        1: behind a proxy (Caddy, a tunnel), the client's address
//!                      is the first in X-Forwarded-For (for rate limits)     (off)

use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub public_url: String,
    pub bind: String,
    pub web_dir: Option<PathBuf>,
    pub allowed_origins: Vec<String>,
    pub google: Option<Google>,
    pub smtp: Option<Smtp>,
    pub mail_from: String,
    pub mail_outbox: Option<PathBuf>,
    pub desktop_scheme: String,
    /// Read the client's address from X-Forwarded-For (only behind a proxy that sets it)
    pub trust_proxy: bool,
}

#[derive(Debug, Clone)]
pub struct Google {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone)]
pub struct Smtp {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
}

fn var(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let public_url = var("PUBLIC_URL").unwrap_or_else(|| "http://localhost:8080".into()).trim_end_matches('/').to_string();
        let google = match (var("GOOGLE_CLIENT_ID"), var("GOOGLE_CLIENT_SECRET")) {
            (Some(client_id), Some(client_secret)) => Some(Google { client_id, client_secret }),
            _ => None,
        };
        let smtp = var("SMTP_HOST").map(|host| Smtp {
            host,
            port: var("SMTP_PORT").and_then(|p| p.parse().ok()).unwrap_or(587),
            user: var("SMTP_USER").unwrap_or_default(),
            password: var("SMTP_PASSWORD").unwrap_or_default(),
        });
        let default_origins = "tauri://localhost,http://tauri.localhost,http://localhost:1420";
        Ok(Config {
            database_url: var("DATABASE_URL").ok_or("DATABASE_URL is not set")?,
            bind: var("BIND").unwrap_or_else(|| "0.0.0.0:8080".into()),
            web_dir: var("WEB_DIR").map(PathBuf::from),
            allowed_origins: var("ALLOWED_ORIGINS").unwrap_or_else(|| default_origins.into()).split(',').map(|o| o.trim().to_string()).filter(|o| !o.is_empty()).collect(),
            google,
            smtp,
            mail_from: var("MAIL_FROM").unwrap_or_else(|| "Flow <no-reply@localhost>".into()),
            mail_outbox: var("MAIL_OUTBOX").map(PathBuf::from),
            desktop_scheme: var("DESKTOP_SCHEME").unwrap_or_else(|| "flowapp".into()),
            trust_proxy: var("TRUST_PROXY").is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true")),
            public_url,
        })
    }

    /// Cookies only over HTTPS when the server is public over HTTPS.
    pub fn secure_cookies(&self) -> bool {
        self.public_url.starts_with("https://")
    }
}
