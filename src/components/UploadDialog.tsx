// Moving the projects the desktop app kept on this computer (from before
// accounts) to the server, with their ids so links between boards keep working.
// The files stay where they are; uploading twice skips what is already there.

import { createResource, createSignal, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { errMsg, localFiles } from "../lib/api";
import { post, ServerError } from "../lib/server";
import { toast } from "../lib/toast";
import type { Project } from "../lib/types";
import { reloadProjects } from "../lib/workspace";
import { IconClose } from "./icons";

type Status = "waiting" | "uploading" | "done" | "skipped" | { error: string };

export function UploadDialog(p: { onClose: () => void }) {
  const [local] = createResource(() => localFiles.listProjects().catch(() => [] as Project[]));
  const [picked, setPicked] = createSignal<Set<string> | null>(null);
  const [status, setStatus] = createSignal<Record<string, Status>>({});
  const [busy, setBusy] = createSignal(false);
  const chosen = () => picked() ?? new Set((local() ?? []).map((x) => x.id));
  const mark = (id: string, s: Status) => setStatus((all) => ({ ...all, [id]: s }));

  const uploadOne = async (project: Project) => {
    mark(project.id, "uploading");
    let skipped = false;
    try {
      await post("/projects", { id: project.id, name: project.name, description: project.description, folders: project.folders });
    } catch (e) {
      if (!(e instanceof ServerError && e.status === 409)) throw e;
      skipped = true; // uploaded before: add what is missing
    }
    for (const meta of await localFiles.listDocuments(project.id)) {
      const doc = await localFiles.loadDocument(project.id, meta.id);
      try {
        await post(`/projects/${project.id}/upload`, doc);
        skipped = false;
      } catch (e) {
        if (!(e instanceof ServerError && e.status === 409)) throw e;
      }
    }
    mark(project.id, skipped ? "skipped" : "done");
  };

  const upload = async () => {
    setBusy(true);
    for (const project of (local() ?? []).filter((x) => chosen().has(x.id))) {
      try {
        await uploadOne(project);
      } catch (e) {
        mark(project.id, { error: errMsg(e) });
      }
    }
    await reloadProjects();
    setBusy(false);
    toast("Upload finished");
  };

  const label = (s: Status | undefined) =>
    s === undefined || s === "waiting" ? "" : s === "uploading" ? "Uploading…" : s === "done" ? "Uploaded" : s === "skipped" ? "Already there" : s.error;

  return (
    <Portal>
      <div class="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy() && p.onClose()}>
        <div class="sql-dialog upload-dialog panel">
          <div class="sql-dialog-head">
            <strong>Upload projects from this computer</strong>
            <span class="import-hint">They become yours on the server; the files here are kept.</span>
            <button class="icon-btn" title="Close" disabled={busy()} onClick={p.onClose}>
              <IconClose />
            </button>
          </div>
          <div class="upload-list">
            <Show when={!local.loading} fallback={<p class="import-note">Looking for projects…</p>}>
              <For each={local()} fallback={<p class="import-note">There are no projects on this computer.</p>}>
                {(project) => (
                  <label class="upload-row">
                    <input
                      type="checkbox"
                      checked={chosen().has(project.id)}
                      disabled={busy()}
                      onChange={(e) => {
                        const next = new Set(chosen());
                        if (e.currentTarget.checked) next.add(project.id);
                        else next.delete(project.id);
                        setPicked(next);
                      }}
                    />
                    <span class="upload-name">{project.name}</span>
                    <span class="upload-status" classList={{ error: typeof status()[project.id] === "object" }}>
                      {label(status()[project.id])}
                    </span>
                  </label>
                )}
              </For>
            </Show>
          </div>
          <div class="sql-dialog-foot">
            <button class="text-btn" disabled={busy()} onClick={p.onClose}>
              Close
            </button>
            <button class="text-btn primary" disabled={busy() || !chosen().size} onClick={upload}>
              Upload {chosen().size || ""}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
