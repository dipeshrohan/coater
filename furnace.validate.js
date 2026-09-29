/*
 * furnace.validate.js — checks of furnace.js (the GO pieces in the furnace: the film's chemistry by stages, the gas
 * through the film and along the graphite paper, the pieces puffing up) against exact solutions and balances.
 * Run: node furnace.validate.js
 */
const F = require('./furnace.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const R = F.FU_R;

// (Simpson on n panels)
const simpson = (f, a, b, n) => { const h = (b - a) / n; let s = f(a) + f(b); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h); return s * h / 3; };

// 1. the exponential integral: the series and the continued fraction against tabulated values, and each other at x = 1
{
  const tab = [[0.1, 1.8229239584193906], [0.5, 0.5597735947761608], [1, 0.21938393439552029], [2, 0.04890051070806112], [5, 0.0011482955912753257], [10, 4.156968929685324e-6]];
  let e = 0; for (const [x, v] of tab) e = Math.max(e, rel(F.fuExE1(x) * Math.exp(-x), v));
  check('the exponential integral E₁ against its tables', e < 1e-13, `worst ${e.toExponential(1)}`);
}

// 2. the temperature integral: exact over a straight piece against Simpson (heating, cooling, nearly held)
{
  const cases = [[150e3, 400, 520, 7200], [250e3, 700, 1200, 3 * 3600], [525e3, 1300, 2300, 4 * 3600], [830e3, 2400, 3073, 6 * 3600], [150e3, 520, 400, 3600], [250e3, 900, 900.5, 600], [106e3, 300, 301, 60]];
  let e = 0;
  for (const [E, T0, T1, dt] of cases) {
    const ex = F.fuArrInt(E, T0, T1, dt), num = simpson(t => Math.exp(-E / (R * (T0 + (T1 - T0) * t / dt))), 0, dt, 20000);
    e = Math.max(e, rel(ex, num));
  }
  check('the temperature integral: exact against Simpson', e < 1e-9, `worst ${e.toExponential(1)} over ${cases.length} pieces (heating, cooling, nearly held)`);
}

// 3. one activation energy heated at 10 °C/min peaks at the temperature it was set by (Kissinger's condition, exact)
{
  const out = [];
  for (const Tp of [210, 600, 1500]) {
    const st = F.fuStage({ Tp, sig: 0 }), beta = 10 / 60, T0 = 293.15, dT = 0.01;
    let best = 0, Tb = 0, prev = 0, T = T0;
    while (T < Tp + 273.15 + 200) { const r = F.fuAdvance(st, T, T + dT, dT / beta) / dT; if (r > best) { best = r; Tb = T + dT / 2; } prev = r; T += dT; }
    out.push(Math.abs(Tb - (Tp + 273.15)));
  }
  check('one activation energy peaks where it was set (10 °C/min)', out.every(v => v < 0.02), out.map(v => v.toFixed(3) + ' K').join(', '));
}

// 4. held at one temperature: α = 1 − e^(−k t)
{
  const st = F.fuStage({ Tp: 600, sig: 0 }), T = 873.15, k = st.A * Math.exp(-st.E0 / (R * T));
  let e = 0, t = 0; const dt = 60;
  for (let i = 0; i < 200; i++) { F.fuAdvance(st, T, T, dt); t += dt; e = Math.max(e, Math.abs(F.fuConv(st) - (1 - Math.exp(-k * t)))); }
  check('held at a temperature: 1 − e^(−k t)', e < 1e-12, `worst ${e.toExponential(1)} over ${(t / 3600).toFixed(1)} h (k t = ${(k * t).toFixed(2)})`);
}

