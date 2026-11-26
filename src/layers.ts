//! Effect layers: their data, presets, and the pure pixel math that turns a stack into one image
//! (coverage of each layer's shape, then W3C separable blending and source-over compositing).

export type PaintKind = "solid" | "linear" | "metal" | "rainbow";

export type Paint = {
  kind: PaintKind;
  color: string;
  from: string;
  to: string;
  metal: string;
  /** Gradient direction in degrees: 0 = left to right, 90 = top to bottom. */
  angle: number;
  /** Whether gradients repeat on each line or span the whole art. */
  perLine: boolean;
};

export type LayerType = "fill" | "stroke" | "shadow";
export type StrokePosition = "outside" | "center" | "inside";

export const BLENDS = [
  ["normal", "通常"],
  ["multiply", "乗算"],
  ["screen", "スクリーン"],
  ["overlay", "オーバーレイ"],
  ["darken", "比較(暗)"],
  ["lighten", "比較(明)"],
  ["color-dodge", "覆い焼きカラー"],
  ["color-burn", "焼き込みカラー"],
  ["hard-light", "ハードライト"],
  ["soft-light", "ソフトライト"],
  ["difference", "差の絶対値"],
] as const;
export type Blend = (typeof BLENDS)[number][0];

/** Lengths are in pixels of a 256 canvas. */
export type Layer = {
  id: number;
  type: LayerType;
  visible: boolean;
  /** 0 to 100. */
  opacity: number;
  blend: Blend;
  paint: Paint;
  /** Stroke width, or how far a shadow spreads beyond the glyphs. */
  width: number;
  position: StrokePosition;
  dx: number;
  dy: number;
  blur: number;
};

export const METALS = [
  { label: "金", color: "#e0a526" },
  { label: "銀", color: "#a9b4bf" },
  { label: "銅", color: "#c26a3a" },
  { label: "ローズ", color: "#e59a92" },
];

const PAINT: Paint = {
  kind: "solid",
  color: "#ff9f1c",
  from: "#ff4f8b",
  to: "#ffc21c",
  metal: "#e0a526",
  angle: 90,
  perLine: true,
};

/** A new layer of `type` with the usual starting values; `over` replaces some of them. */
export function makeLayer(type: LayerType, over: Partial<Omit<Layer, "paint">> & { paint?: Partial<Paint> } = {}): Layer {
  const base: Layer = {
    id: 0,
    type,
    visible: true,
    opacity: 100,
    blend: "normal",
    paint: { ...PAINT, color: type === "fill" ? PAINT.color : type === "stroke" ? "#ffffff" : "#1f3242" },
    width: type === "stroke" ? 8 : 0,
    position: "outside",
    dx: type === "shadow" ? 4 : 0,
    dy: type === "shadow" ? 4 : 0,
    blur: type === "shadow" ? 6 : 0,
  };
  return { ...base, ...over, paint: { ...base.paint, ...over.paint } };
}

/** Ids from 1 in list order. */
function numbered(layers: Layer[]): Layer[] {
  return layers.map((l, i) => ({ ...l, id: i + 1 }));
}

/** Layer stacks are listed front first, as in a layer panel. */
export const PRESETS: { name: string; layers: Layer[] }[] = [
  {
    name: "標準",
    layers: numbered([
      makeLayer("fill"),
      makeLayer("stroke", { width: 7 }),
      makeLayer("stroke", { width: 12, paint: { color: "#2a8fd6" } }),
    ]),
  },
  {
    name: "金",
    layers: numbered([
      makeLayer("fill", { paint: { kind: "metal", metal: "#e0a526" } }),
      makeLayer("stroke", { width: 4, paint: { color: "#3a2200" } }),
      makeLayer("stroke", { width: 10 }),
    ]),
  },
  {
    name: "銀",
    layers: numbered([
      makeLayer("fill", { paint: { kind: "metal", metal: "#a9b4bf" } }),
      makeLayer("stroke", { width: 4, paint: { color: "#26303a" } }),
      makeLayer("stroke", { width: 10 }),
    ]),
  },
  {
    name: "虹",
    layers: numbered([
      makeLayer("fill", { paint: { kind: "rainbow", angle: 0, perLine: false } }),
      makeLayer("stroke", { width: 7 }),
      makeLayer("stroke", { width: 11, paint: { color: "#1f3242" } }),
    ]),
  },
  {
    name: "ネオン",
    layers: numbered([
      makeLayer("fill", { paint: { color: "#ffffff" } }),
      makeLayer("stroke", { width: 5, paint: { color: "#3fd2ff" } }),
      makeLayer("shadow", { width: 6, dx: 0, dy: 0, blur: 14, paint: { color: "#3fd2ff" } }),
    ]),
  },
  {
    name: "ポップ",
    layers: numbered([
      makeLayer("fill", { paint: { kind: "linear", from: "#ff4f8b", to: "#ffc21c" } }),
      makeLayer("stroke", { width: 7 }),
      makeLayer("shadow", { width: 7, dx: 5, dy: 6, blur: 0, opacity: 80, paint: { color: "#2a8fd6" } }),
    ]),
  },
];

export const DEFAULT_LAYERS = PRESETS[0]!.layers;

/** Whether two stacks look the same (ids aside). */
export function sameLayers(a: Layer[], b: Layer[]): boolean {
  const strip = (ls: Layer[]) => JSON.stringify(ls.map(({ id: _, ...rest }) => rest));
  return strip(a) === strip(b);
}

