/*
 * cfd-3d-derive.validate.js — checks of the 3D derived fields (cfd-3d-derive.js: vorticity, pressure gradient, wall shear
 * stress on the web). Run: node cfd-3d-derive.validate.js
 *  1. Quadratic fields on straight-sided (sheared) hexahedra: in the elements' own space, so every gradient exact.
 *  2. A smooth field on a curved mesh (bent spines, a curved top, uneven rows): the error falls at second order.
 *  3. The solver's manufactured solution (cfd-fem3d.validate.js 2: every component varying, shear thinning, inertia, a
 *     curved mesh): the vorticity and the pressure gradient from the solved fields against the exact ones, falling as the
 *     mesh is refined.
 *  4. The rectangular duct solved by the 3D solver: the pressure gradient is the imposed one; the wall shear stress on
 *     the bottom wall across the duct against the exact series.
 *  5. The coating flow on a strip with nothing varying across it: the 3D vorticity across the web and the wall shear stress
 *     on the web are the 2D's (cfd-fem.js omega and tauXY) at every station.
 *  6. The layout on every kind of solve the solver makes (a strip, the gap varying, a skewed blade, an open side): the shear
 *     rate from these gradients is the solver's own where a node has one element. (The full width is put together from its
 *     strips in the app, ui-3d.js: checked there, in the app's test.)
 *  7. As the app keeps a result (single precision): the fields within 0.1 % of their largest value.
 */
const { derive3D } = require('./cfd-3d-derive.js');
const gap = require('./cfd-gap-solver.js');
global.bandFactor = gap.bandFactor;
global.bandSolve = gap.bandSolve;
const { solveFEM3D, solveCoater3D } = require('./cfd-fem3d.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const maxAbs = a => { let m = 0; for (const v of a) if (Number.isFinite(v)) m = Math.max(m, Math.abs(v)); return m; };

/** A result-like object on a node grid: pos(c, l, k) -> [x, y, z], field(x, y, z) -> [u, v, w, p], mu per node. */
function gridResult(NC, NL, NR, pos, field, mu = () => 1) {
  const NN = NC * NL * NR, R = { NC, NL, NR };
  for (const f of ['x', 'y', 'z', 'u', 'v', 'w', 'p', 'mu']) R[f] = new Float64Array(NN);
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
    const n = (c * NL + l) * NR + k, [x, y, z] = pos(c, l, k), [u, v, w, p] = field(x, y, z);
    Object.assign(R, {}); R.x[n] = x; R.y[n] = y; R.z[n] = z; R.u[n] = u; R.v[n] = v; R.w[n] = w; R.p[n] = p; R.mu[n] = mu(x, y, z);
  }
  return R;
}

// 1. quadratic fields on sheared straight-sided hexahedra: exact
{
  const f = (x, y, z) => [1 + 2 * x - 3 * y + 0.5 * z + x * y - 2 * y * y + 0.7 * z * z + 1.1 * x * z, 0.3 - x + 4 * y * z - 0.6 * x * x + 0.2 * y,
    2 * z - 1.5 * x * y + 0.9 * y * y - 0.4 * x, 5 - 3 * x + 2 * y + 7 * z + 1.3 * x * z];
  // the exact gradients
  const g = (x, y, z) => ({ uy: -3 + x - 4 * y, uz: 0.5 + 1.4 * z + 1.1 * x, vx: -1 - 1.2 * x, vz: 4 * y, wx: -1.5 * y - 0.4, wy: -1.5 * x + 1.8 * y, px: -3 + 1.3 * z, py: 2, pz: 7 + 1.3 * x });
  const pos = (c, l, k) => { const s = c / 8, t = k / 6, r = l / 4; return [s + 0.3 * t + 0.1 * r, 0.5 * t, 0.8 * r - 0.2 * s]; };
  const R = gridResult(9, 5, 7, pos, f, (x, y, z) => 1 + x * x);
  const D = derive3D(R);
  let e = 0, scale = 0;
  for (let n = 0; n < R.x.length; n++) {
    const G = g(R.x[n], R.y[n], R.z[n]), ex = [G.wy - G.vz, G.uz - G.wx, G.vx - G.uy, G.px, G.py, G.pz], got = [D.om[0][n], D.om[1][n], D.om[2][n], D.gp[0][n], D.gp[1][n], D.gp[2][n]];
    for (let j = 0; j < 6; j++) { e = Math.max(e, Math.abs(got[j] - ex[j])); scale = Math.max(scale, Math.abs(ex[j])); }
  }
  let et = 0;
  for (let c = 0; c < R.NC; c++) for (let l = 0; l < R.NL; l++) {
    const n = (c * R.NL + l) * R.NR, G = g(R.x[n], 0, R.z[n]), m = R.mu[n], j = c * R.NL + l;
    et = Math.max(et, Math.abs(D.web.tx[j] - m * (G.uy + G.vx)), Math.abs(D.web.tz[j] - m * (G.wy + G.vz)));
  }
  check('quadratic fields on sheared hexahedra: vorticity, pressure gradient and wall shear stress exact', e < 1e-11 * scale && et < 1e-11 * scale && D.skipped === 0, `error ${(e / scale).toExponential(1)}, web ${(et / scale).toExponential(1)} of the largest`);
}

