/*
 * feed-pool.js — the paste in the pool behind the blade, in 3D, fed by the outlets' falling streams in pulses (Coating ›
 * Pool and feed). The pool's flow is slow (viscous: it settles in a fraction of a second, against a cycle of tens of
 * seconds), so each part of the cycle is a steady Stokes flow on the pool as it is (quasi-steady):
 *   during a pulse: the streams land on the top (each a smooth disc of the stream's flow), the top rising at ḣ = (Qin − Qout)/A;
 *   between pulses: nothing lands; the top falling at ḣ = −Qout / A.
 * The pool (feed-pool-mesh.js): the web moving under it; the blade's face and the side plates walls; the back edge without
 * shear (the paste behind it held, a scraping corner where the web runs under it); the pool edge (the 2D's inlet, 40 mm
 * before the metering edge) at the 2D's own condition there, the pool's weight: p = ρ g (h − y). The top: no shear, the
 * velocity through it given (feed-fem.js's surface slip with un): ḣ minus the streams. The paste out through the pool edge
 * is then the flow the 1D gives the web (Qout), by the paste's balance.
 * The top is free: a lid holding the paste needs a normal stress σnn; a free top carries only its tension and, where a
 * stream lands, the stream's push (its momentum, ρ w vLand per area); the top moves by the normal-stress update
 * (feed-free.js's fsPileUpdate, with its weight and tension) and the flow is solved again, until it stops moving: a heap
 * where each stream lands. Its mean stays at the level (the cycle's); where it meets the blade it stays at the level.
 * Paths: from each outlet's landing, traced through the cycle (the pulse's flow while a pulse lasts, the drain's between),
 * to the pool edge, where the 2D takes them under the blade. Pure computation, SI units, no DOM.
 */
const FPL_ = (n, f) => (typeof globalThis[n] === 'function' ? globalThis[n] : require(f)[n]);
const FPL_FACES = () => (typeof FPM_FACES !== 'undefined' ? FPM_FACES : require('./feed-pool-mesh.js').FPM_FACES);

/** The streams' discs on the top: each the stream's flow (m³/s), a bump (1 − d²/r²)² over radius r, scaled so the flow
 *  through the mesh's top (a: its free nodes' shares of the area, [node, m²]) is exactly the stream's; line: each a band
 *  across the whole width instead (d along the web only: the 2D, a curtain). Returns (x, y, z) -> the velocity down. */
function fplStreams(a, M, outlets, r, qEach, line) {
  const bump = (q, x, z) => { const d2 = ((x - q.x) ** 2 + (line ? 0 : (z - q.z) ** 2)) / (r * r); return d2 < 1 ? (1 - d2) ** 2 : 0; };
  const scale = outlets.map(q => { let s = 0; for (const [n, an] of a) s += bump(q, M.X[n], M.Z[n]) * an; return s > 0 ? qEach / s : 0; });
  return (x, y, z) => outlets.reduce((s, q, i) => s + scale[i] * bump(q, x, z), 0);
}

/** The plan's weights (∫ N dx dz of each plan node, m²; the plan a tensor grid of Q2 elements): index k·NX + i. */
function fplPlanWeights(info) {
  const w1 = a => { const w = new Float64Array(2 * (a.length - 1) + 1); for (let e = 0; e + 1 < a.length; e++) { const d = a[e + 1] - a[e]; w[2 * e] += d / 6; w[2 * e + 1] += 4 * d / 6; w[2 * e + 2] += d / 6; } return w; };
  const wx = w1(info.xs), wz = w1(info.zs), out = new Float64Array(info.NX * info.NZ);
  for (let k = 0; k < info.NZ; k++) for (let i = 0; i < info.NX; i++) out[k * info.NX + i] = wx[i] * wz[k];
  return out;
}

/** The top's height (m) at (x, z) on a mesh: bilinear between its top nodes (null outside the plan). */
function fplTopAt(M, x, z) {
  const { NX, NY, NZ } = M.info, top = (i, k) => (k * NY + NY - 1) * NX + i, XN = i => M.X[top(i, 0)], ZN = k => M.Z[top(0, k)];
  if (x < XN(0) || x > XN(NX - 1) || z < ZN(0) || z > ZN(NZ - 1)) return null;
  let i = 0; while (i < NX - 2 && XN(i + 1) < x) i++;
  let k = 0; while (k < NZ - 2 && ZN(k + 1) < z) k++;
  const s = (x - XN(i)) / (XN(i + 1) - XN(i)), t = (z - ZN(k)) / (ZN(k + 1) - ZN(k)), y = (a, b) => M.Y[top(a, b)];
  return (1 - s) * (1 - t) * y(i, k) + s * (1 - t) * y(i + 1, k) + (1 - s) * t * y(i, k + 1) + s * t * y(i + 1, k + 1);
}

