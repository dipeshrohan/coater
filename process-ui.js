'use strict';
/*
 * process-ui.js — the Process and Materials tabs (GO-0).
 * Process: the line as a chain of stages (the slurry, the coating under the blade, the flakes' alignment, drying
 * in the oven, the film peeled off the fibre web, its properties), each with where it stands; the first answers
 * from a mass balance on the wet film the flow models give (the dry film, the coat weight, the water the oven must
 * take out, the time in the oven); the oven's zones in the inputs bar.
 * Materials: the cards -- the slurry (GO solids in water, each value with its unit, source and flag: edited here);
 * how it flows (the rheology model, chosen here or in Flow › 2D; the sidebar's viscosity, n, yield stress and surface
 * tension as they are; the Carreau–Yasuda and Cross laws' extras and the structure (thixotropy) model edited here,
 * GO-1); and, as set elsewhere, the fibre web it is coated onto.
 */

// ---- the films the chain starts from ----
/** At location i, the most detailed film solved for the inputs as they are: 3D, else 2D, else the 1D (m); null while the 1D solves. */
function processFilmAt(i) {
  const th = threeDAt(i), st = th && !th.stale && Number.isInteger(th.m) && th.m >= 0 ? th.R.stations[th.m] : null;
  if (st && Number.isFinite(st.film)) return { h: st.film, src: '3D' };
  const two = twoDAt(i);
  if (two && !two.stale) return { h: two.r.Q / two.geo.U, src: '2D' };
  const R = ONE_D.res;
  return R && oneDCurrent() && R.locs[i] ? { h: R.locs[i].film, src: '1D' } : null;
}
/** The 1D across the web as a wet film over the width it covers (where the blade is): ∫ h dz (m²), that width (m), the mean, the range. */
function processWeb() {
  const A = oneDAcrossNow();
  if (!A || A.length < 2) return null;
  let area = 0;
  for (let k = 1; k < A.length; k++) area += (A[k].film + A[k - 1].film) / 2 * (A[k].z - A[k - 1].z) / 1000;
  const width = (A[A.length - 1].z - A[0].z) / 1000, films = A.map(r => r.film);
  return { A, area, width, mean: area / width, min: Math.min(...films), max: Math.max(...films) };
}
/** The line speed (m/s): the web's, through the oven. */
const lineSpeed = () => P.U / 60;
const um0 = v => (v * 1e6).toFixed(0), gm2 = v => v.toFixed(0);

