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
  { k: '1d', phys: 'coat', l: 'Coating', secs: 4.3, outs: [
    { l: 'Wet film', u: 'mm', d: 3, floor: 0.01, get: () => { const f = ONE_D.res.locs.map(L => L.film); return f.reduce((a, b) => a + b, 0) / f.length * 1000; } }] },
  { k: 'dry', phys: 'dry', l: 'Drying', secs: 9.2, outs: [
    { l: 'Water left at the oven\'s exit', u: '% of the GO', d: 1, floor: 1, get: () => linePick(dryRuns(lineSel())).exit.waterPct }] },
  { k: 'film', phys: 'film', l: 'Peel and wind', secs: 17.9, outs: [
    { l: 'Crack risk', u: '× its toughness', d: 3, floor: 0.05, get: () => { const r = linePick(filmRuns(lineSel())); return r.worst ? r.worst.ratio : 0; } },
    { l: 'Curl, settled', u: '1/m', d: 2, floor: 0.1, get: () => linePick(filmRuns(lineSel())).curl.settled.kappa }] },
  { k: 'stack', phys: 'stack', l: 'Pre heat', secs: 50.5, outs: [
    { l: 'Size change out of the stack', u: 'mm', d: 2, floor: 0.05, get: () => STACK.res.runs.find(r => r.where === lineWay()).stack.sizeOut[0] * 1000 }] },
  { k: 'furn', phys: 'furn', l: 'Furnace', secs: 10.8, outs: [
    { l: 'Graphene film thickness', u: 'µm', d: 2, floor: 0.1, get: () => furnBatch(FURN.res).h * 1e6 },
    { l: 'Crack risk', u: '% of its strength', d: 0, floor: 5, get: () => { const q = furnLights(FURN.res).find(x => x.k === 'crack'); return q && Number.isFinite(q.v) ? q.v * 100 : NaN; } }] },
];
/** The models whose results a run changes and puts back. */
const SENS_MODELS = () => [ONE_D, DRY, FILM, SHEET, STACK, FURN];
/** The ranking: status 'idle' | 'running' | 'done' | 'stopped'; rows (each value's place); the run's queue and where it is. */
const SENS = { status: 'idle', rows: [], jobs: [], i: 0, t0: 0, key: null, keep: null, cur: null, stop: false, all: false };
const SENS_F = 0.2;

