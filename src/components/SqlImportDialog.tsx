// Import SQL or DBML into the open EER diagram: paste a script (or open / drop a
// .sql or .dbml file), see which tables it has, and add them as one undo step.
// Reading it happens in Rust (flow-core's sql_import.rs and dbml.rs).

import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { api, errMsg } from "../lib/api";
import { eer, ENTITY_W, entityHeight, insertImport, setEerCamera } from "../lib/eer";
import { toast } from "../lib/toast";
import type { Entity } from "../lib/types";
import { IconClose } from "./icons";

/** Brings the new tables into view, zoomed out if they do not fit. */
function showTables(tables: Entity[]) {
  const view = document.querySelector(".eer-viewport")?.getBoundingClientRect();
  if (!view || !tables.length) return;
  const x0 = Math.min(...tables.map((e) => e.x));
  const y0 = Math.min(...tables.map((e) => e.y));
  const x1 = Math.max(...tables.map((e) => e.x + ENTITY_W));
  const y1 = Math.max(...tables.map((e) => e.y + entityHeight(e)));
  const zoom = Math.max(0.3, Math.min(1, view.width / (x1 - x0 + 120), view.height / (y1 - y0 + 120)));
  setEerCamera({ zoom, x: view.width / 2 - ((x0 + x1) / 2) * zoom, y: view.height / 2 - ((y0 + y1) / 2) * zoom });
}

/** DBML (`Table x {`, `Ref:`) rather than SQL (no CREATE TABLE) */
const isDbml = (s: string) => /^\s*(Table|Ref|TableGroup|Enum)\b/im.test(s) && !/\bCREATE\s+TABLE\b/i.test(s);

export function SqlImportDialog(p: { onClose: () => void }) {
  const [sql, setSql] = createSignal("");
  // Read while typing, but not on every key
  const [settled, setSettled] = createSignal("");
  let timer: number | undefined;
  const type = (value: string, now = false) => {
    setSql(value);
    clearTimeout(timer);
    if (now) setSettled(value);
    else timer = window.setTimeout(() => setSettled(value), 250);
  };
  onCleanup(() => clearTimeout(timer));

  const [result] = createResource(settled, (s) =>
    s.trim()
      ? (isDbml(s) ? api.importDbml(s) : api.importSql(s)).then((r) => ({ ok: r, error: null }), (e) => ({ ok: null, error: errMsg(e) }))
      : null,
  );
  const imported = () => result()?.ok;
  const names = () => new Set(eer.entities.map((e) => e.name.toLowerCase()));
  const isThere = (e: Entity) => names().has(e.name.toLowerCase());
  const fresh = () => imported()?.entities.filter((e) => !isThere(e)) ?? [];

  const open = async (file: File | undefined) => {
    if (file) type(await file.text(), true);
  };
  let fileInput!: HTMLInputElement;

  const add = () => {
    const r = imported();
    if (!r) return;
    const { added, existing } = insertImport(r);
    const also = existing.length ? `; ${existing.length} already there` : "";
    toast(`Added ${added.length} ${added.length === 1 ? "table" : "tables"}${also}`);
    p.onClose();
    requestAnimationFrame(() => showTables(added));
  };

  return (
    <Portal>
      <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && p.onClose()}>
        <div class="sql-dialog import-dialog panel" onKeyDown={(e) => e.key === "Escape" && p.onClose()}>
          <div class="sql-dialog-head">
            <strong>Import {isDbml(sql()) ? "DBML" : "SQL"}</strong>
            <span class="import-hint">
              SQL from PostgreSQL, MySQL, SQLite, SQL Server or Oracle, or DBML (dbdiagram.io): table groups become sections
            </span>
            <button class="icon-btn" title="Close" onClick={p.onClose}>
              <IconClose />
            </button>
          </div>
          <textarea
            class="import-sql"
            placeholder="Paste SQL or DBML here, or drop a .sql or .dbml file"
            spellcheck={false}
            value={sql()}
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
                    <For each={r().entities} fallback={<span class="import-none">No tables found</span>}>
                      {(e) => (
                        <span
                          class="import-table"
                          classList={{ there: isThere(e) }}
                          title={isThere(e) ? "A table with this name is already in the diagram; it is not added again" : e.attributes.map((a) => a.name).join(", ")}
                        >
                          {e.name}
                          <small>{isThere(e) ? "already there" : `${e.attributes.length} columns`}</small>
                        </span>
                      )}
                    </For>
                  </div>
                  <For each={r().skipped}>{(s) => <div class="import-note">{s}</div>}</For>
                </>
              )}
            </Show>
          </div>
          <div class="sql-dialog-foot">
            <input type="file" accept=".sql,.dbml,.txt,text/plain" hidden ref={fileInput} onChange={(e) => void open(e.currentTarget.files?.[0])} />
            <button class="text-btn" onClick={() => fileInput.click()}>
              Open .sql file…
            </button>
            <span class="spacer" />
            <button class="text-btn" onClick={p.onClose}>
              Cancel
            </button>
            <button class="text-btn primary" disabled={!fresh().length || result.loading} onClick={add}>
              <span>
                Add {fresh().length || ""} {fresh().length === 1 ? "table" : "tables"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
