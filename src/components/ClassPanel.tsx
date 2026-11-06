// The class panel (right side, on class diagrams and whiteboards): the selected
// class as fields instead of UML text. Name, kind, type parameters and the
// board's language; attributes with visibility, type, default, static and
// read-only; operations with parameters and a return type; enum values. Every
// change is written back to the class's text (classModel.ts), so undo, editing
// together and the code export work as with typing on the canvas. Picking another
// class as a type draws the line to it (ensureRelation).

import { createMemo, createSignal, For, Index, type JSX, Show } from "solid-js";
import { boardTypeOf } from "../lib/boardTypes";
import { canEdit } from "../lib/access";
import { panelOpen } from "../lib/comments";
import { isBuiltin, LANGUAGES } from "../lib/classTypes";
import {
  isRaw,
  parseClass,
  type Attribute,
  type ClassModel,
  type EnumValue,
  type Operation,
  type Raw,
  type Vis,
} from "../lib/classModel";
import { board, ensureRelation, nodeById, reverseEdge, selectedNodes, setCodeLanguage, setEdgeProps, setNodeText, ui } from "../lib/store";
import { relationMeaning } from "../lib/classRelations";
import { RELATIONS } from "./EdgeMenus";
import { sameName, type ClassKind } from "../lib/umlClass";
import { formatClass } from "../lib/classModel";
import type { CodeLanguage, FlowNode } from "../lib/types";
import { LANGUAGES as LANGUAGE_NAMES } from "./CodeDialog";
import { IconClose, IconPlus } from "./icons";
import { TypePicker } from "./TypePicker";

const VISIBILITY: { vis: Vis; label: string; title: string }[] = [
  { vis: "+", label: "+", title: "public" },
  { vis: "-", label: "−", title: "private" },
  { vis: "#", label: "#", title: "protected" },
  { vis: "~", label: "~", title: "package" },
  { vis: "", label: "·", title: "not set (the language's default)" },
];

const KINDS: { kind: ClassKind; label: string }[] = [
  { kind: "class", label: "Class" },
  { kind: "abstract", label: "Abstract class" },
  { kind: "interface", label: "Interface" },
  { kind: "enum", label: "Enum" },
];

const COLLAPSED_KEY = "flowapp:classPanelClosed";
const [closed, setClosed] = createSignal(localStorage.getItem(COLLAPSED_KEY) === "1");
const setPanelClosed = (v: boolean) => {
  setClosed(v);
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
};

/** The class the panel is for: the only thing selected, on a board type that has classes. */
const selectedClass = (): FlowNode | null => {
  const type = boardTypeOf("flow", board.diagram);
  if (type.id !== "class" && type.id !== "whiteboard") return null;
  const sel = selectedNodes();
  return sel.length === 1 && sel[0].kind === "class" ? sel[0] : null;
};

/** The line the panel is for: one between two classes, selected on its own. */
const selectedRelation = (): string | null => {
  const type = boardTypeOf("flow", board.diagram);
  if ((type.id !== "class" && type.id !== "whiteboard") || !ui.selectedEdge || ui.selected.length) return null;
  const e = board.edges.find((x) => x.id === ui.selectedEdge);
  return e && nodeById(e.from)?.kind === "class" && nodeById(e.to)?.kind === "class" ? e.id : null;
};

export function ClassPanel() {
  const what = () => selectedClass()?.id ?? (selectedRelation() ? `edge:${selectedRelation()}` : null);
  return (
    <Show when={canEdit() && !panelOpen() && what()}>
      {(key) => (
        <Show
          when={!closed()}
          fallback={
            <button class="class-panel-open panel" title="Show the class panel" onClick={() => setPanelClosed(false)}>
              {key().startsWith("edge:") ? "Relation" : "Class"}
            </button>
          }
        >
          <aside class="class-panel panel" onPointerDown={(e) => e.stopPropagation()} onDblClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Show when={key()} keyed>
              {(k) => (k.startsWith("edge:") ? <RelationEditor id={k.slice(5)} /> : <ClassEditor id={k} />)}
            </Show>
          </aside>
        </Show>
      )}
    </Show>
  );
}

