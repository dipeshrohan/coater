/*
 * cfd-worker.js — runs one location's CFD solve off the main thread: the
 * 2D gap flow (cfd-gap-solver.js) and the downstream free-surface film
 * development that follows it (cfd-solver.js's solveDownstreamFilm).
 *
 * Message in:  { geometry: 'round'|'flat', H, L, R, Xup, nx, ny, U, Pup,
 *                rho, muRef, ty, n, muRep, gamma, g, ovenDistance }
 *              lengths in m, U in m/s, Pup in Pa, muRef = the slider's
 *              viscosity at 2.7 1/s (the rheology law's own reference),
 *              muRep = mu at the representative shear rate U/H (only for
 *              the one-viscosity lubrication estimate shown alongside).
 * Messages out: { progress: { it, residual, s } } while solving, then
 *               { ok: true, result } or { ok: false, error }.
 */
importScripts('cfd-solver.js', 'cfd-gap-solver.js');

/** Blade height above the web over the solved domain, x = 0 at the inlet, x = Lx at the metering edge. */
function bladeShape(o) {
  if (o.geometry === 'round') {
    // Round entry of radius R whose lowest point is the metering edge (gap H
    // there), converging from the pool edge Xup upstream.
    const R = o.R, X = o.Xup, H = o.H, root = x => Math.sqrt(R * R - (X - x) ** 2);
    return { Lx: X, h: x => H + R - root(x), hx: x => -(X - x) / root(x), hxx: x => R * R / Math.pow(root(x), 3) };
  }
  return { Lx: o.L, h: () => o.H, hx: () => 0, hxx: () => 0 };
}

/** Reynolds lubrication flow rate for the same shape and pressure drop, one viscosity -- the classical estimate shown for comparison. */
function lubricationQ(o, shape) {
  const M = 20000, mu = o.muRep;
  let I2 = 0, I3 = 0;
  for (let k = 0; k < M; k++) { const h = shape.h((k + 0.5) * shape.Lx / M); I2 += shape.Lx / M / (h * h); I3 += shape.Lx / M / (h * h * h); }
  return (o.Pup + 6 * mu * o.U * I2) / (12 * mu * I3);
}

onmessage = e => {
  try {
    const o = e.data;
    const shape = bladeShape(o);
    const law = gd => muEffLocal(gd, o.muRef, o.ty, o.n);
    let lastPost = 0;
    const r = solveGapFlow({
      nx: o.nx, ny: o.ny, ...shape, U: o.U, rho: o.rho, mu: law, Pup: o.Pup,
      onIteration: h => { const t = Date.now(); if (t - lastPost > 150) { lastPost = t; postMessage({ progress: { it: h.it, residual: h.residual, s: h.s } }); } },
    });

    // Flat land: the exact fully developed 1D profile for the same pressure
    // gradient is the exact answer there -- shown as the reference.
    let prof1D = null;
    if (o.geometry !== 'round') {
      const p1 = solveFullyDeveloped1D({ Ly: o.H, U: o.U, G: o.Pup / o.L, muRef: o.muRef, ty: o.ty, n: o.n, ny: 401 });
      prof1D = { y: p1.y, u: Array.from(p1.u), gd: Array.from(p1.gd) };
    }

    // Downstream free-surface film development, driven by this solve's own
    // flow rate (see solveDownstreamFilm's header: a reuse of the Slurry
    // animation tab's free-surface method). Representative viscosity at the
    // film's own shear scale U/h_inf, h_inf = Q/U.
    const Hedge = shape.h(shape.Lx);
    const muDownstream = muEffLocal(o.U * o.U / r.Q, o.muRef, o.ty, o.n);
    const film = solveDownstreamFilm({
      H0: Hedge, Q: r.Q, U: o.U, mu: muDownstream,
      gamma: o.gamma, rho: o.rho, g: o.g, Lx: o.ovenDistance,
      nx: 200, maxSteps: 150000, tol: 1e-8,
    });

    postMessage({ ok: true, result: { ...r, prof1D, film, muDownstream, qLub: lubricationQ(o, shape), Hedge } });
  } catch (err) {
    postMessage({ ok: false, error: err.message });
  }
};
