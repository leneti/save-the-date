// Offline render of the champagne tray -> site/assets/tray.webp.  Run: npm run tray  (about 5 minutes on 4 cores)
// A CPU path tracer in plain Node (scripts/tray/tracer.mjs): no GPU, no browser, no downloaded assets.
// The result is deterministic: every pixel has its own fixed random seed.
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { TRAY, PANEL, OPENING } from './tray/geometry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'site/assets/tray.webp');

const srgbToLinear = (hex) => [1, 3, 5].map((i) => {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
});

// ------------ parameters (CSS px; colours are linear RGB) ------------
export const CFG = {
  W: TRAY.W, H: TRAY.H,
  // Where the pocket's rim and its fold lines land in the image. The camera sits 12 degrees above the tray,
  // which is what makes the bottom wall look deeper than the top one.
  opening: { l: OPENING.left, t: OPENING.top, r: OPENING.right, b: OPENING.bottom },
  back: { l: PANEL.left, t: PANEL.top, r: PANEL.right, b: PANEL.bottom },
  camDist: 1500, camTilt: 12,
  // ---- frame: an outer flange (h1) and a raised inner lip (h2), both with rounded edges ----
  frameInset: 0.6, outerRadius: 7,
  step: 6.4, h1: 3.0, e1: 1.3, slope1: 0, crown: 0.5, h2: 5.0, e2: 1.9, kStep: 0.5, rl: 1.5,
  // ---- pocket: one pressed sheet, rf is the fold radius ----
  depth: 34, rf: 5,
  maxBounces: 7, maxRadiance: 14,
  wallColor: srgbToLinear('#37412c').map((v) => v * 0.9), // the olive wall the frame sits on (--olive)
  // ---- studio: a warm room with a dark band at eye level, and four softboxes (pos is the centre, in the tray's
  //      own coordinates: x right, y down, z toward the viewer; each one faces the tray) ----
  dome: { ceil: [0.95, 0.84, 0.66], horizon: [0.035, 0.03, 0.024], floor: [0.11, 0.09, 0.065], front: [0, 0, 0], t: [-0.62, -0.4, 0.2, 0.42] },
  softboxes: [
    { pos: [-82, -99, 1370], size: [720, 660], i: 3.0, color: [1, 0.96, 0.88], soft: 0.45 }, // window, just above the viewer: the interior's hotspot and the shadow under the top wall
    { pos: [-212, -699, 900], size: [520, 300], i: 9.0, color: [1, 0.95, 0.86], soft: 0.15 }, // key, high: glints on rounded edges
    { pos: [1038, 51, 520], size: [140, 900], i: 5.0, color: [1, 0.93, 0.82], soft: 0.2 }, // strip light, right
    { pos: [-912, 301, 620], size: [110, 800], i: 2.6, color: [1, 0.9, 0.76], soft: 0.2 }, // strip light, left (dimmer)
  ],
  // ---- champagne: warm nickel silver. f0 is the metal's colour; at / ab are the roughness along and across the brushing ----
  frameMat: { f0: [0.90, 0.84, 0.72], at: 0.035, ab: 0.06, brush: 'run', streak: 0, streakLen: 0.02, f1: 1.4, f2: 4.2, wavy: 0.006, wavyF: 0.05 },
  // The interior is the same metal with a darker finish, so the light engraving and the paper stand out against it.
  // back: the back panel's colour as a share of f0 (it is a little darker than the walls).
  interiorMat: { f0: [0.38, 0.345, 0.28], back: 0.75, at: 0.08, ab: 0.26, streak: 0.03, streakLen: 0.012, f1: 1.4, f2: 4.2, wavy: 0.008, wavyF: 0.035, foldRough: 0.12 },
  tone: { exposure: 1.0 },
  // Extra shadow under the top wall, on the interior only: `strength` at the opening's top edge, fading to nothing
  // `reach` px further down. The strip gets the same shadow in CSS (.tray-shade).
  topShade: { strength: 0.7, reach: 110 },
};

