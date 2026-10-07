'use strict';
/*
 * roll3-mp.validate.js — MP-PEEL 3D's checks (roll3-mp.js): the roll in 3D, its heat and water at rest, against
 * independent solutions.
 *  1. Along the roll's width alone (the outer turn sealed, the ends held): Crank's slab series.
 *  2. Out through the turns alone (the ends sealed): an independent fine radial finite-volume solve.
 *  3. The roll's own water (the GAB isotherm, its vapour through the turns), the ends sealed: the 1D roll (peel-mp.js's
 *     pmpRoll, finite volumes) -- its mean water through the time on the roll.
 *  4. Its heat, the ends sealed: the 1D roll's mean temperature through the time.
 *  5. Everything sealed: the water and the heat stay as they were (nothing made or lost).
 *  6. GO's own water (its C with temperature): sealed it stays as wound; at a steady temperature, the isotherm there.
 *  7. The app's roll at its defaults: every step converges, the same answer however hard each iteration is damped.
 */
const R = require('../engine/roll3-mp.js'), P = require('../engine/peel-mp.js'), { drPsat } = require('../engine/drying.js');
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
const pct = v => `${(v * 100).toFixed(3)} %`;
const heat0 = { T0: 20, k: 0.2, kIn: 2, rhoc: 1.5e6, hOut: 8, Troom: 20 };

