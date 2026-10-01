'use strict';
/*
 * orient-ui.js — the flakes' alignment in the app (GO-2).
 *  - Materials: the alignment card: on or off; the model (the liquid crystal, Doi–Hess, the default; or the
 *    suspension, Folgar–Tucker) and its values, each with where it is from; the flakes' shape from the slurry card.
 *  - Coating › 2D › Flakes (a results panel): the alignment the 2D computed along its flow to the film and on the web to
 *    the oven (cfd-orient.js, in the 2D's worker): the flatness through the film leaving the blade and at the oven,
 *    the two SEM cuts (their flakes' angles, their order through the film), a cross-section drawn from the flakes, a
 *    table by streamline; redone alone (the flow as solved) after its values change.
 *  - The measured side, in the same panel: SEM images of the dried film's cross-section, read automatically or by
 *    hand (sem.js), and tables of flake angles, next to the model's.
 *  - Over the 2D flow plot: the flakes along the streamlines (a toolbar switch).
 * Loaded after rheo-ui.js, before process-ui.js (whose Materials page draws the card).
 */

const OR_MODELS = { dh: 'Liquid crystal (Doi–Hess)', ft: 'Suspension (Folgar–Tucker)' };
const OR = { redo: {}, img: null, mode: null, pend: null, cut: 'md' };   // (redos running; the SEM image open, its marking mode, a click waiting for its pair)
const OR_URLS = new Map();   // (the SEM images' pixels by their id: undo keeps the marks, the pixels stay here)
const orEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Doi–Hess at rest: the Maier–Saupe order S(U) (ψ ∝ exp(1.5 U S cos²θ), self-consistent; 0: isotropic, below about 4.49). */
function orRestS(U) {
  const f = S => {
    const a = 1.5 * U * S, m = 400; let n = 0, d = 0;
    for (let k = 0; k <= m; k++) { const x = k / m, w = (k === 0 || k === m ? 0.5 : 1) * Math.exp(a * (x * x - 1)); n += w * (1.5 * x * x - 0.5); d += w; }
    return n / d;
  };
  let S = 0.99;
  for (let it = 0; it < 2000; it++) { const S2 = f(S); if (Math.abs(S2 - S) < 1e-12) { S = S2; break; } S = S2; }
  return S > 1e-3 ? S : 0;
}

// ---- the Materials card ----
/** A card row not used as things are: all when the alignment is off; the other model's values. */
const orRowOff = q => !MAT.orient.on ? 'the alignment is off' : q[10] !== 'num' && q[10] !== MAT.orient.model ? `used by the ${q[10] === 'dh' ? 'liquid crystal (Doi–Hess)' : 'suspension (Folgar–Tucker)'}` : false;
function orCardHTML() {
  const o = MAT.orient;
  return `<section class="mat-card" aria-labelledby="matOrH">
    <header><h3 id="matOrH">${uiBadge('fibre')}Flakes: how they line up</h3><button type="button" class="linkish" id="matOrSee">See them in Coating › 2D</button></header>
    <div class="mat-sub"><label class="mat-switch"><input type="checkbox" id="matOrOn"${o.on ? ' checked' : ''}><b>Alignment</b></label><span>${o.on ? 'on: computed with each 2D run, along its flow to the film and on the web to the oven' : 'off: the 2D computes no alignment'}</span></div>
    ${matGroupRows('orient', MAT_ORIENT, 'mo', 'mato', { off: orRowOff, lead: { slurry: `    <div class="mat-row${o.on ? '' : ' mat-off'}"><label class="mat-l" for="matOrModel">Model</label><span class="mat-v"><select id="matOrModel" class="mat-msel"${o.on ? '' : ' disabled'}>${Object.entries(OR_MODELS).map(([k, l]) => `<option value="${k}"${k === o.model ? ' selected' : ''} title="${l}">${l.replace(/ \(.*/, '')}</option>`).join('')}</select></span><span class="mat-src-t" title="${OR_MODELS[o.model]}">${OR_MODELS[o.model]}: the default (you), for your ${MAT.slurry.phi.v} vol% of flakes about ${Math.round(1 / matFlakeRatio())} × wider than thick</span></div>` } })}
    <div class="ms-worked"><b>Worked out</b><span>from the values above</span></div>
    <div id="matOrDerived"></div>
    <div class="mat-actions"><button type="button" class="btn btn-secondary btn-sm" id="matOrReset">${uiIco('restart')}Defaults</button><span class="mat-count" id="matOrCount"></span></div>
  </section>`;
}
function orWire() {
  matWireRows('orient', 'mo', orDerived);
  document.getElementById('matOrOn').addEventListener('change', e => { MAT.orient.on = e.target.checked; render(); });
  document.getElementById('matOrModel').addEventListener('change', e => { MAT.orient.model = e.target.value; render(); });
  document.getElementById('matOrReset').onclick = () => { const d = matDefaults().orient; MAT.orient.on = d.on; MAT.orient.model = d.model; msCardReset('orient', 'Alignment values back to their defaults'); };
  document.getElementById('matOrSee').onclick = () => { tab = 4; FV.step = 'results'; FV.dock = 'flakes'; render(); };
  orDerived();
}
/** What follows from the card (the flakes' shape, the order at rest), its counts and warnings: in place. */
function orDerived() {
  const o = MAT.orient, r = matFlakeRatio(), beta = (r * r - 1) / (r * r + 1), used = MAT_ORIENT.filter(q => !orRowOff(q) && q[10] !== 'num');
  const rows = [['Flakes, thickness / width', r < 0.01 ? r.toExponential(2) : r.toFixed(3), '', `the slurry card: ${MAT.slurry.tFlake.v} nm thick, ${MAT.slurry.dMean.v} µm wide; Jeffery's shape factor β = ${beta.toFixed(6)}`]];
  const probs = [];
  if (o.model === 'dh') {
    const S = orRestS(o.U.v);
    rows.push(['Order at rest, S', S.toFixed(3), '', S > 0 ? 'the liquid crystal at rest (Maier–Saupe, from U): 1 all lined up, 0 random' : 'U below about 4.5: at rest the flakes point every way (not a liquid crystal)']);
    if (o.U.v > 4.4 && o.U.v < 5.1) probs.push(`U = ${o.U.v} is at the edge of the liquid crystal (4.5 to 5): its order settles slowly and the result depends on it strongly.`);
    if (!(o.Dr.v > 0)) probs.push('D_r = 0: the liquid crystal needs its rotary diffusion (its ordering acts through it); nothing would relax.');
  } else if (!(o.Ci.v > 0)) probs.push('C_i = 0: no diffusion, the flakes only turn with the flow (Jeffery): they never settle to a steady state at the inlet.');
  const der = document.getElementById('matOrDerived');
  if (der) der.innerHTML = rows.map(([l, v, u, s]) => `<div class="mat-row mat-ro"><span class="mat-l">${l}</span><span class="mat-v"><b>${v}</b><span class="prop-u">${u}</span></span><span class="mat-src-t" title="${orEsc(s)}">${s}</span></div>`).join('')
    + probs.map(t => `<p class="mat-warn warn-text">${t}</p>`).join('');
  const cnt = document.getElementById('matOrCount'), n = f => used.filter(q => o[q[0]].flag === f).length;
  if (cnt) cnt.textContent = o.on ? '' : 'the alignment is off';
}
/** The card read-only (the report): the switch, the model, its values in use, the flakes' shape. */
function orCardRows() {
  const o = MAT.orient, r = matFlakeRatio();
  return [
    ['Alignment', o.on ? 'on' : 'off', '', 'given', o.on ? 'computed with each 2D run' : 'the 2D computes none'],
    ['Model', OR_MODELS[o.model], '', 'given', 'you'],
    ...MAT_ORIENT.filter(q => !orRowOff(q)).map(([k, l, u, , , , d]) => [l, (+o[k].v).toFixed(d), u, 'set:' + msFromText('orient', k), o[k].src]),
    ['Flakes, thickness / width', r.toExponential(2), '', 'calc', 'from the slurry card'],
    ...(o.model === 'dh' ? [['Order at rest, S', orRestS(o.U.v).toFixed(3), '', 'calc', 'Maier–Saupe, from U']] : []),
  ];
}

