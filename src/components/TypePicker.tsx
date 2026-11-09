// Picking a type for an attribute, a parameter or a return value (class panel).
// Groups: UML's usual types, the classes on the board (and the class's type
// parameters), and wrapping the current type in a list, set, map or optional.
// Any other type may be typed: it is kept as written.

import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { isType } from "../lib/classModel";

/** The usual UML types, offered first */
const UML_TYPES = ["int", "long", "double", "decimal", "bool", "string", "char", "date", "datetime", "time", "duration", "uuid", "bytes", "object"];

interface Option {
  group: string;
  label: string;
  uml: string;
}

/** `List<Order>?` → its innermost type, without lists, sets, maps and optional */
function unwrap(uml: string): string {
  const s = uml.trim();
  if (s.endsWith("?")) return unwrap(s.slice(0, -1));
  const m = /^(List|Set)<(.*)>$/.exec(s);
  if (m) return unwrap(m[2]);
  const map = /^Map<.*,\s*(.*)>$/.exec(s);
  return map ? unwrap(map[1]) : s;
}

export function TypePicker(p: {
  value: string;
  /** Classes on the board and the class's type parameters */
  classes: string[];
  /** Operations: no return value, or one of the class's attributes (a getter) */
  returns?: { attributes: string[] };
  placeholder?: string;
  onChange: (uml: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [typed, setTyped] = createSignal<string | null>(null);
  const [active, setActive] = createSignal(0);
  const [at, setAt] = createSignal({ x: 0, y: 0, w: 220 });
  let input!: HTMLInputElement;
  let list: HTMLDivElement | undefined;

  const shown = () => p.value;

  const options = createMemo((): Option[] => {
    const q = (typed() ?? "").trim().toLowerCase();
    const all: Option[] = [];
    if (p.returns) all.push({ group: "Returns", label: "nothing (void)", uml: "void" });
    for (const t of UML_TYPES) all.push({ group: "Types", label: t, uml: t });
    for (const c of p.classes) all.push({ group: "Classes", label: c, uml: c });
    for (const a of p.returns?.attributes ?? []) all.push({ group: "Its attribute (a getter)", label: a, uml: a });
    // Wrapping what is chosen now
    const inner = p.value && p.value !== "void" ? p.value : "";
    if (inner) {
      const wrap = [`List<${inner}>`, `${inner}?`, `Set<${inner}>`, `Map<string, ${inner}>`];
      for (const w of wrap) all.push({ group: "Wrap it", label: w, uml: w });
      if (unwrap(inner) !== inner) all.push({ group: "Wrap it", label: `just ${unwrap(inner)}`, uml: unwrap(inner) });
    }
    return q ? all.filter((o) => o.label.toLowerCase().includes(q)) : all;
  });

  /** Under the field, kept inside the window (above it when there is no room below) */
  const place = () => {
    const r = input.getBoundingClientRect();
    const w = Math.max(220, r.width);
    const x = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const below = window.innerHeight - r.bottom - 8;
    setAt({ x, y: below >= 200 ? r.bottom + 4 : Math.max(8, r.top - 4 - Math.min(300, r.top - 12)), w });
  };
  const show = () => {
    place();
    setActive(0);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setTyped(null);
  };
  const pick = (uml: string) => {
    close();
    if (uml !== p.value) p.onChange(uml);
  };
  /** What was typed, kept as written */
  const commitTyped = () => {
    const t = typed();
    if (t === null) return close();
    const uml = t.trim();
    close();
    if (uml && uml !== p.value) p.onChange(uml);
  };

  const onDoc = (e: PointerEvent) => {
    if (!open()) return;
    const t = e.target as Node;
    if (!input.contains(t) && !list?.contains(t)) commitTyped();
  };
  document.addEventListener("pointerdown", onDoc);
  onCleanup(() => document.removeEventListener("pointerdown", onDoc));

  // Only a type that is not written as one is marked (any name is fine: a class elsewhere)
  const bad = () => !!p.value && p.value !== "void" && !isType(p.value);

  return (
    <>
      <input
        ref={input}
        class="type-input"
        classList={{ invalid: bad() }}
        title={bad() ? "Not written as a type: a name, maybe with <…>, [] or ?" : undefined}
        value={typed() ?? shown()}
        placeholder={p.placeholder ?? "type"}
        spellcheck={false}
        onFocus={() => {
          // Typing replaces the type (the list shows what matches)
          input.select();
          show();
        }}
        onInput={(e) => {
          setTyped(e.currentTarget.value);
          setActive(0);
          if (!open()) show();
        }}
        onKeyDown={(e) => {
          const n = options().length;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open()) show();
            else if (n) setActive((active() + 1) % n);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (n) setActive((active() - 1 + n) % n);
          } else if (e.key === "Enter") {
            e.preventDefault();
            // A listed type when one is highlighted while typing, else what was typed
            const o = options()[active()];
            if (open() && o && typed() !== null && o.label.toLowerCase().startsWith(typed()!.trim().toLowerCase())) pick(o.uml);
            else if (typed() !== null) commitTyped();
            else if (open() && o) pick(o.uml);
            input.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
            input.blur();
          } else if (e.key === "Tab") commitTyped();
        }}
      />
      <Show when={open() && options().length}>
        <Portal>
          <div ref={list} class="type-options panel" style={{ left: `${at().x}px`, top: `${at().y}px`, "min-width": `${at().w}px` }}>
            <For each={options()}>
              {(o, i) => (
                <>
                  <Show when={i() === 0 || options()[i() - 1].group !== o.group}>
                    <div class="type-group">{o.group}</div>
                  </Show>
                  <button
                    class="type-option"
                    classList={{ active: active() === i(), current: o.uml === p.value }}
                    onPointerMove={() => setActive(i())}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(o.uml)}
                  >
                    {o.label}
                  </button>
                </>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}
