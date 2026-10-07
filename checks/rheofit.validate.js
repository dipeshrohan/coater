/*
 * rheofit.validate.js — checks of the rheometer files and the fits (rheofit.js). Run: node rheofit.validate.js
 *  1. Reading: a flow curve written in RheoCompass's export layout (project, test and result lines, "Interval
 *     data:" rows naming the columns, units on the row below, a status column of text) comes back the same
 *     whether tab or semicolon separated, with a decimal point or comma, in UTF-8, UTF-16 (byte-order mark) or
 *     Windows-1252; units to SI (mPa·s, %, Hz); a plain CSV with units in the header too. The kind of test.
 *  2. Flow-curve fits: noise-free curves of each law come back (Newtonian, power law, Herschel–Bulkley,
 *     Carreau–Yasuda, Cross), and the anchor the app keeps (the viscosity at 2.7 1/s); with 2 % scatter, close.
 *  3. Thixotropy test: a 3ITT made by the structure model, written interval by interval with the time
 *     restarting, comes back as one test; its rebuild time, halving shear rate and gain are recovered; with
 *     1 % scatter, close; the yield and viscosity gains apart from a test recovering at two rates.
 *  4. Sweeps: an amplitude sweep's plateau, yield point and flow point; a frequency sweep's crossover
 *     (a Maxwell fluid: at 1 / its relaxation time) and G′, G″ at 1 rad/s.
 */