/**
 * The pool's flow in one part of the cycle. o: { W, xBack, xEnd, h, blade (x -> m), U, mu (γ̇ -> Pa·s), gdMin, rho, g,
 *   outlets: [{ x, z }] (m), r (m, the landing's radius), Qin (m³/s, all outlets, during a pulse), Qout (m³/s, the web's),
 *   pulse (true: during a pulse), pipes (a slice only: [{ x, d, Do, tip, bore }] (m): the pipes standing in the paste, the
 *   paste entering through their bores instead of the top -- feed-pool-mesh.js), sides ('wall', the side plates, default; 'slip': mirrors, a strip of a wider pool; or
 *   [at z = 0, at z = W]: half a pool mirrored at its middle), line
 *   (the streams a band across the width: a slice of the pool, the 2D),
 *   mesh (fpmMesh's options, optional), solve (ffSolve's options; x0 a start), eta (the top over the level at the plan's
 *   nodes, m: its shape; default flat), free (optional, the top free: { sigma (N/m, its tension), vLand (m/s, the streams'
 *   speed landing: their push), move (m, the most the top may move in a step, default the finest element), stepTol (each step's
 *   solve, relative, default 1e-6: the steps settle the top; the last solve, on it, to the solve's own tolerance),
 *   dtMax (s, the longest step, default 0.15: the tension is explicit), ramp (s, default 1: the streams brought on over
 *   it, their flow, their push and the level's rate with them, so a heap spreads as it grows instead of standing up as a
 *   tower on the landing; the top settled after), steps (most, default 80), tol (m/s: the top's
 *   largest speed against its steady place to stop at; default 1 % of ḣ) }), onTop (called after each step) }.
 * The top free: time steps (backward in its weight), each a solve with the top a free surface (its tension, the streams'
 * push, and its weight over the step held implicitly: feed-fem.js's ffRobinFace, kn = ρ g Δt) and the top then moved by
 * its kinematics, its rise (u·n − vn)/n_y over the step, vn = (ḣ − s) n_y the speed through it at which it stands still
 * (the level rising at ḣ, the streams adding s); where it meets the blade it stays at the level, at the side plates it
 * meets them square. The steps grow as the top settles (each moving it at most `move`; one that moves it twice that is
 * done again, shorter): a heap builds fast where a stream lands, then settles. Once it stands still, the flow is solved
 * once more on it with its kinematics exact (a lid: the speed through it vn), so the paste's balance is exact.
 * Returns { M, S, x, u, v, w, p, hdot, area (the top's plan, m²), free (its part off the walls, by n_y × area, m²), flows: {
 *   top, end, back, web, blade, side0, side1 } (m³/s, out), hist, converged, eta (m, at the plan's nodes), tops (per step:
 *   { speed (m/s, the top's largest against its steady place), high, low (m, the top over the level), dt, t (s), streams
 *   (the share of the streams on) }), stream }.
 */
