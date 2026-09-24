/*
 * cfd-ui.js — the "CFD Analysis" tab.
 *
 * Runs the 2D solve -- the flow under the blade (round entry onto the
 * metering edge, or the flat land), over the blade's exit face and into
 * the free film, with the meniscus solved together with the flow -- at
 * four lateral locations (one Web Worker each, cfd-worker.js), stores
 * each solved field, and shows it as a CFD
 * post-processing view (cfd-plot.js) with flow-tracking overlays computed
 * from the stored velocity field (cfd-flowviz.js). Only the Run buttons
 * solve; every display control (field, streamlines, seeds, vectors,
 * location, comparison) re-draws from what's already stored.
 *
 * Depends on physics.js (P, RHO, GRAVITY, gapHeight, muEff, spatialNoise,
 * filmThickness), draw.js (plotChart, cssVar, pill), cfd-flowviz.js and
 * cfd-plot.js, all loaded first.
 */

// Blade geometry for the CFD domain (this tab's own inputs; changing them
// marks results out of date, like the sidebar sliders do).
//  shape 'round': round entry of radius R (mm) converging onto the metering
//    edge, which is its lowest point; the domain starts at the pool edge,
//    `pool` mm upstream, where the bead pressure acts.
//  shape 'flat': the flat land of the sidebar's land length (the lubrication
//    model's geometry).
//  exitAngle: the blade's exit face at the metering edge, degrees from the
//    web in the machine direction (90 = square to the web). The meniscus
//    meets it; its contact angle there is the sidebar's contact angle on the
//    blade, varied across the web as the Contact line tab does.
//  Fibre (the porous web): the slurry does not enter it (it is there to let
//    the drying air through), but slips over its porous surface (Beavers-
//    Joseph). fd fibre diameter (um), por porosity, kozeny the Kozeny constant
//    (permeability by Kozeny-Carman), alphaBJ the Beavers-Joseph coefficient.
//  Drying air through the fibre in the oven: airU its superficial speed
//    (m/s), airT its temperature (C) -- for the Darcy numbers only (the air's
//    path through the fibre is not modelled).
const CFDG = { shape: 'round', R: 100, pool: 40, exitAngle: 90, fd: 10, por: 0.85, kozeny: 5, alphaBJ: 1, airU: 1, airT: 100 };

/** Fibre permeability (m^2), Kozeny-Carman for a bed of fibres: k = d^2 eps^3 / (16 K (1 - eps)^2). */
function fibrePermeability() {
  const d = CFDG.fd * 1e-6, e = CFDG.por;
  return d * d * e ** 3 / (16 * CFDG.kozeny * (1 - e) ** 2);
}
/** Air viscosity (Sutherland's law) and density (ideal gas at 1 atm) at T degC. */
function airProps(Tc) {
  const T = Tc + 273.15;
  return { mu: 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4), rho: 101325 / (287.05 * T) };
}
const CFD_WEB_WIDTH_MM = 300; // the across-web axis the Contact line tab already uses
const CFD_LOCS = [37.5, 112.5, 187.5, 262.5].map((z, i) => ({ id: i + 1, z }));
const cfdRuns = CFD_LOCS.map(() => ({ status: 'idle' }));
const cfdWorkers = CFD_LOCS.map(() => null);
let cfdAutoStarted = false;

// Flow-visualization settings. Display-only: none of these re-run CFD.
const FV = {
  view: 0,                // 0..3 = one location, 'compare' = all four
  profileLoc: 0,
  base: 'speed',
  streamlines: true, density: 'medium', customN: 24, seedMode: 'auto', direction: 'forward',
  lineColor: 'none', arrows: true, lineWidth: 'normal',
  vectors: false, vectorDensity: 'medium', vectorScale: 1, vectorNormalize: false, vectorColor: false,
  yScale: 'exaggerated', settingsOpen: false,
  manualSeeds: [],        // [x, y] in metres, shared by all locations so comparisons are like for like
};
const DENSITY_N = { low: 8, medium: 16, high: 32 };
const VEC_SPACING = { low: 64, medium: 44, high: 30 };
const LINE_W = { thin: 1, normal: 1.4, thick: 2.2 };

const SCALARS = {
  speed: { label: 'Velocity magnitude |V|', short: '|V|', unit: 'mm/s', scale: 1000, kind: 'seq', zeroMin: true, arr: f => f.speed },
  pressure: { label: 'Pressure (gauge, ambient air = 0)', short: 'p', unit: 'Pa', scale: 1, kind: 'auto', autoTol: 0.02, skipCorner: true, arr: f => f.p },
  ux: { label: 'u_x, machine direction', short: 'u_x', unit: 'mm/s', scale: 1000, kind: 'auto', arr: f => f.u },
  uy: { label: 'u_y, normal to the web', short: 'u_y', unit: 'mm/s', scale: 1000, kind: 'div', floorFrac: 0.01, arr: f => f.v },
  shear: { label: 'Shear rate', short: 'shear', unit: '1/s', scale: 1, kind: 'seq', zeroMin: true, skipCorner: true, arr: f => f.shear },
  mu: { label: 'Apparent viscosity', short: 'μ', unit: 'Pa·s', scale: 1, kind: 'seq', cap: true, arr: f => f.mu },
  omega: { label: 'Vorticity', short: 'ω', unit: '1/s', scale: 1, kind: 'div', skipCorner: true, arr: f => f.omega },
  strain1: { label: 'Principal strain rate, stretching', short: 'λ₁', unit: '1/s', scale: 1, kind: 'seq', zeroMin: true, skipCorner: true, arr: f => f.strain1 },
  dissip: { label: 'Viscous dissipation μγ̇²', short: 'Φ', unit: 'kW/m³', scale: 1e-3, kind: 'seq', zeroMin: true, skipCorner: true, arr: f => f.dissipation },
};
// Line colouring by each streamline's own travel time (not a field)
const TIME_SCALAR = { key: 'time', label: 'Time along the line', short: 't', unit: 's', scale: 1, kind: 'seq', perLine: true, capped: false };
// skipCorner: the colour range leaves out the metering edge corner's singular zone (values there are clamped, and the colorbar says so)

// ---------------------------------------------------------------------
// Locations and solving
// ---------------------------------------------------------------------

/** Local gap (mm) at lateral position z (mm): the same across-web waviness and fibre-thickness variation the Contact line tab and the animation already use. */
function cfdLocalGapMm(z) {
  return gapHeight() + (P.dH * Math.sin(2 * Math.PI * z / P.lw) - P.dt * spatialNoise(z, 1.7)) / 1000;
}

/** Local contact angle on the blade (deg) at lateral position z (mm): the sidebar's value with its wetting variation, as the Contact line tab uses it. */
const cfdLocalContactDeg = z => P.th + P.dth * spatialNoise(z, 4.1);

function cfdGeometry(z) {
  const U = P.U / 60;                       // m/min -> m/s
  const H = cfdLocalGapMm(z) / 1000;        // mm -> m, gap at the metering edge
  return {
    z, shape: CFDG.shape, U, H, L: P.L / 1000, R: CFDG.R / 1000, Xup: Math.min(CFDG.pool, 0.8 * CFDG.R) / 1000, exitAngle: CFDG.exitAngle,
    contactDeg: cfdLocalContactDeg(z), webSlip: CFDG.alphaBJ / Math.sqrt(fibrePermeability()),
    Pup: P.Pup * 1000,                      // kPa -> Pa, applied at the inlet (pool edge / start of the land)
    muRef: P.mu,                            // the rheology law's reference (viscosity at 2.7 1/s, as the slider defines it)
    muRep: muEff(U / H),                    // at the representative shear rate U/H: one-viscosity estimates only
    ty: P.ty, n: P.n, rho: RHO, gamma: P.g, g: GRAVITY, ovenDistance: P.oven,
  };
}
const cfdInputsKey = geo => JSON.stringify([geo.shape, geo.U, geo.H, geo.shape === 'round' ? [geo.R, geo.Xup] : geo.L, geo.exitAngle, geo.contactDeg, geo.webSlip, geo.Pup, geo.muRef, geo.ty, geo.n, geo.gamma, geo.ovenDistance]);
const cfdIsStale = i => cfdRuns[i].field && cfdRuns[i].key !== cfdInputsKey(cfdGeometry(CFD_LOCS[i].z));

