import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { TRAY, PANEL, STRIP_REST } from '../../scripts/tray/geometry.mjs';

const STRIP_NAME = 'Emilijos ir Dominyko nuotraukų juostelė';
const TOLERANCE = 8; // the button's socket hangs 7px below its row, so the booth sits that much low

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

// Asserts the strip rests tilted on the ledge: about 56 % of the back panel wide (a real four-frame strip is 1:5), its unrotated bottom between
// design y 365 and 391, rotated about -2.2 degrees.
async function expectRestPose(page) {
  await stripImageLoaded(page);
  const l = await stripLayout(page);
  const panelWidth = (l.slotWidth * (PANEL.right - PANEL.left)) / TRAY.W;
  const ratio = l.stripWidth / panelWidth;
  expect(ratio, 'strip width / panel width').toBeGreaterThanOrEqual(0.55);
  expect(ratio, 'strip width / panel width').toBeLessThanOrEqual(0.58);
  const designBottom = (l.unrotatedBottom * TRAY.H) / l.slotHeight;
  expect(designBottom, 'strip bottom in design px').toBeGreaterThanOrEqual(PANEL.bottom);
  expect(designBottom, 'strip bottom in design px').toBeLessThanOrEqual(TRAY.H - TRAY.rim);
  expect(Math.abs(designBottom - STRIP_REST.bottomPx), 'strip bottom vs rest pose').toBeLessThan(1.5);
  expect(l.angle, 'strip angle').toBeGreaterThanOrEqual(-3);
  expect(l.angle, 'strip angle').toBeLessThanOrEqual(-1.5);
}

const noOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

// The socket around the print button is its ::before, inset by a negative amount; its outer edge is the
// bottom anchor for centring.
const socketOverhang = (page) =>
  page.locator('.print-btn').evaluate((el) => -parseFloat(getComputedStyle(el, '::before').bottom));

async function expectIdleCentred(page) {
  await page.goto('/');
  await expect(page.locator('.print-btn')).toBeVisible();
  const vh = page.viewportSize().height;
  const plate = await rectOf(page, '.plate');
  const btn = await rectOf(page, '.print-btn');
  const socketBottom = btn.y + btn.height + (await socketOverhang(page));
  const overflows = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight);
  test.skip(overflows, 'idle content is taller than the viewport');
  const top = plate.y;
  const bottom = vh - socketBottom;
  expect(Math.abs(top - bottom), `top gap ${top}, bottom gap ${bottom}`).toBeLessThanOrEqual(TOLERANCE);
}

test('idle is vertically centred', async ({ page }) => {
  await expectIdleCentred(page);
});

test('the plate has no arrow and its text is vertically centred', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.plate-arrow')).toHaveCount(0);
  const plate = await rectOf(page, '.plate');
  const text = await rectOf(page, '.plate-text');
  const offset = (text.y + text.height / 2) - (plate.y + plate.height / 2);
  expect(Math.abs(offset), `text centre is ${offset}px from the plate centre`).toBeLessThanOrEqual(2);
});

test('the print button keeps its size and sits in a recessed socket', async ({ page }) => {
  await page.goto('/');
  const btn = await rectOf(page, '.print-btn');
  // 72 px, or 64 px on screens too short for it (the max-height: 624px rule).
  const size = page.viewportSize().height <= 624 ? 64 : 72;
  expect(btn.width).toBe(size);
  expect(btn.height).toBe(size);
  const socket = await page.locator('.print-btn').evaluate((el) => {
    const cs = getComputedStyle(el, '::before');
    return { content: cs.content, radius: cs.borderTopLeftRadius, z: cs.zIndex, w: parseFloat(cs.width), h: parseFloat(cs.height) };
  });
  expect(socket.content).not.toBe('none');
  expect(socket.radius).toBe('50%');
  expect(socket.z).toBe('-1');
  // A dark ring about 7 px wide around the button.
  expect(socket.w).toBe(size + 14);
  expect(socket.h).toBe(size + 14);
});

test('the metal tokens and the overhead light are in place', async ({ page }) => {
  await page.goto('/');
  const css = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      tokens: ['--metal-hi', '--metal-mid', '--metal-lo', '--metal-deep', '--polished-metal'].map((n) => root.getPropertyValue(n).trim()),
      stack: root.getPropertyValue('--metal-stack'),
      light: getComputedStyle(document.body).backgroundImage,
    };
  });
  for (const t of css.tokens) expect(t).not.toBe('');
  expect(css.tokens[4]).toMatch(/^linear-gradient\(/);
  expect(css.stack, 'metal stack ends with the polished gradient').toContain(css.tokens[4]);
  expect(css.light).toMatch(/radial-gradient\(.*rgb\(66, 77, 53\)/);
});

