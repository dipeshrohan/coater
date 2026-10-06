/*
 * press.validate.js — checks of press.js (the cut pieces pressed in a stack: their water through the pre heat treatment and
 * after it, the stress each holds flat, the creep that eases it) against exact solutions. Run: node press.validate.js
 */
const P = require('./press.js'), S = require('./sheet.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const gab = { Xm: 0.07, C: 8, K: 0.8 };
const meanOf = (r, X = r.X) => { let s = 0; for (let k = 0; k < X.length; k++) s += X[k] * r.wx[k % r.nx] * r.wy[Math.floor(k / r.nx)]; return s / r.area; };

// 1. the isotherm turned round: the activity at the water GAB gives is the activity; 1 at and past saturation's water
{
  let e = 0; for (let a = 0.01; a < 1; a += 0.0137) e = Math.max(e, Math.abs(P.prActivity(P.prGAB(a, gab), gab) - a));
  const Xs = P.prGAB(1, gab), slope = (P.prGAB(0.4 + 1e-6, gab) - P.prGAB(0.4 - 1e-6, gab)) / 2e-6;
  check('the isotherm turned round gives the activity back', e < 1e-12 && P.prActivity(Xs * 1.2, gab) === 1 && rel(P.prGABslope(0.4, gab), slope) < 1e-7, `worst ${e.toExponential(1)}; slope ${P.prGABslope(0.4, gab).toFixed(5)} (${slope.toFixed(5)})`);
}

// 2. a constant diffusivity: the square's water against the exact series (a product of the two strips')
{
  const L = 0.3, l = L / 2, D = 2e-7, t = 5400;
  const ser = (x, tt) => { let s = 0; for (let n = 0; n < 400; n++) { const m = 2 * n + 1; s += 4 * (n % 2 ? -1 : 1) / (m * Math.PI) * Math.cos(m * Math.PI * x / (2 * l)) * Math.exp(-m * m * Math.PI * Math.PI * D * tt / (4 * l * l)); } return s; };
  const serMean = tt => { let s = 0; for (let n = 0; n < 400; n++) { const m = 2 * n + 1; s += 8 / (m * m * Math.PI * Math.PI) * Math.exp(-m * m * Math.PI * Math.PI * D * tt / (4 * l * l)); } return s; };
  const out = [];
  for (const [n, gr] of [[20, 1], [40, 1], [30, 8]]) {
    const r = P.prDry({ Lx: L, Ly: L, nx: n, ny: n, grade: gr, X0: 1, D, XEdge: 0, tEnd: t, steps: 100 });
    let emax = 0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) emax = Math.max(emax, Math.abs(r.X[j * n + i] - ser(r.cx[i], t) * ser(r.cy[j], t)));
    out.push({ n, gr, e: rel(meanOf(r), serMean(t) ** 2), emax, bal: r.lost / ((1 - meanOf(r)) * r.area) });
  }
  check('a constant diffusivity: the water against the exact series, converging', out[1].e < out[0].e / 3 && out[1].e < 1e-3 && out[2].e < 1e-3 && out[2].emax < 1e-3,
    out.map(q => `${q.n}${q.gr > 1 ? ' graded' : ''}: mean ${(q.e * 100).toFixed(3)} %, worst cell ${q.emax.toExponential(1)}`).join('; '));
  check('the water lost through the edges is the water gone', out.every(q => Math.abs(q.bal - 1) < 1e-9), out.map(q => q.bal.toFixed(10)).join(', '));
}

// 3. the isotherm's drying and, after it, the water coming back from the room: both balanced, the steps converged
{
  const o = { Lx: 0.3, Ly: 0.3, nx: 30, ny: 30, grade: 40, X0: 0.082, aEdge: 0.0156, psat: 101325, K: 3e-8, rhoS: 1615, gab, tEnd: 5400 };
  const a = P.prDry({ ...o, steps: 100 }), a4 = P.prDry({ ...o, steps: 400 });
  const b = P.prDry({ ...o, X0: a.X, aEdge: 0.5, psat: 3169, steps: 100 });
  const balA = a.lost / ((0.082 - meanOf(a)) * a.area), balB = b.lost / ((meanOf(a) - meanOf(b)) * b.area);
  check('the drying and the water coming back: each balanced at the edges', Math.abs(balA - 1) < 1e-6 && Math.abs(balB - 1) < 1e-6, `${balA.toFixed(8)}, ${balB.toFixed(8)} (mean ${(meanOf(a) * 100).toFixed(3)} % then ${(meanOf(b) * 100).toFixed(3)} %)`);
  let e = 0; for (let k = 0; k < a.X.length; k++) e = Math.max(e, Math.abs(a.X[k] - a4.X[k]));
  check('the time steps: 100 against 400', e < 2e-4 * 0.082, `worst cell ${(e / 0.082 * 100).toFixed(4)} % of the water`);
  check('the water coming back: the edges at the room\'s, the middle still dry', rel(b.X[b.X.length - 1], P.prGAB(0.5, gab)) < 0.1 && b.X[0] < 0.01, `edge cell ${(b.X[b.X.length - 1] * 100).toFixed(2)} % (the room's ${(P.prGAB(0.5, gab) * 100).toFixed(2)} %), middle ${(b.X[0] * 100).toFixed(2)} %`);
}

