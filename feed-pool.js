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
 *  through the mesh's top (a: its free nodes' shares of the area, [node, m²]) is exactly the stream's. Returns (x, y, z) ->
 *  the velocity down. */
function fplStreams(a, M, outlets, r, qEach) {
  const bump = (q, x, z) => { const d2 = ((x - q.x) ** 2 + (z - q.z) ** 2) / (r * r); return d2 < 1 ? (1 - d2) ** 2 : 0; };
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
 *   pulse (true: during a pulse), sides ('wall', the side plates, default; 'slip': mirrors, a strip of a wider pool),
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
  const FMF = FPL_FACES(), F = o.free, tops = [], rg = o.rho * o.g, slipSides = o.sides === 'slip';
  let eta = o.eta ? Float64Array.from(o.eta) : null, x0 = o.solve && o.solve.x0;
  // the pool on a top: its mesh, the top's free nodes (their area shares, their normals), the streams, the level's rate
  const pool = (eta, f = 1) => {
    const M = fpmMesh({ W: o.W, xBack: o.xBack, xEnd: o.xEnd, h: o.h, blade: o.blade, outlets: o.outlets, r: o.r, ...(o.mesh || {}), eta });
    const I = M.info, NX = I.NX, NY = I.NY, iJ = 2 * I.xs.findIndex(v => Math.abs(v - I.xJ) < 1e-12);
    // (the top's nodes on the walls -- the side plates, where it meets the blade -- hold the walls' no-slip; the top moves
    //  where it is free)
    const onWall = new Set();
    for (const f of M.faces) if ((!slipSides && (f.tag === 'side0' || f.tag === 'side1')) || f.tag === 'blade') for (const i of FMF[f.f]) onWall.add(M.elems[27 * f.e + i]);
    const nrm = new Map(); for (const f of M.faces) if (f.tag === 'pile') ffFaceNormals(M, M.X, M.Y, M.Z, f, (n, v) => { const a = nrm.get(n) || [0, 0, 0]; for (let c = 0; c < 3; c++) a[c] += v[c]; nrm.set(n, a); });
    for (const [n, a] of nrm) { const l = Math.hypot(...a); nrm.set(n, a.map(v => v / l)); }
    // (each free node's share of the top's plan: its area share times n_y)
    const top = [...fsArea({ M, X: M.X, Y: M.Y, Z: M.Z }, ['pile'])].filter(([n]) => !onWall.has(n)).map(([n, a]) => [n, a * nrm.get(n)[1]]);
    const free = top.reduce((s, [, a]) => s + a, 0), hdot = ((o.pulse ? f * o.Qin : 0) - o.Qout) / free;
    const stream = o.pulse ? fplStreams(top, M, o.outlets, o.r, f * o.Qin / o.outlets.length) : () => 0;
    // a top node from its place (for the lid's speed through it: its own n_y)
    const ix = new Map(), kz = new Map(); for (let i = 0; i < NX; i++) ix.set(M.X[i], i); for (let k = 0; k < I.NZ; k++) kz.set(M.Z[k * NY * NX], k);
    const nodeAt = (x, z) => (kz.get(z) * NY + NY - 1) * NX + ix.get(x);
    return { M, I, NX, NY, iJ, onWall, nrm, top, free, hdot, stream, nodeAt };
  };
  const bcs = (P, topBC) => {
    const wall = { type: 'velocity', u: [0, 0, 0] };
    return { web: { type: 'velocity', u: [o.U, 0, 0] }, blade: wall,
      side0: slipSides ? { type: 'slip', normal: 'z' } : wall, side1: slipSides ? { type: 'slip', normal: 'z' } : wall,
      back: { type: 'slip', normal: 'x', over: true },
      end: { type: 'traction', t: (x, y) => [-rg * (o.h - y), 0, 0] }, pile: topBC };
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
      if (!slipSides) for (let i = 0; i < iJ; i++) { next[i] = (4 * next[NX + i] - next[2 * NX + i]) / 3; const K = I.NZ - 1; next[K * NX + i] = (4 * next[(K - 1) * NX + i] - next[(K - 2) * NX + i]) / 3; }
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
  const flows = {}; for (const t of ['pile', 'end', 'back', 'web', 'blade', 'side0', 'side1']) flows[t === 'pile' ? 'top' : t] = ffFlow(S, R.x, t);
  return { M: P.M, S, x: R.x, u: R.u, v: R.v, w: R.w, p: R.p, hdot: P.hdot, area: o.W * (o.xBack + P.I.xJ), free: P.free, flows, hist: R.hist, converged: R.converged,
    eta: eta || new Float64Array(P.NX * P.I.NZ), tops, stream: P.stream };
}

/**
 * Paths of the paste through the cycle: from points (each [x, y, z], m) at time t0 (s from a pulse's start), the pulse's flow
 * while t mod T < τ, the drain's after (RK4, the step a fraction of the element over the speed, never across a switch),
 * until the path leaves through the pool edge (x ≥ −xEnd) or tMax. A: the pulse's ({ M, u, v, w }), B: the drain's (each on
 * its own mesh: the top differs). Where the flow switches and a point is above the new top (in a heap that flattens), or a
 * step takes it past a wall or the top (where the flow runs along them), it is put back just inside. Returns per path { pts: [x, y, z, t], out (true: through the pool edge), t (s to get
 * there) }.
 */
function fplPaths(A, B, starts, { T, tau, t0 = 0, xEnd, tMax = 2000, frac = 0.3 }) {
  const fp = n => FPL_(n, './feed-post.js'), fpIndex = fp('fpIndex'), fpField = fp('fpField');
  const XA = fpIndex(A.M), XB = A.M === B.M ? XA : fpIndex(B.M), FA = [A.u, A.v, A.w], FB = [B.u, B.v, B.w], dT = 1e-9 * T;
  // the phase in the cycle (just before a pulse: its start), whether a pulse is on, the time to the next switch
  const phase = t => { const p = ((t % T) + T) % T; return p > T - dT ? p - T : p; }, inPulse = t => phase(t) < tau - dT;
  const flow = on => (on ? [XA, FA, A.M] : [XB, FB, B.M]);
  const gone = p => p[0] >= -xEnd - 1e-6;   // (at the pool edge, to a micrometre: where the flow there turns back, a path
  //  reaching it creeps along it)
  // a point outside the flow (a step past a wall, the web or the top): back inside the pool's box, just under its top
  const W = A.M.info.W, xB = A.M.info.xBack, e = 1e-9;
  const settle = (on, p) => { const [X, F, M] = flow(on); if (fpField(X, F, p)) return p;
    const q = [Math.max(p[0], -xB + e), Math.max(p[1], e), Math.min(Math.max(p[2], e), W - e)]; if (fpField(X, F, q)) return q;
    const y = fplTopAt(M, q[0], q[2]); if (y == null) return p;
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

if (typeof module !== 'undefined' && module.exports) module.exports = { fplStreams, fplPlanWeights, fplTopAt, fplSolve, fplPaths };
