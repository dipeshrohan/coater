'use strict';
/*
 * cfd-orient.js — the flakes' orientation along the 2D's flow to the film, then on the wet web to the oven (GO-2).
 *
 * The film leaving the 2D domain is made of the through-flow: nLines streamlines, each carrying an equal share of
 * it (seeded at the domain's outlet column at the midpoints of the stream function's range, from the web to the
 * free surface), are traced back to where they entered (the inlet; or where the flow stands still: a stagnant
 * corner), in the mesh's own grid coordinates (as cfd-struct.js does). An ensemble of flake normals (orient.js)
 * starts there steady in the local flow (Doi–Hess above U = 5 where it keeps turning: all moments of the turn mixed,
 * orientStart; or at random: opts.start 'random'), and is carried forward along the path
 * in the velocity gradient there: the FEM's own at the nodes (∂u/∂x = τxx / 2μ, ∂v/∂y = τyy / 2μ, the shear part
 * τxy / μ and the vorticity ω = ∂v/∂x − ∂u/∂y), bilinear between them. Past the outlet the film is at rest on the
 * web until the oven (opts.tRest, s): each model's own relaxation (Folgar–Tucker: none without flow; Doi–Hess: to its
 * equilibrium order).
 * Each line reports: its height at the outlet (and as a fraction of the film there), the orientation leaving the
 * domain and at the oven (orient.js's orStats), and the traces a cut along the web and across it would show
 * (angles, weights); samples along the path (x, y, the second moment A) draw the orientation over the flow.
 */
const CO_O = typeof orStep === 'function' ? { orRng, orEnsemble, orCopy, orA, orEig, orStats, orGammaDot, orDr, orStep, orDt, orRun, orSteady, orTraces, orCutStats, orHist } : require('./orient.js');

/** The velocity gradient's components at the nodes of r (∂u/∂x, ∂u/∂y, ∂v/∂x, ∂v/∂y). */
function orientGradients(r) {
  const N = r.NC * r.NR, ux = new Float64Array(N), uy = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const mu = r.mu[n], s = r.tauXY[n] / mu, w = r.omega[n];
    ux[n] = r.tauXX[n] / (2 * mu); vy[n] = r.tauYY[n] / (2 * mu); uy[n] = 0.5 * (s - w); vx[n] = 0.5 * (s + w);
  }
  return { ux, uy, vx, vy };
}

/**
 * The through-flow's lines in r: nLines streamlines, each an equal share of the flow, seeded at the outlet column
 * (the stream function's midpoints, from the web up) and traced back to where they entered (h: the trace's step,
 * cells; maxSteps per line). Returns { lines: [{ f, P (grid points, outlet first), T (time from each to the one
 * before), how: 'inlet' | 'still' | 'long' }], at (grid point -> position, grid rates, gradient L), yWeb, hFilm }.
 */
