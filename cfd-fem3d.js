/*
 * cfd-fem3d.js — steady 3D Navier–Stokes finite elements with a free surface: the 3D stage of
 * Flow (phase C). The same method as the 2D solver (cfd-fem.js), one dimension up, so a strip
 * with nothing varying across the web reproduces the 2D solution:
 *
 *  - Galerkin finite elements, Taylor–Hood Q2–Q1 hexahedra (triquadratic velocity, 27 nodes;
 *    trilinear continuous pressure, 8 vertices), isoparametric, 3x3x3 Gauss.
 *  - Generalized Newtonian (the 2D's rheology laws, regularized the same way), inertia, gravity.
 *  - Mesh: logically a box of spines. Spine (c, l) runs from the web up to the top boundary at
 *    column c along the flow and station l across the web; its nodes sit at fixed fractions up
 *    it (the 2D's Hermite spine shape in the x–y plane, z fixed per station).
 *  - Unknowns: u, v, w at every node, p at every vertex, the height of every free-surface spine,
 *    and the contact line's distance up the exit face at every station across the web — all
 *    solved together by Newton's method. The flow part of the Jacobian is analytic (including
 *    the shear-rate dependence of the viscosity); the geometry columns by finite differences of
 *    the residuals of the elements that hold the moved spine(s).
 *  - Free surface: kinematic condition (u.n = 0, one weighted row per surface node) and the
 *    traction condition sigma.n = gamma kappa n in the weak form integrated by parts over the
 *    surface, gamma (grad_s . w), written with the surface metric (no second derivatives).
 *  - Contact line on the exit face at each station: the surface leaves it at the contact angle
 *    (in the plane of the flow; a contact line that varies slowly across the web).
 *  - Sides of the strip: symmetry planes (w = 0, no shear), or walls (the duct check).
 *  - Linear algebra: banded LU (cfd-gap-solver.js's bandFactor / bandSolve), unknowns ordered
 *    column by column along the flow, so the band is a few columns' worth; the contact-line
 *    unknowns bordered (a small Schur complement).
 *
 * Pure computation, no DOM. Needs bandFactor and bandSolve as globals (the worker imports
 * cfd-gap-solver.js first; the Node check sets them).
 */

// ---------------------------------------------------------------------
// Reference element: Q2 hexahedron, node (a, b, g) = (along the flow, up a spine, across the
// web), index (g*3 + b)*3 + a; Q1 pressure on the vertices, index (g'*2 + b')*2 + a'.
// ---------------------------------------------------------------------
const F3_G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], F3_W = [5 / 9, 8 / 9, 5 / 9];
const f3q2 = x => [x * (x - 1) / 2, 1 - x * x, x * (x + 1) / 2];
const f3dq2 = x => [x - 0.5, -2 * x, x + 0.5];
const f3q1 = x => [(1 - x) / 2, (1 + x) / 2];
function f3Shape(xi, et, ze) {
  const A = f3q2(xi), B = f3q2(et), C = f3q2(ze), dA = f3dq2(xi), dB = f3dq2(et), dC = f3dq2(ze);
  const N = new Float64Array(27), Na = new Float64Array(27), Nb = new Float64Array(27), Ng = new Float64Array(27), P = new Float64Array(8);
  for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
    const i = (g * 3 + b) * 3 + a;
    N[i] = A[a] * B[b] * C[g]; Na[i] = dA[a] * B[b] * C[g]; Nb[i] = A[a] * dB[b] * C[g]; Ng[i] = A[a] * B[b] * dC[g];
  }
  const Pa = f3q1(xi), Pb = f3q1(et), Pc = f3q1(ze);
  for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) P[(g * 2 + b) * 2 + a] = Pa[a] * Pb[b] * Pc[g];
  return { N, Na, Nb, Ng, P };
}
const F3_QP = [];
for (let gz = 0; gz < 3; gz++) for (let gb = 0; gb < 3; gb++) for (let ga = 0; ga < 3; ga++) F3_QP.push({ w: F3_W[ga] * F3_W[gb] * F3_W[gz], ...f3Shape(F3_G[ga], F3_G[gb], F3_G[gz]) });
/** A face's 3x3 rule: 2D Q2 functions over the face's two directions (index t*3 + s), and the 3D element functions there. */
function f3FaceRule(fix, val) {
  const out = [];
  for (let gt = 0; gt < 3; gt++) for (let gs = 0; gs < 3; gs++) {
    const s = F3_G[gs], t = F3_G[gt], S = f3q2(s), T = f3q2(t), dS = f3dq2(s), dT = f3dq2(t);
    const N2 = new Float64Array(9), Ns = new Float64Array(9), Nt = new Float64Array(9);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { N2[j * 3 + i] = S[i] * T[j]; Ns[j * 3 + i] = dS[i] * T[j]; Nt[j * 3 + i] = S[i] * dT[j]; }
    const at = fix === 'eta' ? f3Shape(s, val, t) : f3Shape(val, s, t);
    out.push({ w: F3_W[gs] * F3_W[gt], N2, Ns, Nt, el: at });
  }
  return out;
}
const F3_BOTTOM = f3FaceRule('eta', -1), F3_TOP = f3FaceRule('eta', 1), F3_INLET = f3FaceRule('xi', -1), F3_OUTLET = f3FaceRule('xi', 1);

/**
 * Solve. Options (as solveFEM's in cfd-fem.js, one dimension up):
 *   mesh: { nEx, nEy, nEz, spineFoot(c, l), spineTop(c, l, st) -> [x, y], spineSlope?(c, l, st), eta?(k), z(l), kind(c): 'wall' | 'free' }
 *     st = { h: Float64Array(NC*NL) (free spines' heights, index c*NL + l), s: Float64Array(NL) (contact line up the face) }
 *   U (web speed, along x), webW (the web's speed along z: a blade skewed across the web, whose frame this is; 0),
 *   rho, g, gamma, mu(gd), gdMin, Hr, Ur (length and speed scales)
 *   inlet: { type: 'traction', p(y) } | { type: 'wall' }; outlet: { type: 'plug' } | { type: 'traction', p(y) } | { type: 'wall' }
 *   sides: 'symmetry' (default) | 'wall'; topSpeed (moving top wall, along x); webSlip (Beavers–Joseph alpha / sqrt k, 1/m)
 *   sideData: { lo, hi } a side held at a neighbouring strip's solution instead: { u, v, w (at the station's nodes c*NR + k,
 *     m/s), p (Pa, there), h (the free spines' heights, m, per c), s (the contact line, m) } (a region solved strip by strip;
 *     with webW both sides must be held: the flow along the blade passes through them)
 *   contactLine: { spine, faceFrom, alphaDeg (a number, or one per station) } or null; freeze (surface fixed)
 *   init: { sol, h, s } a previous state on the same layout; initNodal: { u, v, w, p } at the nodes (dimensional)
 *   homotopy, tol, maxIter, onIteration, label, onSolveStart, onSolveEnd
 *   checks: force(x, y, z) -> [fx, fy, fz] and exactBC(x, y, z) -> [u, v, w] (nondimensional; velocity set on every
 *     boundary node but an outlet of type 'stress': { type: 'stress', sigma(x, y, z) -> 3x3 }, the full stress there),
 *     fixPressure: value (nondimensional, at the first vertex; only for a boundary that is all velocity)
 */
