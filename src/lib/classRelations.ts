// What a line between two classes means for the code export: the same reading as
// `read_classes` in crates/flow-core/src/codegen/read.rs. Shown in the class
// panel's line inspector, so it is clear what a relation does.

import type { FlowEdge } from "./types";
import type { ClassKind } from "./umlClass";

/** Is this multiplicity more than one? (`*`, `0..*`, `1..5`), as `is_many` in read.rs */
export function isMany(label: string | null | undefined): boolean {
  if (!label) return false;
  if (label.includes("*")) return true;
  const upper = Number(label.split("..").pop()?.trim());
  return Number.isInteger(upper) && upper > 1;
}

const camel = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** As `plural` in codegen/types.rs */
const plural = (s: string) => (s.endsWith("s") ? `${s}es` : s.endsWith("y") ? `${s.slice(0, -1)}ies` : `${s}s`);

interface End {
  name: string;
  kind: ClassKind;
}

/** One sentence: what the line makes in the code (which class gets which field, or what it extends). */
export function relationMeaning(e: FlowEdge, from: End, to: End): string {
  const start = e.startCap ?? "none";
  const end = e.endCap ?? "arrow";
  const dashed = e.pattern === "dashed";
  if (end === "triangle") {
    return dashed || to.kind === "interface" ? `${from.name} implements ${to.name}.` : `${from.name} extends ${to.name}.`;
  }
  let whole: End;
  let part: End;
  let label: string | null | undefined;
  let owns = false;
  if (start === "diamond" || start === "hollowDiamond") {
    [whole, part, label, owns] = [from, to, e.endLabel, start === "diamond"];
  } else if (end === "diamond" || end === "hollowDiamond") {
    [whole, part, label, owns] = [to, from, e.startLabel, end === "diamond"];
  } else if (!dashed && (end === "arrow" || end === "open" || (start === "none" && end === "none"))) {
    [whole, part, label] = [from, to, e.endLabel];
  } else if (dashed) {
    return `${from.name} uses ${to.name} (no field in the code).`;
  } else {
    return "This line adds nothing to the code.";
  }
  if (whole.kind === "enum") return `${whole.name} is an enum: the line adds nothing to the code.`;
  const verb = owns ? "owns" : "has";
  return isMany(label)
    ? `${whole.name} ${verb} a list of ${part.name} (field ${camel(plural(part.name))}).`
    : `${whole.name} ${verb} one ${part.name} (field ${camel(part.name)}, may be empty).`;
}
