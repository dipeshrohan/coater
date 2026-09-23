/*
 * cfd-ui.js — the "CFD Analysis" tab.
 *
 * Runs the 2D gap solve at four lateral locations (one Web Worker each,
 * cfd-worker.js), stores each solved field, and shows it as a CFD
 * post-processing view (cfd-plot.js) with flow-tracking overlays computed
 * from the stored velocity field (cfd-flowviz.js). Only the Run buttons
 * solve; every display control (field, streamlines, seeds, vectors,
 * location, comparison) re-draws from what's already stored.
 *
 * Depends on physics.js (P, RHO, GRAVITY, gapHeight, muEff, spatialNoise,
 * filmThickness), draw.js (plotChart, cssVar, pill), cfd-flowviz.js and
 * cfd-plot.js, all loaded first.
 */

const CFD_NX = 121, CFD_NY = 61;
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
  ux: { label: 'u_x, machine direction', short: 'u_x', unit: 'mm/s', scale: 1000, kind: 'auto', arr: f => f.u },
  uy: { label: 'u_y, normal to the web', short: 'u_y', unit: 'mm/s', scale: 1000, kind: 'div', floorFrac: 0.01, arr: f => f.v },
  shear: { label: 'Shear rate', short: 'shear', unit: '1/s', scale: 1, kind: 'seq', zeroMin: true, arr: f => f.shear },
  mu: { label: 'Apparent viscosity', short: 'μ', unit: 'Pa·s', scale: 1, kind: 'seq', cap: true, arr: f => f.mu },
  omega: { label: 'Vorticity', short: 'ω', unit: '1/s', scale: 1, kind: 'div', arr: f => f.omega },
};

// ---------------------------------------------------------------------
// Locations and solving
// ---------------------------------------------------------------------

/** Local gap (mm) at lateral position z (mm): the same across-web waviness and fibre-thickness variation the Contact line tab and the animation already use. */
function cfdLocalGapMm(z) {
  return gapHeight() + (P.dH * Math.sin(2 * Math.PI * z / P.lw) - P.dt * spatialNoise(z, 1.7)) / 1000;
}

function cfdGeometry(z) {
  const U = P.U / 60;                       // m/min -> m/s
  const H = cfdLocalGapMm(z) / 1000;        // mm -> m
  const L = P.L / 1000;
  const G = P.Pup * 1000 / (P.L / 1000);    // Pa/m, physics.js's dpdx convention
  const muRef = muEff(U / H);
  return { z, U, H, L, G, muRef, ty: P.ty, n: P.n, rho: RHO, gamma: P.g, g: GRAVITY, ovenDistance: P.oven };
}
const cfdInputsKey = geo => JSON.stringify([geo.U, geo.H, geo.L, geo.G, P.mu, geo.ty, geo.n, geo.gamma, geo.ovenDistance]);
const cfdIsStale = i => cfdRuns[i].field && cfdRuns[i].key !== cfdInputsKey(cfdGeometry(CFD_LOCS[i].z));

