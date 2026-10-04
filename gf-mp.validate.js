'use strict';
/*
 * gf-mp.validate.js — MP-GF's checks (gf-mp.js): the graphene film on a heater, in 1D, 2D and 3D, against independent
 * solutions.
 *  1. 1D steady, the film's faces losing by convection, its edge closed: the fin's closed form (two pieces joined at the
 *     heater's edge), under the heater one face losing and two.
 *  2. 2D: a thin film's section is the 1D's (its Biot number through it ≪ 1).
 *  3. 3D steady: the thin plate's double cosine series (both faces losing everywhere, its edges closed).
 *  4. Energy: the heater's power = what leaves to the air, steady, with radiation and the edges open, 1D, 2D, 3D.
 *  5. In time: the heater under the whole piece, its temperature rising as q/(2h) (1 − e^(−t/τ)), τ = ρ c t / (2h).
 *  6. Stress: an even rise gives none; the 3D's stress across a long piece with a band heater is the long piece's
 *     closed form, closing in as its mesh is halved.
 *  7. Mesh: the 1D's peak, its elements halved, converges.
 */
const G = require('./gf-mp.js');
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
const pct = v => `${(v * 100).toFixed(4)} %`;
const film = { E: 30e9, nu: 0.17, alpha: -1e-6 };
const base = { Lx: 0.1, Ly: 0.1, t: 50e-6, kp: 1000, kt: 5, rho: 2000, c: 700, heater: { a: 0.02, P: 1 }, air: { h: 10, T: 25, eps: 0 }, tEnd: 60, steps: 20 };
const m1 = { nh: 20, nx: 60, grade: 4, nz: 4 };

