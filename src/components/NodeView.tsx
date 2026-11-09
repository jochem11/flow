import { createEffect, createMemo, createSignal, For, Index, Match, on, onCleanup, onMount, Show, Switch } from "solid-js";
import { cardsLinkedTo, openLinkedCard } from "../lib/links";
import { IconCheck, IconKanban, IconLock } from "./icons";
import { IconDrawing, type IconParts } from "./IconPanel";
import { imageUrl } from "../lib/files";
import { addSiblingTopic, addSubtopic, parentOf } from "../lib/mindmap";
import { Portal } from "solid-js/web";
import type { FlowNode, Lane, NodeKind } from "../lib/types";
import { RESIZE_DIRS, type ResizeDir, type Side } from "../lib/geometry";
import { classKind, classParts, classText, fixOperation, ROW_NAMES, rowProblem } from "../lib/umlClass";
import { rowShown } from "../lib/classModel";
import { canEdit } from "../lib/access";
import { openDocumentById, versionMark } from "../lib/workspace";
import { NEST } from "../lib/sequence";
import { beginConnect, beginLaneResize, beginLine, beginNodeDrag, beginResize, blurActive } from "../lib/interactions";
import {
  checkpoint,
  moveDivider,
  partBounds,
  setPartCondition,
  activationsOf,
  callColorOf,
  board,
  hasText,
  isConnectable,
  isResizable,
  isSelected,
  GRID,
  growFrames,
  removeLane,
  resizeNode,
  select,
  setLaneTitle,
  setNodeText,
  setNodeTextLive,
  setUi,
  toggleSelect,
  ui,
} from "../lib/store";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

const PLACEHOLDER: Partial<Record<NodeKind, string>> = {
  note: "Note",
  label: "Label",
  section: "Section",
  lanes: "Pool",
  object: "Object",
  sendsignal: "Send signal",
  receivesignal: "Accept event",
  timeevent: "Time",
  circle: "",
  comment: "Comment",
  actor: "Actor",
  usecase: "Use case",
  boundary: "System",
  package: "Package",
  lifeline: ":Object",
  fragment: "alt",
};

/** Frames whose title catches the pointer; the inside lets clicks through to the canvas. */
export const FRAMES: NodeKind[] = ["section", "boundary", "package", "fragment"];

/**
 * Shapes drawn as a polygon stretched over the node (viewBox 0..100).
 * The points are relative, so the arrow point of a signal grows with the width.
 */
const OUTLINES: Partial<Record<NodeKind, string>> = {
  diamond: "50,1 99,50 50,99 1,50",
  sendsignal: "0,0 86,0 100,50 86,100 0,100",
  receivesignal: "0,0 100,0 100,100 0,100 14,50",
};

/** Name, attributes and operations of a class: `text` split on lines that are just `--`. */


