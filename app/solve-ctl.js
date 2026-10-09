'use strict';
/*
 * solve-ctl.js — solving only on request (Phase 0; the owner's choice "ask each time").
 *
 * Nothing solves because the app or a page opened, or because an input changed. A model solves when it is asked for:
 * its Solve button, "Solve the line", or "Re-solve" on the bar that appears when an input change leaves solved results
 * out of date ("Keep as is" keeps them, shown as out of date, until the next change).
 *
 * The models' own request functions (oneDRequest, dryRequest, filmRequest, …) start a solve only while it is asked for
 * (solveAsked) and take the ask when they start or find the result already current (solveTake). Asking for a model asks
 * for the models it needs first (its upstream, when they are not current); a pump starts each asked model, in the line's
 * order, as soon as what it needs is current. The 2D and 3D CFD were always on request (Run, Solve 3D): the bar lists
 * them too, and Re-solve runs them.
 * Loaded after the stage pages' scripts (their globals are read when the functions run) and before ui.js.
 */

/** The models asked for and not yet started. */
const SOLVE_ASK = new Set();
const solveAsked = k => SOLVE_ASK.has(k);
const solveTake = k => { SOLVE_ASK.delete(k); };
/** Whether a model may start now: asked for, and nothing it needs first still asked for or solving (it never starts on
 *  part of its inputs; the pump starts it once they are done). */
const solveMay = k => SOLVE_ASK.has(k) && !solveUpWait(k) && meshReady(k);
/** Whether what model k needs first is still asked for or solving. */
const solveUpWait = k => (SOLVE_M[k] || { up: [] }).up.some(u => SOLVE_ASK.has(u) || solveState(u) === 'busy');