/** A text field that saves when you leave it or press Enter (one undo step), not on every key. */
function Field(p: { value: string; placeholder?: string; class?: string; title?: string; onSave: (v: string) => void; ref?: (el: HTMLInputElement) => void }) {
  return (
    <input
      ref={p.ref}
      class={p.class ?? "panel-field"}
      value={p.value}
      placeholder={p.placeholder}
      title={p.title}
      spellcheck={false}
      onChange={(e) => p.onSave(e.currentTarget.value.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = p.value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function VisSelect(p: { value: Vis; onChange: (v: Vis) => void }) {
  return (
    <select class="vis-select" value={p.value} title="Visibility" onChange={(e) => p.onChange(e.currentTarget.value as Vis)}>
      <For each={VISIBILITY}>{(v) => <option value={v.vis} title={v.title}>{`${v.label} ${v.title.split(" ")[0]}`}</option>}</For>
    </select>
  );
}

function Toggle(p: { on: boolean; label: string; title: string; onChange: (on: boolean) => void }) {
  return (
    <button class="mini-toggle" classList={{ on: p.on }} title={p.title} aria-pressed={p.on} onClick={() => p.onChange(!p.on)}>
      {p.label}
    </button>
  );
}

function ClassEditor(p: { id: string }) {
  const node = () => nodeById(p.id);
  const model = createMemo(() => parseClass(node()?.text ?? ""));
  const lang = () => (board.codeLanguage ?? null) as CodeLanguage | null;
  const classNodes = createMemo(() => board.nodes.filter((n) => n.kind === "class").map((n) => ({ id: n.id, name: parseClass(n.text).name })));
  /** What the type pickers offer as classes: the others on the board, this one, its type parameters */
  const classNames = () => [...classNodes().map((c) => c.name).filter(Boolean), ...model().typeParams];
  const attributeNames = () => model().attributes.filter((a): a is Attribute => !isRaw(a)).map((a) => a.name);
  const known = (uml: string) =>
    (uml.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? [])
      .filter((w) => !["List", "Set", "Map"].includes(w))
      .every((w) => isBuiltin(w) || classNames().some((c) => sameName(c, w)) || attributeNames().includes(w));

  /** Changes the class and writes it back to its text (one undo step). */
  const update = (fn: (m: ClassModel) => void) => {
    const m = structuredClone(model());
    fn(m);
    setNodeText(p.id, formatClass(m));
  };
  /** A type was picked: lines to the classes it uses that are not connected yet */
  const usesClasses = (uml: string, use: "attribute" | "operation") => {
    for (const w of uml.match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []) {
      const target = classNodes().find((c) => c.id !== p.id && sameName(c.name, w));
      if (target) ensureRelation(p.id, target.id, use, uml);
    }
  };

  const setAttr = (i: number, change: Partial<Attribute>) =>
    update((m) => {
      m.attributes[i] = { ...(m.attributes[i] as Attribute), ...change };
    });
  const setOp = (i: number, change: Partial<Operation>) =>
    update((m) => {
      m.operations[i] = { ...(m.operations[i] as Operation), ...change };
    });
  const move = <T,>(list: T[], from: number, to: number) => {
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
  };

  /** Focus the name of a row just added */
  let focusNext: "attr" | "op" | "value" | null = null;
  const focusIfNew = (kind: "attr" | "op" | "value", last: boolean) => (el: HTMLInputElement) => {
    if (focusNext === kind && last) {
      focusNext = null;
      queueMicrotask(() => {
        el.focus();
        el.select();
      });
    }
  };
  const newName = (base: string, taken: string[]) => {
    let n = 1;
    while (taken.includes(`${base}${n === 1 ? "" : n}`)) n++;
    return `${base}${n === 1 ? "" : n}`;
  };

  const [dragging, setDragging] = createSignal<{ list: "attributes" | "operations" | "values"; index: number } | null>(null);
  const dropOn = (list: "attributes" | "operations" | "values", index: number) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      setDragging({ list, index });
      e.dataTransfer?.setData("text/plain", "");
    },
    onDragOver: (e: DragEvent) => {
      if (dragging()?.list === list) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const d = dragging();
      setDragging(null);
      if (d && d.list === list && d.index !== index) update((m) => move(m[list] as unknown[], d.index, index));
    },
    onDragEnd: () => setDragging(null),
  });

  const pkg = () => {
    const parent = node()?.parent ? nodeById(node()!.parent!) : undefined;
    return parent?.kind === "package" ? parent.text.split("\n")[0] : null;
  };

  return (
    <div class="class-editor">
      <div class="class-panel-head">
        <strong>Class</strong>
        <span class="spacer" />
        <select
          class="lang-select"
          title="The language the classes are for: its types are offered and shown"
          value={lang() ?? ""}
          onChange={(e) => setCodeLanguage((e.currentTarget.value || null) as CodeLanguage | null)}
        >
          <option value="">UML types</option>
          <For each={LANGUAGES}>{(l) => <option value={l}>{LANGUAGE_NAMES.find((x) => x.value === l)?.label ?? l}</option>}</For>
        </select>
        <button class="icon-btn small" title="Hide the class panel" onClick={() => setPanelClosed(true)}>
          <IconClose />
        </button>
      </div>

      <div class="class-panel-body">
        <div class="panel-grid">
          <label>Name</label>
          <Field value={model().name} placeholder="ClassName" onSave={(v) => v && update((m) => (m.name = v))} />
          <label>Kind</label>
          <select class="panel-field" value={model().kind} onChange={(e) => update((m) => (m.kind = e.currentTarget.value as ClassKind))}>
            <For each={KINDS}>{(k) => <option value={k.kind}>{k.label}</option>}</For>
          </select>
          <Show when={model().kind !== "enum"}>
            <label title="Generic type parameters, e.g. T or K, V">Type params</label>
            <Field
              value={model().typeParams.join(", ")}
              placeholder="none (e.g. T)"
              onSave={(v) =>
                update(
                  (m) =>
                    (m.typeParams = v
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean)),
                )
              }
            />
          </Show>
          <Show when={pkg()}>
            <label>Package</label>
            <span class="panel-note">{pkg()}</span>
          </Show>
        </div>

        {/* ---------- enum values ---------- */}
        <Show when={model().kind === "enum"}>
          <Section title="Values" onAdd={() => {
            focusNext = "value";
            update((m) => m.values.push({ name: newName("Value", m.values.filter((v): v is EnumValue => !isRaw(v)).map((v) => v.name)), value: null }));
          }}>
            <Index each={model().values}>
              {(v, i) => (
                <div class="member-row" {...dropOn("values", i)}>
                  <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                  <Show when={!isRaw(v())} fallback={<RawRow raw={(v() as Raw).raw} onSave={(t) => update((m) => (m.values[i] = { raw: t }))} onRemove={() => update((m) => m.values.splice(i, 1))} />}>
                    <Field
                      ref={focusIfNew("value", i === model().values.length - 1)}
                      value={(v() as EnumValue).name}
                      onSave={(t) => t && update((m) => (m.values[i] = { ...(m.values[i] as EnumValue), name: t }))}
                    />
                    <Field
                      class="panel-field value-field"
                      value={(v() as EnumValue).value ?? ""}
                      placeholder="= value"
                      onSave={(t) => update((m) => (m.values[i] = { ...(m.values[i] as EnumValue), value: t || null }))}
                    />
                    <RemoveButton what="value" onClick={() => update((m) => m.values.splice(i, 1))} />
                  </Show>
                </div>
              )}
            </Index>
          </Section>
        </Show>

        {/* ---------- attributes ---------- */}
        <Show when={model().kind !== "enum"}>
          <Section
            title="Attributes"
            onAdd={() => {
              focusNext = "attr";
              update((m) =>
                m.attributes.push({ vis: "-", name: newName("name", attributeNames()), type: "string", default: null, static: false, readOnly: false }),
              );
            }}
          >
            <Index each={model().attributes}>
              {(a, i) => (
                <div class="member-row" {...dropOn("attributes", i)}>
                  <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                  <Show
                    when={!isRaw(a())}
                    fallback={<RawRow raw={(a() as Raw).raw} onSave={(t) => update((m) => (m.attributes[i] = { raw: t }))} onRemove={() => update((m) => m.attributes.splice(i, 1))} />}
                  >
                    <div class="member-main">
                      <VisSelect value={(a() as Attribute).vis} onChange={(vis) => setAttr(i, { vis })} />
                      <Field ref={focusIfNew("attr", i === model().attributes.length - 1)} value={(a() as Attribute).name} onSave={(t) => t && setAttr(i, { name: t })} />
                      <span class="colon">:</span>
                      <TypePicker
                        value={(a() as Attribute).type}
                        lang={lang()}
                        classes={classNames()}
                        known={known}
                        onChange={(type) => {
                          setAttr(i, { type });
                          usesClasses(type, "attribute");
                        }}
                      />
                    </div>
                    <div class="member-extra">
                      <Field
                        class="panel-field value-field"
                        value={(a() as Attribute).default ?? ""}
                        placeholder="= default"
                        onSave={(t) => setAttr(i, { default: t || null })}
                      />
                      <Toggle on={(a() as Attribute).static} label="static" title="Static: one for the class, not per object" onChange={(v) => setAttr(i, { static: v })} />
                      <Toggle on={(a() as Attribute).readOnly} label="read-only" title="Read-only: set once (final, readonly, val), no setter" onChange={(v) => setAttr(i, { readOnly: v })} />
                      <RemoveButton what="attribute" onClick={() => update((m) => m.attributes.splice(i, 1))} />
                    </div>
                  </Show>
                </div>
              )}
            </Index>
          </Section>
        </Show>

        {/* ---------- operations ---------- */}
        <Section
          title="Operations"
          onAdd={() => {
            focusNext = "op";
            const taken = model().operations.filter((o): o is Operation => !isRaw(o)).map((o) => o.name);
            update((m) => m.operations.push({ vis: "+", name: newName("operation", taken), params: [], returns: null, static: false, abstract: false }));
          }}
        >
          <Index each={model().operations}>
            {(o, i) => (
              <div class="member-row" {...dropOn("operations", i)}>
                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                <Show
                  when={!isRaw(o())}
                  fallback={<RawRow raw={(o() as Raw).raw} onSave={(t) => update((m) => (m.operations[i] = { raw: t }))} onRemove={() => update((m) => m.operations.splice(i, 1))} />}
                >
                  <div class="member-main">
                    <VisSelect value={(o() as Operation).vis} onChange={(vis) => setOp(i, { vis })} />
                    <Field ref={focusIfNew("op", i === model().operations.length - 1)} value={(o() as Operation).name} onSave={(t) => t && setOp(i, { name: t })} />
                    <span class="colon">→</span>
                    <TypePicker
                      value={(o() as Operation).returns ?? "void"}
                      lang={lang()}
                      classes={classNames()}
                      returns={{ attributes: attributeNames() }}
                      known={known}
                      placeholder="returns"
                      onChange={(ret) => {
                        setOp(i, { returns: ret === "void" ? null : ret });
                        if (ret !== "void") usesClasses(ret, "operation");
                      }}
                    />
                  </div>
                  <div class="params">
                    <Index each={(o() as Operation).params}>
                      {(param, j) => (
                        <div class="param">
                          <Field
                            class="panel-field param-name"
                            value={param()[0]}
                            onSave={(t) =>
                              t &&
                              setOp(i, {
                                params: (o() as Operation).params.map((x, k) => (k === j ? [t, x[1]] : x)),
                              })
                            }
                          />
                          <span class="colon">:</span>
                          <TypePicker
                            value={param()[1]}
                            lang={lang()}
                            classes={classNames()}
                            known={known}
                            onChange={(type) => {
                              setOp(i, { params: (o() as Operation).params.map((x, k) => (k === j ? [x[0], type] : x)) });
                              usesClasses(type, "operation");
                            }}
                          />
                          <RemoveButton what="parameter" onClick={() => setOp(i, { params: (o() as Operation).params.filter((_, k) => k !== j) })} />
                        </div>
                      )}
                    </Index>
                    <div class="member-extra">
                      <button
                        class="text-btn small"
                        onClick={() => {
                          const taken = (o() as Operation).params.map((x) => x[0]);
                          setOp(i, { params: [...(o() as Operation).params, [newName("value", taken), "string"]] });
                        }}
                      >
                        + parameter
                      </button>
                      <span class="spacer" />
                      <Toggle on={(o() as Operation).static} label="static" title="Static: called on the class, not on an object" onChange={(v) => setOp(i, { static: v })} />
                      <Toggle on={(o() as Operation).abstract} label="abstract" title="Abstract: no body here, subclasses provide it" onChange={(v) => setOp(i, { abstract: v })} />
                      <RemoveButton what="operation" onClick={() => update((m) => m.operations.splice(i, 1))} />
                    </div>
                  </div>
                </Show>
              </div>
            )}
          </Index>
        </Section>
        <p class="panel-hint">What is written here is the class's UML text; double-click a row on the board to type it instead.</p>
      </div>
    </div>
  );
}

