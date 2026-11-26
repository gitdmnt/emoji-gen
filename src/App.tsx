import { createEffect, createSignal, For, on, onCleanup, Show, type JSX } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { FONTS, fontById, fontSpec } from "./fonts";
import { SURFACES, type Surface } from "./platforms";
import { clearLineCache, DEFAULTS, METALS, render, type Outline, type Settings } from "./render";

const STORAGE_KEY = "emoji-gen:v1";
/** Slack rejects custom emoji images above this size. */
const LIMIT = 128 * 1024;

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...structuredClone(DEFAULTS), ...saved };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function Tabs<T extends string | number | boolean>(props: {
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

function Color(props: { label: string; value: string; onChange: (v: string) => void }) {
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

function Slider(props: {
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

function Tile(props: { title: string; children: JSX.Element }) {
  return (
    <section class="tile">
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}

function SurfacePreview(props: { surface: Surface; url: string }) {
  const s = () => props.surface;
  const img = (px: number) => <img src={props.url} width={px} height={px} alt="" />;
  return (
    <figure class="surface" style={{ background: s().bg, color: s().text }}>
      <figcaption style={{ color: s().muted }}>
        {s().app} {s().theme}
      </figcaption>
      <p>
        <b>naot</b> <small style={{ color: s().muted }}>12:34</small>
      </p>
      <p>今日もお疲れさま {img(s().inline)} です</p>
      {img(s().jumbo)}
      <span class="reaction" style={{ background: s().reaction }}>
        {img(s().react)} 3
      </span>
    </figure>
  );
}

export default function App() {
  const [s, set] = createStore<Settings>(loadSettings());
  const [fontsLoaded, setFontsLoaded] = createSignal(0);
  const [png, setPng] = createSignal<{ url: string; blob: Blob } | null>(null);
  let canvas!: HTMLCanvasElement;

  createEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(s)));

  // Ask for the glyph subsets the text needs; any finished font load re-measures the lines.
  const onFontsLoaded = () => {
    clearLineCache();
    setFontsLoaded((n) => n + 1);
  };
  document.fonts.addEventListener("loadingdone", onFontsLoaded);
  onCleanup(() => document.fonts.removeEventListener("loadingdone", onFontsLoaded));
  createEffect(
    on([() => s.font, () => s.text], ([id, text]) => {
      void document.fonts.load(fontSpec(fontById(id), 64), text);
    }),
  );

  createEffect(() => {
    fontsLoaded();
    JSON.stringify(s);
    if (!document.fonts.check(fontSpec(fontById(s.font), 64), s.text)) return;
    render(canvas, unwrap(s));
    canvas.toBlob((blob) => {
      if (!blob) return;
      const prev = png();
      setPng({ url: URL.createObjectURL(blob), blob });
      if (prev) URL.revokeObjectURL(prev.url);
    }, "image/png");
  });
  onCleanup(() => {
    const p = png();
    if (p) URL.revokeObjectURL(p.url);
  });

  const fileName = () => (s.text.replace(/\s+/g, "").slice(0, 24) || "emoji") + ".png";
  const kb = () => (png() ? (png()!.blob.size / 1024).toFixed(1) : "");
  const over = () => (png()?.blob.size ?? 0) > LIMIT;

  const outlineControls = (key: "outline" | "outline2", title: string) => {
    const o = (): Outline => s[key];
    return (
      <fieldset>
        <legend>{title}</legend>
        <Slider label="太さ" value={o().width} min={1} max={24} unit="px" onChange={(v) => set(key, "width", v)} />
        <Color label="色" value={o().color} onChange={(v) => set(key, "color", v)} />
      </fieldset>
    );
  };

  return (
    <>
      <header>
        <h1>emoji-gen</h1>
      </header>
      <main>
        <div class="col">
          <Tile title="text">
            <textarea
              value={s.text}
              rows={3}
              spellcheck={false}
              onInput={(e) => set("text", e.currentTarget.value)}
            />
          </Tile>
          <Tile title="font">
            <div class="fonts" role="tablist">
              <For each={FONTS}>
                {(f) => (
                  <button role="tab" aria-selected={s.font === f.id} onClick={() => set("font", f.id)}>
                    <span class="sample" style={{ "font-family": `"${f.family}"`, "font-weight": f.weight }}>
                      あア字
                    </span>
                    <small>{f.label}</small>
                  </button>
                )}
              </For>
            </div>
          </Tile>
          <Tile title="layout">
            <Tabs
              value={s.mode}
              options={[["stretch", "行ごとに引き伸ばし"], ["keep", "比率を保つ"]] as const}
              onChange={(v) => set("mode", v)}
            />
            <Slider label="行間" value={s.gap} min={0} max={32} unit="px" onChange={(v) => set("gap", v)} />
            <Slider label="回転" value={s.rotation} min={-180} max={180} unit="°" onChange={(v) => set("rotation", v)} />
          </Tile>
        </div>
        <div class="col">
          <Tile title="output">
            <div class="stage">
              <canvas ref={canvas} />
            </div>
            <Tabs
              value={s.size}
              options={[[128, "128"], [256, "256"]] as const}
              onChange={(v) => set("size", v)}
            />
            <div class="download">
              <a class="primary" href={png()?.url} download={fileName()}>
                PNG を保存
              </a>
              <output classList={{ over: over() }}>
                {kb()} / 128 KB
              </output>
            </div>
          </Tile>
          <Tile title="fill">
            <Tabs
              value={s.paint}
              options={[["solid", "単色"], ["linear", "グラデーション"], ["metal", "金属"], ["rainbow", "虹"]] as const}
              onChange={(v) => set("paint", v)}
            />
            <Show when={s.paint === "solid"}>
              <Color label="文字色" value={s.color} onChange={(v) => set("color", v)} />
            </Show>
            <Show when={s.paint === "linear"}>
              <Color label="始点" value={s.from} onChange={(v) => set("from", v)} />
              <Color label="終点" value={s.to} onChange={(v) => set("to", v)} />
            </Show>
            <Show when={s.paint === "metal"}>
              <Tabs
                value={s.metal}
                options={METALS.map((m) => [m.color, m.label] as const)}
                onChange={(v) => set("metal", v)}
              />
              <Color label="地金" value={s.metal} onChange={(v) => set("metal", v)} />
            </Show>
            <Show when={s.paint !== "solid"}>
              <Slider label="向き" value={s.angle} min={0} max={359} unit="°" onChange={(v) => set("angle", v)} />
              <Tabs
                value={s.perLine}
                options={[[true, "行ごと"], [false, "全体"]] as const}
                onChange={(v) => set("perLine", v)}
              />
            </Show>
          </Tile>
          <Tile title="outline">
            <Tabs
              value={s.edges}
              options={[[0, "なし"], [1, "一重"], [2, "二重"]] as const}
              onChange={(v) => set("edges", v)}
            />
            <Show when={s.edges >= 1}>{outlineControls("outline", "内側")}</Show>
            <Show when={s.edges >= 2}>{outlineControls("outline2", "外側")}</Show>
          </Tile>
        </div>
        <div class="col">
          <Tile title="preview">
            <div class="surfaces">
              <For each={SURFACES}>{(surface) => <SurfacePreview surface={surface} url={png()?.url ?? ""} />}</For>
            </div>
          </Tile>
          <Tile title="background">
            <Tabs
              value={s.bg}
              options={[[false, "透過"], [true, "塗る"]] as const}
              onChange={(v) => set("bg", v)}
            />
            <Show when={s.bg}>
              <Color label="背景色" value={s.bgColor} onChange={(v) => set("bgColor", v)} />
            </Show>
          </Tile>
        </div>
      </main>
    </>
  );
}
