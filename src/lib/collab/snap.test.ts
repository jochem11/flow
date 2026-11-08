import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { DocContent } from "../types";
import { mergeSnap } from "./merge";
import { isEmptyIn, readSnap, snapOf, writeSnap } from "./snap";

const kanban = {
  kind: "kanban",
  data: {
    columns: [
      { id: "todo", title: "To do", cards: [{ id: "c1", title: "One", timeLog: [{ startedAt: 1 }] }] },
      { id: "done", title: "Done", cards: [{ id: "c2", title: "Two" }] },
    ],
    labels: [{ id: "l1", name: "Bug", color: "red" }],
  },
} as unknown as DocContent;

const flow = {
  kind: "flow",
  data: { nodes: [{ id: "a", kind: "box", text: "A", x: 0, y: 0 }], edges: [], camera: { x: 0, y: 0, zoom: 1 }, diagram: "flowchart" },
} as unknown as DocContent;

describe("boards in the shared document", () => {
  it("reads back what it wrote, for each kind", () => {
    for (const content of [kanban, flow]) {
      const doc = new Y.Doc();
      const kind = content.kind as "kanban" | "flow";
      expect(isEmptyIn(doc, kind)).toBe(true);
      writeSnap(doc, kind, snapOf(content)!);
      expect(isEmptyIn(doc, kind)).toBe(false);
      const back = readSnap(doc, kind);
      expect(back.lists).toEqual(snapOf(content)!.lists);
    }
  });

  it("puts a stopped timer into a board someone else changed meanwhile", () => {
    const doc = new Y.Doc();
    writeSnap(doc, "kanban", snapOf(kanban)!);
    // Someone on the board renames the other card
    const theirs = readSnap(doc, "kanban");
    (theirs.lists.cards[1] as Record<string, unknown>).title = "Two (renamed)";
    writeSnap(doc, "kanban", theirs);
    // Elsewhere: the timer on c1 stopped
    const before = snapOf(kanban)!;
    const after = structuredClone(kanban) as { data: { columns: { cards: { timeLog?: unknown[] }[] }[] } };
    after.data.columns[0].cards[0].timeLog = [{ startedAt: 1, endedAt: 5 }];
    writeSnap(doc, "kanban", mergeSnap(before, snapOf(after as unknown as DocContent)!, readSnap(doc, "kanban")));
    const cards = readSnap(doc, "kanban").lists.cards as Record<string, unknown>[];
    expect(cards.map((c) => [c.title, c.timeLog])).toEqual([
      ["One", [{ startedAt: 1, endedAt: 5 }]],
      ["Two (renamed)", undefined],
    ]);
  });
});
