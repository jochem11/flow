// Comments on a board: the side panel with its threads, the pins on the
// flowchart and EER canvases, and placing a new thread (the comment tool: click
// a block, a table or a spot). See lib/comments.ts for the data.

import { roleCanManage } from "../lib/roles";
import { createSignal, For, type JSX, Show } from "solid-js";
import { canComment } from "../lib/access";
import { errMsg } from "../lib/api";
import { me } from "../lib/auth";
import { toWorld } from "../lib/camera";
import {
  addThread,
  becomeGuest,
  comments,
  deleteComment,
  draftAnchor,
  editComment,
  focusedThread,
  guest,
  loadGuest,
  openThreads,
  panelOpen,
  placing,
  reply,
  resolve,
  setDraftAnchor,
  setPanelOpen,
  setPlacing,
  showThread,
  startThread,
  threads,
  threadsOn,
  bodyParts,
  toEditable,
  toStored,
  type Thread,
} from "../lib/comments";
import { people } from "../lib/people";
import { eer, ENTITY_W } from "../lib/eer";
import { kanban } from "../lib/kanban";
import { nodeName } from "../lib/links";
import { board } from "../lib/store";
import { toast } from "../lib/toast";
import type { Comment, CommentAnchor } from "../lib/types";
import { openDoc } from "../lib/workspace";
import { Avatar } from "./AccountMenu";
import { IconClose } from "./icons";

/** What a thread is about, in words. */
function anchorLabel(a: CommentAnchor): string {
  switch (a.kind) {
    case "board":
      return "On the board";
    case "point":
      return "On the canvas";
    case "node": {
      const n = board.nodes.find((x) => x.id === a.id);
      return n ? `On “${nodeName(n)}”` : "On a removed block";
    }
    case "entity": {
      const e = eer.entities.find((x) => x.id === a.id);
      return e ? `On table “${e.name}”` : "On a removed table";
    }
    case "card": {
      const c = kanban.columns.flatMap((col) => col.cards).find((x) => x.id === a.id);
      return c ? `On card “${c.title}”` : "On a removed card";
    }
    case "text":
      return `On “${a.quote.length > 60 ? `${a.quote.slice(0, 59)}…` : a.quote}”`;
  }
}

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
};

/** Was this written by whoever is looking? */
const mine = (c: Comment) => (me() ? c.author.userId === me()!.user.id : !c.author.userId && c.author.name === guest()?.name);

/** The Comments button in the top bar, with the number of open threads. */
export function CommentsButton() {
  return (
    <Show when={openDoc()?.role}>
      <button class="text-btn" classList={{ active: panelOpen() }} title="Comments" onClick={() => setPanelOpen(!panelOpen())}>
        <span>Comments</span>
        <Show when={openThreads().length}>
          <span class="comment-count">{openThreads().length}</span>
        </Show>
      </button>
    </Show>
  );
}

/**
 * A text box with a send button; Cmd/Ctrl+Enter sends. Typing @ offers the
 * people on the board: picked, they are mentioned (and told, see inbox).
 */
