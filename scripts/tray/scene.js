import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
const C = window.CFG; 
const W = C.W, H = C.H, S = C.scale;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W * S, H * S);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE[C.toneMapping];
renderer.toneMappingExposure = C.exposure;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();       // interior
const frameScene = new THREE.Scene();  // frame (glint lights + its own studio env)
const P = (x, y, z) => new THREE.Vector3(x, H - y, z); // CSS px (y down) -> three (y up)
const cam = new THREE.OrthographicCamera(0, W, H, 0, 0.1, 500);
cam.position.set(0, 0, 100);

const pmrem = new THREE.PMREMGenerator(renderer);
// ---- interior env: Poly Haven studio_small_09 (CC0)
{
  const hdr = await new RGBELoader().loadAsync('/.cache/studio_small_09_1k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentRotation = new THREE.Euler(0, C.envRotY, 0);
}
// ---- frame env: procedural studio (gradient dome + warm softboxes), so bevels shade across their width
{
  const env = new THREE.Scene();
  const sph = new THREE.SphereGeometry(50, 64, 32);
  const col = [];
  const pos = sph.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const d = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const up = THREE.MathUtils.smoothstep(d.y, -0.25, 0.85);
    const b = C.envFloor + (C.envSky - C.envFloor) * up;
    const c = new THREE.Color(C.envTint).multiplyScalar(b);
    col.push(c.r, c.g, c.b);
  }
  sph.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const b of C.softboxes) { // {pos:[x,y,z], size:[w,h], i:intensity, c:color}
    const m = new THREE.Mesh(new THREE.PlaneGeometry(b.size[0], b.size[1]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(b.c).multiplyScalar(b.i), side: THREE.DoubleSide }));
    m.position.set(...b.pos); m.lookAt(0, 0, 0); env.add(m);
  }
  frameScene.environment = pmrem.fromScene(env, 0.03).texture;
  frameScene.environmentIntensity = C.brassEnv;
}

// ---------- lights ----------
const key = new THREE.DirectionalLight(C.keyColor, C.keyIntensity);
key.position.set(-W * 0.6, H * 1.2, 160);
scene.add(key);
scene.add(new THREE.AmbientLight(0xffffff, C.ambient));
const fkey = new THREE.DirectionalLight(C.glintColor, C.frameKey);
fkey.position.set(-W * 0.8, H * 1.0, 120);
frameScene.add(fkey);
for (const L of C.spots) { // soft glints on the rim: [x, y(css), z, intensity]
  const pl = new THREE.PointLight(C.glintColor, L[3], 0, 0); pl.position.copy(P(L[0], L[1], L[2])); frameScene.add(pl);
}
{ // warm sheen on the back panel, lower middle
  const s = C.sheen;
  const pl = new THREE.PointLight(s.color, s.intensity, 0, 0); pl.position.copy(P(s.x, s.y, s.z)); scene.add(pl);
}

// ---------- helpers ----------
function canvasTex(w, h, fn) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); fn(g, w, h, c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  return t;
}
function quad(a, b, c, d) { // a(0,0) b(1,0) c(1,1) d(0,1); v=0 is the a-b edge
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a, b, c, a, c, d].flatMap(v => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0,0, 1,0, 1,1, 0,0, 1,1, 0,1], 2));
  g.computeVertexNormals();
  return g;
}
const R = C.rim, D = C.depth;
const O = { l: R, r: W - R, t: R, b: H - R };
const B = { l: R + C.wallSide, r: W - R - C.wallSide, t: R + C.wallTop, b: H - R - C.wallBottom };
const z0 = 0, z1 = -D;
const oTL = P(O.l, O.t, z0), oTR = P(O.r, O.t, z0), oBR = P(O.r, O.b, z0), oBL = P(O.l, O.b, z0);
const bTL = P(B.l, B.t, z1), bTR = P(B.r, B.t, z1), bBR = P(B.r, B.b, z1), bBL = P(B.l, B.b, z1);