// 1. along the width: Crank's slab
{
  const c = 1e-3, Kz = 1e-9, W = 0.1, l = W / 2, D = Kz / c, tEnd = 0.6 * l * l / D;
  const r = R.r3Run({ R0: 0.038, n: 100, h: 1e-4, W, heat: heat0, water: { Kv: 1e-12, KvIn: Kz }, tEnd, steps: 120, mesh: { nr: 3, nth: 2, nz: 40 }, linear: { c, pOut: 1 }, p0: 0, check: { outer: 'sealed' } });
  let e = 0;
  for (const q of r.hist) { if (!(q.t > tEnd * 0.02)) continue; let S = 0; for (let k = 0; k < 200; k++) { const m = 2 * k + 1; S += 8 / (m * m * Math.PI * Math.PI) * Math.exp(-D * m * m * Math.PI * Math.PI * q.t / (4 * l * l)); } e = Math.max(e, Math.abs(q.Xmean / c - (1 - S))); }
  check('along the roll\'s width (the outer turn sealed, its ends held): its mean against Crank\'s slab series', e < 5e-3, `largest difference ${pct(e)} of the change (from 2 % of the time on)`);
}
// 2. out through the turns: a fine radial finite-volume solve
{
  const R0 = 0.038, n = 100, h = 1e-4, R1 = R0 + n * h, c = 1e-3, Dr = 1e-12, tEnd = 3600 * 24 * 8;
  const r = R.r3Run({ R0, n, h, W: 0.1, heat: heat0, water: { Kv: Dr, KvIn: 1e-9 }, tEnd, steps: 160, mesh: { nr: 24, nth: 8, nz: 2 }, linear: { c, pOut: 1 }, p0: 0, check: { ends: 'sealed' } });
  const N = 400, dr = (R1 - R0) / N, rc = Array.from({ length: N }, (_, i) => R0 + (i + 0.5) * dr);
  const tri = (a, b, cc, d) => { const m = d.length, cp = new Float64Array(m), dp = new Float64Array(m); cp[0] = cc[0] / b[0]; dp[0] = d[0] / b[0]; for (let i = 1; i < m; i++) { const q = b[i] - a[i] * cp[i - 1]; cp[i] = cc[i] / q; dp[i] = (d[i] - a[i] * dp[i - 1]) / q; } const x = new Float64Array(m); x[m - 1] = dp[m - 1]; for (let i = m - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1]; return x; };
  let pk = new Float64Array(N), e = 0;
  for (let k = 1; k < r.hist.length; k++) {
    const sub = 40, dts = (r.hist[k].t - r.hist[k - 1].t) / sub;
    for (let s = 0; s < sub; s++) {
      const a = new Float64Array(N), b = new Float64Array(N), cc = new Float64Array(N), d = new Float64Array(N);
      for (let i = 0; i < N; i++) { const V = rc[i] * dr; b[i] = c * V / dts; d[i] = c * V / dts * pk[i];
        if (i > 0) { const g = Dr * (R0 + i * dr) / dr; a[i] = -g; b[i] += g; }
        if (i < N - 1) { const g = Dr * (R0 + (i + 1) * dr) / dr; cc[i] = -g; b[i] += g; } else { const g = Dr * R1 / (dr / 2); b[i] += g; d[i] += g; } }
      pk = tri(a, b, cc, d);
    }
    let m = 0, V = 0; for (let i = 0; i < N; i++) { m += pk[i] * rc[i]; V += rc[i]; }
    if (r.hist[k].t > tEnd * 0.05) e = Math.max(e, Math.abs(r.hist[k].Xmean / c - m / V));
  }
  check('out through the turns (the ends sealed): its mean against a fine radial finite-volume solve', e < 0.01, `largest difference ${pct(e)} of the change (from 5 % of the time on)`);
}
// 3., 4. the roll's own: water and heat against the 1D roll
{
  const gab = { Xm: 0.06, C: 10, K: 0.8 }, R0 = 0.038, n = 300, h = 16e-6, tEnd = 3600 * 24;
  const heat = { T0: 30, k: 0.2, kIn: 2, rhoc: 1.5e6, hOut: 8, Troom: 20 }, water = { X0: 0.12, gab, Xcap: 0.5, rhoD: 1500, Kv: 2e-15, KvIn: 2e-10, rhRoom: 0.5 };
  const one = P.pmpRoll({ R0, core: { E: 3e9, nu: 0.3, Ri: R0 - 0.01 }, h, n, per: 1, Tw: 0, Er: 2e7, Eth: 5e9, nuTr: 0, tEnd, steps: 4000, heat: { T0: heat.T0, k: heat.k, rhoc: heat.rhoc, hOut: heat.hOut, Troom: heat.Troom }, water: { X0: water.X0, gab, Xcap: water.Xcap, rhoD: water.rhoD, Kv: water.Kv, rhRoom: water.rhRoom } });
  const three = R.r3Run({ R0, n, h, W: 0.62, heat, water, tEnd, steps: 200, mesh: { nr: 40, nth: 4, nz: 2, gr: 100 }, check: { ends: 'sealed' } });
  const at = (hist, t, k) => { for (let i = 1; i < hist.length; i++) if (hist[i].t >= t) { const a = hist[i - 1], b = hist[i], f = (t - a.t) / (b.t - a.t); return a[k] + f * (b[k] - a[k]); } return hist[hist.length - 1][k]; };
  // (the 1D holds the room's humidity half a turn in from the outer turn's face, the 3D at its face: they may differ by
  //  the water half a turn can give up, (1/2n) (X₀ − X_room))
  const Xroom = R.r3GAB(water.rhRoom, gab), half = Math.abs(water.X0 - Xroom) / (2 * n);
  let ex = 0, et = 0; const dT = Math.abs(heat.T0 - heat.Troom);
  for (const f of [0.01, 0.05, 0.1, 0.2, 0.5, 1]) { const t = f * tEnd; ex = Math.max(ex, Math.abs(at(three.hist, t, 'Xmean') - at(one.hist, t, 'X'))); et = Math.max(et, Math.abs(at(three.hist, t, 'Tmean') - at(one.hist, t, 'T')) / dT); }
  check('the roll\'s own water (GAB, its vapour through the turns), its ends sealed: the 3D\'s mean against the 1D roll\'s, within the water half a turn gives up', ex < half, `largest difference ${ex.toExponential(2)} kg/kg against ${half.toExponential(2)} (the 1D's change ${(water.X0 - one.hist[one.hist.length - 1].X).toExponential(2)} over ${tEnd / 3600} h)`);
  check('its heat, the ends sealed: the 3D\'s mean temperature against the 1D roll\'s', et < 0.015, `largest difference ${pct(et)} of the ${dT} K`);
}
// 5. sealed: nothing made or lost
{
  const water = { X0: 0.1, gab: { Xm: 0.06, C: 10, K: 0.8 }, Xcap: 0.5, rhoD: 1500, Kv: 2e-15, KvIn: 2e-10, rhRoom: 0.5 };
  const r = R.r3Run({ R0: 0.038, n: 300, h: 16e-6, W: 0.2, heat: { ...heat0, T0: 30 }, water, tEnd: 3600, steps: 20, mesh: { nr: 6, nth: 2, nz: 4 }, check: { ends: 'sealed', outer: 'sealed' } });
  const x0 = r.hist[0].Xmean, x1 = r.hist[r.hist.length - 1].Xmean, t1 = r.hist[r.hist.length - 1].Tmid;
  check('everything sealed: its water and heat stay as they were', Math.abs(x1 - x0) < 1e-9 && Math.abs(t1 - 30) < 1e-6, `water ${x0.toFixed(9)} → ${x1.toFixed(9)}, temperature 30 → ${t1.toFixed(6)} °C`);
}
// 6. GO's own water (2c): its C at the local temperature (H_c), no pore cap -- sealed at 50 °C its water stays as wound
//    (its vapour from the isotherm at 50 °C and back); at a steady 40 °C it is the isotherm with its C at 40 °C
{
  const g2 = { Xm: 0.115, C: 200, K: 0.885, T0: 25, Hc: 20000 }, C40 = 200 * Math.exp(20000 / 8.314462618 * (1 / (40 + 273.15) - 1 / (25 + 273.15)));
  const water = { X0: 0.0836, gab: g2, rhoD: 1500, Kv: 2e-15, KvIn: 2e-10, rhRoom: 0.5 };
  const cool = R.r3Run({ R0: 0.038, n: 300, h: 16e-6, W: 0.2, heat: { ...heat0, T0: 50, hOut: 50, Troom: 20 }, water, tEnd: 3600, steps: 20, mesh: { nr: 6, nth: 2, nz: 4 }, check: { ends: 'sealed', outer: 'sealed' } });
  const x0 = cool.hist[0].Xmean, x1 = cool.hist[cool.hist.length - 1].Xmean, t1 = cool.hist[cool.hist.length - 1].Tmid;
  check('GO\'s own water, sealed at 50 °C: its water stays as wound', Math.abs(x1 - x0) < 1e-9 && Math.abs(x0 - 0.0836) < 1e-9 && Math.abs(t1 - 50) < 1e-6, `water ${x0.toFixed(9)} → ${x1.toFixed(9)}, ${t1.toFixed(1)} °C at the end`);
  const at40 = gab => R.r3Run({ R0: 0.038, n: 300, h: 16e-6, W: 0.2, heat: { ...heat0, T0: 40, Troom: 40 }, water: { ...water, gab }, tEnd: 3600 * 6, steps: 20, mesh: { nr: 6, nth: 2, nz: 4 } });
  const a = at40(g2), b = at40({ Xm: 0.115, C: C40, K: 0.885 });
  const d = Math.max(...a.hist.map((q, i) => Math.abs(q.Xmean - b.hist[i].Xmean)));
  check('  at a steady 40 °C, open to the room: the isotherm with H_c is the isotherm with its C at 40 °C', d < 1e-10, `${d.toExponential(1)} kg/kg; its mean water ${(x0 * 100).toFixed(2)} → ${(a.hist[a.hist.length - 1].Xmean * 100).toFixed(2)} %`);
}
// 7. The app's roll at its defaults (GO's own water: steep where the wound film starts, 8.4 %; the room's air at 50 % takes
//    its ends toward 20 %, along the turns): every step converges, and the answer is the same however hard each iteration
//    is damped; without the damping the first steps' iterations run away (the isotherm's slope at 8.4 % overstates the
//    water a rise to the room's vapour brings, and so the heat it gives off)
{
  const gab = { Xm: 0.115, C: 200, K: 0.885, T0: 25, Hc: 20000 };
  const base = { R0: 0.038, n: 387, h: 15.93e-6, W: 0.62, heat: { T0: 25, k: 0.2, kIn: 1, rhoc: 1372750, hOut: 8, Troom: 25 },
    water: { X0: 0.0836, gab, rhoD: 1615, Kv: 1e-12, KvIn: 3e-7, rhRoom: 0.5 }, tEnd: 3600 * 6, steps: 40, latent: true,
    mesh: { nr: 10, gr: 50, nth: 2, nz: 8, gz: 20 } };
  const a = R.r3Run(base), b = R.r3Run({ ...base, limit: { dT: 1, dp: 50 }, iters: 300 });
  const la = a.hist[a.hist.length - 1], lb = b.hist[b.hist.length - 1], Xroom = R.r3GAB(0.5, gab, 25);
  const d = Math.max(...a.hist.map((q, i) => Math.max(Math.abs(q.Xmean - b.hist[i].Xmean), Math.abs(q.Xend - b.hist[i].Xend), Math.abs(q.Tend - b.hist[i].Tend) / 100)));
  const Tlo = Math.min(...a.hist.map(q => Math.min(q.Tmid, q.Tend))), Thi = Math.max(...a.hist.map(q => Math.max(q.Tmid, q.Tend)));
  // (the most the water taken up could warm the film, all its heat kept: L ΔX ρ / ρc)
  const Tad = 25 + 2.44e6 * (Xroom - 0.0836) * 1615 / 1372750;
  check('the app\'s roll at its defaults, open to the room: every step converges', a.unconverged === 0 && b.unconverged === 0, `${a.steps} steps; its mean water ${(la.Xmean * 100).toFixed(2)} %, its end ${(la.Xend * 100).toFixed(2)} % (the room's ${(Xroom * 100).toFixed(2)} %) after 6 h`);
  check('  the same answer damped at 5 K / 200 Pa and at 1 K / 50 Pa an iteration', d < 1e-8, `largest difference ${d.toExponential(1)}`);
  check('  its temperature between the room\'s and the most the water taken up could give', Tlo > 25 - 1e-6 && Thi < Tad && la.Xend > 0.0836 && la.Xend <= Xroom + 1e-9, `${Tlo.toFixed(2)}–${Thi.toFixed(2)} °C, under ${Tad.toFixed(0)} °C`);
  let undamped = null; try { const c = R.r3Run({ ...base, limit: null }); undamped = c.unconverged ? `${c.unconverged} steps unconverged` : 'converged'; } catch (e) { undamped = e.message; }
  check('  without the damping it does not solve (why it is there)', undamped !== 'converged', undamped);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
