/*
 * mp-core.validate.js — checks of mp-core.js (the multiphysics core) against exact solutions, and of its dimensions
 * against each other (a 2D that varies along one axis only is the 1D; a 3D strip with symmetry planes is the 2D; a
 * film's 1D laminate is film.js's and what a 2D strip and a 3D plate give far from their edges).
 * Run: node mp-core.validate.js
 */
const C = require('./mp-core.js'), F = require('./film.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const nodeX = (M, k) => Array.from(M.X.subarray(k * M.dim, k * M.dim + M.dim));
const maxErr = (M, u, f) => { let e = 0; for (let k = 0; k < M.N; k++) e = Math.max(e, Math.abs(u[k] - f(nodeX(M, k)))); return e; };
const fmt = x => x.toExponential(2);

// 1. the shape functions: a partition of unity, their slopes sum to zero, and they reproduce x
{
  let e = 0;
  for (const p of [1, 2]) for (const dim of [1, 2, 3]) for (const xi of [[0.3, -0.7, 0.1], [-1, 1, 0.5]]) {
    const S = C.mpShape(p, dim, xi.slice(0, dim));
    e = Math.max(e, Math.abs(S.N.reduce((a, b) => a + b, 0) - 1));
    for (let g = 0; g < dim; g++) { let s = 0; for (let a = 0; a < S.N.length; a++) s += S.dN[a * dim + g]; e = Math.max(e, Math.abs(s)); }
  }
  check('shape functions: partition of unity, slopes sum to zero (p 1, 2; 1D, 2D, 3D)', e < 1e-14, fmt(e));
}

// 2. 1D heat, transient: a slab from 0, its faces raised to 1 (the exact series)
{
  const L = 1e-3, D = 1e-7, M = C.mpMesh({ dim: 1, p: 2, axes: [[{ L, n: 20 }]] }), tau = L * L / D;
  const times = [0.02, 0.05, 0.2].map(f => f * tau);
  const r = C.mpScalar(M, { K: D, C: 1, u0: 0, bc: [{ face: 'x0', type: 'value', u: 1 }, { face: 'x1', type: 'value', u: 1 }],
    times, dt: 1e-5 * tau, dtMax: 5e-4 * tau, grow: 1.1, theta: 0.5 });
  const exact = (x, t) => { let s = 1; for (let n = 0; n < 200; n++) { const m = 2 * n + 1; s -= 4 / (m * Math.PI) * Math.sin(m * Math.PI * x / L) * Math.exp(-m * m * Math.PI * Math.PI * D * t / (L * L)); } return s; };
  const errs = r.snaps.map(s => maxErr(M, s.u, x => exact(x[0], s.t)));
  check('1D heat, transient slab: against the exact series at Fo 0.02, 0.05, 0.2', Math.max(...errs) < 2e-4, errs.map(fmt).join(', '));
}

// 3. 2D steady conduction: sin(πx) sinh(πy) / sinh(π), converging at the order of the elements
{
  const exact = x => Math.sin(Math.PI * x[0]) * Math.sinh(Math.PI * x[1]) / Math.sinh(Math.PI);
  const run = (p, n) => {
    const M = C.mpMesh({ dim: 2, p, axes: [{ L: 1, n }, { L: 1, n }] });
    const r = C.mpScalar(M, { K: 1, steady: true, bc: ['x0', 'x1', 'y0', 'y1'].map(face => ({ face, type: 'value', u: x => exact(x) })) });
    return maxErr(M, r.u, exact);
  };
  const e1 = [run(1, 8), run(1, 16)], e2 = [run(2, 4), run(2, 8)];
  check('2D steady conduction, linear elements: error falls 4× per halving', e1[0] / e1[1] > 3.5, `${fmt(e1[0])} → ${fmt(e1[1])}`);
  check('2D steady conduction, quadratic elements: error falls ≥ 8× per halving', e2[0] / e2[1] > 7.5 && e2[1] < 1e-4, `${fmt(e2[0])} → ${fmt(e2[1])}`);
}

// 4. 3D steady conduction: sin(πx) sin(πy) sinh(√2 π z) / sinh(√2 π)
{
  const k = Math.SQRT2 * Math.PI, exact = x => Math.sin(Math.PI * x[0]) * Math.sin(Math.PI * x[1]) * Math.sinh(k * x[2]) / Math.sinh(k);
  const M = C.mpMesh({ dim: 3, p: 2, axes: [{ L: 1, n: 6 }, { L: 1, n: 6 }, { L: 1, n: 6 }] });
  const t0 = Date.now();
  const r = C.mpScalar(M, { K: 1, steady: true, bc: ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].map(face => ({ face, type: 'value', u: exact })) });
  const e = maxErr(M, r.u, exact);
  check('3D steady conduction, quadratic hexahedra (6³)', e < 2e-3, `${fmt(e)}; ${M.N} nodes, ${Date.now() - t0} ms`);
}

// 5. a slab heated inside, insulated at one face, cooled by air at the other: exact (quadratic)
{
  const L = 0.01, k = 2, Q = 1e6, h = 50, Tinf = 20, M = C.mpMesh({ dim: 1, p: 2, axes: [[{ L, n: 3 }]] });
  const r = C.mpScalar(M, { K: k, Q, steady: true, bc: [{ face: 'x1', type: 'robin', h, uInf: Tinf }] });
  const exact = x => Tinf + Q * L / h + Q * (L * L - x[0] * x[0]) / (2 * k), e = maxErr(M, r.u, exact);
  check('heated slab cooled by air (a transfer coefficient): exact', e < 1e-9 * exact([0]), fmt(e));
}

