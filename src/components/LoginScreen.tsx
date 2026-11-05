// Logging in: email + password or Google, creating an account, and resetting
// a forgotten password. Shown whenever nobody is logged in (except for guests
// on a share link), and on the page a reset mail links to.

import { createSignal, Match, Show, Switch } from "solid-js";
import { forgotPassword, googleEnabled, login, loginWithGoogle, register, resetPassword, serverProblem, initAuth } from "../lib/auth";
import { errMsg } from "../lib/api";
import { inTauri, serverUrl, setServerUrl } from "../lib/server";

type Mode = "login" | "register" | "forgot" | "reset";

export function LoginScreen(p: { note?: string; resetToken?: string; email?: string; onDone?: () => void }) {
  const [mode, setMode] = createSignal<Mode>(p.resetToken ? "reset" : "login");
  const [email, setEmail] = createSignal(p.email ?? "");
  const [name, setName] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [info, setInfo] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [server, setServer] = createSignal(serverUrl());

  const run = async (f: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: Event) => {
    e.preventDefault();
    void run(async () => {
      if (mode() === "login") await login(email(), password());
      else if (mode() === "register") await register(email(), name(), password());
      else if (mode() === "reset") await resetPassword(p.resetToken!, password());
      else {
        await forgotPassword(email());
        setInfo(`If there is an account for ${email()}, a mail with a link to reset the password is on its way.`);
        return;
      }
      p.onDone?.();
    });
  };

  // The desktop app comes back here once the browser is done (the web version reloads)
  const google = () =>
    run(() =>
      loginWithGoogle(
        () => p.onDone?.(),
        (e) => setError(errMsg(e)),
      ),
    );

  const go = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  return (
    <div class="auth-screen">
      <form class="auth-card panel" onSubmit={submit}>
        <div class="auth-logo">
          <span class="logo" aria-hidden="true" />
          <span>Flow</span>
        </div>
        <h1>
          <Switch>
            <Match when={mode() === "login"}>Log in</Match>
            <Match when={mode() === "register"}>Create your account</Match>
            <Match when={mode() === "forgot"}>Reset your password</Match>
            <Match when={mode() === "reset"}>Choose a new password</Match>
          </Switch>
        </h1>
        <Show when={p.note && mode() !== "reset"}>
          <p class="auth-note">{p.note}</p>
        </Show>
        <Show when={serverProblem()}>
          <p class="auth-error">{serverProblem()}</p>
        </Show>

        <Show when={mode() !== "reset"}>
          <label class="field">
            <span>Email</span>
            <input type="email" autocomplete="email" required value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
          </label>
        </Show>
        <Show when={mode() === "register"}>
          <label class="field">
            <span>Name</span>
            <input autocomplete="name" required value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </label>
        </Show>
        <Show when={mode() !== "forgot"}>
          <label class="field">
            <span>{mode() === "reset" ? "New password" : "Password"}</span>
            <input
              type="password"
              autocomplete={mode() === "login" ? "current-password" : "new-password"}
              minLength={mode() === "login" ? undefined : 8}
              required
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </label>
        </Show>

        <Show when={error()}>
          <p class="auth-error">{error()}</p>
        </Show>
        <Show when={info()}>
          <p class="auth-note">{info()}</p>
        </Show>

        <button class="text-btn primary auth-submit" type="submit" disabled={busy()}>
          <Switch>
            <Match when={mode() === "login"}>Log in</Match>
            <Match when={mode() === "register"}>Create account</Match>
            <Match when={mode() === "forgot"}>Send reset link</Match>
            <Match when={mode() === "reset"}>Save password and log in</Match>
          </Switch>
        </button>

        <Show when={googleEnabled() && (mode() === "login" || mode() === "register")}>
          <div class="auth-or">or</div>
          <button class="text-btn auth-google" type="button" disabled={busy()} onClick={google}>
            <GoogleMark />
            <span>Continue with Google</span>
          </button>
        </Show>

        <div class="auth-links">
          <Switch>
            <Match when={mode() === "login"}>
              <button type="button" class="link-btn" onClick={() => go("register")}>
                Create an account
              </button>
              <button type="button" class="link-btn" onClick={() => go("forgot")}>
                Forgot password?
              </button>
            </Match>
            <Match when={mode() !== "reset"}>
              <button type="button" class="link-btn" onClick={() => go("login")}>
                Back to log in
              </button>
            </Match>
          </Switch>
        </div>

        {/* The desktop app can use another server */}
        <Show when={inTauri}>
          <details class="auth-server">
            <summary>Server: {serverUrl()}</summary>
            <div class="auth-server-row">
              <input value={server()} onInput={(e) => setServer(e.currentTarget.value)} />
              <button
                type="button"
                class="text-btn"
                onClick={() => {
                  setServerUrl(server());
                  void initAuth();
                }}
              >
                Use
              </button>
            </div>
          </details>
        </Show>
      </form>
    </div>
  );
}

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
  </svg>
);
