'use strict';
/*
 * rheofit.js — rheometer files and the fits to them (GO-1). Pure computation (Node-testable; rheo.js for the
 * laws and the structure model).
 *
 * Reading: an export in Anton Paar RheoCompass's layout (or any table with named columns): lines of text in
 * UTF-8, UTF-16 or Windows-1252; tab, semicolon or comma between cells; a decimal point or comma. A row naming
 * two or more known quantities ("Shear Rate", "Shear Stress", "Viscosity", "Storage Modulus", "Loss Modulus",
 * "Shear Strain", "Angular Frequency", "Time", ...) starts a table (RheoCompass: each interval's "Interval
 * data:" row); units in brackets in the header or on the row below; the numbers under it are the points. Units
 * are turned to SI (mPa·s, kPa, %, Hz, min ...). What kind of test a file holds follows from its columns.
 *
 * Fits: a flow curve to each law (log stress, Levenberg–Marquardt); a thixotropy test (3ITT) to the structure
 * model's rebuild time, the shear rate that halves it and its gain (one common gain from a single test; the
 * yield and viscosity gains apart when the tests recover at two or more shear rates); an amplitude sweep's
 * plateau G′, its yield point (G′ 5 % below the plateau) and flow point (G′ = G″); a frequency sweep's
 * crossover (G′ = G″: 1 / the relaxation time).
 */
const RF_R = typeof rheoCompile === 'function' ? { rheoCompile, rheoLamEq, rheoLamStep, rheoMuStruct } : require('./rheo.js');

