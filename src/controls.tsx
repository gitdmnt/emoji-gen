//! Small form controls shared by the panels.

import { createEffect, createSignal, For, type JSX } from "solid-js";
import { hexToHsv, hsvToHex, type Hsv } from "./color";

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
  const [hsv, setHsv] = createSignal(hexToHsv(props.value));
  let emitted = "";
  createEffect(() => {
    const value = props.value;
    if (value !== emitted) {
      emitted = "";
      setHsv(hexToHsv(value));
    }
  });
  const change = (patch: Partial<Hsv>) => {
    const next = { ...hsv(), ...patch };
    setHsv(next);
    emitted = hsvToHex(next);
    props.onChange(emitted);
  };
  const point = (e: PointerEvent) => {
    const rect = e.currentTarget instanceof HTMLElement ? e.currentTarget.getBoundingClientRect() : null;
    if (!rect) return;
    change({ s: Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)),
      v: Math.max(0, Math.min(100, (rect.bottom - e.clientY) / rect.height * 100)) });
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
      <div class="color-plane" role="application" tabIndex={0}
        aria-label={`${props.label}の彩度 ${Math.round(hsv().s)}%、明度 ${Math.round(hsv().v)}%。矢印キーで調整`}
        style={{ "background-color": `hsl(${hsv().h} 100% 50%)` }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); point(e); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e); }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1;
          const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
          const d = delta[e.key];
          if (!d) return;
          e.preventDefault();
          change({ s: Math.max(0, Math.min(100, hsv().s + d[0])), v: Math.max(0, Math.min(100, hsv().v + d[1])) });
        }}>
        <span class="color-marker" style={{ left: `${hsv().s}%`, top: `${100 - hsv().v}%` }} />
      </div>
      <input class="color-hue" type="range" min="0" max="360" value={hsv().h}
        aria-label={`${props.label}の色相`} onInput={(e) => change({ h: e.currentTarget.valueAsNumber })} />
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
