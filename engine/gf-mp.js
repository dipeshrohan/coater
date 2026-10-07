'use strict';
/*
 * gf-mp.js — MP-GF: the graphene film (the furnace's product) as a heat spreader, in 1D, 2D and 3D (mp-core.js). A piece
 * of the film lies on a heater under its middle; the heat runs along the film and through it and leaves to the room's air
 * from both faces (convection and radiation), from the room's temperature until it is steady. Its conduction is
 * anisotropic: along it k_p (the furnace's: graphite's by the film's density and its crystallites), through it k_t.
 *
 *  - 1D: along a strip from the heater's middle to the piece's edge, the heater a band across it. The film is thin (its
 *    Biot number through it, h t / k_t, ≪ 1): its temperature is even through it, and its faces' loss is a sink per
 *    volume, (faces) (h (T − T∞) + ε σ (T⁴ − T∞⁴)) / t. Checked against the fin's closed form.
 *  - 2D: the same strip's section through the film's thickness too (x along, z up): the heater on the underside over
 *    its half width, the air on the rest of the underside and on the top. Checked: a thin film is the 1D's.
 *  - 3D: a quarter of the piece (x along, y across, z up; its two mirror planes), the heater a square at the middle of
 *    the underside. Checked against the thin plate's double cosine series.
 * Under the heater the film's underside takes the heater's flux and loses nothing (the heater covers it); the piece's
 * edges (t thick) lose to the air too. SI (m, s, W, J); temperatures in °C.
 *
 * Its stress (the heat's): the film expands in its plane by α ΔT where it is warmed, the cooler film round it holds it.
 * Free and flat (no support holds it), the stress is in its plane; its through-thickness difference is tiny (the film is
 * thin: q t / k_t), so the stress is the membrane's, from the temperature through it averaged:
 *  - 1D and 2D: the heater a band across a long piece: σ_yy(x) = E (ε̄ − α ΔT(x)), ε̄ = α · the mean ΔT along x (no
 *    net force across); σ_xx = 0 (free along x). Exact far from the piece's ends (St Venant).
 *  - 3D: plane stress on the quarter's mid-plane (mp-core's mpElastic): free edges, the two mirror planes.
 */
const GFM = typeof mpMesh === 'function' ? { mpMesh, mpScalar, mpTransport, mpAt, mpElastic } : require('./mp-core.js');
const GF_SIGMA = 5.670374419e-8, GF_K0 = 273.15;

/**
 * The mesh's axes for a dimension: along x the heater's half (even) then out to the edge (graded: smallest at the
 * heater's edge); across y the same (3D); through z even. o: { dim, Lx, Ly, t, heater: { a }, mesh: { nh, nx, grade, nz } }.
 */
function gfAxes(o) {
  const m = o.mesh, a2 = Math.min(o.heater.a / 2, o.Lx / 2 * 0.999), b2 = Math.min(gfB(o) / 2, (o.Ly || o.Lx) / 2 * 0.999);
  const ax = (L2, h2) => [{ L: h2, n: m.nh }, { L: L2 - h2, n: m.nx, grade: m.grade, end: 'lo' }];
  const axes = [ax(o.Lx / 2, a2)];
  if (o.dim === 3) axes.push(ax((o.Ly || o.Lx) / 2, b2));
  if (o.dim > 1) axes.push([{ L: o.t, n: m.nz }]);
  return { axes, a2, b2 };
}
/** The heater's side across (y): b, else square (a). */
const gfB = o => (o.heater.b > 0 ? o.heater.b : o.heater.a);
/** The film's heat flux the heater gives its underside (W/m²): its power over its area. */
const gfFlux = o => o.heater.P / (o.heater.a * gfB(o));
/** Whether a point (x, y) on the underside is under the heater (a quarter: from the middle). */
const gfUnder = (o, x, y, A) => x <= A.a2 * (1 + 1e-9) && (o.dim < 3 || y <= A.b2 * (1 + 1e-9));