// 5. a spread of activation energies against the Gaussian integrated finely (each energy's own conversion exact)
{
  const s = { Tp: 1500, sig: 80e3 }, st = F.fuStage(s), E0 = st.E0, prog = F.fuProgram([{ rate: 5, to: 1500, hold: 30 }, { rate: 5, to: 2000, hold: 0 }], 25, 0);
  const checkAt = [];
  for (let i = 1; i < prog.length; i++) { const [ta, Ta] = prog[i - 1], [tb, Tb] = prog[i], m = Math.ceil(Math.abs(Tb - Ta) / 5) || 1;
    for (let k = 0; k < m; k++) { F.fuAdvance(st, Ta + (Tb - Ta) * k / m, Ta + (Tb - Ta) * (k + 1) / m, (tb - ta) / m); if (k % 20 === 0) checkAt.push([ta + (tb - ta) * (k + 1) / m, F.fuConv(st)]); } }
  // (independently: the conversion of each energy over the same program, then the Gaussian -- as the stage's, cut at
  //  ±5σ -- by the trapezoid on 4001 points)
  const conv = (E, tEnd) => { let I = 0; for (let i = 1; i < prog.length; i++) { const [ta, Ta] = prog[i - 1], [tb, Tb] = prog[i]; if (ta >= tEnd) break; const t1 = Math.min(tb, tEnd), T1 = Ta + (Tb - Ta) * (t1 - ta) / (tb - ta); I += st.A * F.fuArrInt(E, Ta, T1, t1 - ta); } return -Math.expm1(-I); };
  let e = 0;
  for (const [t, a] of checkAt) {
    let num = 0, wsum = 0; for (let k = 0; k <= 4000; k++) { const z = -5 + 10 * k / 4000, w = Math.exp(-z * z / 2) * (k === 0 || k === 4000 ? 0.5 : 1); num += w * conv(E0 + 80e3 * z, t); wsum += w; }
    e = Math.max(e, Math.abs(a - num / wsum));
  }
  check('a spread of energies (Gaussian) against its fine integral', e < 5e-4, `worst ${e.toExponential(1)} in the conversion over ${checkAt.length} times`);
}

// the furnace as the app runs it (its defaults), for the balances
const run1 = F.fuProgram([{ rate: 1, to: 300, hold: 0 }, { rate: 3, to: 1000, hold: 60 }], 25, 5);
const run2 = F.fuProgram([{ rate: 10, to: 1000, hold: 0 }, { rate: 5, to: 2000, hold: 0 }, { rate: 2, to: 2800, hold: 60 }], 25, 10);
const base = (x = {}) => Object.assign({ runs: [run1, run2], Lx: 0.3, Ly: 0.3, margin: 0.02, h0: 90e-6, rhoG: 1615, Xin: 0.08,
  chem: { co: 2, hc: 0.3, s1: 0.6, c1CO2: 0.3, c1CO: 0.3, s2: 0.3, c2CO: 0.7 },
  stages: { water: { Tp: 100, sig: 5e3 }, labile: { Tp: 210, sig: 5e3 }, stable: { Tp: 600, sig: 40e3 }, last: { Tp: 1500, sig: 80e3 }, graph: { Tp: 2650, sig: 80e3 } },
  dIn: 0.8, Dgal: 5.6e-10, Dmin: 1e-13, es: 1.04, sigZ: 2e5, paper: { t: 5e-4, rho: 1000, D: 1e-6, Ez: 1e7 }, N: 20, room: 'gap', gap: 0.05,
  La0: 10, La1: 1000, ell: 250, kG: 2000, nP: 12, nM: 2, dT: 1 }, x);

// 6. the chemistry's balances: the mass each stage takes is its gas's; the elements add up; all out, no oxygen left
{
  const c = F.fuChem(base().chem), M = F.FU_M;
  const mass = c.stages.reduce((s, q) => s + q.mass, 0), O = c.stages.reduce((s, q) => s + q.O, 0), H = c.stages.reduce((s, q) => s + q.H, 0);
  const C = c.stages.reduce((s, q) => s + q.C, 0), left = M.C * (1 - C);
  check('the chemistry: every oxygen and hydrogen out, the mass the gas\'s', rel(O, c.O0) < 1e-14 && rel(H, c.H0) < 1e-14 && rel(c.mGO - mass, left) < 1e-12,
    `O ${O.toFixed(4)} of ${c.O0}, H ${H.toFixed(3)} of ${c.H0}; kept ${(left / c.mGO * 100).toFixed(1)} % (the carbon left)`);
}

const r = F.fuRun(base());