function runLocation(i) {
  const run = cfdRuns[i];
  if (run.status === 'running') return;
  const geo = cfdGeometry(CFD_LOCS[i].z);
  const worker = new Worker('cfd-worker.js');
  cfdWorkers[i] = worker;
  const t0 = performance.now();
  run.status = 'running'; run.error = null; run.progress = null;
  const finish = () => { worker.terminate(); if (cfdWorkers[i] === worker) cfdWorkers[i] = null; };
  worker.onmessage = e => {
    if (e.data.progress) { run.progress = e.data.progress; renderLocCards(); return; }
    finish();
    const ms = performance.now() - t0;
    const r = e.data.ok ? e.data.result : null;
    if (!r) { run.status = 'error'; run.error = e.data.error; }
    else if (!r.converged && !(r.stalled && r.residual < 1e-4)) {
      // a non-converged field is not a valid physical result: keep nothing from it
      run.status = 'error'; run.error = `did not converge (residual ${r.residual.toExponential(1)} after ${r.iterations} steps)`;
    } else {
      Object.assign(run, {
        status: 'done', result: r, geo, key: cfdInputsKey(geo), elapsedMs: ms,
        field: makeFlowField(r, { rho: geo.rho, ty: geo.ty }), streamCache: new Map(),
      });
      run.metrics = flowMetrics(run.field);
    }
    renderCFD();
  };
  worker.onerror = e => { finish(); run.status = 'error'; run.error = e.message || 'worker error'; renderCFD(); };
  worker.postMessage({
    geometry: geo.shape, H: geo.H, L: geo.L, R: geo.R, Xup: geo.Xup, exitAngle: geo.exitAngle, contactDeg: geo.contactDeg, webSlip: geo.webSlip,
    U: geo.U, Pup: geo.Pup, rho: geo.rho, muRef: geo.muRef, ty: geo.ty, n: geo.n, muRep: geo.muRep,
    gamma: geo.gamma, g: geo.g, ovenDistance: geo.ovenDistance,
  });
  renderCFD();
}

function runAllLocations() { CFD_LOCS.forEach((_, i) => runLocation(i)); }

function cancelAllLocations() {
  cfdWorkers.forEach((w, i) => {
    if (!w) return;
    w.terminate(); cfdWorkers[i] = null;
    cfdRuns[i].status = 'cancelled'; // any earlier result for this location is kept (and flagged if out of date)
  });
  renderCFD();
}

// ---------------------------------------------------------------------
// Post-processing (cached per stored field; never re-solves)
// ---------------------------------------------------------------------

