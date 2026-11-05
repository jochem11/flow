// Who else is on the board (editing together, see lib/collab): their avatars in
// the top bar, and their pointers and selections on the flowchart and EER canvases.

import { createEffect, createRoot, createSignal, For, on, onCleanup, Show } from "solid-js";
import { peers, sharePresence, status, type Peer } from "../lib/collab";
import { eer, eerSelectedIds, eerViewportRect, entityRect, setEerCamera } from "../lib/eer";
import { viewportRect } from "../lib/camera";
import { board, setCamera, ui } from "../lib/store";
import type { Camera } from "../lib/types";
import { openDoc } from "../lib/workspace";
import { Avatar } from "./AccountMenu";

// ---------- following someone's view ----------

/** Whose view we follow (their awareness client id) */
const [following, setFollowing] = createSignal<number | null>(null);
export { following };
export const stopFollowing = () => setFollowing(null);

const canFollow = () => openDoc()?.kind === "flow" || openDoc()?.kind === "eer";

/** The open canvas: its camera, its size on screen, and how to move it */
function canvas(): { cam: Camera; view: DOMRect | null; set: (c: Camera) => void } {
  return openDoc()?.kind === "eer"
    ? { cam: eer.camera, view: eerViewportRect(), set: setEerCamera }
    : { cam: board.camera, view: viewportRect(), set: (c) => setCamera(c) };
}

// Shares what we see, at most every 100 ms; follows the one we follow
createRoot(() => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on(
      () => {
        if (!canFollow()) return null;
        const { cam } = canvas();
        return [cam.x, cam.y, cam.zoom];
      },
      (c) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const { cam, view } = canvas();
          sharePresence({
            view: c && view ? { x: -cam.x / cam.zoom, y: -cam.y / cam.zoom, w: view.width / cam.zoom, h: view.height / cam.zoom } : null,
          });
        }, 100);
      },
    ),
  );
  createEffect(() => {
    const id = following();
    if (id === null) return;
    const p = peers().find((x) => x.clientId === id);
    if (!p || !canFollow()) return setFollowing(null);
    const v = p.view;
    const { view, set } = canvas();
    if (!v || !view) return;
    // Their view in the middle of ours, as large as fits
    const zoom = Math.min(4, Math.max(0.1, Math.min(view.width / v.w, view.height / v.h)));
    set({ zoom, x: view.width / 2 - (v.x + v.w / 2) * zoom, y: view.height / 2 - (v.y + v.h / 2) * zoom });
  });
  // Moving around ourselves stops following
  const stop = (e: Event) => {
    if (following() !== null && (e.target as HTMLElement | null)?.closest?.(".viewport")) setFollowing(null);
  };
  window.addEventListener("wheel", stop, { capture: true, passive: true });
  window.addEventListener("pointerdown", stop, { capture: true });
});

const followed = (): Peer | undefined => peers().find((p) => p.clientId === following());

/** The people on the board, and whether the connection is live. Click someone to follow their view. */
export function PresenceAvatars() {
  return (
    <Show when={openDoc()?.role}>
      <div class="presence">
        <Show when={status() === "offline" || status() === "connecting"}>
          <span class="presence-status" title={status() === "offline" ? "Not connected; changes are sent when the connection is back" : "Connecting…"}>
            {status() === "offline" ? "Offline" : "Connecting…"}
          </span>
        </Show>
        <Show when={followed()}>
          {(p) => (
            <button class="follow-pill" style={{ "--peer": p().color }} title="Stop following" onClick={stopFollowing}>
              Following {p().name} ×
            </button>
          )}
        </Show>
        <For each={peers().slice(0, 5)}>
          {(p) => (
            <button
              class="presence-avatar"
              classList={{ following: following() === p.clientId }}
              style={{ "--peer": p.color }}
              title={canFollow() ? (following() === p.clientId ? `Stop following ${p.name}` : `Follow ${p.name}: see what they see`) : p.name}
              disabled={!canFollow()}
              onClick={() => setFollowing(following() === p.clientId ? null : p.clientId)}
            >
              <Avatar name={p.name} size={24} />
            </button>
          )}
        </For>
        <Show when={peers().length > 5}>
          <span class="presence-more">+{peers().length - 5}</span>
        </Show>
      </div>
    </Show>
  );
}

/** Shares our pointer (in world coordinates) while it moves over a canvas, at most every 50 ms. */
export function trackPointer(el: HTMLElement, toWorld: (x: number, y: number) => { x: number; y: number }) {
  let last = 0;
  const move = (e: PointerEvent) => {
    const now = performance.now();
    if (now - last < 50) return;
    last = now;
    const w = toWorld(e.clientX, e.clientY);
    sharePresence({ cursor: { x: Math.round(w.x), y: Math.round(w.y) } });
  };
  const leave = () => sharePresence({ cursor: null });
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerleave", leave);
  onCleanup(() => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerleave", leave);
  });
}

function Cursor(p: { x: number; y: number; zoom: number; name: string; color: string }) {
  return (
    <div class="peer-cursor" style={{ left: `${p.x}px`, top: `${p.y}px`, transform: `scale(${1 / p.zoom})`, "--peer": p.color }}>
      <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
        <path d="M1 1l13 7-6 1.5L5 16z" fill="var(--peer)" stroke="#fff" stroke-width="1.5" stroke-linejoin="round" />
      </svg>
      <span>{p.name}</span>
    </div>
  );
}

/** Others' pointers and selections on a flowchart (inside its world layer); shares our selection. */
export function FlowPresence() {
  createEffect(() => sharePresence({ selection: [...ui.selected] }));
  return (
    <For each={peers()}>
      {(p) => (
        <>
          <For each={(p.selection ?? []).map((id) => board.nodes.find((n) => n.id === id)).filter(Boolean)}>
            {(n) => <div class="peer-selection" style={{ left: `${n!.x - 4}px`, top: `${n!.y - 4}px`, width: `${n!.w + 8}px`, height: `${n!.h + 8}px`, "--peer": p.color }} />}
          </For>
          <Show when={p.cursor}>{(c) => <Cursor x={c().x} y={c().y} zoom={board.camera.zoom} name={p.name} color={p.color} />}</Show>
        </>
      )}
    </For>
  );
}

/** The same on an EER diagram. */
export function EerPresence() {
  createEffect(() => sharePresence({ selection: eerSelectedIds() }));
  /** A table or a section, by id */
  const rectOf = (id: string) => {
    const e = eer.entities.find((x) => x.id === id);
    return e ? entityRect(e) : eer.sections.find((x) => x.id === id);
  };
  return (
    <For each={peers()}>
      {(p) => (
        <>
          <For each={(p.selection ?? []).filter((id) => rectOf(id))}>
            {(id) => {
              const r = () => rectOf(id) ?? { x: 0, y: 0, w: 0, h: 0 };
              return <div class="peer-selection" style={{ left: `${r().x - 4}px`, top: `${r().y - 4}px`, width: `${r().w + 8}px`, height: `${r().h + 8}px`, "--peer": p.color }} />;
            }}
          </For>
          <Show when={p.cursor}>{(c) => <Cursor x={c().x} y={c().y} zoom={eer.camera.zoom} name={p.name} color={p.color} />}</Show>
        </>
      )}
    </For>
  );
}