// 7. the gas: what the film makes leaves under the paper or is held in it, each run
{
  const b = r.runs.map(q => (q.gas.out + q.gas.held - q.gas.held0) / q.gas.made);
  check('the gas made is the gas out plus the gas held', b.every(v => Math.abs(v - 1) < 1e-9), b.map(v => v.toFixed(12)).join(', '));
  // (and the gas made is the mass lost, stage by stage: in moles from the chemistry)
  const c = F.fuChem(base().chem), perKg = 1000 / c.mGO, mA = 1615 * 90e-6;
  const nu = [0.08 / (F.FU_M.H2O / 1000), ...c.stages.map(s => s.gas * perKg)];
  const want = r.alpha.reduce((s, a, i) => s + mA * nu[i] * a, 0), got = r.runs.reduce((s, q) => s + q.gas.made, 0);
  check('the gas made is the stages\' (their conversion × their gas)', rel(got, want) < 1e-12, `${got.toFixed(5)} mol/m² (${want.toFixed(5)})`);
}

// 8. across the film: the middle's excess G R T h / (8 D) against a finite-difference solve through it
{
  const G = 3e-4, T = 900, h = 60e-6, D = 2e-11, n = 400, dz = h / n, RT = R * T;
  // (−(D/RT) p'' = G/h on (0, h), p = 0 at both faces: tridiagonal)
  const a = new Float64Array(n - 1).fill(2), rhs = new Float64Array(n - 1).fill(G / h * RT / D * dz * dz);
  const c = new Float64Array(n - 1), d = new Float64Array(n - 1);
  c[0] = -1 / a[0]; d[0] = rhs[0] / a[0];
  for (let i = 1; i < n - 1; i++) { const m = a[i] + c[i - 1]; c[i] = -1 / m; d[i] = (rhs[i] + d[i - 1]) / m; }
  const p = new Float64Array(n - 1); p[n - 2] = d[n - 2]; for (let i = n - 3; i >= 0; i--) p[i] = d[i] - c[i] * p[i + 1];
  const mid = p[n / 2 - 1], exact = G * RT * h / (8 * D);
  check('across the film: the middle\'s excess G R T h / (8 D)', rel(mid, exact) < 1e-9, `${(mid / 1e3).toFixed(4)} kPa (${(exact / 1e3).toFixed(4)})`);
}

// 9. along the paper: a square with an even source against the exact series (the middle), converging
{
  const L = 0.3, q = 1, out = [];
  // −∇²u = q on the square of side L, u = 0 at its edges: u(middle) = q L² Σ 16 (−1)^(m+n) / (π⁴ m n (m² + n²)), m, n odd
  let s = 0; for (let m = 1; m < 400; m += 2) for (let n2 = 1; n2 < 400; n2 += 2) s += 16 * ((m + n2) / 2 % 2 ? 1 : -1) / (Math.PI ** 4 * m * n2 * (m * m + n2 * n2));
  const exact = q * L * L * s;
  for (const nP of [8, 16, 32]) {
    const g = F.fuPaperGrid(L / 2, L / 2, 0, nP, 0), src = Float64Array.from(g.area, a => q * a), cap = new Float64Array(g.n).fill(Infinity);
    const u = F.fuPaperSolve(g, {}, src, 1, cap);
    // (the middle: from the quarter's first cells, even about the mirror lines -- a quadratic each way)
    const u00 = u[0], u10 = u[1], u01 = u[g.id(0, 1)], u11 = u[g.id(1, 1)], mid = (81 * u00 - 9 * u10 - 9 * u01 + u11) / 64;
    out.push({ nP, e: rel(mid, exact) });
  }
  check('along the paper: the square\'s middle against the exact series, converging', out[2].e < 3e-4 && out[1].e < out[0].e / 3.5 && out[2].e < out[1].e / 3.5,
    out.map(q2 => `${q2.nP}: ${(q2.e * 100).toFixed(4)} %`).join(', ') + ` (the series ${s.toFixed(7)} q L²)`);
}

