/*
 * report.js — the run report (File > Report…).
 *
 * The chosen sections of the project (the four modules, CFD Analysis, its mesh study, DOE) as one
 * A4 document: a header (title, project, author, date, app version, notes), then per section its
 * inputs, results tables, plots (drawn as the views show them now, on white) and checks and
 * messages. Results whose inputs changed since they were solved are included and marked out of
 * date. Saved as one self-contained HTML file (the plots inside), or printed to PDF by the browser.
 *
 * Depends on export-image.js (imageTargets, snapshotTarget, composeImage, saveBlob, imgToast),
 * validate.js (problemList), undo.js (undoQuiet, the input labels) and everything they read.
 */

const REPORT_KEY = 'bladeCoatDefectLab.report.v1';
const REP = (() => {
  const d = { author: '', sections: ['inputs', 'm0', 'm1', 'm2', 'm3', 'cfd', 'mesh', 'doe', 'meas'] };
  try { return { ...d, ...JSON.parse(localStorage.getItem(REPORT_KEY) || '{}') }; } catch (e) { return d; }
})();
const saveRepPrefs = () => { try { localStorage.setItem(REPORT_KEY, JSON.stringify(REP)); } catch (e) { /* not remembered */ } };
const repEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const repFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const repFlag = (t = 'out of date') => `<span class="flag">${t}</span>`;
const repNum = (v, d) => v == null || v === '' ? '—' : typeof v === 'number' ? (d != null ? v.toFixed(d) : String(+v.toPrecision(4))) : String(v);
/** A value with its unit (degrees without a space). */
const repUnit = (v, u) => u ? (u === '°' ? `${v}°` : `${v} ${u}`) : String(v);
const repClock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The sections a report can hold, with what each has now (for the dialog). */
function reportSections() {
  const solved = cfdRuns.filter(r => r.field).length, stale = CFD_LOCS.filter((_, i) => cfdIsStale(i)).length;
  return [
    { k: 'inputs', l: 'Inputs', note: 'the sidebar inputs every module uses' },
    { k: 'm0', l: TABS[0], note: 'scenario, results, plots, checks' },
    { k: 'm1', l: TABS[1], note: 'results, plots, checks' },
    { k: 'm2', l: TABS[2], note: 'results, plots, checks' },
    { k: 'm3', l: TABS[3], note: 'results, plots, checks' },
    { k: 'cfd', l: TABS[4], note: solved ? `${solved} of 4 locations solved${stale ? `, ${stale} out of date` : ''}` : 'nothing solved yet: setup and checks only' },
    { k: 'mesh', l: 'Mesh study', note: meshStudy ? `location ${meshStudy.loc + 1}, ${meshStudy.runs.filter(r => r.status === 'done').length} of ${meshStudy.runs.length} meshes solved` : 'not run', off: !meshStudy },
    { k: 'doe', l: TABS[5], note: DOE.runs.length ? `${DOE.runs.filter(r => r.status === 'done').length} of ${DOE.runs.length} runs solved` : 'not run: setup only' },
    { k: 'meas', l: TABS[6], note: MEAS.sets.length ? `${MEAS.sets.length} dataset${MEAS.sets.length === 1 ? '' : 's'}${MEAS.fit ? ', a fit' : ''}` : 'none imported', off: !MEAS.sets.length },
  ];
}

// ---------------------------------------------------------------------
// Pieces: tables from the app's own, plots as images
// ---------------------------------------------------------------------
/**
 * One of the app's tables as plain HTML: no buttons or inputs (their values instead), no classes;
 * colour swatches kept. Wider than `max` columns: split into tables of `max`, each repeating the
 * first `keep` columns (the page is A4).
 */
