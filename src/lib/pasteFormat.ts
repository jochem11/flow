// What pasted text is: a diagram from another tool (for a flow board), or tables
// (for an EER board). Kept apart from pasteDiagram.ts so it can be tested alone.

/** Mermaid's diagram types that Flow reads */
const MERMAID = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|mindmap)\b/;

/** The text without a ```mermaid fence, a --- front matter --- block and %% comments */
export function mermaidBody(text: string): string {
  let t = text.trim();
  const fence = /^```\s*mermaid\s*\n([\s\S]*?)\n?```\s*$/i.exec(t);
  if (fence) t = fence[1].trim();
  if (t.startsWith("---")) {
    const end = t.indexOf("\n---", 3);
    if (end > 0) t = t.slice(end + 4).trim();
  }
  return t
    .split("\n")
    .filter((l) => !l.trim().startsWith("%%"))
    .join("\n")
    .trim();
}

/** Is it a diagram from another tool, and which? */
export function diagramFormat(text: string): "mermaid" | "drawio" | "excalidraw" | null {
  const t = text.trim();
  if (!t) return null;
  if (/<mxfile[\s>]|<mxGraphModel[\s>]/.test(t)) return "drawio";
  if (t.startsWith("{") && /"type"\s*:\s*"excalidraw/.test(t)) return "excalidraw";
  return MERMAID.test(mermaidBody(t)) ? "mermaid" : null;
}

/** Tables for an EER board: a Mermaid ER diagram, SQL, or DBML? */
export function tablesFormat(text: string): "mermaid" | "sql" | "dbml" | null {
  const t = text.trim();
  if (!t) return null;
  if (/^erDiagram\b/.test(mermaidBody(t))) return "mermaid";
  if (/\bCREATE\s+TABLE\b/i.test(t)) return "sql";
  if (/^\s*(Table|Enum)\s+[\w".]+\s*(\[[^\]]*\]\s*)?\{/m.test(t)) return "dbml";
  return null;
}
