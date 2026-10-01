/*
 * rheo.validate.js — checks of the rheology beyond Herschel–Bulkley (rheo.js). Run: node rheo.validate.js
 *  1. The laws: the anchor (the viscosity at 2.7 1/s is muRef) for Carreau–Yasuda and Cross over n, L, a,
 *     eta_inf; their limits (eta0 at rest, the power-law slope n - 1 at high shear, Newtonian at n = 1,
 *     Carreau at a = 2); the inverse stress -> shear rate; Herschel–Bulkley unchanged (bit for bit).
 *  2. The structure: steady shear returns the law's steady curve exactly (with a yield stress too); the exact
 *     update at a constant shear rate against a fine Runge–Kutta integration; rest rebuild; rested stronger
 *     and thicker, just sheared weaker and thinner; no contrast, no effect; the yield stress with structure.
 *  3. A thixotropy test (slow, fast, slow): the first interval steady; the third recovers toward the steady
 *     viscosity with the time constant tb / (1 + gd / gdc).
 */
const R = require('./rheo.js'), S0 = require('./cfd-solver.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

// 1. the laws
{
  let worst = 0;
  for (const model of ['carreau', 'cross']) for (const n of [0.3, 0.6, 0.9, 1]) for (const L of [0.01, 1, 50]) for (const a of [0.5, 2, 4]) for (const ei of [0, 0.01, 1]) {
    const c = R.rheoCompile(10.5, 0, n, { model, etaInf: ei, L, a });
    worst = Math.max(worst, rel(c.mu(2.7), 10.5));
  }
  check('anchor: the viscosity at 2.7 1/s is muRef (Carreau–Yasuda and Cross, 216 cases)', worst < 1e-13, worst.toExponential(1));
  const cy = R.rheoCompile(10.5, 0, 0.5, { model: 'carreau', etaInf: 0.01, L: 2, a: 2 });
  check('Carreau–Yasuda: eta0 at rest', rel(cy.mu(1e-8), cy.eta0) < 1e-10, `${cy.eta0.toFixed(4)} Pa·s`);
  const sl = (c, g) => Math.log(c.mu(g * 1.01) / c.mu(g)) / Math.log(1.01);
  const cy0 = R.rheoCompile(10.5, 0, 0.5, { model: 'carreau', etaInf: 0, L: 2, a: 2 }), cr0 = R.rheoCompile(10.5, 0, 0.5, { model: 'cross', etaInf: 0, L: 2 });
  check('  and Cross: the power-law slope n - 1 at high shear (eta_inf 0)', Math.abs(sl(cy0, 1e12) - (-0.5)) < 1e-5 && Math.abs(sl(cr0, 1e12) - (-0.5)) < 1e-5, `${sl(cy0, 1e12).toFixed(6)}, ${sl(cr0, 1e12).toFixed(6)}`);
  check('  eta_inf at very high shear', rel(R.rheoCompile(10.5, 0, 0.5, { model: 'carreau', etaInf: 0.2, L: 2, a: 2 }).mu(1e12), 0.2) < 1e-4);
  const nw = [R.rheoCompile(10.5, 0, 1, { model: 'carreau', etaInf: 0.01, L: 3, a: 1.5 }), R.rheoCompile(10.5, 0, 1, { model: 'cross', etaInf: 0.01, L: 3 })];
  check('  n = 1: Newtonian at muRef', nw.every(c => [1e-4, 1, 1e4].every(g => rel(c.mu(g), 10.5) < 1e-13)));
  const e0 = 20, Lc = 0.7, n = 0.4, carr = g => e0 * Math.pow(1 + (Lc * g) ** 2, (n - 1) / 2);
  const c2 = R.rheoCompile(carr(2.7), 0, n, { model: 'carreau', etaInf: 0, L: Lc, a: 2 });
  check('  a = 2 is the Carreau law', [0.01, 1, 100].every(g => rel(c2.mu(g), carr(g)) < 1e-12));
  let inv = 0;
  for (const c of [cy, cr0, R.rheoCompile(10.5, 0, 0.25, { model: 'carreau', etaInf: 1e-3, L: 100, a: 0.6 })]) for (let e = -6; e <= 6; e += 0.5) { const g = 10 ** e; inv = Math.max(inv, rel(c.gdOf(c.tau(g)), g)); }
  check('the inverse: shear rate from stress, 1e-6 to 1e6 1/s', inv < 1e-10, inv.toExponential(1));
  const x = { model: 'cross', etaInf: 0.01, L: 1 };
  check('  cfd-solver.js hands them over: muEffLocal and shearRateFromStress with the extras', rel(S0.muEffLocal(5, 10.5, 0, 0.6, x), R.rheoCompile(10.5, 0, 0.6, x).mu(5)) < 1e-15 && rel(S0.shearRateFromStress(30, 10.5, 0, 0.6, x), R.rheoCompile(10.5, 0, 0.6, x).gdOf(30)) < 1e-15);
  let same = true;
  for (const [muRef, ty, n] of [[10.5, 5, 1], [10.5, 5, 0.6], [3, 0, 0.8], [10.5, 25, 0.5]]) for (const g of [1e-3, 0.5, 2.7, 80, 1e4]) {
    const hb = R.rheoCompile(muRef, ty, n);
    same = same && hb.mu(g) === S0.muEffLocal(g, muRef, ty, n) && S0.muEffLocal(g, muRef, ty, n, { model: 'hb' }) === S0.muEffLocal(g, muRef, ty, n);
    const t = hb.tau(g); same = same && hb.gdOf(t) === S0.shearRateFromStress(t, muRef, ty, n);
  }
  check('Herschel–Bulkley (and power law, Newtonian) unchanged, bit for bit', same);
  // (MH-3: a yield stress the viscosity at 2.7 1/s cannot carry -- 40 Pa with 10.5 Pa·s: K would be ≤ 0 -- is refused, named,
  //  in both; it was quietly held at a floor of 5 % of μref before. η∞ at or above μref likewise)
  const refused = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };
  check('  a law that cannot hold is refused with its reason (τy 40 Pa at 10.5 Pa·s; η∞ ≥ μref), not quietly changed',
    refused(() => R.rheoCompile(10.5, 40, 0.5), /contradict/) && refused(() => S0.muEffLocal(1, 10.5, 40, 0.5), /contradict/) && refused(() => S0.shearRateFromStress(60, 10.5, 40, 0.5), /contradict/)
    && refused(() => R.rheoCompile(10.5, 0, 0.5, { model: 'carreau', etaInf: 11, L: 1, a: 2 }), /η∞/));
}

