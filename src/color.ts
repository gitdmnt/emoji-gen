export type Hsl = { h: number; s: number; l: number };

export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export type Hsv = { h: number; s: number; v: number };

export function hexToHsv(hex: string): Hsv {
  const { h, s, l } = hexToHsl(hex);
  const lightness = l / 100;
  const v = lightness + s / 100 * Math.min(lightness, 1 - lightness);
  return { h, s: v === 0 ? 0 : 200 * (1 - lightness / v), v: v * 100 };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const lightness = v / 100 * (1 - s / 200);
  const saturation = lightness === 0 || lightness === 1 ? 0 : (v / 100 - lightness) / Math.min(lightness, 1 - lightness);
  return hslToHex({ h, s: saturation * 100, l: lightness * 100 });
}
