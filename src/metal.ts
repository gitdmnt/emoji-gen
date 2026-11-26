//! Polished metal paint. The colour comes from a reflected environment (a bright sky, a hard horizon, a dark
//! ground with light bouncing back at the bottom) read along the gradient direction. A rounded bevel along the
//! edges tilts the surface, so the edges reflect other parts of that environment, catch a key light from the top
//! left and show thin specular streaks. Tones shift hue as well as lightness: gold goes pale yellow in the light
//! and orange brown in the dark.

import { signedDistance } from "./layout";

/** Brightness of the reflected environment along the gradient: -1 darkest, 1 brightest. */
const ENV: [number, number][] = [
  [0, 0.05],
  [0.12, 0.45],
  [0.3, 0.12],
  [0.45, 0.7],
  [0.5, 0.92],
  [0.52, -0.8],
  [0.6, -0.55],
  [0.8, -0.1],
  [0.93, 0.42],
  [1, 0.1],
];

function envAt(t: number): number {
  if (t <= 0) return ENV[0]![1];
  for (let i = 1; i < ENV.length; i++) {
    const [t1, v1] = ENV[i]!;
    if (t <= t1) {
      const [t0, v0] = ENV[i - 1]!;
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return ENV[ENV.length - 1]![1];
}

function hexHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** The metal `base` at brightness `v` (-1 to 1): lighter tones turn toward yellow white, darker ones toward red brown. */
export function metalTone(base: string, v: number): [number, number, number] {
  const [h, s, l] = hexHsl(base);
  if (v >= 0) return hslRgb(h + 8 * v, s * (1 - 0.15 * v), l + (0.93 - l) * v);
  const k = -v;
  return hslRgb(h - 16 * k, Math.min(1, s * (1 + 0.25 * k)), l * (1 - 0.8 * k));
}

/** The environment as colour stops, for flat previews of the paint. */
export function metalStops(base: string): [number, string][] {
  return ENV.map(([t, v]) => [t, `rgb(${metalTone(base, v).join(" ")})`]);
}

/** Direction of the key light (from the top left, toward the viewer) and the half vector toward the viewer. */
const LIGHT = (() => {
  const v = [-0.45, -0.65, 0.62];
  const n = Math.hypot(...v);
  return v.map((x) => x / n) as [number, number, number];
})();
const HALF = (() => {
  const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1];
  const n = Math.hypot(...v);
  return v.map((x) => x / n) as [number, number, number];
})();

/**
 * RGBA bytes of metal `base` over `shape` (coverage, `width` x `height`). `t` holds each pixel's position along
 * the gradient (0 to 1) and `dir` the gradient direction; `unit` is the canvas size over 256.
 */
export function metalPixels(
  base: string,
  shape: Float32Array,
  t: Float32Array,
  dir: [number, number],
  width: number,
  height: number,
  unit: number,
): Uint8ClampedArray {
  const tones = Array.from({ length: 256 }, (_, i) => metalTone(base, (i / 255) * 2 - 1));
  const sd = signedDistance(shape, width, height);
  // The bevel narrows on thin strokes so their faces keep a flat part. A slab of thickness T has a mean inside
  // distance of T / 4.
  let sum = 0, count = 0;
  for (let i = 0; i < sd.length; i++) if (sd[i]! < 0) (sum -= sd[i]!), count++;
  const halfThickness = count ? (2 * sum) / count : 0;
  const bevel = Math.max(1.5, Math.min(5 * unit, 0.6 * halfThickness));
  // Height rises from the edge over the bevel width in a rounded profile, flat beyond; blurred so the
  // pixel steps of the distance field do not show in the normals.
  const h = new Float32Array(shape.length);
  for (let i = 0; i < h.length; i++) {
    const d = Math.min(1, Math.max(0, -sd[i]!) / bevel);
    h[i] = shape[i]! * bevel * (1 - (1 - d) * (1 - d));
  }
  const r = Math.max(1, Math.round(1.5 * unit));
  for (let pass = 0; pass < 2; pass++) boxBlur(h, width, height, r);
  const out = new Uint8ClampedArray(shape.length * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (shape[i]! <= 0) continue;
      const gx = (h[y * width + Math.min(width - 1, x + 1)]! - h[y * width + Math.max(0, x - 1)]!) / 2;
      const gy = (h[Math.min(height - 1, y + 1) * width + x]! - h[Math.max(0, y - 1) * width + x]!) / 2;
      const n = Math.hypot(gx, gy, 1);
      const nx = -gx / n, ny = -gy / n, nz = 1 / n;
      // The reflected ray looks further along the environment where the surface tilts that way.
      const shift = nz * (nx * dir[0] + ny * dir[1]);
      let v = envAt(t[i]! + 0.6 * shift);
      v += 0.8 * (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2] - LIGHT[2]);
      const tone = tones[Math.round((Math.max(-1, Math.min(1, v)) + 1) * 127.5)]!;
      const spec = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 60);
      const j = i * 4;
      for (let c = 0; c < 3; c++) out[j + c] = tone[c]! + (255 - tone[c]!) * spec;
      out[j + 3] = 255;
    }
  }
  return out;
}

/** Blurs `a` in place with a box of radius `r` across rows, then down columns. */
function boxBlur(a: Float32Array, width: number, height: number, r: number): void {
  const line = new Float32Array(Math.max(width, height));
  const run = (n: number, get: (k: number) => number, put: (k: number, v: number) => void) => {
    for (let k = 0; k < n; k++) line[k] = get(k);
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += line[Math.min(n - 1, Math.max(0, k))]!;
    for (let k = 0; k < n; k++) {
      put(k, sum / (2 * r + 1));
      sum += line[Math.min(n - 1, k + r + 1)]! - line[Math.max(0, k - r)]!;
    }
  };
  for (let y = 0; y < height; y++) run(width, (x) => a[y * width + x]!, (x, v) => (a[y * width + x] = v));
  for (let x = 0; x < width; x++) run(height, (y) => a[y * width + x]!, (y, v) => (a[y * width + x] = v));
}
