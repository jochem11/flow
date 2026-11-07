// What-you-see-is-what-you-get editor that reads and writes markdown.
//
// Built on Tiptap (ProseMirror). The text is still stored as markdown, so the
// data model does not change, but you only ever see the formatted result.
// Markdown shortcuts still work while typing: "## " for a heading, "- " for a
// list, "[ ] " for a checkbox, **bold**, and so on.

import { setTextReplacer } from "../lib/history";
import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { WebsocketProvider } from "y-websocket";
import type * as Y from "yjs";
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js";
import { handleLinkClick } from "../lib/markdown";
import { selectionAnchor, TextComments, textCommentsKey, type TextMark } from "../lib/textComments";

type Action = {
  label: string;
  title: string;
  class?: string;
  run: (e: Editor) => void;
  active?: (e: Editor) => boolean;
};

const ACTIONS: Action[][] = [
  [
    { label: "H1", title: "Heading 1", run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(), active: (e) => e.isActive("heading", { level: 1 }) },
    { label: "H2", title: "Heading 2", run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(), active: (e) => e.isActive("heading", { level: 2 }) },
    { label: "H3", title: "Heading 3", run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(), active: (e) => e.isActive("heading", { level: 3 }) },
  ],
  [
    { label: "B", title: "Bold (Cmd+B)", class: "fmt-bold", run: (e) => e.chain().focus().toggleBold().run(), active: (e) => e.isActive("bold") },
    { label: "I", title: "Italic (Cmd+I)", class: "fmt-italic", run: (e) => e.chain().focus().toggleItalic().run(), active: (e) => e.isActive("italic") },
    { label: "S", title: "Strikethrough (Cmd+Shift+S)", class: "fmt-strike", run: (e) => e.chain().focus().toggleStrike().run(), active: (e) => e.isActive("strike") },
    { label: "</>", title: "Code (Cmd+E)", class: "fmt-mono", run: (e) => e.chain().focus().toggleCode().run(), active: (e) => e.isActive("code") },
  ],
  [
    { label: "•", title: "Bulleted list", run: (e) => e.chain().focus().toggleBulletList().run(), active: (e) => e.isActive("bulletList") },
    { label: "1.", title: "Numbered list", run: (e) => e.chain().focus().toggleOrderedList().run(), active: (e) => e.isActive("orderedList") },
    { label: "☐", title: "Checklist", run: (e) => e.chain().focus().toggleTaskList().run(), active: (e) => e.isActive("taskList") },
    { label: "❝", title: "Quote", run: (e) => e.chain().focus().toggleBlockquote().run(), active: (e) => e.isActive("blockquote") },
  ],
  [
    { label: "{ }", title: "Code block", class: "fmt-mono", run: (e) => e.chain().focus().toggleCodeBlock().run(), active: (e) => e.isActive("codeBlock") },
    { label: "—", title: "Divider", run: (e) => e.chain().focus().setHorizontalRule().run() },
  ],
];