// ---- the 2D's alignment: its state, the log line, redoing it alone ----
function orientLogText(o) {
  const f = o.film, turn = o.lines.filter(l => l.start.turning).length;
  return `flake alignment (${o.model.kind === 'ft' ? 'Folgar–Tucker' : 'Doi–Hess'}): flatness ${f.out.Sy.toFixed(2)} leaving the blade, ${f.oven.Sy.toFixed(2)} at the oven${f.dried ? `, ${f.dried.Sy.toFixed(2)} dried` : ''}; SEM spread ${orSeen(o).cuts.md.spread.toFixed(0)}° along the web, ${orSeen(o).cuts.cd.spread.toFixed(0)}° across; ${o.lines.length} streamlines${turn ? `, ${turn} turning over where they enter` : ''}, ${(o.ms / 1000).toFixed(1)} s`;
}
/** A location's alignment: 'busy' (redone now), 'noflow', 'off', 'missing' (the flow solved without it), 'stale', 'ok'. */
function orStatus(i) {
  const run = cfdRuns[i], cur = matOrient();
  if (OR.redo[i]) return 'busy';
  if (!run || !run.field || !run.result) return 'noflow';
  if (!cur) return 'off';
  if (!run.result.orient) return 'missing';
  return run.orientKey === cfdOrientKey({ ...run.geo, orient: cur }) ? 'ok' : 'stale';
}
/** The alignment redone alone on the flow as solved (its grid in the result), with the card as it is now. */
function orRedo(i) {
  const run = cfdRuns[i], cur = matOrient();
  if (!run || !run.field || !run.result || !cur || OR.redo[i]) return;
  const r = run.result, grid = { nx: r.nx, ny: r.ny, gx: r.gx, gy: r.gy, u: r.u, v: r.v, psi: r.psi, mu: r.mu, tauXX: r.tauXX, tauXY: r.tauXY, tauYY: r.tauYY, omega: r.omega };
  const tRest = Math.max(0, (run.geo.ovenDistance - r.filmStart) / run.geo.U);
  const worker = makeWorker('cfd-worker.js');
  OR.redo[i] = { worker, share: 0 };
  logCFD(i, 'flake alignment: redone on the flow as solved');
  const done = () => { worker.terminate(); delete OR.redo[i]; };
  worker.onmessage = e => {
    if (e.data.progress) { if (OR.redo[i]) OR.redo[i].share = e.data.progress.s || 0; orProgress(); return; }
    done();
    if (e.data.ok) { run.result.orient = e.data.orient; run.orientKey = cfdOrientKey({ ...run.geo, orient: cur }); logCFD(i, orientLogText(e.data.orient), 'ok'); }
    else logCFD(i, `flake alignment failed: ${e.data.error}`, 'bad');
    renderCFD();
  };
  worker.onerror = e => { done(); logCFD(i, `flake alignment failed: ${e.message || 'worker error'}`, 'bad'); renderCFD(); };
  worker.postMessage({ orientOnly: true, grid, orient: cur, tRest });
  renderCFD();
}
/** Stop every alignment being redone (New, Open): their workers ended (each wrote into its location's result). */
function orStopAll() { for (const i of Object.keys(OR.redo)) { OR.redo[i].worker.terminate(); delete OR.redo[i]; } }
/** The redo's progress, in place. */
function orProgress() {
  const el = document.getElementById('orBusy');
  if (!el) return;
  const i = orLoc(), b = OR.redo[i];
  el.textContent = b ? `Redoing the alignment… ${Math.round(100 * b.share)} %` : '';
}
/** The location the Flakes panel shows: the one in view; in Compare or Difference, the first with an alignment (else the first). */
function orLoc() {
  if (typeof FV.view === 'number') return FV.view;
  const list = FV.view === 'diff' ? [FV.diff.a, FV.diff.b] : CFD_LOCS.map((_, i) => i);
  return list.find(i => cfdRuns[i] && cfdRuns[i].result && cfdRuns[i].result.orient) ?? list[0];
}

// ---- the measured alignment: SEM images and tables ----
const orId = () => Math.random().toString(36).slice(2, 10);
/**
 * Every measured angle of a cut: { angles, depths (0..1, NaN when not known), weights, sets } from the images and
 * tables, each set weighted as one measurement.
 */