function scalarRange(key, fields) {
  const d = SCALARS[key];
  let min = Infinity, max = -Infinity, capped = false, vref = 0;
  for (const f of fields) {
    const a = d.arr(f);
    if (!a) continue;
    vref = Math.max(vref, f.vmax * 1000);
    const cap = d.cap && f.hasPlug ? f.muCap : Infinity, skip = d.skipCorner && f.cornerZone;
    for (let k = 0; k < a.length; k++) {
      if (skip && skip[k]) continue;
      let v = a[k] * d.scale;
      if (v > cap) { v = cap; capped = true; }
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const kind = d.kind === 'auto' ? (min < -(d.autoTol ?? 1e-3) * Math.abs(max) ? 'div' : 'seq') : d.kind;
  if (kind === 'div') {
    // symmetric about zero; a floor keeps numerical noise in a ~zero field from being stretched into bold colour
    const m = Math.max(Math.abs(min), Math.abs(max), (d.floorFrac || 0) * vref) || 1;
    min = -m; max = m;
  } else if (d.zeroMin || (d.kind === 'auto' && min < 0)) min = 0;
  if (!(max > min)) max = min + 1;
  if (d.skipCorner) for (const f of fields) { const a = d.arr(f); if (a && f.cornerZone) for (let k = 0; k < a.length; k++) if (f.cornerZone[k] && (a[k] * d.scale > max || a[k] * d.scale < min)) capped = true; }
  return { key, label: d.label, short: d.short, unit: d.unit, scale: d.scale, kind, min, max, capped };
}
/** Colour range for time along the lines: 0 to the 90th percentile of the lines' total times (a few slow lines would wash the rest out; they are capped, and the colorbar says so). */
function timeRange(list) {
  const ends = list.flatMap(i => streamlinesFor(cfdRuns[i]).lines.map(l => l.t[l.t.length - 1])).sort((a, b) => a - b);
  const max = ends.length ? Math.max(1e-9, ends[Math.min(ends.length - 1, Math.floor(0.9 * ends.length))]) : 1;
  return { ...TIME_SCALAR, min: 0, max, capped: ends.some(t => t > max) };
}
const scalarFor = (range, f) => range && (range.perLine ? range : { ...range, arr: SCALARS[range.key].arr(f) });

function streamlinesFor(run) {
  const f = run.field;
  const n = FV.density === 'custom' ? Math.max(2, Math.min(80, Math.round(FV.customN) || 16)) : DENSITY_N[FV.density];
  const manual = FV.seedMode === 'manual'
    ? FV.manualSeeds.filter(([x, y]) => fieldInside(f, x, y))
    : null;
  const key = manual ? `m|${FV.direction}|${JSON.stringify(manual)}` : `a|${n}|${FV.direction}`;
  let hit = run.streamCache.get(key);
  if (!hit) {
    const seeds = manual || autoSeeds(f, n, FV.direction);
    const lines = seeds.map(p => traceStreamline(f, p, { direction: FV.direction }));
    for (const l of lines) l.t = streamlineTimes(f, l);
    hit = { seeds, lines, psiDev: lines.length ? Math.max(...lines.map(l => streamlinePsiDeviation(f, l))) : null };
    run.streamCache.set(key, hit);
  }
  return hit;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

function viewCFD() {
  const opt = (v, t, cur, dis) => `<option value="${v}"${v === cur ? ' selected' : ''}${dis ? ' disabled' : ''}>${t}</option>`;
  view.innerHTML = `
    <div class="status" id="cfdStatus"></div>
    <p class="cap cfd-lede"><b>2D Navier&ndash;Stokes flow under the blade, over its exit face and into the free film</b> at four positions across the web, with the meniscus and its contact line solved together with the flow: velocity, pressure, shear and viscosity fields. Everything below is post-processed from the stored solutions: display settings never re-run the solver.</p>
    <details class="cap-toggle"><summary>Method, validation and limits</summary><p class="cap">
      <b>Solver.</b> Steady 2D incompressible Navier&ndash;Stokes by finite elements (Taylor&ndash;Hood: quadratic velocity, linear pressure), with the viscosity varying in space exactly as the yield-stress / shear-thinning model of the other tabs says. Velocity, pressure, the free surface's position and the contact line's position are unknowns of one system, solved by Newton's method, starting from a Newtonian fluid and stepping to the real rheology. The free surface obeys the kinematic condition (no flow through it) and the stress balance with surface tension; gravity acts throughout. The flow rate is not assumed: it is whatever the bead pressure, the web and the meniscus together give.
      <b>Meniscus.</b> The contact line either stays pinned at the metering edge or climbs the exit face. It climbs when a pinned surface would leave the edge flatter than the contact angle allows (Gibbs' condition); on the face the surface leaves it at the contact angle.
      <b>Validated</b> (cfd-fem.validate.js) against exact solutions: flat-gap flow (Couette&ndash;Poiseuille, and a yield-stress fluid); the Ghia, Ghia &amp; Shin (1982) lid-driven cavity; the static meniscus on a vertical or tilted face (the Young&ndash;Laplace climb height, to 0.03%); plus mass conservation and grid convergence of the coating flow, and the round entry against the earlier stream-function solver.
      <b>Fibre.</b> The slurry does not enter the fibre (its pores are there to let the drying air through), so no slurry crosses the web surface; over that porous surface the slurry slips (Beavers&ndash;Joseph: du/dy = (&alpha;/&radic;k)(u &minus; U) at the surface), with the fibre's permeability k from Kozeny&ndash;Carman. Drying air: Darcy's law for the air speed and temperature you set; the air's path through the fibre in the oven is not modelled.
      <b>Geometry.</b> Round entry: the blade's round surface converges onto the metering edge, its lowest point; the bead pressure acts at the pool edge. Flat land: the lubrication model's geometry, for comparison. The film is followed in 2D for a stretch downstream of the edge, then by the 1D thin-film model to the oven (under Profiles).
      <b>Locations.</b> Each location's gap at the edge and contact angle on the blade use the across-web waviness, fibre-thickness and wetting variation from the sidebar, the same formulas the Contact line tab uses.
      <b>Flow tracking.</b> Streamlines are integrated (RK4) through the interpolated velocity field and checked against the stream function, which is constant along a true streamline; the drift is reported under Flow metrics.
      <b>Limits.</b> The sharp metering edge is a corner: stresses and pressure there are singular in any continuum model, so their values right at the corner depend on the mesh (the reported lowest pressure says when it sits there). Contact angle is the static one (no contact-line hysteresis). Upstream, the pool's own free surface is not modelled; flow that turns back leaves through the inlet. Steady solver: no pathlines.
    </p></details>

    <section class="cfd-block">
      <div class="cfd-head"><h3>Blade geometry</h3></div>
      <div class="fv-bar cfd-geo">
        <div class="seg" role="tablist" aria-label="Blade shape" id="cfdShape">
          <button type="button" role="tab" data-shape="round" aria-selected="${CFDG.shape === 'round'}">Round entry</button>
          <button type="button" role="tab" data-shape="flat" aria-selected="${CFDG.shape === 'flat'}">Flat land</button>
        </div>
        <label class="fv-ctl"${CFDG.shape === 'round' ? '' : ' hidden'}>Radius <input type="number" id="cfdR" min="10" max="500" step="5" value="${CFDG.R}"> mm</label>
        <label class="fv-ctl"${CFDG.shape === 'round' ? '' : ' hidden'}>Pool edge <input type="number" id="cfdPool" min="5" max="150" step="5" value="${CFDG.pool}"> mm upstream</label>
        <label class="fv-ctl">Exit face <input type="number" id="cfdExit" min="30" max="150" step="5" value="${CFDG.exitAngle}"> &deg; to the web</label>
        <span class="fv-why" id="cfdGeoNote"></span>
      </div>
      <div class="fv-bar cfd-geo">
        <span class="fv-ctl"><b>Fibre</b> (web, porous)</span>
        <label class="fv-ctl">Fibre diameter <input type="number" id="cfdFd" min="0.5" max="200" step="0.5" value="${CFDG.fd}"> µm</label>
        <label class="fv-ctl">Porosity <input type="number" id="cfdPor" min="0.3" max="0.99" step="0.01" value="${CFDG.por}"></label>
        <label class="fv-ctl">Kozeny constant <input type="number" id="cfdKoz" min="1" max="20" step="0.5" value="${CFDG.kozeny}"></label>
        <label class="fv-ctl">Beavers–Joseph α <input type="number" id="cfdAlpha" min="0.01" max="10" step="0.05" value="${CFDG.alphaBJ}"></label>
        <span class="fv-why">assumed: set to your fibre</span>
      </div>
      <div class="fv-bar cfd-geo">
        <span class="fv-ctl"><b>Drying air</b> through the fibre</span>
        <label class="fv-ctl">Air speed <input type="number" id="cfdAirU" min="0" max="50" step="0.1" value="${CFDG.airU}"> m/s</label>
        <label class="fv-ctl">Air temperature <input type="number" id="cfdAirT" min="0" max="400" step="5" value="${CFDG.airT}"> °C</label>
        <span class="fv-why">assumed</span>
      </div>
    </section>

    <section class="cfd-block">
      <div class="cfd-head"><h3>Locations</h3>
        <div class="cfd-actions">
          <button id="cfdRunAll" class="btn btn-primary" type="button">Run all 4</button>
          <button id="cfdCancel" class="btn btn-secondary" type="button" hidden>Cancel</button>
        </div>
      </div>
      <div class="loc-grid" id="cfdLocs"></div>
    </section>

    <section class="cfd-block">
      <div class="cfd-head"><h3>Flow field</h3><div class="seg" role="tablist" aria-label="Location shown" id="cfdViewSeg"></div></div>
      <div class="fv-bar">
        <label class="fv-ctl">Field <select id="fvBase">
          ${opt('speed', 'Velocity magnitude |V|', FV.base)}${opt('ux', 'u_x (machine direction)', FV.base)}${opt('uy', 'u_y (normal to web)', FV.base)}
          ${opt('shear', 'Shear rate', FV.base)}${opt('mu', 'Apparent viscosity', FV.base)}${opt('omega', 'Vorticity', FV.base)}
          ${opt('strain1', 'Principal strain rate', FV.base)}${opt('dissip', 'Viscous dissipation', FV.base)}
          ${opt('pressure', 'Pressure', FV.base)}${opt('none', 'None (geometry only)', FV.base)}
        </select></label>
        <label class="fv-chk"><input type="checkbox" id="fvStream"${FV.streamlines ? ' checked' : ''}> Streamlines</label>
        <label class="fv-chk"><input type="checkbox" id="fvVec"${FV.vectors ? ' checked' : ''}> Velocity vectors</label>
        <label class="fv-chk is-off" title="Pathlines need transient CFD data. This solver is steady-state, so there is no particle history to trace."><input type="checkbox" disabled> Pathlines <span class="fv-why">(steady solver)</span></label>
        <label class="fv-ctl">Scale <select id="fvScale">${opt('exaggerated', 'y exaggerated', FV.yScale)}${opt('true', 'True 1:1', FV.yScale)}</select></label>
      </div>
      <details class="fv-more" id="fvMore"${FV.settingsOpen ? ' open' : ''}><summary>Streamline and vector settings</summary>
        <div class="fv-grid">
          <fieldset><legend>Streamlines</legend>
            <label class="fv-ctl">Density <select id="fvDensity">${opt('low', 'Low (8)', FV.density)}${opt('medium', 'Medium (16)', FV.density)}${opt('high', 'High (32)', FV.density)}${opt('custom', 'Custom', FV.density)}</select>
              <input type="number" id="fvCustomN" min="2" max="80" step="1" value="${FV.customN}" aria-label="Custom streamline count"${FV.density === 'custom' ? '' : ' hidden'}></label>
            <label class="fv-ctl">Seeds <select id="fvSeedMode">${opt('auto', 'Automatic', FV.seedMode)}${opt('manual', 'Manual', FV.seedMode)}</select></label>
            <label class="fv-ctl">Direction <select id="fvDir">${opt('forward', 'Forward', FV.direction)}${opt('backward', 'Backward', FV.direction)}${opt('both', 'Both', FV.direction)}</select></label>
            <label class="fv-ctl">Colour <select id="fvLineColor">${opt('none', 'Plain', FV.lineColor)}${opt('speed', 'Velocity magnitude', FV.lineColor)}${opt('shear', 'Shear rate', FV.lineColor)}${opt('mu', 'Apparent viscosity', FV.lineColor)}${opt('pressure', 'Pressure', FV.lineColor)}${opt('time', 'Time along the line', FV.lineColor)}</select></label>
            <label class="fv-ctl">Width <select id="fvLineW">${opt('thin', 'Thin', FV.lineWidth)}${opt('normal', 'Normal', FV.lineWidth)}${opt('thick', 'Thick', FV.lineWidth)}</select></label>
            <label class="fv-chk"><input type="checkbox" id="fvArrows"${FV.arrows ? ' checked' : ''}> Direction arrows</label>
          </fieldset>
          <fieldset><legend>Vectors</legend>
            <label class="fv-ctl">Density <select id="fvVecDensity">${opt('low', 'Low', FV.vectorDensity)}${opt('medium', 'Medium', FV.vectorDensity)}${opt('high', 'High', FV.vectorDensity)}</select></label>
            <label class="fv-ctl">Length <select id="fvVecScale">${[0.5, 1, 1.5, 2].map(v => opt(String(v), v + '×', String(FV.vectorScale))).join('')}</select></label>
            <label class="fv-chk"><input type="checkbox" id="fvVecNorm"${FV.vectorNormalize ? ' checked' : ''}> Equal length (direction only)</label>
            <label class="fv-chk"><input type="checkbox" id="fvVecColor"${FV.vectorColor ? ' checked' : ''}> Colour by |V|</label>
          </fieldset>
        </div>
        <p class="fv-note">One colour scale per plot: colouring the streamlines or vectors switches the field colours off.</p>
      </details>
      <div id="cfdSeeds"></div>
      <div id="cfdPlots"></div>
      <div class="fv-legend" id="cfdLegend"></div>
    </section>

    <section class="cfd-block"><div class="cfd-head"><h3>Flow metrics</h3></div><div id="cfdMetrics"></div></section>
    <section class="cfd-block"><div class="cfd-head"><h3>Fibre (porous web)</h3></div><div id="cfdFibre"></div></section>
    <section class="cfd-block"><div class="cfd-head"><h3 id="cfdProfTitle">Profiles</h3></div><div id="cfdProfiles"></div></section>`;

  document.getElementById('cfdRunAll').onclick = runAllLocations;
  document.querySelectorAll('#cfdShape button').forEach(b => { b.onclick = () => { CFDG.shape = b.dataset.shape; viewCFD(); }; });
  const geoNum = (id, key, lo, hi) => {
    const el = document.getElementById(id);
    el.addEventListener('change', () => { const v = +el.value; if (Number.isFinite(v)) CFDG[key] = Math.min(hi, Math.max(lo, v)); el.value = CFDG[key]; renderCFD(); });
  };
  geoNum('cfdR', 'R', 10, 500); geoNum('cfdPool', 'pool', 5, 150); geoNum('cfdExit', 'exitAngle', 30, 150);
  geoNum('cfdFd', 'fd', 0.5, 200); geoNum('cfdPor', 'por', 0.3, 0.99); geoNum('cfdKoz', 'kozeny', 1, 20); geoNum('cfdAlpha', 'alphaBJ', 0.01, 10);
  geoNum('cfdAirU', 'airU', 0, 50); geoNum('cfdAirT', 'airT', 0, 400);
  document.getElementById('cfdCancel').onclick = cancelAllLocations;
  document.getElementById('fvMore').addEventListener('toggle', e => { FV.settingsOpen = e.target.open; });

  const bind = (id, key, parse = v => v, prop = 'value') => {
    const el = document.getElementById(id);
    el.addEventListener('change', () => { FV[key] = parse(el[prop]); renderCFD(); });
  };
  bind('fvBase', 'base');
  bind('fvStream', 'streamlines', Boolean, 'checked');
  bind('fvVec', 'vectors', Boolean, 'checked');
  bind('fvScale', 'yScale');
  bind('fvDensity', 'density');
  bind('fvCustomN', 'customN', Number);
  bind('fvSeedMode', 'seedMode');
  bind('fvDir', 'direction');
  bind('fvLineColor', 'lineColor');
  bind('fvLineW', 'lineWidth');
  bind('fvArrows', 'arrows', Boolean, 'checked');
  bind('fvVecDensity', 'vectorDensity');
  bind('fvVecScale', 'vectorScale', Number);
  bind('fvVecNorm', 'vectorNormalize', Boolean, 'checked');
  bind('fvVecColor', 'vectorColor', Boolean, 'checked');

  renderCFD();
  if (!cfdAutoStarted && cfdRuns.every(r => r.status === 'idle')) { cfdAutoStarted = true; runAllLocations(); }
}

function renderCFD() {
  if (!document.getElementById('cfdLocs')) return; // tab not showing
  const custom = document.getElementById('fvCustomN');
  if (custom) custom.hidden = FV.density !== 'custom';
  const dens = document.getElementById('fvDensity');
  if (dens) dens.disabled = custom.disabled = FV.seedMode === 'manual';
  renderCfdStatus();
  renderGeoNote();
  renderLocCards();
  renderViewSeg();
  renderSeedPanel();
  renderFlowPlots();
  renderLegend();
  renderMetrics();
  renderFibre();
  renderProfiles();
}

function renderGeoNote() {
  const el = document.getElementById('cfdGeoNote');
  if (!el) return;
  if (CFDG.shape === 'round') {
    const g = cfdGeometry(CFD_LOCS[0].z), hPool = g.H + g.R - Math.sqrt(g.R * g.R - g.Xup * g.Xup);
    const clipped = CFDG.pool > 0.8 * CFDG.R ? ` (limited to 0.8 × radius)` : '';
    el.textContent = `Domain: ${(g.Xup * 1000).toFixed(0)} mm from the pool edge${clipped}, where the gap is ${(hPool * 1000).toFixed(1)} mm, to the metering edge.`;
  } else {
    el.textContent = `Domain: the ${P.L} mm land (sidebar), bead pressure at its upstream end.`;
  }
}

function renderCfdStatus() {
  const el = document.getElementById('cfdStatus');
  const running = cfdRuns.filter(r => r.status === 'running').length;
  const solved = cfdRuns.filter(r => r.field).length;
  const failed = cfdRuns.filter(r => r.status === 'error').length;
  const stale = CFD_LOCS.filter((_, i) => cfdIsStale(i)).length;
  let html = running ? pill(`Solving ${running} of 4…`, '')
    : pill(`${solved} of 4 locations solved`, solved === 4 ? 'ok' : solved ? 'warn' : '');
  if (stale) html += pill(`${stale} out of date: inputs changed since the run`, 'warn');
  if (failed) html += pill(`${failed} failed`, 'bad');
  el.innerHTML = html;
  document.getElementById('cfdCancel').hidden = !running;
}

function renderLocCards() {
  const host = document.getElementById('cfdLocs');
  host.innerHTML = CFD_LOCS.map((loc, i) => {
    const r = cfdRuns[i];
    let cls = '', txt = 'not run';
    if (r.status === 'running') { cls = 'run'; txt = r.progress ? `solving · ${cfdStageText(r.progress.stage)}${r.progress.s < 1 ? `, rheology ${Math.round(r.progress.s * 100)}%` : ''}` : 'solving…'; }
    else if (r.status === 'error') { cls = 'bad'; txt = 'failed'; }
    else if (r.field && cfdIsStale(i)) { cls = 'warn'; txt = 'out of date'; }
    else if (r.field) { cls = r.result.converged ? 'ok' : 'warn'; txt = `solved · ${(r.elapsedMs / 1000).toFixed(1)} s${r.result.converged ? '' : ' · partly converged'}`; }
    else if (r.status === 'cancelled') { cls = 'warn'; txt = 'cancelled'; }
    const sel = FV.view === i ? ' sel' : '';
    return `<div class="loc-card${sel}">
      <div class="loc-name">Location ${loc.id}</div>
      <div class="loc-state ${cls}"${r.error ? ` title="${r.error}"` : ''}>${txt}</div>
      <label class="loc-z"><span>z</span><input type="number" min="0" max="${CFD_WEB_WIDTH_MM}" step="0.5" value="${loc.z}" data-i="${i}" aria-label="Location ${loc.id} position across the web, mm"><span>mm</span></label>
      <div class="loc-meta">gap at edge <b>${cfdLocalGapMm(loc.z).toFixed(3)}</b> mm · contact angle <b>${cfdLocalContactDeg(loc.z).toFixed(1)}</b>&deg;</div>
      <button class="btn btn-secondary btn-sm" type="button" data-run="${i}"${r.status === 'running' ? ' disabled' : ''}>Run</button>
    </div>`;
  }).join('');
  host.querySelectorAll('input[data-i]').forEach(inp => inp.addEventListener('change', () => {
    const v = Math.min(CFD_WEB_WIDTH_MM, Math.max(0, +inp.value || 0));
    CFD_LOCS[+inp.dataset.i].z = v;
    renderCFD();
  }));
  host.querySelectorAll('button[data-run]').forEach(b => { b.onclick = () => runLocation(+b.dataset.run); });
}

/** Short progress text from the solver's stage message. */
function cfdStageText(stage) {
  if (!stage) return 'starting';
  if (/at the edge/.test(stage)) return 'meniscus at the edge';
  if (/held/.test(stage)) return 'placing the contact line';
  if (/laid out again/.test(stage)) return 'refining at the contact line';
  if (/free on the face/.test(stage)) return 'contact line on the face';
  return 'solving';
}

function renderViewSeg() {
  const host = document.getElementById('cfdViewSeg');
  const items = CFD_LOCS.map((l, i) => [i, `Location ${l.id}`]).concat([['compare', 'Compare all 4']]);
  host.innerHTML = items.map(([v, t]) => `<button type="button" role="tab" aria-selected="${FV.view === v}" data-v="${v}">${t}</button>`).join('');
  host.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      FV.view = b.dataset.v === 'compare' ? 'compare' : +b.dataset.v;
      if (FV.view !== 'compare') FV.profileLoc = FV.view;
      renderCFD();
    };
  });
}

