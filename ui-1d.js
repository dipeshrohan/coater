/*
 * ui-1d.js — Coating › 1D (Gap flow, To the oven, Across the web, Pool and feed; Start-up is the animation, ui.js's
 * viewA), its solves in cfd-1d-worker.js, the 1D / 2D / 3D comparison, and Coating › 3D (not built yet).
 *
 * The 1D uses the 2D's inputs (cfd-ui.js's cfdGeometry: the blade shape, exit face, rheology model,
 * fibre slip and each location's own values), so the two stages compare like for like. It solves in
 * a worker when asked (solve-ctl.js: nothing solves by itself); a page shows the last results marked out of date
 * after an input change, and Solve beside them.
 */
const ONE_D = { loc: 0, res: null, key: null, across: null, acrossKey: null, busy: false, again: false, worker: null, id: 0, error: null, ms: 0 };
/** Stop the 1D (New, Open): its worker ended. */
function oneDStop() { if (ONE_D.worker) { ONE_D.worker.terminate(); ONE_D.worker = null; } ONE_D.busy = false; ONE_D.again = false; }
const ACROSS_N = 61, ACROSS_W = 300;   // positions across the web (mm) for Across the web

/** The 1D's inputs from a 2D geometry (cfd-ui.js's cfdGeometry), SI. */
const oneDFromGeo = g => ({ z: g.z, shape: g.shape, U: g.U, H: g.H, L: g.L, R: g.R, Xup: g.Xup, exitAngle: g.exitAngle, contactDeg: g.contactDeg, webSlip: g.webSlip,
  Pup: g.Pup, muRef: g.muRef, ty: g.ty, n: g.n, gamma: g.gamma, rho: g.rho, g: g.g, ovenDistance: g.ovenDistance, ...(g.blade ? { blade: g.blade } : {}), ...(g.rheoX ? { rheoX: g.rheoX } : {}), ...(g.struct ? { struct: g.struct } : {}) });
/** A location's 1D inputs: the 2D's (its own values where it has them), SI. */
const oneDGeo = i => oneDFromGeo(cfdGeometry(i));
/** At z (mm) across the web: the shared inputs with that position's gap and contact angle (no location's own values). */
function oneDGeoAt(z) {
  const uses = RHEO_MODELS[CFDG.model].uses;
  return { ...oneDGeo(0), z, U: P.U / 60 * Math.cos(skewRad()), H: cfdLocalGapMm(z) / 1000, contactDeg: cfdLocalContactDeg(z), Pup: P.Pup * 1000, muRef: P.mu,
    ty: uses.includes('ty') ? P.ty : 0, n: uses.includes('n') ? P.n : 1, gamma: P.g };
}
const oneDRipple = () => ({ dHum: P.dH, vibUm: P.vib, lamMm: P.lam });

/** The positions across the web the 1D solves (mm): evenly where both the web and the blade are (the blade may end inside). */
function acrossPositions() {
  const sp = acrossSpanNow(), a = Math.max(0, sp[0]), b = Math.min(ACROSS_W, sp[1]);
  return Array.from({ length: ACROSS_N }, (_, k) => a === 0 && b === ACROSS_W ? ACROSS_W * k / (ACROSS_N - 1) : a + (b - a) * k / (ACROSS_N - 1));
}
/** Ask the worker for the 1D results these inputs need (the positions across the web only for that page). */
function oneDRequest(needAcross) {
  // (Phase 0, solving only on request: a solve starts when asked for -- a Solve button, Solve the line, Re-solve)
  if (!solveAsked('1d')) return;
  needAcross = true;   // (a solve asked for gives the four locations and across the web together)
  const locs = CFD_LOCS.map((_, i) => oneDGeo(i)), ripple = oneDRipple();
  const key = JSON.stringify([locs, ripple]);
  const across = needAcross ? acrossPositions().map(oneDGeoAt) : null;
  const aKey = across ? JSON.stringify([across, ripple]) : null;
  if (key === ONE_D.key && (!needAcross || aKey === ONE_D.acrossKey)) { solveTake('1d'); return; }
  if (ONE_D.busy) { ONE_D.again = true; return; }
  solveTake('1d');
  ONE_D.busy = true; ONE_D.again = false;
  if (!ONE_D.worker) ONE_D.worker = makeWorker('cfd-1d-worker.js');
  const id = ++ONE_D.id;
  ONE_D.worker.onmessage = e => {
    if (e.data.id !== id) return;
    ONE_D.busy = false;
    if (e.data.ok) {
      ONE_D.res = { locs: e.data.locs }; ONE_D.key = key; ONE_D.error = null; ONE_D.ms = e.data.ms;
      if (e.data.across) { ONE_D.across = e.data.across; ONE_D.acrossKey = aKey; }
    } else ONE_D.error = e.data.error;
    if (ONE_D.again || [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17].includes(tab)) render();
  };
  ONE_D.worker.onerror = e => { ONE_D.busy = false; ONE_D.error = e.message || 'the 1D worker failed'; if ([1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17].includes(tab)) render(); };
  ONE_D.worker.postMessage({ id, locs, across: needAcross && aKey !== ONE_D.acrossKey ? across : null, ripple });
}
/** The 1D across the web, if it is for the inputs as they are (else null). */
const oneDAcrossNow = () => ONE_D.across && ONE_D.acrossKey === JSON.stringify([acrossPositions().map(oneDGeoAt), oneDRipple()]) ? ONE_D.across : null;
/** The results shown are for the inputs as they are (else they are the previous ones, being replaced). */
const oneDCurrent = () => ONE_D.key === JSON.stringify([CFD_LOCS.map((_, i) => oneDGeo(i)), oneDRipple()]);
/** Wait for the 1D results of the inputs as they are (the report). */
async function oneDWait(needAcross) {
  for (let k = 0; k < 600; k++) {
    // (Phase 0: not asked for and not solving -- nothing to wait for; the report marks it not solved)
    if (!solveAsked('1d') && !ONE_D.busy) return oneDCurrent() && (!needAcross || !!ONE_D.across);
    oneDRequest(needAcross);
    if (!ONE_D.busy && oneDCurrent() && (!needAcross || ONE_D.across)) return true;
    await new Promise(r => setTimeout(r, 50));
  }
  return false;
}

// ---- the page parts ----
/** The 2D setup the 1D uses, in the inputs bar (read-only; edited in 2D). */
function oneDSetupTree() {
  const i = ONE_D.loc;
  const row = (l, v) => `<div class="prop prop-ro"><span class="prop-l">${l}</span><span class="prop-v">${v}</span></div>`;
  document.getElementById('setupExtra').innerHTML = `
    <div class="tree-sep">1D setup</div>
    <details class="grp cfd-grp" open><summary>From the 2D setup</summary>
      ${row('Blade', CFDG.shape === 'round' ? `round entry R ${CFDG.R} mm, pool ${CFDG.pool} mm` : bladeText())}
      ${CFDG.shape === 'custom' ? '' : row('Exit face', `${CFDG.exitAngle}°`)}
      ${row('Rheology', RHEO_MODELS[CFDG.model].l)}
      ${row('Fibre (web slip)', FIBRES[CFDG.fibre].l)}
      ${row('Location shown', `L${i + 1} · z ${CFD_LOCS[i].z} mm`)}
      <p class="prop-note">The 1D uses the same blade, rheology, fibre and locations as the 2D, so the two compare like for like. They are set in 2D.</p>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="oneDToCfd">${uiIco(4)}Edit in 2D</button></div>
    </details>`;
  document.getElementById('oneDToCfd').onclick = () => { tab = 4; render(); };
}
/** The location switch of the 1D pages. */
const oneDLocTools = () => `<div class="seg" role="tablist" aria-label="Location shown" id="oneDLoc">${CFD_LOCS.map((l, i) =>
  `<button type="button" role="tab" data-l1d="${i}" aria-selected="${i === ONE_D.loc}" title="Location ${i + 1}: z ${l.z} mm across the web">L${i + 1}</button>`).join('')}</div>`;
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-l1d]'); if (b) { ONE_D.loc = +b.dataset.l1d; render(); } });
/** A legend under a chart: [label, colour, dashed]. */
const oneDLegend = items => items.map(([t, c, kind]) => `<span class="lg"><i class="${kind === 'dot' ? 'lg-dot' : 'lg-ln' + (kind ? ' dash' : '')}" style="--c:${c}"></i>${t}</span>`).join('');
/** Nothing to show yet: solving, or the error. */
function oneDWaiting() {
  // (no results: one clear panel in place of empty charts, its Solve the only one -- Phase 0, nothing solves until asked)
  const vp = document.querySelector('.mod-vp');
  document.getElementById('st').innerHTML = (ONE_D.error ? pill('The 1D could not be solved: ' + ONE_D.error, 'bad') + solveCtl('1d', null, !!vp) : solvePending('1d') ? pill('Solving the 1D…', '') : solveCtl('1d', null, !!vp));
  document.getElementById('ss').innerHTML = '';
  if (vp) vp.innerHTML = `<div class="mod-extra">${emptyHint(ONE_D.error ? 'The 1D could not be solved' : solvePending('1d') ? 'Solving the 1D…' : 'Not solved yet', ONE_D.error ? escAttr(ONE_D.error) : 'The 1D solves the flow under the blade at the four locations and across the web for the inputs as they are. Nothing is solved until you ask.', solvePending('1d') ? '' : `<button type="button" class="btn btn-primary btn-sm" data-solve="1d">${uiIco('play')}Solve the 1D</button>`)}</div>`;
}
const f3 = v => v.toFixed(3), mm = v => (v * 1000).toFixed(3);
/** The 2D result at a location, if solved (and whether it is out of date). */
const twoDAt = i => { const r = cfdRuns[i]; return r && r.field && r.result ? { r: r.result, geo: r.geo, stale: cfdIsStale(i) } : null; };

