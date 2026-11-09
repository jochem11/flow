// What the top bar's buttons open, shared with its "…" menu: when the bar has no
// room for every button (a small window, a phone), the less used ones go into
// that menu (see TopBar's fold), and open the same thing from there.

import { createSignal } from "solid-js";

export const [diagramImport, setDiagramImport] = createSignal(false);
export const [sqlImport, setSqlImport] = createSignal(false);

/**
 * How far the top bar is folded up, to fit: 0 everything shows; 1 the project and
 * folders before the board's name go; 2 buttons show only their icon; 3 Arrange,
 * Import and Checks are in the "…" menu; 4 Comments and the people on the board
 * too; 5 undo, redo and the save state go as well; 6 Access too.
 */
export const [barFold, setBarFold] = createSignal(0);
