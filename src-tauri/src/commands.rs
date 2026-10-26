//! De Tauri commands die de frontend aanroept.
//!
//! Elk command heeft `#[specta::specta]`, zodat er een getypte functie voor
//! in `src/bindings.ts` komt (`list_boards` wordt `commands.listBoards()`).
//! Nieuw command? Ook toevoegen aan `collect_commands!` in lib.rs.
//!
//! `load_board` is uitgewerkt als voorbeeld; de rest staat nog op "niet geïmplementeerd". De frontend vangt de foutmeldingen
//! netjes op en laat ze zien, dus je kunt ze één voor één invullen en meteen
//! testen met `npm run tauri dev`.
//!
//! Een `Err(String)` komt in TypeScript binnen als `{ status: "error", error }`;
//! `src/lib/api.ts` maakt daar een gewone exception van.

// Zolang niet alles af is, zijn er parameters die we nog niet gebruiken.
// Haal deze regel weg als alle commands klaar zijn.
#![allow(unused_variables)]

use std::path::PathBuf;

// `Manager` is een trait. Pas als die "in scope" is, kun je `app.path()` aanroepen.
// Traits zijn een beetje als interfaces: de methode bestaat al, maar je moet de
// trait importeren om hem te mogen gebruiken. rust-analyzer stelt dit vaak zelf voor.
use tauri::{AppHandle, Manager};

use crate::models::{Board, BoardMeta, Edge, ExportFormat, Node, Position};

type CmdResult<T> = Result<T, String>;

fn todo(name: &str) -> String {
    format!("`{name}` is nog niet geïmplementeerd (src-tauri/src/commands.rs)")
}

// ---------------------------------------------------------------------------
// Opslag: één JSON-bestand per bord in de app-datamap, bijvoorbeeld
//   Windows: C:\Users\<jij>\AppData\Roaming\nl.jochem.flowapp\boards\<id>.json
//   macOS:   ~/Library/Application Support/nl.jochem.flowapp/boards/<id>.json
//   Linux:   ~/.local/share/nl.jochem.flowapp/boards/<id>.json
//
// Later kun je dit vervangen door SQLite (rusqlite / sqlx) zonder dat de
// frontend iets merkt.
// ---------------------------------------------------------------------------

/// De map waar alle borden staan. Wordt aangemaakt als hij nog niet bestaat.
///
/// `&AppHandle`: we *lenen* de handle alleen even. De aanroeper houdt hem in bezit
/// en kan hem daarna gewoon nog gebruiken.
fn boards_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    // `app_data_dir()` geeft `Result<PathBuf, tauri::Error>` terug.
    // - `.map_err(...)` zet die tauri::Error om naar een String, omdat onze
    //   functie `Result<_, String>` teruggeeft. `|e| ...` is een closure (arrow function).
    // - `?` aan het eind: is het een Err, dan stopt de functie hier en geeft die
    //   fout terug. Is het Ok, dan pakt `?` de waarde eruit.
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("kan app-datamap niet vinden: {e}"))?
        .join("boards");

    // `&dir`: create_dir_all wil alleen even naar het pad kijken, dus we lenen het uit.
    // Zonder `&` zou `dir` "verhuizen" (move) naar create_dir_all en kunnen we hem
    // daarna niet meer teruggeven. Probeer het maar eens weg te halen: de compiler
    // legt precies uit wat er misgaat.
    std::fs::create_dir_all(&dir).map_err(|e| format!("kan map {} niet maken: {e}", dir.display()))?;

    // Laatste regel zonder `;` = de returnwaarde. `Ok(...)` betekent: gelukt.
    Ok(dir)
}

/// Controleert dat een id veilig is om als bestandsnaam te gebruiken.
///
/// Het id komt van de frontend, en dus in principe "van buitenaf". Zonder deze check
/// zou een id als `../../iets` buiten de borden-map kunnen schrijven of lezen.
/// De frontend maakt UUID's (letters, cijfers en `-`), dus dat is alles wat we toestaan.
///
/// `id: &str`: een geleende stukje tekst. Een `&String` past hier ook in, dus de
/// aanroeper kan gewoon `validate_id(&id)` doen.
fn validate_id(id: &str) -> CmdResult<()> {
    // `.chars()` geeft een iterator over de tekens, `.all(...)` checkt of de
    // closure voor elk teken `true` geeft. Net als `[...id].every(...)` in JS.
    let ok = !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');

    if ok {
        Ok(())
    } else {
        Err(format!("ongeldig bord-id: {id:?}"))
    }
}

