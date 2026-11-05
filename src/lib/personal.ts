// What is the user's own in the sidebar: starred projects and boards, recently
// opened boards, and the trash. All kept on the server (server/src/routes/
// personal.rs and trash.rs), so they are the same on every device.

import { createSignal } from "solid-js";
import { del, get, post, put } from "./server";
import type { ItemKind, RecentBoard, Star, TrashItem } from "./types";

const [stars, setStars] = createSignal<Star[]>([]);
const [recent, setRecent] = createSignal<RecentBoard[]>([]);
const [trash, setTrash] = createSignal<TrashItem[]>([]);
export { recent, stars, trash };

/** Loads stars, recent boards and the trash (after logging in, and when projects change). */
export async function loadPersonal() {
  const [s, r, t] = await Promise.all([
    get<Star[]>("/stars").catch(() => []),
    get<RecentBoard[]>("/recent").catch(() => []),
    get<TrashItem[]>("/trash").catch(() => []),
  ]);
  setStars(s);
  setRecent(r);
  setTrash(t);
}

export const loadTrash = async () => setTrash(await get<TrashItem[]>("/trash").catch(() => []));

export const isStarred = (id: string) => stars().some((s) => s.itemId === id);

/** Stars or unstars a project or board (shown at once, saved in the background). */
export async function toggleStar(id: string, kind: ItemKind) {
  const was = isStarred(id);
  setStars((all) => (was ? all.filter((s) => s.itemId !== id) : [...all, { itemId: id, kind }]));
  try {
    if (was) await del(`/stars/${id}`);
    else await put(`/stars/${id}`, { kind });
  } catch {
    // Back as it was
    setStars((all) => (was ? [...all, { itemId: id, kind }] : all.filter((s) => s.itemId !== id)));
  }
}

/** A board was opened: first in "Recent" here, and on the server for other devices. */
export function noteOpened(board: Omit<RecentBoard, "openedAt">) {
  setRecent((all) => [{ ...board, openedAt: Date.now() }, ...all.filter((r) => r.documentId !== board.documentId)].slice(0, 8));
  void post(`/documents/${board.documentId}/opened`, {}).catch(() => {});
}

/** Puts a board or project back where it was. */
export async function restoreItem(item: TrashItem) {
  await post(`/trash/${item.id}/restore`, {});
  setTrash((all) => all.filter((t) => t.id !== item.id));
}

/** Deletes a board or project in the trash for good. */
export async function deleteForever(item: TrashItem) {
  await del(`/trash/${item.id}`);
  setTrash((all) => all.filter((t) => t.id !== item.id));
}
