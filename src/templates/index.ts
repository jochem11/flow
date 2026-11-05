// Built-in templates: boards to start from, one set per kind of board. Each
// `make` returns fresh content (new ids every time). People's own templates
// come from the server (server/src/routes/templates.rs).

import { createNode, uid } from "../lib/store";
import type { Attribute, DiagramType, DocContent, DocumentKind, Entity, FlowEdge, FlowNode, KanbanCard, KanbanColumn, NodeColor, Relation } from "../lib/types";

export interface BuiltIn {
  id: string;
  kind: DocumentKind;
  /** For a flow board: the board type it is a template for */
  diagram?: DiagramType;
  name: string;
  description: string;
  make: () => DocContent;
}

// ---------- flowcharts ----------

const at = (kind: FlowNode["kind"], x: number, y: number, text: string, extra: Partial<FlowNode> = {}): FlowNode => ({
  ...createNode(kind, 0, 0),
  x,
  y,
  text,
  ...extra,
});
const line = (from: FlowNode, to: FlowNode, extra: Partial<FlowEdge> = {}): FlowEdge => ({ id: uid(), from: from.id, to: to.id, ...extra });
const flow = (nodes: FlowNode[], edges: FlowEdge[] = []): DocContent => ({ kind: "flow", data: { nodes, edges, camera: { x: 120, y: 100, zoom: 0.9 } } });

function flowchart(): DocContent {
  const start = at("pill", 10, 0, "Start", { color: "green" });
  const step = at("box", 0, 120, "Do the work");
  const check = at("diamond", 0, 240, "Done?", { color: "blue" });
  const fix = at("box", 280, 270, "Fix what is missing", { color: "pink" });
  const end = at("pill", 10, 440, "End", { color: "green" });
  return flow(
    [start, step, check, fix, end],
    [line(start, step), line(step, check), line(check, end, { label: "Yes" }), line(check, fix, { label: "No" }), line(fix, step)],
  );
}

function swimlanes(): DocContent {
  const pool = createNode("lanes", 0, 0, { text: "Order process" });
  pool.x = 0;
  pool.y = 0;
  pool.w = 960;
  pool.h = 520;
  pool.lanes = ["Customer", "Sales", "Warehouse"].map((title) => ({ id: uid(), title, size: 320 }));
  const inLane = (lane: number, y: number, kind: FlowNode["kind"], text: string, color?: NodeColor) =>
    at(kind, lane * 320 + 70, y, text, { parent: pool.id, ...(color ? { color } : {}) });
  const order = inLane(0, 90, "pill", "Places an order", "green");
  const check = inLane(1, 190, "diamond", "In stock?", "blue");
  const confirm = inLane(1, 360, "box", "Confirms the order");
  const pick = inLane(2, 220, "box", "Picks and packs");
  const ship = inLane(2, 360, "box", "Ships it");
  const receive = inLane(0, 420, "pill", "Receives it", "green");
  return flow(
    [pool, order, check, confirm, pick, ship, receive],
    [line(order, check), line(check, pick, { label: "Yes" }), line(check, confirm, { label: "No: backorder" }), line(pick, ship), line(ship, receive)],
  );
}

function storyMap(): DocContent {
  const activities = [
    { title: "Sign up", stories: ["Create an account", "Confirm email", "Log in with Google"] },
    { title: "Find products", stories: ["Search", "Filter by category", "Save favourites"] },
    { title: "Buy", stories: ["Add to cart", "Pay", "Track the order"] },
  ];
  const nodes: FlowNode[] = [];
  activities.forEach((a, i) => {
    const section = at("section", i * 300, 0, a.title, { w: 260, h: 560 });
    nodes.push(section);
    a.stories.forEach((s, j) => nodes.push(at("note", section.x + 40, 70 + j * 160, s, { w: 180, h: 120, parent: section.id, color: j === 0 ? "yellow" : "white" })));
  });
  nodes.push(at("label", -200, 90, "Release 1"), at("label", -200, 250, "Release 2"), at("label", -200, 410, "Later"));
  return flow(nodes);
}

function retrospective(): DocContent {
  const cols: [string, NodeColor, string[]][] = [
    ["Went well", "green", ["Shipped on time", "Good pairing"]],
    ["To improve", "pink", ["Too many meetings", "Flaky tests"]],
    ["Actions", "blue", ["Fix the flaky tests (Ann)", "Meeting-free Wednesdays"]],
  ];
  const nodes: FlowNode[] = [];
  cols.forEach(([title, color, notes], i) => {
    const section = at("section", i * 340, 0, title, { w: 300, h: 520, color });
    nodes.push(section);
    notes.forEach((n, j) => nodes.push(at("note", section.x + 40, 70 + j * 170, n, { w: 220, h: 130, color: "yellow", parent: section.id })));
  });
  return flow(nodes);
}

// ---------- EER ----------

