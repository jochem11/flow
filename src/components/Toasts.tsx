import { For } from "solid-js";
import { dismiss, toasts } from "../lib/toast";

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      <For each={toasts()}>
        {(t) => (
          <div class={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.text}
          </div>
        )}
      </For>
    </div>
  );
}
