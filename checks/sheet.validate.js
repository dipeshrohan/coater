/*
 * sheet.validate.js — checks of sheet.js (a cut piece of the film in 3D: a von Kármán plate with a natural curvature,
 * free or on a table under its weight) against exact solutions. Run: node sheet.validate.js
 */
const S = require('../engine/sheet.js');
const F = require('../engine/film.js');
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

// ---- GO-4f: the piece held flat in the stack, and let go ----

// 10. the stiffness per point: sA = c, sD = c' everywhere is the same plate with c A and c' D (energy, gradient)
{
  const m = S.shMesh(0.2, 0.16, 3, 2), ng = S.shGaussXY(m).length, o = { A, D, nu: 0.25, kx: 0.7, ky: -0.3, p: 7, table: true, kc: 1e7 };
  const d = new Float64Array(m.ndof).map((_, i) => m.fixed[i] ? 0 : (Math.sin(i * 1.7) * 2e-4));
  const a = S.shEnergy(m, d, { ...o, sA: new Float64Array(ng).fill(1.7), sD: new Float64Array(ng).fill(0.6) }, false), b = S.shEnergy(m, d, { ...o, A: 1.7 * A, D: 0.6 * D }, false);
  let e = 0, gm = 0; for (let i = 0; i < m.ndof; i++) { e = Math.max(e, Math.abs(a.g[i] - b.g[i])); gm = Math.max(gm, Math.abs(b.g[i])); }
  check('the stiffness per point: uniform, the same plate as stiffer', rel(a.E, b.E) < 1e-13 && e < 1e-12 * gm, `energy ${rel(a.E, b.E).toExponential(1)}, gradient ${(e / gm).toExponential(1)}`);
}

// 11. held flat, its stretch alone solved at once: the same as minimising the whole energy
{
  const m = S.shMesh(0.3, 0.2, 8, 8, { grade: 3, flat: true }), G = S.shGaussXY(m), ng = G.length;
  const eb = new Float64Array(3 * ng), sA = new Float64Array(ng);
  G.forEach(([x, y], g) => { eb[3 * g] = 1e-3 * Math.cos(9 * x) * (1 + 40 * y * y); eb[3 * g + 1] = -1.5e-2 * x * x + 2e-4 * Math.sin(20 * y); eb[3 * g + 2] = 3e-4 * Math.sin(10 * x) * Math.sin(12 * y); sA[g] = 1 + 0.5 * Math.sin(7 * x + 3 * y) ** 2; });
  const o = { A, D, nu: 0.2, kx: 0, ky: 0, p: 0, eb, sA }, F = S.shFlat(m, o), d = new Float64Array(m.ndof);
  S.shMinimise(m, d, o, { tol: 1e-13 });
  let big = 0, err = 0; for (let i = 0; i < m.ndof; i++) { big = Math.max(big, Math.abs(d[i])); err = Math.max(err, Math.abs(d[i] - F.d[i])); }
  check('held flat: the stretch solved at once is the energy\'s minimum', err < 1e-9 * big, `dofs agree to ${(err / big).toExponential(1)} of the largest`);
}

// 12. buckling: a simply supported square plate, its edges held in its plane, wanting to grow by e0 both ways loses
//     its flatness at e0 = 2π² D / ((1 + ν) A a²) -- the natural stretch per point and the stress's stiffness
const stableAt = (m, e0) => { const ng = S.shGaussXY(m).length; return S.shStable(m, new Float64Array(m.ndof), { A, D, nu: m.nuT, kx: 0, ky: 0, p: 0, eb: Float64Array.from({ length: 3 * ng }, (_, i) => e0[i % 3]) }); };
const critical = (m, dir, hi) => { let lo = 0; for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (stableAt(m, dir.map(v => v * mid))) lo = mid; else hi = mid; } return lo; };
const simply = m => {   // (edges x = a/2 and y = b/2: u, v held along them, w = 0 with its slope along the edge)
  for (let j = 0; j <= m.ny; j++) { const k = m.id(m.nx, j) * 12; for (const c of [0, 2, 4, 6, 8, 10]) m.fixed[k + c] = 1; }
  for (let i = 0; i <= m.nx; i++) { const k = m.id(i, m.ny) * 12; for (const c of [0, 1, 4, 5, 8, 9]) m.fixed[k + c] = 1; }
  return m;
};
{
  const a = 0.3, nu = 0.3, exact = 2 * Math.PI ** 2 * D / ((1 + nu) * A * a * a);
  const out = [[6, 1], [6, 3], [8, 1]].map(([n, grade]) => { const m = simply(S.shMesh(a, a, n, n, { grade })); m.nuT = nu; return critical(m, [1, 1, 0], 3 * exact); });
  check('buckling: a square plate wanting to grow, simply supported', out.every(v => rel(v, exact) < 1e-4), `e0 ${out.map(v => v.toExponential(6)).join(', ')} (exact ${exact.toExponential(6)})`);
}

