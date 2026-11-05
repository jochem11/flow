// What the app shows before the workspace: logging in, and the pages that links
// open (confirming an email, a new password, an invitation, a share link).
// Once someone is in, `children` (the workspace) takes over.

import { createEffect, createSignal, type JSX, Match, onMount, Show, Switch } from "solid-js";
import { errMsg } from "../lib/api";
import { authReady, exchangeCode, initAuth, loginRequested, logout, me, setLoginRequested, verifyEmail } from "../lib/auth";
import { clearIncoming, incoming, listenForLinks, openInChoice, rememberOpenIn, showPath, startRoute, tryApp, type Route } from "../lib/route";
import { inTauri } from "../lib/server";
import { get, post, ServerError } from "../lib/server";
import { toast } from "../lib/toast";
import type { SharedBoard } from "../lib/types";
import { accessLost, initWorkspace, openAsGuest, openDocument } from "../lib/workspace";
import { LoginScreen } from "./LoginScreen";

type Screen =
  | { kind: "loading" }
  | { kind: "login"; note?: string; email?: string }
  | { kind: "reset"; token: string }
  | { kind: "message"; title: string; body: string; request?: string }
  /** An invitation, to accept or decline */
  | { kind: "invitation"; token: string; info: InviteInfo }
  | { kind: "app" }
  | { kind: "guest" }
  /** Web: a board link, for someone who may have the desktop app */
  | { kind: "choose"; route: Route; path: string };

export interface InviteInfo {
  id: string;
  email: string;
  role: string;
  invitedBy: string;
  projectName: string;
  documentName: string | null;
}

