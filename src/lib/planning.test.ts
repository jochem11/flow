import { describe, expect, it } from "vitest";
import { addDays, cardSpan, daysBetween, isOverdue, makesLoop, matches, NO_FILTER, openBlockers, timelineRange } from "./planning";
import type { KanbanCard } from "./types";

const card = (id: string, extra: Partial<KanbanCard> = {}): KanbanCard =>
  ({ id, title: id, description: "", labelIds: [], comments: [], timeEntries: [], ...extra }) as KanbanCard;

describe("planning", () => {
  it("counts days across months and summer time", () => {
    expect(addDays("2026-03-28", 3)).toBe("2026-03-31");
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(daysBetween("2026-03-27", "2026-04-02")).toBe(6);
  });

  it("is overdue only when past due and not done", () => {
    const c = card("a", { dueDate: "2026-11-01" });
    expect(isOverdue(c, false, "2026-11-02")).toBe(true);
    expect(isOverdue(c, true, "2026-11-02")).toBe(false);
    expect(isOverdue(c, false, "2026-11-01")).toBe(false);
  });

  it("knows open blockers and refuses loops", () => {
    const cards = new Map([
      ["a", card("a", { blockedBy: ["b"] })],
      ["b", card("b", { blockedBy: ["c"] })],
      ["c", card("c")],
    ]);
    const find = (id: string) => cards.get(id);
    expect(openBlockers(cards.get("a")!, find, (id) => id === "b").map((c) => c.id)).toEqual([]);
    expect(openBlockers(cards.get("a")!, find, () => false).map((c) => c.id)).toEqual(["b"]);
    // c blocked by a would close the loop a → b → c → a
    expect(makesLoop("c", "a", find)).toBe(true);
    expect(makesLoop("a", "c", find)).toBe(false);
    expect(makesLoop("a", "a", find)).toBe(true);
  });

  it("filters on text, person, label, priority and overdue", () => {
    const c = card("x", { title: "Login page", assigneeIds: ["u1"], labelIds: ["l1"], priority: "high", dueDate: "2026-01-01" });
    expect(matches(c, { ...NO_FILTER, text: "login" }, false)).toBe(true);
    expect(matches(c, { ...NO_FILTER, mine: "u2" }, false)).toBe(false);
    expect(matches(c, { ...NO_FILTER, labelId: "l1", priority: "high", overdue: true }, false, "2026-02-01")).toBe(true);
    expect(matches(c, { ...NO_FILTER, priority: "low" }, false)).toBe(false);
  });

  it("puts cards on the timeline from start to due", () => {
    expect(cardSpan(card("a", { startDate: "2026-11-03", dueDate: "2026-11-07" }))).toEqual({ from: "2026-11-03", to: "2026-11-07" });
    expect(cardSpan(card("a", { dueDate: "2026-11-07" }))).toEqual({ from: "2026-11-07", to: "2026-11-07" });
    expect(cardSpan(card("a"))).toBeNull();
    const r = timelineRange([card("a", { startDate: "2026-10-01", dueDate: "2026-10-05" })], "2026-11-02");
    expect(r.from).toBe("2026-09-29");
    expect(addDays(r.from, r.days - 1) >= "2026-11-16").toBe(true);
  });
});
