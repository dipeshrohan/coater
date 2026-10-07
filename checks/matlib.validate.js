/*
 * matlib.validate.js — checks of matlib.js (the material hub's core) against exact values and independent
 * implementations. Run: node matlib.validate.js
 *  1. Units: conversions (prefixes, compound units, °C as a temperature and as a difference), refusals across
 *     dimensions, Herschel–Bulkley's K in Pa·sⁿ (τ = K γ̇ⁿ in pascals for any n).
 *  2. Expressions: precedence, associativity, functions, parameters; refused: unknown names, members, statements.
 *  3. Tables: the points reproduced, linear and log–log between them, the monotone cubic without overshoot, and the
 *     three policies outside the range.
 *  4. Piecewise: the right piece; gaps and overlaps refused, jumps reported.
 *  5. Laws: each built-in law equals the solvers' own function (air, water, argon, graphite).
 *  6. Second-order tensors: the forms, frames and rotations against hand-worked components, eigenvalues and traces
 *     kept, projections to 1D and 2D, positive definiteness.
 *  7. Stiffness: equal to mp-core's (isotropic, transversely isotropic, bit for bit), Lamé, rotation against the
 *     fourth-order tensor rotated index by index, plane strain/stress against mp-core and against a direct solve.
 *  8. Rheology: the laws in standard parameters, their exact link to the solvers' form, old projects' conversion, and
 *     the checks of their parameters.
 */
