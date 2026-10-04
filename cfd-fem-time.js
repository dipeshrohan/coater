/*
 * cfd-fem-time.js — the 2D coating flow in time: solveFEM (cfd-fem.js) marched
 * step by step from a starting state. Pure computation, no DOM.
 *
 *  - Each step is one implicit solve of the full problem (flow, free surface,
 *    contact line) at the new time, solveFEM's `time` option: Arbitrary
 *    Lagrangian-Eulerian on the spine mesh (the spines' nodes move with the
 *    surface; d/dt at the moving nodes, the convection relative to them, the
 *    kinematic condition on the velocity relative to the surface).
 *  - BDF2 with a variable step (the first step backward Euler).
 *  - The step follows the solution: the local error of each step is estimated
 *    against a quadratic extrapolation of the last three states (Milne's
 *    device with BDF2's and the extrapolation's error constants for the
 *    actual steps), the step is redone shorter when the error is over the
 *    tolerance, and the next step is dt (tol / err)^(1/3) (0.9 safety, x0.2
 *    to x2). A step whose Newton solve fails is redone at a quarter.
 *  - The steps land on the requested output times and on the end time.
 */

const FT_ = typeof solveFEM === 'function' ? { solveFEM, FEM_QP, femQuality } : require('./cfd-fem.js');

/** Area of the liquid (m^2 per m of width): Gauss over the Q2 elements of a result r. */
function femArea(r) {
  const NR = r.NR, nEx = (r.NC - 1) / 2, nEy = (NR - 1) / 2;
  let A = 0;
  for (let ex = 0; ex < nEx; ex++) for (let ey = 0; ey < nEy; ey++) {
    for (const q of FT_.FEM_QP) {
      let xs = 0, xt = 0, ys = 0, yt = 0;
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const n = (2 * ex + a) * NR + 2 * ey + b, i = b * 3 + a;
        xs += r.x[n] * q.Nxi[i]; xt += r.x[n] * q.Net[i]; ys += r.y[n] * q.Nxi[i]; yt += r.y[n] * q.Net[i];
      }
      A += q.w * (xs * yt - xt * ys);
    }
  }
  return A;
}

/** Flow through the inlet and the outlet spines (m^2/s per m of width), from the stream function. */
const femFlows = r => ({ Qin: r.psi[r.NR - 1], Qout: r.psi[(r.NC - 1) * r.NR + r.NR - 1] });

/**
 * March from r0 (a converged solveFEM / solveCoaterFEM result: the state at t0).
 * opts:
 *   call      solveFEM's options for this flow (default r0.call, which solveCoaterFEM keeps); Hr and Ur stay
 *             as they are for the whole march
 *   at(t)     the options that change in time (inlet, U, topSpeed, ...), merged over call at each step's time
 *             (a moving web, U not 0, always takes the outlet end's kinematic condition: flatEnd off)
 *   t0, tEnd  start (default 0) and end time, s
 *   dt0       first step (default 1e-3 (tEnd - t0)); dtMin, dtMax (defaults 1e-9 (tEnd - t0), (tEnd - t0) / 10)
 *   fixed     true: every step dt0 (no error control) -- for convergence studies
 *   tol       local error per step (default 1e-3), in the units of hScale (heights, the contact line; default Hr)
 *             and uScale (velocities; default the larger of Ur and the fastest speed in the flow)
 *   earlier   { r, dt }: the state at t0 - dt, so the first step is already BDF2 (an exact history)
 *   times     output times: the steps land on them, and frames keeps the result there
 *   keep(r, t, info)  what to keep of the result at an output time (default: r itself); info { mode, meshInfo }: the
 *             contact line's mode and the mesh's layout (solveCoaterFEM's meshInfo) the result is on
 *   maxSteps  (default 20000); maxIter: Newton per step (default 12)
 *   faceSlip  slip length (m) on the exit face below the contact line (solveFEM's faceSlip), for the whole march
 *   onStep(rec)  after each accepted step; return false to stop
 *   remesh    (a solveCoaterFEM start, which carries r0.relayout) default true: when the moving mesh has lost half
 *             its shape quality (femQuality), or the contact line has moved a quarter of the way from where its
 *             mesh was laid out, a new mesh is laid out along the surface as it is and the state carried over
 *             (interpolated); the march goes on from there (a backward-Euler step first). Gibbs, as the steady
 *             solve: a contact line coming down to the edge pins there (pinAt, default 0.02 gap heights); pinned,
 *             it climbs the face again when the surface would leave the edge flatter than the contact angle allows.
 *             A surface no new mesh keeps in shape (quality below minQuality, default 0.1) ends the march with an error.
 * Returns { t, dt, h, top: [{ x, y }] (the top boundary, inlet to outlet), s, Qin, Qout, area, err, iterations,
 *   mode: per accepted step from t0 (index 0: the start), frames: [{ t, r }], remeshes: [{ t, mode, quality,
 *   why }], last (the final result) and call (its solve's options, on the mesh it ended on), steps, rejected,
 *   failed (Newton), completed, error }.
 */
