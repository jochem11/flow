// Types in class diagrams. A class's text keeps neutral UML types (`int`,
// `string`, `List<Order>`, `Order?`, `Map<string, int>`); a board with a
// programming language shows them as that language writes them, and what is typed
// in that language is read back to neutral. The built-in types come from
// fixtures/types.json, shared with crates/flow-core/src/codegen/types.rs (`ty`,
// which this mirrors).

import fixture from "../../fixtures/types.json";
import type { CodeLanguage } from "./types";

export const LANGUAGES = fixture.languages as CodeLanguage[];
const slot = (l: CodeLanguage) => LANGUAGES.indexOf(l);

/** Every name of a built-in type (lowercase) → its neutral name and how each language writes it */
const BUILTINS = new Map<string, { name: string; in: string[] }>(
  fixture.types.flatMap((t) => [t.name, ...t.aliases].map((n) => [n.toLowerCase(), { name: t.name, in: t.in }] as const)),
);

export const isBuiltin = (name: string) => BUILTINS.has(name.toLowerCase());

const LIST = ["list", "collection", "array", "vec", "sequence", "arraylist", "ilist", "ienumerable", "mutablelist"];
const SET = ["set", "hashset", "mutableset", "iset"];
const MAP = ["map", "dict", "dictionary", "hashmap", "mutablemap", "record", "idictionary"];
const OPTIONAL = ["option", "optional"];
/** Generic types that hold other types rather than being a class themselves */
export const CONTAINERS = new Set([...LIST, ...SET, ...MAP, ...OPTIONAL]);

/** A type split into what matters for writing it in a language (as `Ty` in types.rs). */
type Ty =
  | { k: "named"; name: string }
  | { k: "list"; of: Ty }
  | { k: "set"; of: Ty }
  | { k: "map"; key: Ty; value: Ty }
  | { k: "optional"; of: Ty }
  | { k: "generic"; base: string; args: Ty[] };

/** Splits `A, Map<B, C>` on the top-level commas (also inside `[...]`). */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "<" || c === "[") depth++;
    if (c === ">" || c === "]") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A neutral UML type, parsed (as `parse_ty` in types.rs). */
function parseUml(raw: string): Ty {
  const s = raw.trim();
  if (s.endsWith("?")) return { k: "optional", of: parseUml(s.slice(0, -1)) };
  if (s.endsWith("[]")) return { k: "list", of: parseUml(s.slice(0, -2)) };
  const open = s.indexOf("<");
  if (open > 0 && s.endsWith(">")) {
    const base = s.slice(0, open);
    const args = splitArgs(s.slice(open + 1, -1));
    const lower = base.toLowerCase();
    if (LIST.slice(0, 5).includes(lower) && args.length === 1) return { k: "list", of: parseUml(args[0]) };
    if (SET.slice(0, 2).includes(lower) && args.length === 1) return { k: "set", of: parseUml(args[0]) };
    if (MAP.slice(0, 4).includes(lower) && args.length === 2) return { k: "map", key: parseUml(args[0]), value: parseUml(args[1]) };
    return { k: "generic", base, args: args.map(parseUml) };
  }
  return { k: "named", name: s };
}

/** `order_line` → `OrderLine`, as `pascal` in types.rs */
function pascal(s: string): string {
  const words = s.match(/[\p{Lu}]?[\p{Ll}\p{N}]+|[\p{Lu}]+(?![\p{Ll}])|[\p{Lu}]/gu) ?? [s];
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join("");
}

const BOXED: Record<string, string> = { int: "Integer", long: "Long", double: "Double", boolean: "Boolean" };

/** A parsed type as language `l` writes it (as `ty` in types.rs). */
function write(t: Ty, l: CodeLanguage, boxed = false): string {
  switch (t.k) {
    case "named": {
      const b = BUILTINS.get(t.name.toLowerCase());
      if (!b) return pascal(t.name);
      const s = b.in[slot(l)];
      return l === "java" && boxed ? (BOXED[s] ?? s) : s;
    }
    case "list": {
      const i = write(t.of, l, true);
      return { typescript: `${i}[]`, python: `list[${i}]`, rust: `Vec<${i}>`, go: `[]${i}` }[l as string] ?? `List<${i}>`;
    }
    case "set": {
      const i = write(t.of, l, true);
      return { csharp: `HashSet<${i}>`, python: `set[${i}]`, rust: `HashSet<${i}>`, go: `map[${i}]bool` }[l as string] ?? `Set<${i}>`;
    }
    case "map": {
      const k = write(t.key, l, true);
      const v = write(t.value, l, true);
      return { csharp: `Dictionary<${k}, ${v}>`, python: `dict[${k}, ${v}]`, rust: `HashMap<${k}, ${v}>`, go: `map[${k}]${v}` }[l as string] ?? `Map<${k}, ${v}>`;
    }
    case "optional": {
      const i = write(t.of, l, true);
      return { typescript: `${i} | null`, python: `${i} | None`, rust: `Option<${i}>`, go: `*${i}`, java: i }[l as string] ?? `${i}?`;
    }
    case "generic": {
      const a = t.args.map((x) => write(x, l, true));
      if (l === "python") return `${t.base}[${a.join(", ")}]`;
      return `${pascal(t.base)}<${a.join(", ")}>`;
    }
  }
}

