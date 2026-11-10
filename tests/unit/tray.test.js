import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PANEL, OPENING } from '../../scripts/tray/geometry.mjs';

const root = new URL('../../', import.meta.url).pathname;
const siteDir = join(root, 'site');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

test('tray.webp is 528×1209 webp with alpha', async () => {
  const file = join(siteDir, 'assets/tray.webp');
  const { format, width, height, hasAlpha } = await sharp(file).metadata();
  assert.equal(format, 'webp');
  assert.equal(width, 528);
  assert.equal(height, 1209);
  assert.equal(hasAlpha, true);
  assert.ok(statSync(file).size <= 60_000, `tray.webp is ${statSync(file).size} bytes`);
});

test('geometry derives the back panel from the walls', () => {
  assert.deepEqual(PANEL, { left: 28, right: 148, top: 22, bottom: 365 });
  assert.deepEqual(OPENING, { left: 12, right: 164, top: 12, bottom: 391 });
});

test('render-tray pins the HDRI', async () => {
  const t0 = Date.now();
  const { HDRI_URL, HDRI_SHA256 } = await import('../../scripts/render-tray.mjs');
  assert.equal(HDRI_URL, 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr');
  assert.equal(HDRI_SHA256, 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45');
  assert.ok(Date.now() - t0 < 2000, 'import must not render');
});

test('three is exact-pinned', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.devDependencies.three, '0.170.0');
});

test('the HDRI is not shipped', () => {
  for (const f of walk(siteDir)) assert.ok(!/\.(hdr|exr)$/i.test(f), f);
});
