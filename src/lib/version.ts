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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkForUpdate();
});
