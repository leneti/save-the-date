// The strip's feed motion: the printer pushes the strip out in short steps until the rollers let go, then the strip
// drops onto the ledge. Pure functions, no DOM. Times are ms, lengths CSS px, angles degrees (negative =
// anticlockwise, like --strip-rest-rot).

// The rollers sit behind the top wall: they let go while the strip's top edge is still this far out of sight
// (design px, the tray is 403 tall).
const HIDE = 8;
// The corner hits the ledge with this much more tilt than the strip rests at, then the tilt relaxes.
const OVER = 1.4;

// When things happen, counted from the start of the feed. t is TIMINGS from app.js:
//   pushes, pushMove, pushPause   how many pushes, and how long each one moves and then waits
//   hang, fall, settle            the wait before the fall, the fall, and the tilt settling
export function feedSchedule(t) {
  const step = t.pushMove + t.pushPause;
  const motorStop = (t.pushes - 1) * step + t.pushMove; // the last push ends: the whirr stops
  const release = motorStop + t.hang; // the strip starts to fall
  const land = release + t.fall; // its corner meets the ledge: the clunk
  return {
    pushTimes: Array.from({ length: t.pushes }, (_, i) => i * step),
    motorStop,
    release,
    land,
    total: land + t.settle,
  };
}

function bezier(x1, y1, x2, y2) {
  const at = (a, b, s) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid; else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const pushEase = bezier(0.2, 0.8, 0.3, 1); // fast out of the rollers, then creeping
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const rad = (deg) => (deg * Math.PI) / 180;

// How far the lowest corner of a strip tilted by deg lies below the strip's centre.
const reach = (g, deg) => (g.w / 2) * Math.abs(Math.sin(rad(deg))) + (g.h / 2) * Math.cos(rad(deg));
// The y offset at which a strip tilted by deg stands on the ledge with its lowest corner (0 at the resting tilt).
export const onLedge = (g, deg) => reach(g, g.rest) - reach(g, deg);

// The strip's pose at time ms. y is the offset from rest (negative = up), the rotation is about the strip's centre.
// geometry g:
//   travel  how far the strip moves from hidden (its bottom edge at the top wall) to rest
//   free    how far above rest the strip is when its top edge is level with the top wall's edge
//   w, h    the strip's size
//   rest    the resting tilt
//   unit    CSS px per design px
export function feedPose(g, t, ms) {
  const s = feedSchedule(t);
  const step = t.pushMove + t.pushPause;
  const yFree = -(g.free + HIDE * g.unit);
  if (ms <= s.release) {
    const each = (g.travel + yFree) / t.pushes;
    const i = Math.floor(ms / step);
    const fed = i >= t.pushes ? t.pushes * each : each * (i + pushEase(clamp01((ms - i * step) / t.pushMove)));
    return { y: -g.travel + fed, deg: 0 };
  }
  const hitDeg = g.rest * OVER;
  if (ms <= s.land) {
    // Free fall: the distance grows with the square of the time, and the strip turns as it goes.
    const u = (ms - s.release) / t.fall;
    return { y: yFree + (onLedge(g, hitDeg) - yFree) * u * u, deg: hitDeg * u ** 1.5 };
  }
  if (ms >= s.total) return { y: 0, deg: g.rest };
  // The corner stays on the ledge while the tilt relaxes (critically damped) to its resting value.
  const tau = t.settle / 6;
  const since = ms - s.land;
  const deg = g.rest + (hitDeg - g.rest) * (1 + since / tau) * Math.exp(-since / tau);
  return { y: onLedge(g, deg), deg };
}

// Keyframes for the Web Animations API: one per 60 Hz frame, plus one at each sharp event so those stay crisp.
// Each is { y, deg, offset, easing }.
export function feedKeyframes(g, t) {
  const s = feedSchedule(t);
  const times = new Set([...s.pushTimes.flatMap((at) => [at, at + t.pushMove]), s.release, s.land]
    .filter((at) => at > 0 && at < s.total));
  const n = Math.ceil(s.total / (1000 / 60));
  for (let i = 0; i <= n; i++) times.add(Math.round((i / n) * s.total * 100) / 100);
  return [...times].sort((a, b) => a - b).map((at) => ({ ...feedPose(g, t, at), offset: at / s.total, easing: 'linear' }));
}
