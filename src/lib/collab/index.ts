// Editing together: while a board from the server is open, its content also
// lives in a shared Yjs document, synced through the server's room for that
// board (server/src/collab.rs) with the y-websocket protocol.
//
// The editors keep working on their own stores (store/, eer.ts, kanban.ts).
// A binding per kind mirrors them:
//   - a change of ours (the store's revision goes up) is written into the shared
//     document, field by field (ylist.ts), in one transaction with origin LOCAL;
//   - a change from someone else (any other origin) is read back into the store
//     without counting as ours (no undo step, no autosave).
// Undo then only undoes our own changes (Y.UndoManager, tracking LOCAL).
// Text documents bind Tiptap to the shared document directly (RichTextEditor).
//
// A board without shared state yet is filled from its saved JSON by the one
// client the server asks (message 100). New comments are announced (101).
// Changes made before the board was live (opened offline, or while connecting)
// are merged into the shared state when it arrives, not overwritten (merge.ts).

import { roleCanEdit } from "../roles";
import { batch, createEffect, createRoot, createSignal, on, onCleanup } from "solid-js";
import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { me } from "../auth";
import { loadComments, guest } from "../comments";
import { applyRemoteEer, eer, eerHistoryChanged, eerRev, useSharedEerUndo } from "../eer";
import { applyRemoteKanban, kanban, kanbanRev } from "../kanban";
import { applyRemoteChart, chartRev, chartSnapshot } from "../chart/store";
import { currentShareToken, inTauri, serverUrl, sessionToken } from "../server";
import { applyRemoteFlow, board, type FlowSettings, historyChanged, rev, touch, useSharedUndo, type SharedUndo } from "../store";
import type { DocContent, Document, EerSection, Entity, FlowEdge, FlowNode, KanbanCard, KanbanColumn, KanbanLabel, Relation } from "../types";
import { checkOpenAccess, docsOf, markDirty, openDoc, type OpenDoc } from "../workspace";
import { api } from "../api";
import { unsavedBase } from "../offline";
import { mergeSnap, sameSnap, type Snap } from "./merge";
import { isEmptyIn, isLive, type LiveKind, readSnap, sharedTypes, snapOf, writeSnap } from "./snap";

/** The origin of our own changes in the shared document */
export const LOCAL = Symbol("local");

export type Status = "off" | "connecting" | "live" | "offline";
const [status, setStatus] = createSignal<Status>("off");
export { status };

/** Someone else on the board (from awareness) */
export interface Peer {
  clientId: number;
  name: string;
  color: string;
  /** Where their pointer is, in world coordinates of the canvas */
  cursor?: { x: number; y: number } | null;
  selection?: string[];
  /** What they see of the canvas (world coordinates), for following them */
  view?: { x: number; y: number; w: number; h: number } | null;
}
const [peers, setPeers] = createSignal<Peer[]>([]);
export { peers };

/** The open text document's shared document, for Tiptap (null when not editing together) */
const [textDoc, setTextDoc] = createSignal<{ doc: Y.Doc; provider: WebsocketProvider; seed: () => boolean } | null>(null);
export { textDoc };

const COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f"];
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % COLORS.length];
}

function wsBase() {
  const http = inTauri ? serverUrl() : `${location.protocol}//${location.host}`;
  return `${http.replace(/^http/, "ws")}/api/ws/documents`;
}

let provider: WebsocketProvider | null = null;

/** Our pointer on the canvas and our selection, for others to see. */
export function sharePresence(fields: Partial<Pick<Peer, "cursor" | "selection" | "view">>) {
  if (!provider) return;
  for (const [k, v] of Object.entries(fields)) provider.awareness.setLocalStateField(k, v);
}

/**
 * How the open board's store is kept in the shared document (snap.ts says how
 * each kind is stored there). A kanban board keeps its cards as one list, each
 * with its column (a card moved by two people at once ends up in one column);
 * a chart keeps its whole table as one value (the last change of two at the same
 * moment wins: a chart's table is small).
 */
interface Binding {
  kind: LiveKind;
  /** Our store, as kept in the shared document */
  ours(): Snap;
  /** As kept in the shared document → our store, as a change from someone else */
  apply(s: Snap): void;
}

