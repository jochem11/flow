// The bar above a selection: placed so it never covers what is selected.

import { createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { viewportRect } from "../lib/camera";
import type { Rect } from "../lib/geometry";
import { board } from "../lib/store";
import type { Camera } from "../lib/types";

export const grow = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

/** Space between the bar and the edge of the canvas */
const MARGIN = 8;

/**
 * Where the bar goes so it does not cover `box` (screen coordinates): above it,
 * else below, else to the right or left. Only when none of those fit (the
 * selection fills the screen) it sits at the top of the canvas.
 */
function placeBar(box: Rect, size: { w: number; h: number }, view: { w: number; h: number }) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const centerX = clamp(box.x + box.w / 2 - size.w / 2, MARGIN, view.w - size.w - MARGIN);
  const centerY = clamp(box.y + box.h / 2 - size.h / 2, MARGIN, view.h - size.h - MARGIN);
  if (box.y - size.h >= MARGIN) return { x: centerX, y: box.y - size.h };
  if (box.y + box.h + size.h <= view.h - MARGIN) return { x: centerX, y: box.y + box.h };
  if (box.x + box.w + size.w <= view.w - MARGIN) return { x: box.x + box.w, y: centerY };
  if (box.x - size.w >= MARGIN) return { x: box.x - size.w, y: centerY };
  return { x: centerX, y: MARGIN };
}

/**
 * The bar itself: measures its own size and keeps clear of the selection (`box`, world coordinates).
 * On another canvas than the flowchart's, give its camera and its viewport.
 */
export function FloatingBar(p: { box: Rect; children: JSX.Element; camera?: Camera; view?: () => DOMRect }) {
  let el!: HTMLDivElement;
  const [size, setSize] = createSignal({ w: 0, h: 0 });
  onMount(() => {
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  const pos = createMemo(() => {
    // Reads the camera, so this follows panning and zooming
    const cam = p.camera ?? board.camera;
    const z = cam.zoom;
    const tl = { x: p.box.x * z + cam.x, y: p.box.y * z + cam.y };
    const view = (p.view ?? viewportRect)();
    return placeBar({ x: tl.x, y: tl.y, w: p.box.w * z, h: p.box.h * z }, size(), { w: view.width, h: view.height });
  });

  return (
    <div
      ref={el}
      class="context-bar"
      // Hidden until measured, so it never shows in the wrong spot first
      style={{ left: `${pos().x}px`, top: `${pos().y}px`, visibility: size().w ? "visible" : "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
    >
      {p.children}
    </div>
  );
}
