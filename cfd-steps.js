/*
 * cfd-steps.js — Flow › 2D and Flow › 3D as steps: Geometry › Mesh › Solve › Results (the step bar
 * beside 1D | 2D | 3D). Geometry: the blade drawn to scale with its dimensions (drag a handle or click
 * a value to change it). Mesh: the mesh the solve starts on, laid out by the solver's own mesher in a
 * worker before anything is solved, or the solved one, with its quality. Solve: the boundary conditions
 * on a drawing of the domain, the solver settings, Run and its progress. Results: the flow.
 *
 * Loaded after cfd-ui.js (FV, CFDG, cfdRuns, the plot) and before ui-3d.js.
 */

const STEPS = [['geometry', 'Geometry'], ['mesh', 'Mesh'], ['solve', 'Solve'], ['results', 'Results']];
const STEP_CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** The step bar: each step with a line saying where it stands (st[k] = { state: '' | 'done' | 'warn' | 'bad' | 'run', note, title }). */
function stepBar(kind, cur, st) {
  return `<nav class="step-bar" role="tablist" aria-label="Steps" data-kind="${kind}">${STEPS.map(([k, t], n) => {
    const s = st[k] || {}, mark = k !== cur && s.state === 'done' ? STEP_CHECK : n + 1;
    return `<button type="button" role="tab" data-step="${k}" aria-selected="${k === cur}" tabindex="${k === cur ? 0 : -1}" class="st-${s.state || 'none'}" title="${escAttr(s.title || s.note || t)}"><b>${mark}</b><span>${t}<small>${s.note || ''}</small></span></button>${n < STEPS.length - 1 ? '<i class="step-sep" aria-hidden="true">›</i>' : ''}`;
  }).join('')}</nav>`;
}
const escAttr = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('.step-bar [data-step]');
  if (!b) return;
  const kind = b.closest('.step-bar').dataset.kind;
  if (kind === '2d') goStep2D(b.dataset.step); else goStep3D(b.dataset.step);
});
// (arrow keys along the bar open the step, as the sub tabs do)
document.addEventListener('keydown', e => {
  const b = e.target.closest && e.target.closest('.step-bar [data-step]');
  if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const bs = [...b.parentElement.querySelectorAll('[data-step]')], n = bs.length, k0 = bs.indexOf(b);
  const k = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (k0 + (e.key === 'ArrowRight' ? 1 : -1) + n) % n, kind = b.closest('.step-bar').dataset.kind, s = bs[k].dataset.step;
  if (kind === '2d') goStep2D(s); else goStep3D(s);
  const f = document.querySelector(`.step-bar [data-step="${s}"]`); if (f) f.focus();
});

// =====================================================================
// 2D
// =====================================================================
/** The step shown: the one chosen, else Results when something is solved, else Geometry. */
const step2D = () => FV.step || (cfdRuns.some(r => r.field) ? 'results' : 'geometry');
/** The bottom tabs of each step (Results: every tab it had before the steps). */
const STEP_DOCK_2D = {
  geometry: ['dims', 'problems', 'msgs', 'history'],
  mesh: ['meshlocs', 'mesh', 'accuracy', 'problems', 'msgs', 'history'],
  solve: ['conv', 'problems', 'msgs', 'history'],
  results: ['metrics', 'probes', 'cuts', 'across', 'profiles', 'fibre', 'conv', 'problems', 'msgs', 'mesh', 'cases', 'history', 'method'],
};
/** The location a step other than Results shows (its own choice, independent of the Results' view). */
const stepLoc2D = () => Math.max(0, Math.min(CFD_LOCS.length - 1, FV.stepLoc | 0));
/** The bottom tab a step shows: the one open if the step has it, else the step's last, else its first. */
function stepDockFix2D(k = step2D()) {
  const ok = STEP_DOCK_2D[k];
  if (ok.includes(FV.dock)) return;
  const last = FV.stepDock[k];
  FV.dock = last && ok.includes(last) ? last : ok[0];
}
/** Opening a step: its own last tab (the first time, its first), not the tab the step left had open. */
function goStep2D(k) {
  const cur = step2D();
  if (k === cur && FV.step) return;
  FV.stepDock[cur] = FV.dock;
  FV.step = k;
  const last = FV.stepDock[k];
  FV.dock = last && STEP_DOCK_2D[k].includes(last) ? last : STEP_DOCK_2D[k][0];
  if (tab === 4) viewCFD(); else render();
}
/** Run: the Solve step, then all four locations; when they are done the page opens Results. */
function runFromSolve2D() {
  if (tab === 4 && step2D() !== 'solve') goStep2D('solve');
  FV.stepAuto = true;
}
/** After a run ends: all four done (or stopped) -> Results, when a run was started from Solve and the page is still there. */
function stepAfterRuns2D() {
  if (!FV.stepAuto || cfdRuns.some(r => r.status === 'running')) return;
  FV.stepAuto = false;
  if (tab === 4 && step2D() === 'solve' && cfdRuns.some(r => r.status === 'done')) goStep2D('results');
}
const GEO_CODES = ['gap', 'angles', 'land'];
/** Where each step stands, for the bar. */
function stepStatus2D() {
  const locs = CFD_LOCS.map((_, i) => i), probs = locs.map(i => checkLocation(i).filter(p => p.level === 'error'));
  const geoErr = probs.flat().filter(p => GEO_CODES.includes(p.code)), otherErr = probs.flat().filter(p => !GEO_CODES.includes(p.code));
  const gaps = locs.map(i => locInput(i, 'gap')), gTxt = Math.min(...gaps) === Math.max(...gaps) ? gaps[0].toFixed(3) : `${Math.min(...gaps).toFixed(3)}–${Math.max(...gaps).toFixed(3)}`;
  const st = {};
  st.geometry = geoErr.length ? { state: 'bad', note: `${geoErr.length} problem${geoErr.length > 1 ? 's' : ''}`, title: geoErr.map(p => p.text).join(' ') }
    : { state: 'done', note: `${CFDG.shape === 'round' ? `round R ${CFDG.R}` : `flat land ${P.L}`} mm · gap ${gTxt}`, title: 'The blade and the gap at each location' };
  const ms = locs.map(i => meshShown2D(i)).filter(Boolean), pend = locs.some(i => !MESH_PV.byLoc[i] || MESH_PV.byLoc[i].key !== meshPvKey(i));
  if (ms.some(m => m.error)) st.mesh = { state: 'bad', note: 'no valid mesh', title: ms.find(m => m.error).error };
  else if (ms.length && ms.every(m => m.stats)) {
    const els = [...new Set(ms.map(m => m.stats.elements))], worst = Math.min(...ms.map(m => m.stats.worst));
    st.mesh = { state: worst < 0.2 ? 'warn' : 'done', note: `${els.length > 1 ? `${Math.min(...els)}–${Math.max(...els)}` : els[0]} elements · worst ${worst.toFixed(2)}`, title: 'Elements and the worst element\'s shape quality (1 = undistorted), over the four locations' };
  } else st.mesh = { state: '', note: pend ? 'laying out…' : '—' };
  const running = cfdRuns.filter(r => r.status === 'running').length, done = cfdRuns.filter(r => r.field).length, bad = cfdRuns.map((r, i) => r.status === 'error' || r.status === 'blocked' ? `L${i + 1}` : null).filter(Boolean);
  const stopped = cfdRuns.some(r => r.status === 'cancelled');
  if (running) st.solve = { state: 'run', note: `solving ≈ ${Math.floor(100 * (cfdProgShare() || 0))} %` };
  else if (bad.length) st.solve = { state: 'bad', note: `${bad.join(', ')} failed`, title: 'See Problems and Messages' };
  else if (otherErr.length && !done) st.solve = { state: 'bad', note: `${otherErr.length} problem${otherErr.length > 1 ? 's' : ''}`, title: otherErr.map(p => p.text).join(' ') };
  else st.solve = done ? { state: stopped ? 'warn' : 'done', note: `${done} of ${CFD_LOCS.length} solved${stopped ? ' · stopped' : ''}`, title: stopped ? 'A run was stopped: the earlier result of each location is kept' : '' } : { state: stopped ? 'warn' : '', note: stopped ? 'stopped' : 'not solved' };
  const stale = locs.some(i => cfdIsStale(i));
  st.results = !done ? { state: '', note: 'nothing yet' } : stale ? { state: 'warn', note: 'out of date', title: 'The inputs changed since: Solve again' } : { state: 'done', note: 'flow, metrics, probes' };
  return st;
}
/** A step bar wider than its room (a phone): scrolled to show the step open. */
function stepBarScroll() {
  document.querySelectorAll('.step-bar').forEach(bar => {
    const cur = bar.querySelector('[aria-selected="true"]');
    if (cur && bar.scrollWidth > bar.clientWidth + 1) bar.scrollLeft += cur.getBoundingClientRect().left - bar.getBoundingClientRect().left - 8;
  });
}
function renderStepBar2D() {
  const host = document.querySelector('.flow-head .step-bar');
  if (!host) return;
  const html = stepBar('2d', step2D(), stepStatus2D());
  if (host.outerHTML !== html) { host.outerHTML = html; stepBarScroll(); }
}
/** The 3D page's step bar, where each step stands now (while solving: its progress). */
function renderStepBar3D() {
  const host = document.querySelector('.pg-bar .step-bar[data-kind="3d"]');
  if (!host) return;
  const html = stepBar('3d', step3D(), stepStatus3D());
  if (host.outerHTML !== html) { host.outerHTML = html; stepBarScroll(); }
}

