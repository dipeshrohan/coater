/*
 * undo.js — undo / redo, one history per view (module).
 *
 * A change is attributed to the view it is made in, and Undo in a view takes back only that view's
 * changes. The state is a set of "units" (an input, a CFD setting, a location's own inputs, the
 * probes, a plot setting, the DOE design ...); a history step keeps the units it changed, before and
 * after, so undoing one view's step leaves what other views changed alone. Changes are picked up
 * after the user's input settles (a slider drag, a zoom by the wheel = one step). Results are not
 * part of a step, but solved results are remembered by their inputs: when an undo or redo brings
 * back inputs that were solved before, their results come back too.
 *
 * Depends on everything before it (P, CFG, ANIM, CFDG, CFDS, CFD_LOCS, FV, DOE, cfdRuns ...);
 * ui.js calls undoBeforeRender() / undoAfterRender() around each render.
 */

const UNDO_MAX = 50;
const UNDO = { hist: [], known: null, view: null, timer: 0, down: false, hint: null, shown: undefined, applying: false };
const undoHist = v => UNDO.hist[v] || (UNDO.hist[v] = { undo: [], redo: [], trimmed: false });

// ---- the units: what can be changed, how to read and write it, and how to name a change ----
const undoNum = (v, d) => v == null ? 'auto' : typeof v === 'boolean' ? (v ? 'on' : 'off') : typeof v === 'number' ? (d != null ? v.toFixed(d) : String(+v.toPrecision(4))) : String(v);
const undoChange = (name, a, b, fmt = v => undoNum(v), unit = '') => `${name}: ${fmt(a)} → ${fmt(b)}${unit ? ' ' + unit : ''}`;
const ANIM_UNDO = [
  ['fa', 'Feed pulse depth', v => `${Math.round(v * 100)} %`], ['fp', 'Pulse period', v => `${(+v).toFixed(1)} s`],
  ['fd', 'Pulse length', v => `${Math.round(v * 100)} % of period`], ['L0', 'Pool depth at start', v => `${(+v).toFixed(1)} mm`, true],
  ['Lp', 'Pool length upstream', v => `${v} mm`, true], ['z', 'Position across web', v => `${v} mm`], ['rate', 'Playback speed', v => `${(+v).toFixed(2)}×`],
];
const CFDG_UNDO = {
  shape: ['Blade entry', v => v === 'round' ? 'round' : 'flat land'], R: ['Entry radius', null, 'mm'], pool: ['Pool edge upstream', null, 'mm'],
  exitAngle: ['Exit face to the web', null, '°'], model: ['Rheology model', v => (RHEO_MODELS[v] || {}).l || v], fibre: ['Fibre test report', v => (FIBRES[v] || {}).l || v],
  gsm: ['Basis weight', null, 'g/m²'], rhoF: ['Fibre density', null, 'kg/m³'], dFrom: ['Filament diameter from', v => v === 'yarn' ? 'yarn' : 'air permeability'],
  den: ['Yarn', null, 'denier'], nf: ['Filaments per yarn'], airPerm: ['Air permeability', null, '×10⁻³ m³/m²·s'], airDP: ['Air test pressure', null, 'Pa'],
  kozeny: ['Kozeny constant'], airFrac: ['Air fraction, top surface'], airU: ['Air speed up into the fibre', null, 'm/s'], airT: ['Air temperature', null, '°C'], plenum: ['Plenum length', null, 'mm'],
};
const scalarName = v => v === 'none' ? 'none' : (SCALARS[v] || {}).label || v;
const FV_UNDO = {
  view: ['Location shown', v => v === 'compare' ? 'Compare' : v === 'diff' ? 'Difference' : `L${v + 1}`], profileLoc: ['Profiles of', v => `L${v + 1}`],
  base: ['Field', scalarName], streamlines: ['Streamlines'], density: ['Streamline density'], customN: ['Streamline count'], seedMode: ['Streamline seeding'],
  direction: ['Streamline direction'], lineColor: ['Streamline colour'], arrows: ['Streamline arrows'], lineWidth: ['Line width'],
  vectors: ['Vectors'], vectorDensity: ['Vector density'], vectorScale: ['Vector length'], vectorNormalize: ['Vectors all one length'], vectorColor: ['Vectors coloured'],
  yScale: ['Vertical scale'], manualSeeds: ['Streamline seed points', 0], across: ['Across-web quantity', v => (ACROSS[v] || {}).l || v],
  cutFields: ['Fields along the cut lines', 0], cutSel: ['Cut line charted', v => (cfdCuts[v] || {}).name || v + 1], zoom: ['Zoom', 0],
  cmap: ['Colour map', v => v === 'jet' ? 'Jet' : 'blue (colour-blind safe)'], levels: ['Colour levels', v => v ? `${v} bands` : 'smooth'],
  crange: ['Colour range', 0], clog: ['Log colour scale', 0], contours: ['Contour lines'], contourField: ['Contour field', v => v === 'same' ? 'the colour field' : scalarName(v)],
  mesh: ['Mesh display'], meshQuality: ['Mesh quality colours'], diff: ['Difference settings', 0],
};
const DOE_UNDO = {
  loc: ['DOE location', v => `L${v + 1}`], workers: ['Runs at a time'], plot: ['DOE plot'], out: ['DOE output', v => (DOE_OUTPUTS.find(o => o.k === v) || {}).l || v],
  x: ['DOE plot x axis', v => doeAxisName(v)], mx: ['Response map x axis', v => doeAxisName(v)], my: ['Response map y axis', v => doeAxisName(v)], factors: ['DOE factors'],
};
const doeAxisName = j => { const d = (DOE.design || [])[j]; return d ? doeFactor(d.k).l : `factor ${j + 1}`; };