// 10. the paper lifting: nowhere above the load; where below it, the balance holds; where at it, more comes than leaves
{
  const g = F.fuPaperGrid(0.15, 0.15, 0.02, 12, 2), src = Float64Array.from(g.area, (a, k) => g.inside[k] ? 5e-4 * a : 0), cap = new Float64Array(g.n).fill(50), kap = 1e-12;
  const u = F.fuPaperSolve(g, {}, src, kap, cap);
  let over = 0, bal = 0, comp = 0, held = 0;
  for (let k = 0; k < g.n; k++) {
    over = Math.max(over, u[k] - cap[k]);
    let outF = g.edge[k] * u[k]; for (const [j, c] of g.nb[k]) outF += c * (u[k] - u[j]); outF *= kap;
    if (u[k] < cap[k] * (1 - 1e-9)) bal = Math.max(bal, Math.abs(outF - src[k]) / Math.max(...src)); else { held++; comp = Math.min(comp, src[k] - outF); }
  }
  check('the paper lifting: at most its load; balanced below it; more coming than leaving at it', over < 1e-9 && bal < 1e-9 && comp > -1e-9 * Math.max(...src) && held > 0,
    `${held} of ${g.n} cells lifted; above ${over.toExponential(1)} Pa, unbalanced ${bal.toExponential(1)}`);
}

// 11. a piece puffing: held at one temperature, only the last oxygen leaving (first order), the gap against its ODE
//     integrated finely -- the layers' spacing closing as the oxygen goes, the gas out through the film opening as it
//     parts, the paper open to the surroundings
{
  const T = 1723.15, hold = 3 * 3600, prog = [[0, T], [hold, T]];
  const o = base({ runs: [prog], Xin: 0, margin: 0, paper: { t: 5e-4, rho: 0, D: 1, Ez: 1e7 }, nP: 2, dT: 1, dtMax: 1,
    chem: { co: 2, hc: 0, s1: 0, c1CO2: 0.3, c1CO: 0.3, s2: 0, c2CO: 0.7 },
    stages: Object.assign({}, base().stages, { last: { Tp: 1500, sig: 0 }, graph: { Tp: 2650, sig: 0 } }) });
  const rr = F.fuRun(o), c = F.fuChem(o.chem), mA = o.rhoG * o.h0, nu3 = c.stages[2].gas * 1000 / c.mGO;
  const st = F.fuStage({ Tp: 1500, sig: 0 }), sg = F.fuStage({ Tp: 2650, sig: 0 });
  const k = st.A * Math.exp(-st.E0 / (R * T)), kg = sg.A * Math.exp(-sg.E0 / (R * T)), RT = R * T, pH = 101325 + o.sigZ, pa = 101325;
  let n = 0, V = 0; const dt = 0.25;
  for (let t = 0; t < hold; t += dt) {
    const tm = t + dt / 2, al = 1 - Math.exp(-k * tm), gd = 1 - Math.exp(-kg * tm);
    const d = 0.3354 + (0.344 - 0.3354) * (1 - gd) + (o.dIn - 0.344) * (1 - al), hc = o.h0 * d / o.dIn;
    const D = (o.Dmin + o.Dgal * ((d - 0.3354) / (o.dIn - 0.3354)) ** 2) * Math.sqrt(T / 293.15), a0 = 8 * D / (RT * hc);
    const G = mA * nu3 * k * Math.exp(-k * tm), a = a0 * (1 + Math.pow(V / (hc * o.es), 3));
    if (V === 0 && G / a <= pH - pa) continue;
    n += (G - a * (pH - pa)) * dt; if (n < 0) n = 0; V = Math.max(V, n * RT / pH);
  }
  const Vr = rr.V[0];
  check('a piece puffing at one temperature: its growth against its ODE', rel(Vr, V) < 2e-3 && V > 0, `${(Vr * 1e6).toFixed(3)} µm (${(V * 1e6).toFixed(3)} µm), k t = ${(k * hold).toFixed(2)}`);
}

// 12. the steps: 1 K against 0.25 K
{
  const a = F.fuRun(base({ dT: 1 })), b = F.fuRun(base({ dT: 0.25 }));
  const eh = rel(a.hMean, b.hMean), ei = Math.max(...a.runs.map((q, i) => Math.abs(q.peak.idx - b.runs[i].peak.idx)));
  check('the steps: 1 K against 0.25 K', eh < 2e-3 && ei < 1e-2, `thickness ${(eh * 100).toFixed(3)} %, the gas against its hold ${ei.toExponential(1)}`);
}

