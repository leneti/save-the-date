import { calendarLinks } from './calendar.js';
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
  jerkMove: 450,
  jerkPause: 300,
  bounce: 200,
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
  onJerk() { vibrate(40); },
  onLand() {
    stopWhirr();
    stopWhirr = () => {};
    sound.play('clunk');
    vibrate(30);
  },
};

// Fetch and decode the sounds when the browser is idle.
if (typeof requestIdleCallback === 'function') requestIdleCallback(() => sound.preload());
else setTimeout(() => sound.preload(), 200);

const JERKS = 4;
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

function applyCalendarLinks() {
  const links = calendarLinks(navigator.userAgent);
  for (const [selector, link] of [['.cal-primary', links.primary], ['.cal-secondary', links.secondary]]) {
    const a = $(selector);
    a.href = link.href;
    a.textContent = link.label;
    if (link.external) {
      a.target = '_blank';
      a.rel = 'noopener';
    } else {
      a.removeAttribute('target');
      a.removeAttribute('rel');
    }
  }
}

function applyTimingVars() {
  const s = booth.style;
  s.setProperty('--press-ms', `${TIMINGS.press}ms`);
  s.setProperty('--reveal-ms', `${TIMINGS.revealFade}ms`);
  s.setProperty('--reveal-stagger', `${TIMINGS.revealStagger}ms`);
  s.setProperty('--feed-ms', `${JERKS * (TIMINGS.jerkMove + TIMINGS.jerkPause)}ms`);
  s.setProperty('--reduced-fade-ms', `${TIMINGS.reducedStripFade}ms`);
}

// Purely decorative WAAPI call. fill is 'none', so a cancelled or unsupported animation leaves the CSS state intact.
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

// The strip emerges from under the top wall (the clip hides it), jerks down in 4 steps with no rotation,
// then eases into its resting tilt during the landing bounce. The top wall's shadow lives inside the strip and
// moves the opposite way, so it stays put under the wall while the paper slides through it.
function feedAnimation(strip) {
  const { jerkMove, jerkPause, bounce } = TIMINGS;
  const step = jerkMove + jerkPause;
  const total = JERKS * step + bounce;
  const root = getComputedStyle(document.documentElement);
  // Travel from the rest pose's bottom edge on the clip top (design y 22) to rest (design y 379.3), whatever the strip's height.
  const startY = -($('.slot').getBoundingClientRect().height * (379.3 - 22)) / 403;
  const restRot = parseFloat(root.getPropertyValue('--strip-rest-rot')) || -2.2;
  const overshoot = 0.375 * parseFloat(root.fontSize);
  const at = (i) => startY * (1 - i / JERKS);
  const poses = []; // { y, deg, offset, easing }
  for (let i = 0; i < JERKS; i++) {
    poses.push({ y: at(i), deg: 0, offset: (i * step) / total, easing: 'cubic-bezier(.2, .8, .3, 1)' });
    poses.push({ y: at(i + 1), deg: 0, offset: (i * step + jerkMove) / total, easing: 'linear' });
  }
  poses.push({ y: at(JERKS), deg: 0, offset: (JERKS * step) / total, easing: 'ease-out' });
  poses.push({ y: overshoot, deg: restRot * 0.6, offset: (JERKS * step + bounce * 0.4) / total, easing: 'ease-in-out' });
  poses.push({ y: 0, deg: restRot, offset: 1 });
  const frames = (transform) => poses.map(({ offset, easing, ...pose }) => ({ transform: transform(pose), offset, ...(easing && { easing }) }));
  animate(strip, frames(({ y, deg }) => `translateX(-50%) translateY(${y}px) rotate(${deg}deg)`), { duration: total });
  const shade = strip.querySelector('.tray-shade');
  if (shade) animate(shade, frames(({ y }) => `translateY(${-y}px)`), { duration: total });
}

let running = false;

async function runSequence(reduced) {
  const t0 = performance.now();
  // Absolute schedule from the press, so timer drift never accumulates.
  const until = (ms) => sleep(Math.max(0, t0 + ms - performance.now()));
  const strip = $('.strip');
  const count = $('.plate-count');
  const { countStart, countStep, flashAt, feedAt, jerkMove, jerkPause, bounce } = TIMINGS;

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

  for (let i = 0; i < JERKS; i++) {
    if (i > 0) await until(feedAt + i * (jerkMove + jerkPause));
    callHook('onJerk', i);
  }

  const landAt = feedAt + JERKS * (jerkMove + jerkPause);
  await until(landAt);
  callHook('onLand');

  await until(landAt + bounce);
  finish();
}

// The printed tail, shared by the normal path and the catch-all fallback.
function finish() {
  booth.dataset.state = 'printed';
  $('.strip').disabled = false;
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

applyCalendarLinks();
applyTimingVars();
for (const el of booth.querySelectorAll('.print-btn, [data-trigger]')) el.addEventListener('click', start);

// ---------- Close-up ----------
// The dialog's `open` attribute is the "zoomed" state; data-state stays `printed`.
const zoom = document.querySelector('.zoom');
let closing = false;

function openZoom() {
  if (zoom.open || booth.dataset.state !== 'printed') return;
  if (typeof zoom.showModal !== 'function') return; // no <dialog> support: the strip is simply not zoomable
  const img = $('.strip img');
  if (img.complete && img.naturalWidth === 0) return; // the photo failed to load: nothing to show
  closing = false;
  zoom.showModal();
  history.pushState({ zoom: true }, '');
}

// One user-close path for tap, button and Escape. The flag stops a fast second close from calling history.back() twice.
function userClose() {
  if (!zoom.open || closing) return;
  closing = true;
  if (history.state?.zoom) history.back(); // popstate closes the dialog
  else zoom.close();
}

$('.strip').addEventListener('click', openZoom);
zoom.addEventListener('click', userClose); // the backdrop, the image and the button all land here
zoom.addEventListener('cancel', (e) => {
  e.preventDefault(); // Escape: take over, so the native close and ours never both run
  userClose();
});
zoom.addEventListener('close', () => { closing = false; });
window.addEventListener('popstate', () => { if (zoom.open) zoom.close(); });