const R = require('../engine/rheo.js'), F = require('../engine/rheofit.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
const logspace = (a, b, n) => Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const noise = s => Math.exp(s * (rnd() * 2 - 1) * Math.sqrt(3));   // (multiplicative, s the standard deviation of its log)

/** A test written as RheoCompass exports it: intervals of columns [name, unit, values]. */
function rcExport(test, intervals, { sep = '\t', comma = false } = {}) {
  const f = v => { const s = typeof v === 'number' ? (+v.toPrecision(10)).toString() : String(v); return comma ? s.replace('.', ',') : s; };
  const L = [['Project:', 'GO slurry'], ['Test:', test], ['Result:', test + ' 1'], ['Interval and data points:', intervals.length, ...intervals.map(iv => iv[0][2].length)]];
  for (const iv of intervals) {
    L.push(['Interval data:', 'Point No.', ...iv.map(c => c[0]), 'Status']);
    L.push(['', '[]', ...iv.map(c => `[${c[1]}]`), '[]']);
    for (let i = 0; i < iv[0][2].length; i++) L.push(['', i + 1, ...iv.map(c => c[2][i]), 'Dy_auto']);
  }
  return L.map(r => r.map(f).join(sep)).join('\r\n') + '\r\n';
}
const utf16 = s => { const b = Buffer.from('﻿' + s, 'utf16le'); return new Uint8Array(b.buffer, b.byteOffset, b.length); };
const cp1252 = s => Uint8Array.from([...s].map(ch => ch === '·' ? 0xB7 : ch === 'µ' ? 0xB5 : ch.charCodeAt(0)));

// 1. reading
{
  const gd = logspace(0.01, 1000, 21), law = R.rheoCompile(10.5, 5, 0.6), eta = gd.map(g => law.mu(g));
  const cols = [['Time', 's', gd.map((_, i) => 10 * (i + 1))], ['Shear Rate', '1/s', gd], ['Shear Stress', 'Pa', gd.map((g, i) => eta[i] * g)], ['Viscosity', 'mPa·s', eta.map(e => e * 1000)], ['Torque', 'µN·m', gd.map(() => 123.4)]];
  const txt = rcExport('Flow curve', [cols]);
  const same = f => f.kind === 'flow' && f.tables.length === 1 && f.tables[0].n === 21 && f.tables[0].cols.gd.every((v, i) => rel(v, gd[i]) < 1e-9) && f.tables[0].cols.eta.every((v, i) => rel(v, eta[i]) < 1e-9);
  const a = F.rfRead(txt, 'a.txt');
  check('RheoCompass layout, tab, decimal point, UTF-8: a flow curve, 21 points; mPa·s to Pa·s', same(a), `${a.kind}, ${a.tables.length} table, ${a.tables[0] && a.tables[0].n} points; units ${JSON.stringify(a.tables[0] && a.tables[0].units)}`);
  check('  semicolon, decimal comma', same(F.rfRead(rcExport('Flow curve', [cols], { sep: ';', comma: true }))));
  check('  tab, decimal comma, UTF-16 with its byte-order mark', same(F.rfRead(utf16(rcExport('Flow curve', [cols], { comma: true })))));
  check('  Windows-1252 bytes (Pa·s, µN·m)', same(F.rfRead(cp1252(txt))));
  const csv = 'Shear rate (1/s),Shear stress (Pa)\n' + gd.map((g, i) => `${g},${eta[i] * g}`).join('\n');
  const c = F.rfRead(csv);
  check('  a plain CSV with the units in the header; the viscosity from stress / rate', same(c));
  const amp = F.rfRead(rcExport('Amplitude sweep', [[['Shear Strain', '%', [0.01, 0.1, 1, 10]], ['Storage Modulus', 'Pa', [100, 99, 60, 5]], ['Loss Modulus', 'Pa', [10, 11, 30, 20]], ['Angular Frequency', 'rad/s', [10, 10, 10, 10]]]]));
  check('  an amplitude sweep: its kind; strain in % to a fraction', amp.kind === 'amp' && amp.tables[0].cols.strain[2] === 0.01);
  const fq = F.rfRead(rcExport('Frequency sweep', [[['Frequency', 'Hz', [0.1, 1, 10]], ['Storage Modulus', 'Pa', [1, 5, 9]], ['Loss Modulus', 'Pa', [3, 4, 5]], ['Shear Strain', '%', [0.1, 0.1, 0.1]]]]));
  check('  a frequency sweep: its kind; Hz to rad/s', fq.kind === 'freq' && rel(fq.tables[0].cols.omega[1], 2 * Math.PI) < 1e-15);
  const bad = F.rfRead(rcExport('Flow curve', [[['Shear Rate', '1/s', [1, 2]], ['Viscosity', 'furlong', [1, 2]], ['Shear Stress', 'Pa', [1, 4]]]]));
  check('  a unit it does not know: that column left out, a warning', bad.warnings.length === 1 && !('eta' in bad.tables[0].units) && bad.tables[0].cols.eta[1] === 2);
}

// 2. flow-curve fits
{
  const gd = logspace(0.01, 1000, 31);
  const fit = law => F.rfFitFlow(gd, gd.map(g => law.mu(g) * g));
  const hb = fit(R.rheoCompile(10.5, 5, 0.6)).hb;
  check('Herschel–Bulkley back: ty 5, n 0.6, the viscosity at 2.7 1/s 10.5', rel(hb.params.ty, 5) < 1e-5 && rel(hb.params.n, 0.6) < 1e-6 && rel(hb.app.muRef, 10.5) < 1e-6 && hb.rms < 1e-6, `ty ${hb.params.ty.toFixed(5)}, n ${hb.params.n.toFixed(6)}, rms ${hb.rms.toExponential(1)}`);
  const pl = fit(R.rheoCompile(10.5, 0, 0.45)).power;
  check('power law back: n 0.45, anchor 10.5', rel(pl.params.n, 0.45) < 1e-12 && rel(pl.app.muRef, 10.5) < 1e-12);
  const nw = fit(R.rheoCompile(7, 0, 1)).newtonian;
  check('Newtonian back: 7 Pa·s', rel(nw.params.mu, 7) < 1e-12);
  for (const [model, x] of [['carreau', { model: 'carreau', etaInf: 0.02, L: 3, a: 1.5 }], ['cross', { model: 'cross', etaInf: 0.02, L: 3 }]]) {
    const law = R.rheoCompile(10.5, 0, 0.4, x), f = fit(law)[model];
    check(`${model === 'carreau' ? 'Carreau–Yasuda' : 'Cross'} back: eta0, L, ${model === 'carreau' ? 'a, ' : ''}n; anchor 10.5`, rel(f.params.eta0, law.eta0) < 1e-3 && rel(f.params.L, 3) < 1e-3 && (model === 'cross' || rel(f.params.a, 1.5) < 1e-3) && rel(f.params.n, 0.4) < 1e-3 && rel(f.app.muRef, 10.5) < 1e-4 && f.rms < 1e-5,
      `eta0 ${f.params.eta0.toFixed(4)} (${law.eta0.toFixed(4)}), L ${f.params.L.toFixed(4)}, a ${f.params.a.toFixed(3)}, n ${f.params.n.toFixed(4)}, rms ${f.rms.toExponential(1)}`);
  }
  const law = R.rheoCompile(10.5, 5, 0.6), noisy = F.rfFitFlow(gd, gd.map(g => law.mu(g) * g * noise(0.02))).hb;
  check('  with 2 % scatter: Herschel–Bulkley close (n ± 0.03, ty ± 15 %, anchor ± 3 %); its rms about 2 %', Math.abs(noisy.params.n - 0.6) < 0.03 && rel(noisy.params.ty, 5) < 0.15 && rel(noisy.app.muRef, 10.5) < 0.03 && noisy.rms > 0.01 && noisy.rms < 0.03,
    `n ${noisy.params.n.toFixed(3)}, ty ${noisy.params.ty.toFixed(2)}, anchor ${noisy.app.muRef.toFixed(2)}, rms ${(noisy.rms * 100).toFixed(1)} %`);
  // the standard errors: against the scatter of the fitted values over 60 noisy curves (the same 2 %)
  const runs = Array.from({ length: 60 }, () => F.rfFitFlow(gd, gd.map(g => law.mu(g) * g * noise(0.02))).hb);
  const spread = k => { const v = runs.map(q => q.app[k]), mean = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) / Math.abs(mean); };
  const said = k => runs.reduce((a, q) => a + q.err[k], 0) / runs.length;
  const ratios = ['muRef', 'n', 'ty'].map(k => [k, said(k) / spread(k)]);
  check('  its standard errors match the scatter of the fitted values over 60 noisy curves (within a factor 1.5); none loose', ratios.every(([, r]) => r > 1 / 1.5 && r < 1.5) && runs.every(q => q.loose.length === 0),
    ratios.map(([k, r]) => `${k} ${(said(k) * 100).toFixed(2)} % said, ${(spread(k) * 100).toFixed(2)} % seen`).join('; '));
  // a yield-stress curve through the laws without one: their extras not pinned down (loose), the Cross law without a
  const yf = F.rfFitFlow(gd, gd.map(g => law.mu(g) * g * noise(0.02)));
  check('  a yield-stress curve fitted by Carreau–Yasuda and Cross: their time constant loose (no plateau to pin it); no a for Cross', yf.carreau.loose.includes('L') && yf.cross.loose.includes('L') && !('a' in yf.cross.err),
    `Carreau–Yasuda loose: ${yf.carreau.loose.join(', ')}; Cross loose: ${yf.cross.loose.join(', ')}`);
  const cyf = fit(R.rheoCompile(10.5, 0, 0.4, { model: 'carreau', etaInf: 0.02, L: 3, a: 1.5 })).carreau;
  check('  a clean Carreau–Yasuda curve: its values pinned down (none loose)', cyf.loose.length === 0, JSON.stringify(Object.fromEntries(Object.entries(cyf.err).map(([k, v]) => [k, +v.toExponential(1)]))));
}

