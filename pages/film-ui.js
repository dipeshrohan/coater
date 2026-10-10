'use strict';
/*
 * film-ui.js — GO-4: the dry film on the fibre web, from the drying to the peel, and the peeled film.
 * Process tab, under the drying (Q62): 5 · The film, peeled off -- which film (the drying's choice), the two ways the
 * water leaves (as the drying, Q53); the checks, each with the picture it was asked with (Q57: cracks, curl, hard to
 * peel or tears, blisters; Q59/Q60: peeled by hand, then the winder at an angle not known; Q64: on the roll its top
 * out); the numbers; along the line the stress at the film's top, the crack risk, blisters; the peel force against the
 * angle; through the film at the peel; the peeled film on a table; a table; CSV; the measured (Q58: curl, cracks,
 * peel force) beside the computed, each read back as the value it implies, with a button to use it.
 * Materials: the Film card. The inputs bar (the oven's zones): after the oven, the stretch to the peel (Q63) and the
 * winder's core (Q61), with their pictures.
 * Solved in a worker (cfd-film-worker.js: drying.js followed to the peel, then film.js).
 */

const FILM = { key: null, pending: null, res: null, busy: false, again: false, error: null, worker: null, id: 0, prog: null, ms: 0 };
/** Stop the film's solve (New, Open): its worker ended. */
function filmStop() { if (FILM.worker) { FILM.worker.terminate(); FILM.worker = null; } Object.assign(FILM, { busy: false, again: false, pending: null, prog: null }); }
const FILM_ASPECT = 0.5;

// ---- the pictures (the ones the questions were asked with, small) ----
const FILM_BROWN = '#8a6a3f', FILM_DARK = '#6b4f2c';
// (each drawn on its own grid, shown at `sc` × its size)
const filmSvg = (w, h, label, body, sc = 1) => `<svg class="dry-pic film-pic" viewBox="0 0 ${w} ${h}" width="${Math.round(w * sc)}" height="${Math.round(h * sc)}" role="img" aria-label="${dryEsc(label)}">${body}</svg>`;
const filmWeb = (y, h, w) => `<rect x="4" y="${y}" width="${w - 8}" height="${h}" fill="var(--fibre)" stroke="var(--line)"/>`;
/** Q57 A: a network of cracks seen from above. */
function filmPicCracks(sc = 1) {
  const w = 132, h = 78;
  const d = ['M8,14 L36,26 L32,52 L12,66', 'M36,26 L68,18 L96,34 L124,22', 'M32,52 L64,56 L96,34', 'M64,56 L70,74', 'M96,34 L112,64 L126,68', 'M112,64 L80,76', 'M68,18 L64,4'];
  return filmSvg(w, h, 'Cracks: a network of cracks, like dried mud, seen from above', `<rect x="4" y="3" width="${w - 8}" height="${h - 6}" rx="3" fill="${FILM_BROWN}"/>${d.map(p => `<path d="${p}" stroke="#2a1d0f" stroke-width="2" fill="none"/>`).join('')}`, sc);
}
/** Q57 B: the free film curling on a table (toward its top: 'top'; away: 'bottom'). */
function filmPicCurl(toward = 'top', sc = 1) {
  const w = 132, h = 78;
  const path = toward === 'top' ? `M12,${h - 10} L78,${h - 10} C104,${h - 10} 112,${h - 36} 102,${h - 52} C94,${h - 64} 80,${h - 58} 84,${h - 44}` : `M12,${h - 10} L78,${h - 10} C100,${h - 10} 118,${h - 18} 124,${h - 34}`;
  return filmSvg(w, h, `Curl: the peeled film ${toward === 'top' ? 'rolls up toward its top' : 'bends away from its top'}`, `<line x1="4" y1="${h - 6}" x2="${w - 4}" y2="${h - 6}" stroke="var(--muted)" stroke-width="1.5"/><path d="${path}" stroke="${FILM_DARK}" stroke-width="5" fill="none" stroke-linecap="round"/>`, sc);
}
/** Q57 C: hard to peel, it tears and leaves bits on the web. */
function filmPicTears(sc = 1) {
  const w = 132, h = 78;
  return filmSvg(w, h, 'Hard to peel or it tears: bits of the film left on the web', `${filmWeb(h - 22, 16, w)}<rect x="4" y="${h - 30}" width="54" height="8" fill="${FILM_BROWN}"/>
    <path d="M58,${h - 26} C74,${h - 26} 88,${h - 40} 96,${h - 58} L106,${h - 74}" stroke="${FILM_DARK}" stroke-width="9" fill="none"/>
    <path d="M54,${h - 30} l4,4 l-4,4 l4,4" stroke="var(--bad)" stroke-width="1.8" fill="none"/>${[70, 84, 100, 116].map(x => `<rect x="${x}" y="${h - 26}" width="${6 + (x % 3) * 2}" height="4" fill="${FILM_BROWN}"/>`).join('')}`, sc);
}
/** Q57 D: bumps and ridges lifting off the web (blisters, wrinkles). */
function filmPicBlisters(sc = 1) {
  const w = 132, h = 78;
  const top = `M4,${h - 30} L20,${h - 30} Q28,${h - 50} 36,${h - 30} L56,${h - 30} Q66,${h - 54} 76,${h - 30} L92,${h - 30} Q98,${h - 42} 104,${h - 30} L${w - 4},${h - 30}`;
  return filmSvg(w, h, 'Blisters or wrinkles: bumps and ridges lifting off the web', `${filmWeb(h - 22, 16, w)}<path d="${top} L${w - 4},${h - 22} L4,${h - 22}Z" fill="${FILM_BROWN}"/><path d="${top}" stroke="${FILM_DARK}" stroke-width="1.5" fill="none"/>`, sc);
}
/** Q59, Q60: peeled by hand (pulled back, about 180°), then taken up by the winder at an angle not known. */
function filmPicPeel(sc = 1) {
  const w = 168, h = 78;
  return filmSvg(w, h, 'Peeled by hand first (pulled back, about 180°), then taken up by the winder (its angle not known: every angle computed)', `${filmWeb(h - 18, 12, w)}<rect x="4" y="${h - 25}" width="70" height="7" fill="${FILM_BROWN}"/>
    <path d="M74,${h - 21} C88,${h - 21} 92,${h - 40} 110,${h - 52} L136,${h - 62}" stroke="${FILM_DARK}" stroke-width="5" fill="none"/>
    <circle cx="146" cy="${h - 64}" r="11" fill="var(--soft)" stroke="var(--muted)" stroke-width="1.5"/><circle cx="146" cy="${h - 64}" r="3" fill="var(--muted)"/>
    <path d="M86,${h - 21} A14,14 0 0 0 96,${h - 31}" stroke="var(--accent)" stroke-width="1.5" fill="none"/><text x="100" y="${h - 22}" font-size="10" fill="var(--accent)" font-weight="600">θ ?</text>
    <path d="M40,${h - 36} L16,${h - 36}" stroke="var(--muted)" stroke-width="1.4"/><path d="M20,${h - 39} L15,${h - 36} L20,${h - 33}" stroke="var(--muted)" stroke-width="1.4" fill="none"/><text x="44" y="${h - 33}" font-size="9" fill="var(--muted)">hand, ${OVEN.peel.peelDeg}°</text>`, sc);
}
/** Q64: on the roll, the film's top (the side that faced the oven's air) out. */
function filmPicRoll(sc = 1) {
  const w = 100, h = 78;
  const cx = 50, cy = 39; let rings = `<circle cx="${cx}" cy="${cy}" r="12" fill="var(--soft)" stroke="var(--muted)" stroke-width="2"/>`;
  for (let k = 0; k < 4; k++) { const r = 15 + k * 6; rings += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--muted)" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="#e8590c" stroke-width="2"/>`; }
  return filmSvg(w, h, 'On the roll: the film\'s top (orange, the side that faced the oven\'s air) faces out', rings, sc);
}
/** Q63: the line from the side -- the oven, a stretch in the room, then the peel and the winder. */
function filmPicPlace(sc = 1) {
  const w = 168, h = 70;
  return filmSvg(w, h, 'After the oven the film runs through the room (a stretch) to where it is peeled and taken up by the winder', `<rect x="4" y="14" width="46" height="32" rx="4" fill="#fde8d8" stroke="#e8590c"/><text x="27" y="34" text-anchor="middle" font-size="10" fill="#9a3412" font-weight="700">oven</text>
    <rect x="4" y="50" width="${w - 8}" height="5" fill="var(--fibre)"/><rect x="4" y="46" width="118" height="4" fill="${FILM_BROWN}"/>
    <path d="M122,48 C128,48 132,36 132,18" stroke="${FILM_DARK}" stroke-width="3.5" fill="none"/><circle cx="132" cy="12" r="8" fill="var(--soft)" stroke="var(--muted)" stroke-width="1.5"/>
    <line x1="50" y1="63" x2="122" y2="63" stroke="var(--accent)" stroke-width="1.5"/><path d="M54,60 L50,63 L54,66 M118,60 L122,63 L118,66" stroke="var(--accent)" stroke-width="1.5" fill="none"/><text x="86" y="60" text-anchor="middle" font-size="9" fill="var(--accent)">the stretch</text>`, sc);
}