function renderSeedPanel() {
  const host = document.getElementById('cfdSeeds');
  if (FV.seedMode !== 'manual' || !FV.streamlines) { host.innerHTML = ''; return; }
  const chips = FV.manualSeeds.map(([x, y], k) =>
    `<span class="seed-chip">(${(x * 1000).toFixed(2)}, ${(y * 1000).toFixed(3)}) mm<button type="button" data-k="${k}" aria-label="Remove seed ${k + 1}">×</button></span>`).join('');
  host.innerHTML = `<div class="fv-seeds">
      <span class="fv-seeds-lead">Manual seeds: click the field, or enter</span>
      <label>x <input type="number" id="fvSeedX" step="0.1" min="0"> mm</label>
      <label>y <input type="number" id="fvSeedY" step="0.01" min="0"> mm</label>
      <button class="btn btn-secondary btn-sm" type="button" id="fvSeedAdd">Add</button>
      <button class="btn btn-secondary btn-sm" type="button" id="fvSeedClear"${FV.manualSeeds.length ? '' : ' disabled'}>Clear all</button>
      <button class="btn btn-secondary btn-sm" type="button" id="fvSeedAuto">Back to automatic</button>
      <div class="seed-list">${chips || '<span class="fv-why">No seeds yet.</span>'}</div>
    </div>`;
  document.getElementById('fvSeedAdd').onclick = () => {
    const x = parseFloat(document.getElementById('fvSeedX').value), y = parseFloat(document.getElementById('fvSeedY').value);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return;
    FV.manualSeeds.push([x / 1000, y / 1000]);
    renderCFD();
  };
  document.getElementById('fvSeedClear').onclick = () => { FV.manualSeeds = []; renderCFD(); };
  document.getElementById('fvSeedAuto').onclick = () => { FV.seedMode = 'auto'; document.getElementById('fvSeedMode').value = 'auto'; renderCFD(); };
  host.querySelectorAll('.seed-chip button').forEach(b => { b.onclick = () => { FV.manualSeeds.splice(+b.dataset.k, 1); renderCFD(); }; });
}

function locationTitle(i) {
  const r = cfdRuns[i];
  return `Location ${i + 1} · z = ${CFD_LOCS[i].z} mm · gap at edge ${(r.geo.H * 1000).toFixed(3)} mm`;
}

