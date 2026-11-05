// Finding things on a flowchart or EER diagram (Ctrl+F), and the minimap: the
// whole board small in a corner, with a frame for what is in view; drag it to move.

import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { focusOn, viewportRect } from "../lib/camera";
import { eer, eerViewportRect, entityRect, setEerCamera, setEerSelected } from "../lib/eer";
import type { Rect } from "../lib/geometry";
import { bounds } from "../lib/geometry";
import { board, isContainer, select, setCamera } from "../lib/store";
import type { Camera } from "../lib/types";
import { openDoc } from "../lib/workspace";
import { IconClose } from "./icons";

/** The open canvas: its camera, its size on screen, and how to move it */
function canvas(): { cam: Camera; view: DOMRect | null; set: (c: Partial<Camera>) => void } {
  return openDoc()?.kind === "eer"
    ? { cam: eer.camera, view: eerViewportRect(), set: setEerCamera }
    : { cam: board.camera, view: viewportRect(), set: (c) => setCamera(c) };
}

// ---------- find ----------

const [findOpen, setFindOpen] = createSignal(false);
export const openFind = () => setFindOpen(true);

interface Hit {
  id: string;
  label: string;
  rect: Rect;
}

/** What matches the text: blocks by their text; tables by their name or a column's name */
function search(q: string): Hit[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  if (openDoc()?.kind === "eer") {
    return eer.entities
      .filter((e) => e.name.toLowerCase().includes(t) || e.attributes.some((a) => a.name.toLowerCase().includes(t)))
      .map((e) => ({ id: e.id, label: e.name, rect: entityRect(e) }));
  }
  return board.nodes
    .filter((n) => n.text.toLowerCase().includes(t) || n.lanes?.some((l) => l.title.toLowerCase().includes(t)))
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((n) => ({ id: n.id, label: n.text.split("\n")[0], rect: n }));
}

function show(hit: Hit) {
  if (openDoc()?.kind === "eer") {
    setEerSelected({ kind: "entity", id: hit.id });
    const { cam, view, set } = canvas();
    if (view) set({ x: view.width / 2 - (hit.rect.x + hit.rect.w / 2) * cam.zoom, y: view.height / 2 - (hit.rect.y + hit.rect.h / 2) * cam.zoom });
  } else {
    select([hit.id]);
    focusOn(hit.rect);
  }
}

export function FindBar() {
  const [query, setQuery] = createSignal("");
  const [at, setAt] = createSignal(0);
  const hits = createMemo(() => search(query()));
  const go = (by: number) => {
    const list = hits();
    if (!list.length) return;
    const i = (at() + by + list.length) % list.length;
    setAt(i);
    show(list[i]);
  };
  return (
    <Show when={findOpen()}>
      <div class="find-bar panel" onPointerDown={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
        <input
          class="find-input"
          placeholder={openDoc()?.kind === "eer" ? "Find a table or column" : "Find on the board"}
          value={query()}
          ref={(el) => setTimeout(() => el.focus())}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setAt(0);
            const first = search(e.currentTarget.value)[0];
            if (first) show(first);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") go(e.shiftKey ? -1 : 1);
            if (e.key === "Escape") setFindOpen(false);
          }}
        />
        <span class="find-count">{query().trim() ? (hits().length ? `${at() + 1} of ${hits().length}` : "None") : ""}</span>
        <button class="icon-btn small" title="Previous (Shift+Enter)" disabled={!hits().length} onClick={() => go(-1)}>
          ↑
        </button>
        <button class="icon-btn small" title="Next (Enter)" disabled={!hits().length} onClick={() => go(1)}>
          ↓
        </button>
        <button class="icon-btn small" title="Close (Esc)" onClick={() => setFindOpen(false)}>
          <IconClose />
        </button>
      </div>
    </Show>
  );
}

// ---------- minimap ----------

const W = 200;
const H = 130;

/** Hidden until asked for (it covers a corner of the board); then remembered */
function loadShown() {
  try {
    return localStorage.getItem("flow:minimap") === "on";
  } catch {
    return false;
  }
}
const [mapShown, setMapShown] = createSignal(loadShown());
function toggleMap() {
  setMapShown(!mapShown());
  try {
    localStorage.setItem("flow:minimap", mapShown() ? "on" : "off");
  } catch {
    /* no storage here */
  }
}

export function Minimap() {
  /** Everything on the board: frames as outlines, the rest filled */
  const items = createMemo((): (Rect & { frame: boolean })[] =>
    openDoc()?.kind === "eer"
      ? [...eer.sections.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h, frame: true })), ...eer.entities.map((e) => ({ ...entityRect(e), frame: false }))]
      : board.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h, frame: isContainer(n.kind) })),
  );
  /** What is in view, in world coordinates */
  const view = () => {
    const { cam, view } = canvas();
    if (!view) return null;
    return { x: -cam.x / cam.zoom, y: -cam.y / cam.zoom, w: view.width / cam.zoom, h: view.height / cam.zoom };
  };
  /** The world area the map shows (the board and the view), and its scale */
  const frame = createMemo(() => {
    const v = view();
    const all = bounds([...items(), ...(v ? [v] : [])]);
    if (!all) return null;
    const pad = 40;
    const box = { x: all.x - pad, y: all.y - pad, w: all.w + pad * 2, h: all.h + pad * 2 };
    const k = Math.min(W / box.w, H / box.h);
    return { box, k, ox: (W - box.w * k) / 2, oy: (H - box.h * k) / 2 };
  });
  const px = (r: Rect) => {
    const f = frame()!;
    return { x: f.ox + (r.x - f.box.x) * f.k, y: f.oy + (r.y - f.box.y) * f.k, w: r.w * f.k, h: r.h * f.k };
  };
  /** Moves the view so its middle is at this point of the map */
  const moveTo = (e: PointerEvent, svg: SVGSVGElement) => {
    const f = frame();
    const { cam, view: v, set } = canvas();
    if (!f || !v) return;
    const r = svg.getBoundingClientRect();
    const wx = f.box.x + (e.clientX - r.left - f.ox) / f.k;
    const wy = f.box.y + (e.clientY - r.top - f.oy) / f.k;
    set({ x: v.width / 2 - wx * cam.zoom, y: v.height / 2 - wy * cam.zoom });
  };
  let stop: (() => void) | undefined;
  onCleanup(() => stop?.());
  return (
    <Show
      when={mapShown()}
      fallback={
        <button class="minimap-toggle panel" title="Show the minimap" onClick={toggleMap}>
          Map
        </button>
      }
    >
      <div class="minimap panel" onPointerDown={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
        <svg
          width={W}
          height={H}
          onPointerDown={(e) => {
            const svg = e.currentTarget;
            moveTo(e, svg);
            const move = (ev: PointerEvent) => moveTo(ev, svg);
            const up = () => stop?.();
            stop = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              stop = undefined;
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        >
          <Show when={frame()}>
            <For each={items()}>
              {(it) => {
                const r = () => px(it);
                return <rect class="minimap-item" classList={{ frame: it.frame }} x={r().x} y={r().y} width={Math.max(1, r().w)} height={Math.max(1, r().h)} rx={1} />;
              }}
            </For>
            <Show when={view()}>
              {(v) => {
                const r = () => px(v());
                return <rect class="minimap-view" x={r().x} y={r().y} width={r().w} height={r().h} rx={2} />;
              }}
            </Show>
          </Show>
        </svg>
        <button class="icon-btn small minimap-close" title="Hide the minimap" onClick={toggleMap}>
          <IconClose />
        </button>
      </div>
    </Show>
  );
}
