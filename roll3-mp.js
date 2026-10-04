'use strict';
/*
 * roll3-mp.js — MP-PEEL 3D: the roll the winder makes, in 3D (mp-core.js's heat and moisture together): a quarter of the
 * roll's end (its mirror planes) and half its width (its middle a mirror), from the core to the outer turn. Its heat and
 * its water at rest until it is cut: through the turns (r: the film's through-thickness conduction and vapour
 * permeability, as the 1D's) and along them (θ and the width z: the film's in its plane, and the water along the turns'
 * faces, as the pressed stack's along the pieces); the outer turn and the roll's ends in the room's air, the core sealed.
 * The 1D (peel-mp.js's pmpRoll) is the roll's middle far from its ends; the 3D adds the ends.
 *
 * The conduction and the permeability: K_r out through the turns, K_z along the roll's axis (the film's in its plane);
 * round the roll nothing changes (the turns are alike all round), so the value there is the radial one.
 * SI (m, s, kg, J); temperatures in °C; the water X kg per kg of GO, held S = ρ_D X(a), a = p / p_sat(T) (GAB).
 */
const R3 = typeof mpMesh === 'function' ? { mpMesh, mpHeatMoisture } : require('./mp-core.js');
const R3_DR = typeof drPsat === 'function' ? { drPsat, drLatent } : (() => { try { return require('./drying.js'); } catch (e) { return {}; } })();
const r3GAB = (a, g) => { const Ka = g.K * Math.min(Math.max(a, 0), 1); return g.Xm * g.C * Ka / ((1 - Ka) * (1 - Ka + g.C * Ka)); };
function r3GABinv(X, g) { let lo = 0, hi = 1; if (X >= r3GAB(1, g)) return 1; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (r3GAB(m, g) < X) lo = m; else hi = m; } return (lo + hi) / 2; }

/** The roll's mesh: r from the core out (graded toward the outer turn), θ over a quarter, z from the middle of its width
 *  to its end (graded toward the end). o: { R0, R1, W, mesh: { nr, nth, nz, gr, gz } }. */
function r3Axes(o) {
  const m = o.mesh;
  return { axes: [[{ L: o.R1 - o.R0, n: m.nr, grade: m.gr || 1, end: 'hi' }], [{ L: Math.PI / 2, n: m.nth || 2 }], [{ L: o.W / 2, n: m.nz, grade: m.gz || 1, end: 'hi' }]],
    x0: [o.R0, 0, 0], map: ([r, th, z]) => [r * Math.cos(th), r * Math.sin(th), z] };
}
/** A tensor about the roll's axis at x: K_r radially, K_t round the roll, K_z along it (Voigt: xx, yy, zz, yz, xz, xy). */
function r3Tensor(x, Kr, Kt, Kz) {
  const r = Math.hypot(x[0], x[1]) || 1e-30, cx = x[0] / r, cy = x[1] / r;
  return [Kt + (Kr - Kt) * cx * cx, Kt + (Kr - Kt) * cy * cy, Kz, 0, 0, (Kr - Kt) * cx * cy];
}
/**
 * The run. o: { R0, n, h (the turns: their number, a turn's thickness), W (the roll's width), heat: { T0, k (through),
 * kIn (along), rhoc, hOut, Troom }, water: { X0, gab, Xcap, rhoD, Kv (through), KvIn (along), rhRoom }, tEnd, steps,
 * mesh: { nr, nth, nz, gr, gz }, latent (true: the water's latent heat in the heat), check: { ends: 'sealed', outer:
 * 'sealed' } (the checks'), linear: { c } (the checks': S = c p, no isotherm), onProgress }.
 * Returns { mesh: { N, coord, nn }, snaps: [{ t, T, X }], hist: [{ t, Xmean, Tmean, Xmid, Xend, Tmid, Tend }], R1, ms }.
 */
