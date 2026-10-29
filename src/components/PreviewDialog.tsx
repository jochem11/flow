// The frame shared by the export previews (code, SQL, Mermaid): tabs at the top,
// the text with syntax colors, and Copy / Download at the bottom.

import { For, type JSX, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { HighlightLanguage } from "../lib/highlight";
import { toast } from "../lib/toast";
import { CodeView } from "./CodeView";
import { IconClose, IconExport } from "./icons";

export function PreviewDialog<T extends string | number>(p: {
  title: string;
  tabs: { value: T; label: string }[];
  tab: T;
  onTab: (value: T) => void;
  /** The text shown; undefined while it is loading */
  code: string | undefined;
  lang: HighlightLanguage;
  /** What the toast calls the copied text */
  copyName: string;
  downloadTitle: string;
  canDownload: boolean;
  onDownload: () => void;
  onClose: () => void;
  /** Between the tabs and the text (e.g. the files of the code) */
  above?: JSX.Element;
  /** In the footer, before the buttons */
  foot?: JSX.Element;
}) {
  const copy = async () => {
    await navigator.clipboard.writeText(p.code ?? "");
    toast(`${p.copyName} copied`);
  };

  return (
    <Portal>
      <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
        <div class="sql-dialog panel" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
          <div class="sql-dialog-head">
            <strong>{p.title}</strong>
            <div class="sql-tabs">
              <For each={p.tabs}>
                {(t) => (
                  <button class="sql-tab" classList={{ active: p.tab === t.value }} onClick={() => p.onTab(t.value)}>
                    {t.label}
                  </button>
                )}
              </For>
            </div>
            <button class="icon-btn" title="Close" onClick={p.onClose}>
              <IconClose />
            </button>
          </div>
          {p.above}
          <div class="sql-code">
            <Show when={p.code !== undefined} fallback="…">
              <CodeView code={p.code!} lang={p.lang} />
            </Show>
          </div>
          <div class="sql-dialog-foot">
            {p.foot}
            <button class="text-btn" disabled={!p.code} onClick={copy}>
              Copy
            </button>
            <button class="text-btn primary" disabled={!p.canDownload} title={p.downloadTitle} onClick={p.onDownload}>
              <IconExport />
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