function renderFlowPlots() {
  const host = document.getElementById('cfdPlots');
  const compare = FV.view === 'compare';
  const list = CFD_LOCS.map((_, i) => i).filter(i => cfdRuns[i].field && (compare || i === FV.view));
  if (!list.length) {
    const running = cfdRuns.some(r => r.status === 'running');
    host.innerHTML = `<p class="cap fv-empty">${running ? 'Solving…' : compare ? 'No location has a result yet.' : `Location ${FV.view + 1} has no result yet. Run it above.`}</p>`;
    return;
  }
  const fields = list.map(i => cfdRuns[i].field);
  const ranges = {
    base: FV.base !== 'none' && SCALARS[FV.base] ? scalarRange(FV.base, fields) : null,
    line: !FV.streamlines || FV.lineColor === 'none' ? null
      : FV.lineColor === 'time' ? timeRange(list)
        : scalarRange(FV.lineColor, fields),
    speed: scalarRange('speed', fields),
  };
  const yMax = Math.max(...fields.map(f => f.Ly));
  const vmax = Math.max(...fields.map(f => f.vmax));

  host.innerHTML = list.map(i => `
    ${compare ? '' : `<div class="fv-caption">${locationTitle(i)} · ${cfdRuns[i].result.mesh.nEx} × ${cfdRuns[i].result.mesh.nEy} finite elements · <span class="fv-ex"></span>${cfdIsStale(i) ? ' · <span class="warn-text">out of date: inputs changed since this run</span>' : ''}${cfdRuns[i].result.converged ? '' : ` · <span class="warn-text">converged only to residual ${cfdRuns[i].result.residual.toExponential(1)}</span>`}</div>`}
    <div class="fv-plot${compare ? ' compact' : ''}" data-i="${i}">
      <canvas class="fv-main" role="img" aria-label="${locationTitle(i)}: CFD field with flow overlays"></canvas>
      <canvas class="fv-over" aria-hidden="true"></canvas>
      <div class="fv-tip" hidden></div>
    </div>`).join('') + (compare ? '<p class="fv-note">Same colour range, axes (y up to the largest gap), streamline settings and vector scale in all four.</p>' : '');

  host.querySelectorAll('.fv-plot').forEach(el => {
    const i = +el.dataset.i, run = cfdRuns[i], f = run.field;
    const sl = FV.streamlines ? streamlinesFor(run) : null;
    const cv = el.querySelector('.fv-main');
    const map = drawFlowPlot(cv, {
      f, webSpeed: run.geo.U, yMax, yScale: FV.yScale, compact: compare, title: compare ? locationTitle(i) + (cfdIsStale(i) ? ' (out of date)' : '') : '',
      exitAngle: run.geo.exitAngle, bladeLabel: run.geo.shape === 'round' ? `blade, round entry R ${(run.geo.R * 1000).toFixed(0)} mm` : 'blade land (fixed)',
      scalar: scalarFor(ranges.base, f), lineScalar: scalarFor(ranges.line, f),
      streamlines: sl ? sl.lines : null, lineWidth: LINE_W[FV.lineWidth] * (compare ? 0.8 : 1), arrows: FV.arrows,
      vectorSample: FV.vectors ? (nc, nr) => sampleVectors(f, nc, nr) : null,
      vectorSpacing: VEC_SPACING[FV.vectorDensity] * (compare ? 0.8 : 1), vectorScale: FV.vectorScale,
      vectorNormalize: FV.vectorNormalize, vectorVmax: vmax, vectorColor: FV.vectorColor, vectorScalar: scalarFor(ranges.speed, f),
      seeds: sl ? sl.seeds : null, manualSeeds: FV.seedMode === 'manual',
    });
    wirePlotProbe(el, cv, map, run);
    const ex = host.querySelector('.fv-ex');
    if (ex) ex.textContent = map.exaggeration > 1.05 ? `vertical scale ×${map.exaggeration.toFixed(1)}` : 'true 1:1 scale';
  });
}

/** Hover/touch probe (crosshair + values at the point, read from the stored field) and click-to-seed in manual mode. */
function wirePlotProbe(el, cv, map, run) {
  const f = run.field, over = el.querySelector('.fv-over'), tip = el.querySelector('.fv-tip');
  const dpr = window.devicePixelRatio || 1, cssW = cv.clientWidth || cv.width / dpr, cssH = parseFloat(cv.style.height) || cv.height / dpr;
  over.width = cv.width; over.height = cv.height; over.style.width = cssW + 'px'; over.style.height = cssH + 'px';
  const oc = over.getContext('2d');
  oc.setTransform(dpr, 0, 0, dpr, 0, 0);
  cv.style.cursor = FV.seedMode === 'manual' && FV.streamlines ? 'crosshair' : 'default';
  const clear = () => { oc.clearRect(0, 0, cssW, cssH); tip.hidden = true; };
  const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  const probe = e => {
    const [px, py] = at(e), p = map.toPhys(px, py);
    if (!p) { clear(); return; }
    oc.clearRect(0, 0, cssW, cssH);
    oc.strokeStyle = cssVar('--ink'); oc.globalAlpha = 0.45; oc.setLineDash([3, 3]); oc.lineWidth = 1;
    oc.beginPath(); oc.moveTo(map.left, py); oc.lineTo(map.right, py); oc.moveTo(px, map.top); oc.lineTo(px, map.bottom); oc.stroke();
    oc.setLineDash([]); oc.globalAlpha = 1;
    oc.beginPath(); oc.arc(px, py, 3.5, 0, 7); oc.fillStyle = cssVar('--surface'); oc.fill(); oc.strokeStyle = cssVar('--ink'); oc.stroke();

    const [x, y] = p, s = a => sampleField(f, a, x, y);
    if (!fieldInside(f, x, y)) {
      tip.innerHTML = `<b>x ${(x * 1000).toFixed(2)} mm · y ${(y * 1000).toFixed(3)} mm</b><span class="fv-why">outside the fluid (${f.curv && x > f.xe && y > cfdTopAt(f, x) ? 'air' : 'blade'})</span>`;
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      tip.style.left = (px + 14 + tw > cssW ? px - tw - 14 : px + 14) + 'px';
      tip.style.top = Math.max(0, Math.min(py + 14, cssH - th)) + 'px';
      return;
    }
    const vfloor = f.vmax * 1e-4 * 1000; // below this a velocity component is numerical noise, not flow
    const u = s(f.u) * 1000, v = s(f.v) * 1000, mu = f.mu ? s(f.mu) : null;
    const comp = c => Math.abs(c) < vfloor ? '≈ 0' : fmtNum(c);
    const muTxt = mu == null ? '' : f.hasPlug && mu > f.muCap ? 'μ &gt; cap (unyielded)' : `μ ${fmtNum(mu)} Pa·s`;
    tip.innerHTML = `<b>x ${(x * 1000).toFixed(2)} mm · y ${(y * 1000).toFixed(3)} mm</b>
      <span>|V| ${fmtNum(Math.hypot(u, v))} mm/s</span>
      <span>u_x ${comp(u)} · u_y ${comp(v)} mm/s</span>
      <span>shear ${fmtNum(s(f.shear))} 1/s · ${muTxt}</span>
      ${f.omega ? `<span>ω ${fmtNum(s(f.omega))} 1/s</span>` : ''}
      ${f.p ? `<span>p ${fmtNum(s(f.p))} Pa</span>` : ''}
      ${FV.seedMode === 'manual' && FV.streamlines ? '<span class="fv-why">click to add a seed here</span>' : ''}`;
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = (px + 14 + tw > cssW ? px - tw - 14 : px + 14) + 'px';
    tip.style.top = Math.max(0, Math.min(py + 14, cssH - th)) + 'px';
  };
  cv.addEventListener('pointermove', probe);
  cv.addEventListener('pointerdown', probe);
  cv.addEventListener('pointerleave', clear);
  cv.addEventListener('click', e => {
    if (FV.seedMode !== 'manual' || !FV.streamlines) return;
    const p = map.toPhys(...at(e));
    if (!p) return;
    FV.manualSeeds.push(p);
    renderCFD();
  });
}

function renderLegend() {
  const host = document.getElementById('cfdLegend');
  if (!cfdRuns.some(r => r.field)) { host.innerHTML = ''; return; }
  const items = [];
  if (FV.streamlines) {
    items.push('<span class="lg"><i class="lg-line"></i>streamline (tangent to the velocity; ψ constant along it)</span>');
    if (FV.arrows) items.push('<span class="lg"><i class="lg-arrow"></i>flow direction</span>');
    items.push(`<span class="lg"><i class="lg-seed${FV.seedMode === 'manual' ? ' man' : ''}"></i>${FV.seedMode === 'manual' ? 'your seed' : 'seed'}</span>`);
  }
  if (FV.vectors) items.push(`<span class="lg"><i class="lg-vec"></i>velocity vector${FV.vectorNormalize ? ' (direction only)' : ' (length ∝ |V|)'}</span>`);
  items.push('<span class="lg"><i class="lg-edge"></i>active metering edge</span>');
  items.push('<span class="lg"><i class="lg-line lg-surf"></i>free surface (air above)</span>');
  if (cfdRuns.some(r => r.result && r.result.mode === 'climbed')) items.push('<span class="lg"><i class="lg-seed lg-cl"></i>contact line on the exit face</span>');
  let note = '';
  if (FV.streamlines && FV.seedMode === 'auto') note = 'Automatic seeds are spaced by equal flow rate, so lines crowd where the flow is fast. ';
  if (FV.streamlines && FV.direction !== 'forward' && FV.seedMode === 'auto') note += `Seeds sit ${FV.direction === 'backward' ? 'on the outflow' : 'mid-channel'} for ${FV.direction} tracing. `;
  host.innerHTML = items.join('') + (note ? `<p class="fv-note">${note}</p>` : '');
}

