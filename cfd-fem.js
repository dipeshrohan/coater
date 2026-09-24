/*
 * cfd-fem.js — steady 2D Navier-Stokes finite-element solver with a free
 * surface, for the coating flow under the blade AND the free film beyond
 * the metering edge, including the meniscus and its contact line.
 * Pure computation, no DOM.
 *
 * Why a second solver: the stream-function solver (cfd-gap-solver.js)
 * has no pressure unknown; pressure is recovered afterwards from third
 * derivatives of psi. A free surface's shape answers to pressure
 * differences of a few Pa (gamma kappa = -p + tau_nn against rho g h),
 * and near the sharp metering edge and the contact line recovered
 * pressure is not that good -- the shape iteration on that solver
 * diverged. The standard method for free-surface coating flows (Kistler &
 * Scriven's school) is what is built here:
 *
 *  - Galerkin finite elements, Taylor-Hood Q2-Q1 (biquadratic velocity,
 *    bilinear continuous pressure: LBB-stable), isoparametric, 3x3 Gauss.
 *  - Unknowns: u, v at every Q2 node, p at every Q1 vertex, the height of
 *    every free-surface spine, and the contact line's position on the exit
 *    face -- all solved together by Newton's method. The flow part of the
 *    Jacobian is analytic (including the shear-rate dependence of the
 *    viscosity); the mesh-position part by finite differences of the
 *    affected element residuals.
 *  - Mesh: logically rectangular, one "spine" per column of Q2 nodes, each
 *    a line from the web to the top boundary (blade, exit face, or free
 *    surface), nodes at fixed fractions along it. A free-surface spine is
 *    vertical and its height is the unknown.
 *  - Free surface: kinematic condition (u.n = 0, one weighted equation per
 *    surface node) and the traction condition sigma.n = gamma dt/ds,
 *    applied in the weak form integrated by parts, gamma t . dw/ds, so no
 *    second derivative of the surface appears. Gravity is a body force.
 *  - Contact line on the exit face: its tangent is set by the contact
 *    angle; at the metering edge it may instead be pinned (Gibbs), decided
 *    by the caller.
 *  - Inlet: normal traction = the bead pressure (hydrostatic with depth),
 *    no cross-flow. Outlet: plug flow u = U (far downstream the film
 *    moves with the web) or a traction condition.
 */

// ---------------------------------------------------------------------
// Reference element: Q2 (9 nodes, local (a, b), a along the spines' order,
// b along a spine, index b*3 + a), Q1 pressure on the 4 vertices.
// ---------------------------------------------------------------------
const FEM_G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], FEM_GW = [5 / 9, 8 / 9, 5 / 9];
const q2 = x => [x * (x - 1) / 2, 1 - x * x, x * (x + 1) / 2];
const dq2 = x => [x - 0.5, -2 * x, x + 0.5];
const q1 = x => [(1 - x) / 2, (1 + x) / 2];
const dq1 = () => [-0.5, 0.5];
const FEM_QP = [];
for (let gb = 0; gb < 3; gb++) for (let ga = 0; ga < 3; ga++) {
  const xi = FEM_G[ga], et = FEM_G[gb], w = FEM_GW[ga] * FEM_GW[gb];
  const A = q2(xi), B = q2(et), dA = dq2(xi), dB = dq2(et), Pa = q1(xi), Pb = q1(et);
  const N = new Float64Array(9), Nxi = new Float64Array(9), Net = new Float64Array(9), P = new Float64Array(4);
  for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { const k = b * 3 + a; N[k] = A[a] * B[b]; Nxi[k] = dA[a] * B[b]; Net[k] = A[a] * dB[b]; }
  for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) P[b * 2 + a] = Pa[a] * Pb[b];
  FEM_QP.push({ w, N, Nxi, Net, P });
}
// 1D edge (3 nodes) rule
const FEM_EDGE = FEM_G.map((x, g) => ({ w: FEM_GW[g], N: q2(x), dN: dq2(x) }));

/**
 * Build the spine mesh.
 * @param {object} m
 *   nEx, nEy          elements along the flow and across it
 *   spineFoot(c, st)  x of spine c's foot on the web (c = 0 .. 2 nEx)
 *   spineTop(c, st)   [x, y] of spine c's top for geometry state st
 *   spineSlope(c, st) optional: dx/dy of the spine where it arrives at the top
 *   eta(k)            fraction of the way up the spine for node row k (0 .. 2 nEy), default k/(2nEy)
 * Node (c, k) at y = e yt and x on the cubic (Hermite) from the foot, leaving
 * the web vertically, to the top with the given slope; without spineSlope
 * that is the parabola x = xb + (xt - xb) e^2.
 */
function femNodes(m, st, out) {
  const NC = 2 * m.nEx + 1, NR = 2 * m.nEy + 1;
  const X = out ? out.X : new Float64Array(NC * NR), Y = out ? out.Y : new Float64Array(NC * NR);
  for (let c = 0; c < NC; c++) {
    const xb = m.spineFoot(c, st), [xt, yt] = m.spineTop(c, st), D = xt - xb;
    const T = m.spineSlope ? m.spineSlope(c, st) * yt : 2 * D;      // dx/de at the top
    for (let k = 0; k < NR; k++) {
      const e = m.eta ? m.eta(k) : k / (NR - 1), e2 = e * e;
      X[c * NR + k] = xb + D * e2 * (3 - 2 * e) + T * e2 * (e - 1); Y[c * NR + k] = e * yt;
    }
  }
  return { X, Y };
}

/** Mesh shape quality: the smallest, over elements, of min J / max J at the Gauss points (<= 0: inverted). */
function femQuality(m, st) {
  const NR = 2 * m.nEy + 1, { X, Y } = femNodes(m, st);
  let worst = Infinity;
  for (let ex = 0; ex < m.nEx; ex++) for (let ey = 0; ey < m.nEy; ey++) {
    let jmin = Infinity, jmax = -Infinity;
    for (const q of FEM_QP) {
      let xs = 0, xt = 0, ys = 0, yt = 0;
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const n = (2 * ex + a) * NR + 2 * ey + b, i = b * 3 + a;
        xs += X[n] * q.Nxi[i]; xt += X[n] * q.Net[i]; ys += Y[n] * q.Nxi[i]; yt += Y[n] * q.Net[i];
      }
      const J = xs * yt - xt * ys; jmin = Math.min(jmin, J); jmax = Math.max(jmax, J);
    }
    worst = Math.min(worst, jmax > 0 ? jmin / jmax : -Infinity);
  }
  return worst;
}

/**
 * Solve. See the header. Options:
 *   mesh: { nEx, nEy, spineFoot, spineTop(c, st), eta?, kind(c): 'wall'|'free' (top of spine c) }
 *     st = { h: Float64Array per spine (free spines' heights), s: contact-line distance }
 *   geometry unknowns: freeSpines (list of c with kind 'free'), contactLine: { spine, faceFrom (first spine whose top moves with s), alphaDeg } or null
 *   U (web speed), rho, g (gravity, m/s^2), gamma (surface tension), mu(gd), gdMin
 *   inlet: { type: 'traction', p: (y) => Pa }
 *   outlet: { type: 'plug' } | { type: 'traction', p: (y) => Pa }
 *   topSpeed: speed of a moving top wall (cavity check), fixPressure: true to pin p at one vertex (closed domains)
 *   init: previous result's state { sol, h, s } (same mesh layout) to start from
 *   initNodal: { u, v, p } at this mesh's nodes (from another mesh, femInterpolate) to start from
 *   freeze: surface heights fixed (flow only); s0, h0(c): starting contact-line distance / heights
 *   homotopy: if Newton stalls, follow R(x) = (1 - lambda) R(x_start), lambda 0 -> 1
 *   flatEnd: no flow -- the outlet end of the surface is set flat instead of its kinematic row
 *   webSlip: alpha / sqrt(k) (1/m) -- Beavers-Joseph slip over the porous web instead of no slip
 *   tol, maxIter, onIteration
 */
