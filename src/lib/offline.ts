// Working without a connection. What was loaded last (projects, the boards in
// them, each board) is kept on this device, so it opens offline too; a save
// that cannot reach the server is kept here and sent when the connection is
// back (also after a reload). Everything here is removed when you log out.
//
// The copies live in IndexedDB (this browser or app only), keyed by what they
// are: "projects", "docs:<project>", "doc:<id>", "pending:<id>".

import { createSignal } from "solid-js";
import type { Document } from "./types";

const DB = "flowapp-offline";
const STORE = "kv";

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (!db) {
    db = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return db;
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await open();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const kvGet = <T>(key: string) => tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>).catch(() => undefined);
export const kvSet = (key: string, value: unknown) => tx("readwrite", (s) => s.put(value, key)).catch(() => undefined);
export const kvDel = (key: string) => tx("readwrite", (s) => s.delete(key)).catch(() => undefined);
const kvKeys = () => tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys()).catch(() => [] as IDBValidKey[]);

/** Logging out: nothing of this account stays on the device. */
export const clearOffline = () => tx("readwrite", (s) => s.clear()).catch(() => undefined);

// ---------- online or not ----------

const [online, setOnline] = createSignal(typeof navigator === "undefined" ? true : navigator.onLine);
export { online };
/** Told by requests: one that could not reach the server, or one that did */
export const reachedServer = (yes: boolean) => setOnline(yes);
window.addEventListener("online", () => setOnline(true));
window.addEventListener("offline", () => setOnline(false));

/** Is this error "no connection" (rather than an answer from the server)? */
export const isOffline = (e: unknown) => !!e && typeof e === "object" && "status" in e && (e as { status: number }).status === 0;

/**
 * Loads something, keeping a copy; without a connection, the copy (when there
 * is one). Any other error is the server's answer and goes on as it is.
 */
export async function withCopy<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const value = await load();
    void kvSet(key, value);
    return value;
  } catch (e) {
    if (!isOffline(e)) throw e;
    const copy = await kvGet<T>(key);
    if (copy === undefined) throw e;
    return copy;
  }
}

// ---------- saves that wait for the connection ----------

/** A board that could not be saved: kept, and shown as it is now when opened again. */
export async function keepUnsaved(doc: Document) {
  await kvSet(`pending:${doc.id}`, doc);
  await kvSet(`doc:${doc.id}`, doc);
}

export const savedNow = (doc: Document) => Promise.all([kvDel(`pending:${doc.id}`), kvSet(`doc:${doc.id}`, doc)]);

/** Sends the saves that waited; returns how many went. Stops at the first that cannot. */
export async function sendUnsaved(save: (doc: Document) => Promise<void>): Promise<number> {
  let sent = 0;
  for (const key of await kvKeys()) {
    if (typeof key !== "string" || !key.startsWith("pending:")) continue;
    const doc = await kvGet<Document>(key);
    if (!doc) continue;
    try {
      await save(doc);
      await kvDel(key);
      sent++;
    } catch (e) {
      if (isOffline(e)) break;
      // The server said no (gone, no access): it cannot be saved there anymore
      await kvDel(key);
    }
  }
  return sent;
}
