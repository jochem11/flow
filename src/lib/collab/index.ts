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

import { roleCanEdit } from "../roles";
import { batch, createEffect, createRoot, createSignal, on, onCleanup } from "solid-js";
import * as decoding from "lib0/decoding";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { me } from "../auth";
import { loadComments, guest } from "../comments";
import { applyRemoteEer, eer, eerHistoryChanged, eerRev, useSharedEerUndo } from "../eer";
import { applyRemoteKanban, kanban, kanbanRev } from "../kanban";
import { currentShareToken, inTauri, serverUrl, sessionToken } from "../server";
import { applyRemoteFlow, board, historyChanged, rev, touch, useSharedUndo, type SharedUndo } from "../store";
import type { DiagramType, EerSection, Entity, FlowEdge, FlowNode, KanbanCard, KanbanColumn, KanbanLabel, Relation } from "../types";
import { checkOpenAccess, openDoc, type OpenDoc } from "../workspace";
import { readList, writeList } from "./ylist";

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

/** How a kind of board is kept in the shared document. */
interface Binding {
  types: Y.Map<unknown>[];
  isEmpty(): boolean;
  /** Our store → the shared document */
  write(): void;
  /** The shared document → our store */
  read(): void;
}

// Every list is a top-level type of the shared document (`doc.getMap(name)`):
// those are the same for everyone by name. A nested map made by two people at
// once would be two different maps under one key, and one of them would be lost.
const list = (doc: Y.Doc, name: string) => doc.getMap(name) as Y.Map<Y.Map<unknown>>;

function flowBinding(doc: Y.Doc): Binding {
  const root = doc.getMap("flow");
  const nodes = list(doc, "flow.nodes");
  const edges = list(doc, "flow.edges");
  return {
    types: [root, nodes, edges] as Y.Map<unknown>[],
    isEmpty: () => nodes.size === 0 && edges.size === 0 && !root.has("seeded"),
    write: () => {
      writeList(nodes, board.nodes as never);
      writeList(edges, board.edges as never);
      // The board's settings, only when they changed (each set is a change for everyone)
      const callColors = board.callColors ?? false;
      if ((root.get("callColors") ?? false) !== callColors) root.set("callColors", callColors);
      if (board.diagram && root.get("diagram") !== board.diagram) root.set("diagram", board.diagram);
      if (!root.has("seeded")) root.set("seeded", true);
    },
    read: () =>
      applyRemoteFlow(readList<FlowNode>(nodes), readList<FlowEdge>(edges), {
        callColors: root.get("callColors") as boolean | undefined,
        diagram: root.get("diagram") as DiagramType | undefined,
      }),
  };
}

const ATTRIBUTES = { children: { attributes: {} } };

function eerBinding(doc: Y.Doc): Binding {
  const root = doc.getMap("eer");
  const entities = list(doc, "eer.entities");
  const relations = list(doc, "eer.relations");
  const sections = list(doc, "eer.sections");
  return {
    types: [root, entities, relations, sections] as Y.Map<unknown>[],
    isEmpty: () => entities.size === 0 && relations.size === 0 && sections.size === 0 && !root.has("seeded"),
    write: () => {
      writeList(entities, eer.entities as never, ATTRIBUTES);
      writeList(relations, eer.relations as never);
      writeList(sections, eer.sections as never);
      if (!root.has("seeded")) root.set("seeded", true);
    },
    read: () =>
      applyRemoteEer(readList<Entity>(entities, ATTRIBUTES), readList<Relation>(relations), readList<EerSection>(sections)),
  };
}

/**
 * A kanban board: its columns, and its cards as one list with the column each
 * is in (so a card moved by two people at once ends up in one column, not two).
 */
function kanbanBinding(doc: Y.Doc): Binding {
  const root = doc.getMap("kanban");
  const columns = list(doc, "kanban.columns");
  const cards = list(doc, "kanban.cards");
  const labels = list(doc, "kanban.labels");
  return {
    types: [root, columns, cards, labels] as Y.Map<unknown>[],
    isEmpty: () => columns.size === 0 && !root.has("seeded"),
    write: () => {
      writeList(columns, kanban.columns as never, { skip: ["cards"] });
      // Cards in board order, each with its column; positions are global
      const all = kanban.columns.flatMap((c) => c.cards.map((card) => ({ ...card, _column: c.id })));
      writeList(cards, all as never);
      writeList(labels, (kanban.labels ?? []) as never);
      if (!root.has("seeded")) root.set("seeded", true);
    },
    read: () => {
      const cols = readList<KanbanColumn>(columns).map((c) => ({ ...c, cards: [] as KanbanCard[] }));
      const byId = new Map(cols.map((c) => [c.id, c]));
      for (const card of readList<KanbanCard & { _column?: string }>(cards)) {
        const { _column, ...rest } = card;
        // A card whose column someone deleted meanwhile goes to the first column
        (byId.get(_column ?? "") ?? cols[0])?.cards.push(rest);
      }
      applyRemoteKanban({ columns: cols, labels: readList<KanbanLabel>(labels) });
    },
  };
}

/** Connects the open board to its room; returns how to disconnect. */
function connect(open: OpenDoc): () => void {
  const doc = new Y.Doc();
  const params: Record<string, string> = {};
  const share = currentShareToken();
  if (share) params.share = share;
  const token = sessionToken();
  if (token) params.token = token;
  provider = new WebsocketProvider(wsBase(), open.id, doc, { params, disableBc: true, maxBackoffTime: 5000 });
  const p = provider;
  setStatus("connecting");

  const binding = open.kind === "flow" ? flowBinding(doc) : open.kind === "eer" ? eerBinding(doc) : open.kind === "kanban" ? kanbanBinding(doc) : null;
  let synced = false;
  let mayFill = false;

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
    if (!binding || !binding.isEmpty() || !mayFill) return;
    doc.transact(() => binding.write(), LOCAL);
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
    synced = true;
    setStatus("live");
    // The shared state counts (it may be newer than the JSON we loaded); an empty one we fill
    if (binding && !binding.isEmpty()) binding.read();
    else fill();
  });

  // Theirs (and undo/redo) into our store; undo/redo are our changes, so they are saved
  let undo: Y.UndoManager | null = null;
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    if (!binding || tr.origin === LOCAL || tr.changed.size === 0) return;
    binding.read();
    if (tr.origin === undo) touch();
  });

  // Ours into the shared document, right away (so nothing of ours is overwritten by a read)
  const kindRev = open.kind === "flow" ? rev : open.kind === "eer" ? eerRev : open.kind === "kanban" ? kanbanRev : null;
  const disposeWrite = createRoot((dispose) => {
    if (kindRev && binding) {
      createEffect(
        on(
          kindRev,
          () => {
            if (synced && roleCanEdit(open.role)) doc.transact(() => binding.write(), LOCAL);
          },
          { defer: true },
        ),
      );
    }
    return dispose;
  });

  if (binding && (open.kind === "flow" || open.kind === "eer")) {
    undo = new Y.UndoManager(binding.types, { trackedOrigins: new Set([LOCAL]), captureTimeout: 1e9 });
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
