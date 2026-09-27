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

if (typeof module !== 'undefined' && module.exports) module.exports = { structField, structLamAt, structColumn, solveCoaterStruct };