// 3. thixotropy test
{
  const law = R.rheoCompile(10.5, 5, 0.6), S = { tb: 20, gdc: 0.5, cy: 1.5, ce: 1.5 };
  const ivs = [{ gd: 0.1, dur: 60, n: 30 }, { gd: 100, dur: 30, n: 30 }, { gd: 0.1, dur: 180, n: 90 }];
  const run = R.rheo3ITT(ivs, law, S);
  // (written interval by interval, the time restarting in each, viscosity in mPa·s)
  const cols = [], off = [0, 60, 90];
  ivs.forEach((iv, k) => { const seg = run.filter(q => q.t > off[k] + 1e-9 && q.t <= off[k] + iv.dur + 1e-9); cols.push([['Time', 's', seg.map(q => q.t - off[k])], ['Shear Rate', '1/s', seg.map(q => q.gd)], ['Viscosity', 'mPa·s', seg.map(q => q.eta * 1000)]]); });
  const file = F.rfRead(rcExport('3ITT', cols));
  const pts = F.rf3ITTPoints(file);
  check('3ITT file: three intervals, its kind; the time running on across them', file.kind === '3itt' && file.tables.length === 3 && pts.length === 150 && Math.abs(pts[149].t - 270) < 1e-6 && pts.every((q, i) => !i || q.t > pts[i - 1].t));
  // (the structure starts steady at the first point's rate: the test's own start, one step in, is steady too)
  const f = F.rfFit3ITT(pts, law);
  check('  fitted back: rebuild time 20 s, halving rate 0.5 1/s, gain 1.5', rel(f.S.tb, 20) < 1e-3 && rel(f.S.gdc, 0.5) < 1e-3 && rel(f.S.cy, 1.5) < 1e-3 && f.rms < 1e-5, `tb ${f.S.tb.toFixed(3)} s, gdc ${f.S.gdc.toFixed(4)} 1/s, c ${f.S.cy.toFixed(4)}, rms ${f.rms.toExponential(1)}`);
  const noisy = F.rfFit3ITT(pts.map(q => ({ ...q, eta: q.eta * noise(0.01) })), law);
  const within = k => Math.abs(Math.log(noisy.S[k] / S[k])) < 3 * noisy.err[k];
  check('  with 1 % scatter: each within 3 standard errors of the truth; the curve to about 1 %', ['tb', 'gdc', 'cy'].every(within) && noisy.rms < 0.012,
    `tb ${noisy.S.tb.toFixed(2)} ± ${(noisy.err.tb * 100).toFixed(0)} %, gdc ${noisy.S.gdc.toFixed(3)} ± ${(noisy.err.gdc * 100).toFixed(0)} %, c ${noisy.S.cy.toFixed(3)} ± ${(noisy.err.cy * 100).toFixed(0)} %`);
  check('  one test at one slow rate: the halving rate flagged as not pinned down; the rebuild time and gain are (under 25 %)', noisy.loose.join() === 'gdc' && noisy.err.tb < 0.25 && noisy.err.cy < 0.25, `loose: ${noisy.loose.join(', ')}`);
  const pts3 = R.rheo3ITT([{ gd: 0.1, dur: 60, n: 30 }, { gd: 100, dur: 30, n: 30 }, { gd: 0.1, dur: 180, n: 90 }, { gd: 100, dur: 30, n: 30 }, { gd: 3, dur: 120, n: 60 }], law, S).map(q => ({ t: q.t, gd: q.gd, eta: q.eta * noise(0.01) }));
  const n3 = F.rfFit3ITT(pts3, law);
  check('  recovering at two slow rates too: all three pinned down, within 10 %', !n3.loose.length && rel(n3.S.tb, 20) < 0.1 && rel(n3.S.gdc, 0.5) < 0.1 && rel(n3.S.cy, 1.5) < 0.1, `tb ${n3.S.tb.toFixed(2)}, gdc ${n3.S.gdc.toFixed(3)} ± ${(n3.err.gdc * 100).toFixed(0)} %, c ${n3.S.cy.toFixed(3)}`);
  const S2 = { tb: 20, gdc: 0.5, cy: 3, ce: 1 }, ivs2 = [{ gd: 0.1, dur: 60, n: 30 }, { gd: 100, dur: 30, n: 30 }, { gd: 0.1, dur: 120, n: 60 }, { gd: 100, dur: 30, n: 30 }, { gd: 3, dur: 120, n: 60 }];
  const pts2 = R.rheo3ITT(ivs2, law, S2).map(q => ({ t: q.t, gd: q.gd, eta: q.eta }));
  const f2 = F.rfFit3ITT(pts2, law, { separate: true });
  check('  recovering at two rates: the yield gain 3 and the viscosity gain 1 apart', rel(f2.S.cy, 3) < 1e-2 && rel(f2.S.ce, 1) < 1e-2 && rel(f2.S.tb, 20) < 1e-2, `c_y ${f2.S.cy.toFixed(3)}, c_eta ${f2.S.ce.toFixed(3)}, tb ${f2.S.tb.toFixed(2)}`);
}