function femMarch(r0, opts = {}) {
  let call = { ...(opts.call || r0.call) };
  if (!call || !call.mesh) return { error: 'no solve to march (the starting result keeps no call)' };
  const quiet = c => ({ ...c, homotopy: false, onIteration: undefined, onSolveStart: undefined, onSolveEnd: undefined, initNodal: undefined, init: undefined, label: undefined });
  call = quiet(call);
  if (opts.faceSlip != null) call.faceSlip = opts.faceSlip || undefined;
  const Hr = call.Hr, Ur = call.Ur;
  const t0 = opts.t0 ?? 0, tEnd = opts.tEnd, span = tEnd - t0;
  if (!(span > 0)) return { error: 'the end time must be after the start' };
  const tol = opts.tol ?? 1e-3, hS = opts.hScale ?? Hr;
  const dtMin = opts.dtMin ?? 1e-9 * span, dtMax = opts.dtMax ?? span / 10, maxSteps = opts.maxSteps ?? 20000, maxIter = opts.maxIter ?? 12;
  const times = (opts.times || []).filter(t => t > t0 && t <= tEnd).sort((a, b) => a - b);
  const keep = opts.keep || (r => r);
  const freeOf = r => { const f = []; for (let c = 0; c < r.NC; c++) if (r.surface && r.surface.h[c] !== 0) f.push(c); return f; };
  let free = freeOf(r0);

  // the mesh as laid out (solveCoaterFEM's start): its mode, contact-line spine, quality and contact line then
  const relayout = opts.remesh !== false && typeof r0.relayout === 'function' ? r0.relayout : null;
  const H = Hr, pinAt = (opts.pinAt ?? 0.02) * H;
  let mode = r0.meniscus ? r0.meniscus.mode : null, layout = null, cCL = r0.meshInfo ? r0.meshInfo.cCL : null;
  let qLay = relayout ? FT_.femQuality(call.mesh, r0.surface) : null, sLay = r0.surface ? r0.surface.s : 0, mInfo = r0.meshInfo || null;

  // history, newest first: { t, r }
  let hist = [{ t: t0, r: r0 }];
  if (opts.earlier) hist.push({ t: t0 - opts.earlier.dt, r: opts.earlier.r });
  const out = { t: [], dt: [], h: [], top: [], s: [], Qin: [], Qout: [], area: [], err: [], iterations: [], mode: [], frames: [], remeshes: [], steps: 0, rejected: 0, failed: 0, completed: false };
  const record = (t, r, dt, err) => {
    const f = femFlows(r), NR = r.NR, x = new Float64Array(r.NC), y = new Float64Array(r.NC);
    for (let c = 0; c < r.NC; c++) { x[c] = r.x[c * NR + NR - 1]; y[c] = r.y[c * NR + NR - 1]; }
    out.t.push(t); out.dt.push(dt); out.h.push(Float64Array.from(r.surface ? r.surface.h : [])); out.top.push({ x, y }); out.s.push(r.surface ? r.surface.s : 0);
    out.Qin.push(f.Qin); out.Qout.push(f.Qout); out.area.push(femArea(r)); out.err.push(err); out.iterations.push(r.iterations || 0); out.mode.push(mode);
  };
  record(t0, r0, 0, 0);

  // the local error of a BDF2 step from t_n to t_n+1 = t_n + dt (r: its result), against the quadratic through the last three states
  const lteOf = (r, dt) => {
    if (hist.length < 3) return null;
    const [A, B, C] = hist, t = A.t + dt, dt1 = A.t - B.t, dt2 = B.t - C.t, w = dt / dt1;
    // Lagrange weights of A, B, C at t
    const lA = (t - B.t) * (t - C.t) / ((A.t - B.t) * (A.t - C.t)), lB = (t - A.t) * (t - C.t) / ((B.t - A.t) * (B.t - C.t)), lC = (t - A.t) * (t - B.t) / ((C.t - A.t) * (C.t - B.t));
    const cC = dt ** 3 * (1 + w) ** 2 / (6 * w * (1 + 2 * w)), cP = dt * (dt + dt1) * (dt + dt1 + dt2) / 6, k = cC / (cC + cP);
    let uS = opts.uScale;
    if (uS == null) { uS = Ur; for (let n = 0; n < r.u.length; n++) uS = Math.max(uS, Math.abs(r.u[n]), Math.abs(r.v[n])); }
    let e = 0;
    const field = (f, sc) => { const a = A.r[f], b = B.r[f], c = C.r[f], x = r[f]; for (let n = 0; n < x.length; n++) e = Math.max(e, Math.abs(x[n] - (lA * a[n] + lB * b[n] + lC * c[n])) / sc); };
    field('u', uS); field('v', uS);
    for (const c of free) e = Math.max(e, Math.abs(r.surface.h[c] - (lA * A.r.surface.h[c] + lB * B.r.surface.h[c] + lC * C.r.surface.h[c])) / hS);
    if (r.surface) e = Math.max(e, Math.abs(r.surface.s - (lA * A.r.surface.s + lB * B.r.surface.s + lC * C.r.surface.s)) / hS);
    return k * e;
  };
  // the starting guess for a step: the last two states extrapolated
  const guess = dt => {
    const A = hist[0].r.state;
    if (hist.length < 2) return A;
    const B = hist[1].r.state, w = dt / (hist[0].t - hist[1].t), ex = (a, b) => a + w * (a - b);
    return { sol: A.sol.map((a, i) => ex(a, B.sol[i])), h: A.h.map((a, i) => ex(a, B.h[i])), s: ex(A.s, B.s) };
  };
  // the direction (deg) the surface leaves the contact line / edge at: the first surface edge's end tangent
  const leaveDeg = r => {
    const NR = r.NR, d = [-1.5, 2, -0.5];
    let tx = 0, ty = 0;
    for (let a = 0; a < 3; a++) { const n = (cCL + a) * NR + NR - 1; tx += r.x[n] * d[a]; ty += r.y[n] * d[a]; }
    return Math.atan2(ty, tx) * 180 / Math.PI;
  };
  // a new mesh along the newest state's surface (toMode: switch pinned / climbed); false when none could be laid out
  const remeshNow = (t, why, toMode) => {
    const res = relayout(hist[0].r, call, layout, toMode);
    if (!res || res.error) { out.error = `at t = ${t.toPrecision(6)} s the mesh could not be laid out again (${res ? res.error : 'no layout'}; ${why})`; return false; }
    if (!(res.layout.quality >= (opts.minQuality ?? 0.1))) {
      out.error = `at t = ${t.toPrecision(6)} s no mesh along the surface keeps its shape (quality ${res.layout.quality.toFixed(3)}; ${why}): the surface by the contact line has turned too steep for the spines -- a film running down the exit face -- not followed further`;
      return false;
    }
    call = quiet(res.call); layout = res.layout; mode = res.mode; cCL = res.r.meshInfo.cCL; mInfo = res.r.meshInfo;
    qLay = res.layout.quality; sLay = res.r.surface.s; free = freeOf(res.r);
    hist = [{ t, r: res.r }];
    out.remeshes.push({ t, mode, quality: qLay, why });
    return true;
  };

  let t = t0, dt = opts.fixed ? opts.dt0 : Math.min(opts.dt0 ?? 1e-3 * span, dtMax), iOut = 0, fresh = true;
  while (t < tEnd - 1e-12 * span && out.steps < maxSteps) {
    // land on the next output time and on the end
    const target = iOut < times.length ? times[iOut] : tEnd;
    let h = Math.min(dt, target - t);
    if (target - t - h < 1e-3 * h) h = target - t;
    else if (target - t < 2 * h) h = 0.5 * (target - t);            // two even steps rather than one long and one tiny
    const tn = t + h, two = hist.length > 1;
    let r = null, why = '';
    const o = { ...call, ...(opts.at ? opts.at(tn) : {}) };
    if (o.U) o.flatEnd = false;
    const step = more => FT_.solveFEM({ ...o, maxIter: more ? Math.max(40, maxIter) : maxIter, ...(more ? { homotopy: true } : {}), init: guess(h),
      time: { t: tn, dt: h, dtPrev: two ? hist[0].t - hist[1].t : 0, prev: two ? [hist[0].r, hist[1].r] : [hist[0].r] } });
    try { r = step(false); } catch (e) { r = null; why = e.message; }
    // (a jump in what is imposed -- a step of the web's speed on a yield-stress paste -- is not made smaller by a shorter
    // step: Newton needs more of its own steps from the state before; the same step once more with them and the homotopy)
    if (!r || !r.converged) { try { const r2 = step(true); if (r2 && r2.converged) { r = r2; why = ''; } } catch (e) { why = why || e.message; } }
    if (!r || !r.converged) {
      out.failed++;
      // (the mesh may be what fails: lay it out again once, then shorter steps)
      if (relayout && !fresh && !opts.fixed) { if (!remeshNow(t, 'a step failed on the moving mesh')) break; fresh = true; dt = h / 2; continue; }
      if (opts.fixed || h / 4 < dtMin) { out.error = `the step to t = ${tn.toPrecision(6)} s did not converge${why ? ' (' + why + ')' : ''}`; break; }
      dt = h / 4; continue;
    }
    const lte = opts.fixed ? null : lteOf(r, h);
    if (lte != null && lte > tol && h / 5 >= dtMin) {
      out.rejected++;
      dt = h * Math.max(0.2, 0.9 * Math.pow(tol / lte, 1 / 3));
      continue;
    }
    // accept
    t = tn; out.steps++; fresh = false;
    hist.unshift({ t, r }); if (hist.length > 3) hist.length = 3;
    record(t, r, h, lte ?? 0);
    if (iOut < times.length && Math.abs(t - times[iOut]) <= 1e-9 * span) { out.frames.push({ t, r: keep(r, t, { mode, meshInfo: mInfo }) }); iOut++; }
    if (opts.onStep && opts.onStep({ t, dt: h, err: lte, iterations: r.iterations, steps: out.steps, tEnd, mode }) === false) break;
    if (opts.fixed) dt = opts.dt0;
    else if (lte != null) dt = Math.min(dtMax, h * Math.min(2, Math.max(0.2, 0.9 * Math.pow(tol / Math.max(lte, 1e-300), 1 / 3))));
    else dt = Math.min(dtMax, h);
    // the mesh: Gibbs at the edge, then its shape and the contact line's place
    if (relayout && t < tEnd - 1e-12 * span) {
      const gib = relayout.gibbs, s = r.surface.s;
      let to = null, wh = '';
      if (gib && mode === 'climbed' && s < pinAt) { to = 'pinned'; wh = 'the contact line came down to the edge'; }
      else if (gib && mode === 'pinned') {
        const lv = leaveDeg(r);
        if (lv < gib[0]) { out.error = `at t = ${t.toPrecision(6)} s the meniscus would recede under the blade (dewetting its underside): not modelled`; break; }
        if (lv > gib[1]) { to = 'climbed'; wh = `the surface leaves the edge at ${lv.toFixed(1)}°, flatter than the contact angle allows (${gib[1].toFixed(1)}°)`; }
      }
      const q = FT_.femQuality(call.mesh, r.surface);
      if (!to && q < 0.5 * qLay) wh = `mesh shape quality ${q.toFixed(3)} (laid out at ${qLay.toFixed(3)})`;
      else if (!to && mode === 'climbed' && Math.abs(s - sLay) > 0.25 * Math.max(sLay, 0.1 * H)) wh = `contact line ${(s * 1e3).toFixed(3)} mm up the face (mesh laid out for ${(sLay * 1e3).toFixed(3)} mm)`;
      if (to || wh) {
        if (!remeshNow(t, wh, to)) break;
        fresh = true; dt = Math.max(dtMin, dt / 4);
      }
    }
  }
  out.last = hist[0].r; out.call = call; out.lastInfo = { mode, meshInfo: mInfo };   // (the newest state, its mesh's layout and the contact line's mode)
  out.completed = t >= tEnd - 1e-12 * span;
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { femMarch, femArea, femFlows };
