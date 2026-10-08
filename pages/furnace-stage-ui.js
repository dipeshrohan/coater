'use strict';
/*
 * furnace-stage-ui.js — the furnace as a stage of the Process tab (GO-6, Q115–Q122): its Setup (the runs' programs as a
 * table and a drawing side by side, one run at a time, the points dragged; the stack in its holder; the piece going in),
 * its Solve (where it stands, the solver's settings, this run's checks) and its Results (the answer in a line with the
 * warnings folded; one big chart picked by chips beside the piece as a colour map or in 3D). The inputs bar keeps the
 * same inputs (they are the same values).
 */

// ---- Setup: the runs ----
/** The program's corners for run r as set by its steps: the room, each step's ramp end and hold end, the cool end (h, °C). */
function furnProgPoints(r) {
  const fu = OVEN.furn, R = fu.runs[r], T0 = MAT.dry.Troom.v, pts = [{ t: 0, T: T0, k: 'start' }];
  let t = 0, T = T0;
  R.steps.forEach((s, i) => {
    t += Math.abs(s.to - T) / s.rate / 60; T = s.to; pts.push({ t, T, k: 'ramp', i });
    if (s.hold > 0) { t += s.hold / 60; pts.push({ t, T, k: 'hold', i }); }
  });
  if (R.cool > 0 && T > T0) { t += (T - T0) / R.cool / 60; pts.push({ t, T: T0, k: 'cool' }); }
  return pts;
}
function furnProgTableHTML(r) {
  const R = OVEN.furn.runs[r];
  if (R.file) return `<p class="fv-why">Your file ${dryEsc(R.file.name)}: ${R.file.pts.length} points, its time in ${{ h: 'hours', min: 'minutes', s: 'seconds' }[R.file.unit] || R.file.unit}.</p>
    <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" data-furnclear="${r}">Use steps instead</button><button type="button" class="btn btn-secondary btn-sm" data-furnfile="${r}">${uiIco('upload')}Another file</button></div>`;
  const inp = (i, k, step, what, unit) => `<input type="number" min="${FURN_STEP_LIMITS[k][0]}" max="${FURN_STEP_LIMITS[k][1]}" step="${step}" value="${R.steps[i][k]}" data-pstepin="${r}:${i}:${k}" aria-label="${FURN_RUNS[r]}, step ${i + 1}: ${what}, ${unit}">`;
  const rows = R.steps.map((s, i) => `<tr><td class="furn-sn">${i + 1}</td><td>${inp(i, 'rate', 0.1, 'heating rate', '°C/min')}</td><td>${inp(i, 'to', 10, 'to', '°C')}</td><td>${inp(i, 'hold', 5, 'hold', 'min')}</td>
    <td>${R.steps.length > 1 ? `<button type="button" class="icon-btn" data-pdelstep="${r}:${i}" title="Remove step ${i + 1}" aria-label="Remove step ${i + 1} of ${FURN_RUNS[r]}">${uiIco('trash')}</button>` : ''}</td></tr>`).join('');
  return `<table class="furn-ptab"><thead><tr><th></th><th>heat at <small>°C/min</small></th><th>to <small>°C</small></th><th>hold <small>min</small></th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="furn-cool"><label>then cools at <input type="number" min="${FURN_STEP_LIMITS.cool[0]}" max="${FURN_STEP_LIMITS.cool[1]}" step="0.5" value="${R.cool}" data-pcool="${r}" aria-label="${FURN_RUNS[r]}: cooling rate, °C/min"><span class="prop-u">°C/min</span></label></div>
    <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" data-paddstep="${r}">${uiIco('plus')}Add a step</button><button type="button" class="btn btn-secondary btn-sm" data-furnfile="${r}">${uiIco('upload')}Upload a cycle</button></div>`;
}
/** The drawing's frame (plotChart's margins): data to the canvas and back. */
function furnProgFrame(cv, r) {
  const pts = furnProgram(r, MAT.dry.Troom.v), w = cv.clientWidth || 600, h = w * FILM_ASPECT;
  const x1 = Math.max(...pts.map(q => q[0] / 3600)) * 1.08 || 1, y1 = Math.max(...pts.map(q => q[1] - 273.15), 100) * 1.1;
  const m = { l: 52, r: 16, t: 26, b: 36 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  return { x1, y1, X: x => m.l + x / x1 * pw, Y: y => m.t + ph - y / y1 * ph, iX: px => (px - m.l) / pw * x1, iY: py => (m.t + ph - py) / ph * y1 };
}
function furnProgDraw(r, drag) {
  const cv = document.getElementById('furnProgCv');
  if (!cv) return;
  const R = OVEN.furn.runs[r], red = '#c92a2a', pts = furnProgram(r, MAT.dry.Troom.v), F = furnProgFrame(cv, r);
  const handles = R.file ? [] : furnProgPoints(r).filter(q => q.k !== 'start');
  plotChart(cv, FILM_ASPECT, { x0: 0, x1: F.x1, y0: 0, y1: F.y1, xl: 'time into the run (h)', yl: 'temperature (°C)', xd: 1, yd: 0,
    s: [{ p: pts.map(q => [q[0] / 3600, q[1] - 273.15]), c: red, w: 2 }] });
  const c = cv.getContext('2d');
  for (const q of handles) {
    const x = F.X(q.t), y = F.Y(q.T), on = drag && drag.q.k === q.k && drag.q.i === q.i;
    c.beginPath(); c.arc(x, y, on ? 6.5 : 5, 0, 2 * Math.PI); c.fillStyle = cssVar('--surface'); c.fill(); c.lineWidth = 2; c.strokeStyle = red; c.stroke();
  }
  if (drag) {
    const q = drag.q, x = F.X(q.t), y = F.Y(q.T), t = drag.label;
    c.font = '600 12px ' + cssVar('--sans'); const tw = c.measureText(t).width + 12;
    const bx = Math.min(Math.max(4, x - tw / 2), cv.clientWidth - tw - 4), by = Math.max(4, y - 30);
    c.fillStyle = cssVar('--ink'); c.fillRect(bx, by, tw, 20); c.fillStyle = cssVar('--surface'); c.fillText(t, bx + 6, by + 14);
  }
  const lg = document.getElementById('furnProgCvLg');
  if (lg) lg.innerHTML = R.file ? `<p class="fv-why">From your file: change it there, or use steps instead.</p>` : '<p class="fv-why">Drag a corner: where a ramp ends (its temperature and how fast), where a hold ends (how long), where it has cooled (how fast). The table follows.</p>';
}
/** A corner dragged to (t h, T °C): the run's steps it gives (the step's temperature and rate, its hold, the cooling). */
function furnProgDragged(r, q, t, T) {
  const R = JSON.parse(JSON.stringify(OVEN.furn.runs[r])), T0 = MAT.dry.Troom.v, L = FURN_STEP_LIMITS, clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  const all = furnProgPoints(r), idx = all.findIndex(p => p.k === q.k && p.i === q.i), prev = all[idx - 1];
  if (q.k === 'ramp') {
    const Tprev = q.i ? R.steps[q.i - 1].to : T0, s = R.steps[q.i];
    s.to = Math.round(clamp(T, L.to) / 10) * 10;
    const dt = Math.max(1, (t - prev.t) * 60);
    if (s.to !== Tprev) s.rate = +clamp(Math.abs(s.to - Tprev) / dt, L.rate).toPrecision(2);
  } else if (q.k === 'hold') {
    R.steps[q.i].hold = Math.max(0, Math.round((t - prev.t) * 60 / 5) * 5);
  } else if (q.k === 'cool') {
    const Tl = R.steps[R.steps.length - 1].to, dt = Math.max(1, (t - prev.t) * 60);
    R.cool = +clamp((Tl - T0) / dt, L.cool).toPrecision(2);
  }
  return R;
}
function furnProgWire(cv) {
  if (cv.dataset.wired) return;
  cv.dataset.wired = '1';
  let drag = null;
  const at = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const near = (px, py) => {
    const r = FURN.prun || 0; if (OVEN.furn.runs[r].file) return null;
    const F = furnProgFrame(cv, r);
    let best = null, bd = 12;
    for (const q of furnProgPoints(r)) { if (q.k === 'start') continue; const d = Math.hypot(F.X(q.t) - px, F.Y(q.T) - py); if (d < bd) { bd = d; best = q; } }
    return best;
  };
  cv.addEventListener('pointerdown', e => {
    const [px, py] = at(e), q = near(px, py);
    if (!q) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    drag = { q, r: FURN.prun || 0, R: null };
  });
  cv.addEventListener('pointermove', e => {
    const [px, py] = at(e);
    if (!drag) { cv.style.cursor = near(px, py) ? 'grab' : ''; return; }
    const F = furnProgFrame(cv, drag.r), t = Math.max(0, F.iX(px)), T = F.iY(py);
    drag.R = furnProgDragged(drag.r, drag.q, t, T);
    // (drawn as it would be: the run set from the dragged steps, for now)
    const keep = OVEN.furn.runs[drag.r];
    OVEN.furn.runs[drag.r] = drag.R;
    const q2 = furnProgPoints(drag.r).find(p => p.k === drag.q.k && p.i === drag.q.i) || drag.q, s = drag.q.i != null ? drag.R.steps[drag.q.i] : null;
    const label = drag.q.k === 'ramp' ? `${s.rate} °C/min to ${s.to} °C` : drag.q.k === 'hold' ? `hold ${s.hold} min` : `cools at ${drag.R.cool} °C/min`;
    furnProgDraw(drag.r, { q: q2, label });
    OVEN.furn.runs[drag.r] = keep;
    cv.style.cursor = 'grabbing';
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null; cv.style.cursor = '';
    if (!d.R) return;
    const R0 = OVEN.furn.runs[d.r], i = d.q.i, run = FURN_RUNS[d.r], ch = [];
    if (d.q.k === 'ramp') {
      const a = R0.steps[i], b = d.R.steps[i];
      if (a.to !== b.to) ch.push(`temperature ${a.to} → ${b.to} °C`);
      if (a.rate !== b.rate) ch.push(`heating rate ${a.rate} → ${b.rate} °C/min`);
    } else if (d.q.k === 'hold') { if (R0.steps[i].hold !== d.R.steps[i].hold) ch.push(`hold ${R0.steps[i].hold} → ${d.R.steps[i].hold} min`); }
    else if (R0.cool !== d.R.cool) ch.push(`cooling ${R0.cool} → ${d.R.cool} °C/min`);
    if (!ch.length) { furnProgDraw(d.r); return; }   // (let go where it was: nothing changed)
    undoHint(`${run}${i != null ? `, step ${i + 1}` : ''}: ${ch.join(', ')} (dragged)`);
    const runs = OVEN.furn.runs.map((q, j) => j === d.r ? d.R : q);
    OVEN.furn = { ...OVEN.furn, runs, runsSet: true };
    render();
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}

// ---- Setup: the stack in its holder, your limits; the piece going in ----
function furnHolderHTML() {
  const fu = OVEN.furn;
  const field = (k, id) => { const f = FURN_FIELDS.find(q => q[0] === k), unk = k === 'dTload'; return `<label class="furn-f"><span>${f[1]}</span><span class="prop-v"><input type="number" id="${id}" min="${f[3]}" max="${f[4]}" step="${f[5]}" value="${fu[k] ?? ''}"${unk ? ' placeholder="not known"' : ''} data-furnf="${k}"><span class="prop-u">${f[2]}</span></span></label>`; };
  return `<div class="furn-holder"><div class="furn-holder-pic">${furnPicHolder(1)}</div><div class="furn-fields">
    ${field('N', 'furnSN')}${field('paperT', 'furnSPaperT')}${field('margin', 'furnSMargin')}${field('plateW', 'furnSPlate')}${field('pGas', 'furnSPGas')}
    <div class="furn-f"><span>Above the stack</span><div class="seg seg-sm" role="tablist" aria-label="Above the stack in the holder" id="furnSRoom">${Object.entries(FURN_ROOM).map(([k, t]) => `<button type="button" role="tab" data-furnroom="${k}" aria-selected="${k === fu.room}">${t}</button>`).join('')}</div></div>
    ${fu.room === 'gap' ? field('gap', 'furnSGap') : ''}
    <div class="furn-f"><span>The top and bottom pieces touch</span><div class="seg seg-sm" role="tablist" aria-label="What the top and bottom pieces touch" id="furnSEnds">${Object.entries(FURN_ENDS).map(([k, t]) => `<button type="button" role="tab" data-furnends="${k}" aria-selected="${k === fu.ends}">${t}</button>`).join('')}</div></div>
    ${fu.ends === 'plates' ? field('plateT', 'furnSPlateT') : ''}
    ${field('dTload', 'furnSDTload')}
    <h5>Your limits</h5>${field('sdMax', 'furnSSd')}</div></div>`;
}
function furnPieceInHTML() {
  const q = furnInputs();
  if (!q) return '<p class="fv-why">After the film and its cut piece are solved (Film).</p>';
  const P = q.P, row = (l, v) => `<tr><th>${l}</th><td>${v}</td></tr>`;
  return `<table class="proc-kv"><tbody>${row('Its film', dryFilmName(q.key).replace(/^the /, ''))}${row('Its water left from', SHEET_WAYS[q.way] || 'the top only')}
    ${row('Its thickness', `${furnUm(P.h)} µm`)}${row('Its water', `${(P.Xroom * 100).toFixed(1)} % of the GO (the room's)`)}${row('Its size', `${(q.o.Lx * 1000).toFixed(0)} × ${(q.o.Ly * 1000).toFixed(0)} mm`)}</tbody></table>
    <p class="fv-why">As the film's piece (the Film stage): its layers as set at the peel, dried in the pressed stack.</p>`;
}
function furnSetupRender() {
  const host = document.getElementById('furnSetupRuns');
  if (!host) return;
  const r = FURN.prun || 0;
  document.querySelectorAll('#furnSec [data-prun]').forEach(b => b.setAttribute('aria-selected', String(+b.dataset.prun === r)));
  const p = furnProgram(r), top = Math.max(...p.map(q => q[1] - 273.15));
  document.getElementById('furnSetupRunT').textContent = `${FURN_RUN_WHAT[r]}: ${(p[p.length - 1][0] / 3600).toFixed(1)} h, to ${top.toFixed(0)} °C`;
  host.innerHTML = furnProgTableHTML(r);
  const cv = document.getElementById('furnProgCv');
  furnProgDraw(r); furnProgWire(cv);
  document.getElementById('furnSetupHolder').innerHTML = furnHolderHTML();
  document.getElementById('furnSetupPiece').innerHTML = furnPieceInHTML();
  if (typeof applyHelp === 'function') applyHelp();   // (rebuilt outside render when the run shown changes: its help again)
}

// ---- Solve: where it stands, the settings, this run's checks ----
function furnSolveRender(r) {
  const el = document.getElementById('furnSolve');
  if (!el) return;
  const st = !furnInputs() ? ['muted', solvePending('furn') ? 'Solving the film and its piece first…' : 'Needs the film and its piece first: Solve solves them, then the two runs.'] : FURN.busy ? ['accent', 'Solving the two runs…'] : FURN.error ? ['bad', `Could not be solved: ${dryEsc(FURN.error)}`] : r ? ['ok', `Solved in ${(FURN.ms / 1000).toFixed(1)} s. It solves again by itself when an input changes.`] : ['muted', 'Not solved yet.'];
  const rows = [['Temperature steps', 'at most 1 K and 600 s each; the chemistry exact over each (its temperature integral)'], ['The gas along the paper', 'a quarter of the piece, 12 × 12 cells and 2 in the paper\'s margin (finite volumes); where the paper lifts, an obstacle problem; the film\'s openings exchanging their gas with it solved together (stable however fast), the holder\'s squeeze from each step\'s end'],
    ['The piece along itself', 'a disc of its area in 48 rings (axisymmetric plane stress), Newton on the papers\' hold, held by both (below and above it); a step that does not lower its energy halved, so every step balances'],
    ['The top and bottom pieces', OVEN.furn.ends === 'papers' ? 'between two papers, as every piece' : 'against the holder\'s plates: their gas through the plate on that face (across its thickness) or lifting the piece off it, and through their paper on the other; the plate\'s friction and bond; the pieces next to them followed too'],
    ['The stack', 'its top, middle and bottom pieces followed together, each under its own load (the plate, the papers and the pieces above it), the stack\'s growth theirs together; the batch from them by Simpson\'s rule over the stack (1 : 4 : 1)'],
    ['The load', OVEN.furn.dTload > 0 ? `its coldest and hottest stacks solved too (${OVEN.furn.dTload} °C apart at the top, each run\'s rise above the room in proportion), the stacks spread evenly between them` : 'every stack as set: its temperature spread is not known']];
  const chk = r ? furnPieces(r).flatMap(p => p.runs.map((q, i) => { const g = q.gas, err = Math.abs(g.made - (g.out + g.held - g.held0)) / Math.max(1e-30, g.made); return `<li class="${err < 1e-6 ? 'ok' : 'bad'}">${furnPieces(r).length > 1 ? FURN_POS_NAME[p.name] + ', r' : 'R'}un ${i + 1}: the gas made is the gas out plus the gas held, to ${err.toExponential(1)}</li>`; })).join('') : '';
  el.innerHTML = `<p class="dry-msg">${pill(st[1], st[0] === 'bad' ? 'bad' : st[0] === 'ok' ? 'ok' : '')}</p>
    <div class="furn-solve"><div><h4>Solver</h4><table class="proc-kv"><tbody>${rows.map(([a, b]) => `<tr><th>${a}</th><td class="fv-why">${b}</td></tr>`).join('')}</tbody></table></div>
    <div><h4>Checks</h4><ul class="checks">${chk || '<li>After it is solved.</li>'}<li class="ok">The methods against exact solutions: furnace.validate.js, 24 checks (the guide lists them)</li></ul></div></div>`;
}

// ---- Results: the answer, the warnings folded; one chart picked by chips; the piece ----
const FURN_CHARTS = [['fu4', 'Its thickness'], ['fu5', 'The gas against its hold'], ['fu7', 'Pulled and squeezed'], ['fu2', 'Its weight'], ['fu3', 'C/O'], ['fu6', 'Across the piece'], ['fu1', 'The two runs']];
function furnChipsHTML() {
  return `<div class="furn-chips" role="tablist" aria-label="Which chart" data-fpart="runs">${FURN_CHARTS.map(([id, t]) => `<button type="button" role="tab" class="chip" data-furnchart="${id}" aria-selected="${id === (FURN.chart || 'fu4')}">${t}</button>`).join('')}</div>`;
}
function furnShowChart() {
  // (each tab's results in a viewer, the furnace's and the graphene film's: the view picked shown before they draw; the
  // graphene film's the piece, until another is picked)
  const rv = document.querySelector('#furnSec .rv');
  if (rv) {
    if (rv.dataset.rvkey === 'gfilm' && typeof RV !== 'undefined' && !RV.sel.gfilm) RV.sel.gfilm = 'furnPiece';
    if (typeof rvSync === 'function') rvSync(rv);
    return;
  }
  // (the graphene film's tab shows its one chart, the film across the piece; the furnace's, the one its chips pick)
  const k = !PROC_ALL && FURN.part === 'product' ? 'fu6' : FURN.chart || 'fu4';
  document.querySelectorAll('#furnSec [data-furnchart]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.furnchart === (FURN.chart || 'fu4'))));
  FURN_CHARTS.forEach(([id]) => { const cv = document.getElementById(id); if (cv) cv.closest('figure').hidden = !PROC_ALL && id !== k; });
}
/** The answer in one line (Q117), then the warnings folded behind a button. */
function furnAnswerHTML(r, warnHTML) {
  const e = r.end, [r1, r2] = r.runs, puff = [r1, r2].map((q, i) => q.puffAt ? `run ${i + 1} from ${q.puffAt.T.toFixed(0)} °C` : '').filter(Boolean);
  const box = document.createElement('div'); box.innerHTML = warnHTML;
  const pills = [...box.querySelectorAll('.pill')], nBad = pills.filter(p => p.classList.contains('bad')).length;
  const B = furnBatch(r);
  return `<p class="furn-answer"><b>The graphene film: ${furnUm(B.h)} µm</b> ± ${(B.sd * 1e6).toFixed(1)} µm over the batch (${(B.h / r.q.P.h).toFixed(2)}× the GO piece), ${(B.rho / 1000).toFixed(2)} g/cm³, ${B.kappa.toFixed(0)} W/(m·K); ${puff.length ? `puffs up in ${puff.join(', ')}` : 'does not puff up'}.</p>
    ${pills.length ? `<details class="furn-warn"><summary>${nBad ? '<i class="pt-dot pt-bad" aria-hidden="true"></i>' : ''}Warnings (${pills.length})</summary>${warnHTML}</details>` : ''}`;
}
/** The piece at the end, from above (a colour map, thicker darker) or in 3D (its heights raised), the top piece. */
function furnPieceDraw(r) {
  const cv = document.getElementById('furnPiece');
  if (!cv) return;
  const mode = FURN.piece || 'map';
  document.querySelectorAll('#furnSec [data-furnpiece]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.furnpiece === mode)));
  const { c, w, h } = setupCanvas(cv, 0.9), q = r.map, n = q.length;
  // (the full piece from the quarter: mirrored about its middle lines)
  const full = []; for (let j = -n; j < n; j++) { const row = []; for (let i = -n; i < n; i++) row.push(q[j < 0 ? -j - 1 : j][i < 0 ? -i - 1 : i]); full.push(row); }
  const all = full.flat(), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const col = v => { const f = (v - lo) / span; return `hsl(218 70% ${(88 - f * 55).toFixed(0)}%)`; };
  c.clearRect(0, 0, w, h);
  const N = 2 * n;
  if (mode === 'map') {
    const s = Math.min(w - 90, h - 30), x0 = (w - 90 - s) / 2 + 6, y0 = 10, cs = s / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { c.fillStyle = col(full[j][i]); c.fillRect(x0 + i * cs, y0 + j * cs, cs + 0.6, cs + 0.6); }
    c.strokeStyle = cssVar('--line'); c.strokeRect(x0, y0, s, s);
    const bx = x0 + s + 14, grad = c.createLinearGradient(0, y0 + s, 0, y0); grad.addColorStop(0, col(lo)); grad.addColorStop(1, col(hi));
    c.fillStyle = grad; c.fillRect(bx, y0, 10, s);
    c.fillStyle = cssVar('--muted'); c.font = '11px ' + cssVar('--mono');
    c.fillText(`${hi.toFixed(hi >= 100 ? 0 : 1)}`, bx + 14, y0 + 10); c.fillText(`${lo.toFixed(lo >= 100 ? 0 : 1)} µm`, bx + 14, y0 + s);
    cv._pick = (px, py) => { const i = Math.floor((px - x0) / cs), j = Math.floor((py - y0) / cs); return i >= 0 && j >= 0 && i < N && j < N ? full[j][i] : null; };
  } else {
    // (a height map drawn back to front, turned by dragging: its heights raised so the spread shows)
    const az = FURN.az ?? 0.7, el = FURN.el ?? 0.55, ex = span > 0 ? 0.25 / (span / hi) : 1, sc = Math.min(w, h) * 0.36;
    const P = (i, j) => { const x = (i / N - 0.5), y = (j / N - 0.5), z = (full[Math.min(N - 1, j)][Math.min(N - 1, i)] - lo) / hi * ex;
      const xr = x * Math.cos(az) - y * Math.sin(az), yr = x * Math.sin(az) + y * Math.cos(az);
      return [w / 2 + xr * sc * 1.6, h * 0.58 + (yr * Math.sin(el) - z * Math.cos(el)) * sc * 1.6]; };
    const quads = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i + 0.5) / N - 0.5, y = (j + 0.5) / N - 0.5; quads.push({ i, j, d: x * Math.sin(az) + y * Math.cos(az) }); }
    quads.sort((a, b) => a.d - b.d);
    for (const { i, j } of quads) {
      const a = P(i, j), b = P(i + 1, j), d2 = P(i + 1, j + 1), e2 = P(i, j + 1);
      c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.lineTo(...d2); c.lineTo(...e2); c.closePath();
      c.fillStyle = col(full[j][i]); c.fill(); c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = 0.5; c.stroke();
    }
    c.fillStyle = cssVar('--muted'); c.font = '11px ' + cssVar('--sans');
    c.fillText(`drag to turn · heights raised · ${lo.toFixed(0)}–${hi.toFixed(0)} µm`, 8, h - 8);
    cv._pick = null;
  }
  const lg = document.getElementById('furnPieceLg');
  if (lg) lg.innerHTML = `<p class="fv-why">The graphene film's thickness over the whole piece (${(r.q.o.Lx * 1000).toFixed(0)} × ${(r.q.o.Ly * 1000).toFixed(0)} mm), the top piece at the end: ${lo.toFixed(1)}–${hi.toFixed(1)} µm.${mode === 'map' ? ' Hover for its value.' : ''}</p>`;
}
function furnPieceWire(cv) {
  if (cv.dataset.wired) return;
  cv.dataset.wired = '1';
  let d = null;
  cv.addEventListener('pointerdown', e => { if ((FURN.piece || 'map') !== '3d') return; d = { x: e.clientX, y: e.clientY, az: FURN.az ?? 0.7, el: FURN.el ?? 0.55 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (d) { FURN.az = d.az + (e.clientX - d.x) * 0.01; FURN.el = Math.min(1.4, Math.max(0.1, d.el + (e.clientY - d.y) * 0.01)); if (FURN.res && furnCurrent()) furnPieceDraw(FURN.res); return; }
    if (cv._pick) { const b = cv.getBoundingClientRect(), v = cv._pick(e.clientX - b.left, e.clientY - b.top); cv.title = v == null ? '' : `${v.toFixed(1)} µm`; }
  });
  const end = () => { d = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}

// ---- the stage's controls ----
function furnStageWire(sec) {
  sec.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (!t || !sec.contains(t)) return;
    const fu = () => OVEN.furn, setRuns = runs => { OVEN.furn = { ...fu(), runs, runsSet: true }; render(); };
    if (t.dataset.prun != null) { FURN.prun = +t.dataset.prun; furnSetupRender(); }
    else if (t.dataset.furnchart) { FURN.chart = t.dataset.furnchart; furnShowChart(); if (FURN.res && furnCurrent()) furnCharts(FURN.res); }
    else if (t.dataset.furnpiece) { FURN.piece = t.dataset.furnpiece; if (FURN.res && furnCurrent()) furnPieceDraw(FURN.res); }
    else if (t.dataset.paddstep != null) { const r = +t.dataset.paddstep, st = fu().runs[r].steps, last = st[st.length - 1]; undoHint(`${FURN_RUNS[r]}: add a step`); setRuns(fu().runs.map((q, j) => j === r ? { ...q, steps: [...q.steps, { rate: last.rate, to: Math.min(3300, last.to + 100), hold: 0 }] } : q)); }
    else if (t.dataset.pdelstep != null) { const [r, i] = t.dataset.pdelstep.split(':').map(Number); undoHint(`${FURN_RUNS[r]}: remove step ${i + 1}`); setRuns(fu().runs.map((q, j) => j === r ? { ...q, steps: q.steps.filter((_, n) => n !== i) } : q)); }
    else if (t.dataset.furnclear != null) { const r = +t.dataset.furnclear; undoHint(`${FURN_RUNS[r]}: steps instead of the file`); setRuns(fu().runs.map((q, j) => j === r ? { ...q, file: null } : q)); }
    else if (t.dataset.furnfile != null) { FURN.fileRun = +t.dataset.furnfile; const f = document.getElementById('furnFile'); if (f) { f.value = ''; f.click(); } }
    else if (t.dataset.furnroom) { OVEN.furn = { ...fu(), room: t.dataset.furnroom, roomSet: true }; render(); }
    else if (t.dataset.furnends) { OVEN.furn = { ...fu(), ends: t.dataset.furnends, endsSet: true }; render(); }
  });
  sec.addEventListener('change', e => {
    const el = e.target, fu = () => OVEN.furn;
    if (el.dataset.pstepin) {
      const [r, i, k] = el.dataset.pstepin.split(':'), [lo, hi] = FURN_STEP_LIMITS[k];
      guardNumber(el, { label: `${FURN_RUNS[+r]}, step ${+i + 1}: ${{ rate: 'heating rate', to: 'temperature', hold: 'hold' }[k]}`, lo, hi, unit: { rate: '°C/min', to: '°C', hold: 'min' }[k] },
        v => { OVEN.furn = { ...fu(), runs: fu().runs.map((q, j) => j === +r ? { ...q, steps: q.steps.map((s, n) => n === +i ? { ...s, [k]: v } : s) } : q), runsSet: true }; });
      render();
    } else if (el.dataset.pcool != null) {
      const r = +el.dataset.pcool, [lo, hi] = FURN_STEP_LIMITS.cool;
      guardNumber(el, { label: `${FURN_RUNS[r]}: cooling rate`, lo, hi, unit: '°C/min' }, v => { OVEN.furn = { ...fu(), runs: fu().runs.map((q, j) => j === r ? { ...q, cool: v } : q), runsSet: true }; });
      render();
    } else if (el.dataset.furnf) {
      const k = el.dataset.furnf, [, l, u, lo, hi, , , flag] = FURN_FIELDS.find(f => f[0] === k);
      guardNumber(el, { label: l, lo, hi, unit: u, allowEmpty: k === 'dTload' }, v => { OVEN.furn = { ...fu(), [k]: k === 'N' ? Math.round(v) : v, [flag]: v != null }; });
      render();
    }
  });
  furnPieceWire(document.getElementById('furnPiece'));
}
