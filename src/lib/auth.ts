// The logged-in user, and logging in: email + password, or Google.
//
// Web: the server keeps the session in a cookie. Desktop: the server hands the
// app a token (see server.ts). Google in the desktop app goes through the system
// browser and comes back to a one-time local port (`start_login_listener`).

import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createSignal } from "solid-js";
import { commands } from "../bindings";
import { del, get, inTauri, post, put, ServerError, serverUrl, setToken, loadToken, whenLoggedOut } from "./server";
import type { AccountSession, Me } from "./types";
import { clearOffline } from "./offline";

const [me, setMe] = createSignal<Me | null>(null);
const [authReady, setAuthReady] = createSignal(false);
const [googleEnabled, setGoogleEnabled] = createSignal(false);
/** Why the server could not be asked (no connection), shown on the login screen */
const [serverProblem, setServerProblem] = createSignal<string | null>(null);
export { authReady, googleEnabled, me, serverProblem };

/** A guest on a share link wants to log in (Gate shows the login screen, then the same board). */
export const [loginRequested, setLoginRequested] = createSignal(false);

type LoggedIn = { me: Me; token?: string };

async function finish(r: LoggedIn) {
  if (r.token) await setToken(r.token);
  setMe(r.me);
}

// A session that ended (expired, or logged out elsewhere) shows the login screen
whenLoggedOut(() => {
  localStorage.removeItem(ME_KEY);
  void clearOffline();
  if (me()) setMe(null);
});

/** On startup: who is logged in, if anyone, and how this server lets people log in. */
/** Who was logged in on this device, for opening the app offline */
const ME_KEY = "flowapp:me";

export async function initAuth() {
  await loadToken();
  setServerProblem(null);
  try {
    setGoogleEnabled((await get<{ google: boolean }>("/auth/providers")).google);
    const m = await get<Me>("/auth/me");
    setMe(m);
    // Remembered, to open the app without a connection next time
    localStorage.setItem(ME_KEY, JSON.stringify(m));
  } catch (e) {
    const offline = e instanceof ServerError && e.status === 0;
    const known = offline ? localStorage.getItem(ME_KEY) : null;
    if (known) {
      // Offline, but logged in here before: work from what this device keeps
      setMe(JSON.parse(known) as Me);
    } else {
      if (offline) setServerProblem((e as ServerError).message);
      if (!offline) localStorage.removeItem(ME_KEY);
      setMe(null);
    }
  } finally {
    setAuthReady(true);
  }
}

export const login = (email: string, password: string) => post<LoggedIn>("/auth/login", { email, password }).then(finish);

export const register = (email: string, name: string, password: string) => post<LoggedIn>("/auth/register", { email, name, password }).then(finish);

export const forgotPassword = (email: string) => post<void>("/auth/forgot", { email });

export const resetPassword = (token: string, password: string) => post<LoggedIn>("/auth/reset", { token, password }).then(finish);

/** Confirms the address from the mailed link (also when not logged in on this device). */
export async function verifyEmail(token: string) {
  const confirmed = await post<Me>("/auth/verify", { token });
  if (me()?.user.id === confirmed.user.id) setMe(confirmed);
}

export const resendVerification = () => post<void>("/auth/resend-verification");

// ---------- account settings (server/src/routes/account.rs) ----------

export const setName = async (name: string) => setMe(await put<Me>("/account/name", { name }));
export const setPassword = (current: string | null, newPassword: string) => put<void>("/account/password", { current, newPassword });
export const setEmail = async (email: string, password: string) => setMe(await put<Me>("/account/email", { email, password }));
export const accountSessions = () => get<AccountSession[]>("/account/sessions");
export const logOutSession = (id: string) => del<void>(`/account/sessions/${id}`);
export const logOutOthers = () => del<void>("/account/sessions");

/** Deletes the account (with its own projects); back to the login screen. */
export async function deleteAccount(confirm: { password?: string; email?: string }) {
  await del<void>("/account", confirm);
  await setToken(null);
  localStorage.removeItem(ME_KEY);
  await clearOffline();
  location.reload();
}

export async function logout() {
  await post<void>("/auth/logout").catch(() => {});
  await setToken(null);
  // Nothing of this account stays on the device
  localStorage.removeItem(ME_KEY);
  await clearOffline();
  // Start clean: no projects or boards of this account stay in memory
  location.reload();
}

/** The desktop app finishes a sign-in with the one-time code it got back (loopback or `flowapp://auth`). */
export const exchangeCode = async (code: string) => finish(await post<LoggedIn>("/auth/exchange", { code }));

/** The desktop app's Google sign-in that is waiting for the browser, if any */
let waitingForGoogle: (() => void) | null = null;

/**
 * Google: the web version goes there and comes back (a new page load). The desktop
 * app opens the browser and returns at once; when the sign-in comes back, later,
 * it calls `onDone` (logged in) or `onError`.
 */
export async function loginWithGoogle(onDone: () => void, onError: (e: unknown) => void) {
  if (!inTauri) {
    location.href = "/api/auth/google/start";
    return;
  }
  // Pressed again: only the newest sign-in counts
  waitingForGoogle?.();
  const port = await commands.startLoginListener();
  if (port.status === "error") throw port.error;
  const stop = await listen<string>("login-code", async (e) => {
    stop();
    waitingForGoogle = null;
    try {
      await exchangeCode(e.payload);
      onDone();
    } catch (err) {
      onError(err);
    }
  });
  waitingForGoogle = stop;
  await openUrl(`${serverUrl()}/api/auth/google/start?client=desktop&port=${port.data}`);
}
