/*
 * cfd-3d-stream.js — streamlines through a solved 3D flow (Coating › 3D).
 *
 * The solve's mesh (cfd-fem3d.js): 27-node hexahedra on spines, nodes (c, l, k) — c along the flow, l across the web,
 * k up the spine from the web — numbered (c * NL + l) * NR + k, every element 3 nodes a side. A line is traced in the
 * mesh's own coordinates (C, L, K), continuous from element to element: in each element the position and velocity are
 * its quadratic interpolation of the nodes', and d(C, L, K)/dt = J⁻¹ (u, v, w), J the element's map to x, y, z. So a
 * line crosses elements exactly and cannot leave the flow: K is held between the web and the blade or free surface,
 * L between the region's sides (open sides -- a skewed blade's, the flow passing through them -- end a line that
 * leaves through one); it ends at the outlet, back out of the inlet, where the flow stops, or after maxSteps.
 *
 * Seeds: at the inlet, spaced by equal flow rate up the gap (so lines crowd where the flow is fast, as the 2D's
 * automatic seeds), at evenly spaced stations across the region.
 *
 * streamlines3D(R, { across, up, step, maxSteps, open }) -> { lines: [{ pos: Float64Array (x, y, z per point, m),
 *   cc: Float64Array (C, L, K per point), end: 'outlet' | 'inlet' | 'side' | 'stalled' | 'steps' }], seeds: [[C, L, K]] }
 * traceLine3D(R, [C, L, K], { step, maxSteps, sign, open }): one line from a point (sign -1: against the flow; open: the
 *   region's sides let the flow through, default for a result with a skewed blade, R.skew)
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
  const J = w.J; J[0] = xa; J[1] = xb; J[2] = xc; J[3] = ya; J[4] = yb; J[5] = yc; J[6] = za; J[7] = zb; J[8] = zc;
  if (!(Math.abs(det) > 0)) { w.dC = w.dL = w.dK = 0; return w; }
  w.dC = (u * (yb * zc - yc * zb) - xb * (v * zc - yc * ww) + xc * (v * zb - yb * ww)) / det;
  w.dL = (xa * (v * zc - yc * ww) - u * (ya * zc - yc * za) + xc * (ya * ww - v * za)) / det;
  w.dK = (xa * (yb * ww - v * zb) - xb * (ya * ww - v * za) + u * (ya * zb - yb * za)) / det;
  return w;
}
const sl3Work = () => ({ e: {}, J: new Float64Array(9), a: new Float64Array(3), b: new Float64Array(3), c: new Float64Array(3), da: new Float64Array(3), db: new Float64Array(3), dc: new Float64Array(3) });

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

/**
 * One line from (C, L, K) with the flow (sign -1: against it). hold: null (the full 3D volume: d(C, L, K)/dt = J⁻¹ (u, v, w))
 * or 'L' | 'K' | 'C' -- a slice: that mesh coordinate held, the line moving with the velocity's part along the slice (the
 * least-squares solution of J's other two columns times the rates = (u, v, w), i.e. the velocity projected onto the slice's
 * tangent plane): 'L' a station (the plane z = its z exactly), 'K' a surface at a fixed share of the gap, 'C' a spine
 * surface across the web. maxLength (m): the line stops once this long. The velocity is kept at each point (vel: u, v, w).
 */