/** Where a point lies, in words: at the web, the blade, the exit face, the free surface, or inside. */
function where(f, loc) {
  const [x, y] = loc, xs = `x ${(x * 1000).toFixed(2)}`;
  const at = f.curv ? f.locate(x, y) : null;
  if (at) {
    const [xi, et] = at;
    if (et < 0.5) return `<small>at the web, ${xs}</small>`;
    if (et > f.ny - 1.5) {
      const i = Math.round(xi);
      if (i <= f.iCorner) return `<small>at the blade, ${xs}</small>`;
      if (i <= f.iCL) return `<small>on the exit face, y ${(y * 1000).toFixed(3)}</small>`;
      return `<small>at the free surface, ${xs}</small>`;
    }
  }
  return `<small>at ${xs}, y ${(y * 1000).toFixed(3)}</small>`;
}

/** Numbers from the stored field (cached per run): residence times, dissipation, field viscosities for Re and Ca. */
function cfdFieldNumbers(run) {
  if (run.fieldNumbers) return run.fieldNumbers;
  const f = run.field, r = run.result, N = f.nx * f.ny, top = (f.ny - 1) * f.nx;
  let dissTot = 0, dissBlade = 0, a = 0, am = 0;
  for (let k = 0; k < N; k++) {
    const w = f.nodeArea[k], under = f.gx[k] <= r.xe;
    dissTot += w * f.dissipation[k];
    if (under) { dissBlade += w * f.dissipation[k]; if (!(f.unyielded && f.unyielded[k])) { a += w; am += w * f.mu[k]; } }
  }
  // free surface within 5 gaps of the contact line: yielded nodes only (an unyielded node's viscosity is the regularization's, not a property)
  let ms = 0, ns = 0, nu = 0;
  for (let i = r.iCL; i < f.nx && f.gx[top + i] <= r.clX + 5 * r.H; i++) { if (f.unyielded && f.unyielded[top + i]) nu++; else { ms += f.mu[top + i]; ns++; } }
  run.fieldNumbers = { res: residenceTimes(f, r.xe), dissTot, dissBlade, muBar: am / a, muS: ns ? ms / ns : null, surfYielded: ns, surfUnyielded: nu };
  return run.fieldNumbers;
}

function renderMetrics() {
  const host = document.getElementById('cfdMetrics');
  const compare = FV.view === 'compare';
  const idx = compare ? CFD_LOCS.map((_, i) => i) : [FV.view];
  if (!idx.some(i => cfdRuns[i].field)) { host.innerHTML = '<p class="cap">No result to measure yet.</p>'; return; }
  const unyieldedPct = r => {
    const f = r.field;
    if (!f.unyielded) return 0;
    let a = 0, tot = 0;
    for (let k = 0; k < f.nx * f.ny; k++) { tot += f.nodeArea[k]; if (f.unyielded[k]) a += f.nodeArea[k]; }
    return a / tot * 100;
  };
  const pAt = (r, key) => where(r.field, r.result[key]);
  // [label, unit, value] -- units live in the label column so the values stay short enough to compare side by side
  const rows = [
    ['Wet film thickness, Q/U', 'mm', r => (r.result.Q / r.geo.U * 1000).toFixed(3)],
    ['Through-flow Q', 'mm²/s per mm width', r => fmtNum(r.metrics.Q * 1e6)],
    ['Mean velocity at the metering edge, Q/H', 'mm/s', r => fmtNum(r.metrics.meanGapVelocity * 1000)],
    ['Max |V|', 'mm/s', r => `${fmtNum(r.metrics.vmax * 1000)} ${where(r.field, r.metrics.vmaxLoc)}`],
    ['Area-mean |V|', 'mm/s', r => fmtNum(r.metrics.meanSpeed * 1000)],
    ['Min |V| inside the fluid', 'mm/s', r => `${fmtNum(r.metrics.vminInterior * 1000)} ${where(r.field, r.metrics.vminLoc)}`],
    ['Max shear rate', '1/s', r => { const [x, y] = r.metrics.gdMaxLoc; return `${fmtNum(r.metrics.gdMax)} ${Math.hypot(x - r.result.xe, y - r.result.H) < 0.3 * r.result.H ? '<small>next to the metering edge corner, where it is singular: this value depends on the mesh</small>' : where(r.field, r.metrics.gdMaxLoc)}`; }],
    ['Meniscus: contact line', 'on the blade', r => r.result.mode === 'climbed'
      ? `${(r.result.sCL * 1000).toFixed(3)} mm up the exit face <small>${(r.result.clY * 1000).toFixed(3)} mm above the web</small>`
      : 'pinned at the metering edge'],
    ['Surface leaves the contact line at', '° from the web, machine direction', r => `${r.result.leaveDeg.toFixed(1)} <small>${r.result.mode === 'climbed' ? `= contact angle ${r.geo.contactDeg.toFixed(1)}° off the face` : `pinned: at most ${r.result.alphaMaxDeg.toFixed(1)} (Gibbs)`}</small>`],
    ['Film at the end of the 2D domain', 'mm, ' + 'x from the edge', r => `${(r.result.hEnd * 1000).toFixed(3)} <small>at ${((r.result.xEnd - r.result.xe) * 1000).toFixed(1)} mm</small>`],
    ['Peak pressure', 'Pa, gauge', r => `${fmtNum(r.result.pMax)} ${pAt(r, 'pMaxLoc')}`],
    ['Lowest pressure', 'Pa, gauge', r => r.result.pMin < 0
      ? `${fmtNum(r.result.pMin)} ${r.result.pMinAtCorner ? '<small>next to the metering edge corner, where pressure is singular: this value depends on the mesh</small>' : pAt(r, 'pMinLoc')}`
      : 'not below ambient'],
    ['Pressure gradient along the web under the edge, −dp/dx', 'kPa/m', r => { const q = r.result, i = q.iCorner; return fmtNum(-(q.pWeb[i + 1] - q.pWeb[i - 1]) / (q.xWeb[i + 1] - q.xWeb[i - 1]) / 1000); }],
    ['Mass check: outflow vs inflow', '% difference', r => (r.result.massError * 100).toFixed(3)],
    ['Reverse flow, u_x < 0', '% of area', r => r.metrics.reverseFraction > 0 ? (r.metrics.reverseFraction * 100).toFixed(2) : 'none'],
    ['Recirculation, closed streamlines', 'mm²', r => r.metrics.recircArea > 0 ? `${fmtNum(r.metrics.recircArea * 1e6)} <small>${(r.metrics.recircFraction * 100).toFixed(1)}% of area</small>` : 'none'],
    ['Stagnation, |V| < 1% of max', 'x, y in mm', r => r.metrics.stagnation.length ? r.metrics.stagnation.slice(0, 4).map(s => `${(s.x * 1000).toFixed(2)}, ${(s.y * 1000).toFixed(3)}`).join('<br>') + (r.metrics.stagnation.length > 4 ? `<br><small>+${r.metrics.stagnation.length - 4} more</small>` : '') : 'none'],
    ['Unyielded fluid, stress below yield', '% of area', r => r.geo.ty > 0 ? (unyieldedPct(r) > 0 ? unyieldedPct(r).toFixed(1) : 'none <small>stress above yield everywhere</small>') : 'none <small>no yield stress</small>'],
    ['Residence time, inlet to the metering edge', 's (fastest · flux-weighted mean · slowest)', r => { const t = cfdFieldNumbers(r).res; return t.n ? `${fmtNum(t.min)} · ${fmtNum(t.mean)} · ${fmtNum(t.max)} <small>${t.n} equal-flux lines${t.turned ? `; ${t.turned} turned back` : ''}</small>` : '—'; }],
    ['Viscous dissipation', 'mW per m of width (under the blade)', r => { const q = cfdFieldNumbers(r); return `${fmtNum(q.dissTot * 1e3)} <small>${fmtNum(q.dissBlade * 1e3)}</small>`; }],
    ['Reynolds number ρUH/μ(U/H)', 'viscosity at the shear rate U/H', r => (RHO * r.geo.U * r.geo.H / r.geo.muRep).toExponential(2)],
    ['Reynolds number from the field, ρQ/μ̄', 'μ̄ = area mean of the yielded fluid under the blade', r => { const q = cfdFieldNumbers(r); return `${(RHO * r.result.Q / q.muBar).toExponential(2)} <small>μ̄ ${fmtNum(q.muBar)} Pa·s</small>`; }],
    ['Capillary number μ(U/H)U/γ', 'viscosity at the shear rate U/H', r => (r.geo.muRep * r.geo.U / r.geo.gamma).toExponential(2)],
    ['Capillary number at the meniscus, μ_s U/γ', 'μ_s = mean along the yielded free surface within 5 gaps of the contact line', r => { const q = cfdFieldNumbers(r); return q.muS == null ? 'surface unyielded there <small>no viscous stress scale: the yield stress holds it</small>' : `${(q.muS * r.geo.U / r.geo.gamma).toExponential(2)} <small>μ_s ${fmtNum(q.muS)} Pa·s${q.surfUnyielded ? `; ${q.surfUnyielded} of ${q.surfUnyielded + q.surfYielded} surface nodes unyielded, left out` : ''}</small>`; }],
    ['Streamline check: ψ drift along lines', '% of ψ range', r => { const sl = FV.streamlines ? streamlinesFor(r) : null; return sl && sl.psiDev != null ? (sl.psiDev * 100).toFixed(3) : '—'; }],
    ['Solver', '', r => `${r.result.converged ? 'converged' : 'partly converged'} <small>${r.result.iterations} Newton steps, residual ${r.result.residual.toExponential(1)}, ${(r.elapsedMs / 1000).toFixed(1)} s</small>`],
  ];
  const head = compare ? `<tr><th>Metric</th>${idx.map(i => `<th>Location ${i + 1}<small>z ${CFD_LOCS[i].z} mm</small></th>`).join('')}</tr>` : '';
  const body = rows.map(([name, unit, fn]) => `<tr><th scope="row">${name}${unit ? `<small>${unit}</small>` : ''}</th>${idx.map(i => `<td>${cfdRuns[i].field ? fn(cfdRuns[i]) : '—'}</td>`).join('')}</tr>`).join('');
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table${compare ? ' cmp' : ''}">${head ? `<thead>${head}</thead>` : ''}<tbody>${body}</tbody></table></div>
    <p class="fv-note">Pressure is gauge pressure, ambient air = 0, including the hydrostatic head; at the free surface it balances surface tension. Left out on purpose: velocity at the active metering edge (a no-slip solid corner, so 0 by definition).</p>`;
}

/** Fibre results: permeability and slip for the gap flow, and the drying air's Darcy numbers. */
function renderFibre() {
  const host = document.getElementById('cfdFibre');
  if (!host) return;
  const compare = FV.view === 'compare', idx = compare ? CFD_LOCS.map((_, i) => i) : [FV.view];
  const k = fibrePermeability(), eps = CFDG.por, d = CFDG.fd * 1e-6, air = airProps(CFDG.airT), ua = CFDG.airU;
  const G = air.mu * ua / k, Re = air.rho * (ua / eps) * d / air.mu, tf = P.tf / 1000;
  // slip along the web under the blade, from each run
  const slip = r => {
    const q = r.result;
    let s = 0, m = 0, n = 0;
    for (let i = 0; i <= q.iCorner; i++) { const v = (q.uWeb[i] - r.geo.U) / r.geo.U; s += v; m = Math.min(m, v); n++; }
    return `${(s / n * 100).toFixed(3)} <small>most ${(m * 100).toFixed(3)}</small>`;
  };
  const perLoc = [
    ['Darcy number k/H²', 'at the metering edge', r => (k / (r.geo.H * r.geo.H)).toExponential(2)],
    ['Slip at the fibre surface under the blade, (u − U)/U', '% (mean; most negative)', r => r.result.uWeb ? slip(r) : '—'],
  ];
  const head = compare ? `<tr><th>Per location</th>${idx.map(i => `<th>Location ${i + 1}<small>z ${CFD_LOCS[i].z} mm</small></th>`).join('')}</tr>` : '';
  const locRows = idx.some(i => cfdRuns[i].field) ? perLoc.map(([name, unit, fn]) => `<tr><th scope="row">${name}${unit ? `<small>${unit}</small>` : ''}</th>${idx.map(i => `<td>${cfdRuns[i].field ? fn(cfdRuns[i]) : '—'}</td>`).join('')}</tr>`).join('') : '';
  const row = (name, unit, val) => `<tr><th scope="row">${name}${unit ? `<small>${unit}</small>` : ''}</th><td${compare ? ` colspan="${idx.length}"` : ''}>${val}</td></tr>`;
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table${compare ? ' cmp' : ''}">${head ? `<thead>${head}</thead>` : ''}<tbody>
    ${row('Permeability k, Kozeny–Carman', 'm² (darcy)', `${k.toExponential(2)} <small>${fmtNum(k / 9.869233e-13)} D</small>`)}
    ${row('Slip length √k / α', 'µm', fmtNum(Math.sqrt(k) / CFDG.alphaBJ * 1e6))}
    ${locRows}
    ${row('Drying air: viscosity, density', `at ${CFDG.airT} °C`, `${(air.mu * 1e6).toFixed(2)} µPa·s, ${air.rho.toFixed(3)} kg/m³`)}
    ${row('Drying air: pressure gradient along its path in the fibre, μu/k', 'kPa per mm of path', fmtNum(G / 1e6))}
    ${row('Drying air: pressure drop across the fibre thickness', `Pa, if it crosses the ${P.tf} mm fibre`, fmtNum(G * tf))}
    ${row('Drying air: pore Reynolds number ρ(u/ε)d/μ', '', `${fmtNum(Re)} <small>${Re < 1 ? "Darcy's law holds (below 1)" : "above 1: inertial losses add to Darcy's law (not included)"}</small>`)}
  </tbody></table></div>
    <p class="fv-note">The slurry sees the fibre as a solid, porous surface: nothing crosses it, but the slurry slips over it (Beavers–Joseph). The drying air's numbers follow from Darcy's law for the speed you set; its path through the fibre in the oven (up through it, along it, or with a porous film) is not known, so its pressure field is not solved.</p>`;
}