function solveFEM(o) {
  const mesh = o.mesh, nEx = mesh.nEx, nEy = mesh.nEy, NC = 2 * nEx + 1, NR = 2 * nEy + 1, NN = NC * NR;
  const U = o.U || 0, rho = o.rho || 0, grav = o.g || 0, gamma = o.gamma || 0, Utop = o.topSpeed || 0;
  const tol = o.tol ?? 1e-8, maxIter = o.maxIter ?? 60;
  const nid = (c, k) => c * NR + k;
  const kind = c => (mesh.kind ? mesh.kind(c) : 'wall');
  const freeSp = [];
  for (let c = 0; c < NC; c++) if (kind(c) === 'free') freeSp.push(c);
  const CL = o.contactLine || null;

  // ---- scales (the solve runs in these units) ----
  const Hr = o.Hr, Ur = o.Ur, gdRef = Ur / Hr, muR = o.mu(gdRef), Pr = muR * Ur / Hr;
  const epsTarget = (o.gdMin ?? 1e-3 * gdRef) / gdRef;
  let eps = epsTarget, sHom = 1;
  const muLaw = gd => o.mu(Math.sqrt(gd * gd + eps * eps) * gdRef) / muR;
  const muStar = gd => sHom === 1 ? muLaw(gd) : Math.pow(muLaw(gd), sHom);
  const muTan = gd => { if (!(gd > 0)) return muStar(0); const d = 1e-5, a = gd * (1 + d), b = gd * (1 - d); return (muStar(a) * a - muStar(b) * b) / (a - b); };
  const Re = rho * Ur * Hr / muR;                         // inertia
  const Gr = rho * grav * Hr * Hr / (muR * Ur);            // gravity body force (nondim)
  const Ca = muR * Ur / (gamma || 1);                      // surface tension enters as 1/Ca
  const invCa = gamma ? 1 / Ca : 0;
  const Us = U / Ur, Uts = Utop / Ur;

  // ---- degrees of freedom: spine by spine (u, v at each node; p at vertices; the spine's height if free) ----
  const dU = new Int32Array(NN), dV = new Int32Array(NN), dP = new Int32Array(NN).fill(-1), dH = new Int32Array(NC).fill(-1);
  let nd = 0;
  for (let c = 0; c < NC; c++) {
    for (let k = 0; k < NR; k++) {
      const n = nid(c, k);
      dU[n] = nd++; dV[n] = nd++;
      if (c % 2 === 0 && k % 2 === 0) dP[n] = nd++;
    }
    if (kind(c) === 'free') dH[c] = nd++;
  }
  const ND = nd, hasS = !!CL && !o.freeze;                  // s: bordered extra unknown (none when the geometry is frozen)
  const isVertex = (c, k) => c % 2 === 0 && k % 2 === 0;

  // ---- Dirichlet conditions ----
  const dirVal = new Float64Array(ND), isDir = new Uint8Array(ND);
  const setDir = (d, v) => { isDir[d] = 1; dirVal[d] = v; };
  // web: no flow through it; tangentially either moving with the web (no slip) or, with webSlip =
  // alpha / sqrt(k) (1/m), the Beavers-Joseph condition du/dy = (alpha / sqrt k)(u - U) (boundary term below)
  const lamS = o.webSlip ? o.webSlip * Hr : 0;
  for (let c = 0; c < NC; c++) {
    if (!lamS) setDir(dU[nid(c, 0)], Us);
    setDir(dV[nid(c, 0)], 0);                                            // web
    if (kind(c) !== 'free') { setDir(dU[nid(c, NR - 1)], Uts); setDir(dV[nid(c, NR - 1)], 0); } // blade / face / contact line
  }
  for (let k = 0; k < NR; k++) setDir(dV[nid(0, k)], 0);                 // inlet: no cross-flow
  if (o.outlet.type === 'plug') for (let k = 0; k < NR; k++) { setDir(dU[nid(NC - 1, k)], Us); setDir(dV[nid(NC - 1, k)], 0); }
  else for (let k = 0; k < NR; k++) setDir(dV[nid(NC - 1, k)], 0);
  if (o.inlet.type === 'wall') for (let k = 0; k < NR; k++) setDir(dU[nid(0, k)], 0);
  if (o.outlet.type === 'wall') for (let k = 0; k < NR; k++) { setDir(dU[nid(NC - 1, k)], 0); setDir(dV[nid(NC - 1, k)], 0); }
  if (o.fixPressure) setDir(dP[nid(0, 0)], 0);

  // ---- state ----
  const sol = new Float64Array(ND);
  const geo = { h: new Float64Array(NC), s: o.s0 ?? 0 };
  if (o.h0) for (const c of freeSp) geo.h[c] = o.h0(c);
  if (o.init) {
    if (o.init.sol && o.init.sol.length === ND) sol.set(o.init.sol);
    if (o.init.h) geo.h.set(o.init.h);
    if (o.init.s != null) geo.s = o.init.s;
  }
  if (o.initNodal) {
    // a flow field from another mesh, already interpolated onto this one's nodes (dimensional)
    const q = o.initNodal;
    for (let n = 0; n < NN; n++) { sol[dU[n]] = q.u[n] / Ur; sol[dV[n]] = q.v[n] / Ur; if (dP[n] >= 0) sol[dP[n]] = q.p[n] / Pr; }
  }
  for (let d = 0; d < ND; d++) if (isDir[d]) sol[d] = dirVal[d];
  // heights live in the solution vector too (nondimensional); frozen geometry: fixed
  for (const c of freeSp) { sol[dH[c]] = geo.h[c] / Hr; if (o.freeze) setDir(dH[c], sol[dH[c]]); }
  let sStar = geo.s / Hr;

  const X = new Float64Array(NN), Y = new Float64Array(NN);
  const stNow = () => {
    const h = new Float64Array(NC);
    for (const c of freeSp) h[c] = sol[dH[c]] * Hr;
    return { h, s: sStar * Hr };
  };
  const placeNodes = () => {
    femNodes(mesh, stNow(), { X, Y });
    for (let n = 0; n < NN; n++) { X[n] /= Hr; Y[n] /= Hr; }
  };

  // element e = (ex, ey): node ids
  const elemNodes = (ex, ey) => {
    const r = new Int32Array(9);
    for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) r[b * 3 + a] = nid(2 * ex + a, 2 * ey + b);
    return r;
  };
  const elemP = (ex, ey) => [nid(2 * ex, 2 * ey), nid(2 * ex + 2, 2 * ey), nid(2 * ex, 2 * ey + 2), nid(2 * ex + 2, 2 * ey + 2)];

  /**
   * Element residual (and, if K given, the analytic Jacobian of it with
   * respect to the element's u, v, p). Local dof order: u0..u8, v0..v8, p0..p3.
   */
  const RL = new Float64Array(22), KL = new Float64Array(22 * 22);
  const Nx = new Float64Array(9), Ny = new Float64Array(9), Px = new Float64Array(4);
  function element(ex, ey, withK, newton) {
    const nodes = elemNodes(ex, ey), pn = elemP(ex, ey);
    RL.fill(0); if (withK) KL.fill(0);
    const ue = new Float64Array(9), ve = new Float64Array(9), pe = new Float64Array(4), xe = new Float64Array(9), ye = new Float64Array(9);
    for (let a = 0; a < 9; a++) { const n = nodes[a]; ue[a] = sol[dU[n]]; ve[a] = sol[dV[n]]; xe[a] = X[n]; ye[a] = Y[n]; }
    for (let a = 0; a < 4; a++) pe[a] = sol[dP[pn[a]]];
    for (const q of FEM_QP) {
      let xs = 0, xt = 0, ys = 0, yt = 0;
      for (let a = 0; a < 9; a++) { xs += xe[a] * q.Nxi[a]; xt += xe[a] * q.Net[a]; ys += ye[a] * q.Nxi[a]; yt += ye[a] * q.Net[a]; }
      const J = xs * yt - xt * ys;
      if (!(J > 0)) throw new Error(`inverted element (${ex}, ${ey})`);
      let u = 0, v = 0, ux = 0, uy = 0, vx = 0, vy = 0, p = 0;
      for (let a = 0; a < 9; a++) {
        Nx[a] = (yt * q.Nxi[a] - ys * q.Net[a]) / J; Ny[a] = (xs * q.Net[a] - xt * q.Nxi[a]) / J;
        u += ue[a] * q.N[a]; v += ve[a] * q.N[a]; ux += ue[a] * Nx[a]; uy += ue[a] * Ny[a]; vx += ve[a] * Nx[a]; vy += ve[a] * Ny[a];
      }
      for (let a = 0; a < 4; a++) p += pe[a] * q.P[a];
      const gd = Math.sqrt(2 * ux * ux + 2 * vy * vy + (uy + vx) * (uy + vx));
      const mu = muStar(gd), wd = q.w * J;
      const txx = 2 * mu * ux, tyy = 2 * mu * vy, txy = mu * (uy + vx), div = ux + vy;
      for (let a = 0; a < 9; a++) {
        RL[a] += wd * (Re * (u * ux + v * uy) * q.N[a] + txx * Nx[a] + txy * Ny[a] - p * Nx[a]);
        RL[9 + a] += wd * (Re * (u * vx + v * vy) * q.N[a] + txy * Nx[a] + tyy * Ny[a] - p * Ny[a] + Gr * q.N[a]);
      }
      for (let i = 0; i < 4; i++) RL[18 + i] -= wd * q.P[i] * div;
      if (!withK) continue;
      // tangent: d tau = 2 mu dD + c4 (D:dD) D, c4 = 4 mu'/gd = 2 (mu_t - mu)/gd^2 (Newton only)
      const c4 = newton && gd > 0 ? 2 * (muTan(gd) - mu) / (gd * gd) : 0;
      const Dxx = ux, Dyy = vy, Dxy = 0.5 * (uy + vx);
      for (let b = 0; b < 9; b++) {
        // trial: du = N_b e_x
        const dDu = [Nx[b], 0.5 * Ny[b], Ny[b] * 0 + 0], dDv = [0, 0.5 * Nx[b], Ny[b]]; // [Dxx, Dxy, Dyy]
        const DdDu = Dxx * Nx[b] + 2 * Dxy * 0.5 * Ny[b], DdDv = 2 * Dxy * 0.5 * Nx[b] + Dyy * Ny[b];
        for (let a = 0; a < 9; a++) {
          const DdW_u = Dxx * Nx[a] + Dxy * Ny[a], DdW_v = Dxy * Nx[a] + Dyy * Ny[a]; // D : grad(w) for w = N_a e_x / e_y
          // viscous, u-trial
          let Kuu = mu * (2 * Nx[b] * Nx[a] + Ny[b] * Ny[a]) + c4 * DdDu * DdW_u * 2;
          let Kvu = mu * (Ny[b] * Nx[a]) + c4 * DdDu * DdW_v * 2;
          let Kuv = mu * (Nx[b] * Ny[a]) + c4 * DdDv * DdW_u * 2;
          let Kvv = mu * (Nx[b] * Nx[a] + 2 * Ny[b] * Ny[a]) + c4 * DdDv * DdW_v * 2;
          // convection (Newton): (du.grad)u + (u.grad)du
          const conv = Re * (u * Nx[b] + v * Ny[b]) * q.N[a];
          Kuu += conv + Re * q.N[b] * ux * q.N[a]; Kuv += Re * q.N[b] * uy * q.N[a];
          Kvu += Re * q.N[b] * vx * q.N[a]; Kvv += conv + Re * q.N[b] * vy * q.N[a];
          KL[a * 22 + b] += wd * Kuu; KL[a * 22 + 9 + b] += wd * Kuv;
          KL[(9 + a) * 22 + b] += wd * Kvu; KL[(9 + a) * 22 + 9 + b] += wd * Kvv;
        }
      }
      for (let a = 0; a < 9; a++) for (let i = 0; i < 4; i++) {
        KL[a * 22 + 18 + i] -= wd * q.P[i] * Nx[a]; KL[(9 + a) * 22 + 18 + i] -= wd * q.P[i] * Ny[a];
        KL[(18 + i) * 22 + a] -= wd * q.P[i] * Nx[a]; KL[(18 + i) * 22 + 9 + a] -= wd * q.P[i] * Ny[a];
      }
    }
    return { nodes, pn };
  }
  const localDofs = (nodes, pn) => { const d = new Int32Array(22); for (let a = 0; a < 9; a++) { d[a] = dU[nodes[a]]; d[9 + a] = dV[nodes[a]]; } for (let i = 0; i < 4; i++) d[18 + i] = dP[pn[i]]; return d; };

  /** Boundary terms: inlet/outlet traction, free-surface tension, kinematic rows. Adds into R (and K for the flow dofs). */
  /**
   * Beavers-Joseph slip along the web (bottom edge of element row 0): the wall shear stress
   * tau = mu (du/dy) with du/dy = lamS (u - U), as the boundary term + int tau w_x ds (for u's
   * test functions; v = 0 there). mu is the local apparent viscosity at the wall, so for any
   * rheology this imposes the velocity-gradient form of the condition exactly. out: the 3 edge
   * nodes' u rows.
   */
  const B0 = q2(-1), dB0 = dq2(-1);
  function slipEdge(ex, out) {
    out.fill(0);
    const nodes = elemNodes(ex, 0);
    for (const e of FEM_EDGE) {
      let xs = 0, xt = 0, ys = 0, yt = 0, us = 0, ut = 0, vs = 0, vt = 0, u = 0;
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const n = nodes[b * 3 + a], Ns = e.dN[a] * B0[b], Nt = e.N[a] * dB0[b], uu = sol[dU[n]], vv = sol[dV[n]];
        xs += X[n] * Ns; xt += X[n] * Nt; ys += Y[n] * Ns; yt += Y[n] * Nt;
        us += uu * Ns; ut += uu * Nt; vs += vv * Ns; vt += vv * Nt; u += uu * e.N[a] * B0[b];
      }
      const J = xs * yt - xt * ys;
      const ux = (yt * us - ys * ut) / J, uy = (xs * ut - xt * us) / J, vx = (yt * vs - ys * vt) / J, vy = (xs * vt - xt * vs) / J;
      const gd = Math.sqrt(2 * ux * ux + 2 * vy * vy + (uy + vx) * (uy + vx)), ds = Math.hypot(xs, ys);
      const tau = muStar(gd) * lamS * (u - Us);
      for (let a = 0; a < 3; a++) out[a] += e.w * tau * e.N[a] * ds;
    }
  }
  const slipTmp = new Float64Array(3);
  function boundary(R, addK, exFrom = 0, exTo = nEx - 1) {
    if (lamS) for (let ex = exFrom; ex <= exTo; ex++) {
      slipEdge(ex, slipTmp);
      for (let a = 0; a < 3; a++) R[dU[nid(2 * ex + a, 0)]] += slipTmp[a];
    }
    // inlet (c = 0) and outlet traction: -int t . w ds, t = -p_b(y) n
    const edgeX = (c, side) => {
      const pf = side === 'in' ? o.inlet.p : o.outlet.p, nsgn = side === 'in' ? -1 : 1;
      for (let ey = 0; ey < nEy; ey++) {
        const ns = [nid(c, 2 * ey), nid(c, 2 * ey + 1), nid(c, 2 * ey + 2)];
        for (const e of FEM_EDGE) {
          let x = 0, y = 0, xt = 0, yt = 0;
          for (let a = 0; a < 3; a++) { x += X[ns[a]] * e.N[a]; y += Y[ns[a]] * e.N[a]; xt += X[ns[a]] * e.dN[a]; yt += Y[ns[a]] * e.dN[a]; }
          // outward normal times ds along the spine (running up): n ds = nsgn (yt, -xt)... for a vertical line this is (nsgn, 0) dy
          const nx = nsgn * yt, ny = -nsgn * xt;
          const pb = pf(y * Hr) / Pr;
          for (let a = 0; a < 3; a++) { R[dU[ns[a]]] += e.w * pb * nx * e.N[a]; R[dV[ns[a]]] += e.w * pb * ny * e.N[a]; }
        }
      }
    };
    if (o.inlet.type === 'traction' && exFrom === 0) edgeX(0, 'in');
    if (o.outlet.type === 'traction' && exTo === nEx - 1) edgeX(NC - 1, 'out');
    // free surface: top edges whose spines include a free one
    for (let ex = exFrom; ex <= exTo; ex++) {
      const cs = [2 * ex, 2 * ex + 1, 2 * ex + 2];
      if (!cs.some(c => kind(c) === 'free')) continue;
      const ns = cs.map(c => nid(c, NR - 1));
      for (const e of FEM_EDGE) {
        let xt = 0, yt = 0, u = 0, v = 0;
        for (let a = 0; a < 3; a++) { xt += X[ns[a]] * e.dN[a]; yt += Y[ns[a]] * e.dN[a]; u += sol[dU[ns[a]]] * e.N[a]; v += sol[dV[ns[a]]] * e.N[a]; }
        const L = Math.hypot(xt, yt);
        // surface tension: + int (1/Ca) t . dw/ds ds = (1/Ca) int (X_xi . w_xi)/|X_xi| dxi
        for (let a = 0; a < 3; a++) { R[dU[ns[a]]] += e.w * invCa * xt * e.dN[a] / L; R[dV[ns[a]]] += e.w * invCa * yt * e.dN[a] / L; }
        // kinematic: int u . n ds phi_a, n ds = (-yt, xt) dxi
        for (let a = 0; a < 3; a++) {
          const c = cs[a];
          if (dH[c] < 0 || (o.flatEnd && c === NC - 1)) continue;
          R[dH[c]] += e.w * (-u * yt + v * xt) * e.N[a];
          if (addK) for (let b = 0; b < 3; b++) { addK(dH[c], dU[ns[b]], e.w * -yt * e.N[b] * e.N[a]); addK(dH[c], dV[ns[b]], e.w * xt * e.N[b] * e.N[a]); }
        }
      }
    }
  }
  /** Contact-angle condition: the free surface leaves the contact line along the prescribed direction. */
  function contactResidual() {
    if (!hasS) return 0;
    const c = CL.spine, ns = [nid(c, NR - 1), nid(c + 1, NR - 1), nid(c + 2, NR - 1)];
    const d = dq2(-1);
    let xt = 0, yt = 0;
    for (let a = 0; a < 3; a++) { xt += X[ns[a]] * d[a]; yt += Y[ns[a]] * d[a]; }
    const al = CL.alphaDeg * Math.PI / 180;
    return (yt * Math.cos(al) - xt * Math.sin(al)) / Math.hypot(xt, yt);
  }

  function flatEndRow(R) {
    if (!(o.flatEnd && dH[NC - 1] >= 0)) return;
    // no flow (static check): the kinematic condition says nothing, so the outlet end of the surface is set flat instead
    const d = dq2(1), ns = [nid(NC - 3, NR - 1), nid(NC - 2, NR - 1), nid(NC - 1, NR - 1)];
    let xt = 0, yt = 0;
    for (let a = 0; a < 3; a++) { xt += X[ns[a]] * d[a]; yt += Y[ns[a]] * d[a]; }
    R[dH[NC - 1]] = yt / Math.hypot(xt, yt);
  }
  /** The residual's contributions from elements ex0..ex1 (all rows; for differences, nodes already placed). */
  function partialResidual(ex0, ex1, R) {
    R.fill(0);
    for (let ex = ex0; ex <= ex1; ex++) for (let ey = 0; ey < nEy; ey++) {
      const { nodes, pn } = element(ex, ey, false, false);
      const ld = localDofs(nodes, pn);
      for (let q = 0; q < 22; q++) R[ld[q]] += RL[q];
    }
    boundary(R, null, ex0, ex1);
    if (ex1 === nEx - 1) flatEndRow(R);
  }

  // ---- global residual ----
  let shift = null, hLam = 1;
  function residual() {
    placeNodes();
    const R = new Float64Array(ND);
    for (let ex = 0; ex < nEx; ex++) for (let ey = 0; ey < nEy; ey++) {
      const { nodes, pn } = element(ex, ey, false, false);
      const ld = localDofs(nodes, pn);
      for (let q = 0; q < 22; q++) R[ld[q]] += RL[q];
    }
    boundary(R, null);
    flatEndRow(R);
    for (let d = 0; d < ND; d++) if (isDir[d]) R[d] = sol[d] - dirVal[d];
    let rs = contactResidual();
    if (shift) {
      // Newton homotopy: R(x) = (1 - lambda) R(x0)
      const f = 1 - hLam;
      for (let d = 0; d < ND; d++) if (!isDir[d]) R[d] -= f * shift.R[d];
      rs -= f * shift.rs;
    }
    return { R, rs };
  }

  // ---- Jacobian: analytic flow part + finite-difference geometry columns, banded; s bordered ----
  // bandwidth: an element spans three spines
  let spineMax = 0;
  for (let c = 0; c < NC; c++) { const lo = dU[nid(c, 0)], hi = c + 1 < NC ? dU[nid(c + 1, 0)] - 1 : ND - 1; spineMax = Math.max(spineMax, hi - lo + 1); }
  const kl = 3 * spineMax + 2, ku = kl, W = 2 * kl + ku + 1;
  const LU = new Float64Array(ND * W);
  const addK = (r, c, v) => { if (!isDir[r]) LU[r * W + c - r + kl] += v; };
  let colS = null, rowS = null, dss = 0;
  function jacobian(newton) {
    LU.fill(0);
    placeNodes();
    const rs0Raw = hasS ? contactResidual() : 0;
    for (let ex = 0; ex < nEx; ex++) for (let ey = 0; ey < nEy; ey++) {
      const { nodes, pn } = element(ex, ey, true, newton);
      const ld = localDofs(nodes, pn);
      for (let a = 0; a < 22; a++) { const r = ld[a]; if (isDir[r]) continue; for (let b = 0; b < 22; b++) { const v = KL[a * 22 + b]; if (v !== 0) LU[r * W + ld[b] - r + kl] += v; } }
    }
    boundary(new Float64Array(ND), addK);
    if (lamS) {
      // the slip term's Jacobian (incl. the wall viscosity's shear-rate dependence), by finite differences per element
      const b0 = new Float64Array(3), b1 = new Float64Array(3);
      for (let ex = 0; ex < nEx; ex++) {
        slipEdge(ex, b0);
        for (const n of elemNodes(ex, 0)) for (const d of [dU[n], dV[n]]) {
          if (isDir[d]) continue;
          const keep = sol[d], h = 1e-7 * Math.max(1, Math.abs(keep));
          sol[d] = keep + h; slipEdge(ex, b1); sol[d] = keep;
          for (let a = 0; a < 3; a++) { const r = dU[nid(2 * ex + a, 0)]; if (!isDir[r]) LU[r * W + d - r + kl] += (b1[a] - b0[a]) / h; }
        }
      }
    }
    for (let d = 0; d < ND; d++) if (isDir[d]) LU[d * W + kl] = 1;
    // geometry columns by finite differences, from the elements that hold the
    // perturbed spine(s) only (a free spine's height moves that spine's nodes
    // alone; s moves the face spines)
    const Rb = new Float64Array(ND), Rp = new Float64Array(ND);
    for (const c of freeSp) {
      const d = dH[c];
      if (isDir[d]) continue;
      const hkeep = sol[d], dh = 1e-7 * Math.max(1, Math.abs(hkeep));
      const ex0 = Math.max(0, Math.ceil(c / 2) - 1), ex1 = Math.min(nEx - 1, Math.floor(c / 2));
      placeNodes(); partialResidual(ex0, ex1, Rb);
      sol[d] = hkeep + dh;
      placeNodes(); partialResidual(ex0, ex1, Rp);
      const rs = hasS ? contactResidual() : 0;
      sol[d] = hkeep;
      for (let r = Math.max(0, d - kl), rEnd = Math.min(ND - 1, d + kl); r <= rEnd; r++) {
        if (isDir[r]) continue;
        const v = (Rp[r] - Rb[r]) / dh;
        if (v !== 0) LU[r * W + d - r + kl] += v;
      }
      if (hasS) rowS[d] = (rs - rs0Raw) / dh;
    }
    if (hasS) {
      const skeep = sStar, ds = 1e-7 * Math.max(1, Math.abs(skeep));
      const ex0 = Math.max(0, Math.ceil((CL.faceFrom ?? 0) / 2) - 1), ex1 = Math.min(nEx - 1, Math.floor(CL.spine / 2));
      placeNodes(); partialResidual(ex0, ex1, Rb);
      sStar = skeep + ds;
      placeNodes(); partialResidual(ex0, ex1, Rp);
      const rs = contactResidual();
      sStar = skeep;
      colS = new Float64Array(ND);
      for (let r = 0; r < ND; r++) if (!isDir[r]) colS[r] = (Rp[r] - Rb[r]) / ds;
      dss = (rs - rs0Raw) / ds;
    }
    placeNodes();
  }

  // ---- Newton with line search; continuation from a Newtonian fluid ----
  const history = [];
  let it = 0, converged = false, res = null, factorizations = 0;
  const norms = r => {
    let fm = 0;
    for (let d = 0; d < ND; d++) { if (isDir[d]) continue; const a = Math.abs(r.R[d]); fm = Math.max(fm, a); }
    return Math.max(fm, Math.abs(r.rs));
  };
  // stallAfter: give up once the residual has not halved over that many iterations
  function newton(tolS, maxS, stallAfter = 0) {
    const seen = [];
    for (let k = 0; k < maxS && it < maxIter; k++, it++) {
      res = residual();
      const nrm = norms(res);
      history.push({ it, residual: nrm, s: sHom });
      if (o.onIteration) o.onIteration(history[history.length - 1]);
      if (!Number.isFinite(nrm)) return false;
      if (nrm < tolS) return true;
      seen.push(nrm);
      if (stallAfter && seen.length > stallAfter && nrm > 0.5 * seen[seen.length - 1 - stallAfter]) return false;
      if (hasS) rowS = new Float64Array(ND);
      jacobian(true);
      const fac = bandFactor(LU, ND, kl, ku); factorizations++;
      const y1 = Float64Array.from(res.R, v => -v);
      bandSolve(LU, fac, ND, kl, ku, y1);
      let dS = 0;
      if (hasS) {
        const y2 = bandSolve(LU, fac, ND, kl, ku, Float64Array.from(colS));
        let c1 = 0, c2 = 0;
        for (let d = 0; d < ND; d++) { c1 += rowS[d] * y1[d]; c2 += rowS[d] * y2[d]; }
        dS = (-res.rs - c1) / (dss - c2);
        for (let d = 0; d < ND; d++) y1[d] -= dS * y2[d];
      }
      // line search on the residual norm
      const s0 = Float64Array.from(sol), ss0 = sStar;
      let alpha = 1, ok = false;
      for (let ls = 0; ls < 8; ls++) {
        for (let d = 0; d < ND; d++) sol[d] = s0[d] + alpha * y1[d];
        sStar = ss0 + alpha * dS;
        try { const t = residual(); if (norms(t) < (1 - 1e-4 * alpha) * nrm || ls === 7) { ok = true; break; } } catch (e) { /* inverted element: shorter step */ }
        alpha *= 0.5;
      }
      if (!ok) { sol.set(s0); sStar = ss0; return false; }
    }
    res = residual();
    return norms(res) < tolS;
  }

  const lawVaries = Math.abs(o.mu(0.1 * gdRef) / o.mu(10 * gdRef) - 1) > 1e-9;
  const eps0 = Math.max(epsTarget, 0.1), tEnd = eps0 > epsTarget ? 2 : 1;
  const setPath = t => { sHom = Math.min(1, t); eps = t <= 1 ? eps0 : eps0 * Math.pow(epsTarget / eps0, Math.min(1, t - 1)); };
  let stages = 0;
  const xStart = Float64Array.from(sol), sStart = sStar;
  if (o.init || o.initNodal || !lawVaries) { setPath(tEnd); converged = o.homotopy ? newton(tol, Math.min(maxIter, 40), 6) : newton(tol, o.initNodal ? Math.min(maxIter, 25) : maxIter, o.initNodal ? 5 : 0); }
  if (!converged && o.homotopy) {
    // Newton alone did not make it from the starting state (a free surface far
    // from its start): follow the solutions of R(x) = (1 - lambda) R(x_start)
    // from lambda = 0 (the start itself) to 1, in adaptive steps
    sol.set(xStart); sStar = sStart; setPath(tEnd);
    shift = null; hLam = 1;
    const r0 = residual();
    shift = { R: r0.R, rs: r0.rs };
    let lam = 0, dl = 0.125, keep = Float64Array.from(sol), keepS = sStar;
    while (it < maxIter) {
      const l1 = Math.min(1, lam + dl), final = l1 === 1;
      hLam = l1; stages++;
      const itStart = it;
      const ok = newton(final ? tol : 1e-5, final ? maxIter : 10);
      if (ok) {
        if (final) { converged = true; break; }
        lam = l1; keep = Float64Array.from(sol); keepS = sStar;
        dl = Math.min(1 - lam, it - itStart <= 3 ? dl * 2 : dl);
      } else { sol.set(keep); sStar = keepS; dl *= 0.5; if (dl < 1 / 1024) break; }
      if (o.onIteration) o.onIteration({ it, residual: NaN, lambda: lam });
    }
    shift = null; hLam = 1;
  } else if (!converged && lawVaries && !o.init && !o.initNodal) {
    // continuation: Newtonian -> real rheology -> final regularization
    let t0 = 0, dt = 0.25, keep = Float64Array.from(sol), keepS = sStar;
    setPath(0); newton(1e-3, 30);
    keep = Float64Array.from(sol); keepS = sStar;
    while (it < maxIter) {
      const t1 = Math.min(tEnd, t0 + dt), final = t1 === tEnd;
      setPath(t1); stages++;
      const itStart = it;
      const ok = newton(final ? tol : 1e-3, final ? maxIter : 10);
      if (ok) { if (final) { converged = true; break; } t0 = t1; keep = Float64Array.from(sol); keepS = sStar; dt = Math.min(tEnd - t0, it - itStart <= 4 ? dt * 2 : dt); }
      else { sol.set(keep); sStar = keepS; dt *= 0.5; if (dt < 1 / 256) break; }
    }
  }
  setPath(tEnd);
  if (o.homotopy) { res = residual(); if (converged && !(norms(res) < 10 * tol)) converged = false; }
  placeNodes();

  // ---- output (dimensional), node arrays in spine-major order (n = c*NR + k) ----
  const xo = new Float64Array(NN), yo = new Float64Array(NN), uo = new Float64Array(NN), vo = new Float64Array(NN), po = new Float64Array(NN);
  for (let n = 0; n < NN; n++) { xo[n] = X[n] * Hr; yo[n] = Y[n] * Hr; uo[n] = sol[dU[n]] * Ur; vo[n] = sol[dV[n]] * Ur; }
  // pressure at every Q2 node from the bilinear element field
  for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) {
    const n = nid(c, k);
    if (dP[n] >= 0) { po[n] = sol[dP[n]] * Pr; continue; }
    const c0 = c - (c % 2), k0 = k - (k % 2);
    const pAt = (cc, kk) => sol[dP[nid(Math.min(cc, NC - 1), Math.min(kk, NR - 1))]];
    const fc = (c % 2) / 2, fk = (k % 2) / 2;
    po[n] = ((1 - fc) * (1 - fk) * pAt(c0, k0) + fc * (1 - fk) * pAt(c0 + 2, k0) + (1 - fc) * fk * pAt(c0, k0 + 2) + fc * fk * pAt(c0 + 2, k0 + 2)) * Pr;
  }
  // stream function: integrate d(psi)/d(eta) = u y_eta - v x_eta up each
  // spine from the web (psi = 0 there), Simpson over each element's three
  // nodes (and the matching quadratic rule to its mid node)
  const psi = new Float64Array(NN);
  for (let c = 0; c < NC; c++) for (let k = 0; k + 2 < NR; k += 2) {
    const n0 = nid(c, k), n1 = nid(c, k + 1), n2 = nid(c, k + 2);
    const xs = [xo[n0], xo[n1], xo[n2]], ys = [yo[n0], yo[n1], yo[n2]];
    // derivatives along the spine at the three nodes (parameter 0, 1, 2)
    const d = (a, t) => t === 0 ? (-3 * a[0] + 4 * a[1] - a[2]) / 2 : t === 1 ? (a[2] - a[0]) / 2 : (a[0] - 4 * a[1] + 3 * a[2]) / 2;
    const f = [n0, n1, n2].map((n, t) => uo[n] * d(ys, t) - vo[n] * d(xs, t));
    psi[n1] = psi[n0] + (5 * f[0] + 8 * f[1] - f[2]) / 12;
    psi[n2] = psi[n0] + (f[0] + 4 * f[1] + f[2]) / 3;
  }
  const Q = psi[nid(NC - 1, NR - 1)];
  // velocity gradient at every node: each element's Q2 derivative at its own nodes, averaged over the elements sharing the node
  const gUx = new Float64Array(NN), gUy = new Float64Array(NN), gVx = new Float64Array(NN), gVy = new Float64Array(NN), cnt = new Float64Array(NN);
  const at3 = [-1, 0, 1].map(x => ({ N: q2(x), dN: dq2(x) }));
  for (let ex = 0; ex < nEx; ex++) for (let ey = 0; ey < nEy; ey++) {
    const nodes = elemNodes(ex, ey);
    for (let bn = 0; bn < 3; bn++) for (let an = 0; an < 3; an++) {
      let xs = 0, xt = 0, ys = 0, yt = 0, us = 0, ut = 0, vs = 0, vt = 0;
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const n = nodes[b * 3 + a], Ns = at3[an].dN[a] * at3[bn].N[b], Nt = at3[an].N[a] * at3[bn].dN[b];
        xs += xo[n] * Ns; xt += xo[n] * Nt; ys += yo[n] * Ns; yt += yo[n] * Nt;
        us += uo[n] * Ns; ut += uo[n] * Nt; vs += vo[n] * Ns; vt += vo[n] * Nt;
      }
      const J = xs * yt - xt * ys, n = nodes[bn * 3 + an];
      gUx[n] += (yt * us - ys * ut) / J; gUy[n] += (xs * ut - xt * us) / J;
      gVx[n] += (yt * vs - ys * vt) / J; gVy[n] += (xs * vt - xt * vs) / J; cnt[n]++;
    }
  }
  const gdo = new Float64Array(NN), muo = new Float64Array(NN), txy = new Float64Array(NN), txx = new Float64Array(NN), tyy = new Float64Array(NN), omo = new Float64Array(NN);
  const epsDim = epsTarget * gdRef;
  for (let n = 0; n < NN; n++) {
    const ux = gUx[n] / cnt[n], uy = gUy[n] / cnt[n], vx = gVx[n] / cnt[n], vy = gVy[n] / cnt[n];
    const gd = Math.sqrt(2 * ux * ux + 2 * vy * vy + (uy + vx) * (uy + vx)), mu = o.mu(Math.sqrt(gd * gd + epsDim * epsDim));
    gdo[n] = gd; muo[n] = mu; txy[n] = mu * (uy + vx); txx[n] = 2 * mu * ux; tyy[n] = 2 * mu * vy; omo[n] = vx - uy;
  }
  const st = stNow();
  return {
    NC, NR, x: xo, y: yo, u: uo, v: vo, p: po, psi, gd: gdo, mu: muo, tauXY: txy, tauXX: txx, tauYY: tyy, omega: omo, Q, converged, iterations: it, factorizations, stages, history,
    residual: res ? norms(res) : Infinity, surface: st, scales: { Hr, Ur, muR, Pr, Re, Ca },
    state: { sol: Float64Array.from(sol), h: st.h, s: st.s },
  };
}