function orientPaths(r, { nLines = 24, h = 0.25, maxSteps = 40000 } = {}) {
  const NC = r.NC, NR = r.NR, X = r.x, Y = r.y, U = r.u, V = r.v, id = (c, k) => c * NR + k;
  const G = orientGradients(r);
  // at grid point (xi, eta): position, grid rates, the gradient (bilinear in the node grid)
  const at = (xi, eta, o) => {
    const c = Math.min(NC - 2, Math.max(0, Math.floor(xi))), k = Math.min(NR - 2, Math.max(0, Math.floor(eta)));
    const s = xi - c, t = eta - k, a = id(c, k), b = id(c + 1, k), d = id(c, k + 1), e = id(c + 1, k + 1);
    const w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = (1 - s) * t, w3 = s * t, bl = F => w0 * F[a] + w1 * F[b] + w2 * F[d] + w3 * F[e];
    const u = bl(U), v = bl(V);
    const xs = (1 - t) * (X[b] - X[a]) + t * (X[e] - X[d]), xt = (1 - s) * (X[d] - X[a]) + s * (X[e] - X[b]);
    const ys = (1 - t) * (Y[b] - Y[a]) + t * (Y[e] - Y[d]), yt = (1 - s) * (Y[d] - Y[a]) + s * (Y[e] - Y[b]);
    const J = xs * yt - xt * ys;
    o.x = bl(X); o.y = bl(Y); o.ok = Math.abs(J) > 1e-300;
    o.xi = o.ok ? (yt * u - xt * v) / J : 0; o.eta = o.ok ? (xs * v - ys * u) / J : 0;
    const L = o.L || (o.L = new Float64Array(9));
    L[0] = bl(G.ux); L[1] = bl(G.uy); L[3] = bl(G.vx); L[4] = bl(G.vy);
    return o;
  };
  // the seeds: the outlet column's stream function, from the web up
  const cOut = NC - 1, psiC = Array.from({ length: NR }, (_, k) => r.psi[id(cOut, k)]), Qo = psiC[NR - 1];
  const yWeb = Y[id(cOut, 0)], hFilm = Y[id(cOut, NR - 1)] - yWeb, lines = [];
  for (let j = 0; j < nLines; j++) {
    const f = (j + 0.5) / nLines, target = f * Qo;
    let k = 0; while (k < NR - 2 && psiC[k + 1] < target) k++;
    const eta0 = k + Math.min(1, Math.max(0, (target - psiC[k]) / ((psiC[k + 1] - psiC[k]) || 1)));
    // back along the streamline: the path's points (grid coordinates) and the time between them
    const P = [[cOut - 1e-9, eta0]], T = [0], p1 = {}, p2 = {};
    let xi = cOut - 1e-9, eta = eta0, how = 'inlet';
    for (let s = 0; s < maxSteps; s++) {
      if (xi <= 1e-12) break;
      at(xi, eta, p1);
      const sp = p1.ok ? Math.max(Math.abs(p1.xi), Math.abs(p1.eta)) : 0;
      if (!(sp > 1e-12)) { how = 'still'; break; }
      let dt = h / sp;
      at(xi - 0.5 * dt * p1.xi, Math.min(NR - 1, Math.max(0, eta - 0.5 * dt * p1.eta)), p2);
      if (!p2.ok) { how = 'still'; break; }
      let nxi = xi - dt * p2.xi, neta = eta - dt * p2.eta;
      if (nxi < 0) { const q = xi / (xi - nxi); dt *= q; nxi = 0; neta = eta + q * (neta - eta); }
      xi = nxi; eta = Math.min(NR - 1, Math.max(0, neta));
      P.push([xi, eta]); T.push(dt);
      if (s === maxSteps - 1) how = 'long';
    }
    lines.push({ f, P, T, how });
  }
  return { lines, at, yWeb, hFilm };
}

/** The flakes of several groups (each with its own mean field) as one ensemble, for their statistics. */
function orMerge(Es) {
  if (Es.length === 1) return Es[0];
  const n = Es.reduce((a, E) => a + E.n, 0), p = new Float64Array(3 * n);
  let o = 0; for (const E of Es) { p.set(E.p, o); o += 3 * E.n; }
  return { n, p };
}

/** ⟨pp⟩ of an ensemble and each component's standard error (its flakes' own scatter / √n). */
function orAErr(E) {
  const A = CO_O.orA(E), v = new Float64Array(9), p = E.p, idx = [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]];
  for (let k = 0; k < E.n; k++) for (const [i, j] of idx) { const d = p[3 * k + i] * p[3 * k + j] - A[3 * i + j]; v[3 * i + j] += d * d; }
  for (const [i, j] of idx) { v[3 * i + j] = Math.sqrt(v[3 * i + j] / (E.n - 1) / E.n); v[3 * j + i] = v[3 * i + j]; }
  return { A, se: v };
}

/**
 * At rest for time t (on the web to the oven). Folgar–Tucker: nothing moves. Doi–Hess: toward its own order, in
 * stretches (half its own time, as orient.js's steady state) until the flakes' ⟨pp⟩ (all groups together) changes over
 * one by less than 4 standard errors of the change (the ensemble's own scatter; at least 2 stretches): then it is at
 * rest in its order (a film's direction does not move at rest; a finite ensemble's would only drift, its own
 * scatter), and the rest of t changes nothing. Returns the time it ran (t, or when it settled).
 */
