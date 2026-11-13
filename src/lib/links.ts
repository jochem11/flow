// Links between kanban cards and documents (`KanbanCard.links`).
//
// A card is linked to documents of its project (a flowchart, EER diagram, text or
// another board), and within one to any number of parts: groups in a flowchart
// (section, swimlane, system boundary, package, fragment: `isContainer`) or
// tables in an EER diagram. A link to a part always comes with a link to its
// whole document (`withDocLinks`). Links are stored on the card, made from either side.
//
// Both sides need to read the other document: an open document reads the kanban
// boards of its project to show its linked cards, and the card dialog reads the
// documents to pick a part and to name it.

import { createEffect, createRoot, createSignal, on } from "solid-js";
import { api } from "./api";
import { focusOn } from "./camera";
import { eer, entityRect, setEerCamera, setEerSelected } from "./eer";
import { setOpenCardId } from "./kanban";
import { board, isContainer, select, uid } from "./store";
import { nextNumber } from "./tickets";
import type { CardLink, DocumentMeta, FlowNode, KanbanCard, KanbanDoc, NodeKind } from "./types";
import { docsOf, openDoc, openDocument } from "./workspace";
import { changeClosedBoard } from "./collab";

const KIND_NAMES: Partial<Record<NodeKind, string>> = {
  section: "Section",
  lanes: "Swimlanes",
  boundary: "System boundary",
  package: "Package",
  fragment: "Fragment",
  start: "Start point",
  end: "End point",
  bar: "Fork / join",
  flowfinal: "Flow final",
  lifeline: "Lifeline",
  activation: "Activation",
  destroy: "Destroy",
  pin: "Pin",
  note: "Note",
};

const GROUP_NAMES: Partial<Record<NodeKind, string>> = {
  section: "section",
  lanes: "swimlanes",
  boundary: "system",
  package: "package",
  fragment: "fragment",
};

/** A readable name for a block: its first line of text, or what kind of block it is. */
export function nodeName(n: FlowNode): string {
  const first = n.text.split("\n").find((l) => l.trim() && !l.startsWith("«"))?.trim();
  return first || KIND_NAMES[n.kind] || "Block";
}

// ---------- the parts of a document ----------

/** Something in a document a card can link to: a flowchart group or an EER table. */
export interface Part {
  id: string;
  name: string;
  /** "section", "table", ... */
  kind: string;
  /** Can a new link be made to it? (older links to plain blocks still have a name) */
  pickable: boolean;
}

const flowParts = (nodes: FlowNode[]): Part[] =>
  nodes.map((n) => ({ id: n.id, name: nodeName(n), kind: GROUP_NAMES[n.kind] ?? n.kind, pickable: isContainer(n.kind) }));

const [partCache, setPartCache] = createSignal<Record<string, Part[]>>({});
const loading = new Set<string>();

/**
 * The parts of a document, for the picker and for the names on link chips. The
 * open document is read live; others are loaded once and cached. Documents
 * without parts (text, kanban) have none.
 */
export function docParts(docId: string): Part[] | undefined {
  const open = openDoc();
  if (open?.id === docId && open.kind === "flow") return flowParts(board.nodes);
  if (open?.id === docId && open.kind === "eer") return eer.entities.map((e) => ({ id: e.id, name: e.name, kind: "table", pickable: true }));
  const cached = partCache()[docId];
  if (!cached) void loadParts(docId);
  return cached;
}

async function loadParts(docId: string) {
  const projectId = openDoc()?.projectId;
  if (!projectId || loading.has(docId)) return;
  loading.add(docId);
  let parts: Part[] = [];
  try {
    const content = (await api.loadDocument(projectId, docId)).content;
    if (content.kind === "flow") parts = flowParts(content.data.nodes);
    if (content.kind === "eer") parts = content.data.entities.map((e) => ({ id: e.id, name: e.name, kind: "table", pickable: true }));
  } catch {
    /* a document that cannot be read has no parts */
  } finally {
    loading.delete(docId);
    setPartCache((c) => ({ ...c, [docId]: parts }));
  }
}

