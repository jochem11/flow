// Matching names typed in quick open (Cmd+K, see CommandPalette.tsx).

/**
 * How well `text` matches `q`: higher is better, null is no match. The whole
 * query in one piece beats its letters spread out; at the start of a word beats
 * the middle.
 */
export function matchScore(text: string, q: string): number | null {
  const t = text.toLowerCase();
  const s = q.trim().toLowerCase();
  if (!s) return 0;
  const i = t.indexOf(s);
  if (i >= 0) return 100 - i + (i === 0 || t[i - 1] === " " ? 20 : 0) - (t.length - s.length) * 0.1;
  // The letters in order, with as little between them as possible
  let at = 0;
  let gaps = 0;
  for (const ch of s) {
    if (ch === " ") continue;
    const j = t.indexOf(ch, at);
    if (j < 0) return null;
    gaps += j - at;
    at = j + 1;
  }
  return 40 - gaps;
}