function orientRest(Es, t, M, rng) {
  if (!(t > 0)) return 0;
  const L = new Float64Array(9), Dr = CO_O.orDr(L, M);
  if (!(Dr > 0)) return t;   // no diffusion: nothing moves
  const own = Math.max(3 / (6 * Dr), M.kind === 'dh' && M.U ? 3 / (3 * M.U * M.Dr) : 0, M.kind === 'dh' ? 3 / (6 * Dr * Math.max(0.03, Math.abs(1 - (M.U || 0) / 5))) : 0);
  const stretch = own / 2;
  let done = 0, prev = orAErr(orMerge(Es));
  for (let k = 0; done < t - 1e-12 * t; k++) {
    const dt = Math.min(stretch, t - done);
    for (const E of Es) CO_O.orRun(E, L, dt, M, rng);
    done += dt;
    const cur = orAErr(orMerge(Es));
    let z = 0; for (let i = 0; i < 9; i++) z = Math.max(z, Math.abs(cur.A[i] - prev.A[i]) / (Math.SQRT2 * Math.max(cur.se[i], 1e-9)));
    prev = cur;
    if (k >= 1 && z < 4) break;
  }
  return done;
}

/**
 * Where a line enters, its flakes' start (opts.start 'steady'): the model's steady state in the flow there
 * (orient.js's orSteady). Doi–Hess above U = 5 (flakes crowded enough to line up with each other) has none in a
 * slow shear: the flakes' common direction keeps turning over (tumbling). There the start is all moments of the turn
 * mixed, as different spots across the web would be (user's choice, Q47): the n flakes from random settle in that
 * flow (orSteady, at most 6 stretches), are followed until their direction has turned once (half a turn of the normal
 * about the cross direction: the period T; at most wMax strain units), and K = 12 copies of them at evenly spaced
 * moments of that turn are the start, each group keeping its own mean field. If it never turned: steady (its ⟨pp⟩
 * varying over the window no more than 10 × its sampling variance): the last state, one group; else it rocks without
 * turning over: 12 copies evenly over the window. Below a shear of Pe_min = 2 D_r the turn is taken at 2 D_r (the turn then
 * takes about 15 strain units whatever the shear; far slower in time, out of reach).
 * The model's own limit (not followed): at shears of a few D_r its turn can drift out of the plane of the flow over
 * hundreds of strain units (several motions are possible there and the flakes' past decides); the start is the turn
 * it settles into first. A group needs its flakes: about 1000 (fewer, 250, wander out of the plane by their own
 * scatter within a few turns).
 * Returns { Es, turning, turn (strain units of T, or null), groups, settled }.
 */
const OR_GROUPS = 12, OR_PE_MIN = 2, OR_STEADY_VAR = 10;
function orientStart(L, M, n, seed, rng, { wMax = 60, dStrain = 0.25, peMin = OR_PE_MIN } = {}) {
  if (!(M.kind === 'dh' && (M.U || 0) > 5)) {
    const st = CO_O.orSteady(L, M, { n, seed });
    return { Es: [st.E], turning: false, turn: null, groups: 1, settled: st.converged };
  }
  const Dr = CO_O.orDr(L, M), g = CO_O.orGammaDot(L), gMin = peMin * Dr;
  let Lf = L;
  if (g < gMin) { Lf = new Float64Array(9); if (g > 0) for (let i = 0; i < 9; i++) Lf[i] = L[i] * gMin / g; else Lf[1] = -gMin; }
  const gf = CO_O.orGammaDot(Lf);
  const E = CO_O.orSteady(Lf, M, { n, seed, maxStretches: 6 }).E;
  // follow it: the director's turn about the cross direction (z), a copy every dStrain
  const dt = dStrain / gf, snaps = [];
  let prev = CO_O.orStats(E).n, phi = 0, T = null;
  for (let k = 1; k * dStrain <= wMax + 1e-9; k++) {
    CO_O.orRun(E, Lf, dt, M, rng);
    snaps.push(CO_O.orCopy(E));
    let nv = CO_O.orStats(E).n;
    if (nv[0] * prev[0] + nv[1] * prev[1] + nv[2] * prev[2] < 0) nv = nv.map(x => -x);
    phi += Math.atan2(prev[0] * nv[1] - prev[1] * nv[0], prev[0] * nv[0] + prev[1] * nv[1] + prev[2] * nv[2]);
    prev = nv;
    if (Math.abs(phi) >= Math.PI) { T = k * dStrain; break; }
  }
  const N = snaps.length;
  if (T === null) {
    // no turn: steady when ⟨pp⟩ varies over the window no more than OR_STEADY_VAR × its own sampling variance (the
    // flakes' scatter / n; lined up with each other the flakes' mean field makes a steady ensemble wander 1–4 × that:
    // shear 40–150 D_r at U 8), else it rocks (near the turning's edge, 20 D_r: about 100 ×)
    const last = orAErr(snaps[N - 1]), As = snaps.map(c => CO_O.orA(c));
    let ratio = 0;
    for (const i of [0, 1, 2, 4, 5, 8]) {
      const m = As.reduce((a, A) => a + A[i], 0) / N, vt = As.reduce((a, A) => a + (A[i] - m) * (A[i] - m), 0) / N;
      ratio = Math.max(ratio, vt / Math.max(last.se[i] * last.se[i], 1e-18));
    }
    if (ratio <= OR_STEADY_VAR) return { Es: [snaps[N - 1]], turning: false, turn: null, groups: 1, settled: true, rock: ratio };
  }
  const Es = [];
  for (let k = 0; k < OR_GROUPS; k++) Es.push(snaps[Math.min(N - 1, Math.max(0, Math.round((k + 0.5) * N / OR_GROUPS - 0.5)))]);
  return { Es, turning: T !== null, turn: T, groups: OR_GROUPS, settled: false };
}

