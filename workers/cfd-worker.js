/*
 * cfd-worker.js — runs one location's CFD solve off the main thread: the
 * 2D flow under the blade, over its exit face and into the free film, with
 * the meniscus and its contact line solved together with the flow
 * (cfd-fem.js), then the 1D thin-film development from the end of that 2D
 * domain to the oven (cfd-solver.js's solveDownstreamFilm).
 *
 * Message in:  { geometry: 'round'|'flat' (or a shaped blade's shape), H, L, R, Xup, exitAngle, contactDeg,
 *                blade (a shaped blade: cfd-blade.js's bladeProfile spec, H from the gap), clModel ('full' | 'simple'),
 *                U, Pup, rho, muRef, ty, n, muRep, gamma, g, ovenDistance,
 *                webSlip (1 / slip length, 1/m: slip over the fibre surface;
 *                0 = no slip) }
 *                time (the flow in time after the steady solve, cfd-fem-time.js): { scen: 'pup' | 'web' | 'rest', to
 *                (the bead pressure, Pa, or the web's speed, m/s, it goes to), ramp (s; 0: a step), end (s), auto (step
 *                control) and tol, or dt (a fixed step, s), frames (how many times kept), slip (the exit face's slip
 *                length, m; 0: no slip) }
 *              lengths in m, angles in degrees, U in m/s, Pup in Pa,
 *              muRef = the slider's viscosity at 2.7 1/s (the rheology
 *              law's own reference), muRep = mu at the representative
 *              shear rate U/H (only for the one-viscosity lubrication
 *              estimate shown alongside).
 * Messages out: { progress: { it, residual, s, path, stage } } while solving (path: how far along its continuation the
 *               solve is, 0..1, or none), then
 *               { ok: true, result } or { ok: false, error }.
 * With preview set (any id): not solved -- { ok: true, preview, result }, the mesh the solve starts on as the
 *   grid, no flow on it (the Mesh step's preview).
 * result.trace: the convergence record over every solve the strategy ran, in order --
 *   r: the residual at each Newton iterate (all solves in sequence),
 *   solves: [{ label, k0 (index of its first iterate in r), n (its iterates), converged, residual }],
 *   used: index in solves of the solve whose solution is the result.
 */
// (cfd-1d.js: bladeShape, the blade height over the web, shared with the 1D stage so both see the same geometry)
importScripts('../engine/rheo.js', '../engine/cfd-solver.js', '../engine/cfd-gap-solver.js', '../engine/cfd-fem.js', '../engine/cfd-fem-time.js', '../engine/cfd-struct.js', '../engine/cfd-blade.js', '../engine/cfd-1d.js', '../engine/orient.js', '../engine/cfd-orient.js', '../engine/drying.js', '../engine/film.js', '../engine/furnace.js');

/** Reynolds lubrication flow rate for the same shape and pressure drop, one viscosity -- the classical estimate shown for comparison. */
function lubricationQ(o, shape) {
  const M = 20000, mu = o.muRep;
  let I2 = 0, I3 = 0;
  for (let k = 0; k < M; k++) { const h = shape.h((k + 0.5) * shape.Lx / M); I2 += shape.Lx / M / (h * h); I3 += shape.Lx / M / (h * h * h); }
  return (o.Pup + 6 * mu * o.U * I2) / (12 * mu * I3);
}

/**
 * A shaped blade's extras for the result: where the contact line is (k: the face corner it is at or above; note), the
 * face from the contact line up (points, m: the plot draws the blade's face from there), the face's corners (m).
 */
function shapedOut(prof, r) {
  if (!prof) return {};
  const s = r.surface ? r.surface.s : 0, F = prof.face, pts = [F.P(s)];
  for (let i = 0; i < F.pieces.length; i++) {
    const a = F.s0[i], b = F.s0[i + 1];
    if (b <= s) continue;
    const m = F.pieces[i].kind === 'arc' ? Math.max(2, Math.ceil(Math.abs(F.pieces[i].da) * 180 / Math.PI / 3)) : 1;
    for (let k = 1; k <= m; k++) { const q = Math.max(s, a) + (b - Math.max(s, a)) * k / m; pts.push(F.P(q)); }
  }
  return { shaped: { k: r.meniscus ? r.meniscus.k : 0, model: r.meniscus ? r.meniscus.model : null, note: r.meniscus ? r.meniscus.note || null : null, faceAbove: pts, corners: prof.faceCorners.map(c => F.P(c.s)), sCL: s } };
}

