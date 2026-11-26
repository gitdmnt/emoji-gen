import { describe, expect, test } from "bun:test";
import { hexToHsl, hslToHex } from "./color";

describe("HSL colors", () => {
  test("converts primary colors and grayscale", () => {
    expect(hslToHex({ h: 0, s: 100, l: 50 })).toBe("#ff0000");
    expect(hslToHex({ h: 120, s: 100, l: 50 })).toBe("#00ff00");
    expect(hslToHex({ h: 240, s: 100, l: 50 })).toBe("#0000ff");
    expect(hslToHex({ h: 30, s: 0, l: 0 })).toBe("#000000");
    expect(hslToHex({ h: 30, s: 0, l: 100 })).toBe("#ffffff");
  });

  test("round trips colors without losing precision", () => {
    for (const hex of ["#000000", "#ffffff", "#808080", "#ff9f1c", "#123456", "#ff00ff"]) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
    }
  });
});