/** How far beyond the glyphs a layer reaches, in pixels of a 256 canvas. */
export function layerReach(l: Layer): number {
  if (!l.visible) return 0;
  if (l.type === "stroke") return l.position === "outside" ? l.width : l.position === "center" ? l.width / 2 : 0;
  if (l.type === "shadow") return l.width + l.blur + Math.max(Math.abs(l.dx), Math.abs(l.dy));
  return 0;
}

// Paint stops, shared by the canvas renderer and the CSS swatches.

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `hex` moved toward white (t > 0) or black (t < 0). */
function shade(hex: string, t: number): string {
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const [r, g, b] = hexRgb(hex).map((v) => Math.round(v + (target - v) * k));
  return `rgb(${r} ${g} ${b})`;
}

/** Colour stops of `p` along its gradient (a single stop for solid paint). */
export function paintStops(p: Paint): [number, string][] {
  switch (p.kind) {
    case "solid":
      return [[0, p.color]];
    case "linear":
      return [[0, p.from], [1, p.to]];
    case "metal":
      // Polished metal: bright top, a hard horizon band in the middle, reflected light at the bottom.
      return [
        [0, shade(p.metal, -0.1)],
        [0.15, shade(p.metal, 0.2)],
        [0.42, shade(p.metal, 0.75)],
        [0.5, shade(p.metal, 0.25)],
        [0.502, shade(p.metal, -0.5)],
        [0.6, shade(p.metal, -0.3)],
        [0.85, shade(p.metal, 0.1)],
        [1, shade(p.metal, 0.45)],
      ];
    case "rainbow":
      return Array.from({ length: 13 }, (_, i) => [i / 12, `hsl(${i * 30} 95% 58%)`]);
  }
}

// Pixel math. Coverage arrays hold 0 to 1 per pixel; `sd` is the signed distance to the glyph edge
// (negative inside, see signedDistance in layout.ts).

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Coverage of the band of signed distances from `a` to `b` (either may be infinite). */
export function band(sd: Float32Array, a: number, b: number): Float32Array {
  const out = new Float32Array(sd.length);
  for (let i = 0; i < sd.length; i++) out[i] = clamp01(sd[i]! - a + 0.5) * clamp01(b - sd[i]! + 0.5);
  return out;
}

/**
 * Coverage of a layer's shape before any blur or offset. `mask` is the anti-aliased glyph alpha, `unit` the
 * canvas size over 256. An outside stroke reaches one pixel under the glyph edge so a fill on top leaves no seam.
 */
export function layerShape(l: Layer, mask: Float32Array, sd: Float32Array | null, unit: number): Float32Array {
  if (l.type === "fill" || !sd) return mask;
  const w = l.width * unit;
  if (l.type === "shadow") {
    const grown = band(sd, -Infinity, w);
    for (let i = 0; i < grown.length; i++) grown[i] = Math.max(grown[i]!, mask[i]!);
    return grown;
  }
  if (l.position === "outside") return band(sd, -1, w);
  if (l.position === "center") return band(sd, -w / 2, w / 2);
  const inner = band(sd, -w, Infinity);
  for (let i = 0; i < inner.length; i++) inner[i] = inner[i]! * mask[i]!;
  return inner;
}

type BlendFn = (cb: number, cs: number) => number;

const hardLight: BlendFn = (cb, cs) => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));

/** Separable blend functions of the W3C Compositing and Blending spec; `cb` is the backdrop, `cs` the source. */
export const BLEND_FNS: Record<Blend, BlendFn> = {
  normal: (_, cs) => cs,
  multiply: (cb, cs) => cb * cs,
  screen: (cb, cs) => cb + cs - cb * cs,
  overlay: (cb, cs) => hardLight(cs, cb),
  darken: Math.min,
  lighten: Math.max,
  "color-dodge": (cb, cs) => (cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
  "color-burn": (cb, cs) => (cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs)),
  "hard-light": hardLight,
  "soft-light": (cb, cs) => {
    if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
    const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
    return cb + (2 * cs - 1) * (d - cb);
  },
  difference: (cb, cs) => Math.abs(cb - cs),
};

/**
 * Blends one layer onto `acc` (premultiplied RGBA floats, 0 to 1) like canvas `source-over` with
 * `globalCompositeOperation = blend`: `paint` is the layer's RGBA bytes, `shape` its coverage.
 */
export function compositeLayer(
  acc: Float32Array,
  paint: Uint8ClampedArray,
  shape: Float32Array,
  opacity: number,
  blend: Blend,
): void {
  const fn = BLEND_FNS[blend];
  for (let i = 0; i < shape.length; i++) {
    const as = (paint[i * 4 + 3]! / 255) * shape[i]! * opacity;
    if (as <= 0) continue;
    const j = i * 4;
    const ab = acc[j + 3]!;
    for (let c = 0; c < 3; c++) {
      const cs = paint[j + c]! / 255;
      const cbPre = acc[j + c]!;
      const mixed = ab > 0 ? (1 - ab) * cs + ab * fn(cbPre / ab, cs) : cs;
      acc[j + c] = as * mixed + cbPre * (1 - as);
    }
    acc[j + 3] = as + ab * (1 - as);
  }
}

/** Visible layers in drawing order: the back of the list first. */
export function drawOrder(layers: Layer[]): Layer[] {
  return layers.filter((l) => l.visible && l.opacity > 0).reverse();
}

/** Straight-alpha RGBA bytes of a premultiplied float image. */
export function toBytes(acc: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(acc.length);
  for (let j = 0; j < acc.length; j += 4) {
    const a = acc[j + 3]!;
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) out[j + c] = Math.round((acc[j + c]! / a) * 255);
    out[j + 3] = Math.round(a * 255);
  }
  return out;
}
