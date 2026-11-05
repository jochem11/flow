// The logged-in user, and logging in: email + password, or Google.
//
// Web: the server keeps the session in a cookie. Desktop: the server hands the
// app a token (see server.ts). Google in the desktop app goes through the system
// browser and comes back to a one-time local port (`start_login_listener`).

import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createSignal } from "solid-js";
import { commands } from "../bindings";
import { get, inTauri, post, ServerError, serverUrl, setToken, loadToken, whenLoggedOut } from "./server";
import type { Me } from "./types";

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
  if (me()) setMe(null);
});

/** On startup: who is logged in, if anyone, and how this server lets people log in. */
export async function initAuth() {
  await loadToken();
  setServerProblem(null);
  try {
    setGoogleEnabled((await get<{ google: boolean }>("/auth/providers")).google);
    setMe(await get<Me>("/auth/me"));
  } catch (e) {
    if (e instanceof ServerError && e.status === 0) setServerProblem(e.message);
    setMe(null);
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

export async function logout() {
  await post<void>("/auth/logout").catch(() => {});
  await setToken(null);
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
