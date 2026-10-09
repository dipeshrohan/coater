// =====================================================================
// Materials › Readiness: the assumed values that matter most (task 5, the owner's choices of 8 Oct)
// Each assumed value at −20 % and +20 %, its own stage solved again (nothing after it), the change in that stage's main
// answers; the values ranked by the largest change. Runs only when its button is pressed; every value and every result is
// put back as it was when it ends (or is stopped).
// =====================================================================

/** The stages ranked, each with its model (app/solve-ctl.js), the hub's solver key its values carry (phys), its main
 *  answers (get: from its result as the Line page reads it) and the size below which a change is taken against the floor
 *  rather than the answer itself (an answer near zero: a crack risk of 0.02, a flat curl). secs: one solve, measured. */
const SENS_STAGES = [
  // (the wet film is the gap flow's q / U: surface tension, the contact angles and the structure (worked out after the
  //  gap flow, not fed back into it) are read by the other coating models, not by it -- ranked against it they would read 0)
  { k: '1d', phys: 'coat', l: 'Coating', secs: 4.3, skip: ['in.g', 'in.th', 'in.dth', 'in.thw', 'rheo.tb', 'rheo.gdc', 'rheo.cy', 'rheo.ce'], outs: [
    { l: 'Wet film', u: 'mm', d: 3, floor: 0.01, get: sensWetFilm }] },
  { k: 'dry', phys: 'dry', l: 'Drying', secs: 9.2, outs: [
    { l: 'Water left at the oven\'s exit', u: '% of the GO', d: 1, floor: 1, get: () => linePick(dryRuns(lineSel())).exit.waterPct }] },
  { k: 'film', phys: 'film', l: 'Peel and wind', secs: 17.9, outs: [
    { l: 'Crack risk', u: '× its toughness', d: 3, floor: 0.05, get: () => { const r = linePick(filmRuns(lineSel())); return r.worst ? r.worst.ratio : 0; } },
    { l: 'Curl, settled', u: '1/m', d: 2, floor: 0.1, get: () => linePick(filmRuns(lineSel())).curl.settled.kappa }] },
  { k: 'stack', phys: 'stack', l: 'Pre heat', secs: 50.5, outs: [
    { l: 'Size change out of the stack', u: '% of the piece', d: 3, floor: 0.01, get: () => STACK.res.runs.find(r => r.where === lineWay()).stack.sizeOut[0] * 100 }] },
  { k: 'furn', phys: 'furn', l: 'Furnace', secs: 10.8, outs: [
    { l: 'Graphene film thickness', u: 'µm', d: 2, floor: 0.1, get: () => furnBatch(FURN.res).h * 1e6 },
    { l: 'Crack risk', u: '% of its strength', d: 0, floor: 5, get: () => { const q = furnLights(FURN.res).find(x => x.k === 'crack'); return q && Number.isFinite(q.v) ? q.v * 100 : NaN; } }] },
];
/** The wet film's mean across the web (mm), from the 1D across the web alone: the same model at the base and at each
 *  change (the Line page's scales it to a 2D or 3D, which a change puts out of date; the ranking solves the 1D again). */
function sensWetFilm() {
  const A = typeof oneDAcrossNow === 'function' ? oneDAcrossNow() : null;
  if (A && A.length > 1) { let area = 0; for (let k = 1; k < A.length; k++) area += (A[k].film + A[k - 1].film) / 2 * (A[k].z - A[k - 1].z); return area / (A[A.length - 1].z - A[0].z) * 1000; }
  const f = ONE_D.res.locs.map(L => L.film); return f.reduce((a, b) => a + b, 0) / f.length * 1000;
}
/** The models whose results a run changes and puts back, each with every field its solve sets (the 1D's across the web
 *  too; the mixing, which a value the coating reads may solve again). */
