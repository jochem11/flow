import { CONTAINERS, isBuiltin } from "./classTypes";

// A UML class is stored in a node's `text`: the name, then a line with just `--`,
// the attributes, another `--`, and the operations. The editor never shows the `--`.

/** Name, attributes and operations (always at least those three), one string per row. */
export function classParts(text: string): string[][] {
  const parts: string[][] = [[]];
  for (const line of text.split("\n")) {
    if (line.trim() === "--") parts.push([]);
    else if (line.trim()) parts[parts.length - 1].push(line);
  }
  while (parts.length < 3) parts.push([]);
  return parts;
}

export const classText = (parts: string[][]) => parts.map((rows) => rows.join("\n")).join("\n--\n");

/** What a row in each compartment is called. */
export const ROW_NAMES = ["", "attribute", "operation"];

// ---------- UML notation ----------
// The same rules as the code generator (src-tauri/src/commands/codegen.rs), so
// what the editor accepts is exactly what can be turned into code:
//   attribute   [+|-|#|~] name: Type [= default]
//   operation   [+|-|#|~] name(param: Type, ...)[: ReturnType]
// `static` / `{static}` and `{abstract}` may be added. An operation returning one of
// the class's attributes (`getName(): name`) becomes a getter in the code.

export type ClassKind = "class" | "abstract" | "interface" | "enum";

const STEREOTYPES: Record<Exclude<ClassKind, "class">, string> = {
  abstract: "«abstract»",
  interface: "«interface»",
  enum: "«enum»",
};

/** Class, abstract class, interface or enum, from the «stereotype» above the name. */
export function classKind(text: string): ClassKind {
  const first = classParts(text)[0].map((l) => l.trim().toLowerCase().replace(/<<(.*)>>/, "«$1»"));
  if (first.includes("«interface»")) return "interface";
  if (first.includes("«abstract»")) return "abstract";
  if (first.includes("«enum»") || first.includes("«enumeration»")) return "enum";
  return "class";
}

/** The text with the stereotype for `kind` (and no other) above the name. */
export function withClassKind(text: string, kind: ClassKind): string {
  const parts = classParts(text);
  const name = parts[0].filter((l) => !/^(«.*»|<<.*>>)$/.test(l.trim()));
  parts[0] = kind === "class" ? name : [STEREOTYPES[kind], ...name];
  return classText(parts);
}

const isIdent = (s: string) => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s);

/** A type: `Name`, `Name<A, B>`, `Name[]` or `Name?`. */
function isType(raw: string): boolean {
  const s = raw.trim().replace(/\?$/, "").replace(/\[\]$/, "");
  const open = s.indexOf("<");
  if (open < 0) return isIdent(s);
  if (!s.endsWith(">")) return false;
  // split the arguments on top-level commas
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of s.slice(open + 1, -1)) {
    if (c === "<") depth++;
    if (c === ">") depth--;
    if (c === "," && depth === 0) {
      args.push(cur);
      cur = "";
    } else cur += c;
  }
  args.push(cur);
  return isIdent(s.slice(0, open)) && args.every(isType);
}

