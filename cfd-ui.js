/*
 * cfd-ui.js — DOM wiring for the "CFD Analysis" tab: runs the real
 * open-channel Navier-Stokes solver (cfd-solver.js, solveChannelNS) on
 * the current gap geometry and shows the resulting velocity field.
 *
 * Phase 1 of the Cross-Web 2D CFD Analysis feature (see CFD_PLAN.md).
 * This is the first visible slice: one location (the web centreline --
 * the same cross-section physics.js already uses), a single representative
 * viscosity (matching filmThickness()'s own convention), the velocity
 * field, and a validation check against physics.js's own formula in the
 * regime where they should agree. Not yet built: the other 3 lateral
 * locations and their comparison view, free-surface/meniscus tracking,
 * porous-fibre coupling, the non-Newtonian Picard extension, Cancel and
 * parallel multi-location runs via Web Workers, and saved/persisted
 * cases -- all tracked as open work in CFD_PLAN.md.
 */

const CFD_NX = 121, CFD_NY = 61;
let cfdResult = null, cfdRunning = false;

/** Pull the gap geometry and flow parameters straight from the shared P object -- same inputs the other tabs already use, no duplicate form. */
function cfdGeometry() {
  const U = P.U / 60;                       // m/min -> m/s
  const H = gapHeight() / 1000;             // mm -> m
  const L = P.L / 1000;                     // mm -> m
  const gd = U / H;                         // representative shear rate, same convention as filmThickness()
  const mu = muEff(gd);
  const G = P.Pup * 1000 / (P.L / 1000);    // Pa/m, same sign convention as physics.js's dpdx (favorable = assists flow)
  const nu = mu / RHO;
  return { U, H, L, mu, nu, G };
}

