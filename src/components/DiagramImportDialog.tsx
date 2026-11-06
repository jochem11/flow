// Import a diagram made elsewhere: Mermaid text (also ```mermaid blocks in
// Markdown), a draw.io file or an Excalidraw drawing. Paste it, or open / drop a
// file; see what was read (a small preview, and what was left out), then add it
// to this board as one undo step, or make a new board of its type. A Mermaid ER
// diagram becomes a new EER board. Reading happens in Rust (flow-core's import/).

import { createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { api, errMsg } from "../lib/api";
import { boardType, boardTypeOf } from "../lib/boardTypes";
import { focusOn } from "../lib/camera";
import { board, insertDiagram } from "../lib/store";
import { toast } from "../lib/toast";
import type { DiagramImport, FlowNode, ImportFormat } from "../lib/types";
import { createDocument, openDoc } from "../lib/workspace";
import { IconClose } from "./icons";

const FORMAT: Record<ImportFormat, string> = { mermaid: "Mermaid", drawio: "draw.io", excalidraw: "Excalidraw" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What was read, drawn small: blocks as outlines, lines between them */
function Preview(p: { imp: DiagramImport }) {
  const view = createMemo(() => {
    const ns = p.imp.nodes;
    if (!ns.length) return null;
    const x0 = Math.min(...ns.map((n) => n.x));
    const y0 = Math.min(...ns.map((n) => n.y));
    const x1 = Math.max(...ns.map((n) => n.x + n.w));
    const y1 = Math.max(...ns.map((n) => n.y + n.h));
    return { x: x0 - 20, y: y0 - 20, w: x1 - x0 + 40, h: y1 - y0 + 40 };
  });
  const byId = createMemo(() => new Map(p.imp.nodes.map((n) => [n.id, n])));
  const center = (n: FlowNode) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
  return (
    <Show when={view()}>
      {(v) => (
        <svg class="import-diagram-preview" viewBox={`${v().x} ${v().y} ${v().w} ${v().h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <For each={p.imp.nodes}>
            {(n) => {
              const frame = ["section", "lanes", "fragment", "package", "boundary"].includes(n.kind);
              if (n.kind === "lifeline")
                return (
                  <g>
                    <rect x={n.x} y={n.y} width={n.w} height={44} rx={2} />
                    <path d={`M ${n.x + n.w / 2} ${n.y + 44} V ${n.y + n.h}`} class="dashed" />
                  </g>
                );
              if (n.kind === "diamond")
                return <polygon points={`${n.x + n.w / 2},${n.y} ${n.x + n.w},${n.y + n.h / 2} ${n.x + n.w / 2},${n.y + n.h} ${n.x},${n.y + n.h / 2}`} />;
              const round = ["pill", "topic", "usecase"].includes(n.kind) ? Math.min(n.w, n.h) / 2 : ["start", "end", "circle", "flowfinal"].includes(n.kind) ? n.w / 2 : 4;
              return <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={round} classList={{ frame, label: n.kind === "label" }} />;
            }}
          </For>
          <For each={p.imp.edges}>
            {(e) => {
              const a = byId().get(e.from);
              const b = byId().get(e.to);
              // A message: across, at its height
              if (e.messageY != null && a && b) {
                const y = a.y + e.messageY;
                return <path d={`M ${center(a).x} ${y} H ${center(b).x}`} classList={{ dashed: e.pattern === "dashed" }} />;
              }
              const s = a ? center(a) : e.fromPoint;
              const t = b ? center(b) : e.toPoint;
              return s && t ? <path d={`M ${s.x} ${s.y} L ${t.x} ${t.y}`} classList={{ dashed: e.pattern === "dashed" }} /> : null;
            }}
          </For>
        </svg>
      )}
    </Show>
  );
}

export function DiagramImportDialog(p: { onClose: () => void }) {
  const [text, setText] = createSignal("");
  const [fileName, setFileName] = createSignal<string | null>(null);
  // Read while typing, but not on every key
  const [settled, setSettled] = createSignal("");
  let timer: number | undefined;
  const type = (value: string, now = false) => {
    setText(value);
    clearTimeout(timer);
    if (now) setSettled(value);
    else timer = window.setTimeout(() => setSettled(value), 300);
  };
  onCleanup(() => clearTimeout(timer));

  const [result] = createResource(settled, (t) =>
    t.trim() ? api.importDiagram(t).then((r) => ({ ok: r, error: null }), (e) => ({ ok: null, error: errMsg(e) })) : null,
  );
  const imported = () => result()?.ok;
  const blocks = () => imported()?.nodes.length ?? 0;
  const lines = () => imported()?.edges.length ?? 0;
  const tables = () => imported()?.eer?.entities.length ?? 0;
  const canAdd = () => !result.loading && blocks() + lines() > 0;

  /** The board type it is for, and whether this board is that (or a whiteboard, which has everything) */
  const forType = () => {
    const d = imported()?.diagram;
    return d ? boardType(d) : null;
  };
  const here = () => boardTypeOf("flow", board.diagram);
  const mismatch = () => {
    const t = forType();
    return !!t && board.nodes.length > 0 && here().id !== "whiteboard" && t.id !== here().id;
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name.replace(/\.(drawio|excalidraw|mmd|mermaid|md|json|xml|svg)$/gi, "").replace(/\.drawio$/i, ""));
    type(await file.text(), true);
  };
  let fileInput!: HTMLInputElement;

  const summary = () => {
    const r = imported();
    if (!r) return "";
    const parts = [r.format ? FORMAT[r.format] : null, forType()?.label ?? (r.format && r.format !== "mermaid" ? "drawing" : null)].filter(Boolean);
    const what = r.eer ? plural(tables(), "table", "tables") : `${plural(blocks(), "block", "blocks")}, ${plural(lines(), "line", "lines")}`;
    return parts.length ? `${parts.join(" · ")}: ${what}` : what;
  };

  const add = () => {
    const r = imported();
    if (!r) return;
    const area = insertDiagram(r);
    toast(`Added ${plural(blocks(), "block", "blocks")}`);
    p.onClose();
    if (area) requestAnimationFrame(() => focusOn(area));
  };

  /** A new board with it: of its type (an EER board for an ER diagram) */
  const addAsBoard = async () => {
    const r = imported();
    const d = openDoc();
    if (!r || !d) return;
    const name = fileName() ?? (r.eer ? "Imported ER diagram" : `Imported ${forType()?.label.toLowerCase() ?? "diagram"}`);
    p.onClose();
    if (r.eer) {
      const e = r.eer;
      await createDocument(d.projectId, d.folderId, "eer", {
        name,
        content: { kind: "eer", data: { entities: e.entities, relations: e.relations, sections: e.sections, camera: { x: 80, y: 80, zoom: 1 } } },
      });
    } else {
      await createDocument(d.projectId, d.folderId, "flow", {
        name,
        content: { kind: "flow", data: { nodes: r.nodes, edges: r.edges, camera: { x: 80, y: 80, zoom: 1 }, diagram: r.diagram ?? "whiteboard" } },
      });
    }
  };

  return (
    <Portal>
      <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
        <div class="sql-dialog import-dialog panel" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
          <div class="sql-dialog-head">
            <strong>Import a diagram</strong>
            <span class="import-hint">Mermaid (flowchart, sequence, class, state, ER, mind map), draw.io or Excalidraw</span>
            <button class="icon-btn" title="Close" onClick={p.onClose}>
              <IconClose />
            </button>
          </div>
          <textarea
            class="import-sql"
            placeholder={"Paste Mermaid here (flowchart TD …), or open or drop a .drawio, .excalidraw, .mmd or .md file"}
            spellcheck={false}
            value={text()}
            onInput={(e) => {
              setFileName(null);
              type(e.currentTarget.value);
            }}
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
                  <Show when={r().format}>
                    <div class="import-summary">{summary()}</div>
                  </Show>
                  <Preview imp={r()} />
                  <Show when={r().eer}>
                    {(e) => (
                      <div class="import-tables">
                        <For each={e().entities}>
                          {(t) => (
                            <span class="import-table" title={t.attributes.map((a) => a.name).join(", ")}>
                              {t.name}
                              <small>{plural(t.attributes.length, "column", "columns")}</small>
                            </span>
                          )}
                        </For>
                      </div>
                    )}
                  </Show>
                  <Show when={r().eer}>
                    <div class="import-note">An ER diagram becomes an EER board of its own (or import it from an EER board's Import).</div>
                  </Show>
                  <Show when={mismatch()}>
                    <div class="import-note">
                      This is a {forType()!.label.toLowerCase()}; this board is a {here().label.toLowerCase()}, so it keeps a {here().label.toLowerCase()}'s tools. A new board fits it
                      better.
                    </div>
                  </Show>
                  <For each={r().skipped}>{(s) => <div class="import-note">{s}</div>}</For>
                </>
              )}
            </Show>
          </div>
          <div class="sql-dialog-foot">
            <input
              type="file"
              accept=".drawio,.xml,.svg,.excalidraw,.json,.mmd,.mermaid,.md,.txt,text/plain"
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
            <button class="text-btn" classList={{ primary: !!imported()?.eer || mismatch() }} disabled={!(canAdd() || tables() > 0)} onClick={() => void addAsBoard()}>
              <span>{imported()?.eer ? "New EER board" : "New board"}</span>
            </button>
            <Show when={!imported()?.eer}>
              <button class="text-btn" classList={{ primary: !mismatch() }} disabled={!canAdd()} onClick={add}>
                <span>Add to this board</span>
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Portal>
  );
}
