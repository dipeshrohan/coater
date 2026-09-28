/*
 * sheet-ui.js — a piece cut from the roll, in 3D (GO-4d, sheet.js in cfd-sheet-worker.js), in the film's section on
 * the Process tab: the film shown, one way the water left at a time; the piece held up (free) and lying on a table
 * under its weight (Q67: where the curl is seen is not known), drawn in a view from above and the front with its
 * heights; its size pressed flat later against as cut (Q68/69); a measured size read back as the swelling it implies.
 * Q65: 30 × 30 cm pieces (an input); Q70: cut from the roll later.
 */
const SHEET = { res: null, key: null, busy: false, error: null, pending: null, worker: null, id: 0, way: 'top', again: false, prog: null, ms: 0 };
const SHEET_WAYS = { top: 'top only', both: 'top and bottom' };

/** The pieces to solve: the film shown, both ways, from its film's plate (null until the film is solved). */
function sheetInputs() {
  if (typeof FILM === 'undefined' || !filmCurrent()) return null;
  const [rt, rb] = filmRuns(DRY.sel);
  if (!rt || !rb || !rt.plate || !rb.plate) return null;
  return { key: DRY.sel, pieces: [['top', rt.plate], ['both', rb.plate]].map(([where, plate]) => ({ where, plate })), Lx: OVEN.peel.pieceL / 1000, Ly: OVEN.peel.pieceW / 1000, n: 8 };
}
const sheetKeyNow = () => { const q = sheetInputs(); return q ? JSON.stringify(q) : null; };
const sheetCurrent = () => !!SHEET.res && SHEET.key === sheetKeyNow();
function sheetRequest() {
  const q = sheetInputs();
  if (!q) return;
  const key = JSON.stringify(q);
  if (key === SHEET.key || key === SHEET.pending) return;
  if (SHEET.busy) { SHEET.again = true; return; }
  SHEET.busy = true; SHEET.again = false; SHEET.pending = key; SHEET.prog = null;
  if (!SHEET.worker) SHEET.worker = makeWorker('cfd-sheet-worker.js');
  const id = ++SHEET.id;
  SHEET.worker.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.progress) { SHEET.prog = m.progress; sheetStatusPaint(); return; }
    SHEET.busy = false; SHEET.pending = null; SHEET.key = key;
    if (m.ok) { SHEET.res = { runs: m.runs, q }; SHEET.error = null; SHEET.ms = m.ms; }
    else { SHEET.res = null; SHEET.error = m.error; }
    if (SHEET.again) sheetRequest();
    if (tab === 12) sheetRender();
  };
  SHEET.worker.onerror = e => { SHEET.busy = false; SHEET.pending = null; SHEET.key = key; SHEET.res = null; SHEET.error = e.message || 'the piece\'s worker failed'; if (tab === 12) sheetRender(); };
  SHEET.worker.postMessage({ id, ...q });
}
/** Wait for the piece for the inputs as they are (the report): true when solved. */
async function sheetWait() {
  for (let k = 0; k < 2400; k++) {
    if (typeof filmWait === 'function' && !filmCurrent()) { if (!(await filmWait())) return false; }
    sheetRequest();
    if (!SHEET.busy && sheetCurrent()) return true;
    if (!SHEET.busy && SHEET.error && SHEET.key === sheetKeyNow()) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- pictures ----
/** Q70: the roll kept, unwound and cut into pieces. */
function filmPicCut(sc = 1) {
  const w = 190, h = 90, cx = 38, cy = 44;
  let rings = `<circle cx="${cx}" cy="${cy}" r="30" fill="#fde3d3" stroke="#e8590c" stroke-width="2.5"/>`;
  for (const r of [23, 17]) rings += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e8590c" stroke-width="1.2" opacity="0.7"/>`;
  rings += `<circle cx="${cx}" cy="${cy}" r="10" fill="var(--soft)" stroke="var(--muted)" stroke-width="2.5"/>`;
  const sc2 = `<g transform="translate(116,44)"><circle cx="-5" cy="7" r="4" fill="none" stroke="var(--ink)" stroke-width="1.6"/><circle cx="5" cy="7" r="4" fill="none" stroke="var(--ink)" stroke-width="1.6"/><line x1="-3" y1="3" x2="4" y2="-11" stroke="var(--ink)" stroke-width="1.6"/><line x1="3" y1="3" x2="-4" y2="-11" stroke="var(--ink)" stroke-width="1.6"/></g>`;
  return filmSvg(w, h, 'Pieces cut from the roll later: the roll unwound and cut', `${rings}<path d="M68,${cy} L112,${cy}" stroke="#e8590c" stroke-width="3"/>${sc2}<rect x="132" y="${cy - 26}" width="50" height="50" fill="#fde3d3" stroke="#e8590c" stroke-width="2"/><text x="157" y="${cy + 38}" font-size="10" text-anchor="middle" fill="var(--muted)">a piece</text>`, sc);
}

/** Q72–Q77: 20 pieces stacked under an aluminium plate in the drying oven. */
function filmPicDryStack(sc = 1) {
  const w = 190, h = 106, b = 86;
  let st = ''; for (let k = 0; k < 10; k++) st += `<rect x="62" y="${b - k * 5}" width="66" height="3" fill="#e8590c"/>`;
  return filmSvg(w, h, 'The pieces stacked 20 at a time under an aluminium plate in the drying oven', `<rect x="30" y="14" width="130" height="84" rx="6" fill="none" stroke="#c92a2a" stroke-width="2"/><text x="95" y="10" font-size="9" text-anchor="middle" fill="#c92a2a">drying oven</text>${st}<rect x="58" y="${b - 10 * 5 - 5}" width="74" height="6" fill="#adb5bd" stroke="#868e96"/><text x="95" y="${b - 10 * 5 - 9}" font-size="8" text-anchor="middle" fill="var(--muted)">aluminium plate</text>`, sc);
}

// ---- the drawing: the piece in a view from above and the front, its heights exaggerated (said) ----
/**
 * r: a state's shape ({ n, W: heights (mm) on a (2n+1)² grid, rows across, columns along the line }), L, Wd its size
 * (mm), sign +1 or −1 (drawn with its curl up), table: draw the table under it.
 */
function drawSheet(cv, r, L, Wd, sign, table, col) {
  const { c, w, h } = setupCanvas(cv, 0.62), mut = cssVar('--muted'), ink = cssVar('--ink'), line = cssVar('--line');
  const n2 = r.W.length - 1, hs = r.W.map(row => row.map(v => sign * v)), lo = Math.min(...hs.flat()), H = hs.map(row => row.map(v => v - (table ? 0 : lo)));
  const hi = Math.max(1e-9, ...H.flat());
  // (the view: the piece's length across the canvas, its width going back at a slant)
  const a = (w - 90) / (L + 0.55 * Wd * 0.85), sx = a, cx0 = 30 + 0.55 * 0.85 * Wd * a / 2 + L * a / 2, cy0 = h - 44 - 0.5 * 0.5 * Wd * a;
  const room = cy0 - 0.5 * 0.5 * Wd * a - 26, ex = Math.max(1, Math.min(20, Math.floor(0.8 * room / (hi * a))));
  const P = (i, j, z) => { const u = (i / n2 - 0.5) * L, v = (j / n2 - 0.5) * Wd; return [cx0 + sx * u + 0.85 * 0.55 * a * v, cy0 - 0.5 * 0.55 * a * v - ex * a * z]; };
  if (table) {
    c.fillStyle = 'rgba(120,130,145,0.16)'; c.strokeStyle = line; c.lineWidth = 1;
    const tl = [P(-0.15 * n2, -0.2 * n2, 0), P(1.15 * n2, -0.2 * n2, 0), P(1.15 * n2, 1.2 * n2, 0), P(-0.15 * n2, 1.2 * n2, 0)];
    c.beginPath(); tl.forEach(([x, y], k) => k ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); c.stroke();
  }
  // (the quads from the back to the front: the top (orange tint) where it faces up, the underside (grey) where it shows)
  for (let j = n2 - 1; j >= 0; j--) for (let i = 0; i < n2; i++) {
    const q = [P(i, j, H[j][i]), P(i + 1, j, H[j][i + 1]), P(i + 1, j + 1, H[j + 1][i + 1]), P(i, j + 1, H[j + 1][i])];
    const cross = (q[1][0] - q[0][0]) * (q[3][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[3][0] - q[0][0]);
    c.fillStyle = cross < 0 ? '#fde3d3' : '#cfd6e0'; c.strokeStyle = cross < 0 ? 'rgba(232,89,12,0.35)' : 'rgba(120,130,145,0.4)'; c.lineWidth = 0.6;
    c.beginPath(); q.forEach(([x, y], k) => k ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); c.stroke();
  }
  c.strokeStyle = col || '#e8590c'; c.lineWidth = 2; c.beginPath();
  const edge = [...Array.from({ length: n2 + 1 }, (_, i) => [i, 0]), ...Array.from({ length: n2 + 1 }, (_, j) => [n2, j]), ...Array.from({ length: n2 + 1 }, (_, i) => [n2 - i, n2]), ...Array.from({ length: n2 + 1 }, (_, j) => [0, n2 - j])];
  edge.forEach(([i, j], k) => { const [x, y] = P(i, j, H[j][i]); k ? c.lineTo(x, y) : c.moveTo(x, y); }); c.closePath(); c.stroke();
  // (the line's direction, and the exaggeration)
  const [ax, ay] = P(0, -0.35 * n2, 0), [bx, by] = P(0.5 * n2, -0.35 * n2, 0);
  c.strokeStyle = mut; c.fillStyle = mut; c.lineWidth = 1.4; c.beginPath(); c.moveTo(ax, ay + 12); c.lineTo(bx, by + 12); c.stroke();
  c.beginPath(); c.moveTo(bx, by + 12); c.lineTo(bx - 7, by + 8); c.lineTo(bx - 7, by + 16); c.closePath(); c.fill();
  c.font = '11px ' + cssVar('--sans'); c.textAlign = 'left'; c.fillText('along the line (as it ran)', Math.max(4, ax), ay + 27);
  c.fillStyle = ink; c.textAlign = 'center'; c.fillText(`${L.toFixed(0)} × ${Wd.toFixed(0)} mm; heights ${ex > 1 ? `×${ex}` : 'to scale'}`, w / 2, 14);
}

/** A shape in words, from how high its ends (along the line) and its sides lift: which way it rolls, or a bowl. */
const sheetShapeKind = r => { const ex = r.edgeX, ey = r.edgeY; return Math.max(ex, ey, r.corner) < 1e-4 ? 'flat' : ex > 3 * ey ? 'along' : ey > 3 * ex ? 'across' : 'bowl'; };
const SHEET_SHAPES = { flat: 'flat', along: 'rolls up along the line: its ends lift (a tube lying across the web)', across: 'rolls up across the web: its sides lift (a tube lying along the line)', bowl: 'a bowl: its corners lift' };
const sheetShapeText = r => SHEET_SHAPES[sheetShapeKind(r)];
const sheetMM = v => `${(v * 1000).toFixed(v * 1000 >= 10 ? 0 : 1)} mm`;
/** Its size pressed flat later over as cut (Q68/69), from its film's plate. */
/** Its size pressed flat after the drying oven over as cut (Q71/72: dried through there), from its film's plate. */
const sheetSize = P => (1 + P.eFlatDry) / (1 + P.eFlatCut);
const SHEET_WHEN = { cut: 'before the drying oven (as cut)', dry: 'after the drying oven', furnace: 'after the furnace (graphene film)' };

// ---- the section's piece: its frame (inside the film's section), and its render ----
function sheetSectionHTML() {
  return `<div class="sheet-sec" id="sheetSec">
    <h3 class="oned-h">A piece cut from the roll, in 3D</h3>
    <div class="sheet-head">${filmPicCut(0.9)}<p class="fv-why">Pieces of ${OVEN.peel.pieceL} × ${OVEN.peel.pieceW} mm are cut from the roll later, then stacked 20 at a time under an aluminium plate and dried in the drying oven. As cut, how a piece curls is not known, nor where it is looked at, so it is shown held up (free) and lying on a table under its weight, drawn with its curl up.</p>
      <div class="seg" role="tablist" aria-label="Which way the water left" id="sheetWay">${Object.entries(SHEET_WAYS).map(([k, t]) => `<button type="button" role="tab" data-sheetway="${k}" aria-selected="${k === SHEET.way}">${t}</button>`).join('')}</div></div>
    <div id="sheetState"></div>
    <div class="dry-grid sheet-grid">
      <figure class="pane dry-pane"><figcaption>${uiBadge('film')}Held up (free)</figcaption><canvas id="sh1" role="img" aria-label="The cut piece held up, as it curls free, in a view from above and the front"></canvas><div class="pane-legend" id="sh1Lg"></div></figure>
      <figure class="pane dry-pane"><figcaption>${uiBadge('film')}On a table (its weight)</figcaption><canvas id="sh2" role="img" aria-label="The cut piece lying on a table under its weight, its curl up, in a view from above and the front"></canvas><div class="pane-legend" id="sh2Lg"></div></figure>
    </div>
    <div id="sheetMeas"></div>
  </div>`;
}
function sheetStatusPaint() {
  const el = document.getElementById('sheetState');
  if (el && SHEET.busy) { const p = SHEET.prog; el.innerHTML = `<p class="dry-msg">${pill(p ? `The piece: ${p.k + 1} of ${p.n}…` : 'The piece…', '')}</p>`; }
}
function sheetRender() {
  const sec = document.getElementById('sheetSec');
  if (!sec) return;
  if (!sec.dataset.wired) {
    sec.dataset.wired = '1';
    sec.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-sheetway]');
      if (b) { SHEET.way = b.dataset.sheetway; sheetRender(); return; }
      const del = e.target.closest && e.target.closest('[data-sheetdel]');
      if (del) { const k = +del.dataset.sheetdel; undoHint('Measured piece removed'); MAT = { ...MAT, filmMeas: { ...MAT.filmMeas, size: MAT.filmMeas.size.filter((_, i) => i !== k) } }; render(); return; }
      const use = e.target.closest && e.target.closest('[data-sheetuse]');
      if (use) { const [v, what] = use.dataset.sheetuse.split('|'); filmUse('beta', +v, what); }
    });
  }
  sec.querySelectorAll('[data-sheetway]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sheetway === SHEET.way)));
  const st = document.getElementById('sheetState');
  sheetMeasured();
  if (!filmCurrent()) { st.innerHTML = `<p class="fv-why">After the film is solved.</p>`; sheetClear(); return; }
  if (!sheetCurrent()) {
    if (SHEET.error && SHEET.key === sheetKeyNow()) { st.innerHTML = `<p class="dry-msg">${pill(`The piece could not be solved: ${dryEsc(SHEET.error)}`, 'bad')}</p>`; sheetClear(); return; }
    sheetRequest(); sheetStatusPaint(); sheetClear(); return;
  }
  const run = SHEET.res.runs.find(r => r.where === SHEET.way), q = SHEET.res.q, P = q.pieces.find(x => x.where === SHEET.way).plate;
  const L = q.Lx * 1000, Wd = q.Ly * 1000, sgnFree = P.kS + P.kSet > 0 ? -1 : 1;
  const col = DRY.sel === 'web' ? '#e8590c' : dryFilmColor(DRY.sel);
  drawSheet(document.getElementById('sh1'), run.free, L, Wd, sgnFree, false, col);
  drawSheet(document.getElementById('sh2'), run.table, L, Wd, 1, true, col);
  const words = (r, table) => `${sheetShapeText(r)}; its corners ${sheetMM(r.corner)} ${table ? 'off the table' : 'off its middle'}, the middles of its ends ${sheetMM(r.edgeX)}, of its sides ${sheetMM(r.edgeY)}`;
  const topDown = P.kS + P.kSet > 0;
  document.getElementById('sh1Lg').innerHTML = `<p class="fv-why">${words(run.free, false)}.</p>`;
  document.getElementById('sh2Lg').innerHTML = `<p class="fv-why">${words(run.table, true)}${run.table.middle > 1e-4 ? '' : '; its middle on the table'}.</p>`;
  const warn = [run.free, run.table].some(r => r.maxSlope > 0.35);
  const sz = sheetSize(P), both = q.pieces.map(x => ({ w: x.where, s: sheetSize(x.plate) }));
  st.innerHTML = `<p class="fv-why dry-where">${dryFilmName(DRY.sel)}, the water leaving from the ${SHEET_WAYS[SHEET.way]}. As cut from the roll (before the drying oven), it wants to curl to a radius of ${Math.abs(P.kS) > 1e-6 ? `${(1000 / Math.abs(P.kS)).toFixed(0)} mm` : '—'} both ways${Math.abs(P.kSet) > 1e-9 ? `, and along the line the roll's set adds a curl of radius ${(1 / Math.abs(P.kSet) * 1000).toFixed(0)} mm` : ''}${topDown ? ' (away from its top: it is drawn and lies with its top down)' : ' (toward its top)'}. ${['along', 'across'].includes(sheetShapeKind(run.free)) ? `Held up, this piece rolls one way rather than keep a bowl (a bowl would have to stretch)${Math.abs(P.kSet) > 1e-9 ? ': along the line, the roll\'s set' : ': along the line here -- which way is decided by small differences, as the flakes\' alignment; with no roll set it could as well roll across'}.` : sheetShapeKind(run.free) === 'bowl' ? 'Held up, this piece is small enough to keep a bowl.' : ''} Dried through in the drying oven (${P.Tdry} °C) and pressed flat, a piece cut ${L.toFixed(0)} × ${Wd.toFixed(0)} mm measures <b>${(L * sz).toFixed(1)} × ${(Wd * sz).toFixed(1)} mm</b> (${((sz - 1) * 100).toFixed(2)} %; ${both.map(b => `${SHEET_WAYS[b.w]} ${((b.s - 1) * 100).toFixed(2)} %`).join(', ')}): on the roll its water (${(P.Xcut * 100).toFixed(1)} % of the GO) stays in; the oven's air (the room's heated, ${(P.rhDry * 100).toFixed(1)} % humidity) leaves ${(P.Xdry * 100).toFixed(1)} %. Whether 1–2 h in the pressed stack dries it through, and the wrinkles and waviness your pieces come out with, come next.${warn ? ` ${pill('It curls steeply here: this model is for moderate slopes, so the shape is rougher', 'warn')}` : ''}</p>`;
}
function sheetClear() { for (const id of ['sh1', 'sh2']) { const cv = document.getElementById(id); if (cv) { const { c, w, h } = setupCanvas(cv, 0.62); c.clearRect(0, 0, w, h); } const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; } }

