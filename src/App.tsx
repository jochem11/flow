import { Match, onCleanup, onMount, Switch } from "solid-js";
import { fitView, resetZoom, zoomBy } from "./lib/camera";
import { initWorkspace, openDoc, ready, saveNow, view } from "./lib/workspace";
import {
  clearSelection,
  deleteSelection,
  duplicateSelection,
  GRID,
  hasText,
  nodeById,
  nudgeSelection,
  redo,
  selectAll,
  setUi,
  ui,
  undo,
} from "./lib/store";
import { DocumentEditor, ProjectView } from "./components/editors";
import { deleteEerSelection, redoEer, setEerSelected, undoEer } from "./lib/eer";
import { Sidebar } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { TOOL_KEYS } from "./components/Toolbar";
import "./styles.css";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest("input, textarea, [contenteditable]");

export default function App() {
  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl/Cmd+S works everywhere, even while typing
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveNow();
      return;
    }
    if (isTyping(e.target)) return;
    // EER diagram: undo/redo and delete
    if (openDoc()?.kind === "eer") {
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoEer();
        else undoEer();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoEer();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteEerSelection();
      } else if (e.key === "Escape") {
        setEerSelected(null);
      }
      return;
    }
    // All other shortcuts belong to the flowchart editor
    if (openDoc()?.kind !== "flow") return;
    const key = e.key.toLowerCase();

    if (e.key === " ") {
      e.preventDefault();
      if (!ui.spaceDown) setUi("spaceDown", true);
      return;
    }

    if (mod) {
      const actions: Record<string, () => void> = {
        z: () => (e.shiftKey ? redo() : undo()),
        y: redo,
        a: selectAll,
        d: duplicateSelection,
      };
      if (actions[key]) {
        e.preventDefault();
        actions[key]();
      }
      return;
    }

    if (e.shiftKey && e.code === "Digit1") {
      fitView();
      return;
    }

    const step = e.shiftKey ? GRID * 5 : GRID;
    switch (e.key) {
      case "Delete":
      case "Backspace":
        deleteSelection();
        break;
      case "Escape":
        clearSelection();
        setUi("tool", "select");
        break;
      case "Enter":
      case "F2":
        if (ui.selected.length === 1 && hasText(nodeById(ui.selected[0])?.kind ?? "box")) {
          e.preventDefault();
          setUi("editingNode", ui.selected[0]);
        } else if (ui.selectedEdge) {
          e.preventDefault();
          setUi("editingEdge", ui.selectedEdge);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        nudgeSelection(-step, 0);
        break;
      case "ArrowRight":
        e.preventDefault();
        nudgeSelection(step, 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        nudgeSelection(0, -step);
        break;
      case "ArrowDown":
        e.preventDefault();
        nudgeSelection(0, step);
        break;
      case "+":
      case "=":
        zoomBy(1.2);
        break;
      case "-":
        zoomBy(1 / 1.2);
        break;
      case "0":
        resetZoom();
        break;
      default: {
        if (TOOL_KEYS[key]) setUi("tool", TOOL_KEYS[key]);
      }
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") setUi("spaceDown", false);
  };
  const onBlur = () => setUi("spaceDown", false);

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    initWorkspace();
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  });

  return (
    <div class="app">
      <Sidebar />
      <main class="main">
        <Switch>
          <Match when={!ready()}>
            <div class="main-empty">Loading…</div>
          </Match>
          <Match when={view().type === "doc"}>
            <TopBar />
            <DocumentEditor />
          </Match>
          <Match when={(() => { const v = view(); return v.type === "project" ? v.projectId : null; })()}>
            {(projectId) => <ProjectView projectId={projectId()} />}
          </Match>
          <Match when={true}>
            <div class="main-empty">Choose or create a project in the sidebar.</div>
          </Match>
        </Switch>
      </main>
      <Toasts />
    </div>
  );
}