// 6. radiation: a slab held at 800 °C on one face radiating to 20 °C from the other (the balance by bisection)
{
  const L = 0.005, k = 1.5, eps = 0.8, T1 = 800, Ti = 20, M = C.mpMesh({ dim: 1, p: 1, axes: [[{ L, n: 4 }]] });
  const r = C.mpScalar(M, { K: k, steady: true, picard: 60, tol: 1e-12, u0: 500,
    bc: [{ face: 'x0', type: 'value', u: T1 }, { face: 'x1', type: 'rad', eps, uInf: Ti }] });
  let lo = Ti, hi = T1;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2, q = k * (T1 - m) / L - eps * C.MP_SIGMA * ((m + 273.15) ** 4 - (Ti + 273.15) ** 4); if (q > 0) lo = m; else hi = m; }
  const T2 = r.u[M.node([4])];
  check('radiating face: the balance of conduction and radiation', Math.abs(T2 - lo) < 1e-6, `${T2.toFixed(6)} °C (exact ${lo.toFixed(6)}), ${r.iters} iterations`);
}

// 7. anisotropic conduction: u = x²/Kx − y²/Ky solves ∇·(K∇u) = 0 exactly with quadratics
{
  const Kx = 400, Ky = 2, exact = x => x[0] * x[0] / Kx - x[1] * x[1] / Ky;
  const M = C.mpMesh({ dim: 2, p: 2, axes: [{ L: 1, n: 3 }, { L: 0.1, n: 2 }] });
  const r = C.mpScalar(M, { K: [Kx, Ky], steady: true, bc: ['x0', 'x1', 'y0', 'y1'].map(face => ({ face, type: 'value', u: exact })) });
  const e = maxErr(M, r.u, exact);
  check('anisotropic conduction (along 200× through): exact', e < 1e-12, fmt(e));
}

// 8. advection and diffusion, steady, Péclet 20: SUPG on linear elements is exact at the nodes
{
  const Pe = 20, M = C.mpMesh({ dim: 1, p: 1, axes: [[{ L: 1, n: 16 }]] }), exact = x => Math.expm1(Pe * x[0]) / Math.expm1(Pe);
  const r = C.mpScalar(M, { K: 1, C: 1, vel: () => [Pe], steady: true, bc: [{ face: 'x0', type: 'value', u: 0 }, { face: 'x1', type: 'value', u: 1 }] });
  const e = maxErr(M, r.u, exact);
  check('advection and diffusion, cell Péclet 0.6: exact at the nodes', e < 1e-10, fmt(e));
}

// 9. a bent mesh: conduction through a quarter annulus (the polar map), and the flow through its faces
{
  const a = 0.01, b = 0.03, M = C.mpMesh({ dim: 2, p: 2, axes: [{ L: b - a, n: 8 }, { L: Math.PI / 2, n: 8 }], x0: [a, 0],
    map: x => [x[0] * Math.cos(x[1]), x[0] * Math.sin(x[1])] });
  const r = C.mpScalar(M, { K: 1, steady: true, bc: [{ face: 'x0', type: 'value', u: 0 }, { face: 'x1', type: 'value', u: 1 }] });
  const e = maxErr(M, r.u, x => Math.log(Math.hypot(x[0], x[1]) / a) / Math.log(b / a));
  const q = Math.PI / 2 / Math.log(b / a), qi = r.fluxIn('x1'), qo = -r.fluxIn('x0');
  check('quarter annulus (a bent mesh): the logarithm', e < 2e-5, fmt(e));
  check('quarter annulus: the flow in at the outer face = out at the inner = (π/2) k / ln(b/a)', rel(qi, q) < 1e-4 && rel(qo, q) < 1e-4, `${qi.toFixed(6)}, ${qo.toFixed(6)} (exact ${q.toFixed(6)})`);
}

// 10. elasticity: the patch test (a uniform strain on a bent mesh is exact), 2D and 3D, p 1 and 2
{
  const ex = [1e-3, -4e-4, 2.5e-4, 3e-4, -2e-4, 5e-4];   // xx yy zz yz xz xy (engineering)
  let e = 0;
  for (const dim of [2, 3]) for (const p of [1, 2]) {
    const warp = x => dim === 2 ? [x[0] + 0.08 * Math.sin(3 * x[1]), x[1] + 0.06 * Math.sin(2 * x[0])] : [x[0] + 0.05 * Math.sin(3 * x[1]), x[1] + 0.05 * Math.sin(2 * x[2]), x[2] + 0.04 * Math.sin(2 * x[0])];
    const M = C.mpMesh({ dim, p, axes: Array(dim).fill({ L: 1, n: 3 }), map: warp });
    const disp = x => dim === 2 ? [ex[0] * x[0] + ex[5] / 2 * x[1], ex[5] / 2 * x[0] + ex[1] * x[1]]
      : [ex[0] * x[0] + ex[5] / 2 * x[1] + ex[4] / 2 * x[2], ex[5] / 2 * x[0] + ex[1] * x[1] + ex[3] / 2 * x[2], ex[4] / 2 * x[0] + ex[3] / 2 * x[1] + ex[2] * x[2]];
    const faces = dim === 2 ? ['x0', 'x1', 'y0', 'y1'] : ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'];
    const r = C.mpElastic(M, { mats: [{ E: 200e9, nu: 0.3 }], plane: 'strain', bc: faces.map(face => ({ face, fix: [...Array(dim).keys()], value: disp })) });
    const want = dim === 3 ? ex : [ex[0], ex[1], 0, 0, 0, ex[5]];
    for (const g of r.gp) for (let i = 0; i < 6; i++) e = Math.max(e, Math.abs(g.strain[i] - want[i]));
  }
  check('elasticity patch test on bent meshes (2D, 3D; p 1, 2): the strain exact everywhere', e < 1e-12, fmt(e));
}

