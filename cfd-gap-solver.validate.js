/*
 * cfd-gap-solver.validate.js — correctness checks for cfd-gap-solver.js
 * against exact solutions and a published benchmark (none of them this
 * app's own formulas):
 *
 *  1. Flat gap, Newtonian: exact Couette-Poiseuille flow; second-order
 *     grid convergence; the recovered pressure is exactly linear, drops by
 *     exactly the bead pressure, and the two integration routes agree.
 *  2. Flat gap, yield stress / shear-thinning: exact 1D generalized-
 *     Newtonian solution (stress linear across the gap, inverted pointwise;
 *     cfd-solver.js's solveFullyDeveloped1D). Results must not move when
 *     the viscosity regularization is reduced tenfold.
 *  3. Stokes flow in a wedge (Moffatt 1964 / the Stokes limit of Jeffery-
 *     Hamel flow): an exact 2D solution with a sloped wall, both velocity
 *     components non-zero and an exact pressure field -- tests every metric
 *     term of the boundary-fitted grid and the pressure recovery; second-
 *     order convergence; flow rate recovered from the pressure drop alone.
 *  4. Lid-driven cavity, Re = 100, against Ghia, Ghia & Shin (1982) --
 *     the inertia (convection) terms.
 *  5. Round entry (R = 100 mm) onto the metering edge: against Reynolds
 *     lubrication theory, which the 2D solution must approach to within
 *     O(H/2R), the square of the gap's slope scale; second-order grid
 *     convergence; and where the bead pressure acts (the inlet, "pool
 *     edge") -- the result depends on it physically, and the 2D solution
 *     must follow lubrication theory's own dependence at every position.
 *
 * Run: node cfd-gap-solver.validate.js
 */
