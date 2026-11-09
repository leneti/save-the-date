import { test, expect } from '@playwright/test';

const printed = (page) =>
  expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });

async function printAndOpen(page) {
  await page.goto('/');
  await page.locator('.print-btn').click();
  await printed(page);
}

async function openZoom(page) {
  await page.locator('.strip').click();
  await expect(page.locator('.zoom')).toHaveAttribute('open', '');
}

test('tapping the strip opens the close-up', async ({ page }) => {
  await printAndOpen(page);
  await openZoom(page);
  // Let the open animation settle before measuring.
  await page.waitForTimeout(500);
  const vp = page.viewportSize();
  const box = await page.locator('.zoom img').boundingBox();
  expect(box.height >= vp.height * 0.8 || box.width >= vp.width * 0.8).toBe(true);
});

test('closes by tap anywhere', async ({ page }) => {
  await printAndOpen(page);
  await openZoom(page);
  await page.mouse.click(5, 5);
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
});

test('closes by tapping the image', async ({ page }) => {
  await printAndOpen(page);
  await openZoom(page);
  await page.locator('.zoom img').click();
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
});

test('closes by close button', async ({ page }) => {
  await printAndOpen(page);
  await openZoom(page);
  await page.getByRole('button', { name: 'Uždaryti' }).click();
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
});

test('closes by Escape', async ({ page }) => {
  await printAndOpen(page);
  await openZoom(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
  // No stray entry: one Back leaves the page.
});

test('browser Back closes the close-up and stays on the page', async ({ page }) => {
  await printAndOpen(page);
  const url = page.url();
  await openZoom(page);
  await page.goBack();
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
  expect(page.url()).toBe(url);
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed');
});

for (const how of ['tap', 'Escape']) {
  test(`closing by ${how} does not leave a stray history entry`, async ({ page }) => {
    await page.goto('about:blank');
    await printAndOpen(page);
    await openZoom(page);
    if (how === 'tap') await page.mouse.click(5, 5);
    else await page.keyboard.press('Escape');
    await expect(page.locator('.zoom')).not.toHaveAttribute('open');
    await expect.poll(() => page.evaluate(() => !!history.state?.zoom)).toBe(false);
    await page.goBack();
    expect(page.url()).toBe('about:blank');
  });
}

test('a fast double close calls history.back only once', async ({ page }) => {
  await page.goto('about:blank');
  await printAndOpen(page);
  await openZoom(page);
  await page.evaluate(() => {
    window.__backs = 0;
    const orig = history.back.bind(history);
    history.back = () => { window.__backs++; orig(); };
    const d = document.querySelector('.zoom');
    d.click();
    d.click();
    d.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
  expect(await page.evaluate(() => window.__backs)).toBe(1);
  expect(page.url()).not.toBe('about:blank');
});

test('strip is not tappable while printing', async ({ page }) => {
  await page.goto('/');
  await page.locator('.print-btn').click();
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printing', { timeout: 10_000 });
  await page.locator('.strip').click({ force: true });
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
});

test('a failed strip image does not open an empty close-up', async ({ page }) => {
  await page.route('**/assets/strip.webp', (route) => route.abort());
  await printAndOpen(page);
  await expect.poll(() => page.evaluate(() => {
    const img = document.querySelector('.strip img');
    return img.complete && img.naturalWidth === 0;
  })).toBe(true);
  await page.locator('.strip').click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('.zoom')).not.toHaveAttribute('open');
  expect(await page.evaluate(() => !!history.state?.zoom)).toBe(false);
});

test('without <dialog> support the strip is inert and nothing breaks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { delete HTMLDialogElement.prototype.showModal; });
  await printAndOpen(page);
  await page.locator('.strip').click();
  await page.waitForTimeout(300);
  await expect(page.locator('.zoom')).toBeHidden();
  expect(await page.evaluate(() => !!history.state?.zoom)).toBe(false);
  expect(errors).toEqual([]);
});
