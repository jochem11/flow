// A UML class as a structure: what the class panel edits. The class's text (see
// umlClass.ts) stays what is stored; `parseClass` reads it and `formatClass`
// writes it back, in the same notation the Mermaid and SVG exports read
// (parse_attribute, parse_operation and read_class in crates/flow-core/src/uml/;
// shared cases in fixtures/classRows.json). Rows that are not UML notation are kept as
// they are.

import { classKind, classParts, classText, fixOperation, type ClassKind } from "./umlClass";

/** + public, - private, # protected, ~ package, "" not written (the language's default) */
export type Vis = "+" | "-" | "#" | "~" | "";

export interface Attribute {
  vis: Vis;
  name: string;
  type: string;
  default: string | null;
  static: boolean;
  readOnly: boolean;
}

export type Param = [name: string, type: string];

export interface Operation {
  vis: Vis;
  name: string;
  params: Param[];
  returns: string | null;
  static: boolean;
  abstract: boolean;
}

export interface EnumValue {
  name: string;
  value: string | null;
}

/** A row that is not UML notation: kept as written */
export interface Raw {
  raw: string;
}

export interface ClassModel {
  kind: ClassKind;
  /** Other «stereotypes» above the name (kept as written) */
  stereotypes: string[];
  name: string;
  /** `Repository<T>`: ["T"] */
  typeParams: string[];
  attributes: (Attribute | Raw)[];
  operations: (Operation | Raw)[];
  values: (EnumValue | Raw)[];
}

export const isRaw = (r: object): r is Raw => "raw" in r;

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const isIdent = (s: string) => IDENT.test(s);

