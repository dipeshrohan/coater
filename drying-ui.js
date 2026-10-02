'use strict';
/*
 * drying-ui.js — GO-3: the film drying in the oven.
 * Process tab, under the chain (Q55): the oven drawn with its zones and what the film does in it (where its skin
 * forms, where it is dry, water condensing at the entry, boiling under the skin); the answers at each location and
 * for the web's mean, the water leaving from the top only and from the top and the bottom side by side (Q53); along
 * the line the water, the temperatures, the evaporation, the film and its skin; through the film at a chosen place;
 * a table; CSV; and the measured (Q54) -- temperatures in the oven and values at its exit -- over the computed.
 * Materials: the drying card. The inputs bar: each oven zone's top (Q52: nothing blown, air, IR, or both), with its
 * picture (the user: where the app offers a choice, show the picture it was asked with).
 * Solved in a worker (cfd-dry-worker.js, drying.js) whenever the Process tab shows inputs it has not solved.
 */

const DRY = { key: null, pending: null, res: null, busy: false, again: false, error: null, worker: null, id: 0, prog: null, ms: 0, sel: 'web', x: null };
/** Stop the drying's solve (New, Open): its worker ended. */
function dryStop() { if (DRY.worker) { DRY.worker.terminate(); DRY.worker = null; } Object.assign(DRY, { busy: false, again: false, pending: null, prog: null }); }
const DRY_WAYS = { top: 'From the top only', both: 'From the top and the bottom' };
const DRY_ASPECT = 0.5;   // (the charts' height / width: the section scrolls, so they keep their shape)
const dryEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ---- the pictures (the ones the questions were asked with, small) ----
/**
 * A cross-section of the film on its web in an oven zone, what is above it drawn: 'none' (the oven's still air), 'air'
 * (slot nozzles blowing down), 'ir' (IR heaters), 'air+ir'. Below: the hot air blown up into the fibre (decided).
 */
function dryTopSketch(kind, w = 168, h = 92) {
  const fy = 52, air = kind === 'air' || kind === 'air+ir', ir = kind === 'ir' || kind === 'air+ir';
  const arrow = (x, y1, y2, col) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${col}" stroke-width="1.8"/><path d="M${x - 3.5},${y2 + (y2 > y1 ? -5 : 5)} L${x},${y2} L${x + 3.5},${y2 + (y2 > y1 ? -5 : 5)}" fill="none" stroke="${col}" stroke-width="1.8"/>`;
  let top = '';
  if (kind === 'none') top = [40, 84, 128].map(x => `<path d="M${x},${fy - 4} q-4,-8 0,-16 q4,-8 0,-16" fill="none" stroke="var(--muted)" stroke-width="1.3" stroke-dasharray="2.5 2.5"/>`).join('');
  if (ir) top += [42, 84, 126].map(x => `<rect x="${x - 13}" y="4" width="26" height="7" rx="3.5" fill="#c2410c"/>${[-6, 0, 6].map(dx => `<path d="M${x + dx},13 q2,3.5 0,7 q-2,3.5 0,7 q2,3.5 0,7" fill="none" stroke="#ea580c" stroke-width="1.1"/>`).join('')}`).join('');
  if (air) top += `<rect x="18" y="${ir ? 36 : 8}" width="${w - 36}" height="6" rx="2" fill="var(--muted)"/>${[34, 62, 90, 118, 146].map(x => arrow(x, ir ? 43 : 15, fy - 3, '#d9480f')).join('')}`;
  return `<svg class="dry-pic" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${dryEsc(OVEN_TOPS[kind] || kind)}: the film on its web, hot air blown up into the fibre from below">
    ${top}<rect x="6" y="${fy}" width="${w - 12}" height="12" fill="#7a5a33"/><rect x="6" y="${fy + 12}" width="${w - 12}" height="10" fill="var(--fibre)" stroke="var(--line)"/>
    ${[30, 70, 110, 150].map(x => arrow(x, h - 1, fy + 25, '#d9480f')).join('')}</svg>`;
}
/** A cross-section with the water leaving (blue): 'top' from the top only, 'both' from the top and into the air through the fibre. */
function dryWaySketch(way, w = 132, h = 70) {
  const fy = 30, blue = '#2563eb', up = [24, 52, 80, 108].map(x => `<path d="M${x},${fy - 2} q-3,-6 0,-12 q3,-6 0,-12" fill="none" stroke="${blue}" stroke-width="1.6"/><path d="M${x - 3},${fy - 22} L${x},${fy - 27} L${x + 3},${fy - 22}" fill="none" stroke="${blue}" stroke-width="1.6"/>`).join('');
  const down = way === 'both' ? [38, 66, 94].map(x => `<line x1="${x}" y1="${fy + 10}" x2="${x}" y2="${fy + 17}" stroke="${blue}" stroke-width="1.6"/><path d="M${x - 3},${fy + 14} L${x},${fy + 18} L${x + 3},${fy + 14}" fill="none" stroke="${blue}" stroke-width="1.6"/>`).join('') + `<line x1="12" y1="${fy + 21}" x2="${w - 16}" y2="${fy + 21}" stroke="${blue}" stroke-width="1.2" stroke-dasharray="3 2"/><path d="M${w - 19},${fy + 18} L${w - 14},${fy + 21} L${w - 19},${fy + 24}" fill="none" stroke="${blue}" stroke-width="1.2"/>` : '';
  return `<svg class="dry-pic" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${dryEsc(DRY_WAYS[way])}">${up}<rect x="6" y="${fy}" width="${w - 12}" height="10" fill="#7a5a33"/><rect x="6" y="${fy + 10}" width="${w - 12}" height="16" fill="var(--fibre)" stroke="var(--line)" opacity=".9"/>${down}</svg>`;
}

