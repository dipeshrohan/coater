/*
 * cfd-3d-stream.js — streamlines through a solved 3D flow (Flow › 3D).
 *
 * The solve's mesh (cfd-fem3d.js): 27-node hexahedra on spines, nodes (c, l, k) — c along the flow, l across the web,
 * k up the spine from the web — numbered (c * NL + l) * NR + k, every element 3 nodes a side. A line is traced in the
 * mesh's own coordinates (C, L, K), continuous from element to element: in each element the position and velocity are
 * its quadratic interpolation of the nodes', and d(C, L, K)/dt = J⁻¹ (u, v, w), J the element's map to x, y, z. So a
 * line crosses elements exactly and cannot leave the flow: K is held between the web and the blade or free surface,
 * L between the region's sides; it ends at the outlet, back out of the inlet, where the flow stops, or after maxSteps.
 *
 * Seeds: at the inlet, spaced by equal flow rate up the gap (so lines crowd where the flow is fast, as the 2D's
 * automatic seeds), at evenly spaced stations across the region.
 *
 * streamlines3D(R, { across, up, step, maxSteps }) -> { lines: [{ pos: Float64Array (x, y, z per point, m),
 *   cc: Float64Array (C, L, K per point), end: 'outlet' | 'inlet' | 'stalled' | 'steps' }], seeds: [[C, L, K]] }
 * traceLine3D(R, [C, L, K], { step, maxSteps, sign }): one line from a point (sign -1: against the flow)
 *   R: a 3D result (NC, NR, NL; x, y, z, u, v, w per node, m and m/s); step: the largest move of C, L or K a step (0.05:
 *   the lines then follow the solved flow as closely as its mesh resolves it; maxSteps: 4 times the mesh across)
 * sample3D(R, vals, C, L, K): a node array's value at (C, L, K)
 */

/** Quadratic Lagrange on the nodes at -1, 0, 1: values and derivatives. */
function q2w(t, o) { o[0] = 0.5 * t * (t - 1); o[1] = 1 - t * t; o[2] = 0.5 * t * (t + 1); }
function q2d(t, o) { o[0] = t - 0.5; o[1] = -2 * t; o[2] = t + 0.5; }

/** The element holding (C, L, K) and the local coordinates in it. */
function sl3Locate(R, C, L, K, e) {
  const nx = (R.NC - 1) >> 1, nz = (R.NL - 1) >> 1, ny = (R.NR - 1) >> 1;
  const i = Math.min(nx - 1, Math.max(0, Math.floor(C / 2))), j = Math.min(nz - 1, Math.max(0, Math.floor(L / 2))), m = Math.min(ny - 1, Math.max(0, Math.floor(K / 2)));
  e.c0 = 2 * i; e.l0 = 2 * j; e.k0 = 2 * m;
  e.xi = C - 2 * i - 1; e.eta = L - 2 * j - 1; e.zeta = K - 2 * m - 1;
}

/** Position, velocity and d(C, L, K)/dt at (C, L, K). */
function sl3Eval(R, C, L, K, w) {
  const e = w.e; sl3Locate(R, C, L, K, e);
  q2w(e.xi, w.a); q2w(e.eta, w.b); q2w(e.zeta, w.c); q2d(e.xi, w.da); q2d(e.eta, w.db); q2d(e.zeta, w.dc);
  const NL = R.NL, NR = R.NR;
  let x = 0, y = 0, z = 0, u = 0, v = 0, ww = 0;
  let xa = 0, xb = 0, xc = 0, ya = 0, yb = 0, yc = 0, za = 0, zb = 0, zc = 0;
  for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) for (let r = 0; r < 3; r++) {
    const n = ((e.c0 + p) * NL + e.l0 + q) * NR + e.k0 + r;
    const N = w.a[p] * w.b[q] * w.c[r], Na = w.da[p] * w.b[q] * w.c[r], Nb = w.a[p] * w.db[q] * w.c[r], Nc = w.a[p] * w.b[q] * w.dc[r];
    const X = R.x[n], Y = R.y[n], Z = R.z[n];
    x += N * X; y += N * Y; z += N * Z; u += N * R.u[n]; v += N * R.v[n]; ww += N * R.w[n];
    xa += Na * X; xb += Nb * X; xc += Nc * X; ya += Na * Y; yb += Nb * Y; yc += Nc * Y; za += Na * Z; zb += Nb * Z; zc += Nc * Z;
  }
  // J = [[xa xb xc] [ya yb yc] [za zb zc]] (columns: d/dC, d/dL, d/dK); d(C, L, K)/dt = J⁻¹ (u, v, w), by Cramer's rule
  const det = xa * (yb * zc - yc * zb) - xb * (ya * zc - yc * za) + xc * (ya * zb - yb * za);
  w.x = x; w.y = y; w.z = z; w.u = u; w.v = v; w.w = ww; w.det = det;
  if (!(Math.abs(det) > 0)) { w.dC = w.dL = w.dK = 0; return w; }
  w.dC = (u * (yb * zc - yc * zb) - xb * (v * zc - yc * ww) + xc * (v * zb - yb * ww)) / det;
  w.dL = (xa * (v * zc - yc * ww) - u * (ya * zc - yc * za) + xc * (ya * ww - v * za)) / det;
  w.dK = (xa * (yb * ww - v * zb) - xb * (ya * ww - v * za) + u * (ya * zb - yb * za)) / det;
  return w;
}
const sl3Work = () => ({ e: {}, a: new Float64Array(3), b: new Float64Array(3), c: new Float64Array(3), da: new Float64Array(3), db: new Float64Array(3), dc: new Float64Array(3) });

