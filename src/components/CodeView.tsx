// Code with syntax colors and line numbers, for the SQL and code previews.

import { createMemo, For } from "solid-js";
import { highlight, type HighlightLanguage } from "../lib/highlight";

export function CodeView(p: { code: string; lang: HighlightLanguage }) {
  const tokens = createMemo(() => highlight(p.code, p.lang));
  const lines = createMemo(() => p.code.replace(/\n$/, "").split("\n").length);
  return (
    <div class="code-view">
      <pre class="code-gutter" aria-hidden="true">
        {Array.from({ length: lines() }, (_, i) => i + 1).join("\n")}
      </pre>
      <pre class="code-text">
        <For each={tokens()}>{(t) => (t.kind === "plain" ? t.text : <span class={`tok-${t.kind}`}>{t.text}</span>)}</For>
      </pre>
    </div>
  );
}
