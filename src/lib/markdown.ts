// Markdown rendering for text documents and project descriptions.

import MarkdownIt from "markdown-it";
import { openUrl } from "@tauri-apps/plugin-opener";
import { inTauri } from "./api";

// `html: false`: raw HTML in markdown is shown as text, never rendered, so a
// document can never inject scripts or iframes into the app.
const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: true });

export function renderMarkdown(text: string): string {
  // Render task lists ("- [ ] todo" / "- [x] done") as checkboxes. A plain
  // string replace is safe here: with `html: false` the text itself cannot contain <li>.
  return md
    .render(text)
    // `(\s*<p>)?`: in "loose" lists (blank lines between items) the text is wrapped in <p>.
    .replace(/<li>(\s*<p>)?\[( |x|X)\] ?/g, (_, p: string | undefined, mark: string) => {
      const cls = mark === " " ? "task" : "task done";
      return `<li class="${cls}">${p ?? ""}<span class="checkbox" aria-hidden="true"></span>`;
    });
}

/**
 * Opens links in rendered markdown in the default browser. Otherwise the app's
 * webview would navigate away from the app itself.
 */
export function handleLinkClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  const href = a?.getAttribute("href");
  if (!href) return;
  e.preventDefault();
  if (inTauri) openUrl(href).catch(() => {});
  else window.open(href, "_blank", "noopener");
}