// ---- reading ----
/** Bytes (ArrayBuffer / Uint8Array) or text -> text: UTF-16 by its byte-order mark or its zero bytes, else UTF-8 (Windows-1252 when that fails). */
function rfDecode(data) {
  if (typeof data === 'string') return data.replace(/^﻿/, '');
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const td = (enc, bytes) => new TextDecoder(enc).decode(bytes);
  if (b[0] === 0xFF && b[1] === 0xFE) return td('utf-16le', b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return td('utf-16be', b.subarray(2));
  if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return td('utf-8', b.subarray(3));
  let zOdd = 0, zEven = 0;
  for (let i = 0; i < Math.min(b.length, 4000); i++) if (!b[i]) { if (i % 2) zOdd++; else zEven++; }
  if (zOdd > 20 && zOdd > 4 * zEven) return td('utf-16le', b);
  if (zEven > 20 && zEven > 4 * zOdd) return td('utf-16be', b);
  const u = td('utf-8', b);
  return u.includes('�') ? td('windows-1252', b) : u;
}
/** The quantities a column can hold: key, the names it goes by (lower case), its SI unit. */
const RF_QTY = [
  ['gd', [/^shear rate$/, /^rate$/, /^shear rate \(|^gamma[ -]?dot$/, /^γ̇$/], '1/s'],
  ['tau', [/^shear stress$/, /^stress$/, /^τ$/], 'Pa'],
  ['eta', [/^viscosity$/, /^apparent viscosity$/, /^η$/], 'Pa·s'],
  ['etaC', [/^complex viscosity$/, /^\|η\*\|$/], 'Pa·s'],
  ['G1', [/^storage modulus$/, /^g'$/, /^g′$/], 'Pa'],
  ['G2', [/^loss modulus$/, /^g''$/, /^g″$/], 'Pa'],
  ['strain', [/^shear strain$/, /^strain$/, /^deformation$/, /^γ$/], '1'],
  ['omega', [/^angular frequency$/, /^ω$/], 'rad/s'],
  ['freq', [/^frequency$/], 'Hz'],
  ['t', [/^time$/, /^interval time$/, /^measuring time$/, /^meas\. time$/, /^t$/], 's'],
  ['T', [/^temperature$/], '°C'],
  ['torque', [/^torque$/], 'N·m'],
  ['pt', [/^point no\.?$/, /^point$/, /^meas\. pts\.?$/, /^no\.?$/], ''],
];
/** A header cell: its quantity key and the unit written in it ("Shear Rate [1/s]", "Viscosity (mPa·s)"). */
function rfHeadCell(c) {
  const m = String(c || '').trim().match(/^(.*?)\s*(?:\[([^\]]*)\]|\(([^)]*)\))?\s*$/);
  const name = (m ? m[1] : c).trim().toLowerCase().replace(/\s+/g, ' '), unit = m ? (m[2] ?? m[3] ?? null) : null;
  for (const [k, res] of RF_QTY) if (res.some(re => re.test(name))) return { k, unit };
  return null;
}
/** A unit's factor to SI for a quantity (null: a unit the reader does not know). */
function rfUnit(k, unit) {
  const u = String(unit ?? '').trim().replace(/\s+/g, '').replace(/[·•*.]/g, '').toLowerCase();
  if (!u || u === '[]') return k === 'strain' ? 1 : 1;
  const pa = { pa: 1, mpa: 1e-3, kpa: 1e3, µpa: 1e-6, μpa: 1e-6, upa: 1e-6 };
  if (k === 'tau' || k === 'G1' || k === 'G2') return pa[u] ?? null;
  if (k === 'eta' || k === 'etaC') return { pas: 1, mpas: 1e-3, cp: 1e-3, p: 0.1, kpas: 1e3 }[u] ?? null;
  if (k === 'gd') return { '1/s': 1, 's^-1': 1, 's-1': 1, '1/min': 1 / 60 }[u] ?? null;
  if (k === 'strain') return { '%': 0.01, '1': 1, '-': 1, 'mm/mm': 1, '‰': 1e-3 }[u] ?? null;
  if (k === 'omega') return { 'rad/s': 1, '1/s': 1, 's^-1': 1 }[u] ?? null;
  if (k === 'freq') return { hz: 1 }[u] ?? null;
  if (k === 't') return { s: 1, min: 60, h: 3600, ms: 1e-3 }[u] ?? null;
  if (k === 'torque') return { nm: 1, mnm: 1e-3, µnm: 1e-6, μnm: 1e-6, unm: 1e-6 }[u] ?? null;
  return 1;
}
/**
 * Read a rheometer export. Returns { name, tables: [{ title, cols: { key: Float64Array (SI) }, units: { key: written unit }, n }],
 * kind: 'flow' | '3itt' | 'amp' | 'freq' | null, warnings } -- each table an interval (RheoCompass) or the file's one table.
 */
function rfRead(data, name = '') {
  const text = rfDecode(data), lines = text.split(/\r\n|\n|\r/);
  const tabs = lines.filter(l => l.includes('\t')).length, semi = lines.filter(l => l.includes(';')).length;
  const sep = tabs ? '\t' : semi > lines.length / 4 ? ';' : ',';
  const split = l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
  const rows = lines.map(split);
  // (a decimal comma: cells like 1,25 or -3,5E-02, with the cells not split on commas)
  let dc = 0, dp = 0;
  if (sep !== ',') for (const r of rows) for (const c of r) { if (/^[-+]?\d+,\d+(e[-+]?\d+)?$/i.test(c)) dc++; else if (/^[-+]?\d*\.\d+(e[-+]?\d+)?$/i.test(c)) dp++; }
  const comma = dc > dp;
  const num = c => { if (c == null) return NaN; let s = String(c).trim(); if (!s) return NaN; if (comma) s = s.replace(',', '.'); return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? +s : NaN; };
  const tables = [], warnings = [];
  let title = '', cur = null;
  const close = () => { if (cur && cur.n) tables.push(cur); cur = null; };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const heads = r.map(rfHeadCell), known = heads.filter(Boolean).length;
    if (known >= 2 && heads.filter((h, j) => h && !Number.isFinite(num(r[j]))).length >= 2) {
      close();
      // (units on the row below, when it has no numbers where the quantities are)
      const nx = rows[i + 1] || [], unitRow = heads.some((h, j) => h && nx[j] != null && nx[j] !== '' && !Number.isFinite(num(nx[j])));
      const cols = {}, units = {}, fac = {};
      heads.forEach((h, j) => {
        if (!h || h.k in cols) return;
        const u = h.unit ?? (unitRow ? (nx[j] || '').replace(/^\[|\]$/g, '') : '');
        const f = rfUnit(h.k, u);
        if (f == null) { warnings.push(`${r[j]}: unit "${u}" not known; the column is left out`); return; }
        cols[h.k] = j; units[h.k] = u; fac[h.k] = f;
      });
      cur = { title: title || (r[0] && !rfHeadCell(r[0]) ? r[0].replace(/:$/, '') : ''), idx: cols, units, fac, data: Object.fromEntries(Object.keys(cols).map(k => [k, []])), n: 0 };
      if (unitRow) i++;
      continue;
    }
    // (a label in the first cell -- "Result:", "Interval and data points:" -- is not a point: it ends a table; a result's name titles the next)
    if (r[0] && !Number.isFinite(num(r[0]))) { if (/^(result|test)\b/i.test(r[0]) && r[1]) title = r[1]; close(); continue; }
    if (!cur) continue;
    const vals = Object.entries(cur.idx).map(([k, j]) => [k, num(r[j])]);
    const main = vals.filter(([k]) => k !== 'pt' && k !== 'T' && k !== 't');
    if (!main.length || main.every(([, v]) => !Number.isFinite(v))) { if (r.join('').trim() && cur.n) close(); continue; }
    for (const [k, v] of vals) cur.data[k].push(v * cur.fac[k]);
    cur.n++;
  }
  close();
  for (const t of tables) {
    t.cols = Object.fromEntries(Object.entries(t.data).map(([k, a]) => [k, Float64Array.from(a)]));
    if (t.cols.freq && !t.cols.omega) { t.cols.omega = t.cols.freq.map(f => 2 * Math.PI * f); t.units.omega = 'rad/s (from Hz)'; }
    if (t.cols.gd && t.cols.eta && !t.cols.tau) t.cols.tau = t.cols.eta.map((e, i) => e * t.cols.gd[i]);
    if (t.cols.gd && t.cols.tau && !t.cols.eta) t.cols.eta = t.cols.tau.map((s, i) => s / t.cols.gd[i]);
    delete t.data; delete t.idx; delete t.fac;
  }
  return { name, tables, kind: rfKind(tables), warnings };
}
/** What kind of test the tables are: an amplitude or frequency sweep (G′, G″), a thixotropy test (constant shear rates in turn), a flow curve. */
function rfKind(tables) {
  if (!tables.length) return null;
  const all = k => tables.every(t => t.cols[k]), spread = a => { const f = [...a].filter(v => v > 0); return f.length ? Math.max(...f) / Math.min(...f) : 1; };
  if (all('G1') && all('G2')) {
    const sw = tables.map(t => [t.cols.strain ? spread(t.cols.strain) : 1, t.cols.omega ? spread(t.cols.omega) : 1]);
    return sw.every(([s, w]) => w > s) ? 'freq' : 'amp';
  }
  if (all('gd') && (all('eta') || all('tau'))) {
    // (a thixotropy test: its intervals each at one shear rate, the rate changing between them)
    const flat = t => spread(t.cols.gd) < 1.05;
    if (tables.length >= 3 && tables.every(flat)) return '3itt';
    if (tables.length === 1 && tables[0].cols.t) { const g = rfSteps(tables[0]); if (g.length >= 3) return '3itt'; }
    return 'flow';
  }
  return null;
}
/** One table whose shear rate steps between constant values: its steps [{ from, to, gd }]. */
function rfSteps(t) {
  const g = t.cols.gd, out = [];
  let s = 0;
  for (let i = 1; i <= g.length; i++) if (i === g.length || Math.abs(g[i] / g[s] - 1) > 0.05) { out.push({ from: s, to: i, gd: g[s] }); s = i; }
  return out.filter(x => x.to - x.from >= 2);
}

// ---- Levenberg–Marquardt (small problems) ----
/** Minimise sum r(p)^2 over p (unconstrained; transform bounded parameters outside). Returns { p, cost, iters }. */
function rfLM(res, p0, { iters = 200, tol = 1e-14 } = {}) {
  let p = p0.slice(), r = res(p), cost = r.reduce((a, v) => a + v * v, 0), mu = 1e-3, it = 0;
  const m = r.length, n = p.length;
  for (; it < iters; it++) {
    const J = [];
    for (let j = 0; j < n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(p[j])), q = p.slice(); q[j] += h;
      const rq = res(q); J.push(rq.map((v, i) => (v - r[i]) / h));
    }
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * J[b][i]; return s; }));
    const g = Array.from({ length: n }, (_, a) => { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * r[i]; return s; });
    let improved = false;
    for (let k = 0; k < 30; k++) {
      const M = A.map((row, a) => row.map((v, b) => v + (a === b ? mu * (v || 1) : 0)));
      const d = rfSolve(M, g.map(v => -v));
      if (!d) { mu *= 10; continue; }
      const q = p.map((v, j) => v + d[j]), rq = res(q), cq = rq.reduce((a, v) => a + v * v, 0);
      if (Number.isFinite(cq) && cq < cost) {
        const rel = (cost - cq) / Math.max(cost, 1e-300);
        p = q; r = rq; cost = cq; mu = Math.max(mu / 3, 1e-12); improved = true;
        if (rel < tol) return { p, cost, iters: it + 1 };
        break;
      }
      mu *= 4;
    }
    if (!improved) break;
  }
  return { p, cost, iters: it };
}
/**
 * Standard errors of the fit's variables at its optimum p: s^2 (J^T J)^-1 with s^2 = cost / (m - n) (for a
 * variable that is a log, the relative error of the value). Infinity where the data do not pin it down.
 */