// ---- the inputs ----
/** The films the drying starts from: each location's (3D, else 2D, else 1D) and the web's mean (answers.js: across the web). */
function dryFilms() {
  const out = [];
  CFD_LOCS.forEach((l, i) => { const f = processFilmAt(i); if (f) out.push({ key: `L${i + 1}`, i, h0: f.h, src: f.src }); });
  const web = processWeb();
  if (web) out.push({ key: 'web', i: null, h0: web.mean, src: web.tag });
  return out;
}
/** drying.js's strip inputs (SI), without the film and the way out: the cards, the fibre web, the line, the room and the oven. */
function dryBase() {
  const c = MAT.slurry, d = MAT.dry, v = k => d[k].v;
  return {
    phi0: c.phi.v / 100, phiM: c.phiDry.v, rhoS: c.rhoS.v * 1000, rhoL: c.rhoL.v, R: c.dMean.v * 1e-6 / 2,
    mul: v('mul'), skinK: v('skinK') * 1e-12, kS: v('kS'), cS: v('cS'), emis: v('emis'), irAbs: v('irAbs'),
    gab: { Xm: v('gabXm'), C: v('gabC'), K: v('gabK') }, web: { mass: CFDG.gsm / 1000, cp: v('cpWeb') }, airFrac: CFDG.airFrac,
    U: lineSpeed(), Lnat: ACROSS_W / 1000 / 2, P: 101325, Tin: v('Troom'), room: { len: P.oven, T: v('Troom'), rh: v('rhRoom') / 100 },
    zones: OVEN.zones.map(z => ({ len: z.len, airU: z.airU, airT: z.airT, rh: z.rh / 100, top: z.top || 'none', jetU: z.jetU, jetT: z.jetT, jetB: z.jetB / 1000, jetH: z.jetH / 1000, jetS: z.jetS / 1000, ir: z.ir * 1000 })),
    N: 80, M: 40,
    // (the built-in laws and the fluids' constants, the material hub's, where they differ from the solver's own: MC-1b)
    ...(typeof matSolverProps === 'function' && matSolverProps() ? { props: matSolverProps() } : {}),
  };
}
/** Where the profiles through the film are kept: the room's middle, then every 0.5 m through the oven and its exit. */
function dryProfilePlaces(base) {
  const len = base.zones.reduce((a, z) => a + z.len, 0), out = [];
  if (base.room.len > 0) out.push(-base.room.len / 2);
  for (let x = 0; x < len - 1e-9; x += 0.5) out.push(+x.toFixed(6));
  return out;
}
const dryKeyNow = () => { const f = dryFilms(); return f.length ? JSON.stringify([dryBase(), f]) : null; };
/** The results are for the inputs as they are. */
const dryCurrent = () => !!DRY.res && DRY.key === dryKeyNow();
/** Solve the drying for the inputs as they are (in the worker), unless it is solved or being solved. */
function dryRequest() {
  const films = dryFilms();
  if (!films.length) return;
  const base = dryBase(), key = JSON.stringify([base, films]);
  if (key === DRY.key || key === DRY.pending) { solveTake('dry'); return; }
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveAsked('dry')) return;
  if (DRY.busy) { DRY.again = true; return; }
  solveTake('dry');
  DRY.busy = true; DRY.again = false; DRY.pending = key; DRY.prog = null;
  if (!DRY.worker) DRY.worker = makeWorker('cfd-dry-worker.js');
  const id = ++DRY.id;
  DRY.worker.onmessage = e => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.progress) { DRY.prog = m.progress; dryStatusPaint(); return; }
    DRY.busy = false; DRY.pending = null; DRY.key = key;
    if (m.ok) { DRY.res = { runs: m.runs, films, base }; DRY.error = null; DRY.ms = m.ms; }
    else { DRY.res = null; DRY.error = m.error; }
    if (DRY.again) dryRequest();
    if (tab === 12) render();
  };
  DRY.worker.onerror = e => { DRY.busy = false; DRY.pending = null; DRY.key = key; DRY.res = null; DRY.error = e.message || 'the drying worker failed'; if (tab === 12) render(); };
  DRY.worker.postMessage({ id, base: { ...base, profilesAt: dryProfilePlaces(base) }, films });
}
/** Wait for the drying of the inputs as they are (the report). */
async function dryWait() {
  for (let k = 0; k < 1200; k++) {
    // (Phase 0: not asked for and not solving -- nothing to wait for; the report marks it not solved)
    if (!solveAsked('dry') && !solveAsked('1d') && !DRY.busy && !ONE_D.busy) return dryCurrent();
    if (typeof oneDRequest === 'function') oneDRequest(true);
    dryRequest();
    if (!DRY.busy && dryCurrent()) return true;
    if (!DRY.busy && DRY.error && DRY.key === dryKeyNow()) return false;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}
/** A film's two runs (top only, top and bottom), from the results shown. */
const dryRuns = key => DRY.res ? ['top', 'both'].map(w => DRY.res.runs.find(r => r.key === key && r.where === w)) : [null, null];
const dryFilmColor = key => key === 'web' ? cssVar('--ink') : locColor(+key.slice(1) - 1);
const dryFilmName = key => key === 'web' ? 'the web (its mean)' : `${key} (z ${CFD_LOCS[+key.slice(1) - 1].z} mm)`;
const dryPlace = x => x == null ? 'not in the oven' : x < 0 ? `${(-x).toFixed(2)} m before the oven` : `${x.toFixed(2)} m`;

// ---- the chain's line ----
/** The Process chain's drying stage: its state and its line. */
function dryStage() {
  const n = OVEN.zones.length, o = ovenTime(lineSpeed()), what = `${n} zone${n === 1 ? '' : 's'}, ${+o.len.toFixed(2)} m`;
  if (DRY.busy) return { st: 'busy', s: `${what}: drying the films…` };
  // (not solved for these inputs: out of date when an older result is kept, else not solved yet -- Phase 0, on request)
  if (!dryCurrent()) return DRY.error && DRY.key === dryKeyNow() ? { st: 'failed', s: `${what}: ${DRY.error}` } : { st: DRY.res ? 'stale' : 'todo', s: `${what}: the water to take out` };
  const [t, b] = dryRuns('web').map(r => r || null), f = r => !r ? '—' : r.exit.dry ? `dry at ${dryPlace(r.events.dry)}` : `${r.exit.waterPct.toFixed(0)} % water left`;
  return { st: 'solved', s: `${what}; the web: ${f(t)} (top only), ${f(b)} (top and bottom)` };
}

// ---- the Process tab's section ----
/** Setup: the oven's zones, typed here or in the inputs bar (the same values); the jets' and IR's values, and adding or
 * removing a zone, in the inputs bar. */
function procOvenTable() {
  const z = OVEN.zones, th = OVEN_ZONE_FIELDS.filter(f => f[0] !== 'plenum');
  const cell = (q, i, [k, l, u, lo, hi, step]) => `<td><input type="number" id="pz${i + 1}_${k}" min="${lo}" max="${hi}" step="${step}" value="${q[k]}" data-pzone="${i}:${k}" aria-label="Oven zone ${i + 1}: ${l.toLowerCase()}, ${u}"></td>`;
  const top = (q, i) => `<td><select id="pz${i + 1}_top" data-pztop="${i}" aria-label="Oven zone ${i + 1}: above the film">${Object.entries(OVEN_TOPS).map(([k, t]) => `<option value="${k}"${k === q.top ? ' selected' : ''}>${t}</option>`).join('')}</select></td>`;
  return `<div class="proc-zones-wrap"><table class="proc-kv proc-grid proc-zones"><thead><tr><th>Zone</th>${th.map(f => `<th>${f[1]} <small>${f[2]}</small></th>`).join('')}<th>Above the film</th></tr></thead><tbody>
    ${z.map((q, i) => `<tr><th>${i + 1}</th>${th.map(f => cell(q, i, f)).join('')}${top(q, i)}</tr>`).join('')}</tbody></table></div>`;
}
function procOvenLine() { const o = ovenTime(lineSpeed()); return `${OVEN.zones.length} zones, ${+o.len.toFixed(2)} m: the film ${Number.isFinite(o.t) ? (o.t / 60).toFixed(1) + ' min' : '—'} in it at ${P.U} m/min`; }
/** The section's frame (filled by dryRender after the page is drawn). */
function drySectionHTML() {
  const seg = [...CFD_LOCS.map((l, i) => [`L${i + 1}`, `<i class="loc-dot" style="background:${locColor(i)}"></i>L${i + 1}`]), ['web', 'The web']];
  const pane = (id, icon, title, aria, cls = '') => `<figure class="pane dry-pane${cls}"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas><div class="pane-legend" id="${id}Lg"></div></figure>`;
  return `<section class="dry-sec" id="drySec" aria-labelledby="dryH">
    <header class="dry-head"><h3 id="dryH">${uiBadge('oven')}4 · Drying in the oven</h3>
      <div class="seg" role="tablist" aria-label="Which film" id="drySel">${seg.map(([k, t]) => `<button type="button" role="tab" data-dry="${k}" aria-selected="${k === DRY.sel}">${t}</button>`).join('')}</div>
      <span class="vp-spacer"></span><button type="button" class="btn btn-secondary btn-sm" id="dryZones" data-chain="oven" title="The oven's zones, in the inputs bar">${uiIco('oven')}Oven zones</button><button type="button" class="btn btn-secondary btn-sm" id="dryCsv">Export CSV</button></header>
    <div class="furn-block" data-pstep="setup"><div class="furn-bh"><h4>The oven</h4><span class="fv-why">${procOvenLine()}</span></div>${procOvenTable()}
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" data-chain="oven">${uiIco('oven')}More: add a zone, jets, IR (inputs bar)</button></div></div>
    <div class="dry-ways" id="dryWays" data-pstep="setup">${['top', 'both'].map(w => `<div class="dry-way">${dryWaySketch(w)}<span><b>${DRY_WAYS[w]}</b><i class="lg-ln${w === 'both' ? ' dash' : ''}" style="--c:var(--ink)"></i>${w === 'both' ? 'dashed' : 'solid'} in the charts</span></div>`).join('')}
      <p class="fv-why">Where the water leaves is not known, so both are computed. From the top only: the fibre under the film only brings the hot air's heat. From the top and the bottom: vapour also goes into the air blown up through the fibre, which carries it away.</p></div>
    <div id="dryState" data-pstep="solve results"></div>
    <figure class="pane dry-oven" data-pstep="results"><figcaption>${uiBadge('oven')}The film through the room and the oven <span class="fv-why">(click to look through the film there)</span></figcaption><canvas id="dryOven" role="img" aria-label="The oven drawn along the line: its zones, what is above the film, and the film with its skin, top-only way above, top-and-bottom below"></canvas></figure>
    <div class="stats" id="dryStats" data-pstep="results"></div>
    <div data-pstep="results">${procChipsHTML('dry')}</div>
    <div class="dry-grid furn-one" data-pstep="results">
      ${pane('dr1', 'drop', 'Water in the film', 'Water in the film against position along the line')}
      ${pane('dr2', 'oven', 'Temperatures', 'The film\'s top and bottom temperature and the air against position along the line, with measured temperatures')}
      ${pane('dr3', 'drop', 'Evaporation', 'Evaporation from the top and the bottom against position along the line')}
      ${pane('dr4', 'film', 'The film and its skin', 'The film\'s thickness and its skin against position along the line')}
      ${pane('dr5', 'film', 'Through the film', 'Solids through the film\'s height at the chosen place')}
    </div>
    <div id="dryTable" data-pstep="results"></div>
    <div id="dryMeas" data-pstep="results"></div>
    <p class="fv-note" id="dryNote" data-pstep="solve"></p>
    ${PROC_ALL && typeof dmpHTML === 'function' ? dmpHTML() : ''}
  </section>`;
}
function dryStatusPaint() {
  const el = document.getElementById('dryState');
  if (!el) return;
  if (DRY.busy) { const p = DRY.prog; el.innerHTML = `<p class="dry-msg">${pill(p ? `Drying ${p.key === 'web' ? 'the web' : p.key}, ${p.where === 'top' ? 'top only' : 'top and bottom'} (${p.k + 1} of ${p.n})…` : 'Drying the films…', '')}</p>`; }
}
/** Draw the section: the state, the oven, the numbers, the charts, the table, the measured. */
function dryRender() {
  const sec = document.getElementById('drySec');
  if (!sec) return;
  if (!sec.dataset.wired) dryWire(sec);
  sec.querySelectorAll('[data-dry]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.dry === DRY.sel)));
  const st = document.getElementById('dryState');
  const films = dryFilms();
  if (!films.length) { st.innerHTML = `<p class="dry-msg">${solvePending('dry') ? pill('Solving the 1D first: the drying starts from the wet film', '') : solveCtl('dry') + ' <span class="fv-why">(the 1D first: the drying starts from the wet film)</span>'}</p>`; dryClear(); return; }
  dryRequest();
  if (!dryCurrent()) {
    if (DRY.busy) dryStatusPaint();
    else if (DRY.error) st.innerHTML = `<p class="dry-msg">${pill('The drying could not be solved: ' + dryEsc(DRY.error), 'bad')}</p>`;
    else st.innerHTML = `<p class="dry-msg">${solvePending('dry') ? pill('Solving the drying…', '') : solveCtl('dry')}</p>`;
    if (!DRY.res) { dryClear(); return; }
    // (the previous results stay drawn, marked out of date, until solved again: Phase 0, solving only on request)
    st.insertAdjacentHTML('beforeend', `<p class="dry-msg">${pill('Showing the drying for the previous inputs', 'warn')}</p>`);
  } else st.innerHTML = '';
  if (!DRY.res.runs.some(r => r.key === DRY.sel)) DRY.sel = DRY.res.runs.some(r => r.key === 'web') ? 'web' : DRY.res.runs[0].key;
  const [rt, rb] = dryRuns(DRY.sel);
  if (!rt || !rb) { dryClear(); return; }
  if (DRY.x == null || DRY.x < rt.xStart || DRY.x > rt.xEnd) DRY.x = rt.xEnd;
  st.insertAdjacentHTML('beforeend', procAnswerHTML(dryStage().s, dryWarnings(rt, rb)));
  drawDryOven(rt, rb);
  dryStats(rt, rb);
  dryCharts(rt, rb);
  procShowChart('dry');
  dryTable();
  dryMeasured(rt, rb);
  document.getElementById('dryNote').innerHTML = dryNoteText(rt);
  // (the report: the drying's multiphysics, MP-5, as solved)
  if (typeof dmpRender === 'function' && PROC_ALL && dmpCurrent(DMS.dim)) dmpRender();
}
function dryClear() {
  ['dryStats', 'dryTable', 'dryNote'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
  ['dryOven', 'dr1', 'dr2', 'dr3', 'dr4', 'dr5'].forEach(id => { const cv = document.getElementById(id); if (cv) { const cx = setupCanvas(cv, 0.2); cx.c.clearRect(0, 0, cx.w, cx.h); } });
  dryMeasured(null, null);
}
function dryWire(sec) {
  sec.dataset.wired = '1';
  sec.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-dry]');
    if (b) { DRY.sel = b.dataset.dry; dryRender(); return; }
    const del = e.target.closest && e.target.closest('[data-drydel]');
    if (del) { const [kind, idx] = del.dataset.drydel.split(':'); dryMeasRemove(kind, +idx); }
  });
  document.getElementById('dryCsv').onclick = dryExportCSV;
  // (Setup's zone table: the same values as the inputs bar's zones)
  sec.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.pzone) {
      const [i, k] = el.dataset.pzone.split(':'), [, l, u, lo, hi] = OVEN_ZONE_FIELDS.find(f => f[0] === k);
      guardNumber(el, { label: `Oven zone ${+i + 1}: ${l.toLowerCase()}`, lo, hi, unit: u }, v => { OVEN.zones[+i][k] = v; });
      render();
    } else if (el.dataset.pztop) { OVEN.zones[+el.dataset.pztop].top = el.value in OVEN_TOPS ? el.value : 'none'; render(); }
  });
  const cv = document.getElementById('dryOven');
  cv.addEventListener('click', e => {
    const m = cv._map; if (!m) return;
    const r = cv.getBoundingClientRect(), x = m.invX(e.clientX - r.left);
    const [rt] = dryRuns(DRY.sel); if (!rt) return;
    const places = rt.profiles.map(p => p.x);
    DRY.x = places.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a, places[0]);
    dryRender();
  });
}
function dryWarnings(rt, rb) {
  const w = [], dew = drTsat(Math.max(1, OVEN.zones[0].rh / 100 * drPsat(OVEN.zones[0].airT)));
  for (const [r, name] of [[rt, 'top only'], [rb, 'top and bottom']]) {
    if (r.events.boil != null) w.push(pill(`${name}: the water reaches its boiling point${r.events.boilSkin ? ' under the skin' : ''} at ${dryPlace(r.events.boil)}${r.events.boilSkin ? ' — the skin can blister' : ''}`, 'bad'));
  }
  if (rt.events.condense != null || rb.events.condense != null) w.push(pill(`Water condenses on the film as it enters the oven: it is colder than the air's dew point (${dew.toFixed(0)} °C in zone 1) until it warms up`, 'warn'));
  if (!rt.exit.dry || !rb.exit.dry) w.push(pill(`Not dry at the oven's exit: ${[[rt, 'top only'], [rb, 'top and bottom']].filter(([r]) => !r.exit.dry).map(([r, n]) => `${n} ${r.exit.waterPct.toFixed(0)} % water left`).join(', ')}`, 'warn'));
  if (rt.swells) w.push(pill('At the last zone\'s humidity the dry GO would hold more water than its packing\'s pores: it swells; the water left is at least what is shown', 'warn'));
  const fib = FIBRES[CFDG.fibre], hot = Math.max(rt.Tmax, rb.Tmax);
  if (hot > fib.tUse) w.push(pill(`The film reaches ${hot.toFixed(0)} °C, above the fibre's ${fib.tUse} °C continuous limit`, 'warn'));
  return w.length ? `<div class="dry-warn">${w.join('')}</div>` : '';
}

