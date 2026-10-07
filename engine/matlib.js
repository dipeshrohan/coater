'use strict';
/*
 * matlib.js — the material hub's core (MH-1): how a material property is defined and evaluated. Pure computation, no
 * DOM: the page, the solvers' workers and Node (matlib.validate.js checks every part against exact cases).
 *
 *  - Units: every value has a unit (or is dimensionless); a unit is parsed to its factor to SI, its offset (a lone
 *    temperature in °C) and its dimension over the SI bases [m, kg, s, K, mol, A]. Conversions refuse units of another
 *    dimension; a coefficient's unit is checked against the dimension its law needs (Herschel–Bulkley's K: Pa·sⁿ).
 *  - Scalars (a quantity): a constant; a law (built in, with its formula and its source: Sutherland, Vogel, graphite's
 *    heat capacity, ...); a table against one state variable (linear, log–log or monotone cubic, PCHIP); piecewise
 *    (each range its own quantity); an expression in the state variables (parsed here into a tree of closures: no
 *    eval, only the listed functions and variables). Laws and tables have a valid range and an explicit policy outside
 *    it: 'error' (refuse), 'clamp' (hold the end value), 'extrapolate' (go on, reported).
 *  - Tensors: a second-order symmetric property (conduction, permeability, diffusion, expansion) is isotropic,
 *    transversely isotropic about an axis, orthotropic in a material frame, or a full symmetric tensor in that frame;
 *    a stiffness (fourth order, Voigt 6 × 6 with engineering shear) is isotropic, transversely isotropic, orthotropic
 *    or fully anisotropic, rotated from its material frame by the Bond matrix. A solver takes the tensor in its own
 *    frame: 3D all of it, 2D the in-plane block (exact when nothing varies along the third axis), 1D the component
 *    along its axis; a stiffness reduced to plane strain or plane stress (the out-of-plane stresses condensed).
 *  - Rheology: the generalized Newtonian laws in their standard parameters (Newtonian μ; power law K, n;
 *    Herschel–Bulkley τy, K, n; Carreau–Yasuda η0, η∞, λ, a, n; Cross η0, η∞, λ, n), and their exact link to the
 *    solvers' form (the viscosity at 2.7 1/s and the yield stress: muEffLocal).
 *  - Where a value comes from: measured, fitted, supplier, published, calculated, user, or no source.
 * State variables (SI): T (K), p (Pa), gd (shear rate, 1/s), c (concentration, mass fraction), X (water, kg/kg),
 * phi (volume fraction), t (s).
 */

// ---- units ----
/** The SI bases a dimension is counted in. */
const ML_BASES = ['m', 'kg', 's', 'K', 'mol', 'A'];
const mlD = (m = 0, kg = 0, s = 0, K = 0, mol = 0, A = 0) => [m, kg, s, K, mol, A];
const ML_DL = mlD();
/** The units known: symbol → [factor to SI, dimension]. (Prefixed units listed one by one: no prefix guessing.) */
const ML_UNITS = (() => {
  const u = {}, add = (names, f, d) => { for (const n of names) u[n] = [f, d]; };
  const L = mlD(1), M = mlD(0, 1), T = mlD(0, 0, 1), Th = mlD(0, 0, 0, 1), N_ = mlD(0, 0, 0, 0, 1), I = mlD(0, 0, 0, 0, 0, 1);
  const Pa = mlD(-1, 1, -2), J = mlD(2, 1, -2), W = mlD(2, 1, -3), Nw = mlD(1, 1, -2), V = mlD(2, 1, -3, 0, 0, -1);
  add(['m'], 1, L); add(['km'], 1e3, L); add(['cm'], 1e-2, L); add(['mm'], 1e-3, L); add(['µm', 'μm', 'um'], 1e-6, L);
  add(['nm'], 1e-9, L); add(['Å', 'A°'], 1e-10, L);
  add(['kg'], 1, M); add(['g'], 1e-3, M); add(['mg'], 1e-6, M); add(['t'], 1e3, M);
  add(['s'], 1, T); add(['ms'], 1e-3, T); add(['min'], 60, T); add(['h'], 3600, T); add(['d'], 86400, T);
  add(['K'], 1, Th); add(['°C', 'degC'], 1, Th);
  add(['mol'], 1, N_); add(['mmol'], 1e-3, N_); add(['kmol'], 1e3, N_);
  add(['A'], 1, I); add(['mA'], 1e-3, I);
  add(['N'], 1, Nw); add(['kN'], 1e3, Nw); add(['mN'], 1e-3, Nw);
  add(['Pa'], 1, Pa); add(['mPa'], 1e-3, Pa); add(['kPa'], 1e3, Pa); add(['MPa'], 1e6, Pa); add(['GPa'], 1e9, Pa);
  add(['bar'], 1e5, Pa); add(['mbar'], 100, Pa); add(['atm'], 101325, Pa); add(['psi'], 6894.757293168, Pa); add(['Torr'], 101325 / 760, Pa);
  add(['J'], 1, J); add(['kJ'], 1e3, J); add(['MJ'], 1e6, J); add(['cal'], 4.184, J); add(['kcal'], 4184, J);
  add(['W'], 1, W); add(['mW'], 1e-3, W); add(['kW'], 1e3, W); add(['MW'], 1e6, W);
  add(['L', 'l'], 1e-3, mlD(3)); add(['mL', 'ml'], 1e-6, mlD(3));
  add(['Hz'], 1, mlD(0, 0, -1));
  add(['P'], 0.1, mlD(-1, 1, -1)); add(['cP'], 1e-3, mlD(-1, 1, -1));
  add(['V'], 1, V); add(['Ω', 'ohm'], 1, mlD(2, 1, -3, 0, 0, -2)); add(['S'], 1, mlD(-2, -1, 3, 0, 0, 2));
  add(['%', 'vol%', 'wt%', 'mass%'], 0.01, ML_DL); add(['ppm'], 1e-6, ML_DL); add(['1', '-', 'fraction'], 1, ML_DL);
  add(['rad'], 1, ML_DL); add(['°', 'deg'], Math.PI / 180, ML_DL);
  return u;
})();
const ML_SUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+', '·': '.' };
class MLUnitError extends Error {}
/**
 * A unit string → { f (factor to SI), off (offset to SI: a lone °C only), dim }. Products by '·', '*', '.' or a space,
 * quotients by '/' (on the next factor: J/kg/K = J/(kg·K)), brackets, powers by '^' or superscripts (⁻¹, ², ³);
 * params name an exponent's symbol (Pa·s^n with { n: 0.6 }). A number alone is a factor (1/s, 10⁻⁶/K).
 */