/** A grid's node arrays as single precision (a time step kept for display: half the memory, far finer than drawn). */
function compactGrid(g) {
  for (const k of ['gx', 'gy', 'u', 'v', 'p', 'psi', 'gd', 'mu', 'tauXY', 'tauXX', 'tauYY', 'omega']) if (g[k] instanceof Float64Array) g[k] = Float32Array.from(g[k]);
  return g;
}
/**
 * The flow in time from the steady result r (o.time; cfd-fem-time.js's femMarch): the bead pressure (scen 'pup') or
 * the web's speed ('web') stepped or ramped from the inputs' value to `to`, or ('rest') the gap filled at rest -- no web
 * speed, the bead pressure the liquid's weight up to the gap -- with the web and the bead pressure ramped up to the
 * inputs'. Returns the record in time (film, contact line, flows in and out, the steps) and the flow at o.time.frames
 * even times (the start first), each as the post-processing grid, or { error }. With the structure (o.struct), lambda
 * goes with the slurry in time (cfd-struct.js's structMarch): each kept time has its lambda and lambda leaving the edge.
 */
function marchInTime(o, fo, r, geo, shapeProf, onStep) {
  const T = o.time, t0 = Date.now(), Hr = geo.H, rhoG = o.rho * o.g;
  let r0 = r;
  if (T.scen === 'rest') {
    r0 = solveCoaterFEM({ ...fo, U: 0, Pup: rhoG * Hr, fInfGuess: Hr, onStage: undefined, onIteration: undefined, onSolveStart: undefined, onSolveEnd: undefined });
    if (!r0 || !r0.x || r0.error || !r0.converged) return { error: `the gap filled at rest did not solve${r0 && r0.error ? `: ${r0.error}` : ''}` };
  }
  const P0 = T.scen === 'rest' ? rhoG * Hr : o.Pup, P1 = T.scen === 'pup' ? T.to : o.Pup;
  const U0 = T.scen === 'rest' ? 0 : o.U, U1 = T.scen === 'web' ? T.to : o.U;
  const ramp = t => (T.ramp > 0 ? Math.min(1, t / T.ramp) : 1);
  const at = t => { const k = ramp(t), P = P0 + (P1 - P0) * k; return { U: U0 + (U1 - U0) * k, inlet: { type: 'traction', p: y => P - rhoG * y } }; };
  const g0 = { xe: geo.xe, H: Hr, faceDeg: o.exitAngle, contactDeg: o.contactDeg, U: U1 };
  const carry = o.struct ? structMarch(o.struct, rheoCompile(o.muRef, o.ty, o.n, o.rheoX)) : null;
  const cornerOf = info => (info && info.meshInfo ? info.meshInfo : r0.meshInfo).cCorner;
  // (a time step's grid: its own mesh's layout and the contact line's mode, the surface's angle where it leaves it)
  const leave = (rr, cCL) => { const NR = rr.NR, d = [-1.5, 2, -0.5]; let tx = 0, ty = 0; for (let a = 0; a < 3; a++) { const n = (cCL + a) * NR + NR - 1; tx += rr.x[n] * d[a]; ty += rr.y[n] * d[a]; } return Math.atan2(ty, tx) * 180 / Math.PI; };
  const frame = (rr, info) => {
    const full = info ? { ...rr, meshInfo: info.meshInfo, meniscus: { ...r0.meniscus, mode: info.mode, s: rr.surface.s, leaveDeg: leave(rr, info.meshInfo.cCL) } } : rr;
    const st = rr.lam && carry ? { struct: { ...(r.struct || {}), S: o.struct, lamEdge: structColumn(rr, rr.lam, cornerOf(info)), lamEnd: structColumn(rr, rr.lam, rr.NC - 1) } } : {};
    return { ...compactGrid(coaterGrid(full, g0)), Hedge: Hr, ...shapedOut(shapeProf, full), ...st };
  };
  const n = Math.max(2, Math.round(T.frames)), times = Array.from({ length: n }, (_, k) => (k + 1) * T.end / n);
  // (the dynamic contact angle, Cox-Voinov: with slip on the face only -- the line moves with the liquid there; the paste's
  //  viscosity at the process shear rate, the web's speed over the gap)
  //  (the length ratio given, or the gap over the slip length: above 1, or the angle would not rise as the line climbs)
  const lR = T.ratio > 1 ? T.ratio : Hr / T.slip;
  if (T.dyn && T.slip > 0 && !(lR > 1)) throw new Error(`the dynamic contact angle needs the length ratio L/λ above 1: the slip length (${(T.slip * 1e6).toPrecision(3)} µm) is not below the gap (${(Hr * 1e6).toPrecision(3)} µm) -- give the ratio, or a smaller slip length`);
  const dyn = T.dyn && T.slip > 0 ? { thetaS: o.contactDeg, lnR: Math.log(lR), gamma: o.gamma,
    mu: fo.mu(Math.max(U1, U0, 1e-6) / Hr) } : null;
  const m = femMarch(r0, { at, tEnd: T.end, dt0: T.auto ? 1e-3 * T.end : T.dt, fixed: !T.auto, tol: T.tol, times, faceSlip: T.slip > 0 ? T.slip : 0, ...(dyn ? { dynamic: dyn } : {}),
    keep: (rr, t, info) => frame(rr, info), onStep, ...(carry ? { carry, track: (rr, info) => structColumn(rr, rr.lam, cornerOf(info)) } : {}) });
  return {
    scen: T.scen, end: T.end, ramp: T.ramp, P0, P1, U0, U1, slip: T.slip || 0, auto: !!T.auto, tol: T.tol, dtSet: T.dt, ms: Date.now() - t0,
    ...(dyn ? { dyn: { thetaS: dyn.thetaS, lnR: dyn.lnR, mu: dyn.mu }, angle: m.angle } : {}),
    t: m.t, dt: m.dt, s: m.s, Qin: m.Qin, Qout: m.Qout, area: m.area, err: m.err, iterations: m.iterations, mode: m.mode,
    hOut: m.top.map(q => q.y[q.y.length - 1]), ...(carry ? { lamEdge: m.track, corrected: m.corrected } : {}),
    remeshes: m.remeshes, steps: m.steps, rejected: m.rejected, failed: m.failed, completed: m.completed, error: m.error || null,
    frames: [{ t: 0, g: frame(r0, null) }, ...m.frames.map(q => ({ t: q.t, g: q.r })),
      // (a march stopped early: its last state too, the flow it stopped at)
      ...(!m.completed && m.last && m.t.length > 1 && m.t[m.t.length - 1] > (m.frames.length ? m.frames[m.frames.length - 1].t : 0) ? [{ t: m.t[m.t.length - 1], g: frame(m.last, m.lastInfo), last: true }] : [])],
  };
}

