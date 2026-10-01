/*
 * measured.js — measured data (File > Import measured data…, and the Measured data module).
 *
 * A CSV is read, its columns matched to quantities from their header names and units (confirmed or
 * changed in a preview), and kept as a dataset of one kind: wet film across the web, wet film vs
 * settings, contact line across the web, meniscus shape, edge scallop amplitude or surface ripple
 * along the line. Coat weight (g/m², wet or dry) is turned into wet film with the slurry's density
 * and solids. Each point is compared with the model (the solved answers of the other pages, answers.js: the most detailed
 * model solved; the 1D at a point's own settings) and, on request, with the CFD (each point solved like a DOE run): a
 * table with the errors, and a parity plot. A fit adjusts 1–3 inputs to minimise the RMS % error on the 1D (a response
 * surface, in a worker, with Stop), then checks the best fit in the CFD; Apply sets the fitted values (undoable).
 * Datasets are saved in the project.
 */

const MEAS_KINDS = {
  film_z:   { l: 'Wet film across the web', pos: 'z', y: 'film', yl: 'Wet film', yu: 'mm', d: 3, cfd: true },
  film_set: { l: 'Wet film vs settings', pos: 'z?', y: 'film', yl: 'Wet film', yu: 'mm', d: 3, cfd: true, settings: true },
  cl_z:     { l: 'Contact line across the web', pos: 'z', y: 'cl', yl: 'Contact line up the exit face', yu: 'mm', d: 3, cfd: true },
  menisc:   { l: 'Meniscus shape', pos: 'x', y: 'my', yl: 'Surface height above the web', yu: 'mm', d: 3, cfd: true },
  edge_x:   { l: 'Edge scallop amplitude along the line', pos: 'x', y: 'edge', yl: 'Edge scallop amplitude', yu: 'mm', d: 3, cfd: false },
  ripple_x: { l: 'Surface ripple along the line', pos: 'x|t', y: 'ripple', yl: 'Ripple amplitude', yu: 'µm', d: 1, cfd: false },
};
const MEAS_POS = {
  z: { l: 'Across the web', u: 'mm', units: { mm: 1, cm: 10, m: 1000 } },
  x: { l: 'Downstream of the edge / blade', u: 'mm', units: { mm: 1, cm: 10, m: 1000 } },
  t: { l: 'Time after the blade', u: 's', units: { s: 1, min: 60 } },
};
const LEN_UNITS = { mm: 1, 'µm': 0.001 };
const MEAS_ROLES = [
  { k: '', l: 'Ignore' },
  { k: 'z', l: 'Position across the web', units: MEAS_POS.z.units },
  { k: 'x', l: 'Distance downstream (of the edge / blade)', units: MEAS_POS.x.units },
  { k: 't', l: 'Time after the blade', units: MEAS_POS.t.units },
  { k: 'film', l: 'Wet film thickness', units: LEN_UNITS },
  { k: 'cw', l: 'Coat weight', units: { 'g/m²': 1 } },
  { k: 'cl', l: 'Contact line up the exit face', units: LEN_UNITS },
  { k: 'my', l: 'Surface height above the web', units: LEN_UNITS },
  { k: 'edge', l: 'Edge scallop amplitude', units: LEN_UNITS },
  { k: 'ripple', l: 'Ripple amplitude', units: { 'µm': 1, mm: 1000 } },
  { k: 'set:gap', l: 'Setting: gap at the metering edge', units: LEN_UNITS },
  ...CFG.map(c => ({ k: 'set:' + c.k, l: `Setting: ${c.l}`, units: { [c.u || '(none)']: 1 } })),
];
const measRole = k => MEAS_ROLES.find(r => r.k === k) || MEAS_ROLES[0];
const measSetName = k => k === 'gap' ? 'Gap at the metering edge' : (CFG.find(c => c.k === k) || { l: k }).l;
const measSetUnit = k => k === 'gap' ? 'mm' : (CFG.find(c => c.k === k) || { u: '' }).u;
const MEAS_FIT_GROUPS = { angle: ['th', 'dth'], rheo: ['mu', 'n', 'ty'], bead: ['Pup'] };

const MEAS = { sets: [], sel: null, dock: 'compare', dockH: null, fit: null, fitSets: null, fitKeys: ['th'], fitRange: {} };
const measCfdCache = new Map();   // dataset id -> its CFD predictions (kept aside so undo does not drop them)
let measIdN = 0;
const measNewId = () => 'm' + Date.now().toString(36) + (++measIdN);
const measSelected = () => MEAS.sets.find(d => d.id === MEAS.sel) || MEAS.sets[0] || null;
const mEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const mFmt = (v, d = 3) => v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0) ? v.toPrecision(3) : v.toFixed(d);

