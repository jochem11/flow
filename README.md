# Flow

Een Whimsical-achtige flowchart-app. Frontend in SolidJS met een eigen canvas,
backend in Rust via Tauri 2.

De frontend is af. De Rust-kant staat klaar als stubs: elk command geeft nu
"nog niet geïmplementeerd" terug, en de app laat die melding netjes zien.

## Starten

```bash
npm install
npm run tauri dev     # desktop-app, praat met Rust
npm run dev           # alleen frontend in de browser (opslag via localStorage)
```

Rust-tests: `cd src-tauri && cargo test`

## Types en commands (tauri-specta)

Rust is de bron van waarheid. Uit `src-tauri/src/models.rs` en `commands.rs` wordt
`src/bindings.ts` gegenereerd, met alle types en een getypte functie per command
(`list_boards` → `commands.listBoards()`).

- Genereren gebeurt automatisch bij `npm run tauri dev`, of los met `npm run bindings`.
- Nieuw command? `#[specta::specta]` erboven en toevoegen aan `collect_commands!` in `lib.rs`.
- Nieuw type? `#[derive(specta::Type)]` erop.
- `src/bindings.ts` nooit met de hand aanpassen; commit hem wel, dan zie je in diffs wanneer het contract verandert.

## Wat jij in Rust bouwt

Alles staat in `src-tauri/src/commands.rs`, met hints per command.

| Command | Wanneer aangeroepen | Teruggeven |
| --- | --- | --- |
| `list_boards` | bij opstarten, menu "Borden" | `Vec<BoardMeta>` |
| `load_board(id)` | bord openen | `Board` |
| `save_board(board)` | autosave, ~800ms na elke wijziging, en Ctrl+S | `()` |
| `delete_board(id)` | prullenbak in het menu | `()` |
| `auto_layout(nodes, edges)` | knop "Ordenen" | `Vec<Position>` |
| `export_board(board, format)` | menu "Exporteren" (svg / png / mermaid) | pad van het bestand |

Voorgestelde volgorde:

1. `save_board` + `load_board` + `list_boards` met JSON-bestanden. Daarna onthoudt de app je werk.
2. `export_board` Mermaid: alleen strings bouwen, goede opwarmer.
3. `auto_layout`: echte algoritmes (grafen, cycli, lagen).
4. `export_board` SVG en daarna PNG met de `resvg` crate.
5. Later: SQLite, een eigen bestandsformaat, meerdere vensters, enz.

De test in `models.rs` checkt dat de JSON van de frontend goed parst.

## Frontend-structuur

```
src/
  bindings.ts        GEGENEREERD uit Rust (niet aanpassen)
  lib/
    types.ts         re-export van de gegenereerde types
    api.ts           getypte commands naar Rust + browser-fallback
    store.ts         Solid store, acties, undo/redo
    camera.ts        scherm <-> wereld, pan, zoom, fit
    geometry.ts      ankers en bezier-curves voor pijlen
    interactions.ts  slepen, resizen, verbinden, selectie-rechthoek
    persistence.ts   autosave, laden, layout en export aanroepen
  components/        Canvas, NodeView, Edges, TopBar, Toolbar, ...
```

## Bediening

| | |
| --- | --- |
| Dubbelklik op canvas | nieuw blok |
| Dubbelklik op blok / pijl | tekst / label bewerken |
| Sleep vanaf een bolletje | verbinden; loslaten op leeg = nieuw blok |
| Sleep op leeg canvas | selectie-rechthoek (Shift = toevoegen) |
| Scroll / Spatie+slepen / middelste knop | pannen |
| Ctrl+scroll / pinch | zoomen |
| V R D P N | selecteren, blok, beslissing, start/eind, notitie |
| Ctrl+Z, Ctrl+Shift+Z | ongedaan maken, opnieuw |
| Ctrl+D, Ctrl+A, Delete | dupliceren, alles selecteren, verwijderen |
| Pijltjes (Shift = groter) | verschuiven |
| Alt tijdens slepen | niet op grid snappen |
| 0, Shift+1, + / - | 100%, alles in beeld, zoomen |