/** Can cards be linked to this flowchart block? Only groups (sections, swimlanes, ...). */
export const isLinkable = (n: FlowNode) => isContainer(n.kind);

/** Documents a card on the open board can link to: everything in the project but the board itself. */
export const linkableDocs = (): DocumentMeta[] =>
  docsOf(openDoc()?.projectId ?? "").filter((d) => d.id !== openDoc()?.id);

// ---------- the cards that link to the open document ----------

export interface LinkedCard {
  boardId: string;
  boardName: string;
  cardId: string;
  title: string;
  column: string;
  done: boolean;
}

/** The key for links to the whole document, rather than a part of it */
const WHOLE = "";

const [linkedCards, setLinkedCards] = createSignal<Record<string, LinkedCard[]>>({});

/** Cards linked to part `nodeId` of the open document, or with null to the whole document. */
export const cardsLinkedTo = (nodeId: string | null) => linkedCards()[nodeId ?? WHOLE] ?? [];

/**
 * Reads every kanban board in the project and collects the cards that link to
 * document `docId` (or a part of it). Called when a document is opened.
 */
export async function loadLinkedCards(projectId: string, docId: string) {
  const boards = docsOf(projectId).filter((d) => d.kind === "kanban");
  const found: Record<string, LinkedCard[]> = {};
  await Promise.all(
    boards.map(async (meta) => {
      try {
        const doc = await api.loadDocument(projectId, meta.id);
        if (doc.content.kind !== "kanban") return;
        for (const column of doc.content.data.columns) {
          for (const card of column.cards) {
            for (const link of card.links ?? []) {
              if (link.docId !== docId) continue;
              (found[link.nodeId ?? WHOLE] ??= []).push({
                boardId: meta.id,
                boardName: meta.name,
                cardId: card.id,
                title: card.title,
                column: column.title,
                done: column.done === true,
              });
            }
          }
        }
      } catch {
        /* a board that cannot be read has no links to show */
      }
    }),
  );
  // Only if the user is still looking at this document
  if (openDoc()?.id === docId) setLinkedCards(found);
}

// ---------- jumping between them ----------

/** Opens a document, with the linked part (a flowchart group, an EER table) selected and in view. */
export async function openLinkedNode(docId: string, nodeId?: string | null) {
  const projectId = openDoc()?.projectId;
  if (!projectId) return;
  // Close the card first, or it would pop up again when the board is opened next time
  setOpenCardId(null);
  await openDocument(projectId, docId);
  if (!nodeId) return;
  // After the document is shown (and possibly fitted to the screen)
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const kind = openDoc()?.kind;
      if (kind === "flow") {
        const n = board.nodes.find((x) => x.id === nodeId);
        if (!n) return;
        select([n.id]);
        focusOn(n);
      } else if (kind === "eer") {
        const e = eer.entities.find((x) => x.id === nodeId);
        if (!e) return;
        setEerSelected({ kind: "entity", id: e.id });
        const r = entityRect(e);
        const view = document.querySelector(".eer-viewport")?.getBoundingClientRect();
        if (view) setEerCamera({ x: view.width / 2 - (r.x + r.w / 2) * eer.camera.zoom, y: view.height / 2 - (r.y + r.h / 2) * eer.camera.zoom });
      }
    }),
  );
}

/** Opens a kanban board with the card's dialog open. */
export async function openLinkedCard(boardId: string, cardId: string) {
  const projectId = openDoc()?.projectId;
  if (!projectId) return;
  await openDocument(projectId, boardId);
  setOpenCardId(cardId);
}

// ---------- linking from the document ----------
// The board is not open then, so it is loaded, changed and saved here.