const SENS_MODELS = () => [[ONE_D, ['res', 'key', 'across', 'acrossKey', 'error', 'ms']], [MIX, ['res', 'key', 'error', 'ms']], [DRY, ['res', 'key', 'error', 'ms']],
  [FILM, ['res', 'key', 'error', 'ms']], [SHEET, ['res', 'key', 'error', 'ms']], [STACK, ['res', 'key', 'error', 'ms']], [FURN, ['res', 'key', 'error', 'ms', 'fit']]];
/** A row whose value is a material copy's that has since been deleted: no longer ranked, nor shown. */
const sensRowGone = r => !!(r.p.b.inst && !(MAT.inst && MAT.inst[r.p.b.inst]));
const sensKeep = () => SENS_MODELS().map(([M, f]) => ({ M, v: Object.fromEntries(f.map(k => [k, M[k]])) }));
const sensPutBack = keep => { for (const q of keep || []) Object.assign(q.M, q.v); };
/** The ranking: status 'idle' | 'running' | 'done' | 'stopped'; rows (each value's place); the run's queue and where it is. */
const SENS = { status: 'idle', rows: [], jobs: [], i: 0, t0: 0, key: null, keep: null, cur: null, stop: false, all: false, held: false };
const SENS_F = 0.2;

/** The values ranked, by stage: each assumed number its stage's solver reads, as set (a law not chosen, a switch off: not
 *  read). zeros: those at 0 instead -- ±20 % of 0 is 0, so they cannot be ranked this way: listed as not ranked. */
function sensValues(zeros = false) {
  const out = [], seen = new Set();
  for (const s of SENS_STAGES) for (const r0 of [...HUB_RECORDS, ...HUB_IFACES]) {
    // (a copy of the material assigned to this stage's domain: the stage's solver reads its card values, not the record's)
    const cp = HUB_SWAP[s.phys] && typeof hubAssignedFor === 'function' ? hubAssignedFor(r0.id, s.phys) : null, rc = cp ? hubInstRec(cp) : null;
    for (const g of (rc || r0).groups) for (const p0 of g.props) {
    const r = rc && p0.b.t === 'card' ? rc : r0, p = rc && p0.b.t !== 'card' ? { ...p0, b: hubPlainB(p0.b) } : p0;
    // (the slurry's solids while the Mixing recipe sets them: a change would be set back from the recipe before any solve)
    if (!['card', 'inp'].includes(p.b.t) || !p.phys.includes(s.phys) || hubOff(p) || (typeof hubPhiMix === 'function' && hubPhiMix(p))) continue;
    const key = p.b.t === 'card' ? p.b.card + '.' + p.b.k : 'in.' + p.b.k, id = `${s.k}|${p.b.inst || ''}|${key}`;
    if (s.skip && s.skip.includes(key)) continue;
    const v = hubVal(p);
    if (seen.has(id) || v.prov !== 'assumed' || typeof v.v !== 'number' || !Number.isFinite(v.v) || (v.v === 0) !== zeros || v.def) continue;
    seen.add(id); out.push({ s, r, p, id });
    }
  }
  return out;
}
/** A change held at the value's limit (its allowed range): what was used instead of −20 % or +20 %. */
function sensHeld(r) {
  const off = (x, f) => x != null && Math.abs(x - r.v0 * f) > 1e-9 * Math.abs(r.v0);
  const t = [off(r.lo, 1 - SENS_F) ? `−20 % held at ${hubFmt(r.lo, -4)}` : '', off(r.hi, 1 + SENS_F) ? `+20 % held at ${hubFmt(r.hi, -4)}` : ''].filter(Boolean);
  return t.length ? ` · ${t.join(', ')}, its limit` : '';
}
/** Whether the line's ranked stages are solved for the inputs as they are (the base every change is taken from). */
const sensBaseReady = () => SENS_STAGES.every(s => solveState(s.k) === 'solved');
/** What the ranking was made for: the stages' inputs (their solve keys). */
const sensKeyNow = () => JSON.stringify([SENS_STAGES.map(s => solveSafe(SOLVE_M[s.k].key, null)), sensValues().map(q => q.id), lineSel(), lineWay()]);
/** About how long a ranking takes (s): each value twice, its stage (and what before it its value also changes) solved. */
// (each change solves its stage and the stages before it on the line that read the same value: the mixing, 0.7 s measured)
const SENS_PRE = [{ k: 'mix', phys: 'mix', secs: 0.7 }];
const sensSecs = q => { const L = SOLVE_LINE, at = L.indexOf(q.s.k);
  return q.s.secs + [...SENS_PRE, ...SENS_STAGES].filter(t => L.indexOf(t.k) >= 0 && L.indexOf(t.k) < at && q.p.phys.includes(t.phys)).reduce((a, t) => a + t.secs, 0); };
