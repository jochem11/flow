import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";

const kinds = (code: string, lang: Parameters<typeof highlight>[1]) =>
  highlight(code, lang).filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.text}`);

describe("highlight", () => {
  it("Java", () => {
    expect(kinds('@Override\npublic int pay(String s) { return 1; } // done', "java")).toEqual([
      "annotation:@Override",
      "keyword:public",
      "keyword:int",
      "function:pay",
      "type:String",
      "keyword:return",
      "number:1",
      "comment:// done",
    ]);
  });
  it("SQL keywords are case-insensitive, identifiers in quotes are not strings", () => {
    expect(kinds(`create table "order" (id INT DEFAULT 'x'); -- note`, "sql")).toEqual([
      "keyword:create",
      "keyword:table",
      "keyword:INT",
      "keyword:DEFAULT",
      "string:'x'",
      "comment:-- note",
    ]);
  });
  it("Mermaid: %% comments, only double quotes are strings", () => {
    expect(kinds(`classDiagram\n  Order *-- "1..*" Line : it's\n%% skipped`, "mermaid")).toEqual([
      "keyword:classDiagram",
      "type:Order",
      'string:"1..*"',
      "type:Line",
      "comment:%% skipped",
    ]);
  });
  it("keeps all the text", () => {
    const code = "func (c *Order) Pay() bool {\n\treturn true\n}";
    expect(highlight(code, "go").map((t) => t.text).join("")).toBe(code);
  });
});