/** A neutral type as `lang` writes it; null (UML) keeps it as it is. */
export function typeIn(uml: string, lang: CodeLanguage | null | undefined): string {
  if (!lang || !uml.trim()) return uml;
  return write(parseUml(uml), lang);
}

/** A neutral type in its usual form: built-in names as listed (`integer` → `int`), the rest as written. */
function toUml(t: Ty): string {
  switch (t.k) {
    case "named":
      return BUILTINS.get(t.name.toLowerCase())?.name ?? t.name;
    case "list":
      return `List<${toUml(t.of)}>`;
    case "set":
      return `Set<${toUml(t.of)}>`;
    case "map":
      return `Map<${toUml(t.key)}, ${toUml(t.value)}>`;
    case "optional":
      return `${toUml(t.of)}?`;
    case "generic":
      return `${t.base}<${t.args.map(toUml).join(", ")}>`;
  }
}

/** A type as `lang` writes it, parsed back to what it means. */
function parseIn(raw: string, lang: CodeLanguage): Ty {
  const s = raw.trim();
  const read = (fixture.read as Record<string, Record<string, string>>)[lang] ?? {};
  // A language's own name for a built-in (also the ones with symbols: `[]byte`, `Vec<u8>`)
  if (read[s]) return { k: "named", name: read[s] };
  // `X | null`, `X | None`, `X | undefined`
  const union = s.split("|").map((p) => p.trim());
  if (union.length > 1) {
    const rest = union.filter((p) => !["null", "None", "undefined"].includes(p));
    if (rest.length === 1) return { k: "optional", of: parseIn(rest[0], lang) };
  }
  if (s.endsWith("?")) return { k: "optional", of: parseIn(s.slice(0, -1), lang) };
  if (s.endsWith("[]")) return { k: "list", of: parseIn(s.slice(0, -2), lang) };
  // Go: *X, []X, map[K]V
  if (s.startsWith("*")) return { k: "optional", of: parseIn(s.slice(1), lang) };
  if (s.startsWith("[]")) return { k: "list", of: parseIn(s.slice(2), lang) };
  if (s.startsWith("map[")) {
    let depth = 0;
    for (let i = 3; i < s.length; i++) {
      if (s[i] === "[") depth++;
      if (s[i] === "]" && --depth === 0) {
        const key = parseIn(s.slice(4, i), lang);
        const value = s.slice(i + 1);
        // map[X]bool is how Flow writes a set in Go
        if (value.trim() === "bool") return { k: "set", of: key };
        return { k: "map", key, value: parseIn(value, lang) };
      }
    }
  }
  // Name<args> or (Python) name[args]
  const m = /^([\p{L}_][\p{L}\p{N}_.:]*)\s*([<[])(.*)([>\]])$/u.exec(s);
  if (m) {
    const base = m[1].split(/[.:]+/).pop()!;
    const args = splitArgs(m[3]).map((a) => parseIn(a, lang));
    const lower = base.toLowerCase();
    if (LIST.includes(lower) && args.length === 1) return { k: "list", of: args[0] };
    if (SET.includes(lower) && args.length === 1) return { k: "set", of: args[0] };
    if (MAP.includes(lower) && args.length === 2) return { k: "map", key: args[0], value: args[1] };
    if (OPTIONAL.includes(lower) && args.length === 1) return { k: "optional", of: args[0] };
    return { k: "generic", base, args };
  }
  return { k: "named", name: s };
}

/**
 * What a type written as `lang` writes it means, as a neutral type. With
 * `before` (the neutral type it was), a type that still reads the same keeps it:
 * `number` in TypeScript stays `int` when it was `int`.
 */
export function typeFrom(written: string, lang: CodeLanguage | null | undefined, before?: string): string {
  if (!written.trim()) return written;
  if (before && typeIn(before, lang) === written.trim()) return before;
  if (!lang) return toUml(parseUml(written));
  return toUml(parseIn(written, lang));
}

/** The built-in types the type picker offers in `lang` (neutral and as shown), in the fixture's order. */
export function pickerTypes(lang: CodeLanguage | null | undefined): { uml: string; label: string }[] {
  if (!lang) return fixture.types.map((t) => ({ uml: t.name, label: t.name }));
  const read = (fixture.read as Record<string, Record<string, string>>)[lang] ?? {};
  // The first names listed per language are the ones to offer; the rest are only understood
  const seen = new Set<string>();
  const out: { uml: string; label: string }[] = [];
  for (const [label, uml] of Object.entries(read)) {
    if (seen.has(uml)) continue;
    seen.add(uml);
    out.push({ uml, label });
  }
  return out;
}
