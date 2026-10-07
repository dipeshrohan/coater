'use strict';
/*
 * cfd-struct.js — the structure (thixotropy) along a solved 2D flow (GO-1). lambda at every node of the result's
 * node grid (NC x NR, as solveFEM returns it), carried along the streamlines:
 *   D lambda / Dt = (1 - lambda) / tb - lambda gd / (gdc tb)                     (rheo.js)
 * Each node's streamline is traced back, in the mesh's own grid coordinates (bilinear in each cell of the node
 * grid, the velocity turned to grid rates through the cell's Jacobian; midpoint steps a quarter of a cell long
 * and at most a tenth of tb / (1 + gd / gdc), each piece at the shear rate of its end nearer the node),
 * to where it entered the domain (the inlet, c = 0: the slurry arrives there steady at the inlet's shear rate, as
 * the fully developed inflow it is taken to be, unless lamIn says otherwise) or until its memory has faded
 * (the elapsed (1 + gd / gdc) t / tb above 15: then it started steady at the shear rate there). lambda is then
 * carried forward along the traced path exactly, piece by piece at each piece's shear rate (rheo.js's update).
 * Where the flow stands still (the blade's wall), lambda is steady at the local shear rate.
 */
const CS_R = typeof rheoLamStep === 'function' ? { rheoLamStep, rheoLamEq, rheoMuStruct } : require('./rheo.js');

/**
 * lambda at the nodes of r (NC, NR, x, y, u, v, gd; node n = c NR + k). S = { tb, gdc, ... }.
 * opts: lamIn (lambda entering at the inlet; default steady there), h (step, in cells; default 0.25), memory
 * (default 15), maxSteps (per node; default 20000). Returns { lam (Float64Array), stats { steps, inlet, faded, still } }.
 */
