// Icons on a flowchart: a searchable panel of the Lucide set (ISC licence),
// loaded only when it is opened, and the drawing of an icon block. An icon block
// keeps its shapes (so the export can draw it); only plain shapes and their
// geometry are ever drawn, whatever a board holds.

import { createResource, createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { pastePoint } from "../lib/camera";
import { addNode, createNode } from "../lib/store";

export type IconParts = [string, Record<string, string>][];

const TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const ATTRS = new Set(["d", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points"]);

/** An icon's shapes, in a 24×24 box, drawn as lines in the current color */
export function IconDrawing(p: { parts: IconParts; class?: string }) {
  return (
    <svg class={p.class} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <For each={p.parts.filter(([tag]) => TAGS.has(tag))}>
        {([tag, attrs]) => <Dynamic component={tag} {...Object.fromEntries(Object.entries(attrs).filter(([k]) => ATTRS.has(k)))} />}
      </For>
    </svg>
  );
}

/** "ArrowBigDown" → "arrow big down", for searching */
const words = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

/** The icon set, loaded the first time the panel opens */
const loadIcons = async () => {
  const { icons } = await import("lucide");
  return Object.entries(icons).map(([name, parts]) => ({ name, words: words(name), parts: parts as unknown as IconParts }));
};

export function IconPanel(p: { onClose: () => void }) {
  const [icons] = createResource(loadIcons);
  const [query, setQuery] = createSignal("");
  const shown = () => {
    const q = query().trim().toLowerCase();
    const all = icons() ?? [];
    return (q ? all.filter((i) => i.words.includes(q)) : all).slice(0, 120);
  };
  const add = (name: string, parts: IconParts) => {
    const at = pastePoint();
    addNode(createNode("icon", at.x, at.y, { icon: parts, text: words(name) }));
    p.onClose();
  };
  return (
    <div class="icon-panel panel" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
      <input class="kd-input" placeholder="Search icons… (database, user, cloud)" value={query()} onInput={(e) => setQuery(e.currentTarget.value)} ref={(el) => setTimeout(() => el.focus())} />
      <Show when={!icons.loading} fallback={<div class="icon-panel-note">Loading icons…</div>}>
        <div class="icon-grid">
          <For each={shown()} fallback={<div class="icon-panel-note">No icons for “{query()}”</div>}>
            {(i) => (
              <button class="tool-btn" title={words(i.name)} onClick={() => add(i.name, i.parts)}>
                <IconDrawing parts={i.parts} />
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
