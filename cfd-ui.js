/*
 * cfd-ui.js — DOM wiring for the "CFD Analysis" tab: runs the real
 * open-channel Navier-Stokes solver (cfd-solver.js, off the main thread
 * via cfd-worker.js) on the current gap geometry and shows the resulting
 * velocity field.
 *
 * Phase 1 of the Cross-Web 2D CFD Analysis feature (see CFD_PLAN.md).
 * One location (the web centreline -- the same cross-section physics.js
 * already uses), full non-Newtonian rheology (Picard iteration on the
 * local shear-rate field, using the same muEff() formula/sliders as the
 * rest of the app), and a validation check against physics.js's own
 * formula in the regime where they should agree. Not yet built: the
 * other 3 lateral locations and their comparison view, free-surface/
 * meniscus tracking, porous-fibre coupling, and saved/persisted cases --
 * tracked as open work in CFD_PLAN.md.
 */

const CFD_NX = 121, CFD_NY = 61;
let cfdResult = null, cfdWorker = null, cfdRunning = false;

/** Pull the gap geometry and rheology straight from the shared P object -- same inputs the other tabs already use, no duplicate form. */
function cfdGeometry() {
  const U = P.U / 60;                       // m/min -> m/s
  const H = gapHeight() / 1000;             // mm -> m
  const L = P.L / 1000;                     // mm -> m
  const G = P.Pup * 1000 / (P.L / 1000);    // Pa/m, same sign convention as physics.js's dpdx (favorable = assists flow)
  const gdRef = U / H;                      // representative shear rate, for the reported "reference viscosity" only
  const muRef = muEff(gdRef);
  return { U, H, L, G, muRef, ty: P.ty, n: P.n, rho: RHO };
}

function cfdWorkerHandle() {
  if (!cfdWorker) cfdWorker = new Worker('cfd-worker.js');
  return cfdWorker;
}

function runCFD() {
  if (cfdRunning) return;
  cfdRunning = true;
  const geo = cfdGeometry();
  const t0 = performance.now();

  const worker = cfdWorkerHandle();
  const onMessage = e => {
    worker.removeEventListener('message', onMessage);
    cfdRunning = false;
    const elapsedMs = performance.now() - t0;
    if (!e.data.ok) {
      cfdResult = { error: e.data.error };
    } else {
      const r = e.data.result;
      const Re = RHO * geo.U * geo.H / geo.muRef;
      let qOutlet = 0;
      const iOut = r.nx - 1;
      for (let j = 1; j < r.ny; j++) qOutlet += 0.5 * (r.u[(j - 1) * r.nx + iOut] + r.u[j * r.nx + iOut]) * r.dy;
      const qLubrication = geo.U * geo.H / 2 + geo.G * geo.H ** 3 / (12 * geo.muRef);
      cfdResult = { r, geo, Re, elapsedMs, qOutlet, qLubrication };
    }
    setCfdButtons('idle');
    renderCFDResult();
  };
  worker.addEventListener('message', onMessage);
  worker.postMessage({
    nx: CFD_NX, ny: CFD_NY, Lx: geo.L, Ly: geo.H, U: geo.U, dpdxFavorable: geo.G,
    rho: geo.rho, muRef: geo.muRef, ty: geo.ty, n: geo.n,
    maxIter: 50000, tol: 1e-6, maxOuter: 60, outerTol: 1e-3,
  });
  setCfdButtons('running');
}

function cancelCFD() {
  if (!cfdRunning) return;
  if (cfdWorker) { cfdWorker.terminate(); cfdWorker = null; } // hard stop: a mid-loop pseudo-time-stepping solve has no partial result to hand back
  cfdRunning = false;
  setCfdButtons('idle');
  const statusEl = document.getElementById('cfdStatus');
  if (statusEl) statusEl.innerHTML = pill('Cancelled', 'warn');
}