const sensEstimate = (vals = sensValues()) => vals.reduce((t, q) => t + 2 * sensSecs(q), 0);
const sensClock = s => s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;

/** Rank them: the queue of every value at −20 % and +20 %, run one after another in the background. */
function sensStart() {
  if (SENS.status === 'running') return;
  if (!sensBaseReady()) { imgToast('Solve the line first (Solve the line): each value\'s change is taken from it.', 'warn'); return; }
  // (something else solving -- a DOE, a 2D or 3D run, a study, a stage: it would read the values under change)
  const busy = typeof projRunning === 'function' ? projRunning() : [];
  if (busy.length || (typeof SOLVE_ASK !== 'undefined' && SOLVE_ASK.size)) {
    imgToast(`Wait for what is solving to end, or stop it, then rank them${busy.length ? ` (${busy.map(b => `${b.where}: ${b.what}`).join('; ')})` : ''}.`, 'warn'); return;
  }
  undoCommit();
  const vals = sensValues();
  SENS.keep = sensKeep();
  const base = Object.fromEntries(SENS_STAGES.map(s => [s.k, s.outs.map(o => { try { return o.get(); } catch (e) { return NaN; } })]));
  Object.assign(SENS, { status: 'running', stop: false, t0: Date.now(), i: 0, base, key: sensKeyNow(), cur: null, note: typeof RHEO_NOTE === 'string' ? RHEO_NOTE : null, snap: (sensDerived(), sensInputs()), sel: sensSel(),
    rows: vals.map(q => ({ ...q, v0: hubVal(q.p).v, lo: NaN, hi: NaN, yLo: null, yHi: null, err: null })),
    jobs: vals.flatMap((_, n) => [[n, 1 - SENS_F], [n, 1 + SENS_F]]) });
  logCFD(0, `Ranking the assumed values: ${vals.length} values at ±${SENS_F * 100} %, about ${sensClock(sensEstimate(vals))}`);
  sensNext();
  hubSoon();
}
/** The next change: the value set, its stage (and anything before it its value also changes) solved, its answers read. */
function sensNext() {
  if (SENS.stop || SENS.i >= SENS.jobs.length) { sensEnd(SENS.stop ? 'stopped' : 'done'); return; }
  const [n, f] = SENS.jobs[SENS.i], row = SENS.rows[n];
  if (sensRowGone(row)) { row.err = 'its material copy was deleted'; SENS.i++; setTimeout(sensNext, 0); return; }
  const v = hubVal(row.p);
  const x = Math.min(Number.isFinite(v.hi) ? v.hi : Infinity, Math.max(Number.isFinite(v.lo) ? v.lo : -Infinity, row.v0 * f));
  if (f < 1) row.lo = x; else row.hi = x;
  try { hubSet(row.p, x); } catch (e) { row.err = e.message; SENS.i++; setTimeout(sensNext, 0); return; }
  sensDerived();
  // (its stage, and every model before it on the line the change has put out of date too: a value the drying and the
  //  film both read solves both; the solids' density, read by the mixing the coating takes its slurry from, solves both)
  const L = SOLVE_LINE, at = L.indexOf(row.s.k), arm = [...L.slice(0, at).filter(k => solveState(k) === 'stale'), row.s.k];
  SENS.cur = { n, f, arm, x };
  SENS.arming = true; try { solveArm(...arm); } finally { SENS.arming = false; }
  const run = SENS.t0;
  let tries = 0;
  const wait = () => {
    if (SENS.status !== 'running' || SENS.t0 !== run) return;   // (ended at once: New, Open)
    if (SENS.stop && !arm.some(k => solveState(k) === 'busy')) { sensRestore(row); sensEnd('stopped'); return; }
    if (SOLVE_ASK.size || arm.some(k => solveState(k) === 'busy')) { setTimeout(wait, 300); return; }
    // (one that ended out of date: it started before one before it had set what it reads -- the mixing's solids: again)
    if (tries < 3 && arm.some(k => solveState(k) === 'stale')) { tries++; SENS.arming = true; try { solveArm(...arm.filter(k => solveState(k) === 'stale')); } finally { SENS.arming = false; } setTimeout(wait, 300); return; }
    // (the location or the water route the answers are read at changed while it ran: the base was read at the other)
    if (SENS.sel && sensSel() !== SENS.sel) {
      sensRestore(row); sensEnd('stopped');
      if (typeof imgToast === 'function') imgToast('The ranking stopped: where its answers are read (the location, the water route) was changed while it ran.', 'warn');
      return;
    }
    const ok = solveState(row.s.k) === 'solved';
    const y = row.s.outs.map(o => { try { return ok ? o.get() : NaN; } catch (e) { return NaN; } });
    if (f < 1) row.yLo = y; else row.yHi = y;
    if (!ok) row.err = `${row.s.l} could not be solved at ${hubFmt(x, -4)}`;
    sensRestore(row);
    // (the inputs not as the run started from -- changed by a button, a reset, an import while it solved: stopped)
    if (SENS.snap && sensInputs() !== SENS.snap) {
      sensEnd('stopped');
      if (typeof imgToast === 'function') imgToast('The ranking stopped: the inputs were changed while it ran. Rank them again when you are done.', 'warn');
      return;
    }
    SENS.i++;
    if (tab === 13 && HUB.view === 'ready') hubPaint();
    setTimeout(sensNext, 0);
  };
  setTimeout(wait, 300);
}
/** The value back as it was, and every model's result put back (the next change starts from the same base). */
function sensRestore(row) {
  // (the value back as it was -- unless the user typed another while it was being changed: theirs is kept)
  // (and the change's solves still queued dropped: stopped between two, the next would start on the restored inputs)
  for (const k of (SENS.cur && SENS.cur.arm) || []) if (solveState(k) !== 'busy') SOLVE_ASK.delete(k);
  const x = SENS.cur && SENS.cur.x, now = sensRowGone(row) ? null : hubVal(row.p).v;
  if (now != null && (x == null || now === x)) { try { hubSet(row.p, row.v0); } catch (e) { /* (as it was: within its range) */ } }
  sensDerived();
  sensPutBack(SENS.keep);
  // (an old project's note on its law (rheoMigrate): a change of the law's value clears it; the ranking's own change,
  //  put back, leaves it as it was -- unless the inputs were changed meanwhile, the user's change then clearing it)
  if (SENS.note != null && typeof RHEO_NOTE === 'string' && SENS.snap && sensInputs() === SENS.snap) RHEO_NOTE = SENS.note;
}
function sensEnd(status) {
  SENS.status = status; SENS.cur = null; SENS.t1 = Date.now();
  sensPutBack(SENS.keep);
  SENS.keep = null;
  // (a change the user made as it ended -- one that stopped it -- waiting to be a step: a step first, then what the
  //  ranking set and put back taken as known)
  if (typeof UNDO === 'object' && UNDO.timer) undoCommit();
  undoSync();
  logCFD(0, `Ranking ${status === 'done' ? 'done' : 'stopped'}: ${SENS.rows.filter(r => r.yLo && r.yHi).length} of ${SENS.rows.length} values in ${sensClock((SENS.t1 - SENS.t0) / 1000)}`);
  if (typeof render === 'function') render();
}
/** Stop: the change under way ends, then its value and the results go back. now (New, Open): at once, before the
 *  project is left -- the solve under way is stopped with the rest and its answer never read. */
