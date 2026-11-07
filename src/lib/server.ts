// Talking to the Flow server (server/ in this repo).
//
// The web version is served by the server itself, so it calls `/api/...` on its
// own origin and logs in with a cookie. The desktop app calls the server's URL
// (VITE_SERVER_URL, or the one chosen on the login screen) with the session token
// it keeps in the system keychain.
//
// Every request carries `X-Flow` (the server refuses cookie requests that change
// something without it, against other sites acting for you) and, while a board
// is open through a share link, `X-Flow-Share`.

import { reachedServer } from "./offline";
import { commands } from "../bindings";

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const SERVER_KEY = "flowapp:server";
const DEFAULT_SERVER = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:8080";

/** The server's address ("" for the web version: the same origin). */
export function serverUrl(): string {
  if (!inTauri) return "";
  try {
    return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER;
  } catch {
    return DEFAULT_SERVER;
  }
}

export function setServerUrl(url: string) {
  try {
    localStorage.setItem(SERVER_KEY, url.trim().replace(/\/+$/, ""));
  } catch {
    /* storage unavailable */
  }
}

// ---------- the desktop app's session token (system keychain, via Rust) ----------

let token: string | null = null;

export async function loadToken() {
  if (!inTauri) return;
  const r = await commands.getSessionToken();
  token = r.status === "ok" ? r.data : null;
}

/** The desktop app's session token (the WebSocket sends it in its address) */
export const sessionToken = () => token;
/** The share link in use, if any */
export const currentShareToken = () => shareToken;

export async function setToken(t: string | null) {
  token = t;
  if (inTauri) await (t ? commands.setSessionToken(t) : commands.clearSessionToken());
}

// ---------- share links ----------

let shareToken: string | null = null;

/** While a board is open through its share link, requests say so. */
export function useShareToken(t: string | null) {
  shareToken = t;
}

// ---------- requests ----------

/** An error from the server, with its status (401: log in, 403: not allowed, 404: not there). */
export class ServerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = { "X-Flow": "1" };
  if (json) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  if (inTauri) h["X-Flow-Client"] = "desktop";
  if (shareToken) h["X-Flow-Share"] = shareToken;
  return h;
}

/** A request to `/api{path}`; the parsed JSON answer (undefined for an empty one). */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await rawRequest(method, path, body);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function rawRequest(method: string, path: string, body?: unknown): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}/api${path}`, {
      method,
      headers: headers(body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "include",
    });
  } catch {
    reachedServer(false);
    throw new ServerError(0, `Cannot reach the server${inTauri ? ` at ${serverUrl()}` : ""}. Check your connection.`);
  }
  reachedServer(true);
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) onLoggedOut?.();
    throw new ServerError(res.status, message);
  }
  return res;
}

/** Sends a file as it is (an image for a board); the server's JSON answer. */
export async function uploadFile<T>(path: string, file: Blob, name: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl()}/api${path}`, {
      method: "POST",
      headers: { ...headers(false), "Content-Type": file.type, "X-File-Name": encodeURIComponent(name) },
      body: file,
      credentials: "include",
    });
  } catch {
    throw new ServerError(0, "Cannot reach the server. Check your connection.");
  }
  const text = await res.text();
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = JSON.parse(text).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new ServerError(res.status, message);
  }
  return JSON.parse(text) as T;
}

/** A file from the server (an image), with the same login as every request. */
export async function fetchBlob(path: string): Promise<Blob> {
  return (await rawRequest("GET", path)).blob();
}

/** Set by auth.ts: what to do when the server says the session is gone. */
let onLoggedOut: (() => void) | undefined;
export function whenLoggedOut(f: () => void) {
  onLoggedOut = f;
}

export const get = <T>(path: string) => request<T>("GET", path);
export const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {});
export const del = <T>(path: string, body?: unknown) => request<T>("DELETE", path, body);
