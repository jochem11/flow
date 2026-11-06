// Version history of the open board (server/src/routes/history.rs): saved
// states to go back to. Restoring puts the old content on the board as a normal
// change, so it can be undone and everyone editing together gets it.

import { get, post } from "./server";
import { restoreChart } from "./chart/store";
import { restoreEer } from "./eer";
import { restoreKanban } from "./kanban";
import { restoreBoard } from "./store";
import type { DocContent, Version, VersionMeta } from "./types";
import { openDoc, saveNow } from "./workspace";

export const listVersions = (docId: string) => get<VersionMeta[]>(`/documents/${docId}/versions`);
export const saveVersion = (docId: string, name: string) => post<VersionMeta>(`/documents/${docId}/versions`, { name });

/** The open text document's editor, to put old text in (set by RichTextEditor) */
let replaceText: ((markdown: string) => void) | null = null;
export const setTextReplacer = (fn: ((markdown: string) => void) | null) => (replaceText = fn);

/** Puts a saved state on the open board, after keeping the current one as "Before restore". */
export async function restoreVersion(docId: string, versionId: string) {
  await saveNow();
  await saveVersion(docId, "Before restore");
  const v = await get<Version>(`/documents/${docId}/versions/${versionId}`);
  if (openDoc()?.id !== docId) return;
  apply(v.content);
  await saveNow();
}

function apply(content: DocContent) {
  if (content.kind !== openDoc()?.kind) throw new Error("That version is of another kind of board");
  switch (content.kind) {
    case "flow":
      return restoreBoard(content.data);
    case "eer":
      return restoreEer(content.data);
    case "kanban":
      return restoreKanban(content.data);
    case "text":
      return replaceText?.(content.data.markdown);
    case "chart":
      return restoreChart(content.data);
  }
}

/** "3 minutes ago", "yesterday 14:05", "12 Mar 2026 09:30" */
export function when(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return `yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} ${time}`;
}
