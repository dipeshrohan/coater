'use strict';
/*
 * furnace-ui.js — the furnace and the graphene film (GO-5; furnace.js in cfd-furnace-worker.js): step 6 of the Process
 * tab (Q98). The pieces out of the drying stack, one between each two graphite papers in the graphite holder, through
 * the two runs in argon (Q87–Q91, Q103–Q108): the film's weight, C/O and layers through them; the gas in a piece against
 * its layers' hold and where it puffs up (Q101: the second run; Q102: where the gas pressure is highest); the graphene
 * film's thickness, density and heat along it (Q92, Q94). The inputs bar: the two runs' programs (steps, or the cycle
 * from your file, Q97) and the stack in the holder; the Furnace card on Materials. Measured on the graphene film (Q92):
 * its thickness, weight and heat conduction beside the computed; the thickness and the heat conduction read back.
 */
const FURN = { res: null, key: null, busy: false, error: null, pending: null, worker: null, id: 0, again: false, prog: null, ms: 0,
  fit: null, fitWorker: null, fileRun: 0, pendingFile: null, light: null };
const FURN_RUNS = ['Run 1', 'Run 2'], FURN_RUN_WHAT = ['to about 1000 °C (carbonising)', 'to 2800 °C (graphitizing)'];
const FURN_ROOM = { gap: 'A gap above', plates: 'The plate on it' };

// ---- the inputs ----
/** Run r's program as points [t (s), T (K)]: your file's cycle, or its steps from the room. */
function furnProgram(r, Troom = 25) {
  const run = OVEN.furn.runs[r];
  if (run.file && Array.isArray(run.file.pts) && run.file.pts.length > 1) return run.file.pts;
  return fuProgram(run.steps, Troom, run.cool);
}
/** The pieces of a stack of N followed (GO-7): its top, middle and bottom, each with its share of the stack (Simpson's
 *  rule over it, 1 : 4 : 1); fewer when the stack has fewer pieces. */
