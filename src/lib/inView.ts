// Popups stay inside the window. A menu, the inbox, the access panel and the
// other popups are placed next to what opened them; near an edge of the window
// (the bell in the sidebar, a menu at the right of the top bar, anything on a
// phone) they would stick out. Each one is shifted back in when it opens, and
// again when it or the window changes size; taller than the window, it scrolls.
//
// For every popup at once: a watch on the page for the popups it shows (by their
// class), so no popup needs code of its own for it.

/** What counts as a popup (not the panels that are part of the layout) */
const POPUPS = [".menu", ".inbox-panel", ".access-panel", ".eer-checks", ".uml-panel", ".icon-panel", ".type-options", ".mention-options", ".link-popover"].join(", ");

/** Kept free at the window's edges */
const MARGIN = 8;

const watched = new Set<HTMLElement>();
/** The size each popup was given here, to tell our own change from its content's */
const fitted = new WeakMap<HTMLElement, { w: number; h: number }>();

/** Moves a popup inside the window (and makes it scroll when it is taller). */
export function keepInView(el: HTMLElement) {
  if (!el.isConnected) return;
  // Measured where its own styles put it
  el.style.translate = "";
  if (el.dataset.inViewScroll) {
    el.style.maxHeight = "";
    el.style.overflowY = "";
    delete el.dataset.inViewScroll;
  }
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let dx = 0;
  let dy = 0;
  if (r.width > vw - 2 * MARGIN || r.left < MARGIN) dx = MARGIN - r.left;
  else if (r.right > vw - MARGIN) dx = vw - MARGIN - r.right;
  if (r.height > vh - 2 * MARGIN) {
    el.style.maxHeight = `${vh - 2 * MARGIN}px`;
    el.style.overflowY = "auto";
    el.dataset.inViewScroll = "1";
    dy = MARGIN - r.top;
  } else if (r.bottom > vh - MARGIN) dy = vh - MARGIN - r.bottom;
  else if (r.top < MARGIN) dy = MARGIN - r.top;
  if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
  const after = el.getBoundingClientRect();
  fitted.set(el, { w: Math.round(after.width), h: Math.round(after.height) });
}

// Its content changed (the inbox loaded, a list grew): placed again. Not for the
// size given here (that would go round in circles)
const sizes =
  typeof ResizeObserver !== "undefined"
    ? new ResizeObserver((entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const was = fitted.get(el);
          const r = el.getBoundingClientRect();
          if (!was || Math.abs(was.w - r.width) > 1 || Math.abs(was.h - r.height) > 1) requestAnimationFrame(() => keepInView(el));
        }
      })
    : null;

function watch(el: HTMLElement) {
  if (watched.has(el)) return;
  watched.add(el);
  // After the popup's own placement (it may set its position when it mounts)
  requestAnimationFrame(() => keepInView(el));
  sizes?.observe(el);
}

function found(node: Node) {
  if (!(node instanceof HTMLElement)) return;
  if (node.matches(POPUPS)) watch(node);
  for (const el of node.querySelectorAll<HTMLElement>(POPUPS)) watch(el);
}

if (typeof window !== "undefined" && typeof MutationObserver !== "undefined") {
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) found(n);
      for (const n of r.removedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        for (const el of [...watched]) {
          if (!el.isConnected) {
            watched.delete(el);
            sizes?.unobserve(el);
          }
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("resize", () => {
    for (const el of watched) keepInView(el);
  });
}