// ---- profiles for one location ----

/** Height of the top boundary at x (m) beyond the metering edge (free surface or face); for telling air from blade. */
function cfdTopAt(f, x) {
  const top = (f.ny - 1) * f.nx;
  let best = 0;
  for (let i = f.iCorner; i < f.nx - 1; i++) {
    const x0 = f.gx[top + i], x1 = f.gx[top + i + 1];
    if ((x - x0) * (x - x1) <= 0) { const t = x1 === x0 ? 1 : (x - x0) / (x1 - x0); best = Math.max(best, f.gy[top + i] + t * (f.gy[top + i + 1] - f.gy[top + i])); }
  }
  return best;
}

/** Blade height above the web at x (m), 0 <= x <= metering edge: the mesh's top boundary there. */
function cfdBladeAt(f, x) {
  const top = (f.ny - 1) * f.nx;
  let i = 0;
  while (i < f.iCorner - 1 && f.gx[top + i + 1] < x) i++;
  const x0 = f.gx[top + i], x1 = f.gx[top + i + 1], t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return f.gy[top + i] + t * (f.gy[top + i + 1] - f.gy[top + i]);
}

/** A field sampled up a vertical line at x under the blade, web to blade: [[value, y], ...]. */
function cfdColumn(f, arr, x, n = 41) {
  const hb = cfdBladeAt(f, x), out = [];
  for (let k = 0; k < n; k++) { const y = hb * k / (n - 1); out.push([sampleField(f, arr, x, y), y]); }
  return out;
}

/** Stations to sample profiles at (x, m): near the inlet / part way, mid-way, and just upstream of the metering edge. */
function profileStations(run) {
  const xe = run.result.xe, H = run.geo.H;
  return run.geo.shape === 'round' ? [0.35 * xe, 0.8 * xe, xe - 0.3 * H] : [0.1 * xe, 0.5 * xe, xe - 0.3 * H];
}

/**
 * u(y) across the gap at three stations (light to dark = inlet to edge).
 * Flat land: against the exact fully developed profile (dashed) for the
 * pressure gradient the solution has at mid-land -- they must coincide
 * there. Round entry: the profile turns from returning flow near the pool
 * to the metered profile at the edge.
 */
function drawVelocityProfile(cv, run) {
  const r = run.result, f = run.field, geo = run.geo, st = profileStations(run);
  const cols = st.map(x => cfdColumn(f, f.u, x));
  let umax = geo.U, umin = 0, ymax = 0;
  for (const col of cols) for (const [u, y] of col) { umax = Math.max(umax, u); umin = Math.min(umin, u); ymax = Math.max(ymax, y); }
  const lut = getLut('seq'), shade = k => lutColor(lut, 0.35 + 0.65 * k / (st.length - 1));
  const series = [];
  if (r.prof1D) series.push({ p: r.prof1D.y.map((y, j) => [r.prof1D.u[j] * 1000, y * 1000]), c: cssVar('--muted'), w: 4, dash: [1, 3] });
  cols.forEach((col, k) => series.push({ p: col.map(([u, y]) => [u * 1000, y * 1000]), c: shade(k), w: 1.8 }));
  const ax = plotChart(cv, 0.5, {
    x0: Math.min(umin, 0) * 1000 * 1.1, x1: umax * 1000 * 1.1, y0: 0, y1: ymax * 1000,
    xl: 'velocity u (mm/s)', yl: 'height above the web y (mm)', xd: 1, yd: 2, s: series,
  });
  // label each station at its top end (just under the blade)
  const c = cv.getContext('2d');
  c.font = `11px ${cssVar('--mono')}`; c.textAlign = 'left'; c.textBaseline = 'middle';
  cols.forEach((col, k) => {
    const [u, y] = col[Math.round((col.length - 1) * 0.88)];
    labelOn(c, `x ${(st[k] * 1000).toFixed(1)}`, ax.X(u * 1000) + 6, ax.Y(y * 1000), shade(k), 'left');
  });
}

