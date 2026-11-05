// Images on a flowchart: uploaded to the server (server/src/routes/files.rs),
// shown from there. They are fetched with the same login as every request (the
// desktop app has no cookie) and kept as object URLs for as long as the app runs.

import { createSignal } from "solid-js";
import { errMsg } from "./api";
import { fetchBlob, post, uploadFile } from "./server";
import { addNode, createNode, snap } from "./store";
import { toast } from "./toast";
import { openDoc } from "./workspace";

const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const isImageFile = (f: File | Blob) => TYPES.includes(f.type);

const urls = new Map<string, () => string | null>();

/** The object URL of a file, once it is fetched (null until then, or when it cannot be) */
export function imageUrl(id: string): string | null {
  let get = urls.get(id);
  if (!get) {
    const [url, setUrl] = createSignal<string | null>(null);
    get = url;
    urls.set(id, get);
    fetchBlob(`/files/${id}`)
      .then((b) => setUrl(URL.createObjectURL(b)))
      .catch(() => setUrl(null));
  }
  return get();
}

/** How big an image shows: its own size, at most 480 wide or high */
function fitted(file: Blob): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 480 / Math.max(img.naturalWidth, img.naturalHeight));
      resolve({ w: Math.max(40, snap(img.naturalWidth * k)), h: Math.max(40, snap(img.naturalHeight * k)) });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ w: 240, h: 160 });
    img.src = url;
  });
}

/** Uploads images to the open board and puts them there, side by side from (x, y). */
export async function addImages(files: File[], at: { x: number; y: number }) {
  const doc = openDoc();
  if (!doc?.role) return toast("Images can be added to boards on the server", "error");
  let x = at.x;
  for (const file of files.filter(isImageFile)) {
    try {
      const [size, up] = await Promise.all([fitted(file), uploadFile<{ id: string; name: string }>(`/documents/${doc.id}/files`, file, file.name || "image")]);
      const node = createNode("image", 0, 0, { image: up.id, text: up.name, w: size.w, h: size.h });
      node.x = snap(x);
      node.y = snap(at.y - size.h / 2);
      addNode(node);
      x += size.w + 20;
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }
  if (files.some((f) => !isImageFile(f))) toast("Only PNG, JPEG, GIF and WebP images can be added", "error");
}

/** An image pasted from another board: a copy of its file for this board. */
export async function copyImage(id: string): Promise<string | null> {
  const doc = openDoc();
  if (!doc) return null;
  try {
    return (await post<{ id: string }>(`/files/${id}/copy`, { documentId: doc.id })).id;
  } catch (e) {
    toast(errMsg(e), "error");
    return null;
  }
}
