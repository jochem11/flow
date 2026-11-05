// Presenting a flowchart or EER diagram: its sections one after the other, like
// slides (top-left to bottom-right), full screen. Arrow keys or Space go on,
// Escape stops. Others can watch along by following you (Presence.tsx).

import { createSignal } from "solid-js";
import { viewportRect } from "./camera";
import { eer, eerViewportRect, setEerCamera } from "./eer";
import { bounds } from "./geometry";
import { board, setCamera, setUi } from "./store";
import type { Camera } from "./types";
import { openDoc } from "./workspace";

type Slide = { title: string; x: number; y: number; w: number; h: number };

const [slides, setSlides] = createSignal<Slide[] | null>(null);
const [index, setIndex] = createSignal(0);
export { slides, index };
export const presenting = () => slides() !== null;

/** The sections of the open board in reading order; without sections, the whole board */
function collect(): Slide[] {
  const kind = openDoc()?.kind;
  const frames: Slide[] =
    kind === "eer"
      ? eer.sections.map((s) => ({ title: s.title || "Section", x: s.x, y: s.y, w: s.w, h: s.h }))
      : board.nodes.filter((n) => n.kind === "section").map((n) => ({ title: n.text || "Section", x: n.x, y: n.y, w: n.w, h: n.h }));
  // Rows first (sections whose tops are close are on one row), then left to right
  frames.sort((a, b) => (Math.abs(a.y - b.y) > 120 ? a.y - b.y : a.x - b.x));
  if (frames.length) return frames;
  const all = kind === "eer" ? bounds([...eer.entities.map((e) => ({ x: e.x, y: e.y, w: 280, h: 200 })), ...eer.sections]) : bounds(board.nodes);
  return all ? [{ title: openDoc()?.name ?? "", ...all }] : [];
}

function canvas(): { cam: Camera; view: DOMRect | null; set: (c: Camera) => void } {
  return openDoc()?.kind === "eer"
    ? { cam: eer.camera, view: eerViewportRect(), set: setEerCamera }
    : { cam: board.camera, view: viewportRect(), set: (c) => setCamera(c) };
}

let anim = 0;
/** Glides the camera to fit the slide, in about a third of a second */
function show(i: number) {
  const list = slides();
  const s = list?.[i];
  const { cam, view, set } = canvas();
  if (!s || !view) return;
  setIndex(i);
  const pad = 48;
  const zoom = Math.min(4, Math.max(0.1, Math.min((view.width - pad * 2) / s.w, (view.height - pad * 2) / s.h)));
  const to = { zoom, x: view.width / 2 - (s.x + s.w / 2) * zoom, y: view.height / 2 - (s.y + s.h / 2) * zoom };
  const from = { ...cam };
  const start = performance.now();
  const id = ++anim;
  const step = (now: number) => {
    if (id !== anim) return;
    const t = Math.min(1, (now - start) / 350);
    const e = 1 - (1 - t) ** 3;
    set({ zoom: from.zoom + (to.zoom - from.zoom) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export const next = () => show(Math.min(index() + 1, (slides()?.length ?? 1) - 1));
export const previous = () => show(Math.max(index() - 1, 0));
export const goTo = (i: number) => show(i);

const onKey = (e: KeyboardEvent) => {
  if (!presenting()) return;
  const keys: Record<string, () => void> = {
    ArrowRight: next,
    ArrowDown: next,
    PageDown: next,
    " ": next,
    Enter: next,
    ArrowLeft: previous,
    ArrowUp: previous,
    PageUp: previous,
    Home: () => show(0),
    End: () => show((slides()?.length ?? 1) - 1),
    Escape: stopPresenting,
  };
  const fn = keys[e.key];
  if (!fn) return;
  // Before the editor's own keys (which would move the selection)
  e.preventDefault();
  e.stopImmediatePropagation();
  fn();
};

export function startPresenting() {
  const list = collect();
  if (!list.length) return;
  setUi({ selected: [], selectedEdge: null, editingNode: null });
  (document.activeElement as HTMLElement | null)?.blur?.();
  setSlides(list);
  document.body.classList.add("presenting");
  window.addEventListener("keydown", onKey, { capture: true });
  document.documentElement.requestFullscreen?.().catch(() => {});
  // After the panels are gone, so the view is its full size
  requestAnimationFrame(() => requestAnimationFrame(() => show(0)));
}

export function stopPresenting() {
  anim++;
  setSlides(null);
  document.body.classList.remove("presenting");
  window.removeEventListener("keydown", onKey, { capture: true });
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

// Leaving full screen with the browser's own Escape also stops
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && presenting()) stopPresenting();
});