function fplSolve(o) {
  const fpmMesh = FPL_('fpmMesh', './feed-pool-mesh.js'), ffSetup = FPL_('ffSetup', './feed-fem.js'), ffSolve = FPL_('ffSolve', './feed-fem.js'), ffFlow = FPL_('ffFlow', './feed-fem.js');
  const ffFaceNormals = FPL_('ffFaceNormals', './feed-fem.js'), fsArea = FPL_('fsArea', './feed-free.js');
  const FMF = FPL_FACES(), F = o.free, tops = [], rg = o.rho * o.g;
  // (each side: 'wall' a side plate, 'slip' a mirror; one for both, or [at z = 0, at z = W])
  const sideT = Array.isArray(o.sides) ? o.sides : [o.sides || 'wall', o.sides || 'wall'], slip0 = sideT[0] === 'slip', slip1 = sideT[1] === 'slip';
  let eta = o.eta ? Float64Array.from(o.eta) : null, x0 = o.solve && o.solve.x0;
  // the pool on a top: its mesh, the top's free nodes (their area shares, their normals), the streams, the level's rate
  const pool = (eta, f = 1) => {
    const M = fpmMesh({ W: o.W, xBack: o.xBack, xEnd: o.xEnd, h: o.h, blade: o.blade, outlets: o.outlets, r: o.r, ...(o.mesh || {}), ...(o.pipes ? { pipes: o.pipes } : {}), eta });
    const I = M.info, NX = I.NX, NY = I.NY, iJ = 2 * I.xs.findIndex(v => Math.abs(v - I.xJ) < 1e-12);
    // (the top's nodes on the walls -- the side plates, where it meets the blade -- hold the walls' no-slip; the top moves
    //  where it is free)
    const onWall = new Set();
    for (const f of M.faces) if ((!slip0 && f.tag === 'side0') || (!slip1 && f.tag === 'side1') || f.tag === 'blade' || f.tag === 'pipe') for (const i of FMF[f.f]) onWall.add(M.elems[27 * f.e + i]);
    const nrm = new Map(); for (const f of M.faces) if (f.tag === 'pile') ffFaceNormals(M, M.X, M.Y, M.Z, f, (n, v) => { const a = nrm.get(n) || [0, 0, 0]; for (let c = 0; c < 3; c++) a[c] += v[c]; nrm.set(n, a); });
    for (const [n, a] of nrm) { const l = Math.hypot(...a); nrm.set(n, a.map(v => v / l)); }
    // (each free node's share of the top's plan: its area share times n_y)
    const top = [...fsArea({ M, X: M.X, Y: M.Y, Z: M.Z }, ['pile'])].filter(([n]) => !onWall.has(n)).map(([n, a]) => [n, a * nrm.get(n)[1]]);
    const free = top.reduce((s, [, a]) => s + a, 0), hdot = ((o.pulse ? f * o.Qin : 0) - o.Qout) / free;
    // (the paste entering through the top where the streams land -- or, from pipes in the paste, through their bores)
    const stream = o.pulse && !o.pipes ? fplStreams(top, M, o.outlets, o.r, f * o.Qin / o.outlets.length, o.line) : () => 0;
    // a top node from its place (for the lid's speed through it: its own n_y)
    const ix = new Map(), kz = new Map(); for (let i = 0; i < NX; i++) ix.set(M.X[i], i); for (let k = 0; k < I.NZ; k++) kz.set(M.Z[k * NY * NX], k);
    const nodeAt = (x, z) => (kz.get(z) * NY + NY - 1) * NX + ix.get(x);
    return { M, I, NX, NY, iJ, onWall, nrm, top, free, hdot, stream, nodeAt };
  };
  const bcs = (P, topBC) => {
    const wall = { type: 'velocity', u: [0, 0, 0] };
    return { web: { type: 'velocity', u: [o.U, 0, 0] }, blade: wall,
      side0: slip0 ? { type: 'slip', normal: 'z' } : wall, side1: slip1 ? { type: 'slip', normal: 'z' } : wall,
      back: { type: 'slip', normal: 'x', over: true },
      end: { type: 'traction', t: (x, y) => [-rg * (o.h - y), 0, 0] }, pile: topBC,
      // (pipes in the paste: their walls hold it; through each bore during a pulse its share of the paste, plug at the
      //  channel's top -- it shapes itself down the channel -- and between pulses the paste in it at rest)
      ...(o.pipes ? { pipe: wall, bore: { type: 'velocity', u: [0, o.pulse ? -o.Qin / o.pipes.length / (o.pipes[0].d * o.W) : 0, 0] } } : {}) };
  };
  const setup = (P, topBC) => ffSetup({ mesh: P.M, mu: o.mu, gdMin: o.gdMin, rho: o.rho, g: o.g, Lr: 1e-3, Ur: o.U || 1e-3, bc: bcs(P, topBC) });
  let P = pool(eta), last = null;
  if (F) {
    // the free top, by steps in time
    const vL = F.vLand || 0, dmax = F.move ?? (o.mesh && o.mesh.hFine || 2e-3), dtMax = F.dtMax ?? 0.15, ramp = o.pulse ? (F.ramp ?? 1) : 0;
    const frac = t => (ramp > 0 ? Math.min(1, t / ramp) : 1);
    let t = 0, dt = Math.min(dtMax, ramp > 0 ? ramp / 10 : dtMax);
    P = pool(eta, frac(dt));
    for (let it = 0, tries = 0; it < (F.steps ?? 80) && tries < 4 * (F.steps ?? 80); tries++) {
      const S = setup(P, { type: 'free', sigma: F.sigma || 0, kn: rg * dt, vn: (x, y, z, n) => (P.hdot - P.stream(x, y, z)) * n[1],
        t: vL && o.pulse ? (x, y, z, n) => { const q = o.rho * P.stream(x, y, z) * vL; return [-q * n[0], -q * n[1], -q * n[2]]; } : undefined });
      const R = ffSolve(S, { tol: 1e-8, ...(o.solve || {}), tol: F.stepTol ?? 1e-6, x0 });
      // the top's rise over the step at each free node of the plan
      const { I, NX, NY, iJ } = P, next = Float64Array.from(eta || new Float64Array(NX * I.NZ));
      let sp = 0;
      for (let k = 0; k < I.NZ; k++) for (let i = 0; i < iJ; i++) {
        const n = (k * NY + NY - 1) * NX + i; if (P.onWall.has(n)) continue;
        const nv = P.nrm.get(n), V = (R.u[n] * nv[0] + R.v[n] * nv[1] + R.w[n] * nv[2]) / Math.max(nv[1], 0.2) - (P.hdot - P.stream(P.M.X[n], P.M.Y[n], P.M.Z[n]));
        next[k * NX + i] += dt * V; sp = Math.max(sp, Math.abs(V));
      }
      // (moved too far: the step again, shorter)
      if (sp * dt > 2 * dmax) { dt = Math.max(dt / 4, 1e-6); P = pool(eta, frac(t + dt)); continue; }
      x0 = R.x; last = R; it++; t += dt;
      // (at the side plates: the top meets them square, η′ = 0 there: from the first element's nodes)
      for (let i = 0; i < iJ; i++) { const K = I.NZ - 1; if (!slip0) next[i] = (4 * next[NX + i] - next[2 * NX + i]) / 3; if (!slip1) next[K * NX + i] = (4 * next[(K - 1) * NX + i] - next[(K - 2) * NX + i]) / 3; }
      eta = next;
      let hi = -Infinity, lo = Infinity; for (let k = 0; k < I.NZ; k++) for (let i = 0; i <= iJ; i++) { hi = Math.max(hi, eta[k * NX + i]); lo = Math.min(lo, eta[k * NX + i]); }
      tops.push({ speed: sp, high: hi, low: lo, dt, t, streams: frac(t), newton: R.hist.length, lin: R.hist.reduce((a, k) => a + k.lin, 0) });
      if (o.onTop) o.onTop(tops[tops.length - 1], eta, P);
      if (t >= ramp && sp < (F.tol ?? 0.01 * Math.max(Math.abs(P.hdot), 1e-9))) { P = pool(eta, 1); break; }
      // (the next step: as long as moves the top `move` at its speed now, at most twice this one, never above dtMax, and
      //  ending on the ramp's end)
      dt = Math.min(dtMax, 2 * dt, 0.9 * dmax / sp);
      if (t < ramp && t + dt > ramp) dt = ramp - t;
      P = pool(eta, frac(t + dt));
    }
    P = pool(eta, 1);
  }
  // the flow on the top as it is (a lid: the speed through it, vn = (ḣ − s) n_y, given)
  const S = setup(P, { type: 'slip', normal: 'surface', un: (x, y, z) => { const n = P.nodeAt(x, z); return (P.hdot - P.stream(x, y, z)) * (P.nrm.get(n) || [0, 1, 0])[1]; } });
  const R = ffSolve(S, { tol: 1e-8, ...(o.solve || {}), x0 });
  const flows = {}; for (const t of ['pile', 'end', 'back', 'web', 'blade', 'side0', 'side1', ...(o.pipes ? ['pipe', 'bore'] : [])]) flows[t === 'pile' ? 'top' : t] = ffFlow(S, R.x, t);
  return { M: P.M, S, x: R.x, u: R.u, v: R.v, w: R.w, p: R.p, hdot: P.hdot, area: o.W * (o.xBack + P.I.xJ), free: P.free, flows, hist: R.hist, converged: R.converged,
    eta: eta || new Float64Array(P.NX * P.I.NZ), tops, stream: P.stream };
}