function shop(): DocContent {
  const col = (name: string, dataType: Attribute["dataType"], extra: Partial<Attribute> = {}): Attribute => ({
    id: uid(),
    name,
    dataType,
    primaryKey: false,
    nullable: true,
    unique: false,
    autoIncrement: false,
    ...extra,
  });
  const key = () => col("id", "int", { primaryKey: true, nullable: false, autoIncrement: true });
  const table = (name: string, x: number, y: number, attributes: Attribute[]): Entity => ({ id: uid(), name, x, y, attributes });
  const customer = table("customer", 0, 60, [key(), col("name", "varchar", { length: 120, nullable: false }), col("email", "varchar", { unique: true })]);
  const orderId = col("customer_id", "int", { nullable: false });
  const order = table("orders", 380, 60, [key(), orderId, col("placed_at", "timestamp", { nullable: false })]);
  const lineOrder = col("order_id", "int", { nullable: false });
  const lineProduct = col("product_id", "int", { nullable: false });
  const orderLine = table("order_line", 380, 300, [key(), lineOrder, lineProduct, col("quantity", "int", { nullable: false })]);
  const product = table("product", 760, 300, [key(), col("name", "varchar", { nullable: false }), col("price", "decimal", { length: 10, scale: 2 })]);
  const rel = (from: Entity, fk: Attribute, to: Entity): Relation => ({
    id: uid(),
    from: from.id,
    to: to.id,
    fromCardinality: "many",
    toCardinality: "one",
    columns: [{ from: fk.id, to: to.attributes[0].id }],
    onDelete: "noAction",
    onUpdate: "noAction",
  });
  return {
    kind: "eer",
    data: {
      entities: [customer, order, orderLine, product],
      relations: [rel(order, orderId, customer), rel(orderLine, lineOrder, order), rel(orderLine, lineProduct, product)],
      sections: [{ id: uid(), title: "Sales", x: -30, y: 0, w: 720, h: 230 }],
      camera: { x: 100, y: 100, zoom: 0.9 },
    },
  };
}

// ---------- kanban ----------

const card = (title: string, extra: Partial<KanbanCard> = {}): KanbanCard => ({
  id: uid(),
  title,
  description: "",
  labelIds: [],
  comments: [],
  timeEntries: [],
  ...extra,
});
const column = (title: string, cards: KanbanCard[] = [], extra: Partial<KanbanColumn> = {}): KanbanColumn => ({ id: uid(), title, done: false, cards, ...extra });

function scrum(): DocContent {
  const labels = [
    { id: uid(), name: "Feature", color: "blue" as NodeColor, description: "" },
    { id: uid(), name: "Bug", color: "pink" as NodeColor, description: "" },
    { id: uid(), name: "Chore", color: "white" as NodeColor, description: "" },
  ];
  return {
    kind: "kanban",
    data: {
      labels,
      columns: [
        column("Backlog", [card("Search for products", { labelIds: [labels[0].id], priority: "medium" }), card("Update dependencies", { labelIds: [labels[2].id], priority: "low" })]),
        column("Sprint", [card("Checkout page", { labelIds: [labels[0].id], priority: "high", expectedHours: 8 })]),
        column("In progress", [card("Login fails on Safari", { labelIds: [labels[1].id], priority: "urgent" })], { color: "blue" }),
        column("Review", [], { color: "purple" }),
        column("Done", [], { done: true, color: "green" }),
      ],
    },
  };
}

function bugs(): DocContent {
  const labels = [
    { id: uid(), name: "Critical", color: "pink" as NodeColor, description: "Blocks people from working" },
    { id: uid(), name: "Major", color: "yellow" as NodeColor, description: "" },
    { id: uid(), name: "Minor", color: "white" as NodeColor, description: "" },
  ];
  const template = "**Steps to reproduce**\n1. \n\n**Expected**\n\n**Actual**\n";
  return {
    kind: "kanban",
    data: {
      labels,
      columns: [
        column("New", [card("Example: export fails for big boards", { description: template, labelIds: [labels[1].id] })]),
        column("Triaged"),
        column("Fixing", [], { color: "blue" }),
        column("Verify", [], { color: "purple" }),
        column("Closed", [], { done: true, color: "green" }),
      ],
    },
  };
}

// ---------- text ----------

const text = (markdown: string): DocContent => ({ kind: "text", data: { markdown } });

const MEETING = `# Meeting: <topic>

**Date:**  
**Present:**  

## Agenda
1. 
2. 

## Notes

## Decisions
- 

## Action items
- [ ] <what> — <who>, <when>
`;

const SPEC = `# <Feature name>

## Problem
What is wrong now, and for whom?

## Goal
What changes when this is done? How do we know it worked?

## Proposal
How it works, step by step.

## Out of scope
- 

## Open questions
- [ ] 
`;

export const BUILT_IN: BuiltIn[] = [
  { id: "flowchart", kind: "flow", diagram: "flowchart", name: "Flowchart", description: "Start, steps, a decision and a loop back", make: flowchart },
  { id: "swimlanes", kind: "flow", diagram: "flowchart", name: "Swimlane process", description: "A process across three roles", make: swimlanes },
  { id: "story-map", kind: "flow", diagram: "whiteboard", name: "User story map", description: "Activities across, stories below, releases as rows", make: storyMap },
  { id: "retro", kind: "flow", diagram: "whiteboard", name: "Retrospective", description: "Went well, to improve, actions", make: retrospective },
  { id: "shop", kind: "eer", name: "Web shop", description: "Customers, orders, order lines and products", make: shop },
  { id: "scrum", kind: "kanban", name: "Scrum board", description: "Backlog to done, with labels and priorities", make: scrum },
  { id: "bugs", kind: "kanban", name: "Bug tracker", description: "From new to closed, labelled by severity", make: bugs },
  { id: "meeting", kind: "text", name: "Meeting notes", description: "Agenda, notes, decisions, action items", make: () => text(MEETING) },
  { id: "spec", kind: "text", name: "Feature spec", description: "Problem, goal, proposal, open questions", make: () => text(SPEC) },
];