/**
 * The flakes flattened as the film collapses to lam of its thickness while it dries (GO-3: it cannot shrink along the
 * web, so the collapse is through the thickness, y): affine, a disc's normal goes as F^-T n with F = diag(1, lam, 1),
 * so (x, y, z) -> (x, y / lam, z), renormalised. A trace in a cut then turns as tan θ' = lam tan θ.
 */
function orCollapse(E, lam) {
  const p = Float64Array.from(E.p);
  for (let k = 0; k < E.n; k++) {
    const x = p[3 * k], y = p[3 * k + 1] / lam, z = p[3 * k + 2], s = Math.hypot(x, y, z);
    p[3 * k] = x / s; p[3 * k + 1] = y / s; p[3 * k + 2] = z / s;
  }
  return { n: E.n, p };
}

/**
 * The orientation along r's through-flow to the film and on to the oven. M: orient.js's model. opts: nLines (24),
 * n (flakes per line, 1000), seed, start ('steady' | 'random' | a function (L, j, rng) -> an ensemble or an array
 * of them: groups each with its own mean field), tRest (s on the web to the oven; 0: none), samples (per line along
 * the path, 16), h (trace step, cells: 0.25), maxSteps (per line, 40000), collapse (the dried film's thickness over the
 * wet one, φ0 / φ_m: below 1, the dried state too).
 * Returns { lines: [{ f, yOut, depth, how, start (+ turning, turn, groups, settled, gd), nFlakes, out, oven, tPath, tRested,
 *   samples, traces: { md, cd } (at the oven), dried, tracesDried }], film: { out, oven, dried } (their mean), cuts (+ dried),
 *   hFilm, stats: { steps } }.
 */
