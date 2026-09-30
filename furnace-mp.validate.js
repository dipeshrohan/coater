/*
 * furnace-mp.validate.js — checks of furnace-mp.js (MP-2: the furnace's stack in 1D, 2D and 3D, its heat, chemistry, gas
 * and stress together): graphite's heat capacity; the faces' radiation against an independent integration; the reaction's
 * heat against an independent integration (an isolated stack running away); the chemistry at the program's temperature
 * against furnace.js's own; the layered stack against its layers resolved; the dimensions against each other; the gas
 * under a paper against the exact obstacle solution; the stress; the balances. Run: node furnace-mp.validate.js
 */
const F = require('./furnace-mp.js'), FU = require('./furnace.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const fmt = x => x.toExponential(2);
const K0 = 273.15, SIG = 5.670374419e-8;

// the app's furnace (materials.js's defaults), a smaller stack where a check needs speed
const run1 = FU.fuProgram([{ rate: 1, to: 300, hold: 0 }, { rate: 3, to: 1000, hold: 60 }], 25, 5);
const run2 = FU.fuProgram([{ rate: 10, to: 1000, hold: 0 }, { rate: 5, to: 2000, hold: 0 }, { rate: 2, to: 2800, hold: 60 }], 25, 10);
const stages = { water: { Tp: 100, sig: 5e3 }, labile: { Tp: 210, sig: 5e3 }, stable: { Tp: 600, sig: 40e3 }, last: { Tp: 1500, sig: 80e3 }, graph: { Tp: 2650, sig: 80e3 } };
const base = {
  Lx: 0.3, Ly: 0.3, margin: 0.02, N: 200, h: 90e-6, tp: 0.5e-3, ends: 'plates', plateT: 0.03,
  go: { rho: 1400, c: 850, kIn: 1, kThr: 0.2, Xin: 0.05 }, paper: { rho: 1000, kIn: 150, kThr: 5, D: 1e-6 }, plate: { rho: 1800, k: 100 }, Rc: 1e-4,
  runs: [run1, run2], chem: { co: 2, hc: 0.3, s1: 0.6, c1CO2: 0.3, c1CO: 0.3, s2: 0.3, c2CO: 0.7 }, stages, Hr: 1.6e6, furnace: { eps: 0.8, gas: true },
  gas: { Dgal: 5.6e-10, Dmin: 1e-13, dIn: 0.8, sigZ: 200e3, plateP: 7 * 9.81 / 0.34 / 0.34 }, plane: { Ep: 5e9, nu: 0.2, bO: 0.03, bG: 0.005, am: 0 },
  mesh: { nx: 8, nm: 2, nz: 12, nPlate: 2 },
};

// 1. graphite's heat capacity (Butland and Maddison): 0.71 kJ/(kg K) at 300 K, about 2.0 at 2000 K; the enthalpy its integral
{
  const c300 = F.fmpCg(26.85), c2000 = F.fmpCg(1726.85);
  let e = 0; for (const T of [30, 250, 900, 1800, 2700]) e = Math.max(e, rel((F.fmpHg(T + 1e-3) - F.fmpHg(T - 1e-3)) / 2e-3, F.fmpCg(T)));
  check('graphite\'s heat capacity: 300 K and 2000 K as tabulated; the enthalpy is its integral', Math.abs(c300 - 710) < 10 && Math.abs(c2000 - 2020) < 40 && e < 1e-7, `${c300.toFixed(0)}, ${c2000.toFixed(0)} J/(kg K); ${fmt(e)}`);
}

// 2. the faces: a stack that conducts far better than its faces pass heat (even all through) heated by the hot zone's
//    radiation alone, against the lumped body integrated independently (RK4, the same heat capacities)
{
  const o = { ...base, dim: 1, margin: 0, noChem: true, go: { ...base.go, Xin: 0 }, paper: { ...base.paper, kIn: 1e6 }, furnace: { eps: 0.8, gas: false }, runs: [run1] };
  const fGO = o.N * o.h / (o.N * o.h + (o.N - 1) * o.tp), fP = 1 - fGO, rc = o.go.c / F.fmpCg(20);
  const Cv = T => fGO * o.go.rho * rc * F.fmpCg(T) + fP * o.paper.rho * F.fmpCg(T), Lx = o.Lx / 2;
  const f = (t, T) => 0.8 * SIG * (Math.pow(FU.fuTempAt(run1, t), 4) - Math.pow(T + K0, 4)) / (Lx * Cv(T));
  const ref = tEnd => { let T = run1[0][1] - K0, t = 0; const dt = 2; while (t < tEnd - 1e-9) { const h = Math.min(dt, tEnd - t), k1 = f(t, T), k2 = f(t + h / 2, T + h / 2 * k1), k3 = f(t + h / 2, T + h / 2 * k2), k4 = f(t + h, T + h * k3); T += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4); t += h; } return T; };
  const at = (r, t) => { const s = r.series.find(q => Math.abs(q.t - t) < 1e-6); return s.pieces[r.follow[0]].mid; };
  const times = [3600, 10800, 21600];
  const errs = [0.5, 0.25].map(dT => { const r = F.fmpStack({ ...o, dT, dTHigh: dT * 5, snapTimes: times }); return Math.max(...times.map(t => Math.abs(at(r, t) - ref(t)))); });
  check('radiation from the hot zone: the stack\'s temperature against the lumped body (first order in the step)', errs[1] < 0.5 && errs[0] / errs[1] > 1.6, `${errs.map(e => e.toFixed(3)).join(' → ')} K at 1, 3, 6 h (${ref(10800).toFixed(1)} °C at 3 h against the program's ${(FU.fuTempAt(run1, 10800) - K0).toFixed(0)})`);
}