function solveFEM3D(o) {
  const mesh = o.mesh, nEx = mesh.nEx, nEy = mesh.nEy, nEz = mesh.nEz;
  const NC = 2 * nEx + 1, NR = 2 * nEy + 1, NL = 2 * nEz + 1, NN = NC * NL * NR;
  const U = o.U || 0, rho = o.rho || 0, grav = o.g || 0, gamma = o.gamma || 0, Utop = o.topSpeed || 0;
  const tol = o.tol ?? 1e-8, maxIter = o.maxIter ?? 60;
  const nid = (c, l, k) => (c * NL + l) * NR + k, sid = (c, l) => c * NL + l;
  const kind = c => (mesh.kind ? mesh.kind(c) : 'wall');
  const free = new Uint8Array(NC); for (let c = 0; c < NC; c++) free[c] = kind(c) === 'free' ? 1 : 0;
  const CL = o.contactLine || null;
  const sideWall = o.sides === 'wall';
  // a side taken from a neighbouring strip's solution (a region solved strip by strip): velocity, surface heights, contact line there
  const sideOf = l => o.sideData ? (l === 0 ? o.sideData.lo : l === NL - 1 ? o.sideData.hi : null) : null;

  // ---- scales ----
  const Hr = o.Hr, Ur = o.Ur, gdRef = Ur / Hr, muR = o.mu(gdRef), Pr = muR * Ur / Hr;
  const epsTarget = (o.gdMin ?? 1e-3 * gdRef) / gdRef;
  let eps = epsTarget, sHom = 1;
  const muLaw = gd => o.mu(Math.sqrt(gd * gd + eps * eps) * gdRef) / muR;
  const muStar = gd => sHom === 1 ? muLaw(gd) : Math.pow(muLaw(gd), sHom);
  const muTan = gd => { if (!(gd > 0)) return muStar(0); const d = 1e-5, a = gd * (1 + d), b = gd * (1 - d); return (muStar(a) * a - muStar(b) * b) / (a - b); };
  const Re = rho * Ur * Hr / muR, Gr = rho * grav * Hr * Hr / (muR * Ur);
  const invCa = gamma ? gamma / (muR * Ur) : 0;
  const Us = U / Ur, Uts = Utop / Ur, Ws = (o.webW || 0) / Ur;
  if (Ws && !o.exactBC && !(sideOf(0) && sideOf(NL - 1))) throw new Error('a web moving along the blade (webW) needs both sides held (sideData lo and hi)');

  // ---- unknowns, column by column along the flow: u, v, w per node, p per vertex, then the column's spine heights ----
  const dU = new Int32Array(NN), dV = new Int32Array(NN), dW = new Int32Array(NN), dP = new Int32Array(NN).fill(-1), dH = new Int32Array(NC * NL).fill(-1);
  let nd = 0;
  for (let c = 0; c < NC; c++) {
    for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
      const n = nid(c, l, k);
      dU[n] = nd++; dV[n] = nd++; dW[n] = nd++;
      if (c % 2 === 0 && l % 2 === 0 && k % 2 === 0) dP[n] = nd++;
    }
    if (free[c]) for (let l = 0; l < NL; l++) dH[sid(c, l)] = nd++;
  }
  const ND = nd, hasS = !!CL && !o.freeze;

  // ---- node positions ----
  const X = new Float64Array(NN), Y = new Float64Array(NN), Z = new Float64Array(NN);
  const zl = new Float64Array(NL); for (let l = 0; l < NL; l++) zl[l] = mesh.z(l) / Hr;
  const etaK = new Float64Array(NR); for (let k = 0; k < NR; k++) etaK[k] = mesh.eta ? mesh.eta(k) : k / (NR - 1);
  const sol = new Float64Array(ND);
  const sStar = new Float64Array(NL);
  const stNow = () => {
    const h = new Float64Array(NC * NL);
    for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) h[sid(c, l)] = sol[dH[sid(c, l)]] * Hr;
    const s = new Float64Array(NL); for (let l = 0; l < NL; l++) s[l] = sStar[l] * Hr;
    return { h, s };
  };
  function placeSpine(c, l, st) {
    const xb = mesh.spineFoot(c, l), [xt, yt] = mesh.spineTop(c, l, st), D = xt - xb;
    const T = mesh.spineSlope ? mesh.spineSlope(c, l, st) * yt : 2 * D;
    for (let k = 0; k < NR; k++) {
      const e = etaK[k], e2 = e * e, n = nid(c, l, k);
      X[n] = (xb + D * e2 * (3 - 2 * e) + T * e2 * (e - 1)) / Hr; Y[n] = e * yt / Hr; Z[n] = zl[l];
    }
  }
  const placeNodes = () => { const st = stNow(); for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) placeSpine(c, l, st); };

  // ---- Dirichlet conditions ----
  const dirVal = new Float64Array(ND), isDir = new Uint8Array(ND);
  const setDir = (d, v) => { isDir[d] = 1; dirVal[d] = v; };
  const lamS = o.webSlip ? o.webSlip * Hr : 0;
  const onBoundary = (c, l, k) => c === 0 || c === NC - 1 || k === 0 || k === NR - 1 || l === 0 || l === NL - 1;
  if (o.exactBC) {
    placeNodes();
    for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
      if (!onBoundary(c, l, k) || (c === NC - 1 && o.outlet.type === 'stress' && k > 0 && k < NR - 1 && l > 0 && l < NL - 1)) continue;
      const n = nid(c, l, k), [ue, ve, we] = o.exactBC(X[n], Y[n], Z[n]);
      setDir(dU[n], ue); setDir(dV[n], ve); setDir(dW[n], we);
    }
  } else {
    for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) {
      const b = nid(c, l, 0), t = nid(c, l, NR - 1);
      if (!lamS) { setDir(dU[b], Us); setDir(dW[b], Ws); }
      setDir(dV[b], 0);                                                        // web
      if (!free[c]) { setDir(dU[t], Uts); setDir(dV[t], 0); setDir(dW[t], 0); }  // blade / face / contact line
    }
    for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
      const i = nid(0, l, k), e = nid(NC - 1, l, k);
      setDir(dV[i], 0); if (!Ws) setDir(dW[i], 0);                               // inlet: no cross-flow (the web moving along the blade: free)
      if (o.inlet.type === 'wall') setDir(dU[i], 0);
      if (o.outlet.type === 'plug') { setDir(dU[e], Us); setDir(dV[e], 0); setDir(dW[e], Ws); }   // (the film moves with the web)
      else if (o.outlet.type === 'wall') { setDir(dU[e], 0); setDir(dV[e], 0); setDir(dW[e], 0); }
      else { setDir(dV[e], 0); setDir(dW[e], 0); }
    }
    for (const l of [0, NL - 1]) for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) {
      const n = nid(c, l, k), sd = sideOf(l);
      if (sd) {
        // a neighbour's solution there -- the pressure too: its mass balance there would see only this strip's half of its elements
        setDir(dU[n], sd.u[c * NR + k] / Ur); setDir(dV[n], sd.v[c * NR + k] / Ur); setDir(dW[n], sd.w[c * NR + k] / Ur);
        if (dP[n] >= 0) setDir(dP[n], sd.p[c * NR + k] / Pr);
        continue;
      }
      setDir(dW[n], 0);                                                          // sides: symmetry (w = 0) ...
      if (sideWall) { setDir(dU[n], 0); setDir(dV[n], 0); }                      // ... or walls
    }
  }
  if (o.fixPressure != null) setDir(dP[nid(0, 0, 0)], o.fixPressure === true ? 0 : o.fixPressure);

  // ---- state ----
  if (o.h0) for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) sol[dH[sid(c, l)]] = o.h0(c, l) / Hr;
  if (o.s0) for (let l = 0; l < NL; l++) sStar[l] = (typeof o.s0 === 'function' ? o.s0(l) : o.s0) / Hr;
  if (o.init) {
    if (o.init.sol && o.init.sol.length === ND) sol.set(o.init.sol);
    if (o.init.h) for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) sol[dH[sid(c, l)]] = o.init.h[sid(c, l)] / Hr;
    if (o.init.s) for (let l = 0; l < NL; l++) sStar[l] = o.init.s[l] / Hr;
  }
  if (o.initNodal) {
    const q = o.initNodal;
    for (let n = 0; n < NN; n++) { sol[dU[n]] = q.u[n] / Ur; sol[dV[n]] = q.v[n] / Ur; sol[dW[n]] = (q.w ? q.w[n] : 0) / Ur; if (dP[n] >= 0) sol[dP[n]] = q.p[n] / Pr; }
  }
  const sFixed = new Array(NL).fill(null);
  for (const l of [0, NL - 1]) {
    const sd = sideOf(l);
    if (!sd) continue;
    for (let c = 0; c < NC; c++) if (free[c]) setDir(dH[sid(c, l)], sd.h[c] / Hr);
    if (sd.s != null) { sFixed[l] = sd.s / Hr; sStar[l] = sFixed[l]; }
  }
  for (let d = 0; d < ND; d++) if (isDir[d]) sol[d] = dirVal[d];
  if (o.freeze) for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) { const d = dH[sid(c, l)]; setDir(d, sol[d]); }

  // ---- elements ----
  const elemNodes = (ex, ey, ez, out) => {
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) out[(g * 3 + b) * 3 + a] = nid(2 * ex + a, 2 * ez + g, 2 * ey + b);
    return out;
  };
  const elemP = (ex, ey, ez, out) => {
    for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) out[(g * 2 + b) * 2 + a] = nid(2 * ex + 2 * a, 2 * ez + 2 * g, 2 * ey + 2 * b);
    return out;
  };
  const NL89 = 89;
  const RL = new Float64Array(NL89), KL = new Float64Array(NL89 * NL89);
  const nodesT = new Int32Array(27), pnT = new Int32Array(8), ldT = new Int32Array(NL89);
  const ue = new Float64Array(27), ve = new Float64Array(27), we = new Float64Array(27), xe = new Float64Array(27), ye = new Float64Array(27), ze = new Float64Array(27), pe = new Float64Array(8);
  const Nx = new Float64Array(27), Ny = new Float64Array(27), Nz = new Float64Array(27);
  const DNx = new Float64Array(27), DNy = new Float64Array(27), DNz = new Float64Array(27);
  /** Inverse Jacobian at a point: fills Nx, Ny, Nz from the element's node coordinates; returns det J. */
  function gradAt(Na, Nb, Ng) {
    let xa = 0, xb = 0, xg = 0, ya = 0, yb = 0, yg = 0, za = 0, zb = 0, zg = 0;
    for (let i = 0; i < 27; i++) {
      xa += xe[i] * Na[i]; xb += xe[i] * Nb[i]; xg += xe[i] * Ng[i];
      ya += ye[i] * Na[i]; yb += ye[i] * Nb[i]; yg += ye[i] * Ng[i];
      za += ze[i] * Na[i]; zb += ze[i] * Nb[i]; zg += ze[i] * Ng[i];
    }
    const det = xa * (yb * zg - yg * zb) - xb * (ya * zg - yg * za) + xg * (ya * zb - yb * za);
    const i00 = (yb * zg - yg * zb) / det, i10 = (yg * za - ya * zg) / det, i20 = (ya * zb - yb * za) / det;
    const i01 = (xg * zb - xb * zg) / det, i11 = (xa * zg - xg * za) / det, i21 = (xb * za - xa * zb) / det;
    const i02 = (xb * yg - xg * yb) / det, i12 = (xg * ya - xa * yg) / det, i22 = (xa * yb - xb * ya) / det;
    for (let i = 0; i < 27; i++) {
      Nx[i] = Na[i] * i00 + Nb[i] * i10 + Ng[i] * i20;
      Ny[i] = Na[i] * i01 + Nb[i] * i11 + Ng[i] * i21;
      Nz[i] = Na[i] * i02 + Nb[i] * i12 + Ng[i] * i22;
    }
    return det;
  }
  function gatherElement(ex, ey, ez) {
    elemNodes(ex, ey, ez, nodesT); elemP(ex, ey, ez, pnT);
    for (let a = 0; a < 27; a++) { const n = nodesT[a]; ue[a] = sol[dU[n]]; ve[a] = sol[dV[n]]; we[a] = sol[dW[n]]; xe[a] = X[n]; ye[a] = Y[n]; ze[a] = Z[n]; }
    for (let a = 0; a < 8; a++) pe[a] = sol[dP[pnT[a]]];
    for (let a = 0; a < 27; a++) { ldT[a] = dU[nodesT[a]]; ldT[27 + a] = dV[nodesT[a]]; ldT[54 + a] = dW[nodesT[a]]; }
    for (let i = 0; i < 8; i++) ldT[81 + i] = dP[pnT[i]];
  }
  /** Element residual (and its analytic Jacobian in the element's u, v, w, p). Local order u0..u26, v0..v26, w0..w26, p0..p7. */
  function element(ex, ey, ez, withK, newton) {
    gatherElement(ex, ey, ez);
    RL.fill(0); if (withK) KL.fill(0);
    for (const q of F3_QP) {
      const J = gradAt(q.Na, q.Nb, q.Ng);
      if (!(J > 0)) throw new Error(`inverted element (${ex}, ${ey}, ${ez})`);
      let u = 0, v = 0, w = 0, ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0, p = 0, X0 = 0, Y0 = 0, Z0 = 0;
      for (let a = 0; a < 27; a++) {
        const N = q.N[a];
        u += ue[a] * N; v += ve[a] * N; w += we[a] * N;
        ux += ue[a] * Nx[a]; uy += ue[a] * Ny[a]; uz += ue[a] * Nz[a];
        vx += ve[a] * Nx[a]; vy += ve[a] * Ny[a]; vz += ve[a] * Nz[a];
        wx += we[a] * Nx[a]; wy += we[a] * Ny[a]; wz += we[a] * Nz[a];
        if (o.force) { X0 += xe[a] * N; Y0 += ye[a] * N; Z0 += ze[a] * N; }
      }
      for (let a = 0; a < 8; a++) p += pe[a] * q.P[a];
      const Dxy = 0.5 * (uy + vx), Dxz = 0.5 * (uz + wx), Dyz = 0.5 * (vz + wy);
      const gd = Math.sqrt(2 * (ux * ux + vy * vy + wz * wz) + 4 * (Dxy * Dxy + Dxz * Dxz + Dyz * Dyz));
      const mu = muStar(gd), wd = q.w * J;
      const txx = 2 * mu * ux, tyy = 2 * mu * vy, tzz = 2 * mu * wz, txy = 2 * mu * Dxy, txz = 2 * mu * Dxz, tyz = 2 * mu * Dyz, div = ux + vy + wz;
      const cu = Re * (u * ux + v * uy + w * uz), cv = Re * (u * vx + v * vy + w * vz) + Gr, cw = Re * (u * wx + v * wy + w * wz);
      let fx = 0, fy = 0, fz = 0;
      if (o.force) [fx, fy, fz] = o.force(X0, Y0, Z0);
      for (let a = 0; a < 27; a++) {
        const N = q.N[a];
        RL[a] += wd * ((cu - fx) * N + txx * Nx[a] + txy * Ny[a] + txz * Nz[a] - p * Nx[a]);
        RL[27 + a] += wd * ((cv - fy) * N + txy * Nx[a] + tyy * Ny[a] + tyz * Nz[a] - p * Ny[a]);
        RL[54 + a] += wd * ((cw - fz) * N + txz * Nx[a] + tyz * Ny[a] + tzz * Nz[a] - p * Nz[a]);
      }
      for (let i = 0; i < 8; i++) RL[81 + i] -= wd * q.P[i] * div;
      if (!withK) continue;
      // tangent: d tau : grad w = 2 mu dD : Dw + c4 (D : dD)(D : Dw), c4 = 4 (mu_t - mu) / gd^2 (Newton only)
      const c4 = newton && gd > 0 ? 4 * (muTan(gd) - mu) / (gd * gd) : 0;
      for (let b = 0; b < 27; b++) {
        DNx[b] = ux * Nx[b] + Dxy * Ny[b] + Dxz * Nz[b];
        DNy[b] = Dxy * Nx[b] + vy * Ny[b] + Dyz * Nz[b];
        DNz[b] = Dxz * Nx[b] + Dyz * Ny[b] + wz * Nz[b];
      }
      const gu = [ux, uy, uz, vx, vy, vz, wx, wy, wz];     // gu[j*3 + i] = d u_j / d x_i
      const dN = [Nx, Ny, Nz], DN = [DNx, DNy, DNz];
      for (let a = 0; a < 27; a++) {
        const Na = q.N[a], ax = Nx[a], ay = Ny[a], az = Nz[a];
        const wa = wd;
        for (let b = 0; b < 27; b++) {
          const Nb = q.N[b], bx = Nx[b], by = Ny[b], bz = Nz[b];
          const base = mu * (ax * bx + ay * by + az * bz) + Re * (u * bx + v * by + w * bz) * Na;
          const ReNN = Re * Nb * Na;
          for (let j = 0; j < 3; j++) {
            const dja = dN[j][a], DNja = DN[j][a], row = (j * 27 + a) * NL89;
            for (let i = 0; i < 3; i++) {
              let K = mu * dN[i][a] * dN[j][b] + c4 * DN[i][b] * DNja + ReNN * gu[j * 3 + i];
              if (i === j) K += base;
              KL[row + i * 27 + b] += wa * K;
            }
          }
        }
        for (let i = 0; i < 8; i++) {
          const Pi = wd * q.P[i];
          KL[a * NL89 + 81 + i] -= Pi * ax; KL[(27 + a) * NL89 + 81 + i] -= Pi * ay; KL[(54 + a) * NL89 + 81 + i] -= Pi * az;
          KL[(81 + i) * NL89 + a] -= Pi * ax; KL[(81 + i) * NL89 + 27 + a] -= Pi * ay; KL[(81 + i) * NL89 + 54 + a] -= Pi * az;
        }
      }
    }
  }

  // ---- boundary terms ----
  /** Beavers–Joseph slip on the web under element (ex, ez): tau = mu lamS (u - U) along x, mu lamS (w - webW) across; out[27]: u rows, [27..53]: w rows of the bottom face nodes (element-local a + 27 g... as 9 face nodes). */
  const slipOut = new Float64Array(18);
  function slipFace(ex, ez) {
    slipOut.fill(0);
    gatherElement(ex, 0, ez);
    for (const f of F3_BOTTOM) {
      const q = f.el;
      gradAt(q.Na, q.Nb, q.Ng);
      let u = 0, w = 0, ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
      let xs = 0, ys = 0, zs = 0, xt = 0, yt = 0, zt = 0;
      for (let a = 0; a < 27; a++) {
        u += ue[a] * q.N[a]; w += we[a] * q.N[a];
        ux += ue[a] * Nx[a]; uy += ue[a] * Ny[a]; uz += ue[a] * Nz[a];
        vx += ve[a] * Nx[a]; vy += ve[a] * Ny[a]; vz += ve[a] * Nz[a];
        wx += we[a] * Nx[a]; wy += we[a] * Ny[a]; wz += we[a] * Nz[a];
      }
      for (let g = 0; g < 3; g++) for (let a = 0; a < 3; a++) {
        const i = (g * 3 + 0) * 3 + a, j = g * 3 + a;
        xs += xe[i] * f.Ns[j]; ys += ye[i] * f.Ns[j]; zs += ze[i] * f.Ns[j]; xt += xe[i] * f.Nt[j]; yt += ye[i] * f.Nt[j]; zt += ze[i] * f.Nt[j];
      }
      const dA = Math.hypot(ys * zt - zs * yt, zs * xt - xs * zt, xs * yt - ys * xt);
      const Dxy = 0.5 * (uy + vx), Dxz = 0.5 * (uz + wx), Dyz = 0.5 * (vz + wy);
      const gd = Math.sqrt(2 * (ux * ux + vy * vy + wz * wz) + 4 * (Dxy * Dxy + Dxz * Dxz + Dyz * Dyz));
      const m = muStar(gd) * lamS;
      for (let j = 0; j < 9; j++) { slipOut[j] += f.w * m * (u - Us) * f.N2[j] * dA; slipOut[9 + j] += f.w * m * (w - Ws) * f.N2[j] * dA; }
    }
  }
  const bottomNode = (ex, ez, j) => nid(2 * ex + (j % 3), 2 * ez + Math.floor(j / 3), 0);
  /** Inlet (c = 0) or outlet (c = NC-1) traction -p_b(y) n over the face of element (ey, ez); type 'stress' (checks): the full stress sigma(x, y, z) (nondimensional). */
  function tractionFace(R, side, ey, ez) {
    const c = side === 'in' ? 0 : NC - 1, bc = side === 'in' ? o.inlet : o.outlet, pf = bc.p, sgn = side === 'in' ? -1 : 1;
    const rule = side === 'in' ? F3_INLET : F3_OUTLET;
    const ns = new Int32Array(9);
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) ns[g * 3 + b] = nid(c, 2 * ez + g, 2 * ey + b);
    for (const f of rule) {
      let x = 0, y = 0, z = 0, xs = 0, ys = 0, zs = 0, xt = 0, yt = 0, zt = 0;
      for (let j = 0; j < 9; j++) { const n = ns[j]; x += X[n] * f.N2[j]; y += Y[n] * f.N2[j]; z += Z[n] * f.N2[j]; xs += X[n] * f.Ns[j]; ys += Y[n] * f.Ns[j]; zs += Z[n] * f.Ns[j]; xt += X[n] * f.Nt[j]; yt += Y[n] * f.Nt[j]; zt += Z[n] * f.Nt[j]; }
      // (s up the spine, t across) : X_s x X_t points along +x; outward = sgn times that
      const nx = sgn * (ys * zt - zs * yt), ny = sgn * (zs * xt - xs * zt), nz = sgn * (xs * yt - ys * xt);
      let tx, ty, tz;    // the traction (force per area) the outside applies: -int t . w dA
      if (bc.type === 'stress') { const S = bc.sigma(x, y, z); tx = S[0][0] * nx + S[0][1] * ny + S[0][2] * nz; ty = S[1][0] * nx + S[1][1] * ny + S[1][2] * nz; tz = S[2][0] * nx + S[2][1] * ny + S[2][2] * nz; }
      else { const pb = pf(y * Hr) / Pr; tx = -pb * nx; ty = -pb * ny; tz = -pb * nz; }
      for (let j = 0; j < 9; j++) { const n = ns[j], s = f.w * f.N2[j]; R[dU[n]] -= s * tx; R[dV[n]] -= s * ty; R[dW[n]] -= s * tz; }
    }
  }
  /** Free surface over the top face of the elements in column ex, station ez: surface tension, kinematic rows. */
  const topNs = new Int32Array(9);
  function surfaceFace(R, addK, ex, ez) {
    for (let g = 0; g < 3; g++) for (let a = 0; a < 3; a++) topNs[g * 3 + a] = nid(2 * ex + a, 2 * ez + g, NR - 1);
    for (const f of F3_TOP) {
      let xs = 0, ys = 0, zs = 0, xt = 0, yt = 0, zt = 0, u = 0, v = 0, w = 0;
      for (let j = 0; j < 9; j++) {
        const n = topNs[j];
        xs += X[n] * f.Ns[j]; ys += Y[n] * f.Ns[j]; zs += Z[n] * f.Ns[j]; xt += X[n] * f.Nt[j]; yt += Y[n] * f.Nt[j]; zt += Z[n] * f.Nt[j];
        u += sol[dU[n]] * f.N2[j]; v += sol[dV[n]] * f.N2[j]; w += sol[dW[n]] * f.N2[j];
      }
      if (invCa) {
        const g11 = xs * xs + ys * ys + zs * zs, g12 = xs * xt + ys * yt + zs * zt, g22 = xt * xt + yt * yt + zt * zt, dg = g11 * g22 - g12 * g12, sg = Math.sqrt(dg);
        const a11 = g22 / dg, a12 = -g12 / dg, a22 = g11 / dg;
        // + (1/Ca) int grad_s . w dA = (1/Ca) int g^{ab} X_a . w_b sqrt(g)
        const Sx = [a11 * xs + a12 * xt, a12 * xs + a22 * xt], Sy = [a11 * ys + a12 * yt, a12 * ys + a22 * yt], Sz = [a11 * zs + a12 * zt, a12 * zs + a22 * zt];
        for (let j = 0; j < 9; j++) {
          const n = topNs[j], c = f.w * invCa * sg;
          R[dU[n]] += c * (Sx[0] * f.Ns[j] + Sx[1] * f.Nt[j]);
          R[dV[n]] += c * (Sy[0] * f.Ns[j] + Sy[1] * f.Nt[j]);
          R[dW[n]] += c * (Sz[0] * f.Ns[j] + Sz[1] * f.Nt[j]);
        }
      }
      // kinematic: int u . n dA phi, n dA = X_t x X_s (up)
      const nx = yt * zs - zt * ys, ny = zt * xs - xt * zs, nz = xt * ys - yt * xs;
      for (let j = 0; j < 9; j++) {
        const n = topNs[j], c = 2 * ex + (j % 3), l = 2 * ez + Math.floor(j / 3), d = dH[sid(c, l)];
        if (d < 0) continue;
        R[d] += f.w * (u * nx + v * ny + w * nz) * f.N2[j];
        if (addK) for (let m = 0; m < 9; m++) { const nm = topNs[m], s = f.w * f.N2[m] * f.N2[j]; addK(d, dU[nm], s * nx); addK(d, dV[nm], s * ny); addK(d, dW[nm], s * nz); }
      }
    }
  }
  const topFree = ex => free[2 * ex] || free[2 * ex + 1] || free[2 * ex + 2];
  /** Contact-angle condition at station l: the surface leaves the contact line along the prescribed direction (in the x–y plane). */
  const dQ0 = f3dq2(-1);
  function contactResidual(l) {
    if (sFixed[l] != null) return sStar[l] - sFixed[l];     // (a side station held at its neighbour's contact line)
    const c = CL.spine;
    let xt = 0, yt = 0;
    for (let a = 0; a < 3; a++) { const n = nid(c + a, l, NR - 1); xt += X[n] * dQ0[a]; yt += Y[n] * dQ0[a]; }
    const al = (typeof CL.alphaDeg === 'number' ? CL.alphaDeg : CL.alphaDeg[l]) * Math.PI / 180;
    return (yt * Math.cos(al) - xt * Math.sin(al)) / Math.hypot(xt, yt);
  }

  /** Residual contributions of elements ex0..ex1 x ez0..ez1 (all rows; nodes already placed). */
  function partialResidual(ex0, ex1, ez0, ez1, R, addK) {
    for (let ex = ex0; ex <= ex1; ex++) for (let ez = ez0; ez <= ez1; ez++) {
      for (let ey = 0; ey < nEy; ey++) {
        element(ex, ey, ez, false, false);
        for (let q = 0; q < NL89; q++) R[ldT[q]] += RL[q];
      }
      if (lamS) { slipFace(ex, ez); for (let j = 0; j < 9; j++) { const n = bottomNode(ex, ez, j); R[dU[n]] += slipOut[j]; R[dW[n]] += slipOut[9 + j]; } }
      if (ex === 0 && (o.inlet.type === 'traction' || o.inlet.type === 'stress')) for (let ey = 0; ey < nEy; ey++) tractionFace(R, 'in', ey, ez);
      if (ex === nEx - 1 && (o.outlet.type === 'traction' || o.outlet.type === 'stress')) for (let ey = 0; ey < nEy; ey++) tractionFace(R, 'out', ey, ez);
      if (topFree(ex)) surfaceFace(R, addK, ex, ez);
    }
  }

  // ---- global residual ----
  let shift = null, hLam = 1;
  function residual() {
    placeNodes();
    const R = new Float64Array(ND);
    partialResidual(0, nEx - 1, 0, nEz - 1, R, null);
    for (let d = 0; d < ND; d++) if (isDir[d]) R[d] = sol[d] - dirVal[d];
    const rs = new Float64Array(hasS ? NL : 0);
    if (hasS) for (let l = 0; l < NL; l++) rs[l] = contactResidual(l);
    if (shift) {
      const f = 1 - hLam;
      for (let d = 0; d < ND; d++) if (!isDir[d]) R[d] -= f * shift.R[d];
      for (let l = 0; l < rs.length; l++) rs[l] -= f * shift.rs[l];
    }
    return { R, rs };
  }

  // ---- the band: the widest reach of any element's unknowns (and the heights of its spines) ----
  let kl = 0;
  {
    const nodes = new Int32Array(27), pn = new Int32Array(8);
    for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) {
      elemNodes(ex, ey, ez, nodes); elemP(ex, ey, ez, pn);
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 27; a++) { const n = nodes[a]; lo = Math.min(lo, dU[n]); hi = Math.max(hi, dW[n]); }
      for (let i = 0; i < 8; i++) { lo = Math.min(lo, dP[pn[i]]); hi = Math.max(hi, dP[pn[i]]); }
      for (let a = 0; a < 3; a++) for (let g = 0; g < 3; g++) { const d = dH[sid(2 * ex + a, 2 * ez + g)]; if (d >= 0) { lo = Math.min(lo, d); hi = Math.max(hi, d); } }
      kl = Math.max(kl, hi - lo);
    }
  }
  const ku = kl, W = 2 * kl + ku + 1;
  const LU = new Float64Array(ND * W);
  const addK = (r, c, v) => { if (!isDir[r]) LU[r * W + c - r + kl] += v; };

  // ---- Jacobian: analytic flow part, finite-difference geometry columns; contact-line unknowns bordered ----
  let colS = null, rowS = null, dss = null;
  function jacobian(newton) {
    LU.fill(0);
    placeNodes();
    const rs0 = hasS ? Float64Array.from({ length: NL }, (_, l) => contactResidual(l)) : null;
    for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) {
      element(ex, ey, ez, true, newton);
      for (let a = 0; a < NL89; a++) {
        const r = ldT[a];
        if (isDir[r]) continue;
        const base = r * W - r + kl, row = a * NL89;
        for (let b = 0; b < NL89; b++) { const v = KL[row + b]; if (v !== 0) LU[base + ldT[b]] += v; }
      }
    }
    // boundary terms (kinematic rows' flow part analytic)
    const scratch = new Float64Array(ND);
    for (let ex = 0; ex < nEx; ex++) if (topFree(ex)) for (let ez = 0; ez < nEz; ez++) surfaceFace(scratch, addK, ex, ez);
    if (lamS) {
      // the slip term's Jacobian (with the wall viscosity's shear-rate dependence), by differences per element
      const b0 = new Float64Array(18), nodes = new Int32Array(27);
      for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) {
        slipFace(ex, ez); b0.set(slipOut);
        elemNodes(ex, 0, ez, nodes);
        for (const n of nodes) for (const d of [dU[n], dV[n], dW[n]]) {
          if (isDir[d]) continue;
          const keep = sol[d], h = 1e-7 * Math.max(1, Math.abs(keep));
          sol[d] = keep + h; slipFace(ex, ez); sol[d] = keep;
          for (let j = 0; j < 9; j++) { const bn = bottomNode(ex, ez, j); addK(dU[bn], d, (slipOut[j] - b0[j]) / h); addK(dW[bn], d, (slipOut[9 + j] - b0[9 + j]) / h); }
        }
      }
    }
    for (let d = 0; d < ND; d++) if (isDir[d]) LU[d * W + kl] = 1;
    // geometry columns: a spine's height moves that spine's nodes only; s at station l moves the face spines there
    const Rb = new Float64Array(ND), Rp = new Float64Array(ND);
    const around = (i, n) => [Math.max(0, Math.ceil(i / 2) - 1), Math.min(n - 1, Math.floor(i / 2))];
    for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) {
      const d = dH[sid(c, l)];
      if (isDir[d]) continue;
      const keep = sol[d], dh = 1e-7 * Math.max(1, Math.abs(keep));
      const [ex0, ex1] = around(c, nEx), [ez0, ez1] = around(l, nEz);
      Rb.fill(0); Rp.fill(0);
      partialResidual(ex0, ex1, ez0, ez1, Rb, null);             // (nodes at the current state)
      sol[d] = keep + dh; placeSpine(c, l, stNow());
      partialResidual(ex0, ex1, ez0, ez1, Rp, null);
      const rsl = hasS && c <= CL.spine + 2 ? contactResidual(l) : 0;
      sol[d] = keep; placeSpine(c, l, stNow());
      for (let r = Math.max(0, d - kl), rEnd = Math.min(ND - 1, d + kl); r <= rEnd; r++) {
        if (isDir[r]) continue;
        const v = (Rp[r] - Rb[r]) / dh;
        if (v !== 0) LU[r * W + d - r + kl] += v;
      }
      if (hasS && c <= CL.spine + 2) rowS[l][d] = (rsl - rs0[l]) / dh;
    }
    if (hasS) {
      colS = []; dss = Array.from({ length: NL }, () => new Float64Array(NL));
      const [ex0, ex1] = [Math.max(0, Math.ceil((CL.faceFrom ?? 0) / 2) - 1), Math.min(nEx - 1, Math.floor(CL.spine / 2))];
      for (let l = 0; l < NL; l++) {
        const [ez0, ez1] = around(l, nEz), keep = sStar[l], ds = 1e-7 * Math.max(1, Math.abs(keep));
        Rb.fill(0); Rp.fill(0);
        partialResidual(ex0, ex1, ez0, ez1, Rb, null);
        const placeStation = () => { const st = stNow(); for (let c = 0; c < NC; c++) placeSpine(c, l, st); };
        sStar[l] = keep + ds; placeStation();
        partialResidual(ex0, ex1, ez0, ez1, Rp, null);
        const rsl = contactResidual(l);
        sStar[l] = keep; placeStation();
        const col = new Float64Array(ND);
        for (let r = 0; r < ND; r++) if (!isDir[r]) col[r] = (Rp[r] - Rb[r]) / ds;
        colS.push(col);
        dss[l][l] = (rsl - rs0[l]) / ds;
      }
    }
    placeNodes();
  }

  // ---- Newton with line search; continuation from a Newtonian fluid; homotopy for a far start ----
  const history = [];
  let it = 0, converged = false, res = null, factorizations = 0, msFactor = 0;
  let pathDone = null;   // (how far along its continuation or homotopy the solve is, 0..1, for the progress bars; none: Newton alone)
  const solveId = o.onSolveStart ? o.onSolveStart(o.label || '') : undefined;
  const norms = r => {
    let fm = 0;
    for (let d = 0; d < ND; d++) { if (isDir[d]) continue; const a = Math.abs(r.R[d]); if (a > fm) fm = a; }
    for (let l = 0; l < r.rs.length; l++) fm = Math.max(fm, Math.abs(r.rs[l]));
    return fm;
  };
  function newton(tolS, maxS, stallAfter = 0) {
    const seen = [];
    for (let k = 0; k < maxS && it < maxIter; k++, it++) {
      res = residual();
      const nrm = norms(res);
      history.push({ it, residual: nrm, s: sHom, path: pathDone });
      if (o.onIteration) o.onIteration(history[history.length - 1]);
      if (!Number.isFinite(nrm)) return false;
      if (nrm < tolS) return true;
      seen.push(nrm);
      if (stallAfter && seen.length > stallAfter && nrm > 0.5 * seen[seen.length - 1 - stallAfter]) return false;
      if (hasS) rowS = Array.from({ length: NL }, () => new Float64Array(ND));
      // (an element turned inside out by the Jacobian's small geometry steps: this solve fails, instead of the whole run stopping)
      { const keep = Float64Array.from(sol), keepS = Float64Array.from(sStar); try { jacobian(true); } catch (e) { sol.set(keep); sStar.set(keepS); placeNodes(); return false; } }
      const t0 = Date.now();
      const fac = bandFactor(LU, ND, kl, ku); factorizations++; msFactor += Date.now() - t0;
      const y1 = Float64Array.from(res.R, v => -v);
      bandSolve(LU, fac, ND, kl, ku, y1);
      const dS = new Float64Array(hasS ? NL : 0);
      if (hasS) {
        // bordered: [A B; C D] [y; ds] = [-R; -rs]  ->  (D - C A^-1 B) ds = -rs - C A^-1 (-R)
        const Y2 = colS.map(col => bandSolve(LU, fac, ND, kl, ku, Float64Array.from(col)));
        const Sm = Array.from({ length: NL }, () => new Array(NL).fill(0)), rhs = new Array(NL).fill(0);
        for (let a = 0; a < NL; a++) {
          let c1 = 0; for (let d = 0; d < ND; d++) c1 += rowS[a][d] * y1[d];
          rhs[a] = -res.rs[a] - c1;
          for (let b = 0; b < NL; b++) { let c2 = 0; const y = Y2[b]; for (let d = 0; d < ND; d++) c2 += rowS[a][d] * y[d]; Sm[a][b] = dss[a][b] - c2; }
        }
        const x = f3Dense(Sm, rhs);
        for (let l = 0; l < NL; l++) { dS[l] = x[l]; const y = Y2[l]; for (let d = 0; d < ND; d++) y1[d] -= x[l] * y[d]; }
      }
      const s0 = Float64Array.from(sol), ss0 = Float64Array.from(sStar);
      let alpha = 1, ok = false;
      for (let ls = 0; ls < 8; ls++) {
        for (let d = 0; d < ND; d++) sol[d] = s0[d] + alpha * y1[d];
        for (let l = 0; l < dS.length; l++) sStar[l] = ss0[l] + alpha * dS[l];
        try { const t = residual(); if (norms(t) < (1 - 1e-4 * alpha) * nrm || ls === 7) { ok = true; break; } } catch (e) { /* inverted element: shorter step */ }
        alpha *= 0.5;
      }
      if (!ok) { sol.set(s0); sStar.set(ss0); return false; }
    }
    res = residual();
    return norms(res) < tolS;
  }

  const lawVaries = Math.abs(o.mu(0.1 * gdRef) / o.mu(10 * gdRef) - 1) > 1e-9;
  const eps0 = Math.max(epsTarget, 0.1), tEnd = eps0 > epsTarget ? 2 : 1;
  const setPath = t => { sHom = Math.min(1, t); eps = t <= 1 ? eps0 : eps0 * Math.pow(epsTarget / eps0, Math.min(1, t - 1)); };
  let stages = 0;
  const xStart = Float64Array.from(sol), sStart = Float64Array.from(sStar);
  if (o.init || o.initNodal || !lawVaries) { setPath(tEnd); converged = o.homotopy ? newton(tol, Math.min(maxIter, 40), 6) : newton(tol, maxIter); }
  if (!converged && o.homotopy) {
    sol.set(xStart); sStar.set(sStart); setPath(tEnd);
    shift = null; hLam = 1;
    const r0 = residual();
    shift = { R: r0.R, rs: r0.rs };
    let lam = 0, dl = 0.125, keep = Float64Array.from(sol), keepS = Float64Array.from(sStar);
    while (it < maxIter) {
      const l1 = Math.min(1, lam + dl), final = l1 === 1;
      hLam = l1; stages++; pathDone = lam;
      const itStart = it;
      const ok = newton(final ? tol : 1e-5, final ? maxIter : 10);
      if (ok) {
        if (final) { converged = true; break; }
        lam = l1; keep = Float64Array.from(sol); keepS = Float64Array.from(sStar);
        dl = Math.min(1 - lam, it - itStart <= 3 ? dl * 2 : dl);
      } else { sol.set(keep); sStar.set(keepS); dl *= 0.5; if (dl < 1 / 1024) break; }
      if (o.onIteration) o.onIteration({ it, residual: NaN, lambda: lam });
    }
    shift = null; hLam = 1;
  } else if (!converged && lawVaries && !o.init && !o.initNodal) {
    let t0 = 0, dt = 0.25, keep, keepS;
    pathDone = 0; setPath(0); newton(1e-3, 30);
    keep = Float64Array.from(sol); keepS = Float64Array.from(sStar);
    while (it < maxIter) {
      const t1 = Math.min(tEnd, t0 + dt), final = t1 === tEnd;
      setPath(t1); stages++; pathDone = t0 / tEnd;
      const itStart = it;
      const ok = newton(final ? tol : 1e-3, final ? maxIter : 10);
      if (ok) { if (final) { converged = true; break; } t0 = t1; keep = Float64Array.from(sol); keepS = Float64Array.from(sStar); dt = Math.min(tEnd - t0, it - itStart <= 4 ? dt * 2 : dt); }
      else { sol.set(keep); sStar.set(keepS); dt *= 0.5; if (dt < 1 / 256) break; }
    }
  }
  setPath(tEnd);
  if (o.homotopy) { res = residual(); if (converged && !(norms(res) < 10 * tol)) converged = false; }
  placeNodes();

  // ---- output (dimensional), node arrays in the solver's order n = (c*NL + l)*NR + k ----
  const xo = new Float64Array(NN), yo = new Float64Array(NN), zo = new Float64Array(NN), uo = new Float64Array(NN), vo = new Float64Array(NN), wo = new Float64Array(NN), po = new Float64Array(NN);
  for (let n = 0; n < NN; n++) { xo[n] = X[n] * Hr; yo[n] = Y[n] * Hr; zo[n] = Z[n] * Hr; uo[n] = sol[dU[n]] * Ur; vo[n] = sol[dV[n]] * Ur; wo[n] = sol[dW[n]] * Ur; }
  // pressure at every node from the trilinear element field
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
    const n = nid(c, l, k);
    if (dP[n] >= 0) { po[n] = sol[dP[n]] * Pr; continue; }
    const c0 = Math.min(c - (c % 2), NC - 3), l0 = Math.min(l - (l % 2), NL - 3), k0 = Math.min(k - (k % 2), NR - 3);
    const fc = (c - c0) / 2, fl = (l - l0) / 2, fk = (k - k0) / 2;
    let s = 0;
    for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const wgt = (a ? fc : 1 - fc) * (g ? fl : 1 - fl) * (b ? fk : 1 - fk);
      if (wgt) s += wgt * sol[dP[nid(c0 + 2 * a, l0 + 2 * g, k0 + 2 * b)]];
    }
    po[n] = s * Pr;
  }
  // flow rate per unit width at every station and column: int u dy up the spine (Simpson over each element's three nodes) -- for spines that are vertical at the outlet
  const q = new Float64Array(NC * NL);
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) {
    let s = 0;
    for (let k = 0; k + 2 < NR; k += 2) {
      const n0 = nid(c, l, k), n1 = n0 + 1, n2 = n0 + 2;
      // along the spine: d psi = u dy - v dx
      const d = (a, t) => t === 0 ? (-3 * a[0] + 4 * a[1] - a[2]) / 2 : t === 1 ? (a[2] - a[0]) / 2 : (a[0] - 4 * a[1] + 3 * a[2]) / 2;
      const ys = [yo[n0], yo[n1], yo[n2]], xs = [xo[n0], xo[n1], xo[n2]];
      const f = [n0, n1, n2].map((n, t) => uo[n] * d(ys, t) - vo[n] * d(xs, t));
      s += (f[0] + 4 * f[1] + f[2]) / 3;
    }
    q[sid(c, l)] = s;
  }
  // shear rate and viscosity at every node: each element's velocity gradient at its own nodes, averaged over the elements sharing the node
  const gdo = new Float64Array(NN), muo = new Float64Array(NN), cnt = new Float64Array(NN);
  {
    const at3 = [-1, 0, 1];
    const shapes = [];
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) shapes.push(f3Shape(at3[a], at3[b], at3[g]));
    const epsDim = epsTarget * gdRef;
    for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) {
      gatherElement(ex, ey, ez);
      for (let i = 0; i < 27; i++) {
        const q = shapes[i];
        gradAt(q.Na, q.Nb, q.Ng);
        let ux = 0, uy = 0, uz = 0, vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0;
        for (let a = 0; a < 27; a++) {
          ux += ue[a] * Nx[a]; uy += ue[a] * Ny[a]; uz += ue[a] * Nz[a];
          vx += ve[a] * Nx[a]; vy += ve[a] * Ny[a]; vz += ve[a] * Nz[a];
          wx += we[a] * Nx[a]; wy += we[a] * Ny[a]; wz += we[a] * Nz[a];
        }
        const Dxy = 0.5 * (uy + vx), Dxz = 0.5 * (uz + wx), Dyz = 0.5 * (vz + wy);
        const n = nodesT[i];
        gdo[n] += Math.sqrt(2 * (ux * ux + vy * vy + wz * wz) + 4 * (Dxy * Dxy + Dxz * Dxz + Dyz * Dyz)) * gdRef; cnt[n]++;
      }
    }
    for (let n = 0; n < NN; n++) { gdo[n] /= cnt[n] || 1; muo[n] = o.mu(Math.sqrt(gdo[n] * gdo[n] + epsDim * epsDim)); }
  }
  const st = stNow(), resid = res ? norms(res) : Infinity;
  if (o.onSolveEnd) o.onSolveEnd({ converged, residual: resid, iterations: it });
  return {
    NC, NR, NL, nEx, nEy, nEz, x: xo, y: yo, z: zo, u: uo, v: vo, w: wo, p: po, gd: gdo, mu: muo, q, converged, iterations: it, factorizations, stages, history, solveId,
    residual: resid, surface: st, scales: { Hr, Ur, muR, Pr, Re, Ca: invCa ? 1 / invCa : Infinity },
    size: { unknowns: ND, band: kl, bytes: LU.byteLength, msFactor },
    state: { sol: Float64Array.from(sol), h: st.h, s: st.s },
  };
}