/**
 * Interpolate a solved flow (u, v, p at the nodes of result r's mesh) onto
 * other points: bilinear within the cells of r's node grid (located through
 * a bin grid), the nearest node for points outside r's domain. For warm
 * starts on a new mesh.
 */
function femInterpolate(r, X, Y) {
  const NC = r.NC, NR = r.NR, x = r.x, y = r.y, n = X.length;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < x.length; k++) { x0 = Math.min(x0, x[k]); x1 = Math.max(x1, x[k]); y0 = Math.min(y0, y[k]); y1 = Math.max(y1, y[k]); }
  const nb = 64, bins = Array.from({ length: nb * nb }, () => []);
  const bx = v => Math.min(nb - 1, Math.max(0, Math.floor((v - x0) / (x1 - x0) * nb))), by = v => Math.min(nb - 1, Math.max(0, Math.floor((v - y0) / (y1 - y0) * nb)));
  const id = (c, k) => c * NR + k;
  for (let c = 0; c < NC - 1; c++) for (let k = 0; k < NR - 1; k++) {
    const q = [id(c, k), id(c + 1, k), id(c, k + 1), id(c + 1, k + 1)];
    const qx = q.map(i => x[i]), qy = q.map(i => y[i]);
    for (let b = by(Math.min(...qy)); b <= by(Math.max(...qy)); b++) for (let a = bx(Math.min(...qx)); a <= bx(Math.max(...qx)); a++) bins[b * nb + a].push(c * NR + k);
  }
  const out = { u: new Float64Array(n), v: new Float64Array(n), p: new Float64Array(n) };
  for (let m = 0; m < n; m++) {
    const px = X[m], py = Y[m];
    let done = false;
    for (const cell of bins[by(py) * nb + bx(px)]) {
      const c = Math.floor(cell / NR), k = cell % NR, q = [id(c, k), id(c + 1, k), id(c, k + 1), id(c + 1, k + 1)];
      const ax = x[q[0]], ay = y[q[0]], bxv = x[q[1]] - ax, byv = y[q[1]] - ay, cxv = x[q[2]] - ax, cyv = y[q[2]] - ay;
      const dxv = x[q[3]] - x[q[1]] - x[q[2]] + ax, dyv = y[q[3]] - y[q[1]] - y[q[2]] + ay;
      let s = 0.5, t = 0.5;
      for (let it = 0; it < 10; it++) {
        const Fx = ax + bxv * s + cxv * t + dxv * s * t - px, Fy = ay + byv * s + cyv * t + dyv * s * t - py;
        const a11 = bxv + dxv * t, a12 = cxv + dxv * s, a21 = byv + dyv * t, a22 = cyv + dyv * s, det = a11 * a22 - a12 * a21;
        if (!(Math.abs(det) > 0)) break;
        s -= (a22 * Fx - a12 * Fy) / det; t -= (a11 * Fy - a21 * Fx) / det;
      }
      if (!(s > -1e-6 && s < 1 + 1e-6 && t > -1e-6 && t < 1 + 1e-6)) continue;
      const w = [(1 - s) * (1 - t), s * (1 - t), (1 - s) * t, s * t];
      for (const [f, dst] of [[r.u, out.u], [r.v, out.v], [r.p, out.p]]) dst[m] = w[0] * f[q[0]] + w[1] * f[q[1]] + w[2] * f[q[2]] + w[3] * f[q[3]];
      done = true; break;
    }
    if (!done) {
      let best = 0, bd = Infinity;
      for (let k = 0; k < x.length; k++) { const d = (x[k] - px) ** 2 + (y[k] - py) ** 2; if (d < bd) { bd = d; best = k; } }
      out.u[m] = r.u[best]; out.v[m] = r.v[best]; out.p[m] = r.p[best];
    }
  }
  return out;
}

