// Touch on the board: one finger on the empty canvas moves it (Canvas.tsx), two
// fingers move and pinch-zoom it, whatever the first finger had started. The
// browser's own gestures are off there (touch-action: none).

import { setCamera, board } from "./store";
import { cancelTracking } from "./interactions";
import { MAX_ZOOM, MIN_ZOOM, viewportRect } from "./camera";

type Pt = { x: number; y: number };

export function installTouch(el: HTMLElement): () => void {
  const touches = new Map<number, Pt>();
  let pinch: { mid: Pt; dist: number; cam: { x: number; y: number; zoom: number } } | null = null;

  const mid = (): Pt => {
    const [a, b] = [...touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  const dist = () => {
    const [a, b] = [...touches.values()];
    return Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // The second finger: whatever the first one was doing stops (a drag, a selection box)
      cancelTracking();
      e.stopPropagation();
      e.preventDefault();
      pinch = { mid: mid(), dist: dist(), cam: { ...board.camera } };
    }
  };
  const move = (e: PointerEvent) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || touches.size < 2) return;
    const r = viewportRect();
    const m = mid();
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (pinch.cam.zoom * dist()) / pinch.dist));
    // The world point that was under the fingers stays under them
    const wx = (pinch.mid.x - r.left - pinch.cam.x) / pinch.cam.zoom;
    const wy = (pinch.mid.y - r.top - pinch.cam.y) / pinch.cam.zoom;
    setCamera({ zoom, x: m.x - r.left - wx * zoom, y: m.y - r.top - wy * zoom });
  };
  const up = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  };

  // Capture: before the canvas and its blocks start anything with the second finger
  el.addEventListener("pointerdown", down, { capture: true });
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  return () => {
    el.removeEventListener("pointerdown", down, { capture: true });
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
}
