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


/** Inverse of a 3x3 matrix (rows). */
function invert3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, k] = m[2];
  const A = e * k - f * h, B = -(d * k - f * g), Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  if (!(Math.abs(det) > 0)) throw new Error('singular metric');
  return [[A / det, -(b * k - c * h) / det, (b * f - c * e) / det],
          [B / det, (a * k - c * g) / det, -(a * f - c * d) / det],
          [Cc / det, -(a * h - b * g) / det, (a * e - b * d) / det]];
}

/** Blade-following ("sigma") grid: node (i, j) at x = i Lx/(nx-1), y = j/(ny-1) h(x). Row-major, k = j*nx + i. */
function sigmaGrid(nx, ny, Lx, hFn) {
  const x = new Float64Array(nx * ny), y = new Float64Array(nx * ny);
  for (let i = 0; i < nx; i++) {
    const xi = i * Lx / (nx - 1), h = hFn(xi);
    for (let j = 0; j < ny; j++) { x[j * nx + i] = xi; y[j * nx + i] = j / (ny - 1) * h; }
  }
  return { x, y };
}

/**
 * @param {object} opts
 * @param {number} opts.nx, opts.ny   grid nodes along the flow and across it (ny >= 7)
 * Geometry, either
 * @param {number} opts.Lx            domain length (m); inlet at x = 0, outlet at x = Lx
 * @param {(x:number)=>number} opts.h     blade height above the web (m) -- a sigma grid is built
 * or
 * @param {{x:Float64Array,y:Float64Array}} opts.grid  any structured grid, node (i, j) at k = j*nx + i:
 *        j = 0 on the web (y = 0, grid lines leaving it vertically), j = ny-1 on the top boundary
 * @param {string[]} [opts.top]       per column: 'wall' (no-slip, default) or 'free' (free surface:
 *                                    kinematic + zero shear stress; its shape is the grid's top row)
 * @param {number} opts.U             web speed (m/s)
 * @param {number} [opts.Ublade=0]    top-wall speed (m/s, only for the cavity check; flat top)
 * @param {number} opts.rho           density (kg/m^3)
 * @param {(gd:number)=>number} opts.mu  viscosity (Pa.s) at shear rate gd (1/s)
 * @param {number} [opts.gdMin]       regularization shear rate (1/s)
 * @param {number} [opts.Q]           fixed flow rate per unit width (m^2/s) ...
 * @param {number} [opts.Pup]         ... or the inlet-to-outlet pressure drop along the web (Pa) to match
 * @param {number} [opts.pOutlet=0]   pressure at the outlet on the web (Pa) -- the datum of the recovered field
 * @param {string|object} [opts.inlet='developed'], [opts.outlet='developed']
 * @param {object} [opts.warm]        { X, Q } from a previous result's `state` (same grid layout): start
 *                                    from it with the real rheology, skipping the continuation
 * @param {number} [opts.tol=1e-6]    residual tolerance (relative, per equation)
 * @param {number} [opts.maxIter=200]
 */