function structField(r, S, opts = {}) {
  const NC = r.NC, NR = r.NR, X = r.x, Y = r.y, U = r.u, V = r.v, G = r.gd, N = NC * NR;
  const h = opts.h ?? 0.25, memory = opts.memory ?? 15, maxSteps = opts.maxSteps ?? 20000;
  const lamIn = opts.lamIn ?? null;
  const id = (c, k) => c * NR + k;
  // at grid point (xi, eta): x, y, the grid rates (dxi/dt, deta/dt) and the shear rate
  const at = (xi, eta, out) => {
    const c = Math.min(NC - 2, Math.max(0, Math.floor(xi))), k = Math.min(NR - 2, Math.max(0, Math.floor(eta)));
    const s = xi - c, t = eta - k, a = id(c, k), b = id(c + 1, k), d = id(c, k + 1), e = id(c + 1, k + 1);
    const w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = (1 - s) * t, w3 = s * t;
    const u = w0 * U[a] + w1 * U[b] + w2 * U[d] + w3 * U[e], v = w0 * V[a] + w1 * V[b] + w2 * V[d] + w3 * V[e];
    const xs = (1 - t) * (X[b] - X[a]) + t * (X[e] - X[d]), xt = (1 - s) * (X[d] - X[a]) + s * (X[e] - X[b]);
    const ys = (1 - t) * (Y[b] - Y[a]) + t * (Y[e] - Y[d]), yt = (1 - s) * (Y[d] - Y[a]) + s * (Y[e] - Y[b]);
    const J = xs * yt - xt * ys;
    out.gd = w0 * G[a] + w1 * G[b] + w2 * G[d] + w3 * G[e];
    if (!(Math.abs(J) > 1e-300)) { out.ok = false; return out; }
    out.ok = true; out.xi = (yt * u - xt * v) / J; out.eta = (xs * v - ys * u) / J;
    return out;
  };
  const lam = new Float64Array(N), p1 = {}, p2 = {};
  const segDt = new Float64Array(maxSteps + 1), segGd = new Float64Array(maxSteps + 1);
  const stats = { steps: 0, inlet: 0, faded: 0, still: 0 };
  for (let c0 = 0; c0 < NC; c0++) for (let k0 = 0; k0 < NR; k0++) {
    let xi = c0, eta = k0, n = 0, mem = 0, start = null;
    for (;;) {
      if (xi <= 1e-12) { at(0, eta, p1); start = lamIn ?? CS_R.rheoLamEq(p1.gd, S); stats.inlet++; break; }   // (entered at the inlet)
      at(xi, eta, p1);
      const sp = p1.ok ? Math.max(Math.abs(p1.xi), Math.abs(p1.eta)) : 0;
      if (!(sp > 1e-12) || n >= maxSteps) { start = CS_R.rheoLamEq(p1.gd, S); stats.still++; break; }    // (standing still: steady here)
      // midpoint step back, a quarter of a cell -- and no longer than a tenth of the structure's own time there, so
      // where the flow is nearly still (a corner by the contact line) the memory is followed finely, not in leaps
      let dt = Math.min(h / sp, 0.1 * S.tb / (1 + Math.abs(p1.gd) / S.gdc));
      at(xi - 0.5 * dt * p1.xi, Math.min(NR - 1, Math.max(0, eta - 0.5 * dt * p1.eta)), p2);
      if (!p2.ok) { start = CS_R.rheoLamEq(p1.gd, S); stats.still++; break; }
      let nxi = xi - dt * p2.xi, neta = eta - dt * p2.eta;
      if (nxi < 0) { const f = xi / (xi - nxi); dt *= f; nxi = 0; neta = eta + f * (neta - eta); }   // (the inlet: the step cut there)
      neta = Math.min(NR - 1, Math.max(0, neta));
      if (nxi > NC - 1) nxi = NC - 1;
      // (the piece's shear rate: at its end nearer the node -- the node's own for the first, so a structure that
      // forgets fast is steady at the node's shear rate exactly)
      segDt[n] = dt; segGd[n] = p1.gd; n++;
      mem += (1 + Math.abs(p1.gd) / S.gdc) * dt / S.tb;
      xi = nxi; eta = neta;
      if (mem > memory) { at(xi, eta, p1); start = CS_R.rheoLamEq(p1.gd, S); stats.faded++; break; }       // (its memory faded: steady there)
    }
    // forward along the path, exactly piece by piece
    let l = start;
    for (let j = n - 1; j >= 0; j--) l = CS_R.rheoLamStep(l, segGd[j], segDt[j], S);
    lam[id(c0, k0)] = l;
    stats.steps += n;
  }
  return { lam, stats };
}

/** lambda as a function of dimensional positions, from a result r with its field lam: for solveFEM's lamAt. */
const structLamAt = (r, lam) => (X, Y) => femInterpolate({ NC: r.NC, NR: r.NR, x: r.x, y: r.y, lam }, X, Y, ['lam']).lam;

/**
 * lambda flux weighted across column c of r's node grid (the metering edge's, the film's end): the mean over the flow
 * through the column, u dy - v dx along it (trapezoid between its nodes).
 */
function structColumn(r, lam, c) {
  let num = 0, den = 0;
  for (let k = 0; k < r.NR - 1; k++) {
    const a = c * r.NR + k, b = a + 1, dy = r.y[b] - r.y[a], dx = r.x[b] - r.x[a];
    const fa = r.u[a] * dy - r.v[a] * dx, fb = r.u[b] * dy - r.v[b] * dx;
    num += (lam[a] * fa + lam[b] * fb) / 2; den += (fa + fb) / 2;
  }
  return num / den;
}