function setCfdButtons(state) {
  const runBtn = document.getElementById('cfdRun'), cancelBtn = document.getElementById('cfdCancel');
  if (!runBtn || !cancelBtn) return;
  const running = state === 'running';
  runBtn.disabled = running;
  runBtn.textContent = running ? 'Solving…' : 'Run gap flow';
  cancelBtn.hidden = !running;
}

/** Diverging blue->red colormap (ColorBrewer RdBu-like), t in [0,1]. */
function speedColor(t) {
  const stops = [[33, 102, 172], [103, 169, 207], [253, 219, 199], [239, 138, 98], [178, 24, 43]];
  t = Math.max(0, Math.min(1, t));
  const seg = t * (stops.length - 1);
  const i0 = Math.min(Math.floor(seg), stops.length - 2), f = seg - i0;
  const a = stops[i0], b = stops[i0 + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** Velocity-magnitude field, web (moving wall) drawn at the bottom, land (stationary) at top; vertical axis exaggerated since the real gap is much thinner than the land is long. */
function drawVelocityHeatmap(cv, r) {
  const { c, w, h } = setupCanvas(cv, 0.42);
  const nx = r.nx, ny = r.ny;

  let maxSpeed = 1e-12;
  for (let k = 0; k < nx * ny; k++) maxSpeed = Math.max(maxSpeed, Math.hypot(r.u[k], r.v[k]));

  const off = document.createElement('canvas');
  off.width = nx; off.height = ny;
  const oc = off.getContext('2d');
  const img = oc.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) {
    const row = ny - 1 - j; // flip: j=0 (web) at the bottom of the picture
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const [red, g, b] = speedColor(Math.hypot(r.u[k], r.v[k]) / maxSpeed);
      const p = (row * nx + i) * 4;
      img.data[p] = red; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);

  c.clearRect(0, 0, w, h);
  c.imageSmoothingEnabled = true;
  c.drawImage(off, 0, 0, nx, ny, 0, 0, w, h);

  c.font = '12px ' + cssVar('--mono');
  outlinedText(c, 'blade land (stationary)', 8, 16, cssVar('--ink'));
  outlinedText(c, 'web (moving at U)', 8, h - 8, cssVar('--ink'));
  outlinedText(c, 'max |velocity| ' + (maxSpeed * 1000).toFixed(2) + ' mm/s', w - 190, 16, cssVar('--ink'));
}

/** u(y) at three x-stations against the 1D fully-developed reference profile (exact Couette-Poiseuille in the Newtonian limit; the same generalized-Newtonian shooting-method solve otherwise) -- the open-boundary correctness check, visible, not just asserted. */
function drawVelocityProfile(cv, r, geo) {
  const nx = r.nx, ny = r.ny;
  const stations = [{ i: 1 }, { i: Math.round((nx - 1) / 2) }, { i: nx - 2 }];

  const reference = r.prof1D.y.map((y, j) => [r.prof1D.u[j] * 1000, y * 1000]);

  let umax = geo.U;
  for (let k = 0; k < nx * ny; k++) umax = Math.max(umax, r.u[k]);
  let umin = 0;
  for (let k = 0; k < nx * ny; k++) umin = Math.min(umin, r.u[k]);

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
 * Local apparent viscosity across the gap at mid-channel -- shows the
 * non-Newtonian variation directly (flat line for Newtonian inputs,
 * higher near the low-shear core for shear-thinning/yield-stress fluids).
 *
 * For a yield-stress fluid, mu = ty/gd formally diverges to infinity in
 * the truly unyielded plug core (gd -> 0) -- the same divergence
 * physics.js's own muEff() formula already has, just never visible there
 * since it's only ever evaluated at one representative, always-nonzero
 * shear rate. Here the field is sampled pointwise, so the plug region
 * shows up as a real, large-but-not-meaningfully-finite value -- and, at
 * a strong enough yield stress, can be a large *fraction* of the gap, so
 * a statistical cap (a percentile of the column) can land inside the
 * plug itself rather than below it. Instead, the exact 1D reference
 * profile's own gd (which is exactly 0 in its unyielded region, not just
 * small) says definitively which rows are plug; the axis is scaled off
 * the other (flowing) rows only, and plug rows are drawn pinned to the
 * right edge with a label.
 */
function drawViscosityProfile(cv, r, geo) {
  const nx = r.nx, ny = r.ny;
  const iMid = Math.round((nx - 1) / 2);

  const interpGd = y => {
    const ys = r.prof1D.y, gds = r.prof1D.gd;
    if (y <= ys[0]) return gds[0];
    if (y >= ys[ys.length - 1]) return gds[gds.length - 1];
    let lo = 0, hi = ys.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ys[mid] <= y) lo = mid; else hi = mid; }
    const f = (y - ys[lo]) / (ys[hi] - ys[lo]);
    return gds[lo] + (gds[hi] - gds[lo]) * f;
  };

  const raw = [], isPlug = [];
  for (let j = 0; j < ny; j++) {
    raw.push(r.nuField[j * nx + iMid] * geo.rho);
    isPlug.push(interpGd(j * r.dy) <= 1e-6);
  }

  let muMax = geo.muRef;
  raw.forEach((mu, j) => { if (!isPlug[j]) muMax = Math.max(muMax, mu); });
  const muCap = muMax * 1.3;
  const hasPlug = isPlug.some(Boolean);

  const pts = raw.map((mu, j) => [Math.min(mu, muCap), j * r.dy * 1000]);
  plotChart(cv, 0.4, {
    x0: 0, x1: muCap, y0: 0, y1: geo.H * 1000,
    xl: 'apparent viscosity (Pa·s)' + (hasPlug ? ', capped' : ''), yl: 'position across gap y (mm)', xd: 1, yd: 2,
    s: [{ p: pts, c: cssVar('--accent'), w: 2 }],
    vl: hasPlug ? [{ x: muCap, c: cssVar('--warn'), t: 'plug →' }] : [],
  });
}

