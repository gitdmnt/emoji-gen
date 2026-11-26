import { describe, expect, test } from "bun:test";
import { metalPixels, metalTone } from "./metal";

const GOLD = "#e0a526";

/** Hue in degrees and lightness (0 to 1) of an RGB triple. */
function hueLight([r, g, b]: [number, number, number]): [number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  const h = d === 0 ? 0 : max === r ? (((g - b) / d + 6) % 6) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return [h, (max + min) / 510];
}

describe("metal tones", () => {
  test("gold turns yellow and light in the highlights, orange brown and dark in the shadows", () => {
    const [hHi, lHi] = hueLight(metalTone(GOLD, 0.9));
    const [hMid] = hueLight(metalTone(GOLD, 0));
    const [hLo, lLo] = hueLight(metalTone(GOLD, -0.8));
    expect(hHi).toBeGreaterThan(hMid + 4);
    expect(hLo).toBeLessThan(hMid - 8);
    expect(lHi).toBeGreaterThan(0.85);
    expect(lLo).toBeLessThan(0.2);
  });
});

describe("metal pixels", () => {
  // A 64 x 64 square inset by 8 pixels, with the gradient running top to bottom over the canvas.
  const size = 64;
  const shape = new Float32Array(size * size);
  const t = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      shape[y * size + x] = x >= 8 && x < 56 && y >= 8 && y < 56 ? 1 : 0;
      t[y * size + x] = (y + 0.5) / size;
    }
  const px = metalPixels(GOLD, shape, t, [0, 1], size, size, 1);
  const light = (x: number, y: number) => hueLight([...px.slice((y * size + x) * 4, (y * size + x) * 4 + 3)] as [number, number, number])[1];

  test("the flat face has a hard horizon: bright just above the middle, dark just below", () => {
    const above = light(32, 31), below = light(32, 34);
    expect(above - below).toBeGreaterThan(0.5);
  });

  test("the bevel catches the light on the top left and falls into shadow on the bottom right", () => {
    expect(light(32, 9)).toBeGreaterThan(light(32, 54));
    expect(light(9, 20)).toBeGreaterThan(light(54, 20));
  });

  test("nothing is painted outside the shape", () => {
    expect(px[3]).toBe(0);
    expect(px[(32 * size + 32) * 4 + 3]).toBe(255);
  });
});