const L = require('../engine/matlib.js'), C = require('../engine/mp-core.js'), DR = require('../engine/drying.js'), FM = require('../engine/furnace-mp.js');
const { muEffLocal } = require('../engine/cfd-solver.js'), RH = require('../engine/rheo.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));
const throws = (f, cls) => { try { f(); return false; } catch (e) { return !cls || e instanceof cls; } };
const fmt = x => (typeof x === 'number' ? x.toExponential(2) : String(x));

// 1. units
{
  const cases = [[1, 'g/cm³', 'kg/m³', 1000], [10, 'mPa·s', 'Pa·s', 0.01], [25, '°C', 'K', 298.15], [300, 'K', '°C', 26.85], [1, 'W/(m·°C)', 'W/(m·K)', 1],
    [1, 'kJ/mol', 'J/mol', 1000], [1, '×10⁻⁶/K', '1/K', 1e-6], [1, 'J/kg/K', 'J/(kg·K)', 1], [1, 'psi', 'Pa', 6894.757293168], [760, 'Torr', 'atm', 1],
    [5, 'µm', 'um', 5], [1, 'cP', 'mPa·s', 1], [1, 'L', 'm³', 1e-3], [2.7, '1/s', 's⁻¹', 2.7], [1, '×10⁻¹² kg/(m·s·Pa)', 's', 1e-12], [50, '%', '1', 0.5], [1, 'bar', 'kPa', 100]];
  const bad = cases.filter(([v, a, b, w]) => rel(L.mlConvert(v, a, b), w) > 1e-14).map(([v, a, b, w]) => `${v} ${a} → ${L.mlConvert(v, a, b)} ${b} (not ${w})`);
  check(`units: ${cases.length} conversions (prefixes, compound units, °C alone and in a product, ×10ⁿ, superscripts)`, !bad.length, bad.join('; '));
  check('  °C in a product is a difference (no offset): 1 W/(m·°C) = 1 W/(m·K), a 1 °C step = 1 K', L.mlParseUnit('W/(m·°C)').off === 0 && L.mlParseUnit('°C').off === 273.15);
  check('  refused across dimensions: Pa → Pa·s, °C → m, J → W', throws(() => L.mlConvert(1, 'Pa', 'Pa·s'), L.MLUnitError) && throws(() => L.mlConvert(1, '°C', 'm'), L.MLUnitError) && throws(() => L.mlConvert(1, 'J', 'W'), L.MLUnitError));
  check('  refused: an unknown unit, an unclosed bracket, an exponent not given (Pa·s^n without n)', throws(() => L.mlParseUnit('furlong'), L.MLUnitError) && throws(() => L.mlParseUnit('W/(m·K'), L.MLUnitError) && throws(() => L.mlParseUnit('Pa·s^n'), L.MLUnitError));
  const Pa = L.mlParseUnit('Pa').dim, perS = L.mlParseUnit('1/s').dim;
  const okK = [0.3, 0.6, 1, 1.4].every(n => L.mlDimEq(L.mlRheoKUnit(n).dim.map((d, i) => d + n * perS[i]), Pa));
  check('  Herschel–Bulkley K in Pa·sⁿ: K γ̇ⁿ is a stress for n 0.3, 0.6, 1, 1.4', okK, `Pa·s^0.6 = ${L.mlDimStr(L.mlRheoKUnit(0.6).dim)}`);
  check('  conductivity W/(m·K) = kg·m·s⁻³·K⁻¹; contact resistance m²·K/W = kg⁻¹·s³·K', L.mlDimStr(L.mlParseUnit('W/(m·K)').dim) === 'm·kg·s^-3·K^-1' && L.mlDimStr(L.mlParseUnit('m²·K/W').dim) === 'kg^-1·s^3·K');
}

// 2. expressions
{
  const ev = (src, env = {}, params) => L.mlExpr(src, L.ML_STATE, params).f(env);
  const ok = ev('2*T + 3', { T: 10 }) === 23 && ev('-2^2') === -4 && ev('2^3^2') === 512 && ev('(1 + 2) * 3') === 9 && ev('8 / 2 / 2') === 2
    && rel(ev('A*exp(-Ea/(R*T))', { T: 500 }, { A: 2, Ea: 5e4 }), 2 * Math.exp(-5e4 / (8.314462618 * 500))) < 1e-15 && ev('max(T, 300)', { T: 250 }) === 300 && ev('1.5e-3*gd', { gd: 2 }) === 3e-3;
  check('expressions: precedence, right-associative powers, unary minus, functions, parameters, constants', ok);
  const refused = ['constructor', 'T.constructor', 'process.exit()', 'T; 1', 'alert(1)', 'this', 'x + 1', 'exp(1, 2)', '', 'toString(1)', 'T[0]', '(T', 'T)'];
  const notRefused = refused.filter(s => !throws(() => L.mlExpr(s), L.MLExprError));
  check(`  refused: ${refused.length} sources (members, statements, unknown names and functions, wrong arity, brackets, empty)`, !notRefused.length, notRefused.join(' | '));
  check('  the variables an expression uses are listed', JSON.stringify(L.mlExpr('a0*(T/300)^b + 0*gd', L.ML_STATE, { a0: 1, b: 2 }).vars.sort()) === '["T","gd"]');
}

// 3. tables
{
  const x = [1, 2, 4, 8], y = [10, 7, 3, 2.5], reports = [];
  const T = interp => ({ kind: 'table', var: 'T', x, y, interp });
  const at = (q, v) => L.mlQEval(q, { T: v }, m => reports.push(m));
  check('tables: every point reproduced exactly (linear, log–log, monotone cubic)', ['linear', 'loglog', 'pchip'].every(i => x.every((v, k) => at(T(i), v) === y[k])));
  check('  linear between points: halfway is the mean', at(T('linear'), 3) === 5);
  const ll = { kind: 'table', var: 'gd', x: [1, 100], y: [1, 0.01], interp: 'loglog' };
  check('  log–log between points: a power law exactly (η ∝ γ̇⁻¹: 0.1 at 10)', rel(L.mlQEval(ll, { gd: 10 }), 0.1) < 1e-14);
  const step = { kind: 'table', var: 'T', x: [0, 1, 2, 3, 4], y: [0, 0, 1, 1, 1], interp: 'pchip' };
  let lo = Infinity, hi = -Infinity, mono = true, prev = -Infinity;
  for (let k = 0; k <= 400; k++) { const v = L.mlQEval(step, { T: 4 * k / 400 }); lo = Math.min(lo, v); hi = Math.max(hi, v); if (v < prev - 1e-15) mono = false; prev = v; }
  check('  monotone cubic: a step stays within its data (no overshoot) and monotone', lo >= 0 && hi <= 1 && mono, `${lo} … ${hi}`);
  const lin = { kind: 'table', var: 'T', x: [0, 1, 3, 4], y: [1, 3, 7, 9], interp: 'pchip' };
  check('  monotone cubic reproduces straight-line data exactly', [0.5, 2, 3.7].every(v => rel(L.mlQEval(lin, { T: v }), 1 + 2 * v) < 1e-14));
  check('  outside, "error" (the default): refused', throws(() => at(T('linear'), 9), L.MLRangeError) && throws(() => at(T('linear'), 0.5), L.MLRangeError));
  reports.length = 0;
  const c1 = at({ ...T('linear'), extrap: 'clamp' }, 20), c2 = at({ ...T('linear'), extrap: 'extrapolate' }, 10);
  check('  outside, "clamp": the end value; "extrapolate": the last interval carried on; both reported', c1 === 2.5 && rel(c2, 2.5 + (2.5 - 3) / 4 * 2) < 1e-14 && reports.length === 2, `${c1}, ${c2}; ${reports.length} reports`);
  const bad = L.mlQCheck({ kind: 'table', var: 'T', x: [1, 3, 2], y: [1, 2, 3] }), bad2 = L.mlQCheck({ kind: 'table', var: 'T', x: [1, 2], y: [1] });
  check('  checked: x not increasing, columns of different lengths, log–log with a zero', bad.some(p => p.level === 'error' && /increase/.test(p.msg)) && bad2.some(p => /length/.test(p.msg))
    && L.mlQCheck({ kind: 'table', var: 'T', x: [0, 1], y: [1, 2], interp: 'loglog' }).some(p => /positive/.test(p.msg)));
}

// 4. piecewise
{
  const pw = { kind: 'piecewise', var: 'T', pieces: [{ lo: 0, hi: 10, q: { kind: 'expr', src: '2*T' } }, { lo: 10, hi: 20, q: { kind: 'expr', src: '20 + (T - 10)' } }] };
  check('piecewise: each range its own quantity, the join belongs to the next, the last end included', L.mlQEval(pw, { T: 5 }) === 10 && L.mlQEval(pw, { T: 10 }) === 20 && L.mlQEval(pw, { T: 20 }) === 30 && L.mlQCheck(pw).length === 0);
  const gap = { ...pw, pieces: [pw.pieces[0], { ...pw.pieces[1], lo: 12 }] }, over = { ...pw, pieces: [pw.pieces[0], { ...pw.pieces[1], lo: 8 }] };
  const jump = { ...pw, pieces: [pw.pieces[0], { lo: 10, hi: 20, q: 25 }] };
  check('  a gap and an overlap: errors; a jump at a join: a warning', L.mlQCheck(gap).some(p => p.level === 'error' && /gap/.test(p.msg)) && L.mlQCheck(over).some(p => p.level === 'error' && /overlap/.test(p.msg))
    && L.mlQCheck(jump).some(p => p.level === 'warn' && /jumps/.test(p.msg)) && throws(() => L.mlQEval(gap, { T: 11 }), L.MLRangeError));
}

// 5. laws against the solvers' own functions
{
  const law = (name, params, s) => L.mlQEval({ kind: 'law', law: name, params }, s);
  let e = 0;
  for (const Tc of [-20, 0, 25, 100, 400]) {
    const a = DR.drAir(Tc, 101325), T = Tc + 273.15;
    e = Math.max(e, rel(law('sutherland', { y0: 1.716e-5, T0: 273.15, S: 110.4 }, { T }), a.mu), rel(law('sutherland', { y0: 0.0241, T0: 273.15, S: 194 }, { T }), a.k),
      rel(law('idealGas', { M: 0.0289647 }, { T, p: 101325 }), a.rho));
  }
  check('laws: air (Sutherland viscosity and conduction, ideal-gas density) = drying.js drAir, -20 to 400 °C', e < 1e-15, fmt(e));
  e = 0; for (const Tc of [0, 20, 60, 99]) e = Math.max(e, rel(law('vogel', { A: 2.414e-5, B: 247.8, C: 140 }, { T: Tc + 273.15 }), DR.drMuWater(Tc)));
  const IF97 = [0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5, -0.32325550322333e7, 0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3];
  for (const Tc of [1, 25, 80, 100, 200]) e = Math.max(e, rel(law('iapwsPsat', { n: IF97 }, { T: Tc + 273.15 }), DR.drPsat(Tc)));
  check('  water (Vogel viscosity, IAPWS-IF97 saturation pressure) = drying.js drMuWater, drPsat', e < 1e-15, fmt(e));
  check('  water boils at 100 °C at 101.4 kPa (IAPWS: 101.418 kPa)', Math.abs(law('iapwsPsat', { n: IF97 }, { T: 373.15 }) - 101418) < 1);
  e = 0;
  for (const Tc of [20, 500, 1500, 2800]) { const a = FM.fmpArgon(Tc); e = Math.max(e, rel(law('powerT', { y0: 2.27e-5, T0: 300, b: 0.67 }, { T: Tc + 273.15 }), a.mu), rel(law('idealGas', { M: 0.039948 }, { T: Tc + 273.15, p: 101325 }), a.rho)); }
  check('  argon (viscosity ∝ T^0.67, ideal-gas density) = furnace-mp.js fmpArgon, 20 to 2800 °C', e < 1e-15, fmt(e));
  const CG = [0.54212, -2.42667e-6, -90.2725, -43449.3, 1.59309e7, -1.43688e9];
  e = 0; for (const Tc of [25, 300, 1000, 2500]) e = Math.max(e, rel(law('butlandMaddison', { c: CG }, { T: Tc + 273.15 }), FM.fmpCg(Tc)));
  check('  graphite\'s heat capacity (Butland–Maddison) = furnace-mp.js fmpCg; 0.71 kJ/(kg·K) at 25 °C', e < 1e-15 && Math.abs(FM.fmpCg(25) - 710) < 15, `${fmt(e)}; ${FM.fmpCg(25).toFixed(0)}`);
  const vq = { kind: 'law', law: 'butlandMaddison', params: { c: CG }, valid: { T: [200, 3500] } };
  check('  a law outside its valid range: refused by default, held at its end with "clamp"', throws(() => L.mlQEval(vq, { T: 4000 }), L.MLRangeError) && L.mlQEval({ ...vq, extrap: 'clamp' }, { T: 4000 }, () => {}) === L.mlQEval(vq, { T: 3500 }));
}

// 6. second-order tensors
{
  const v = (t, s = {}) => L.mlT2Eval(t, s);
  const eq = (a, b, tol = 1e-14) => a.every((x, i) => Math.abs(x - b[i]) <= tol * Math.max(1, ...b.map(Math.abs)));
  check('tensors: isotropic k I; transversely isotropic about z: [trans, trans, axial]; about x: [axial, trans, trans]',
    eq(v({ form: 'iso', k: 2 }), [2, 2, 2, 0, 0, 0]) && eq(v({ form: 'ti', axial: 0.2, trans: 1 }), [1, 1, 0.2, 0, 0, 0]) && eq(v({ form: 'ti', axial: 0.2, trans: 1, axis: [1, 0, 0] }), [0.2, 1, 1, 0, 0, 0]));
  const k1 = 5, k2 = 1, k3 = 0.2, th = 30, c = Math.cos(th * Math.PI / 180), s = Math.sin(th * Math.PI / 180);
  const r = v({ form: 'ortho', k1, k2, k3, frame: { euler: [th, 0, 0] } });
  check('  orthotropic, its frame turned 30° about z: K_xx = k1 c² + k2 s², K_yy = k1 s² + k2 c², K_xy = (k1 − k2) c s', eq(r, [k1 * c * c + k2 * s * s, k1 * s * s + k2 * c * c, k3, 0, 0, (k1 - k2) * c * s]), r.map(x => +x.toFixed(6)).join(' '));
  const ob = v({ form: 'ortho', k1, k2, k3, frame: { euler: [37, 64, -21] } }), ev = L.mlEig3(ob);
  check('  a general frame (Euler 37°, 64°, −21°): the eigenvalues are k1, k2, k3 and the trace kept', eq(ev, [k1, k2, k3], 1e-12) && rel(ob[0] + ob[1] + ob[2], k1 + k2 + k3) < 1e-14, ev.map(x => x.toFixed(12)).join(' '));
  const Q = L.mlFrame({ euler: [37, 64, -21] }), QQ = L.mlMatMul(L.mlT(Q), Q);
  check('  the frame is a rotation (QᵀQ = I)', QQ.every((rw, i) => rw.every((x, j) => Math.abs(x - (i === j ? 1 : 0)) < 1e-15)));
  const ax = [1, 2, 2].map(x => x / 3), ti = v({ form: 'ti', axial: 0.3, trans: 2, axis: [1, 2, 2] }), M = L.mlV2M(ti), Ka = M.map(rw => rw.reduce((a, x, j) => a + x * ax[j], 0)), b = [2, -1, 0].map(x => x / Math.sqrt(5)), Kb = M.map(rw => rw.reduce((a, x, j) => a + x * b[j], 0));
  check('  transversely isotropic about an oblique axis a: K a = axial a, K b = trans b for b ⊥ a', eq(Ka, ax.map(x => 0.3 * x)) && eq(Kb, b.map(x => 2 * x)));
  const full = { form: 'full', xx: 3, yy: 2, zz: 1, yz: 0.1, xz: -0.2, xy: 0.4, frame: { euler: [20, 40, 60] } };
  const Qf = L.mlFrame(full.frame), back = L.mlM2V(L.mlMatMul(L.mlMatMul(L.mlT(Qf), L.mlV2M(v(full))), Qf));
  check('  a full tensor given in its frame comes back when turned back', eq(back, [3, 2, 1, 0.1, -0.2, 0.4], 1e-13));
  check('  projections: 1D along y the yy component; 2D on x–z the block [xx, zz] (+ xz); a diagonal one as such (the solvers\' fast path)',
    L.mlT2Proj(r, [1]) === r[1] && JSON.stringify(L.mlT2Proj(r, [0, 2])) === JSON.stringify([r[0], r[2]]) && L.mlT2Proj(r, [0, 1]).off[0] === r[5] && Array.isArray(L.mlT2Proj([1, 2, 3, 0, 0, 0], [0, 1, 2])));
  check('  not positive definite: refused (an eigenvalue ≤ 0)', L.mlT2Check([1, 1, -0.1, 0, 0, 0]).length === 1 && L.mlT2Check([1, 1, 1, 0, 0, 0.99]).length === 0 && L.mlT2Check([1, 1, 1, 0, 0, 1.01]).length === 1);
  check('  components may depend on the state: a table of k(T) inside a transversely isotropic tensor',
    eq(v({ form: 'ti', axial: { kind: 'table', var: 'T', x: [300, 400], y: [0.2, 0.4] }, trans: 1 }, { T: 350 }), [1, 1, 0.3, 0, 0, 0]));
}

// 7. stiffness
{
  const same = (A, B) => A.every((rw, i) => rw.every((x, j) => x === B[i][j]));
  const iso = { E: 20e9, nu: 0.2 }, ti = { Ep: 20e9, nup: 0.2, Et: 3e9, nupt: 0.1, Gpt: 1e9 };
  check('stiffness: isotropic and transversely isotropic (about x, y, z) bit for bit as mp-core\'s mpStiffness',
    same(L.mlCEval({ form: 'iso', ...iso }), C.mpStiffness(iso)) && [0, 1, 2].every(a => same(L.mlCEval({ form: 'ti', ...ti, axis: a }), C.mpStiffness({ ...ti, axis: a }))));
  const E = 20e9, nu = 0.2, lam = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu)), Ci = L.mlCEval({ form: 'iso', E, nu });
  check('  isotropic: C11 = λ + 2μ, C12 = λ, C44 = μ (Lamé)', rel(Ci[0][0], lam + 2 * mu) < 1e-14 && rel(Ci[0][1], lam) < 1e-14 && rel(Ci[3][3], mu) < 1e-14);
  const Co = L.mlCEval({ form: 'ortho', E1: E, E2: E, E3: E, nu12: nu, nu13: nu, nu23: nu, G12: mu, G13: mu, G23: mu });
  check('  orthotropic with equal constants = isotropic', Co.every((rw, i) => rw.every((x, j) => Math.abs(x - Ci[i][j]) < 1e-12 * Ci[0][0])));
  // the fourth-order tensor rotated index by index (an independent rotation)
  const P = [[0, 0], [1, 1], [2, 2], [1, 2], [0, 2], [0, 1]], vi = (i, j) => P.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));
  const rot4 = (C6, Q) => {
    const c = (i, j, k, l) => C6[vi(i, j)][vi(k, l)], out = Array.from({ length: 6 }, () => new Float64Array(6));
    for (let I = 0; I < 6; I++) for (let J = 0; J < 6; J++) {
      const [i, j] = P[I], [k, l] = P[J]; let s = 0;
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) for (let r = 0; r < 3; r++) for (let t = 0; t < 3; t++) s += Q[i][p] * Q[j][q] * Q[k][r] * Q[l][t] * c(p, q, r, t);
      out[I][J] = s;
    }
    return out;
  };
  const orth = { form: 'ortho', E1: 30e9, E2: 8e9, E3: 2e9, nu12: 0.25, nu13: 0.1, nu23: 0.3, G12: 5e9, G13: 1e9, G23: 0.8e9 };
  const fr = { euler: [25, 50, 75] }, Cr = L.mlCEval({ ...orth, frame: fr }), Cx = rot4(L.mlCEval(orth), L.mlFrame(fr));
  const dr = Math.max(...Cr.map((rw, i) => Math.max(...rw.map((x, j) => Math.abs(x - Cx[i][j]))))) / Cr[0][0];
  check('  rotated from its frame (Bond matrix) = the fourth-order tensor rotated index by index', dr < 1e-12, fmt(dr));
  const tiOb = L.mlCEval({ form: 'ti', ...ti, axis: [0, 0.6, 0.8] }), tiZ = L.mlCEval({ form: 'ti', ...ti, axis: 2 }), Qz = L.mlFrame({ axes: [[1, 0, 0], [0, 0.8, -0.6]] });
  const tiRot = rot4(tiZ, Qz), dt = Math.max(...tiOb.map((rw, i) => Math.max(...rw.map((x, j) => Math.abs(x - tiRot[i][j]))))) / tiZ[0][0];
  check('  transversely isotropic about an oblique axis = about z, turned so that z goes to the axis', dt < 1e-12, fmt(dt));
  const ps = (Cm, plane) => C.mpReduce(Cm, 2, plane).D, same3 = (A, B) => A.every((rw, i) => rw.every((x, j) => x === B[i][j]));
  check('  plane strain and plane stress on x–y: bit for bit as mp-core\'s mpReduce (isotropic, transversely isotropic about z)',
    [Ci, tiZ].every(Cm => same3(L.mlCReduce(Cm, [0, 1], 'strain'), ps(Cm, 'strain')) && same3(L.mlCReduce(Cm, [0, 1], 'stress'), ps(Cm, 'stress'))));
  // plane stress for a coupled stiffness: a direct solve (the out-of-plane stresses zero) against the condensation
  const D = L.mlCReduce(Cr, [0, 1], 'stress'), eIn = [1e-3, -4e-4, 2e-4], o = [2, 3, 4], k = [0, 1, 5];
  const A = o.map(i => o.map(j => Cr[i][j])), rhs = o.map(i => -k.reduce((s2, kk, m) => s2 + Cr[i][kk] * eIn[m], 0));
  const inv = (M3 => { const [[a, b, c], [d, e, f], [g, h, i]] = M3, De = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g); return [[(e * i - f * h) / De, (c * h - b * i) / De, (b * f - c * e) / De], [(f * g - d * i) / De, (a * i - c * g) / De, (c * d - a * f) / De], [(d * h - e * g) / De, (b * g - a * h) / De, (a * e - b * d) / De]]; })(A);
  const eOut = inv.map(rw => rw.reduce((s2, x, j) => s2 + x * rhs[j], 0)), full = new Array(6).fill(0); k.forEach((kk, m) => (full[kk] = eIn[m])); o.forEach((oo, m) => (full[oo] = eOut[m]));
  const sig = k.map(i => Cr[i].reduce((s2, x, j) => s2 + x * full[j], 0)), sigD = D.map(rw => rw.reduce((s2, x, j) => s2 + x * eIn[j], 0));
  const dps = Math.max(...sig.map((x, i) => Math.abs(x - sigD[i]))) / Math.max(...sig.map(Math.abs));
  check('  plane stress with the shears coupled (a rotated orthotropic solid): condensation = the out-of-plane stresses solved to zero', dps < 1e-12, fmt(dps));
  check('  refused: isotropic with ν = 0.6, transversely isotropic with ν_pt too large; accepted: the film card\'s values',
    L.mlCCheck(L.mlCEval({ form: 'iso', E, nu: 0.6 })).length > 0 && L.mlCCheck(L.mlCEval({ form: 'ti', ...ti, nupt: 2 })).length > 0 && L.mlCCheck(tiZ).length === 0 && L.mlCCheck(Cr).length === 0);
}