const fnOk = f => typeof f === 'function';
/** The models (id → what it is called, the page it is on, what it needs first, and its state). */
const SOLVE_M = {
  mix: { l: 'Mixing (the batch)', nav: 'mix', up: [], has: () => !!MIX.res, cur: () => mixCurrent(), busy: () => MIX.busy, err: () => !!(MIX.error && MIX.key === mixKeyNow()),
    key: () => mixKeyNow(), go: () => mixRequest() },
  '1d': { l: 'Coating 1D', nav: 'gap', up: [], has: () => !!ONE_D.res, cur: () => fnOk(oneDCurrent) && oneDCurrent() && !!oneDAcrossNow(),
    busy: () => ONE_D.busy, err: () => !!ONE_D.error, key: () => JSON.stringify([CFD_LOCS.map((_, i) => oneDGeo(i)), oneDRipple(), acrossPositions().map(oneDGeoAt)]), go: () => oneDRequest(true) },
  // (the start-up, Coating › 1D › Pool and feed: from the 1D at the four locations and its pulse cycle)
  su1: { l: 'Start-up 1D', nav: 'feed1d', up: ['1d'], has: () => !!SU1.res, cur: () => su1Current(), busy: () => SU1.busy, err: () => !!(SU1.error && SU1.key === su1KeyNow()),
    key: () => su1KeyNow(), ready: () => su1Base() != null, go: () => su1Request() },
  dry: { l: 'Drying', nav: 'dry', up: ['1d'], has: () => !!DRY.res, cur: () => dryCurrent(), busy: () => DRY.busy, err: () => !!(DRY.error && DRY.key === dryKeyNow()),
    key: () => dryKeyNow(), ready: () => dryFilms().length > 0, go: () => dryRequest() },
  film: { l: 'Peel and wind (the film)', nav: 'peel', up: ['dry'], has: () => !!FILM.res, cur: () => filmCurrent(), busy: () => FILM.busy, err: () => !!(FILM.error && FILM.key === filmKeyNow()),
    key: () => filmKeyNow(), ready: () => dryCurrent(), go: () => filmRequest() },
  sheet: { l: 'Cutting (the piece in 3D)', nav: 'cut', up: ['film'], has: () => !!SHEET.res, cur: () => sheetCurrent(), busy: () => SHEET.busy, err: () => !!(SHEET.error && SHEET.key === sheetKeyNow()),
    key: () => sheetKeyNow(), ready: () => filmCurrent(), go: () => sheetRequest() },
  stack: { l: 'Pre heat (the pressed stack)', nav: 'stack', up: ['film', 'sheet'], has: () => !!STACK.res, cur: () => stackCurrent(), busy: () => STACK.busy, err: () => !!(STACK.error && STACK.key === stackKeyNow()),
    key: () => stackKeyNow(), ready: () => filmCurrent() && sheetCurrent(), go: () => stackRequest() },
  furn: { l: 'Furnace (the two runs)', nav: 'furn', up: ['film', 'sheet'], has: () => !!FURN.res, cur: () => furnCurrent(), busy: () => FURN.busy, err: () => !!(FURN.error && FURN.key === furnKeyNow()),
    key: () => furnKeyNow(), ready: () => filmCurrent() && sheetCurrent(), go: () => furnRequest() },
};
// (the stages' multiphysics, 1D / 2D / 3D each: drying, the roll (1D) and the peel front (2D), the pressed stack, the furnace's holder,
//  the graphene film on a heater, the cut edge and the cut piece, the mixer's batch in 2D and 3D)
[['dmp', 'Drying', 'dry', ['1d'], () => DMS, d => dmpKeyNow(d), d => dmpCurrent(d), d => dmpRequest(d)],
 ['pmp', 'Peel and wind', 'peel', ['film'], () => PMS, d => pmpKeyNow(d), d => pmpCurrent(d), d => pmpRequest(d), [1, 2, 3]],
 ['mps', 'Pre heat', 'stack', ['film', 'sheet'], () => MPS, d => mpKeyNow(d), d => mpCurrent(d), d => mpStackRequest(d)],
 ['fmp', 'Furnace', 'furn', ['film', 'sheet'], () => FMS, d => fmpKeyNow(d), d => fmpCurrent(d), d => fmpRequest(d)],
 ['gmp', 'Graphene film', 'gfilm', ['furn'], () => GFS, d => gfmKeyNow(d), d => gfmCurrent(d), d => gfmRequest(d)],
 ['cmp', 'Cutting', 'cut', ['film'], () => CMS, d => cmKeyNow(d), d => cmCurrent(d), d => cmRequest(d)],
 ['xmp', 'Mixing', 'mix', ['mix'], () => XMS, d => xmKeyNow(d), d => xmCurrent(d), d => xmRequest(d), [2, 3]]].forEach(([p, l, nav, up, S, key, cur, go, dims = [1, 2, 3]]) => {
  for (const d of dims) SOLVE_M[p + d] = { l: `${l} ${d}D`, nav: nav + d + 'd', up, dim: d, has: () => !!S().res[d], cur: () => cur(d), busy: () => S().busy && S().bdim === d,
    err: () => !!(S().error[d] && S().key[d] === key(d)), key: () => key(d), ready: () => key(d) != null, go: () => go(d) };
});
// (the pool behind the blade in 2D and 3D, Coating › 2D and 3D › Pool and feed: from the 1D's pulse cycle)
for (const d of [2, 3]) SOLVE_M['pool' + d] = { l: `Pool and feed ${d}D`, nav: `feed${d}d`, up: ['1d'], dim: d, has: () => !!POOL[d].res, cur: () => poolCurrent(d), busy: () => POOL[d].busy,
  err: () => !!(POOL[d].error && POOL[d].key === poolKeyNow(d)), key: () => poolKeyNow(d), ready: () => poolBase(d) != null, go: () => poolRequest(d) };
