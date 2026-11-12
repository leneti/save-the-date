import { feedKeyframes, feedSchedule } from './feed.js';
import { createSound, vibrate } from './sound.js';

// All durations in ms. The CSS custom properties below are derived from these, so one object tunes everything.
export const TIMINGS = {
  press: 120,
  countStart: 200,
  countStep: 700,
  flashAt: 2300,
  flashUp: 60,
  flashHold: 80,
  flashFade: 400,
  feedAt: 3100,
  // The feed (feed.js): eight pushes, two per photo, then the strip hangs for a moment, falls and settles.
  pushes: 8,
  pushMove: 140,
  pushPause: 70,
  hang: 90,
  fall: 300,
  settle: 260,
  revealStagger: 200,
  revealFade: 400,
  reducedStripFade: 600,
};

const sound = createSound({
  tick: 'assets/sounds/tick.mp3',
  shutter: 'assets/sounds/shutter.mp3',
  whirr: 'assets/sounds/whirr.mp3',
  clunk: 'assets/sounds/clunk.mp3',
});
let stopWhirr = () => {};

// Sound and vibration hang off these. Every call is guarded, so a throwing hook never stops the print.
export const hooks = {
  onPress() {
    sound.unlock(); // inside the user gesture
    sound.preload(); // no-op if the idle preload already started
    sound.play('tick');
    vibrate(15);
  },
  onTick() { sound.play('tick'); },
  onFlash() { sound.play('shutter'); },
  onFeedStart() { stopWhirr = sound.play('whirr', { loop: true }); },
  onJerk() { vibrate(25); }, // each push
  onMotorStop() {
    stopWhirr();
    stopWhirr = () => {};
  },
  onLand() {
    stopWhirr(); // already stopped, unless the motor hook failed
    stopWhirr = () => {};
    sound.play('clunk');
    vibrate(40);
  },
};

// Fetch and decode the sounds when the browser is idle.
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => sound.preload());
else setTimeout(() => sound.preload(), 200);

const FEED = feedSchedule(TIMINGS);
const ANNOUNCEMENT = 'Emilija & Dominykas, 2027.08.20';