/**
 * The flow along the blade at a station, from its 2D solution (the blade skewed across the web: the web moves along it at
 * webW): d/dx(mu dw/dx) + d/dy(mu dw/dy) = 0 on the station's mesh (its 9-node elements) -- the station as if the blade went
 * on unchanged along it (nothing varies along it, no pressure along it). The viscosity at each quadrature point from the
 * shear rate there, as the 3D solver takes it (the 2D's in-plane shear and this flow's own, a few passes until they agree;
 * mu(gd) the law, gdMin its floor), not interpolated between nodes (a yield-stress slurry's viscosity jumps within an element).
 * w = webW on the web (or, with slip, mu dw/dy = mu slip (w - webW) there), 0 on the blade and exit face, webW at the
 * outlet (the film moves with the web); no shear on the free surface and at the inlet (outlet: 'free' for checks).
 * r: solveCoaterFEM's result with keepMesh (x, y, u, v, NC, NR, meshDef). Returns w at the nodes (c*NR + k), m/s.
 */
function stationLateral(r, webW, { webSlip = 0, outlet = 'plug', mu, gdMin = 0, passes = 4 } = {}) {
  const NC = r.NC, NR = r.NR, N = NC * NR, nEx = (NC - 1) / 2, nEy = (NR - 1) / 2, kind = r.meshDef && r.meshDef.mesh.kind;
  const kl = 2 * NR + 2, W = 3 * kl + 1;
  const G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], GW = [5 / 9, 8 / 9, 5 / 9];
  const q = (t, o) => { o[0] = 0.5 * t * (t - 1); o[1] = 1 - t * t; o[2] = 0.5 * t * (t + 1); }, dq = (t, o) => { o[0] = t - 0.5; o[1] = -2 * t; o[2] = t + 0.5; };
  const qa = new Float64Array(3), qb = new Float64Array(3), da = new Float64Array(3), db = new Float64Array(3), nodes = new Int32Array(9), Nx = new Float64Array(9), Ny = new Float64Array(9);
  // (no law given, checks: the nodes' viscosity, interpolated in its logarithm so it stays positive)
  const muAt = (gd, i) => mu ? mu(Math.sqrt(gd * gd + gdMin * gdMin)) : Math.exp(i);
  let w = new Float64Array(N);
  for (let pass = 0; pass < passes; pass++) {
    const A = new Float64Array(N * W), b = new Float64Array(N);
    const add = (i, j, v) => { A[i * W + j - i + kl] += v; };
    for (let ex = 0; ex < nEx; ex++) for (let ey = 0; ey < nEy; ey++) {
      for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) nodes[a * 3 + c] = (2 * ex + a) * NR + 2 * ey + c;
      for (let gi = 0; gi < 3; gi++) for (let gj = 0; gj < 3; gj++) {
        q(G[gi], qa); q(G[gj], qb); dq(G[gi], da); dq(G[gj], db);
        let xs = 0, xt = 0, ys = 0, yt = 0, lm = 0;
        for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
          const n = nodes[a * 3 + c], Ns = da[a] * qb[c], Nt = qa[a] * db[c];
          xs += Ns * r.x[n]; xt += Nt * r.x[n]; ys += Ns * r.y[n]; yt += Nt * r.y[n]; if (!mu) lm += qa[a] * qb[c] * Math.log(r.mu[n]);
        }
        const det = xs * yt - xt * ys;
        let ux = 0, uy = 0, vx = 0, vy = 0, wx = 0, wy = 0;
        for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
          const i = a * 3 + c, n = nodes[i], Ns = da[a] * qb[c], Nt = qa[a] * db[c];
          Nx[i] = (yt * Ns - ys * Nt) / det; Ny[i] = (-xt * Ns + xs * Nt) / det;
          ux += r.u[n] * Nx[i]; uy += r.u[n] * Ny[i]; vx += r.v[n] * Nx[i]; vy += r.v[n] * Ny[i]; wx += w[n] * Nx[i]; wy += w[n] * Ny[i];
        }
        const gd = Math.sqrt(2 * (ux * ux + vy * vy) + (uy + vx) * (uy + vx) + wx * wx + wy * wy);
        const wq = GW[gi] * GW[gj] * Math.abs(det) * muAt(gd, lm);
        for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) add(nodes[i], nodes[j], wq * (Nx[i] * Nx[j] + Ny[i] * Ny[j]));
        // slip on the web under the element: mu slip (w - webW) along its bottom edge, mu at this column's bottom quadrature point
        if (webSlip && ey === 0 && gj === 0) {
          let es = 0, et = 0;
          for (let a = 0; a < 3; a++) { const n = nodes[a * 3]; es += da[a] * r.x[n]; et += da[a] * r.y[n]; }
          const ws = GW[gi] * Math.hypot(es, et) * muAt(gd, lm) * webSlip;
          for (let a = 0; a < 3; a++) { b[nodes[a * 3]] += ws * webW * qa[a]; for (let c = 0; c < 3; c++) add(nodes[a * 3], nodes[c * 3], ws * qa[a] * qa[c]); }
        }
      }
    }
    const dir = (n, v) => { for (let j = Math.max(0, n - kl); j <= Math.min(N - 1, n + kl); j++) A[n * W + j - n + kl] = 0; A[n * W + kl] = 1; b[n] = v; };
    for (let c = 0; c < NC; c++) {
      if (!webSlip) dir(c * NR, webW);                                        // the web
      if (!kind || kind(c) !== 'free') dir(c * NR + NR - 1, 0);                // the blade, the exit face up to the contact line
    }
    if (outlet === 'plug') for (let k = 0; k < NR; k++) dir((NC - 1) * NR + k, webW);
    const f = bandFactor(A, N, kl, kl);
    bandSolve(A, f, N, kl, kl, b);
    w = b;
    if (!mu) break;   // (fixed viscosity: one pass)
  }
  return w;
}
/**
 * Each station across a region solved in 2D at its own gap and contact angle (solveCoaterFEM, its mesh
 * layout kept), with the same number of elements up the exit face at every station: those layouts side
 * by side are the 3D mesh, and those solutions its starting state. The meniscus mode (pinned at the edge,
 * or climbed up the face) must be the same at every station.
 * opts: solveCoaterFEM's, and dH(z), contactAt(z), hAt(z) (see solveCoater3D); zs: the stations (m, from
 * the region's reference); ref: the station whose 2D sets the face elements (default the middle); only: a
 * set of the stations to solve (the rest left empty; ref is always solved -- a worker's share of a wide region).
 * With opts.webW (a skewed blade), each solved station's flow along the blade too (stationLateral): w2.
 * Returns { r2: per station, w2, M: their meshes, mode, climbed, cCL, cCorner, NC, NR, H, ms } or { error }.
 */