/** The oven drawn: the room and the zones (what is above each), the film on its web in two lanes (top only; top and bottom), their skins and events; the place looked through. */
function drawDryOven(rt, rb) {
  const cv = document.getElementById('dryOven');
  // (236 px high at any width: the zones, the two lanes, the air and the scale)
  const par = cv.parentElement, pcs = getComputedStyle(par), pw = par.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
  const { c, w, h } = setupCanvas(cv, 236 / (pw > 0 ? pw : 600));
  const ink = cssVar('--ink'), mut = cssVar('--muted'), line = cssVar('--line'), soft = cssVar('--soft'), surf = cssVar('--surface'), fibre = cssVar('--fibre'), warn = cssVar('--warn'), bad = cssVar('--bad');
  const L = 70, R = 14, x0 = rt.xStart, x1 = rt.xEnd, X = x => L + (x - x0) / (x1 - x0) * (w - L - R);
  cv._map = { invX: px => x0 + (px - L) / (w - L - R) * (x1 - x0) };
  c.font = '11px ' + cssVar('--sans'); c.textBaseline = 'middle';
  // the room and the zones (boxes; what is above the film drawn under each label)
  const topY = 6, boxH = 44;
  if (x0 < 0) { const rw = X(0) - X(x0) - 2, rm = (X(x0) + X(0)) / 2, fits = t => c.measureText(t).width < rw - 4; c.fillStyle = soft; c.fillRect(X(x0), topY, rw, boxH); c.fillStyle = mut; c.textAlign = 'center'; if (fits('room')) c.fillText('room', rm, topY + 12); if (fits(`${(-x0).toFixed(2)} m`)) c.fillText(`${(-x0).toFixed(2)} m`, rm, topY + 27); }
  let xz = 0;
  OVEN.zones.forEach((z, i) => {
    const a = X(xz), b = X(xz + z.len) - 2, mid = (a + b) / 2;
    c.fillStyle = soft; c.strokeStyle = line; c.lineWidth = 1; c.beginPath(); c.roundRect ? c.roundRect(a, topY, b - a, boxH, 5) : c.rect(a, topY, b - a, boxH); c.fill(); c.stroke();
    c.fillStyle = ink; c.textAlign = 'center';
    const lab = `Zone ${i + 1} · ${z.airT} °C`;
    if (c.measureText(lab).width < b - a - 6) c.fillText(lab, mid, topY + 10);
    // what is above the film
    const kind = z.top || 'none', py = topY + 22;
    if (kind === 'none') { c.strokeStyle = mut; c.setLineDash([2, 2]); for (const dx of [-12, 0, 12]) { c.beginPath(); c.moveTo(mid + dx, py + 18); c.quadraticCurveTo(mid + dx - 3, py + 11, mid + dx, py + 6); c.quadraticCurveTo(mid + dx + 3, py + 1, mid + dx, py - 4); c.stroke(); } c.setLineDash([]); }
    if (kind === 'ir' || kind === 'air+ir') { c.fillStyle = '#c2410c'; for (const dx of [-14, 8]) c.fillRect(mid + dx, py - 5, 8, 4); c.strokeStyle = '#ea580c'; for (const dx of [-10, 12]) { c.beginPath(); c.moveTo(mid + dx, py); c.lineTo(mid + dx + 2, py + 5); c.lineTo(mid + dx - 2, py + 10); c.lineTo(mid + dx, py + 15); c.stroke(); } }
    if (kind === 'air' || kind === 'air+ir') { c.strokeStyle = '#d9480f'; c.lineWidth = 1.6; for (const dx of [-18, -6, 6, 18]) { c.beginPath(); c.moveTo(mid + dx, py + 2); c.lineTo(mid + dx, py + 17); c.moveTo(mid + dx - 3, py + 13); c.lineTo(mid + dx, py + 17); c.lineTo(mid + dx + 3, py + 13); c.stroke(); } c.lineWidth = 1; }
    xz += z.len;
  });
  // the two lanes: the film (its thickness drawn to scale within the lane) on its web; skins darker; the air up from below
  const lanes = [[rt, 'top only', topY + boxH + 14], [rb, 'top and bottom', topY + boxH + 14 + 58]], laneH = 26, h0 = rt.h0;
  for (const [r, name, y] of lanes) {
    c.fillStyle = mut; c.textAlign = 'right';
    if (name === 'top only') c.fillText('top only', L - 8, y + laneH / 2); else { c.fillText('top and', L - 8, y + laneH / 2 - 6); c.fillText('bottom', L - 8, y + laneH / 2 + 7); }
    const web = y + laneH;
    c.fillStyle = fibre; c.fillRect(X(x0), web, X(x1) - X(x0), 6);
    const S = r.series, sc = laneH / h0, film = cssVar('--slurry') === '#000' ? '#8a6a3f' : '#7a5a33';
    // the wet film, then the skins over it
    c.fillStyle = film; c.beginPath(); c.moveTo(X(S[0].x), web);
    S.forEach(q => c.lineTo(X(q.x), web - q.h * sc)); c.lineTo(X(S[S.length - 1].x), web); c.closePath(); c.fill();
    c.fillStyle = '#3b2a18';
    c.beginPath(); S.forEach((q, k) => { const yy = web - q.h * sc; k ? c.lineTo(X(q.x), yy) : c.moveTo(X(q.x), yy); }); for (let k = S.length - 1; k >= 0; k--) c.lineTo(X(S[k].x), web - (S[k].h - S[k].skinT) * sc); c.closePath(); c.fill();
    if (S.some(q => q.skinB > 0)) { c.beginPath(); S.forEach((q, k) => { const yy = web; k ? c.lineTo(X(q.x), yy) : c.moveTo(X(q.x), yy); }); for (let k = S.length - 1; k >= 0; k--) c.lineTo(X(S[k].x), web - S[k].skinB * sc); c.closePath(); c.fill(); }
    // events: skin, dry, boiling
    const mark = (x, t, col, above = true) => { if (x == null || x < x0 || x > x1) return; c.strokeStyle = col; c.setLineDash([3, 2]); c.beginPath(); c.moveTo(X(x), y - 4); c.lineTo(X(x), web + 8); c.stroke(); c.setLineDash([]); const flip = X(x) + 3 + c.measureText(t).width > w - 2; c.fillStyle = col; c.textAlign = flip ? 'right' : 'left'; c.fillText(t, X(x) + (flip ? -3 : 3), above ? y - 2 : web + 14); };
    mark(r.events.skinTop, 'skin', ink);
    if (r.events.dry != null) mark(r.events.dry, 'dry', cssVar('--ok'));
    if (r.events.boil != null) mark(r.events.boil, r.events.boilSkin ? 'boils under the skin' : 'boils', bad, false);
  }
  // the air blown up into the fibre (under the lower lane, below its labels)
  const ay = lanes[1][2] + laneH + 22;
  xz = 0;
  c.strokeStyle = '#d9480f'; c.fillStyle = '#d9480f'; c.lineWidth = 1.4;
  OVEN.zones.forEach(z => { if (z.airU > 0) for (let f = 0.2; f < 1; f += 0.3) { const xx = X(xz + f * z.len); c.beginPath(); c.moveTo(xx, ay + 14); c.lineTo(xx, ay + 2); c.moveTo(xx - 3, ay + 6); c.lineTo(xx, ay + 2); c.lineTo(xx + 3, ay + 6); c.stroke(); } xz += z.len; });
  c.lineWidth = 1; c.textAlign = 'left'; c.fillStyle = mut; c.fillText('air up into the fibre', X(0) + 4, ay + 20 > h - 4 ? h - 6 : ay + 20);
  // the place looked through
  if (DRY.x != null) { const xx = X(DRY.x); c.strokeStyle = cssVar('--accent'); c.lineWidth = 2; c.beginPath(); c.moveTo(xx, topY + boxH + 4); c.lineTo(xx, lanes[1][2] + laneH + 8); c.stroke(); c.lineWidth = 1; }
  // the scale along the line
  c.fillStyle = mut; c.textAlign = 'center';
  for (const v of dryTicks(x0, x1)) c.fillText(`${+v.toFixed(2)}`, X(v), h - 5);
  c.textAlign = 'right'; c.fillText('m', w - 2, h - 5);
  void surf; void warn;
}
const dryTicks = (a, b) => { const span = b - a, step = span > 12 ? 2 : span > 5 ? 1 : span > 2 ? 0.5 : 0.25, out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6)); return out; };