function rfStdErr(res, p) {
  const r = res(p), m = r.length, n = p.length, cost = r.reduce((a, v) => a + v * v, 0);
  const J = [];
  for (let j = 0; j < n; j++) { const h = 1e-6 * Math.max(1, Math.abs(p[j])), q = p.slice(); q[j] += h; J.push(res(q).map((v, i) => (v - r[i]) / h)); }
  const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * J[b][i]; return s; }));
  const s2 = cost / Math.max(m - n, 1);
  return Array.from({ length: n }, (_, j) => { const e = new Array(n).fill(0); e[j] = 1; const x = rfSolve(A, e); return x && x[j] > 0 ? Math.sqrt(s2 * x[j]) : Infinity; });
}
/** The fit's variables' covariance s^2 (J^T J)^-1 at p, s^2 = cost / (m - n); null where J^T J is singular. */
function rfCov(res, p) {
  const r = res(p), m = r.length, n = p.length, cost = r.reduce((a, v) => a + v * v, 0);
  const J = [];
  for (let j = 0; j < n; j++) { const h = 1e-6 * Math.max(1, Math.abs(p[j])), q = p.slice(); q[j] += h; J.push(res(q).map((v, i) => (v - r[i]) / h)); }
  const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => { let s = 0; for (let i = 0; i < m; i++) s += J[a][i] * J[b][i]; return s; }));
  const s2 = cost / Math.max(m - n, 1), C = [];
  for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; const x = rfSolve(A, e); if (!x) return null; C.push(x.map(v => v * s2)); }
  return C;
}
/**
 * The relative standard errors of the values vals(p) gives (an object of numbers) at the optimum p: grad^T C grad
 * (C: rfCov). Infinity where the data do not pin a value down (or the covariance is singular); values that are 0
 * are left out. atLimit: the keys of values sitting at a bound of the fit (not pinned down either: Infinity).
 */
