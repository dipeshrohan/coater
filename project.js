'use strict';
/*
 * Project files (.bcdl, JSON): every input (sidebar, CFD setup, solver and mesh, the locations'
 * own), probes, cut lines, saved cases, the view (module, display and colour settings, zoom,
 * dock), the DOE (design and runs) and the solved results (fields, mesh study), so a project opens
 * without solving again. File menu in the title bar: New, Open (Ctrl+O), Save (Ctrl+S), Save as
 * (Ctrl+Shift+S), recent projects where the browser can reopen files (File System Access API).
 * The project's name (• when it has unsaved changes) is in the title bar and the browser tab.
 */
const PROJ_FORMAT = 1, PROJ_APP = 'Blade Coat Defect Lab', APP_VERSION = '2026.09';
const PROJ = { name: 'Untitled', handle: null, savedKey: null };
// (the defaults, for New: taken before anything is changed)
const CFDG_DEFAULTS = JSON.parse(JSON.stringify(CFDG));
const FV_DEFAULTS = JSON.parse(JSON.stringify(FV));
const DOE_DEFAULTS = { loc: DOE.loc, workers: DOE.workers, plot: DOE.plot, out: DOE.out, x: 0, mx: 0, my: 1, dock: DOE.dock, dockH: DOE.dockH };
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
const projKey = () => JSON.stringify([CFG.map(c => P[c.k]), CFDG, CFDS, CFD_LOCS.map(l => [l.z, l.over, l.solver]), cfdProbes, cfdCuts, DOE.factors, MEAS.sets.map(({ cfd, ...d }) => d)]);
const projDirty = () => PROJ.savedKey != null && projKey() !== PROJ.savedKey;
function projectData() {
  const runOut = r => r.status === 'done' && r.result ? { status: 'done', result: r.result, geo: r.geo, key: r.key, elapsedMs: r.elapsedMs } : null;
  return {
    app: PROJ_APP, format: PROJ_FORMAT, saved: new Date().toISOString(), name: PROJ.name,
    inputs: Object.fromEntries(CFG.map(c => [c.k, P[c.k]])),
    cfdSetup: { ...CFDG }, solver: { ...CFDS },
    locations: CFD_LOCS.map(l => ({ z: l.z, over: { ...l.over }, solver: { ...l.solver } })),
    probes: cfdProbes, cuts: cfdCuts, cases: readCases() || [],
    view: { module: tab, FV },
    doe: {
      loc: DOE.loc, workers: DOE.workers, factors: DOE.factors, plot: DOE.plot, out: DOE.out, x: DOE.x, mx: DOE.mx, my: DOE.my, dock: DOE.dock, dockH: DOE.dockH,
      status: DOE.status === 'running' ? 'stopped' : DOE.status, key: DOE.key, t0: DOE.t0, t1: DOE.t1 || Date.now(),
      design: DOE.design ? DOE.design.map(d => ({ k: d.k, min: d.min, max: d.max, n: d.n, vals: d.vals, levels: d.levels })) : null,
      runs: DOE.runs.map(r => ({ n: r.n, idx: r.idx, vals: r.vals, status: r.status === 'running' || r.status === 'pending' ? 'stopped' : r.status, out: r.out, error: r.error, ms: r.ms })),
    },
    results: cfdRuns.map(runOut),
    meshStudy: meshStudy ? { loc: meshStudy.loc, key: meshStudy.key, status: meshStudy.status === 'running' ? 'cancelled' : meshStudy.status, runs: meshStudy.runs.map(r => ({ name: r.name, f: r.f, solver: r.solver, status: r.status === 'running' ? 'cancelled' : r.status, r: r.r, ms: r.ms, error: r.error, reused: r.reused })) } : null,
    messages: cfdLog.map(m => ({ t: m.t, i: m.i, text: m.text, kind: m.kind })),
    measured: {
      sets: MEAS.sets.map(d => ({ ...d, cfd: d.cfd ? { ...d.cfd, status: d.cfd.status === 'running' ? 'stopped' : d.cfd.status } : null })),
      sel: MEAS.sel, fit: MEAS.fit ? { ...MEAS.fit, cfd: MEAS.fit.cfd ? { ...MEAS.fit.cfd, status: MEAS.fit.cfd.status === 'running' ? 'stopped' : MEAS.fit.cfd.status } : null } : null,
      fitKeys: MEAS.fitKeys, fitRange: MEAS.fitRange, fitSets: MEAS.fitSets, dock: MEAS.dock, dockH: MEAS.dockH,
    },
  };
}
/** Set a sidebar input as its slider does (everything listening updates). */
function setInput(k, v) {
  const sl = document.getElementById('s_' + k);
  if (sl) { sl.value = v; sl.dispatchEvent(new Event('input')); } else P[k] = v;
}
/** Stop whatever is solving. */
function projStopAll() { cancelAllLocations(); stopDOE(); measStopCfd(); }
/** The measured data of a project (none: empty). */
function applyMeasured(m) {
  m = m || {};
  MEAS.sets = Array.isArray(m.sets) ? m.sets.map(d => ({ ...d })) : [];
  measCfdCache.clear(); for (const d of MEAS.sets) if (d.cfd) measCfdCache.set(d.id, d.cfd);
  MEAS.sel = MEAS.sets.some(d => d.id === m.sel) ? m.sel : MEAS.sets.length ? MEAS.sets[0].id : null;
  MEAS.fit = m.fit || null; MEAS.fitKeys = Array.isArray(m.fitKeys) && m.fitKeys.length ? m.fitKeys : ['th']; MEAS.fitRange = m.fitRange || {}; MEAS.fitSets = m.fitSets || null;
  MEAS.dock = m.dock || 'compare'; MEAS.dockH = m.dockH || 300;
}
function applyProject(p) {
  if (!p || p.app !== PROJ_APP) throw new Error('this is not a Blade Coat Defect Lab project');
  if (p.format > PROJ_FORMAT) throw new Error('the project was saved by a newer version of the app');
  projStopAll();
  for (const c of CFG) if (p.inputs && c.k in p.inputs) setInput(c.k, p.inputs[c.k]);
  Object.assign(CFDG, CFDG_DEFAULTS); for (const k of Object.keys(CFDG)) if (p.cfdSetup && k in p.cfdSetup) CFDG[k] = p.cfdSetup[k];
  Object.assign(CFDS, SOLVER_DEFAULTS, p.solver || {});
  CFD_LOCS.forEach((l, i) => { const s = (p.locations || [])[i] || {}; l.z = s.z ?? LOC_Z_DEFAULTS[i]; l.over = { ...(s.over || {}) }; l.solver = { ...(s.solver || {}) }; });
  cfdProbes = Array.isArray(p.probes) ? p.probes.map(q => ({ ...q })) : []; saveProbes();
  cfdCuts = Array.isArray(p.cuts) ? p.cuts.map(q => ({ ...q })) : []; saveCuts();
  if (Array.isArray(p.cases) && p.cases.length) {
    // (the project's cases join this browser's list: same name = the project's)
    const list = readCases() || [];
    for (const c of p.cases) { const at = list.findIndex(x => x.name === c.name); if (at >= 0) list[at] = c; else list.push(c); }
    writeCases(list);
  }
  Object.assign(FV, JSON.parse(JSON.stringify(FV_DEFAULTS)), (p.view && p.view.FV) || {});
  // results: the fields rebuilt from the solutions
  cfdRuns.forEach((r, i) => {
    for (const k of Object.keys(r)) delete r[k];
    const s = (p.results || [])[i];
    if (s && s.result) {
      const field = makeFlowField(s.result, { rho: s.geo.rho, ty: s.geo.ty });
      Object.assign(r, { status: 'done', result: s.result, geo: s.geo, key: s.key, elapsedMs: s.elapsedMs, field, streamCache: new Map(), metrics: flowMetrics(field) });
    } else r.status = 'idle';
  });
  cfdAutoStarted = cfdRuns.some(r => r.field);
  meshStudy = p.meshStudy ? { ...p.meshStudy, runs: p.meshStudy.runs.map(r => ({ ...r, metrics: r.r ? flowMetrics(makeFlowField(r.r, { rho: RHO, ty: cfdGeometry(p.meshStudy.loc).ty })) : null })) } : null;
  const d = p.doe || {};
  Object.assign(DOE, DOE_DEFAULTS, { loc: d.loc ?? 0, workers: d.workers ?? DOE_DEFAULTS.workers, factors: d.factors || null, plot: d.plot || 'response', out: d.out || 'film', x: d.x || 0, mx: d.mx || 0, my: d.my ?? 1, dock: d.dock || 'design', dockH: d.dockH || 300,
    design: d.design ? d.design.map(x => ({ ...x, f: doeFactor(x.k) })) : null, runs: d.runs || [], status: d.runs && d.runs.length ? (d.status || 'done') : 'idle', key: d.key || null, t0: d.t0 || 0, t1: d.t1 || 0, active: new Set() });
  cfdLog.length = 0; for (const m of p.messages || []) cfdLog.push({ ...m, t: new Date(m.t) });
  applyMeasured(p.measured);
  tab = Number.isInteger(p.view && p.view.module) && p.view.module < TABS.length ? p.view.module : tab;
  render();
  undoReset();
}

