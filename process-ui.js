'use strict';
/*
 * process-ui.js — the Process and Materials tabs (GO-0).
 * Process: the line as a chain of stages (the slurry, the coating under the blade, the flakes' alignment, drying
 * in the oven, the film peeled off the fibre web, its properties), each with where it stands; the first answers
 * from a mass balance on the wet film the flow models give (the dry film, the coat weight, the water the oven must
 * take out, the time in the oven); the oven's zones in the inputs bar.
 * Materials: the cards -- the slurry (GO solids in water, each value with its unit, source and flag: edited here);
 * how it flows (the rheology model, chosen here or in Coating › 2D; the sidebar's viscosity, n, yield stress and surface
 * tension as they are; the Carreau–Yasuda and Cross laws' extras and the structure (thixotropy) model edited here,
 * GO-1); and, as set elsewhere, the fibre web it is coated onto.
 */

// ---- the films the chain starts from ----
/** At location i, the wet film (m) of the most detailed model solved for the inputs as they are (answers.js: 3D, else 2D,
 *  else the 1D) and which; null while the 1D solves. */
function processFilmAt(i) {
  const a = ansAt(i);
  return a ? { h: a.film, src: a.src } : null;
}
/** The wet film across the web (answers.js: the 1D's profile at the level of the models solved at the locations) over the
 *  width it covers (where the blade is): ∫ h dz (m²), that width (m), the mean, the range, and where it is from. */
function processWeb() {
  const X = ansAcross();
  if (!X || X.z.length < 2) return null;
  const A = X.z.map((z, k) => ({ z, film: X.film[k] }));
  let area = 0;
  for (let k = 1; k < A.length; k++) area += (A[k].film + A[k - 1].film) / 2 * (A[k].z - A[k - 1].z) / 1000;
  const width = (A[A.length - 1].z - A[0].z) / 1000, films = A.map(r => r.film);
  return { A, area, width, mean: area / width, min: Math.min(...films), max: Math.max(...films), src: X.src, label: X.label, tag: X.src === '1D' ? '1D across the web' : `1D across the web, scaled to the ${ANS_SRC[X.src]}` };
}
/** The line speed (m/s): the web's, through the oven. */
const lineSpeed = () => P.U / 60;
const um0 = v => (v * 1e6).toFixed(0), gm2 = v => v.toFixed(0);

// ---- the chain ----
const STAGE_ST = { set: ['Set', 'ok'], solved: ['Solved', 'ok'], busy: ['Solving', 'muted'], failed: ['Not solved', 'bad'], part: ['Mass balance', 'accent'], todo: ['Not solved yet', 'muted'], wait: ['Run the 2D', 'muted'], later: ['Later phase', 'muted'], none: ['Not modelled yet', 'muted'] };
// (the drying stage, go 'dry': scrolls to its section under the chain; 'oven' kept for the zones in the inputs bar)
function processStages() {
  const c = MAT.slurry, keys = Object.keys(c), nA = keys.filter(k => c[k].flag === 'assumed').length;
  const two = CFD_LOCS.map((_, i) => twoDAt(i)), n2 = two.filter(t => t && !t.stale).length, s2 = two.filter(t => t && t.stale).length;
  const S3 = typeof C3D_RES !== 'undefined' && C3D_RES ? C3D_RES : null, stale3 = S3 && S3.key !== c3dSolveKey3(S3);
  const one = ONE_D.res && oneDCurrent(), o = ovenTime(lineSpeed());
  return [
    { k: 'slurry', t: 'Slurry', go: 13, st: 'set', s: `GO in water, ${c.phi.v} vol% solids; ${nA} of ${keys.length} values assumed` },
    { k: 'coat', t: 'Coating under the blade', go: 8, st: one ? 'solved' : ONE_D.error ? 'failed' : 'busy',
      s: [one ? `wet film ${ansFrom((processWeb() || { src: '1D' }).src)}` : ONE_D.error ? '1D not solved' : '1D solving…', n2 ? `2D at ${n2} of 4 locations` : '', s2 ? `${s2} 2D out of date` : '', S3 ? `3D ${stale3 ? 'out of date' : 'solved'}` : ''].filter(Boolean).join(' · ') },
    (() => { const o = CFD_LOCS.map((_, i) => cfdRuns[i] && cfdRuns[i].result && !cfdIsStale(i) ? cfdRuns[i].result.orient : null).filter(Boolean);
      return { k: 'align', t: 'Flake alignment', go: 4, st: !MAT.orient.on ? 'set' : o.length ? 'solved' : 'wait',
        s: !MAT.orient.on ? 'off (Materials)' : o.length ? `flatness at the oven ${o.map(q => q.film.oven.Sy.toFixed(2)).join(', ')}${o.every(q => q.film.dried) ? `, dried ${o.map(q => q.film.dried.Sy.toFixed(2)).join(', ')}` : ''} (2D at ${o.length} of 4 locations)` : `${OR_MODELS[MAT.orient.model].charAt(0).toLowerCase() + OR_MODELS[MAT.orient.model].slice(1)}: computed with each 2D run` }; })(),
    { k: 'dry', t: 'Drying in the oven', go: 'dry', ...dryStage() },
    { k: 'film', t: 'Film, peeled off', go: 'film', ...filmStage() },
    { k: 'furn', t: 'The furnace and the graphene film', go: 'furn', ...furnStage() },
  ];
}
const STAGE_ICON = { slurry: 'drop', coat: 8, align: 'fibre', dry: 'oven', film: 'film', furn: 'bars' };
/** The stages' short names, on their tabs (Q115). */
const STAGE_TAB = { slurry: 'Slurry', coat: 'Coating', align: 'Flakes', dry: 'Drying', film: 'Film', furn: 'Furnace' };
/** The Process view shows one stage at a time (Q115; WF-2: each a tab of its own), in steps Setup › Solve › Results (Q116),
 *  remembered while open. */
const PROC = { stage: 'coat', step: {} };
/** The report's Process section: every stage, step, film view and chart drawn open at once (as one long page). */
let PROC_ALL = false;
/** A page's key for its steps: the stage, and for the film's and the furnace's stages the part shown (each keeps its own step). */
const procStepKey = (k = PROC.stage) => k === 'film' ? `film:${FILM.view || 'film'}` : k === 'furn' ? `furn:${FURN.part || 'runs'}` : k;
/** The pages that are computed here, with their steps (the cut piece and the stack are solved after the film, on their own;
 *  the graphene film is the furnace's result); the others show their one page. */
const PROC_STEPS = { dry: ['setup', 'solve', 'results'], 'film:film': ['setup', 'solve', 'results'], 'film:piece': ['setup', 'results'], 'film:stack': ['setup', 'results', 'multi'],
  'furn:runs': ['setup', 'solve', 'results', 'multi'], 'furn:product': ['results'] };
