//! Small form controls shared by the panels.

import { createEffect, createSignal, For, type JSX } from "solid-js";
import { hexToHsl, hslToHex, type Hsl } from "./color";

export function Tabs<T extends string | number | boolean>(props: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="tabs" role="tablist">
      <For each={props.options}>
        {([v, label]) => (
          <button role="tab" aria-selected={props.value === v} onClick={() => props.onChange(v)}>
            {label}
          </button>
        )}
      </For>
    </div>
  );
}

export function Color(props: { label: string; value: string; onChange: (v: string) => void }) {
  const [hsl, setHsl] = createSignal(hexToHsl(props.value));
  let emitted = "";
  createEffect(() => {
    const value = props.value;
    if (value !== emitted) {
      emitted = "";
      setHsl(hexToHsl(value));
    }
  });
  const change = (key: keyof Hsl, value: number) => {
    const next = { ...hsl(), [key]: value };
    setHsl(next);
    emitted = hslToHex(next);
    props.onChange(emitted);
  };
  return (
    <div class="color-picker">
      <label class="row">
        <span>{props.label}</span>
        <span class="color-preview" style={{ background: props.value }} />
        <input
          class="hex"
          aria-label={`${props.label}のカラーコード`}
          value={props.value}
          maxLength={7}
          spellcheck={false}
          onChange={(e) => {
            const v = e.currentTarget.value.trim();
            if (/^#[0-9a-f]{6}$/i.test(v)) props.onChange(v.toLowerCase());
            else e.currentTarget.value = props.value;
          }}
        />
      </label>
      <For each={[["h", "色相", 360], ["s", "彩度", 100], ["l", "明度", 100]] as const}>
        {([key, label, max]) => (
          <label class="row color-channel">
            <span>{label}</span>
            <input type="range" min="0" max={max} value={hsl()[key]} aria-label={`${props.label}の${label}`}
              style={{ background: key === "h" ? "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)" :
                key === "s" ? `linear-gradient(to right, hsl(${hsl().h} 0% ${hsl().l}%), hsl(${hsl().h} 100% ${hsl().l}%))` :
                `linear-gradient(to right, black, hsl(${hsl().h} ${hsl().s}% 50%), white)` }}
              onInput={(e) => change(key, e.currentTarget.valueAsNumber)} />
            <output>{Math.round(hsl()[key])}{key === "h" ? "°" : "%"}</output>
          </label>
        )}
      </For>
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label class="row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.valueAsNumber)}
      />
      <output>
        {props.value}
        {props.unit ?? ""}
      </output>
    </label>
  );
}

export function Tile(props: { title: string; children: JSX.Element }) {
  return (
    <section class="tile">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
