/*
 * sheet-ui.js — a piece cut from the roll, in 3D (GO-4d, sheet.js in cfd-sheet-worker.js), in the film's section on
 * the Process tab: the film shown, one way the water left at a time; the piece held up (free) and lying on a table
 * under its weight (Q67: where the curl is seen is not known), drawn in a view from above and the front with its
 * heights; its size pressed flat later against as cut (Q68/69); a measured size read back as the swelling it implies.
 * Q65: 30 × 30 cm pieces (an input); Q70: cut from the roll later.
 * GO-4f (press.js, in two sheet workers, one per way): the pieces pressed in the stack -- their water through the pre heat
 * treatment and after it under the plate in the room, the stress each holds flat, the creep; the piece let go out of the stack
 * (1–2 h after the pre heat treatment, Q85) and a day later (Q81), its size then (Q83/Q86).
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
  if (key === SHEET.key || key === SHEET.pending) { solveTake('sheet'); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveMay('sheet')) return;
  if (SHEET.busy) { SHEET.again = true; return; }
  solveTake('sheet');
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
    // (Phase 0: not asked for and not solving -- nothing to wait for; the report marks it not solved)
    if (!solveAsked('sheet') && !SHEET.busy) return sheetCurrent();
    sheetRequest();
    if (!SHEET.busy && sheetCurrent()) return true;
    if (!SHEET.busy && SHEET.error && SHEET.key === sheetKeyNow()) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- the stack (GO-4f): the pieces pressed through the pre heat treatment and under the plate after it; let go ----
const STACK = { res: null, key: null, busy: false, error: null, pending: null, workers: [], id: 0, again: false, prog: {}, ms: 0 };
/** Stop the piece's and the stack's solves (New, Open): their workers ended. */
function sheetStop() {
  if (SHEET.worker) { SHEET.worker.terminate(); SHEET.worker = null; }
  Object.assign(SHEET, { busy: false, again: false, pending: null, prog: null });
  STACK.workers.forEach(w => w && w.terminate()); STACK.workers = [];
  Object.assign(STACK, { busy: false, again: false, pending: null, prog: {} });
}
const SHEET_STATES = { cut: 'As cut', out: 'Out of the stack', day: 'A day later' };
SHEET.state = 'cut';
/** The stack to solve: the pieces as sheetInputs, the stack's permeability and creep (the Film card), the times (after the pre heat treatment). */
function stackInputs() {
  const q = sheetInputs();
  if (!q || typeof drPsat !== 'function') return null;
  const f = MAT.film, pl = OVEN.peel, P0 = q.pieces[0].plate;
  if (!P0.tab) return null;
  return { key: q.key, pieces: q.pieces, Lx: q.Lx, Ly: q.Ly,
    stack: { K: f.stackK.v * 1e-7, tau: f.creepTau.v * 60, tOven: pl.tOven * 3600, tRest: pl.tRest * 3600, psatOven: drPsat(pl.dryT), psatRoom: drPsat(P0.Troom) } };
}
const stackKeyNow = () => { const q = stackInputs(); return q ? JSON.stringify(q) : null; };
const stackCurrent = () => !!STACK.res && STACK.key === stackKeyNow();
/** Solve the stack (each way in its own worker, side by side), unless it is solved or being solved. */
function stackRequest() {
  const q = stackInputs();
  if (!q) return;
  const key = JSON.stringify(q);
  if (key === STACK.key || key === STACK.pending) { solveTake('stack'); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveMay('stack')) return;
  if (STACK.busy) { STACK.again = true; return; }
  solveTake('stack');
  STACK.busy = true; STACK.again = false; STACK.pending = key; STACK.prog = {};
  const id = ++STACK.id, runs = [], t0 = Date.now();
  let left = q.pieces.length, failed = null;
  const done = () => {
    STACK.busy = false; STACK.pending = null; STACK.key = key;
    if (failed) { STACK.res = null; STACK.error = failed; }
    else { STACK.res = { runs: q.pieces.map(pc => runs.find(r => r.where === pc.where)), q }; STACK.error = null; STACK.ms = Date.now() - t0; }
    if (STACK.again) stackRequest();
    if (tab === 12) sheetRender();
  };
  q.pieces.forEach((pc, k) => {
    if (!STACK.workers[k]) STACK.workers[k] = makeWorker('cfd-sheet-worker.js');
    const w = STACK.workers[k];
    w.onmessage = e => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.progress) { STACK.prog[pc.where] = m.progress; sheetStatusPaint(); return; }
      if (m.ok) runs.push(...m.runs); else failed = failed || m.error;
      if (--left === 0) done();
    };
    w.onerror = ev => { failed = failed || ev.message || 'the stack\'s worker failed'; if (--left === 0) done(); };
    w.postMessage({ id, kind: 'stack', pieces: [pc], Lx: q.Lx, Ly: q.Ly, stack: q.stack });
  });
}
/** Wait for the stack for the inputs as they are (the report): true when solved. */
async function stackWait() {
  if (!(await sheetWait())) return false;
  for (let k = 0; k < 4800; k++) {
    // (Phase 0: not asked for and not solving -- nothing to wait for; the report marks it not solved)
    if (!solveAsked('stack') && !STACK.busy) return stackCurrent();
    stackRequest();
    if (!STACK.busy && stackCurrent()) return true;
    if (!STACK.busy && STACK.error && STACK.key === stackKeyNow()) return false;
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

/** Q72–Q77: 20 pieces stacked under an aluminium plate in the pre heat treatment. */
function filmPicDryStack(sc = 1) {
  const w = 190, h = 106, b = 86;
  let st = ''; for (let k = 0; k < 10; k++) st += `<rect x="62" y="${b - k * 5}" width="66" height="3" fill="#e8590c"/>`;
  return filmSvg(w, h, 'The pieces stacked 20 at a time under an aluminium plate in the pre heat treatment', `<rect x="30" y="14" width="130" height="84" rx="6" fill="none" stroke="#c92a2a" stroke-width="2"/><text x="95" y="10" font-size="9" text-anchor="middle" fill="#c92a2a">pre heat treatment</text>${st}<rect x="58" y="${b - 10 * 5 - 5}" width="74" height="6" fill="#adb5bd" stroke="#868e96"/><text x="95" y="${b - 10 * 5 - 9}" font-size="8" text-anchor="middle" fill="var(--muted)">aluminium plate</text>`, sc);
}

/** Q84/Q85: out of the pre heat treatment, the stack stays under the plate in the room; the room's water comes back at its edges. */
function filmPicStackRest(sc = 1) {
  const w = 190, h = 96, b = 70;
  let st = ''; for (let k = 0; k < 10; k++) st += `<rect x="62" y="${b - k * 5}" width="66" height="3" fill="#e8590c"/>`;
  const arr = (x1, x2, y) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#1c7ed6" stroke-width="1.6" marker-end="url(#stArr)"/>`;
  return filmSvg(w, h, 'Out of the pre heat treatment the stack stays under the plate in the room; the room\'s water comes back in at its edges', `<defs><marker id="stArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1c7ed6"/></marker></defs>`
    + `<line x1="20" y1="${b + 5}" x2="170" y2="${b + 5}" stroke="var(--muted)" stroke-width="2"/>${st}<rect x="58" y="${b - 10 * 5 - 5}" width="74" height="6" fill="#adb5bd" stroke="#868e96"/>`
    + `${arr(34, 58, b - 18)}${arr(34, 58, b - 32)}${arr(156, 132, b - 18)}${arr(156, 132, b - 32)}<text x="95" y="10" font-size="9" text-anchor="middle" fill="var(--muted)">in the room, under the plate</text><text x="95" y="${b + 17}" font-size="8" text-anchor="middle" fill="#1c7ed6">the room's water in at the edges</text>`, sc);
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
// (edges: both edges' middles well above its corners -- a wave along each edge, as a piece let go out of the stack can)
const sheetShapeKind = r => { const ex = r.edgeX, ey = r.edgeY; return Math.max(ex, ey, r.corner) < 1e-4 ? 'flat' : ex > 3 * ey ? 'along' : ey > 3 * ex ? 'across' : r.corner < 0.7 * Math.min(ex, ey) ? 'edges' : 'bowl'; };
const SHEET_SHAPES = { flat: 'flat', along: 'rolls up along the line: its ends lift (a tube lying across the web)', across: 'rolls up across the web: its sides lift (a tube lying along the line)', bowl: 'a bowl: its corners lift', edges: 'wavy edges: the middles of its edges lift more than its corners' };
const sheetShapeText = r => SHEET_SHAPES[sheetShapeKind(r)];
const sheetMM = v => `${(v * 1000).toFixed(v * 1000 >= 10 ? 0 : 1)} mm`;
/** Its size pressed flat later over as cut (Q68/69), from its film's plate. */
/** Its size pressed flat after the pre heat treatment over as cut (Q71/72: dried through there), from its film's plate. */
const sheetSize = P => (1 + P.eFlatDry) / (1 + P.eFlatCut);
const SHEET_WHEN = { cut: 'before the pre heat treatment (as cut)', dry: 'after the pre heat treatment', furnace: 'after the furnace (graphene film)' };

// ---- the section's piece: its frame (inside the film's section), and its render ----
function sheetSectionHTML() {
  return `<div class="sheet-sec" id="sheetSec">
    <h3 class="oned-h" data-fview="piece">A piece cut from the roll, in 3D</h3>
    <div class="sheet-head" data-fview="piece">${filmPicCut(0.9)}<p class="fv-why">Pieces of ${OVEN.peel.pieceL} × ${OVEN.peel.pieceW} mm are cut from the roll later, then stacked 20 at a time under an aluminium plate and heated in the pre heat treatment. As cut, how a piece curls is not known, nor where it is looked at, so it is shown held up (free) and lying on a table under its weight, drawn with its curl up.</p>
      <div class="seg" role="tablist" aria-label="Which way the water left" id="sheetWay">${Object.entries(SHEET_WAYS).map(([k, t]) => `<button type="button" role="tab" data-sheetway="${k}" aria-selected="${k === SHEET.way}">${t}</button>`).join('')}</div></div>
    <div class="sheet-when" data-fview="piece"><span class="fv-why">The piece</span><div class="seg" role="tablist" aria-label="When the piece is shown" id="sheetWhen">${Object.entries(SHEET_STATES).map(([k, t]) => `<button type="button" role="tab" data-sheetwhen="${k}" aria-selected="${k === SHEET.state}">${t}</button>`).join('')}</div></div>
    <div id="sheetState" data-fview="piece"></div>
    <div class="dry-grid sheet-grid" data-fview="piece">
      <figure class="pane dry-pane"><figcaption>${uiBadge('film')}Held up (free)</figcaption><canvas id="sh1" role="img" aria-label="The cut piece held up, as it curls free, in a view from above and the front"></canvas><div class="pane-legend" id="sh1Lg"></div></figure>
      <figure class="pane dry-pane"><figcaption>${uiBadge('film')}On a table (its weight)</figcaption><canvas id="sh2" role="img" aria-label="The cut piece lying on a table under its weight, its curl up, in a view from above and the front"></canvas><div class="pane-legend" id="sh2Lg"></div></figure>
    </div>
    <div class="stack-sec" id="stackSec" data-fview="stack">
      <h4 class="oned-h">In the pressed stack, and out of it</h4>
      <div class="sheet-head stack-head">${filmPicDryStack(0.9)}${filmPicStackRest(0.9)}<p class="fv-why">Stacked 20 at a time, the pieces lie flat under the plate, free in their own plane. Their water leaves along them to the stack's edges in the pre heat treatment, then comes back the same way under the plate in the room. Held flat, a piece carries the stress of its uneven water, and while wet it creeps and eases it: what the creep leaves is how the piece lies when it is taken out.</p></div>
      <div id="stackState"></div>
      <div class="stats" id="stackStats"></div>
      <div class="dry-grid">
        <figure class="pane dry-pane"><figcaption>${uiBadge('drop')}Water across a piece</figcaption><canvas id="st1" role="img" aria-label="The water along the middle of a piece from its edge in, at times in the pre heat treatment and under the plate after it"></canvas><div class="pane-legend" id="st1Lg"></div></figure>
        <figure class="pane dry-pane"><figcaption>${uiBadge('cut')}The pull held flat</figcaption><canvas id="st2" role="img" aria-label="The largest pull in a piece held flat in the stack against time, with the film's strength"></canvas><div class="pane-legend" id="st2Lg"></div></figure>
      </div>
    </div>
    <div id="sheetMeas" data-fview="piece"></div>
  </div>`;
}
function sheetStatusPaint() {
  const el = document.getElementById('sheetState');
  if (el && SHEET.busy && SHEET.state === 'cut') { const p = SHEET.prog; el.innerHTML = `<p class="dry-msg">${pill(p ? `The piece: ${p.k + 1} of ${p.n}…` : 'The piece…', '')}</p>`; }
  const sl = document.getElementById('stackState');
  if (STACK.busy) {
    const ps = Object.values(STACK.prog), k = ps.reduce((a, p) => a + p.k, 0), n = ps.reduce((a, p) => a + p.n, 0);
    const msg = `<p class="dry-msg">${pill(n ? `The stack and the piece let go: ${k + 1} of ${n}…` : 'The stack and the piece let go…', '')}</p>`;
    if (sl) sl.innerHTML = msg;
    if (el && SHEET.state !== 'cut') el.innerHTML = msg;
  }
}
function sheetRender() {
  const sec = document.getElementById('sheetSec');
  if (!sec) return;
  if (!sec.dataset.wired) {
    sec.dataset.wired = '1';
    sec.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('[data-sheetway]');
      if (b) { SHEET.way = b.dataset.sheetway; sheetRender(); if (typeof furnRender === 'function') furnRender(); return; }
      const wn = e.target.closest && e.target.closest('[data-sheetwhen]');
      if (wn) { SHEET.state = wn.dataset.sheetwhen; sheetRender(); return; }
      const del = e.target.closest && e.target.closest('[data-sheetdel]');
      if (del) { const k = +del.dataset.sheetdel; undoHint('Measured piece removed'); MAT = { ...MAT, filmMeas: { ...MAT.filmMeas, size: MAT.filmMeas.size.filter((_, i) => i !== k) } }; render(); return; }
      const use = e.target.closest && e.target.closest('[data-sheetuse]');
      if (use) { const [v, what] = use.dataset.sheetuse.split('|'); filmUse('beta', +v, what); }
    });
  }
  sec.querySelectorAll('[data-sheetway]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sheetway === SHEET.way)));
  sec.querySelectorAll('[data-sheetwhen]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.sheetwhen === SHEET.state)));
  const st = document.getElementById('sheetState');
  sheetMeasured();
  stackRender();
  if (!filmCurrent()) { st.innerHTML = `<p class="fv-why">After the film is solved.</p>`; sheetClear(); return; }
  if (SHEET.state !== 'cut') { sheetLetGo(); return; }
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
  st.innerHTML = `<p class="fv-why dry-where">${dryFilmName(DRY.sel)}, the water leaving from the ${SHEET_WAYS[SHEET.way]}. As cut from the roll (before the pre heat treatment), it wants to curl to a radius of ${Math.abs(P.kS) > 1e-6 ? `${(1000 / Math.abs(P.kS)).toFixed(0)} mm` : '—'} both ways${Math.abs(P.kSet) > 1e-9 ? `, and along the line the roll's set adds a curl of radius ${(1 / Math.abs(P.kSet) * 1000).toFixed(0)} mm` : ''}${topDown ? ' (away from its top: it is drawn and lies with its top down)' : ' (toward its top)'}. ${['along', 'across'].includes(sheetShapeKind(run.free)) ? `Held up, this piece rolls one way rather than keep a bowl (a bowl would have to stretch)${Math.abs(P.kSet) > 1e-9 ? ': along the line, the roll\'s set' : ': along the line here -- which way is decided by small differences, as the flakes\' alignment; with no roll set it could as well roll across'}.` : sheetShapeKind(run.free) === 'bowl' ? 'Held up, this piece is small enough to keep a bowl.' : ''} Dried through in the pre heat treatment (${P.Tdry} °C) and pressed flat while still dry, a piece cut ${L.toFixed(0)} × ${Wd.toFixed(0)} mm measures <b>${(L * sz).toFixed(1)} × ${(Wd * sz).toFixed(1)} mm</b> (${((sz - 1) * 100).toFixed(2)} %; ${both.map(b => `${SHEET_WAYS[b.w]} ${((b.s - 1) * 100).toFixed(2)} %`).join(', ')}): on the roll its water (${(P.Xcut * 100).toFixed(1)} % of the GO) stays in; the pre heat treatment's air (the room's heated, ${(P.rhDry * 100).toFixed(1)} % humidity) leaves ${(P.Xdry * 100).toFixed(1)} %. Out of the stack and a day later: the buttons above; the stack itself: below.${warn ? ` ${pill('It curls steeply here: this model is for moderate slopes, so the shape is rougher', 'warn')}` : ''}</p>`;
}
/** The piece let go (GO-4f): out of the stack or a day later, held up and on a table. */
function sheetLetGo() {
  const st = document.getElementById('sheetState');
  if (!stackCurrent()) {
    if (STACK.error && STACK.key === stackKeyNow()) { st.innerHTML = `<p class="dry-msg">${pill(`The stack could not be solved: ${dryEsc(STACK.error)}`, 'bad')}</p>`; sheetClear(); return; }
    stackRequest(); sheetClear(); sheetStatusPaint(); return;
  }
  const q = STACK.res.q, run = STACK.res.runs.find(r => r.where === SHEET.way).stack, pl = OVEN.peel;
  const k = SHEET.state === 'out' ? 'out' : 'day', fr = run.shapes[k + 'Free'], tb = run.shapes[k + 'Table'];
  const L = q.Lx * 1000, Wd = q.Ly * 1000, col = DRY.sel === 'web' ? '#e8590c' : dryFilmColor(DRY.sel);
  drawSheet(document.getElementById('sh1'), fr, L, Wd, fr.sign, false, col);
  drawSheet(document.getElementById('sh2'), tb, L, Wd, 1, true, col);
  const waves = r => (r.crestsEnd > 1 || r.crestsSide > 1) ? `; waves: ${r.crestsEnd} crests along its ends, ${r.crestsSide} along its sides` : '';
  const words = (r, table) => `${sheetShapeText(r)}; its corners ${sheetMM(r.corner)} ${table ? 'off the table' : 'off its middle'}, the middles of its ends ${sheetMM(r.edgeX)}, of its sides ${sheetMM(r.edgeY)}${waves(r)}`;
  document.getElementById('sh1Lg').innerHTML = `<p class="fv-why">${words(fr, false)}.</p>`;
  document.getElementById('sh2Lg').innerHTML = `<p class="fv-why">${words(tb, true)}${tb.middle > 1e-4 ? '' : '; its middle on the table'}.</p>`;
  const sz = k === 'out' ? run.sizeOut : run.sizeDay, cu = run.curl[k], rad = v => Math.abs(v) > 1e-6 ? `${(1000 / Math.abs(v)).toFixed(0)} mm` : 'none (flat)';
  const Xk = k === 'out' ? run.Xend[run.Xend.length - 1] : q.pieces[0].plate.Xroom;
  const when = k === 'out' ? `Out of the stack (${pl.tOven} h in the pre heat treatment at ${pl.dryT} °C${run.rest ? `, then ${pl.tRest} h under the plate in the room` : ', taken out straight away'}), as you look at it and measure it: its water ${(Xk * 100).toFixed(1)} % of the GO (its middle ${(run.XmidEnd[run.XmidEnd.length - 1] * 100).toFixed(1)} %)`
    : `A day later, laid out in the room: its water the room's all through (${(Xk * 100).toFixed(1)} % of the GO); what is left is what the stack's creep set`;
  const warn = [fr, tb].some(r => r.maxSlope > 0.35);
  st.innerHTML = `<p class="fv-why dry-where">${dryFilmName(DRY.sel)}, the water leaving from the ${SHEET_WAYS[SHEET.way]}. ${when}. Pressed flat it measures <b>${(L * (1 + sz[0])).toFixed(1)} × ${(Wd * (1 + sz[1])).toFixed(1)} mm</b> (${(sz[0] * 100).toFixed(2)} % from as cut). Its curl: a radius of ${rad(cu[0])} along the line and ${rad(cu[1])} across (as cut ${rad(run.curl.cut[0])} and ${rad(run.curl.cut[1])}): pressed in the stack, the creep eased it. A thin piece can settle in several shapes of about the same energy: this is the one it reaches let go gradually, even about both middle lines.${warn ? ` ${pill('It curls steeply here: this model is for moderate slopes, so the shape is rougher', 'warn')}` : ''}</p>`;
}

/** The stack (GO-4f): tiles, the water across a piece through time, the pull held flat. */
function stackRender() {
  const el = document.getElementById('stackState');
  if (!el) return;
  const stats = document.getElementById('stackStats');
  const clear = () => { stats.innerHTML = ''; paneEmptyIds(['st1', 'st2'], paneWhy('stack')); for (const id of ['st1', 'st2']) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; } };
  if (!filmCurrent() || !sheetInputs()) { el.innerHTML = '<p class="fv-why">After the film is solved.</p>'; clear(); return; }
  if (!stackCurrent()) {
    if (STACK.error && STACK.key === stackKeyNow()) { el.innerHTML = `<p class="dry-msg">${pill(`The stack could not be solved: ${dryEsc(STACK.error)}`, 'bad')}</p>`; clear(); return; }
    stackRequest(); clear(); sheetStatusPaint(); return;
  }
  const q = STACK.res.q, [rt, rb] = STACK.res.runs.map(r => r.stack), pl = OVEN.peel, F = MAT.film, P = q.pieces[0].plate;
  const both = (f, d = 0) => `${f(rt)} · ${f(rb)}`, pct = v => `${(v * 100).toFixed(2)} %`;
  const tiles = [
    ['Middle dry after', both(r => r.dryThrough != null ? `${r.dryThrough.toFixed(r.dryThrough < 10 ? 1 : 0)} min` : `over ${pl.tOven} h`), 'oven'],
    ['Largest pull, held flat', both(r => `${r.peak.MPa.toFixed(0)} MPa`), 'cut'],
    ['Water when taken out', both(r => `${(r.Xend[r.Xend.length - 1] * 100).toFixed(1)} %`), 'drop'],
    ['Size out of the stack, from as cut', both(r => pct(r.sizeOut[0])), 'film'],
    ['Size a day later, from as cut', both(r => pct(r.sizeDay[0])), 'film'],
    ['Highest on a table, out of the stack', both(r => sheetMM(r.shapes.outTable.high)), 'wave'],
  ];
  stats.innerHTML = tiles.map(([l, v, ic]) => `<div class="stat" title="${l} — top only · top and bottom: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>top only · top and bottom</small></div>`).join('');
  const over = [rt, rb].filter(r => r.peak.MPa >= F.sigF.v);
  el.innerHTML = `<p class="fv-why dry-where">${pl.tOven} h in the pre heat treatment at ${pl.dryT} °C${pl.tRest > 0 ? `, then ${pl.tRest} h under the plate in the room` : ''}. The water moves along the pieces at ${F.stackK.v} × 10⁻⁷ kg/(m·s·Pa) (the Film card: the least that fits your answers -- dry all over out of the pre heat treatment, the size back to as cut 1–2 h later, the same a day later); wet, the film creeps with a time of ${F.creepTau.v} min. Out of the stack its water is ${both(r => `${(r.Xend[r.Xend.length - 1] * 100).toFixed(1)} %`)} of the GO (as cut ${(P.Xcut * 100).toFixed(1)} %).${over.length ? ` ${pill(`Held flat in the pre heat treatment its drying edges pull ${Math.max(...over.map(r => r.peak.MPa)).toFixed(0)} MPa, over the film's strength (${F.sigF.v} MPa): they may crack at the edges`, 'warn')}` : ''}</p>`;
  // (1) the water along the middle line from the edge in: the pre heat treatment's times in one hue light to dark, the room's dashed
  const run = STACK.res.runs.find(r => r.where === SHEET.way).stack, mut = cssVar('--muted'), bad = cssVar('--bad');
  const col = DRY.sel === 'web' ? '#e8590c' : dryFilmColor(DRY.sel), blue = '#1c7ed6';
  const half = q.Lx * 500, pr = run.prof, xs = pr.flatMap(p => p.X.map(v => v * 100)), yHi = Math.max(...xs, P.Xcut * 100) * 1.08;
  // (one hue light to dark over time: the colour at an opacity, rgba -- the report's image export reads plain colours)
  const shade = (c, k, n) => { const a = 0.3 + 0.7 * (n > 1 ? k / (n - 1) : 1), m = /^#([0-9a-f]{6})$/i.exec(c); if (!m) return c; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a.toFixed(2)})`; };
  const ov = pr.filter(p => p.stage === 0), rs = pr.filter(p => p.stage === 1);
  const minF = t => t < 10 ? t.toFixed(1) : t.toFixed(0);
  plotChart(document.getElementById('st1'), FILM_ASPECT, { x0: 0, x1: half, y0: 0, y1: yHi, xl: 'from the edge in (mm)', yl: 'water (% of the GO)', yd: 1, xd: 0,
    hl: [{ y: P.Xcut * 100, c: mut, t: 'as cut', left: true }],
    s: [...ov.map((p, k) => ({ p: p.x.map((x, i) => [x, p.X[i] * 100]), c: shade(col, k, ov.length), w: 2 })), ...rs.map((p, k) => ({ p: p.x.map((x, i) => [x, p.X[i] * 100]), c: shade(blue, k, rs.length), w: 2, dash: [6, 4] }))] });
  document.getElementById('st1Lg').innerHTML = oneDLegend([...ov.map((p, k) => [`pre heat treatment, ${minF(p.t)} min`, shade(col, k, ov.length)]), ...rs.map((p, k) => [`under the plate, ${minF(p.t - pl.tOven * 60)} min`, shade(blue, k, rs.length), 'dash'])])
    + `<p class="fv-why">${dryFilmName(DRY.sel)}, ${SHEET_WAYS[SHEET.way]}: along the middle of a piece, 0 at its edge, ${half.toFixed(0)} mm its middle.</p>`;
  // (2) the largest pull in a piece held flat against time (both ways), the pre heat treatment's time shaded, the film's strength
  const tEnd = Math.max(...[rt, rb].map(r => r.hist[r.hist.length - 1].t)), sHi = Math.max(...[rt, rb].flatMap(r => r.hist.map(h => h.MPa)), 1) * 1.15;
  const yTop = Math.max(sHi, Math.min(F.sigF.v * 1.1, sHi * 3));
  plotChart(document.getElementById('st2'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: yTop, xl: 'time (min)', yl: 'largest pull (MPa)', yd: 0, xd: 0,
    bands: [{ x0: 0, x1: pl.tOven * 60, c: cssVar('--soft') }], vl: [{ x: pl.tOven * 60, c: mut, t: 'out of the pre heat treatment' }],
    hl: F.sigF.v < yTop ? [{ y: F.sigF.v, c: bad, t: `its strength (${F.sigF.v} MPa)`, left: true, below: true }] : [],
    s: [[rt, []], [rb, [6, 4]]].map(([r, dash]) => ({ p: r.hist.map(h => [h.t, h.MPa]), c: col, w: 2, dash })) });
  document.getElementById('st2Lg').innerHTML = oneDLegend([['top only', col], ['top and bottom', col, 'dash']]) + '<p class="fv-why">The largest pull in the piece\'s plane while it is held flat: at its drying edges as the pre heat treatment starts; eased by the creep while wet.</p>';
}

function sheetClear() { paneEmptyIds(['sh1', 'sh2'], paneWhy('sheet')); for (const id of ['sh1', 'sh2']) { const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; } }

/** The plate at a uniform water from its film's table (rows [X, A, D, eFlat, κ, eX]; linear between rows, held past its ends). */
function sheetTabAt(tab, X) {
  if (!tab || !tab.length) return null;
  if (X <= tab[0][0]) return tab[0];
  for (let i = 0; i < tab.length - 1; i++) if (X <= tab[i + 1][0]) { const f = (X - tab[i][0]) / (tab[i + 1][0] - tab[i][0]); return tab[i].map((v, c) => v + f * (tab[i + 1][c] - v)); }
  return tab[tab.length - 1];
}

/** The measured sizes (Q68/69/71): length and width pressed flat, before the pre heat treatment (as cut), after it, after the
 * furnace; after the pre heat treatment against before it (or the size cut) read back as the swelling it implies. */
function sheetMeasured() {
  const host = document.getElementById('sheetMeas');
  if (!host) return;
  const m = MAT.filmMeas.size || [], locs = [['web', 'The web'], ...CFD_LOCS.map((l, i) => [`L${i + 1}`, `L${i + 1}`])];
  const txt = q => [Number.isFinite(q.L) ? `${q.L} mm long` : '', Number.isFinite(q.W) ? `${q.W} mm wide` : ''].filter(Boolean).join(', ');
  const imp = [];
  if (sheetInputs()) {
    const [rt, rb] = filmRuns(DRY.sel), here = m.filter(q => q.loc === DRY.sel), cut = here.find(q => q.when === 'cut');
    const refL = cut && Number.isFinite(cut.L) ? cut.L : OVEN.peel.pieceL, refW = cut && Number.isFinite(cut.W) ? cut.W : OVEN.peel.pieceW;
    // (measured after the pre heat treatment: Q83/Q85 -- out of the stack, 1–2 h later under the plate. Its water then is the
    //  stack's (GO-4f), so the swelling it implies is read at that water; until the stack is solved, as dried through)
    const stk = stackCurrent() ? STACK.res.runs.map(r => r.stack) : null;
    for (const q of here.filter(q => q.when === 'dry')) {
      const r = [q.L / refL, q.W / refW].filter(v => Number.isFinite(v) && v > 0);
      if (!r.length) continue;
      const ratio = r.reduce((a, v) => a + v, 0) / r.length;
      // (the size pressed flat is linear in β both ways: (1 + e0D + β eXD) / (1 + e0C + β eXC) = the ratio measured,
      //  D the state measured: its water's row of the plate's table -- or dried through)
      const beta = (P, run) => {
        const b0 = MAT.film.beta.v, at = run ? sheetTabAt(P.tab, run.Xend[run.Xend.length - 1]) : null, eD = at ? at[3] : P.eFlatDry, xD = at ? at[5] : P.eXDry;
        const e0D = eD - b0 * xD, e0C = P.eFlatCut - b0 * P.eXCut, den = xD - ratio * P.eXCut;
        // (it says little when a swelling of 0.1 per kg/kg would change it less than 10 × a 0.05 mm reading, over its length)
        return Math.abs(den) * 0.1 * refL > 0.5 ? (ratio * (1 + e0C) - 1 - e0D) / den : NaN;
      };
      const bt = beta(rt.plate, stk && stk[0]), bb = beta(rb.plate, stk && stk[1]), f = v => Number.isFinite(v) ? v.toFixed(3) : '—';
      const use = (v, lbl) => Number.isFinite(v) && v > 0 ? ` <button type="button" class="linkish" data-sheetuse="${+v.toPrecision(3)}|your piece's size after the pre heat treatment">Use ${lbl}</button>` : '';
      const state = stk ? `measured as it comes out of the stack (${OVEN.peel.tRest} h after the pre heat treatment: its water ${(stk[0].Xend[stk[0].Xend.length - 1] * 100).toFixed(1)} %)` : 'if the pre heat treatment dried it through (the stack not solved yet)';
      const flat = !Number.isFinite(bt) && !Number.isFinite(bb);
      imp.push(`<li>Your piece after the pre heat treatment, ${txt(q)} (${((ratio - 1) * 100).toFixed(2)} % from ${cut ? 'your size before it' : `the ${OVEN.peel.pieceL} × ${OVEN.peel.pieceW} mm cut`}), ${flat ? `${state}: it has taken back about the water it was cut with, so its size says little about how the film swells.` : `means the film swells <b>${f(bt)}</b> per kg/kg (top only) or <b>${f(bb)}</b> (top and bottom), ${state}.${use(bt, 'top only\'s')}${use(bb, 'top and bottom\'s')}`}</li>`);
    }
    if (here.some(q => q.when === 'furnace')) imp.push('<li>After the furnace: kept for the furnace\'s next step (the piece shrinking or growing along itself); its thickness, weight and heat conduction: the furnace\'s section below.</li>');
  }
  const num = (id, l, u) => `<label>${l} <span class="prop-v"><input type="number" id="${id}" min="1" max="100000" step="0.1" placeholder="—"><span class="prop-u">${u}</span></span></label>`;
  host.innerHTML = `<div class="dry-meas film-meas"><div class="dry-mcol"><h4>Measured: a piece's size pressed flat</h4>
      <div class="dry-exit-form"><label>Film <select id="shMLoc">${locs.map(([k, t]) => `<option value="${k}"${k === DRY.sel ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>When <select id="shMWhen">${Object.entries(SHEET_WHEN).map(([k, t]) => `<option value="${k}"${k === 'dry' ? ' selected' : ''}>${t}</option>`).join('')}</select></label>${num('shML', 'Length (along the line)', 'mm')}${num('shMW', 'Width', 'mm')}
        <button class="btn btn-secondary btn-sm" type="button" id="shMAdd">Add</button></div>
      <ul class="dry-list">${m.map((q, k) => `<li>${q.loc === 'web' ? 'The web' : q.loc}, ${SHEET_WHEN[q.when] || SHEET_WHEN.dry}: ${txt(q)} <button type="button" class="linkish" data-sheetdel="${k}">Remove</button></li>`).join('') || '<li class="fv-why">None yet.</li>'}</ul></div>
    <div class="dry-mcol">${imp.length ? `<ul class="dry-cmp film-imp">${imp.join('')}</ul>` : '<p class="fv-why">A piece\'s length and width pressed flat, before the pre heat treatment, after it and after the furnace. After the pre heat treatment against before it (or the size cut) is read back here as the swelling with water it implies (the Film card\'s β), with a button to use it.</p>'}</div></div>`;
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