function runLocation(i) {
  const run = cfdRuns[i];
  if (run.status === 'running') return;
  const geo = cfdGeometry(CFD_LOCS[i].z);
  const worker = new Worker('cfd-worker.js');
  cfdWorkers[i] = worker;
  const t0 = performance.now();
  run.status = 'running'; run.error = null;
  const finish = () => { worker.terminate(); if (cfdWorkers[i] === worker) cfdWorkers[i] = null; };
  worker.onmessage = e => {
    finish();
    const ms = performance.now() - t0;
    const r = e.data.ok ? e.data.result : null;
    if (!r) { run.status = 'error'; run.error = e.data.error; }
    else if (!r.converged || !r.outerConverged) {
      // a non-converged field is not a valid physical result: keep nothing from it
      run.status = 'error'; run.error = !r.converged ? 'solver did not converge' : `rheology iteration did not converge in ${r.outerIterations} passes`;
    } else {
      Object.assign(run, {
        status: 'done', result: r, geo, key: cfdInputsKey(geo), elapsedMs: ms,
        field: makeFlowField(r, geo.rho, r.prof1D), streamCache: new Map(),
      });
      run.metrics = flowMetrics(run.field);
    }
    renderCFD();
  };
  worker.onerror = e => { finish(); run.status = 'error'; run.error = e.message || 'worker error'; renderCFD(); };
  worker.postMessage({
    nx: CFD_NX, ny: CFD_NY, Lx: geo.L, Ly: geo.H, U: geo.U, dpdxFavorable: geo.G,
    rho: geo.rho, muRef: geo.muRef, ty: geo.ty, n: geo.n,
    maxIter: 50000, tol: 1e-6, maxOuter: 60, outerTol: 1e-3,
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
    const cap = d.cap && f.hasPlug ? f.muCap : Infinity;
    for (let k = 0; k < a.length; k++) {
      let v = a[k] * d.scale;
      if (v > cap) { v = cap; capped = true; }
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const kind = d.kind === 'auto' ? (min < -1e-3 * Math.abs(max) ? 'div' : 'seq') : d.kind;
  if (kind === 'div') {
    // symmetric about zero; a floor keeps numerical noise in a ~zero field from being stretched into bold colour
    const m = Math.max(Math.abs(min), Math.abs(max), (d.floorFrac || 0) * vref) || 1;
    min = -m; max = m;
  } else if (d.zeroMin) min = 0;
  if (!(max > min)) max = min + 1;
  return { key, label: d.label, short: d.short, unit: d.unit, scale: d.scale, kind, min, max, capped };
}
const scalarFor = (range, f) => range && { ...range, arr: SCALARS[range.key].arr(f) };

function streamlinesFor(run) {
  const f = run.field;
  const n = FV.density === 'custom' ? Math.max(2, Math.min(80, Math.round(FV.customN) || 16)) : DENSITY_N[FV.density];
  const manual = FV.seedMode === 'manual'
    ? FV.manualSeeds.filter(([x, y]) => x >= 0 && x <= f.Lx && y >= 0 && y <= f.Ly)
    : null;
  const key = manual ? `m|${FV.direction}|${JSON.stringify(manual)}` : `a|${n}|${FV.direction}`;
  let hit = run.streamCache.get(key);
  if (!hit) {
    const seeds = manual || autoSeeds(f, n, FV.direction);
    const lines = seeds.map(p => traceStreamline(f, p, { direction: FV.direction }));
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
    <p class="cap cfd-lede"><b>2D Navier&ndash;Stokes flow in the metering gap</b> at four positions across the web. Everything below is post-processed from the stored solutions: display settings never re-run the solver.</p>
    <details class="cap-toggle"><summary>Method, validation and limits</summary><p class="cap">
      <b>Solver.</b> Steady 2D incompressible Navier&ndash;Stokes (streamfunction&ndash;vorticity), ${CFD_NX} &times; ${CFD_NY} structured grid over land length (x) &times; local gap (y): moving web below, fixed blade land above, fully developed inflow from the bead side, zero-gradient outflow at the active metering edge. Viscosity follows the same yield-stress and shear-thinning model as the other tabs (Picard iteration on the local shear rate). Validated against Ghia, Ghia &amp; Shin (1982) and against this app's own lubrication formula.
      <b>Locations.</b> Each location's gap uses the across-web waviness and fibre-thickness variation from the sidebar, the same formula the Contact line tab uses.
      <b>Flow tracking.</b> Streamlines are integrated (RK4) through the bilinearly interpolated velocity field and checked against the solver's streamfunction, which is constant along a true streamline; the drift is reported under Flow metrics.
      <b>Limits.</b> The 2D domain is the gap itself. The upstream bead, the curved blade entry and the downstream meniscus are not in it, so recirculation there cannot appear here. The solver is steady, so there are no pathlines, and this formulation does not compute pressure.
    </p></details>

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
          ${opt('pressure', 'Pressure (not computed)', FV.base, true)}${opt('none', 'None (geometry only)', FV.base)}
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
            <label class="fv-ctl">Colour <select id="fvLineColor">${opt('none', 'Plain', FV.lineColor)}${opt('speed', 'Velocity magnitude', FV.lineColor)}${opt('shear', 'Shear rate', FV.lineColor)}${opt('mu', 'Apparent viscosity', FV.lineColor)}${opt('pressure', 'Pressure (not computed)', FV.lineColor, true)}</select></label>
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
    <section class="cfd-block"><div class="cfd-head"><h3 id="cfdProfTitle">Profiles</h3></div><div id="cfdProfiles"></div></section>`;

  document.getElementById('cfdRunAll').onclick = runAllLocations;
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
  renderLocCards();
  renderViewSeg();
  renderSeedPanel();
  renderFlowPlots();
  renderLegend();
  renderMetrics();
  renderProfiles();
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
    if (r.status === 'running') { cls = 'run'; txt = 'solving…'; }
    else if (r.status === 'error') { cls = 'bad'; txt = 'failed'; }
    else if (r.field && cfdIsStale(i)) { cls = 'warn'; txt = 'out of date'; }
    else if (r.field) { cls = 'ok'; txt = `solved · ${(r.elapsedMs / 1000).toFixed(1)} s`; }
    else if (r.status === 'cancelled') { cls = 'warn'; txt = 'cancelled'; }
    const sel = FV.view === i ? ' sel' : '';
    return `<div class="loc-card${sel}">
      <div class="loc-name">Location ${loc.id}</div>
      <div class="loc-state ${cls}"${r.error ? ` title="${r.error}"` : ''}>${txt}</div>
      <label class="loc-z"><span>z</span><input type="number" min="0" max="${CFD_WEB_WIDTH_MM}" step="0.5" value="${loc.z}" data-i="${i}" aria-label="Location ${loc.id} position across the web, mm"><span>mm</span></label>
      <div class="loc-meta">gap <b>${cfdLocalGapMm(loc.z).toFixed(3)}</b> mm</div>
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
  return `Location ${i + 1} · z = ${CFD_LOCS[i].z} mm · H = ${(r.geo.H * 1000).toFixed(3)} mm`;
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
    line: FV.streamlines && FV.lineColor !== 'none' ? scalarRange(FV.lineColor, fields) : null,
    speed: scalarRange('speed', fields),
  };
  const yMax = Math.max(...fields.map(f => f.Ly));
  const vmax = Math.max(...fields.map(f => f.vmax));

  host.innerHTML = list.map(i => `
    ${compare ? '' : `<div class="fv-caption">${locationTitle(i)} · ${CFD_NX} × ${CFD_NY} grid · <span class="fv-ex"></span>${cfdIsStale(i) ? ' · <span class="warn-text">out of date: inputs changed since this run</span>' : ''}</div>`}
    <div class="fv-plot${compare ? ' compact' : ''}" data-i="${i}">
      <canvas class="fv-main" role="img" aria-label="${locationTitle(i)}: CFD field with flow overlays"></canvas>
      <canvas class="fv-over" aria-hidden="true"></canvas>
      <div class="fv-tip" hidden></div>
    </div>`).join('') + (compare ? '<p class="fv-note">Same colour range, axes (y up to the largest local gap), streamline settings and vector scale in all four.</p>' : '');

  host.querySelectorAll('.fv-plot').forEach(el => {
    const i = +el.dataset.i, run = cfdRuns[i], f = run.field;
    const sl = FV.streamlines ? streamlinesFor(run) : null;
    const cv = el.querySelector('.fv-main');
    const map = drawFlowPlot(cv, {
      f, webSpeed: run.geo.U, yMax, yScale: FV.yScale, compact: compare, title: compare ? locationTitle(i) + (cfdIsStale(i) ? ' (out of date)' : '') : '',
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
    const vfloor = f.vmax * 1e-4 * 1000; // below this a velocity component is numerical noise, not flow
    const u = s(f.u) * 1000, v = s(f.v) * 1000, mu = f.mu ? s(f.mu) : null;
    const comp = c => Math.abs(c) < vfloor ? '≈ 0' : fmtNum(c);
    const muTxt = mu == null ? '' : f.hasPlug && mu > f.muCap ? 'μ &gt; cap (unyielded)' : `μ ${fmtNum(mu)} Pa·s`;
    tip.innerHTML = `<b>x ${(x * 1000).toFixed(2)} mm · y ${(y * 1000).toFixed(3)} mm</b>
      <span>|V| ${fmtNum(Math.hypot(u, v))} mm/s</span>
      <span>u_x ${comp(u)} · u_y ${comp(v)} mm/s</span>
      <span>shear ${fmtNum(s(f.shear))} 1/s · ${muTxt}</span>
      ${f.omega ? `<span>ω ${fmtNum(s(f.omega))} 1/s</span>` : ''}
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
  let note = '';
  if (FV.streamlines && FV.seedMode === 'auto') note = 'Automatic seeds are spaced by equal flow rate, so lines crowd where the flow is fast. ';
  if (FV.streamlines && FV.direction !== 'forward' && FV.seedMode === 'auto') note += `Seeds sit ${FV.direction === 'backward' ? 'on the outflow' : 'mid-channel'} for ${FV.direction} tracing. `;
  host.innerHTML = items.join('') + (note ? `<p class="fv-note">${note}</p>` : '');
}

function where(f, loc) {
  const [x, y] = loc;
  if (y <= f.dy * 0.5) return '<small>at the web</small>';
  if (y >= f.Ly - f.dy * 0.5) return '<small>at the blade land</small>';
  return `<small>at x ${(x * 1000).toFixed(2)}, y ${(y * 1000).toFixed(3)}</small>`;
}

function renderMetrics() {
  const host = document.getElementById('cfdMetrics');
  const compare = FV.view === 'compare';
  const idx = compare ? CFD_LOCS.map((_, i) => i) : [FV.view];
  if (!idx.some(i => cfdRuns[i].field)) { host.innerHTML = '<p class="cap">No result to measure yet.</p>'; return; }
  const plugPct = r => {
    const gd = r.result.prof1D.gd;
    let n = 0; for (const g of gd) if (g === 0) n++;
    return n / gd.length * 100;
  };
  // [label, unit, value] -- units live in the label column so the values stay short enough to compare side by side
  const rows = [
    ['Through-flow Q', 'mm²/s per mm width', r => fmtNum(r.metrics.Q * 1e6)],
    ['Mean velocity through the gap, Q/H', 'mm/s', r => fmtNum(r.metrics.meanGapVelocity * 1000)],
    ['Max |V|', 'mm/s', r => `${fmtNum(r.metrics.vmax * 1000)} ${where(r.field, r.metrics.vmaxLoc)}`],
    ['Area-mean |V|', 'mm/s', r => fmtNum(r.metrics.meanSpeed * 1000)],
    ['Min |V| inside the fluid', 'mm/s', r => `${fmtNum(r.metrics.vminInterior * 1000)} ${where(r.field, r.metrics.vminLoc)}`],
    ['Max shear rate', '1/s', r => `${fmtNum(r.metrics.gdMax)} ${where(r.field, r.metrics.gdMaxLoc)}`],
    ['Reverse flow, u_x < 0', '% of area', r => r.metrics.reverseFraction > 0 ? (r.metrics.reverseFraction * 100).toFixed(2) : 'none'],
    ['Recirculation, closed streamlines', 'mm²', r => r.metrics.recircArea > 0 ? `${fmtNum(r.metrics.recircArea * 1e6)} <small>${(r.metrics.recircFraction * 100).toFixed(1)}% of area</small>` : 'none'],
    ['Stagnation, |V| < 1% of max', 'x, y in mm', r => r.metrics.stagnation.length ? r.metrics.stagnation.map(s => `${(s.x * 1000).toFixed(2)}, ${(s.y * 1000).toFixed(3)}`).join('<br>') : 'none'],
    ['Unyielded plug, fully developed', '% of gap height', r => r.geo.ty > 0 ? (plugPct(r) > 0 ? plugPct(r).toFixed(1) : 'none <small>stress above yield everywhere</small>') : 'none <small>no yield stress</small>'],
    ['Reynolds number ρUH/μ', '', r => (RHO * r.geo.U * r.geo.H / r.geo.muRef).toExponential(2)],
    ['Streamline check: ψ drift along lines', '% of Q', r => { const sl = FV.streamlines ? streamlinesFor(r) : null; return sl && sl.psiDev != null ? (sl.psiDev * 100).toFixed(4) : '—'; }],
    ['Solver', '', r => `converged <small>${r.result.outerIterations} rheology pass${r.result.outerIterations === 1 ? '' : 'es'}, ${(r.elapsedMs / 1000).toFixed(1)} s</small>`],
  ];
  const head = compare ? `<tr><th>Metric</th>${idx.map(i => `<th>Location ${i + 1}<small>z ${CFD_LOCS[i].z} mm</small></th>`).join('')}</tr>` : '';
  const body = rows.map(([name, unit, fn]) => `<tr><th scope="row">${name}${unit ? `<small>${unit}</small>` : ''}</th>${idx.map(i => `<td>${cfdRuns[i].field ? fn(cfdRuns[i]) : '—'}</td>`).join('')}</tr>`).join('');
  host.innerHTML = `<div class="table-wrap"><table class="cfd-table${compare ? ' cmp' : ''}">${head ? `<thead>${head}</thead>` : ''}<tbody>${body}</tbody></table></div>
    <p class="fv-note">Left out on purpose: velocity at the active metering edge (a no-slip solid corner, so 0 by definition) and anything pressure-based (not computed).</p>`;
}

// ---- profiles for one location (existing charts, unchanged in substance) ----

/** u(y) at three x-stations against the 1D fully-developed reference profile (exact Couette-Poiseuille in the Newtonian limit; the same generalized-Newtonian shooting-method solve otherwise) -- the open-boundary correctness check, visible, not just asserted. */
function drawVelocityProfile(cv, r, geo) {
  const nx = r.nx, ny = r.ny;
  const stations = [{ i: 1 }, { i: Math.round((nx - 1) / 2) }, { i: nx - 2 }];
  const reference = r.prof1D.y.map((y, j) => [r.prof1D.u[j] * 1000, y * 1000]);
  let umax = geo.U, umin = 0;
  for (let k = 0; k < nx * ny; k++) { umax = Math.max(umax, r.u[k]); umin = Math.min(umin, r.u[k]); }
  const series = [{ p: reference, c: cssVar('--muted'), w: 4, dash: [1, 3] }];
  stations.forEach(st => {
    const pts = [];
    for (let j = 0; j < ny; j++) pts.push([r.u[j * nx + st.i] * 1000, j * r.dy * 1000]);
    series.push({ p: pts, c: cssVar('--accent'), w: 1.6 });
  });
  plotChart(cv, 0.5, {
    x0: Math.min(umin, 0) * 1000 * 1.1, x1: umax * 1000 * 1.1, y0: 0, y1: geo.H * 1000,
    xl: 'velocity u (mm/s)', yl: 'position across gap y (mm)', xd: 1, yd: 2,
    s: series,
  });
}

/**
 * Apparent viscosity across the gap at mid-channel. A yield-stress fluid's
 * mu = ty/gd formally diverges in a truly unyielded plug; the exact 1D
 * reference's gd (exactly 0 there) identifies plug rows, the axis is scaled
 * off the flowing rows, and plug points are pinned to the capped edge.
 */
function drawViscosityProfile(cv, r, geo) {
  const nx = r.nx, ny = r.ny, iMid = Math.round((nx - 1) / 2);
  const ys = r.prof1D.y, gds = r.prof1D.gd;
  const raw = [], isPlug = [];
  for (let j = 0; j < ny; j++) {
    raw.push(r.nuField[j * nx + iMid] * geo.rho);
    isPlug.push(interp1(ys, gds, j * r.dy) <= 1e-6);
  }
  let muMax = geo.muRef;
  raw.forEach((mu, j) => { if (!isPlug[j]) muMax = Math.max(muMax, mu); });
  const muCap = muMax * 1.3, hasPlug = isPlug.some(Boolean);
  plotChart(cv, 0.4, {
    x0: 0, x1: muCap, y0: 0, y1: geo.H * 1000,
    xl: 'apparent viscosity (Pa·s)' + (hasPlug ? ', capped' : ''), yl: 'position across gap y (mm)', xd: 1, yd: 2,
    s: [{ p: raw.map((mu, j) => [Math.min(mu, muCap), j * r.dy * 1000]), c: cssVar('--accent'), w: 2 }],
    vl: hasPlug ? [{ x: muCap, c: cssVar('--warn'), t: '' }] : [], // explained in the caption; a label here would run off the chart edge
  });
}

/** Downstream film h(x) from the gap exit toward h_inf = Q/U (mass conservation, the independent check line). */
function drawDownstreamFilm(cv, film, geo) {
  const pts = film.x.map((x, i) => [x * 1000, film.h[i] * 1000]);
  let hMax = geo.H;
  for (const [, h] of pts) hMax = Math.max(hMax, h);
  plotChart(cv, 0.4, {
    x0: 0, x1: film.x[film.x.length - 1] * 1000, y0: 0, y1: hMax * 1.15,
    xl: 'distance downstream of the gap (mm)', yl: 'film height (mm)', xd: 0, yd: 2,
    s: [{ p: pts, c: cssVar('--accent'), w: 2.2 }],
    hl: [{ y: film.hInf * 1000, c: cssVar('--muted'), t: 'h∞ = Q/U (mass conservation)' }],
  });
}

function renderProfiles() {
  const host = document.getElementById('cfdProfiles');
  const i = FV.view === 'compare' ? FV.profileLoc : FV.view;
  document.getElementById('cfdProfTitle').textContent = `Profiles · Location ${i + 1}` + (FV.view === 'compare' ? ' (pick a single location above to change)' : '');
  const run = cfdRuns[i];
  if (!run.field) { host.innerHTML = '<p class="cap">No result for this location yet.</p>'; return; }
  const r = run.result, geo = run.geo;
  const qLub = geo.U * geo.H / 2 + geo.G * geo.H ** 3 / (12 * geo.muRef);
  const qDiff = Math.abs(r.qOutlet - qLub) / qLub * 100;
  const newtonian = geo.ty === 0 && geo.n === 1;
  const lubNote = qDiff < 5 ? `matches the lubrication formula within ${qDiff.toFixed(2)}%`
    : `${qDiff.toFixed(1)}% above/below the lubrication formula: ${newtonian ? 'expected once inertia matters' : 'expected, since that formula uses one representative viscosity and a shear-thinning fluid is thinner where the shear is highest'}`;

  const filmOk = !!r.film.x;
  const hOven = filmOk ? r.film.h[r.film.h.length - 1] : null;
  const hLub = filmThickness(geo.H * 1000) / 1000;
  host.innerHTML = `
    <canvas id="cfdProfile" role="img" aria-label="Velocity profile across the gap, computed vs the fully developed reference"></canvas>
    <p class="cap"><b>u(y) at three stations</b> (near inlet, mid-channel, near outlet; solid) against the fully developed reference for this gap and rheology (dashed). They coincide when the open boundaries are right. Flow rate ${lubNote}.</p>
    <canvas id="cfdVisc" role="img" aria-label="Apparent viscosity across the gap at mid-channel"></canvas>
    <p class="cap"><b>Apparent viscosity across the gap</b> at mid-channel. Flat when Newtonian; higher toward the low-shear core with shear-thinning or yield stress. A core that stops shearing (unyielded plug) is pinned at the capped edge, since viscosity diverges there.</p>
    ${filmOk ? `<canvas id="cfdFilm" role="img" aria-label="Downstream film height development"></canvas>
    <p class="cap"><b>Downstream film to the oven</b> (${(geo.ovenDistance * 1000).toFixed(0)} mm), using the Slurry animation tab's free-surface method driven by this run's flow rate. Dashed: where mass conservation says it must end up.</p>` : `<p class="cap">The downstream film could not be computed for this run (${r.film.error || 'unknown error'}).</p>`}
    <div class="stats">${[
      ['Film at gap exit', (geo.H * 1000).toFixed(3) + ' mm'],
      ['Film at oven', filmOk ? (hOven * 1000).toFixed(3) + ' mm' + (r.film.converged ? '' : ' (still relaxing)') : '—'],
      ['Gap-to-film ratio', filmOk ? (geo.H / hOven).toFixed(3) : '—'],
      ['physics.js filmThickness()', (hLub * 1000).toFixed(3) + ' mm' + (filmOk ? ` (${(Math.abs(hOven - hLub) / hLub * 100).toFixed(1)}% diff)` : '')],
    ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('')}</div>`;
  drawVelocityProfile(document.getElementById('cfdProfile'), r, geo);
  drawViscosityProfile(document.getElementById('cfdVisc'), r, geo);
  if (filmOk) drawDownstreamFilm(document.getElementById('cfdFilm'), r.film, geo);
}
