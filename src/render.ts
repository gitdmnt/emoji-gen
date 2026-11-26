//! Canvas rendering of the emoji: per-line glyph masks, stretched into rows, outlined, painted, rotated.

import { fontById, fontSpec, type Font } from "./fonts";
import { alphaBounds, distanceTransform, layoutLines, rotationFit, type Box, type FitMode } from "./layout";

export type PaintKind = "solid" | "linear" | "metal" | "rainbow";
export type Outline = { width: number; color: string };

export type Settings = {
  text: string;
  font: string;
  size: number;
  mode: FitMode;
  /** Gap between lines, in pixels of a 256 canvas. */
  gap: number;
  rotation: number;
  paint: PaintKind;
  /** Whether gradients span the whole art or repeat on each line. */
  perLine: boolean;
  color: string;
  from: string;
  to: string;
  metal: string;
  angle: number;
  /** Number of outlines drawn: none, `outline`, or `outline` wrapped in `outline2`. */
  edges: 0 | 1 | 2;
  /** Outline widths are in pixels of a 256 canvas. */
  outline: Outline;
  outline2: Outline;
  bg: boolean;
  bgColor: string;
};

export const DEFAULTS: Settings = {
  text: "最高\nです",
  font: "noto-sans",
  size: 256,
  mode: "stretch",
  gap: 0,
  rotation: 0,
  paint: "solid",
  perLine: true,
  color: "#ff9f1c",
  from: "#ff4f8b",
  to: "#ffc21c",
  metal: "#e0a526",
  angle: 90,
  edges: 1,
  outline: { width: 8, color: "#ffffff" },
  outline2: { width: 6, color: "#2a8fd6" },
  bg: false,
  bgColor: "#e9f6fd",
};

export const METALS = [
  { label: "金", color: "#e0a526" },
  { label: "銀", color: "#a9b4bf" },
  { label: "銅", color: "#c26a3a" },
  { label: "ローズ", color: "#e59a92" },
];

/** Font size of the offscreen line drawing; large so stretched glyphs stay sharp. */
const MEASURE_PX = 320;

type Line = { canvas: HTMLCanvasElement; box: Box };
const lineCache = new Map<string, Line | null>();

/** Forgets measured lines; call after a web font finishes loading. */
export function clearLineCache(): void {
  lineCache.clear();
}

/** Draws `text` once at MEASURE_PX and finds the box of its opaque pixels. */
function measureLine(text: string, font: Font): Line | null {
  const key = `${font.id}\n${text}`;
  const hit = lineCache.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.font = fontSpec(font, MEASURE_PX);
  const pad = MEASURE_PX / 2;
  canvas.width = Math.min(16000, Math.ceil(ctx.measureText(text).width + 2 * pad));
  canvas.height = MEASURE_PX * 2;
  ctx.font = fontSpec(font, MEASURE_PX);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(text, pad, MEASURE_PX);
  const box = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const line = box && { canvas, box };
  if (lineCache.size > 64) lineCache.clear();
  lineCache.set(key, line);
  return line;
}