/** A change to a list of named things (probes, cut lines, saved cases). */
function undoListChange(a, b, what, coords) {
  a = a || []; b = b || [];
  const na = a.map(x => x.name), nb = b.map(x => x.name);
  const add = b.filter(x => !na.includes(x.name)), del = a.filter(x => !nb.includes(x.name));
  if (add.length === 1 && del.length === 1 && a.length === b.length) return `Rename ${what} ${del[0].name} → ${add[0].name}`;
  if (add.length && !del.length) return add.length === 1 ? `${what === 'case' ? 'Save' : 'Add'} ${what} ${add[0].name}` : `Add ${add.length} ${what}s`;
  if (del.length && !add.length) return del.length === 1 ? `Delete ${what} ${del[0].name}` : `Delete ${del.length} ${what}s`;
  if (!add.length) {
    const ch = b.find(x => JSON.stringify(x) !== JSON.stringify(a.find(y => y.name === x.name)));
    if (!ch) return `Reorder ${what}s`;
    const o = a.find(y => y.name === ch.name), moved = coords.some(k => o[k] !== ch[k]);
    if (what === 'case') return `Replace case ${ch.name}`;
    if (!moved && 'show' in ch && o.show !== ch.show) return `${ch.show ? 'Show' : 'Hide'} ${what} ${ch.name}`;
    return `${moved ? 'Move' : 'Edit'} ${what} ${ch.name}`;
  }
  return `Edit ${what}s`;
}
/** A change to the DOE factors. */
function undoFactorsChange(a, b) {
  a = a || []; b = b || [];
  const nm = k => (doeFactor(k) || {}).l || k, ka = a.map(f => f.k), kb = b.map(f => f.k);
  const add = kb.filter(k => !ka.includes(k)), del = ka.filter(k => !kb.includes(k));
  if (add.length === 1 && del.length === 1) return `DOE factor: ${nm(del[0])} → ${nm(add[0])}`;
  if (add.length) return `Add DOE factor ${nm(add[0])}`;
  if (del.length) return `Remove DOE factor ${nm(del[0])}`;
  const ch = b.find((f, j) => JSON.stringify(f) !== JSON.stringify(a[j]));
  if (!ch) return 'Reorder DOE factors';
  const f = doeFactor(ch.k), o = a.find(x => x.k === ch.k);
  const lv = s => s.vals ? `${s.vals.length} level${s.vals.length === 1 ? '' : 's'}` : `${doeFmt(f, s.min)} to ${doeFmt(f, s.max)}, ${s.n} levels`;
  return `${f.l}: ${lv(o)} → ${lv(ch)}`;
}

