import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";

let server: ReturnType<typeof Bun.spawn>;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = Bun.spawn(["bun", "run", "dev", "--host", "127.0.0.1", "--port", "18787", "--strictPort"], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:18787/")).ok) break;
    } catch { await Bun.sleep(100); }
  }
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  await page.goto("http://127.0.0.1:18787/");
});

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

async function draw(text: string, mode: "stretch" | "keep") {
  return page.evaluate(async ({ text, mode }) => {
    const path = "/src/render.ts";
    const { render, DEFAULTS } = await import(path) as typeof import("./render");
    const layersPath = "/src/layers.ts";
    const { makeLayer } = await import(layersPath) as typeof import("./layers");
    const canvas = document.createElement("canvas");
    render(canvas, { ...DEFAULTS, text, mode, layers: [makeLayer("fill")] });
    const png = new Image();
    png.src = canvas.toDataURL("image/png");
    await png.decode();
    const copy = document.createElement("canvas");
    copy.width = copy.height = canvas.width;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(png, 0, 0);
    const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data;
    const original = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let minX = copy.width, maxX = -1, minY = copy.height, maxY = -1, count = 0, equal = true;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) {
        const x = (i / 4) % copy.width, y = Math.floor(i / 4 / copy.width);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++;
      }
      for (let c = 0; c < 4; c++) if (pixels[i + c] !== original[i + c]) equal = false;
    }
    return { minX, maxX, minY, maxY, count, equal };
  }, { text, mode });
}

describe("whitespace rendering", () => {
  for (const mode of ["stretch", "keep"] as const) {
    test(`${mode} preserves edge spaces and their advances`, async () => {
      const plain = await draw("MM", mode);
      const left = await draw(" MM", mode);
      const right = await draw("MM ", mode);
      const wide = await draw("　MM", mode);
      const repeated = await draw("  MM", mode);
      expect(left.minX).toBeGreaterThan(plain.minX);
      const wideRight = await draw("MM　", mode);
      const repeatedRight = await draw("MM  ", mode);
      expect(right.maxX).toBeLessThan(plain.maxX);
      expect(wide.minX).toBeGreaterThan(left.minX);
      expect(repeated.minX).toBeGreaterThan(left.minX);
      expect(wideRight.maxX).toBeLessThan(right.maxX);
      expect(repeatedRight.maxX).toBeLessThan(right.maxX);
      expect([plain, left, right, wide, repeated].every((r) => r.equal)).toBe(true);
    });

    test(`${mode} retains interior spaces and blank rows`, async () => {
      const plain = await draw("MM", mode);
      const middle = await draw("M M", mode);
      const wide = await draw("M　M", mode);
      const repeated = await draw("M  M", mode);
      expect(middle.count).toBeLessThan(plain.count);
      expect(wide.count).toBeLessThan(middle.count);
      expect(repeated.count).toBeLessThan(middle.count);
      const row = await draw("M\nM", mode);
      const blank = await draw("M\n 　\nM", mode);
      expect(blank.count).toBeLessThan(row.count);
      const emptyRow = await draw("M\n\nM", mode);
      expect(emptyRow.count).toBeLessThan(row.count);
      expect((await draw(" \n　", mode)).count).toBe(0);
      expect(blank.equal).toBe(true);
    });
  }
});

test("alignment is saved, restored, and reflected in canvas and PNG with whitespace", async () => {
  await page.evaluate(() => localStorage.setItem("emoji-gen:v3", JSON.stringify({ text: "MMMM\n M　", mode: "keep" })));
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
  const centerTab = page.getByRole("tab", { name: "中央揃え" });
  await expect(centerTab.getAttribute("aria-selected")).resolves.toBe("true");
  const bounds = async () => page.locator(".stage canvas").evaluate((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    const rows = [[], []] as number[][];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3]) rows[y < height / 2 ? 0 : 1]!.push(x);
    }
    return rows.map((xs) => [Math.min(...xs), Math.max(...xs)]);
  });
  const center = await bounds();
  await page.getByRole("tab", { name: "左揃え" }).click();
  const left = await bounds();
  await page.getByRole("tab", { name: "右揃え" }).click();
  const right = await bounds();
  expect(left[0]).toEqual(center[0]);
  expect(right[0]).toEqual(center[0]);
  expect(left[1]![0]!).toBeLessThan(center[1]![0]!);
  expect(right[1]![0]!).toBeGreaterThan(center[1]![0]!);
  await page.reload();
  await expect(page.getByRole("tab", { name: "右揃え" }).getAttribute("aria-selected")).resolves.toBe("true");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("emoji-gen:v3")!).align)).toBe("right");
  await page.waitForFunction(() => document.querySelector<HTMLAnchorElement>("a[download]")?.href.startsWith("blob:"));
  expect(await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(".stage canvas")!;
    const link = document.querySelector<HTMLAnchorElement>("a[download]")!;
    if (!link.href.startsWith("blob:")) return false;
    const image = new Image();
    image.src = link.href;
    await image.decode();
    const copy = document.createElement("canvas");
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const original = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return ctx.getImageData(0, 0, copy.width, copy.height).data.every((v, i) => v === original[i]);
  })).toBe(true);
});