// ---- menu actions ----
async function newProject() {
  if (!(await confirmDiscard())) return;
  projStopAll();
  for (const c of CFG) setInput(c.k, c.v);
  Object.assign(CFDG, JSON.parse(JSON.stringify(CFDG_DEFAULTS)));
  Object.assign(CFDS, SOLVER_DEFAULTS);
  CFD_LOCS.forEach((l, i) => { l.z = LOC_Z_DEFAULTS[i]; l.over = {}; l.solver = {}; });
  cfdProbes = []; saveProbes(); cfdCuts = []; saveCuts();
  Object.assign(FV, JSON.parse(JSON.stringify(FV_DEFAULTS)));
  cfdRuns.forEach(r => { for (const k of Object.keys(r)) delete r[k]; r.status = 'idle'; });
  cfdAutoStarted = false; meshStudy = null;
  Object.assign(DOE, DOE_DEFAULTS, { factors: null, design: null, runs: [], status: 'idle', key: null, t0: 0, t1: 0, active: new Set() });
  cfdLog.length = 0;
  applyMeasured(null);
  for (const id of [...inputProblems.keys()]) clearRejected(id);
  Object.assign(PROJ, { name: 'Untitled', handle: null });
  render();
  undoReset();
  PROJ.savedKey = projKey(); updateProjectTitle();
}
async function openProject(handle) {
  if (!(await confirmDiscard())) return;
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
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); openProject(); }
  });
  addEventListener('beforeunload', e => { if (projDirty()) { e.preventDefault(); e.returnValue = ''; } });
})();

// ---------------------------------------------------------------------
// Session memory: the whole working state (as a project, results included) kept in this browser
// every minute and when the tab is hidden; on the next visit a bar asks to continue from it.
// ---------------------------------------------------------------------
const SESSION = { suspended: true, lastKey: null, timer: 0 };
/** What has to change for the session to be written again: inputs, view, results, DOE, mesh study, project. */
const sessionKey = () => [projKey(), JSON.stringify([tab, FV, PROJ.name, projDirty()]), cfdRuns.map(r => `${r.status}:${r.key || ''}:${r.elapsedMs || ''}`).join(','),
  DOE.runs.map(r => r.status).join(''), meshStudy ? meshStudy.status : ''].join('|');
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
    || JSON.stringify(p.inputs) !== defaults || (p.probes && p.probes.length) || (p.cuts && p.cuts.length));
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
