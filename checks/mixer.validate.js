/*
 * mixer.validate.js — the double planetary mixer's batch in time (mixer.js, MIX-1) against independent solutions.
 * Run: node mixer.validate.js
 *  1. A bar's drag in its cell: the closed form against the biharmonic stream function solved here (a cylinder moving at
 *     the centre of a fixed cylinder, 2D Stokes).
 *  2. The disc's power at low Reynolds number: the thin disc's exact Stokes torque (32/3) μ Ω R³.
 *  3. Heat: the jacket alone (no power) -- the exact exponential; under vacuum at the boiling point with the jacket off,
 *     every watt evaporates water (P t / L; the viscosity held, the bars' form drag off), and a batch above its boiling
 *     point flashes down to it.
 *  4. pH: a single acid's exact quadratic; the two-step acid's titration curve with ammonia -- the base for each pH in
 *     closed form, the solver's pH from it; dosing to a pH with the ammonia water's own water included.
 *  5. The double layer: the Debye length at 25 °C (0.304/√I nm); Grahame's equation's charge from its potential.
 *  6. Aggregation, a constant kernel: on a linear grid the fixed pivots are Smoluchowski's discrete equations -- his exact
 *     size distribution; on the doubling grid the number N0/(1 + β N0 t/2) and the mass kept.
 *  7. Breakage: into two halves at a constant rate, the exact Poisson generations; into two at a uniform split with the
 *     rate the size (Ziff–McGrady), the number 1 + t exact and the distribution converging to theirs.
 *  8. The batch through the default program: the GO's mass kept, the water's balance, every step's time; its history
 *     through every step and at its end, each record with its own step's speeds, the ammonia's jump in pH and heat at
 *     its step's start; the run's time.
 *  9. The recipe: the batch's totals against the recipe sheet's own (SOP 1.3, 100 L: 3104 g of paste at 45 %, 10 + 70 kg
 *     of water, 242 g of 25 % ammonia water -- 83,346 g in all, 81,949.2 g of liquid, 98.3 % liquid); Materials' default
 *     solids the recipe's.
 * 10. Turbulence: the Kolmogorov length of water at 1 W/kg (31.6 µm, (ν³/ε)^¼); the eddies' stress C ρ (ε a)^⅔ meeting
 *     C μ (ε/ν)^½ at that length; without turbulence the mean shear's stress.
 * 11. The grind gauge: hard pieces alone, nothing turning -- the reading against the size where Ns pieces of their
 *     log-normal touch the sample, its integral computed apart (each piece's GO at the paste's solids, touching when its
 *     centre lies within the sample's radius and its own); the whole paste at the start: off the gauge.
 * 12. The recipe's spread: the paste spec's dry GO and carbon per mix against the recipe sheet's own (41–47 % solids,
 *     48–54 % carbon: 1,272.6–1,458.9 g of dry GO, 610.9–787.8 g of carbon); the GO's share of the batch within the
 *     weighing tolerances against every corner of them tried (16, and 64 with the spec's solids); the solve takes none of
 *     these inputs.
 */