function repTable(t, { keep = 1, max = 8 } = {}) {
  if (!t) return '';
  const c = t.cloneNode(true);
  c.querySelectorAll('button, .img-btn, script, [hidden]').forEach(e => e.remove());
  c.querySelectorAll('input, select').forEach(e => e.replaceWith(document.createTextNode(
    e.type === 'checkbox' ? (e.checked ? '✓' : '–') : e.tagName === 'SELECT' ? ((e.options[e.selectedIndex] || {}).text || '') : e.value)));
  c.querySelectorAll('svg').forEach(e => e.remove());
  for (const e of [c, ...c.querySelectorAll('*')]) {
    const bg = e.tagName === 'I' && e.style && e.style.background;
    for (const a of [...e.attributes]) if (!['colspan', 'rowspan', 'scope'].includes(a.name)) e.removeAttribute(a.name);
    if (bg) { e.className = 'sw'; e.setAttribute('style', `background:${bg}`); }
  }
  const rows = [...c.rows], n = Math.max(0, ...rows.map(r => r.cells.length));
  if (n <= max || rows.some(r => [...r.cells].some(x => x.colSpan > 1))) return c.outerHTML;
  const per = Math.max(1, max - keep), out = [];
  for (let a = keep; a < n; a += per) {
    const part = c.cloneNode(true);
    for (const r of part.rows) [...r.cells].forEach((x, j) => { if (j >= keep && (j < a || j >= a + per)) x.remove(); });
    out.push(part.outerHTML);
  }
  return out.join('');
}
/** A plot or chart of the view as a PNG figure (white, its legend under it). */
function repFigure(target, caption, flag = '') {
  const k = 1.5, opt = { title: false, legend: true, inputs: false, footer: false };
  const shot = snapshotTarget(target, k, 'white');
  const { W, H } = composeImage(null, shot, opt, {});
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const ctx = nativeGetContext.call(cv, '2d');
  ctx.setTransform(k, 0, 0, k, 0, 0);
  composeImage(ctx, shot, opt, { k, H });
  const cap = caption || [shot.title, shot.subtitle].filter(Boolean).join(' · ');
  return `<figure><img src="${cv.toDataURL('image/png')}" alt="${repEsc(cap)}" style="max-width:${Math.round(W)}px"><figcaption>${repEsc(cap)}${flag ? ' ' + flag : ''}</figcaption></figure>`;
}
/** Rows of name / value (/ more) as a table. */
const repRows = (rows, head) => `<table>${head ? `<thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map(r => `<tr>${r.map((c, n) => n ? `<td>${c}</td>` : `<th scope="row">${c}</th>`).join('')}</tr>`).join('')}</tbody></table>`;
/** The problems (rejected entries, errors, warnings) as a table. */
function repProblems() {
  const list = problemList();
  if (!list.length) return '<p class="ok">No problems: every input is in range and every check passes.</p>';
  return repRows(list.map(p => [`<span class="${p.level === 'error' ? 'bad' : 'warn'}">${p.kind === 'entry' ? 'Rejected' : p.level === 'error' ? 'Error' : 'Warning'}</span>`, repEsc(p.text), repEsc(p.where || '')]), ['Level', 'Problem', 'Where']);
}

// ---------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------
function repInputs() {
  let group = '', rows = '';
  for (const c of CFG) {
    if (c.g) { group = c.g; rows += `<tr class="grp"><th colspan="3">${repEsc(group)}</th></tr>`; }
    const v = P[c.k], changed = Math.abs(v - c.v) > 1e-12;
    rows += `<tr><th scope="row">${repEsc(c.l)}${c.h ? `<small>${repEsc(c.h)}</small>` : ''}</th><td${changed ? ' class="chg"' : ''}>${repEsc(repUnit((+v).toFixed(c.d), c.u))}</td><td>${repEsc(repUnit((+c.v).toFixed(c.d), c.u))}</td></tr>`;
  }
  return `<p class="lede">Used by every module (CFD locations may set their own gap, contact angle, speed, pressure and slurry: see CFD Analysis). Values changed from the default are in bold.</p>
    <table><thead><tr><th>Input</th><th>Value</th><th>Default</th></tr></thead><tbody>${rows}</tbody></table>`;
}
async function repModule(m) {
  tab = m; render(); await repFrame();
  let html = '';
  if (m === 0) {
    html += '<h3>Scenario</h3>' + repRows(ANIM_UNDO.map(([k, l, f]) => [repEsc(l), repEsc(f(ANIM[k]))]), ['Setting', 'Value']);
  }
  const stats = [...document.querySelectorAll('#ss .stat')].map(s => [repEsc(cleanText(s.querySelector('span'))), repEsc(cleanText(s.querySelector('strong')))]);
  if (stats.length) html += '<h3>Results</h3>' + repRows(stats, ['Result', 'Value']);
  const figs = imageTargets().filter(t => t.id.startsWith('pane:'));
  if (figs.length) html += '<h3>Plots</h3>' + figs.map(t => repFigure(t, t.title())).join('');
  const pills = [...document.querySelectorAll('#st .pill')].map(p => `<li class="${p.classList.contains('bad') ? 'bad' : p.classList.contains('warn') ? 'warn' : 'ok'}">${repEsc(cleanText(p))}</li>`);
  const scope = cleanText(document.getElementById('scope'));
  html += `<h3>Checks</h3>${pills.length ? `<ul class="checks">${pills.join('')}</ul>` : ''}${scope ? `<p class="scope">${repEsc(scope)}</p>` : ''}`;
  return html;
}
function repCfdSetup() {
  const g = k => { const [l, f, u] = CFDG_UNDO[k] || [k]; return [repEsc(l), repEsc(repUnit(f ? f(CFDG[k]) : repNum(CFDG[k]), u))]; };
  const keys = ['shape', ...(CFDG.shape === 'round' ? ['R', 'pool'] : []), 'exitAngle', 'model', 'fibre', 'gsm', 'rhoF', 'dFrom', ...(CFDG.dFrom === 'yarn' ? ['den', 'nf'] : []), 'airPerm', 'airDP', 'kozeny', 'airFrac', 'airU', 'airT', 'plenum'];
  const rows = keys.map(g);
  if (CFDG.shape !== 'round') rows.splice(1, 0, ['Land length', `${P.L} mm <small>(sidebar)</small>`]);
  const s = CFDS;
  let counts = null;
  try { counts = cfdGeometry(0).solver; } catch (e) { /* (no counts) */ }
  const solver = [
    ['Mesh', repEsc(MESH_PRESETS[s.mesh].l + (counts ? ` (at L1: ${counts.nEb} + ${counts.nEf} + ${counts.nEs} by ${counts.nEy} elements)` : ''))],
    ...SOLVER_INPUTS.filter(q => !q.custom).map(q => [repEsc(q.l), repEsc(repNum(s[q.k], q.d) + (q.u ? ' ' + q.u : ''))]),
    ['Newton tolerance', repEsc(fmtTol(s.tol))],
  ];
  const locs = CFD_LOCS.map((l, i) => {
    const own = Object.keys(l.over).map(k => { const q = LOC_INPUTS.find(x => x.k === k); return q ? `${q.l.toLowerCase()} ${repNum(l.over[k], q.d)} ${q.u}` : k; });
    const ownS = Object.keys(l.solver);
    return [`L${i + 1}`, `${l.z} mm`, `${locInput(i, 'gap').toFixed(3)} mm`, `${locInput(i, 'th').toFixed(1)}°`, repEsc(own.join('; ') || 'shared'), repEsc(ownS.length ? ownS.join(', ') : 'shared')];
  });
  return `<h3>Setup</h3><div class="cols"><div>${repRows(rows, ['Blade, slurry, fibre, air', 'Value'])}</div><div>${repRows(solver, ['Solver and mesh', 'Value'])}</div></div>
    ${repRows(locs, ['Location', 'Across the web', 'Gap at edge', 'Contact angle', 'Own inputs', 'Own solver settings'])}`;
}
function repCfdStatus() {
  const rows = CFD_LOCS.map((l, i) => {
    const r = cfdRuns[i], st = cfdIsStale(i);
    const status = r.status === 'running' ? 'solving (not finished)' : r.field ? (st ? `solved ${repFlag()}` : '<span class="ok">solved</span>')
      : r.status === 'error' ? `<span class="bad">failed: ${repEsc(r.error)}</span>` : r.status === 'blocked' ? `<span class="bad">not solved: ${repEsc(r.error)}</span>` : 'not solved';
    if (!r.field) return [`L${i + 1}`, status, '—', '—', '—', '—'];
    const q = r.result;
    return [`L${i + 1}`, status, `${(q.Q / r.geo.U * 1000).toFixed(4)} mm`, q.mode === 'climbed' ? `${(q.sCL * 1000).toFixed(3)} mm up the face` : 'pinned at the edge',
      `${q.converged ? 'converged' : 'partly converged'}, ${q.iterations} steps, residual ${q.residual.toExponential(1)}`, `${(r.elapsedMs / 1000).toFixed(1)} s`];
  });
  return repRows(rows, ['Location', 'Status', 'Wet film', 'Contact line', 'Convergence', 'Solve time']);
}
async function repCfd(keep) {
  tab = 4; FV.view = 'compare'; FV.dock = 'metrics'; render(); await repFrame();
  const any = cfdRuns.some(r => r.field);
  let html = repCfdSetup();
  html += '<h3>Results</h3>' + repCfdStatus();
  if (CFD_LOCS.some((_, i) => cfdIsStale(i))) html += `<p class="lede">${repFlag()} The inputs of these locations changed after they were solved: their results are for the earlier inputs.</p>`;
  if (any) {
    html += '<h4>Flow metrics</h4>' + repTable(document.querySelector('#cfdMetrics table'));
    if (cfdProbes.length) html += '<h4>Probes</h4>' + repTable(document.querySelector('#cfdProbes table'));
    if (cfdCuts.length) html += '<h4>Cut lines</h4>' + repTable(document.querySelector('#cfdCuts table'));
    // plots: each location with the display settings in use now
    html += '<h3>Plots</h3>';
    for (let i = 0; i < CFD_LOCS.length; i++) {
      if (!cfdRuns[i].field) continue;
      FV.view = i; renderCFD(); await repFrame();
      const t = imageTargets().find(x => x.id === 'plots');
      if (t) html += repFigure(t, [(SCALARS[FV.base] || {}).label || 'Geometry', cleanText(document.querySelector('#cfdPlots .fv-caption')) || `Location ${i + 1} · z ${CFD_LOCS[i].z} mm`].join(' · '), cfdIsStale(i) ? repFlag() : '');
    }
    if (keep.view === 'diff' && cfdRuns[FV.diff.a].field && cfdRuns[FV.diff.b].field) {
      FV.view = 'diff'; renderCFD(); await repFrame();
      const t = imageTargets().find(x => x.id === 'plots');
      if (t) html += repFigure(t, `${t.title()} · ${t.subtitle()}`);
    }
    FV.view = 'compare';
    for (const d of ['across', 'profiles', 'cuts', 'conv']) {
      if (d === 'cuts' && !cfdCuts.length) continue;
      FV.dock = d; viewCFD(); await repFrame();
      for (const t of imageTargets().filter(x => x.id.startsWith('chart:'))) html += repFigure(t, `${t.title()} · ${t.subtitle()}`);
    }
  }
  html += '<h3>Checks and messages</h3><h4>Problems</h4>' + repProblems();
  html += `<h4>Solver messages</h4>${cfdLog.length ? `<table class="msgs"><tbody>${cfdLog.slice(-200).map(m => `<tr><td>${repClock(m.t)}</td><td>${m.i != null ? 'L' + (m.i + 1) : ''}</td><td class="${m.kind === 'bad' ? 'bad' : m.kind === 'warn' ? 'warn' : ''}">${repEsc(m.text)}</td></tr>`).join('')}</tbody></table>${cfdLog.length > 200 ? '<p class="lede">The last 200 messages.</p>' : ''}` : '<p>No messages.</p>'}`;
  return html;
}
async function repMesh() {
  if (!meshStudy) return '<p>No mesh study has been run.</p>';
  tab = 4; FV.dock = 'mesh'; render(); await repFrame();
  const stale = cfdInputsKey(cfdGeometry(meshStudy.loc)) !== meshStudy.key;
  let html = `<p class="lede">Location ${meshStudy.loc + 1} · z ${CFD_LOCS[meshStudy.loc].z} mm, solved on coarser and finer meshes (×1.5 per step).${stale ? ' ' + repFlag() + ' Its inputs or settings changed since.' : ''}</p>`;
  html += repTable(document.querySelector('#cfdMeshStudy table'));
  for (const t of imageTargets().filter(x => x.id.startsWith('chart:'))) html += repFigure(t, `${t.title()} · ${t.subtitle()}`, stale ? repFlag() : '');
  const verdict = document.querySelector('#cfdMeshStudy > p.fv-note:last-child');
  if (verdict) html += `<p>${repEsc(cleanText(verdict))}</p>`;
  return html;
}
async function repDoe() {
  tab = 5; DOE.dock = 'runs'; render(); await repFrame();
  const stale = DOE.key && DOE.key !== cfdInputsKey(cfdGeometry(DOE.loc));
  const des = DOE.design || (DOE.factors || []).map(fs => ({ ...fs, f: doeFactor(fs.k), levels: doeLevels(fs) }));
  let html = `<h3>Setup</h3><p class="lede">Full factorial at location ${DOE.loc + 1} · z ${CFD_LOCS[DOE.loc].z} mm; every other input as in CFD Analysis (the base case).${DOE.design ? '' : ' Not run yet: the design being edited.'}</p>`;
  html += repRows(des.map(d => [repEsc(doeLabel(d.f || doeFactor(d.k))), repEsc(d.levels.map(v => doeFmt(d.f || doeFactor(d.k), v)).join(' · ')), String(d.levels.length)]), ['Factor', 'Levels', 'Count']);
  if (DOE.runs.length) {
    const done = DOE.runs.filter(r => r.status === 'done').length, bad = DOE.runs.filter(r => r.status === 'error');
    html += `<h3>Results</h3><p class="lede">${done} of ${DOE.runs.length} runs solved (${repEsc(DOE.status)}).${stale ? ' ' + repFlag() + ' The base case changed after this DOE ran: its results are for the earlier inputs.' : ''}</p>`;
    html += repTable(document.querySelector('#doe-runs table'), { keep: 1 + DOE.design.length, max: 9 });
    const figs = imageTargets().filter(t => t.id.startsWith('pane:'));
    if (figs.length) html += '<h3>Plots</h3>' + figs.map(t => repFigure(t, t.title(), stale ? repFlag() : '')).join('');
    html += '<h3>Checks</h3>' + (bad.length ? repRows(bad.map(r => [`Run ${r.n + 1}`, `<span class="bad">${repEsc(r.error)}</span>`]), ['Run', 'Not solved']) : '<p class="ok">Every run solved.</p>');
  }
  return html;
}

async function repMeasured() {
  let html = '<p class="lede">Measured points against the fast models and, where solved, the CFD. Error = (predicted − measured) / measured.</p>';
  for (const ds of MEAS.sets) {
    MEAS.sel = ds.id; MEAS.dock = 'compare'; tab = TABS.indexOf('Measured data'); render(); await repFrame();
    const stale = measCfdStale(ds);
    html += `<h3>${repEsc(ds.name)}</h3><p class="lede">${repEsc(MEAS_KINDS[ds.kind].l)} · ${ds.rows.length} points · ${repEsc(ds.file)}${ds.cw ? ` · from ${ds.cw.dry ? 'dry' : 'wet'} coat weight, density ${ds.cw.rho} kg/m³${ds.cw.dry ? `, solids ${ds.cw.solids} %` : ''}` : ''}${stale ? ' · ' + repFlag() + ' CFD values are for earlier inputs' : ''}</p>`;
    const sum = document.querySelector('#measTable .meas-sum');
    if (sum) html += `<p>${repEsc(cleanText(sum))}</p>`;
    html += repTable(document.querySelector('#measTable table'), { keep: 1, max: 9 });
    const t = imageTargets().find(x => x.id === 'pane:0');
    if (t) html += repFigure(t, `${ds.name} · ${t.title().replace(/^.*?· /, '')}`, stale ? repFlag() : '');
  }
  const f = MEAS.fit;
  if (f) {
    const c = k => CFG.find(q => q.k === k) || { l: k, u: '' };
    html += `<h3>Fit</h3><p class="lede">${repEsc(new Date(f.t).toLocaleString())} · to ${repEsc(f.sets.map(id => (MEAS.sets.find(d => d.id === id) || { name: '(removed)' }).name).join(', '))} · RMS % error minimised on the fast model${f.applied ? ' · applied' : ' · not applied'}</p>`;
    html += repRows(f.keys.map(k => [repEsc(c(k).l), repEsc(repUnit(f.before[k], c(k).u)), `<b>${repEsc(repUnit(f.vals[k], c(k).u))}</b>${f.atBound.includes(k) ? ' <span class="warn">at the end of its range</span>' : ''}`]), ['Input', 'Before', 'Fitted']);
    html += repRows([['All chosen data', f.rmsBefore.toFixed(1), f.rmsAfter.toFixed(1), f.cfd && f.cfd.status === 'done' && f.cfd.rms != null ? f.cfd.rms.toFixed(1) : f.cfd && f.cfd.status === 'none' ? 'not modelled' : '—']], ['RMS error, %', 'Fast model before', 'Fast model fitted', 'CFD fitted']);
  }
  return html;
}

// ---------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------
const REPORT_CSS = `
@page { size: A4; margin: 15mm 14mm 16mm; }
* { box-sizing: border-box; }
body { margin: 0 auto; max-width: 182mm; padding: 12mm 0 20mm; background: #fff; color: #1d1d1b; font: 10pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
@media print { body { padding: 0; max-width: none; } a { color: inherit; text-decoration: none; } }
header { border-bottom: 2pt solid #1d1d1b; padding-bottom: 8pt; margin-bottom: 10pt; }
h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 6pt; }
.meta { display: grid; grid-template-columns: max-content 1fr; gap: 1pt 12pt; margin: 0; font-size: 9.5pt; }
.meta dt { color: #6b6b66; } .meta dd { margin: 0; }
.notes { white-space: pre-wrap; margin: 10pt 0 0; padding: 6pt 9pt; border-left: 2.5pt solid #2a78d6; background: #f3f6fb; }
nav ol { margin: 4pt 0 0; padding-left: 16pt; columns: 2; font-size: 9.5pt; }
section { margin-top: 14pt; }
section + section { break-before: page; }
h2 { font-size: 15pt; margin: 0 0 6pt; padding-bottom: 3pt; border-bottom: 1pt solid #1d1d1b; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 14pt 0 5pt; break-after: avoid; }
h4 { font-size: 10pt; margin: 10pt 0 4pt; color: #45453f; break-after: avoid; }
p { margin: 4pt 0; } .lede { color: #45453f; font-size: 9pt; }
table { width: 100%; border-collapse: collapse; margin: 3pt 0 8pt; font-size: 8.5pt; }
th, td { padding: 2.5pt 6pt; border-bottom: .5pt solid #d8d8d2; text-align: left; vertical-align: top; }
thead th { border-bottom: 1pt solid #8a8a84; font-weight: 600; }
tbody th { font-weight: 500; }
tr { break-inside: avoid; }
tr.grp th { padding-top: 7pt; font-size: 8pt; letter-spacing: .05em; text-transform: uppercase; color: #6b6b66; border-bottom-color: #b9b9b3; }
td.chg { font-weight: 700; }
small { display: block; color: #6b6b66; font-size: 7.5pt; font-weight: 400; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14pt; }
figure { margin: 6pt 0 12pt; break-inside: avoid; }
figure img { display: block; width: 100%; height: auto; }
figcaption { margin-top: 3pt; font-size: 8.5pt; color: #45453f; }
.flag { display: inline-block; padding: 0 5pt; border: .5pt solid #d9a53c; border-radius: 7pt; background: #fdf0d2; color: #7a4b00; font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: .03em; white-space: nowrap; }
.ok { color: #1f7a3f; } .warn { color: #8a5a00; } .bad { color: #b3261e; }
ul.checks { margin: 3pt 0; padding-left: 14pt; }
.scope { font-size: 9pt; color: #45453f; }
.sw { display: inline-block; width: 8pt; height: 8pt; margin-right: 4pt; border-radius: 2pt; vertical-align: -.5pt; }
table.msgs { font: 8pt/1.35 ui-monospace, Menlo, Consolas, monospace; }
table.msgs td:first-child, table.msgs td:nth-child(2) { white-space: nowrap; color: #6b6b66; }
footer { margin-top: 18pt; padding-top: 5pt; border-top: .5pt solid #b9b9b3; font-size: 8pt; color: #6b6b66; }
`;
function reportDocument(o, sections) {
  const now = new Date(), when = now.toLocaleString([], { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const meta = [['Project', PROJ.name + (projDirty() ? ' (unsaved changes)' : '')], ...(o.author ? [['Author', o.author]] : []), ['Date', when], ['Made with', `${PROJ_APP} ${APP_VERSION}`]];
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${repEsc(o.title)}</title><style>${REPORT_CSS}</style></head>
<body>
<header><h1>${repEsc(o.title)}</h1>
<dl class="meta">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${repEsc(v)}</dd>`).join('')}</dl>
${o.notes ? `<p class="notes">${repEsc(o.notes)}</p>` : ''}
${sections.length > 1 ? `<nav><h4>Contents</h4><ol>${sections.map(s => `<li><a href="#${s.id}">${repEsc(s.title)}</a></li>`).join('')}</ol></nav>` : ''}
</header>
${sections.map(s => `<section id="${s.id}"><h2>${repEsc(s.title)}</h2>${s.html}</section>`).join('\n')}
<footer>${repEsc(o.title)} · ${repEsc(PROJ.name)} · ${repEsc(when)} · ${PROJ_APP} ${APP_VERSION}</footer>
</body></html>`;
}
/** Build the report: each chosen section drawn in its view, then everything put back as it was. */
async function buildReport(o) {
  const keep = { tab, view: FV.view, dock: FV.dock, doeDock: DOE.dock, measSel: MEAS.sel, measDock: MEAS.dock };
  const veil = document.createElement('div');
  veil.className = 'rep-veil'; veil.innerHTML = '<div><i class="spin" aria-hidden="true"></i>Building the report…</div>';
  document.body.appendChild(veil);
  await repFrame();
  const out = [];
  try {
    await undoQuiet(async () => {
      try {
        const want = new Set(o.sections);
        if (want.has('inputs')) out.push({ id: 'inputs', title: 'Inputs', html: repInputs() });
        for (let m = 0; m < 4; m++) if (want.has('m' + m)) out.push({ id: 'm' + m, title: TABS[m], html: await repModule(m) });
        if (want.has('cfd')) out.push({ id: 'cfd', title: TABS[4], html: await repCfd(keep) });
        if (want.has('mesh') && meshStudy) out.push({ id: 'mesh', title: 'Mesh study', html: await repMesh() });
        if (want.has('doe')) out.push({ id: 'doe', title: TABS[5], html: await repDoe() });
        if (want.has('meas') && MEAS.sets.length) out.push({ id: 'meas', title: TABS[6], html: await repMeasured() });
      } finally {
        tab = keep.tab; FV.view = keep.view; FV.dock = keep.dock; DOE.dock = keep.doeDock; MEAS.sel = keep.measSel; MEAS.dock = keep.measDock;
        render();
      }
    });
  } finally { veil.remove(); }
  return reportDocument(o, out);
}
const repSlug = t => (t || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'report';
/** Print the report (the browser's Save as PDF) from a hidden frame: no pop-up needed. */
function printReport(html) {
  const f = document.createElement('iframe');
  f.className = 'rep-print'; f.setAttribute('aria-hidden', 'true'); f.tabIndex = -1;
  f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { imgToast(`Could not print: ${e.message}`, 'error'); } }, 50); setTimeout(() => f.remove(), 120000); };
  f.srcdoc = html;
  document.body.appendChild(f);
}
async function makeReport(o, fmt) {
  try {
    const html = await buildReport(o);
    if (fmt === 'html') {
      const name = `${repSlug(o.title)}-${imgStamp()}.html`;
      saveBlob(new Blob([html], { type: 'text/html' }), name);
      imgToast(`Saved ${name}`);
    } else {
      printReport(html);
      imgToast('Report ready: in the print dialog choose "Save as PDF", paper A4.');
    }
    return html;
  } catch (e) {
    imgToast(`Report not made: ${e.message}`, 'error');
    throw e;
  }
}

// ---- the dialog ----
function openReportDialog() {
  let dlg = document.getElementById('repDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'repDlg'; dlg.className = 'img-dlg rep-dlg'; dlg.setAttribute('aria-labelledby', 'repDlgH'); document.body.appendChild(dlg); }
  const secs = reportSections();
  dlg.innerHTML = `<form method="dialog" class="img-form">
    <div class="img-head"><h2 id="repDlgH">Run report</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <label class="rep-field">Title <input type="text" id="repTitle" maxlength="120" value="${repEsc(`Run report — ${PROJ.name}`)}"></label>
    <label class="rep-field">Author <input type="text" id="repAuthor" maxlength="80" value="${repEsc(REP.author)}" placeholder="your name"></label>
    <label class="rep-field">Notes <textarea id="repNotes" rows="3" maxlength="4000" placeholder="summary, purpose, conclusions (optional)"></textarea></label>
    <fieldset class="rep-secs"><legend>Sections</legend>${secs.map(s => `<label class="img-opt${s.off ? ' is-off' : ''}"><input type="checkbox" value="${s.k}"${REP.sections.includes(s.k) && !s.off ? ' checked' : ''}${s.off ? ' disabled' : ''}> <span>${s.l} <small>${repEsc(s.note)}</small></span></label>`).join('')}</fieldset>
    <p class="fv-note">Each section: its inputs, results tables, plots as the views show them now, and checks and messages. Results that are out of date are included and marked. A4.</p>
    <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Cancel</button><button type="button" class="btn btn-secondary btn-sm" data-fmt="html">Save HTML</button><button type="submit" class="btn btn-primary btn-sm" data-fmt="pdf">PDF…</button></div>
  </form>`;
  const form = dlg.querySelector('form');
  dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
  const go = fmt => {
    const sections = [...dlg.querySelectorAll('.rep-secs input:checked')].map(i => i.value);
    if (!sections.length) { imgToast('Pick at least one section.', 'error'); return; }
    REP.author = dlg.querySelector('#repAuthor').value.trim(); REP.sections = sections; saveRepPrefs();
    const o = { title: dlg.querySelector('#repTitle').value.trim() || 'Run report', author: REP.author, notes: dlg.querySelector('#repNotes').value.trim(), sections };
    dlg.close();
    makeReport(o, fmt).catch(() => {});
  };
  dlg.querySelector('[data-fmt="html"]').onclick = () => go('html');
  form.onsubmit = e => { e.preventDefault(); go('pdf'); };
  if (!dlg.open) dlg.showModal();
  dlg.querySelector('#repTitle').focus();
}
(function reportMenu() {
  const b = document.getElementById('fmReport');
  if (b) b.onclick = () => { document.getElementById('fileMenu').open = false; openReportDialog(); };
})();
