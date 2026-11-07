//! Account settings: the devices someone is logged in on.

use serde::{Deserialize, Serialize};
use specta::Type;

/// A login on some device or browser.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountSession {
    /// Not the secret itself: enough to name it when logging it out
    pub id: String,
    /// The browser or app, as it said
    pub user_agent: Option<String>,
    #[specta(type = f64)]
    pub created_at: i64,
    /// This one (the device asking)
    pub current: bool,
}