/**
 * The coating flow with the structure fed back (outer iterations): the flow with the steady law first (lambda
 * steady everywhere), then lambda carried along it and the flow's final solve repeated warm with the viscosity
 * at that lambda (refineCoaterFEM: the contact line as that solve leaves it), and so on until the film changes
 * by less than tolQ (5e-4) two flows in a row and lambda's deviation from steady by less than tol (0.02, root
 * mean square over the nodes: by a contact line up the face, the corner's singular shear rates keep a little
 * noise in it), or maxOuter (10)
 * flows; then, where it can change the answer (not settled; a contact line held at the edge that would now
 * climb; a shaped blade's corners), the whole coating flow once more with the structure it settled to, and
 * lambda carried along the flow kept. Each new deviation is taken
 * part way from the one before (Aitken's relaxation from the last two changes, starting at relax 0.5, kept within
 * 0.1 .. 1): fed back in full the film swings about its value, and along a long converging entry (the round
 * entry) or by a contact line up the face the swing grows.
 * The flow is handed lambda's deviation from steady at each node (lambda - lambda_e(gd)), smoother than lambda
 * itself; at each integration point lambda = lambda_e(gd there) + the deviation, so a structure that is steady
 * everywhere gives the steady law exactly.
 * fo: solveCoaterFEM's options (mu: the steady law); S: the structure's values; law: rheo.js's compiled law.
 * hooks.onOuter(k, info) before each flow after the first ('final' for the last). Returns the final flow's result
 * with lam (lambda at its nodes, carried along its own flow) and struct { outer, change (rms), changeMax,
 * history: [{ k, change, changeMax, Q }], converged, finalQ }.
 */
function solveCoaterStruct(fo, S, law, { tol = 0.02, tolQ = 5e-4, maxOuter = 10, relax = 0.5, onOuter } = {}) {
  const clamp = l => l < 0 ? 0 : l > 1 ? 1 : l;
  const muL = (gd, d) => CS_R.rheoMuStruct(gd, clamp(CS_R.rheoLamEq(gd, S) + d), law, S);
  const devOf = (r, lam) => lam.map((l, n) => l - CS_R.rheoLamEq(r.gd[n], S));
  const hooks = { onIteration: fo.onIteration, onSolveStart: fo.onSolveStart, onSolveEnd: fo.onSolveEnd };
  let r = solveCoaterFEM(fo);
  if (!r.x || r.error) return r;
  // (the iterated variable is the deviation the flow is handed: where the slurry stands still, lambda is steady at
  // the local shear rate and its deviation 0, however that shear rate moves between flows)
  let dev = devOf(r, structField(r, S).lam), change = Infinity, changeMax = Infinity, dQ = Infinity, k = 1, w = relax, resPrev = null;
  let devGiven = new Float64Array(dev.length);   // (the deviation the last flow was solved with: none, the first)
  const history = [{ k: 1, change: null, changeMax: null, Q: r.Q }];
  let dQprev = Infinity;
  while (k < maxOuter && (change > tol || dQ > tolQ || dQprev > tolQ)) {
    k++;
    if (onOuter) onOuter(k, { change, changeMax });
    const extra = { ...hooks, muL, lamAt: structLamAt(r, dev), maxIter: 30, label: `structure, flow ${k}: final solve again, warm` };
    // (warm: the last flow's final solve; failing that, the whole coating flow)
    let r2 = refineCoaterFEM(r, extra), whole = false, half = false;
    if (!r2 || !r2.x || r2.error) {
      // (warm, half way from the structure the last flow was solved with; then the whole coating flow)
      const devHalf = dev.map((d, n) => devGiven[n] + 0.5 * (d - devGiven[n]));
      const r3 = refineCoaterFEM(r, { ...extra, lamAt: structLamAt(r, devHalf), label: `structure, flow ${k}: final solve again, warm, half way` });
      if (r3 && r3.x && !r3.error) { r2 = r3; half = true; dev = devHalf; }
      else { whole = r2 ? r2.error || 'no solution' : 'no final solve kept'; r2 = solveCoaterFEM({ ...fo, muL, lamAt: extra.lamAt }); }
    }
    if (!r2.x || r2.error) { r.struct = { outer: k - 1, change, changeMax, history, converged: false, error: r2.error || 'no solution' }; r.lam = structField(r, S).lam; return r; }
    const dev2 = devOf(r2, structField(r2, S).lam), before = structLamAt(r, dev)(r2.x, r2.y);
    const res = dev2.map((l, n) => l - before[n]);
    let s2 = 0; changeMax = 0;
    for (const d of res) { s2 += d * d; if (Math.abs(d) > changeMax) changeMax = Math.abs(d); }
    change = Math.sqrt(s2 / res.length); dQprev = dQ; dQ = Math.abs(r2.Q / r.Q - 1);
    // (Aitken: the relaxation from the last two residuals, on the same nodes -- a whole-flow fallback may not keep them)
    if (resPrev && resPrev.length === res.length) {
      let num = 0, den = 0;
      for (let n = 0; n < res.length; n++) { const d = res[n] - resPrev[n]; num += resPrev[n] * d; den += d * d; }
      if (den > 0) w = Math.min(1, Math.max(0.1, -w * num / den));
    }
    resPrev = half ? null : res;
    r = r2; devGiven = before; dev = before.map((b, n) => b + w * res[n]);
    history.push({ k, change, changeMax, Q: r.Q, relax: w, ...(whole ? { whole } : {}), ...(half ? { half } : {}) });
  }
  const converged = change <= tol && dQ <= tolQ && dQprev <= tolQ;
  // the whole coating flow with the settled structure, where it can change the answer: the iterations did not
  // settle, a contact line pinned at the edge now leaves it steeply enough to climb, or a shaped blade (its
  // corners: the contact line may belong at another); else the last warm solve stands (its contact line free on
  // the face, or held at the edge where it still belongs)
  const m = r.meniscus || {}, shaped = r.meshInfo && r.meshInfo.k != null;
  const needWhole = !converged || shaped || (m.mode === 'pinned' && !(m.leaveDeg <= m.alphaMaxDeg + 1e-9));
  let out = r, rf = null;
  if (needWhole && k > 1) {
    if (onOuter) onOuter('final', { change, changeMax });
    rf = solveCoaterFEM({ ...fo, muL, lamAt: structLamAt(r, dev) });
    if (rf.x && !rf.error) out = rf;
  }
  out.lam = structField(out, S).lam;   // (the result shows the structure its own flow carries)
  out.struct = { outer: k, change, changeMax, history, converged, whole: !!rf, finalQ: rf && rf.x && !rf.error ? rf.Q : null, ...(rf && rf.error ? { finalError: rf.error } : {}) };
  return out;
}