// ---------------------------------------------------------------------
// CSV: read, match columns, build a dataset
// ---------------------------------------------------------------------
function measParseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '' && !/^\s*#/.test(l));
  if (!lines.length) throw new Error('the file is empty');
  const first = lines[0];
  const delim = [';', '\t', ','].map(d => [d, first.split(d).length - 1]).sort((a, b) => b[1] - a[1])[0][0];
  const split = line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(c => c.trim());
  };
  const rows = lines.map(split);
  const decComma = delim !== ',' && rows.slice(0, 30).some(r => r.some(c => /^[-+]?\d+,\d+(e[-+]?\d+)?$/i.test(c)));
  const num = s => {
    let t = String(s ?? '').trim().replace(/\s+/g, '');
    if (decComma) t = t.replace(',', '.');
    if (t === '') return NaN;
    const v = Number(t);
    return Number.isFinite(v) ? v : NaN;
  };
  const hasHeader = rows[0].some(c => c !== '' && !Number.isFinite(num(c)));
  const header = hasHeader ? rows.shift() : rows[0].map((_, j) => `column ${j + 1}`);
  const n = Math.max(header.length, ...rows.map(r => r.length));
  while (header.length < n) header.push(`column ${header.length + 1}`);
  return { header, rows, num, delim, decComma };
}
/** A column's quantity and unit guessed from its header ("Wet film (µm)", "z [mm]", "Coat weight g/m2", "web speed"). */
function measGuessRole(h) {
  const s = String(h).toLowerCase();
  const unitRaw = ((s.match(/[([]\s*([^)\]]+)\s*[)\]]/) || [])[1] || (s.match(/\b(g\/m2|g\/m²|gsm|µm|um|mm|cm|m\/min|kpa|pa·s|pa\.s|pas|pa|n\/m|s)\s*$/) || [])[1] || '').trim();
  const name = s.replace(/[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const unit = /^(um|µm|micron|microns|μm)$/.test(unitRaw) ? 'µm' : /^(g\/m2|g\/m²|gsm|g\/m\^2)$/.test(unitRaw) ? 'g/m²' : unitRaw;
  const has = (...w) => w.some(x => name.includes(x));
  let k = '';
  if (/coat ?weight|\bcw\b|grammage|add.?on/.test(name) || unit === 'g/m²') k = 'cw';
  else if (has('contact line', 'contact-line') || /^cl\b/.test(name)) k = 'cl';
  else if (has('scallop') || (has('edge') && has('amplitude', 'amp'))) k = 'edge';
  else if (has('ripple', 'streak')) k = 'ripple';
  else if (has('wet film', 'film', 'thickness')) k = 'film';
  else if (has('across', 'cross', 'width', 'lateral') || /^z\b/.test(name) || /\bcd\b/.test(name)) k = 'z';
  else if (has('time') || /^t\b/.test(name)) k = 't';
  else if (has('distance', 'along', 'downstream', 'from the blade', 'from blade', 'from edge') || /^x\b/.test(name) || /\bmd\b/.test(name)) k = 'x';
  else if (has('surface height', 'meniscus', 'height') || /^y\b/.test(name)) k = 'my';
  else if (has('gap')) k = 'set:gap';
  else {
    const syn = [['U', ['web speed', 'speed', 'line speed']], ['mu', ['viscosity', 'mu']], ['ty', ['yield']], ['n', ['shear-thinning', 'shear thinning', 'flow index', 'power law']],
      ['g', ['surface tension', 'gamma']], ['Pup', ['bead pressure', 'pressure', 'pup']], ['L', ['land']], ['th', ['contact angle', 'angle', 'theta']],
      ['Hm', ['scraper height', 'machine height', 'hm', 'blade height']], ['tf', ['fibre thickness', 'fiber thickness', 'web thickness', 'tf']], ['oven', ['oven']]];
    const hit = syn.find(([, ws]) => ws.some(w => name === w || name.startsWith(w + ' ') || name.includes(w)));
    if (hit) k = 'set:' + hit[0];
    else { const c = CFG.find(q => name === q.k.toLowerCase() || name === q.l.toLowerCase()); if (c) k = 'set:' + c.k; }
  }
  const role = measRole(k), units = Object.keys(role.units || {});
  const u = units.includes(unit) ? unit : unit === 'mm' && units.includes('mm') ? 'mm' : units[0] || '';
  return { k, u };
}
/** The kind a set of column roles suggests. */
function measGuessKind(roles) {
  const r = new Set(roles), sets = roles.some(k => k.startsWith('set:'));
  if (r.has('cl')) return 'cl_z';
  if (r.has('edge')) return 'edge_x';
  if (r.has('ripple')) return 'ripple_x';
  if (r.has('my')) return 'menisc';
  if ((r.has('film') || r.has('cw')) && sets) return 'film_set';
  return 'film_z';
}
/** What a kind needs from the columns (a message when it is missing, else null). */
function measMissing(kind, roles) {
  const K = MEAS_KINDS[kind], r = new Set(roles);
  const y = K.y === 'film' ? (r.has('film') || r.has('cw')) : r.has(K.y);
  if (!y) return `a column of ${K.yl.toLowerCase()}${K.y === 'film' ? ' (or coat weight)' : ''}`;
  if (K.pos === 'z' && !r.has('z')) return 'a column of position across the web';
  if (K.pos === 'x' && !r.has('x')) return 'a column of distance downstream';
  if (K.pos === 'x|t' && !r.has('x') && !r.has('t')) return 'a column of distance downstream or time';
  if (K.settings && !roles.some(k => k.startsWith('set:'))) return 'at least one setting column (web speed, viscosity, gap…)';
  return null;
}
/** The dataset's points from the parsed file and the chosen columns (skipped rows counted). */
function measBuildRows(parsed, cols, kind, cw) {
  const K = MEAS_KINDS[kind], out = [];
  let skipped = 0;
  const idx = k => cols.findIndex(c => c.k === k);
  const val = (row, j) => { const c = cols[j], f = (measRole(c.k).units || {})[c.u] ?? 1; return parsed.num(row[j]) * f; };
  const yk = K.y === 'film' ? (idx('film') >= 0 ? 'film' : 'cw') : K.y;
  for (const row of parsed.rows) {
    const p = {};
    let ok = true;
    for (const pk of ['z', 'x', 't']) { const j = idx(pk); if (j >= 0) { p[pk] = val(row, j); if (!Number.isFinite(p[pk])) ok = false; } }
    const jy = idx(yk);
    let y = jy >= 0 ? val(row, jy) : NaN;
    if (yk === 'cw') y = cw && cw.rho > 0 ? y / (cw.rho * (cw.dry ? cw.solids / 100 : 1)) : NaN;   // g/m² over kg/m³ = mm
    if (!Number.isFinite(y)) ok = false;
    if (K.settings) {
      p.set = {};
      cols.forEach((c, j) => { if (c.k.startsWith('set:')) { const v = val(row, j); if (Number.isFinite(v)) p.set[c.k.slice(4)] = v; else ok = false; } });
    } else delete p.set;
    if (!K.pos.includes('z')) delete p.z;
    if (!K.pos.includes('x')) delete p.x;
    if (!K.pos.includes('t')) delete p.t;
    if (K.pos === 'x|t' && p.x == null && p.t == null) ok = false;
    if (!ok) { skipped++; continue; }
    p.y = y;
    out.push(p);
  }
  return { rows: out, skipped };
}

// ---------------------------------------------------------------------
// Predictions: the model (the solved answers, answers.js, at the inputs as they are; the 1D at a point's own settings),
// and the CFD (each point solved in the 2D on request)
// ---------------------------------------------------------------------
/** Run f with some inputs set (P) and put them back. */
function measWithP(over, f) {
  const keep = {};
  try {
    for (const k in over || {}) { keep[k] = P[k]; P[k] = over[k]; }
    return f();
  } finally { for (const k in keep) P[k] = keep[k]; }
}
/** The free surface's height above the web (mm) at x (mm downstream of the metering edge): the static meniscus from the
 *  contact line (s mm up the exit face at faceDeg, the gap H mm) down to the film h (mm); null under the exit face. */
function measMeniscusAt(x, H, h, s, faceDeg) {
  const a = faceDeg * Math.PI / 180, qx = s * Math.cos(a), qy = H + s * Math.sin(a);
  if (x < qx - 1e-9) return null;
  const rise = Math.max(0, qy - h), phic = 2 * Math.asin(Math.min(1, rise / (2 * capillaryLength())));
  const men = meniscusProfile(qx, h, phic);
  for (let i = 1; i < men.length; i++) if (men[i][0] >= x) { const [xa, ya] = men[i - 1], [xb, yb] = men[i]; return ya + (yb - ya) * (x - xa) / ((xb - xa) || 1); }
  return h;
}
/** The 1D at points (a worker of its own, the page's 1D left free): a promise of [{ film, s, dhdH?, lam0? }] (m). */
const MEAS_1D = { worker: null, id: 0, pending: new Map(), set: new Map() };
function meas1D(geos, res, ripple) {
  return new Promise((resolve, reject) => {
    if (!MEAS_1D.worker) {
      MEAS_1D.worker = makeWorker('cfd-1d-worker.js');
      MEAS_1D.worker.onmessage = e => { const q = MEAS_1D.pending.get(e.data.id); if (!q) return; MEAS_1D.pending.delete(e.data.id); if (e.data.ok) q.resolve(e.data.points); else q.reject(new Error(e.data.error)); };
      MEAS_1D.worker.onerror = e => { const all = [...MEAS_1D.pending.values()]; MEAS_1D.pending.clear(); MEAS_1D.worker = null; all.forEach(q => q.reject(new Error(e.message || 'the 1D worker failed'))); };
    }
    const id = ++MEAS_1D.id;
    MEAS_1D.pending.set(id, { resolve, reject });
    MEAS_1D.worker.postMessage({ id, points: geos, res, ripple });
  });
}
/** Stop the 1D at points (a fit): its worker ended, what waits on it told so. */
function meas1DStop() {
  if (MEAS_1D.worker) MEAS_1D.worker.terminate();
  MEAS_1D.worker = null;
  const all = [...MEAS_1D.pending.values()]; MEAS_1D.pending.clear();
  all.forEach(q => q.reject(new Error('stopped')));
}
/**
 * The model's value at each point of a dataset, at the inputs as they are: the solved answers (answers.js: the most
 * detailed model solved, across the web the 1D's profile at its level) for the film and the contact line across the web,
 * the meniscus at the web's centre, the web edge and the ripple; for the film against settings, the 1D at each point's
 * own settings (solved in the background; null until then). { vals, src } or null while solving.
 */
function measModel(ds) {
  const K = ds.kind, rows = ds.rows;
  if (K === 'film_z' || K === 'cl_z') {
    const X = ansAcross(); if (!X) return null;
    return { vals: rows.map(p => (K === 'film_z' ? ansInterp(X.z, X.film, p.z ?? 150) : ansInterp(X.z, X.s, p.z ?? 150)) * 1000), src: X.label };
  }
  if (K === 'menisc') {
    const a = ansAcrossAt(150); if (!a) return null;
    return { vals: rows.map(p => measMeniscusAt(p.x, localGap(150), a.film * 1000, a.s * 1000, CFDG.exitAngle)), src: `${a.label}, at the web's centre; the static meniscus from its contact line` };
  }
  if (K === 'edge_x') { const ed = edgeOutlook(); if (!ed) return null; return { vals: rows.map(p => edgeAmplitudeAt(p.x, ed.h)), src: `the edge bead on the film at the ${ed.side} edge, ${ed.label}` }; }
  if (K === 'ripple_x') { const sf = surfaceOutlook(); if (!sf) return null; return { vals: rows.map(p => sf.lv.at(p.t ?? p.x / 1000 / (P.U / 60)) * 1e6), src: `the 1D's levelling at L${sf.loc + 1}, on the film ${ansFrom(sf.src)}` }; }
  // (film against settings: the 1D at each point's settings)
  const geos = rows.map(p => oneDFromGeo(measGeometry(ds, p, null))), key = JSON.stringify(geos), c = MEAS_1D.set.get(ds.id);
  if (c && c.key === key) return c.vals ? { vals: c.vals, src: '1D at each point\'s settings' } : null;
  const job = { key, vals: null };
  MEAS_1D.set.set(ds.id, job);
  meas1D(geos, null, null).then(out => { job.vals = out.map(o => o && Number.isFinite(o.film) ? o.film * 1000 : null); if (MEAS_1D.set.get(ds.id) === job && tab === 6) renderMeasured(); }).catch(() => { if (MEAS_1D.set.get(ds.id) === job) MEAS_1D.set.delete(ds.id); });
  return null;
}
/** The CFD geometry for a point (a location at its position across the web, its settings; others as in 2D CFD). */
function measGeometry(ds, p, over) {
  const loc = CFD_LOCS[0], keep = { z: loc.z, over: loc.over, solver: loc.solver };
  const set = p.set || {}, pOver = { ...(over || {}) };
  for (const k in set) if (k !== 'gap') pOver[k] = set[k];
  return measWithP(pOver, () => {
    try {
      loc.solver = {};
      loc.over = {};
      if (p.z != null) loc.z = p.z;
      else { loc.z = CFD_WEB_WIDTH_MM / 2; loc.over.gap = gapHeight(); loc.over.th = P.th; }   // (no position: the web without its variation)
      if (set.gap != null) loc.over.gap = set.gap;
      return cfdGeometry(0);
    } finally { Object.assign(loc, keep); }
  });
}
/** A CFD result's value for a point (the dataset's unit). */
function measCfdValue(kind, r, geo, p) {
  if (kind === 'film_z' || kind === 'film_set') return r.Q / geo.U * 1000;
  if (kind === 'cl_z') return r.sCL * 1000;
  if (kind === 'menisc') {
    const xe = r.xe, iCL = r.iCL, xs = r.xTop, ys = r.yTop, x = xe + p.x / 1000;
    if (x < xs[iCL] - 1e-9) return null;
    for (let i = iCL + 1; i < xs.length; i++) if (xs[i] >= x) return (ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1)) * 1000;
    return r.hEnd * 1000;
  }
  return null;
}
const measCfdKey = (ds, over) => JSON.stringify(ds.rows.map(p => cfdInputsKey(measGeometry(ds, p, over))));
/** % errors of predictions against the measurements (a point measured as 0: against the dataset's mean size). */
function measErrors(ds, pred) {
  const scale = ds.rows.reduce((a, p) => a + Math.abs(p.y), 0) / (ds.rows.length || 1) || 1;
  return ds.rows.map((p, i) => pred[i] == null ? null : (pred[i] - p.y) / (Math.abs(p.y) > 1e-9 * scale ? Math.abs(p.y) : scale) * 100);
}
function measStats(errs) {
  const e = errs.filter(v => v != null && Number.isFinite(v));
  if (!e.length) return null;
  return { n: e.length, rms: Math.sqrt(e.reduce((a, v) => a + v * v, 0) / e.length), bias: e.reduce((a, v) => a + v, 0) / e.length, max: Math.max(...e.map(Math.abs)) };
}