function orientAlong(r, M, opts = {}) {
  const { nLines = 24, n = 1000, seed = 1, start = 'steady', tRest = 0, samples = 16, h = 0.25, maxSteps = 40000, onLine = null, peMin = OR_PE_MIN, collapse = null } = opts;
  const lam = collapse > 0 && collapse < 1 ? collapse : null;
  const { lines, at, yWeb, hFilm } = orientPaths(r, { nLines, h, maxSteps });
  const out = { lines: [], stats: { steps: 0 } };
  lines.forEach(({ f, P, T, how }, j) => {
    // forward: the ensemble from where the line entered
    const rng = CO_O.orRng(seed + 7919 * j), q = {};
    const first = P[P.length - 1];
    at(first[0], first[1], q);
    let Es, info = { turning: false, turn: null, groups: 1, settled: true };
    if (typeof start === 'function') { const e = start(q.L, j, rng); Es = Array.isArray(e) ? e : [e]; info.groups = Es.length; }
    else if (start === 'random') Es = [CO_O.orEnsemble(n, rng)];
    else { const st = orientStart(q.L, M, n, seed + 104729 * (j + 1), rng, { peMin }); Es = st.Es; info = { turning: st.turning, turn: st.turn, groups: st.groups, settled: st.settled }; }
    const nFl = Es.reduce((a, E) => a + E.n, 0);
    const startStats = { ...CO_O.orStats(orMerge(Es)), ...info, gd: CO_O.orGammaDot(q.L) };
    const tPath = T.reduce((a, b) => a + b, 0), every = Math.max(1, Math.floor((P.length - 1) / samples)), smp = [];
    for (let i = P.length - 1; i > 0; i--) {
      // the piece from P[i] to P[i-1] (forward), over time T[i], in the gradient at its middle
      const a = P[i], b = P[i - 1];
      at(0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), q);
      for (const E of Es) out.stats.steps += CO_O.orRun(E, q.L, T[i], M, rng);
      if ((P.length - 1 - i) % every === 0) { at(b[0], b[1], q); smp.push({ x: q.x, y: q.y, A: Array.from(CO_O.orA(orMerge(Es))) }); }
    }
    at(P[0][0], P[0][1], q);
    const yOut = q.y, outStats = CO_O.orStats(orMerge(Es));
    // on the web to the oven, at rest
    const tRested = orientRest(Es, tRest, M, rng);
    const E = orMerge(Es), oven = CO_O.orStats(E), md = CO_O.orTraces(E, 'md'), cd = CO_O.orTraces(E, 'cd');
    const line = { f, yOut, depth: (yOut - yWeb) / hFilm, how, start: startStats, nFlakes: nFl, out: outStats, oven, tPath, tRested, samples: smp,
      traces: { md: { angles: md.angles, weights: md.weights }, cd: { angles: cd.angles, weights: cd.weights } } };
    // dried: the film collapsed through its thickness (its lines keep their share of the depth)
    if (lam) { const Ed = orCollapse(E, lam), mdD = CO_O.orTraces(Ed, 'md'), cdD = CO_O.orTraces(Ed, 'cd');
      line.dried = CO_O.orStats(Ed); line.tracesDried = { md: { angles: mdD.angles, weights: mdD.weights }, cd: { angles: cdD.angles, weights: cdD.weights } }; }
    out.lines.push(line);
    if (onLine) onLine(j + 1, lines.length);
  });
  // the film's orientation, flux weighted (each line an equal share: their mean)
  const mean = key => { const Am = new Float64Array(9); for (const l of out.lines) for (let i = 0; i < 9; i++) Am[i] += l[key].A[i] / out.lines.length; return Am; };
  out.film = { out: statsOfA(mean('out')), oven: statsOfA(mean('oven')) };
  if (lam) out.film.dried = statsOfA(mean('dried'));
  // the whole film's traces (all lines together, each line its equal share whatever its flakes' number) and their cut statistics
  const all = (cut, key = 'traces') => { const a = [], w = []; for (const l of out.lines) { a.push(...l[key][cut].angles); for (const x of l[key][cut].weights) w.push(x / l.nFlakes); } return { angles: a, weights: w }; };
  const cuts = key => { const m = all('md', key), c = all('cd', key);
    return { md: CO_O.orCutStats(m.angles, m.weights), cd: CO_O.orCutStats(c.angles, c.weights), mdHist: Array.from(CO_O.orHist(m.angles, m.weights)), cdHist: Array.from(CO_O.orHist(c.angles, c.weights)) }; };
  out.cuts = cuts('traces');
  if (lam) { out.cuts.dried = cuts('tracesDried'); out.collapse = lam; }
  out.hFilm = hFilm;
  return out;
}
/**
 * The FEM's fields orientAlong needs, from a solved result's post-processing grid (cfd-fem.js's coaterGrid: node
 * (column c, row k) at k nx + c) back in the FEM's own order (c NR + k): the alignment redone on a flow solved before.
 */