function traceLine3D(R, [C, L, K], { step = 0.05, maxSteps, sign = 1, open = !!R.skew, hold = null, maxLength = Infinity } = {}) {
  const C1 = R.NC - 1, L1 = R.NL - 1, K1 = R.NR - 1, w = sl3Work();
  maxSteps = maxSteps || Math.ceil(4 * (C1 + L1 + K1) / step);   // (a line four times as long as the mesh is across: a loop)
  const clampL = L => Math.min(L1, Math.max(0, L)), clampK = K => Math.min(K1, Math.max(0, K));
  const hi = hold === 'C' ? 0 : hold === 'L' ? 1 : hold === 'K' ? 2 : -1;
  const f = (C, L, K, o) => {
    sl3Eval(R, C, L, K, w);
    if (hi < 0) { o[0] = sign * w.dC; o[1] = sign * w.dL; o[2] = sign * w.dK; return o; }
    // (a slice: the two free columns a, b of J; rates r solving [a b] r = U in least squares)
    const J = w.J, cols = [0, 1, 2].filter(i => i !== hi), a = [J[cols[0]], J[3 + cols[0]], J[6 + cols[0]]], b = [J[cols[1]], J[3 + cols[1]], J[6 + cols[1]]], U = [w.u, w.v, w.w];
    const aa = a[0] * a[0] + a[1] * a[1] + a[2] * a[2], ab = a[0] * b[0] + a[1] * b[1] + a[2] * b[2], bb = b[0] * b[0] + b[1] * b[1] + b[2] * b[2];
    const au = a[0] * U[0] + a[1] * U[1] + a[2] * U[2], bu = b[0] * U[0] + b[1] * U[1] + b[2] * U[2], dt = aa * bb - ab * ab;
    const r0 = dt > 0 ? (bb * au - ab * bu) / dt : 0, r1 = dt > 0 ? (aa * bu - ab * au) / dt : 0;
    o[0] = o[1] = o[2] = 0; o[cols[0]] = sign * r0; o[cols[1]] = sign * r1; return o;
  };
  const k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0], pos = [], cc = [], vel = [];
  let len = 0, px = null;
  const push = () => { sl3Eval(R, C, L, K, w); if (px) len += Math.hypot(w.x - px[0], w.y - px[1], w.z - px[2]); px = [w.x, w.y, w.z]; pos.push(w.x, w.y, w.z); cc.push(C, L, K); vel.push(w.u, w.v, w.w); };
  push();
  let end = 'steps', vRef = 0;
  for (let s = 0; s < maxSteps; s++) {
    if (!(Number.isFinite(C) && Number.isFinite(L) && Number.isFinite(K))) { end = 'invalid'; break; }
    f(C, L, K, k1);
    const sp = Math.max(Math.abs(k1[0]), Math.abs(k1[1]), Math.abs(k1[2]));
    vRef = Math.max(vRef, sp);
    if (!(sp > 0) || sp < 1e-9 * vRef) { end = 'stalled'; break; }
    const h = step / sp;
    f(C + 0.5 * h * k1[0], clampL(L + 0.5 * h * k1[1]), clampK(K + 0.5 * h * k1[2]), k2);
    f(C + 0.5 * h * k2[0], clampL(L + 0.5 * h * k2[1]), clampK(K + 0.5 * h * k2[2]), k3);
    f(C + h * k3[0], clampL(L + h * k3[1]), clampK(K + h * k3[2]), k4);
    const Cn = C + h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]), Lr = L + h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    const Ln = clampL(Lr), Kn = clampK(K + h / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]));
    // (out through an open side first: the last point on that side)
    if (open && (Lr > L1 || Lr < 0)) {
      const b = Lr > L1 ? L1 : 0, t = (b - L) / (Lr - L), Ct = C + t * (Cn - C);
      if (Ct < C1 && Ct > 0) { C = Ct; L = b; K = K + t * (Kn - K); push(); end = 'side'; break; }
    }
    // (out of the outlet or back out of the inlet: the last point on that face)
    if (Cn >= C1 || Cn <= 0) { const b = Cn >= C1 ? C1 : 0, t = (b - C) / (Cn - C); C = b; L = L + t * (Ln - L); K = K + t * (Kn - K); push(); end = b ? 'outlet' : 'inlet'; break; }
    C = Cn; L = Ln; K = Kn;
    push();
    if (len >= maxLength) { end = 'length'; break; }
  }
  return { pos: Float64Array.from(pos), cc: Float64Array.from(cc), vel: Float64Array.from(vel), end };
}
/** A line through a seed inside the flow: traced against the flow back to where it came from, then on with it (one line, the seed on it). */
function traceThrough3D(R, seed, opts = {}) {
  const b = traceLine3D(R, seed, { ...opts, sign: -1 }), f = traceLine3D(R, seed, { ...opts, sign: 1 }), nb = b.pos.length / 3;
  const rev = (a, n) => { const o = new Float64Array(3 * n); for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) o[3 * i + j] = a[3 * (n - 1 - i) + j]; return o; };
  const cat = (x, y) => { const o = new Float64Array(x.length + y.length - 3); o.set(x); o.set(y.subarray(3), x.length); return o; };
  return { pos: cat(rev(b.pos, nb), f.pos), cc: cat(rev(b.cc, nb), f.cc), vel: cat(rev(b.vel, nb), f.vel), end: f.end, start: b.end, seedAt: nb - 1 };
}

/**
 * Where a point (x, y, z; m, in the result's own frame) lies in the flow: its mesh coordinates [C, L, K], or null outside
 * it (under the web, in the blade, above the free surface, before the inlet or past the outlet, beyond the region's sides).
 * A start from the mesh's own lines (the station by z, the column by x along the web there, the row by y up that spine),
 * then Newton on the elements' map.
 */