function furnPositions(N) {
  const n = Math.max(1, Math.round(N || 1)), mid = Math.round((n - 1) / 2), out = [];
  if (n === 1) return [{ m: 0, w: 1, name: 'only' }];
  for (const [m, w, name] of [[0, 1, 'top'], [mid, 4, 'middle'], [n - 1, 1, 'bottom']]) {
    const q = out.find(x => x.m === m);
    if (q) { q.w += w; if (name === 'bottom') q.name = 'bottom'; } else out.push({ m, w, name });
  }
  return out;
}
/** furnace.js's options for a piece from its film's plate (thickness, GO per volume, the room's water and temperature). */
function furnOpts(P, Lx, Ly) {
  const f = MAT.furn, fu = OVEN.furn, v = k => f[k].v;
  return { runs: [0, 1].map(r => furnProgram(r, P.Troom)), Lx, Ly, margin: fu.margin / 1000, h0: P.h, rhoG: P.rhoG, Xin: P.Xroom,
    chem: { co: MAT.slurry.co.v, hc: v('hc'), s1: v('s1'), c1CO2: v('c1CO2'), c1CO: v('c1CO'), s2: v('s2'), c2CO: v('c2CO') },
    stages: { water: { Tp: v('Tw'), sig: 5e3 }, labile: { Tp: v('T1'), sig: v('w1') * 1e3 }, stable: { Tp: v('T2'), sig: v('w2') * 1e3 },
      last: { Tp: v('T3'), sig: v('w3') * 1e3 }, graph: { Tp: v('Tg'), sig: v('wg') * 1e3 } },
    dIn: v('dIn'), Dgal: v('Dgal') * 1e-10, Dmin: v('Dmin') * 1e-13, es: v('es'), sigZ: v('sigZ') * 1e3,
    paper: { t: fu.paperT / 1000, rho: v('rhoP') * 1000, D: v('Dp') * 1e-6, Ez: v('Ez') * 1e6 }, N: fu.N, room: fu.room, gap: fu.room === 'gap' ? fu.gap / 1000 : 0,
    // (a plate resting on the stack: its weight over the paper's area; GO-5b)
    plateP: (fu.plateW || 0) * FU_G / ((Lx + 2 * fu.margin / 1000) * (Ly + 2 * fu.margin / 1000)),
    La0: v('La0'), La1: v('La1'), ell: v('ell'), kG: v('kG'), nP: 12, nM: 2, dT: 1,
    // (the piece along itself on its paper, GO-5b: the dry film's stiffness, Poisson's ratio, strength and swelling
    //  from the Film card, its shrinking and hold from the Furnace card)
    plane: { Ep: MAT.film.Ep.v * 1e9, nu: MAT.film.nup.v, sigF: MAT.film.sigF.v * 1e6, bw: MAT.film.beta.v, bO: v('bO') / 100, bG: v('bG') / 100,
      am: v('am') * 1e-6, mu: v('mu'), Tstick: v('Tst') + 273.15, tauB: v('tauB') * 1e6, pStick: v('pSt') * 1e3,
      // (held by both papers: it sticks to the one below and the one above, GO-7)
      faces: 2 },
    // (the stack's top, middle and bottom pieces, together; the load's temperature spread, when given: its coldest and
    //  hottest stacks too, GO-7)
    positions: furnPositions(fu.N).map(({ m, w }) => ({ m, w })), loadSpread: Number.isFinite(fu.dTload) && fu.dTload > 0 ? fu.dTload : null };
}
/** The furnace's options for the DOE (a run's own piece fills in its thickness, GO and water in the worker): the room the Drying card's, the pieces' size the inputs bar's. */
function furnDoeOpts() {
  const o = furnOpts({ h: 0, rhoG: 0, Xroom: 0, Troom: MAT.dry.Troom.v }, OVEN.peel.pieceL / 1000, OVEN.peel.pieceW / 1000);
  delete o.h0; delete o.rhoG; delete o.Xin;
  return o;
}
/** The furnace to solve: the film shown's piece (its plate as cut, GO-4d/4f), the way its water left as the piece's section shows it; null until it is solved. */
function furnInputs() {
  const q = typeof sheetInputs === 'function' ? sheetInputs() : null;
  if (!q) return null;
  const way = typeof SHEET !== 'undefined' && SHEET.way === 'both' ? 'both' : 'top', pc = q.pieces.find(x => x.where === way) || q.pieces[0], P = pc.plate;
  if (!P || !(P.h > 0) || !(P.rhoG > 0)) return null;
  return { key: q.key, way: pc.where, P: { h: P.h, rhoG: P.rhoG, Xroom: P.Xroom, Troom: P.Troom }, o: furnOpts(P, q.Lx, q.Ly) };
}
const furnKeyNow = () => { const q = furnInputs(); return q ? JSON.stringify(q) : null; };
const furnCurrent = () => !!FURN.res && FURN.key === furnKeyNow();
function furnRequest() {
  const q = furnInputs();
  if (!q) return;
  const key = JSON.stringify(q);
  if (key === FURN.key || key === FURN.pending) return;
  if (FURN.busy) { FURN.again = true; return; }
  FURN.busy = true; FURN.again = false; FURN.pending = key; FURN.prog = null;
  if (!FURN.worker) FURN.worker = makeWorker('cfd-furnace-worker.js');
  const id = ++FURN.id;
  FURN.worker.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.progress) { FURN.prog = m.progress; return; }
    FURN.busy = false; FURN.pending = null; FURN.key = key;
    if (m.ok) { FURN.res = { ...m.res, q }; FURN.error = null; FURN.ms = m.ms; }
    else { FURN.res = null; FURN.error = m.error; }
    if (FURN.again) furnRequest();
    if (tab === 12) render();
  };
  FURN.worker.onerror = e => { FURN.busy = false; FURN.pending = null; FURN.key = key; FURN.res = null; FURN.error = e.message || 'the furnace\'s worker failed'; if (tab === 12) furnRender(); };
  FURN.worker.postMessage({ id, kind: 'run', o: q.o });
}
/** Wait for the furnace for the inputs as they are (the report): true when solved. */
async function furnWait() {
  if (typeof sheetWait === 'function' && !(await sheetWait())) return false;
  for (let k = 0; k < 2400; k++) {
    furnRequest();
    if (!FURN.busy && furnCurrent()) return true;
    if (!FURN.busy && FURN.error && FURN.key === furnKeyNow()) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}
/** The chain's stage 6. */
function furnStage() {
  if (!furnInputs()) return { st: 'todo', s: 'after the film and its piece are solved' };
  if (FURN.busy) return { st: 'busy', s: 'the two runs…' };
  if (!furnCurrent()) return FURN.error && FURN.key === furnKeyNow() ? { st: 'failed', s: FURN.error } : { st: 'todo', s: 'the two runs and the graphene film' };
  const r = FURN.res, [r1, r2] = r.runs;
  const puff = [r1, r2].map((q, i) => q.puffAt ? `run ${i + 1} from ${q.puffAt.T.toFixed(0)} °C` : '').filter(Boolean);
  const B = furnBatch(r);
  return { st: 'solved', s: `${dryFilmName(r.q.key).replace(/^the /, '')}: ${furnUm(B.h)} µm ± ${(B.sd * 1e6).toFixed(1)} over the batch (${(B.h / r.q.P.h).toFixed(2)}× the GO piece), ${(B.rho / 1000).toFixed(2)} g/cm³, ${B.kappa.toFixed(0)} W/(m·K); ${puff.length ? `puffs up in ${puff.join(', ')}` : 'does not puff up'}` };
}
const furnUm = v => (v * 1e6).toFixed(v * 1e6 >= 100 ? 0 : 1);
const furnCO = v => v > 1000 ? 'over 1000' : v >= 100 ? v.toFixed(0) : v.toFixed(1);

// ---- pictures ----
/**
 * One tier of the graphite holder, from your photos (Q106–Q108, Q131): a base plate held on the threaded rods by nuts,
 * the stack (a GO piece between each two graphite papers), a plate resting on it (its weight; none at 0 kg), then a
 * gap to the next tier's plate held by nuts, or that plate on it -- as set under The furnace.
 */
function furnPicHolder(sc = 1) {
  const fu = OVEN.furn || {}, w = 290, h = 150, ink = 'var(--muted)', gr = '#495057', go = '#e8590c', plate = '#868e96', nut = '#343a40', b = '#1c7ed6', red = '#c92a2a';
  const rest = (fu.plateW || 0) > 0, gap = fu.room !== 'plates', L = 10, R = 176, rodX = [26, 160];
  const pl = (y, nuts) => `<rect x="${L}" y="${y}" width="${R - L}" height="7" rx="1.5" fill="${plate}"/>` + (nuts ? rodX.map(x => `<rect x="${x - 7}" y="${y + 7}" width="14" height="4.5" rx="1" fill="${nut}"/>`).join('') : '');
  let st = '';
  const bot = 124, top = 80;
  for (let y = bot; y > top; y -= 7) st += `<rect x="42" y="${y - 2.5}" width="102" height="2.5" fill="${gr}"/><rect x="50" y="${y - 5.5}" width="86" height="2.5" fill="${go}"/>`;
  st += `<rect x="42" y="${top - 1}" width="102" height="2.5" fill="${gr}"/>`;
  const yRest = top - 8, yNext = gap ? (rest ? 36 : 44) : (rest ? yRest - 7 : top - 8);
  const lab = (y, t) => `<path d="M${R + 3} ${y}H${R + 12}" stroke="${ink}" stroke-width=".7"/><text x="${R + 15}" y="${y + 3}" font-size="8.5" fill="${ink}">${t}</text>`;
  return `<svg class="dry-pic" width="${w * sc}" height="${h * sc}" viewBox="0 0 ${w} ${h}" role="img" aria-label="One tier of the graphite holder: a base plate held on threaded rods by nuts, the stack of GO pieces between graphite papers, ${rest ? 'a plate resting on it, ' : ''}${gap ? 'a gap to the next plate held by nuts' : 'the next plate held on it'}">
    <defs><pattern id="fuThr" width="7" height="2.5" patternUnits="userSpaceOnUse"><rect width="7" height="2.5" fill="#6c757d"/><rect width="7" height=".9" fill="${gr}"/></pattern>
      <marker id="fuAr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${b}"/></marker>
      <marker id="fuAw" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="${red}"/></marker></defs>
    ${[0, 1, 2].map(i => `<rect x="42" y="${yNext - 9 - i * 6}" width="102" height="2.5" fill="${gr}" opacity=".35"/><rect x="50" y="${yNext - 12 - i * 6}" width="86" height="2.5" fill="${go}" opacity=".35"/>`).join('')}
    ${rodX.map(x => `<rect x="${x - 3.5}" y="4" width="7" height="${h - 14}" fill="url(#fuThr)"/>`).join('')}
    ${pl(bot + 2, true)}${st}
    ${rest ? pl(yRest, false) + `<path d="M70 ${yRest - 9}v7M116 ${yRest - 9}v7" stroke="${red}" stroke-width="1.3" marker-end="url(#fuAw)"/>` : ''}
    ${gap ? pl(yNext, true) + `<path d="M93 ${yNext + 13}V${(rest ? yRest : top - 1) - 2}" stroke="${b}" stroke-width="1.2" marker-start="url(#fuAr)" marker-end="url(#fuAr)"/>`
      : pl(yNext, false) + rodX.map(x => `<rect x="${x - 7}" y="${yNext - 4.5}" width="14" height="4.5" rx="1" fill="${nut}"/>`).join('')}
    ${lab(yNext + 3, gap ? 'next plate, on nuts' : 'next plate, held on it')}
    ${gap ? lab(((rest ? yRest : top) + yNext + 7) / 2, `gap ${fu.gap ?? ''} mm`) : ''}
    ${rest ? lab(yRest + 3, `plate on it, ${fu.plateW} kg`) : ''}
    ${lab(102, `${fu.N ?? ''} pieces`)}
    ${lab(bot + 5, 'base plate, on nuts')}
    <text x="93" y="${h - 2}" font-size="8.5" text-anchor="middle" fill="${ink}">one tier of the graphite holder, argon</text></svg>`;
}
/** Q102: the gas out of a piece, through it to the papers and along them out at their edges. */
function furnPicGas(sc = 1) {
  const w = 190, h = 124, ink = 'var(--muted)', gr = '#495057', go = '#e8590c', b = '#1c7ed6';
  return `<svg class="dry-pic" width="${w * sc}" height="${h * sc}" viewBox="0 0 ${w} ${h}" role="img" aria-label="The gas leaving a piece: through its thickness to the graphite papers, then along them out at their edges">
    <rect x="12" y="40" width="166" height="8" fill="${gr}"/><rect x="28" y="50" width="134" height="12" fill="${go}"/><rect x="12" y="64" width="166" height="8" fill="${gr}"/>
    <defs><marker id="fuG" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L10,5L0,10z" fill="${b}"/></marker></defs>
    ${[60, 95, 130].map(x => `<path d="M${x} 55v-9M${x} 57v9" stroke="${b}" stroke-width="1.3" marker-end="url(#fuG)"/>`).join('')}
    <path d="M85 44H14M105 44h71M85 68H14M105 68h71" stroke="${b}" stroke-width="1.2" stroke-dasharray="4 3" marker-end="url(#fuG)"/>
    <text x="95" y="28" font-size="9.5" text-anchor="middle" fill="${ink}">gas out along the papers</text>
    <text x="95" y="90" font-size="9.5" text-anchor="middle" fill="${ink}">through the piece to them</text>
    <text x="95" y="106" font-size="9.5" text-anchor="middle" fill="${ink}">highest where it cannot get out:</text><text x="95" y="119" font-size="9.5" text-anchor="middle" fill="${ink}">there it puffs up</text></svg>`;
}
/** The two runs' programs as they are set (Q87, Q97): temperature against time, side by side. */
function furnPicRuns(sc = 1) {
  const w = 190, h = 96, ink = 'var(--muted)', red = '#c92a2a';
  const ps = [0, 1].map(r => furnProgram(r)), tMax = Math.max(...ps.map(p => p[p.length - 1][0])), TMax = Math.max(...ps.flatMap(p => p.map(q => q[1] - 273.15)), 100);
  const X = (r, t) => 14 + r * 88 + t / tMax * 80, Y = T => 76 - (T - 0) / TMax * 60;
  const lines = ps.map((p, r) => `<polyline points="${p.map(q => `${X(r, q[0]).toFixed(1)},${Y(q[1] - 273.15).toFixed(1)}`).join(' ')}" fill="none" stroke="${red}" stroke-width="2"/>`).join('');
  const tops = ps.map((p, r) => { const m = Math.max(...p.map(q => q[1] - 273.15)); return `<text x="${X(r, tMax / 2).toFixed(0)}" y="${(Y(m) - 4).toFixed(0)}" font-size="8.5" text-anchor="middle" fill="var(--ink)">${m.toFixed(0)} °C</text>`; }).join('');
  return `<svg class="dry-pic" width="${w * sc}" height="${h * sc}" viewBox="0 0 ${w} ${h}" role="img" aria-label="The furnace's two runs: temperature against time as set">
    <path d="M12 77h176" stroke="var(--line)"/>${lines}${tops}
    ${ps.map((p, r) => `<text x="${X(r, tMax / 2).toFixed(0)}" y="90" font-size="9" text-anchor="middle" fill="${ink}">run ${r + 1}, ${(p[p.length - 1][0] / 3600).toFixed(1)} h</text>`).join('')}</svg>`;
}
/** Small pictures for the four checks (Q93). */
function furnPicCheck(kind, sc = 1) {
  const w = 90 * sc, h = 54 * sc, gr = '#495057', go = '#343a40', bad = 'var(--bad)';
  const body = {
    puff: `<rect x="10" y="30" width="70" height="7" fill="${go}"/><ellipse cx="45" cy="29" rx="16" ry="8" fill="${go}"/><path d="M36 20l-4-6M45 18v-7M54 20l4-6" stroke="${bad}" stroke-width="1.3"/>`,
    crack: `<rect x="10" y="24" width="70" height="8" fill="${go}"/><path d="M42 24l3 4-2 4" stroke="var(--surface)" stroke-width="2"/>`,
    wave: `<path d="M10 30q9-9 17 0t18 0 17 0 18 0" stroke="${go}" stroke-width="5" fill="none"/>`,
    stick: `<rect x="8" y="34" width="74" height="6" fill="${gr}"/><rect x="14" y="26" width="62" height="6" fill="${go}"/><path d="M30 32v4M46 32v4M62 32v4" stroke="${bad}" stroke-width="1.5"/>`,
  }[kind];
  return `<svg class="film-pic" width="${w}" height="${h}" viewBox="0 0 90 54" aria-hidden="true">${body}</svg>`;
}

// ---- the Process tab's section ----
function furnSectionHTML() {
  const seg = [...CFD_LOCS.map((l, i) => [`L${i + 1}`, `<i class="loc-dot" style="background:${locColor(i)}"></i>L${i + 1}`]), ['web', 'The web']];
  const pane = (id, icon, title, aria) => `<figure class="pane dry-pane"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="dry-sec furn-sec" id="furnSec" aria-labelledby="furnH">
    <header class="dry-head"><h3 id="furnH">${uiBadge('oven')}6 · The furnace and the graphene film</h3>
      <div class="seg" role="tablist" aria-label="Which film" id="furnSel">${seg.map(([k, t]) => `<button type="button" role="tab" data-furn="${k}" aria-selected="${k === DRY.sel}">${t}</button>`).join('')}</div>
      <span class="vp-spacer"></span><button type="button" class="btn btn-secondary btn-sm" id="furnProgBtn" data-chain="furnin" title="The furnace's runs and the stack in its holder, in the inputs bar">${uiIco('oven')}The furnace</button><button type="button" class="btn btn-secondary btn-sm" id="furnCsv" title="The two runs and the graphene film as a table">${uiIco('download')}CSV</button></header>
    <div class="furn-setup" data-pstep="setup">
      <div class="sheet-head furn-head">${furnPicGas(0.9)}<p class="fv-why">The pieces out of the drying stack go into the furnace one between each two graphite papers and are heated in argon twice: to about 1000 °C, then to 2800 °C. Their water and oxygen leave as gas, through a piece to the papers and along them to their edges. Where the gas cannot get out fast enough it parts the piece's layers: it puffs up, and comes out thicker.</p></div>
      <div class="furn-block"><div class="furn-bh"><h4>The runs</h4><div class="seg seg-sm" role="tablist" aria-label="Which run" id="furnSetupRun">${[0, 1].map(r => `<button type="button" role="tab" data-prun="${r}" aria-selected="${r === (FURN.prun || 0)}">${FURN_RUNS[r]}</button>`).join('')}</div><span class="fv-why" id="furnSetupRunT"></span></div>
        <div class="furn-prog"><div id="furnSetupRuns"></div><figure class="pane dry-pane no-report"><canvas id="furnProgCv" role="img" aria-label="The run's program: temperature against time; drag its corners"></canvas><div class="pane-legend" id="furnProgCvLg"></div></figure></div></div>
      <div class="furn-block"><h4>The stack in its holder</h4><div id="furnSetupHolder"></div></div>
      <div class="furn-block"><h4>The piece going in</h4><div id="furnSetupPiece"></div></div>
    </div>
    <div id="furnSolve" data-pstep="solve"></div>
    <div id="furnState" data-pstep="results"></div>
    <div class="furn-checks" id="furnChecks" data-pstep="results"></div>
    <div class="furn-pieces" id="furnPieces" data-pstep="results"></div>
    <div class="stats" id="furnStats" data-pstep="results"></div>
    <div class="furn-res" data-pstep="results"><div class="furn-chart">${typeof furnChipsHTML === 'function' ? furnChipsHTML() : ''}<div class="dry-grid furn-one">
      ${pane('fu1', 'oven', 'The two runs', 'The furnace temperature against time in each run')}
      ${pane('fu2', 'weight', 'Its weight', 'The piece\'s weight kept against time through the two runs')}
      ${pane('fu3', 'drop', 'Its oxygen: C/O', 'The film\'s carbon to oxygen ratio against time through the two runs, on a log scale')}
      ${pane('fu4', 'film', 'Its thickness', 'The piece\'s thickness at its middle and its edge against time through the two runs')}
      ${pane('fu5', 'ratio', 'The gas against its hold', 'The gas in the piece\'s middle against its layers\' hold, against time through the two runs')}
      ${pane('fu6', 'length', 'The graphene film across the piece', 'The graphene film\'s thickness from the piece\'s middle to its edge and to its corner')}
      ${pane('fu7', 'ratio', 'Along itself: pulled and squeezed', 'The pull in the piece against its strength, and its squeeze against what buckles it, against time through the two runs')}
    </div></div>
      <figure class="pane dry-pane furn-piece-fig"><figcaption>${uiBadge('film')}The piece <span class="seg seg-sm" role="tablist" aria-label="The piece as" id="furnPieceSel"><button type="button" role="tab" data-furnpiece="map" aria-selected="true">Map</button><button type="button" role="tab" data-furnpiece="3d" aria-selected="false">3D</button></span></figcaption><canvas id="furnPiece" role="img" aria-label="The graphene film's thickness over the whole piece, from above as a colour map or in 3D"></canvas><div class="pane-legend" id="furnPieceLg"></div></figure>
    </div>
    <div id="furnMeas" data-pstep="results"></div>
    <p class="fv-note" id="furnNote" data-pstep="solve"></p>
  </section>`;
}
function furnWire(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-furn]');
    if (b) { DRY.sel = b.dataset.furn; if (typeof dryRender === 'function') dryRender(); if (typeof filmRender === 'function') filmRender(); furnRender(); return; }
    const del = e.target.closest && e.target.closest('[data-furndel]');
    if (del) { furnMeasRemove(+del.dataset.furndel); return; }
    const use = e.target.closest && e.target.closest('[data-furnuse]');
    if (use) { const [k, v, what] = use.dataset.furnuse.split('|'); furnUse(k, +v, what); return; }
    const fit = e.target.closest && e.target.closest('[data-furnfit]');
    if (fit) { const [what, target, label] = fit.dataset.furnfit.split('|'); furnFit(what, +target, label); return; }
    const li = e.target.closest && e.target.closest('[data-furnlight]');
    if (li) { FURN.light = li.dataset.furnlight; if (FURN.res && furnCurrent()) furnChecks(FURN.res); }
    const ps = e.target.closest && e.target.closest('[data-furnpos]');
    if (ps) furnPosGo(+ps.dataset.furnpos);
  });
  // (the piece shown by the keyboard: arrows, Home and End along the stack's pieces)
  sec.addEventListener('keydown', e => {
    const ps = e.target.closest && e.target.closest('#furnPosSel [data-furnpos]');
    if (!ps || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const n = document.querySelectorAll('#furnPosSel [data-furnpos]').length, i = +ps.dataset.furnpos;
    e.preventDefault(); furnPosGo(e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
  });
  document.getElementById('furnCsv').onclick = furnExportCSV;
  if (typeof furnStageWire === 'function') furnStageWire(sec);
}
/** Shows the stack's i-th piece followed (its tiles, charts and map); the keyboard stays on its button (redrawn). */
function furnPosGo(i) {
  FURN.pos = i; furnRender();
  const b = document.querySelector(`#furnPosSel [data-furnpos="${i}"]`); if (b) b.focus();
}
function furnClear() {
  ['furnChecks', 'furnStats', 'furnNote'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  ['fu1', 'fu2', 'fu3', 'fu4', 'fu5', 'fu6'].forEach(id => { const cv = document.getElementById(id); if (cv) { const cx = setupCanvas(cv, FILM_ASPECT); cx.c.clearRect(0, 0, cx.w, cx.h); } const lg = document.getElementById(id + 'Lg'); if (lg) lg.innerHTML = ''; });
}
function furnRender() {
  const sec = document.getElementById('furnSec');
  if (!sec) return;
  if (!sec.dataset.wired) furnWire(sec);
  sec.querySelectorAll('[data-furn]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.furn === DRY.sel)));
  const st = document.getElementById('furnState');
  if (typeof furnSetupRender === 'function') { furnSetupRender(); furnShowChart(); }
  if (!furnInputs()) { st.innerHTML = '<p class="fv-why">After the film and its cut piece are solved (the Film stage).</p>'; furnClear(); furnMeasured(null); if (typeof furnSolveRender === 'function') furnSolveRender(null); return; }
  furnRequest();
  if (!furnCurrent()) {
    if (FURN.busy) st.innerHTML = `<p class="dry-msg">${pill('The furnace: the two runs…', '')}</p>`;
    else if (FURN.error) st.innerHTML = `<p class="dry-msg">${pill('The furnace could not be solved: ' + dryEsc(FURN.error), 'bad')}</p>`;
    furnClear(); furnMeasured(null); if (typeof furnSolveRender === 'function') furnSolveRender(null); return;
  }
  const r = FURN.res;
  // (the answer in a line, the warnings folded (Q117); the line of what went in is Setup's now)
  st.innerHTML = typeof furnAnswerHTML === 'function' ? furnAnswerHTML(r, furnWarnings(r)) : furnStateText(r) + furnWarnings(r);
  const rv = furnView(r);
  if (typeof furnSolveRender === 'function') { furnSolveRender(r); furnPieceDraw(rv); }
  furnChecks(r);
  furnPiecesRender(r);
  furnStats(rv);
  furnCharts(rv);
  furnMeasured(r);
  document.getElementById('furnNote').innerHTML = furnNoteText();
}
function furnStateText(r) {
  const P = r.q.P, fu = OVEN.furn, [r1, r2] = r.runs;
  const prog = i => { const run = fu.runs[i], p = furnProgram(i), top = Math.max(...p.map(q => q[1] - 273.15)); return run.file ? `your file ${dryEsc(run.file.name)} (${(p[p.length - 1][0] / 3600).toFixed(1)} h, to ${top.toFixed(0)} °C)` : `${run.steps.map(s => `${s.rate} °C/min to ${s.to} °C${s.hold ? `, ${s.hold} min there` : ''}`).join(', then ')}, cooling at ${run.cool} °C/min (${(p[p.length - 1][0] / 3600).toFixed(1)} h)`; };
  return `<p class="fv-why dry-where">${dryFilmName(r.q.key)}, its water having left from the ${SHEET_WAYS[r.q.way] || 'top only'} (as the piece above: its switch): a GO piece ${furnUm(P.h)} µm thick going in, its water ${(P.Xroom * 100).toFixed(1)} % of the GO (the room's), ${fu.N} pieces in a stack between ${fu.paperT} mm graphite papers ${fu.margin} mm bigger each side, ${fu.plateW > 0 ? `a ${fu.plateW} kg plate resting on it` : 'nothing resting on it'}, and ${fu.room === 'plates' ? 'the holder\'s next plate on that' : `a ${fu.gap} mm gap to the holder's next plate`}. Run 1: ${prog(0)}. Run 2: ${prog(1)}. ${(() => { const L = furnPieces(r); return L.length > 1 ? `The stack's ${L.map(q => `${q.name} (the ${furnOrd(q.nth)})`).join(', ')} pieces followed; the thickness the batch's, the charts and the piece ${furnPieceLabel(L[Math.min(L.length - 1, FURN.pos || 0)])}'s.` : 'One piece in the stack.'; })()}</p>`;
}
function furnWarnings(r) {
  const w = [], fu = OVEN.furn;
  if (!fu.runsSet) w.push(pill('The two runs\' programs are assumed: set yours, or upload your cycles, under The furnace in the inputs bar (Q97)', 'warn'));
  if (!fu.nSet) w.push(pill(`The pieces in a stack are assumed (${fu.N}: your photos show over 150): it depends on the product`, 'warn'));
  if (!fu.roomSet) w.push(pill('A gap above the stack or the holder\'s plates on it depends on the product: set it under The furnace', 'warn'));
  if (!fu.plateSet) w.push(pill(`The plate resting on the stack is assumed (${fu.plateW} kg): set yours under The furnace`, 'warn'));
  if (r.runs[0].puffAt) {
    const thick = r.q.P.h > 120e-6 ? `this GO piece is ${furnUm(r.q.P.h)} µm, thicker than your usual 60–120 µm (Q99), so its gas has further to go; ` : '';
    w.push(pill(`It puffs up in the first run too (from ${r.runs[0].puffAt.T.toFixed(0)} °C): ${thick}you have seen it puff only in the second (Q101). With your pieces and programs, Fit to my first run (below) sets the gas-tightness`, 'bad'));
  }
  // (the stack filling its room: the holder squeezes every piece alike, and they cannot differ down the stack, GO-7c)
  const sq = r.squeeze;
  if (sq && sq.max > 0) w.push(pill(`The stack fills its room${sq.from ? ` from ${sq.from.T.toFixed(0)} °C in run ${sq.from.run + 1}` : ''} and the holder squeezes every piece alike, up to ${sq.max >= 1 ? sq.max.toFixed(1) + ' MPa' : (sq.max * 1e3).toFixed(0) + ' kPa'}${(() => { const e = sq.max / MAT.furn.Ez.v; return e > 0.5 ? ` (its papers pressed by ${(e * 100).toFixed(0)} % of their thickness, more than they have: jammed this hard, the stack is beyond this model, whose papers give in proportion to the load)` : ''; })()}: then they come out alike down the stack, and none can stick where the others do not${(() => { const sf = (MAT.furnMeas || {}).stuckFrom; return sf > 1 ? `. Yours above the ${furnOrd(sf)} piece come off free: the gap above your stack${fu.room === 'gap' && !fu.roomSet ? ' (assumed here)' : ''} may be larger` : `: is the gap above your stack${fu.room === 'gap' && !fu.roomSet ? ' (assumed here)' : ''} as yours?`; })()}`, 'warn'));
  const nA = MAT_FURN.filter(q => MAT.furn[q[0]].flag === 'assumed').length;
  if (nA) w.push(pill(`${nA} of the Furnace card's ${MAT_FURN.length} values are assumed (Materials): the graphene film's measured thickness and heat conduction firm up two of them`, 'warn'));
  return `<div class="dry-warn">${w.join('')}</div>`;
}
// ---- the stack's pieces (GO-7): its top, middle and bottom followed together; the one shown; the batch ----
const FURN_POS_NAME = { top: 'Top', middle: 'Middle', bottom: 'Bottom', only: 'The piece' };
const furnOrd = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
/** The pieces followed, each with its name and its place in the stack (the 1st, the 100th of 200). */
function furnPieces(r) {
  // (named by the stack the run had, not the one set since: an input changed shows the last run until solved again)
  const N = r.q && r.q.o && r.q.o.N || OVEN.furn.N, P = furnPositions(N);
  return (r.pos || [{ ...r, m: 0, w: 1 }]).map((q, i) => ({ ...q, i, name: (P[i] || {}).name || 'top', nth: (q.m || 0) + 1, N }));
}
/** A piece's view (the one shown, FURN.pos, unless i is given): its own results over the run's shared ones. */
function furnView(r, i = FURN.pos || 0) {
  const L = furnPieces(r), q = L[Math.min(L.length - 1, Math.max(0, i))];
  return { ...r, hist: q.hist, along: q.along, diag: q.diag, map: q.map, runs: q.runs, end: q.end, plane: q.plane, piece: q };
}
/** The batch: its mean thickness and spread (each piece's own and the pieces' about the stack's, the stacks' too when
 *  the load's temperature spread is given); its density and heat conduction at that mean (the same GO per area). */
function furnBatch(r) {
  const b = r.batch || { hMean: r.end.h, hSD: r.end.hSD }, e = r.end;
  return { h: b.hMean, sd: b.hSD, rho: e.mEnd / b.hMean, kappa: e.kappa * e.h / b.hMean, stacks: !!b.stacks, within: b.within };
}
const furnPieceLabel = q => q.name === 'only' ? 'the piece' : `the ${q.name} piece (the ${furnOrd(q.nth)} of ${q.N || OVEN.furn.N})`;
/** The pieces: which one is shown, and each side by side (its load, thickness, spread, pull, squeeze, when it sticks). */
function furnPiecesRender(r) {
  const el = document.getElementById('furnPieces');
  if (!el) return;
  const L = furnPieces(r), on = Math.min(L.length - 1, Math.max(0, FURN.pos || 0)), sp = r.stacks;
  const sel = L.length > 1 ? `<div class="furn-pos"><span class="fv-why">The piece shown</span><div class="seg seg-sm" role="tablist" aria-label="The piece shown" id="furnPosSel">${L.map(q => `<button type="button" role="tab" data-furnpos="${q.i}" aria-selected="${q.i === on}">${FURN_POS_NAME[q.name]} <small>${furnOrd(q.nth)}</small></button>`).join('')}</div></div>` : '';
  const pct = v => Number.isFinite(v) ? `${(v * 100).toFixed(0)} %` : '—';
  const rows = L.map(q => { const pl = q.plane;
    return `<tr${q.i === on ? ' class="on"' : ''}><th>${FURN_POS_NAME[q.name]} <small>${furnOrd(q.nth)}</small></th><td>${Number.isFinite(q.load) ? q.load.toFixed(0) + ' Pa' : '—'}</td><td>${furnUm(q.end.h)} µm</td><td>${(q.end.hSD * 1e6).toFixed(1)} µm</td><td>${pct(pl && pl.ratioMax)}</td><td>${pct(pl && pl.waveMax)}</td><td>${pl && pl.stuckAt ? `${pl.stuckAt.T.toFixed(0)} °C` : 'no'}</td></tr>`; }).join('');
  // (the load's coldest and hottest stacks, GO-7: their own group, each its pieces together -- the same weights on them)
  const sStuck = s => { const T = s.pos.map(p => p.stuckT).filter(Number.isFinite); return T.length ? `${Math.min(...T).toFixed(0)} °C` : 'no'; };
  const sRow = (lab, s) => `<tr><th>${lab} <small>${s.d > 0 ? '+' : '−'}${Math.abs(s.d).toFixed(0)} °C at the top</small></th><td class="fv-why">as above</td><td>${furnUm(s.hMean)} µm</td><td>${(s.hSD * 1e6).toFixed(1)} µm</td><td>${pct(Math.max(...s.pos.map(p => p.ratioMax)))}</td><td>${pct(Math.max(...s.pos.map(p => p.waveMax)))}</td><td>${sStuck(s)}</td></tr>`;
  const sHead = `<tr class="furn-pos-g"><th colspan="7">The load's stacks <small>each its ${L.length > 1 ? 'pieces together' : 'piece'}; their runs ${sp ? sp.spread / 2 : 0} °C colder or hotter at the top</small></th></tr>`;
  const B = furnBatch(r);
  el.innerHTML = `${sel}<div class="oned-scroll"><table class="proc-kv proc-grid furn-pos-t"><thead><tr><th>${L.length > 1 ? 'The stack' : ''}</th><th>Weight on it <small>the plate, papers and pieces above</small></th><th>Thickness <small>its mean</small></th><th>Its spread <small>standard deviation</small></th><th>Pull <small>of its strength</small></th><th>Squeeze <small>of what buckles it</small></th><th>Sticks from</th></tr></thead><tbody>${rows}${sp ? sHead + sRow('Coldest stack', sp.cold) + sRow('Hottest stack', sp.hot) : ''}</tbody></table></div>
    <p class="fv-why">The batch: <b>${furnUm(B.h)} µm ± ${(B.sd * 1e6).toFixed(1)} µm</b> (standard deviation over ${B.stacks ? 'its stacks, from the coldest to the hottest, and' : ''} each stack's pieces, top to bottom, and across each piece). ${B.stacks ? `Within one stack ± ${(B.within * 1e6).toFixed(1)} µm.` : 'The stacks\' differences are not in it: the load\'s temperature spread is not known (under The furnace).'}</p>`;
}
/** A check's level against its limit (1 = at it): amber from 0.8 (a risk), red at 1 (it happens). */
const furnLevel = v => !(v >= 0.8) ? 'ok' : v < 1 ? 'warn' : 'bad';
/** The checks you named (Q93) and the even thickness you set (Q94, Q128): each a light, its level against its limit. */
function furnLights(r) {
  const fu = OVEN.furn, Tst = MAT.furn.Tst.v, L = furnPieces(r), sp = r.stacks;
  const Tmax = Math.max(...r.hist.map(q => q.T)) + (sp ? sp.spread / 2 : 0);
  // (each check at the stack's worst piece; with the load's temperature spread, the coldest and hottest stacks' too)
  const cand = L.map(q => ({ label: furnPieceLabel(q), i: q.i, puff: Math.max(...q.runs.map(x => x.peak.idx), q.runs.some(x => x.puffAt) ? 1 : 0),
    crack: q.plane ? q.plane.ratioMax : NaN, wave: q.plane ? q.plane.waveMax : NaN, stuck: !!(q.plane && q.plane.stuckAt) }));
  if (sp) for (const [s, lab] of [[sp.cold, 'coldest'], [sp.hot, 'hottest']]) s.pos.forEach((p, j) => { const q = L[j] || L[0];
    cand.push({ label: `the ${lab} stack's ${q.name === 'only' ? 'piece' : q.name + ' piece'}`, i: null, j: q.i, puff: Math.max(...p.puff, p.puffAt.some(x => x != null) ? 1 : 0), crack: p.ratioMax, wave: p.waveMax, stuck: p.stuckFrac > 0 }); });
  const worst = k => cand.reduce((a, q) => (Number.isFinite(q[k]) && (!a || q[k] > a[k]) ? q : a), null) || cand[0];
  const wP = worst('puff'), wC = worst('crack'), wW = worst('wave'), wS = cand.find(q => q.stuck) || cand[0];
  return [
    { k: 'puff', t: 'Puffing', bad: 'it puffs', v: wP.puff, who: wP },
    { k: 'crack', t: 'Cracking', bad: 'it cracks', v: wC.crack, who: wC },
    { k: 'wave', t: 'Waves', bad: 'it waves', v: wW.wave, who: wW },
    { k: 'stick', t: 'Sticking', bad: 'it sticks', v: wS.stuck ? Math.max(1, Tmax / Tst) : Tmax / Tst, who: wS },
    { k: 'even', t: 'Thickness spread', bad: 'over your limit', v: furnBatch(r).sd * 1e6 / fu.sdMax, who: null },
  ];
}
/** A check's word for its level (Q121): OK, a risk, or what happens. */
function furnWord(q) { return !Number.isFinite(q.v) ? 'not computed' : { ok: 'OK', warn: 'risk', bad: q.bad }[furnLevel(q.v)]; }
/** A check's picked sentences for the stack (the lights' panel and the report): its worst piece's, the pieces side by side. */
function furnCheckBody(r, k) {
  const v = t => `<span class="film-v">${t}</span>`, L = furnPieces(r), sp = r.stacks, fu = OVEN.furn;
  if (k === 'even') {
    const B = furnBatch(r), bad = t => `<span class="warn-text">${t}</span>`;
    return v(`Its thickness over the batch: <b>${(B.sd * 1e6).toFixed(1)} µm</b> standard deviation against your ${fu.sdMax} µm, about ${furnUm(B.h)} µm.`)
      + v(`Each piece's own across it and the pieces' about the stack's: ${L.map(q => `${FURN_POS_NAME[q.name].toLowerCase()} ${furnUm(q.end.h)} ± ${(q.end.hSD * 1e6).toFixed(1)} µm`).join(', ')}.`)
      + v(B.stacks ? `The stacks from the coldest to the hottest (${sp.spread} °C apart at the top): ${furnUm(sp.cold.hMean)} to ${furnUm(sp.hot.hMean)} µm.` : 'The stacks\' differences are not in it: the load\'s temperature spread is not known.')
      + v(B.sd * 1e6 > fu.sdMax ? bad('Uneven: over your limit.') : 'Within your limit.');
  }
  const Lg = furnLights(r).find(q => q.k === k), w = Lg && Lg.who;
  // (a coldest or hottest stack's piece the worst: below, the same place in the stack as set, whose history is kept)
  const at = w ? (w.i != null ? w.i : w.j) : null, pieceTxt = furnPieceCheckBody(furnView(r, at != null ? at : FURN.pos || 0), k);
  const pct = x => Number.isFinite(x) ? `${(x * 100).toFixed(0)} %` : '—';
  const side = { puff: q => pct(Math.max(...q.runs.map(x => x.peak.idx))), crack: q => pct(q.plane && q.plane.ratioMax), wave: q => pct(q.plane && q.plane.waveMax), stick: q => q.plane && q.plane.stuckAt ? `from ${q.plane.stuckAt.T.toFixed(0)} °C` : 'no' }[k];
  const all = L.length > 1 ? v(`<b>the stack</b> ${L.map(q => `${FURN_POS_NAME[q.name].toLowerCase()} ${side(q)}`).join(', ')}${sp ? `; the coldest stack at most ${pct(Math.max(...sp.cold.pos.map(p => ({ puff: Math.max(...p.puff), crack: p.ratioMax, wave: p.waveMax, stick: p.stuckFrac })[k])))}, the hottest ${pct(Math.max(...sp.hot.pos.map(p => ({ puff: Math.max(...p.puff), crack: p.ratioMax, wave: p.waveMax, stick: p.stuckFrac })[k])))}` : ''}`) : '';
  return (w && (L.length > 1 || sp) ? v(`<b>the worst</b> ${w.label}${w.i == null ? `; below, the same piece in the stack as set` : ''}`) : '') + pieceTxt + all;
}
/** A piece's sentences for a check: when, where and how much. */
function furnPieceCheckBody(r, k) {
  const bad = t => `<span class="warn-text">${t}</span>`, [r1, r2] = r.runs, pl = r.plane, e = r.end, fu = OVEN.furn;
  const where = q => { if (!q.at) return ''; const [hx, hy] = r.half, fx = q.at.x / hx, fy = q.at.y / hy; return Math.max(fx, fy) < 0.34 ? 'in the middle' : Math.min(fx, fy) > 0.8 ? 'at a corner' : Math.max(fx, fy) > 0.8 ? 'near an edge' : 'part way out'; };
  const whereR = x => x == null ? '' : x < 0.34 ? 'in the middle' : x > 0.9 ? 'at its edge' : 'part way out';
  const when = q => `${q.T.toFixed(0)} °C in run ${q.run + 1} (${(q.t - (q.run ? r.runs[0].tEnd : 0)).toFixed(1)} h in)`;
  const puffRun = q => q.puffAt ? bad(`puffs up from ${q.puffAt.T.toFixed(0)} °C (${q.puffAt.t.toFixed(1)} h in)`) : `does not: at most ${(q.peak.idx * 100).toFixed(0)} % of its hold (at ${q.peak.T.toFixed(0)} °C, ${where(q.peak)})`;
  const v = t => `<span class="film-v">${t}</span>`;
  if (k === 'puff') {
    // (the stack's growth against the room above it: once it fills the gap, the plate above holds the pieces)
    const grow = fu.N * Math.max(0, e.h - e.hc) * 1000, full = fu.room === 'plates' || grow >= fu.gap * 0.999;
    return v(`<b>run 1</b> ${puffRun(r1)}`) + v(`<b>run 2</b> ${puffRun(r2)}`) + v(`<b>out</b> ${furnUm(e.h)} µm, ${(e.h / r.q.P.h).toFixed(2)}× the GO piece`)
      + (e.h > e.hc * 1.001 ? v(full ? `<b>the holder</b> ${fu.room === 'plates' ? 'the plate on the stack holds the pieces\' growth' : `the stack has filled its ${fu.gap} mm gap (${fu.N} pieces × ${((e.h - e.hc) * 1e6).toFixed(0)} µm): the plate above holds the pieces' growth`}, and presses the papers` : `<b>the holder</b> the stack grew ${grow.toFixed(1)} mm of its ${fu.gap} mm gap`) : '');
  }
  if (k === 'even') return v(`Its thickness across the piece: <b>${(e.hSD * 1e6).toFixed(1)} µm</b> standard deviation against your ${fu.sdMax} µm (${furnUm(e.hMin)}–${furnUm(e.hMax)} µm).`)
    + v(e.hSD * 1e6 > fu.sdMax ? bad('Uneven: where the gas cannot get out it puffs more.') : 'Within your limit.');
  if (!pl) return v('Not computed.');
  if (k === 'crack') return pl.first
    ? v(bad(`It cracks from ${when(pl.first)}, ${whereR(pl.first.r)}: its pull beats its strength (${pl.first.sc.toFixed(2)} MPa there).`)) + v(pl.stuckFrac > 0 && pl.spacing ? `Stuck to its paper, it breaks into cells about <b>${(pl.spacing * 1000).toFixed(1)} mm</b> apart (a grid, Q124): about ${Math.max(1, Math.round(Math.sqrt(r.q.o.Lx * r.q.o.Ly) / pl.spacing))} across the piece.` : 'Free on its paper, straight across where the pull is highest (Q113).')
    : v(`It does not: its pull at most <b>${(pl.ratioMax * 100).toFixed(0)} %</b> of its strength${pl.where ? `, at ${when(pl.where)}, ${whereR(pl.where.r)}` : ''}.`) + v('It shrinks along itself as its oxygen leaves and it graphitizes; its paper holds it back (friction, or its bond where stuck): its pull.');
  if (k === 'wave') return pl.waveMax >= 1 ? v(bad(`Squeezed along itself, it buckles between its papers into waves about <b>${(pl.waveAt.lambda * 1000).toFixed(1)} mm</b> long, from ${when(pl.waveAt)}.`))
    : v(`It does not: squeezed at most <b>${(pl.waveMax * 100).toFixed(0)} %</b> of what buckles it between its papers${pl.waveAt ? ` (waves would be about ${(pl.waveAt.lambda * 1000).toFixed(1)} mm long)` : ''}.`) + v(pl.compMin < 0 ? `Its squeeze at most ${(-pl.compMin).toFixed(2)} MPa.` : 'It is never squeezed: it only shrinks against its paper. Growing along itself (graphitizing below 0 on the Furnace card) or its heat expansion against the paper\'s would squeeze it.');
  if (k === 'stick') return pl.stuckAt ? v(bad(`It sticks to its paper from ${when(pl.stuckAt)}: ${(pl.stuckFrac * 100).toFixed(0)} % of it (where pressed; where the gas lifts the paper, not).`)) + v('Stuck, the paper holds it by its bond: it can no longer slide as it shrinks.')
    : v(`It does not: it reaches ${Math.max(...r.hist.map(q => q.T)).toFixed(0)} °C, below the ${MAT.furn.Tst.v} °C it sticks at (the Furnace card).`);
  return '';
}
function furnChecks(r) {
  const pl = furnView(r).plane, L = furnLights(r), pick = L.find(q => q.k === FURN.light) || L.reduce((a, q) => (q.v > a.v ? q : a), L[0]);
  const sym = { ok: '✓', warn: '!', bad: '✕' };
  const lights = L.map(q => { const lv = Number.isFinite(q.v) ? furnLevel(q.v) : 'ok';
    return `<button type="button" role="tab" class="furn-light ${lv}" data-furnlight="${q.k}" aria-selected="${q === pick}" title="${q.t}: ${furnWord(q)}${Number.isFinite(q.v) ? `, ${(q.v * 100).toFixed(0)} % of its limit` : ''}"><span class="fl-i" aria-hidden="true">${sym[lv]}</span>${q.t} · ${furnWord(q)}<small>${Number.isFinite(q.v) ? (q.v * 100).toFixed(0) + ' %' : ''}</small></button>`; }).join('');
  const pic = { puff: 'puff', crack: 'crack', wave: 'wave', stick: 'stick', even: 'puff' }[pick.k];
  const size = pl ? `<p class="fv-why furn-size">Its size after the furnace: ${(pl.size.free * 100).toFixed(2)} % free on its own (${(pl.size.held * 100).toFixed(2)} % as held on its paper).</p>` : '';
  document.getElementById('furnChecks').innerHTML = `<div class="furn-lights" role="tablist" aria-label="The furnace's checks">${lights}</div>
    <div class="furn-light-d" role="tabpanel">${furnPicCheck(pic)}<div><h4>${pick.t}</h4>${furnCheckBody(r, pick.k)}</div></div>${size}`;
  if (typeof applyHelp === 'function') applyHelp();   // (rebuilt outside render, as a light is picked: its help again)
}
function furnStats(r) {
  const e = r.end, P = r.q.P;
  const tiles = [
    ['Thickness', `${furnUm(e.h)} µm`, 'film', `${(e.h / P.h).toFixed(2)}× the GO piece (${furnUm(P.h)} µm)`],
    ['Density', `${(e.rho / 1000).toFixed(2)} g/cm³`, 'weight', `its layers alone ${(e.mEnd / e.hc / 1000).toFixed(2)}`],
    ['Heat along it', `${e.kappa.toFixed(0)} W/(m·K)`, 'ratio', 'a correlation (the Furnace card)'],
    ['C/O', furnCO(e.CO), 'drop', `the GO's ${MAT.slurry.co.v}`],
    ['Weight kept', `${(e.kept * 100).toFixed(1)} %`, 'weight', 'of the dry GO'],
    ['Graphitized', `${(e.g * 100).toFixed(0)} %`, 'bars', `layers ${(e.d * 10).toFixed(3)} Å apart, crystallites ${e.La >= 1000 ? (e.La / 1000).toFixed(2) + ' µm' : e.La.toFixed(0) + ' nm'}`],
  ];
  document.getElementById('furnStats').innerHTML = tiles.map(([l, v, ic, s]) => `<div class="stat" title="${l}: ${v} — ${s}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>${s}</small></div>`).join('');
}
function furnCharts(r) {
  const red = '#c92a2a', col = DRY.sel === 'web' ? '#e8590c' : dryFilmColor(DRY.sel), mut = cssVar('--muted'), bad = cssVar('--bad'), soft = cssVar('--soft');
  const lg = (id, items, note) => { const el = document.getElementById(id + 'Lg'); if (el) el.innerHTML = oneDLegend(items) + (note ? `<p class="fv-why">${note}</p>` : ''); };
  // (1) the programs as set: temperature against the time into each run
  const ps = [0, 1].map(k => furnProgram(k)), tMax = Math.max(...ps.map(p => p[p.length - 1][0] / 3600));
  plotChart(document.getElementById('fu1'), FILM_ASPECT, { x0: 0, x1: tMax, y0: 0, y1: Math.max(...ps.flatMap(p => p.map(q => q[1] - 273.15))) * 1.08, xl: 'time into the run (h)', yl: 'temperature (°C)', xd: 1, yd: 0,
    s: [...ps.map((p, k) => ({ p: p.map(q => [q[0] / 3600, q[1] - 273.15]), c: red, w: 2, dash: k ? [6, 4] : [] })),
      ...r.runs.map((q, k) => q.puffAt ? { p: [[q.puffAt.t - (k ? r.runs[0].tEnd : 0), q.puffAt.T]], c: bad, line: false, dots: true } : null).filter(Boolean)] });
  lg('fu1', [['run 1', red], ['run 2', red, 'dash'], ...(r.runs.some(q => q.puffAt) ? [['starts to puff up', bad]] : [])], 'As set under The furnace (or from your file). Each run starts from the room.');
  // (2)–(5) through both runs: the second run's time after the first's, shaded
  const t1 = r.runs[0].tEnd, tEnd = r.runs[1].tEnd, band = [{ x0: t1, x1: tEnd, c: soft }], vl = [{ x: t1, c: mut, t: 'run 2' }], H = r.hist;
  const hi = (a, f = 1.08) => Math.max(...a) * f;
  plotChart(document.getElementById('fu2'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: 105, xl: 'time (h)', yl: 'weight kept (% of the dry GO)', xd: 0, yd: 0, bands: band, vl,
    s: [{ p: H.map(q => [q.t, q.kept]), c: col, w: 2 }] });
  lg('fu2', [['the piece\'s weight', col]], 'Its water first, then its labile oxygen (a sharp step), the stable oxygen, the last oxygen and hydrogen.');
  const lco = H.map(q => Math.log10(Math.max(1, Math.min(1e4, q.CO))));
  plotChart(document.getElementById('fu3'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: 4, xl: 'time (h)', yl: 'C/O', xd: 0, yticks: [0, 1, 2, 3, 4], yf: v => v >= 4 ? '10⁴' : String(Math.round(10 ** v)), bands: band, vl,
    s: [{ p: H.map((q, i) => [q.t, lco[i]]), c: col, w: 2 }] });
  lg('fu3', [['its carbon to oxygen, atoms', col]], 'Shown up to 10⁴: past it the oxygen left is a trace.');
  plotChart(document.getElementById('fu4'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: hi([...H.map(q => q.hMid), ...H.map(q => q.hEdge), r.q.P.h * 1e6]), xl: 'time (h)', yl: 'thickness (µm)', xd: 0, yd: 0, bands: band, vl,
    hl: [{ y: r.q.P.h * 1e6, c: mut, t: 'the GO piece', left: true }],
    s: [{ p: H.map(q => [q.t, q.hc]), c: mut, w: 1.5, dash: [2, 3] }, { p: H.map(q => [q.t, q.hMid]), c: col, w: 2 }, { p: H.map(q => [q.t, q.hEdge]), c: col, w: 2, dash: [6, 4] }] });
  lg('fu4', [['its middle', col], ['near its edge', col, 'dash'], ['its layers alone (closing up)', mut, 'dash']], 'Its layers close up as its oxygen leaves; where the gas parts them it grows, and stays so.');
  plotChart(document.getElementById('fu5'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: 110, xl: 'time (h)', yl: 'gas against the hold (%)', xd: 0, yd: 0, bands: band, vl,
    hl: [{ y: 100, c: bad, t: 'its hold: puffs up', left: true, below: true }],
    s: [{ p: H.map(q => [q.t, Math.min(110, q.idxMax)]), c: col, w: 2 }] });
  lg('fu5', [['the gas in a piece, where highest', col]], `Its hold: its layers' cohesion (${MAT.furn.sigZ.v} kPa) and the load on them. At 100 % it is puffing: the gas holds its layers apart.`);
  const all = [...r.along, ...r.diag].map(q => q[1]), lo = Math.min(...all), top = Math.max(...all);
  plotChart(document.getElementById('fu6'), FILM_ASPECT, { x0: 0, x1: Math.max(...r.diag.map(q => q[0])) * 1.02, y0: Math.max(0, lo - (top - lo) * 0.5 - 1), y1: top + (top - lo) * 0.5 + 1, xl: 'from the middle out (mm)', yl: 'thickness (µm)', xd: 0, yd: 1,
    vl: [{ x: r.half[0], c: mut, t: 'edge' }],
    s: [{ p: r.along, c: col, w: 2 }, { p: r.diag, c: col, w: 2, dash: [6, 4] }] });
  lg('fu6', [['to the middle of an edge', col], ['to a corner', col, 'dash']], `The graphene film at the end, the top piece: ${furnUm(r.end.hMin)}–${furnUm(r.end.hMax)} µm.`);
  // (7) along itself: its pull against its strength, its squeeze against what buckles it; where it sticks
  const pl = r.plane;
  if (pl) {
    const PH = pl.hist, stuck = pl.stuckAt ? [{ x: pl.stuckAt.t, c: bad, t: 'sticks' }] : [];
    plotChart(document.getElementById('fu7'), FILM_ASPECT, { x0: 0, x1: tEnd, y0: 0, y1: 120, xl: 'time (h)', yl: 'against what it takes (%)', xd: 0, yd: 0, bands: band, vl: [...vl, ...stuck],
      hl: [{ y: 100, c: bad, t: 'cracks / waves', left: true, below: true }, { y: 80, c: mut, t: 'a risk', left: true, below: true }],
      s: [{ p: PH.map(q => [q.t, Math.min(120, Math.max(0, q.ratio))]), c: col, w: 2 }, { p: PH.map(q => [q.t, Math.min(120, q.wave)]), c: col, w: 2, dash: [6, 4] }] });
    lg('fu7', [['its pull, against its strength', col], ['its squeeze, against what buckles it', col, 'dash'], ...(pl.stuckAt ? [['it sticks to its paper', bad]] : [])],
      'It shrinks along itself as its water and oxygen leave and it graphitizes; its paper holds it back by friction (the load on it), or by its bond once stuck.');
  } else lg('fu7', [], 'Not computed.');
}
function furnNoteText() {
  return 'The film\'s chemistry is a set of first-order stages with spread activation energies, integrated exactly over the programs; the gas goes out by Knudsen diffusion through the galleries between its layers (closing as the oxygen leaves and the layers order into graphite) and along the graphite paper; where it beats the layers\' hold they part and hold it (the growth kept). The heat conduction along the graphene film is a correlation: graphite\'s, times its density over graphite\'s, times La / (La + ℓ). The checks: furnace.validate.js.';
}
function furnExportCSV() {
  if (!FURN.res) return;
  // (every piece followed, GO-7: its place in the stack in the first column)
  const r = FURN.res, L = furnPieces(r), nm = q => `${q.name} (${furnOrd(q.nth)})`, B = furnBatch(r);
  const rows = [['piece', 'run', 'time_h', 'temperature_C', 'weight_kept_pct', 'C_O', 'graphitized', 'layer_spacing_nm', 'thickness_middle_um', 'thickness_edge_um', 'layers_alone_um', 'gas_vs_hold_middle_pct', 'gas_vs_hold_highest_pct', 'hold_kPa']];
  for (const p of L) for (const q of p.hist) rows.push([nm(p), q.run + 1, q.t, q.T, q.kept, q.CO, q.g, q.d, q.hMid, q.hEdge, q.hc, q.idxMid, q.idxMax, q.hold]);
  rows.push([]); rows.push(['piece', 'across', 'from_middle_mm', 'thickness_um']);
  for (const p of L) { for (const [x, v] of p.along) rows.push([nm(p), 'to the edge', x, v]); for (const [x, v] of p.diag) rows.push([nm(p), 'to the corner', x, v]); }
  if (L.some(p => p.plane)) {
    rows.push([]); rows.push(['piece', 'run', 'time_h', 'temperature_C', 'natural_strain_pct', 'pull_MPa', 'squeeze_MPa', 'strength_MPa', 'buckles_at_MPa', 'pull_vs_strength_pct', 'squeeze_vs_buckling_pct', 'stuck_pct']);
    for (const p of L) if (p.plane) for (const q of p.plane.hist) rows.push([nm(p), q.run + 1, q.t, q.T, q.eps, q.s1, q.s2, q.sc, q.sw, q.ratio, q.wave, q.stuck]);
  }
  rows.push([]); rows.push(['batch_thickness_um', 'batch_sd_um', 'stacks_in_it']); rows.push([+(B.h * 1e6).toFixed(3), +(B.sd * 1e6).toFixed(3), B.stacks ? 'yes' : 'no (the load\'s temperature spread not known)']);
  downloadCSV(`furnace-${csvStamp()}.csv`, rows);
}

// ---- measured on the graphene film (Q92): its thickness, weight and heat conduction ----
function furnMeasured(r) {
  const host = document.getElementById('furnMeas');
  if (!host) return;
  const m = MAT.furnMeas, locs = [['web', 'The web'], ...CFD_LOCS.map((l, i) => [`L${i + 1}`, `L${i + 1}`])];
  const num = (id, l, u, lo, hi, step) => `<label>${l} <span class="prop-v"><input type="number" id="${id}" min="${lo}" max="${hi}" step="${step}" placeholder="—"><span class="prop-u">${u}</span></span></label>`;
  const imp = [];
  if (r) {
    // (your graphene film against the batch's: its mean thickness, density and heat conduction; GO-7)
    const P = r.q.P, B = furnBatch(r), e = { ...r.end, h: B.h, rho: B.rho, kappa: B.kappa };
    for (const [k, q] of (m.out || []).entries()) {
      if (q.loc !== DRY.sel) continue;
      if (Number.isFinite(q.h)) {
        const tgt = q.h * 1e-6, busy = FURN.fit && FURN.fit.what === 'es';
        imp.push(`<li>Your graphene film ${q.h} µm thick against the computed ${furnUm(e.h)} µm (${((e.h / tgt - 1) * 100).toFixed(0)} %). ${busy ? `<span id="furnFitMsg">${pill(FURN.fit.msg || 'Fitting…', '')}</span>` : `<button type="button" class="linkish" data-furnfit="es|${tgt}|your thickness ${q.h} µm">Fit the puffed film's way out to it</button>`}</li>`);
      }
      if (Number.isFinite(q.kept)) imp.push(`<li>Your weight kept ${q.kept} % against the computed ${(e.kept / (1 + P.Xroom) * 100).toFixed(1)} % (of the GO piece with its water, ${(P.Xroom * 100).toFixed(1)} %): the Furnace card's oxygen shares and the GO's C/O set it.</li>`);
      if (Number.isFinite(q.kappa)) {
        const f = MAT.furn, a = f.kG.v * (e.rho / 2260), ell = a > q.kappa ? e.La * (a / q.kappa - 1) : NaN;
        imp.push(`<li>Your heat conduction ${q.kappa} W/(m·K) against the computed ${e.kappa.toFixed(0)}: ${Number.isFinite(ell) ? `the crystallites' size that halves it would be <b>${ell.toFixed(0)}</b> nm. <button type="button" class="linkish" data-furnuse="ell|${+ell.toPrecision(3)}|your heat conduction ${q.kappa} W/(m·K)">Use</button>` : `<span class="warn-text">more than graphite's at this density (${a.toFixed(0)}): the film may be denser than computed</span>`}</li>`);
      }
    }
    if (!(m.out || []).some(q => q.loc === DRY.sel)) imp.push('<li class="fv-why">Nothing measured for this film yet.</li>');
    const f1 = FURN.fit && FURN.fit.what === 'Dgal';
    imp.push(`<li>The first run does not puff up (Q101): ${f1 ? `<span id="furnFitMsg">${pill(FURN.fit.msg || 'Fitting…', '')}</span>` : `<button type="button" class="linkish" data-furnfit="Dgal|0|your first run not puffing">Fit the gas through its open layers to my first run</button>`} (the least that keeps it below its hold, with the first run as set).</li>`);
    // (where in the stack yours stick, GO-7c: the pieces followed stuck over half their area or not, against yours)
    const sf = m.stuckFrom;
    if (Number.isFinite(sf)) {
      const L = furnPieces(r), got = L.map(q => ({ q, stuck: !!(q.plane && q.plane.stuckFrac >= 0.5), want: q.nth >= sf }));
      const ok = got.every(x => x.stuck === x.want), f3 = FURN.fit && FURN.fit.what === 'pSt';
      const say = got.map(x => `${FURN_POS_NAME[x.q.name].toLowerCase()} (the ${furnOrd(x.q.nth)}) ${x.stuck ? 'stuck' : 'free'}${x.stuck === x.want ? '' : ` <span class="warn-text">(yours ${x.want ? 'stuck' : 'free'})</span>`}`).join(', ');
      imp.push(`<li>Yours stuck from the ${furnOrd(sf)} piece down; computed: ${say}. ${ok ? 'As yours.' : f3 ? `<span id="furnFitMsg">${pill(FURN.fit.msg || 'Fitting…', '')}</span>` : `<button type="button" class="linkish" data-furnfit="pSt|${sf}|the pieces stuck from the ${furnOrd(sf)}">Fit the pressure it sticks from to it</button>`}</li>`);
      if (FURN.lastFit && FURN.lastFit.what === 'pSt' && FURN.lastFit.range) { const [a, b] = FURN.lastFit.range; imp.push(`<li class="fv-note">Any pressure between ${(a / 1e3).toPrecision(3)} and ${(b / 1e3).toPrecision(3)} kPa sticks the ${furnOrd(sf)} piece and not the one above it (their pressure once hot over half their area); the middle is used.</li>`); }
    }
    if (FURN.fit && FURN.fit.error) imp.push(`<li>${pill(`The fit could not be made: ${dryEsc(FURN.fit.error)}`, 'bad')}</li>`);
  }
  const list = (m.out || []).map((q, k) => `<li>${q.loc === 'web' ? 'The web' : q.loc}: ${[Number.isFinite(q.h) ? `${q.h} µm thick` : '', Number.isFinite(q.kept) ? `${q.kept} % of its weight kept` : '', Number.isFinite(q.kappa) ? `${q.kappa} W/(m·K) along it` : ''].filter(Boolean).join(', ')} <button type="button" class="linkish" data-furndel="${k}">Remove</button></li>`).join('') || '<li class="fv-why">None yet.</li>';
  host.innerHTML = `<h3 class="oned-h">Measured graphene film</h3>
    <div class="dry-meas film-meas">
      <div class="dry-mcol"><h4>${furnPicCheck('puff', 0.5)} Out of the furnace</h4>
        <div class="dry-exit-form"><label>Film <select id="fuMLoc">${locs.map(([k, t]) => `<option value="${k}"${k === DRY.sel ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          ${num('fuMH', 'Thickness', 'µm', 1, 10000, 1)}${num('fuMKept', 'Weight kept (of the GO piece)', '%', 1, 100, 0.1)}${num('fuMK', 'Heat conduction along it', 'W/(m·K)', 1, 5000, 1)}
          <button class="btn btn-secondary btn-sm" type="button" id="fuMAdd">Add</button></div>
        <ul class="dry-list">${list}</ul>
        <div class="dry-exit-form furn-stuck-form"><label>Stuck to their papers from piece <span class="prop-v"><input type="number" id="fuMStuck" min="1" max="${OVEN.furn.N}" step="1" placeholder="—" value="${Number.isFinite(m.stuckFrom) ? m.stuckFrom : ''}"><span class="prop-u">of ${OVEN.furn.N}</span></span></label>
          <button class="btn btn-secondary btn-sm" type="button" id="fuMStuckSet">Set</button>${Number.isFinite(m.stuckFrom) ? ' <button type="button" class="linkish" id="fuMStuckClear">Clear</button>' : ''}
          <small class="fv-why">counted from the top; the pieces above it came off free</small></div></div>
      <div class="dry-mcol"><h4>What they mean</h4><ul class="dry-cmp film-imp">${imp.join('') || '<li class="fv-why">After the furnace is solved.</li>'}</ul></div>
    </div>`;
  document.getElementById('fuMStuckSet').onclick = () => {
    const el = document.getElementById('fuMStuck'), v = parseFloat(el.value), N = OVEN.furn.N;
    if (!(Number.isInteger(v) && v >= 1 && v <= N)) { imgToast(`The first piece stuck: a whole number from 1 (the top) to ${N}.`, 'error'); return; }
    undoHint(`Stuck from piece ${v}`);
    MAT = { ...MAT, furnMeas: { ...MAT.furnMeas, stuckFrom: v } };
    render();
  };
  const clr = document.getElementById('fuMStuckClear');
  if (clr) clr.onclick = () => { undoHint('Clear where they stick'); MAT = { ...MAT, furnMeas: { ...MAT.furnMeas, stuckFrom: null } }; render(); };
  document.getElementById('fuMAdd').onclick = () => {
    const g = id => { const el = document.getElementById(id), v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : NaN; };
    const q = { loc: document.getElementById('fuMLoc').value, h: g('fuMH'), kept: g('fuMKept'), kappa: g('fuMK') };
    if (![q.h, q.kept, q.kappa].some(Number.isFinite)) { imgToast('Type the graphene film\'s thickness, its weight kept or its heat conduction.', 'error'); return; }
    if ((Number.isFinite(q.h) && !(q.h > 0)) || (Number.isFinite(q.kept) && !(q.kept > 0 && q.kept <= 100)) || (Number.isFinite(q.kappa) && !(q.kappa > 0))) { imgToast('The thickness and heat conduction above 0, the weight kept 0–100 %.', 'error'); return; }
    undoHint('Add a measured graphene film');
    MAT = { ...MAT, furnMeas: { ...MAT.furnMeas, out: [...(MAT.furnMeas.out || []), q] } };
    render();
  };
  if (typeof applyHelp === 'function') applyHelp();   // (rebuilt outside render, as a fit goes on: its help again)
}
function furnMeasRemove(k) {
  undoHint('Remove a measured graphene film');
  MAT = { ...MAT, furnMeas: { ...MAT.furnMeas, out: (MAT.furnMeas.out || []).filter((_, i) => i !== k) } };
  render();
}
/** Use a value on the Furnace card: measured, its source what it came from. */
function furnUse(k, v, what) {
  const row = MAT_FURN.find(q => q[0] === k);
  if (!row || !Number.isFinite(v)) return;
  const [, l, , lo, hi] = row, vv = Math.min(hi, Math.max(lo, v));
  undoHint(`${l}: from ${what}`);
  MAT = { ...MAT, furn: { ...MAT.furn, [k]: { v: vv, flag: 'measured', src: `from ${what}` } } };
  render();
}
/** A fit in the furnace's worker: the puffed film's way out from a measured thickness, or the open layers' gas way from the first run. */
function furnFit(what, target, label) {
  const q = furnInputs();
  if (!q || (FURN.fit && !FURN.fit.error && !FURN.fit.done)) return;
  if (!FURN.fitWorker) FURN.fitWorker = makeWorker('cfd-furnace-worker.js');
  const id = ++FURN.id;
  FURN.fit = { what, msg: 'Fitting…' };
  FURN.fitWorker.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.progress) {
      // (only its message changes: the measured form keeps what is being typed in it)
      FURN.fit.msg = `Fitting: ${m.progress.k + 1} of ${m.progress.n}…`;
      const el = document.getElementById('furnFitMsg');
      if (el) el.innerHTML = pill(FURN.fit.msg, ''); else if (tab === 12) furnMeasured(FURN.res && furnCurrent() ? FURN.res : null);
      return;
    }
    if (!m.ok) { FURN.fit = { what, error: m.error, done: true }; if (tab === 12) furnRender(); return; }
    FURN.fit = null; FURN.lastFit = { what, range: m.range || null };
    const card = what === 'es' ? ['es', +m.value.toPrecision(3)] : what === 'pSt' ? ['pSt', +(m.value / 1e3).toPrecision(3)] : ['Dgal', +(m.value / 1e-10).toPrecision(3)];
    furnUse(card[0], card[1], label);
  };
  FURN.fitWorker.onerror = e => { FURN.fit = { what, error: e.message || 'the fit\'s worker failed', done: true }; if (tab === 12) furnRender(); };
  FURN.fitWorker.postMessage({ id, kind: 'fit', what, o: q.o, target });
  if (tab === 12) furnMeasured(FURN.res && furnCurrent() ? FURN.res : null);
}

// ---- the inputs bar: the furnace (its two runs, the stack in the holder) ----
function furnTreeHTML() {
  const prop = (label, id, attrs, unit) => `<div class="prop"><label class="prop-l" for="${id}">${label}</label><span class="prop-v"><input type="number" id="${id}" ${attrs}><span class="prop-u">${unit}</span></span></div>`;
  const fu = OVEN.furn, as = f => fu[f] ? '' : ' <small>assumed</small>';
  // (the load's temperature spread: empty while not known, not an assumed value)
  const field = (i, id) => { const f = FURN_FIELDS[i], unk = f[0] === 'dTload'; return prop(`${f[1]}${unk ? '' : as(f[7])}`, id, `min="${f[3]}" max="${f[4]}" step="${f[5]}" value="${fu[f[0]] ?? ''}"${unk ? ' placeholder="not known"' : ''} data-furnf="${f[0]}"`, f[2]); };
  const run = r => {
    const R = fu.runs[r], p = furnProgram(r), top = Math.max(...p.map(q => q[1] - 273.15));
    const head = `<div class="furn-run-h"><b>${FURN_RUNS[r]}</b> <small>${FURN_RUN_WHAT[r]}: ${(p[p.length - 1][0] / 3600).toFixed(1)} h, to ${top.toFixed(0)} °C${fu.runsSet ? '' : ', assumed'}</small></div>`;
    const pend = FURN.pendingFile && FURN.pendingFile.run === r ? `<div class="furn-unit">${dryEsc(FURN.pendingFile.name)}: its time is in <select id="furnUnit"><option value="h">hours</option><option value="min">minutes</option><option value="s">seconds</option></select> <button type="button" class="btn btn-secondary btn-sm" id="furnUnitOk">Use it</button> <button type="button" class="linkish" id="furnUnitNo">Cancel</button></div>` : '';
    if (R.file) return `<div class="furn-run" data-run="${r}">${head}<p class="prop-note">Your file ${dryEsc(R.file.name)}: ${R.file.pts.length} points, its time in ${{ h: 'hours', min: 'minutes', s: 'seconds' }[R.file.unit] || R.file.unit}.</p>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" data-furnclear="${r}">Use steps instead</button><button type="button" class="btn btn-secondary btn-sm" data-furnfile="${r}">${uiIco('upload')}Another file</button></div>${pend}</div>`;
    const inp = (r2, i, k, step, what, unit) => `<input type="number" min="${FURN_STEP_LIMITS[k][0]}" max="${FURN_STEP_LIMITS[k][1]}" step="${step}" value="${R.steps[i][k]}" data-furnstep="${r2}:${i}:${k}" aria-label="${FURN_RUNS[r2]}, step ${i + 1}: ${what}, ${unit}">`;
    const rows = R.steps.map((s, i) => `<div class="furn-step"><span class="furn-sn">${i + 1}</span>${inp(r, i, 'rate', 0.1, 'heating rate', '°C/min')}${inp(r, i, 'to', 10, 'to', '°C')}${inp(r, i, 'hold', 5, 'hold', 'min')}
      ${R.steps.length > 1 ? `<button type="button" class="icon-btn" data-furndelstep="${r}:${i}" title="Remove step ${i + 1}" aria-label="Remove step ${i + 1} of ${FURN_RUNS[r]}">${uiIco('trash')}</button>` : '<span></span>'}</div>`).join('');
    return `<div class="furn-run" data-run="${r}">${head}<div class="furn-step furn-sh" aria-hidden="true"><span></span><span>heat at<small>°C/min</small></span><span>to<small>°C</small></span><span>hold<small>min</small></span><span></span></div>${rows}
      <div class="furn-cool"><label>then cools at <input type="number" min="${FURN_STEP_LIMITS.cool[0]}" max="${FURN_STEP_LIMITS.cool[1]}" step="0.5" value="${R.cool}" data-furncool="${r}" aria-label="${FURN_RUNS[r]}: cooling rate, °C/min"><span class="prop-u">°C/min</span></label></div>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" data-furnadd="${r}">${uiIco('plus')}Add a step</button><button type="button" class="btn btn-secondary btn-sm" data-furnfile="${r}">${uiIco('upload')}Upload a cycle</button></div>${pend}</div>`;
  };
  return `<div class="ovz ovz-furn" id="furnIn"><div class="ovz-h"><span>The furnace <small>two runs in argon</small></span></div>
    <div class="ovz-pic">${furnPicRuns()}</div>
    ${run(0)}${run(1)}
    <input type="file" id="furnFile" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden>
    <p class="prop-note">A cycle's file: two columns, time and temperature (°C), one row per point; its time's unit from its header (h, min or s) or chosen when you upload it.</p>
    <div class="ovz-pic">${furnPicHolder()}</div>
    ${field(0, 'furnN')}${field(1, 'furnPaperT')}${field(2, 'furnMargin')}${field(4, 'furnPlate')}
    <div class="prop"><span class="prop-l">Above the stack${as('roomSet')}</span><div class="seg seg-sm" role="tablist" aria-label="Above the stack in the holder" id="furnRoom">${Object.entries(FURN_ROOM).map(([k, t]) => `<button type="button" role="tab" data-furnroom="${k}" aria-selected="${k === fu.room}">${t}</button>`).join('')}</div></div>
    ${fu.room === 'gap' ? field(3, 'furnGap') : ''}
    <p class="prop-note">One GO piece between each two graphite papers, in the graphite holder with its plates and screw rods; a plate may rest on the stack (its weight presses it; 0 kg: none), and above it a gap to the holder's next plate, or that plate on it. Its top, middle and bottom pieces are followed, each under the weight above it. Once the stack has grown into the gap, it pushes on the plate above.</p>
    ${field(6, 'furnDTload')}
    <p class="prop-note">Every stack sees the runs as set unless you give the load's temperature spread: then its coldest and hottest stacks are solved too, and the batch's spread takes in the stacks' differences.</p>
    <div class="ovz-h"><span>Your limits</span></div>
    ${field(5, 'furnSd')}</div>`;
}
/** Parse a cycle's file into run r (its time's unit from its header, else asked). */
function furnFileIn(r, name, text, unit) {
  const c = fuParseCycle(text, unit || null);
  if (!c.unit && !c.err) return;
  if (!c.pts) {
    if (!c.unit) { FURN.pendingFile = { run: r, name, text }; render(); return; }
    imgToast(`${name}: ${c.err}`, 'error'); return;
  }
  FURN.pendingFile = null;
  undoHint(`${FURN_RUNS[r]}: the cycle from ${name}`);
  const runs = OVEN.furn.runs.map((q, i) => i === r ? { ...q, file: { name, unit: c.unit, pts: c.pts } } : q);
  OVEN.furn = { ...OVEN.furn, runs, runsSet: true };
  render();
}
function wireFurnTree(changed) {
  const fu = () => OVEN.furn, setRuns = (runs, re = true) => { OVEN.furn = { ...fu(), runs, runsSet: true }; if (re) render(); else changed(); };
  document.querySelectorAll('#setupExtra input[data-furnf]').forEach(el => {
    const k = el.dataset.furnf, [, l, u, lo, hi, , , flag] = FURN_FIELDS.find(f => f[0] === k);
    el.addEventListener('change', () => {
      guardNumber(el, { label: l, lo, hi, unit: u, allowEmpty: k === 'dTload' }, v => { OVEN.furn = { ...fu(), [k]: k === 'N' ? Math.round(v) : v, [flag]: v != null }; });
      el.value = fu()[k] ?? '';
      changed();
    });
  });
  document.querySelectorAll('#setupExtra input[data-furnstep]').forEach(el => el.addEventListener('change', () => {
    const [r, i, k] = el.dataset.furnstep.split(':'), [lo, hi] = FURN_STEP_LIMITS[k];
    guardNumber(el, { label: `${FURN_RUNS[+r]}, step ${+i + 1}: ${{ rate: 'heating rate', to: 'temperature', hold: 'hold' }[k]}`, lo, hi, unit: { rate: '°C/min', to: '°C', hold: 'min' }[k] },
      v => setRuns(fu().runs.map((q, j) => j === +r ? { ...q, steps: q.steps.map((s, n) => n === +i ? { ...s, [k]: v } : s) } : q), false));
    el.value = fu().runs[+r].steps[+i][k];
  }));
  document.querySelectorAll('#setupExtra input[data-furncool]').forEach(el => el.addEventListener('change', () => {
    const r = +el.dataset.furncool, [lo, hi] = FURN_STEP_LIMITS.cool;
    guardNumber(el, { label: `${FURN_RUNS[r]}: cooling rate`, lo, hi, unit: '°C/min' }, v => setRuns(fu().runs.map((q, j) => j === r ? { ...q, cool: v } : q), false));
    el.value = fu().runs[r].cool;
  }));
  const box = document.getElementById('furnIn');
  if (!box) return;
  box.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('button');
    if (!t) return;
    if (t.dataset.furnadd != null) { const r = +t.dataset.furnadd, st = fu().runs[r].steps, last = st[st.length - 1]; undoHint(`${FURN_RUNS[r]}: add a step`); setRuns(fu().runs.map((q, j) => j === r ? { ...q, steps: [...q.steps, { rate: last.rate, to: Math.min(3300, last.to + 100), hold: 0 }] } : q)); }
    else if (t.dataset.furndelstep != null) { const [r, i] = t.dataset.furndelstep.split(':').map(Number); undoHint(`${FURN_RUNS[r]}: remove step ${i + 1}`); setRuns(fu().runs.map((q, j) => j === r ? { ...q, steps: q.steps.filter((_, n) => n !== i) } : q)); }
    else if (t.dataset.furnclear != null) { const r = +t.dataset.furnclear; undoHint(`${FURN_RUNS[r]}: steps instead of the file`); setRuns(fu().runs.map((q, j) => j === r ? { ...q, file: null } : q)); }
    else if (t.dataset.furnfile != null) { FURN.fileRun = +t.dataset.furnfile; const f = document.getElementById('furnFile'); f.value = ''; f.click(); }
    else if (t.dataset.furnroom) { OVEN.furn = { ...fu(), room: t.dataset.furnroom, roomSet: true }; render(); }
    else if (t.id === 'furnUnitOk') { const p = FURN.pendingFile; if (p) furnFileIn(p.run, p.name, p.text, document.getElementById('furnUnit').value); }
    else if (t.id === 'furnUnitNo') { FURN.pendingFile = null; render(); }
  });
  const inp = document.getElementById('furnFile');
  if (inp) inp.addEventListener('change', async () => { const f = inp.files && inp.files[0]; if (!f) return; furnFileIn(FURN.fileRun, f.name, await f.text()); });
}

// ---- Materials: the Furnace card ----
function furnCardHTML() {
  return `<section class="mat-card" aria-labelledby="matFurnH">
    <header><h3 id="matFurnH">${uiBadge('oven')}The furnace and the graphene film</h3><button type="button" class="linkish" id="matFurnSee">See it on Process</button></header>
    <div class="mat-head" aria-hidden="true"><span></span><span>Value</span><span>From</span><span>Source</span></div>
    ${Object.entries(MAT_FURN_GROUPS).map(([g, t]) => `<div class="mat-sub"><b>${t}</b></div>${matEditRows(MAT_FURN.filter(q => q[10] === g), MAT.furn, 'mfu', 'matu')}`).join('')}
    <div id="matFurnDerived"></div>
    <div class="mat-actions"><button type="button" class="btn btn-secondary btn-sm" id="matFurnReset">${uiIco('restart')}Defaults</button><span class="mat-count" id="matFurnCount"></span></div>
  </section>`;
}
function furnWireCard() {
  const key = k => MAT_FURN.find(q => q[0] === k);
  view.querySelectorAll('input[type=number][data-mfu]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mfu, [, l, u, lo, hi] = key(k);
    guardNumber(el, { label: l, lo, hi, unit: u }, v => { MAT.furn[k] = { ...MAT.furn[k], v }; });
    el.value = MAT.furn[k].v;
    furnDerived();
  }));
  view.querySelectorAll('select[data-mfu]').forEach(el => el.addEventListener('change', () => {
    const k = el.dataset.mfu; MAT.furn[k] = { ...MAT.furn[k], flag: el.value };
    el.className = `mat-fsel ${MAT_FLAG_CLASS[el.value] || ''}`;
    furnDerived();
  }));
  view.querySelectorAll('input.mat-src[data-mfu]').forEach(el => el.addEventListener('change', () => { const k = el.dataset.mfu; MAT.furn[k] = { ...MAT.furn[k], src: el.value.trim() }; }));
  document.getElementById('matFurnReset').onclick = () => { undoHint('Furnace values back to their defaults'); MAT = { ...MAT, furn: matDefaults().furn }; render(); };
  document.getElementById('matFurnSee').onclick = () => processGo('furn', 'results');
  furnDerived();
}
/** What follows from the Furnace card and the GO's C/O: in place. */
function furnDerived() {
  const f = MAT.furn, c = typeof fuChem === 'function' ? fuChem({ co: MAT.slurry.co.v, hc: f.hc.v, s1: f.s1.v, c1CO2: f.c1CO2.v, c1CO: f.c1CO.v, s2: f.s2.v, c2CO: f.c2CO.v }) : null;
  const rows = [];
  if (c) {
    const keptAfter = n => (1 - c.stages.slice(0, n).reduce((s, q) => s + q.mass, 0) / c.mGO) * 100;
    const coAfter = n => { const O = c.O0 - c.stages.slice(0, n).reduce((s, q) => s + q.O, 0), C = 1 - c.stages.slice(0, n).reduce((s, q) => s + q.C, 0); return O > 1e-9 ? C / O : Infinity; };
    rows.push(['Its weight kept, all its oxygen gone', keptAfter(3).toFixed(1), '% of the dry GO', 'the carbon left: some of it leaves with the oxygen as CO and CO₂']);
    rows.push(['C/O with its labile oxygen gone', coAfter(1).toFixed(1), '', 'after about 300 °C']);
    rows.push(['C/O with its stable oxygen gone too', coAfter(2).toFixed(1), '', 'after about 1000 °C']);
    rows.push(['Its labile oxygen out as CO₂ · CO · water', `${(c.split1.CO2 * 100).toFixed(0)} · ${(c.split1.CO * 100).toFixed(0)} · ${(c.split1.H2O * 100).toFixed(0)}`, '%', c.split1.H2O < 1 - f.c1CO2.v - f.c1CO.v - 1e-9 ? 'its hydrogen runs short of the water set: the rest as CO' : 'as set']);
  }
  rows.push(['Heat along a dense film, graphitized', (f.kG.v * 0.93 * f.La1.v / (f.La1.v + f.ell.v)).toFixed(0), 'W/(m·K)', 'at 2.1 g/cm³ with its crystallites at La graphitized']);
  const der = document.getElementById('matFurnDerived');
  if (der) der.innerHTML = rows.map(([l, v, u, s]) => `<div class="mat-row mat-ro"><span class="mat-l">${l}</span><span class="mat-v"><b>${v}</b><span class="prop-u">${u}</span></span>${matFlagChip('calc')}<span class="mat-src-t" title="${dryEsc(s)}">${s}</span></div>`).join('');
  const cnt = document.getElementById('matFurnCount'), n = fl => MAT_FURN.filter(q => f[q[0]].flag === fl).length;
  if (cnt) cnt.textContent = `${n('given')} from you · ${n('assumed')} assumed · ${n('measured')} measured`;
}
/** The card read-only (the report). */
const furnCardRows = () => MAT_FURN.map(([k, l, u, , , , dd]) => [l, (+MAT.furn[k].v).toFixed(dd), u, MAT.furn[k].flag, MAT.furn[k].src]);
