// CPU path tracer for the booth tray (plain Node, no GPU). Units are CSS px. x right, y DOWN (CSS), z toward the viewer.
// The tray is a signed-distance field: a two-tier frame on the wall plane z = 0 and a tapered, rounded
// pocket pressed into it. Metal is anisotropic GGX with visible-normal sampling, so every reflection
// (wall in back panel, softbox in rounded lip, metal in metal) is traced rather than faked.
export function makeTracer(C) {
  const W = C.W, H = C.H;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---------- camera: a far perspective camera above the tray centre; image plane z = zref maps 1:1 ----------
  const camZ = C.camDist, camX = W / 2 + (C.camShiftX || 0), camY = H / 2 - Math.tan(C.camTilt * Math.PI / 180) * C.camDist;
  const zref = C.h2;
  const unproj = (ix, iy, z) => { const s = (z - camZ) / (zref - camZ); return [camX + (ix - camX) * s, camY + (iy - camY) * s]; };

  // ---------- frame ----------
  const step = C.step, h1 = C.h1, e1 = C.e1, slope1 = C.slope1, h2 = C.h2, e2 = C.e2, kStep = C.kStep, rl = C.rl;
  // Outer rectangle, placed so its silhouette lands on the image box inset by frameInset. Seen from above, the
  // silhouette is the foot of the frame at the top and sides, but the rounded upper edge at the bottom.
  const fo = C.frameInset, RO = C.outerRadius, hEdge = step > 0 ? h1 - e1 * 0.3 : h2 - e2 * 0.3;
  const [X0, Y0] = unproj(fo, fo, 0), X1 = unproj(W - fo, 0, 0)[0], Y1 = unproj(0, H - fo, hEdge)[1];
  const crown = C.crown || 0;
  const zTop = Math.max(h1 + slope1 * step, h2) + 0.5;
  const RRcx = (X0 + X1) / 2, RRcy = (Y0 + Y1) / 2, RRhx = (X1 - X0) / 2 - RO, RRhy = (Y1 - Y0) / 2 - RO;
  function sdOuter(x, y) {
    const qx = Math.abs(x - RRcx) - RRhx, qy = Math.abs(y - RRcy) - RRhy;
    const ax = qx > 0 ? qx : 0, ay = qy > 0 ? qy : 0, m = qx > qy ? qx : qy;
    return Math.sqrt(ax * ax + ay * ay) + (m < 0 ? m : 0) - RO;
  }

  // ---------- pocket: five half-spaces, round-intersected (fold radius rf) ----------
  const zo = h2, D = C.depth, rf = C.rf;
  const [oL, oT] = unproj(C.opening.l, C.opening.t, zo), [oR, oB] = unproj(C.opening.r, C.opening.b, zo);
  const [bL, bT] = unproj(C.back.l, C.back.t, -D), [bR, bB] = unproj(C.back.r, C.back.b, -D);
  const pl = (o, b, sign) => { const dx = b - o, dz = -D - zo, len = Math.hypot(dx, dz); return [sign * -dz / len, sign * dx / len]; };
  const [Lnx, Lnz] = pl(oL, bL, 1), [Rnx, Rnz] = pl(oR, bR, -1), [Tny, Tnz] = pl(oT, bT, 1), [Bny, Bnz] = pl(oB, bB, -1);
  function cav(x, y, z) {
    const dz = z - zo;
    const u1 = rf - (Lnx * (x - oL) + Lnz * dz), u2 = rf - (Rnx * (x - oR) + Rnz * dz);
    const u3 = rf - (Tny * (y - oT) + Tnz * dz), u4 = rf - (Bny * (y - oB) + Bnz * dz), u5 = rf - (z + D);
    let m = u1 > u2 ? u1 : u2; if (u3 > m) m = u3; if (u4 > m) m = u4; if (u5 > m) m = u5;
    let s = 0;
    if (u1 > 0) s += u1 * u1; if (u2 > 0) s += u2 * u2; if (u3 > 0) s += u3 * u3; if (u4 > 0) s += u4 * u4; if (u5 > 0) s += u5 * u5;
    return (m < 0 ? m : 0) + Math.sqrt(s) - rf;
  }
  function tier(d2, z, h, e) {
    const wx = d2 + e, wy = z - h + e, m = wx > wy ? wx : wy;
    const ax = wx > 0 ? wx : 0, ay = wy > 0 ? wy : 0;
    return (m < 0 ? m : 0) + Math.sqrt(ax * ax + ay * ay) - e;
  }
  function map(x, y, z) {
    const d2 = sdOuter(x, y);
    const ins = d2 > 0 ? 0 : (-d2 > step ? step : -d2);
    // flange: sloped and/or slightly crowned so its mirror image is not one flat colour
    const u = step > 0 ? ins / step : 0, zc = z - slope1 * ins - crown * 4 * u * (1 - u);
    const t1 = tier(d2, zc, h1, e1);
    const t2 = tier(d2 + step, z, h2, e2);
    let fr = t1 < t2 ? t1 : t2;
    if (kStep > 0) { const hh = kStep - Math.abs(t1 - t2); if (hh > 0) fr -= hh * hh * 0.25 / kStep; }
    const body = z < fr ? z : fr;
    const a = body + rl, b = rl - cav(x, y, z), m = a > b ? a : b;
    const ax = a > 0 ? a : 0, bx = b > 0 ? b : 0;
    return (m < 0 ? m : 0) + Math.sqrt(ax * ax + bx * bx) - rl;
  }

  // ---------- noise ----------
  const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  function vnoise(x, y) { // value noise in [-1, 1]
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
    return 2 * (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) - 1;
  }

  // ---------- environment: a dim room plus rectangular softboxes at finite distance ----------
  const boxes = C.softboxes.map(b => {
    const c = b.pos, t = b.target || [W / 2, H / 2, 0];
    let n = [t[0] - c[0], t[1] - c[1], t[2] - c[2]]; const nl = Math.hypot(...n); n = n.map(v => v / nl);
    const up = Math.abs(n[1]) > 0.95 ? [0, 0, 1] : [0, -1, 0];
    let u = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]]; const ul = Math.hypot(...u); u = u.map(v => v / ul);
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    return { c, n, u, v, hu: b.size[0] / 2, hv: b.size[1] / 2, col: b.color.map(k => k * b.i), soft: b.soft ?? 0.25 };
  });
  const ceil = C.dome.ceil, horiz = C.dome.horizon, floorC = C.dome.floor, front = C.dome.front || [0, 0, 0];
  const nb = boxes.length, DT = C.dome.t || [-0.7, 0.05, 0.05, 0.95];
  let er = 0, eg = 0, eb = 0;
  // pdfPrev: solid-angle pdf with which this direction was BRDF-sampled (for MIS against light sampling)
  function env(ox, oy, oz, dx, dy, dz, pdfPrev) {
    const up = -dy, a1 = sstep(DT[0], DT[1], up), a2 = sstep(DT[2], DT[3], up), f = dz > 0 ? dz * dz : 0;
    er = floorC[0] + (horiz[0] - floorC[0]) * a1 + (ceil[0] - horiz[0]) * a2 + front[0] * f;
    eg = floorC[1] + (horiz[1] - floorC[1]) * a1 + (ceil[1] - horiz[1]) * a2 + front[1] * f;
    eb = floorC[2] + (horiz[2] - floorC[2]) * a1 + (ceil[2] - horiz[2]) * a2 + front[2] * f;
    for (let k = 0; k < nb; k++) {
      const b = boxes[k], dn = dx * b.n[0] + dy * b.n[1] + dz * b.n[2];
      if (dn > -1e-6) continue;
      const tt = ((b.c[0] - ox) * b.n[0] + (b.c[1] - oy) * b.n[1] + (b.c[2] - oz) * b.n[2]) / dn;
      if (tt <= 0) continue;
      const qx = ox + dx * tt - b.c[0], qy = oy + dy * tt - b.c[1], qz = oz + dz * tt - b.c[2];
      const a = Math.abs(qx * b.u[0] + qy * b.u[1] + qz * b.u[2]) / b.hu; if (a >= 1) continue;
      const bb = Math.abs(qx * b.v[0] + qy * b.v[1] + qz * b.v[2]) / b.hv; if (bb >= 1) continue;
      let w = sstep(0, b.soft, 1 - a) * sstep(0, b.soft, 1 - bb);
      if (pdfPrev < 1e29) { const pl = tt * tt / (4 * b.hu * b.hv * -dn * nb); w *= pdfPrev * pdfPrev / (pdfPrev * pdfPrev + pl * pl); }
      er += b.col[0] * w; eg += b.col[1] * w; eb += b.col[2] * w;
    }
  }

  // ---------- materials ----------
  const MF = C.frameMat, MI = C.interiorMat, wallCol = C.wallColor;
  let seed = 1;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

  let hx = 0, hy = 0, hz = 0;
  function march(ox, oy, oz, dx, dy, dz) { // 1 = hit (hx,hy,hz), 0 = escaped upward
    let t = 0;
    for (let i = 0; i < 220; i++) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (z > zTop && dz > 0) { hx = x; hy = y; hz = z; return 0; }
      const d = map(x, y, z);
      if (d < 0.0015) { hx = x; hy = y; hz = z; return 1; }
      t += d * MK;
      if (t > 4000) { hx = x; hy = y; hz = z; return dz > 0 ? 0 : 1; }
    }
    hx = ox + dx * t; hy = oy + dy * t; hz = oz + dz * t; return 1;
  }

  let Lr = 0, Lg = 0, Lb = 0;
  let gNx = 0, gNy = 0, gNz = 0, gZ = 0, gTx = 0, gTy = 0, gW = 0; // guides from the first metal hit (for the denoiser)
  const MK = C.marchK || 0.7; // the rounded pocket field is not exactly 1-Lipschitz, so step short
  const NE = 0.02, MAXL = C.maxRadiance || 14;
  // returns 0 if the first hit is the olive wall (or nothing), 1 if metal
  function radiance(ox, oy, oz, dx, dy, dz, maxB, pdf0) {
    let tr = 1, tg = 1, tb = 1, first = 0, pdfPrev = pdf0 === undefined ? 1e30 : pdf0;
    let R = 0, G = 0, Bl = 0;
    for (let bounce = 0; bounce < maxB; bounce++) {
      if (!march(ox, oy, oz, dx, dy, dz)) { env(hx, hy, hz, dx, dy, dz, pdfPrev); R += tr * er; G += tg * eg; Bl += tb * eb; break; }
      const x = hx, y = hy, z = hz;
      const d2 = sdOuter(x, y);
      if (d2 > -0.02 && z < 0.25) { R += tr * wallCol[0]; G += tg * wallCol[1]; Bl += tb * wallCol[2]; break; }
      if (bounce === 0) first = 1;
      // geometric normal (tetrahedron)
      const a = map(x + NE, y - NE, z - NE), b = map(x - NE, y - NE, z + NE), c = map(x - NE, y + NE, z - NE), d = map(x + NE, y + NE, z + NE);
      let nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
      let il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
      // which finish: frame (lip, flange) or pressed interior
      const cv = cav(x, y, z);
      const wi = Math.abs(cv) < 0.4 ? sstep(zo - rl * 0.6, zo - rl * 1.6 - 0.6, z) : 0;
      // brushing direction T
      let tx, ty, tz;
      if (wi > 0.5 || MF.brush === 'x') { const w = sstep(0.35, 0.75, Math.abs(nx)); tx = 1 - w; ty = w; tz = 0; } // along each wall's length
      else { // along the frame's run
        const gx = sdOuter(x + 0.05, y) - sdOuter(x - 0.05, y), gy = sdOuter(x, y + 0.05) - sdOuter(x, y - 0.05);
        tx = -gy; ty = gx; tz = 0; if (tx * tx + ty * ty < 1e-12) { tx = 1; ty = 0; }
      }
      let dt = tx * nx + ty * ny + tz * nz; tx -= dt * nx; ty -= dt * ny; tz -= dt * nz;
      il = 1 / Math.hypot(tx, ty, tz); tx *= il; ty *= il; tz *= il;
      let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      if (bounce === 0) { // image-space direction of the brushing, so noise can be averaged along the streaks only
        const k = (camZ - zref) / (camZ - z);
        gNx = nx; gNy = ny; gNz = nz; gZ = z; gW = wi;
        gTx = (tx + (x - camX) * tz / (camZ - z)) * k; gTy = (ty + (y - camY) * tz / (camZ - z)) * k;
      }
      // finish parameters
      const M = wi > 0.5 ? MI : MF;
      let at = MF.at + (MI.at - MF.at) * wi, ab = MF.ab + (MI.ab - MF.ab) * wi;
      let f0r = MF.f0[0] + (MI.f0[0] - MF.f0[0]) * wi, f0g = MF.f0[1] + (MI.f0[1] - MF.f0[1]) * wi, f0b = MF.f0[2] + (MI.f0[2] - MF.f0[2]) * wi;
      const pu = x * tx + y * ty + z * tz, pv = x * bx + y * by + z * bz;
      // brushing: micro-tilt across the streaks + slow sheet waviness
      let tiltB = 0, tiltT = 0;
      if (M.streak > 0) tiltB += M.streak * (0.6 * vnoise(pu * M.streakLen, pv * M.f1) + 0.4 * vnoise(pu * M.streakLen * 2.3 + 9.1, pv * M.f2 + 3.7));
      if (M.wavy > 0) { tiltB += M.wavy * vnoise(x * M.wavyF + 31.7, y * M.wavyF + z * M.wavyF * 0.7 + 11.3); tiltT += M.wavy * vnoise(x * M.wavyF + 71.1, y * M.wavyF + z * M.wavyF * 0.7 + 47.9); }
      if (M.foldRough > 0) { // a pressed crease is never mirror-smooth: it blurs what the fold would otherwise reflect
        const cr = clamp(1 - map(x + nx * 3, y + ny * 3, z + nz * 3) / 3, 0, 1) * M.foldRough * wi;
        at += cr; ab += cr;
      }
      let sx = nx + tiltB * bx + tiltT * tx, sy = ny + tiltB * by + tiltT * ty, sz = nz + tiltB * bz + tiltT * tz;
      il = 1 / Math.hypot(sx, sy, sz); sx *= il; sy *= il; sz *= il;
      // re-orthogonalise the frame around the shading normal
      dt = tx * sx + ty * sy + tz * sz; tx -= dt * sx; ty -= dt * sy; tz -= dt * sz;
      il = 1 / Math.hypot(tx, ty, tz); tx *= il; ty *= il; tz *= il;
      bx = sy * tz - sz * ty; by = sz * tx - sx * tz; bz = sx * ty - sy * tx;
      // view vector in the local frame
      let vx = -(dx * tx + dy * ty + dz * tz), vy = -(dx * bx + dy * by + dz * bz), vz = -(dx * sx + dy * sy + dz * sz);
      if (vz < 0.02) { vz = 0.02; il = 1 / Math.hypot(vx, vy, vz); vx *= il; vy *= il; vz *= il; }
      const g1v = 2 / (1 + Math.sqrt(1 + (at * at * vx * vx + ab * ab * vy * vy) / (vz * vz)));
      // light sampling: one softbox, one point, MIS-weighted against the BRDF sample below
      if (nb > 0) {
        const lb = boxes[(rnd() * nb) | 0], ra = 2 * rnd() - 1, rb = 2 * rnd() - 1;
        const wgt = sstep(0, lb.soft, 1 - Math.abs(ra)) * sstep(0, lb.soft, 1 - Math.abs(rb));
        if (wgt > 0) {
          let wx = lb.c[0] + lb.u[0] * lb.hu * ra + lb.v[0] * lb.hv * rb - x, wy = lb.c[1] + lb.u[1] * lb.hu * ra + lb.v[1] * lb.hv * rb - y, wz = lb.c[2] + lb.u[2] * lb.hu * ra + lb.v[2] * lb.hv * rb - z;
          const d2l = wx * wx + wy * wy + wz * wz, dl = Math.sqrt(d2l); wx /= dl; wy /= dl; wz /= dl;
          const cosl = -(wx * lb.n[0] + wy * lb.n[1] + wz * lb.n[2]);
          const llx = wx * tx + wy * ty + wz * tz, lly = wx * bx + wy * by + wz * bz, llz = wx * sx + wy * sy + wz * sz;
          if (cosl > 1e-4 && llz > 1e-4 && wx * nx + wy * ny + wz * nz > 1e-4) {
            let qx = vx + llx, qy = vy + lly, qz = vz + llz; const ql = 1 / Math.hypot(qx, qy, qz); qx *= ql; qy *= ql; qz *= ql;
            const dd = qx * qx / (at * at) + qy * qy / (ab * ab) + qz * qz, Dm = 1 / (Math.PI * at * ab * dd * dd);
            const pdfB = g1v * Dm / (4 * vz), pdfL = d2l / (4 * lb.hu * lb.hv * cosl * nb);
            const g1l = 2 / (1 + Math.sqrt(1 + (at * at * llx * llx + ab * ab * lly * lly) / (llz * llz)));
            const k = Dm * g1v * g1l / (4 * vz) / pdfL * (pdfL * pdfL / (pdfL * pdfL + pdfB * pdfB)) * wgt;
            if (k > 1e-6 && !march(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03, wx, wy, wz)) {
              const fw = Math.pow(1 - Math.max(0, vx * qx + vy * qy + vz * qz), 5);
              R += tr * (f0r + (1 - f0r) * fw) * lb.col[0] * k; G += tg * (f0g + (1 - f0g) * fw) * lb.col[1] * k; Bl += tb * (f0b + (1 - f0b) * fw) * lb.col[2] * k;
            }
          }
        }
      }
      // GGX visible-normal sampling (Heitz 2018)
      let ax = at * vx, ay = ab * vy, az = vz; il = 1 / Math.hypot(ax, ay, az); ax *= il; ay *= il; az *= il;
      const lsq = ax * ax + ay * ay;
      let t1x = 1, t1y = 0; if (lsq > 1e-12) { const q = 1 / Math.sqrt(lsq); t1x = -ay * q; t1y = ax * q; }
      const t2x = -az * t1y, t2y = az * t1x, t2z = ax * t1y - ay * t1x;
      const r = Math.sqrt(rnd()), ph = 6.283185307179586 * rnd();
      const p1 = r * Math.cos(ph); let p2 = r * Math.sin(ph); const s = 0.5 * (1 + az);
      p2 = (1 - s) * Math.sqrt(1 - p1 * p1) + s * p2;
      const p3 = Math.sqrt(Math.max(0, 1 - p1 * p1 - p2 * p2));
      let mx = p1 * t1x + p2 * t2x + p3 * ax, my = p1 * t1y + p2 * t2y + p3 * ay, mz = p2 * t2z + p3 * az;
      mx *= at; my *= ab; mz = mz > 0 ? mz : 0; il = 1 / Math.hypot(mx, my, mz); mx *= il; my *= il; mz *= il;
      const vh = vx * mx + vy * my + vz * mz;
      const lx = 2 * vh * mx - vx, ly = 2 * vh * my - vy, lz = 2 * vh * mz - vz;
      if (lz <= 1e-4) break;
      { const dd = mx * mx / (at * at) + my * my / (ab * ab) + mz * mz; pdfPrev = g1v / (Math.PI * at * ab * dd * dd) / (4 * vz); }
      const g1 = 2 / (1 + Math.sqrt(1 + (at * at * lx * lx + ab * ab * ly * ly) / (lz * lz)));
      const fw = Math.pow(1 - (vh > 0 ? vh : 0), 5);
      tr *= (f0r + (1 - f0r) * fw) * g1; tg *= (f0g + (1 - f0g) * fw) * g1; tb *= (f0b + (1 - f0b) * fw) * g1;
      dx = lx * tx + ly * bx + lz * sx; dy = lx * ty + ly * by + lz * sy; dz = lx * tz + ly * bz + lz * sz;
      if (dx * nx + dy * ny + dz * nz <= 1e-4) break; // went under the real surface
      ox = x + nx * 0.03; oy = y + ny * 0.03; oz = z + nz * 0.03;
      if (tr + tg + tb < 0.01) break;
    }
    Lr = R > MAXL ? MAXL : R; Lg = G > MAXL ? MAXL : G; Lb = Bl > MAXL ? MAXL : Bl;
    return first;
  }

  // out: per pixel linear rgb (mean over metal samples) + coverage; aux: mean normal, depth, brushing direction, interior weight
  function renderRow(j, S, spp, out, off, aux) {
    const n = Math.max(1, Math.round(Math.sqrt(spp))), N = n * n, wS = W * S;
    const zs = zTop;
    for (let i = 0; i < wS; i++) {
      seed = ((j * 9781 + i * 6271 + 1) * 2654435761) | 0 || 1; rnd(); rnd();
      let r = 0, g = 0, b = 0, cnt = 0, a0 = 0, a1 = 0, a2 = 0, a3 = 0, a4 = 0, a5 = 0, a6 = 0;
      for (let k = 0; k < N; k++) {
        const px = (i + ((k % n) + rnd()) / n) / S, py = (j + (((k / n) | 0) + rnd()) / n) / S;
        let dx = px - camX, dy = py - camY, dz = zref - camZ; const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
        const t0 = (zs - camZ) / dz;
        if (radiance(camX + dx * t0, camY + dy * t0, zs, dx, dy, dz, C.maxBounces)) {
          r += Lr; g += Lg; b += Lb; cnt++;
          a0 += gNx; a1 += gNy; a2 += gNz; a3 += gZ; a4 += gTx; a5 += gTy; a6 += gW;
        }
      }
      const o = off + i * 4, q = (off / 4 + i) * 8;
      if (cnt) { out[o] = r / cnt; out[o + 1] = g / cnt; out[o + 2] = b / cnt; aux[q] = a0 / cnt; aux[q + 1] = a1 / cnt; aux[q + 2] = a2 / cnt; aux[q + 3] = a3 / cnt; aux[q + 4] = a4 / cnt; aux[q + 5] = a5 / cnt; aux[q + 6] = a6 / cnt; }
      else { out[o] = out[o + 1] = out[o + 2] = 0; }
      out[o + 3] = cnt / N;
    }
  }

  return { renderRow, info: { opening: { l: oL, t: oT, r: oR, b: oB }, back: { l: bL, t: bT, r: bR, b: bB }, cam: [camX, camY, camZ], drafts: { l: bL - oL, r: oR - bR, t: bT - oT, b: oB - bB } } };
}