/**
 * The run. o: { dim, Lx, Ly (the piece's size), t (its thickness), kp, kt (W/(m K)), rho (kg/m³), c (J/(kg K)), heater: { a
 * (its side along x), b (across y; default a: a square), P (W, the whole heater's) }, air: { h (W/(m² K)), T (°C), eps }, tEnd (s), steps, snapAt ([s]), mesh: { nh, nx,
 * grade, nz }, check: { heaterLoss (the underside under the heater loses too), edges: 'air' | 'adiabatic' } (the checks'),
 * onProgress }.
 * Returns { dim, mesh: { N, E, coord }, snaps: [{ t, T: [nodal] }], hist: [{ t, Tmax, Theat, Tedge, Pout, stored }], steady:
 * { T, Tmax, Theat, Tedge, Pin, Pout }, Pin (W, the domain's share), tau (the film's own time constant), ms }.
 */
function gfRun(o) {
  const t0 = Date.now(), dim = o.dim, A = gfAxes(o), q = gfFlux(o), h = o.air.h, Tinf = o.air.T, eps = o.air.eps || 0, th = o.t;
  const chk = o.check || {}, edges = chk.edges || 'air';
  const M = GFM.mpMesh({ dim, p: 1, axes: A.axes, mat: (ijk, seg) => seg[0] === 0 && (dim < 3 || seg[1] === 0) ? 0 : 1 });
  const C = o.rho * o.c, Kv = dim === 1 ? o.kp : dim === 2 ? [o.kp, o.kt] : [o.kp, o.kp, o.kt];
  const rad = u => eps * GF_SIGMA * (Math.pow(u + GF_K0, 4) - Math.pow(Tinf + GF_K0, 4)), dRad = u => 4 * eps * GF_SIGMA * Math.pow(u + GF_K0, 3);
  const zTop = dim === 2 ? 'y1' : 'z1', zBot = dim === 2 ? 'y0' : 'z0';
  // the domain's share of the heater (a band per width in 1D and 2D: W/m; the quarter's in 3D: W)
  const Pin = dim === 3 ? q * A.a2 * A.b2 : q * A.a2;
  const opt = { K: () => Kv, C: () => C, u0: Tinf, lump: true };
  if (dim === 1) {
    // (the faces' loss and the heater as a source per volume at the nodes: under the heater one face loses, outside two)
    opt.Qn = (m, n, u) => {
      const faces = m === 0 ? (chk.heaterLoss ? 2 : 1) : 2, src = m === 0 ? q / th : 0;
      return [src - faces * (h * (u - Tinf) + rad(u)) / th, -faces * (h + dRad(u)) / th];
    };
    if (edges === 'air') opt.bc = [{ face: 'x1', type: 'robin', h: () => h, uInf: () => Tinf }];
  } else {
    const under = x => gfUnder(o, x[0], dim === 3 ? x[1] : 0, A);
    opt.bc = [
      { face: zBot, type: 'flux', q: x => (under(x) ? q : 0) },
      { face: zBot, type: 'robin', h: x => (under(x) && !chk.heaterLoss ? 0 : h), uInf: () => Tinf },
      { face: zTop, type: 'robin', h: () => h, uInf: () => Tinf },
    ];
    if (eps > 0) opt.bc.push({ face: zBot, type: 'rad', eps: x => (under(x) && !chk.heaterLoss ? 0 : eps), uInf: () => Tinf }, { face: zTop, type: 'rad', eps: () => eps, uInf: () => Tinf });
    if (edges === 'air') { opt.bc.push({ face: 'x1', type: 'robin', h: () => h, uInf: () => Tinf }); if (dim === 3) opt.bc.push({ face: 'y1', type: 'robin', h: () => h, uInf: () => Tinf }); }
  }
  if (eps > 0) opt.picard = 30;
  // (the measures: the hottest point, the heater's mean (on the film's underside under it), the far edge's middle)
  const nodesUnder = [], edgeNodes = [], vol = new Float64Array(M.N);
  for (let n = 0; n < M.N; n++) {
    const x = M.X.subarray(n * dim, n * dim + dim), onBot = dim === 1 || Math.abs(x[dim - 1]) < 1e-15;
    if (onBot && gfUnder(o, x[0], dim === 3 ? x[1] : 0, A)) nodesUnder.push(n);
    if (Math.abs(x[0] - o.Lx / 2) < 1e-12 * o.Lx && (dim < 3 || Math.abs(x[1]) < 1e-12)) edgeNodes.push(n);
  }
  const meas = u => { let mx = -Infinity, s = 0, e = 0; for (let n = 0; n < M.N; n++) mx = Math.max(mx, u[n]); for (const n of nodesUnder) s += u[n]; for (const n of edgeNodes) e += u[n]; return { Tmax: mx, Theat: s / nodesUnder.length, Tedge: e / edgeNodes.length }; };
  // the transient from the room's temperature
  const steps = Math.max(1, o.steps || 60), tEnd = o.tEnd || 300;
  const T = GFM.mpTransport(M, opt), snaps = [], hist = [];
  const snapAt = new Set((o.snapAt || [0, 0.05, 0.2, 1].map(f => f * tEnd)).map(v => Math.round(v * 1e6) / 1e6));
  let t = 0;
  // (the loss to the air: in 2D and 3D the heater's flux less what flows in through the faces with a condition)
  const faces = dim === 1 ? [] : [...new Set(opt.bc.map(b => b.face))];
  const loss = X => (dim === 1 ? gfLoss1(M, X.u, o, A, rad) : faces.reduce((s, f) => s - X.faceIn(f), Pin));
  const lossNow = () => loss(T);
  const push = () => { hist.push({ t, ...meas(T.u), Pout: lossNow() }); if ([...snapAt].some(v => Math.abs(v - t) <= 1e-9 * tEnd)) snaps.push({ t, T: Array.from(T.u) }); };
  push();
  // (geometric steps: the first a tenth of the film's own time ρ c t / (2h), each the same factor longer to the end)
  const { dt0, r } = gfSteps(o);
  const times = []; let tt = 0; for (let k = 0; k < steps; k++) { tt += dt0 * Math.pow(r, k); times.push(k === steps - 1 ? tEnd : tt); }
  for (const s of snapAt) if (s > 0 && s < tEnd && !times.some(v => Math.abs(v - s) <= 1e-9 * tEnd)) times.push(s);
  times.sort((a, b) => a - b);
  for (let k = 0; k < times.length; k++) {
    const dt = times[k] - t;
    T.step(times[k], dt); t = times[k];
    push();
    if (o.onProgress && (k % 5 === 0 || k === times.length - 1)) o.onProgress({ k: k + 1, n: times.length + 1 });
  }
  // and steady
  const S = GFM.mpTransport(M, opt);
  S.steady(0);
  const steady = { T: Array.from(S.u), ...meas(S.u), Pin, Pout: loss(S) };
  // the stress the heat gives (at the end of the time on the heater, and steady)
  const film = o.film && Number.isFinite(o.film.E) && Number.isFinite(o.film.alpha) ? o.film : null;
  let stress = null;
  if (film) {
    stress = { end: gfStress(M, T.u, o, film), steady: gfStress(M, S.u, o, film) };
    for (const sn of snaps) sn.s = gfStress(M, Float64Array.from(sn.T), o, film).sMax;
  }
  if (o.onProgress) o.onProgress({ k: times.length + 1, n: times.length + 1 });
  return { dim, mesh: { N: M.N, E: M.E, coord: M.coord, nn: M.nn }, snaps, hist, steady, stress, Pin, q, tau: C * th / (2 * h), ms: Date.now() - t0 };
}
/**
 * The time steps: the first a tenth of the film's own time (ρ c t / 2h, h with the radiation's about the room) -- or the
 * time over the steps when that is shorter -- each the same factor r longer, their sum the time on the heater.
 * Returns { dt0, r, tau }.
 */