function renderCFDResult() {
  const statusEl = document.getElementById('cfdStatus');
  const bodyEl = document.getElementById('cfdBody');
  if (!statusEl || !bodyEl) return; // tab switched away before this returned

  if (!cfdResult) {
    statusEl.innerHTML = '';
    bodyEl.innerHTML = '<p class="cap">No run yet. Click "Run gap flow" to solve the 2D Navier-Stokes field for the current inputs.</p>';
    return;
  }

  if (cfdResult.error) {
    statusEl.innerHTML = pill('Solver error: ' + cfdResult.error, 'bad');
    bodyEl.innerHTML = '';
    return;
  }

  const { r, geo, Re, elapsedMs, qOutlet, qLubrication } = cfdResult;

  if (!r.converged || !r.outerConverged) {
    statusEl.innerHTML = pill(!r.converged ? 'Solver did not converge' : 'Non-Newtonian iteration did not converge in ' + r.outerIterations + ' passes', 'bad') + pill('Re ' + Re.toExponential(2), '');
    bodyEl.innerHTML = '<p class="cap">No field is shown: a non-converged result is not a valid physical prediction.</p>';
    return;
  }

  const qDiffPct = Math.abs(qOutlet - qLubrication) / qLubrication * 100;
  const isNewtonian = geo.ty === 0 && geo.n === 1;
  const lubricationNote = qDiffPct < 5
    ? 'Matches the lubrication formula within ' + qDiffPct.toFixed(2) + '%'
    : 'Diverges from the lubrication formula by ' + qDiffPct.toFixed(1) + '%' + (isNewtonian
      ? ' -- expected once inertia is not negligible'
      : ' -- expected: that formula uses one representative viscosity, which understates a shear-thinning fluid\'s real flow rate (lower viscosity where shear is actually highest, near the walls)');
  statusEl.innerHTML =
    pill('Converged', 'ok')
    + pill('Re ' + Re.toExponential(2), '')
    + pill(lubricationNote, qDiffPct < 5 ? 'ok' : 'warn')
    + pill(isNewtonian ? 'Newtonian' : 'Non-Newtonian, ' + r.outerIterations + ' rheology passes', '');

  bodyEl.innerHTML = `
    <canvas id="cfdHeat" role="img" aria-label="Velocity magnitude across the metering gap"></canvas>
    <p class="cap"><b>Velocity magnitude, land length &times; gap height.</b> Web (moving) at the bottom, blade land (stationary) at top. Vertical axis exaggerated -- the real gap is ${(geo.H * 1000).toFixed(2)} mm against a ${(geo.L * 1000).toFixed(1)} mm land.</p>
    <canvas id="cfdProfile" role="img" aria-label="Velocity profile across the gap, computed vs the fully-developed reference"></canvas>
    <p class="cap"><b>u(y) at 3 stations</b> (near inlet, mid-channel, near outlet, solid) against the fully-developed reference profile for this gap and rheology (dashed) -- exact Couette-Poiseuille when Newtonian, the same generalized shear-stress-inversion solve otherwise. They should coincide if the flow stays fully developed -- the correctness check for the open boundary conditions.</p>
    <canvas id="cfdVisc" role="img" aria-label="Apparent viscosity across the gap at mid-channel"></canvas>
    <p class="cap"><b>Apparent viscosity across the gap</b> (mid-channel), from the local shear rate via the same rheology formula as the rest of the app. Flat when Newtonian; higher toward the low-shear core for shear-thinning or yield-stress inputs. With enough yield stress the core stops shearing entirely (an unyielded plug) -- the axis is capped just past it, since viscosity formally diverges to infinity there, and those points are pinned to the right edge rather than left to blow out the scale.</p>
    <div class="stats" id="cfdStats"></div>`;

  drawVelocityHeatmap(document.getElementById('cfdHeat'), r);
  drawVelocityProfile(document.getElementById('cfdProfile'), r, geo);
  drawViscosityProfile(document.getElementById('cfdVisc'), r, geo);

  document.getElementById('cfdStats').innerHTML = [
    ['Grid', r.nx + ' × ' + r.ny],
    ['Inner iterations (last pass)', r.iterations + ' (residual ' + r.residual.toExponential(2) + ')'],
    ['Rheology passes', r.outerIterations + (isNewtonian ? ' (Newtonian: 1 pass expected)' : '')],
    ['Solve time', elapsedMs.toFixed(0) + ' ms'],
    ['Flow rate, 2D solve', (qOutlet * 1e6).toFixed(3) + ' mm²/s per mm width'],
    ['Flow rate, lubrication formula', (qLubrication * 1e6).toFixed(3) + ' mm²/s per mm width'],
    ['Reference viscosity (at U/H)', geo.muRef.toFixed(2) + ' Pa·s'],
  ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}

function viewCFD() {
  view.innerHTML = `
    <div class="status" id="cfdStatus"></div>
    <p class="cap"><b>2D Navier-Stokes solve of the metering gap</b> at the web centreline -- the same cross-section the other tabs use, now solved as a real 2D flow field (streamfunction-vorticity formulation, full nonlinear Navier-Stokes, no lubrication-theory shortcut) instead of the closed-form formula, with the same non-Newtonian rheology (yield stress, shear-thinning index) as the rest of the app applied via a shear-rate-dependent viscosity field. Validated against the published lid-driven-cavity benchmark (Ghia, Ghia &amp; Shin, 1982) and, below, against this app's own filmThickness() formula in the regime where they should agree. Runs off the main thread (a Web Worker), so the page stays responsive during the solve.</p>
    <p class="cap"><b>Not yet built:</b> the other 3 lateral locations and their comparison view, free-surface/meniscus tracking downstream of the gap, porous-fibre coupling, and saved/persisted cases. This tab is the first validated slice of that larger feature.</p>
    <button id="cfdRun" class="btn btn-primary" type="button">Run gap flow</button>
    <button id="cfdCancel" class="btn btn-secondary" type="button" hidden>Cancel</button>
    <div id="cfdBody"></div>`;

  document.getElementById('cfdRun').onclick = runCFD;
  document.getElementById('cfdCancel').onclick = cancelCFD;
  setCfdButtons(cfdRunning ? 'running' : 'idle');

  renderCFDResult();
}