const MX = require('../engine/mixer.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const e1 = v => v.toExponential(1);
const slurry = { phi: 0.4, rhoS: 1900, rhoL: 1000, d50: 5e-6, dMin: 2e-6, dMax: 8e-6, tF: 1e-9, cS: 850, law: gd => 5 / gd + (10.5 - 5 / 2.7) };

// 1. a bar's drag in its cell
{
  // ψ = f(r) sin θ, f = A r³ + B r + C r ln r + D / r; at r = a: f/a = U, f' = U; at r = b: f = f' = 0. The force per
  // length on the inner cylinder is −4π μ C (the Stokeslet's).
  const solve = (a, b) => {
    const M = [[a ** 3, a, a * Math.log(a), 1 / a], [3 * a * a, 1, Math.log(a) + 1, -1 / (a * a)], [b ** 3, b, b * Math.log(b), 1 / b], [3 * b * b, 1, Math.log(b) + 1, -1 / (b * b)]], r = [a, 1, 0, 0];
    for (let i = 0; i < 4; i++) { let p = i; for (let k = i + 1; k < 4; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k; [M[i], M[p]] = [M[p], M[i]]; [r[i], r[p]] = [r[p], r[i]];
      for (let k = i + 1; k < 4; k++) { const f = M[k][i] / M[i][i]; for (let j = i; j < 4; j++) M[k][j] -= f * M[i][j]; r[k] -= f * r[i]; } }
    const x = [0, 0, 0, 0]; for (let i = 3; i >= 0; i--) { let s = r[i]; for (let j = i + 1; j < 4; j++) s -= M[i][j] * x[j]; x[i] = s / M[i][i]; }
    return -4 * Math.PI * x[2];
  };
  let worst = 0; const rows = [];
  for (const k of [1.5, 2, 5.77, 20, 100]) { const F = solve(1, k), G = MX.mixCellDrag(1, k); worst = Math.max(worst, Math.abs(G / F - 1)); rows.push(`k ${k}: ${G.toFixed(3)}`); }
  check('a bar\'s drag in its cell: the closed form, the biharmonic stream function', worst < 1e-10, `${rows.join(', ')} (4π μ V per length); largest difference ${e1(worst)}`);
}

// 2. the disc at low Reynolds number
{
  const o = { ...MX.mixDefaults(), Npt: 0 }, G = MX.mixGeom(o), mu = 50, Nd = 1, P = MX.mixPower(o, G, () => mu, 1000, 0, Nd, o.V);
  const R = o.Dd / 2, W = 2 * Math.PI * Nd, ex = 32 / 3 * mu * W * W * R ** 3;
  check('the disc\'s power at low Reynolds number: the thin disc\'s exact Stokes torque (32/3) μ Ω R³', Math.abs(P.PD / ex - 1) < 1e-3,
    `Re ${P.ReD.toFixed(3)}; ${P.PD.toFixed(4)} W against ${ex.toFixed(4)} W (Kp ${o.Kp} for 16π²/3 = ${(16 * Math.PI ** 2 / 3).toFixed(4)})`);
}

// 3. heat
{
  // (the ammonia at the start brings the paste to pH 7, where its flakes stay apart; added at the batch's temperature
  //  and its ammonium's heat set to none, so only the heat under test is there)
  const base = { ...MX.mixDefaults(), ...slurry, fCake: 0, mphi: 0, dHN: 0 }, dose = { pH: 7 };
  const drying = require('../engine/drying.js'), Ts = drying.drTsat(10e3);
  // the jacket alone: no blades, no disc
  const o1 = { ...base, T0: 60, Tadd: 60, Tj: 20, UA: 15, steps: [{ name: 'rest', min: 60, No: 0, Nd: 0, p: 101.325, dose }] }, r1 = MX.mixRun(o1);
  const mc = r1.end.mGO * o1.cS + r1.end.mW * 4180, ex1 = 20 + 40 * Math.exp(-15 * 3600 / mc), d1 = Math.abs(r1.end.T - ex1);
  // under vacuum at the boiling point, the jacket off: every watt of the blades' evaporates water (the viscosity held: no
  // lumps, mφ 0, at one temperature)
  // (and the bars' form drag off: it follows the density, which rises as the water leaves)
  const o2 = { ...base, T0: Ts, Tadd: Ts, UA: 0, CD: 0, steps: [{ name: 'boil', min: 10, No: 30, Nd: 0, p: 10, dose }] }, r2 = MX.mixRun(o2);
  const Pb = r2.hist.PB[0], ex2 = Pb * 600 / drying.drLatent(Ts);
  // a batch at 60 °C put under 10 kPa: it flashes to the boiling point
  const o3 = { ...base, T0: 60, Tadd: 60, UA: 0, steps: [{ name: 'flash', min: 0.001, No: 0, Nd: 0, p: 10, dose }] }, r3 = MX.mixRun(o3);
  const mc3 = r3.end.mGO * o3.cS + (r3.end.mW + r3.end.evap) * 4180, ex3 = mc3 * (60 - Ts) / drying.drLatent(Ts);
  check('heat: the jacket alone the exact exponential; at the boiling point every watt evaporates water; a hot batch flashes to it',
    d1 < 1e-9 && Math.abs(r2.end.evap / ex2 - 1) < 1e-9 && Math.abs(r2.end.T - Ts) < 1e-12 && Math.abs(r3.end.evap / ex3 - 1) < 1e-9,
    `60 → ${r1.end.T.toFixed(4)} °C in an hour (exact ${ex1.toFixed(4)}); at ${Ts.toFixed(2)} °C (10 kPa) the blades' ${Pb.toFixed(1)} W evaporate ${(r2.end.evap * 1000).toFixed(2)} g in 10 min (P t / L ${(ex2 * 1000).toFixed(2)} g); 60 °C flashes ${(r3.end.evap * 1000).toFixed(1)} g (exact ${(ex3 * 1000).toFixed(1)} g)`);
}

// 4. pH
{
  const o = MX.mixDefaults();
  // a single acid (carboxyl only, 0.1 mol in 1 L), no base: [H⁺]² + Ka [H⁺] − Ka C = 0 (water's own ions negligible here)
  const Ka = 10 ** -o.pK1, C = 0.1, hEx = (-Ka + Math.sqrt(Ka * Ka + 4 * Ka * C)) / 2;
  const s1 = MX.mixSpecies({ ...o, pKw: 30 }, { Q1: 0.1, Q2: 0, QSA: 0, NT: 0 }, 1), d1 = Math.abs(s1.pH + Math.log10(hEx));
  // the two-step acid (GO's groups) with ammonia: for each pH the ammonia it takes in closed form (no water added with
  // it), then the solver's pH from that ammonia
  const Q = { Q1: 7.6, Q2: 15.2, QSA: 0.2, NT: 0 }, VW = 6; let worst = 0;
  for (let pH = 2.5; pH <= 11.001; pH += 0.25) { const NT = MX.mixDoseFor(o, Q, VW, pH, 0); if (NT <= 0) continue; const s = MX.mixSpecies(o, { ...Q, NT }, VW); worst = Math.max(worst, Math.abs(s.pH - pH)); }
  // dosing to pH 7 with the ammonia water's own water (25 wt%: 2.84 mL of water per mol... in litres)
  const c = 0.75 * 0.017031 / 0.25, NT7 = MX.mixDoseFor(o, Q, VW, 7, c), s7 = MX.mixSpecies(o, { ...Q, NT: NT7 }, VW + c * NT7);
  check('pH: a single acid\'s exact quadratic; the two-step acid\'s titration curve with ammonia; dosing to pH 7 with its water',
    d1 < 1e-9 && worst < 1e-9 && Math.abs(s7.pH - 7) < 1e-9,
    `0.1 M carboxyl: pH ${s1.pH.toFixed(6)} (exact ${(-Math.log10(hEx)).toFixed(6)}); pH 2.5–11 from its ammonia off by ${e1(worst)} at most; to pH 7: ${NT7.toFixed(3)} mol, pH ${s7.pH.toFixed(9)}`);
}

// 5. the double layer
{
  const o = { ...MX.mixDefaults(), ...slurry }, sp = { th1: 1, th2: 0, I: 1e-3 }, s = MX.mixSurface(o, sp, 25, 2.5e-6);
  const ex = 0.304e-9 / Math.sqrt(1e-3), kT = 1.380649e-23 * 298.15, eps = (87.74 - 0.40008 * 25 + 9.398e-4 * 625 - 1.41e-6 * 15625) * 8.8541878128e-12;
  const n = 1e-3 * 1000 * 6.02214076e23, back = Math.sqrt(8 * eps * n * kT) * Math.sinh(1.602176634e-19 * s.psi0 / (2 * kT));
  check('the double layer: the Debye length at 25 °C, 1 mM (0.304/√I nm); Grahame\'s charge from its potential',
    Math.abs(s.debye / ex - 1) < 5e-3 && Math.abs(back / s.sigma - 1) < 1e-12 && s.sigma < 0,
    `Debye length ${(s.debye * 1e9).toFixed(3)} nm (${(ex * 1e9).toFixed(3)}); charge ${s.sigma.toFixed(4)} C/m², back from its potential ${(s.psi0 * 1e3).toFixed(1)} mV to ${e1(Math.abs(back / s.sigma - 1))}`);
}

// the populations' time stepping in these checks: RK4
const integrate = (pbe, N0, rates, T, n) => { const N = Float64Array.from(N0), K = N.length, k1 = new Float64Array(K), k2 = new Float64Array(K), k3 = new Float64Array(K), k4 = new Float64Array(K), y = new Float64Array(K), h = T / n;
  for (let s = 0; s < n; s++) { pbe.rhs(N, k1, rates); for (let i = 0; i < K; i++) y[i] = N[i] + h / 2 * k1[i]; pbe.rhs(y, k2, rates); for (let i = 0; i < K; i++) y[i] = N[i] + h / 2 * k2[i]; pbe.rhs(y, k3, rates);
    for (let i = 0; i < K; i++) y[i] = N[i] + h * k3[i]; pbe.rhs(y, k4, rates); for (let i = 0; i < K; i++) N[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]); }
  return N; };

// 6. aggregation, a constant kernel
{
  const b = 1, N0 = 1, t = 2, tau = b * N0 * t;
  const lin = MX.mixPBE(Array.from({ length: 160 }, (_, k) => k + 1), {}), Nl = new Float64Array(160); Nl[0] = N0;
  const L = integrate(lin, Nl, { beta: () => b }, t, 400);
  let worst = 0; for (let k = 0; k < 40; k++) { const ex = N0 * (tau / 2) ** k / (1 + tau / 2) ** (k + 2); worst = Math.max(worst, Math.abs(L[k] - ex) / (N0 / (1 + tau / 2) ** 2)); }
  const geo = MX.mixPBE(Array.from({ length: 40 }, (_, k) => 2 ** k), {}), Ng = new Float64Array(40); Ng[0] = N0;
  const Gq = integrate(geo, Ng, { beta: () => b }, t, 400);
  let n = 0, m = 0; Gq.forEach((x, k) => { n += x; m += x * 2 ** k; });
  const nEx = N0 / (1 + tau / 2);
  check('aggregation at a constant rate: Smoluchowski\'s exact sizes (linear grid); the number N0/(1 + βN0t/2) and the mass kept (doubling grid)',
    worst < 1e-8 && Math.abs(n / nEx - 1) < 1e-8 && Math.abs(m - 1) < 1e-12,
    `sizes 1–40 off by ${e1(worst)} of the monomers' at most (βN0t = 2); the doubling grid's number ${n.toFixed(9)} (exact ${nEx.toFixed(9)}), mass off ${e1(Math.abs(m - 1))}`);
}

// 7. breakage
{
  // into halves at the rate 1: from class 12, the j-th generation 2^j t^j/j! e^(−t)
  const K = 13, pbe = MX.mixPBE(Array.from({ length: K }, (_, k) => 2 ** k), { daughters: 'halves' }), N0 = new Float64Array(K); N0[K - 1] = 1;
  const t = 1.5, N = integrate(pbe, N0, { S: Float64Array.from({ length: K }, (_, k) => (k > 0 ? 1 : 0)) }, t, 300);
  let worst = 0, f = 1; for (let j = 0; j < 8; j++) { if (j) f *= j; const ex = 2 ** j * t ** j / f * Math.exp(-t); worst = Math.max(worst, Math.abs(N[K - 1 - j] - ex)); }
  // Ziff–McGrady: rate x, uniform split, from x = 1: the number 1 + t; the size distribution against theirs,
  // n(x, t) = e^(−xt) (2t + t²(1 − x)) below 1, integrated over each class (by mass), on two grids
  // (the grid down to 1e-9, so the fragments below it are a few in 10⁸ of the number; its smallest class kept whole)
  const zm = (r, tt) => { const v = []; for (let x = 1; x > 1e-9; x /= r) v.unshift(x); const p = MX.mixPBE(v, { daughters: 'uniform' }), N1 = new Float64Array(v.length); N1[v.length - 1] = 1;
    const Nz = integrate(p, N1, { S: Float64Array.from(v, (x, k) => (k ? x : 0)) }, tt, 400); let num = 0; Nz.forEach(x => { num += x; });
    // (each class's mass against the exact mass in its share of the hats)
    let err = 0, tot = 0; const exM = (lo, hi) => { let s = 0; const m = 200; for (let i = 0; i < m; i++) { const x = lo + (hi - lo) * (i + 0.5) / m; s += x * Math.exp(-x * tt) * (2 * tt + tt * tt * (1 - x)); } return s * (hi - lo) / m; };
    for (let k = 0; k < v.length - 1; k++) { if (v[k] < 1e-4) continue; const lo = Math.sqrt(v[k - 1] * v[k]), hi = Math.sqrt(v[k] * v[k + 1]); const e = exM(lo, hi); err += Math.abs(Nz[k] * v[k] - e); tot += e; }
    return { num, err: err / tot };
  };
  const tt = 2, z1 = zm(2 ** 0.5, tt), z2 = zm(2 ** 0.25, tt);
  check('breakage: halves at a constant rate the exact Poisson generations; Ziff–McGrady\'s uniform split, the number 1 + t, the sizes converging',
    worst < 1e-8 && Math.abs(z2.num / (1 + tt) - 1) < 1e-7 && z2.err < z1.err / 1.6 && z2.err < 0.05,
    `generations off by ${e1(worst)}; Ziff–McGrady at t = 2: number ${z2.num.toFixed(9)} (exact 3), mass by class off ${(z1.err * 100).toFixed(2)} % (√2 grid) → ${(z2.err * 100).toFixed(2)} % (2^¼ grid)`);
}

// 8. the batch through the default program
{
  const o = { ...MX.mixDefaults(), ...slurry }, t0 = Date.now(), r = MX.mixRun(o), ms = Date.now() - t0;
  const e = r.end, mW0 = MX.mixRecipe(o).mW0, wBal = Math.abs(e.mW - (mW0 + e.addW - e.evap)) / mW0, gBal = Math.abs(e.goVol / e.goVol0 - 1);
  const dur = o.steps.reduce((s, q) => s + q.min * 60, 0), H = r.hist;
  // (the history: through every step and at its end, each step's records with its own speeds)
  let tc = 0, hOk = H.t.length >= 400;
  o.steps.forEach((q, i) => { tc += q.min * 60; const j = H.step.lastIndexOf(i), own = H.step.map((x, k) => k).filter(k => H.step[k] === i);
    hOk = hOk && j >= 0 && Math.abs(H.t[j] - tc) < 1e-6 && own.every(k => (q.Nd > 0) === (H.PD[k] > 0)) && own.length > 50; });
  // (the batch just before the program's ammonia and just after it, both at its step's start; the recipe's ammonia water)
  const iD = o.steps.findIndex(q => q.dose), j0 = H.step.indexOf(iD), tD = o.steps.slice(0, iD).reduce((s, q) => s + q.min * 60, 0);
  const dOk = iD >= 0 && H.t[j0] === tD && H.t[j0 + 1] === tD && H.pH[j0] < 6 && Math.abs(H.pH[j0 + 1] - r.doses[0].pH) < 1e-9 && H.pH[j0 + 1] > 6 && H.T[j0 + 1] > H.T[j0]
    && Math.abs(r.doses[0].g - 242) < 1e-9;
  hOk = hOk && dOk;
  check('the batch through the default program: the GO\'s mass kept, the water\'s balance closed, the program\'s time, its history',
    !r.error && gBal < 1e-12 && wBal < 1e-14 && Math.abs(e.t - dur) < 1e-6 && hOk && ms < 5000,
    `${(ms / 1000).toFixed(1)} s, ${e.steps} steps, ${H.t.length} records (the ammonia at ${(tD / 60).toFixed(0)} min: pH ${H.pH[j0].toFixed(2)} → ${H.pH[j0 + 1].toFixed(2)}, ${H.T[j0].toFixed(2)} → ${H.T[j0 + 1].toFixed(2)} °C); GO off ${e1(gBal)}, water ${e1(wBal)}; ammonia ${r.doses.map(d => `${d.mL.toFixed(0)} mL to pH ${d.pH.toFixed(2)}`).join(', ')}; end: ${e.T.toFixed(1)} °C, grind ${(e.grind * 1e6).toFixed(0)} µm, ${(e.lumps * 100).toFixed(2)} % in lumps, ${e.mu27.toFixed(2)} Pa·s at 2.7 1/s and ${o.Tlaw} °C`);
}

// 9. the recipe against the sheet's own totals
{
  const o = { ...MX.mixDefaults(), ...slurry }, R = MX.mixRecipe(o);
  const g = x => x * 1000, got = [['batch', g(R.mTot), 83346], ['liquid, the paste\'s water in', g(R.mLiq), 81949.2], ['dry GO', g(R.mGO), 1396.8],
    ['water and ammonia water added', g(o.mSoak + o.mWat + o.mN), 80242]];
  const worst = Math.max(...got.map(([, a, b]) => Math.abs(a - b)));
  // (Materials' slurry solids by default: the recipe's, MIX-1c)
  const MATS = require('../engine/materials.js'), phiDef = MATS.MAT_SLURRY.find(q => q[0] === 'phi')[7];
  check('the recipe: the batch\'s totals against the recipe sheet\'s (SOP 1.3, 100 L); Materials\' default solids the recipe\'s', worst < 1e-6 && Math.abs(R.mLiq / R.mTot * 100 - 98.3) < 0.05 && phiDef === +(R.phiEnd * 100).toFixed(3),
    `${got.map(([n, a, b]) => `${n} ${a.toFixed(1)} g (sheet ${b})`).join(', ')}; liquid ${(R.mLiq / R.mTot * 100).toFixed(2)} % (sheet 98.3 %); GO ${(R.wGO * 100).toFixed(3)} wt%, ${(R.phiEnd * 100).toFixed(3)} vol% (Materials' default ${phiDef}), ${(R.Vend * 1000).toFixed(2)} L`);
}

// 10. turbulence: the Kolmogorov scale and the eddies' stress
{
  const mu = 1e-3, rho = 1000, eps = 1, nu = mu / rho, eta = Math.pow(nu ** 3 / eps, 0.25), C = 2, z = { tau: 0.5, eps, mu, rho, Ck: C };
  const tK = mu * Math.sqrt(eps / nu), up = MX.mixTauOn(z, eta * (1 + 1e-9)), dn = MX.mixTauOn(z, eta * (1 - 1e-9)), big = MX.mixTauOn(z, 1e-3);
  const exBig = C * rho * Math.pow(eps * 1e-3, 2 / 3), lam = MX.mixTauOn({ ...z, eps: 0 }, 1e-3);
  check('turbulence: the Kolmogorov length of water at 1 W/kg; the eddies\' stress meeting the viscous scale\'s at it; none: the mean shear\'s',
    Math.abs(eta * 1e6 - 31.62) < 0.01 && Math.abs(up / (C * tK) - 1) < 1e-8 && Math.abs(dn - Math.max(0.5, tK)) < 1e-15 && Math.abs(big / exBig - 1) < 1e-14 && lam === 0.5,
    `η ${(eta * 1e6).toFixed(2)} µm (31.62); at η: ${up.toFixed(4)} Pa = C μ (ε/ν)^½ ${(C * tK).toFixed(4)} Pa; below it ${dn.toFixed(4)} Pa; at 1 mm ${big.toFixed(3)} Pa (C ρ (ε a)^⅔ ${exBig.toFixed(3)}); no turbulence ${lam} Pa`);
}

// 11. the grind gauge
{
  const rows = [], errs = [];
  for (const [fh, sgh] of [[1e-4, 1.5], [1e-3, 1.5], [3e-4, 2]]) {
    // (the soft pieces as single flakes, nothing turning: the hard pieces the only lumps; the gauge deep enough for them)
    const o = { ...MX.mixDefaults(), ...slurry, fh, sgh, gR: 1e-3, a0: 5e-6 * 1.01, sg: 1.01, steps: [{ name: 'a', min: 0.1, No: 0, Nd: 0, p: 101.325, dose: null }] };
    const r = MX.mixRun(o), got = r.hist.grind[0], R = MX.mixRecipe(o), Vb = R.mGO / o.rhoS + R.mW0 / o.rhoL, Vs = R.mGO / o.rhoS * fh;
    const Rg = Math.cbrt(3 * o.Vg / (4 * Math.PI)), sl = Math.log(sgh), lm = Math.log(o.ah);
    const count = x => { let c = 0; const n = 4000, l0 = Math.log(x), l1 = lm + 8 * sl, h = (l1 - l0) / n;
      for (let i = 0; i <= n; i++) { const l = l0 + i * h, a = Math.exp(l), f = Math.exp(-0.5 * ((l - lm) / sl) ** 2) / (sl * Math.sqrt(2 * Math.PI));
        c += (i === 0 || i === n ? 0.5 : 1) * h * f * Vs / (R.phiH * Math.PI / 6 * a ** 3) / Vb * 4 / 3 * Math.PI * (Rg + a / 2) ** 3; }
      return c; };
    let lo = Math.log(1e-6), hi = Math.log(1e-2); for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (count(Math.exp(m)) >= o.Ns) lo = m; else hi = m; }
    const ex = Math.exp((lo + hi) / 2); errs.push(Math.abs(got / ex - 1)); rows.push(`${fh * 100} % at ×${sgh}: ${(got * 1e6).toFixed(2)} µm (${(ex * 1e6).toFixed(2)})`);
  }
  const o = { ...MX.mixDefaults(), ...slurry, steps: [{ name: 'a', min: 0.1, No: 0, Nd: 0, p: 101.325, dose: null }] }, g0 = MX.mixRun(o).hist.grind[0];
  check('the grind gauge: hard pieces alone against their log-normal\'s count touching the sample (within 2 %); the whole paste at the start off the gauge',
    Math.max(...errs) < 0.02 && g0 > o.gR, `${rows.join(', ')}; the paste at the start ${(g0 * 1e3).toFixed(1)} mm (the gauge ${(o.gR * 1e6).toFixed(0)} µm)`);
}

