// Starting a board from a template, the version history of a board, saving a
// board as a template, and the board menu (top right) that opens them.

import { createResource, createSignal, For, Show } from "solid-js";
import { canEdit } from "../lib/access";
import { errMsg } from "../lib/api";
import { me } from "../lib/auth";
import { listVersions, restoreVersion, saveVersion, when } from "../lib/history";
import { startPresenting } from "../lib/present";
import { del, get, post } from "../lib/server";
import { toast } from "../lib/toast";
import type { DocContent, Template, TemplateMeta } from "../lib/types";
import { changeBoardType, createDocument, leavePreview, openDoc, preview, runAutoLayout, saveNow, viewVersion } from "../lib/workspace";
import { roleCanEdit } from "../lib/roles";
import { whenLive } from "../lib/collab";
import { barFold, setDiagramImport, setSqlImport } from "../lib/topActions";
import { openThreads, panelOpen, setPanelOpen } from "../lib/comments";
import { checkCount, setChecksOpen } from "./DesignChecks";
import { setAccessOpen } from "./ShareDialog";
import { board, setLook } from "../lib/store";
import { BOARD_TYPES, boardTypeOf, PICKER_GROUPS, type BoardType } from "../lib/boardTypes";
import { BUILT_IN } from "../templates";
import { ConfirmButton } from "./ConfirmButton";
import { Dialog } from "./Dialog";
import { IconMore, IconTrash } from "./icons";
import { TypeIcon } from "./kinds";
import { Menu } from "./Menu";

// ---------- new board: its type, then blank or from a template ----------

/** A new board: first its type, then what it starts with; then it is made. */
export function NewBoardDialog(p: { projectId: string; folderId: string | null; type?: BoardType; onClose: (id: string | null) => void }) {
  const [type, setType] = createSignal<BoardType | null>(p.type ?? null);
  return (
    <Show
      when={type()}
      fallback={
        <Dialog title="New board" onClose={() => p.onClose(null)}>
          <For each={PICKER_GROUPS}>
            {(group) => (
              <>
                <div class="share-section-title">{group.title}</div>
                <div class="template-grid">
                  <For each={group.types}>
                    {(t) => (
                      <button class="template-card" onClick={() => setType(t)}>
                        <TypeIcon type={t.id} />
                        <strong>{t.label}</strong>
                        <small>{t.description}</small>
                      </button>
                    )}
                  </For>
                </div>
              </>
            )}
          </For>
        </Dialog>
      }
    >
      {(t) => <TemplatePicker projectId={p.projectId} folderId={p.folderId} type={t()} onBack={p.type ? undefined : () => setType(null)} onClose={p.onClose} />}
    </Show>
  );
}

/** A flow board's content gets its type (a template may be for another type, or none). */
function withType(content: DocContent, type: BoardType): DocContent {
  return content.kind === "flow" && type.diagram ? { kind: "flow", data: { ...content.data, diagram: type.diagram } } : content;
}

