'use strict';
/*
 * mixer-ui.js — MIX-1: the Mixing page's mixer, the batch in time (mixer.js).
 * Setup: the mixer drawn from above and from the side with its sizes; the program (each step's time, the arm's and the
 * disperser's speeds, the pressure, the ammonia at its start) as a table and a strip; the slurry going in (Materials).
 * Solve: on request (Phase 0), on the page's thread (a run takes a fraction of a second); how it is solved and checked.
 * Results: the answer, the figures at the end, one chart at a time (power, temperature, pH, lumps, viscosity, sizes, the
 * flow curve after mixing), the steps' table, the shear zones, and the lumps against the coating.
 * Inputs bar: every number of the mixer, its program's chemistry and the cake, by group (OVEN.mix: saved with the
 * project, undone as one unit).
 */

const MIX = { res: null, key: null, busy: false, error: null, ms: 0 };
const MIX_GROUPS = [['vessel', 'Vessel and jacket'], ['blades', 'Planetary blades'], ['disp', 'High-speed disperser'], ['chem', 'Chemistry and ammonia'],
  ['lumps', 'Cake lumps and the grind gauge'], ['flakes', 'Flakes'], ['visc', 'Viscosity'], ['power', 'Power constants'], ['num', 'Solver']];
const MIX_ASPECT = 0.42;   // (the charts' height / width: the page scrolls, so they keep their shape)
const MIX_STEP_LIMITS = { min: [0.1, 1440], No: [0, 200], Nd: [0, 10000], p: [1, 200], pH: [3, 12], mL: [0, 1e5] };
/** The page's inputs (the units it shows): OVEN.mix. */
const mixIn = () => OVEN.mix || (OVEN.mix = mixInDefaults());
const mixQ = k => MIX_INPUTS.find(q => q.k === k);
const mixEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ---- the solve ----
/** The slurry's flow law as the solvers have it (the Materials law at its temperature). */
function mixLaw() {
  const uses = RHEO_MODELS[CFDG.model].uses, ty = uses.includes('ty') ? P.ty : 0, n = uses.includes('n') ? P.n : 1, x = cfdRheoX();
  return { f: gd => muLaw(gd, P.mu, ty, n, x), key: [CFDG.model, P.mu, ty, n, x] };
}
/** The run's options (SI): the page's inputs, the slurry card's, the law. */
function mixOpts() {
  const c = MAT.slurry;
  return { ...mixInSI(mixIn()), phi: c.phi.v / 100, rhoS: c.rhoS.v * 1000, rhoL: c.rhoL.v, d50: c.dMean.v * 1e-6, dMin: c.dMin.v * 1e-6, dMax: c.dMax.v * 1e-6,
    tF: c.tFlake.v * 1e-9, cS: MAT.dry.cS.v, law: mixLaw().f };
}
const mixProps = () => (typeof matSolverProps === 'function' ? matSolverProps() : null);
function mixKeyNow() {
  const c = MAT.slurry;
  return JSON.stringify([mixIn(), c.phi.v, c.rhoS.v, c.rhoL.v, c.dMean.v, c.dMin.v, c.dMax.v, c.tFlake.v, MAT.dry.cS.v, mixLaw().key, mixProps()]);
}
const mixCurrent = () => !!MIX.res && MIX.key === mixKeyNow();
/** Solve the batch when asked for (the solve controller's pump calls it). */
function mixRequest() {
  const key = mixKeyNow();
  if (!MIX.busy && MIX.key === key && (MIX.res || MIX.error)) { solveTake('mix'); return; }
  if (!solveMay('mix') || MIX.busy) return;
  solveTake('mix');
  MIX.busy = true;
  if (tab === 12) mixRender();
  setTimeout(() => {
    const t0 = performance.now(), props = mixProps(), keep = DR_P;
    let r;
    // (the water laws as the material hub has them, for this run only)
    try { drUse(props); const o = mixOpts(); r = Number.isFinite(o.law(2.7)) && o.law(2.7) > 0 ? mixRun(o) : { error: 'the flow law on Materials gives no viscosity at 2.7 1/s' }; }
    catch (e) { r = { error: e.message || String(e) }; } finally { DR_P = keep; }
    MIX.busy = false; MIX.key = key; MIX.ms = performance.now() - t0;
    if (r.error) { MIX.res = null; MIX.error = r.error; } else { r.inp = JSON.parse(JSON.stringify(mixIn())); MIX.res = r; MIX.error = null; }
    if (typeof solvePump === 'function') solvePump();
    if (tab === 12 || tab === 14) render();
  }, 30);
}

