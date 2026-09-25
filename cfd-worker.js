/*
 * cfd-worker.js — runs one location's CFD solve off the main thread: the
 * 2D flow under the blade, over its exit face and into the free film, with
 * the meniscus and its contact line solved together with the flow
 * (cfd-fem.js), then the 1D thin-film development from the end of that 2D
 * domain to the oven (cfd-solver.js's solveDownstreamFilm).
 *
 * Message in:  { geometry: 'round'|'flat', H, L, R, Xup, exitAngle, contactDeg,
 *                U, Pup, rho, muRef, ty, n, muRep, gamma, g, ovenDistance,
 *                webSlip (1 / slip length, 1/m: slip over the fibre surface;
 *                0 = no slip) }
 *              lengths in m, angles in degrees, U in m/s, Pup in Pa,
 *              muRef = the slider's viscosity at 2.7 1/s (the rheology
 *              law's own reference), muRep = mu at the representative
 *              shear rate U/H (only for the one-viscosity lubrication
 *              estimate shown alongside).
 * Messages out: { progress: { it, residual, s, stage } } while solving, then
 *               { ok: true, result } or { ok: false, error }.
 * result.trace: the convergence record over every solve the strategy ran, in order --
 *   r: the residual at each Newton iterate (all solves in sequence),
 *   solves: [{ label, k0 (index of its first iterate in r), n (its iterates), converged, residual }],
 *   used: index in solves of the solve whose solution is the result.
 */
// (cfd-1d.js: bladeShape, the blade height over the web, shared with the 1D stage so both see the same geometry)
importScripts('cfd-solver.js', 'cfd-gap-solver.js', 'cfd-fem.js', 'cfd-1d.js');

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
    const shape = bladeShape(o), xe = shape.Lx, H = shape.h(xe);
    const law = gd => muEffLocal(gd, o.muRef, o.ty, o.n);
    const qLub = lubricationQ(o, shape);
    let lastPost = 0, stage = '', sent = 0;
    const trace = { r: [], solves: [], used: -1 };
    // progress: the stage, the latest residual, and the residuals since the last post with the solves so far (live residual plots)
    const post = h => {
      const t = Date.now();
      if (t - lastPost <= 150) return;
      lastPost = t;
      const add = trace.r.slice(sent); sent = trace.r.length;
      postMessage({ progress: { it: h.it, residual: h.residual, s: h.s, stage, add, solves: trace.solves.map(sv => [sv.label, sv.k0]) } });
    };
    let open = null;
    const onIteration = h => { if (Number.isFinite(h.residual)) trace.r.push(h.residual); post(h); };
    const onSolveStart = label => { if (open) open.n = trace.r.length - open.k0; open = { label, k0: trace.r.length, n: 0, converged: false, residual: NaN }; trace.solves.push(open); return trace.solves.length - 1; };
    const onSolveEnd = e => { if (open) Object.assign(open, { n: trace.r.length - open.k0, converged: e.converged, residual: e.residual }); open = null; };
    // mesh: the settings sent (o.solver), else blade elements about 0.6 H long (12..40); rows graded toward the blade/face/surface
    const sv = o.solver || {};
    const nEb = sv.nEb ?? Math.max(12, Math.min(40, Math.round(xe / (0.6 * H))));
    const r = solveCoaterFEM({
      hFn: shape.h, xe, faceDeg: o.exitAngle, contactDeg: o.contactDeg,
      U: o.U, Pup: o.Pup, rho: o.rho, g: o.g, gamma: o.gamma, mu: law, gdMin: 1e-3 * o.U / H, webSlip: o.webSlip || 0,
      Ld: Math.max(12e-3, (sv.ldGaps ?? 8) * H), nEb, nEf: sv.nEf ?? 6, nEs: sv.nEs ?? 24, nEy: sv.nEy ?? 6, fInfGuess: qLub / o.U,
      gradeB: sv.gradeB, gradeS: sv.gradeS, gradeY: sv.gradeY, tol: sv.tol, maxIter: sv.maxIter,
      onStage: t => { stage = t; lastPost = 0; post({ it: 0, residual: NaN, s: 1 }); }, onIteration, onSolveStart, onSolveEnd,
    });
    // (a solve that ended without returning: its iterates so far)
    if (open) open.n = trace.r.length - open.k0;
    trace.used = r.solveId ?? -1;
    if (!r.x || r.error) throw new Error(r.error || 'no solution');   // (a solve that stopped part way returns its last state with the reason)
    const g = coaterGrid(r, { xe, H, faceDeg: o.exitAngle, contactDeg: o.contactDeg, U: o.U });

    // Flat land: away from its ends the flow is fully developed, so the exact
    // 1D profile for the pressure gradient the 2D solution has at mid-land
    // must match it there -- shown as the reference. (Not the bead pressure
    // over the land length: the meniscus sets the pressure at the edge.)
    let prof1D = null;
    if (o.geometry !== 'round') {
      let i = 1;
      while (i < g.iCorner - 1 && g.xWeb[i] < 0.5 * xe) i++;
      const G = -(g.pWeb[i + 1] - g.pWeb[i - 1]) / (g.xWeb[i + 1] - g.xWeb[i - 1]);
      // (with slip over the fibre, the wall moves at the solution's own web-surface velocity there)
      const p1 = solveFullyDeveloped1D({ Ly: o.H, U: g.uWeb[i], G, muRef: o.muRef, ty: o.ty, n: o.n, ny: 401 });
      prof1D = { y: p1.y, u: Array.from(p1.u), gd: Array.from(p1.gd), x: g.xWeb[i], G, uWall: g.uWeb[i] };
    }

    // Beyond the 2D domain: the 1D thin-film development (a reuse of the
    // Slurry animation tab's free-surface method) from the 2D film's end to
    // the oven, driven by this solve's own flow rate. Representative
    // viscosity at the film's own shear scale U/h_inf, h_inf = Q/U.
    const filmStart = g.xEnd - xe;                     // distance from the edge where the 1D film takes over
    const muDownstream = muEffLocal(o.U * o.U / g.Q, o.muRef, o.ty, o.n);
    const film = o.ovenDistance > filmStart ? solveDownstreamFilm({
      H0: g.hEnd, Q: g.Q, U: o.U, mu: muDownstream,
      gamma: o.gamma, rho: o.rho, g: o.g, Lx: o.ovenDistance - filmStart,
      nx: 200, maxSteps: 150000, tol: 1e-8,
    }) : { error: 'the oven is inside the 2D domain' };

    postMessage({ ok: true, result: { ...g, prof1D, film, filmStart, muDownstream, qLub, Hedge: H, nEb, trace } });
  } catch (err) {
    postMessage({ ok: false, error: err.message });
  }
};