// ---- meshing only when asked (task 4b): a model with a Mesh step solves only on the mesh the user made for its inputs ----
/** The meshes the user made (Mesh), by model: the inputs (its key) each was laid out for. */
const MESH_DONE = {};
/** The models dropped from a solve for want of their mesh (shown on their page until meshed). */
const SOLVE_NOMESH = new Set();
/** The models with a Mesh step of their own: the stages' 1D, 2D and 3D, and the pool in 3D. */
const meshNeeded = k => /^(dmp|pmp|mps|fmp|gmp|cmp|xmp)\d$/.test(k) || k === 'pool3';
/** A model's mesh: 'ok' (made for its inputs as they are), 'stale' (made for others) or 'none' (not made). */
function meshState(k) {
  if (!MESH_DONE[k]) return 'none';
  return MESH_DONE[k] === solveSafe(SOLVE_M[k].key, null) ? 'ok' : 'stale';
}
/** Whether a model may solve: no Mesh step of its own, or its mesh made for its inputs (or its result current). */
const meshReady = k => !meshNeeded(k) || meshState(k) === 'ok' || solveState(k) === 'solved';
/** How each model's page lays out its mesh (set by the page): returns nothing when laid out, or why it cannot be. */
const MESH_LAY = {};
/** Why a model's mesh could not be laid out, for the inputs (key) it was tried on: { key, error }. */
const MESH_ERR = {};
/** Why the model's mesh cannot be laid out for its inputs as they are (null when it can, or was not tried). */
const meshError = k => (MESH_ERR[k] && MESH_ERR[k].key === solveSafe(SOLVE_M[k].key, null) ? MESH_ERR[k].error : null);
/** Mesh (the Mesh step's button): the model's mesh laid out for its inputs as they are -- marked made only once laid out. */
function meshDo(k) {
  if (typeof sensBlocks === 'function' && sensBlocks()) return;   // (the ranking of the assumed values runs: its inputs are not the project's)
  const key = solveSafe(SOLVE_M[k].key, null);
  if (key == null) return;
  let err = null;
  try { err = MESH_LAY[k] ? MESH_LAY[k]() || null : null; } catch (e) { err = (e && e.message) || String(e); }
  if (err) { delete MESH_DONE[k]; MESH_ERR[k] = { key, error: String(err) }; }
  else { MESH_DONE[k] = key; delete MESH_ERR[k]; SOLVE_NOMESH.delete(k); }
  if (typeof render === 'function') render();
}
/** The model with a Mesh step on the page shown (the Mesh menu's "Mesh this page"), or null. */
function meshPageId() {
  const n = typeof navNow === 'function' ? navNow() : null;
  return n ? Object.keys(SOLVE_M).find(k => meshNeeded(k) && SOLVE_M[k].nav === n) || null : null;
}
/** The order a pump starts them in (each after what it needs). */
const SOLVE_ORDER = ['mix', 'xmp2', 'xmp3', '1d', 'su1', 'dry', 'film', 'sheet', 'stack', 'furn', 'dmp1', 'dmp2', 'dmp3', 'pmp1', 'pmp2', 'pmp3', 'cmp1', 'cmp2', 'cmp3', 'mps1', 'mps2', 'mps3', 'fmp1', 'fmp2', 'fmp3', 'gmp1', 'gmp2', 'gmp3', 'pool2', 'pool3'];
/** The line's chain, for "Solve the line". */
const SOLVE_LINE = ['mix', '1d', 'dry', 'film', 'sheet', 'stack', 'furn'];

const solveSafe = (f, d) => { try { return f(); } catch (e) { return d; } };
/** A model's state: 'busy' | 'solved' | 'stale' (solved for other inputs) | 'failed' | 'todo' (never solved). */
function solveState(k) {
  const m = SOLVE_M[k];
  if (!m) return 'todo';
  if (solveSafe(m.busy, false)) return 'busy';
  if (solveSafe(m.cur, false)) return 'solved';
  if (solveSafe(m.err, false)) return 'failed';
  return solveSafe(m.has, false) ? 'stale' : 'todo';
}

/** Ask for models (with what they need first, when not current) and start what can start. */
function solveArm(...ids) {
  if (typeof sensBlocks === 'function' && sensBlocks()) return;   // (the ranking of the assumed values runs: its inputs are not the project's)
  const add = k => {
    const m = SOLVE_M[k];
    if (!m || SOLVE_ASK.has(k)) return;
    m.up.forEach(u => { if (solveState(u) !== 'solved') add(u); });
    SOLVE_ASK.add(k);
  };
  ids.flat().forEach(add);
  solvePump();
  if (typeof render === 'function') render();
}
/** Start each asked model whose inputs are ready (in the line's order); drop an ask whose upstream failed or is not asked. */
function solvePump() {
  // (the ranking of the assumed values holds its value under change back while an edit is handled: nothing starts then)
  if (typeof SENS !== 'undefined' && SENS.held) return;
  for (const k of SOLVE_ORDER) {
    if (!SOLVE_ASK.has(k)) continue;
    const m = SOLVE_M[k];
    if (solveSafe(m.busy, false)) continue;
    if (solveSafe(m.cur, false)) { SOLVE_ASK.delete(k); continue; }
    // (its mesh not made for these inputs, once what it needs is done: not solved -- the user meshes; the chain stops here)
    if (!solveUpWait(k) && !meshReady(k)) { SOLVE_ASK.delete(k); SOLVE_NOMESH.add(k); continue; }
    if (!solveMay(k)) continue;                                                  // (what it needs first: asked for or solving)
    if (m.ready && !solveSafe(m.ready, false)) {
      // (waiting for what it needs: while that is asked for or solving; else it can't be solved now)
      const waiting = m.up.some(u => SOLVE_ASK.has(u) || solveState(u) === 'busy');
      if (!waiting) SOLVE_ASK.delete(k);
      continue;
    }
    solveSafe(m.go, null);
  }
  solveBarPaint();
}
setInterval(() => { if (SOLVE_ASK.size) solvePump(); else solveBarPaint(); }, 400);