/** Choosing what a new board of a type starts with; then it is made. */
export function TemplatePicker(p: { projectId: string; folderId: string | null; type: BoardType; onBack?: () => void; onClose: (id: string | null) => void }) {
  const kind = () => p.type.kind;
  const [mine, { refetch }] = createResource(async () => (me() ? (await get<TemplateMeta[]>("/templates")).filter((t) => t.kind === kind()) : []));
  // A flow template belongs to one type (none: a whiteboard)
  const builtIn = () => BUILT_IN.filter((t) => t.kind === kind() && (kind() !== "flow" || (t.diagram ?? "whiteboard") === p.type.id));
  const [busy, setBusy] = createSignal(false);
  const make = async (start?: { name: string; content: DocContent }) => {
    if (busy()) return;
    setBusy(true);
    const blank: DocContent | undefined = p.type.diagram
      ? { kind: "flow", data: { nodes: [], edges: [], camera: { x: 0, y: 0, zoom: 1 }, diagram: p.type.diagram } }
      : undefined;
    const content = start ? withType(start.content, p.type) : blank;
    const id = await createDocument(p.projectId, p.folderId, kind(), content && { name: start?.name ?? p.type.newName, content });
    setBusy(false);
    p.onClose(id);
  };
  const fromMine = async (t: TemplateMeta) => {
    try {
      const full = await get<Template>(`/templates/${t.id}`);
      await make({ name: t.name, content: full.content });
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Dialog title={`New ${p.type.label.toLowerCase()}`} onClose={() => p.onClose(null)}>
      <Show when={p.onBack}>
        <button class="text-btn back-btn" onClick={() => p.onBack?.()}>
          ← Other board types
        </button>
      </Show>
      <div class="template-grid">
        <button class="template-card blank" autofocus onClick={() => make()} disabled={busy()}>
          <TypeIcon type={p.type.id} />
          <strong>Blank</strong>
          <small>Start from nothing</small>
        </button>
        <For each={builtIn()}>
          {(t) => (
            <button class="template-card" onClick={() => make({ name: t.name, content: t.make() })} disabled={busy()}>
              <TypeIcon type={p.type.id} />
              <strong>{t.name}</strong>
              <small>{t.description}</small>
            </button>
          )}
        </For>
      </div>
      <Show when={mine()?.length}>
        <div class="share-section-title">Your templates</div>
        <div class="template-grid">
          <For each={mine()}>
            {(t) => (
              <div class="template-card mine">
                <button class="template-card-main" onClick={() => fromMine(t)} disabled={busy()}>
                  <TypeIcon type={p.type.id} />
                  <strong>{t.name}</strong>
                  <small>Saved {when(t.createdAt)}</small>
                </button>
                <ConfirmButton
                  class="icon-btn small danger template-delete"
                  title="Delete this template"
                  onConfirm={async () => {
                    await del(`/templates/${t.id}`);
                    refetch();
                  }}
                >
                  <IconTrash />
                </ConfirmButton>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Dialog>
  );
}

// ---------- save as template ----------

function SaveTemplateDialog(p: { onClose: () => void }) {
  const [name, setName] = createSignal(openDoc()?.name ?? "");
  const save = async (e: Event) => {
    e.preventDefault();
    const doc = openDoc();
    if (!doc || !name().trim()) return;
    try {
      await saveNow();
      await post("/templates", { name: name().trim(), documentId: doc.id });
      toast(`Saved as template “${name().trim()}”. New boards can start from it.`);
      p.onClose();
    } catch (err) {
      toast(errMsg(err), "error");
    }
  };
  return (
    <Dialog title="Save as template" onClose={p.onClose}>
      <form class="share-invite" onSubmit={save}>
        <input class="share-input" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Template name" autofocus />
        <button class="text-btn primary" type="submit" disabled={!name().trim()}>
          Save
        </button>
      </form>
      <p class="share-note">Only you see your templates. The board stays as it is; new boards start from a copy of it as it is now.</p>
    </Dialog>
  );
}

// ---------- version history ----------

/**
 * Over the board while an old version is shown (read-only): which version, what
 * changed since, and the way back (or restoring it). Its parts can be copied.
 */
export function VersionBanner() {
  const [busy, setBusy] = createSignal(false);
  const restore = async () => {
    const v = preview();
    const d = openDoc();
    if (!v || !d || !confirm("Restore this version? The board as it is now is kept as a version too.")) return;
    setBusy(true);
    try {
      await leavePreview();
      // Live again first: else the board's live state, which has not got it yet, could win
      await whenLive();
      await restoreVersion(d.id, v.id);
      toast("Restored. Undo (Ctrl+Z) or restore “Before restore” to go back.");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Show when={preview()}>
      {(v) => (
        <div class="verify-banner version-banner" role="status">
          <span>
            <strong>{v().name ?? "Saved automatically"}</strong>, {when(v().createdAt)}: read-only. Since then:{" "}
            {v().diff.summary || "nothing changed"}.
            <Show when={v().diff.marks.size}>
              {" "}
              <span class="version-key gone">gone now</span> <span class="version-key changed">changed since</span>
            </Show>
          </span>
          <Show when={roleCanEdit(v().role)}>
            <button class="text-btn" disabled={busy()} onClick={restore}>
              Restore this version
            </button>
          </Show>
          <button class="text-btn primary" disabled={busy()} onClick={() => void leavePreview()}>
            Back to now
          </button>
        </div>
      )}
    </Show>
  );
}

function HistoryDialog(p: { docId: string; onClose: () => void }) {
  const [versions, { refetch }] = createResource(() => listVersions(p.docId));
  const [name, setName] = createSignal("");
  const [busy, setBusy] = createSignal<string | null>(null);
  const keep = async (e: Event) => {
    e.preventDefault();
    if (!name().trim()) return;
    try {
      await saveNow();
      await saveVersion(p.docId, name().trim());
      setName("");
      refetch();
    } catch (err) {
      toast(errMsg(err), "error");
    }
  };
  const restore = async (id: string) => {
    setBusy(id);
    try {
      await restoreVersion(p.docId, id);
      toast("Restored. Undo (Ctrl+Z) or restore “Before restore” to go back.");
      p.onClose();
    } catch (err) {
      toast(errMsg(err), "error");
      setBusy(null);
    }
  };
  return (
    <Dialog title="Version history" onClose={p.onClose}>
      <form class="share-invite" onSubmit={keep}>
        <input class="share-input" value={name()} onInput={(e) => setName(e.currentTarget.value)} placeholder="Name this version, e.g. Before the review" />
        <button class="text-btn primary" type="submit" disabled={!name().trim()}>
          Save version
        </button>
      </form>
      <p class="share-note">A version is also kept by itself every half hour while the board changes.</p>
      <div class="version-list">
        <Show when={!versions.loading} fallback={<div class="share-note">Loading…</div>}>
          <For each={versions()} fallback={<div class="share-note">No versions yet: they appear as the board changes.</div>}>
            {(v) => (
              <div class="version-row">
                <div class="version-info">
                  <strong classList={{ auto: !v.name }}>{v.name ?? "Saved automatically"}</strong>
                  <small>
                    {when(v.createdAt)}
                    <Show when={v.createdBy}> · {v.createdBy}</Show>
                  </small>
                </div>
                <button
                  class="text-btn"
                  title="See this version (read-only), with what changed since marked"
                  onClick={() => {
                    p.onClose();
                    void viewVersion(v).catch((e) => toast(errMsg(e), "error"));
                  }}
                >
                  View
                </button>
                <ConfirmButton class="text-btn" confirmLabel="Restore this?" onConfirm={() => restore(v.id)}>
                  {busy() === v.id ? "Restoring…" : "Restore"}
                </ConfirmButton>
              </div>
            )}
          </For>
        </Show>
      </div>
    </Dialog>
  );
}

// ---------- the board menu ----------

/** The "…" menu of the open board: version history, save as template, present. */
export function BoardMenu() {
  const [dialog, setDialog] = createSignal<"history" | "template" | null>(null);
  const doc = () => openDoc();
  const canPresent = () => doc()?.kind === "flow" || doc()?.kind === "eer";
  return (
    <Show when={doc()?.role}>
      <Menu
        align="right"
        button={(toggle, open) => (
          <button class="icon-btn" classList={{ pressed: open() }} title="More" onClick={toggle}>
            <IconMore />
          </button>
        )}
      >
        {(close) => (
          <>
            {/* What the top bar has no room for (see TopBar's fold) */}
            <Show when={barFold() >= 6 && me()}>
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  setAccessOpen(true);
                }}
              >
                Access: who can do what…
              </button>
            </Show>
            <Show when={barFold() >= 4}>
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  setPanelOpen(!panelOpen());
                }}
              >
                <span>Comments</span>
                <Show when={openThreads().length}>
                  <small>{openThreads().length} open</small>
                </Show>
              </button>
            </Show>
            <Show when={barFold() >= 3 && canEdit()}>
              <Show when={doc()?.kind === "flow"}>
                <Show when={checkCount()}>
                  <button
                    class="menu-item"
                    onClick={() => {
                      close();
                      setChecksOpen(true);
                    }}
                  >
                    <span>Checks</span>
                    <small>{checkCount()}</small>
                  </button>
                </Show>
                <button
                  class="menu-item"
                  onClick={() => {
                    close();
                    void runAutoLayout();
                  }}
                >
                  Arrange automatically
                </button>
                <button
                  class="menu-item"
                  onClick={() => {
                    close();
                    setDiagramImport(true);
                  }}
                >
                  <span>Import a diagram…</span>
                  <small>Mermaid, draw.io, Excalidraw</small>
                </button>
              </Show>
              <Show when={doc()?.kind === "eer"}>
                <button
                  class="menu-item"
                  onClick={() => {
                    close();
                    setSqlImport(true);
                  }}
                >
                  <span>Import SQL / DBML…</span>
                </button>
              </Show>
              <div class="menu-sep" />
            </Show>
            <Show when={canPresent()}>
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  startPresenting();
                }}
              >
                Present
              </button>
            </Show>
            <Show when={canEdit()}>
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  setDialog("history");
                }}
              >
                Version history…
              </button>
            </Show>
            <Show when={me()}>
              <button
                class="menu-item"
                onClick={() => {
                  close();
                  setDialog("template");
                }}
              >
                Save as template…
              </button>
            </Show>
            {/* How a flow board is drawn: clean, or as a sketch */}
            <Show when={doc()?.kind === "flow" && canEdit()}>
              <div class="menu-sep" />
              <div class="menu-title">Look</div>
              <For each={[{ id: "clean", label: "Clean", hint: "Final" }, { id: "sketch", label: "Sketch", hint: "Hand-drawn, for ideas" }] as const}>
                {(l) => (
                  <button
                    class="menu-item"
                    classList={{ checked: (board.look ?? "clean") === l.id }}
                    onClick={() => {
                      close();
                      setLook(l.id);
                    }}
                  >
                    <span>{l.label}</span>
                    <small>{(board.look ?? "clean") === l.id ? "current" : l.hint}</small>
                  </button>
                )}
              </For>
            </Show>
            {/* A flow board's type: what it offers (its blocks stay) */}
            <Show when={doc()?.kind === "flow" && canEdit()}>
              <div class="menu-sep" />
              <div class="menu-title">Board type</div>
              <For each={BOARD_TYPES.filter((t) => t.kind === "flow")}>
                {(t) => (
                  <button
                    class="menu-item"
                    classList={{ checked: boardTypeOf("flow", board.diagram).id === t.id }}
                    onClick={() => {
                      close();
                      void changeBoardType(t.diagram!);
                    }}
                  >
                    <span class="with-icon">
                      <TypeIcon type={t.id} /> {t.label}
                    </span>
                    <Show when={boardTypeOf("flow", board.diagram).id === t.id}>
                      <small>current</small>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </>
        )}
      </Menu>
      <Show when={dialog() === "history" && doc()}>{(d) => <HistoryDialog docId={d().id} onClose={() => setDialog(null)} />}</Show>
      <Show when={dialog() === "template"}>
        <SaveTemplateDialog onClose={() => setDialog(null)} />
      </Show>
    </Show>
  );
}
