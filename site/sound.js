// Web Audio sound and Android vibration. Every failure is swallowed: the print sequence must never depend on audio.

const noop = () => {};

export function createSound(urls) {
  let ctx = null;
  let started = false;
  const buffers = new Map();

  function context() {
    if (ctx) return ctx;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  }

  async function load(c, name, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      // Callback form as a fallback for old WebKit, where decodeAudioData does not return a promise.
      const buffer = await new Promise((resolve, reject) => {
        const maybe = c.decodeAudioData(bytes, resolve, reject);
        if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
      });
      if (buffer) buffers.set(name, buffer);
    } catch {
      // Missing or undecodable file: that sound stays silent.
    }
  }

  function preload() {
    if (started) return;
    started = true;
    try {
      const c = context();
      if (!c) return;
      for (const [name, url] of Object.entries(urls)) load(c, name, url).catch(noop);
    } catch {
      // Silent.
    }
  }

  function unlock() {
    try {
      const c = context();
      const p = c?.resume?.();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch {
      // Silent.
    }
  }

  function play(name, opts = {}) {
    try {
      const buffer = buffers.get(name);
      const c = ctx;
      if (!buffer || !c) return noop;
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.loop = Boolean(opts.loop);
      src.connect(c.destination);
      src.start(0);
      let stopped = false;
      return () => {
        if (stopped) return;
        stopped = true;
        try {
          src.stop();
        } catch {
          // Already stopped.
        }
      };
    } catch {
      return noop;
    }
  }

  return { preload, unlock, play };
}

export function vibrate(pattern) {
  try {
    if (typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
  } catch {
    // iOS has no vibration; some browsers throw without a user gesture.
  }
}
