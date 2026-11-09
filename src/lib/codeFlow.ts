// Diagrams from a codebase (flow_core::code_flow): a folder picked here, or a git
// repository the server downloads, read once and kept (an hour on the server,
// while the desktop app runs), then an activity diagram of any of its functions.
//
// A folder's source files are filtered here (no node_modules, builds, other
// languages): the desktop app reads them itself, the web version sends them.

import { createSignal } from "solid-js";
import { commands, type CodeActivity, type CodeSource, type SourceFile } from "../bindings";
import { inTauri, post } from "./server";

/** A codebase read: where it is kept decides who draws from it */
export interface Loaded {
  source: CodeSource;
  /** Read in the desktop app (not on the server) */
  local: boolean;
  /** Where it came from, to read it again */
  from: string;
}

/** The last codebase read, to draw more from it (also after closing the dialog) */
const [lastCode, setLastCode] = createSignal<Loaded | null>(null);
export { lastCode, setLastCode };

/** As flow_core::code_flow: folders without code of the project's own */
const SKIP_DIRS = new Set([
  ".git", "node_modules", "target", "dist", "build", "out", "bin", "obj", "vendor", "__pycache__", ".venv", "venv", "env",
  ".idea", ".vscode", ".gradle", ".next", ".nuxt", ".svelte-kit", "coverage", ".mvn", "Pods", "DerivedData", ".tox",
]);
const EXTENSIONS = /\.(java|kt|kts|cs|go|py|ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
const MAX_FILES = 5000;
const MAX_FILE = 400_000;

/** The source files of a picked folder, as paths inside it */
export async function sourceFiles(files: File[]): Promise<{ name: string; files: SourceFile[]; left: number }> {
  const path = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
  const name = path(files[0] ?? new File([], "code")).split("/")[0] || "code";
  const wanted = files.filter((f) => {
    const parts = path(f).split("/").slice(1);
    const file = parts[parts.length - 1] ?? "";
    return (
      EXTENSIONS.test(file) &&
      !/\.d\.ts$|\.min\.js$/i.test(file) &&
      f.size <= MAX_FILE &&
      parts.slice(0, -1).every((d) => !SKIP_DIRS.has(d) && !d.startsWith("."))
    );
  });
  const out: SourceFile[] = [];
  for (const f of wanted.slice(0, MAX_FILES)) out.push({ path: path(f).split("/").slice(1).join("/"), text: await f.text() });
  return { name, files: out, left: Math.max(0, wanted.length - MAX_FILES) };
}

export async function readFolder(files: File[]): Promise<Loaded> {
  const { name, files: sources } = await sourceFiles(files);
  if (!sources.length) throw new Error("No Java, Kotlin, C#, Go, Python, TypeScript or JavaScript files in that folder");
  let source: CodeSource;
  if (inTauri) {
    const r = await commands.codeReadFiles(name, sources);
    if (r.status === "error") throw new Error(r.error);
    source = r.data;
  } else {
    source = await post<CodeSource>("/code/files", { name, files: sources });
  }
  const loaded = { source, local: inTauri, from: name };
  setLastCode(loaded);
  return loaded;
}

export async function readRepo(url: string, branch?: string): Promise<Loaded> {
  const source = await post<CodeSource>("/code/repo", { url, branch: branch || null });
  const loaded = { source, local: false, from: url };
  setLastCode(loaded);
  return loaded;
}

/** The activity diagram of a function, following its calls `depth` deep */
export async function activityOf(code: Loaded, entry: string, depth: number): Promise<CodeActivity> {
  if (code.local) {
    const r = await commands.codeActivity(code.source.id, entry, depth);
    if (r.status === "error") throw new Error(r.error);
    return r.data;
  }
  return post<CodeActivity>(`/code/${code.source.id}/activity`, { entry, depth });
}
