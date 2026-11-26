import { describe, expect, test } from "bun:test";
import { alphaBounds, distanceTransform, layoutLines, rotationFit, sharedLineBounds } from "./layout";

function rgba(width: number, height: number, opaque: [number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = 255;
  return data;
}

describe("alphaBounds", () => {
  test("finds the tight box of opaque pixels", () => {
    const data = rgba(10, 8, [[2, 3], [7, 5], [4, 1]]);
    expect(alphaBounds(data, 10, 8)).toEqual({ x: 2, y: 1, w: 6, h: 5 });
  });

  test("ignores faint pixels at or below the threshold", () => {
    const data = rgba(4, 4, [[1, 1]]);
    data[(3 * 4 + 3) * 4 + 3] = 8;
    expect(alphaBounds(data, 4, 4)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  test("returns null for an empty image", () => {
    expect(alphaBounds(rgba(3, 3, []), 3, 3)).toBeNull();
  });
});

describe("sharedLineBounds", () => {
  test("keeps short glyphs at their original baseline position in every row", () => {
    const boxes = [
      { x: 10, y: 100, w: 200, h: 200 },
      { x: 20, y: 190, w: 180, h: 20 },
      { x: 15, y: 110, w: 190, h: 210 },
    ];
    const shared = sharedLineBounds(boxes);
    expect(shared).toEqual([
      { x: 10, y: 100, w: 200, h: 220 },
      { x: 20, y: 100, w: 180, h: 220 },
      { x: 15, y: 100, w: 190, h: 220 },
    ]);
    for (const mode of ["stretch", "keep"] as const) {
      const rows = layoutLines(shared, 300, mode);
      expect(rows[1]!.y - rows[0]!.y).toBeCloseTo(rows[2]!.y - rows[1]!.y);
      expect((boxes[1]!.y - shared[1]!.y) / shared[1]!.h).toBeCloseTo(90 / 220);
    }
  });

  test("leaves a single line unchanged and handles no lines", () => {
    const box = { x: 1, y: 2, w: 3, h: 4 };
    expect(sharedLineBounds([box])).toEqual([box]);
    expect(sharedLineBounds([])).toEqual([]);
  });
});

describe("layoutLines", () => {
  const boxes = [
    { x: 5, y: 9, w: 400, h: 100 },
    { x: 0, y: 0, w: 200, h: 120 },
  ];

  test("stretch gives each line a full-width row of equal height", () => {
    expect(layoutLines(boxes, 256, "stretch")).toEqual([
      { x: 0, y: 0, w: 256, h: 128 },
      { x: 0, y: 128, w: 256, h: 128 },
    ]);
  });

  test("stretch rows tile the square exactly with inset and gap", () => {
    const rects = layoutLines(boxes, 128, "stretch", 4, 6);
    expect(rects[0]).toEqual({ x: 4, y: 4, w: 120, h: 57 });
    expect(rects[1]).toEqual({ x: 4, y: 67, w: 120, h: 57 });
    expect(rects[1]!.y + rects[1]!.h).toBe(124);
  });

  test("keep scales every line by one factor and centres the block", () => {
    const rects = layoutLines(boxes, 256, "keep");
    // Width limits: 256 / 400 = 0.64; height would allow 256 / 220.
    expect(rects[0]!.w).toBeCloseTo(256);
    expect(rects[0]!.h).toBeCloseTo(64);
    expect(rects[1]!.w).toBeCloseTo(128);
    expect(rects[1]!.h).toBeCloseTo(76.8);
    expect(rects[1]!.x).toBeCloseTo(64);
    const top = rects[0]!.y, bottom = rects[1]!.y + rects[1]!.h;
    expect(top).toBeCloseTo(256 - bottom);
    expect(rects[1]!.y).toBeCloseTo(rects[0]!.y + rects[0]!.h);
  });

  test("keep is height-limited for many short lines", () => {
    const rects = layoutLines([{ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }], 100, "keep");
    expect(rects.map((r) => r.h)).toEqual([50, 50]);
    expect(rects[0]!.x).toBeCloseTo(25);
  });

  test("no lines gives no rects", () => {
    expect(layoutLines([], 256, "stretch")).toEqual([]);
  });
});

describe("rotationFit", () => {
  test("is 1 for right angles and 1/sqrt(2) at 45 degrees", () => {
    expect(rotationFit(0)).toBeCloseTo(1);
    expect(rotationFit(90)).toBeCloseTo(1);
    expect(rotationFit(45)).toBeCloseTo(Math.SQRT1_2);
  });
});

describe("distanceTransform", () => {
  test("measures Euclidean distance to the nearest inside pixel", () => {
    const w = 7, h = 5;
    const inside = new Uint8Array(w * h);
    inside[2 * w + 1] = 1;
    const d = distanceTransform(inside, w, h);
    expect(d[2 * w + 1]).toBe(0);
    expect(d[2 * w + 4]).toBeCloseTo(3);
    expect(d[0]).toBeCloseTo(Math.hypot(1, 2));
    expect(d[4 * w + 6]).toBeCloseTo(Math.hypot(5, 2));
  });

  test("takes the nearest of several inside pixels", () => {
    const inside = new Uint8Array(9);
    inside[0] = 1;
    inside[8] = 1;
    const d = distanceTransform(inside, 9, 1);
    expect(Array.from(d)).toEqual([0, 1, 2, 3, 4, 3, 2, 1, 0]);
  });
});