// 8. rheology
{
  const hb = { model: 'hb', ty: 5, K: 8, n: 0.6 }, sv = L.mlRheoToSolver(hb);
  let e = 0; for (const gd of [0.01, 0.3, 2.7, 10, 300, 1e4]) e = Math.max(e, rel(muEffLocal(gd, sv.muRef, sv.ty, sv.n, sv.x), L.mlRheoMu(hb, gd)));
  check('rheology: Herschel–Bulkley τy, K, n through the solvers\' form = the law itself, 0.01 to 10⁴ 1/s', e < 1e-13, fmt(e));
  check('  its stress above the yield stress: τ − τy = K γ̇ⁿ', [0.1, 5, 100].every(gd => rel(L.mlRheoMu(hb, gd) * gd - hb.ty, hb.K * Math.pow(gd, hb.n)) < 1e-13));
  const old = L.mlRheoFromSolver('hb', 10.5, 5, 1), back = L.mlRheoToSolver(old);
  check('  a project from before (10.5 Pa·s at 2.7 1/s, τy 5 Pa, n 1): K = 10.5 − 5/2.7 = 8.648 Pa·s, and back to 10.5', rel(old.K, 10.5 - 5 / 2.7) < 1e-15 && rel(back.muRef, 10.5) < 1e-15 && !old.floored, `K ${old.K}`);
  // (the old floor acted from τy = 0.95 × 2.7 × 10.5 = 26.9 Pa; K is negative from 2.7 × 10.5 = 28.35 Pa)
  const f40 = L.mlRheoFromSolver('hb', 10.5, 40, 1), f27 = L.mlRheoFromSolver('hb', 10.5, 27.5, 1), f26 = L.mlRheoFromSolver('hb', 10.5, 26.5, 1);
  check('  τy 40 Pa with 10.5 Pa·s at 2.7 1/s: a conflict (K would be −4.31); τy 27.5: the old floor acted, no conflict; τy 26.5: neither',
    f40.floored && f40.conflict && rel(f40.Kraw, 10.5 - 40 / 2.7) < 1e-14 && f27.floored && !f27.conflict && !f26.floored, `${f40.Kraw.toFixed(3)}; ${f27.Kraw.toFixed(3)}`);
  e = 0;
  for (const [model, n, x] of [['carreau', 0.5, { etaInf: 0.01, L: 1, a: 2 }], ['carreau', 0.3, { etaInf: 0.2, L: 5, a: 0.7 }], ['cross', 0.4, { etaInf: 0.05, L: 2 }], ['carreau', 0.5, { etaInf: 9, L: 1, a: 2 }]]) {
    // (a project from before with η∞ above the old cap: its law kept by migrating η∞ to the capped value it was solved with)
    const xs = { model, ...x, a: x.a ?? 1 }, st = L.mlRheoFromSolver(model, 10.5, 0, n, xs), law = RH.rheoCompile(10.5, 0, n, { ...xs, etaInf: st.etaInf });
    for (const gd of [1e-3, 0.1, 2.7, 50, 1e4]) e = Math.max(e, rel(L.mlRheoMu(st, gd), law.mu(gd)));
  }
  check('  Carreau–Yasuda and Cross from the solvers\' form = rheo.js\'s law at every shear rate (η∞ capped as it was: named)', e < 1e-12 && L.mlRheoFromSolver('carreau', 10.5, 0, 0.5, { etaInf: 9, L: 1, a: 2 }).capped, fmt(e));
  const bad = [{ model: 'hb', ty: 5, K: -1, n: 0.6 }, { model: 'hb', ty: -1, K: 1, n: 0.6 }, { model: 'power', K: 1, n: 0 }, { model: 'carreau', eta0: 1, etaInf: 2, lam: 1, a: 2, n: 0.5 }, { model: 'cross', eta0: 5, etaInf: 0, lam: 0, n: 0.5 }, { model: 'hb', ty: 5, n: 0.5 }];
  check('  refused: K ≤ 0, τy < 0, n ≤ 0, η0 ≤ η∞, λ ≤ 0, a parameter missing; n > 1 only a warning', bad.every(r => L.mlRheoCheck(r).some(p => p.level === 'error'))
    && L.mlRheoCheck(hb).length === 0 && L.mlRheoCheck({ model: 'power', K: 1, n: 1.3 }).every(p => p.level === 'warn'));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