function mlParseUnit(str, params = {}) {
  const src = String(str ?? '').trim().replace(/^×\s*/, '').replace(/×/g, '·');
  if (src === '' || src === '1' || src === '-') return { f: 1, off: 0, dim: ML_DL.slice() };
  // superscripts to ^ powers (a run of them is one exponent)
  let s = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ML_SUP[ch] && ch !== '·') { let e = ''; while (i < src.length && ML_SUP[src[i]] && src[i] !== '·') e += ML_SUP[src[i++]]; i--; s += '^' + e; }
    else s += ch;
  }
  let pos = 0;
  const peek = () => s[pos], eat = c => { if (s[pos] === c) { pos++; return true; } return false; };
  const ws = () => { while (s[pos] === ' ') pos++; };
  const err = m => { throw new MLUnitError(`unit "${src}": ${m}`); };
  const mul = (a, b, sign = 1) => ({ f: a.f * Math.pow(b.f, sign), dim: a.dim.map((d, i) => d + sign * b.dim[i]), lone: false });
  function exponent() {
    ws(); let neg = false;
    if (eat('-')) neg = true; else eat('+');
    let t = '';
    while (pos < s.length && /[0-9.]/.test(s[pos])) t += s[pos++];
    if (t) return neg ? -parseFloat(t) : parseFloat(t);
    let id = ''; while (pos < s.length && /[A-Za-z_]/.test(s[pos])) id += s[pos++];
    if (id && Number.isFinite(params[id])) return neg ? -params[id] : params[id];
    return err(id ? `its exponent "${id}" is not given` : 'a power without its exponent');
  }
  function atom() {
    ws();
    if (eat('(')) { const u = product(); ws(); if (!eat(')')) err('a bracket is not closed'); return u; }
    let t = '';
    const nm = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(pos));
    if (nm) { pos += nm[0].length; return { f: parseFloat(nm[0]), dim: ML_DL.slice(), lone: false }; }
    while (pos < s.length && !/[\s·*./()^]/.test(s[pos])) t += s[pos++];
    if (!t) err(`nothing where a unit is expected (at ${pos + 1})`);
    const k = ML_UNITS[t]; if (!k) err(`"${t}" is not a known unit`);
    return { f: k[0], dim: k[1].slice(), lone: t === '°C' || t === 'degC' ? 'C' : false };
  }
  function power() {
    const a = atom(); ws();
    if (eat('^')) { const e = exponent(); return { f: Math.pow(a.f, e), dim: a.dim.map(d => d * e), lone: e === 1 ? a.lone : false }; }
    return a;
  }
  function product() {
    let u = power(), n = 1;
    for (;;) {
      ws();
      if (eat('/')) { u = mul(u, power(), -1); n++; continue; }
      if (eat('·') || eat('*') || eat('.')) { u = mul(u, power()); n++; continue; }
      if (pos < s.length && peek() !== ')') { u = mul(u, power()); n++; continue; }
      break;
    }
    return u;
  }
  const u = product(); ws();
  if (pos < s.length) err(`unexpected "${s.slice(pos)}"`);
  // (an offset only for a temperature on its own: °C in a product is a difference, like K)
  // (the factor to 15 digits: products of decimal prefixes come out exact -- g/cm³ is 1000, not 999.9999999999999)
  return { f: +u.f.toPrecision(15), off: u.lone === 'C' ? 273.15 : 0, dim: u.dim.map(d => (Math.abs(d) < 1e-12 ? 0 : d)) };
}
const mlDimEq = (a, b) => a.every((d, i) => Math.abs(d - b[i]) < 1e-9);
/** A dimension as SI bases (kg·m⁻¹·s⁻²). */
const mlDimStr = d => d.map((e, i) => (e ? ML_BASES[i] + (e === 1 ? '' : `^${+e.toFixed(6)}`) : '')).filter(Boolean).join('·') || '1';
/** v from one unit to another (refused when their dimensions differ). */
function mlConvert(v, from, to, params) {
  const a = typeof from === 'string' ? mlParseUnit(from, params) : from, b = typeof to === 'string' ? mlParseUnit(to, params) : to;
  if (!mlDimEq(a.dim, b.dim)) throw new MLUnitError(`cannot convert ${mlDimStr(a.dim)} to ${mlDimStr(b.dim)}`);
  return (v * a.f + a.off - b.off) / b.f;
}
const mlToSI = (v, unit, params) => { const u = mlParseUnit(unit, params); return v * u.f + u.off; };
const mlFromSI = (v, unit, params) => { const u = mlParseUnit(unit, params); return (v - u.off) / u.f; };

// ---- expressions (parsed to closures: no eval) ----
const ML_FUNCS = {
  exp: [1, Math.exp], ln: [1, Math.log], log: [1, Math.log], log10: [1, Math.log10], sqrt: [1, Math.sqrt], abs: [1, Math.abs],
  tanh: [1, Math.tanh], sinh: [1, Math.sinh], cosh: [1, Math.cosh], sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan],
  atan: [1, Math.atan], min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow],
};
const ML_STATE = ['T', 'p', 'gd', 'c', 'X', 'phi', 't'];
const ML_CONST = { pi: Math.PI, R: 8.314462618, kB: 1.380649e-23, NA: 6.02214076e23, sigma: 5.670374419e-8 };
class MLExprError extends Error {}
/**
 * An expression → { f (env → number), vars (the state variables it uses), src }. Numbers, + − × ÷ ^ (right
 * associative), brackets, the functions of ML_FUNCS, the constants of ML_CONST, the variables `allowed` (default the
 * state variables) and named parameters (params: { name: number }).
 */
