// A button that asks for a second click before doing something destructive.
// (window.confirm does not work in the Tauri webview.)

import { createSignal, onCleanup, Show, type JSX } from "solid-js";

export function ConfirmButton(p: {
  children: JSX.Element;
  onConfirm: () => void;
  class?: string;
  title?: string;
  confirmLabel?: string;
}) {
  const [asking, setAsking] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  return (
    <Show
      when={asking()}
      fallback={
        <button
          class={p.class}
          title={p.title}
          onClick={() => {
            setAsking(true);
            clearTimeout(timer);
            timer = setTimeout(() => setAsking(false), 3000);
          }}
        >
          {p.children}
        </button>
      }
    >
      <button
        class="confirm-delete"
        onClick={() => {
          setAsking(false);
          p.onConfirm();
        }}
      >
        {p.confirmLabel ?? "Delete?"}
      </button>
    </Show>
  );
}
