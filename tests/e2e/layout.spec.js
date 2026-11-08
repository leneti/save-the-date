import { test, expect } from '@playwright/test';
import { googleCalendarUrl } from '../../site/calendar.js';

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('idle shows plate, slot and print button only', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.plate')).toBeVisible();
  await expect(page.locator('.plate-text')).toHaveText('Paspausk mygtuką!');
  await expect(page.locator('.slot .etched')).toBeVisible();
  await expect(page.locator('.print-btn')).toBeVisible();
  await expect(page.locator('.names')).toBeHidden();
  await expect(page.locator('.details')).toBeHidden();
  await expect(page.locator('.note')).toBeHidden();
});

test('no horizontal overflow in idle', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.print-btn')).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
});

test('fonts load from same origin only', async ({ page, baseURL }) => {
  const urls = [];
  page.on('request', (r) => urls.push(r.url()));
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  expect(urls.length).toBeGreaterThan(0);
  for (const u of urls) expect(u.startsWith(baseURL), u).toBe(true);
});

test.describe('no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('renders the printed state statically', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.names')).toBeVisible();
    await expect(page.locator('.names')).toHaveText('Emilija & Dominykas');
    await expect(page.locator('.strip img')).toBeVisible();
    await expect(page.locator('.date')).toHaveText('2027.08.20');
    await expect(page.locator('.cal-primary')).toBeVisible();
    await expect(page.locator('.cal-primary')).toHaveAttribute('href', '/save-the-date.ics');
    await expect(page.locator('.cal-secondary')).toBeVisible();
    await expect(page.locator('.cal-secondary')).toHaveAttribute('href', googleCalendarUrl());
    await expect(page.locator('.note')).toBeVisible();
    await expect(page.locator('.print-btn')).toBeHidden();
  });

  test('no horizontal overflow in printed state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.names')).toBeVisible();
    expect(await noOverflow(page)).toBe(true);
  });

  test('names fit on the smallest screen', async ({ page }, testInfo) => {
    await page.goto('/');
    const names = page.locator('.names');
    await expect(names).toBeVisible();
    const box = await names.boundingBox();
    const vp = page.viewportSize();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    if (testInfo.project.name === 'small') {
      const lineHeight = await names.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      expect(box.height).toBeGreaterThan(lineHeight * 1.5);
    } else {
      // wider phones: stays on one line
      const lineHeight = await names.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
      expect(box.height).toBeLessThan(lineHeight * 1.5);
    }
  });
});

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
