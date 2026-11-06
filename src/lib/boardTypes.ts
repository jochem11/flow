// Board types: what a board is for, and so what it shows. A flow board has a
// `diagram` type (FlowDoc.diagram); text documents, kanban boards and EER diagrams
// are types of their own. One list drives the new-board picker, the toolbar, the
// context bar, the top bar and the icons in the sidebar, so a sequence diagram
// only offers what a sequence diagram needs.
//
// A flow board without a type (made before types existed) is a whiteboard: it
// shows every tool, as all boards did.

import type { DiagramType, DocumentKind } from "./types";
import type { Tool } from "./store";

export type BoardTypeId = DiagramType | "text" | "kanban" | "eer" | "chart";

/** A tool on a typed board, with the name it has there (on a state machine a pill is a "State") */
export interface TypeTool {
  tool: Tool;
  label?: string;
}

export interface BoardType {
  id: BoardTypeId;
  kind: DocumentKind;
  /** For a flow board: its FlowDoc.diagram */
  diagram?: DiagramType;
  label: string;
  /** One line in the new-board picker */
  description: string;
  /** Name of a new blank board */
  newName: string;
  /** Toolbar groups (select comes first by itself); missing: every tool (the whiteboard) */
  tools?: TypeTool[][];
  /** UML arrow presets for lines (class relations and the like) */
  umlLines: boolean;
  /** Code from classes, and classes from code */
  code: boolean;
  /** What to do first, on an empty board */
  hint: string;
}

const NOTES: TypeTool[] = [{ tool: "note" }, { tool: "label" }, { tool: "callout" }];