// ---------- CPU-baked ambient occlusion + soft shadow ----------
// For each texel: cosine-weighted hemisphere rays; a ray is "free" if it leaves through the opening rect at z=0.
// Sky radiance = ambient + a broad key lobe from above (slightly left); result = lit fraction (0..1).
const kd = new THREE.Vector3(...C.keyDir).normalize();
const oxl = O.l, oxr = O.r, oyb = H - O.b, oyt = H - O.t;
function hammersley(i, n) { let b = i, r = 0, f = 0.5; while (b) { r += f * (b & 1); b >>= 1; f *= 0.5; } return [(i + 0.5) / n, r]; }
const NS = C.bakeSamples;
const SAMP = Array.from({ length: NS }, (_, i) => hammersley(i, NS));
function bakeAO(w, h, pointAt, normal) {
  const img = new ImageData(w, h);
  const n = normal.clone().normalize();
  const t1 = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0).cross(n).normalize() : new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const t2 = n.clone().cross(t1);
  const p = new THREE.Vector3();
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    pointAt(i, j, p);
    const rot = rnd() * Math.PI * 2;
    let num = 0, den = 0;
    for (let s = 0; s < NS; s++) {
      const r = Math.sqrt(SAMP[s][0]), ph = SAMP[s][1] * Math.PI * 2 + rot;
      const lx = r * Math.cos(ph), ly = r * Math.sin(ph), lz = Math.sqrt(Math.max(0, 1 - r * r));
      const dx = t1.x * lx + t2.x * ly + n.x * lz, dy = t1.y * lx + t2.y * ly + n.y * lz, dz = t1.z * lx + t2.z * ly + n.z * lz;
      const dk = dx * kd.x + dy * kd.y + dz * kd.z;
      const L = C.skyAmbient + C.skyKey * Math.pow(Math.max(0, dk), C.keyPower);
      den += L;
      if (dz > 1e-4) {
        const tt = -p.z * C.aoDepthScale / dz, qx = p.x + dx * tt, qy = p.y + dy * tt;
        if (qx > oxl && qx < oxr && qy > oyb && qy < oyt) num += L;
      }
    }
    let v = Math.pow(num / den, C.aoGamma);
    const k = (j * w + i) * 4; const g8 = Math.round(255 * Math.min(1, Math.max(0, v)));
    img.data[k] = img.data[k + 1] = img.data[k + 2] = g8; img.data[k + 3] = 255;
  }
  return img;
}
function blurPut(g, img, w, h, px) {
  const t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(img, 0, 0);
  g.filter = `blur(${px}px)`; g.drawImage(t, 0, 0); g.filter = 'none';
}
// faint vertical brushing + broad soft bands, returned as multiply factor around 1
function brush(g, w, h, amp, bandAmp) {
  let seed = 98765; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const col = new Float32Array(w); for (let i = 0; i < w; i++) col[i] = rnd() - 0.5;
  const sm = new Float32Array(w); for (let i = 0; i < w; i++) { let s = 0, c = 0; for (let k = -3; k <= 3; k++) { const q = i + k; if (q >= 0 && q < w) { s += col[q]; c++; } } sm[i] = s / c * 2.2; }
  const wide = new Float32Array(w); for (let i = 0; i < w; i++) { let s = 0, c = 0; for (let k = -24; k <= 24; k++) { const q = i + k; if (q >= 0 && q < w) { s += col[q]; c++; } } wide[i] = s / c * 3.0; }
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < w; i++) {
    const v = 1 - amp * (sm[i] + 0.5) - bandAmp * (wide[i] + 0.5);
    const gr = g.createLinearGradient(0, 0, 0, h); // slow lengthwise drift keeps streaks from looking printed
    const a = Math.max(0, Math.min(1, v)), b = Math.max(0, Math.min(1, v + amp * 0.5 * Math.sin(i * 0.37)));
    gr.addColorStop(0, gray(a)); gr.addColorStop(0.5, gray(b)); gr.addColorStop(1, gray(a));
    g.fillStyle = gr; g.fillRect(i, 0, 1, h);
  }
  g.globalCompositeOperation = 'source-over';
}
const gray = v => { const k = Math.round(255 * Math.max(0, Math.min(1, v))); return `rgb(${k},${k},${k})`; };

const interiorMat = (map, rot, gain = 1, env = 1, base = C.interiorColor) => new THREE.MeshPhysicalMaterial({
  color: new THREE.Color(base).multiplyScalar(gain),
  metalness: C.interiorMetal, roughness: C.interiorRough,
  anisotropy: C.interiorAniso, anisotropyRotation: rot, map,
  envMapIntensity: C.interiorEnv * env, side: THREE.DoubleSide,
});