function mlExpr(src, allowed = ML_STATE, params = {}) {
  const s = String(src); let pos = 0; const used = new Set();
  const err = m => { throw new MLExprError(`"${s}": ${m} (at ${pos + 1})`); };
  const ws = () => { while (/\s/.test(s[pos] || '')) pos++; };
  function num() {
    const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(pos));
    if (!m) err('a number expected'); pos += m[0].length; const v = parseFloat(m[0]); return () => v;
  }
  function atom() {
    ws(); const ch = s[pos];
    if (ch === '(') { pos++; const e = add(); ws(); if (s[pos] !== ')') err('a bracket is not closed'); pos++; return e; }
    if (/[0-9.]/.test(ch || '')) return num();
    const m = /^[A-Za-z_][A-Za-z_0-9]*/.exec(s.slice(pos));
    if (!m) err(ch ? `unexpected "${ch}"` : 'the expression ends early');
    const id = m[0]; pos += id.length; ws();
    if (s[pos] === '(') {
      const fn = Object.prototype.hasOwnProperty.call(ML_FUNCS, id) ? ML_FUNCS[id] : null;
      if (!fn) err(`"${id}" is not a known function`);
      pos++; const args = [add()]; ws();
      while (s[pos] === ',') { pos++; args.push(add()); ws(); }
      if (s[pos] !== ')') err('a bracket is not closed'); pos++;
      if (args.length !== fn[0]) err(`${id} takes ${fn[0]} argument${fn[0] > 1 ? 's' : ''}`);
      const f = fn[1];
      return args.length === 1 ? (a => env => f(a(env)))(args[0]) : ((a, b) => env => f(a(env), b(env)))(args[0], args[1]);
    }
    if (allowed.includes(id)) { used.add(id); return env => env[id]; }
    if (Object.prototype.hasOwnProperty.call(params, id) && Number.isFinite(params[id])) { const v = params[id]; return () => v; }
    if (Object.prototype.hasOwnProperty.call(ML_CONST, id)) { const v = ML_CONST[id]; return () => v; }
    return err(`"${id}" is not a variable here (${allowed.join(', ')})`);
  }
  function pow() { const b = atom(); ws(); if (s[pos] === '^') { pos++; const e = unary(); return env => Math.pow(b(env), e(env)); } return b; }
  function unary() { ws(); if (s[pos] === '-') { pos++; const a = unary(); return env => -a(env); } if (s[pos] === '+') { pos++; return unary(); } return pow(); }
  function mul() {
    let a = unary();
    for (;;) { ws(); const op = s[pos]; if (op !== '*' && op !== '/' && op !== '·') return a; pos++; const b = unary(), l = a; a = op === '/' ? env => l(env) / b(env) : env => l(env) * b(env); }
  }
  function add() {
    let a = mul();
    for (;;) { ws(); const op = s[pos]; if (op !== '+' && op !== '-') return a; pos++; const b = mul(), l = a; a = op === '-' ? env => l(env) - b(env) : env => l(env) + b(env); }
  }
  const f = add(); ws();
  if (pos < s.length) err(`unexpected "${s.slice(pos)}"`);
  return { f, vars: [...used], src: s };
}

/** An expression compiled once per text and parameters (kept while it is in use: at most 256). */
const ML_EXPR_CACHE = new Map();
function mlExprCached(src, params = {}) {
  const k = `${src}|${JSON.stringify(params)}`;
  let c = ML_EXPR_CACHE.get(k);
  if (!c) { if (ML_EXPR_CACHE.size >= 256) ML_EXPR_CACHE.clear(); c = mlExpr(src, ML_STATE, params); ML_EXPR_CACHE.set(k, c); }
  return c;
}

// ---- scalar quantities ----
class MLRangeError extends Error {}
/** Where a value comes from. */
const ML_SRC = { measured: 'Measured', fitted: 'Fitted', supplier: 'Supplier', published: 'Published', calculated: 'Calculated', user: 'User-defined', none: 'No source' };
/**
 * The built-in laws: vars (the state they take), params (each with its unit), f(params, state) in SI, the formula as
 * shown, and where the law is from. (The solvers' own laws, so a material can name the one its solver uses.)
 */
const ML_LAWS = {
  sutherland: { vars: ['T'], params: { y0: '', T0: 'K', S: 'K' }, f: (q, s) => q.y0 * Math.pow(s.T / q.T0, 1.5) * (q.T0 + q.S) / (s.T + q.S),
    formula: 'y0 (T/T0)^1.5 (T0 + S)/(T + S)', ref: 'Sutherland (1893); White, Viscous Fluid Flow' },
  vogel: { vars: ['T'], params: { A: 'Pa·s', B: 'K', C: 'K' }, f: (q, s) => q.A * Math.pow(10, q.B / (s.T - q.C)),
    formula: 'A · 10^(B/(T − C))', ref: 'Vogel equation (liquid water: A 2.414e-5 Pa·s, B 247.8 K, C 140 K)' },
  powerT: { vars: ['T'], params: { y0: '', T0: 'K', b: '' }, f: (q, s) => q.y0 * Math.pow(s.T / q.T0, q.b), formula: 'y0 (T/T0)^b', ref: 'power law in temperature' },
  linearT: { vars: ['T'], params: { y0: '', T0: 'K', b: '' }, f: (q, s) => q.y0 + q.b * (s.T - q.T0), formula: 'y0 + b (T − T0)', ref: 'linear in temperature' },
  polyT: { vars: ['T'], params: { c: '', T0: 'K' }, f: (q, s) => { let v = 0, x = 1; for (const ci of q.c) { v += ci * x; x *= s.T - q.T0; } return v; },
    formula: 'Σ cᵢ (T − T0)ⁱ', ref: 'polynomial in temperature' },
  idealGas: { vars: ['T', 'p'], params: { M: 'kg/mol' }, f: (q, s) => s.p * q.M / (ML_CONST.R * s.T), formula: 'p M / (R T)', ref: 'ideal gas' },
  arrhenius: { vars: ['T'], params: { A: '', Ea: 'J/mol' }, f: (q, s) => q.A * Math.exp(-q.Ea / (ML_CONST.R * s.T)), formula: 'A exp(−Ea/(R T))', ref: 'Arrhenius' },
  // graphite's heat capacity, cal/(g K) from T (K), 200–3500 K: a + b T + c/T + d/T² + e/T³ + f/T⁴ (× 4184 to J/(kg K))
  butlandMaddison: { vars: ['T'], params: { c: '' }, f: (q, s) => { const [a, b, c, d, e, f] = q.c, K = s.T; return 4184 * (a + b * K + c / K + d / (K * K) + e / (K * K * K) + f / (K * K * K * K)); },
    formula: '4184 (a + b T + c/T + d/T² + e/T³ + f/T⁴)', ref: 'Butland and Maddison, J. Nucl. Mater. 49 (1973) 45' },
  // water's saturation pressure: IAPWS-IF97, region 4, eq. 30 (n1..n10)
  iapwsPsat: { vars: ['T'], params: { n: '' }, f: (q, s) => {
    const n = q.n, T = Math.min(Math.max(s.T, 273.15), 647.096);
    const th = T + n[8] / (T - n[9]), A = th * th + n[0] * th + n[1], B = n[2] * th * th + n[3] * th + n[4], C = n[5] * th * th + n[6] * th + n[7];
    return 1e6 * Math.pow(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4); }, formula: 'IAPWS-IF97 eq. 30', ref: 'IAPWS-IF97 (2007), region 4' },
};
/**
 * A scalar quantity's value at a state (SI). q:
 *   { kind: 'const', v } | { kind: 'law', law, params } | { kind: 'table', var, x, y, interp ('linear' | 'loglog' |
 *   'pchip'), } | { kind: 'piecewise', var, pieces: [{ lo, hi, q }] } | { kind: 'expr', src, params },
 *   with, on any: valid { var: [lo, hi] } and extrap ('error' | 'clamp' | 'extrapolate'; default 'error').
 * report(msg): told when a state is out of the valid range and the policy goes on.
 */
