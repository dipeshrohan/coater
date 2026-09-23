/*
 * cfd-gap-solver.js — steady 2D Navier-Stokes flow of a generalized-
 * Newtonian (Herschel-Bulkley) fluid in the coating gap between the moving
 * web (y = 0) and a blade surface y = h(x) of any shape: the flat land
 * (h constant) or the round entry converging onto the metering edge.
 * Pure computation, no DOM (same convention as physics.js).
 *
 * Why this replaced cfd-solver.js's solveChannelNSNonNewtonian: that
 * solver marched an approximate variable-viscosity vorticity equation in
 * explicit pseudo-time, with the time step limited by the largest
 * viscosity in the field. With a yield stress the unyielded core's
 * viscosity is thousands of times the flowing fluid's, so the step shrank
 * until every step changed almost nothing and its "per-step change below
 * tolerance" test passed on the unchanged starting field. (That starting
 * field was the exact 1D profile, which is the right answer for a flat
 * gap -- so the results shown were right, but the solve was not doing the
 * work.) This solver has neither weakness:
 *
 *  1. Exact equations, conservative form. The curl of the momentum
 *     equation rho Du/Dt = -grad p + div(tau), tau = 2 mu(gd) D, written
 *     for the streamfunction psi (u = psi_y, v = -psi_x) with nothing
 *     dropped for a viscosity that varies in space:
 *
 *       rho (u.grad) omega = (d_xx - d_yy) tau_xy - 2 d_xy (mu b)
 *       tau_xy = mu a,   a = psi_yy - psi_xx,   b = 2 psi_xy,
 *       omega = -lap psi,   gd = sqrt(a^2 + b^2)
 *
 *     The stresses are formed at the nodes and then differentiated, so the
 *     viscosity itself is never differentiated -- important where it jumps
 *     by orders of magnitude at the edge of an unyielded plug.
 *  2. Implicit Newton solve. All psi values are solved together (banded LU
 *     with partial pivoting): no time step, no stability limit. Because
 *     the viscosity at a node depends on psi only through that node's own
 *     strain (a, b), the exact Jacobian of the stress, d(s)/d(e) =
 *     mu I + (mu_t - mu) e e^T/|e|^2 with mu_t = d(tau)/d(gd), costs no
 *     extra bandwidth: this is true Newton for the rheology, quadratically
 *     convergent. A backtracking line search keeps it robust (a yield-
 *     stress fluid's stress jumps by 2 ty where the shear rate changes
 *     sign). Convergence is judged on the residual of the discrete
 *     equations themselves, not on how much one step changed.
 *
 * Geometry: a boundary-fitted ("sigma") grid, x = xi, eta = y/h(x) in
 * [0, 1]: node (i, j) at x_i = i dx, y = eta_j h(x_i). Columns are vertical
 * lines; rows follow the blade shape. All Cartesian derivatives are taken
 * with the exact chain rule, d/dx = d/dxi + eta_x d/deta, d/dy = (1/h)
 * d/deta, eta_x = -eta h'/h, eta_xx = eta (2h'^2 - h h'')/h^2 -- second-
 * order central differences in (xi, eta).
 *
 * Boundary conditions (ghost nodes one cell outside each boundary):
 *  - web (eta = 0): no slip, moving at U: psi = 0, psi_eta = U h.
 *  - blade (eta = 1): no slip, stationary: psi = Q (constant along a solid
 *    wall), psi_eta = 0 (then u = v = 0 on the sloped wall too).
 *  - inlet/outlet: 'developed' (zero streamwise gradient: the end column
 *    and its ghost repeat the first interior column), 'wall' (a stationary
 *    side wall, psi = 0, used by the lid-driven-cavity check), or
 *    { profile: (x, eta) => psi/Q } prescribed, used by the validation.
 *  - flow rate: either fixed (opts.Q), or found so that the pressure drop
 *    from inlet to outlet along the web equals opts.Pup. At a no-slip web
 *    the x-momentum balance reduces exactly to dp/dx = -d(mu omega)/dy, so
 *    Q is one extra unknown with this one extra equation (bordered solve).
 *
 * Yield stress: the Herschel-Bulkley viscosity ty/gd + ... is unbounded as
 * gd -> 0 (unyielded core). As in every viscous-regularization method the
 * law is evaluated at sqrt(gd^2 + gdMin^2) (default gdMin = 1e-3 U/H), so
 * the core is a fluid some hundreds of times more viscous than the flowing
 * fluid rather than a rigid solid; identical to the law wherever
 * gd >> gdMin. The validation checks results against the exact 1D yield-
 * stress solution and that they do not move when gdMin is reduced.
 */