function rfValErr(res, p, vals, atLimit = []) {
  const C = rfCov(res, p), v0 = vals(p), keys = Object.keys(v0).filter(k => Number.isFinite(v0[k]) && v0[k] !== 0), out = {};
  const g = Object.fromEntries(keys.map(k => [k, []]));
  for (let j = 0; j < p.length; j++) { const h = 1e-6 * Math.max(1, Math.abs(p[j])), q = p.slice(); q[j] += h; const v1 = vals(q); for (const k of keys) g[k].push((v1[k] - v0[k]) / h); }
  for (const k of keys) {
    let v = NaN;
    if (C) { v = 0; for (let a = 0; a < p.length; a++) for (let b = 0; b < p.length; b++) v += g[k][a] * C[a][b] * g[k][b]; }
    out[k] = atLimit.includes(k) || !(v >= 0) ? Infinity : Math.sqrt(v) / Math.abs(v0[k]);
  }
  return out;
}
/** The keys of a fit's errors above 25 % (not pinned down by the test). */
const rfLoose = err => Object.keys(err).filter(k => !(err[k] < 0.25));
/** Gaussian elimination with partial pivoting (small dense systems). */
function rfSolve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!(Math.abs(M[piv][c]) > 1e-300)) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x.every(Number.isFinite) ? x : null;
}
const rfSig = (lo, hi) => [v => lo + (hi - lo) / (1 + Math.exp(-v)), x => -Math.log((hi - lo) / (x - lo) - 1)];   // (bounded parameter: to and from the fit's variable)