// 2. a smooth field on a curved mesh: second order
{
  const f = (x, y, z) => [Math.sin(2 * x) * Math.cos(y) + z * z, Math.cos(x + z) * y, Math.exp(0.5 * y) * Math.sin(z), Math.cos(x) * Math.sin(y + z)];
  const ex = (x, y, z) => { const uy = -Math.sin(2 * x) * Math.sin(y), uz = 2 * z, vx = -Math.sin(x + z) * y, vz = -Math.sin(x + z) * y, wx = 0, wy = 0.5 * Math.exp(0.5 * y) * Math.sin(z);
    return [wy - vz, uz - wx, vx - uy, -Math.sin(x) * Math.sin(y + z), Math.cos(x) * Math.cos(y + z), Math.cos(x) * Math.cos(y + z)]; };
  const errs = [];
  for (const m of [2, 4, 8]) {
    const pos = (c, l, k) => { const s = c / (2 * m), r = l / (2 * m), t = (k / (2 * m)) * (1.2 - 0.2 * k / (2 * m)), top = 1 + 0.15 * Math.sin(Math.PI * s) * Math.cos(0.5 * Math.PI * r);
      return [s + 0.08 * t * Math.sin(Math.PI * s), t * top, r]; };
    const R = gridResult(4 * m + 1, 4 * m + 1, 4 * m + 1, pos, f), D = derive3D(R);
    let e = 0;
    for (let n = 0; n < R.x.length; n++) { const E = ex(R.x[n], R.y[n], R.z[n]), got = [D.om[0][n], D.om[1][n], D.om[2][n], D.gp[0][n], D.gp[1][n], D.gp[2][n]]; for (let j = 0; j < 6; j++) e = Math.max(e, Math.abs(got[j] - E[j])); }
    errs.push(e);
  }
  const o1 = Math.log2(errs[0] / errs[1]), o2 = Math.log2(errs[1] / errs[2]);
  check('smooth field on a curved mesh: the error falls at second order', o2 > 1.8, `largest error ${errs.map(v => v.toExponential(2)).join(' -> ')} (order ${o1.toFixed(2)}, ${o2.toFixed(2)})`);
}