const UNDO_UNITS = (() => {
  const u = [];
  for (const c of CFG) u.push({ id: 'in.' + c.k, get: () => P[c.k], set: v => { setInput(c.k, v); const n = document.getElementById('n_' + c.k); if (n) n.value = (+v).toFixed(c.d); }, label: (a, b) => undoChange(c.l, a, b, v => undoNum(v, c.d), c.u), input: true });
  for (const [k, l, f, reinit] of ANIM_UNDO) u.push({ id: 'anim.' + k, get: () => ANIM[k], set: v => { ANIM[k] = v; }, label: (a, b) => undoChange(l, a, b, f), anim: reinit ? 'reinit' : 'refresh' });
  for (const k of Object.keys(CFDG_DEFAULTS)) {
    const [l, f, unit] = CFDG_UNDO[k] || [k];
    u.push({ id: 'cfdg.' + k, get: () => CFDG[k], set: v => { CFDG[k] = v; }, label: (a, b) => undoChange(l, a, b, f || undefined, unit) });
  }
  for (const k of Object.keys(SOLVER_DEFAULTS)) {
    const q = SOLVER_INPUTS.find(x => x.k === k);
    const [l, f] = k === 'mesh' ? ['Mesh', v => (MESH_PRESETS[v] || {}).l || v] : k === 'tol' ? ['Newton tolerance', fmtTol] : [q ? q.l : k, v => undoNum(v, q && q.d)];
    u.push({ id: 'cfds.' + k, get: () => CFDS[k], set: v => { CFDS[k] = v; }, label: (a, b) => undoChange(l, a, b, f) });
  }
  CFD_LOCS.forEach((loc, i) => {
    const L = `L${i + 1}`;
    u.push({ id: `loc${i}.z`, get: () => CFD_LOCS[i].z, set: v => { CFD_LOCS[i].z = v; }, label: (a, b) => undoChange(`${L} position across the web`, a, b, undefined, 'mm') });
    u.push({ id: `loc${i}.over`, get: () => CFD_LOCS[i].over, set: v => { CFD_LOCS[i].over = { ...(v || {}) }; }, label: (a, b) => {
      const k = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].find(x => (a || {})[x] !== (b || {})[x]);
      const q = LOC_INPUTS.find(x => x.k === k);
      if (!q) return `${L} own inputs`;
      if (b[k] == null) return `${L} ${q.l.toLowerCase()} back to shared`;
      return a[k] == null ? `${L} ${q.l.toLowerCase()}: own value ${undoNum(b[k], q.d)} ${q.u}`.trim() : `${L} ${undoChange(q.l.toLowerCase(), a[k], b[k], v => undoNum(v, q.d), q.u)}`;
    } });
    u.push({ id: `loc${i}.solver`, get: () => CFD_LOCS[i].solver, set: v => { CFD_LOCS[i].solver = { ...(v || {}) }; }, label: () => `${L} own solver settings` });
  });
  u.push({ id: 'probes', get: () => cfdProbes, set: v => { cfdProbes = (v || []).map(q => ({ ...q })); saveProbes(); }, label: (a, b) => undoListChange(a, b, 'probe', ['x', 'y']) });
  u.push({ id: 'cuts', get: () => cfdCuts, set: v => { cfdCuts = (v || []).map(q => ({ ...q })); saveCuts(); }, label: (a, b) => undoListChange(a, b, 'cut line', ['x1', 'y1', 'x2', 'y2']) });
  u.push({ id: 'cases', get: () => readCases() || [], set: v => { writeCases(v || []); }, label: (a, b) => undoListChange(a, b, 'case', []) });
  for (const k of Object.keys(FV_UNDO)) {
    const [l, f] = FV_UNDO[k];
    u.push({ id: 'fv.' + k, get: () => FV[k], set: v => { FV[k] = v === undefined ? JSON.parse(JSON.stringify(FV_DEFAULTS[k])) : v; }, label: (a, b) => f === 0 ? l : undoChange(l, a, b, f || undefined) });
  }
  for (const k of Object.keys(DOE_UNDO)) {
    const [l, f] = DOE_UNDO[k];
    u.push({ id: 'doe.' + k, get: () => DOE[k], set: v => { DOE[k] = v; }, label: (a, b) => k === 'factors' ? undoFactorsChange(a, b) : undoChange(l, a, b, f || undefined) });
  }
  return u;
})();
const UNDO_BY_ID = new Map(UNDO_UNITS.map(u => [u.id, u]));
function undoSnap() {
  const m = {};
  for (const u of UNDO_UNITS) m[u.id] = JSON.stringify(u.get());
  return m;
}
const undoParse = s => s === undefined ? undefined : JSON.parse(s);