// ---- the inputs ----
/** film.js's properties (SI) from the Film card, the Drying card, the fibre web and the winder's core. */
function filmOpts() {
  const f = MAT.film, d = MAT.dry, v = k => f[k].v;
  return {
    film: { Ep: v('Ep') * 1e9, Et: v('Et') * 1e9, nup: v('nup'), nupt: v('nupt'), Gpt: v('Gpt') * 1e9, beta: v('beta'), alphaF: v('alphaF') * 1e-6, Xh: v('Xh'),
      sigF: v('sigF') * 1e6, GcF: v('GcF'), Gil: v('Gil'), Gi: v('Gi'), setFrac: v('setFrac') },
    web: { Ew: v('Ew') * 1e9, nuw: v('nuw'), alphaW: v('alphaW') * 1e-6, tw: P.tf / 1000, soft: v('soft'), nupt: MAT.lib.webNupt.v },
    gel: { Eg: v('Eg') * 1e3, nu: MAT.lib.gelNu.v }, gab: matGab(), rhoS: MAT.slurry.rhoS.v * 1000, rhoL: MAT.slurry.rhoL.v,
    skinK: d.skinK.v * 1e-12, K: 120, core: OVEN.peel.core / 1000, Troom: d.Troom.v, rhRoom: d.rhRoom.v / 100, P: (MAT.dry.pRoom ? MAT.dry.pRoom.v * 1000 : 101325), Tdry: OVEN.peel.dryT,
    // (the curl's lift on a piece as cut; the peel by hand at its angle -- CFG-AUDIT)
    sheet: OVEN.peel.pieceL / 1000, peelDeg: OVEN.peel.peelDeg,
  };
}
/** The drying's inputs followed to the peel: the room stretch after the oven. */
const filmBase = () => ({ ...dryBase(), after: { len: OVEN.peel.len, T: MAT.dry.Troom.v, rh: MAT.dry.rhRoom.v / 100 } });
const filmKeyNow = () => { const f = dryFilms(); return f.length ? JSON.stringify([filmBase(), f, filmOpts()]) : null; };
const filmCurrent = () => !!FILM.res && FILM.key === filmKeyNow();
/** Solve the film for the inputs as they are (in the worker), unless it is solved or being solved. */
function filmRequest() {
  const films = dryFilms();
  if (!films.length) return;
  const base = filmBase(), fo = filmOpts(), key = JSON.stringify([base, films, fo]);
  if (key === FILM.key || key === FILM.pending) { solveTake('film'); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveMay('film')) return;
  if (FILM.busy) { FILM.again = true; return; }
  solveTake('film');
  FILM.busy = true; FILM.again = false; FILM.pending = key; FILM.prog = null;
  if (!FILM.worker) FILM.worker = makeWorker('cfd-film-worker.js');
  const id = ++FILM.id;
  FILM.worker.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.progress) { FILM.prog = m.progress; filmStatusPaint(); return; }
    FILM.busy = false; FILM.pending = null; FILM.key = key;
    if (m.ok) { FILM.res = { runs: m.runs, films, fo }; FILM.error = null; FILM.ms = m.ms; }
    else { FILM.res = null; FILM.error = m.error; }
    if (FILM.again) filmRequest();
    if (tab === 12) render();
  };
  FILM.worker.onerror = e => { FILM.busy = false; FILM.pending = null; FILM.key = key; FILM.res = null; FILM.error = e.message || 'the film worker failed'; if (tab === 12) render(); };
  FILM.worker.postMessage({ id, base, films, fo });
}
/** Wait for the film of the inputs as they are (the report). */
async function filmWait() {
  for (let k = 0; k < 2400; k++) {
    // (Phase 0: not asked for and not solving -- nothing to wait for; the report marks it not solved)
    if (!['film', 'dry', '1d'].some(solveAsked) && !FILM.busy && !DRY.busy && !ONE_D.busy) return filmCurrent();
    if (typeof oneDRequest === 'function') oneDRequest(true);
    filmRequest();
    if (!FILM.busy && filmCurrent()) return true;
    if (!FILM.busy && FILM.error && FILM.key === filmKeyNow()) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}
const filmRuns = key => FILM.res ? ['top', 'both'].map(w => FILM.res.runs.find(r => r.key === key && r.where === w)) : [null, null];
/** The peel at an angle d (°): the computed angles' own, or between the two either side of it (the force linear in
 *  between; it tears there when either does). */
const filmAngle = (r, d) => {
  const a = r.peel.byAngle, j = a.findIndex(q => q.deg >= d);
  if (j < 0) return a[a.length - 1];
  if (j === 0 || a[j].deg === d) return a[j];
  const p = a[j - 1], q = a[j], w = (d - p.deg) / (q.deg - p.deg);
  return { deg: d, f: p.f + w * (q.f - p.f), sFront: p.sFront + w * (q.sFront - p.sFront), tears: p.tears || q.tears };
};
const filmN = v => v == null || !Number.isFinite(v) ? '—' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
/** A curvature (1/m) as a radius and which way: its top concave (κ < 0) rolls toward its top. */
const filmCurlText = k => !Number.isFinite(k) || Math.abs(k) < 1e-6 ? 'flat' : `${(1000 / Math.abs(k)).toFixed(0)} mm, ${k < 0 ? 'toward its top' : 'away from its top'}`;
/** A sheet of length L (m) lying on a table curled to κ: how far its edges lift (m). */
const filmLift = (k, L) => { if (!Number.isFinite(k) || Math.abs(k) < 1e-9) return 0; const R = 1 / Math.abs(k); return L / 2 < Math.PI * R ? R * (1 - Math.cos(L / (2 * R))) : 2 * R; };
/** The sheet length the lift is shown for: a measured curl's, else 100 mm. */
const filmSheet = key => { const q = (MAT.filmMeas.curl || []).find(c => c.loc === key && Number.isFinite(c.sheet)); return q ? q.sheet / 1000 : OVEN.peel.pieceL / 1000; };   // (none measured: a piece as cut)
/** Its curl unwound from the roll, settled: the settled curl and what the roll set (the Film card's share of the roll's bend). */
const filmUnwound = r => r.curl.settled.kappa + r.roll.set;
const FILM_WHEN = { settled: 'settled', peel: 'right after peeling', roll: 'unwound from the roll' };

// ---- the chain's line ----
function filmStage() {
  if (FILM.busy) return { st: 'busy', s: 'the film from the drying to the peel…' };
  if (!filmCurrent()) return FILM.error && FILM.key === filmKeyNow() ? { st: 'failed', s: FILM.error } : { st: 'todo', s: 'its stress, cracks, the peel and its curl (below)' };
  const [t, b] = filmRuns('web');
  if (!t || !b) return { st: 'todo', s: 'its stress, cracks, the peel and its curl (below)' };
  const cr = [t, b].some(r => r.worst && r.worst.ratio >= 1), wet = [t, b].some(r => r.wetAtPeel);
  return { st: 'solved', s: `the web: ${wet ? 'not dry at the peel; ' : ''}${cr ? 'cracks' : 'no cracks'}; peel by hand ${filmN(t.peel.hand.f)} · ${filmN(b.peel.hand.f)} N/m; curl ${filmCurlText(t.curl.settled.kappa)}` };
}

// ---- the Process tab's section ----
/** The film stage's parts, one at a time -- the film peeled off, a piece cut from it in 3D, the pieces in the pressed stack;
 *  WF-2: each part is a tab of its own (4 Peel and wind, 5 Cutting, 6 Pre heat treatment): its title, and the rows of After the
 *  oven it sets (the stretch to the peel and the winder's core; the pieces' size; the pre heat treatment). */
/** The Results step's views (task 13, the viewer): listed left, one shown. */
const FILM_VIEWS = [['filmChecks', 'The six checks'], ['fm1', 'Stress at its top'], ['fm2', 'Crack risk'], ['fm3', 'Peel force'], ['fm4', 'Through it at the peel'], ['fm5', 'Blister risk'], ['fm6', 'On a table'], ['filmTable', 'Every location'], ['filmMeas', 'Measured']];
const FILM_PART = { film: [4, 'The film, peeled off', ['len', 'core']], piece: [5, 'A piece cut from the roll', ['pieceL', 'pieceW']], stack: [6, 'The pieces in the pressed stack', ['dryT', 'tOven', 'tRest', 'plateT', 'stackAirU', 'epsPl']] };
const filmPartOf = k => Object.keys(FILM_PART).find(v => FILM_PART[v][2].includes(k)) || 'film';
function filmSectionHTML() {
  const seg = [...CFD_LOCS.map((l, i) => [`L${i + 1}`, `<i class="loc-dot" style="background:${locColor(i)}"></i>L${i + 1}`]), ['web', 'The web']];
  const pane = (id, icon, title, aria) => `<figure class="pane dry-pane rv-view" data-rvid="${id}" hidden><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="dry-sec film-sec" id="filmSec" aria-labelledby="filmH" data-fview="${FILM.view || 'film'}">
    <header class="dry-head"><h3 id="filmH">${uiBadge('film')}${FILM_PART[FILM.view || 'film'][0]} · ${FILM_PART[FILM.view || 'film'][1]}</h3>
      <div class="seg" role="tablist" aria-label="Which film" id="filmSel">${seg.map(([k, t]) => `<button type="button" role="tab" data-film="${k}" aria-selected="${k === DRY.sel}">${t}</button>`).join('')}</div>
      <span class="vp-spacer"></span><button type="button" class="btn btn-secondary btn-sm" id="filmPeelBtn" data-chain="peel" title="${{ film: 'After the oven: the stretch to the peel and the winder\'s core', piece: 'The pieces\' size', stack: 'The pre heat treatment: its temperature and times' }[FILM.view || 'film']}, in the inputs bar">${uiIco('oven')}${{ film: 'After the oven', piece: 'The pieces cut', stack: 'The pre heat treatment' }[FILM.view || 'film']}</button><button type="button" class="btn btn-secondary btn-sm" id="filmCsv">Export CSV</button></header>
    <div class="furn-block" data-pstep="setup"><div class="furn-bh"><h4>After the oven</h4></div>
      <table class="proc-kv"><tbody>${OVEN_PEEL_FIELDS.map(([k, l, u, , , , dg]) => `<tr data-fview="${filmPartOf(k)}"><th>${l}</th><td>${(+OVEN.peel[k]).toFixed(dg)} ${u}</td></tr>`).join('')}
        <tr data-fview="stack"><th>What it stands on</th><td>${OVEN_SHELVES[OVEN.peel.shelf]}</td></tr></tbody></table>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" data-chain="peel">${uiIco('oven')}Change them (inputs bar)</button></div></div>
    <div class="dry-ways" data-pstep="setup" data-fview="film">${['top', 'both'].map(w => `<div class="dry-way">${dryWaySketch(w)}<span><b>${DRY_WAYS[w]}</b><i class="lg-ln${w === 'both' ? ' dash' : ''}" style="--c:var(--ink)"></i>${w === 'both' ? 'dashed' : 'solid'} in the charts</span></div>`).join('')}
      <p class="fv-why">As the drying: where the water leaves decides when each layer of the film sets and how wet it is, so both are followed to the peel.</p></div>
    <div id="filmState" data-pstep="solve results" data-fview="film"></div>
    <div class="rv" data-rvkey="film" data-pstep="results" data-fview="film">
      <nav class="rv-list" role="tablist" aria-label="The view shown"><h5>Results</h5>${FILM_VIEWS.map(([id, t], i) => `<button type="button" role="tab" data-rvview="${id}" aria-selected="${!i}">${t}</button>`).join('')}</nav>
      <div class="rv-main">
        <div class="rv-view rv-extra" data-rvid="filmChecks"><h4 class="oned-h">The six checks</h4><div class="film-checks" id="filmChecks"></div><div class="pane-legend"><p class="fv-why">Cracks and blisters: the most a crack (a blister) releases against the film's fracture energy (its hold on the web): 1× and above, they form. Along the line from the oven's entry (m); negative: before it.</p></div></div>
        ${pane('fm1', 'film', 'Stress at the film\'s top', 'The stress in the film\'s top against position along the line')}
        ${pane('fm2', 'cut', 'Crack risk', 'A crack\'s energy against the film\'s fracture energy along the line')}
        ${pane('fm3', 'shear', 'Peel force against the angle', 'The force per width to peel the film off the web against the peel angle, with measured peel forces')}
        ${pane('fm4', 'film', 'Through the film at the peel', 'The stress through the film\'s height where it is peeled')}
        ${pane('fm5', 'wave', 'Blister risk', 'A blister\'s energy against the film\'s hold on the web along the line')}
        ${pane('fm6', 'radius', 'The peeled film on a table', 'The peeled sheet drawn curled as computed, right after peeling and settled in the room')}
        <div class="rv-view rv-extra rv-wide" data-rvid="filmTable" id="filmTable" hidden></div>
        <div class="rv-view rv-extra" data-rvid="filmMeas" id="filmMeas" hidden></div>
      </div>
      <aside class="rv-keys" aria-label="Key values"><h5>Key values</h5><table class="rv-kv" id="filmKeys"></table></aside>
    </div>
    <div data-pstep="results">${typeof sheetSectionHTML === 'function' ? sheetSectionHTML() : ''}</div>
    ${PROC_ALL && typeof mpStackHTML === 'function' ? `<div data-fview="stack">${mpStackHTML()}</div>` : ''}
    <p class="fv-note" id="filmNote" data-pstep="solve"></p>
  </section>`;
}
function filmStatusPaint() {
  const el = document.getElementById('filmState');
  if (!el) return;
  if (FILM.busy) { const p = FILM.prog; el.innerHTML = `<p class="dry-msg">${pill(p ? `The film: ${p.key === 'web' ? 'the web' : p.key}, ${p.where === 'top' ? 'top only' : 'top and bottom'} (${p.k + 1} of ${p.n}), dried to the peel, then its stress, cracks and peel…` : 'The film…', '')}</p>`; }
}
function filmRender() {
  const sec = document.getElementById('filmSec');
  if (!sec) return;
  if (!sec.dataset.wired) filmWire(sec);
  if (typeof rvSync === 'function') rvSync(sec.querySelector('.rv[data-rvkey="film"]'));   // (the view picked shown, before it draws)
  if (typeof sheetRender === 'function') sheetRender();   // (the piece in 3D, GO-4d: after the film, the film shown)
  // (the stack's multiphysics, MP-1: its own pages, MP-W; for the report, every view open, drawn too once solved -- then it
  //  asks nothing of its solver)
  if (typeof mpStackRender === 'function' && PROC_ALL && mpCurrent(MPS.dim)) mpStackRender();
  sec.querySelectorAll('[data-film]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.film === DRY.sel)));
  const st = document.getElementById('filmState');
  if (!dryFilms().length) { st.innerHTML = `<p class="dry-msg">${solvePending('film') ? pill('Solving the 1D and the drying first: the film starts from the wet film', '') : solveCtl('film') + ' <span class="fv-why">(the 1D and the drying first: the film starts from the wet film)</span>'}</p>`; filmClear(); return; }
  filmRequest();
  if (!filmCurrent()) {
    if (FILM.busy) filmStatusPaint();
    else if (FILM.error) st.innerHTML = `<p class="dry-msg">${pill('The film could not be solved: ' + dryEsc(FILM.error), 'bad')}</p>`;
    else st.innerHTML = `<p class="dry-msg">${solvePending('film') ? pill('Solving the film…', '') : solveCtl('film')}</p>`;
    if (!FILM.res) { filmClear(); return; }
    st.insertAdjacentHTML('beforeend', `<p class="dry-msg">${pill('Showing the film for the previous inputs', 'warn')}</p>`);
  } else st.innerHTML = '';
  if (!FILM.res.runs.some(r => r.key === DRY.sel)) { filmClear(); return; }
  const [rt, rb] = filmRuns(DRY.sel);
  if (!rt || !rb) { filmClear(); return; }
  st.insertAdjacentHTML('beforeend', procAnswerHTML(filmStage().s, filmWarnings(rt, rb)));
  filmChecks(rt, rb);
  filmStats(rt, rb);
  filmCharts(rt, rb);
  filmTable();
  filmMeasured(rt, rb);
  document.getElementById('filmNote').innerHTML = filmNoteText();
  if (typeof rvAfter === 'function') rvAfter();
}
function filmClear() {
  ['filmChecks', 'filmKeys', 'filmTable', 'filmNote'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  paneEmptyIds(['fm1', 'fm2', 'fm3', 'fm4', 'fm5', 'fm6'], paneWhy('film'));
  filmMeasured(null, null);
  if (typeof rvAfter === 'function') rvAfter();
}
function filmWire(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-film]');
    if (b) { DRY.sel = b.dataset.film; if (typeof dryRender === 'function') dryRender(); filmRender(); return; }
    const del = e.target.closest && e.target.closest('[data-filmdel]');
    if (del) { const [kind, idx] = del.dataset.filmdel.split(':'); filmMeasRemove(kind, +idx); return; }
    const use = e.target.closest && e.target.closest('[data-filmuse]');
    if (use) { const [k, v, what] = use.dataset.filmuse.split('|'); filmUse(k, +v, what); }
  });
  document.getElementById('filmCsv').onclick = filmExportCSV;
}
function filmWarnings(rt, rb) {
  const w = [];
  const wet = [[rt, 'top only'], [rb, 'top and bottom']].filter(([r]) => r.wetAtPeel);
  if (wet.length) w.push(pill(`Not dry at the peel (${wet.map(([r, n]) => `${n}: ${r.atPeel.waterPct.toFixed(0)} % water`).join(', ')}): its middle is still wet paste, so it cannot come off as a film. What is shown is the dry part's`, 'bad'));
  return w.length ? `<div class="dry-warn">${w.join('')}</div>` : '';
}
/** The checks, each with the picture it was asked with: its verdict for both ways. */
function filmChecks(rt, rb) {
  const F = MAT.film, both = f => `<span class="film-v"><b>top only</b> ${f(rt)}</span><span class="film-v"><b>top and bottom</b> ${f(rb)}</span>`;
  const bad = t => `<span class="warn-text">${t}</span>`;
  const crack = r => !r.worst ? 'nowhere in tension' : r.worst.ratio >= 1 ? bad(`cracks at ${dryPlace(r.worst.x)} (${r.worst.which === 'float' ? 'the skin over the wet film' : 'the film on the web'}; ${r.worst.ratio.toFixed(1)}× its toughness)${r.spacing ? `, ${(r.spacing.lo * 1000).toFixed(1)}–${(r.spacing.hi * 1000).toFixed(1)} mm apart` : ''}`) : `no cracks (at most ${r.worst.ratio.toFixed(2)}× its toughness, at ${dryPlace(r.worst.x)})`;
  const peel = r => r.peel.selfPeel ? bad('comes off by itself: its stored stress beats its hold on the web') : `by hand ${filmN(r.peel.hand.f)} N/m; at the winder ${filmN(filmAngle(r, OVEN.peel.windHi).f)} (${OVEN.peel.windHi}°) to ${filmN(filmAngle(r, OVEN.peel.windLo).f)} N/m (${OVEN.peel.windLo}°)`;
  const tear = r => { const t = r.peel.byAngle.filter(q => q.tears); return t.length ? bad(`tears when peeled at ${t[0].deg}°–${t[t.length - 1].deg}° (the pull and the bend at the peel front beat its strength)`) : r.peel.bits ? bad('leaves bits: its hold on the web is more than its layers\' hold on each other') : 'peels cleanly'; };
  const curl = r => { const L = filmSheet(DRY.sel) * 1000; return `${filmCurlText(r.curl.atPeel.kappa)} right after; ${filmCurlText(r.curl.settled.kappa)} settled (a ${L.toFixed(0)} mm sheet's edges lift ${(filmLift(r.curl.settled.kappa, L / 1000) * 1000).toFixed(1)} mm)`; };
  const unw = r => `; unwound, ${F.setFrac.v > 0 ? `it curls ${filmCurlText(filmUnwound(r))} (it keeps ${(F.setFrac.v * 100).toFixed(0)} % of the roll's bend)` : 'it springs back to its settled curl (the Film card\'s curl the roll sets is 0)'}`;
  const roll = r => (r.roll.cracks ? bad(`cracks on the roll: bent round the ${OVEN.peel.core} mm core its top reaches ${(r.roll.sMax / 1e6).toFixed(0)} MPa, over its ${F.sigF.v} MPa strength`) : `holds: at most ${(r.roll.sMax / 1e6).toFixed(0)} of its ${F.sigF.v} MPa strength`) + unw(r);
  const blis = r => { const m = r.blisters.max, s = r.blisters.steam; return (m.ratio >= 1 ? bad(`blisters: compressed on the web it buckles off (${m.ratio.toFixed(1)}× its hold, at ${dryPlace(m.x)}; ${(m.bMin * 2000).toFixed(0)} mm and wider)`) : `no buckling off the web (${m.ratio.toFixed(2)}× its hold)`) + (s ? `; ${bad(`steam under the skin at ${dryPlace(s.x)} (${(s.dp / 1000).toFixed(0)} kPa over the air)`)}` : ''); };
  const card = (pic, title, body) => `<div class="film-check">${pic}<div><h4>${title}</h4>${body}</div></div>`;
  document.getElementById('filmChecks').innerHTML = [
    card(filmPicCracks(), 'Cracks', both(crack)),
    card(filmPicPeel(), 'Peeling (force per width)', both(peel)),
    card(filmPicTears(), 'Tears or bits left', both(tear)),
    card(filmPicCurl(rt.curl.settled.kappa < 0 ? 'top' : 'bottom'), 'Curl after peeling', both(curl)),
    card(filmPicRoll(), 'On the roll (its top out)', both(roll)),
    card(filmPicBlisters(), 'Blisters or wrinkles', both(blis)),
  ].join('');
}
/** The key values (the viewer's right-hand column): a row each, a value for each way the water leaves; cracks, blisters,
 * the roll and a wet film marked as the checks and the warnings mark them. */
function filmStats(rt, rb) {
  const F = MAT.film, mm = s => s ? `${(s.lo * 1000).toFixed(1)}–${(s.hi * 1000).toFixed(1)} mm` : '—';
  const rows = [
    ['Cracks', r => `${(r.worst ? r.worst.ratio : 0).toFixed(2)}×`, r => r.worst && r.worst.ratio >= 1 && 'rv-warn', 'the most a crack releases against the film\'s fracture energy: 1× and above, they form'],
    ['Crack spacing', r => mm(r.spacing)],
    [`Peel by hand (${OVEN.peel.peelDeg}°)`, r => `${filmN(r.peel.hand.f)} N/m`, r => r.peel.selfPeel && 'rv-warn', 'the force per width'],
    ['Peel at 90°', r => `${filmN(filmAngle(r, 90).f)} N/m`, null, 'the force per width'],
    ['Curl radius, settled', r => { const k = r.curl.settled.kappa; return Math.abs(k) < 1e-6 ? 'flat' : `${(1000 / Math.abs(k)).toFixed(0)} mm`; }],
    ['On the roll', r => `${(r.roll.sMax / 1e6).toFixed(0)} MPa`, r => r.roll.cracks && 'rv-warn', `bent round the core; the film's strength ${F.sigF.v} MPa`],
    ['Blisters', r => `${r.blisters.max.ratio.toFixed(2)}×`, r => r.blisters.max.ratio >= 1 && 'rv-warn', 'the most a blister releases against the film\'s hold on the web: 1× and above, they form'],
    ['Water at the peel', r => `${r.atPeel.waterPct.toFixed(1)} %`, r => r.wetAtPeel && 'rv-bad', 'of the GO'],
  ];
  document.getElementById('filmKeys').innerHTML = `<thead><tr><th scope="col"></th><th scope="col">Top only</th><th scope="col">Top and bottom</th></tr></thead>
    <tbody>${rows.map(([l, f, mark, sub]) => `<tr${sub ? ` title="${l}: ${sub}"` : ''}><th scope="row">${l}</th>${[rt, rb].map(r => { const c = mark && mark(r); return `<td${c ? ` class="${c}"` : ''}>${f(r)}</td>`; }).join('')}</tr>`).join('')}</tbody>`;
}

