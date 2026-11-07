// Comments on the open board (stored on the server, see server/src/routes/comments.rs):
// threads attached to the board, a block, a table, a card or a spot, with replies.
//
// Loaded when a board opens; refreshed when the window gets focus and every
// 20 seconds (and live once co-editing is connected, see collab/).

import { batch, createEffect, createMemo, createRoot, createSignal, on, onCleanup } from "solid-js";
import { get, post, put, del } from "./server";
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
    const list = await get<Comment[]>(`/documents/${doc.id}/comments`);
    if (openDoc()?.id === doc.id) setComments(list);
  } catch {
    /* keep what we have; the board itself shows errors */
  }
}

function upsert(c: Comment) {
  setComments((all) => (all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c]));
}

export async function addThread(anchor: CommentAnchor, body: string) {
  const doc = openDoc();
  if (!doc) return;
  const c = await post<Comment>(`/documents/${doc.id}/comments`, { anchor, body });
  upsert(c);
  batch(() => {
    setDraftAnchor(null);
    setFocusedThread(c.id);
  });
}

export async function reply(root: Comment, body: string) {
  upsert(await post<Comment>(`/documents/${root.documentId}/comments`, { parentId: root.id, body }));
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
