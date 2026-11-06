//! Flowchart: blocks (nodes) connected by arrows (edges) on a canvas.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FlowDoc {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub camera: Camera,
    /// Sequence diagrams: each call, the activation bar it starts and its return
    /// in a color of their own. Missing means off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub call_colors: Option<bool>,
    /// What the board is for: which tools, actions and exports it shows.
    /// Missing means `Whiteboard` (everything, as boards were before types).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub diagram: Option<DiagramType>,
    /// Class diagrams: the programming language the classes are for. Their types are
    /// shown as it writes them and offered from its built-in types; they are stored
    /// language-neutral (see fixtures/types.json). Missing means UML-neutral.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub code_language: Option<CodeLanguage>,
    /// Class diagrams: which rows the classes show. Missing means all.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub class_detail: Option<ClassDetail>,
}

/// How much of each class a class diagram shows (the code export always has all).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ClassDetail {
    /// Every attribute and operation
    All,
    /// Only public ones (an operation without visibility counts as public)
    Public,
    /// Only the names of the classes
    Names,
}

/// The type of a flow board (see src/lib/boardTypes.ts for what each shows).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DiagramType {
    Flowchart,
    Mindmap,
    Sequence,
    Class,
    Usecase,
    Activity,
    State,
    Whiteboard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
    Box,
    Diamond,
    Note,
    Pill,
    /// Free text without a box
    Label,
    /// Start point: a filled circle
    Start,
    /// End point: a ringed circle
    End,
    /// Frame with a title (in `text`) around other nodes
    Section,
    /// Swimlane pool with a title (in `text`) and vertical `lanes` (columns)
    Lanes,

    // UML activity diagram
    /// Fork / join: a thick bar
    Bar,
    /// Flow final: a circle with a cross
    FlowFinal,
    /// Object node: a rectangle with square corners
    Object,
    /// Input or output pin: a small square on the border of an action
    Pin,
    /// Send signal: a rectangle with an arrow point on the right
    SendSignal,
    /// Accept event: a rectangle with a notch on the left
    ReceiveSignal,
    /// Time event: an hourglass with the name below
    TimeEvent,
    /// Connector or history state ("H", "H*"): a small circle with text
    Circle,
    /// UML note: a rectangle with a folded corner
    Comment,

    // UML use case diagram
    /// Stick figure with the name below
    Actor,
    /// Ellipse
    UseCase,
    /// System boundary: a frame with the system name at the top
    Boundary,

    // UML class diagram
    /// Class with compartments. In `text`, a line with only `--` starts the next
    /// compartment: name, then attributes, then operations.
    Class,
    /// Package: a frame with its name in a tab
    Package,

    // UML sequence diagram
    /// Lifeline: a head with the name and a dashed line below it
    Lifeline,
    /// Activation bar on a lifeline
    Activation,
    /// Combined fragment (alt, loop, opt, ...): a frame with the operator in a corner tag
    Fragment,
    /// Destruction of a lifeline: a cross
    Destroy,
    // Content
    /// A picture uploaded to the board (`image` is its file, `text` its name)
    Image,
    /// A line drawing from the icon set (`icon` has its shapes)
    Icon,
    /// A chart board shown on this board (`chart`: which, and its drawing)
    Chart,
    /// A mind map topic: joined to its subtopics, laid out as a tree to the right
    Topic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum NodeColor {
    White,
    Yellow,
    Green,
    Blue,
    Purple,
    Pink,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
    /// Top-left corner in world coordinates
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub text: String,
    pub color: NodeColor,
    /// The frame (section, swimlane, package, ...) this node belongs to: it moves
    /// along with that frame. Set when the node is added or dropped inside one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub parent: Option<String>,
    /// Only for `Lanes`, left to right. `w` is always the sum of their sizes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub lanes: Option<Vec<Lane>>,
    /// Cannot be moved, resized or deleted until unlocked (it can still be selected by clicking it)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub locked: Option<bool>,
    /// Only for `Image`: the id of its file on the server
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub image: Option<String>,
    /// Only for `Icon`: its shapes, in a 24×24 box, as the icon set has them:
    /// the element (`path`, `circle`, ...) and its attributes
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub icon: Option<Vec<(String, std::collections::BTreeMap<String, String>)>>,
    /// Only for `Chart`: the chart board it shows (a document id) and its drawing
    /// as last seen (refreshed when the board opens), so exports need nothing else
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub chart: Option<ChartBlock>,
    /// Only for `Lifeline`: a person (UML actor), drawn as a stick figure instead of a box
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub person: Option<bool>,
}

/// A chart board on another board.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChartBlock {
    pub document_id: String,
    /// Its drawing (an SVG, 640×400) when it was last refreshed
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub svg: Option<String>,
}