// ---- the structure in time (T-2b): lambda carried by a moving, changing flow ----

/**
 * A result's node grid as a coordinate system: at(xi, eta, out) gives the position, the velocity in grid rates (as
 * structField's) and the shear rate at grid point (xi, eta), bilinear in each cell of the node grid; locate(px, py, c, k)
 * the grid point at a position (Newton in the cell, from node (c, k)'s cells outward, then any cell holding it; outside
 * the mesh: the nearest node's, inside false).
 */
function structGrid(r) {
  const NC = r.NC, NR = r.NR, X = r.x, Y = r.y, U = r.u, V = r.v, G = r.gd, id = (c, k) => c * NR + k;
  const cell = (xi, eta) => [Math.min(NC - 2, Math.max(0, Math.floor(xi))), Math.min(NR - 2, Math.max(0, Math.floor(eta)))];
  function at(xi, eta, out) {
    const [c, k] = cell(xi, eta), s = xi - c, t = eta - k, a = id(c, k), b = id(c + 1, k), d = id(c, k + 1), e = id(c + 1, k + 1);
    const w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = (1 - s) * t, w3 = s * t;
    const u = w0 * U[a] + w1 * U[b] + w2 * U[d] + w3 * U[e], v = w0 * V[a] + w1 * V[b] + w2 * V[d] + w3 * V[e];
    const xs = (1 - t) * (X[b] - X[a]) + t * (X[e] - X[d]), xt = (1 - s) * (X[d] - X[a]) + s * (X[e] - X[b]);
    const ys = (1 - t) * (Y[b] - Y[a]) + t * (Y[e] - Y[d]), yt = (1 - s) * (Y[d] - Y[a]) + s * (Y[e] - Y[b]);
    const J = xs * yt - xt * ys;
    out.x = w0 * X[a] + w1 * X[b] + w2 * X[d] + w3 * X[e]; out.y = w0 * Y[a] + w1 * Y[b] + w2 * Y[d] + w3 * Y[e];
    out.gd = w0 * G[a] + w1 * G[b] + w2 * G[d] + w3 * G[e];
    if (!(Math.abs(J) > 1e-300)) { out.ok = false; out.xi = out.eta = 0; return out; }
    out.ok = true; out.xi = (yt * u - xt * v) / J; out.eta = (xs * v - ys * u) / J;
    return out;
  }
  const value = (f, xi, eta) => {
    const [c, k] = cell(xi, eta), s = xi - c, t = eta - k;
    return (1 - s) * (1 - t) * f[id(c, k)] + s * (1 - t) * f[id(c + 1, k)] + (1 - s) * t * f[id(c, k + 1)] + s * t * f[id(c + 1, k + 1)];
  };
  // the point in cell (c, k): Newton on the bilinear map; null when it is not in it
  const inCell = (c, k, px, py) => {
    const a = id(c, k), b = id(c + 1, k), d = id(c, k + 1), e = id(c + 1, k + 1);
    const ax = X[a], ay = Y[a], bx = X[b] - ax, by = Y[b] - ay, cx = X[d] - ax, cy = Y[d] - ay, dx = X[e] - X[b] - X[d] + ax, dy = Y[e] - Y[b] - Y[d] + ay;
    let s = 0.5, t = 0.5;
    for (let it = 0; it < 12; it++) {
      const Fx = ax + bx * s + cx * t + dx * s * t - px, Fy = ay + by * s + cy * t + dy * s * t - py;
      const a11 = bx + dx * t, a12 = cx + dx * s, a21 = by + dy * t, a22 = cy + dy * s, det = a11 * a22 - a12 * a21;
      if (!(Math.abs(det) > 0)) return null;
      const ds = (a22 * Fx - a12 * Fy) / det, dt = (a11 * Fy - a21 * Fx) / det;
      s -= ds; t -= dt;
      if (Math.abs(ds) + Math.abs(dt) < 1e-13) break;
    }
    return s > -1e-7 && s < 1 + 1e-7 && t > -1e-7 && t < 1 + 1e-7 ? [c + Math.min(1, Math.max(0, s)), k + Math.min(1, Math.max(0, t))] : null;
  };
  let bins = null, x0, x1, y0, y1;
  const nb = 48;
  const binOf = (px, py) => Math.min(nb - 1, Math.max(0, Math.floor((py - y0) / (y1 - y0) * nb))) * nb + Math.min(nb - 1, Math.max(0, Math.floor((px - x0) / (x1 - x0) * nb)));
  function locate(px, py, c0 = null, k0 = null) {
    if (c0 != null) for (let ring = 0; ring <= 2; ring++)
      for (let c = Math.max(0, c0 - 1 - ring); c <= Math.min(NC - 2, c0 + ring); c++) for (let k = Math.max(0, k0 - 1 - ring); k <= Math.min(NR - 2, k0 + ring); k++) {
        if (ring && c > c0 - 1 - ring && c < c0 + ring && k > k0 - 1 - ring && k < k0 + ring) continue;
        const g = inCell(c, k, px, py);
        if (g) return { xi: g[0], eta: g[1], inside: true };
      }
    if (!bins) {
      x0 = Infinity; x1 = -Infinity; y0 = Infinity; y1 = -Infinity;
      for (let n = 0; n < X.length; n++) { x0 = Math.min(x0, X[n]); x1 = Math.max(x1, X[n]); y0 = Math.min(y0, Y[n]); y1 = Math.max(y1, Y[n]); }
      bins = Array.from({ length: nb * nb }, () => []);
      for (let c = 0; c < NC - 1; c++) for (let k = 0; k < NR - 1; k++) {
        const q = [id(c, k), id(c + 1, k), id(c, k + 1), id(c + 1, k + 1)];
        const bx0 = binOf(Math.min(...q.map(n => X[n])), Math.min(...q.map(n => Y[n]))), bx1 = binOf(Math.max(...q.map(n => X[n])), Math.max(...q.map(n => Y[n])));
        for (let j = Math.floor(bx0 / nb); j <= Math.floor(bx1 / nb); j++) for (let i = bx0 % nb; i <= bx1 % nb; i++) bins[j * nb + i].push(c * NR + k);
      }
    }
    for (const cl of bins[binOf(px, py)]) { const g = inCell(Math.floor(cl / NR), cl % NR, px, py); if (g) return { xi: g[0], eta: g[1], inside: true }; }
    let best = 0, bd = Infinity;
    for (let n = 0; n < X.length; n++) { const q = (X[n] - px) ** 2 + (Y[n] - py) ** 2; if (q < bd) { bd = q; best = n; } }
    return { xi: Math.floor(best / NR), eta: best % NR, inside: false };
  }
  return { at, value, locate, NC, NR };
}