// 3. the solver's manufactured solution: vorticity and pressure gradient from the solved fields
{
  const k1 = 1.3, k2 = 1.1, k3 = 0.9, k4 = 1.2, k5 = 1.4;
  const ex = (x, y, z) => [
    Math.sin(k1 * x) * Math.cos(k2 * y) * Math.cos(k3 * z) / k1,
    -Math.cos(k1 * x) * Math.sin(k2 * y) * Math.cos(k3 * z) / k2 + Math.sin(k4 * y) * Math.cos(k5 * z) * Math.cos(x) / k4,
    -Math.cos(k4 * y) * Math.sin(k5 * z) * Math.cos(x) / k5,
  ];
  const pex = (x, y, z) => Math.cos(x) * Math.sin(y) * (1 + z);
  const Re = 2, nPow = 0.7, muLaw = gd => Math.pow(Math.sqrt(gd * gd + 1e-6) / Math.sqrt(1 + 1e-6), nPow - 1), h = 1e-4;
  const grad = (x, y, z) => { const g = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], P = [[h, 0, 0], [0, h, 0], [0, 0, h]];
    for (let i = 0; i < 3; i++) { const a = ex(x + P[i][0], y + P[i][1], z + P[i][2]), b = ex(x - P[i][0], y - P[i][1], z - P[i][2]); for (let j = 0; j < 3; j++) g[j][i] = (a[j] - b[j]) / (2 * h); }
    return g; };
  const tau = (x, y, z) => { const g = grad(x, y, z), D = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { D[i][j] = 0.5 * (g[i][j] + g[j][i]); s += D[i][j] * D[i][j]; }
    const m = muLaw(Math.sqrt(2 * s)); return D.map(r => r.map(v => 2 * m * v)); };
  const H2 = 1e-3;
  const force = (x, y, z) => { const u = ex(x, y, z), g = grad(x, y, z), P = [[H2, 0, 0], [0, H2, 0], [0, 0, H2]], divT = [0, 0, 0], gp = [0, 0, 0];
    for (let i = 0; i < 3; i++) { const a = tau(x + P[i][0], y + P[i][1], z + P[i][2]), b = tau(x - P[i][0], y - P[i][1], z - P[i][2]);
      for (let j = 0; j < 3; j++) divT[j] += (a[j][i] - b[j][i]) / (2 * H2);
      gp[i] = (pex(x + P[i][0], y + P[i][1], z + P[i][2]) - pex(x - P[i][0], y - P[i][1], z - P[i][2])) / (2 * H2); }
    return [0, 1, 2].map(j => Re * (u[0] * g[j][0] + u[1] * g[j][1] + u[2] * g[j][2]) + gp[j] - divT[j]); };
  const eo = [], ep = [], et = [];
  for (const n of [2, 3, 4]) {
    const topY = (x, z) => 1 + 0.15 * Math.sin(Math.PI * x) * Math.cos(0.5 * Math.PI * z);
    const r = solveFEM3D({
      mesh: { nEx: n, nEy: n, nEz: n, spineFoot: c => c / (2 * n), z: l => l / (2 * n), kind: () => 'wall',
        spineTop: (c, l) => [c / (2 * n) + 0.08 * Math.sin(Math.PI * c / (2 * n)), topY(c / (2 * n), l / (2 * n))],
        spineSlope: (c, l) => 0.1 * Math.sin(Math.PI * c / (2 * n)), eta: k => { const t = k / (2 * n); return t * (1.2 - 0.2 * t); } },
      U: 0, rho: Re, mu: gd => muLaw(gd), Hr: 1, Ur: 1, gdMin: 1e-10,
      inlet: { type: 'wall' }, outlet: { type: 'stress', sigma: (x, y, z) => { const T = tau(x, y, z), p = pex(x, y, z); return T.map((rw, i) => rw.map((v, j) => v - (i === j ? p : 0))); } }, sides: 'wall',
      force, exactBC: (x, y, z) => ex(x, y, z), tol: 1e-11, maxIter: 30 });
    const D = derive3D(r);
    let a = 0, b = 0, c = 0;
    for (let m = 0; m < r.x.length; m++) {
      const x = r.x[m], y = r.y[m], z = r.z[m], g = grad(x, y, z), om = [g[2][1] - g[1][2], g[0][2] - g[2][0], g[1][0] - g[0][1]];
      const gp = [-Math.sin(x) * Math.sin(y) * (1 + z), Math.cos(x) * Math.cos(y) * (1 + z), Math.cos(x) * Math.sin(y)];
      for (let j = 0; j < 3; j++) { a = Math.max(a, Math.abs(D.om[j][m] - om[j])); b = Math.max(b, Math.abs(D.gp[j][m] - gp[j])); }
    }
    // the web (y = 0): the wall shear stress against the exact stress there
    for (let cc = 0; cc < r.NC; cc++) for (let l = 0; l < r.NL; l++) { const m = (cc * r.NL + l) * r.NR, T = tau(r.x[m], 0, r.z[m]), j = cc * r.NL + l; c = Math.max(c, Math.abs(D.web.tx[j] - T[0][1]), Math.abs(D.web.tz[j] - T[2][1])); }
    eo.push(a); ep.push(b); et.push(c);
  }
  const ord = (e) => Math.log(e[1] / e[2]) / Math.log(4 / 3);
  check('manufactured solution solved: vorticity from the solved velocity against the exact, falling at order >= 1.7', ord(eo) > 1.7, `largest error ${eo.map(v => v.toExponential(2)).join(' -> ')} (2, 3, 4 elements a side; order ${ord(eo).toFixed(2)})`);
  check('  pressure gradient from the solved pressure (linear per element: order 1)', ord(ep) > 0.8, `largest error ${ep.map(v => v.toExponential(2)).join(' -> ')} (order ${ord(ep).toFixed(2)})`);
  check('  wall shear stress on the bottom wall against the exact stress there', ord(et) > 1.4, `largest error ${et.map(v => v.toExponential(2)).join(' -> ')} (order ${ord(et).toFixed(2)})`);
}