function mlQEval(q, state = {}, report) {
  if (typeof q === 'number') return q;
  const st = mlRange(q, state, report);
  switch (q.kind) {
    case 'const': return q.v;
    case 'law': { const L = ML_LAWS[q.law]; if (!L) throw new Error(`no law "${q.law}"`); return L.f(q.params, st); }
    case 'table': return mlTable(q, st[q.var], report);
    case 'piecewise': {
      const x = st[q.var], P = q.pieces;
      for (let i = 0; i < P.length; i++) if (x >= P[i].lo && (x < P[i].hi || (i === P.length - 1 && x <= P[i].hi))) return mlQEval(P[i].q, st, report);
      throw new MLRangeError(`${q.var} = ${x}: in none of its pieces`);
    }
    case 'expr': { const v = mlExprCached(q.src, q.params).f(st); if (!Number.isFinite(v)) throw new MLRangeError(`${q.src} is not finite here`); return v; }
    default: throw new Error(`a quantity of kind "${q.kind}"`);
  }
}
/** The state as the quantity takes it: outside its valid range by its policy ('error' throws, 'clamp' holds the end). */
function mlRange(q, state, report) {
  if (!q.valid) return state;
  let st = state;
  for (const [v, [lo, hi]] of Object.entries(q.valid)) {
    const x = state[v];
    if (!(x < lo || x > hi)) continue;
    const pol = q.extrap || 'error', msg = `${v} = ${x} outside ${lo}–${hi}`;
    if (pol === 'error') throw new MLRangeError(msg);
    if (report) report(`${msg}: ${pol === 'clamp' ? 'held at its end' : 'extrapolated'}`);
    if (pol === 'clamp') { if (st === state) st = { ...state }; st[v] = Math.min(Math.max(x, lo), hi); }
  }
  return st;
}
/** A table's value at x: inside by its interpolation; outside by its policy (error, clamp, extrapolate). */
function mlTable(q, x, report) {
  const X = q.x, Y = q.y, n = X.length;
  if (!Number.isFinite(x)) throw new MLRangeError(`${q.var} is not given`);
  if (x < X[0] || x > X[n - 1]) {
    const pol = q.extrap || 'error', msg = `${q.var} = ${x} outside the table's ${X[0]}–${X[n - 1]}`;
    if (pol === 'error') throw new MLRangeError(msg);
    if (report) report(`${msg}: ${pol === 'clamp' ? 'held at its end' : 'extrapolated'}`);
    if (pol === 'clamp') return x < X[0] ? Y[0] : Y[n - 1];
    const i = x < X[0] ? 0 : n - 2;   // (extrapolate: the end interval's own interpolation, carried on)
    return mlInterp(q, i, x);
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= x) lo = m; else hi = m; }
  if (x === X[lo]) return Y[lo];
  if (x === X[hi]) return Y[hi];
  return mlInterp(q, lo, x);
}
function mlInterp(q, i, x) {
  const X = q.x, Y = q.y, x0 = X[i], x1 = X[i + 1], y0 = Y[i], y1 = Y[i + 1];
  if (q.interp === 'loglog') return y0 * Math.pow(y1 / y0, Math.log(x / x0) / Math.log(x1 / x0));
  if (q.interp === 'pchip') {
    const h = x1 - x0, t = (x - x0) / h, d0 = mlPchipSlope(X, Y, i), d1 = mlPchipSlope(X, Y, i + 1);
    const h00 = (1 + 2 * t) * (1 - t) * (1 - t), h10 = t * (1 - t) * (1 - t), h01 = t * t * (3 - 2 * t), h11 = t * t * (t - 1);
    return h00 * y0 + h10 * h * d0 + h01 * y1 + h11 * h * d1;
  }
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}
/** The Fritsch–Carlson slope at node i (from its neighbours only: monotone cubic Hermite, no overshoot between monotone data). */
const mlPchipSlope = (X, Y, i) => mlPchipSlopes(X.slice(Math.max(0, i - 3), i + 4), Y.slice(Math.max(0, i - 3), i + 4))[i - Math.max(0, i - 3)];
/** Fritsch–Carlson slopes at every node. */
function mlPchipSlopes(X, Y) {
  const n = X.length, h = [], del = [], d = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = X[i + 1] - X[i]; del[i] = (Y[i + 1] - Y[i]) / h[i]; }
  if (n === 2) { d[0] = d[1] = del[0]; return d; }
  for (let i = 1; i < n - 1; i++) {
    if (del[i - 1] * del[i] <= 0) { d[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
  }
  const end = (h0, h1, d0, d1) => { let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (Math.sign(s) !== Math.sign(d0)) s = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0; return s; };
  d[0] = end(h[0], h[1], del[0], del[1]); d[n - 1] = end(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
  return d;
}
/**
 * A quantity's problems: [{ level: 'error' | 'warn', msg }] — a table's abscissa not increasing or its values not
 * finite (log–log: not positive), a piecewise function's gaps and overlaps (errors) and jumps at its joins (warnings),
 * an expression that does not parse, a law's unknown name or missing parameters.
 */
function mlQCheck(q) {
  const out = [], E = msg => out.push({ level: 'error', msg }), W = msg => out.push({ level: 'warn', msg });
  if (typeof q === 'number') { if (!Number.isFinite(q)) E('not a number'); return out; }
  if (!q || typeof q !== 'object') { E('no definition'); return out; }
  if (q.valid) for (const [v, r] of Object.entries(q.valid)) if (!(Array.isArray(r) && r[0] < r[1])) E(`its valid range of ${v} is not an interval`);
  if (q.extrap && !['error', 'clamp', 'extrapolate'].includes(q.extrap)) E(`no policy "${q.extrap}" outside its range`);
  switch (q.kind) {
    case 'const': if (!Number.isFinite(q.v)) E('its value is not a number'); break;
    case 'law': {
      const L = ML_LAWS[q.law]; if (!L) { E(`no law "${q.law}"`); break; }
      for (const k of Object.keys(L.params)) if (q.params == null || q.params[k] == null) E(`its parameter ${k} is not given`);
      break;
    }
    case 'table': {
      const { x, y } = q;
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) { E('its columns differ in length'); break; }
      if (x.length < 2) E('fewer than two points');
      for (let i = 0; i < x.length; i++) { if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) E(`point ${i + 1} is not a number`); if (i && !(x[i] > x[i - 1])) E(`${q.var} does not increase at point ${i + 1}`); }
      if (q.interp === 'loglog' && (x.some(v => !(v > 0)) || y.some(v => !(v > 0)))) E('log–log needs positive values');
      if (q.interp && !['linear', 'loglog', 'pchip'].includes(q.interp)) E(`no interpolation "${q.interp}"`);
      break;
    }
    case 'piecewise': {
      const P = q.pieces || [];
      if (!P.length) { E('no pieces'); break; }
      for (let i = 0; i < P.length; i++) {
        if (!(P[i].lo < P[i].hi)) E(`piece ${i + 1}: its range is empty`);
        for (const p of mlQCheck(P[i].q)) out.push({ ...p, msg: `piece ${i + 1}: ${p.msg}` });
        if (i) {
          const a = P[i - 1].hi, b = P[i].lo;
          if (b > a) E(`a gap between ${a} and ${b}`); else if (b < a) E(`pieces ${i} and ${i + 1} overlap from ${b} to ${a}`);
          else {
            try {
              const st = { [q.var]: a }, bare = p => (typeof p === 'number' ? p : { ...p, valid: undefined }), ya = mlQEval(bare(P[i - 1].q), st), yb = mlQEval(bare(P[i].q), st);
              if (Math.abs(ya - yb) > 1e-9 * Math.max(Math.abs(ya), Math.abs(yb), 1e-300)) W(`it jumps at ${q.var} = ${a}: ${ya} → ${yb}`);
            } catch (e) { W(`its join at ${a} cannot be evaluated (${e.message})`); }
          }
        }
      }
      break;
    }
    case 'expr': try { mlExpr(q.src, ML_STATE, q.params || {}); } catch (e) { E(e.message); } break;
    default: E(`no kind "${q.kind}"`);
  }
  return out;
}

