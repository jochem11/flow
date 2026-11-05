// Light, dark, or following the system: chosen per device in the account menu.
// The choice sets `data-theme` on <html>; styles.css has the colours for each.

import { createSignal } from "solid-js";

export type Theme = "light" | "dark" | "system";

const KEY = "flowapp:theme";

function load(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const [theme, setThemeSignal] = createSignal<Theme>(load());
export { theme };

function apply(t: Theme) {
  if (t === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

export function setTheme(t: Theme) {
  setThemeSignal(t);
  apply(t);
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}

export const THEME_NAMES: Record<Theme, string> = { light: "Light", dark: "Dark", system: "System" };

// At start, before anything is drawn
apply(theme());
