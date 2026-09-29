/*
 * furnace.validate.js — checks of furnace.js (the GO pieces in the furnace: the film's chemistry by stages, the gas
 * through the film and along the graphite paper, the pieces puffing up) against exact solutions and balances.
 * Run: node furnace.validate.js
 */
const F = require('/tmp/claude-0/-home-user-coater/a1700de6-6e45-52d3-83d5-d59c0c809046/scratchpad/go7c_wt/furnace.js');
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

// 21. sticking needs pressure (GO-7c): at 0 the pieces stick wherever pressed, as before, bit for bit; with a room the
//     stack does not fill, each piece is pressed by the weight above it, so a pressure between the top's and the bottom's
//     leaves the top free and sticks the bottom, the thickness untouched (sticking does not act back on the gas); with a
//     room it fills, the holder's squeeze presses every piece alike and the pieces cannot be told apart
{
  const pl = { Ep: 20e9, nu: 0.2, sigF: 100e6, bw: 0.08, bO: 0.03, bG: 0.005, mu: 0.15, Tstick: 1800 + 273.15, tauB: 1e6, am: 0, faces: 2 };
  const P3 = [{ m: 0, w: 1 }, { m: 10, w: 4 }, { m: 19, w: 1 }];
  const o = base({ dT: 2, plateP: 600, gap: 1, positions: P3 }), a = F.fuRun({ ...o, plane: pl }), z = F.fuRun({ ...o, plane: { ...pl, pStick: 0 } });
  const same = a.pos.every((q, i) => q.hMean === z.pos[i].hMean && q.plane.ratioMax === z.pos[i].plane.ratioMax && q.plane.stuckFrac === z.pos[i].plane.stuckFrac);
  const [t, , b] = a.pos, up = a.pos.every((q, i) => i === 0 || q.plane.pcHalf > a.pos[i - 1].plane.pcHalf);
  const pS = (t.plane.pcHotMax + b.plane.pcHalf) / 2, s = F.fuRun({ ...o, plane: { ...pl, pStick: pS } });
  const split = t.plane.pcHotMax < b.plane.pcHalf && s.pos[0].plane.stuckFrac === 0 && s.pos[2].plane.stuckFrac >= 0.5 && s.pos.every((q, i) => q.hMean === a.pos[i].hMean);
  const j = F.fuRun({ ...o, gap: 0.2e-3, plane: pl }), jam = j.squeeze.max > 0 && a.squeeze.max === 0
    && Math.max(...j.pos.map(q => q.plane.pcHalf)) / Math.min(...j.pos.map(q => q.plane.pcHalf)) < 1.01;
  check('sticking needs pressure: at 0 as before; the top free and the bottom stuck between their weights; a filled room presses all alike', same && up && split && jam,
    `pressed once hot (half its area) ${a.pos.map(q => (q.plane.pcHalf / 1e3).toFixed(2)).join(', ')} kPa; from ${(pS / 1e3).toFixed(2)} kPa stuck ${s.pos.map(q => (q.plane.stuckFrac * 100).toFixed(0) + ' %').join(', ')}; the room filled: squeezed ${(j.squeeze.max / 1e6).toFixed(2)} MPa, pressed ${j.pos.map(q => (q.plane.pcHalf / 1e6).toFixed(3)).join(', ')} MPa`);
}

console.log(fails ? 'FAILED' : 'ok');