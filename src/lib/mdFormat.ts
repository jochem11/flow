// Formatting actions for the markdown editor. They edit the textarea around the
// selection via `insertText`, so the textarea's own undo (Cmd+Z) keeps working.

export type Format =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "task"
  | "quote"
  | "link"
  | "codeblock"
  | "hr";

/** Replaces a range of text, then sets the selection. Fires an `input` event. */
function replace(ta: HTMLTextAreaElement, start: number, end: number, text: string, selStart: number, selEnd: number) {
  ta.focus();
  ta.setSelectionRange(start, end);
  // execCommand is deprecated, but still the only way to keep the textarea's
  // native undo history. Falls back to setRangeText.
  const ok = document.execCommand?.("insertText", false, text);
  if (!ok) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  ta.setSelectionRange(selStart, selEnd);
}

/** **bold**, *italic*, ~~strike~~, `code`: adds markers around the selection, or removes them. */
function wrap(ta: HTMLTextAreaElement, marker: string, placeholder: string) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const m = marker.length;
  // Already wrapped in these markers? Then remove them.
  if (value.slice(s - m, s) === marker && value.slice(e, e + m) === marker) {
    replace(ta, s - m, e + m, value.slice(s, e), s - m, e - m);
    return;
  }
  const inner = value.slice(s, e) || placeholder;
  replace(ta, s, e, marker + inner + marker, s + m, s + m + inner.length);
}

const HEADING = /^#{1,6} /;
const LIST = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+\. )/;

/** A prefix on every selected line: headings, lists, quotes. */
function prefixLines(ta: HTMLTextAreaElement, kind: Format) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const nl = value.indexOf("\n", e);
  const lineEnd = nl === -1 ? value.length : nl;
  const lines = value.slice(lineStart, lineEnd).split("\n");

  const prefixFor = (i: number) =>
    ({ h1: "# ", h2: "## ", h3: "### ", bullet: "- ", numbered: `${i + 1}. `, task: "- [ ] ", quote: "> " })[
      kind as "h1"
    ];

  const has = (line: string, i: number) => {
    const p = prefixFor(i);
    if (kind === "numbered") return /^\d+\. /.test(line);
    return line.startsWith(p);
  };

  // Toggle: remove when every line already has it, otherwise add it.
  const allHave = lines.every((l, i) => has(l, i));
  const out = lines.map((line, i) => {
    if (allHave) {
      return kind === "numbered" ? line.replace(/^\d+\. /, "") : line.slice(prefixFor(i).length);
    }
    // Replace an existing heading or list marker instead of stacking them.
    let rest = line;
    if (kind.startsWith("h")) rest = rest.replace(HEADING, "");
    if (kind === "bullet" || kind === "numbered" || kind === "task") rest = rest.replace(LIST, "$1");
    return prefixFor(i) + rest;
  });

  const text = out.join("\n");
  // A single empty line: put the cursor after the prefix. Otherwise select it all.
  if (lines.length === 1 && !lines[0].trim() && !allHave) {
    const pos = lineStart + text.length;
    replace(ta, lineStart, lineEnd, text, pos, pos);
  } else {
    replace(ta, lineStart, lineEnd, text, lineStart, lineStart + text.length);
  }
}

export function applyFormat(ta: HTMLTextAreaElement, f: Format) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e);
  switch (f) {
    case "bold":
      return wrap(ta, "**", "bold");
    case "italic":
      return wrap(ta, "*", "italic");
    case "strike":
      return wrap(ta, "~~", "strikethrough");
    case "code":
      return wrap(ta, "`", "code");
    case "link": {
      // Insert [text](url) and select "url" so it can be pasted over right away.
      const label = selected || "link text";
      const isUrl = /^https?:\/\//.test(selected);
      const text = isUrl ? `[link text](${selected})` : `[${label}](url)`;
      const selFrom = isUrl ? s + 1 : s + label.length + 3;
      const selTo = isUrl ? s + 1 + "link text".length : selFrom + 3;
      return replace(ta, s, e, text, selFrom, selTo);
    }
    case "codeblock": {
      const before = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
      const inner = selected || "";
      const text = `${before}\`\`\`\n${inner}\n\`\`\`\n`;
      const pos = s + before.length + 4;
      return replace(ta, s, e, text, pos, pos + inner.length);
    }
    case "hr": {
      const before = s > 0 && value[s - 1] !== "\n" ? "\n" : "";
      const text = `${before}\n---\n\n`;
      const pos = s + text.length;
      return replace(ta, s, e, text, pos, pos);
    }
    default:
      return prefixLines(ta, f);
  }
}

/** Shortcuts: Cmd/Ctrl + B, I, K, E, Shift+X. Returns true if the key was handled. */
export function formatShortcut(e: KeyboardEvent): Format | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return k === "x" ? "strike" : null;
  return ({ b: "bold", i: "italic", k: "link", e: "code" } as Record<string, Format>)[k] ?? null;
}

/**
 * Enter inside a list continues it on the next line ("- ", "1. " → "2. ",
 * "- [ ] "). Enter on an empty list item ends the list.
 */
export function continueList(ta: HTMLTextAreaElement): boolean {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (s !== e) return false;
  const lineStart = value.lastIndexOf("\n", s - 1) + 1;
  const line = value.slice(lineStart, s);
  const m = line.match(/^(\s*)([-*+] \[[ xX]\] |[-*+] |(\d+)\. |> )/);
  if (!m) return false;
  // Empty list item: remove the marker and leave a blank line so the list really ends.
  if (line.trim() === m[2].trim()) {
    replace(ta, lineStart, s, "\n", lineStart + 1, lineStart + 1);
    return true;
  }
  let marker = m[2];
  if (m[3]) marker = `${Number(m[3]) + 1}. `;
  if (marker.includes("[")) marker = marker.replace(/\[[xX]\]/, "[ ]");
  const text = "\n" + m[1] + marker;
  replace(ta, s, e, text, s + text.length, s + text.length);
  return true;
}
