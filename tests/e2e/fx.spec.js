import { test, expect } from '@playwright/test';

const printed = (page) =>
  expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });

// Serve dummy mp3 bytes (the sound's own name), so the fake decodeAudioData can tell the buffers apart.
// This keeps the tests independent of whether the real files exist.
const fakeSoundFiles = (page) =>
  page.route('**/assets/sounds/*.mp3', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop().replace('.mp3', '');
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: name });
  });

const fakeAudio = (page) =>
  page.addInitScript(() => {
    window.__played = [];
    window.__stopped = [];
    window.__decoded = 0;
    window.__resumed = 0;
    const names = new WeakMap(); // decoded buffer -> sound name
    class FakeAudioContext {
      constructor() {
        this.state = 'suspended';
        this.destination = {};
      }
      resume() {
        window.__resumed++;
        this.state = 'running';
        return Promise.resolve();
      }
      decodeAudioData(bytes) {
        const name = new TextDecoder().decode(bytes);
        const buffer = { name };
        names.set(buffer, name);
        window.__decoded++;
        return Promise.resolve(buffer);
      }
      createBufferSource() {
        const src = {
          buffer: null,
          loop: false,
          connect() {},
          start() { window.__played.push(names.get(src.buffer)); },
          stop() { window.__stopped.push(names.get(src.buffer)); },
        };
        return src;
      }
    }
    window.AudioContext = FakeAudioContext;
    window.webkitAudioContext = FakeAudioContext;
  });

test('plays the four sounds at the right moments', async ({ page }) => {
  await fakeSoundFiles(page);
  await fakeAudio(page);
  await page.goto('/');
  await page.waitForFunction(() => window.__decoded === 4);
  await page.locator('.print-btn').click();
  await printed(page);
  expect(await page.evaluate(() => window.__resumed)).toBeGreaterThan(0);
  const played = await page.evaluate(() => window.__played);
  expect(played).toEqual(['tick', 'tick', 'tick', 'tick', 'shutter', 'whirr', 'clunk']);
  // The whirr loop is stopped before the clunk.
  expect(await page.evaluate(() => window.__stopped)).toEqual(['whirr']);
});

test('vibrates on Android only', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await fakeSoundFiles(page);
  if (testInfo.project.name === 'pixel') {
    await page.addInitScript(() => {
      window.__vib = [];
      navigator.vibrate = (p) => { window.__vib.push(p); return true; };
    });
    await page.goto('/');
    await page.locator('.print-btn').click();
    await printed(page);
    expect(await page.evaluate(() => window.__vib)).toEqual([15, 40, 40, 40, 40, 30]);
  } else {
    await page.addInitScript(() => {
      delete Navigator.prototype.vibrate;
      delete navigator.vibrate;
    });
    await page.goto('/');
    expect(await page.evaluate(() => 'vibrate' in navigator)).toBe(false);
    await page.locator('.print-btn').click();
    await printed(page);
  }
  expect(errors).toEqual([]);
});

test('a throwing navigator.vibrate cannot stop the print', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await fakeSoundFiles(page);
  await page.addInitScript(() => {
    navigator.vibrate = () => { throw new Error('nope'); };
  });
  await page.goto('/');
  await page.locator('.print-btn').click();
  await printed(page);
  expect(errors).toEqual([]);
});

test('completes silently when audio is unavailable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.route('**/assets/sounds/**', (r) => r.fulfill({ status: 404 }));
  await page.addInitScript(() => {
    delete window.AudioContext;
    delete window.webkitAudioContext;
  });
  await page.goto('/');
  await page.locator('.print-btn').click();
  await printed(page);
  expect(errors).toEqual([]);
});

test('missing sound files (404) with working audio still complete silently', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.route('**/assets/sounds/**', (r) => r.fulfill({ status: 404 }));
  await fakeAudio(page);
  await page.goto('/');
  await page.locator('.print-btn').click();
  await printed(page);
  expect(await page.evaluate(() => window.__played)).toEqual([]);
  expect(errors).toEqual([]);
});
