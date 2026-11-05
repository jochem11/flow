// What each role may do (the same order as the server: viewer < commenter <
// editor < co-owner < owner). No role at all: the desktop app's own files, which
// are the user's own.

import type { Role } from "./types";

const RANK: Record<Role, number> = { none: 0, viewer: 1, commenter: 2, editor: 3, coOwner: 4, owner: 5 };
const atLeast = (role: Role | null | undefined, min: Role) => !role || RANK[role] >= RANK[min];

export const roleCanComment = (role?: Role | null) => atLeast(role, "commenter");
export const roleCanEdit = (role?: Role | null) => atLeast(role, "editor");
/** Invite people, change roles and the link (owner and co-owners) */
export const roleCanManage = (role?: Role | null) => atLeast(role, "coOwner");
/** Delete the project (the owner only) */
export const roleOwns = (role?: Role | null) => !role || role === "owner";

export const ROLE_LABEL: Record<Role, string> = {
  none: "No access",
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
  coOwner: "Co-owner",
  owner: "Owner",
};
