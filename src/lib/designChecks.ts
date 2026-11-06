// Checks on a diagram, like the EER board's schema checks (eerChecks.ts): what
// makes it hard to read or likely wrong. Per board type, as each kind of diagram
// has its own rules (a decision needs two ways out, a state must be reachable, a
// class name is used once). A whiteboard is free-form: nothing is checked.
// Pure: the board in, the problems out.

import { parseClass } from "./classModel";
import type { DiagramType, FlowEdge, FlowNode, NodeKind } from "./types";

export interface DesignProblem {
  /** The blocks it is about (to select and show them) */
  nodeIds: string[];
  message: string;
  /** warning: likely wrong; tip: worth a look */
  level: "warning" | "tip";
}

/** Blocks that are steps of a flow: they are meant to be joined by lines */
const STEPS: NodeKind[] = ["box", "diamond", "pill", "start", "end", "bar", "flowfinal", "object", "sendsignal", "receivesignal", "timeevent", "usecase", "actor", "topic"];
/** Frames that group blocks */
const GROUPS: NodeKind[] = ["section", "lanes", "boundary", "package"];

/** More focal blocks than this, and nothing stands out */
export const MAX_FOCAL = 2;

/** More blocks than this in one group (or on a board without groups) is a lot to take in at once */
export const MAX_PER_GROUP = 12;

const name = (n: FlowNode) => {
  const t = n.text.trim().split("\n")[0];
  return t ? `“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”` : `a ${n.kind === "diamond" ? "decision" : "block"} without text`;
};

