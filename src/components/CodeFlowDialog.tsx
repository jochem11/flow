// An activity diagram from a codebase: read a folder or a git repository
// (lib/codeFlow.ts), pick the function to start from (web routes first), say how
// deep to follow its calls, and draw it on the board (one undo step).

import { createMemo, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { errMsg } from "../lib/api";
import { focusOn } from "../lib/camera";
import { activityOf, lastCode, type Loaded, readFolder, readRepo, setLastCode } from "../lib/codeFlow";
import { inTauri } from "../lib/server";
import { insertDiagram } from "../lib/store";
import { toast } from "../lib/toast";
import type { CodeFunction } from "../bindings";
import { IconClose } from "./icons";

const DEPTHS = [
  { value: 0, label: "Only this function" },
  { value: 1, label: "1 call deep" },
  { value: 2, label: "2 calls deep" },
  { value: 3, label: "3 calls deep" },
];

/** At most this many in the list (search for the rest) */
const SHOWN = 200;

const fnName = (f: CodeFunction) => (f.class ? `${f.class}.${f.name}` : f.name);

export function CodeFlowDialog(p: { onClose: () => void }) {
  const [code, setCode] = createSignal<Loaded | null>(lastCode());
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [url, setUrl] = createSignal("");
  const [branch, setBranch] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [picked, setPicked] = createSignal<string | null>(null);
  const [depth, setDepth] = createSignal(2);
  let folderInput!: HTMLInputElement;

  const run = async (what: string, task: () => Promise<Loaded>) => {
    setBusy(what);
    setError(null);
    try {
      const loaded = await task();
      setCode(loaded);
      setPicked(loaded.source.functions[0]?.id ?? null);
      setQuery("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const matches = createMemo(() => {
    const c = code();
    if (!c) return [];
    const words = query().toLowerCase().split(/\s+/).filter(Boolean);
    return c.source.functions.filter((f) => {
      const hay = `${fnName(f)} ${f.file} ${f.route ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  });

  const draw = async () => {
    const c = code();
    const entry = picked();
    if (!c || !entry) return;
    setBusy("Drawing…");
    setError(null);
    try {
      const a = await activityOf(c, entry, depth());
      const area = insertDiagram({ nodes: a.nodes, edges: a.edges, diagram: "activity" });
      const f = c.source.functions.find((x) => x.id === entry);
      toast(`Drew ${f ? fnName(f) : "the function"}: ${a.nodes.length} blocks`);
      for (const n of a.notes) toast(n);
      p.onClose();
      if (area) requestAnimationFrame(() => focusOn(area));
    } catch (e) {
      const msg = errMsg(e);
      // Kept no longer (an hour on the server): read it again
      if (/read it again/i.test(msg)) {
        setLastCode(null);
        setCode(null);
      }
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Portal>
      <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
        <div class="sql-dialog import-dialog code-flow-dialog panel" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
          <div class="sql-dialog-head">
            <strong>Activity diagram from code</strong>
            <span class="import-hint">Java, Kotlin, C#, Go, Python, TypeScript, JavaScript</span>
            <button class="icon-btn" title="Close" onClick={p.onClose}>
              <IconClose />
            </button>
          </div>

          <Show
            when={code()}
            fallback={
              <div class="code-flow-sources">
                <div class="code-flow-source">
                  <strong>A folder</strong>
                  <p>{inTauri ? "Its source files are read on this computer." : "Its source files are sent to the server, read, and kept there for an hour."}</p>
                  <input
                    type="file"
                    hidden
                    multiple
                    ref={(el) => {
                      folderInput = el;
                      el.setAttribute("webkitdirectory", "");
                    }}
                    onChange={(e) => {
                      const files = [...(e.currentTarget.files ?? [])];
                      e.currentTarget.value = "";
                      if (files.length) void run("Reading the folder…", () => readFolder(files));
                    }}
                  />
                  <button class="text-btn primary" disabled={!!busy()} onClick={() => folderInput.click()}>
                    Choose a folder…
                  </button>
                </div>
                <form
                  class="code-flow-source"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (url().trim()) void run("Downloading the repository…", () => readRepo(url().trim(), branch().trim()));
                  }}
                >
                  <strong>A git repository</strong>
                  <p>Its https address. Private: put an access token in it (https://TOKEN@github.com/owner/project).</p>
                  <input class="code-flow-input" placeholder="https://github.com/owner/project" value={url()} onInput={(e) => setUrl(e.currentTarget.value)} spellcheck={false} />
                  <div class="code-flow-row">
                    <input class="code-flow-input" placeholder="branch (optional)" value={branch()} onInput={(e) => setBranch(e.currentTarget.value)} spellcheck={false} />
                    <button class="text-btn primary" type="submit" disabled={!!busy() || !url().trim()}>
                      Read
                    </button>
                  </div>
                </form>
              </div>
            }
          >
            {(c) => (
              <>
                <div class="code-flow-head">
                  <span>
                    <strong>{c().source.name}</strong> · {c().source.files} files · {c().source.functions.length} functions
                  </span>
                  <span class="spacer" />
                  <button
                    class="link-btn"
                    onClick={() => {
                      setCode(null);
                      setError(null);
                    }}
                  >
                    Other code…
                  </button>
                </div>
                <input
                  class="code-flow-input"
                  placeholder="Find a function, class, file or route"
                  value={query()}
                  onInput={(e) => setQuery(e.currentTarget.value)}
                  ref={(el) => requestAnimationFrame(() => el.focus())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && matches().length) {
                      e.preventDefault();
                      if (!matches().some((f) => f.id === picked())) setPicked(matches()[0].id);
                      else void draw();
                    }
                  }}
                />
                <div class="code-flow-list" role="listbox" aria-label="Functions">
                  <For each={matches().slice(0, SHOWN)} fallback={<div class="import-none">No function matches.</div>}>
                    {(f) => (
                      <button
                        class="code-flow-fn"
                        classList={{ on: picked() === f.id }}
                        role="option"
                        aria-selected={picked() === f.id}
                        onClick={() => setPicked(f.id)}
                        onDblClick={() => {
                          setPicked(f.id);
                          void draw();
                        }}
                      >
                        <Show when={f.route}>
                          <span class="code-flow-route">{f.route}</span>
                        </Show>
                        <span class="code-flow-name">{fnName(f)}</span>
                        <small>
                          {f.file}:{f.line} · {f.steps} {f.steps === 1 ? "step" : "steps"}
                        </small>
                      </button>
                    )}
                  </For>
                  <Show when={matches().length > SHOWN}>
                    <div class="import-none">{matches().length - SHOWN} more: search to narrow down.</div>
                  </Show>
                </div>
                <For each={c().source.skipped.slice(0, 3)}>{(s) => <div class="import-note">{s}</div>}</For>
              </>
            )}
          </Show>

          <Show when={error()}>{(e) => <div class="import-note error">{e()}</div>}</Show>

          <div class="sql-dialog-foot">
            <Show when={busy()}>{(b) => <span class="code-flow-busy">{b()}</span>}</Show>
            <span class="spacer" />
            <Show when={code()}>
              <label class="code-flow-depth" title="Calls to other functions in the code are drawn as sections with their own steps">
                Follow calls
                <select value={depth()} onChange={(e) => setDepth(Number(e.currentTarget.value))}>
                  <For each={DEPTHS}>{(d) => <option value={d.value}>{d.label}</option>}</For>
                </select>
              </label>
            </Show>
            <button class="text-btn" onClick={p.onClose}>
              Cancel
            </button>
            <Show when={code()}>
              <button class="text-btn primary" disabled={!picked() || !!busy()} onClick={() => void draw()}>
                Draw
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
