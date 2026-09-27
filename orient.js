'use strict';
/*
 * orient.js — how the GO flakes line up (GO-2). Pure computation: loaded in the 2D's worker, required in Node.
 *
 * The flakes are thin discs; their orientation is the unit normal p. An ensemble of normals (Brownian dynamics:
 * exact as the ensemble grows, whatever the sharpness of the distribution; a fixed seed, so a run repeats
 * exactly) is turned by the flow and spread by rotary diffusion:
 *   Jeffery:        dp/dt = W p + β (D p − (p·D p) p),   β = (r² − 1)/(r² + 1), r = thickness / diameter
 *                   (a thin flake: β → −1, its normal turned toward the velocity gradient, the flake into the flow)
 *   Folgar–Tucker:  rotary diffusion D_r = C_i γ̇ (γ̇ = √(2 D:D): flake–flake collisions, only while it flows)
 *   Doi–Hess:       rotary diffusion D_r (constant) and the Maier–Saupe mean field V = −(3/2) U p·⟨pp⟩·p
 *                   (the flakes line up together: the isotropic state is unstable above U = 5)
 * L = ∇u (L[i][j] = ∂u_i/∂x_j, 3 × 3, row-major Float64Array(9)); D = (L + Lᵀ)/2, W = (L − Lᵀ)/2.
 * Each step: the drift by Heun's method (second order), the diffusion as a random displacement in the tangent
 * plane √(2 D_r dt) (I − pp) ξ, then back onto the sphere (which gives diffusion's −2 D_r p dt drift).
 * Model M = { kind: 'ft' | 'dh', beta, Ci (ft), Dr (dh), U (dh), Dr0 (a Brownian D_r added to either; default 0) }.
 */

/** A small fast seeded generator (mulberry32) with normal deviates (Box–Muller). */
function orRng(seed = 1) {
  let a = seed >>> 0, spare = null;
  const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = () => { if (spare != null) { const s = spare; spare = null; return s; } let x; do x = u(); while (x <= 1e-300); const r = Math.sqrt(-2 * Math.log(x)), th = 2 * Math.PI * u(); spare = r * Math.sin(th); return r * Math.cos(th); };
  return { u, n };
}
/** β for a spheroid of aspect ratio r (symmetry axis / diameter: a flake's thickness / its width). */
const orBeta = r => (r * r - 1) / (r * r + 1);
/** n normals spread evenly at random over the sphere. */
function orEnsemble(n, rng) {
  const p = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) { const z = 2 * rng.u() - 1, ph = 2 * Math.PI * rng.u(), s = Math.sqrt(1 - z * z); p[3 * k] = s * Math.cos(ph); p[3 * k + 1] = s * Math.sin(ph); p[3 * k + 2] = z; }
  return { n, p };
}
/** n normals all along the unit vector e. */
function orAligned(n, e) { const p = new Float64Array(3 * n); for (let k = 0; k < n; k++) { p[3 * k] = e[0]; p[3 * k + 1] = e[1]; p[3 * k + 2] = e[2]; } return { n, p }; }
const orCopy = E => ({ n: E.n, p: Float64Array.from(E.p) });

