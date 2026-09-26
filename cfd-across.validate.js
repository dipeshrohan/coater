/*
 * cfd-across.validate.js — checks of the blade across the web (cfd-across.js): run with `node cfd-across.validate.js`.
 *  1. The beam against textbook deflections: a uniform load and a point load, simply supported and clamped;
 *     symmetry; the bow scales with the load and with 1 / EI.
 *  2. The parts: today's waviness unchanged with no crest set (bit for bit), a crest where it is asked; the typed
 *     bow's shapes (zero at the blade's ends, the amount at the middle, the arc against the parabola); chamfered ends.
 *  3. The monotone curve through measured points: through every point, no overshoot, flat beyond the ends.
 */
const A = require('./cfd-across.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

console.log('1. The beam');
{
  const L = 0.3, EI = 4.2e4, q = 50;
  for (const [sup, want] of [['simple', 5 * q * L ** 4 / (384 * EI)], ['clamped', q * L ** 4 / (384 * EI)]]) {
    const b = A.beamBow({ L, EI, supports: sup, q: () => q, n: 120 });
    const mid = b.w[60], sym = Math.max(...b.w.map((w, i) => Math.abs(w - b.w[120 - i])));
    check(`uniform load, ${sup}: the middle's deflection = ${sup === 'simple' ? '5' : '1'} q L^4 / 384 EI, symmetric, zero at the ends`, rel(mid, want) < 1e-6 && sym < 1e-15 && Math.abs(b.w[0]) < 1e-18 && Math.abs(b.w[120]) < 1e-18,
      `${(mid * 1e6).toFixed(6)} vs ${(want * 1e6).toFixed(6)} µm, asymmetry ${sym.toExponential(1)} m`);
  }
  // a point load, as a narrow even load around a = 0.1 m; the deflection under it against Roark's formulas
  {
    const a = 0.1, bb = L - a, P = 10, eps = 0.0005, qa = s => Math.abs(s - a) < eps ? P / (2 * eps) : 0;
    const ss = A.beamBow({ L, EI, supports: 'simple', q: qa, n: 300, nq: 6000 }), cc = A.beamBow({ L, EI, supports: 'clamped', q: qa, n: 300, nq: 6000 });
    const i = 100, wantS = P * a * a * bb * bb / (3 * EI * L), wantC = P * a ** 3 * bb ** 3 / (3 * EI * L ** 3);
    check('a point load at a third: under it, simply supported P a^2 b^2 / 3 EI L, clamped P a^3 b^3 / 3 EI L^3', rel(ss.w[i], wantS) < 2e-4 && rel(cc.w[i], wantC) < 2e-4,
      `${(ss.w[i] * 1e6).toFixed(5)} vs ${(wantS * 1e6).toFixed(5)}; ${(cc.w[i] * 1e6).toFixed(5)} vs ${(wantC * 1e6).toFixed(5)} µm`);
    // Maxwell-Betti reciprocity: the deflection at z from a load at a equals the deflection at a from a load at z
    for (const sup of ['simple', 'clamped']) { const G = A.beamGreen(L, sup); check(`  reciprocity (${sup})`, rel(G(0.05, 0.22), G(0.22, 0.05)) < 1e-12); }
  }
  const b1 = A.beamBow({ L, EI, supports: 'simple', q: s => 30 + 40 * s / L }), b2 = A.beamBow({ L, EI: 2 * EI, supports: 'simple', q: s => 2 * (30 + 40 * s / L) });
  check('linear in the load, inversely in EI', Math.max(...b1.w.map((w, i) => Math.abs(w - b2.w[i]))) < 1e-18);
  const sec = A.beamSection({ h: 50, t: 20, I: null }), sec2 = A.beamSection({ h: 50, t: 20, I: 1e5 });
  check('section: I = t h^3 / 12, area t h; a typed I wins', rel(sec.I, 20 * 50 ** 3 / 12 * 1e-12) < 1e-12 && rel(sec.A, 1e-3) < 1e-12 && rel(sec2.I, 1e-7) < 1e-12);
}

console.log('\n2. The parts');
{
  const zs = Array.from({ length: 301 }, (_, i) => i);
  check("today's waviness with no crest set: the same numbers, bit for bit", zs.every(z => A.acrossSine(z, 20, 120, null) === 20 * Math.sin(2 * Math.PI * z / 120)));
  check('with its first crest set at 50 mm: the crest there, and a wavelength on', Math.abs(A.acrossSine(50, 20, 120, 50) - 20) < 1e-12 && Math.abs(A.acrossSine(170, 20, 120, 50) - 20) < 1e-12 && Math.abs(A.acrossSine(20, 20, 120, 50)) < 20);
  check('  crest at lw / 4 = none set', zs.every(z => Math.abs(A.acrossSine(z, 20, 120, 30) - A.acrossSine(z, 20, 120, null)) < 1e-12));
  const span = A.acrossSpan(300, { left: 10, right: -20 });
  check('the blade from -oL to W + oR', span[0] === -10 && span[1] === 280);
  for (const shape of ['parabola', 'arc', 'cosine']) {
    const f = z => A.acrossBowTyped(z, 40, shape, span), mid = (span[0] + span[1]) / 2;
    check(`bow, ${shape}: 40 µm at the middle, zero at the blade's ends, symmetric, zero beyond`, Math.abs(f(mid) - 40) < 1e-9 && Math.abs(f(span[0])) < 1e-9 && Math.abs(f(span[1])) < 1e-9
      && Math.abs(f(mid - 60) - f(mid + 60)) < 1e-9 && f(290) === 0);
  }
  const d = Math.max(...zs.map(z => Math.abs(A.acrossBowTyped(z, 40, 'arc', [0, 300]) - A.acrossBowTyped(z, 40, 'parabola', [0, 300]))));
  check('  the arc and the parabola differ by (sagitta / half span)^2 only (a 40 µm bow over 150 mm: below a nanometre)', d < 1e-3, `${(d * 1000).toFixed(6)} nm`);
  check('  a negative bow (the middle lower): the mirror', Math.abs(A.acrossBowTyped(100, -40, 'arc', [0, 300]) + A.acrossBowTyped(100, 40, 'arc', [0, 300])) < 1e-12);
  const e = { left: { c: 15, d: 60 }, right: { c: 10, d: 30 } }, sp = [0, 300];
  check('chamfered ends: d at the end, straight to zero c in, zero between', Math.abs(A.acrossEnds(0, e, sp) - 60) < 1e-12 && Math.abs(A.acrossEnds(7.5, e, sp) - 30) < 1e-12 && A.acrossEnds(15, e, sp) === 0
    && A.acrossEnds(150, e, sp) === 0 && Math.abs(A.acrossEnds(300, e, sp) - 30) < 1e-12 && Math.abs(A.acrossEnds(295, e, sp) - 15) < 1e-12);
  check('  measured from the blade\'s ends (it overhangs 5 mm: at the web\'s edge, 5 mm in)', Math.abs(A.acrossEnds(0, e, [-5, 305]) - 40) < 1e-12);
}

console.log('\n3. The curve through measured points');
{
  const pts = [[0, 5], [30, 12], [60, -4], [90, 8], [120, 18], [150, 18], [180, -10], [240, 9], [300, -6]], f = A.acrossPchip(pts);
  check('through every point', pts.every(([z, v]) => Math.abs(f(z) - v) < 1e-12));
  let over = 0;
  for (let i = 0; i < pts.length - 1; i++) for (let k = 1; k < 50; k++) { const z = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 50, lo = Math.min(pts[i][1], pts[i + 1][1]), hi = Math.max(pts[i][1], pts[i + 1][1]); if (f(z) < lo - 1e-9 || f(z) > hi + 1e-9) over++; }
  check('no overshoot between points (monotone on each interval)', over === 0);
  check('flat beyond the first and last', f(-20) === 5 && f(400) === -6);
  check('a flat stretch stays flat', Math.abs(f(135) - 18) < 1e-12);
  check('unsorted and repeated points: sorted, repeats averaged', Math.abs(A.acrossPchip([[10, 1], [0, 0], [10, 3]])(10) - 2) < 1e-12);
  check('one point: constant; none: zero', A.acrossPchip([[5, 7]])(100) === 7 && A.acrossPchip([])(3) === 0);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
