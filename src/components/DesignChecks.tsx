// The design checks of a flow board (designChecks.ts) in the top bar: how many,
// and the list; picking one selects what it is about and brings it into view.
// Shown only when there is something to say. A relaxed board (only the focus
// points) is not checked: the button says so, and turns the checks on again.

import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { focusOn } from "../lib/camera";
import { checkDesign, type DesignProblem } from "../lib/designChecks";
import { board, select, setRelaxed } from "../lib/store";
import { canEdit } from "../lib/access";

export function DesignChecks() {
  // Warnings first, then tips
  const problems = createMemo(() =>
    checkDesign(board.nodes, board.edges, board.diagram).sort((a, b) => Number(a.level === "tip") - Number(b.level === "tip")),
  );
  const [open, setOpen] = createSignal(false);
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
          <button class="text-btn eer-checks-btn off" title="This board shows only the focus points and is not checked: click to check it again" onClick={() => setRelaxed(false)}>
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
                title="For a board with only the focus points: no checks, any type and free-text rows in classes"
                onClick={() => {
                  setOpen(false);
                  setRelaxed(true);
                }}
              >
                Turn checks off for this board (only the focus points)
              </button>
            </Show>
          </div>
        </Show>
      </span>
    </Show>
    </Show>
  );
}
