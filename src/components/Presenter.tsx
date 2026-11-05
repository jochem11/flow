// The bar at the bottom while presenting (see lib/present.ts).

import { Show } from "solid-js";
import { goTo, index, next, presenting, previous, slides, stopPresenting } from "../lib/present";

export function Presenter() {
  return (
    <Show when={presenting()}>
      <div class="presenter panel">
        <button class="icon-btn" title="Previous (←)" disabled={index() === 0} onClick={previous}>
          ‹
        </button>
        <select class="presenter-select" value={index()} onChange={(e) => goTo(Number(e.currentTarget.value))}>
          {slides()!.map((s, i) => (
            <option value={i}>
              {i + 1}. {s.title}
            </option>
          ))}
        </select>
        <span class="presenter-count">
          {index() + 1} / {slides()!.length}
        </span>
        <button class="icon-btn" title="Next (→ or Space)" disabled={index() === slides()!.length - 1} onClick={next}>
          ›
        </button>
        <button class="text-btn" onClick={stopPresenting}>
          Stop (Esc)
        </button>
      </div>
    </Show>
  );
}
