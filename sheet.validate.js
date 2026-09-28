/*
 * sheet.validate.js — checks of sheet.js (a cut piece of the film in 3D: a von Kármán plate with a natural curvature,
 * free or on a table under its weight) against exact solutions. Run: node sheet.validate.js
 */
const S = require('./sheet.js');
const F = require('./film.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const E = 20e9, h = 4e-4, A = E * h, D = E * h ** 3 / 12, L = 0.3;

// 1. the bicubic Hermite element reproduces a bicubic exactly (value and derivatives at an inside point)
{
  const a = 0.7, b = 0.4, f = (x, y) => 1 + 2 * x - y + 3 * x * x * y - x * y * y * y + 0.5 * x * x * x * y * y * y;
  const fx = (x, y) => 2 + 6 * x * y - y ** 3 + 1.5 * x * x * y ** 3, fy = (x, y) => -1 + 3 * x * x - 3 * x * y * y + 1.5 * x ** 3 * y * y;
  const fxy = (x, y) => 6 * x - 3 * y * y + 4.5 * x * x * y * y, fxx = (x, y) => 6 * y + 3 * x * y ** 3, fyy = (x, y) => -6 * x * y + 3 * x ** 3 * y;
  const nodes = [[0, 0], [a, 0], [a, b], [0, b]], dof = nodes.flatMap(([x, y]) => [f(x, y), fx(x, y), fy(x, y), fxy(x, y)]);
  const s = 0.37, t = 0.81, q = S.shShape(s, t, a, b), x = s * a, y = t * b;
  const at = arr => arr.reduce((acc, v, k) => acc + v * dof[k], 0);
  const errs = [[at(q.N), f(x, y)], [at(q.Nx), fx(x, y)], [at(q.Ny), fy(x, y)], [at(q.Nxx), fxx(x, y)], [at(q.Nyy), fyy(x, y)], [at(q.Nxy), fxy(x, y)]].map(([u, v]) => Math.abs(u - v));
  check('the element reproduces a bicubic and its derivatives', Math.max(...errs) < 1e-12, `max error ${Math.max(...errs).toExponential(1)}`);
}

// 2. the gradient and the stiffness are the energy's (finite differences at a curled, loaded state on a table)
{
  const m = S.shMesh(0.2, 0.16, 3, 2), o = { A, D, nu: 0.25, kx: 0.7, ky: -0.3, p: 7, table: true, kc: 1e7 };
  const d = new Float64Array(m.ndof).map((_, i) => m.fixed[i] ? 0 : (Math.sin(i * 1.7) * 2e-4));
  const r = S.shEnergy(m, d, o, true);
  let eg = 0, ek = 0, gmax = 0, kmax = 0;
  for (const i of [9, 20, 44, 57, 70]) {
    if (m.fixed[i]) continue;
    const hh = 1e-8, dp = Float64Array.from(d), dm = Float64Array.from(d); dp[i] += hh; dm[i] -= hh;
    const ep = S.shEnergy(m, dp, o, true), em = S.shEnergy(m, dm, o, true);
    eg = Math.max(eg, Math.abs((ep.E - em.E) / (2 * hh) - r.g[i])); gmax = Math.max(gmax, Math.abs(r.g[i]));
    for (const j of [9, 20, 44, 57, 70]) {
      if (m.fixed[j]) continue;
      const fd = (ep.g[j] - em.g[j]) / (2 * hh), K = r.K, ii = Math.max(i, j), jj = Math.min(i, j), kk = ii - jj <= K.bw ? K.a[ii * (K.bw + 1) + ii - jj] : 0;
      ek = Math.max(ek, Math.abs(fd - kk)); kmax = Math.max(kmax, Math.abs(kk));
    }
  }
  check('the gradient is the energy\'s (finite differences)', eg < 1e-5 * gmax, `${(eg / gmax).toExponential(1)} of the largest`);
  check('the stiffness is the gradient\'s (finite differences)', ek < 1e-5 * kmax, `${(ek / kmax).toExponential(1)} of the largest`);
}

// 3. a curvature along the line only: it bends exactly into a cylinder (no stretch), whatever its size
{
  const r = S.shRun({ Lx: L, Ly: L, A, D, nu: 0.2, kx: 0.8, ky: 0, p: 0, table: false, n: 6, steps: 3, bias: 0 });
  check('a curvature one way: an exact cylinder', rel(r.kxMid, 0.8) < 1e-9 && Math.abs(r.kyMid) < 1e-9 && rel(r.edgeX, 0.8 * (L / 2) ** 2 / 2) < 1e-9, `κ ${r.kxMid.toFixed(6)}, edge ${(r.edgeX * 1e3).toFixed(4)} mm (exact ${(0.8 * (L / 2) ** 2 / 2 * 1e3).toFixed(4)})`);
}

// 4. a small piece with the same curvature both ways: a spherical cap, κ both ways the natural curvature
{
  const r = S.shRun({ Lx: 0.01, Ly: 0.01, A, D, nu: 0.2, kx: 0.8, ky: 0.8, p: 0, table: false, n: 4, steps: 2, bias: 0 });
  check('a small piece: a spherical cap', rel(r.kxMid, 0.8) < 1e-3 && rel(r.kyMid, 0.8) < 1e-3, `κ ${r.kxMid.toFixed(5)}, ${r.kyMid.toFixed(5)} (0.8)`);
}

// 5. a large piece rolls into a tube: its middle's curvature toward (1 + ν) κ̄ as it grows (the mesh fine enough for
//    the edges' boundary layer, √(R h) wide); the same with ν = 0 toward κ̄
{
  const k = 0.8, nu = 0.2, rs = [[0.3, 8], [0.6, 12]].map(([Lp, n]) => S.shRun({ Lx: Lp, Ly: Lp, A, D, nu, kx: k, ky: k, p: 0, table: false, n }));
  const kx = rs.map(r => r.kxMid), ky = rs.map(r => Math.abs(r.kyMid));
  check('a large piece rolls one way: a tube, its curvature toward (1 + ν) κ̄ as it grows', kx[0] < kx[1] && rel(kx[1], (1 + nu) * k) < 0.01 && ky.every(v => v < 0.03 * k),
    `κ ${kx.map(v => v.toFixed(4)).join(' → ')} (limit ${((1 + nu) * k).toFixed(2)}); across ${ky.map(v => v.toFixed(4)).join(', ')}`);
  const r0 = S.shRun({ Lx: 0.6, Ly: 0.6, A, D, nu: 0, kx: k, ky: k, p: 0, table: false, n: 12 });
  check('with ν = 0 the tube\'s curvature is the natural one', rel(r0.kxMid, k) < 0.01, `${r0.kxMid.toFixed(4)} (0.8)`);
  check('it rolls along the line (the preference while it curls up)', [...rs, r0].every(r => r.edgeX > 10 * r.edgeY), [...rs, r0].map(r => `${(r.edgeX * 1e3).toFixed(1)} / ${(r.edgeY * 1e3).toFixed(2)} mm`).join('; '));
}

// 6. similarity: the shape over κ̄ L² depends on κ̄ L² / h only (twice as large, a quarter of the curvature)
{
  const a = S.shRun({ Lx: 0.3, Ly: 0.3, A, D, nu: 0.2, kx: 3.2, ky: 3.2, p: 0, table: false, n: 8 });
  const b = S.shRun({ Lx: 0.6, Ly: 0.6, A, D, nu: 0.2, kx: 0.8, ky: 0.8, p: 0, table: false, n: 8 });
  const sa = 3.2 * 0.3 ** 2, sb = 0.8 * 0.6 ** 2;
  check('the shape scales with κ̄ L² / h', rel(a.edgeX / sa, b.edgeX / sb) < 1e-6 && rel(a.corner / sa, b.corner / sb) < 1e-6, `edge / κ̄L² ${(a.edgeX / sa).toFixed(6)} and ${(b.edgeX / sb).toFixed(6)}`);
}

// 7. on a table (a strip curling along the line, ν = 0): its ends lift κ̄ ℓ² / 4 where ℓ = √(2 D κ̄ / p) is under half
//    its length, and κ̄ l² / 2 − p l⁴ / (8 D) (l half its length) when it rests on its middle line only
{
  const p = 1800 * 9.81 * h;
  for (const k of [0.3, 0.8]) {
    const r = S.shRun({ Lx: L, Ly: L, A, D, nu: 0, kx: -k, ky: 0, p, table: true, n: 12, h });
    const l = Math.sqrt(2 * D * k / p), l0 = L / 2, exact = l < l0 ? k * l * l / 4 : k * l0 * l0 / 2 - p * l0 ** 4 / (8 * D);
    check(`on a table (κ̄ ${k} 1/m): its ends lift as the heavy strip's closed form`, rel(r.edgeX, exact) < 0.005, `${(r.edgeX * 1e3).toFixed(3)} mm (exact ${(exact * 1e3).toFixed(3)}; ${l < l0 ? `lifts ${(l * 1e3).toFixed(0)} mm from its ends` : 'rests on its middle'})`);
  }
}

// 8. the mesh: the corner and the edge converge (the app's 8 × 8 quarter against 12 × 12)
{
  const run = n => S.shRun({ Lx: L, Ly: L, A, D, nu: 0.2, kx: 0.8, ky: 0.8, p: 0, table: false, n });
  const a = run(6), b = run(8), c = run(12);
  check('the mesh: the app\'s against a finer one', rel(b.corner, c.corner) < 1e-3 && rel(b.kxMid, c.kxMid) < 2e-3, `corner ${[a, b, c].map(r => (r.corner * 1e3).toFixed(4)).join(', ')} mm; κ ${[a, b, c].map(r => r.kxMid.toFixed(4)).join(', ')}`);
}

// 9. the layers as a plate: its natural curvature and its flat size as film.js's free film gives them
{
  const layers = [{ z0: 0, t: 1e-4, E: 20e9, en: -0.01 }, { z0: 1e-4, t: 2e-4, E: 12e9, en: -0.004 }, { z0: 3e-4, t: 1e-4, E: 25e9, en: 0.002 }];
  const nu = 0.2, P = S.shPlate(layers, nu), ff = F.fmFree(layers.map(Lr => ({ ...Lr, Q: Lr.E / (1 - nu) })));
  // (pressed flat: κ = 0, its in-plane strain An / A)
  const An = layers.reduce((s, Lr) => s + Lr.E * Lr.t * Lr.en, 0) / layers.reduce((s, Lr) => s + Lr.E * Lr.t, 0);
  check('the layers\' natural curvature is film.js\'s free film\'s', rel(P.kappa, ff.kappa) < 1e-12, `${P.kappa.toFixed(6)} vs ${ff.kappa.toFixed(6)} 1/m`);
  check('pressed flat, its size is its layers\' stiffness-weighted natural strain', rel(P.eFlat, An) < 1e-12, `${(P.eFlat * 100).toFixed(4)} %`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
if (typeof process !== 'undefined') process.exitCode = fails ? 1 : 0;