function orMeasured(cut) {
  const out = { angles: [], depths: [], weights: [], sets: 0 };
  for (const im of (MAT.sem || { images: [] }).images) {
    if (im.cut !== cut || !im.web || !im.top) continue;
    const parts = [im.auto && im.useAuto !== false ? im.auto : null, im.hand && im.hand.length ? semHand(im.hand, { web: im.web, top: im.top }) : null].filter(p => p && p.angles.length);
    for (const p of parts) {
      // (each set -- an image's automatic reading, its clicks, a table -- one measurement: the same total weight,
      // whether it is 2000 points read or 12 flakes clicked)
      const sw = p.weights.reduce((a, b) => a + b, 0) || 1;
      out.sets++;
      out.angles.push(...p.angles); out.depths.push(...p.depths); out.weights.push(...p.weights.map(w => w / sw));
    }
  }
  for (const t of (MAT.sem || { tables: [] }).tables) {
    const rows = t.rows.filter(r => r[0] === cut);
    if (!rows.length) continue;
    out.sets++;
    for (const [, d, a] of rows) {
      out.angles.push(a); out.weights.push(1 / rows.length);
      out.depths.push(!Number.isFinite(d) ? NaN : t.fraction ? d : t.thickness > 0 ? d / t.thickness : NaN);
    }
  }
  return out;
}
/** Import a table of flake angles (a text file: CSV, tab or semicolon separated). */
function orImportTable() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,.txt,.tsv,.dat,text/csv,text/plain';
  inp.onchange = async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try { orAddTable(f.name, await f.text()); } catch (e) { imgToast(`Could not read ${f.name}: ${e.message}`, 'error'); }
  };
  inp.click();
}
function orAddTable(name, text) {
  const t = semTable(text);
  if (!t.rows.length) { imgToast(`${name}: no flake angles found (${t.problems.join('; ') || 'a header row with an angle column, e.g. cut,depth_um,angle_deg'}).`, 'error'); return; }
  undoHint(`Import flake angles ${name}`);
  MAT = { ...MAT, sem: { ...MAT.sem, tables: [...MAT.sem.tables, { id: orId(), name, rows: t.rows, thickness: t.thickness, fraction: t.fraction }] } };
  if (t.skipped || t.problems.length) imgToast(`${name}: ${t.rows.length} angles${t.skipped ? `, ${t.skipped} rows without an angle left out` : ''}${t.problems.length ? `; ${t.problems.join('; ')}` : ''}.`);
  renderCFD();
}
/** Paste a table of flake angles (cells copied from a spreadsheet). */
function orPasteTable() {
  const box = document.getElementById('orPasteBox');
  if (!box) return;
  box.hidden = !box.hidden;
  if (!box.hidden) box.querySelector('textarea').focus();
}
/** Add an SEM image (PNG, JPEG, …): kept in the project, at most 1600 px on its long side. */
function orImportImage() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/gif,image/bmp,image/webp';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const rec = { id: orId(), name: f.name, url: c.toDataURL('image/jpeg', 0.92), w, h, scaled: k < 1 ? k : 1, cut: OR.cut, web: null, top: null, scale: null, hand: [], auto: null, win: 3, useAuto: true };
      undoHint(`Add SEM image ${f.name}`);
      MAT = { ...MAT, sem: { ...MAT.sem, images: [...MAT.sem.images, rec] } };
      OR.img = rec.id; OR.mode = 'web'; OR.pend = null;
      renderCFD();
    };
    img.onerror = () => { URL.revokeObjectURL(url); imgToast(`${f.name}: not an image the browser can open (PNG, JPEG, GIF, BMP, WebP; a TIFF: save it as PNG first).`, 'error'); };
    img.src = url;
  };
  inp.click();
}
const orImage = () => (MAT.sem.images || []).find(q => q.id === OR.img) || null;
/** Change an image's record (undoable). */
function orSetImage(id, patch, label) {
  if (label) undoHint(label);
  MAT = { ...MAT, sem: { ...MAT.sem, images: MAT.sem.images.map(q => q.id === id ? { ...q, ...patch } : q) } };
}
function orRemoveSet(kind, id) {
  const list = MAT.sem[kind], q = list.find(x => x.id === id);
  if (!q) return;
  undoHint(`Remove ${kind === 'images' ? 'SEM image' : 'flake angles'} ${q.name}`);
  MAT = { ...MAT, sem: { ...MAT.sem, [kind]: list.filter(x => x.id !== id) } };
  if (OR.img === id) { OR.img = null; OR.mode = null; }
  renderCFD();
}
/** Read an image automatically (its film marked): the structure tensor at every few pixels (sem.js). */
function orReadAuto(id) {
  const im = MAT.sem.images.find(q => q.id === id);
  if (!im || !im.web || !im.top) return;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = im.w; c.height = im.h;
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, im.w, im.h).data, gray = semGray(d, im.w, im.h);
    const r = semAngles(gray, im.w, im.h, { web: im.web, top: im.top }, { window: im.win || 3, sigma: 1 });
    orSetImage(id, { auto: { angles: r.angles.map(a => +a.toFixed(2)), depths: r.depths.map(a => +a.toFixed(4)), weights: r.weights.map(a => +a.toFixed(3)), xs: r.xs, ys: r.ys } }, `Read ${im.name} automatically`);
    if (!r.angles.length) imgToast(`${im.name}: no flakes' directions found in the film (mark the web's line and the film's top; a larger window for blurry images).`, 'error');
    renderCFD();
  };
  img.src = im.url;
}