export function NodeView(p: { node: FlowNode }) {
  const n = p.node;
  const selected = () => isSelected(n.id);
  const editing = () => ui.editingNode === n.id && hasText(n.kind);
  const onlySelected = () => selected() && ui.selected.length === 1;
  const frame = FRAMES.includes(n.kind);
  /** The text before this edit: Escape on a frame's title goes back to it */
  let before = n.text;
  createEffect(on(editing, (ed) => ed && (before = n.text)));
  const rename = renameOnClick(() => onlySelected() && !n.locked, () => setUi("editingNode", n.id));

  // Sections and swimlanes only catch the pointer on their title (see styles.css),
  // but events from there still bubble up to these handlers.
  const onPointerDown = (e: PointerEvent) => {
    // Space or middle mouse button: let the canvas pan instead
    if (e.button !== 0 || ui.spaceDown) return;
    e.stopPropagation();
    if (editing()) return;
    blurActive();
    if (ui.tool === "line") {
      beginLine(e);
      return;
    }
    if (e.shiftKey) {
      toggleSelect(n.id);
      return;
    }
    if (!selected()) select([n.id]);
    beginNodeDrag(e, n.id);
  };

  const text = () => (
    <Show
      when={editing()}
      fallback={
        <div class="node-text" classList={{ placeholder: !n.text }}>
          {n.text || PLACEHOLDER[n.kind] || "Text"}
        </div>
      }
    >
      <TextEditor
        class="node-text editor"
        value={n.text}
        tabDone={n.kind === "topic"}
        multiline={MULTILINE.includes(n.kind)}
        // As it is typed: saved, and seen by others editing together
        onInput={(t) => setNodeTextLive(n.id, t)}
        onDone={(t, key) => {
          setNodeText(n.id, frame && key === "Escape" ? before : t);
          if (ui.editingNode === n.id) setUi("editingNode", null);
          // A mind map topic: Tab goes on with a subtopic, Enter with the next topic (Escape stops)
          if (n.kind === "topic" && key === "Tab") addSubtopic();
          else if (n.kind === "topic" && key === "Enter") addSiblingTopic();
        }}
      />
    </Show>
  );

  return (
    <div
      class={`node node-${n.kind} color-${n.color}`}
      classList={{
        // Viewing an old version: gone from the board now, or changed since
        "version-gone": versionMark(n.id) === "gone",
        "version-changed": versionMark(n.id) === "changed",
        selected: selected(),
        editing: editing(),
        focal: !!n.focal,
        target: ui.connecting?.target === n.id,
        "drop-target": ui.dropTarget === n.id,
        // The topic a mind map starts from
        "topic-root": n.kind === "topic" && !parentOf(n.id, board.nodes, board.edges),
        // All its linked cards are done
        "cards-done": cardsLinkedTo(n.id).length > 0 && cardsLinkedTo(n.id).every((c) => c.done),
      }}
      data-node-id={n.id}
      aria-label={n.text.trim() ? n.text.trim().split("\n")[0] : n.kind}
      style={{
        transform: `translate(${n.x}px, ${n.y}px)`,
        width: `${n.w}px`,
        height: `${n.h}px`,
      }}
      onPointerDown={onPointerDown}
      onDblClick={(e) => {
        e.stopPropagation();
        select([n.id]);
        // A chart block: its chart board
        if (n.kind === "chart" && n.chart) return void openDocumentById(n.chart.documentId);
        if (hasText(n.kind) && !n.locked) setUi("editingNode", n.id);
      }}
    >
      <Switch fallback={<div class="node-body">{hasText(n.kind) && text()}</div>}>
        <Match when={OUTLINES[n.kind]}>
          {(points) => (
            <>
              <svg class="outline-shape" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon points={points()} vector-effect="non-scaling-stroke" />
              </svg>
              <div class="node-body">{text()}</div>
            </>
          )}
        </Match>
        <Match when={n.kind === "comment"}>
          {/* Folded corner, a fixed size whatever the node size */}
          <svg class="outline-shape" width="100%" height="100%">
            <path d={`M 0.75 0.75 H ${n.w - 14} L ${n.w - 0.75} 14 V ${n.h - 0.75} H 0.75 Z`} />
            <path d={`M ${n.w - 14} 0.75 V 14 H ${n.w - 0.75}`} class="fold" />
          </svg>
          <div class="node-body">{text()}</div>
        </Match>
        <Match when={n.kind === "flowfinal" || n.kind === "destroy"}>
          <svg class="outline-shape" viewBox="0 0 40 40" preserveAspectRatio="none">
            <Show when={n.kind === "flowfinal"}>
              <circle cx="20" cy="20" r="19" vector-effect="non-scaling-stroke" />
            </Show>
            <path
              d={n.kind === "flowfinal" ? "M 7 7 L 33 33 M 33 7 L 7 33" : "M 2 2 L 38 38 M 38 2 L 2 38"}
              class="cross"
              vector-effect="non-scaling-stroke"
            />
          </svg>
        </Match>
        <Match when={n.kind === "actor" || n.kind === "timeevent"}>
          <div class="node-figure">
            <svg viewBox={n.kind === "actor" ? "0 0 40 64" : "0 0 40 40"} preserveAspectRatio="xMidYMid meet">
              <Show
                when={n.kind === "actor"}
                fallback={<path d="M 6 2 H 34 L 6 38 H 34 Z" vector-effect="non-scaling-stroke" />}
              >
                <circle cx="20" cy="9" r="7" vector-effect="non-scaling-stroke" />
                <path d="M 20 16 V 40 M 5 25 H 35 M 20 40 L 8 62 M 20 40 L 32 62" vector-effect="non-scaling-stroke" />
              </Show>
            </svg>
          </div>
          <div class="node-caption">{text()}</div>
        </Match>
        <Match when={n.kind === "class"}>
          <ClassBody node={n} />
        </Match>
        <Match when={n.kind === "image"}>
          <div class="image-body">
            <Show when={n.image && imageUrl(n.image)} fallback={<span class="image-loading">{n.text || "Image"}</span>}>
              {(src) => <img src={src()} alt={n.text} draggable={false} />}
            </Show>
          </div>
        </Match>
        <Match when={n.kind === "chart"}>
          {/* A chart board's drawing: as an image, so nothing in it can run */}
          <div class="chart-block" title="Double-click to open the chart">
            <Show when={n.chart?.svg} fallback={<span class="image-loading">Chart</span>}>
              {(svg) => <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg())}`} alt={n.text || "Chart"} draggable={false} />}
            </Show>
          </div>
        </Match>
        <Match when={n.kind === "icon"}>
          <IconDrawing class="icon-drawing" parts={(n.icon ?? []) as IconParts} />
        </Match>
        <Match when={n.kind === "lifeline"}>
          {/* A person: a stick figure above the name instead of a box */}
          <div class="node-body" classList={{ person: !!n.person }}>
            <Show when={n.person}>
              <svg class="person-figure" viewBox="0 0 40 64" aria-hidden="true">
                <circle cx="20" cy="9" r="7" />
                <path d="M 20 16 V 40 M 5 25 H 35 M 20 40 L 8 62 M 20 40 L 32 62" />
              </svg>
            </Show>
            {text()}
          </div>
          {/* Dragging from the dashed line draws a message at that height */}
          <div
            class="lifeline-line"
            title="Drag to another lifeline to send a message"
            onPointerDown={(e) => {
              if (e.button !== 0 || ui.spaceDown || ui.tool !== "select") return;
              e.stopPropagation();
              blurActive();
              beginConnect(e, n.id);
            }}
          />
          {/* Activation bars follow from the messages (see sequence.ts) */}
          <For each={activationsOf(n.id)}>
            {([top, bottom, level, call]) => (
              <div
                class={callColorOf(call) ? `activation-bar call color-${callColorOf(call)}` : "activation-bar"}
                style={{ top: `${top - n.y}px`, height: `${bottom - top}px`, translate: `${level * NEST}px 0` }}
              />
            )}
          </For>
        </Match>
        <Match when={FRAMES.includes(n.kind)}>
          <div class="node-body" />
          <div class="frame-title" title={editing() ? undefined : "Click again or double-click to rename"} {...rename}>
            <Show when={n.kind === "fragment"}>
              <svg class="outline-shape" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon points="0,0 100,0 100,60 82,100 0,100" vector-effect="non-scaling-stroke" />
              </svg>
            </Show>
            {text()}
          </div>
          <Show when={n.kind === "fragment" && (n.lanes?.length ?? 0) > 1}>
            <FragmentParts node={n} />
          </Show>
        </Match>
        <Match when={n.kind === "lanes"}>
          <div class="node-body" />
          <div class="pool-header">{text()}</div>
          <Lanes node={n} />
        </Match>
      </Switch>

      <Show when={cardsLinkedTo(n.id).length}>
        <LinkedCardsBadge nodeId={n.id} />
      </Show>

      <Show when={isConnectable(n.kind) && !editing() && !ui.dragging}>
        <For each={SIDES}>
          {(side) => (
            <div
              class={`handle handle-${side}`}
              title="Drag to connect"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                blurActive();
                beginConnect(e, n.id);
              }}
            />
          )}
        </For>
      </Show>

      <Show when={n.locked}>
        <span class="lock-badge" title="Locked">
          <IconLock />
        </span>
      </Show>

      <Show when={onlySelected() && !editing() && isResizable(n.kind) && !n.locked}>
        {/* A section by any side or corner; a block by its bottom-right corner */}
        <For each={frame ? RESIZE_DIRS : (["se"] as ResizeDir[])}>
          {(dir) => (
            <div
              class={`resize-handle ${dir}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                beginResize(e, n.id, dir);
              }}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

