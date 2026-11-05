// The keyboard shortcuts sheet (`?`, or "Keyboard shortcuts" in the account menu).

import { createSignal, For, Show } from "solid-js";
import { SHORTCUT_GROUPS, type Shortcut } from "../lib/shortcuts";
import { openDoc } from "../lib/workspace";
import { Dialog } from "./Dialog";
import { currentFlowType, currentToolGroups } from "./Toolbar";

const [open, setOpen] = createSignal(false);
export const openShortcuts = () => setOpen(true);

export function Keys(p: { keys: string[] }) {
  return (
    <span class="keys">
      <For each={p.keys}>{(k) => <kbd>{k}</kbd>}</For>
    </span>
  );
}

function Group(p: { title: string; items: Shortcut[] }) {
  return (
    <section class="shortcut-group">
      <h4>{p.title}</h4>
      <For each={p.items}>
        {(s) => (
          <div class="shortcut-row">
            <span>{s.label}</span>
            <Keys keys={s.keys} />
          </div>
        )}
      </For>
    </section>
  );
}

export function ShortcutSheet() {
  // On a flow board: the tools of its type that have a key
  const tools = () =>
    openDoc()?.kind === "flow"
      ? currentToolGroups()
          .flat()
          .filter((t) => t.key)
          .map((t) => ({ keys: [t.key], label: t.label }))
      : [];
  return (
    <Show when={open()}>
      <Dialog title="Keyboard shortcuts" onClose={() => setOpen(false)}>
        <div class="shortcut-grid">
          <For each={SHORTCUT_GROUPS}>{(g) => <Group title={g.title} items={g.items} />}</For>
          <Show when={tools().length}>
            <Group title={`Tools (${currentFlowType().label.toLowerCase()})`} items={tools()} />
          </Show>
        </div>
      </Dialog>
    </Show>
  );
}
