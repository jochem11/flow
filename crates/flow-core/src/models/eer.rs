//! EER diagram: entities (tables) with attributes (columns), and relations
//! (foreign keys) between them. `commands/eer.rs` turns it into SQL.

use serde::{Deserialize, Serialize};
use specta::Type;

use super::{Camera, NodeColor};

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EerDoc {
    pub entities: Vec<Entity>,
    pub relations: Vec<Relation>,
    /// Frames to group tables in; only for the picture (the SQL does not use them)
    #[serde(default)]
    pub sections: Vec<EerSection>,
    pub camera: Camera,
}

/// A titled frame around tables. What lies inside it moves along with it: tables
/// whose center is inside, and sections that fit in completely.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EerSection {
    pub id: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub color: Option<NodeColor>,
    /// A color of one's own (`#rrggbb`, from the color wheel): used instead of `color`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub tint: Option<String>,
}

/// A table.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Entity {
    pub id: String,
    pub name: String,
    /// Top-left corner in world coordinates
    pub x: f64,
    pub y: f64,
    pub attributes: Vec<Attribute>,
    /// Header color; missing means white
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub color: Option<NodeColor>,
    /// A color of one's own (`#rrggbb`, from the color wheel): used instead of `color`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub tint: Option<String>,
    /// Written to the SQL as a comment above the table
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub comment: Option<String>,
    /// Indexes on its columns (the primary key and unique columns have their own)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[specta(optional)]
    pub indexes: Vec<TableIndex>,
}

/// An index on one or more columns of a table.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableIndex {
    pub id: String,
    /// Made from the table and columns when empty: `idx_orders_customer_id`
    #[serde(default)]
    pub name: String,
    /// Attribute ids, in index order
    pub columns: Vec<String>,
    #[serde(default)]
    pub unique: bool,
}

/// A column.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Attribute {
    pub id: String,
    pub name: String,
    pub data_type: DataType,
    /// Length for `Char` / `Varchar`, precision for `Decimal`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub length: Option<u32>,
    /// Digits after the decimal point, for `Decimal`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub scale: Option<u32>,
    pub primary_key: bool,
    pub nullable: bool,
    #[serde(default)]
    pub unique: bool,
    /// Numbered by the database (identity / auto increment / serial)
    #[serde(default)]
    pub auto_increment: bool,
    /// As written in SQL: `0`, `'open'`, `CURRENT_TIMESTAMP`. Plain text is quoted on export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub default_value: Option<String>,
}

/// Column types, translated per database on export.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum DataType {
    SmallInt,
    Int,
    BigInt,
    Decimal,
    Float,
    Boolean,
    Char,
    Varchar,
    Text,
    Date,
    Time,
    DateTime,
    /// Date and time with time zone
    Timestamp,
    Uuid,
    Json,
    Blob,
}

/// A relation between two tables: `from` holds the foreign key to `to`,
/// e.g. Order (many) ── Customer (one).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    /// The table with the foreign key
    pub from: String,
    /// The referenced table
    pub to: String,
    /// How many `from` rows belong to one `to` row (drawn at the `from` end)
    pub from_cardinality: Cardinality,
    /// How many `to` rows belong to one `from` row (drawn at the `to` end)
    pub to_cardinality: Cardinality,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub label: Option<String>,
    /// The join: foreign key columns in `from` and the columns they reference in `to`.
    /// Not used when both sides are many: that becomes a junction table.
    #[serde(default)]
    pub columns: Vec<ColumnPair>,
    #[serde(default)]
    pub on_delete: RefAction,
    #[serde(default)]
    pub on_update: RefAction,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnPair {
    /// Attribute id in the `from` table
    pub from: String,
    /// Attribute id in the `to` table
    pub to: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Cardinality {
    /// exactly 1
    One,
    /// 0 or 1
    ZeroOrOne,
    /// 0 or more
    Many,
    /// 1 or more
    OneOrMany,
}

impl Cardinality {
    pub fn is_many(self) -> bool {
        matches!(self, Self::Many | Self::OneOrMany)
    }
}

/// What happens to the foreign key when the referenced row is deleted or updated.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum RefAction {
    #[default]
    NoAction,
    Restrict,
    Cascade,
    SetNull,
    SetDefault,
}

/// The databases SQL can be generated for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum SqlDialect {
    Postgres,
    Mysql,
    Sqlite,
    SqlServer,
    Oracle,
}

/// What `import_sql` read from SQL: new tables (already laid out from (0, 0)),
/// the relations between them, and notes on what it could not use.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SqlImport {
    pub entities: Vec<Entity>,
    pub relations: Vec<Relation>,
    /// Groups of tables (DBML's `TableGroup`), already around their tables
    #[serde(default)]
    pub sections: Vec<EerSection>,
    pub skipped: Vec<String>,
}
