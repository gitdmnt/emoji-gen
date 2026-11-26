//! Japanese web fonts offered in the picker, all served by Google Fonts (see index.html).

export type Font = { id: string; label: string; family: string; weight: number };

export const FONTS: Font[] = [
  { id: "noto-sans", label: "太ゴシック", family: "Noto Sans JP", weight: 900 },
  { id: "mplus-rounded", label: "丸ゴシック", family: "M PLUS Rounded 1c", weight: 900 },
  { id: "noto-serif", label: "明朝", family: "Noto Serif JP", weight: 900 },
  { id: "dela", label: "極太見出し", family: "Dela Gothic One", weight: 400 },
  { id: "mochiy", label: "ポップ", family: "Mochiy Pop One", weight: 400 },
  { id: "rocknroll", label: "ロックンロール", family: "RocknRoll One", weight: 400 },
  { id: "reggae", label: "筆太", family: "Reggae One", weight: 400 },
  { id: "yusei", label: "マジック", family: "Yusei Magic", weight: 400 },
  { id: "hachimaru", label: "丸文字", family: "Hachi Maru Pop", weight: 400 },
  { id: "dot", label: "ドット", family: "DotGothic16", weight: 400 },
  { id: "antique", label: "アンティーク", family: "Zen Antique", weight: 400 },
];

export function fontById(id: string): Font {
  return FONTS.find((f) => f.id === id) ?? FONTS[0]!;
}

/** CSS `font` shorthand for drawing `font` at `px` pixels. */
export function fontSpec(font: Font, px: number): string {
  return `${font.weight} ${px}px "${font.family}", sans-serif`;
}