// ---- the toolbar of Geometry, Mesh and Solve ----
const locSegHTML = cur => `<div class="seg" role="tablist" aria-label="Location" id="stepLocSeg">${CFD_LOCS.map((l, i) => `<button type="button" role="tab" data-steploc="${i}" aria-selected="${i === cur}" title="Location ${i + 1}, z ${l.z} mm"><i class="loc-dot" style="background:${locColor(i)}"></i>L${i + 1}</button>`).join('')}</div>`;
function stepToolsHTML2D(k) {
  const i = stepLoc2D(), opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
  const sep = '<span class="vp-sep" aria-hidden="true"></span>';
  if (k === 'geometry') return `${locSegHTML(i)}${sep}<span class="vp-ctl">Blade</span><div class="seg" role="tablist" aria-label="Blade entry">
      <button type="button" role="tab" data-stepshape="round" aria-selected="${CFDG.shape === 'round'}">Round entry</button><button type="button" role="tab" data-stepshape="flat" aria-selected="${CFDG.shape === 'flat'}">Flat land</button></div>
      ${sep}<label class="fv-chk"><input type="checkbox" id="stepDims"${FV.stepDims ? ' checked' : ''}> Dimensions</label>`;
  if (k === 'mesh') {
    const solved = cfdRuns[i].field && !cfdIsStale(i);
    return `${locSegHTML(i)}${sep}<label class="vp-ctl">Mesh <select id="stepMeshPreset" aria-label="Mesh">${sharedMeshPresets().map(([m, p]) => opt(m, p.l + (m === 'medium' ? ' (default)' : ''), CFDS.mesh)).join('')}</select></label>
      <div class="seg" role="tablist" aria-label="Which mesh"><button type="button" role="tab" data-meshshow="start" aria-selected="${meshShowOf2D(i) === 'start'}">Starting</button><button type="button" role="tab" data-meshshow="solved" aria-selected="${meshShowOf2D(i) === 'solved'}"${solved ? '' : ' disabled title="Solve first (or the solve is out of date)"'}>Solved</button></div>
      <label class="fv-chk"><input type="checkbox" id="stepMeshShade"${FV.meshShade ? ' checked' : ''}> Shade by quality</label>
      <button class="tool-btn" type="button" id="stepMeshStudy" title="Solve this location on a coarser and a finer mesh as well, and compare">${uiIco('grading')}Mesh study…</button>
      <button class="tool-btn" type="button" id="stepMeshAcc" title="Refine the mesh until the wet film and contact line stop changing">${uiIco('tolerance')}Mesh to an accuracy…</button>`;
  }
  if (k === 'solve') return `<button id="cfdRunAll" class="btn btn-primary btn-sm tool-run" type="button" title="Solve all four locations (Ctrl+Enter)">${uiIco('play')}Run<span class="hide-mid"> all 4</span></button>
      <button id="cfdCancel" class="tool-btn tool-stop" type="button" hidden>${uiIco('stop')}Stop</button>${sep}${locSegHTML(i)}${sep}
      <label class="vp-ctl">Tolerance <select id="stepTol" aria-label="Newton tolerance">${SOLVER_TOLS.map(t => `<option value="${t}"${t === CFDS.tol ? ' selected' : ''}>${fmtTol(t)}${t === SOLVER_DEFAULTS.tol ? ' (default)' : ''}</option>`).join('')}</select></label>
      <label class="vp-ctl">Iterations <input type="number" id="stepIter" min="10" max="300" step="1" value="${CFDS.maxIter}" aria-label="Newton iterations, at most"></label>`;
  return '';
}
/** Wire the step toolbar (after viewCFD draws it). */
function wireStepTools2D() {
  document.querySelectorAll('[data-steploc]').forEach(b => { b.onclick = () => { FV.stepLoc = +b.dataset.steploc; viewCFD(); }; });
  document.querySelectorAll('[data-stepshape]').forEach(b => { b.onclick = () => { if (CFDG.shape !== b.dataset.stepshape) { CFDG.shape = b.dataset.stepshape; viewCFD(); } }; });
  const dims = document.getElementById('stepDims'); if (dims) dims.onchange = () => { FV.stepDims = dims.checked; renderStepView2D(); };
  const mp = document.getElementById('stepMeshPreset'); if (mp) mp.onchange = () => { const s = document.getElementById('cfdMesh'); s.value = mp.value; s.dispatchEvent(new Event('change')); };
  document.querySelectorAll('[data-meshshow]').forEach(b => { b.onclick = () => { FV.meshShow = b.dataset.meshshow; viewCFD(); }; });
  const sh = document.getElementById('stepMeshShade'); if (sh) sh.onchange = () => { FV.meshShade = sh.checked; renderStepView2D(); };
  const ms = document.getElementById('stepMeshStudy'); if (ms) ms.onclick = () => { FV.dock = 'mesh'; viewCFD(); };
  const ma = document.getElementById('stepMeshAcc'); if (ma) ma.onclick = () => { FV.dock = 'accuracy'; ACC.loc = stepLoc2D(); viewCFD(); };
  const tol = document.getElementById('stepTol'); if (tol) tol.onchange = () => { CFDS.tol = +tol.value; viewCFD(); };
  const it = document.getElementById('stepIter'); if (it) it.onchange = () => {
    const q = SOLVER_INPUTS.find(x => x.k === 'maxIter');
    guardNumber(it, { label: q.l, lo: q.lo, hi: q.hi }, v => { CFDS.maxIter = solverValue(q, v); }); it.value = CFDS.maxIter; viewCFD();
  };
}

// ---- the view of Geometry, Mesh and Solve ----
function renderStepView2D() {
  const host = document.getElementById('cfdStepView');
  if (!host) return;
  const k = step2D();
  if (k === 'geometry') renderGeometry2D(host);
  else if (k === 'mesh') renderMeshStep2D(host);
  else if (k === 'solve') renderSolveStep2D(host);
}