// ---- the bar: inputs changed, solved results out of date ----
/** What is out of date now: the line's models, the stages' multiphysics, the 2D at each location, the 3D. */
function solveStaleList() {
  const out = [];
  for (const k of SOLVE_ORDER) if (solveState(k) === 'stale' && !SOLVE_ASK.has(k)) out.push({ id: k, l: SOLVE_M[k].l + (meshReady(k) ? '' : ' (mesh first)'), key: solveSafe(SOLVE_M[k].key, null) });
  if (typeof cfdRuns !== 'undefined') cfdRuns.forEach((r, i) => { if (r.status !== 'running' && solveSafe(() => cfdIsStale(i), false)) out.push({ id: 'cfd' + i, l: `2D at L${i + 1}${typeof mesh2DReady === 'function' && !mesh2DReady(i) ? ' (mesh first)' : ''}`, key: solveSafe(() => cfdInputsKey(cfdGeometry(i)), null) }); });
  if (typeof C3D_RES !== 'undefined' && C3D_RES && C3D_RUN.status !== 'running') {
    const k3 = solveSafe(() => c3dSolveKey3(C3D_RES), null);
    if (k3 && k3 !== C3D_RES.key) out.push({ id: '3d', l: (C3D_RES.region === 'strip' ? `3D strip at L${C3D_RES.loc + 1}` : C3D_RES.region === 'edge' ? '3D edge strip' : '3D full width') + (typeof mesh3DReady === 'function' && !mesh3DReady() ? ' (mesh first)' : ''), key: k3 });
  }
  return out;
}
/** The out-of-date set the user chose to keep (its keys): the bar comes back when an input changes again. */
let solveKept = '';
const solveSel = new Set();   // (the ones ticked off on the bar: not re-solved)
function solveBarPaint() {
  let bar = document.getElementById('solveBar');
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'solveBar'; bar.className = 'solve-bar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Results out of date');
    bar.hidden = true; document.body.appendChild(bar);
    bar.addEventListener('click', e => {
      const t = e.target.closest('button, input'); if (!t) return;
      if (t.dataset.sbx) { if (t.checked) solveSel.delete(t.dataset.sbx); else solveSel.add(t.dataset.sbx); return; }
      if (t.id === 'solveBarKeep') { solveKept = solveStaleSig(solveStaleList()); solveBarPaint(); return; }
      if (t.id === 'solveBarGo') solveResolve(solveStaleList().filter(s => !solveSel.has(s.id)).map(s => s.id));
    });
  }
  const L = solveStaleList(), sig = solveStaleSig(L);
  if (!L.length || sig === solveKept) { if (!bar.hidden) { bar.hidden = true; bar.innerHTML = ''; } if (bar.dataset.sig) bar.dataset.sig = ''; return; }
  if (bar.dataset.sig === sig && !bar.hidden) return;
  bar.dataset.sig = sig; bar.hidden = false;
  bar.innerHTML = `<span class="sb-ico">${typeof uiIco === 'function' ? uiIco('restart') : ''}</span><span class="sb-t"><b>Inputs changed.</b> Out of date:</span>
    <span class="sb-list">${L.map(s => `<label class="sb-chip"><input type="checkbox" data-sbx="${s.id}"${solveSel.has(s.id) ? '' : ' checked'}> ${s.l}</label>`).join('')}</span>
    <span class="sb-acts"><button type="button" class="btn btn-primary btn-sm" id="solveBarGo">Re-solve</button><button type="button" class="btn btn-secondary btn-sm" id="solveBarKeep" title="Do not solve now: the results stay as they are, marked out of date where they are shown, until the next change">Keep as is</button></span>`;
}
const solveStaleSig = L => JSON.stringify(L.map(s => [s.id, s.key]));
/** Re-solve these (the bar's ticked ones): the line's and the stages' by asking, the 2D and 3D by running them. */
function solveResolve(ids) {
  const own = ids.filter(k => SOLVE_M[k]), cfd = ids.filter(k => /^cfd\d$/.test(k)).map(k => +k.slice(3));
  solveSel.clear();
  // (the 2D and 3D only where their mesh is laid out for the inputs as they are: Solve needs the user's mesh)
  if (cfd.length && typeof runLocation === 'function') cfd.forEach(i => { if (typeof mesh2DReady !== 'function' || mesh2DReady(i)) runLocation(i); });
  if (ids.includes('3d') && typeof c3dRun === 'function' && (typeof mesh3DReady !== 'function' || mesh3DReady())) c3dRun(true);
  if (own.length) solveArm(own); else if (typeof render === 'function') render();
}

