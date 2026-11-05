// Checks on an EER diagram, like a schema linter: what will make the database
// awkward or the SQL fail. Pure: the diagram in, the problems out.

import type { Attribute, Entity, Relation } from "./types";

export interface Problem {
  /** The table it is about (to select and show it), if any */
  entityId?: string;
  relationId?: string;
  message: string;
  /** warning: likely wrong; tip: worth a look */
  level: "warning" | "tip";
}

const isMany = (c: Relation["fromCardinality"]) => c === "many" || c === "oneOrMany";

/** The type as the database sees it: varchar(255) and varchar(100) differ */
const typeOf = (a: Attribute) =>
  a.dataType === "varchar" || a.dataType === "char"
    ? `${a.dataType}(${a.length ?? 255})`
    : a.dataType === "decimal"
      ? `decimal(${a.length ?? 10},${a.scale ?? 2})`
      : a.dataType;

export function checkSchema(entities: Entity[], relations: Relation[]): Problem[] {
  const out: Problem[] = [];
  const byId = new Map(entities.map((e) => [e.id, e]));

  // Two tables with one name
  const seen = new Map<string, Entity>();
  for (const e of entities) {
    const key = e.name.trim().toLowerCase();
    if (seen.has(key)) out.push({ entityId: e.id, level: "warning", message: `There are two tables called ${e.name}` });
    else seen.set(key, e);
  }

  for (const e of entities) {
    if (!e.attributes.length) {
      out.push({ entityId: e.id, level: "warning", message: `${e.name} has no columns` });
      continue;
    }
    if (!e.attributes.some((a) => a.primaryKey)) out.push({ entityId: e.id, level: "warning", message: `${e.name} has no primary key` });
    const names = new Set<string>();
    for (const a of e.attributes) {
      const key = a.name.trim().toLowerCase();
      if (names.has(key)) out.push({ entityId: e.id, level: "warning", message: `${e.name} has two columns called ${a.name}` });
      names.add(key);
    }
  }

  for (const r of relations) {
    const from = byId.get(r.from);
    const to = byId.get(r.to);
    if (!from || !to) continue;
    if (isMany(r.fromCardinality) && isMany(r.toCardinality)) continue; // a junction table on export
    const columns = r.columns ?? [];
    if (!columns.length) {
      out.push({ relationId: r.id, entityId: from.id, level: "tip", message: `${from.name} → ${to.name} has no join columns, so no foreign key is made` });
      continue;
    }
    // The joined columns must be of the same type
    for (const c of columns) {
      const a = from.attributes.find((x) => x.id === c.from);
      const b = to.attributes.find((x) => x.id === c.to);
      if (a && b && typeOf(a) !== typeOf(b)) {
        out.push({
          relationId: r.id,
          entityId: from.id,
          level: "warning",
          message: `${from.name}.${a.name} (${typeOf(a)}) refers to ${to.name}.${b.name} (${typeOf(b)}): not the same type`,
        });
      }
    }
    // Looking up rows by a foreign key is slow without an index that starts with it
    const fk = columns.map((c) => c.from);
    const startsWith = (cols: string[]) => fk.every((id, i) => cols[i] === id);
    const pk = from.attributes.filter((a) => a.primaryKey).map((a) => a.id);
    const single = fk.length === 1 && from.attributes.find((a) => a.id === fk[0])?.unique;
    const indexed = startsWith(pk) || single || (from.indexes ?? []).some((ix) => startsWith(ix.columns));
    if (!indexed) {
      const names = fk.map((id) => from.attributes.find((a) => a.id === id)?.name ?? "?").join(", ");
      out.push({ relationId: r.id, entityId: from.id, level: "tip", message: `The foreign key ${from.name}.${names} has no index, so looking up ${from.name} by ${to.name} is slow` });
    }
  }
  return out;
}
