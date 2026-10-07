/*
 * rebuild.validate.js — checks of the structure after the blade (GO-1d). Run: node rebuild.validate.js
 *  1. rheo.js: the integral over a rest of 1 / mu(lambda) against quadrature; the levelling as the slurry rebuilds
 *     (rheoLevel) against a fine Runge–Kutta solution with the same freezing rule, and its limits: the structure never
 *     rebuilding (the closed form at lam0), rebuilding at once (the closed form rested), no contrast (the steady closed
 *     form), a ripple the yield stress holds from the start (unchanged), no yield stress (levels to nothing).
 *  2. The structure along the 1D blade (struct1D): uniform shear with steady inflow stays steady exactly; a structure
 *     that never changes keeps the inlet's; fast kinetics steady at the edge's shear rates; the lines and stations
 *     converged; against the 2D's structure carried along its flow: along the flat land, and at the metering edge (flat
 *     land, round entry; there the 2D's corner and the round entry's recirculation, which the 1D leaves out).
 *  3. ripple1D: without the structure as before (the closed form); with it, the rebuild's levelling from the 1D's lam0.
 */
const R = require('../engine/rheo.js');
const S0 = require('../engine/cfd-solver.js');
Object.assign(globalThis, { muEffLocal: S0.muEffLocal, shearRateFromStress: S0.shearRateFromStress, solveDownstreamFilm: S0.solveDownstreamFilm });
const { gapFlow1D, struct1D, ripple1D } = require('../engine/cfd-1d.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const S = { tb: 30, gdc: 1, cy: 2, ce: 2 };

// ---- 1. rheo.js ----
{
  const law = R.rheoCompile(10.5, 5, 1), muOf = l => R.rheoMuStruct(0.1, l, law, S);
  let worst = 0;
  for (const [lam0, t] of [[0.27, 5], [0.27, 60], [0.9, 200], [0, 1e-3], [0.5, 0]]) {
    const M = 200000, h = t / M;
    let q = 0;
    for (let i = 0; i <= M; i++) q += (i === 0 || i === M ? 1 : i % 2 ? 4 : 2) / muOf(R.rheoRest(lam0, i * h, S));
    q *= h / 3;
    worst = Math.max(worst, t ? Math.abs(R.rheoRestInv(muOf, lam0, S, t) / q - 1) : Math.abs(R.rheoRestInv(muOf, lam0, S, t)));
  }
  check('the integral of 1 / mu over a rest (the edge bead\'s growth): exact against quadrature', worst < 1e-10, `worst ${worst.toExponential(1)}`);
}
// the levelling: film 1.45 mm, wavelength 8 mm (the app's), the ripple's geometry as ripple1D's
const h = 1.4533e-3, k = 2 * Math.PI / 8e-3, gam = 0.07, rho = 1360, g = 9.81;
const lev = (law, S, lam0, a0, kk = k) => {
  const tauOf = l => 3 * R.rheoMuStruct(0.5, l, law, S) / (h ** 3 * (gam * kk ** 4 + rho * g * kk * kk));
  const resOf = l => R.rheoYieldStruct(l, law, S) / (h * (gam * kk ** 3 + rho * g * kk));
  return { lv: R.rheoLevel(a0, lam0, S, tauOf, resOf), tauOf, resOf };
};
/** The reference: Runge–Kutta (4th order) on dA/dt = -(A - R(t)) / tau(t), stopping for good once A <= R(t). */
function refLevel(a0, lam0, S, tauOf, resOf, tEnd, dt) {
  const f = (t, A) => -(A - resOf(R.rheoRest(lam0, t, S))) / tauOf(R.rheoRest(lam0, t, S));
  const out = [[0, a0]];
  let A = a0, t = 0, frozen = !(a0 > resOf(lam0));
  while (t < tEnd - 1e-12) {
    if (!frozen) {
      const k1 = f(t, A), k2 = f(t + dt / 2, A + dt / 2 * k1), k3 = f(t + dt / 2, A + dt / 2 * k2), k4 = f(t + dt, A + dt * k3);
      const An = A + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
      const Rn = resOf(R.rheoRest(lam0, t + dt, S));
      if (An <= Rn) { A = Math.min(A, Rn); frozen = true; } else A = An;   // (met the residual within the step: held there)
    }
    t += dt; out.push([t, A]);
  }
  return out;
}
{
  const lam0 = R.rheoLamEq((0.28 / 60) / 1.7e-3, S), a0 = 40.06e-6;
  for (const [ty, name] of [[5, 'the app\'s yield stress 5 Pa: held just after the blade'], [2, 'yield stress 2 Pa: levels, then held'], [0, 'no yield stress: levels to nothing']]) {
    const law = R.rheoCompile(10.5, ty, 1), { lv, tauOf, resOf } = lev(law, S, lam0, a0);
    const ref = refLevel(a0, lam0, S, tauOf, resOf, 20, 2e-4);
    let worst = 0;
    for (const [t, A] of ref.filter((_, i) => i % 250 === 0)) worst = Math.max(worst, Math.abs(lv.at(t) - A) / a0);
    let mono = true, prev = Infinity;
    for (let i = 0; i <= 2000; i++) { const a = lv.at(i * 0.06); if (a > prev + 1e-18) mono = false; prev = a; }
    check(`rebuilding levelling, ${name}: the fine Runge–Kutta solution within 0.2 % of the start, never rising`, worst < 2e-3 && mono,
      `worst ${(worst * 100).toFixed(3)} %; at 20 s ${(lv.at(20) * 1e6).toFixed(2)} um (reference ${(ref[ref.length - 1][1] * 1e6).toFixed(2)}), held from ${lv.frozen() == null ? 'never' : lv.frozen().toFixed(2) + ' s'}`);
  }
  // a long wavelength (30 mm): the levelling as slow as the rebuild
  const law = R.rheoCompile(10.5, 2, 1), kk = 2 * Math.PI / 30e-3, { lv, tauOf, resOf } = lev(law, S, lam0, 200e-6, kk);
  const ref = refLevel(200e-6, lam0, S, tauOf, resOf, 150, 5e-3);
  let worst = 0;
  for (const [t, A] of ref.filter((_, i) => i % 100 === 0)) worst = Math.max(worst, Math.abs(lv.at(t) - A) / 200e-6);
  check('  wavelength 30 mm, levelling as slow as the rebuild (tau from ' + tauOf(lam0).toFixed(0) + ' to ' + tauOf(1).toFixed(0) + ' s): within 0.2 %', worst < 2e-3,
    `worst ${(worst * 100).toFixed(3)} %, at 150 s ${(lv.at(150) * 1e6).toFixed(2)} um (reference ${(ref[ref.length - 1][1] * 1e6).toFixed(2)})`);
  // limits
  const law2 = R.rheoCompile(10.5, 2, 1), closed = (a0, tau, res) => t => { const as = Math.min(a0, res); return as + (a0 - as) * Math.exp(-t / tau); };
  const lim = (Sx, lamT, name, tol) => {
    const { lv, tauOf, resOf } = lev(law2, Sx, lam0, a0), c = closed(a0, tauOf(lamT), resOf(lamT));
    let w = 0;
    for (let i = 1; i <= 400; i++) { const t = i * 0.05; w = Math.max(w, Math.abs(lv.at(t) - c(t)) / a0); }
    check(`  ${name}`, w < tol, `worst ${w.toExponential(1)}`);
  };
  lim({ ...S, tb: 1e12 }, lam0, 'never rebuilding (tb huge): the closed form at lambda just after the blade', 1e-9);
  lim({ ...S, tb: 1e-9 }, 1, 'rebuilding at once (tb tiny): the closed form rested (within tb / tau: its first 40 tb just sheared)', 1e-7);
  lim({ ...S, cy: 0, ce: 0 }, 0.5, 'no contrast: the steady closed form', 1e-12);
  // the steps it takes: bounded however short or long the levelling is against the rebuild
  let most = 0;
  for (const [tau0, res] of [[1e-6, 0], [1e-6, 1e-6], [0.4, 0], [100, 0], [1e4, 1e-6], [0, 0]]) {
    let n = 0;
    const lv = R.rheoLevel(a0, lam0, S, l => { n++; return tau0 * (1 + l); }, l => res * (1 + 2 * l) / 3);
    lv.at(150); lv.final(); most = Math.max(most, n);
  }
  check('  its steps bounded (levelling from 1 us to 3 h, with and without a yield stress: under 9000)', most < 18000, `at most ${most / 2} steps`);
  const law5 = R.rheoCompile(10.5, 5, 1), held = lev(law5, S, 0.9, a0).lv;
  check('  held from the start (the residual above the ripple just after the blade): unchanged all the way', held.frozen() === 0 && [0, 1, 50, 500].every(t => held.at(t) === a0));
}

// ---- 2. struct1D ----
const base = { shape: 'flat', U: 0.28 / 60, H: 1.7e-3, L: 10e-3, R: 0.1, Xup: 0.04, Pup: 720, muRef: 10.5, ty: 5, n: 1, webSlip: 0, gamma: 0.07, rho: 1360, g: 9.81, ovenDistance: 0.5 };
{
  // uniform shear: Newtonian, flat land, no bead pressure -> q = U H / 2, simple shear U / H everywhere
  const r = gapFlow1D({ ...base, ty: 0, Pup: 0 }), s = struct1D(r, S), le = R.rheoLamEq(base.U / base.H, S);
  check('uniform shear (flat land, no bead pressure), steady inflow: steady at U / H on every line, all the way', s.lines.every(l => Math.abs(l - le) < 1e-9) && s.along.every(l => Math.abs(l - le) < 1e-9),
    `lambda ${s.exit.toFixed(6)} (steady ${le.toFixed(6)})`);
  const rr = gapFlow1D({ ...base, shape: 'round' });
  const s0 = struct1D(rr, { ...S, tb: 1e15 });
  check('  a structure that never changes (tb huge): the inlet\'s all the way', Math.abs(s0.exit - s0.along[0]) < 1e-9, `${s0.exit.toFixed(6)} vs ${s0.along[0].toFixed(6)}`);
  // fast kinetics: steady at the shear rates by the edge, flux weighted (a fine quadrature across the edge's gap)
  const sf = struct1D(rr, { ...S, tb: 1e-9 }), N = rr.x.length - 1, hE = rr.h[N], M = 4000;
  const law = rr.law, dudy = y => { const t = rr.tauWeb[N] - rr.G[N] * y; return Math.sign(t) * S0.shearRateFromStress(Math.abs(t), law.muRef, law.ty, law.n, law.x); };
  let u = rr.U, qn = 0, qd = 0;
  for (let j = 0; j < M; j++) {
    const y0 = j * hE / M, y1 = (j + 1) * hE / M, ym = (y0 + y1) / 2, u1 = u + (hE / M) * (dudy(y0) + 4 * dudy(ym) + dudy(y1)) / 6;
    const um = (u + u1) / 2; qn += um * R.rheoLamEq(Math.abs(dudy(ym)), S) * hE / M; qd += um * hE / M; u = u1;
  }
  check('  fast kinetics (tb tiny): steady at the edge\'s shear rates, flux weighted, within 0.2 %', Math.abs(sf.exit / (qn / qd) - 1) < 2e-3, `${sf.exit.toFixed(5)} vs ${(qn / qd).toFixed(5)}`);
  const sa = struct1D(rr, S), sb = struct1D(rr, S, { nLines: 256 }), sc = struct1D(gapFlow1D({ ...base, shape: 'round' }, { nx: 480 }), S, { nLines: 256 });
  check('  the round entry (the app\'s default): 64 lines within 0.1 % of 256, 120 stations of 480', Math.abs(sa.exit / sb.exit - 1) < 1e-3 && Math.abs(sb.exit / sc.exit - 1) < 1e-3,
    `lambda leaving the edge ${sa.exit.toFixed(4)} (256 lines ${sb.exit.toFixed(4)}, and 480 stations ${sc.exit.toFixed(4)}); entering ${sa.along[0].toFixed(4)}; ${sa.tMean.toFixed(1)} s under the blade`);
}
// against the 2D's structure carried along its own flow (steady law, not fed back) at the metering edge
{
  const gap = require('../engine/cfd-gap-solver.js');
  Object.assign(globalThis, { bandFactor: gap.bandFactor, bandSolve: gap.bandSolve });
  const FEM = require('../engine/cfd-fem.js');
  Object.assign(globalThis, { femInterpolate: FEM.femInterpolate });
  const { structField, structColumn } = require('../engine/cfd-struct.js');
  const { bladeShape } = require('../engine/cfd-1d.js');
  const mu = gd => S0.muEffLocal(gd, 10.5, 5, 1), U = base.U;
  const cases = [
    ['flat land', { ...base }, { hFn: () => 1.7e-3, xe: 10e-3, nEb: 12, fInfGuess: 1.45e-3 }],
    ['round entry', { ...base, shape: 'round', H: 1.7149e-3 }, (() => { const sh = bladeShape({ geometry: 'round', H: 1.7149e-3, R: 0.1, Xup: 0.04 }); return { hFn: sh.h, xe: sh.Lx, nEb: 39, gradeB: 1.6, gradeS: 1.4, gradeY: 1.5, fInfGuess: 1.6e-3 }; })()],
  ];
  for (const [name, g1, f2] of cases) {
    const r1 = gapFlow1D(g1), s1 = struct1D(r1, S);
    const H = g1.H, fo = { ...f2, faceDeg: 90, contactDeg: 35, U, Pup: 720, rho: 1360, g: 9.81, gamma: 0.07, mu, gdMin: 1e-3 * U / H, Ld: Math.max(12e-3, 8 * H), nEf: 6, nEs: 24, nEy: 6 };
    const r2 = FEM.solveCoaterFEM(fo), l2 = structField(r2, S).lam, cc = r2.meshInfo.cCorner, e2 = structColumn(r2, l2, cc);
    // (the 1D's lambda at x, between its stations)
    const at1 = x => { let i = 1; while (i < r1.x.length - 1 && r1.x[i] < x) i++; const s = (x - r1.x[i - 1]) / (r1.x[i] - r1.x[i - 1]); return s1.along[i - 1] + s * (s1.along[i] - s1.along[i - 1]); };
    if (name === 'flat land') {
      let worst = 0;
      for (let c = 0; c < cc; c++) { const x = r2.x[c * r2.NR]; if (x <= 0.8 * f2.xe) worst = Math.max(worst, Math.abs(at1(x) / structColumn(r2, l2, c) - 1)); }
      check('the 1D\'s lambda along the flat land = the 2D\'s carried along its flow (steady inflow, fully developed), within 0.5 %', r2.converged && worst < 5e-3, `worst ${(worst * 100).toFixed(2)} % (to 0.8 of the land)`);
    }
    check(`  at the metering edge (${name}, the steady flow): within 5 % (the 2D's ${name === 'flat land' ? 'corner, the flow turning into the film' : 'wide entry, its recirculation, and the corner'}: not in the 1D)`, r2.converged && Math.abs(s1.exit / e2 - 1) < 0.05,
      `1D ${s1.exit.toFixed(4)}, 2D ${e2.toFixed(4)} (${((s1.exit / e2 - 1) * 100).toFixed(2)} %); the 2D's at its film's end ${structColumn(r2, l2, r2.NC - 1).toFixed(4)}`);
  }
}

// ---- 3. ripple1D ----
{
  const r = gapFlow1D({ ...base, shape: 'round' }), rip = { dHum: 20, vibUm: 10, lamMm: 8 };
  const geo = { ...base, shape: 'round' }, off = ripple1D(geo, r.film, 0.5, rip), off2 = ripple1D({ ...geo, struct: S }, r.film, 0.5, rip);
  const mu = S0.muEffLocal(0.5, 10.5, 5, 1), kk = 2 * Math.PI / 8e-3, tau = 3 * mu / (r.film ** 3 * (0.07 * kk ** 4 + 1360 * 9.81 * kk * kk)), res = 5 / (r.film * (0.07 * kk ** 3 + 1360 * 9.81 * kk));
  check('ripple1D without the structure (or without lambda from the blade): the closed form, as before', off.tau === tau && off.residual === res && [0, 1, 10, 100].every(t => off.at(t) === off2.at(t) && off.at(t) === Math.min(off.a0, res) + (off.a0 - Math.min(off.a0, res)) * Math.exp(-t / tau)));
  for (const ty of [5, 2]) {
    const g2 = { ...geo, ty }, r2 = gapFlow1D(g2), sb = struct1D(r2, S), on = ripple1D({ ...g2, struct: S }, r2.film, 0.5, rip, sb.exit), st = ripple1D(g2, r2.film, 0.5, rip);
    const lw = R.rheoCompile(10.5, ty, 1), tauOf = l => 3 * R.rheoMuStruct(0.5, l, lw, S) / (r2.film ** 3 * (0.07 * kk ** 4 + 1360 * 9.81 * kk * kk)), resOf = l => R.rheoYieldStruct(l, lw, S) / (r2.film * (0.07 * kk ** 3 + 1360 * 9.81 * kk));
    const ref = refLevel(on.a0, sb.exit, S, tauOf, resOf, on.tRes, 2e-3), end = ref[ref.length - 1][1];
    check(`  with the structure (yield stress ${ty} Pa): lambda from the blade ${sb.exit.toFixed(3)}, the rebuild's levelling (the reference at the oven within 0.2 %)`, Math.abs(on.at(on.tRes) - end) / on.a0 < 2e-3 && on.lam0 === sb.exit,
      `at the oven ${(on.at(on.tRes) * 1e6).toFixed(2)} um (reference ${(end * 1e6).toFixed(2)}; steady ${(st.at(st.tRes) * 1e6).toFixed(2)}); held from ${on.tFrozen == null ? 'never' : on.tFrozen.toFixed(2) + ' s'}`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