export function checkDesign(nodes: FlowNode[], edges: FlowEdge[], diagram: DiagramType | null | undefined): DesignProblem[] {
  const type = diagram ?? "whiteboard";
  if (type === "whiteboard" || !nodes.length) return [];
  const out: DesignProblem[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const lines = edges.filter((e) => e.messageY == null);
  const outs = new Map<string, FlowEdge[]>();
  const ins = new Map<string, FlowEdge[]>();
  for (const e of lines) {
    if (byId.has(e.from)) outs.set(e.from, [...(outs.get(e.from) ?? []), e]);
    if (byId.has(e.to)) ins.set(e.to, [...(ins.get(e.to) ?? []), e]);
  }
  const degree = (id: string) => (outs.get(id)?.length ?? 0) + (ins.get(id)?.length ?? 0);

  // Focus works by contrast: with many in focus, none is
  const focal = nodes.filter((n) => n.focal);
  if (focal.length > MAX_FOCAL)
    out.push({ nodeIds: focal.map((n) => n.id), level: "tip", message: `${focal.length} blocks are in focus: one or two stand out, more do not` });

  if (type === "class") return checkClasses(nodes, out);
  if (type === "sequence") return checkSequence(nodes, edges, out);

  const steps = nodes.filter((n) => STEPS.includes(n.kind));

  // Not joined to anything, while the rest is
  if (lines.length) {
    for (const n of steps) {
      if (degree(n.id) === 0) out.push({ nodeIds: [n.id], level: "tip", message: `${name(n)} is not joined to anything` });
    }
  }

  if (type === "flowchart" || type === "activity" || type === "state") {
    for (const n of steps) {
      const o = outs.get(n.id) ?? [];
      const i = ins.get(n.id) ?? [];
      if (n.kind === "diamond") {
        // A merge (several in, one out) is fine; a decision needs two ways out
        const merge = i.length >= 2 && o.length === 1;
        if (!merge && o.length === 1) out.push({ nodeIds: [n.id], level: "warning", message: `${name(n)} has only one way out: a decision needs two or more` });
        if (o.length >= 2 && o.some((e) => !e.label?.trim()) && type !== "state")
          out.push({ nodeIds: [n.id], level: "tip", message: `Say which way is which out of ${name(n)} (yes / no on its lines)` });
      }
      if (n.kind === "start" && i.length) out.push({ nodeIds: [n.id], level: "warning", message: "A line goes into the start" });
      if ((n.kind === "end" || n.kind === "flowfinal") && o.length) out.push({ nodeIds: [n.id], level: "warning", message: "A line leaves an end" });
      if (!n.text.trim() && ["box", "diamond", "pill", "usecase"].includes(n.kind))
        out.push({ nodeIds: [n.id], level: "tip", message: `A ${n.kind === "diamond" ? "decision" : "block"} has no text` });
    }

    // What can be reached from the start (when there is one)
    const starts = nodes.filter((n) => n.kind === "start");
    if (starts.length) {
      const seen = new Set(starts.map((n) => n.id));
      const todo = [...seen];
      while (todo.length) {
        const id = todo.pop()!;
        // Its lines, and those of the frames it is in (a line out of a section
        // leaves each block in it); a line into a frame reaches what is in it
        const next = (outs.get(id) ?? []).map((e) => e.to);
        for (let p = byId.get(id)?.parent; p; p = byId.get(p)?.parent) next.push(...(outs.get(p) ?? []).map((e) => e.to));
        if (GROUPS.includes(byId.get(id)?.kind as NodeKind)) next.push(...nodes.filter((n) => n.parent === id).map((n) => n.id));
        for (const t of next) {
          if (!seen.has(t)) {
            seen.add(t);
            todo.push(t);
          }
        }
      }
      const unreachable = steps.filter((n) => !seen.has(n.id) && degree(n.id) > 0 && n.kind !== "start");
      if (unreachable.length)
        out.push({
          nodeIds: unreachable.map((n) => n.id),
          level: type === "state" ? "warning" : "tip",
          message:
            unreachable.length === 1
              ? `${name(unreachable[0])} can't be reached from the start`
              : `${unreachable.length} ${type === "state" ? "states" : "blocks"} can't be reached from the start`,
        });
    }
  }

  // Too much in one group to read at a glance
  const groups = nodes.filter((n) => GROUPS.includes(n.kind));
  for (const g of groups) {
    const inside = steps.filter((n) => n.parent === g.id);
    if (inside.length > MAX_PER_GROUP)
      out.push({ nodeIds: [g.id], level: "tip", message: `${name(g)} holds ${inside.length} blocks: split it, so each part reads at a glance` });
  }
  const loose = steps.filter((n) => !n.parent);
  if (!groups.length && loose.length > MAX_PER_GROUP * 2 && type !== "mindmap")
    out.push({ nodeIds: [], level: "tip", message: `${loose.length} blocks without sections: grouping them helps the eye` });

  return out;
}

function checkClasses(nodes: FlowNode[], out: DesignProblem[]): DesignProblem[] {
  const classes = nodes.filter((n) => n.kind === "class");
  const seen = new Map<string, FlowNode>();
  for (const n of classes) {
    const m = parseClass(n.text);
    const key = m.name.trim().toLowerCase();
    if (!key) {
      out.push({ nodeIds: [n.id], level: "warning", message: "A class has no name" });
      continue;
    }
    const twin = seen.get(key);
    if (twin) out.push({ nodeIds: [twin.id, n.id], level: "warning", message: `There are two classes called ${m.name}` });
    else seen.set(key, n);
    if (m.kind === "interface" && m.attributes.length) out.push({ nodeIds: [n.id], level: "tip", message: `The interface ${m.name} has attributes: interfaces usually only have operations` });
    if (m.kind === "enum" && !m.values.length) out.push({ nodeIds: [n.id], level: "tip", message: `The enum ${m.name} has no values` });
  }
  return out;
}

function checkSequence(nodes: FlowNode[], edges: FlowEdge[], out: DesignProblem[]): DesignProblem[] {
  const lifelines = nodes.filter((n) => n.kind === "lifeline");
  const messages = edges.filter((e) => e.messageY != null);
  const used = new Set(messages.flatMap((e) => [e.from, e.to]));
  if (messages.length) {
    for (const n of lifelines) if (!used.has(n.id)) out.push({ nodeIds: [n.id], level: "tip", message: `${name(n)} sends and gets no messages` });
  }
  const names = new Map<string, FlowNode>();
  for (const n of lifelines) {
    const key = n.text.trim().toLowerCase();
    if (!key) continue;
    const twin = names.get(key);
    if (twin) out.push({ nodeIds: [twin.id, n.id], level: "tip", message: `Two lifelines are called ${name(n)}` });
    else names.set(key, n);
  }
  const unnamed = messages.filter((e) => !e.label?.trim() && e.pattern !== "dashed");
  if (unnamed.length)
    out.push({
      nodeIds: [...new Set(unnamed.flatMap((e) => [e.from, e.to]))],
      level: "tip",
      message: unnamed.length === 1 ? "A call has no name" : `${unnamed.length} calls have no name`,
    });
  return out;
}