// 4. sweeps
{
  const strain = logspace(1e-5, 10, 43), G1 = strain.map(g => 1000 / (1 + (g / 0.01) ** 2)), G2 = strain.map(g => 100 * Math.sqrt(1 + g / 0.01));
  const file = F.rfRead(rcExport('Amplitude sweep', [[['Shear Strain', '%', strain.map(g => g * 100)], ['Storage Modulus', 'Pa', G1], ['Loss Modulus', 'Pa', G2]]]));
  const t = file.tables[0].cols, a = F.rfAmp(t.strain, t.G1, t.G2);
  // (exact: the yield point where 1 / (1 + x^2) = 0.95; the flow point where 1000 / (1 + x^2) = 100 sqrt(1 + x))
  const yEx = 0.01 * Math.sqrt(1 / 0.95 - 1);
  let lo = 0.01, hi = 10; for (let k = 0; k < 200; k++) { const m = Math.sqrt(lo * hi); if (1000 / (1 + (m / 0.01) ** 2) > 100 * Math.sqrt(1 + m / 0.01)) lo = m; else hi = m; }
  check('amplitude sweep: plateau 1000 Pa; the yield point (G′ 5 % down) and flow point (G′ = G″) within 3 %', rel(a.G0, 1000) < 1e-3 && rel(a.yield.strain, yEx) < 0.03 && rel(a.flow.strain, lo) < 0.03,
    `G0 ${a.G0.toFixed(2)}, yield ${a.yield.strain.toExponential(3)} (${yEx.toExponential(3)}), flow ${a.flow.strain.toExponential(3)} (${lo.toExponential(3)}); stress ${a.flow.stress.toFixed(1)} Pa`);
  const w = logspace(0.01, 100, 25), G = 500, tr = 0.2, M1 = w.map(x => G * (x * tr) ** 2 / (1 + (x * tr) ** 2)), M2 = w.map(x => G * x * tr / (1 + (x * tr) ** 2));
  const fr = F.rfRead(rcExport('Frequency sweep', [[['Frequency', 'Hz', w.map(x => x / (2 * Math.PI))], ['Storage Modulus', 'Pa', M1], ['Loss Modulus', 'Pa', M2]]])), c = fr.tables[0].cols, q = F.rfFreq(c.omega, c.G1, c.G2);
  check('frequency sweep (Maxwell, 0.2 s): crossover at 5 rad/s, relaxation time 0.2 s', rel(q.crossover, 5) < 1e-9 && rel(q.relaxTime, 0.2) < 1e-9, `${q.crossover.toFixed(6)} rad/s`);
  check('  G′ and G″ at 1 rad/s within 2 %', rel(q.G1at1, G * 0.04 / 1.04) < 0.02 && rel(q.G2at1, G * 0.2 / 1.04) < 0.02, `${q.G1at1.toFixed(2)}, ${q.G2at1.toFixed(2)} Pa`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
