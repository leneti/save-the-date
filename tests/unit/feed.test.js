import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedKeyframes, feedPose, feedSchedule, onLedge } from '../../site/feed.js';

// The feed timings as app.js has them (app.js needs a DOM, so they are read from its source).
const source = readFileSync(new URL('../../site/app.js', import.meta.url), 'utf8');
const timing = (name) => {
  const m = source.match(new RegExp(`\\b${name}:\\s*(\\d+),`));
  assert.ok(m, `TIMINGS.${name} not found in app.js`);
  return Number(m[1]);
};
const T = Object.fromEntries(['pushes', 'pushMove', 'pushPause', 'hang', 'fall', 'settle'].map((n) => [n, timing(n)]));

// A 390 x 844 phone: the slot is 240 px wide, the strip 114.5 x 416.5 px.
const unit = 240 / 176;
const G = { travel: (379.3 - 22) * unit, free: 78, w: 114.5, h: 416.5, rest: -2.2, unit };

test('the schedule: pushes, then the motor stops, the strip is released, lands and settles', () => {
  const s = feedSchedule(T);
  assert.equal(s.pushTimes.length, T.pushes);
  assert.equal(s.pushTimes[0], 0);
  assert.equal(s.pushTimes[1], T.pushMove + T.pushPause);
  assert.equal(s.motorStop, s.pushTimes.at(-1) + T.pushMove);
  assert.equal(s.release, s.motorStop + T.hang);
  assert.equal(s.land, s.release + T.fall);
  assert.equal(s.total, s.land + T.settle);
});

test('the print is quick and stutters more than once per photo', () => {
  const s = feedSchedule(T);
  assert.ok(T.pushes >= 8, `${T.pushes} pushes for 4 photos`);
  assert.ok(s.total <= 2400, `the feed takes ${s.total} ms`);
});

test('the strip starts hidden and ends exactly in its rest pose', () => {
  const frames = feedKeyframes(G, T);
  assert.deepEqual({ y: frames[0].y, deg: frames[0].deg, offset: frames[0].offset }, { y: -G.travel, deg: 0, offset: 0 });
  const last = frames.at(-1);
  assert.deepEqual({ y: last.y, deg: last.deg, offset: last.offset }, { y: 0, deg: G.rest, offset: 1 });
});

test('keyframe offsets rise strictly from 0 to 1, with one at every sharp event', () => {
  const s = feedSchedule(T);
  const frames = feedKeyframes(G, T);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].offset > frames[i - 1].offset, `offset ${i}`);
  const offsets = frames.map((f) => f.offset);
  for (const at of [...s.pushTimes, ...s.pushTimes.map((p) => p + T.pushMove), s.release, s.land]) {
    assert.ok(offsets.some((o) => Math.abs(o - at / s.total) < 1e-9), `no keyframe at ${at} ms`);
  }
});

test('while the printer pushes the strip only moves down, in steps, without turning', () => {
  const s = feedSchedule(T);
  let previous = -Infinity;
  for (let ms = 0; ms <= s.release; ms += 1) {
    const { y, deg } = feedPose(G, T, ms);
    assert.equal(deg, 0, `turned at ${ms} ms`);
    assert.ok(y >= previous - 1e-9, `moved up at ${ms} ms`);
    previous = y;
  }
  // Each push moves the same distance and then the strip waits.
  const step = T.pushMove + T.pushPause;
  const each = feedPose(G, T, step).y - feedPose(G, T, 0).y;
  assert.ok(each > 0);
  for (let i = 0; i < T.pushes; i++) {
    const end = feedPose(G, T, i * step + T.pushMove).y;
    assert.ok(Math.abs(end - (-G.travel + (i + 1) * each)) < 1e-6, `push ${i}`);
    assert.ok(Math.abs(feedPose(G, T, i * step + T.pushMove + T.pushPause / 2).y - end) < 1e-9, `pause ${i}`);
  }
});

test('the rollers let go while the top edge is still under the top wall', () => {
  const s = feedSchedule(T);
  const { y } = feedPose(G, T, s.release);
  assert.ok(y < -G.free, `released at ${y}, the top edge clears the wall at ${-G.free}`);
  assert.ok(y > -G.free - 12 * G.unit, 'but not far above it');
});

test('the fall speeds up, and the lowest corner never goes below the ledge', () => {
  const s = feedSchedule(T);
  let previousSpeed = 0;
  for (let ms = s.release + 10; ms <= s.land; ms += 10) {
    const speed = feedPose(G, T, ms).y - feedPose(G, T, ms - 10).y;
    assert.ok(speed > previousSpeed, `slowed down at ${ms} ms`);
    previousSpeed = speed;
  }
  for (let ms = 0; ms <= s.total; ms += 1) {
    const { y, deg } = feedPose(G, T, ms);
    assert.ok(y <= onLedge(G, deg) + 1e-6, `below the ledge at ${ms} ms: y ${y}, tilt ${deg}`);
  }
});

test('the strip lands corner first, tilted more than at rest, and the tilt settles without swinging back', () => {
  const s = feedSchedule(T);
  const hit = feedPose(G, T, s.land);
  assert.ok(hit.deg < G.rest, `tilt at impact ${hit.deg}`);
  assert.ok(Math.abs(hit.y - onLedge(G, hit.deg)) < 1e-6, 'the corner is on the ledge at impact');
  let previous = hit.deg;
  for (let ms = s.land + 1; ms <= s.total; ms += 1) {
    const { y, deg } = feedPose(G, T, ms);
    assert.ok(deg >= previous - 1e-9 && deg <= G.rest + 1e-9, `tilt ${deg} at ${ms} ms`);
    assert.ok(Math.abs(y - onLedge(G, deg)) < 1e-6, `corner off the ledge at ${ms} ms`);
    previous = deg;
  }
  // No visible jump onto the final keyframe.
  const nearEnd = feedPose(G, T, s.total - 1);
  assert.ok(Math.abs(nearEnd.deg - G.rest) < 0.03 && Math.abs(nearEnd.y) < 0.1, `just before the end: ${JSON.stringify(nearEnd)}`);
});