// ---- second-order tensors ----
/**
 * A material frame → Q (3 × 3, its columns the material axes 1, 2, 3 in the part's frame). frame: undefined (the part's
 * own axes), { axes: [a1, a2, a3] } (orthonormalized: a1 kept, a2 made normal to it, a3 = a1 × a2), or
 * { euler: [φ, θ, ψ] } (degrees, intrinsic z–x–z: Q = Rz(φ) Rx(θ) Rz(ψ)).
 */
function mlFrame(frame) {
  if (!frame) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (frame.euler) {
    const [a, b, c] = frame.euler.map(d => d * Math.PI / 180), Rz = t => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
    const Rx = t => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
    return mlMatMul(mlMatMul(Rz(a), Rx(b)), Rz(c));
  }
  const n = v => { const l = Math.hypot(...v); if (!(l > 0)) throw new Error('a material axis of zero length'); return v.map(x => x / l); };
  const a1 = n(frame.axes[0]), d = frame.axes[1].reduce((s, x, i) => s + x * a1[i], 0), a2 = n(frame.axes[1].map((x, i) => x - d * a1[i]));
  const a3 = [a1[1] * a2[2] - a1[2] * a2[1], a1[2] * a2[0] - a1[0] * a2[2], a1[0] * a2[1] - a1[1] * a2[0]];
  return [0, 1, 2].map(r => [a1[r], a2[r], a3[r]]);
}
const mlMatMul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));
const mlT = A => A[0].map((_, j) => A.map(r => r[j]));
/** Voigt 6 (xx yy zz yz xz xy, tensor components) ↔ 3 × 3. */
const mlV2M = v => [[v[0], v[5], v[4]], [v[5], v[1], v[3]], [v[4], v[3], v[2]]];
const mlM2V = m => [m[0][0], m[1][1], m[2][2], m[1][2], m[0][2], m[0][1]];
/**
 * A second-order symmetric tensor property at a state → Voigt 6 in the part's frame. t:
 *   { form: 'iso', k } | { form: 'ti', axial, trans, axis ([x, y, z] in the part's frame; default z) } |
 *   { form: 'ortho', k1, k2, k3, frame } | { form: 'full', xx, yy, zz, yz, xz, xy, frame (the frame they are given in) },
 * each component a quantity (mlQEval). Transversely isotropic: K = trans I + (axial − trans) a aᵀ.
 */
function mlT2Eval(t, state, report) {
  const ev = q => mlQEval(q, state, report);
  switch (t.form) {
    case 'iso': { const k = ev(t.k); return [k, k, k, 0, 0, 0]; }
    case 'ti': {
      const ax = t.axis || [0, 0, 1], l = Math.hypot(...ax), a = ax.map(x => x / l), K1 = ev(t.axial), K2 = ev(t.trans), d = K1 - K2;
      // (about a coordinate axis, exactly the two values: the solvers' own diagonal)
      if (a.filter(x => x === 0).length === 2) return [0, 1, 2].map(i => (a[i] ? K1 : K2)).concat([0, 0, 0]);
      return [K2 + d * a[0] * a[0], K2 + d * a[1] * a[1], K2 + d * a[2] * a[2], d * a[1] * a[2], d * a[0] * a[2], d * a[0] * a[1]];
    }
    case 'ortho': {
      const k = [ev(t.k1), ev(t.k2), ev(t.k3)];
      if (!t.frame) return [k[0], k[1], k[2], 0, 0, 0];
      const Q = mlFrame(t.frame);
      return mlM2V(mlMatMul(mlMatMul(Q, [[k[0], 0, 0], [0, k[1], 0], [0, 0, k[2]]]), mlT(Q)));
    }
    case 'full': {
      const v = ['xx', 'yy', 'zz', 'yz', 'xz', 'xy'].map(c => ev(t[c]));
      if (!t.frame) return v;
      const Q = mlFrame(t.frame);
      return mlM2V(mlMatMul(mlMatMul(Q, mlV2M(v)), mlT(Q)));
    }
    default: throw new Error(`a tensor of form "${t.form}"`);
  }
}
/**
 * The tensor in a solver's frame: axes, the part's axis each of the solver's axes runs along (0, 1, 2; the solver's
 * dimension = axes.length), as a diagonal [K_aa, K_bb(, K_cc)] when it is (the solvers' fast path) or as the full
 * block { d: [...], off: [K_ab] (2D) | [K_bc, K_ac, K_ab] (3D) }. 1D: the one component (exact when the field varies
 * along that axis only); 2D: the in-plane block (exact when nothing varies along the third).
 */
