import { createMemo, For, Show } from "solid-js";
import { toScreen } from "../lib/camera";
import { bounds, edgeBetween } from "../lib/geometry";
import type { NodeColor } from "../lib/types";
import {
  board,
  deleteSelection,
  duplicateSelection,
  nodeById,
  selectedNodes,
  setSelectionColor,
  setUi,
  ui,
} from "../lib/store";
import { IconCopy, IconLabel, IconTrash } from "./icons";

const COLORS: NodeColor[] = ["white", "yellow", "green", "blue", "purple", "pink"];
const COLOR_NAMES: Record<NodeColor, string> = {
  white: "Wit",
  yellow: "Geel",
  green: "Groen",
  blue: "Blauw",
  purple: "Paars",
  pink: "Roze",
};

/** Zwevende balk boven de selectie: kleur, dupliceren, verwijderen. */
export function ContextBar() {
  const hidden = () => ui.dragging || !!ui.marquee || !!ui.connecting || ui.panning || !!ui.editingNode;

  const nodeAnchor = createMemo(() => {
    const b = bounds(selectedNodes());
    if (!b) return null;
    // toScreen leest de camera, dus dit beweegt mee bij pannen/zoomen
    return toScreen(b.x + b.w / 2, b.y);
  });

  const edgeAnchor = createMemo(() => {
    const id = ui.selectedEdge;
    const e = id ? board.edges.find((x) => x.id === id) : undefined;
    if (!e) return null;
    const a = nodeById(e.from);
    const b = nodeById(e.to);
    if (!a || !b) return null;
    const mid = edgeBetween(a, b).mid;
    return toScreen(mid.x, mid.y - 18 / board.camera.zoom);
  });

  const currentColor = () => {
    const sel = selectedNodes();
    return sel.length && sel.every((n) => n.color === sel[0].color) ? sel[0].color : null;
  };

  return (
    <>
      <Show when={!hidden() && nodeAnchor()}>
        {(pos) => (
          <div
            class="context-bar"
            style={{ left: `${pos().x}px`, top: `${pos().y - 14}px` }}
            onPointerDown={(e) => e.stopPropagation()}
            onDblClick={(e) => e.stopPropagation()}
          >
            <For each={COLORS}>
              {(c) => (
                <button
                  class={`swatch color-${c}`}
                  classList={{ active: currentColor() === c }}
                  title={COLOR_NAMES[c]}
                  onClick={() => setSelectionColor(c)}
                />
              )}
            </For>
            <span class="divider" />
            <button class="icon-btn" title="Dupliceren (Ctrl+D)" onClick={duplicateSelection}>
              <IconCopy />
            </button>
            <button class="icon-btn danger" title="Verwijderen (Delete)" onClick={deleteSelection}>
              <IconTrash />
            </button>
          </div>
        )}
      </Show>

      <Show when={!hidden() && !ui.editingEdge && edgeAnchor()}>
        {(pos) => (
          <div
            class="context-bar"
            style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
            onPointerDown={(e) => e.stopPropagation()}
            onDblClick={(e) => e.stopPropagation()}
          >
            <button class="icon-btn" title="Label bewerken" onClick={() => setUi("editingEdge", ui.selectedEdge)}>
              <IconLabel />
              <span>Label</span>
            </button>
            <button class="icon-btn danger" title="Verwijderen (Delete)" onClick={deleteSelection}>
              <IconTrash />
            </button>
          </div>
        )}
      </Show>
    </>
  );
}
