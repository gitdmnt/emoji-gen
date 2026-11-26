import { createEffect, createSignal, For, on, onCleanup } from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import { Slider, Tabs, Tile } from "./controls";
import { FONTS, fontById, fontSpec } from "./fonts";
import { LayerPanel } from "./LayerPanel";
import { makeLayer, type Layer } from "./layers";
import { clearLineCache, DEFAULTS, render, type Settings } from "./render";

const STORAGE_KEY = "emoji-gen:v2";
/** Slack rejects custom emoji images above this size. */
const LIMIT = 128 * 1024;

/** Chat backgrounds for the size check: Slack's light message pane and its dark theme. */
const SURFACES = [
  { name: "light", bg: "#ffffff", text: "#1d1c1d" },
  { name: "dark", bg: "#1a1d21", text: "#d1d2d3" },
];

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const s: Settings = { ...structuredClone(DEFAULTS), ...saved };
    if (!Array.isArray(s.layers)) s.layers = structuredClone(DEFAULTS.layers);
    s.layers = s.layers.map((l: Layer) => makeLayer(l.type, l));
    return s;
  } catch {
    return structuredClone(DEFAULTS);
  }
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
  const img = (px: number) => <img src={png()?.url ?? ""} width={px} height={px} alt="" />;

  return (
    <>
      <header>
        <h1>emoji-gen</h1>
      </header>
      <main>
        <div class="steps">
          <Tile title="1 text">
            <textarea
              value={s.text}
              rows={3}
              spellcheck={false}
              onInput={(e) => set("text", e.currentTarget.value)}
            />
          </Tile>
          <Tile title="2 font">
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
          <Tile title="3 layers">
            <LayerPanel s={s} set={set} fontsLoaded={fontsLoaded()} />
          </Tile>
          <Tile title="4 layout">
            <Tabs
              value={s.mode}
              options={[["stretch", "行ごとに引き伸ばし"], ["keep", "比率を保つ"]] as const}
              onChange={(v) => set("mode", v)}
            />
            <Slider label="行間" value={s.gap} min={0} max={32} unit="px" onChange={(v) => set("gap", v)} />
            <Slider label="回転" value={s.rotation} min={-180} max={180} unit="°" onChange={(v) => set("rotation", v)} />
          </Tile>
        </div>
        <aside>
          <Tile title="5 preview">
            <div class="stage">
              <canvas ref={canvas} />
            </div>
            <div class="surfaces">
              <For each={SURFACES}>
                {(c) => (
                  <p class="surface" style={{ background: c.bg, color: c.text }}>
                    お疲れさま {img(22)} {img(48)}
                  </p>
                )}
              </For>
            </div>
          </Tile>
          <Tile title="6 save">
            <Tabs
              value={s.size}
              options={[[128, "128px"], [256, "256px"]] as const}
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
        </aside>
      </main>
    </>
  );
}