function Composer(p: { placeholder: string; initial?: string; submit: string; onSubmit: (body: string) => Promise<void>; onCancel?: () => void; autofocus?: boolean }) {
  const start = toEditable(p.initial ?? "");
  const [body, setBody] = createSignal(start.text);
  const [picked, setPicked] = createSignal(start.picked);
  const [busy, setBusy] = createSignal(false);
  let area!: HTMLTextAreaElement;
  // The @word being typed, and the people it matches
  const [query, setQuery] = createSignal<{ at: number; text: string } | null>(null);
  const [active, setActive] = createSignal(0);
  const matches = () => {
    const q = query();
    if (!q) return [];
    const t = q.text.toLowerCase();
    return people()
      .filter((u) => u.id !== me()?.user.id && (u.name.toLowerCase().includes(t) || u.email.toLowerCase().startsWith(t)))
      .slice(0, 6);
  };
  const findQuery = () => {
    const before = area.value.slice(0, area.selectionStart);
    const m = /(^|\s)@([^\s@]{0,30})$/.exec(before);
    setQuery(m ? { at: before.length - m[2].length - 1, text: m[2] } : null);
    setActive(0);
  };
  const pick = (u: { id: string; name: string }) => {
    const q = query();
    if (!q) return;
    const text = body();
    const caret = area.selectionStart;
    const next = `${text.slice(0, q.at)}@${u.name} ${text.slice(caret)}`;
    setBody(next);
    setPicked((ps) => (ps.some((x) => x.id === u.id) ? ps : [...ps, { id: u.id, name: u.name }]));
    setQuery(null);
    requestAnimationFrame(() => {
      const pos = q.at + u.name.length + 2;
      area.focus();
      area.setSelectionRange(pos, pos);
    });
  };
  const send = async () => {
    if (!body().trim()) return;
    setBusy(true);
    try {
      await p.onSubmit(toStored(body(), picked()));
      setBody("");
      setPicked([]);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="comment-composer">
      <textarea
        rows={2}
        placeholder={people().length ? `${p.placeholder} (@ to mention someone)` : p.placeholder}
        value={body()}
        ref={(el) => {
          area = el;
          if (p.autofocus) requestAnimationFrame(() => el.focus());
        }}
        onInput={(e) => {
          setBody(e.currentTarget.value);
          findQuery();
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          const list = matches();
          if (list.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((active() + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(list[active()]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setQuery(null);
              return;
            }
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          if (e.key === "Escape") p.onCancel?.();
        }}
      />
      <Show when={matches().length}>
        <div class="mention-options panel" role="listbox" aria-label="Mention someone">
          <For each={matches()}>
            {(u, i) => (
              <button
                class="mention-option"
                classList={{ active: active() === i() }}
                role="option"
                aria-selected={active() === i()}
                onPointerDown={(e) => e.preventDefault()}
                onPointerMove={() => setActive(i())}
                onClick={() => pick(u)}
              >
                <Avatar name={u.name} url={u.avatarUrl} size={20} />
                <span>{u.name}</span>
                <small>{u.email}</small>
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class="comment-composer-actions">
        <Show when={p.onCancel}>
          <button class="text-btn" onClick={p.onCancel}>
            Cancel
          </button>
        </Show>
        <button class="text-btn primary" disabled={busy() || !body().trim()} onClick={send}>
          {p.submit}
        </button>
      </div>
    </div>
  );
}

function CommentView(p: { comment: Comment; root?: boolean }) {
  const [editing, setEditing] = createSignal(false);
  return (
    <div class="comment">
      <div class="comment-head">
        <Avatar name={p.comment.author.name} url={p.comment.author.avatarUrl} size={22} />
        <span class="comment-author">
          {p.comment.author.name}
          <Show when={!p.comment.author.userId}>
            <span class="comment-guest"> (guest)</span>
          </Show>
        </span>
        <span class="comment-time" title={new Date(p.comment.createdAt).toLocaleString()}>
          {when(p.comment.createdAt)}
          <Show when={p.comment.editedAt}> · edited</Show>
        </span>
        <Show when={mine(p.comment) || roleCanManage(openDoc()?.role)}>
          <span class="comment-tools">
            <Show when={mine(p.comment)}>
              <button class="link-btn" onClick={() => setEditing(true)}>
                Edit
              </button>
            </Show>
            <button class="link-btn danger" onClick={() => deleteComment(p.comment).catch((e) => toast(errMsg(e), "error"))}>
              Delete
            </button>
          </span>
        </Show>
      </div>
      <Show
        when={editing()}
        fallback={
          <p class="comment-body">
            <For each={bodyParts(p.comment.body)}>
              {(part) => ("name" in part ? <span class="mention" classList={{ me: part.userId === me()?.user.id }}>@{part.name}</span> : part.text)}
            </For>
          </p>
        }
      >
        <Composer
          placeholder="Comment"
          initial={p.comment.body}
          submit="Save"
          autofocus
          onSubmit={async (body) => {
            await editComment(p.comment, body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </Show>
    </div>
  );
}

function ThreadView(p: { thread: Thread }) {
  const resolved = () => !!p.thread.root.resolvedAt;
  return (
    <div class="comment-thread" classList={{ focused: focusedThread() === p.thread.root.id, resolved: resolved() }} ref={(el) => focusedThread() === p.thread.root.id && requestAnimationFrame(() => el.scrollIntoView({ block: "nearest" }))}>
      <div class="comment-anchor">
        <span>{anchorLabel(p.thread.root.anchor)}</span>
        <Show when={canComment()}>
          <button class="link-btn" onClick={() => resolve(p.thread.root, !resolved()).catch((e) => toast(errMsg(e), "error"))}>
            {resolved() ? "Reopen" : "Resolve"}
          </button>
        </Show>
      </div>
      <CommentView comment={p.thread.root} root />
      <For each={p.thread.replies}>{(r) => <CommentView comment={r} />}</For>
      <Show when={canComment() && !resolved()}>
        <GuestGate>
          <Composer placeholder="Reply" submit="Reply" onSubmit={(body) => reply(p.thread.root, body)} />
        </GuestGate>
      </Show>
    </div>
  );
}

/** A guest picks a name before their first comment. */
function GuestGate(p: { children: JSX.Element }) {
  const [name, setName] = createSignal("");
  if (!me() && guest() === undefined) void loadGuest();
  return (
    <Show
      when={me() || guest()}
      fallback={
        <form
          class="guest-name"
          onSubmit={(e) => {
            e.preventDefault();
            becomeGuest(name()).catch((err) => toast(errMsg(err), "error"));
          }}
        >
          <span>Your name, to comment as a guest</span>
          <div class="guest-name-row">
            <input required placeholder="Name" value={name()} onInput={(e) => setName(e.currentTarget.value)} onKeyDown={(e) => e.stopPropagation()} />
            <button class="text-btn primary" type="submit">
              Continue
            </button>
          </div>
        </form>
      }
    >
      {p.children}
    </Show>
  );
}

export function CommentsPanel() {
  const [showResolved, setShowResolved] = createSignal(false);
  const shown = () => threads().filter((t) => !!t.root.resolvedAt === showResolved()).reverse();
  const canPlace = () => openDoc()?.kind === "flow" || openDoc()?.kind === "eer";
  return (
    <Show when={panelOpen()}>
      <aside class="comments-panel panel" onPointerDown={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()}>
        <div class="comments-head">
          <strong>Comments</strong>
          <div class="sql-tabs">
            <button class="sql-tab" classList={{ active: !showResolved() }} onClick={() => setShowResolved(false)}>
              Open
            </button>
            <button class="sql-tab" classList={{ active: showResolved() }} onClick={() => setShowResolved(true)}>
              Resolved
            </button>
          </div>
          <button class="icon-btn small" title="Close" onClick={() => setPanelOpen(false)}>
            <IconClose />
          </button>
        </div>
        <Show when={canComment()}>
          <div class="comments-new">
            <Show
              when={draftAnchor()}
              fallback={
                <div class="comments-new-actions">
                  <button class="text-btn" onClick={() => startThread({ kind: "board" })}>
                    New comment
                  </button>
                  <Show when={canPlace()}>
                    <button class="text-btn" classList={{ active: placing() }} title="Click a block, table or spot (C)" onClick={() => setPlacing(!placing())}>
                      {placing() ? "Click on the board…" : "Comment on something"}
                    </button>
                  </Show>
                </div>
              }
            >
              {(anchor) => (
                <GuestGate>
                  <div class="comment-anchor">{anchorLabel(anchor())}</div>
                  <Composer placeholder="Write a comment" submit="Comment" autofocus onSubmit={(body) => addThread(anchor(), body)} onCancel={() => setDraftAnchor(null)} />
                </GuestGate>
              )}
            </Show>
          </div>
        </Show>
        <div class="comments-list">
          <For each={shown()} fallback={<p class="import-note">{showResolved() ? "No resolved threads." : comments().length ? "All threads are resolved." : "No comments yet."}</p>}>
            {(t) => <ThreadView thread={t} />}
          </For>
        </div>
      </aside>
    </Show>
  );
}

// ---------- on the canvas ----------

function Pin(p: { x: number; y: number; count: number; zoom: number; onClick: () => void }) {
  return (
    <button
      class="comment-pin"
      style={{ left: `${p.x}px`, top: `${p.y}px`, transform: `translate(-30%, -70%) scale(${1 / p.zoom})` }}
      title={`${p.count} comment thread${p.count === 1 ? "" : "s"}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        p.onClick();
      }}
    >
      {p.count}
    </button>
  );
}

/** Pins of open threads on a flowchart (inside its world layer). */
export function FlowCommentPins() {
  return (
    <For each={openThreads().filter((t) => t.root.anchor.kind === "node" || t.root.anchor.kind === "point")}>
      {(t) => {
        const at = () => {
          const a = t.root.anchor;
          if (a.kind === "point") return { x: a.x, y: a.y };
          const n = a.kind === "node" ? board.nodes.find((x) => x.id === a.id) : undefined;
          return n ? { x: n.x + n.w, y: n.y } : null;
        };
        // One pin per block, with the number of its threads
        const first = () => t.root.anchor.kind !== "node" || threadsOn("node", (t.root.anchor as { id: string }).id)[0]?.root.id === t.root.id;
        return (
          <Show when={at() && first()}>
            <Pin
              x={at()!.x}
              y={at()!.y}
              zoom={board.camera.zoom}
              count={t.root.anchor.kind === "node" ? threadsOn("node", (t.root.anchor as { id: string }).id).length : 1}
              onClick={() => showThread(t.root.id)}
            />
          </Show>
        );
      }}
    </For>
  );
}

/** Pins of open threads on an EER diagram (inside its world layer). */
export function EerCommentPins() {
  return (
    <For each={openThreads().filter((t) => t.root.anchor.kind === "entity" || t.root.anchor.kind === "point")}>
      {(t) => {
        const at = () => {
          const a = t.root.anchor;
          if (a.kind === "point") return { x: a.x, y: a.y };
          const e = a.kind === "entity" ? eer.entities.find((x) => x.id === a.id) : undefined;
          return e ? { x: e.x + ENTITY_W, y: e.y } : null;
        };
        const first = () => t.root.anchor.kind !== "entity" || threadsOn("entity", (t.root.anchor as { id: string }).id)[0]?.root.id === t.root.id;
        return (
          <Show when={at() && first()}>
            <Pin
              x={at()!.x}
              y={at()!.y}
              zoom={eer.camera.zoom}
              count={t.root.anchor.kind === "entity" ? threadsOn("entity", (t.root.anchor as { id: string }).id).length : 1}
              onClick={() => showThread(t.root.id)}
            />
          </Show>
        );
      }}
    </For>
  );
}

/**
 * While placing a thread: covers the canvas; a click picks the block (or table)
 * under it, or the spot. `toWorldPoint` turns screen into world coordinates.
 */
export function PlacingOverlay(p: { kind: "flow" | "eer"; toWorldPoint?: (x: number, y: number) => { x: number; y: number } }) {
  return (
    <Show when={placing()}>
      <div
        class="comment-placing"
        onPointerDown={(e) => {
          e.stopPropagation();
          const overlay = e.currentTarget;
          overlay.style.pointerEvents = "none";
          const under = document.elementFromPoint(e.clientX, e.clientY);
          overlay.style.pointerEvents = "";
          const id = p.kind === "flow" ? under?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId : under?.closest<HTMLElement>("[data-entity-id]")?.dataset.entityId;
          if (id) return startThread(p.kind === "flow" ? { kind: "node", id } : { kind: "entity", id });
          const w = p.toWorldPoint ? p.toWorldPoint(e.clientX, e.clientY) : toWorld(e.clientX, e.clientY);
          startThread({ kind: "point", x: Math.round(w.x), y: Math.round(w.y) });
        }}
      >
        <div class="comment-placing-hint panel">Click a {p.kind === "flow" ? "block" : "table"} or a spot to comment · Esc to stop</div>
      </div>
    </Show>
  );
}