/** The second moment A = ⟨pp⟩ (Float64Array(9), symmetric). */
function orA(E) {
  const A = new Float64Array(9), p = E.p;
  for (let k = 0; k < E.n; k++) { const x = p[3 * k], y = p[3 * k + 1], z = p[3 * k + 2]; A[0] += x * x; A[1] += x * y; A[2] += x * z; A[4] += y * y; A[5] += y * z; A[8] += z * z; }
  for (const i of [0, 1, 2, 4, 5, 8]) A[i] /= E.n;
  A[3] = A[1]; A[6] = A[2]; A[7] = A[5];
  return A;
}
/** Eigen-decomposition of a symmetric 3 × 3 (Jacobi): { values (descending), vectors: [[x,y,z] per value] }. */
function orEig(A) {
  const a = [[A[0], A[1], A[2]], [A[3], A[4], A[5]], [A[6], A[7], A[8]]], v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-15) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  const idx = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  return { values: idx.map(i => a[i][i]), vectors: idx.map(i => [v[0][i], v[1][i], v[2][i]]) };
}
/**
 * What the ensemble shows: A = ⟨pp⟩; S, the order parameter (3 λ_max − 1)/2 of A's largest eigenvalue (0 at
 * random, 1 all normals parallel); the director n (its eigenvector); the director's angle in the flow's plane,
 * from the normal to the web (y) toward the web's motion (x), degrees; and S_y = ⟨P2(p_y)⟩, the order about the
 * web's normal (1: every flake flat in the film's plane).
 */
function orStats(E) {
  const A = orA(E), e = orEig(A), n = e.vectors[0];
  const sgn = n[1] < 0 ? -1 : 1;
  return { A, S: (3 * e.values[0] - 1) / 2, n: n.map(x => x * sgn), angle: Math.atan2(sgn * n[0], sgn * n[1]) * 180 / Math.PI, Sy: (3 * A[4] - 1) / 2, eig: e.values };
}

/** The shear rate √(2 D:D) of a gradient. */
function orGammaDot(L) {
  let s = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const d = 0.5 * (L[3 * i + j] + L[3 * j + i]); s += d * d; }
  return Math.sqrt(2 * s);
}
/** The rotary diffusivity the model gives in gradient L. */
const orDr = (L, M) => (M.kind === 'ft' ? M.Ci * orGammaDot(L) : M.Dr) + (M.Dr0 || 0);

/**
 * One step dt in gradient L: the drift (Jeffery; the mean field with the moment A of the step's start) by Heun's
 * method, the diffusion by a tangent-plane displacement √(2 D_r dt) (I − pp) ξ, then each normal back to unit
 * length. ξ: independent components of mean 0 and variance 1, uniform on ±√3 (the weak scheme: the distribution's
 * moments converge as with normal deviates, at a fraction of their cost). Written out in full for speed.
 */
