// Paths in the web version (and links into the desktop app, see Phase 7 in the
// plan): what to open on startup. Links in mails and share links use them.
//
//   /d/<doc>         a board          /b/<token>       a board's share link
//   /p/<project>     a project        /invite/<token>  an invitation
//   /verify/<token>  confirm email    /reset/<token>   choose a new password

import { createSignal } from "solid-js";
import { inTauri } from "./server";

export type Route =
  | { kind: "home" }
  | { kind: "doc"; id: string }
  | { kind: "project"; id: string }
  | { kind: "share"; token: string }
  | { kind: "invite"; token: string }
  | { kind: "verify"; token: string }
  | { kind: "reset"; token: string };

export function parseRoute(path: string): Route {
  const [, first, second] = path.split("/");
  if (!second) return { kind: "home" };
  switch (first) {
    case "d":
      return { kind: "doc", id: second };
    case "p":
      return { kind: "project", id: second };
    case "b":
      return { kind: "share", token: second };
    case "invite":
      return { kind: "invite", token: second };
    case "verify":
      return { kind: "verify", token: second };
    case "reset":
      return { kind: "reset", token: second };
    default:
      return { kind: "home" };
  }
}

/** Where the app was opened (the desktop app always starts at home, until links come in). */
export const startRoute = (): Route => (inTauri ? { kind: "home" } : parseRoute(location.pathname));

/** Shows a path in the address bar without reloading (web only). */
export function showPath(path: string) {
  if (inTauri || location.pathname === path) return;
  history.replaceState(null, "", path);
}

// ---------- links into the desktop app ----------

/** A link that came in while the app runs (or started it): Gate opens it. */
const [incoming, setIncoming] = createSignal<Route | null>(null);
export { incoming };
export const clearIncoming = () => setIncoming(null);

/** The desktop app's link scheme: `flowapp`, or `flowapp-dev` for Flow Dev (see .env.development). */
const SCHEME = (import.meta.env.VITE_DESKTOP_SCHEME as string | undefined) || "flowapp";

/** `flowapp://open?path=/b/<token>` for a path of the web version. */
export const appLink = (path: string) => `${SCHEME}://open?path=${encodeURIComponent(path)}`;

/**
 * Listens for `flowapp://` links (desktop only): `open?path=…` opens that path;
 * `auth?code=…` finishes a Google sign-in that came back that way.
 */
export async function listenForLinks(onAuthCode: (code: string) => void) {
  if (!inTauri) return;
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const handle = (urls: string[] | null) => {
    for (const raw of urls ?? []) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      // flowapp://open?path=… parses with host "open" (or pathname "//open" on some systems)
      const what = url.host || url.pathname.replace(/^\/+/, "");
      if (what === "auth") {
        const code = url.searchParams.get("code");
        if (code) onAuthCode(code);
      } else if (what === "open") {
        const path = url.searchParams.get("path");
        if (path) setIncoming(parseRoute(path));
      }
    }
  };
  handle(await getCurrent().catch(() => null));
  await onOpenUrl(handle);
}

// ---------- the app or the browser (web version) ----------

const OPEN_IN_KEY = "flowapp:openIn";

/** What the visitor chose for links: the app, the browser, or not yet asked. */
export function openInChoice(): "app" | "web" | null {
  try {
    const v = localStorage.getItem(OPEN_IN_KEY);
    return v === "app" || v === "web" ? v : null;
  } catch {
    return null;
  }
}

export function rememberOpenIn(choice: "app" | "web") {
  try {
    localStorage.setItem(OPEN_IN_KEY, choice);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Tries the desktop app; resolves true when it took over (the page lost focus
 * or got hidden), false when nothing happened within `wait` ms (no app).
 */
export function tryApp(path: string, wait = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let left = false;
    const away = () => (left = true);
    window.addEventListener("blur", away, { once: true });
    document.addEventListener("visibilitychange", away, { once: true });
    location.href = appLink(path);
    setTimeout(() => {
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", away);
      resolve(left);
    }, wait);
  });
}