/**
 * Apparent viscosity across the gap just upstream of the metering edge
 * (flat land: mid-land). Where the stress is below the yield stress the
 * fluid is unyielded and the solver's viscosity there is its regularized
 * (large, finite) value: those points are pinned at the capped edge instead
 * of setting the axis.
 */
function drawViscosityProfile(cv, run) {
  const f = run.field, geo = run.geo, x = profileStations(run)[geo.shape === 'round' ? 2 : 1];
  const muCap = f.muCap || geo.muRep, col = cfdColumn(f, f.mu, x);
  plotChart(cv, 0.4, {
    x0: 0, x1: muCap, y0: 0, y1: col[col.length - 1][1] * 1000,
    xl: 'apparent viscosity (Pa·s)' + (f.hasPlug ? ', capped' : ''), yl: 'height above the web y (mm)', xd: 1, yd: 2,
    s: [{ p: col.map(([m, y]) => [Math.min(m, muCap), y * 1000]), c: cssVar('--accent'), w: 2 }],
    vl: f.hasPlug ? [{ x: muCap, c: cssVar('--warn'), t: '' }] : [],
  });
}

/** Pressure along the web and along the top boundary (blade, exit face, free surface), inlet to the end of the 2D domain. */
function drawPressureProfile(cv, run) {
  const r = run.result, f = run.field;
  const web = r.xWeb.map((x, i) => [x * 1000, r.pWeb[i]]), top = r.xTop.map((x, i) => [x * 1000, r.pTop[i]]);
  // axis from the pressures away from the edge corner (singular there)
  let lo = 0, hi = run.geo.Pup;
  const skip = (x, y) => Math.hypot(x - r.xe, y - r.H) < 0.3 * r.H;
  for (let i = 0; i < f.nx; i++) {
    if (!skip(r.xWeb[i], 0)) { lo = Math.min(lo, r.pWeb[i]); hi = Math.max(hi, r.pWeb[i]); }
    if (!skip(r.xTop[i], r.yTop[i])) { lo = Math.min(lo, r.pTop[i]); hi = Math.max(hi, r.pTop[i]); }
  }
  const pad = 0.08 * (hi - lo || 1);
  plotChart(cv, 0.4, {
    x0: 0, x1: f.Lx * 1000, y0: lo - pad, y1: hi + pad,
    xl: 'x (mm), inlet → metering edge → film', yl: 'pressure (Pa, gauge)', xd: 0, yd: 0,
    s: [{ p: top, c: cssVar('--muted'), w: 3.5, dash: [2, 3] }, { p: web, c: cssVar('--accent'), w: 1.8 }],
    hl: [{ y: run.geo.Pup, c: cssVar('--muted'), t: 'bead pressure' }],
    vl: [{ x: r.xe * 1000, c: cssVar('--line'), t: 'edge' }],
  });
}

/** Film height from the edge to the oven: the 2D free surface, then the 1D film model from the end of the 2D domain, toward h_inf = Q/U. */
function drawDownstreamFilm(cv, run) {
  const r = run.result, film = r.film, geo = run.geo;
  const surf = [];
  for (let i = r.iCL; i < r.nx; i++) surf.push([(r.xTop[i] - r.xe) * 1000, r.yTop[i] * 1000]);
  const pts = film.x ? film.x.map((x, i) => [(x + r.filmStart) * 1000, film.h[i] * 1000]) : [];
  let hMax = geo.H;
  for (const [, h] of surf.concat(pts)) hMax = Math.max(hMax, h);
  plotChart(cv, 0.4, {
    x0: 0, x1: geo.ovenDistance * 1000, y0: 0, y1: hMax * 1.15,
    xl: 'distance downstream of the metering edge (mm)', yl: 'film height (mm)', xd: 0, yd: 2,
    s: [{ p: surf, c: cssVar('--ink'), w: 2.2 }, { p: pts, c: cssVar('--accent'), w: 2.2 }],
    hl: [{ y: r.Q / geo.U * 1000, c: cssVar('--muted'), t: 'h∞ = Q/U (mass conservation)' }],
  });
}

function renderProfiles() {
  const host = document.getElementById('cfdProfiles');
  const i = FV.view === 'compare' ? FV.profileLoc : FV.view;
  document.getElementById('cfdProfTitle').textContent = `Profiles · Location ${i + 1}` + (FV.view === 'compare' ? ' (pick a single location above to change)' : '');
  const run = cfdRuns[i];
  if (!run.field) { host.innerHTML = '<p class="cap">No result for this location yet.</p>'; return; }
  const r = run.result, geo = run.geo, round = geo.shape === 'round';
  const qDiff = (r.Q / r.qLub - 1) * 100;
  const lubNote = `${Math.abs(qDiff).toFixed(1)}% ${qDiff > 0 ? 'above' : 'below'} the one-viscosity lubrication estimate for the same bead pressure and zero pressure at the edge (the meniscus sets the real edge pressure${geo.ty === 0 && geo.n === 1 ? '' : ', and this fluid\'s viscosity varies across the gap'})`;

  const filmOk = !!r.film.x;
  const hOven = filmOk ? r.film.h[r.film.h.length - 1] : null;
  host.innerHTML = `
    <canvas id="cfdProfile" role="img" aria-label="Velocity profiles across the gap at three stations"></canvas>
    <p class="cap"><b>u(y) at three stations</b>, light to dark from ${round ? 'the pool side' : 'the inlet'} to just upstream of the metering edge${r.prof1D ? `, against the exact fully developed profile (dashed) for the pressure gradient (${fmtNum(r.prof1D.G / 1000)} kPa/m) and fibre-surface velocity (slip ${((r.prof1D.uWall / geo.U - 1) * 100).toFixed(2)}% of U) the solution has at mid-land: they must coincide there` : '. Negative u near the blade is flow turning back toward the pool'}. Flow rate ${lubNote}.</p>
    <canvas id="cfdPress" role="img" aria-label="Pressure along the web and the top boundary"></canvas>
    <p class="cap"><b>Pressure along the flow</b>: along the web (solid) and along the top boundary (dashed: blade, exit face, then the free surface, where it balances surface tension), from the bead pressure at the inlet, through the metering edge, into the film.${round ? ' The web drags slurry into the narrowing gap, which builds pressure above the bead pressure before it falls toward the edge.' : ''} The axis leaves out the edge corner itself, where pressure is singular.</p>
    <canvas id="cfdVisc" role="img" aria-label="Apparent viscosity across the gap"></canvas>
    <p class="cap"><b>Apparent viscosity across the gap</b> ${round ? 'just upstream of the metering edge' : 'at mid-land'}. Flat when Newtonian; higher toward the low-shear core with shear-thinning or yield stress. Fluid whose stress is below the yield stress (unyielded) is pinned at the capped edge.</p>
    <canvas id="cfdFilm" role="img" aria-label="Film height from the metering edge to the oven"></canvas>
    <p class="cap"><b>Film from the metering edge to the oven</b> (${(geo.ovenDistance * 1000).toFixed(0)} mm): the 2D free surface (dark, from the contact line), then ${filmOk ? `the Slurry animation tab's 1D free-surface method from ${(r.filmStart * 1000).toFixed(1)} mm on, driven by this run's flow rate` : `no 1D film (${r.film.error || 'unknown error'})`}. Dashed: where mass conservation says it must end up.</p>
    <div class="stats">${[
      ['Wet film, Q/U', (r.Q / geo.U * 1000).toFixed(3) + ' mm'],
      ['Film at oven', filmOk ? (hOven * 1000).toFixed(3) + ' mm' + (r.film.converged ? '' : ' (still relaxing)') : '—'],
      ['Gap at edge / film', filmOk ? (geo.H / hOven).toFixed(3) : '—'],
      ['Lubrication estimate, one viscosity', (r.qLub / geo.U * 1000).toFixed(3) + ' mm'],
      ...(round ? [] : [['physics.js filmThickness()', (filmThickness(geo.H * 1000)).toFixed(3) + ' mm']]),
    ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('')}</div>`;
  drawVelocityProfile(document.getElementById('cfdProfile'), run);
  drawPressureProfile(document.getElementById('cfdPress'), run);
  drawViscosityProfile(document.getElementById('cfdVisc'), run);
  drawDownstreamFilm(document.getElementById('cfdFilm'), run);
}