// ---- the panel ----
const OR_COL = () => ({ out: cssVar('--accent'), oven: cssVar('--warn'), dried: cssVar('--ok'), md: locColor(0), cd: locColor(2), meas: cssVar('--ink'), mut: cssVar('--muted') });
/** The film an SEM sees: dried (GO-3: the flakes flattened as the film collapsed) when the alignment has it, else at the oven. */
const orSeen = o => o.cuts.dried ? { dried: true, cuts: o.cuts.dried, line: l => ({ md: l.mdD, cd: l.cdD }) } : { dried: false, cuts: o.cuts, line: l => ({ md: l.md, cd: l.cd }) };
const orAsp = cv => (cv.parentElement.clientWidth || 400) < 420 ? 0.75 : 0.55;
/** The measured angles binned through the film: [[depth mid, ⟨cos 2θ⟩, n]] for the depths known. */
function orBinned(m, nb = 8) {
  const b = Array.from({ length: nb }, () => [0, 0, 0]);
  m.angles.forEach((a, i) => { const d = m.depths[i]; if (!(d >= 0 && d <= 1)) return; const k = Math.min(nb - 1, Math.floor(d * nb)); b[k][0] += m.weights[i] * Math.cos(2 * a * Math.PI / 180); b[k][1] += m.weights[i]; b[k][2]++; });
  return b.map((q, k) => [(k + 0.5) / nb, q[1] ? q[0] / q[1] : NaN, q[2]]).filter(q => q[2] >= 3);
}
function renderFlakes() {
  const host = document.getElementById('cfdFlakes');
  if (!host) return;
  const i = orLoc(), run = cfdRuns[i], st = orStatus(i), o = run && run.result ? run.result.orient : null, cur = matOrient();
  const title = `Location ${i + 1} · z = ${CFD_LOCS[i].z} mm`;
  const msgs = {
    busy: 'Redoing the alignment on the flow as solved…', noflow: `${title} is not solved: run it (the alignment is computed with it).`,
    off: 'The alignment is off (Materials › Flakes: how they line up).', missing: 'This flow was solved without the alignment: redo it on the flow as solved.',
    stale: 'The alignment\'s values changed since it was computed: redo it (the flow stays as solved).', ok: '',
  };
  const mdM = orMeasured('md'), cdM = orMeasured('cd'), sem = MAT.sem || { images: [], tables: [] };
  const tRest = o ? o.tRest : null, seen = o ? orSeen(o) : null;
  host.innerHTML = `<div class="fv-bar">
      <span class="fv-ctl"><b>${title}</b></span>
      <button class="btn btn-secondary btn-sm" type="button" id="orRedo"${run && run.field && cur && !OR.redo[i] ? '' : ' disabled'}>${uiIco('restart')}Redo alignment</button>
      <button class="btn btn-secondary btn-sm" type="button" id="orCsv"${o ? '' : ' disabled'}>Export CSV</button>
      <span class="fv-why" id="orBusy"></span>
      <span class="fv-why">${msgs[st] ? `<span class="${st === 'ok' ? '' : 'warn-text'}">${msgs[st]}</span>` : o ? `${o.model.kind === 'ft' ? 'Folgar–Tucker' : 'Doi–Hess'} · ${o.lines.length} streamlines · ${(o.ms / 1000).toFixed(1)} s · on the web ${tRest.toFixed(0)} s to the oven` : ''}</span>
    </div>
    ${o ? `<div class="stats or-stats">${[
      ['Flatness leaving the blade', o.film.out.Sy.toFixed(2)], ['Flatness at the oven', o.film.oven.Sy.toFixed(2)],
      ...(o.film.dried ? [['Flatness dried', o.film.dried.Sy.toFixed(2)]] : []),
      [`SEM along the web: spread${seen.dried ? ', dried' : ''}`, `${seen.cuts.md.spread.toFixed(0)}°`], [`SEM across the web: spread${seen.dried ? ', dried' : ''}`, `${seen.cuts.cd.spread.toFixed(0)}°`],
      ['Director from the web\'s normal', `${o.film.oven.angle.toFixed(1)}°`],
      ...(mdM.angles.length ? [['Measured along: spread', `${orCutStatsSafe(mdM).spread.toFixed(0)}°`]] : []), ...(cdM.angles.length ? [['Measured across: spread', `${orCutStatsSafe(cdM).spread.toFixed(0)}°`]] : []),
    ].map(([l, v]) => `<div class="stat" title="${l}: ${v}"><span>${uiBadge('fibre')}${l}</span><strong>${v}</strong></div>`).join('')}</div>
    <div class="or-grid">
      <figure class="or-fig"><figcaption>Flatness through the film</figcaption><div class="xl-chart"><canvas id="orFlat" role="img" aria-label="Flatness against depth, leaving the blade and at the oven"></canvas></div></figure>
      <figure class="or-fig"><figcaption>SEM cuts: order through the film <small>⟨cos 2θ⟩, ${seen.dried ? 'the dried film' : 'at the oven'}</small></figcaption><div class="xl-chart"><canvas id="orCutS" role="img" aria-label="Order of the flakes' traces in the two cuts against depth"></canvas></div></figure>
      <figure class="or-fig"><figcaption>SEM cut along the web: flakes' angles</figcaption><div class="xl-chart"><canvas id="orHmd" role="img" aria-label="Histogram of the flakes' angles in a cut along the web"></canvas></div></figure>
      <figure class="or-fig"><figcaption>SEM cut across the web: flakes' angles</figcaption><div class="xl-chart"><canvas id="orHcd" role="img" aria-label="Histogram of the flakes' angles in a cut across the web"></canvas></div></figure>
      <figure class="or-fig"><figcaption>Drawn cross-section, along the web <small>from the flakes, ${seen.dried ? 'dried' : 'at the oven'}</small></figcaption><div class="xl-chart"><canvas id="orXmd" role="img" aria-label="A cross-section along the web drawn from the computed flakes"></canvas></div></figure>
      <figure class="or-fig"><figcaption>Drawn cross-section, across the web</figcaption><div class="xl-chart"><canvas id="orXcd" role="img" aria-label="A cross-section across the web drawn from the computed flakes"></canvas></div></figure>
    </div>
    <details class="or-table"${FV.orTable ? ' open' : ''}><summary>By streamline (${o.lines.length})</summary><div class="oned-scroll"><table class="cfd-table">
      <tr><th>Depth</th><th>Flatness leaving</th><th>at the oven</th>${o.film.dried ? '<th>dried</th>' : ''}<th>Order S</th><th>Director °</th><th>Along: spread °${seen.dried ? ' <small>dried</small>' : ''}</th><th>Across: spread °</th><th>Where it entered</th></tr>
      ${o.lines.slice().reverse().map(l => `<tr><td>${l.depth.toFixed(2)}</td><td>${l.out.Sy.toFixed(3)}</td><td>${l.oven.Sy.toFixed(3)}</td>${l.dried ? `<td>${l.dried.Sy.toFixed(3)}</td>` : ''}<td>${l.oven.S.toFixed(3)}</td><td>${l.oven.angle.toFixed(1)}</td><td>${seen.line(l).md.spread.toFixed(1)}</td><td>${seen.line(l).cd.spread.toFixed(1)}</td><td>${l.how === 'inlet' ? '' : l.how === 'still' ? 'a still corner' : 'traced too long'}${l.start.turning ? `${l.how === 'inlet' ? '' : '; '}turning over (${l.start.groups} moments mixed)` : ''}</td></tr>`).join('')}
    </table></div></details>` : ''}
    <h3 class="dock-h">Measured: SEM cross-sections</h3>
    <div class="fv-bar">
      <label class="fv-ctl">New image's cut <select id="orCutSel"><option value="md"${OR.cut === 'md' ? ' selected' : ''}>along the web (MD)</option><option value="cd"${OR.cut === 'cd' ? ' selected' : ''}>across the web (CD)</option></select></label>
      <button class="btn btn-secondary btn-sm" type="button" id="orAddImg">Add SEM image…</button>
      <button class="btn btn-secondary btn-sm" type="button" id="orAddTab">Import angle table…</button>
      <button class="btn btn-secondary btn-sm" type="button" id="orPaste">Paste angles</button>
    </div>
    <div id="orPasteBox" class="or-paste" hidden><textarea rows="5" aria-label="Flake angles to paste" placeholder="cut,depth_um,angle_deg&#10;MD,12.5,-3.2&#10;CD,15.0,1.1"></textarea><div><button class="btn btn-secondary btn-sm" type="button" id="orPasteOk">Add these angles</button> <span class="fv-why">A header row naming the columns: cut (MD / CD), depth (µm from the web, or a fraction 0–1), angle (° to the web); optional thickness (the film's, µm).</span></div></div>
    ${sem.images.length || sem.tables.length ? `<table class="cfd-table or-sets"><tr><th>Measured</th><th>Cut</th><th>Angles</th><th>Spread</th><th></th></tr>
      ${sem.images.map(im => { const p = orImagePoints(im); return `<tr${im.id === OR.img ? ' class="on"' : ''}><td><button type="button" class="linkish" data-or-open="${im.id}">${orEsc(im.name)}</button></td><td>${im.cut === 'cd' ? 'across' : 'along'}</td><td>${p.angles.length ? `${p.angles.length}${im.auto ? ' (auto)' : ''}${im.hand.length ? ` (${im.hand.length} by hand)` : ''}` : im.web && im.top ? 'not read' : 'film not marked'}</td><td>${p.angles.length ? orCutStatsSafe(p).spread.toFixed(1) + '°' : '—'}</td><td><button type="button" class="linkish" data-or-del="images:${im.id}">Remove</button></td></tr>`; }).join('')}
      ${sem.tables.map(t => { const md = t.rows.filter(r => r[0] === 'md').length, cd = t.rows.length - md; return `<tr><td>${orEsc(t.name)} <small>(table)</small></td><td>${md ? `along ${md}` : ''}${md && cd ? ', ' : ''}${cd ? `across ${cd}` : ''}</td><td>${t.rows.length}</td><td>—</td><td><button type="button" class="linkish" data-or-del="tables:${t.id}">Remove</button></td></tr>`; }).join('')}
    </table>` : '<p class="fv-note">No measurements yet: add an SEM image of the dried film\'s cross-section (then mark it and read it), or a table of flake angles.</p>'}
    <div id="orImgTool"></div>
    <p class="fv-note">The flakes' normals (their ensemble on each of ${cur ? cur.nLines : MAT.orient.nLines.v} streamlines, each an equal share of the film's flow) are carried through the 2D's velocity gradient from where the slurry enters to the film (${MAT.orient.model === 'ft' ? 'Folgar–Tucker: Jeffery\'s rotation and rotary diffusion C_i × the shear rate' : 'Doi–Hess: Jeffery\'s rotation, rotary diffusion and the flakes lining up with each other (their mean field)'}), then left at rest on the web until the oven. Flatness: (3⟨p_y²⟩ − 1) / 2 of the normals p: 1 all flat on the web, 0 random. A cut shows each flake as a line (its trace), its angle to the web; its order ⟨cos 2θ⟩ (1 all level) and spread (the angles' standard deviation) compare with an SEM image's. Measured depths: 0 at the web, 1 at the film's top (the dried film: the model's depths are the wet film's, shrunk alike). ${o && o.collapse ? `Dried: as the film dries it collapses through its thickness to ${o.collapse.toFixed(2)} of it (the solids ${MAT.slurry.phi.v} vol% packed to ${MAT.slurry.phiDry.v}; it cannot shrink along the web), flattening every flake alike: this is the film an SEM sees, so the cuts and the measured are compared dried.` : ''} ${o && o.lines.some(l => l.start.turning) ? 'Where the slurry enters in a slow shear the liquid crystal keeps turning over: those lines start as all moments of the turn mixed (as different spots across the web would be).' : ''}</p>`;
  const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  wire('orRedo', () => orRedo(i));
  wire('orCsv', () => orExportCSV(i));
  wire('orAddImg', orImportImage);
  wire('orAddTab', orImportTable);
  wire('orPaste', orPasteTable);
  wire('orPasteOk', () => { const ta = document.querySelector('#orPasteBox textarea'); if (ta && ta.value.trim()) orAddTable('pasted angles', ta.value); });
  const cs = document.getElementById('orCutSel'); if (cs) cs.onchange = () => { OR.cut = cs.value; };
  const tbl = host.querySelector('details.or-table'); if (tbl) tbl.addEventListener('toggle', () => { FV.orTable = tbl.open; });
  host.querySelectorAll('[data-or-open]').forEach(b => b.onclick = () => { OR.img = OR.img === b.dataset.orOpen ? null : b.dataset.orOpen; OR.mode = null; OR.pend = null; renderFlakes(); });
  host.querySelectorAll('[data-or-del]').forEach(b => b.onclick = () => { const [k, id] = b.dataset.orDel.split(':'); orRemoveSet(k, id); });
  orProgress();
  if (o) orDrawCharts(o, mdM, cdM);
  orImageTool();
}
/** orCutStats on a measured set (orient.js), or zeros when it is empty. */
const orCutStatsSafe = m => m.angles.length ? orCutStats(m.angles, m.weights) : { S2: NaN, mean: NaN, spread: NaN, n: 0 };
/** An image's readings together: its automatic points (when used) and its clicks. */
function orImagePoints(im) {
  const out = { angles: [], depths: [], weights: [] };
  if (!im.web || !im.top) return out;
  for (const p of [im.auto && im.useAuto !== false ? im.auto : null, im.hand && im.hand.length ? semHand(im.hand, { web: im.web, top: im.top }) : null]) {
    if (!p) continue;
    out.angles.push(...p.angles); out.depths.push(...p.depths); out.weights.push(...p.weights);
  }
  return out;
}
function orDrawCharts(o, mdM, cdM) {
  const C = OR_COL(), yt = [0, 0.25, 0.5, 0.75, 1], seen = orSeen(o);
  // flatness through the film: leaving, at the oven
  const cv1 = document.getElementById('orFlat');
  if (cv1) plotChart(cv1, orAsp(cv1), { x0: -0.2, x1: 1, y0: 0, y1: 1, xl: 'flatness (1 flat, 0 random)', yl: 'depth (0 web, 1 top)', xd: 1, yd: 2, yticks: yt,
    s: [{ p: o.lines.map(l => [l.out.Sy, l.depth]), c: C.out, w: 2 }, { p: o.lines.map(l => [l.oven.Sy, l.depth]), c: C.oven, w: 2, dash: [6, 4] },
      ...(o.film.dried ? [{ p: o.lines.map(l => [l.dried.Sy, l.depth]), c: C.dried, w: 2 }] : [])] });
  orLegend(cv1, [['leaving the blade', C.out], ['at the oven', C.oven, 'dash'], ...(o.film.dried ? [['dried', C.dried]] : [])]);
  // the cuts' order through the film, with the measured, binned
  const cv2 = document.getElementById('orCutS');
  if (cv2) {
    const bm = orBinned(mdM), bc = orBinned(cdM);
    const map = plotChart(cv2, orAsp(cv2), { x0: -0.2, x1: 1, y0: 0, y1: 1, xl: '⟨cos 2θ⟩ in the cut (1 all level)', yl: 'depth (0 web, 1 top)', xd: 1, yd: 2, yticks: yt,
      s: [{ p: o.lines.map(l => [seen.line(l).md.S2, l.depth]), c: C.md, w: 2 }, { p: o.lines.map(l => [seen.line(l).cd.S2, l.depth]), c: C.cd, w: 2 }] });
    const cx = cv2.getContext('2d');
    for (const [b, col] of [[bm, C.md], [bc, C.cd]]) for (const [d, s2] of b) { cx.beginPath(); cx.arc(map.X(Math.max(-0.2, s2)), map.Y(d), 4.5, 0, 7); cx.fillStyle = col; cx.fill(); cx.lineWidth = 1.5; cx.strokeStyle = C.meas; cx.stroke(); }
    orLegend(cv2, [['along the web', C.md], ['across', C.cd], ...(bm.length || bc.length ? [['measured (dots)', C.meas]] : [])]);
  }
  // the histograms: the model at the oven, the measured over it
  for (const [id, cut, M, col] of [['orHmd', 'md', mdM, C.md], ['orHcd', 'cd', cdM, C.cd]]) {
    const cv = document.getElementById(id);
    if (!cv) continue;
    const H = cut === 'md' ? seen.cuts.mdHist : seen.cuts.cdHist, nb = H.length, w = 180 / nb;
    const Hm = M.angles.length ? Array.from(orHist(M.angles, M.weights, nb)) : null;
    const top = Math.max(...H, ...(Hm || [0])) / w * 1.15;
    const step = h => { const p = []; h.forEach((v, k) => { p.push([-90 + k * w, v / w], [-90 + (k + 1) * w, v / w]); }); return p; };
    const map = plotChart(cv, orAsp(cv), { x0: -90, x1: 90, y0: 0, y1: top, xl: 'angle to the web (°)', yl: 'share per degree', yd: 3, xticks: [-90, -45, 0, 45, 90],
      s: [{ p: step(H), c: col, w: 2 }, ...(Hm ? [{ p: step(Hm), c: C.meas, w: 1.6, dash: [5, 3] }] : [])] });
    const cx = cv.getContext('2d'); cx.globalAlpha = 0.18; cx.fillStyle = col;
    H.forEach((v, k) => { const x0 = map.X(-90 + k * w), x1 = map.X(-90 + (k + 1) * w), y = map.Y(v / w); cx.fillRect(x0, y, x1 - x0, map.Y(0) - y); });
    cx.globalAlpha = 1;
    const sm = cut === 'md' ? seen.cuts.md : seen.cuts.cd, ms = orCutStatsSafe(M);
    orLegend(cv, [[`model${seen.dried ? ', dried' : ''}: spread ${sm.spread.toFixed(1)}°, mean ${sm.mean.toFixed(1)}°`, col], ...(Hm ? [[`measured: spread ${ms.spread.toFixed(1)}°, mean ${ms.mean.toFixed(1)}° (${M.angles.length})`, C.meas, 'dash']] : [])]);
  }
  // drawn cross-sections: each streamline's sampled flakes at its depth, at their angles (a fixed seed: the same each time)
  for (const [id, cut] of [['orXmd', 'md'], ['orXcd', 'cd']]) {
    const cv = document.getElementById(id);
    if (!cv) continue;
    const { c, w, h } = setupCanvas(cv, 0.42), dark = isDarkTheme();
    c.fillStyle = dark ? '#111418' : '#2b2f36'; c.fillRect(0, 0, w, h);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const L = Math.max(6, w / 38), pad = 6;
    for (const l of o.lines) {
      const s = l[cut].sample, y = pad + (1 - l.depth) * (h - 2 * pad), per = Math.max(4, Math.round(w / 34));
      for (let k = 0; k < Math.min(per, s.angles.length); k++) {
        // (a flake is cut in proportion to its weight: the thin ones seen edge-on more often)
        if (rnd() > s.weights[k]) continue;
        // (dried: each trace flattened as the film collapsed, tan θ' = λ tan θ)
        const a0 = s.angles[k] * Math.PI / 180, a = seen.dried ? Math.atan(o.collapse * Math.tan(a0)) : a0;
        const x = pad + rnd() * (w - 2 * pad), yy = y + (rnd() - 0.5) * (h - 2 * pad) / o.lines.length;
        c.beginPath(); c.moveTo(x - L * Math.cos(a), yy + L * Math.sin(a)); c.lineTo(x + L * Math.cos(a), yy - L * Math.sin(a));
        c.strokeStyle = 'rgba(225,228,232,0.9)'; c.lineWidth = 1.3; c.lineCap = 'round'; c.stroke();
      }
    }
    c.fillStyle = 'rgba(225,228,232,0.75)'; c.font = '10px ' + cssVar('--sans');
    c.fillText(cut === 'md' ? 'web moving →   (the web at the bottom; heights not to scale)' : 'across the web   (the web at the bottom)', 8, h - 6);
  }
}
/** A chart's legend under it (in its figure; the image export takes it with the chart): a dashed line says so in words. */
function orLegend(cv, items) {
  if (!cv) return;
  const fig = cv.closest('figure');
  let lg = fig.querySelector('.xl-legend');
  if (!lg) { lg = document.createElement('div'); lg.className = 'xl-legend or-leg'; fig.appendChild(lg); }
  lg.innerHTML = items.map(([t, c, d]) => `<span class="lg"><i class="xl-sw" style="background:${c}"></i>${t}${d ? ' (dashed)' : ''}</span>`).join('');
}
/** The per-streamline table and each cut's histogram, as CSV. */
function orExportCSV(i) {
  const o = cfdRuns[i].result.orient;
  const d = !!o.cuts.dried;
  const rows = [['streamline', 'depth', 'flatness_leaving', 'flatness_oven', 'S_oven', 'director_deg', 'md_S2', 'md_mean_deg', 'md_spread_deg', 'cd_S2', 'cd_mean_deg', 'cd_spread_deg', 'turning_where_entered',
      ...(d ? ['flatness_dried', 'md_S2_dried', 'md_spread_deg_dried', 'cd_S2_dried', 'cd_spread_deg_dried'] : [])],
    ...o.lines.map((l, k) => [k + 1, l.depth, l.out.Sy, l.oven.Sy, l.oven.S, l.oven.angle, l.md.S2, l.md.mean, l.md.spread, l.cd.S2, l.cd.mean, l.cd.spread, l.start.turning ? 'yes' : 'no',
      ...(d ? [l.dried.Sy, l.mdD.S2, l.mdD.spread, l.cdD.S2, l.cdD.spread] : [])]),
    [], ['angle_bin_deg', 'md_share', 'cd_share', ...(d ? ['md_share_dried', 'cd_share_dried'] : [])], ...o.cuts.mdHist.map((v, k) => [-90 + (k + 0.5) * 180 / o.cuts.mdHist.length, v, o.cuts.cdHist[k], ...(d ? [o.cuts.dried.mdHist[k], o.cuts.dried.cdHist[k]] : [])])];
  downloadCSV(`flakes_L${i + 1}_${csvStamp()}.csv`, rows);
}