// ---- a page's solve control: its model's state and a Solve button ----
const SOLVE_ST = { busy: ['Solving…', ''], solved: ['Solved', 'ok'], stale: ['Out of date', 'warn'], failed: ['Could not be solved', 'bad'], todo: ['Not solved', ''] };
/** The control for model(s) ids (the first one's state shown; the button asks for all): label optional. */
function solveCtl(ids, label, noBtn) {
  ids = [].concat(ids);
  const k = ids[0], st = ids.some(i => SOLVE_ASK.has(i) && solveState(i) !== 'busy') ? 'busy' : solveState(k), [t, c] = SOLVE_ST[st];
  const what = label || SOLVE_M[k].l, btn = noBtn || st === 'solved' || st === 'busy' ? '' : `<button type="button" class="btn btn-primary btn-sm" data-solve="${ids.join(',')}">${typeof uiIco === 'function' ? uiIco('play') : ''}${st === 'stale' ? 'Solve again' : 'Solve'}</button>`;
  // (a model with a Mesh step: "Mesh first" until its mesh is made for the inputs as they are -- task 4b)
  //  (while what it needs first is not solved, Solve solves that, and the chain stops at the mesh)
  if (meshNeeded(k) && st !== 'busy' && !meshReady(k) && SOLVE_M[k].up.every(u => solveState(u) === 'solved')) {
    const why = meshError(k) ? 'the mesh cannot be laid out' : meshState(k) === 'stale' ? 'mesh out of date' : 'not meshed';
    return `<span class="solve-ctl" data-st="mesh">${pill(`${what}: ${why} -- press Mesh on its Mesh step, then Solve`, 'warn')}${noBtn ? '' : `<button type="button" class="btn btn-primary btn-sm" disabled title="Solve needs the mesh, laid out for the inputs as they are: press Mesh on the Mesh step">${typeof uiIco === 'function' ? uiIco('mesh') : ''}Mesh first</button>`}</span>`;
  }
  return `<span class="solve-ctl" data-st="${st}">${pill(`${what}: ${t}`, c)}${btn}</span>`;
}
/** What a chart of a model with nothing to draw says (its frame's short box). */
const paneWhy = k => (solvePending(k) ? 'Solving…' : solveState(k) === 'failed' ? 'Could not be solved: see the message above' : 'Not solved yet: press Solve');
/** Whether a page's model is still to be solved (asked or solving: the page says so instead of "not solved"). */
const solvePending = k => SOLVE_ASK.has(k) || solveState(k) === 'busy';
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-solve]');
  if (!b || b.disabled) return;
  e.preventDefault();
  const ids = b.dataset.solve.split(',');
  solveArm(ids.includes('line') ? SOLVE_LINE : ids);
});

/** The report: models not solved or out of date are asked about first -- solve them first (true), report what is solved
 *  (false), or cancel (null). */
function solveBeforeReport(ids = SOLVE_LINE) {
  const need = ids.filter(k => solveState(k) !== 'solved' && solveState(k) !== 'busy');
  if (!need.length) return Promise.resolve(true);
  return new Promise(res => {
    const d = projDialog(`<form method="dialog" class="img-form"><div class="img-head"><h2>Solve before the report?</h2></div>
      <p class="cap">Not solved or out of date: <b>${need.map(k => SOLVE_M[k].l).join(', ')}</b>.</p>
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-a="cancel">Cancel</button><button type="button" class="btn btn-secondary btn-sm" data-a="asis">Report what is solved</button><button type="button" class="btn btn-primary btn-sm" data-a="solve">Solve them first</button></div></form>`);
    d.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => { d.close(); const a = b.dataset.a; if (a === 'solve') solveArm(need); res(a === 'solve' ? true : a === 'asis' ? false : null); }; });
    d.addEventListener('cancel', () => res(null), { once: true });
  });
}
