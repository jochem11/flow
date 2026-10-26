import { For, onMount, Show } from "solid-js";
import type { FlowNode } from "../lib/types";
import type { Side } from "../lib/geometry";
import { beginConnect, beginNodeDrag, beginResize, blurActive } from "../lib/interactions";
import { isSelected, select, setNodeText, setUi, toggleSelect, ui } from "../lib/store";

const SIDES: Side[] = ["top", "right", "bottom", "left"];

export function NodeView(p: { node: FlowNode }) {
  const n = p.node;
  const selected = () => isSelected(n.id);
  const editing = () => ui.editingNode === n.id;
  const onlySelected = () => selected() && ui.selected.length === 1;

  const onPointerDown = (e: PointerEvent) => {
    // Spatie of middelste knop: laat de canvas pannen
    if (e.button !== 0 || ui.spaceDown) return;
    e.stopPropagation();
    if (editing()) return;
    blurActive();
    if (e.shiftKey) {
      toggleSelect(n.id);
      return;
    }
    if (!selected()) select([n.id]);
    beginNodeDrag(e, n.id);
  };

  return (
    <div
      class={`node node-${n.kind} color-${n.color}`}
      classList={{
        selected: selected(),
        editing: editing(),
        target: ui.connecting?.target === n.id,
      }}
      data-node-id={n.id}
      style={{
        transform: `translate(${n.x}px, ${n.y}px)`,
        width: `${n.w}px`,
        height: `${n.h}px`,
      }}
      onPointerDown={onPointerDown}
      onDblClick={(e) => {
        e.stopPropagation();
        select([n.id]);
        setUi("editingNode", n.id);
      }}
    >
      <Show when={n.kind === "diamond"}>
        <svg class="diamond-shape" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polygon points="50,1 99,50 50,99 1,50" vector-effect="non-scaling-stroke" />
        </svg>
      </Show>

      <div class="node-body">
        <Show
          when={editing()}
          fallback={
            <div class="node-text" classList={{ placeholder: !n.text }}>
              {n.text || (n.kind === "note" ? "Notitie" : "Tekst")}
            </div>
          }
        >
          <NodeEditor node={n} />
        </Show>
      </div>

      <Show when={!editing() && !ui.dragging}>
        <For each={SIDES}>
          {(side) => (
            <div
              class={`handle handle-${side}`}
              title="Sleep om te verbinden"
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

      <Show when={onlySelected() && !editing()}>
        <div
          class="resize-handle"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            beginResize(e, n.id);
          }}
        />
      </Show>
    </div>
  );
}

function NodeEditor(p: { node: FlowNode }) {
  let ref!: HTMLDivElement;

  onMount(() => {
    ref.textContent = p.node.text;
    ref.focus();
    const range = document.createRange();
    range.selectNodeContents(ref);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  });

  const finish = () => {
    setNodeText(p.node.id, ref.innerText.replace(/\n+$/, ""));
    if (ui.editingNode === p.node.id) setUi("editingNode", null);
  };

  return (
    <div
      ref={ref}
      class="node-text editor"
      contentEditable="plaintext-only"
      spellcheck={false}
      onBlur={finish}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Enter = klaar, Shift+Enter = nieuwe regel
        if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          ref.blur();
        }
      }}
    />
  );
}