// 11. a block held all round and heated: σ = −E α ΔT / (1 − 2ν) in every direction
{
  const E = 70e9, nu = 0.33, al = 23e-6, dT = 100, M = C.mpMesh({ dim: 3, p: 1, axes: [{ L: 1, n: 2 }, { L: 1, n: 2 }, { L: 1, n: 2 }] });
  const r = C.mpElastic(M, { mats: [{ E, nu }], eig: () => [al * dT, al * dT, al * dT, 0, 0, 0],
    bc: ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].map(face => ({ face, fix: [0, 1, 2] })) });
  const s = -E * al * dT / (1 - 2 * nu), e = Math.max(...r.gp.flatMap(g => [0, 1, 2].map(i => Math.abs(g.stress[i] - s))));
  check('a block held all round and heated: σ = −E α ΔT / (1 − 2ν)', e < 1e-6 * Math.abs(s), `${(s / 1e6).toFixed(3)} MPa, error ${fmt(e)} Pa`);
  // free (held only against moving as a whole): no stress at all
  const f = C.mpElastic(M, { mats: [{ E, nu }], eig: () => [al * dT, al * dT, al * dT, 0, 0, 0],
    bc: [{ face: 'x0', fix: [0] }, { face: 'y0', fix: [1] }, { face: 'z0', fix: [2] }] });
  const sf = Math.max(...f.gp.flatMap(g => Array.from(g.stress).map(Math.abs)));
  check('the same block free: no stress, it grows by α ΔT', sf < 1e-3 && rel(f.u[M.node([2, 2, 2]) * 3], al * dT) < 1e-12, `${fmt(sf)} Pa`);
}

// 12. a beam bent by a moment (plane stress, quadratic elements: the exact 2D solution uy = M x² / (2 E I) on its axis)
{
  const E = 10e9, nu = 0.25, L = 0.1, h = 0.01, Mo = 50, I = h ** 3 / 12;
  const M = C.mpMesh({ dim: 2, p: 2, axes: [{ L, n: 10 }, { L: h, n: 2 }], x0: [0, -h / 2] });
  const mid = M.node([0, M.nn[1] >> 1]);
  const r = C.mpElastic(M, { mats: [{ E, nu }], plane: 'stress', bc: [{ face: 'x0', fix: [0] }, { node: mid, fix: [1] }, { face: 'x1', traction: x => [-Mo * x[1] / I, 0] }] });
  const tip = r.u[M.node([M.nn[0] - 1, M.nn[1] >> 1]) * 2 + 1], want = Mo * L * L / (2 * E * I);
  check('beam under a moment (plane stress): the tip moves M L² / (2 E I)', rel(tip, want) < 1e-9, `${(tip * 1e6).toFixed(6)} µm (exact ${(want * 1e6).toFixed(6)})`);
  const rx = r.reaction('x0')[0];
  check('beam under a moment: the support takes no net force along it', Math.abs(rx) < 1e-9 * Mo / h, fmt(rx));
}

// 13. the bimetal strip (Timoshenko 1925): the 1D laminate exactly; film.js's laminate the same; a long 2D strip
{
  const E1 = 200e9, E2 = 70e9, h1 = 0.5e-3, h2 = 1e-3, a1 = 12e-6, a2 = 23e-6, dT = 80, nu = 0.3;
  const m = h1 / h2, n = E1 / E2, h = h1 + h2;
  const kT = 6 * (a2 - a1) * dT * (1 + m) ** 2 / (h * (3 * (1 + m) ** 2 + (1 + m * n) * (m * m + 1 / (m * n))));
  // the bottom layer (1) from 0 to h1, the top (2) above: the top grows more, so it is stretched and convex: κ > 0
  const M1 = C.mpMesh({ dim: 1, p: 2, axes: [[{ L: h1, n: 2 }, { L: h2, n: 3 }]], mat: (ijk, seg) => seg[0] });
  const lam = C.mpLaminate(M1, { Q: mm => [E1, E2][mm], epsStar: mm => [a1, a2][mm] * dT });
  check('bimetal strip: the 1D laminate is Timoshenko\'s curvature', rel(lam.kappa, kT) < 1e-12, `${lam.kappa.toFixed(8)} 1/m (exact ${kT.toFixed(8)})`);
  const Qb = [E1 / (1 - nu), E2 / (1 - nu)];
  const fm = F.fmFree([{ t: h1, Q: Qb[0], en: a1 * dT, z0: 0 }, { t: h2, Q: Qb[1], en: a2 * dT, z0: h1 }]);
  const lb = C.mpLaminate(M1, { Q: mm => Qb[mm], epsStar: mm => [a1, a2][mm] * dT });
  check('the 1D laminate is film.js\'s (biaxial, the same strain and curvature)', rel(lb.kappa, fm.kappa) < 1e-12 && rel(lb.eps0, fm.e0) < 1e-12, `κ ${lb.kappa.toFixed(8)} and ${fm.kappa.toFixed(8)}`);
  // a 2D strip 60 thicknesses long (plane stress: a beam; its middle bends as the laminate)
  const Ls = 60 * h, M2 = C.mpMesh({ dim: 2, p: 2, axes: [{ L: Ls / 2, n: 30 }, [{ L: h1, n: 1 }, { L: h2, n: 2 }]], mat: (ijk, seg) => seg[1] });
  const r2 = C.mpElastic(M2, { mats: [{ E: E1, nu }, { E: E2, nu }], plane: 'stress', eig: mm => { const e = [a1, a2][mm] * dT; return [e, e, e, 0, 0, 0]; },
    bc: [{ face: 'x0', fix: [0] }, { node: M2.node([0, 0]), fix: [1] }] });
  // curvature from the bottom face's deflection over the middle third of the half strip: v = −κ x² / 2 (convex top: the ends go down)
  const j = 0; let sxx = 0, sxy = 0;
  for (let i = 0; i < M2.nn[0]; i++) { const x = M2.coord[0][i]; if (x > Ls / 6) continue; const v = r2.u[M2.node([i, j]) * 2 + 1]; sxx += x ** 4; sxy += x * x * v; }
  const k2 = -2 * sxy / sxx;
  check('a 2D strip (plane stress) bends as the 1D laminate away from its ends', rel(k2, kT) < 5e-3, `${k2.toFixed(6)} 1/m (1D ${kT.toFixed(6)})`);
  // plane strain: the width held, the laminate with E / (1 − ν²)
  const r2s = C.mpElastic(M2, { mats: [{ E: E1, nu }, { E: E2, nu }], plane: 'strain', eig: mm => { const e = [a1, a2][mm] * dT; return [e, e, e, 0, 0, 0]; },
    bc: [{ face: 'x0', fix: [0] }, { node: M2.node([0, 0]), fix: [1] }] });
  sxy = 0; for (let i = 0; i < M2.nn[0]; i++) { const x = M2.coord[0][i]; if (x > Ls / 6) continue; sxy += x * x * r2s.u[M2.node([i, j]) * 2 + 1]; }
  const k2s = -2 * sxy / sxx, lps = C.mpLaminate(M1, { Q: mm => [E1, E2][mm] / (1 - nu * nu), epsStar: mm => [a1, a2][mm] * dT * (1 + nu) });
  check('the 2D strip held across (plane strain) bends as its laminate', rel(k2s, lps.kappa) < 5e-3, `${k2s.toFixed(6)} 1/m (1D ${lps.kappa.toFixed(6)})`);
}

