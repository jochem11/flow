// Preview of the code for the UML classes in the open flowchart, per language, with
// syntax colors: copy it, or download it (Java: a folder with one file per class).

import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { api, errMsg } from "../lib/api";
import { board, boardSnapshot, selectedNodes } from "../lib/store";
import type { CodeLanguage, FlowDoc } from "../lib/types";
import { exportClasses, openDoc, runExport } from "../lib/workspace";
import { PreviewDialog } from "./PreviewDialog";

export const LANGUAGES: { value: CodeLanguage; label: string; hint: string }[] = [
  { value: "typescript", label: "TypeScript", hint: ".ts" },
  { value: "java", label: "Java", hint: "folder of .java" },
  { value: "csharp", label: "C#", hint: ".cs" },
  { value: "python", label: "Python", hint: ".py" },
  { value: "kotlin", label: "Kotlin", hint: ".kt" },
  { value: "rust", label: "Rust", hint: ".rs" },
  { value: "go", label: "Go", hint: ".go" },
];

/**
 * The flowchart with only these classes (and the lines between them, and the
 * packages they are in), to make code for part of a diagram.
 */
function onlyClasses(flow: FlowDoc, ids: Set<string>): FlowDoc {
  const parents = new Set(flow.nodes.filter((n) => ids.has(n.id) && n.parent).map((n) => n.parent!));
  return {
    ...flow,
    nodes: flow.nodes.filter((n) => ids.has(n.id) || parents.has(n.id)),
    edges: flow.edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
  };
}

export function CodeDialog(p: { initial: CodeLanguage; onClose: () => void }) {
  const [lang, setLang] = createSignal<CodeLanguage>(p.initial);
  // The classes selected when the preview was opened; the code is for those, or for all
  const picked = new Set(selectedNodes().filter((n) => n.kind === "class").map((n) => n.id));
  const total = board.nodes.filter((n) => n.kind === "class").length;
  const [onlySelected, setOnlySelected] = createSignal(picked.size > 0 && picked.size < total);
  const [files] = createResource(
    () => [lang(), onlySelected()] as const,
    ([l, only]) => {
      const flow = boardSnapshot();
      return api.classCode(only ? onlyClasses(flow, picked) : flow, l, openDoc()?.name).catch((e) => [{ name: "error", content: `// ${errMsg(e)}` }]);
    },
  );
  const [fileIndex, setFileIndex] = createSignal(0);
  createEffect(() => (lang(), setFileIndex(0)));
  const file = () => files()?.[fileIndex()];

  return (
    <PreviewDialog
      title="Code"
      tabs={LANGUAGES}
      tab={lang()}
      onTab={setLang}
      code={files.loading ? undefined : file()?.content ?? "// There are no UML classes in this flowchart"}
      lang={lang()}
      copyName={file()?.name ?? "Code"}
      downloadTitle={lang() === "java" ? "Saves a folder with one file per class to Downloads" : "Saves the file to your Downloads folder"}
      canDownload={!!files()?.length}
      onDownload={() => (onlySelected() ? exportClasses(onlyClasses(boardSnapshot(), picked), lang()) : runExport(lang()))}
      onClose={p.onClose}
      above={
        <Show when={(files()?.length ?? 0) > 1}>
          <div class="code-files">
            <For each={files()}>
              {(f, i) => (
                <button class="code-file" classList={{ active: fileIndex() === i() }} onClick={() => setFileIndex(i())}>
                  {f.name}
                </button>
              )}
            </For>
          </div>
        </Show>
      }
      foot={
        <Show when={picked.size > 0 && picked.size < total}>
          <div class="code-scope">
            <button class="sql-tab" classList={{ active: onlySelected() }} onClick={() => setOnlySelected(true)}>
              Selected ({picked.size})
            </button>
            <button class="sql-tab" classList={{ active: !onlySelected() }} onClick={() => setOnlySelected(false)}>
              All classes ({total})
            </button>
          </div>
        </Show>
      }
    />
  );
}
