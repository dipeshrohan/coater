/*
 * cfd-time-ui.js — Coating › 2D in time (T-2 of the time-marching plan).
 *
 *  - Solve: Steady | Transient. In time, each location's run solves the steady flow at the inputs as before, then
 *    marches from it (cfd-worker.js, cfd-fem-time.js): the bead pressure or the web's speed stepped or ramped to a
 *    new value, or the start-up from the gap filled at rest; to an end time, the step set by its error or fixed;
 *    with the flow kept at even times. The settings live with the solver's (CFDS.time): saved in projects and cases,
 *    undone and redone like them.
 *  - Results: a time bar over the plots (Steady | In time; the slider over the kept times, Play) -- the plots, the
 *    metrics, probes, cut lines and profiles show the flow at the time chosen -- and the Time tab: the film at the
 *    end of the 2D domain, the contact line and the flows in and out against time, for each location.
 * The steady result of each location stays what the rest of the app reads (Results, the report, the DOE).
 *
 * Loaded after cfd-ui.js and cfd-steps.js.
 */

const TIME_SCEN = [['pup', 'Bead pressure'], ['web', 'Web speed'], ['rest', 'Start-up from rest']];
const TIME_TOLS = [1e-2, 1e-3, 1e-4];
/** The time settings now (the defaults where none is set). */
const timeSet = () => ({ ...TIME_DEFAULTS, ...(CFDS.time || {}) });
/** Why a run cannot go in time (or ''). */
const timeBlocked = () => (typeof matStruct === 'function' && matStruct() ? 'the structure (thixotropy) model is on, and the flow in time with it is not modelled yet: in time the slurry follows its plain flow curve only' : '');
/** Transient chosen, and possible. */
const timeOn = () => timeSet().on && !timeBlocked();
/** A setting changed: a new object (the defaults stay untouched; undo sees the change). */
function timeChange(k, v) { CFDS.time = { ...timeSet(), [k]: v }; }

// ---- what a location's march is: the target, the end time, the step ----
/** The value it goes to, in the input's unit (kPa, m/min): set, else the location's own value + 25 %. */
function timeTo(i, T = timeSet()) {
  if (T.scen === 'pup') return T.toP != null ? T.toP : +(locInput(i, 'Pup') * 1.25).toFixed(3);
  if (T.scen === 'web') return T.toU != null ? T.toU : +(locInput(i, 'U') * 1.25).toFixed(3);
  return null;
}
/** The film's run through the 2D domain at the web's speed after the change, s: Ld / U. */
function timeTransit(i, T = timeSet()) {
  const geo = cfdGeometry(i), Ld = Math.max(12e-3, (solverOf(i).ldGaps ?? 8) * geo.H);
  const U = T.scen === 'web' ? timeTo(i, T) / 60 * Math.cos(skewRad()) : geo.U;
  return U > 0 ? Ld / U : null;
}
/** The end time, s: set, else Automatic -- the change's ramp and twice the film's run through the 2D domain. */
function timeEnd(i, T = timeSet()) {
  if (T.end > 0) return T.end;
  const tr = timeTransit(i, T);
  return tr ? +((T.ramp || 0) + 2 * tr).toPrecision(2) : 1;
}
/** The time settings as the worker takes them for location i (SI units). */
function timeMsg(i, geo) {
  const T = timeSet(), end = timeEnd(i, T), to = timeTo(i, T);
  return { scen: T.scen, to: T.scen === 'pup' ? to * 1000 : T.scen === 'web' ? to / 60 * Math.cos(skewRad()) : null, ramp: Math.max(0, T.ramp || 0), end,
    auto: T.auto !== false, tol: T.tol || 1e-3, dt: T.dt > 0 ? T.dt : end / 200, frames: Math.max(5, Math.min(200, Math.round(T.frames || 40))), slip: (T.slip || 0) * 1e-6 };
}
const timeKey = (i, geo) => JSON.stringify([cfdInputsKey(geo), timeMsg(i, geo)]);
/** In words: what changes, from what to what, how fast. */
function timeWhat(tr, short = false) {
  if (!tr) return '';
  const rp = tr.ramp > 0 ? `ramped over ${fmtT(tr.ramp)}` : 'a step at t = 0';
  if (tr.scen === 'pup') return `bead pressure ${(tr.P0 / 1000).toFixed(3)} → ${(tr.P1 / 1000).toFixed(3)} kPa${short ? '' : `, ${rp}`}`;
  if (tr.scen === 'web') return `web ${(tr.U0 * 60 / Math.cos(skewRad())).toFixed(2)} → ${(tr.U1 * 60 / Math.cos(skewRad())).toFixed(2)} m/min${short ? '' : `, ${rp}`}`;
  return `start-up from rest: web 0 → ${(tr.U1 * 60 / Math.cos(skewRad())).toFixed(2)} m/min, bead pressure ${(tr.P0 / 1000).toFixed(3)} → ${(tr.P1 / 1000).toFixed(3)} kPa${short ? '' : `, ${rp}`}`;
}
const fmtT = t => (t >= 100 ? `${t.toFixed(0)} s` : t >= 1 ? `${+t.toPrecision(3)} s` : t >= 1e-3 ? `${+(t * 1000).toPrecision(3)} ms` : `${t.toExponential(1)} s`);

