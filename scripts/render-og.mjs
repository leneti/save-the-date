import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'site/assets/og-image.jpg');

export async function renderOg(out = OUT) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(root, 'scripts/og.html')).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
      const img = document.querySelector('img');
      if (!img.complete) await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    });
    const png = await page.screenshot({ type: 'png' });
    const jpg = await sharp(png).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
    await writeFile(out, jpg);
    const { width, height } = await sharp(jpg).metadata();
    return { width, height, bytes: jpg.length };
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await renderOg());
}
