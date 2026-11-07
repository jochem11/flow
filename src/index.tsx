/* @refresh reload */
import { render } from "solid-js/web";
// The chosen theme, before anything is drawn
import "./lib/theme";
import App from "./App";
import { inTauri } from "./lib/server";

render(() => <App />, document.getElementById("root") as HTMLElement);

// The web version opens without a connection too (public/sw.js); the desktop app has its files with it
if (import.meta.env.PROD && !inTauri && "serviceWorker" in navigator) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