// ---- fits ----
/**
 * A flow curve (shear rates gd, stresses tau) fitted to each law in log stress. Returns { model: { params, app, rms,
 * err, loose } }, rms the root-mean-square of ln(model / measured) (so 0.05 is about 5 %); app the values the app
 * keeps: the viscosity at 2.7 1/s (muRef), n, the yield stress ty, and the Carreau–Yasuda / Cross extras; err their
 * relative standard errors (rfValErr), loose those above 25 % (the curve does not pin them down).
 */
function rfFitFlow(gd, tau) {
  const pts = [...gd].map((g, i) => [g, tau[i]]).filter(([g, t]) => g > 0 && t > 0);
  const lg = pts.map(([g]) => Math.log(g)), lt = pts.map(([, t]) => Math.log(t)), m = pts.length;
  const out = {}, rms = r => Math.sqrt(r.reduce((a, v) => a + v * v, 0) / m);
  // Newtonian and power law: closed form in logs
  // (each law's err: the relative standard errors of the values the app keeps, app; loose: those above 25 %)
  const withErr = (o, res, p, appOf, atLimit) => { o.err = rfValErr(res, p, appOf, atLimit); o.loose = rfLoose(o.err); return o; };
  {
    const mu = Math.exp(lt.reduce((a, v, i) => a + v - lg[i], 0) / m), res = p => lt.map((v, i) => p[0] + lg[i] - v);
    out.newtonian = withErr({ params: { mu }, app: { muRef: mu, n: 1, ty: 0 }, rms: rms(lt.map((v, i) => Math.log(mu) + lg[i] - v)) }, res, [Math.log(mu)], p => ({ muRef: Math.exp(p[0]) }));
  }
  {
    const mx = lg.reduce((a, v) => a + v, 0) / m, my = lt.reduce((a, v) => a + v, 0) / m;
    let sxy = 0, sxx = 0; for (let i = 0; i < m; i++) { sxy += (lg[i] - mx) * (lt[i] - my); sxx += (lg[i] - mx) ** 2; }
    const n = sxx > 0 ? sxy / sxx : 1, K = Math.exp(my - n * mx), res = p => lt.map((v, i) => p[0] + p[1] * lg[i] - v);
    out.power = withErr({ params: { K, n }, app: { muRef: K * Math.pow(2.7, n - 1), n, ty: 0 }, rms: rms(lt.map((v, i) => Math.log(K) + n * lg[i] - v)) }, res, [Math.log(K), n],
      p => ({ muRef: Math.exp(p[0]) * Math.pow(2.7, p[1] - 1), n: p[1] }));
  }
  // Herschel–Bulkley: ty + K gd^n (ty >= 0: squared; n in (0.05, 2))
  {
    const [nF, nI] = rfSig(0.05, 2), pw = out.power.params;
    const model = p => { const ty = p[0] * p[0], K = Math.exp(p[1]), n = nF(p[2]); return { ty, K, n }; };
    const res = p => { const { ty, K, n } = model(p); return pts.map(([g, t], i) => Math.log(ty + K * Math.pow(g, n)) - lt[i]); };
    let best = null;
    for (const f of [0, 0.3, 0.7]) {
      const t0 = f * Math.min(...pts.map(q => q[1])), r = rfLM(res, [Math.sqrt(t0), Math.log(pw.K * (1 - f) + 1e-12), nI(Math.min(1.9, Math.max(0.1, pw.n)))]);
      if (!best || r.cost < best.cost) best = r;
    }
    const { ty, K, n } = model(best.p), appOf = p => { const q = model(p); return { muRef: q.ty / 2.7 + q.K * Math.pow(2.7, q.n - 1), n: q.n, ty: q.ty }; };
    out.hb = withErr({ params: { ty, K, n }, app: appOf(best.p), rms: rms(res(best.p)) }, res, best.p, appOf, n < 0.05 + 2e-3 || n > 2 - 2e-3 ? ['n'] : []);
  }
  // Carreau–Yasuda and Cross: eta0, eta_inf (logs), L (log), a (0.2..5), n (0.05..1.2)
  for (const model of ['carreau', 'cross']) {
    const [nF, nI] = rfSig(0.05, 1.2), [aF, aI] = rfSig(0.2, 5);
    // (the fit's variables: ln eta0, ln eta_inf, ln L, then a (Carreau–Yasuda only) and n, bounded)
    const cy = model === 'carreau', lawOf = p => { const e0 = Math.exp(p[0]), ei = Math.exp(p[1]), L = Math.exp(p[2]), a = cy ? aF(p[3]) : 1, n = nF(p[cy ? 4 : 3]); return { e0, ei, L, a, n }; };
    const etaOf = (q, g) => { const t = Math.pow(q.L * g, model === 'cross' ? 1 - q.n : q.a); return q.ei + (q.e0 - q.ei) * (model === 'cross' ? 1 / (1 + t) : Math.pow(1 + t, (q.n - 1) / q.a)); };
    const res = p => { const q = lawOf(p); return pts.map(([g], i) => Math.log(etaOf(q, g) * g) - lt[i]); };
    const e = pts.map(([g, t]) => t / g), e0 = Math.max(...e), ei = Math.min(...e) * 0.01;
    let best = null;
    for (const L0 of [0.01, 1, 100]) for (const n0 of [0.3, 0.7]) {
      const r = rfLM(res, [Math.log(e0), Math.log(ei), Math.log(L0), ...(cy ? [aI(2)] : []), nI(n0)]);
      if (!best || r.cost < best.cost) best = r;
    }
    const q = lawOf(best.p), muRef = etaOf(q, 2.7);
    const appOf = p => { const w = lawOf(p), mr = etaOf(w, 2.7); return { muRef: mr, n: w.n, etaInf: Math.min(w.ei, 0.5 * mr), L: w.L, ...(cy ? { a: w.a } : {}) }; };
    const lim = [...(q.n < 0.05 + 1e-3 || q.n > 1.2 - 1e-3 ? ['n'] : []), ...(cy && (q.a < 0.2 + 1e-3 || q.a > 5 - 1e-3) ? ['a'] : [])];
    out[model] = withErr({ params: { eta0: q.e0, etaInf: q.ei, L: q.L, a: q.a, n: q.n }, app: { muRef, n: q.n, ty: 0, etaInf: Math.min(q.ei, 0.5 * muRef), L: q.L, a: q.a }, rms: rms(res(best.p)) }, res, best.p, appOf, lim);
  }
  return out;
}
/**
 * A thixotropy test fitted to the structure model, the steady law kept (law: rheo.js's compiled law, from a flow
 * curve or the app's). pts: [{ t (s, from the test's start), gd, eta }] in order. The structure starts steady at
 * the first point's shear rate. separate: the yield and viscosity gains apart (else one common gain).
 * Returns { S: { tb, gdc, cy, ce }, err (each one's relative standard error), loose (those above 25 %: not pinned down),
 * rms, model: [eta at each point] }.
 */