/** The charts: along the line (both ways, solid and dashed), the peel force against the angle, through the film, the peeled sheet. */
function filmCharts(rt, rb) {
  const col = dryFilmColor(DRY.sel), mut = cssVar('--muted'), soft = cssVar('--soft'), bad = cssVar('--bad'), okc = cssVar('--ok'), acc = cssVar('--accent');
  const ways = [[rt, []], [rb, [6, 4]]], F = MAT.film;
  const x0 = Math.min(rt.line[0].x, rb.line[0].x), x1 = Math.max(rt.peelX, rb.peelX);
  const bands = [], zx = [0];
  if (x0 < 0) bands.push({ x0, x1: 0, c: soft });
  OVEN.zones.forEach((z, i) => { const a = zx[zx.length - 1]; zx.push(a + z.len); if (i % 2) bands.push({ x0: a, x1: a + z.len, c: soft }); });
  bands.push({ x0: rt.ovenX, x1, c: soft });
  const vl = [...(x0 < 0 ? [{ x: 0, c: mut, t: 'oven' }] : []), { x: rt.ovenX, c: mut, t: 'exit' }];
  const common = { x0, x1, xl: 'along the line (m)', xticks: dryTicks(x0, x1), xf: v => `${+v.toFixed(2)}`, bands };
  const cv = id => document.getElementById(id);
  const lg = (id, items) => { const el = document.getElementById(id + 'Lg'); if (el) el.innerHTML = oneDLegend(items); };
  // 1. the stress at the film's top: the floating skin's top while there is one, else the bonded film's top
  const topS = q => (q.sTopF != null ? q.sTopF : q.sTopB);
  const sAll = ways.flatMap(([r]) => r.line.map(q => topS(q))).filter(Number.isFinite).map(v => v / 1e6);
  const shi = Math.max(10, ...sAll, 0) * 1.15, slo = Math.min(0, ...sAll) * 1.15;
  plotChart(cv('fm1'), FILM_ASPECT, { ...common, y0: slo, y1: Math.max(shi, Math.min(F.sigF.v * 1.1, shi * 3)), yl: 'stress (MPa, tension +)', yd: 0, vl,
    hl: [{ y: 0, c: mut, t: '' }, ...(F.sigF.v < Math.max(shi, Math.min(F.sigF.v * 1.1, shi * 3)) ? [{ y: F.sigF.v, c: bad, t: `its strength (${F.sigF.v} MPa)`, left: true, below: true }] : [])],
    s: ways.map(([r, dash]) => ({ p: r.line.filter(q => Number.isFinite(topS(q))).map(q => [q.x, topS(q) / 1e6]), c: col, w: 2, dash })) });
  lg('fm1', [[`${dryFilmName(DRY.sel)}: its top`, col], ['top and bottom', col, 'dash']]);
  // 2. the crack risk at the places the FEM looked (the skin over the wet film; the film on the web)
  const pts = (r, w) => r.stations.filter(S => S[w]).map(S => [S.x, S[w].ratio]);
  const rMax = Math.max(1.2, ...ways.flatMap(([r]) => [...pts(r, 'float'), ...pts(r, 'bond')].map(p => p[1])));
  plotChart(cv('fm2'), FILM_ASPECT, { ...common, y0: 0, y1: rMax * 1.1, yl: 'crack energy / toughness', yd: 1, vl,
    hl: [{ y: 1, c: bad, t: 'cracks above 1', left: true }],
    s: ways.flatMap(([r, dash]) => [{ p: pts(r, 'float'), c: acc, w: 1.6, dash, dots: true }, { p: pts(r, 'bond'), c: col, w: 1.6, dash, dots: true }]) });
  lg('fm2', [['the skin over the wet film', acc], ['the film on the web', col], ['top and bottom', mut, 'dash']]);
  // 3. the peel force against the angle (the hand's 180°; the winder's not known); measured peel forces
  const meas = (MAT.filmMeas.peel || []).filter(q => q.loc === DRY.sel && Number.isFinite(q.f) && Number.isFinite(q.angle) && q.f > 0);
  const okF = q => Number.isFinite(q.f) && q.f > 0, allF = [...ways.flatMap(([r]) => r.peel.byAngle.filter(okF).map(q => q.f)), ...meas.map(q => q.f)];
  if (!allF.length) allF.push(1, 10);   // (nothing to show: an axis from 1 to 10 N/m)
  const lgf = v => Math.log10(v), fLo = lgf(Math.min(...allF) / 1.4), fHi = lgf(Math.max(...allF) * 1.4), dec = fHi - fLo;
  const mults = dec > 2.5 ? [1] : dec > 1.2 ? [1, 3] : [1, 2, 5], fTicks = [];
  for (let k = Math.floor(fLo); k <= Math.ceil(fHi); k++) for (const mm of mults) { const v = lgf(mm) + k; if (v >= fLo && v <= fHi) fTicks.push(v); }
  plotChart(cv('fm3'), FILM_ASPECT, { x0: 0, x1: 180, xl: 'peel angle (°)', xticks: [0, 30, 60, 90, 120, 150, 180], xf: v => `${v}`, y0: fLo, y1: fHi, yticks: fTicks,
    yf: v => { const f = 10 ** v; return f >= 10 ? f.toFixed(0) : String(+f.toPrecision(2)); }, yl: 'force per width (N/m, log scale)',
    vl: [{ x: 180, c: mut, t: 'by hand' }],
    s: [...ways.map(([r, dash]) => ({ p: r.peel.byAngle.filter(okF).map(q => [q.deg, lgf(q.f)]), c: col, w: 2, dash })),
      ...ways.map(([r]) => ({ p: r.peel.byAngle.filter(q => q.tears && okF(q)).map(q => [q.deg, lgf(q.f)]), c: bad, line: false, dots: true })).filter(s => s.p.length),
      ...(meas.length ? [{ p: meas.map(q => [q.angle, lgf(q.f)]), c: okc, line: false, dots: true }] : [])] });
  lg('fm3', [[dryFilmName(DRY.sel), col], ['top and bottom', col, 'dash'], ...(ways.some(([r]) => r.peel.byAngle.some(q => q.tears)) ? [['tears', bad, 'dot']] : []), ...(meas.length ? [['measured', okc, 'dot']] : [])]);
  // 4. through the film at the peel: each set layer's stress against its height over the web
  const prof = r => r.profile.cells.flatMap(c => [[c.sig / 1e6, c.z0 * 1e6], [c.sig / 1e6, (c.z0 + c.t) * 1e6]]);
  const pAll = ways.flatMap(([r]) => prof(r)), sx = pAll.map(p => p[0]), hz = pAll.map(p => p[1]);
  const pl = Math.min(0, ...sx), ph = Math.max(1, ...sx), span = ph - pl;
  plotChart(cv('fm4'), FILM_ASPECT, { x0: pl - 0.05 * span, x1: ph + 0.05 * span, xl: 'stress (MPa, tension +)', xd: 0, y0: 0, y1: Math.max(1, ...hz) * 1.05, yl: 'height over the web (µm)', yd: 0,
    vl: [{ x: 0, c: mut, t: '' }], s: ways.map(([r, dash]) => ({ p: prof(r), c: col, w: 2, dash })) });
  lg('fm4', [[`at the peel (${rt.peelX.toFixed(2)} m), bonded on the web`, col], ['top and bottom', col, 'dash']]);
  // 5. blister risk along the line
  const bl = ways.flatMap(([r]) => r.blisterLine.map(q => q.ratio)), bHi = Math.max(1.2, ...bl) * 1.1;
  plotChart(cv('fm5'), FILM_ASPECT, { ...common, y0: 0, y1: bHi, yl: 'blister energy / hold', yd: 1, vl, hl: [{ y: 1, c: bad, t: 'blisters above 1', left: true }],
    s: ways.map(([r, dash]) => ({ p: r.blisterLine.map(q => [q.x, q.ratio]), c: col, w: 2, dash })) });
  lg('fm5', [['the film on the web, compressed', col], ['top and bottom', col, 'dash']]);
  // 6. the peeled sheet on a table (to scale)
  drawFilmSheet(cv('fm6'), rt, rb, col);
  lg('fm6', [['right after peeling (top only)', col], ['settled in the room', col, 'dash'], ['top and bottom, settled', mut, 'dash'], ...(MAT.film.setFrac.v > 0 ? [['unwound from the roll', cssVar('--warn'), 'dot']] : [])]);
}
/**
 * A sheet of the film lying on a table, curled as computed: curling toward its top it rests on its middle, its edges
 * up; away from its top it rests on its edges, its middle up. Along it to scale; heights exaggerated (said) when small.
 */