// ---------------------------------------------------------------------
// Banded LU with partial pivoting (the LAPACK dgbtrf/dgbtrs scheme).
// Row-oriented storage: row r holds columns r-kl .. r+kl+ku (the extra kl
// for fill-in from row interchanges) at A[r*W + (c - r + kl)].
// ---------------------------------------------------------------------
function bandFactor(A, n, kl, ku) {
  const W = 2 * kl + ku + 1, piv = new Int32Array(n);
  // last stored column holding a nonzero, per row: rows are only ever
  // combined up to there, which skips the band's structural zeros (with
  // little pivoting the fill stays near ku, half the full kl+ku)
  const last = new Int32Array(n);
  for (let r = 0; r < n; r++) {
    let c = Math.min(n - 1, r + kl + ku);
    while (c > r && A[r * W + c - r + kl] === 0) c--;
    last[r] = c;
  }
  for (let k = 0; k < n; k++) {
    const iEnd = Math.min(n - 1, k + kl);
    let p = k, amax = Math.abs(A[k * W + kl]);
    for (let i = k + 1; i <= iEnd; i++) { const a = Math.abs(A[i * W + k - i + kl]); if (a > amax) { amax = a; p = i; } }
    piv[k] = p;
    if (amax === 0) throw new Error('singular matrix in the gap solve');
    if (p !== k) {
      const jEnd = Math.max(last[k], last[p]);
      for (let j = k; j <= jEnd; j++) {
        const a = A[k * W + j - k + kl]; A[k * W + j - k + kl] = A[p * W + j - p + kl]; A[p * W + j - p + kl] = a;
      }
      const t = last[k]; last[k] = last[p]; last[p] = t;
    }
    const rk = k * W - k + kl, d = A[rk + k], jEnd = last[k];
    for (let i = k + 1; i <= iEnd; i++) {
      const ri = i * W - i + kl;
      const a0 = A[ri + k];
      if (a0 === 0) continue;
      const m = a0 / d;
      A[ri + k] = m;
      for (let a = ri + k + 1, b = rk + k + 1, e = rk + jEnd; b <= e; a++, b++) A[a] -= m * A[b];
      if (jEnd > last[i]) last[i] = jEnd;
    }
  }
  return { piv, last };
}

function bandSolve(A, fac, n, kl, ku, b) {
  const W = 2 * kl + ku + 1, piv = fac.piv, last = fac.last;
  for (let k = 0; k < n; k++) {
    const p = piv[k];
    if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t; }
    const bk = b[k];
    if (bk === 0) continue;
    const iEnd = Math.min(n - 1, k + kl);
    for (let i = k + 1; i <= iEnd; i++) b[i] -= A[i * W + k - i + kl] * bk;
  }
  for (let k = n - 1; k >= 0; k--) {
    const rk = k * W - k + kl, jEnd = last[k];
    let s = b[k];
    for (let j = k + 1; j <= jEnd; j++) s -= A[rk + j] * b[j];
    b[k] = s / A[rk + k];
  }
  return b;
}

// ---------------------------------------------------------------------
// Sigma-grid finite-difference stencils. Each operator is a 3x3 weight
// array over (i+di, j+dj), index (dj+1)*3 + (di+1).
// ---------------------------------------------------------------------
function makeStencil(dx, de) {
  const w = new Float64Array(9);
  const ix2 = 1 / (dx * dx), ie2 = 1 / (de * de), ix = 1 / (2 * dx), ie = 1 / (2 * de), ixe = 1 / (4 * dx * de);
  /** Weights for cx F_xi + ce F_eta + cxx F_xixi + cee F_etaeta + cxe F_xieta. */
  return (cx, ce, cxx, cee, cxe) => {
    w.fill(0);
    w[5] += cx * ix; w[3] -= cx * ix;
    w[7] += ce * ie; w[1] -= ce * ie;
    w[5] += cxx * ix2; w[3] += cxx * ix2; w[4] -= 2 * cxx * ix2;
    w[7] += cee * ie2; w[1] += cee * ie2; w[4] -= 2 * cee * ie2;
    w[8] += cxe * ixe; w[0] += cxe * ixe; w[2] -= cxe * ixe; w[6] -= cxe * ixe;
    return w;
  };
}