function dryStats(rt, rb) {
  const both = (f, fmt) => `${fmt(f(rt))} · ${fmt(f(rb))}`;
  const pe = r => (r.rates.find(q => q.name !== 'room') || r.rates[0]).Pe;
  const tiles = [
    ['Dry at', both(r => r.exit.dry ? r.events.dry : null, v => v == null ? 'not dry' : `${v.toFixed(2)} m`), 'check'],
    ['Water left at the exit', both(r => r.exit.waterPct, v => `${v.toFixed(1)} %`), 'drop'],
    ['Skin forms at', both(r => r.events.skinTop, v => v == null ? 'none' : `${v.toFixed(2)} m`), 'film'],
    ['Film at the exit', both(r => r.exit.h * 1e6, v => `${v.toFixed(0)} µm`), 'film'],
    ['Hottest film', both(r => r.Tmax, v => `${v.toFixed(0)} °C`), 'oven'],
    ['Drying Peclet, zone 1', both(pe, v => v >= 100 ? v.toExponential(1) : v.toFixed(1)), 'bars'],
  ];
  document.getElementById('dryStats').innerHTML = tiles.map(([l, v, ic]) => `<div class="stat" title="${l} — top only · top and bottom: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong><small>top only · top and bottom</small></div>`).join('')
    + `<p class="fv-why dry-where">Along the line from the oven's entry (m); negative: in the room before it.</p>`;
}

