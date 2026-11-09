// Lists of items with an id (blocks, lines, tables, cards) kept in a Yjs document,
// for editing together: a Y.Map from id to a Y.Map of the item's fields, with
// a `_pos` number for the order (fractional, so moving one item changes only
// its own position, and two people moving things never lose or double an item).
//
// Each field is one value: two people changing different fields or items both
// keep their change; the same field at the same moment ends with one of them.
// Fields that are lists of their own items (a table's columns) can be nested.

import * as Y from "yjs";

export const POS = "_pos";

type Item = { id: string } & Record<string, unknown>;

/** How an item is stored: which of its fields are nested lists, and what to keep out. */
export interface Shape {
  /** Fields that are lists of items with ids themselves (kept as nested Y.Maps) */
  children?: Record<string, Shape>;
  /** Extra fields for this item (e.g. the column a card is in), written and read like the rest */
  extra?: (item: Item) => Record<string, unknown>;
  /** Fields not stored at all */
  skip?: string[];
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Positions for `ids` in this order. The longest run of items that are still in
 * order keeps its positions (a longest increasing subsequence); only the others
 * (the moved and new ones) get a position between their neighbours.
 */
export function positions(ids: string[], current: (id: string) => number | undefined): Map<string, number> {
  const known = ids.map((id) => current(id));
  // Longest increasing subsequence of the known positions (patience sorting)
  const tails: number[] = []; // index into ids of the last item of each run length
  const prev: number[] = new Array(ids.length).fill(-1);
  for (let i = 0; i < ids.length; i++) {
    const p = known[i];
    if (p === undefined) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((known[tails[mid]] as number) < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) keep.add(i);

  const out = new Map<string, number>();
  let last = -Infinity;
  for (let i = 0; i < ids.length; i++) {
    if (keep.has(i)) {
      last = known[i] as number;
      out.set(ids[i], last);
      continue;
    }
    let next: number | undefined;
    for (let j = i + 1; j < ids.length; j++) {
      if (keep.has(j)) {
        next = known[j];
        break;
      }
    }
    const pos = last === -Infinity ? (next === undefined ? i + 1 : next - 1) : next === undefined ? last + 1 : (last + next) / 2;
    out.set(ids[i], pos);
    last = pos;
  }
  return out;
}

/** Writes an item's fields into its Y.Map: only what changed. */
function writeItem(ym: Y.Map<unknown>, item: Item, shape: Shape) {
  const fields: Record<string, unknown> = { ...item, ...(shape.extra?.(item) ?? {}) };
  for (const skip of shape.skip ?? []) delete fields[skip];
  for (const [key, value] of Object.entries(fields)) {
    if (key === "id") continue;
    const child = shape.children?.[key];
    if (child) {
      let list = ym.get(key);
      if (!(list instanceof Y.Map)) {
        list = new Y.Map();
        ym.set(key, list);
      }
      writeList(list as Y.Map<Y.Map<unknown>>, (value as Item[]) ?? [], child);
    } else if (value === undefined) {
      if (ym.has(key)) ym.delete(key);
    } else if (!same(ym.get(key), value)) {
      // A copy of an object: the item may be the editor's own (see snapOf), changed in place later
      ym.set(key, typeof value === "object" && value !== null ? JSON.parse(JSON.stringify(value)) : value);
    }
  }
  // Fields the item no longer has
  for (const key of [...ym.keys()]) {
    if (key !== POS && !(key in fields)) ym.delete(key);
  }
}

/** Makes the Y.Map hold exactly `items`, in this order, changing only what differs. */
export function writeList(list: Y.Map<Y.Map<unknown>>, items: Item[], shape: Shape = {}) {
  const ids = new Set(items.map((i) => i.id));
  for (const id of [...list.keys()]) if (!ids.has(id)) list.delete(id);
  const pos = positions(
    items.map((i) => i.id),
    (id) => list.get(id)?.get(POS) as number | undefined,
  );
  for (const item of items) {
    let ym = list.get(item.id);
    if (!ym) {
      ym = new Y.Map();
      list.set(item.id, ym);
    }
    writeItem(ym, item, shape);
    if (ym.get(POS) !== pos.get(item.id)) ym.set(POS, pos.get(item.id));
  }
}

/** The items in a Y.Map, in order (by position, then id: the same everywhere). */
export function readList<T = Item>(list: Y.Map<Y.Map<unknown>> | undefined, shape: Shape = {}): T[] {
  if (!list) return [];
  const entries = [...list.entries()].map(([id, ym]) => ({ id, ym, pos: (ym.get(POS) as number) ?? 0 }));
  entries.sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries.map(({ id, ym }) => {
    const item: Record<string, unknown> = { id };
    for (const [key, value] of ym.entries()) {
      if (key === POS) continue;
      const child = shape.children?.[key];
      item[key] = child ? readList(value as Y.Map<Y.Map<unknown>>, child) : value;
    }
    return item as T;
  });
}

/** A Y.Map under `root`, made if missing (only for one person's own items: see collab/index.ts). */
export function listIn(root: Y.Map<unknown>, key: string): Y.Map<Y.Map<unknown>> {
  let list = root.get(key);
  if (!(list instanceof Y.Map)) {
    list = new Y.Map();
    root.set(key, list);
  }
  return list as Y.Map<Y.Map<unknown>>;
}