/**
 * The pool's flow in one part of the cycle with the outlets' pipes standing in the paste, round (the 3D): on the coater's
 * block mesh (feed-mesh.js: round each pipe O-grid blocks, its bore, its wall, a ring out to a square), cut at the pool's
 * back edge, ending at the pool edge. o: as fplSolve's -- W the whole pool, outlets all of them (one x) -- and pipe: { d, Do,
 * tip, bore (m: the bore's channel modelled above the tip, default 2 d) }, half (the mirror half: the outlets in mirror
 * pairs, the middle a mirror), mesh (fmMesh's options: hFar, hJ, grow, m, sq, nLo, nUp, nCore, nWall, nRing). Qin: through
 * the pipes solved (the half's, with half), each its share. The paste enters at each bore's top (pipeIn: plug, the same
 * speed over the bore, the discrete area's; at rest between pulses) and shapes itself down the bore to the tip; the pipes'
 * walls, their ends and their bores' walls hold it (pipeOut, pipeEnd, pipeInner). The top a lid at the level, the paste
 * through it at ḣ n_y (ḣ from the balance over its free part); the web, the blade, the side plates, the back edge and the
 * pool edge as fplSolve's.
 * Returns { M, S, x, u, v, w, p, hdot, free, flows: { top, end, back, web, blade, side0, side1, pipe (the pipes' walls),
 *   bore (their tops: in, negative) } (m³/s, out), hist, converged }.
 */
function fplSolvePipes(o) {
  const fmMesh = FPL_('fmMesh', './feed-mesh.js'), ffSetup = FPL_('ffSetup', './feed-fem.js'), ffSolve = FPL_('ffSolve', './feed-fem.js'), ffFlow = FPL_('ffFlow', './feed-fem.js');
  const ffFaceNormals = FPL_('ffFaceNormals', './feed-fem.js'), fsArea = FPL_('fsArea', './feed-free.js'), FMF = FPL_FACES(), rg = o.rho * o.g, Pp = o.pipe;
  if (!(Pp.tip > 0 && Pp.tip < o.h)) throw new Error('the pipes\' tips must be in the paste, above the web');
  const M = fmMesh({ W: o.W, half: !!o.half, d: Pp.d, t: (Pp.Do - Pp.d) / 2, xCut: -o.xBack, xEnd: -o.xEnd, bladeY: o.blade, H0: o.h, film0: 0,
    outlets: o.outlets.map(q => ({ z: q.z, ym: Pp.tip, yIn: Pp.tip + (Pp.bore ?? 2 * Pp.d) })), xP: o.outlets[0].x, ...(o.mesh || {}) });
  // the top's free nodes (off the walls: the side plates, the blade, the pipes), their normals and shares of its plan
  const walls = new Set(['side0', 'side1', 'blade', 'pipeOut']), onWall = new Set();
  for (const f of M.faces) if (walls.has(f.tag)) for (const i of FMF[f.f]) onWall.add(M.elems[27 * f.e + i]);
  const nrm = new Map(); for (const f of M.faces) if (f.tag === 'pile') ffFaceNormals(M, M.X, M.Y, M.Z, f, (n, v) => { const a = nrm.get(n) || [0, 0, 0]; for (let c = 0; c < 3; c++) a[c] += v[c]; nrm.set(n, a); });
  for (const [n, a] of nrm) { const l = Math.hypot(...a); nrm.set(n, a.map(v => v / l)); }
  const S0 = { M, X: M.X, Y: M.Y, Z: M.Z }, top = [...fsArea(S0, ['pile'])].filter(([n]) => !onWall.has(n)).map(([n, a]) => [n, a * nrm.get(n)[1]]);
  const free = top.reduce((s, [, a]) => s + a, 0), qIn = o.pulse ? o.Qin : 0, hdot = (qIn - o.Qout) / free;
  // (each bore's plug: the pipes' flow over their tops' discrete area -- the flow in exact)
  const inA = [...fsArea(S0, ['pipeIn']).values()].reduce((s, a) => s + a, 0), V = qIn / inA;
  const wall = { type: 'velocity', u: [0, 0, 0] };
  const bc = { web: { type: 'velocity', u: [o.U, 0, 0] }, blade: wall, side0: wall, side1: wall, sym: { type: 'slip', normal: 'z' },
    cut: { type: 'slip', normal: 'x', over: true }, end: { type: 'traction', t: (x, y) => [-rg * (o.h - y), 0, 0] },
    pile: { type: 'slip', normal: 'surface', un: hdot * 1 }, pipeOut: wall, pipeEnd: wall, pipeInner: wall,
    // (last: the plug wins at the bore's rim, as the 2D's slot)
    pipeIn: { type: 'velocity', u: [0, -V, 0] } };
  // (the lid's speed through it: ḣ n_y at each node, its own normal)
  const byPos = new Map(); for (const [n, v] of nrm) byPos.set(`${M.X[n]},${M.Y[n]},${M.Z[n]}`, v[1]);
  bc.pile.un = (x, y, z) => hdot * (byPos.get(`${x},${y},${z}`) ?? 1);
  const S = ffSetup({ mesh: M, mu: o.mu, gdMin: o.gdMin, rho: o.rho, g: o.g, Lr: 1e-3, Ur: o.U || 1e-3, bc });
  const R = ffSolve(S, { tol: 1e-8, ...(o.solve || {}) });
  const fl = t => ffFlow(S, R.x, t), flows = { top: fl('pile'), end: fl('end'), back: fl('cut'), web: fl('web'), blade: fl('blade'), side0: fl('side0'), side1: fl('side1'),
    pipe: fl('pipeOut') + fl('pipeEnd') + fl('pipeInner'), bore: fl('pipeIn') };
  return { M, S, x: R.x, u: R.u, v: R.v, w: R.w, p: R.p, hdot, free, flows, hist: R.hist, converged: R.converged, V };
}

