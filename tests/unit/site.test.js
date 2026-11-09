import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import sharp from 'sharp';
import { SITE_URL, googleCalendarUrl } from '../../site/calendar.js';

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
