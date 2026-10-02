'use strict';
/*
 * Project files (.bcdl, JSON): every input (sidebar, CFD setup, solver and mesh, the locations'
 * own), probes, cut lines, saved cases, the view (module, display and colour settings, zoom,
 * dock), the DOE (design and runs), the 3D setup with its blade file, and the solved results
 * (fields, mesh study), so a project opens without solving again. File menu in the title bar: New,
 * Open (Ctrl+O), Save (Ctrl+S), Save as (Ctrl+Shift+S), recent projects where the browser can reopen
 * files (File System Access API).
 * The project's name (• when it has unsaved changes) is in the title bar and the browser tab.
 */
const PROJ_FORMAT = 1, PROJ_APP = 'Blade Coat Defect Lab', APP_VERSION = '2026.09';
const PROJ = { name: 'Untitled', handle: null, savedKey: null };
// (the defaults, for New: taken before anything is changed)
const CFDG_DEFAULTS = JSON.parse(JSON.stringify(CFDG));
const FV_DEFAULTS = JSON.parse(JSON.stringify(FV));
const DOE_DEFAULTS = { loc: DOE.loc, workers: DOE.workers, plot: DOE.plot, out: DOE.out, x: 0, mx: 0, my: 1, dock: DOE.dock, dockH: DOE.dockH, mode: 'coat' };
/** A DOE's design and runs as a project keeps them (the one shown, or the other kept aside: GO-6). */
const doeSnapOut = q => q ? { factors: q.factors, out: q.out, x: q.x, mx: q.mx, my: q.my, status: q.status === 'running' ? 'stopped' : q.status, key: q.key, t0: q.t0, t1: q.t1 || Date.now(),
  design: q.design ? q.design.map(d => ({ k: d.k, min: d.min, max: d.max, n: d.n, vals: d.vals, levels: d.levels })) : null,
  runs: (q.runs || []).map(r => ({ n: r.n, idx: r.idx, vals: r.vals, status: r.status === 'running' || r.status === 'pending' ? 'stopped' : r.status, out: r.out, error: r.error, ms: r.ms })) } : null;
const doeSnapIn = q => q ? { factors: q.factors || null, out: q.out, x: q.x || 0, mx: q.mx || 0, my: q.my ?? 1, design: q.design ? q.design.map(x => ({ ...x, f: doeFactor(x.k) })) : null,
  runs: q.runs || [], status: q.runs && q.runs.length ? (q.status || 'done') : 'idle', key: q.key || null, t0: q.t0 || 0, t1: q.t1 || 0 } : null;
const LOC_Z_DEFAULTS = CFD_LOCS.map(l => l.z);
const projUseFS = () => typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function' && !window.PROJ_NO_FS;
const PROJ_TYPES = [{ description: 'Blade Coat Defect Lab project', accept: { 'application/json': ['.bcdl', '.json'] } }];

// ---- JSON with typed arrays (base64) and non-finite numbers ----
const TYPED = { Float64Array, Float32Array, Int32Array, Uint32Array, Int16Array, Uint16Array, Int8Array, Uint8Array, Uint8ClampedArray };
function toB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(s) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
const projReplacer = (k, v) => typeof v === 'number' && !Number.isFinite(v) ? { $n: String(v) }
  : ArrayBuffer.isView(v) ? { $ta: v.constructor.name, d: toB64(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) } : v;