// 3. the reaction's heat: an isolated stack at 190 °C runs away; against the same chemistry and heat capacities
//    integrated independently (explicit, small steps) -- when it passes 290 °C, where it ends; its balance
{
  const T0 = 190, tEnd = 1800, prog = [[0, T0 + K0], [tEnd, T0 + K0]];
  const o = { ...base, dim: 1, margin: 0, adiabatic: true, runs: [prog], mesh: { nx: 2 }, bins: 41 };
  const cross = S => { for (let k = 1; k < S.length; k++) if (S[k - 1][1] < T0 + 100 && S[k][1] >= T0 + 100) { const [ta, Ta] = S[k - 1], [tb, Tb] = S[k]; return ta + (T0 + 100 - Ta) / (Tb - Ta) * (tb - ta); } return null; };
  const sims = [[2, 1], [1, 0.5]].map(([dtMax, jumpMax]) => { const r = F.fmpStack({ ...o, dtMax, jumpMax }), mid = r.follow[0]; return { r, t: cross(r.series.map(s => [s.t, s.pieces[mid].mid])), T: r.series[r.series.length - 1].pieces[mid].mid }; });
  const r = sims[1].r, sim = sims[1].t, Tsim = sims[1].T;
  // (the reference: every stage's energies, the heat stages' heat, the GO's mass and water as they go)
  const chem = FU.fuChem(o.chem), perKg = 1000 / chem.mGO, Xin = o.go.Xin, mS = [Xin, ...chem.stages.map(s => s.mass * perKg / 1000)];
  const ST = ['water', 'labile', 'stable', 'last'].map(k => FU.fuStage({ ...stages[k], nodes: 41 })), H = [-2.26e6 * Xin, o.Hr, 0, 0];
  const Hs = o.N * o.h + (o.N - 1) * o.tp, fGO = o.N * o.h / Hs, fP = 1 - fGO, rc = o.go.c / F.fmpCg(20);
  const conv = st => { let a = 0; for (let k = 0; k < st.E.length; k++) a -= st.w[k] * Math.expm1(-st.I[k]); return a; };
  let T = T0, t = 0; const out = [[0, T0]];
  while (t < tEnd) {
    const TK = T + K0, rates = ST.map(st => { let d = 0; for (let k = 0; k < st.E.length; k++) d += st.w[k] * Math.exp(-st.I[k]) * st.A * Math.exp(-st.E[k] / (FU.FU_R * TK)); return d; });
    const al = ST.map(conv), kept = 1 - al[1] * mS[1] - al[2] * mS[2] - al[3] * mS[3], wl = 1 - al[0];
    const Cv = fGO * o.go.rho * (kept * rc * F.fmpCg(T) + wl * Xin * 4180) + fP * o.paper.rho * F.fmpCg(T);
    const dTdt = fGO * o.go.rho * rates.reduce((s, q, i) => s + H[i] * q, 0) / Cv;
    const dt = Math.min(1, 0.02 / Math.max(Math.abs(dTdt), 1e-12), tEnd - t);
    for (const st of ST) for (let k = 0; k < st.E.length; k++) st.I[k] += dt * st.A * Math.exp(-st.E[k] / (FU.FU_R * TK));
    T += dt * dTdt; t += dt; out.push([t, T]);
  }
  const ref = cross(out);
  const e0 = Math.abs(sims[0].t - ref), e1 = Math.abs(sim - ref);
  check('an isolated stack\'s own heat (its labile oxygen, its water): it runs away as integrated independently (first order in the step)', rel(sim, ref) < 0.025 && e0 / e1 > 1.6 && Math.abs(Tsim - T) < 1,
    `passes ${T0 + 100} °C at ${sims[0].t.toFixed(1)} → ${sim.toFixed(1)} s against ${ref.toFixed(1)} s; ends at ${Tsim.toFixed(1)} against ${T.toFixed(1)} °C`);
  check('… its heat balance: what it holds rose by what its chemistry gave, step by step (no faces)', r.energy.faces === 0 && rel(r.energy.held, r.energy.reaction) < 1e-8, `${fmt(rel(r.energy.held, r.energy.reaction))}`);
}