/**
 * The structure in femMarch (cfd-fem-time.js's carry): lambda, the slurry's own state, carried with it in time.
 * lambda at a point at time T is the slurry's memory along its own path: the path is traced back through the flows of
 * the march (each step's flow; between two kept flows the mean of the two, node by node) to where it was at the start
 * (lambda there: the starting field, interpolated), or to where it came in through the inlet (lambda steady at the
 * inlet's shear rate there, as the steady structure's inflow), or until its memory has faded ((1 + gd / gdc) t / tb
 * above `memory`, default 15: then steady at the shear rate there); lambda is then carried forward along the path
 * exactly, piece by piece at each piece's shear rate (rheoLamStep). The path is followed as structField follows a
 * steady flow's streamline (midpoint steps of `h`, default a quarter of a cell, and at most a tenth of the structure's
 * own time there; each piece at the shear rate of its end nearer the point), so along a steady flow the march finds
 * the steady solve's own lambda and a steady start stays as it is; lambda is never re-interpolated from step to step
 * (no numerical diffusion).
 * The flows kept for this thin out with their age (two kept flows at most keepRel, default 0.1, of their age apart).
 * The flow of a step is solved with lambda as the steady solve has it (the law at lambda_e(gd) + the deviation, at the
 * nodes: solveCoaterStruct's representation): the deviation predicted with the flow before the step continued over it,
 * then lambda along the step's own flow and, where it differs from what the solve was handed by more than tolLam
 * (default 0.01), the step solved once more with it. Where a dividing streamline passes -- an eddy under the meniscus
 * and the film leaving it -- a node holds slurry from one side or the other as the flow breathes, and its lambda jumps
 * from step to step below what the mesh resolves: the deviation the solve is handed is held within clip (default 0.01)
 * of the mean over the node's element-wide neighbourhood (binomial weights; opts.filter false: not at all). A smooth
 * field passes unchanged; it is applied afresh each step to lambda traced exactly, so nothing builds up in time; r.lam
 * is lambda as the flow had it.
 * S: the structure's values; law: rheo.js's compiled law.
 */
