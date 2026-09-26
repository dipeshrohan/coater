/*
 * cfd-progress.js — how far a running solve has got: an estimate, shown with "≈", for the progress bars on Flow › 2D
 * (one per location), Flow › 3D (the whole solve, and the step being solved) and the status bar.
 *
 * It counts the steps that are known and, within a Newton solve, how far that solve has got:
 *  - a Newton solve: how far along its continuation it is (Newtonian to the chosen rheology, or the homotopy from its
 *    starting shape) or how far its residual has fallen from its first value toward the tolerance, on a log scale,
 *    whichever is further;
 *  - the 2D: the meniscus at the edge first (two solves: the flow with the surface frozen, then coupled); if the
 *    surface climbs the exit face, the solves that place the contact line there -- how many is not known ahead, so
 *    each takes a share of what is left (the film to the oven after it takes a fraction of a second);
 *  - the 3D on a strip: the 2D at each station, then the 3D Newton solve, weighted by their estimated times;
 *  - the full width: the 2D at its stations, then sweeps of strips until the strips agree -- how many sweeps from
 *    how fast the change between sweeps has fallen so far.
 * A share never goes back, and reads 100 % only when the solve has finished.
 */
const PROG = {
  pin: 0.35,      // the 2D: the meniscus at the edge, of the whole when the surface goes on to climb the face
  climb: 0.3,     // each solve placing the contact line on the face: this share of what is left
  sweeps: 6,      // the full width: sweeps expected before two have shown how fast they converge
};

/** A Newton solve's share done (0..1): its residual r fallen from its first, r0, toward tol on a log scale, or its continuation's path (0..1), whichever is further. */
function progNewton(r0, r, tol, path) {
  let f = 0;
  if (r0 > 0 && r > 0 && tol > 0) f = r <= tol || r0 <= tol ? 1 : Math.log(r0 / r) / Math.log(r0 / tol);
  if (path > f) f = path;
  return Math.min(1, Math.max(0, f));
}

/**
 * A 2D run (cfd-worker.js), fed each progress message with the run's history so far (live: r, the residual at
 * every Newton iterate; solves, [label, k0] each solve started): { share (0..1), solve (the current solve's
 * number, from 0), it (its Newton steps so far), f (its share) }. tol: the Newton tolerance.
 */
function prog2D(tol) { return { tol, share: 0, solve: -1, k: 0, f: 0, it: 0 }; }
function prog2DFeed(P, pr, live) {
  const sv = (live && live.solves) || [], n = sv.length, r = (live && live.r) || [];
  if (n) {
    const j = n - 1, k0 = sv[j][1];
    if (P.solve !== j) { P.solve = j; P.f = 0; P.k = k0; }
    for (let k = Math.max(P.k, k0); k < r.length; k++) P.f = Math.max(P.f, progNewton(r[k0], r[k], P.tol));
    P.k = r.length; P.it = r.length - k0;
    if (pr && pr.path != null) P.f = Math.max(P.f, progNewton(0, 0, P.tol, pr.path));
  }
  // (the meniscus at the edge: its solves' labels say so; any later solve places the contact line on the face)
  const pin = sv.filter(s => /^contact line at the edge/.test(s[0])).length, climbs = n > pin;
  const s = !climbs ? PROG.pin * Math.min(1, (Math.max(0, n - 1) + (n ? P.f : 0)) / 2)
    : PROG.pin + (1 - PROG.pin) * (1 - Math.pow(1 - PROG.climb, n - 1 - pin) * (1 - PROG.climb * P.f));
  P.share = Math.max(P.share, Math.min(1, s));
  return P;
}

/**
 * A station's 2D inside a 3D solve (cfd-3d-worker.js sends its solves' residuals as cfd-worker.js does): prog2D's, with
 * the history it builds from the messages (live) and the latest message (pr).
 */
function progStation(tol, name) { return { name, P: prog2D(tol), live: { r: [], solves: [] }, pr: null }; }
function progStationFeed(S, pr) {
  if (pr.add) for (const v of pr.add) S.live.r.push(v);
  if (pr.solves) S.live.solves = pr.solves;
  S.pr = pr;
  prog2DFeed(S.P, pr, S.live);
  return S;
}
/** A 3D Newton solve seen through its progress messages: { f (share), it (its Newton steps), res (the latest residual) }. */
function progSolve(tol, name) { return { name, tol, r0: NaN, f: 0, it: 0, res: NaN }; }
function progSolveFeed(S, pr) {
  if (pr.r0 > 0) S.r0 = pr.r0;
  if (Number.isFinite(pr.residual)) { if (!(S.r0 > 0)) S.r0 = pr.residual; S.res = pr.residual; S.it = pr.it + 1; }
  S.f = Math.max(S.f, progNewton(S.r0, S.res, S.tol, pr.path));
  return S;
}

/**
 * The 3D on a strip (one worker): the 2D at its NL stations, then its 3D Newton solve; w2, w3 their estimated times.
 * Fed each progress message: { share, station (the one being solved, progStation), n2 (stations started), solve3 (progSolve, once the 3D runs) }.
 */
