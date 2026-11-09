// Sharing a board (the Share button in the top bar) and a project (its People).
//
// Board: who has access, each with their project role or the board's own role
// for them (also "No access"), inviting someone to this board or the whole
// project, and the board's link (only people with access, or anyone with it).
// Project: everyone in it, their project role, and per person a role per board,
// so someone can edit one board and only view another.
// The owner and co-owners change things; others see who has access.
// An invitation is always a mail asking whether they want to join.
// Access (next to the people on the board): who can do what on this board,
// changed right there; Share has the link and the rest.

import { BoardMenu } from "./BoardDialogs";
import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { errMsg } from "../lib/api";
import { me, setLoginRequested } from "../lib/auth";
import { ROLE_LABEL, roleCanManage } from "../lib/roles";
import { del, get, inTauri, post, put, serverUrl } from "../lib/server";
import { toast } from "../lib/toast";
import type { BoardAccess, Invite, LinkAccess, Member, Role, ShareLink } from "../lib/types";
import { docsOf, openDoc, projectById } from "../lib/workspace";
import { Avatar } from "./AccountMenu";
import { CommentsButton } from "./Comments";
import { Dialog } from "./Dialog";
import { BoardIcon } from "./kinds";
import { PresenceAvatars } from "./Presence";
import { IconPeople } from "./icons";

/** Roles for one board, and for a whole project (which can also be co-owner) */
const BOARD_ROLES: Role[] = ["viewer", "commenter", "editor"];
const PROJECT_ROLES: Role[] = ["viewer", "commenter", "editor", "coOwner"];

const LINK_LABEL: Record<LinkAccess, string> = {
  restricted: "Only people with access",
  view: "Anyone with the link can view",
  comment: "Anyone with the link can comment",
};

/** Has full access everywhere in the project (a board cannot change that) */
const fullAccess = (role: Role) => role === "owner" || role === "coOwner";

/** The address of a board's share link: the web version, served by the server. */
export const shareUrl = (token: string) => `${inTauri ? serverUrl() : location.origin}/b/${token}`;

/** What each role may do on a board */
export const ROLE_MEANS: Record<Role, string> = {
  none: "No access",
  viewer: "sees it",
  commenter: "sees it and comments",
  editor: "sees, comments and changes it",
  coOwner: "also decides who has access",
  owner: "also decides who has access (owns the project)",
};

/** What you may do, in your own words */
const YOU_CAN: Record<Role, string> = {
  none: "you have no access",
  viewer: "you can see it",
  commenter: "you can see it and comment",
  editor: "you can see it, comment and change it",
  coOwner: "you can change it and decide who has access",
  owner: "you can change it and decide who has access",
};

/** The Access panel is open (the role chip and the command palette open it too) */
const [accessOpen, setAccessOpen] = createSignal(false);
export { setAccessOpen };

/** Share's dialog is open (from Share, or from the Access panel) */
const [shareOpen, setShareOpen] = createSignal(false);

/** People, Access, Comments and Share (logged in) or Log in (a guest) in the top bar. */
export function ShareActions() {
  return (
    <div class="header-actions">
      <PresenceAvatars />
      <Show when={me() && openDoc()?.role}>
        <AccessButton />
      </Show>
      <CommentsButton />
      <BoardMenu />
      <Show
        when={me()}
        fallback={
          <button class="text-btn" onClick={() => setLoginRequested(true)}>
            Log in
          </button>
        }
      >
        <button class="text-btn share-btn" onClick={() => setShareOpen(true)}>
          Share
        </button>
        <Show when={shareOpen() && openDoc()}>{(doc) => <ShareDialog documentId={doc().id} onClose={() => setShareOpen(false)} />}</Show>
      </Show>
    </div>
  );
}

