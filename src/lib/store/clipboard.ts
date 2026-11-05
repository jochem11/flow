// Copy, cut and paste on a flowchart. What is copied goes on the system clipboard
// twice: as Flow's own data (so it can be pasted on another board, also in another
// tab) and as plain text (the blocks' text, for pasting anywhere else). Pasting
// plain text from elsewhere makes a block of every line.

import { batch } from "solid-js";
import { bounds } from "../geometry";
import type { FlowEdge, FlowNode } from "../types";
import { addNode, deleteSelection, insertCopies, select } from "./edit";
import { assignParents, growFrames, withContents } from "./frames";
import { checkpoint } from "./history";
import { createNode, GRID, snap } from "./nodes";
import { board, setBoard, touch, ui } from "./state";

/** The clipboard type of Flow's own data */
export const FLOW_MIME = "application/x-flow";

export interface FlowClip {
  kind: "flow";
  /** The board it was copied from: images pasted on another board get a copy of their file */
  docId?: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** The last thing copied here: browsers that drop custom types still paste it within this tab */
let last: { text: string; data: string } | null = null;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The selection (with what is in its frames) and the lines between it, as clipboard data. */
export function copySelection(docId?: string): FlowClip | null {
  const sel = withContents(ui.selected);
  if (!sel.size) return null;
  return {
    kind: "flow",
    docId,
    nodes: clone(board.nodes.filter((n) => sel.has(n.id))),
    edges: clone(board.edges.filter((e) => sel.has(e.from) && sel.has(e.to))),
  };
}

/** Puts Flow's data and its plain text on a copy/cut event's clipboard. */
export function putOnClipboard(e: ClipboardEvent, clip: { kind: string }, text: string) {
  const data = JSON.stringify(clip);
  e.clipboardData?.setData("text/plain", text);
  e.clipboardData?.setData(FLOW_MIME, data);
  last = { text, data };
  e.preventDefault();
}

/** Flow's data from a paste event, of the given kind, if it has that. */
export function fromClipboard<T extends { kind: string }>(e: ClipboardEvent, kind: T["kind"]): T | null {
  let data = e.clipboardData?.getData(FLOW_MIME) || "";
  // Without our own type: what was copied here last, if the text is the same
  if (!data && last && e.clipboardData?.getData("text/plain") === last.text) data = last.data;
  try {
    const clip = data ? (JSON.parse(data) as T) : null;
    return clip?.kind === kind ? clip : null;
  } catch {
    return null;
  }
}

export function onFlowCopy(e: ClipboardEvent, cut: boolean, docId?: string) {
  const clip = copySelection(docId);
  if (!clip) return;
  putOnClipboard(e, clip, clip.nodes.map((n) => n.text).filter(Boolean).join("\n"));
  if (cut) deleteSelection();
}

/**
 * Pastes blocks from Flow around `at`, or a block for every line of plain text.
 * Images copied on another board (than `docId`) first get a copy of their file there (`copyImage`).
 */
export function onFlowPaste(
  e: ClipboardEvent,
  at: { x: number; y: number },
  docId?: string,
  copyImage?: (fileId: string) => Promise<string | null>,
) {
  const clip = fromClipboard<FlowClip>(e, "flow");
  if (clip) {
    e.preventDefault();
    const box = bounds(clip.nodes)!;
    const place = () => insertCopies(clip.nodes, clip.edges, snap(at.x - box.x - box.w / 2), snap(at.y - box.y - box.h / 2));
    const images = clip.nodes.filter((n) => n.kind === "image" && n.image);
    if (!images.length || !copyImage || clip.docId === docId) return place();
    void Promise.all(
      images.map(async (n) => {
        n.image = (await copyImage(n.image!)) ?? n.image;
      }),
    ).then(place);
    return;
  }
  const text = e.clipboardData?.getData("text/plain")?.trim();
  if (!text) return;
  e.preventDefault();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 50);
  if (lines.length === 1) {
    const node = createNode("box", at.x, at.y, { text: lines[0] });
    addNode(node);
    return;
  }
  // A column of blocks, one per line
  const made = lines.map((line, i) => createNode("box", at.x, at.y + i * (60 + GRID * 2), { text: line }));
  checkpoint();
  batch(() => {
    setBoard("nodes", (ns) => [...ns, ...made]);
    assignParents(made.map((n) => n.id));
    growFrames(made.map((n) => n.id));
    select(made.map((n) => n.id));
  });
  touch();
}