function bindingFor(kind: string): Binding | null {
  switch (kind) {
    case "flow":
      return {
        kind,
        ours: () => snapOf({ kind: "flow", data: board as never })!,
        // A setting the shared document does not have yet stays as loaded
        apply: (s) => applyRemoteFlow(s.lists.nodes as unknown as FlowNode[], s.lists.edges as unknown as FlowEdge[], s.values as FlowSettings),
      };
    case "eer":
      return {
        kind,
        ours: () => snapOf({ kind: "eer", data: eer as never })!,
        apply: (s) => applyRemoteEer(s.lists.entities as unknown as Entity[], s.lists.relations as unknown as Relation[], s.lists.sections as unknown as EerSection[]),
      };
    case "kanban":
      return {
        kind,
        ours: () => snapOf({ kind: "kanban", data: kanban as never })!,
        apply: (s) => {
          const cols = (s.lists.columns as unknown as KanbanColumn[]).map((c) => ({ ...c, cards: [] as KanbanCard[] }));
          const byId = new Map(cols.map((c) => [c.id, c]));
          for (const card of s.lists.cards as unknown as (KanbanCard & { _column?: string })[]) {
            const { _column, ...rest } = card;
            // A card whose column someone deleted meanwhile goes to the first column
            (byId.get(_column ?? "") ?? cols[0])?.cards.push(rest);
          }
          applyRemoteKanban({ columns: cols, labels: s.lists.labels as unknown as KanbanLabel[] });
        },
      };
    case "chart":
      return {
        kind,
        ours: () => snapOf({ kind: "chart", data: chartSnapshot() })!,
        apply: (s) => {
          if (typeof s.values.doc === "string") applyRemoteChart(JSON.parse(s.values.doc));
        },
      };
    default:
      return null;
  }
}

/** Who we are, for a room: the desktop app's session token, the share link */
function roomParams(): Record<string, string> {
  const params: Record<string, string> = {};
  const share = currentShareToken();
  if (share) params.share = share;
  const token = sessionToken();
  if (token) params.token = token;
  return params;
}

/**
 * Changes a board that is not open here (a timer stopped from the sidebar, a
 * card linked from a document): loaded, changed and saved. When people are on
 * it, the change also goes into its room, merged with theirs: else their live
 * state, which does not have it, would win. `change` returns false for nothing
 * to change.
 */
export async function changeClosedBoard(projectId: string, docId: string, change: (content: DocContent) => boolean | void): Promise<void> {
  const doc = await api.loadDocument(projectId, docId);
  const before = snapOf(doc.content);
  if (change(doc.content) === false) return;
  await api.saveDocument(doc);
  // Only boards on the server have rooms (not the desktop app's own files)
  const onServer = !!docsOf(projectId).find((d) => d.id === docId)?.role;
  if (before && onServer && isLive(doc.content.kind)) await intoRoom(docId, doc.content.kind, before, snapOf(doc.content)!);
}

/**
 * A board changed here without a connection, sent now: saved, and (with the
 * version its changes were made on) put into its room when people are in it.
 */
export async function saveKept(doc: Document, base: Document | undefined) {
  await api.saveDocument(doc);
  const before = base && snapOf(base.content);
  const after = snapOf(doc.content);
  if (before && after && isLive(doc.content.kind)) await intoRoom(doc.id, doc.content.kind, before, after);
}

