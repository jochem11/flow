// Preview of the SQL for the open EER diagram, per database, with syntax colors:
// copy it, or download it (saved to the Downloads folder).

import { createResource, createSignal } from "solid-js";
import { api, errMsg } from "../lib/api";
import { eerSnapshot } from "../lib/eer";
import type { SqlDialect } from "../lib/types";
import { runExport } from "../lib/workspace";
import { PreviewDialog } from "./PreviewDialog";

export const DIALECTS: { value: SqlDialect; label: string }[] = [
  { value: "postgres", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL / MariaDB" },
  { value: "sqlite", label: "SQLite" },
  { value: "sqlserver", label: "SQL Server" },
  { value: "oracle", label: "Oracle" },
];

/** The SQL of a database, or DBML (dbdiagram.io and other tools) */
export type SchemaFormat = SqlDialect | "dbml";
const FORMATS: { value: SchemaFormat; label: string }[] = [...DIALECTS, { value: "dbml", label: "DBML" }];

export function SqlDialog(p: { initial: SchemaFormat; onClose: () => void }) {
  const [format, setFormat] = createSignal<SchemaFormat>(p.initial);
  const [code] = createResource(format, (f) =>
    (f === "dbml" ? api.eerDbml(eerSnapshot()) : api.eerSql(eerSnapshot(), f)).catch((e) => `-- ${errMsg(e)}`),
  );

  return (
    <PreviewDialog
      title={format() === "dbml" ? "DBML" : "SQL"}
      tabs={FORMATS}
      tab={format()}
      onTab={setFormat}
      code={code.loading ? undefined : (code() ?? "")}
      lang="sql"
      copyName={format() === "dbml" ? "DBML" : "SQL"}
      downloadTitle="Saves a .sql file to your Downloads folder"
      // DBML: copy it (to paste in dbdiagram.io and the like)
      canDownload={format() !== "dbml"}
      onDownload={() => format() !== "dbml" && runExport(format() as SqlDialect)}
      onClose={p.onClose}
    />
  );
}