// ---- a run's record in time, and the flow at a kept time ----
/** A finished run's march: kept on the run (not on its result, which the rest of the app reads). */
function timeTake(run, r, i, geo) {
  const tr = r.transient;
  delete r.transient;
  if (!tr) { run.transient = null; return; }
  run.transient = { ...tr, key: timeKey(i, geo), cache: [] };
  const n = tr.t.length, film = tr.hOut[n - 1];
  logCFD(i, tr.error && !tr.frames.length ? `in time: ${tr.error}` : `in time (${timeWhat(tr, true)}): ${tr.steps} steps to ${fmtT(tr.t[n - 1])} in ${(tr.ms / 1000).toFixed(1)} s${tr.remeshes.length ? `, ${tr.remeshes.length} new mesh${tr.remeshes.length > 1 ? 'es' : ''}` : ''}; film at the end of the 2D ${(film * 1000).toFixed(3)} mm${tr.error ? ` -- stopped: ${tr.error}` : ''}`,
    tr.error ? 'warn' : 'ok');
}
const timeStale = i => { const T = cfdRuns[i].transient; return !!T && T.key !== timeKey(i, cfdGeometry(i)); };
/** The kept time shown (index), or null: the steady flow. */
const timeShownK = () => (FV.tk == null ? null : FV.tk);
/**
 * Location i's run as the page shows it: at the kept time chosen on the time bar (its field, streamlines, metrics, and
 * its result's numbers at that time), else the run itself.
 */
function shownRun(i) {
  const run = cfdRuns[i], T = run && run.transient, k0 = timeShownK();
  if (k0 == null || !T || !T.frames || !T.frames.length || !run.field) return run;
  const k = Math.min(k0, T.frames.length - 1);
  let c = T.cache[k];
  if (!c) {
    const g = T.frames[k].g, field = makeFlowField(g, { rho: run.geo.rho, ty: run.geo.ty });
    c = T.cache[k] = { field, streamCache: new Map(), metrics: flowMetrics(field), result: { ...run.result, ...g, orient: null } };
  }
  // (the web's speed and the bead pressure at that time: what the film Q/U and the plot's web arrow read)
  const t = T.frames[k].t, f = t > 0 ? (T.ramp > 0 ? Math.min(1, t / T.ramp) : 1) : 0;
  const p = { ...run, frame: k, t, field: c.field, streamCache: c.streamCache, metrics: c.metrics, result: c.result,
    geo: { ...run.geo, U: T.U0 + (T.U1 - T.U0) * f, Pup: T.P0 + (T.P1 - T.P0) * f } };
  // (the field's derived numbers, computed once per kept time)
  Object.defineProperty(p, 'fieldNumbers', { get: () => c.fieldNumbers, set: v => { c.fieldNumbers = v; }, enumerable: false, configurable: true });
  return p;
}
/** The locations in view with a march to show. */
const timeLocs = () => viewLocs().filter(i => cfdRuns[i].field && cfdRuns[i].transient && cfdRuns[i].transient.frames.length);
/** The kept times of the marches in view (the longest one's). */
function timeFrames() {
  let best = null;
  for (const i of timeLocs()) { const f = cfdRuns[i].transient.frames; if (!best || f.length > best.length) best = f; }
  return best || [];
}

