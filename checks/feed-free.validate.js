/*
 * feed-free.validate.js — checks of feed-free.js (the coater's free surfaces) against exact solutions.
 * Run: node feed-free.validate.js
 *  1. The normal-stress update (the pile's top): paste at rest in a tank open to a reservoir whose level is 5 mm, under a
 *     lid at the wrong height (tilted, 3.5 to 4.5 mm): the paste's normal stress under the lid is exact (hydrostatic) and
 *     one update puts every point of the top at the reservoir's level.
 *  2. The pile's top with its tension: a cosine top under a lid over still paste; one update levels it at the reservoir's
 *     height (weight and tension together).
 */
const FF = require('../engine/feed-fem.js'), FS = require('../engine/feed-free.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const src = require('fs').readFileSync(require('path').join(__dirname, 'feed-fem.validate.js'), 'utf8');
const box = eval('(' + src.slice(src.indexOf('function box('), src.indexOf('const norm')) + ')');   // (the same box meshes)
/** A box mesh's columns (nodes with the same x, z, bottom to top). */
function columns(M) {
  const m = new Map();
  for (let n = 0; n < M.nN; n++) { const k = `${M.X[n].toFixed(12)},${M.Z[n].toFixed(12)}`; if (!m.has(k)) m.set(k, []); m.get(k).push(n); }
  return [...m.values()].map(c => c.sort((a, b) => M.Y[a] - M.Y[b]));
}
const setTop = (M, col, t) => { const t0 = M.Y[col[col.length - 1]]; for (const n of col) M.Y[n] *= t / t0; };

// 1. the normal-stress update: hydrostatic
{
  const rho = 1300, g = 9.81, Hs = 5e-3, L = 10e-3, M = box(L, 4e-3, 2e-3, 5, 2, 1);
  const cols = columns(M); for (const c of cols) setTop(M, c, 3.5e-3 + 1e-3 * M.X[c[0]] / L);
  const S = FF.ffSetup({ mesh: M, mu: () => 5, rho, g, Lr: 1e-3, Ur: 1e-3, bc: { y0: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: [0, 0, 0] },
    z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' }, y1: { type: 'slip', normal: 'surface' }, x1: { type: 'traction', t: (x, y) => [-rho * g * (Hs - y), 0, 0] } } });
  const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 }), sn = FS.fsNormalStress(S, R.x, ['y1']);
  let es = 0, eh = 0, um = 0;
  for (let n = 0; n < M.nN; n++) um = Math.max(um, Math.hypot(R.u[n], R.v[n], R.w[n]));
  for (const [n, s] of sn) { const ex = -rho * g * (Hs - M.Y[n]); es = Math.max(es, Math.abs(s - ex) / (rho * g * Hs)); eh = Math.max(eh, Math.abs(M.Y[n] - s / (rho * g) - Hs)); }
  check('the normal-stress update: under a lid at the wrong (tilted) height, the paste\'s normal stress hydrostatic; one update puts the top at the reservoir\'s level', es < 1e-9 && eh < 1e-12 && um < 1e-12 && sn.size >= 10,
    `${sn.size} lid nodes: normal stress ${es.toExponential(1)} (of ρ g H), the top after one update ${(eh * 1e6).toExponential(1)} µm from 5 mm; the paste still (${um.toExponential(1)} m/s)`);
}

// 2. the pile's top with its tension (fsPileUpdate): still paste under a lid shaped as a cosine (0.5 mm high, 40 mm long),
//    open to a reservoir at 25 mm: the normal stress hydrostatic; one update, with weight and tension, puts the top level at
//    25 mm (both act on the cosine, (ρ g + σ k²) δh = ...: exact in the plan's quadratic elements up to their own error)
{
  const nx = 16, nz = 4, Lx = 0.04, Lz = 0.01, xs = [], zs = [], id = (i, j) => j * (2 * nx + 1) + i;
  for (let j = 0; j <= 2 * nz; j++) for (let i = 0; i <= 2 * nx; i++) { xs.push(Lx * i / (2 * nx)); zs.push(Lz * j / (2 * nz)); }
  const quads = []; for (let ej = 0; ej < nz; ej++) for (let ei = 0; ei < nx; ei++) { const q = []; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) q.push(id(2 * ei + a, 2 * ej + b)); quads.push(q); }
  const rho = 1360, g = 9.81, sigma = 0.07, Hs = 0.025, A = 0.5e-3, k = 2 * Math.PI / Lx;
  const h = xs.map(x => 0.02 + A * Math.cos(k * x)), sn = new Map(); h.forEach((v, n) => sn.set(n, -rho * g * (Hs - v)));
  const r = FS.fsPileUpdate(xs, zs, quads, sn, h, { rho, g, sigma });
  let e = 0; h.forEach((v, n) => { e = Math.max(e, Math.abs(v + r.dh.get(n) - Hs)); });
  check('the pile\'s top with its tension: a cosine top under a lid, still paste: one update levels it at the reservoir\'s height', e < 1e-9 && Math.abs(r.mean - (Hs - 0.02)) < 1e-9,
    `farthest from 25 mm after one update ${(e * 1e6).toExponential(1)} µm (the cosine ${A * 1e6} µm), the mean move ${(r.mean * 1e3).toFixed(6)} mm`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