function orStep(E, L, dt, M, rng) {
  const n = E.n, p = E.p, b = M.beta;
  const d00 = L[0], d11 = L[4], d22 = L[8], d01 = 0.5 * (L[1] + L[3]), d02 = 0.5 * (L[2] + L[6]), d12 = 0.5 * (L[5] + L[7]);
  const w01 = 0.5 * (L[1] - L[3]), w02 = 0.5 * (L[2] - L[6]), w12 = 0.5 * (L[5] - L[7]);
  const Dr = orDr(L, M), mf = M.kind === 'dh' && M.U ? 3 * M.U * M.Dr : 0, A = mf ? orA(E) : null, sq = Math.sqrt(2 * Dr * dt) * Math.sqrt(3);
  const a00 = mf ? A[0] : 0, a01 = mf ? A[1] : 0, a02 = mf ? A[2] : 0, a11 = mf ? A[4] : 0, a12 = mf ? A[5] : 0, a22 = mf ? A[8] : 0;
  const h = 0.5 * dt, u = rng.u;
  for (let k = 0, i = 0; k < n; k++, i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    // drift at p
    let Dx = d00 * x + d01 * y + d02 * z, Dy = d01 * x + d11 * y + d12 * z, Dz = d02 * x + d12 * y + d22 * z, q = x * Dx + y * Dy + z * Dz;
    let fx = w01 * y + w02 * z + b * (Dx - q * x), fy = -w01 * x + w12 * z + b * (Dy - q * y), fz = -w02 * x - w12 * y + b * (Dz - q * z);
    if (mf) { const Ax = a00 * x + a01 * y + a02 * z, Ay = a01 * x + a11 * y + a12 * z, Az = a02 * x + a12 * y + a22 * z, m = x * Ax + y * Ay + z * Az; fx += mf * (Ax - m * x); fy += mf * (Ay - m * y); fz += mf * (Az - m * z); }
    // predictor, on the sphere
    let px = x + dt * fx, py = y + dt * fy, pz = z + dt * fz, r = 1 / Math.sqrt(px * px + py * py + pz * pz);
    px *= r; py *= r; pz *= r;
    // drift at the predictor
    Dx = d00 * px + d01 * py + d02 * pz; Dy = d01 * px + d11 * py + d12 * pz; Dz = d02 * px + d12 * py + d22 * pz; q = px * Dx + py * Dy + pz * Dz;
    let gx = w01 * py + w02 * pz + b * (Dx - q * px), gy = -w01 * px + w12 * pz + b * (Dy - q * py), gz = -w02 * px - w12 * py + b * (Dz - q * pz);
    if (mf) { const Ax = a00 * px + a01 * py + a02 * pz, Ay = a01 * px + a11 * py + a12 * pz, Az = a02 * px + a12 * py + a22 * pz, m = px * Ax + py * Ay + pz * Az; gx += mf * (Ax - m * px); gy += mf * (Ay - m * py); gz += mf * (Az - m * pz); }
    px = x + h * (fx + gx); py = y + h * (fy + gy); pz = z + h * (fz + gz);
    if (sq > 0) {
      const ex = 2 * u() - 1, ey = 2 * u() - 1, ez = 2 * u() - 1, e = ex * x + ey * y + ez * z;
      px += sq * (ex - e * x); py += sq * (ey - e * y); pz += sq * (ez - e * z);
    }
    r = 1 / Math.sqrt(px * px + py * py + pz * pz);
    p[i] = px * r; p[i + 1] = py * r; p[i + 2] = pz * r;
  }
  return Dr;
}
/**
 * A step size for gradient L: at most `strain` of flow (default 0.05), a tenth of the diffusion's time 1/(6 D_r),
 * a twentieth of the mean field's (1 / (3 U D_r)).
 */
function orDt(L, M, { strain = 0.05, cap = Infinity } = {}) {
  const g = orGammaDot(L), vort = Math.abs(L[1] - L[3]), Dr = orDr(L, M);
  let dt = cap;
  if (g + vort > 0) dt = Math.min(dt, strain / Math.max(g, vort));
  if (Dr > 0) dt = Math.min(dt, 0.1 / (6 * Dr));
  if (M.kind === 'dh' && M.U) dt = Math.min(dt, 0.05 / (3 * M.U * M.Dr));
  return dt;
}
/** Advance for time t in a constant gradient L (steps from orDt). Returns the steps taken. */
function orRun(E, L, t, M, rng, opts) {
  let done = 0, steps = 0;
  const h = orDt(L, M, opts);
  if (!Number.isFinite(h)) return 0;   // (nothing moves: no flow and no diffusion)
  while (done < t - 1e-15 * t) { const dt = Math.min(h, t - done); orStep(E, L, dt, M, rng); done += dt; steps++; }
  return steps;
}
/**
 * The steady state in a constant gradient L, from random: run stretch after stretch (each half the longest of 50
 * strain units, 3 diffusion times, 3 mean-field times) until the moment A changes by less than tol over one (tol no
 * finer than the ensemble's own scatter, 0.75 / √n: below it the change is noise), at least 3 stretches and at most
 * maxStretches (30). Returns { E, converged, t }.
 */
