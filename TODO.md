# Flow – TODO

## Done
- [x] Tauri 2 + SolidJS setup, custom canvas for flowcharts
- [x] Type-safe commands and types with tauri-specta (`src/bindings.ts`)
- [x] JSON storage with atomic writes and id validation (`storage.rs`)
- [x] Projects, nested folders and documents (`commands/`)
- [x] SVG and PNG export (`commands/flow.rs`, `commands/flow_svg.rs`)
- [x] Mermaid with a preview, one block per diagram: flowchart, class, sequence and ER (`commands/mermaid.rs`)
- [x] Right-angle lines go around blocks (app + SVG export, `fixtures/routing.json`)
- [x] Import SQL into an EER diagram (`commands/sql_import.rs`, `sqlparser`): our own export for all
      5 databases, pg_dump and mysqldump; many-to-many tables become relations
- [x] Import code into a class diagram for all 7 export languages (`commands/code_import/`),
      checked by a round trip through the code export
- [x] Auto-layout: layered layout with cycle breaking, dummy nodes for long edges and barycenter ordering
- [x] Text documents and card descriptions: WYSIWYG editor (Tiptap) that still stores markdown
- [x] Project page with a rendered markdown description
- [x] Kanban: columns and cards, drag and drop, card dialog with markdown description and checklist progress
- [x] Kanban (Azure-style): subtasks, labels with colors and icons, estimate / completed hours, discussion, column colors and icons
- [x] Kanban: timer per card with a time log (when you worked on it), stoppable from any document
- [x] Flowchart: sections (with explicit membership), swimlanes, labels, start/end points, notes
- [x] Connectors: curved / straight / right angles, solid / dashed / dotted, arrowheads per end,
      labels on / above / below the line, end texts (multiplicity), pinned ends at any angle,
      free lines (line tool), dragging a line's middle (`bend`)
- [x] UML: activity, use case, class and sequence symbols; UML relation presets; class editor
      with rows, kinds (class / abstract / interface / enum) and notation + type checks
- [x] Sequence diagrams: horizontal messages, automatic activation bars, returns, self-messages
- [x] Code from class diagrams: TypeScript, Java, C#, Python, Kotlin, Rust, Go (`commands/codegen/`),
      getters / setters, preview with syntax colors, selected classes only
- [x] EER editor: typed columns, keys, defaults, joins by dragging rows, crow's foot,
      SQL for PostgreSQL / MySQL / SQLite / SQL Server / Oracle with preview (`commands/eer.rs`)
- [x] Kanban cards linked to documents, and to sections / tables in them, from either side
- [x] Shared fixtures (`fixtures/`) so the TypeScript and Rust copies of rules stay equal;
      Vitest for the frontend (`npm test`)

**Workflow:** change a type or command in Rust → `npm run bindings` (or just `npm run tauri dev`)
→ TypeScript points out what to update in the frontend.
**Tests:** `npm test` (frontend) and `cd src-tauri && cargo test` (backend). A rule that exists in
both (routing, activation bars, UML rows) gets a case in `fixtures/`, checked by both.

## Backend
- [ ] Custom error enum with `thiserror` instead of `String`: `NotFound`, `InvalidId`, `Cycle`, ...
      With `#[derive(Serialize, specta::Type)]` the errors are typed in TypeScript as well.
- [ ] Tests for the commands themselves, against a temporary data directory
- [ ] Auto-layout: let back edges (feedback loops) avoid blocks too
- [ ] The old `boards/` directory from before projects is no longer read; delete it from the app data directory
- [ ] Compile-check generated Kotlin and C# (no compilers on the dev machine yet), e.g. in CI
- [ ] Code import: `Map<K, V>` and other library types are marked red (only built-in types and
      connected classes are allowed); allow a few common generic library types
- [ ] SQL import: multi-column UNIQUE and CHECK constraints are not in the diagram model yet

## Editors (frontend)
- [ ] Kanban: undo/redo (like the flowchart editor)
- [ ] Kanban: tick checklist items directly in the rendered card description
- [ ] Kanban: due dates, priority and an assignee on cards (new fields in `KanbanCard`)
- [ ] Kanban: filter the board by label, or show only cards with subtasks open
- [ ] Time overview: hours per day / week across all boards, from the time logs
- [ ] Kanban: WIP limit per column
- [ ] Sequence: actor lifeline head, alt/opt guards and operand dividers, nested activation bars side by side
- [ ] Flowchart: alignment guides, align / distribute, copy / paste between documents, minimap
- [ ] Linked cards: refresh the badges live while a document is open
- [ ] SVG/PNG export: measure text with the real font, and a dark-theme export

## Extras
- [ ] Store data in SQLite (`rusqlite`) without the frontend noticing
- [ ] Open / save as a `.flow` file with `tauri-plugin-dialog`
- [ ] Version history: keep old versions on every save
- [ ] Small CLI: `flow export board.json --format svg`, reusing the export code
- [ ] Templates: insert ready-made groups (design patterns, a sequence skeleton) into a flowchart