function sensStop(now = false) {
  if (SENS.status === 'running') {
    SENS.stop = true;
    // (the change's stages not yet started: dropped at once -- the queue would start the next before this one ends)
    for (const k of (SENS.cur && SENS.cur.arm) || []) if (solveState(k) !== 'busy') SOLVE_ASK.delete(k);
    if (now || !SENS.cur) { if (SENS.cur) sensRestore(SENS.rows[SENS.cur.n]); sensEnd('stopped'); }
  }
  // (New, Open: the project being left's ranking, done or stopped, goes with it)
  if (now) Object.assign(SENS, { status: 'idle', rows: [], jobs: [], i: 0, base: null, key: null, keep: null, cur: null, stop: false, all: false, snap: null, held: false });
}
/** f with the project as set: the value under change back at its own and every model's result back, then as they were. */
function sensAsSet(f) {
  const c = SENS.status === 'running' ? SENS.cur : null, row = c ? SENS.rows[c.n] : null;
  if (!row || sensRowGone(row) || hubVal(row.p).v !== c.x || !SENS.keep) return f();
  // (a redraw the swap queues -- setting an input does -- dropped: a redraw reads the project's key through here, and
  //  would queue the next, drawing the page anew every frame while the ranking runs; one queued before it is kept)
  const live = sensKeep(), q0 = typeof renderPending !== 'undefined' ? renderPending : 0;
  try { hubSet(row.p, row.v0); sensDerived(); sensPutBack(SENS.keep); return f(); }
  finally {
    sensPutBack(live); hubSet(row.p, c.x); sensDerived();
    if (typeof renderPending !== 'undefined' && renderPending !== q0) { cancelAnimationFrame(renderPending); renderPending = 0; if (q0) queueRender(); }
  }
}
/** A solve asked for while the ranking runs (Solve, Run, a study): refused, said why -- it would take the value under
 *  change, not the project's. The ranking's own: let through. */
