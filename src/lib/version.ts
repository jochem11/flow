// The web version noticing it was updated: after the server restarted (a new
// version is put up that way), or when the tab is looked at again, it compares
// the script the server's page loads now with the one running in this tab.

import { createSignal } from "solid-js";
import { inTauri } from "./server";

/** A newer version of the web version is on the server than the one running here */
const [updateReady, setUpdateReady] = createSignal(false);
export { updateReady };

/** The built script this tab runs (none in development, where there is no build) */
const running = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src;

export async function checkForUpdate() {
  const mine = running();
  if (inTauri || !mine || updateReady()) return;
  try {
    const page = await (await fetch("/", { cache: "no-store" })).text();
    const src = page.match(/<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
    if (src && new URL(src, location.href).href !== mine) setUpdateReady(true);
  } catch {
    /* the server is away: next time */
  }
}

// The desktop app noticing a newer one: it asks the releases on GitHub (the address
// is in src-tauri/tauri.conf.json), downloads the installer and starts again. Only
// Flow itself: Flow Dev and `tauri dev` are built in development mode.

/** The version of the desktop app that can be installed, when there is a newer one */
const [appUpdate, setAppUpdate] = createSignal<string | null>(null);
export { appUpdate };

type Update = NonNullable<Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>>;
let found: Update | null = null;
let lastAsked = 0;
const ASK_EVERY = 60 * 60 * 1000;

export async function checkForAppUpdate() {
  if (!inTauri || import.meta.env.MODE !== "production" || found || Date.now() - lastAsked < ASK_EVERY) return;
  lastAsked = Date.now();
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    found = await check();
    if (found) setAppUpdate(found.version);
  } catch {
    /* no connection, or no release yet: next time */
  }
}

/** Downloads and installs the newer version, then starts Flow again. */
export async function installAppUpdate() {
  if (!found) return;
  await found.downloadAndInstall();
  // On Windows the installer has closed Flow by now; elsewhere it restarts here
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  void checkForUpdate();
  void checkForAppUpdate();
});
void checkForAppUpdate();