const { solveGapFlow } = require('./cfd-gap-solver.js');
const { solveFullyDeveloped1D, muEffLocal } = require('./cfd-solver.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const pct = x => (x * 100).toFixed(3) + '%';
const RHO = 1020, U = 0.28 / 60, H = 1.7e-3, L = 10e-3, PUP = 720, MU = 10.5;

// ---------------------------------------------------------------- 1
{
  console.log('\n-- 1. flat gap, Newtonian: exact Couette-Poiseuille --');
  const G = PUP / L, Qa = U * H / 2 + G * H ** 3 / (12 * MU);
  const errs = [];
  for (const [nx, ny] of [[61, 21], [61, 41]]) {
    const r = solveGapFlow({ nx, ny, Lx: L, h: () => H, U, rho: RHO, mu: () => MU, Pup: PUP });
    errs.push(Math.abs(r.Q / Qa - 1));
    if (ny === 41) {
      check(r.converged, `converged (residual ${r.residual.toExponential(1)})`);
      let uErr = 0, slope = 0;
      const i = 30;
      for (let j = 0; j < ny; j++) { const y = j * H / (ny - 1); uErr = Math.max(uErr, Math.abs(r.u[j * nx + i] - (U * (1 - y / H) + G / (2 * MU) * y * (H - y))) / U); }
      for (let k = 0; k < nx; k++) slope = Math.max(slope, Math.abs(r.dpdxWeb[k] + G) / G);
      check(uErr < 1e-6, `u(y) = exact profile (max error ${uErr.toExponential(1)} of U)`);
      check(slope < 1e-6, `dp/dx = -Pup/L everywhere along the gap (max error ${slope.toExponential(1)})`);
      check(Math.abs(r.pWeb[0] - PUP) / PUP < 1e-6, `pressure drop inlet to edge = bead pressure (${r.pWeb[0].toFixed(4)} Pa vs ${PUP})`);
      check(r.pathError < 1e-6, `pressure identical by both integration routes (${r.pathError.toExponential(1)} of range)`);
    }
  }
  const order = Math.log(errs[0] / errs[1]) / Math.log(2);
  check(errs[1] < 1e-3 && order > 1.8, `flow rate error ${pct(errs[0])} -> ${pct(errs[1])} when the grid is halved: order ${order.toFixed(2)} (2 expected)`);
}

// ---------------------------------------------------------------- 2
{
  console.log('\n-- 2. flat gap, yield stress / shear-thinning: exact 1D solution --');
  for (const [ty, n] of [[5, 1], [20, 0.5], [0, 0.4]]) {
    const law = gd => muEffLocal(gd, MU, ty, n);
    const p1 = solveFullyDeveloped1D({ Ly: H, U, G: PUP / L, muRef: MU, ty, n, ny: 8001 });
    let q1 = 0; for (let j = 1; j < p1.ny; j++) q1 += 0.5 * (p1.u[j - 1] + p1.u[j]) * p1.dy;
    const umax = Math.max(...p1.u);
    const res = [1e-3, 1e-4].map(f => solveGapFlow({ nx: 41, ny: 41, Lx: L, h: () => H, U, rho: RHO, mu: law, gdMin: f * U / H, Pup: PUP }));
    const r = res[0];
    let uErr = 0;
    for (let j = 0; j < r.ny; j++) { const jj = Math.round(j * H / (r.ny - 1) / p1.dy); uErr = Math.max(uErr, Math.abs(r.u[j * r.nx + 20] - p1.u[jj]) / umax); }
    const plug = Array.from(p1.gd).filter(g => g === 0).length / p1.ny;
    console.log(`   ty ${ty} Pa, n ${n}: plug ${pct(plug)} of the gap, ${r.iterations} Newton steps`);
    check(r.converged, `  converged (residual ${r.residual.toExponential(1)})`);
    check(Math.abs(r.Q / q1 - 1) < 5e-3, `  flow rate vs exact: ${pct(r.Q / q1 - 1)}`);
    check(uErr < 5e-3, `  u(y) vs exact: max ${pct(uErr)} of peak velocity`);
    check(Math.abs(res[1].Q / r.Q - 1) < 1e-3, `  regularization 10x smaller changes Q by ${pct(res[1].Q / r.Q - 1)}`);
    check(Math.abs(r.pWeb[0] - PUP) / PUP < 1e-6, `  pressure drop = bead pressure`);
  }
}

// ---------------------------------------------------------------- 3
{
  console.log('\n-- 3. Stokes flow in a wedge (exact, sloped wall, exact pressure) --');
  const beta = 15 * Math.PI / 180, tb = Math.tan(beta), x1 = 5e-3, x2 = 15e-3, mu = 10, A = -1e-6;
  const psiT = th => A * ((Math.sin(2 * th - beta) + Math.sin(beta)) / 2 - th * Math.cos(beta));
  const Qex = psiT(beta);
  const exact = (xs, eta) => {                       // xs: solver x (0..Lx)
    const xp = x1 + xs, y = eta * xp * tb, r = Math.hypot(xp, y), th = Math.atan2(y, xp);
    const ur = A * (Math.cos(2 * th - beta) - Math.cos(beta)) / r;
    return { psi: psiT(th), u: ur * Math.cos(th), v: ur * Math.sin(th), p: 2 * mu * A * Math.cos(2 * th - beta) / (r * r) };
  };
  const profile = { profile: (xs, eta) => psiT(Math.atan(eta * tb)) / Qex };
  const errOf = (nx, ny, mode) => {
    const o = { nx, ny, Lx: x2 - x1, h: x => (x1 + x) * tb, hx: () => tb, hxx: () => 0, U: 0, rho: 1e-9, mu: () => mu, inlet: profile, outlet: profile, Hr: x2 * tb, Ur: Math.abs(Qex) / (x2 * tb) };
    if (mode === 'Q') o.Q = Qex; else o.Pup = exact(0, 0).p - exact(x2 - x1, 0).p;
    const r = solveGapFlow(o);
    const pRef = exact(x2 - x1, 0).p;
    let eU = 0, eP = 0, eV = 0, uMax = 0, pRange = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const e = exact(i * (x2 - x1) / (nx - 1), j / (ny - 1)), k = j * nx + i;
      uMax = Math.max(uMax, Math.hypot(e.u, e.v)); pRange = Math.max(pRange, Math.abs(e.p - pRef));
      eU = Math.max(eU, Math.abs(r.u[k] - e.u)); eV = Math.max(eV, Math.abs(r.v[k] - e.v)); eP = Math.max(eP, Math.abs(r.p[k] - (e.p - pRef)));
    }
    return { r, eU: eU / uMax, eV: eV / uMax, eP: eP / pRange };
  };
  const a = errOf(41, 21, 'Q'), b = errOf(81, 41, 'Q');
  const ou = Math.log(a.eU / b.eU) / Math.log(2), op = Math.log(a.eP / b.eP) / Math.log(2);
  check(b.r.converged, 'converged');
  check(b.eU < 2e-3 && ou > 1.7, `u error ${pct(a.eU)} -> ${pct(b.eU)} of max speed on halving the grid (order ${ou.toFixed(2)})`);
  check(b.eV < 2e-3, `v (normal to the web) error ${pct(b.eV)} of max speed`);
  // Pressure needs third derivatives of psi. Its error sits at the web (the
  // wall-gradient estimate), ~0.1% of the pressure range, and does not fall
  // at second order with grid refinement (0.14% -> 0.12% -> 0.08% on
  // 41x21 -> 81x41 -> 161x81): stated as measured, with a bar on its size.
  check(a.eP < 2e-3 && b.eP < 2e-3, `pressure field error ${pct(a.eP)} (41x21), ${pct(b.eP)} (81x41) of the pressure range -- accurate to ~0.1%, but converging slower than velocity (order ${op.toFixed(2)})`);
  check(b.r.pathError < 5e-3, `pressure routes agree to ${pct(b.r.pathError)} of range`);
  const c = errOf(81, 41, 'Pup');
  check(Math.abs(c.r.Q / Qex - 1) < 2e-3, `flow rate found from the exact pressure drop alone: ${pct(c.r.Q / Qex - 1)} off the exact Q`);
}

