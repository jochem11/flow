// Opslaan, laden, layout en export: alles wat via Rust gaat.

import { createEffect, createRoot, createSignal, on } from "solid-js";
import { api, errMsg } from "./api";
import { fitView } from "./camera";
import { applyLayout, board, boardSnapshot, emptyBoard, replaceBoard, rev } from "./store";
import { toast } from "./toast";
import type { BoardMeta, ExportFormat } from "./types";

export type SaveState =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string };

const [saveState, setSaveState] = createSignal<SaveState>({ kind: "saved" });
export { saveState };

const [boards, setBoards] = createSignal<BoardMeta[]>([]);
export { boards };

const AUTOSAVE_MS = 800;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function saveNow() {
  clearTimeout(timer);
  setSaveState({ kind: "saving" });
  try {
    await api.saveBoard(boardSnapshot());
    setSaveState({ kind: "saved" });
  } catch (e) {
    setSaveState({ kind: "error", message: errMsg(e) });
  }
}

/** Start autosave: elke wijziging plant een save in. */
export function startAutosave() {
  createRoot(() => {
    createEffect(
      on(
        rev,
        () => {
          setSaveState({ kind: "dirty" });
          clearTimeout(timer);
          timer = setTimeout(saveNow, AUTOSAVE_MS);
        },
        { defer: true },
      ),
    );
  });
}

export async function refreshBoards() {
  try {
    setBoards(await api.listBoards());
  } catch (e) {
    toast(`Borden ophalen mislukt: ${errMsg(e)}`, "error");
  }
}

/** Bij opstarten: laad het laatst gewijzigde bord, anders blijft het voorbeeldbord staan. */
export async function loadInitial() {
  try {
    const list = await api.listBoards();
    setBoards(list);
    const latest = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (latest) {
      replaceBoard(await api.loadBoard(latest.id));
      setSaveState({ kind: "saved" });
      return;
    }
  } catch (e) {
    toast(`Laden mislukt: ${errMsg(e)}`, "error");
  }
  requestAnimationFrame(() => fitView());
}

async function flushIfDirty() {
  const s = saveState().kind;
  if (s === "dirty" || s === "saving") await saveNow();
}

export async function openBoard(id: string) {
  if (id === board.id) return;
  await flushIfDirty();
  try {
    replaceBoard(await api.loadBoard(id));
    setSaveState({ kind: "saved" });
  } catch (e) {
    toast(`Bord openen mislukt: ${errMsg(e)}`, "error");
  }
}

export async function newBoard() {
  await flushIfDirty();
  replaceBoard(emptyBoard());
  requestAnimationFrame(() => fitView());
  await saveNow();
  await refreshBoards();
}

export async function removeBoard(id: string) {
  try {
    await api.deleteBoard(id);
    if (id === board.id) {
      const rest = boards().filter((b) => b.id !== id);
      if (rest[0]) await openBoard(rest[0].id);
      else replaceBoard(emptyBoard());
    }
    await refreshBoards();
  } catch (e) {
    toast(`Verwijderen mislukt: ${errMsg(e)}`, "error");
  }
}

export async function runAutoLayout() {
  if (!board.nodes.length) return;
  try {
    const snap = boardSnapshot();
    applyLayout(await api.autoLayout(snap.nodes, snap.edges));
    requestAnimationFrame(() => fitView());
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

export async function runExport(format: ExportFormat) {
  try {
    const path = await api.exportBoard(boardSnapshot(), format);
    toast(`Geëxporteerd naar ${path}`);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}