/** Small dense solve (Gaussian elimination, partial pivoting). */
function femDense(A, b) {
  const m = b.length, M = A.map(r => Float64Array.from(r)), x = Float64Array.from(b);
  for (let k = 0; k < m; k++) {
    let p = k;
    for (let i = k + 1; i < m; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    [M[k], M[p]] = [M[p], M[k]]; [x[k], x[p]] = [x[p], x[k]];
    for (let i = k + 1; i < m; i++) { const f = M[i][k] / M[k][k]; if (f) { for (let j = k; j < m; j++) M[i][j] -= f * M[k][j]; x[i] -= f * x[k]; } }
  }
  for (let k = m - 1; k >= 0; k--) { let t = x[k]; for (let j = k + 1; j < m; j++) t -= M[k][j] * x[j]; x[k] = t / M[k][k]; }
  return x;
}

/**
 * Static meniscus (no flow; hydrostatic pressure under an ambient surface
 * whose far-field level is fInf): gamma kappa = rho g (f - fInf), from the
 * metering edge (xe, H) to xEnd, either pinned at the edge or with the
 * contact line on the exit face at contact angle theta_c (Gibbs decides).
 * Used as the starting shape for the coupled solve, and as a check.
 */
function staticMeniscus({ xe, H, faceDeg, contactDeg, gamma, rho, g, fInf, xEnd, n = 200, mode: force = null, sFix = null }) {
  const th = faceDeg * Math.PI / 180, alpha = (contactDeg + faceDeg - 180) * Math.PI / 180;
  // pin: the surface starts at the edge (or, s > 0, at that point of the face) at whatever angle; else at the contact angle
  const solve = (pin, s) => {
    const x0 = xe + s * Math.cos(th), y0 = H + s * Math.sin(th);
    const xs = Array.from({ length: n }, (_, i) => x0 + (xEnd - x0) * Math.pow(i / (n - 1), 1.5));
    let f = xs.map(() => fInf);
    for (let pass = 0; pass < 30; pass++) {
      const A = xs.map(() => new Float64Array(n)), b = new Float64Array(n);
      if (pin) { A[0][0] = 1; b[0] = y0; }
      else { const h1 = xs[1] - xs[0], h2 = xs[2] - xs[1]; A[0][0] = -(2 * h1 + h2) / (h1 * (h1 + h2)); A[0][1] = (h1 + h2) / (h1 * h2); A[0][2] = -h1 / (h2 * (h1 + h2)); b[0] = Math.tan(alpha); }
      for (let i = 1; i < n - 1; i++) {
        const hm = xs[i] - xs[i - 1], hp = xs[i + 1] - xs[i], sl = (f[i + 1] - f[i - 1]) / (hm + hp), w = gamma / Math.pow(1 + sl * sl, 1.5);
        A[i][i - 1] = w * 2 / (hm * (hm + hp)); A[i][i + 1] = w * 2 / (hp * (hm + hp)); A[i][i] = -w * 2 / (hm * hp) - rho * g; b[i] = -rho * g * fInf;
      }
      A[n - 1][n - 1] = 1; b[n - 1] = fInf;
      const fn = femDense(A, b);
      let d = 0; for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(fn[i] - f[i]));
      f = Array.from(fn);
      if (d < 1e-12) break;
    }
    return { xs, f };
  };
  const pinned = s => { const sol = solve(true, s); return { ...sol, alphaEdge: Math.atan((sol.f[1] - sol.f[0]) / (sol.xs[1] - sol.xs[0])) }; };
  if (force === 'pinned') return { mode: 'pinned', s: 0, ...pinned(0) };
  if (force === 'climbed' && sFix != null) return { mode: 'climbed', s: sFix, ...pinned(sFix) };   // held at that point of the face
  // climbed if the surface would meet the face above the edge, else pinned
  let s = H, sol = null;
  for (let k = 0; k < 60; k++) {
    sol = solve(false, s);
    const sNew = (sol.f[0] - H) / Math.sin(th);
    if (!(sNew > 0)) {
      // statically it stays at the edge; a caller forcing 'climbed' (the flow pulls it up) gets a start pinned a little up the face
      return force === 'climbed' ? { mode: 'climbed', s: 0.1 * H, ...pinned(0.1 * H) } : { mode: 'pinned', s: 0, ...pinned(0) };
    }
    if (Math.abs(sNew - s) < 1e-10) { s = sNew; break; }
    s = sNew;
  }
  return { mode: 'climbed', s, ...sol };
}