/**
 * @param {object} opts
 * @param {number} opts.nx, opts.ny   grid nodes along x and across the gap (ny >= 7)
 * @param {number} opts.Lx            domain length (m); inlet at x = 0, outlet at x = Lx
 * @param {(x:number)=>number} opts.h     blade height above the web (m)
 * @param {(x:number)=>number} [opts.hx]  dh/dx (default 0)
 * @param {(x:number)=>number} [opts.hxx] d2h/dx2 (default 0)
 * @param {number} opts.U             web speed (m/s)
 * @param {number} [opts.Ublade=0]    blade speed (m/s, only for the cavity check; needs h' = 0)
 * @param {number} opts.rho           density (kg/m^3)
 * @param {(gd:number)=>number} opts.mu  viscosity (Pa.s) at shear rate gd (1/s)
 * @param {number} [opts.gdMin]       regularization shear rate (1/s)
 * @param {number} [opts.Q]           fixed flow rate per unit width (m^2/s) ...
 * @param {number} [opts.Pup]         ... or the inlet-to-outlet pressure drop (Pa) to match
 * @param {string|object} [opts.inlet='developed'], [opts.outlet='developed']
 * @param {number} [opts.tol=1e-9]    residual tolerance (relative, per equation)
 * @param {number} [opts.maxIter=60]
 */