function gfSteps(o) {
  const n = Math.max(1, o.steps || 60), tEnd = o.tEnd || 300, hr = 4 * (o.air.eps || 0) * GF_SIGMA * Math.pow(o.air.T + GF_K0, 3);
  const tau = o.rho * o.c * o.t / (2 * (o.air.h + hr)), dt0 = Math.min(tau / 10, tEnd / n);
  // (r from dt0 (rⁿ − 1)/(r − 1) = tEnd, by bisection; r = 1 when the steps are even)
  if (dt0 * n >= tEnd * (1 - 1e-12)) return { dt0: tEnd / n, r: 1, tau };
  let lo = 1, hi = 2; while (dt0 * (Math.pow(hi, n) - 1) / (hi - 1) < tEnd) hi *= 2;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (dt0 * (Math.pow(m, n) - 1) / (m - 1) < tEnd) lo = m; else hi = m; }
  return { dt0, r: (lo + hi) / 2, tau };
}
/** The 1D's loss to the air (W per width, the strip's half): its faces' sink integrated over the strip (trapezoid at the
 *  nodes, as the lumped source), the edge's convection. */
function gfLoss1(M, u, o, A, rad) {
  const x = M.coord[0], h = o.air.h, Tinf = o.air.T, chk = o.check || {};
  let P = 0;
  for (let i = 0; i < x.length - 1; i++) {
    const L = x[i + 1] - x[i], faces = x[i + 1] <= A.a2 * (1 + 1e-9) ? (chk.heaterLoss ? 2 : 1) : 2;
    for (const j of [i, i + 1]) P += faces * (h * (u[j] - Tinf) + rad(u[j])) * L / 2;
  }
  if ((chk.edges || 'air') === 'air') P += h * (u[x.length - 1] - Tinf) * o.t;
  return P;
}

