// Two coordinate spaces: screen (pixels inside the viewport) and world (where nodes live).
//   screen = world * zoom + camera
//   world  = (screen - camera) / zoom

import { board, setCamera } from "./store";

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

let viewport: HTMLElement | undefined;
export const setViewport = (el: HTMLElement) => (viewport = el);

export function viewportRect(): DOMRect {
  return viewport?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/** clientX/clientY (from a PointerEvent) to world coordinates */
export function toWorld(clientX: number, clientY: number) {
  const r = viewportRect();
  const c = board.camera;
  return { x: (clientX - r.left - c.x) / c.zoom, y: (clientY - r.top - c.y) / c.zoom };
}

/** World to viewport coordinates */
export function toScreen(x: number, y: number) {
  const c = board.camera;
  return { x: x * c.zoom + c.x, y: y * c.zoom + c.y };
}

export function panBy(dx: number, dy: number) {
  const c = board.camera;
  setCamera({ x: c.x + dx, y: c.y + dy });
}

/** Zooms so the world point under the cursor stays in place. */
export function zoomAt(clientX: number, clientY: number, factor: number) {
  const r = viewportRect();
  const c = board.camera;
  const zoom = clampZoom(c.zoom * factor);
  const k = zoom / c.zoom;
  const sx = clientX - r.left;
  const sy = clientY - r.top;
  setCamera({ zoom, x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k });
}

export function zoomBy(factor: number) {
  const r = viewportRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}

export function resetZoom() {
  zoomBy(1 / board.camera.zoom);
}

/** Pans so the rectangle is in the middle of the screen, zoomed in if it was far away. */
export function focusOn(r: { x: number; y: number; w: number; h: number }) {
  const v = viewportRect();
  const zoom = clampZoom(Math.min(Math.max(board.camera.zoom, 0.8), (v.width - 160) / r.w, (v.height - 160) / r.h));
  setCamera({ zoom, x: v.width / 2 - (r.x + r.w / 2) * zoom, y: v.height / 2 - (r.y + r.h / 2) * zoom });
}

export function fitView(padding = 80) {
  const r = viewportRect();
  if (!board.nodes.length) {
    setCamera({ x: r.width / 2, y: r.height / 2, zoom: 1 });
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of board.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const zoom = clampZoom(Math.min((r.width - padding * 2) / w, (r.height - padding * 2) / h, 1.25));
  setCamera({
    zoom,
    x: r.width / 2 - (minX + w / 2) * zoom,
    y: r.height / 2 - (minY + h / 2) * zoom,
  });
}

/** Where the pointer last was over the canvas (world coordinates), if it is still over it */
let pointer: { x: number; y: number } | null = null;
export const setPointer = (p: { x: number; y: number } | null) => (pointer = p);

/** Where pasted things go: under the pointer, else the middle of the view. */
export function pastePoint() {
  if (pointer) return pointer;
  const r = viewportRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}
