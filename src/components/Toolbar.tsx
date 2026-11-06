import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { IconPanel } from "./IconPanel";
import { addImages } from "../lib/files";
import { pastePoint } from "../lib/camera";
import { addChartBlock, addNewChartBlock, docsOf, openDoc } from "../lib/workspace";
import type { NodeKind } from "../lib/types";
import { board, setUi, ui, type Tool } from "../lib/store";
import { boardTypeOf, offersTool, type BoardType } from "../lib/boardTypes";
import {
  IconChart,
  IconUml,
  IconTopic,
  IconImage,
  IconStar,
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
  IconCallout,
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
    { tool: "callout", label: "Callout (a remark beside the diagram)", key: "Q", icon: IconCallout },
    { tool: "topic", label: "Mind map topic (then Tab: subtopic, Enter: next topic)", key: "M", icon: IconTopic },
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

/** The open flow board's type (the toolbar is only on flow boards). */
export const currentFlowType = () => boardTypeOf("flow", board.diagram);
/** Whether the open board offers this tool (its key does nothing otherwise). */
export const toolOffered = (tool: Tool) => offersTool(currentFlowType(), tool);

/** Every tool with its icon, name and key: the basic ones and the UML shapes. */
const ALL_TOOLS = new Map<Tool, ToolDef>([
  ...GROUPS.flat().map((t): [Tool, ToolDef] => [t.tool, t]),
  ...UML.flatMap((g) => g.items).map((i): [Tool, ToolDef] => [i.kind, { tool: i.kind, label: i.label, key: "", icon: () => UML_ICONS[i.kind]!() }]),
]);

/** A typed board's toolbar: select, then the type's own groups, with their names on that board. */
function typedGroups(type: BoardType): ToolDef[][] {
  return [
    [ALL_TOOLS.get("select")!],
    ...type.tools!.map((g) => g.flatMap((t) => {
      const def = ALL_TOOLS.get(t.tool);
      return def ? [{ ...def, label: t.label ?? def.label }] : [];
    })),
  ];
}

/** A chart board shown on this board: one of the project's, or a new one */
function ChartButton() {
  const [open, setOpen] = createSignal(false);
  let wrap!: HTMLDivElement;
  const onDoc = (e: PointerEvent) => open() && !wrap.contains(e.target as Node) && setOpen(false);
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));
  const charts = () => {
    const d = openDoc();
    return d ? docsOf(d.projectId).filter((x) => x.kind === "chart") : [];
  };
  const place = (fn: (at: { x: number; y: number }) => Promise<void>) => {
    setOpen(false);
    void fn(pastePoint());
  };
  return (
    <div class="uml-wrap" ref={wrap}>
      <button class="tool-btn" classList={{ active: open() }} title="Chart (a chart board of this project, shown here)" onClick={() => setOpen(!open())}>
        <IconChart />
      </button>
      <Show when={open()}>
        <div class="uml-panel panel chart-picker">
          <div class="menu-title">Charts in this project</div>
          <button class="menu-item" onClick={() => place(addNewChartBlock)}>
            <span>New chart…</span>
          </button>
          <For each={charts()} fallback={<p class="uml-hint">No chart boards yet: a new one is made in this project.</p>}>
            {(c) => (
              <button class="menu-item" onClick={() => place((at) => addChartBlock(c.id, at))}>
                <span>{c.name}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Pictures and icons: an image from the computer, or one from the icon set */
function ContentButtons() {
  const [icons, setIcons] = createSignal(false);
  let input!: HTMLInputElement;
  let wrap!: HTMLDivElement;
  const onDoc = (e: PointerEvent) => icons() && !wrap.contains(e.target as Node) && setIcons(false);
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));
  return (
    <div class="uml-wrap content-tools" ref={wrap}>
      <button class="tool-btn" title="Image (or paste or drop one on the board)" onClick={() => input.click()}>
        <IconImage />
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = "";
          if (files.length) addImages(files, pastePoint());
        }}
      />
      <button class="tool-btn" classList={{ active: icons() }} title="Icon" onClick={() => setIcons(!icons())}>
        <IconStar />
      </button>
      <Show when={icons()}>
        <IconPanel onClose={() => setIcons(false)} />
      </Show>
      <ChartButton />
    </div>
  );
}

/** The open board's toolbar: a whiteboard has every tool (UML under its button), a typed board only its own. */
export function currentToolGroups(): ToolDef[][] {
  const type = currentFlowType();
  return type.tools ? typedGroups(type) : GROUPS;
}

export function Toolbar() {
  const groups = currentToolGroups;
  return (
    <nav class="toolbar panel" aria-label="Tools">
      <For each={groups()}>
        {(group, i) => (
          <>
            {i() > 0 && <span class="tool-sep" />}
            <For each={group}>
              {(t) => (
                <button
                  class="tool-btn"
                  classList={{ active: ui.tool === t.tool }}
                  title={t.key ? `${t.label} (${t.key})` : t.label}
                  aria-pressed={ui.tool === t.tool}
                  onClick={() => setUi("tool", t.tool)}
                >
                  {t.icon()}
                  <Show when={t.key}>
                    <kbd>{t.key}</kbd>
                  </Show>
                </button>
              )}
            </For>
          </>
        )}
      </For>
      <Show when={!currentFlowType().tools}>
        <span class="tool-sep" />
        <UmlPanel />
      </Show>
      <Show when={openDoc()?.role}>
        <ContentButtons />
      </Show>
    </nav>
  );
}