const projReviver = (k, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? (v.$ta && TYPED[v.$ta] ? new TYPED[v.$ta](fromB64(v.d)) : '$n' in v && Object.keys(v).length === 1 ? Number(v.$n) : v) : v;

// ---- the project as data, and back ----
/** What decides "unsaved changes": the inputs, probes, cut lines and the DOE design (not the view, not solving again). */
// (the SEM images by their name and what was marked on them, not their pixels: a key cheap to make on every redraw)
const projMatKey = () => ({ ...MAT, sem: MAT.sem ? { tables: MAT.sem.tables, images: MAT.sem.images.map(({ url, auto, ...q }) => ({ ...q, n: url ? url.length : 0, auto: !!auto })) } : null });
const projKey = () => JSON.stringify([CFG.map(c => P[c.k]), FEED_POS.z, CFDG, CFDS, CFD_LOCS.map(l => [l.z, l.over, l.solver]), cfdProbes, cfdCuts, DOE.factors, MEAS.sets.map(({ cfd, ...d }) => d), c3dSetupKey(), ACR, projMatKey(), OVEN]);
const projDirty = () => PROJ.savedKey != null && projKey() !== PROJ.savedKey;
function projectData() {
  const runOut = r => r.status === 'done' && r.result ? { status: 'done', result: r.result, geo: r.geo, key: r.key, elapsedMs: r.elapsedMs, orientKey: r.orientKey || null } : null;
  return {
    app: PROJ_APP, format: PROJ_FORMAT, saved: new Date().toISOString(), name: PROJ.name,
    inputs: Object.fromEntries(CFG.map(c => [c.k, P[c.k]])),
    feed: { z: FEED_POS.z ? FEED_POS.z.slice() : null },   // (the pool's outlets across the web: as placed, or null: equidistant)
    cfdSetup: { ...CFDG }, solver: { ...CFDS }, across: JSON.parse(JSON.stringify(ACR)),
    materials: JSON.parse(JSON.stringify(MAT)), oven: JSON.parse(JSON.stringify(OVEN)),
    locations: CFD_LOCS.map(l => ({ z: l.z, over: { ...l.over }, solver: { ...l.solver } })),
    probes: cfdProbes, cuts: cfdCuts, cases: readCases() || [],
    view: { module: tab, page: navNow(), FV },   // (page, WF-2: the tab's page -- on the Process view, its stage and part)
    doe: {
      loc: DOE.loc, workers: DOE.workers, factors: DOE.factors, plot: DOE.plot, out: DOE.out, x: DOE.x, mx: DOE.mx, my: DOE.my, dock: DOE.dock, dockH: DOE.dockH,
      status: DOE.status === 'running' ? 'stopped' : DOE.status, key: DOE.key, t0: DOE.t0, t1: DOE.t1 || Date.now(),
      design: DOE.design ? DOE.design.map(d => ({ k: d.k, min: d.min, max: d.max, n: d.n, vals: d.vals, levels: d.levels })) : null,
      runs: DOE.runs.map(r => ({ n: r.n, idx: r.idx, vals: r.vals, status: r.status === 'running' || r.status === 'pending' ? 'stopped' : r.status, out: r.out, error: r.error, ms: r.ms })),
      mode: DOE.mode, other: doeSnapOut(DOE_STASH[DOE.mode === 'furn' ? 'coat' : 'furn']),
    },
    results: cfdRuns.map(runOut),
    meshStudy: meshStudy ? { loc: meshStudy.loc, key: meshStudy.key, status: meshStudy.status === 'running' ? 'cancelled' : meshStudy.status, runs: meshStudy.runs.map(r => ({ name: r.name, f: r.f, solver: r.solver, status: r.status === 'running' ? 'cancelled' : r.status, r: r.r, ms: r.ms, error: r.error, reused: r.reused })) } : null,
    messages: cfdLog.map(m => ({ t: m.t, i: m.i, text: m.text, kind: m.kind })),
    measured: {
      sets: MEAS.sets.map(d => ({ ...d, cfd: d.cfd ? { ...d.cfd, status: d.cfd.status === 'running' ? 'stopped' : d.cfd.status } : null })),
      sel: MEAS.sel, fit: MEAS.fit ? { ...MEAS.fit, cfd: MEAS.fit.cfd ? { ...MEAS.fit.cfd, status: MEAS.fit.cfd.status === 'running' ? 'stopped' : MEAS.fit.cfd.status } : null } : null,
      fitKeys: MEAS.fitKeys, fitRange: MEAS.fitRange, fitSets: MEAS.fitSets, dock: MEAS.dock, dockH: MEAS.dockH,
    },
    c3d: { ...C3D, file: c3dFileOut(), result: C3D_RES, study: m3StudyOut() },
  };
}
/** Set a sidebar input as its slider does (everything listening updates). */
function setInput(k, v) {
  const sl = document.getElementById('s_' + k);
  // (MH-3: the slurry law's own values and its viscosity at 2.7 1/s exactly as given -- a slider's step would round them)
  if (sl && typeof RHEO_EXACT !== 'undefined' && RHEO_EXACT.has(k)) { P[k] = v; rheoShow(k); rheoSync(k); queueRender(); return; }
  // (a material value as given, not to the slider's step: rheo-params.js INPUT_EXACT; n and τy keep the law in step as their slider does)
  if (sl && typeof INPUT_EXACT !== 'undefined' && INPUT_EXACT.has(k)) { P[k] = v; rheoShow(k); if (k === 'n' || k === 'ty') rheoSync(k); queueRender(); return; }
  if (sl) { sl.value = v; sl.dispatchEvent(new Event('input')); } else P[k] = v;
}
/** Stop whatever is solving: every solve and fit, on every page (New, Open: their answers belong to the project being left). */
function projStopAll() {
  if (typeof SOLVE_ASK !== 'undefined') SOLVE_ASK.clear();   // (Phase 0: nothing asked for goes on)
  cancelAllLocations(); stopAccuracy(); orStopAll(); meshPvStop(); stopDOE(); measStopCfd(); measStopFit();
  m3StudyStop(true); acc3Stop(); c3dStop();
  oneDStop(); acrossCrownStop(); dryStop(); filmStop(); sheetStop(); mpStackStop(); furnStop(); fmpStop(); if (typeof dmpStop === 'function') dmpStop();
  if (typeof poolStop === 'function') poolStop();
}
/** What is solving now, as the dialog lists it: { where, what, done } (done: its progress, or ''). */
function projRunning() {
  const out = [], add = (where, what, done = '') => out.push({ where, what, done });
  // (each as its page words it: the stages count from 1, the multiphysics its steps done)
  const kn = (p, pre = '', done = false) => (p && Number.isFinite(p.k) && p.n > 0 ? `${pre}${Math.min(done ? p.k : p.k + 1, p.n)} of ${p.n}` : '');
  const locs = cfdRuns.map((r, i) => (r.status === 'running' ? `L${CFD_LOCS[i].id}` : null)).filter(Boolean);
  if (locs.length) add('Coating › 2D', `the flow at ${locs.join(', ')}`);
  if (meshStudy && meshStudy.status === 'running') add('Coating › 2D', `mesh study at L${CFD_LOCS[meshStudy.loc].id}`);
  for (const st of Object.values(ACC.runs)) if (st.status === 'running') add('Coating › 2D', `mesh to an accuracy at L${CFD_LOCS[st.i].id}`, `${st.cycles.length} meshes`);
  for (const i of Object.keys(OR.redo)) add('Coating › 2D', `flake alignment at L${CFD_LOCS[i].id}`, `${Math.round((OR.redo[i].share || 0) * 100)} %`);
  if (C3D_RUN.status === 'running') add('Coating › 3D', M3S.status === 'running' ? 'mesh study' : ACC3.status === 'running' ? 'mesh to an accuracy' : 'the 3D flow', `${Math.round((performance.now() - C3D_RUN.t0) / 1000)} s`);
  if (ONE_D.busy) add('Coating › 1D', 'the 1D at the four locations');
  if (ACR_CROWN.busy) add('Coating › 1D', 'the crown across the web', ACR_CROWN.stage || '');
  if (typeof POOL !== 'undefined') for (const d of [2, 3]) if (POOL[d].busy) add(`Coating › ${d}D`, 'the pool and its feed', POOL[d].prog ? `${Math.round(POOL[d].prog.f * 100)} %` : '');
  if (DRY.busy) add('Drying', 'the film through the oven', kn(DRY.prog));
  if (FILM.busy) add('Peel and wind', 'the film to the peel', kn(FILM.prog));
  if (SHEET.busy) add('Cutting', 'the piece in 3D', kn(SHEET.prog));
  if (STACK.busy) { const ps = Object.values(STACK.prog); add('Pre heat treatment', 'the pressed stack', ps.length ? kn({ k: ps.reduce((a, p) => a + p.k, 0), n: ps.reduce((a, p) => a + p.n, 0) }) : ''); }
  if (MPS.busy) add('Pre heat treatment', `multiphysics ${MPS.bdim}D`, kn(MPS.prog, 'time step ', true));
  if (FURN.busy) add('Furnace', 'the two runs', FURN.prog && FURN.prog.n > 1 ? kn(FURN.prog, 'stack ') : '');
  if (FURN.fit && !FURN.fit.done) add('Furnace', 'a fit to your measurements', (FURN.fit.msg || '').replace(/^Fitting:?\s*|…$/g, ''));
  if (FMS.busy) add('Furnace', `multiphysics ${FMS.bdim}D`, kn(FMS.prog, 'program step ', true));
  if (DOE.status === 'running') add('Studies', 'the DOE', `${DOE.runs.filter(r => r.status === 'done' || r.status === 'error').length} of ${DOE.runs.length} runs`);
  if (MQ.active.size + MQ.jobs.length > 0) add('Measured data', 'the CFD at the measured points');
  if (MEAS.fitRun) add('Measured data', 'the fit to your data', `round ${MEAS.fitRun.done} of ${MEAS.fitRun.total}`);
  return out;
}
/** The measured data of a project (none: empty). */
function applyMeasured(m) {
  m = m || {};
  MEAS.sets = Array.isArray(m.sets) ? m.sets.map(d => ({ ...d })) : [];
  measCfdCache.clear(); for (const d of MEAS.sets) if (d.cfd) measCfdCache.set(d.id, d.cfd);
  MEAS.sel = MEAS.sets.some(d => d.id === m.sel) ? m.sel : MEAS.sets.length ? MEAS.sets[0].id : null;
  MEAS.fit = m.fit || null; MEAS.fitKeys = Array.isArray(m.fitKeys) && m.fitKeys.length ? m.fitKeys : ['th']; MEAS.fitRange = m.fitRange || {}; MEAS.fitSets = m.fitSets || null;
  MEAS.dock = m.dock || 'compare'; MEAS.dockH = dockHSaved(m.dockH);
}
/** The material cards of a project, the slurry's and how it flows (none, or a value it predates: the default). */
function applyMaterials(m) {
  MAT = matDefaults();
  for (const part of ['slurry', 'rheo']) {
    const s = m && m[part];
    if (s) for (const k of Object.keys(MAT[part])) if (s[k] && Number.isFinite(s[k].v)) MAT[part][k] = { ...MAT[part][k], ...s[k] };
  }
  if (m && m.rheo && typeof m.rheo.structOn === 'boolean') MAT.rheo.structOn = m.rheo.structOn;   // (a project from before GO-1: the structure model's default)
  // (the sidebar inputs a rheometer fit set, and the rheometer tests: kept as they are when they have their shape)
  if (m && m.rheo && m.rheo.side && typeof m.rheo.side === 'object') MAT.rheo.side = Object.fromEntries(Object.entries(m.rheo.side).filter(([k, q]) => ['mu', 'n', 'ty'].includes(k) && q && Number.isFinite(q.v)).map(([k, q]) => [k, { v: q.v, src: String(q.src || '') }]));
  if (m && Array.isArray(m.tests)) MAT.tests = m.tests.filter(t => t && t.id && t.name && RT_KINDS[t.kind] && Array.isArray(t.tables)).map(t => ({ ...t, warnings: Array.isArray(t.warnings) ? t.warnings : [] }));
  // (the flakes' alignment card: a project from before GO-2 has none, the defaults; its SEM images and angle tables as saved)
  const o = m && m.orient;
  if (o) {
    for (const k of Object.keys(MAT.orient)) if (o[k] && Number.isFinite(o[k].v)) MAT.orient[k] = { ...MAT.orient[k], ...o[k] };
    if (typeof o.on === 'boolean') MAT.orient.on = o.on;
    if (o.model === 'dh' || o.model === 'ft') MAT.orient.model = o.model;
  }
  const sem = m && m.sem;
  if (sem) MAT.sem = { images: Array.isArray(sem.images) ? sem.images.filter(q => q && q.id && typeof q.url === 'string') : [], tables: Array.isArray(sem.tables) ? sem.tables.filter(q => q && q.id && Array.isArray(q.rows)) : [] };
  // (the drying card and the drying measured, GO-3: a project from before has none -- the defaults)
  const d = m && m.dry;
  if (d) for (const k of Object.keys(MAT.dry)) if (d[k] && Number.isFinite(d[k].v)) MAT.dry[k] = { ...MAT.dry[k], ...d[k] };
  const dm = m && m.dryMeas, fin = v => typeof v === 'number' && Number.isFinite(v) ? v : NaN;
  if (dm) MAT.dryMeas = {
    temps: Array.isArray(dm.temps) ? dm.temps.filter(t => t && Array.isArray(t.rows)).map(t => ({ name: String(t.name || 'temperatures'), rows: t.rows.filter(q => q && Number.isFinite(q.x) && Number.isFinite(q.T)).map(q => ({ x: q.x, T: q.T, kind: ['top', 'web', 'air'].includes(q.kind) ? q.kind : 'top', loc: /^L[1-4]$/.test(q.loc) ? q.loc : 'web' })) })) : [],
    exit: Array.isArray(dm.exit) ? dm.exit.filter(q => q && (q.loc === 'web' || /^L[1-4]$/.test(q.loc))).map(q => ({ loc: q.loc, water: fin(q.water), h: fin(q.h), dryAt: fin(q.dryAt) })) : [],
  };
  // (the film's card and the film measured, GO-4: a project from before has none -- the defaults)
  const fc = m && m.film;
  if (fc) for (const k of Object.keys(MAT.film)) if (fc[k] && Number.isFinite(fc[k].v)) MAT.film[k] = { ...MAT.film[k], ...fc[k] };
  const fm = m && m.filmMeas, locOk = q => q && (q.loc === 'web' || /^L[1-4]$/.test(q.loc)), arr = v => Array.isArray(v) ? v : [];
  if (fm) MAT.filmMeas = {
    curl: arr(fm.curl).filter(locOk).map(q => ({ loc: q.loc, R: fin(q.R), lift: fin(q.lift), sheet: fin(q.sheet), toward: ['top', 'bottom'].includes(q.toward) ? q.toward : '', when: ['peel', 'roll'].includes(q.when) ? q.when : 'settled' })),
    cracks: arr(fm.cracks).filter(locOk).map(q => ({ loc: q.loc, spacing: fin(q.spacing), width: fin(q.width), where: ['web', 'peel', 'roll'].includes(q.where) ? q.where : '' })),
    peel: arr(fm.peel).filter(locOk).map(q => ({ loc: q.loc, f: fin(q.f), angle: fin(q.angle) })),
    size: arr(fm.size).filter(locOk).map(q => ({ loc: q.loc, L: fin(q.L), W: fin(q.W), when: ['cut', 'dry', 'furnace'].includes(q.when) ? q.when : 'dry' })).filter(q => Number.isFinite(q.L) || Number.isFinite(q.W)),
  };
  // (the furnace's card and the graphene film measured, GO-5: a project from before has none -- the defaults)
  const uc = m && m.furn;
  if (uc) for (const k of Object.keys(MAT.furn)) if (uc[k] && Number.isFinite(uc[k].v)) MAT.furn[k] = { ...MAT.furn[k], ...uc[k] };
  const um = m && m.furnMeas;
  if (um) MAT.furnMeas = { out: arr(um.out).filter(locOk).map(q => ({ loc: q.loc, h: fin(q.h), kept: fin(q.kept), kappa: fin(q.kappa) })).filter(q => [q.h, q.kept, q.kappa].some(Number.isFinite)),
    // (the first piece found stuck to its papers, from the top, GO-7c)
    stuckFrom: Number.isFinite(um.stuckFrom) && um.stuckFrom >= 1 && um.stuckFrom <= 10000 ? Math.round(um.stuckFrom) : null };
  // (the material constants' card, MH-2: a project from before has none -- the solvers' own values, as it was solved)
  const lc = m && m.lib;
  if (lc) for (const k of Object.keys(MAT.lib)) if (lc[k] && Number.isFinite(lc[k].v)) MAT.lib[k] = { ...MAT.lib[k], ...lc[k] };
  // (the spec's materials no solver reads at present, MC-2: a value as saved, or none)
  const xr = m && m.xrec;
  if (xr) for (const k of Object.keys(MAT.xrec)) if (xr[k] && (Number.isFinite(xr[k].v) || xr[k].v === null)) MAT.xrec[k] = { ...MAT.xrec[k], ...xr[k] };
  // (a card value's definition in temperature, MH-4b: kept only on a value a solver takes in temperature, and only when it
  // holds -- matlib's checks, positive over its range; its value then its value at 20 °C. Anything else: the value as saved)
  for (const card of ['slurry', 'rheo', 'orient', 'dry', 'film', 'furn', 'lib']) for (const k of Object.keys(MAT[card] || {})) {
    const e = MAT[card][k];
    if (!e || typeof e !== 'object' || !('def' in e)) continue;
    const range = typeof HUB_TDEP !== 'undefined' && HUB_TDEP[`${card}.${k}`];
    let ok = false;
    try { ok = !!(range && e.def && typeof e.def === 'object' && !hubDefCheck(e.def, range[1]).length); } catch (err) { ok = false; }
    const n = { ...e };
    if (ok) { n.def = JSON.parse(JSON.stringify(e.def)); n.v = +hubDefAt(n.def, 20).toPrecision(12); } else delete n.def;
    MAT[card] = { ...MAT[card], [k]: n };
  }
  // (the inputs bar's material values' provenance, MH-5: as saved when it has its shape; a project from before has none)
  // (each material's identity and metadata, its Overview: text fields as saved)
  const mt = m && m.meta;
  if (mt && typeof mt === 'object') MAT.meta = Object.fromEntries(Object.entries(mt).filter(([id, q]) => typeof id === 'string' && q && typeof q === 'object')
    .map(([id, q]) => [id, Object.fromEntries(Object.entries(q).filter(([k, x]) => ['name', 'desc', 'grade', 'supplier', 'dataSrc', 'version', 'notes'].includes(k) && typeof x === 'string'))]));
  // (the built-in laws' parameters as edited, MC-1b: each one the law has, finite, a list as long as its own; the law
  //  still valid over its range -- else that law as built in)
  const lw = m && m.law;
  MAT.law = {};
  if (lw && typeof lw === 'object' && typeof HUB_LAW !== 'undefined') for (const [id, q] of Object.entries(lw)) {
    const L = HUB_LAW[id];
    if (!L || !q || typeof q !== 'object') continue;
    const own = L.q.params, ok = Object.entries(q).every(([k, x]) => k in own && (Array.isArray(own[k]) ? Array.isArray(x) && x.length === own[k].length && x.every(Number.isFinite) : Number.isFinite(x)));
    if (ok && !hubLawProblem(id, { ...own, ...q })) MAT.law[id] = JSON.parse(JSON.stringify(q));
  }
  // (copies of a material and the domains they are assigned to, MC-2: each of a record this app has, its card values as
  //  saved where they are numbers, its laws where they hold; an assignment to a copy kept, to a domain the record has)
  const ins = m && m.inst;
  MAT.inst = {}; MAT.assign = {};
  if (ins && typeof ins === 'object' && typeof hubBaseRec === 'function') for (const [id, q] of Object.entries(ins)) {
    const B = q && hubBaseRec(q.base);
    if (!B || !/^[\w-]+~\d+$/.test(id) || typeof q.name !== 'string') continue;
    const vals = {}, law = {};
    for (const p of hubProps(B)) {
      const b = p.b, e = q.vals && q.vals[p.id];
      if (b.t === 'card') vals[p.id] = e && (Number.isFinite(e.v) || e.v === null) ? { ...MAT[b.card][b.k], ...e } : { ...MAT[b.card][b.k] };
      if (b.t === 'law' && q.law && q.law[b.id] && typeof q.law[b.id] === 'object' && !hubLawProblem(b.id, { ...HUB_LAW[b.id].q.params, ...q.law[b.id] })) law[b.id] = JSON.parse(JSON.stringify(q.law[b.id]));
    }
    MAT.inst[id] = { base: B.id, name: q.name, vals, law };
  }
  const as = m && m.assign;
  if (as && typeof as === 'object') for (const [base, a] of Object.entries(as)) {
    const B = typeof hubBaseRec === 'function' && hubBaseRec(base);
    if (!B || !a || typeof a !== 'object') continue;
    const keep = Object.fromEntries(Object.entries(a).filter(([i, id]) => +i >= 0 && +i < B.domains.length && MAT.inst[id] && MAT.inst[id].base === base));
    if (Object.keys(keep).length) MAT.assign[base] = keep;
  }
  const pv = m && m.prov;
  if (pv && typeof pv === 'object') MAT.prov = Object.fromEntries(Object.entries(pv).filter(([k, q]) => /^in\.[A-Za-z0-9]+$/.test(k) && q && typeof q.kind === 'string' && (typeof HUB_PROV === 'undefined' || HUB_PROV[q.kind])).map(([k, q]) => [k, { kind: q.kind, src: String(q.src ?? '') }]));
}
/** The furnace's inputs of a project (GO-5): its runs (steps or a file's cycle) and the stack; none: the defaults. */
function applyFurn(f) {
  const out = furnDefaults();
  if (!f || typeof f !== 'object') return out;
  for (const [k, , , lo, hi, , , flag] of FURN_FIELDS) { if (Number.isFinite(f[k]) && f[k] >= lo && f[k] <= hi) out[k] = f[k]; if (typeof f[flag] === 'boolean') out[flag] = f[flag]; }
  if (f.room === 'gap' || f.room === 'plates') out.room = f.room;
  // (GO-7e: what the top and bottom pieces touch; a project from before: the plates, as the user's holder)
  if (f.ends === 'plates' || f.ends === 'papers') out.ends = f.ends;
  if (typeof f.endsSet === 'boolean') out.endsSet = f.endsSet;
  if (typeof f.runsSet === 'boolean') out.runsSet = f.runsSet;
  const inR = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
  if (Array.isArray(f.runs)) out.runs = out.runs.map((d, r) => {
    const q = f.runs[r];
    if (!q || typeof q !== 'object') return d;
    const steps = Array.isArray(q.steps) ? q.steps.filter(s => s && inR(s.rate, FURN_STEP_LIMITS.rate) && inR(s.to, FURN_STEP_LIMITS.to) && inR(s.hold, FURN_STEP_LIMITS.hold)).map(s => ({ rate: s.rate, to: s.to, hold: s.hold })) : [];
    const file = q.file && Array.isArray(q.file.pts) && q.file.pts.length > 1 && q.file.pts.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      ? { name: String(q.file.name || 'cycle'), unit: ['h', 'min', 's'].includes(q.file.unit) ? q.file.unit : 'h', pts: q.file.pts.map(p => [p[0], p[1]]) } : null;
    return { steps: steps.length ? steps : d.steps, cool: inR(q.cool, FURN_STEP_LIMITS.cool) ? q.cool : d.cool, file };
  });
  return out;
}
/** The oven's zones of a project; one from before the zones: its single drying-air setting (cfdSetup's) in every zone. */
function applyOven(o, cfdSetup) {
  OVEN = ovenDefaults();
  // (after the oven, to the peel and the winder, GO-4: a project from before has none -- the defaults, assumed)
  const pl = o && o.peel;
  if (pl) for (const [k, , , lo, hi, , , flag] of OVEN_PEEL_FIELDS) { if (Number.isFinite(pl[k]) && pl[k] >= lo && pl[k] <= hi) OVEN.peel[k] = pl[k]; OVEN.peel[flag] = typeof pl[flag] === 'boolean' ? pl[flag] : OVEN_PEEL_DEFAULT[flag]; }
  // (the stack's shelf, MP-1: a project from before has none -- the default, assumed)
  if (pl) { OVEN.peel.shelf = OVEN_SHELVES[pl.shelf] ? pl.shelf : OVEN_PEEL_DEFAULT.shelf; OVEN.peel.shelfSet = typeof pl.shelfSet === 'boolean' ? pl.shelfSet : OVEN_PEEL_DEFAULT.shelfSet; }
  // (the furnace, GO-5: a project from before has none -- the defaults, assumed)
  OVEN.furn = applyFurn(o && o.furn);
  // (the stages' multiphysics mesh and time settings, MP-W: numbers only, each checked against its range when used;
  //  the drying's (MP-5) also where its water leaves)
  OVEN.mp = {};
  if (o && o.mp && typeof o.mp === 'object') for (const [st, D] of Object.entries(o.mp)) {
    if (!D || typeof D !== 'object' || !['stack', 'furn', 'dry'].includes(st)) continue;
    if (st === 'dry' && D.where === 'both') (OVEN.mp.dry = OVEN.mp.dry || {}).where = 'both';
    for (const [dim, q] of Object.entries(D)) {
      if (!['1', '2', '3'].includes(dim) || !q || typeof q !== 'object') continue;
      const keep = Object.fromEntries(Object.entries(q).filter(([, v]) => Number.isFinite(v)));
      if (Object.keys(keep).length) (OVEN.mp[st] = OVEN.mp[st] || {})[dim] = keep;
    }
  }
  if (o && Array.isArray(o.zones) && o.zones.length) { OVEN.zones = o.zones.slice(0, OVEN_MAX_ZONES).map(z => ({ ...OVEN_ZONE_DEFAULT, ...z })); return; }
  const c = cfdSetup || {};
  for (const z of OVEN.zones) for (const k of ['airU', 'airT', 'plenum']) if (Number.isFinite(c[k])) z[k] = c[k];
}
/** The 3D setup of a project, its blade file and its last 3D solve (none: the defaults, no file, no result). */
function applyC3D(c) {
  c = c || {};
  Object.assign(C3D, JSON.parse(JSON.stringify(C3D_DEFAULTS)));
  for (const k of Object.keys(C3D_DEFAULTS)) if (k in c) C3D[k] = c[k];
  // (saved before the open edges had their own rows across the gap: they took ny, so they keep it)
  if (!('edgeNy' in c) && Number.isFinite(c.ny)) C3D.edgeNy = c.ny;
  c3dFileIn(c.file);
  C3D_RES = c.result && c.result.result ? c.result : null;
  m3StudyIn(c.study);
}
function applyProject(p) {
  if (!p || p.app !== PROJ_APP) throw new Error('this is not a Blade Coat Defect Lab project');
  if (p.format > PROJ_FORMAT) throw new Error('the project was saved by a newer version of the app');
  projStopAll();
  // (the inputs as saved, consistent as they are: the slurry's law not re-derived while they come in)
  rheoHold(() => { for (const c of CFG) setInput(c.k, p.inputs && c.k in p.inputs ? p.inputs[c.k] : c.v); });   // (an input the project predates: its default)
  Object.assign(CFDG, CFDG_DEFAULTS); for (const k of Object.keys(CFDG)) if (p.cfdSetup && k in p.cfdSetup) CFDG[k] = p.cfdSetup[k];
  Object.assign(CFDS, SOLVER_DEFAULTS, p.solver || {});
  FEED_POS.z = p.feed && Array.isArray(p.feed.z) ? p.feed.z.map(Number) : null;   // (a project from before: equidistant)
  applyMaterials(p.materials); applyOven(p.oven, p.cfdSetup);
  applyAcross(p.across);   // (a project from before: the blade across the web as it was, no new part)
  CFD_LOCS.forEach((l, i) => { const s = (p.locations || [])[i] || {}; l.z = s.z ?? LOC_Z_DEFAULTS[i]; l.over = { ...(s.over || {}) }; l.solver = { ...(s.solver || {}) }; });
  // (a project from before MH-3: the law's own parameters from its viscosity at 2.7 1/s -- every solver gets the law it was solved with)
  rheoMigrate(p.inputs);
  cfdProbes = Array.isArray(p.probes) ? p.probes.map(q => ({ ...q })) : []; saveProbes();
  cfdCuts = Array.isArray(p.cuts) ? p.cuts.map(q => ({ ...q })) : []; saveCuts();
  if (Array.isArray(p.cases) && p.cases.length) {
    // (the project's cases join this browser's list: same name = the project's)
    const list = readCases() || [];
    for (const c of p.cases) { const at = list.findIndex(x => x.name === c.name); if (at >= 0) list[at] = c; else list.push(c); }
    writeCases(list);
  }
  Object.assign(FV, JSON.parse(JSON.stringify(FV_DEFAULTS)), (p.view && p.view.FV) || {});
  FV.dockH = dockHSaved(FV.dockH);
  // results: the fields rebuilt from the solutions
  cfdRuns.forEach((r, i) => {
    for (const k of Object.keys(r)) delete r[k];
    const s = (p.results || [])[i];
    if (s && s.result) {
      const field = makeFlowField(s.result, { rho: s.geo.rho, ty: s.geo.ty });
      Object.assign(r, { status: 'done', result: s.result, geo: s.geo, key: s.key, orientKey: s.orientKey || null, elapsedMs: s.elapsedMs, field, streamCache: new Map(), metrics: flowMetrics(field) });
    } else r.status = 'idle';
  });
  cfdAutoStarted = cfdRuns.some(r => r.field);
  meshStudy = p.meshStudy ? { ...p.meshStudy, runs: p.meshStudy.runs.map(r => ({ ...r, metrics: r.r ? flowMetrics(makeFlowField(r.r, { rho: cfdGeometry(p.meshStudy.loc).rho, ty: cfdGeometry(p.meshStudy.loc).ty })) : null })) } : null;
  const d = p.doe || {}, mode = d.mode === 'furn' ? 'furn' : 'coat';
  DOE.mode = mode;   // (the factors below are looked up in the DOE shown)
  DOE_STASH.coat = null; DOE_STASH.furn = null;
  DOE_STASH[mode === 'furn' ? 'coat' : 'furn'] = doeSnapIn(d.other);
  Object.assign(DOE, DOE_DEFAULTS, { mode, loc: d.loc ?? 0, workers: d.workers ?? DOE_DEFAULTS.workers, factors: d.factors || null, plot: d.plot || 'response', out: d.out || 'film', x: d.x || 0, mx: d.mx || 0, my: d.my ?? 1, dock: d.dock || 'design', dockH: dockHSaved(d.dockH),
    design: d.design ? d.design.map(x => ({ ...x, f: doeFactor(x.k) })) : null, runs: d.runs || [], status: d.runs && d.runs.length ? (d.status || 'done') : 'idle', key: d.key || null, t0: d.t0 || 0, t1: d.t1 || 0, active: new Set() });
  cfdLog.length = 0; for (const m of p.messages || []) cfdLog.push({ ...m, t: new Date(m.t) });
  applyMeasured(p.measured);
  applyC3D(p.c3d);
  tab = Number.isInteger(p.view && p.view.module) && p.view.module < TABS.length ? p.view.module : tab;
  // (the stage and part it was on; a project from before WF-2 opens the Process view on its stage as it is)
  const pg = p.view && NAV[p.view.page];
  if (pg && pg.v === tab) { if (pg.st) PROC.stage = pg.st; if (pg.fv) FILM.view = pg.fv; if (pg.fp) FURN.part = pg.fp; if (pg.v === 12) SWB_DIM[procStepKey()] = pg.md || 0; }
  render();
  undoReset();
}

// ---- menu actions ----
async function newProject() {
  if (!(await confirmStopRunning('new')) || !(await confirmDiscard())) return;
  projStopAll();
  rheoHold(() => { for (const c of CFG) setInput(c.k, c.v); }); RHEO_NOTE = '';   // (the defaults are one consistent law)
  Object.assign(CFDG, JSON.parse(JSON.stringify(CFDG_DEFAULTS)));
  Object.assign(CFDS, SOLVER_DEFAULTS);
  applyMaterials(null); applyOven(null);
  applyAcross(null);
  CFD_LOCS.forEach((l, i) => { l.z = LOC_Z_DEFAULTS[i]; l.over = {}; l.solver = {}; });
  cfdProbes = []; saveProbes(); cfdCuts = []; saveCuts();
  Object.assign(FV, JSON.parse(JSON.stringify(FV_DEFAULTS)));
  cfdRuns.forEach(r => { for (const k of Object.keys(r)) delete r[k]; r.status = 'idle'; });
  cfdAutoStarted = false; meshStudy = null;
  DOE_STASH.coat = null; DOE_STASH.furn = null;
  Object.assign(DOE, DOE_DEFAULTS, { factors: null, design: null, runs: [], status: 'idle', key: null, t0: 0, t1: 0, active: new Set() });
  cfdLog.length = 0;
  applyMeasured(null);
  applyC3D(null);
  for (const id of [...inputProblems.keys()]) clearRejected(id);
  Object.assign(PROJ, { name: 'Untitled', handle: null });
  render();
  undoReset();
  PROJ.savedKey = projKey(); updateProjectTitle();
}
async function openProject(handle) {
  if (!(await confirmStopRunning('open')) || !(await confirmDiscard())) return;
  let file = null;
  try {
    if (handle) {
      if (handle.requestPermission && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
      file = await handle.getFile();
    } else if (projUseFS()) { [handle] = await window.showOpenFilePicker({ types: PROJ_TYPES }); file = await handle.getFile(); }
    else file = await pickProjectFile();
  } catch (e) { if (e && e.name === 'AbortError') return; imgToast(`Could not open the project: ${e.message}`, 'error'); return; }
  if (!file) return;
  imgToast(`Opening ${file.name}…`, 'busy');
  await new Promise(r => setTimeout(r, 30));
  try {
    const p = JSON.parse(await file.text(), projReviver);
    applyProject(p);
    Object.assign(PROJ, { name: file.name.replace(/\.(bcdl|json)$/i, ''), handle: handle || null });
    if (handle) rememberRecent(handle);
    PROJ.savedKey = projKey(); updateProjectTitle();
    imgToast(`Opened ${file.name}${cfdRuns.some(r => r.field) ? '' : ' (no results saved: run the locations)'}`);
  } catch (e) { imgToast(`Could not open ${file.name}: ${e.message}`, 'error'); }
}
function pickProjectFile() {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.bcdl,.json,application/json'; inp.style.display = 'none';
    inp.onchange = () => { res(inp.files[0] || null); inp.remove(); };
    document.body.appendChild(inp); inp.click();
  });
}
async function saveProject(as = false) {
  let text;
  try { text = JSON.stringify(projectData(), projReplacer); } catch (e) { imgToast(`Could not save: ${e.message}`, 'error'); return false; }
  try {
    if (projUseFS()) {
      let handle = as ? null : PROJ.handle;
      if (handle && handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted'
        && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') handle = null;   // (a project reopened from the last session)
      if (!handle) handle = await window.showSaveFilePicker({ suggestedName: `${PROJ.name}.bcdl`, types: PROJ_TYPES });
      const w = await handle.createWritable(); await w.write(text); await w.close();
      Object.assign(PROJ, { handle, name: handle.name.replace(/\.(bcdl|json)$/i, '') });
      rememberRecent(handle);
    } else {
      if (as || PROJ.name === 'Untitled') { const nm = await askProjectName(PROJ.name); if (nm == null) return false; PROJ.name = nm; }
      saveBlob(new Blob([text], { type: 'application/json' }), `${PROJ.name}.bcdl`);
    }
  } catch (e) { if (e && e.name === 'AbortError') return false; imgToast(`Could not save: ${e.message}`, 'error'); return false; }
  PROJ.savedKey = projKey(); updateProjectTitle();
  imgToast(`Saved ${PROJ.name}.bcdl (${(text.length / 1048576).toFixed(1)} MB)`);
  return true;
}

// ---- dialogs: unsaved changes, a name ----
function projDialog(html) {
  let d = document.getElementById('projDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'projDlg'; d.className = 'img-dlg proj-dlg'; document.body.appendChild(d); }
  d.innerHTML = html;
  d.showModal();
  return d;
}
/** Unsaved changes: save them, discard them, or cancel. True = go on. */
function confirmDiscard() {
  if (!projDirty()) return Promise.resolve(true);
  return new Promise(res => {
    const d = projDialog(`<form method="dialog" class="img-form"><div class="img-head"><h2>Save changes to “${PROJ.name}”?</h2></div>
      <p class="cap">The project has changes that are not saved.</p>
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-a="cancel">Cancel</button><button type="button" class="btn btn-secondary btn-sm" data-a="discard">Don't save</button><button type="button" class="btn btn-primary btn-sm" data-a="save">Save</button></div></form>`);
    d.querySelectorAll('[data-a]').forEach(b => { b.onclick = async () => { d.close(); const a = b.dataset.a; res(a === 'discard' ? true : a === 'save' ? await saveProject() : false); }; });
    d.addEventListener('cancel', () => res(false), { once: true });
  });
}
/** Something solving: list it, and stop it (go on) or keep it (cancel). True = go on (nothing solving, or stop it). */
function confirmStopRunning(to) {
  const list = projRunning();
  if (!list.length) return Promise.resolve(true);
  const one = list.length === 1, esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return new Promise(res => {
    const d = projDialog(`<form method="dialog" class="img-form"><div class="img-head"><h2>${one ? 'A solve is running' : `${list.length} solves are running`}</h2></div>
      <p class="cap">${to === 'open' ? 'Opening a project' : 'A new project'} stops ${one ? 'it' : 'them'}; ${one ? 'its answer belongs' : 'their answers belong'} to “${esc(PROJ.name)}” and ${one ? 'is' : 'are'} not kept.</p>
      <table class="cfd-table proj-run"><thead><tr><th scope="col">Stage</th><th scope="col">Solving</th><th scope="col">Done</th></tr></thead>
      <tbody>${list.map(r => `<tr><td>${esc(r.where)}</td><td>${esc(r.what)}</td><td>${esc(r.done || '—')}</td></tr>`).join('')}</tbody></table>
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-a="keep">Keep solving</button><button type="button" class="btn btn-primary btn-sm" data-a="stop">Stop and ${to === 'open' ? 'open' : 'start new'}</button></div></form>`);
    d.classList.add('proj-dlg-run');
    d.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => { d.close(); d.classList.remove('proj-dlg-run'); res(b.dataset.a === 'stop'); }; });
    d.addEventListener('cancel', () => { d.classList.remove('proj-dlg-run'); res(false); }, { once: true });
  });
}
function askProjectName(cur) {
  return new Promise(res => {
    const d = projDialog(`<form method="dialog" class="img-form"><div class="img-head"><h2>Save project as</h2></div>
      <label class="fv-ctl">Name <input type="text" id="projNameIn" maxlength="80" value="${cur.replace(/"/g, '&quot;')}"></label>
      <p class="fv-note">Saved as a .bcdl file to your downloads.</p>
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-a="cancel">Cancel</button><button type="submit" class="btn btn-primary btn-sm">Save</button></div></form>`);
    const inp = d.querySelector('#projNameIn'); inp.select();
    d.querySelector('[data-a="cancel"]').onclick = () => { d.close(); res(null); };
    d.querySelector('form').onsubmit = e => { e.preventDefault(); const v = inp.value.trim().replace(/[\\/:*?"<>|]+/g, '-'); d.close(); res(v || null); };
    d.addEventListener('cancel', () => res(null), { once: true });
  });
}

// ---- recent projects: file handles kept in this browser (where it can reopen files) ----
const RECENT_DB = 'bladeCoatDefectLab', RECENT_STORE = 'recent', SESSION_STORE = 'session';
function recentDb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open(RECENT_DB, 2);
    q.onupgradeneeded = () => { for (const s of [RECENT_STORE, SESSION_STORE]) if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s); };
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
}
async function recentList() {
  if (!projUseFS() || !window.indexedDB) return [];
  try {
    const db = await recentDb();
    return await new Promise(res => { const g = db.transaction(RECENT_STORE).objectStore(RECENT_STORE).get('list'); g.onsuccess = () => res(g.result || []); g.onerror = () => res([]); });
  } catch (e) { return []; }
}
async function rememberRecent(handle) {
  try {
    const list = (await recentList()).filter(x => x.name !== handle.name).slice(0, 4);
    list.unshift({ name: handle.name, handle, t: Date.now() });
    const db = await recentDb();
    db.transaction(RECENT_STORE, 'readwrite').objectStore(RECENT_STORE).put(list, 'list');
  } catch (e) { /* recent projects are a convenience */ }
}
async function renderRecent() {
  const host = document.getElementById('fmRecent'), sep = document.getElementById('fmRecentSep');
  if (!host) return;
  const list = await recentList();
  sep.hidden = !list.length;
  host.innerHTML = list.map((x, k) => `<button class="menu-item" type="button" data-recent="${k}">${x.name.replace(/[<&]/g, '')}</button>`).join('');
  host.querySelectorAll('[data-recent]').forEach(b => { b.onclick = () => { document.getElementById('fileMenu').open = false; openProject(list[+b.dataset.recent].handle); }; });
}

// ---- title, menu, keys ----
function updateProjectTitle() {
  if (PROJ.savedKey == null) PROJ.savedKey = projKey();   // (the first render: nothing changed yet)
  const dirty = projDirty(), el = document.getElementById('projName');
  if (el) { el.textContent = PROJ.name; el.classList.toggle('dirty', dirty); el.title = `Project: ${PROJ.name}${dirty ? ' (unsaved changes)' : ''}`; }
  document.title = `${PROJ.name}${dirty ? ' •' : ''} — Blade Coat Defect Lab`;
}
(function projectMenu() {
  const menu = document.getElementById('fileMenu');
  if (!menu) return;
  const close = () => { menu.open = false; };
  document.getElementById('fmNew').onclick = () => { close(); newProject(); };
  document.getElementById('fmOpen').onclick = () => { close(); openProject(); };
  document.getElementById('fmSave').onclick = () => { close(); saveProject(false); };
  document.getElementById('fmSaveAs').onclick = () => { close(); saveProject(true); };
  menu.addEventListener('toggle', () => { if (menu.open) renderRecent(); });
  // (Ctrl+S, Ctrl+Shift+S, Ctrl+O: keys.js)
  addEventListener('beforeunload', e => { if (projDirty()) { e.preventDefault(); e.returnValue = ''; } });
})();

// ---------------------------------------------------------------------
// Session memory: the whole working state (as a project, results included) kept in this browser
// every minute and when the tab is hidden; on the next visit a bar asks to continue from it.
// ---------------------------------------------------------------------
const SESSION = { suspended: true, lastKey: null, timer: 0 };
/** What has to change for the session to be written again: inputs, view, results (2D and 3D), DOE, mesh study, project. */
const sessionKey = () => [projKey(), JSON.stringify([tab, navNow(), FV, PROJ.name, projDirty()]), cfdRuns.map(r => `${r.status}:${r.key || ''}:${r.elapsedMs || ''}:${r.result && r.result.orient ? r.result.orient.ms : ''}`).join(','),
  DOE.runs.map(r => r.status).join(''), meshStudy ? meshStudy.status : '', C3D_RES ? C3D_RES.when : '', M3S.status, M3S.when || ''].join('|');
async function sessionSave(force = false) {
  if (SESSION.suspended || !window.indexedDB) return false;
  const key = sessionKey();
  if (!force && key === SESSION.lastKey) return false;
  try {
    const text = JSON.stringify(projectData(), projReplacer);
    const db = await recentDb();
    await new Promise((res, rej) => {
      const tx = db.transaction(SESSION_STORE, 'readwrite');
      tx.objectStore(SESSION_STORE).put({ t: Date.now(), text, name: PROJ.name, savedKey: PROJ.savedKey, handle: PROJ.handle || null }, 'last');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    SESSION.lastKey = key;
    return true;
  } catch (e) { return false; }   // (session memory is a convenience: a full or blocked store only loses it)
}
async function sessionRead() {
  if (!window.indexedDB) return null;
  try {
    const db = await recentDb();
    return await new Promise(res => { const g = db.transaction(SESSION_STORE).objectStore(SESSION_STORE).get('last'); g.onsuccess = () => res(g.result || null); g.onerror = () => res(null); });
  } catch (e) { return null; }
}
async function sessionClear() {
  try { const db = await recentDb(); db.transaction(SESSION_STORE, 'readwrite').objectStore(SESSION_STORE).delete('last'); } catch (e) { /* nothing kept */ }
}
function sessionStart() {
  SESSION.suspended = false;
  clearInterval(SESSION.timer);
  SESSION.timer = setInterval(() => sessionSave(), 60000);
}
/** Restore the last session into the app. */
function sessionRestore(s) {
  const p = JSON.parse(s.text, projReviver);
  applyProject(p);
  Object.assign(PROJ, { name: s.name || p.name || 'Untitled', handle: s.handle || null });
  // (its unsaved state as it was: saved key from then, or clean if it had none)
  PROJ.savedKey = s.savedKey || projKey();
  updateProjectTitle();
}
/** On opening the app: a bar offering the last session, when it holds something worth continuing. */
(async function sessionOffer() {
  const s = await sessionRead();
  let p = null;
  try { p = s && JSON.parse(s.text, projReviver); } catch (e) { p = null; }
  const defaults = JSON.stringify(Object.fromEntries(CFG.map(c => [c.k, c.v])));
  const worth = p && (p.results && p.results.some(Boolean) || (p.doe && p.doe.runs && p.doe.runs.length) || (s.name && s.name !== 'Untitled')
    || JSON.stringify(p.inputs) !== defaults || (p.probes && p.probes.length) || (p.cuts && p.cuts.length) || (p.c3d && (p.c3d.file || p.c3d.result)));
  if (!worth) { sessionStart(); return; }
  const bar = document.createElement('div');
  bar.className = 'session-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Last session');
  const when = new Date(s.t), today = when.toDateString() === new Date().toDateString();
  const n = p.results ? p.results.filter(Boolean).length : 0;
  bar.innerHTML = `<span><b>Continue where you left off?</b> ${s.name && s.name !== 'Untitled' ? `Project “${s.name.replace(/[<&]/g, '')}”, ` : ''}saved ${today ? 'today' : when.toLocaleDateString()} at ${when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${n ? ` · ${n} location${n > 1 ? 's' : ''} solved` : ''}${p.doe && p.doe.runs && p.doe.runs.length ? ` · a DOE of ${p.doe.runs.length} runs` : ''}.</span>
    <button type="button" class="btn btn-primary btn-sm" data-s="restore">Restore</button><button type="button" class="btn btn-secondary btn-sm" data-s="fresh">Start fresh</button>`;
  document.body.appendChild(bar);
  bar.querySelector('[data-s="restore"]').onclick = () => {
    bar.remove();
    try { sessionRestore(s); imgToast('Restored the last session'); } catch (e) { imgToast(`Could not restore the last session: ${e.message}`, 'error'); }
    sessionStart();
  };
  bar.querySelector('[data-s="fresh"]').onclick = () => { bar.remove(); sessionClear(); sessionStart(); };
})();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sessionSave(); });
addEventListener('pagehide', () => { sessionSave(); });
