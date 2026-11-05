/* @refresh reload */
import { render } from "solid-js/web";
// The chosen theme, before anything is drawn
import "./lib/theme";
import App from "./App";

render(() => <App />, document.getElementById("root") as HTMLElement);