function r3Run(o) {
  const t0 = Date.now(), R1 = o.R0 + o.n * o.h, ax = r3Axes({ ...o, R1 }), M = R3.mpMesh({ dim: 3, p: 1, axes: ax.axes, x0: ax.x0, map: ax.map });
  const H = o.heat, Wt = o.water, chk = o.check || {}, psat = R3_DR.drPsat;
  const lin = o.linear || null;
  const S = lin ? (m, p) => lin.c * p : (m, p, T) => Wt.rhoD * Math.min(r3GAB(p / psat(T), Wt.gab), Wt.Xcap ?? Infinity);
  const pRoom = Wt.rhRoom * psat(H.Troom);
  const a0 = lin ? null : r3GABinv(Wt.X0, Wt.gab), p0 = lin ? (o.p0 ?? 0) : a0 * psat(H.T0);
  const bcT = [], bcV = [];
  if (chk.outer !== 'sealed') { bcT.push({ face: 'x1', type: 'robin', h: () => H.hOut, uInf: () => H.Troom }); bcV.push({ face: 'x1', type: 'value', u: () => (lin ? lin.pOut : pRoom) }); }
  if (chk.ends !== 'sealed') { bcT.push({ face: 'z1', type: 'robin', h: () => H.hOut, uInf: () => H.Troom }); bcV.push({ face: 'z1', type: 'value', u: () => (lin ? lin.pOut : pRoom) }); }
  const T = R3.mpHeatMoisture(M, {
    // (round the roll nothing changes, so its value there is free: taken as the radial one, the tensor is diag(K_r, K_r,
    //  K_z) -- exact for the roll, and no part of the large along-the-turns value leaks across the turns through the
    //  elements' chords, as it would with K_θ = K_along on a coarse mesh round the roll)
    kT: () => [H.k, H.k, H.kIn], CT: () => H.rhoc, Kv: () => [Wt.Kv, Wt.Kv, Wt.KvIn],
    S, L: o.latent && R3_DR.drLatent ? T_ => R3_DR.drLatent(T_) : 0, bcT, bcV, T0: H.T0, p0, nodal: true, bdf2: true, tol: 1e-10,
  });
  // (the water at a node: kg per kg of GO)
  const Xof = (p, Tq) => S(0, p, Tq) / (lin ? 1 : Wt.rhoD);
  const xs = M.coord[0], zs = M.coord[2], nn = M.nn;
  const node = (i, j, k) => M.node([i, j, k]);
  const iMid = Math.floor((xs.length - 1) / 2), kEnd = zs.length - 1;
  // (the roll's mean water: each node an eighth of each element round it, an element the cylinder's sector it maps,
  //  (r₂² − r₁²)/2 Δθ Δz)
  const vol = new Float64Array(M.N), thc = M.coord[1];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < thc.length - 1; j++) for (let k = 0; k < zs.length - 1; k++) {
    const V = (xs[i + 1] ** 2 - xs[i] ** 2) / 2 * (thc[j + 1] - thc[j]) * (zs[k + 1] - zs[k]);
    for (const [a, b, c] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]) vol[node(i + a, j + b, k + c)] += V / 8;
  }
  const Vtot = vol.reduce((a, v) => a + v, 0);
  const meas = () => {
    let xm = 0, tm = 0; for (let n = 0; n < M.N; n++) { xm += vol[n] * Xof(T.p[n], T.T[n]); tm += vol[n] * T.T[n]; }
    const at = (i, k) => node(i, 0, k);
    return { Xmean: xm / Vtot, Tmean: tm / Vtot, Xmid: Xof(T.p[at(iMid, 0)], T.T[at(iMid, 0)]), Xend: Xof(T.p[at(iMid, kEnd)], T.T[at(iMid, kEnd)]), Tmid: T.T[at(iMid, 0)], Tend: T.T[at(iMid, kEnd)] };
  };
  const snaps = [], hist = [], tEnd = o.tEnd, steps = Math.max(2, o.steps || 60);
  const snapAt = (o.snapAt || [0, 0.1, 0.3, 1].map(f => f * tEnd));
  const keep = t => snaps.push({ t, T: Array.from(T.T), X: Array.from(T.p, (p, n) => Xof(p, T.T[n])) });
  hist.push({ t: 0, ...meas() }); keep(0);
  // (geometric steps: the first a thousandth of the time, each the same factor longer)
  const n = steps, dt0 = tEnd / 1000;
  let lo = 1, hi = 2; while (dt0 * (Math.pow(hi, n) - 1) / (hi - 1) < tEnd) hi *= 2;
  for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (dt0 * (Math.pow(m, n) - 1) / (m - 1) < tEnd) lo = m; else hi = m; }
  const r = (lo + hi) / 2, times = []; let tt = 0;
  for (let k = 0; k < n; k++) { tt += dt0 * Math.pow(r, k); times.push(k === n - 1 ? tEnd : tt); }
  for (const s of snapAt) if (s > 0 && s < tEnd && !times.some(v => Math.abs(v - s) < 1e-9 * tEnd)) times.push(s);
  times.sort((a, b) => a - b);
  let t = 0;
  for (let k = 0; k < times.length; k++) {
    T.step(times[k], times[k] - t); t = times[k];
    hist.push({ t, ...meas() });
    if (snapAt.some(s => Math.abs(s - t) <= 1e-9 * tEnd)) keep(t);
    if (o.onProgress && (k % 5 === 0 || k === times.length - 1)) o.onProgress({ k: k + 1, n: times.length });
  }
  return { mesh: { N: M.N, E: M.E, coord: M.coord, nn }, snaps, hist, R1, water: T.water ? T.water() : null, ms: Date.now() - t0 };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { r3Run, r3Axes, r3Tensor, r3GAB, r3GABinv };