// =====================================================================
// Geometry: the blade to scale
// =====================================================================
/** Location i's blade and gap in mm, the metering edge at x = 0 (upstream negative), y up from the web. */
function bladeMM(i) {
  const g = cfdGeometry(i), round = g.shape === 'round', H = g.H * 1000, R = g.R * 1000, X = round ? g.Xup * 1000 : g.L * 1000;
  const fa = g.exitAngle * Math.PI / 180, face = P.face;
  const h = u => round ? H + R - Math.sqrt(Math.max(0, R * R - u * u)) : H;    // u: distance upstream of the edge
  return { g, round, H, R, X, fa, face, h, hIn: h(X), notch: [face * Math.cos(fa), H + face * Math.sin(fa)], th: locInput(i, 'th'), Ld: Math.max(12, (solverOf(i).ldGaps ?? 8) * H), tf: P.tf };
}
/** The dimensions a drawing can change: their setting, range and step (a drag rounds to the step). */
const DIMS = {
  R: { l: 'Entry radius', u: 'mm', lo: 10, hi: 500, step: 5, get: () => CFDG.R, set: v => { CFDG.R = v; } },
  pool: { l: 'Pool edge upstream', u: 'mm', lo: 5, hi: 150, step: 5, get: () => CFDG.pool, set: v => { CFDG.pool = v; } },
  exitAngle: { l: 'Exit face to the web', u: '°', lo: 30, hi: 150, step: 5, get: () => CFDG.exitAngle, set: v => { CFDG.exitAngle = v; } },
  face: { l: 'Notch face length to corner', u: 'mm', lo: 2, hi: 12, step: 0.5, get: () => P.face, set: v => { P.face = v; }, input: 'face' },
  L: { l: 'Land length', u: 'mm', lo: 3, hi: 25, step: 0.5, get: () => P.L, set: v => { P.L = v; }, input: 'L' },
};
const dimFmt = (k, v) => k === 'exitAngle' ? `${+v.toFixed(1)}°` : `${+v.toFixed(2)} mm`;
/** Commit a dimension (from a drag's end or a typed value): an undo step, the whole page drawn again. */
function setDim(k, v) {
  const d = DIMS[k];
  undoHint(`${d.l}: ${dimFmt(k, d.get())} → ${dimFmt(k, v)}`);
  if (d.input) setInput(d.input, v); else d.set(v);
  if (tab === 4) viewCFD(); else render();
}
/** The drawing's frame: physical box (mm) to the screen (px), true scale, fitted into w x h. */
function drawFrame(b, w, h, pad = { l: 40, r: 30, t: 44, b: 70 }) {
  const x0 = -b.X - 3, x1 = Math.max(b.notch[0], 0) + Math.min(b.Ld, 14), y0 = -b.tf, y1 = Math.max(b.hIn, b.notch[1]) + 2.5;
  const k = Math.min((w - pad.l - pad.r) / (x1 - x0), (h - pad.t - pad.b) / (y1 - y0));
  const ox = pad.l + ((w - pad.l - pad.r) - k * (x1 - x0)) / 2 - k * x0, oy = pad.t + k * y1;
  return { k, x0, x1, y0, y1, X: x => ox + k * x, Y: y => oy - k * y, ux: px => (px - ox) / k, uy: py => (oy - py) / k };
}
/** The blade drawing (SVG): outline, web and fibre, slurry, and (with dims) its dimensions with handles. bc: boundary callouts instead. */
function bladeSVG(i, w, h, { dims = true, bc = null, frame = null } = {}) {
  const b = bladeMM(i), F = frame || drawFrame(b, w, h, bc ? { l: 150, r: 240, t: 52, b: 70 } : undefined), X = F.X, Y = F.Y, f = n => n.toFixed(1);
  let under = '';
  const N = 64;
  for (let n = 0; n <= N; n++) { const u = b.X * (1 - n / N); under += `${n ? 'L' : 'M'}${f(X(-u))} ${f(Y(b.h(u)))} `; }
  const top = F.y1 - 0.6, nx = b.notch[0], ny = b.notch[1];
  const body = `${under}L${f(X(nx))} ${f(Y(ny))} L${f(X(Math.max(nx, 0) + 2))} ${f(Y(ny))} L${f(X(Math.max(nx, 0) + 2))} ${f(Y(top))} L${f(X(-b.X))} ${f(Y(top))} Z`;
  const slurry = `${under}L${f(X(0))} ${f(Y(0))} L${f(X(-b.X))} ${f(Y(0))} Z`;
  const chip = (x, y, lab, val, { anchor = 'start', edit = null, muted = false, cls = '' } = {}) => {
    const wd = 12 + 6.4 * (lab.length + 1) + 7.4 * val.length, xx = anchor === 'end' ? x - wd : anchor === 'middle' ? x - wd / 2 : x;
    return `<g class="dim-chip${edit ? ' dim-edit' : ''}${muted ? ' dim-muted' : ''}${cls ? ' ' + cls : ''}"${edit ? ` data-edit="${edit}" tabindex="0" role="button" aria-label="${escAttr(`${lab} ${val}: change`)}"` : ''}><rect x="${f(xx)}" y="${f(y - 14)}" width="${f(wd)}" height="21" rx="6"/><text x="${f(xx + 7)}" y="${f(y + 1)}">${lab} <tspan class="dim-v">${val}</tspan></text></g>`;
  };
  const handle = (x, y, k, title) => `<circle class="dim-h" data-h="${k}" cx="${f(x)}" cy="${f(y)}" r="6.5" tabindex="-1"><title>${title}</title></circle>`;
  const g = [];
  g.push(`<defs><pattern id="bladeHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" class="hatch"/></pattern></defs>`);
  g.push(`<path class="slurry" d="${slurry}"/>`);
  g.push(`<rect class="fibre" x="${f(X(F.x0))}" y="${f(Y(0))}" width="${f(X(F.x1) - X(F.x0))}" height="${f(Y(-b.tf) - Y(0))}"/>`);
  g.push(`<line class="web" x1="${f(X(F.x0))}" y1="${f(Y(0))}" x2="${f(X(F.x1))}" y2="${f(Y(0))}"/>`);
  g.push(`<path class="blade" d="${body}"/>`);
  // the film region the 2D domain follows (dashed), then the 1D film to the oven
  g.push(`<line class="domain-end" x1="${f(X(b.Ld))}" y1="${f(Y(0))}" x2="${f(X(b.Ld))}" y2="${f(Y(Math.min(b.H * 1.6, F.y1)))}"/>`);
  const scale = [1, 2, 5, 10, 20, 50].find(s => s * F.k > 70) || 50;
  g.push(`<g class="scale-bar"><line x1="${f(X(F.x0) + 4)}" y1="${f(h - 18)}" x2="${f(X(F.x0) + 4 + scale * F.k)}" y2="${f(h - 18)}"/><text x="${f(X(F.x0) + 4)}" y="${f(h - 24)}">${scale} mm · true scale</text></g>`);
  if (dims) {
    const uR = b.X * 0.5, pR = [X(-uR), Y(b.h(uR))];
    if (b.round) {
      g.push(`<line class="leader" x1="${f(pR[0])}" y1="${f(pR[1])}" x2="${f(pR[0] - 20)}" y2="${f(pR[1] - 52)}"/>`);
      g.push(chip(pR[0] - 20, pR[1] - 58, 'R', dimFmt('R', CFDG.R), { anchor: 'middle', edit: 'R' }));
    }
    const yd = Y(0) + 40;
    g.push(`<g class="dimline"><line x1="${f(X(-b.X))}" y1="${f(yd)}" x2="${f(X(0))}" y2="${f(yd)}"/><line x1="${f(X(-b.X))}" y1="${f(yd - 8)}" x2="${f(X(-b.X))}" y2="${f(yd + 8)}"/><line x1="${f(X(0))}" y1="${f(yd - 8)}" x2="${f(X(0))}" y2="${f(yd + 8)}"/></g>`);
    g.push(b.round ? chip(X(-b.X / 2), yd + 6, 'Pool edge', dimFmt('pool', CFDG.pool) + (CFDG.pool > 0.8 * CFDG.R ? ` (0.8 R: ${+b.X.toFixed(1)})` : ''), { anchor: 'middle', edit: 'pool' })
      : chip(X(-b.X / 2), yd + 6, 'Land', dimFmt('L', P.L), { anchor: 'middle', edit: 'L' }));
    g.push(`<line class="gapline" x1="${f(X(0) - 16)}" y1="${f(Y(0))}" x2="${f(X(0) - 16)}" y2="${f(Y(b.H))}"/>`);
    g.push(chip(X(0) - 24, Y(b.H / 2) + 4, `Gap at L${i + 1}`, `${b.H.toFixed(3)} mm`, { anchor: 'end', muted: true, cls: 'dim-info', edit: null }));
    const ar = 26;
    g.push(`<path class="leader" d="M${f(X(0) + ar)} ${f(Y(b.H))} A ${ar} ${ar} 0 0 0 ${f(X(0) + ar * Math.cos(b.fa))} ${f(Y(b.H) - ar * Math.sin(b.fa))}"/>`);
    g.push(chip(X(0) + ar + 10, Y(b.H) + 22, 'Exit face', dimFmt('exitAngle', CFDG.exitAngle), { edit: 'exitAngle' }));
    g.push(chip(X(nx / 2) + 16, Y((b.H + ny) / 2) + 4, 'Notch face', dimFmt('face', P.face), { edit: 'face' }));
    g.push(chip(X(-b.X) + 10, Y(b.hIn * 0.42), 'Inlet height', `${b.hIn.toFixed(2)} mm`, { muted: true }));
    g.push(`<text class="note" x="${f(X(Math.max(nx, 0) + 2) + 8)}" y="${f(Y(ny) + 4)}">notch corner (dry edge)</text>`);
    g.push(`<text class="note" x="${f(X(-b.X) + 10)}" y="${f(Y(b.hIn * 0.14))}">slurry</text>`);
    g.push(`<text class="note" x="${f(X(b.Ld))}" y="${f(Y(0) + 20)}" text-anchor="end">2D domain ends ${+b.Ld.toFixed(1)} mm after the edge ¦</text>`);
    if (b.round) g.push(handle(pR[0], pR[1], 'R', 'Drag up or down: the entry radius'));
    g.push(handle(X(-b.X), Y(b.hIn), b.round ? 'pool' : 'L', b.round ? 'Drag left or right: the pool edge' : 'Drag left or right: the land length'));
    g.push(handle(X(nx), Y(ny), 'notch', 'Drag: the notch face length and the exit face angle'));
  }
  if (bc) g.push(bc(b, F));
  return { svg: `<svg class="blade-svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="min-width:${w}px" role="img" aria-label="Blade profile at location ${i + 1}, to scale">${g.join('')}</svg>`, b, F };
}
function renderGeometry2D(host) {
  const i = stepLoc2D(), b = bladeMM(i), round = b.round;
  const row = (l, v, k) => `<tr><td>${l}</td><td>${k ? `<input type="number" class="geo-in" data-geo="${k}" value="${+DIMS[k].get().toFixed(3)}" min="${DIMS[k].lo}" max="${DIMS[k].hi}" step="${DIMS[k].step}" aria-label="${DIMS[k].l}"><span class="u">${DIMS[k].u}</span>` : v}</td></tr>`;
  host.innerHTML = `<div class="step-view geo-view"><div class="step-draw" id="geoDraw"></div>
    <aside class="step-side"><h4>${uiBadge('shape')}Blade profile</h4><table class="kv">
      <tr><td>Entry</td><td>${round ? 'round' : 'flat land'}</td></tr>
      ${round ? row('Entry radius', '', 'R') + row('Pool edge upstream', '', 'pool') : row('Land length', '', 'L')}
      ${row('Exit face to the web', '', 'exitAngle')}${row('Notch face to corner', '', 'face')}
      <tr><td>Inlet height</td><td>${b.hIn.toFixed(2)} mm</td></tr></table>
      <h4>${uiBadge('height')}Gap and contact angle</h4><table class="kv">${CFD_LOCS.map((l, k) => `<tr${k === i ? ' class="on"' : ''}><td>L${k + 1} · z ${l.z} mm</td><td>${locInput(k, 'gap').toFixed(3)} mm · ${locInput(k, 'th').toFixed(1)}°</td></tr>`).join('')}</table>
      <p class="side-note">Gap = scraper height ${P.Hm.toFixed(2)} − fibre ${P.tf.toFixed(2)} mm, with the variation across the web (Inputs); a location can have its own. The 1D, 2D and 3D all use this blade.</p></aside></div>`;
  drawGeometry2D();
  host.querySelectorAll('.geo-in').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.geo, d = DIMS[k];
    el.id = el.id || 'geo_' + k;
    guardNumber(el, { label: d.l, lo: d.lo, hi: d.hi, unit: d.u }, v => setDim(k, v));
  }));
}
function drawGeometry2D() {
  const host = document.getElementById('geoDraw');
  if (!host) return;
  const i = stepLoc2D(), w = Math.max(640, host.clientWidth), h = Math.max(240, host.clientHeight);
  const d = bladeSVG(i, w, h, { dims: FV.stepDims });
  host.innerHTML = d.svg;
  host._frame = d.F; host._b = d.b;
  wireDims(host, i);
}
/** Click (or Enter) on a value: type a new one; drag a handle: change it, rounded to its step. */
function wireDims(host, i) {
  const svg = host.querySelector('svg');
  const openEdit = g => {
    const k = g.dataset.edit, d = DIMS[k], r = g.getBoundingClientRect(), hr = host.getBoundingClientRect();
    const inp = document.createElement('input');
    Object.assign(inp, { type: 'number', value: +d.get().toFixed(3), min: d.lo, max: d.hi, step: d.step, className: 'dim-input', id: 'dimIn_' + k });
    inp.setAttribute('aria-label', `${d.l} (${d.u})`);
    Object.assign(inp.style, { left: `${r.left - hr.left + host.scrollLeft}px`, top: `${r.top - hr.top + host.scrollTop}px`, width: `${Math.max(90, r.width)}px`, height: `${r.height}px` });
    host.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const close = ok => {
      if (done) return; done = true;
      const v = inp.value;
      inp.remove();
      if (ok) { const t = document.createElement('input'); t.value = v; t.id = 'dimIn_' + k; guardNumber(t, { label: d.l, lo: d.lo, hi: d.hi, unit: d.u }, x => { if (x !== d.get()) setDim(k, x); }); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(true); else if (e.key === 'Escape') close(false); });
    inp.addEventListener('blur', () => close(true));
  };
  svg.querySelectorAll('.dim-edit').forEach(g => {
    g.addEventListener('click', () => openEdit(g));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(g); } });
  });
  svg.querySelectorAll('.dim-h').forEach(c => c.addEventListener('pointerdown', e => {
    e.preventDefault();
    const k = c.dataset.h, F = host._frame, b0 = host._b, start = { R: CFDG.R, pool: CFDG.pool, L: P.L, face: P.face, exitAngle: CFDG.exitAngle };
    const rnd = (key, v) => { const d = DIMS[key]; return Math.min(d.hi, Math.max(d.lo, Math.round(v / d.step) * d.step)); };
    const tip = document.createElement('div'); tip.className = 'dim-tip'; host.appendChild(tip);
    // (the drawing is redrawn while dragging, the handle with it: the window follows the pointer)
    const pid = e.pointerId;
    const move = ev => {
      if (ev.pointerId !== pid) return;
      const r = svg.getBoundingClientRect(), sx = svg.viewBox.baseVal.width / r.width, px = (ev.clientX - r.left) * sx, py = (ev.clientY - r.top) * sx;
      const x = F.ux(px), y = F.uy(py);
      let txt = '';
      if (k === 'R') {
        // the arc through the point dragged, with the edge's lowest point kept: (y - H) = R - sqrt(R^2 - u^2)
        const u = b0.X * 0.5, dy = Math.max(0.05, y - b0.H), R = (dy * dy + u * u) / (2 * dy);
        CFDG.R = rnd('R', R); txt = `R ${CFDG.R} mm`;
      } else if (k === 'pool') { CFDG.pool = rnd('pool', -x); txt = `pool edge ${CFDG.pool} mm`; }
      else if (k === 'L') { P.L = rnd('L', -x); txt = `land ${P.L} mm`; }
      else if (k === 'notch') {
        const dx = x, dyy = y - b0.H, len = Math.hypot(dx, dyy), ang = Math.atan2(dyy, dx) * 180 / Math.PI;
        P.face = rnd('face', len); CFDG.exitAngle = rnd('exitAngle', ang); txt = `face ${P.face} mm at ${CFDG.exitAngle}°`;
      }
      const d = bladeSVG(i, svg.viewBox.baseVal.width, svg.viewBox.baseVal.height, { dims: true, frame: F });   // (the same frame: the handle stays under the pointer)
      svg.innerHTML = d.svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
      tip.textContent = txt; tip.style.left = `${ev.clientX - host.getBoundingClientRect().left + host.scrollLeft + 14}px`; tip.style.top = `${ev.clientY - host.getBoundingClientRect().top - 30}px`;
    };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); tip.remove();
      const now = { R: CFDG.R, pool: CFDG.pool, L: P.L, face: P.face, exitAngle: CFDG.exitAngle };
      Object.assign(CFDG, { R: start.R, pool: start.pool, exitAngle: start.exitAngle }); P.L = start.L; P.face = start.face;
      const changed = Object.keys(now).filter(q => now[q] !== start[q]);
      if (!changed.length) { drawGeometry2D(); return; }
      undoHint(changed.map(q => `${DIMS[q].l}: ${dimFmt(q, start[q])} → ${dimFmt(q, now[q])}`).join('; '));
      for (const q of changed) { if (DIMS[q].input) setInput(DIMS[q].input, now[q]); else DIMS[q].set(now[q]); }
      if (tab === 4) viewCFD(); else render();
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }));
}
/** The Dimensions tab: each location's blade, gap and contact angle. */
function renderDims2D() {
  const host = document.getElementById('cfdDims');
  if (!host) return;
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table nowrap-table"><thead><tr><th>Location</th><th>z (mm)</th><th>Blade</th><th>Exit face (°)</th><th>Notch face (mm)</th><th>Gap at the edge (mm)</th><th>Inlet height (mm)</th><th>Contact angle (°)</th><th>Own inputs</th></tr></thead><tbody>${CFD_LOCS.map((l, i) => {
    const b = bladeMM(i), own = Object.keys(l.over);
    return `<tr><td>L${i + 1}</td><td>${l.z}</td><td>${b.round ? `round R ${CFDG.R}, pool ${+b.X.toFixed(1)} mm` : `flat land ${P.L} mm`}</td><td>${CFDG.exitAngle}</td><td>${P.face}</td><td>${b.H.toFixed(3)}</td><td>${b.hIn.toFixed(2)}</td><td>${b.th.toFixed(1)}</td><td>${own.length ? own.map(k => LOC_INPUTS.find(q => q.k === k).l.toLowerCase()).join(', ') : 'none'}</td></tr>`;
  }).join('')}</tbody></table></div><p class="fv-note">The blade is the same at every location; the gap and contact angle vary across the web with the inputs under Variation across the web, or a location's own values (Locations across the web, its inputs button).</p>`;
}

