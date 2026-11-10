// Dev helper (not shipped): prints the mean colour of small regions of the rendered tray's brass frame,
// to keep the CSS brass tokens in step with site/assets/tray.webp.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const tray = join(dirname(fileURLToPath(import.meta.url)), '../site/assets/tray.webp');
const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

async function mean(img, left, top) {
  // stats() ignores a preceding extract(), so materialise the 3x3 crop first.
  const crop = await img.clone().extract({ left, top, width: 3, height: 3 }).removeAlpha().png().toBuffer();
  const { channels } = await sharp(crop).stats();
  return { r: channels[0].mean, g: channels[1].mean, b: channels[2].mean };
}

const img = sharp(tray);
const regions = [
  ['top rim highlight (90, 4)', 90, 4],
  ['left rim mid (6, 600)', 6, 600],
  ['right rim (522, 600)', 522, 600],
  ['bottom rim (264, 1204)', 264, 1204],
];
for (const [name, x, y] of regions) console.log(name.padEnd(30), hex(await mean(img, x, y)));

// Frame glint: the brightest 3x3 in the top rim row band (y 0-36).
const { width } = await img.metadata();
const band = await img.clone().extract({ left: 0, top: 0, width, height: 36 }).removeAlpha().raw().toBuffer();
let best = { lum: -1, x: 0, y: 0 };
for (let y = 0; y <= 33; y++) {
  for (let x = 0; x <= width - 3; x++) {
    let lum = 0;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
      const i = ((y + dy) * width + x + dx) * 3;
      lum += 0.2126 * band[i] + 0.7152 * band[i + 1] + 0.0722 * band[i + 2];
    }
    if (lum > best.lum) best = { lum, x, y };
  }
}
console.log(`frame glint (${best.x}, ${best.y})`.padEnd(30), hex(await mean(img, best.x, best.y)));
