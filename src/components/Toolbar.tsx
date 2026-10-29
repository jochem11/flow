import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { NodeKind } from "../lib/types";
import { setUi, ui, type Tool } from "../lib/store";
import {
  IconUml,
  UML_ICONS,
  IconBox,
  IconDiamond,
  IconEnd,
  IconLabel,
  IconLanes,
  IconLine,
  IconNote,
  IconPill,
  IconPointer,
  IconSection,
  IconStart,
} from "./icons";

type ToolDef = { tool: Tool; label: string; key: string; icon: () => JSX.Element };

/** Groups of tools, separated by a line. Keys are handled in App.tsx (TOOL_KEYS). */
const GROUPS: ToolDef[][] = [
  [{ tool: "select", label: "Select", key: "V", icon: IconPointer }],
  [
    { tool: "box", label: "Block", key: "R", icon: IconBox },
    { tool: "diamond", label: "Decision", key: "D", icon: IconDiamond },
    { tool: "pill", label: "Terminal", key: "P", icon: IconPill },
    { tool: "start", label: "Start point", key: "S", icon: IconStart },
    { tool: "end", label: "End point", key: "E", icon: IconEnd },
  ],
  [
    { tool: "label", label: "Label", key: "T", icon: IconLabel },
    { tool: "note", label: "Note", key: "N", icon: IconNote },
  ],
  [
    { tool: "line", label: "Line (free, or attached to blocks)", key: "L", icon: IconLine },
  ],
  [
    { tool: "section", label: "Section", key: "G", icon: IconSection },
    { tool: "lanes", label: "Swimlanes", key: "W", icon: IconLanes },
  ],
];

/** UML symbols beyond the basic flowchart tools, per diagram type. */
const UML: { title: string; items: { kind: NodeKind; label: string }[] }[] = [
  {
    title: "Activity",
    items: [
      { kind: "bar", label: "Fork / join" },
      { kind: "flowfinal", label: "Flow final" },
      { kind: "object", label: "Object node" },
      { kind: "pin", label: "Pin (put it on the border of an action)" },
      { kind: "sendsignal", label: "Send signal" },
      { kind: "receivesignal", label: "Accept event" },
      { kind: "timeevent", label: "Time event" },
      { kind: "circle", label: "Connector / history" },
      { kind: "comment", label: "Comment" },
    ],
  },
  {
    title: "Use case",
    items: [
      { kind: "actor", label: "Actor" },
      { kind: "usecase", label: "Use case" },
      { kind: "boundary", label: "System boundary" },
    ],
  },
  {
    title: "Class",
    items: [
      { kind: "class", label: "Class / interface" },
      { kind: "package", label: "Package" },
    ],
  },
  {
    title: "Sequence",
    items: [
      { kind: "lifeline", label: "Lifeline" },
      { kind: "activation", label: "Activation" },
      { kind: "fragment", label: "Fragment (alt, loop, opt)" },
      { kind: "destroy", label: "Destroy" },
    ],
  },
];

const UML_KINDS = new Set<Tool>(UML.flatMap((g) => g.items.map((i) => i.kind)));

/** Toolbar button with a panel of UML symbols next to it. */
function UmlPanel() {
  const [open, setOpen] = createSignal(false);
  let wrap!: HTMLDivElement;

  const onDoc = (e: PointerEvent) => {
    if (open() && !wrap.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));

  return (
    <div class="uml-wrap" ref={wrap}>
      <button
        class="tool-btn"
        classList={{ active: open() || UML_KINDS.has(ui.tool) }}
        title="UML shapes"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <IconUml />
      </button>
      <Show when={open()}>
        <div class="uml-panel panel" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <For each={UML}>
            {(group) => (
              <>
                <div class="menu-title">{group.title}</div>
                <div class="uml-grid">
                  <For each={group.items}>
                    {(item) => (
                      <button
                        class="tool-btn"
                        classList={{ active: ui.tool === item.kind }}
                        title={item.label}
                        onClick={() => {
                          setUi("tool", item.kind);
                          setOpen(false);
                        }}
                      >
                        {UML_ICONS[item.kind]?.()}
                      </button>
                    )}
                  </For>
                </div>
              </>
            )}
          </For>
          <p class="uml-hint">Arrow types for relations and messages: select a line, then "UML".</p>
        </div>
      </Show>
    </div>
  );
}

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  GROUPS.flat().map((t) => [t.key.toLowerCase(), t.tool]),
);

export function Toolbar() {
  return (
    <nav class="toolbar panel" aria-label="Tools">
      <For each={GROUPS}>
        {(group, i) => (
          <>
            {i() > 0 && <span class="tool-sep" />}
            <For each={group}>
              {(t) => (
                <button
                  class="tool-btn"
                  classList={{ active: ui.tool === t.tool }}
                  title={`${t.label} (${t.key})`}
                  aria-pressed={ui.tool === t.tool}
                  onClick={() => setUi("tool", t.tool)}
                >
                  {t.icon()}
                  <kbd>{t.key}</kbd>
                </button>
              )}
            </For>
          </>
        )}
      </For>
      <span class="tool-sep" />
      <UmlPanel />
    </nav>
  );
}