// ---------------------------------------------------------------- 4
{
  console.log('\n-- 4. lid-driven cavity, Re = 100, vs Ghia, Ghia & Shin (1982) --');
  const ghia_y = [0.9766, 0.9688, 0.9609, 0.9531, 0.8516, 0.7344, 0.6172, 0.5000, 0.4531, 0.2813, 0.1719, 0.1016, 0.0703, 0.0625, 0.0547];
  const ghia_u = [0.84123, 0.78871, 0.73722, 0.68717, 0.23151, 0.00332, -0.13641, -0.20581, -0.21090, -0.15662, -0.10150, -0.06434, -0.04775, -0.04192, -0.03717];
  const ghia_x = [0.9688, 0.9609, 0.9531, 0.9453, 0.9063, 0.8594, 0.8047, 0.5000, 0.2344, 0.2266, 0.1563, 0.0938, 0.0781, 0.0703, 0.0625];
  const ghia_v = [-0.05906, -0.07391, -0.08864, -0.10313, -0.16914, -0.22445, -0.24533, 0.05454, 0.17527, 0.17507, 0.16077, 0.12317, 0.10890, 0.10091, 0.09233];
  const N = 65;
  const t0 = Date.now();
  const r = solveGapFlow({ nx: N, ny: N, Lx: 1, h: () => 1, U: 0, Ublade: 1, rho: 100, mu: () => 1, Q: 0, inlet: 'wall', outlet: 'wall', Ur: 1, Hr: 1, maxIter: 100 });
  const s = (arr, x, y) => {
    const fi = x * (N - 1), fj = y * (N - 1), i0 = Math.min(N - 2, Math.floor(fi)), j0 = Math.min(N - 2, Math.floor(fj)), a = fi - i0, b = fj - j0;
    return (1 - a) * (1 - b) * arr[j0 * N + i0] + a * (1 - b) * arr[j0 * N + i0 + 1] + (1 - a) * b * arr[(j0 + 1) * N + i0] + a * b * arr[(j0 + 1) * N + i0 + 1];
  };
  let eu = 0, ev = 0;
  ghia_y.forEach((y, k) => { eu = Math.max(eu, Math.abs(s(r.u, 0.5, y) - ghia_u[k])); });
  ghia_x.forEach((x, k) => { ev = Math.max(ev, Math.abs(s(r.v, x, 0.5) - ghia_v[k])); });
  let psiMin = 0; for (const p of r.psi) psiMin = Math.min(psiMin, p);
  check(r.converged, `converged (${r.iterations} steps, ${Date.now() - t0} ms)`);
  check(eu < 0.02 && ev < 0.02, `centreline velocities vs Ghia: max error u ${eu.toFixed(4)}, v ${ev.toFixed(4)} (of lid speed)`);
  check(Math.abs(psiMin + 0.103423) / 0.103423 < 0.02, `primary vortex strength psi_min ${psiMin.toFixed(5)} vs Ghia -0.10342`);
}

