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
- [x] Accounts on a server (`server/`): email + password (confirmation and reset by mail), Google
- [x] Projects shared with view / comment / edit rights, invites by mail, per-board roles (also No access)
- [x] Public links per board (only people with access, or anyone: view / comment), guests without an account
- [x] Comments: on the board, a block, a table, a card or a spot; replies, resolve; guests too
- [x] Editing together in real time (Yjs ↔ yrs): flowcharts, EER, kanban, text; presence; undo of your own changes
- [x] The web version (served by the server), links into the desktop app (`flowapp://`), Docker
- [x] The pure logic in `crates/flow-core`, shared by the desktop app and the server
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
      with rows, kinds (class / abstract / interface / enum) and notation checks
- [x] Sequence diagrams: horizontal messages, automatic activation bars, returns, self-messages
- [x] EER editor: typed columns, keys, defaults, joins by dragging rows, crow's foot,
      SQL for PostgreSQL / MySQL / SQLite / SQL Server / Oracle with preview (`commands/eer.rs`)
- [x] Kanban cards linked to documents, and to sections / tables in them, from either side
- [x] Shared fixtures (`fixtures/`) so the TypeScript and Rust copies of rules stay equal;
      Vitest for the frontend (`npm test`)

**Workflow:** change a type or command in Rust → `npm run bindings` (or just `npm run tauri dev`)
→ TypeScript points out what to update in the frontend.
**Tests:** `npm test` (frontend) and `cd src-tauri && cargo test` (backend). A rule that exists in
both (routing, activation bars, UML rows) gets a case in `fixtures/`, checked by both.

## Accounts and sharing
- [ ] Desktop app: try `flowapp://` links and Google sign-in in a bundled build (`npm run tauri build`);
      deep links do not work in `tauri dev` on macOS
- [ ] Editing together: the text of one block is one value, so two people typing in the same block
      at the same moment keep one of the two (whole documents merge per character)
- [ ] Editing together: "X is typing" on kanban cards; presence on kanban boards
- [ ] Viewers: in a card dialog the subtask and link buttons are off too (only editing should be)
- [ ] Comments on text documents can only be on the whole document, not on a passage
- [ ] Rate limits are kept in memory: with more than one server process, move them to the database
- [ ] Delete an account (and what happens to its projects); change email or password when logged in
- [ ] Transfer a project to another owner

## Backend
- [ ] Custom error enum with `thiserror` instead of `String`: `NotFound`, `InvalidId`, `Cycle`, ...
      With `#[derive(Serialize, specta::Type)]` the errors are typed in TypeScript as well.
- [ ] Tests for the commands themselves, against a temporary data directory
- [ ] Auto-layout: let back edges (feedback loops) avoid blocks too
- [ ] The old `boards/` directory from before projects is no longer read; delete it from the app data directory
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