// ---- the SEM image tool: mark the film, read it, click flakes ----
const OR_MODES = [['web', 'Web line', 'click two points on the web\'s line, in the web\'s direction (upstream first)'], ['top', 'Film top', 'click a point on the film\'s top'],
  ['scale', 'Scale bar', 'click both ends of the scale bar'], ['hand', 'Flakes by hand', 'click both ends of each flake']];
function orImageTool() {
  const host = document.getElementById('orImgTool'), im = orImage();
  if (!host) return;
  if (!im) { host.innerHTML = ''; return; }
  const n = orImagePoints(im), hint = (OR_MODES.find(q => q[0] === OR.mode) || [])[2] || 'choose what to mark';
  const um = im.scale && im.scale.um > 0 ? im.scale.um / Math.hypot(im.scale.x2 - im.scale.x1, im.scale.y2 - im.scale.y1) : null;
  const fr = im.web && im.top ? semFrame({ web: im.web, top: im.top }) : null;
  host.innerHTML = `<div class="or-tool">
    <div class="fv-bar">
      <b>${orEsc(im.name)}</b>
      <label class="fv-ctl">Cut <select id="orImCut"><option value="md"${im.cut === 'md' ? ' selected' : ''}>along the web (MD)</option><option value="cd"${im.cut === 'cd' ? ' selected' : ''}>across (CD)</option></select></label>
      <span class="seg" role="tablist" aria-label="What to mark">${OR_MODES.map(([k, l]) => `<button type="button" role="tab" data-or-mode="${k}" aria-selected="${OR.mode === k}">${l}</button>`).join('')}</span>
      <label class="fv-ctl" title="The structure tensor's window: about the flakes' thickness in the image">Window <input type="number" id="orImWin" min="1" max="20" step="0.5" value="${im.win || 3}"> px</label>
      <button class="btn btn-secondary btn-sm" type="button" id="orImRead"${fr ? '' : ' disabled'}>Read automatically</button>
      <label class="fv-chk"><input type="checkbox" id="orImUse"${im.useAuto !== false ? ' checked' : ''}${im.auto ? '' : ' disabled'}> use the automatic reading</label>
      <button class="btn btn-secondary btn-sm" type="button" id="orImUndoClick"${im.hand.length ? '' : ' disabled'}>Remove last flake</button>
    </div>
    <p class="fv-why">${OR.mode ? hint : 'Mark the web\'s line and the film\'s top, then read it automatically or click flakes by hand.'}${fr ? ` · film ${fr.thick.toFixed(0)} px${um ? ` = ${(fr.thick * um).toFixed(1)} µm` : ''}` : ''}${n.angles.length ? ` · ${n.angles.length} angles, spread ${orCutStatsSafe(n).spread.toFixed(1)}°` : ''}${im.scaled < 1 ? ` · kept at ${Math.round(im.scaled * 100)} % of its size` : ''}</p>
    <div class="or-canvas"><canvas id="orImCv" role="img" aria-label="The SEM image with what is marked on it"></canvas></div>
  </div>`;
  const cv = document.getElementById('orImCv'), img = new Image();
  const draw = () => orImageDraw(cv, img, im);
  img.onload = draw; img.src = im.url;
  document.getElementById('orImCut').onchange = e => { orSetImage(im.id, { cut: e.target.value }, `${im.name}: cut ${e.target.value === 'cd' ? 'across' : 'along'} the web`); renderFlakes(); orDrawAfter(); };
  host.querySelectorAll('[data-or-mode]').forEach(b => b.onclick = () => { OR.mode = OR.mode === b.dataset.orMode ? null : b.dataset.orMode; OR.pend = null; orImageTool(); });
  document.getElementById('orImWin').onchange = e => { const v = +e.target.value; if (v >= 1 && v <= 20) orSetImage(im.id, { win: v }); };
  document.getElementById('orImRead').onclick = () => orReadAuto(im.id);
  document.getElementById('orImUse').onchange = e => { orSetImage(im.id, { useAuto: e.target.checked }, `${im.name}: ${e.target.checked ? 'use' : 'leave out'} the automatic reading`); renderCFD(); };
  document.getElementById('orImUndoClick').onclick = () => { orSetImage(im.id, { hand: im.hand.slice(0, -1) }, `${im.name}: remove the last flake`); renderCFD(); };
  cv.onclick = e => {
    if (!OR.mode || !cv._map) return;
    const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / cv._map.k, y = (e.clientY - r.top) / cv._map.k;
    if (OR.mode === 'top') { orSetImage(im.id, { top: [x, y], auto: null }, `${im.name}: the film's top`); OR.mode = OR.pend = null; renderCFD(); return; }
    if (!OR.pend) { OR.pend = [x, y]; draw(); return; }
    const seg = [OR.pend[0], OR.pend[1], x, y]; OR.pend = null;
    if (OR.mode === 'web') { orSetImage(im.id, { web: seg, auto: null }, `${im.name}: the web's line`); OR.mode = im.top ? null : 'top'; renderCFD(); return; }
    if (OR.mode === 'scale') {
      const v = parseFloat(prompt('The scale bar\'s length (µm):', im.scale ? im.scale.um : ''));
      if (v > 0) orSetImage(im.id, { scale: { x1: seg[0], y1: seg[1], x2: seg[2], y2: seg[3], um: v } }, `${im.name}: its scale`);
      OR.mode = null; renderCFD(); return;
    }
    if (OR.mode === 'hand') { orSetImage(im.id, { hand: [...im.hand, seg] }, `${im.name}: a flake by hand`); renderCFD(); }
  };
}
/** After a change drawn in place: the charts and the list again. */
function orDrawAfter() { renderFlakes(); }
/** The image, fitted to the panel's width, and over it: the web's line, the film's top, the scale bar, the flakes clicked, the automatic reading. */
function orImageDraw(cv, img, im) {
  const W = cv.parentElement.clientWidth || 600, k = Math.min(1, W / im.w), dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(im.w * k * dpr); cv.height = Math.round(im.h * k * dpr); cv.style.width = im.w * k + 'px'; cv.style.height = im.h * k + 'px';
  const c = cv.getContext('2d'); c.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
  c.drawImage(img, 0, 0, im.w, im.h);
  cv._map = { k };
  const lw = 2 / k, dot = (x, y, col) => { c.beginPath(); c.arc(x, y, 4 / k, 0, 7); c.fillStyle = col; c.fill(); };
  const line = (s, col, w = lw) => { c.beginPath(); c.moveTo(s[0], s[1]); c.lineTo(s[2], s[3]); c.strokeStyle = col; c.lineWidth = w; c.stroke(); };
  // the automatic reading: a short tick at each point read (a direction a × the film's frame: along the web's line and up)
  if (im.auto && im.useAuto !== false && im.web && im.top && im.auto.xs) {
    const fr = semFrame({ web: im.web, top: im.top }), L = Math.max(3, (im.win || 3) * 1.6), every = Math.max(1, Math.ceil(im.auto.angles.length / 350));
    im.auto.angles.forEach((a, i) => {
      if (i % every) return;   // (at most about 350 drawn: the image stays visible)
      const r = a * Math.PI / 180, dx = Math.cos(r) * fr.tx + Math.sin(r) * fr.nx, dy = Math.cos(r) * fr.ty + Math.sin(r) * fr.ny;
      const px = im.auto.xs[i], py = im.auto.ys[i];
      c.beginPath(); c.moveTo(px - L * dx, py + L * dy); c.lineTo(px + L * dx, py - L * dy);
      c.strokeStyle = `hsla(${200 + 3 * a}, 90%, 60%, ${(0.35 + 0.65 * im.auto.weights[i]).toFixed(2)})`; c.lineWidth = 1.6 / k; c.stroke();
    });
  }
  if (im.web) { line(im.web, '#22c55e', 3 / k); dot(im.web[0], im.web[1], '#22c55e'); }
  if (im.top) {
    dot(im.top[0], im.top[1], '#f97316');
    if (im.web) { const fr = semFrame({ web: im.web, top: im.top }); if (fr) { const [x1, y1, x2, y2] = im.web, ox = fr.nx * fr.thick, oy = -fr.ny * fr.thick; c.setLineDash([6 / k, 4 / k]); line([x1 + ox, y1 + oy, x2 + ox, y2 + oy], '#f97316'); c.setLineDash([]); } }
  }
  if (im.scale) line([im.scale.x1, im.scale.y1, im.scale.x2, im.scale.y2], '#e5e7eb', 3 / k);
  for (const s of im.hand) { line(s, '#facc15'); dot(s[0], s[1], '#facc15'); dot(s[2], s[3], '#facc15'); }
  if (OR.pend) dot(OR.pend[0], OR.pend[1], '#ef4444');
}

// ---- over the 2D flow plot: the flakes along the streamlines ----
/** The flakes to draw over a location's flow plot: every other streamline's samples ({ x, y, A }). */
function orFlakeMarks(run) {
  const o = run && run.result && run.result.orient;
  if (!o) return null;
  const out = [];
  o.lines.forEach((l, j) => { if (j % 2 === 0) for (const q of l.samples) out.push(q); });
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { orRestS };