function drawFilmSheet(cv, rt, rb, col) {
  const { c, w, h } = setupCanvas(cv, FILM_ASPECT), mut = cssVar('--muted'), ink = cssVar('--ink');
  const L = filmSheet(DRY.sel), pad = 30, sc = (w - 2 * pad) / L, y0 = h - 30;
  const curves = [[rt.curl.atPeel.kappa, col, []], [rt.curl.settled.kappa, col, [6, 4]], [rb.curl.settled.kappa, mut, [3, 3]], ...(MAT.film.setFrac.v > 0 ? [[filmUnwound(rt), cssVar('--warn'), [1, 3]]] : [])];
  // the shape: height above the table at s (−L/2 .. L/2)
  const shape = k => { const n = 80, out = [];
    const R = Math.abs(k) > 1e-9 ? 1 / Math.abs(k) : Infinity, top = Number.isFinite(R) ? R * (1 - Math.cos(Math.min(Math.PI, L / 2 / R))) : 0;
    for (let i = 0; i <= n; i++) { const s = -L / 2 + L * i / n; let x = s, y = 0;
      if (Number.isFinite(R)) { const a = s / R; x = R * Math.sin(a); y = R * (1 - Math.cos(a)); }
      out.push([x, k < 0 ? y : top - y]); }
    return out; };
  const shapes = curves.map(([k]) => shape(k)), hiY = Math.max(1e-9, ...shapes.flat().map(p => p[1]));
  const room = (y0 - 40) / sc, ex = Math.max(1, Math.min(50, Math.floor(0.6 * room / hiY)));
  c.strokeStyle = mut; c.lineWidth = 1.5; c.beginPath(); c.moveTo(10, y0); c.lineTo(w - 10, y0); c.stroke();
  c.fillStyle = mut; c.font = '11px ' + cssVar('--sans'); c.textAlign = 'left'; c.fillText('table', 12, y0 + 16);
  curves.forEach(([, colr, dash], j) => {
    c.strokeStyle = colr; c.setLineDash(dash); c.lineWidth = 3; c.beginPath();
    shapes[j].forEach(([x, y], i) => { const px = w / 2 + x * sc, py = y0 - 2 - y * ex * sc; i ? c.lineTo(px, py) : c.moveTo(px, py); });
    c.stroke(); c.setLineDash([]);
  });
  c.fillStyle = ink; c.textAlign = 'center';
  c.fillText(`a ${(L * 1000).toFixed(0)} mm sheet${ex > 1 ? `, heights ×${ex}` : ', to scale'}; settled its edges lift ${(filmLift(rt.curl.settled.kappa, L) * 1000).toFixed(1)} mm (top only)`, w / 2, 16);
}