/** Email + role (+ for a board: this board or the whole project). */
function InviteForm(p: { board: boolean; onInvite: (email: string, role: Role, wholeProject: boolean) => Promise<void> }) {
  const [email, setEmail] = createSignal("");
  const [role, setRole] = createSignal<Role>("editor");
  const [whole, setWhole] = createSignal(!p.board);
  const [busy, setBusy] = createSignal(false);
  const roles = () => (whole() ? PROJECT_ROLES : BOARD_ROLES);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await p.onInvite(email().trim(), role(), whole());
      setEmail("");
    } catch (err) {
      toast(errMsg(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form class="share-invite" onSubmit={submit}>
      <input type="email" required placeholder="Email address" value={email()} onInput={(e) => setEmail(e.currentTarget.value)} />
      <select value={role()} onChange={(e) => setRole(e.currentTarget.value as Role)}>
        <For each={roles()}>{(r) => <option value={r}>{ROLE_LABEL[r]}</option>}</For>
      </select>
      <Show when={p.board}>
        <select
          value={whole() ? "project" : "board"}
          title="What they get access to"
          onChange={(e) => {
            setWhole(e.currentTarget.value === "project");
            if (!whole() && role() === "coOwner") setRole("editor");
          }}
        >
          <option value="board">This board</option>
          <option value="project">Whole project</option>
        </select>
      </Show>
      <button class="text-btn primary" type="submit" disabled={busy()}>
        Invite
      </button>
    </form>
  );
}

function PendingInvites(p: { invites: Invite[]; projectId: string; onChange: () => void }) {
  const act = async (f: () => Promise<unknown>, done: string) => {
    try {
      await f();
      toast(done);
      p.onChange();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };
  return (
    <Show when={p.invites.length}>
      <div class="share-section">Invited, waiting for an answer</div>
      <For each={p.invites}>
        {(i) => (
          <div class="share-person">
            <Avatar name={i.email} />
            <div class="share-who">
              <span>{i.email}</span>
              <small>
                {ROLE_LABEL[i.role]}
                {i.documentId ? " · this board" : " · whole project"} · invited by {i.invitedBy}
              </small>
            </div>
            <button class="link-btn" onClick={() => act(() => post(`/projects/${p.projectId}/invites/${i.id}/resend`), "Invitation sent again")}>
              Resend
            </button>
            <button class="link-btn danger" onClick={() => act(() => del(`/projects/${p.projectId}/invites/${i.id}`), "Invitation withdrawn")}>
              Withdraw
            </button>
          </div>
        )}
      </For>
    </Show>
  );
}

function Who(p: { name: string; email: string; avatarUrl?: string | null; id: string }) {
  return (
    <>
      <Avatar name={p.name} url={p.avatarUrl} />
      <div class="share-who">
        <span>
          {p.name}
          <Show when={p.id === me()?.user.id}> (you)</Show>
        </span>
        <small>{p.email}</small>
      </div>
    </>
  );
}

/** A board's role for someone: their project role, one of its own, or No access. */
function BoardRoleSelect(p: { projectRole: Role; boardRole: Role | null | undefined; onChange: (value: Role | null) => void }) {
  return (
    <select class="share-select" value={p.boardRole ?? "project"} title="What they may do on this board" onChange={(e) => p.onChange(e.currentTarget.value === "project" ? null : (e.currentTarget.value as Role))}>
      <Show when={p.projectRole !== "none"}>
        <option value="project">{ROLE_LABEL[p.projectRole]} (as in project)</option>
      </Show>
      <For each={BOARD_ROLES}>{(r) => <option value={r}>{ROLE_LABEL[r]}</option>}</For>
      <option value="none">No access</option>
    </select>
  );
}

const setBoardRole = async (documentId: string, userId: string, role: Role | null) => {
  try {
    await put(`/documents/${documentId}/roles/${userId}`, { role });
  } catch (e) {
    toast(errMsg(e), "error");
  }
};

export function ShareDialog(p: { documentId: string; onClose: () => void }) {
  const [access, { refetch }] = createResource(() => get<BoardAccess>(`/documents/${p.documentId}/access`));
  const projectId = () => openDoc()?.projectId ?? "";
  const manage = () => roleCanManage(access()?.role ?? "none");

  const invite = async (email: string, role: Role, wholeProject: boolean) => {
    await post<Invite>(`/projects/${projectId()}/invites`, { email, role, documentId: wholeProject ? null : p.documentId });
    toast(`Invitation sent to ${email}; they get access when they accept`);
    void refetch();
  };

  const setLink = async (value: LinkAccess) => {
    try {
      await put<ShareLink>(`/documents/${p.documentId}/link`, { access: value });
      void refetch();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const copy = async (token: string) => {
    await navigator.clipboard.writeText(shareUrl(token));
    toast("Link copied");
  };

  const rotate = async () => {
    try {
      await post(`/documents/${p.documentId}/link/rotate`);
      toast("New link made; the old one no longer works");
      void refetch();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <Dialog title={`Share “${openDoc()?.name ?? "board"}”`} onClose={p.onClose}>
      <Show when={access()} fallback={<p class="import-note">{access.error ? errMsg(access.error) : "Loading…"}</p>}>
        {(a) => (
          <>
            <Show when={manage()}>
              <InviteForm board onInvite={invite} />
            </Show>
            <div class="share-section">People with access</div>
            <For each={a().members}>
              {(m) => (
                <div class="share-person">
                  <Who id={m.user.id} name={m.user.name} email={m.user.email} avatarUrl={m.user.avatarUrl} />
                  <Show when={manage() && !fullAccess(m.projectRole)} fallback={<span class="share-role">{ROLE_LABEL[fullAccess(m.projectRole) ? m.projectRole : (m.boardRole ?? m.projectRole)]}</span>}>
                    <BoardRoleSelect projectRole={m.projectRole} boardRole={m.boardRole} onChange={(role) => setBoardRole(p.documentId, m.user.id, role).then(() => void refetch())} />
                  </Show>
                </div>
              )}
            </For>
            <PendingInvites invites={a().invites} projectId={projectId()} onChange={() => void refetch()} />

            <div class="share-section">Link</div>
            <div class="share-link">
              <select class="share-select" value={a().link.access} disabled={!manage()} onChange={(e) => setLink(e.currentTarget.value as LinkAccess)}>
                <For each={Object.keys(LINK_LABEL) as LinkAccess[]}>{(l) => <option value={l}>{LINK_LABEL[l]}</option>}</For>
              </select>
              <button class="text-btn" onClick={() => copy(a().link.token)}>
                Copy link
              </button>
            </div>
            <p class="share-hint">
              {a().link.access === "restricted"
                ? "People who open the link log in, and get in only if they have access."
                : "People without an account can open it as a guest; they cannot edit."}
              <Show when={manage()}>
                {" "}
                <button class="link-btn" onClick={rotate}>
                  Make a new link
                </button>
              </Show>
            </p>
          </>
        )}
      </Show>
    </Dialog>
  );
}

/** The Access button: how many have access, and the panel with who can do what. */
function AccessButton() {
  let wrap!: HTMLSpanElement;
  const doc = () => openDoc();
  // Loaded when it opens (and again after a change)
  const [access, { refetch }] = createResource(
    () => (accessOpen() ? doc()?.id : undefined),
    (id) => get<BoardAccess>(`/documents/${id}/access`),
  );
  const onDoc = (e: PointerEvent) => {
    if (accessOpen() && !wrap.contains(e.target as Node)) setAccessOpen(false);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && accessOpen() && setAccessOpen(false);
  document.addEventListener("pointerdown", onDoc);
  window.addEventListener("keydown", onKey);
  onCleanup(() => {
    document.removeEventListener("pointerdown", onDoc);
    window.removeEventListener("keydown", onKey);
    setAccessOpen(false);
  });
  const myRole = () => doc()?.role ?? "viewer";
  return (
    <span class="access-wrap" ref={wrap}>
      <button
        class="text-btn access-btn"
        classList={{ pressed: accessOpen() }}
        aria-expanded={accessOpen()}
        title="Who can do what on this board"
        onClick={() => setAccessOpen(!accessOpen())}
      >
        <IconPeople />
        <span>{ROLE_LABEL[myRole()]}</span>
      </button>
      <Show when={accessOpen() && doc()}>
        {(d) => (
          <AccessPanel
            documentId={d().id}
            projectId={d().projectId}
            access={access()}
            error={access.error ? errMsg(access.error) : null}
            onChange={() => void refetch()}
            onShare={() => {
              setAccessOpen(false);
              setShareOpen(true);
            }}
          />
        )}
      </Show>
    </span>
  );
}

function AccessPanel(p: { documentId: string; projectId: string; access: BoardAccess | undefined; error: string | null; onChange: () => void; onShare: () => void }) {
  const manage = () => roleCanManage(p.access?.role ?? "none");
  /** Someone's role on this board, as it counts */
  const roleOf = (m: BoardAccess["members"][number]) => (fullAccess(m.projectRole) ? m.projectRole : (m.boardRole ?? m.projectRole));
  const invite = async (email: string, role: Role, wholeProject: boolean) => {
    await post<Invite>(`/projects/${p.projectId}/invites`, { email, role, documentId: wholeProject ? null : p.documentId });
    toast(`Invitation sent to ${email}; they get access when they accept`);
    p.onChange();
  };
  return (
    <div class="access-panel panel" role="dialog" aria-label="Who can do what on this board">
      <div class="access-head">
        <strong>Who can do what here</strong>
        <span class="spacer" />
        <button class="link-btn" onClick={p.onShare} title="The board's link, inviting people, and the rest">
          Link and more…
        </button>
      </div>
      <Show when={p.access} fallback={<p class="import-note">{p.error ?? "Loading…"}</p>}>
        {(a) => (
          <>
            <p class="access-you">
              Your access: <strong>{ROLE_LABEL[a().role]}</strong>, {YOU_CAN[a().role]}.
            </p>
            <div class="access-list">
              <For each={a().members.filter((m) => roleOf(m) !== "none")}>
                {(m) => (
                  <div class="share-person">
                    <Who id={m.user.id} name={m.user.name} email={m.user.email} avatarUrl={m.user.avatarUrl} />
                    <Show
                      when={manage() && !fullAccess(m.projectRole) && m.user.id !== me()?.user.id}
                      fallback={
                        <span class="share-role" title={ROLE_MEANS[roleOf(m)]}>
                          {ROLE_LABEL[roleOf(m)]}
                        </span>
                      }
                    >
                      <BoardRoleSelect projectRole={m.projectRole} boardRole={m.boardRole} onChange={(role) => setBoardRole(p.documentId, m.user.id, role).then(p.onChange)} />
                    </Show>
                  </div>
                )}
              </For>
            </div>
            <Show when={manage()}>
              <InviteForm board onInvite={invite} />
            </Show>
            <dl class="access-legend">
              <For each={["viewer", "commenter", "editor", "coOwner"] as Role[]}>
                {(r) => (
                  <>
                    <dt>{ROLE_LABEL[r]}</dt>
                    <dd>{ROLE_MEANS[r]}</dd>
                  </>
                )}
              </For>
            </dl>
            <Show when={!manage()}>
              <p class="share-hint">Only the owner and co-owners change who has access.</p>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

interface BoardRoleRow {
  documentId: string;
  userId: string;
  role: Role;
}

/** The people in a project (from the project page): roles, per-board roles, invites. */
export function MembersDialog(p: { projectId: string; onClose: () => void }) {
  const project = () => projectById(p.projectId);
  const manage = () => roleCanManage(project()?.role);
  const [members, { refetch }] = createResource(() => get<Member[]>(`/projects/${p.projectId}/members`));
  const [invites, invitesApi] = createResource(manage, (m) => (m ? get<Invite[]>(`/projects/${p.projectId}/invites`) : Promise.resolve([])));
  const [boardRoles, boardRolesApi] = createResource(manage, (m) => (m ? get<BoardRoleRow[]>(`/projects/${p.projectId}/board-roles`) : Promise.resolve([])));
  const [expanded, setExpanded] = createSignal<string | null>(null);
  const reload = () => {
    void refetch();
    void invitesApi.refetch();
    void boardRolesApi.refetch();
  };
  const boardRole = (documentId: string, userId: string) => boardRoles()?.find((r) => r.documentId === documentId && r.userId === userId)?.role ?? null;

  const invite = async (email: string, role: Role) => {
    await post<Invite>(`/projects/${p.projectId}/invites`, { email, role });
    toast(`Invitation sent to ${email}; they get access when they accept`);
    reload();
  };
  const setRole = async (userId: string, role: string) => {
    try {
      if (role === "owner") {
        const who = members()?.find((m) => m.user.id === userId)?.user.name ?? "them";
        if (!confirm(`Give “${project()?.name}” to ${who}? They become its owner; you stay in it as co-owner.`)) return reload();
        await post(`/projects/${p.projectId}/transfer`, { userId });
        toast(`${who} owns it now`);
        return reload();
      }
      if (role === "remove") await del(`/projects/${p.projectId}/members/${userId}`);
      else await put(`/projects/${p.projectId}/members/${userId}`, { role });
      reload();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  return (
    <Dialog title={`People in “${project()?.name ?? "project"}”`} onClose={p.onClose}>
      <Show when={manage()}>
        <InviteForm board={false} onInvite={(email, role) => invite(email, role)} />
      </Show>
      <div class="share-section">Members</div>
      <For each={members()} fallback={<p class="import-note">{members.error ? errMsg(members.error) : "Loading…"}</p>}>
        {(m) => (
          <div class="share-member">
            <div class="share-person">
              <Who id={m.user.id} name={m.user.name} email={m.user.email} avatarUrl={m.user.avatarUrl} />
              <Show when={manage() && !fullAccess(m.role)}>
                <button class="link-btn" onClick={() => setExpanded(expanded() === m.user.id ? null : m.user.id)}>
                  {expanded() === m.user.id ? "Hide boards" : "Per board"}
                </button>
              </Show>
              <Show when={manage() && m.role !== "owner"} fallback={<span class="share-role">{m.role === "none" ? "Some boards" : ROLE_LABEL[m.role]}</span>}>
                <select class="share-select" value={m.role} onChange={(e) => setRole(m.user.id, e.currentTarget.value)}>
                  <option value="none">Only the boards below</option>
                  <For each={PROJECT_ROLES}>{(r) => <option value={r}>{ROLE_LABEL[r]}</option>}</For>
                  {/* Only the owner gives the project away, to someone in the whole project */}
                  <Show when={project()?.role === "owner" && m.role !== "none"}>
                    <option value="owner">Make owner…</option>
                  </Show>
                  <option value="remove">Remove from project</option>
                </select>
              </Show>
            </div>
            {/* What they may do on each board: the project role, or one of its own */}
            <Show when={expanded() === m.user.id}>
              <div class="share-boards">
                <For each={docsOf(p.projectId)} fallback={<p class="import-note">This project has no boards yet.</p>}>
                  {(d) => (
                    <div class="share-board">
                      <BoardIcon kind={d.kind} diagram={d.diagram} />
                      <span class="share-board-name">{d.name}</span>
                      <BoardRoleSelect
                        projectRole={m.role}
                        boardRole={boardRole(d.id, m.user.id)}
                        onChange={(role) => setBoardRole(d.id, m.user.id, role).then(() => void boardRolesApi.refetch())}
                      />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </For>
      <PendingInvites invites={invites() ?? []} projectId={p.projectId} onChange={reload} />
      <Show when={me() && project()?.role && project()?.role !== "owner"}>
        <p class="share-hint">
          <button class="link-btn danger" onClick={() => setRole(me()!.user.id, "remove").then(() => location.reload())}>
            Leave this project
          </button>
        </p>
      </Show>
    </Dialog>
  );
}
