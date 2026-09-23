/*
 * cfd-worker.js — runs the CFD gap solve, and the downstream free-surface
 * film development that follows it, off the main thread.
 *
 * The gap solve running off-thread existed as a planned Phase 4
 * requirement ("do not freeze the GUI" for parallel multi-location runs);
 * brought forward because the non-Newtonian Picard extension
 * (cfd-solver.js's solveChannelNSNonNewtonian) measured up to ~3s for
 * some rheology combinations -- long enough to visibly freeze a
 * synchronous single-threaded call, which the spec rules out.
 *
 * Message in:  { nx, ny, Lx, Ly, U, dpdxFavorable, rho, muRef, ty, n,
 *                maxIter, tol, maxOuter, outerTol, gamma, g, ovenDistance }
 * Message out: { ok: true, result: {...} } or { ok: false, error: string }
 */
importScripts('cfd-solver.js');

onmessage = e => {
  try {
    const opts = e.data;
    const r = solveChannelNSNonNewtonian(opts);

    let qOutlet = 0;
    const iOut = r.nx - 1;
    for (let j = 1; j < r.ny; j++) qOutlet += 0.5 * (r.u[(j - 1) * r.nx + iOut] + r.u[j * r.nx + iOut]) * r.dy;

    // Downstream free-surface film development, driven by this solve's
    // own real outlet flow rate (see solveDownstreamFilm's own header for
    // why this is a reuse of simulation.js's existing free-surface
    // method, not new physics). Representative viscosity uses the
    // downstream film's own natural shear scale U/h_inf (h_inf = Q/U),
    // not the gap's U/H -- a different, thinner regime once the film is
    // no longer bounded by the blade.
    const hInfEstimate = qOutlet / opts.U;
    const gdDownstream = opts.U * opts.U / qOutlet;
    const muDownstream = muEffLocal(gdDownstream, opts.muRef, opts.ty, opts.n);
    // maxSteps is generous because convergence time scales with the real
    // physical residence time to the oven (Lx/U) -- at the slowest web
    // speed and longest oven distance the slider ranges allow, reaching
    // the true steady profile measured ~75600 steps (~1.1s wall-clock,
    // off the main thread so it doesn't block the page either way).
    const film = solveDownstreamFilm({
      H0: opts.Ly, Q: qOutlet, U: opts.U, mu: muDownstream,
      gamma: opts.gamma, rho: opts.rho, g: opts.g, Lx: opts.ovenDistance,
      nx: 200, maxSteps: 150000, tol: 1e-8,
    });

    // psi (streamfunction) and omega (vorticity) are kept: flow-tracking
    // post-processing seeds streamlines at equal psi spacing, checks them
    // against psi, finds eddies from psi extrema, and plots vorticity.
    const result = {
      nx: r.nx, ny: r.ny, dx: r.dx, dy: r.dy,
      u: r.u, v: r.v, psi: r.psi, omega: r.omega, nuField: r.nuField,
      iterations: r.iterations, converged: r.converged, residual: r.residual,
      outerIterations: r.outerIterations, outerConverged: r.outerConverged, outerResidual: r.outerResidual,
      prof1D: { y: r.prof1D.y, u: Array.from(r.prof1D.u), gd: Array.from(r.prof1D.gd) },
      qOutlet, muDownstream,
      film,
    };
    postMessage({ ok: true, result });
  } catch (err) {
    postMessage({ ok: false, error: err.message });
  }
};
