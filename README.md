# Flow

A Whimsical-style app for project flows: flowcharts, text documents, kanban boards
and (soon) EER diagrams, organised in projects and folders.
The frontend is SolidJS with a custom canvas; the backend is Rust on Tauri 2.

## Getting started

```bash
npm install
npm run tauri dev     # desktop app, talks to the Rust backend
npm run dev           # frontend only, in the browser (stores data in localStorage)
```

Rust tests: `cd src-tauri && cargo test`

Test data: close the app, run `bash scripts/seed-test-data.sh` (macOS), and start it again.

## Types and commands (tauri-specta)

Rust is the source of truth. `src/bindings.ts` is generated from the models in
`src-tauri/src/models/` and the commands in `src-tauri/src/commands/`, with every type
and a typed function per command (`list_projects` → `commands.listProjects()`).

- Generated automatically on `npm run tauri dev`, or on demand with `npm run bindings`.
- New command? Add `#[specta::specta]` above it and register it in `collect_commands!` in `lib.rs`.
- New type? Add `#[derive(specta::Type)]`.
- Never edit `src/bindings.ts` by hand, but do commit it, so diffs show when the contract changes.

## Structure

Projects contain folders (a tree via `parentId`) and documents. A document is a
flowchart, text document, kanban board or EER diagram (`DocContent` in `models/document.rs`).

On disk, in the app data directory (see `storage.rs`):

```
projects/<project-id>/project.json      name, description, folders
projects/<project-id>/docs/<doc-id>.json
```

### Rust (`src-tauri/src/`)

```
lib.rs               registers all commands, generates bindings.ts
storage.rs           paths, id validation, generic read_json / write_json
models/              project, document, flow, text, kanban, eer
commands/
  projects.rs        list, create, update, delete
  folders.rs         create, rename, move (with cycle check), delete
  documents.rs       list, load, save, create, rename, move, delete
  flow.rs            auto-layout and export (Mermaid, SVG, PNG)
```

### Frontend (`src/`)

```
bindings.ts          GENERATED from Rust (do not edit)
lib/
  types.ts           re-exports of the generated types
  api.ts             typed backend commands + browser fallback (localStorage)
  workspace.ts       projects, folders, open document, autosave
  store.ts           flowchart editor state, actions, undo/redo
  kanban.ts          kanban state and actions (cards, subtasks, labels, hours, comments)
  timer.ts           the running timer across documents (start/stop, sidebar indicator)
  camera.ts          screen <-> world coordinates, pan, zoom, fit
  geometry.ts        anchors and bezier curves for edges
  interactions.ts    dragging, resizing, connecting, selection rectangle
  markdown.ts        markdown rendering
  mdFormat.ts        markdown shortcuts for plain textareas (comments, project description)
components/
  Sidebar.tsx        project / folder / document tree
  TopBar.tsx         document header (breadcrumb, name, actions)
  editors.tsx        flowchart and text editors, project page, placeholders
  KanbanEditor.tsx   kanban board: columns, cards, drag and drop
  KanbanCardDialog.tsx  card details: description, subtasks, discussion, labels, effort
  ConfirmButton.tsx  "click twice to delete" button
  TimerIndicator.tsx running timer at the bottom of the sidebar
  Markdown.tsx       rendered markdown view + editing shortcuts
  RichTextEditor.tsx WYSIWYG editor (Tiptap) that reads and writes markdown
  Canvas.tsx, NodeView.tsx, Edges.tsx, ...   the flowchart canvas
```

## Controls

| | |
| --- | --- |
| Double-click in the sidebar | rename |
| Drag in the sidebar | move to another folder or position |
| Double-click the canvas | new block |
| Double-click a block / edge | edit text / label |
| Drag from a dot | connect; release on empty space for a new block |
| Drag on the empty canvas | selection rectangle (Shift adds) |
| Scroll / Space+drag / middle button | pan |
| Ctrl+scroll / pinch | zoom |
| V R D P N | select, block, decision, start/end, note |
| Ctrl+Z, Ctrl+Shift+Z | undo, redo |
| Ctrl+D, Ctrl+A, Delete | duplicate, select all, delete |
| Arrow keys (Shift = larger steps) | nudge |
| Alt while dragging | don't snap to the grid |
| 0, Shift+1, + / - | 100%, zoom to fit, zoom |
| Cmd+B / I / E / K, Cmd+Shift+S | bold, italic, code, link, strikethrough (text editor) |