/** A Q1 pressure (on the elements' corners; NaN elsewhere) at every node of a Q2 mesh: trilinear in each element. */
function fplPressureAll(M, p) {
  const out = Float64Array.from(p), L = (a, b, g) => (g * 3 + b) * 3 + a;
  for (let e = 0; e < M.nE; e++) {
    const el = M.elems.subarray(27 * e, 27 * e + 27), c = [0, 2].flatMap(g => [0, 2].flatMap(b => [0, 2].map(a => p[el[L(a, b, g)]])));
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const n = el[L(a, b, g)]; if (Number.isFinite(out[n])) continue;
      const w = (k, t) => (k ? t / 2 : 1 - t / 2);
      let s = 0; for (let gg = 0; gg < 2; gg++) for (let bb = 0; bb < 2; bb++) for (let aa = 0; aa < 2; aa++) s += w(aa, a) * w(bb, b) * w(gg, g) * c[(gg * 2 + bb) * 2 + aa];
      out[n] = s;
    }
  }
  return out;
}

/**
 * Paths of the paste through the cycle: from points (each [x, y, z], m) at time t0 (s from a pulse's start), the pulse's flow
 * while t mod T < τ, the drain's after (RK4, the step a fraction of the element over the speed, never across a switch),
 * until the path leaves through the pool edge (x ≥ −xEnd) or tMax. A: the pulse's ({ M, u, v, w }), B: the drain's (each on
 * its own mesh: the top differs). Where the flow switches and a point is above the new top (in a heap that flattens), or a
 * step takes it past a wall or the top (where the flow runs along them), it is put back just inside (topAt(M, x, z): the
 * top's height there, default the pool mesh's). Returns per path { pts: [x, y, z, t], out (true: through the pool edge), t
 * (s to get there) }.
 */
function fplPaths(A, B, starts, { T, tau, t0 = 0, xEnd, tMax = 2000, frac = 0.3, topAt = fplTopAt }) {
  const fp = n => FPL_(n, './feed-post.js'), fpIndex = fp('fpIndex'), fpField = fp('fpField');
  const XA = fpIndex(A.M), XB = A.M === B.M ? XA : fpIndex(B.M), FA = [A.u, A.v, A.w], FB = [B.u, B.v, B.w], dT = 1e-9 * T;
  // the phase in the cycle (just before a pulse: its start), whether a pulse is on, the time to the next switch
  const phase = t => { const p = ((t % T) + T) % T; return p > T - dT ? p - T : p; }, inPulse = t => phase(t) < tau - dT;
  const flow = on => (on ? [XA, FA, A.M] : [XB, FB, B.M]);
  const gone = p => p[0] >= -xEnd - 1e-6;   // (at the pool edge, to a micrometre: where the flow there turns back, a path
  //  reaching it creeps along it)
  // a point outside the flow (a step past a wall, the web or the top): back inside the pool's box, just under its top
  // (the pool's mesh, or the coater's with the pipes in the paste: its width solved, its back edge at its cut)
  const W = A.M.info.Wend ?? A.M.info.W, xB = A.M.info.xBack ?? -A.M.info.xCut, e = 1e-9;
  const settle = (on, p) => { const [X, F, M] = flow(on); if (fpField(X, F, p)) return p;
    const q = [Math.max(p[0], -xB + e), Math.max(p[1], e), Math.min(Math.max(p[2], e), W - e)]; if (fpField(X, F, q)) return q;
    const y = topAt(M, q[0], q[2]); if (y == null) return p;
    for (let d = 1e-7; d < 2e-3; d *= 2) { const r = [q[0], Math.min(q[1], y - d), q[2]]; if (fpField(X, F, r)) return r; } return p; };
  return starts.map(p0 => {
    let t = t0, p = settle(inPulse(t0), p0.slice()); const pts = [[...p, t]];
    for (let s = 0; s < 40000 && t - t0 < tMax; s++) {
      if (gone(p)) return { pts, out: true, t: t - t0 };
      const on = inPulse(t), [X, F] = flow(on), at = q => fpField(X, F, q), r1 = at(p);
      if (!r1) break;
      const b = X.box.subarray(6 * r1.e, 6 * r1.e + 6), h = Math.min(b[3] - b[0], b[4] - b[1], b[5] - b[2]), sp = Math.hypot(...r1.v);
      if (sp < 1e-12) break;
      // (never across a switch of the flow: up to it, then the other flow)
      const ph = phase(t), toSwitch = on ? tau - ph : T - ph;
      let dt = Math.min(frac * h / sp, toSwitch), np = null, used = 0;
      for (let k = 0; k < 12 && !np; k++, dt /= 2) {
        const k1 = r1.v, r2 = at(p.map((v, i) => v + dt / 2 * k1[i])); if (!r2) continue;
        const r3 = at(p.map((v, i) => v + dt / 2 * r2.v[i])); if (!r3) continue;
        const r4 = at(p.map((v, i) => v + dt * r3.v[i])); if (!r4) continue;
        const q = p.map((v, i) => v + dt / 6 * (k1[i] + 2 * r2.v[i] + 2 * r3.v[i] + r4.v[i]));
        if (at(q) || gone(q)) { np = q; used = dt; }
        else { const r = settle(on, q); if (at(r)) { np = r; used = dt; } }   // (past a wall or the top: back inside)
      }
      if (!np) break;
      // (through the pool edge: where and when it crossed, along the step)
      if (gone(np)) { const f = (-xEnd - p[0]) / (np[0] - p[0]); p = p.map((v, i) => v + f * (np[i] - v)); t += f * used; pts.push([...p, t]); return { pts, out: true, t: t - t0 }; }
      p = np; t += used;
      // (at a switch: the other flow, the point inside it)
      if (used === toSwitch && !gone(p)) p = settle(!on, p);
      pts.push([...p, t]);
    }
    return { pts, out: gone(p), t: t - t0 };
  });
}

