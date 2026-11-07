// Comments on passages of a text document: the quoted words are marked in the
// editor (a ProseMirror decoration, not part of the text, so nothing changes in
// the document itself), and a click on one shows its thread.
//
// A passage is found again by its words and a little of the text around them
// (`CommentAnchor` "text": quote, prefix, suffix, as the W3C text quote
// selector), so it survives edits elsewhere; when its words are gone it is no
// longer marked (the thread stays, with the quote).

import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface TextMark {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
}

interface State {
  marks: TextMark[];
  focused: string | null;
}

export const textCommentsKey = new PluginKey<State>("textComments");

/** How much text around a passage is kept to find it again */
const CONTEXT = 32;

/** The document as plain text (blocks on lines of their own), and each character's position. */
export function textMap(doc: PMNode): { text: string; pos: number[] } {
  let text = "";
  const pos: number[] = [];
  doc.descendants((node, p) => {
    if (node.isText) {
      const t = node.text ?? "";
      for (let i = 0; i < t.length; i++) pos.push(p + i);
      text += t;
    } else if (node.isBlock && text && !text.endsWith("\n")) {
      text += "\n";
      pos.push(p);
    }
    return true;
  });
  return { text, pos };
}

/** Where a passage is now: the occurrence of its words whose surroundings match best. */
export function findPassage(text: string, m: Pick<TextMark, "quote" | "prefix" | "suffix">): number | null {
  if (!m.quote) return null;
  let best: number | null = null;
  let bestScore = -1;
  for (let i = text.indexOf(m.quote); i >= 0; i = text.indexOf(m.quote, i + 1)) {
    const before = text.slice(Math.max(0, i - m.prefix.length), i);
    const after = text.slice(i + m.quote.length, i + m.quote.length + m.suffix.length);
    let score = 0;
    while (score < before.length && before[before.length - 1 - score] === m.prefix[m.prefix.length - 1 - score]) score++;
    let s2 = 0;
    while (s2 < after.length && after[s2] === m.suffix[s2]) s2++;
    if (score + s2 > bestScore) {
      bestScore = score + s2;
      best = i;
    }
  }
  return best;
}

/** The selected passage as an anchor: its words and some text around them. */
export function selectionAnchor(state: EditorState): { quote: string; prefix: string; suffix: string } | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  const { text, pos } = textMap(state.doc);
  const i = pos.findIndex((p) => p >= from);
  let j = -1;
  for (let k = pos.length - 1; k >= 0; k--) {
    if (pos[k] < to) {
      j = k;
      break;
    }
  }
  if (i < 0 || j < i) return null;
  const quote = text.slice(i, j + 1).trim();
  if (!quote) return null;
  return { quote: quote.slice(0, 500), prefix: text.slice(Math.max(0, i - CONTEXT), i), suffix: text.slice(j + 1, j + 1 + CONTEXT) };
}

function decorations(doc: PMNode, s: State): DecorationSet {
  if (!s.marks.length) return DecorationSet.empty;
  const { text, pos } = textMap(doc);
  const decos: Decoration[] = [];
  for (const m of s.marks) {
    const i = findPassage(text, m);
    if (i === null) continue;
    const from = pos[i];
    const to = pos[i + m.quote.length - 1] + 1;
    if (from === undefined || !(to > from)) continue;
    decos.push(Decoration.inline(from, to, { class: m.id === s.focused ? "text-comment focused" : "text-comment", "data-thread": m.id }));
  }
  return DecorationSet.create(doc, decos);
}

/** The editor extension: marks the passages it is given (`setTextComments`); a click on one calls `onOpen`. */
export const TextComments = Extension.create<{ onOpen: (id: string) => void }>({
  name: "textComments",
  addOptions() {
    return { onOpen: () => {} };
  },
  addProseMirrorPlugins() {
    const onOpen = this.options.onOpen;
    return [
      new Plugin<State & { set: DecorationSet }>({
        key: textCommentsKey as unknown as PluginKey<State & { set: DecorationSet }>,
        state: {
          init: () => ({ marks: [], focused: null, set: DecorationSet.empty }),
          apply(tr, value, _old, state) {
            const next = tr.getMeta(textCommentsKey) as State | undefined;
            if (next) return { ...next, set: decorations(state.doc, next) };
            if (tr.docChanged) return { ...value, set: decorations(state.doc, value) };
            return value;
          },
        },
        props: {
          decorations(state) {
            return (this as Plugin<State & { set: DecorationSet }>).getState(state)?.set ?? DecorationSet.empty;
          },
          handleClick(_view, _pos, event) {
            const el = (event.target as HTMLElement | null)?.closest?.("[data-thread]") as HTMLElement | null;
            if (el?.dataset.thread) onOpen(el.dataset.thread);
            return false;
          },
        },
      }),
    ];
  },
});
