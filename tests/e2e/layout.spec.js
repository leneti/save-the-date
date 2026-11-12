import { test, expect } from '@playwright/test';

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('idle shows plate, slot and print button only', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.plate')).toBeVisible();
  await expect(page.locator('.plate-text')).toHaveText('Paspausk mygtuką!');
  await expect(page.locator('.slot .etched')).toBeVisible();
  await expect(page.locator('.slot .etched span')).toHaveText(['Save', 'the', 'Date']);
  await expect(page.locator('.print-btn')).toBeVisible();
  await expect(page.locator('.names')).toBeHidden();
  await expect(page.locator('.details')).toBeHidden();
  await expect(page.locator('.note')).toBeHidden();
  await expect(page.locator('.flash')).toBeHidden();
});

test('the booth opts out of double-tap zoom', async ({ page }) => {
  await page.goto('/');
  expect(await page.locator('.booth').evaluate((el) => getComputedStyle(el).touchAction)).toBe('manipulation');
});

test('no horizontal overflow in idle', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.print-btn')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

async function assertFontsLoadFromSameOrigin(page, baseURL, families) {
  const urls = [];
  const fontStatuses = [];
  page.on('request', (r) => urls.push(r.url()));
  page.on('response', (r) => {
    if (r.url().endsWith('.woff2')) fontStatuses.push(r.status());
  });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  expect(urls.length).toBeGreaterThan(0);
  for (const u of urls) expect(u.startsWith(baseURL), u).toBe(true);
  expect(fontStatuses.length).toBeGreaterThan(0);
  expect(fontStatuses.every((s) => s === 200), `woff2 statuses: ${fontStatuses}`).toBe(true);
  for (const family of families) {
    const loaded = await page.evaluate(
      (f) => document.fonts.load(`1em "${f}"`, 'Emilija 2027.08.20').then((faces) => faces.length > 0 && document.fonts.check(`1em "${f}"`, 'Emilija 2027.08.20')),
      family,
    );
    expect(loaded, `${family} loaded`).toBe(true);
  }
}

test('fonts load from same origin only (idle)', async ({ page, baseURL }) => {
  await assertFontsLoadFromSameOrigin(page, baseURL, ['Luxurious Script', 'Josefin Sans']);
});

test.describe('no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('renders the printed state statically', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.names')).toBeVisible();
    await expect(page.locator('.names')).toHaveText('Švęsti meilę, švęsti mus! Emilija & Dominykas');
    await expect(page.locator('.names .lead')).toBeVisible();
    await expect(page.locator('.details .kicker')).toBeVisible();
    await expect(page.locator('.details .kicker')).toHaveText('Save the Date');
    await expect(page.locator('.note')).toHaveText('Detalų kvietimą atsiųsime vėliau');
    await expect(page.locator('.strip img')).toBeVisible();
    await expect(page.locator('.date')).toHaveText('2027.08.20');
    await expect(page.locator('.note')).toBeVisible();
    await expect(page.locator('.print-btn')).toBeHidden();
  });

  test('fonts load from same origin only (printed)', async ({ page, baseURL }) => {
    await assertFontsLoadFromSameOrigin(page, baseURL, ['Luxurious Script', 'Cormorant Garamond', 'Josefin Sans']);
  });

  test('no horizontal overflow in printed state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.names')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  });

  test('names fit on one line, also on the smallest screen', async ({ page }) => {
    await page.goto('/');
    const names = page.locator('.names');
    await expect(names).toBeVisible();
    const box = await names.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    // The heading holds the small line and then the names: take that line (and its margin) off.
    const { lineHeight, lead } = await names.evaluate((el) => {
      const k = el.querySelector('.lead');
      return { lineHeight: parseFloat(getComputedStyle(el).lineHeight), lead: k.offsetHeight + parseFloat(getComputedStyle(k).marginBottom) };
    });
    expect(box.height - lead).toBeLessThan(lineHeight * 1.5);
  });
});

for (const module of ['app.js', 'feed.js', 'sound.js']) {
  test(`falls back to the static printed view when ${module} fails to load`, async ({ page }) => {
    await page.route(`**/${module}`, (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass('no-js');
    await expect(page.locator('.names')).toBeVisible();
    await expect(page.locator('.date')).toHaveText('2027.08.20');
    await expect(page.locator('.note')).toBeVisible();
    await expect(page.locator('.print-btn')).toBeHidden();
  });
}

test.describe('landscape phone', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 740, height: 360 } });

  test('has no horizontal overflow and footer is reachable', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.names')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
    const note = page.locator('.note');
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeInViewport();
  });
});