/** The charts along the line (both ways: solid top only, dashed top and bottom) and through the film. */
function dryCharts(rt, rb) {
  const col = dryFilmColor(DRY.sel), web = cssVar('--warn'), mut = cssVar('--muted'), soft = cssVar('--soft'), ok = cssVar('--ok');
  const x0 = rt.xStart, x1 = rt.xEnd, ways = [[rt, []], [rb, [6, 4]]];
  // the stretches as bands (the room and every other zone shaded) and the oven's entry
  const bands = [], zx = [0];
  if (x0 < 0) bands.push({ x0, x1: 0, c: soft });
  OVEN.zones.forEach((z, i) => { const a = zx[zx.length - 1]; zx.push(a + z.len); if (i % 2) bands.push({ x0: a, x1: a + z.len, c: soft }); });
  const vl = x0 < 0 ? [{ x: 0, c: mut, t: 'oven' }] : [];
  const common = { x0, x1, xl: 'along the line (m)', xticks: dryTicks(x0, x1), xf: v => `${+v.toFixed(2)}`, bands };
  const lg = (id, items) => { const el = document.getElementById(id + 'Lg'); if (el) el.innerHTML = oneDLegend(items); };
  const cv = id => document.getElementById(id);
  // 1. water in the film
  const W0 = rt.W0 * 1000, meas = dryExitMeasured(DRY.sel);
  plotChart(cv('dr1'), DRY_ASPECT, { ...common, y0: 0, y1: W0 * 1.05, yl: 'water (g/m²)', yd: 0, vl: [...vl, ...ways.map(([r], k) => r.exit.dry ? { x: r.events.dry, c: ok, t: k ? 'dry (top + bottom)' : 'dry (top only)' } : null).filter(Boolean)],
    s: [...ways.map(([r, dash]) => ({ p: r.series.map(q => [q.x, (q.wet + q.bound) * 1000]), c: col, w: 2, dash })),
      ...(meas.length ? [{ p: meas.filter(m => Number.isFinite(m.water)).map(m => [x1, m.water / 100 * rt.mGO * 1000]), c: col, line: false, dots: true }] : [])] });
  lg('dr1', [[dryFilmName(DRY.sel), col], ...(meas.some(m => Number.isFinite(m.water)) ? [['measured at the exit', col, 'dot']] : [])]);
  // 2. temperatures: the film's top and bottom, the air, the measured
  const air = [];
  const stretches = rt.rates;
  stretches.forEach(q => { const T = q.name === 'room' ? MAT.dry.Troom.v : OVEN.zones[+q.name.split(' ')[1] - 1].airT; air.push([q.x0, T], [q.x1, T]); });
  const mt = dryTempMeasured(DRY.sel), kinds = { top: col, web, air: mut };
  const Tall = [...rt.series, ...rb.series].flatMap(q => [q.Ts, q.Tb]).concat(air.map(p => p[1]), mt.map(m => m.T));
  const Thi = Math.max(...Tall), Tlo = Math.min(0, ...Tall);
  plotChart(cv('dr2'), DRY_ASPECT, { ...common, y0: Tlo, y1: Math.ceil(Thi / 10) * 10 + 10, yl: 'temperature (°C)', yd: 0, vl,
    hl: [{ y: rt.Tboil, c: cssVar('--bad'), t: `water boils (${rt.Tboil.toFixed(0)} °C)`, left: true }],
    s: [{ p: air, c: mut, w: 1.4, dash: [2, 3] }, ...ways.flatMap(([r, dash]) => [{ p: r.series.map(q => [q.x, q.Ts]), c: col, w: 2, dash }, { p: r.series.map(q => [q.x, q.Tb]), c: web, w: 2, dash }]),
      ...['top', 'web', 'air'].map(k => ({ p: mt.filter(m => m.kind === k).map(m => [m.x, m.T]), c: kinds[k], line: false, dots: true })).filter(q => q.p.length)] });
  lg('dr2', [['the film\'s top', col], ['its bottom (the web)', web], ['the air', mut, 'dash'], ...(mt.length ? [['measured', col, 'dot']] : [])]);
  // 3. evaporation
  // (the scale from what the film does along most of the line: a brief spike -- water condensing as the cold film
  // enters, or the first flash -- runs off it and is said so)
  const E = [...rt.series, ...rb.series].flatMap(q => [q.Et, q.Eb]).map(v => v * 1000).sort((a, b) => a - b);
  const q = f => E[Math.min(E.length - 1, Math.max(0, Math.round(f * (E.length - 1))))];
  const Ehi = Math.max(0.01, q(0.98)) * 1.15, Elo = Math.min(0, Math.max(E[0], -Ehi)), clipped = E[0] < Elo - 1e-9 || E[E.length - 1] > Ehi;
  plotChart(cv('dr3'), DRY_ASPECT, { ...common, y0: Elo, y1: Ehi, yl: 'evaporation (g/(m²·s))', yd: 2, vl, hl: Elo < 0 ? [{ y: 0, c: mut, t: clipped && (cv('dr3').parentElement.clientWidth || 800) > 520 ? 'below: condensing (off the scale at the entry)' : 'below: condensing', below: true }] : [],
    s: ways.flatMap(([r, dash], k) => [{ p: r.series.map(q => [q.x, q.Et * 1000]), c: col, w: 2, dash }, ...(k ? [{ p: r.series.map(q => [q.x, q.Eb * 1000]), c: web, w: 2, dash }] : [])]) });
  lg('dr3', [['from the top', col], ['from the bottom (top and bottom only)', web, 'dash']]);
  // 4. the film and its skin
  plotChart(cv('dr4'), DRY_ASPECT, { ...common, y0: 0, y1: rt.h0 * 1e6 * 1.05, yl: 'thickness (µm)', yd: 0, vl,
    s: ways.flatMap(([r, dash]) => [{ p: r.series.map(q => [q.x, q.h * 1e6]), c: col, w: 2, dash }, { p: r.series.map(q => [q.x, (q.skinT + q.skinB) * 1e6]), c: mut, w: 2, dash }]) });
  lg('dr4', [['the film', col], ['its skin (top and bottom together)', mut]]);
  // 5. through the film at the chosen place: solids against height from the web
  const prof = r => r.profiles.reduce((a, b) => Math.abs(b.x - DRY.x) < Math.abs(a.x - DRY.x) ? b : a, r.profiles[0]);
  const pt = prof(rt), pb = prof(rb), hmax = Math.max(pt.h, pb.h) * 1e6;
  const stair = p => { const out = []; for (let k = 0; k < p.z.length - 1; k++) { out.push([p.phi[k] * 100, p.z[k] * 1e6], [p.phi[k] * 100, p.z[k + 1] * 1e6]); } return out; };
  plotChart(cv('dr5'), DRY_ASPECT, { x0: 0, x1: 100, y0: 0, y1: hmax * 1.08, xl: 'solids (vol%)', yl: 'height above the web (µm)', yd: 0, xticks: [0, 20, 40, 60, 80, 100], xf: v => String(v),
    s: [{ p: stair(pt), c: col, w: 2 }, { p: stair(pb), c: col, w: 2, dash: [6, 4] }], vl: [{ x: MAT.slurry.phi.v, c: mut, t: 'as coated' }, { x: MAT.slurry.phiDry.v * 100, c: mut, t: 'packed' }] });
  const where = pt.label === 'exit' ? 'at the oven\'s exit' : pt.x < 0 ? `${(-pt.x).toFixed(2)} m before the oven` : `${pt.x.toFixed(2)} m into the oven`;
  lg('dr5', [[`${where}: the top ${Math.round(pt.T[pt.T.length - 1])} °C, the bottom ${Math.round(pt.T[0])} °C (top only)`, col], ['top and bottom', col, 'dash']]);
}

