// Offline 3D render of the brass tray -> site/assets/tray.webp.  Run: npm run tray
// Headless Chromium + SwiftShader (no GPU needed); three.js is a devDependency and never shipped.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { TRAY } from './tray/geometry.mjs';

export const HDRI_URL = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr';
export const HDRI_SHA256 = 'e7cfda5f4e98e623db12b8bfd0184e048488e4855d9c83e2751fb44a32e80c45';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const trayDir = join(root, 'scripts/tray');
const cacheDir = join(trayDir, '.cache');
const hdriFile = join(cacheDir, 'studio_small_09_1k.hdr');
const OUT = join(root, 'site/assets/tray.webp');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function ensureHdri() {
  let buf = existsSync(hdriFile) ? await readFile(hdriFile) : null;
  if (!buf) {
    const res = await fetch(HDRI_URL);
    if (!res.ok) throw new Error(`HDRI download failed: ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) === HDRI_SHA256) {
      await mkdir(cacheDir, { recursive: true });
      await writeFile(hdriFile, buf);
    }
  }
  const got = sha256(buf);
  if (got !== HDRI_SHA256) throw new Error(`HDRI SHA-256 mismatch: expected ${HDRI_SHA256}, got ${got}`);
}

// ------------ parameters ------------
const CFG = {
  W: TRAY.W, H: TRAY.H, scale: 3,
  rim: TRAY.rim, wallTop: TRAY.wallTop, wallBottom: TRAY.wallBottom, wallSide: TRAY.wallSide, depth: 14,
  outerRadius: 7, bevel: 4, bevelSegments: 14, frameDepth: 2, frameTopZ: 3, holeRadius: 2,
  toneMapping: 'NeutralToneMapping', exposure: 1.0, envRotY: 3.1416,
  // ---- brass frame ----
  brassColor: '#d9c088', brassRough: 0.3, brassAniso: 0.6, brassEnv: 0.8,
  envTint: '#fff3e0', envSky: 0.9, envFloor: 0.08,
  softboxes: [ // procedural studio env behind the camera (+z). pos in env units, size w/h, intensity, colour
    { pos: [-28, 34, 30], size: [40, 22], i: 5.0, c: '#ffd9a0' },
    { pos: [34, 6, 30], size: [10, 60], i: 2.0, c: '#ffd0a0' },
    { pos: [0, -4, 46], size: [90, 30], i: 0.75, c: '#ffe0b0' },
  ],
  glintColor: '#ffe2b4', frameKey: 1.2, spots: [[40, 60, 40, 2.2], [140, 330, 40, 1.2]],
  contactFrame: 0.12, contactFramePx: 1.4, outerEdgeDark: 0.55,
  // ---- interior (dark smoked bronze) ----
  interiorColor: '#2d2820', ledgeColor: '#31281f', interiorMetal: 0.85, interiorRough: 0.45, interiorAniso: 0.5, interiorEnv: 1.0,
  gainTop: 0.6, gainBottom: 5.8, gainSide: 2.4, rightFactor: 0.8, gainBack: 1.7,
  envTop: 0.8, envBottom: 3.0, envSide: 1.5, envBack: 1.0,
  keyColor: '#fff6ea', keyIntensity: 1.5, ambient: 0.15,
  sheen: { x: 88, y: 285, z: 90, intensity: 1.7, color: '#ffe6c4' },
  brushAmp: 0.025, brushBand: 0.05,
  // ---- baked AO / soft shadow ----
  bakeSamples: 192, bakeBlur: 1.0, aoGamma: 1.8, aoDepthScale: 2.5,
  skyAmbient: 0.55, skyKey: 3.0, keyPower: 3, keyDir: [-0.3, 1, 0.3],
  contactDark: 0.35, contactPx: 1.2,
};

const mime = { '.js': 'text/javascript', '.html': 'text/html' };

// Serves scripts/tray/ at / and node_modules/three/ at /three/.
function serve() {
  const threeDir = join(root, 'node_modules/three');
  const srv = http.createServer((q, r) => {
    const url = decodeURIComponent(q.url.split('?')[0]);
    const p = url.startsWith('/three/') ? join(threeDir, url.slice(7))
      : join(trayDir, url === '/' ? 'page.html' : url);
    const base = url.startsWith('/three/') ? threeDir : trayDir;
    if (!p.startsWith(base) || !existsSync(p)) { r.statusCode = 404; return r.end(); }
    r.setHeader('content-type', mime[extname(p)] || 'application/octet-stream');
    createReadStream(p).pipe(r);
  });
  return new Promise((res) => srv.listen(0, () => res(srv)));
}

export async function renderTray(out = OUT) {
  await ensureHdri();
  const { chromium } = await import('@playwright/test');
  const srv = await serve();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: CFG.W * CFG.scale, height: CFG.H * CFG.scale } });
    page.on('console', (m) => console.log('[page]', m.text()));
    const failed = new Promise((_, rej) => page.on('pageerror', (e) => rej(new Error(`page error: ${e.message}`))));
    await page.addInitScript((c) => { window.CFG = c; }, CFG);
    await page.goto(`http://localhost:${srv.address().port}/`);
    await Promise.race([page.waitForFunction('window.__done', null, { timeout: 120000 }), failed]);
    const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
    const info = await sharp(Buffer.from(data.split(',')[1], 'base64')).webp({ quality: 82, alphaQuality: 100 }).toFile(out);
    return info;
  } finally {
    await browser.close();
    srv.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { width, height, size } = await renderTray();
  console.log(`wrote ${OUT} ${width}x${height} ${size} bytes`);
}
