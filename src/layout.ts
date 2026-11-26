//! Pure geometry for packing lines into the square: glyph bounds, target rects, distance transform.

export type Box = { x: number; y: number; w: number; h: number };

/** How lines fill the square: `stretch` gives every line a full-width row of equal height, `keep` scales all lines by one factor. */
export type FitMode = "stretch" | "keep";

/** Tight box of the pixels whose alpha exceeds `threshold` in RGBA `data`, or null when none do. */
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 8): Box | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3]! > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Target rects in a `size` square for lines whose glyph boxes are `boxes`, leaving `inset` on every side
 * (room for outlines) and `gap` between lines.
 */
export function layoutLines(boxes: Box[], size: number, mode: FitMode, inset = 0, gap = 0): Box[] {
  const n = boxes.length;
  if (n === 0) return [];
  const inner = size - 2 * inset;
  const free = inner - gap * (n - 1);
  if (mode === "stretch") {
    const h = free / n;
    return boxes.map((_, i) => ({ x: inset, y: inset + i * (h + gap), w: inner, h }));
  }
  const maxW = Math.max(...boxes.map((b) => b.w));
  const sumH = boxes.reduce((s, b) => s + b.h, 0);
  const scale = Math.min(inner / maxW, free / sumH);
  let y = inset + (inner - (scale * sumH + gap * (n - 1))) / 2;
  return boxes.map((b) => {
    const w = b.w * scale, h = b.h * scale;
    const rect = { x: inset + (inner - w) / 2, y, w, h };
    y += h + gap;
    return rect;
  });
}

/** Scale that keeps a square rotated by `deg` degrees inside the unrotated square. */
export function rotationFit(deg: number): number {
  const r = (deg * Math.PI) / 180;
  return 1 / (Math.abs(Math.cos(r)) + Math.abs(Math.sin(r)));
}

const FAR = 1e20;

/** 1D squared distance transform (Felzenszwalb and Huttenlocher) of `f` into `d`. */
function edt1d(f: Float64Array, d: Float64Array, n: number, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -FAR;
  z[1] = FAR;
  for (let q = 1; q < n; q++) {
    let s = 0;
    do {
      const p = v[k]!;
      s = (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
    } while (s <= z[k]! && --k >= 0);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = FAR;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    d[q] = (q - p) * (q - p) + f[p]!;
  }
}

/** Euclidean distance from every pixel to the nearest pixel where `inside` is nonzero (about 1e10 when there is none). */
export function distanceTransform(inside: Uint8Array, width: number, height: number): Float32Array {
  const n = Math.max(width, height);
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = inside[i] ? 0 : FAR;
  const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    edt1d(f, d, height, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!;
  }
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]!;
    edt1d(f, d, width, v, z);
    for (let x = 0; x < width; x++) out[y * width + x] = Math.sqrt(d[x]!);
  }
  return out;
}

/**
 * Signed distance from each pixel centre to the edge of the glyphs whose alpha (0 to 1) is at least one half:
 * negative inside, positive outside, about plus or minus half a pixel next to the edge.
 */
export function signedDistance(alpha: Float32Array, width: number, height: number): Float32Array {
  const inside = new Uint8Array(alpha.length);
  const outside = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i++) {
    inside[i] = alpha[i]! >= 0.5 ? 1 : 0;
    outside[i] = 1 - inside[i]!;
  }
  const dOut = distanceTransform(inside, width, height);
  const dIn = distanceTransform(outside, width, height);
  const sd = new Float32Array(alpha.length);
  for (let i = 0; i < sd.length; i++) sd[i] = inside[i] ? 0.5 - dIn[i]! : dOut[i]! - 0.5;
  return sd;
}
