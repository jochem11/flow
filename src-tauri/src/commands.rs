//! De Tauri commands die de frontend aanroept.
//!
//! Elk command heeft `#[specta::specta]`, zodat er een getypte functie voor
//! in `src/bindings.ts` komt (`list_boards` wordt `commands.listBoards()`).
//! Nieuw command? Ook toevoegen aan `collect_commands!` in lib.rs.
//!
//! Alles staat nog op "niet geïmplementeerd". De frontend vangt de foutmeldingen
//! netjes op en laat ze zien, dus je kunt ze één voor één invullen en meteen
//! testen met `npm run tauri dev`.
//!
//! Een `Err(String)` komt in TypeScript binnen als `{ status: "error", error }`;
//! `src/lib/api.ts` maakt daar een gewone exception van.

#![allow(unused_variables)]

use tauri::AppHandle;

use crate::models::{Board, BoardMeta, Edge, ExportFormat, Node, Position};

type CmdResult<T> = Result<T, String>;

fn todo(name: &str) -> String {
    format!("`{name}` is nog niet geïmplementeerd (src-tauri/src/commands.rs)")
}

// ---------------------------------------------------------------------------
// Opslag
//
// Idee: één JSON-bestand per bord in de app-datamap.
//   let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("boards");
//   std::fs::create_dir_all(&dir)
//   pad = dir.join(format!("{id}.json"))
//
// Let op: `id` komt van buitenaf. Controleer dat het geen `/` of `..` bevat
// voordat je er een pad van maakt.
//
// Later kun je dit vervangen door SQLite (rusqlite / sqlx) zonder dat de
// frontend iets merkt.
// ---------------------------------------------------------------------------

/// Alle borden, nieuwste eerst. Wordt aangeroepen bij opstarten en bij het openen van het menu.
#[tauri::command]
#[specta::specta]
pub fn list_boards(app: AppHandle) -> CmdResult<Vec<BoardMeta>> {
    Err(todo("list_boards"))
}

#[tauri::command]
#[specta::specta]
pub fn load_board(app: AppHandle, id: String) -> CmdResult<Board> {
    Err(todo("load_board"))
}

/// Wordt ~800ms na elke wijziging aangeroepen (autosave). Vul hier `updated_at` in.
/// Tip: schrijf eerst naar `{id}.json.tmp` en hernoem dan, zodat een crash
/// halverwege nooit een kapot bestand achterlaat.
#[tauri::command]
#[specta::specta]
pub fn save_board(app: AppHandle, board: Board) -> CmdResult<()> {
    Err(todo("save_board"))
}

#[tauri::command]
#[specta::specta]
pub fn delete_board(app: AppHandle, id: String) -> CmdResult<()> {
    Err(todo("delete_board"))
}

// ---------------------------------------------------------------------------
// Auto-layout (knop "Ordenen")
//
// Krijgt alle nodes en pijlen, geeft voor (een deel van) de nodes een nieuwe
// positie terug. Nodes die je niet teruggeeft blijven staan.
//
// Simpele versie die al goed werkt voor flowcharts (gelaagde layout):
//   1. Zoek de startnodes (geen inkomende pijlen).
//   2. BFS: laag van een node = langste pad vanaf een start.
//      Pas op voor cycli (bijv. feedback-lussen): negeer pijlen naar een
//      node die je al hebt bezocht.
//   3. y = laag * (max hoogte + tussenruimte)
//   4. Binnen een laag: zet nodes naast elkaar, gecentreerd rond x = 0.
//   5. Bonus: sorteer binnen een laag op gemiddelde x van de ouders, zodat
//      pijlen minder kruisen.
// Notities (NodeKind::Note) kun je overslaan.
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub fn auto_layout(nodes: Vec<Node>, edges: Vec<Edge>) -> CmdResult<Vec<Position>> {
    Err(todo("auto_layout"))
}

// ---------------------------------------------------------------------------
// Export (menu "Exporteren")
//
// Geef het pad terug van het bestand dat je hebt geschreven; de frontend laat
// dat zien. Bijvoorbeeld in de Downloads-map:
//   app.path().download_dir()
//
// - Mermaid: tekst bouwen, bijv.
//     flowchart TD
//       a["Start"] --> b["Idee uitwerken"]
//       c{"Goedgekeurd?"} -->|Ja| d["Bouwen"]
//   Vorm per NodeKind: box ["…"], diamond {"…"}, pill (["…"]).
// - SVG: zelf de string opbouwen. Bereken eerst de bounding box van alle
//   nodes, dan per node een <rect>/<polygon> + <text>, per pijl een <path>.
// - PNG: render je eigen SVG met de `resvg` crate naar een pixmap en sla die op.
// ---------------------------------------------------------------------------

#[tauri::command]
#[specta::specta]
pub fn export_board(app: AppHandle, board: Board, format: ExportFormat) -> CmdResult<String> {
    Err(todo(match format {
        ExportFormat::Svg => "export_board (svg)",
        ExportFormat::Png => "export_board (png)",
        ExportFormat::Mermaid => "export_board (mermaid)",
    }))
}