/**
 * The coating flow under the blade and beyond the metering edge, with the
 * meniscus and the free film solved together with the flow.
 *
 * Mesh (spines; see buildMesh): blade spines graded toward the edge and
 * turning to the edge corner's direction; a fan of spines on the exit face
 * up to the contact line (when it has climbed); free-surface spines whose
 * tops move along the starting surface's normal. Laid out for a given
 * contact-line height and starting surface.
 *
 * Strategy: no flow -- the static meniscus decides pinned / climbed and is
 * the starting shape. Flow -- pinned at the edge first; if the surface
 * leaves the edge flatter than Gibbs allows (theta_c + theta_face - 180),
 * the contact line climbs: released on the face from a little up, or, if
 * Newton does not get there, held at trial heights (continuation) until
 * the surface leaves it close to the contact angle, then released; the
 * mesh is then laid out again for where it settled. Each solve: flow with
 * the surface frozen (warm-started from the previous one when there is
 * one), then everything coupled.
 *
 * opts: hFn (blade height over [0, xe]), xe, faceDeg, contactDeg, U, Pup, rho, g, gamma,
 *       mu(gd), gdMin, Ld (free film kept in the domain), nEb, nEf, nEs, nEy, gradeB,
 *       gradeS, gradeY, fInfGuess (film thickness guess for the static start; default H),
 *       mode ('pinned' | 'climbed', no flow only: force it), webSlip (alpha / sqrt k, 1/m: Beavers-Joseph
 *       slip over the porous web; omitted = no slip), onStage(text), onIteration,
 *       onMesh / onLayout (test hooks: the mesh chosen, each layout's quality)
 * Returns solveFEM's result plus meshInfo { mode, cCL, cCorner, nEy, quality } and
 * meniscus { mode, alphaMaxDeg, s, leaveDeg, static }, or { error } for an unsupported case.
 */
