// Shared markdown UI: the rendered view and the editing shortcuts for textareas.

import { createMemo } from "solid-js";
import { handleLinkClick, renderMarkdown } from "../lib/markdown";
import { applyFormat, continueList, formatShortcut } from "../lib/mdFormat";

/** Rendered markdown. Links open in the default browser, not inside the app. */
export function MarkdownView(p: { text: string; class?: string; onDblClick?: () => void }) {
  const html = createMemo(() => renderMarkdown(p.text));
  return (
    <div
      class={`markdown ${p.class ?? ""}`}
      innerHTML={html()}
      onClick={handleLinkClick}
      onDblClick={() => p.onDblClick?.()}
    />
  );
}

/** Keydown handler for markdown textareas: formatting shortcuts and list continuation on Enter. */
export function onMarkdownKeyDown(e: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
  const f = formatShortcut(e);
  if (f) {
    e.preventDefault();
    applyFormat(e.currentTarget, f);
    return;
  }
  if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey && continueList(e.currentTarget)) {
    e.preventDefault();
  }
}