/** Splits `a: A, b: Map<B, C>` on the top-level commas. */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s) {
    if (c === "<" || c === "[" || c === "(") depth++;
    if (c === ">" || c === "]" || c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A type: `Name`, `Name<A, B>`, `Name[]` or `Name?` (as `is_type` in read.rs). */
export function isType(raw: string): boolean {
  const s = raw.trim().replace(/\?$/, "").replace(/\[\]$/, "");
  const open = s.indexOf("<");
  if (open < 0) return isIdent(s);
  return s.endsWith(">") && isIdent(s.slice(0, open)) && splitTop(s.slice(open + 1, -1)).every(isType);
}

/** Visibility, static, abstract and readOnly taken off a row (as `modifiers` in read.rs). */
function modifiers(line: string) {
  let s = line.trim();
  const vis = (/^[+\-#~]/.test(s) ? s[0] : "") as Vis;
  if (vis) s = s.slice(1).trim();
  let isStatic = false;
  for (const marker of ["{static}", "static "]) {
    if (s.includes(marker)) {
      isStatic = true;
      s = s.replace(marker, "").trim();
    }
  }
  const isAbstract = s.includes("{abstract}");
  s = s.replace("{abstract}", "").trim();
  const readOnly = /\{readonly\}/i.test(s);
  s = s.replace(/\{readonly\}/i, "").trim();
  return { vis, isStatic, isAbstract, readOnly, rest: s };
}

/**
 * `[+] name: Type [= default] [{readOnly}]`, or null when it is not that.
 * `typeOk` decides what counts as a type (a language's spelling, when reading one back).
 */
export function parseAttribute(line: string, typeOk: (t: string) => boolean = isType): Attribute | null {
  const m = modifiers(line);
  const eq = m.rest.indexOf("=");
  const decl = eq < 0 ? m.rest : m.rest.slice(0, eq).trim();
  const def = eq < 0 ? null : m.rest.slice(eq + 1).trim() || null;
  const colon = decl.indexOf(":");
  if (colon < 0) return null;
  const name = decl.slice(0, colon).trim().replace(/^\//, "");
  const type = decl.slice(colon + 1).trim();
  if (!isIdent(name) || !typeOk(type)) return null;
  return { vis: m.vis, name, type, default: def, static: m.isStatic, readOnly: m.readOnly };
}

/** `[+] name(param: Type, ...)[: ReturnType]`, or null when it is not that (`typeOk` as for attributes). */
export function parseOperation(line: string, typeOk: (t: string) => boolean = isType): Operation | null {
  const m = modifiers(fixOperation(line));
  const rest = m.rest;
  const open = rest.indexOf("(");
  const close = rest.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const name = rest.slice(0, open).trim();
  if (!isIdent(name)) return null;
  const params: Param[] = [];
  for (const p of splitTop(rest.slice(open + 1, close))) {
    const colon = p.indexOf(":");
    if (colon < 0) return null;
    const [n, t] = [p.slice(0, colon).trim(), p.slice(colon + 1).trim()];
    if (!isIdent(n) || !typeOk(t)) return null;
    params.push([n, t]);
  }
  const after = rest.slice(close + 1).trim();
  let returns: string | null = null;
  if (after.startsWith(":")) {
    returns = after.slice(1).trim();
    if (!typeOk(returns)) return null;
  } else if (after) return null;
  return { vis: m.vis, name, params, returns, static: m.isStatic, abstract: m.isAbstract };
}

const vis = (v: Vis) => (v ? `${v} ` : "");

export function formatAttribute(a: Attribute): string {
  const def = a.default !== null && a.default !== "" ? ` = ${a.default}` : "";
  return `${vis(a.vis)}${a.static ? "static " : ""}${a.name}: ${a.type}${def}${a.readOnly ? " {readOnly}" : ""}`;
}

export function formatOperation(o: Operation): string {
  const params = o.params.map(([n, t]) => `${n}: ${t}`).join(", ");
  const ret = o.returns ? `: ${o.returns}` : "";
  return `${vis(o.vis)}${o.static ? "static " : ""}${o.name}(${params})${ret}${o.abstract ? " {abstract}" : ""}`;
}

/** An enum value: `Paid`, or `Paid = 1` */
export function parseEnumValue(line: string): EnumValue | null {
  const s = line.trim().replace(/^[+\-#~]\s*/, "");
  const eq = s.indexOf("=");
  const name = (eq < 0 ? s : s.slice(0, eq)).trim();
  if (!isIdent(name)) return null;
  return { name, value: eq < 0 ? null : s.slice(eq + 1).trim() || null };
}

export const formatEnumValue = (v: EnumValue) => (v.value ? `${v.name} = ${v.value}` : v.name);

const STEREOTYPE = /^(«.*»|<<.*>>)$/;

/** A class's text as a structure. */
export function parseClass(text: string): ClassModel {
  const parts = classParts(text);
  const kind = classKind(text);
  const title = parts[0].find((l) => !STEREOTYPE.test(l.trim()))?.trim() ?? "";
  const generic = /^(.*?)\s*<(.*)>$/.exec(title);
  const enumRows = kind === "enum";
  const kindLines = new Set(["«abstract»", "«interface»", "«enum»", "«enumeration»", "«record»"]);
  return {
    kind,
    stereotypes: parts[0].filter((l) => STEREOTYPE.test(l.trim()) && !kindLines.has(l.trim().toLowerCase().replace(/<<(.*)>>/, "«$1»"))),
    name: generic ? generic[1].trim() : title,
    typeParams: generic ? splitTop(generic[2]) : [],
    attributes: enumRows ? [] : parts[1].map((r) => parseAttribute(r) ?? { raw: r }),
    values: enumRows ? parts[1].map((r) => parseEnumValue(r) ?? { raw: r }) : [],
    operations: parts[2].map((r) => parseOperation(r) ?? { raw: r }),
  };
}

const STEREOTYPES: Partial<Record<ClassKind, string>> = { abstract: "«abstract»", interface: "«interface»", enum: "«enum»", record: "«record»" };

/** A class structure as the text that is stored. */
export function formatClass(c: ClassModel): string {
  const title = c.typeParams.length ? `${c.name}<${c.typeParams.join(", ")}>` : c.name;
  const stereotype = STEREOTYPES[c.kind];
  const row = <T extends object>(r: T | Raw, f: (x: T) => string) => (isRaw(r) ? r.raw : f(r));
  return classText([
    [...(stereotype ? [stereotype] : []), ...c.stereotypes, ...(title ? [title] : [])],
    c.kind === "enum" ? c.values.map((v) => row(v, formatEnumValue)) : c.attributes.map((a) => row(a, formatAttribute)),
    c.operations.map((o) => row(o, formatOperation)),
  ]);
}

/** Whether a class row is shown at a board's level of detail (as `row_shown` in crates/flow-core/src/uml). */
export function rowShown(part: number, kind: ClassKind, line: string, detail: "all" | "public" | "names" | null | undefined): boolean {
  if (!detail || detail === "all" || part === 0) return true;
  if (detail === "names") return false;
  if (part === 1 && kind === "enum") return true;
  // Attributes are private, operations public, when not written
  if (part === 1) {
    const a = parseAttribute(line);
    return !a || a.vis === "+";
  }
  const o = parseOperation(line);
  return !o || o.vis === "+" || o.vis === "";
}