function coaterStations(opts, zs, ref = (zs.length - 1) >> 1, only = null) {
  const log = t => opts.onStage && opts.onStage(t), NL = zs.length, t0 = Date.now();
  const dHl = zs.map(z => (opts.dH ? opts.dH(z) : 0)), thl = zs.map(z => (opts.contactAt ? opts.contactAt(z) : opts.contactDeg));
  const hl = l => opts.hAt ? opts.hAt(zs[l]) : x => opts.hFn(x) + dHl[l];
  const solve2 = (l, extra) => solveCoaterFEM({ ...opts, hFn: hl(l), contactDeg: thl[l], keepMesh: true, ...extra });
  const r2 = new Array(NL);
  log(`2D at ${(zs[ref] * 1e3).toFixed(1)} mm`);
  r2[ref] = solve2(ref, {});
  const r0 = r2[ref];
  if (r0.error || !r0.meshDef || !r0.converged) return { error: `2D at ${(zs[ref] * 1e3).toFixed(1)} mm: ` + (r0.error || 'did not converge'), r2 };
  const mode = r0.meniscus.mode, climbed = mode === 'climbed', m0 = r0.meshDef, nF = (m0.cCL - m0.cCorner) / 2;
  for (let l = 0; l < NL; l++) {
    if (l === ref || (only && !only.has(l))) continue;
    if (!opts.hAt && dHl[l] === dHl[ref] && thl[l] === thl[ref]) { r2[l] = r0; continue; }
    log(`2D at ${(zs[l] * 1e3).toFixed(1)} mm${opts.hAt ? '' : ` (gap ${dHl[l] >= 0 ? '+' : ''}${(dHl[l] * 1e6).toFixed(1)} µm)`}`);
    const r = solve2(l, climbed ? { nFaceFixed: nF } : {});
    if (r.error || !r.converged || !r.meshDef) return { error: `2D at ${(zs[l] * 1e3).toFixed(1)} mm: ${r.error || 'did not converge'}`, r2 };
    if (r.meniscus.mode !== mode || r.meshDef.NC !== m0.NC || r.meshDef.cCL !== m0.cCL)
      return { error: `the meniscus is ${mode} at ${(zs[ref] * 1e3).toFixed(1)} mm but ${r.meniscus.mode} at ${(zs[l] * 1e3).toFixed(1)} mm: a region where it changes is not modelled`, r2 };
    r2[l] = r;
  }
  const w2 = opts.webW ? r2.map(r => r ? stationLateral(r, opts.webW, { webSlip: opts.webSlip, mu: opts.mu, gdMin: opts.gdMin }) : null) : null;
  return { r2, w2, M: r2.map(r => r ? r.meshDef.mesh : null), zs, thl, mode, climbed, cCL: m0.cCL, cCorner: m0.cCorner, NC: m0.NC, NR: 2 * m0.mesh.nEy + 1, H: hl(ref)(opts.xe), ms: Date.now() - t0 };
}
/** A station's state from its 2D solution: u, v, w, p at its nodes (c*NR + k), the free spines' heights, the contact line (w: its flow along the blade, or none). */
const stationFrom2D = (r, w) => ({ u: Float64Array.from(r.u), v: Float64Array.from(r.v), w: w ? Float64Array.from(w) : new Float64Array(r.u.length), p: Float64Array.from(r.p), h: Float64Array.from(r.state.h), s: r.surface.s });
/** Station l's state from the station set's 2D (with its flow along the blade when the web moves along it). */
const stationState = (S, l) => stationFrom2D(S.r2[l], S.w2 && S.w2[l]);
/** Station j's state from a 3D result (and its node positions, shear rate, viscosity, flow rate, for the output). */
function stationFrom3D(r3, j) {
  const NC = r3.NC, NR = r3.NR, NL = r3.NL, n = NC * NR, o = { u: new Float64Array(n), v: new Float64Array(n), w: new Float64Array(n), p: new Float64Array(n), x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), gd: new Float64Array(n), mu: new Float64Array(n), h: new Float64Array(NC) };
  for (let c = 0; c < NC; c++) {
    for (let k = 0; k < NR; k++) { const a = c * NR + k, b = (c * NL + j) * NR + k; for (const f of ['u', 'v', 'w', 'p', 'x', 'y', 'z', 'gd', 'mu']) o[f][a] = r3[f][b]; }
    o.h[c] = r3.surface.h[c * NL + j];
  }
  o.s = r3.surface.s[j]; o.q = r3.q[(NC - 1) * NL + j];
  return o;
}
/**
 * The 3D over stations l0..l1 (an even count of intervals) of a station set: their 2D meshes side by side;
 * each side symmetric, or held at the station's current state (sideLo / sideHi: a neighbouring strip's, or, the web
 * moving along the blade (opts.webW), the station's own: its flow as if the blade went on unchanged); starting from the stations' states.
 */
