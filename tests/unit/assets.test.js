import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { prepareStrip } from '../../scripts/prepare-strip.mjs';

const faces = ['pinyon-script-400', 'cormorant-garamond-500', 'josefin-sans-400', 'josefin-sans-600'];

test('fonts cover latin and latin-ext for every face', () => {
  for (const face of faces) {
    for (const subset of ['latin', 'latin-ext']) {
      const p = `site/assets/fonts/${face}-${subset}.woff2`;
      assert.ok(existsSync(p) && statSync(p).size > 0, `${p} missing or empty`);
    }
  }
});

test('strip.webp is a portrait strip ≤200KB', async () => {
  const p = 'site/assets/strip.webp';
  const m = await sharp(p).metadata();
  assert.equal(m.format, 'webp');
  assert.equal(m.height, 1600);
  const ratio = m.height / m.width;
  assert.ok(ratio >= 3.2 && ratio <= 4.0, `ratio ${ratio}`);
  assert.ok(statSync(p).size <= 200000);
});

test('prepareStrip crops, rotates and tones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'strip-'));
  try {
    const input = await sharp({
      create: { width: 1200, height: 4000, channels: 3, background: '#ffffff' },
    })
      .composite([{ input: { create: { width: 600, height: 1500, channels: 3, background: '#ff0000' } }, left: 300, top: 1000 }])
      .png()
      .toBuffer();
    const out = join(dir, 'out.webp');
    const res = await prepareStrip(input, { rotate: 2, crop: '100,100,1000,3700', tone: 'bw', out });
    assert.equal(res.height, 1600);
    const m = await sharp(out).metadata();
    assert.equal(m.height, 1600);
    const { channels } = await sharp(out).stats();
    const [r, g, b] = channels.map((c) => c.mean);
    assert.ok(Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2, `means ${r} ${g} ${b}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('favicon.svg exists', () => {
  assert.ok(existsSync('site/assets/favicon.svg'));
});
