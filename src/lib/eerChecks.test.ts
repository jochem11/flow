import { describe, expect, it } from "vitest";
import { checkSchema } from "./eerChecks";
import type { Attribute, Entity, Relation } from "./types";

const col = (id: string, name: string, extra: Partial<Attribute> = {}): Attribute =>
  ({ id, name, dataType: "int", primaryKey: false, nullable: true, unique: false, autoIncrement: false, ...extra }) as Attribute;
const table = (id: string, name: string, attributes: Attribute[], extra: Partial<Entity> = {}): Entity => ({ id, name, x: 0, y: 0, attributes, ...extra });
const rel = (from: string, to: string, columns: { from: string; to: string }[]): Relation =>
  ({ id: `${from}-${to}`, from, to, fromCardinality: "many", toCardinality: "one", columns, onDelete: "noAction", onUpdate: "noAction" }) as Relation;

describe("schema checks", () => {
  const customer = table("c", "customer", [col("c.id", "id", { primaryKey: true })]);

  it("finds tables without a key, empty tables and doubled names", () => {
    const msgs = checkSchema(
      [customer, table("l", "log", [col("l.at", "at")]), table("e", "empty", []), table("c2", "Customer", [col("x", "id", { primaryKey: true }), col("y", "ID")])],
      [],
    ).map((p) => p.message);
    expect(msgs).toContain("log has no primary key");
    expect(msgs).toContain("empty has no columns");
    expect(msgs).toContain("There are two tables called Customer");
    expect(msgs).toContain("Customer has two columns called ID");
  });

  it("wants an index on a foreign key, and the same type on both sides", () => {
    const order = table("o", "orders", [col("o.id", "id", { primaryKey: true }), col("o.cid", "customer_id", { dataType: "bigint" })]);
    const problems = checkSchema([customer, order], [rel("o", "c", [{ from: "o.cid", to: "c.id" }])]);
    expect(problems.map((p) => p.level).sort()).toEqual(["tip", "warning"]);
    expect(problems.find((p) => p.level === "warning")?.message).toContain("not the same type");
    // With an index that starts with it, and the same type: fine
    const fixed = { ...order, attributes: [order.attributes[0], { ...order.attributes[1], dataType: "int" as const }], indexes: [{ id: "i", name: "", columns: ["o.cid", "o.id"], unique: false }] };
    expect(checkSchema([customer, fixed], [rel("o", "c", [{ from: "o.cid", to: "c.id" }])])).toEqual([]);
  });
});