function coaterStrip3D(opts, S, l0, l1, state, sideLo = false, sideHi = false, extra = {}) {
  const NL = l1 - l0 + 1, nEz = (NL - 1) / 2, NC = S.NC, NR = S.NR, M = S.M;
  let cacheSt = null, rows = [];
  const st2 = (st, j) => {
    if (st !== cacheSt) { cacheSt = st; rows = []; }
    if (!rows[j]) { const h = new Float64Array(NC); for (let c = 0; c < NC; c++) h[c] = st.h[c * NL + j]; rows[j] = { h, s: st.s[j] }; }
    return rows[j];
  };
  const M0 = M[l0];
  const mesh = {
    nEx: M0.nEx, nEy: M0.nEy, nEz, eta: M0.eta, z: j => S.zs[l0 + j], kind: M0.kind,
    spineFoot: (c, j) => M[l0 + j].spineFoot(c),
    spineTop: (c, j, st) => M[l0 + j].spineTop(c, st2(st, j)),
    spineSlope: M0.spineSlope ? (c, j, st) => M[l0 + j].spineSlope(c, st2(st, j)) : undefined,
  };
  const NN = NC * NL * NR, u = new Float64Array(NN), v = new Float64Array(NN), w = new Float64Array(NN), p = new Float64Array(NN);
  for (let c = 0; c < NC; c++) for (let j = 0; j < NL; j++) for (let k = 0; k < NR; k++) {
    const n3 = (c * NL + j) * NR + k, n2 = c * NR + k, T = state[l0 + j];
    u[n3] = T.u[n2]; v[n3] = T.v[n2]; w[n3] = T.w[n2]; p[n3] = T.p[n2];
  }
  const side = T => ({ u: T.u, v: T.v, w: T.w, p: T.p, h: T.h, s: S.climbed ? T.s : null });
  return solveFEM3D({
    mesh, U: opts.U, webW: opts.webW || 0, rho: opts.rho, g: opts.g, gamma: opts.gamma, mu: opts.mu, gdMin: opts.gdMin, Hr: S.H, Ur: Math.abs(opts.U) || 1e-3,
    inlet: { type: 'traction', p: y => opts.Pup - opts.rho * opts.g * y }, outlet: { type: 'plug' }, webSlip: opts.webSlip, sides: 'symmetry',
    sideData: sideLo || sideHi ? { lo: sideLo ? side(state[l0]) : null, hi: sideHi ? side(state[l1]) : null } : null,
    h0: (c, j) => state[l0 + j].h[c], s0: S.climbed ? j => state[l0 + j].s : 0, initNodal: { u, v, w, p },
    contactLine: S.climbed ? { spine: S.cCL, faceFrom: S.cCorner, alphaDeg: Array.from({ length: NL }, (_, j) => S.thl[l0 + j] + opts.faceDeg - 180) } : null,
    homotopy: true, tol: opts.tol, maxIter: opts.maxIter3 ?? 60, onIteration: opts.onIteration3, label: '3D', ...extra,
  });
}