{
  // back panel (texel = 1/3 CSS px region at S=3)
  const pw = B.r - B.l, ph = B.b - B.t, bw = Math.round(pw * 3), bh = Math.round(ph * 3);
  const backAO = bakeAO(bw, bh, (i, j, p) => p.set(B.l + (i + .5) / bw * pw, H - (B.t + (j + .5) / bh * ph), z1), new THREE.Vector3(0, 0, 1));
  const backMap = canvasTex(bw, bh, (g, w, h) => {
    blurPut(g, backAO, w, h, C.bakeBlur * 3);
    brush(g, w, h, C.brushAmp, C.brushBand);
  });
  scene.add(new THREE.Mesh(quad(bBL, bBR, bTR, bTL), interiorMat(backMap, Math.PI / 2, C.gainBack, C.envBack)));

  // walls: u along the wall, v rim(0) -> deep(1); canvas row 0 = deep end
  function wall(a, b, c, d, gain, env, rot, base) {
    const len = a.distanceTo(b), wid = a.distanceTo(d);
    const w = Math.max(16, Math.round(len * 2.5)), h = Math.max(16, Math.round(wid * 4));
    const n = b.clone().sub(a).cross(d.clone().sub(a)).normalize();
    if (n.z < 0) n.negate();
    const ao = bakeAO(w, h, (i, j, p) => {
      const u = (i + .5) / w, v = 1 - (j + .5) / h;
      const e0 = a.clone().lerp(b, u), e1 = d.clone().lerp(c, u);
      p.copy(e0.lerp(e1, v));
    }, n);
    const map = canvasTex(w, h, (g, w2, h2) => {
      blurPut(g, ao, w2, h2, 1.0);
      // contact line + lip shadow at the rim (rim = bottom canvas row)
      g.globalCompositeOperation = 'multiply';
      const gr = g.createLinearGradient(0, h2, 0, 0);
      gr.addColorStop(0, gray(C.contactDark)); gr.addColorStop(Math.min(0.3, C.contactPx / wid), gray(1));
      g.fillStyle = gr; g.fillRect(0, 0, w2, h2);
      g.globalCompositeOperation = 'source-over';
    });
    const m = new THREE.Mesh(quad(a, b, c, d), interiorMat(map, rot, gain, env, base));
    scene.add(m);
  }
  wall(oTL, oTR, bTR, bTL, C.gainTop, C.envTop, 0);
  wall(oBL, oBR, bBR, bBL, C.gainBottom, C.envBottom, 0, C.ledgeColor);
  wall(oTL, oBL, bBL, bTL, C.gainSide, C.envSide, Math.PI / 2);
  wall(oTR, oBR, bBR, bTR, C.gainSide * C.rightFactor, C.envSide, Math.PI / 2);
}

// ---------- frame ----------
function rrPts(x0, y0, x1, y1, r, seg = 14) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * i / seg; pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a))); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return pts;
}
const bv = C.bevel;
const shape = new THREE.Shape(rrPts(bv, bv, W - bv, H - bv, Math.max(0.5, C.outerRadius - bv)));
shape.holes.push(new THREE.Path(rrPts(O.l - bv, H - O.b - bv, O.r + bv, H - O.t + bv, C.holeRadius).reverse()));
const fg = new THREE.ExtrudeGeometry(shape, { depth: C.frameDepth, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: C.bevelSegments, curveSegments: 16 });
fg.translate(0, 0, -C.frameDepth - bv + C.frameTopZ);
{ // vertex colours: dark contact line against the recess + faint darkening on the outer edge
  const pos = fg.attributes.position, cols = new Float32Array(pos.count * 3);
  const sd = (x, y) => { // signed distance outside opening (CSS px; >0 in the frame)
    const yy = H - y; const dx = Math.max(O.l - x, x - O.r), dy = Math.max(O.t - yy, yy - O.b);
    return Math.max(dx, dy);
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const dIn = sd(x, y);
    const dOut = Math.min(x, W - x, y, H - y);
    let f = THREE.MathUtils.lerp(C.contactFrame, 1, THREE.MathUtils.smoothstep(dIn, 0.0, C.contactFramePx));
    f *= THREE.MathUtils.lerp(C.outerEdgeDark, 1, THREE.MathUtils.smoothstep(dOut, 0.0, 1.2));
    cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = f;
  }
  fg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
}
const frameMat = new THREE.MeshPhysicalMaterial({
  color: C.brassColor, metalness: 1, roughness: C.brassRough, anisotropy: C.brassAniso,
  anisotropyRotation: Math.PI / 2, vertexColors: true,
});
frameScene.add(new THREE.Mesh(fg, frameMat));

renderer.autoClear = false;
renderer.clear();
renderer.render(scene, cam);
renderer.render(frameScene, cam);
window.__rect = { back: B, opening: O };
window.__done = true;
