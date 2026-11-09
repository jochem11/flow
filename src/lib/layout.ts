// The app's layout on small screens: below NARROW the sidebar is a drawer
// (opened with the menu button, closed when something is opened).

import { createRoot, createSignal } from "solid-js";

export const NARROW = 900;

const [navOpen, setNavOpen] = createSignal(false);
export { navOpen, setNavOpen };

/** Is the window narrow (the sidebar a drawer)? */
export const narrow = createRoot(() => {
  const query = typeof window !== "undefined" ? window.matchMedia(`(max-width: ${NARROW}px)`) : null;
  const [is, set] = createSignal(!!query?.matches);
  query?.addEventListener("change", (e) => {
    set(e.matches);
    if (!e.matches) setNavOpen(false);
  });
  return is;
});
