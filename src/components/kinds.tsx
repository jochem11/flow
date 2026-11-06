import type { JSX } from "solid-js";
import type { DiagramType, DocumentKind } from "../lib/types";
import { boardType, boardTypeOf, type BoardTypeId } from "../lib/boardTypes";
import { IconChart, IconEer, IconFlow, IconKanban, IconPill, IconSection, IconText, IconTopic, UML_ICONS } from "./icons";

export const KINDS: DocumentKind[] = ["flow", "text", "kanban", "eer"];

export const KIND_LABEL: Record<DocumentKind, string> = {
  flow: "Flowchart",
  text: "Document",
  kanban: "Kanban board",
  eer: "EER diagram",
  chart: "Chart",
};

const ICONS: Record<DocumentKind, () => JSX.Element> = {
  flow: IconFlow,
  text: IconText,
  kanban: IconKanban,
  eer: IconEer,
  chart: IconChart,
};

export function KindIcon(p: { kind: DocumentKind }) {
  return <span class={`kind-icon kind-${p.kind}`}>{ICONS[p.kind]()}</span>;
}

const TYPE_ICONS: Record<BoardTypeId, () => JSX.Element> = {
  flowchart: IconFlow,
  mindmap: IconTopic,
  sequence: UML_ICONS.lifeline!,
  class: UML_ICONS.class!,
  usecase: UML_ICONS.usecase!,
  activity: UML_ICONS.bar!,
  state: IconPill,
  whiteboard: IconSection,
  text: IconText,
  kanban: IconKanban,
  eer: IconEer,
  chart: IconChart,
};

/** The icon of a board type (in the colour of its kind). */
export function TypeIcon(p: { type: BoardTypeId }) {
  return <span class={`kind-icon kind-${boardType(p.type).kind} type-icon`}>{TYPE_ICONS[p.type]()}</span>;
}

/** The icon of a board, by its type (a flow board without one is a whiteboard). */
export function BoardIcon(p: { kind: DocumentKind; diagram?: DiagramType | null }) {
  return <TypeIcon type={boardTypeOf(p.kind, p.diagram).id} />;
}
