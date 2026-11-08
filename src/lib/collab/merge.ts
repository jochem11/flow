// Changes made to a board before it was live (opened offline, or changed while
// its room was still connecting) put into the board as it is in the room, so
// neither ours nor others' are lost. A three-way merge: what we loaded (base),
// what we have now (ours), what the room has (theirs).
//
// Per item (by id) and per field: what we changed wins, the rest is theirs.
// An item we added is put after the item before it in our list; one we deleted
// goes; one they deleted stays deleted, unless we changed it meanwhile.

type Item = { id: string } & Record<string, unknown>;

/** A board's content as lists of items with ids, and single values (its settings) */
export interface Snap {
  lists: Record<string, Item[]>;
  values: Record<string, unknown>;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

function mergeItem(base: Item, ours: Item, theirs: Item): Item {
  const out: Record<string, unknown> = { ...theirs };
  for (const key of new Set([...Object.keys(base), ...Object.keys(ours)])) {
    if (same(ours[key], base[key])) continue;
    if (ours[key] === undefined) delete out[key];
    else out[key] = ours[key];
  }
  return out as Item;
}

export function mergeList(base: Item[], ours: Item[], theirs: Item[]): Item[] {
  const was = new Map(base.map((i) => [i.id, i]));
  const mine = new Map(ours.map((i) => [i.id, i]));
  const out: Item[] = [];
  for (const t of theirs) {
    const b = was.get(t.id);
    const o = mine.get(t.id);
    if (b && !o) continue; // deleted by us
    out.push(b && o && !same(o, b) ? mergeItem(b, o, t) : t);
  }
  const placed = new Set(out.map((i) => i.id));
  ours.forEach((o, index) => {
    if (placed.has(o.id)) return;
    const b = was.get(o.id);
    // Deleted by them and not changed by us: stays deleted
    if (b && same(b, o)) return;
    // Added by us (or changed by us while they deleted it): after the one before it
    let at = 0;
    for (let j = index - 1; j >= 0; j--) {
      const k = out.findIndex((i) => i.id === ours[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, o);
    placed.add(o.id);
  });
  return out;
}

export function mergeSnap(base: Snap, ours: Snap, theirs: Snap): Snap {
  const lists: Snap["lists"] = {};
  for (const key of Object.keys(ours.lists)) lists[key] = mergeList(base.lists[key] ?? [], ours.lists[key], theirs.lists[key] ?? []);
  const values: Snap["values"] = {};
  for (const key of new Set([...Object.keys(ours.values), ...Object.keys(theirs.values)])) {
    const changed = !same(ours.values[key], base.values[key]);
    values[key] = changed || !(key in theirs.values) ? ours.values[key] : theirs.values[key];
  }
  return { lists, values };
}

/** The same content (in any order of keys) */
export function sameSnap(a: Snap, b: Snap): boolean {
  const keys = (x: object, y: object) => new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys(a.lists, b.lists)) if (!same(a.lists[k], b.lists[k])) return false;
  for (const k of keys(a.values, b.values)) if (!same(a.values[k], b.values[k])) return false;
  return true;
}