function orSteady(L, M, { n = 4000, seed = 7, tol = 3e-3, maxT = Infinity, E0 = null, maxStretches = 30 } = {}) {
  const rng = orRng(seed), E = E0 ? orCopy(E0) : orEnsemble(n, rng);
  const g = orGammaDot(L), Dr = orDr(L, M);
  const scales = [g > 0 ? 50 / g : Infinity, Dr > 0 ? 3 / (6 * Dr) : Infinity, M.kind === 'dh' && M.U ? 3 / (3 * M.U * M.Dr) : Infinity].filter(Number.isFinite);
  if (!scales.length) return { E, converged: true, t: 0 };
  const stretch = Math.max(...scales.filter(s => s > 0)) / 2;
  const tolE = Math.max(tol, 0.75 / Math.sqrt(E.n));
  let t = 0, prev = orA(E), converged = false;
  for (let k = 0; k < maxStretches && t < maxT; k++) {
    orRun(E, L, stretch, M, rng); t += stretch;
    const A = orA(E); let d = 0;
    for (let i = 0; i < 9; i++) d = Math.max(d, Math.abs(A[i] - prev[i]));
    prev = A;
    if (k >= 2 && d < tolE) { converged = true; break; }
  }
  return { E, converged, t };
}

/**
 * The flakes' traces in a cut, as the SEM sees them: the line where each flake meets the cut's plane, its angle
 * to the web (degrees, −90..90; + rising in the cut's horizontal direction). 'md': a cut along the web's motion
 * (the x–y plane: horizontal x); 'cd': across the web (the z–y plane: horizontal z). A flake lying in the cut's
 * plane has no trace (left out); each trace weighted by how likely the cut is to meet it (∝ its sine to the cut:
 * a flake nearly in the plane is rarely cut).
 */
function orTraces(E, cut = 'md') {
  const out = [], w = [], p = E.p;
  for (let k = 0; k < E.n; k++) {
    const x = p[3 * k], y = p[3 * k + 1], z = p[3 * k + 2];
    // the trace's direction: p × (the cut plane's normal); md: normal z -> (y, −x, 0), horizontal x; cd: normal x ->
    // (0, z, −y), horizontal z (its sign does not matter: angles are folded into −90..90)
    let h, v;
    if (cut === 'md') { h = y; v = -x; } else { h = -y; v = z; }
    const s = Math.hypot(h, v);
    if (s < 1e-9) continue;
    let a = Math.atan2(v, h) * 180 / Math.PI;
    if (a > 90) a -= 180; else if (a <= -90) a += 180;
    out.push(a); w.push(s);
  }
  return { angles: out, weights: w };
}
/**
 * A cut's order from its trace angles θ (to the web): S2 = ⟨cos 2θ⟩ (1 all parallel to the web, 0 at random in the
 * cut, −1 all upright), the mean angle and the spread (standard deviation), weighted if weights are given.
 */
function orCutStats(angles, weights) {
  let sw = 0, c2 = 0, s2 = 0;
  angles.forEach((a, i) => { const w = weights ? weights[i] : 1, r = 2 * a * Math.PI / 180; sw += w; c2 += w * Math.cos(r); s2 += w * Math.sin(r); });
  c2 /= sw; s2 /= sw;
  const mean = 0.5 * Math.atan2(s2, c2) * 180 / Math.PI;
  let v = 0; angles.forEach((a, i) => { let d = a - mean; if (d > 90) d -= 180; if (d < -90) d += 180; v += (weights ? weights[i] : 1) * d * d; });
  return { S2: c2, mean, spread: Math.sqrt(v / sw), n: angles.length };
}
/** A histogram of angles (−90..90, `bins` bins), weighted, normalised to sum 1. */
function orHist(angles, weights, bins = 36) {
  const h = new Float64Array(bins); let sw = 0;
  angles.forEach((a, i) => { const k = Math.min(bins - 1, Math.max(0, Math.floor((a + 90) / 180 * bins))), w = weights ? weights[i] : 1; h[k] += w; sw += w; });
  for (let k = 0; k < bins; k++) h[k] /= sw || 1;
  return h;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { orRng, orBeta, orEnsemble, orAligned, orCopy, orA, orEig, orStats, orGammaDot, orDr, orStep, orDt, orRun, orSteady, orTraces, orCutStats, orHist };