/**
 * The stress the temperature u gives the film (Pa), from its rise through it averaged (the membrane's). 1D and 2D: the
 * long piece's σ_yy along x (each node of x; ε̄ the rise's mean by the trapezoid rule); 3D: plane stress on the quarter's
 * mid-plane (x, y): σ_xx, σ_yy, σ_xy and the largest principal at its nodes. Returns { x, (y), syy | sxx, syy, sxy, s1,
 * sMax (the largest tension), sMin (the largest compression), eBar (1D/2D) }.
 */
function gfStress(M, u, o, film) {
  const dim = M.dim, Tinf = o.air.T, E = film.E, al = film.alpha, nu = film.nu || 0;
  const xs = M.coord[0], nx = xs.length;
  if (dim < 3) {
    // (the rise through the film averaged at each x: 2D's nodes through z by the trapezoid rule)
    const dT = new Float64Array(nx);
    if (dim === 1) for (let i = 0; i < nx; i++) dT[i] = u[i] - Tinf;
    else {
      const zs = M.coord[1], H = zs[zs.length - 1] - zs[0];
      for (let i = 0; i < nx; i++) { let a = 0; for (let k = 0; k < zs.length - 1; k++) a += (u[M.node([i, k])] + u[M.node([i, k + 1])]) / 2 * (zs[k + 1] - zs[k]); dT[i] = a / H - Tinf; }
    }
    let m = 0; for (let i = 0; i < nx - 1; i++) m += (dT[i] + dT[i + 1]) / 2 * (xs[i + 1] - xs[i]);
    const eBar = al * m / (xs[nx - 1] - xs[0]), syy = Array.from(dT, d => E * (eBar - al * d));
    return { x: Array.from(xs), syy, eBar, sMax: Math.max(...syy), sMin: Math.min(...syy) };
  }
  // 3D: the mid-plane's mesh (the quarter's x and y), its rise through the film averaged
  const ys = M.coord[1], zs = M.coord[2], H = zs[zs.length - 1] - zs[0];
  const P = gfPlane(xs, ys), dT = new Float64Array(P.N);
  for (let i = 0; i < xs.length; i++) for (let j = 0; j < ys.length; j++) {
    let a = 0; for (let k = 0; k < zs.length - 1; k++) a += (u[M.node([i, j, k])] + u[M.node([i, j, k + 1])]) / 2 * (zs[k + 1] - zs[k]);
    dT[P.node([i, j])] = a / H - Tinf;
  }
  const r = GFM.mpElastic(P, { mats: [{ E, nu }], plane: 'stress', fields: { d: dT }, eig: (m, x, f) => [al * f.d, al * f.d, 0, 0, 0, 0], bc: [{ face: 'x0', fix: [0] }, { face: 'y0', fix: [1] }] });
  const sxx = new Array(P.N), syy = new Array(P.N), sxy = new Array(P.N);
  for (let n = 0; n < P.N; n++) { sxx[n] = r.stress[n * 6]; syy[n] = r.stress[n * 6 + 1]; sxy[n] = r.stress[n * 6 + 5]; }
  const s1 = Array.from(r.s1), s2 = sxx.map((a, n) => (a + syy[n]) / 2 - Math.hypot((a - syy[n]) / 2, sxy[n]));
  return { x: Array.from(xs), y: Array.from(ys), sxx, syy, sxy, s1, sMax: Math.max(...s1), sMin: Math.min(...s2) };
}
/** The mid-plane's mesh on the 3D's own x and y node coordinates (the same nodes, so a node's (i, j) is the 3D's). */
function gfPlane(xs, ys) {
  const seg = c => c.slice(1).map((v, i) => ({ L: v - c[i], n: 1 }));
  return GFM.mpMesh({ dim: 2, p: 1, axes: [seg(xs), seg(ys)] });
}

