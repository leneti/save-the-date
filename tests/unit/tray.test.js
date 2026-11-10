import test from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { PANEL, OPENING } from '../../scripts/tray/geometry.mjs';

const siteDir = new URL('../../site/', import.meta.url).pathname;

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

test('render-tray takes its geometry from geometry.mjs, and importing it does not render', async () => {
  const t0 = Date.now();
  const { CFG } = await import('../../scripts/render-tray.mjs');
  assert.ok(Date.now() - t0 < 2000, 'import must not render');
  assert.deepEqual(CFG.opening, { l: OPENING.left, t: OPENING.top, r: OPENING.right, b: OPENING.bottom });
  assert.deepEqual(CFG.back, { l: PANEL.left, t: PANEL.top, r: PANEL.right, b: PANEL.bottom });
});

test('the tracer is deterministic, transparent outside the frame and champagne inside', async () => {
  const { tracePixels } = await import('../../scripts/render-tray.mjs');
  const opts = { scale: 1, spp: 1 }; // a one-sample thumbnail: noisy, but quick
  const a = await tracePixels(opts);
  const b = await tracePixels(opts);
  assert.equal(a.width, 176);
  assert.equal(a.height, 403);
  assert.ok(a.data.equals(b.data), 'two renders differ');
  const px = (x, y) => [...a.data.subarray((y * a.width + x) * 4, (y * a.width + x) * 4 + 4)];
  assert.equal(px(0, 0)[3], 0, 'the rounded corner is transparent');
  // Mean of the back panel's middle: opaque, light and warm (red over green over blue).
  let r = 0, g = 0, bl = 0, n = 0;
  for (let y = 180; y < 220; y++) for (let x = 60; x < 116; x++) {
    const [pr, pg, pb, pa] = px(x, y);
    assert.equal(pa, 255);
    r += pr; g += pg; bl += pb; n++;
  }
  [r, g, bl] = [r / n, g / n, bl / n];
  assert.ok(r > 150 && r > g && g > bl, `back panel mean ${r.toFixed(0)}, ${g.toFixed(0)}, ${bl.toFixed(0)}`);
});