// 13. the programs and a cycle from a file
{
  const p = F.fuProgram([{ rate: 2, to: 225, hold: 30 }, { rate: 5, to: 1025, hold: 60 }], 25, 10);
  const tEnd = (200 / 2 + 30 + 800 / 5 + 60 + 1000 / 10) * 60;
  const c1 = F.fuParseCycle('time (min),temperature (°C)\n0,25\n100,225\n130,225\n', null);
  const c2 = F.fuParseCycle('0;25\n1.5;600\n2;600', 'h'), c3 = F.fuParseCycle('0 25\n10 600', null), c4 = F.fuParseCycle('t (h), T (K)\n0, 300\n2, 1300', null);
  const c5 = F.fuParseCycle('h,°C\n0,25\n2,500\n1,600', null), c6 = F.fuParseCycle('h,°C\n0,25', null);
  const ok = rel(p[p.length - 1][0], tEnd) < 1e-12 && p.length === 6 && Math.abs(F.fuTempAt(p, 50 * 60) - (125 + 273.15)) < 1e-9
    && c1.unit === 'min' && c1.pts[2][0] === 7800 && c1.pts[1][1] === 225 + 273.15 && c2.unit === 'h' && c2.pts[2][0] === 7200
    && c3.err && !c3.unit && c4.pts[1][1] === 1300 && c4.pts[1][0] === 7200 && /back/.test(c5.err) && /two rows/.test(c6.err);
  check('the programs and a cycle from a file', ok, `program ${(p[p.length - 1][0] / 3600).toFixed(3)} h; file units ${c1.unit}, ${c2.unit}; no unit: "${c3.err}"`);
}

