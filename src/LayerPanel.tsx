//! The appearance panel: presets, the layer list (numbered in the order the layers apply, background fixed at
//! the bottom), and the properties of the selected layer.

import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { produce, unwrap, type SetStoreFunction } from "solid-js/store";
import { Color, Slider, Tabs } from "./controls";
import { fontById, fontSpec } from "./fonts";
import {
  BLENDS,
  makeLayer,
  METALS,
  paintStops,
  PRESETS,
  sameLayers,
  type Layer,
  type LayerType,
  type Paint,
} from "./layers";
import { render, type Settings } from "./render";

const TYPE_LABEL: Record<LayerType, string> = { fill: "塗り", stroke: "縁取り", shadow: "影" };
const POSITION_LABEL = { outside: "外側", center: "中央", inside: "内側" } as const;
const blendLabel = (b: string) => BLENDS.find(([v]) => v === b)?.[1] ?? b;

function paintCss(p: Paint): string {
  const stops = paintStops(p);
  if (stops.length === 1) return stops[0]![1];
  // Canvas 0° runs left to right, CSS 0° bottom to top.
  return `linear-gradient(${p.angle + 90}deg, ${stops.map(([o, c]) => `${c} ${o * 100}%`).join(", ")})`;
}

function Eye(props: { on: boolean; onClick: () => void }) {
  return (
    <button class="eye" aria-pressed={props.on} aria-label="表示" onClick={(e) => (e.stopPropagation(), props.onClick())}>
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
        <Show when={props.on} fallback={<path d="M3 17 17 3" />}>
          <circle cx="10" cy="10" r="2.5" fill="currentColor" />
        </Show>
      </svg>
    </button>
  );
}

function PresetButton(props: { name: string; layers: Layer[]; base: Settings | null; active: boolean; onClick: () => void }) {
  let canvas!: HTMLCanvasElement;
  createEffect(() => {
    if (props.base) render(canvas, { ...props.base, layers: props.layers, size: 96, rotation: 0, bg: false });
  });
  return (
    <button role="tab" aria-selected={props.active} onClick={props.onClick}>
      <canvas ref={canvas} width={96} height={96} />
      <small>{props.name}</small>
    </button>
  );
}

const freshId = (layers: Layer[]) => Math.max(0, ...layers.map((l) => l.id)) + 1;