function rfFit3ITT(pts, law, { separate = false, S0 } = {}) {
  const dt = pts.map((q, i) => i ? q.t - pts[i - 1].t : 0);
  const run = S => { let lam = RF_R.rheoLamEq(pts[0].gd, S); return pts.map((q, i) => { if (i) lam = RF_R.rheoLamStep(lam, q.gd, dt[i], S); return RF_R.rheoMuStruct(q.gd, lam, law, S); }); };
  const Sof = p => ({ tb: Math.exp(p[0]), gdc: Math.exp(p[1]), cy: Math.exp(p[2]), ce: Math.exp(separate ? p[3] : p[2]) });
  const res = p => { const e = run(Sof(p)); return e.map((v, i) => Math.log(v / pts[i].eta)); };
  const T = pts[pts.length - 1].t - pts[0].t, gds = pts.map(q => q.gd).filter(g => g > 0);
  const gmid = Math.sqrt(Math.min(...gds) * Math.max(...gds));
  let best = null;
  const starts = S0 ? [[S0.tb, S0.gdc, S0.cy, S0.ce]] : [];
  for (const tb of [T / 20, T / 5]) for (const gdc of [gmid / 10, gmid]) for (const c of [0.5, 3]) starts.push([tb, gdc, c, c]);
  for (const [tb, gdc, cy, ce] of starts) {
    const p0 = [Math.log(tb), Math.log(gdc), Math.log(Math.max(cy, 1e-3)), ...(separate ? [Math.log(Math.max(ce, 1e-3))] : [])];
    const r = rfLM(res, p0);
    if (!best || r.cost < best.cost) best = r;
  }
  const S = Sof(best.p), rr = res(best.p), se = rfStdErr(res, best.p);
  // (each value's relative standard error; above 25 %: the test does not pin it down)
  const err = { tb: se[0], gdc: se[1], cy: se[2], ce: separate ? se[3] : se[2] };
  return { S, err, loose: Object.keys(err).filter(k => !(err[k] < 0.25)), rms: Math.sqrt(rr.reduce((a, v) => a + v * v, 0) / rr.length), model: run(S) };
}
/** Log-log interpolation of x where y crosses y0 between points i and i + 1. */
const rfCross = (x, y, i, y0) => Math.exp(Math.log(x[i]) + (Math.log(x[i + 1]) - Math.log(x[i])) * (Math.log(y0) - Math.log(y[i])) / (Math.log(y[i + 1]) - Math.log(y[i])));
/**
 * An amplitude sweep (strain amplitudes, G′, G″; stress amplitudes if given, else |G*| strain): the plateau G′
 * (its first points), the yield point (G′ 5 % below it) and the flow point (G′ = G″), each as strain and stress.
 */