// ---- the checks' closed forms ----
/**
 * The 1D strip's steady temperature rise (ε = 0, the edge adiabatic): under the heater (0 < x < b) one face loses
 * (two with heaterLoss), outside two: k t θ'' = n h θ − q (inside), 2 h θ (outside); θ' = 0 at 0 and L.
 */
function gfFin1(o, x) {
  const k = o.kp, t = o.t, h = o.air.h, q = gfFlux(o), b = o.heater.a / 2, L = o.Lx / 2, n1 = o.check && o.check.heaterLoss ? 2 : 1;
  const m1 = Math.sqrt(n1 * h / (k * t)), m2 = Math.sqrt(2 * h / (k * t)), th1 = q / (n1 * h);
  // θ1 = th1 + A cosh(m1 x); θ2 = B cosh(m2 (L − x)); θ and θ' continuous at b
  const c1 = Math.cosh(m1 * b), s1 = Math.sinh(m1 * b), c2 = Math.cosh(m2 * (L - b)), s2 = Math.sinh(m2 * (L - b));
  // th1 + A c1 = B c2;  A m1 s1 = −B m2 s2  →  B = th1 / (c2 + c1 m2 s2 / (m1 s1))
  const B = th1 / (c2 + c1 * m2 * s2 / (m1 * s1)), Acoef = -B * m2 * s2 / (m1 * s1);
  return x <= b ? th1 + Acoef * Math.cosh(m1 * x) : B * Math.cosh(m2 * (L - x));
}
/**
 * The thin plate's steady temperature rise on the quarter [0, X] × [0, Y] (its edges adiabatic, both faces losing h
 * everywhere, ε = 0, the heater's flux q on [0, c] × [0, d]): k t ∇²θ − 2 h θ + q χ = 0 by its double cosine series.
 */
function gfPlate(o, x, y, terms = 300) {
  const k = o.kp, t = o.t, h = o.air.h, q = gfFlux(o), X = o.Lx / 2, Y = (o.Ly || o.Lx) / 2, c = o.heater.a / 2, d = Math.min(gfB(o), 2 * Y) / 2;
  const S = (m, L, a) => (m === 0 ? a : L / (m * Math.PI) * Math.sin(m * Math.PI * a / L));
  let th = 0;
  for (let m = 0; m < terms; m++) {
    const em = m ? 2 : 1, sm = S(m, X, c), cx = Math.cos(m * Math.PI * x / X), lm = (m * Math.PI / X) ** 2;
    for (let n = 0; n < terms; n++) {
      const en = n ? 2 : 1, qmn = q * em * en / (X * Y) * sm * S(n, Y, d);
      th += qmn / (k * t * (lm + (n * Math.PI / Y) ** 2) + 2 * h) * cx * Math.cos(n * Math.PI * y / Y);
    }
  }
  return th;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { gfRun, gfAxes, gfFlux, gfFin1, gfPlate, gfLoss1, gfStress, gfPlane, gfSteps };
