// Sequence diagrams: messages between lifelines, and the activation bars that
// follow from them. The same rules are in src-tauri/src/commands/flow_svg.rs
// (`activations`, `message_line`) for the export; keep them in step.
//
// A message is an edge with `messageY`: a horizontal line at that height below
// the top of its `from` node. It attaches to the dashed line of a lifeline, or to
// the side of its activation bar when one is active at that height.

import type { EdgeGeom, Pt } from "./geometry";
import type { FlowEdge, FlowNode, NodeKind } from "./types";

/** Nodes messages run between. An activation node is a bar placed by hand. */
export const SEQUENCE_KINDS = new Set<NodeKind>(["lifeline", "activation"]);

/** Height of a lifeline's head (see `.node-lifeline` in styles.css) */
export const LIFELINE_HEAD = 44;
/** Width of an automatic activation bar */
export const BAR_W = 14;
/** Where the bar of the lifeline that starts it all stops, above the end of its lifeline */
const BASE_END = 16;
/** How far a self-message goes out, and how much lower it comes back */
const SELF_W = 30;
export const SELF_H = 30;

/** A vertical span [top, bottom] in world coordinates. */
export type Span = [number, number];

interface Analysis {
  /** Activation bars per lifeline */
  bars: Map<string, Span[]>;
  /** Messages that answer an earlier call (drawn dashed with an open arrow in UML) */
  returns: Set<string>;
}

/**
 * Reads the messages top to bottom, the way you read a sequence diagram:
 * - a message from B back to A answers the latest open call from A to B: that is
 *   a return, solid or dashed. Any other message is a call (a dashed one that
 *   answers nothing is just a message).
 * - a call activates the lifeline it arrives at, until its return. Without a
 *   return, the bar runs to just past that lifeline's last message.
 * - a lifeline that never receives a call (the one that starts it all) is active
 *   from its first message all the way down its lifeline.
 * Overlapping bars on one lifeline (calls inside calls) merge into one.
 */
export function analyze(nodes: FlowNode[], edges: FlowEdge[]): Analysis {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const messages = edges
    .flatMap((e) => {
      const from = byId.get(e.from);
      return e.messageY != null && from && byId.has(e.to) ? [{ e, y: from.y + e.messageY }] : [];
    })
    .sort((a, b) => a.y - b.y);

  const spans = new Map<string, Span[]>();
  const add = (id: string, span: Span) => spans.set(id, [...(spans.get(id) ?? []), span]);
  /** First and last height at which each node sends or receives a message */
  const seen = new Map<string, Span>();
  const see = (id: string, y: number) => {
    const s = seen.get(id);
    seen.set(id, s ? [Math.min(s[0], y), Math.max(s[1], y)] : [y, y]);
  };
  const called = new Set<string>();
  const returns = new Set<string>();
  const open: { caller: string; callee: string; y: number }[] = [];

  for (const { e, y } of messages) {
    if (e.from === e.to) {
      see(e.from, y);
      see(e.from, y + SELF_H);
      continue;
    }
    see(e.from, y);
    see(e.to, y);
    // The latest open call this message answers
    let i = open.length - 1;
    while (i >= 0 && !(open[i].caller === e.to && open[i].callee === e.from)) i--;
    if (i >= 0) {
      add(e.from, [open[i].y, y]);
      open.splice(i, 1);
      returns.add(e.id);
    } else if (e.pattern !== "dashed") {
      open.push({ caller: e.from, callee: e.to, y });
      called.add(e.to);
    }
  }
  for (const c of open) add(c.callee, [c.y, Math.max(c.y + 30, (seen.get(c.callee)?.[1] ?? c.y) + 16)]);

  const bars = new Map<string, Span[]>();
  for (const l of nodes) {
    if (l.kind !== "lifeline") continue;
    const own = spans.get(l.id) ?? [];
    const range = seen.get(l.id);
    if (range && !called.has(l.id)) own.push([range[0] - 10, Math.max(l.y + l.h - BASE_END, range[1] + 10)]);
    // Within the lifeline, below its head; overlapping bars merged
    const top = l.y + LIFELINE_HEAD;
    const bottom = l.y + l.h;
    const merged: Span[] = [];
    for (const [a, b] of own
      .map(([a, b]): Span => [Math.max(top, a), Math.min(bottom, b)])
      .filter(([a, b]) => b > a)
      .sort((p, q) => p[0] - q[0])) {
      const last = merged[merged.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    if (merged.length) bars.set(l.id, merged);
  }
  return { bars, returns };
}

/** Activation bars per lifeline (see `analyze`). */
export const activations = (nodes: FlowNode[], edges: FlowEdge[]) => analyze(nodes, edges).bars;

/** Where a message meets node `n` at height `y`, coming from the side of `towardX`. */
function attachX(n: FlowNode, bars: Span[], y: number, towardX: number): number {
  const c = n.x + n.w / 2;
  const right = towardX >= c;
  if (n.kind === "lifeline") {
    const active = bars.some(([a, b]) => y >= a && y <= b);
    return active ? c + (right ? BAR_W / 2 : -BAR_W / 2) : c;
  }
  // An activation placed by hand, or any other block: its side
  return right ? n.x + n.w : n.x;
}

/** The line of a message: horizontal from `a` to `b`, or a small loop when a calls itself. */
export function messageLine(edge: FlowEdge, a: FlowNode, b: FlowNode, bars: Map<string, Span[]>): EdgeGeom {
  const y = a.y + (edge.messageY ?? 0);
  const barsA = bars.get(a.id) ?? [];
  if (a.id === b.id) {
    const x1 = attachX(a, barsA, y, Infinity);
    const x2 = attachX(a, barsA, y + SELF_H, Infinity);
    const out = Math.max(x1, x2) + SELF_W;
    return roundedLoop([
      { x: x1, y },
      { x: out, y },
      { x: out, y: y + SELF_H },
      { x: x2, y: y + SELF_H },
    ]);
  }
  const ca = a.x + a.w / 2;
  const cb = b.x + b.w / 2;
  const p1 = { x: attachX(a, barsA, y, cb), y };
  const p2 = { x: attachX(b, bars.get(b.id) ?? [], y, ca), y };
  return { d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`, points: [p1, p2] };
}

/** The self-message loop with slightly rounded corners. */
function roundedLoop(pts: Pt[]): EdgeGeom {
  const [p0, p1, p2, p3] = pts;
  const r = 6;
  return {
    d:
      `M ${p0.x} ${p0.y} L ${p1.x - r} ${p1.y} Q ${p1.x} ${p1.y}, ${p1.x} ${p1.y + r} ` +
      `L ${p2.x} ${p2.y - r} Q ${p2.x} ${p2.y}, ${p2.x - r} ${p2.y} L ${p3.x} ${p3.y}`,
    points: pts,
  };
}

/** The height of a message for `from` when dropped at world height `y`: below the head, within the node. */
export function messageYAt(from: FlowNode, y: number): number {
  const top = from.kind === "lifeline" ? LIFELINE_HEAD + 6 : 0;
  return Math.min(from.h - 1, Math.max(top, Math.round(y - from.y)));
}