function solveGapFlow(opts) {
  const nx = opts.nx, ny = opts.ny, N = nx * ny;
  if (ny < 7 || nx < 5) throw new Error('grid too small');
  const hFn = opts.h, hxFn = opts.hx || (() => 0), hxxFn = opts.hxx || (() => 0);
  const Lx = opts.Lx, U = opts.U || 0, Ub = opts.Ublade || 0, rho = opts.rho;
  const fixedQ = opts.Q != null;
  const tol = opts.tol ?? 1e-6, maxIter = opts.maxIter ?? 200;

  // ---- reference scales; the solve runs in these units ----
  const Hr = opts.Hr ?? hFn(Lx);
  const Ur = opts.Ur ?? (Math.abs(U) > 0 ? Math.abs(U) : Math.abs(Ub) > 0 ? Math.abs(Ub) : Math.abs(opts.Q || 0) / Hr || 1);
  const gdRef = Ur / Hr, muR = opts.mu(gdRef);
  const epsTarget = (opts.gdMin ?? 1e-3 * gdRef) / gdRef;
  let eps = epsTarget;
  // continuation parameter: the law used is mu_ref^(1-s) mu(gd)^s, s = 0 a
  // Newtonian fluid, s = 1 the real rheology
  let sHom = 1;
  const muLaw = gd => opts.mu(Math.sqrt(gd * gd + eps * eps) * gdRef) / muR;
  const muStar = gd => sHom === 1 ? muLaw(gd) : Math.pow(muLaw(gd), sHom);
  const muTangent = gd => {           // d(mu gd)/d(gd), the tangent viscosity
    if (!(gd > 0)) return muStar(0);
    const d = 1e-5, a = gd * (1 + d), b = gd * (1 - d);
    return (muStar(a) * a - muStar(b) * b) / (a - b);
  };
  const Re = rho * Ur * Hr / muR, Us = U / Ur, Ubs = Ub / Ur;
  const dx = Lx / (nx - 1) / Hr, de = 1 / (ny - 1);
  const hs = new Float64Array(nx), hp = new Float64Array(nx), hpp = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const x = i * Lx / (nx - 1);
    hs[i] = hFn(x) / Hr; hp[i] = hxFn(x); hpp[i] = hxxFn(x) * Hr;
  }
  const PupStar = fixedQ ? 0 : opts.Pup * Hr / (muR * Ur);
  const endOf = spec => typeof spec === 'string' ? { type: spec } : { type: 'profile', f: spec.profile, base: spec.base || (() => 0) };
  const inlet = endOf(opts.inlet || 'developed'), outlet = endOf(opts.outlet || 'developed');

  // ---- unknowns: psi at interior nodes, column-major; Q bordered ----
  const nI = ny - 2, NU = (nx - 2) * nI;
  const uid = (i, j) => (i - 1) * nI + (j - 1);

  // psi at any node of the grid extended by one ghost layer, as an affine
  // function of the unknowns: psi = a * x[idx] + qc * Q + c (idx -1: none)
  const EW = nx + 2, EH = ny + 2, EN = EW * EH;
  const rIdx = new Int32Array(EN).fill(-1), rA = new Float64Array(EN), rQ = new Float64Array(EN), rC = new Float64Array(EN);
  const eid = (i, j) => (i + 1) * EH + (j + 1);
  const hAt = i => hs[Math.min(nx - 1, Math.max(0, i))];
  function ref(i, j) {
    const end = i <= 0 ? inlet : i >= nx - 1 ? outlet : null;
    if (end && end.type === 'profile') return [-1, 0, end.f(i * dx * Hr, j * de), end.base(i * dx * Hr, j * de) / (Ur * Hr)];
    if (j < 0) { const r = ref(i, 1); return [r[0], r[1], r[2], r[3] - 2 * de * Us * hAt(i)]; }
    if (j > ny - 1) { const r = ref(i, ny - 2); return [r[0], r[1], r[2], r[3] + 2 * de * Ubs * hAt(i)]; }
    if (end && end.type === 'developed') return ref(i <= 0 ? 1 : nx - 2, j);
    if (end && end.type === 'wall') return (i === 0 || i === nx - 1) ? [-1, 0, 0, 0] : ref(i < 0 ? -i : 2 * (nx - 1) - i, j);
    if (j === 0) return [-1, 0, 0, 0];
    if (j === ny - 1) return [-1, 0, 1, 0];
    return [uid(i, j), 1, 0, 0];
  }
  for (let i = -1; i <= nx; i++) for (let j = -1; j <= ny; j++) {
    const r = ref(i, j), k = eid(i, j);
    rIdx[k] = r[0]; rA[k] = r[1]; rQ[k] = r[2]; rC[k] = r[3];
  }

  // ---- operator weights at every real node (3x3 over (i+di, j+dj), slot (dj+1)*3+(di+1)) ----
  const stencil = makeStencil(dx, de);
  const OA = new Float64Array(N * 9), OB = new Float64Array(N * 9), OL = new Float64Array(N * 9);
  const ODX = new Float64Array(N * 9), ODY = new Float64Array(N * 9), OXX = new Float64Array(N * 9), OYY = new Float64Array(N * 9), OXY = new Float64Array(N * 9);
  const nid = (i, j) => i * ny + j;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const h = hs[i], eta = j * de, ex = -eta * hp[i] / h, exx = eta * (2 * hp[i] * hp[i] - h * hpp[i]) / (h * h);
    const o = nid(i, j) * 9;
    const xx = stencil(0, exx, 1, ex * ex, 2 * ex).slice(), yy = stencil(0, 0, 0, 1 / (h * h), 0).slice();
    const xy = stencil(0, -hp[i] / (h * h), 0, ex / h, 1 / h).slice();
    const ddx = stencil(1, ex, 0, 0, 0).slice(), ddy = stencil(0, 1 / h, 0, 0, 0).slice();
    for (let m = 0; m < 9; m++) {
      OXX[o + m] = xx[m]; OYY[o + m] = yy[m]; OXY[o + m] = xy[m];
      OA[o + m] = yy[m] - xx[m]; OB[o + m] = 2 * xy[m]; OL[o + m] = xx[m] + yy[m];
      ODX[o + m] = ddx[m]; ODY[o + m] = ddy[m];
    }
  }
  const DI = [-1, 0, 1, -1, 0, 1, -1, 0, 1], DJ = [-1, -1, -1, 0, 0, 0, 1, 1, 1];

  // ---- state and derived nodal fields ----
  const X = new Float64Array(NU);
  let Q = fixedQ ? opts.Q / (Ur * Hr) : 0;
  const ea = new Float64Array(N), eb = new Float64Array(N), gd = new Float64Array(N), om = new Float64Array(N);
  const mu = new Float64Array(N), muT = new Float64Array(N), u = new Float64Array(N), v = new Float64Array(N);
  const psiE = new Float64Array(EN);
  function fields(frozenMu) {
    for (let k = 0; k < EN; k++) psiE[k] = (rIdx[k] >= 0 ? rA[k] * X[rIdx[k]] : 0) + rQ[k] * Q + rC[k];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const n = nid(i, j), o = n * 9;
      let a = 0, b = 0, l = 0, px = 0, py = 0;
      for (let m = 0; m < 9; m++) {
        const p = psiE[eid(i + DI[m], j + DJ[m])];
        a += OA[o + m] * p; b += OB[o + m] * p; l += OL[o + m] * p; px += ODX[o + m] * p; py += ODY[o + m] * p;
      }
      ea[n] = a; eb[n] = b; om[n] = -l; u[n] = py; v[n] = -px;
      const g = Math.sqrt(a * a + b * b);
      gd[n] = g;
      if (frozenMu == null) { mu[n] = muStar(g); muT[n] = muTangent(g); } else { mu[n] = frozenMu; muT[n] = frozenMu; }
    }
  }

  // ---- residual of the nonlinear discrete equations ----
  const E = new Float64Array(NU), rowScale = new Float64Array(NU);
  const tw = i => (i === 0 || i === nx - 1 ? 0.5 : 1) * dx / (2 * de * hs[i]);
  const CW = [0, -5, 8, -3]; // d/dy at the web extrapolated from rows 1..3
  // scale: per-row normalizers to use (null: this state's own) -- a line
  // search must compare trial points with one fixed scaling, or the merit
  // function changes under it
  const scaleNow = new Float64Array(NU);
  function residual(scale) {
    let sMax = 1e-300;
    for (let i = 1; i < nx - 1; i++) for (let j = 1; j < ny - 1; j++) {
      const n = nid(i, j), o = n * 9, r = uid(i, j);
      let e = 0, s = 0, wx = 0, wy = 0;
      for (let m = 0; m < 9; m++) {
        const q = n + DI[m] * ny + DJ[m];
        const t = -(OXX[o + m] - OYY[o + m]) * mu[q] * ea[q] + 2 * OXY[o + m] * mu[q] * eb[q];
        e += t; s += Math.abs(t);
        wx += ODX[o + m] * om[q]; wy += ODY[o + m] * om[q];
      }
      const c = Re * (u[n] * wx + v[n] * wy);
      E[r] = e + c; rowScale[r] = s + Math.abs(c);
      if (rowScale[r] > sMax) sMax = rowScale[r];
    }
    let worst = 0, l2 = 0;
    for (let r = 0; r < NU; r++) scaleNow[r] = rowScale[r] + 1e-6 * sMax;
    const sc = scale || scaleNow;
    for (let r = 0; r < NU; r++) {
      const t = E[r] / sc[r];
      l2 += t * t; worst = Math.max(worst, Math.abs(E[r] / scaleNow[r]));
    }
    let P = 0, Pabs = 1e-300;
    if (!fixedQ) {
      for (let i = 0; i < nx; i++) for (let j = 1; j <= 3; j++) { const n = nid(i, j), t = tw(i) * CW[j] * mu[n] * om[n]; P += t; Pabs += Math.abs(t); }
      P -= PupStar;
    }
    const pScale = scale ? scale.pScale : Math.abs(PupStar) + Pabs;
    const pres = fixedQ ? 0 : Math.abs(P) / (Math.abs(PupStar) + Pabs);
    const pn = fixedQ ? 0 : P / pScale;
    return { worst, pres, P, norm: Math.sqrt(l2 / NU + pn * pn), scale: Object.assign(Float64Array.from(sc), { pScale }) };
  }

  // ---- Jacobian (exact for the stress; convection frozen), bordered with Q ----
  const kl = 2 * nI + 2, ku = kl, W = 2 * kl + ku + 1;
  const LU = new Float64Array(NU * W), bQ = new Float64Array(NU), cRow = new Float64Array(NU);
  let cQ = 0;
  const C = new Float64Array(4);
  function tangent(q, newton) {    // d(s)/d(e) at node q
    const m0 = mu[q];
    C[0] = m0; C[1] = 0; C[2] = 0; C[3] = m0;
    if (newton && gd[q] > 0) {
      const ha = ea[q] / gd[q], hb = eb[q] / gd[q], dm = muT[q] - m0;
      C[0] += dm * ha * ha; C[1] += dm * ha * hb; C[2] += dm * ha * hb; C[3] += dm * hb * hb;
    }
    return C;
  }
  function route(row, iq, jq, m, val) {   // psi at the neighbour m of node (iq, jq)
    const k = eid(iq + DI[m], jq + DJ[m]);
    if (rIdx[k] >= 0) LU[row * W + rIdx[k] - row + kl] += val * rA[k];
    if (rQ[k] !== 0) bQ[row] += val * rQ[k];
  }
  function routeC(iq, jq, m, val) {
    const k = eid(iq + DI[m], jq + DJ[m]);
    if (rIdx[k] >= 0) cRow[rIdx[k]] += val * rA[k];
    if (rQ[k] !== 0) cQ += val * rQ[k];
  }
  function assembleJ(newton) {
    LU.fill(0); bQ.fill(0); cRow.fill(0); cQ = 0;
    for (let i = 1; i < nx - 1; i++) for (let j = 1; j < ny - 1; j++) {
      const n = nid(i, j), o = n * 9, row = uid(i, j);
      for (let m = 0; m < 9; m++) {
        const wa = -(OXX[o + m] - OYY[o + m]), wb = 2 * OXY[o + m];
        const iq = i + DI[m], jq = j + DJ[m], q = nid(iq, jq), oq = q * 9;
        if (wa !== 0 || wb !== 0) {
          const c = tangent(q, newton);
          const ca = wa * C[0] + wb * C[2], cb = wa * C[1] + wb * C[3];
          for (let p = 0; p < 9; p++) {
            const val = ca * OA[oq + p] + cb * OB[oq + p];
            if (val !== 0) route(row, iq, jq, p, val);
          }
        }
        const cq = Re * (u[n] * ODX[o + m] + v[n] * ODY[o + m]);
        if (cq !== 0) for (let p = 0; p < 9; p++) if (OL[oq + p] !== 0) route(row, iq, jq, p, -cq * OL[oq + p]);
      }
    }
    if (!fixedQ) {
      for (let i = 0; i < nx; i++) for (let j = 1; j <= 3; j++) {
        const q = nid(i, j), oq = q * 9, w = tw(i) * CW[j];
        const g = gd[q], dmu = newton && g > 0 ? (muT[q] - mu[q]) / g : 0;
        const ha = g > 0 ? ea[q] / g : 0, hb = g > 0 ? eb[q] / g : 0;
        for (let p = 0; p < 9; p++) {
          const val = w * (-mu[q] * OL[oq + p] + om[q] * dmu * (ha * OA[oq + p] + hb * OB[oq + p]));
          if (val !== 0) routeC(i, j, p, val);
        }
      }
    }
  }

  // ---- Newton iteration with backtracking line search ----
  const history = [];
  let it = 0, factorizations = 0, lineSearchCuts = 0, res = null;
  function newtonStep(exact) {
    assembleJ(exact);
    const fac = bandFactor(LU, NU, kl, ku); factorizations++;
    const y1 = new Float64Array(NU);
    for (let r = 0; r < NU; r++) y1[r] = -E[r];
    bandSolve(LU, fac, NU, kl, ku, y1);
    let dQ = 0;
    if (!fixedQ) {
      const y2 = bandSolve(LU, fac, NU, kl, ku, Float64Array.from(bQ));
      let c1 = 0, c2 = 0;
      for (let r = 0; r < NU; r++) { c1 += cRow[r] * y1[r]; c2 += cRow[r] * y2[r]; }
      dQ = (-res.P - c1) / (cQ - c2);
      for (let r = 0; r < NU; r++) y1[r] -= dQ * y2[r];
    }
    return { dX: y1, dQ };
  }
  let stalled = false;
  const log = () => {
    const h = { it, residual: res.worst, pressure: res.pres, Q: Q * Ur * Hr, s: sHom };
    history.push(h);
    if (opts.onIteration) opts.onIteration(h);
  };
  function iterate(tolS, maxS) {
    let best = Infinity, bestAt = 0;
    for (let k = 0; k < maxS && it < maxIter; k++, it++) {
      log();
      if (!Number.isFinite(res.norm)) return false;
      if (res.worst < tolS && res.pres < tolS) return true;
      const m = Math.max(res.worst, res.pres);
      if (m < 0.5 * best) { best = m; bestAt = k; }
      // no progress in 12 steps: the iteration has reached the accuracy the
      // linear algebra allows for this problem (reported, not hidden)
      if (k - bestAt >= 12) { stalled = true; return false; }
      const { dX, dQ } = newtonStep(true);
      const X0 = Float64Array.from(X), Q0 = Q;
      let alpha = 1, trial = null;
      for (let ls = 0; ls < 10; ls++) {
        for (let r = 0; r < NU; r++) X[r] = X0[r] + alpha * dX[r];
        Q = Q0 + alpha * dQ;
        fields();
        trial = residual(res.scale);
        if (trial.norm < (1 - 1e-4 * alpha) * res.norm) break;
        alpha *= 0.5; lineSearchCuts++;
      }
      fields(); res = residual();   // re-scale at the accepted point
    }
    log();
    return res.worst < tolS && res.pres < tolS;
  }

  // Start: the Newtonian problem at the reference viscosity (linear, one
  // solve). Then continuation along a path from that fluid to the real
  // rheology, each stage starting from the previous stage's converged
  // field, the step growing when a stage converges quickly and halving when
  // it does not -- the standard way to reach strongly shear-thinning and
  // yield-stress solutions, which a Newton iteration started from a
  // Newtonian field cannot. Path parameter t in [0, 2]:
  //   t <= 1: law mu_ref^(1-t) mu(gd)^t, with a smooth regularization eps0
  //   t >  1: the real law, regularization lowered geometrically eps0 -> gdMin
  const lawVaries = Math.abs(opts.mu(0.1 * gdRef) / opts.mu(10 * gdRef) - 1) > 1e-9;
  const eps0 = Math.max(epsTarget, 0.1);
  const setPath = t => {
    sHom = Math.min(1, t);
    eps = t <= 1 ? eps0 : eps0 * Math.pow(epsTarget / eps0, Math.min(1, t - 1));
  };
  const tEnd = eps0 > epsTarget ? 2 : 1;
  setPath(lawVaries ? 0 : tEnd);
  fields(); res = residual();
  { const { dX, dQ } = newtonStep(false); for (let r = 0; r < NU; r++) X[r] += dX[r]; Q += dQ; fields(); res = residual(); it++; }
  let converged = false, stages = 0;
  if (!lawVaries) converged = iterate(tol, maxIter);
  else {
    let t0 = 0, dt = 0.25;
    let keepX = Float64Array.from(X), keepQ = Q;
    while (it < maxIter) {
      const t1 = Math.min(tEnd, t0 + dt), final = t1 === tEnd;
      setPath(t1); fields(); res = residual(); stages++;
      const itStart = it;
      const ok = iterate(final ? tol : (opts.stageTol ?? 1e-3), final ? maxIter : 8);
      if (ok) {
        if (final) { converged = true; break; }
        t0 = t1; keepX = Float64Array.from(X); keepQ = Q;
        dt = Math.min(tEnd - t0, it - itStart <= 4 ? dt * 2 : dt);
      } else {
        if (final && (it >= maxIter || stalled)) break;
        stalled = false;
        X.set(keepX); Q = keepQ; dt *= 0.5;
        if (dt < 1 / 512) break;
      }
    }
    setPath(tEnd); fields(); res = residual();
  }

  // ---- dimensional output, row-major (k = j*nx + i) as cfd-flowviz.js / cfd-plot.js expect ----
  const psi = new Float64Array(N), omega = new Float64Array(N), uo = new Float64Array(N), vo = new Float64Array(N), muo = new Float64Array(N), gdo = new Float64Array(N);
  // the viscous stresses the discrete equations balanced: tau_xy = mu a, tau_xx = -tau_yy = mu b
  const tauXY = new Float64Array(N), tauXX = new Float64Array(N), tauS = muR * Ur / Hr;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const n = nid(i, j), k = j * nx + i;
    psi[k] = psiE[eid(i, j)] * Ur * Hr; omega[k] = om[n] * Ur / Hr;
    uo[k] = u[n] * Ur; vo[k] = v[n] * Ur; muo[k] = mu[n] * muR; gdo[k] = gd[n] * gdRef;
    tauXY[k] = mu[n] * ea[n] * tauS; tauXX[k] = mu[n] * eb[n] * tauS;
  }
  // wall vorticity for display: the second-order (Jensen) wall formula
  for (let i = 0; i < nx; i++) {
    const h = hs[i], P = j => psiE[eid(i, j)];
    const w0 = -((8 * P(1) - P(2) - 7 * P(0) - 6 * de * Us * h) / (2 * de * de)) / (h * h);
    const w1 = -(1 + hp[i] * hp[i]) * ((8 * P(ny - 2) - P(ny - 3) - 7 * P(ny - 1) + 6 * de * Ubs * h) / (2 * de * de)) / (h * h);
    omega[i] = w0 * Ur / Hr; omega[(ny - 1) * nx + i] = w1 * Ur / Hr;
  }
  const hOut = Array.from(hs, h => h * Hr), hxOut = Array.from(hp);
  const out = {
    nx, ny, dx: Lx / (nx - 1), Lx, h: hOut, hx: hxOut,
    psi, omega, u: uo, v: vo, mu: muo, gd: gdo, tauXY, tauXX,
    Q: Q * Ur * Hr, iterations: it, converged, residual: res ? res.worst : Infinity, pressureResidual: res ? res.pres : Infinity,
    stalled, factorizations, lineSearchCuts, stages, history,
    scales: { Hr, Ur, muR, Re, gdMin: epsTarget * gdRef },
  };
  if (hOut.every(h => h === hOut[0])) out.dy = hOut[0] / (ny - 1); // rectangular channel: plain Cartesian spacing too
  Object.assign(out, recoverPressureSigma(out, rho));
  return out;
}

