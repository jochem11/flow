// Comments on the open board (stored on the server, see server/src/routes/comments.rs):
// threads attached to the board, a block, a table, a card or a spot, with replies.
//
// Loaded when a board opens; refreshed when the window gets focus and every
// 20 seconds (and live once co-editing is connected, see collab/).

import { batch, createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js";
import { get, post, put, del } from "./server";
import { me } from "./auth";
import { isOffline, kvDel, kvGet, kvKeysWith, kvSet, online, withCopy } from "./offline";
import { toast } from "./toast";
import type { Comment, CommentAnchor } from "./types";
import { openDoc } from "./workspace";

const [comments, setComments] = createSignal<Comment[]>([]);
export { comments };

/** The comments side panel */
export const [panelOpen, setPanelOpen] = createSignal(false);
/** Picking where a new thread goes (the comment tool) */
export const [placing, setPlacing] = createSignal(false);
/** A new thread being written, at this anchor */
export const [draftAnchor, setDraftAnchor] = createSignal<CommentAnchor | null>(null);
/** The thread to show (clicked pin) */
export const [focusedThread, setFocusedThread] = createSignal<string | null>(null);

export interface Thread {
  root: Comment;
  replies: Comment[];
}

export const threads = createRoot(() =>
  createMemo<Thread[]>(() => {
    const all = comments();
    const replies = new Map<string, Comment[]>();
    for (const c of all) if (c.parentId) replies.set(c.parentId, [...(replies.get(c.parentId) ?? []), c]);
    return all.filter((c) => !c.parentId).map((root) => ({ root, replies: replies.get(root.id) ?? [] }));
  }),
);

export const openThreads = () => threads().filter((t) => !t.root.resolvedAt);

/** Open threads on an item (for its pin) */
export const threadsOn = (kind: "node" | "entity" | "card", id: string) =>
  openThreads().filter((t) => t.root.anchor.kind === kind && (t.root.anchor as { id: string }).id === id);

let loadedFor: string | null = null;

export async function loadComments() {
  const doc = openDoc();
  if (!doc) return setComments([]);
  // The desktop app's own files have no comments (only boards on the server do)
  if (!doc.role) return setComments([]);
  try {
    // Kept on the device too, to read them offline (offline.ts)
    const list = await withCopy(`comments:${doc.id}`, () => get<Comment[]>(`/documents/${doc.id}/comments`));
    // With the ones still waiting for the connection
    const waiting = (await outbox()).filter((o) => o.comment.documentId === doc.id).map((o) => o.comment);
    if (openDoc()?.id === doc.id) setComments([...list.filter((c) => !waiting.some((w) => w.id === c.id)), ...waiting]);
  } catch {
    /* keep what we have; the board itself shows errors */
  }
}

// ---------- comments that wait for the connection ----------
//
// Written without a connection, a new comment or reply shows at once, marked as
// not sent, and is kept on the device ("outbox:…" in offline.ts) until the
// connection is back; then it goes, in the order written (a reply to a thread
// that was waiting too goes to that thread once it has its real id).

interface Waiting {
  key: string;
  comment: Comment;
}

const [waitingIds, setWaitingIds] = createSignal<Set<string>>(new Set());
/** Is this comment still waiting to be sent? */
export const isWaiting = (id: string) => waitingIds().has(id);

async function outbox(): Promise<Waiting[]> {
  const keys = await kvKeysWith("outbox:");
  const items: Waiting[] = [];
  for (const key of keys) {
    const comment = await kvGet<Comment>(key);
    if (comment) items.push({ key, comment });
  }
  setWaitingIds(new Set(items.map((i) => i.comment.id)));
  return items;
}

/** Keeps a comment for later; shows it now. */
async function keepForLater(documentId: string, fields: { anchor: CommentAnchor; parentId: string | null; body: string }): Promise<Comment> {
  const u = me()?.user;
  const g = guest();
  const comment: Comment = {
    id: `local-${crypto.randomUUID()}`,
    documentId,
    parentId: fields.parentId,
    anchor: fields.anchor,
    body: fields.body,
    author: { userId: u?.id ?? null, name: u?.name ?? g?.name ?? "You", avatarUrl: u?.avatarUrl ?? null },
    createdAt: Date.now(),
    editedAt: null,
    resolvedAt: null,
  };
  // The key sorts in the order written
  await kvSet(`outbox:${String(Date.now()).padStart(15, "0")}-${comment.id}`, comment);
  setWaitingIds((s) => new Set([...s, comment.id]));
  if (openDoc()?.id === documentId) upsert(comment);
  toast("Not sent yet: it goes when the connection is back");
  return comment;
}

/** A waiting comment is not wanted anymore (its replies that wait go too). */
export async function discardWaiting(c: Comment) {
  for (const w of await outbox()) {
    if (w.comment.id === c.id || w.comment.parentId === c.id) await kvDel(w.key);
  }
  setComments((all) => all.filter((x) => x.id !== c.id && x.parentId !== c.id));
  await outbox();
}

let sending = false;

/** The connection is back: sends what waited, in order. */
export async function sendWaiting() {
  if (sending) return;
  sending = true;
  try {
    const real = new Map<string, string>();
    let sent = 0;
    for (const w of await outbox()) {
      const c = w.comment;
      const parentId = c.parentId ? (real.get(c.parentId) ?? c.parentId) : null;
      // A reply whose thread could not be sent: it cannot go either
      if (parentId?.startsWith("local-")) {
        await kvDel(w.key);
        continue;
      }
      try {
        const saved = await post<Comment>(`/documents/${c.documentId}/comments`, parentId ? { parentId, body: c.body } : { anchor: c.anchor, body: c.body });
        await kvDel(w.key);
        real.set(c.id, saved.id);
        sent++;
        // On the open board: the waiting one becomes the real one (and its replies follow)
        setComments((all) =>
          all.map((x) => (x.id === c.id ? saved : x.parentId === c.id ? { ...x, parentId: saved.id } : x)),
        );
        if (focusedThread() === c.id) setFocusedThread(saved.id);
      } catch (e) {
        if (isOffline(e)) break;
        // The server said no (the board is gone, no access anymore)
        await kvDel(w.key);
        setComments((all) => all.filter((x) => x.id !== c.id));
        toast(`A comment could not be sent: ${e instanceof Error ? e.message : String(e)}`, "error");
      }
    }
    await outbox();
    if (sent) toast(`Back online: sent ${sent} ${sent === 1 ? "comment" : "comments"}`);
  } finally {
    sending = false;
  }
}

function upsert(c: Comment) {
  setComments((all) => (all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c]));
}