function orientFromGrid(g) {
  const NC = g.nx, NR = g.ny, N = NC * NR, back = a => { const out = new Float64Array(N); for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) out[c * NR + k] = a[k * NC + c]; return out; };
  return { NC, NR, x: back(g.gx), y: back(g.gy), u: back(g.u), v: back(g.v), psi: back(g.psi), mu: back(g.mu), tauXX: back(g.tauXX), tauXY: back(g.tauXY), tauYY: back(g.tauYY), omega: back(g.omega) };
}

/**
 * orientAlong's result, compact (for the worker's message): per line its statistics, its cuts' statistics and
 * histograms, and a sample of its traces (the first nSample flakes' angles and weights, to draw a cross-section).
 */
function orientCompact(res, { nSample = 200 } = {}) {
  // (rounded to what is shown and used: moments to 1e-4, angles to 0.01°, weights to 0.001, shares to 5 figures,
  // places to 6 figures -- a project with four locations stays small; the statistics are taken before rounding)
  const r4 = x => Math.round(x * 1e4) / 1e4, r2 = x => Math.round(x * 100) / 100, p6 = x => +(+x).toPrecision(6), p5 = x => +(+x).toPrecision(5);
  const st = s => ({ A: Array.from(s.A, r4), S: r4(s.S), Sy: r4(s.Sy), angle: r2(s.angle) });
  const cs = c => ({ S2: r4(c.S2), mean: r2(c.mean), spread: r2(c.spread), n: c.n });
  const cut = t => ({ ...cs(CO_O.orCutStats(t.angles, t.weights)), hist: Array.from(CO_O.orHist(t.angles, t.weights), p5),
    sample: { angles: Array.from(t.angles.slice(0, nSample), r2), weights: Array.from(t.weights.slice(0, nSample), x => Math.round(x * 1000) / 1000) } });
  const fs = s => ({ ...st(s), n: Array.from(s.n, r4), eig: Array.from(s.eig, r4) });
  // (dried: its statistics and histograms; its drawn traces follow from the oven's sample, tan θ' = lam tan θ)
  const cutD = t => ({ ...cs(CO_O.orCutStats(t.angles, t.weights)), hist: Array.from(CO_O.orHist(t.angles, t.weights), p5) });
  const cutsOf = c => ({ md: cs(c.md), cd: cs(c.cd), mdHist: c.mdHist.map(p5), cdHist: c.cdHist.map(p5) });
  return {
    lines: res.lines.map(l => ({ f: l.f, yOut: p6(l.yOut), depth: r4(l.depth), how: l.how, nFlakes: l.nFlakes, tPath: p5(l.tPath), tRested: p5(l.tRested),
      start: { ...st(l.start), turning: l.start.turning, turn: l.start.turn, groups: l.start.groups, settled: l.start.settled, gd: p5(l.start.gd) },
      out: st(l.out), oven: st(l.oven), samples: l.samples.map(q => ({ x: p6(q.x), y: p6(q.y), A: q.A.map(r4) })), md: cut(l.traces.md), cd: cut(l.traces.cd),
      ...(l.dried ? { dried: st(l.dried), mdD: cutD(l.tracesDried.md), cdD: cutD(l.tracesDried.cd) } : {}) })),
    film: { out: fs(res.film.out), oven: fs(res.film.oven), ...(res.film.dried ? { dried: fs(res.film.dried) } : {}) },
    cuts: { ...cutsOf(res.cuts), ...(res.cuts.dried ? { dried: cutsOf(res.cuts.dried) } : {}) },
    hFilm: p6(res.hFilm), stats: res.stats, ...(res.collapse ? { collapse: r4(res.collapse) } : {}),
  };
}
/** orStats from a second moment A alone (the film's mean). */
function statsOfA(A) {
  const e = CO_O.orEig(A), nv = e.vectors[0], sgn = nv[1] < 0 ? -1 : 1;
  return { A: Array.from(A), S: (3 * e.values[0] - 1) / 2, n: nv.map(x => x * sgn), angle: Math.atan2(sgn * nv[0], sgn * nv[1]) * 180 / Math.PI, Sy: (3 * A[4] - 1) / 2, eig: e.values };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { orientGradients, orientPaths, orMerge, orientRest, orientStart, orientAlong, orientCompact, orientFromGrid, orCollapse };