function canvas2d(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

/** Linear gradient through the centre of `r` at `deg` degrees (0 = left to right, 90 = top to bottom). */
function gradient(ctx: CanvasRenderingContext2D, r: Box, deg: number, stops: [number, string][]): CanvasGradient {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const half = (Math.abs(cos) * r.w + Math.abs(sin) * r.h) / 2;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const g = ctx.createLinearGradient(cx - cos * half, cy - sin * half, cx + cos * half, cy + sin * half);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

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

/** Polished metal: bright top, a hard horizon band in the middle, reflected light at the bottom. */
function metalStops(base: string): [number, string][] {
  return [
    [0, shade(base, -0.1)],
    [0.15, shade(base, 0.2)],
    [0.42, shade(base, 0.75)],
    [0.5, shade(base, 0.25)],
    [0.502, shade(base, -0.5)],
    [0.6, shade(base, -0.3)],
    [0.85, shade(base, 0.1)],
    [1, shade(base, 0.45)],
  ];
}

function rainbowStops(): [number, string][] {
  return Array.from({ length: 13 }, (_, i) => [i / 12, `hsl(${i * 30} 95% 58%)`]);
}

function paintStyle(ctx: CanvasRenderingContext2D, s: Settings, r: Box): string | CanvasGradient {
  switch (s.paint) {
    case "solid":
      return s.color;
    case "linear":
      return gradient(ctx, r, s.angle, [[0, s.from], [1, s.to]]);
    case "metal":
      return gradient(ctx, r, s.angle, metalStops(s.metal));
    case "rainbow":
      return gradient(ctx, r, s.angle, rainbowStops());
  }
}

/** Layer of `color` covering every pixel within `radius` of the mask (anti-aliased edge). */
function outlineLayer(dist: Float32Array, size: number, radius: number, color: string): HTMLCanvasElement {
  const [c, ctx] = canvas2d(size);
  const img = ctx.createImageData(size, size);
  const [r, g, b] = hexRgb(color);
  for (let i = 0; i < dist.length; i++) {
    const a = Math.min(1, Math.max(0, radius + 0.5 - dist[i]!));
    if (a === 0) continue;
    img.data.set([r, g, b, Math.round(a * 255)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Renders `s` into `out`, resizing it to the chosen size. */
export function render(out: HTMLCanvasElement, s: Settings): void {
  const size = s.size;
  const unit = size / 256;
  const font = fontById(s.font);
  const lines = s.text
    .split("\n")
    .map((t) => measureLine(t, font))
    .filter((l): l is Line => l !== null);

  const w1 = s.edges >= 1 ? s.outline.width * unit : 0;
  const w2 = s.edges >= 2 ? s.outline2.width * unit : 0;
  const reach = w1 + w2;
  const inset = reach;
  const rects = layoutLines(lines.map((l) => l.box), size, s.mode, inset, s.gap * unit);

  const [mask, mctx] = canvas2d(size);
  mctx.imageSmoothingQuality = "high";
  lines.forEach((l, i) => {
    const r = rects[i]!;
    mctx.drawImage(l.canvas, l.box.x, l.box.y, l.box.w, l.box.h, r.x, r.y, r.w, r.h);
  });

  const [art, actx] = canvas2d(size);
  if (reach > 0) {
    const alpha = mctx.getImageData(0, 0, size, size).data;
    const inside = new Uint8Array(size * size);
    for (let i = 0; i < inside.length; i++) inside[i] = alpha[i * 4 + 3]! >= 128 ? 1 : 0;
    const dist = distanceTransform(inside, size, size);
    if (w2 > 0) actx.drawImage(outlineLayer(dist, size, reach, s.outline2.color), 0, 0);
    if (w1 > 0) actx.drawImage(outlineLayer(dist, size, w1, s.outline.color), 0, 0);
  }

  const [fill, fctx] = canvas2d(size);
  const whole = rects.length
    ? (() => {
        const x = Math.min(...rects.map((r) => r.x)), y = rects[0]!.y;
        const last = rects[rects.length - 1]!;
        return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: last.y + last.h - y };
      })()
    : { x: 0, y: 0, w: size, h: size };
  for (const r of s.perLine && s.paint !== "solid" ? rects : [whole]) {
    fctx.fillStyle = paintStyle(fctx, s, r);
    fctx.fillRect(r.x, r.y, r.w, r.h);
  }
  fctx.globalCompositeOperation = "destination-in";
  fctx.drawImage(mask, 0, 0);
  actx.drawImage(fill, 0, 0);

  out.width = out.height = size;
  const ctx = out.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  if (s.bg) {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, size, size);
  }
  const k = rotationFit(s.rotation);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate((s.rotation * Math.PI) / 180);
  ctx.scale(k, k);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(art, -size / 2, -size / 2);
  ctx.restore();
}