/// Volledig pad naar het JSON-bestand van één bord.
fn board_path(app: &AppHandle, id: &str) -> CmdResult<PathBuf> {
    validate_id(id)?;
    Ok(boards_dir(app)?.join(format!("{id}.json")))
}

/// Alle borden, nieuwste eerst. Wordt aangeroepen bij opstarten en bij het openen van het menu.
///
// Jouw beurt! Stappen:
// 1. `std::fs::read_dir(boards_dir(&app)?)` geeft een iterator over de bestanden.
//    Elk item is zelf weer een `Result`, want lezen kan per bestand mislukken.
// 2. Sla bestanden over die niet op `.json` eindigen (`path.extension()`).
// 3. Lees en parse elk bestand naar een `Board`, net als in `load_board`.
//    Lukt dat niet (kapot bestand)? Sla het over met `continue` in plaats van
//    alles te laten falen. Tip: `let Ok(board) = ... else { continue };`
// 4. Maak een `BoardMeta { id, name, updated_at }` en push hem in een `Vec`.
//    `board.updated_at` is een `Option<u64>`: `.unwrap_or(0)` geeft 0 als hij leeg is.
// 5. Sorteer: `metas.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));`
#[tauri::command]
#[specta::specta]
pub fn list_boards(app: AppHandle) -> CmdResult<Vec<BoardMeta>> {
    Err(todo("list_boards"))
}

/// Laadt één bord.
///
/// `app: AppHandle` en `id: String` zijn "owned": deze functie krijgt ze in bezit.
/// Tauri maakt ze voor ons aan uit de aanroep vanuit TypeScript (`commands.loadBoard(id)`).
#[tauri::command]
#[specta::specta]
pub fn load_board(app: AppHandle, id: String) -> CmdResult<Board> {
    // `&app` en `&id`: uitlenen aan board_path. `&id` maakt van een `String` een `&str`.
    let path = board_path(&app, &id)?;

    // Bestand inlezen als tekst. Bestaat het niet? Dan krijg je een nette fout.
    // `path.display()` maakt het pad printbaar (paden zijn niet altijd geldige UTF-8).
    let json = std::fs::read_to_string(&path)
        .map_err(|e| format!("kan {} niet lezen: {e}", path.display()))?;

    // serde zet de JSON om naar onze `Board`-struct. Klopt de vorm niet
    // (veld mist, verkeerd type), dan zegt de fout precies welk veld en welke regel.
    // Het `: Board` vertelt serde naar welk type hij moet parsen.
    let board: Board = serde_json::from_str(&json)
        .map_err(|e| format!("bord {id} is beschadigd: {e}"))?;

    Ok(board)
}

/// Wordt ~800ms na elke wijziging aangeroepen (autosave).
///
// Jouw beurt! Stappen:
// 1. `let path = board_path(&app, &board.id)?;`
// 2. `updated_at` invullen. Hiervoor moet `board` aanpasbaar zijn: verander de
//    parameter in `mut board: Board`. Huidige tijd in ms:
//    `std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)` geeft een
//    Result met een Duration; `.as_millis() as u64` maakt er een getal van.
// 3. `serde_json::to_string_pretty(&board)` (pretty = leesbaar als je het bestand opent)
// 4. Schrijf eerst naar een tijdelijk bestand (`path.with_extension("json.tmp")`)
//    met `std::fs::write`, en hernoem het dan met `std::fs::rename`. Zo blijft er
//    nooit een half bestand achter als de app halverwege crasht.
#[tauri::command]
#[specta::specta]
pub fn save_board(app: AppHandle, board: Board) -> CmdResult<()> {
    Err(todo("save_board"))
}

// Jouw beurt! De makkelijkste: `board_path` + `std::fs::remove_file`.
// Bonus: bestaat het bestand al niet meer? Zie dat dan als gelukt
// (`e.kind() == std::io::ErrorKind::NotFound`).
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

// ---------------------------------------------------------------------------
// Tests. Draai ze met `cargo test` in de map src-tauri.
// `#[cfg(test)]` betekent: deze code wordt alleen gebouwd bij `cargo test`.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn geldige_ids() {
        assert!(validate_id("0f8c2e1a-3b4d-4c5e-9f60-718293a4b5c6").is_ok());
        assert!(validate_id("bord-1").is_ok());
    }

    #[test]
    fn gevaarlijke_ids_worden_geweigerd() {
        for id in ["", "../geheim", "a/b", "a\\b", "bord.json", "spatie erin"] {
            assert!(validate_id(id).is_err(), "{id:?} had geweigerd moeten worden");
        }
    }
}
