import { createEffect, Match, on, onCleanup, onMount, Switch } from "solid-js";
import { fitView, pastePoint, resetZoom, zoomBy } from "./lib/camera";
import { openDoc, ready, saveNow, view } from "./lib/workspace";
import {
  clearSelection,
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
  wrapSelectionInSection,
  fromClipboard,
  quickAdd,
  onFlowCopy,
  onFlowPaste,
  putOnClipboard,
} from "./lib/store";
import { DocumentEditor, ProjectView } from "./components/editors";
import {
  copyEerSelection,
  deleteEerSelection,
  eerPastePoint,
  eerSelected,
  pasteEer,
  type EerClip,
  nudgeEerSelection,
  redoEer,
  selectAllEer,
  setEditingSection,
  setEerSelected,
  undoEer,
  wrapEerSelection,
} from "./lib/eer";
import { Gate } from "./components/Gate";
import { canComment, canEdit } from "./lib/access";
import { placing, setPlacing } from "./lib/comments";
import { Sidebar } from "./components/Sidebar";
import { InvitesBanner, OfflineBanner, UpdateBanner, VerifyBanner } from "./components/AccountMenu";
import { Presenter } from "./components/Presenter";
import { openFind } from "./components/FindAndMap";
import { addSiblingTopic, addSubtopic, deleteSelectionTidy } from "./lib/mindmap";
import { addImages, copyImage, isImageFile } from "./lib/files";
import { Toasts } from "./components/Toasts";
import { TopBar } from "./components/TopBar";
import { TOOL_KEYS, toolOffered } from "./components/Toolbar";
import { CommandPalette, openPalette } from "./components/CommandPalette";
import { redoChart, undoChart } from "./lib/chart/store";
import { openShortcuts, ShortcutSheet } from "./components/Shortcuts";
import "./styles.css";
// Editing together: joins the room of every board opened from the server
import "./lib/collab";
// Live notices: others' changes to projects and to your access
import "./lib/events";
import "./lib/inView";
import { selectNextBlock } from "./lib/a11y";
import { navOpen, setNavOpen } from "./lib/layout";
import { IconMenu } from "./components/icons";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && !!t.closest("input, textarea, [contenteditable]");

/** Text selected on the page (in a comment, a dialog): copying that is the browser's job */
const hasTextSelection = () => !!window.getSelection()?.toString();