// The socket's outer bottom (button bottom + overhang) must be on screen in idle: a short viewport that
// cannot fit the content still has to show the whole print button.
async function expectButtonOnScreen(page) {
  await page.goto('/');
  await expect(page.locator('.print-btn')).toBeVisible();
  const btn = await rectOf(page, '.print-btn');
  const socketBottom = btn.y + btn.height + (await socketOverhang(page));
  expect(socketBottom, 'socket bottom vs viewport height').toBeLessThanOrEqual(page.viewportSize().height);
}

test('idle fits the viewport on every project', async ({ page }) => {
  await expectButtonOnScreen(page);
});

for (const [width, height] of [[375, 553], [360, 560], [320, 568], [1366, 650]]) {
  test.describe(`short ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the whole print button is on screen in idle', async ({ page }) => {
      await expectButtonOnScreen(page);
    });
  });
}

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
  let aborted = 0;
  await page.route('**/assets/tray.webp', (r) => { aborted++; return r.abort(); });
  await page.goto('/');
  await page.locator('.print-btn').click();
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });
  const bg = await page.locator('.slot').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('transparent');
  expect(aborted, 'the abort route was hit').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

// Samples the strip and the clip every frame from onFeedStart until the booth is printed.
// Wraps the hooks, so the real ones still run. Each sample records whether the motor had stopped and whether
// onLand had fired yet.
async function installFeedSampler(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { hooks } = await import('/app.js');
    const strip = document.querySelector('.strip');
    const clip = document.querySelector('.tray-clip');
    const booth = document.querySelector('.booth');
    window.__feed = { samples: [], motorStopped: false, landed: false };
    const sample = () => {
      const [a, b] = getComputedStyle(strip).transform.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number);
      window.__feed.samples.push({
        stripBottom: strip.getBoundingClientRect().bottom, // the lowest corner once the strip is tilted
        clipTop: clip.getBoundingClientRect().top,
        overflow: getComputedStyle(clip).overflow,
        angle: (Math.atan2(b, a) * 180) / Math.PI,
        printing: booth.dataset.state === 'printing',
        motorStopped: window.__feed.motorStopped,
        landed: window.__feed.landed,
      });
      // One more sample after the state changes: the strip at rest.
      if (booth.dataset.state === 'printing') requestAnimationFrame(sample);
    };
    const onFeedStart = hooks.onFeedStart;
    hooks.onFeedStart = (...args) => {
      const result = onFeedStart(...args);
      sample();
      return result;
    };
    const onMotorStop = hooks.onMotorStop;
    hooks.onMotorStop = (...args) => {
      window.__feed.motorStopped = true;
      return onMotorStop(...args);
    };
    const onLand = hooks.onLand;
    hooks.onLand = (...args) => {
      window.__feed.landed = true;
      return onLand(...args);
    };
  });
}

async function printAndSample(page) {
  await installFeedSampler(page);
  await page.locator('.print-btn').click();
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });
  // The sampler takes its last sample (the strip at rest) on the frame after the state changes: wait for it.
  await page.waitForFunction(() => window.__feed.samples.at(-1)?.printing === false);
  return page.evaluate(() => window.__feed);
}

function expectHiddenStart(feed) {
  expect(feed.samples.length).toBeGreaterThan(10);
  expect(feed.samples[0].stripBottom, 'strip bottom vs clip top in the first sample').toBeLessThanOrEqual(
    feed.samples[0].clipTop + 1,
  );
  for (const s of feed.samples) expect(['clip', 'hidden']).toContain(s.overflow);
}

test('the strip starts hidden under the top wall', async ({ page }) => {
  expectHiddenStart(await printAndSample(page));
});

test('no rotation while the printer pushes', async ({ page }) => {
  const feed = await printAndSample(page);
  const pushing = feed.samples.filter((s) => !s.motorStopped);
  expect(pushing.length).toBeGreaterThan(10);
  for (const s of pushing) expect(Math.abs(s.angle)).toBeLessThanOrEqual(0.3);
});

test('the strip comes out in steps and never moves back up', async ({ page }) => {
  const feed = await printAndSample(page);
  const pushing = feed.samples.filter((s) => !s.motorStopped);
  for (let i = 1; i < pushing.length; i++) {
    expect(pushing[i].stripBottom, `sample ${i}`).toBeGreaterThanOrEqual(pushing[i - 1].stripBottom - 0.5);
  }
});

test('the strip lands on the ledge without dipping below it', async ({ page }) => {
  const feed = await printAndSample(page);
  const rest = feed.samples.at(-1);
  expect(rest.printing, 'the last sample is the strip at rest').toBe(false);
  // The lowest corner is never below where it rests, and after landing it stays on the ledge.
  for (const s of feed.samples) expect(s.stripBottom, 'lowest corner vs its rest position').toBeLessThanOrEqual(rest.stripBottom + 0.75);
  // Once the corner has reached the ledge it stays there while the tilt settles. (The hook is on a timer, so the
  // strip can still be a frame away from the ledge when onLand fires.)
  const touchdown = feed.samples.findIndex((s) => s.landed && Math.abs(s.stripBottom - rest.stripBottom) <= 0.75);
  expect(touchdown, 'the corner reaches the ledge').toBeGreaterThan(-1);
  const settling = feed.samples.slice(touchdown);
  expect(settling.length).toBeGreaterThan(3);
  for (const s of settling) expect(Math.abs(s.stripBottom - rest.stripBottom), 'corner on the ledge after landing').toBeLessThanOrEqual(0.75);
  // It arrives tilted a little more than it rests, and the tilt never swings past upright.
  for (const s of feed.samples) {
    expect(s.angle).toBeLessThanOrEqual(0.3);
    expect(s.angle).toBeGreaterThanOrEqual(-3.6);
  }
});

// Steps both animations through the feed by hand, inside one task, so the strip and the shadow are read at exactly
// the same instant. (Sampling a running animation frame by frame reads the two a moment apart in WebKit.)
test("the top wall's shadow stays put while the paper slides and turns under it", async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { hooks } = await import('/app.js');
    const strip = document.querySelector('.strip');
    const shade = strip.querySelector('.tray-shade');
    const onFeedStart = hooks.onFeedStart;
    hooks.onFeedStart = (...args) => {
      const animations = [...strip.getAnimations(), ...shade.getAnimations()];
      const total = animations[0].effect.getTiming().duration;
      const steps = [];
      for (let t = 0; t < total; t += 4) {
        for (const a of animations) a.currentTime = t;
        const [a, b] = getComputedStyle(strip).transform.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number);
        const box = shade.getBoundingClientRect();
        steps.push({ t, angle: (Math.atan2(b, a) * 180) / Math.PI, stripTop: strip.getBoundingClientRect().top, shade: [box.left, box.top, box.width, box.height] });
      }
      for (const a of animations) a.currentTime = 0;
      window.__steps = { count: animations.length, total, steps };
      return onFeedStart(...args);
    };
  });
  await page.locator('.print-btn').click();
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });
  const { count, steps } = await page.evaluate(() => window.__steps);
  expect(count, 'one animation on the strip and one on the shadow').toBe(2);
  expect(steps.length).toBeGreaterThan(300);
  expect(steps.some((s) => s.angle < -3), 'the steps include the turn in the air').toBe(true);
  const start = steps[0].shade;
  // Until the paper's top edge has dropped below the shadow; after that the shadow is not on the paper any more.
  const under = steps.filter((s) => s.stripTop < start[1] + start[3]);
  expect(under.length).toBeGreaterThan(250);
  for (const s of under) {
    s.shade.forEach((v, i) => expect(Math.abs(v - start[i]), `at ${s.t} ms: shade box ${s.shade} vs ${start}`).toBeLessThanOrEqual(0.25));
  }
});

test('lands tilted on the ledge', async ({ page }) => {
  await printAndSample(page);
  await expectRestPose(page);
});

test('reduced motion ends in the same pose', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator('.print-btn').click();
  await expect(page.locator('.booth')).toHaveAttribute('data-state', 'printed', { timeout: 10_000 });
  await expectRestPose(page);
});

test('a strip photo with a different ratio still starts hidden and lands on the ledge', async ({ page }) => {
  const body = await sharp({ create: { width: 440, height: 1300, channels: 3, background: '#d8c8a8' } })
    .webp()
    .toBuffer();
  await page.route('**/assets/strip.webp', (r) => r.fulfill({ body, contentType: 'image/webp' }));
  const feed = await printAndSample(page);
  expectHiddenStart(feed);
  await expectRestPose(page);
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

  test('only the strip photo is exposed to assistive tech', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.strip img')).toBeVisible();
    const snapshot = await page.locator('.slot').ariaSnapshot();
    expect(snapshot).toContain(`img "${STRIP_NAME}"`);
    expect(snapshot).not.toContain('Save the Date');
    const lines = snapshot.split('\n').filter((l) => l.trim());
    expect(lines, snapshot).toHaveLength(1);
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
