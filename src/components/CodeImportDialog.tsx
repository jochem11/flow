// Import code into the open flowchart as a UML class diagram: paste code (or
// open / drop a file), pick the language or let it be guessed, see which classes
// it has, and add them in a new frame as one undo step. Reading the code happens
// in Rust (src-tauri/src/commands/code_import/).

import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { api, errMsg } from "../lib/api";
import { focusOn } from "../lib/camera";
import { insertClasses } from "../lib/store";
import { toast } from "../lib/toast";
import type { CodeLanguage, FlowNode } from "../lib/types";
import { LANGUAGES } from "./CodeDialog";
import { IconClose } from "./icons";

const EXTENSIONS: Record<string, CodeLanguage> = {
  ts: "typescript",
  tsx: "typescript",
  java: "java",
  cs: "csharp",
  py: "python",
  kt: "kotlin",
  kts: "kotlin",
  rs: "rust",
  go: "go",
};

const label = (l: CodeLanguage) => LANGUAGES.find((x) => x.value === l)?.label ?? l;

/** Name and stereotype of a class node, and how many rows it has. */
function summary(n: FlowNode) {
  const [head = "", ...parts] = n.text.split("\n--\n");
  const lines = head.split("\n");
  const kind = lines.find((l) => l.startsWith("«"))?.slice(1, -1);
  const rows = parts.join("\n").split("\n").filter((l) => l.trim()).length;
  return { name: lines.find((l) => !l.startsWith("«")) ?? "", kind, rows };
}

export function CodeImportDialog(p: { onClose: () => void }) {
  const [code, setCode] = createSignal("");
  const [lang, setLang] = createSignal<CodeLanguage | null>(null);
  // Read while typing, but not on every key
  const [settled, setSettled] = createSignal("");
  let timer: number | undefined;
  const type = (value: string, now = false) => {
    setCode(value);
    clearTimeout(timer);
    if (now) setSettled(value);
    else timer = window.setTimeout(() => setSettled(value), 300);
  };
  onCleanup(() => clearTimeout(timer));

  const [result] = createResource(
    () => [settled(), lang()] as const,
    ([c, l]) => (c.trim() ? api.importCode(c, l).then((r) => ({ ok: r, error: null }), (e) => ({ ok: null, error: errMsg(e) })) : null),
  );
  const imported = () => result()?.ok;
  const count = () => imported()?.nodes.length ?? 0;

  const open = async (file: File | undefined) => {
    if (!file) return;
    const known = EXTENSIONS[file.name.split(".").pop()?.toLowerCase() ?? ""];
    if (known) setLang(known);
    type(await file.text(), true);
  };
  let fileInput!: HTMLInputElement;

  const add = () => {
    const r = imported();
    if (!r) return;
    const frame = insertClasses(r, `Imported from ${label(r.language)}`);
    toast(`Added ${r.nodes.length} ${r.nodes.length === 1 ? "class" : "classes"}`);
    p.onClose();
    if (frame) requestAnimationFrame(() => focusOn(frame));
  };

  return (
    <Portal>
      <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
        <div class="sql-dialog import-dialog panel" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
          <div class="sql-dialog-head">
            <strong>Import code</strong>
            <div class="sql-tabs">
              <button class="sql-tab" classList={{ active: lang() === null }} onClick={() => setLang(null)}>
                Auto
                <Show when={lang() === null && imported()}>{(r) => <small class="import-detected"> · {label(r().language)}</small>}</Show>
              </button>
              <For each={LANGUAGES}>
                {(l) => (
                  <button class="sql-tab" classList={{ active: lang() === l.value }} onClick={() => setLang(l.value)}>
                    {l.label}
                  </button>
                )}
              </For>
            </div>
            <button class="icon-btn" title="Close" onClick={p.onClose}>
              <IconClose />
            </button>
          </div>
          <textarea
            class="import-sql"
            placeholder="Paste classes, interfaces and enums here, or drop a source file"
            spellcheck={false}
            value={code()}
            onInput={(e) => type(e.currentTarget.value)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void open(e.dataTransfer?.files[0]);
            }}
            ref={(el) => requestAnimationFrame(() => el.focus())}
          />
          <div class="import-preview">
            <Show when={result()?.error}>{(err) => <div class="import-note error">{err()}</div>}</Show>
            <Show when={imported()}>
              {(r) => (
                <>
                  <div class="import-tables">
                    <For each={r().nodes} fallback={<span class="import-none">No classes found</span>}>
                      {(n) => {
                        const s = summary(n);
                        return (
                          <span class="import-table" title={n.text.replace(/\n--\n/g, "\n")}>
                            {s.name}
                            <small>{s.kind ?? `${s.rows} rows`}</small>
                          </span>
                        );
                      }}
                    </For>
                  </div>
                  <Show when={r().package}>{(pkg) => <div class="import-note">In package {pkg()}</div>}</Show>
                  <For each={r().skipped}>{(s) => <div class="import-note">{s}</div>}</For>
                </>
              )}
            </Show>
          </div>
          <div class="sql-dialog-foot">
            <input
              type="file"
              accept=".ts,.tsx,.java,.cs,.py,.kt,.kts,.rs,.go,text/plain"
              hidden
              ref={fileInput}
              onChange={(e) => void open(e.currentTarget.files?.[0])}
            />
            <button class="text-btn" onClick={() => fileInput.click()}>
              Open file…
            </button>
            <span class="spacer" />
            <button class="text-btn" onClick={p.onClose}>
              Cancel
            </button>
            <button class="text-btn primary" disabled={!count() || result.loading} onClick={add}>
              <span>
                Add {count() || ""} {count() === 1 ? "class" : "classes"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
