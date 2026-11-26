import { describe, expect, test } from "bun:test";
import {
  band,
  BLEND_FNS,
  BLENDS,
  compositeLayer,
  drawOrder,
  layerReach,
  layerShape,
  makeLayer,
  PRESETS,
  sameLayers,
  toBytes,
  type Blend,
  type Layer,
} from "./layers";
import { signedDistance } from "./layout";

/** One pixel of solid paint. */
const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);
const full = new Float32Array([1]);

/** Composites `layers` (front first, each with its own one-pixel paint) and returns the RGBA bytes. */
function stack(layers: [Layer, Uint8ClampedArray][]): number[] {
  const acc = new Float32Array(4);
  const paints = new Map(layers.map(([l, p]) => [l, p]));
  for (const l of drawOrder(layers.map(([l]) => l))) compositeLayer(acc, paints.get(l)!, full, l.opacity / 100, l.blend);
  return [...toBytes(acc)];
}

const fill = (over: Partial<Layer> = {}) => makeLayer("fill", over);

describe("drawOrder", () => {
  test("draws the back of the list first and skips hidden or fully transparent layers", () => {
    const a = fill({ id: 1 }), b = fill({ id: 2, visible: false }), c = fill({ id: 3 }), d = fill({ id: 4, opacity: 0 });
    expect(drawOrder([a, b, c, d]).map((l) => l.id)).toEqual([3, 1]);
  });

  test("the front layer covers the ones behind it", () => {
    expect(stack([[fill(), px(255, 0, 0)], [fill(), px(0, 0, 255)]])).toEqual([255, 0, 0, 255]);
    expect(stack([[fill({ visible: false }), px(255, 0, 0)], [fill(), px(0, 0, 255)]])).toEqual([0, 0, 255, 255]);
  });
});

describe("compositeLayer", () => {
  const grey = px(128, 128, 128);
  const orange = px(255, 160, 32);
  const over = (blend: Blend, opacity = 100) => stack([[fill({ blend, opacity }), grey], [fill(), orange]]);

  test("opacity mixes with what is behind", () => {
    expect(stack([[fill({ opacity: 50 }), px(100, 100, 100)], [fill(), px(200, 0, 50)]])).toEqual([150, 50, 75, 255]);
  });

  test("multiply darkens and screen lightens the backdrop", () => {
    expect(over("multiply")).toEqual([128, 80, 16, 255]);
    expect(over("screen")).toEqual([255, 208, 144, 255]);
  });

  test("darken and lighten pick per channel", () => {
    expect(over("darken")).toEqual([128, 128, 32, 255]);
    expect(over("lighten")).toEqual([255, 160, 128, 255]);
  });

  test("a blend over empty pixels shows the layer unchanged", () => {
    expect(stack([[fill({ blend: "multiply" }), grey]])).toEqual([128, 128, 128, 255]);
  });

  test("a half transparent backdrop is blended in proportion", () => {
    const acc = new Float32Array(4);
    compositeLayer(acc, px(0, 0, 0), full, 0.5, "normal");
    compositeLayer(acc, px(255, 255, 255), full, 1, "multiply");
    // Half of the result is the plain white source (no backdrop there), half is white times black.
    expect([...toBytes(acc)]).toEqual([128, 128, 128, 255]);
  });

  test("every listed blend mode has a function that keeps values in range", () => {
    for (const [blend] of BLENDS) {
      for (const cb of [0, 0.2, 0.5, 0.9, 1])
        for (const cs of [0, 0.3, 0.5, 0.7, 1]) {
          const v = BLEND_FNS[blend](cb, cs);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
    }
  });
});

describe("layer shapes", () => {
  // A 9 x 1 strip with the glyph in the middle three pixels.
  const mask = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 0]);
  const sd = signedDistance(mask, 9, 1);

  test("signed distance is negative inside and positive outside", () => {
    expect([...sd]).toEqual([2.5, 1.5, 0.5, -0.5, -1.5, -0.5, 0.5, 1.5, 2.5]);
  });

  test("an outside stroke covers its width beyond the edge and one pixel under it", () => {
    const s = layerShape(makeLayer("stroke", { width: 2 }), mask, sd, 1);
    expect([...s]).toEqual([0, 1, 1, 1, 0, 1, 1, 1, 0]);
  });

  test("an inside stroke stays within the glyph", () => {
    const s = layerShape(makeLayer("stroke", { width: 1, position: "inside" }), mask, sd, 1);
    expect([...s]).toEqual([0, 0, 0, 1, 0, 1, 0, 0, 0]);
  });

  test("a centred stroke straddles the edge", () => {
    expect([...band(sd, -1, 1)]).toEqual([0, 0, 1, 1, 0, 1, 1, 0, 0]);
  });

  test("a fill is the glyph mask itself", () => {
    expect(layerShape(makeLayer("fill"), mask, sd, 1)).toBe(mask);
  });

  test("stroke widths scale with the canvas", () => {
    const s = layerShape(makeLayer("stroke", { width: 4 }), mask, sd, 0.5);
    expect([...s]).toEqual([0, 1, 1, 1, 0, 1, 1, 1, 0]);
  });
});

describe("reach and presets", () => {
  test("only outward parts of visible layers need room", () => {
    expect(layerReach(makeLayer("stroke", { width: 8 }))).toBe(8);
    expect(layerReach(makeLayer("stroke", { width: 8, position: "center" }))).toBe(4);
    expect(layerReach(makeLayer("stroke", { width: 8, position: "inside" }))).toBe(0);
    expect(layerReach(makeLayer("stroke", { width: 8, visible: false }))).toBe(0);
    expect(layerReach(makeLayer("shadow", { width: 2, dx: 3, dy: -5, blur: 4 }))).toBe(11);
  });

  test("presets have unique ids and compare equal regardless of ids", () => {
    for (const p of PRESETS) expect(new Set(p.layers.map((l) => l.id)).size).toBe(p.layers.length);
    const a = PRESETS[1]!.layers;
    expect(sameLayers(a, a.map((l, i) => ({ ...l, id: 100 + i })))).toBe(true);
    expect(sameLayers(a, PRESETS[2]!.layers)).toBe(false);
  });
});
