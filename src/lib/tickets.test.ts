import { describe, expect, it } from "vitest";
import { byRank, cleanKey, keyFromName, needsNumbers, nextNumber, nextSprintName, numberCards, openSprints, progressOf, rankBetween, sprintDays, ticketId } from "./tickets";
import type { KanbanCard, KanbanDoc, Sprint } from "./types";

const card = (id: string, extra: Partial<KanbanCard> = {}) => ({ id, title: id, description: "", labelIds: [], comments: [], timeEntries: [], ...extra }) as KanbanCard;
const board = (cols: KanbanCard[][], extra: Partial<KanbanDoc> = {}) => ({ columns: cols.map((cards, i) => ({ id: `c${i}`, title: `c${i}`, done: false, cards })), labels: [], ...extra }) as KanbanDoc;
const numbers = (d: KanbanDoc) => d.columns.flatMap((c) => c.cards.map((x) => x.number));

describe("ticket keys", () => {
  it("makes a key from a board's name", () => {
    expect(keyFromName("Web shop")).toBe("WS");
    expect(keyFromName("Website")).toBe("WEB");
    expect(keyFromName("Q3 planning board")).toBe("QPB");
    expect(keyFromName("Café menu")).toBe("CM");
    expect(keyFromName("  ")).toBe("CARD");
    expect(keyFromName("2024")).toBe("CARD");
  });
  it("cleans what is typed", () => {
    expect(cleanKey("web-1")).toBe("WEB1");
    expect(cleanKey("12ab")).toBe("AB");
    expect(cleanKey("abcdefghij")).toBe("ABCDEF");
  });
  it("writes a ticket id", () => {
    expect(ticketId("WEB", card("a", { number: 12 }))).toBe("WEB-12");
    expect(ticketId(null, card("a", { number: 3 }))).toBe("CARD-3");
    expect(ticketId("WEB", card("a"))).toBe("");
  });
});

describe("ticket numbers", () => {
  it("numbers the cards of an old board in board order", () => {
    const d = board([[card("a"), card("b")], [card("c")]]);
    expect(needsNumbers(d)).toBe(true);
    expect(numberCards(d)).toBe(true);
    expect(numbers(d)).toEqual([1, 2, 3]);
    expect(d.nextNumber).toBe(4);
    expect(needsNumbers(d)).toBe(false);
    expect(numberCards(d)).toBe(false);
  });
  it("never gives a number again, also after its card is gone", () => {
    const d = board([[card("a", { number: 1 })]], { nextNumber: 8 });
    expect(nextNumber(d)).toBe(8);
    d.columns[0].cards.push(card("b"));
    numberCards(d);
    expect(numbers(d)).toEqual([1, 8]);
    expect(d.nextNumber).toBe(9);
  });
  it("goes on after the highest number when the counter is behind", () => {
    expect(nextNumber(board([[card("a", { number: 5 })]], { nextNumber: 2 }))).toBe(6);
  });
  it("gives one of two cards with the same number a new one: the lower id keeps it", () => {
    const d = board([[card("y", { number: 4 }), card("x", { number: 4 })]], { nextNumber: 5 });
    expect(needsNumbers(d)).toBe(true);
    numberCards(d);
    expect(numbers(d)).toEqual([5, 4]);
  });
});

describe("order", () => {
  it("sorts by rank, and cards without one by number", () => {
    const list = [card("a", { number: 3 }), card("b", { number: 1 }), card("c", { number: 2, rank: 0.5 })];
    expect(list.sort(byRank).map((c) => c.id)).toEqual(["c", "b", "a"]);
  });
  it("finds a rank between the neighbours", () => {
    const list = [card("a", { rank: 1 }), card("b", { rank: 2 })];
    expect(rankBetween(list, 0)).toBe(0);
    expect(rankBetween(list, 1)).toBe(1.5);
    expect(rankBetween(list, 2)).toBe(3);
    expect(rankBetween([], 0)).toBe(1);
    expect(rankBetween([card("a", { rank: 1 }), card("b", { rank: 1 })], 1)).toBeNull();
  });
});

describe("sprints", () => {
  const sprint = (id: string, extra: Partial<Sprint> = {}) => ({ id, name: id, goal: "", state: "planned", ...extra }) as Sprint;
  it("names the next sprint after the highest number", () => {
    expect(nextSprintName([])).toBe("Sprint 1");
    expect(nextSprintName([sprint("a", { name: "Sprint 1" }), sprint("b", { name: "Sprint 7" })])).toBe("Sprint 8");
    expect(nextSprintName([sprint("a", { name: "Launch" })])).toBe("Sprint 2");
  });
  it("lists the running sprints before the planned ones, without the completed", () => {
    const list = [sprint("p1"), sprint("d", { state: "done" }), sprint("a", { state: "active" }), sprint("p2")];
    expect(openSprints(list).map((s) => s.id)).toEqual(["a", "p1", "p2"]);
  });
  it("counts progress", () => {
    const cards = [card("a", { expectedHours: 4, spentHours: 1 }), card("b", { expectedHours: 2, spentHours: 3 }), card("c")];
    expect(progressOf(cards, (c) => c.id === "b")).toEqual({ total: 3, done: 1, expected: 6, spent: 4, expectedDone: 2 });
  });
  it("counts a sprint's days", () => {
    const s = sprint("a", { startDate: "2026-03-02", endDate: "2026-03-15" });
    expect(sprintDays(s, "2026-03-02")).toEqual({ total: 14, gone: 0, left: 13 });
    expect(sprintDays(s, "2026-03-15")).toEqual({ total: 14, gone: 13, left: 0 });
    expect(sprintDays(s, "2026-03-20")).toEqual({ total: 14, gone: 14, left: -5 });
    expect(sprintDays(sprint("b"), "2026-03-02")).toBeNull();
  });
});
