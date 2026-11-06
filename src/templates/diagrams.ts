// Built-in templates for the editorial diagram forms: org chart, timeline,
// fishbone, 2×2 matrix, pyramid, funnel, Venn, customer journey, service
// blueprint and layered architecture. Plain blocks, lines and sections, so each
// can be changed like any board; one focal block where the form has a point.

import { createNode, uid } from "../lib/store";
import type { DocContent, FlowEdge, FlowNode, NodeColor, Point } from "../lib/types";

const at = (kind: FlowNode["kind"], x: number, y: number, text: string, extra: Partial<FlowNode> = {}): FlowNode => ({
  ...createNode(kind, 0, 0),
  x,
  y,
  text,
  ...extra,
});
type End = FlowNode | Point;
const isNode = (e: End): e is FlowNode => "id" in e;
/** A line between blocks, or from or to a spot on the board */
const line = (from: End, to: End, extra: Partial<FlowEdge> = {}): FlowEdge => ({
  id: uid(),
  from: isNode(from) ? from.id : "",
  to: isNode(to) ? to.id : "",
  ...(isNode(from) ? {} : { fromPoint: from }),
  ...(isNode(to) ? {} : { toPoint: to }),
  ...extra,
});
const flow = (nodes: FlowNode[], edges: FlowEdge[] = [], camera = { x: 120, y: 100, zoom: 0.8 }): DocContent => ({
  kind: "flow",
  data: { nodes, edges, camera },
});
/** Down from the bottom of one block into the top of another, square */
const DOWN: Partial<FlowEdge> = { style: "elbow", fromAngle: 90, toAngle: 270, endCap: "none" };

/** Who reports to whom: a tree from the top, the head in focus */
export function orgChart(): DocContent {
  const ceo = at("box", 420, 0, "Sam Rivera\nCEO", { w: 180, h: 64, focal: true });
  const heads: [string, string[]][] = [
    ["Alex Kim\nEngineering", ["Platform", "Product team"]],
    ["Jo Martin\nSales", ["Enterprise", "Self-serve"]],
    ["Lee Park\nOperations", ["Support", "Finance"]],
  ];
  const nodes = [ceo];
  const edges: FlowEdge[] = [];
  heads.forEach(([name, teams], i) => {
    const head = at("box", i * 420, 150, name, { w: 180, h: 64, color: "blue" });
    nodes.push(head);
    edges.push(line(ceo, head, DOWN));
    teams.forEach((t, j) => {
      const team = at("box", i * 420 - 100 + j * 200, 300, t, { w: 180, h: 56 });
      nodes.push(team);
      edges.push(line(head, team, DOWN));
    });
  });
  return flow(nodes, edges);
}

/** Milestones along a line, alternating above and below it */
export function timeline(): DocContent {
  const steps: [string, string, NodeColor][] = [
    ["Jan", "Kick-off", "white"],
    ["Mar", "First prototype", "white"],
    ["May", "Private beta", "blue"],
    ["Aug", "Launch", "green"],
    ["Nov", "Version 2", "white"],
  ];
  const nodes: FlowNode[] = [at("bar", 0, 237, "", { w: 1120, h: 6 })];
  const edges: FlowEdge[] = [];
  steps.forEach(([when, what, color], i) => {
    const x = 80 + i * 240;
    const dot = at("start", x - 10, 230, "", { w: 20, h: 20 });
    const up = i % 2 === 0;
    const card = at("box", x - 90, up ? 80 : 320, `${when}\n${what}`, { w: 180, h: 64, color, ...(what === "Launch" ? { focal: true } : {}) });
    nodes.push(dot, card);
    edges.push(line(dot, card, { style: "straight", endCap: "none", fromAngle: up ? 270 : 90, toAngle: up ? 90 : 270 }));
  });
  return flow(nodes, edges, { x: 80, y: 120, zoom: 0.8 });
}

