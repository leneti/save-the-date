import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIcs } from '../../site/calendar.js';

test('committed .ics equals buildIcs() byte-for-byte', () => {
  assert.equal(readFileSync(new URL('../../site/save-the-date.ics', import.meta.url), 'utf8'), buildIcs());
});
test('netlify.toml serves the .ics as text/calendar attachment and publishes site/', () => {
  const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');
  assert.match(toml, /publish\s*=\s*"site"/);
  assert.match(toml, /for\s*=\s*"\/save-the-date\.ics"/);
  assert.match(toml, /Content-Type\s*=\s*"text\/calendar; charset=utf-8"/);
  assert.match(toml, /Content-Disposition\s*=\s*'attachment; filename="emilijos-ir-dominyko-vestuves\.ics"'/);
});