/** Visibility, `static`, `{abstract}` taken off the front of a row. */
function stripModifiers(line: string): string {
  return line
    .trim()
    .replace(/^[+\-#~]\s*/, "")
    .replace(/\{static\}|\{abstract\}|^static\s+/g, "")
    .trim();
}

export function isAttribute(line: string): boolean {
  const decl = stripModifiers(line).split("=")[0];
  const colon = decl.indexOf(":");
  if (colon < 0) return false;
  return isIdent(decl.slice(0, colon).trim().replace(/^\//, "")) && isType(decl.slice(colon + 1));
}

/**
 * An operation written without its (), like `+ getName: String`, written properly:
 * `+ getName(): String`. Other rows are returned as they are.
 */
export function fixOperation(line: string): string {
  const m = /^([+\-#~]?\s*)([\p{L}_][\p{L}\p{N}_]*)\s*:\s*(.+)$/u.exec(line.trim());
  return m && !line.includes("(") ? `${m[1]}${m[2]}(): ${m[3].trim()}` : line;
}

export function isOperation(line: string): boolean {
  const s = stripModifiers(fixOperation(line));
  const open = s.indexOf("(");
  const close = s.lastIndexOf(")");
  if (open < 0 || close < open || !isIdent(s.slice(0, open).trim())) return false;
  const params = s.slice(open + 1, close).split(",").map((p) => p.trim()).filter(Boolean);
  if (!params.every((p) => p.includes(":") && isIdent(p.split(":")[0].trim()) && isType(p.slice(p.indexOf(":") + 1)))) {
    return false;
  }
  const after = s.slice(close + 1).trim();
  return after === "" || (after.startsWith(":") && isType(after.slice(1)));
}

// ---------- which types a class may use ----------
// Built-in types (fixtures/types.json, shared with the code export), the classes on
// the board (the class panel draws a line to one when it is used), and the class's
// own type parameters. An operation may also return one of the class's own
// attributes: that makes it a getter.

/** For comparing class names written in different styles: `order_line` = `OrderLine` */
export const sameName = (a: string, b: string) =>
  a.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase() === b.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();

/** The names a type is made of: `List<OrderLine>?` → [OrderLine] */
function typeNames(type: string): string[] {
  return (type.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []).filter((w) => !CONTAINERS.has(w.toLowerCase()));
}

/** What a class may refer to: its own name, the classes on the board, and its attributes. */
export interface ClassContext {
  self: string;
  /** The classes on the board (and the class's type parameters) */
  related: string[];
  attributes: string[];
}

/** The class name in a class node's text (the line that is not a «stereotype»). */
export const className = (text: string) => classParts(text)[0].find((l) => !/^(«.*»|<<.*>>)$/.test(l.trim()))?.trim() ?? "";

/** The attribute names in a class node's text. */
export const attributeNames = (text: string) =>
  classParts(text)[1].map((l) => stripModifiers(l).split(":")[0].trim().replace(/^\//, "")).filter(Boolean);

/** The first type in a row the class may not use, if any. */
function unknownType(types: string[], ctx: ClassContext, returnType?: string): string | null {
  // Returning one of the class's own attributes: a getter
  if (returnType && ctx.attributes.some((a) => a === returnType.trim())) {
    types = types.filter((t) => t !== returnType);
  }
  for (const t of types.flatMap(typeNames)) {
    const ok = isBuiltin(t) || sameName(t, ctx.self) || ctx.related.some((r) => sameName(t, r));
    if (!ok) return t;
  }
  return null;
}

const unknownMessage = (t: string, operation: boolean) =>
  `"${t}" is not known here: use a built-in type (int, string, bool, decimal, date, …) or a class on this board` +
  `${operation ? ", or one of its attributes to return it" : ""}`;

/** The types used in an attribute row, and in an operation row (with its return type apart). */
function attributeType(line: string): string {
  const decl = stripModifiers(line).split("=")[0];
  return decl.slice(decl.indexOf(":") + 1).trim();
}
function operationTypes(line: string): { params: string[]; ret?: string } {
  const s = stripModifiers(fixOperation(line));
  const open = s.indexOf("(");
  const close = s.lastIndexOf(")");
  const params = s
    .slice(open + 1, close)
    .split(",")
    .filter((p) => p.includes(":"))
    .map((p) => p.slice(p.indexOf(":") + 1).trim());
  const after = s.slice(close + 1).trim();
  return { params, ret: after.startsWith(":") ? after.slice(1).trim() : undefined };
}

/**
 * What is wrong with a row, or null when it is fine. `part` 1 is attributes
 * (enum values for an enum), 2 is operations. With `ctx`, the types are checked too.
 */
export function rowProblem(kind: ClassKind, part: number, line: string, ctx?: ClassContext): string | null {
  if (kind === "enum" && part === 1) {
    return isIdent(line.trim().replace(/^[+\-#~]\s*/, "")) ? null : "An enum value is a single name, e.g. Paid";
  }
  if (part === 1 && kind !== "enum") {
    if (!isAttribute(line)) return "Write an attribute as: - name: Type = default (the default is optional)";
    const bad = ctx && unknownType([attributeType(line)], ctx);
    return bad ? unknownMessage(bad, false) : null;
  }
  if (part === 2) {
    if (!isOperation(line)) return "Write an operation as: + name(param: Type): ReturnType";
    const { params, ret } = operationTypes(line);
    const bad = ctx && unknownType(ret ? [...params, ret] : params, ctx, ret);
    return bad ? unknownMessage(bad, true) : null;
  }
  return null;
}
