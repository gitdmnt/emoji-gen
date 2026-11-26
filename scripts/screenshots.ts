// Drives the app in headless Chromium: exercises the layer panel, saves screenshots and checks PNG sizes.
// Usage: bun scripts/screenshots.ts [url] [outDir]   (CHROMIUM_PATH overrides the browser binary)
// The metal comparisons put the current gold and silver presets beside `before/gold.png` and `before/silver.png`
// in outDir, shots of the output stage taken before the metal paint was reworked.
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { chromium, type Locator } from "playwright";

const url = process.argv[2] ?? "http://localhost:8787/";
const outDir = process.argv[3] ?? "docs/screenshots";
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(`${outDir}/${f}`);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, acceptDownloads: true });
page.on("pageerror", (e) => console.error("page error:", e.message));

function check(ok: boolean, what: string) {
  console.log(ok ? "ok  " : "FAIL", what);
  if (!ok) process.exitCode = 1;
}

async function settle() {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

const tile = (title: string) => page.locator("section.tile", { has: page.locator("h2", { hasText: title }) });
const rows = page.locator(".layers li");
const tab = (name: string, scope: Locator | typeof page = page) => scope.getByRole("tab", { name, exact: true }).first().click();
const button = (name: string) => page.locator(".toolbar button", { hasText: name }).first().click();

async function slider(label: string, value: number) {
  await page
    .locator("label.row", { hasText: label })
    .first()
    .locator('input[type="range"]')
    .evaluate((el: HTMLInputElement, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
}

async function color(label: string, hex: string) {
  const input = page.locator("label.row", { hasText: label }).first().locator(".hex");
  await input.fill(hex);
  await input.press("Enter");
}

async function blend(label: string) {
  await page.locator(".props select").selectOption({ label });
}

async function names(): Promise<string> {
  return (await rows.locator(".name").allInnerTexts()).join(",");
}

/** The output stage alone. */
async function stage(name: string) {
  await settle();
  await page.locator(".stage").screenshot({ path: `${outDir}/${name}.png` });
}

/** The layer tile with the sticky preview beside it, so settings and result show together. */
async function panelWithPreview(name: string) {
  const layers = tile("3 layers");
  // A laptop-height window, so the page scrolls far enough for the layer tile to reach the top.
  await page.setViewportSize({ width: 1440, height: 700 });
  await layers.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 10));
  await settle();
  const a = (await layers.boundingBox())!;
  const b = (await tile("5 preview").boundingBox())!;
  const h = Math.max(a.height, b.y + b.height - a.y);
  await page.screenshot({ path: `${outDir}/${name}.png`, clip: { x: a.x - 2, y: a.y - 2, width: b.x + b.width - a.x + 4, height: h + 4 } });
  await page.setViewportSize({ width: 1440, height: 1000 });
}

/** RGBA of the output canvas at (x, y) in 256 space. */
async function pixel(x: number, y: number): Promise<number[]> {
  return page.locator(".stage canvas").evaluate((c: HTMLCanvasElement, [x, y]) => {
    const k = c.width / 256;
    return [...c.getContext("2d")!.getImageData(Math.floor(x! * k), Math.floor(y! * k), 1, 1).data];
  }, [x, y]);
}

/** The whole output canvas as a data URL, to tell whether anything changed. */
const snapshot = () => page.locator(".stage canvas").evaluate((c: HTMLCanvasElement) => c.toDataURL());

async function downloadSize(): Promise<number> {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "PNG を保存" }).click()]);
  const path = `${outDir}/../download-${Date.now()}.png`;
  await download.saveAs(path);
  const size = Bun.file(path).size;
  await Bun.file(path).delete();
  return size;
}

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await settle();
await page.screenshot({ path: `${outDir}/01-full-page.png`, fullPage: true });
await tile("3 layers").screenshot({ path: `${outDir}/02-layer-panel.png` });
await tile("5 preview").screenshot({ path: `${outDir}/03-preview-sizes.png` });
check((await names()) === "縁取り,縁取り,塗り,背景", "default stack shows later layers above earlier layers");
check((await rows.locator(".step").allInnerTexts()).join(",") === "3,2,1,", "step numbers show application order from bottom to top");
const previewSizes = await page.locator(".surface").first().locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).width));
check(JSON.stringify(previewSizes) === "[32,22,16]", `preview shows the emoji alone, in a line and as a reaction ${previewSizes}`);