function callHook(name, ...args) {
  try {
    const result = hooks[name]?.(...args);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // A failing hook (audio, vibration) must never interrupt the sequence.
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const booth = document.querySelector('.booth');
const $ = (selector) => booth.querySelector(selector);

function applyTimingVars() {
  const s = booth.style;
  s.setProperty('--press-ms', `${TIMINGS.press}ms`);
  s.setProperty('--reveal-ms', `${TIMINGS.revealFade}ms`);
  s.setProperty('--reveal-stagger', `${TIMINGS.revealStagger}ms`);
  s.setProperty('--feed-ms', `${FEED.motorStop}ms`);
  s.setProperty('--reduced-fade-ms', `${TIMINGS.reducedStripFade}ms`);
}

// Purely decorative WAAPI call. fill is 'none' unless asked otherwise, so a cancelled or unsupported animation leaves
// the CSS state intact.
function animate(el, keyframes, options) {
  try {
    el.animate(keyframes, { fill: 'none', ...options });
  } catch {
    // Decoration only.
  }
}

function flashAnimation() {
  const { flashUp, flashHold, flashFade } = TIMINGS;
  const total = flashUp + flashHold + flashFade;
  animate(
    $('.flash'),
    [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: flashUp / total, easing: 'linear' },
      { opacity: 1, offset: (flashUp + flashHold) / total, easing: 'ease-out' },
      { opacity: 0, offset: 1 },
    ],
    { duration: total },
  );
}

// The strip emerges from under the top wall (the clip hides it) in short pushes with no rotation, then drops: it
// turns as it falls, one corner meets the ledge and the tilt settles (feed.js). The top wall's shadow lives inside the
// strip and gets the inverse motion, so it stays put under the wall while the paper slides and turns through it.
function feedAnimation(strip) {
  const root = getComputedStyle(document.documentElement);
  const slotHeight = $('.slot').getBoundingClientRect().height;
  const poses = feedKeyframes({
    // From the rest pose's bottom edge on the clip top (design y 22) to rest (design y 379.3), whatever the strip's height.
    travel: (slotHeight * (379.3 - 22)) / 403,
    free: strip.offsetTop,
    w: strip.offsetWidth,
    h: strip.offsetHeight,
    rest: parseFloat(root.getPropertyValue('--strip-rest-rot')) || -2.2,
    unit: slotHeight / 403,
  }, TIMINGS);
  const frames = (transform) => poses.map(({ offset, easing, ...pose }) => ({ transform: transform(pose), offset, easing }));
  // The last keyframe is the rest pose, and the animation holds it: at the moment an animation without a fill
  // ends, WebKit can show its first keyframe for one frame (the strip would flash back to the top).
  animate(strip, frames(({ y, deg }) => `translateX(-50%) translateY(${y}px) rotate(${deg}deg)`), { duration: FEED.total, fill: 'forwards' });
  const shade = strip.querySelector('.tray-shade');
  if (shade) {
    shade.style.transformOrigin = `50% ${strip.offsetHeight / 2 - shade.offsetTop}px`; // the strip's centre
    animate(shade, frames(({ y, deg }) => `rotate(${-deg}deg) translateY(${-y}px)`), { duration: FEED.total });
  }
}

// The layout follows --vh instead of the live viewport height. In-app browsers (Messenger on iOS) resize the page
// frame by frame while their toolbar slides away, which made the whole booth grow and shrink during a scroll. On
// touch screens the height is therefore only taken over when the width changes (rotation) or when it gets smaller;
// with a mouse (a desktop window being resized) it always follows.
function trackViewportHeight() {
  const root = document.documentElement;
  const touch = window.matchMedia('(pointer: coarse)').matches;
  let width = window.innerWidth;
  let height = window.innerHeight;
  const apply = () => root.style.setProperty('--vh', `${height}px`);
  apply();
  window.addEventListener('resize', () => {
    if (touch && window.innerWidth === width && window.innerHeight >= height) return;
    width = window.innerWidth;
    height = window.innerHeight;
    apply();
  });
}

let running = false;

async function runSequence(reduced) {
  const t0 = performance.now();
  // Absolute schedule from the press, so timer drift never accumulates.
  const until = (ms) => sleep(Math.max(0, t0 + ms - performance.now()));
  const strip = $('.strip');
  const count = $('.plate-count');
  const { countStart, countStep, flashAt, feedAt } = TIMINGS;

  booth.dataset.state = 'countdown';

  for (let n = 3; n >= 1; n--) {
    await until(countStart + (3 - n) * countStep);
    count.textContent = String(n);
    callHook('onTick', n);
  }

  await until(flashAt);
  if (!reduced) {
    booth.dataset.state = 'flash';
    flashAnimation();
  }
  callHook('onFlash');

  await until(feedAt);
  booth.dataset.state = 'printing';
  if (!reduced) feedAnimation(strip);
  callHook('onFeedStart');

  const events = [
    ...FEED.pushTimes.map((at, i) => ({ at, hook: 'onJerk', arg: i })),
    { at: FEED.motorStop, hook: 'onMotorStop' },
    { at: FEED.land, hook: 'onLand' },
  ];
  for (const event of events) {
    if (event.at > 0) await until(feedAt + event.at);
    callHook(event.hook, event.arg);
  }

  await until(feedAt + FEED.total);
  finish();
}

// The printed tail, shared by the normal path and the catch-all fallback.
function finish() {
  booth.dataset.state = 'printed';
  $('#announce').textContent = ANNOUNCEMENT;
  // The print button is hidden now, so keyboard focus would fall to <body>. Hand it to the heading instead.
  const active = document.activeElement;
  if (!active || active === document.body || active === $('.print-btn')) $('.names').focus({ preventScroll: true });
}

function start() {
  if (booth.dataset.state !== 'idle' || running) return;
  running = true;
  // Synchronous, inside the user gesture: Task 7 unlocks the AudioContext here.
  callHook('onPress');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  runSequence(reduced).catch(() => {
    // Whatever went wrong, never strand the visitor mid-sequence.
    finish();
  });
}

applyTimingVars();
trackViewportHeight();
for (const el of booth.querySelectorAll('.print-btn, [data-trigger]')) el.addEventListener('click', start);
