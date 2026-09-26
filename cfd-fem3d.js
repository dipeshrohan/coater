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
/**
 * One row for a contact point that may be held at an edge (a complementarity condition, Fischer-Burmeister, smoothed by
 * F3_NCP_MU): a (its distance inside the edge) and b (its angle's excess over the contact angle, as a cosine) both at least
 * 0 and one of them 0. F3_HELD: held when within this of the edge (gap units).
 */
const F3_NCP_MU = 1e-9, F3_HELD = 1e-7;
const f3Ncp = (a, b) => a + b - Math.sqrt(a * a + b * b + F3_NCP_MU * F3_NCP_MU);
function f3FaceRule(fix, val) {
  const out = [];
  for (let gt = 0; gt < 3; gt++) for (let gs = 0; gs < 3; gs++) {
    const s = F3_G[gs], t = F3_G[gt], S = f3q2(s), T = f3q2(t), dS = f3dq2(s), dT = f3dq2(t);
    const N2 = new Float64Array(9), Ns = new Float64Array(9), Nt = new Float64Array(9);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { N2[j * 3 + i] = S[i] * T[j]; Ns[j * 3 + i] = dS[i] * T[j]; Nt[j * 3 + i] = S[i] * dT[j]; }
    const at = fix === 'eta' ? f3Shape(s, val, t) : fix === 'zeta' ? f3Shape(s, t, val) : f3Shape(val, s, t);
    out.push({ w: F3_W[gs] * F3_W[gt], N2, Ns, Nt, el: at });
  }
  return out;
}
const F3_BOTTOM = f3FaceRule('eta', -1), F3_TOP = f3FaceRule('eta', 1), F3_INLET = f3FaceRule('xi', -1), F3_OUTLET = f3FaceRule('xi', 1);
// (the faces across the web: s along the flow, t up; an open side's outer spine lies on the web)
const F3_SIDE_LO = f3FaceRule('zeta', -1), F3_SIDE_HI = f3FaceRule('zeta', 1);

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
 *   contactLine: { spine, faceFrom, alphaDeg (a number, or one per station: a number, or a function of s, m) } or null; freeze (surface fixed)
 *   open: { lo?, hi? } open sides (a web edge): { m (elements round the edge, 2 to nEz), zEnd, zWeb (m: the blade's end, the web's
 *     edge; null: none within reach), thWeb, thBlade (deg), qFrac, dTop(z) (the blade's height change along the edge) };
 *     blockRef: a state (as st) their fans are laid out from (default the starting state)
 *   init: { sol, h, s, zOff } a previous state on the same layout (zOff, m: its strip lay that much lower in z); initNodal: { u, v, w, p } at the nodes (dimensional)
 *   homotopy, tol, maxIter, onIteration, label, onSolveStart, onSolveEnd
 *   checks: force(x, y, z) -> [fx, fy, fz] and exactBC(x, y, z) -> [u, v, w] (nondimensional; velocity set on every
 *     boundary node but an outlet of type 'stress': { type: 'stress', sigma(x, y, z) -> 3x3 }, the full stress there),
 *     fixPressure: value (nondimensional, at the first vertex; only for a boundary that is all velocity)
 */
function solveFEM3D(o) {
  const mesh = o.mesh, nEx = mesh.nEx, nEy = mesh.nEy, nEz = mesh.nEz;
  const NC = 2 * nEx + 1, NR = 2 * nEy + 1, NL = 2 * nEz + 1, NN = NC * NL * NR;
  const U = o.U || 0, rho = o.rho || 0, grav = o.g || 0, gamma = o.gamma || 0, Utop = o.topSpeed || 0;
  const tol = o.tol ?? 1e-8;
  let maxIter = o.maxIter ?? 60;
  const nid = (c, l, k) => (c * NL + l) * NR + k, sid = (c, l) => c * NL + l;
  const kind = c => (mesh.kind ? mesh.kind(c) : 'wall');
  const free = new Uint8Array(NC); for (let c = 0; c < NC; c++) free[c] = kind(c) === 'free' ? 1 : 0;
  const CL = o.contactLine || null;
  const sideWall = o.sides === 'wall';
  // a side taken from a neighbouring strip's solution (a region solved strip by strip): velocity, surface heights, contact line there
  const sideOf = l => o.sideData ? (l === 0 ? o.sideData.lo : l === NL - 1 ? o.sideData.hi : null) : null;
  // ---- open sides (a web edge: the edge bead) ----
  // The outer 2m elements across the strip are an edge block. Its stations j = 0 (the inner station, fixed) .. J = 2m are
  // spines in the cross-section fanning from the web: based along the web between the inner station and Q, from upright
  // (j = 0) to lying on the web (j = J), so the slurry's whole outer surface -- its top, round the edge and down to the contact
  // line on the web -- is the block's top row, one smooth grid line. Under the blade the spines up to jt end on the blade,
  // between the inner station and the top contact point V (pinned at the blade's end, or where the slurry meets the blade at
  // its contact angle), the rest on the meniscus below; downstream every spine ends on the free surface. The web carries the
  // contact line: it runs straight along the flow from the inlet, where the side meets the web at its contact angle.
  const OPEN = [], blockOf = new Array(NL).fill(null), jOf = new Int32Array(NL).fill(-1), tieS = new Int32Array(NL).fill(-1), menLayer = new Uint8Array(nEz), blockLayer = new Uint8Array(nEz);
  if (o.open) for (const side of ['lo', 'hi']) {
    const E = o.open[side];
    if (!E) continue;
    const m = E.m ?? 2, hi = side === 'hi', sgn = hi ? 1 : -1, lOut = hi ? NL - 1 : 0, lIn = lOut - sgn * 2 * m;
    if (!(Number.isInteger(m) && m >= 2 && m <= nEz)) throw new Error(`an open side's edge block needs 2 to ${nEz} elements across (${m})`);
    if (sideOf(lOut)) throw new Error('a side cannot be both open and held at a neighbour\'s solution');
    if (!(E.thWeb > 0 && E.thWeb < 180) || !(E.thBlade > 0 && E.thBlade < 180)) throw new Error('an open side needs the contact angles on the web and on the blade');
    const B = { side, hi, sgn, m, J: 2 * m, jt: 2, lOut, lIn, ez0: hi ? nEz - m : 0, ez1: hi ? nEz - 1 : m - 1, ezOut: hi ? nEz - 1 : 0, rule: hi ? F3_SIDE_HI : F3_SIDE_LO,
      zEnd: E.zEnd ?? null, zWeb: E.zWeb ?? null, thWeb: E.thWeb, thBlade: E.thBlade, dTop: E.dTop || null, qFrac: E.qFrac ?? 0.3,
      dV: new Int32Array(NC).fill(-1), dG: new Int32Array(NC * NL).fill(-1), pinTop: new Uint8Array(NC), pinWeb: 0, lj: j => lIn + sgn * j };
    OPEN.push(B);
    for (let j = 1; j <= B.J; j++) { const l = B.lj(j); if (blockOf[l]) throw new Error('the two open sides\' edge blocks overlap'); blockOf[l] = B; jOf[l] = j; if (j > B.jt) tieS[l] = B.lj(B.jt); }
    for (let ez = B.ez0; ez <= B.ez1; ez++) { blockLayer[ez] = 1; if (Math.min(...[0, 1, 2].map(g => jOf[2 * ez + g])) >= B.jt) menLayer[ez] = 1; }
  }
  if (OPEN.length && (o.webW || 0) !== 0) throw new Error('open sides with the web moving along the blade (a skewed blade) are not modelled');
  if (OPEN.length && (o.exactBC || o.sides === 'wall')) throw new Error('open sides are for the coating flow (not with exactBC or walls)');

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
    if (free[c]) for (let l = 0; l < NL; l++) if (!blockOf[l]) dH[sid(c, l)] = nd++;
    for (const E of OPEN) { E.dV[c] = nd++; for (let j = 1; j <= E.J; j++) if (free[c] || j > E.jt) E.dG[c * NL + E.lj(j)] = nd++; }
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
    for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) if (dH[sid(c, l)] >= 0) h[sid(c, l)] = sol[dH[sid(c, l)]] * Hr;
    const s = new Float64Array(NL); for (let l = 0; l < NL; l++) s[l] = sStar[l] * Hr;
    return { h, s };
  };
  function placeSpine(c, l, st) {
    if (blockOf[l]) { placeBlock(c, l, st); return; }
    const xb = mesh.spineFoot(c, l), [xt, yt] = mesh.spineTop(c, l, st), D = xt - xb;
    const T = mesh.spineSlope ? mesh.spineSlope(c, l, st) * yt : 2 * D;
    for (let k = 0; k < NR; k++) {
      const e = etaK[k], e2 = e * e, n = nid(c, l, k);
      X[n] = (xb + D * e2 * (3 - 2 * e) + T * e2 * (e - 1)) / Hr; Y[n] = e * yt / Hr; Z[n] = zl[l];
    }
  }
  /** An edge block's spine j at column c: from its base on the web to its top (on the blade, or on the surface r along its
   *  direction); its lean along the flow: under the blade its own station's, downstream the inner station's at the start. */
  function placeBlock(c, l, st) {
    const E = blockOf[l], j = jOf[l], zi = zl[E.lIn], b = E.base[j], wall = !free[c];
    let xb, xt, yt, T;
    if (wall) { xb = mesh.spineFoot(c, l); [xt, yt] = mesh.spineTop(c, l, st); }
    else ({ xb, xt, yt, T } = E.prof[c]);
    let pz, py;
    if (wall && j <= E.jt) {
      pz = zi + j / E.jt * (sol[E.dV[c]] - zi);
      if (E.dTop) yt += E.dTop(pz * Hr) - E.dTop(zl[l] * Hr);
      py = yt / Hr;
    } else {
      const [dz, dy] = rayDir(E, c, j, sol[E.dV[c]]), r = sol[E.dG[c * NL + l]];
      pz = b + r * dz; py = r * dy;
    }
    if (wall) T = mesh.spineSlope ? mesh.spineSlope(c, l, st) * yt : 2 * (xt - xb);
    const D = xt - xb;
    for (let k = 0; k < NR; k++) {
      const n = nid(c, l, k), y = etaK[k] * py, e = yt > 0 ? y * Hr / yt : 0;
      X[n] = (e <= 1 ? xb + D * e * e * (3 - 2 * e) + T * e * e * (e - 1) : xt + T * (e - 1)) / Hr; Y[n] = y; Z[n] = b + etaK[k] * (pz - b);
    }
  }
  /** An edge block's surface spine j at column c (top contact point V): up to jt aimed at the points spread between the inner
   *  station and V at the reference height; beyond, turning evenly from spine jt's direction to lying along the web. */
  function rayDir(E, c, j, V) {
    const zi = zl[E.lIn], aim = i => { const tz = zi + i / E.jt * (V - zi) - E.base[i], ty = E.yRef[c], L = Math.hypot(tz, ty); return [tz / L, ty / L]; };
    if (j <= E.jt) return aim(j);
    const a = aim(E.jt), f = (j - E.jt) / (E.J - E.jt), dz = (1 - f) * a[0] + f * E.sgn, dy = (1 - f) * a[1], L = Math.hypot(dz, dy);
    return [dz / L, dy / L];
  }
  const placeNodes = () => { const st = stNow(); for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) placeSpine(c, l, st); };

  // ---- Dirichlet conditions ----
  const dirVal = new Float64Array(ND), isDir = new Uint8Array(ND);
  const setDir = (d, v) => { isDir[d] = 1; dirVal[d] = v; }, clrDir = d => { isDir[d] = 0; dirVal[d] = 0; };
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
    for (const E of OPEN) for (let c = 0; c < NC; c++) {
      // an edge block: under the blade, its meniscus beyond the top contact point is free; its outer spine lies on the web
      if (!free[c]) for (let j = E.jt + 1; j < E.J; j++) { const n = nid(c, E.lj(j), NR - 1); clrDir(dU[n]); clrDir(dV[n]); clrDir(dW[n]); }
      for (let k = 0; k < NR; k++) {
        const n = nid(c, E.lOut, k);
        setDir(dV[n], 0);
        if (!lamS) { setDir(dU[n], Us); setDir(dW[n], 0); } else { clrDir(dU[n]); clrDir(dW[n]); }
      }
      setDir(dW[nid(c, E.lOut, NR - 1)], 0);                                     // (the contact line moves with the web)
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
      if (OPEN.some(E => E.lOut === l)) continue;                                // (an open side: the edge block's outer spine, on the web)
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
    if (o.init.sol && o.init.sol.length === ND) {
      sol.set(o.init.sol);
      // (a solution from a strip whose z is this one's less zOff: its top contact points moved into this strip's z)
      if (o.init.zOff) for (const E of OPEN) for (let c = 0; c < NC; c++) sol[E.dV[c]] += o.init.zOff / Hr;
    }
    if (o.init.h) for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) sol[dH[sid(c, l)]] = o.init.h[sid(c, l)] / Hr;
    if (o.init.s) for (let l = 0; l < NL; l++) sStar[l] = o.init.s[l] / Hr;
  }
  if (o.initNodal) {
    const q = o.initNodal;
    for (let n = 0; n < NN; n++) { sol[dU[n]] = q.u[n] / Ur; sol[dV[n]] = q.v[n] / Ur; sol[dW[n]] = (q.w ? q.w[n] : 0) / Ur; if (dP[n] >= 0) sol[dP[n]] = q.p[n] / Pr; }
  }
  // the edge blocks: their fan (bases along the web to Q, the spines' directions beyond the top contact point), and the start:
  // the side upright at the outer station (pinned at the blade's end or the web's edge where that is), the velocity in the
  // block from the inner station's column at the same height
  for (const E of OPEN) {
    const zi = zl[E.lIn], zo = zl[E.lOut], q = E.qFrac * Math.abs(zo - zi);
    E.base = Float64Array.from({ length: E.J + 1 }, (_, j) => zi + E.sgn * j / E.J * q);
    E.Q = E.base[E.J];
    // (the fan's reference, the inner station's spine at every column: from o.blockRef, else the starting state -- the same
    // mesh however the solve is started)
    const st0 = o.blockRef || stNow();
    E.prof = new Array(NC); E.yRef = new Float64Array(NC);
    for (let c = 0; c < NC; c++) {
      const xb = mesh.spineFoot(c, E.lIn), [xt, yt] = mesh.spineTop(c, E.lIn, st0), T = mesh.spineSlope ? mesh.spineSlope(c, E.lIn, st0) * yt : 2 * (xt - xb);
      E.prof[c] = { xb, xt, yt, T }; E.yRef[c] = yt / Hr;
    }
    if (!(o.init && o.init.sol && o.init.sol.length === ND)) for (let c = 0; c < NC; c++) {
      const top = E.yRef[c];
      sol[E.dV[c]] = zo;
      for (let j = 1; j <= E.J; j++) {
        const d = E.dG[c * NL + E.lj(j)], b = E.base[j];
        if (d < 0) continue;
        const [dz, dy] = rayDir(E, c, j, zo);
        sol[d] = Math.min(dy > 1e-12 ? top / dy : Infinity, E.sgn * dz > 1e-12 ? (zo - b) / dz : Infinity);
      }
    }
  }
  // (both blocks set up before the nodes are placed: two open sides)
  if (OPEN.length && o.initNodal) {
    placeNodes();
    for (const E of OPEN) {
      for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) if (blockOf[l] === E) for (let k = 0; k < NR; k++) {
        const n = nid(c, l, k), y = Y[n], at = (step, get) => {
          let k1 = step; while (k1 < NR - 1 && Y[nid(c, E.lIn, k1)] < y) k1 += step;
          const a = nid(c, E.lIn, k1 - step), b = nid(c, E.lIn, k1), t = Math.max(0, Math.min(1, (y - Y[a]) / ((Y[b] - Y[a]) || 1)));
          return get(a) + t * (get(b) - get(a));
        };
        sol[dU[n]] = at(1, a => sol[dU[a]]); sol[dV[n]] = at(1, a => sol[dV[a]]); sol[dW[n]] = 0;
        if (dP[n] >= 0) sol[dP[n]] = at(2, a => sol[dP[a]]);
      }
    }
  }
  // (the edge blocks frozen where they are: o.freeze)
  if (o.freeze) for (const E of OPEN) for (let c = 0; c < NC; c++) { setDir(E.dV[c], sol[E.dV[c]]); for (let l = 0; l < NL; l++) if (blockOf[l] === E && E.dG[c * NL + l] >= 0) setDir(E.dG[c * NL + l], sol[E.dG[c * NL + l]]); }
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
  /** The same slip on an edge block's outer spine, which lies on the web (the face of element (ex, ey) there; into slipOut). */
  function slipSide(E, ex, ey) {
    slipOut.fill(0);
    gatherElement(ex, ey, E.ezOut);
    const g0 = E.hi ? 2 : 0;
    for (const f of E.rule) {
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
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const i = (g0 * 3 + b) * 3 + a, j = b * 3 + a;
        xs += xe[i] * f.Ns[j]; ys += ye[i] * f.Ns[j]; zs += ze[i] * f.Ns[j]; xt += xe[i] * f.Nt[j]; yt += ye[i] * f.Nt[j]; zt += ze[i] * f.Nt[j];
      }
      const dA = Math.hypot(ys * zt - zs * yt, zs * xt - xs * zt, xs * yt - ys * xt);
      const Dxy = 0.5 * (uy + vx), Dxz = 0.5 * (uz + wx), Dyz = 0.5 * (vz + wy);
      const gd = Math.sqrt(2 * (ux * ux + vy * vy + wz * wz) + 4 * (Dxy * Dxy + Dxz * Dxz + Dyz * Dyz));
      const m = muStar(gd) * lamS;
      for (let j = 0; j < 9; j++) { slipOut[j] += f.w * m * (u - Us) * f.N2[j] * dA; slipOut[9 + j] += f.w * m * (w - Ws) * f.N2[j] * dA; }
    }
  }
  const sideNode = (E, ex, ey, j) => nid(2 * ex + (j % 3), E.lOut, 2 * ey + Math.floor(j / 3));
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
        const n = topNs[j], c = 2 * ex + (j % 3), l = 2 * ez + Math.floor(j / 3), d = kinRow(c, l);
        if (d < 0) continue;
        R[d] += f.w * (u * nx + v * ny + w * nz) * f.N2[j];
        if (addK) for (let m = 0; m < 9; m++) { const nm = topNs[m], s = f.w * f.N2[m] * f.N2[j]; addK(d, dU[nm], s * nx); addK(d, dV[nm], s * ny); addK(d, dW[nm], s * nz); }
      }
    }
  }
  const topFree = ex => free[2 * ex] || free[2 * ex + 1] || free[2 * ex + 2];
  /** The row a top node's kinematic condition goes to: its spine's height, or in an edge block its spine's length (none on the
   *  blade, at the contact line on the web, and at the inlet and outlet, where it runs along the flow: the block's rows). */
  const kinRow = (c, l) => {
    const E = blockOf[l];
    if (!E) return dH[sid(c, l)];
    const j = jOf[l];
    return j === E.J || c === 0 || c === NC - 1 || (!free[c] && j <= E.jt) ? -1 : E.dG[c * NL + l];
  };
  /** An edge block's top face cut by an inlet or outlet with free velocities: the surface's own pull at the cut taken back
   *  (- (1/Ca) int m . phi dl, m its outward direction in the surface across the edge; the surface goes on beyond). */
  function cutFace(R, ex, ez) {
    const cut = ex === 0 && o.inlet.type === 'traction' ? -1 : ex === nEx - 1 && o.outlet.type === 'traction' ? 1 : 0;
    if (!cut || !invCa) return;
    const aE = cut < 0 ? 0 : 2, dS = f3dq2(cut);
    for (let gq = 0; gq < 3; gq++) {
      const T = f3q2(F3_G[gq]), dT = f3dq2(F3_G[gq]);
      let sx = 0, sy = 0, sz = 0, tx = 0, ty = 0, tz = 0;
      for (let g = 0; g < 3; g++) {
        for (let a = 0; a < 3; a++) { const n = nid(2 * ex + a, 2 * ez + g, NR - 1); sx += X[n] * dS[a] * T[g]; sy += Y[n] * dS[a] * T[g]; sz += Z[n] * dS[a] * T[g]; }
        const n = nid(2 * ex + aE, 2 * ez + g, NR - 1); tx += X[n] * dT[g]; ty += Y[n] * dT[g]; tz += Z[n] * dT[g];
      }
      const lt = Math.hypot(tx, ty, tz), ux = tx / lt, uy = ty / lt, uz = tz / lt, sd = sx * ux + sy * uy + sz * uz;
      let mx = sx - sd * ux, my = sy - sd * uy, mz = sz - sd * uz; const lm = cut / Math.hypot(mx, my, mz); mx *= lm; my *= lm; mz *= lm;
      for (let g = 0; g < 3; g++) { const n = nid(2 * ex + aE, 2 * ez + g, NR - 1), w = F3_W[gq] * invCa * lt * T[g]; R[dU[n]] -= w * mx; R[dV[n]] -= w * my; R[dW[n]] -= w * mz; }
    }
  }
  const dQm = f3dq2(-1), dQp = f3dq2(1);
  /** The surface's outward unit normal at top node (c, l): up the block's top row from the element starting (first) or ending (last) there, along the flow from the neighbouring columns. */
  function topNormal(c, l, first) {
    const dq = first ? dQm : dQp, l0 = first ? l : l - 2, n0 = nid(Math.max(0, c - 1), l, NR - 1), n1 = nid(Math.min(NC - 1, c + 1), l, NR - 1);
    const xs = X[n1] - X[n0], ys = Y[n1] - Y[n0], zs = Z[n1] - Z[n0];
    let xt = 0, yt = 0, zt = 0;
    for (let a = 0; a < 3; a++) { const n = nid(c, l0 + a, NR - 1); xt += X[n] * dq[a]; yt += Y[n] * dq[a]; zt += Z[n] * dq[a]; }
    const nx = yt * zs - zt * ys, ny = zt * xs - xt * zs, nz = xt * ys - yt * xs, L = Math.hypot(nx, ny, nz);
    return [nx / L, ny / L, nz / L];
  }
  /** The blade's normal (into it) at the top of wall column c at station l: along its underside or face, from the wall neighbours. */
  function bladeNormal(c, l) {
    const c0 = c > 0 && !free[c - 1] ? c - 1 : c, c1 = c + 1 < NC && !free[c + 1] ? c + 1 : c;
    const n0 = nid(c0, l, NR - 1), n1 = nid(c1, l, NR - 1), tx = X[n1] - X[n0], ty = Y[n1] - Y[n0], L = Math.hypot(tx, ty);
    return [-ty / L, tx / L, 0];
  }
  /** The angle (deg) through the slurry between its surface and the web at the contact line (web), or the blade at the top contact point, at column c. */
  /** How far inside the blade's end the top contact point is at column c, and the web's contact line inside the web's edge (gap units). */
  const endGap = (E, c) => E.sgn * (E.zEnd / Hr - sol[E.dV[c]]), webGap = E => E.sgn * E.zWeb / Hr - E.sgn * E.Q - sol[E.dG[E.lOut]];
  function edgeAngle(E, c, web) {
    const l = web ? E.lOut : E.lj(E.jt), first = web ? !E.hi : E.hi, n = topNormal(c, l, first), w = web ? [0, -1, 0] : bladeNormal(c, l);
    return Math.acos(Math.max(-1, Math.min(1, -(n[0] * w[0] + n[1] * w[1] + n[2] * w[2])))) * 180 / Math.PI;
  }
  /** An edge block's own rows at column c: the top contact point (its contact angle with the blade; downstream it runs on
   *  unchanged), the web's contact line (its contact angle at the inlet, straight from there), and at the inlet and outlet the
   *  surface along the flow; at the blade's end and the web's edge, held there or not (f3Ncp). */
  function blockRows(E, c, R) {
    const dv = E.dV[c], dr = E.dG[c * NL + E.lOut];
    // (held or not, one row: the slurry inside the blade's end and its angle there past the contact angle, one of the two
    // exactly -- the angle at the contact angle inside, or held at the end with any larger angle; so too at the web's edge)
    if (!free[c]) {
      const n = topNormal(c, E.lj(E.jt), E.hi), w = bladeNormal(c, E.lj(E.jt)), b = n[0] * w[0] + n[1] * w[1] + n[2] * w[2] + Math.cos(E.thBlade * Math.PI / 180);
      R[dv] = E.zEnd == null ? b : f3Ncp(endGap(E, c), b);
    } else R[dv] = sol[dv] - sol[E.dV[c - 1]];
    if (c === 0) { const b = topNormal(0, E.lOut, !E.hi)[1] - Math.cos(E.thWeb * Math.PI / 180); R[dr] = E.zWeb == null ? b : f3Ncp(webGap(E), -b); }
    else R[dr] = sol[dr] - sol[E.dG[(c - 1) * NL + E.lOut]];
    if (c === 0 || c === NC - 1) {
      const dq = c === 0 ? dQm : dQp, c0 = c === 0 ? 0 : NC - 3;
      for (let j = 1; j < E.J; j++) {
        const l = E.lj(j), d = E.dG[c * NL + l];
        if (d < 0) continue;
        let v = 0; for (let a = 0; a < 3; a++) v += dq[a] * sol[E.dG[(c0 + a) * NL + l]];
        R[d] = v;
      }
    }
  }
  /** Contact-angle condition at station l: the surface leaves the contact line along the prescribed direction (in the x–y plane). */
  const dQ0 = f3dq2(-1);
  function contactResidual(l) {
    if (sFixed[l] != null) return sStar[l] - sFixed[l];     // (a side station held at its neighbour's contact line)
    if (tieS[l] >= 0) return sStar[l] - sStar[tieS[l]];    // (an edge block's station beyond its top contact point: no face contact line of its own)
    const c = CL.spine;
    let xt = 0, yt = 0;
    for (let a = 0; a < 3; a++) { const n = nid(c + a, l, NR - 1); xt += X[n] * dQ0[a]; yt += Y[n] * dQ0[a]; }
    // (per station: a number, or on a curved face a function of the contact line's place s, m)
    const aL = typeof CL.alphaDeg === 'number' ? CL.alphaDeg : CL.alphaDeg[l], al = (typeof aL === 'function' ? aL(sStar[l] * Hr) : aL) * Math.PI / 180;
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
      if (topFree(ex) || menLayer[ez]) surfaceFace(R, addK, ex, ez);
      if (blockLayer[ez] && (topFree(ex) || menLayer[ez])) cutFace(R, ex, ez);
      if (lamS) for (const E of OPEN) if (ez === E.ezOut) for (let ey = 0; ey < nEy; ey++) { slipSide(E, ex, ey); for (let j = 0; j < 9; j++) { const n = sideNode(E, ex, ey, j); R[dU[n]] += slipOut[j]; R[dW[n]] += slipOut[9 + j]; } }
    }
    for (const E of OPEN) if (ez0 <= E.ez1 && E.ez0 <= ez1) for (let c = 2 * ex0; c <= 2 * ex1 + 2; c++) blockRows(E, c, R);
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
      for (const E of OPEN) for (let a = 0; a < 3; a++) { const c = 2 * ex + a; hi = Math.max(hi, E.dV[c]); for (let l = 0; l < NL; l++) if (E.dG[c * NL + l] >= 0) hi = Math.max(hi, E.dG[c * NL + l]); }
      kl = Math.max(kl, hi - lo);
    }
  }
  // (an edge block's rows couple a column's block with its neighbours': one more column each way)
  if (OPEN.length) for (let c = 1; c < NC - 1; c++) {
    let lo = Infinity, hi = -Infinity;
    for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) lo = Math.min(lo, dU[nid(c - 1, l, k)]);
    for (const E of OPEN) { hi = Math.max(hi, E.dV[c + 1]); for (let l = 0; l < NL; l++) hi = Math.max(hi, E.dG[(c + 1) * NL + l]); }
    kl = Math.max(kl, hi - lo);
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
    for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) if (topFree(ex) || menLayer[ez]) surfaceFace(scratch, addK, ex, ez);
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
      for (const E of OPEN) for (let ex = 0; ex < nEx; ex++) for (let ey = 0; ey < nEy; ey++) {
        slipSide(E, ex, ey); b0.set(slipOut);
        elemNodes(ex, ey, E.ezOut, nodes);
        for (const n of nodes) for (const d of [dU[n], dV[n], dW[n]]) {
          if (isDir[d]) continue;
          const keep = sol[d], h = 1e-7 * Math.max(1, Math.abs(keep));
          sol[d] = keep + h; slipSide(E, ex, ey); sol[d] = keep;
          for (let j = 0; j < 9; j++) { const sn = sideNode(E, ex, ey, j); addK(dU[sn], d, (slipOut[j] - b0[j]) / h); addK(dW[sn], d, (slipOut[9 + j] - b0[9 + j]) / h); }
        }
      }
    }
    for (let d = 0; d < ND; d++) if (isDir[d]) LU[d * W + kl] = 1;
    // geometry columns: a spine's height moves that spine's nodes only; s at station l moves the face spines there
    const Rb = new Float64Array(ND), Rp = new Float64Array(ND);
    const around = (i, n) => [Math.max(0, Math.ceil(i / 2) - 1), Math.min(n - 1, Math.floor(i / 2))];
    for (let c = 0; c < NC; c++) if (free[c]) for (let l = 0; l < NL; l++) {
      const d = dH[sid(c, l)];
      if (d < 0 || isDir[d]) continue;
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
    // an edge block's top contact point and spine lengths at column c: they move that column's block spines
    for (const E of OPEN) for (let c = 0; c < NC; c++) {
      const [ex0, ex1] = around(c, nEx), touchS = hasS && c <= CL.spine + 2;
      const placeCol = () => { const st = stNow(); for (let j = 1; j <= E.J; j++) placeSpine(c, E.lj(j), st); };
      for (const d of [E.dV[c], ...Array.from({ length: E.J }, (_, i) => E.dG[c * NL + E.lj(i + 1)])]) {
        if (d < 0 || isDir[d]) continue;
        const keep = sol[d], dz = 1e-7 * Math.max(1, Math.abs(keep));
        Rb.fill(0); Rp.fill(0);
        partialResidual(ex0, ex1, E.ez0, E.ez1, Rb, null);
        sol[d] = keep + dz; placeCol();
        partialResidual(ex0, ex1, E.ez0, E.ez1, Rp, null);
        const rsl = touchS ? Array.from({ length: NL }, (_, l) => blockOf[l] === E ? contactResidual(l) : 0) : null;
        sol[d] = keep; placeCol();
        for (let r = Math.max(0, d - kl), rEnd = Math.min(ND - 1, d + kl); r <= rEnd; r++) {
          if (isDir[r]) continue;
          const v = (Rp[r] - Rb[r]) / dz;
          if (v !== 0) LU[r * W + d - r + kl] += v;
        }
        if (touchS) for (let l = 0; l < NL; l++) if (blockOf[l] === E) rowS[l][d] = (rsl[l] - rs0[l]) / dz;
      }
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
        const rsl = contactResidual(l), rsAll = OPEN.length ? Array.from({ length: NL }, (_, a) => contactResidual(a)) : null;
        sStar[l] = keep; placeStation();
        const col = new Float64Array(ND);
        for (let r = 0; r < ND; r++) if (!isDir[r]) col[r] = (Rp[r] - Rb[r]) / ds;
        colS.push(col);
        dss[l][l] = (rsl - rs0[l]) / ds;
        if (rsAll) for (let a = 0; a < NL; a++) dss[a][l] = (rsAll[a] - rs0[a]) / ds;   // (an edge block's stations tied to its top contact point's)
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
      if (o.debugJac) o.debugJac({ LU, W, kl, ND, isDir, sol, sStar, residual, placeNodes, rowS, colS, dss, label: d => {
        for (let n = 0; n < NN; n++) { if (dU[n] === d) return 'u' + n; if (dV[n] === d) return 'v' + n; if (dW[n] === d) return 'w' + n; if (dP[n] === d) return 'p' + n; }
        for (let i = 0; i < NC * NL; i++) if (dH[i] === d) return `h c${Math.floor(i / NL)} l${i % NL}`;
        for (const E of OPEN) { for (let c = 0; c < NC; c++) if (E.dV[c] === d) return `V${E.side} c${c}`; for (let i = 0; i < NC * NL; i++) if (E.dG[i] === d) return `r${E.side} c${Math.floor(i / NL)} l${i % NL}`; }
        return '?'; } });
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
  // ---- open sides: where the top contact point is held at the blade's end and the web's contact line at the web's edge
  // (Gibbs: held while the angle there lies between the contact angles on the edge's two faces, 90 degrees apart -- the
  // rows hold the lower limit; past the upper one the slurry would climb the end face or spill over the edge) ----
  for (const E of OPEN) {
    for (let c = 0; c < NC; c++) E.pinTop[c] = !free[c] && E.zEnd != null && endGap(E, c) < F3_HELD ? 1 : 0;
    E.pinWeb = E.zWeb != null && webGap(E) < F3_HELD ? 1 : 0;
  }
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
  // (an edge block's surface heights: its top nodes')
  for (let l = 0; l < NL; l++) if (blockOf[l]) for (let c = 0; c < NC; c++) st.h[sid(c, l)] = Y[nid(c, l, NR - 1)] * Hr;
  // the volume flow in through the inlet and out through the outlet (m^3/s)
  const faceFlow = c => {
    let q = 0;
    for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) for (const f of c === 0 ? F3_INLET : F3_OUTLET) {
      let xs = 0, ys = 0, zs = 0, xt = 0, yt = 0, zt = 0, u = 0, v = 0, w = 0;
      for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) {
        const n = nid(c, 2 * ez + g, 2 * ey + b), j = g * 3 + b;
        xs += X[n] * f.Ns[j]; ys += Y[n] * f.Ns[j]; zs += Z[n] * f.Ns[j]; xt += X[n] * f.Nt[j]; yt += Y[n] * f.Nt[j]; zt += Z[n] * f.Nt[j];
        u += sol[dU[n]] * f.N2[j]; v += sol[dV[n]] * f.N2[j]; w += sol[dW[n]] * f.N2[j];
      }
      q += f.w * (u * (ys * zt - zs * yt) + v * (zs * xt - xs * zt) + w * (xs * yt - ys * xt));
    }
    return q * Ur * Hr * Hr;
  };
  const flow = OPEN.length ? { inlet: faceFlow(0), outlet: faceFlow(NC - 1) } : null;
  // the open sides: the surface round each edge (z, y per column along the block's top row, m), the top contact point, the
  // web's contact line, the pins, the angles at the edges (and where they pass the Gibbs limits: climbing the blade's end, spilling over the web's edge)
  const openOut = OPEN.map(E => {
    const ls = Array.from({ length: E.J + 1 }, (_, j) => E.lj(j)), zS = [], yS = [];
    for (let c = 0; c < NC; c++) { zS.push(ls.map(l => Z[nid(c, l, NR - 1)] * Hr)); yS.push(ls.map(l => Y[nid(c, l, NR - 1)] * Hr)); }
    const aWeb = Float64Array.from({ length: NC }, (_, c) => edgeAngle(E, c, true)), aTop = Float64Array.from({ length: NC }, (_, c) => free[c] ? NaN : edgeAngle(E, c, false));
    const climb = [], spill = [];
    for (let c = 0; c < NC; c++) {
      if (!free[c] && E.pinTop[c] && aTop[c] > E.thBlade + 90 + 1e-6) climb.push({ c, x: X[nid(c, E.lj(E.jt), NR - 1)] * Hr, angle: aTop[c] });
      if (E.pinWeb && aWeb[c] > E.thWeb + 90 + 1e-6) spill.push({ c, x: X[nid(c, E.lOut, NR - 1)] * Hr, angle: aWeb[c] });
    }
    return { side: E.side, stations: ls, z: zS, y: yS, top: Float64Array.from({ length: NC }, (_, c) => sol[E.dV[c]] * Hr), web: (E.Q + E.sgn * sol[E.dG[E.lOut]]) * Hr,
      pinTop: Uint8Array.from(E.pinTop), pinWeb: E.pinWeb, angleWeb: aWeb, angleTop: aTop, climb, spill };
  });
  if (o.onSolveEnd) o.onSolveEnd({ converged, residual: resid, iterations: it });
  return {
    NC, NR, NL, nEx, nEy, nEz, x: xo, y: yo, z: zo, u: uo, v: vo, w: wo, p: po, gd: gdo, mu: muo, q, converged, iterations: it, factorizations, stages, history, solveId,
    residual: resid, surface: st, scales: { Hr, Ur, muR, Pr, Re, Ca: invCa ? 1 / invCa : Infinity },
    size: { unknowns: ND, band: kl, bytes: LU.byteLength, msFactor },
    state: { sol: Float64Array.from(sol), h: st.h, s: st.s },
    ...(OPEN.length ? { flow, open: openOut } : {}),
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
 * opts: solveCoaterFEM's, and dH(z), contactAt(z), hAt(z) (see solveCoater3D), profileAt(z) (a shaped blade: its
 * profile at z, cfd-blade.js's; its contact line must then be at the same corner, or on the same stretch of the face,
 * at every station); zs: the stations (m, from the region's reference); ref: the station whose 2D sets the face
 * elements (default the middle); only: a set of the stations to solve (the rest left empty; ref is always solved --
 * a worker's share of a wide region).
 * With opts.webW (a skewed blade), each solved station's flow along the blade too (stationLateral): w2.
 * Returns { r2: per station, w2, M: their meshes, mode, climbed, cCL, cCorner, NC, NR, H, ms } or { error } (a shaped
 * blade: also k, the corner the contact line is at or above, cBase, and alphaL, each station's contact direction).
 */
function coaterStations(opts, zs, ref = (zs.length - 1) >> 1, only = null) {
  const log = t => opts.onStage && opts.onStage(t), NL = zs.length, t0 = Date.now();
  const dHl = zs.map(z => (opts.dH ? opts.dH(z) : 0)), thl = zs.map(z => (opts.contactAt ? opts.contactAt(z) : opts.contactDeg));
  const profs = [], profAt = opts.profileAt ? l => profs[l] || (profs[l] = opts.profileAt(zs[l])) : null;
  const hl = l => profAt ? profAt(l).hUnder : opts.hAt ? opts.hAt(zs[l]) : x => opts.hFn(x) + dHl[l];
  const solve2 = (l, extra) => solveCoaterFEM({ ...opts, hFn: hl(l), contactDeg: thl[l], keepMesh: true, ...(profAt ? { profile: profAt(l), xe: profAt(l).xe } : {}), ...extra });
  const r2 = new Array(NL);
  log(`2D at ${(zs[ref] * 1e3).toFixed(1)} mm`);
  r2[ref] = solve2(ref, {});
  const r0 = r2[ref];
  if (r0.error || !r0.meshDef || !r0.converged) return { error: `2D at ${(zs[ref] * 1e3).toFixed(1)} mm: ` + (r0.error || 'did not converge'), r2 };
  const mode = r0.meniscus.mode, climbed = mode === 'climbed', m0 = r0.meshDef, nF = (m0.cCL - (m0.cBase ?? m0.cCorner)) / 2;
  const k = r0.meniscus.k ?? null, where = r => `${r.meniscus.mode}${r.meniscus.k ? ` (corner ${r.meniscus.k})` : ''}`;
  // refinement zones: every station keeps the reference station's element counts (its sizes then follow the zones; a
  // shaped blade's always, its underside's corners and steps kept as element ends)
  const fr = m0.frac, counts = (opts.meshZones || profAt) && fr ? { b: fr.b.length - 1, f: nF, s: fr.s.length - 1, y: fr.y.length - 1 } : null;
  for (let l = 0; l < NL; l++) {
    if (l === ref || (only && !only.has(l))) continue;
    if (!opts.hAt && dHl[l] === dHl[ref] && thl[l] === thl[ref]) { r2[l] = r0; continue; }
    log(`2D at ${(zs[l] * 1e3).toFixed(1)} mm${opts.hAt ? '' : ` (gap ${dHl[l] >= 0 ? '+' : ''}${(dHl[l] * 1e6).toFixed(1)} µm)`}`);
    const r = solve2(l, { ...(climbed ? { nFaceFixed: nF } : {}), ...(m0.nFixK ? { nFaceFixedK: m0.nFixK } : {}), ...(counts ? { meshCounts: counts } : {}) });
    if (r.error || !r.converged || !r.meshDef) return { error: `2D at ${(zs[l] * 1e3).toFixed(1)} mm: ${r.error || 'did not converge'}`, r2 };
    if (r.meniscus.mode !== mode || (r.meniscus.k ?? null) !== k || r.meshDef.NC !== m0.NC || r.meshDef.cCL !== m0.cCL)
      return { error: `the meniscus is ${where(r0)} at ${(zs[ref] * 1e3).toFixed(1)} mm but ${where(r)} at ${(zs[l] * 1e3).toFixed(1)} mm: a region where it changes is not modelled`, r2 };
    r2[l] = r;
  }
  const w2 = opts.webW ? r2.map(r => r ? stationLateral(r, opts.webW, { webSlip: opts.webSlip, mu: opts.mu, gdMin: opts.gdMin }) : null) : null;
  // (a shaped blade: each station's contact direction on the stretch of its face the contact line is on -- a number on a
  // straight one, else a function of s)
  const alphaL = profAt && climbed ? zs.map((_, l) => {
    const P = profAt(l), F = P.face, off = P.faceCorners[0].thp - F.th(0), sB = P.faceCorners[k].s, sT = k + 1 < P.faceCorners.length ? P.faceCorners[k + 1].s : F.len;
    const a = q => thl[l] + (F.th(q) + off) * 180 / Math.PI - 180, vs = Array.from({ length: 17 }, (_, i) => a(sB + (sT - sB) * (0.001 + 0.998 * i / 16)));
    return vs.every(v => Math.abs(v - vs[0]) < 1e-9) ? vs[0] : a;
  }) : null;
  return { r2, w2, M: r2.map(r => r ? r.meshDef.mesh : null), zs, thl, mode, climbed, cCL: m0.cCL, cCorner: m0.cCorner, NC: m0.NC, NR: 2 * m0.mesh.nEy + 1, H: hl(ref)(profAt ? profAt(ref).xe : opts.xe), ms: Date.now() - t0,
    ...(profAt ? { k, cBase: m0.cBase, alphaL, shaped: true } : {}) };
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
  // (open sides: their edge blocks laid out from the stations' 2D solutions, whatever the solve starts from)
  let blockRef = null;
  if (extra.open) {
    blockRef = { h: new Float64Array(NC * NL), s: new Float64Array(NL) };
    for (let j = 0; j < NL; j++) { const r = S.r2[l0 + j]; for (let c = 0; c < NC; c++) blockRef.h[c * NL + j] = r.state.h[c]; blockRef.s[j] = r.surface.s; }
  }
  return solveFEM3D({
    mesh, U: opts.U, webW: opts.webW || 0, rho: opts.rho, g: opts.g, gamma: opts.gamma, mu: opts.mu, gdMin: opts.gdMin, Hr: S.H, Ur: Math.abs(opts.U) || 1e-3,
    inlet: { type: 'traction', p: y => opts.Pup - opts.rho * opts.g * y }, outlet: { type: 'plug' }, webSlip: opts.webSlip, sides: 'symmetry',
    sideData: sideLo || sideHi ? { lo: sideLo ? side(state[l0]) : null, hi: sideHi ? side(state[l1]) : null } : null,
    h0: (c, j) => state[l0 + j].h[c], s0: S.climbed || S.k ? j => state[l0 + j].s : 0, initNodal: { u, v, w, p },
    contactLine: S.climbed ? { spine: S.cCL, faceFrom: S.cBase ?? S.cCorner, alphaDeg: Array.from({ length: NL }, (_, j) => S.alphaL ? S.alphaL[l0 + j] : S.thl[l0 + j] + opts.faceDeg - 180) } : null,
    homotopy: true, tol: opts.tol, maxIter: opts.maxIter3 ?? 60, onIteration: opts.onIteration3, label: '3D', blockRef, ...extra,
  });
}

/** The stations across a region (m, from its middle): opts.zs (refinement zones across the web; NL of them, ends and middles), else evenly spaced. */
function stationZs(opts, NL) {
  const W = opts.width;
  if (opts.zs && opts.zs.length === NL) return Array.from(opts.zs);
  return Array.from({ length: NL }, (_, l) => -W / 2 + W * l / (NL - 1));
}

/**
 * The coating flow on a strip across the web: each station first in 2D at its own gap and contact angle
 * (coaterStations), then the stations coupled in 3D (flow across the web, the surface's curvature across it).
 * opts: solveCoaterFEM's (hFn, xe, faceDeg, contactDeg, U, Pup, rho, g, gamma, mu, gdMin, Ld, webSlip, nEb,
 *   nEf, nEs, nEy, ...) for the middle, and width (m), nEz (elements across), dH(z) (the gap's change at z,
 *   m, from the middle's; z from -width/2 to width/2), contactAt(z) (the contact angle there, deg; default
 *   contactDeg everywhere), hAt(z) (instead of hFn and dH: the blade's underside at z, a function of x --
 *   a blade read from a file), webW (the web's speed along the blade: a blade skewed across the web, whose frame this
 *   is; U then the web's speed across it), maxIter3, onStage, onIteration3, zs (the stations, 2 nEz + 1 of them from
 *   -width/2 to width/2, element ends and middles: refinement zones across the web; default evenly spaced).
 * Returns { r2 (the 2D results per station), r3 (solveFEM3D's), stations: [{ z, dH, film, q, s, film2, s2 }], error? }.
 */
function solveCoater3D(opts) {
  const nEz = opts.nEz, NL = 2 * nEz + 1, W = opts.width, zs = stationZs(opts, NL);
  const S = coaterStations(opts, zs);
  if (S.error) return { error: S.error, r2: S.r2 };
  opts.onStage && opts.onStage(`3D: ${S.NC * NL * S.NR} nodes`);
  const t1 = Date.now();
  const open = !!opts.webW;   // (the web moving along the blade: the sides held at their stations' own flow)
  const r3 = coaterStrip3D(opts, S, 0, NL - 1, zs.map((_, l) => stationState(S, l)), open, open, { label: '3D strip' });
  const ms3 = Date.now() - t1, NC = S.NC, NR = S.NR;
  const stations = zs.map((z, l) => {
    const top = ((NC - 1) * NL + l) * NR + NR - 1;
    return { z, dH: opts.dH ? opts.dH(z) : 0, film: r3.y[top], q: r3.q[(NC - 1) * NL + l], s: S.climbed || S.k ? r3.surface.s[l] : 0, film2: S.r2[l].Q / opts.U, s2: S.climbed || S.k ? S.r2[l].surface.s : 0 };
  });
  return { r2: S.r2, r3, stations, mode: S.mode, k: S.k, ms2: S.ms, ms3, error: r3.converged ? undefined : '3D did not converge' };
}

/**
 * A region too wide for one 3D solve (the full web width): overlapping strips of sub elements across,
 * overlapping by overlap elements, each solved in 3D with its neighbours' latest solution held on its inner
 * sides, in two colours (alternate strips, then the others), sweep after sweep until the stations stop
 * changing (alternating Schwarz). Converges to the 3D solve of the whole region; memory: one strip at a time.
 * The web moving along the blade (opts.webW): its two edges held at their own stations' flow (it leaves and enters freely).
 * Open ends (opts.open, the edge bead): each end first solved as an edge strip on its own (its first or last nE elements,
 * solveEdgeStrip: the bead pressure raised in steps from none); only if both hold it, the region, those strips its end strips
 * with their outer sides open (each started from its edge strip's solution, then from its own last).
 * opts: solveCoater3D's, and sub (default 4), overlap (default 2), maxSweeps (default 15), tolSweep (the
 *   largest change of film or contact line between sweeps, relative to the gap; default 1e-6), onSweep;
 *   open: { nE, lo, hi: { m, zEnd, zWeb (m, the region's z), thWeb, thBlade, qFrac } }, onEdge(side, the edge strip's result).
 * Returns { r2, state (per station: u, v, w, p, x, y, z, gd, mu, h, s, q), stations, sweeps, history, converged, ms2, ms3 };
 *   open ends: also held, edges (each end's solveEdgeStrip), open: { lo, hi (the surface round each edge), r3 } -- or, if an
 *   end does not hold the pressure, { error, held: false, edges }.
 */
function solveCoaterWide(opts) {
  const nEz = opts.nEz, NL = 2 * nEz + 1, W = opts.width, zs = stationZs(opts, NL);
  const sub = Math.min(opts.sub ?? 4, nEz), ov = Math.min(opts.overlap ?? 2, sub - 1);
  const EO = opts.open || null, subs = wideSubs(nEz, sub, ov, EO ? EO.nE : 0);
  // (open edges: each end first as an edge strip, the bead pressure raised in steps; the region only if both hold it)
  let edges = null;
  if (EO) {
    edges = {};
    for (const side of ['lo', 'hi']) {
      const [l0, l1] = side === 'lo' ? subs[0] : subs[subs.length - 1], E = EO[side], zc = (zs[l0] + zs[l1]) / 2, sh = f => f && (z => f(z + zc));
      const r = solveEdgeStrip({ ...opts, open: null, width: zs[l1] - zs[l0], nEz: (l1 - l0) / 2, zs: zs.slice(l0, l1 + 1).map(z => z - zc), dH: sh(opts.dH), contactAt: sh(opts.contactAt), hAt: sh(opts.hAt),
        profileAt: sh(opts.profileAt), edge: { side, m: E.m, zEnd: E.zEnd - zc, zWeb: E.zWeb == null ? null : E.zWeb - zc, thWeb: E.thWeb, thBlade: E.thBlade, qFrac: E.qFrac } });
      if (r.error) return { error: `the ${side === 'lo' ? 'first' : 'last'} edge strip: ${r.error}`, edges };
      edges[side] = r;
      opts.onEdge && opts.onEdge(side, r);
    }
    if (!edges.lo.held || !edges.hi.held) return { error: 'the ends do not hold the bead pressure', held: false, edges, subs };
  }
  const S = coaterStations(opts, zs);
  if (S.error) return { error: S.error, r2: S.r2, edges };
  const state = zs.map((_, l) => stationState(S, l)), open = !!opts.webW;
  // (an open end's strip: its edge block on its outer side, from its edge strip's solution at first, then from its own last)
  const openOf = i => !EO ? null : i === 0 ? 'lo' : i === subs.length - 1 ? 'hi' : null, last = [];
  const same = (a, b) => a.NC === b.NC && a.NR === b.NR && a.mode === b.mode && (a.k ?? null) === (b.k ?? null) && a.cCL === b.cCL;
  const t1 = Date.now(), history = [];
  let converged = false, sweeps = 0, err = null;
  const film = T => T.y ? T.y[(S.NC - 1) * S.NR + S.NR - 1] : null;
  for (; sweeps < (opts.maxSweeps ?? 15) && !converged && !err; sweeps++) {
    let change = 0;
    for (const colour of [0, 1]) for (let i = colour; i < subs.length; i += 2) {
      const [l0, l1] = subs[i], os = openOf(i);
      opts.onStage && opts.onStage(`sweep ${sweeps + 1}: strip ${i + 1} of ${subs.length} (${(zs[l0] * 1e3).toFixed(0)} to ${(zs[l1] * 1e3).toFixed(0)} mm)`);
      const lo = (l0 > 0 || open) && os !== 'lo', hi = (l1 < NL - 1 || open) && os !== 'hi';   // (the web's edges: held at their own stations' flow when the web moves along the blade)
      let extra = { label: `strip ${i + 1}` };
      if (os) {
        const E = EO[os], prev = last[i] || (same(edges[os].S, S) ? edges[os].r3 : null), zOff = last[i] ? 0 : (zs[l0] + zs[l1]) / 2;
        extra = { ...extra, open: { [os]: { m: E.m, zEnd: E.zEnd, zWeb: E.zWeb, thWeb: E.thWeb, thBlade: E.thBlade, qFrac: E.qFrac, dTop: opts.dH || null } }, maxIter: opts.maxIter3 ?? 80,
          ...(prev ? { init: { sol: prev.state.sol, s: prev.state.s, zOff }, initNodal: null, h0: null, s0: null } : {}) };
      }
      const r3 = coaterStrip3D(opts, S, l0, l1, state, lo, hi, extra);
      if (!r3.converged) { err = `strip ${i + 1} (${(zs[l0] * 1e3).toFixed(0)} to ${(zs[l1] * 1e3).toFixed(0)} mm) did not converge in sweep ${sweeps + 1}`; break; }
      if (os) { last[i] = r3; const Eo = r3.open[0]; if (Eo.climb.length || Eo.spill.length) { err = `the ${os === 'lo' ? 'first' : 'last'} end lets go in sweep ${sweeps + 1} (${Eo.climb.length ? 'the slurry climbs the blade\'s end face' : 'it spills over the web\'s edge'})`; break; } }
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
  const stations = zs.map((z, l) => ({ z, dH: opts.dH ? opts.dH(z) : 0, film: film(state[l]) ?? top2(l), q: state[l].q ?? S.r2[l].Q, s: S.climbed || S.k ? state[l].s : 0, film2: S.r2[l].Q / opts.U, s2: S.climbed || S.k ? S.r2[l].surface.s : 0 }));
  const openOut = EO ? { lo: last[0] && last[0].open[0], hi: last[subs.length - 1] && last[subs.length - 1].open[0], r3: { lo: last[0], hi: last[subs.length - 1] } } : null;
  return { r2: S.r2, S, state, stations, subs, sweeps, history, converged: converged && !err, error: err || (converged ? undefined : `not converged after ${sweeps} sweeps (last change ${history[history.length - 1].toExponential(1)} of the gap)`), mode: S.mode, ms2: S.ms, ms3: Date.now() - t1,
    ...(EO ? { held: true, edges, open: openOut } : {}) };
}
/**
 * The overlapping strips across a region of nEz elements (each [l0, l1], station indices): sub elements each, overlapping by ov;
 * with open ends (nE > 0), the first and the last nE elements each one strip (the edge strips), the others between them
 * overlapping each by ov.
 */
function wideSubs(nEz, sub, ov, nE = 0) {
  const out = [], step = sub - ov;
  if (!nE) { for (let e0 = 0; ; e0 += step) { const e1 = Math.min(nEz, e0 + sub); out.push([2 * Math.max(0, e1 - sub), 2 * e1]); if (e1 === nEz) break; } return out; }
  if (!(2 * nE + sub - 2 * ov <= nEz)) throw new Error(`open ends need at least ${2 * nE + sub - 2 * ov} elements across (${nEz})`);
  out.push([0, 2 * nE]);
  const a = nE - ov, b = nEz - nE + ov;
  for (let e0 = a; ; e0 += step) { const e1 = Math.min(b, e0 + sub); out.push([2 * Math.max(a, e1 - sub), 2 * e1]); if (e1 === b) break; }
  out.push([2 * (nEz - nE), 2 * nEz]);
  return out;
}

/**
 * The coating flow at a web edge (Phase 4): a strip whose outer side is open -- the slurry's surface round the edge solved,
 * out past the blade's end onto the web, or held at the blade's end or the web's edge -- and whose inner side is a symmetry
 * plane. The bead pressure at the land's start acts right up to the open end, and the end may not hold it: solved first with
 * none, then raised in steps to opts.Pup (a step that fails halved, down to pTol), each from the last. The end holds while a
 * steady edge exists with the slurry below the blade and on the web: past the Gibbs limits it would wet and climb the blade's
 * end face, or spill over the web's edge -- neither modelled, so the steps stop there.
 * opts: solveCoater3D's (width, nEz, zs: the strip's stations, m, z across from its inner side) and edge: { side: 'hi' | 'lo',
 *   m, zEnd, zWeb (m, in the strip's z), thWeb, thBlade (deg), qFrac }, pTol (Pa; default the larger of 0.5 and 5 % of the pressure held),
 *   dP0 (the first step, Pa; default the smaller of 10 and Pup), onStep({ P, ok, held, web, angle, it }).
 * Returns { held (at opts.Pup), P (the pressure of the result), limit ('climb' | 'spill' | 'steady' | null: what stops it),
 *   r3, S, open (the side), stations, steps: [{ P, ok, why?, web, angle, it }], error? }.
 */
function solveEdgeStrip(opts) {
  const nEz = opts.nEz, NL = 2 * nEz + 1, zs = stationZs(opts, NL), E0 = opts.edge, target = opts.Pup;
  const pTol = P => opts.pTol ?? Math.max(0.5, 0.05 * P), steps = [];
  const at0 = { ...opts, Pup: 0 };
  const S = coaterStations(at0, zs);
  if (S.error) return { error: S.error, held: false, steps };
  const openOpt = { [E0.side]: { m: E0.m, zEnd: E0.zEnd, zWeb: E0.zWeb, thWeb: E0.thWeb, thBlade: E0.thBlade, qFrac: E0.qFrac, dTop: opts.dH || null } };
  const solveAt = (P, prev) => (opts.onStage && opts.onStage(`3D at the edge, bead pressure ${P.toFixed(1)} Pa`), coaterStrip3D({ ...opts, Pup: P }, S, 0, NL - 1, zs.map((_, l) => stationState(S, l)), false, false, {
    label: `edge at ${P.toFixed(1)} Pa`, open: openOpt, maxIter: opts.maxIter3 ?? (prev ? 80 : 150),
    ...(prev ? { init: { sol: prev.state.sol, s: prev.state.s }, initNodal: null, h0: null, s0: null } : {}) }));
  // the edge's state: steady (converged), the slurry below the blade and on the web (Gibbs)
  const judge = (P, r) => {
    const E = r.open ? r.open[0] : null, angle = E ? Math.max(...Array.from(E.angleTop).filter(Number.isFinite)) : NaN;
    const why = !r.converged ? 'steady' : E.climb.length ? 'climb' : E.spill.length ? 'spill' : null;
    const st = { P, ok: !why, why, web: E ? E.web : NaN, angle, it: r.iterations };
    steps.push(st); opts.onStep && opts.onStep(st);
    return st;
  };
  let good = null, goodP = 0, last = null;
  const r0 = solveAt(0, null), s0 = judge(0, r0);
  if (!s0.ok) return { held: false, P: 0, limit: s0.why, r3: r0.converged ? r0 : null, S, open: r0.open ? r0.open[0] : null, stations: zs, steps };
  good = r0;
  let P = 0, dP = Math.min(opts.dP0 ?? 10, target);
  while (goodP < target) {
    const Pn = Math.min(target, goodP + dP), r = solveAt(Pn, good), st = judge(Pn, r);
    if (st.ok) { good = r; goodP = Pn; if (r.iterations <= 6) dP *= 2; continue; }
    last = st;
    // (a step that does not converge: halve it; one that converges past a Gibbs limit: the limit is below it)
    dP /= 2;
    if (dP < pTol(goodP)) break;
  }
  P = goodP;
  return { held: goodP >= target, P, limit: goodP >= target ? null : last && last.why, r3: good, S, open: good.open[0], stations: zs, steps };
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
  module.exports = { solveFEM3D, solveCoater3D, solveCoaterWide, wideSubs, solveEdgeStrip, stationZs, coaterStations, coaterStrip3D, stationFrom2D, stationFrom3D, stationState, stationLateral, F3_QP, f3Shape };
}