// 1. 1D against the fin
for (const heaterLoss of [false, true]) {
  const o = { ...base, dim: 1, mesh: m1, check: { edges: 'adiabatic', heaterLoss } }, r = G.gfRun(o);
  const x = r.mesh.coord[0]; let e = 0, mx = 0;
  for (let i = 0; i < x.length; i++) { const th = G.gfFin1(o, x[i]); e = Math.max(e, Math.abs(r.steady.T[i] - 25 - th)); mx = Math.max(mx, th); }
  check(`1D steady against the fin's closed form, under the heater ${heaterLoss ? 'both faces' : 'one face'} losing`, e / mx < 2e-4, `largest difference ${pct(e / mx)} of the ${mx.toFixed(3)} K rise`);
}
// 2. 2D = 1D
{
  const r1 = G.gfRun({ ...base, dim: 1, mesh: m1 }), r2 = G.gfRun({ ...base, dim: 2, mesh: m1 });
  const nx = r1.mesh.coord[0].length, z = r2.mesh.coord[1].length; let e = 0;
  // (the 2D's nodes at its mid-thickness and on its faces against the 1D's at each x: node order from the 2D's mesh)
  const M2 = require('./mp-core.js').mpMesh({ dim: 2, p: 1, axes: G.gfAxes({ ...base, dim: 2, mesh: m1 }).axes });
  for (let i = 0; i < nx; i++) for (let k = 0; k < z; k++) e = Math.max(e, Math.abs(r2.steady.T[M2.node([i, k])] - r1.steady.T[i]));
  const rise = r1.steady.Tmax - 25;
  check('2D (the film\'s section) against the 1D: a thin film is even through its thickness', e / rise < 1e-3, `largest difference ${e.toExponential(2)} K of ${rise.toFixed(3)} K (q t / k_t = ${(G.gfFlux(base) * base.t / base.kt).toExponential(2)} K through it)`);
}
// 3. 3D against the plate series
{
  const o = { ...base, dim: 3, mesh: { nh: 10, nx: 24, grade: 4, nz: 1 }, check: { edges: 'adiabatic', heaterLoss: true }, steps: 5 }, r = G.gfRun(o);
  const p0 = G.gfPlate(o, 0, 0, 400), pE = G.gfPlate(o, o.Lx / 2, 0, 400);
  // (its middle: the mean of the bottom and top faces' -- the series is the film's mean through it)
  const ex = Math.abs(r.steady.Tmax - 25 - p0) / p0, ee = Math.abs(r.steady.Tedge - 25 - pE) / pE;
  check('3D steady against the thin plate\'s double cosine series: the middle and the edge\'s middle', ex < 2e-3 && ee < 2e-3, `middle ${pct(ex)} (${(r.steady.Tmax - 25).toFixed(4)} against ${p0.toFixed(4)} K), edge ${pct(ee)}`);
}
// 4. energy balance
for (const dim of [1, 2, 3]) {
  const o = { ...base, dim, air: { h: 10, T: 25, eps: 0.4 }, mesh: dim === 3 ? { nh: 6, nx: 14, grade: 4, nz: 2 } : m1, steps: 5 }, r = G.gfRun(o);
  const e = Math.abs(r.steady.Pout - r.Pin) / r.Pin;
  check(`${dim}D energy: the heater's power = what leaves (convection and radiation, its faces and edges)`, e < 1e-6, `in ${r.Pin.toPrecision(5)}, out ${r.steady.Pout.toPrecision(5)} ${dim === 3 ? 'W (the quarter)' : 'W per m across'}`);
}
// 5. in time: the heater under the whole piece
for (const dim of [1, 2, 3]) {
  const L = 0.02, o = { ...base, dim, Lx: L, Ly: L, heater: { a: L, P: 1 }, check: { edges: 'adiabatic', heaterLoss: true }, tEnd: 20, steps: 200, mesh: { nh: 4, nx: 1, grade: 1, nz: 2 } };
  const r = G.gfRun(o), q = G.gfFlux(o), tau = o.rho * o.c * o.t / (2 * o.air.h);
  let e = 0; for (const p of r.hist) if (p.t > 0) e = Math.max(e, Math.abs(p.Tmax - 25 - q / (2 * o.air.h) * (1 - Math.exp(-p.t / tau))));
  check(`${dim}D in time: the heater under the whole piece rises as q/(2h)(1 − e^(−t/τ)), τ ${tau.toFixed(2)} s`, e / (q / (2 * o.air.h)) < 1.5e-2, `largest difference ${pct(e / (q / (2 * o.air.h)))} of the final rise (implicit Euler, ${o.steps} steps of ${G.gfSteps(o).dt0.toPrecision(2)} s first, each ${((G.gfSteps(o).r - 1) * 100).toFixed(1)} % longer)`);
}
// 5b. in time, the app's way: a long time on the heater in few steps, the first a tenth of the film's own time
{
  const L = 0.02, o = { ...base, dim: 1, Lx: L, Ly: L, heater: { a: L, P: 1 }, check: { edges: 'adiabatic', heaterLoss: true }, tEnd: 600, steps: 60, mesh: { nh: 4, nx: 1, grade: 1, nz: 1 } };
  const r = G.gfRun(o), q = G.gfFlux(o), tau = o.rho * o.c * o.t / (2 * o.air.h), st = G.gfSteps(o);
  let e = 0; for (const p of r.hist) if (p.t > 0) e = Math.max(e, Math.abs(p.Tmax - 25 - q / (2 * o.air.h) * (1 - Math.exp(-p.t / tau))));
  check(`1D in time, ${o.tEnd} s in ${o.steps} steps from ${st.dt0.toFixed(2)} s (each ${((st.r - 1) * 100).toFixed(1)} % longer): the same rise`, e / (q / (2 * o.air.h)) < 3e-2, `largest difference ${pct(e / (q / (2 * o.air.h)))} of the final rise`);
}
// 6. stress
{
  const L = 0.02, o = { ...base, Lx: L, Ly: L, heater: { a: L, P: 1 }, check: { edges: 'adiabatic', heaterLoss: true }, film, steps: 5 };
  const s = [1, 2, 3].map(dim => G.gfRun({ ...o, dim, mesh: { nh: 4, nx: 1, grade: 1, nz: 2 } }).stress.steady), worst = Math.max(...s.map(q => Math.max(Math.abs(q.sMax), Math.abs(q.sMin))));
  const ref = film.E * Math.abs(film.alpha) * G.gfFlux(o) / (2 * o.air.h);
  // (the heater stops 0.1 % short of the edge -- the mesh's own: what is left is that sliver's)
  check('stress: an even rise (the heater under the whole piece, its edges closed) gives none, 1D, 2D, 3D', worst < 1e-4 * ref, `largest ${worst.toExponential(2)} Pa against E α ΔT ${(ref / 1e6).toFixed(2)} MPa`);
  const lp = { ...base, Lx: 0.05, Ly: 0.6, heater: { a: 0.02, b: 0.6, P: 1 }, check: { edges: 'adiabatic' }, film, steps: 5 }, errs = [];
  for (const [nh, nx] of [[8, 16], [16, 32], [32, 64]]) {
    const r1 = G.gfRun({ ...lp, dim: 1, mesh: { nh, nx, grade: 4, nz: 1 } }), r3 = G.gfRun({ ...lp, dim: 3, mesh: { nh, nx, grade: 4, nz: 1 } }), s3 = r3.stress.steady, P = G.gfPlane(s3.x, s3.y);
    let e = 0, m = 0; for (let i = 0; i < s3.x.length; i++) { const b = r1.stress.steady.syy[i]; e = Math.max(e, Math.abs(s3.syy[P.node([i, 0])] - b)); m = Math.max(m, Math.abs(b)); }
    errs.push(e / m);
  }
  check('stress: the 3D across a long piece (a band heater) closes on the long piece\'s σ_yy = E (ε̄ − α ΔT), halving the mesh', errs[2] < 0.01 && errs[1] < errs[0] * 0.6 && errs[2] < errs[1] * 0.6, errs.map(pct).join(' → '));
}
// 7. mesh
{
  const pk = [[5, 15], [10, 30], [20, 60], [40, 120]].map(([nh, nx]) => G.gfRun({ ...base, dim: 1, air: { h: 10, T: 25, eps: 0.4 }, mesh: { nh, nx, grade: 4, nz: 1 }, steps: 5 }).steady.Tmax);
  const d1 = Math.abs(pk[1] - pk[0]), d2 = Math.abs(pk[2] - pk[1]), d3 = Math.abs(pk[3] - pk[2]);
  check('mesh: the 1D\'s peak with radiation, its elements halved three times, converges (second order)', d2 < d1 / 3 && d3 < d2 / 3, pk.map(v => v.toFixed(5)).join(' → ') + ' °C');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