/**
 * The pool through a pulse cycle, as the pages show it (Coating › 2D and 3D › Pool and feed). o: { dim (2: a slice of the
 *   pool along the web, one element across with mirrors at its sides, the feed a band across, the whole width's per width;
 *   3: the whole pool between the side plates, its outlets), W, xBack, xEnd (m), R, H (m: the round blade's radius and gap;
 *   R 0: a blade whose face stands at the pool edge), rho, g, U, law: { muRef (Pa·s at 2.7 1/s), ty (Pa), n } (the paste's
 *   law, μ = τy/γ̇ + (μ − τy/2.7)(γ̇/2.7)^(n−1); or muLaw: γ̇ -> Pa·s, the app's own, with plain: true for a Newtonian one),
 *   outlets: [{ x, z }] (m), r (m, the landing's radius), Qin, Qout (m³/s, the whole
 *   width: all outlets during a pulse, the web's), hP, hD (m: the level during a pulse and between), T, tau (s), mesh: {
 *   hFine, hMax, ny, zs (optional: the element boundaries across), pipes (the 3D's round pipes: fmMesh's options) }, t0 (s
 *   into a pulse the paths start, default τ/2), tMax (s, default 4000), mirror (default true), solveTol (optional: each
 *   solve's tolerance), entry ('fall', 'heap': the paste entering through the top -- over the landing, the heap's foot --
 *   or 'dip': through pipes standing in the paste, their tips in it through the cycle: the 2D's a slot across the slice,
 *   the 3D's round, on the coater's block mesh, its flow shown on the pool's grid, NaN in the pipes' walls), pipe ({ d, Do,
 *   tip } m: the outlets' bore, outside and tip, for 'dip') };
 *   onProgress(text, 0..1).
 * The paste's law by continuation: its viscosity at 2.7 1/s first, then the law with its γ̇ floor brought down tenfold
 * twice (0.1, 0.01, 0.001 of U/H), each solve from the last.
 * The 3D with its outlets in mirror pairs across the pool's middle (the same x, z and W − z; none within two landing radii
 * of the middle -- with the tips in the paste, none whose pipe's square reaches it): the flow is symmetric about the middle, so half the pool is solved, a mirror at its middle (no flow
 * across it, no shear along it), and the whole pool rebuilt from it -- the same flow at half the cost (feed-pool.validate.js
 * checks it against the whole pool solved).
 * Returns { dim, W (the width shown, m: the slice's in 2D, the pool's in 3D), mirror (true: half solved), states: [pulse,
 *   drain], each { info, X, Y, Z, u, v, w, p (Float32Array; p NaN off the corners), flows (m³/s), hdot, converged, newton },
 *   paths: [{ outlet, s, out, t (s), pts (Float32Array: x, y, z, t …) }] }.
 */
