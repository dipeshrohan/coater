/*
 * ui-1d.js — Flow › 1D (Gap flow, To the oven, Across the web; Start-up is the animation, ui.js's
 * viewA), its solves in cfd-1d-worker.js, the 1D / 2D / 3D comparison, and Flow › 3D (not built yet).
 *
 * The 1D uses the 2D's inputs (cfd-ui.js's cfdGeometry: the blade shape, exit face, rheology model,
 * fibre slip and each location's own values), so the two stages compare like for like. It solves in
 * a worker as the inputs change; a page shows the last results with "Solving" until the new arrive.
 */
const ONE_D = { loc: 0, res: null, key: null, across: null, acrossKey: null, busy: false, again: false, worker: null, id: 0, error: null, ms: 0 };
const ACROSS_N = 61, ACROSS_W = 300;   // positions across the web (mm) for Across the web

/** A location's 1D inputs: the 2D's (its own values where it has them), SI. */
function oneDGeo(i) {
  const g = cfdGeometry(i);
  return { z: g.z, shape: g.shape, U: g.U, H: g.H, L: g.L, R: g.R, Xup: g.Xup, exitAngle: g.exitAngle, contactDeg: g.contactDeg, webSlip: g.webSlip,
    Pup: g.Pup, muRef: g.muRef, ty: g.ty, n: g.n, gamma: g.gamma, rho: g.rho, g: g.g, ovenDistance: g.ovenDistance };
}
/** At z (mm) across the web: the shared inputs with that position's gap and contact angle (no location's own values). */
function oneDGeoAt(z) {
  const uses = RHEO_MODELS[CFDG.model].uses;
  return { ...oneDGeo(0), z, U: P.U / 60, H: cfdLocalGapMm(z) / 1000, contactDeg: cfdLocalContactDeg(z), Pup: P.Pup * 1000, muRef: P.mu,
    ty: uses.includes('ty') ? P.ty : 0, n: uses.includes('n') ? P.n : 1, gamma: P.g };
}
const oneDRipple = () => ({ dHum: P.dH, vibUm: P.vib, lamMm: P.lam });

