import type { JSX } from "solid-js";
import type { DocumentKind } from "../lib/types";
import { IconEer, IconFlow, IconKanban, IconText } from "./icons";

export const KINDS: DocumentKind[] = ["flow", "text", "kanban", "eer"];

export const KIND_LABEL: Record<DocumentKind, string> = {
  flow: "Flowchart",
  text: "Document",
  kanban: "Kanban board",
  eer: "EER diagram",
};

const ICONS: Record<DocumentKind, () => JSX.Element> = {
  flow: IconFlow,
  text: IconText,
  kanban: IconKanban,
  eer: IconEer,
};

export function KindIcon(p: { kind: DocumentKind }) {
  return <span class={`kind-icon kind-${p.kind}`}>{ICONS[p.kind]()}</span>;
}
