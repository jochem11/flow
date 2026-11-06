// A project's look on its page: the accent (focal blocks, callouts) and the
// typeface of all its boards and their exports (lib/brand.ts, models::Brand).

import { For, Show } from "solid-js";
import { ACCENTS, BRAND_FONT_NAMES, BRAND_FONTS, isColor } from "../lib/brand";
import type { Brand, BrandFont, Project } from "../lib/types";
import { setProjectBrand } from "../lib/workspace";

export function ProjectLook(p: { project: Project; editable: boolean }) {
  const brand = (): Brand => p.project.brand ?? {};
  const set = (change: Partial<Brand>) => {
    const next = { ...brand(), ...change };
    // Unset is left out (the app's own)
    void setProjectBrand(p.project.id, {
      ...(next.accent ? { accent: next.accent } : {}),
      ...(next.font && next.font !== "sans" ? { font: next.font } : {}),
    });
  };
  const accent = () => (brand().accent && isColor(brand().accent!) ? brand().accent! : null);
  return (
    <div class="project-look">
      <div class="look-row">
        <span class="look-label">Accent</span>
        <div class="look-swatches" role="radiogroup" aria-label="Accent color">
          <button
            class="look-swatch app"
            classList={{ on: !accent() }}
            role="radio"
            aria-checked={!accent()}
            title="The app's own"
            disabled={!p.editable}
            onClick={() => set({ accent: undefined })}
          />
          <For each={ACCENTS}>
            {(c) => (
              <button
                class="look-swatch"
                classList={{ on: accent()?.toLowerCase() === c }}
                style={{ background: c }}
                role="radio"
                aria-checked={accent()?.toLowerCase() === c}
                aria-label={c}
                title={c}
                disabled={!p.editable}
                onClick={() => set({ accent: c })}
              />
            )}
          </For>
          <label class="look-swatch custom" title="A color of your own" classList={{ on: !!accent() && !ACCENTS.includes(accent()!.toLowerCase()) }}>
            <input type="color" value={accent() ?? "#5b4cf0"} disabled={!p.editable} onChange={(e) => set({ accent: e.currentTarget.value })} />
          </label>
        </div>
      </div>
      <div class="look-row">
        <span class="look-label">Typeface</span>
        <div class="segmented" role="group" aria-label="Typeface">
          <For each={Object.keys(BRAND_FONTS) as BrandFont[]}>
            {(f) => (
              <button classList={{ on: (brand().font ?? "sans") === f }} style={{ "font-family": BRAND_FONTS[f] }} disabled={!p.editable} onClick={() => set({ font: f })}>
                {BRAND_FONT_NAMES[f]}
              </button>
            )}
          </For>
        </div>
      </div>
      {/* What it looks like: a focal block and a callout */}
      <div class="look-preview" style={{ "font-family": BRAND_FONTS[brand().font ?? "sans"], ...(accent() ? { "--brand": accent()! } : {}) }}>
        <span class="look-block">Step</span>
        <span class="look-block focal">The one that matters</span>
        <span class="look-callout">Why it matters</span>
      </div>
      <Show when={p.editable}>
        <p class="panel-hint">For every board in this project and their exports. Mark a block as the focus from its toolbar.</p>
      </Show>
    </div>
  );
}