function mlT2Proj(v, axes) {
  const M = mlV2M(v), d = axes.map(a => M[a][a]);
  if (axes.length === 1) return d[0];
  const off = axes.length === 2 ? [M[axes[0]][axes[1]]] : [M[axes[1]][axes[2]], M[axes[0]][axes[2]], M[axes[0]][axes[1]]];
  return off.every(x => x === 0) ? d : { d, off };
}
/** The eigenvalues of a symmetric 3 × 3 (Voigt 6), largest first (trigonometric; exact for a diagonal one). */
function mlEig3(v) {
  const [a, b, c, d, e, f] = v, p1 = f * f + e * e + d * d;
  if (p1 <= 1e-30 * (a * a + b * b + c * c + 1e-300)) return [a, b, c].sort((x, y) => y - x);
  const q = (a + b + c) / 3, p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6);
  const B = [(a - q) / p, (b - q) / p, (c - q) / p, d / p, e / p, f / p];
  const det = B[0] * (B[1] * B[2] - B[3] * B[3]) - B[5] * (B[5] * B[2] - B[3] * B[4]) + B[4] * (B[5] * B[3] - B[1] * B[4]);
  const r = Math.min(1, Math.max(-1, det / 2)), phi = Math.acos(r) / 3;
  const l1 = q + 2 * p * Math.cos(phi), l3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3);
  return [l1, 3 * q - l1 - l3, l3];
}
/** A conduction-like tensor's problems (positive definite: the heat or the flow goes down its gradient). */
function mlT2Check(v, name = 'the tensor', positive = true) {
  const out = [];
  if (v.some(x => !Number.isFinite(x))) return [{ level: 'error', msg: `${name}: a component is not a number` }];
  if (positive) { const l = mlEig3(v); if (!(l[2] > 0)) out.push({ level: 'error', msg: `${name} is not positive definite (eigenvalues ${l.map(x => +x.toPrecision(4)).join(', ')})` }); }
  return out;
}

// ---- stiffness: fourth-order, Voigt 6 × 6 (xx yy zz yz xz xy, engineering shear) ----
/** A 6 × 6 inverted (Gauss–Jordan with partial pivoting; mp-core's mpInv6, the same operations). */
function mlInv6(S) {
  const n = S.length, A = S.map((r, i) => { const x = new Float64Array(2 * n); x.set(r); x[n + i] = 1; return x; });
  for (let c = 0; c < n; c++) {
    let pr = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pr][c])) pr = r;
    [A[c], A[pr]] = [A[pr], A[c]];
    const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map(r => r.slice(n));
}
const mlVo = (i, j) => (i === j ? i : i + j === 1 ? 5 : i + j === 2 ? 4 : 3);   // the Voigt index of the pair i, j
/**
 * The Bond matrix of Q (columns: the material axes in the part's frame): C_part = M C_mat Mᵀ for a Voigt stiffness
 * with engineering shear (σ_part = M σ_mat).
 */
