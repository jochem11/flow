import { createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

/**
 * Dropdown menu. Rendered into <body> through a Portal with `position: fixed`,
 * so it is not clipped by a scrolling sidebar.
 */
export function Menu(p: {
  button: (toggle: () => void, open: () => boolean) => JSX.Element;
  children: (close: () => void) => JSX.Element;
  align?: "left" | "right";
  /** Open above the button (at the bottom of the screen) */
  up?: boolean;
}) {
  const [pos, setPos] = createSignal<{ x: number; y: number } | null>(null);
  let anchor!: HTMLSpanElement;
  let menu: HTMLDivElement | undefined;

  const close = () => setPos(null);
  const toggle = () => {
    if (pos()) return close();
    const r = anchor.getBoundingClientRect();
    setPos({ x: p.align === "right" ? r.right : r.left, y: p.up ? r.top - 6 : r.bottom + 6 });
  };

  const onDoc = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!anchor.contains(t) && !menu?.contains(t)) close();
  };
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));

  return (
    <span class="menu-wrap" ref={anchor}>
      {p.button(toggle, () => !!pos())}
      <Show when={pos()}>
        {(at) => (
          <Portal>
            <div
              ref={menu}
              class="menu panel"
              style={{
                ...(p.up ? { bottom: `${window.innerHeight - at().y}px` } : { top: `${at().y}px` }),
                ...(p.align === "right"
                  ? { right: `${window.innerWidth - at().x}px` }
                  : { left: `${at().x}px` }),
              }}
              onKeyDown={(e) => e.key === "Escape" && close()}
            >
              {p.children(close)}
            </div>
          </Portal>
        )}
      </Show>
    </span>
  );
}