export async function addThread(anchor: CommentAnchor, body: string) {
  const doc = openDoc();
  if (!doc) return;
  let c: Comment;
  try {
    c = await post<Comment>(`/documents/${doc.id}/comments`, { anchor, body });
    upsert(c);
  } catch (e) {
    if (!isOffline(e)) throw e;
    c = await keepForLater(doc.id, { anchor, parentId: null, body });
  }
  batch(() => {
    setDraftAnchor(null);
    setFocusedThread(c.id);
  });
}

export async function reply(root: Comment, body: string) {
  // To a thread that is still waiting itself: waits too
  if (isWaiting(root.id)) return void (await keepForLater(root.documentId, { anchor: root.anchor, parentId: root.id, body }));
  try {
    upsert(await post<Comment>(`/documents/${root.documentId}/comments`, { parentId: root.id, body }));
  } catch (e) {
    if (!isOffline(e)) throw e;
    await keepForLater(root.documentId, { anchor: root.anchor, parentId: root.id, body });
  }
}

export async function editComment(c: Comment, body: string) {
  upsert(await put<Comment>(`/comments/${c.id}`, { body }));
}

export async function deleteComment(c: Comment) {
  await del(`/comments/${c.id}`);
  // A thread goes with its replies
  setComments((all) => all.filter((x) => x.id !== c.id && x.parentId !== c.id));
}

export async function resolve(c: Comment, resolved: boolean) {
  upsert(await put<Comment>(`/comments/${c.id}/resolve`, { resolved }));
}

/** Starts a new thread at an anchor: the panel opens with the composer there. */
export function startThread(anchor: CommentAnchor) {
  batch(() => {
    setPlacing(false);
    setDraftAnchor(anchor);
    setFocusedThread(null);
    setPanelOpen(true);
  });
}

export function showThread(id: string) {
  batch(() => {
    setFocusedThread(id);
    setPanelOpen(true);
  });
}

// ---------- guests ----------

export interface Guest {
  id: string;
  name: string;
}
const [guest, setGuest] = createSignal<Guest | null | undefined>(undefined);
export { guest };

export async function loadGuest() {
  setGuest(await get<Guest | null>("/guest").catch(() => null));
}

export async function becomeGuest(name: string) {
  setGuest(await post<Guest>("/guest", { name }));
}

// Back online (or logged in, with comments left from before): send what waited
createRoot(() => {
  createEffect(on(online, (on) => on && void sendWaiting(), { defer: true }));
  createEffect(on(() => me()?.user.id ?? guest()?.id, (id) => id && online() && void sendWaiting()));
});

// A board opens: its comments; and keep them fresh while it is open
createRoot(() => {
  createEffect(
    on(
      () => openDoc()?.id,
      (id) => {
        if (id === loadedFor) return;
        loadedFor = id ?? null;
        batch(() => {
          setComments([]);
          setDraftAnchor(null);
          setFocusedThread(null);
          setPlacing(false);
        });
        void loadComments();
        const timer = setInterval(() => void loadComments(), 20_000);
        const onFocus = () => void loadComments();
        window.addEventListener("focus", onFocus);
        onCleanup(() => {
          clearInterval(timer);
          window.removeEventListener("focus", onFocus);
        });
      },
    ),
  );
});

// ---------- mentions ----------

/** A mention as written in a comment: `@[Name](user id)` (see server/src/routes/inbox.rs) */
const MENTION = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9-]{1,64})\)/g;

/** A comment's text in parts: plain text, and mentions (to show as chips). */
export function bodyParts(body: string): ({ text: string } | { name: string; userId: string })[] {
  const out: ({ text: string } | { name: string; userId: string })[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION)) {
    if (m.index! > last) out.push({ text: body.slice(last, m.index) });
    out.push({ name: m[1], userId: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}

/** For editing: mentions as `@Name`, and who they are. */
export function toEditable(body: string): { text: string; picked: { name: string; id: string }[] } {
  const picked: { name: string; id: string }[] = [];
  const text = body.replace(MENTION, (_, name: string, id: string) => {
    if (!picked.some((p) => p.id === id)) picked.push({ name, id });
    return `@${name}`;
  });
  return { text, picked };
}

/** Back to the stored form: each `@Name` of someone picked becomes a mention. */
export function toStored(text: string, picked: { name: string; id: string }[]): string {
  let out = text;
  // Longest names first, so "@Ann Lee" is not taken as "@Ann"
  for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    out = out.split(`@${p.name}`).join(`@[${p.name}](${p.id})`);
  }
  return out;
}