/** Causes of a problem: bones into a spine, the problem at the head */
export function fishbone(): DocContent {
  const head = at("box", 1000, 230, "Orders ship late", { w: 200, h: 80, color: "pink", focal: true });
  const nodes: FlowNode[] = [head];
  const edges: FlowEdge[] = [line({ x: 0, y: 270 }, head, { style: "straight" })];
  const bones: [string, string[]][] = [
    ["People", ["Too few packers", "New staff"]],
    ["Process", ["Manual stock check", "Batch picking"]],
    ["Tools", ["Slow scanner app", "No label printer"]],
    ["Suppliers", ["Late deliveries", "Wrong amounts"]],
    ["Place", ["Warehouse layout", "Far from carrier"]],
    ["Data", ["Stock counts off", "No alerts"]],
  ];
  bones.forEach(([name, causes], i) => {
    const col = i % 3;
    const up = i < 3;
    const x = 120 + col * 300;
    const label = at("box", x - 70, up ? 20 : 440, name, { w: 140, h: 44, color: "blue" });
    nodes.push(label);
    // The bone: from the category down (or up) to the spine
    edges.push(line(label, { x: x + 120, y: 270 }, { style: "straight", endCap: "none", fromAngle: up ? 90 : 270 }));
    // Each cause just right of its bone, where the bone is at that height
    causes.forEach((c, j) => {
      const y = up ? 96 + j * 64 : 300 + j * 64;
      const boneX = up ? x + (120 * (y + 16 - 42)) / 228 : x + (120 * (462 - y - 16)) / 192;
      nodes.push(at("label", boneX + 10, y, c, { w: 200, h: 32 }));
    });
  });
  return flow(nodes, edges, { x: 60, y: 80, zoom: 0.75 });
}

/** Two questions, four answers: effort and impact */
export function quadrant(): DocContent {
  const cells: [string, number, number, NodeColor][] = [
    ["Big bets", 0, 0, "blue"],
    ["Quick wins", 1, 0, "green"],
    ["Money pits", 0, 1, "pink"],
    ["Fill-ins", 1, 1, "white"],
  ];
  const nodes: FlowNode[] = [];
  const W = 380;
  const H = 280;
  for (const [title, cx, cy, color] of cells) nodes.push(at("section", 60 + cx * W, cy * H, title, { w: W - 20, h: H - 20, color }));
  const items: [string, number, number][] = [
    ["Self-serve onboarding", 120, 70],
    ["Dark mode", 520, 330],
    ["Fix the slow search", 470, 70],
    ["Rewrite the billing", 110, 350],
  ];
  for (const [t, x, y] of items) nodes.push(at("note", x, y, t, { w: 170, h: 90, color: "yellow" }));
  nodes.push(at("label", 60, 2 * H, "← More effort", { w: 160, h: 32 }), at("label", 2 * W - 120, 2 * H, "Less effort →", { w: 160, h: 32 }));
  nodes.push(at("label", -150, 110, "More impact", { w: 140, h: 32 }), at("label", -150, H + 110, "Less impact", { w: 140, h: 32 }));
  return flow(nodes);
}

/** Layers that narrow to the top: here the testing pyramid */
export function pyramid(): DocContent {
  const levels: [string, number, NodeColor][] = [
    ["End-to-end\na few, slow", 240, "pink"],
    ["Integration\nsome", 440, "yellow"],
    ["Unit tests\nmany, fast", 640, "green"],
  ];
  const nodes = levels.map(([t, w, color], i) => at("box", 320 - w / 2, i * 92, t, { w, h: 80, color }));
  nodes.push(at("callout", 700, 30, "Most checks low down, where they are cheap; a few at the top, where they are slow.", { w: 240, h: 90 }));
  return flow(nodes);
}

/** A whole that narrows step by step: where people drop off */
export function funnel(): DocContent {
  const steps: [string, number][] = [
    ["Visitors · 10,000", 720],
    ["Sign-ups · 1,200", 560],
    ["Active · 400", 400],
    ["Paying · 90", 240],
  ];
  const nodes = steps.map(([t, w], i) => at("box", 360 - w / 2, i * 92, t, { w, h: 80, color: "blue", ...(i === 2 ? { focal: true } : {}) }));
  nodes.push(at("callout", 780, 190, "Two in three sign-ups never come back: the drop most worth fixing.", { w: 240, h: 90 }));
  return flow(nodes);
}

/** Three overlapping circles: what the sets share */
export function venn(): DocContent {
  const nodes = [
    at("circle", 0, 0, "", { w: 320, h: 320, color: "blue" }),
    at("circle", 200, 0, "", { w: 320, h: 320, color: "pink" }),
    at("circle", 100, 170, "", { w: 320, h: 320, color: "green" }),
    at("label", 40, 110, "What you love", { w: 140, h: 32 }),
    at("label", 340, 110, "What pays", { w: 140, h: 32 }),
    at("label", 160, 390, "What you are good at", { w: 220, h: 32 }),
    at("label", 190, 220, "Sweet spot", { w: 140, h: 32 }),
  ];
  return flow(nodes, [], { x: 300, y: 80, zoom: 0.9 });
}

