// How a board's content is kept in its shared Yjs document, per kind: as lists
// of items with ids (ylist.ts) and single values on a root map. Used for the
// open board (collab/index.ts) and for changing a board that is not open while
// others are on it (`changeLive` there).
//
// Every list is a top-level type of the shared document (`doc.getMap(name)`):
// those are the same for everyone by name. A nested map made by two people at
// once would be two different maps under one key, and one of them would be lost.

import * as Y from "yjs";
import { FLOW_SETTINGS } from "../store/state";
import type { DocContent } from "../types";
import type { Snap } from "./merge";
import { readList, type Shape, writeList } from "./ylist";

export type LiveKind = "flow" | "eer" | "kanban" | "chart";

const ATTRIBUTES: Shape = { children: { attributes: {} } };

/** Per kind: its root map, and its lists (snap key → shared name, shape) */
const KINDS: Record<LiveKind, { root: string; lists: Record<string, [string, Shape]> }> = {
  flow: { root: "flow", lists: { nodes: ["flow.nodes", {}], edges: ["flow.edges", {}] } },
  eer: { root: "eer", lists: { entities: ["eer.entities", ATTRIBUTES], relations: ["eer.relations", {}], sections: ["eer.sections", {}] } },
  kanban: { root: "kanban", lists: { columns: ["kanban.columns", {}], cards: ["kanban.cards", {}], labels: ["kanban.labels", {}] } },
  chart: { root: "chart", lists: {} },
};

export const isLive = (kind: string): kind is LiveKind => kind in KINDS;

const root = (doc: Y.Doc, kind: LiveKind) => doc.getMap(KINDS[kind].root);
const list = (doc: Y.Doc, name: string) => doc.getMap(name) as Y.Map<Y.Map<unknown>>;

/** The shared types of a kind (what undo follows) */
export const sharedTypes = (doc: Y.Doc, kind: LiveKind): Y.Map<unknown>[] => [
  root(doc, kind),
  ...Object.values(KINDS[kind].lists).map(([name]) => list(doc, name) as Y.Map<unknown>),
];

/** Nothing in it yet: to be filled from the saved JSON */
export function isEmptyIn(doc: Y.Doc, kind: LiveKind): boolean {
  const r = root(doc, kind);
  return !r.has("seeded") && !r.has("doc") && Object.values(KINDS[kind].lists).every(([name]) => list(doc, name).size === 0);
}

/** A plain copy (no store proxies, nothing shared with the original) */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null));

type Items = Snap["lists"][string];

/** A board's content as it is kept in the shared document */
export function snapOf(content: DocContent): Snap | null {
  switch (content.kind) {
    case "flow": {
      const d = content.data;
      return {
        lists: { nodes: plain(d.nodes) as unknown as Items, edges: plain(d.edges) as unknown as Items },
        values: Object.fromEntries(Object.entries(FLOW_SETTINGS).map(([k, unset]) => [k, d[k as keyof typeof FLOW_SETTINGS] ?? unset])),
      };
    }
    case "eer": {
      const d = content.data;
      return { lists: { entities: plain(d.entities) as unknown as Items, relations: plain(d.relations) as unknown as Items, sections: plain(d.sections ?? []) as unknown as Items }, values: {} };
    }
    case "kanban": {
      // Columns without their cards; the cards as one list, each with its column
      const d = content.data;
      return {
        lists: {
          columns: plain(d.columns.map(({ cards: _, ...c }) => c)) as unknown as Items,
          cards: plain(d.columns.flatMap((c) => c.cards.map((card) => ({ ...card, _column: c.id })))) as unknown as Items,
          labels: plain(d.labels ?? []) as unknown as Items,
        },
        values: {},
      };
    }
    case "chart": {
      const { svg: _, ...data } = content.data;
      return { lists: {}, values: { doc: JSON.stringify(data) } };
    }
    default:
      return null;
  }
}

/** What the shared document holds (a value it does not have yet is left out) */
export function readSnap(doc: Y.Doc, kind: LiveKind): Snap {
  const r = root(doc, kind);
  const lists: Snap["lists"] = {};
  for (const [key, [name, shape]] of Object.entries(KINDS[kind].lists)) lists[key] = readList(list(doc, name), shape);
  const keys = kind === "flow" ? Object.keys(FLOW_SETTINGS) : kind === "chart" ? ["doc"] : [];
  return { lists, values: Object.fromEntries(keys.filter((k) => r.has(k)).map((k) => [k, r.get(k)])) };
}

/** Makes the shared document hold this, changing only what differs */
export function writeSnap(doc: Y.Doc, kind: LiveKind, snap: Snap) {
  const r = root(doc, kind);
  for (const [key, [name, shape]] of Object.entries(KINDS[kind].lists)) writeList(list(doc, name), (snap.lists[key] ?? []) as never, shape);
  // Values only when they changed (each set is a change for everyone)
  const unset = kind === "flow" ? (FLOW_SETTINGS as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(snap.values)) {
    if ((r.get(key) ?? unset[key]) !== value) r.set(key, value);
  }
  if (kind !== "chart" && !r.has("seeded")) r.set("seeded", true);
}