/**
 * A class: the name, then attributes and operations. Each row is edited on its own
 * (double-click it), the context bar adds rows, and a row left empty is removed.
 * The node grows to fit. Stored in `text` (see umlClass.ts).
 */
function ClassBody(p: { node: FlowNode }) {
  const parts = createMemo(() => classParts(p.node.text));
  /** The row being edited, if it is in this class */
  const row = () => (ui.editingRow?.node === p.node.id ? ui.editingRow : null);
  const setRow = (part: number, index: number, insert = false) =>
    setUi("editingRow", { node: p.node.id, part, index, insert });
  /** Is row `index` of compartment `part` being edited (or a new row being typed there)? */
  const isRow = (part: number, index: number, insert = false) =>
    row()?.part === part && row()?.index === index && !!row()?.insert === insert;
  const editingName = () => ui.editingNode === p.node.id;
  const active = () => isSelected(p.node.id) && ui.selected.length === 1 && !ui.dragging;
  let body!: HTMLDivElement;

  /** Rows not in UML notation are marked; not on a board with its checks off (free text is a note there) */
  const problem = (part: number, line: string) => (board.relaxed ? null : rowProblem(classKind(p.node.text), part, line));

  const save = (fn: (parts: string[][]) => void) => {
    const next = parts().map((rows) => [...rows]);
    fn(next);
    setNodeText(p.node.id, classText(next));
  };

  /**
   * Saves a row; an empty row is removed (or a new one not added).
   * Enter on a filled row opens a new row below it, to type the next one straight away.
   */
  const commitRow = (part: number, index: number, value: string, insert: boolean, key?: string) => {
    // An operation without its () gets them: `+ getName: name` → `+ getName(): name`
    const typed = value.replace(/\n/g, " ").trim();
    const fixed = part === 2 ? fixOperation(typed) : typed;
    const line = fixed;
    save((next) => {
      if (insert) {
        if (line) next[part].splice(index, 0, line);
      } else if (line) next[part][index] = line;
      else next[part].splice(index, 1);
    });
    if (!isRow(part, index, insert)) return;
    if (key === "Enter" && line) setRow(part, index + 1, true);
    else setUi("editingRow", null);
  };
  const newRow = (part: number, index: number) => (
    <TextEditor
      class="class-row editor"
      value=""
      onDone={(t, key) => commitRow(part, index, t, true, key)}
    />
  );

  // Grow when the rows no longer fit (the checkpoint of the text change covers this too)
  createEffect(
    on([parts, row], () =>
      requestAnimationFrame(() => {
        if (body && body.scrollHeight > body.clientHeight + 1) {
          resizeNode(p.node.id, p.node.w, Math.ceil(body.scrollHeight / GRID) * GRID);
          growFrames([p.node.id]);
        }
      }),
    ),
  );

  return (
    <div class="node-body" ref={body}>
      <Index each={parts()}>
        {(rows, part) => (
          <div class="compartment" classList={{ title: part === 0 }}>
            <Show
              when={part > 0}
              fallback={
                <Show
                  when={editingName()}
                  fallback={
                    <div class="class-name" classList={{ placeholder: !rows().length }}>
                      {rows().join("\n") || "ClassName"}
                    </div>
                  }
                >
                  <TextEditor
                    class="class-name editor"
                    value={rows().join("\n")}
                    onDone={(t) => {
                      save((next) => (next[0] = t.split("\n").filter((l) => l.trim())));
                      if (ui.editingNode === p.node.id) setUi("editingNode", null);
                    }}
                  />
                </Show>
              }
            >
              <Index each={rows()}>
                {(value, index) => (
                  <>
                    <Show when={isRow(part, index, true)}>{newRow(part, index)}</Show>
                    {/* A row the board's level of detail hides (still there, and edited when shown) */}
                    <Show when={rowShown(part, classKind(p.node.text), value(), board.classDetail) || isRow(part, index)}>
                    <Show
                      when={isRow(part, index)}
                      fallback={
                        <div
                          class="class-row"
                          classList={{ invalid: !!problem(part, value()) }}
                          title={problem(part, value()) ?? undefined}
                          onDblClick={(e) => {
                            e.stopPropagation();
                            select([p.node.id]);
                            setRow(part, index);
                          }}
                        >
                          <span>{value()}</span>
                          <Show when={active()}>
                            <button
                              class="class-row-remove"
                              title={`Remove ${ROW_NAMES[part] || "row"}`}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => save((next) => next[part].splice(index, 1))}
                            >
                              ×
                            </button>
                          </Show>
                        </div>
                      }
                    >
                      <TextEditor
                        class="class-row editor"
                        value={value()}
                        onDone={(t, key) => commitRow(part, index, t, false, key)}
                      />
                    </Show>
                    </Show>
                  </>
                )}
              </Index>
              <Show when={isRow(part, rows().length, true)}>{newRow(part, rows().length)}</Show>
            </Show>
          </div>
        )}
      </Index>
    </div>
  );
}