/// One lane of a swimlane pool.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Lane {
    pub id: String,
    pub title: String,
    /// Width of the lane
    pub size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum EdgeStyle {
    Curved,
    Straight,
    /// Horizontal and vertical segments only
    Elbow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum LinePattern {
    Solid,
    Dashed,
    Dotted,
}

/// What is drawn at one end of an edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum EdgeCap {
    None,
    /// Filled arrowhead
    Arrow,
    /// Open arrowhead (two lines): association, dependency, asynchronous message
    Open,
    /// Hollow triangle: generalization, realization
    Triangle,
    /// Filled diamond: composition
    Diamond,
    /// Hollow diamond: aggregation
    HollowDiamond,
    Dot,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub id: String,
    /// Node the edge starts at; empty when the start is free (see `from_point`)
    pub from: String,
    /// Node the edge ends at; empty when the end is free (see `to_point`)
    pub to: String,
    /// A start that is not attached to a node: a point on the canvas
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub from_point: Option<Point>,
    /// An end that is not attached to a node, like `from_point`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub to_point: Option<Point>,
    /// Where the edge leaves `from`, as an angle on its outline in degrees:
    /// 0 = middle of the right side, 45 = bottom-right corner, 90 = middle of the bottom.
    /// The angle is relative to the shape, so it stays on the same spot when the node is resized.
    /// Missing means the side facing the other node is picked automatically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub from_angle: Option<f64>,
    /// Where the edge enters `to`, like `from_angle`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub to_angle: Option<f64>,
    /// How far the middle of the line was dragged from where it would be, so its
    /// route changes while both ends stay where they are attached.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub bend: Option<Point>,
    /// A message in a sequence diagram: a horizontal line at this height below
    /// the top of `from`, between the lifelines (or onto their activation bars).
    /// Replaces the angles for this edge.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub message_y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub label: Option<String>,
    /// Missing means `Curved`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub style: Option<EdgeStyle>,
    /// Missing means `Solid`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub pattern: Option<LinePattern>,
    /// Missing means `None`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub start_cap: Option<EdgeCap>,
    /// Missing means `Arrow`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub end_cap: Option<EdgeCap>,
    /// Where the label sits along the edge, 0..1. Missing means the middle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub label_pos: Option<f64>,
    /// Missing means `On`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub label_side: Option<LabelSide>,
    /// Small text at the start of the edge, e.g. a multiplicity ("1", "0..*") or a role
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub start_label: Option<String>,
    /// Small text at the end of the edge, like `start_label`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub end_label: Option<String>,
}

/// Where an edge label sits relative to the line. On a vertical part of the
/// line, above means left and below means right.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum LabelSide {
    On,
    Above,
    Below,
}

/// A point on the canvas, in world coordinates.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The visible part of a canvas. Also used by EER diagrams.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl Default for Camera {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

/// Where Arrange puts a node: its new top-left corner, and for a section or
/// swimlane its new size (fitted around what is in it).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub id: String,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub w: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub h: Option<f64>,
    /// A swimlane's lane widths, left to right
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional)]
    pub lanes: Option<Vec<f64>>,
}

/// How a line between arranged nodes is attached after Arrange: its own route
/// (bend) is dropped, and it leaves and enters at these angles (none: the side
/// facing the other node). A line back up a flow (a loop) goes around a side.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EdgePorts {
    pub id: String,
    pub from_angle: Option<f64>,
    pub to_angle: Option<f64>,
}

/// The result of Arrange: the nodes that move, and the lines between them.
#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
pub struct Arranged {
    pub nodes: Vec<Position>,
    pub edges: Vec<EdgePorts>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Svg,
    Png,
    Mermaid,
    /// SQL from an EER diagram, for one of these databases
    Postgres,
    Mysql,
    Sqlite,
    SqlServer,
    Oracle,
    /// Code from the UML classes in a flowchart, in one of these languages
    TypeScript,
    Java,
    CSharp,
    Python,
    Kotlin,
    Rust,
    Go,
}

/// Languages the UML classes of a flowchart can be turned into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum CodeLanguage {
    TypeScript,
    Java,
    CSharp,
    Python,
    Kotlin,
    Rust,
    /// Go has no classes: structs with methods, embedding instead of inheritance
    Go,
}

/// One generated source file.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CodeFile {
    pub name: String,
    pub content: String,
}

/// What `import_code` read from source code: UML classes (laid out from (0, 0))
/// and the lines between them, the language it read, the package or namespace
/// it found, and notes on what it could not use.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CodeImport {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub language: CodeLanguage,
    pub package: Option<String>,
    pub skipped: Vec<String>,
}

/// Where an imported diagram came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ImportFormat {
    Mermaid,
    Drawio,
    Excalidraw,
}

/// What `import_diagram` read from a Mermaid diagram, a draw.io file or an
/// Excalidraw drawing: blocks (laid out from (0, 0)) and the lines between them,
/// the kind of board they are for, and notes on what it could not use. A Mermaid
/// ER diagram has tables instead (`eer`), for an EER board.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiagramImport {
    /// None when the text is none of these
    pub format: Option<ImportFormat>,
    pub diagram: Option<DiagramType>,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub eer: Option<super::SqlImport>,
    pub skipped: Vec<String>,
}
