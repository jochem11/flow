// What a line between two classes means in UML, as one sentence: shown in the
// class panel's line inspector, so it is clear what a relation says.

import type { FlowEdge } from "./types";
import type { ClassKind } from "./umlClass";

/** Is this multiplicity more than one? (`*`, `0..*`, `1..5`) */
export function isMany(label: string | null | undefined): boolean {
  if (!label) return false;
  if (label.includes("*")) return true;
  const upper = Number(label.split("..").pop()?.trim());
  return Number.isInteger(upper) && upper > 1;
}

interface End {
  name: string;
  kind: ClassKind;
}

/** One sentence: what the line says (which class holds which, or what it extends). */
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
    return `${from.name} uses ${to.name} (a dependency).`;
  } else {
    return "This line does not say how the classes relate.";
  }
  if (whole.kind === "enum") return `${whole.name} is an enum: it holds no other classes.`;
  const verb = owns ? "owns" : "has";
  return isMany(label) ? `${whole.name} ${verb} a list of ${part.name}.` : `${whole.name} ${verb} one ${part.name} (or none).`;
}