function prog3DStrip(NL, w2, w3, tol) { return { NL, w2, w3, tol, share: 0, n2: 0, at: '', station: null, solve3: null }; }
function prog3DStripFeed(P, pr) {
  const st = pr.stage || '';
  if (/^2D at /.test(st) && st !== P.at) { P.at = st; P.n2++; P.station = progStation(P.tol, P.n2); }
  if (/^3D/.test(st) && !P.solve3) { P.solve3 = progSolve(P.tol, '3D'); P.station = null; }
  if (P.solve3) progSolveFeed(P.solve3, pr);
  else if (P.station) progStationFeed(P.station, pr);
  const s2 = P.solve3 ? 1 : Math.min(1, (Math.max(0, P.n2 - 1) + (P.station ? P.station.P.share : 0)) / P.NL);
  P.share = Math.max(P.share, Math.min(1, (P.w2 * s2 + P.w3 * (P.solve3 ? P.solve3.f : 0)) / (P.w2 + P.w3)));
  return P;
}

/**
 * The 3D at a web edge (one worker): the 2D at its NL stations, then its 3D solves, one for each step of the bead pressure from
 * none up to Pset (while the edge holds it): the first solve's share, then the pressure held so far against the set one.
 * Fed its progress messages (prog3DEdgeFeed) and each step's outcome (prog3DEdgeStep: { P, ok }).
 */
function prog3DEdge(NL, w2, w3, tol, Pset) { return { NL, w2, w3, tol, Pset, share: 0, n2: 0, at: '', station: null, solve3: null, pAt: 0, pOk: null, steps: 0 }; }
function prog3DEdgeFeed(P, pr) {
  const st = pr.stage || '', m = /^3D at the edge, bead pressure ([\d.]+) Pa/.exec(st);
  if (/^2D at /.test(st) && st !== P.at) { P.at = st; P.n2++; P.station = progStation(P.tol, P.n2); }
  if (m && st !== P.at) { P.at = st; P.pAt = +m[1]; P.solve3 = progSolve(P.tol, '3D'); P.station = null; }
  // (each step its own Newton solve: its first residual its own, not the worker's first)
  if (P.solve3) { const q = { ...pr }; delete q.r0; progSolveFeed(P.solve3, q); }
  else if (P.station) progStationFeed(P.station, pr);
  const s2 = P.solve3 || P.pOk != null ? 1 : Math.min(1, (Math.max(0, P.n2 - 1) + (P.station ? P.station.P.share : 0)) / P.NL);
  const s3 = P.pOk == null ? (P.solve3 ? 0.5 * P.solve3.f : 0) : 0.5 + 0.5 * (P.Pset > 0 ? Math.min(1, P.pOk / P.Pset) : 1);
  P.share = Math.max(P.share, Math.min(1, (P.w2 * s2 + P.w3 * s3) / (P.w2 + P.w3)));
  return P;
}
function prog3DEdgeStep(P, s) { P.steps++; if (s.ok) P.pOk = Math.max(P.pOk ?? 0, s.P); return prog3DEdgeFeed(P, {}); }

/** The full width's sweeps in all, expected: after two measured changes from how fast they fall (to tolSweep); before, PROG.sweeps. */
function progSweeps(hist, done, tolSweep, maxSweeps) {
  const h = hist.filter(Number.isFinite);
  let E = PROG.sweeps;
  if (h.length >= 2) {
    const a = h[h.length - 2], b = h[h.length - 1], rho = b / a;
    E = rho > 0 && rho < 1 ? done + Math.max(1, Math.ceil(Math.log(tolSweep / b) / Math.log(rho))) : maxSweeps;
  }
  return Math.min(maxSweeps, Math.max(done + 1, E));
}
/**
 * The full width (several workers): the 2D at the stations (n2 station solves in all, several at once: stations, by
 * worker), then sweeps of nStrips strips (several at once: strips, by strip index) until the change between sweeps (hist)
 * falls below tolSweep. t2, ts1, ts: the estimated times of the stations' 2D, the first sweep and a later one.
 */
function prog3DWide(o) { return { ...o, share: 0, done2: 0, stations: new Map(), sweep: 0, doneS: 0, strips: new Map(), hist: [], E: PROG.sweeps }; }
function prog3DWideShare(P) {
  let f2 = P.done2; for (const S of P.stations.values()) f2 += S.P.share;
  f2 = P.n2 ? Math.min(1, f2 / P.n2) : 1;
  const sweeping = P.sweep > 0 || P.doneS > 0 || P.strips.size > 0;
  let fs = P.doneS; for (const S of P.strips.values()) fs += S.f;
  fs = Math.min(1, fs / P.nStrips);
  P.E = progSweeps(P.hist, P.sweep, P.tolSweep, P.maxSweeps);
  const t = P.t2 * (sweeping ? 1 : f2) + (!sweeping ? 0 : P.sweep === 0 ? P.ts1 * fs : P.ts1 + (P.sweep - 1 + fs) * P.ts);
  P.share = Math.max(P.share, Math.min(0.999, t / (P.t2 + P.ts1 + (P.E - 1) * P.ts)));
  return P;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PROG, progNewton, prog2D, prog2DFeed, progStation, progStationFeed, progSolve, progSolveFeed, prog3DStrip, prog3DStripFeed, prog3DEdge, prog3DEdgeFeed, prog3DEdgeStep, progSweeps, prog3DWide, prog3DWideShare };
