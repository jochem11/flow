import { ColorPicker } from "./ColorPicker";
import { createMemo, createSignal, For, Show } from "solid-js";
import { bounds, type Rect } from "../lib/geometry";
import type { CodeLanguage, FlowEdge } from "../lib/types";
import {
  addLane,
  board,
  checkpoint,
  deleteSelection,
  isContainer,
  unwrapSelection,
  duplicateSelection,
  edgeLine,
  selectedNodes,
  setBend,
  setEdgeProps,
  setNodeText,
  setSelectionColor,
  setUi,
  ui,
  wrapSelectionInSection,
  alignSelection,
  distributeSelection,
  setSelectionLocked,
  setCallColors,
  setPerson,
  addPart,
  addCondition,
  canBeFocal,
  setFocal,
} from "../lib/store";
import { AlignMenu } from "./AlignMenu";
import { deleteSelectionTidy } from "../lib/mindmap";
import { labelPoint } from "./Edges";
import { Menu } from "./Menu";
import { CodeDialog } from "./CodeDialog";
import { classKind, classParts, ROW_NAMES, withClassKind, type ClassKind } from "../lib/umlClass";
import { isLinkable } from "../lib/links";
import { FRAMES } from "./NodeView";
import { currentFlowType } from "./Toolbar";
import { IconCode, IconCopy, IconLock, IconRename, IconUnlock, IconLabelSide, IconUndo, IconPattern, IconLabel, IconPlus, IconSection, IconTrash, IconFocal } from "./icons";
import { FloatingBar, grow } from "./FloatingBar";
import { CardLinksMenu } from "./CardLinksMenu";
import { CapMenu, EndLabelsMenu, NEXT_PATTERN, NEXT_SIDE, PATTERN_NAMES, RELATIONS, SIDE_NAMES, STYLES } from "./EdgeMenus";


const [codeFor, setCodeFor] = createSignal<CodeLanguage | null>(null);

