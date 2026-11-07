// What happened in a project, on its page (server/src/routes/activity.rs): who
// made, edited, renamed, deleted or restored which board, comments, and people
// joining. Newest first, by day; more on request.

import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { get } from "../lib/server";
import type { Activity } from "../lib/types";
import { docsOf, openDocument } from "../lib/workspace";
import { Avatar } from "./AccountMenu";

const VERB: Record<Activity["kind"], string> = {
  created: "made",
  edited: "edited",
  renamed: "renamed",
  deleted: "deleted",
  restored: "restored",
  commented: "commented on",
  joined: "joined",
};

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const day = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
};

export function ProjectActivity(p: { projectId: string }) {
  const [more, setMore] = createSignal<Activity[]>([]);
  const [done, setDone] = createSignal(false);
  const [first, { refetch }] = createResource(
    () => p.projectId,
    (id) => get<Activity[]>(`/projects/${id}/activity`).catch(() => null),
  );
  const onFocus = () => void refetch();
  window.addEventListener("focus", onFocus);
  onCleanup(() => window.removeEventListener("focus", onFocus));

  const all = () => [...(first() ?? []), ...more()];
  const loadMore = async () => {
    const last = all()[all().length - 1];
    if (!last) return;
    const next = await get<Activity[]>(`/projects/${p.projectId}/activity?before=${last.at}`).catch(() => []);
    if (next.length < 40) setDone(true);
    setMore((m) => [...m, ...next]);
  };
  const open = (a: Activity) => {
    // Only boards that are still there
    if (a.documentId && docsOf(p.projectId).some((d) => d.id === a.documentId)) void openDocument(p.projectId, a.documentId);
  };

  return (
    <Show when={first() !== null && all().length}>
      <h3 class="section-title">Activity</h3>
      <div class="activity-list">
        <For each={all()}>
          {(a, i) => (
            <>
              <Show when={i() === 0 || day(all()[i() - 1].at) !== day(a.at)}>
                <div class="activity-day">{day(a.at)}</div>
              </Show>
              <div class="activity-item">
                <Avatar name={a.actor} url={a.actorAvatar} size={22} />
                <span class="activity-text">
                  <strong>{a.actor}</strong> {VERB[a.kind]}{" "}
                  <Show when={a.kind === "joined" && !a.documentName}>the project</Show>
                  <Show when={a.documentName}>
                    <button class="link-btn activity-board" onClick={() => open(a)}>
                      {a.documentName}
                    </button>
                  </Show>
                  <Show when={a.kind === "renamed" && a.detail}>
                    <span class="activity-detail"> (was {a.detail})</span>
                  </Show>
                  <Show when={a.kind === "edited" && a.count > 1}>
                    <span class="activity-detail"> · {a.count} saves</span>
                  </Show>
                  <Show when={a.kind === "commented" && a.detail}>
                    <span class="activity-quote">“{a.detail}”</span>
                  </Show>
                </span>
                <small class="activity-time">{time(a.at)}</small>
              </div>
            </>
          )}
        </For>
        <Show when={!done() && all().length >= 40}>
          <button class="text-btn small" onClick={() => void loadMore()}>
            Show more
          </button>
        </Show>
      </div>
    </Show>
  );
}