// ---- results remembered by their inputs (restored by undo / redo) ----
const UNDO_RESULTS = new Map(), UNDO_RESULTS_MAX = 24;
function undoRemember(k, v) {
  UNDO_RESULTS.delete(k); UNDO_RESULTS.set(k, v);
  while (UNDO_RESULTS.size > UNDO_RESULTS_MAX) UNDO_RESULTS.delete(UNDO_RESULTS.keys().next().value);
}
const doeResultsId = () => JSON.stringify([DOE.design.map(d => [d.k, d.levels]), DOE.key]);
function doeSetupId() {
  const d = (DOE.factors || []).map(fs => ({ ...fs, f: doeFactor(fs.k) })).filter(x => x.f && doeAvailable(x.f)).map(x => [x.k, doeLevels(x)]);
  return JSON.stringify([d, cfdInputsKey(cfdGeometry(DOE.loc))]);
}
function undoKeepResults() {
  for (const r of cfdRuns) if (r.field && r.key) undoRemember(r.key, { status: 'done', result: r.result, geo: r.geo, key: r.key, elapsedMs: r.elapsedMs, field: r.field, streamCache: r.streamCache || new Map(), metrics: r.metrics });
  if (DOE.status !== 'running' && DOE.design && DOE.runs.length) undoRemember('doe ' + doeResultsId(), { design: DOE.design, runs: DOE.runs, status: DOE.status, key: DOE.key, t0: DOE.t0, t1: DOE.t1 });
}
function undoRestoreResults() {
  cfdRuns.forEach((r, i) => {
    if (r.status === 'running') return;
    let k;
    try { k = cfdInputsKey(cfdGeometry(i)); } catch (e) { return; }
    if (r.field && r.key === k) return;
    const c = UNDO_RESULTS.get(k);
    if (!c) return;
    for (const x of Object.keys(r)) delete r[x];
    Object.assign(r, c);
  });
  if (DOE.status !== 'running' && DOE.factors) {
    let want;
    try { want = doeSetupId(); } catch (e) { return; }
    if (DOE.design && doeResultsId() === want) return;
    const c = UNDO_RESULTS.get('doe ' + want);
    if (c) {
      Object.assign(DOE, c, { active: new Set() });
      const n = c.design.length;
      DOE.x = Math.min(DOE.x, n - 1); DOE.mx = Math.min(DOE.mx, n - 1); DOE.my = Math.min(DOE.my, n - 1);
      if (n > 1 && DOE.mx === DOE.my) DOE.my = DOE.mx ? 0 : 1;
    }
  }
}

