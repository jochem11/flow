import { describe, expect, it } from "vitest";
import { diagramFormat, tablesFormat } from "./pasteFormat";

describe("diagramFormat", () => {
  it("knows Mermaid, also in a fence, after front matter and comments", () => {
    expect(diagramFormat("flowchart TD\n  A --> B")).toBe("mermaid");
    expect(diagramFormat("graph LR; A-->B")).toBe("mermaid");
    expect(diagramFormat("```mermaid\nsequenceDiagram\n  A->>B: hi\n```")).toBe("mermaid");
    expect(diagramFormat("---\ntitle: Order\n---\n%% a comment\nclassDiagram\n  class A")).toBe("mermaid");
    expect(diagramFormat("stateDiagram-v2\n  [*] --> On")).toBe("mermaid");
  });
  it("knows draw.io and Excalidraw", () => {
    expect(diagramFormat('<mxfile host="app"><diagram/></mxfile>')).toBe("drawio");
    expect(diagramFormat('<mxGraphModel><root/></mxGraphModel>')).toBe("drawio");
    expect(diagramFormat('{"type":"excalidraw","elements":[]}')).toBe("excalidraw");
  });
  it("leaves other text alone", () => {
    expect(diagramFormat("")).toBeNull();
    expect(diagramFormat("Buy milk\nCall Anna")).toBeNull();
    expect(diagramFormat("the graph shows growth")).toBeNull();
    expect(diagramFormat('{"kind":"flow"}')).toBeNull();
  });
});

describe("tablesFormat", () => {
  it("knows a Mermaid ER diagram, SQL and DBML", () => {
    expect(tablesFormat("erDiagram\n  CUSTOMER ||--o{ ORDER : places")).toBe("mermaid");
    expect(tablesFormat("CREATE TABLE users (id int primary key);")).toBe("sql");
    expect(tablesFormat("Table users {\n  id int [pk]\n}")).toBe("dbml");
  });
  it("leaves other text alone", () => {
    expect(tablesFormat("flowchart TD\n A-->B")).toBeNull();
    expect(tablesFormat("A table of contents")).toBeNull();
  });
});