function solveGapFlow(opts) {
  const nx = opts.nx, ny = opts.ny, N = nx * ny;
  if (ny < 7 || nx < 5) throw new Error('grid too small');
  const U = opts.U || 0, Ub = opts.Ublade || 0, rho = opts.rho;
  const fixedQ = opts.Q != null;
  const tol = opts.tol ?? 1e-6, maxIter = opts.maxIter ?? 200;
  const grid = opts.grid || sigmaGrid(nx, ny, opts.Lx, opts.h);
  const topType = opts.top || new Array(nx).fill('wall');
  const nid = (i, j) => i * ny + j;
  const kof = (i, j) => j * nx + i;

  // ---- reference scales; the solve runs in these units ----
  const Hr = opts.Hr ?? grid.y[kof(nx - 1, ny - 1)];
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
  const PupStar = fixedQ ? 0 : opts.Pup * Hr / (muR * Ur);

  // ---- grid (nondimensional) and its metrics, index space (xi = i, eta = j) ----
  const gx = new Float64Array(N), gy = new Float64Array(N);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { gx[nid(i, j)] = grid.x[kof(i, j)] / Hr; gy[nid(i, j)] = grid.y[kof(i, j)] / Hr; }
  const dI = (a, i, j) => i === 0 ? (-3 * a[nid(0, j)] + 4 * a[nid(1, j)] - a[nid(2, j)]) / 2
    : i === nx - 1 ? (3 * a[nid(i, j)] - 4 * a[nid(i - 1, j)] + a[nid(i - 2, j)]) / 2 : (a[nid(i + 1, j)] - a[nid(i - 1, j)]) / 2;
  const dJ = (a, i, j) => j === 0 ? (-3 * a[nid(i, 0)] + 4 * a[nid(i, 1)] - a[nid(i, 2)]) / 2
    : j === ny - 1 ? (3 * a[nid(i, j)] - 4 * a[nid(i, j - 1)] + a[nid(i, j - 2)]) / 2 : (a[nid(i, j + 1)] - a[nid(i, j - 1)]) / 2;
  const dII = (a, i, j) => i === 0 ? 2 * a[nid(0, j)] - 5 * a[nid(1, j)] + 4 * a[nid(2, j)] - a[nid(3, j)]
    : i === nx - 1 ? 2 * a[nid(i, j)] - 5 * a[nid(i - 1, j)] + 4 * a[nid(i - 2, j)] - a[nid(i - 3, j)] : a[nid(i + 1, j)] - 2 * a[nid(i, j)] + a[nid(i - 1, j)];
  const dJJ = (a, i, j) => j === 0 ? 2 * a[nid(i, 0)] - 5 * a[nid(i, 1)] + 4 * a[nid(i, 2)] - a[nid(i, 3)]
    : j === ny - 1 ? 2 * a[nid(i, j)] - 5 * a[nid(i, j - 1)] + 4 * a[nid(i, j - 2)] - a[nid(i, j - 3)] : a[nid(i, j + 1)] - 2 * a[nid(i, j)] + a[nid(i, j - 1)];
  const dIJ = (a, i, j) => {
    const f = ii => dJ(a, ii, j);
    return i === 0 ? (-3 * f(0) + 4 * f(1) - f(2)) / 2 : i === nx - 1 ? (3 * f(i) - 4 * f(i - 1) + f(i - 2)) / 2 : (f(i + 1) - f(i - 1)) / 2;
  };
  const XE = new Float64Array(N), YE = new Float64Array(N); // x_eta, y_eta (ghost conditions)
  const LCEE = new Float64Array(N), LCE = new Float64Array(N); // coefficients of F_ee, F_e in the Laplacian (wall vorticity)
  const TX = new Float64Array(nx), TY = new Float64Array(nx); // unit tangent of the top boundary per column

  // ---- operator weights at every node, from the chain rule
  //   F_x = (y_e F_s - y_s F_e)/J,  F_y = (x_s F_e - x_e F_s)/J   (s = xi, e = eta)
  // and the second derivatives from the 3x3 system
  //   F_ss = x_s^2 F_xx + 2 x_s y_s F_xy + y_s^2 F_yy + x_ss F_x + y_ss F_y  (and the ee, se rows)
  // central differences in index space, 3x3 over (i+di, j+dj), slot (dj+1)*3+(di+1) ----
  const stencil = makeStencil(1, 1);
  const OA = new Float64Array(N * 9), OB = new Float64Array(N * 9), OL = new Float64Array(N * 9);
  const ODX = new Float64Array(N * 9), ODY = new Float64Array(N * 9), OXX = new Float64Array(N * 9), OYY = new Float64Array(N * 9), OXY = new Float64Array(N * 9);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const n = nid(i, j), o = n * 9;
    const xs = dI(gx, i, j), xe = dJ(gx, i, j), ys = dI(gy, i, j), ye = dJ(gy, i, j);
    const xss = dII(gx, i, j), xee = dJJ(gx, i, j), xse = dIJ(gx, i, j), yss = dII(gy, i, j), yee = dJJ(gy, i, j), yse = dIJ(gy, i, j);
    XE[n] = xe; YE[n] = ye;
    const J = xs * ye - xe * ys;
    if (!(Math.abs(J) > 0)) throw new Error(`degenerate grid cell at (${i}, ${j})`);
    // first derivatives as coefficient vectors over [F_s, F_e, F_ss, F_ee, F_se]
    const Fx = [ye / J, -ys / J, 0, 0, 0], Fy = [-xe / J, xs / J, 0, 0, 0];
    // rhs_r = F_rr - x_rr F_x - y_rr F_y
    const rhs = [[xss, yss, [0, 0, 1, 0, 0]], [xee, yee, [0, 0, 0, 1, 0]], [xse, yse, [0, 0, 0, 0, 1]]]
      .map(([xr, yr, base]) => base.map((b, q) => b - xr * Fx[q] - yr * Fy[q]));
    const M = [[xs * xs, 2 * xs * ys, ys * ys], [xe * xe, 2 * xe * ye, ye * ye], [xs * xe, xs * ye + xe * ys, ys * ye]];
    const Mi = invert3(M);
    const second = Mi.map(row => [0, 1, 2, 3, 4].map(q => row[0] * rhs[0][q] + row[1] * rhs[1][q] + row[2] * rhs[2][q]));
    LCEE[n] = second[0][3] + second[2][3]; LCE[n] = second[0][1] + second[2][1];
    const w = c => stencil(c[0], c[1], c[2], c[3], c[4]).slice();
    const xx = w(second[0]), xy = w(second[1]), yy = w(second[2]), ddx = w(Fx), ddy = w(Fy);
    for (let m = 0; m < 9; m++) {
      OXX[o + m] = xx[m]; OYY[o + m] = yy[m]; OXY[o + m] = xy[m];
      OA[o + m] = yy[m] - xx[m]; OB[o + m] = 2 * xy[m]; OL[o + m] = xx[m] + yy[m];
      ODX[o + m] = ddx[m]; ODY[o + m] = ddy[m];
    }
    if (j === ny - 1) { const L = Math.hypot(xs, ys); TX[i] = xs / L; TY[i] = ys / L; }
  }
  const DI = [-1, 0, 1, -1, 0, 1, -1, 0, 1], DJ = [-1, -1, -1, 0, 0, 0, 1, 1, 1];

  const endOf = spec => typeof spec === 'string' ? { type: spec } : { type: 'profile', f: spec.profile, base: spec.base || (() => 0) };
  const inlet = endOf(opts.inlet || 'developed'), outlet = endOf(opts.outlet || 'developed');
  const free = i => topType[Math.min(nx - 1, Math.max(0, i))] === 'free';
  if ((free(0) && inlet.type === 'wall') || (free(nx - 1) && outlet.type === 'wall')) throw new Error('a free surface cannot meet a side wall');

  // ---- unknowns: per interior column i = 1..nx-2, psi at j = 1..ny-2 plus
  // one slot for the column's top ghost value (an unknown on free-surface
  // columns, fixed by the zero-shear condition; unused and pinned to 0 on
  // wall columns); column-major; Q bordered ----
  const nB = ny - 1, NU = (nx - 2) * nB;
  const uid = (i, j) => (i - 1) * nB + (j - 1);
  const gid = i => (i - 1) * nB + (ny - 2);

  // psi at any node of the grid extended by one ghost layer, as an affine
  // function of the unknowns: psi = a * x[idx] + qc * Q + c (idx -1: none)
  const EW = nx + 2, EH = ny + 2, EN = EW * EH;
  const rIdx = new Int32Array(EN).fill(-1), rA = new Float64Array(EN), rQ = new Float64Array(EN), rC = new Float64Array(EN);
  const eid = (i, j) => (i + 1) * EH + (j + 1);
  const clampI = i => Math.min(nx - 1, Math.max(0, i));
  const webX = i => i < 0 ? 2 * gx[nid(0, 0)] - gx[nid(1, 0)] : i > nx - 1 ? 2 * gx[nid(nx - 1, 0)] - gx[nid(nx - 2, 0)] : gx[nid(i, 0)];
  function ref(i, j) {
    const end = i <= 0 ? inlet : i >= nx - 1 ? outlet : null;
    if (end && end.type === 'profile') return [-1, 0, end.f(webX(i) * Hr, j / (ny - 1)), end.base(webX(i) * Hr, j / (ny - 1)) / (Ur * Hr)];
    if (j < 0) { const r = ref(i, 1); return [r[0], r[1], r[2], r[3] - 2 * Us * YE[nid(clampI(i), 0)]]; }
    if (end && end.type === 'developed') return ref(i <= 0 ? 1 : nx - 2, j);
    if (j > ny - 1) {
      if (free(i)) return [gid(i), 1, 0, 0];
      const r = ref(i, ny - 2); return [r[0], r[1], r[2], r[3] + 2 * Ubs * YE[nid(clampI(i), ny - 1)]];
    }
    if (end && end.type === 'wall') return (i === 0 || i === nx - 1) ? [-1, 0, 0, 0] : ref(i < 0 ? -i : 2 * (nx - 1) - i, j);
    if (j === 0) return [-1, 0, 0, 0];
    if (j === ny - 1) return [-1, 0, 1, 0];
    return [uid(i, j), 1, 0, 0];
  }
  for (let i = -1; i <= nx; i++) for (let j = -1; j <= ny; j++) {
    const r = ref(i, j), k = eid(i, j);
    rIdx[k] = r[0]; rA[k] = r[1]; rQ[k] = r[2]; rC[k] = r[3];
  }

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
  // pressure drop along the web, p_in - p_out = int d(mu omega)/dy dx; grid
  // lines leave the web vertically, so d/dy = (d/deta)/y_eta there, and d/deta
  // at the wall is extrapolated from rows 1..3 (second order, free of the
  // wall-vorticity formula's own error)
  const tw = i => 0.5 * (webX(i + 1) - webX(i - 1)) * (i === 0 || i === nx - 1 ? 0.5 : 1) / (2 * YE[nid(i, 0)]);
  const CW = [0, -5, 8, -3];
  // shear-free condition at a free-surface node: a (tx^2 - ty^2) - 2 tx ty b = 0
  const shearRow = i => { const n = nid(i, ny - 1); return [TX[i] * TX[i] - TY[i] * TY[i], -2 * TX[i] * TY[i], n]; };
  // scale: per-row normalizers to use (null: this state's own) -- a line
  // search must compare trial points with one fixed scaling, or the merit
  // function changes under it
  const scaleNow = new Float64Array(NU);
  function residual(scale) {
    let sMax = 1e-300;
    for (let i = 1; i < nx - 1; i++) {
      for (let j = 1; j < ny - 1; j++) {
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
      const g = gid(i);
      if (free(i)) {
        const [ca, cb, n] = shearRow(i);
        E[g] = ca * ea[n] + cb * eb[n];
        let s = 0; const o = n * 9;
        for (let m = 0; m < 9; m++) s += Math.abs((ca * OA[o + m] + cb * OB[o + m]) * psiE[eid(i + DI[m], ny - 1 + DJ[m])]);
        rowScale[g] = s;
      } else { E[g] = X[g]; rowScale[g] = 1; }
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
  const kl = 2 * nB + 2, ku = kl, W = 2 * kl + ku + 1;
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
    for (let i = 1; i < nx - 1; i++) {
      for (let j = 1; j < ny - 1; j++) {
        const n = nid(i, j), o = n * 9, row = uid(i, j);
        for (let m = 0; m < 9; m++) {
          const wa = -(OXX[o + m] - OYY[o + m]), wb = 2 * OXY[o + m];
          const iq = i + DI[m], jq = j + DJ[m], q = nid(iq, jq), oq = q * 9;
          if (wa !== 0 || wb !== 0) {
            tangent(q, newton);
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
      const g = gid(i);
      if (free(i)) {
        const [ca, cb, n] = shearRow(i), o = n * 9;
        for (let m = 0; m < 9; m++) { const val = ca * OA[o + m] + cb * OB[o + m]; if (val !== 0) route(g, i, ny - 1, m, val); }
      } else LU[g * W + kl] = 1;
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
  let converged = false, stages = 0, warmUsed = false;
  if (opts.warm && opts.warm.X && opts.warm.X.length === NU) {
    // warm start (e.g. the previous pass of a free-surface iteration): the
    // stored state is dimensional psi, rescaled to this solve's units
    const f = 1 / (Ur * Hr);
    for (let r = 0; r < NU; r++) X[r] = opts.warm.X[r] * f;
    if (!fixedQ) Q = opts.warm.Q * f;
    setPath(tEnd); fields(); res = residual();
    converged = iterate(tol, maxIter);
    warmUsed = converged;
    if (!converged) { X.fill(0); Q = fixedQ ? opts.Q / (Ur * Hr) : 0; it = 0; stalled = false; }
  }
  if (!warmUsed) {
    setPath(lawVaries ? 0 : tEnd);
    fields(); res = residual();
    { const { dX, dQ } = newtonStep(false); for (let r = 0; r < NU; r++) X[r] += dX[r]; Q += dQ; fields(); res = residual(); it++; }
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
  }

  // ---- dimensional output, row-major (k = j*nx + i) as cfd-flowviz.js / cfd-plot.js expect ----
  const psi = new Float64Array(N), omega = new Float64Array(N), uo = new Float64Array(N), vo = new Float64Array(N), muo = new Float64Array(N), gdo = new Float64Array(N);
  // the viscous stresses the discrete equations balanced: tau_xy = mu a, tau_xx = -tau_yy = mu b
  const tauXY = new Float64Array(N), tauXX = new Float64Array(N), tauS = muR * Ur / Hr;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const n = nid(i, j), k = kof(i, j);
    psi[k] = psiE[eid(i, j)] * Ur * Hr; omega[k] = om[n] * Ur / Hr;
    uo[k] = u[n] * Ur; vo[k] = v[n] * Ur; muo[k] = mu[n] * muR; gdo[k] = gd[n] * gdRef;
    tauXY[k] = mu[n] * ea[n] * tauS; tauXX[k] = mu[n] * eb[n] * tauS;
  }
  // wall vorticity for display: the second-order (Jensen) wall formula for
  // psi_etaeta, with the wall's known psi_eta, in the node's own Laplacian
  for (let i = 0; i < nx; i++) {
    const P = j => psiE[eid(i, j)];
    const n0 = nid(i, 0), pe0 = Us * YE[n0];
    omega[kof(i, 0)] = -(LCEE[n0] * (8 * P(1) - P(2) - 7 * P(0) - 6 * pe0) / 2 + LCE[n0] * pe0) * Ur / Hr;
    if (!free(i)) {
      const n1 = nid(i, ny - 1), pe1 = Ubs * YE[n1];
      omega[kof(i, ny - 1)] = -(LCEE[n1] * (8 * P(ny - 2) - P(ny - 3) - 7 * P(ny - 1) + 6 * pe1) / 2 + LCE[n1] * pe1) * Ur / Hr;
    }
  }
  const out = {
    nx, ny, x: Float64Array.from(grid.x), y: Float64Array.from(grid.y), top: topType.slice(),
    psi, omega, u: uo, v: vo, mu: muo, gd: gdo, tauXY, tauXX,
    Q: Q * Ur * Hr, iterations: it, converged, residual: res ? res.worst : Infinity, pressureResidual: res ? res.pres : Infinity,
    stalled, warmStart: warmUsed, factorizations, lineSearchCuts, stages, history,
    scales: { Hr, Ur, muR, Re, gdMin: epsTarget * gdRef },
    state: { X: Float64Array.from(X, v => v * Ur * Hr), Q: Q * Ur * Hr },
  };
  if (!opts.grid) {
    // sigma grid: columns vertical and evenly spaced, the blade height per column
    out.dx = opts.Lx / (nx - 1); out.Lx = opts.Lx;
    out.h = Array.from({ length: nx }, (_, i) => grid.y[kof(i, ny - 1)]);
    out.hx = Array.from({ length: nx }, (_, i) => dI(gy, i, ny - 1) / dI(gx, i, ny - 1));
    if (out.h.every(h => h === out.h[0])) out.dy = out.h[0] / (ny - 1);
  }
  Object.assign(out, recoverPressure(out, rho, opts.pOutlet || 0));
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
 * unyielded region. Derivatives by the chain rule on the grid's own
 * coordinates (second-order differences in index space).
 *
 *  - along the web, dp/dx = -d(mu omega)/dy exactly (no-slip moving wall),
 *    with d/dy extrapolated from rows 1-3 -- the same expression the solver
 *    used to match the bead pressure -- integrated from pOutlet at the
 *    outlet (0: the gap exit opens to ambient air; gauge pressure);
 *  - then up every grid line from the web using grad p;
 *  - independently along the top boundary (blade, exit face, free surface)
 *    from the outlet corner. The two routes to the top must agree; their
 *    largest difference relative to the pressure range is returned as
 *    pathError (a consistency check on the solution, reported rather than
 *    hidden).
 */
function recoverPressure(r, rho, pOutlet = 0) {
  const { nx, ny, x, y, u, v, omega, mu, tauXY, tauXX } = r;
  const N = nx * ny;
  const K = (i, j) => j * nx + i;
  const dI = (a, i, j) => i === 0 ? (-3 * a[K(0, j)] + 4 * a[K(1, j)] - a[K(2, j)]) / 2
    : i === nx - 1 ? (3 * a[K(i, j)] - 4 * a[K(i - 1, j)] + a[K(i - 2, j)]) / 2 : (a[K(i + 1, j)] - a[K(i - 1, j)]) / 2;
  const dJ = (a, i, j) => j === 0 ? (-3 * a[K(i, 0)] + 4 * a[K(i, 1)] - a[K(i, 2)]) / 2
    : j === ny - 1 ? (3 * a[K(i, j)] - 4 * a[K(i, j - 1)] + a[K(i, j - 2)]) / 2 : (a[K(i, j + 1)] - a[K(i, j - 1)]) / 2;
  const fx = new Float64Array(N), fy = new Float64Array(N);
  for (let i = 0; i < nx; i++) {
    for (let j = 1; j < ny - 1; j++) {
      const k = K(i, j), xs = dI(x, i, j), xe = dJ(x, i, j), ys = dI(y, i, j), ye = dJ(y, i, j), J = xs * ye - xe * ys;
      const d = a => { const as = dI(a, i, j), ae = dJ(a, i, j); return [(ye * as - ys * ae) / J, (xs * ae - xe * as) / J]; };
      const [ux, uy] = d(u), [vx, vy] = d(v), [sxx_x, sxx_y] = d(tauXX), [sxy_x, sxy_y] = d(tauXY);
      fx[k] = -rho * (u[k] * ux + v[k] * uy) + sxx_x + sxy_y;
      fy[k] = -rho * (u[k] * vx + v[k] * vy) + sxy_x - sxx_y;
    }
    // boundary nodes: quadratic extrapolation from the interior
    for (const [j0, s] of [[0, 1], [ny - 1, -1]]) {
      fx[K(i, j0)] = 3 * fx[K(i, j0 + s)] - 3 * fx[K(i, j0 + 2 * s)] + fx[K(i, j0 + 3 * s)];
      fy[K(i, j0)] = 3 * fy[K(i, j0 + s)] - 3 * fy[K(i, j0 + 2 * s)] + fy[K(i, j0 + 3 * s)];
    }
  }
  const p = new Float64Array(N), dpdxWeb = new Float64Array(nx);
  const mw = (i, j) => mu[K(i, j)] * omega[K(i, j)];
  for (let i = 0; i < nx; i++) dpdxWeb[i] = -((-5 * mw(i, 1) + 8 * mw(i, 2) - 3 * mw(i, 3)) / 2) / dJ(y, i, 0);
  p[K(nx - 1, 0)] = pOutlet;
  for (let i = nx - 2; i >= 0; i--) p[K(i, 0)] = p[K(i + 1, 0)] - 0.5 * (dpdxWeb[i] + dpdxWeb[i + 1]) * (x[K(i + 1, 0)] - x[K(i, 0)]);
  const step = (ka, kb) => 0.5 * (fx[ka] + fx[kb]) * (x[kb] - x[ka]) + 0.5 * (fy[ka] + fy[kb]) * (y[kb] - y[ka]);
  for (let i = 0; i < nx; i++) for (let j = 1; j < ny; j++) p[K(i, j)] = p[K(i, j - 1)] + step(K(i, j - 1), K(i, j));
  const pWeb = new Float64Array(nx), pBlade = new Float64Array(nx), pBladeWall = new Float64Array(nx);
  for (let i = 0; i < nx; i++) { pWeb[i] = p[K(i, 0)]; pBlade[i] = p[K(i, ny - 1)]; }
  pBladeWall[nx - 1] = pBlade[nx - 1];
  for (let i = nx - 2; i >= 0; i--) pBladeWall[i] = pBladeWall[i + 1] - step(K(i, ny - 1), K(i + 1, ny - 1));
  let pMax = -Infinity, pMin = Infinity, kMax = 0, kMin = 0;
  for (let k = 0; k < N; k++) {
    if (p[k] > pMax) { pMax = p[k]; kMax = k; }
    if (p[k] < pMin) { pMin = p[k]; kMin = k; }
  }
  const range = Math.max(pMax - pMin, 1e-300);
  let pathError = 0;
  for (let i = 0; i < nx; i++) pathError = Math.max(pathError, Math.abs(pBladeWall[i] - pBlade[i]) / range);
  const loc = k => [x[k], y[k]];
  return { p, pWeb, pBlade, pBladeWall, dpdxWeb, pathError, pMax, pMaxLoc: loc(kMax), pMin, pMinLoc: loc(kMin) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { solveGapFlow, sigmaGrid, recoverPressure, bandFactor, bandSolve, makeStencil, invert3 };