function solveCoaterFEM(opts) {
  const { hFn, xe, faceDeg, contactDeg, U, Pup, rho, g, gamma, Ld } = opts;
  const H = hFn(xe), th = faceDeg * Math.PI / 180, alphaDeg = contactDeg + faceDeg - 180;
  const nEb = opts.nEb ?? 40, nEf = opts.nEf ?? 6, nEs = opts.nEs ?? 24, nEy = opts.nEy ?? 8, gradeB = opts.gradeB ?? 1.6, gradeS = opts.gradeS ?? 1.4, gradeY = opts.gradeY ?? 1.5;
  const xEnd = xe + Ld;
  const base = { U, rho, g, gamma, mu: opts.mu, gdMin: opts.gdMin, Hr: H, Ur: Math.abs(U) || 1e-3,
    inlet: { type: 'traction', p: y => Pup - rho * g * y }, outlet: { type: 'plug' }, flatEnd: !U, webSlip: opts.webSlip,
    tol: opts.tol, maxIter: opts.maxIter, onIteration: opts.onIteration };

  function buildMesh(mode, s0, stat, fan) {
    // face elements: nEf for a climb of H or more, fewer (at least one) for a short one
    const nF = mode === 'climbed' ? Math.max(1, Math.min(nEf, Math.ceil(nEf * s0 / H - 1e-9))) : 0, nEx = nEb + nF + nEs, NC = 2 * nEx + 1;
    const cCorner = 2 * nEb, cCL = 2 * (nEb + nF), M = 2 * nEs;
    // Each spine: a foot on the web, a top, and the slope dx/dy it arrives
    // at the top with (femNodes' Hermite shape). Directions below point from
    // the top back into the liquid.
    //  - contact-line spine: bisects the liquid wedge between the face (or,
    //    pinned, the blade's underside) and the surface leaving at its angle;
    //  - edge corner, contact line climbed: the corner is re-entrant (blade
    //    underside back to the face, 270 - face/2 degrees of liquid...), so its
    //    spine bisects it; one element either side then turns the corner;
    //  - face spines: directions interpolated between those two;
    //  - blade spines: vertical upstream, turning to the corner's direction
    //    over the last 1.5 H; free-surface spines: the contact line's slope
    //    decaying to vertical downstream.
    // Foot offset = r * slope * height with r >= 1/3, so no spine bends back.
    const aSurf = (mode === 'climbed' ? stat.alphaCL ?? alphaDeg : stat.alphaEdgeDeg) * Math.PI / 180;
    const aFace = mode === 'climbed' ? th + Math.PI : Math.PI;
    let a2 = aSurf; while (a2 < aFace) a2 += 2 * Math.PI;
    const betaCL = (aFace + a2) / 2;
    const beta0 = mode === 'climbed' ? 1.5 * Math.PI + th / 2 : betaCL;
    const cot = a => Math.cos(a) / Math.sin(a);
    const sigCL = cot(betaCL), r0 = fan.r0;
    const xCL0 = mode === 'climbed' ? xe + s0 * Math.cos(th) : xe, yCL0 = mode === 'climbed' ? H + s0 * Math.sin(th) : H;
    // lean0: fraction of the corner bisector's slope used; 'match' = the contact-line spine's slope
    // (a short face: the two spines end close together and must not cross)
    let sig0 = fan.lean0 === 'match' ? sigCL : cot(beta0) * fan.lean0, rCL = r0;
    if (mode === 'climbed') {
      // the face fan's feet must run forward from the corner's to the contact line's, leaving
      // gap = fan.gap x face length: the contact-line spine may bow (foot offset up to fan.rMax x
      // its top slope x height); if that is not enough (thin liquid wedge: near-vertical spine),
      // the corner spine leans less
      const gap = fan.gap * s0, f0 = () => xe - r0 * sig0 * H;
      rCL = Math.max(0.5, r0);
      if (sigCL < 0) rCL = Math.min(fan.rMax, Math.max(rCL, (f0() + gap - xCL0) / (-sigCL * yCL0)));
      const fCL = xCL0 - rCL * sigCL * yCL0;
      if (fCL - gap < f0() && sig0 < 0) sig0 = -Math.max(0.15, (fCL - gap - xe) / (r0 * H));
    }
    const footCL = xCL0 - rCL * sigCL * yCL0, footCorner = xe - r0 * sig0 * H;
    // blade x positions graded toward the edge: spacing there = 1/gradeB of the mean, never zero
    const aG = 1 / gradeB, xB = c => { const t = c / cCorner; return xe * (1 - (1 - t) * (aG + (1 - aG) * (1 - t))); };
    const Lr = 1.5 * H, sigB = c => { const w = Math.min(1, Math.max(0, (xB(c) - (xe - Lr)) / Lr)); return sig0 * w * w; };
    const hB = c => c === cCorner ? H : hFn(xB(c));
    // face spines (fraction t of the way from the edge to the contact line)
    const tF = c => (c - cCorner) / (cCL - cCorner);
    // face spines: foot, top and (top slope x height) all linear between the corner's and the contact
    // line's, so every node lies between those two spines (the Hermite shape is linear in them)
    const sigF = (c, st) => {
      const t = tF(c), yCL = H + st.s * Math.sin(th);
      return ((1 - t) * sig0 * H + t * sigCL * yCL) / ((1 - t) * H + t * yCL);
    };
    const footF = c => footCorner + tF(c) * (footCL - footCorner);
    // free-surface spines m = 0 (contact line) .. M: tops start on the static
    // curve, graded by arc length from the contact line, and move along that
    // curve's normal (a spine's own direction is near-tangent to a steep
    // meniscus, so it would be a poor line to move along) -- except within
    // about H of the contact line, where they move parallel to the face as
    // the contact line does (moving them normal to the surface there, in the
    // thin wedge, left Newton with a near-singular step); the feet and top
    // slopes relax from the contact-line spine's to vertical over Lw.
    const xs = stat.xs, fs = stat.f, nS = xs.length, arc = new Float64Array(nS);
    for (let i = 1; i < nS; i++) arc[i] = arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], fs[i] - fs[i - 1]);
    const xT0 = new Float64Array(M + 1), hT0 = new Float64Array(M + 1), kap = new Float64Array(M + 1);
    const kFace = mode === 'climbed' ? cot(th) : sigCL;                    // pinned: the contact-line spine's own direction
    // element ends graded; each element's middle spine at the middle of its arc (an off-centre
    // middle node distorts the quadratic edge, and its end tangent carries the contact angle)
    const Sv = m => arc[nS - 1] * Math.pow(m / M, gradeS);
    for (let m = 0, i = 0; m <= M; m++) {
      const S = m % 2 ? 0.5 * (Sv(m - 1) + Sv(m + 1)) : Sv(m);
      while (i < nS - 2 && arc[i + 1] < S) i++;
      const t = Math.min(1, (S - arc[i]) / (arc[i + 1] - arc[i]));
      xT0[m] = xs[i] + t * (xs[i + 1] - xs[i]); hT0[m] = fs[i] + t * (fs[i + 1] - fs[i]);
      // along the face near the contact line (as the contact line itself moves), turning to the curve's normal over H
      const kN = Math.max(-2, Math.min(2, -(fs[i + 1] - fs[i]) / (xs[i + 1] - xs[i]))), wb = Math.pow(1 - Math.min(1, S / H), 2);
      kap[m] = m === M ? 0 : wb * kFace + (1 - wb) * kN;
    }
    const dCL = footCL - xCL0, Lw = Math.max(4 * Math.abs(dCL), H);      // feet advance at least half as fast as the tops
    const wS = m => { const u = Math.min(1, (xT0[m] - xT0[0]) / Lw); return (1 - u) * (1 - u); };
    const h0 = new Float64Array(NC);
    for (let m = 1; m <= M; m++) h0[cCL + m] = hT0[m];
    // rows graded toward the blade / face / surface (element ends; middle rows halfway between)
    const etaV = j => 1 - Math.pow(1 - j / nEy, gradeY);
    const mesh = {
      nEx, nEy,
      eta: k => k % 2 ? 0.5 * (etaV((k - 1) / 2) + etaV((k + 1) / 2)) : etaV(k / 2),
      spineFoot: c => c <= cCorner ? xB(c) - r0 * sigB(c) * hB(c) : c <= cCL ? footF(c) : xT0[c - cCL] + dCL * wS(c - cCL),
      spineTop: (c, st) => {
        if (c <= cCorner) return [xB(c), hB(c)];
        if (c <= cCL) { const t = tF(c); return [xe + st.s * t * Math.cos(th), H + st.s * t * Math.sin(th)]; }
        const m = c - cCL, hgt = st.h[c];
        return [xT0[m] + kap[m] * (hgt - hT0[m]), hgt];
      },
      spineSlope: (c, st) => c <= cCorner ? sigB(c) : c <= cCL ? sigF(c, st) : sigCL * wS(c - cCL),
      kind: c => c > cCL ? 'free' : 'wall',
    };
    return { mesh, NC, cCL, cCorner, h0 };
  }

  if (alphaDeg < -86) return { error: `the surface would leave the exit face (near-)vertically or overhanging (exit-face angle + contact angle = ${(faceDeg + contactDeg).toFixed(1)}°, must be above 94°)` };
  if (alphaDeg > -5) return { error: `the surface would leave the exit face level or rising (exit-face angle + contact angle = ${(faceDeg + contactDeg).toFixed(1)}°, must be below 175°)` };
  const log = t => opts.onStage && opts.onStage(t);
  // the surface's direction (deg) where it leaves the contact line / edge: end tangent of the first quadratic surface edge
  const leaveDeg = (r, cCL) => {
    const NR = r.NR, d = dq2(-1);
    let tx = 0, ty = 0;
    for (let a = 0; a < 3; a++) { const n = (cCL + a) * NR + NR - 1; tx += r.x[n] * d[a]; ty += r.y[n] * d[a]; }
    return Math.atan2(ty, tx) * 180 / Math.PI;
  };
  /**
   * One solve on a fresh mesh. mode 'pinned': contact line at the edge.
   * 'climbed' with free = false: held at distance s up the face (surface angle there free);
   * free = true: on the face at the contact angle, starting from s.
   */
  function solveAt(mode, s, free, fInfNow, from, aUse = alphaDeg, iterCap = mode === 'climbed' && !free ? 80 : 200) {
    const stat = from ? shiftedCurve(from, mode, s) : staticMeniscus({ xe, H, faceDeg, contactDeg, gamma, rho, g, fInf: fInfNow, xEnd, mode, sFix: mode === 'climbed' && !free ? s : null });
    stat.alphaEdgeDeg = stat.alphaEdge != null ? stat.alphaEdge * 180 / Math.PI : alphaDeg;
    stat.alphaCL = aUse;
    const s0 = mode === 'climbed' ? stat.s : 0;
    // the corner/face fan is the delicate part of the mesh: try a few layouts, keep the best-shaped
    let m = null;
    for (const r0 of [1 / 3, 0.45, 0.6]) for (const gap of [0.5, 0.3, 0.15]) for (const rMax of [1.2, 2.5, 4]) for (const lean0 of [1, 0.7, 0.4, 'match']) {
      if (mode === 'pinned' && (gap !== 0.5 || rMax !== 1.2 || lean0 !== 1)) continue;
      const t = buildMesh(mode, s0, stat, { r0, gap, rMax, lean0 });
      t.quality = femQuality(t.mesh, { h: t.h0, s: s0 });
      if (opts.onLayout) opts.onLayout({ r0, gap, rMax, lean0 }, t.quality, s0);
      if (!m || t.quality > m.quality) m = t;
    }
    if (opts.onMesh) opts.onMesh(m, m.h0, s0, stat);
    if (!(m.quality > 0)) return { error: `no valid mesh for this geometry (face ${faceDeg} deg, contact angle ${contactDeg} deg)` };
    const where = mode === 'pinned' ? 'contact line at the edge' : free ? 'contact line free on the face' : `contact line held ${(s0 * 1e3).toFixed(3)} mm up the face`;
    log(`${where}: flow, surface frozen`);
    let frozen = null;
    if (from && from.r) {
      // warm start: the earlier solution interpolated onto this mesh, at the final rheology
      const { X, Y } = femNodes(m.mesh, { h: m.h0, s: s0 });
      frozen = solveFEM({ ...base, mesh: m.mesh, h0: c => m.h0[c], s0, freeze: true, contactLine: null, initNodal: femInterpolate(from.r, X, Y) });
    }
    if (!frozen || !frozen.converged) frozen = solveFEM({ ...base, mesh: m.mesh, h0: c => m.h0[c], s0, freeze: true, contactLine: null });
    if (!frozen.converged) return { error: 'flow with the surface frozen did not converge', r: frozen, m, stat };
    log(`${where}: surface and flow coupled`);
    // (held trial heights fail fast: a failure only halves the step toward them)
    const r = solveFEM({ ...base, mesh: m.mesh, init: frozen.state, contactLine: free ? { spine: m.cCL, faceFrom: m.cCorner, alphaDeg: aUse } : null, s0,
      homotopy: true, maxIter: Math.max(opts.maxIter ?? 0, iterCap) });
    r.meshInfo = { mode, cCL: m.cCL, cCorner: m.cCorner, nEy, quality: m.quality };
    if (!r.converged) return { error: 'surface and flow coupled did not converge', r, m, stat };
    return { r, m, stat, s: s0, leave: leaveDeg(r, m.cCL), alpha: aUse };
  }
  /**
   * Starting surface from an earlier solution: its surface polyline, with the contact-line end moved to
   * the new point (distance s up the face; 0 = the edge) and the change fading out over max(2|move|, H).
   */
  function shiftedCurve(from, mode, s) {
    const r = from.r, NR = r.NR, c0 = from.m.cCL, xs = [], f = [];
    for (let c = c0; c < r.NC; c++) { xs.push(r.x[c * NR + NR - 1]); f.push(r.y[c * NR + NR - 1]); }
    const P = mode === 'climbed' ? [xe + s * Math.cos(th), H + s * Math.sin(th)] : [xe, H];
    const dx = P[0] - xs[0], dy = P[1] - f[0], L = Math.max(2 * Math.hypot(dx, dy), H);
    let arc = 0;
    for (let i = 0; i < xs.length; i++) {
      if (i) arc += Math.hypot(xs[i] - xs[i - 1], f[i] - f[i - 1]);
      const w = Math.pow(Math.max(0, 1 - arc / L), 2);
      xs[i] += dx * w; f[i] += dy * w;
    }
    return { mode, s: mode === 'climbed' ? s : 0, xs, f, alphaEdge: Math.atan2(f[1] - f[0], xs[1] - xs[0]) };
  }
  /**
   * The face fan was laid out for the starting height; once the contact line has settled somewhere
   * else (by more than 15%), lay the mesh out again for where it is and solve again from that shape.
   */
  function remeshed(o, held = false) {
    for (let k = 0; k < 2; k++) {
      const sNow = held ? o.s : o.r.surface.s, sMesh = o.s;
      if (!(Math.abs(sNow - sMesh) > 0.15 * sMesh)) return o;
      const o2 = solveAt('climbed', sNow, !held, fInf, { ...o, s: sNow });
      if (o2.error || !(o2.r.surface.s > 0)) return o;
      log(`laid out again for ${(sNow * 1e3).toFixed(3)} mm: settled ${(o2.r.surface.s * 1e3).toFixed(3)} mm up`);
      o = o2;
    }
    return o;
  }
  const finish = (o, mode, extra) => {
    const r = o.r || {};
    if (o.error) r.error = o.error;
    r.meniscus = { mode, alphaMaxDeg: alphaDeg, s: r.surface ? r.surface.s : null, leaveDeg: o.leave, static: o.stat, ...extra };
    return r;
  };
  if (alphaDeg < -86) return { error: `the surface would leave the exit face (near-)vertically or overhanging (exit-face angle + contact angle = ${(faceDeg + contactDeg).toFixed(1)}°, must be above 94°)` };
  if (alphaDeg > -5) return { error: `the surface would leave the exit face level or rising (exit-face angle + contact angle = ${(faceDeg + contactDeg).toFixed(1)}°, must be below 175°)` };
  let fInf = opts.fInfGuess ?? H;

  if (!U) {
    // no flow: the static meniscus decides pinned / climbed and is the starting shape
    const st = staticMeniscus({ xe, H, faceDeg, contactDeg, gamma, rho, g, fInf, xEnd, mode: opts.mode ?? null });
    return st.mode === 'climbed' ? finish(solveAt('climbed', st.s, true, fInf), 'climbed') : finish(solveAt('pinned', 0, false, fInf), 'pinned');
  }

  // Flow: pinned at the edge first. Gibbs: pinned holds while the surface leaves the edge no flatter than
  // alpha = contact + face - 180 deg (and no steeper than contact - 180, the blade's underside dewetting).
  const pin = solveAt('pinned', 0, false, fInf);
  if (pin.error) return finish(pin, 'pinned');
  log(`pinned: surface leaves the edge at ${pin.leave.toFixed(2)} deg (pinned needs ${(contactDeg - 180).toFixed(0)} .. ${alphaDeg.toFixed(1)} deg)`);
  if (pin.leave < contactDeg - 180) return finish({ ...pin, error: 'the meniscus would recede under the blade (dewetting its underside): not modelled' }, 'pinned');
  if (pin.leave <= alphaDeg) return finish(pin, 'pinned');
  // It climbs the face. First try the contact line free on the face straight away, starting a little
  // up the face from the pinned shape; if Newton does not get there, bracket the height as below.
  fInf = pin.r.Q / U;
  {
    let o = solveAt('climbed', 0.1 * H, true, fInf, { ...pin, s: 0 }, alphaDeg, 60);
    if (!o.error && o.r.surface.s > 0) {
      log(`contact line free on the face: settled ${(o.r.surface.s * 1e3).toFixed(3)} mm up`);
      return finish(remeshed(o), 'climbed');
    }
  }
  // Continuation in the contact angle: held a little up the face, the surface leaves the contact line
  // at some angle a0 -- that solution is the free one for a0. Step the angle from a0 to alpha with the
  // contact line free (each step starting from the last, on the same mesh), laying the mesh out again
  // whenever the contact line has moved well away from where the mesh was laid out for.
  {
    let cur = solveAt('climbed', 0.1 * H, false, fInf, { ...pin, s: 0 });
    if (!cur.error) {
      let a = cur.leave, da = Math.sign(alphaDeg - a) * Math.min(Math.abs(alphaDeg - a), 10);
      cur = { ...cur, sNow: cur.s };
      log(`contact angle continuation from ${a.toFixed(1)}° to ${alphaDeg.toFixed(1)}°`);
      while (Math.abs(da) >= 0.25) {
        const a1 = Math.abs(alphaDeg - a) <= Math.abs(da) ? alphaDeg : a + da;
        const r1 = solveFEM({ ...base, mesh: cur.m.mesh, init: cur.r.state, contactLine: { spine: cur.m.cCL, faceFrom: cur.m.cCorner, alphaDeg: a1 }, s0: cur.sNow,
          homotopy: true, maxIter: 60 });
        if (r1.converged && r1.surface.s > 0) {
          r1.meshInfo = cur.r.meshInfo;
          cur = { ...cur, r: r1, sNow: r1.surface.s, leave: leaveDeg(r1, cur.m.cCL), alpha: a1 };
          a = a1;
          log(`contact angle ${(a + 180 - faceDeg).toFixed(1)}°: contact line ${(r1.surface.s * 1e3).toFixed(3)} mm up the face`);
          if (a === alphaDeg) return finish(remeshed({ ...cur, s: cur.s }), 'climbed');
          da *= 1.5;
          if (Math.abs(cur.sNow - cur.s) > 0.3 * cur.s) {
            // lay the mesh out again where the contact line now is
            const re = solveAt('climbed', cur.sNow, true, fInf, { ...cur, s: cur.sNow }, a);
            if (!re.error && re.r.surface.s > 0) cur = { ...re, sNow: re.r.surface.s };
          }
        } else da *= 0.5;
      }
    }
  }
  // Hold the contact line at trial heights s and find where the surface leaves it at
  // alpha (F = leave - alpha falls as s rises): march up from the edge in steps of at most H/4, each
  // started from the nearest solved surface, then Illinois false position inside the bracket.
  const F = o => o.leave - alphaDeg, solved = [{ ...pin, s: 0 }];
  const near = sv => solved.reduce((a, b) => Math.abs(b.s - sv) < Math.abs(a.s - sv) ? b : a);
  const held = sv => {
    // started from the nearest solved height; if that is too far a jump, step there in halves
    for (let tries = 0; tries < 5; tries++) {
      const from = near(sv), o = solveAt('climbed', sv, false, fInf, from);
      if (!o.error) { solved.push(o); log(`held ${(o.s * 1e3).toFixed(3)} mm up the face: surface leaves at ${o.leave.toFixed(2)} deg`); return o; }
      const mid = 0.5 * (from.s + sv), om = solveAt('climbed', mid, false, fInf, from);
      if (om.error) { sv = mid; continue; }
      solved.push(om);
    }
    return { error: 'the contact line could not be moved up the face' };
  };
  let A = solved[0], B = null, step = 0.1 * H;
  while (!B) {
    // secant estimate from the last two, limited to H/4 per step
    const P = solved.length > 1 ? solved[solved.length - 2] : null;
    let sv = A.s + step;
    if (P && F(P) !== F(A)) sv = Math.min(A.s + 0.25 * H, Math.max(A.s + 0.02 * H, A.s - F(A) * (A.s - P.s) / (F(A) - F(P))));
    if (sv > 8 * H) return finish({ ...A, error: 'the contact line would climb more than 8 gap heights up the face' }, 'climbed');
    const o = held(sv);
    if (o.error) return finish(o, 'climbed');
    if (F(o) <= 0) B = o; else A = o;
    if (!B && F(o) < 20) {
      // close: release the contact line from here
      const fr = solveAt('climbed', o.s, true, fInf, o);
      if (!fr.error && fr.r.surface.s > 0) { log(`contact line free on the face: settled ${(fr.r.surface.s * 1e3).toFixed(3)} mm up`); return finish(remeshed(fr), 'climbed'); }
    }
  }
  let Fa = F(A), Fb = F(B), best = Math.abs(Fa) < Math.abs(Fb) ? A : B;
  for (let k = 0; k < 8 && Math.abs(F(best)) > 0.5; k++) {
    const o = held(B.s - Fb * (B.s - A.s) / (Fb - Fa));
    if (o.error) return finish(o, 'climbed');
    const Fc = F(o);
    if (Fc * Fb < 0) { A = B; Fa = Fb; } else Fa *= 0.5;
    B = o; Fb = Fc;
    if (Math.abs(Fc) < Math.abs(F(best))) best = o;
  }
  if (best.s <= 0) return finish(pin, 'pinned');
  best = remeshed(best, true);
  // release: contact-angle condition, starting from the held solution on its own mesh
  log('contact line free on the face: final solve');
  const r = solveFEM({ ...base, mesh: best.m.mesh, init: best.r.state, contactLine: { spine: best.m.cCL, faceFrom: best.m.cCorner, alphaDeg }, s0: best.s,
    homotopy: true, maxIter: Math.max(opts.maxIter ?? 0, 200) });
  r.meshInfo = { mode: 'climbed', cCL: best.m.cCL, cCorner: best.m.cCorner, nEy, quality: best.m.quality };
  const fin = r.converged ? { r, m: best.m, stat: best.stat, leave: leaveDeg(r, best.m.cCL) } : { ...best, error: undefined, heldOnly: true };
  return finish(fin, 'climbed', r.converged ? {} : { note: 'contact-angle solve did not converge; result held at the bracketed height' });
}