export function LayerPanel(props: { s: Settings; set: SetStoreFunction<Settings>; fontsLoaded: number }) {
  const s = () => props.s;
  const set = props.set;
  const [selected, setSelected] = createSignal<number | "bg">(s().layers[0]?.id ?? "bg");
  const [dragId, setDragId] = createSignal<number | null>(null);
  const [dropId, setDropId] = createSignal<number | null>(null);

  const index = () => s().layers.findIndex((l) => l.id === selected());
  const current = () => s().layers[index()];
  const update = (fn: (l: Layer) => void) => set("layers", index(), produce(fn));
  const paint = (fn: (p: Paint) => void) => update((l) => fn(l.paint));
  const plain = () => structuredClone(unwrap(s().layers));

  const insert = (layer: Layer) => {
    const ls = plain();
    const at = index() < 0 ? ls.length : index() + 1;
    layer.id = freshId(ls);
    ls.splice(at, 0, layer);
    set("layers", ls);
    setSelected(layer.id);
  };
  const remove = () => {
    const i = index();
    const ls = plain();
    ls.splice(i, 1);
    set("layers", ls);
    setSelected(ls[Math.min(i, ls.length - 1)]?.id ?? "bg");
  };
  const move = (from: number, to: number) => {
    const ls = plain();
    if (to < 0 || to >= ls.length || from === to) return;
    const [l] = ls.splice(from, 1);
    ls.splice(to, 0, l!);
    set("layers", ls);
  };
  const applyPreset = (layers: Layer[]) => {
    set("layers", structuredClone(layers));
    setSelected(layers[0]!.id);
  };

  // Thumbnails show the user's own text; they wait for its glyphs like the main canvas does.
  const thumbBase = createMemo<Settings | null>(() => {
    props.fontsLoaded;
    const base = { ...unwrap(s()), text: s().text, font: s().font, mode: s().mode, gap: s().gap, size: 96 };
    return document.fonts.check(fontSpec(fontById(base.font), 64), base.text) ? base : null;
  });

  return (
    <>
      <div class="presets" role="tablist">
        <For each={PRESETS}>
          {(p) => (
            <PresetButton
              name={p.name}
              layers={p.layers}
              base={thumbBase()}
              active={sameLayers(s().layers, p.layers)}
              onClick={() => applyPreset(p.layers)}
            />
          )}
        </For>
      </div>
      <div class="toolbar">
        <For each={["fill", "stroke", "shadow"] as const}>
          {(t) => <button onClick={() => insert(makeLayer(t))}>＋{TYPE_LABEL[t]}</button>}
        </For>
        <span class="spacer" />
        <Show when={current()}>
          <button aria-label="先に" disabled={index() === 0} onClick={() => move(index(), index() - 1)}>
            ↑
          </button>
          <button aria-label="後に" disabled={index() === s().layers.length - 1} onClick={() => move(index(), index() + 1)}>
            ↓
          </button>
          <button onClick={() => insert({ ...structuredClone(unwrap(current()!)) })}>複製</button>
          <button onClick={remove}>削除</button>
        </Show>
      </div>
      <ul class="layers">
        <For each={s().layers}>
          {(l, i) => (
            <li
              classList={{ hidden: !l.visible, drop: dropId() === l.id && dragId() !== l.id }}
              aria-selected={selected() === l.id}
              draggable={true}
              onClick={() => setSelected(l.id)}
              onDragStart={(e) => (setDragId(l.id), e.dataTransfer?.setData("text/plain", String(l.id)))}
              onDragOver={(e) => (e.preventDefault(), setDropId(l.id))}
              onDragLeave={() => setDropId(null)}
              onDragEnd={() => (setDragId(null), setDropId(null))}
              onDrop={(e) => {
                e.preventDefault();
                const from = s().layers.findIndex((x) => x.id === dragId());
                if (from >= 0) move(from, i());
                setDragId(null);
                setDropId(null);
              }}
            >
              <span class="step">{i() + 1}</span>
              <Eye on={l.visible} onClick={() => set("layers", i(), "visible", (v) => !v)} />
              <span class={`swatch ${l.type}`} style={{ background: paintCss(l.paint) }} />
              <span class="name">{TYPE_LABEL[l.type]}</span>
              <span class="meta">
                <Show when={l.type === "stroke"}>
                  {l.width}px{l.position !== "outside" ? ` ${POSITION_LABEL[l.position]}` : ""}{" "}
                </Show>
                <Show when={l.blend !== "normal"}>{blendLabel(l.blend)} </Show>
                <Show when={l.opacity < 100}>{l.opacity}%</Show>
              </span>
            </li>
          )}
        </For>
        <li classList={{ hidden: !s().bg }} aria-selected={selected() === "bg"} onClick={() => setSelected("bg")}>
          <span class="step" />
          <Eye on={s().bg} onClick={() => set("bg", (v) => !v)} />
          <span class="swatch fill" style={{ background: s().bgColor }} />
          <span class="name">背景</span>
        </li>
      </ul>
      <Show when={selected() === "bg"}>
        <div class="props">
          <Color label="色" value={s().bgColor} onChange={(v) => set("bgColor", v)} />
        </div>
      </Show>
      <Show when={current()}>
        {(l) => (
          <div class="props">
            <Tabs
              value={l().paint.kind}
              options={[["solid", "単色"], ["linear", "グラデーション"], ["metal", "金属"], ["rainbow", "虹"]] as const}
              onChange={(v) => paint((p) => (p.kind = v))}
            />
            <Show when={l().paint.kind === "solid"}>
              <Color label="色" value={l().paint.color} onChange={(v) => paint((p) => (p.color = v))} />
            </Show>
            <Show when={l().paint.kind === "linear"}>
              <Color label="始点" value={l().paint.from} onChange={(v) => paint((p) => (p.from = v))} />
              <Color label="終点" value={l().paint.to} onChange={(v) => paint((p) => (p.to = v))} />
            </Show>
            <Show when={l().paint.kind === "metal"}>
              <Tabs
                value={l().paint.metal}
                options={METALS.map((m) => [m.color, m.label] as const)}
                onChange={(v) => paint((p) => (p.metal = v))}
              />
              <Color label="地金" value={l().paint.metal} onChange={(v) => paint((p) => (p.metal = v))} />
            </Show>
            <Show when={l().paint.kind !== "solid"}>
              <Slider label="向き" value={l().paint.angle} min={0} max={359} unit="°" onChange={(v) => paint((p) => (p.angle = v))} />
              <Tabs
                value={l().paint.perLine}
                options={[[true, "行ごと"], [false, "全体"]] as const}
                onChange={(v) => paint((p) => (p.perLine = v))}
              />
            </Show>
            <Show when={l().type === "stroke"}>
              <Slider label="太さ" value={l().width} min={1} max={24} unit="px" onChange={(v) => update((x) => (x.width = v))} />
              <Tabs
                value={l().position}
                options={Object.entries(POSITION_LABEL) as [Layer["position"], string][]}
                onChange={(v) => update((x) => (x.position = v))}
              />
            </Show>
            <Show when={l().type === "shadow"}>
              <Slider label="広がり" value={l().width} min={0} max={24} unit="px" onChange={(v) => update((x) => (x.width = v))} />
              <Slider label="ぼかし" value={l().blur} min={0} max={32} unit="px" onChange={(v) => update((x) => (x.blur = v))} />
              <Slider label="横" value={l().dx} min={-16} max={16} unit="px" onChange={(v) => update((x) => (x.dx = v))} />
              <Slider label="縦" value={l().dy} min={-16} max={16} unit="px" onChange={(v) => update((x) => (x.dy = v))} />
            </Show>
            <Slider label="不透明度" value={l().opacity} min={0} max={100} unit="%" onChange={(v) => update((x) => (x.opacity = v))} />
            <label class="row">
              <span>合成</span>
              <select value={l().blend} onChange={(e) => update((x) => (x.blend = e.currentTarget.value as Layer["blend"]))}>
                <For each={BLENDS}>{([v, label]) => <option value={v}>{label}</option>}</For>
              </select>
            </label>
          </div>
        )}
      </Show>
    </>
  );
}