// 2. the structure
{
  const S = { tb: 30, gdc: 1, cy: 2, ce: 2 };
  const laws = [R.rheoCompile(10.5, 5, 1), R.rheoCompile(10.5, 5, 0.6), R.rheoCompile(10.5, 0, 0.5, { model: 'carreau', etaInf: 0.01, L: 1, a: 2 })];
  let w = 0;
  for (const law of laws) for (let e = -4; e <= 4; e += 0.25) { const g = 10 ** e; w = Math.max(w, rel(R.rheoTauStruct(g, R.rheoLamEq(g, S), law, S), law.tau(g))); }
  check('steady shear: the stress is the law\'s steady curve (HB n = 1 and 0.6, Carreau–Yasuda)', w < 1e-14, w.toExponential(1));
  // the exact update against RK4
  const rk = (lam, g, T, N) => { const h = T / N, f = l => R.rheoLamRate(l, g, S); for (let k = 0; k < N; k++) { const k1 = f(lam), k2 = f(lam + h * k1 / 2), k3 = f(lam + h * k2 / 2), k4 = f(lam + h * k3); lam += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6; } return lam; };
  let e2 = 0;
  for (const [l0, g, T] of [[1, 100, 2], [0.02, 0.5, 60], [0.5, 3, 10], [0, 0, 100]]) e2 = Math.max(e2, Math.abs(R.rheoLamStep(l0, g, T, S) - rk(l0, g, T, 20000)));
  check('the exact update at a constant shear rate = Runge–Kutta, fine steps', e2 < 1e-12, e2.toExponential(1));
  check('rest: rebuilds as 1 - (1 - lambda0) exp(-t / tb); lambda_e = 1 at rest', Math.abs(R.rheoRest(0.2, 30, S) - (1 - 0.8 * Math.exp(-1))) < 1e-15 && R.rheoRest(0.2, 30, S) === R.rheoLamStep(0.2, 0, 30, S) && R.rheoLamEq(0, S) === 1);
  check('  half broken at gdc; lambda_e 1 / (1 + gd / gdc)', R.rheoLamEq(1, S) === 0.5 && Math.abs(R.rheoLamEq(99, S) - 0.01) < 1e-15);
  const hb = laws[0], g = 50;
  const rested = R.rheoTauStruct(g, 1, hb, S) / hb.tau(g), sheared = R.rheoTauStruct(0.5, 0, hb, S) / hb.tau(0.5);
  check('rested at a high rate: stronger and thicker than steady (1 + c)/(1 + c lambda_e)', rested > 1 && Math.abs(rested - 3 / (1 + 2 / 51)) < 1e-12, rested.toFixed(4));
  check('just sheared at a low rate: weaker and thinner than steady, 1 / (1 + c lambda_e)', sheared < 1 && Math.abs(sheared - 1 / (1 + 2 / 1.5)) < 1e-12, sheared.toFixed(4));
  const S00 = { tb: 30, gdc: 1, cy: 0, ce: 0 };
  check('no contrast (cy = ce = 0): the structure changes nothing', [0, 0.3, 1].every(l => rel(R.rheoTauStruct(7, l, hb, S00), hb.tau(7)) < 1e-15));
  const Sy = { tb: 30, gdc: 1, cy: 2, ce: 0 };
  check('  only cy: the yield part moves, the viscous part not', Math.abs(R.rheoTauStruct(7, 1, hb, Sy) - (5 * 3 / (1 + 2 / 8) + (hb.tau(7) - 5))) < 1e-12);
  check('the yield stress with structure: ty rested, ty / (1 + cy) fully broken', R.rheoYieldStruct(1, hb, S) === 5 && Math.abs(R.rheoYieldStruct(0, hb, S) - 5 / 3) < 1e-15);
}

