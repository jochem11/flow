// Preview of the open document as Mermaid, one tab per diagram in it (flowchart,
// class, sequence, or ER for an EER diagram). Download writes them all to one
// Markdown file with a ```mermaid block each (or a .mmd file when there is one).

import { createResource, createSignal } from "solid-js";
import { api, errMsg } from "../lib/api";
import type { CodeFile } from "../lib/types";
import { currentDocument, runExport } from "../lib/workspace";
import { PreviewDialog } from "./PreviewDialog";

export function MermaidDialog(p: { onClose: () => void }) {
  const doc = currentDocument();
  const [blocks] = createResource(
    (): Promise<CodeFile[]> => (doc ? api.mermaidPreview(doc) : Promise.resolve([])).catch((e) => [{ name: "Error", content: `%% ${errMsg(e)}\n` }]),
  );
  const [tab, setTab] = createSignal(0);
  const block = () => blocks()?.[tab()];
  const many = () => (blocks()?.length ?? 0) > 1;

  return (
    <PreviewDialog
      title="Mermaid"
      tabs={(blocks() ?? []).map((b, i) => ({ value: i, label: b.name }))}
      tab={tab()}
      onTab={setTab}
      code={blocks.loading ? undefined : block()?.content ?? "%% There is nothing in this document Mermaid can draw\n"}
      lang="mermaid"
      copyName={block()?.name ?? "Mermaid"}
      downloadTitle={many() ? "Saves a .md file with one Mermaid block per diagram to Downloads" : "Saves a .mmd file to your Downloads folder"}
      canDownload={!!blocks()?.length}
      onDownload={() => runExport("mermaid")}
      onClose={p.onClose}
    />
  );
}
