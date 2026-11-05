// A modal dialog: a title with a close button over its content.
// Escape or a click on the backdrop closes it.

import { type JSX, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose } from "./icons";

export function Dialog(p: { title: string; onClose: () => void; children: JSX.Element }) {
  // Escape closes it wherever the focus is (it moves away when the lists reload)
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
  window.addEventListener("keydown", onKey);
  onCleanup(() => window.removeEventListener("keydown", onKey));
  return (
    <Portal>
      <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
        <div class="share-dialog panel">
          <div class="sql-dialog-head">
            <strong>{p.title}</strong>
            <span class="spacer" />
            <button class="icon-btn" title="Close" onClick={p.onClose}>
              <IconClose />
            </button>
          </div>
          <div class="share-body">{p.children}</div>
        </div>
      </div>
    </Portal>
  );
}
