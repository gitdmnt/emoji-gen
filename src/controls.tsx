//! Small form controls shared by the panels.

import { For, type JSX } from "solid-js";

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
  return (
    <label class="row">
      <span>{props.label}</span>
      <input type="color" value={props.value} onInput={(e) => props.onChange(e.currentTarget.value)} />
      <input
        class="hex"
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