// 4. the rectangular duct (solved): the pressure gradient, the wall shear stress across the bottom wall against the series
{
  const a = 2e-3, b = 1e-3, L = 2e-3, mu = 1.5, dp = 30, G = dp / L;
  // tau_w(z) = mu du/dy at y = 0 = G b / 2 - (4 G b / pi^2) sum_n odd cosh(n pi z / b) / (n^2 cosh(n pi a / 2b))
  // (cosh A / cosh B as exp(A - B) (1 + e^-2A) / (1 + e^-2B): no overflow)
  const cr = (A, B) => Math.exp(A - B) * (1 + Math.exp(-2 * A)) / (1 + Math.exp(-2 * B));
  const tw = z => { let s = 0; for (let n = 1; n < 400; n += 2) s += cr(n * Math.PI * Math.abs(z) / b, n * Math.PI * a / (2 * b)) / (n * n); return G * b / 2 - 4 * G * b / (Math.PI ** 2) * s; };
  const out = [];
  for (const [nEy, nEz] of [[4, 6], [8, 12]]) {
    const nEx = 2, r = solveFEM3D({
      mesh: { nEx, nEy, nEz, spineFoot: c => L * c / (2 * nEx), spineTop: c => [L * c / (2 * nEx), b], z: l => -a / 2 + a * l / (2 * nEz), kind: () => 'wall' },
      U: 0, rho: 0, mu: () => mu, Hr: b, Ur: 1e-3, sides: 'wall', inlet: { type: 'traction', p: () => dp }, outlet: { type: 'traction', p: () => 0 }, tol: 1e-10 });
    const D = derive3D(r), c = (r.NC - 1) / 2;
    let eg = 0, et = 0;
    for (let m = 0; m < r.x.length; m++) eg = Math.max(eg, Math.abs(D.gp[0][m] + G), Math.abs(D.gp[1][m]), Math.abs(D.gp[2][m]));
    // (away from the corners, where the stress is singular in its derivative: the middle 80 % across)
    for (let l = 0; l < r.NL; l++) { const z = r.z[(c * r.NL + l) * r.NR]; if (Math.abs(z) < 0.4 * a) et = Math.max(et, Math.abs(D.web.tx[c * r.NL + l] - tw(z))); }
    out.push({ eg: eg / G, et: et / tw(0), n: `${nEy}x${nEz}` });
  }
  check('duct solved: the pressure gradient is the imposed one', out.every(o => o.eg < 1e-6), out.map(o => `${o.n}: ${o.eg.toExponential(1)}`).join(', ') + ' of it');
  const ordT = Math.log2(out[0].et / out[1].et);
  check('  the wall shear stress across the bottom wall = the series, the error falling at order >= 1.5 (within 1 % on the finer mesh)', out[1].et < 1e-2 && ordT > 1.5,
    out.map(o => `${o.n}: within ${(o.et * 100).toFixed(3)} %`).join(', ') + ` of the centre's ${tw(0).toFixed(4)} Pa (order ${ordT.toFixed(2)})`);
}