// 14. a 3D square plate of the two layers (a quarter, its mirror planes): the middle curls as the biaxial laminate
{
  const E1 = 200e9, E2 = 70e9, h1 = 0.5e-3, h2 = 0.5e-3, a1 = 12e-6, a2 = 23e-6, dT = 80, nu = 0.3, h = h1 + h2, Lh = 20 * h;
  const M = C.mpMesh({ dim: 3, p: 2, axes: [{ L: Lh, n: 8 }, { L: Lh, n: 8 }, [{ L: h1, n: 1 }, { L: h2, n: 1 }]], mat: (ijk, seg) => seg[2] });
  const t0 = Date.now();
  const r = C.mpElastic(M, { mats: [{ E: E1, nu }, { E: E2, nu }], eig: mm => { const e = [a1, a2][mm] * dT; return [e, e, e, 0, 0, 0]; },
    bc: [{ face: 'x0', fix: [0] }, { face: 'y0', fix: [1] }, { node: M.node([0, 0, 0]), fix: [2] }] });
  const ms = Date.now() - t0;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < M.nn[0]; i++) for (let jj = 0; jj < M.nn[1]; jj++) {
    const x = M.coord[0][i], y = M.coord[1][jj], r2 = x * x + y * y; if (r2 > (Lh / 3) ** 2) continue;
    const w = r.u[M.node([i, jj, 0]) * 3 + 2]; sxx += r2 * r2; sxy += r2 * w;
  }
  const k3 = -2 * sxy / sxx;
  const M1 = C.mpMesh({ dim: 1, p: 2, axes: [[{ L: h1, n: 1 }, { L: h2, n: 1 }]], mat: (ijk, seg) => seg[0] });
  const lb = C.mpLaminate(M1, { Q: mm => [E1, E2][mm] / (1 - nu), epsStar: mm => [a1, a2][mm] * dT });
  check('a 3D plate curls in its middle as the 1D biaxial laminate', rel(k3, lb.kappa) < 1e-2, `${k3.toFixed(5)} 1/m (1D ${lb.kappa.toFixed(5)}); ${M.N * 3} unknowns, ${ms} ms`);
}

// 15. the dimensions agree: a 2D varying along x only is the 1D (transient); a 3D strip with mirror sides is the 2D (stress)
{
  const k = 1.2, rc = 2e6, L = 2e-3, times = [2, 10];
  const M1 = C.mpMesh({ dim: 1, p: 2, axes: [[{ L, n: 8, grade: 3 }]] }), M2 = C.mpMesh({ dim: 2, p: 2, axes: [[{ L, n: 8, grade: 3 }], { L: 1e-3, n: 2 }] });
  const o = { K: k, C: rc, u0: 20, times, dt: 0.05, dtMax: 0.5, bc: [{ face: 'x0', type: 'value', u: (x, t) => 20 + 30 * Math.min(1, t) }, { face: 'x1', type: 'robin', h: 40, uInf: 25 }] };
  const r1 = C.mpScalar(M1, o), r2 = C.mpScalar(M2, o);
  let e = 0; for (let k2 = 0; k2 < M2.N; k2++) { const x = nodeX(M2, k2); e = Math.max(e, Math.abs(r2.u[k2] - C.mpAt(M1, r1.u, [x[0]]))); }
  check('2D heat varying along x only = the 1D (transient, graded mesh, air at one face)', e < 1e-10, fmt(e));
  const E = 5e9, nu = 0.2, al = 1e-5, Lb = 0.02, hb = 0.002;
  const T = x => 100 * x[1] / hb + 30 * x[0] / Lb;
  const M2e = C.mpMesh({ dim: 2, p: 2, axes: [{ L: Lb, n: 6 }, { L: hb, n: 2 }] }), M3e = C.mpMesh({ dim: 3, p: 2, axes: [{ L: Lb, n: 6 }, { L: hb, n: 2 }, { L: hb, n: 1 }] });
  const eig = (m, x, f) => { const e1 = al * f.T; return [e1, e1, e1, 0, 0, 0]; };
  const fT = MM => { const a = new Float64Array(MM.N); for (let q = 0; q < MM.N; q++) a[q] = T(nodeX(MM, q)); return a; };
  const r2e = C.mpElastic(M2e, { mats: [{ E, nu }], plane: 'strain', eig, fields: { T: fT(M2e) }, bc: [{ face: 'x0', fix: [0, 1] }] });
  const r3e = C.mpElastic(M3e, { mats: [{ E, nu }], eig, fields: { T: fT(M3e) }, bc: [{ face: 'x0', fix: [0, 1, 2] }, { face: 'z0', fix: [2] }, { face: 'z1', fix: [2] }] });
  let eu = 0, es = 0, us = 0;
  for (let q = 0; q < M3e.N; q++) {
    const x = nodeX(M3e, q), i = M3e.coord[0].indexOf(x[0]), j = M3e.coord[1].indexOf(x[1]), n2 = M2e.node([i, j]);
    for (let d = 0; d < 2; d++) { eu = Math.max(eu, Math.abs(r3e.u[q * 3 + d] - r2e.u[n2 * 2 + d])); us = Math.max(us, Math.abs(r2e.u[n2 * 2 + d])); }
    for (const c of [0, 1, 2, 5]) es = Math.max(es, Math.abs(r3e.stress[q * 6 + c] - r2e.stress[n2 * 6 + c]));
  }
  check('3D strip with mirror sides = 2D plane strain (thermal stress of a cantilever)', eu < 1e-10 * us && es < 1e-6 * E * al * 100, `displacement ${fmt(eu / us)} rel, stress ${fmt(es)} Pa`);
}