// ---- formats ----
const mixF = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const mixSig = v => (!Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
/** The grind gauge's reading as it reads: off the gauge above its range. */
/** The inputs the shown results were solved with (an out-of-date batch is drawn with its own program). */
const mixRunIn = () => (MIX.res && MIX.res.inp) || mixIn();
const mixGrind = m => { const r = mixRunIn().gR; return !(m > 0) ? 'clean' : m * 1e6 > r ? `over ${r} µm` : `${(m * 1e6).toFixed(0)} µm`; };
const mixDoseText = d => (!d ? 'none' : d.pH != null ? `to pH ${(+d.pH).toFixed(1)}` : `${(+d.mL).toFixed(0)} mL`);

// ---- the stage's line, its state ----
function mixStage() {
  const n = mixIn().steps.length, tot = mixIn().steps.reduce((s, q) => s + q.min, 0), what = `${n} step${n === 1 ? '' : 's'}, ${+tot.toFixed(1)} min`;
  if (MIX.busy) return { st: 'busy', s: `${what}: the batch through its program…` };
  if (!mixCurrent()) return MIX.error && MIX.key === mixKeyNow() ? { st: 'failed', s: `${what}: ${MIX.error}` } : { st: MIX.res ? 'stale' : 'todo', s: `${what}: the batch through its program` };
  const e = MIX.res.end, d = MIX.res.doses;
  return { st: 'solved', s: `${what}: ${e.T.toFixed(0)} °C at the end, pH ${e.pH.toFixed(1)}${d.length ? ` (${d.map(q => `${q.mL.toFixed(0)} mL ammonia water`).join(', ')})` : ''}, grind gauge ${mixGrind(e.grind)}, ${(e.lumps * 100).toFixed(1)} % of the GO in lumps, ${mixSig(e.mu27)} Pa·s at 2.7 1/s` };
}

// ---- the drawings ----
/** The mixer from above (the vessel, the blades' orbit and sweep, their bars, the disc) and from the side (the batch's
 *  level, a blade's frame with its gaps, the disc's height), with their sizes. */
function mixDrawMixer() {
  const q = mixInSI(mixIn()), G = mixGeom(q), ink = cssVar('--ink'), mut = cssVar('--muted'), acc = cssVar('--accent'), fill = cssVar('--go-film'), soft = cssVar('--soft'), line = cssVar('--line');
  const mm = v => `${+(v * 1000).toFixed(1)} mm`;
  const shown = el => el && (PROC_ALL || el.offsetParent !== null);
  const top = document.getElementById('mxTop');
  if (shown(top)) {
    // (room above for the arm's line and the diameter, below for the sweep and the disc's clearances: wrapped to the width)
    const { c, w, h } = setupCanvas(top, 0.78);
    c.font = '12px ' + cssVar('--mono');
    const clr = G.cB < 0 ? [`the disc reaches ${mm(-G.cB)} into a blade's sweep`] : [`the disc clears the blades by ${mm(G.cB)}, the wall by ${mm(G.cW)}`];
    if (c.measureText(clr[0]).width > w - 16) clr.splice(0, 1, ...(G.cB < 0 ? [`the disc reaches ${mm(-G.cB)}`, 'into a blade\'s sweep'] : [`the disc clears the blades by ${mm(G.cB)},`, `the wall by ${mm(G.cW)}`]));
    // (the disc's size goes in it, on one line or two; a drawing too small for that says it below)
    const dl = `disc ${mm(q.Dd)}`, top0 = 24 + 20, scale = n => Math.min(w - 16, h - top0 - 16 * n - 8) / 2 / G.R;
    const inDisc = c.measureText(mm(q.Dd)).width < q.Dd * scale(clr.length + 1) - 8;
    const foot = [[`each blade sweeps ${mm(2 * G.rs)}${inDisc ? '' : `; the ${dl}`}`, mut], ...clr.map(t => [t, G.cB < 0 ? cssVar('--bad') : mut])];
    const s = scale(foot.length), cx = w / 2, cy = top0 + G.R * s;
    c.clearRect(0, 0, w, h); c.lineWidth = 1.5;
    c.fillStyle = fill; c.globalAlpha = 0.16; c.beginPath(); c.arc(cx, cy, G.R * s, 0, 7); c.fill(); c.globalAlpha = 1;
    c.strokeStyle = ink; c.beginPath(); c.arc(cx, cy, G.R * s, 0, 7); c.stroke();
    c.setLineDash([4, 4]); c.strokeStyle = mut; c.beginPath(); c.arc(cx, cy, q.ro * s, 0, 7); c.stroke(); c.setLineDash([]);
    // (the two blades on the arm, a bar pair across each axis; their sweep dotted)
    for (let b = 0; b < q.nBlade; b++) {
      const a = Math.PI * 2 * b / q.nBlade, ax = cx + q.ro * s * Math.cos(a), ay = cy + q.ro * s * Math.sin(a);
      c.setLineDash([2, 3]); c.strokeStyle = acc; c.beginPath(); c.arc(ax, ay, G.rs * s, 0, 7); c.stroke(); c.setLineDash([]);
      for (let k = 0; k < q.nBar; k++) {
        const t = a + Math.PI * 2 * k / q.nBar + Math.PI / 4, bx = ax + G.rs * s * Math.cos(t), by = ay + G.rs * s * Math.sin(t);
        c.save(); c.translate(bx, by); c.rotate(t + Math.PI / 2); c.fillStyle = acc; c.fillRect(-q.w * s / 2, -q.t * s / 2, q.w * s, q.t * s); c.restore();
      }
      c.fillStyle = ink; c.beginPath(); c.arc(ax, ay, 2.5, 0, 7); c.fill();
    }
    // (the disc, on the arm between the blades)
    const da = Math.PI / q.nBlade, dx = cx + q.rD * s * Math.cos(da), dy = cy + q.rD * s * Math.sin(da);
    c.fillStyle = soft; c.strokeStyle = ink; c.beginPath(); c.arc(dx, dy, q.Dd / 2 * s, 0, 7); c.fill(); c.stroke();
    for (let k = 0; k < Math.min(q.nT, 64); k++) { const t = 2 * Math.PI * k / Math.max(1, q.nT); c.beginPath(); c.moveTo(dx + q.Dd / 2 * s * Math.cos(t), dy + q.Dd / 2 * s * Math.sin(t)); c.lineTo(dx + (q.Dd / 2 + q.hT / 2) * s * Math.cos(t), dy + (q.Dd / 2 + q.hT / 2) * s * Math.sin(t)); c.stroke(); }
    // (the sizes)
    c.font = '12px ' + cssVar('--mono'); c.fillStyle = mut; c.textAlign = 'center';
    c.fillText(`D ${mm(q.D)}`, cx, cy - G.R * s - 8);
    c.fillStyle = ink;
    if (c.measureText(dl).width < q.Dd * s - 8) c.fillText(dl, dx, dy + 4);
    else if (inDisc) { c.fillText('disc', dx, dy - 3); c.fillText(mm(q.Dd), dx, dy + 11); }
    c.textAlign = 'left';
    foot.forEach(([t, col], i) => { c.fillStyle = col; c.fillText(t, 8, h - 8 - 16 * (foot.length - 1 - i)); });
    c.fillStyle = mut;
    c.textAlign = 'left'; c.fillStyle = mut; c.fillText(`arm ${mixIn().steps[0] ? mixIn().steps[0].No : 0} rpm · blades ×${q.ratio} ${q.dir > 0 ? 'with' : 'against'} it`, 8, 16);
  }
  const side = document.getElementById('mxSide');
  if (shown(side)) {
    // (the vessel left of middle, its sizes on dimension lines at its right; a blade's frame at the left, the disc at the right)
    const { c, w, h } = setupCanvas(side, 0.78), padT = 26, padB = 30;
    c.font = '12px ' + cssVar('--mono');
    const lab = [`vessel ${mm(q.Hv)}`, `batch ${mm(G.H)}`, `disc ${mm(q.hD)} up`], room = 58 + Math.max(...lab.map(t => c.measureText(t).width)) + 8;
    const s = Math.min((w - room - 16) / q.D, (h - padT - padB) / q.Hv), x0 = 16, yb = h - padB;
    c.clearRect(0, 0, w, h);
    const X = x => x0 + (x + q.D / 2) * s, Y = y => yb - y * s, xr = X(q.D / 2);
    c.fillStyle = fill; c.globalAlpha = 0.22; c.fillRect(X(-q.D / 2), Y(G.H), q.D * s, G.H * s); c.globalAlpha = 1;
    // (a blade's frame: its bars from the floor's gap up out of the batch, its bottom bar; then the disc on its shaft)
    const ax = -q.ro, top2 = Math.min(q.Hv, G.H + 0.25 * q.Hv), bw = Math.max(2, q.t * s);
    c.fillStyle = acc; c.globalAlpha = 0.85;
    for (const sx of [-1, 1]) c.fillRect(X(ax + sx * G.rs) - bw / 2, Y(top2), bw, (top2 - q.db) * s);
    c.fillRect(X(ax - G.rs), Y(q.db) - bw, 2 * G.rs * s, bw); c.globalAlpha = 1;
    c.strokeStyle = mut; c.lineWidth = 1; c.beginPath(); c.moveTo(X(ax), Y(q.Hv)); c.lineTo(X(ax), Y(top2)); c.stroke();
    c.beginPath(); c.moveTo(X(q.rD), Y(q.Hv)); c.lineTo(X(q.rD), Y(q.hD)); c.stroke();
    c.fillStyle = ink; c.fillRect(X(q.rD - q.Dd / 2), Y(q.hD) - 2, q.Dd * s, 4);
    c.strokeStyle = ink; c.lineWidth = 2; c.beginPath(); c.moveTo(X(-q.D / 2), Y(q.Hv)); c.lineTo(X(-q.D / 2), Y(0)); c.lineTo(xr, Y(0)); c.lineTo(xr, Y(q.Hv)); c.stroke();
    c.strokeStyle = acc; c.setLineDash([5, 4]); c.lineWidth = 1; c.beginPath(); c.moveTo(X(-q.D / 2), Y(G.H)); c.lineTo(xr, Y(G.H)); c.stroke(); c.setLineDash([]);
    // (dimension lines at the right: the vessel's height, the batch's level, the disc's height)
    c.font = '12px ' + cssVar('--mono'); c.textAlign = 'left';
    const dim = (y, x, t, col) => { c.strokeStyle = col; c.fillStyle = col; c.beginPath(); c.moveTo(xr + 4, Y(y)); c.lineTo(x, Y(y)); c.stroke(); c.beginPath(); c.moveTo(x, Y(0)); c.lineTo(x, Y(y)); c.stroke(); c.fillText(t, x + 6, Y(y) + 4); };
    dim(q.Hv, xr + 16, lab[0], mut); dim(G.H, xr + 34, lab[1], acc); dim(q.hD, xr + 52, lab[2], ink);
    c.fillStyle = mut; c.textAlign = 'center'; c.fillText(`D ${mm(q.D)}`, (X(-q.D / 2) + xr) / 2, padT - 8);
    c.textAlign = 'left'; c.fillText(`gaps to the wall ${mm(q.dw)}, to the floor ${mm(q.db)}`, X(-q.D / 2), yb + 18);
  }
}
/** The program as a strip: a block per step as long as its time, its speeds, pressure and ammonia in it. */
function mixDrawProgram() {
  const cv = document.getElementById('mxProg');
  if (!cv || (!PROC_ALL && cv.offsetParent === null)) return;
  // (tall enough for a step's lines on a phone)
  const S = mixIn().steps, tot = S.reduce((s, q) => s + q.min, 0) || 1, { c, w, h } = setupCanvas(cv, Math.max(0.12, 112 / (cv.parentElement.clientWidth || 600))), pad = 8;
  c.clearRect(0, 0, w, h);
  const acc = cssVar('--accent'), ink = cssVar('--ink'), mut = cssVar('--muted'), soft = cssVar('--soft'), line = cssVar('--line');
  let x = pad; const W = w - 2 * pad;
  c.font = '12px ' + cssVar('--sans');
  S.forEach((q, i) => {
    const bw = Math.max(2, W * q.min / tot);
    c.fillStyle = q.Nd > 0 ? acc : soft; c.globalAlpha = q.Nd > 0 ? 0.18 : 1; c.fillRect(x, pad, bw - 2, h - 2 * pad); c.globalAlpha = 1;
    c.strokeStyle = line; c.strokeRect(x, pad, bw - 2, h - 2 * pad);
    // (the step's lines, each whole where it fits: on one line when the block is wide, else one fact a line)
    const room = bw - 14, fits = t => c.measureText(t).width <= room, facts = [`arm ${q.No} rpm`, `disc ${q.Nd > 0 ? q.Nd + ' rpm' : 'off'}`, q.p >= 101 ? 'open' : `${q.p} kPa`, ...(q.dose ? [`ammonia ${mixDoseText(q.dose)}`] : [])];
    const head = [`${i + 1} · ${q.name} · ${+q.min.toFixed(1)} min`, `${i + 1} · ${q.name}`, `${i + 1}`].find(fits);
    const lines = [], wide = facts.join(' · ');
    if (head) lines.push([head, ink]);
    if (head && !head.includes(' min')) lines.push([`${+q.min.toFixed(1)} min`, ink]);
    if (fits(wide)) lines.push([wide, mut]); else facts.forEach(t => lines.push([t, mut]));
    c.textAlign = 'left';
    let yy = pad + 16;
    for (const [t, col] of lines) { if (yy > h - pad - 3 || !fits(t)) break; c.fillStyle = col; c.fillText(t, x + 6, yy); yy += 16; }
    x += bw;
  });
}

// ---- the page ----
/** The program's table: each step's name, time, speeds, pressure and its ammonia, typed here. */
function mixProgramTable() {
  const S = mixIn().steps, r = mixIn().ratio;
  const num = (i, k, step, what, unit) => { const [lo, hi] = MIX_STEP_LIMITS[k]; return `<input type="number" min="${lo}" max="${hi}" step="${step}" value="${S[i][k]}" data-mxstep="${i}:${k}" aria-label="Step ${i + 1}: ${what}, ${unit}">`; };
  const dose = (q, i) => { const m = !q.dose ? 'none' : q.dose.pH != null ? 'pH' : 'mL';
    return `<select data-mxdose="${i}" aria-label="Step ${i + 1}: ammonia water at its start">${[['none', 'none'], ['pH', 'to a pH'], ['mL', 'an amount']].map(([v, t]) => `<option value="${v}"${v === m ? ' selected' : ''}>${t}</option>`).join('')}</select>${m === 'pH' ? `<input type="number" min="3" max="12" step="0.1" value="${q.dose.pH}" data-mxdosev="${i}:pH" aria-label="Step ${i + 1}: ammonia to pH">` : m === 'mL' ? `<input type="number" min="0" max="100000" step="10" value="${q.dose.mL}" data-mxdosev="${i}:mL" aria-label="Step ${i + 1}: ammonia water, mL"><span class="prop-u">mL</span>` : ''}`; };
  return `<div class="proc-zones-wrap"><table class="proc-kv proc-grid proc-zones mx-prog"><thead><tr><th>Step</th><th>Name</th><th>Time <small>min</small></th><th>Arm <small>rpm</small></th><th>Blades <small>rpm</small></th><th>Disperser <small>rpm</small></th><th>Pressure <small>kPa abs</small></th><th>Ammonia water at its start</th><th></th></tr></thead><tbody>
    ${S.map((q, i) => `<tr><th>${i + 1}</th><td><input type="text" value="${mixEsc(q.name)}" data-mxname="${i}" aria-label="Step ${i + 1}: name" maxlength="40"></td>
      <td>${num(i, 'min', 0.5, 'time', 'min')}</td><td>${num(i, 'No', 1, 'arm speed', 'rpm')}</td><td class="mx-ro">${(q.No * r).toFixed(1)}</td><td>${num(i, 'Nd', 50, 'disperser speed', 'rpm')}</td><td>${num(i, 'p', 1, 'pressure', 'kPa absolute')}</td>
      <td class="mx-dose">${dose(q, i)}</td><td>${S.length > 1 ? `<button type="button" class="icon-btn" data-mxdel="${i}" title="Remove step ${i + 1}" aria-label="Remove step ${i + 1}">${uiIco('trash')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="mxAddStep">${uiIco('plus')}Add a step</button></div>`;
}
const MIX_CHARTS = [['mxP', 'Power'], ['mxT', 'Temperature'], ['mxPH', 'pH'], ['mxG', 'Grind gauge'], ['mxL', 'GO in lumps'], ['mxM', 'Viscosity'], ['mxS', 'Lump sizes'], ['mxK', 'Flake sizes'], ['mxF', 'Flow curve']];
/** The page's frame (filled by mixRender after it is drawn). */
function mixPageHTML() {
  const q = mixInSI(mixIn()), G = mixGeom(q), pane = (id, icon, title, aria) => `<figure class="pane mx-pane-r"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="mx-sec" id="mixSec">
    <div class="furn-block" data-pstep="setup"><div class="furn-bh"><h4>The mixer</h4><span class="fv-why">${(q.D * 1000).toFixed(0)} mm vessel, ${(q.V * 1000).toFixed(1)} L batch ${(G.H * 1000).toFixed(0)} mm deep; ${q.nBlade} planetary blades, a ${(q.Dd * 1000).toFixed(0)} mm disperser</span>
        <span class="vp-spacer"></span><button type="button" class="btn btn-secondary btn-sm" data-chain="mixin">${uiIco('tune')}Its sizes (inputs bar)</button></div>
      <div class="mx-draw"><figure class="pane"><figcaption>${uiBadge('drop')}From above</figcaption><canvas id="mxTop" role="img" aria-label="The mixer from above: the vessel, the blades' orbit and sweep, their bars, the disperser"></canvas></figure>
        <figure class="pane"><figcaption>${uiBadge('drop')}From the side</figcaption><canvas id="mxSide" role="img" aria-label="The mixer from the side: the batch's level, a blade's frame and its gaps, the disperser's height"></canvas></figure></div>
      ${G.err || G.warn ? `<p class="dry-msg">${pill('The mixer as set: ' + (G.err || G.warn), G.err ? 'bad' : 'warn')}</p>` : ''}</div>
    <div class="furn-block" data-pstep="setup"><div class="furn-bh"><h4>The program</h4><span class="fv-why">the blades spin ${q.ratio}× the arm, ${q.dir > 0 ? 'with' : 'against'} it; 101 kPa: open to the room</span></div>
      <canvas id="mxProg" class="mx-strip" role="img" aria-label="The program's steps along the time"></canvas>${mixProgramTable()}</div>
    <div class="furn-block" data-pstep="setup"><div class="furn-bh"><h4>The slurry going in</h4><span class="fv-why">from Materials: it is the mixed slurry's; the cake goes in as its pieces</span></div>${procSlurryHTML()}</div>
    <div id="mxState" data-pstep="solve results"></div>
    <div class="furn-block" data-pstep="solve"><div class="furn-bh"><h4>How it is solved</h4></div>
      <table class="cfd-table mx-how"><tbody>
        <tr><th scope="row">The batch</th><td>well mixed, followed in time through the program's steps (1D); the 2D and 3D of the vessel come next and will give the shear zones and the power constants for your mixer</td></tr>
        <tr><th scope="row">Power</th><td>the blades' bars by the exact Stokes drag in their share of the vessel plus their form drag; the disc by its power number, Kp/Re + Np∞, Kp the thin disc's exact Stokes torque</td></tr>
        <tr><th scope="row">Heat</th><td>the power, the jacket, the ammonia's neutralization, boiling under the step's vacuum</td></tr>
        <tr><th scope="row">pH</th><td>the charge balance of the GO's carboxyl and phenolic groups, ammonia and water; ammonia to a pH in closed form</td></tr>
        <tr><th scope="row">Lumps and flakes</th><td>a population balance on ${'>'}40 size classes: the cake's pieces broken and eroded in the disc's rim and the blades' wall and floor gaps, the flakes' collisions (their charge's stability ratio), the flakes broken where their tension passes their strength</td></tr>
        <tr><th scope="row">Viscosity</th><td>the Materials law: the lumps a paste at the cake's solids, the rest the dispersed flakes in the remaining water; the water's temperature, the flakes' size</td></tr>
        <tr><th scope="row">Time step</th><td>at most ${mixIn().dtMax} s (inputs bar, Solver); faster processes take shorter steps, flocculation an implicit step</td></tr>
        <tr><th scope="row">Checked against</th><td>the bars' drag (the biharmonic solution), the disc (the exact Stokes torque), the jacket and boiling (exact), the titration curve, the Debye length, Smoluchowski's and Ziff–McGrady's exact solutions: mixer.validate.js</td></tr>
      </tbody></table></div>
    <div class="stats mx-stats" id="mxStats" data-pstep="results"></div>
    <div data-pstep="results">${procChipsHTML('mix')}</div>
    <div class="dry-grid furn-one" data-pstep="results">
      ${pane('mxP', 'flow', 'Power', 'The blades\' and the disperser\'s power against time')}
      ${pane('mxT', 'oven', 'Temperature', 'The batch\'s temperature against time, the jacket and the boiling point')}
      ${pane('mxPH', 'drop', 'pH', 'The batch\'s pH against time')}
      ${pane('mxG', 'ratio', 'Grind gauge', 'The grind gauge\'s reading against time')}
      ${pane('mxL', 'weight', 'GO in lumps', 'The share of the GO still in lumps against time')}
      ${pane('mxM', 'flow', 'Viscosity', 'The batch\'s viscosity at 2.7 1/s against time')}
      ${pane('mxS', 'bars', 'Lump sizes', 'The GO in lumps by their size, at the end of each step')}
      ${pane('mxK', 'fibre', 'Flake sizes', 'The dispersed flakes by their size, at the start and the end')}
      ${pane('mxF', 'flow', 'Flow curve', 'The viscosity against the shear rate after mixing and the Materials law')}
    </div>
    <div id="mxTable" data-pstep="results"></div>
    <div id="mxZones" data-pstep="results"></div>
  </section>`;
}
/** Draw the page's parts: the drawings always; the state; the results when solved. */
function mixRender() {
  const sec = document.getElementById('mixSec');
  if (!sec) return;
  if (!sec.dataset.wired) mixWire(sec);
  mixDrawMixer(); mixDrawProgram();
  const st = document.getElementById('mxState');
  if (!mixCurrent()) {
    st.innerHTML = MIX.busy ? `<p class="dry-msg">${pill('Mixing the batch through its program…', '')}</p>`
      : MIX.error && MIX.key === mixKeyNow() ? `<p class="dry-msg">${pill('The batch could not be solved: ' + mixEsc(MIX.error), 'bad')}${solveCtl('mix')}</p>`
        : `<p class="dry-msg">${solvePending('mix') ? pill('Solving the batch…', '') : solveCtl('mix')}</p>`;
    if (!MIX.res) { mixClear(); return; }
    st.insertAdjacentHTML('beforeend', `<p class="dry-msg">${pill('Showing the batch for the previous inputs', 'warn')}</p>`);
  } else st.innerHTML = '';
  const r = MIX.res;
  st.insertAdjacentHTML('beforeend', procAnswerHTML(mixStage().s, mixWarnings(r)));
  mixStats(r); mixTables(r); procShowChart('mix');
  // (the charts drawn where they show: the Results step, or every one in the report)
  if (PROC_ALL || document.getElementById('mxStats').offsetParent !== null) mixCharts(r);
}
function mixClear() {
  ['mxStats', 'mxTable', 'mxZones'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  MIX_CHARTS.forEach(([id]) => { const cv = document.getElementById(id); if (cv) { const cx = setupCanvas(cv, 0.2); cx.c.clearRect(0, 0, cx.w, cx.h); } const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; });
}
/** The batch's checks, as the Line page lists them and the page warns of them: [{ t, res, lim, v (the result over its
 *  limit, or null), lv ('ok' | 'warn' | 'bad'), say (the warning when not ok) }]. Lumps against the blade's gap (they stick
 *  under it: streaks) and the dry film (specks), the grind gauge's range, boiling under the vacuum, the flakes' charge. */
function mixChecks(r) {
  const e = r.end, gR = r.inp.gR, gap = typeof localGap === 'function' ? localGap(ACROSS_W / 2) / 1000 : null;
  const web = typeof processWeb === 'function' ? processWeb() : null, dry = web && typeof massBalance === 'function' ? massBalance(web.mean, lineSpeed(), ACROSS_W / 1000).dry : null;
  const g = mixGrind(e.grind), out = [];
  if (gap) out.push({ t: 'Lumps pass under the blade', res: `largest ${g}`, lim: `${(gap * 1000).toFixed(2)} mm gap`, v: e.grind / gap, lv: e.grind > gap ? 'bad' : 'ok',
    say: `Lumps up to ${g} are larger than the blade's gap (${(gap * 1000).toFixed(2)} mm): they would stick under it and streak the film` });
  if (dry) out.push({ t: 'Lumps below the dry film', res: `largest ${g}`, lim: `${(dry * 1e6).toFixed(0)} µm dry film`, v: e.grind / dry, lv: e.grind > dry ? 'warn' : 'ok',
    say: `Lumps up to ${g} stand above the dry film (${(dry * 1e6).toFixed(0)} µm): specks in it` });
  out.push({ t: 'On the grind gauge', res: g, lim: `${gR} µm`, v: e.grind * 1e6 / gR, lv: e.grind * 1e6 > gR ? 'warn' : 'ok', say: `The largest lumps are over the grind gauge's ${gR} µm range` });
  out.push({ t: 'Does not boil', res: e.evap > 0 ? `${(e.evap * 1000).toFixed(0)} g of water boiled off` : 'does not boil', lim: '—', v: null, lv: e.evap > 0 ? 'warn' : 'ok',
    say: `The batch boiled under vacuum: ${(e.evap * 1000).toFixed(0)} g of water boiled off, its solids up to ${(e.phi * 100).toFixed(1)} vol%` });
  const W = e.W, wOk = !(Number.isFinite(W) && W < 1e6);
  out.push({ t: 'Flakes kept apart by their charge', res: Number.isFinite(W) ? `stability ratio ${W.toPrecision(2)}` : 'stable', lim: '10⁶', v: null, lv: wOk ? 'ok' : 'warn',
    say: `The flakes' charge keeps them apart weakly (stability ratio ${Number.isFinite(W) ? W.toPrecision(2) : '∞'}): they may flocculate` });
  return out;
}
/** What to look at, from the checks (the lumps against the gap, else against the film). */
function mixWarnings(r) {
  const C = mixChecks(r).filter(q => q.lv !== 'ok');
  return C.filter(q => !(q.t === 'Lumps below the dry film' && C.some(x => x.t === 'Lumps pass under the blade'))).map(q => pill(q.say, q.lv)).join('');
}
function mixStats(r) {
  const e = r.end, H = r.hist, n = H.t.length - 1, Tmax = Math.max(...H.T), dose = r.doses.reduce((s, d) => s + d.mL, 0);
  const tile = (l, v, sub, ic) => `<div class="stat" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  document.getElementById('mxStats').innerHTML = [
    tile('Power at the end', `${mixF(H.PB[n] + H.PD[n], 0)} W`, `blades ${mixF(H.PB[n], 0)}, disperser ${mixF(H.PD[n], 0)}`, 'flow'),
    tile('Torque at the arm', `${mixF(H.TqB[n], 1)} N·m`, 'the blades\' drive', 'flow'),
    tile('Torque at the disc', `${mixF(H.TqD[n], 2)} N·m`, 'the disperser\'s drive', 'flow'),
    tile('Batch temperature', `${mixF(Tmax, 1)} °C`, `highest; ${mixF(e.T, 1)} °C at the end`, 'oven'),
    tile('pH', mixF(e.pH, 2), r.doses.length ? `${mixF(dose, 0)} mL ammonia water` : 'no ammonia', 'drop'),
    tile('Grind gauge', mixGrind(e.grind), `${(e.lumps * 100).toFixed(2)} % of the GO in lumps`, 'ratio'),
    tile('Viscosity after mixing', `${mixSig(e.mu27)} Pa·s`, `at 2.7 1/s, ${r.inp.Tlaw} °C`, 'flow'),
    tile('Flakes', `${(e.d50 * 1e6).toFixed(2)} µm`, 'their median size', 'fibre'),
  ].join('');
}
/** An axis over [lo, hi] on round numbers: its ends, its ticks, the decimals its step needs. */
function mixAxis(lo, hi, n = 5) {
  if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
  const t = niceTicks(lo, hi, n), st = t.length > 1 ? t[1] - t[0] : 1, a = Math.floor(lo / st + 1e-9) * st, b = Math.ceil(hi / st - 1e-9) * st;
  return { y0: a, y1: b, yticks: niceTicks(a, b, n), yd: Math.max(0, -Math.floor(Math.log10(st) + 1e-9)) };
}
/** The charts against time in minutes; the steps' starts marked. */
function mixCharts(r) {
  const H = r.hist, tm = H.t.map(t => t / 60), acc = cssVar('--accent'), mut = cssVar('--muted'), ink = cssVar('--ink'), warm = cssVar('--warn'), go = cssVar('--go-film');
  const x1 = Math.max(1e-3, tm[tm.length - 1]), starts = []; let t0 = 0; for (const s of r.inp.steps) { starts.push(t0); t0 += s.min; }
  const vl = starts.slice(1).map((x, i) => ({ x, c: mut, t: `${i + 2}` }));
  const lim = (a, pad = 0.04) => { const v = a.filter(Number.isFinite); let lo = Math.min(...v), hi = Math.max(...v); if (!(hi > lo)) { hi = lo + 1; lo -= 1; } const d = (hi - lo) * pad; return [lo - d, hi + d]; };
  const xt = niceTicks(0, x1, 7), xd = Math.max(0, -Math.floor(Math.log10(xt.length > 1 ? xt[1] - xt[0] : 1) + 1e-9));
  const ser = (a, c, w = 2, dash) => ({ p: tm.map((x, i) => [x, a[i]]), c, w, dash });
  const draw = (id, y, s, opts, legend) => { const cv = document.getElementById(id); if (!cv || (!PROC_ALL && cv.offsetParent === null)) return;
    const ax = mixAxis(y[0], y[1]);
    plotChart(cv, MIX_ASPECT, { x0: 0, x1, xticks: xt, xd, xl: 'time (min)', vl, s, ...ax, ...opts }); const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = oneDLegend(legend); };
  const Pt = H.PB.map((p, i) => p + H.PD[i]);
  draw('mxP', [0, Math.max(...Pt) * 1.05 || 1], [ser(Pt, ink), ser(H.PB, acc, 1.6), ser(H.PD, warm, 1.6, [6, 4])], { yl: 'power (W)' }, [['total', ink], ['blades', acc], ['disperser', warm, 'dash']]);
  const q = mixInSI(r.inp), RS = r.inp.steps, Tb = []; for (let i = 0; i < H.t.length; i++) { Tb.push(RS[H.step[i]].p < 101 ? drTsat(RS[H.step[i]].p * 1000) : NaN); }
  const yT = lim([...H.T, q.Tj, ...Tb.filter(Number.isFinite)]);
  draw('mxT', yT, [ser(H.T, go, 2.2), ...(Tb.some(Number.isFinite) ? [ser(Tb, warm, 1.4, [6, 4])] : [])], { yl: 'temperature (°C)', hl: [{ y: q.Tj, c: mut, t: `jacket ${q.Tj} °C` }] },
    [['the batch', go], ...(Tb.some(Number.isFinite) ? [['boiling point under the vacuum', warm, 'dash']] : [])]);
  draw('mxPH', lim(H.pH), [ser(H.pH, acc)], { yl: 'pH' }, [['pH', acc]]);
  const g = H.grind.map(v => v * 1e6), gR = r.inp.gR;
  draw('mxG', [0, Math.max(gR * 1.1, Math.min(Math.max(...g) * 1.05, gR * 4))], [ser(g, acc)], { yl: 'grind gauge (µm)', hl: [{ y: gR, c: mut, t: `the gauge's range ${gR} µm` }] }, [['the largest lumps (the gauge\'s reading)', acc]]);
  draw('mxL', [0, 100], [ser(H.lumps.map(v => v * 100), acc)], { yl: 'GO in lumps (%)' }, [['GO in lumps larger than the flakes', acc]]);
  draw('mxM', lim(H.mu27), [ser(H.mu27, go)], { yl: 'viscosity at 2.7 1/s (Pa·s)' }, [['the batch, at its temperature', go]]);
  // lump sizes at the end: the GO's volume share per class against size (log); the flakes' sizes
  const D = r.dist, tot = D.vol.reduce((s, v) => s + v, 0) || 1, pts = D.a.map((a, i) => [Math.log10(a * 1e6), D.vol[i] / tot * 100]).filter((p, i) => D.lump[i]);
  const vis = cv => cv && (PROC_ALL || cv.offsetParent !== null);
  const cvS = document.getElementById('mxS'); if (vis(cvS)) { const xs = pts.map(p => p[0]); const lo = Math.floor(Math.min(...xs, 0)), hi = Math.ceil(Math.max(...xs, 2));
    plotChart(cvS, MIX_ASPECT, { x0: lo, x1: hi, ...mixAxis(0, Math.max(1e-3, ...pts.map(p => p[1])) * 1.05), xl: 'lump size (µm)', yl: 'share of the GO (%)', xticks: Array.from({ length: hi - lo + 1 }, (_, i) => lo + i), xf: v => String(+Math.pow(10, v).toPrecision(1)), s: [{ p: pts, c: acc, w: 2, dots: true }] });
    document.getElementById('mxSLg').innerHTML = oneDLegend([['in lumps at the end, by size class', acc, 'dot']]); }
  const F = r.flakes, ft = F.vol.reduce((s, v) => s + v, 0) || 1, c0 = MAT.slurry;
  const cvK = document.getElementById('mxK'); if (vis(cvK)) { const p1 = F.d.map((d, i) => [Math.log10(d * 1e6), F.vol[i] / ft * 100]);
    plotChart(cvK, MIX_ASPECT, { x0: -1, x1: 2, ...mixAxis(0, Math.max(1, ...p1.map(p => p[1])) * 1.05), xl: 'flake size (µm)', yl: 'share of the flakes (%)', xticks: [-1, 0, 1, 2], xf: v => String(+Math.pow(10, v).toPrecision(1)),
      vl: [{ x: Math.log10(c0.dMean.v), c: mut, t: `Materials ${c0.dMean.v} µm` }], s: [{ p: p1, c: acc, w: 2, dots: true }] });
    document.getElementById('mxKLg').innerHTML = oneDLegend([['dispersed flakes at the end', acc, 'dot']]); }
  // the flow curve after mixing (at the law's temperature) against the Materials law
  const cvF = document.getElementById('mxF'); if (vis(cvF)) { const L = mixLaw().f, a = [], b = [];
    for (let i = 0; i <= 120; i++) { const lg = -2 + 6 * i / 120, gd = Math.pow(10, lg); const m0 = L(gd), m1 = r.muAt(gd); if (m0 > 0) a.push([lg, Math.log10(m0)]); if (m1 > 0) b.push([lg, Math.log10(m1)]); }
    const ys = [...a, ...b].map(p => p[1]); let y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys)); if (y1 <= y0) y1 = y0 + 1;
    const dec = v => { const kk = Math.round(v); return kk >= 4 || kk <= -3 ? `1e${kk}` : String(+Math.pow(10, kk).toPrecision(1)); };
    plotChart(cvF, MIX_ASPECT, { x0: -2, x1: 4, y0, y1, xticks: [-2, -1, 0, 1, 2, 3, 4], yticks: Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i), xf: dec, yf: dec, xl: 'shear rate (1/s)', yl: 'viscosity (Pa·s)', s: [{ p: a, c: mut, w: 1.6, dash: [6, 4] }, { p: b, c: go, w: 2.2 }] });
    document.getElementById('mxFLg').innerHTML = oneDLegend([['after mixing, at ' + r.inp.Tlaw + ' °C', go], ['the Materials law', mut, 'dash']]); }
}
/** The steps' table (each step's end) and the shear zones (each step's). */
function mixTables(r) {
  const H = r.hist, S = r.inp.steps, rows = [];
  S.forEach((s, i) => { const j = H.step.lastIndexOf(i);
    rows.push(`<tr><th scope="row">${i + 1} · ${mixEsc(s.name)}</th><td>${(H.t[j] / 60).toFixed(1)}</td><td>${mixF(H.T[j], 1)}</td><td>${mixF(H.PB[j] + H.PD[j], 0)}</td><td>${mixF(H.TqB[j], 1)}</td><td>${mixF(H.TqD[j], 2)}</td><td>${mixF(H.pH[j], 2)}</td><td class="mx-nw">${mixGrind(H.grind[j])}</td><td>${(H.lumps[j] * 100).toFixed(2)}</td><td>${mixSig(H.mu27[j])}</td></tr>`); });
  document.getElementById('mxTable').innerHTML = `<h3 class="oned-h">At the end of each step</h3><div class="oned-scroll"><table class="cfd-table"><thead><tr><th scope="col">Step</th><th scope="col">Time <small>min</small></th><th scope="col">Temperature <small>°C</small></th><th scope="col">Power <small>W</small></th><th scope="col">Arm torque <small>N·m</small></th><th scope="col">Disc torque <small>N·m</small></th><th scope="col">pH</th><th scope="col">Grind gauge</th><th scope="col">GO in lumps <small>%</small></th><th scope="col">Viscosity <small>Pa·s, 2.7 1/s, at the batch's temperature</small></th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const ZN = { disc: 'The disperser\'s rim', wall: 'The blades at the wall', floor: 'The blades over the floor' };
  const zr = r.zones.flatMap((Z, i) => Z.map(z => `<tr><th scope="row">${i + 1} · ${mixEsc(S[i].name)}</th><td>${ZN[z.k]}</td><td>${mixSig(z.gd)}</td><td>${mixSig(z.tau)}</td><td>${(z.f * 60).toFixed(1)}</td></tr>`));
  const dz = r.doses.map(d => `<tr><th scope="row">${d.step + 1} · ${mixEsc(S[d.step].name)}</th><td>${d.mL.toFixed(0)} mL (${d.g.toFixed(0)} g, ${d.mol.toFixed(2)} mol NH₃)</td><td>${d.pH.toFixed(2)}</td><td>${(d.heat / 1000).toFixed(0)} kJ</td></tr>`);
  document.getElementById('mxZones').innerHTML = `<h3 class="oned-h">Where the lumps are broken: the shear zones</h3><div class="oned-scroll"><table class="cfd-table"><thead><tr><th scope="col">Step</th><th scope="col">Zone</th><th scope="col">Shear rate <small>1/s</small></th><th scope="col">Stress <small>Pa</small></th><th scope="col">Passes of the batch <small>per min</small></th></tr></thead><tbody>${zr.join('') || '<tr><td colspan="5">no zone: nothing turns</td></tr>'}</tbody></table></div>
    ${dz.length ? `<h3 class="oned-h">The ammonia</h3><div class="oned-scroll"><table class="cfd-table"><thead><tr><th scope="col">Step</th><th scope="col">Ammonia water (${r.inp.wN} wt%)</th><th scope="col">pH after</th><th scope="col">Heat released</th></tr></thead><tbody>${dz.join('')}</tbody></table></div>` : ''}`;
}
/** The page's own controls: the program's table, the chart chips (shared), the inputs bar's link. */
function mixWire(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('change', e => {
    const el = e.target, S = mixIn().steps;
    if (el.dataset.mxstep) { const [i, k] = el.dataset.mxstep.split(':'), [lo, hi] = MIX_STEP_LIMITS[k];
      guardNumber(el, { label: `Mixing step ${+i + 1}: ${{ min: 'time', No: 'arm speed', Nd: 'disperser speed', p: 'pressure' }[k]}`, lo, hi, unit: { min: 'min', No: 'rpm', Nd: 'rpm', p: 'kPa' }[k] }, v => { S[+i][k] = v; });
      processPage(true); return; }
    if (el.dataset.mxname != null) { S[+el.dataset.mxname].name = el.value.trim().slice(0, 40) || `Step ${+el.dataset.mxname + 1}`; processPage(true); return; }
    if (el.dataset.mxdose != null) { const i = +el.dataset.mxdose; S[i].dose = el.value === 'pH' ? { pH: 7 } : el.value === 'mL' ? { mL: 500 } : null; processPage(true); return; }
    if (el.dataset.mxdosev) { const [i, k] = el.dataset.mxdosev.split(':'), [lo, hi] = MIX_STEP_LIMITS[k];
      guardNumber(el, { label: `Mixing step ${+i + 1}: ammonia ${k === 'pH' ? 'to pH' : 'water'}`, lo, hi, unit: k === 'pH' ? '' : 'mL' }, v => { S[+i].dose = { [k]: v }; });
      processPage(true); }
  });
  sec.addEventListener('click', e => {
    const del = e.target.closest && e.target.closest('[data-mxdel]');
    if (del) { mixIn().steps.splice(+del.dataset.mxdel, 1); processPage(true); return; }
    if (e.target.closest && e.target.closest('#mxAddStep')) { const S = mixIn().steps, last = S[S.length - 1] || MIX_STEPS[0]; S.push({ ...last, name: `Step ${S.length + 1}`, dose: null }); processPage(true); }
  });
}

// ---- the inputs bar ----
/** The mixer's inputs by group, each with its unit and what it is. */
function mixTreeHTML() {
  const d = mixIn(), open = k => (FV.tree['mx-' + k] ? ' open' : '');
  const row = q => q.o ? `<div class="prop"><label class="prop-l" for="mxi_${q.k}" title="${mixEsc(q.h || q.l)}">${q.l}</label><span class="prop-v"><select id="mxi_${q.k}" data-mxin="${q.k}">${q.o.map(([v, t]) => `<option value="${v}"${v === d[q.k] ? ' selected' : ''}>${t}</option>`).join('')}</select></span></div>`
    : `<div class="prop"><label class="prop-l" for="mxi_${q.k}" title="${mixEsc(q.h || q.l)}">${q.l}</label><span class="prop-v"><input type="number" id="mxi_${q.k}" min="${q.min}" max="${q.max}" step="${q.step}" value="${+(+d[q.k]).toFixed(q.d)}" data-mxin="${q.k}"${q.h ? ` title="${mixEsc(q.h)}"` : ''}><span class="prop-u">${q.u}</span></span></div>`;
  return `<div id="mixIn">${MIX_GROUPS.map(([g, t]) => `<details class="grp cfd-grp" data-tree="mx-${g}"${open(g)}><summary>${t}</summary>${MIX_INPUTS.filter(q => q.g === g).map(row).join('')}</details>`).join('')}
    <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="mxReset">${uiIco('restart')}The mixer's defaults</button></div></div>`;
}
function wireMixTree() {
  const box = document.getElementById('mixIn');
  if (!box) return;
  box.addEventListener('change', e => {
    const el = e.target, k = el.dataset.mxin; if (!k) return;
    const q = mixQ(k);
    if (q.o) mixIn()[k] = +el.value;
    else guardNumber(el, { label: `Mixing: ${q.l.toLowerCase()}`, lo: q.min, hi: q.max, unit: q.u }, v => { mixIn()[k] = v; });
    processPage(true);
  });
  const rs = document.getElementById('mxReset');
  if (rs) rs.onclick = () => { const steps = mixIn().steps; OVEN.mix = { ...mixInDefaults(), steps }; render(); };
}
/** A project's mixer (none, or from before it: the defaults; each value checked against its range, the program's steps). */
function applyMix(m) {
  const out = mixInDefaults();
  if (!m || typeof m !== 'object') return out;
  for (const q of MIX_INPUTS) { const v = m[q.k]; if (q.o ? q.o.some(([x]) => x === v) : Number.isFinite(v) && v >= q.min && v <= q.max) out[q.k] = v; }
  const inR = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
  if (Array.isArray(m.steps)) {
    const S = m.steps.filter(s => s && inR(s.min, MIX_STEP_LIMITS.min) && inR(s.No, MIX_STEP_LIMITS.No) && inR(s.Nd, MIX_STEP_LIMITS.Nd) && inR(s.p, MIX_STEP_LIMITS.p))
      .map((s, i) => ({ name: String(s.name || `Step ${i + 1}`).slice(0, 40), min: s.min, No: s.No, Nd: s.Nd, p: s.p,
        dose: s.dose && inR(s.dose.pH, MIX_STEP_LIMITS.pH) ? { pH: s.dose.pH } : s.dose && inR(s.dose.mL, MIX_STEP_LIMITS.mL) ? { mL: s.dose.mL } : null }));
    if (S.length) out.steps = S;
  }
  return out;
}
/** The undo history's label for a change to the mixer. */
function mixUndoLabel(a, b) {
  a = a || mixInDefaults(); b = b || mixInDefaults();
  for (const q of MIX_INPUTS) if (a[q.k] !== b[q.k]) return `Mixing: ${q.l.toLowerCase()} ${b[q.k]}${q.u && !q.o ? ' ' + q.u : ''}`;
  if ((a.steps || []).length !== (b.steps || []).length) return (b.steps || []).length > (a.steps || []).length ? 'Mixing: add a step' : 'Mixing: remove a step';
  return 'Mixing: the program';
}
