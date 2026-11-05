// The logged-in user at the bottom of the sidebar (log out, upload the desktop
// app's old projects), and the reminder to confirm the email address.

import { createResource, createSignal, For, Show } from "solid-js";
import { logout, me, resendVerification } from "../lib/auth";
import { errMsg } from "../lib/api";
import { get, inTauri, post } from "../lib/server";
import { reloadProjects, saveNow } from "../lib/workspace";
import { updateReady } from "../lib/version";
import { inviteWhat, roleWords, type InviteInfo } from "./Gate";
import { toast } from "../lib/toast";
import { Menu } from "./Menu";
import { UploadDialog } from "./UploadDialog";

/** A round picture, or the first letter of the name. */
export function Avatar(p: { name: string; url?: string | null; size?: number }) {
  const size = () => p.size ?? 26;
  return (
    <Show
      when={p.url}
      fallback={
        <span class="avatar" style={{ width: `${size()}px`, height: `${size()}px`, "font-size": `${size() * 0.45}px` }}>
          {p.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      }
    >
      <img class="avatar" src={p.url!} alt="" referrerPolicy="no-referrer" style={{ width: `${size()}px`, height: `${size()}px` }} />
    </Show>
  );
}

export function AccountMenu() {
  const [uploading, setUploading] = createSignal(false);
  return (
    <Show when={me()}>
      {(m) => (
        <div class="account">
          <Menu
            align="left"
            up
            button={(toggle) => (
              <button class="account-btn" onClick={toggle} title={m().user.email}>
                <Avatar name={m().user.name} url={m().user.avatarUrl} />
                <span class="account-name">{m().user.name}</span>
              </button>
            )}
          >
            {(close) => (
              <>
                <div class="menu-title">{m().user.email}</div>
                <Show when={inTauri}>
                  <button
                    class="menu-item"
                    onClick={() => {
                      setUploading(true);
                      close();
                    }}
                  >
                    <span>Upload projects from this computer…</span>
                  </button>
                </Show>
                <button class="menu-item" onClick={logout}>
                  <span>Log out</span>
                </button>
              </>
            )}
          </Menu>
          <Show when={uploading()}>
            <UploadDialog onClose={() => setUploading(false)} />
          </Show>
        </div>
      )}
    </Show>
  );
}

export function VerifyBanner() {
  const [hidden, setHidden] = createSignal(false);
  const [sent, setSent] = createSignal(false);
  const resend = async () => {
    try {
      await resendVerification();
      setSent(true);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Show when={me() && !me()!.emailVerified && !hidden()}>
      <div class="verify-banner">
        <span>
          Confirm your email address ({me()!.user.email}) with the link we sent, so people can share boards with you.
        </span>
        <Show when={!sent()} fallback={<span class="verify-sent">Sent</span>}>
          <button class="link-btn" onClick={resend}>
            Send again
          </button>
        </Show>
        <button class="icon-btn small" title="Hide" onClick={() => setHidden(true)}>
          ×
        </button>
      </div>
    </Show>
  );
}

/** A newer version is on the server than the one running in this tab: reload for it. */
export function UpdateBanner() {
  const [hidden, setHidden] = createSignal(false);
  return (
    <Show when={updateReady() && !hidden()}>
      <div class="verify-banner">
        <span>Flow has been updated. Reload to use the new version.</span>
        <button
          class="link-btn"
          onClick={async () => {
            // What is not saved yet goes first
            await saveNow();
            location.reload();
          }}
        >
          Reload
        </button>
        <button class="icon-btn small" title="Hide" onClick={() => setHidden(true)}>
          ×
        </button>
      </div>
    </Show>
  );
}

/** Invitations waiting for an answer (for the user's confirmed address). */
export function InvitesBanner() {
  const [invites, { mutate }] = createResource(
    () => me()?.emailVerified && me()!.user.id,
    () => get<InviteInfo[]>("/invites/mine").catch(() => []),
  );
  const answer = async (i: InviteInfo, accept: boolean) => {
    try {
      await post("/invites/respond", { id: i.id, accept });
      mutate((list) => list?.filter((x) => x.id !== i.id));
      toast(accept ? `You joined ${inviteWhat(i)}` : "Invitation declined");
      if (accept) await reloadProjects();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <For each={invites() ?? []}>
      {(i) => (
        <div class="verify-banner invite-banner">
          <span>
            {i.invitedBy} invited you to {inviteWhat(i)}, where you could {roleWords(i.role)}.
          </span>
          <button class="text-btn primary" onClick={() => answer(i, true)}>
            Accept
          </button>
          <button class="text-btn" onClick={() => answer(i, false)}>
            Decline
          </button>
        </div>
      )}
    </For>
  );
}