// 16. heat into stress: a plate heated inside (a parabola through it), free: σ = −Q α (T − its mean) (exact)
{
  const hh = 1e-3, k = 1, Qh = 8e6, Tf = 30, E = 3e9, nu = 0.35, al = 5e-5, Qb = E / (1 - nu);
  const M = C.mpMesh({ dim: 1, p: 2, axes: [[{ L: hh, n: 4 }]], x0: [-hh / 2] });
  const th = C.mpScalar(M, { K: k, Q: Qh, steady: true, bc: [{ face: 'x0', type: 'value', u: Tf }, { face: 'x1', type: 'value', u: Tf }] });
  const c = Qh * hh * hh / (8 * k);   // the rise at the middle
  const lam = C.mpLaminate(M, { Q: Qb, fields: { T: th.u }, epsStar: (m, z, f) => al * (f.T - Tf) });
  const mid = lam.zn.findIndex(z => Math.abs(z) < 1e-12), sMid = lam.sn[mid], sTop = lam.sn[lam.sn.length - 1];
  check('heat into stress: the middle at −Q α c / 3, the faces at +2 Q α c / 3, no curl', rel(sMid, -Qb * al * c / 3) < 1e-10 && rel(sTop, 2 * Qb * al * c / 3) < 1e-10 && Math.abs(lam.kappa) < 1e-9,
    `${(sMid / 1e6).toFixed(4)}, ${(sTop / 1e6).toFixed(4)} MPa`);
  // a linear temperature through it: it curls α ΔT / h and holds no stress
  const lin = C.mpLaminate(M, { Q: Qb, fields: { T: Float64Array.from(M.X, z => 20 + 50 * (z / hh + 0.5)) }, epsStar: (m, z, f) => al * f.T });
  check('a linear temperature: it curls α ΔT / h and holds no stress', rel(lin.kappa, al * 50 / hh) < 1e-12 && Math.max(...lin.sn.map(Math.abs)) < 1e-6, `${lin.kappa.toFixed(6)} 1/m`);
}

// 17. transversely isotropic stiffness: its compliance back, and film.js's plane-strain constants
{
  const m = { Ep: 30e9, nup: 0.17, Et: 3e9, nupt: 0.02, Gpt: 0.5e9 };
  const Cm = C.mpStiffness(m, 2), fm = F.fmTransIso(m.Ep, m.Et, m.nup, m.nupt, m.Gpt), S = C.mpInv6(Cm);
  const e = Math.max(rel(Cm[0][0], fm.C11), rel(Cm[0][2], fm.C13), rel(Cm[2][2], fm.C33), rel(Cm[4][4], fm.C55), rel(1 / S[0][0], m.Ep), rel(1 / S[2][2], m.Et), rel(-S[0][2] * m.Ep, m.nupt));
  check('transversely isotropic stiffness: film.js\'s constants, and E_p, E_t, ν_pt back from it', e < 1e-12, fmt(e));
}

// 18. stored water (a nonlinear isotherm): sealed, none is lost; open at a face, what it holds falls by what flows out
{
  const Xm = 0.07, Cg = 8, Kg = 0.8, ps = 1e5, rho = 1400, Kp = 3e-9;
  const gab = a => { const u = Kg * Math.min(Math.max(a, 0), 0.999); return Xm * Cg * u / ((1 - u) * (1 - u + Cg * u)); };
  const dgab = a => (gab(a + 1e-7) - gab(a - 1e-7)) / 2e-7;
  const S = (m, p) => rho * gab(p / ps), Cs = (m, p) => rho * dgab(p / ps) / ps;
  const M = C.mpMesh({ dim: 2, p: 1, axes: [{ L: 0.05, n: 12, grade: 4 }, { L: 0.05, n: 12, grade: 4 }] });
  for (const lump of [false, true]) {
    const u0 = x => ps * (0.2 + 0.6 * x[0] / 0.05);
    const T1 = C.mpTransport(M, { K: Kp, C: Cs, S, lump, u0, picard: 30, tol: 1e-12 });
    const m0 = T1.stored(); for (let k = 1; k <= 20; k++) T1.step(k * 600, 600);
    const drift = Math.abs(T1.stored() - m0) / m0;
    // (one face held: a node on two held faces would count in both)
    const T3 = C.mpTransport(M, { K: Kp, C: Cs, S, lump, u0: ps * 0.8, picard: 30, tol: 1e-12, bc: [{ face: 'x1', type: 'value', u: ps * 0.1 }] });
    let out3 = 0; const s3 = T3.stored(); for (let k = 1; k <= 20; k++) { T3.step(k * 600, 600); out3 -= T3.fluxIn('x1') * 600; }
    const bal = Math.abs((s3 - T3.stored()) - out3) / (s3 - T3.stored());
    check(`stored water through a nonlinear isotherm${lump ? ' (lumped)' : ''}: sealed none lost; open, the loss is the outflow`, drift < 1e-10 && bal < 1e-8,
      `sealed ${fmt(drift)}; balance ${fmt(bal)} of ${((s3 - T3.stored()) / s3 * 100).toFixed(1)} % lost`);
  }
  // a linear store (S = C u) is the capacity form exactly
  const a = C.mpScalar(M, { K: Kp, C: 5, u0: 1, times: [3000], dt: 300, dtMax: 300, bc: [{ face: 'x1', type: 'value', u: 0 }] });
  const b = C.mpScalar(M, { K: Kp, C: 5, S: (m, uu) => 5 * uu, u0: 1, times: [3000], dt: 300, dtMax: 300, bc: [{ face: 'x1', type: 'value', u: 0 }] });
  const e = Math.max(...a.u.map((v, k) => Math.abs(v - b.u[k])));
  check('a linear store is the capacity form exactly', e < 1e-12, fmt(e));
}

