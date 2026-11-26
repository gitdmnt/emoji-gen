//! Canvas rendering of the emoji: per-line glyph masks stretched into rows, then the effect layers
//! (fills, strokes, shadows) painted and composited back to front, then rotation and background.

import { fontById, fontSpec, type Font } from "./fonts";
import { alphaBounds, layoutLines, rotationFit, signedDistance, type Box, type FitMode } from "./layout";
import {
  compositeLayer,
  DEFAULT_LAYERS,
  drawOrder,
  layerReach,
  layerShape,
  paintStops,
  toBytes,
  type Layer,
  type Paint,
} from "./layers";

export type Settings = {
  text: string;
  font: string;
  size: number;
  mode: FitMode;
  /** Gap between lines, in pixels of a 256 canvas. */
  gap: number;
  rotation: number;
  /** Front first. */
  layers: Layer[];
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
  layers: DEFAULT_LAYERS,
  bg: false,
  bgColor: "#e9f6fd",
};

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

/** RGBA bytes of `p` over the whole canvas; each line's gradient spans its rect and owns the band of rows around it. */
function paintPixels(p: Paint, size: number, rects: Box[], whole: Box): Uint8ClampedArray {
  const [, ctx] = canvas2d(size);
  if (p.kind === "solid") {
    ctx.fillStyle = p.color;
    ctx.fillRect(0, 0, size, size);
  } else {
    const parts = p.perLine ? rects : [whole];
    parts.forEach((r, i) => {
      const top = i === 0 ? 0 : (parts[i - 1]!.y + parts[i - 1]!.h + r.y) / 2;
      const next = parts[i + 1];
      const bottom = next ? (r.y + r.h + next.y) / 2 : size;
      ctx.fillStyle = gradient(ctx, r, p.angle, paintStops(p));
      ctx.fillRect(0, Math.floor(top), size, Math.ceil(bottom) - Math.floor(top));
    });
  }
  return ctx.getImageData(0, 0, size, size).data;
}

/** `shape` moved by (dx, dy) and blurred with a canvas shadow of `blur` pixels. */
function shiftBlur(shape: Float32Array, size: number, dx: number, dy: number, blur: number): Float32Array {
  const [src, sctx] = canvas2d(size);
  const img = sctx.createImageData(size, size);
  for (let i = 0; i < shape.length; i++) img.data[i * 4 + 3] = Math.round(shape[i]! * 255);
  sctx.putImageData(img, 0, 0);
  const [, ctx] = canvas2d(size);
  // Draw the shape off canvas and keep only its shadow, which works where `ctx.filter` does not.
  ctx.shadowColor = "#000";
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = dx + size * 2;
  ctx.shadowOffsetY = dy;
  ctx.drawImage(src, -size * 2, 0);
  const data = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(shape.length);
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4 + 3]! / 255;
  return out;
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

  const layers = drawOrder(s.layers);
  const inset = Math.max(0, ...layers.map(layerReach)) * unit;
  const rects = layoutLines(lines.map((l) => l.box), size, s.mode, inset, s.gap * unit);

  const [, mctx] = canvas2d(size);
  mctx.imageSmoothingQuality = "high";
  lines.forEach((l, i) => {
    const r = rects[i]!;
    mctx.drawImage(l.canvas, l.box.x, l.box.y, l.box.w, l.box.h, r.x, r.y, r.w, r.h);
  });
  const maskData = mctx.getImageData(0, 0, size, size).data;
  const mask = new Float32Array(size * size);
  for (let i = 0; i < mask.length; i++) mask[i] = maskData[i * 4 + 3]! / 255;
  const sd = layers.some((l) => l.type !== "fill") ? signedDistance(mask, size, size) : null;

  const whole = rects.length
    ? (() => {
        const x = Math.min(...rects.map((r) => r.x)), y = rects[0]!.y;
        const last = rects[rects.length - 1]!;
        return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: last.y + last.h - y };
      })()
    : { x: 0, y: 0, w: size, h: size };

  const acc = new Float32Array(size * size * 4);
  for (const l of layers) {
    let shape = layerShape(l, mask, sd, unit);
    if (l.type === "shadow") shape = shiftBlur(shape, size, l.dx * unit, l.dy * unit, l.blur * unit);
    compositeLayer(acc, paintPixels(l.paint, size, rects, whole), shape, l.opacity / 100, l.blend);
  }
  const [art, actx] = canvas2d(size);
  const img = actx.createImageData(size, size);
  img.data.set(toBytes(acc));
  actx.putImageData(img, 0, 0);

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
