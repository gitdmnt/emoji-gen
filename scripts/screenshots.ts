// Drives the app in headless Chromium, saves screenshots of each feature and checks PNG size and packing.
// Usage: bun scripts/screenshots.ts [url] [outDir]   (CHROMIUM_PATH overrides the browser binary)
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";

const url = process.argv[2] ?? "http://localhost:8787/";
const outDir = process.argv[3] ?? "docs/screenshots";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2, acceptDownloads: true });
page.on("pageerror", (e) => console.error("page error:", e.message));

async function settle(p: Page) {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
}

async function tab(name: string) {
  await page.getByRole("tab", { name, exact: true }).first().click();
}

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

async function color(label: string, hex: string, nth = 0) {
  const input = page.locator("label.row", { hasText: label }).nth(nth).locator(".hex");
  await input.fill(hex);
  await input.press("Enter");
}

/** Saves the output stage alone and the whole page. */
async function shot(name: string) {
  await settle(page);
  await page.locator(".stage").screenshot({ path: `${outDir}/${name}.png` });
}

/** Box of the opaque pixels in the output canvas, plus whether the corner pixel is transparent. */
async function canvasInfo() {
  return page.locator(".stage canvas").evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3]! > 8) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
    return { size: width, minX, minY, maxX, maxY, cornerAlpha: data[3] };
  });
}

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
await page.locator("textarea").fill("完全に\n理解した");
await tab("なし");
await tab("透過");
await shot("01-packed");
console.log("packed (no outline):", await canvasInfo());

await page.getByRole("tab", { name: /極太見出し/ }).click();
await shot("11-font-dela");
await page.getByRole("tab", { name: /明朝/ }).click();
await shot("12-font-mincho");
await tab("比率を保つ");
await shot("13-keep-aspect");
await tab("行ごとに引き伸ばし");
await page.getByRole("tab", { name: /太ゴシック/ }).click();

await tab("二重");
await shot("02-outline-double");
console.log("double outline:", await canvasInfo());

await tab("一重");
await shot("03-transparent");
console.log("transparent corner alpha:", (await canvasInfo()).cornerAlpha);

await tab("グラデーション");
await slider("向き", 45);
await tab("全体");
await shot("04-gradient");

await tab("金属");
await tab("金");
await slider("向き", 90);
await tab("行ごと");
await tab("二重");
await color("色", "#3a2200");
await color("色", "#ffffff", 1);
await shot("05-metal-gold");
await tab("銀");
await shot("05-metal-silver");

await tab("一重");
await color("色", "#ffffff");
await tab("虹");
await slider("向き", 0);
await tab("全体");
await shot("06-rainbow");

await slider("回転", -20);
await shot("07-rotation");
await slider("回転", 0);

await tab("塗る");
await color("背景色", "#fff3d6");
await shot("08-background");
await tab("透過");

await tab("金属");
await tab("金");
await tab("行ごと");
await tab("二重");
await color("色", "#3a2200");
await settle(page);
await page.locator("section.tile", { hasText: "Slack Light" }).screenshot({ path: `${outDir}/09-preview-slack-discord.png` });
await page.screenshot({ path: `${outDir}/10-full-page.png`, fullPage: true });

const sizes: Record<string, number> = {};
for (const size of ["128", "256"]) {
  await tab(size);
  await settle(page);
  sizes[size] = await downloadSize();
}
console.log("download bytes (gold, double outline):", sizes);
await tab("256");

// A busy case: five dense lines, rainbow fill, two outlines, a painted background.
await page.locator("textarea").fill("魑魅魍魎\n薔薇鬱蒼\n轟轟轟轟\n曖昧模糊\n驚天動地");
await tab("虹");
await tab("塗る");
await settle(page);
console.log("download bytes (busy 256):", await downloadSize());

await browser.close();