// 19. lumped capacity: the transient slab converges to the series as the consistent one does
{
  const L = 1e-3, D = 1e-7, tau = L * L / D, M = C.mpMesh({ dim: 1, p: 1, axes: [[{ L, n: 80 }]] });
  const r = C.mpScalar(M, { K: D, C: 1, lump: true, u0: 0, bc: [{ face: 'x0', type: 'value', u: 1 }, { face: 'x1', type: 'value', u: 1 }], times: [0.05 * tau], dt: 1e-5 * tau, dtMax: 1e-4 * tau, grow: 1.1 });
  const exact = x => { let s = 1; for (let n = 0; n < 200; n++) { const m = 2 * n + 1; s -= 4 / (m * Math.PI) * Math.sin(m * Math.PI * x / L) * Math.exp(-m * m * Math.PI * Math.PI * 0.05); } return s; };
  let mn = Infinity; for (const v of r.u) mn = Math.min(mn, v);
  const e = maxErr(M, r.u, x => exact(x[0]));
  check('lumped capacity: the slab against its series, never below its start', e < 2e-3 && mn >= -1e-12, `${fmt(e)}; lowest ${fmt(mn)}`);
}

// 20. the flow through faces with air and radiation: a steady slab's heat in at one face = out at the other
{
  const M = C.mpMesh({ dim: 2, p: 2, axes: [{ L: 0.01, n: 4 }, { L: 0.02, n: 3 }] });
  const T = C.mpTransport(M, { K: 3, picard: 60, tol: 1e-13, u0: 100, bc: [{ face: 'x0', type: 'robin', h: 200, uInf: 300 }, { face: 'x1', type: 'rad', eps: 0.9, uInf: 20 }] });
  T.steady();
  const qi = T.faceIn('x0'), qo = -T.faceIn('x1');
  check('heat in through air at one face = out by radiation at the other (steady)', rel(qi, qo) < 1e-9, `${qi.toFixed(4)} W/m in, ${qo.toFixed(4)} out`);
}