/**
 * Pressure from the solved field (pressure is not an unknown of the
 * streamfunction formulation; it is recovered from the momentum equation
 * afterwards, the standard step for this formulation):
 *
 *   grad p = -rho (u.grad) u + div(tau)
 *   div(tau) = ( d(tau_xx)/dx + d(tau_xy)/dy,  d(tau_xy)/dx - d(tau_xx)/dy )
 *
 * with the stresses taken exactly as the solver formed and balanced them
 * (tau_xy = mu a, tau_xx = -tau_yy = mu b at the nodes), then
 * differentiated -- the viscosity itself is never differentiated, which
 * matters where it jumps by orders of magnitude at the edge of an
 * unyielded region.
 *
 *  - along the web, dp/dx = -d(mu omega)/dy exactly (no-slip moving wall),
 *    with d/dy extrapolated from rows 1-3 -- the same expression the solver
 *    used to match the bead pressure, integrated from p = 0 at the outlet
 *    (the gap exit opens to ambient air; gauge pressure);
 *  - then up every vertical grid line using dp/dy;
 *  - independently along the blade wall from the outlet corner. The two
 *    routes to the blade must agree; their largest difference relative to
 *    the pressure range is returned as pathError (a consistency check on
 *    the solution, reported rather than hidden).
 */