/** The table: every film, both ways, with the measured beside them. */
function filmTable() {
  const host = document.getElementById('filmTable');
  const films = FILM.res.films;
  const rows = films.map(f => {
    const [rt, rb] = filmRuns(f.key);
    if (!rt || !rb) return '';
    const one = (r, w) => `<tr${f.key === DRY.sel ? ' class="sel"' : ''}><th scope="row">${w === 'top' ? `<i class="loc-dot" style="background:${dryFilmColor(f.key)}"></i>${f.key === 'web' ? 'The web' : f.key} <small>${(f.h0 * 1000).toFixed(3)} mm wet</small>` : ''}</th>
      <td>${w === 'top' ? 'top only' : 'top and bottom'}</td><td>${r.atPeel.waterPct.toFixed(1)} %${r.wetAtPeel ? ' <small class="warn-text">wet</small>' : ''}</td>
      <td>${r.worst ? `${r.worst.ratio.toFixed(2)}× <small>${dryPlace(r.worst.x)}</small>` : '—'}</td><td>${r.spacing ? `${(r.spacing.lo * 1000).toFixed(1)}–${(r.spacing.hi * 1000).toFixed(1)}` : '—'}</td>
      <td>${filmN(r.peel.hand.f)}</td><td>${filmN(filmAngle(r, 90).f)}</td><td>${r.peel.byAngle.some(q => q.tears) ? '<span class="warn-text">tears</span>' : r.peel.bits ? '<span class="warn-text">bits</span>' : 'clean'}</td>
      <td>${Math.abs(r.curl.settled.kappa) < 1e-6 ? 'flat' : (1000 / Math.abs(r.curl.settled.kappa)).toFixed(0)}</td><td>${(r.roll.sMax / 1e6).toFixed(0)}${r.roll.cracks ? ' <small class="warn-text">cracks</small>' : ''}</td><td>${r.blisters.max.ratio.toFixed(2)}×</td></tr>`;
    const m = filmMeasRows(f.key);
    return one(rt, 'top') + one(rb, 'both') + m;
  }).join('');
  host.innerHTML = `<h3 class="oned-h">The film at each location</h3><div class="oned-scroll"><table class="cfd-table dry-table film-table">
    <thead><tr><th>Film</th><th>Water leaves</th><th>Water at the peel <small>% of the GO</small></th><th>Cracks <small>× toughness</small></th><th>Crack spacing <small>mm</small></th><th>Peel by hand <small>N/m, 180°</small></th><th>Peel at 90° <small>N/m</small></th><th>Peels</th><th>Curl radius <small>mm, settled</small></th><th>On the roll <small>MPa</small></th><th>Blisters <small>× hold</small></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
/** A film's measured values as table rows (under its computed ones). */
function filmMeasRows(key) {
  const m = MAT.filmMeas, out = [];
  for (const q of (m.cracks || []).filter(q => q.loc === key)) out.push(`<tr class="meas"><th scope="row"></th><td>measured cracks${q.where ? ` <small>${{ web: 'on the web', peel: 'after peeling', roll: 'on the roll' }[q.where]}</small>` : ''}</td><td>—</td><td>seen</td><td>${Number.isFinite(q.spacing) ? q.spacing : '—'}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`);
  for (const q of (m.peel || []).filter(q => q.loc === key)) out.push(`<tr class="meas"><th scope="row"></th><td>measured peel <small>at ${q.angle}°</small></td><td>—</td><td>—</td><td>—</td><td>${q.angle === 180 ? q.f : '—'}</td><td>${q.angle === 90 ? q.f : '—'}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`);
  for (const q of (m.curl || []).filter(q => q.loc === key)) { const k = filmCurlKappa(q); out.push(`<tr class="meas"><th scope="row"></th><td>measured curl</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>${Number.isFinite(k) ? (1000 / Math.abs(k)).toFixed(0) : '—'}</td><td>—</td><td>—</td></tr>`); }
  return out.join('');
}
function filmNoteText() {
  const f = MAT.film;
  return `Each film is followed from the blade through the room, the oven (as the drying above) and the room after it (${OVEN.peel.len} m) to where it is peeled. A layer of the film sets when a skin's front passes it, carrying stress from then on: it shrinks as it dries (β ${f.beta.v} per kg of water per kg of GO) and the web expands with the heat; a skin over wet film floats (the paste under it cannot hold it) and joins the film on the web when the fronts meet. Cracks: a 2D model of the layers (finite elements) at the places along the line where they are likeliest, against the film's fracture energy (${f.GcF.v} J/m²). The peel: the force per width where the energy a steady peel frees reaches the film's hold on the web (${f.Gi.v} J/m²), at every angle. Curl: the free film's layers' lengths; the roll: bent round the ${OVEN.peel.core} mm core, its top out. Your measured curl, cracks and peel force go below. Solved in ${(FILM.ms / 1000).toFixed(1)} s.`;
}