// ---- picking changes up ----
/** Name a step from the units it changed. */
function undoLabel(ids, a, b) {
  const one = id => { try { return UNDO_BY_ID.get(id).label(undoParse(a[id]), undoParse(b[id])); } catch (e) { return id; } };
  if (ids.length === 1) return one(ids[0]);
  if (ids.every(id => UNDO_BY_ID.get(id).input)) return `Change ${ids.length} inputs`;
  return `${one(ids[0])} (+${ids.length - 1} more)`;
}
/** Record what changed since the last step as a step of the view it was made in. */
function undoCommit() {
  clearTimeout(UNDO.timer); UNDO.timer = 0;
  if (!UNDO.known) return false;
  const v = UNDO.view ?? tab, hint = UNDO.hint;
  UNDO.view = null; UNDO.hint = null;
  const now = undoSnap(), before = {}, after = {}, ids = [];
  for (const id in now) if (now[id] !== UNDO.known[id]) { before[id] = UNDO.known[id]; after[id] = now[id]; ids.push(id); }
  if (!ids.length) return false;
  undoKeepResults();
  const h = undoHist(v);
  h.undo.push({ label: hint || undoLabel(ids, UNDO.known, now), t: Date.now(), before, after });
  if (h.undo.length > UNDO_MAX) { h.undo.shift(); h.trimmed = true; }
  h.redo.length = 0;
  UNDO.known = now;
  if (v === tab) undoUI();
  return true;
}
function undoSchedule() {
  if (UNDO.applying || !UNDO.known) return;
  if (UNDO.view == null) UNDO.view = tab;   // (the view the change is being made in)
  clearTimeout(UNDO.timer);
  UNDO.timer = setTimeout(function tick() { if (UNDO.down) UNDO.timer = setTimeout(tick, 250); else undoCommit(); }, 600);
}
/** Name the next step (a button that changes several things at once); changes before it stay a step of their own. */
function undoHint(label) { undoCommit(); UNDO.hint = label; UNDO.view = tab; undoSchedule(); }
/** Take what the program itself just changed as the starting point (not a step). */
function undoSync() { UNDO.known = undoSnap(); }
/** A new or opened project: every view's history starts again. */
function undoReset() {
  clearTimeout(UNDO.timer); UNDO.timer = 0;
  UNDO.hist = []; UNDO.view = null; UNDO.hint = null; UNDO_RESULTS.clear();
  UNDO.shown = tab; undoSync(); undoUI();
}
for (const t of ['input', 'change', 'click', 'wheel', 'keyup', 'pointerup']) document.addEventListener(t, undoSchedule, { capture: true, passive: true });
document.addEventListener('pointerdown', () => { UNDO.down = true; }, true);
for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { UNDO.down = false; }, true);

/** ui.js, at the start of render(): changes made before switching views belong to the view left. */
function undoBeforeRender() {
  if (UNDO.shown !== undefined && UNDO.shown !== tab) { if (UNDO.view == null) UNDO.view = UNDO.shown; undoCommit(); }
}
/** ui.js, at the end of render(): a view just opened may set itself up (not a step). */
function undoAfterRender() {
  if (UNDO.shown !== tab) { UNDO.shown = tab; clearTimeout(UNDO.timer); UNDO.timer = 0; UNDO.view = null; undoSync(); }
  undoUI();
}

// ---- undo, redo, jump ----
function undoApply(map) {
  UNDO.applying = true;
  let anim = null;
  try {
    for (const id of Object.keys(map)) {
      const u = UNDO_BY_ID.get(id);
      if (!u) continue;
      u.set(undoParse(map[id]));
      if (u.anim) anim = anim === 'reinit' ? anim : u.anim;
    }
    if (anim) ANIM[anim]();
    undoRestoreResults();
  } finally { UNDO.applying = false; }
}
function undoStep(dir) {
  const h = undoHist(tab), from = dir < 0 ? h.undo : h.redo, to = dir < 0 ? h.redo : h.undo;
  const e = from[from.length - 1];
  if (!e) return null;
  // (the DOE's location is fixed while it runs, as its menu is)
  if (DOE.status === 'running' && 'doe.loc' in e.before) { imgToast(`Stop the DOE first: "${e.label}" changes its location.`, 'error'); return null; }
  from.pop();
  undoApply(dir < 0 ? e.before : e.after);
  to.push(e);
  return e;
}
function undoFinish(msg) {
  render();
  undoSync();
  undoUI();
  if (msg) imgToast(msg);
}
function undoGo(dir) {
  if (UNDO.down) return;
  undoCommit();
  undoKeepResults();
  const e = undoStep(dir);
  if (e) undoFinish(`${dir < 0 ? 'Undone' : 'Redone'}: ${e.label}`);
}
const undo = () => undoGo(-1), redo = () => undoGo(1);
/** Go to step `pos` of this view's history (0 = its start). */
function undoJump(pos) {
  undoCommit();
  undoKeepResults();
  const h = undoHist(tab);
  let n = 0;
  while (h.undo.length > pos && undoStep(-1)) n++;
  while (h.undo.length < pos && undoStep(1)) n++;
  if (n) undoFinish(pos ? `Back to step ${pos}: ${h.undo[pos - 1].label}` : 'Back to the start of the history');
}

