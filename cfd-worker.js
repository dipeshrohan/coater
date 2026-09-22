/*
 * cfd-worker.js — runs the CFD gap solve off the main thread.
 *
 * Existed as a planned Phase 4 requirement ("do not freeze the GUI" for
 * parallel multi-location runs); brought forward because the non-Newtonian
 * Picard extension (cfd-solver.js's solveChannelNSNonNewtonian) measured
 * up to ~3s for some rheology combinations -- long enough to visibly
 * freeze a synchronous single-threaded call, which the spec rules out.
 *
 * Message in:  { nx, ny, Lx, Ly, U, dpdxFavorable, rho, muRef, ty, n, maxIter, tol, maxOuter, outerTol }
 * Message out: { ok: true, result: {...solveChannelNSNonNewtonian's return, arrays as transferable Float64Arrays} }
 *           or { ok: false, error: string }
 */
importScripts('cfd-solver.js');

onmessage = e => {
  try {
    const r = solveChannelNSNonNewtonian(e.data);
    // psi/omega are large and not needed by the UI; drop them, keep u/v/nuField/prof1D.
    const result = {
      nx: r.nx, ny: r.ny, dx: r.dx, dy: r.dy,
      u: r.u, v: r.v, nuField: r.nuField,
      iterations: r.iterations, converged: r.converged, residual: r.residual,
      outerIterations: r.outerIterations, outerConverged: r.outerConverged, outerResidual: r.outerResidual,
      prof1D: { y: r.prof1D.y, u: Array.from(r.prof1D.u), gd: Array.from(r.prof1D.gd) },
      uIn: undefined, // functions aren't structured-cloneable; the UI reconstructs the reference curve from prof1D instead
    };
    postMessage({ ok: true, result });
  } catch (err) {
    postMessage({ ok: false, error: err.message });
  }
};