function Section(p: { title: string; onAdd: () => void; children: JSX.Element }) {
  return (
    <section class="member-section">
      <div class="member-head">
        <span>{p.title}</span>
        <button class="icon-btn small" title={`Add to ${p.title.toLowerCase()}`} onClick={p.onAdd}>
          <IconPlus />
        </button>
      </div>
      {p.children}
    </section>
  );
}

function RemoveButton(p: { what: string; onClick: () => void }) {
  return (
    <button class="icon-btn small remove-btn" title={`Remove this ${p.what}`} onClick={p.onClick}>
      <IconClose />
    </button>
  );
}

/** A row that is not UML notation: edit its text (it is marked on the board too). */
function RawRow(p: { raw: string; onSave: (t: string) => void; onRemove: () => void }) {
  return (
    <div class="member-main">
      <Field class="panel-field invalid" value={p.raw} title="Not UML notation: the code export skips it" onSave={(t) => (t ? p.onSave(t) : p.onRemove())} />
      <RemoveButton what="row" onClick={p.onRemove} />
    </div>
  );
}

// ---------- a line between two classes ----------

/** Does the line look like this preset? (missing caps and pattern are their defaults) */
const looksLike = (e: { pattern?: string | null; startCap?: string | null; endCap?: string | null }, p: { pattern?: string | null; startCap?: string | null; endCap?: string | null }) =>
  (e.pattern ?? "solid") === (p.pattern ?? "solid") && (e.startCap ?? "none") === (p.startCap ?? "none") && (e.endCap ?? "arrow") === (p.endCap ?? "arrow");

