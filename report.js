/*
 * report.js — the run report (File > Report…).
 *
 * The chosen sections of the project (the Results pages, the 1D, 2D CFD, its mesh study, DOE) as one
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
  const d = { author: '', sections: ['inputs', 'proc', 'mat', 'm0', 'm1', 'm2', 'm3', 'm1d', 'pool', 'cfd', 'mesh', 'm3d', 'doe', 'meas'] };
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
    { k: 'proc', l: TABS[12], note: `the chain, the drying in the oven, the film peeled off and a piece of it in 3D, the furnace and the graphene film, the mass balance, the oven's ${OVEN.zones.length} zone${OVEN.zones.length === 1 ? '' : 's'}` },
    { k: 'mat', l: TABS[13], note: 'the slurry card, how it flows, the flakes, the drying, the film, the furnace, the fibre web' },
    { k: 'm0', l: TABS[0], note: 'scenario, results, plots, checks' },
    { k: 'm1', l: TABS[1], note: 'results, plots, checks' },
    { k: 'm2', l: TABS[2], note: 'results, plots, checks' },
    { k: 'm3', l: TABS[3], note: 'results, plots, checks' },
    { k: 'm1d', l: '1D: gap flow, to the oven, across the web, pool and feed', note: 'results, plots, checks, the 1D / 2D table, the outlets and the pulse' },
    { k: 'pool', l: 'Pool and feed: 2D and 3D', note: [2, 3].map(d => `${d}D ${typeof poolCurrent === 'function' && poolCurrent(d) ? 'solved' : POOL[d].res ? 'out of date' : 'not solved'}`).join(', ') },
    { k: 'cfd', l: TABS[4], note: solved ? `${solved} of 4 locations solved${stale ? `, ${stale} out of date` : ''}` : 'nothing solved yet: setup and checks only' },
    { k: 'mesh', l: 'Mesh study', note: meshStudy ? `location ${meshStudy.loc + 1}, ${meshStudy.runs.filter(r => r.status === 'done').length} of ${meshStudy.runs.length} meshes solved` : 'not run', off: !meshStudy },
    { k: 'm3d', l: '3D: geometry and mesh', note: C3D.source === 'file' && !C3D_FILE ? 'no blade file imported' : 'setup, the 3D view, checks' },
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
/** A multiphysics step's chart (MP-1, MP-2): solved for the inputs as they are, in the dimension shown; any other chart: true. */
function repMpSolved(cv) {
  const s = cv.closest('#mpSec, #fmpSec, #dmpSec');
  if (!s) return true;
  if (s.id === 'dmpSec') return typeof dmpCurrent === 'function' && !!dmpCurrent(DMS.dim);
  return s.id === 'mpSec' ? typeof mpCurrent === 'function' && !!mpCurrent(MPS.dim) : typeof fmpCurrent === 'function' && !!fmpCurrent(FMS.dim);
}
/** Which multiphysics a chart is (its captions are the page's: "Temperatures" in both), before its caption; '' for any other. */
function repMpName(cv) {
  const s = cv && cv.closest('#mpSec, #fmpSec, #dmpSec');
  if (!s) return '';
  if (s.id === 'dmpSec') return `The drying's multiphysics (MP-5, ${DMP_DIMS[DMS.dim]}) · `;
  return s.id === 'mpSec' ? `The stack's multiphysics (MP-1, ${MP_DIMS[MPS.dim]}) · ` : `The furnace's multiphysics (MP-2, ${MP_DIMS[FMS.dim]}, ${FURN_RUNS[FMS.run]}) · `;
}
/** The Numerics panel as a table (NUM-1): each stage, its method and its setting, Automatic resolved. */
function repNumerics(kind, lede) {
  return `<h3>Numerics</h3><p class="lede">${repEsc(lede)}.</p>` + repRows(numericsReportRows(kind).map(([st, m, set]) => [repEsc(st), repEsc(m), repEsc(set)]), ['Stage', 'Method', 'Setting']);
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
  return `<p class="lede">Used by every module (CFD locations may set their own gap, contact angle, speed, pressure and slurry: see 2D CFD). Values changed from the default are in bold.</p>
    <table><thead><tr><th>Input</th><th>Value</th><th>Default</th></tr></thead><tbody>${rows}</tbody></table>`;
}
async function repModule(m, statsTitle = 'Results') {
  if ([1, 2, 3, 7].includes(m)) await oneDWait(true);   // (the Results pages: the solved answers across the web)
  tab = m; render(); await repFrame();
  let html = '';
  if (m === 0) {
    html += '<h3>Scenario</h3>' + repRows(ANIM_UNDO.map(([k, l, f]) => [repEsc(l), repEsc(f(ANIM[k]))]), ['Setting', 'Value']);
  }
  if (m === 11) html += acrossReportHTML();
  if (m === 15) html += feedReportHTML();
  if (m === 16 || m === 17) html += poolReportHTML(m - 14);
  // (a tile's note under its number, e.g. the 3D's "plain flow curve", goes with its value)
  const stats = [...document.querySelectorAll('#ss .stat')].map(s => { const t = s.querySelector('small.stat-tag'); return [repEsc(cleanText(s.querySelector('span'))), repEsc(cleanText(s.querySelector('strong')) + (t ? ` (${cleanText(t)})` : ''))]; });
  if (stats.length) html += `<h3>${statsTitle}</h3>` + repRows(stats, [statsTitle === 'Results' ? 'Result' : statsTitle, 'Value']);
  // (not an editor's drawing; a multiphysics step's charts only once it is solved for the inputs as they are, never empty)
  const figs = imageTargets().filter(t => t.id.startsWith('pane:') && !t.canvases().some(c => c.closest('.no-report')) && t.canvases().every(repMpSolved));
  if (figs.length) html += '<h3>Plots</h3>' + figs.map(t => repFigure(t, repMpName(t.canvases()[0]) + t.title())).join('');
  const pills = [...document.querySelectorAll('#st .pill')].map(p => `<li class="${p.classList.contains('bad') ? 'bad' : p.classList.contains('warn') ? 'warn' : 'ok'}">${repEsc(cleanText(p))}</li>`);
  const scope = cleanText(document.getElementById('scope'));
  html += `<h3>Checks</h3>${pills.length ? `<ul class="checks">${pills.join('')}</ul>` : ''}${scope ? `<p class="scope">${repEsc(scope)}</p>` : ''}`;
  return html;
}
/** Process: the chain and where each stage stands, the answers, the plot, the mass balance at each location, the oven's zones. */
async function repProcess() {
  // (GO-6: the page shows one stage at a time; for the report every stage, step, view and chart is drawn open, as one
  // long page, so each figure is taken at its size, then the stage view comes back)
  PROC_ALL = true;
  try { return await repProcessAll(); } finally { PROC_ALL = false; if (tab === 12) render(); }
}
async function repProcessAll() {
  await oneDWait(true);   // (the wet film across the web: the 1D, for the inputs as they are)
  await dryWait();        // (the drying in the oven, GO-3: every film, both ways the water may leave)
  await filmWait();       // (the film followed on to the peel, GO-4)
  if (typeof sheetWait === 'function') await sheetWait();   // (a piece of it in 3D, GO-4d)
  if (typeof stackWait === 'function') await stackWait();   // (the pieces in the pressed stack, let go, GO-4f)
  if (typeof furnWait === 'function') await furnWait();     // (the furnace and the graphene film, GO-5)
  // (the module as cut; out of the stack and a day later after it)
  const keepState = typeof SHEET !== 'undefined' ? SHEET.state : null;
  if (keepState) SHEET.state = 'cut';
  let html = await repModule(12);
  // (the chain: each stage, where it stands and its line -- from the stages themselves, one shown at a time on the tab)
  const chain = processStages().map(g => [repEsc(g.t), repEsc(STAGE_ST[g.st][0]), repEsc(String(g.s).replace(/<[^>]*>/g, ''))]);
  const t = document.querySelector('.proc-mb'), note = document.querySelector('#procTable .fv-note');
  // (each zone's top, GO-3: what is above the film and its values)
  const topText = z => { const k = z.top || 'none', air = k === 'air' || k === 'air+ir', ir = k === 'ir' || k === 'air+ir';
    return [OVEN_TOPS[k], ...OVEN_TOP_FIELDS.filter(f => f[7] === 'air' ? air : ir).map(([kk, l, u, , , , d]) => `${l.toLowerCase()} ${repNum(z[kk], d)} ${u}`)].join('; '); };
  const zones = OVEN.zones.map((z, i) => [`Zone ${i + 1}`, ...OVEN_ZONE_FIELDS.map(([k, , u, , , , d]) => repEsc(repUnit(repNum(z[k], d), u))), repEsc(topText(z))]);
  const o = ovenTime(P.U / 60);
  // the drying (GO-3): its checks, its numbers for the film shown, the table of every film, the measured, its note
  const dt = document.querySelector('.dry-table'), dNote = document.getElementById('dryNote');
  const dPills = [...document.querySelectorAll('#dryState .pill')].map(p => `<li class="${p.classList.contains('bad') ? 'bad' : p.classList.contains('warn') ? 'warn' : 'ok'}">${repEsc(cleanText(p))}</li>`);
  const dStats = [...document.querySelectorAll('#dryStats .stat')].map(s => [repEsc(cleanText(s.querySelector('span'))), repEsc(cleanText(s.querySelector('strong')))]);
  const m = MAT.dryMeas || { temps: [], exit: [] };
  const mRows = [...m.temps.map(q => [repEsc(q.name), 'temperatures in the oven', `${q.rows.length} readings`]),
    ...m.exit.map(q => [q.loc === 'web' ? 'The web' : q.loc, 'at the oven\'s exit', repEsc([Number.isFinite(q.water) ? `${q.water} % water left` : '', Number.isFinite(q.h) ? `dry film ${q.h} µm` : '', Number.isFinite(q.dryAt) ? `dry at ${q.dryAt} m` : ''].filter(Boolean).join(', '))])];
  const drying = '<h3>Drying in the oven</h3>' + (dPills.length ? `<ul class="checks">${dPills.join('')}</ul>` : '')
    + (dStats.length ? repRows(dStats, [`${repEsc(dryFilmName(DRY.sel))}`, 'Top only · top and bottom']) : '')
    + (dt ? repTable(dt, { max: 12 }) : '<p class="lede">The drying could not be solved for these inputs.</p>')
    + (mRows.length ? '<h4>Measured drying</h4>' + repRows(mRows, ['Measured', 'What', '']) : '')
    + (dNote && cleanText(dNote) ? `<p class="lede">${repEsc(cleanText(dNote))}</p>` : '');
  // the film peeled off (GO-4): its warnings, the checks, its numbers for the film shown, the table, the measured and
  // what they imply, its note, and the peel's place and the winder's core
  const fPills = [...document.querySelectorAll('#filmState .pill')].map(p => `<li class="${p.classList.contains('bad') ? 'bad' : p.classList.contains('warn') ? 'warn' : 'ok'}">${repEsc(cleanText(p))}</li>`);
  const fChecks = [...document.querySelectorAll('#filmChecks .film-check')].map(c => [repEsc(cleanText(c.querySelector('h4'))), ...[...c.querySelectorAll('.film-v')].map(v => repEsc(cleanText(v).replace(/^top only\s*|^top and bottom\s*/, '')))]);
  const fStats = [...document.querySelectorAll('#filmStats .stat')].map(s => [repEsc(cleanText(s.querySelector('span'))), repEsc(cleanText(s.querySelector('strong')))]);
  const fm = MAT.filmMeas || { curl: [], cracks: [], peel: [] }, fLoc = q => q.loc === 'web' ? 'The web' : q.loc;
  const fmRows = [...(fm.curl || []).map(q => [fLoc(q), 'curl', repEsc([Number.isFinite(q.R) ? `radius ${q.R} mm` : '', Number.isFinite(q.lift) ? `edges lift ${q.lift} mm over ${q.sheet} mm` : '', q.toward === 'bottom' ? 'away from its top' : 'toward its top', FILM_WHEN[q.when] || ''].filter(Boolean).join(', '))]),
    ...(fm.cracks || []).map(q => [fLoc(q), 'cracks', repEsc([Number.isFinite(q.spacing) ? `${q.spacing} mm apart` : '', Number.isFinite(q.width) ? `${q.width} µm wide` : '', { web: 'on the web', peel: 'after peeling', roll: 'on the roll' }[q.where] || ''].filter(Boolean).join(', '))]),
    ...(fm.peel || []).map(q => [fLoc(q), 'peel force', repEsc(`${q.f} N/m at ${q.angle}°`)])];
  const fImp = [...document.querySelectorAll('#filmMeas .film-imp li')].map(li => `<li class="ok">${repEsc(cleanText(li).replace(/\s*Use (top only|top and bottom)'s/g, ''))}</li>`);
  const ft = document.querySelector('.film-table'), fNote = document.getElementById('filmNote'), pl = OVEN.peel;
  const film = '<h3>The film, peeled off</h3>' + (fPills.length ? `<ul class="checks">${fPills.join('')}</ul>` : '')
    + (fChecks.length ? repRows(fChecks, [repEsc(dryFilmName(DRY.sel)), 'Top only', 'Top and bottom']) : '<p class="lede">The film could not be solved for these inputs.</p>')
    + (fStats.length ? repRows(fStats, ['', 'Top only · top and bottom']) : '')
    + (ft ? repTable(ft, { max: 12 }) : '')
    + (fmRows.length ? '<h4>Measured film</h4>' + repRows(fmRows, ['Measured', 'What', '']) + (fImp.length ? `<ul class="checks">${fImp.join('')}</ul>` : '') : '')
    + '<h4>After the oven</h4>' + repRows([...OVEN_PEEL_FIELDS.map(([k, l, u, , , , d]) => [repEsc(l), repEsc(repUnit(repNum(pl[k], d), u))]),
      ['The stack stands on', repEsc(OVEN_SHELVES[pl.shelf] || '')]], ['', 'Value'])
    + (fNote && cleanText(fNote) ? `<p class="lede">${repEsc(cleanText(fNote))}</p>` : '');
  // a piece in 3D (GO-4d): its state line, the two shapes in words, the measured size and what it implies (the drawings go with the plots)
  const sSt = document.getElementById('sheetState'), sL = ['sh1Lg', 'sh2Lg'].map(id => document.getElementById(id)).filter(Boolean);
  const sRows = ((MAT.filmMeas || {}).size || []).map(q => [q.loc === 'web' ? 'The web' : q.loc, repEsc(`size pressed flat, ${SHEET_WHEN[q.when] || SHEET_WHEN.dry}`), repEsc([Number.isFinite(q.L) ? `${q.L} mm long` : '', Number.isFinite(q.W) ? `${q.W} mm wide` : ''].filter(Boolean).join(', '))]);
  const sImp = [...document.querySelectorAll('#sheetMeas .film-imp li')].map(li => `<li class="ok">${repEsc(cleanText(li).replace(/\s*Use (top only|top and bottom)'s/g, ''))}</li>`);
  let piece = sSt && cleanText(sSt) ? `<h4>A piece cut from the roll, in 3D (${SHEET_WAYS[SHEET.way]})</h4><p class="lede">${repEsc(cleanText(sSt))}</p>` + repRows([['Held up (free)', repEsc(cleanText(sL[0]))], ['On a table (its weight)', repEsc(cleanText(sL[1]))]], ['', 'Its shape'])
    + (sRows.length ? repRows(sRows, ['Measured', 'What', '']) + (sImp.length ? `<ul class="checks">${sImp.join('')}</ul>` : '') : '') : '';
  // the pressed stack (GO-4f): its line and tiles (its two charts go with the plots); the piece out of the stack and a
  // day later, each in words and drawn
  const kSt = document.getElementById('stackState'), kTiles = [...document.querySelectorAll('#stackStats .stat')].map(el => [repEsc(cleanText(el.querySelector('span'))), repEsc(cleanText(el.querySelector('strong')))]);
  if (kSt && cleanText(kSt)) piece += `<h4>In the pressed stack, and out of it</h4><p class="lede">${repEsc(cleanText(kSt))}</p>` + (kTiles.length ? repRows(kTiles, ['', 'Top only · top and bottom']) : '');
  if (keepState && typeof stackCurrent === 'function' && stackCurrent()) {
    for (const st of ['out', 'day']) {
      SHEET.state = st; sheetRender(); await repFrame();
      const lg = ['sh1Lg', 'sh2Lg'].map(id => cleanText(document.getElementById(id)));
      const figs = imageTargets().filter(t => t.id.startsWith('pane:') && ['sh1', 'sh2'].includes((t.canvases()[0] || {}).id));
      piece += `<h4>${repEsc(SHEET_STATES[st])} (${SHEET_WAYS[SHEET.way]})</h4><p class="lede">${repEsc(cleanText(document.getElementById('sheetState')))}</p>`
        + repRows([['Held up (free)', repEsc(lg[0])], ['On a table (its weight)', repEsc(lg[1])]], ['', 'Its shape'])
        + figs.map(t => repFigure(t, `${SHEET_STATES[st]}: ${t.title()}`)).join('');
    }
  }
  if (keepState) { SHEET.state = keepState; sheetRender(); }
  // the drying's multiphysics (MP-5): each dimension solved for the inputs as they are, its answers side by side
  let dmpRep = '';
  if (typeof dmpCurrent === 'function') {
    const dims = [1, 2, 3].filter(d => dmpCurrent(d));
    if (dims.length) {
      const S = d => DMS.res[d].summary, m = v => (v == null ? '—' : `${v.toFixed(2)} m`);
      const rows = [['Skin forms (the film\'s middle)', d => m(S(d).mid.skin)], ['Dry (the film\'s middle)', d => (S(d).mid.dry != null ? m(S(d).mid.dry) : 'not in the oven')],
        ['Water at the exit (the middle)', d => `${S(d).mid.waterPct.toFixed(1)} % of its GO`], ['Film\'s ends at the exit', d => (S(d).endL ? `${S(d).endL.waterPct.toFixed(1)} %` : '—')],
        ['Air under the film', d => (d === 1 ? 'up through the web at the zone\'s speed' : `${(S(d).under * 1000).toFixed(2)} mm/s`)], ['Hottest film', d => `${S(d).Tmax.toFixed(1)} °C`],
        ['Drying stress, largest', d => (DMS.res[d].stress && DMS.res[d].stress.peak != null ? `${(DMS.res[d].stress.peak / 1e6).toFixed(2)} MPa` : 'none')], ['Solved in', d => `${(DMS.res[d].ms / 1000).toFixed(1)} s`]];
      dmpRep = `<h4>The drying's multiphysics (MP-5)</h4><p class="lede">${repEsc(`Heat, water, the oven's air through the web and the drying stress solved together; the water leaving ${dmpWhere() === 'both' ? 'from the top and the underside' : 'from the top only'}.`)}</p>`
        + repRows(rows.map(([l, f]) => [repEsc(l), ...dims.map(d => repEsc(f(d)))]), ['', ...dims.map(d => DMP_DIMS[d])]);
    }
  }
  // the stack's multiphysics (MP-1): each dimension solved for the inputs as they are, its answers side by side
  if (typeof mpCurrent === 'function') {
    const dims = [1, 2, 3].filter(d => mpCurrent(d)), mid = MP_N / 2;
    if (dims.length) {
      const S = d => MPS.res[d].summary, X = (d, k) => S(d)[k].find(q => q.i === mid);
      const rows = [['Middle piece at the oven\'s end', d => `${S(d).ovenEnd.mid.toFixed(1)} °C`], ['Middle piece within 2 °C of the air', d => (S(d).midWithin2 != null ? mpMin(S(d).midWithin2 / 60) : 'not in the oven')],
        ['Middle piece\'s middle dry after', d => (S(d).dryThrough != null ? mpMin(S(d).dryThrough / 60) : 'not in the oven')], ['Middle piece out of the oven (mean)', d => mpPct(X(d, 'Xoven').mean)],
        ['Middle piece when taken out (mean)', d => mpPct(X(d, 'Xout').mean)], ['Largest pull, held flat', d => (d === 1 ? 'none' : `${S(d).pull.toFixed(0)} MPa`)], ['Solved in', d => `${(MPS.res[d].ms / 1000).toFixed(1)} s`]];
      piece += `<h4>The stack's multiphysics (MP-1)</h4><p class="lede">${repEsc(`Heat, water and stress solved together (${OVEN.peel.plateT} mm aluminium plate, ${OVEN.peel.stackAirU > 0 ? `a fan's air at ${OVEN.peel.stackAirU} m/s` : 'still air'}, ${OVEN_SHELVES[OVEN.peel.shelf].toLowerCase()}).`)}</p>`
        + repRows(rows.map(([l, f]) => [repEsc(l), ...dims.map(d => repEsc(f(d)))]), ['', ...dims.map(d => MP_DIMS[d])]);
    }
  }
  // the furnace and the graphene film (GO-5): its line and warnings, the five checks, the tiles, the measured and what
  // they mean, the runs and the stack as set, its note (its six charts go with the plots)
  let furn = '';
  const uSt = document.getElementById('furnState');
  if (uSt) {
    const uPills = [...uSt.querySelectorAll('.pill')].map(p => `<li class="${p.classList.contains('bad') ? 'bad' : p.classList.contains('warn') ? 'warn' : 'ok'}">${repEsc(cleanText(p))}</li>`);
    // (the furnace's line: what goes in, the runs and the stack -- in Setup's parts on the tab, whole here)
    const uLine = uSt.querySelector('.dry-where') || (FURN.res && furnCurrent() ? (() => { const d = document.createElement('div'); d.innerHTML = furnStateText(FURN.res); return d.firstElementChild; })() : null), uNote = document.getElementById('furnNote');
    // (all five checks, not only the one shown: each its word and level, then its sentences)
    const uChecks = FURN.res && furnCurrent() ? furnLights(FURN.res).map(q => { const d = document.createElement('div'); d.innerHTML = furnCheckBody(FURN.res, q.k);
      return [repEsc(q.t), repEsc(`${furnWord(q)}${Number.isFinite(q.v) ? ` (${(q.v * 100).toFixed(0)} % of its limit)` : ''}: ${[...d.querySelectorAll('.film-v')].map(v => cleanText(v)).join('; ')}`)]; }) : [];
    // (the stack's top, middle and bottom pieces side by side, the batch under them; GO-7)
    const uPieces = FURN.res && furnCurrent() ? [...document.querySelectorAll('#furnPieces tbody tr:not(.furn-pos-g)')].map(tr => [...tr.children].map(td => repEsc(cleanText(td)))) : [];
    const uBatch = cleanText(document.querySelector('#furnPieces > p')), uShownQ = FURN.res && furnCurrent() ? furnView(FURN.res).piece : null, uShown = uShownQ && uShownQ.name !== 'only' ? `the ${uShownQ.name} piece` : '';
    const uStats = [...document.querySelectorAll('#furnStats .stat')].map(el => [repEsc(cleanText(el.querySelector('span'))), repEsc(cleanText(el.querySelector('strong'))), repEsc(cleanText(el.querySelector('small')))]);
    const um = (MAT.furnMeas || {}).out || [], uRows = um.map(q => [q.loc === 'web' ? 'The web' : q.loc, repEsc([Number.isFinite(q.h) ? `${q.h} µm thick` : '', Number.isFinite(q.kept) ? `${q.kept} % of its weight kept` : '', Number.isFinite(q.kappa) ? `${q.kappa} W/(m·K) along it` : ''].filter(Boolean).join(', '))]);
    // (where in the stack yours stick, GO-7c)
    if (Number.isFinite((MAT.furnMeas || {}).stuckFrom)) uRows.push(['The stack', repEsc(`stuck to their papers from the ${furnOrd(MAT.furnMeas.stuckFrom)} piece down; the pieces above it free`)]);
    const uImp = [...document.querySelectorAll('#furnMeas .film-imp li')].filter(li => !li.classList.contains('fv-why')).map(li => `<li class="ok">${repEsc(cleanText(li).replace(/\s*(Use|Fit the [^.]*?(to it|to my first run))\s*/g, ' ').trim())}</li>`);
    const fu = OVEN.furn, runRows = [0, 1].map(r => { const R = fu.runs[r], pts = furnProgram(r); return [FURN_RUNS[r], repEsc(R.file ? `your file ${R.file.name} (${pts.length} points)` : `${R.steps.map(q => `${q.rate} °C/min to ${q.to} °C${q.hold ? `, ${q.hold} min` : ''}`).join('; ')}; cools at ${R.cool} °C/min`), `${(pts[pts.length - 1][0] / 3600).toFixed(1)} h`]; });
    const stackRows = [...FURN_FIELDS.filter(f => (f[0] !== 'gap' || fu.room === 'gap') && (f[0] !== 'plateT' || fu.ends !== 'papers')).map(([k, l, u, , , , d]) => [repEsc(l), fu[k] == null ? 'not known' : repEsc(repUnit(repNum(fu[k], d), u)), '']), ['Above the stack', repEsc(FURN_ROOM[fu.room]), ''],
      ['The top and bottom pieces touch', repEsc(FURN_ENDS[fu.ends === 'papers' ? 'papers' : 'plates']), '']];
    furn = '<h3>The furnace and the graphene film</h3>' + (uPills.length ? `<ul class="checks">${uPills.join('')}</ul>` : '')
      + (uLine ? `<p class="lede">${repEsc(cleanText(uLine))}</p>` : '')
      + (uChecks.length ? repRows(uChecks, [repEsc(dryFilmName(DRY.sel)), 'In the furnace']) : '<p class="lede">The furnace could not be solved for these inputs.</p>')
      + (uPieces.length ? '<h4>The stack\'s pieces</h4>' + repRows(uPieces, ['', 'Weight on it', 'Thickness', 'Its spread', 'Pull', 'Squeeze', 'Sticks from']) + (uBatch ? `<p class="lede">${repEsc(uBatch)}</p>` : '') : '')
      + (uStats.length ? repRows(uStats, [uShown ? `The graphene film, ${repEsc(uShown)}` : 'The graphene film', 'Value', '']) : '')
      + (uRows.length ? '<h4>Measured graphene film</h4>' + repRows(uRows, ['Measured', '']) : '') + (uImp.length ? `<ul class="checks">${uImp.join('')}</ul>` : '')
      + '<h4>The furnace as set</h4>' + repRows([...runRows, ...stackRows], ['', 'Value', ''])
      + (uNote && cleanText(uNote) ? `<p class="lede">${repEsc(cleanText(uNote))}</p>` : '');
  }
  // the furnace's multiphysics (MP-2): each dimension solved for the inputs as they are, its answers side by side
  if (typeof fmpCurrent === 'function') {
    const dims = [1, 2, 3].filter(d => fmpCurrent(d));
    if (dims.length) {
      const S = d => FMS.res[d].summary, K = v => `${v.toFixed(v < 10 ? 1 : 0)} K`, gas = d => fmpGasByRun(FMS.res[d]);
      const rows = [['Behind the program, heating (run 1 · run 2)', d => S(d).runs.map(q => K(q.lag)).join(' · ')],
        ['Its own heat above the program, run 1', d => (S(d).runs[0].over >= 1 ? `${K(S(d).runs[0].over)} at ${S(d).runs[0].overAt.T.toFixed(0)} °C` : 'none')],
        ['Across the stack at once', d => K(Math.max(...S(d).runs.map(q => q.spread)))],
        ['Labile oxygen half gone (the middle piece)', d => (S(d).labileMid ? `${S(d).labileMid.T.toFixed(0)} °C (the program ${S(d).labileMid.Tprog.toFixed(0)} °C)` : '—')],
        ['Gas against the layers\' hold (run 1 · run 2)', d => gas(d).map(g => `${g.ratio.toFixed(g.ratio >= 10 ? 0 : 2)}×`).join(' · ')],
        ['Pull, converting unevenly', d => `${S(d).pull.toFixed(1)} MPa`], ['Solved in', d => `${(FMS.res[d].ms / 1000).toFixed(1)} s`]];
      const ref = S(dims[0]).labileRef;
      furn += `<h4>The furnace's multiphysics (MP-2)</h4><p class="lede">${repEsc(`Heat, chemistry, gas and stress solved together: the holder heated by the hot zone at the program's temperature and the argon, the GO's own heat as its labile oxygen leaves (${MAT.furn.Hr.v} kJ/g). At the program's own temperature the labile oxygen is half gone at ${ref ? ref.Tprog.toFixed(0) + ' °C' : '—'}.`)}</p>`
        + repRows(rows.map(([l, f]) => [repEsc(l), ...dims.map(d => repEsc(f(d)))]), ['', ...dims.map(d => MP_DIMS[d])]);
    }
  }
  return '<h3>The chain</h3>' + repRows(chain.map(([a, b, c]) => [a, b, c]), ['Stage', 'Where it stands', '']) + html
    + drying + dmpRep
    + film + piece + furn
    + (t ? '<h3>The mass balance at each location</h3>' + repTable(t) + (note ? `<p class="lede">${repEsc(cleanText(note))}</p>` : '') : '')
    + `<h3>The oven</h3>` + repRows(zones, ['', ...OVEN_ZONE_FIELDS.map(f => repEsc(f[1])), 'Above the film']) + `<p class="lede">${repEsc(`${+o.len.toFixed(2)} m in all; the film is in it for ${Number.isFinite(o.t) ? (o.t / 60).toFixed(1) + ' min' : '—'} at ${P.U} m/min.`)}</p>`;
}
/** Materials: the slurry card (each value, where it is from and its source), what follows from it, and the other two cards as they are. */
async function repMaterials() {
  tab = 13; render(); await repFrame();
  const c = MAT.slurry;
  const card = MAT_SLURRY.map(([k, l, u, , , , d]) => [repEsc(l), repEsc(repUnit(repNum(c[k].v, d), u)), 'Constant', repEsc(c[k].src)]);
  // (what follows from the cards: the material hub's calculated values, MH-5)
  const derived = [...hubCalcRows('slurry', ['rho', 'wm', 'X0']), ...hubCalcRows('gofilm', ['rho'])].map(([l, v, u, s]) => [repEsc(l), repEsc(repUnit(v, u)), 'Calculated', repEsc(s)]);
  const ro = rows => rows.map(([l, v, u, f, s]) => [repEsc(l), repEsc(repUnit(v, u)), f === 'calc' ? 'Calculated' : 'Constant', repEsc(s)]);
  const head = ['', 'Value', 'Method', 'Data source'];
  const pills = [...document.querySelectorAll('#st .pill')].map(p => `<li class="${p.classList.contains('bad') ? 'bad' : p.classList.contains('warn') ? 'warn' : 'ok'}">${repEsc(cleanText(p))}</li>`);
  // the rheometer tests (GO-1): each one's plot and fit table, as the card shows them
  let tests = '';
  if ((MAT.tests || []).length) {
    const keepSel = RT.sel, keepHub = { ...HUB };
    Object.assign(HUB, { view: 'lib', sel: 'slurry', tab: 'meas' });
    tests = '<h3>Rheometer tests</h3>';
    for (const t of MAT.tests) {
      RT.sel = t.id; render(); await repFrame();
      const tg = imageTargets().find(x => x.id === 'rheometer');
      tests += `<h4>${repEsc(t.name)} · ${repEsc(RT_KINDS[t.kind])}</h4>` + `<p class="lede">${repEsc(cleanText(document.querySelector('.rt-meta')))}</p>`
        + (tg ? repFigure(tg, `${t.name} · ${RT_KINDS[t.kind]}`) : '') + repTable(document.querySelector('#rtTable table'))
        + [...document.querySelectorAll('#rtTable .mat-warn, #rtBody > .mat-warn')].map(p => `<p class="warn">${repEsc(cleanText(p))}</p>`).join('')
        + [...document.querySelectorAll('#rtTable .rt-note')].map(p => `<p class="lede">${repEsc(cleanText(p))}</p>`).join('');
    }
    RT.sel = keepSel; Object.assign(HUB, keepHub); render(); await repFrame();
  }
  // the flakes' alignment card, and what was measured of it (SEM images, tables of angles)
  const semRows = [...(MAT.sem.images || []).map(im => { const p = orImagePoints(im), q = p.angles.length ? orCutStatsSafe(p) : null; return [repEsc(im.name), im.cut === 'cd' ? 'across the web' : 'along the web', p.angles.length ? `${p.angles.length} angles${im.auto && im.useAuto !== false ? ' (read automatically)' : ''}${im.hand.length ? `, ${im.hand.length} by hand` : ''}` : 'not read', q ? `mean ${q.mean.toFixed(1)}°, spread ${q.spread.toFixed(1)}°` : '—']; }),
    ...(MAT.sem.tables || []).map(t => { const q = cut => { const r = t.rows.filter(x => x[0] === cut); return r.length ? `${cut === 'md' ? 'along' : 'across'}: ${r.length}, spread ${orCutStats(r.map(x => x[2])).spread.toFixed(1)}°` : ''; }; return [repEsc(t.name) + ' (table)', [q('md'), q('cd')].filter(Boolean).join('; '), `${t.rows.length} angles`, t.thickness ? `film ${t.thickness} µm` : t.fraction ? 'depths as fractions' : '']; })];
  return '<h3>Slurry: GO in water</h3>' + repRows([...card, ...derived], head)
    + '<h3>Slurry: how it flows</h3>' + repRows(ro(matRheoRows()), head)
    + '<h3>Flakes: how they line up</h3>' + repRows(ro(orCardRows()), head)
    + (semRows.length ? '<h4>Measured: SEM cross-sections and angle tables</h4>' + repRows(semRows, ['Measured', 'Cut', 'Angles', '']) : '')
    + '<h3>Drying: the film in the oven</h3>' + repRows([...ro(dryCardRows()), ...[...hubCalcRows('slurry', ['D0', 'Dc']), ...hubCalcRows('gofilm', ['Xlast'])].map(([l, v, u, s]) => [repEsc(l), repEsc(repUnit(v, u)), 'Calculated', repEsc(s)])], head)
    + '<h3>Film: the dry film on the fibre web</h3>' + repRows([...ro(filmCardRows()), ...[...hubCalcRows('gofilm', ['epsF', 'Ewet', 'swell']), ...hubCalcRows('web', ['EA'])].map(([l, v, u, s]) => [repEsc(l), repEsc(repUnit(v, u)), 'Calculated', repEsc(s)])], head)
    + '<h3>Furnace: the furnace and the graphene film</h3>' + repRows([...ro(furnCardRows()), ...[...hubCalcRows('gofilm', ['kept', 'co1', 'co2', 'split']), ...hubCalcRows('gfilm', ['k'])].map(([l, v, u, s]) => [repEsc(l), repEsc(repUnit(v, u)), 'Calculated', repEsc(s)])], head)
    + tests
    + '<h3>Fibre web: what it is coated onto</h3>' + repRows(ro(matFibreRows()), head)
    + '<h3>Material constants</h3>' + repRows(ro(libCardRows()), head)
    // (the spec's materials no solver reads at present; copies of a material and the domains they are assigned to, MC-2)
    + '<h3>GO paste, carbonized film, blade material</h3>' + repRows(MAT_XREC.map(([k, l, u, , , , d]) => [repEsc(l), MAT.xrec[k].v == null ? '—' : repEsc(repUnit(repNum(MAT.xrec[k].v, d), u)), 'Constant', repEsc(MAT.xrec[k].src || '')]), head)
    + (hubInsts().length ? '<h3>Copies of materials and their domains</h3>' + repRows(hubInsts().map(id => { const r = hubRec(id), B = hubBaseRec(r.base), a = (MAT.assign || {})[B.id] || {};
      const doms = B.domains.filter((d, i) => a[i] === id); return [repEsc(hubName(r)), repEsc(hubName(B)), repEsc(doms.length ? doms.join('; ') : 'not assigned'), repEsc(hubProps(B).filter(p => p.b.t === 'card' && JSON.stringify(MAT.inst[id].vals[p.id]) !== JSON.stringify(MAT[p.b.card][p.b.k])).map(p => hubPropName(r, p)).join(', ') || 'none')]; }),
      ['Copy', 'Of', 'Assigned to', 'Values that differ from it']) : '')
    + (hubDefRows().length ? '<h3>Defined in temperature</h3>' + repRows(hubDefRows().map(([l, h, s]) => [repEsc(l), repEsc(h), repEsc(s)]), ['', 'Definition', 'Taken in temperature by']) : '')
    // (the laws in temperature the solvers take, with their parameters as they are now, MC-1b)
    + '<h3>Laws in temperature</h3>' + repRows(Object.entries(HUB_LAW).map(([id, L]) => { const law = ML_LAWS[L.q.law], prm = Object.entries(hubLawParams(id)).map(([k, x]) => `${k} = ${Array.isArray(x) ? x.map(q => hubFmt(q, -6)).join(', ') : hubFmt(x, -6)}${!Array.isArray(x) && law.params[k] ? ' ' + law.params[k] : ''}`).join('; ');
      return [repEsc(hubLawName(id)), repEsc(repUnit(hubFmt(hubLawAt(id, 20), -4), L.u)) + ' at 20 °C', 'Equation in T', repEsc(`${law.formula}: ${prm}. ${L.src}${(MAT.law || {})[id] ? ' (parameters edited)' : ''}`)]; }), head)
    + (pills.length ? `<h3>Checks</h3><ul class="checks">${pills.join('')}</ul>` : '');
}
/** Coating › 3D: its setup, then the page (the 3D view drawn once three.js is in). */
async function rep3D() {
  try { await load3DLibs(); } catch (e) { /* (the report goes without the 3D view) */ }
  const eg = C3D.region === 'edge' ? c3dEdgeGeom() : null;
  const G = c3dBuild(), rg = C3D.region === 'strip' ? `strip ${C3D.stripW} mm wide at L${C3D.loc + 1} (z ${CFD_LOCS[C3D.loc].z} mm)` : eg ? `edge strip ${C3D.edgeW} mm wide at the ${C3D.edgeEnd} end, from z ${+eg.out.toFixed(2)} mm inward; its outer side open (the edge bead), its inner side a symmetry plane; contact angles on the blade ${cfdLocalContactDeg(eg.out).toFixed(1)}°, on the web ${P.thw}°; the bead pressure raised in steps from none` : `full web width, ${ACROSS_W} mm${C3D.webEdges === 'open' ? ', its edges open (the edge bead)' : ''}`;
  const rows = [['Blade', repEsc(G.label || 'no file imported')], ['Region', repEsc(rg)],
    ['Slurry', ans3DTag() ? 'the plain flow curve: the structure (thixotropy) model is on and is the 2D\'s, so the answers take the 2D (models are not mixed)' : 'the steady flow curve, as the 2D (the structure model is off)'],
    ['Mesh', repEsc(C3D.frac3 || c3dZAdapted() ? `adapted by meshing to an accuracy: ${c3dCounts().a1} along the flow, ${c3dCounts().ny} across the gap, ${c3dNz()} ${C3D.region === 'strip' ? 'across the strip' : 'across the web'}`
      : `elements: ${C3D.nxGap} along the blade, ${C3D.nxFace} up the exit face, ${C3D.nxFilm} along the free surface, ${c3dNy()} across the gap${c3dOpenEdges() ? ' (the open edges\' own)' : ''}, ${C3D.region === 'strip' ? C3D.nzStrip + ' across the strip' : eg ? `${C3D.edgeNz} across the strip (${c3dEdgeElemsText()})` : C3D.webEdges === 'open' ? `${C3D.nzFull} across the web between the edge strips, each edge strip ${C3D.edgeW} mm of ${C3D.edgeNz} (${c3dEdgeElemsText()})` : C3D.nzFull + ' across the web'}`)],
    ['Refinement zones', repEsc(`along the flow and up the gap: ${zonesText(C3D.region === 'full' ? CFDS.zones : solverOf(C3D.loc).zones)}${C3D.zoneScale !== 1 ? ` (sizes ÷${(+C3D.zoneScale).toFixed(2)})` : ''}; across: ${c3dZonesText(C3D.zZones)}${c3dNz() !== (C3D.region === 'strip' ? C3D.nzStrip : C3D.nzFull) ? ` (${c3dNz()} elements)` : ''}`)]];
  // (the mesh's preset, statistics and problems: the solved mesh while up to date, else the starting layout, estimated)
  const pr = c3dPresetOf(), MS = c3dMeshStats(), MP = c3dMeshProblems(MS), f3 = v => String(+(+v).toPrecision(3));
  rows.push(['Mesh preset', C3D.frac3 ? 'adapted (meshing to an accuracy)' : pr === 'custom' ? 'Custom' : C3D_MESH_PRESETS[pr].l]);
  if (MS) { const St = MS.S; rows.push(['Mesh statistics', repEsc(`${MS.solved ? 'as solved' : 'before solving, estimated'}: ${St.cells.toLocaleString()} hexahedra (${St.nEx} × ${St.nEy} × ${St.nEz}), ${St.nodes.toLocaleString()} velocity nodes; ${St.gap.cells} across the minimum gap, ${St.across.cells} across the ${c3dWhere()}; quality worst ${St.q.min.toFixed(2)}; aspect ratio largest ${f3(St.arXY.max)} in the x–y plane (${f3(St.ar.max)} in 3D); skewness largest ${f3(St.skew.max)}; non-orthogonality largest ${f3(St.nonOrth.max)}°${St.nonOrth.cl != null ? ` (at the contact line ${f3(St.nonOrth.cl)}°)` : ''}; ${St.invalid} invalid`)]); }
  rows.push(['Mesh errors and warnings', repEsc(MP.length ? MP.map(q => `${q.level === 'error' ? 'Error' : 'Warning'}: ${q.text}`).join(' ') : MS ? 'none' : 'not known yet (the stations are laid out on the Mesh step)')]);
  if (C3D.region === 'full') { const L = c3dWideLayout(); rows.push(['Solved as', repEsc(C3D.webEdges === 'open' ? `each end first as an edge strip (its outer side open, the bead pressure raised in steps from none; contact angle on the web ${P.thw}°); if both hold the set bead pressure, ${L.subs.length} overlapping strips (the edge strips the end strips, open on their outer sides), sweep after sweep until they agree`
    : `${L.subs.length} overlapping strips of ${L.sub} elements across, sweep after sweep until they agree; the web's edges ${P.skew ? 'open, each held at its own station\'s flow along the skewed blade' : 'symmetry planes'}`)]); }
  if (C3D.source === 'file') rows.splice(1, 0, ['File axes', repEsc(`machine direction ${C3D.machine}, up ${C3D.up}${C3D_FILE && C3D_FILE.kind === 'stl' ? `, units ${C3D.units}` : ''}`)], ['Inlet upstream of the edge', `${C3D.inlet} mm`],
    ['Exit face', C3D.fileFace === 'file' ? 'from the file: each station\'s side section (the contact line as in 2D)' : `straight at the 2D setup's angle (${CFDG.exitAngle}°)`]);
  // (solved: its Results step; else the Geometry step's numbers and view, then the Mesh step with its view)
  let pre = '';
  if (c3dShown()) C3D.step = 'results';
  else {
    tab = 9; C3D.step = 'geometry'; render(); await repFrame();
    const geo = [...document.querySelectorAll('#ss .stat')].map(s => [repEsc(cleanText(s.querySelector('span'))), repEsc(cleanText(s.querySelector('strong')))]);
    const figs = imageTargets().filter(t => t.id.startsWith('pane:')).map(t => repFigure(t, t.title())).join('');
    if (geo.length || figs) pre = '<h3>Geometry</h3>' + (geo.length ? repRows(geo, ['Geometry', 'Value']) : '') + figs;
    C3D.step = 'mesh';
  }
  const body = await repModule(9, c3dShown() ? 'Results' : 'Mesh');
  // (an open edge: its answer and its bead pressure step by step, each end's)
  let edge = '';
  if (c3dShown()) for (const box of document.querySelectorAll('.c3d-ends-ans .edge-answer, .c3d-edge')) {
    const a = box.classList.contains('edge-answer') ? box : box.querySelector('.edge-answer'), t = box.querySelector && box.querySelector('.c3d-steps'), h = box.querySelector && box.querySelector('.c3d-end-title');
    if (h) edge += `<h4>${repEsc(cleanText(h))}</h4>`;
    if (a) edge += `<p>${repEsc(cleanText(a))}</p>`;
    if (t) edge += repRows([...t.querySelectorAll('tbody tr')].map(r => [...r.children].map(td => repEsc(cleanText(td)))), [...t.querySelectorAll('th')].map(th => repEsc(cleanText(th))));
  }
  // (the mesh-independence study, when run)
  let study = '';
  if (M3S.runs.length) {
    const T = m3StudyTable(), L = p => C3D_MESH_PRESETS[p].l;
    study = `<h3>Mesh independence</h3><p>${repEsc(`The strip at L${M3S.loc + 1} (${M3S.width} mm) on ${T.P.map(L).join(', ')}, nothing else changed; run ${new Date(M3S.when).toLocaleString()}${M3S.status !== 'done' ? ` (${M3S.status})` : ''}.${T.worst && M3S.status === 'done' ? ` Largest change from ${L(T.P[T.P.length - 2])} to ${L(T.P[T.P.length - 1])}: ${(T.worst.d * 100).toPrecision(2)} % (${T.worst.l.toLowerCase()}).` : ''}`)}</p>`
      + repRows([['Hexahedra', ...T.P.map((p, j) => M3S.runs[j] ? `${M3S.runs[j].cells.toLocaleString()} (${M3S.runs[j].dims})` : ''), '', ''], ...T.rows.map(r => [repEsc(r.l), ...r.v.map(repEsc), ...r.d.map(d => repEsc(d || ''))])],
        ['Quantity', ...T.P.map(L), ...T.P.slice(1).map((p, j) => `${L(T.P[j])} → ${L(p)}`)]);
  }
  return '<h3>Setup</h3>' + repRows(rows, ['3D setting', 'Value']) + (typeof numericsReportRows === 'function' ? repNumerics('3d', 'The numerical chain as the 3D solver runs it') : '') + pre + body + (edge ? '<h3>The web\'s edge</h3>' + edge : '') + study;
}
function repCfdSetup() {
  const g = k => { const [l, f, u] = CFDG_UNDO[k] || [k]; return [repEsc(l), repEsc(repUnit(f ? f(CFDG[k]) : repNum(CFDG[k]), u))]; };
  const own = BLADE_DIMS.filter(d => d.shapes.includes(CFDG.shape)).map(d => d.k);
  const keys = ['shape', ...(CFDG.shape === 'round' ? ['R', 'pool'] : own), ...(CFDG.shape === 'custom' ? ['custom'] : ['exitAngle']), ...(bladeShapedFace() ? ['clModel'] : []), 'model', 'fibre', 'gsm', 'rhoF', 'dFrom', ...(CFDG.dFrom === 'yarn' ? ['den', 'nf'] : []), 'airPerm', 'airDP', 'kozeny', 'airFrac'];
  const rows = keys.map(g);
  // (the oven's zones, each with its drying air; the slurry's density, from its card)
  OVEN.zones.forEach((z, i) => rows.push([`Oven zone ${i + 1}`, repEsc(OVEN_ZONE_FIELDS.map(([k, l, u, , , , d]) => `${l.toLowerCase()} ${repNum(z[k], d)}${u ? ' ' + u : ''}`).join(', '))]));
  rows.push(['Slurry density', repEsc(`${repNum(slurryRho(), 0)} kg/m³ (${repNum(MAT.slurry.phi.v, 1)} vol% solids of ${repNum(MAT.slurry.rhoS.v, 2)} g/cm³ in a liquid of ${repNum(MAT.slurry.rhoL.v, 0)} kg/m³)`)]);
  if (bladeUsesL()) rows.splice(1, 0, [CFDG.shape === 'wedge' ? 'Length' : 'Land length', `${P.L} mm <small>(sidebar)</small>`]);
  const s = CFDS;
  let counts = null;
  try { counts = cfdGeometry(0).solver; } catch (e) { /* (no counts) */ }
  const solver = [
    ['Mesh', repEsc(MESH_PRESETS[s.mesh].l + (counts ? ` (at L1: ${counts.nEb} + ${counts.nEf} + ${counts.nEs} by ${counts.nEy} elements)` : ''))],
    ...SOLVER_INPUTS.filter(q => !q.custom).map(q => [repEsc(q.l), repEsc(repNum(s[q.k], q.d) + (q.u ? ' ' + q.u : ''))]),
    ['Newton tolerance', repEsc(fmtTol(s.tol))],
    ['Refinement zones', repEsc(zonesText(s.zones))],
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
    return [`L${i + 1}`, status, `${(q.Q / r.geo.U * 1000).toFixed(4)} mm`, clWhere(q, true),
      `${q.converged ? 'converged' : 'partly converged'}, ${q.iterations} steps, residual ${q.residual.toExponential(1)}`, `${(r.elapsedMs / 1000).toFixed(1)} s`];
  });
  return repRows(rows, ['Location', 'Status', 'Wet film', 'Contact line', 'Convergence', 'Solve time']);
}
async function repCfd(keep) {
  tab = 4; FV.step = 'results'; FV.view = 'compare'; FV.dock = 'metrics'; render(); await repFrame();
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
    // the flakes' alignment (GO-2): each location that has it, its panel's numbers, charts and table
    const withOr = CFD_LOCS.map((_, i) => i).filter(i => cfdRuns[i].field && cfdRuns[i].result && cfdRuns[i].result.orient);
    if (withOr.length) {
      html += '<h3>Flakes: their alignment</h3>';
      const keepTable = FV.orTable; FV.orTable = true;
      for (const i of withOr) {
        FV.view = i; FV.dock = 'flakes'; viewCFD(); await repFrame();
        const st = orStatus(i), o = cfdRuns[i].result.orient;
        html += `<h4>Location ${i + 1} · z ${CFD_LOCS[i].z} mm</h4><p class="lede">${repEsc(orientLogText(o))}${st === 'stale' ? ` ${repFlag()} The alignment's values changed since: this is for the earlier ones.` : ''}</p>`;
        for (const t of imageTargets().filter(x => x.id.startsWith('chart:'))) html += repFigure(t, `${t.title()} · ${t.subtitle()}`);
        html += repTable(document.querySelector('#cfdFlakes details.or-table table'));
      }
      FV.orTable = keepTable; FV.view = 'compare';
    }
  }
  if (typeof numericsReportRows === 'function') { const keep = FV.stepLoc; FV.stepLoc = 0; try { html += repNumerics('2d', 'The numerical chain as the solver runs it (at L1; every location the same but for its own gap and contact angle)'); } finally { FV.stepLoc = keep; } }
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
  let html = `<h3>Setup</h3><p class="lede">Full factorial at location ${DOE.loc + 1} · z ${CFD_LOCS[DOE.loc].z} mm; every other input as in 2D CFD (the base case).${DOE.design ? '' : ' Not run yet: the design being edited.'}</p>`;
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
  let html = '<p class="lede">Measured points against the model (the solved answers: the most detailed model solved; the 1D at a point\'s own settings) and, where solved, the CFD. Error = (predicted − measured) / measured.</p>';
  await oneDWait(true);   // (the model: the solved answers across the web)
  for (const ds of MEAS.sets) {
    MEAS.sel = ds.id; MEAS.dock = 'compare'; tab = TABS.indexOf('Measured data'); render(); await repFrame();
    // (the film against settings: the 1D at each point, solved in the background)
    for (let k = 0; k < 400 && ds.kind === 'film_set' && !measModel(ds); k++) await new Promise(r => setTimeout(r, 50));
    render(); await repFrame();
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
    html += `<h3>Fit</h3><p class="lede">${repEsc(new Date(f.t).toLocaleString())} · to ${repEsc(f.sets.map(id => (MEAS.sets.find(d => d.id === id) || { name: '(removed)' }).name).join(', '))} · RMS % error minimised on the ${f.model || 'fast model'}${f.applied ? ' · applied' : ' · not applied'}</p>`;
    html += repRows(f.keys.map(k => [repEsc(c(k).l), repEsc(repUnit(f.before[k], c(k).u)), `<b>${repEsc(repUnit(f.vals[k], c(k).u))}</b>${f.atBound.includes(k) ? ' <span class="warn">at the end of its range</span>' : ''}`]), ['Input', 'Before', 'Fitted']);
    html += repRows([['All chosen data', f.rmsBefore.toFixed(1), f.rmsAfter.toFixed(1), f.cfd && f.cfd.status === 'done' && f.cfd.rms != null ? f.cfd.rms.toFixed(1) : f.cfd && f.cfd.status === 'none' ? 'not modelled' : '—']], ['RMS error, %', `${f.model || 'Fast model'} before`, `${f.model || 'Fast model'} fitted`, 'CFD fitted']);
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
  const keep = { tab, view: FV.view, dock: FV.dock, doeDock: DOE.dock, measSel: MEAS.sel, measDock: MEAS.dock, step2: FV.step, step3: C3D.step };
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
        if (want.has('proc')) out.push({ id: 'proc', title: TABS[12], html: await repProcess() });
        if (want.has('mat')) out.push({ id: 'mat', title: TABS[13], html: await repMaterials() });
        for (let m = 0; m < 4; m++) if (want.has('m' + m)) out.push({ id: 'm' + m, title: TABS[m], html: await repModule(m) });
        if (want.has('m1d')) {
          await oneDWait(true);   // (the 1D solves in its worker: its results for the inputs as they are)
          for (const v of [8, 10, 11, 15]) {
            let html = await repModule(v);
            const t = v === 8 && document.querySelector('#oneDTable table');
            if (t) html += '<h3>1D, 2D and 3D</h3>' + repTable(t);
            out.push({ id: 'm1d-' + v, title: `1D: ${TABS[v]}`, html });
          }
        }
        if (want.has('pool')) for (const v of [16, 17]) out.push({ id: 'pool-' + v, title: `${v - 14}D: ${TABS[v]}`, html: await repModule(v) });
        if (want.has('cfd')) out.push({ id: 'cfd', title: TABS[4], html: await repCfd(keep) });
        if (want.has('mesh') && meshStudy) out.push({ id: 'mesh', title: 'Mesh study', html: await repMesh() });
        if (want.has('m3d')) out.push({ id: 'm3d', title: '3D: geometry and mesh', html: await rep3D() });
        if (want.has('doe')) out.push({ id: 'doe', title: TABS[5], html: await repDoe() });
        if (want.has('meas') && MEAS.sets.length) out.push({ id: 'meas', title: TABS[6], html: await repMeasured() });
      } finally {
        tab = keep.tab; FV.view = keep.view; FV.dock = keep.dock; DOE.dock = keep.doeDock; MEAS.sel = keep.measSel; MEAS.dock = keep.measDock; FV.step = keep.step2; C3D.step = keep.step3;
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
    // (Phase 0: nothing solves unasked -- models the sections show that are not solved are asked about first)
    const need = [...(o.sections.includes('proc') ? SOLVE_LINE : o.sections.some(k => ['m0', 'm1', 'm2', 'm3', 'm1d', 'meas'].includes(k)) ? ['1d'] : []), ...(o.sections.includes('pool') ? ['pool2', 'pool3'] : [])];
    if (need.length && typeof solveBeforeReport === 'function' && (await solveBeforeReport(need)) === null) return null;
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