const PROC_STEP_T = { setup: 'Setup', solve: 'Solve', results: 'Results', multi: 'Multiphysics' };
/** A solve's state as a stage's: solved, solving, failed or not yet. */
const procSolveSt = (cur, R) => cur ? 'solved' : R.busy ? 'busy' : R.error ? 'failed' : 'todo';
/** The Line's rows for a stage, as one line (the cut piece, the stack, the graphene film: the same words as the Line's map). */
const procLineOf = k => { try { const L = lineStages().find(q => q.k === k); return L && L.rows.length ? L.rows.map(([l, v]) => `${l}: ${v}`).join('; ') : ''; } catch (e) { return ''; } };
/** The page shown: its name, icon, where it stands and its line. */
function procPageHead() {
  const pg = navNow(), g = processStages().find(q => q.k === PROC.stage) || processStages()[1], name = navTitle(pg), icon = NAV[pg].icon || STAGE_ICON[g.k];
  if (pg === 'mix') return { t: name, icon, st: 'none', s: `the mixer is not modelled yet; the slurry it makes: ${g.s}` };
  if (pg === 'cut') { const st = procSolveSt(typeof sheetCurrent === 'function' && sheetCurrent(), SHEET); return { t: name, icon, st, s: st === 'solved' ? procLineOf('cut') : st === 'busy' ? 'the piece in 3D, solving…' : 'the piece in 3D: after the film' }; }
  if (pg === 'stack') { const st = procSolveSt(typeof stackCurrent === 'function' && stackCurrent(), STACK); return { t: name, icon, st, s: st === 'solved' ? procLineOf('stack') : st === 'busy' ? 'the pressed stack, solving…' : 'the pressed stack: after the film and its cut piece' }; }
  if (pg === 'gfilm') return { t: name, icon, st: g.st, s: g.st === 'solved' ? procLineOf('gfilm') : g.s };
  return { t: name, icon, st: g.st, s: g.s };
}
/** The page shown: its line (where it stands) under the tabs, and its steps (none when it has one). */
function processStageHead() {
  const g = procPageHead(), [stT, stC] = STAGE_ST[g.st], key = procStepKey(), steps = PROC_STEPS[key], now = processStep(key);
  const bar = steps && steps.length > 1 ? `<div class="step-bar proc-steps" role="tablist" aria-label="${g.t}: its steps">${steps.map((k, i) => `<button type="button" role="tab" data-pstepgo="${k}" aria-selected="${k === now}"><b>${i + 1}</b><span>${PROC_STEP_T[k]}</span></button>`).join('<span class="step-sep" aria-hidden="true">›</span>')}</div>` : '';
  return `<div class="proc-head"><h2 class="proc-h">${uiBadge(g.icon)}${g.t}</h2><span class="ch-st ch-${stC}">${stT}</span><span class="proc-line">${g.s}</span>${bar}</div>`;
}
/** A page's step (k: its key, procStepKey's; a stage's name: its part shown): as chosen, else Results once it is solved,
 *  else Setup. */
function processStep(k = procStepKey()) {
  if (!PROC_STEPS[k] && (k === 'film' || k === 'furn')) k = procStepKey(k);
  const steps = PROC_STEPS[k];
  if (!steps) return null;
  if (steps.includes(PROC.step[k])) return PROC.step[k];
  if (steps.length === 1) return steps[0];
  const g = k === 'film:piece' || k === 'film:stack' ? procPageHead() : processStages().find(q => q.k === k.split(':')[0]);
  return g && g.st === 'solved' ? 'results' : 'setup';
}
/** 1 Mixing: the slurry the mixer makes -- its figures, its composition, how it flows (the law the solvers use, marked at
 *  the shear rates of the process); the mixer itself is not modelled yet (the user, 30 Sep: its heat and flow, and the
 *  flake size and viscosity they give -- a later phase). */
