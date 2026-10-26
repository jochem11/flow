import { onCleanup, onMount } from "solid-js";
import { fitView, resetZoom, zoomBy } from "./lib/camera";
import { loadInitial, saveNow, startAutosave } from "./lib/persistence";
import {
  clearSelection,
  deleteSelection,
  duplicateSelection,
  GRID,
  nudgeSelection,
  redo,
  selectAll,
  setUi,
  ui,
  undo,
} from "./lib/store";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { TopBar } from "./components/TopBar";
import { ZoomControls } from "./components/ZoomControls";
import { Toasts } from "./components/Toasts";
import "./styles.css";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest("input, textarea, [contenteditable]");

export default function App() {
  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
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
        s: saveNow,
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
        if (ui.selected.length === 1) {
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
        const tools: Record<string, typeof ui.tool> = { v: "select", r: "box", d: "diamond", n: "note", p: "pill" };
        if (tools[key]) setUi("tool", tools[key]);
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
    startAutosave();
    loadInitial();
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  });

  return (
    <div class="app">
      <Canvas />
      <TopBar />
      <Toolbar />
      <ZoomControls />
      <Toasts />
    </div>
  );
}
