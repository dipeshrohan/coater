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
const solveMay = k => SOLVE_ASK.has(k) && !((SOLVE_M[k] || { up: [] }).up.some(u => SOLVE_ASK.has(u) || solveState(u) === 'busy'));

const fnOk = f => typeof f === 'function';
/** The models (id → what it is called, the page it is on, what it needs first, and its state). */
const SOLVE_M = {
  mix: { l: 'Mixing (the batch)', nav: 'mix', up: [], has: () => !!MIX.res, cur: () => mixCurrent(), busy: () => MIX.busy, err: () => !!(MIX.error && MIX.key === mixKeyNow()),
    key: () => mixKeyNow(), go: () => mixRequest() },
  '1d': { l: 'Coating 1D', nav: 'gap', up: [], has: () => !!ONE_D.res, cur: () => fnOk(oneDCurrent) && oneDCurrent() && !!oneDAcrossNow(),
    busy: () => ONE_D.busy, err: () => !!ONE_D.error, key: () => JSON.stringify([CFD_LOCS.map((_, i) => oneDGeo(i)), oneDRipple(), acrossPositions().map(oneDGeoAt)]), go: () => oneDRequest(true) },
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
// (the stages' multiphysics, 1D / 2D / 3D each: drying, the pressed stack, the furnace's holder)
[['dmp', 'Drying', 'dry', ['1d'], () => DMS, d => dmpKeyNow(d), d => dmpCurrent(d), d => dmpRequest(d)],
 ['mps', 'Pre heat', 'stack', ['film', 'sheet'], () => MPS, d => mpKeyNow(d), d => mpCurrent(d), d => mpStackRequest(d)],
 ['fmp', 'Furnace', 'furn', ['film', 'sheet'], () => FMS, d => fmpKeyNow(d), d => fmpCurrent(d), d => fmpRequest(d)]].forEach(([p, l, nav, up, S, key, cur, go]) => {
  for (const d of [1, 2, 3]) SOLVE_M[p + d] = { l: `${l} ${d}D`, nav: nav + d + 'd', up, dim: d, has: () => !!S().res[d], cur: () => cur(d), busy: () => S().busy && S().bdim === d,
    err: () => !!(S().error[d] && S().key[d] === key(d)), key: () => key(d), ready: () => key(d) != null, go: () => go(d) };
});
// (the pool behind the blade in 2D and 3D, Coating › 2D and 3D › Pool and feed: from the 1D's pulse cycle)
for (const d of [2, 3]) SOLVE_M['pool' + d] = { l: `Pool and feed ${d}D`, nav: `feed${d}d`, up: ['1d'], dim: d, has: () => !!POOL[d].res, cur: () => poolCurrent(d), busy: () => POOL[d].busy,
  err: () => !!(POOL[d].error && POOL[d].key === poolKeyNow(d)), key: () => poolKeyNow(d), ready: () => poolBase(d) != null, go: () => poolRequest(d) };
/** The order a pump starts them in (each after what it needs). */
const SOLVE_ORDER = ['mix', '1d', 'dry', 'film', 'sheet', 'stack', 'furn', 'dmp1', 'dmp2', 'dmp3', 'mps1', 'mps2', 'mps3', 'fmp1', 'fmp2', 'fmp3', 'pool2', 'pool3'];
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
  for (const k of SOLVE_ORDER) {
    if (!SOLVE_ASK.has(k)) continue;
    const m = SOLVE_M[k];
    if (solveSafe(m.busy, false)) continue;
    if (solveSafe(m.cur, false)) { SOLVE_ASK.delete(k); continue; }
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
  for (const k of SOLVE_ORDER) if (solveState(k) === 'stale' && !SOLVE_ASK.has(k)) out.push({ id: k, l: SOLVE_M[k].l, key: solveSafe(SOLVE_M[k].key, null) });
  if (typeof cfdRuns !== 'undefined') cfdRuns.forEach((r, i) => { if (r.status !== 'running' && solveSafe(() => cfdIsStale(i), false)) out.push({ id: 'cfd' + i, l: `2D at L${i + 1}`, key: solveSafe(() => cfdInputsKey(cfdGeometry(i)), null) }); });
  if (typeof C3D_RES !== 'undefined' && C3D_RES && C3D_RUN.status !== 'running') {
    const k3 = solveSafe(() => c3dSolveKey3(C3D_RES), null);
    if (k3 && k3 !== C3D_RES.key) out.push({ id: '3d', l: C3D_RES.region === 'strip' ? `3D strip at L${C3D_RES.loc + 1}` : C3D_RES.region === 'edge' ? '3D edge strip' : '3D full width', key: k3 });
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
  if (!L.length || sig === solveKept) { if (!bar.hidden) { bar.hidden = true; bar.innerHTML = ''; } bar.dataset.sig = ''; return; }
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
  if (cfd.length && typeof runLocation === 'function') cfd.forEach(i => runLocation(i));
  if (ids.includes('3d') && typeof c3dRun === 'function') c3dRun(true);
  if (own.length) solveArm(own); else if (typeof render === 'function') render();
}

// ---- a page's solve control: its model's state and a Solve button ----
const SOLVE_ST = { busy: ['Solving…', ''], solved: ['Solved', 'ok'], stale: ['Out of date', 'warn'], failed: ['Could not be solved', 'bad'], todo: ['Not solved', ''] };
/** The control for model(s) ids (the first one's state shown; the button asks for all): label optional. */
function solveCtl(ids, label, noBtn) {
  ids = [].concat(ids);
  const k = ids[0], st = ids.some(i => SOLVE_ASK.has(i) && solveState(i) !== 'busy') ? 'busy' : solveState(k), [t, c] = SOLVE_ST[st];
  const what = label || SOLVE_M[k].l, btn = noBtn || st === 'solved' || st === 'busy' ? '' : `<button type="button" class="btn btn-primary btn-sm" data-solve="${ids.join(',')}">${typeof uiIco === 'function' ? uiIco('play') : ''}${st === 'stale' ? 'Solve again' : 'Solve'}</button>`;
  return `<span class="solve-ctl" data-st="${st}">${pill(`${what}: ${t}`, c)}${btn}</span>`;
}
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