// ---- measured (Q58): curl, cracks, peel force -- beside the computed, read back ----
/** A measured curl as a curvature (1/m; its top concave negative): a radius, or an edge's lift over a sheet length. */
function filmCurlKappa(q) {
  let k = NaN;
  if (Number.isFinite(q.R) && q.R > 0) k = 1000 / q.R;
  else if (Number.isFinite(q.lift) && Number.isFinite(q.sheet) && q.lift > 0 && q.sheet > 0) {
    // the arc through the middle on the table and the edges lifted δ over half the sheet: R (1 − cos(L/2R)) = δ
    const L = q.sheet / 1000, d = q.lift / 1000;
    let lo = L / (2 * Math.PI), hi = 1e6;
    for (let it = 0; it < 200; it++) { const m = Math.sqrt(lo * hi); if (m * (1 - Math.cos(L / (2 * m))) > d) lo = m; else hi = m; }
    k = 1 / Math.sqrt(lo * hi);
  }
  return q.toward === 'bottom' ? k : -k;
}
function filmMeasured(rt, rb) {
  const host = document.getElementById('filmMeas');
  if (!host) return;
  const m = MAT.filmMeas, locs = [['web', 'The web'], ...CFD_LOCS.map((l, i) => [`L${i + 1}`, `L${i + 1}`])];
  const locSel = id => `<label>Film <select id="${id}">${locs.map(([k, t]) => `<option value="${k}"${k === DRY.sel ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const num = (id, l, u, lo, hi, step) => `<label>${l} <span class="prop-v"><input type="number" id="${id}" min="${lo}" max="${hi}" step="${step}" placeholder="—"><span class="prop-u">${u}</span></span></label>`;
  const use = (k, v, what, lbl) => Number.isFinite(v) && v > 0 ? ` <button type="button" class="linkish" data-filmuse="${k}|${v}|${dryEsc(what)}">Use ${lbl}</button>` : '';
  // what the measured imply, for the film shown (both ways)
  const imp = [];
  if (rt && rb) {
    for (const q of (m.peel || []).filter(q => q.loc === DRY.sel && Number.isFinite(q.f) && Number.isFinite(q.angle))) {
      const g = r => { const th = q.angle * Math.PI / 180, f = q.f; return f * (1 - (1 + r.peel.epsB) * Math.cos(th)) + f * f / (2 * r.peel.S) + r.peel.Ur; };
      const gt = g(rt), gb = g(rb);
      imp.push(`<li>Your peel force ${q.f} N/m at ${q.angle}° means its hold on the web is <b>${filmN(gt)}</b> J/m² (top only) or <b>${filmN(gb)}</b> (top and bottom).${use('Gi', +gt.toPrecision(3), `your peel force ${q.f} N/m at ${q.angle}°`, 'top only\'s')}${use('Gi', +gb.toPrecision(3), `your peel force ${q.f} N/m at ${q.angle}°`, 'top and bottom\'s')}</li>`);
    }
    for (const q of (m.curl || []).filter(q => q.loc === DRY.sel)) {
      const k = filmCurlKappa(q), st = q.when === 'peel' ? 'atPeel' : 'settled';
      if (!Number.isFinite(k)) continue;
      if (q.when === 'roll') {   // (unwound: the share of the roll's bend it kept, β as on the card)
        const sf = r => { const d = r.roll.kappa - r.curl.atPeel.kappa; return Math.abs(d) > 1e-12 ? (k - r.curl.settled.kappa) / d : NaN; };
        const st2 = sf(rt), sb2 = sf(rb), pc = v => Number.isFinite(v) ? `${(v * 100).toFixed(0)} %` : '—';
        imp.push(`<li>Your curl unwound from the roll (${filmCurlText(k)}) means the film keeps <b>${pc(st2)}</b> of the roll's bend (top only) or <b>${pc(sb2)}</b> (top and bottom)${st2 < 0 || sb2 < 0 || st2 > 1 || sb2 > 1 ? ' <span class="warn-text">— outside 0–100 %: its settled curl on the card is off too (check the swelling with water)</span>' : ''}.${use('setFrac', +Math.min(1, Math.max(0, st2)).toPrecision(3), 'your curl unwound from the roll', 'top only\'s')}${use('setFrac', +Math.min(1, Math.max(0, sb2)).toPrecision(3), 'your curl unwound from the roll', 'top and bottom\'s')}</li>`);
        continue;
      }
      const b = r => { const [k0, k1] = r.curlBeta[st]; return Math.abs(k1) > 1e-12 ? (k - k0) / k1 : NaN; };
      const bt = b(rt), bb = b(rb);
      imp.push(`<li>Your curl (${filmCurlText(k)}, ${q.when === 'peel' ? 'right after peeling' : 'settled'}) means the film swells <b>${Number.isFinite(bt) ? bt.toFixed(3) : '—'}</b> per kg/kg (top only) or <b>${Number.isFinite(bb) ? bb.toFixed(3) : '—'}</b> (top and bottom)${bt < 0 || bb < 0 ? ' <span class="warn-text">— negative: something else curls it (the heat, how it sets): check the card\'s other values</span>' : ''}.${use('beta', +bt.toPrecision(3), 'your curl', 'top only\'s')}${use('beta', +bb.toPrecision(3), 'your curl', 'top and bottom\'s')}</li>`);
    }
    for (const q of (m.cracks || []).filter(q => q.loc === DRY.sel && Number.isFinite(q.spacing))) {
      const g = r => { if (!r.ladder || !r.ladder.length) return null; const at = s => { const L = r.ladder; if (s <= L[0][0]) return L[0][1]; for (let j = 1; j < L.length; j++) if (s <= L[j][0]) { const f = Math.log(s / L[j - 1][0]) / Math.log(L[j][0] / L[j - 1][0]); return L[j - 1][1] + f * (L[j][1] - L[j - 1][1]); } return L[L.length - 1][1]; };
        const s = q.spacing / 1000; return [at(s / 2), at(s)]; };
      const gt = g(rt), gb = g(rb), fmt = x => x ? `${filmN(x[0])}–${filmN(x[1])}` : '—';
      const mid = x => x ? +Math.sqrt(Math.max(x[0], 1e-9) * Math.max(x[1], 1e-9)).toPrecision(3) : NaN;
      imp.push(`<li>Your cracks ${q.spacing} mm apart mean its fracture energy is <b>${fmt(gt)}</b> J/m² (top only) or <b>${fmt(gb)}</b> (top and bottom), where the crack risk is highest.${use('GcF', mid(gt), `your crack spacing ${q.spacing} mm`, 'top only\'s')}${use('GcF', mid(gb), `your crack spacing ${q.spacing} mm`, 'top and bottom\'s')}</li>`);
    }
  }
  const list = (kind, fmt) => (m[kind] || []).map((q, k) => `<li>${q.loc === 'web' ? 'The web' : q.loc}: ${fmt(q)} <button type="button" class="linkish" data-filmdel="${kind}:${k}">Remove</button></li>`).join('') || '<li class="fv-why">None yet.</li>';
  host.innerHTML = `<h3 class="oned-h">Measured film</h3>
    <div class="dry-meas film-meas">
      <div class="dry-mcol"><h4>${filmPicCurl('top', 0.5)} Curl</h4>
        <div class="dry-exit-form">${locSel('fmCLoc')}${num('fmCR', 'Radius', 'mm', 1, 1e6, 1)}<span class="fv-why">or</span>${num('fmCLift', 'Edge lift', 'mm', 0, 1e4, 0.1)}${num('fmCSheet', 'Sheet length', 'mm', 1, 1e5, 1)}
          <label>Rolls <select id="fmCTo"><option value="top">toward its top</option><option value="bottom">away from its top</option></select></label>
          <label>Measured <select id="fmCWhen"><option value="settled">later (settled)</option><option value="peel">right after peeling</option><option value="roll">unwound from the roll</option></select></label>
          <button class="btn btn-secondary btn-sm" type="button" id="fmCAdd">Add</button></div>
        <ul class="dry-list">${list('curl', q => [Number.isFinite(q.R) ? `radius ${q.R} mm` : '', Number.isFinite(q.lift) ? `lift ${q.lift} mm over ${q.sheet} mm` : '', q.toward === 'bottom' ? 'away from its top' : 'toward its top', FILM_WHEN[q.when] || ''].filter(Boolean).join(', '))}</ul></div>
      <div class="dry-mcol"><h4>${filmPicCracks(0.5)} Cracks</h4>
        <div class="dry-exit-form">${locSel('fmKLoc')}${num('fmKS', 'Spacing', 'mm', 0.001, 1e4, 0.1)}${num('fmKW', 'Width', 'µm', 0, 1e5, 1)}
          <label>Seen <select id="fmKWhere"><option value="web">on the web</option><option value="peel">after peeling</option><option value="roll">on the roll</option></select></label>
          <button class="btn btn-secondary btn-sm" type="button" id="fmKAdd">Add</button></div>
        <ul class="dry-list">${list('cracks', q => [Number.isFinite(q.spacing) ? `${q.spacing} mm apart` : '', Number.isFinite(q.width) ? `${q.width} µm wide` : '', { web: 'on the web', peel: 'after peeling', roll: 'on the roll' }[q.where] || ''].filter(Boolean).join(', '))}</ul></div>
      <div class="dry-mcol"><h4>${filmPicPeel(0.5)} Peel force</h4>
        <div class="dry-exit-form">${locSel('fmPLoc')}${num('fmPF', 'Force per width', 'N/m', 0, 1e6, 0.1)}${num('fmPA', 'Angle', '°', 1, 180, 1)}
          <button class="btn btn-secondary btn-sm" type="button" id="fmPAdd">Add</button></div>
        <ul class="dry-list">${list('peel', q => `${q.f} N/m at ${q.angle}°`)}</ul></div>
    </div>
    ${imp.length ? `<ul class="dry-cmp film-imp">${imp.join('')}</ul>` : '<p class="fv-why">Each measured value is read back here as the card value it implies (its hold on the web from a peel force, its swelling from a curl, its fracture energy from the crack spacing), with a button to use it.</p>'}`;
  const val = id => { const el = document.getElementById(id), v = el ? el.value.trim() : ''; return v === '' ? NaN : +v; };
  const add = (kind, q, what) => { undoHint(`Add a measured ${what}`); MAT = { ...MAT, filmMeas: { ...MAT.filmMeas, [kind]: [...(MAT.filmMeas[kind] || []), q] } }; render(); };
  const wire = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
  wire('fmCAdd', () => {
    const q = { loc: document.getElementById('fmCLoc').value, R: val('fmCR'), lift: val('fmCLift'), sheet: val('fmCSheet'), toward: document.getElementById('fmCTo').value, when: document.getElementById('fmCWhen').value };
    if (!(q.R > 0) && !(q.lift > 0 && q.sheet > 0)) { imgToast('Type the curl\'s radius, or an edge\'s lift and the sheet\'s length.', 'error'); return; }
    add('curl', q, 'curl');
  });
  wire('fmKAdd', () => {
    const q = { loc: document.getElementById('fmKLoc').value, spacing: val('fmKS'), width: val('fmKW'), where: document.getElementById('fmKWhere').value };
    if (!(q.spacing > 0) && !(q.width > 0)) { imgToast('Type the cracks\' spacing or width.', 'error'); return; }
    add('cracks', q, 'cracks');
  });
  wire('fmPAdd', () => {
    const q = { loc: document.getElementById('fmPLoc').value, f: val('fmPF'), angle: val('fmPA') };
    if (!(q.f > 0) || !(q.angle > 0 && q.angle <= 180)) { imgToast('Type the peel force (N/m) and its angle (1–180°).', 'error'); return; }
    add('peel', q, 'peel force');
  });
}
function filmMeasRemove(kind, k) {
  undoHint(`Remove a measured ${{ curl: 'curl', cracks: 'cracks', peel: 'peel force' }[kind]}`);
  const list = (MAT.filmMeas[kind] || []).slice(); list.splice(k, 1);
  MAT = { ...MAT, filmMeas: { ...MAT.filmMeas, [kind]: list } };
  render();
}
/** Use a value a measurement implies on the Film card: measured, its source what it came from. */
function filmUse(k, v, what) {
  if (typeof sensBlocks === 'function' && sensBlocks()) return;   // (the ranking of the assumed values runs: what it shows is its changed value's)
  const row = MAT_FILM.find(q => q[0] === k);
  if (!row || !Number.isFinite(v)) return;
  const [, l, , lo, hi] = row, vv = Math.min(hi, Math.max(lo, v));
  undoHint(`${l}: from ${what}`);
  MAT = { ...MAT, film: { ...MAT.film, [k]: { v: vv, flag: 'measured', src: `from ${what}` } } };
  render();
}
function filmExportCSV() {
  if (!FILM.res) return;
  const rows = [['film', 'water leaves', 'table', 'x_m or angle_deg', 'top_stress_MPa', 'bonded_mean_MPa', 'web_MPa', 'floating_skin_um', 'bonded_um', 'wet_um', 'crack_ratio_skin', 'crack_ratio_bonded', 'blister_ratio', 'peel_N_m', 'tears']];
  for (const r of FILM.res.runs) {
    const way = r.where === 'top' ? 'top only' : 'top and bottom';
    r.line.forEach((q, i) => { const b = r.blisterLine[i]; rows.push([r.key, way, 'line', q.x, (q.sTopF != null ? q.sTopF : q.sTopB) / 1e6, q.sBond == null ? '' : q.sBond / 1e6, q.sWeb / 1e6, q.hFloat * 1e6, q.hBond * 1e6, q.hWet * 1e6, '', '', b ? b.ratio : '', '', '']); });
    for (const S of r.stations) rows.push([r.key, way, 'crack', S.x, '', '', '', '', '', '', S.float ? S.float.ratio : '', S.bond ? S.bond.ratio : '', '', '', '']);
    for (const q of r.peel.byAngle) rows.push([r.key, way, 'peel', q.deg, '', '', '', '', '', '', '', '', '', q.f, q.tears ? 'yes' : 'no']);
  }
  downloadCSV(`film-${csvStamp()}.csv`, rows);
}

// ---- the inputs bar: after the oven (the stretch to the peel, the winder's core) ----
/** After the oven in the inputs bar: all of it, or (part: 'film', 'piece' or 'stack', WF-2) one stage's rows -- 4 Peel and
 *  wind (the stretch to the peel, the winder's core), 5 Cutting (the pieces' size), 6 Pre heat treatment (its oven, times). */
function filmPeelTreeHTML(prop, part = null) {
  const pl = OVEN.peel, has = v => !part || part === v;
  const row = (i, id) => { const f = OVEN_PEEL_FIELDS[i]; return prop(f[1], id, `min="${f[3]}" max="${f[4]}" step="${f[5]}" value="${pl[f[0]]}" data-ovpeel="${f[0]}"`, f[2]); };
  return `<div class="ovz ovz-peel" id="ovzPeel"><div class="ovz-h"><span>${!part ? 'After the oven <small>to the peel and the winder</small>' : part === 'film' ? 'After the oven <small>to the peel and the winder</small>' : part === 'piece' ? 'Cut from the roll <small>the pieces</small>' : 'The pre heat treatment <small>the pieces pressed in a stack</small>'}</span></div>
    ${has('film') ? `<div class="ovz-pic">${filmPicPlace()}</div>
    ${row(0, 'ovzPeelLen')}
    <div class="ovz-pic ovz-roll">${filmPicRoll()}</div>
    ${row(1, 'ovzPeelCore')}${row(11, 'ovzPeelDeg')}${row(12, 'ovzWindLo')}${row(13, 'ovzWindHi')}
    <p class="prop-note">The film runs through the room (its temperature and humidity: the Drying card) to where it is peeled by hand and taken up by the winder, its top out on the roll.</p>
    <div class="ovz-h ovz-sub"><span>The roll <small>the 1D multiphysics</small></span></div>
    ${row(14, 'ovzWindT')}${row(15, 'ovzRollL')}${row(16, 'ovzRollRest')}${row(17, 'ovzCoreWall')}${row(18, 'ovzCoreE')}${row(19, 'ovzCoreNu')}${row(20, 'ovzRollH')}` : ''}
    ${has('piece') ? `<div class="ovz-pic">${filmPicCut()}</div>
    ${row(2, 'ovzPieceL')}${row(3, 'ovzPieceW')}` : ''}
    ${has('stack') ? `<div class="ovz-pic">${filmPicDryStack()}</div>
    ${row(10, 'ovzStackN')}${row(4, 'ovzDryT')}${row(5, 'ovzTOven')}
    ${typeof filmPicStackRest === 'function' ? `<div class="ovz-pic">${filmPicStackRest()}</div>` : ''}
    ${row(6, 'ovzTRest')}
    <div class="ovz-h ovz-sub"><span>The stack's heat <small>the multiphysics solver (MP-1)</small></span></div>
    ${row(7, 'ovzPlateT')}${row(8, 'ovzStackAir')}${row(9, 'ovzEpsPl')}
    <div class="prop"><span class="prop-l" id="ovzShelfL">What it stands on</span><span class="prop-v"><span class="seg seg-sm" role="radiogroup" aria-labelledby="ovzShelfL" id="ovzShelf">${Object.entries(OVEN_SHELVES).map(([k, t]) => `<button type="button" role="radio" data-ovshelf="${k}" aria-checked="${k === pl.shelf}">${t}</button>`).join('')}</span></span></div>` : ''}
    ${has('piece') || has('stack') ? `<p class="prop-note">The pieces are cut from the roll later, stacked ${pl.stackN} at a time under an aluminium plate and heated in the pre heat treatment, then left under the plate in the room until they are taken out to be looked at and measured (the stack and the piece in 3D: the film\'s section).</p>` : ''}</div>`;
}
function wireFilmPeel(changed) {
  document.querySelectorAll('#setupExtra [data-ovshelf]').forEach(b => b.addEventListener('click', () => {
    if (OVEN.peel.shelf === b.dataset.ovshelf && OVEN.peel.shelfSet) return;
    OVEN.peel = { ...OVEN.peel, shelf: b.dataset.ovshelf, shelfSet: true };
    document.querySelectorAll('#setupExtra [data-ovshelf]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.ovshelf === OVEN.peel.shelf)));
    changed();
  }));
  document.querySelectorAll('#setupExtra input[data-ovpeel]').forEach(el => {
    const k = el.dataset.ovpeel, [, l, u, lo, hi, , , flag] = OVEN_PEEL_FIELDS.find(f => f[0] === k);
    el.addEventListener('change', () => {
      guardNumber(el, { label: l, lo, hi, unit: u }, v => { OVEN.peel = { ...OVEN.peel, [k]: v, [flag]: true }; });
      el.value = OVEN.peel[k];
      changed();
    });
  });
}

// ---- Materials: the Film card ----
// (its values are edited in the material hub, mathub-ui.js)
/** The card read-only (the report). */
const filmCardRows = () => MAT_FILM.map(([k, l, u, , , , dd]) => [l, (+MAT.film[k].v).toFixed(dd), u, MAT.film[k].flag, MAT.film[k].src]);