// 12. the recipe's spread: the paste spec against the sheet, the tolerances against every corner
{
  const o = { ...MX.mixDefaults(), ...slurry }, cC = 0.5094, S = MX.mixRecipeRange(o, cC), g = x => x * 1000;
  const sheet = [['dry GO, lowest', g(S.dry[0]), 1272.6], ['dry GO, as made', g(S.dry[1]), 1396.8], ['dry GO, highest', g(S.dry[2]), 1458.9],
    ['carbon, lowest', g(S.carbon[0]), 610.9], ['carbon, highest', g(S.carbon[2]), 787.8]];
  const ws = sheet.map(([, a, b]) => Math.abs(a - b));
  // (every corner: each of the four amounts at its own −, + tolerance; the solids at the paste's, or across the spec)
  const corners = ws_ => { const out = []; for (let m = 0; m < 16; m++) for (const w of ws_) out.push(MX.mixRecipe({ ...o, wPaste: w, mPaste: o.mPaste + (m & 1 ? 1 : -1) * o.tPaste,
    mSoak: o.mSoak + (m & 2 ? 1 : -1) * o.tSoak, mWat: o.mWat + (m & 4 ? 1 : -1) * o.tWat, mN: o.mN + (m & 8 ? 1 : -1) * o.tN })); return out; };
  const c1 = corners([o.wPaste]), c2 = corners([o.wMin, o.wPaste, o.wMax, (o.wMin + o.wMax) / 2]);
  const mm = (cs, k) => [Math.min(...cs.map(R => R[k])), Math.max(...cs.map(R => R[k]))];
  const t1 = mm(c1, 'wGO'), p1 = mm(c1, 'phiEnd'), t2 = mm(c2, 'wGO');
  const e = Math.max(Math.abs(t1[0] - S.tol.w[0]), Math.abs(t1[1] - S.tol.w[1]), Math.abs(p1[0] - S.tol.phi[0]), Math.abs(p1[1] - S.tol.phi[1]), Math.abs(t2[0] - S.both.w[0]), Math.abs(t2[1] - S.both.w[1]));
  const src = MX.mixRun.toString(), uses = [...MX.MIX_NOSOLVE].filter(k => new RegExp(`o\\.${k}\\b`).test(src));
  check('the recipe\'s spread: the paste spec\'s dry GO and carbon per mix as the sheet\'s; the GO\'s share within the tolerances their corners\' extremes; the solve takes none of them',
    Math.max(...ws) < 0.05 && e < 1e-15 && S.tol.w[0] < S.wGO && S.wGO < S.tol.w[1] && !uses.length && Math.abs(S.carbon[1] - S.dry[1] * cC) < 1e-15,
    `${sheet.map(([n, a, b]) => `${n} ${a.toFixed(2)} g (sheet ${b})`).join(', ')}; GO ${(t1[0] * 100).toFixed(4)}–${(t1[1] * 100).toFixed(4)} wt% within the tolerances, ${(t2[0] * 100).toFixed(3)}–${(t2[1] * 100).toFixed(3)} wt% with the spec's solids too (corners ${Number(e).toExponential(1)})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
