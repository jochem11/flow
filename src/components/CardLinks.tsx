// "Linked to" in the card dialog: the files this card is about, and sections or tables in them.

import { createSignal, For, Show } from "solid-js";
import { updateCard } from "../lib/kanban";
import type { CardLink, KanbanCard } from "../lib/types";
import { IconClose } from "./icons";
import { docParts, linkableDocs, openLinkedNode, withDocLinks } from "../lib/links";
import { KindIcon } from "./kinds";

/**
 * What this card is about, per file: a document of the project, and within it any
 * number of groups (flowchart) or tables (EER). Picking a file links it right
 * away; then sections can be added, as many as needed.
 */
export function Links(p: { card: KanbanCard }) {
  /** Picking a file to link */
  const [pickingDoc, setPickingDoc] = createSignal(false);
  /** The file whose sections are being picked */
  const [pickFor, setPickFor] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const links = () => withDocLinks(p.card.links ?? []);
  const docMeta = (id: string) => linkableDocs().find((d) => d.id === id);
  const hasParts = (docId: string) => ["flow", "eer"].includes(docMeta(docId)?.kind ?? "");
  const partWord = (docId: string) => (docMeta(docId)?.kind === "eer" ? "table" : "section");

  /** The linked files, in the order they were linked */
  const files = () => [...new Set(links().map((l) => l.docId))];
  const partsOf = (docId: string) => links().filter((l) => l.docId === docId && l.nodeId).map((l) => l.nodeId!);
  const save = (next: CardLink[]) => updateCard(p.card.id, { links: withDocLinks(next) });

  const linkFile = (docId: string) => {
    save([...links(), { docId }]);
    setPickingDoc(false);
    // Straight on to its sections, when it has any
    setPickFor(hasParts(docId) ? docId : null);
    setQuery("");
  };
  const toggleSection = (docId: string, nodeId: string) =>
    partsOf(docId).includes(nodeId)
      ? save(links().filter((l) => !(l.docId === docId && l.nodeId === nodeId)))
      : save([...links(), { docId, nodeId }]);
  const unlinkFile = (docId: string) => {
    save(links().filter((l) => l.docId !== docId));
    if (pickFor() === docId) setPickFor(null);
  };

  const choices = (docId: string) => {
    const q = query().trim().toLowerCase();
    return (docParts(docId) ?? [])
      .filter((part) => part.pickable && (!q || part.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  };
  const unlinkedDocs = () => linkableDocs().filter((d) => !files().includes(d.id));

  return (
    <div class="kd-field">
      <div class="kd-label">
        Linked to
        <Show when={unlinkedDocs().length}>
          <button class="kd-link kd-label-action" onClick={() => setPickingDoc(!pickingDoc())}>
            {pickingDoc() ? "Cancel" : "Add file"}
          </button>
        </Show>
      </div>

      <Show when={pickingDoc()}>
        <div class="link-picker-list link-file-list">
          <For each={unlinkedDocs()}>
            {(d) => (
              <button class="link-picker-item" onClick={() => linkFile(d.id)}>
                <span class="with-icon">
                  <KindIcon kind={d.kind} />
                  {d.name}
                </span>
                <small>{d.kind}</small>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="link-chips">
        <For each={files()} fallback={<span class="kd-empty">Nothing yet</span>}>
          {(docId) => {
            const doc = () => docMeta(docId);
            const parts = () => partsOf(docId);
            return (
              <div class="link-group">
                <span class="link-chip" classList={{ missing: !doc() }}>
                  <button
                    class="link-chip-open"
                    disabled={!doc()}
                    title={doc() ? "Open the file" : "This file was deleted"}
                    onClick={() => openLinkedNode(docId)}
                  >
                    <KindIcon kind={doc()?.kind ?? "text"} />
                    <span>{doc()?.name ?? "Deleted file"}</span>
                  </button>
                  <button class="link-chip-remove" title="Unlink the file (and its sections)" onClick={() => unlinkFile(docId)}>
                    <IconClose />
                  </button>
                </span>

                <For each={parts()}>
                  {(nodeId) => {
                    const part = () => docParts(docId)?.find((x) => x.id === nodeId);
                    const missing = () => docParts(docId) !== undefined && !part();
                    return (
                      <span class="link-chip link-part" classList={{ missing: missing() }}>
                        <button
                          class="link-chip-open"
                          disabled={missing()}
                          title={missing() ? "This was deleted" : "Open the file at this " + partWord(docId)}
                          onClick={() => openLinkedNode(docId, nodeId)}
                        >
                          <span>{part()?.name ?? (missing() ? `Removed ${partWord(docId)}` : "…")}</span>
                        </button>
                        <button
                          class="link-chip-remove"
                          title={`Unlink this ${partWord(docId)}`}
                          onClick={() => toggleSection(docId, nodeId)}
                        >
                          <IconClose />
                        </button>
                      </span>
                    );
                  }}
                </For>

                <Show when={hasParts(docId) && doc()}>
                  <Show
                    when={pickFor() === docId}
                    fallback={
                      <button class="kd-link link-add-part" onClick={() => (setPickFor(docId), setQuery(""))}>
                        + {partWord(docId)}
                      </button>
                    }
                  >
                    {/* Stays open: click as many as needed */}
                    <div class="link-picker">
                      <input
                        class="kd-input"
                        placeholder={`Search ${partWord(docId)}s…`}
                        value={query()}
                        onInput={(e) => setQuery(e.currentTarget.value)}
                        ref={(el) => requestAnimationFrame(() => el.focus())}
                      />
                      <div class="link-picker-list">
                        <Show when={docParts(docId)} fallback={<span class="kd-empty">Loading…</span>}>
                          <For
                            each={choices(docId)}
                            fallback={<span class="kd-empty">No {partWord(docId)}s in this file</span>}
                          >
                            {(part) => (
                              <button
                                class="link-picker-item"
                                classList={{ picked: parts().includes(part.id) }}
                                onClick={() => toggleSection(docId, part.id)}
                              >
                                <span class="with-icon">
                                  <span class="link-check">{parts().includes(part.id) ? "✓" : ""}</span>
                                  {part.name}
                                </span>
                                <small>{part.kind}</small>
                              </button>
                            )}
                          </For>
                        </Show>
                      </div>
                      <button class="text-btn link-done" onClick={() => setPickFor(null)}>
                        Done
                      </button>
                    </div>
                  </Show>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
