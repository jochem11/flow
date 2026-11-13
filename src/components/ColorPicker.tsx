// One color picker for everything that has a color (blocks, tables, sections,
// kanban columns and labels): the named colors as swatches, and a color wheel
// for any other color.

import { createSignal, For, Show } from "solid-js";
import { cleanHex, colorClass, COLOR_NAMES, COLORS, hexToHsv, hsvToHex, tintVars, type ColorChoice, type Hsv } from "../lib/colors";
import type { NodeColor } from "../lib/types";
import { Menu } from "./Menu";

/** Where the wheel starts when there is no color of one's own yet */
const START = "#5b4cf0";

export function ColorPicker(p: {
  /** The named color (null or nothing: none); with `mixed`, not one for all that is selected */
  color?: NodeColor | null;
  /** The color of one's own, when there is one */
  tint?: string | null;
  /** Also offers "no color" */
  none?: boolean;
  /** One button that opens the colors and the wheel (for a toolbar), instead of the colors in a row */
  compact?: boolean;
  onPick: (choice: ColorChoice) => void;
}) {
  const tint = () => cleanHex(p.tint);
  const swatches = () => (
    <>
      <Show when={p.none}>
        <button class="swatch none" classList={{ active: !p.color && !tint() }} title="No color" onClick={() => p.onPick({ color: null, tint: null })} />
      </Show>
      <For each={COLORS}>
        {(c) => <button class={`swatch color-${c}`} classList={{ active: !tint() && p.color === c }} title={COLOR_NAMES[c]} onClick={() => p.onPick({ color: c, tint: null })} />}
      </For>
    </>
  );
  const wheel = () => <ColorWheel value={tint() ?? START} onChange={(hex) => p.onPick({ tint: hex })} />;
  return (
    <Show
      when={p.compact}
      fallback={
        <>
          {swatches()}
          <Menu
            align="right"
            button={(toggle, open) => (
              <button
                class="swatch wheel"
                classList={{ active: !!tint(), pressed: open() }}
                style={tint() ? { background: tint()! } : undefined}
                title={tint() ? `Your own color (${tint()}). Click to change it` : "Any color: the color wheel"}
                aria-label="Color wheel"
                onClick={toggle}
              />
            )}
          >
            {wheel}
          </Menu>
        </>
      }
    >
      {/* One button with the color it has now (the wheel: not the same for all that is selected) */}
      <Menu
        button={(toggle, open) => (
          <button
            class={`swatch color-now ${tint() || p.color ? colorClass(p.color, tint()) : "wheel"}`}
            classList={{ pressed: open() }}
            style={tintVars(tint())}
            title="Color"
            aria-label="Color"
            onClick={toggle}
          />
        )}
      >
        {() => (
          <div class="color-panel">
            <div class="color-panel-swatches">{swatches()}</div>
            {wheel()}
          </div>
        )}
      </Menu>
    </Show>
  );
}

/**
 * The wheel: the hue around it, more color towards its edge, and a slider for
 * how bright. The color is given when the pointer lets go (not all the way
 * there: each one is a change to the board).
 */
export function ColorWheel(p: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = createSignal<Hsv>(hexToHsv(p.value));
  const hex = () => hsvToHex(hsv());
  const commit = () => p.onChange(hex());
  let disc!: HTMLDivElement;

  const at = (e: PointerEvent) => {
    const r = disc.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // Clockwise from the top, as the gradient is drawn
    const h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    setHsv({ h, s: Math.min(1, Math.hypot(dx, dy) / (r.width / 2)), v: hsv().v || 1 });
  };
  const knob = () => {
    const a = (hsv().h * Math.PI) / 180;
    return { left: `${50 + Math.sin(a) * hsv().s * 50}%`, top: `${50 - Math.cos(a) * hsv().s * 50}%`, background: hex() };
  };
  const step = (e: KeyboardEvent) => {
    const { h, s, v } = hsv();
    const big = e.shiftKey ? 3 : 1;
    if (e.key === "ArrowLeft") setHsv({ h: (h - 5 * big + 360) % 360, s, v });
    else if (e.key === "ArrowRight") setHsv({ h: (h + 5 * big) % 360, s, v });
    else if (e.key === "ArrowUp") setHsv({ h, s: Math.min(1, s + 0.05 * big), v });
    else if (e.key === "ArrowDown") setHsv({ h, s: Math.max(0, s - 0.05 * big), v });
    else return;
    e.preventDefault();
    commit();
  };

  return (
    <div class="color-wheel" onPointerDown={(e) => e.stopPropagation()}>
      <div
        ref={disc}
        class="color-wheel-disc"
        style={{ "--v": String(hsv().v) }}
        tabIndex={0}
        role="slider"
        aria-label="Hue and saturation (arrow keys)"
        aria-valuetext={hex()}
        onKeyDown={step}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          at(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && at(e)}
        onPointerUp={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          commit();
        }}
      >
        <span class="color-wheel-knob" style={knob()} />
      </div>
      <label class="color-wheel-row">
        <span>Brightness</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(hsv().v * 100)}
          style={{ "--from": "#000", "--to": hsvToHex({ ...hsv(), v: 1 }) }}
          onInput={(e) => setHsv({ ...hsv(), v: Number(e.currentTarget.value) / 100 })}
          onChange={commit}
        />
      </label>
      <label class="color-wheel-row">
        <span class="color-wheel-preview" style={{ ...tintVars(hex()), background: "var(--fill)" }} title="How it will look: a light fill with the color as its border" />
        <input
          class="kd-input color-wheel-hex"
          aria-label="Hex color"
          value={hex()}
          maxLength={7}
          spellcheck={false}
          onChange={(e) => {
            const typed = cleanHex(e.currentTarget.value);
            if (typed) {
              setHsv(hexToHsv(typed));
              p.onChange(typed);
            } else e.currentTarget.value = hex();
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
    </div>
  );
}
