// Live notices from the server (server/src/events.rs) while logged in: when
// someone else changes a project (boards, folders, people) the sidebar follows,
// and when someone changes your access the open board is checked right away
// (closed, or read-only). Reconnects by itself.

import { createEffect, createRoot, on, onCleanup } from "solid-js";
import { me } from "./auth";
import { get, inTauri, serverUrl, sessionToken } from "./server";
import { projectsChanged } from "./workspace";
import { checkForUpdate } from "./version";
import { loadInbox } from "./inbox";

function url() {
  const http = inTauri ? serverUrl() : `${location.protocol}//${location.host}`;
  const token = sessionToken();
  return `${http.replace(/^http/, "ws")}/api/ws/events${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

function listen(): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let wait = 1000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  const open = () => {
    ws = new WebSocket(url());
    ws.onopen = () => {
      wait = 1000;
      // Missed notices while away: catch up once
      projectsChanged(true);
      void loadInbox();
      // Back after the server was gone: maybe it was updated
      if (!first) void checkForUpdate();
      first = false;
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as { type: string };
        if (msg.type === "inbox") void loadInbox();
        // Logged out from another device? A request that is refused shows the login screen
        else if (msg.type === "session") void get("/auth/me").catch(() => {});
        else projectsChanged(msg.type === "access");
      } catch {
        /* not ours */
      }
    };
    ws.onclose = () => {
      if (stopped) return;
      retry = setTimeout(open, wait);
      wait = Math.min(wait * 2, 15000);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    ws?.close();
  };
}

// Logged in: listen; logged out: stop
createRoot(() => {
  createEffect(
    on(
      () => me()?.user.id,
      (id) => {
        if (!id) return;
        onCleanup(listen());
      },
    ),
  );
});