// ---- CFD: a queue of solves (unique geometries), as many at a time as the DOE's setting ----
const MQ = { jobs: [], active: new Set() };   // (jobs: { geo, onDone, owner })
function measQueue(geo, onDone, owner) { MQ.jobs.push({ geo, onDone, owner }); measPump(); }
/** Drop the solves of one owner (queued and running). */
function measDropOwner(owner) {
  MQ.jobs = MQ.jobs.filter(j => j.owner !== owner);
  for (const j of [...MQ.active]) if (j.owner === owner) { j.worker.terminate(); MQ.active.delete(j); }
  measPump();
}
function measPump() {
  while (MQ.active.size < Math.max(1, DOE.workers) && MQ.jobs.length) {
    const job = MQ.jobs.shift(), w = makeWorker('cfd-worker.js');
    job.worker = w; MQ.active.add(job);
    const end = (r, err) => { w.terminate(); MQ.active.delete(job); try { job.onDone(r, err); } finally { measPump(); } };
    w.onmessage = e => {
      if (!MQ.active.has(job) || e.data.progress) return;   // (dropped or stopped: its late events ignored)
      const r = e.data.ok ? e.data.result : null;
      if (!r) end(null, e.data.error || 'no solution');
      else if (!r.converged && !(r.stalled && r.residual < 1e-4)) end(null, `did not converge (residual ${r.residual.toExponential(1)})`);
      else end(r, null);
    };
    w.onerror = e => { if (MQ.active.has(job)) end(null, e.message || 'worker error'); };
    w.postMessage(cfdWorkerMessage(job.geo));
  }
}
function measStopCfd() {
  for (const j of MQ.active) j.worker.terminate();
  MQ.active.clear(); MQ.jobs.length = 0;
  for (const ds of MEAS.sets) if (ds.cfd && ds.cfd.status === 'running') { ds.cfd.status = 'stopped'; measCfdCache.set(ds.id, ds.cfd); }
  if (MEAS.fit && MEAS.fit.cfd && MEAS.fit.cfd.status === 'running') MEAS.fit.cfd.status = 'stopped';
  renderMeasured();
}
/**
 * Solve the dataset's points in the CFD (each different geometry once); `over`: inputs set for the
 * solve (the fit's check). Calls back with the values and errors per point.
 */
function measSolve(ds, over, onUpdate, owner = ds) {
  const geos = ds.rows.map(p => measGeometry(ds, p, over));
  const out = { status: 'running', key: JSON.stringify(geos.map(cfdInputsKey)), vals: ds.rows.map(() => null), errs: ds.rows.map(() => null), done: 0, total: 0, t0: Date.now() };
  const groups = new Map();
  geos.forEach((g, i) => {
    const errs = checkGeometry(g, null).filter(q => q.level === 'error');
    if (errs.length) { out.errs[i] = errs.map(q => q.text).join(' '); return; }
    const k = cfdInputsKey(g);
    if (!groups.has(k)) groups.set(k, { geo: g, pts: [] });
    groups.get(k).pts.push(i);
  });
  out.total = groups.size;
  if (!groups.size) { out.status = 'done'; onUpdate(out); return out; }
  for (const { geo, pts } of groups.values()) {
    measQueue(geo, (r, err) => {
      if (out.status !== 'running') return;
      for (const i of pts) { if (r) { const v = measCfdValue(ds.kind, r, geo, ds.rows[i]); out.vals[i] = v != null && Number.isFinite(v) ? v : null; } else out.errs[i] = err; }
      out.done++;
      if (out.done >= out.total) { out.status = 'done'; out.t1 = Date.now(); }
      onUpdate(out);
    }, owner);
  }
  onUpdate(out);
  return out;
}
function measRunCfd(ds) {
  if (!ds || !MEAS_KINDS[ds.kind].cfd) return;
  if (ds.cfd && ds.cfd.status === 'running') return;
  logCFD(null, `measured data "${ds.name}": solving ${ds.rows.length} points in the CFD`);
  ds.cfd = measSolve(ds, null, out => {
    ds.cfd = out; measCfdCache.set(ds.id, out);
    if (out.status === 'done') {
      const st = measStats(measErrors(ds, out.vals));
      logCFD(null, `measured data "${ds.name}": CFD solved${st ? `, RMS error ${st.rms.toFixed(1)} %` : ''}`, 'ok');
    }
    renderMeasured();
  });
  measCfdCache.set(ds.id, ds.cfd);
  renderMeasured();
}
const measCfdStale = ds => !!(ds.cfd && ds.cfd.status !== 'running' && ds.cfd.key !== measCfdKey(ds));

// ---------------------------------------------------------------------
// Fit: on the 1D, each input's range scaled to 0..1 (a response surface, Nelder–Mead on it; nelderMead below)
// ---------------------------------------------------------------------
function nelderMead(f, x0, { maxIter = 300, tol = 1e-7, step = 0.15 } = {}) {
  const n = x0.length;
  let simplex = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] = x[i] + (x[i] + step <= 1 ? step : -step); simplex.push(x); }
  let fs = simplex.map(f);
  for (let it = 0; it < maxIter; it++) {
    const order = fs.map((v, i) => i).sort((a, b) => fs[a] - fs[b]);
    simplex = order.map(i => simplex[i]); fs = order.map(i => fs[i]);
    if (Math.abs(fs[n] - fs[0]) < tol * (1 + Math.abs(fs[0]))) break;
    const c = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((a, x) => a + x[j], 0) / n);
    const at = t => c.map((v, j) => v + t * (simplex[n][j] - v));
    const xr = at(-1), fr = f(xr);
    if (fr < fs[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { simplex[n] = xe; fs[n] = fe; } else { simplex[n] = xr; fs[n] = fr; } }
    else if (fr < fs[n - 1]) { simplex[n] = xr; fs[n] = fr; }
    else {
      const xc = fr < fs[n] ? at(-0.5) : at(0.5), fc = f(xc);
      if (fc < Math.min(fr, fs[n])) { simplex[n] = xc; fs[n] = fc; }
      else { for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])); fs[i] = f(simplex[i]); } }
    }
  }
  const b = fs.indexOf(Math.min(...fs));
  return { x: simplex[b], f: fs[b] };
}
function measFitRange(k) { const c = CFG.find(q => q.k === k), r = MEAS.fitRange[k] || {}; return { lo: r.lo ?? c.min, hi: r.hi ?? c.max }; }
/** RMS % error over the datasets' points of predictions vals (per dataset, at its points); 1e6 when under half have one. */
function measFitErrorOf(sets, vals) {
  const e = [];
  sets.forEach((ds, j) => { for (const v of measErrors(ds, vals[j] || ds.rows.map(() => null))) e.push(v); });
  const ok = e.filter(v => v != null && Number.isFinite(v));
  if (ok.length < Math.max(1, e.length * 0.5)) return 1e6;
  return Math.sqrt(ok.reduce((a, v) => a + v * v, 0) / ok.length);
}
/**
 * The fit's model: the 1D (60 × 80, within 0.02 % of the page's) with inputs set, for each `over` in overs: per over, per
 * dataset, the values at its points. The 1D at every point (the film, the contact line), at the web's centre (the
 * meniscus), at its two edges (the edge bead: the one larger at the oven, as the Web edge page) and at the four locations
 * (the ripple: where the most is left at the oven, as the Film surface page). Every different geometry is solved once.
 */
