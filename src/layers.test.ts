import { describe, expect, test } from "bun:test";
import {
  applyLayers,
  band,
  BLEND_FNS,
  BLENDS,
  compositeLayer,
  makeLayer,
  PRESETS,
  sameLayers,
  stackReach,
  toBytes,
  type Blend,
  type Layer,
  type Painter,
} from "./layers";
import { signedDistance } from "./layout";

/** One pixel of solid paint. */
const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);

/** A painter for `n` pixels that paints every layer in its own solid colour and leaves shadows unmoved. */
function solidPainter(n: number, colours: Map<Layer, Uint8ClampedArray>): Painter {
  return {
    paint: (l) => {
      const out = new Uint8ClampedArray(n * 4);
      for (let i = 0; i < n; i++) out.set(colours.get(l)!, i * 4);
      return out;
    },
    shadow: (shape) => shape,
  };
}

/** Applies `layers` (each with its own paint) to a single fully covered pixel and returns the RGBA bytes. */
function stack(layers: [Layer, Uint8ClampedArray][]): number[] {
  const acc = applyLayers(layers.map(([l]) => l), new Float32Array([1]), 1, 1, 1, solidPainter(1, new Map(layers)));
  return [...toBytes(acc)];
}

const fill = (over: Partial<Layer> = {}) => makeLayer("fill", over);

describe("applyLayers order", () => {
  test("a later fill covers an earlier one; hidden layers are skipped", () => {
    expect(stack([[fill(), px(255, 0, 0)], [fill(), px(0, 0, 255)]])).toEqual([0, 0, 255, 255]);
    expect(stack([[fill(), px(255, 0, 0)], [fill({ visible: false }), px(0, 0, 255)]])).toEqual([255, 0, 0, 255]);
  });
});

