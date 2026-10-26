// Alle sleep-interacties. Patroon: pointerdown start iets, daarna luisteren we op
// window naar move/up zodat het blijft werken als de cursor van het element af gaat.

import { panBy, toWorld } from "./camera";
import { intersects, normRect, pickSides } from "./geometry";
import {
  addConnectedNode,
  board,
  checkpoint,
  clearSelection,
  connect,
  createNode,
  isSelected,
  MIN_SIZE,
  moveNodesTo,
  nodeById,
  resizeNode,
  setUi,
  snap,
  ui,
} from "./store";

const DRAG_THRESHOLD = 3;

export function trackPointer(
  down: PointerEvent,
  move: (ev: PointerEvent) => void,
  up?: (ev: PointerEvent) => void,
) {
  const id = down.pointerId;
  const onMove = (ev: PointerEvent) => ev.pointerId === id && move(ev);
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    up?.(ev);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

const movedEnough = (a: PointerEvent, b: PointerEvent) =>
  Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) >= DRAG_THRESHOLD;

/** Sluit een open tekstveld af (blur => commit). */
export function blurActive() {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body) el.blur();
}

export function nodeAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY);
  return el?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
}

export function beginPan(e: PointerEvent) {
  let last = { x: e.clientX, y: e.clientY };
  setUi("panning", true);
  trackPointer(
    e,
    (ev) => {
      panBy(ev.clientX - last.x, ev.clientY - last.y);
      last = { x: ev.clientX, y: ev.clientY };
    },
    () => setUi("panning", false),
  );
}

/** Sleep alle geselecteerde nodes. De vastgepakte node snapt op het grid (Alt = vrij). */
export function beginNodeDrag(e: PointerEvent, grabbedId: string) {
  const start = toWorld(e.clientX, e.clientY);
  const origin = new Map(
    board.nodes.filter((n) => isSelected(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]),
  );
  const grabbed = origin.get(grabbedId);
  if (!grabbed) return;
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const w = toWorld(ev.clientX, ev.clientY);
      let dx = w.x - start.x;
      let dy = w.y - start.y;
      if (!ev.altKey) {
        dx = snap(grabbed.x + dx) - grabbed.x;
        dy = snap(grabbed.y + dy) - grabbed.y;
      }
      const pos = new Map<string, { x: number; y: number }>();
      for (const [id, o] of origin) pos.set(id, { x: o.x + dx, y: o.y + dy });
      moveNodesTo(pos);
    },
    () => setUi("dragging", false),
  );
}

export function beginResize(e: PointerEvent, id: string) {
  const n = nodeById(id);
  if (!n) return;
  const start = toWorld(e.clientX, e.clientY);
  const w0 = n.w;
  const h0 = n.h;
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
        checkpoint();
        setUi("dragging", true);
      }
      const w = toWorld(ev.clientX, ev.clientY);
      const round = ev.altKey ? (v: number) => v : snap;
      resizeNode(
        id,
        Math.max(MIN_SIZE.w, round(w0 + w.x - start.x)),
        Math.max(MIN_SIZE.h, round(h0 + w.y - start.y)),
      );
    },
    () => setUi("dragging", false),
  );
}

/**
 * Trek een pijl vanaf een node. Loslaten op een andere node verbindt ze,
 * loslaten op lege ruimte maakt een nieuw blok aan.
 */
export function beginConnect(e: PointerEvent, fromId: string) {
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
      }
      const w = toWorld(ev.clientX, ev.clientY);
      const hit = nodeAt(ev.clientX, ev.clientY);
      setUi("connecting", { from: fromId, x: w.x, y: w.y, target: hit && hit !== fromId ? hit : null });
    },
    (ev) => {
      const c = ui.connecting;
      setUi("connecting", null);
      if (!started || !c) return;
      if (c.target) {
        connect(fromId, c.target);
        return;
      }
      const src = nodeById(fromId);
      if (!src) return;
      // Plaats het nieuwe blok zo dat de pijl aankomt waar je losliet.
      const w = toWorld(ev.clientX, ev.clientY);
      const probe = createNode("box", w.x, w.y);
      const [, side] = pickSides(src, { x: w.x, y: w.y, w: 0, h: 0 });
      const off = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] }[side];
      const node = createNode("box", w.x + (off[0] * probe.w) / 2, w.y + (off[1] * probe.h) / 2);
      addConnectedNode(node, fromId);
      setUi("editingNode", node.id);
    },
  );
}

/** Selectie-rechthoek over de lege canvas. Shift = toevoegen aan selectie. */
export function beginMarquee(e: PointerEvent) {
  const additive = e.shiftKey;
  const base = additive ? [...ui.selected] : [];
  if (!additive) clearSelection();
  const w0 = toWorld(e.clientX, e.clientY);
  let started = false;

  trackPointer(
    e,
    (ev) => {
      if (!started) {
        if (!movedEnough(e, ev)) return;
        started = true;
      }
      const w = toWorld(ev.clientX, ev.clientY);
      setUi("marquee", { x0: w0.x, y0: w0.y, x1: w.x, y1: w.y });
      const r = normRect(w0.x, w0.y, w.x, w.y);
      const hits = board.nodes.filter((n) => intersects(n, r)).map((n) => n.id);
      setUi({ selected: additive ? [...new Set([...base, ...hits])] : hits, selectedEdge: null });
    },
    () => setUi("marquee", null),
  );
}