async function measFitEval(sets, overs) {
  const geos = [], rip = [], idx = new Map();
  const add = (g, r) => { const k = JSON.stringify(g); if (!idx.has(k)) { idx.set(k, geos.length); geos.push(g); rip.push(!!r); } else if (r) rip[idx.get(k)] = true; return idx.get(k); };
  const plans = overs.map(over => sets.map(ds => {
    const K = ds.kind;
    if (K === 'film_z' || K === 'cl_z' || K === 'film_set') return { rows: ds.rows.map(p => add(oneDFromGeo(measGeometry(ds, p, over)))) };
    if (K === 'menisc') { const g = oneDFromGeo(measGeometry(ds, {}, over)); return { g, i: add(g) }; }
    if (K === 'edge_x') { const zs = acrossPositions(); return { ends: [zs[0], zs[zs.length - 1]].map(z => add(oneDFromGeo(measGeometry(ds, { z }, over)))) }; }
    if (K === 'ripple_x') { const gs = measWithP(over, () => CFD_LOCS.map((_, i) => oneDGeo(i))); return { gs, locs: gs.map(g => add(g, true)) }; }
    return null;
  }));
  const out = await meas1D(geos, { nx: 60, ny: 80 }, rip);
  const got = i => out[i] && Number.isFinite(out[i].film) ? out[i] : null;
  return overs.map((over, o) => sets.map((ds, j) => measWithP(over, () => {
    const K = ds.kind, pl = plans[o][j], none = () => ds.rows.map(() => null);
    if (!pl) return none();
    if (pl.rows) return pl.rows.map(i => { const r = got(i); return r ? (K === 'cl_z' ? r.s : r.film) * 1000 : null; });
    if (K === 'menisc') { const r = got(pl.i); return r ? ds.rows.map(p => measMeniscusAt(p.x, pl.g.H * 1000, r.film * 1000, r.s * 1000, pl.g.exitAngle)) : none(); }
    if (K === 'edge_x') {
      const hs = pl.ends.map(got).filter(Boolean).map(r => r.film);
      if (!hs.length) return none();
      const h = hs.reduce((b, q) => edgeAmplitudeAt(P.oven * 1000, q) > edgeAmplitudeAt(P.oven * 1000, b) ? q : b);
      return ds.rows.map(p => edgeAmplitudeAt(p.x, h));
    }
    let best = null;   // (the ripple)
    pl.locs.forEach((i, k) => { const r = got(i); if (!r || !Number.isFinite(r.dhdH)) return; const rp = ripple1D(pl.gs[k], r.film, r.dhdH, oneDRipple(), r.lam0); const end = rp.at(rp.tRes); if (!best || end > best.end) best = { rp, end }; });
    return best ? ds.rows.map(p => best.rp.at(p.t ?? p.x / 1000 / (P.U / 60)) * 1e6) : none();
  })));
}
/** A quadratic's terms at u (0..1 each): 1, u_i, u_i u_j (i <= j). */
const measQuadTerms = u => { const t = [1, ...u]; for (let i = 0; i < u.length; i++) for (let j = i; j < u.length; j++) t.push(u[i] * u[j]); return t; };
/** Least squares of ys (nulls left out) on the design points U's quadratic terms: its coefficients, or null with too few. */
function measQuadFit(U, ys) {
  const rows = [];
  U.forEach((u, k) => { if (ys[k] != null && Number.isFinite(ys[k])) rows.push([measQuadTerms(u), ys[k]]); });
  const m = measQuadTerms(U[0]).length;
  if (rows.length < m) return null;
  const A = Array.from({ length: m }, () => new Array(m).fill(0)), b = new Array(m).fill(0);
  for (const [t, y] of rows) for (let i = 0; i < m; i++) { b[i] += t[i] * y; for (let j = 0; j < m; j++) A[i][j] += t[i] * t[j]; }
  for (let i = 0; i < m; i++) A[i][i] += 1e-12 * (Math.abs(A[i][i]) || 1);
  for (let k = 0; k < m; k++) {
    let piv = k; for (let i = k + 1; i < m; i++) if (Math.abs(A[i][k]) > Math.abs(A[piv][k])) piv = i;
    [A[k], A[piv]] = [A[piv], A[k]]; [b[k], b[piv]] = [b[piv], b[k]];
    if (!A[k][k]) return null;
    for (let i = k + 1; i < m; i++) { const f = A[i][k] / A[k][k]; if (f) { for (let j = k; j < m; j++) A[i][j] -= f * A[k][j]; b[i] -= f * b[k]; } }
  }
  const x = new Array(m).fill(0);
  for (let k = m - 1; k >= 0; k--) { let t = b[k]; for (let j = k + 1; j < m; j++) t -= A[k][j] * x[j]; x[k] = t / A[k][k]; }
  return x;
}
/** The design points of a round: `levels` levels (3, or 5 for one input) in each input over the box c ± w (kept in 0..1). */
function measDesign(c, w, levels) {
  const lv = levels === 5 ? [-1, -0.5, 0, 0.5, 1] : [-1, 0, 1], seen = new Set();
  let D = [[]];
  c.forEach(ci => { D = D.flatMap(d => lv.map(v => [...d, Math.min(1, Math.max(0, ci + w * v))])); });
  return D.filter(u => { const k = u.map(x => x.toFixed(9)).join(); if (seen.has(k)) return false; seen.add(k); return true; });
}
/**
 * The fit: 1–3 inputs adjusted, each in its range (scaled 0..1), to minimise the RMS % error over the chosen datasets, on
 * the 1D. A response surface: the 1D at a 3-level design (5 levels for one input) over a box about the current values,
 * a quadratic fitted to each point's value, its best found (Nelder–Mead from the best design points), and the box halved
 * about it, three times; then the 1D itself at the surface's best and at the best point solved, the better kept. Then the
 * best fit is solved in the CFD to check it (measFitCfdCheck). A promise of the fit (MEAS.fit); stopped: rejected.
 */
async function measRunFit() {
  const sets = MEAS.sets.filter(d => (MEAS.fitSets || [MEAS.sel]).includes(d.id));
  const keys = MEAS.fitKeys.slice(0, 3);
  if (!sets.length || !keys.length) return null;
  if (MEAS.fit) measDropOwner(MEAS.fit);   // (the previous fit's CFD check: not needed any more)
  const rng = keys.map(measFitRange), cfg = keys.map(k => CFG.find(c => c.k === k));
  const toVals = u => Object.fromEntries(keys.map((k, j) => { const x = Math.min(1, Math.max(0, u[j])); return [k, +(rng[j].lo + x * (rng[j].hi - rng[j].lo)).toPrecision(6)]; }));
  // (a value snapped to the input's step, as the slider would hold it)
  const snap = u => { const v = toVals(u); keys.forEach((k, j) => { const st = cfg[j].step; v[k] = Math.min(rng[j].hi, Math.max(rng[j].lo, +(Math.round(v[k] / st) * st).toFixed(cfg[j].d))); }); return v; };
  const start = keys.map((k, j) => Math.min(1, Math.max(0, (P[k] - rng[j].lo) / ((rng[j].hi - rng[j].lo) || 1))));
  const levels = keys.length === 1 ? 5 : 3, rounds = 3, errOf = V => measFitErrorOf(sets, V);
  const run = MEAS.fitRun = { status: 'running', done: 0, total: rounds + 1, solves: 0 };
  renderMeasFit();
  const before = Object.fromEntries(keys.map(k => [k, P[k]]));
  const Vbefore = (await measFitEval(sets, [{}]))[0];
  const tried = [];
  let c = start.slice(), w = 0.5;
  for (let r = 0; r < rounds; r++) {
    const D = measDesign(c, w, levels), V = await measFitEval(sets, D.map(toVals));
    run.solves += D.length;
    D.forEach((u, j) => tried.push({ u, err: errOf(V[j]) }));
    const coef = sets.map((ds, si) => ds.rows.map((_, i) => measQuadFit(D, V.map(v => v[si][i]))));
    const lo = c.map(x => Math.max(0, x - w)), hi = c.map(x => Math.min(1, x + w));
    const pred = u => { const t = measQuadTerms(u); return coef.map(cs => cs.map(q => q ? t.reduce((a, x, i) => a + x * q[i], 0) : null)); };
    const fs = u => errOf(pred(u)) + u.reduce((a, x, i) => a + (x < lo[i] ? lo[i] - x : x > hi[i] ? x - hi[i] : 0), 0) * 1e3;
    let best = null;
    for (const s0 of [...tried.slice().sort((p, q) => p.err - q.err).slice(0, 3).map(t => t.u), c]) { const q = nelderMead(fs, s0, { step: Math.max(0.02, w / 2) }); if (!best || q.f < best.f) best = q; }
    c = best.x.map((x, i) => Math.min(hi[i], Math.max(lo[i], x)));
    w /= 2; run.done = r + 1; renderMeasFit();
  }
  // (the 1D itself at the surface's best and at the best point solved, each snapped to the inputs' steps: the better kept)
  const bestTried = tried.slice().sort((p, q) => p.err - q.err)[0];
  const cand = [snap(c), snap(bestTried.u)], Vc = await measFitEval(sets, cand);
  run.done = rounds + 1;
  const pick = errOf(Vc[0]) <= errOf(Vc[1]) ? 0 : 1, vals = cand[pick], Vafter = Vc[pick];
  MEAS.fitRun = null;
  MEAS.fit = {
    sets: sets.map(d => d.id), keys, before, vals, t: Date.now(), model: '1D', solves: run.solves + 3,
    rmsBefore: errOf(Vbefore), rmsAfter: errOf(Vafter),
    per: sets.map((d, si) => ({ id: d.id, before: measStats(measErrors(d, Vbefore[si])), after: measStats(measErrors(d, Vafter[si])) })),
    atBound: keys.filter((k, j) => vals[k] <= rng[j].lo + 1e-9 || vals[k] >= rng[j].hi - 1e-9),
    cfd: null,
  };
  logCFD(null, `fit to measured data: ${keys.map(k => `${measSetName(k).toLowerCase()} ${before[k]} → ${vals[k]}`).join(', ')}; RMS error ${MEAS.fit.rmsBefore.toFixed(1)} % → ${MEAS.fit.rmsAfter.toFixed(1)} % (1D)`);
  measFitCfdCheck();
  renderMeasured();
  return MEAS.fit;
}
/** Stop a fit that is running (its 1D's worker ended). */
function measStopFit() { if (!MEAS.fitRun) return; MEAS.fitRun = null; meas1DStop(); renderMeasFit(); }
/** The fit's check: its datasets solved in the CFD with the fitted inputs. */
function measFitCfdCheck() {
  const fit = MEAS.fit;
  if (!fit) return;
  const sets = MEAS.sets.filter(d => fit.sets.includes(d.id) && MEAS_KINDS[d.kind].cfd);
  if (!sets.length) { fit.cfd = { status: 'none' }; return; }
  const parts = sets.map(() => null), chk = fit.cfd = { status: 'running', done: 0, total: 0, per: [] };
  const upd = () => {
    if (MEAS.fit !== fit) return;
    chk.done = parts.reduce((a, o) => a + (o ? o.done : 0), 0); chk.total = parts.reduce((a, o) => a + (o ? o.total : 0), 0);
    chk.per = sets.map((d, i) => ({ id: d.id, st: parts[i] ? measStats(measErrors(d, parts[i].vals)) : null, vals: parts[i] ? parts[i].vals : null }));
    if (parts.every(o => o && o.status === 'done')) {
      chk.status = 'done';
      const all = sets.flatMap((d, i) => measErrors(d, parts[i].vals)).filter(v => v != null);
      chk.rms = all.length ? Math.sqrt(all.reduce((a, v) => a + v * v, 0) / all.length) : null;
      logCFD(null, `fit check in the CFD: RMS error ${chk.rms != null ? chk.rms.toFixed(1) + ' %' : '—'} with the fitted inputs`, 'ok');
    }
    renderMeasured();
  };
  sets.forEach((d, i) => { measSolve(d, fit.vals, o => { parts[i] = o; upd(); }, fit); });
}
function measApplyFit() {
  const fit = MEAS.fit;
  if (!fit) return;
  undoHint(`Apply fit: ${fit.keys.map(k => `${measSetName(k).toLowerCase()} ${fit.vals[k]}`).join(', ')}`);
  // (MH-3: a fit of the viscosity at 2.7 1/s, n and the yield stress: set together, then the law's own parameter from them)
  const rheo = fit.keys.filter(k => ['mu', 'n', 'ty'].includes(k));
  for (const k of fit.keys) if (!rheo.includes(k)) setInput(k, fit.vals[k]);
  if (rheo.length) rheoSetAnchor(Object.fromEntries(rheo.map(k => [k, fit.vals[k]])));
  fit.applied = true;
  render();
}