function locate3D(R, x, y, z) {
  const C1 = R.NC - 1, L1 = R.NL - 1, K1 = R.NR - 1, id = (c, l, k) => (c * R.NL + l) * R.NR + k, w = sl3Work();
  const bis = (n, f, v) => { let a = 0, b = n; const up = f(n) >= f(0); for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if ((f(m) < v) === up) a = m; else b = m; } return (a + b) / 2; };
  const lin = (arr, t) => { const i = Math.min(arr.length - 2, Math.max(0, Math.floor(t))); return arr(i) + (t - i) * (arr(i + 1) - arr(i)); };
  const zl = l => R.z[id(0, l, 0)], L0 = Math.min(L1, Math.max(0, bis(L1, t => { const i = Math.min(L1 - 1, Math.floor(t)); return zl(i) + (t - i) * (zl(i + 1) - zl(i)); }, z)));
  const l0 = Math.round(L0), xc = c => R.x[id(c, l0, 0)];
  const C0 = Math.min(C1, Math.max(0, bis(C1, t => { const i = Math.min(C1 - 1, Math.floor(t)); return xc(i) + (t - i) * (xc(i + 1) - xc(i)); }, x)));
  const c0 = Math.round(C0), yk = k => R.y[id(c0, l0, k)];
  const K0 = Math.min(K1, Math.max(0, bis(K1, t => { const i = Math.min(K1 - 1, Math.floor(t)); return yk(i) + (t - i) * (yk(i + 1) - yk(i)); }, y)));
  void lin;
  let C = C0, L = L0, K = K0;
  const scale = Math.max(Math.abs(R.x[id(C1, 0, 0)] - R.x[0]), 1e-9);
  for (let it = 0; it < 40; it++) {
    sl3Eval(R, C, L, K, w);   // (beyond the mesh, its last element's map carried on: smooth, so Newton finds points just outside as outside)
    const r = [x - w.x, y - w.y, z - w.z], J = w.J;
    const det = J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6]);
    if (!(Math.abs(det) > 0)) return null;
    const d0 = (r[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (r[1] * J[8] - J[5] * r[2]) + J[2] * (r[1] * J[7] - J[4] * r[2])) / det;
    const d1 = (J[0] * (r[1] * J[8] - J[5] * r[2]) - r[0] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * r[2] - r[1] * J[6])) / det;
    const d2 = (J[0] * (J[4] * r[2] - r[1] * J[7]) - J[1] * (J[3] * r[2] - r[1] * J[6]) + r[0] * (J[3] * J[7] - J[4] * J[6])) / det;
    // (within an element the map is its own; outside the range the last element's continues it, so a point outside stays outside)
    C += d0; L += d1; K += d2;
    if (Math.hypot(r[0], r[1], r[2]) < 1e-12 * scale && Math.abs(d0) + Math.abs(d1) + Math.abs(d2) < 1e-10) break;
  }
  const e = 1e-7;
  if (!(C >= -e && C <= C1 + e && L >= -e && L <= L1 + e && K >= -e && K <= K1 + e)) return null;
  sl3Eval(R, Math.min(C1, Math.max(0, C)), Math.min(L1, Math.max(0, L)), Math.min(K1, Math.max(0, K)), w);
  if (Math.hypot(x - w.x, y - w.y, z - w.z) > 1e-7 * scale) return null;
  return [Math.min(C1, Math.max(0, C)), Math.min(L1, Math.max(0, L)), Math.min(K1, Math.max(0, K))];
}

/**
 * Seeds (mesh coordinates, inside the flow) from a seed specification (m, the result's frame), and the points asked for
 * that lie outside it (in the blade, above the surface: left out). spec.kind:
 *  'inlet' { across, up }: at the inlet, spaced by equal flow up the gap, at evenly spaced stations across (the default);
 *  'point' { pts: [[x, y, z], ...] }: the points themselves (one, or a list typed in);
 *  'zline' { x, y, n }: across the region from its lowest z to its highest, at x and y;
 *  'yline' { x, z, n }: up from the web to the blade or surface at x and z (the local height's n middles);
 *  'plane' { plane: 'xy' | 'xz' | 'yz', at (m: z, y or x), n1, n2 }: a grid over the region's extent in that plane;
 *  'volume' { n1, n2, n3 }: a regular grid in the flow (along, across, up the mesh: every point inside it);
 *  'multi' { specs: [...] }: several of these together.
 */