// 5-7. the coating flow (web 0.1 m/s, 1 Pa s, flat land, face 90 deg, contact angle 35 deg)
{
  const rho = 1020, g = 9.81, gamma = 0.07, H = 1.7e-3;
  const base = { hFn: () => H, xe: 5e-3, faceDeg: 90, contactDeg: 35, U: 0.1, Pup: 0, rho, g, gamma, mu: () => 1, Ld: 12e-3, nEb: 5, nEf: 3, nEs: 12, nEy: 3, fInfGuess: 0.5 * H, width: 0.02, nEz: 2 };
  const flat = solveCoater3D(base), r3 = flat.r3, r2 = flat.r2[0], D = derive3D(r3, { gd: true });
  let eo = 0, et = 0, so = 0, st = 0;
  for (let c = 0; c < r3.NC; c++) for (let l = 0; l < r3.NL; l++) {
    for (let k = 0; k < r3.NR; k++) { const n3 = (c * r3.NL + l) * r3.NR + k, n2 = c * r3.NR + k; eo = Math.max(eo, Math.abs(D.om[2][n3] - r2.omega[n2]), Math.abs(D.om[0][n3]), Math.abs(D.om[1][n3])); so = Math.max(so, Math.abs(r2.omega[n2])); }
    const j = c * r3.NL + l; et = Math.max(et, Math.abs(D.web.tx[j] - r2.tauXY[c * r3.NR]), Math.abs(D.web.tz[j])); st = Math.max(st, Math.abs(r2.tauXY[c * r3.NR]));
  }
  check('coating flow, uniform strip: the vorticity is across the web only and the 2D\'s at every station', eo < 1e-9 * so, `within ${(eo / so).toExponential(1)} of the largest (${so.toFixed(1)} 1/s)`);
  check('  the wall shear stress on the web is the 2D\'s τ_xy there, along the web only', et < 1e-9 * st, `within ${(et / st).toExponential(1)} of the largest (${st.toFixed(2)} Pa)`);
  // 6. the layout on every kind of solve: the shear rate from these gradients = the solver's own where a node has one element
  const interior = (R, gdD) => { let e = 0, s = 0;
    for (let c = 1; c < R.NC; c += 2) for (let l = 1; l < R.NL; l += 2) for (let k = 1; k < R.NR; k += 2) { const n = (c * R.NL + l) * R.NR + k; if (!Number.isFinite(gdD[n])) continue; e = Math.max(e, Math.abs(gdD[n] - R.gd[n])); s = Math.max(s, Math.abs(R.gd[n])); }
    return e / (s || 1); };
  const wav = z => 30e-6 * Math.sin(2 * Math.PI * z / 0.04);
  const kinds = [['a strip', r3], ['the gap varying', solveCoater3D({ ...base, dH: wav }).r3], ['a skewed blade (3°)', solveCoater3D({ ...base, U: 0.1 * Math.cos(3 * Math.PI / 180), webW: 0.1 * Math.sin(3 * Math.PI / 180), dH: wav }).r3]];
  {
    const { coaterStations, stationState, coaterStrip3D } = require('./cfd-fem3d.js'), W = 0.006, nEz = 3, NL = 2 * nEz + 1, zs = Array.from({ length: NL }, (_, l) => -W / 2 + W * l / (NL - 1));
    const eb = { ...base, Ld: 8e-3, nEb: 3, nEf: 2, nEs: 4, nEy: 2, width: W, nEz }, S = coaterStations(eb, zs);
    kinds.push(['an open side (the blade\'s end)', coaterStrip3D(eb, S, 0, NL - 1, zs.map((_, l) => stationState(S, l)), false, false, { maxIter: 60, open: { hi: { m: 2, zEnd: W / 2, thWeb: 35, thBlade: 35 } } })]);
  }
  // (fields at every node where the solver has its own shear rate: an open side's web contact line, its spine collapsed on the web, has neither)
  const res = kinds.map(([name, R]) => { const d = derive3D(R, { gd: true }); let has = 0, same = 0;
    for (let n = 0; n < R.x.length; n++) { const a = Number.isFinite(R.gd[n]), b = Number.isFinite(d.om[2][n]) && Number.isFinite(d.gp[0][n]); has += a; same += a === b; }
    return { name, e: interior(R, d.gd), skipped: d.skipped, fin: same / R.x.length, none: R.x.length - has }; });
  check('the layout on every kind of solve: the shear rate from these gradients is the solver\'s own (one element at the node)', res.every(r => r.e < 1e-9) && res.length === 4,
    res.map(r => `${r.name} ${r.e.toExponential(0)}${r.skipped ? ` (${r.skipped} degenerate element-nodes left out)` : ''}`).join('; '));
  check('  the fields at every node where the solver has its shear rate, and only there', res.every(r => r.fin === 1), res.map(r => `${r.name} ${(r.fin * 100).toFixed(1)} %${r.none ? ` (${r.none} nodes without: the web contact line)` : ''}`).join('; '));
  // 7. single precision, as the app keeps a result
  const f32 = {}; for (const k of ['x', 'y', 'z', 'u', 'v', 'w', 'p', 'mu']) f32[k] = Float32Array.from(r3[k]);
  const R32 = { ...r3, ...f32 }, D32 = derive3D(R32);
  const rel = (a, b) => { let e = 0; for (let n = 0; n < a.length; n++) if (Number.isFinite(a[n])) e = Math.max(e, Math.abs(a[n] - b[n])); return e / (maxAbs(a) || 1); };
  const e32 = Math.max(rel(D.om[2], D32.om[2]), rel(D.gp[0], D32.gp[0]), rel(D.gp[1], D32.gp[1]), rel(D.web.tx, D32.web.tx));
  check('in single precision (as the app keeps a result): within 0.1 % of the largest value', e32 < 1e-3, `${(e32 * 100).toFixed(4)} %`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