// 4. the chemistry at the program's temperature (no heat solved): furnace.js's own stages through both runs, exactly;
//    41 energies a stage (the solver's) against furnace.js's 161
{
  const ref = ['water', 'labile', 'stable', 'last', 'graph'].map(k => FU.fuStage(stages[k]));
  for (const pts of [run1, run2]) for (let i = 1; i < pts.length; i++) {
    const [ta, Ta] = pts[i - 1], [tb, Tb] = pts[i], m = Math.max(1, Math.ceil(Math.abs(Tb - Ta)), Math.ceil((tb - ta) / 600));
    for (let k = 0; k < m; k++) for (const st of ref) FU.fuAdvance(st, Ta + (Tb - Ta) * k / m, Ta + (Tb - Ta) * (k + 1) / m, (tb - ta) / m);
  }
  const aRef = ref.map(FU.fuConv);
  // (the stages' conversions after each run, from the mass kept and the oxygen gone at the middle piece: read off its fields)
  const one = bins => { const r = F.fmpStack({ ...base, dim: 1, isothermal: true, bins, dT: 1, dTHigh: 1, plane: null, mesh: { nx: 2, nm: 1 } }); return r.chemEnd; };
  const a161 = one(161), a41 = one(41);
  const e161 = Math.max(...aRef.map((a, s) => Math.abs(a - a161[s]))), e41 = Math.max(...aRef.map((a, s) => Math.abs(a - a41[s])));
  check('the chemistry at the program\'s temperature: furnace.js\'s stages exactly; 41 energies a stage against its 161', e161 < 1e-9 && e41 < 5e-3, `${fmt(e161)}; ${fmt(e41)} (conversions ${aRef.map(a => a.toFixed(3)).join(', ')})`);
}

// 5. the layered stack against its layers resolved one by one (a small stack, no contact resistance; heated and reacting
//    gently, its heat below a runaway)
{
  const o = { ...base, dim: 2, N: 6, Rc: 0, Hr: 0.2e6, runs: [FU.fuProgram([{ rate: 2, to: 400, hold: 0 }], 25, 0)], mesh: { nx: 8, nm: 2, nz: 6, nPlate: 2 }, follow: [0, 2, 5], plane: null };
  const a = F.fmpStack(o), b = F.fmpStack({ ...o, resolve: true });
  let e = 0, big = 0;
  for (let k = 0; k < a.series.length; k++) for (const i of a.follow) for (const f of ['mid', 'edge']) { e = Math.max(e, Math.abs(a.series[k].pieces[i][f] - b.series[k].pieces[i][f])); big = Math.max(big, a.series[k].Tprog - a.series[k].pieces[i][f]); }
  check('the stack as layers combined against every piece and paper resolved', e < 0.02 * big, `${e.toFixed(3)} K at worst, the lag up to ${big.toFixed(1)} K (${a.mesh.nodes} against ${b.mesh.nodes} nodes)`);
}

