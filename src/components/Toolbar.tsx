import { For, type JSX } from "solid-js";
import { setUi, ui, type Tool } from "../lib/store";
import { IconBox, IconDiamond, IconNote, IconPill, IconPointer } from "./icons";

const TOOLS: { tool: Tool; label: string; key: string; icon: () => JSX.Element }[] = [
  { tool: "select", label: "Selecteren", key: "V", icon: IconPointer },
  { tool: "box", label: "Blok", key: "R", icon: IconBox },
  { tool: "diamond", label: "Beslissing", key: "D", icon: IconDiamond },
  { tool: "pill", label: "Start / eind", key: "P", icon: IconPill },
  { tool: "note", label: "Notitie", key: "N", icon: IconNote },
];

export function Toolbar() {
  return (
    <nav class="toolbar panel" aria-label="Gereedschap">
      <For each={TOOLS}>
        {(t) => (
          <button
            class="tool-btn"
            classList={{ active: ui.tool === t.tool }}
            title={`${t.label} (${t.key})`}
            aria-pressed={ui.tool === t.tool}
            onClick={() => setUi("tool", t.tool)}
          >
            {t.icon()}
            <kbd>{t.key}</kbd>
          </button>
        )}
      </For>
    </nav>
  );
}