/** Kanban cards linked to this block: a count, and a list to open them from. */
export function LinkedCardsBadge(p: { nodeId: string }) {
  /** Where the list goes (screen position under the badge), or null when closed */
  const [open, setOpen] = createSignal<{ x: number; y: number } | null>(null);
  const cards = () => cardsLinkedTo(p.nodeId);
  const doneCount = () => cards().filter((c) => c.done).length;
  let el!: HTMLDivElement;
  let list: HTMLDivElement | undefined;
  const onDoc = (e: PointerEvent) => {
    const t = e.target as Node;
    if (open() && !el.contains(t) && !list?.contains(t)) setOpen(null);
  };
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));
  // The list does not follow the canvas, so close it when that moves
  createEffect(on([() => board.camera.x, () => board.camera.y, () => board.camera.zoom], () => setOpen(null), { defer: true }));

  return (
    <div class="link-badge-wrap" ref={el} onPointerDown={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
      <button
        class="link-badge"
        classList={{ done: cards().every((c) => c.done) }}
        title={`${cards().length} linked card${cards().length === 1 ? "" : "s"}, ${doneCount()} done`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setOpen(open() ? null : { x: r.right, y: r.bottom + 6 });
        }}
      >
        <Show when={cards().every((c) => c.done)} fallback={<IconKanban />}>
          <IconCheck />
        </Show>
        {/* How far the work is: done of all, or just the count while none is done */}
        {doneCount() && doneCount() < cards().length ? `${doneCount()}/${cards().length}` : cards().length}
      </button>
      {/* In <body>, so it is above every block, also for a section (drawn below the blocks) */}
      <Show when={open()}>
        {(at) => (
          <Portal>
            <div
              ref={list}
              class="link-popover panel"
              style={{ left: `${at().x}px`, top: `${at().y}px` }}
            >
              <For each={cards()}>
                {(c) => (
                  <button class="link-popover-item" onClick={() => openLinkedCard(c.boardId, c.cardId)}>
                    <span classList={{ "is-done": c.done }}>{c.title}</span>
                    <small>
                      {c.boardName} · {c.column}
                    </small>
                  </button>
                )}
              </For>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}

/** The lanes of a swimlane, left to right. Dragging a lane header moves the whole pool. */
function Lanes(p: { node: FlowNode }) {
  const lefts = createMemo(() => {
    let x = 0;
    return (p.node.lanes ?? []).map((l) => (x += l.size) - l.size);
  });

  return (
    <Index each={p.node.lanes ?? []}>
      {(lane, i) => (
        <div class="lane" style={{ left: `${lefts()[i]}px`, width: `${lane().size}px` }}>
          <LaneHeader node={p.node} lane={lane()} />
          {/* The right border of the last lane is the resize handle of the whole pool */}
          <Show when={i < lefts().length - 1}>
            <div
              class="lane-resizer"
              title="Drag to resize the lane"
              onPointerDown={(e) => {
                if (e.button !== 0 || ui.spaceDown) return;
                e.stopPropagation();
                blurActive();
                beginLaneResize(e, p.node.id, i);
              }}
            />
          </Show>
        </div>
      )}
    </Index>
  );
}

function LaneHeader(p: { node: FlowNode; lane: Lane }) {
  const editing = () => ui.editingLane === p.lane.id;

  return (
    <div
      class="lane-header"
      onDblClick={(e) => {
        e.stopPropagation();
        select([p.node.id]);
        setUi("editingLane", p.lane.id);
      }}
    >
      <Show
        when={editing()}
        fallback={
          <div class="lane-title" classList={{ placeholder: !p.lane.title }}>
            {p.lane.title || "Lane"}
          </div>
        }
      >
        <TextEditor
          class="lane-title editor"
          value={p.lane.title}
          onDone={(t) => {
            setLaneTitle(p.node.id, p.lane.id, t);
            if (ui.editingLane === p.lane.id) setUi("editingLane", null);
          }}
        />
      </Show>
      <Show when={(p.node.lanes?.length ?? 0) > 1 && !editing()}>
        <button
          class="lane-remove"
          title="Remove lane"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => removeLane(p.node.id, p.lane.id)}
        >
          ×
        </button>
      </Show>
    </div>
  );
}

/**
 * A title renamed like a file: clicking it again when it is the only thing selected
 * (without dragging) starts typing. Spread the result onto the title's element.
 */
export function renameOnClick(onlySelected: () => boolean, start: () => void) {
  let armed = false;
  let at = { x: 0, y: 0 };
  return {
    // Before the block's own pointerdown (which selects it) has run
    onPointerDown: (e: PointerEvent) => {
      armed = e.button === 0 && !e.shiftKey && onlySelected();
      at = { x: e.clientX, y: e.clientY };
    },
    onClick: (e: MouseEvent) => {
      if (armed && Math.hypot(e.clientX - at.x, e.clientY - at.y) < 3 && canEdit()) start();
      armed = false;
    },
  };
}

/** Blocks holding a remark of several lines: Enter starts a new line in them */
const MULTILINE: NodeKind[] = ["note", "callout", "comment"];

/**
 * Plain-text editor that commits on blur. Enter finishes, Shift+Enter inserts a new line;
 * `multiline` the other way round (Enter: a new line, Cmd/Ctrl+Enter finishes).
 * `onDone` gets the key that finished editing ("Enter" or "Escape"), if any.
 */
export function TextEditor(p: {
  value: string;
  class: string;
  onDone: (text: string, key?: string) => void;
  onInput?: (text: string) => void;
  /** Tab finishes too (instead of moving the focus) */
  tabDone?: boolean;
  /** Enter makes a new line; Cmd/Ctrl+Enter finishes */
  multiline?: boolean;
}) {
  let ref!: HTMLDivElement;
  let key: string | undefined;

  onMount(() => {
    ref.textContent = p.value;
    ref.focus();
    const range = document.createRange();
    range.selectNodeContents(ref);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });

  return (
    <div
      ref={ref}
      class={p.class}
      contentEditable="plaintext-only"
      spellcheck={false}
      onBlur={() => p.onDone(ref.innerText.replace(/\n+$/, ""), key)}
      onInput={() => p.onInput?.(ref.innerText.replace(/\n+$/, ""))}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        const enterDone = p.multiline ? e.metaKey || e.ctrlKey : !e.shiftKey;
        if (e.key === "Escape" || (e.key === "Enter" && enterDone) || (e.key === "Tab" && p.tabDone)) {
          e.preventDefault();
          key = e.key;
          ref.blur();
        }
      }}
    />
  );
}