const MULTIPLICITIES = ["1", "0..1", "*", "1..*", "0..*"];

/**
 * The line inspector: what kind of relation, how many at each end, the role
 * name, which way round, and what it makes in the code.
 */
function RelationEditor(p: { id: string }) {
  const edge = () => board.edges.find((e) => e.id === p.id);
  const end = (id: string | undefined) => {
    const m = parseClass(nodeById(id ?? "")?.text ?? "");
    return { name: m.name || "?", kind: m.kind };
  };
  const from = () => end(edge()?.from);
  const to = () => end(edge()?.to);
  const kinds = RELATIONS[0];
  const current = () => kinds.find((r) => edge() && looksLike(edge()!, r.props))?.name ?? "";
  const setLabel = (which: "startLabel" | "endLabel" | "label", v: string) => setEdgeProps(p.id, { [which]: v || undefined });

  return (
    <Show when={edge()}>
      {(e) => (
        <div class="class-editor">
          <div class="class-panel-head">
            <strong>Relation</strong>
            <span class="spacer" />
            <button class="icon-btn small" title="Hide the panel" onClick={() => setPanelClosed(true)}>
              <IconClose />
            </button>
          </div>
          <div class="class-panel-body">
            <div class="relation-ends">
              <span class="relation-end">{from().name}</span>
              <button class="icon-btn small" title="The other way round (the arrow points at the other class)" onClick={() => reverseEdge(p.id)}>
                ⇄
              </button>
              <span class="relation-end">{to().name}</span>
            </div>
            <div class="panel-grid">
              <label>Kind</label>
              <select
                class="panel-field"
                value={current()}
                onChange={(ev) => {
                  const r = kinds.find((k) => k.name === ev.currentTarget.value);
                  if (r) setEdgeProps(p.id, r.props);
                }}
              >
                <Show when={!current()}>
                  <option value="">Other</option>
                </Show>
                <For each={kinds}>{(k) => <option value={k.name}>{`${k.name} (${k.hint})`}</option>}</For>
              </select>
              <label title={`How many ${from().name} there are for one ${to().name}`}>At {from().name}</label>
              <Field value={e().startLabel ?? ""} placeholder="multiplicity" onSave={(v) => setLabel("startLabel", v)} ref={(el) => el.setAttribute("list", "multiplicities")} />
              <label title={`How many ${to().name} there are for one ${from().name}`}>At {to().name}</label>
              <Field value={e().endLabel ?? ""} placeholder="multiplicity" onSave={(v) => setLabel("endLabel", v)} ref={(el) => el.setAttribute("list", "multiplicities")} />
              <label>Role</label>
              <Field value={e().label ?? ""} placeholder="name on the line" onSave={(v) => setLabel("label", v)} />
            </div>
            <datalist id="multiplicities">
              <For each={MULTIPLICITIES}>{(m) => <option value={m} />}</For>
            </datalist>
            <p class="relation-meaning">{relationMeaning(e(), from(), to())}</p>
          </div>
        </div>
      )}
    </Show>
  );
}