/** Ask the worker for the 1D results these inputs need (the positions across the web only for that page). */
function oneDRequest(needAcross) {
  const locs = CFD_LOCS.map((_, i) => oneDGeo(i)), ripple = oneDRipple();
  const key = JSON.stringify([locs, ripple]);
  const across = needAcross ? Array.from({ length: ACROSS_N }, (_, k) => oneDGeoAt(ACROSS_W * k / (ACROSS_N - 1))) : null;
  const aKey = across ? JSON.stringify([across, ripple]) : null;
  if (key === ONE_D.key && (!needAcross || aKey === ONE_D.acrossKey)) return;
  if (ONE_D.busy) { ONE_D.again = true; return; }
  ONE_D.busy = true; ONE_D.again = false;
  if (!ONE_D.worker) ONE_D.worker = new Worker('cfd-1d-worker.js');
  const id = ++ONE_D.id;
  ONE_D.worker.onmessage = e => {
    if (e.data.id !== id) return;
    ONE_D.busy = false;
    if (e.data.ok) {
      ONE_D.res = { locs: e.data.locs }; ONE_D.key = key; ONE_D.error = null; ONE_D.ms = e.data.ms;
      if (e.data.across) { ONE_D.across = e.data.across; ONE_D.acrossKey = aKey; }
    } else ONE_D.error = e.data.error;
    if (ONE_D.again || [8, 9, 10, 11].includes(tab)) render();
  };
  ONE_D.worker.onerror = e => { ONE_D.busy = false; ONE_D.error = e.message || 'the 1D worker failed'; if ([8, 9, 10, 11].includes(tab)) render(); };
  ONE_D.worker.postMessage({ id, locs, across: needAcross && aKey !== ONE_D.acrossKey ? across : null, ripple });
}
/** The results shown are for the inputs as they are (else they are the previous ones, being replaced). */
const oneDCurrent = () => ONE_D.key === JSON.stringify([CFD_LOCS.map((_, i) => oneDGeo(i)), oneDRipple()]);
/** Wait for the 1D results of the inputs as they are (the report). */
async function oneDWait(needAcross) {
  for (let k = 0; k < 600; k++) {
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
      ${row('Blade', CFDG.shape === 'round' ? `round entry R ${CFDG.R} mm, pool ${CFDG.pool} mm` : `flat land ${P.L} mm`)}
      ${row('Exit face', `${CFDG.exitAngle}°`)}
      ${row('Rheology', RHEO_MODELS[CFDG.model].l)}
      ${row('Fibre (web slip)', FIBRES[CFDG.fibre].l)}
      ${row('Location shown', `L${i + 1} · z ${CFD_LOCS[i].z} mm`)}
      <p class="prop-note">The 1D uses the same blade, rheology, fibre and locations as the 2D, so the two compare like for like. They are set in 2D.</p>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="oneDToCfd">Edit in 2D</button></div>
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
  document.getElementById('st').innerHTML = ONE_D.error ? pill('The 1D could not be solved: ' + ONE_D.error, 'bad') : pill('Solving the 1D…', '');
  document.getElementById('ss').innerHTML = '';
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
      { id: 'g1', title: 'Pressure along the blade', aria: 'Pressure along the blade, 1D and 2D', legend: oneDLegend([['1D', cssVar('--accent')], ['2D, along the web (if solved)', cssVar('--muted'), 'dash']]),
        note: 'The bead pressure at the inlet (the pool edge, or the start of the flat land) falls to ambient at the metering edge. The 2D line is its pressure along the web; there the meniscus sets the pressure at the edge.' },
      { id: 'g2', title: 'Gap along the blade', aria: 'Gap height along the blade' },
      { id: 'g3', title: 'Shear stress on the walls', aria: 'Shear stress on the web and on the blade', legend: oneDLegend([['on the web', cssVar('--accent')], ['on the blade', cssVar('--warn')]]),
        note: 'The shear stress the slurry puts on the moving web and on the fixed blade, along the blade.' },
      { id: 'g4', title: 'Velocity across the gap', aria: 'Velocity profiles across the gap', legend: oneDLegend([['inlet', cssVar('--muted')], ['midway', cssVar('--ok')], ['metering edge', cssVar('--accent')]]),
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
  if (!oneDCurrent()) st += pill('Solving for the inputs as they are…', 'warn');
  document.getElementById('st').innerHTML = st;
  const kMax = L.p.indexOf(Math.max(...L.p)), n = L.x.length - 1;
  document.getElementById('ss').innerHTML = [
    ['Flow rate q', (L.q * 1e6).toFixed(3) + ' mm²/s'],
    ['Wet film q / U', mm(L.film) + ' mm'],
    [`Peak pressure, at ${(L.x[kMax] * 1000).toFixed(1)} mm`, `${L.p[kMax].toFixed(0)} Pa`],
    ['Pressure gradient at the edge', (L.G[n] / 1000).toFixed(1) + ' kPa/m'],
    ['Web shear at the edge', L.tauWeb[n].toFixed(1) + ' Pa'],
    ['Blade shear at the edge', L.tauBlade[n].toFixed(1) + ' Pa'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
  document.getElementById('oneDTable').innerHTML = oneDCompareTable();
}

/** The 1D / 2D / 3D table: per location, each stage's film, flow rate, peak pressure and contact line. */
function oneDCompareTable() {
  const R = ONE_D.res;
  if (!R) return '';
  const cell = (v, ref, d = 3) => v == null ? '<td class="na" title="not solved">—</td>' : `<td>${v.toFixed(d)}${ref != null && ref !== v ? ` <small>${v >= ref ? '+' : ''}${((v / ref - 1) * 100).toFixed(1)} %</small>` : ''}</td>`;
  const rows = [
    ['Wet film', 'mm', L => L.film * 1000, t => t.r.Q / t.geo.U * 1000, 3],
    ['Flow rate', 'mm²/s', L => L.q * 1e6, t => t.r.Q * 1e6, 3],
    ['Peak pressure', 'Pa', L => Math.max(...L.p), t => t.r.pMax, 0],
    ['Contact line up the face', 'mm', L => L.men.pinned ? 0 : L.men.s * 1000, t => t.r.mode === 'climbed' ? t.r.sCL * 1000 : 0, 2],
  ];
  const head = `<tr><th>Quantity</th><th>Stage</th>${CFD_LOCS.map((l, i) => `<th>L${i + 1}<small>z ${l.z} mm</small></th>`).join('')}</tr>`;
  const body = rows.map(([t, u, f1, f2, d]) => ['1D', '2D', '3D'].map((s, k) => `<tr${k ? '' : ' class="grp-start"'}>${k ? '' : `<th rowspan="3">${t} <small>${u}</small></th>`}<td class="stage">${s}</td>${CFD_LOCS.map((_, i) => {
    const L = R.locs[i], two = twoDAt(i), v1 = f1(L);
    if (k === 0) return cell(v1, null, d);
    if (k === 1) return two ? cell(f2(two), null, d).replace('</td>', `${two.stale ? ' <small class="warn-text">out of date</small>' : ` <small>1D ${v1 >= f2(two) ? '+' : ''}${f2(two) ? ((v1 / f2(two) - 1) * 100).toFixed(1) : '—'} %</small>`}</td>`) : cell(null);
    return '<td class="na" title="not built yet">—</td>';
  }).join('')}</tr>`).join('')).join('');
  const cols = `<colgroup><col class="c-q"><col class="c-s">${CFD_LOCS.map(() => '<col>').join('')}</colgroup>`;
  return `<h3 class="oned-h">1D, 2D and 3D compared</h3><div class="oned-scroll"><table class="cfd-table oned-cmp">${cols}${head}${body}</table></div>
    <p class="fv-note">— : not solved yet (2D: Flow › 2D, Run) or not built yet (3D). The 2D values are from the last solve at each location; the % is how far the 1D is from them. Contact line: 1D, the static meniscus on the exit face; 2D, solved with the flow.</p>`;
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
      { id: 'f1', title: 'Film near the metering edge', aria: 'Film height just after the metering edge',
        note: 'The 1D thin-film equation (surface tension, gravity, the web dragging the film) from the full gap at the edge, with the flow rate of the 1D gap flow. It settles to q / U (dashed) within a few millimetres.' },
      { id: 'f2', title: 'Film from the edge to the oven', aria: 'Film height from the metering edge to the oven' },
      { id: 'f3', title: 'Ripple on the film, blade to oven', aria: 'Ripple amplitude from the blade to the oven',
        note: 'The ripple the gap waviness (through the film\'s sensitivity to the gap) and vibration leave, levelled by surface tension on this film; a yield stress stops it at a residual.' },
      { id: 'f4', title: 'Film surface across the web', aria: 'Film surface ripple just after the blade and at the oven', legend: oneDLegend([['just after the blade', cssVar('--muted'), 'dash'], ['at the oven', cssVar('--accent')]]) },
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
  const hEnd = hs[hs.length - 1], remain = Rp.atOven * 1e6;
  document.getElementById('st').innerHTML =
    (remain > 5 ? pill('Ripple survives to the oven: ' + remain.toFixed(0) + ' µm', 'bad') : remain > 1 ? pill('Small ripple remains: ' + remain.toFixed(1) + ' µm', 'warn') : pill('Film levels out before the oven', 'ok'))
    + pill(`Film settles to ${hInf.toFixed(3)} mm within ${xs[k1].toFixed(1)} mm of the edge`, '')
    + pill(Rp.residual >= Rp.a0 && Rp.residual > 0 ? 'Yield stress blocks levelling completely' : Rp.residual > 0 ? 'Levels down to a yield-limited residual' : 'Levelling limited by viscosity only', '')
    + (F.converged ? '' : pill('The film solve did not fully settle', 'warn'))
    + (oneDCurrent() ? '' : pill('Solving for the inputs as they are…', 'warn'));
  document.getElementById('ss').innerHTML = [
    ['Film at the edge (the gap)', (L.H * 1000).toFixed(3) + ' mm'],
    ['Film at the oven', hEnd.toFixed(3) + ' mm'],
    ['Within 1 % of q / U at', xs[k1].toFixed(1) + ' mm'],
    ['Starting ripple', (Rp.a0 * 1e6).toFixed(0) + ' µm'],
    ['Levelling time', Rp.tau.toFixed(2) + ' s'],
    ['Ripple at the oven', remain.toFixed(remain < 10 ? 1 : 0) + ' µm'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
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
    panes: [
      { id: 'a1', title: 'Wet film across the web', aria: 'Wet film against position across the web', legend: oneDLegend([['1D at every position', cssVar('--accent')], ['2D at the four locations (if solved)', cssVar('--ink'), 'dot']]),
        note: 'At each position the 1D gap flow with that position\'s gap (blade waviness and fibre thickness variation) and the shared inputs.' },
      { id: 'a2', title: 'Contact line across the web', aria: 'Contact line up the exit face against position across the web', legend: oneDLegend([['1D (static meniscus)', cssVar('--accent')], ['2D (if solved)', cssVar('--ink'), 'dot']]),
        note: 'Where the meniscus leaves the blade: the static meniscus from the 1D film up the exit face, with that position\'s contact angle. Past the notch corner (dashed) the slurry reaches the dry edge.' },
    ],
  });
  const A = ONE_D.across;
  if (!A) { oneDWaiting(); return; }
  const z = A.map(r => r.z), films = A.map(r => r.film * 1000), s = A.map(r => r.men.pinned ? 0 : r.men.s * 1000);
  const two = CFD_LOCS.map((l, i) => ({ l, t: twoDAt(i) })).filter(o => o.t && !o.t.stale);
  const c1 = document.getElementById('a1'), fMin = Math.min(...films), fMax = Math.max(...films), pad = Math.max((fMax - fMin) * 0.3, 0.01);
  plotChart(c1, fitAspect(c1, 0.5), { x0: 0, x1: ACROSS_W, y0: fMin - pad, y1: fMax + pad, yl: 'wet film (mm)', xl: 'position across the web (mm)', yd: 3,
    s: [{ p: z.map((x, k) => [x, films[k]]), c: acc, w: 2.2 }, ...(two.length ? [{ p: two.map(o => [o.l.z, o.t.r.Q / o.t.geo.U * 1000]), c: ink, line: false, dots: true }] : [])] });
  const sMax = Math.max(...s, P.face);
  const c2 = document.getElementById('a2');
  plotChart(c2, fitAspect(c2, 0.5), { x0: 0, x1: ACROSS_W, y0: 0, y1: sMax * 1.25, yl: 'contact line up the face (mm)', xl: 'position across the web (mm)',
    s: [{ p: z.map((x, k) => [x, s[k]]), c: acc, w: 2.2 }, ...(two.length ? [{ p: two.map(o => [o.l.z, o.t.r.mode === 'climbed' ? o.t.r.sCL * 1000 : 0]), c: ink, line: false, dots: true }] : [])],
    hl: [{ y: P.face, c: bad, t: 'notch corner: slurry reaches the dry edge' }] });
  const over = s.filter(v => v > P.face).length, sMn = Math.min(...s), sMx = Math.max(...s), qs = A.map(r => r.q * 1e6);
  const verdict = over ? ['Slurry reaches the notch corner over ' + (over / s.length * 100).toFixed(0) + '% of the width', 'bad']
    : sMx - sMn > 0.5 ? ['Uneven contact line: ' + (sMx - sMn).toFixed(1) + ' mm peak to peak', 'warn']
      : sMx === 0 ? ['Pinned at the sharp edge everywhere', 'ok'] : ['Contact line steady', 'ok'];
  document.getElementById('st').innerHTML = pill(...verdict) + pill(`Film ${fMin.toFixed(3)} to ${fMax.toFixed(3)} mm across the web`, '')
    + (A.every(r => r.converged) ? '' : pill('A position did not converge', 'bad'))
    + (ONE_D.acrossKey === JSON.stringify([Array.from({ length: ACROSS_N }, (_, k) => oneDGeoAt(ACROSS_W * k / (ACROSS_N - 1))), oneDRipple()]) ? '' : pill('Solving for the inputs as they are…', 'warn'));
  document.getElementById('ss').innerHTML = [
    ['Wet film range', `${fMin.toFixed(3)} to ${fMax.toFixed(3)} mm`],
    ['Film variation', ((fMax - fMin) / ((fMax + fMin) / 2) * 100).toFixed(1) + ' %'],
    ['Flow rate range', `${Math.min(...qs).toFixed(2)} to ${Math.max(...qs).toFixed(2)} mm²/s`],
    ['Contact line range', `${sMn.toFixed(1)} to ${sMx.toFixed(1)} mm`],
    ['Positions solved', `${A.length} over ${ACROSS_W} mm`],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}