function runCFD() {
  if (cfdRunning) return;
  cfdRunning = true;
  const geo = cfdGeometry();
  const t0 = performance.now();
  const sol = solveChannelNS({
    nx: CFD_NX, ny: CFD_NY, Lx: geo.L, Ly: geo.H,
    nu: geo.nu, mu: geo.mu, U: geo.U, dpdxFavorable: geo.G,
    maxIter: 50000, tol: 1e-6,
  });
  const elapsedMs = performance.now() - t0;
  const Re = RHO * geo.U * geo.H / geo.mu;

  let qOutlet = 0;
  const iOut = sol.nx - 1;
  for (let j = 1; j < sol.ny; j++) {
    qOutlet += 0.5 * (sol.u[(j - 1) * sol.nx + iOut] + sol.u[j * sol.nx + iOut]) * sol.dy;
  }
  const qLubrication = geo.U * geo.H / 2 + geo.G * geo.H ** 3 / (12 * geo.mu);

  cfdResult = { sol, geo, Re, elapsedMs, qOutlet, qLubrication };
  cfdRunning = false;
  renderCFDResult();
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
function drawVelocityHeatmap(cv, sol) {
  const { c, w, h } = setupCanvas(cv, 0.42);
  const nx = sol.nx, ny = sol.ny;

  let maxSpeed = 1e-12;
  for (let k = 0; k < nx * ny; k++) maxSpeed = Math.max(maxSpeed, Math.hypot(sol.u[k], sol.v[k]));

  const off = document.createElement('canvas');
  off.width = nx; off.height = ny;
  const oc = off.getContext('2d');
  const img = oc.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) {
    const row = ny - 1 - j; // flip: j=0 (web) at the bottom of the picture
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const [r, g, b] = speedColor(Math.hypot(sol.u[k], sol.v[k]) / maxSpeed);
      const p = (row * nx + i) * 4;
      img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255;
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

/** u(y) at three x-stations against the exact analytic Couette-Poiseuille solution -- the open-boundary correctness check, visible, not just asserted. */
function drawVelocityProfile(cv, sol, geo) {
  const nx = sol.nx, ny = sol.ny;
  const stations = [{ i: 1, label: 'near inlet' }, { i: Math.round((nx - 1) / 2), label: 'mid-channel' }, { i: nx - 2, label: 'near outlet' }];

  const analytic = [];
  for (let j = 0; j < ny; j++) { const y = j * sol.dy; analytic.push([sol.uIn(y) * 1000, y * 1000]); }

  let umax = geo.U;
  for (let k = 0; k < nx * ny; k++) umax = Math.max(umax, sol.u[k]);
  let umin = 0;
  for (let k = 0; k < nx * ny; k++) umin = Math.min(umin, sol.u[k]);

  const series = [{ p: analytic, c: cssVar('--muted'), w: 4, dash: [1, 3] }];
  stations.forEach((st, si) => {
    const pts = [];
    for (let j = 0; j < ny; j++) pts.push([sol.u[j * nx + st.i] * 1000, j * sol.dy * 1000]);
    series.push({ p: pts, c: cssVar('--accent'), w: 1.6 });
  });

  plotChart(cv, 0.5, {
    x0: Math.min(umin, 0) * 1000 * 1.1, x1: umax * 1000 * 1.1, y0: 0, y1: geo.H * 1000,
    xl: 'velocity u (mm/s)', yl: 'position across gap y (mm)', xd: 1, yd: 2,
    s: series,
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

  const { sol, geo, Re, elapsedMs, qOutlet, qLubrication } = cfdResult;

  if (!sol.converged) {
    statusEl.innerHTML = pill('Did not converge in ' + sol.iterations + ' iterations', 'bad') + pill('Re ' + Re.toExponential(2), '');
    bodyEl.innerHTML = '<p class="cap">No field is shown: a non-converged result is not a valid physical prediction.</p>';
    return;
  }

  const qDiffPct = Math.abs(qOutlet - qLubrication) / qLubrication * 100;
  statusEl.innerHTML =
    pill('Converged', 'ok')
    + pill('Re ' + Re.toExponential(2), '')
    + pill(qDiffPct < 5 ? 'Matches the lubrication formula within ' + qDiffPct.toFixed(2) + '%' : 'Diverges from the lubrication formula by ' + qDiffPct.toFixed(1) + '% -- expected once inertia is not negligible', qDiffPct < 5 ? 'ok' : 'warn');

  bodyEl.innerHTML = `
    <canvas id="cfdHeat" role="img" aria-label="Velocity magnitude across the metering gap"></canvas>
    <p class="cap"><b>Velocity magnitude, land length &times; gap height.</b> Web (moving) at the bottom, blade land (stationary) at top. Vertical axis exaggerated -- the real gap is ${(geo.H * 1000).toFixed(2)} mm against a ${(geo.L * 1000).toFixed(1)} mm land.</p>
    <canvas id="cfdProfile" role="img" aria-label="Velocity profile across the gap, computed vs analytic"></canvas>
    <p class="cap"><b>u(y) at 3 stations</b> (near inlet, mid-channel, near outlet, solid) against the exact analytic Couette-Poiseuille solution for this gap (dashed). They should coincide if the flow stays fully developed -- the correctness check for the open boundary conditions, not just a comparison against this app's own formula.</p>
    <div class="stats" id="cfdStats"></div>`;

  drawVelocityHeatmap(document.getElementById('cfdHeat'), sol);
  drawVelocityProfile(document.getElementById('cfdProfile'), sol, geo);

  document.getElementById('cfdStats').innerHTML = [
    ['Grid', sol.nx + ' × ' + sol.ny],
    ['Iterations', sol.iterations + ' (residual ' + sol.residual.toExponential(2) + ')'],
    ['Solve time', elapsedMs.toFixed(0) + ' ms'],
    ['Flow rate, 2D solve', (qOutlet * 1e6).toFixed(3) + ' mm²/s per mm width'],
    ['Flow rate, lubrication formula', (qLubrication * 1e6).toFixed(3) + ' mm²/s per mm width'],
    ['Effective viscosity used', geo.mu.toFixed(2) + ' Pa·s (representative, at U/H)'],
  ].map(a => `<div class="stat"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
}

function viewCFD() {
  view.innerHTML = `
    <div class="status" id="cfdStatus"></div>
    <p class="cap"><b>2D Navier-Stokes solve of the metering gap</b> at the web centreline -- the same cross-section the other tabs use, now solved as a real 2D flow field (streamfunction-vorticity formulation, full nonlinear Navier-Stokes, no lubrication-theory shortcut) instead of the closed-form formula. The method is validated against the published lid-driven-cavity benchmark (Ghia, Ghia &amp; Shin, 1982) and, below, against this app's own filmThickness() formula in the low-Reynolds-number regime where the two should agree.</p>
    <p class="cap"><b>Not yet built:</b> the other 3 lateral locations and their comparison view, free-surface/meniscus tracking downstream of the gap, porous-fibre coupling, shear-rate variation across the gap (a single representative viscosity is used here, same convention as filmThickness()), Cancel and parallel multi-location runs, and saved/persisted cases. This tab is the first validated slice of that larger feature.</p>
    <button id="cfdRun" class="btn btn-primary" type="button">Run gap flow</button>
    <div id="cfdBody"></div>`;

  document.getElementById('cfdRun').onclick = () => {
    const btn = document.getElementById('cfdRun');
    btn.disabled = true; btn.textContent = 'Solving…';
    setTimeout(() => {
      runCFD();
      btn.disabled = false; btn.textContent = 'Run gap flow';
    }, 10); // let the disabled/label state paint before the synchronous solve
  };

  renderCFDResult();
}