/**
 * A fragment's parts (alt, par, ...): a dashed line above each but the first,
 * which can be dragged (fragments.ts). Their conditions are on the top layer
 * (FragmentConditions), so no lifeline or activation bar hides them.
 */
function FragmentParts(p: { node: FlowNode }) {
  const parts = () => p.node.lanes ?? [];
  const bounds = () => partBounds(parts(), p.node.h);
  const startDrag = (e: PointerEvent, index: number) => {
    if (!canEdit() || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    checkpoint();
    const startY = e.clientY;
    const startTop = bounds()[index].top;
    const move = (ev: PointerEvent) => moveDivider(p.node.id, index, startTop + (ev.clientY - startY) / board.camera.zoom);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <Index each={parts()}>
      {(_, i) => (
        <Show when={i > 0}>
          <div class="fragment-divider" style={{ top: `${bounds()[i]?.top ?? 0}px` }} title="Drag to move" onPointerDown={(e) => startDrag(e, i)} />
        </Show>
      )}
    </Index>
  );
}

/**
 * The conditions of the fragments' parts (`[paid]`, `[else]`), on the board's top
 * layer: the first part's at the top right (clear of the title), the others' at
 * the top left of their part. Typing in one changes it.
 */
export function FragmentConditions() {
  const fragments = createMemo(() => board.nodes.filter((n) => n.kind === "fragment" && (n.lanes?.length ?? 0) > 0));
  return (
    <For each={fragments()}>
      {(n) => {
        const bounds = () => partBounds(n.lanes ?? [], n.h);
        return (
          <Index each={n.lanes ?? []}>
            {(part, i) => (
              <div
                class="fragment-condition"
                classList={{ first: i === 0 }}
                data-fragment={n.id}
                style={{
                  left: `${i === 0 ? n.x + n.w - 10 : n.x + 10}px`,
                  top: `${n.y + (bounds()[i]?.top ?? 0) + (i === 0 ? 4 : 6)}px`,
                }}
              >
                <span>[</span>
                <span class="grow" data-value={part().title || "condition"}>
                  <input
                    value={part().title}
                    placeholder="condition"
                    readOnly={!canEdit()}
                    size={1}
                    onInput={(e) => (e.currentTarget.parentElement!.dataset.value = e.currentTarget.value || "condition")}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDblClick={(e) => e.stopPropagation()}
                    onChange={(e) => setPartCondition(n.id, part().id, e.currentTarget.value.trim().replace(/^\[|\]$/g, ""))}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                  />
                </span>
                <span>]</span>
              </div>
            )}
          </Index>
        );
      }}
    </For>
  );
}
