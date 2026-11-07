// The inbox (server/src/routes/inbox.rs): mentions and answers in your threads.
// Loaded when you log in and whenever the server says it changed (events.ts),
// and when the window gets focus.

import { createEffect, createRoot, createSignal, on, onCleanup } from "solid-js";
import { me } from "./auth";
import { showThread, comments, loadComments } from "./comments";
import { get, put } from "./server";
import type { Inbox, Notification } from "./types";
import { openDoc, openDocumentById } from "./workspace";

const [inbox, setInbox] = createSignal<Inbox>({ items: [], unread: 0 });
export { inbox };

export async function loadInbox() {
  if (!me()) return setInbox({ items: [], unread: 0 });
  try {
    setInbox(await get<Inbox>("/inbox"));
  } catch {
    /* keep what we have */
  }
}

/** Marks these read (none given: all). */
export async function markRead(ids?: string[]) {
  setInbox((b) => ({
    items: b.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? Date.now() } : n)),
    unread: ids ? b.items.filter((n) => !n.readAt && !ids.includes(n.id)).length : 0,
  }));
  await put("/inbox/read", ids ? { ids } : {}).catch(() => loadInbox());
}

/** Opens the board of a notice with its thread shown, and marks it read. */
export async function openNotification(n: Notification) {
  void markRead([n.id]);
  if (!n.documentId) return;
  if (openDoc()?.id !== n.documentId) await openDocumentById(n.documentId);
  // The thread it is in (a reply's thread is its parent)
  const find = () => comments().find((c) => c.id === n.commentId);
  if (!find()) await loadComments();
  const c = find();
  if (c) showThread(c.parentId ?? c.id);
}

createRoot(() => {
  createEffect(
    on(
      () => me()?.user.id,
      (id) => {
        if (!id) return setInbox({ items: [], unread: 0 });
        void loadInbox();
        const onFocus = () => void loadInbox();
        window.addEventListener("focus", onFocus);
        onCleanup(() => window.removeEventListener("focus", onFocus));
      },
    ),
  );
});
