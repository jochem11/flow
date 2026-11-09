// The design checks of a flow board (designChecks.ts) in the top bar: how many,
// and the list; picking one selects what it is about and brings it into view.
// Shown only when there is something to say. A board with its checks off is not
// checked: the button says so, and turns the checks on again.

import { createEffect, createSignal, For, on, onCleanup, Show, untrack } from "solid-js";
import { focusOn } from "../lib/camera";
import { checkDesign, type DesignProblem } from "../lib/designChecks";
import { board, remoteRev, rev, select, setRelaxed } from "../lib/store";
import { canEdit } from "../lib/access";

/** The list is open (the top bar's "…" menu opens it too, when the bar has no room for the button) */
const [open, setOpen] = createSignal(false);
export const setChecksOpen = setOpen;
/** How many checks say something now (for the "…" menu) */
const [count, setCount] = createSignal(0);
export const checkCount = count;

export function DesignChecks() {
  // Warnings first, then tips. Checked shortly after the changes stop (a whole
  // board's check on every key or drag step would slow typing and dragging down)
  const check = () => checkDesign(board.nodes, board.edges, board.diagram).sort((a, b) => Number(a.level === "tip") - Number(b.level === "tip"));
  const [problems, setProblems] = createSignal<DesignProblem[]>(untrack(check));
  let later: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    on([rev, remoteRev, () => board.diagram, () => board.nodes.length, () => board.edges.length], () => {
      clearTimeout(later);
      later = setTimeout(() => setProblems(untrack(check)), 250);
    }, { defer: true }),
  );
  onCleanup(() => clearTimeout(later));
  createEffect(() => setCount(board.relaxed ? 0 : problems().length));
  onCleanup(() => {
    setOpen(false);
    setCount(0);
  });
  let wrap!: HTMLSpanElement;
  const onDoc = (e: PointerEvent) => {
    if (open() && !wrap.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));

  const show = (p: DesignProblem) => {
    setOpen(false);
    const ns = board.nodes.filter((n) => p.nodeIds.includes(n.id));
    if (!ns.length) return;
    select(ns.map((n) => n.id));
    const x = Math.min(...ns.map((n) => n.x));
    const y = Math.min(...ns.map((n) => n.y));
    focusOn({ x, y, w: Math.max(...ns.map((n) => n.x + n.w)) - x, h: Math.max(...ns.map((n) => n.y + n.h)) - y });
  };

  return (
    <Show
      when={!board.relaxed}
      fallback={
        <Show when={canEdit()}>
          <button class="text-btn eer-checks-btn off" title="The UML checks are off for this board: click to turn them on" onClick={() => setRelaxed(false)}>
            Checks off
          </button>
        </Show>
      }
    >
    <Show when={problems().length}>
      <span class="uml-wrap" ref={wrap}>
        <button
          class="text-btn eer-checks-btn"
          classList={{ warn: problems().some((x) => x.level === "warning"), pressed: open() }}
          onClick={() => setOpen(!open())}
          title="What may make the diagram hard to read, or wrong"
        >
          Checks <span class="eer-checks-count">{problems().length}</span>
        </button>
        <Show when={open()}>
          <div class="eer-checks panel">
            <For each={problems()}>
              {(x) => (
                <button class="eer-check" classList={{ warning: x.level === "warning" }} onClick={() => show(x)}>
                  <span class="eer-check-mark">{x.level === "warning" ? "!" : "i"}</span>
                  {x.message}
                </button>
              )}
            </For>
            <Show when={canEdit()}>
              <button
                class="eer-check eer-checks-foot"
                title="No checks on this board, and class rows in free text are not marked"
                onClick={() => {
                  setOpen(false);
                  setRelaxed(true);
                }}
              >
                Turn checks off for this board
              </button>
            </Show>
          </div>
        </Show>
      </span>
    </Show>
    </Show>
  );
}