// 3. a thixotropy test
{
  const S = { tb: 30, gdc: 1, cy: 2, ce: 2 }, law = R.rheoCompile(10.5, 5, 0.6);
  const run = R.rheo3ITT([{ gd: 0.1, dur: 60, n: 60 }, { gd: 100, dur: 30, n: 30 }, { gd: 0.1, dur: 200, n: 200 }], law, S);
  check('3ITT: 290 points; the first interval steady at 0.1 1/s', run.length === 290 && rel(run[59].eta, law.mu(0.1)) < 1e-14);
  const le = R.rheoLamEq(0.1, S), k = (1 + 0.1 / S.gdc) / S.tb, p = run.slice(90);
  const slopes = p.slice(1).map((q, i) => Math.log((le - q.lam) / (le - p[i].lam)) / (q.t - p[i].t));
  check('  the third recovers toward steady with rate (1 + gd / gdc) / tb', slopes.every(s => Math.abs(-s - k) < 1e-9 * k) && run[289].eta < law.mu(0.1) && run[289].eta > run[90].eta, `${(-slopes[0]).toFixed(6)} vs ${k.toFixed(6)} 1/s`);
  check('  the fast interval thins it: its end below its start', run[89].eta < run[60].eta);
}

// 4. the solvers take the new laws (the 1D gap flow along a flat land, and the fully developed profile)
{
  Object.assign(globalThis, { muEffLocal: S0.muEffLocal, shearRateFromStress: S0.shearRateFromStress, solveDownstreamFilm: S0.solveDownstreamFilm });
  const { gapFlow1D } = require('./cfd-1d.js');
  const base = { shape: 'flat', U: 0.28 / 60, H: 1.7e-3, L: 10e-3, R: 0.1, Xup: 0.04, Pup: 720, muRef: 10.5, ty: 0, n: 1, webSlip: 0, gamma: 0.07, rho: 1360, g: 9.81, ovenDistance: 0.5 };
  const qN = gapFlow1D(base).q, qC = gapFlow1D({ ...base, rheoX: { model: 'carreau', etaInf: 0.01, L: 3, a: 2 } }).q, qX = gapFlow1D({ ...base, rheoX: { model: 'cross', etaInf: 0.01, L: 3 } }).q;
  check('1D gap flow: Carreau–Yasuda and Cross at n = 1 = Newtonian', rel(qC, qN) < 1e-10 && rel(qX, qN) < 1e-10, `${qN.toExponential(6)} m²/s`);
  const pl = gapFlow1D({ ...base, n: 0.5 }), cy = gapFlow1D({ ...base, n: 0.5, rheoX: { model: 'carreau', etaInf: 0, L: 1e5, a: 2 } });
  check('  Carreau–Yasuda with a long time constant = the power law (n 0.5)', pl.converged && cy.converged && rel(cy.q, pl.q) < 1e-5, `${cy.q.toExponential(6)} vs ${pl.q.toExponential(6)}`);
  const cr = gapFlow1D({ ...base, n: 0.5, rheoX: { model: 'cross', etaInf: 0.01, L: 2 } });
  check('  Cross, n 0.5: every station converged; more flow than Newtonian (thinner in the gap)', cr.converged && cr.q > qN);
  const x = { model: 'carreau', etaInf: 0.01, L: 2, a: 1.5 }, fd = S0.solveFullyDeveloped1D({ Ly: 1.7e-3, U: 0.005, G: 720 / 0.01, muRef: 10.5, ty: 0, n: 0.6, x, ny: 801 });
  let worst = 0;
  for (let j = 0; j < fd.ny - 1; j += 40) { const tau = fd.tau0 - 720 / 0.01 * fd.y[j]; worst = Math.max(worst, Math.abs(S0.muEffLocal(fd.gd[j], 10.5, 0, 0.6, x) * fd.gd[j] - Math.abs(tau)) / (Math.abs(tau) + 1e-9)); }
  check('  the fully developed profile: stress = the law at its shear rate across the gap', worst < 1e-10 && Math.abs(fd.u[fd.ny - 1]) < 1e-6, worst.toExponential(1));
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
