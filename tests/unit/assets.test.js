import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { prepareStrip } from '../../scripts/prepare-strip.mjs';

const faces = ['luxurious-script-400', 'cormorant-garamond-500', 'josefin-sans-400', 'josefin-sans-600'];

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
  assert.ok(ratio >= 4.6 && ratio <= 5.4, `ratio ${ratio}`);
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

test('prepareStrip honours EXIF orientation, so crop coordinates match the photo as seen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'strip-'));
  try {
    // Stored 2000x1000 with orientation 6 (rotate 90deg CW): displayed as 1000x2000. A red block fills the
    // displayed top 500px. Stored, it is the left-hand 500 columns; displayed, rows 0-499.
    const input = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#ffffff' } })
      .composite([{ input: { create: { width: 500, height: 1000, channels: 3, background: '#ff0000' } }, left: 0, top: 0 }])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = join(dir, 'out.webp');
    const res = await prepareStrip(input, { crop: '0,0,1000,500', tone: 'none', out });
    // Crop 1000x500 of the displayed photo, resized to height 1600 -> 3200x1600, and it is all red.
    assert.equal(res.width, 3200);
    const { channels } = await sharp(out).stats();
    const [r, g, b] = channels.map((c) => c.mean);
    assert.ok(r > 200 && g < 60 && b < 60, `means ${r} ${g} ${b}`);
    // And without a crop the result is portrait, as the photo is seen.
    const full = await prepareStrip(input, { tone: 'none', out });
    assert.equal(full.width, 800);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('favicon.svg exists', () => {
  assert.ok(existsSync('site/assets/favicon.svg'));
});