function recoverPressureSigma(r, rho) {
  const { nx, ny, dx, h, hx, u, v, omega, mu, tauXY, tauXX } = r;
  const N = nx * ny, de = 1 / (ny - 1);
  const K = (i, j) => j * nx + i;
  const dXi = (a, i, j) => i === 0 ? (-3 * a[K(0, j)] + 4 * a[K(1, j)] - a[K(2, j)]) / (2 * dx)
    : i === nx - 1 ? (3 * a[K(i, j)] - 4 * a[K(i - 1, j)] + a[K(i - 2, j)]) / (2 * dx)
    : (a[K(i + 1, j)] - a[K(i - 1, j)]) / (2 * dx);
  const dEta = (a, i, j) => (a[K(i, j + 1)] - a[K(i, j - 1)]) / (2 * de);
  const fx = new Float64Array(N), fy = new Float64Array(N);
  for (let i = 0; i < nx; i++) {
    for (let j = 1; j < ny - 1; j++) {
      const k = K(i, j), H = h[i], ex = -j * de * hx[i] / H;
      const d = a => { const ae = dEta(a, i, j); return [dXi(a, i, j) + ex * ae, ae / H]; }; // [d/dx, d/dy]
      const [ux, uy] = d(u), [vx, vy] = d(v), [sxx_x, sxx_y] = d(tauXX), [sxy_x, sxy_y] = d(tauXY);
      fx[k] = -rho * (u[k] * ux + v[k] * uy) + sxx_x + sxy_y;
      fy[k] = -rho * (u[k] * vx + v[k] * vy) + sxy_x - sxx_y;
    }
    // wall nodes: quadratic extrapolation from the interior
    for (const [j0, s] of [[0, 1], [ny - 1, -1]]) {
      fx[K(i, j0)] = 3 * fx[K(i, j0 + s)] - 3 * fx[K(i, j0 + 2 * s)] + fx[K(i, j0 + 3 * s)];
      fy[K(i, j0)] = 3 * fy[K(i, j0 + s)] - 3 * fy[K(i, j0 + 2 * s)] + fy[K(i, j0 + 3 * s)];
    }
  }
  const p = new Float64Array(N), dpdxWeb = new Float64Array(nx);
  const mw = (i, j) => mu[K(i, j)] * omega[K(i, j)];
  for (let i = 0; i < nx; i++) dpdxWeb[i] = -(-5 * mw(i, 1) + 8 * mw(i, 2) - 3 * mw(i, 3)) / (2 * de * h[i]);
  for (let i = nx - 2; i >= 0; i--) p[K(i, 0)] = p[K(i + 1, 0)] - 0.5 * (dpdxWeb[i] + dpdxWeb[i + 1]) * dx;
  for (let i = 0; i < nx; i++) {
    const dy = h[i] * de;
    for (let j = 1; j < ny; j++) p[K(i, j)] = p[K(i, j - 1)] + 0.5 * (fy[K(i, j - 1)] + fy[K(i, j)]) * dy;
  }
  const pWeb = new Float64Array(nx), pBlade = new Float64Array(nx), pBladeWall = new Float64Array(nx);
  for (let i = 0; i < nx; i++) { pWeb[i] = p[K(i, 0)]; pBlade[i] = p[K(i, ny - 1)]; }
  const ds = i => fx[K(i, ny - 1)] + hx[i] * fy[K(i, ny - 1)];
  pBladeWall[nx - 1] = pBlade[nx - 1];
  for (let i = nx - 2; i >= 0; i--) pBladeWall[i] = pBladeWall[i + 1] - 0.5 * (ds(i) + ds(i + 1)) * dx;
  let pMax = -Infinity, pMin = Infinity, kMax = 0, kMin = 0;
  for (let k = 0; k < N; k++) {
    if (p[k] > pMax) { pMax = p[k]; kMax = k; }
    if (p[k] < pMin) { pMin = p[k]; kMin = k; }
  }
  const range = Math.max(pMax - pMin, 1e-300);
  let pathError = 0;
  for (let i = 0; i < nx; i++) pathError = Math.max(pathError, Math.abs(pBladeWall[i] - pBlade[i]) / range);
  const loc = k => { const i = k % nx, j = (k - i) / nx; return [i * dx, j * de * h[i]]; };
  return { p, pWeb, pBlade, pBladeWall, dpdxWeb, pathError, pMax, pMaxLoc: loc(kMax), pMin, pMinLoc: loc(kMin) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { solveGapFlow, recoverPressureSigma, bandFactor, bandSolve };