// ---- the Edit menu, the title-bar buttons and the History panel ----
function undoUI() {
  const h = undoHist(tab), u = h.undo[h.undo.length - 1], r = h.redo[h.redo.length - 1];
  for (const [id, mid, e, name, keys] of [['undoBtn', 'emUndo', u, 'Undo', 'Ctrl+Z'], ['redoBtn', 'emRedo', r, 'Redo', 'Ctrl+Y']]) {
    const b = document.getElementById(id), m = document.getElementById(mid);
    const tip = e ? `${name}: ${e.label} (${keys})` : `${name} (${keys}): nothing to ${name.toLowerCase()} in this view`;
    if (b) { b.disabled = !e; b.title = tip; b.setAttribute('aria-label', tip); }
    if (m) { m.disabled = !e; m.querySelector('.mi-l').textContent = e ? `${name}: ${e.label}` : name; m.title = e ? e.label : ''; }
  }
  renderHistory();
}
const undoClock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
function renderHistory() {
  const n = document.querySelector('#view .tab-n[data-n="history"]'), h = undoHist(tab);
  if (n) n.textContent = h.undo.length ? String(h.undo.length) : '';
  const host = document.querySelector('#view .history-host');
  if (!host) return;
  const pos = h.undo.length, redo = h.redo.slice().reverse(), all = [...h.undo, ...redo];
  const row = (j, label, t) => `<li><button type="button" class="hist-row${j === pos ? ' is-cur' : ''}${j > pos ? ' is-undone' : ''}" data-pos="${j}"${j === pos ? ' aria-current="step"' : ''}>
    <span class="hist-n">${j}</span><span class="hist-l">${escapeHtml(label)}${j === pos ? ' <span class="hist-tag">current</span>' : j > pos ? ' <span class="hist-tag">undone</span>' : ''}</span><span class="hist-t">${t ? undoClock(t) : ''}</span></button></li>`;
  host.innerHTML = `<div class="fv-bar">
      <button class="btn btn-secondary btn-sm" type="button" data-hist="undo"${pos ? '' : ' disabled'}>Undo</button>
      <button class="btn btn-secondary btn-sm" type="button" data-hist="redo"${h.redo.length ? '' : ' disabled'}>Redo</button>
      <span class="fv-why">${all.length ? `Changes made in this view, oldest first. Click a step to go back to it; the steps after it stay until you change something.` : 'No changes in this view yet. Each change you make here is listed, and can be undone (Ctrl+Z) and redone (Ctrl+Y).'}</span>
    </div>
    <ol class="hist-list">${row(0, h.trimmed ? `Oldest kept state (the history keeps the last ${UNDO_MAX} steps)` : 'Start', 0)}${all.map((e, k) => row(k + 1, e.label, e.t)).join('')}</ol>`;
  host.querySelector('[data-hist="undo"]').onclick = undo;
  host.querySelector('[data-hist="redo"]').onclick = redo;
  host.querySelectorAll('.hist-row').forEach(b => { b.onclick = () => undoJump(+b.dataset.pos); });
  const cur = host.querySelector('.hist-row.is-cur');
  if (cur && host.closest('.dock-body')) { const body = host.closest('.dock-body'); if (cur.offsetTop > body.scrollTop + body.clientHeight - 40) body.scrollTop = cur.offsetTop - body.clientHeight / 2; }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
/** Open this view's History panel. */
function showHistory() {
  const b = document.querySelector('#view .dock-tabs button[data-dock="history"]');
  if (b) { b.click(); b.focus(); }
  renderHistory();
}
(function editMenu() {
  const menu = document.getElementById('editMenu');
  const close = () => { if (menu) menu.open = false; };
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = () => { close(); f(); }; };
  on('emUndo', undo); on('emRedo', redo); on('emHistory', showHistory);
  on('undoBtn', undo); on('redoBtn', redo);
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    // (typing in a text box: the browser's own undo of the text)
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && ['text', 'search', 'email', 'url'].includes(t.type)))) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (k === 'y' || e.shiftKey) redo(); else undo();
  });
})();
