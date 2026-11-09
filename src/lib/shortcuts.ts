// The keyboard shortcuts, as people see them: in the `?` sheet and next to the
// commands in the Cmd+K palette. The keys themselves are handled in App.tsx;
// the tools' own keys come from the toolbar of the open board's type.

/** ⌘ on a Mac, Ctrl elsewhere */
export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export interface Shortcut {
  /** Keys pressed together, e.g. [MOD, "K"] */
  keys: string[];
  label: string;
}

export const SHORTCUT_GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: "Everywhere",
    items: [
      { keys: [MOD, "K"], label: "Quick open and commands" },
      { keys: ["?"], label: "This list" },
      { keys: [MOD, "S"], label: "Save now" },
      { keys: [MOD, "F"], label: "Find on the board" },
      { keys: ["C"], label: "Comment on a spot" },
      { keys: ["Esc"], label: "Stop, deselect" },
    ],
  },
  {
    title: "Moving around",
    items: [
      { keys: ["Space", "drag"], label: "Pan" },
      { keys: ["+"], label: "Zoom in" },
      { keys: ["-"], label: "Zoom out" },
      { keys: ["0"], label: "Zoom to 100%" },
      { keys: ["Shift", "1"], label: "Zoom to fit" },
    ],
  },
  {
    title: "Editing",
    items: [
      { keys: [MOD, "Z"], label: "Undo" },
      { keys: [MOD, "Shift", "Z"], label: "Redo" },
      { keys: [MOD, "A"], label: "Select all" },
      { keys: [MOD, "D"], label: "Duplicate" },
      { keys: [MOD, "G"], label: "Put the selection in a section" },
      { keys: [MOD, "C"], label: "Copy (also between boards)" },
      { keys: [MOD, "V"], label: "Paste" },
      { keys: ["Enter"], label: "Edit the text" },
      { keys: [MOD, "Enter"], label: "Done typing in a note, callout or comment (Enter: a new line)" },
      { keys: ["Delete"], label: "Delete" },
      { keys: ["Arrows"], label: "Move (with Shift: further)" },
      { keys: ["Alt", "Arrow"], label: "Add a block that way" },
    ],
  },
  {
    title: "Mind maps",
    items: [
      { keys: ["Tab"], label: "Subtopic" },
      { keys: ["Enter"], label: "Next topic" },
    ],
  },
];