function structMarch(S, law, opts = {}) {
  const clamp = l => l < 0 ? 0 : l > 1 ? 1 : l, tolLam = opts.tolLam ?? 0.01, memory = opts.memory ?? 15, keepRel = opts.keepRel ?? 0.1, hCell = opts.h ?? 0.25;
  const muL = (gd, d) => CS_R.rheoMuStruct(gd, clamp(CS_R.rheoLamEq(gd, S) + d), law, S);
  const avg = (a, b) => { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = 0.5 * (a[i] + b[i]); return o; };
  const entry = (r, t) => ({ t, NC: r.NC, NR: r.NR, x: r.x, y: r.y, u: r.u, v: r.v, gd: r.gd, g: null, gPair: null });
  const gridOf = e => e.g || (e.g = structGrid(e));
  // the flow over the interval from kept flow a to the next, b: their mean node by node (the same mesh's nodes), else b's
  const pairGrid = (a, b) => b.gPair || (b.gPair = a.NC === b.NC && a.NR === b.NR
    ? structGrid({ NC: b.NC, NR: b.NR, x: avg(a.x, b.x), y: avg(a.y, b.y), u: avg(a.u, b.u), v: avg(a.v, b.v), gd: avg(a.gd, b.gd) }) : gridOf(b));
  let hist = [], g0 = null, lam0 = null;   // (the kept flows, oldest first; the start's grid and lambda)
  const p1 = {}, p2 = {};
  let segD = new Float64Array(4096), segG = new Float64Array(4096);
  const grow = () => { const d = new Float64Array(segD.length * 2), g = new Float64Array(segG.length * 2); d.set(segD); g.set(segG); segD = d; segG = g; };
  /** lambda at points (X, Y) at time T; first: { g, len } the newest stretch (T back to the newest kept flow), or null (T is its time). */
  function trace(X, Y, first, hint) {
    const n = X.length, out = new Float64Array(n);
    const spans = [];
    if (first && first.len > 0) spans.push(first);
    for (let j = hist.length - 1; j > 0; j--) { const len = hist[j].t - hist[j - 1].t; if (len > 0) spans.push({ g: pairGrid(hist[j - 1], hist[j]), len }); }
    for (let m = 0; m < n; m++) {
      let px = X[m], py = Y[m], hc = hint ? hint(m)[0] : null, hk = hint ? hint(m)[1] : null, start = null, nseg = 0, mem = 0;
      for (const sp of spans) {
        const g = sp.g, L = g.locate(px, py, hc, hk);
        let xi = L.xi, eta = L.eta, rem = sp.len;
        while (rem > 1e-12 * sp.len) {
          g.at(xi, eta, p1);
          const v = p1.ok ? Math.max(Math.abs(p1.xi), Math.abs(p1.eta)) : 0, rate = (1 + Math.abs(p1.gd) / S.gdc) / S.tb;
          let d = Math.min(rem, v > 0 ? hCell / v : rem, 0.1 / rate);
          g.at(xi - 0.5 * d * p1.xi, Math.min(g.NR - 1, Math.max(0, eta - 0.5 * d * p1.eta)), p2);
          if (!p2.ok) { p2.xi = p1.xi; p2.eta = p1.eta; }
          let nxi = xi - d * p2.xi, neta = eta - d * p2.eta;
          if (nseg >= segD.length) grow();
          if (nxi < 0) {
            const f = xi / (xi - nxi); d *= f; neta = eta + f * (neta - eta);
            segD[nseg] = d; segG[nseg] = p1.gd; nseg++;
            g.at(0, Math.min(g.NR - 1, Math.max(0, neta)), p1);
            start = opts.lamIn ?? CS_R.rheoLamEq(p1.gd, S);
            break;
          }
          segD[nseg] = d; segG[nseg] = p1.gd; nseg++;
          mem += (1 + Math.abs(p1.gd) / S.gdc) * d / S.tb;
          xi = Math.min(g.NC - 1, nxi); eta = Math.min(g.NR - 1, Math.max(0, neta)); rem -= d;
          if (mem > memory) { g.at(xi, eta, p1); start = CS_R.rheoLamEq(p1.gd, S); break; }
        }
        if (start != null) break;
        g.at(xi, eta, p1); px = p1.x; py = p1.y; hc = Math.round(xi); hk = Math.round(eta);
      }
      if (start == null) { const q = g0.locate(px, py, hc, hk); start = g0.value(lam0, q.xi, q.eta); }
      let l = start;
      for (let j = nseg - 1; j >= 0; j--) l = CS_R.rheoLamStep(l, segG[j], segD[j], S);
      out[m] = l;
    }
    return out;
  }
  const nodeHint = r => m => [Math.floor(m / r.NR), m % r.NR];
  // each node held within clip of the binomial (1 2 1) x (1 2 1) mean over its neighbours on the node grid
  const clip = opts.clip ?? 0.01;
  const smooth = (f, NC, NR) => {
    if (opts.filter === false) return f;
    const out = new Float64Array(f.length), w = [1, 2, 1];
    for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) {
      let s = 0, ws = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const cc = c + a, kk = k + b; if (cc < 0 || cc >= NC || kk < 0 || kk >= NR) continue; const q = w[a + 1] * w[b + 1]; s += q * f[cc * NR + kk]; ws += q; }
      const mean = s / ws, d = f[c * NR + k] - mean;
      out[c * NR + k] = mean + (d > clip ? clip : d < -clip ? -clip : d);
    }
    return out;
  };
  // lambda as the flow has it: the steady structure at each node's shear rate + the averaged deviation
  const asFlowHas = (r, lam) => { const dev = smooth(Float64Array.from(lam, (l, n) => l - CS_R.rheoLamEq(r.gd[n], S)), r.NC, r.NR); return Float64Array.from(dev, (d, n) => clamp(CS_R.rheoLamEq(r.gd[n], S) + d)); };
  const devAt = (r, lam) => {
    // (the deviation at r's nodes, interpolated to where the solve's nodes start)
    const dev = Float64Array.from(lam, (l, n) => l - CS_R.rheoLamEq(r.gd[n], S));
    return (X, Y) => { const g = r._sg || (r._sg = structGrid(r)); return Float64Array.from(X, (x, m) => { const q = g.locate(x, Y[m], Math.floor(m / r.NR), m % r.NR); return g.value(dev, q.xi, q.eta); }); };
  };
  // the kept flows thinned: a flow goes when its neighbours are close enough for its age
  const thin = tNow => {
    for (let j = hist.length - 2; j > 0; j--) if (hist[j + 1].t - hist[j - 1].t <= keepRel * (tNow - hist[j + 1].t)) { hist.splice(j, 1); hist[j].gPair = null; }
  };
  return {
    muL,
    /** The start (r0 at t0): its lambda (r0.lam, else carried along its own flow, steady: structField). */
    start: (r0, t0) => { lam0 = r0.lam || structField(r0, S).lam; g0 = structGrid(r0); hist = [entry(r0, t0)]; return lam0; },
    fixed: r => ({ muL, lamAt: devAt(r, r.lam) }),
    predict: (rPrev, tPrev, h) => {
      const e = hist[hist.length - 1], first = { g: gridOf(e), len: h };
      const lamAt = (X, Y) => {
        const lp = trace(X, Y, first, nodeHint(rPrev));
        // (the deviation from the steady structure at the shear rate the flow before had there, averaged)
        const g = gridOf(e);
        return (lamAt.last = smooth(lp.map((l, m) => { const q = g.locate(X[m], Y[m], Math.floor(m / rPrev.NR), m % rPrev.NR); return l - CS_R.rheoLamEq(g.value(rPrev.gd, q.xi, q.eta), S); }), rPrev.NC, rPrev.NR));
      };
      return { muL, lamAt };
    },
    correct: (rPrev, tPrev, r, h, devUsed) => {
      const e = hist[hist.length - 1], b = entry(r, tPrev + h);
      const lam = asFlowHas(r, trace(r.x, r.y, { g: pairGrid(e, b), len: h }, nodeHint(r)));
      let diff = 0;
      if (devUsed) for (let n = 0; n < lam.length; n++) diff = Math.max(diff, Math.abs(lam[n] - clamp(CS_R.rheoLamEq(r.gd[n], S) + devUsed[n])));
      return { lam, diff, again: devUsed && diff > tolLam ? { muL, lamAt: devAt(r, lam) } : null };
    },
    accept: (r, t) => { hist.push(entry(r, t)); thin(t); },
    /** A new mesh at time t (the march's newest state carried onto it): lambda at its nodes, and it kept from then on. */
    remap: (rFrom, rTo, t) => { const lam = asFlowHas(rTo, trace(rTo.x, rTo.y, null, null)); hist.push(entry(rTo, t)); return lam; },
    kept: () => hist.length,
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { structField, structLamAt, structColumn, solveCoaterStruct, structGrid, structMarch };
