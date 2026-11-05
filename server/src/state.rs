//! What every handler gets: the database, the settings, the mailer.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

use crate::config::Config;
use crate::mail::Mailer;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub mailer: Arc<Mailer>,
    pub http: reqwest::Client,
    pub limits: Arc<RateLimits>,
    /// Boards being edited together right now
    pub rooms: Arc<crate::collab::Rooms>,
    /// Live notices to people's apps (project and access changes)
    pub events: Arc<crate::events::Events>,
}

impl AppState {
    /// Connects to the database and brings its tables up to date.
    pub async fn connect(config: Config) -> Result<AppState, String> {
        let db = PgPoolOptions::new().max_connections(20).connect(&config.database_url).await.map_err(|e| format!("cannot connect to the database: {e}"))?;
        sqlx::migrate!("./migrations").run(&db).await.map_err(|e| format!("cannot update the database: {e}"))?;
        let mailer = Mailer::from_config(&config)?;
        Ok(AppState::new(db, config, mailer))
    }

    pub fn new(db: PgPool, config: Config, mailer: Mailer) -> AppState {
        AppState {
            db,
            config: Arc::new(config),
            mailer: Arc::new(mailer),
            http: reqwest::Client::new(),
            limits: Arc::new(RateLimits::default()),
            rooms: Arc::new(crate::collab::Rooms::default()),
            events: Arc::new(crate::events::Events::default()),
        }
    }

    pub fn link(&self, path: &str) -> String {
        format!("{}{path}", self.config.public_url)
    }
}

/// At most `MAX` tries per key (an email address) per window: against guessing passwords.
#[derive(Default)]
pub struct RateLimits(Mutex<HashMap<String, (u32, Instant)>>);

impl RateLimits {
    const MAX: u32 = 10;
    const WINDOW: Duration = Duration::from_secs(10 * 60);

    /// Counts a try; false when there were too many.
    pub fn allow(&self, key: &str) -> bool {
        let mut map = self.0.lock().unwrap();
        let now = Instant::now();
        map.retain(|_, (_, start)| now.duration_since(*start) < Self::WINDOW);
        let entry = map.entry(key.to_string()).or_insert((0, now));
        entry.0 += 1;
        entry.0 <= Self::MAX
    }
}