// ---- the chain ----
const STAGE_ST = { set: ['Set', 'ok'], solved: ['Solved', 'ok'], busy: ['Solving', 'muted'], failed: ['Not solved', 'bad'], part: ['Mass balance', 'accent'], todo: ['Not solved yet', 'muted'], wait: ['Run the 2D', 'muted'], later: ['Later phase', 'muted'] };
// (the drying stage, go 'dry': scrolls to its section under the chain; 'oven' kept for the zones in the inputs bar)
function processStages() {
  const c = MAT.slurry, keys = Object.keys(c), nA = keys.filter(k => c[k].flag === 'assumed').length;
  const two = CFD_LOCS.map((_, i) => twoDAt(i)), n2 = two.filter(t => t && !t.stale).length, s2 = two.filter(t => t && t.stale).length;
  const S3 = typeof C3D_RES !== 'undefined' && C3D_RES ? C3D_RES : null, stale3 = S3 && S3.key !== c3dSolveKey3(S3);
  const one = ONE_D.res && oneDCurrent(), o = ovenTime(lineSpeed());
  return [
    { k: 'slurry', t: 'Slurry', go: 13, st: 'set', s: `GO in water, ${c.phi.v} vol% solids; ${nA} of ${keys.length} values assumed` },
    { k: 'coat', t: 'Coating under the blade', go: 8, st: one ? 'solved' : ONE_D.error ? 'failed' : 'busy',
      s: [one ? 'wet film from the 1D' : ONE_D.error ? '1D not solved' : '1D solving…', n2 ? `2D at ${n2} of 4 locations` : '', s2 ? `${s2} 2D out of date` : '', S3 ? `3D ${stale3 ? 'out of date' : 'solved'}` : ''].filter(Boolean).join(' · ') },
    (() => { const o = CFD_LOCS.map((_, i) => cfdRuns[i] && cfdRuns[i].result && !cfdIsStale(i) ? cfdRuns[i].result.orient : null).filter(Boolean);
      return { k: 'align', t: 'Flake alignment', go: 4, st: !MAT.orient.on ? 'set' : o.length ? 'solved' : 'wait',
        s: !MAT.orient.on ? 'off (Materials)' : o.length ? `flatness at the oven ${o.map(q => q.film.oven.Sy.toFixed(2)).join(', ')}${o.every(q => q.film.dried) ? `, dried ${o.map(q => q.film.dried.Sy.toFixed(2)).join(', ')}` : ''} (2D at ${o.length} of 4 locations)` : `${OR_MODELS[MAT.orient.model].charAt(0).toLowerCase() + OR_MODELS[MAT.orient.model].slice(1)}: computed with each 2D run` }; })(),
    { k: 'dry', t: 'Drying in the oven', go: 'dry', ...dryStage() },
    { k: 'film', t: 'Film, peeled off', go: 'film', ...filmStage() },
    { k: 'props', t: 'Properties', st: 'later', s: 'the GO film, reduced and graphene film (GO-5)' },
  ];
}
const STAGE_ICON = { slurry: 'drop', coat: 8, align: 'fibre', dry: 'oven', film: 'film', props: 'bars' };
function processChainHTML() {
  return `<ol class="chain" aria-label="The process, stage by stage">${processStages().map((g, i) => {
    const [stT, stC] = STAGE_ST[g.st], inner = `<span class="ch-n">${i + 1}</span><span class="ch-t">${uiBadge(STAGE_ICON[g.k])}${g.t}</span><span class="ch-st ch-${stC}">${stT}</span><span class="ch-s">${g.s}</span>`;
    return `<li class="ch-${g.st}">${g.go != null ? `<button type="button" class="ch-b" data-chain="${g.go}" title="${g.go === 'oven' ? 'The oven\'s zones, in the inputs bar' : g.go === 'dry' ? 'The drying, below the chain' : g.go === 'film' ? 'The film, below the drying' : `Open ${TABS[g.go]}`}">${inner}</button>` : `<div class="ch-b">${inner}</div>`}</li>`;
  }).join('')}</ol>`;
}