// 13. which way it buckles: a plate twice as long as wide pressed along its length buckles in two half-waves (odd about
//     its middle, k = 4); among the shapes even about it, three (k = 4.694) -- the quarter with w odd or even across x = 0
{
  const a = 0.4, b = 0.2, nu = 0.3, kOf = mm => (mm * b / a + a / (mm * b)) ** 2, eOf = k => k * Math.PI ** 2 * D / ((1 - nu * nu) * A * b * b);
  const out = [['oe', 2], ['ee', 3]].map(([sym, mm]) => { const m = simply(S.shMesh(a, b, 10, 10, { sym })); m.nuT = nu; const ex = eOf(kOf(mm)); return { sym, v: critical(m, [1, -nu, 0], 3 * ex), ex }; });
  check('which way it buckles: odd about the middle two half-waves, even three', out.every(q => rel(q.v, q.ex) < 1e-4), out.map(q => `${q.sym} ${q.v.toExponential(5)} (${q.ex.toExponential(5)})`).join('; '));
}

// 14. let go with a natural curvature as a field: the same shape as a natural curvature given whole
{
  const k = 0.8, o = { Lx: L, Ly: L, A, D, nu: 0.2, p: 0, table: false, n: 6 };
  const a = S.shRun({ ...o, kx: k, ky: k, bias: 0 }), b = S.shRelease({ ...o, sym: 'ee', fields: () => ({ e: [0, 0, 0], k: [k, k, 0] }) });
  const liftA = [a.corner, a.edgeX, a.edgeY], nb = b.W.length - 1, mid = nb / 2, liftB = [Math.abs(b.W[0][0] - b.wMid), Math.abs(b.W[mid][0] - b.wMid), Math.abs(b.W[0][mid] - b.wMid)];
  check('let go: a curvature as a field shapes it as the curvature given whole', rel(b.E, a.E) < 1e-6 && Math.abs(liftB[0] - liftA[0]) < 1e-3 * liftA[0], `energy ${a.E.toExponential(6)} vs ${b.E.toExponential(6)}; corner ${(liftA[0] * 1e3).toFixed(4)} vs ${(liftB[0] * 1e3).toFixed(4)} mm`);
}

// 15. the whole piece against the quarter: a rim that wants to be longer than the middle (a stretch field), let go
//     held up. The quarter's shape mirrored onto the whole piece: four times its energy, and balanced there too; the
//     whole piece, free of the mirrors, settles at least as low
{
  const Lp = 0.3, rimField = (x, y) => { const r = Math.max(Math.abs(x) / (Lp / 2), Math.abs(y) / (Lp / 2)), e = 4e-4 * Math.max(0, (r - 0.7) / 0.3) ** 2; return { e: [e, e, 0], k: [0, 0, 0] }; };
  const o = { Lx: Lp, Ly: Lp, A, D, nu: 0.3, p: 0, table: false, n: 5, fields: rimField };
  const q = S.shRelease({ ...o, sym: 'ee' }), f = S.shRelease({ ...o, sym: 'full' });
  // (mirroring a dof: a field even (+1) or odd (−1) across x = 0 keeps or flips its value, flips or keeps its x-slope,
  //  keeps or flips its y-slope, flips or keeps its twist; across y = 0 alike. u odd across x, v odd across y, w even)
  const par = [[-1, 1], [1, -1], [1, 1]], n = 5, dm = new Float64Array(f.m.ndof);
  for (let j = 0; j <= 2 * n; j++) for (let i = 0; i <= 2 * n; i++) {
    const iq = Math.abs(i - n), jq = Math.abs(j - n), mx = i < n, my = j < n;
    for (let fld = 0; fld < 3; fld++) {
      const [px, py] = par[fld], sgn = [[px, -px, px, -px], [py, py, -py, -py]];
      for (let c = 0; c < 4; c++) dm[f.m.id(i, j) * 12 + 4 * fld + c] = q.d[q.m.id(iq, jq) * 12 + 4 * fld + c] * (mx ? sgn[0][c] : 1) * (my ? sgn[1][c] : 1);
    }
  }
  const at = S.shEnergy(f.m, dm, { A, D, nu: 0.3, kx: 0, ky: 0, p: 0, ...f.gp }, false);
  const gq = Math.hypot(...S.shEnergy(q.m, q.d, { A, D, nu: 0.3, kx: 0, ky: 0, p: 0, ...q.gp }, false).g), gf = Math.hypot(...at.g);
  const flat = S.shEnergy(q.m, S.shFlat(q.m, { A, nu: 0.3, eb: q.gp.eb, sA: q.gp.sA }).d, { A, D, nu: 0.3, kx: 0, ky: 0, p: 0, ...q.gp }, false).E;
  check('the whole piece: the quarter\'s shape mirrored has four times its energy and is balanced', rel(at.E, 4 * q.E) < 1e-10 && gf < 1e-6 * Math.max(1, Math.hypot(...f.gp.eb) * A), `${at.E.toExponential(9)} vs 4 × ${q.E.toExponential(9)}; out of balance ${gf.toExponential(1)} (the quarter ${gq.toExponential(1)})`);
  check('a longer rim buckles below its flat state; the whole piece settles at least as low as the quarter', q.E < flat && q.stable && f.stable && f.E <= 4 * q.E * (1 + 1e-9),
    `quarter ${q.E.toExponential(4)} (flat ${flat.toExponential(4)}), height ${(q.high * 1e3).toFixed(3)} mm; whole ${f.E.toExponential(4)} (4 × ${(4 * q.E).toExponential(4)}), height ${(f.high * 1e3).toFixed(3)} mm`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
if (typeof process !== 'undefined') process.exitCode = fails ? 1 : 0;