/** The table: every film, both ways, and the measured at the exit beside them. */
function dryTable() {
  const host = document.getElementById('dryTable');
  const films = DRY.res.films, fm = (v, d, u = '') => v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}${u}`;
  const rows = films.map(f => {
    const [rt, rb] = dryRuns(f.key), meas = dryExitMeasured(f.key);
    const one = (r, w) => `<tr${f.key === DRY.sel ? ' class="sel"' : ''}><th scope="row">${w === 'top' ? `<i class="loc-dot" style="background:${dryFilmColor(f.key)}"></i>${f.key === 'web' ? 'The web' : f.key} <small>${(f.h0 * 1000).toFixed(3)} mm wet (${dryEsc(f.src)})</small>` : ''}</th>
      <td>${w === 'top' ? 'top only' : 'top and bottom'}</td><td>${r.exit.dry ? dryPlace(r.events.dry) : 'not dry'}</td><td>${fm(r.exit.waterPct, 1, ' %')} <small>${fm(r.exit.water * 1000, 0, ' g/m²')}</small></td>
      <td>${r.events.skinTop == null ? 'none' : dryPlace(r.events.skinTop)}</td><td>${fm(r.exit.h * 1e6, 0)}</td><td>${fm(r.Tmax, 0)}</td><td>${r.events.boil != null ? `<span class="warn-text">${dryPlace(r.events.boil)}${r.events.boilSkin ? ' (under the skin)' : ''}</span>` : 'no'}</td></tr>`;
    const m = meas.map(q => `<tr class="meas"><th scope="row"></th><td>measured${q.name ? ` <small>${dryEsc(q.name)}</small>` : ''}</td><td>${Number.isFinite(q.dryAt) ? `${q.dryAt.toFixed(2)} m` : '—'}</td><td>${Number.isFinite(q.water) ? `${q.water.toFixed(1)} %` : '—'}</td><td>—</td><td>${Number.isFinite(q.h) ? q.h.toFixed(0) : '—'}</td><td>—</td><td>—</td></tr>`).join('');
    return one(rt, 'top') + one(rb, 'both') + m;
  }).join('');
  host.innerHTML = `<h3 class="oned-h">The drying at each location</h3><div class="oned-scroll"><table class="cfd-table dry-table">
    <thead><tr><th>Film</th><th>Water leaves</th><th>Dry at</th><th>Water left at the exit <small>% of the GO</small></th><th>Skin forms at</th><th>Film at the exit <small>µm</small></th><th>Hottest <small>°C</small></th><th>Boils</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function dryNoteText(r) {
  const d = MAT.dry, len = ovenTime(lineSpeed()).len;
  return `Each film is a strip of the wet film on its web, followed from the blade through the room (${P.oven} m, ${d.Troom.v} °C, ${d.rhRoom.v} % humidity) and the oven (${+len.toFixed(2)} m, ${OVEN.zones.length} zones) at the line's speed; through its thickness the water moves against the flakes (their collective diffusion, Routh–Russel) and leaves at the surface; where the solids reach the dry film's packing (${MAT.slurry.phiDry.v}) a skin forms and the water then leaves as vapour through it; the heat comes from the air blown up through the fibre, the air or IR above (each zone's), the walls' radiation, and goes into evaporating the water. The dry GO keeps ${(r.Xb * 100).toFixed(1)} % water at the last zone's humidity (its isotherm, the Drying card). Compare with your oven temperatures and the film at the exit below. Solved in ${(DRY.ms / 1000).toFixed(1)} s.`;
}

