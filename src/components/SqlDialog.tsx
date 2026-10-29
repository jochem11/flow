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

export function SqlDialog(p: { initial: SqlDialect; onClose: () => void }) {
  const [dialect, setDialect] = createSignal<SqlDialect>(p.initial);
  const [sql] = createResource(dialect, (d) => api.eerSql(eerSnapshot(), d).catch((e) => `-- ${errMsg(e)}`));

  return (
    <PreviewDialog
      title="SQL"
      tabs={DIALECTS}
      tab={dialect()}
      onTab={setDialect}
      code={sql.loading ? undefined : sql() ?? ""}
      lang="sql"
      copyName="SQL"
      downloadTitle="Saves a .sql file to your Downloads folder"
      canDownload
      onDownload={() => runExport(dialect())}
      onClose={p.onClose}
    />
  );
}
