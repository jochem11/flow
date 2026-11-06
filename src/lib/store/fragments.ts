// Fragments of a sequence diagram (alt, opt, loop, par): their parts, top to
// bottom, each with its condition ("[paid]", "[else]"), split by dashed lines.
// Kept in the node's `lanes` (title = the condition, size = the height); the
// last part runs to the bottom of the fragment, whatever its size says.

import { produce } from "solid-js/store";
import { checkpoint } from "./history";
import { uid } from "./nodes";
import { nodeById, setBoard, touch } from "./state";

/** The lowest a part can be */
export const MIN_PART = 30;

function setParts(id: string, fn: (parts: { id: string; title: string; size: number }[], h: number) => void) {
  setBoard(
    "nodes",
    (n) => n.id === id && n.kind === "fragment",
    produce((n) => {
      n.lanes ??= [];
      fn(n.lanes, n.h);
    }),
  );
  touch();
}

/** Another part at the bottom: the last one is split in two (a first split makes "else"). */
export function addPart(id: string) {
  const n = nodeById(id);
  if (!n) return;
  checkpoint();
  setParts(id, (parts, h) => {
    if (!parts.length) {
      parts.push({ id: uid(), title: "", size: Math.round(h / 2) }, { id: uid(), title: "else", size: h - Math.round(h / 2) });
      return;
    }
    const above = parts.slice(0, -1).reduce((s, p) => s + p.size, 0);
    const last = parts[parts.length - 1];
    const lastH = Math.max(MIN_PART * 2, h - above);
    last.size = Math.round(lastH / 2);
    parts.push({ id: uid(), title: "", size: lastH - last.size });
  });
}

export function removePart(id: string, partId: string) {
  checkpoint();
  setParts(id, (parts) => {
    const i = parts.findIndex((p) => p.id === partId);
    if (i < 0) return;
    // Its height goes to the part above it (or below, for the first)
    const [gone] = parts.splice(i, 1);
    const other = parts[Math.max(0, i - 1)];
    if (other) other.size += gone.size;
    // One part left: no dividers
    if (parts.length === 1) parts.length = 0;
  });
}

export function setPartCondition(id: string, partId: string, title: string) {
  const part = nodeById(id)?.lanes?.find((p) => p.id === partId);
  if (!part || part.title === title) return;
  checkpoint();
  setParts(id, (parts) => (parts.find((p) => p.id === partId)!.title = title));
}

/** Moves the divider above part `index` (dragging; the caller takes one checkpoint first). */
export function moveDivider(id: string, index: number, top: number) {
  setParts(id, (parts) => {
    if (index < 1 || index >= parts.length) return;
    const before = parts.slice(0, index - 1).reduce((s, p) => s + p.size, 0);
    const pair = parts[index - 1].size + parts[index].size;
    const size = Math.max(MIN_PART, Math.min(pair - MIN_PART, Math.round(top - before)));
    parts[index].size = pair - size;
    parts[index - 1].size = size;
  });
}

/** Each part's top and height within the fragment (the last one to the bottom). */
export function partBounds(parts: { size: number }[], h: number): { top: number; height: number }[] {
  let top = 0;
  return parts.map((p, i) => {
    const height = i === parts.length - 1 ? Math.max(0, h - top) : p.size;
    const out = { top, height };
    top += p.size;
    return out;
  });
}