onmessage = e => {
  try {
    const o = e.data;
    // the alignment alone, on a flow solved before (its grid): { orientOnly: true, grid, orient, tRest }
    if (o.orientOnly) {
      const t0 = Date.now();
      const res = orientAlong(orientFromGrid(o.grid), o.orient.model, { nLines: o.orient.nLines, n: o.orient.n, seed: o.orient.seed, tRest: o.tRest, collapse: o.orient.collapse,
        onLine: (k, N) => postMessage({ progress: { it: 0, residual: NaN, s: k / N, stage: `flake alignment: line ${k} of ${N}` } }) });
      postMessage({ ok: true, orient: { ...orientCompact(res), model: o.orient.model, tRest: o.tRest, ms: Date.now() - t0 } });
      return;
    }
    const shape = bladeShape(o), xe = shape.Lx, H = shape.h(xe);
    const law = gd => muEffLocal(gd, o.muRef, o.ty, o.n, o.rheoX);
    const qLub = lubricationQ(o, shape);
    let lastPost = 0, stage = '', sent = 0;
    const trace = { r: [], solves: [], used: -1 };
    // progress: the stage, the latest residual, and the residuals since the last post with the solves so far (live residual plots)
    const post = h => {
      const t = Date.now();
      if (t - lastPost <= 150) return;
      lastPost = t;
      const add = trace.r.slice(sent); sent = trace.r.length;
      postMessage({ progress: { it: h.it, residual: h.residual, s: h.s, path: h.path ?? h.lambda ?? null, stage, add, solves: trace.solves.map(sv => [sv.label, sv.k0]) } });
    };
    let open = null;
    const onIteration = h => { if (Number.isFinite(h.residual)) trace.r.push(h.residual); post(h); };
    const onSolveStart = label => { if (open) open.n = trace.r.length - open.k0; open = { label, k0: trace.r.length, n: 0, converged: false, residual: NaN }; trace.solves.push(open); return trace.solves.length - 1; };
    const onSolveEnd = e => { if (open) Object.assign(open, { n: trace.r.length - open.k0, converged: e.converged, residual: e.residual }); open = null; };
    // mesh: the settings sent (o.solver), else blade elements about 0.6 H long (12..40); rows graded toward the blade/face/surface
    const sv = o.solver || {};
    const nEb = sv.nEb ?? Math.max(12, Math.min(40, Math.round(xe / (0.6 * H))));
    const fo = {
      hFn: shape.h, xe, faceDeg: o.exitAngle, contactDeg: o.contactDeg,
      U: o.U, Pup: o.Pup, rho: o.rho, g: o.g, gamma: o.gamma, mu: law, gdMin: sv.gdMin > 0 ? sv.gdMin : 1e-3 * o.U / H, webSlip: o.webSlip || 0,
      Ld: Math.max(12e-3, (sv.ldGaps ?? 8) * H), nEb, nEf: sv.nEf ?? 6, nEs: sv.nEs ?? 24, nEy: sv.nEy ?? 6, fInfGuess: qLub / o.U,
      gradeB: sv.gradeB, gradeS: sv.gradeS, gradeY: sv.gradeY, tol: sv.tol, maxIter: sv.maxIter,
      meshZones: sv.zones || null, meshFrac: sv.frac || null,     // (refinement zones; an adapted mesh)
      profile: shape.profile || null, clModel: o.clModel || 'full',  // (a shaped blade, and its contact-line model)
    };
    if (o.preview) {
      // the mesh the solve starts on (not solved): as the post-processing grid, with no flow on it
      const pv = solveCoaterFEM({ ...fo, preview: true });
      if (pv.error) throw new Error(pv.error);
      const N = pv.NC * pv.NR, z = () => new Float64Array(N);
      const g = coaterGrid({ ...pv, u: z(), v: z(), p: z(), psi: z(), gd: z(), mu: z(), tauXY: z(), tauXX: z(), tauYY: z(), omega: z(), Q: 0, converged: false, residual: NaN, iterations: 0 },
        { xe, H, faceDeg: o.exitAngle, contactDeg: o.contactDeg, U: o.U });
      postMessage({ ok: true, preview: o.preview, result: { ...g, Hedge: H, nEb, preview: true, ...shapedOut(shape.profile, pv) } });
      return;
    }
    // (the structure: the flow with it fed back, outer iterations -- cfd-struct.js; else the steady law as it is)
    let outer = 0;
    const onStage = t => { stage = outer > 1 ? `structure, flow ${outer}: ${t}` : t; lastPost = 0; post({ it: 0, residual: NaN, s: 1 }); };
    const r = o.struct
      ? solveCoaterStruct({ ...fo, onStage, onIteration, onSolveStart, onSolveEnd }, o.struct, rheoCompile(o.muRef, o.ty, o.n, o.rheoX), { onOuter: k => { outer = k; } })
      : solveCoaterFEM({ ...fo, onStage, onIteration, onSolveStart, onSolveEnd });
    // (a solve that ended without returning: its iterates so far)
    if (open) open.n = trace.r.length - open.k0;
    trace.used = r.solveId ?? -1;
    if (!r.x || r.error) throw new Error(r.error || 'no solution');   // (a solve that stopped part way returns its last state with the reason)
    const g = coaterGrid(r, { xe, H, faceDeg: o.exitAngle, contactDeg: o.contactDeg, U: o.U });

    // Flat land: away from its ends the flow is fully developed, so the exact
    // 1D profile for the pressure gradient the 2D solution has at mid-land
    // must match it there -- shown as the reference. (Not the bead pressure
    // over the land length: the meniscus sets the pressure at the edge.)
    // (a shaped blade: at the middle of the level land its underside ends with -- a bevel's, an edge radius's, a
    // two-step's metering land -- if it has one)
    let prof1D = null;
    const lastU = shape.profile && shape.profile.under.pieces[shape.profile.under.pieces.length - 1];
    const land = !shape.profile ? (o.geometry !== 'round' ? [0, xe] : null) : lastU.kind === 'line' && lastU.y1 === lastU.y0 && lastU.x1 > lastU.x0 ? [lastU.x0, lastU.x1] : null;
    if (land) {
      let i = 1;
      while (i < g.iCorner - 1 && g.xWeb[i] < 0.5 * (land[0] + land[1])) i++;
      const G = -(g.pWeb[i + 1] - g.pWeb[i - 1]) / (g.xWeb[i + 1] - g.xWeb[i - 1]);
      // (with slip over the fibre, the wall moves at the solution's own web-surface velocity there)
      const p1 = solveFullyDeveloped1D({ Ly: shape.profile ? shape.h(g.xWeb[i]) : o.H, U: g.uWeb[i], G, muRef: o.muRef, ty: o.ty, n: o.n, x: o.rheoX, ny: 401 });
      prof1D = { y: p1.y, u: Array.from(p1.u), gd: Array.from(p1.gd), x: g.xWeb[i], G, uWall: g.uWeb[i] };
    }

    // Beyond the 2D domain: the 1D thin-film development (a reuse of the
    // Slurry animation tab's free-surface method) from the 2D film's end to
    // the oven, driven by this solve's own flow rate. Representative
    // viscosity at the film's own shear scale U/h_inf, h_inf = Q/U.
    const filmStart = g.xEnd - xe;                     // distance from the edge where the 1D film takes over
    const muDownstream = muEffLocal(o.U * o.U / g.Q, o.muRef, o.ty, o.n, o.rheoX);
    const film = o.ovenDistance > filmStart ? solveDownstreamFilm({
      H0: g.hEnd, Q: g.Q, U: o.U, mu: muDownstream,
      gamma: o.gamma, rho: o.rho, g: o.g, Lx: o.ovenDistance - filmStart,
      nx: 200, maxSteps: 150000, tol: 1e-8,
    }) : { error: 'the oven is inside the 2D domain' };

    // The flakes' alignment (o.orient: { model: orient.js's model, nLines, n, seed, collapse }; cfd-orient.js): along the
    // flow to the film, then at rest on the web from the domain's end to the oven (at the web's speed); and dried, the
    // film collapsed to collapse (φ0 / φ_m) of its thickness
    let orient = null;
    if (o.orient) {
      const tRest = Math.max(0, (o.ovenDistance - filmStart) / o.U), t0 = Date.now();
      stage = 'flake alignment'; lastPost = 0; post({ it: 0, residual: NaN, s: 1 });
      const res = orientAlong(r, o.orient.model, { nLines: o.orient.nLines, n: o.orient.n, seed: o.orient.seed, tRest, collapse: o.orient.collapse,
        onLine: (k, N) => { stage = `flake alignment: line ${k} of ${N}`; lastPost = 0; post({ it: 0, residual: NaN, s: k / N }); } });
      orient = { ...orientCompact(res), model: o.orient.model, tRest, ms: Date.now() - t0 };
    }

    // The drying of this film in the oven (o.dry: drying.js's inputs without the film; the DOE), both ways the water
    // may leave: its summary
    let drying = null;
    if (o.dry) {
      stage = 'drying in the oven'; lastPost = 0; post({ it: 0, residual: NaN, s: 1 });
      const sum = rr => ({ waterPct: rr.exit.waterPct, dry: rr.exit.dry, dryAt: rr.exit.dry ? rr.events.dry : null, skinAt: rr.events.skinTop, hExit: rr.exit.h, Tmax: Math.max(...rr.series.map(q => Math.max(q.Ts, q.Tb))), boil: rr.events.boil });
      try { drying = { h0: g.Q / o.U, top: sum(drStrip({ ...o.dry, h0: g.Q / o.U, where: 'top' })), both: sum(drStrip({ ...o.dry, h0: g.Q / o.U, where: 'both' })) }; }
      catch (e) { drying = { error: e.message }; }
    }
    // The film followed on to the peel (o.film: the room stretch after the oven and film.js's properties; the DOE, GO-4),
    // both ways: its summary
    let peeled = null, furn = null;
    if (o.dry && o.film) {
      stage = 'the film to the peel'; lastPost = 0; post({ it: 0, residual: NaN, s: 1 });
      const sum = r => ({ crack: r.worst ? r.worst.ratio : 0, spacing: r.spacing ? (r.spacing.lo + r.spacing.hi) / 2 : null, peelHand: r.peel.hand.f,
        peel90: (r.peel.byAngle.find(q => q.deg === 90) || {}).f, tears: r.peel.byAngle.some(q => q.tears), curl: r.curl.settled.kappa, roll: r.roll.sMax,
        blister: r.blisters.max.ratio, wet: r.wetAtPeel, size: r.plate ? ((1 + r.plate.eFlatDry) / (1 + r.plate.eFlatCut) - 1) * 100 : NaN });
      const full = {}, one = where => sum(full[where] = fmRun(drStrip({ ...o.dry, after: o.film.after, h0: g.Q / o.U, where, history: true }), o.film.fo));
      try { peeled = { top: one('top'), both: one('both') }; }
      catch (e) { peeled = { error: e.message }; }
      // The furnace (o.furn: furnace.js's options but the piece's; GO-5): this film's piece, its water leaving from the top
      // only, through both runs -- the graphene film's thickness and the gas against its hold in each run
      const P = full.top && full.top.plate;
      if (o.furn && P && P.h > 0) {
        stage = 'the furnace'; lastPost = 0; post({ it: 0, residual: NaN, s: 1 });
        try {
          const fr = fuRunLoad({ ...o.furn, h0: P.h, rhoG: P.rhoG, Xin: P.Xroom });
          // (the batch's thickness and spread, each check at the stack's worst piece: GO-7)
          furn = fuOutputs(fr, P.h);
        } catch (e) { furn = { error: e.message }; }
      }
    }

    // The flow in time from this steady state (o.time): the march, its record and its time steps
    let transient = null;
    if (o.time) {
      stage = 'in time'; lastPost = 0; post({ it: 0, residual: NaN, s: 1 });
      let lastT = 0;
      try {
        transient = marchInTime(o, fo, r, { xe, H }, shape.profile, s => {
          const t = Date.now();
          if (t - lastT < 200 && s.t < s.tEnd) return;
          lastT = t;
          postMessage({ progress: { it: s.steps, residual: NaN, s: s.t / s.tEnd, stage: `in time: t = ${s.t.toPrecision(3)} s of ${s.tEnd} s`, time: { t: s.t, tEnd: s.tEnd } } });
        });
      } catch (err) { transient = { error: err.message }; }
    }

    postMessage({ ok: true, result: { ...g, prof1D, film, filmStart, muDownstream, qLub, Hedge: H, nEb, trace, ...(transient ? { transient } : {}), ...(r.struct ? { struct: { ...r.struct, S: o.struct, lamEdge: structColumn(r, r.lam, r.meshInfo.cCorner), lamEnd: structColumn(r, r.lam, r.NC - 1) } } : {}), ...(orient ? { orient } : {}), ...(drying ? { drying } : {}), ...(peeled ? { peeled } : {}), ...(furn ? { furn } : {}), ...shapedOut(shape.profile, r) } });
  } catch (err) {
    postMessage({ ok: false, error: err.message });
  }
};