/** Floating bar above the selection: color, duplicate, delete; for an edge its style and arrowheads. */
export function ContextBar() {
  const hidden = () =>
    ui.dragging ||
    !!ui.marquee ||
    !!ui.connecting ||
    ui.panning ||
    !!ui.editingNode ||
    !!ui.editingLane ||
    !!ui.editingRow;

  // What the bar must stay clear of, in world coordinates: the selected blocks with
  // their connection handles and resize handle (and the tab of a package)
  const nodeBox = createMemo(() => {
    const sel = selectedNodes();
    const b = bounds(sel.map((n) => (n.kind === "package" ? { ...n, y: n.y - 28, h: n.h + 28 } : n)));
    return b && grow(b, 20);
  });

  const selectedEdge = (): FlowEdge | undefined => {
    const id = ui.selectedEdge;
    return id ? board.edges.find((x) => x.id === id) : undefined;
  };

  // The whole line with its end dots, end texts and label
  const edgeBox = createMemo(() => {
    const e = selectedEdge();
    const g = e && edgeLine(e);
    if (!e || !g) return null;
    const rects: Rect[] = g.points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }));
    if (e.label) {
      const at = labelPoint(e, g.points);
      const hw = (e.label.length * 7 + 16) / 2;
      rects.push({ x: at.x - hw - 20, y: at.y - 34, w: hw * 2 + 40, h: 68 });
    }
    return grow(bounds(rects)!, 26);
  });

  /** The selected group (section, swimlane, ...), if that is the only thing selected: cards can link to it. */
  const group = () => {
    const sel = selectedNodes();
    return sel.length === 1 && isLinkable(sel[0]) ? sel[0] : null;
  };

  /** The selected UML class, if that is the only thing selected. */
  const umlClass = () => {
    const sel = selectedNodes();
    return sel.length === 1 && sel[0].kind === "class" ? sel[0] : null;
  };

  /** The selected section (or other frame), if that is the only thing selected. */
  const frame = () => {
    const sel = selectedNodes();
    return sel.length === 1 && FRAMES.includes(sel[0].kind) ? sel[0] : null;
  };

  /** The selected swimlane, if that is the only thing selected. */
  const pool = () => {
    const sel = selectedNodes();
    return sel.length === 1 && sel[0].kind === "lanes" ? sel[0] : null;
  };

  /** Sequence diagrams: color each call, its bar and its return (for the whole board) */
  const CallColorsButton = () => (
    <>
      <button
        class="icon-btn"
        classList={{ pressed: !!board.callColors }}
        title="Give each call, its activation bar and its return a color of their own (for this board)"
        onClick={() => setCallColors(!board.callColors)}
      >
        <span>Color calls</span>
      </button>
      <span class="divider" />
    </>
  );

  const currentColor = () => {
    const sel = selectedNodes();
    return sel.length && sel.every((n) => n.color === sel[0].color) ? sel[0].color : null;
  };
  /** The color of their own that all of the selection has, if they do */
  const currentTint = () => {
    const sel = selectedNodes();
    return sel.length && sel[0].tint && sel.every((n) => n.tint === sel[0].tint) ? sel[0].tint : null;
  };

  return (
    <>
      <Show when={codeFor()}>{(l) => <CodeDialog initial={l()} onClose={() => setCodeFor(null)} />}</Show>
      <Show when={!hidden() && nodeBox()}>
        {(box) => (
          <FloatingBar box={box()}>
            <ColorPicker compact color={currentColor()} tint={currentTint()} onPick={setSelectionColor} />
            <span class="divider" />
            <Show when={frame()}>
              {(n) => (
                <button class="icon-btn" title="Rename (Enter)" onClick={() => setUi("editingNode", n().id)}>
                  <IconRename />
                  <span>Rename</span>
                </button>
              )}
            </Show>
            <Show when={group()}>
              {(n) => (
                <>
                  <CardLinksMenu nodeId={n().id} />
                  <span class="divider" />
                </>
              )}
            </Show>
            <Show when={umlClass()}>
              {(n) => (
                <>
                  {/* The kind sets the right «stereotype» above the name */}
                  <select
                    class="bar-select"
                    title="Kind of class"
                    value={classKind(n().text)}
                    onChange={(e) => setNodeText(n().id, withClassKind(n().text, e.currentTarget.value as ClassKind))}
                  >
                    <option value="class">Class</option>
                    <option value="abstract">Abstract class</option>
                    <option value="interface">Interface</option>
                    <option value="enum">Enum</option>
                    <option value="record">Record</option>
                  </select>
                  <For each={classKind(n().text) === "enum" ? [1] : [1, 2]}>
                    {(part) => (
                      <button
                        class="icon-btn"
                        title={`Add ${ROW_NAMES[part]}`}
                        onClick={() =>
                          setUi("editingRow", {
                            node: n().id,
                            part,
                            index: classParts(n().text)[part].length,
                            insert: true,
                          })
                        }
                      >
                        <IconPlus />
                        <span>{part === 2 ? "Operation" : classKind(n().text) === "enum" ? "Value" : "Attribute"}</span>
                      </button>
                    )}
                  </For>
                  <span class="divider" />
                </>
              )}
            </Show>
            {/* What the diagram is about: drawn heavier, in the project's accent */}
            <Show when={selectedNodes().some((n) => canBeFocal(n.kind))}>
              <button
                class="icon-btn"
                classList={{ pressed: selectedNodes().filter((n) => canBeFocal(n.kind)).every((n) => n.focal) }}
                title="Focus: what this diagram is about (one or two blocks), drawn heavier in the project's accent"
                onClick={() => {
                  const ns = selectedNodes().filter((n) => canBeFocal(n.kind));
                  setFocal(ns.map((n) => n.id), !ns.every((n) => n.focal));
                }}
              >
                <IconFocal />
                <span>Focus</span>
              </button>
              <span class="divider" />
            </Show>
            <Show when={selectedNodes().some((n) => n.kind === "lifeline")}>
              <button
                class="icon-btn"
                classList={{ pressed: selectedNodes().filter((n) => n.kind === "lifeline").every((n) => n.person) }}
                title="A person (UML actor): a stick figure instead of a box"
                onClick={() => {
                  const lifelines = selectedNodes().filter((n) => n.kind === "lifeline");
                  setPerson(lifelines.map((n) => n.id), !lifelines.every((n) => n.person));
                }}
              >
                <span>Person</span>
              </button>
              <CallColorsButton />
            </Show>
            {/* A fragment: another part, with its own condition */}
            <Show when={selectedNodes().length === 1 && selectedNodes()[0].kind === "fragment"}>
              <Show when={!selectedNodes()[0].lanes?.length}>
                <button class="icon-btn" title="A condition for it ([every item], [x > 0])" onClick={() => addCondition(selectedNodes()[0].id)}>
                  <IconPlus />
                  <span>Condition</span>
                </button>
              </Show>
              <button class="icon-btn" title="Another part (alt / else, par): split by a dashed line" onClick={() => addPart(selectedNodes()[0].id)}>
                <IconPlus />
                <span>Part</span>
              </button>
              <span class="divider" />
            </Show>
            <Show when={pool()}>
              {(n) => (
                <>
                  <button class="icon-btn" title="Add a lane on the right" onClick={() => addLane(n().id)}>
                    <IconPlus />
                    <span>Lane</span>
                  </button>
                  <span class="divider" />
                </>
              )}
            </Show>
            <Show when={selectedNodes().some((n) => n.kind === "class")}>
              <button
                class="icon-btn"
                title="Code for the selected classes"
                onClick={() => setCodeFor("typescript")}
              >
                <IconCode />
                <span>Code</span>
              </button>
              <span class="divider" />
            </Show>
            <Show when={selectedNodes().length > 1}>
              <AlignMenu count={selectedNodes().length} onAlign={alignSelection} onDistribute={distributeSelection} />
            </Show>
            <Show
              when={selectedNodes().every((n) => n.locked)}
              fallback={
                <button class="icon-btn" title="Lock: it cannot be moved, changed or deleted" onClick={() => setSelectionLocked(true)}>
                  <IconLock />
                </button>
              }
            >
              <button class="icon-btn pressed" title="Unlock" onClick={() => setSelectionLocked(false)}>
                <IconUnlock />
              </button>
            </Show>
            <button class="icon-btn" title="Wrap in a section (Ctrl+G)" onClick={wrapSelectionInSection}>
              <IconSection />
            </button>
            <Show when={selectedNodes().some((n) => isContainer(n.kind) && !n.locked)}>
              <button class="icon-btn" title="Take the frame away, keep what is in it" onClick={unwrapSelection}>
                <span>Unwrap</span>
              </button>
            </Show>
            <button class="icon-btn" title="Duplicate (Ctrl+D)" onClick={duplicateSelection}>
              <IconCopy />
            </button>
            <button
              class="icon-btn danger"
              title={selectedNodes().some((n) => isContainer(n.kind)) ? "Delete, with what is in it (Delete)" : "Delete (Delete)"}
              onClick={deleteSelectionTidy}
            >
              <IconTrash />
            </button>
          </FloatingBar>
        )}
      </Show>

      <Show when={!hidden() && !ui.editingEdge && edgeBox()}>
        {(box) => (
          <FloatingBar box={box()}>
            <For each={STYLES}>
              {(s) => (
                <button
                  class="icon-btn"
                  classList={{ pressed: (selectedEdge()?.style ?? "curved") === s.style }}
                  title={s.title}
                  onClick={() => setEdgeProps(ui.selectedEdge!, { style: s.style })}
                >
                  {s.icon()}
                </button>
              )}
            </For>
            <Show when={selectedEdge()?.bend}>
              <button
                class="icon-btn"
                title="Back to the normal route"
                onClick={() => {
                  checkpoint();
                  setBend(ui.selectedEdge!, undefined);
                }}
              >
                <IconUndo />
                <span>Reset route</span>
              </button>
            </Show>
            <button
              class="icon-btn"
              title={`Line: ${PATTERN_NAMES[selectedEdge()?.pattern ?? "solid"]} (click to change)`}
              onClick={() => setEdgeProps(ui.selectedEdge!, { pattern: NEXT_PATTERN[selectedEdge()?.pattern ?? "solid"] })}
            >
              <IconPattern pattern={selectedEdge()?.pattern ?? "solid"} />
            </button>
            <span class="divider" />
            <CapMenu side="start" edge={selectedEdge()!} />
            <CapMenu side="end" edge={selectedEdge()!} />
            <EndLabelsMenu edge={selectedEdge()!} />
            {/* UML arrow presets, on the board types that use them */}
            <Show when={currentFlowType().umlLines}>
              <Menu
                button={(toggle, open) => (
                  <button class="icon-btn" classList={{ pressed: open() }} title="UML relationship" onClick={toggle}>
                    <span>UML</span>
                  </button>
                )}
              >
                {(close) => (
                  <For each={RELATIONS}>
                    {(group, i) => (
                      <>
                        {i() > 0 && <div class="menu-sep" />}
                        <For each={group}>
                          {(r) => (
                            <button
                              class="menu-item"
                              onClick={() => {
                                setEdgeProps(ui.selectedEdge!, r.props);
                                close();
                              }}
                            >
                              <span>{r.name}</span>
                              <small>{r.hint}</small>
                            </button>
                          )}
                        </For>
                      </>
                    )}
                  </For>
                )}
              </Menu>
            </Show>
            <span class="divider" />
            <Show when={selectedEdge()?.messageY != null}>
              {/* UML: a filled arrowhead waits for the answer, an open one does not */}
              <button
                class="icon-btn"
                classList={{ pressed: (selectedEdge()?.endCap ?? "arrow") === "arrow" }}
                title="Synchronous: the sender waits for the answer (filled arrowhead)"
                onClick={() => setEdgeProps(ui.selectedEdge!, { endCap: "arrow" })}
              >
                <span>Sync</span>
              </button>
              <button
                class="icon-btn"
                classList={{ pressed: selectedEdge()?.endCap === "open" }}
                title="Asynchronous: the sender goes on without waiting (open arrowhead)"
                onClick={() => setEdgeProps(ui.selectedEdge!, { endCap: "open" })}
              >
                <span>Async</span>
              </button>
              <span class="divider" />
              <CallColorsButton />
            </Show>
            <Show when={selectedEdge()?.label}>
              <button
                class="icon-btn"
                title={`Label ${SIDE_NAMES[selectedEdge()!.labelSide ?? "on"]} (click to change)`}
                onClick={() =>
                  setEdgeProps(ui.selectedEdge!, { labelSide: NEXT_SIDE[selectedEdge()!.labelSide ?? "on"] })
                }
              >
                <IconLabelSide side={selectedEdge()!.labelSide ?? "on"} />
              </button>
            </Show>
            <button class="icon-btn" title="Edit label" onClick={() => setUi("editingEdge", ui.selectedEdge)}>
              <IconLabel />
              <span>Label</span>
            </button>
            <button class="icon-btn danger" title="Delete (Delete)" onClick={deleteSelection}>
              <IconTrash />
            </button>
          </FloatingBar>
        )}
      </Show>
    </>
  );
}