function sensBlocks() {
  if (SENS.status !== 'running' || SENS.arming) return false;
  if (typeof imgToast === 'function') imgToast('The ranking of the assumed values is running: stop it first (Materials › Readiness › Stop), then solve.', 'warn');
  return true;
}
/** Where the answers are read (the oven's location, the water's route): a change of either stops a run. */
const sensSel = () => JSON.stringify([lineSel(), lineWay()]);
/** The inputs that follow from others, set again (as a redraw does): the slurry's solids from the Mixing recipe. */
const sensDerived = () => { if (typeof mixSyncSlurry === 'function') mixSyncSlurry(); };
/** The project's inputs, every one undo keeps (a change the ranking did not make: a button, a reset, an import). */
const sensInputs = () => (typeof undoSnap === 'function' ? JSON.stringify(undoSnap()) : null);
// (an input edited while it runs -- typed, picked, slid: the ranking stops, its change put back but the edit kept; the
//  rest of the run would be taken from inputs other than those it started from)
for (const ev of ['input', 'change']) document.addEventListener(ev, e => {
  if (SENS.status !== 'running' || SENS.stop || !e.isTrusted) return;
  const t = e.target;
  if (!t || !t.matches || !t.matches('input, select, textarea') || t.closest('.hub-sens')) return;
  // (stopped only when the edit changes a project input: a search box, a report's title, a view's control leave it
  //  running. The inputs as they were taken first, then compared once the edit's own handlers have run; nothing starts
  //  meanwhile -- solvePump waits while it is held)
  const c = SENS.cur, row = c && SENS.rows[c.n];
  if (!SENS.held) { SENS.held = { before: sensInputs(), back: false, c }; setTimeout(sensHeldEnd, 0); }
  // (as an edit is committed -- its change, or a slider's move, which sets its value at once -- the value under change
  //  back first: the edit's handler then works from the project's values, a viscosity at 2.7 1/s turned into the law's
  //  own parameter with its n and yield stress as set. A box being typed in is left alone: its keystrokes set nothing)
  if ((ev === 'change' || t.type === 'range') && row && !sensRowGone(row) && hubVal(row.p).v === c.x) {
    try { hubSet(row.p, row.v0); SENS.held.back = true; } catch (er) { /* (as it was: within its range) */ }
    sensDerived();
  }
}, true);
/** After an edit's handlers: the value under change set again, and the ranking stopped if a project input changed. */
function sensHeldEnd() {
  const h = SENS.held;
  SENS.held = false;
  if (!h || SENS.status !== 'running' || SENS.stop) return;
  const row = h.c && SENS.rows[h.c.n];
  if (h.back && SENS.cur === h.c && !sensRowGone(row) && hubVal(row.p).v === row.v0) { try { hubSet(row.p, h.c.x); } catch (er) { /* (as it was set: within its range) */ } sensDerived(); }
  if (sensInputs() === h.before) return;
  sensStop();
  if (typeof imgToast === 'function') imgToast('The ranking stopped: an input was edited while it ran. Rank them again when you are done.', 'warn');
}
/** A value's place: its largest change among its stage's answers, against each answer (or its floor, near zero). */
function sensScore(row) {
  let best = null;
  row.s.outs.forEach((o, m) => {
    const y0 = SENS.base[row.s.k][m], ys = [row.yLo, row.yHi].map(y => (y ? y[m] : NaN));
    if (!Number.isFinite(y0) || !ys.every(Number.isFinite)) return;   // (ranked only with both sides solved)
    const ch = Math.max(...ys.map(y => Math.abs(y - y0))) / Math.max(Math.abs(y0), o.floor) * 100;
    if (!best || ch > best.ch) best = { ch, m, o, y0, yLo: row.yLo ? row.yLo[m] : NaN, yHi: row.yHi ? row.yHi[m] : NaN };
  });
  return best;
}