/** Kanban boards in the open project (not the open document itself). */
export const boardDocs = () =>
  docsOf(openDoc()?.projectId ?? "").filter((d) => d.kind === "kanban" && d.id !== openDoc()?.id);

/** A kanban board's content, to pick a card from. */
export async function loadBoard(boardId: string): Promise<KanbanDoc | null> {
  const projectId = openDoc()?.projectId;
  if (!projectId) return null;
  const doc = await api.loadDocument(projectId, boardId);
  return doc.content.kind === "kanban" ? doc.content.data : null;
}

/** Loads a board, changes it, saves it, and shows the new links on the open document. */
async function changeBoard(boardId: string, change: (board: KanbanDoc) => void) {
  const open = openDoc();
  if (!open) return;
  await changeClosedBoard(open.projectId, boardId, (content) => {
    if (content.kind !== "kanban") return false;
    change(content.data);
  });
  await loadLinkedCards(open.projectId, open.id);
}

const cardIn = (b: KanbanDoc, cardId: string) => b.columns.flatMap((c) => c.cards).find((c) => c.id === cardId);

/**
 * The links with a link to the whole document added for every document that only
 * has links to parts (a section is always in a file).
 */
export function withDocLinks(links: CardLink[]): CardLink[] {
  const docs = new Set(links.filter((l) => !l.nodeId).map((l) => l.docId));
  const out = [...links];
  for (const l of links) {
    if (!docs.has(l.docId)) {
      docs.add(l.docId);
      out.push({ docId: l.docId });
    }
  }
  return out;
}
const sameTarget = (nodeId: string | null) => (l: { nodeId?: string | null }) => (l.nodeId ?? null) === nodeId;

/** Links an existing card to part `nodeId` of the open document (null: the whole document). */
export function linkCard(boardId: string, cardId: string, nodeId: string | null) {
  const docId = openDoc()?.id;
  if (!docId) return Promise.resolve();
  return changeBoard(boardId, (b) => {
    const card = cardIn(b, cardId);
    if (card && !card.links?.some((l) => l.docId === docId && sameTarget(nodeId)(l))) {
      card.links = withDocLinks([...(card.links ?? []), nodeId ? { docId, nodeId } : { docId }]);
    }
  });
}

/**
 * Removes the link from a card to part `nodeId` of the open document. With null
 * the whole document goes, with all its parts.
 */
export function unlinkCard(boardId: string, cardId: string, nodeId: string | null) {
  const docId = openDoc()?.id;
  return changeBoard(boardId, (b) => {
    const card = cardIn(b, cardId);
    if (!card) return;
    card.links = (card.links ?? []).filter((l) => l.docId !== docId || (nodeId !== null && !sameTarget(nodeId)(l)));
  });
}

/** A new card in the first column of a board, linked to part `nodeId` of the open document (or all of it). */
export function createLinkedCard(boardId: string, title: string, nodeId: string | null) {
  const docId = openDoc()?.id;
  if (!docId || !title.trim()) return Promise.resolve();
  return changeBoard(boardId, (b) => {
    // Numbered like the others, once the board has ticket ids
    const number = b.key ? nextNumber(b) : undefined;
    if (number) b.nextNumber = number + 1;
    const card: KanbanCard = {
      id: uid(),
      number,
      title: title.trim(),
      description: "",
      labelIds: [],
      comments: [],
      links: withDocLinks([nodeId ? { docId, nodeId } : { docId }]),
    };
    b.columns[0]?.cards.push(card);
  });
}

// Opening a document: find the cards that link to it. Leaving one: it may have
// new or renamed parts, so its cached copy is out of date.
createRoot(() =>
  createEffect(
    on(openDoc, (doc, prev) => {
      if (prev) setPartCache(({ [prev.id]: _, ...rest }) => rest);
      setLinkedCards({});
      if (doc) void loadLinkedCards(doc.projectId, doc.id);
    }),
  ),
);