/** The slurry's shear rate in the gap: the web's speed over the gap at the metering edge, mid-web (1/s), and its viscosity there. */
function procSlurryGap() {
  const uses = RHEO_MODELS[CFDG.model].uses, ty = uses.includes('ty') ? P.ty : 0, n = uses.includes('n') ? P.n : 1, x = cfdRheoX();
  const gd = P.U / 60 * Math.cos(skewRad()) / (localGap(ACROSS_W / 2) / 1000);
  return { gd, mu: muLaw(gd, P.mu, ty, n, x), ty, n, x };
}
function procSlurryHTML() {
  const c = MAT.slurry, keys = Object.keys(c), nA = keys.filter(k => c[k].flag === 'assumed').length, wt = slurrySolidsMass();
  const X0 = (1 - c.phi.v / 100) * c.rhoL.v / (c.phi.v / 100 * c.rhoS.v * 1000), g = procSlurryGap(), sig = v => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  const tile = (l, v, sub, ic) => `<div class="stat" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${sub}</small></div>`;
  const pct = v => (v * 100).toFixed(1);
  const bar = (label, go, w) => `<div class="mx-bar"><span class="mx-bar-l">${label}</span><span class="mx-bar-t"><span class="mx-go" style="width:${(go * 100).toFixed(2)}%">GO ${pct(go)} %</span><span class="mx-w" style="width:${(w * 100).toFixed(2)}%">water ${pct(w)} %</span></span></div>`;
  return `<div class="mx-page">
    <div class="stats mx-stats">${[
      tile('Solids', `${c.phi.v} vol%`, `${pct(wt)} % by mass`, 'weight'),
      tile('Water', `${(X0 * 100).toFixed(1)} %`, 'of the GO\'s mass', 'drop'),
      tile('Slurry density', `${slurryRho().toFixed(0)} kg/m³`, 'from its solids', 'weight'),
      tile('Viscosity in the gap', `${sig(g.mu)} Pa·s`, `at ${sig(g.gd)} 1/s (U/H)`, 'flow'),
      tile('Yield stress', g.ty > 0 ? `${g.ty.toFixed(1)} Pa` : 'none', RHEO_MODELS[CFDG.model].l, 'ratio'),
      tile('Flakes', `${c.dMin.v}–${c.dMax.v} µm`, `mean ${c.dMean.v} µm`, 'fibre'),
    ].join('')}</div>
    <div class="mx-grid">
      <figure class="pane mx-pane"><figcaption>${uiBadge('flow')}How it flows <small>${RHEO_MODELS[CFDG.model].l}: the law the solvers use</small></figcaption>
        <canvas id="mxFlow" role="img" aria-label="The slurry's viscosity against its shear rate, the law the solvers use, marked where you set it and in the gap"></canvas>
        <div class="pane-legend" id="mxFlowLg"></div></figure>
      <figure class="pane mx-pane"><figcaption>${uiBadge('bars')}What it is made of <button type="button" class="linkish mx-edit" data-chain="13">Edit in Materials</button></figcaption>
        <div class="mx-bars">${bar('By volume', c.phi.v / 100, 1 - c.phi.v / 100)}${bar('By mass', wt, 1 - wt)}</div>
        <table class="cfd-table mx-comp"><thead><tr><th scope="col">Component</th><th scope="col">Volume <small>%</small></th><th scope="col">Mass <small>%</small></th><th scope="col">Density <small>kg/m³</small></th></tr></thead>
          <tbody><tr><th scope="row"><i class="mx-sw mx-sw-go"></i>Graphene oxide</th><td>${c.phi.v.toFixed(1)}</td><td>${pct(wt)}</td><td>${(c.rhoS.v * 1000).toFixed(0)}</td></tr>
            <tr><th scope="row"><i class="mx-sw mx-sw-w"></i>Water</th><td>${(100 - c.phi.v).toFixed(1)}</td><td>${pct(1 - wt)}</td><td>${c.rhoL.v.toFixed(0)}</td></tr>
            <tr class="mx-total"><th scope="row">Slurry</th><td>100.0</td><td>100.0</td><td>${slurryRho().toFixed(0)}</td></tr></tbody></table>
        <p class="mx-foot">${nA ? `${nA} of the slurry card's ${keys.length} values assumed` : 'Every value on the slurry card from you'} · dry film packing ${c.phiDry.v}</p></figure>
    </div></div>`;
}
/** Mixing's flow curve: the viscosity over five decades of shear rate, log–log, marked at 2.7 1/s (where you set it) and in the gap. */
function procSlurryDraw() {
  const cv = document.getElementById('mxFlow');
  if (!cv || (!PROC_ALL && cv.offsetParent === null)) return;
  const g = procSlurryGap(), L10 = Math.log10, x0 = -2, x1 = 4, p = [];
  for (let i = 0; i <= 180; i++) { const lg = x0 + (x1 - x0) * i / 180, mu = muLaw(Math.pow(10, lg), P.mu, g.ty, g.n, g.x); if (mu > 0 && Number.isFinite(mu)) p.push([lg, L10(mu)]); }
  const ys = p.map(q => q[1]); let y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys)); if (y1 <= y0) y1 = y0 + 1;
  const dec = v => { const k = Math.round(v); return k >= 4 || k <= -3 ? `1e${k}` : String(+Math.pow(10, k).toPrecision(1)); };
  const acc = cssVar('--accent'), mut = cssVar('--muted'), go = cssVar('--go-film'), tk = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  // (the gap's shear rate within a tenth of a decade of 2.7 1/s -- as at the defaults: one mark for both)
  const one = Math.abs(L10(g.gd) - L10(2.7)) < 0.1, f = v => v.toFixed(v >= 10 ? 1 : 2);
  plotChart(cv, 0.5, { x0, x1, y0, y1, xticks: tk(x0, x1), yticks: tk(y0, y1), xf: dec, yf: dec, xl: 'shear rate (1/s)', yl: 'viscosity (Pa·s)',
    vl: one ? [{ x: L10(g.gd), c: acc, t: '' }] : [{ x: L10(2.7), c: mut, t: '' }, { x: L10(g.gd), c: acc, t: '' }], s: [{ p, c: go, w: 2.4 }] });
  const lg = document.getElementById('mxFlowLg');
  if (lg) lg.innerHTML = oneDLegend([[`viscosity, ${RHEO_MODELS[CFDG.model].l}`, go], ...(one ? [[`the gap, ${f(g.gd)} 1/s (U/H), and 2.7 1/s: ${f(g.mu)} Pa·s (measured ${RHEO_MEASURED.mu})`, acc, 'dash']]
    : [[`2.7 1/s: the law ${f(P.mu)} Pa·s, measured ${RHEO_MEASURED.mu}`, mut, 'dash'], [`the gap, ${f(g.gd)} 1/s (U/H): ${f(g.mu)} Pa·s`, acc, 'dash']])]);
}
/** The flakes' alignment (stage 3): where it stands at each location, and where it is computed. */
function procAlignHTML() {
  const btn = (go, ico, t, primary) => `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm" data-chain="${go}">${uiIco(ico)}${t}</button>`;
  if (!MAT.orient.on) return emptyHint('The flakes\' alignment is off', 'It is switched on and set on the alignment card, on Materials.', btn(13, 13, 'The alignment card', true));
  const o = CFD_LOCS.map((_, i) => cfdRuns[i] && cfdRuns[i].result && !cfdIsStale(i) ? cfdRuns[i].result.orient : null);
  if (!o.some(Boolean)) return emptyHint('Not computed yet', 'The flakes\' alignment is computed along the flow with each 2D run, at each location.', btn(4, 4, 'Run the 2D', true) + btn(13, 13, 'The alignment card'));
  // (flatness S: 1 all flat, 0 at random -- a bar each, at the oven and dried)
  const bar = v => v == null ? '<td class="ln-na">—</td>' : `<td class="ln-util"><span class="ln-track"><span class="ln-fill fl-fill" style="width:${(Math.max(0, Math.min(1, v)) * 100).toFixed(1)}%"></span></span><span class="ln-pct">${v.toFixed(2)}</span></td>`;
  const rows = o.map((q, i) => `<tr><th scope="row"><i class="loc-dot" style="background:${locColor(i)}"></i>L${i + 1} <small>z ${CFD_LOCS[i].z} mm</small></th>${q ? bar(q.film.oven.Sy) + bar(q.film.dried ? q.film.dried.Sy : null) : '<td colspan="2" class="ln-na">Not run: the 2D at this location</td>'}</tr>`).join('');
  return `<div class="proc-card fl-card"><div class="table-wrap"><table class="cfd-table fl-table"><thead><tr><th scope="col">Location</th><th scope="col">Flatness at the oven <small>S, 1: all flat</small></th><th scope="col">Flatness, dried <small>S</small></th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="prop-actions">${btn(4, 4, 'Coating › 2D')}${btn(13, 13, 'The alignment card')}</div></div>`;
}
/** A stage's answer in one line (Q117: its line in the chain), then its warnings folded behind a button. */
function procAnswerHTML(line, warnHTML) {
  const box = document.createElement('div'); box.innerHTML = warnHTML || '';
  const pills = [...box.querySelectorAll('.pill')], nBad = pills.filter(q => q.classList.contains('bad')).length;
  return `<p class="furn-answer">${line}</p>${pills.length ? `<details class="furn-warn"><summary>${nBad ? '<i class="pt-dot pt-bad" aria-hidden="true"></i>' : ''}Warnings (${pills.length})</summary>${warnHTML}</details>` : ''}`;
}
/** A stage's charts one at a time, picked by chips above them (Q118): each grid's chosen chart (its canvas's id). */
const PROC_CHART = { dry: 'dr1', film: 'fm1' };
const PROC_CHARTS = {
  dry: [['dr1', 'Water in the film'], ['dr2', 'Temperatures'], ['dr3', 'Evaporation'], ['dr4', 'The film and its skin'], ['dr5', 'Through the film']],
  film: [['fm1', 'Stress at its top'], ['fm2', 'Crack risk'], ['fm3', 'Peel force'], ['fm4', 'Through it at the peel'], ['fm5', 'Blister risk'], ['fm6', 'On a table']],
};
function procChipsHTML(k) {
  return `<div class="furn-chips" role="tablist" aria-label="Which chart">${PROC_CHARTS[k].map(([id, t]) => `<button type="button" role="tab" class="chip" data-pchart="${k}|${id}" aria-selected="${id === PROC_CHART[k]}">${t}</button>`).join('')}</div>`;
}
function procShowChart(k) {
  const on = PROC_CHART[k];
  document.querySelectorAll(`[data-pchart^="${k}|"]`).forEach(b => b.setAttribute('aria-selected', String(b.dataset.pchart === `${k}|${on}`)));
  PROC_CHARTS[k].forEach(([id]) => { const cv = document.getElementById(id); if (cv) cv.closest('figure').hidden = !PROC_ALL && id !== on; });
}
/** Show the stage chosen (the others stay drawn, hidden: they go on solving and the report reads them). */
function processShowStage() {
  const k = PROC.stage, wb = document.getElementById('modWb');
  if (wb) wb.classList.toggle('proc-all', PROC_ALL);
  if (PROC_ALL) {
    if (wb) delete wb.dataset.procStage;
    document.querySelectorAll('.proc-stage').forEach(el => { el.hidden = false; delete el.dataset.step; });
    document.querySelectorAll('#modWb .mod-vp > figure.pane, #modWb .mod-extra').forEach(el => { el.hidden = false; });
    return;
  }
  if (wb) wb.dataset.procStage = k;
  document.querySelectorAll('.proc-stage').forEach(el => { el.hidden = el.dataset.stageOf !== k; });
  document.querySelectorAll('#modWb .mod-vp > figure.pane, #modWb .mod-extra').forEach(el => { el.hidden = k !== 'coat'; });
  const step = processStep(procStepKey(k));
  document.querySelectorAll('.proc-stage[data-stage-of="' + k + '"]').forEach(el => { if (step) el.dataset.step = step; else delete el.dataset.step; });
}