// ---- Solve: the setting and its card ----
function timeToolHTML() {
  const T = timeSet(), why = timeBlocked();
  return `<div class="vp-ctl">Time<div class="seg" role="tablist" aria-label="Time" id="tmOn">
    <button type="button" role="tab" data-tmon="0" aria-selected="${!T.on}" title="The steady flow at the inputs (as before)">Steady</button>
    <button type="button" role="tab" data-tmon="1" aria-selected="${!!T.on}"${why ? ` title="${escAttr('Transient: ' + why)}"` : ' title="The steady flow, then the flow in time after a change: set on the right"'}>Transient</button></div></div>`;
}
/** The Time section of the Solve step's side panel. */
function timeCardHTML(i) {
  const T = timeSet(), why = timeBlocked();
  if (!T.on) return `<h4>${uiBadge('clock')}Time</h4><p class="side-note">Steady: the flow at the inputs. Transient: the same, then the flow in time after a change of the bead pressure or the web's speed, or from rest.</p>`;
  if (why) return `<h4>${uiBadge('clock')}Time</h4><p class="side-note warn-text">Transient is set, but ${why}. Runs solve the steady flow.</p>`;
  const opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`, end = timeEnd(i, T), to = timeTo(i, T), tr = timeTransit(i, T);
  const unit = T.scen === 'pup' ? 'kPa' : 'm/min', from = T.scen === 'pup' ? locInput(i, 'Pup').toFixed(3) : locInput(i, 'U').toFixed(2);
  const row = (l, id, inp, u = '') => `<tr><td><label for="${id}">${l}</label></td><td>${inp}<span class="u">${u}</span></td></tr>`;
  const num = (id, v, attrs = '', ph = '') => `<input class="geo-in" type="number" id="${id}" value="${v ?? ''}" step="any"${ph ? ` placeholder="${ph}"` : ''} ${attrs}>`;
  return `<h4>${uiBadge('clock')}Time</h4><table class="kv tm-kv">
    ${row('Change', 'tmScen', `<select id="tmScen" class="geo-in tm-sel">${TIME_SCEN.map(([v, l]) => opt(v, l, T.scen)).join('')}</select>`)}
    ${T.scen !== 'rest' ? row(`To <small>(from ${from})</small>`, 'tmTo', num('tmTo', to, 'min="0"'), unit) : ''}
    ${row('Over', 'tmRamp', num('tmRamp', T.ramp || 0, 'min="0"'), 's')}
    ${row('End time', 'tmEnd', num('tmEnd', T.end > 0 ? T.end : '', 'min="0"', `auto ${end}`), 's')}
    ${row('Time step', 'tmStep', `<select id="tmStep" class="geo-in tm-sel">${opt('auto', 'Automatic', T.auto !== false ? 'auto' : 'fixed')}${opt('fixed', 'Fixed', T.auto !== false ? 'auto' : 'fixed')}</select>`)}
    ${T.auto !== false ? row('Error per step', 'tmTol', `<select id="tmTol" class="geo-in tm-sel">${TIME_TOLS.map(t => opt(String(t), `${+(t * 100).toPrecision(2)} %`, String(T.tol || 1e-3))).join('')}</select>`)
      : row('Step', 'tmDt', num('tmDt', T.dt > 0 ? T.dt : '', 'min="0"', `auto ${+(end / 200).toPrecision(2)}`), 's')}
    ${row('Times kept', 'tmFrames', num('tmFrames', T.frames || 40, 'min="5" max="200" step="1"'))}
    ${row('Exit-face slip length', 'tmSlip', num('tmSlip', T.slip || 0, 'min="0"'), 'µm')}
    </table>
    <p class="side-note">${T.scen === 'rest' ? `From the gap filled at rest (no web speed, the bead at the liquid's own weight), the web and the bead pressure go to the inputs' ${T.ramp > 0 ? `over ${fmtT(T.ramp)}` : 'at once'}`
      : `From the steady flow at ${from} ${unit}, the ${T.scen === 'pup' ? 'bead pressure' : 'web\'s speed'} goes to ${to} ${unit} ${T.ramp > 0 ? `over ${fmtT(T.ramp)}` : 'at once (a step)'}`};
      marched to ${fmtT(end)}${tr ? ` (the web carries the film through the 2D in ${fmtT(tr)})` : ''}, the flow kept at ${T.frames || 40} even times.
      ${(T.slip || 0) > 0 ? `The liquid slides on the exit face below the contact line (slip length ${T.slip} µm).` : 'No slip on the exit face, as the steady solve: a contact line far from its steady place moves slowly.'}</p>`;
}
/** Wire the Time toolbar control and card (after the Solve step is drawn). */
function wireTimeControls() {
  document.querySelectorAll('[data-tmon]').forEach(b => { b.onclick = () => { const on = b.dataset.tmon === '1'; if (timeSet().on !== on) { undoHint(on ? 'Time: transient' : 'Time: steady'); timeChange('on', on); viewCFD(); } }; });
  const sel = (id, k, f = v => v) => { const el = document.getElementById(id); if (el) el.onchange = () => { undoHint(`Time: ${k}`); timeChange(k, f(el.value)); viewCFD(); }; };
  sel('tmScen', 'scen');
  sel('tmStep', 'auto', v => v === 'auto');
  sel('tmTol', 'tol', v => +v);
  const num = (id, k, o) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.onchange = () => {
      if (el.value === '' && o.empty !== undefined) { undoHint(`Time: ${o.label}`); timeChange(k, o.empty); viewCFD(); return; }
      guardNumber(el, { label: o.label, lo: o.lo, hi: o.hi, unit: o.unit }, v => { undoHint(`Time: ${o.label}`); timeChange(k, o.round ? Math.round(v) : v); });
      viewCFD();
    };
  };
  const T = timeSet();
  num('tmTo', T.scen === 'pup' ? 'toP' : 'toU', T.scen === 'pup' ? { label: 'Bead pressure it goes to', lo: -5, hi: 50, unit: 'kPa' } : { label: 'Web speed it goes to', lo: 0, hi: 60, unit: 'm/min' });
  num('tmRamp', 'ramp', { label: 'Ramp time', lo: 0, hi: 3600, unit: 's' });
  num('tmEnd', 'end', { label: 'End time', lo: 1e-4, hi: 36000, unit: 's', empty: null });
  num('tmDt', 'dt', { label: 'Time step', lo: 1e-7, hi: 3600, unit: 's', empty: null });
  num('tmFrames', 'frames', { label: 'Times kept', lo: 5, hi: 200, round: true });
  num('tmSlip', 'slip', { label: 'Exit-face slip length', lo: 0, hi: 1e4, unit: 'µm' });
}

// ---- Results: the time bar ----
let timePlay = null;   // the Play timer
function timeStop() { if (timePlay) { clearInterval(timePlay); timePlay = null; } }
function renderTimeBar() {
  const host = document.getElementById('cfdTimeBar');
  if (!host) return;
  const locs = step2D() === 'results' ? timeLocs() : [];
  if (!locs.length) { host.innerHTML = ''; host.hidden = true; if (FV.tk != null && !cfdRuns.some(r => r.transient)) FV.tk = null; timeStop(); return; }
  host.hidden = false;
  const fr = timeFrames(), n = fr.length, k = FV.tk == null ? null : Math.min(FV.tk, n - 1), tr = cfdRuns[locs[0]].transient, stale = locs.some(timeStale);
  const err = locs.map(i => cfdRuns[i].transient.error ? `L${i + 1}: ${cfdRuns[i].transient.error}` : '').filter(Boolean);
  host.innerHTML = `<div class="time-bar" role="group" aria-label="Time">
    <div class="seg" role="tablist" aria-label="Flow shown"><button type="button" role="tab" data-tview="steady" aria-selected="${k == null}" title="Each location's steady flow at the inputs">Steady</button><button type="button" role="tab" data-tview="time" aria-selected="${k != null}" title="The flow in time, at the time set on the slider">In time</button></div>
    <button type="button" class="tool-btn" id="tPlay"${k == null ? ' disabled' : ''} aria-label="${timePlay ? 'Pause' : 'Play'}">${uiIco(timePlay ? 'pause' : 'play')}${timePlay ? 'Pause' : 'Play'}</button>
    <input type="range" id="tSlider" min="0" max="${n - 1}" step="1" value="${k ?? 0}"${k == null ? ' disabled' : ''} aria-label="Time shown" aria-valuetext="t = ${k == null ? '' : fmtT(fr[k].t)}">
    <span class="t-now">${k == null ? '<b>steady</b>' : `<b>t = ${fmtT(fr[k].t)}</b> of ${fmtT(fr[n - 1].t)}`}</span>
    <span class="t-what" title="${escAttr(timeWhat(tr))}">${timeWhat(tr)}${stale ? ' · <span class="warn-text">out of date</span>' : ''}${err.length ? ` · <span class="warn-text" title="${escAttr(err.join(' '))}">stopped early</span>` : ''}</span>
  </div>`;
  host.querySelectorAll('[data-tview]').forEach(b => { b.onclick = () => { timeStop(); FV.tk = b.dataset.tview === 'time' ? (FV.tkLast ?? n - 1) : null; timeRedraw(); }; });
  const sl = document.getElementById('tSlider');
  syncSliderFill(sl);
  sl.oninput = () => { FV.tk = FV.tkLast = +sl.value; timeRedraw(true); };
  const pb = document.getElementById('tPlay');
  pb.onclick = () => {
    if (timePlay) { timeStop(); renderTimeBar(); return; }
    if (FV.tk >= n - 1) FV.tk = 0;
    timePlay = setInterval(() => {
      if (tab !== 4 || step2D() !== 'results' || FV.tk == null) { timeStop(); renderTimeBar(); return; }
      FV.tk = FV.tkLast = Math.min(n - 1, FV.tk + 1);
      timeRedraw(true);
      if (FV.tk >= n - 1) { timeStop(); renderTimeBar(); }
    }, 220);
    renderTimeBar();
  };
}
/** The time shown changed: the bar, the plots and the dock's panels again (fast: the plots and the bar's text only). */
function timeRedraw(fast = false) {
  if (fast) {
    const fr = timeFrames(), n = fr.length, k = FV.tk == null ? null : Math.min(FV.tk, n - 1);
    const now = document.querySelector('#cfdTimeBar .t-now'), sl = document.getElementById('tSlider');
    if (now && k != null) now.innerHTML = `<b>t = ${fmtT(fr[k].t)}</b> of ${fmtT(fr[n - 1].t)}`;
    if (sl && k != null) { sl.value = k; sl.setAttribute('aria-valuetext', `t = ${fmtT(fr[k].t)}`); syncSliderFill(sl); }
    renderLegend(); renderFlowPlots();
    if (FV.dock === 'time') renderTimeCharts();
    else if (FV.dock === 'metrics') renderMetrics();
    else if (FV.dock === 'probes') renderProbes();
    else if (FV.dock === 'cuts') renderCuts();
    else if (FV.dock === 'profiles') renderProfiles();
    return;
  }
  viewCFD();
}

// ---- Results: the Time tab ----
function renderTimeCharts() {
  const host = document.getElementById('cfdTime');
  if (!host) return;
  const locs = CFD_LOCS.map((_, i) => i).filter(i => cfdRuns[i].transient && cfdRuns[i].transient.t.length > 1);
  if (!locs.length) {
    const why = timeBlocked();
    host.innerHTML = `<p class="cap">${timeSet().on && !why ? 'Transient is set: run the locations (Solve) to march them in time.' : why ? `Transient: ${why}.` : 'No run in time yet: on the Solve step set Time to Transient, choose what changes, and run.'}</p>`;
    return;
  }
  const T0 = cfdRuns[locs[0]].transient, stale = timeStale;
  const name = i => `Location ${i + 1}${stale(i) ? ' (out of date)' : ''}`;
  const legend = `<div class="xl-legend">${locs.map(i => `<span class="lg"><i class="xl-sw" style="background:${locColor(i)}"></i>${name(i)}</span>`).join('')}</div>`;
  const chart = id => `<div class="xl-chart"><canvas id="${id}" role="img"></canvas><div class="xl-guide" hidden></div><div class="fv-tip" hidden></div></div>`;
  const last = i => { const T = cfdRuns[i].transient, n = T.t.length; return { t: T.t[n - 1], h: T.hOut[n - 1], s: T.s[n - 1], m: T.mode[n - 1] }; };
  const rows = locs.map(i => {
    const T = cfdRuns[i].transient, L = last(i), r = cfdRuns[i].result, U = T.U1 || r.U || 1;
    // (the time the film at the outlet takes to come within 1 % of its last change: settled)
    const h0 = T.hOut[0], dh = L.h - h0;
    let tSet = null;
    if (Math.abs(dh) > 1e-9) for (let k = T.t.length - 1; k >= 0; k--) if (Math.abs(T.hOut[k] - L.h) > 0.01 * Math.abs(dh)) { tSet = k + 1 < T.t.length ? T.t[k + 1] : null; break; }
    return `<tr><th scope="row"><i class="xl-sw" style="background:${locColor(i)}"></i> L${i + 1}</th><td>${(h0 * 1000).toFixed(3)}</td><td>${(L.h * 1000).toFixed(3)}</td><td>${tSet != null ? fmtT(tSet) : '—'}</td>
      <td>${(T.s[0] * 1000).toFixed(3)} → ${(L.s * 1000).toFixed(3)}${L.m === 'pinned' ? ' <small>pinned</small>' : ''}</td><td>${T.steps}<small>${T.rejected ? ` ${T.rejected} redone` : ''}${T.remeshes.length ? ` · ${T.remeshes.length} new mesh` : ''}</small></td><td>${(T.ms / 1000).toFixed(1)} s</td>
      <td>${T.error ? `<span class="warn-text" title="${escAttr(T.error)}">stopped at ${fmtT(L.t)}</span>` : T.completed ? 'done' : 'stopped'}</td></tr>`;
  }).join('');
  host.innerHTML = `${legend}
    <p class="cap t-what-cap"><b>${timeWhat(T0)}</b>${locs.some(stale) ? ' · <span class="warn-text">out of date: the inputs or the time settings changed since</span>' : ''}</p>
    <div class="dock-grid">
    <figure class="dock-fig">${chart('tmFilm')}<p class="cap"><b>Wet film at the end of the 2D domain</b> against time (it then moves on with the web): the change reaches it when the web has carried the new film there.</p></figure>
    <figure class="dock-fig">${chart('tmCL')}<p class="cap"><b>Contact line</b>: how far up the exit face it is (0: pinned at the metering edge).</p></figure>
    <figure class="dock-fig">${chart('tmQ')}<p class="cap"><b>Flow into the gap</b> (solid) <b>and out of the 2D domain</b> (dashed), per metre of width. Their difference fills or drains the bead and the meniscus.</p></figure>
    <figure class="dock-fig"><div class="table-wrap"><table class="cfd-table tm-table"><thead><tr><th></th><th>Film at the start<small>mm</small></th><th>Film at the end<small>mm</small></th><th>Settled within 1 %<small>at</small></th><th>Contact line<small>mm up the face</small></th><th>Time steps</th><th>Solve time</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="cap">The march: BDF2 in time on the same finite elements as the steady solve, the free surface and the contact line moving with the flow${T0.auto ? `, each step's error kept under ${+((T0.tol || 1e-3) * 100).toPrecision(2)} % of the gap and of the fastest speed` : `, a fixed step of ${fmtT(T0.dtSet)}`}${T0.slip > 0 ? `; the liquid slides on the exit face below the contact line, slip length ${(T0.slip * 1e6).toPrecision(3)} µm` : '; no slip on the exit face'}.</p></figure>
    </div>`;
  const fr = timeFrames(), tNow = FV.tk == null || !fr.length ? null : fr[Math.min(FV.tk, fr.length - 1)].t;
  const vl = tNow != null ? [{ x: tNow, c: cssVar('--accent'), t: `t ${fmtT(tNow)}` }] : [];
  const ser = (i, pts, dash) => ({ name: name(i), short: `L${i + 1}`, color: locColor(i), stale: dash || stale(i), pts });
  const draw = (id, series, o) => {
    const cv = document.getElementById(id);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of series) for (const [x, y] of s.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pad = 0.08 * (y1 - y0 || Math.abs(y1) || 1);
    cv.setAttribute('aria-label', o.aria);
    const map = plotChart(cv, 0.36, { x0, x1, y0: o.y0 ?? y0 - pad, y1: y1 + pad, xl: 'time (s)', yl: o.yl, xd: x1 - x0 < 1 ? 3 : x1 - x0 < 10 ? 2 : 1, yd: o.yd ?? 3,
      s: series.map(s => ({ p: s.pts, c: s.color, w: 2, dash: s.stale ? [5, 4] : null })), vl });
    endLabels(cv, map, series.filter(s => !s.dashOnly));
    chartHover(cv.parentElement, cv, map, series, { by: 'x', head: t => `t ${fmtT(t)}`, fmt: o.fmt });
  };
  draw('tmFilm', locs.map(i => { const T = cfdRuns[i].transient; return ser(i, T.t.map((t, k) => [t, T.hOut[k] * 1000])); }),
    { aria: 'Wet film at the end of the 2D domain against time', yl: 'wet film (mm)', fmt: v => v.toFixed(4) + ' mm' });
  draw('tmCL', locs.map(i => { const T = cfdRuns[i].transient; return ser(i, T.t.map((t, k) => [t, T.s[k] * 1000])); }),
    { aria: 'Contact line up the exit face against time', yl: 'contact line up the face (mm)', fmt: v => v.toFixed(4) + ' mm' });
  draw('tmQ', locs.flatMap(i => { const T = cfdRuns[i].transient; return [ser(i, T.t.map((t, k) => [t, T.Qin[k] * 1e6])), { ...ser(i, T.t.map((t, k) => [t, T.Qout[k] * 1e6]), true), name: `${name(i)}, out`, short: `L${i + 1} out` }]; }),
    { aria: 'Flow in and out against time', yl: 'flow per width (mm²/s)', fmt: v => fmtNum(v) + ' mm²/s' });
}
/** The run report's lines on the flow in time (report.js): one per location that has one. */
function timeReportRows() {
  return CFD_LOCS.map((_, i) => i).filter(i => cfdRuns[i].transient && cfdRuns[i].transient.t.length > 1).map(i => {
    const T = cfdRuns[i].transient, n = T.t.length;
    return [`L${i + 1}`, timeWhat(T, true), fmtT(T.t[n - 1]), `${(T.hOut[0] * 1000).toFixed(3)} → ${(T.hOut[n - 1] * 1000).toFixed(3)} mm`, `${(T.s[0] * 1000).toFixed(3)} → ${(T.s[n - 1] * 1000).toFixed(3)} mm`,
      T.error ? `stopped: ${T.error}` : `${T.steps} steps, ${(T.ms / 1000).toFixed(1)} s${timeStale(i) ? ' (out of date)' : ''}`];
  });
}