// ---- measured drying (Q54): temperatures in the oven, values at its exit ----
const dryExitMeasured = key => (MAT.dryMeas.exit || []).filter(q => q.loc === key);
const dryTempMeasured = key => (MAT.dryMeas.temps || []).flatMap(s => s.rows.filter(q => (q.loc || 'web') === key));
function dryMeasured(rt, rb) {
  const host = document.getElementById('dryMeas');
  if (!host) return;
  const m = MAT.dryMeas, locs = [['web', 'The web'], ...CFD_LOCS.map((l, i) => [`L${i + 1}`, `L${i + 1}`])];
  const rms = (r, kind) => { const pts = dryTempMeasured(DRY.sel).filter(q => q.kind === kind); if (!r || !pts.length) return null;
    const key = kind === 'top' ? 'Ts' : 'Tb'; if (kind === 'air') return null;
    const c = drSample(r.series, key, pts.map(q => q.x)); return Math.sqrt(pts.reduce((a, q, k) => a + (q.T - c[k]) ** 2, 0) / pts.length); };
  const cmp = rt ? ['top', 'web'].map(k => { const a = rms(rt, k), b = rms(rb, k); return a == null ? '' : `<li>${k === 'top' ? 'The film\'s top' : 'The web'}: the computed differ from your ${dryTempMeasured(DRY.sel).filter(q => q.kind === k).length} readings by ${a.toFixed(1)} °C (top only) and ${b.toFixed(1)} °C (top and bottom), root mean square.</li>`; }).join('') : '';
  host.innerHTML = `<h3 class="oned-h">Measured drying</h3>
    <div class="dry-meas">
      <div class="dry-mcol"><h4>Temperatures in the oven</h4>
        <div class="or-btns"><button class="btn btn-secondary btn-sm" type="button" id="dryTImport">Import temperatures…</button> <button class="btn btn-secondary btn-sm" type="button" id="dryTPaste">Paste temperatures</button></div>
        <div id="dryTBox" class="or-paste" hidden><textarea rows="5" aria-label="Temperatures to paste" placeholder="position_m,temperature_C,what,location&#10;0.5,62,film top,web&#10;2.0,88,web,web&#10;3.0,99,air,web"></textarea><div><button class="btn btn-secondary btn-sm" type="button" id="dryTOk">Add these temperatures</button> <span class="fv-why">A header row naming the columns: position along the oven (m; or time in the oven, s), temperature (°C), what (film top, web, or air), location (L1–L4 or web; the web if left out).</span></div></div>
        <ul class="dry-list">${(m.temps || []).map((s, k) => `<li>${dryEsc(s.name)} <small>${s.rows.length} readings</small> <button type="button" class="linkish" data-drydel="temps:${k}">Remove</button></li>`).join('') || '<li class="fv-why">None yet: shown as dots over the temperatures.</li>'}</ul>
        ${cmp ? `<ul class="dry-cmp">${cmp}</ul>` : ''}</div>
      <div class="dry-mcol"><h4>At the oven's exit</h4>
        <div class="dry-exit-form">
          <label>Film <select id="dryELoc">${locs.map(([k, t]) => `<option value="${k}"${k === DRY.sel ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>Water left <span class="prop-v"><input type="number" id="dryEWater" min="0" max="400" step="0.1" placeholder="—"><span class="prop-u">% of the dry GO</span></span></label>
          <label>Dry film <span class="prop-v"><input type="number" id="dryEH" min="0" max="100000" step="1" placeholder="—"><span class="prop-u">µm</span></span></label>
          <label>Looks dry at <span class="prop-v"><input type="number" id="dryEAt" min="-10" max="200" step="0.05" placeholder="—"><span class="prop-u">m into the oven</span></span></label>
          <button class="btn btn-secondary btn-sm" type="button" id="dryEAdd">Add</button>
        </div>
        <ul class="dry-list">${(m.exit || []).map((q, k) => `<li>${q.loc === 'web' ? 'The web' : q.loc}: ${[Number.isFinite(q.water) ? `${q.water} % water` : '', Number.isFinite(q.h) ? `${q.h} µm` : '', Number.isFinite(q.dryAt) ? `dry at ${q.dryAt} m` : ''].filter(Boolean).join(', ')} <button type="button" class="linkish" data-drydel="exit:${k}">Remove</button></li>`).join('') || '<li class="fv-why">None yet: shown in the table and over the water.</li>'}</ul></div>
    </div>`;
  const wire = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
  wire('dryTImport', () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.csv,.txt,.tsv,.dat,text/csv,text/plain';
    inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; try { dryAddTemps(f.name, await f.text()); } catch (e) { imgToast(`Could not read ${f.name}: ${e.message}`, 'error'); } }; inp.click(); });
  wire('dryTPaste', () => { const b = document.getElementById('dryTBox'); b.hidden = !b.hidden; if (!b.hidden) b.querySelector('textarea').focus(); });
  wire('dryTOk', () => { const ta = document.querySelector('#dryTBox textarea'); if (ta && ta.value.trim()) dryAddTemps('pasted temperatures', ta.value); });
  wire('dryEAdd', () => {
    const num = id => { const el = document.getElementById(id), v = el.value.trim(); return v === '' ? NaN : +v; };
    const q = { loc: document.getElementById('dryELoc').value, water: num('dryEWater'), h: num('dryEH'), dryAt: num('dryEAt') };
    if (![q.water, q.h, q.dryAt].some(Number.isFinite)) { imgToast('Type at least one measured value (water left, dry film or where it looks dry).', 'error'); return; }
    if ((Number.isFinite(q.water) && (q.water < 0 || q.water > 400)) || (Number.isFinite(q.h) && q.h < 0)) { imgToast('A measured value is out of range.', 'error'); return; }
    undoHint('Add a measured exit value');
    MAT = { ...MAT, dryMeas: { ...MAT.dryMeas, exit: [...(MAT.dryMeas.exit || []), q] } };
    render();
  });
}
function dryMeasRemove(kind, k) {
  undoHint(kind === 'temps' ? 'Remove measured temperatures' : 'Remove a measured exit value');
  const list = (MAT.dryMeas[kind] || []).slice(); list.splice(k, 1);
  MAT = { ...MAT, dryMeas: { ...MAT.dryMeas, [kind]: list } };
  render();
}
function dryAddTemps(name, text) {
  const t = dryTempTable(text, lineSpeed());
  if (!t.rows.length) { imgToast(`${name}: no temperatures found (${t.problems.join('; ') || 'a header row with position and temperature columns'}).`, 'error'); return; }
  undoHint(`Import temperatures ${name}`);
  MAT = { ...MAT, dryMeas: { ...MAT.dryMeas, temps: [...(MAT.dryMeas.temps || []), { name, rows: t.rows }] } };
  if (t.skipped || t.problems.length) imgToast(`${name}: ${t.rows.length} readings${t.skipped ? `, ${t.skipped} rows left out` : ''}${t.problems.length ? `; ${t.problems.join('; ')}` : ''}.`);
  render();
}
/**
 * A table of temperatures (CSV, tab or semicolon; decimal commas): columns by name -- position along the oven (m, or
 * mm when the header says so) or time in the oven (s: × the line speed U), temperature (°C), what (film top, web or
 * air), location (L1–L4 or web). Returns { rows: [{ x, T, kind, loc }], skipped, problems }.
 */
function dryTempTable(text, U) {
  const lines = String(text).replace(/\r/g, '').split('\n').filter(l => l.trim());
  const out = { rows: [], skipped: 0, problems: [] };
  if (lines.length < 2) { out.problems.push('a header row and at least one reading are needed'); return out; }
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const head = lines[0].split(sep).map(h => h.trim().toLowerCase());
  const find = re => head.findIndex(h => re.test(h));
  const iT = find(/temp|°c|^t$|^t[ _(]/), iX = find(/pos|dist|along|place|^x\b|^x[ _(]/), iS = find(/time|^t_s|\(s\)|_s$/), iK = find(/what|kind|probe|type|where|sensor/), iL = find(/loc|lane|across/);
  if (iT < 0) { out.problems.push('no temperature column'); return out; }
  if (iX < 0 && iS < 0) { out.problems.push('no position (m) or time (s) column'); return out; }
  const mm = iX >= 0 && /mm/.test(head[iX]);
  const num = s => { const t = String(s ?? '').trim().replace(/\s/g, ''); if (!t) return NaN; return +(sep !== ',' ? t.replace(',', '.') : t); };
  for (const l of lines.slice(1)) {
    const c = l.split(sep), T = num(c[iT]), x = iX >= 0 ? num(c[iX]) * (mm ? 1e-3 : 1) : num(c[iS]) * U;
    if (!Number.isFinite(T) || !Number.isFinite(x)) { out.skipped++; continue; }
    const k = iK >= 0 ? String(c[iK] || '').toLowerCase() : '', kind = /air/.test(k) ? 'air' : /web|bottom|fib|under|back/.test(k) ? 'web' : 'top';
    const lv = iL >= 0 ? String(c[iL] || '').trim().toUpperCase() : '', loc = /^L[1-4]$/.test(lv) ? lv : 'web';
    out.rows.push({ x, T, kind, loc });
  }
  return out;
}
function dryExportCSV() {
  if (!DRY.res) return;
  const rows = [['film', 'water leaves', 'x_m', 't_s', 'top_C', 'bottom_C', 'evap_top_g_m2s', 'evap_bottom_g_m2s', 'water_g_m2', 'film_um', 'skin_top_um', 'skin_bottom_um']];
  for (const r of DRY.res.runs) for (const q of r.series) rows.push([r.key, r.where === 'top' ? 'top only' : 'top and bottom', q.x, q.t, q.Ts, q.Tb, q.Et * 1000, q.Eb * 1000, (q.wet + q.bound) * 1000, q.h * 1e6, q.skinT * 1e6, q.skinB * 1e6]);
  downloadCSV(`drying-${csvStamp()}.csv`, rows);
}

// ---- Materials: the drying card ----
// (its values are edited in the material hub, mathub-ui.js)
/** The card read-only (the report). */
const dryCardRows = () => MAT_DRY.map(([k, l, u, , , , dd]) => [l, (+MAT.dry[k].v).toFixed(dd), u, MAT.dry[k].flag, MAT.dry[k].src]);
