//! A chart board: a small table of data and how it is drawn. The app draws it
//! (src/lib/chart/); `svg` keeps the last drawing, which exports and the chart
//! blocks on other boards use, so Rust never draws charts itself.

use serde::{Deserialize, Serialize};
use specta::Type;

/// How the data is drawn (see src/lib/chart/ for the rules of each).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ChartType {
    /// Vertical bars, one group per row
    #[default]
    Column,
    /// Horizontal bars (long or many labels)
    Bar,
    /// Vertical bars with the series stacked
    Stacked,
    /// A line per series (trend over the rows, in order)
    Line,
    /// One series as a line with a wash under it
    Area,
    /// Dots: the row label is x (a number), each series a y
    Scatter,
    /// One whole split into parts: the first series, as one segmented bar
    Share,
}

/// A column of the table: one series (a line, a set of bars).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChartSeries {
    pub id: String,
    pub name: String,
}

/// A row of the table: its label and a value per series (empty cells are none).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChartRow {
    pub id: String,
    pub label: String,
    pub values: Vec<Option<f64>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChartDoc {
    pub chart: ChartType,
    pub title: String,
    pub series: Vec<ChartSeries>,
    pub rows: Vec<ChartRow>,
    /// What the axes show (e.g. "Month", "Revenue (€)")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub x_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub y_label: Option<String>,
    /// The series the story is about: drawn in the accent, the others in gray
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub focal: Option<String>,
    /// The chart as last drawn by the app (light, 640×400), for exports and chart blocks
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub svg: Option<String>,
}