function fplCycle(o, onProgress = () => {}) {
  const dim = o.dim, M3 = o.mesh || {}, nO = o.outlets.length;
  // (the outlets across the web in order; mirror pairs: the k-th from each side plate)
  const ord = o.outlets.map((q, j) => j).sort((a, b) => o.outlets[a].z - o.outlets[b].z);
  const mirror = dim === 3 && o.mirror !== false && nO >= 2 && nO % 2 === 0
    && ord.every((j, i) => { const q = o.outlets[j], m = o.outlets[ord[nO - 1 - i]]; return Math.abs(q.z + m.z - o.W) < 1e-9 && Math.abs(q.x - m.x) < 1e-12; })
    && ord.slice(0, nO / 2).every(j => o.outlets[j].z < o.W / 2 - (o.entry === 'dip' ? (M3.sq ?? 3) * o.pipe.Do / 2 : 2 * o.r));
  const W = dim === 2 ? Math.max(M3.hMax || 0.02, 4 * (M3.hFine || 2e-3)) : mirror ? o.W / 2 : o.W, share = W / o.W;
  const blade = o.R > 0 ? (x => o.H + o.R - Math.sqrt(Math.max(0, o.R * o.R - x * x))) : (() => 1e3);
  const L = o.law || {}, base = L.muRef - L.ty / 2.7, gd0 = o.U / o.H;
  const law = o.muLaw || (gd => L.ty / gd + base * Math.pow(gd / 2.7, L.n - 1)), mu27 = law(2.7), plain = o.muLaw ? !!o.plain : !(L.ty > 0) && L.n === 1;
  if (!(mu27 > 0)) throw new Error('the paste\'s law gives no viscosity at 2.7 1/s');
  const solved = dim === 2 ? [0] : mirror ? ord.slice(0, nO / 2) : o.outlets.map((q, j) => j);     // (the outlets solved, their indices)
  const outlets = dim === 2 ? [{ x: o.outlets[0].x, z: W / 2 }] : solved.map(j => o.outlets[j]);
  // (the tips in the paste: the 2D's pipe a slot across the slice, standing from above the top down to the tip; the 3D's
  //  round, on the coater's block mesh -- fplSolvePipes -- its flow then shown on the pool's own grid)
  const dip = o.entry === 'dip';
  if (dip && !(o.pipe.tip > 0 && o.pipe.tip < Math.min(o.hP, o.hD))) throw new Error(`the outlets' tips (${(o.pipe.tip * 1e3).toFixed(1)} mm above the web) must stay in the paste through the cycle: the level falls to ${(Math.min(o.hP, o.hD) * 1e3).toFixed(1)} mm between pulses`);
  const pipes = dip && dim === 2 ? [{ x: outlets[0].x, d: o.pipe.d, Do: o.pipe.Do, tip: o.pipe.tip, bore: 2 * o.pipe.d }] : null, round = dip && dim === 3;
  const mesh = { hFine: M3.hFine, hMax: M3.hMax, ny: M3.ny, ...(M3.zs ? { zs: M3.zs } : {}), ...(dim === 2 ? { nz: 1, sideFine: false } : mirror ? { sideFine: [true, false] } : {}) };
  const stages = plain ? [null] : [null, 1e-1, 1e-2, 1e-3], n = 2 * stages.length + 1;
  const f32 = a => Float32Array.from(a), states = [], fields = [];
  let done = 0;
  for (const pulse of [true, false]) {
    const so = { W, xBack: o.xBack, xEnd: o.xEnd, h: pulse ? o.hP : o.hD, blade, U: o.U, rho: o.rho, g: o.g, outlets, r: o.r, line: dim === 2, ...(pipes ? { pipes } : {}),
      Qin: o.Qin * share, Qout: o.Qout * share, pulse, sides: dim === 2 ? 'slip' : mirror ? ['wall', 'slip'] : 'wall', mesh };
    let r = null, x0 = null, newton = 0;
    for (const f of stages) {
      onProgress(`${pulse ? 'During a pulse' : 'Between pulses'}: ${f == null ? (plain ? 'the flow' : 'the flow at the viscosity at 2.7 1/s') : `the paste's law, γ̇ floor ${(f * gd0).toPrecision(2)} 1/s`}`, done / n);
      const sv = { mu: f == null ? () => mu27 : law, gdMin: f == null ? undefined : f * gd0,
        solve: { x0, ...(o.solveTol ? { tol: o.solveTol } : {}), ...(f == null ? {} : { lineSearch: true, maxNewton: 40 }) } };
      // (the round pipes: the whole pool's outlets to the coater's mesher, its own half when they are mirror pairs)
      r = round ? fplSolvePipes({ ...so, ...sv, W: o.W, half: mirror, outlets: o.outlets, pipe: { d: o.pipe.d, Do: o.pipe.Do, tip: o.pipe.tip, bore: 2 * o.pipe.d }, mesh: M3.pipes })
        : fplSolve({ ...so, ...sv });
      x0 = r.x; newton += r.hist.length; done++;
    }
    fields.push(r);
    if (round) {
      // the flow shown on the pool's own grid (as the other entries'): each node's velocity and pressure from the coater's
      //  mesh where it is in the paste; in a pipe's wall none (NaN)
      const fp = k => FPL_(k, './feed-post.js'), fpIndex = fp('fpIndex'), fpField = fp('fpField'), fpmMesh = FPL_('fpmMesh', './feed-pool-mesh.js');
      const G = fpmMesh({ W, xBack: o.xBack, xEnd: o.xEnd, h: so.h, blade, outlets, r: o.pipe.Do / 2, ...mesh }), X = fpIndex(r.M), F = [r.u, r.v, r.w, fplPressureAll(r.M, r.p)];
      const A = ['u', 'v', 'w', 'p'].map(() => new Float32Array(G.nN));
      for (let i = 0; i < G.nN; i++) {
        const q = [G.X[i], G.Y[i], G.Z[i]];
        // (a node on a curved wall -- the blade's face, a pipe -- a hair outside the mesh's own surface: just inside)
        let at = fpField(X, F, q);
        for (let k = 0, e = 1e-7; !at && k < 6; k++, e *= 4) at = fpField(X, F, [q[0] - e, q[1] - e, q[2]]) || fpField(X, F, [q[0] + e, q[1] - e, q[2]]);
        for (let c = 0; c < 4; c++) A[c][i] = at ? at.v[c] : NaN;
      }
      const I = G.info;
      states.push({ info: { NX: I.NX, NY: I.NY, NZ: I.NZ, xs: I.xs, zs: I.zs, xJ: I.xJ, h: I.h, W, xBack: I.xBack, xEnd: I.xEnd, nE: r.M.nE, nN: r.M.nN, pipes: true },
        X: f32(G.X), Y: f32(G.Y), Z: f32(G.Z), u: A[0], v: A[1], w: A[2], p: A[3], flows: r.flows, hdot: r.hdot, converged: r.converged, newton });
      continue;
    }
    const I = r.M.info;
    // (a slot's pipe: the nodes in its wall, in no element, carry no flow: NaN)
    const u = f32(r.u), v = f32(r.v), w = f32(r.w), p = f32(r.p);
    if (pipes) { const inEl = new Uint8Array(r.M.nN); for (let i = 0; i < r.M.elems.length; i++) inEl[r.M.elems[i]] = 1; for (let i = 0; i < r.M.nN; i++) if (!inEl[i]) u[i] = v[i] = w[i] = p[i] = NaN; }
    states.push({ info: { NX: I.NX, NY: I.NY, NZ: I.NZ, xs: I.xs, zs: I.zs, xJ: I.xJ, h: I.h, W, xBack: I.xBack, xEnd: I.xEnd, nE: r.M.nE, nN: r.M.nN, ...(pipes ? { pipes: true } : {}) },
      X: f32(r.M.X), Y: f32(r.M.Y), Z: f32(r.M.Z), u, v, w, p, flows: r.flows, hdot: r.hdot, converged: r.converged, newton });
  }
  // the paths: from each landing (its middle, and half its radius either way), released t0 into a pulse
  onProgress('The paths from each landing', done / n);
  // (each path from under where the paste enters: the landing, the heap's foot -- or, the tips in the paste, the bore's mouth)
  const t0 = o.t0 ?? o.tau / 2, h0 = dip ? o.pipe.tip - 2e-4 : Math.min(o.hP, o.hD) - 2e-4, rs = dip ? 0.9 * o.pipe.d / 2 : o.r, starts = [], meta = [];
  outlets.forEach((q, j) => (dim === 2 ? [[0, 0], [-0.5, 0], [0.5, 0], [-0.25, 0], [0.25, 0]] : [[0, 0], [-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]).forEach(([a, b], s) => {
    starts.push([q.x + a * rs, h0, q.z + b * rs]); meta.push({ outlet: j, s }); }));
  // (on the coater's mesh, the top flat at the level up to the blade)
  const topAt = round ? (M, x) => Math.min(M.info.H0, blade(x)) : fplTopAt;
  const P = fplPaths(fields[0], fields[1], starts, { T: o.T, tau: o.tau, t0, xEnd: o.xEnd, tMax: o.tMax ?? 4000, topAt });
  let paths = P.map((p, i) => { const k = Math.max(1, Math.ceil(p.pts.length / 400)), sel = p.pts.filter((q, j) => j % k === 0 || j === p.pts.length - 1);
    return { ...meta[i], outlet: solved[meta[i].outlet], out: p.out, t: p.t, pts: Float32Array.from(sel.flat().map((v, j) => (j % 4 === 3 ? v - t0 : v))) }; });
  if (mirror) {
    // the whole pool from the half: each node and its mirror image (z → W − z, the flow across reversed), each path and its
    //  image from the mirrored outlet
    const full = st => {
      const I = st.info, NX = I.NX, NY = I.NY, Nh = I.NZ, NZ = 2 * Nh - 1, n = NX * NY * NZ, Wf = o.W, A = {};
      for (const f of ['X', 'Y', 'Z', 'u', 'v', 'w', 'p']) A[f] = new Float32Array(n);
      for (let k = 0; k < NZ; k++) { const kk = k < Nh ? k : 2 * Nh - 2 - k, sg = k < Nh ? 1 : -1;
        for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = (k * NY + j) * NX + i, b = (kk * NY + j) * NX + i;
          A.X[a] = st.X[b]; A.Y[a] = st.Y[b]; A.Z[a] = k < Nh ? st.Z[b] : Wf - st.Z[b]; A.u[a] = st.u[b]; A.v[a] = st.v[b]; A.w[a] = sg * st.w[b]; A.p[a] = st.p[b]; } }
      const f = st.flows, flows = {}; for (const k in f) flows[k] = k === 'side0' || k === 'side1' ? f.side0 : 2 * f[k];
      return { ...st, ...A, flows, info: { ...I, NZ, W: Wf, zs: [...I.zs, ...I.zs.slice(0, -1).reverse().map(z => Wf - z)], nE: 2 * I.nE, nN: n, nESolved: I.nE, mirror: true } };
    };
    for (let s = 0; s < states.length; s++) states[s] = full(states[s]);
    const img = new Map(ord.map((j, i) => [j, ord[nO - 1 - i]]));
    paths = [...paths, ...paths.map(p => ({ ...p, outlet: img.get(p.outlet), pts: p.pts.map((v, j) => (j % 4 === 2 ? o.W - v : v)) }))];
  }
  onProgress('Done', 1);
  return { dim, W: mirror ? o.W : W, mirror, states, paths, t0 };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fplStreams, fplPlanWeights, fplTopAt, fplSolve, fplSolvePipes, fplPressureAll, fplPaths, fplCycle };