// List operations on the default stack.
await rows.nth(1).click();
await button("複製");
check((await names()) === "縁取り,縁取り,縁取り,塗り,背景", "duplicate adds a copy above the selected layer");
await button("削除");
check((await names()) === "縁取り,縁取り,塗り,背景", "delete removes the selected layer");
await rows.nth(2).click();
await settle();
const front = await snapshot();
await button("↑");
check((await names()) === "縁取り,塗り,縁取り,背景", "moving the fill up applies it after the first stroke");
await settle();
check((await snapshot()) !== front, "order change shows in the canvas");
await rows.nth(1).dragTo(rows.nth(2));
check((await names()) === "縁取り,縁取り,塗り,背景", "dragging a row moves it to the drop target");
await settle();
check((await snapshot()) === front, "dragging back restores the first picture");
const before = await pixel(40, 60);
await rows.nth(2).locator(".eye").click();
await settle();
check(JSON.stringify(await pixel(40, 60)) !== JSON.stringify(before), "hiding the fill changes the canvas");
await rows.nth(2).locator(".eye").click();

// Order: a white fill and a black outline, applied one way round and then the other.
/** Counts of opaque white and opaque black pixels in the output canvas. */
const whiteBlack = () =>
  page.locator(".stage canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let white = 0, black = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 255) continue;
      if (d[i]! > 245 && d[i + 1]! > 245 && d[i + 2]! > 245) white++;
      if (d[i]! < 10 && d[i + 1]! < 10 && d[i + 2]! < 10) black++;
    }
    return { white, black };
  });
await tab("標準");
await rows.nth(0).click();
await button("削除");
await rows.nth(1).click();
await color("色", "#ffffff");
await rows.nth(0).click();
await color("色", "#000000");
await slider("太さ", 6);
// A sky blue background, so white on white stays visible in the shots.
await rows.last().locator(".eye").click();
await rows.last().click();
await color("色", "#4aa6dc");
await rows.nth(0).click();
await panelWithPreview("04-order-fill-then-stroke");
const fillFirst = await whiteBlack();
const savedStack = await page.evaluate(() => localStorage.getItem("emoji-gen:v3"));
const savedPicture = await snapshot();
await page.reload();
await settle();
check((await page.evaluate(() => localStorage.getItem("emoji-gen:v3"))) === savedStack && (await snapshot()) === savedPicture, "saved settings retain their order and rendered appearance on reload");
check((await names()) === "縁取り,塗り,背景", "saved settings display the later stroke above the fill");
await rows.nth(0).click();
await button("↓");
check((await names()) === "塗り,縁取り,背景", "the stroke now applies first");
await panelWithPreview("05-order-stroke-then-fill");
const strokeFirst = await whiteBlack();
console.log("opaque white and black pixels: fill then stroke", fillFirst, "stroke then fill", strokeFirst);
check(fillFirst.black > 3000 && fillFirst.white > 3000, "fill then stroke: white letters with a black outline");
check(strokeFirst.black === 0, "stroke then fill: no black left");
await rows.last().locator(".eye").click();
await rows.last().click();
await color("色", "#e9f6fd");
check(strokeFirst.white >= fillFirst.white + fillFirst.black, "stroke then fill: the outline area is white too");

// Blending: a sky blue fill applied after the gold fill, first multiplied, then screened.
await page.locator("textarea").fill("完全に\n理解した");
await tab("金");
await rows.nth(2).click();
await button("＋塗り");
await color("色", "#4aa6dc");
await settle();
const flat = await pixel(128, 64);
await blend("乗算");
await settle();
const multiplied = await pixel(128, 64);
await panelWithPreview("06-blend-multiply");
await blend("スクリーン");
await settle();
const screened = await pixel(128, 64);
await panelWithPreview("07-blend-screen");
await blend("オーバーレイ");
await stage("08-blend-overlay");
console.log("pixel at (128, 64): normal", flat, "multiply", multiplied, "screen", screened);
check(multiplied[2]! < 220 && screened[2]! > multiplied[2]!, "multiply darkens and screen lightens");