// A copy of the configuration with some values replaced (nested objects are merged, arrays replaced).
export const withConfig = (base, over) => {
  const out = { ...base };
  for (const k in over) out[k] = over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && base[k] ? withConfig(base[k], over[k]) : over[k];
  return out;
};

// Removes sampling noise by averaging along the brushing direction only, stopping at folds and edges.
// Brushed metal smears its own reflections the same way, so the streaks and the edges stay sharp.
function denoise(lin, aux, width, height, radius) {
  const out = new Float32Array(lin.length);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const p = j * width + i, a = lin[p * 4 + 3];
    if (a <= 0) continue;
    let tx = aux[p * 8 + 4], ty = aux[p * 8 + 5];
    const tl = Math.hypot(tx, ty);
    if (tl < 0.25) { tx = 1; ty = 0; } else { tx /= tl; ty /= tl; }
    const nx = aux[p * 8], ny = aux[p * 8 + 1], nz = aux[p * 8 + 2], z = aux[p * 8 + 3];
    let r = 0, g = 0, b = 0, ws = 0;
    for (let k = -radius; k <= radius; k++) {
      const x = Math.round(i + k * tx), y = Math.round(j + k * ty);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const q = y * width + x, aq = lin[q * 4 + 3];
      if (aq <= 0) continue;
      const dn = 1 - (nx * aux[q * 8] + ny * aux[q * 8 + 1] + nz * aux[q * 8 + 2]), dz = Math.abs(z - aux[q * 8 + 3]);
      const w = Math.exp(-k * k / (0.5 * radius * radius)) * Math.exp(-dn / 0.004) * Math.exp(-dz / 0.6) * aq;
      r += lin[q * 4] * w; g += lin[q * 4 + 1] * w; b += lin[q * 4 + 2] * w; ws += w;
    }
    out[p * 4] = r / ws; out[p * 4 + 1] = g / ws; out[p * 4 + 2] = b / ws; out[p * 4 + 3] = a;
  }
  return out;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const aces = (x) => { x = Math.max(0, x); return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); };
const oetf = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

// Traces the tray and returns straight-alpha RGBA pixels (transparent outside the frame).
export async function tracePixels({ scale = 3, spp = 144, cfg = CFG } = {}) {
  const width = cfg.W * scale, height = cfg.H * scale;
  const shared = new SharedArrayBuffer(width * height * 4 * 4);
  const sharedAux = new SharedArrayBuffer(width * height * 8 * 4);
  const n = Math.max(1, os.cpus().length);
  const workerFile = join(root, 'scripts/tray/worker.mjs');
  await Promise.all(Array.from({ length: n }, (_, id) => new Promise((resolve, reject) => {
    const w = new Worker(workerFile, { workerData: { cfg, scale, spp, id, n, shared, sharedAux } });
    w.on('message', (m) => { if (m.done) resolve(); });
    w.on('error', reject);
  })));
  const aux = new Float32Array(sharedAux);
  const lin = denoise(new Float32Array(shared), aux, width, height, Math.round(2.2 * scale));
  const data = Buffer.alloc(width * height * 4);
  const shade = cfg.topShade || { strength: 0, reach: 1 };
  for (let i = 0; i < width * height; i++) {
    // aux[6] is how much of the pixel is interior (0 on the frame).
    const below = clamp01((Math.floor(i / width) / scale - cfg.opening.t) / shade.reach);
    const gain = cfg.tone.exposure * (1 - shade.strength * aux[i * 8 + 6] * (1 - below) ** 2);
    for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round(255 * oetf(aces(lin[i * 4 + c] * gain)));
    data[i * 4 + 3] = Math.round(255 * lin[i * 4 + 3]);
  }
  return { data, width, height };
}

export async function renderTray(out = OUT, options) {
  const { data, width, height } = await tracePixels(options);
  return sharp(data, { raw: { width, height, channels: 4 } }).webp({ quality: 86, alphaQuality: 92, effort: 6 }).toFile(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { width, height, size } = await renderTray();
  console.log(`wrote ${OUT} ${width}x${height} ${size} bytes`);
}
