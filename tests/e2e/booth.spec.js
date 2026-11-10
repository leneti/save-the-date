import { test, expect } from '@playwright/test';
import { TRAY, PANEL, STRIP_REST } from '../../scripts/tray/geometry.mjs';

const STRIP_NAME = 'Emilijos ir Dominyko nuotraukų juostelė';
const TOLERANCE = 4; // px, spec-booth-v2 section 3

// The back panel's rect in page coordinates, from the slot's bounding box and the geometry.mjs fractions.
async function panelRect(page) {
  const box = await page.locator('.slot').boundingBox();
  const sx = box.width / TRAY.W;
  const sy = box.height / TRAY.H;
  return {
    x: box.x + PANEL.left * sx,
    y: box.y + PANEL.top * sy,
    width: (PANEL.right - PANEL.left) * sx,
    height: (PANEL.bottom - PANEL.top) * sy,
  };
}

const rectOf = async (page, selector) => page.locator(selector).boundingBox();

// Layout facts about the strip, read in the page. offsetTop/offsetHeight ignore the transform, so
// they give the unrotated box. The strip's offsetParent is .tray-clip, whose own offset is added.
const stripLayout = (page) =>
  page.evaluate(() => {
    const slot = document.querySelector('.slot');
    const clip = document.querySelector('.tray-clip');
    const strip = document.querySelector('.strip');
    const [a, b] = getComputedStyle(strip).transform.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number);
    return {
      slotWidth: slot.offsetWidth,
      slotHeight: slot.offsetHeight,
      stripWidth: strip.offsetWidth,
      unrotatedBottom: clip.offsetTop + strip.offsetTop + strip.offsetHeight,
      angle: (Math.atan2(b, a) * 180) / Math.PI,
    };
  });

async function stripImageLoaded(page) {
  await page.waitForFunction(() => {
    const img = document.querySelector('.strip img');
    return img && img.complete && img.naturalWidth > 0;
  });
}

// Asserts the strip rests tilted on the ledge: 70 % of the back panel wide, its unrotated bottom between
// design y 365 and 391, rotated about -2.2 degrees.
async function expectRestPose(page) {
  await stripImageLoaded(page);
  const l = await stripLayout(page);
  const panelWidth = (l.slotWidth * (PANEL.right - PANEL.left)) / TRAY.W;
  const ratio = l.stripWidth / panelWidth;
  expect(ratio, 'strip width / panel width').toBeGreaterThanOrEqual(0.68);
  expect(ratio, 'strip width / panel width').toBeLessThanOrEqual(0.72);
  const designBottom = (l.unrotatedBottom * TRAY.H) / l.slotHeight;
  expect(designBottom, 'strip bottom in design px').toBeGreaterThanOrEqual(PANEL.bottom);
  expect(designBottom, 'strip bottom in design px').toBeLessThanOrEqual(TRAY.H - TRAY.rim);
  expect(Math.abs(designBottom - STRIP_REST.bottomPx), 'strip bottom vs rest pose').toBeLessThan(1.5);
  expect(l.angle, 'strip angle').toBeGreaterThanOrEqual(-3);
  expect(l.angle, 'strip angle').toBeLessThanOrEqual(-1.5);
}

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function expectIdleCentred(page) {
  await page.goto('/');
  await expect(page.locator('.print-btn')).toBeVisible();
  const vh = page.viewportSize().height;
  const plate = await rectOf(page, '.plate');
  const btn = await rectOf(page, '.print-btn');
  test.skip(btn.y + btn.height > vh, 'idle content is taller than the viewport');
  const top = plate.y;
  const bottom = vh - (btn.y + btn.height);
  expect(Math.abs(top - bottom), `top gap ${top}, bottom gap ${bottom}`).toBeLessThanOrEqual(TOLERANCE);
}

test('idle is vertically centred', async ({ page }) => {
  await expectIdleCentred(page);
});

test('idle fits the viewport on iphone and pixel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'small', 'the small project may scroll');
  await page.goto('/');
  await expect(page.locator('.print-btn')).toBeVisible();
  const btn = await rectOf(page, '.print-btn');
  expect(btn.y + btn.height).toBeLessThanOrEqual(page.viewportSize().height);
});

test('the slot does not move between idle and printed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.slot')).toBeVisible();
  const idle = await rectOf(page, '.slot');
  await page.evaluate(() => { document.querySelector('.booth').dataset.state = 'printed'; });
  await expect(page.locator('.names')).toBeVisible();
  const printed = await rectOf(page, '.slot');
  expect(Math.abs(idle.y - printed.y)).toBeLessThanOrEqual(1);
});

test('decorative layers are marked aria-hidden', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.slot .etched')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.slot .tray-shade')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.slot .tray-clip')).not.toHaveAttribute('role', /.+/);
});

test('tray image failure falls back and still prints', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.route('**/assets/tray.webp', (r) => r.abort());
  await page.goto('/');
  await page.locator('.print-btn').click();
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });
  const bg = await page.locator('.slot').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
  expect(errors).toEqual([]);
});

test.describe('no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('printed is vertically centred', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.names')).toBeVisible();
    const vh = page.viewportSize().height;
    const names = await rectOf(page, '.names');
    const details = await rectOf(page, '.details');
    const overflows = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight);
    test.skip(overflows, 'printed content is taller than the viewport');
    const top = names.y;
    const bottom = vh - (details.y + details.height);
    expect(Math.abs(top - bottom), `top gap ${top}, bottom gap ${bottom}`).toBeLessThanOrEqual(TOLERANCE);
  });

  test('printed strip rests tilted on the ledge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.strip img')).toBeVisible();
    await expectRestPose(page);
    const strip = await rectOf(page, '.strip');
    const panel = await panelRect(page);
    // The tilted strip stays inside the slot, horizontally centred on the panel.
    expect(Math.abs(strip.x + strip.width / 2 - (panel.x + panel.width / 2))).toBeLessThanOrEqual(2);
  });

  test('only the strip button is exposed to assistive tech', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.strip img')).toBeVisible();
    const snapshot = await page.locator('.slot').ariaSnapshot();
    expect(snapshot).toContain(`button "${STRIP_NAME}"`);
    expect(snapshot).not.toContain('Save the Date');
    const lines = snapshot.split('\n').filter((l) => l.trim());
    expect(lines.filter((l) => /^\s*- (?!img)/.test(l)), snapshot).toHaveLength(1);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('slot width capped and centred', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.slot')).toBeVisible();
    const slot = await rectOf(page, '.slot');
    expect(slot.width).toBeLessThanOrEqual(240);
    expect(Math.abs(slot.x + slot.width / 2 - 1280 / 2)).toBeLessThanOrEqual(1);
    await expectIdleCentred(page);
  });
});

test.describe('landscape no-JS', () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 740, height: 360 } });

  test('strip on ledge, no overflow', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.strip img')).toBeVisible();
    await expectRestPose(page);
    expect(await noOverflow(page)).toBe(true);
    const note = page.locator('.note');
    await note.scrollIntoViewIfNeeded();
    await expect(note).toBeInViewport();
  });
});