function rfAmp(strain, G1, G2, stress) {
  const n = strain.length, tau = stress || strain.map((g, i) => Math.hypot(G1[i], G2[i]) * g);
  const k = Math.max(2, Math.min(5, Math.floor(n / 6)));
  const G0 = [...G1].slice(0, k).reduce((a, v) => a + v, 0) / k;
  let iy = -1, ifl = -1;
  for (let i = 0; i < n - 1; i++) { if (iy < 0 && G1[i] >= 0.95 * G0 && G1[i + 1] < 0.95 * G0) iy = i; if (ifl < 0 && G1[i] >= G2[i] && G1[i + 1] < G2[i + 1]) ifl = i; }
  const yieldPt = iy < 0 ? null : { strain: rfCross(strain, G1, iy, 0.95 * G0), stress: null };
  if (yieldPt) yieldPt.stress = Math.exp(Math.log(tau[iy]) + (Math.log(tau[iy + 1]) - Math.log(tau[iy])) * (Math.log(yieldPt.strain) - Math.log(strain[iy])) / (Math.log(strain[iy + 1]) - Math.log(strain[iy])));
  let flowPt = null;
  if (ifl >= 0) {
    // (where ln G′ - ln G″ changes sign, linear in ln strain)
    const d0 = Math.log(G1[ifl] / G2[ifl]), d1 = Math.log(G1[ifl + 1] / G2[ifl + 1]), f = d0 / (d0 - d1);
    const s = Math.exp(Math.log(strain[ifl]) + f * (Math.log(strain[ifl + 1]) - Math.log(strain[ifl])));
    flowPt = { strain: s, stress: Math.exp(Math.log(tau[ifl]) + f * (Math.log(tau[ifl + 1]) - Math.log(tau[ifl]))) };
  }
  return { G0, yield: yieldPt, flow: flowPt };
}
/** A frequency sweep (angular frequencies, G′, G″): the crossover (G′ = G″), 1 / it the relaxation time, and G′, G″ at 1 rad/s. */
function rfFreq(omega, G1, G2) {
  const n = omega.length;
  let cross = null;
  for (let i = 0; i < n - 1 && !cross; i++) {
    const d0 = Math.log(G1[i] / G2[i]), d1 = Math.log(G1[i + 1] / G2[i + 1]);
    if (d0 === 0) cross = omega[i];
    else if (d0 * d1 < 0) cross = Math.exp(Math.log(omega[i]) + d0 / (d0 - d1) * (Math.log(omega[i + 1]) - Math.log(omega[i])));
  }
  // (G at 1 rad/s: log-log between the points either side)
  const at1 = G => { for (let i = 0; i < n - 1; i++) if ((omega[i] - 1) * (omega[i + 1] - 1) <= 0) return omega[i] === omega[i + 1] ? G[i] : Math.exp(Math.log(G[i]) + (Math.log(G[i + 1]) - Math.log(G[i])) * (0 - Math.log(omega[i])) / (Math.log(omega[i + 1]) - Math.log(omega[i]))); return null; };
  return { crossover: cross, relaxTime: cross ? 1 / cross : null, G1at1: at1(G1), G2at1: at1(G2) };
}
/** A thixotropy test's points from a read file: its tables in turn (or one table's steps), the time running on across them. */
function rf3ITTPoints(file) {
  const pts = [];
  let end = 0;
  file.tables.forEach((t, k) => {
    const c = t.cols;
    if (!c.t || !c.gd || !c.eta) return;
    // (RheoCompass may restart the time in each interval: then it runs on from the last one's end)
    const off = pts.length && c.t[0] <= end ? end : 0;
    for (let i = 0; i < t.n; i++) pts.push({ t: c.t[i] + off, gd: c.gd[i], eta: c.eta[i], interval: k });
    end = pts[pts.length - 1].t;
  });
  if (file.tables.length === 1 && pts.length) { const st = rfSteps(file.tables[0]); pts.forEach((q, i) => { q.interval = st.findIndex(x => i >= x.from && i < x.to); }); }
  return pts.filter(q => q.gd > 0 && q.eta > 0 && Number.isFinite(q.t));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { rfDecode, rfRead, rfKind, rfSteps, rfHeadCell, rfUnit, rfLM, rfStdErr, rfCov, rfValErr, rfLoose, rfFitFlow, rfFit3ITT, rfAmp, rfFreq, rf3ITTPoints };