function seeds3D(R, spec) {
  const C1 = R.NC - 1, L1 = R.NL - 1, K1 = R.NR - 1, id = (c, l, k) => (c * R.NL + l) * R.NR + k, out = [], outside = [];
  const add = (x, y, z) => { const s = locate3D(R, x, y, z); if (s) out.push(s); else outside.push([x, y, z]); };
  let zMin = Infinity, zMax = -Infinity, xMin = Infinity, xMax = -Infinity, yMax = 0;
  for (let n = 0; n < R.x.length; n++) { zMin = Math.min(zMin, R.z[n]); zMax = Math.max(zMax, R.z[n]); xMin = Math.min(xMin, R.x[n]); xMax = Math.max(xMax, R.x[n]); yMax = Math.max(yMax, R.y[n]); }
  const mid = (a, b, i, n) => a + (b - a) * (i + 0.5) / n, span = (a, b, i, n) => n === 1 ? (a + b) / 2 : a + (b - a) * i / (n - 1);
  const k = spec.kind || 'inlet';
  if (k === 'inlet') {
    const c0 = 1e-3;
    for (let a = 0; a < (spec.across || 6); a++) { const L = L1 * (a + 0.5) / (spec.across || 6); for (const K of sl3InletSeeds(R, L, spec.up || 10, c0)) out.push([c0, L, K]); }
  } else if (k === 'point') for (const [x, y, z] of spec.pts || []) add(x, y, z);
  else if (k === 'zline') {
    // (the region's extent across at x and y: its two sides there -- the point in the middle located, then out along its row)
    const n = Math.max(1, spec.n || 9), s = locate3D(R, spec.x, spec.y, (zMin + zMax) / 2);
    if (!s) { outside.push([spec.x, spec.y, (zMin + zMax) / 2]); return { seeds: out, outside }; }
    const w = sl3Work(), zAt = L => { sl3Eval(R, s[0], L, s[2], w); return w.z; }, z0 = zAt(0), z1 = zAt(L1), e = (z1 - z0) * 1e-9;
    for (let i = 0; i < n; i++) add(spec.x, spec.y, span(z0 + e, z1 - e, i, n));
  } else if (k === 'yline') {
    // (the local height at x, z: the fluid's top there -- the top's column at x found along the top row at that station)
    const s = locate3D(R, spec.x, 1e-9 * Math.max(yMax, 1e-9), spec.z);
    if (s) {
      const w = sl3Work(), xTop = C => { sl3Eval(R, C, s[1], K1, w); return w.x; };
      let a = 0, b = C1; const up = xTop(C1) >= xTop(0);
      for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if ((xTop(m) < spec.x) === up) a = m; else b = m; }
      sl3Eval(R, (a + b) / 2, s[1], K1, w);
      const top = w.y, n = Math.max(1, spec.n || 9); for (let i = 0; i < n; i++) add(spec.x, mid(0, top, i, n), spec.z);
    } else outside.push([spec.x, 0, spec.z]);
  } else if (k === 'plane') {
    const n1 = Math.max(1, spec.n1 || 9), n2 = Math.max(1, spec.n2 || 6);
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
      if (spec.plane === 'xy') add(mid(xMin, xMax, i, n1), mid(0, yMax, j, n2), spec.at);
      else if (spec.plane === 'xz') add(mid(xMin, xMax, i, n1), spec.at, span(zMin, zMax, j, n2));
      else add(spec.at, mid(0, yMax, j, n2), span(zMin, zMax, i, n1));
    }
  } else if (k === 'multi') { for (const q of spec.specs || []) { const r = seeds3D(R, q); out.push(...r.seeds); outside.push(...r.outside); } }
  else if (k === 'volume') {
    const n1 = Math.max(1, spec.n1 || 8), n2 = Math.max(1, spec.n2 || 5), n3 = Math.max(1, spec.n3 || 4);
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) for (let m = 0; m < n3; m++) out.push([C1 * (i + 0.5) / n1, L1 * (j + 0.5) / n2, K1 * (m + 0.5) / n3]);
  }
  void id;
  return { seeds: out, outside };
}

/**
 * Streamlines from seeds: the inlet's (across, up: traced on with the flow), or any seed specification (seeds3D: traced
 * back and on through each seed). hold: a slice (traceLine3D) or null, the full 3D volume.
 */
function streamlines3D(R, { across = 6, up = 10, step = 0.05, maxSteps, open, seeds: spec = null, hold = null, maxLength } = {}) {
  const S = seeds3D(R, spec || { kind: 'inlet', across, up }), inlet = !spec || spec.kind === 'inlet';
  const o = { step, maxSteps, open, hold, maxLength };
  return { lines: S.seeds.map(sd => inlet ? traceLine3D(R, sd, o) : traceThrough3D(R, sd, o)), seeds: S.seeds, outside: S.outside };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { streamlines3D, traceLine3D, traceThrough3D, locate3D, seeds3D, sample3D, sl3Eval, sl3Work, sl3InletSeeds };