// ---------------------------------------------------------------------
// Gap flow along the blade
// ---------------------------------------------------------------------
function view1DGap() {
  oneDSetupTree();
  oneDRequest(false);
  const acc = cssVar('--accent'), mut = cssVar('--muted'), ok = cssVar('--ok'), warn = cssVar('--warn');
  view.innerHTML = moduleFrame({
    tools: oneDLocTools(),
    cols: workbenchFits() ? 2 : 1,
    panes: [
      { id: 'g1', icon: 'pressure', title: 'Pressure along the blade', aria: 'Pressure along the blade, 1D and 2D', legend: oneDLegend([['1D', cssVar('--accent')], ['2D, along the web (if solved)', cssVar('--muted'), 'dash']]),
        note: 'The bead pressure at the inlet (the pool edge, or the start of the flat land) falls to ambient at the metering edge. The 2D line is its pressure along the web; there the meniscus sets the pressure at the edge.' },
      { id: 'g2', icon: 'height', title: 'Gap along the blade', aria: 'Gap height along the blade' },
      { id: 'g3', icon: 'shear', title: 'Shear stress on the walls', aria: 'Shear stress on the web and on the blade', legend: oneDLegend([['on the web', cssVar('--accent')], ['on the blade', cssVar('--warn')]]),
        note: 'The shear stress the slurry puts on the moving web and on the fixed blade, along the blade.' },
      { id: 'g4', icon: 'profile', title: 'Velocity across the gap', aria: 'Velocity profiles across the gap', legend: oneDLegend([['inlet', cssVar('--muted')], ['midway', cssVar('--ok')], ['metering edge', cssVar('--accent')]]),
        note: 'The exact profile for the rheology: the web moves at the web speed (less the slip over the fibre), the blade is still. A yield stress leaves a flat, unsheared plug.' },
    ],
    extra: '<div class="oned-table" id="oneDTable"></div>',
  });
  const R = ONE_D.res;
  if (!R) { oneDWaiting(); return; }
  const i = ONE_D.loc, L = R.locs[i], two = twoDAt(i), xs = L.x.map(x => x * 1000);
  // pressure (1D, and the 2D along the web up to the edge)
  const pser = [{ p: xs.map((x, k) => [x, L.p[k]]), c: acc, w: 2.2 }];
  if (two) { const s = []; two.r.xWeb.forEach((x, k) => { if (x <= two.r.xe * 1.0001) s.push([x * 1000, two.r.pWeb[k]]); }); pser.push({ p: s, c: mut, w: 1.6, dash: [5, 4] }); }
  const pAll = pser.flatMap(s => s.p.map(q => q[1]));
  const c1 = document.getElementById('g1');
  const pLo = Math.min(...pAll) < -1e-3 * Math.max(...pAll) ? Math.min(...pAll) * 1.08 : 0;   // (0 at the edge: not a rounding below it)
  plotChart(c1, fitAspect(c1, 0.5), { x0: 0, x1: xs[xs.length - 1], y0: pLo, y1: Math.max(...pAll) * 1.08, yl: 'pressure (Pa)', xl: 'x along the blade (mm), metering edge at the right', yd: 0, s: pser });
  const c2 = document.getElementById('g2');
  plotChart(c2, fitAspect(c2, 0.5), { x0: 0, x1: xs[xs.length - 1], y0: 0, y1: Math.max(...L.h) * 1000 * 1.1, yl: 'gap (mm)', xl: 'x along the blade (mm)', yd: 2, s: [{ p: xs.map((x, k) => [x, L.h[k] * 1000]), c: acc, w: 2.2 }] });
  const tAll = [...L.tauWeb, ...L.tauBlade];
  const c3 = document.getElementById('g3');
  plotChart(c3, fitAspect(c3, 0.5), { x0: 0, x1: xs[xs.length - 1], y0: Math.min(0, ...tAll) * 1.08, y1: Math.max(0, ...tAll) * 1.08, yl: 'shear stress (Pa)', xl: 'x along the blade (mm)',
    s: [{ p: xs.map((x, k) => [x, L.tauWeb[k]]), c: acc, w: 2 }, { p: xs.map((x, k) => [x, L.tauBlade[k]]), c: warn, w: 2 }] });
  // (height as a fraction of the local gap, so the three stations share one scale)
  const pr = L.profiles || [], uMax = Math.max(1e-9, ...pr.flatMap(p => p.u)) * 1000;
  const c4 = document.getElementById('g4');
  plotChart(c4, fitAspect(c4, 0.5), { x0: Math.min(0, ...pr.flatMap(p => p.u)) * 1000, x1: uMax * 1.05, y0: 0, y1: 1, yl: 'height across the gap, y / h', xl: 'u (mm/s)', xd: 2, yd: 2,
    s: pr.map((p, k) => ({ p: p.u.map((u, j) => [u * 1000, p.y[j] / p.h]), c: [mut, ok, acc][k], w: 2 })) });
  // the answer, the numbers
  const film2 = two ? two.r.Q / two.geo.U : null;
  let st = pill(`Wet film ${mm(L.film)} mm at L${i + 1}, flow rate ${(L.q * 1e6).toFixed(3)} mm²/s`, '');
  st += film2 != null ? pill(`2D${two.stale ? ' (out of date)' : ''}: ${mm(film2)} mm, 1D ${L.film >= film2 ? '+' : ''}${((L.film / film2 - 1) * 100).toFixed(1)} %`, two.stale ? 'warn' : '') : pill('2D not solved at this location', '');
  st += pill(`One-viscosity estimate ${mm(L.filmLub)} mm`, '');
  if (!L.converged) st += pill('A station did not converge', 'bad');
  if (!oneDCurrent()) st += solvePending('1d') ? pill('Solving for the inputs as they are…', '') : solveCtl('1d');
  document.getElementById('st').innerHTML = st;
  const kMax = L.p.indexOf(Math.max(...L.p)), n = L.x.length - 1;
  document.getElementById('ss').innerHTML = [
    ['Flow rate q', (L.q * 1e6).toFixed(3) + ' mm²/s'],
    ['Wet film q / U', mm(L.film) + ' mm'],
    [`Peak pressure, at ${(L.x[kMax] * 1000).toFixed(1)} mm`, `${L.p[kMax].toFixed(0)} Pa`],
    ['Pressure gradient at the edge', (L.G[n] / 1000).toFixed(1) + ' kPa/m'],
    ['Web shear at the edge', L.tauWeb[n].toFixed(1) + ' Pa'],
    ['Blade shear at the edge', L.tauBlade[n].toFixed(1) + ' Pa'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
  document.getElementById('oneDTable').innerHTML = oneDCompareTable();
}

/** The 3D result at a location, if solved: a strip there, its middle station; or the full width, its station nearest the location. */
function threeDAt(i) {
  const S = typeof C3D_RES !== 'undefined' ? C3D_RES : null;
  if (!S) return null;
  const R = S.result, stale = S.key !== c3dSolveKey3(S);
  if (S.region === 'full') {
    // (the web's edges open: nothing when the width was not solved, and only stations with a film of their own, not an edge block's)
    if (!R.stations) return null;
    const zi = CFD_LOCS[i].z / 1000 - R.zOff, own = new Set(c3dFilmStations(R));
    let m = -1; R.stations.forEach((st, l) => { if (own.has(st) && (m < 0 || Math.abs(st.z - zi) < Math.abs(R.stations[m].z - zi))) m = l; });
    return { R, m, stale };
  }
  return S.loc === i ? { R, m: (R.NL - 1) / 2, stale } : null;
}
/** The 1D / 2D / 3D table: per location, each stage's film, flow rate, peak pressure and contact line. */
function oneDCompareTable() {
  const R = ONE_D.res;
  if (!R) return '';
  const cell = (v, ref, d = 3) => v == null ? '<td class="na" title="not solved">—</td>' : `<td>${v.toFixed(d)}${ref != null && ref !== v ? ` <small>${v >= ref ? '+' : ''}${((v / ref - 1) * 100).toFixed(1)} %</small>` : ''}</td>`;
  // (3D: the strip's middle station, when a strip around that location is solved)
  const rows = [
    ['Wet film', 'mm', L => L.film * 1000, t => t.r.Q / t.geo.U * 1000, 3, (R, m) => R.stations[m].film * 1000],
    ['Flow rate', 'mm²/s', L => L.q * 1e6, t => t.r.Q * 1e6, 3, (R, m) => R.stations[m].q * 1e6],
    ['Peak pressure', 'Pa', L => Math.max(...L.p), t => t.r.pMax, 0, (R, m) => { let v = -Infinity; for (let n = 0; n < R.NC * R.NR; n++) v = Math.max(v, R.p[(Math.floor(n / R.NR) * R.NL + m) * R.NR + n % R.NR]); return v; }],
    ['Contact line up the face', 'mm', L => L.men.pinned ? 0 : L.men.s * 1000, t => t.r.mode === 'climbed' ? t.r.sCL * 1000 : 0, 2, (R, m) => R.mode === 'climbed' ? R.stations[m].s * 1000 : 0],
  ];
  const head = `<tr><th>Quantity</th><th>Stage</th>${CFD_LOCS.map((l, i) => `<th>L${i + 1}<small>z ${l.z} mm</small></th>`).join('')}</tr>`;
  const three = threeDAt;
  // (the structure model on: the 3D has the plain flow curve, the 2D the structure -- said in the 3D's rows)
  const tag3 = ans3DTag();
  const body = rows.map(([t, u, f1, f2, d, f3]) => ['1D', '2D', '3D'].map((s, k) => `<tr${k ? '' : ' class="grp-start"'}>${k ? '' : `<th rowspan="3">${t} <small>${u}</small></th>`}<td class="stage">${s}${k === 2 && tag3 ? ` <small>${tag3}</small>` : ''}</td>${CFD_LOCS.map((_, i) => {
    const L = R.locs[i], two = twoDAt(i), v1 = f1(L);
    if (k === 0) return cell(v1, null, d);
    if (k === 1) return two ? cell(f2(two), null, d).replace('</td>', `${two.stale ? ' <small class="warn-text">out of date</small>' : ` <small>1D ${v1 >= f2(two) ? '+' : ''}${f2(two) ? ((v1 / f2(two) - 1) * 100).toFixed(1) : '—'} %</small>`}</td>`) : cell(null);
    const th = three(i);
    if (!th) return '<td class="na" title="not solved in 3D (Coating › 3D, a strip at this location)">—</td>';
    const v3 = f3(th.R, th.m), v2 = two && !two.stale ? f2(two) : null;
    return cell(v3, null, d).replace('</td>', `${th.stale ? ' <small class="warn-text">out of date</small>' : v2 ? ` <small>vs 2D ${v3 >= v2 ? '+' : ''}${((v3 / v2 - 1) * 100).toFixed(1)} %</small>` : ''}</td>`);
  }).join('')}</tr>`).join('')).join('');
  const cols = `<colgroup><col class="c-q"><col class="c-s">${CFD_LOCS.map(() => '<col>').join('')}</colgroup>`;
  return `<h3 class="oned-h">1D, 2D and 3D compared</h3><div class="oned-scroll"><table class="cfd-table oned-cmp">${cols}${head}${body}</table></div>
    <p class="fv-note">— : not solved yet (2D: Coating › 2D, Run; 3D: Coating › 3D, Solve 3D on a strip at that location or the full width). The 2D values are from the last solve at each location, the 3D from the middle of the last strip solved or the full width's station nearest the location; the % is how far the 1D (in the 2D row) and the 3D are from the 2D. Contact line: 1D, the static meniscus on the exit face; 2D and 3D, solved with the flow.${tag3 ? ' The structure (thixotropy) model is on: the 2D carries it, the 3D has the plain flow curve, so the 3D\'s % includes that difference and Results take the 2D (models are not mixed).' : ''}</p>`;
}

// ---------------------------------------------------------------------
// The film from the metering edge to the oven
// ---------------------------------------------------------------------
function view1DFilm() {
  oneDSetupTree();
  oneDRequest(false);
  const acc = cssVar('--accent'), warn = cssVar('--warn'), mut = cssVar('--muted');
  view.innerHTML = moduleFrame({
    tools: oneDLocTools(),
    cols: workbenchFits() ? 2 : 1,
    panes: [
      { id: 'f1', icon: 'film', title: 'Film near the metering edge', aria: 'Film height just after the metering edge',
        note: 'The 1D thin-film equation (surface tension, gravity, the web dragging the film) from the full gap at the edge, with the flow rate of the 1D gap flow. It settles to q / U (dashed) within a few millimetres.' },
      { id: 'f2', icon: 10, title: 'Film from the edge to the oven', aria: 'Film height from the metering edge to the oven' },
      { id: 'f3', icon: 'ripple', title: 'Ripple on the film, blade to oven', aria: 'Ripple amplitude from the blade to the oven',
        note: 'The ripple the gap waviness (through the film\'s sensitivity to the gap) and vibration leave, levelled by surface tension on this film; a yield stress stops it at a residual.' },
      { id: 'f4', icon: 3, title: 'Film surface across the web', aria: 'Film surface ripple just after the blade and at the oven', legend: oneDLegend([['just after the blade', cssVar('--muted'), 'dash'], ['at the oven', cssVar('--accent')]]) },
      // (the structure, GO-1: broken down along the blade, rebuilding at rest on the web)
      ...(matStruct() ? [{ id: 'f5', icon: 'model', title: 'Structure: along the blade, then at rest on the web', aria: 'Structure lambda against time, under the blade and on the web to the oven',
        note: 'λ, flux weighted over the flow (0 broken down, 1 built up): steady at the inlet\'s shear rate, broken down under the blade, then rebuilding at rest on the web; its viscosity and yield stress follow it, so the ripple levels until the rebuilding yield stress holds it.' }] : []),
    ],
  });
  const R = ONE_D.res;
  if (!R) { oneDWaiting(); return; }
  const i = ONE_D.loc, L = R.locs[i], F = L.filmToOven, Rp = L.ripple;
  if (!F || !F.x) { document.getElementById('st').innerHTML = pill('The film to the oven could not be solved' + (F && F.error ? ': ' + F.error : ''), 'bad'); return; }
  const xs = F.x.map(x => x * 1000), hs = F.h.map(h => h * 1000), hInf = F.hInf * 1000;
  let k1 = hs.findIndex(h => Math.abs(h - hInf) <= 0.01 * hInf); if (k1 < 0) k1 = hs.length - 1;
  // near the edge: out to five times the settling distance (at least 10 mm)
  const xNear = Math.min(xs[xs.length - 1], Math.max(10, 5 * xs[k1])), near = xs.map((x, k) => [x, hs[k]]).filter(q => q[0] <= xNear);
  const hLo = Math.min(...hs, hInf), hHi = Math.max(...hs, hInf), pad = Math.max((hHi - hLo) * 0.25, 0.005);
  const c1 = document.getElementById('f1');
  plotChart(c1, fitAspect(c1, 0.5), { x0: 0, x1: xNear, y0: hLo - pad, y1: hHi + pad, yl: 'film (mm)', xl: 'distance from the metering edge (mm)', yd: 3, xd: 1,
    s: [{ p: near, c: acc, w: 2.2 }], hl: [{ y: hInf, c: mut, t: 'q / U' }] });
  const c2 = document.getElementById('f2');
  plotChart(c2, fitAspect(c2, 0.5), { x0: 0, x1: xs[xs.length - 1], y0: hLo - pad, y1: hHi + pad, yl: 'film (mm)', xl: 'distance from the metering edge (mm)', yd: 3,
    s: [{ p: xs.map((x, k) => [x, hs[k]]), c: acc, w: 2.2 }], hl: [{ y: hInf, c: mut, t: 'q / U' }] });
  const U = L.U, ds = Rp.t.map(t => t * U * 1000), as = Rp.a.map(a => a * 1e6);
  const c3 = document.getElementById('f3');
  plotChart(c3, fitAspect(c3, 0.5), { x0: 0, x1: ds[ds.length - 1], y0: 0, y1: Math.max(Rp.a0 * 1e6 * 1.1, 5), yl: 'ripple amplitude (µm)', xl: 'distance from the blade (mm)',
    s: [{ p: ds.map((x, k) => [x, as[k]]), c: acc, w: 2.2 }], vl: [{ x: Rp.tRes * U * 1000, c: warn, t: 'oven' }] });
  const lam = P.lam, win = Math.max(lam * 3, 20), p0 = [], p1 = [];
  for (let k = 0; k <= 200; k++) { const zz = win * k / 200, sn = Math.sin(2 * Math.PI * zz / lam); p0.push([zz, Rp.a0 * 1e6 * sn]); p1.push([zz, Rp.atOven * 1e6 * sn]); }
  const ym = Math.max(Rp.a0 * 1e6 * 1.3, 10);
  const c4 = document.getElementById('f4');
  plotChart(c4, fitAspect(c4, 0.5), { x0: 0, x1: win, y0: -ym, y1: ym, yl: 'film deviation (µm)', xl: 'across the web (mm)',
    s: [{ p: p0, c: mut, dash: [5, 4] }, { p: p1, c: acc, w: 2.4 }] });
  const St = L.struct, c5 = document.getElementById('f5');
  if (St && c5) {
    // (time from entering the gap: under the blade, the lines' mean time at each station; then at rest on the web)
    const tE = St.tMean, blade = St.tAlong.map((t, k) => [t, St.along[k]]), web = [];
    for (let k = 0; k <= 120; k++) { const t = Rp.tRes * k / 120; web.push([tE + t, 1 - (1 - St.exit) * Math.exp(-t / St.S.tb)]); }
    plotChart(c5, fitAspect(c5, 0.5), { x0: 0, x1: tE + Rp.tRes, y0: 0, y1: 1, yd: 2, xticks: niceTicks(0, tE + Rp.tRes, 5), xf: v => String(+v.toPrecision(6)), yl: 'structure λ', xl: 'time from entering the gap (s)',
      s: [{ p: blade, c: acc, w: 2.2 }, { p: web, c: acc, w: 2.2, dash: [6, 4] }], vl: [{ x: tE, c: mut, t: 'metering edge' }, { x: tE + Rp.tRes, c: warn, t: 'oven' }] });
  }
  const hEnd = hs[hs.length - 1], remain = Rp.atOven * 1e6;
  document.getElementById('st').innerHTML =
    (remain > 5 ? pill('Ripple survives to the oven: ' + remain.toFixed(0) + ' µm', 'bad') : remain > 1 ? pill('Small ripple remains: ' + remain.toFixed(1) + ' µm', 'warn') : pill('Film levels out before the oven', 'ok'))
    + pill(`Film settles to ${hInf.toFixed(3)} mm within ${xs[k1].toFixed(1)} mm of the edge`, '')
    + pill(Rp.residual >= Rp.a0 && Rp.residual > 0 ? 'Yield stress blocks levelling completely' : Rp.residual > 0 ? 'Levels down to a yield-limited residual' : 'Levelling limited by viscosity only', '')
    + (L.struct ? pill(`Structure λ ${L.struct.exit.toFixed(2)} leaving the blade (${L.struct.tMean.toFixed(0)} s under it), ${(1 - (1 - L.struct.exit) * Math.exp(-Rp.tRes / L.struct.S.tb)).toFixed(2)} at the oven${Rp.tFrozen != null && Rp.residualRested > 0 ? (Rp.tFrozen === 0 ? '; the yield stress holds the ripple from the start' : `; the rebuilding yield stress holds the ripple from ${Rp.tFrozen < 10 ? Rp.tFrozen.toFixed(1) : Rp.tFrozen.toFixed(0)} s`) : ''}`, '') : '')
    + (F.converged ? '' : pill('The film solve did not fully settle', 'warn'))
    + (oneDCurrent() ? '' : solvePending('1d') ? pill('Solving for the inputs as they are…', '') : solveCtl('1d'));
  document.getElementById('ss').innerHTML = [
    ['Film at the edge (the gap)', (L.H * 1000).toFixed(3) + ' mm'],
    ['Film at the oven', hEnd.toFixed(3) + ' mm'],
    ['Within 1 % of q / U at', xs[k1].toFixed(1) + ' mm'],
    ['Starting ripple', (Rp.a0 * 1e6).toFixed(0) + ' µm'],
    ['Levelling time', Rp.tau.toFixed(2) + ' s'],
    ['Ripple at the oven', remain.toFixed(remain < 10 ? 1 : 0) + ' µm'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}

// ---------------------------------------------------------------------
// Across the web: the gap flow at every position
// ---------------------------------------------------------------------
function view1DAcross() {
  oneDSetupTree();
  oneDRequest(true);
  const acc = cssVar('--accent'), bad = cssVar('--bad'), ink = cssVar('--ink');
  view.innerHTML = moduleFrame({
    cols: workbenchFits() ? 2 : 1,
    top: `<div class="acr-top"><section class="acr-view"><h3>${uiBadge('wave')}The blade across the web, seen from the front <span class="acr-sub">the gap's change, each part and their sum; drag a handle</span></h3><div class="acr-front" id="acrFront"></div></section>
      <aside class="acr-panel" aria-label="The blade across the web">${acrossPanelHTML('pg')}</aside></div>`,
    panes: [
      { id: 'a1', icon: 'film', title: 'Wet film across the web', aria: 'Wet film against position across the web', legend: oneDLegend([['1D at every position', cssVar('--accent')], ...(acrossCrownNow() ? [['with the best parabola', ACROSS_COLS.bow, 'dash'], ['with the free curve', ACROSS_COLS.meas, 'dash']] : []), ['2D at the four locations (if solved)', cssVar('--ink'), 'dot']]),
        note: 'At each position the 1D gap flow with that position\'s gap (the blade across the web above, and the fibre thickness variation) and the shared inputs; where the blade ends inside the web, only up to its ends.' },
      { id: 'a2', icon: 1, title: 'Contact line across the web', aria: 'Contact line up the exit face against position across the web', legend: oneDLegend([['1D (static meniscus)', cssVar('--accent')], ['2D (if solved)', cssVar('--ink'), 'dot']]),
        note: 'Where the meniscus leaves the blade: the static meniscus from the 1D film up the exit face, with that position\'s contact angle. Past the notch corner (dashed) the slurry reaches the dry edge.' },
    ],
  });
  drawAcrossFront(document.getElementById('acrFront'));
  const A = ONE_D.across;
  if (!A) { oneDWaiting(); return; }
  const z = A.map(r => r.z), films = A.map(r => r.film * 1000), s = A.map(r => r.men.pinned ? 0 : r.men.s * 1000);
  const two = CFD_LOCS.map((l, i) => ({ l, t: twoDAt(i) })).filter(o => o.t && !o.t.stale), zA = z[0], zB = z[z.length - 1];
  const c1 = document.getElementById('a1'), fMin = Math.min(...films), fMax = Math.max(...films), pad = Math.max((fMax - fMin) * 0.3, 0.01);
  // (a crown found for these inputs: the film each variant gives, dashed)
  const cr = acrossCrownNow(), crS = cr ? [{ p: cr.zs.map((x, k) => [x, cr.parab[k] * 1000]), c: ACROSS_COLS.bow, w: 1.6, dash: [6, 4] }, { p: cr.zs.map((x, k) => [x, cr.free[k] * 1000]), c: ACROSS_COLS.meas, w: 1.6, dash: [6, 4] }] : [];
  const allF = [...films, ...(cr ? [...cr.parab, ...cr.free].map(v => v * 1000) : [])], fLo = Math.min(...allF), fHi = Math.max(...allF), padF = Math.max((fHi - fLo) * 0.3, 0.01);
  plotChart(c1, fitAspect(c1, 0.5), { x0: Math.min(0, zA), x1: Math.max(ACROSS_W, zB), y0: fLo - padF, y1: fHi + padF, yl: 'wet film (mm)', xl: 'position across the web (mm)', yd: 3,
    s: [{ p: z.map((x, k) => [x, films[k]]), c: acc, w: 2.2 }, ...crS, ...(two.length ? [{ p: two.map(o => [o.l.z, o.t.r.Q / o.t.geo.U * 1000]), c: ink, line: false, dots: true }] : [])] });
  const sMax = Math.max(...s, P.face);
  const c2 = document.getElementById('a2');
  plotChart(c2, fitAspect(c2, 0.5), { x0: Math.min(0, zA), x1: Math.max(ACROSS_W, zB), y0: 0, y1: sMax * 1.25, yl: 'contact line up the face (mm)', xl: 'position across the web (mm)',
    s: [{ p: z.map((x, k) => [x, s[k]]), c: acc, w: 2.2 }, ...(two.length ? [{ p: two.map(o => [o.l.z, o.t.r.mode === 'climbed' ? o.t.r.sCL * 1000 : 0]), c: ink, line: false, dots: true }] : [])],
    hl: [{ y: P.face, c: bad, t: 'notch corner: slurry reaches the dry edge' }] });
  const over = s.filter(v => v > P.face).length, sMn = Math.min(...s), sMx = Math.max(...s), qs = A.map(r => r.q * 1e6);
  const verdict = over ? ['Slurry reaches the notch corner over ' + (over / s.length * 100).toFixed(0) + '% of the width', 'bad']
    : sMx - sMn > 0.5 ? ['Uneven contact line: ' + (sMx - sMn).toFixed(1) + ' mm peak to peak', 'warn']
      : sMx === 0 ? ['Pinned at the sharp edge everywhere', 'ok'] : ['Contact line steady', 'ok'];
  document.getElementById('st').innerHTML = pill(...verdict) + pill(`Film ${fMin.toFixed(3)} to ${fMax.toFixed(3)} mm across the web`, '')
    + (A.every(r => r.converged) ? '' : pill('A position did not converge', 'bad'))
    + (ONE_D.acrossKey === JSON.stringify([acrossPositions().map(oneDGeoAt), oneDRipple()]) ? '' : solvePending('1d') ? pill('Solving for the inputs as they are…', '') : solveCtl('1d'))
    + (ACR.bow.on && ACR.bow.mode === 'computed' && acrossBowComputed().error ? pill('Bow not computed: ' + acrossBowComputed().error, 'bad') : '');
  document.getElementById('ss').innerHTML = [
    ['Wet film range', `${fMin.toFixed(3)} to ${fMax.toFixed(3)} mm`],
    ['Film variation', ((fMax - fMin) / ((fMax + fMin) / 2) * 100).toFixed(1) + ' %'],
    ['Flow rate range', `${Math.min(...qs).toFixed(2)} to ${Math.max(...qs).toFixed(2)} mm²/s`],
    ['Contact line range', `${sMn.toFixed(1)} to ${sMx.toFixed(1)} mm`],
    ['Gap range', (() => { const g = z.map(v => localGap(v)); return `${Math.min(...g).toFixed(3)} to ${Math.max(...g).toFixed(3)} mm`; })()],
    ['Positions solved', `${A.length} over ${+(zB - zA).toFixed(1)} mm`],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}


// ---------------------------------------------------------------------
// Pool and feed: the paste falling from the outlets in pulses, the pool's level through a cycle, the film it leaves
// ---------------------------------------------------------------------
/** The pool's cycle from the 1D (feed-pulse.js): the four locations' films and their sensitivity to the bead pressure. */
function feedNow() {
  const R = ONE_D.res;
  if (!R || R.locs.some(L => !Number.isFinite(L.dfdP))) return null;
  const g0 = oneDGeo(0), n = R.locs.length, mean = f => R.locs.reduce((a, L) => a + f(L), 0) / n, W = ACROSS_W / 1000;
  const round = g0.shape === 'round' && !g0.blade;
  const o = { W, U: R.locs[0].U, film0: mean(L => L.film), dfdP: mean(L => L.dfdP), rho: g0.rho, g: g0.g, Pup: g0.Pup, R: g0.R, H: mean(L => L.H),
    xBack: P.fBack / 1000, V: P.fV * 1e-6, tau: P.fTau, ...(round ? {} : { meets: () => g0.Xup }),
    pipes: { n: P.fN, Do: P.fDo / 1000, tip: P.fTip / 1000, entry: feedEntry() } };
  const c = feedCycle(o);
  if (c.error) return { error: c.error, o, round };
  const zs = feedZs().map(z => z / 1000);
  const out = feedOutlets({ V: o.V, tau: o.tau, n: P.fN, d: P.fD / 1000, Do: P.fDo / 1000, tip: P.fTip / 1000, x: P.fX / 1000, zs, W, g: o.g, rho: o.rho, xBack: o.xBack, entry: feedEntry() }, c);
  return { c, o, out, zs, round };
}
/** The pool and its outlets seen from the side (x along the web, y up; mm, true scale): the blade, the pool at its mean
 *  level and the two levels a cycle moves between, an outlet and how its paste enters (a falling stream, a heap up to the
 *  tip, or the tip in the paste), with their dimensions. */
function feedSideSVG(F, w, h) {
  const { c, o } = F, R = o.R * 1e3, H = o.H * 1e3, tip = P.fTip, xO = -P.fX, d = P.fD, Do = Math.max(P.fDo, d), xB = -P.fBack, entry = feedEntry();
  const meetsMm = hh => (F.round ? feedMeetsBlade(hh / 1e3, o.R, o.H) : o.meets(0)) * 1e3;
  const xMin = Math.min(xB, xO - d) - 22, xMax = 26, yMax = Math.max(tip + 16, c.hHigh * 1e3 + 18);
  const L = 10, Rg = 10, T = 10, B = 58, s = Math.min((w - L - Rg) / (xMax - xMin), (h - T - B) / yMax);
  const X = x => L + (x - xMin) * s, Y = y => h - B - y * s, f = v => v.toFixed(1), g = [];
  const under = x => F.round ? H + R - Math.sqrt(Math.max(0, R * R - x * x)) : (x >= -o.meets(0) * 1e3 ? H : yMax);
  // the pool at its mean level: from its back edge to the blade, down the blade's face to the edge
  const lev = c.hBar * 1e3, xm = -meetsMm(lev);
  let pool = `M${f(X(xB))} ${f(Y(0))} L${f(X(xB))} ${f(Y(lev))} L${f(X(xm))} ${f(Y(lev))}`;
  for (let k = 1; k <= 60; k++) { const x = xm * (1 - k / 60); pool += ` L${f(X(x))} ${f(Y(Math.min(lev, under(x))))}`; }
  g.push(`<path class="fd-paste" d="${pool} L${f(X(0))} ${f(Y(0))} Z"/>`);
  // the blade: from the drawing's top down its face to the metering edge, then its face square to the web
  const x0 = F.round ? -Math.sqrt(Math.max(0, R * R - (R + H - yMax) ** 2)) : -o.meets(0) * 1e3;
  let bl = `M${f(X(Math.max(xMin, x0)))} ${f(Y(yMax))}`;
  for (let k = 0; k <= 80; k++) { const x = Math.max(xMin, x0) * (1 - k / 80); bl += ` L${f(X(x))} ${f(Y(Math.min(yMax, under(x))))}`; }
  g.push(`<path class="fd-blade" d="${bl} L${f(X(0))} ${f(Y(yMax))} Z"/>`);
  // the levels a cycle moves between (tags left of the pool's back edge: after a pulse above, the camera's below)
  for (const [hh, up] of [[c.hHigh, true], [c.hLow, false]]) {
    const y = hh * 1e3;
    g.push(`<line class="fd-lev" x1="${f(X(xB))}" x2="${f(X(-meetsMm(y)))}" y1="${f(Y(y))}" y2="${f(Y(y))}"/><text class="fd-t" x="${f(X(xB) - 3)}" y="${f(Y(y) + (up ? -2 : 10))}" text-anchor="end">${y.toFixed(1)}</text>`);
  }
  g.push(`<line class="fd-web" x1="${f(X(xMin))}" x2="${f(X(xMax))}" y1="${f(Y(0))}" y2="${f(Y(0))}"/>`);
  g.push(`<line class="fd-wall" x1="${f(X(xB))}" x2="${f(X(xB))}" y1="${f(Y(0))}" y2="${f(Y(Math.max(lev, c.hHigh * 1e3) + 3))}"/>`);
  // the outlet, and how its paste enters: a falling stream (it narrows as it speeds up), a heap standing from the top up to
  //  the tip (as wide as the pipe, hanging from its rim, spreading at its foot), or nothing to draw: the tip in the paste
  const dl = F.out.dLand * 1e3, yL = c.hHigh * 1e3;
  if (entry === 'heap' && tip > lev) {
    const r0 = Do / 2, foot = Do;
    let hp = `M${f(X(xO - r0))} ${f(Y(tip))}`;
    for (let k = 0; k <= 12; k++) { const t = k / 12, y = tip - (tip - lev) * t, r = r0 + (foot - r0) * t ** 3; hp += ` L${f(X(xO - r))} ${f(Y(y))}`; }
    for (let k = 12; k >= 0; k--) { const t = k / 12, y = tip - (tip - lev) * t, r = r0 + (foot - r0) * t ** 3; hp += ` L${f(X(xO + r))} ${f(Y(y))}`; }
    g.push(`<path class="fd-paste" d="${hp} Z"/>`);
  }
  g.push(`<rect class="fd-pipe" x="${f(X(xO - Do / 2))}" y="${f(Y(yMax))}" width="${f(Do * s)}" height="${f((yMax - tip) * s)}"/><rect class="fd-bore" x="${f(X(xO - d / 2))}" y="${f(Y(yMax))}" width="${f(d * s)}" height="${f((yMax - tip) * s)}"/>`);
  if (entry === 'fall' && tip > yL) g.push(`<path class="fd-stream" d="M${f(X(xO - d / 2))} ${f(Y(tip))} L${f(X(xO - dl / 2))} ${f(Y(yL))} L${f(X(xO + dl / 2))} ${f(Y(yL))} L${f(X(xO + d / 2))} ${f(Y(tip))} Z"/>`);
  // dimensions: the tip's height (beside the stream), the outlet before the edge, the pool's back edge
  const xd = xO + Do / 2 + 5, yb = Y(0);
  g.push(`<line class="fd-dim" x1="${f(X(xd))}" x2="${f(X(xd))}" y1="${f(Y(0))}" y2="${f(Y(tip))}"/><line class="fd-dim" x1="${f(X(xd) - 3)}" x2="${f(X(xd) + 3)}" y1="${f(Y(tip))}" y2="${f(Y(tip))}"/>`);
  g.push(`<text class="fd-t fd-dt" x="${f(X(xd) + 4)}" y="${f(Y((tip + yL) / 2) + 4)}">tip ${tip} mm</text>`);
  const dimH = (a, b, y, t) => `<line class="fd-dim" x1="${f(X(a))}" x2="${f(X(b))}" y1="${f(y)}" y2="${f(y)}"/><line class="fd-dim" x1="${f(X(a))}" x2="${f(X(a))}" y1="${f(y - 3)}" y2="${f(y + 3)}"/><line class="fd-dim" x1="${f(X(b))}" x2="${f(X(b))}" y1="${f(y - 3)}" y2="${f(y + 3)}"/><text class="fd-t fd-dt" x="${f((X(a) + X(b)) / 2)}" y="${f(y - 4)}" text-anchor="middle">${t}</text>`;
  g.push(dimH(xO, 0, yb + 30, `outlets ${P.fX} mm before the edge`), dimH(xB, 0, yb + 50, `back edge ${P.fBack} mm`));
  g.push(`<text class="fd-t" x="${f(X(0))}" y="${f(yb + 13)}" text-anchor="middle">edge · gap ${H.toFixed(3)} mm</text><text class="fd-t" x="${f(X(xMax))}" y="${f(yb - 4)}" text-anchor="end">web →</text>`);
  return `<svg class="fd-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="The pool and an outlet seen from the side, true scale, with their dimensions">${g.join('')}</svg>`;
}
/** The pool and its outlets seen from above (across the web to the right, along it downward: the web moves down; mm, true
 *  scale): the side plates, the pool, the blade from where the pool meets it to the edge, the outlets. */
function feedPlanSVG(F, w, h) {
  const { c } = F, W = ACROSS_W, xB = -P.fBack, xO = -P.fX, d = Math.max(P.fDo, P.fD), xm = -c.meetsLow * 1e3, xMin = Math.min(xB, xO - d) - 6, xMax = 14;
  const L = 12, Rg = 40, T = 16, B = 22, s = Math.min((w - L - Rg) / (W + 16), (h - T - B) / (xMax - xMin));
  const Z = z => L + (z + 8) * s, X = x => T + (x - xMin) * s, f = v => v.toFixed(1), g = [];
  g.push(`<rect class="fd-webp" x="${f(Z(-8))}" y="${f(X(xMin))}" width="${f((W + 16) * s)}" height="${f((xMax - xMin) * s)}"/>`);
  g.push(`<rect class="fd-pastep" x="${f(Z(0))}" y="${f(X(xB))}" width="${f(W * s)}" height="${f((xm - xB) * s)}"/>`);
  g.push(`<rect class="fd-bladep" x="${f(Z(0))}" y="${f(X(xm))}" width="${f(W * s)}" height="${f(-xm * s)}"/><line class="fd-edge" x1="${f(Z(-8))}" x2="${f(Z(W + 8))}" y1="${f(X(0))}" y2="${f(X(0))}"/>`);
  for (const z of [0, W]) g.push(`<line class="fd-dam" x1="${f(Z(z))}" x2="${f(Z(z))}" y1="${f(X(xB))}" y2="${f(X(0))}"/>`);
  const r = Math.max(2.5, d / 2 * s);
  F.zs.forEach((z, i) => g.push(`<circle class="fd-out" cx="${f(Z(z * 1e3))}" cy="${f(X(xO))}" r="${f(r)}"/><text class="fd-t fd-dt" x="${f(Z(z * 1e3))}" y="${f(X(xO) - r - 3)}" text-anchor="middle">${i + 1}</text>`));
  g.push(`<text class="fd-t" x="${f(Z(W / 2))}" y="${f(X(xB) - 4)}" text-anchor="middle">pool ${(xm - xB).toFixed(0)} × ${W} mm between the side plates</text>`);
  g.push(`<text class="fd-t" x="${f(Z(W + 8) + 3)}" y="${f(X(0) + 4)}">edge</text><text class="fd-t" x="${f(Z(W + 8) + 3)}" y="${f(X(xm) + 4)}">blade</text><text class="fd-t" x="${f(Z(W / 2))}" y="${f(X(xMax) + 14)}" text-anchor="middle">the web moves down the page</text>`);
  return `<svg class="fd-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="The pool and its outlets seen from above, true scale">${g.join('')}</svg>`;
}
/** The outlets' table: each one's position across the web (editable), and the stream it gives. */
function feedPanelHTML(F) {
  const zs = feedZs(), placed = !!(FEED_POS.z && FEED_POS.z.length === P.fN);
  const rows = zs.map((z, i) => `<div class="acr-row"><span class="acr-l">Outlet ${i + 1}</span><span class="acr-v"><input class="acr-in" type="number" step="0.5" min="0" max="${ACROSS_W}" value="${z}" data-feedz="${i}" aria-label="Outlet ${i + 1} position across the web, mm"><span class="u">mm</span></span></div>`).join('');
  const o = F && F.out, entry = feedEntry(), mm = v => (v * 1e3).toFixed(1);
  const seg = `<div class="seg fd-entry" role="radiogroup" aria-label="How the paste enters the pool">${FEED_ENTRY.map(([k, t]) => `<button type="button" role="radio" data-feedentry="${k}" aria-checked="${k === entry}" aria-selected="${k === entry}">${t}</button>`).join('')}</div>`;
  const how = !o ? '' : entry === 'heap' ? `
    <div class="acr-row"><span class="acr-l">Heap, at the highest level</span><span class="acr-v">${mm(o.fall)} <span class="u">mm</span></span></div>
    <div class="acr-row"><span class="acr-l">Speed down the heap</span><span class="acr-v">${(o.vLand * 1e3).toFixed(1)} <span class="u">mm/s</span></span></div>
    <p class="acr-note">A heap stands from the top up to each tip, as wide as the pipe (${P.fDo} mm): the paste runs down it into the pool. The heaps take their width off the pool's top.</p>`
    : entry === 'dip' ? `
    <div class="acr-row"><span class="acr-l">Tip below the lowest level</span><span class="acr-v">${mm(o.depth)} <span class="u">mm</span></span></div>
    <div class="acr-row"><span class="acr-l">Speed out of the bore</span><span class="acr-v">${(o.vLand * 1e3).toFixed(1)} <span class="u">mm/s</span></span></div>
    <p class="acr-note">The tips stand in the paste: it leaves the bore inside the pool. The pipes (${P.fDo} mm across) take their width off the pool's top.</p>`
    : `
    <div class="acr-row"><span class="acr-l">Fall to the highest level</span><span class="acr-v">${mm(o.fall)} <span class="u">mm</span></span></div>
    <div class="acr-row"><span class="acr-l">Landing speed, at most</span><span class="acr-v">${(o.vLand * 1e3).toFixed(0)} <span class="u">mm/s</span></span></div>
    <p class="acr-note">Landing: free fall without drag, an upper bound; the stream thins to ${(o.dLand * 1e3).toFixed(1)} mm as it speeds up.</p>`;
  return `<div class="acr-grp">How the paste enters the pool</div>
    <div class="acr-row fd-entry-row">${seg}</div>
    <div class="acr-grp">Outlets across the web</div>
    <div class="acr-row"><span class="acr-l">${P.fN} outlet${P.fN === 1 ? '' : 's'}, ${placed ? 'placed' : 'equidistant'}</span><span class="acr-v"><button type="button" class="btn btn-secondary btn-sm" id="feedEq"${placed ? '' : ' disabled'}>Equidistant</button></span></div>
    ${rows}
    <p class="acr-note">Positions from the web's edge at z = 0 (the side plates at 0 and ${ACROSS_W} mm). The count, the tip's height, the distance before the edge, the pipe's diameters and the pulse are on the left.</p>
    ${o ? `<div class="acr-grp">Each outlet during a pulse</div>
    <div class="acr-row"><span class="acr-l">Flow</span><span class="acr-v">${(o.q * 1e6).toFixed(2)} <span class="u">ml/s</span></span></div>
    <div class="acr-row"><span class="acr-l">Speed out of the tip</span><span class="acr-v">${(o.v0 * 1e3).toFixed(1)} <span class="u">mm/s</span></span></div>${how}` : ''}`;
}
document.addEventListener('change', e => {
  const t = e.target;
  if (!t || !t.dataset || t.dataset.feedz == null) return;
  const zs = feedZs(), i = +t.dataset.feedz, v = Math.min(ACROSS_W, Math.max(0, +t.value));
  // (a render after this event, not in it: the input being replaced still has the focus)
  if (!Number.isFinite(v)) { queueRender(); return; }
  zs[i] = +v.toFixed(3); FEED_POS.z = zs; queueRender();
});
document.addEventListener('click', e => {
  if (!e.target.closest) return;
  if (e.target.closest('#feedEq')) { FEED_POS.z = null; queueRender(); return; }
  const b = e.target.closest('[data-feedentry]');
  if (b && b.dataset.feedentry !== feedEntry()) { FEED_POS.entry = b.dataset.feedentry; queueRender(); }
});

/** The report's part for Pool and feed: the feed as set, and each outlet. */
function feedReportHTML() {
  const F = ONE_D.res ? feedNow() : null, u = (v, d, unit) => `${(+v).toFixed(d)} ${unit}`;
  const rows = [['Outlets', `${P.fN}, ${FEED_POS.z && FEED_POS.z.length === P.fN ? 'placed' : 'equidistant'} at ${feedZs().join(', ')} mm across the web`],
    ['How the paste enters the pool', FEED_ENTRY.find(e => e[0] === feedEntry())[1]],
    ['Outlet tip above the web', u(P.fTip, 0, 'mm')], ['Outlets upstream of the blade edge', u(P.fX, 0, 'mm')], ['Outlet inner diameter', u(P.fD, 1, 'mm')], ['Outlet outer diameter', u(P.fDo, 1, 'mm')],
    ['Paste per pulse, all outlets', u(P.fV, 0, 'ml')], ['Pulse length', u(P.fTau, 1, 's')], ['Pool back edge upstream of the blade edge', u(P.fBack, 0, 'mm')]];
  if (F && !F.error) rows.push(['Each outlet during a pulse', `${(F.out.q * 1e6).toFixed(2)} ml/s, ${(F.out.v0 * 1e3).toFixed(1)} mm/s out of the tip, ` + (F.out.entry === 'heap' ? `${(F.out.vLand * 1e3).toFixed(1)} mm/s down a heap ${(F.out.fall * 1e3).toFixed(1)} mm high` : F.out.entry === 'dip' ? `the tip ${(F.out.depth * 1e3).toFixed(1)} mm below the lowest level` : `at most ${(F.out.vLand * 1e3).toFixed(0)} mm/s landing`)]);
  return '<h3>The feed</h3>' + repRows(rows.map(([a, b]) => [repEsc(a), repEsc(b)]), ['Input', 'Value']);
}
function view1DFeed() {
  oneDSetupTree();
  oneDRequest(false);
  const acc = cssVar('--accent'), mut = cssVar('--muted'), warn = cssVar('--warn'), ok = cssVar('--ok');
  const F = ONE_D.res ? feedNow() : null;
  view.innerHTML = moduleFrame({
    tools: oneDLocTools(),
    cols: workbenchFits() ? 2 : 1,
    top: `<div class="acr-top fd-top"><section class="acr-view"><h3>${uiBadge(15)}The pool and its outlets <span class="acr-sub">from the side, and from above; the levels a pulse cycle moves between</span></h3><div class="fd-draw" id="feedDraw"></div></section>
      <aside class="acr-panel" aria-label="The outlets">${feedPanelHTML(F && !F.error ? F : null)}</aside></div>`,
    panes: [
      { id: 'p1', icon: 'pool', title: 'Pool level through a pulse cycle', aria: 'Pool level against time over two pulse cycles', legend: oneDLegend([['level at the web', acc], ['its mean: the bead pressure input', mut, 'dash']]),
        note: 'The pool\'s volume balance: a pulse adds its paste over its length, the web carries paste away under the blade all the time (the 1D\'s flow, which grows with the level). Its mean is the level the bead pressure input gives (Pup = ρ g h).' },
      { id: 'p2', icon: 'film', title: 'Wet film along the web', aria: 'Wet film against distance along the web over three pulse cycles', legend: oneDLegend([['wet film at the location shown', acc]]),
        note: 'The film the blade leaves follows the pool\'s level (the 1D\'s sensitivity of the film to the bead pressure at this location) and moves away on the web: the cycle repeats along the web every web speed × cycle.' },
      { id: 'p3', icon: 'drop', title: 'Paste into and out of the pool', aria: 'Flow into the pool and out under the blade against time', legend: oneDLegend([['in: the pulse, all outlets', warn], ['out: under the blade, the whole width', ok]]),
        note: 'Over a cycle the two areas are equal: the pulse\'s paste. Out under the blade: the 1D\'s flow at the four locations times the width between the side plates.' },
    ],
  });
  const host = document.getElementById('feedDraw');
  if (!ONE_D.res) { if (host) host.innerHTML = ''; oneDWaiting(); return; }
  if (!F) { document.getElementById('st').innerHTML = pill('The 1D results predate the pool\'s sensitivity: solve the 1D again', 'warn') + solveCtl('1d'); return; }
  if (F.error) { document.getElementById('st').innerHTML = pill('The pulse cycle could not be found: ' + F.error, 'bad') + (oneDCurrent() ? '' : solveCtl('1d')); return; }
  const { c, out } = F, i = ONE_D.loc, Lc = ONE_D.res.locs[i], rhoG = F.o.rho * F.o.g, filmAt = hh => Lc.film + Lc.dfdP * rhoG * (hh - c.hBar);
  if (host) { const w = Math.max(420, host.clientWidth), wide = w >= 620, wS = wide ? Math.round(w * 0.56) : w, wP = wide ? w - wS - 12 : w;
    host.innerHTML = `<div class="fd-two">${feedSideSVG(F, wS, 250)}${feedPlanSVG(F, wP, wide ? 250 : 200)}</div><p class="fd-cap">Dashed: the level just after a pulse (${(c.hHigh * 1e3).toFixed(1)} mm) and when the camera fires (${(c.hLow * 1e3).toFixed(1)} mm); the paste drawn at the mean level, ${(c.hBar * 1e3).toFixed(1)} mm, the bead pressure input's. The blade's ${F.round ? `round entry (R ${(F.o.R * 1e3).toFixed(0)} mm) continued up to the pool's level` : 'pool edge as in the 2D'}. True scale.</p>`; }
  // the level over two cycles, the flows, and the film along the web over three repeats
  const T = c.T, two = [], qin = [], qout = [];
  for (const k of [0, 1]) c.t.forEach((t, j) => { two.push([t + k * T, c.h[j] * 1e3]); qin.push([t + k * T, c.Qin[j] * 1e6]); qout.push([t + k * T, c.Qout[j] * 1e6]); });
  const hLo = c.hLow * 1e3, hHi = c.hHigh * 1e3, padH = Math.max(0.2, (hHi - hLo) * 0.25);
  const c1 = document.getElementById('p1');
  plotChart(c1, fitAspect(c1, 0.5), { x0: 0, x1: 2 * T, y0: hLo - padH, y1: hHi + padH, yticks: niceTicks(hLo - padH, hHi + padH, 5), yf: v => String(+v.toPrecision(6)), xticks: niceTicks(0, 2 * T, 6), xf: v => String(+v.toPrecision(6)), yl: 'pool level (mm)', xl: 'time from a pulse (s)', yd: 2, s: [{ p: two, c: acc, w: 2.2 }], hl: [{ y: c.hBar * 1e3, c: mut, t: 'mean' }] });
  const nA = 600, band = c.band, along = [];
  for (let k = 0; k <= nA; k++) {
    const sPos = 3 * band * k / nA, tb = ((-sPos / F.o.U) % T + T) % T;
    let j = 1; while (j < c.t.length - 1 && c.t[j] < tb) j++;
    const wgt = (tb - c.t[j - 1]) / ((c.t[j] - c.t[j - 1]) || 1), hh = c.h[j - 1] + wgt * (c.h[j] - c.h[j - 1]);
    along.push([sPos * 1e3, filmAt(hh) * 1e6]);
  }
  const fLo = Math.min(...along.map(q => q[1])), fHi = Math.max(...along.map(q => q[1])), padF = Math.max(2, (fHi - fLo) * 0.3);
  const c2 = document.getElementById('p2');
  plotChart(c2, fitAspect(c2, 0.5), { x0: 0, x1: 3 * band * 1e3, y0: fLo - padF, y1: fHi + padF, yticks: niceTicks(fLo - padF, fHi + padF, 5), yf: v => String(+v.toPrecision(6)), xticks: niceTicks(0, 3 * band * 1e3, 6), xf: v => String(+v.toPrecision(6)), yl: 'wet film (µm)', xl: 'distance along the web, from the edge (mm)', yd: 0, s: [{ p: along, c: acc, w: 2.2 }],
    vl: [1, 2].map(k => ({ x: k * band * 1e3, c: mut, t: `${k} × ${(band * 1e3).toFixed(0)} mm` })) });
  const c3 = document.getElementById('p3');
  plotChart(c3, fitAspect(c3, 0.5), { x0: 0, x1: 2 * T, y0: 0, y1: Math.max(...qin.map(q => q[1])) * 1.1, yticks: niceTicks(0, Math.max(...qin.map(q => q[1])) * 1.1, 5), yf: v => String(+v.toPrecision(6)), xticks: niceTicks(0, 2 * T, 6), xf: v => String(+v.toPrecision(6)), yl: 'flow (ml/s)', xl: 'time from a pulse (s)', yd: 1, s: [{ p: qin, c: warn, w: 2 }, { p: qout, c: ok, w: 2 }] });
  // the answer, the numbers
  const fMin = filmAt(c.hLow) * 1e6, fMax = filmAt(c.hHigh) * 1e6, fMid = (fMin + fMax) / 2, bad = out.checks.filter(k => !k.ok);
  let st = pill(`A pulse every ${T.toFixed(1)} s: the pool's level swings ${(c.swing * 1e3).toFixed(2)} mm, the wet film at L${i + 1} ±${((fMax - fMin) / 2).toFixed(1)} µm (±${((fMax - fMin) / 2 / fMid * 100).toFixed(2)} %)`, '');
  const how = { fall: 'the paste falls onto the pool', heap: 'a heap stands from the pool up to each tip', dip: 'the tips stay in the paste' }[feedEntry()];
  st += bad.length ? bad.map(k => pill(k.text, 'bad')).join('') : pill(`The outlets are placed well: ${how}`, 'ok');
  st += pill('1D: the film and its sensitivity to the pool from the 1D at the four locations', '');
  if (!F.round) st += pill('This blade\'s pool meets it at the 2D\'s pool edge', 'warn');
  if (!oneDCurrent()) st += solvePending('1d') ? pill('Solving for the inputs as they are…', '') : solveCtl('1d');
  document.getElementById('st').innerHTML = st;
  document.getElementById('ss').innerHTML = [
    ['Cycle: a pulse every', T.toFixed(1) + ' s'],
    ['Pool level, camera to after a pulse', `${hLo.toFixed(2)} to ${hHi.toFixed(2)} mm`],
    ['Bead pressure through a cycle', `${(c.hLow * rhoG / 1000).toFixed(3)} to ${(c.hHigh * rhoG / 1000).toFixed(3)} kPa`],
    [`Wet film at L${i + 1}`, `${(fMin / 1000).toFixed(4)} to ${(fMax / 1000).toFixed(4)} mm`],
    ['The film repeats along the web every', (band * 1e3).toFixed(0) + ' mm'],
    ['Pool top', `${(c.area(c.hLow) * 1e4).toFixed(0)} to ${(c.area(c.hHigh) * 1e4).toFixed(0)} cm²`],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}
