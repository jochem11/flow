// The inbox in the sidebar's head: a bell with the number unread, and the list
// of mentions and answers. Picking one opens its board with the thread.

import { createSignal, For, onCleanup, Show } from "solid-js";
import { inbox, markRead, openNotification } from "../lib/inbox";
import { me } from "../lib/auth";
import { IconBell } from "./icons";

const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });
};

export function InboxButton() {
  const [open, setOpen] = createSignal(false);
  let wrap!: HTMLDivElement;
  const onDoc = (e: PointerEvent) => open() && !wrap.contains(e.target as Node) && setOpen(false);
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));
  const unread = () => inbox().unread;
  return (
    <Show when={me()}>
      <div class="uml-wrap inbox-wrap" ref={wrap}>
        <button
          class="icon-btn small inbox-btn"
          classList={{ pressed: open() }}
          title={unread() ? `Inbox: ${unread()} new` : "Inbox"}
          aria-label={unread() ? `Inbox, ${unread()} new` : "Inbox"}
          aria-expanded={open()}
          onClick={() => setOpen(!open())}
        >
          <IconBell />
          <Show when={unread()}>
            <span class="inbox-count">{unread() > 9 ? "9+" : unread()}</span>
          </Show>
        </button>
        <Show when={open()}>
          <div class="inbox-panel panel" role="dialog" aria-label="Inbox" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            <div class="inbox-head">
              <strong>Inbox</strong>
              <Show when={unread()}>
                <button class="link-btn" onClick={() => void markRead()}>
                  Mark all read
                </button>
              </Show>
            </div>
            <div class="inbox-list">
              <For each={inbox().items} fallback={<p class="inbox-empty">Nothing yet. When someone mentions you (@) or answers in your threads, it shows here.</p>}>
                {(n) => (
                  <button
                    class="inbox-item"
                    classList={{ unread: !n.readAt }}
                    onClick={() => {
                      setOpen(false);
                      void openNotification(n);
                    }}
                  >
                    <span class="inbox-line">
                      <strong>{n.actor}</strong> {n.kind === "mention" ? "mentioned you" : "answered"} on <strong>{n.documentName}</strong>
                    </span>
                    <span class="inbox-excerpt">{n.excerpt}</span>
                    <small>
                      {n.projectName} · {ago(n.createdAt)}
                    </small>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
}