function mlBond(Q) {
  const a = Q, M = Array.from({ length: 6 }, () => new Float64Array(6)), P = [[0, 0], [1, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
  for (let I = 0; I < 6; I++) for (let J = 0; J < 6; J++) {
    const [i, j] = P[I], [k, l] = P[J];
    M[I][J] = J < 3 ? a[i][k] * a[j][l] : a[i][k] * a[j][l] + a[i][l] * a[j][k];
  }
  return M;
}
/**
 * A stiffness at a state → 6 × 6 in the part's frame. c:
 *   { form: 'iso', E, nu } | { form: 'ti', Ep, nup, Et, nupt, Gpt, axis (0, 1, 2: about a part axis, as mp-core's
 *   mpStiffness; or [x, y, z]) } | { form: 'ortho', E1, E2, E3, nu12, nu13, nu23, G12, G13, G23, frame } |
 *   { form: 'aniso', C (6 × 6 in its frame), frame },
 * each a quantity. (ν_pt: the strain along the axis from a stress in the plane, ε_t = −ν_pt σ_p / E_p.)
 */
function mlCEval(c, state, report) {
  const ev = q => mlQEval(q, state, report), S = Array.from({ length: 6 }, () => new Float64Array(6));
  let frameQ = null;
  if (c.form === 'iso') {
    const E = ev(c.E), nu = ev(c.nu), G = E / (2 * (1 + nu));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] = i === j ? 1 / E : -nu / E;
    for (let i = 3; i < 6; i++) S[i][i] = 1 / G;
    return mlInv6(S);
  }
  if (c.form === 'ti') {
    let ax = c.axis === undefined ? 2 : c.axis;
    if (Array.isArray(ax)) {
      const zeros = ax.filter(x => x === 0).length;
      if (zeros === 2) ax = ax.findIndex(x => x !== 0);
      else { frameQ = mlFrame({ axes: mlPerp(ax) }); ax = 2; }   // (about any direction: built about z, rotated)
    }
    const p = [0, 1, 2].filter(d => d !== ax), Ep = ev(c.Ep), nup = ev(c.nup), Et = ev(c.Et), nupt = ev(c.nupt), Gpt = ev(c.Gpt), Gp = Ep / (2 * (1 + nup));
    S[p[0]][p[0]] = S[p[1]][p[1]] = 1 / Ep; S[p[0]][p[1]] = S[p[1]][p[0]] = -nup / Ep;
    S[ax][ax] = 1 / Et; S[ax][p[0]] = S[p[0]][ax] = S[ax][p[1]] = S[p[1]][ax] = -nupt / Ep;
    S[mlVo(p[0], p[1])][mlVo(p[0], p[1])] = 1 / Gp;
    S[mlVo(ax, p[0])][mlVo(ax, p[0])] = 1 / Gpt; S[mlVo(ax, p[1])][mlVo(ax, p[1])] = 1 / Gpt;
  } else if (c.form === 'ortho') {
    const E = [ev(c.E1), ev(c.E2), ev(c.E3)], nu12 = ev(c.nu12), nu13 = ev(c.nu13), nu23 = ev(c.nu23);
    for (let i = 0; i < 3; i++) S[i][i] = 1 / E[i];
    S[0][1] = S[1][0] = -nu12 / E[0]; S[0][2] = S[2][0] = -nu13 / E[0]; S[1][2] = S[2][1] = -nu23 / E[1];
    S[3][3] = 1 / ev(c.G23); S[4][4] = 1 / ev(c.G13); S[5][5] = 1 / ev(c.G12);
    if (c.frame) frameQ = mlFrame(c.frame);
  } else if (c.form === 'aniso') {
    const C = c.C.map(r => r.map(ev));
    if (!c.frame) return C.map(r => Float64Array.from(r));
    return mlRotC(C, mlFrame(c.frame));
  } else throw new Error(`a stiffness of form "${c.form}"`);
  const C = mlInv6(S);
  return frameQ ? mlRotC(C, frameQ) : C;
}
/** Two directions normal to v (and to each other): a frame's first two axes, its third along v. */
function mlPerp(v) {
  const l = Math.hypot(...v), a = v.map(x => x / l), t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const d = t[0] * a[0] + t[1] * a[1] + t[2] * a[2], b1 = t.map((x, i) => x - d * a[i]);
  const b2 = [a[1] * b1[2] - a[2] * b1[1], a[2] * b1[0] - a[0] * b1[2], a[0] * b1[1] - a[1] * b1[0]];
  return [b1, b2];   // (mlFrame: a1 = b1, a2 = b2, a3 = b1 × b2 = a)
}
/** C rotated from its frame (Q) to the part's: M C Mᵀ. */
function mlRotC(C, Q) {
  const M = mlBond(Q), MC = M.map(r => C[0].map((_, j) => r.reduce((s, x, k) => s + x * C[k][j], 0)));
  return MC.map(r => Float64Array.from(M.map(m => r.reduce((s, x, k) => s + x * m[k], 0))));
}
/**
 * A stiffness for a solver of dimension dim on the part's axes `axes` (2D: [a, b], the third normal to the plane):
 * 'strain' (plane strain: the out-of-plane strains zero, its block kept) or 'stress' (the out-of-plane stresses zero:
 * condensed out). Returns the 3 × 3 on [aa, bb, ab] (2D), the 6 × 6 reordered (3D).
 */
function mlCReduce(C, axes, plane = 'strain') {
  if (axes.length === 3) { const I = [mlVo(axes[0], axes[0]), mlVo(axes[1], axes[1]), mlVo(axes[2], axes[2]), mlVo(axes[1], axes[2]), mlVo(axes[0], axes[2]), mlVo(axes[0], axes[1])]; return I.map(i => I.map(j => C[i][j])); }
  const [a, b] = axes, c = 3 - a - b, k = [mlVo(a, a), mlVo(b, b), mlVo(a, b)], o = [mlVo(c, c), mlVo(b, c), mlVo(a, c)];
  if (plane === 'strain') return k.map(i => k.map(j => C[i][j]));
  // plane stress: D = C_kk − C_ko C_oo⁻¹ C_ok (the out-of-plane block decoupled: just σcc, as mp-core's mpReduce)
  const coupled = k.some(i => C[i][o[1]] !== 0 || C[i][o[2]] !== 0) || C[o[0]][o[1]] !== 0 || C[o[0]][o[2]] !== 0;
  if (!coupled) return k.map(i => k.map(j => C[i][j] - C[i][o[0]] * C[o[0]][j] / C[o[0]][o[0]]));
  const Coo = o.map(i => o.map(j => C[i][j])), inv = mlInv3(Coo);
  return k.map(i => k.map(j => { let s = C[i][j]; for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) s -= C[i][o[p]] * inv[p][q] * C[o[q]][j]; return s; }));
}
function mlInv3(A) {
  const [[a, b, c], [d, e, f], [g, h, i]] = A, D = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[(e * i - f * h) / D, (c * h - b * i) / D, (b * f - c * e) / D], [(f * g - d * i) / D, (a * i - c * g) / D, (c * d - a * f) / D], [(d * h - e * g) / D, (b * g - a * h) / D, (a * e - b * d) / D]];
}
/** A stiffness's problems: symmetric, positive definite (Cholesky): a material that stores energy under any strain. */
function mlCCheck(C, name = 'the stiffness') {
  const out = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    if (!Number.isFinite(C[i][j])) return [{ level: 'error', msg: `${name}: C${i + 1}${j + 1} is not a number` }];
    if (Math.abs(C[i][j] - C[j][i]) > 1e-9 * Math.max(Math.abs(C[i][j]), Math.abs(C[j][i]), 1)) out.push({ level: 'error', msg: `${name} is not symmetric (C${i + 1}${j + 1} ≠ C${j + 1}${i + 1})` });
  }
  const L = Array.from({ length: 6 }, () => new Float64Array(6));
  for (let i = 0; i < 6; i++) for (let j = 0; j <= i; j++) {
    let s = C[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    if (i === j) { if (!(s > 0)) { out.push({ level: 'error', msg: `${name} is not positive definite (it would give energy under some strain)` }); return out; } L[i][i] = Math.sqrt(s); }
    else L[i][j] = s / L[j][j];
  }
  return out;
}
/** Expansion (thermal α, with water β) as a Voigt engineering strain per unit of its driver (shears doubled). */
const mlStrainV = v => [v[0], v[1], v[2], 2 * v[3], 2 * v[4], 2 * v[5]];