// ---- the page ----
/**
 * The inputs bar on a stage's tab (WF-2: only that stage's inputs): Mixing and the coating's results, the slurry card's
 * values (from Materials); Drying, the oven's zones; Peel and wind, Cutting and Pre heat treatment, their rows of what
 * follows the oven; Furnace and Graphene film, the furnace.
 */
const PROC_BAR = { mix: [], wetdry: ['matro', 'oven'], flakes: ['matro'], dry: ['oven'], peel: ['peel'], cut: ['peel'], stack: ['peel'], furn: ['furn'], gfilm: ['furn'] };
function processSidebar() {
  const open = k => FV.tree[k] !== false ? ' open' : '', pg = navNow(), part = NAV[pg].fv;
  const c = MAT.slurry, row = (l, v) => `<div class="prop prop-ro"><span class="prop-l">${l}</span><span class="prop-v">${v}</span></div>`;
  const G = {
    oven: () => `<details class="grp cfd-grp" data-tree="oven"${open('oven')}><summary>Drying air (oven)</summary>${ovenZonesTree()}</details>`,
    peel: () => `<details class="grp cfd-grp" data-tree="oven"${open('oven')}><summary>${{ film: 'After the oven', piece: 'The pieces cut', stack: 'The pre heat treatment' }[part]}</summary>${ovenZonesTree({ zones: false, peel: part })}</details>`,
    furn: () => `<details class="grp cfd-grp" data-tree="furn"${FV.tree.furn !== false ? ' open' : ''}><summary>The furnace</summary>${furnTreeHTML()}</details>`,
    matro: () => `<details class="grp cfd-grp" data-tree="matro"${open('matro')}><summary>From the materials</summary>
      ${row('Solids (GO)', `${c.phi.v} vol%`)}${row('GO density', `${c.rhoS.v} g/cm³`)}${row('Liquid (water)', `${c.rhoL.v} kg/m³`)}${row('Dry film packing', `${c.phiDry.v}`)}${row('Slurry density', `${slurryRho().toFixed(0)} kg/m³`)}
      <p class="prop-note">The slurry's card, on Materials. Its density follows from the solids, and the flow models use it.</p>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="procToMat">${uiIco(13)}Edit in Materials</button></div>
    </details>`,
  };
  // (Mixing: none -- its page shows the slurry card's values, its inputs are the slurry's flow above)
  const groups = PROC_BAR[pg] || ['oven', 'furn', 'matro'];
  document.getElementById('setupExtra').innerHTML = groups.length ? `<div class="tree-sep">${navTitle(pg)}: its setup</div>${groups.map(k => G[k]()).join('')}` : '';
  document.querySelectorAll('#setupExtra details[data-tree]').forEach(d => d.addEventListener('toggle', () => { FV.tree[d.dataset.tree] = d.open; }));
  const toMat = document.getElementById('procToMat'); if (toMat) toMat.onclick = () => { tab = 13; render(); };
  wireOvenZones(() => processPage(true), render);
  if (document.querySelector('#setupExtra [data-tree="furn"]')) wireFurnTree(() => processPage(true));
}
/** Open a stage (from a link or another tab's "See it"), at the page's top: the film's and the furnace's on the part shown last. */
function processGo(k, step) {
  if (!STAGE_TAB[k]) return;
  PROC.stage = k; if (step) PROC.step[procStepKey(k)] = step;
  tab = 12; render();
  const vp = document.querySelector('.mod-vp'); if (vp) vp.scrollTop = 0;
}
function viewProcess() {
  processSidebar();
  processPage();
}
/** The Process page itself (redrawn alone after an oven zone's value, so the inputs bar keeps its focus). */
function processPage(alone = false) {
  if (alone) { processPageBody(); wireModDock(); undoUI(); return; }
  processPageBody();
}
function processPageBody() {
  oneDRequest(true);
  const acc = cssVar('--accent'), mut = cssVar('--muted');
  view.innerHTML = moduleFrame({
    top: processStageHead()
      + `<div class="proc-stage" data-stage-of="slurry">${procSlurryHTML()}</div>`
      + `<div class="proc-stage" data-stage-of="align">${procAlignHTML()}</div>`
      + `<div class="proc-stage" data-stage-of="dry">${drySectionHTML()}</div>`
      + `<div class="proc-stage" data-stage-of="film">${filmSectionHTML()}</div>`
      + `<div class="proc-stage" data-stage-of="furn">${furnSectionHTML()}</div>`,
    panes: [{ id: 'pr1', icon: 'film', title: 'Wet and dry film across the web', aria: 'Wet film and dry film against position across the web',
      legend: oneDLegend([['wet film', mut, 'dash'], ['dry film (mass balance)', acc]]),
      note: 'The wet film is the 1D gap flow at every position across the web (Coating › 1D › Across the web). The dry film is what is left when its water is gone: wet film × solids fraction / the dry film\'s packing (Materials).' }],
    extra: `<div class="proc-table" id="procTable"></div><div class="prop-actions proc-go"><button type="button" class="btn btn-secondary btn-sm" data-chain="8">${uiIco(8)}Coating › 1D: the gap flow</button><button type="button" class="btn btn-secondary btn-sm" data-chain="11">${uiIco(11)}Across the web</button><button type="button" class="btn btn-secondary btn-sm" data-chain="4">${uiIco(4)}Coating › 2D</button></div>`,
  });
  processShowStage();
  procSlurryDraw();
  if (!view.dataset.wired) {
    view.dataset.wired = '1';
    view.addEventListener('click', e => {
      if (tab !== 12) return;
      // (a step of the page shown)
      const pc = e.target.closest && e.target.closest('[data-pchart]');
      if (pc) { const [k, id] = pc.dataset.pchart.split('|'); PROC_CHART[k] = id; procShowChart(k); if (k === 'dry') dryRender(); else filmRender(); return; }
      const sp = e.target.closest && e.target.closest('[data-pstepgo]');
      if (sp) { PROC.step[procStepKey()] = sp.dataset.pstepgo; render(); return; }
      const b = e.target.closest && e.target.closest('[data-chain]');
      if (!b) return;
      const go = b.dataset.chain;
      if (go === 'dry' || go === 'film' || go === 'furn') processGo(go);
      else if (go === 'furnin') { FV.tree.furn = true; setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="furn"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('input'); if (f) f.focus(); } }
      else if (go === 'peel') { FV.tree.oven = true; setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; const b = document.getElementById('ovzPeel'); if (b) b.scrollIntoView({ block: 'nearest' }); const f = document.getElementById('ovzPeelLen') || (b && b.querySelector('input')); if (f) f.focus(); } }
      else if (go === 'oven') { FV.tree.oven = true; setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('input'); if (f) f.focus(); } }
      else { tab = +go; render(); }
    });
  }
  const web = processWeb(), U = lineSpeed(), W = ACROSS_W / 1000, o = ovenTime(U), c = MAT.slurry;
  const st = document.getElementById('st'), ss = document.getElementById('ss');
  // (the web: across it (answers.js); until the 1D across it is solved, the four locations' mean)
  const locs = CFD_LOCS.map((_, i) => processFilmAt(i));
  const known = locs.filter(Boolean), hWeb = web ? web.mean : known.length ? known.reduce((a, q) => a + q.h, 0) / known.length : null;
  if (hWeb == null) { st.innerHTML = ONE_D.error ? pill('The 1D could not be solved: ' + ONE_D.error, 'bad') : pill('Solving the 1D…', ''); ss.innerHTML = ''; drawProcessTable(locs, web); dryRender(); filmRender(); furnRender(); return; }
  const mb = massBalance(hWeb, U, W), wetTooLoose = c.phiDry.v * 100 < c.phi.v;
  let pills = pill(`Dry film ${um0(mb.dry)} µm${web ? ` across the web (${um0(massBalance(web.min, U, W).dry)}–${um0(massBalance(web.max, U, W).dry)} µm)` : ''}, from a ${(hWeb * 1000).toFixed(3)} mm wet film${web ? ` (${web.tag})` : ''}`, '');
  pills += pill(`The oven takes out ${(mb.water * 1000).toFixed(0)} g of water per m²: ${(mb.waterRate * 1000).toFixed(2)} g/s over the ${ACROSS_W} mm web at ${P.U} m/min`, '');
  if (wetTooLoose) pills += pill(`Dry film packing ${c.phiDry.v} is below the slurry's solids fraction (${c.phi.v} vol%): the film would not shrink as it dries`, 'bad');
  const fib = FIBRES[CFDG.fibre], hot = OVEN.zones.filter(z => z.airT > fib.tUse);
  if (hot.length) pills += pill(`Oven air above the fibre's ${fib.tUse} °C continuous limit in ${hot.length} zone${hot.length === 1 ? '' : 's'}`, 'warn');
  if (!web) pills += pill('Solving the 1D across the web…', 'warn');
  st.innerHTML = pills;
  const stat = a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${uiBadge(a[2])}${a[0]}</span><strong>${a[1]}</strong></div>`;
  ss.innerHTML = [
    ['Dry film', `${um0(mb.dry)} µm`, 'film'],
    ['Coat weight, dry', `${gm2(mb.coatDry)} g/m²`, 'weight'],
    ['Coat weight, wet', `${gm2(mb.coatWet)} g/m²`, 'weight'],
    ['Water to take out', `${(mb.water * 1000).toFixed(0)} g/m²`, 'drop'],
    ['Water per hour, the web', `${(mb.waterRate * 3600).toFixed(2)} kg/h`, 'drop'],
    ['Time in the oven', Number.isFinite(o.t) ? `${(o.t / 60).toFixed(1)} min` : '—', 'period'],
  ].map(stat).join('');
  // the film across the web
  const cv = document.getElementById('pr1');
  if (web) {
    const z = web.A.map(r => r.z), wet = web.A.map(r => r.film * 1000), dry = web.A.map(r => massBalance(r.film, U, W).dry * 1000);
    const hi = Math.max(...wet, ...dry);
    plotChart(cv, fitAspect(cv, 0.4), { x0: Math.min(0, z[0]), x1: Math.max(ACROSS_W, z[z.length - 1]), y0: 0, y1: hi * 1.12, yl: 'film (mm)', xl: 'position across the web (mm)', yd: 2,
      s: [{ p: z.map((x, k) => [x, wet[k]]), c: mut, w: 1.6, dash: [6, 4] }, { p: z.map((x, k) => [x, dry[k]]), c: acc, w: 2.2 }] });
  } else { const cx = setupCanvas(cv, fitAspect(cv, 0.4)); cx.c.fillStyle = mut; cx.c.font = '13px ' + cssVar('--sans'); cx.c.fillText('Solving the 1D across the web…', 16, 28); }
  drawProcessTable(locs, web);
  dryRender();
  filmRender();
  furnRender();
}
/** Per location: the wet film (and which model it is from), and what the mass balance makes of it; the web's mean beside them. */
function drawProcessTable(locs, web) {
  const host = document.getElementById('procTable');
  if (!host) return;
  const U = lineSpeed(), W = ACROSS_W / 1000;
  // (the columns alike: a location's z and the model its film is from; the web's mean, its source on hover)
  const cols = [...locs.map((q, i) => ({ h: q && q.h, head: `L${i + 1}<small>z ${CFD_LOCS[i].z} mm${q ? ` · ${q.src}` : ''}</small>` })), { h: web && web.mean, head: `The web<small>its mean</small>`, tip: web ? web.tag : '' }];
  const rows = [
    ['Wet film', 'mm', h => (h * 1000).toFixed(3)],
    ['Dry film', 'µm', h => um0(massBalance(h, U, W).dry)],
    ['Coat weight, dry', 'g/m²', h => gm2(massBalance(h, U, W).coatDry)],
    ['Coat weight, wet', 'g/m²', h => gm2(massBalance(h, U, W).coatWet)],
    ['Water to take out', 'g/m²', h => (massBalance(h, U, W).water * 1000).toFixed(0)],
  ];
  host.innerHTML = `<h3 class="oned-h">The mass balance at each location</h3><div class="oned-scroll"><table class="cfd-table proc-mb"><colgroup><col class="proc-mb-q">${cols.map(() => '<col>').join('')}</colgroup>
    <thead><tr><th scope="col">Quantity</th>${cols.map(c => `<th scope="col"${c.tip ? ` title="${c.tip}"` : ''}>${c.head}</th>`).join('')}</tr></thead>
    ${rows.map(([t, u, f]) => `<tr><th scope="row">${t} <small>${u}</small></th>${cols.map(c => c.h != null ? `<td>${f(c.h)}</td>` : '<td class="na" title="solving">—</td>').join('')}</tr>`).join('')}
  </table></div>
  <details class="fv-more"><summary>How it is worked out</summary><p class="fv-note">Each location's wet film is the most detailed one solved for the inputs as they are: 3D (a strip there or the full width), else 2D, else the 1D. What the oven must take out is the water; the solids stay, packed at the dry film's packing (Materials): dry film = wet film × ${MAT.slurry.phi.v} vol% / ${MAT.slurry.phiDry.v}. Coat weight dry = wet film × solids fraction × GO density; wet = wet film × the slurry's density (${slurryRho().toFixed(0)} kg/m³). The web's water per second: its wet film over the ${ACROSS_W} mm width (where the blade is) × the water fraction × the line speed (${P.U} m/min). Time in the oven: its length (${+ovenTime(U).len.toFixed(2)} m, ${OVEN.zones.length} zones) / the line speed. The drying itself is on 3 Drying; the film after it on 4 Peel and wind.</p></details>`;
}

// ---- Materials ----
const MAT_FLAG_CLASS = { given: 'f-given', assumed: 'f-assumed', measured: 'f-measured' };
const matFlagChip = f => f === 'calc' ? '<span class="mat-flag f-calc">Worked out</span>' : `<span class="mat-flag ${MAT_FLAG_CLASS[f] || ''}">${(MAT_FLAGS.find(q => q[0] === f) || [0, f])[1]}</span>`;
/** The rheology card's first rows: the model and the sidebar's slurry inputs, as they are. */
function matRheoBase() {
  const flag = c => /assumed/.test(c.h || '') ? 'assumed' : 'given', cf = k => CFG.find(c => c.k === k);
  return [
    ['Rheology model', RHEO_MODELS[CFDG.model].l, '', 'given', 'chosen here or in Coating › 2D (the CFD setup)'],
    // (MH-3: the law's own parameters, then the viscosity it gives at 2.7 1/s -- worked out, against your measurement)
    ...[...RHEO_MODELS[CFDG.model].uses, 'g'].map(k => { const c = cf(k), fit = (MAT.rheo.side || {})[k];
      return fit && fit.v === P[k] ? [c.l, (+P[k]).toFixed(c.d), c.u, 'measured', fit.src] : [c.l, (+P[k]).toFixed(c.d), c.u, flag(c), c.h || 'you (measured)']; }),
    ...(CFDG.model === 'newtonian' ? [] : [['Viscosity at 2.7 1/s, the law', Number.isFinite(P.mu) ? (+P.mu.toPrecision(4)).toString() : '—', 'Pa·s', 'calc', `from its parameters; measured ${RHEO_MEASURED.mu} Pa·s (${RHEO_MEASURED.src})`]]),
  ];
}
/** Whether a rheology card row (MAT_RHEO) is used as things are: the law's extras by their laws, the structure's when it is on. */
const matRheoUsed = row => row[10] === 'struct' ? MAT.rheo.structOn : row[0] === 'aCY' ? CFDG.model === 'carreau' : CFDG.model === 'carreau' || CFDG.model === 'cross';
const matRheoNotUsed = row => row[10] === 'struct' ? 'the structure model is off' : `not used by ${RHEO_MODELS[CFDG.model].l}`;
/** The whole rheology card, read-only (the report): the model, the sidebar's inputs, the laws' extras, the structure. */
function matRheoRows() {
  const r = MAT.rheo, row = q => { const [k, l, u, , , , d] = q; return [l, (+r[k].v).toFixed(d), u, r[k].flag, (matRheoUsed(q) ? '' : `(${matRheoNotUsed(q)}) `) + r[k].src]; };
  return [
    ...matRheoBase(),
    ...MAT_RHEO.filter(q => q[10] === 'law').map(row),
    ['Structure (thixotropy)', r.structOn ? 'on' : 'off', '', 'given', r.structOn ? 'the 2D carries it along its flow; the 1D along the blade; it rebuilds at rest on the web' : 'off: every result from the steady flow curve'],
    ...MAT_RHEO.filter(q => q[10] === 'struct').map(row),
  ];
}
/** An edited card's rows (the slurry's: data-mk, ids mat_*; the rheology's: data-mr, ids matr_*): value, where it is from, source. */
function matEditRows(rows, vals, attr, pre, off = () => false) {
  return rows.map(q => { const [k, l, u, lo, hi, step] = q, v = vals[k], o = off(q);
    return `<div class="mat-row${o ? ' mat-off' : ''}" data-${attr}="${k}"${o ? ` title="${String(o).replace(/"/g, '&quot;')}"` : ''}>
      <label class="mat-l" for="${pre}_${k}">${l}${o ? `<small class="mat-note">${o}</small>` : ''}</label>
      <span class="mat-v"><input type="number" id="${pre}_${k}" data-${attr}="${k}" min="${lo}" max="${hi}" step="${step}" value="${v.v}"><span class="prop-u">${u}</span></span>
      <select id="${pre}f_${k}" data-${attr}="${k}" class="mat-fsel ${MAT_FLAG_CLASS[v.flag] || ''}" aria-label="${l}: where the value is from">${MAT_FLAGS.map(([f, t]) => `<option value="${f}"${f === v.flag ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <input type="text" id="${pre}s_${k}" data-${attr}="${k}" class="mat-src" value="${String(v.src).replace(/"/g, '&quot;')}" aria-label="${l}: source">
    </div>`; }).join('');
}
/** The fibre web card: the fibre's test report and the 2D setup's fibre values, as they are. */
function matFibreRows() {
  const fib = FIBRES[CFDG.fibre], st = fibreStructure(), rep = k => fib.set[k] === CFDG[k] ? 'measured' : 'given';
  const src = k => fib.set[k] === CFDG[k] ? 'the test report' : `you (the report: ${fib.set[k]})`;
  const asm = k => fib.set[k] === CFDG[k] ? 'assumed' : 'given';
  return [
    ['Test report', fib.l, '', 'measured', fib.note],
    ['Thickness', P.tf.toFixed(2), 'mm', 'given', 'you (measured); the inputs bar\'s fibre thickness'],
    ['Basis weight', String(CFDG.gsm), 'g/m²', rep('gsm'), src('gsm')],
    ['Fibre density', String(CFDG.rhoF), 'kg/m³', asm('rhoF'), fib.set.rhoF === CFDG.rhoF ? 'assumed (the polymer\'s)' : 'you'],
    ['Air permeability', String(CFDG.airPerm), '×10⁻³ m³/m²·s', rep('airPerm'), src('airPerm')],
    ['Porosity', st.ok ? st.eps.toFixed(3) : '—', '', 'calc', 'from the basis weight, the fibre density and the thickness'],
    ['Filament diameter', Number.isFinite(st.d) ? (st.d * 1e6).toFixed(1) : '—', 'µm', 'calc', CFDG.dFrom === 'yarn' ? `from the ${CFDG.den} denier yarn of ${CFDG.nf} filaments and the fibre density` : 'from the air permeability (Kozeny–Carman)'],
    ['Air fraction, top surface', String(CFDG.airFrac), '', asm('airFrac'), fib.set.airFrac === CFDG.airFrac ? 'assumed (= porosity)' : 'you'],
    ['Use temperature, continuous', String(fib.tUse), '°C', 'measured', 'the test report'],
  ];
}
function viewMaterials() {
  const c = MAT.slurry, r = MAT.rheo;
  const ro = rows => rows.map(([l, v, u, f, s]) => `<div class="mat-row mat-ro"><span class="mat-l">${l}</span><span class="mat-v"><b>${v}</b><span class="prop-u">${u}</span></span>${matFlagChip(f)}<span class="mat-src-t" title="${String(s).replace(/"/g, '&quot;')}">${s}</span></div>`).join('');
  const base = matRheoBase();
  const off = q => matRheoUsed(q) ? false : matRheoNotUsed(q);
  view.innerHTML = moduleFrame({
    top: `<div class="mat-cards">
      <section class="mat-card" aria-labelledby="matSlurryH">
        <header><h3 id="matSlurryH">${uiBadge('drop')}Slurry: GO in water</h3><span class="mat-count" id="matCount"></span></header>
        <div class="mat-head" aria-hidden="true"><span></span><span>Value</span><span>From</span><span>Source</span></div>
        ${matEditRows(MAT_SLURRY, c, 'mk', 'mat')}
        <div class="mat-derived" id="matDerived"></div>
        <div class="mat-actions"><button type="button" class="btn btn-secondary btn-sm" id="matReset">${uiIco('restart')}Defaults</button></div>
      </section>
      <section class="mat-card" aria-labelledby="matRheoH">
        <header><h3 id="matRheoH">${uiBadge('model')}Slurry: how it flows</h3><button type="button" class="linkish" id="matRheoEdit">Edit in the inputs</button></header>
        <div class="mat-head" aria-hidden="true"><span></span><span>Value</span><span>From</span><span>Source</span></div>
        <div class="mat-row"><label class="mat-l" for="matModel">Rheology model</label><span class="mat-v"><select id="matModel" class="mat-msel">${Object.entries(RHEO_MODELS).map(([k, m]) => `<option value="${k}"${k === CFDG.model ? ' selected' : ''}>${m.l}</option>`).join('')}</select></span>${matFlagChip('given')}<span class="mat-src-t" title="${RHEO_MODELS[CFDG.model].law}">${base[0][4]}</span></div>
        ${ro(base.slice(1))}
        <div class="mat-sub"><b>Carreau–Yasuda and Cross</b><span>the law's shape beyond the viscosity and n${CFDG.model === 'carreau' || CFDG.model === 'cross' ? '' : ` · not used by ${RHEO_MODELS[CFDG.model].l}`}</span></div>
        ${matEditRows(MAT_RHEO.filter(q => q[10] === 'law'), r, 'mr', 'matr', off)}
        <div class="mat-sub"><label class="mat-switch"><input type="checkbox" id="matStructOn"${r.structOn ? ' checked' : ''}><b>Structure (thixotropy)</b></label><span id="matStructNote">${r.structOn ? 'on: it breaks down under shear and rebuilds at rest; the 2D carries it along its flow, the 1D along the blade, and it rebuilds on the web' : 'off: every result from the steady flow curve'}</span></div>
        ${matEditRows(MAT_RHEO.filter(q => q[10] === 'struct'), r, 'mr', 'matr', off)}
        <div id="matRheoDerived"></div>
        <div class="mat-actions"><button type="button" class="btn btn-secondary btn-sm" id="matRheoReset">${uiIco('restart')}Defaults</button><span class="mat-count" id="matRheoCount"></span></div>
      </section>
      ${orCardHTML()}
      ${dryCardHTML()}
      ${filmCardHTML()}
      ${furnCardHTML()}
      ${rtCardHTML()}
      <section class="mat-card" aria-labelledby="matFibreH">
        <header><h3 id="matFibreH">${uiBadge('fibre')}Fibre web: what it is coated onto</h3><button type="button" class="linkish" id="matFibreEdit">Edit in Coating › 2D</button></header>
        ${ro(matFibreRows())}
      </section>
    </div>`,
    panes: [],
  });
  // the slurry card
  const guardKey = k => MAT_SLURRY.find(q => q[0] === k);
  view.querySelectorAll('input[type=number][data-mk]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mk, [, l, u, lo, hi] = guardKey(k);
    guardNumber(el, { label: l, lo, hi, unit: u }, v => { MAT.slurry[k] = { ...MAT.slurry[k], v }; });
    el.value = MAT.slurry[k].v;
    matDerived();
  }));
  view.querySelectorAll('select[data-mk]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mk; MAT.slurry[k] = { ...MAT.slurry[k], flag: el.value };
    el.className = `mat-fsel ${MAT_FLAG_CLASS[el.value] || ''}`;
    matDerived();
  }));
  view.querySelectorAll('input.mat-src[data-mk]').forEach(el => el.addEventListener('change', () => { const k = el.dataset.mk; MAT.slurry[k] = { ...MAT.slurry[k], src: el.value.trim() }; }));
  document.getElementById('matReset').onclick = () => { undoHint('Slurry card back to its defaults'); MAT = { ...MAT, slurry: matDefaults().slurry }; render(); };
  // the rheology card: the model (as Coating › 2D's), the laws' extras and the structure
  document.getElementById('matModel').addEventListener('change', e => { CFDG.model = e.target.value; rheoSync('model'); render(); });
  const rKey = k => MAT_RHEO.find(q => q[0] === k);
  view.querySelectorAll('input[type=number][data-mr]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mr, [, l, u, lo, hi] = rKey(k);
    guardNumber(el, { label: l, lo, hi, unit: u }, v => { MAT.rheo[k] = { ...MAT.rheo[k], v }; });
    el.value = MAT.rheo[k].v;
    rheoSync('extras');   // (MH-3: η0 kept, the law's viscosity at 2.7 1/s follows its new shape)
    matRheoDerived(); matDerived();
  }));
  view.querySelectorAll('select[data-mr]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mr; MAT.rheo[k] = { ...MAT.rheo[k], flag: el.value };
    el.className = `mat-fsel ${MAT_FLAG_CLASS[el.value] || ''}`;
    matRheoDerived(); matDerived();
  }));
  view.querySelectorAll('input.mat-src[data-mr]').forEach(el => el.addEventListener('change', () => { const k = el.dataset.mr; MAT.rheo[k] = { ...MAT.rheo[k], src: el.value.trim() }; }));
  document.getElementById('matStructOn').addEventListener('change', e => { MAT.rheo.structOn = e.target.checked; render(); });
  document.getElementById('matRheoReset').onclick = () => { undoHint('Rheology values back to their defaults'); MAT = { ...MAT, rheo: matDefaults().rheo }; rheoSync('extras'); render(); };
  document.getElementById('matRheoEdit').onclick = () => { setPanelHidden('model', false); const d = [...document.querySelectorAll('#params > details.grp')].find(x => /Slurry/.test((x.querySelector('summary') || {}).textContent || '')); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } };
  document.getElementById('matFibreEdit').onclick = () => { FV.tree.fibre = true; tab = 4; render(); };
  matDerived();
  matRheoDerived();
  orWire();
  dryWireCard();
  filmWireCard();
  furnWireCard();
  rtDraw();
}
/** The rheology card's counts and warnings (in place). */
function matRheoDerived() {
  const r = MAT.rheo, used = MAT_RHEO.filter(matRheoUsed), n = f => used.filter(q => r[q[0]].flag === f).length;
  const probs = [];
  { const re = rheoError(); if (re) probs.push(re); }   // (MH-3: a law that cannot hold, never quietly changed)
  const der = document.getElementById('matRheoDerived');
  if (der) der.innerHTML = probs.map(t => `<p class="mat-warn warn-text">${t}</p>`).join('');
  const cnt = document.getElementById('matRheoCount');
  if (cnt) cnt.textContent = used.length ? `of the ${used.length} in use: ${n('given')} from you · ${n('assumed')} assumed · ${n('measured')} measured` : 'none of these in use';
}
/** What follows from the slurry card (its density, the dry film's), the counts, the pills and the tiles: redrawn in place, so the card keeps its focus. */
function matDerived() {
  const c = MAT.slurry, keys = Object.keys(c), n = f => keys.filter(k => c[k].flag === f).length;
  const rho = slurryRho(), wm = slurrySolidsMass(), dryRho = c.phiDry.v * c.rhoS.v * 1000;
  const probs = [];
  if (c.phiDry.v * 100 < c.phi.v) probs.push(`The dry film's packing (${c.phiDry.v}) is below the solids fraction (${c.phi.v} vol%): the film would not shrink as it dries.`);
  if (!(c.dMin.v <= c.dMean.v && c.dMean.v <= c.dMax.v)) probs.push('The particle sizes are out of order: smallest ≤ mean ≤ largest.');
  const der = document.getElementById('matDerived');
  if (der) der.innerHTML = [
    ['Slurry density', rho.toFixed(0), 'kg/m³', `from the solids: ${c.phi.v} % × ${c.rhoS.v * 1000} + ${(100 - c.phi.v).toFixed(1)} % × ${c.rhoL.v}; the flow models use it`],
    ['Solids by mass', (wm * 100).toFixed(1), '%', 'from the solids fraction and the two densities'],
    ['Dry film density', dryRho.toFixed(0), 'kg/m³', 'the dry film\'s packing × the GO density (its pores empty)'],
  ].map(([l, v, u, s]) => `<div class="mat-row mat-ro"><span class="mat-l">${l}</span><span class="mat-v"><b>${v}</b><span class="prop-u">${u}</span></span>${matFlagChip('calc')}<span class="mat-src-t">${s}</span></div>`).join('')
    + probs.map(t => `<p class="mat-warn warn-text">${t}</p>`).join('');
  const cnt = document.getElementById('matCount');
  if (cnt) cnt.textContent = `${n('given')} from you · ${n('assumed')} assumed · ${n('measured')} measured`;
  const st = document.getElementById('st');
  if (st) st.innerHTML = pill(`The slurry: ${c.phi.v} vol% GO (${(wm * 100).toFixed(1)} % by mass) in water, ${rho.toFixed(0)} kg/m³`, '')
    + pill(`${n('assumed')} of ${keys.length} slurry values assumed: measure them to firm up the answers`, n('assumed') ? 'warn' : 'ok')
    + probs.map(t => pill(t, 'bad')).join('')
    + (MAT.rheo.structOn ? pill(`Structure (thixotropy) on: ${MAT_RHEO.filter(q => q[10] === 'struct' && MAT.rheo[q[0]].flag === 'assumed').length} of its 4 values assumed`, MAT_RHEO.some(q => q[10] === 'struct' && MAT.rheo[q[0]].flag === 'assumed') ? 'warn' : 'ok') : pill('Structure (thixotropy) off: the steady flow curve everywhere', ''));
  const ss = document.getElementById('ss');
  if (ss) ss.innerHTML = [['Slurry density', `${rho.toFixed(0)} kg/m³`, 'density'], ['Solids by mass', `${(wm * 100).toFixed(1)} %`, 'weight'], ['Dry film density', `${dryRho.toFixed(0)} kg/m³`, 'density'], ['Particle size', `${c.dMin.v}–${c.dMax.v} µm`, 'range']]
    .map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${uiBadge(a[2])}${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}