// ---------------------------------------------------------------------
// Import: file, preview, dataset
// ---------------------------------------------------------------------
function importMeasured() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,.txt,text/csv,text/plain';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try { measPreview(await f.text(), f.name); } catch (e) { imgToast(`Could not read ${f.name}: ${e.message}`, 'error'); }
  };
  inp.click();
}
function measPreview(text, fileName) {
  const parsed = measParseCsv(text);
  const cols = parsed.header.map(h => ({ h, ...measGuessRole(h) }));
  let kind = measGuessKind(cols.map(c => c.k));
  const cw = { dry: false, rho: +slurryRho().toFixed(0), solids: +(slurrySolidsMass() * 100).toFixed(1) };   // (from the slurry's card)
  let dlg = document.getElementById('measDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'measDlg'; dlg.className = 'img-dlg meas-dlg'; dlg.setAttribute('aria-labelledby', 'measDlgH'); document.body.appendChild(dlg); }
  const name0 = fileName.replace(/\.[^.]+$/, '');
  const sample = j => parsed.rows.slice(0, 3).map(r => mEsc(r[j] ?? '')).join(' · ');
  const draw = () => {
    const roles = cols.map(c => c.k), miss = measMissing(kind, roles);
    const built = miss ? null : measBuildRows(parsed, cols, kind, cw);
    const hasCw = roles.includes('cw');
    dlg.innerHTML = `<form method="dialog" class="img-form">
      <div class="img-head"><h2 id="measDlgH">Import measured data</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
      <p class="fv-note">${mEsc(fileName)} · ${parsed.rows.length} rows · ${parsed.delim === '\t' ? 'tab' : parsed.delim === ';' ? 'semicolon' : 'comma'} separated${parsed.decComma ? ', decimal comma' : ''}. Columns are matched from their names and units: check them.</p>
      <div class="meas-grid">
        <label class="rep-field">Name <input type="text" id="measName" maxlength="80" value="${mEsc(dlg._name ?? name0)}"></label>
        <label class="rep-field">What it is <select id="measKind">${Object.entries(MEAS_KINDS).map(([k, K]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${K.l}</option>`).join('')}</select></label>
      </div>
      <div class="table-wrap meas-cols"><table class="cfd-table"><thead><tr><th>Column</th><th>Is</th><th>Unit</th><th>First values</th></tr></thead><tbody>
        ${cols.map((c, j) => { const units = Object.keys(measRole(c.k).units || {}); return `<tr><th scope="row">${mEsc(c.h)}</th>
          <td><select data-col="${j}" data-f="k" aria-label="What column ${mEsc(c.h)} is">${MEAS_ROLES.map(r => `<option value="${r.k}"${r.k === c.k ? ' selected' : ''}>${mEsc(r.l)}</option>`).join('')}</select></td>
          <td>${units.length > 1 ? `<select data-col="${j}" data-f="u" aria-label="Unit of ${mEsc(c.h)}">${units.map(u => `<option${u === c.u ? ' selected' : ''}>${u}</option>`).join('')}</select>` : `<span class="fv-why">${mEsc(units[0] || '')}</span>`}</td>
          <td class="mono">${sample(j)}</td></tr>`; }).join('')}
      </tbody></table></div>
      ${hasCw ? `<fieldset class="meas-cw"><legend>Coat weight to wet film</legend>
        <label class="img-opt"><input type="radio" name="cwk" value="wet"${cw.dry ? '' : ' checked'}> <span>Wet coat weight</span></label>
        <label class="img-opt"><input type="radio" name="cwk" value="dry"${cw.dry ? ' checked' : ''}> <span>Dry coat weight</span></label>
        <label class="fv-ctl">Slurry density <input type="number" id="measRho" min="500" max="3000" step="10" value="${cw.rho}"> kg/m³</label>
        ${cw.dry ? `<label class="fv-ctl">Solids <input type="number" id="measSolids" min="1" max="100" step="0.5" value="${cw.solids}"> %</label>` : ''}
        <p class="fv-why">Wet film (mm) = coat weight (g/m²) ÷ density (kg/m³)${cw.dry ? ' ÷ solids fraction' : ''}.</p></fieldset>` : ''}
      <p class="fv-note${miss ? ' warn-text' : ''}" id="measMsg">${miss ? `Needs ${mEsc(miss)}.` : `${built.rows.length} points${built.skipped ? `; ${built.skipped} rows skipped (empty or not numbers)` : ''}. ${mEsc(MEAS_KINDS[kind].l)}${MEAS_KINDS[kind].cfd ? ': compared with the model and, on request, the CFD.' : ': compared with the model (the CFD does not model it).'}`}</p>
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Cancel</button><button type="submit" class="btn btn-primary btn-sm" id="measGo"${miss || !built.rows.length ? ' disabled' : ''}>Import</button></div>
    </form>`;
    dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
    dlg.querySelector('#measName').oninput = e => { dlg._name = e.target.value; };
    dlg.querySelector('#measKind').onchange = e => { kind = e.target.value; draw(); };
    dlg.querySelectorAll('select[data-col]').forEach(s => {
      s.onchange = () => {
        const c = cols[+s.dataset.col];
        if (s.dataset.f === 'k') { c.k = s.value; const units = Object.keys(measRole(c.k).units || {}); if (!units.includes(c.u)) c.u = units[0] || ''; if (!measMissing(measGuessKind(cols.map(q => q.k)), cols.map(q => q.k)) && measMissing(kind, cols.map(q => q.k))) kind = measGuessKind(cols.map(q => q.k)); }
        else c.u = s.value;
        draw();
      };
    });
    dlg.querySelectorAll('input[name="cwk"]').forEach(r => { r.onchange = () => { cw.dry = r.value === 'dry'; draw(); }; });
    const rho = dlg.querySelector('#measRho'), sol = dlg.querySelector('#measSolids');
    if (rho) rho.onchange = () => { const v = +rho.value; if (v >= 500 && v <= 3000) cw.rho = v; draw(); };
    if (sol) sol.onchange = () => { const v = +sol.value; if (v > 0 && v <= 100) cw.solids = v; draw(); };
    dlg.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const b = measBuildRows(parsed, cols, kind, cw);
      if (!b.rows.length) return;
      const ds = {
        id: measNewId(), name: (dlg.querySelector('#measName').value || name0).trim() || name0, file: fileName, kind, rows: b.rows, skipped: b.skipped,
        cols: cols.filter(c => c.k).map(c => ({ h: c.h, k: c.k, u: c.u })), cw: cols.some(c => c.k === 'cw') ? { ...cw } : null, t: Date.now(),
      };
      dlg._name = null;
      dlg.close();
      undoHint(`Import measured data ${ds.name}`, TABS.indexOf('Measured data'));   // (a step of the Measured data view, wherever it was imported from)
      MEAS.sets.push(ds); MEAS.sel = ds.id;
      logCFD(null, `measured data imported: "${ds.name}", ${MEAS_KINDS[kind].l.toLowerCase()}, ${ds.rows.length} points`);
      tab = TABS.indexOf('Measured data'); render();
    };
  };
  dlg._name = null;
  draw();
  if (!dlg.open) dlg.showModal();
}
function measRemove(id) {
  const ds = MEAS.sets.find(d => d.id === id);
  if (!ds) return;
  undoHint(`Remove measured data ${ds.name}`);
  MEAS.sets = MEAS.sets.filter(d => d !== ds);
  if (MEAS.sel === id) MEAS.sel = MEAS.sets.length ? MEAS.sets[0].id : null;
  render();
}

// ---------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------
function viewMeasured() {
  oneDRequest(true);   // (the model: the solved answers across the web)
  const ds = measSelected();
  if (ds) MEAS.sel = ds.id;
  const dockTab = (k, t) => `<button type="button" role="tab" data-dock="${k}" aria-selected="${MEAS.dock === k}" aria-controls="meas-${k}">${uiIco(DOCK_ICON[k])}${t}${k === 'history' || k === 'msgs' ? `<span class="tab-n" data-n="${k}"></span>` : ''}</button>`;
  const panel = (k, body) => `<div class="dock-panel" id="meas-${k}" role="tabpanel"${MEAS.dock === k ? '' : ' hidden'}>${body}</div>`;
  document.getElementById('setupExtra').innerHTML = `<div class="tree-sep">Measured data</div>
    <details class="grp" open><summary>Datasets</summary>
      <div class="meas-list">${MEAS.sets.length ? MEAS.sets.map(d => `<div class="meas-item${d.id === MEAS.sel ? ' on' : ''}">
        <button type="button" class="meas-pick" data-id="${d.id}" aria-pressed="${d.id === MEAS.sel}"><b>${mEsc(d.name)}</b><small>${mEsc(MEAS_KINDS[d.kind].l)} · ${d.rows.length} points</small></button>
        <button type="button" class="icon-btn" data-rm="${d.id}" aria-label="Remove ${mEsc(d.name)}" title="Remove">✕</button></div>`).join('') : '<p class="prop-note">None yet: Import CSV in the toolbar above the plot.</p>'}</div>
    </details>`;
  view.innerHTML = `
    <div class="cfd-wb meas-wb" id="measWb" style="--dock-h: ${dockHCss(MEAS.dockH)}">
      <div class="vp-bar" role="toolbar" aria-label="Measured data">${subTabs()}
        <button id="measImport" class="btn btn-primary btn-sm tool-run" type="button" title="Import measured data from a CSV file">${uiIco('upload')}Import CSV…</button>
        <span class="vp-sep" aria-hidden="true"></span>
        <label class="vp-ctl">Dataset <select id="measSel"${MEAS.sets.length ? '' : ' disabled'}>${MEAS.sets.map(d => `<option value="${d.id}"${d.id === MEAS.sel ? ' selected' : ''}>${mEsc(d.name)}</option>`).join('')}</select></label>
        <button id="measCfd" class="tool-btn" type="button" title="Solve each point of this dataset in the CFD (each different point is one run)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 3v10l8-5z" fill="currentColor"/></svg>Solve in CFD</button>
        <button id="measStop" class="tool-btn tool-stop" type="button" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/></svg>Stop</button>
        <span class="doe-status" id="measStatus" role="status"></span>
        <span class="vp-spacer"></span>
        <button class="tool-btn" type="button" id="measCsv" title="Export the comparison as CSV"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 12.5h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>CSV</button>
        ${aboutButton()}
      </div>
      <div class="viewport" id="measViewport"><div class="doe-plots meas-plots" id="measPlots"></div><div class="xl-legend mod-legend" id="measLegend"></div></div>
      <div class="split split-h" id="measSplit" role="separator" aria-orientation="horizontal" aria-label="Resize the measured-data panel" tabindex="0"></div>
      <section class="dock" aria-label="Measured data">
        <div class="dock-tabs" role="tablist" aria-label="Measured data">${dockTab('compare', 'Comparison')}${dockTab('fit', 'Fit')}${dockTab('msgs', 'Messages')}${dockTab('history', 'History')}</div>
        <div class="dock-body">
          ${panel('compare', '<div id="measTable"></div>')}
          ${panel('fit', '<div id="measFit"></div>')}
          ${panel('msgs', `${msgsBar()}<div class="msg-log" role="log"></div>`)}
          ${panel('history', '<div class="history-host"></div>')}
        </div>
      </section>
    </div>`;
  document.getElementById('measImport').onclick = importMeasured;
  document.getElementById('measSel').onchange = e => { MEAS.sel = e.target.value; viewMeasured(); };
  document.querySelectorAll('.meas-pick').forEach(b => { b.onclick = () => { MEAS.sel = b.dataset.id; viewMeasured(); }; });
  document.querySelectorAll('[data-rm]').forEach(b => { b.onclick = () => measRemove(b.dataset.rm); });
  document.getElementById('measCfd').onclick = () => measRunCfd(measSelected());
  document.getElementById('measStop').onclick = measStopCfd;
  document.getElementById('measCsv').onclick = exportMeasured;
  document.querySelectorAll('#measWb .dock-tabs button').forEach(b => {
    b.onclick = () => {
      MEAS.dock = b.dataset.dock;
      document.querySelectorAll('#measWb .dock-tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
      document.querySelectorAll('#measWb .dock-panel').forEach(p => { p.hidden = p.id !== 'meas-' + MEAS.dock; });
    };
  });
  const sp = document.getElementById('measSplit'), wb = document.getElementById('measWb');
  const setH = h => { MEAS.dockH = Math.round(Math.max(140, Math.min(wb.clientHeight - 220, h))); wb.style.setProperty('--dock-h', MEAS.dockH + 'px'); };
  sp.addEventListener('pointerdown', e => {
    e.preventDefault(); sp.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = dockHNow(MEAS.dockH, wb);
    const move = ev => setH(h0 - (ev.clientY - y0));
    const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); renderMeasPlot(); };
    sp.addEventListener('pointermove', move); sp.addEventListener('pointerup', up);
  });
  sp.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setH(dockHNow(MEAS.dockH, wb) + (e.key === 'ArrowUp' ? 30 : -30)); renderMeasPlot(); } });
  renderMeasured();
}
/** Everything that follows the data and the predictions (the module showing, else nothing). */
function renderMeasured() {
  if (!document.getElementById('measWb')) return;
  const ds = measSelected(), running = MQ.active.size + MQ.jobs.length > 0;
  const cfdOk = ds && MEAS_KINDS[ds.kind].cfd;
  const b = document.getElementById('measCfd');
  b.hidden = running; b.disabled = !cfdOk;
  document.getElementById('measCsv').disabled = !ds; document.getElementById('measSel').disabled = !ds;
  b.title = !ds ? 'Import a dataset first' : cfdOk ? 'Solve each point of this dataset in the CFD (each different point is one run)' : 'The CFD does not model this quantity (the model does: the 1D and the web-edge and levelling models on its film)';
  document.getElementById('measStop').hidden = !running;
  const st = document.getElementById('measStatus');
  const c = ds && ds.cfd;
  st.innerHTML = !ds ? '' : c && c.status === 'running' ? `<i class="spin" aria-hidden="true"></i>CFD: ${c.done} of ${c.total} solved` : MEAS.fit && MEAS.fit.cfd && MEAS.fit.cfd.status === 'running' ? `<i class="spin" aria-hidden="true"></i>Fit check in the CFD: ${MEAS.fit.cfd.done} of ${MEAS.fit.cfd.total}` : `${mEsc(MEAS_KINDS[ds.kind].l)} · ${ds.rows.length} points`;
  renderMeasPlot();
  renderMeasTable();
  renderMeasFit();
  renderHistory();
  renderMessages(); renderDockCounts();
  applyHelp();
  updateProjectTitle();
}
function measRows(ds) {
  const K = MEAS_KINDS[ds.kind], m = measModel(ds), fast = m ? m.vals.map(v => v != null && Number.isFinite(v) ? v : null) : ds.rows.map(() => null), fe = measErrors(ds, fast);
  const c = ds.cfd && ds.cfd.vals ? ds.cfd : null, ce = c ? measErrors(ds, c.vals) : null;
  return { K, fast, fe, c, ce, stale: measCfdStale(ds), src: m ? m.src : null };
}
const measPosText = (ds, p) => [p.z != null ? `z ${mFmt(p.z, 1)} mm` : '', p.x != null ? `x ${mFmt(p.x, 2)} mm` : '', p.t != null ? `t ${mFmt(p.t, 2)} s` : '', ...Object.entries(p.set || {}).map(([k, v]) => `${measSetName(k).toLowerCase()} ${mFmt(v, 3)}${measSetUnit(k) ? ' ' + measSetUnit(k) : ''}`)].filter(Boolean).join(', ');
function renderMeasTable() {
  const host = document.getElementById('measTable');
  if (!host) return;
  const ds = measSelected();
  if (!ds) { host.innerHTML = '<p class="cap">No measured data yet: File > Import measured data…, or Import CSV above. A CSV with a header row: for example <span class="mono">z (mm), wet film (µm)</span>, or <span class="mono">web speed, viscosity, coat weight (g/m²)</span>.</p>'; return; }
  const { K, fast, fe, c, ce, stale, src } = measRows(ds);
  const sf = measStats(fe), sc = ce ? measStats(ce) : null, u = K.yu, pct = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
  const set = K.settings ? [...new Set(ds.rows.flatMap(p => Object.keys(p.set || {})))] : [];
  const posK = ['z', 'x', 't'].filter(k => ds.rows.some(p => p[k] != null));
  const cfdCell = i => !c ? '—' : c.vals[i] != null ? mFmt(c.vals[i], K.d) : c.errs[i] ? `<span class="warn-text" title="${mEsc(c.errs[i])}">failed</span>` : c.status === 'running' ? '…' : '—';
  const sum = (s, l) => s ? `<b>${l}</b> RMS ${s.rms.toFixed(1)} %, mean ${pct(s.bias)} %, largest ${s.max.toFixed(1)} % (${s.n} point${s.n === 1 ? '' : 's'})` : `<b>${l}</b> —`;
  host.innerHTML = `<p class="cap meas-sum">${src ? sum(sf, 'Model:') : '<b>Model:</b> solving the 1D…'}${K.cfd ? ` · ${c ? sum(sc, 'CFD:') : '<b>CFD:</b> not solved (Solve in CFD)'}${stale ? ' <span class="warn-text">out of date: inputs changed since</span>' : ''}` : ' · CFD: does not model this'}</p>
    <div class="table-wrap"><table class="cfd-table meas-table"><thead><tr><th>#</th>${posK.map(k => `<th>${MEAS_POS[k].l}<small>${MEAS_POS[k].u}</small></th>`).join('')}${set.map(k => `<th>${mEsc(measSetName(k))}<small>${mEsc(measSetUnit(k))}</small></th>`).join('')}
      <th>Measured<small>${u}</small></th><th>Model<small>${u}</small></th><th>Error<small>%</small></th>${K.cfd ? `<th>CFD<small>${u}</small></th><th>Error<small>%</small></th>` : ''}</tr></thead><tbody>
      ${ds.rows.map((p, i) => `<tr><th scope="row">${i + 1}</th>${posK.map(k => `<td>${mFmt(p[k], k === 'z' ? 1 : 2)}</td>`).join('')}${set.map(k => `<td>${mFmt((p.set || {})[k], 3)}</td>`).join('')}
        <td>${mFmt(p.y, K.d)}</td><td>${mFmt(fast[i], K.d)}</td><td>${pct(fe[i])}</td>${K.cfd ? `<td>${cfdCell(i)}</td><td>${ce ? pct(ce[i]) : '—'}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>
    <p class="fv-note">${mEsc(ds.file)}${ds.skipped ? ` · ${ds.skipped} rows skipped` : ''}${ds.cw ? ` · from ${ds.cw.dry ? 'dry' : 'wet'} coat weight, density ${ds.cw.rho} kg/m³${ds.cw.dry ? `, solids ${ds.cw.solids} %` : ''}` : ''}. Error = (predicted − measured) / measured${ds.rows.some(p => p.y === 0) ? '; points measured as 0 use the mean measured size' : ''}. ${src ? `Model: ${mEsc(src)}.` : ''}</p>`;
}
/** The parity plot: predicted against measured, the 1:1 line and ±10 %. */
function renderMeasPlot() {
  const host = document.getElementById('measPlots'), lg = document.getElementById('measLegend');
  if (!host) return;
  const ds = measSelected();
  if (!ds) {
    host.innerHTML = emptyHint('No measured data yet', 'Import a CSV with a header row (for example "z (mm), wet film (µm)" or "web speed, viscosity, coat weight (g/m²)"): the columns are matched from their names and units, and you check them before importing. Each point is then compared with the models, and a fit can adjust the uncertain inputs to your data.',
      `<button type="button" class="btn btn-primary btn-sm" data-hint-import>${uiIco('upload')}Import CSV…</button>`);
    host.querySelector('[data-hint-import]').onclick = importMeasured;
    lg.innerHTML = ''; return;
  }
  const { K, fast, c, stale } = measRows(ds);
  const cap = `Predicted against measured · ${K.yl} (${K.yu})`;
  host.innerHTML = `<figure class="pane"><figcaption>${uiBadge(6)}${mEsc(ds.name)} · ${mEsc(cap)}</figcaption><div class="xl-chart"><canvas role="img" aria-label="${mEsc(ds.name)}: ${mEsc(cap)}"></canvas><div class="xl-guide" hidden></div><div class="fv-tip" hidden></div></div></figure>`;
  const cv = host.querySelector('canvas');
  const colF = locColor(0), colC = locColor(1), muted = cssVar('--muted');
  const ptsF = ds.rows.map((p, i) => fast[i] == null ? null : [p.y, fast[i], i]).filter(Boolean);
  const ptsC = c ? ds.rows.map((p, i) => c.vals[i] == null ? null : [p.y, c.vals[i], i]).filter(Boolean) : [];
  const all = [...ds.rows.map(p => p.y), ...ptsF.map(q => q[1]), ...ptsC.map(q => q[1])].filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (!(hi > lo)) { lo -= Math.abs(lo) * 0.1 + 1e-3; hi += Math.abs(hi) * 0.1 + 1e-3; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  if (lo > 0 && lo < (hi - lo) * 0.3) lo = 0;
  const vp = document.getElementById('measViewport'), room = (vp ? vp.clientHeight : 500) - 110;
  const want = Math.min(0.75, Math.max(0.3, room / (cv.parentElement.clientWidth || 600)));
  // (y = f·x inside the square: from where it enters to where it leaves)
  const band = f => { const a = Math.max(lo, lo / f), b = Math.min(hi, hi / f); return b > a ? [[a, a * f], [b, b * f]] : []; };
  const d = K.d;
  const map = plotChart(cv, want, {
    x0: lo, x1: hi, y0: lo, y1: hi, yl: `predicted (${K.yu})`, xl: `measured (${K.yu})`, yf: v => mFmt(v, d), xf: v => mFmt(v, d),
    s: [
      { p: band(1.1), c: muted, w: 1, dash: [4, 4] }, { p: band(0.9), c: muted, w: 1, dash: [4, 4] },
      { p: [[lo, lo], [hi, hi]], c: cssVar('--ink'), w: 1 },
      { p: ptsF.map(q => [q[0], q[1]]), c: colF, line: false, dots: true },
      ...(ptsC.length ? [{ p: ptsC.map(q => [q[0], q[1]]), c: colC, line: false, dots: true }] : []),
    ],
  });
  lg.innerHTML = `<span class="lg"><i class="xl-sw" style="background:${colF}"></i>Model</span>${K.cfd ? `<span class="lg"><i class="xl-sw" style="background:${colC}"></i>CFD${c ? stale ? ' (out of date)' : '' : ' (not solved)'}</span>` : ''}<span class="lg"><i class="lg-line"></i>1:1, predicted = measured</span><span class="lg"><i class="lg-line" style="background:${muted};height:1px"></i>±10 % (dashed)</span>`;
  // (hover: the nearest point)
  const wrap = cv.parentElement, tip = wrap.querySelector('.fv-tip');
  const pts = [...ptsF.map(q => ({ q, m: 'Model', col: colF })), ...ptsC.map(q => ({ q, m: 'CFD', col: colC }))];
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    let best = null, bd = 144;
    for (const o of pts) { const dd = (map.X(o.q[0]) - px) ** 2 + (map.Y(o.q[1]) - py) ** 2; if (dd < bd) { bd = dd; best = o; } }
    if (!best) { tip.hidden = true; return; }
    const [m, pr, i] = best.q, p = ds.rows[i], err = (pr - m) / (Math.abs(m) || 1) * 100;
    tip.innerHTML = `<b>Point ${i + 1}</b>${measPosText(ds, p) ? `<span>${mEsc(measPosText(ds, p))}</span>` : ''}<span>measured ${mFmt(m, d)} ${K.yu}</span><span><i class="xl-sw" style="background:${best.col}"></i>${best.m} ${mFmt(pr, d)} ${K.yu} (${err >= 0 ? '+' : ''}${err.toFixed(1)} %)</span>`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight, gx = map.X(m);
    tip.style.left = (gx + 14 + tw > cv.clientWidth ? gx - tw - 14 : gx + 14) + 'px';
    tip.style.top = Math.max(0, Math.min(map.Y(pr) + 14, cv.clientHeight - th)) + 'px';
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
}
function renderMeasFit() {
  const host = document.getElementById('measFit');
  if (!host) return;
  if (!MEAS.sets.length) { host.innerHTML = '<p class="cap">Import measured data first.</p>'; return; }
  const chosen = new Set(MEAS.fitSets || [MEAS.sel]);
  const keys = MEAS.fitKeys, f = MEAS.fit;
  const inputRow = k => { const c = CFG.find(q => q.k === k), r = measFitRange(k); return `<tr><th scope="row">${mEsc(c.l)}</th><td>${(+P[k]).toFixed(c.d)} ${mEsc(c.u)}</td>
    <td><input type="number" data-lo="${k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${r.lo}" aria-label="${mEsc(c.l)}: lowest"> to <input type="number" data-hi="${k}" min="${c.min}" max="${c.max}" step="${c.step}" value="${r.hi}" aria-label="${mEsc(c.l)}: highest"> ${mEsc(c.u)}</td>
    <td><button type="button" class="icon-btn" data-drop="${k}" aria-label="Do not fit ${mEsc(c.l)}">✕</button></td></tr>`; };
  const fitRes = !f ? '' : (() => {
    const cfg = k => CFG.find(q => q.k === k), sets = f.sets.map(id => MEAS.sets.find(d => d.id === id)).filter(Boolean);
    const chk = f.cfd;
    return `<h3 class="dock-h">Result <small class="fv-why">${new Date(f.t).toLocaleTimeString()}</small></h3>
      <div class="table-wrap"><table class="cfd-table"><thead><tr><th>Input</th><th>Before</th><th>Fitted</th></tr></thead><tbody>
      ${f.keys.map(k => `<tr><th scope="row">${mEsc(cfg(k).l)}</th><td>${f.before[k]} ${mEsc(cfg(k).u)}</td><td><b>${f.vals[k]}</b> ${mEsc(cfg(k).u)}${f.atBound.includes(k) ? ' <span class="warn-text">at the end of its range</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="table-wrap"><table class="cfd-table"><thead><tr><th>RMS error, %</th><th>${f.model || 'Fast model'} before</th><th>${f.model || 'Fast model'} fitted</th><th>CFD fitted</th></tr></thead><tbody>
      ${f.per.map(p => { const d = MEAS.sets.find(x => x.id === p.id); const cp = chk && chk.per ? chk.per.find(x => x.id === p.id) : null; return d ? `<tr><th scope="row">${mEsc(d.name)}</th><td>${p.before ? p.before.rms.toFixed(1) : '—'}</td><td><b>${p.after ? p.after.rms.toFixed(1) : '—'}</b></td><td>${!MEAS_KINDS[d.kind].cfd ? 'not modelled' : cp && cp.st ? cp.st.rms.toFixed(1) : chk && chk.status === 'running' ? '…' : '—'}</td></tr>` : ''; }).join('')}
      <tr><th scope="row">All</th><td>${f.rmsBefore.toFixed(1)}</td><td><b>${f.rmsAfter.toFixed(1)}</b></td><td>${chk && chk.status === 'done' && chk.rms != null ? `<b>${chk.rms.toFixed(1)}</b>` : chk && chk.status === 'running' ? `solving ${chk.done} of ${chk.total}…` : chk && chk.status === 'stopped' ? 'stopped' : '—'}</td></tr>
      </tbody></table></div>
      <div class="prop-actions meas-fit-act"><button type="button" class="btn btn-primary btn-sm" id="measApply"${f.applied ? ' disabled' : ''}>${f.applied ? 'Applied' : 'Apply fitted values'}</button>${chk && chk.status === 'running' ? '<button type="button" class="btn btn-secondary btn-sm" id="measFitStop">Stop the CFD check</button>' : ''}
        <span class="fv-why">${sets.length} dataset${sets.length === 1 ? '' : 's'}; the fit uses the ${f.model ? `${f.model} (${f.solves} solves of each point)` : 'fast model'}, the CFD column checks the fitted values. Apply sets the inputs (Undo takes them back).</span></div>`;
  })();
  host.innerHTML = `<div class="meas-fit">
    <div><h3 class="dock-h">Fit to</h3><div class="meas-fsets">${MEAS.sets.map(d => `<label class="fv-chk"><input type="checkbox" data-fset="${d.id}"${chosen.has(d.id) ? ' checked' : ''}> ${mEsc(d.name)} <span class="fv-why">${mEsc(MEAS_KINDS[d.kind].l.toLowerCase())}</span></label>`).join('')}</div>
    <h3 class="dock-h">Inputs to adjust <small class="fv-why">1 to 3</small></h3>
    <div class="fv-bar"><button type="button" class="btn btn-secondary btn-sm" data-grp="angle">Contact angle</button><button type="button" class="btn btn-secondary btn-sm" data-grp="rheo">Rheology</button><button type="button" class="btn btn-secondary btn-sm" data-grp="bead">Bead pressure</button>
      <label class="fv-ctl">or any <select id="measFitAdd"><option value="">add an input…</option>${CFG.filter(c => !keys.includes(c.k)).map(c => `<option value="${c.k}">${mEsc(c.l)}</option>`).join('')}</select></label></div>
    ${keys.length ? `<div class="table-wrap"><table class="cfd-table"><thead><tr><th>Input</th><th>Now</th><th>Range searched</th><th></th></tr></thead><tbody>${keys.map(inputRow).join('')}</tbody></table></div>` : '<p class="cap">Pick an input to adjust.</p>'}
    <div class="prop-actions meas-fit-act">${MEAS.fitRun ? `<button type="button" class="btn btn-secondary btn-sm" id="measFitHalt">Stop the fit</button><span class="fv-why"><i class="spin" aria-hidden="true"></i>Fitting on the 1D: round ${Math.min(MEAS.fitRun.done + 1, MEAS.fitRun.total)} of ${MEAS.fitRun.total}</span>` : `<button type="button" class="btn btn-primary btn-sm" id="measFitGo"${keys.length && chosen.size ? '' : ' disabled'}>Fit</button><span class="fv-why">Minimises the RMS % error of the 1D over the chosen datasets (a response surface over the inputs, narrowed three times, then the 1D itself at its best), then solves the best fit in the CFD to check it.</span>`}</div></div>
    <div>${fitRes}</div></div>`;
  host.querySelectorAll('[data-fset]').forEach(i => { i.onchange = () => { const s = new Set(MEAS.fitSets || [MEAS.sel]); if (i.checked) s.add(i.dataset.fset); else s.delete(i.dataset.fset); MEAS.fitSets = [...s]; renderMeasFit(); }; });
  host.querySelectorAll('[data-grp]').forEach(b => { b.onclick = () => { MEAS.fitKeys = [...new Set([...MEAS_FIT_GROUPS[b.dataset.grp], ...MEAS.fitKeys])].slice(0, 3); renderMeasFit(); }; });
  const add = host.querySelector('#measFitAdd');
  add.onchange = () => { if (add.value) { MEAS.fitKeys = [...MEAS.fitKeys, add.value].slice(-3); renderMeasFit(); } };
  host.querySelectorAll('[data-drop]').forEach(b => { b.onclick = () => { MEAS.fitKeys = MEAS.fitKeys.filter(k => k !== b.dataset.drop); renderMeasFit(); }; });
  host.querySelectorAll('[data-lo], [data-hi]').forEach(i => {
    i.onchange = () => {
      const k = i.dataset.lo || i.dataset.hi, c = CFG.find(q => q.k === k), r = { ...measFitRange(k) };
      guardNumber(i, { label: c.l, lo: c.min, hi: c.max, unit: c.u }, v => { r[i.dataset.lo ? 'lo' : 'hi'] = v; });
      if (r.hi > r.lo) MEAS.fitRange[k] = r;
      renderMeasFit();
    };
  });
  const go = host.querySelector('#measFitGo');
  if (go) go.onclick = () => { imgToast('Fitting on the 1D…', 'busy'); measRunFit().then(f => { if (f) imgToast(`Fitted: RMS error ${f.rmsBefore.toFixed(1)} % → ${f.rmsAfter.toFixed(1)} % (1D)`); }).catch(e => { MEAS.fitRun = null; renderMeasFit(); imgToast(e.message === 'stopped' ? 'Fit stopped' : `Fit failed: ${e.message}`, e.message === 'stopped' ? '' : 'error'); }); };
  const halt = host.querySelector('#measFitHalt'); if (halt) halt.onclick = measStopFit;
  const ap = host.querySelector('#measApply'); if (ap) ap.onclick = measApplyFit;
  const fs = host.querySelector('#measFitStop'); if (fs) fs.onclick = measStopCfd;
  applyHelp();
}
function exportMeasured() {
  const ds = measSelected();
  if (!ds) return;
  const { K, fast, fe, c, ce } = measRows(ds), u = K.yu.replace('µ', 'u');
  const set = K.settings ? [...new Set(ds.rows.flatMap(p => Object.keys(p.set || {})))] : [];
  const posK = ['z', 'x', 't'].filter(k => ds.rows.some(p => p[k] != null));
  const rows = [['point', ...posK.map(k => `${k}_${MEAS_POS[k].u}`), ...set, `measured_${u}`, `model_${u}`, 'model_error_pct', ...(K.cfd ? [`cfd_${u}`, 'cfd_error_pct'] : [])]];
  ds.rows.forEach((p, i) => rows.push([i + 1, ...posK.map(k => p[k]), ...set.map(k => (p.set || {})[k]), p.y, fast[i] ?? '', fe[i] ?? '', ...(K.cfd ? [c ? c.vals[i] ?? '' : '', ce ? ce[i] ?? '' : ''] : [])]));
  downloadCSV(`measured-${ds.name.replace(/[^\w-]+/g, '_')}-${csvStamp()}.csv`, rows);
}
(function measuredMenu() {
  const b = document.getElementById('fmImport');
  if (b) b.onclick = () => { document.getElementById('fileMenu').open = false; importMeasured(); };
})();
