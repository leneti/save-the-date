import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { SITE_URL, googleCalendarUrl } from '../../site/calendar.js';
import { TRAY, PANEL, OPENING, STRIP_REST, pct } from '../../scripts/tray/geometry.mjs';

const siteDir = new URL('../../site/', import.meta.url).pathname;
const html = readFileSync(join(siteDir, 'index.html'), 'utf8');
const decode = (s) => s.replace(/&amp;/g, '&');

function meta(attr, name) {
  const re = new RegExp(`<meta\\s+${attr}="${name}"\\s+content="([^"]*)"`);
  const m = html.match(re);
  assert.ok(m, `missing <meta ${attr}="${name}">`);
  return decode(m[1]);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
}

test('og tags are complete and use SITE_URL', () => {
  assert.equal(meta('property', 'og:title'), 'Save the Date · Emilija & Dominykas');
  assert.equal(meta('property', 'og:description'), '2027.08.20');
  assert.equal(meta('property', 'og:type'), 'website');
  assert.equal(meta('property', 'og:locale'), 'lt_LT');
  assert.equal(meta('property', 'og:url'), SITE_URL + '/');
  assert.equal(meta('property', 'og:image'), SITE_URL + '/assets/og-image.jpg');
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
});

test('every absolute URL in index.html is SITE_URL or Google Calendar', () => {
  const urls = html.match(/https?:\/\/[^\s"'<>]*/g) ?? [];
  assert.ok(urls.length > 0);
  for (const u of urls) {
    assert.ok(u.startsWith(SITE_URL) || u.startsWith('https://calendar.google.com/'), `unexpected URL: ${u}`);
  }
});

test('static google link matches googleCalendarUrl()', () => {
  const m = html.match(/class="cal-secondary"\s+href="([^"]*)"/);
  assert.ok(m);
  assert.equal(decode(m[1]), googleCalendarUrl());
});

test('og-image.jpg is 1200×630 JPEG ≤ 300KB', async () => {
  const file = join(siteDir, 'assets/og-image.jpg');
  const { format, width, height } = await sharp(file).metadata();
  assert.equal(format, 'jpeg');
  assert.equal(width, 1200);
  assert.equal(height, 630);
  assert.ok(statSync(file).size <= 300 * 1024);
});

test('site/ stays under 1,000,000 bytes', () => {
  const total = walk(siteDir).reduce((n, f) => n + statSync(f).size, 0);
  assert.ok(total < 1_000_000, `site/ is ${total} bytes`);
});

test('site/ contains only shippable files', () => {
  for (const f of walk(siteDir)) {
    const rel = relative(siteDir, f).split(sep).join('/');
    assert.ok(!rel.endsWith('.map'), rel);
    assert.ok(!rel.split('/').some((p) => p === 'node_modules' || /test/i.test(p)), rel);
    if (rel.endsWith('.md')) assert.equal(rel, 'assets/sounds/CREDITS.md');
  }
});

test('every strip <img> width/height attributes match strip.webp', async () => {
  const { width, height } = await sharp(join(siteDir, 'assets/strip.webp')).metadata();
  const imgs = [...html.matchAll(/<img\b[^>]*\bsrc="assets\/strip\.webp"[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length > 0);
  for (const tag of imgs) {
    assert.equal(tag.match(/\bwidth="(\d+)"/)?.[1], String(width), tag);
    assert.equal(tag.match(/\bheight="(\d+)"/)?.[1], String(height), tag);
  }
});

test('preloaded fonts exist, and josefin 600 latin-ext (the plate "ą") is preloaded', () => {
  const hrefs = [...html.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.includes('assets/fonts/josefin-sans-600-latin-ext.woff2'), hrefs.join(', '));
  for (const h of hrefs) assert.ok(statSync(join(siteDir, h)).size > 0, h);
});

test('slot geometry in styles.css matches geometry.mjs', () => {
  const css = readFileSync(join(siteDir, 'styles.css'), 'utf8');
  const token = (name) => {
    const m = css.match(new RegExp(`${name}:\\s*(-?[\\d.]+)(%|deg)`));
    assert.ok(m, `missing ${name}`);
    return { value: Number(m[1]), unit: m[2] };
  };
  const expected = {
    '--panel-l': pct(PANEL.left, TRAY.W),
    '--panel-r': pct(TRAY.W - PANEL.right, TRAY.W),
    '--panel-t': pct(PANEL.top, TRAY.H),
    '--panel-b': pct(TRAY.H - PANEL.bottom, TRAY.H),
    '--clip-l': pct(OPENING.left, TRAY.W),
    '--clip-r': pct(TRAY.W - OPENING.right, TRAY.W),
    '--clip-t': pct(PANEL.top, TRAY.H),
    '--clip-b': pct(TRAY.H - OPENING.bottom, TRAY.H),
    '--strip-rest-bottom': pct((OPENING.bottom - STRIP_REST.bottomPx) / (OPENING.bottom - PANEL.top), 1),
  };
  for (const [name, want] of Object.entries(expected)) {
    const { value, unit } = token(name);
    assert.equal(unit, '%', name);
    assert.ok(Math.abs(value - want) <= 0.01, `${name}: css ${value}, geometry ${want}`);
  }
  const rot = token('--strip-rest-rot');
  assert.equal(`${rot.value}${rot.unit}`, `${STRIP_REST.rotateDeg}deg`);
});

test('the strip width follows --strip-rest-w, a share of the slot width that matches geometry.mjs', () => {
  const css = readFileSync(join(siteDir, 'styles.css'), 'utf8');
  const m = css.match(/--strip-rest-w:\s*(-?[\d.]+)\s*;/);
  assert.ok(m, 'missing a unitless --strip-rest-w');
  assert.ok(Math.abs(Number(m[1]) - STRIP_REST.widthPx / TRAY.W) <= 0.0001, `--strip-rest-w is ${m[1]}`);
  const rule = css.match(/\n\.strip\s*\{([^}]*)\}/);
  assert.ok(rule, 'missing the .strip rule');
  assert.match(rule[1], /width:\s*calc\(var\(--slot-w\)\s*\*\s*var\(--strip-rest-w\)\)/, '.strip must read --strip-rest-w');
});

test('the feed start in app.js uses the same geometry as geometry.mjs', () => {
  const js = readFileSync(join(siteDir, 'app.js'), 'utf8');
  const m = js.match(/\*\s*\(\s*([\d.]+)\s*-\s*([\d.]+)\s*\)\s*\)\s*\/\s*([\d.]+)/);
  assert.ok(m, 'could not find the startY literals in feedAnimation');
  assert.equal(Number(m[1]), STRIP_REST.bottomPx, 'rest bottom edge');
  assert.equal(Number(m[2]), PANEL.top, 'panel top');
  assert.equal(Number(m[3]), TRAY.H, 'tray height');
});
