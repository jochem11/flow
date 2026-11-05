//! Text document (notes, specs, ...) written in markdown.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TextDoc {
    pub markdown: String,
}
