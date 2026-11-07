// Account settings: name, email (confirmed again by mail), password, the
// devices you are logged in on, and deleting the account. The server asks for
// the current password where it matters (server/src/routes/account.rs).

import { createResource, createSignal, For, type JSX, Show } from "solid-js";
import { errMsg } from "../lib/api";
import { accountSessions, deleteAccount, logOutOthers, logOutSession, me, resendVerification, setEmail, setName, setPassword } from "../lib/auth";
import { toast } from "../lib/toast";
import { Dialog } from "./Dialog";

/** "Chrome on macOS", "Flow for desktop", … from a user agent */
export function deviceName(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  if (/tauri|flowapp/i.test(ua)) return "Flow desktop app";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "A browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** A part of the dialog with a title */
function Part(p: { title: string; children: JSX.Element; danger?: boolean }) {
  return (
    <section class="account-part" classList={{ danger: p.danger }}>
      <h4>{p.title}</h4>
      {p.children}
    </section>
  );
}

/** Runs an action with a busy state and the server's answer as a toast */
function useAction() {
  const [busy, setBusy] = createSignal(false);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
      return true;
    } catch (e) {
      toast(errMsg(e), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function AccountDialog(p: { onClose: () => void }) {
  const m = () => me()!;
  const { busy, run } = useAction();

  const [name, setNameDraft] = createSignal(m().user.name);
  const [email, setEmailDraft] = createSignal("");
  const [emailPassword, setEmailPassword] = createSignal("");
  const [current, setCurrent] = createSignal("");
  const [next, setNext] = createSignal("");
  const [again, setAgain] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [sessions, { refetch }] = createResource(accountSessions);

  return (
    <Dialog title="Account" onClose={p.onClose}>
      <div class="account-settings">
        <Part title="Name">
          <form
            class="account-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => setName(name()), "Name changed");
            }}
          >
            <input class="panel-field" aria-label="Name" value={name()} maxLength={80} onInput={(e) => setNameDraft(e.currentTarget.value)} />
            <button class="text-btn" disabled={busy() || !name().trim() || name().trim() === m().user.name}>
              Save
            </button>
          </form>
        </Part>

        <Part title="Email">
          <p class="account-note">
            {m().user.email}{" "}
            <Show
              when={m().emailVerified}
              fallback={
                <>
                  <span class="account-badge warn">not confirmed</span>{" "}
                  <button class="link-btn" onClick={() => void run(resendVerification, "Mail sent: open the link in it")}>
                    Send the mail again
                  </button>
                </>
              }
            >
              <span class="account-badge">confirmed</span>
            </Show>
          </p>
          <Show when={m().hasPassword} fallback={<p class="account-note">Choose a password below to be able to change your email.</p>}>
            <form
              class="account-row"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => setEmail(email(), emailPassword()), "Check your new address: a mail asks you to confirm it")) {
                  setEmailDraft("");
                  setEmailPassword("");
                }
              }}
            >
              <input class="panel-field" type="email" placeholder="New address" aria-label="New email address" value={email()} onInput={(e) => setEmailDraft(e.currentTarget.value)} />
              <input class="panel-field" type="password" placeholder="Password" aria-label="Your password" autocomplete="current-password" value={emailPassword()} onInput={(e) => setEmailPassword(e.currentTarget.value)} />
              <button class="text-btn" disabled={busy() || !email().includes("@") || !emailPassword()}>
                Change
              </button>
            </form>
          </Show>
        </Part>

        <Part title={m().hasPassword ? "Password" : "Choose a password"}>
          <Show when={!m().hasPassword}>
            <p class="account-note">You log in with Google. A password lets you log in without it too.</p>
          </Show>
          <form
            class="account-fields"
            onSubmit={async (e) => {
              e.preventDefault();
              if (next() !== again()) return toast("The two new passwords are not the same", "error");
              if (await run(() => setPassword(m().hasPassword ? current() : null, next()), "Password changed; your other devices were logged out")) {
                setCurrent("");
                setNext("");
                setAgain("");
                void refetch();
              }
            }}
          >
            <Show when={m().hasPassword}>
              <input class="panel-field" type="password" placeholder="Current password" aria-label="Current password" autocomplete="current-password" value={current()} onInput={(e) => setCurrent(e.currentTarget.value)} />
            </Show>
            <input class="panel-field" type="password" placeholder="New password (8 or more characters)" aria-label="New password" autocomplete="new-password" value={next()} onInput={(e) => setNext(e.currentTarget.value)} />
            <input class="panel-field" type="password" placeholder="New password again" aria-label="New password again" autocomplete="new-password" value={again()} onInput={(e) => setAgain(e.currentTarget.value)} />
            <button class="text-btn" disabled={busy() || next().length < 8 || (m().hasPassword && !current())}>
              {m().hasPassword ? "Change password" : "Set password"}
            </button>
          </form>
        </Part>

        <Part title="Logged in on">
          <div class="account-sessions">
            <For each={sessions() ?? []} fallback={<p class="account-note">{sessions.loading ? "Loading…" : "No other devices."}</p>}>
              {(x) => (
                <div class="account-session">
                  <span>
                    {deviceName(x.userAgent)}
                    <Show when={x.current}>
                      <span class="account-badge">this one</span>
                    </Show>
                  </span>
                  <small>since {new Date(x.createdAt).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</small>
                  <Show when={!x.current}>
                    <button class="link-btn" onClick={() => void run(() => logOutSession(x.id), "Logged out there").then(() => refetch())}>
                      Log out
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={(sessions() ?? []).length > 1}>
            <button class="text-btn small" onClick={() => void run(logOutOthers, "Logged out everywhere else").then(() => refetch())}>
              Log out all other devices
            </button>
          </Show>
        </Part>

        <Part title="Delete account" danger>
          <p class="account-note">
            Your account goes, with the projects that are yours alone. Projects others are in stay: give each to one of them first (People → Make owner). This cannot be undone.
          </p>
          <form
            class="account-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => deleteAccount(m().hasPassword ? { password: confirm() } : { email: confirm() }));
            }}
          >
            <input
              class="panel-field"
              type={m().hasPassword ? "password" : "email"}
              placeholder={m().hasPassword ? "Your password" : `Type ${m().user.email}`}
              aria-label={m().hasPassword ? "Your password, to confirm" : "Your email address, to confirm"}
              value={confirm()}
              onInput={(e) => setConfirm(e.currentTarget.value)}
            />
            <button class="text-btn danger" disabled={busy() || !confirm()}>
              Delete my account
            </button>
          </form>
        </Part>
      </div>
    </Dialog>
  );
}