// 21. heat and moisture together (mpHeatMoisture)
{
  const DR = require('./drying.js');
  const M = C.mpMesh({ dim: 2, p: 1, axes: [{ L: 0.02, n: 10, grade: 3 }, { L: 0.004, n: 4 }] });
  const k = 0.5, CT = 2e6, Kv = 2e-10, Sl = p => 0.02 * p;   // a linear store (kg/m³ per Pa)
  // (a) no latent heat and a store that does not feel the temperature: the heat and the water as two separate solves
  const hm = C.mpHeatMoisture(M, { kT: k, CT: () => CT, Kv, S: (m, p) => Sl(p), dS: () => [0.02, 0], L: 0, T0: 20, p0: 2000,
    bcT: [{ face: 'x0', type: 'robin', h: 30, uInf: 90 }], bcV: [{ face: 'x1', type: 'value', u: 500 }] });
  const ht = C.mpTransport(M, { K: k, C: CT, lump: true, u0: 20, bc: [{ face: 'x0', type: 'robin', h: 30, uInf: 90 }] });
  const wt = C.mpTransport(M, { K: Kv, C: 0.02, lump: true, u0: 2000, bc: [{ face: 'x1', type: 'value', u: 500 }] });
  let t = 0; for (let i = 1; i <= 12; i++) { const dt = 30 * i; t += dt; hm.step(t, dt); ht.step(t, dt); wt.step(t, dt); }
  const eT = Math.max(...hm.T.map((v, n) => Math.abs(v - ht.u[n]))), eP = Math.max(...hm.p.map((v, n) => Math.abs(v - wt.u[n])));
  check('heat and moisture uncoupled = the two separate solves', eT < 1e-9 && eP < 1e-6, `T ${fmt(eT)} K, p ${fmt(eP)} Pa`);
  // (b) coupled (a GAB-like store at the local temperature, the latent heat): sealed, the water stays and the enthalpy
  // rises by the heat in; open, the water lost flows out and the heat in = the rise of C_T T + L × the water lost
  const gab = { Xm: 0.07, C: 8, K: 0.8 }, rho = 1400, Lc = 2.3e6;
  const So = (m, p, T) => rho * DR.drGAB(Math.min(p / DR.drPsat(T), 0.99), gab);
  const mk = open => C.mpHeatMoisture(M, { kT: [2, 0.3], CT: () => CT, Kv: [3e-8, 1e-11], S: So, L: Lc, T0: 20, p0: 0.7 * DR.drPsat(20),
    bcT: [{ face: 'y1', type: 'robin', h: 12, uInf: 100 }, { face: 'y1', type: 'rad', eps: 0.9, uInf: 100 }, { face: 'x1', type: 'robin', h: 8, uInf: 100 }],
    bcV: open ? [{ face: 'x1', type: 'value', u: 1200 }] : [], tol: 1e-13, iters: 200 });
  for (const open of [false, true]) {
    const R = mk(open), W0 = R.water(), H0 = R.enthalpy();
    let Qin = 0, Vin = 0; t = 0;
    for (let i = 1; i <= 6; i++) { const dt = 20 * i; t += dt; R.step(t, dt); Qin += (R.heatIn('y1') + R.heatIn('x1')) * dt; Vin += open ? R.vapourIn('x1') * dt : 0; }
    const dW = R.water() - W0, dH = R.enthalpy() - H0;
    const eW = Math.abs(dW - Vin) / W0, eH = Math.abs(dH - Qin) / Math.abs(Qin);
    check(`heat and moisture coupled, ${open ? 'open at an edge: the water lost flowed out; the enthalpy rose by the heat in' : 'sealed: the water stays; the enthalpy rose by the heat in'}`,
      eW < 1e-9 && eH < 1e-8, `water ${fmt(eW)}${open ? ` (${(-dW / W0 * 100).toFixed(1)} % lost)` : ''}, energy ${fmt(eH)}; T ${Math.min(...R.T).toFixed(1)}–${Math.max(...R.T).toFixed(1)} °C`);
  }
  // (c) the wet-bulb: a thin wet slab (its store near full) in hot air, water leaving from its face: its temperature
  // settles where the heat in = L × the vapour out, h (T∞ − T) = L β (a p_sat(T) − p∞)
  const h = 25, beta = 2e-7, Tinf = 80, pinf = 2000, a0 = 0.95, Sbig = 5e5;
  const Mw = C.mpMesh({ dim: 1, p: 1, axes: [[{ L: 1e-3, n: 4 }]] });
  const R = C.mpHeatMoisture(Mw, { kT: 50, CT: () => 1e6, Kv: 1e-6, S: (m, p, T) => Sbig * p / DR.drPsat(T), L: Lc, T0: 20, p0: a0 * DR.drPsat(20),
    bcT: [{ face: 'x1', type: 'robin', h, uInf: Tinf }], bcV: [{ face: 'x1', type: 'robin', h: beta, uInf: pinf }] });
  t = 0; for (let i = 0; i < 400; i++) { t += 5; R.step(t, 5); }
  const a = R.p[0] / DR.drPsat(R.T[0]);
  let lo = 0, hi = Tinf; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (h * (Tinf - m) - Lc * beta * (a * DR.drPsat(m) - pinf) > 0) lo = m; else hi = m; }
  check('a wet surface in hot air settles at its wet-bulb temperature', Math.abs(R.T[0] - lo) < 0.02, `${R.T[0].toFixed(3)} °C (the balance ${lo.toFixed(3)} °C at a = ${a.toFixed(4)}; the air ${Tinf} °C)`);
  // (d) 2D varying along x only = 1D (coupled)
  const M1 = C.mpMesh({ dim: 1, p: 1, axes: [[{ L: 0.02, n: 10, grade: 3 }]] }), M2 = C.mpMesh({ dim: 2, p: 1, axes: [[{ L: 0.02, n: 10, grade: 3 }], { L: 0.003, n: 2 }] });
  const oo = { kT: 2, CT: () => CT, Kv: 3e-8, S: So, L: Lc, T0: 20, p0: 0.7 * DR.drPsat(20), bcT: [{ face: 'x0', type: 'robin', h: 20, uInf: 100 }], bcV: [{ face: 'x1', type: 'value', u: 1200 }] };
  const r1 = C.mpHeatMoisture(M1, oo), r2 = C.mpHeatMoisture(M2, oo);
  t = 0; for (let i = 1; i <= 15; i++) { const dt = 20 * i; t += dt; r1.step(t, dt); r2.step(t, dt); }
  let e1 = 0, e2 = 0; for (let n = 0; n < M2.N; n++) { const x = [M2.X[n * 2]]; e1 = Math.max(e1, Math.abs(r2.T[n] - C.mpAt(M1, r1.T, x))); e2 = Math.max(e2, Math.abs(r2.p[n] - C.mpAt(M1, r1.p, x))); }
  check('heat and moisture: a 2D varying along x only = the 1D', e1 < 1e-8 && e2 < 1e-6, `T ${fmt(e1)} K, p ${fmt(e2)} Pa`);
}

// 22. heat and moisture in time: BDF2 is second order (the water of a strip through a nonlinear isotherm, against an
//     independent explicit reference); its discrete balance holds step by step
{
  const DR = require('./drying.js'), P = require('./press.js');
  const gab = { Xm: 0.07, C: 8, K: 0.8 }, ps = DR.drPsat(100), aE = 0.5 * DR.drPsat(22) / ps, K = 3e-7, rho = 1500, G = K * ps / rho, L = 0.15, tEnd = 120;
  // the reference: explicit finite volumes on X, 100 cells, the stable step
  const n = 100, dx = L / n, X = new Float64Array(n).fill(0.15);
  let dadX = 0; for (let a = 0.001; a < 0.99; a += 0.001) dadX = Math.max(dadX, 1 / P.prGABslope(a, gab));
  const ns = Math.ceil(tEnd / (0.4 * dx * dx / (G * dadX))), h = tEnd / ns, a = new Float64Array(n), F = new Float64Array(n + 1);
  for (let s = 0; s < ns; s++) {
    for (let i = 0; i < n; i++) a[i] = P.prActivity(X[i], gab);
    for (let i = 1; i < n; i++) F[i] = -G * (a[i] - a[i - 1]) / dx;
    F[n] = -G * (aE - a[n - 1]) / (dx / 2);
    for (let i = 0; i < n; i++) X[i] -= h * (F[i + 1] - F[i]) / dx;
  }
  const ref = X[0];
  const M = C.mpMesh({ dim: 1, p: 1, axes: [[{ L, n: 100 }]] });
  const run = (bdf2, steps) => {
    const R = C.mpHeatMoisture(M, { kT: 1e3, CT: () => 1e6, Kv: K, L: 0, bdf2, tol: 1e-12, iters: 100, T0: 100, p0: P.prActivity(0.15, gab) * ps,
      S: (m, p) => rho * P.prGAB(p / ps, gab), dS: (m, p) => [rho * P.prGABslope(p / ps, gab) / ps, 0],
      bcT: [{ face: 'x0', type: 'value', u: 100 }], bcV: [{ face: 'x1', type: 'value', u: aE * ps }] });
    const W0 = R.water(); let t = 0, held = 0, inflow = 0;
    for (let k = 0; k < steps; k++) { const dt = tEnd / steps; t += dt; R.step(t, dt); held += R.stepHeld.W; inflow += R.vapourIn('x1') * dt; }
    return { X: P.prGAB(R.p[0] / ps, gab), bal: Math.abs(held - inflow) / W0 };
  };
  const ie = [run(false, 20), run(false, 40)], bd = [run(true, 20), run(true, 40)];
  const eI = ie.map(r => Math.abs(r.X - ref)), eB = bd.map(r => Math.abs(r.X - ref));
  check('BDF2 in time: its error falls about 4× per halving and is far below implicit Euler\'s', eB[0] / eB[1] > 3 && eB[1] < 0.2 * eI[1],
    `reference ${ref.toFixed(6)}; implicit Euler ${eI.map(fmt).join(' → ')}; BDF2 ${eB.map(fmt).join(' → ')}`);
  check('BDF2: the water that flowed out is the change of what is held, step by step', bd.every(r => r.bal < 1e-10), bd.map(r => fmt(r.bal)).join(', '));
}