/** The values ranked, by stage: each assumed number its stage's solver reads, as set (a law not chosen, a switch off: not read). */
function sensValues() {
  const out = [], seen = new Set();
  for (const s of SENS_STAGES) for (const r of [...HUB_RECORDS, ...HUB_IFACES]) for (const g of r.groups) for (const p of g.props) {
    if (!['card', 'inp'].includes(p.b.t) || !p.phys.includes(s.phys) || hubOff(p)) continue;
    const id = `${s.k}|${p.b.t === 'card' ? p.b.card + '.' + p.b.k : 'in.' + p.b.k}`, v = hubVal(p);
    if (seen.has(id) || v.prov !== 'assumed' || typeof v.v !== 'number' || !Number.isFinite(v.v) || v.v === 0 || v.def) continue;
    seen.add(id); out.push({ s, r, p });
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
const sensKeyNow = () => JSON.stringify(SENS_STAGES.map(s => solveSafe(SOLVE_M[s.k].key, null)));
/** About how long a ranking takes (s): each value twice, its stage (and what before it its value also changes) solved. */
const sensEstimate = (vals = sensValues()) => vals.reduce((t, q) => t + 2 * q.s.secs, 0);
const sensClock = s => s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`;

/** Rank them: the queue of every value at −20 % and +20 %, run one after another in the background. */
function sensStart() {
  if (SENS.status === 'running') return;
  if (!sensBaseReady()) { imgToast('Solve the line first (Solve the line): each value\'s change is taken from it.', 'warn'); return; }
  undoCommit();
  const vals = sensValues();
  SENS.keep = SENS_MODELS().map(M => ({ M, res: M.res, key: M.key }));
  const base = Object.fromEntries(SENS_STAGES.map(s => [s.k, s.outs.map(o => { try { return o.get(); } catch (e) { return NaN; } })]));
  Object.assign(SENS, { status: 'running', stop: false, t0: Date.now(), i: 0, base, key: sensKeyNow(), cur: null,
    rows: vals.map(q => ({ ...q, v0: hubVal(q.p).v, lo: NaN, hi: NaN, yLo: null, yHi: null, err: null })),
    jobs: vals.flatMap((_, n) => [[n, 1 - SENS_F], [n, 1 + SENS_F]]) });
  logCFD(0, `Ranking the assumed values: ${vals.length} values at ±${SENS_F * 100} %, about ${sensClock(sensEstimate(vals))}`);
  sensNext();
  hubSoon();
}
/** The next change: the value set, its stage (and anything before it its value also changes) solved, its answers read. */
function sensNext() {
  if (SENS.stop || SENS.i >= SENS.jobs.length) { sensEnd(SENS.stop ? 'stopped' : 'done'); return; }
  const [n, f] = SENS.jobs[SENS.i], row = SENS.rows[n], v = hubVal(row.p);
  const x = Math.min(Number.isFinite(v.hi) ? v.hi : Infinity, Math.max(Number.isFinite(v.lo) ? v.lo : -Infinity, row.v0 * f));
  if (f < 1) row.lo = x; else row.hi = x;
  try { hubSet(row.p, x); } catch (e) { row.err = e.message; SENS.i++; setTimeout(sensNext, 0); return; }
  // (its stage, and every model before it on the line the change has put out of date too: a value the drying and the
  //  film both read solves both; the solids' density, read by the mixing the coating takes its slurry from, solves both)
  const L = SOLVE_LINE, at = L.indexOf(row.s.k), arm = [...L.slice(0, at).filter(k => solveState(k) === 'stale'), row.s.k];
  SENS.cur = { n, f, arm };
  solveArm(...arm);
  const run = SENS.t0;
  let tries = 0;
  const wait = () => {
    if (SENS.status !== 'running' || SENS.t0 !== run) return;   // (ended at once: New, Open)
    if (SENS.stop && !arm.some(k => solveState(k) === 'busy')) { sensRestore(row); sensEnd('stopped'); return; }
    if (SOLVE_ASK.size || arm.some(k => solveState(k) === 'busy')) { setTimeout(wait, 300); return; }
    // (one that ended out of date: it started before one before it had set what it reads -- the mixing's solids: again)
    if (tries < 3 && arm.some(k => solveState(k) === 'stale')) { tries++; solveArm(...arm.filter(k => solveState(k) === 'stale')); setTimeout(wait, 300); return; }
    const ok = solveState(row.s.k) === 'solved';
    const y = row.s.outs.map(o => { try { return ok ? o.get() : NaN; } catch (e) { return NaN; } });
    if (f < 1) row.yLo = y; else row.yHi = y;
    if (!ok) row.err = `${row.s.l} could not be solved at ${hubFmt(x, -4)}`;
    sensRestore(row);
    SENS.i++;
    if (tab === 13 && HUB.view === 'ready') hubPaint();
    setTimeout(sensNext, 0);
  };
  setTimeout(wait, 300);
}
/** The value back as it was, and every model's result put back (the next change starts from the same base). */
function sensRestore(row) {
  try { hubSet(row.p, row.v0); } catch (e) { /* (as it was: within its range) */ }
  for (const q of SENS.keep || []) { q.M.res = q.res; q.M.key = q.key; }
}
function sensEnd(status) {
  SENS.status = status; SENS.cur = null; SENS.t1 = Date.now();
  if (SENS.keep) for (const q of SENS.keep) { q.M.res = q.res; q.M.key = q.key; }
  SENS.keep = null;
  undoSync();
  logCFD(0, `Ranking ${status === 'done' ? 'done' : 'stopped'}: ${SENS.rows.filter(r => r.yLo && r.yHi).length} of ${SENS.rows.length} values in ${sensClock((SENS.t1 - SENS.t0) / 1000)}`);
  if (typeof render === 'function') render();
}
/** Stop: the change under way ends, then its value and the results go back. now (New, Open): at once, before the
 *  project is left -- the solve under way is stopped with the rest and its answer never read. */
function sensStop(now = false) {
  if (SENS.status !== 'running') return;
  SENS.stop = true;
  if (now || !SENS.cur) { if (SENS.cur) sensRestore(SENS.rows[SENS.cur.n]); sensEnd('stopped'); }
}
/** A value's place: its largest change among its stage's answers, against each answer (or its floor, near zero). */
function sensScore(row) {
  let best = null;
  row.s.outs.forEach((o, m) => {
    const y0 = SENS.base[row.s.k][m], ys = [row.yLo, row.yHi].map(y => (y ? y[m] : NaN)).filter(Number.isFinite);
    if (!Number.isFinite(y0) || !ys.length) return;
    const ch = Math.max(...ys.map(y => Math.abs(y - y0))) / Math.max(Math.abs(y0), o.floor) * 100;
    if (!best || ch > best.ch) best = { ch, m, o, y0, yLo: row.yLo ? row.yLo[m] : NaN, yHi: row.yHi ? row.yHi[m] : NaN };
  });
  return best;
}

/** The card under the Readiness table: the button and its estimate, the run's progress, or the ranking. */
function sensHTML() {
  const vals = SENS.status === 'running' ? null : sensValues(), est = vals ? sensEstimate(vals) : 0;
  const head = `<div class="hub-sens-h"><h3>${uiBadge('bars')}The assumed values that matter most</h3>`;
  if (SENS.status === 'running') {
    const k = SENS.i, N = SENS.jobs.length, el = (Date.now() - SENS.t0) / 1000, left = k ? el / k * (N - k) : sensEstimate(SENS.rows) - el, row = SENS.cur ? SENS.rows[SENS.cur.n] : null;
    return `<section class="hub-sens">${head}<button type="button" class="btn btn-secondary btn-sm" id="hubSensStop">${uiIco('stop')}Stop</button></div>
      <div class="hub-sens-prog"><progress max="${N}" value="${k}"></progress><span>${k} of ${N} solves${row ? ` · ${hubEsc(hubPropName(row.r, row.p))} ${SENS.cur.f < 1 ? '−' : '+'}${SENS_F * 100} % (${hubEsc(row.s.l)})` : ''} · about ${sensClock(Math.max(0, left))} left</span></div></section>`;
  }
  const ranked = SENS.rows.map(r => ({ r, sc: sensScore(r) })).filter(x => x.sc).sort((a, b) => b.sc.ch - a.sc.ch);
  const stale = ranked.length && SENS.key !== sensKeyNow();
  const btn = `<button type="button" class="btn btn-primary btn-sm" id="hubSensRun"${sensBaseReady() ? '' : ' disabled title="Solve the line first: each value\'s change is taken from it"'}>${uiIco('play')}${ranked.length ? 'Rank them again' : 'Rank them'}</button>`;
  const note = `<p class="hub-sens-note">${vals.length} assumed values, each at −${SENS_F * 100} % and +${SENS_F * 100} %, its own stage solved again: about ${sensClock(est)}.${sensBaseReady() ? '' : ' Solve the line first.'}${stale ? ' <b>Out of date</b>: the inputs changed since it was ranked.' : ''}</p>`;
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
