//! Canvas rendering of the emoji: per-line glyph masks stretched into rows, then the effect layers applied
//! in list order (see applyLayers), then rotation and background.

import { fontById, fontSpec, type Font } from "./fonts";
import { alphaBounds, layoutLines, rotationFit, sharedLineBounds, type Box, type FitMode, type TextAlign } from "./layout";
import { applyLayers, DEFAULT_LAYERS, paintStops, stackReach, toBytes, type Layer, type Paint } from "./layers";
import { metalPixels } from "./metal";

export type Settings = {
  text: string;
  font: string;
  size: number;
  mode: FitMode;
  align: TextAlign;
  /** Gap between lines, in pixels of a 256 canvas. */
  gap: number;
  rotation: number;
  /** In the order they apply. */
  layers: Layer[];
  bg: boolean;
  bgColor: string;
};

export const DEFAULTS: Settings = {
  text: "最高\nです",
  font: "noto-sans",
  size: 256,
  mode: "stretch",
  align: "center",
  gap: 0,
  rotation: 0,
  layers: DEFAULT_LAYERS,
  bg: false,
  bgColor: "#e9f6fd",
};

/** Font size of the offscreen line drawing; large so stretched glyphs stay sharp. */
const MEASURE_PX = 320;

type Line = { canvas: HTMLCanvasElement; box: Box | null; width: number };
const lineCache = new Map<string, Line>();

/** Forgets measured lines; call after a web font finishes loading. */
export function clearLineCache(): void {
  lineCache.clear();
}

/** Measures a line's glyphs and whitespace. */
function measureLine(text: string, font: Font): Line {
  const key = `${font.id}\n${text}`;
  const hit = lineCache.get(key);
  if (hit !== undefined) return hit;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.font = fontSpec(font, MEASURE_PX);
  const pad = MEASURE_PX / 2;
  const width = ctx.measureText(text).width;
  canvas.width = Math.min(16000, Math.ceil(width + 2 * pad));
  canvas.height = MEASURE_PX * 2;
  ctx.font = fontSpec(font, MEASURE_PX);
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(text, pad, MEASURE_PX);
  const ink = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const leading = ctx.measureText(text.match(/^[ \u3000]*/)?.[0] ?? "").width;
  const trailing = ctx.measureText(text.match(/[ \u3000]*$/)?.[0] ?? "").width;
  const left = ink ? Math.max(0, ink.x - leading) : pad;
  const right = ink ? Math.min(canvas.width, ink.x + ink.w + trailing) : Math.min(canvas.width, pad + width);
  const box = ink && { ...ink, x: left, w: right - left };
  const line = { canvas, box, width: Math.max(1, right - left) };
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

/** The rows each part of a gradient owns: a line's gradient spans its rect and the band of rows around it. */
function gradientParts(p: Paint, size: number, rects: Box[], whole: Box): { r: Box; top: number; bottom: number }[] {
  const parts = p.perLine ? rects : [whole];
  return parts.map((r, i) => {
    const prev = parts[i - 1], next = parts[i + 1];
    const top = prev ? Math.floor((prev.y + prev.h + r.y) / 2) : 0;
    const bottom = next ? Math.ceil((r.y + r.h + next.y) / 2) : size;
    return { r, top, bottom };
  });
}

/** Each pixel's position (0 to 1) along the gradient of `p`, matching `gradient` above. */
function gradientT(p: Paint, size: number, rects: Box[], whole: Box): Float32Array {
  const t = new Float32Array(size * size);
  const a = (p.angle * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  for (const { r, top, bottom } of gradientParts(p, size, rects, whole)) {
    const span = Math.abs(cos) * r.w + Math.abs(sin) * r.h || 1;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    for (let y = Math.max(0, top); y < Math.min(size, bottom); y++)
      for (let x = 0; x < size; x++) t[y * size + x] = ((x + 0.5 - cx) * cos + (y + 0.5 - cy) * sin) / span + 0.5;
  }
  return t;
}

/** RGBA bytes of `p` over the whole canvas, for a layer covering `shape`. */
function paintPixels(p: Paint, size: number, unit: number, rects: Box[], whole: Box, shape: Float32Array): Uint8ClampedArray {
  if (p.kind === "metal") {
    const a = (p.angle * Math.PI) / 180;
    return metalPixels(p.metal, shape, gradientT(p, size, rects, whole), [Math.cos(a), Math.sin(a)], size, size, unit);
  }
  const [, ctx] = canvas2d(size);
  if (p.kind === "solid") {
    ctx.fillStyle = p.color;
    ctx.fillRect(0, 0, size, size);
  } else {
    for (const { r, top, bottom } of gradientParts(p, size, rects, whole)) {
      ctx.fillStyle = gradient(ctx, r, p.angle, paintStops(p));
      ctx.fillRect(0, top, size, bottom - top);
    }
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
  const lines = s.text.split("\n").map((t) => measureLine(t, font));

  const inset = stackReach(s.layers) * unit;
  const visible = lines.flatMap((l) => l.box ? [l.box] : []);
  const vertical = sharedLineBounds(visible)[0] ?? { x: 0, y: 0, w: 1, h: MEASURE_PX };
  const boxes = lines.map((l) => l.box
    ? { ...l.box, y: vertical.y, h: vertical.h }
    : { x: 0, y: vertical.y, w: l.width, h: vertical.h });
  const rects = layoutLines(boxes, size, s.mode, inset, s.gap * unit, s.align);

  const [, mctx] = canvas2d(size);
  mctx.imageSmoothingQuality = "high";
  lines.forEach((l, i) => {
    if (!l.box) return;
    const r = rects[i]!;
    const b = boxes[i]!;
    mctx.drawImage(l.canvas, b.x, b.y, b.w, b.h, r.x, r.y, r.w, r.h);
  });
  const maskData = mctx.getImageData(0, 0, size, size).data;
  const mask = new Float32Array(size * size);
  for (let i = 0; i < mask.length; i++) mask[i] = maskData[i * 4 + 3]! / 255;

  const whole = rects.length
    ? (() => {
        const x = Math.min(...rects.map((r) => r.x)), y = rects[0]!.y;
        const last = rects[rects.length - 1]!;
        return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: last.y + last.h - y };
      })()
    : { x: 0, y: 0, w: size, h: size };

  const acc = applyLayers(s.layers, mask, size, size, unit, {
    paint: (l, shape) => paintPixels(l.paint, size, unit, rects, whole, shape),
    shadow: (shape, dx, dy, blur) => shiftBlur(shape, size, dx, dy, blur),
  });
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