// 23. a source at the nodes with its slope (Qn, Newton; MP-2's reaction heat): a fin (−k u'' + b u = 0, the exact cosh,
//     second order in the mesh); Bratu's problem (−u'' = λ eᵘ: exact, Newton's few iterations); an insulated body heated
//     by an Arrhenius source: what it holds rises by what the source gives, step by step
{
  const L = 1, k = 1, b = 25, m = Math.sqrt(b / k), ex = x => Math.cosh(m * (L - x[0])) / Math.cosh(m * L);
  const fin = n => { const M = C.mpMesh({ dim: 1, p: 1, axes: [[{ L, n }]] });
    const T = C.mpTransport(M, { K: k, Qn: (mm, nd, u) => [-b * u, -b], bc: [{ face: 'x0', type: 'value', u: 1 }], u0: 0, picard: 3, tol: 1e-13 });
    T.steady(); return maxErr(M, T.u, ex); };
  const e1 = fin(20), e2 = fin(40);
  check('a nodal source: the fin against its exact cosh, second order', e2 < 2e-3 && e1 / e2 > 3.6 && e1 / e2 < 4.4, `${fmt(e1)} → ${fmt(e2)} (ratio ${(e1 / e2).toFixed(2)})`);
  // Bratu, λ = 1: u = −2 ln(cosh((x − ½) θ/2) / cosh(θ/4)), θ = √(2λ) cosh(θ/4)
  let th = 1; for (let i = 0; i < 200; i++) th = Math.sqrt(2) * Math.cosh(th / 4);
  const bex = x => -2 * Math.log(Math.cosh((x[0] - 0.5) * th / 2) / Math.cosh(th / 4));
  const bratu = n => { const M = C.mpMesh({ dim: 1, p: 1, axes: [[{ L: 1, n }]] });
    const T = C.mpTransport(M, { K: 1, Qn: (mm, nd, u) => [Math.exp(u), Math.exp(u)], bc: [{ face: 'x0', type: 'value', u: 0 }, { face: 'x1', type: 'value', u: 0 }], u0: 0, picard: 30, tol: 1e-13 });
    T.steady(); return [maxErr(M, T.u, bex), T.iters]; };
  const [b1, it1] = bratu(40), [b2] = bratu(80);
  check('Bratu\'s problem by Newton: its exact solution (second order), in a few iterations', b2 < 1e-4 && b1 / b2 > 3.6 && it1 <= 6, `${fmt(b1)} → ${fmt(b2)}, ${it1} iterations`);
  // an insulated 2D block, an Arrhenius heat at its nodes (state: what has reacted, kept at each node), enthalpy S(T)
  const M = C.mpMesh({ dim: 2, p: 1, axes: [[{ L: 0.01, n: 4 }], [{ L: 0.01, n: 4 }]] }), rho = 2e6, H = 4e8, A = 1e5, E = 5e4, R = 8.314;
  const left = new Float64Array(M.N).fill(1), T0 = new Float64Array(M.N);
  let dtNow = 1;
  // (over a step at the node's new T: first order, exact in time at a fixed T: dα = left (1 − e^(−k dt)))
  const rate = T => A * Math.exp(-E / (R * (T + 273.15)));
  const react = (n, T) => { const kk = rate(T), f = -Math.expm1(-kk * dtNow); return [left[n] * f, left[n] * Math.exp(-kk * dtNow) * dtNow * kk * E / (R * (T + 273.15) ** 2)]; };
  const Tr = C.mpTransport(M, { K: 1, C: (mm, u) => rho * (1 + 1e-3 * u), S: (mm, u) => rho * (u + 5e-4 * u * u), lump: true,
    Qn: (mm, n, u) => { const [da, dd] = react(n, u); return [H * da / dtNow, H * dd / dtNow]; }, u0: 100, picard: 40, tol: 1e-13 });
  let worst = 0, t = 0;
  for (let s = 0; s < 40; s++) {
    dtNow = 2; const before = Tr.stored(); T0.set(Tr.u);
    Tr.step(t += dtNow, dtNow);
    const q = Tr.nodalIn() * dtNow, after = Tr.stored();
    worst = Math.max(worst, Math.abs(after - before - q) / Math.max(1, Math.abs(q)));
    for (let n = 0; n < M.N; n++) left[n] -= react(n, Tr.u[n])[0];
  }
  const Tend = Tr.u[0];
  // (the adiabatic rise: all of it reacted gives H / rho on the enthalpy; S(T) = rho (T + 5e-4 T²))
  const held = rho * (Tend + 5e-4 * Tend * Tend) - rho * (100 + 5e-4 * 1e4), gone = H * (1 - left[0]);
  check('an Arrhenius heat at the nodes: what the body holds rises by what the source gives, step by step; even', worst < 1e-9 && rel(held, gone) < 1e-9 && Math.max(...Tr.u) - Math.min(...Tr.u) < 1e-9,
    `balance ${fmt(worst)}; ${(100 * (1 - left[0])).toFixed(1)} % reacted, ${Tend.toFixed(2)} °C`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