export default function App() {
  // Small screens: opening a board or project closes the drawer
  createEffect(on(view, () => setNavOpen(false), { defer: true }));
  // Copy, cut and paste on the flowchart and the EER diagram (see store/clipboard.ts)
  const onCopy = (e: ClipboardEvent, cut: boolean) => {
    if (isTyping(e.target) || hasTextSelection()) return;
    const kind = openDoc()?.kind;
    const removing = cut && canEdit();
    if (kind === "flow") onFlowCopy(e, removing, openDoc()?.id);
    else if (kind === "eer") {
      const clip = copyEerSelection();
      if (!clip) return;
      putOnClipboard(e, clip, clip.entities.map((t) => t.name).join("\n"));
      if (removing) deleteEerSelection();
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    if (isTyping(e.target) || !canEdit()) return;
    const kind = openDoc()?.kind;
    // Pictures from elsewhere (a screenshot, a copied image)
    const images = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
    if (kind === "flow" && images.length) {
      e.preventDefault();
      void addImages(images, pastePoint());
    } else if (kind === "flow") onFlowPaste(e, pastePoint(), openDoc()?.id, copyImage);
    else if (kind === "eer") {
      const clip = fromClipboard<EerClip>(e, "eer");
      if (!clip) return;
      e.preventDefault();
      pasteEer(clip, eerPastePoint());
    }
  };
  const onCopyEvent = (e: ClipboardEvent) => onCopy(e, false);
  const onCutEvent = (e: ClipboardEvent) => onCopy(e, true);

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    // Ctrl/Cmd+S works everywhere, even while typing
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      // Finish what is being typed (a block, a field) so it is in what is saved
      (document.activeElement as HTMLElement | null)?.blur?.();
      saveNow();
      return;
    }
    // Quick open and commands, also from a text field (not inside the text editor)
    if (mod && e.key.toLowerCase() === "k" && !(e.target as HTMLElement | null)?.isContentEditable) {
      e.preventDefault();
      openPalette();
      return;
    }
    if (isTyping(e.target)) return;
    if (e.key === "?" && !mod) {
      e.preventDefault();
      openShortcuts();
      return;
    }
    // Find on a flowchart or EER diagram (instead of the browser's own find)
    if (mod && e.key.toLowerCase() === "f" && (openDoc()?.kind === "flow" || openDoc()?.kind === "eer")) {
      e.preventDefault();
      openFind();
      return;
    }
    // The comment tool (C), also for people who only comment; Esc stops it
    const kind = openDoc()?.kind;
    if ((kind === "flow" || kind === "eer") && !mod && canComment()) {
      if (e.key.toLowerCase() === "c") {
        setPlacing(!placing());
        return;
      }
      if (e.key === "Escape" && placing()) {
        setPlacing(false);
        return;
      }
    }
    // Viewing only: moving around and selecting, nothing that changes the board
    const edit = canEdit();
    // EER diagram: selecting and grouping as in a flowchart, undo/redo, delete
    // A chart board: undo and redo (its table's cells are inputs, so not while typing)
    if (openDoc()?.kind === "chart") {
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoChart();
        else undoChart();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoChart();
      }
      return;
    }
    if (openDoc()?.kind === "eer") {
      const key = e.key.toLowerCase();
      if (e.key === " ") {
        e.preventDefault();
        if (!ui.spaceDown) setUi("spaceDown", true);
      } else if (e.key === "Escape") {
        setEerSelected(null);
      } else if (mod && key === "a") {
        e.preventDefault();
        selectAllEer();
      } else if (!edit) {
        return;
      } else if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redoEer();
        else undoEer();
      } else if (mod && key === "y") {
        e.preventDefault();
        redoEer();
      } else if (mod && key === "g") {
        e.preventDefault();
        wrapEerSelection();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteEerSelection();
      } else if ((e.key === "Enter" || e.key === "F2") && eerSelected()?.kind === "section") {
        e.preventDefault();
        setEditingSection(eerSelected()!.id);
      } else if (!mod && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 5 : GRID;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) nudgeEerSelection(d[0], d[1]);
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

    if (!edit && (mod ? key !== "a" : ["Delete", "Backspace", "Enter", "F2", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) || !!TOOL_KEYS[key])) {
      if (e.key === "Escape") clearSelection();
      return;
    }

    if (mod) {
      const actions: Record<string, () => void> = {
        z: () => (e.shiftKey ? redo() : undo()),
        y: redo,
        a: selectAll,
        d: duplicateSelection,
        // Group: the selection in a new section
        g: wrapSelectionInSection,
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
        deleteSelectionTidy();
        break;
      case "Tab": {
        // A mind map topic: a subtopic
        if (addSubtopic()) {
          e.preventDefault();
          break;
        }
        // On the board itself (not in a panel or field): the next block (Shift: the one before)
        const a = document.activeElement;
        if ((a === document.body || a?.classList.contains("viewport")) && selectNextBlock(e.shiftKey)) e.preventDefault();
        break;
      }
      case "Escape":
        clearSelection();
        setUi("tool", "select");
        break;
      case "Enter":
      case "F2":
        // A mind map topic: Enter makes the next one (F2 edits)
        if (e.key === "Enter" && addSiblingTopic()) {
          e.preventDefault();
          break;
        }
        if (ui.selected.length === 1 && hasText(nodeById(ui.selected[0])?.kind ?? "box") && !nodeById(ui.selected[0])?.locked) {
          e.preventDefault();
          setUi("editingNode", ui.selected[0]);
        } else if (ui.selectedEdge) {
          e.preventDefault();
          setUi("editingEdge", ui.selectedEdge);
        }
        break;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault();
        const dir = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[e.key];
        // Alt+Arrow: a new block that way, joined to this one
        if (e.altKey) quickAdd(dir);
        else nudgeSelection(dir === "left" ? -step : dir === "right" ? step : 0, dir === "up" ? -step : dir === "down" ? step : 0);
        break;
      }
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
        if (TOOL_KEYS[key] && toolOffered(TOOL_KEYS[key])) setUi("tool", TOOL_KEYS[key]);
      }
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === " ") setUi("spaceDown", false);
  };
  const onBlur = () => setUi("spaceDown", false);

  // Viewing only: no text editing either, however it was started
  createEffect(() => {
    if (!canEdit() && (ui.editingNode || ui.editingEdge)) setUi({ editingNode: null, editingEdge: null });
  });

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("copy", onCopyEvent);
    document.addEventListener("cut", onCutEvent);
    document.addEventListener("paste", onPaste);
  });
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    document.removeEventListener("copy", onCopyEvent);
    document.removeEventListener("cut", onCutEvent);
    document.removeEventListener("paste", onPaste);
  });

  const Editor = () => (
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
  );

  return (
    <>
      <Gate
        guest={
          // Through a share link without an account: just that board
          <div class="app guest">
            <main class="main">
              <Editor />
            </main>
          </div>
        }
      >
        <div class="app" classList={{ "nav-open": navOpen() }}>
          <Sidebar />
          {/* Small screens: the sidebar is a drawer */}
          <button class="nav-toggle icon-btn" aria-label={navOpen() ? "Hide the boards" : "Show the boards"} aria-expanded={navOpen()} onClick={() => setNavOpen(!navOpen())}>
            <IconMenu />
          </button>
          <div class="nav-backdrop" onClick={() => setNavOpen(false)} />
          <main class="main">
            <OfflineBanner />
            <UpdateBanner />
            <VerifyBanner />
            <InvitesBanner />
            <Editor />
          </main>
        </div>
      </Gate>
      <Toasts />
      <Presenter />
      <CommandPalette />
      <ShortcutSheet />
    </>
  );
}