/**
 * The coating flow on a strip across the web: each station first in 2D at its own gap and contact angle
 * (coaterStations), then the stations coupled in 3D (flow across the web, the surface's curvature across it).
 * opts: solveCoaterFEM's (hFn, xe, faceDeg, contactDeg, U, Pup, rho, g, gamma, mu, gdMin, Ld, webSlip, nEb,
 *   nEf, nEs, nEy, ...) for the middle, and width (m), nEz (elements across), dH(z) (the gap's change at z,
 *   m, from the middle's; z from -width/2 to width/2), contactAt(z) (the contact angle there, deg; default
 *   contactDeg everywhere), hAt(z) (instead of hFn and dH: the blade's underside at z, a function of x --
 *   a blade read from a file), webW (the web's speed along the blade: a blade skewed across the web, whose frame this
 *   is; U then the web's speed across it), maxIter3, onStage, onIteration3.
 * Returns { r2 (the 2D results per station), r3 (solveFEM3D's), stations: [{ z, dH, film, q, s, film2, s2 }], error? }.
 */
function solveCoater3D(opts) {
  const nEz = opts.nEz, NL = 2 * nEz + 1, W = opts.width, zs = Array.from({ length: NL }, (_, l) => -W / 2 + W * l / (NL - 1));
  const S = coaterStations(opts, zs);
  if (S.error) return { error: S.error, r2: S.r2 };
  opts.onStage && opts.onStage(`3D: ${S.NC * NL * S.NR} nodes`);
  const t1 = Date.now();
  const open = !!opts.webW;   // (the web moving along the blade: the sides held at their stations' own flow)
  const r3 = coaterStrip3D(opts, S, 0, NL - 1, zs.map((_, l) => stationState(S, l)), open, open, { label: '3D strip' });
  const ms3 = Date.now() - t1, NC = S.NC, NR = S.NR;
  const stations = zs.map((z, l) => {
    const top = ((NC - 1) * NL + l) * NR + NR - 1;
    return { z, dH: opts.dH ? opts.dH(z) : 0, film: r3.y[top], q: r3.q[(NC - 1) * NL + l], s: S.climbed ? r3.surface.s[l] : 0, film2: S.r2[l].Q / opts.U, s2: S.climbed ? S.r2[l].surface.s : 0 };
  });
  return { r2: S.r2, r3, stations, mode: S.mode, ms2: S.ms, ms3, error: r3.converged ? undefined : '3D did not converge' };
}