// ---- the page ----
/** The inputs bar on the Process tab: the oven's zones, and the slurry card's values the mass balance uses. */
function processSidebar() {
  const open = k => FV.tree[k] !== false ? ' open' : '';
  const c = MAT.slurry, row = (l, v) => `<div class="prop prop-ro"><span class="prop-l">${l}</span><span class="prop-v">${v}</span></div>`;
  document.getElementById('setupExtra').innerHTML = `
    <div class="tree-sep">Process setup</div>
    <details class="grp cfd-grp" data-tree="oven"${open('oven')}><summary>Drying air (oven)</summary>${ovenZonesTree({ peel: true })}</details>
    <details class="grp cfd-grp" data-tree="matro"${open('matro')}><summary>From the materials</summary>
      ${row('Solids (GO)', `${c.phi.v} vol%`)}${row('GO density', `${c.rhoS.v} g/cm³`)}${row('Liquid (water)', `${c.rhoL.v} kg/m³`)}${row('Dry film packing', `${c.phiDry.v}`)}${row('Slurry density', `${slurryRho().toFixed(0)} kg/m³`)}
      <p class="prop-note">The slurry's card, on Materials. Its density follows from the solids, and the flow models use it.</p>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="procToMat">${uiIco(13)}Edit in Materials</button></div>
    </details>`;
  document.querySelectorAll('#setupExtra details[data-tree]').forEach(d => d.addEventListener('toggle', () => { FV.tree[d.dataset.tree] = d.open; }));
  document.getElementById('procToMat').onclick = () => { tab = 13; render(); };
  wireOvenZones(() => processPage(true), render);
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
    top: processChainHTML() + drySectionHTML() + filmSectionHTML(),
    panes: [{ id: 'pr1', icon: 'film', title: 'Wet and dry film across the web', aria: 'Wet film and dry film against position across the web',
      legend: oneDLegend([['wet film (1D)', mut, 'dash'], ['dry film (mass balance)', acc]]),
      note: 'The wet film is the 1D gap flow at every position across the web (Flow › 1D › Across the web). The dry film is what is left when its water is gone: wet film × solids fraction / the dry film\'s packing (Materials).' }],
    extra: '<div class="proc-table" id="procTable"></div>',
  });
  if (!view.dataset.wired) {
    view.dataset.wired = '1';
    view.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-chain]');
      if (!b || tab !== 12) return;
      const go = b.dataset.chain;
      if (go === 'dry' || go === 'film') { const sec = document.getElementById(go === 'dry' ? 'drySec' : 'filmSec'); if (sec) sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      else if (go === 'peel') { FV.tree.oven = true; setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; const b = document.getElementById('ovzPeel'); if (b) b.scrollIntoView({ block: 'nearest' }); const f = document.getElementById('ovzPeelLen'); if (f) f.focus(); } }
      else if (go === 'oven') { FV.tree.oven = true; setPanelHidden('model', false); const d = document.querySelector('#setupExtra details[data-tree="oven"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); const f = d.querySelector('input'); if (f) f.focus(); } }
      else { tab = +go; render(); }
    });
  }
  const web = processWeb(), U = lineSpeed(), W = ACROSS_W / 1000, o = ovenTime(U), c = MAT.slurry;
  const st = document.getElementById('st'), ss = document.getElementById('ss');
  // (the web: the 1D across it; until it is solved, the four locations' mean)
  const locs = CFD_LOCS.map((_, i) => processFilmAt(i));
  const known = locs.filter(Boolean), hWeb = web ? web.mean : known.length ? known.reduce((a, q) => a + q.h, 0) / known.length : null;
  if (hWeb == null) { st.innerHTML = ONE_D.error ? pill('The 1D could not be solved: ' + ONE_D.error, 'bad') : pill('Solving the 1D…', ''); ss.innerHTML = ''; drawProcessTable(locs, web); dryRender(); filmRender(); return; }
  const mb = massBalance(hWeb, U, W), wetTooLoose = c.phiDry.v * 100 < c.phi.v;
  let pills = pill(`Dry film ${um0(mb.dry)} µm${web ? ` across the web (${um0(massBalance(web.min, U, W).dry)}–${um0(massBalance(web.max, U, W).dry)} µm)` : ''}, from a ${(hWeb * 1000).toFixed(3)} mm wet film`, '');
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
}
/** Per location: the wet film (and which model it is from), and what the mass balance makes of it; the web's mean beside them. */
function drawProcessTable(locs, web) {
  const host = document.getElementById('procTable');
  if (!host) return;
  const U = lineSpeed(), W = ACROSS_W / 1000;
  const cols = [...locs.map((q, i) => ({ h: q && q.h, head: `L${i + 1}<small>z ${CFD_LOCS[i].z} mm${q ? ` · ${q.src}` : ''}</small>` })), { h: web && web.mean, head: `The web<small>mean, 1D across it</small>` }];
  const rows = [
    ['Wet film', 'mm', h => (h * 1000).toFixed(3)],
    ['Dry film', 'µm', h => um0(massBalance(h, U, W).dry)],
    ['Coat weight, dry', 'g/m²', h => gm2(massBalance(h, U, W).coatDry)],
    ['Coat weight, wet', 'g/m²', h => gm2(massBalance(h, U, W).coatWet)],
    ['Water to take out', 'g/m²', h => (massBalance(h, U, W).water * 1000).toFixed(0)],
  ];
  host.innerHTML = `<h3 class="oned-h">The mass balance at each location</h3><div class="oned-scroll"><table class="cfd-table proc-mb">
    <tr><th>Quantity</th>${cols.map(c => `<th>${c.head}</th>`).join('')}</tr>
    ${rows.map(([t, u, f]) => `<tr><th scope="row">${t} <small>${u}</small></th>${cols.map(c => c.h != null ? `<td>${f(c.h)}</td>` : '<td class="na" title="solving">—</td>').join('')}</tr>`).join('')}
  </table></div>
  <p class="fv-note">Each location's wet film is the most detailed one solved for the inputs as they are: 3D (a strip there or the full width), else 2D, else the 1D. What the oven must take out is the water; the solids stay, packed at the dry film's packing (Materials): dry film = wet film × ${MAT.slurry.phi.v} vol% / ${MAT.slurry.phiDry.v}. Coat weight dry = wet film × solids fraction × GO density; wet = wet film × the slurry's density (${slurryRho().toFixed(0)} kg/m³). The web's water per second: its wet film over the ${ACROSS_W} mm width (where the blade is) × the water fraction × the line speed (${P.U} m/min). Time in the oven: its length (${+ovenTime(U).len.toFixed(2)} m, ${OVEN.zones.length} zones) / the line speed. The drying itself is above (4 · Drying in the oven); the film's stresses and peel, and its properties come in the next phases.</p>`;
}