// ---- rheology: generalized Newtonian laws in their standard parameters ----
/** The laws, their parameters with units (K's depends on n), and the formula shown. */
const ML_RHEO = {
  newtonian: { l: 'Newtonian', params: { mu: 'Pa·s' }, formula: 'τ = μ γ̇' },
  power: { l: 'Power law', params: { K: 'Pa·s^n', n: '' }, formula: 'τ = K γ̇ⁿ' },
  hb: { l: 'Herschel–Bulkley', params: { ty: 'Pa', K: 'Pa·s^n', n: '' }, formula: 'τ = τy + K γ̇ⁿ (above τy; below it, no flow)' },
  carreau: { l: 'Carreau–Yasuda', params: { eta0: 'Pa·s', etaInf: 'Pa·s', lam: 's', a: '', n: '' }, formula: 'η = η∞ + (η0 − η∞)[1 + (λγ̇)ᵃ]^((n−1)/a)' },
  cross: { l: 'Cross', params: { eta0: 'Pa·s', etaInf: 'Pa·s', lam: 's', n: '' }, formula: 'η = η∞ + (η0 − η∞) / (1 + (λγ̇)^(1−n))' },
};
const ML_GD_REF = 2.7;   // (the shear rate the slurry's viscosity was measured at, 1/s: the solvers' anchor)
/** The law's viscosity at a shear rate (Pa s; the law itself, unregularized: gd > 0). */
function mlRheoMu(r, gd) {
  switch (r.model) {
    case 'newtonian': return r.mu;
    case 'power': return r.K * Math.pow(gd, r.n - 1);
    case 'hb': return r.ty / gd + r.K * Math.pow(gd, r.n - 1);
    case 'carreau': return r.etaInf + (r.eta0 - r.etaInf) * Math.pow(1 + Math.pow(r.lam * gd, r.a), (r.n - 1) / r.a);
    case 'cross': return r.etaInf + (r.eta0 - r.etaInf) / (1 + Math.pow(r.lam * gd, 1 - r.n));
    default: throw new Error(`no rheology model "${r.model}"`);
  }
}
/**
 * A law's problems (blocking errors: the law would not be one; warnings: allowed, but say so). K's unit Pa·sⁿ is
 * checked through n (mlRheoKUnit).
 */
function mlRheoCheck(r) {
  const out = [], E = m => out.push({ level: 'error', msg: m }), W = m => out.push({ level: 'warn', msg: m });
  const L = ML_RHEO[r.model]; if (!L) return [{ level: 'error', msg: `no rheology model "${r.model}"` }];
  for (const k of Object.keys(L.params)) if (!Number.isFinite(r[k])) E(`${k} is not given`);
  if (out.length) return out;
  if (r.model === 'newtonian' && !(r.mu > 0)) E('its viscosity must be positive');
  if ('K' in L.params && !(r.K > 0)) E(`the consistency K must be positive (it is ${r.K})`);
  if ('n' in L.params && !(r.n > 0)) E(`the flow index n must be positive (it is ${r.n}): with n ≤ 0 the stress would not rise with the shear rate`);
  if ('ty' in L.params && !(r.ty >= 0)) E('the yield stress cannot be negative');
  if ('eta0' in L.params) {
    if (!(r.etaInf >= 0)) E('η∞ cannot be negative');
    if (!(r.eta0 > r.etaInf)) E('η0 must be above η∞');
    if (!(r.lam > 0)) E('λ must be positive');
  }
  if (r.model === 'carreau' && !(r.a > 0)) E('a must be positive');
  if ('n' in L.params && r.n > 1) W(`n = ${r.n} > 1: it thickens with shear`);
  return out;
}
/** K's unit for a flow index n: Pa·sⁿ (its dimension: kg·m⁻¹·s^(n−2)). */
const mlRheoKUnit = n => mlParseUnit('Pa·s^n', { n });
/**
 * The solvers' form (cfd-solver.js muEffLocal, rheo.js rheoCompile): { muRef (the viscosity at 2.7 1/s), ty, n, x }
 * for a law in standard parameters -- exactly the same law: Herschel–Bulkley μ = τy/γ̇ + (μref − τy/2.7)(γ̇/2.7)^(n−1)
 * with μref = τy/2.7 + K 2.7^(n−1); Carreau–Yasuda and Cross with μref their viscosity at 2.7 1/s.
 */
function mlRheoToSolver(r) {
  const g = ML_GD_REF;
  switch (r.model) {
    case 'newtonian': return { muRef: r.mu, ty: 0, n: 1, x: null };
    case 'power': return { muRef: r.K * Math.pow(g, r.n - 1), ty: 0, n: r.n, x: null };
    case 'hb': return { muRef: r.ty / g + r.K * Math.pow(g, r.n - 1), ty: r.ty, n: r.n, x: null };
    case 'carreau': case 'cross': return { muRef: mlRheoMu(r, g), ty: 0, n: r.n, x: { model: r.model, etaInf: r.etaInf, L: r.lam, a: r.model === 'carreau' ? r.a : 1 } };
    default: throw new Error(`no rheology model "${r.model}"`);
  }
}
/**
 * The solvers' form back to standard parameters (a project from before MH-3): exact while the solvers' old floor
 * (K kept at 5 % of μref) was not acting; where it was, the law the old solvers used is returned with `floored` set
 * (K at that floor), and `conflict`: the viscosity at 2.7 1/s and the yield stress cannot both hold (K ≤ 0).
 */
function mlRheoFromSolver(model, muRef, ty, n, x) {
  const g = ML_GD_REF;
  if (model === 'newtonian') return { model, mu: muRef };
  if (model === 'power') return { model, K: muRef * Math.pow(g, 1 - n), n };
  if (model === 'hb') {
    const raw = muRef - ty / g, base = Math.max(raw, 0.05 * muRef);
    return { model, ty, K: base * Math.pow(g, 1 - n), n, ...(raw < 0.05 * muRef ? { floored: true, conflict: raw <= 0, Kraw: raw * Math.pow(g, 1 - n) } : {}) };
  }
  // Carreau–Yasuda, Cross: η0 such that the law gives μref at 2.7 1/s (rheo.js rheoCompile), η∞ as the old solvers capped it
  const a = model === 'cross' ? 1 : x.a, ei = Math.min(Math.max(x.etaInf || 0, 0), 0.5 * muRef);
  const t = Math.pow(x.L * g, model === 'cross' ? 1 - n : a), F = model === 'cross' ? 1 / (1 + t) : Math.pow(1 + t, (n - 1) / a);
  return { model, eta0: ei + (muRef - ei) / F, etaInf: ei, lam: x.L, n, ...(model === 'carreau' ? { a } : {}), ...(ei !== (x.etaInf || 0) ? { capped: true } : {}) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  ML_BASES, ML_UNITS, ML_SRC, ML_LAWS, ML_STATE, ML_CONST, ML_RHEO, ML_GD_REF, MLUnitError, MLExprError, MLRangeError,
  mlParseUnit, mlDimEq, mlDimStr, mlConvert, mlToSI, mlFromSI, mlExpr, mlQEval, mlQCheck, mlTable, mlPchipSlopes,
  mlFrame, mlMatMul, mlT, mlV2M, mlM2V, mlT2Eval, mlT2Proj, mlEig3, mlT2Check, mlInv6, mlVo, mlBond, mlCEval, mlRotC, mlCReduce, mlCCheck, mlStrainV,
  mlRheoMu, mlRheoCheck, mlRheoKUnit, mlRheoToSolver, mlRheoFromSolver,
};