/** A node array's value at (C, L, K). */
function sample3D(R, vals, C, L, K) {
  const e = {}, a = new Float64Array(3), b = new Float64Array(3), c = new Float64Array(3);
  sl3Locate(R, C, L, K, e); q2w(e.xi, a); q2w(e.eta, b); q2w(e.zeta, c);
  let s = 0;
  for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) for (let r = 0; r < 3; r++) s += a[p] * b[q] * c[r] * vals[((e.c0 + p) * R.NL + e.l0 + q) * R.NR + e.k0 + r];
  return s;
}

/** Seeds up the gap at the inlet at station L: equal shares of the flow into the region there (flux through C = const is dC/dt·|det J|). */
function sl3InletSeeds(R, L, n, c0) {
  const M = 400, w = sl3Work(), K1 = R.NR - 1, flux = new Float64Array(M + 1);
  for (let m = 0; m < M; m++) { const K = (m + 0.5) / M * K1; sl3Eval(R, c0, L, K, w); flux[m + 1] = flux[m] + Math.max(0, w.dC * Math.abs(w.det)) * K1 / M; }
  const tot = flux[M], out = [];
  if (!(tot > 0)) return out;
  for (let s = 0; s < n; s++) {
    const target = (s + 0.5) / n * tot;
    let m = 0; while (m < M - 1 && flux[m + 1] < target) m++;
    const f0 = flux[m], f1 = flux[m + 1], t = f1 > f0 ? (target - f0) / (f1 - f0) : 0.5;
    out.push((m + t) / M * K1);
  }
  return out;
}

/** One line from (C, L, K) with the flow (sign -1: against it). */
function traceLine3D(R, [C, L, K], { step = 0.05, maxSteps, sign = 1 } = {}) {
  const C1 = R.NC - 1, L1 = R.NL - 1, K1 = R.NR - 1, w = sl3Work();
  maxSteps = maxSteps || Math.ceil(4 * (C1 + L1 + K1) / step);   // (a line four times as long as the mesh is across: a loop)
  const clampL = L => Math.min(L1, Math.max(0, L)), clampK = K => Math.min(K1, Math.max(0, K));
  const f = (C, L, K, o) => { sl3Eval(R, C, L, K, w); o[0] = sign * w.dC; o[1] = sign * w.dL; o[2] = sign * w.dK; return o; };
  const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0], pos = [], cc = [];
  const push = () => { sl3Eval(R, C, L, K, w); pos.push(w.x, w.y, w.z); cc.push(C, L, K); };
  push();
  let end = 'steps', vRef = 0;
  for (let s = 0; s < maxSteps; s++) {
    f(C, L, K, k1);
    const sp = Math.max(Math.abs(k1[0]), Math.abs(k1[1]), Math.abs(k1[2]));
    vRef = Math.max(vRef, sp);
    if (!(sp > 0) || sp < 1e-9 * vRef) { end = 'stalled'; break; }
    const h = step / sp;
    f(C + 0.5 * h * k1[0], clampL(L + 0.5 * h * k1[1]), clampK(K + 0.5 * h * k1[2]), k2);
    f(C + 0.5 * h * k2[0], clampL(L + 0.5 * h * k2[1]), clampK(K + 0.5 * h * k2[2]), k3);
    f(C + h * k3[0], clampL(L + h * k3[1]), clampK(K + h * k3[2]), k4);
    const Cn = C + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    const Ln = clampL(L + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])), Kn = clampK(K + h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]));
    // (out of the outlet or back out of the inlet: the last point on that face)
    if (Cn >= C1 || Cn <= 0) { const b = Cn >= C1 ? C1 : 0, t = (b - C) / (Cn - C); C = b; L = L + t * (Ln - L); K = K + t * (Kn - K); push(); end = b ? 'outlet' : 'inlet'; break; }
    C = Cn; L = Ln; K = Kn;
    push();
  }
  return { pos: Float64Array.from(pos), cc: Float64Array.from(cc), end };
}

function streamlines3D(R, { across = 6, up = 10, step = 0.05, maxSteps } = {}) {
  const L1 = R.NL - 1, c0 = 1e-3, seeds = [];
  for (let a = 0; a < across; a++) {
    const L = L1 * (a + 0.5) / across;
    for (const K of sl3InletSeeds(R, L, up, c0)) seeds.push([c0, L, K]);
  }
  return { lines: seeds.map(sd => traceLine3D(R, sd, { step, maxSteps })), seeds };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { streamlines3D, traceLine3D, sample3D, sl3Eval, sl3Work, sl3InletSeeds };
