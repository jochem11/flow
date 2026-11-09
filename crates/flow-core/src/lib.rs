//! Flow's documents (`models`) and everything made from them, without any
//! dependency on the desktop app or the server, which both use this crate:
//!
//!   uml          UML class rows (read and laid out)
//!   eer          EER diagram → SQL (5 databases)          sql_import   SQL → EER diagram
//!   mermaid      any document → Mermaid                   flow         layout and export files
//!   flow_svg     flowchart → SVG (and PNG via `flow`)     import       Mermaid, draw.io, Excalidraw → board

pub mod arrange;
pub mod dbml;
pub mod eer;
pub mod flow;
pub mod flow_svg;
pub mod folders;
pub mod import;
pub mod mermaid;
pub mod models;
pub mod sql_import;
pub mod uml;