// the stack's plate for the checks: A constant, the natural stretch steep in the water (so a tiny spread of water, and
// with it the creep's rate, gives a finite stress), no curl
const A = 4.8e6, X0 = 0.08, slope = 1000;
const tab = [[X0 - 0.01, A, 1, -slope * 0.01, 0], [X0 + 0.01, A, 1, slope * 0.01, 0]];
const still = (Lx, Ly, nx, ny, f) => { const wx = P.prWidths(Lx / 2, nx, 1), wy = P.prWidths(Ly / 2, ny, 1); const X = new Float64Array(nx * ny); for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) X[j * nx + i] = X0 + f((i + 0.5) * wx[0], (j + 0.5) * wy[0]); return X; };

// 4. held flat, a long strip with its natural stretch changing across it: at its middle Nx = A (ē − e(y)), Ny = 0
{
  const Lx = 1.2, Ly = 0.2, nx = 60, ny = 20, dX = 1e-6;
  // (the water across: a half cosine, the edges at the pieces' own water as the cells' edges are)
  const Xs = still(Lx, Ly, nx, ny, (x, y) => dX * Math.cos(Math.PI * y / Ly));
  const r = P.prPress({ Lx, Ly, nx, ny, grade: 1, X0, Xstart: Xs, rhoS: 1615, gab, K: 0, tab, nu: 0.3, tau: Infinity, n: 12, pgrade: 1, stages: [{ tEnd: 60, psat: 3169, aEdge: P.prActivity(X0, gab), creep: false, steps: 4 }] });
  const st = r.stages[0];
  // (the Gauss points of the column of elements at the middle, x < Lx / 24: the natural stretch there, its mean across)
  const pts = r.G.map(([x, y], g) => ({ x, y, g })).filter(q => q.x < Lx / 24);
  const e = q => P.prProps(tab, st.Xg[q.g])[3];
  // (ē: the stretch's mean across the strip -- A constant -- over the middle column of elements, by their Gauss rule)
  let ebar = 0, wsum = 0;
  r.m.els.forEach((el, k) => { if (el.i) return; S.shShapes(r.m, el.a, el.b).forEach((q, j) => { ebar += q.wq * e({ g: 16 * k + j }); wsum += q.wq; }); });
  ebar /= wsum;
  let worst = 0, big = 0, ny0 = 0;
  for (const q of pts) { const ex = A * (ebar - e(q)); worst = Math.max(worst, Math.abs(st.N[3 * q.g] - ex)); big = Math.max(big, Math.abs(ex)); ny0 = Math.max(ny0, Math.abs(st.N[3 * q.g + 1])); }
  check('held flat, a long strip\'s stress across it: Nx = A (ē − e), Ny = 0', worst < 1e-3 * big && ny0 < 1e-3 * big, `worst ${(worst / big * 100).toFixed(3)} % of the largest (${(big / 1e3).toFixed(3)} kN/m); Ny ${(ny0 / big * 100).toFixed(3)} %`);
}