/** A customer's way through, stage by stage: doing, thinking, feeling, and where to help */
export function journey(): DocContent {
  const stages = ["Discover", "Sign up", "First use", "Pay", "Come back"];
  const pool = createNode("lanes", 0, 0, { text: "Customer journey" });
  Object.assign(pool, { x: 0, y: 0, w: stages.length * 240, h: 540 });
  pool.lanes = stages.map((title) => ({ id: uid(), title, size: 240 }));
  const rows: [string, (s: number) => FlowNode][] = [
    ["Doing", (s) => at("note", s * 240 + 30, 70, ["Reads a review", "Fills in a form", "Imports a file", "Enters a card", "Gets a reminder"][s], { w: 180, h: 90, color: "yellow", parent: pool.id })],
    ["Thinking", (s) => at("note", s * 240 + 30, 200, ["Is it for me?", "Why so many fields?", "Where do I start?", "Is it worth it?", "Oh right, that"][s], { w: 180, h: 90, color: "white", parent: pool.id })],
    ["Feeling", (s) => at("pill", s * 240 + 50, 330, ["Curious", "Annoyed", "Lost", "Unsure", "Pleased"][s], { w: 140, h: 48, color: (["green", "pink", "pink", "yellow", "green"] as NodeColor[])[s], parent: pool.id })],
    ["Chances", (s) => at("callout", s * 240 + 30, 430, ["Show real examples", "Ask less up front", "A first-run tour", "A free month", "A weekly digest"][s], { w: 190, h: 70, parent: pool.id })],
  ];
  const nodes: FlowNode[] = [pool];
  rows.forEach(([name, make], r) => {
    nodes.push(at("label", -150, [95, 225, 335, 445][r], name, { w: 130, h: 32 }));
    stages.forEach((_, s) => nodes.push(make(s)));
  });
  // The low point
  const lost = nodes.find((n) => n.text === "Lost");
  if (lost) lost.focal = true;
  return flow(nodes, [], { x: 200, y: 80, zoom: 0.7 });
}

/** What the customer sees, and what makes it happen behind the lines */
export function serviceBlueprint(): DocContent {
  const rows: [string, NodeColor, string[]][] = [
    ["Customer", "yellow", ["Orders online", "Gets a confirmation", "Receives the parcel", "Returns an item"]],
    ["Front stage", "blue", ["Web shop", "Confirmation email", "Courier", "Returns page"]],
    ["Back stage", "white", ["Order check", "Picking and packing", "Carrier booking", "Refund"]],
    ["Support", "white", ["Payment provider", "Stock system", "Carrier API", "Accounting"]],
  ];
  const lines = ["line of interaction", "line of visibility", "line of internal interaction"];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const grid: FlowNode[][] = [];
  rows.forEach(([name, color, cells], r) => {
    nodes.push(at("label", -170, r * 150 + 14, name, { w: 150, h: 32 }));
    grid.push(cells.map((t, c) => at("box", c * 240, r * 150, t, { w: 190, h: 60, color })));
    nodes.push(...grid[r]);
    if (r < lines.length) {
      const y = r * 150 + 105;
      edges.push(line({ x: -170, y }, { x: 4 * 240 - 30, y }, { style: "straight", pattern: "dashed", endCap: "none", label: lines[r], labelPos: 0.08, labelSide: "above" }));
    }
  });
  // Each step down the rows
  for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) edges.push(line(grid[r][c], grid[r + 1][c], { style: "straight", fromAngle: 90, toAngle: 270 }));
  grid[2][1].focal = true;
  return flow(nodes, edges, { x: 240, y: 80, zoom: 0.75 });
}

/** A system in layers, each using the one below */
export function layers(): DocContent {
  const tiers: [string, NodeColor, string[]][] = [
    ["Clients", "blue", ["Web app", "Mobile app", "Partner API"]],
    ["Edge", "purple", ["API gateway", "Auth"]],
    ["Services", "green", ["Orders", "Payments", "Search"]],
    ["Data", "yellow", ["Postgres", "Redis", "Object storage"]],
  ];
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const W = 760;
  let prev: FlowNode | null = null;
  tiers.forEach(([title, color, parts], i) => {
    const section = at("section", 0, i * 150, title, { w: W, h: 120, color });
    nodes.push(section);
    const step = (W - 80) / parts.length;
    const boxes = parts.map((t, j) => at("box", 40 + j * step + (step - 180) / 2, i * 150 + 46, t, { w: 180, h: 56, parent: section.id }));
    nodes.push(...boxes);
    if (title === "Services") boxes[0].focal = true;
    if (prev) edges.push(line(prev, section, { style: "straight", fromAngle: 90, toAngle: 270 }));
    prev = section;
  });
  return flow(nodes, edges);
}
