// What changed between an old version of a board and the board now: which of the
// old version's items are gone now or changed since (marked when viewing it), and
// a sentence saying how much changed. By id: blocks and lines, cards and columns,
// tables and relations; a document's lines; a chart's table as a whole.

import type { DocContent } from "./types";

/** An item of the old version: gone from the board now, or changed since */
export type Mark = "gone" | "changed";

export interface VersionDiff {
  marks: Map<string, Mark>;
  /** e.g. "3 blocks added, 1 removed, 2 changed" (empty: nothing changed) */
  summary: string;
}

type Item = { id: string };

/** Items of `old` gone from `now` or changed since, and how many `now` has that `old` had not */
function compare<T extends Item>(old: T[], now: T[], marks: Map<string, Mark>) {
  const after = new Map(now.map((i) => [i.id, i]));
  const before = new Set(old.map((i) => i.id));
  let gone = 0;
  let changed = 0;
  for (const o of old) {
    const n = after.get(o.id);
    if (!n) {
      marks.set(o.id, "gone");
      gone++;
    } else if (JSON.stringify(o) !== JSON.stringify(n)) {
      marks.set(o.id, "changed");
      changed++;
    }
  }
  const added = now.filter((n) => !before.has(n.id)).length;
  return { added, gone, changed };
}

/** "3 blocks added, 1 removed, 2 changed": the noun on the first part only */
function say(counts: { added: number; gone: number; changed: number }, one: string, many: string): string {
  const parts = ([[counts.added, "added"], [counts.gone, "removed"], [counts.changed, "changed"]] as const).filter(([n]) => n > 0);
  return parts.map(([n, what], i) => (i === 0 ? `${n} ${n === 1 ? one : many} ${what}` : `${n} ${what}`)).join(", ");
}

const join = (parts: string[]) => parts.filter(Boolean).join("; ");

/** How a document's lines differ: added and removed (as a multiset, so a moved line counts once each way) */
function lines(old: string, now: string) {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n").map((x) => x.trim()).filter(Boolean)) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(old);
  const b = count(now);
  let added = 0;
  let gone = 0;
  for (const [l, n] of b) added += Math.max(0, n - (a.get(l) ?? 0));
  for (const [l, n] of a) gone += Math.max(0, n - (b.get(l) ?? 0));
  return { added, gone, changed: 0 };
}

export function diffVersion(old: DocContent, now: DocContent): VersionDiff {
  const marks = new Map<string, Mark>();
  if (old.kind !== now.kind) return { marks, summary: "" };
  let summary = "";
  switch (old.kind) {
    case "flow": {
      const n = now.data as typeof old.data;
      summary = join([say(compare(old.data.nodes, n.nodes, marks), "block", "blocks"), say(compare(old.data.edges, n.edges, marks), "line", "lines")]);
      break;
    }
    case "kanban": {
      const n = now.data as typeof old.data;
      const cards = (d: typeof old.data) => d.columns.flatMap((c) => c.cards.map((card) => ({ ...card, _column: c.id })));
      const columns = (d: typeof old.data) => d.columns.map(({ cards: _, ...c }) => c);
      summary = join([say(compare(cards(old.data), cards(n), marks), "card", "cards"), say(compare(columns(old.data), columns(n), marks), "column", "columns")]);
      break;
    }
    case "eer": {
      const n = now.data as typeof old.data;
      summary = join([
        say(compare(old.data.entities, n.entities, marks), "table", "tables"),
        say(compare(old.data.relations, n.relations, marks), "relation", "relations"),
      ]);
      break;
    }
    case "text": {
      const n = now.data as typeof old.data;
      summary = say(lines(old.data.markdown, n.markdown), "line", "lines");
      break;
    }
    case "chart": {
      const n = now.data as typeof old.data;
      const { svg: _a, ...a } = old.data;
      const { svg: _b, ...b } = n;
      summary = JSON.stringify(a) === JSON.stringify(b) ? "" : "the chart changed";
      break;
    }
  }
  return { marks, summary };
}