// ---- Materials ----
const MAT_FLAG_CLASS = { given: 'f-given', assumed: 'f-assumed', measured: 'f-measured' };
const matFlagChip = f => f === 'calc' ? '<span class="mat-flag f-calc">Worked out</span>' : `<span class="mat-flag ${MAT_FLAG_CLASS[f] || ''}">${(MAT_FLAGS.find(q => q[0] === f) || [0, f])[1]}</span>`;
/** The rheology card's first rows: the model and the sidebar's slurry inputs, as they are. */
function matRheoBase() {
  const flag = c => /assumed/.test(c.h || '') ? 'assumed' : 'given', cf = k => CFG.find(c => c.k === k);
  return [
    ['Rheology model', RHEO_MODELS[CFDG.model].l, '', 'given', 'chosen here or in Flow › 2D (the CFD setup)'],
    ...['mu', 'n', 'ty', 'g'].map(k => { const c = cf(k), fit = (MAT.rheo.side || {})[k];
      return fit && fit.v === P[k] ? [c.l, P[k].toFixed(c.d), c.u, 'measured', fit.src] : [c.l, P[k].toFixed(c.d), c.u, flag(c), c.h || 'you (measured)']; }),
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
      ${rtCardHTML()}
      <section class="mat-card" aria-labelledby="matFibreH">
        <header><h3 id="matFibreH">${uiBadge('fibre')}Fibre web: what it is coated onto</h3><button type="button" class="linkish" id="matFibreEdit">Edit in Flow › 2D</button></header>
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
  // the rheology card: the model (as Flow › 2D's), the laws' extras and the structure
  document.getElementById('matModel').addEventListener('change', e => { CFDG.model = e.target.value; render(); });
  const rKey = k => MAT_RHEO.find(q => q[0] === k);
  view.querySelectorAll('input[type=number][data-mr]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mr, [, l, u, lo, hi] = rKey(k);
    guardNumber(el, { label: l, lo, hi, unit: u }, v => { MAT.rheo[k] = { ...MAT.rheo[k], v }; });
    el.value = MAT.rheo[k].v;
    matRheoDerived(); matDerived();
  }));
  view.querySelectorAll('select[data-mr]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mr; MAT.rheo[k] = { ...MAT.rheo[k], flag: el.value };
    el.className = `mat-fsel ${MAT_FLAG_CLASS[el.value] || ''}`;
    matRheoDerived(); matDerived();
  }));
  view.querySelectorAll('input.mat-src[data-mr]').forEach(el => el.addEventListener('change', () => { const k = el.dataset.mr; MAT.rheo[k] = { ...MAT.rheo[k], src: el.value.trim() }; }));
  document.getElementById('matStructOn').addEventListener('change', e => { MAT.rheo.structOn = e.target.checked; render(); });
  document.getElementById('matRheoReset').onclick = () => { undoHint('Rheology values back to their defaults'); MAT = { ...MAT, rheo: matDefaults().rheo }; render(); };
  document.getElementById('matRheoEdit').onclick = () => { setPanelHidden('model', false); const d = [...document.querySelectorAll('#params > details.grp')].find(x => /Slurry/.test((x.querySelector('summary') || {}).textContent || '')); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } };
  document.getElementById('matFibreEdit').onclick = () => { FV.tree.fibre = true; tab = 4; render(); };
  matDerived();
  matRheoDerived();
  orWire();
  dryWireCard();
  filmWireCard();
  rtDraw();
}
/** The rheology card's counts and warnings (in place). */
function matRheoDerived() {
  const r = MAT.rheo, used = MAT_RHEO.filter(matRheoUsed), n = f => used.filter(q => r[q[0]].flag === f).length;
  const probs = [];
  if ((CFDG.model === 'carreau' || CFDG.model === 'cross') && r.etaInf.v > 0.5 * P.mu) probs.push(`The viscosity at high shear (${r.etaInf.v} Pa·s) is above half the viscosity at 2.7 1/s (${P.mu} Pa·s): the law uses half, ${(0.5 * P.mu).toFixed(3)} Pa·s.`);
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
