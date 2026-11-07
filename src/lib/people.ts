// The people who can work on the open board (everyone with access to it), for
// assigning kanban cards and @mentioning in comments. Loaded when a board from the server opens, and again
// when the project's people change (see projectsChanged in workspace.ts).

import { createEffect, createRoot, createSignal, on } from "solid-js";
import { get } from "./server";
import type { BoardAccess, User } from "./types";
import { openDoc } from "./workspace";

const [people, setPeople] = createSignal<User[]>([]);
export { people };

export const personById = (id: string) => people().find((p) => p.id === id);

export async function loadPeople() {
  const doc = openDoc();
  // Only boards from the server have people (and guests cannot list them)
  if (!doc?.role || doc.share) return setPeople([]);
  try {
    const access = await get<BoardAccess>(`/documents/${doc.id}/access`);
    if (openDoc()?.id !== doc.id) return;
    setPeople(
      access.members
        .filter((m) => {
          const role = m.projectRole === "owner" || m.projectRole === "coOwner" ? m.projectRole : (m.boardRole ?? m.projectRole);
          return role !== "none";
        })
        .map((m) => m.user),
    );
  } catch {
    setPeople([]);
  }
}

createRoot(() => {
  createEffect(
    on(
      () => {
        const d = openDoc();
        // Kanban cards are assigned to them; comments on any board mention them
        return d?.role && !d.share ? `${d.id}|${d.role}` : null;
      },
      (key) => (key ? void loadPeople() : setPeople([])),
    ),
  );
});
