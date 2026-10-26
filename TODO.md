# Flow – TODO

## 0. Opzetten
- [ ] `npm install` en `npm run tauri dev` draaien
- [x] `git init` + eerste commit

## 1. Type-safety (tauri-specta) ✅
- [x] `specta`, `specta-typescript` en `tauri-specta` toegevoegd (exacte versies, het is nog een RC)
- [x] `#[derive(specta::Type)]` op alle types in `models.rs`
- [x] `#[specta::specta]` op elk command
- [x] `lib.rs` genereert `src/bindings.ts` bij `npm run tauri dev` en `npm run bindings`
- [x] `updated_at: u64` als `number` naar TS (via `#[specta(type = ...)]`)
- [x] `api.ts` gebruikt de getypte `commands`, `types.ts` re-exporteert alleen nog
- [ ] Als je een eigen error-enum maakt (fase 2): `#[derive(Serialize, specta::Type)]` erop, dan wordt de error in TS ook getypt

**Werkwijze vanaf nu:** type of command aanpassen in Rust → `npm run bindings` (of gewoon `npm run tauri dev`) → TypeScript wijst aan wat je in de frontend moet aanpassen.

## 2. Opslag (JSON-bestanden)
- [x] Helper `boards_dir` (app-datamap + `boards/`, map aanmaken) — voorbeeld
- [x] `id` valideren met `validate_id` + tests — voorbeeld
- [ ] `save_board`: `updated_at` invullen, schrijven naar `.tmp` en daarna `rename`
- [x] `load_board`: lezen en parsen met `serde_json` — voorbeeld, lees de comments!
- [ ] `list_boards`: `read_dir`, elk bestand parsen, sorteren op `updated_at` (nieuwste eerst), kapotte bestanden overslaan in plaats van alles laten falen
- [ ] `delete_board`
- [ ] Eigen error-enum met `thiserror` in plaats van `String` (die serialiseert naar een nette melding)
- [ ] Tests met een tijdelijke map (`tempfile` crate): opslaan → laden → gelijk?

## 3. Export: Mermaid
- [ ] Vorm per `NodeKind`: box `["…"]`, diamond `{"…"}`, pill `(["…"])`, notes overslaan
- [ ] Node-ids omzetten naar veilige Mermaid-ids (`n0`, `n1`, …) via een `HashMap`
- [ ] Quotes en nieuwe regels in tekst escapen
- [ ] Labels op pijlen: `a -->|Ja| b`
- [ ] Wegschrijven naar `app.path().download_dir()` met unieke bestandsnaam, pad teruggeven
- [ ] Unit test: voorbeeldbord → verwachte string

## 4. Auto-layout ("Ordenen")
- [ ] Graaf opbouwen: `HashMap<&str, Vec<&str>>` voor uitgaande pijlen, plus inkomende-telling
- [ ] Cycli afhandelen: DFS, back-edges (zoals feedback-lussen) negeren voor de layout
- [ ] Laag per node = langste pad vanaf een startnode
- [ ] Positie: `y` per laag, `x` naast elkaar gecentreerd rond 0
- [ ] Kruisingen verminderen: sorteer binnen een laag op gemiddelde `x` van de ouders (barycenter), een paar keer herhalen
- [ ] Losse nodes (zonder pijlen) en notes apart zetten
- [ ] Tests: lijn, vertakking, lus, lege graaf

## 5. Export: SVG
- [ ] Bounding box van alle nodes + marge → `viewBox`
- [ ] Per node `<rect>` / `<polygon>` / afgeronde pill met de juiste kleuren
- [ ] Tekst: simpele regelafbreking op basis van geschatte tekenbreedte, `<text>` + `<tspan>`
- [ ] Pijlen: de curve-logica uit `src/lib/geometry.ts` porten naar Rust (`pick_sides`, `anchor`, bezier)
- [ ] `<marker>` voor pijlpunten, labels op het midden

## 6. Export: PNG
- [ ] Je eigen SVG renderen met `resvg` (`usvg` parsen → `tiny_skia::Pixmap` → `save_png`)
- [ ] Systeemfonts laden (`fontdb`), anders verdwijnt de tekst
- [ ] Schaal 2x voor scherpe afbeeldingen

## 7. Extra (als de rest werkt)
- [ ] Opslag naar SQLite (`rusqlite`), frontend merkt niks
- [ ] Openen/opslaan als `.flow`-bestand met `tauri-plugin-dialog`
- [ ] Versiegeschiedenis: oude versies bewaren bij elke save
- [ ] Kleine CLI: `flow export bord.json --format svg` (hergebruik je exportcode)