/**
 * A region too wide for one 3D solve (the full web width): overlapping strips of sub elements across,
 * overlapping by overlap elements, each solved in 3D with its neighbours' latest solution held on its inner
 * sides, in two colours (alternate strips, then the others), sweep after sweep until the stations stop
 * changing (alternating Schwarz). Converges to the 3D solve of the whole region; memory: one strip at a time.
 * The web moving along the blade (opts.webW): its two edges held at their own stations' flow (it leaves and enters freely).
 * opts: solveCoater3D's, and sub (default 4), overlap (default 2), maxSweeps (default 15), tolSweep (the
 *   largest change of film or contact line between sweeps, relative to the gap; default 1e-6), onSweep.
 * Returns { r2, state (per station: u, v, w, p, x, y, z, gd, mu, h, s, q), stations, sweeps, history, converged, ms2, ms3 }.
 */
function solveCoaterWide(opts) {
  const nEz = opts.nEz, NL = 2 * nEz + 1, W = opts.width, zs = Array.from({ length: NL }, (_, l) => -W / 2 + W * l / (NL - 1));
  const sub = Math.min(opts.sub ?? 4, nEz), ov = Math.min(opts.overlap ?? 2, sub - 1), step = sub - ov;
  const S = coaterStations(opts, zs);
  if (S.error) return { error: S.error, r2: S.r2 };
  const state = zs.map((_, l) => stationState(S, l)), open = !!opts.webW;
  const subs = [];
  for (let e0 = 0; ; e0 += step) { const e1 = Math.min(nEz, e0 + sub); subs.push([2 * Math.max(0, e1 - sub), 2 * e1]); if (e1 === nEz) break; }
  const t1 = Date.now(), history = [];
  let converged = false, sweeps = 0, err = null;
  const film = T => T.y ? T.y[(S.NC - 1) * S.NR + S.NR - 1] : null;
  for (; sweeps < (opts.maxSweeps ?? 15) && !converged && !err; sweeps++) {
    let change = 0;
    for (const colour of [0, 1]) for (let i = colour; i < subs.length; i += 2) {
      const [l0, l1] = subs[i];
      opts.onStage && opts.onStage(`sweep ${sweeps + 1}: strip ${i + 1} of ${subs.length} (${(zs[l0] * 1e3).toFixed(0)} to ${(zs[l1] * 1e3).toFixed(0)} mm)`);
      const lo = l0 > 0 || open, hi = l1 < NL - 1 || open;   // (the web's edges: held at their own stations' flow when the web moves along the blade)
      const r3 = coaterStrip3D(opts, S, l0, l1, state, lo, hi, { label: `strip ${i + 1}` });
      if (!r3.converged) { err = `strip ${i + 1} (${(zs[l0] * 1e3).toFixed(0)} to ${(zs[l1] * 1e3).toFixed(0)} mm) did not converge in sweep ${sweeps + 1}`; break; }
      for (let j = lo ? 1 : 0; j <= (hi ? l1 - l0 - 1 : l1 - l0); j++) {
        const T = stationFrom3D(r3, j), old = state[l0 + j];
        const f0 = film(old), f1 = film(T);
        change = Math.max(change, f0 == null ? Infinity : Math.abs(f1 - f0) / S.H, S.climbed ? Math.abs(T.s - old.s) / S.H : 0);
        state[l0 + j] = T;
      }
      if (err) break;
    }
    history.push(change);
    opts.onSweep && opts.onSweep({ sweep: sweeps + 1, change });
    if (change < (opts.tolSweep ?? 1e-6)) converged = true;
  }
  // (the web's edges held at their own stations' flow, the web moving along the blade: those stations are their 2D's)
  const top2 = l => S.r2[l].y[(S.NC - 1) * S.NR + S.NR - 1];
  const stations = zs.map((z, l) => ({ z, dH: opts.dH ? opts.dH(z) : 0, film: film(state[l]) ?? top2(l), q: state[l].q ?? S.r2[l].Q, s: S.climbed ? state[l].s : 0, film2: S.r2[l].Q / opts.U, s2: S.climbed ? S.r2[l].surface.s : 0 }));
  return { r2: S.r2, S, state, stations, subs, sweeps, history, converged: converged && !err, error: err || (converged ? undefined : `not converged after ${sweeps} sweeps (last change ${history[history.length - 1].toExponential(1)} of the gap)`), mode: S.mode, ms2: S.ms, ms3: Date.now() - t1 };
}

/** Small dense solve (Gaussian elimination, partial pivoting). */
function f3Dense(A, b) {
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

if (typeof module !== 'undefined' && module.exports) {
  if (typeof solveCoaterFEM === 'undefined') global.solveCoaterFEM = require('./cfd-fem.js').solveCoaterFEM;
  module.exports = { solveFEM3D, solveCoater3D, solveCoaterWide, coaterStations, coaterStrip3D, stationFrom2D, stationFrom3D, stationState, stationLateral, F3_QP, f3Shape };
}