describe("compositeLayer", () => {
  const grey = px(128, 128, 128);
  const orange = px(255, 160, 32);
  const over = (blend: Blend, opacity = 100) => stack([[fill(), orange], [fill({ blend, opacity }), grey]]);

  test("opacity mixes with what is behind", () => {
    expect(stack([[fill(), px(200, 0, 50)], [fill({ opacity: 50 }), px(100, 100, 100)]])).toEqual([150, 50, 75, 255]);
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
    compositeLayer(acc, px(0, 0, 0), new Float32Array([1]), 0.5, "normal");
    compositeLayer(acc, px(255, 255, 255), new Float32Array([1]), 1, "multiply");
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

describe("applyLayers shapes", () => {
  // A 9 x 1 strip with the glyph in the middle three pixels.
  const glyph = new Float32Array([0, 0, 0, 1, 1, 1, 0, 0, 0]);
  const white = px(255, 255, 255), black = px(0, 0, 0);

  /** RGBA of each pixel of the strip, as "w" (white), "k" (black), "." (empty) or the raw bytes. */
  function strip(layers: [Layer, Uint8ClampedArray][], mask = glyph, painter?: Partial<Painter>): string[] {
    const acc = applyLayers(layers.map(([l]) => l), mask, mask.length, 1, 1, {
      ...solidPainter(mask.length, new Map(layers)),
      ...painter,
    });
    const bytes = toBytes(acc);
    return Array.from({ length: mask.length }, (_, i) => {
      const [r, g, b, a] = bytes.slice(i * 4, i * 4 + 4);
      if (a === 0) return ".";
      if (a === 255 && r === 255 && g === 255 && b === 255) return "w";
      if (a === 255 && r === 0 && g === 0 && b === 0) return "k";
      return `${r},${g},${b},${a}`;
    });
  }

  test("signed distance is negative inside and positive outside", () => {
    expect([...signedDistance(glyph, 9, 1)]).toEqual([2.5, 1.5, 0.5, -0.5, -1.5, -0.5, 0.5, 1.5, 2.5]);
  });

  test("a white fill and then a black outside stroke give white letters with a black outline", () => {
    const layers: [Layer, Uint8ClampedArray][] = [[fill(), white], [makeLayer("stroke", { width: 2 }), black]];
    expect(strip(layers).join("")).toBe(".kkwwwkk.");
  });

  test("a black outside stroke and then a white fill paint the outline white too", () => {
    const layers: [Layer, Uint8ClampedArray][] = [[makeLayer("stroke", { width: 2 }), black], [fill(), white]];
    expect(strip(layers).join("")).toBe(".wwwwwww.");
  });

  test("outside strokes stack outward", () => {
    const blue = px(0, 0, 255);
    const layers: [Layer, Uint8ClampedArray][] = [
      [fill(), white],
      [makeLayer("stroke", { width: 1 }), black],
      [makeLayer("stroke", { width: 1 }), blue],
    ];
    expect(strip(layers)).toEqual([".", "0,0,255,255", "k", "w", "w", "w", "k", "0,0,255,255", "."]);
  });

  test("an inside stroke stays within the shape and does not grow it", () => {
    const layers: [Layer, Uint8ClampedArray][] = [
      [fill(), white],
      [makeLayer("stroke", { width: 1, position: "inside" }), black],
      [makeLayer("stroke", { width: 1 }), px(0, 0, 255)],
    ];
    const blue = "0,0,255,255";
    expect(strip(layers)).toEqual([".", ".", blue, "k", "w", "k", blue, ".", "."]);
  });

  test("a centred stroke straddles the edge and grows the shape by half its width", () => {
    expect([...band(signedDistance(glyph, 9, 1), -1, 1)]).toEqual([0, 0, 1, 1, 0, 1, 1, 0, 0]);
    const layers: [Layer, Uint8ClampedArray][] = [[fill(), white], [makeLayer("stroke", { width: 2, position: "center" }), black], [fill(), white]];
    expect(strip(layers).join("")).toBe("..wwwww..");
  });

  test("an anti-aliased edge leaves no gap between a fill and the outline added after it", () => {
    const soft = new Float32Array([0, 0, 0.5, 1, 1, 1, 0.5, 0, 0]);
    const out = strip([[fill(), white], [makeLayer("stroke", { width: 2 }), black]], soft);
    expect(out[2]).toBe("128,128,128,255");
  });

  test("an outside stroke does not show through a translucent fill", () => {
    const out = strip([[fill({ opacity: 50 }), white], [makeLayer("stroke", { width: 1 }), black]]);
    expect(out.join(" ")).toBe(". . k 255,255,255,128 255,255,255,128 255,255,255,128 k . .");
  });

  test("a shadow is cast from the shape so far, stays behind it and is not painted by later fills", () => {
    const grey = px(128, 128, 128);
    // Shadows move one pixel to the right.
    const shift = { shadow: (shape: Float32Array) => new Float32Array([0, ...shape.slice(0, -1)]) };
    const layers: [Layer, Uint8ClampedArray][] = [
      [makeLayer("stroke", { width: 1 }), black],
      [makeLayer("shadow", { width: 0 }), grey],
      [fill(), white],
    ];
    expect(strip(layers, glyph, shift)).toEqual([".", ".", "w", "w", "w", "w", "w", "128,128,128,255", "."]);
  });
});

describe("reach and presets", () => {
  test("outside strokes add up and shadows reach from the shape they are cast from", () => {
    const stroke = (over: Partial<Layer>) => makeLayer("stroke", over);
    expect(stackReach([stroke({ width: 8 })])).toBe(8);
    expect(stackReach([stroke({ width: 8, position: "center" })])).toBe(4);
    expect(stackReach([stroke({ width: 8, position: "inside" })])).toBe(0);
    expect(stackReach([stroke({ width: 8, visible: false })])).toBe(0);
    expect(stackReach([stroke({ width: 3 }), stroke({ width: 4 })])).toBe(7);
    expect(stackReach([stroke({ width: 3 }), makeLayer("shadow", { width: 2, dx: 3, dy: -5, blur: 4 })])).toBe(14);
    expect(stackReach([makeLayer("shadow", { width: 2, dx: 3, dy: -5, blur: 4 }), stroke({ width: 3 })])).toBe(11);
  });

  test("the default preset is a single solid fill before standard", () => {
    expect(PRESETS[0]!.name).toBe("単色");
    expect(PRESETS[1]!.name).toBe("標準");
    expect(PRESETS[0]!.layers).toHaveLength(1);
    expect(PRESETS[0]!.layers[0]!.type).toBe("fill");
    expect(PRESETS[0]!.layers[0]!.paint.kind).toBe("solid");
  });

  test("presets reach as far as they did when every stroke was measured from the glyphs", () => {
    expect(PRESETS.map((p) => [p.name, stackReach(p.layers)])).toEqual([
      ["単色", 0],
      ["標準", 12],
      ["金", 10],
      ["銀", 10],
      ["虹", 11],
      ["ネオン", 20],
      ["ポップ", 13],
    ]);
  });

  test("presets have unique ids and compare equal regardless of ids", () => {
    for (const p of PRESETS) expect(new Set(p.layers.map((l) => l.id)).size).toBe(p.layers.length);
    const a = PRESETS[1]!.layers;
    expect(sameLayers(a, a.map((l, i) => ({ ...l, id: 100 + i })))).toBe(true);
    expect(sameLayers(a, PRESETS[2]!.layers)).toBe(false);
  });
});
