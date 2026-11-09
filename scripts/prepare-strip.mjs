import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(root, 'site/assets/strip.webp');
const MAX_BYTES = 200_000;

export async function prepareStrip(input, { rotate = 0, crop, tone = 'bw', out = DEFAULT_OUT } = {}) {
  let img = sharp(input);
  if (rotate) img = img.rotate(rotate, { background: '#ffffff' });
  if (crop) {
    const [left, top, width, height] = crop.split(',').map(Number);
    // rotate must be applied before extract: flush the rotated pixels first
    img = sharp(await img.png().toBuffer()).extract({ left, top, width, height });
  }
  if (tone === 'bw') img = img.greyscale().linear(1.1, -8);
  else if (tone === 'warm') img = img.greyscale().tint({ r: 112, g: 92, b: 60 });
  img = img.resize({ height: 1600 });
  const pipeline = await img.png().toBuffer();

  let buf;
  for (let quality = 82; ; quality -= 6) {
    buf = await sharp(pipeline).webp({ quality }).toBuffer();
    if (buf.length <= MAX_BYTES || quality - 6 < 60) break;
  }
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, buf);
  const { width, height } = await sharp(buf).metadata();
  return { width, height, bytes: buf.length };
}

async function placeholderPng() {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 440, height: 1600 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(join(root, 'scripts/placeholder-strip.html')).href);
    return await page.screenshot({ type: 'png' });
  } finally {
    await browser.close();
  }
}

async function cli(argv) {
  const opts = {};
  let photo;
  let placeholder = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--placeholder') placeholder = true;
    else if (a === '--rotate') opts.rotate = Number(argv[++i]);
    else if (a === '--crop') opts.crop = argv[++i];
    else if (a === '--tone') opts.tone = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else photo = a;
  }
  if (!placeholder && !photo) {
    console.error('usage: prepare-strip.mjs <photo> [--rotate <deg>] [--crop <x,y,w,h>] [--tone bw|warm] [--out <path>] | --placeholder');
    process.exit(1);
  }
  const res = placeholder
    ? await prepareStrip(await placeholderPng(), { ...opts, tone: 'none' })
    : await prepareStrip(photo, opts);
  console.log(res);
  console.log(`Wrote ${res.width}x${res.height}. Update <img width="${res.width}" height="${res.height}"> for both assets/strip.webp images in site/index.html (npm test checks this).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await cli(process.argv.slice(2));
}