// 5. the creep: a stress held (no water moving) relaxes as e^(−t/τ); dry, it does not creep
{
  const Lx = 0.3, Ly = 0.3, nx = 12, ny = 12, dX = 1e-6, tau = 1800, T = 5400;
  const f = (x, y) => dX * Math.cos(Math.PI * x / Lx) * Math.cos(Math.PI * y / Ly);
  const run = (tauv, X0v) => P.prPress({ Lx, Ly, nx, ny, grade: 1, X0: X0v, Xstart: still(Lx, Ly, nx, ny, f).map(v => v - X0 + X0v), rhoS: 1615, gab, K: 0, tab: tab.map(r => [r[0] - X0 + X0v, ...r.slice(1)]), nu: 0.3, tau: tauv, n: 8, pgrade: 1, stages: [{ tEnd: T, psat: 3169, aEdge: P.prActivity(X0v, gab), creep: true, steps: 100 }] });
  const el = run(Infinity, X0), cr = run(tau, X0);
  const N0 = el.hist[el.hist.length - 1].N, ratios = cr.hist.map(q => [q.t, q.N / N0]);
  let worst = 0; for (const [t, v] of ratios) worst = Math.max(worst, Math.abs(v - Math.exp(-t / tau)));
  check('a stress held relaxes as e^(−t/τ)', worst < 2e-3, `at ${T / tau} τ: ${ratios[ratios.length - 1][1].toFixed(5)} (${Math.exp(-T / tau).toFixed(5)}); worst ${worst.toExponential(1)} over the steps`);
  // (the creep's rate goes as the water: at a thousandth of the water it creeps a thousand times slower)
  const dryX = X0 / 1000, dr = P.prPress({ Lx, Ly, nx, ny, grade: 1, X0, Xstart: still(Lx, Ly, nx, ny, f).map(v => v - X0 + dryX), rhoS: 1615, gab, K: 0, tab: [[dryX - 0.01, A, 1, -slope * 0.01, 0], [dryX + 0.01, A, 1, slope * 0.01, 0]], nu: 0.3, tau, n: 8, pgrade: 1, stages: [{ tEnd: T, psat: 3169, aEdge: P.prActivity(dryX, gab), creep: true, steps: 100 }] });
  const rd = dr.hist[dr.hist.length - 1].N / dr.hist[0].N;
  check('its rate goes as the water (a thousandth as fast at a thousandth of it)', Math.abs(rd - Math.exp(-T / tau / 1000)) < 1e-5, `${rd.toFixed(7)} (${Math.exp(-T / tau / 1000).toFixed(7)})`);
  // (the creep off -- the stage under the plate after the oven -- holds the stress)
  const off = P.prPress({ Lx, Ly, nx, ny, grade: 1, X0, Xstart: still(Lx, Ly, nx, ny, f), rhoS: 1615, gab, K: 0, tab, nu: 0.3, tau, n: 8, pgrade: 1, stages: [{ tEnd: T, psat: 3169, aEdge: P.prActivity(X0, gab), creep: false, steps: 20 }] });
  check('with the creep off the stress holds', rel(off.hist[off.hist.length - 1].N, N0) < 1e-9, `${(off.hist[off.hist.length - 1].N / 1e3).toFixed(6)} vs ${(N0 / 1e3).toFixed(6)} kN/m`);
}

// GO's own water at the stage's temperature (2c): the isotherm's C as exp(Hc/R (1/T − 1/T0)) -- by hand -- and the
// drying with T and Hc the same, to the last bit, as with that C and no T; Hc 0 or no T: the isotherm as it is
{
  const g2 = { Xm: 0.115, C: 200, K: 0.885, T0: 25, Hc: 20000 }, T = 100, Ch = 200 * Math.exp(20000 / 8.314462618 * (1 / 373.15 - 1 / 298.15));
  const gT = P.prGabAt(g2, T), hand = { Xm: 0.115, C: Ch, K: 0.885 };
  check('the isotherm at 100 °C: C × exp(H_c/R (1/T − 1/T₀)) by hand; less water than at 25 °C at the same humidity; H_c 0 or no T: as it is',
    rel(gT.C, Ch) < 1e-12 && P.prGAB(0.0156, gT) < P.prGAB(0.0156, g2) && P.prGabAt({ ...g2, Hc: 0 }, T).C === 200 && P.prGabAt(g2).C === 200,
    `C ${gT.C.toFixed(2)} (at 25 °C 200); X at 1.56 % ${(P.prGAB(0.0156, gT) * 100).toFixed(2)} % vs ${(P.prGAB(0.0156, g2) * 100).toFixed(2)} %`);
  const run = gg => P.prDry({ Lx: 0.3, Ly: 0.3, nx: 12, ny: 12, grade: 20, X0: 0.205, aEdge: 0.0156, psat: 101325, T: gg === g2 ? T : undefined, K: 3e-7, rhoS: 1500, gab: gg, tEnd: 3600, steps: 40 });
  const a = run(g2), b = run(hand);
  let d = 0; for (let k = 0; k < a.X.length; k++) d = Math.max(d, Math.abs(a.X[k] - b.X[k]));
  check('  the pressed piece dried at 100 °C with T and H_c: the same, to the last bit, as with that C', d === 0, `largest difference ${d}; mean water at the end ${(meanOf(a) * 100).toFixed(2)} %`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
if (typeof process !== 'undefined') process.exitCode = fails ? 1 : 0;
