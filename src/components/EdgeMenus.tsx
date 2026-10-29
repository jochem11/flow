// The parts of the edge bar: line styles, arrowheads, UML relations, label sides, end texts.

import { For, type JSX } from "solid-js";
import type { EdgeCap, EdgeStyle, FlowEdge, LabelSide, LinePattern } from "../lib/types";
import { checkpoint, DEFAULT_CAPS, setEdgeProps, setEndLabel } from "../lib/store";
import { Menu } from "./Menu";
import { IconCap, IconEndLabels, IconCurved, IconElbow, IconStraight } from "./icons";

export const STYLES: { style: EdgeStyle; title: string; icon: () => JSX.Element }[] = [
  { style: "curved", title: "Curved", icon: IconCurved },
  { style: "straight", title: "Straight", icon: IconStraight },
  { style: "elbow", title: "Right angles", icon: IconElbow },
];

export const PATTERN_NAMES: Record<LinePattern, string> = { solid: "solid", dashed: "dashed", dotted: "dotted" };
export const NEXT_PATTERN: Record<LinePattern, LinePattern> = { solid: "dashed", dashed: "dotted", dotted: "solid" };

export const CAPS: { cap: EdgeCap; name: string }[] = [
  { cap: "none", name: "Nothing" },
  { cap: "arrow", name: "Arrow" },
  { cap: "open", name: "Open arrow" },
  { cap: "triangle", name: "Hollow triangle" },
  { cap: "diamond", name: "Filled diamond" },
  { cap: "hollowDiamond", name: "Hollow diamond" },
  { cap: "dot", name: "Dot" },
];

type Relation = { name: string; hint: string; props: Partial<FlowEdge> };

/** UML relationships and messages: sets the line and both ends in one go. */
export const RELATIONS: Relation[][] = [
  [
    { name: "Association", hint: "class", props: { pattern: "solid", startCap: "none", endCap: "none" } },
    { name: "Directed association", hint: "class", props: { pattern: "solid", startCap: "none", endCap: "open" } },
    { name: "Generalization", hint: "inherits", props: { pattern: "solid", startCap: "none", endCap: "triangle" } },
    { name: "Realization", hint: "implements", props: { pattern: "dashed", startCap: "none", endCap: "triangle" } },
    { name: "Dependency", hint: "uses", props: { pattern: "dashed", startCap: "none", endCap: "open" } },
    { name: "Aggregation", hint: "has", props: { pattern: "solid", startCap: "hollowDiamond", endCap: "none" } },
    { name: "Composition", hint: "owns", props: { pattern: "solid", startCap: "diamond", endCap: "none" } },
  ],
  [
    { name: "Include", hint: "use case", props: { pattern: "dashed", startCap: "none", endCap: "open", label: "«include»" } },
    { name: "Extend", hint: "use case", props: { pattern: "dashed", startCap: "none", endCap: "open", label: "«extend»" } },
  ],
  [
    { name: "Synchronous message", hint: "sequence", props: { pattern: "solid", startCap: "none", endCap: "arrow", style: "straight" } },
    { name: "Asynchronous message", hint: "sequence", props: { pattern: "solid", startCap: "none", endCap: "open", style: "straight" } },
    { name: "Reply message", hint: "sequence", props: { pattern: "dashed", startCap: "none", endCap: "open", style: "straight" } },
  ],
  [
    { name: "Control flow", hint: "activity", props: { pattern: "solid", startCap: "none", endCap: "arrow" } },
    { name: "Note link", hint: "comment", props: { pattern: "dashed", startCap: "none", endCap: "none" } },
  ],
];

export const SIDE_NAMES: Record<LabelSide, string> = { on: "on the line", above: "above the line", below: "below the line" };
export const NEXT_SIDE: Record<LabelSide, LabelSide> = { on: "above", above: "below", below: "on" };

/** Texts at both ends of an edge: multiplicities ("1", "0..*") or role names. */
export function EndLabelsMenu(p: { edge: FlowEdge }) {
  const field = (end: "start" | "end") => (
    <label class="end-label-field">
      <span>{end === "start" ? "Start" : "End"}</span>
      <input
        class="rename-input"
        value={(end === "start" ? p.edge.startLabel : p.edge.endLabel) ?? ""}
        placeholder={end === "start" ? "1" : "0..*"}
        // Saved while typing, so nothing is lost when the menu closes; one undo step per field
        onFocus={checkpoint}
        onInput={(e) => setEndLabel(p.edge.id, end, e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
  return (
    <Menu
      button={(toggle, open) => (
        <button
          class="icon-btn"
          classList={{ pressed: open() }}
          title="Texts at the ends (multiplicity, role)"
          onClick={toggle}
        >
          <IconEndLabels />
        </button>
      )}
    >
      {() => (
        <>
          <div class="menu-title">Multiplicity or role</div>
          {field("start")}
          {field("end")}
        </>
      )}
    </Menu>
  );
}

/** Picks what is drawn at one end of an edge. */
export function CapMenu(p: { side: "start" | "end"; edge: FlowEdge }) {
  const cap = () => (p.side === "start" ? p.edge.startCap : p.edge.endCap) ?? DEFAULT_CAPS[p.side];
  return (
    <Menu
      button={(toggle, open) => (
        <button
          class="icon-btn"
          classList={{ pressed: open() }}
          title={p.side === "start" ? "Start of the line" : "End of the line"}
          onClick={toggle}
        >
          <IconCap cap={cap()} side={p.side} />
        </button>
      )}
    >
      {(close) => (
        <For each={CAPS}>
          {(c) => (
            <button
              class="menu-item with-icon"
              classList={{ current: c.cap === cap() }}
              onClick={() => {
                setEdgeProps(p.edge.id, p.side === "start" ? { startCap: c.cap } : { endCap: c.cap });
                close();
              }}
            >
              <IconCap cap={c.cap} side="end" />
              <span>{c.name}</span>
            </button>
          )}
        </For>
      )}
    </Menu>
  );
}