// Opacity: the same layer back to normal at 40 %.
await blend("通常");
await slider("不透明度", 40);
await panelWithPreview("09-opacity-40");
check((await page.locator('.layers li[aria-selected="true"] .meta').innerText()).includes("40%"), "the row shows the lowered opacity");

for (const name of ["標準", "金", "銀", "虹", "ネオン", "ポップ"]) {
  await tab(name);
  await settle();
  const picture = await snapshot();
  await page.reload();
  await settle();
  check((await snapshot()) === picture && await page.getByRole("tab", { name, exact: true }).first().getAttribute("aria-selected") === "true", `${name} preset retains its appearance and selection on reload`);
}
// Presets.
for (const [name, file] of [["銀", "10-preset-silver"], ["虹", "11-preset-rainbow"], ["ネオン", "12-preset-neon"], ["ポップ", "13-preset-pop"]]) {
  await tab(name!);
  await stage(file!);
}
await tab("金");
await panelWithPreview("14-preset-gold");
check((await names()) === "縁取り,縁取り,塗り,背景", "a preset replaces the whole stack");

// Metal: the gold and silver presets beside the shots taken before the metal paint was reworked.
await page.locator("textarea").fill("最高\nです");
for (const [name, file] of [["金", "gold"], ["銀", "silver"]] as const) {
  await tab(name);
  await settle();
  const after = await page.locator(".stage").screenshot();
  const before = await Bun.file(`${outDir}/before/${file}.png`).bytes();
  const url = (b: Uint8Array) => `data:image/png;base64,${Buffer.from(b).toString("base64")}`;
  const sheet = await browser.newPage({ viewport: { width: 560, height: 300 }, deviceScaleFactor: 2 });
  await sheet.setContent(
    `<body style="margin:0;display:flex;gap:8px;padding:8px;background:#fff;font:12px ui-monospace,monospace">` +
      `<figure style="margin:0"><img src="${url(before)}" width="268"><figcaption>before</figcaption></figure>` +
      `<figure style="margin:0"><img src="${url(after)}" width="268"><figcaption>after</figcaption></figure></body>`,
  );
  await sheet.locator("body").screenshot({ path: `${outDir}/${file === "gold" ? 15 : 16}-metal-${file}-compare.png` });
  await sheet.close();
}
await page.locator("textarea").fill("完全に\n理解した");
await tab("金");

// Existing features: fonts, aspect, rotation, background.
await page.getByRole("tab", { name: /極太見出し/ }).click();
await stage("17-font-dela");
await page.getByRole("tab", { name: /太ゴシック/ }).click();
await tab("比率を保つ");
await stage("18-keep-aspect");
await tab("行ごとに引き伸ばし");
await slider("回転", -20);
await stage("19-rotation");
check((await pixel(1, 1))[3] === 0, "transparent corner without background");
await slider("回転", 0);
await rows.last().locator(".eye").click();
await rows.last().click();
await color("色", "#fff3d6");
await stage("20-background");
check((await pixel(1, 1))[3] === 255, "background fills the corner");
await rows.last().locator(".eye").click();

// PNG sizes of representative stacks.
const sizes: Record<string, number> = {};
await page.locator("textarea").fill("最高\nです");
for (const preset of ["標準", "金", "銀", "ネオン"]) {
  await tab(preset);
  for (const size of ["128px", "256px"]) {
    await tab(size);
    await settle();
    sizes[`${preset} ${size}`] = await downloadSize();
  }
}
await page.locator("textarea").fill("魑魅魍魎\n薔薇鬱蒼\n轟轟轟轟\n曖昧模糊\n驚天動地");
await tab("虹");
await rows.last().locator(".eye").click();
await settle();
sizes["busy rainbow with background 256px"] = await downloadSize();
await tab("金");
await tab("128px");
await settle();
sizes["busy gold with background 128px"] = await downloadSize();
console.log("download bytes:", sizes);
check(Object.values(sizes).every((n) => n <= 128 * 1024), "every PNG is at most 128 KB");

await browser.close();