// 14. the worker's fits (cfd-furnace-worker.js, run here as the browser runs it): the puffed film's way out back from
//     the thickness it gave; the least open-layer gas way that keeps the first run from puffing; a thickness the
//     puffing cannot give is refused
{
  const fs = require('fs'), vm = require('vm'), out = [];
  const ctx = vm.createContext({ Math, Date, Error, JSON, Array, Object, Number, Float64Array, Int32Array, Uint8Array, Map, Set, console, postMessage: m => out.push(m) });
  ctx.importScripts = f => vm.runInContext(fs.readFileSync(__dirname + '/' + f, 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(__dirname + '/cfd-furnace-worker.js', 'utf8'), ctx);
  const send = d => { out.length = 0; ctx.onmessage({ data: d }); return out[out.length - 1]; };
  const o = base({ dT: 2 }), es0 = 0.4, h0 = F.fuRun({ ...o, es: es0 }).hMean;
  const a = send({ id: 1, kind: 'fit', what: 'es', o, target: h0 });
  const hFit = a.ok ? F.fuRun({ ...o, es: a.value }).hMean : NaN;
  const b = send({ id: 2, kind: 'fit', what: 'Dgal', o });
  const one = { ...o, runs: o.runs.slice(0, 1) }, idx = D => F.fuRun({ ...one, Dgal: D }).runs[0].peak.idx;
  const bOk = b.ok && idx(b.value) < 1 && idx(b.value * (1 - 1e-3)) >= 1;
  const c = send({ id: 3, kind: 'fit', what: 'es', o, target: 5e-3 });
  check('the worker\'s fits: the way out, the gas-tightness, and a thickness out of reach', a.ok && rel(a.value, es0) < 1e-3 && rel(hFit, h0) < 1e-4 && bOk && !c.ok && /outside/.test(c.error),
    `es ${a.ok ? a.value.toPrecision(5) : a.error} (${es0}); Dgal ${b.ok ? b.value.toExponential(3) : b.error}: run 1 at ${b.ok ? (idx(b.value) * 100).toFixed(2) : '-'} % of its hold; 5 mm: "${c.error}"`);
}

// 15. the piece along itself on its paper (GO-5b): a disc in rings, shrunk, held by friction everywhere slipping --
//     against the exact disc under a uniform outward pull f = τ/h: σr = f (2+ν)(R−r)/3, σθ = f ((2+ν)R − (1+2ν) r)/3,
//     converging as the rings double; stuck all over: far from its edge −E ε/(1−ν) exactly
{
  const R = 0.15, h = 1e-4, E = 1e10, nu = 0.2, eps = -0.01, t = 100, fb = t / h, s0 = fb * (2 + nu) * R / 3, errs = [];
  for (const n of [24, 48, 96]) {
    const r = F.fuPlaneMesh(R, 2 * h, n), P = F.fuPlaneState(r), s = F.fuPlaneStep(P, eps, h, E, nu, 1e14, new Float64Array(r.length).fill(t));
    let e = 0; for (let k = 0; k < s.rm.length; k++) { const m = s.rm[k]; e = Math.max(e, Math.abs(s.sr[k] - fb * (2 + nu) * (R - m) / 3), Math.abs(s.st[k] - fb * ((2 + nu) * R - (1 + 2 * nu) * m) / 3)); }
    errs.push(e / s0);
  }
  const r = F.fuPlaneMesh(R, 2 * h, 48), P = F.fuPlaneState(r), sb = F.fuPlaneStep(P, eps, h, E, nu, E / (1 - nu) / (4 * h), new Float64Array(r.length).fill(Infinity));
  const eb = Math.abs(sb.sr[0] / (-E * eps / (1 - nu)) - 1);
  check('the piece on its paper: slipping against the exact disc, stuck exactly', errs[1] < 1e-2 && errs[2] < errs[1] * 0.7 && eb < 1e-12,
    `slipping ${errs.map(v => v.toExponential(1)).join(' → ')} (24, 48, 96 rings); stuck ${eb.toExponential(1)}`);
}

// 16. through the runs: its natural strain at the end is its water, oxygen and graphitizing's own (the size it would
//     take free); it sticks the step it reaches the temperature set, where pressed; with no hold it carries no pull
{
  const pl = { Ep: 20e9, nu: 0.2, sigF: 100e6, bw: 0.08, bO: 0.03, bG: 0.005, mu: 0.15, Tstick: 2200 + 273.15, tauB: 1e6, am: 0 };
  const o = base({ dT: 2 }), a = F.fuRun({ ...o, plane: pl }), c = F.fuChem(o.chem);
  const epsX = -(pl.bw * o.Xin * a.alpha[0] + pl.bO * (1 - a.O / c.O0) + pl.bG * a.g);
  const h2 = a.hist.filter(q => q.run === 1), first = a.plane.hist.findIndex(q => q.stuck > 0), pre = a.plane.hist[first - 1], at = a.plane.hist[first];
  const b = F.fuRun({ ...o, plane: { ...pl, mu: 0, Tstick: 1e9 } }), bMax = Math.max(...b.plane.hist.map(q => Math.abs(q.s1)));
  check('through the runs: its size free, when it sticks, no hold no pull', Math.abs(a.plane.size.free - epsX) < 1e-12 && pre.T < pl.Tstick && at.T >= pl.Tstick && a.plane.stuckFrac > 0 && bMax < 1e-9 * pl.Ep * Math.abs(epsX) && h2.length > 0,
    `free ${(a.plane.size.free * 100).toFixed(3)} % (${(epsX * 100).toFixed(3)} %); stuck from ${(at.T - 273.15).toFixed(1)} °C (${(pre.T - 273.15).toFixed(1)} before), ${(a.plane.stuckFrac * 100).toFixed(0)} % of it; no hold: ${bMax.toExponential(1)} Pa (${(bMax / (pl.Ep * Math.abs(epsX))).toExponential(1)} of E ε)`);
}

console.log(`the defaults: run 1 the gas at ${(r.runs[0].peak.idx * 100).toFixed(1)} % of its hold; run 2 puffs from ${(r.runs[1].puffAt.T - 273.15).toFixed(0)} °C; ${(r.hMean * 1e6).toFixed(1)} µm (${(r.hMean / 90e-6).toFixed(3)}×), ${r.rho.toFixed(0)} kg/m³, ${(r.kept * 100).toFixed(1)} % kept, g ${r.g.toFixed(3)}, La ${r.La.toFixed(0)} nm, ${r.kappa.toFixed(0)} W/(m K)`);
console.log(fails ? `${fails} FAILED` : 'all passed');
if (typeof process !== 'undefined') process.exitCode = fails ? 1 : 0;