export function Gate(p: { children: JSX.Element; guest: JSX.Element }) {
  const [screen, setScreen] = createSignal<Screen>({ kind: "loading" });
  // What to open once logged in
  let pending: Route = startRoute();

  /** Opens `route`, or shows what is needed first. */
  async function start(route: Route) {
    pending = route;
    if (route.kind === "verify") {
      try {
        await verifyEmail(route.token);
        toast("Your email address is confirmed");
      } catch (e) {
        toast(errMsg(e), "error");
      }
      return start({ kind: "home" });
    }
    if (route.kind === "reset") {
      if (me()) return start({ kind: "home" });
      return setScreen({ kind: "reset", token: route.token });
    }
    if (route.kind === "invite") return invite(route.token);
    if (route.kind === "share") return share(route.token);
    if (!me()) return setScreen({ kind: "login" });
    setScreen({ kind: "app" });
    await initWorkspace(route);
  }

  async function invite(token: string) {
    let info: InviteInfo;
    try {
      info = await get<InviteInfo>(`/invites/${token}`);
    } catch (e) {
      return setScreen({ kind: "message", title: "This invitation does not work", body: errMsg(e) });
    }
    if (!me()) return setScreen({ kind: "login", email: info.email, note: `${info.invitedBy} invited ${info.email} to ${inviteWhat(info)}. Log in or create an account with that address to answer.` });
    setScreen({ kind: "invitation", token, info });
  }

  async function answer(token: string, info: InviteInfo, accept: boolean) {
    try {
      const r = await post<{ projectId: string; documentId: string | null }>("/invites/respond", { token, accept });
      showPath("/");
      if (!accept) {
        toast("Invitation declined");
        return start({ kind: "home" });
      }
      toast(`You joined ${inviteWhat(info)}`);
      setScreen({ kind: "app" });
      await initWorkspace(r.documentId ? { kind: "doc", id: r.documentId } : { kind: "project", id: r.projectId });
    } catch (e) {
      setScreen({ kind: "message", title: "This invitation could not be answered", body: errMsg(e) });
    }
  }

  async function share(token: string) {
    try {
      const board = await get<SharedBoard>(`/share/${token}`);
      if (me()) {
        setScreen({ kind: "app" });
        await initWorkspace({ kind: "home" });
        await openDocument(board.projectId, board.documentId, { token, role: board.role });
      } else {
        setScreen({ kind: "guest" });
        await openAsGuest(board, token);
      }
      showPath(`/b/${token}`);
    } catch (e) {
      const status = e instanceof ServerError ? e.status : 0;
      if (status === 401) return setScreen({ kind: "login", note: "Log in to open this board." });
      if (status === 403) return setScreen({ kind: "message", title: "You don't have access to this board", body: "Ask its owner to share it with you.", request: token });
      setScreen({ kind: "message", title: "This link does not work", body: errMsg(e) });
    }
  }

  onMount(async () => {
    await initAuth();
    // Desktop: links into the app (also the one that started it)
    void listenForLinks(async (code) => {
      try {
        await exchangeCode(code);
        await start(pending);
      } catch (e) {
        toast(errMsg(e), "error");
      }
    });
    // Web: a board link may go to the desktop app instead
    const path = location.pathname;
    if (!inTauri && (pending.kind === "share" || pending.kind === "doc")) {
      const choice = openInChoice();
      if (choice === "app" && (await tryApp(path))) {
        return setScreen({ kind: "message", title: "Opened in the Flow app", body: "You can close this tab." });
      }
      if (choice === null) return setScreen({ kind: "choose", route: pending, path });
    }
    await start(pending);
  });

  // A link opened while the app runs
  createEffect(() => {
    const r = incoming();
    if (!r) return;
    clearIncoming();
    void start(r);
  });

  const [rememberChoice, setRememberChoice] = createSignal(true);
  const choose = async (where: "app" | "web", route: Route, path: string) => {
    if (rememberChoice()) rememberOpenIn(where);
    if (where === "app" && (await tryApp(path))) {
      return setScreen({ kind: "message", title: "Opened in the Flow app", body: "You can close this tab." });
    }
    await start(route);
  };

  // A guest whose link stopped working (access changed while the board was open)
  createEffect(() => {
    const lost = accessLost();
    if (lost && screen().kind === "guest") {
      setScreen({ kind: "message", title: "You no longer have access to this board", body: `\u201c${lost}\u201d is no longer shared through this link. Ask its owner for access.` });
    }
  });

  // A guest asks to log in: the login screen, then the same link again
  createEffect(() => {
    if (loginRequested() && screen().kind === "guest") {
      setLoginRequested(false);
      setScreen({ kind: "login", note: "Log in to open this board with your account." });
    }
  });

  const [asked, setAsked] = createSignal(false);
  const requestAccess = async (token: string) => {
    try {
      await post(`/share/${token}/request-access`, {});
      setAsked(true);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <Switch>
      <Match when={!authReady() || screen().kind === "loading"}>
        <div class="auth-screen">
          <div class="main-empty">Loading…</div>
        </div>
      </Match>
      <Match when={screen().kind === "app" && me()}>{p.children}</Match>
      <Match when={screen().kind === "invitation" && (screen() as Extract<Screen, { kind: "invitation" }>)}>
        {(inv) => (
          <div class="auth-screen">
            <div class="auth-card panel">
              <div class="auth-logo">
                <span class="logo" aria-hidden="true" />
                <span>Flow</span>
              </div>
              <h1>You are invited</h1>
              <p class="auth-note">
                {inv().info.invitedBy} invited you to {inviteWhat(inv().info)}.
              </p>
              <p class="invite-role">
                You would be able to <strong>{roleWords(inv().info.role)}</strong>.
              </p>
              <Show
                when={inv().info.email === me()?.user.email}
                fallback={
                  <p class="auth-error">
                    This invitation is for {inv().info.email}; you are logged in as {me()?.user.email}.
                  </p>
                }
              >
                <button class="text-btn primary auth-submit" onClick={() => answer(inv().token, inv().info, true)}>
                  Accept and open
                </button>
                <button class="text-btn auth-google" onClick={() => answer(inv().token, inv().info, false)}>
                  Decline
                </button>
              </Show>
              <div class="auth-links">
                <button class="link-btn" onClick={() => start({ kind: "home" })}>
                  Decide later
                </button>
                <Show when={inv().info.email !== me()?.user.email}>
                  <button class="link-btn" onClick={logout}>
                    Log in as {inv().info.email}
                  </button>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Match>
      <Match when={screen().kind === "choose" && (screen() as Extract<Screen, { kind: "choose" }>)}>
        {(c) => (
          <div class="auth-screen">
            <div class="auth-card panel">
              <div class="auth-logo">
                <span class="logo" aria-hidden="true" />
                <span>Flow</span>
              </div>
              <h1>Open this board</h1>
              <p class="auth-note">Do you have the Flow app on this computer? Then it can open there.</p>
              <button class="text-btn primary auth-submit" onClick={() => choose("web", c().route, c().path)}>
                Continue in the browser
              </button>
              <button class="text-btn auth-google" onClick={() => choose("app", c().route, c().path)}>
                Open in the Flow app
              </button>
              <label class="remember">
                <input type="checkbox" checked={rememberChoice()} onChange={(e) => setRememberChoice(e.currentTarget.checked)} />
                <span>Remember my choice</span>
              </label>
            </div>
          </div>
        )}
      </Match>
      <Match when={screen().kind === "guest"}>{p.guest}</Match>
      <Match when={screen().kind === "reset" && (screen() as { token: string }).token}>
        {(token) => <LoginScreen resetToken={token()} onDone={() => start({ kind: "home" })} />}
      </Match>
      <Match when={screen().kind === "message" && (screen() as Extract<Screen, { kind: "message" }>)}>
        {(m) => (
          <div class="auth-screen">
            <div class="auth-card panel">
              <h1>{m().title}</h1>
              <p class="auth-note">{m().body}</p>
              <Show when={m().request}>
                {(token) => (
                  <Show when={!asked()} fallback={<p class="auth-note">Your request was sent to the owner.</p>}>
                    <button class="text-btn primary auth-submit" onClick={() => requestAccess(token())}>
                      Request access
                    </button>
                  </Show>
                )}
              </Show>
              <div class="auth-links">
                <button class="link-btn" onClick={() => start({ kind: "home" })}>
                  Go to my projects
                </button>
                <Show when={me()}>
                  <button class="link-btn" onClick={logout}>
                    Log in as someone else
                  </button>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Match>
      {/* Logged out, or the session ended while working */}
      <Match when={true}>
        <LoginScreen
          note={(screen() as { note?: string }).note}
          email={(screen() as { email?: string }).email}
          onDone={() => start(pending.kind === "reset" || pending.kind === "verify" ? { kind: "home" } : pending)}
        />
      </Match>
    </Switch>
  );
}

/** "the board “X”" or "the project “Y”" */
export const inviteWhat = (i: InviteInfo) => (i.documentName ? `the board \u201c${i.documentName}\u201d` : `the project \u201c${i.projectName}\u201d`);

/** What a role lets someone do, in words */
export function roleWords(role: string) {
  switch (role) {
    case "coOwner":
      return "view, comment and edit everything, and invite and remove people";
    case "editor":
      return "view, comment and edit";
    case "commenter":
      return "view and comment";
    default:
      return "view";
  }
}