// =====================================================================
// Mesh: the mesh the solve starts on (not solved), or the solved one
// =====================================================================
const MESH_PV = { worker: null, job: null, queue: [], pending: new Set(), byLoc: CFD_LOCS.map(() => null) };
/** What decides location i's starting mesh: everything the worker is sent. */
const meshPvKey = i => { try { return JSON.stringify(cfdWorkerMessage(cfdGeometry(i))); } catch (e) { return 'x' + i; } };
/** Lay out a starting mesh in the worker kept for it: jobs one at a time, in order; job.done(message) with the answer. */
function meshPvQueue(job) {
  if (MESH_PV.pending.has(job.key)) return;
  MESH_PV.pending.add(job.key); MESH_PV.queue.push(job); meshPvPump();
}
function meshPvPump() {
  if (MESH_PV.job || !MESH_PV.queue.length) return;
  if (!MESH_PV.worker) {
    try { MESH_PV.worker = makeWorker('cfd-worker.js'); } catch (e) { const job = MESH_PV.queue.shift(); MESH_PV.pending.delete(job.key); job.done({ ok: false, error: e.message }); return; }
    const end = d => { const job = MESH_PV.job; MESH_PV.job = null; if (job) { MESH_PV.pending.delete(job.key); job.done(d); } meshPvPump(); };
    MESH_PV.worker.onmessage = ev => end(ev.data);
    MESH_PV.worker.onerror = ev => end({ ok: false, error: ev.message || 'worker error' });
  }
  MESH_PV.job = MESH_PV.queue.shift();
  MESH_PV.worker.postMessage({ ...MESH_PV.job.msg, preview: MESH_PV.job.key });
}
/** The four locations' starting meshes that are missing or out of date. */
function requestMeshPreviews() {
  CFD_LOCS.forEach((_, i) => {
    const key = meshPvKey(i), c = MESH_PV.byLoc[i];
    if (c && c.key === key) return;
    if (checkLocation(i).some(p => p.level === 'error' && GEO_CODES.includes(p.code))) { MESH_PV.byLoc[i] = { key, error: 'fix the geometry first' }; return; }
    const geo = cfdGeometry(i);
    meshPvQueue({ key, msg: cfdWorkerMessage(geo), done: d => {
      if (d.ok && d.preview === key) {
        const run = { field: makeFlowField(d.result, { rho: geo.rho, ty: geo.ty }), result: d.result, geo, preview: true };
        MESH_PV.byLoc[i] = { key, run, stats: meshStats(run.field) };
      } else MESH_PV.byLoc[i] = { key, error: d.error || 'no mesh' };
      if (tab === 4 && document.getElementById('cfdWb')) { renderStepBar2D(); if (step2D() === 'mesh') { renderStepView2D(); renderMeshLocs2D(); } }
    } });
  });
}
/** Which mesh the Mesh step shows at location i: the solved one when chosen and up to date, else the starting one. */
const meshShowOf2D = i => FV.meshShow === 'solved' && cfdRuns[i].field && !cfdIsStale(i) ? 'solved' : 'start';
/** Location i's mesh as shown: { run, stats, solved } (or { error }), or null while it is laid out. */
function meshShown2D(i) {
  if (meshShowOf2D(i) === 'solved') { const r = cfdRuns[i], f = r.field; return { run: r, stats: f._stats || (f._stats = meshStats(f)), solved: true }; }
  const c = MESH_PV.byLoc[i];
  if (!c || c.key !== meshPvKey(i)) return null;
  return c.error ? { error: c.error } : { run: c.run, stats: c.stats, solved: false };
}
/** A mesh's numbers: elements and nodes, shape quality (worst, mean, a histogram, how many poor), aspect ratio, shortest edge. */
function meshStats(f) {
  const q = meshQuality(f), v = q.q, n = v.length;
  let sum = 0, below = 0;
  const hist = new Array(10).fill(0);
  for (const x of v) { sum += x; if (x < 0.5) below++; hist[Math.min(9, Math.max(0, Math.floor(x * 10)))]++; }
  let ar = 0, arAt = 0, lmin = Infinity;
  for (let ey = 0; ey < q.nEy; ey++) for (let ex = 0; ex < q.nEx; ex++) {
    const c = [[0, 0], [2, 0], [2, 2], [0, 2]].map(([a, b]) => (2 * ey + b) * f.nx + 2 * ex + a);
    const L = [0, 1, 2, 3].map(t => Math.hypot(f.gx[c[(t + 1) % 4]] - f.gx[c[t]], f.gy[c[(t + 1) % 4]] - f.gy[c[t]]));
    const r = Math.max(...L) / Math.min(...L);
    if (r > ar) { ar = r; arAt = ey * q.nEx + ex; }
    lmin = Math.min(lmin, ...L);
  }
  const col = e => 2 * (e % q.nEx) + 1, where = e => col(e) < f.iCorner ? 'under the blade' : col(e) < f.iCL ? 'on the exit face' : 'along the free surface';
  const nB = f.iCorner / 2, nF = (f.iCL - f.iCorner) / 2, nS = (f.nx - 1 - f.iCL) / 2;
  return { nEx: q.nEx, nEy: q.nEy, elements: n, nB, nF, nS, nodesV: f.nx * f.ny, nodesP: (q.nEx + 1) * (q.nEy + 1), worst: q.worst, worstAt: q.worstAt, worstWhere: where(q.worstAt), mean: sum / n, below, hist, ar, arAt, arWhere: where(arAt), lmin };
}
/** An element's middle and size (m), to zoom onto it. */
function elementBox(f, e, nEx) {
  const ex = e % nEx, ey = Math.floor(e / nEx), ks = [];
  for (let b = 0; b <= 2; b++) for (let a = 0; a <= 2; a++) ks.push((2 * ey + b) * f.nx + 2 * ex + a);
  const xs = ks.map(k => f.gx[k]), ys = ks.map(k => f.gy[k]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
const zoomCtlHTML = (i, withImg = true) => `<div class="zoom-ctl" role="toolbar" aria-label="Zoom, location ${i + 1}">
    <button type="button" class="zb" data-z="in" title="Zoom in" aria-label="Zoom in"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    <button type="button" class="zb" data-z="out" title="Zoom out" aria-label="Zoom out"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    <button type="button" class="zb" data-z="fit" title="Fit the whole domain" aria-label="Fit the whole domain"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    <span class="zb-sep" aria-hidden="true"></span>
    <button type="button" class="zb zb-t" data-z="edge" title="Zoom to the metering edge">${uiIco('zoom')}Edge</button>
    <button type="button" class="zb zb-t" data-z="meniscus" title="Zoom to the exit face, contact line and free surface">${uiIco('zoom')}Meniscus</button>
    <span class="zb-sep" aria-hidden="true"></span>
    <button type="button" class="zb" data-z="box" aria-pressed="${FV.boxZoom}" title="Box zoom: drag a rectangle (also Shift+drag)" aria-label="Box zoom"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="9" height="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 1.6"/><path d="M10.5 9.5l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    ${withImg ? `<button type="button" class="zb" data-z="img" title="Save the plot as an image" aria-label="Save as image">${CAMERA_SVG}</button>` : ''}
  </div>`;
function renderMeshStep2D(host) {
  const i = stepLoc2D(), l = CFD_LOCS[i];
  let m = meshShown2D(i);
  // (while a changed mesh is laid out again, the last one stays up, marked)
  const last = MESH_PV.byLoc[i];
  if (!m && last && !last.error && meshShowOf2D(i) !== 'solved') { m = { run: last.run, stats: last.stats, solved: false, stale: true }; requestMeshPreviews(); }
  if (!m) { host.innerHTML = `<div class="step-view"><p class="cap fv-empty"><i class="spin" aria-hidden="true"></i>Laying out the mesh at L${i + 1}…</p></div>`; requestMeshPreviews(); return; }
  if (m.error) { host.innerHTML = `<div class="step-view">${emptyHint(`No mesh at L${i + 1}`, `The mesher could not lay out this geometry: ${escAttr(m.error)}. See Problems, or change the geometry.`)}</div>`; return; }
  const s = m.stats, hmax = Math.max(...s.hist, 1);
  host.innerHTML = `<div class="step-view mesh-view"><div class="step-draw" id="cfdMeshPlot">
      <div class="fv-caption">L${i + 1} · z = ${l.z} mm · ${m.solved ? 'solved mesh' : m.stale ? '<i class="spin" aria-hidden="true"></i>laying the mesh out again' : 'starting mesh (not solved)'}: ${s.nEx} × ${s.nEy} elements · <span class="fv-ex"></span></div>
      <div class="fv-plot" data-i="${i}" data-zk="m${i}"><canvas class="fv-main" role="img" aria-label="Mesh at location ${i + 1}"></canvas><canvas class="fv-over" aria-hidden="true"></canvas>${zoomCtlHTML(i, false)}<div class="fv-tip" hidden></div></div>
    </div>
    <aside class="step-side">${zonesPanelHTML(s, i)}<h4>${uiBadge('mesh')}Mesh at L${i + 1}${m.solved ? '' : ' (before solving)'}</h4><table class="kv">
      <tr><td>Elements</td><td>${s.nEx} × ${s.nEy} = ${s.elements}</td></tr>
      <tr><td>Along blade + face + surface</td><td>${s.nB} + ${s.nF} + ${s.nS}</td></tr>
      <tr><td>Nodes, velocity / pressure</td><td>${s.nodesV.toLocaleString()} / ${s.nodesP.toLocaleString()}</td></tr>
      <tr><td>Quality, worst</td><td>${s.worst.toFixed(2)}</td></tr><tr><td>Quality, mean</td><td>${s.mean.toFixed(2)}</td></tr>
      <tr><td>Aspect ratio, worst</td><td>${s.ar.toFixed(1)}</td></tr><tr><td>Shortest element edge</td><td>${(s.lmin * 1000).toFixed(3)} mm</td></tr></table>
      <div class="q-hist" aria-label="Quality histogram, 0 to 1">${s.hist.map((n, k) => `<i style="height:${Math.max(2, 46 * n / hmax)}px" title="${k / 10}–${(k + 1) / 10}: ${n} element${n === 1 ? '' : 's'}"></i>`).join('')}</div>
      <div class="q-axis"><span>quality 0</span><span>1</span></div>
      <p class="side-note">${s.below ? `<span class="warn-text">${s.below} element${s.below > 1 ? 's' : ''} below 0.5.</span> ` : ''}Worst ${s.worstWhere} <button type="button" class="linkish" id="meshShowWorst">show</button></p>
      <p class="side-note">Quality: each element's smallest over largest Jacobian of its quadratic map (1 = undistorted, 0 = degenerate).${m.solved ? '' : ' The surface starts on the static meniscus with the contact line at the edge; as it is solved the surface moves, and if the contact line climbs the face, elements are added there.'}</p>
      <p class="side-note">Element counts and grading: Inputs › Solver and mesh; this location's own: its inputs button. Refinement zones apply at every location.</p></aside></div>`;
  const el = host.querySelector('.fv-plot'), plot = host.querySelector('#cfdMeshPlot'), cap = plot.querySelector('.fv-caption');
  const maxH = plot.clientHeight - cap.offsetHeight - 8;
  el._ctx = { compare: false, list: [i], maxH: maxH > 150 ? maxH : null, fields: [m.run.field], runs: { [i]: m.run }, meshOnly: true, quality: FV.meshShade, shared: { base: null, line: null, speed: null }, yMax: m.run.field.Ly, vmax: 0,
    onPainted: (e, map) => drawZoneLayer(e, map, i) };
  paintPlot(el, false);
  wirePlotZoom(el);
  wireZonesPanel(host.querySelector('.step-side'), i);
  document.getElementById('meshShowWorst').onclick = () => {
    const bx = elementBox(m.run.field, s.worstAt, s.nEx), cx = (bx.x0 + bx.x1) / 2, cy = (bx.y0 + bx.y1) / 2, r = Math.max(bx.x1 - bx.x0, bx.y1 - bx.y0) * 4;
    FV.zoom['m' + i] = { x0: cx - r, x1: cx + r, y0: Math.max(0, cy - r / 2), y1: cy + r / 2 };
    paintPlot(el, false);
  };
}
// ---- refinement zones: element sizes at the flow's features, bands along the flow, layers at the walls ----
/**
 * The zones (in the shared solver settings, mm): the metering edge, the contact line, the exit face and the film
 * each with an element size; layers at the web and at the blade / face / surface (how many, the first one's
 * thickness at the edge, their growth); bands along the flow (x from the inlet) with an element size; how fast
 * the size grows away from a zone. The mesh is structured, so a band covers the gap's full height and a layer
 * runs the full length. Nothing on: the mesh the counts and grading lay out, unchanged.
 */
const ZONE_DEFAULTS = { edge: { on: false, size: 0.05 }, cl: { on: false, size: 0.05 }, face: { on: false, size: 0.1 }, film: { on: false, size: 0.5 },
  web: { on: false, n: 3, first: 0.02, growth: 1.3 }, top: { on: false, n: 3, first: 0.02, growth: 1.3 }, bands: [], growth: 1.2 };
const ZONE_FEATURES = [['edge', 'Metering edge', 'around the edge corner'], ['cl', 'Contact line', 'around the contact line'],
  ['face', 'Exit face', 'along the exit face, when the contact line climbs it'], ['film', 'Film', 'along the free surface']];
const ZONE_LAYERS = [['web', 'Layers at the web', 'the web'], ['top', 'Layers at the blade and surface', 'the blade, the exit face and the free surface']];
const ZONE_LIM = { size: [0.002, 5, 'mm'], n: [1, 12, ''], first: [0.001, 0.5, 'mm'], growth: [1.05, 2, ''], x: [0, 500, 'mm'] };
/** The zones with every setting filled in (a copy). */
function zonesOf(z = CFDS.zones) {
  const d = JSON.parse(JSON.stringify(ZONE_DEFAULTS));
  if (!z) return d;
  for (const k of Object.keys(d)) if (z[k] != null) d[k] = k === 'bands' ? z.bands.map(b => ({ ...b })) : typeof d[k] === 'object' ? { ...d[k], ...z[k] } : z[k];
  return d;
}
const zonesActive = z => !!z && ([...ZONE_FEATURES, ...ZONE_LAYERS].some(([k]) => z[k] && z[k].on) || (z.bands || []).length > 0);
/** The zones as the solver takes them (m), or null when none is on. */
function zonesForSolver(zs) {
  const z = zonesOf(zs);
  if (!zonesActive(z)) return null;
  const mm = v => v / 1000, o = { growth: z.growth };
  for (const [k] of ZONE_FEATURES) if (z[k].on) o[k] = mm(z[k].size);
  for (const [k] of ZONE_LAYERS) if (z[k].on) o[k] = { n: z[k].n, first: mm(z[k].first), growth: z[k].growth };
  if (z.bands.length) o.bands = z.bands.map(b => ({ x0: mm(Math.min(b.x0, b.x1)), x1: mm(Math.max(b.x0, b.x1)), size: mm(b.size) }));
  return o;
}
/** Solver zones (m) for a mesh f times finer: sizes and first layers over f (a mesh study, refining everywhere). */
function scaleZones(zm, f) {
  if (!zm) return zm;
  const o = { ...zm };
  for (const [k] of ZONE_FEATURES) if (o[k] != null) o[k] = o[k] / f;
  for (const [k] of ZONE_LAYERS) if (o[k]) o[k] = { ...o[k], first: o[k].first / f };
  if (o.bands) o.bands = o.bands.map(b => ({ ...b, size: b.size / f }));
  return o;
}
/** The zones in a few words (undo, the report, the model tree). */
function zonesText(zs) {
  const z = zonesOf(zs), f = v => String(+(+v).toFixed(3));
  if (!zonesActive(z)) return 'none';
  return [...ZONE_FEATURES.filter(([k]) => z[k].on).map(([k, l]) => `${l.toLowerCase()} ${f(z[k].size)} mm`),
    ...ZONE_LAYERS.filter(([k]) => z[k].on).map(([k, l]) => `${l.toLowerCase().replace('layers', `${z[k].n} layers`)} from ${f(z[k].first)} mm ×${f(z[k].growth)}`),
    ...z.bands.map((b, n) => `band ${n + 1}: x ${f(Math.min(b.x0, b.x1))}–${f(Math.max(b.x0, b.x1))} mm at ${f(b.size)} mm`)].join('; ');
}
/** Change the zones (one undo step), then lay the meshes out again. */
function setZones(z, hint) {
  undoHint(hint);
  CFDS.zones = z;
  if (tab === 4) viewCFD(); else render();
}
const zoneNum = (id, v, lim, step, label) => `<input type="number" class="zone-in" id="${id}" value="${+(+v).toFixed(4)}" min="${lim[0]}" max="${lim[1]}" step="${step}" aria-label="${label}">`;
/** The zones panel (the Mesh step's side). */
function zonesPanelHTML(stats, i) {
  const z = zonesOf(), on = zonesActive(z);
  // (the solve's time grows with the columns and about the cube of the rows: the banded solve's cost)
  let slower = 0;
  if (on && stats) {
    const c = cfdGeometry(i).solver, nx0 = c.nEb + (stats.nF ? c.nEf : 0) + c.nEs;
    slower = (stats.nEx / nx0) * Math.pow((2 * stats.nEy + 1) / (2 * c.nEy + 1), 3);
  }
  const feat = ZONE_FEATURES.map(([k, l, where]) => `<tr${z[k].on ? ' class="on"' : ''}><td><label class="zone-chk"><input type="checkbox" data-zone-on="${k}"${z[k].on ? ' checked' : ''}><span title="Elements of about this size ${where}">${l}</span></label></td>
    <td>${zoneNum('zn_' + k, z[k].size, ZONE_LIM.size, 0.01, `${l}: element size, mm`)}<span class="u">mm</span></td></tr>`).join('');
  const lay = ZONE_LAYERS.map(([k, l, where]) => `<tr${z[k].on ? ' class="on"' : ''}><td colspan="2"><label class="zone-chk"><input type="checkbox" data-zone-on="${k}"${z[k].on ? ' checked' : ''}><span title="Thin rows along ${where}">${l}</span></label>
    <div class="zone-sub">${zoneNum(`zn_${k}_n`, z[k].n, ZONE_LIM.n, 1, `${l}: how many`)} · first ${zoneNum(`zn_${k}_first`, z[k].first, ZONE_LIM.first, 0.005, `${l}: first layer at the edge, mm`)} mm · ×${zoneNum(`zn_${k}_growth`, z[k].growth, ZONE_LIM.growth, 0.05, `${l}: growth from layer to layer`)}</div></td></tr>`).join('');
  const bands = z.bands.map((b, n) => `<div class="band-row" data-band="${n}"><b>Band ${n + 1}</b><span>x ${zoneNum(`zb_${n}_x0`, b.x0, ZONE_LIM.x, 0.5, `Band ${n + 1}: from x, mm`)} to ${zoneNum(`zb_${n}_x1`, b.x1, ZONE_LIM.x, 0.5, `Band ${n + 1}: to x, mm`)} mm</span>
    <span>elements ${zoneNum(`zb_${n}_size`, b.size, ZONE_LIM.size, 0.01, `Band ${n + 1}: element size, mm`)} mm</span>
    <button type="button" class="icon-btn band-del" data-band-del="${n}" title="Remove band ${n + 1}" aria-label="Remove band ${n + 1}">${uiIco('trash')}</button></div>`).join('');
  return `<h4>${uiBadge('grading')}Refinement zones</h4>
    <table class="kv zone-table">${feat}${lay}</table>
    <div class="band-list">${bands}<button type="button" class="btn btn-secondary btn-sm" id="zoneAddBand">${uiIco('plus')}Band</button><span class="side-note-i">Drag a band's ends on the drawing.</span></div>
    <p class="side-note"><label>Growth away from a zone ×${zoneNum('zn_growth', z.growth, ZONE_LIM.growth, 0.05, 'Element size growth away from a zone')}</label></p>
    <p class="side-note">${on ? `Mesh with the zones: <b>${stats ? `${stats.nB} + ${stats.nF} + ${stats.nS} by ${stats.nEy}` : '…'}</b> elements.${slower >= 1.5 ? ` <span class="${slower >= 8 ? 'warn-text' : ''}">A solve takes about ${slower >= 10 ? Math.round(slower) : slower.toFixed(1)} times as long as without zones${slower >= 8 ? ' (rows across the gap cost the most)' : ''}.</span>` : ''}` : 'No zone on: the mesh is the one the element counts and grading lay out.'} A zone only makes elements smaller; the mesh stays structured, so a band covers the gap's full height and a layer runs the full length.</p>`;
}
/** The zones panel's controls: tick a zone, type its size, add or remove a band. */
function wireZonesPanel(host, i) {
  const z = () => zonesOf();
  host.querySelectorAll('[data-zone-on]').forEach(cb => cb.onchange = () => {
    const k = cb.dataset.zoneOn, n = z(), l = [...ZONE_FEATURES, ...ZONE_LAYERS].find(q => q[0] === k)[1];
    n[k].on = cb.checked; setZones(n, `${l} zone ${cb.checked ? 'on' : 'off'}`);
  });
  const num = (id, lim, label, apply) => {
    const el = host.querySelector('#' + id);
    if (el) el.onchange = () => guardNumber(el, { label, lo: lim[0], hi: lim[1], unit: lim[2] }, v => apply(v));
  };
  for (const [k, l] of ZONE_FEATURES) num('zn_' + k, ZONE_LIM.size, `${l} zone: element size`, v => { const n = z(); n[k].size = v; n[k].on = true; setZones(n, `${l} zone: ${v} mm`); });
  for (const [k, l] of ZONE_LAYERS) {
    num(`zn_${k}_n`, ZONE_LIM.n, `${l}: how many`, v => { const n = z(); n[k].n = Math.round(v); n[k].on = true; setZones(n, `${l}: ${Math.round(v)}`); });
    num(`zn_${k}_first`, ZONE_LIM.first, `${l}: first layer`, v => { const n = z(); n[k].first = v; n[k].on = true; setZones(n, `${l}: first ${v} mm`); });
    num(`zn_${k}_growth`, ZONE_LIM.growth, `${l}: growth`, v => { const n = z(); n[k].growth = v; n[k].on = true; setZones(n, `${l}: growth ×${v}`); });
  }
  num('zn_growth', ZONE_LIM.growth, 'Growth away from a zone', v => { const n = z(); n.growth = v; setZones(n, `Zone growth ×${v}`); });
  z().bands.forEach((b, j) => {
    for (const e of ['x0', 'x1']) num(`zb_${j}_${e}`, ZONE_LIM.x, `Band ${j + 1}: ${e === 'x0' ? 'from' : 'to'} x`, v => { const n = z(); n.bands[j][e] = v; setZones(n, `Band ${j + 1}: ${e === 'x0' ? 'from' : 'to'} x ${v} mm`); });
    num(`zb_${j}_size`, ZONE_LIM.size, `Band ${j + 1}: element size`, v => { const n = z(); n.bands[j].size = v; setZones(n, `Band ${j + 1}: ${v} mm`); });
  });
  host.querySelectorAll('[data-band-del]').forEach(b => b.onclick = () => { const n = z(), j = +b.dataset.bandDel; n.bands.splice(j, 1); setZones(n, `Remove band ${j + 1}`); });
  const add = host.querySelector('#zoneAddBand');
  if (add) add.onclick = () => {
    // (a new band: the middle of the view shown, else the last 4 mm up to the edge)
    const el = document.querySelector('#cfdMeshPlot .fv-plot'), v = el && el._map && FV.zoom['m' + i] ? el._map.view : null, f = el && el._ctx ? el._ctx.fields[0] : null;
    const xe = f && f.iCorner != null ? f.gx[(f.ny - 1) * f.nx + f.iCorner] * 1000 : 40;
    const [a, b] = v ? [(v.x0 + 0.35 * (v.x1 - v.x0)) * 1000, (v.x0 + 0.65 * (v.x1 - v.x0)) * 1000] : [xe - 4, xe];
    const n = z(); n.bands.push({ x0: +a.toFixed(2), x1: +b.toFixed(2), size: 0.1 });
    setZones(n, `Add band ${n.bands.length}`);
  };
}
/** The zones drawn on the mesh (the Mesh step's plot): bands with their ends to drag, the feature zones and layers marked. */
function drawZoneLayer(el, map, i) {
  let svg = el.querySelector('svg.zone-layer');
  if (!svg) { svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'zone-layer'); el.appendChild(svg); }
  const cv = el.querySelector('.fv-main'), W = cv.clientWidth, H = cv.clientHeight, p = map.plot, f = el._ctx.fields[0], z = el._zonesDrag || zonesOf();
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const X = xm => map.toScreen(xm / 1000, 0)[0], top = k => [f.gx[(f.ny - 1) * f.nx + k], f.gy[(f.ny - 1) * f.nx + k]];
  const clip = `<clipPath id="zoneClip${i}"><rect x="${p.l}" y="${p.t}" width="${p.r - p.l}" height="${p.b - p.t}"/></clipPath>`;
  let g = '';
  // layers: a strip along the web / along the top boundary
  if (z.web.on) g += `<line class="zl-layer" x1="${p.l}" x2="${p.r}" y1="${map.toScreen(0, 0)[1]}" y2="${map.toScreen(0, 0)[1]}"/>`;
  if (z.top.on) { let d = ''; for (let k = 0; k < f.nx; k++) { const [x, y] = map.toScreen(...top(k)); d += (k ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); } g += `<path class="zl-layer" d="${d}"/>`; }
  // feature zones
  const dot = (k, cls) => { const [x, y] = map.toScreen(...top(k)); return `<circle class="zl-feat ${cls}" cx="${x}" cy="${y}" r="16"/>`; };
  if (z.edge.on && f.iCorner != null) g += dot(f.iCorner, 'zl-edge');
  if (z.cl.on && f.iCL != null) g += dot(f.iCL, 'zl-cl');
  if (z.face.on && f.iCL > f.iCorner) { const [x0, y0] = map.toScreen(...top(f.iCorner)), [x1, y1] = map.toScreen(...top(f.iCL)); g += `<line class="zl-face" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`; }
  if (z.film.on && f.iCL != null) { let d = ''; for (let k = f.iCL; k < f.nx; k++) { const [x, y] = map.toScreen(...top(k)); d += (k > f.iCL ? 'L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1); } g += `<path class="zl-film" d="${d}"/>`; }
  // bands, with their ends to drag
  const mid = (p.t + p.b) / 2;
  z.bands.forEach((b, j) => {
    const a = X(Math.min(b.x0, b.x1)), c = X(Math.max(b.x0, b.x1));
    g += `<rect class="zl-band" x="${a}" y="${p.t}" width="${Math.max(1, c - a)}" height="${p.b - p.t}"/><text class="zl-t" x="${a + 4}" y="${mid - 14}">Band ${j + 1} · ${+(+b.size).toFixed(3)} mm</text>`;
    for (const e of ['x0', 'x1']) g += `<circle class="zl-h" cx="${X(b[e])}" cy="${mid}" r="7" data-band="${j}" data-end="${e}" tabindex="0" role="slider" aria-label="Band ${j + 1}: ${e === 'x0' ? 'from' : 'to'} x" aria-valuenow="${b[e]}"><title>Band ${j + 1}: drag to set where it ${e === 'x0' ? 'starts' : 'ends'} (x ${b[e]} mm)</title></circle>`;
  });
  svg.innerHTML = `<defs>${clip}</defs><g clip-path="url(#zoneClip${i})">${g}</g>`;
  // dragging a band's end: the drawing follows; the value is set (one undo step) when it is let go
  svg.querySelectorAll('.zl-h').forEach(h => h.onpointerdown = e => {
    e.preventDefault(); e.stopPropagation();
    const j = +h.dataset.band, end = h.dataset.end, pid = e.pointerId, zz = zonesOf(), r = cv.getBoundingClientRect();
    el._zonesDrag = zz;
    const move = ev => { if (ev.pointerId !== pid) return; const xm = map.toPhysAny(ev.clientX - r.left, ev.clientY - r.top)[0] * 1000; zz.bands[j][end] = +Math.max(0, xm).toFixed(2); drawZoneLayer(el, map, i); };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      el._zonesDrag = null;
      setZones(zz, `Band ${j + 1}: ${end === 'x0' ? 'from' : 'to'} x ${zz.bands[j][end]} mm`);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
  // (arrow keys move a focused end by 0.5 mm, shift by 5 mm)
  svg.querySelectorAll('.zl-h').forEach(h => h.onkeydown = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const j = +h.dataset.band, end = h.dataset.end, zz = zonesOf(), d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : 0.5);
    zz.bands[j][end] = +Math.max(0, zz.bands[j][end] + d).toFixed(2);
    setZones(zz, `Band ${j + 1}: ${end === 'x0' ? 'from' : 'to'} x ${zz.bands[j][end]} mm`);
    const again = document.querySelector(`#cfdMeshPlot .zl-h[data-band="${j}"][data-end="${end}"]`); if (again) again.focus();
  });
}

/** The Mesh tab of the four locations. */
function renderMeshLocs2D() {
  const host = document.getElementById('cfdMeshLocs');
  if (!host) return;
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table nowrap-table"><thead><tr><th>Location</th><th>Mesh</th><th>Elements</th><th>Blade + face + surface × gap</th><th>Nodes (velocity / pressure)</th><th>Quality worst</th><th>Quality mean</th><th>Below 0.5</th><th>Aspect ratio worst</th><th>Shortest edge (mm)</th></tr></thead><tbody>${CFD_LOCS.map((_, i) => {
    const m = meshShown2D(i);
    if (!m) return `<tr><td>L${i + 1}</td><td colspan="9">laying out…</td></tr>`;
    if (m.error) return `<tr><td>L${i + 1}</td><td colspan="9" class="warn-text">${escAttr(m.error)}</td></tr>`;
    const s = m.stats;
    return `<tr><td>L${i + 1}</td><td>${m.solved ? 'solved' : 'starting'}</td><td>${s.elements}</td><td>${s.nB} + ${s.nF} + ${s.nS} × ${s.nEy}</td><td>${s.nodesV.toLocaleString()} / ${s.nodesP.toLocaleString()}</td><td>${s.worst.toFixed(2)}</td><td>${s.mean.toFixed(2)}</td><td>${s.below}</td><td>${s.ar.toFixed(1)}</td><td>${(s.lmin * 1000).toFixed(3)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

// =====================================================================
// Solve: the boundary conditions on the domain, and Run
// =====================================================================
/** The values a boundary condition can change: the location's own value when it has one, else the shared input. */
const BC_INPUT = {
  Pup: { l: 'Bead pressure', u: 'kPa', loc: 'Pup' }, U: { l: 'Web speed', u: 'm/min', loc: 'U' }, th: { l: 'Contact angle on blade', u: '°', loc: 'th' }, g: { l: 'Surface tension', u: 'N/m', loc: 'g' },
};
function bcValue(i, k) {
  const own = CFD_LOCS[i].over[k] != null, c = CFG.find(q => q.k === k), q = LOC_INPUTS.find(x => x.k === BC_INPUT[k].loc);
  return { own, v: locInput(i, k), shared: P[k], lo: own ? q.lo : c.min, hi: own ? q.hi : c.max, d: own ? q.d : c.d };
}
function setBc(i, k, v) {
  const b = bcValue(i, k), lab = BC_INPUT[k].l;
  undoHint(`${b.own ? `L${i + 1} ` : ''}${lab.toLowerCase()}: ${b.own ? b.v : b.shared} → ${v} ${BC_INPUT[k].u}`);
  if (b.own) CFD_LOCS[i].over[k] = v; else setInput(k, v);
  if (tab === 4) viewCFD(); else render();
}
function bcCallouts(i) {
  return (b, F) => {
    const X = F.X, Y = F.Y, f = n => n.toFixed(1), sl = fibreSlip();
    const val = (k, fmt) => { const v = bcValue(i, k); return `<tspan class="dim-v bc-edit" data-bc="${k}" tabindex="0" role="button" aria-label="${escAttr(`${BC_INPUT[k].l} ${fmt(v.v)}: change`)}">${fmt(v.v)}</tspan>${v.own ? `<tspan class="bc-own"> L${i + 1}'s own</tspan>` : ''}`; };
    const out = [];
    const line = (cls, x1, y1, x2, y2) => out.push(`<line class="bc-line ${cls}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`);
    const text = (x, y, anchor, cls, html) => out.push(`<text class="bc-t" x="${f(x)}" y="${f(y)}" text-anchor="${anchor}"><tspan class="bc-name ${cls}">${html[0]}</tspan>${html[1] ? ` ${html[1]}` : ''}</text>`);
    const lead = (x1, y1, x2, y2) => out.push(`<line class="bc-lead" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`);
    const xs = X(0), xo = X(b.Ld), fh = b.H * 0.92, xr = X(F.x1) + 14;
    // inlet (left of it)
    line('bc-in', X(-b.X), Y(0), X(-b.X), Y(b.hIn));
    text(X(-b.X) - 10, Y(b.hIn / 2) - 6, 'end', 'c-in', ['Inlet']);
    text(X(-b.X) - 10, Y(b.hIn / 2) + 10, 'end', '', ['', `p ${val('Pup', v => `${v.toFixed(2)} kPa`)}`]);
    // blade (above it)
    text(X(-b.X * 0.5), Y(F.y1) - 12, 'middle', 'c-blade', ['Blade', '<tspan class="bc-sub">no slip, fixed</tspan>']);
    // web (below it)
    line('bc-web', X(F.x0), Y(0), X(F.x1), Y(0));
    text(X(-b.X * 0.5), Y(-b.tf) + 22, 'middle', 'c-web', ['Web', `${val('U', v => `${v.toFixed(2)} m/min`)} →<tspan class="bc-sub"> · slip b ${(sl.b * 1e6).toFixed(1)} µm</tspan>`]);
    // exit face, free surface, outlet (right of the domain, each with a leader)
    const faceMid = [(0 + b.notch[0]) / 2, (b.H + b.notch[1]) / 2];
    line('bc-face', xs, Y(b.H), X(b.notch[0]), Y(b.notch[1]));
    const yFace = Y(faceMid[1]);
    lead(X(faceMid[0]) + 4, yFace, xr - 4, yFace);
    text(xr, yFace + 4, 'start', 'c-face', ['Exit face', `θ ${val('th', v => `${v.toFixed(1)}°`)}`]);
    out.push(`<path class="bc-line bc-free" d="M${f(xs)} ${f(Y(b.H))} C ${f(xs + (xo - xs) * 0.12)} ${f(Y(b.H * 0.94))}, ${f(xs + (xo - xs) * 0.3)} ${f(Y(fh))}, ${f(xo)} ${f(Y(fh))}"/>`);
    const ySurf = Math.min(Y(fh) - 4, yFace + 30), xSurf = xs + (xo - xs) * 0.6;
    lead(xSurf, Y(fh) - 2, xr - 4, ySurf);
    text(xr, ySurf + 4, 'start', 'c-free', ['Free surface', `γ ${val('g', v => `${v.toFixed(3)} N/m`)}`]);
    line('bc-out', xo, Y(0), xo, Y(fh));
    const yOut = Math.max(ySurf + 24, Y(fh / 2));
    lead(xo + 3, Y(fh / 2), xr - 4, yOut);
    text(xr, yOut + 4, 'start', 'c-out', ['Outlet', '<tspan class="bc-sub">film moves with the web</tspan>']);
    // gravity
    out.push(`<g class="bc-g"><line x1="${f(xr + 8)}" y1="${f(Y(F.y1))}" x2="${f(xr + 8)}" y2="${f(Y(F.y1) + 26)}"/><path d="M${f(xr + 4)} ${f(Y(F.y1) + 20)} L${f(xr + 8)} ${f(Y(F.y1) + 28)} L${f(xr + 12)} ${f(Y(F.y1) + 20)}"/><text x="${f(xr + 18)}" y="${f(Y(F.y1) + 18)}">g</text></g>`);
    return out.join('');
  };
}
/** The boundary conditions at location i, each in words (extra: more list items, the 3D's sides). */
function bcListHTML(i, extra = '') {
  const geo = cfdGeometry(i);
  return `<h4>${uiBadge('flow')}Boundary conditions at L${i + 1}</h4><ul class="bc-list">
      <li><i class="c-in"></i><span><b>Inlet</b> (pool edge): the bead pressure ${locInput(i, 'Pup').toFixed(2)} kPa, plus the hydrostatic pressure with depth; no flow across.</span></li>
      <li><i class="c-blade"></i><span><b>Blade</b> underside: no slip, fixed.</span></li>
      <li><i class="c-web"></i><span><b>Web</b>: moving at ${(geo.U * 60).toFixed(2)} m/min${P.skew ? ` (the web's ${locInput(i, 'U').toFixed(2)} m/min × cos ${P.skew}° skew)` : ''}; the slurry slips over the air between the fibre's top filaments (slip length ${(fibreSlip().b * 1e6).toFixed(1)} µm); nothing enters the fibre.</span></li>
      <li><i class="c-face"></i><span><b>Exit face</b> (${CFDG.exitAngle}°): no slip; the contact line stays pinned at the metering edge, or climbs the face where the surface leaves it at the contact angle ${geo.contactDeg.toFixed(1)}°.</span></li>
      <li><i class="c-free"></i><span><b>Free surface</b>: surface tension ${locInput(i, 'g').toFixed(3)} N/m against air at ambient pressure; its shape is solved.</span></li>
      <li><i class="c-out"></i><span><b>Outlet</b> (${+bladeMM(i).Ld.toFixed(1)} mm after the edge): the film moves with the web; beyond it the 1D film to the oven (${(P.oven * 1000).toFixed(0)} mm).</span></li>
      <li><i class="c-g"></i><span><b>Gravity</b> down, 9.81 m/s².</span></li>${extra}</ul>`;
}
function renderSolveStep2D(host) {
  const i = stepLoc2D(), geo = cfdGeometry(i), m = RHEO_MODELS[CFDG.model], law = m.uses;
  const st = (r, k) => r.status === 'running' ? 'solving' : r.status === 'done' ? `solved${cfdIsStale(k) ? ', out of date' : ''}` : r.status === 'error' || r.status === 'blocked' ? 'failed' : r.status === 'cancelled' ? 'stopped' : 'not solved';
  host.innerHTML = `<div class="step-view solve-view"><div class="step-draw" id="bcDraw"></div>
    <aside class="step-side">${bcListHTML(i)}
      <h4>${uiBadge('drop')}Slurry</h4><table class="kv">
      <tr><td>Rheology</td><td>${m.l}</td></tr><tr><td>Viscosity at 2.7 1/s</td><td>${locInput(i, 'mu').toFixed(1)} Pa·s</td></tr>
      ${law.includes('n') ? `<tr><td>Shear-thinning n</td><td>${locInput(i, 'n').toFixed(2)}</td></tr>` : ''}${law.includes('ty') ? `<tr><td>Yield stress</td><td>${locInput(i, 'ty').toFixed(1)} Pa</td></tr>` : ''}
      <tr><td>Density</td><td>${geo.rho.toFixed(0)} kg/m³</td></tr></table>
      <h4>${uiBadge('tolerance')}Solver</h4><table class="kv"><tr><td>Newton tolerance</td><td>${fmtTol(CFDS.tol)}</td></tr><tr><td>Iterations, at most</td><td>${CFDS.maxIter}</td></tr><tr><td>Mesh</td><td>${MESH_PRESETS[CFDS.mesh].l}${zonesActive(zonesOf()) ? ' + zones' : ''}</td></tr></table>
      <h4>${uiBadge('location')}Locations</h4><table class="kv">${cfdRuns.map((r, k) => `<tr${k === i ? ' class="on"' : ''}><td>L${k + 1}</td><td>${st(r, k)}${r.status === 'done' && r.elapsedMs ? ` · ${(r.elapsedMs / 1000).toFixed(1)} s` : ''}</td></tr>`).join('')}</table>
      <p class="side-note">Click a blue value on the drawing to change it (a location's own value when it has one, else the shared input).</p></aside></div>`;
  const d = document.getElementById('bcDraw'), w = Math.max(760, d.clientWidth), h = Math.max(240, d.clientHeight);
  d.innerHTML = bladeSVG(i, w, h, { dims: false, bc: bcCallouts(i) }).svg;
  wireBcEdits(d, i);
}
/** A boundary-condition drawing's values: click (or Enter) to type a new one. */
function wireBcEdits(d, i) {
  const openBc = t => {
    const k = t.dataset.bc, v = bcValue(i, k), r = t.getBoundingClientRect(), hr = d.getBoundingClientRect();
    const inp = document.createElement('input');
    // (a shared input: the value typed is the shared one -- the contact angle's, before a location adds its wetting variation)
    Object.assign(inp, { type: 'number', value: v.own ? v.v : v.shared, min: v.lo, max: v.hi, step: 'any', className: 'dim-input', id: 'bcIn_' + k });
    inp.setAttribute('aria-label', `${BC_INPUT[k].l} (${BC_INPUT[k].u}), ${v.own ? `L${i + 1}'s own` : 'shared'}`);
    inp.title = v.own ? `L${i + 1}'s own ${BC_INPUT[k].l.toLowerCase()}` : k === 'th' ? `The shared contact angle on the blade; each location adds its wetting variation (L${i + 1}: ${v.v.toFixed(1)}°)` : `The shared ${BC_INPUT[k].l.toLowerCase()}`;
    Object.assign(inp.style, { left: `${r.left - hr.left + d.scrollLeft - 4}px`, top: `${r.top - hr.top + d.scrollTop - 3}px`, width: `${Math.max(80, r.width + 20)}px`, height: `${r.height + 6}px` });
    d.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const close = ok => {
      if (done) return; done = true;
      const val = inp.value; inp.remove();
      if (ok) { const tmp = document.createElement('input'); tmp.value = val; tmp.id = 'bcIn_' + k; guardNumber(tmp, { label: BC_INPUT[k].l, lo: v.lo, hi: v.hi, unit: BC_INPUT[k].u }, x => { if (x !== (v.own ? v.v : v.shared)) setBc(i, k, x); }); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') close(true); else if (e.key === 'Escape') close(false); });
    inp.addEventListener('blur', () => close(true));
  };
  d.querySelectorAll('.bc-edit').forEach(t => {
    t.addEventListener('click', () => openBc(t));
    t.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBc(t); } });
  });
}

// =====================================================================
// 3D
// =====================================================================
/** The 3D page's step: the one chosen, else Results when this region has a result, else Geometry. */
const step3D = () => C3D.step || (typeof c3dShown === 'function' && c3dShown() ? 'results' : 'geometry');
function goStep3D(k) {
  if (k === step3D() && C3D.step) return;
  C3D.step = k;
  render();
}
/** Solve 3D: the Solve step; when the solve ends well the page opens Results. */
function runFromSolve3D() {
  if (tab === 9 && step3D() !== 'solve') C3D.step = 'solve';
  C3D_RUN.stepAuto = true;
}
function stepAfterRun3D() {
  if (!C3D_RUN.stepAuto || C3D_RUN.status === 'running') return;
  C3D_RUN.stepAuto = false;
  if (tab === 9 && step3D() === 'solve' && C3D_RUN.status === 'done') C3D.step = 'results';
}
/** The 3D mesh's size: elements along the flow (blade + exit face + film), up the gap, across; solved, or as set. */
function c3dMeshSize() {
  const S = c3dShown(), R = S && S.result;
  if (R) {
    const a = (R.NC - 1) / 2, y = (R.NR - 1) / 2, z = (R.NL - 1) / 2, nB = R.cCorner != null ? R.cCorner / 2 : C3D.nxGap, face = R.cCL != null ? (R.cCL - R.cCorner) / 2 : a - C3D.nxGap - C3D.nxFilm;
    return { solved: true, a0: a, a1: a, ny: y, nz: z, face, nB, nS: a - nB - face };
  }
  return { solved: false, ...c3dCounts(), face: null };
}
/**
 * The mesh a 3D solve would have: along the flow (without and with the exit face's elements) and across the gap
 * as its stations' 2D lays them out (with the 2D's refinement zones: from the laid-out starting mesh, once there),
 * across the region as its zones leave it.
 */
function c3dCounts() {
  const F = C3D.frac3;
  // (an adapted mesh: its element ends along and up; across, its own when for this region)
  if (F) { const a0 = F.b.length - 1 + F.s.length - 1; return { a0, a1: a0 + (F.f.length > 1 ? F.f.length - 1 : C3D.nxFace), ny: F.y.length - 1, nz: c3dNz() }; }
  const pv = C3D_PV.key === c3dPreviewKey() && C3D_PV.stats;
  const a0 = pv ? pv.nB + pv.nS : C3D.nxGap + C3D.nxFilm, face = pv && pv.nF ? pv.nF : C3D.nxFace;
  return { a0, a1: a0 + face, ny: pv ? pv.nEy : C3D.ny, nz: c3dNz() };
}
const c3dHexes = (a, m) => a * m.ny * m.nz, c3dNodes = (a, m) => (2 * a + 1) * (2 * m.ny + 1) * (2 * m.nz + 1);
/** Shape quality of the solved 3D mesh's 27-node hexahedra: min / max Jacobian over each element's 27 nodes. */
function c3dHexQuality(R) {
  if (R._hexQ) return R._hexQ;
  const NC = R.NC, NR = R.NR, NL = R.NL, eC = (NC - 1) / 2, eR = (NR - 1) / 2, eL = (NL - 1) / 2;
  const N = t => [t * (t - 1) / 2, 1 - t * t, t * (t + 1) / 2], dN = t => [t - 0.5, -2 * t, t + 0.5], P3 = [-1, 0, 1].map(t => ({ N: N(t), d: dN(t) }));
  const idx = (c, l, k) => (c * NL + l) * NR + k;
  let worst = Infinity, sum = 0, n = 0, below = 0;
  const hist = new Array(10).fill(0);
  for (let ec = 0; ec < eC; ec++) for (let el = 0; el < eL; el++) for (let er = 0; er < eR; er++) {
    let jmin = Infinity, jmax = -Infinity;
    for (let pa = 0; pa < 3; pa++) for (let pb = 0; pb < 3; pb++) for (let pd = 0; pd < 3; pd++) {
      const A = P3[pa], B = P3[pb], D = P3[pd];
      let xa = 0, xb = 0, xd = 0, ya = 0, yb = 0, yd = 0, za = 0, zb = 0, zd = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let d = 0; d < 3; d++) {
        const m = idx(2 * ec + a, 2 * el + d, 2 * er + b), x = R.x[m], y = R.y[m], z = R.z[m];
        const wa = A.d[a] * B.N[b] * D.N[d], wb = A.N[a] * B.d[b] * D.N[d], wd = A.N[a] * B.N[b] * D.d[d];
        xa += x * wa; xb += x * wb; xd += x * wd; ya += y * wa; yb += y * wb; yd += y * wd; za += z * wa; zb += z * wb; zd += z * wd;
      }
      const J = xa * (yb * zd - yd * zb) - xb * (ya * zd - yd * za) + xd * (ya * zb - yb * za);
      jmin = Math.min(jmin, J); jmax = Math.max(jmax, J);
    }
    const q = jmax > 0 ? Math.max(-1, jmin / jmax) : -1;
    worst = Math.min(worst, q); sum += q; n++; if (q < 0.5) below++; hist[Math.min(9, Math.max(0, Math.floor(q * 10)))]++;
  }
  return (R._hexQ = { worst, mean: sum / n, n, below, hist });
}
/** Before solving (the blade made from the 2D setup): the stations' starting layout, as the 2D lays out a station with the 3D's counts, at the strip's location. */
const C3D_PV = { key: null, stats: null, error: null };
function c3dPreviewKey() { try { const m = c3dSolveMessage(false); return JSON.stringify(m.msg); } catch (e) { return null; } }
function requestMeshPreview3D() {
  if (C3D.source !== 'made') return;
  const key = c3dPreviewKey();
  if (!key || key === C3D_PV.key) return;
  const msg = JSON.parse(key);
  meshPvQueue({ key, msg, done: d => {
    if (d.ok && d.preview === key) Object.assign(C3D_PV, { key, stats: meshStats(makeFlowField(d.result, { rho: msg.rho, ty: msg.ty })), error: null });
    else Object.assign(C3D_PV, { key, stats: null, error: d.error || 'no mesh' });
    if (tab === 9) render();
  } });
}
function stepStatus3D() {
  const G = c3dBuild(), S = c3dShown(), R = S && S.result, stale = S && S.key !== c3dSolveKey3(S), m = c3dMeshSize(), st = {};
  st.geometry = G.error ? { state: 'bad', note: 'cannot be built', title: G.error } : G.empty ? { state: 'warn', note: 'no blade file yet' }
    : G.open || G.multi ? { state: G.open ? 'bad' : 'warn', note: G.open ? 'blade misses the region' : 'blade overhangs' }
      : { state: 'done', note: `${C3D.source === 'made' ? 'from the 2D setup' : 'from a file'} · ${C3D.region === 'strip' ? `${C3D.stripW} mm at L${C3D.loc + 1}` : 'full width'}` };
  const q = R ? c3dHexQuality(R).worst : C3D_PV.stats && C3D_PV.key === c3dPreviewKey() ? C3D_PV.stats.worst : null;
  const hx = m.a0 === m.a1 ? c3dHexes(m.a0, m).toLocaleString() : `${c3dHexes(m.a0, m).toLocaleString()}–${c3dHexes(m.a1, m).toLocaleString()}`;
  st.mesh = { state: G.mesh || R ? (q != null && q < 0.2 ? 'warn' : 'done') : '', note: `${hx} hexahedra${q != null ? ` · worst ${q.toFixed(2)}` : ''}` };
  st.solve = C3D_RUN.status === 'running' ? { state: 'run', note: `solving ≈ ${Math.floor(100 * (c3dProgShare() || 0))} %` }
    : C3D_RUN.status === 'error' ? { state: 'bad', note: 'failed', title: C3D_RUN.error } : R ? { state: stale ? 'warn' : 'done', note: stale ? 'out of date' : `solved in ${c3dTime(S.ms / 1000)}` } : { state: '', note: 'not solved' };
  st.results = !R ? { state: '', note: 'nothing yet' } : stale ? { state: 'warn', note: 'out of date' } : { state: 'done', note: 'flow, film, pressure' };
  return st;
}
/** The Mesh step's report on the 3D page. */
/** The 3D Mesh step's zones: the 2D's (along the flow and up the gap, at every station) and across the web. */
function c3dZonesHTML() {
  const z = c3dZones(), full = C3D.region === 'full', where = full ? 'web' : 'strip', rg = c3dRegion(), set = rg.nz, n = c3dNz();
  const z2 = zonesText(full ? CFDS.zones : solverOf(C3D.loc).zones);
  const bands = z.bands.map((b, j) => `<div class="band-row"><b>Band ${j + 1}</b><span>z ${zoneNum(`c3zb_${j}_z0`, b.z0, ZONE_LIM.x, 0.5, `Band ${j + 1} across: from z, mm`)} to ${zoneNum(`c3zb_${j}_z1`, b.z1, ZONE_LIM.x, 0.5, `Band ${j + 1} across: to z, mm`)} mm</span>
    <span>elements ${zoneNum(`c3zb_${j}_size`, b.size, ZONE_LIM.size, 0.1, `Band ${j + 1} across: element size, mm`)} mm</span>
    <button type="button" class="icon-btn band-del" data-c3zdel="${j}" title="Remove band ${j + 1}" aria-label="Remove band ${j + 1} across">${uiIco('trash')}</button></div>`).join('');
  return `<h4>${uiBadge('grading')}Refinement zones</h4>
    <p class="side-note" style="margin-top:0">Along the flow and up the gap, at every station: the 2D's zones (${z2}). <button type="button" class="linkish" id="c3dZ2d">Set them on Flow › 2D, Mesh</button></p>
    <table class="kv zone-table"><tr${z.edges.on ? ' class="on"' : ''}><td><label class="zone-chk"><input type="checkbox" id="c3zEdges"${z.edges.on ? ' checked' : ''}><span>The ${where}'s ends</span></label></td>
      <td>${zoneNum('c3zEdgeSize', c3dEdgeSize(z), ZONE_LIM.size, 0.1, `The ${where}'s ends: element size, mm`)}<span class="u">mm</span></td></tr></table>
    <div class="band-list">${bands}<button type="button" class="btn btn-secondary btn-sm" id="c3zAdd">${uiIco('plus')}Band across</button><span class="side-note-i">z across the web, mm (L${C3D.loc + 1} at ${CFD_LOCS[C3D.loc].z}).</span></div>
    <p class="side-note"><label>Growth away from a zone ×${zoneNum('c3zGrowth', z.growth, ZONE_LIM.growth, 0.05, 'Growth away from a zone across the web')}</label> · elements across: <b>${n}</b>${n !== set ? ` (set: ${set})` : ''}</p>`;
}
function wireC3dZones(host) {
  if (!host) return;
  const set = (z, hint) => { undoHint(hint); C3D.zZones = z; render(); };
  const num = (id, lim, label, apply) => { const el = host.querySelector('#' + id); if (el) el.onchange = () => guardNumber(el, { label, lo: lim[0], hi: lim[1], unit: lim[2] }, apply); };
  const g = id => host.querySelector('#' + id);
  if (g('c3dZ2d')) g('c3dZ2d').onclick = () => { tab = 4; FV.step = 'mesh'; render(); };
  if (g('c3zEdges')) g('c3zEdges').onchange = e => { const z = c3dZones(); z.edges.on = e.target.checked; set(z, `3D zone at the region's ends ${e.target.checked ? 'on' : 'off'}`); };
  num('c3zEdgeSize', ZONE_LIM.size, '3D zone at the region\'s ends: element size', v => { const z = c3dZones(); z.edges.size = v; z.edges.on = true; set(z, `3D zone at the region's ends: ${v} mm`); });
  num('c3zGrowth', ZONE_LIM.growth, '3D zones: growth', v => { const z = c3dZones(); z.growth = v; set(z, `3D zones: growth ×${v}`); });
  c3dZones().bands.forEach((b, j) => {
    for (const e of ['z0', 'z1']) num(`c3zb_${j}_${e}`, ZONE_LIM.x, `3D band ${j + 1}: ${e === 'z0' ? 'from' : 'to'} z`, v => { const z = c3dZones(); z.bands[j][e] = v; set(z, `3D band ${j + 1}: ${e === 'z0' ? 'from' : 'to'} z ${v} mm`); });
    num(`c3zb_${j}_size`, ZONE_LIM.size, `3D band ${j + 1}: element size`, v => { const z = c3dZones(); z.bands[j].size = v; set(z, `3D band ${j + 1}: ${v} mm`); });
  });
  host.querySelectorAll('[data-c3zdel]').forEach(b => { b.onclick = () => { const z = c3dZones(), j = +b.dataset.c3zdel; z.bands.splice(j, 1); set(z, `Remove 3D band ${j + 1}`); }; });
  if (g('c3zAdd')) g('c3zAdd').onclick = () => {
    // (a new band: the middle fifth of the region)
    const rg = c3dRegion(), a = rg.z0 * 1000, w = (rg.z1 - rg.z0) * 1000, z = c3dZones();
    z.bands.push({ z0: +(a + 0.4 * w).toFixed(2), z1: +(a + 0.6 * w).toFixed(2), size: +Math.max(0.1, c3dEvenSize() / 2).toFixed(2) });
    set(z, `Add 3D band ${z.bands.length}`);
  };
}
function c3dMeshSideHTML() {
  const S = c3dShown(), R = S && S.result, m = c3dMeshSize(), e = c3dEstimate(), hq = R ? c3dHexQuality(R) : null, pv = !R && C3D_PV.key === c3dPreviewKey() ? C3D_PV : null;
  const q = hq || (pv && pv.stats), hmax = q ? Math.max(...q.hist, 1) : 1;
  const hx = m.a0 === m.a1 ? c3dHexes(m.a0, m).toLocaleString() : `${c3dHexes(m.a0, m).toLocaleString()} to ${c3dHexes(m.a1, m).toLocaleString()}`;
  const nd = m.a0 === m.a1 ? c3dNodes(m.a0, m).toLocaleString() : `${c3dNodes(m.a0, m).toLocaleString()} to ${c3dNodes(m.a1, m).toLocaleString()}`;
  const st = pv && pv.stats, nB = st ? st.nB : C3D.nxGap, nS = st ? st.nS : C3D.nxFilm;
  return `${c3dZonesHTML()}${acc3HTML()}<h4>${uiBadge('mesh')}3D mesh, ${C3D.region === 'strip' ? `strip at L${C3D.loc + 1}` : 'full width'}${R ? '' : ' (before solving)'}</h4><table class="kv">
    <tr><td>Along the flow</td><td>${m.solved ? `${m.nB} + ${m.face} + ${m.nS}` : `${nB} + 0–${m.a1 - m.a0} + ${nS}`}</td></tr>
    <tr><td>Up the gap × across</td><td>${m.ny} × ${m.nz}</td></tr>
    <tr><td>Hexahedra (27 nodes)</td><td>${hx}</td></tr><tr><td>Nodes</td><td>${nd}</td></tr>
    <tr><td>Unknowns</td><td>${R && R.size ? R.size.unknowns.toLocaleString() : `≈ ${Math.round(e.ND / 1000)} thousand`}</td></tr>
    ${C3D.region === 'strip' ? `<tr><td>Memory, time (estimated)</td><td>${c3dMem(e.bytes)}, ${c3dTime(e.secs)}</td></tr>` : ''}
    <tr><td>Quality, worst</td><td>${q ? q.worst.toFixed(2) : '—'}</td></tr><tr><td>Quality, mean</td><td>${q ? q.mean.toFixed(2) : '—'}</td></tr></table>
    ${q ? `<div class="q-hist" aria-label="Quality histogram, 0 to 1">${q.hist.map((n, k) => `<i style="height:${Math.max(2, 46 * n / hmax)}px" title="${k / 10}–${(k + 1) / 10}: ${n}"></i>`).join('')}</div><div class="q-axis"><span>quality 0</span><span>1</span></div>` : ''}
    <p class="side-note">${R ? 'Quality of the solved hexahedra: each one\'s smallest over largest Jacobian of its triquadratic map (1 = undistorted).'
      : pv && pv.stats ? `Quality before solving: each station is laid out as the 2D lays out its mesh, with these counts (at L${C3D.loc + 1}, the contact line at the edge); neighbouring stations are joined across.`
        : C3D.source === 'made' ? 'Laying out the stations…' : 'The quality is known once solved (a blade from a file: its stations are laid out from the file\'s underside).'}
      The view shows the mesh's outer faces. Counts: Inputs › 3D mesh.</p>`;
}
/** The Solve step on the 3D page: the boundary conditions (the 2D profile's drawing at the strip's location) and the sides. */
function c3dSolveHTML() {
  const i = C3D.region === 'strip' ? C3D.loc : 0, skew = P.skew;
  const sides = C3D.region === 'strip'
    ? `<li><i class="c-out"></i><span><b>Sides of the strip</b> (${C3D.stripW} mm): ${skew ? 'open: each held at its own station\'s flow along the skewed blade' : 'symmetry planes (no flow across, no shear)'}.</span></li>`
    : `<li><i class="c-out"></i><span><b>The web's edges</b>: ${skew ? 'open, each held at its own station\'s flow along the skewed blade' : 'symmetry planes'} (the edge bead is not modelled).</span></li>`;
  return `<div class="step-view solve-view"><div class="step-draw" id="bcDraw3">${C3D.source === 'made' ? '' : '<p class="v3d-msg">The blade from the file: see Geometry. Its conditions are listed here.</p>'}</div>
    <aside class="step-side">${bcListHTML(i, sides)}
      ${C3D.region === 'full' ? `<p class="side-note">Drawn: the profile at L1; the gap and contact angle vary across the web with the inputs under Variation across the web.</p>` : ''}
      <h4>${uiBadge('tolerance')}Solve</h4><table class="kv"><tr><td>Newton tolerance</td><td>${fmtTol(CFDS.tol)}</td></tr><tr><td>Region</td><td>${C3D.region === 'strip' ? `strip ${C3D.stripW} mm at L${C3D.loc + 1}` : 'full width'}</td></tr></table>
      <p class="side-note">${c3dEstimateText()}</p></aside></div>`;
}
function drawSolve3D() {
  const d = document.getElementById('bcDraw3');
  if (!d || C3D.source !== 'made') return;
  const i = C3D.region === 'strip' ? C3D.loc : 0, w = Math.max(760, d.clientWidth), h = Math.max(240, d.clientHeight);
  d.innerHTML = bladeSVG(i, w, h, { dims: false, bc: bcCallouts(i) }).svg;
  wireBcEdits(d, i);
}