/**
 * A solveCoaterFEM result as the post-processing grid (cfd-flowviz.js,
 * grid: 'curvilinear'): node (i, j) = spine i, row j, row-major k = j*nx + i,
 * coordinates gx, gy; i = 0 the inlet, j = 0 the web, j = ny-1 the top
 * boundary (blade underside, exit face up to the contact line at column
 * iCL, then the free surface), i = nx-1 the outlet in the film.
 * geo: { xe, H, faceDeg, contactDeg, U }.
 */
function coaterGrid(r, geo) {
  const nx = r.NC, ny = r.NR, N = nx * ny;
  const re = a => { const out = new Float64Array(N); for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out[j * nx + i] = a[i * ny + j]; return out; };
  const g = {
    grid: 'curvilinear', nx, ny, gx: re(r.x), gy: re(r.y), u: re(r.u), v: re(r.v), p: re(r.p), psi: re(r.psi),
    gd: re(r.gd), mu: re(r.mu), tauXY: re(r.tauXY), tauXX: re(r.tauXX), omega: re(r.omega),
  };
  const top = i => (ny - 1) * nx + i;
  const iCorner = r.meshInfo.cCorner, iCL = r.meshInfo.cCL;
  // pressure along the web and along the top boundary, and its extremes
  const xWeb = Array.from({ length: nx }, (_, i) => g.gx[i]), pWeb = Array.from({ length: nx }, (_, i) => g.p[i]);
  const xTop = Array.from({ length: nx }, (_, i) => g.gx[top(i)]), yTop = Array.from({ length: nx }, (_, i) => g.gy[top(i)]), pTop = Array.from({ length: nx }, (_, i) => g.p[top(i)]);
  let pMax = -Infinity, pMin = Infinity, kMax = 0, kMin = 0;
  for (let k = 0; k < N; k++) { if (g.p[k] > pMax) { pMax = g.p[k]; kMax = k; } if (g.p[k] < pMin) { pMin = g.p[k]; kMin = k; } }
  const Qin = g.psi[top(0)] - g.psi[0], Qout = g.psi[top(nx - 1)] - g.psi[nx - 1];
  return {
    ...g, Q: r.Q, Qin, Qout, massError: (Qout - Qin) / Qin,
    converged: r.converged, residual: r.residual, iterations: r.iterations, history: r.history, error: r.error,
    xe: geo.xe, H: geo.H, faceDeg: geo.faceDeg, contactDeg: geo.contactDeg,
    iCorner, iCL, mode: r.meniscus.mode, sCL: r.meniscus.mode === 'climbed' ? r.surface.s : 0,
    clX: g.gx[top(iCL)], clY: g.gy[top(iCL)], leaveDeg: r.meniscus.leaveDeg, alphaMaxDeg: r.meniscus.alphaMaxDeg,
    xEnd: g.gx[top(nx - 1)], hEnd: g.gy[top(nx - 1)],
    xWeb, pWeb, uWeb: Array.from({ length: nx }, (_, i) => g.u[i]), xTop, yTop, pTop, pMax, pMaxLoc: [g.gx[kMax], g.gy[kMax]], pMin, pMinLoc: [g.gx[kMin], g.gy[kMin]],
    pMinAtCorner: Math.hypot(g.gx[kMin] - geo.xe, g.gy[kMin] - geo.H) < 0.3 * geo.H,       // in the edge corner's singular zone
    mesh: { nEx: (nx - 1) / 2, nEy: (ny - 1) / 2, quality: r.meshInfo.quality },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { solveFEM, solveCoaterFEM, staticMeniscus, femNodes, femQuality, femInterpolate, coaterGrid, FEM_QP };
