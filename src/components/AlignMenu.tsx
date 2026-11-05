// Align and distribute, for the bar above a selection (flowchart and EER diagram).

import { For } from "solid-js";
import type { AlignTo } from "../lib/geometry";
import { Menu } from "./Menu";
import { IconAlign, IconDistribute } from "./icons";

const ALIGN: { to: AlignTo; label: string }[] = [
  { to: "left", label: "Left" },
  { to: "center", label: "Center" },
  { to: "right", label: "Right" },
  { to: "top", label: "Top" },
  { to: "middle", label: "Middle" },
  { to: "bottom", label: "Bottom" },
];

export function AlignMenu(p: { count: number; onAlign: (to: AlignTo) => void; onDistribute: (axis: "x" | "y") => void }) {
  return (
    <Menu
      button={(toggle, open) => (
        <button class="icon-btn" classList={{ pressed: open() }} title="Align and distribute" onClick={toggle}>
          <IconAlign to="left" />
        </button>
      )}
    >
      {(close) => (
        <>
          <For each={ALIGN}>
            {(a) => (
              <button
                class="menu-item"
                onClick={() => {
                  p.onAlign(a.to);
                  close();
                }}
              >
                <IconAlign to={a.to} />
                Align {a.label.toLowerCase()}
              </button>
            )}
          </For>
          <div class="menu-sep" />
          <For each={["x", "y"] as const}>
            {(axis) => (
              <button
                class="menu-item"
                disabled={p.count < 3}
                title={p.count < 3 ? "Select three or more" : undefined}
                onClick={() => {
                  p.onDistribute(axis);
                  close();
                }}
              >
                <IconDistribute axis={axis} />
                {axis === "x" ? "Same space across" : "Same space down"}
              </button>
            )}
          </For>
        </>
      )}
    </Menu>
  );
}