export function RichTextEditor(p: {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  class?: string;
  /** "page" fills the whole editor area, for text documents */
  variant?: "inline" | "page";
  /** Only to read (no formatting bar, no typing) */
  readOnly?: boolean;
  /**
   * Editing together (a text document from the server): the content lives in
   * this shared document; `value` only fills it when it is new and `seed()` says
   * we are the one to do so (see collab/).
   */
  collab?: { doc: Y.Doc; provider: WebsocketProvider; seed: () => boolean; user: { name: string; color: string } };
  /**
   * Comments on passages (a text document on the server): the threads to mark,
   * the one shown, what a click on a marked passage does, and (when one may
   * comment) what "Comment" on a selection does.
   */
  comments?: {
    marks: () => TextMark[];
    focused: () => string | null;
    onOpen: (id: string) => void;
    onComment?: (anchor: { quote: string; prefix: string; suffix: string }) => void;
  };
}) {
  let host!: HTMLDivElement;
  let editor: Editor | undefined;
  /** The last markdown we emitted, to tell our own changes from outside ones. */
  let lastValue = p.value;
  /** Bumped on every editor transaction, so toolbar "active" states update. */
  const [tick, setTick] = createSignal(0);
  const [linkOpen, setLinkOpen] = createSignal(false);
  /** Where the "Comment" button goes, over a selection (relative to this editor) */
  const [commentAt, setCommentAt] = createSignal<{ x: number; y: number } | null>(null);
  let wrap!: HTMLDivElement;

  onMount(() => {
    editor = new Editor({
      element: host,
      extensions: [
        // Editing together brings its own undo (only your own changes)
        StarterKit.configure({ link: { openOnClick: false, autolink: true }, ...(p.collab ? { undoRedo: false } : {}) }),
        ...(p.collab
          ? [
              Collaboration.configure({ document: p.collab.doc, field: "text" }),
              CollaborationCaret.configure({ provider: p.collab.provider, user: p.collab.user }),
            ]
          : []),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: p.placeholder ?? "" }),
        Markdown,
        ...(p.comments ? [TextComments.configure({ onOpen: p.comments.onOpen })] : []),
      ],
      content: p.collab ? undefined : p.value,
      contentType: "markdown",
      editable: !p.readOnly,
      editorProps: { attributes: { class: "markdown rich-text-content" } },
      onUpdate: ({ editor }) => {
        lastValue = cleanMarkdown(editor.getMarkdown());
        p.onChange(lastValue);
      },
      onTransaction: () => setTick((t) => t + 1),
      onSelectionUpdate: ({ editor }) => placeCommentButton(editor),
      onBlur: () => setTimeout(() => setCommentAt(null), 150),
    });
  });

  /** Over a selection of words: the "Comment" button, just above its end */
  const placeCommentButton = (e: Editor) => {
    // Only over words (not a bare line break or an empty block)
    if (!p.comments?.onComment || e.state.selection.empty || !selectionAnchor(e.state)) return setCommentAt(null);
    const end = e.view.coordsAtPos(e.state.selection.to);
    const box = wrap.getBoundingClientRect();
    const above = end.top - box.top - 34;
    // On the first lines there is no room above: below the selection then
    setCommentAt({ x: end.left - box.left, y: above < 4 ? end.bottom - box.top + 6 : above });
  };

  // The marked passages follow the threads (and which one is shown)
  createEffect(() => {
    const c = p.comments;
    if (!c) return;
    const marks = c.marks();
    const focused = c.focused();
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(textCommentsKey, { marks, focused }));
    // The shown thread's passage comes into view
    if (focused) requestAnimationFrame(() => host.querySelector(`[data-thread="${CSS.escape(focused)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  });

  // A text document: the version history can put old text in it
  onMount(() => {
    if (p.variant !== "page") return;
    setTextReplacer((markdown) => editor?.commands.setContent(markdown, { contentType: "markdown" }));
    onCleanup(() => setTextReplacer(null));
  });

  // Editing together: a new shared text is filled from the saved one, by one person
  onMount(() => {
    const c = p.collab;
    if (!c) return;
    const fill = () => {
      if (!editor || !c.seed() || c.doc.getXmlFragment("text").length > 0) return;
      editor.commands.setContent(p.value, { contentType: "markdown" });
    };
    const onSync = (synced: boolean) => synced && setTimeout(fill, 50);
    c.provider.on("sync", onSync);
    if (c.provider.synced) setTimeout(fill, 50);
    // The server's "you fill it" may come just after the sync
    const late = setTimeout(fill, 600);
    onCleanup(() => {
      clearTimeout(late);
      c.provider.off("sync", onSync);
    });
  });

  // Load new content when it changes from outside (e.g. another card is opened).
  createEffect(
    on(
      () => p.value,
      (value) => {
        if (!editor || value === lastValue || p.collab) return;
        lastValue = value;
        editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
      },
      { defer: true },
    ),
  );

  createEffect(on(() => p.readOnly, (ro) => editor?.setEditable(!ro), { defer: true }));

  onCleanup(() => editor?.destroy());

  const isActive = (a: Action) => {
    tick();
    return !!editor && !!a.active?.(editor);
  };

  return (
    <div class={`rich-text ${p.variant ?? "inline"} ${p.class ?? ""}`} ref={wrap}>
      <Show when={commentAt()}>
        {(at) => (
          <button
            class="text-btn small text-comment-btn"
            style={{ left: `${at().x}px`, top: `${at().y}px` }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const a = editor && selectionAnchor(editor.state);
              setCommentAt(null);
              if (a) p.comments?.onComment?.(a);
            }}
          >
            Comment
          </button>
        )}
      </Show>
      <div class="format-bar rich-text-toolbar" role="toolbar" aria-label="Formatting" hidden={p.readOnly}>
        <For each={ACTIONS}>
          {(group, i) => (
            <>
              <Show when={i() > 0}>
                <span class="divider" />
              </Show>
              <For each={group}>
                {(a) => (
                  <button
                    class={`fmt-btn ${a.class ?? ""}`}
                    classList={{ active: isActive(a) }}
                    title={a.title}
                    // Keep the editor's selection when clicking a button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => editor && a.run(editor)}
                  >
                    {a.label}
                  </button>
                )}
              </For>
            </>
          )}
        </For>
        <span class="divider" />
        <button
          class="fmt-btn"
          classList={{ active: (tick(), !!editor?.isActive("link")) || linkOpen() }}
          title="Link (Cmd+K)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (editor?.isActive("link")) editor.chain().focus().unsetLink().run();
            else setLinkOpen(!linkOpen());
          }}
        >
          Link
        </button>
      </div>

      <Show when={linkOpen()}>
        <LinkInput
          onDone={(url) => {
            setLinkOpen(false);
            if (!editor) return;
            if (!url) return void editor.commands.focus();
            const href = /^[a-z]+:/i.test(url) ? url : `https://${url}`;
            const chain = editor.chain().focus();
            // Without a selection, insert the url itself as the link text
            if (editor.state.selection.empty) chain.insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href } }] }).run();
            else chain.setLink({ href }).run();
          }}
        />
      </Show>

      <div
        ref={host}
        class="rich-text-body"
        onClick={(e) => {
          // Cmd/Ctrl+click opens a link in the browser; a normal click just places the cursor
          if ((e.metaKey || e.ctrlKey) && (e.target as HTMLElement).closest("a")) handleLinkClick(e);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            if (editor?.isActive("link")) editor.chain().focus().unsetLink().run();
            else setLinkOpen(true);
          }
        }}
      />
    </div>
  );
}

/** Empty paragraphs come out as "&nbsp;"; drop them and squash runs of blank lines. */
function cleanMarkdown(md: string): string {
  return md
    .replace(/^(&nbsp;|\u00a0)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function LinkInput(p: { onDone: (url: string | null) => void }) {
  let ref!: HTMLInputElement;
  onMount(() => ref.focus());
  return (
    <div class="rich-text-link">
      <input
        ref={ref}
        class="kd-input"
        placeholder="Paste a link and press Enter…"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            p.onDone(ref.value.trim() || null);
          }
          if (e.key === "Escape") {
            e.stopPropagation();
            p.onDone(null);
          }
        }}
        onBlur={() => p.onDone(null)}
      />
    </div>
  );
}
