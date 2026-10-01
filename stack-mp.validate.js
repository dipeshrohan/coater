/*
 * stack-mp.validate.js — checks of stack-mp.js (MP-1: the pressed stack in 1D, 2D and 3D, heat, water and stress together):
 * at the air's temperature it is press.js; its dimensions agree where they must; its heat and water balance; held
 * flat and even, a piece holds no stress. Run: node stack-mp.validate.js
 */
const S = require('./stack-mp.js'), P = require('./press.js'), DR = require('./drying.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const fmt = x => x.toExponential(2);

// a film like the app's (its rows by water: the stretch stiffness softer and the natural stretch larger as it holds more)
const tab = [0, 0.05, 0.1, 0.15, 0.2, 0.3].map(X => [X, 7.2e6 * (1 - 1.5 * X), 1, 0.15 * X, 0]);
const gab = { Xm: 0.07, C: 8, K: 0.8 };
const go = { kIn: 1, kThr: 0.2, c: 850, rhoS: 1500, gab, Xcap: 0.3, K: 3e-7, Kthr: 1e-12, alpha: 0, nu: 0.17, tab, tau: 600 };
const base = { Lx: 0.3, Ly: 0.3, N: 20, h: 360e-6, plateT: 0.0378, X0: 0.15, Troom: 22, rhRoom: 0.5, XdryTo: 0.02,
  stages: [{ tEnd: 5400, Tair: 100, creep: true }, { tEnd: 5400, Tair: 22, creep: false }], air: { fan: 0 }, shelf: 'wire', epsPlate: 0.09, epsGO: 0.9, go,
  mesh: { nx: 8, ny: 8, grade: 10 }, steps: 30 };

// 1. at the air's temperature all through (no heat solved), sealed below: a piece's water is press.js's -- the square (3D)
//    and a long strip (2D against press.js's piece 20 times longer than wide, along its middle line)
{
  const tEnd = 1800, Tair = 100;
  const psat = DR.drPsat(Tair), aEdge = base.rhRoom * DR.drPsat(base.Troom) / psat;
  const pr = (Lx, Ly) => P.prDry({ Lx, Ly, nx: 40, ny: 40, grade: 40, X0: base.X0, aEdge, psat, K: go.K, rhoS: go.rhoS, gab, Xcap: go.Xcap, tEnd, steps: 200, saveAt: [120, 600, 1800] });
  const meanPr = (r, X) => { let s = 0; for (let k = 0; k < X.length; k++) s += X[k] * r.wx[k % r.nx] * r.wy[Math.floor(k / r.nx)]; return s / r.area; };
  const p3 = pr(base.Lx, base.Ly), p2 = pr(base.Lx, base.Lx * 20);
  const common = { ...base, N: 2, plateT: 0.002, shelf: 'solid', isothermal: true, stages: [{ tEnd, Tair, creep: false }], steps: 60, go: { ...go, Kthr: 1e-16 } };
  // (the fields at press.js's own saved times)
  const r3 = S.smpStack({ ...common, dim: 3, mesh: { nx: 16, ny: 16, grade: 20 }, snapTimes: p3.saved.map(v => v.t) });
  const e3 = p3.saved.map(sv => { const s = r3.series.find(q => Math.abs(q.t - sv.t) < 1e-6); return [s.X[0][0], meanPr(p3, sv.X), sv.t]; });
  check('at the air\'s temperature (3D): a piece\'s mean water is press.js\'s', e3.every(([a, b]) => rel(a, b) < 0.02), e3.map(([a, b, t]) => `${(t / 60).toFixed(0)} min ${a.toFixed(4)} / ${b.toFixed(4)}`).join(', '));
  // the strip: its water along x against press.js's long piece along its middle line
  const r2 = S.smpStack({ ...common, dim: 2, mesh: { nx: 30, grade: 20 }, snapTimes: p2.saved.map(v => v.t) });
  const samp = P.prSampler(p2, base.Lx, base.Lx * 20);
  const e2 = p2.saved.map(sv => { const sn = r2.snaps.find(q => Math.abs(q.t - sv.t) < 1e-6); const Xs = sn.pieces[0].X, xs = r2.mesh.stressCoord[0];
    let e = 0; xs.forEach((x, i) => { e = Math.max(e, Math.abs(Xs[i] - samp(sv.X, x, 0))); }); return e; });
  check('at the air\'s temperature (2D): the strip\'s water along it is press.js\'s long piece\'s', e2.every(e => e < 0.004), e2.map(e => e.toFixed(4)).join(', ') + ' kg/kg at worst');
}

// 2. the dimensions agree: with its sides sealed and insulated, the 2D and the 3D are the 1D (nothing varies across)
{
  const o = { ...base, sides: false, stages: [{ tEnd: 3600, Tair: 100, creep: true }], steps: 20 };
  const r1 = S.smpStack({ ...o, dim: 1 }), r2 = S.smpStack({ ...o, dim: 2 }), r3 = S.smpStack({ ...o, dim: 3, mesh: { nx: 3, ny: 3, grade: 1 } });
  let eT = 0, eX = 0;
  for (let k = 0; k < r1.series.length; k++) for (const r of [r2, r3]) {
    for (const f of ['plateTop', 'top', 'mid', 'bottom']) eT = Math.max(eT, Math.abs(r.series[k].T[f] - r1.series[k].T[f]));
    for (const i of r1.follow) eX = Math.max(eX, Math.abs(r.series[k].X[i][0] - r1.series[k].X[i][0]));
  }
  check('sides sealed: the 2D and the 3D are the 1D (temperatures, water)', eT < 1e-6 && eX < 1e-8, `${fmt(eT)} K, ${fmt(eX)} kg/kg`);
}

// 3. the balances, each dimension: the heat in through the faces is the rise of the stack's enthalpy; the water out is the water lost
for (const dim of [1, 2, 3]) {
  const r = S.smpStack({ ...base, dim, steps: dim === 3 ? 12 : 30, tol: 1e-10 });
  const eE = Math.abs(r.energy.in - r.energy.held) / Math.abs(r.energy.in), eW = Math.abs(r.water.out - r.water.lostHeld) / r.water.start;
  check(`${dim}D: the heat in = the enthalpy's rise; the water out = the water lost (step by step)`, eE < 1e-6 && eW < 1e-8, `energy ${fmt(eE)}, water ${fmt(eW)} (${(r.water.lost / r.water.start * 100).toFixed(1)} % lost); ${r.ms} ms`);
}

// 4. held flat and even, a piece holds no stress: its water as the air's (nothing dries), heated evenly
{
  const Xeq = P.prGAB(base.rhRoom, gab);
  const r = S.smpStack({ ...base, dim: 3, X0: Xeq, isothermal: true, stages: [{ tEnd: 600, Tair: 22, creep: true }], steps: 5, mesh: { nx: 4, ny: 4, grade: 4 } });
  const pk = Math.max(...r.series.map(q => Math.max(...Object.values(q.pull).map(Math.abs))));
  check('even water and temperature: no stress in a piece', pk < 1e-6, `${fmt(pk)} MPa`);
  const r2 = S.smpStack({ ...base, dim: 2, X0: Xeq, isothermal: true, stages: [{ tEnd: 600, Tair: 22, creep: true }], steps: 5 });
  const pk2 = Math.max(...r2.series.map(q => Math.max(...Object.values(q.pull).map(Math.abs))));
  check('the same in 2D (the strip)', pk2 < 1e-6, `${fmt(pk2)} MPa`);
}

// 5. the air's coefficients: natural convection on a vertical face against Churchill–Chu's Nu at a known Ra; a fan's flat plate
{
  const air = { fan: 0, pv: 1000, Lfan: 0.3 }, a = DR.drAir(60, 101325), L = 0.05, Ra = 9.80665 / 333.15 * 40 * L ** 3 / (a.nu * a.alpha);
  const Nu = Math.pow(0.825 + 0.387 * Math.pow(Ra, 1 / 6) / Math.pow(1 + Math.pow(0.492 / a.Pr, 9 / 16), 8 / 27), 2);
  const h = S.smpAir('side', 80, 40, L, air).h, hf = S.smpAir('up', 80, 40, L, { ...air, fan: 2 }).h;
  const Re = 2 * 0.3 / a.nu, hfe = 0.664 * Math.sqrt(Re) * Math.cbrt(a.Pr) * a.k / 0.3;
  check('the air: a vertical face (Churchill–Chu) and a fan along the plate (laminar flat plate)', rel(h, Nu * a.k / L) < 1e-12 && rel(hf, hfe) < 1e-12, `${h.toFixed(3)} and ${hf.toFixed(3)} W/(m² K)`);
}

// the plate's aluminium through the inputs (MH-2): given as SMP_AL, the same stack bit for bit; another alloy's, another
{
  const o = { ...base, dim: 1, steps: 8, stages: [{ tEnd: 1800, Tair: 100, creep: true }] };
  const a = S.smpStack(o), b = S.smpStack({ ...o, al: { ...S.SMP_AL } }), c = S.smpStack({ ...o, al: { ...S.SMP_AL, k: 120, c: 960 } });
  const strip = r => JSON.stringify(r, (k, v) => (k === 'ms' || k === 'elapsedMs' ? undefined : v));
  check('the plate\'s aluminium as an input (MH-2): given as SMP_AL, the stack bit for bit as without; another alloy, another stack', strip(a) === strip(b) && strip(c) !== strip(a), `${strip(a).length} chars`);
}

// the GO's and the plate's conductivities and heat capacities in temperature (MH-4b): defined flat at their constants, the
// stack bit for bit as with the constants; rising with temperature, another
{
  const o = { ...base, dim: 1, steps: 8, stages: [{ tEnd: 1800, Tair: 100, creep: true }] }, flat = v => ({ kind: 'table', var: 'T', x: [273.15, 573.15], y: [v, v], extrap: 'clamp' });
  const strip = r => JSON.stringify(r, (k, v) => (k === 'ms' || k === 'elapsedMs' ? undefined : v));
  const a = S.smpStack(o), b = S.smpStack({ ...o, go: { ...go, kInT: flat(go.kIn), kThrT: flat(go.kThr), cT: flat(go.c) }, al: { ...S.SMP_AL, kT: flat(200), cT: flat(900) } });
  const c = S.smpStack({ ...o, go: { ...go, kThrT: { kind: 'table', var: 'T', x: [273.15, 573.15], y: [0.1, 0.6], extrap: 'clamp' } } });
  check('properties in temperature as inputs (MH-4b): flat tables at the constants, the stack bit for bit; a rising k through it, another', strip(a) === strip(b) && strip(c) !== strip(a), `${strip(a).length} chars`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