// ---------------------------------------------------------------- 5
{
  console.log('\n-- 5. round entry (R = 100 mm) onto the metering edge --');
  const R = 0.1;
  const geo = Xup => ({
    Lx: Xup,
    h: x => H + R - Math.sqrt(R * R - (Xup - x) ** 2),
    hx: x => -(Xup - x) / Math.sqrt(R * R - (Xup - x) ** 2),
    hxx: x => R * R / Math.pow(R * R - (Xup - x) ** 2, 1.5),
  });
  const lub = Xup => {                                  // Reynolds equation, same domain and pressure drop
    const g = geo(Xup), M = 200000; let I2 = 0, I3 = 0;
    for (let k = 0; k < M; k++) { const h = g.h((k + 0.5) * Xup / M); I2 += Xup / M / (h * h); I3 += Xup / M / (h * h * h); }
    return (PUP + 6 * MU * U * I2) / (12 * MU * I3);
  };
  const run = (Xup, nx, ny) => solveGapFlow({ nx, ny, ...geo(Xup), U, rho: RHO, mu: () => MU, Pup: PUP });
  const r = run(0.04, 121, 41);
  const ql = lub(0.04);
  check(r.converged, `converged (residual ${r.residual.toExponential(1)})`);
  check(Math.abs(r.Q / ql - 1) < 3 * H / (2 * R), `flow rate vs Reynolds lubrication: ${pct(r.Q / ql - 1)} (expected O(H/2R) = ${pct(H / (2 * R))})`);
  check(r.pathError < 1e-2, `pressure routes agree to ${pct(r.pathError)} of range`);
  let rev = 0; for (let k = 0; k < r.u.length; k++) if (r.u[k] < 0) rev++;
  console.log(`   film ${(r.Q / U * 1000).toFixed(3)} mm (lubrication ${(ql / U * 1000).toFixed(3)} mm), max pressure ${r.pMax.toFixed(0)} Pa at x = ${(r.pMaxLoc[0] * 1000).toFixed(1)} mm, reverse flow at ${rev} nodes`);
  // grid convergence of the interior discretization, isolated from the
  // inlet condition: inlet profile = the local lubrication profile
  const lubIn = { profile: (x, e) => 3 * e * e - 2 * e ** 3, base: (x, e) => U * geo(0.04).h(x) * (e - 2 * e * e + e ** 3) };
  const qs = [[61, 21], [121, 41], [241, 81]].map(([nx, ny]) => solveGapFlow({ nx, ny, ...geo(0.04), U, rho: RHO, mu: () => MU, Pup: PUP, inlet: lubIn }).Q);
  const ord = Math.log(Math.abs(qs[0] - qs[1]) / Math.abs(qs[1] - qs[2])) / Math.log(2);
  check(Math.abs(qs[1] - qs[2]) / qs[2] < 1e-3 && ord > 1.7, `grid convergence: Q changes ${pct(qs[1] / qs[0] - 1)} then ${pct(qs[2] / qs[1] - 1)} (order ${ord.toFixed(2)})`);
  console.log(`   inlet condition: zero streamwise gradient vs the local lubrication profile differ by ${pct(r.Q / qs[1] - 1)} in Q`);
  // Where the bead pressure acts (the inlet) is physics, not numerics: the
  // web drags fluid into the converging entry and builds pressure all the
  // way from the pool. The 2D result must follow lubrication theory's own
  // dependence on it at every inlet position.
  console.log('   inlet (pool edge) upstream of the edge:   20 mm    30 mm    40 mm    60 mm    80 mm');
  const tr = [0.02, 0.03, 0.04, 0.06, 0.08].map(X => ({ q: run(X, Math.round(X / 0.04 * 120) + 1, 41).Q, ql: lub(X) }));
  console.log(`   film thickness Q/U, 2D (mm):              ${tr.map(t => (t.q / U * 1000).toFixed(4)).join('   ')}`);
  console.log(`   film thickness Q/U, lubrication (mm):     ${tr.map(t => (t.ql / U * 1000).toFixed(4)).join('   ')}`);
  const worst = Math.max(...tr.map(t => Math.abs(t.q / t.ql - 1)));
  check(worst < H / (2 * R), `2D follows lubrication theory at every inlet position (worst ${pct(worst)}); the inlet position itself moves the film by ${pct(tr[4].q / tr[0].q - 1)} over 20-80 mm`);
}

console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASS');
if (fails) process.exit(1);