export const BOARD_TYPES: BoardType[] = [
  {
    id: "flowchart",
    kind: "flow",
    diagram: "flowchart",
    label: "Flowchart",
    description: "Steps, decisions and swimlanes",
    newName: "Flowchart",
    tools: [
      [{ tool: "box", label: "Step" }, { tool: "diamond" }, { tool: "pill" }, { tool: "start" }, { tool: "end" }],
      NOTES,
      [{ tool: "line" }],
      [{ tool: "section" }, { tool: "lanes" }],
    ],
    umlLines: false,
    code: false,
    hint: "Press R for a step and D for a decision; drag from a block's edge to connect it.",
  },
  {
    id: "mindmap",
    kind: "flow",
    diagram: "mindmap",
    label: "Mind map",
    description: "Ideas branching from a center",
    newName: "Mind map",
    tools: [[{ tool: "topic" }], NOTES, [{ tool: "line" }], [{ tool: "section" }]],
    umlLines: false,
    code: false,
    hint: "Press M for a topic, then Tab for a subtopic and Enter for the next one.",
  },
  {
    id: "sequence",
    kind: "flow",
    diagram: "sequence",
    label: "Sequence diagram",
    description: "Messages between participants over time",
    newName: "Sequence diagram",
    tools: [
      [{ tool: "lifeline" }],
      [{ tool: "activation" }, { tool: "fragment" }, { tool: "destroy" }],
      [{ tool: "comment" }, { tool: "label" }],
      [{ tool: "line" }],
    ],
    umlLines: false,
    code: false,
    hint: "Add lifelines, then drag from one lifeline's dashed line to another for a message.",
  },
  {
    id: "class",
    kind: "flow",
    diagram: "class",
    label: "Class diagram",
    description: "UML classes, relations and code",
    newName: "Class diagram",
    tools: [[{ tool: "class" }, { tool: "package" }], [{ tool: "comment" }, { tool: "label" }], [{ tool: "line" }]],
    umlLines: true,
    code: true,
    hint: "Add a class, then connect classes and pick the relation from the line's “UML” menu.",
  },
  {
    id: "usecase",
    kind: "flow",
    diagram: "usecase",
    label: "Use case diagram",
    description: "Actors and what they do with a system",
    newName: "Use case diagram",
    tools: [[{ tool: "actor" }, { tool: "usecase" }, { tool: "boundary" }], [{ tool: "comment" }, { tool: "label" }], [{ tool: "line" }]],
    umlLines: true,
    code: false,
    hint: "Draw the system boundary, put use cases in it and actors around it.",
  },
  {
    id: "activity",
    kind: "flow",
    diagram: "activity",
    label: "Activity diagram",
    description: "UML actions, forks, joins and signals",
    newName: "Activity diagram",
    tools: [
      [{ tool: "start" }, { tool: "box", label: "Action" }, { tool: "diamond", label: "Decision / merge" }, { tool: "bar" }, { tool: "end" }, { tool: "flowfinal" }],
      [{ tool: "object" }, { tool: "pin" }, { tool: "sendsignal" }, { tool: "receivesignal" }, { tool: "timeevent" }],
      [{ tool: "lanes", label: "Partitions" }, { tool: "comment" }],
      [{ tool: "line" }],
    ],
    umlLines: true,
    code: false,
    hint: "Start with a start point (S), then actions (R); a bar forks or joins.",
  },
  {
    id: "state",
    kind: "flow",
    diagram: "state",
    label: "State machine",
    description: "States and the transitions between them",
    newName: "State machine",
    tools: [
      [{ tool: "start", label: "Initial state" }, { tool: "pill", label: "State" }, { tool: "diamond", label: "Choice" }, { tool: "end", label: "Final state" }],
      [{ tool: "section", label: "Composite state" }, { tool: "circle", label: "History" }],
      [{ tool: "comment" }, { tool: "label" }],
      [{ tool: "line" }],
    ],
    umlLines: true,
    code: false,
    hint: "Press S for the initial state and P for a state; label each transition with its event.",
  },
  {
    id: "whiteboard",
    kind: "flow",
    diagram: "whiteboard",
    label: "Whiteboard",
    description: "Every shape, for anything else",
    newName: "Whiteboard",
    umlLines: true,
    code: true,
    hint: "Every tool is here: blocks on the left, UML shapes under the UML button.",
  },
  {
    id: "text",
    kind: "text",
    label: "Document",
    description: "Text with headings, lists and tables",
    newName: "Untitled",
    umlLines: false,
    code: false,
    hint: "",
  },
  {
    id: "kanban",
    kind: "kanban",
    label: "Kanban board",
    description: "Cards moving through columns",
    newName: "Kanban board",
    umlLines: false,
    code: false,
    hint: "",
  },
  {
    id: "chart",
    kind: "chart",
    label: "Chart",
    description: "Columns, lines, areas and shares from a table",
    newName: "Chart",
    umlLines: false,
    code: false,
    hint: "",
  },
  {
    id: "eer",
    kind: "eer",
    label: "EER diagram",
    description: "Database tables, keys and SQL",
    newName: "EER diagram",
    umlLines: false,
    code: false,
    hint: "",
  },
];

const BY_ID = new Map(BOARD_TYPES.map((t) => [t.id, t]));

/** A board type by its id. */
export const boardType = (id: BoardTypeId): BoardType => BY_ID.get(id)!;

/** The type of a board: its kind, and for a flow board its diagram type (missing: a whiteboard). */
export function boardTypeOf(kind: DocumentKind, diagram?: DiagramType | null): BoardType {
  return BY_ID.get(kind === "flow" ? (diagram ?? "whiteboard") : kind)!;
}

/** Whether a board of this type offers this tool (select always). */
export function offersTool(type: BoardType, tool: Tool): boolean {
  return tool === "select" || !type.tools || type.tools.some((g) => g.some((t) => t.tool === tool));
}

/** The flow board types, then the others: the groups of the new-board picker. */
export const PICKER_GROUPS: { title: string; types: BoardType[] }[] = [
  { title: "Diagrams", types: BOARD_TYPES.filter((t) => t.kind === "flow") },
  { title: "Documents and boards", types: BOARD_TYPES.filter((t) => t.kind !== "flow") },
];