/** The measured sizes (Q68/69/71): length and width pressed flat, before the drying oven (as cut), after it, after the
 * furnace; after the oven against before it (or the size cut) read back as the swelling it implies. */
function sheetMeasured() {
  const host = document.getElementById('sheetMeas');
  if (!host) return;
  const m = MAT.filmMeas.size || [], locs = [['web', 'The web'], ...CFD_LOCS.map((l, i) => [`L${i + 1}`, `L${i + 1}`])];
  const txt = q => [Number.isFinite(q.L) ? `${q.L} mm long` : '', Number.isFinite(q.W) ? `${q.W} mm wide` : ''].filter(Boolean).join(', ');
  const imp = [];
  if (sheetInputs()) {
    const [rt, rb] = filmRuns(DRY.sel), here = m.filter(q => q.loc === DRY.sel), cut = here.find(q => q.when === 'cut');
    const refL = cut && Number.isFinite(cut.L) ? cut.L : OVEN.peel.pieceL, refW = cut && Number.isFinite(cut.W) ? cut.W : OVEN.peel.pieceW;
    for (const q of here.filter(q => q.when === 'dry')) {
      const r = [q.L / refL, q.W / refW].filter(v => Number.isFinite(v) && v > 0);
      if (!r.length) continue;
      const ratio = r.reduce((a, v) => a + v, 0) / r.length;
      // (the size pressed flat is linear in β both ways: (1 + e0D + β eXD) / (1 + e0C + β eXC) = the ratio measured)
      const beta = P => { const b0 = MAT.film.beta.v, e0D = P.eFlatDry - b0 * P.eXDry, e0C = P.eFlatCut - b0 * P.eXCut, den = P.eXDry - ratio * P.eXCut; return Math.abs(den) > 1e-12 ? (ratio * (1 + e0C) - 1 - e0D) / den : NaN; };
      const bt = beta(rt.plate), bb = beta(rb.plate), f = v => Number.isFinite(v) ? v.toFixed(3) : '—';
      const use = (v, lbl) => Number.isFinite(v) && v > 0 ? ` <button type="button" class="linkish" data-sheetuse="${+v.toPrecision(3)}|your piece's size after the drying oven">Use ${lbl}</button>` : '';
      imp.push(`<li>Your piece after the drying oven, ${txt(q)} (${((ratio - 1) * 100).toFixed(2)} % from ${cut ? 'your size before it' : `the ${OVEN.peel.pieceL} × ${OVEN.peel.pieceW} mm cut`}), means the film swells <b>${f(bt)}</b> per kg/kg (top only) or <b>${f(bb)}</b> (top and bottom), if the oven dried it through.${use(bt, 'top only\'s')}${use(bb, 'top and bottom\'s')}</li>`);
    }
    if (here.some(q => q.when === 'furnace')) imp.push('<li>After the furnace: kept for the next phase (the graphene film).</li>');
  }
  const num = (id, l, u) => `<label>${l} <span class="prop-v"><input type="number" id="${id}" min="1" max="100000" step="0.1" placeholder="—"><span class="prop-u">${u}</span></span></label>`;
  host.innerHTML = `<div class="dry-meas film-meas"><div class="dry-mcol"><h4>Measured: a piece's size pressed flat</h4>
      <div class="dry-exit-form"><label>Film <select id="shMLoc">${locs.map(([k, t]) => `<option value="${k}"${k === DRY.sel ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>When <select id="shMWhen">${Object.entries(SHEET_WHEN).map(([k, t]) => `<option value="${k}"${k === 'dry' ? ' selected' : ''}>${t}</option>`).join('')}</select></label>${num('shML', 'Length (along the line)', 'mm')}${num('shMW', 'Width', 'mm')}
        <button class="btn btn-secondary btn-sm" type="button" id="shMAdd">Add</button></div>
      <ul class="dry-list">${m.map((q, k) => `<li>${q.loc === 'web' ? 'The web' : q.loc}, ${SHEET_WHEN[q.when] || SHEET_WHEN.dry}: ${txt(q)} <button type="button" class="linkish" data-sheetdel="${k}">Remove</button></li>`).join('') || '<li class="fv-why">None yet.</li>'}</ul></div>
    <div class="dry-mcol">${imp.length ? `<ul class="dry-cmp film-imp">${imp.join('')}</ul>` : '<p class="fv-why">A piece\'s length and width pressed flat, before the drying oven, after it and after the furnace. After the oven against before it (or the size cut) is read back here as the swelling with water it implies (the Film card\'s β), with a button to use it.</p>'}</div></div>`;
  const b = document.getElementById('shMAdd');
  if (b) b.onclick = () => {
    const val = id => { const v = parseFloat(document.getElementById(id).value); return Number.isFinite(v) && v > 0 ? v : NaN; };
    const q = { loc: document.getElementById('shMLoc').value, L: val('shML'), W: val('shMW'), when: document.getElementById('shMWhen').value };
    if (!Number.isFinite(q.L) && !Number.isFinite(q.W)) { imgToast('Type its length or width pressed flat (mm).', 'error'); return; }
    undoHint('Measured piece added');
    MAT = { ...MAT, filmMeas: { ...MAT.filmMeas, size: [...(MAT.filmMeas.size || []), q] } }; render();
  };
  if (typeof applyHelp === 'function') applyHelp();   // (rebuilt outside render, when the piece solves: its help again)
}