/** Why values were left out of the ranking, in words. */
const sensWhyLeft = (left, errs) => [SENS.status === 'stopped' ? 'stopped before both sides were solved' : '', errs.length ? `${errs.length} could not be solved` : '',
  left.length > errs.length && SENS.status !== 'stopped' ? 'no answer to compare' : ''].filter(Boolean).join('; ');
/** The card under the Readiness table: the button and its estimate, the run's progress, or the ranking. */
function sensHTML() {
  const vals = SENS.status === 'running' ? null : sensValues(), est = vals ? sensEstimate(vals) : 0, zeros = vals ? sensValues(true) : [];
  const head = `<div class="hub-sens-h"><h3>${uiBadge('bars')}The assumed values that matter most</h3>`;
  if (SENS.status === 'running') {
    const k = SENS.i, N = SENS.jobs.length, el = (Date.now() - SENS.t0) / 1000, left = k ? el / k * (N - k) : sensEstimate(SENS.rows) - el, row = SENS.cur ? SENS.rows[SENS.cur.n] : null;
    return `<section class="hub-sens">${head}<button type="button" class="btn btn-secondary btn-sm" id="hubSensStop">${uiIco('stop')}Stop</button></div>
      <div class="hub-sens-prog"><progress max="${N}" value="${k}"></progress><span>${k} of ${N} solves${row ? ` · ${hubEsc(hubPropName(row.r, row.p))} ${SENS.cur.f < 1 ? '−' : '+'}${SENS_F * 100} % (${hubEsc(row.s.l)})` : ''} · about ${sensClock(Math.max(0, left))} left</span></div></section>`;
  }
  const live = SENS.rows.filter(r => !sensRowGone(r));   // (a deleted copy's: left out; the ranking reads out of date)
  const ranked = live.map(r => ({ r, sc: sensScore(r) })).filter(x => x.sc).sort((a, b) => b.sc.ch - a.sc.ch);
  const left = live.filter(r => !sensScore(r)), errs = left.filter(r => r.err);
  const stale = ranked.length && SENS.key !== sensKeyNow();
  const btn = `<button type="button" class="btn btn-primary btn-sm" id="hubSensRun"${sensBaseReady() ? '' : ' disabled title="Solve the line first: each value\'s change is taken from it"'}>${uiIco('play')}${ranked.length ? 'Rank them again' : 'Rank them'}</button>`;
  const note = `<p class="hub-sens-note">${vals.length} assumed values, each at −${SENS_F * 100} % and +${SENS_F * 100} %, its own stage solved again: about ${sensClock(est)}.${sensBaseReady() ? '' : ' Solve the line first.'}${stale ? ' <b>Out of date</b>: the inputs changed since it was ranked.' : ''}${zeros.length ? ` <span class="warn-text" title="${hubEsc(zeros.map(z => `${hubPropName(z.r, z.p)} (${z.s.l})`).join('\n'))}">${zeros.length} at 0, not ranked: ±${SENS_F * 100} % of 0 is 0 (${hubEsc(zeros.slice(0, 3).map(z => hubPropName(z.r, z.p)).join(', '))}${zeros.length > 3 ? '…' : ''}).</span>` : ''}${SENS.rows.length && left.length ? ` <span class="warn-text" title="${hubEsc(errs.map(r => `${hubPropName(r.r, r.p)}: ${r.err}`).join('\n'))}">${left.length} not ranked: ${sensWhyLeft(left, errs)}.</span>` : ''}</p>`;
  if (!ranked.length) return `<section class="hub-sens">${head}${btn}</div>${note}</section>`;
  const show = SENS.all ? ranked : ranked.slice(0, 12), fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const rows = show.map((x, i) => { const { r, sc } = x;
    return `<tr><td class="num">${i + 1}</td><td><button type="button" class="hub-link" data-hubjump="${r.r.id}|${r.p.id}">${hubEsc(hubPropName(r.r, r.p))}</button><small>${hubEsc(hubName(r.r))} · ${hubFmt(r.v0, -4)} ${hubEsc(hubVal(r.p).u || '')}${sensHeld(r)}</small></td>
      <td>${hubEsc(r.s.l)}</td><td>${hubEsc(sc.o.l)}<small>${hubEsc(sc.o.u)}</small></td><td class="num">${fmt(sc.yLo, sc.o.d)}</td><td class="num">${fmt(sc.y0, sc.o.d)}</td><td class="num">${fmt(sc.yHi, sc.o.d)}</td>
      <td class="num"><span class="hub-sens-bar" style="--w:${Math.min(100, sc.ch)}%"></span>${sc.ch < 0.1 ? '< 0.1' : sc.ch.toFixed(sc.ch < 10 ? 1 : 0)} %</td></tr>`; }).join('');
  return `<section class="hub-sens">${head}${btn}</div>${note}
    <div class="table-wrap"><table class="cfd-table hub-sens-t"><thead><tr><th scope="col">#</th><th scope="col">Value</th><th scope="col">Stage</th><th scope="col">Answer it moves most</th><th scope="col">at −${SENS_F * 100} %</th><th scope="col">as set</th><th scope="col">at +${SENS_F * 100} %</th><th scope="col">Change</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${ranked.length > 12 ? `<button type="button" class="btn btn-ghost btn-sm" id="hubSensAll">${SENS.all ? 'Show the first 12' : `Show all ${ranked.length}`}</button>` : ''}</section>`;
}
function sensWire() {
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
  on('hubSensRun', sensStart);
  on('hubSensStop', () => { sensStop(); hubPaint(); });
  on('hubSensAll', () => { SENS.all = !SENS.all; hubPaint(); });
}
// (the progress, while it runs and the Readiness tab shows)
setInterval(() => { if (SENS.status === 'running' && tab === 13 && HUB.view === 'ready' && document.getElementById('hubSensStop')) hubPaint(); }, 2000);
