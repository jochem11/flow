// Pasting a diagram written elsewhere straight onto a board (Ctrl/Cmd+V): Mermaid
// text (also in a ```mermaid block), a copied draw.io or Excalidraw drawing on a
// flow board; a Mermaid ER diagram, SQL or DBML on an EER board. Read as the
// Import dialogs do (Rust: import/, sql_import.rs, dbml.rs), and put where it
// was pasted. Any other text is pasted as before (a block per line).

import { api, errMsg } from "./api";
import { focusOn } from "./camera";
import { pasteEer } from "./eer";
import { diagramFormat, mermaidBody, tablesFormat } from "./pasteFormat";
import { board, insertDiagram } from "./store";
import { toast } from "./toast";
import type { SqlImport } from "./types";

export { diagramFormat, tablesFormat };

const NAMES = { mermaid: "Mermaid", drawio: "draw.io", excalidraw: "Excalidraw", sql: "SQL", dbml: "DBML" } as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A diagram pasted on a flow board, centred at `at` (world coordinates). */
export async function pasteDiagram(text: string, at: { x: number; y: number }) {
  const format = diagramFormat(text);
  if (!format) return;
  try {
    const r = await api.importDiagram(format === "mermaid" ? mermaidBody(text) : text);
    if (r.eer) {
      toast("That is an ER diagram: paste it on an EER board (or Import → Diagram… makes one)");
      return;
    }
    if (!r.nodes.length) {
      toast(r.skipped[0] ?? `Nothing to add from that ${NAMES[format]} text`, "error");
      return;
    }
    const empty = !board.nodes.length;
    const area = insertDiagram(r, at);
    toast(`Pasted from ${NAMES[format]}: ${plural(r.nodes.length, "block", "blocks")}, ${plural(r.edges.length, "line", "lines")}`);
    // On an empty board it is all there is: shown whole
    if (empty && area) requestAnimationFrame(() => focusOn(area));
  } catch (e) {
    toast(errMsg(e), "error");
  }
}

/** Tables pasted on an EER board, centred at `at`. */
export async function pasteTables(text: string, at: { x: number; y: number }) {
  const format = tablesFormat(text);
  if (!format) return;
  try {
    let tables: SqlImport | null;
    if (format === "mermaid") tables = (await api.importDiagram(mermaidBody(text))).eer;
    else if (format === "dbml") tables = await api.importDbml(text);
    else tables = await api.importSql(text);
    if (!tables?.entities.length) {
      toast(tables?.skipped[0] ?? `No tables in that ${NAMES[format]}`, "error");
      return;
    }
    pasteEer({ kind: "eer", entities: tables.entities, relations: tables.relations, sections: tables.sections ?? [] }, at);
    toast(`Pasted from ${NAMES[format]}: ${plural(tables.entities.length, "table", "tables")}`);
  } catch (e) {
    toast(errMsg(e), "error");
  }
}
