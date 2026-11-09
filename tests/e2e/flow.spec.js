import { test, expect } from '@playwright/test';
import { googleCalendarUrl } from '../../site/calendar.js';

const printed = (page) =>
  expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });

// Records every change of <main data-state> into window.__states. <main> does not exist at document
// start, so observe the whole document for the attribute. Every write is recorded, even a re-set to the same value.
const recordStates = (page) =>
  page.addInitScript(() => {
    window.__states = [];
    new MutationObserver((records) => {
      for (const r of records) {
        const v = r.target.getAttribute('data-state');
        // No dedupe: a state that is set twice (a restarted sequence) must show up as a duplicate.
        if (v !== null) window.__states.push(v);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
  });

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('pressing the button prints and reveals everything', async ({ page }) => {
  await page.goto('/');
  await page.locator('.print-btn').click();
  const count = page.locator('.plate-count');
  await expect(count).toHaveText('3', { timeout: 1000 });
  await expect(count).toHaveText('2', { timeout: 1000 });
  await expect(count).toHaveText('1', { timeout: 1000 });
  await printed(page);
  for (const sel of ['.names', '.strip img', '.date', '.cal-primary', '.cal-secondary', '.note']) {
    await expect(page.locator(sel)).toBeVisible();
  }
  await expect(page.locator('.print-btn')).toBeHidden();
  await expect(page.locator('#announce')).toHaveText('Emilija & Dominykas, 2027.08.20');
  await expect(page.locator('.strip')).toBeEnabled();
});

for (const trigger of ['.plate', '.slot']) {
  test(`tapping ${trigger} starts printing`, async ({ page }) => {
    await page.goto('/');
    await page.locator(trigger).click();
    await expect(page.locator('.booth')).not.toHaveAttribute('data-state', 'idle', { timeout: 500 });
  });
}

test('focus lands on the names when printing finishes after a keyboard press', async ({ page }) => {
  await page.goto('/');
  await page.locator('.print-btn').focus();
  await page.keyboard.press('Enter');
  await printed(page);
  await expect(page.locator('.names')).toBeFocused();
});

test('double press does not restart', async ({ page }) => {
  await recordStates(page);
  await page.goto('/');
  const btn = page.locator('.print-btn');
  await btn.click();
  await btn.click();
  await printed(page);
  expect(await page.evaluate(() => window.__states)).toEqual(['countdown', 'flash', 'printing', 'printed']);
});

test('calendar links match the device', async ({ page }, testInfo) => {
  await page.goto('/');
  const primary = page.locator('.cal-primary');
  const secondary = page.locator('.cal-secondary');
  if (testInfo.project.name === 'pixel') {
    await expect(primary).toHaveAttribute('href', googleCalendarUrl());
    await expect(primary).toHaveAttribute('target', '_blank');
    await expect(primary).toHaveText('Pridėti į kalendorių');
    await expect(secondary).toHaveText('Kitas kalendorius');
    await expect(secondary).toHaveAttribute('href', '/save-the-date.ics');
    await expect(secondary).not.toHaveAttribute('target');
  } else {
    await expect(primary).toHaveAttribute('href', '/save-the-date.ics');
    await expect(primary).not.toHaveAttribute('target');
    await expect(primary).toHaveText('Pridėti į kalendorių');
    await expect(secondary).toHaveText('Google kalendorius');
    await expect(secondary).toHaveAttribute('href', googleCalendarUrl());
    await expect(secondary).toHaveAttribute('target', '_blank');
  }
});

test('reduced motion reaches the same end state without flash', async ({ page }) => {
  await recordStates(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => {
    window.__flashMax = 0;
    const loop = () => {
      const o = parseFloat(getComputedStyle(document.querySelector('.flash')).opacity);
      if (o > window.__flashMax) window.__flashMax = o;
      requestAnimationFrame(loop);
    };
    loop();
  });
  await page.locator('.print-btn').click();
  await printed(page);
  expect(await page.evaluate(() => window.__states)).toEqual(['countdown', 'printing', 'printed']);
  expect(await page.evaluate(() => window.__flashMax)).toBe(0);
  await expect(page.locator('.strip img')).toBeVisible();
  await expect(page.locator('.cal-primary')).toBeVisible();
});

test('reduced motion fires every hook at the same times as normal motion', async ({ page }) => {
  const run = async (reducedMotion) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto('/');
    await page.evaluate(async () => {
      const { hooks } = await import('/app.js');
      window.__hooks = [];
      const t0 = { v: 0 };
      for (const name of Object.keys(hooks)) {
        hooks[name] = (...args) => {
          if (name === 'onPress') t0.v = performance.now();
          window.__hooks.push([name, args[0] ?? null, performance.now() - t0.v]);
        };
      }
    });
    await page.locator('.print-btn').click();
    await printed(page);
    return page.evaluate(() => window.__hooks);
  };
  const expected = [
    ['onPress', null, 0], ['onTick', 3, 200], ['onTick', 2, 900], ['onTick', 1, 1600],
    ['onFlash', null, 2300], ['onFeedStart', null, 3100],
    ['onJerk', 0, 3100], ['onJerk', 1, 3850], ['onJerk', 2, 4600], ['onJerk', 3, 5350],
    ['onLand', null, 6100],
  ];
  for (const mode of ['no-preference', 'reduce']) {
    const fired = await run(mode);
    expect(fired.map((h) => h.slice(0, 2)), mode).toEqual(expected.map((h) => h.slice(0, 2)));
    fired.forEach((h, i) => expect(Math.abs(h[2] - expected[i][2]), `${mode} ${h[0]}`).toBeLessThan(150));
  }
});

test('a throwing hook cannot stop the sequence', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { hooks } = await import('/app.js');
    for (const name of Object.keys(hooks)) hooks[name] = () => { throw new Error('boom'); };
  });
  await page.locator('.print-btn').click();
  await printed(page);
});

test('reaches printed with all CSS animations disabled', async ({ page }) => {
  await page.goto('/');
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.locator('.print-btn').click();
  await printed(page);
  await expect(page.locator('.names')).toBeVisible();
});

test('completes when strip image fails', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.route('**/assets/strip.webp', (r) => r.abort());
  await page.goto('/');
  await page.locator('.print-btn').click();
  await printed(page);
  const box = await page.locator('.strip').boundingBox();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('no horizontal overflow during and after printing', async ({ page }) => {
  await page.goto('/');
  await page.locator('.print-btn').click();
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printing', { timeout: 10_000 });
  expect(await noOverflow(page)).toBe(true);
  await printed(page);
  expect(await noOverflow(page)).toBe(true);
});