/** Puts a change (from `before` to `after`) into a board's room, if anyone is in it. */
async function intoRoom(id: string, kind: LiveKind, before: Snap, after: Snap) {
  const doc = new Y.Doc();
  const p = new WebsocketProvider(wsBase(), id, doc, { params: roomParams(), disableBc: true, maxBackoffTime: 5000 });
  // Asked to fill an empty board: not us (the saved JSON has the change); comments: not ours
  p.messageHandlers[100] = () => {};
  p.messageHandlers[101] = (_encoder: unknown, decoder: decoding.Decoder) => void decoding.readVarUint8Array(decoder);
  try {
    const synced = await new Promise<boolean>((resolve) => {
      const late = setTimeout(() => resolve(false), 5000);
      p.on("sync", (ok: boolean) => {
        if (!ok) return;
        clearTimeout(late);
        resolve(true);
      });
    });
    // Nobody's live state there: the next one to open it starts from the saved JSON
    if (!synced || isEmptyIn(doc, kind)) return;
    const theirs = readSnap(doc, kind);
    const merged = mergeSnap(before, after, theirs);
    if (sameSnap(merged, theirs)) return;
    doc.transact(() => writeSnap(doc, kind, merged), LOCAL);
    // Sent before the connection closes
    for (let i = 0; i < 20 && (p.ws?.bufferedAmount ?? 0) > 0; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    p.destroy();
    doc.destroy();
  }
}

/** Connects the open board to its room; returns how to disconnect. */
function connect(open: OpenDoc): () => void {
  const doc = new Y.Doc();
  provider = new WebsocketProvider(wsBase(), open.id, doc, { params: roomParams(), disableBc: true, maxBackoffTime: 5000 });
  const p = provider;
  setStatus("connecting");

  const binding = bindingFor(open.kind);
  const isEmpty = () => !binding || isEmptyIn(doc, binding.kind);
  const shared = () => readSnap(doc, binding!.kind);
  const write = () => binding && doc.transact(() => writeSnap(doc, binding.kind, binding.ours()), LOCAL);
  let synced = false;
  let mayFill = false;
  // The board as loaded, and whether we changed it before it was live. Opened
  // as changed here without a connection: those changes count, on the version
  // they were made on (else the shared state, without them, would win)
  let base = binding?.ours();
  let changedBeforeLive = false;
  const baseReady = unsavedBase(open.id)
    .then((was) => {
      const snap = was && snapOf(was.content);
      if (!snap || synced) return;
      base = snap;
      changedBeforeLive = true;
    })
    .catch(() => {});
  const read = () => binding?.apply(shared());
  // The shared state into our store; with changes of ours from before, merged with them
  const catchUp = () => {
    if (!binding) return;
    if (!changedBeforeLive || !base) return read();
    changedBeforeLive = false;
    const theirs = shared();
    const merged = mergeSnap(base, binding.ours(), theirs);
    binding.apply(merged);
    if (roleCanEdit(open.role) && !sameSnap(merged, theirs)) {
      write();
      markDirty();
    }
  };

  // The server asks us to fill the empty board (we are the first editor here)
  p.messageHandlers[100] = () => {
    mayFill = true;
    if (synced) fill();
  };
  // Comments changed: load them again
  p.messageHandlers[101] = (_encoder: unknown, decoder: decoding.Decoder) => {
    decoding.readVarUint8Array(decoder);
    void loadComments();
  };

  const fill = () => {
    if (!binding || !isEmpty() || !mayFill) return;
    write();
    changedBeforeLive = false;
  };

  p.on("status", ({ status: s }: { status: string }) => setStatus(s === "connected" ? (synced ? "live" : "connecting") : s === "connecting" ? "connecting" : "offline"));
  // The server cut the connection (access changed, the board was deleted): check now
  let checking: ReturnType<typeof setTimeout> | undefined;
  p.on("connection-close", () => {
    clearTimeout(checking);
    checking = setTimeout(() => void checkOpenAccess(), 200);
  });
  p.on("sync", (isSynced: boolean) => {
    if (!isSynced) return;
    void baseReady.then(() => {
      if (synced) return catchUp();
      synced = true;
      setStatus("live");
      // The shared state counts (it may be newer than the JSON we loaded); an empty one we fill
      if (isEmpty()) return fill();
      catchUp();
    });
  });

  // Theirs (and undo/redo) into our store; undo/redo are our changes, so they are saved
  let undo: Y.UndoManager | null = null;
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    // Before the first sync, the 'sync' handler reads (or merges) the state that arrived
    if (!binding || !synced || tr.origin === LOCAL || tr.changed.size === 0) return;
    catchUp();
    if (tr.origin === undo) touch();
  });

  // Ours into the shared document, right away (so nothing of ours is overwritten by a read)
  const kindRev = open.kind === "flow" ? rev : open.kind === "eer" ? eerRev : open.kind === "kanban" ? kanbanRev : open.kind === "chart" ? chartRev : null;
  const disposeWrite = createRoot((dispose) => {
    if (kindRev && binding) {
      createEffect(
        on(
          kindRev,
          () => {
            if (!synced) changedBeforeLive = true;
            else if (roleCanEdit(open.role)) write();
          },
          { defer: true },
        ),
      );
    }
    return dispose;
  });

  if (binding && (open.kind === "flow" || open.kind === "eer")) {
    undo = new Y.UndoManager(sharedTypes(doc, binding.kind), { trackedOrigins: new Set([LOCAL]), captureTimeout: 1e9 });
    const changed = open.kind === "flow" ? historyChanged : eerHistoryChanged;
    undo.on("stack-item-added", changed);
    undo.on("stack-item-popped", changed);
    undo.on("stack-cleared", changed);
    const u = undo;
    const shared: SharedUndo = {
      undo: () => u.undo(),
      redo: () => u.redo(),
      stopCapturing: () => u.stopCapturing(),
      canUndo: () => u.canUndo(),
      canRedo: () => u.canRedo(),
    };
    (open.kind === "flow" ? useSharedUndo : useSharedEerUndo)(shared);
  }

  if (open.kind === "text") {
    setTextDoc({ doc, provider: p, seed: () => mayFill });
  }

  // Who we are, for the others
  const id = me()?.user.id ?? guest()?.id ?? `anon-${doc.clientID}`;
  p.awareness.setLocalStateField("user", { name: me()?.user.name ?? guest()?.name ?? "Guest", color: colorFor(id) });
  const onAwareness = () => {
    const list: Peer[] = [];
    p.awareness.getStates().forEach((state, clientId) => {
      if (clientId === doc.clientID || !state.user) return;
      list.push({ clientId, name: state.user.name, color: state.user.color, cursor: state.cursor, selection: state.selection, view: state.view });
    });
    setPeers(list);
  };
  p.awareness.on("change", onAwareness);

  return () => {
    disposeWrite();
    p.awareness.off("change", onAwareness);
    if (undo) {
      (open.kind === "flow" ? useSharedUndo : useSharedEerUndo)(null);
      undo.destroy();
    }
    setTextDoc(null);
    p.destroy();
    doc.destroy();
    if (provider === p) provider = null;
    batch(() => {
      setPeers([]);
      setStatus("off");
    });
  };
}

// The open board changes: leave the old room, join the new one (boards from the
// server only: the desktop app's own files have no role and stay local)
createRoot(() => {
  createEffect(
    on(
      () => {
        const d = openDoc();
        return d?.role ? `${d.id}|${d.share ?? ""}|${d.role}` : null;
      },
      (key) => {
        const open = openDoc();
        if (!key || !open) return;
        const disconnect = connect(open);
        onCleanup(disconnect);
      },
    ),
  );
});