// 6. the dimensions agree: with no plates (top and bottom insulated) the 2D is the 1D; with its y side insulated and sealed
//    the 3D is the 2D (through a runaway: heat, chemistry, gas)
{
  // (through a runaway the step's rounding, 10⁻¹¹ K, grows ten million times: agreed to 10⁻⁴ of its rise there)
  const both = Hr => { const o = { ...base, Hr, runs: [FU.fuProgram([{ rate: 1, to: 320, hold: 0 }], 25, 0)], plane: null };
    const r1 = F.fmpStack({ ...o, dim: 1 }), r2 = F.fmpStack({ ...o, dim: 2, plates: false, mesh: { ...o.mesh, nz: 3 } });
    let e = 0; const i1 = r1.follow[0];
    for (let k = 0; k < r1.series.length; k++) for (const f of ['mid', 'edge', 'aM']) e = Math.max(e, Math.abs(r1.series[k].pieces[i1][f] - r2.series[k].pieces[i1][f]));
    return { e, over: r1.summary.runs[0].over }; };
  const calm = both(0.3e6), wild = both(base.Hr);
  check('no plates, top and bottom insulated: the 2D is the 1D (temperatures, conversions); through a runaway too', calm.e < 1e-8 && calm.over < 1 && wild.e < 1e-4 * (wild.over + 200),
    `${fmt(calm.e)}; running away to ${wild.over.toFixed(0)} K above the program: ${fmt(wild.e)} K`);
  const q = { ...base, plane: null, N: 20, runs: [FU.fuProgram([{ rate: 2, to: 300, hold: 0 }], 25, 0)], mesh: { nx: 5, nm: 1, nz: 4, nPlate: 1 } };
  const s2 = F.fmpStack({ ...q, dim: 2 }), s3 = F.fmpStack({ ...q, dim: 3, sealY: true, mesh: { ...q.mesh, ny: 2 } });
  let e3 = 0, eg = 0;
  for (let k = 0; k < s2.series.length; k++) for (const i of s2.follow) {
    for (const f of ['mid', 'edge', 'aM']) e3 = Math.max(e3, Math.abs(s2.series[k].pieces[i][f] - s3.series[k].pieces[i][f]));
    eg = Math.max(eg, Math.abs(s2.series[k].pieces[i].middle - s3.series[k].pieces[i].middle) / Math.max(1, s2.series[k].pieces[i].hold));
  }
  check('its y side insulated and sealed: the 3D is the 2D (temperatures, conversions, the gas)', e3 < 1e-6 && eg < 1e-6, `${fmt(e3)} K, gas ${fmt(eg)} of the hold`);
}

// 7. the gas under a paper: a uniform source to the edge, the paper held (the parabola), and lifting where it passes the
//    load (the obstacle problem: held at the load out to a − (L − a)² = 2 κ cap / G)
{
  const L = 0.15, G = 1e-3, kap = 5e-14, C = require('./mp-core.js');
  const Mp = C.mpMesh({ dim: 1, p: 1, axes: [[{ L, n: 200 }]] }), T = new Float64Array(Mp.N).fill(300), Gs = new Float64Array(Mp.N).fill(G);
  const held = F.fmpGasLevel(Mp, { T, G: Gs, cap: Infinity, kap: () => kap, edges: ['x1'] });
  let e1 = 0; for (let k = 0; k < Mp.N; k++) { const x = Mp.X[k]; e1 = Math.max(e1, Math.abs(held[k] - G * (L * L - x * x) / (2 * kap)) / (G * L * L / (2 * kap))); }
  const cap = 600, a = L - Math.sqrt(2 * kap * cap / G), lift = F.fmpGasLevel(Mp, { T, G: Gs, cap, kap: () => kap, edges: ['x1'] });
  let e2 = 0; for (let k = 0; k < Mp.N; k++) { const x = Mp.X[k], ex = x <= a ? cap : cap - G * (x - a) * (x - a) / (2 * kap); e2 = Math.max(e2, Math.abs(lift[k] - ex) / cap); }
  check('the gas under a paper: held, the parabola; lifting past the load, the obstacle problem\'s exact solution', e1 < 1e-9 && e2 < 2e-3, `${fmt(e1)}; ${fmt(e2)} of the load (lifted over ${(a / L * 100).toFixed(1)} % of it)`);
}

// 8. the balances, each dimension, through both runs of the app's stack (its runaway included); and a piece that
//    converts evenly holds no stress
{
  for (const dim of [1, 2]) {
    const r = F.fmpStack({ ...base, dim, tol: 1e-10 }), E = r.energy;
    check(`${dim}D, both runs: the heat through the faces and the reaction's = the rise of what the stack holds (step by step)`, rel(E.faces + E.reaction, E.held) < 1e-7,
      `${fmt(rel(E.faces + E.reaction, E.held))}; the reaction's ${(E.reaction / 1e6).toFixed(2)} MJ${dim === 1 ? '/m²' : '/m'}; ${r.ms} ms`);
  }
  const r = F.fmpStack({ ...base, dim: 2, isothermal: true, runs: [FU.fuProgram([{ rate: 5, to: 600, hold: 0 }], 25, 0)] });
  const pk = Math.max(...r.series.map(s => Math.max(...r.follow.map(i => Math.abs(s.pieces[i].pull)))));
  check('converting evenly (at the program\'s temperature everywhere): no stress in a piece', pk < 1e-6, `${fmt(pk)} MPa`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
