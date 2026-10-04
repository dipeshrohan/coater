/*
 * feed-fem.js — the steady 3D flow on the coater's block mesh (feed-mesh.js): the paste from the pipes through the pile,
 * under the blade, into the film. Taylor–Hood Q2–Q1 hexahedra (as cfd-fem3d.js): velocity at the 27 nodes, pressure at
 * the 8 corners; a generalized-Newtonian paste (μ(γ̇) regularized), inertia and gravity; Newton's method.
 * Or, on the tetrahedral mesher's meshes (um-tetmesh.js's umtQuadratic: M.type 'tet10', M.conn, faces { e, f, tag }),
 * Taylor–Hood P2–P1 tetrahedra: velocity at the 10 nodes, pressure at the 4 corners, curved walls' elements curved; the
 * same equations, conditions and solver (the multigrid on each element's 8 linear sub-tetrahedra). A free surface on
 * tetrahedra is not yet (MESH-T4). The hexahedra's arithmetic is unchanged by the tetrahedra (the same results to the bit).
 *
 * The meshes are far too big for a direct solve (a few hundred thousand unknowns), so each Newton step is solved by
 * flexible GMRES, right-preconditioned by the block-triangular Stokes preconditioner:
 *   [A  Bᵀ]⁻¹  ≈  [Â⁻¹  −Â⁻¹BᵀŜ⁻¹]       Â⁻¹: an algebraic multigrid V-cycle (smoothed aggregation) per velocity
 *   [B  0 ]        [ 0      −Ŝ⁻¹  ]       component on the viscosity-weighted Laplacian of the mesh's nodes taken as
 *                                         trilinear sub-hexahedra (8 per element), inside a few CG steps on the true
 *                                         velocity block; Ŝ⁻¹ ≈ μ Mp⁻¹ (the pressure mass over μ) + the thin film's
 *                                         Reynolds-like operator's inverse (ffLubrication): without it, the gap's and
 *                                         the film's smooth pressure modes leave GMRES about a hundred hard modes.
 * The Jacobian itself is applied element by element (never assembled): its velocity–velocity, velocity–pressure and
 * pressure–velocity parts from the state at each quadrature point.
 *
 * Boundary conditions by the mesh's face tags:
 *   { tag: { type: 'velocity', u: [ux, uy, uz] or (x, y, z) -> [..] } }   no-slip walls, the moving web, an inflow
 *   { tag: { type: 'slip', normal: 'x' | 'y' | 'z', over } }             no flow through an axis-aligned face (a mirror, a lid);
 *                                                                        over: it wins at corners with walls (a scraping corner)
 *   { tag: { type: 'slip', normal: 'surface', un } }                     a curved (or any) surface: nothing through it along its
 *                                                                        own normal, no shear along it; un: instead the velocity
 *                                                                        through it, outward, given ((x, y, z) -> m/s, or a number):
 *                                                                        a moving free top, paste falling into it
 *   { tag: { type: 'traction', t: [tx, ty, tz] or (x, y, z, n) -> [..] } } given traction (do-nothing: zero)
 *   { tag: { type: 'free', sigma, t, kn, vn } }                         a free surface: its tension σ (N/m), a traction on it
 *                                                                        (t, as above), and over a pseudo-time step Δt its
 *                                                                        implicit weight kn = ρ g Δt (Pa·s/m) with vn ((x, y, z,
 *                                                                        n) -> m/s, or a number) the velocity through it, outward,
 *                                                                        at which it stands still (ffRobinFace)
 * Units: SI; solved in scaled units (Lr, Ur, μr). Pure computation, no DOM.
 */

// ---- the element: Q2 (27 nodes) velocity, Q1 (8 corners) pressure, 3 × 3 × 3 Gauss -- from the element library (um-fe.js) ----
const FF_UFE = typeof ufeTable === 'function' ? { UFE_GAUSS, ufeLag1, ufeElement, ufeShape, ufeTable, ufeGeometry, ufeFaceRule } : require('./um-fe.js');
const [FF_G, FF_W] = FF_UFE.UFE_GAUSS[3];
const ffQ2 = s => FF_UFE.ufeLag1(2, s)[0], ffDQ2 = s => FF_UFE.ufeLag1(2, s)[1];
/** Reference tables at the 27 quadrature points: N (27 x 27), dN/dξ, dN/dη, dN/dζ, P (8 corners), weights. */
const FF_REF = FF_UFE.ufeTable('hex27', 3, 'hex8');
/** The 8 corners' local node numbers, in the pressure functions' order. */
const FF_CORNER = FF_UFE.ufeElement('hex27').corners;
// ---- or P2–P1 tetrahedra (um-fe.js's tet10, as umtQuadratic makes them): velocity at the 10 nodes, pressure at the 4
//      corners, the degree-5 rule (14 points: the viscous terms on a curved element, the inertia) ----
const FF_TET = { T: FF_UFE.ufeTable('tet10', 5, 'tet4'), corner: [0, 1, 2, 3], faces: FF_UFE.ufeElement('tet10').faces.map(f => f.nodes) };
// ---- or P2–P1 prisms (um-fe.js's wedge18 with the wedge6 pressure: the prism layers on walls), the triangle's degree-5
//      rule times 3 Gauss points along the layer ----
/** A tetrahedron's 8 linear sub-tetrahedra (its 10 nodes' local numbers): the corners' four, then the inner octahedron's
 *  four round its diagonal 6–8. */
const FF_TET_SUB = [[0, 4, 6, 7], [4, 1, 5, 8], [6, 5, 2, 9], [7, 8, 9, 3], [6, 8, 4, 5], [6, 8, 5, 9], [6, 8, 9, 7], [6, 8, 7, 4]];
/** A wedge18's 24 linear sub-tetrahedra: its triangle in 4 (tri6's corners and middles), each of the 2 layers along ζ a
 *  linear prism, each prism in 3 tetrahedra. */
const FF_WEDGE_SUB = (() => {
  const E = FF_UFE.ufeElement('wedge18'), at = (t, l) => E.map.findIndex(([a, b]) => a === t && b === l), out = [];
  for (const [a, b, c] of [[0, 3, 5], [3, 1, 4], [5, 4, 2], [3, 4, 5]]) for (const [l0, l1] of [[0, 1], [1, 2]]) {
    const A0 = at(a, l0), B0 = at(b, l0), C0 = at(c, l0), A1 = at(a, l1), B1 = at(b, l1), C1 = at(c, l1);
    out.push([A0, B0, C0, A1], [B0, C0, A1, B1], [C0, A1, B1, C1]);
  }
  return out;
})();
const FF_KINDS = {};
/** An element type's kind: { type, hex, tet, npe (velocity nodes), nq (quadrature points), npp (pressure nodes), T (the
 *  tables), corner (the pressure nodes' local numbers), faces (each face's local nodes), out (each face's outward sign),
 *  ftype (each face's type), sub (the linear sub-tetrahedra the preconditioner's Laplacian takes) }. */
function ffKindOf(type) {
  if (FF_KINDS[type]) return FF_KINDS[type];
  let K;
  if (type === 'hex27') K = { type, hex: true, tet: false, npe: 27, nq: 27, npp: 8, T: FF_REF, corner: FF_CORNER, faces: null };
  else if (type === 'tet10') K = { type, hex: false, tet: true, npe: 10, nq: FF_TET.T.nq, npp: 4, T: FF_TET.T, corner: FF_TET.corner, faces: FF_TET.faces, sub: FF_TET_SUB };
  else if (type === 'wedge18') { const T = FF_UFE.ufeTable('wedge18', 5, 'wedge6'), E = FF_UFE.ufeElement('wedge18'), cols = [];
    E.map.forEach(([t], k) => (cols[t] = cols[t] || []).push(k));   // (its nodes on one line across the layer: the triangle's node t at each level)
    K = { type, hex: false, tet: false, npe: 18, nq: T.nq, npp: 6, T, corner: [0, 1, 2, 3, 4, 5], faces: E.faces.map(f => f.nodes), sub: FF_WEDGE_SUB, cols }; }
  else throw new Error(`feed-fem: no ${type} elements`);
  const E = FF_UFE.ufeElement(type); K.ftype = E.faces.map(f => f.type); K.out = E.faces.map(f => f.out);
  return (FF_KINDS[type] = K);
}
/** The mesh's elements in blocks of one type each: [{ K, e0 (the first's number in the mesh), nE, conn, g0 (its first
 *  quadrature point's number) }]. A mesh of one type (feed-mesh.js's hex27, umtQuadratic's tet10) is one block; a mixed
 *  one gives M.blocks: [{ type, nE, conn }] (the faces' e counted over the blocks in order). */
function ffBlocks(M) {
  if (M.blocks) { let e0 = 0, g0 = 0; return M.blocks.map(b => { const K = ffKindOf(b.type), B = { K, e0, nE: b.nE, conn: b.conn, g0 }; e0 += b.nE; g0 += b.nE * K.nq; return B; }); }
  if (M.type === 'tet10') return [{ K: ffKindOf('tet10'), e0: 0, nE: M.nE, conn: M.conn, g0: 0 }];
  return [{ K: ffKindOf('hex27'), e0: 0, nE: M.nE, conn: M.elems, g0: 0 }];
}
/** Element e of a mesh: { B (its block), le (its number there), el (its nodes) }. */
function ffElem(S, e) { const B = S.B[S.eB[e]], le = e - B.e0; return { B, le, el: B.conn.subarray(B.K.npe * le, B.K.npe * le + B.K.npe) }; }
/** The mesh's element when it has one type (as before blocks): { ...kind, conn } (null for a mixed mesh). */
function ffKind(M) { const B = ffBlocks(M); return B.length === 1 ? { ...B[0].K, conn: B[0].conn } : null; }

/**
 * Set up a problem on a mesh (feed-mesh.js's): the unknowns, the elements' geometry at their quadrature points (in
 * scaled units), the boundary conditions.
 * o: { mesh, bc (by tag, above), mu(gd) (Pa·s), gdMin (regularization, 1/s), rho, g (gravity, down y), Lr, Ur, fixPressure }
 */
function ffSetup(o) {
  const M = o.mesh, nE = M.nE, nN = M.nN, Lr = o.Lr, Ur = o.Ur, BL = ffBlocks(M);
  const muR = o.mu(Ur / Lr), Pr = muR * Ur / Lr;
  // (each element's block)
  const eB = new Int32Array(nE); BL.forEach((B, b) => eB.fill(b, B.e0, B.e0 + B.nE));
  // pressure unknowns: the corner nodes
  const pOf = new Int32Array(nN).fill(-1); let nP = 0;
  for (const B of BL) for (let e = 0; e < B.nE; e++) for (const c of B.K.corner) { const n = B.conn[B.K.npe * e + c]; if (pOf[n] < 0) pOf[n] = nP++; }
  const nU = 3 * nN, nD = nU + nP;
  // each element's quadrature points: the inverse Jacobian (9) and det J × weight (um-fe.js's ufeGeometry)
  const X = new Float64Array(nN), Y = new Float64Array(nN), Z = new Float64Array(nN);
  for (let n = 0; n < nN; n++) { X[n] = M.X[n] / Lr; Y[n] = M.Y[n] / Lr; Z[n] = M.Z[n] / Lr; }
  const nQ = BL.reduce((s, B) => s + B.nE * B.K.nq, 0);
  let geo, minDet = Infinity;
  if (BL.length === 1) ({ geo, minDet } = FF_UFE.ufeGeometry(BL[0].K.T, X, Y, Z, BL[0].conn, nE));
  else { geo = new Float64Array(nQ * 10); for (const B of BL) { const G = FF_UFE.ufeGeometry(B.K.T, X, Y, Z, B.conn, B.nE); geo.set(G.geo, B.g0 * 10); minDet = Math.min(minDet, G.minDet); } }
  // boundary conditions: fixed velocity components (value in scaled units), tractions by face
  const fix = new Uint8Array(nD), val = new Float64Array(nD), tFaces = [];
  const faceNodes = (e, f) => { const B = BL[eB[e]], le = e - B.e0; return (B.K.hex ? (typeof FM_FACES !== 'undefined' ? FM_FACES : require('./feed-mesh.js').FM_FACES) : B.K.faces)[f].map(i => B.conn[B.K.npe * le + i]); };
  // (slip first, then velocity: a node on both a wall and a mirror keeps the wall's velocity -- except a slip face marked
  //  'over', applied last: where a moving wall runs into it (the web under an upstream cut) the corner keeps no flow
  //  through the face, a scraping corner, instead of leaking the wall's speed through it)
  const rank = b => b.type === 'velocity' ? 1 : b.type === 'slip' && b.over ? 2 : 0;
  const order = Object.entries(o.bc).sort((p, q) => rank(p[1]) - rank(q[1]));
  const sNorm = new Map(), sUn = new Map(), fFaces = [];   // (a curved surface's slip: the outward normal summed at its nodes, its
  //  velocity through it where given; free surfaces)
  for (const [tag, b] of order) for (const F of M.faces) {
    if (F.tag !== tag) continue;
    const ids = faceNodes(F.e, F.f);
    if (b.type === 'velocity') for (const n of ids) {
      const u = typeof b.u === 'function' ? b.u(M.X[n], M.Y[n], M.Z[n]) : b.u;
      for (let c = 0; c < 3; c++) { fix[3 * n + c] = 1; val[3 * n + c] = u[c] / Ur; }
    } else if (b.type === 'slip' && b.normal === 'surface') { ffFaceNormals(M, X, Y, Z, F, (n, v) => { const a = sNorm.get(n) || [0, 0, 0]; for (let c = 0; c < 3; c++) a[c] += v[c]; sNorm.set(n, a); });
      if (b.un != null) for (const n of ids) sUn.set(n, b.un); }
    else if (b.type === 'slip') { const c = { x: 0, y: 1, z: 2 }[b.normal]; for (const n of ids) if (b.over || !fix[3 * n + c] || val[3 * n + c] === 0) { fix[3 * n + c] = 1; val[3 * n + c] = 0; } }
    else if (b.type === 'traction') tFaces.push({ e: F.e, f: F.f, t: b.t });
    else if (b.type === 'free') {
      if (!BL[eB[F.e]].K.hex) throw new Error(`a free surface (${tag}) on ${BL[eB[F.e]].K.tet ? 'tetrahedra' : 'prisms'}: not yet -- the free surface on them is MESH-T4`);
      fFaces.push({ e: F.e, f: F.f, sigma: b.sigma || 0, tag, knS: b.kn ? b.kn * Ur / Pr : 0, vn: b.vn ?? 0 }); if (b.t) tFaces.push({ e: F.e, f: F.f, t: b.t });
    }
    else throw new Error(`unknown boundary condition ${b.type} on ${tag}`);
  }
  // a curved surface's slip (no flow through it, along its normal): its nodes' velocities in a frame of their own -- e0 the
  // surface's normal, then any mirror's or cut's axis (a node on both), the rest tangent and free; a node on a wall keeps
  // the wall's velocity (no frame). rot[n]: the frame's index (−1: none), frm: e0, e1, e2 (9 per frame); perm/slot: each
  // frame component's nearest axis and back (for the per-axis multigrid)
  const rot = new Int32Array(nN).fill(-1), frm = [], perm = new Int8Array(3 * nN), slot = new Int8Array(3 * nN);
  for (let n = 0; n < nN; n++) for (let c = 0; c < 3; c++) { perm[3 * n + c] = c; slot[3 * n + c] = c; }
  for (const [n, a] of sNorm) {
    if (fix[3 * n] && fix[3 * n + 1] && fix[3 * n + 2]) continue;
    const L = Math.hypot(...a), C = [a.map(v => v / L)];
    for (let c = 0; c < 3; c++) if (fix[3 * n + c]) { const e = [0, 0, 0]; e[c] = 1; C.push(e); }
    const E = [];
    for (const c of C) { const v = c.slice(); for (const e of E) { const d = v[0] * e[0] + v[1] * e[1] + v[2] * e[2]; for (let k = 0; k < 3; k++) v[k] -= d * e[k]; } const l = Math.hypot(...v); if (l > 0.1) E.push(v.map(t => t / l)); }
    const K = E.length;
    if (K === 1) { const e0 = E[0], ax = [0, 1, 2].reduce((b, c) => Math.abs(e0[c]) < Math.abs(e0[b]) ? c : b, 0), t = [0, 0, 0]; t[ax] = 1;
      const e1 = [e0[1] * t[2] - e0[2] * t[1], e0[2] * t[0] - e0[0] * t[2], e0[0] * t[1] - e0[1] * t[0]], l = Math.hypot(...e1); E.push(e1.map(v => v / l)); }
    if (E.length === 2) { const [p, q] = E; E.push([p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]); }
    rot[n] = frm.length / 9; for (const e of E) frm.push(...e);
    for (let k = 0; k < 3; k++) { fix[3 * n + k] = k < K ? 1 : 0; val[3 * n + k] = 0; }
    // (the velocity through the surface, where given: along e0, its outward normal)
    const un = sUn.get(n); if (un != null) val[3 * n] = (typeof un === 'function' ? un(M.X[n], M.Y[n], M.Z[n]) : un) / Ur;
    let best = -1, bp = null;
    for (const pp of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) { const sc = pp.reduce((s, c, k) => s + Math.abs(E[k][c]), 0); if (sc > best) { best = sc; bp = pp; } }
    for (let k = 0; k < 3; k++) { perm[3 * n + k] = bp[k]; slot[3 * n + bp[k]] = k; }
  }
  // a free surface's edges on an outflow (a face with a given traction): there the surface beyond pulls (ffTensionFace)
  if (fFaces.length) {
    const outN = new Set(); for (const F of tFaces) for (const n of faceNodes(F.e, F.f)) outN.add(n);
    for (const F of fFaces) {
      const fx = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]][F.f], fr = [0, 1, 2].filter(k => k !== fx[0]), el = M.elems.subarray(27 * F.e, 27 * F.e + 27);
      F.out = [];
      for (const dir of fr) for (const side of [-1, 1]) {
        const other = fr.find(k => k !== dir), ids = [0, 1, 2].map(i => { const ix = [0, 0, 0]; ix[fx[0]] = fx[1] < 0 ? 0 : 2; ix[dir] = side < 0 ? 0 : 2; ix[other] = i; return el[(ix[2] * 3 + ix[1]) * 3 + ix[0]]; });
        if (ids.every(n => outN.has(n))) F.out.push({ dir, side });
      }
    }
  }
  // (nodes in no element -- a block with parts cut out of it, a pipe standing in the pool -- are out of the problem: held at
  //  rest, their rows the identity)
  const inEl = new Uint8Array(nN); for (const B of BL) for (let i = 0; i < B.K.npe * B.nE; i++) inEl[B.conn[i]] = 1;
  for (let n = 0; n < nN; n++) if (!inEl[n]) { rot[n] = -1; for (let k = 0; k < 3; k++) { fix[3 * n + k] = 1; val[3 * n + k] = 0; } }
  if (o.fixPressure) { fix[nU] = 1; val[nU] = 0; }
  const muLaw = o.mu, epsR = (o.gdMin ?? 1e-3 * Ur / Lr) * Lr / Ur, gd = o.gdir || [0, -1, 0];
  const Gr = (o.rho || 0) * (o.g || 0) * Lr * Lr / (muR * Ur);
  // (the Cartesian unknowns each fixed node holds, for the per-axis multigrid and the thin-film part)
  const fixC = new Uint8Array(nU); for (let n = 0; n < nN; n++) for (let k = 0; k < 3; k++) fixC[3 * n + perm[3 * n + k]] = fix[3 * n + k];
  // (the prism layers' columns: each line of nodes across the layers, from the wall to the tetrahedra, one aggregate of
  //  the preconditioner's multigrid -- the layers are thin, their strong couplings across them)
  let cols = null;
  if (BL.some(B => B.K.cols)) { cols = Int32Array.from({ length: nN }, (_, i) => i); const find = i => { while (cols[i] !== i) { cols[i] = cols[cols[i]]; i = cols[i]; } return i; };
    for (const B of BL) if (B.K.cols) for (let e = 0; e < B.nE; e++) for (const c of B.K.cols) { const a = find(B.conn[B.K.npe * e + c[0]]); for (let k = 1; k < c.length; k++) { const b = find(B.conn[B.K.npe * e + c[k]]); if (a !== b) cols[b] = a; } }
    for (let i = 0; i < nN; i++) cols[i] = find(i); }
  return { M, o, K: BL.length === 1 ? { ...BL[0].K, conn: BL[0].conn } : null, B: BL, eB, cols, nE, nN, nP, nU, nD, pOf, geo, X, Y, Z, fix, val, fixC, tFaces, fFaces, rot, frm: Float64Array.from(frm), perm, slot, Lr, Ur, muR, Pr, eps: epsR,
    Re: (o.rho || 0) * Ur * Lr / muR, Gr, Gv: gd.map(v => -Gr * v),
    mu: gd => muLaw(gd * Ur / Lr) / muR, minDet,
    st: new Float64Array(nQ * 20) };   // per quadrature point: μ, κ, D (6), u (3), ∇u (9)
}

/** A face's outward normal at each of its nodes (9 on a hexahedron, 6 on a tetrahedron, 6 or 9 on a prism; unnormalized:
 *  times the area element there), to visit(node, normal). */
const FF_FACE_ST = { tri6: [[0, 0], [1, 0], [0, 1], [0.5, 0], [0.5, 0.5], [0, 0.5]], quad9: [-1, 0, 1].flatMap(t => [-1, 0, 1].map(s => [s, t])) };
function ffFaceNormals(M, X, Y, Z, F, visit) {
  if (M.type === 'tet10' || M.blocks) {
    // (at each of the face's nodes, its own coordinates' tangents: ∂x/∂s × ∂x/∂t, times the face's outward sign)
    const B = ffBlocks(M).find(b => F.e >= b.e0 && F.e < b.e0 + b.nE), K = B.K, le = F.e - B.e0;
    if (!K.hex) {
      const el = B.conn.subarray(K.npe * le, K.npe * le + K.npe), fn = K.faces[F.f], ft = K.ftype[F.f], sg = K.out[F.f], m = fn.length;
      for (let a = 0; a < m; a++) {
        const d = FF_UFE.ufeShape(ft, FF_FACE_ST[ft][a]).dN, t1 = [0, 0, 0], t2 = [0, 0, 0];
        for (let b = 0; b < m; b++) { const n = el[fn[b]], P = [X[n], Y[n], Z[n]]; for (let c = 0; c < 3; c++) { t1[c] += d[2 * b] * P[c]; t2[c] += d[2 * b + 1] * P[c]; } }
        visit(el[fn[a]], [sg * (t1[1] * t2[2] - t1[2] * t2[1]), sg * (t1[2] * t2[0] - t1[0] * t2[2]), sg * (t1[0] * t2[1] - t1[1] * t2[0])]);
      }
      return;
    }
    throw new Error('feed-fem: hexahedra in a mixed mesh: not yet');
  }
  const fixed = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]][F.f], free = [0, 1, 2].filter(k => k !== fixed[0]), el = M.elems.subarray(27 * F.e, 27 * F.e + 27);
  let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 27; k++) { cx += X[el[k]]; cy += Y[el[k]]; cz += Z[el[k]]; }
  for (const s of [-1, 0, 1]) for (const t of [-1, 0, 1]) {
    const ref = [0, 0, 0]; ref[fixed[0]] = fixed[1]; ref[free[0]] = s; ref[free[1]] = t;
    const A = ffQ2(ref[0]), B = ffQ2(ref[1]), C = ffQ2(ref[2]), dA = ffDQ2(ref[0]), dB = ffDQ2(ref[1]), dC = ffDQ2(ref[2]);
    const t1 = [0, 0, 0], t2 = [0, 0, 0]; let node = -1;
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const k = (g * 3 + b) * 3 + a, n = el[k], P = [X[n], Y[n], Z[n]], d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]];
      if (A[a] * B[b] * C[g] > 0.999) node = n;
      for (let c = 0; c < 3; c++) { t1[c] += d[free[0]] * P[c]; t2[c] += d[free[1]] * P[c]; }
    }
    let nr = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
    if (nr[0] * (X[node] - cx / 27) + nr[1] * (Y[node] - cy / 27) + nr[2] * (Z[node] - cz / 27) < 0) nr = nr.map(v => -v);
    visit(node, nr);
  }
}
/** A node's Cartesian velocity from the unknowns (its frame's, for a curved slip surface). */
const ffNodeU = (S, x, n) => { const r = S.rot[n]; if (r < 0) return [x[3 * n], x[3 * n + 1], x[3 * n + 2]]; const f = S.frm, o = 9 * r, a = x[3 * n], b = x[3 * n + 1], c = x[3 * n + 2]; return [a * f[o] + b * f[o + 3] + c * f[o + 6], a * f[o + 1] + b * f[o + 4] + c * f[o + 7], a * f[o + 2] + b * f[o + 5] + c * f[o + 8]]; };
/** Add a Cartesian nodal force (f0, f1, f2) into R (in the node's frame, if it has one). */
const ffAddNodal = (S, R, n, f0, f1, f2) => { const r = S.rot[n]; if (r < 0) { R[3 * n] += f0; R[3 * n + 1] += f1; R[3 * n + 2] += f2; return; } const f = S.frm, o = 9 * r; R[3 * n] += f[o] * f0 + f[o + 1] * f1 + f[o + 2] * f2; R[3 * n + 1] += f[o + 3] * f0 + f[o + 4] * f1 + f[o + 5] * f2; R[3 * n + 2] += f[o + 6] * f0 + f[o + 7] * f1 + f[o + 8] * f2; };

/** The state's quantities at every quadrature point (stored for the Jacobian) and the residual R(x) (scaled). Returns R. */
function ffResidual(S, x, R = new Float64Array(S.nD), opts = {}) {
  R.fill(0);
  const { geo, pOf, nU, st } = S;
  for (const B of S.B) {
  const K = B.K, nE = B.nE, Ref = K.T, npe = K.npe, nq = K.nq, npp = K.npp, CORNER = K.corner, conn = B.conn, g0 = B.g0;
  const dNx = new Float64Array(npe), dNy = new Float64Array(npe), dNz = new Float64Array(npe), ue = new Float64Array(3 * npe), pe = new Float64Array(npp), re = new Float64Array(3 * npe), rp = new Float64Array(npp);
  for (let e = 0; e < nE; e++) {
    const el = conn.subarray(npe * e, npe * e + npe);
    for (let a = 0; a < npe; a++) { const n = el[a]; if (S.rot[n] < 0) { ue[3 * a] = x[3 * n]; ue[3 * a + 1] = x[3 * n + 1]; ue[3 * a + 2] = x[3 * n + 2]; } else { const u = ffNodeU(S, x, n); ue[3 * a] = u[0]; ue[3 * a + 1] = u[1]; ue[3 * a + 2] = u[2]; } }
    for (let c = 0; c < npp; c++) pe[c] = x[nU + pOf[el[CORNER[c]]]];
    re.fill(0); rp.fill(0);
    for (let q = 0; q < nq; q++) {
      const g = geo.subarray((g0 + e * nq + q) * 10, (g0 + e * nq + q) * 10 + 10), w = g[9];
      let u0 = 0, u1 = 0, u2 = 0, a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;   // a_ij = du_i/dx_j
      for (let a = 0; a < npe; a++) {
        const na = Ref.Na[q * npe + a], nb = Ref.Nb[q * npe + a], ng = Ref.Ng[q * npe + a], N = Ref.N[q * npe + a];
        const dx = na * g[0] + nb * g[3] + ng * g[6], dy = na * g[1] + nb * g[4] + ng * g[7], dz = na * g[2] + nb * g[5] + ng * g[8];
        dNx[a] = dx; dNy[a] = dy; dNz[a] = dz;
        const v0 = ue[3 * a], v1 = ue[3 * a + 1], v2 = ue[3 * a + 2];
        u0 += N * v0; u1 += N * v1; u2 += N * v2;
        a00 += v0 * dx; a01 += v0 * dy; a02 += v0 * dz; a10 += v1 * dx; a11 += v1 * dy; a12 += v1 * dz; a20 += v2 * dx; a21 += v2 * dy; a22 += v2 * dz;
      }
      let p = 0; for (let c = 0; c < npp; c++) p += Ref.P[q * npp + c] * pe[c];
      const D00 = a00, D11 = a11, D22 = a22, D01 = (a01 + a10) / 2, D02 = (a02 + a20) / 2, D12 = (a12 + a21) / 2;
      const s2 = 2 * (D00 * D00 + D11 * D11 + D22 * D22 + 2 * (D01 * D01 + D02 * D02 + D12 * D12));
      const gr = Math.sqrt(s2 + S.eps * S.eps), mu = S.mu(gr), h = 1e-6 * gr, dmu = (S.mu(gr + h) - S.mu(Math.max(gr - h, 1e-300))) / (gr + h - Math.max(gr - h, 1e-300));
      const s = st.subarray((g0 + e * nq + q) * 20, (g0 + e * nq + q) * 20 + 20);
      s[0] = mu; s[1] = 4 * dmu / gr; s[2] = D00; s[3] = D11; s[4] = D22; s[5] = D01; s[6] = D02; s[7] = D12;
      s[8] = u0; s[9] = u1; s[10] = u2; s[11] = a00; s[12] = a01; s[13] = a02; s[14] = a10; s[15] = a11; s[16] = a12; s[17] = a20; s[18] = a21; s[19] = a22;
      // stress: 2 μ D − p I; inertia Re (u·∇)u; gravity −Gr ŷ
      const T00 = 2 * mu * D00 - p, T11 = 2 * mu * D11 - p, T22 = 2 * mu * D22 - p, T01 = 2 * mu * D01, T02 = 2 * mu * D02, T12 = 2 * mu * D12;
      const c0 = S.Re * (u0 * a00 + u1 * a01 + u2 * a02) + S.Gv[0], c1 = S.Re * (u0 * a10 + u1 * a11 + u2 * a12) + S.Gv[1], c2 = S.Re * (u0 * a20 + u1 * a21 + u2 * a22) + S.Gv[2];
      for (let a = 0; a < npe; a++) {
        const N = Ref.N[q * npe + a], dx = dNx[a], dy = dNy[a], dz = dNz[a];
        re[3 * a] += w * (T00 * dx + T01 * dy + T02 * dz + c0 * N);
        re[3 * a + 1] += w * (T01 * dx + T11 * dy + T12 * dz + c1 * N);
        re[3 * a + 2] += w * (T02 * dx + T12 * dy + T22 * dz + c2 * N);
      }
      const div = a00 + a11 + a22;
      for (let c = 0; c < npp; c++) rp[c] -= w * Ref.P[q * npp + c] * div;
    }
    for (let a = 0; a < npe; a++) ffAddNodal(S, R, el[a], re[3 * a], re[3 * a + 1], re[3 * a + 2]);
    for (let c = 0; c < npp; c++) R[nU + pOf[el[CORNER[c]]]] += rp[c];
  }
  }
  // given tractions: − ∫ t · v dA (scaled by Pr); a free surface's tension
  for (const F of S.tFaces) ffTractionFace(S, F, R);
  for (const F of S.fFaces) if (F.sigma) ffTensionFace(S, F, R);
  for (const F of S.fFaces) if (F.knS) ffRobinFace(S, F, x, R, false);
  // (opts.raw: the fixed rows kept -- on a slip surface, the force the surface holds the paste with along its normal)
  if (!opts.raw) for (let i = 0; i < S.nD; i++) if (S.fix[i]) R[i] = 0;
  return R;
}

/**
 * A free surface's tension into R: σ ∫ ∇ₛx : ∇ₛv dA (Laplace–Beltrami: −σ κ n·v integrated by parts), and where the
 * surface leaves through an outflow, the pull of the surface beyond it, σ m (m the surface's outward conormal), so that a
 * flat surface carries nothing.
 */
function ffTensionFace(S, F, R) {
  const el = S.M.elems.subarray(27 * F.e, 27 * F.e + 27), fixed = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]][F.f], free = [0, 1, 2].filter(k => k !== fixed[0]);
  const sg = F.sigma / (S.Pr * S.Lr);
  const map = ref => {
    const A = ffQ2(ref[0]), B = ffQ2(ref[1]), C = ffQ2(ref[2]), dA = ffDQ2(ref[0]), dB = ffDQ2(ref[1]), dC = ffDQ2(ref[2]);
    const t = [[0, 0, 0], [0, 0, 0]], N = new Float64Array(27), dN = [new Float64Array(27), new Float64Array(27)];
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const k = (g * 3 + b) * 3 + a, n = el[k], P = [S.X[n], S.Y[n], S.Z[n]], d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]];
      N[k] = A[a] * B[b] * C[g]; dN[0][k] = d[free[0]]; dN[1][k] = d[free[1]];
      for (let c = 0; c < 3; c++) { t[0][c] += d[free[0]] * P[c]; t[1][c] += d[free[1]] * P[c]; }
    }
    return { t, N, dN };
  };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const ref = [0, 0, 0]; ref[fixed[0]] = fixed[1]; ref[free[0]] = FF_G[i]; ref[free[1]] = FF_G[j];
    const { t, dN } = map(ref);
    const g11 = t[0][0] ** 2 + t[0][1] ** 2 + t[0][2] ** 2, g22 = t[1][0] ** 2 + t[1][1] ** 2 + t[1][2] ** 2, g12 = t[0][0] * t[1][0] + t[0][1] * t[1][1] + t[0][2] * t[1][2];
    const det = g11 * g22 - g12 * g12, dAr = Math.sqrt(det), i11 = g22 / det, i22 = g11 / det, i12 = -g12 / det, w = FF_W[i] * FF_W[j] * dAr * sg;
    for (let k = 0; k < 27; k++) {
      if (!dN[0][k] && !dN[1][k]) continue;
      const a1 = i11 * dN[0][k] + i12 * dN[1][k], a2 = i12 * dN[0][k] + i22 * dN[1][k];   // (g^{ij} ∂N/∂ξj)
      ffAddNodal(S, R, el[k], w * (t[0][0] * a1 + t[1][0] * a2), w * (t[0][1] * a1 + t[1][1] * a2), w * (t[0][2] * a1 + t[1][2] * a2));
    }
  }
  // the surface's edges on an outflow: the pull of the surface beyond (F.out: the faces' edges, given by ffFreeEdges)
  for (const E of F.out || []) {
    for (let i = 0; i < 3; i++) {
      const ref = [0, 0, 0]; ref[fixed[0]] = fixed[1]; ref[E.dir] = E.side; const other = free.find(k => k !== E.dir); ref[other] = FF_G[i];
      const { t, N } = map(ref), te = t[free.indexOf(other)], L = Math.hypot(...te);
      // m: the surface beyond taken flat (levelled), so its pull is level: the outward tangent across the edge, its height
      //  part dropped (y), then the part along the edge
      const tn = t[free.indexOf(E.dir)].map(v => v * E.side); tn[1] = 0; const te2 = [te[0], 0, te[2]], L2 = te2[0] ** 2 + te2[2] ** 2 || 1, d = (tn[0] * te2[0] + tn[2] * te2[2]) / L2;
      let m = [tn[0] - d * te2[0], 0, tn[2] - d * te2[2]]; const ml = Math.hypot(...m); m = m.map(v => v / ml);
      const w = FF_W[i] * L * sg;
      for (let k = 0; k < 27; k++) if (N[k]) ffAddNodal(S, R, el[k], -w * N[k] * m[0], -w * N[k] * m[1], -w * N[k] * m[2]);
    }
  }
}

/** A tetrahedron's or a prism's face, at each point of its rule (degree 5 on a triangle, 3 × 3 Gauss on a
 *  quadrilateral): { w (weight × area element), n (unit, outward), pos (scaled), N (the element's functions), idx (the
 *  face's local nodes), el (the element's nodes) } -- for the faces' integrals off the hexahedra. */
function ffFacePoints(S, F) {
  const { B, el } = ffElem(S, F.e), K = B.K, fn = K.faces[F.f], m = fn.length, sg = K.out[F.f], out = [];
  for (const q of FF_UFE.ufeFaceRule(K.type, F.f, K.ftype[F.f].startsWith('tri') ? 5 : 3)) {
    const t1 = [0, 0, 0], t2 = [0, 0, 0], pos = [0, 0, 0];
    for (let b = 0; b < m; b++) { const n = el[fn[b]], P = [S.X[n], S.Y[n], S.Z[n]]; for (let c = 0; c < 3; c++) { t1[c] += q.Ns[b] * P[c]; t2[c] += q.Nt[b] * P[c]; pos[c] += q.N2[b] * P[c]; } }
    const nr = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]], dA = Math.hypot(...nr);
    out.push({ w: q.w * dA, n: nr.map(v => sg * v / dA), pos, N: q.el.N, idx: fn, el });
  }
  return out;
}
/** A face's given traction into R (−∫ t·v dA). */
function ffTractionFace(S, F, R) {
  if (!S.B[S.eB[F.e]].K.hex) {
    for (const q of ffFacePoints(S, F)) { const tt = typeof F.t === 'function' ? F.t(q.pos[0] * S.Lr, q.pos[1] * S.Lr, q.pos[2] * S.Lr, q.n) : F.t;
      for (const k of q.idx) ffAddNodal(S, R, q.el[k], -q.w * q.N[k] * tt[0] / S.Pr, -q.w * q.N[k] * tt[1] / S.Pr, -q.w * q.N[k] * tt[2] / S.Pr); }
    return;
  }
  const FM = (typeof FM_FACES !== 'undefined' ? FM_FACES : require('./feed-mesh.js').FM_FACES)[F.f], el = S.M.elems.subarray(27 * F.e, 27 * F.e + 27);
  const fixed = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]][F.f], free = [0, 1, 2].filter(k => k !== fixed[0]);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const ref = [0, 0, 0]; ref[fixed[0]] = fixed[1]; ref[free[0]] = FF_G[i]; ref[free[1]] = FF_G[j];
    const A = ffQ2(ref[0]), B = ffQ2(ref[1]), C = ffQ2(ref[2]), dA = ffDQ2(ref[0]), dB = ffDQ2(ref[1]), dC = ffDQ2(ref[2]);
    const t1 = [0, 0, 0], t2 = [0, 0, 0], pos = [0, 0, 0], Nv = new Float64Array(27);
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const k = (g * 3 + b) * 3 + a, n = el[k], P = [S.X[n], S.Y[n], S.Z[n]];
      const d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]];
      Nv[k] = A[a] * B[b] * C[g];
      for (let c = 0; c < 3; c++) { t1[c] += d[free[0]] * P[c]; t2[c] += d[free[1]] * P[c]; pos[c] += Nv[k] * P[c]; }
    }
    let nrm = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
    const dA_ = Math.hypot(...nrm); nrm = nrm.map(v => v / dA_);
    // (outward: away from the element's centre)
    let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 27; k++) { cx += S.X[el[k]]; cy += S.Y[el[k]]; cz += S.Z[el[k]]; }
    if (nrm[0] * (pos[0] - cx / 27) + nrm[1] * (pos[1] - cy / 27) + nrm[2] * (pos[2] - cz / 27) < 0) nrm = nrm.map(v => -v);
    const tt = typeof F.t === 'function' ? F.t(pos[0] * S.Lr, pos[1] * S.Lr, pos[2] * S.Lr, nrm) : F.t, w = FF_W[i] * FF_W[j] * dA_;
    for (const k of FM) ffAddNodal(S, R, el[k], -w * Nv[k] * tt[0] / S.Pr, -w * Nv[k] * tt[1] / S.Pr, -w * Nv[k] * tt[2] / S.Pr);
  }
}

/**
 * A free surface's implicit weight (the free-surface stabilization of Kaus, Mühlhaus and May 2010): over a pseudo-time step
 * Δt the surface moves by Δt (u·n − vn) along its normal, and the paste it adds there weighs on it, the traction
 * −kn (u·n − vn) n with kn = ρ g Δt. Into R: + ∫ kn (u·n − vn) (v·n) dA; lin: the Jacobian's part (x a direction: its
 * fixed components taken as zero, no vn). It vanishes once the surface stands still (u·n = vn): the steady state is the
 * free surface's own.
 */
function ffRobinFace(S, F, x, R, lin) {
  const el = S.M.elems.subarray(27 * F.e, 27 * F.e + 27), fixed = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]][F.f], free = [0, 1, 2].filter(k => k !== fixed[0]);
  const FM = (typeof FM_FACES !== 'undefined' ? FM_FACES : require('./feed-mesh.js').FM_FACES)[F.f], fix = S.fix, Uk = new Float64Array(81);
  for (const k of FM) {
    const n = el[k], m = c => (lin && fix[3 * n + c] ? 0 : x[3 * n + c]);
    if (S.rot[n] < 0) { Uk[3 * k] = m(0); Uk[3 * k + 1] = m(1); Uk[3 * k + 2] = m(2); }
    else { const f = S.frm, o = 9 * S.rot[n], a = m(0), b = m(1), c = m(2); for (let d = 0; d < 3; d++) Uk[3 * k + d] = a * f[o + d] + b * f[o + 3 + d] + c * f[o + 6 + d]; }
  }
  let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 27; k++) { cx += S.X[el[k]]; cy += S.Y[el[k]]; cz += S.Z[el[k]]; }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const ref = [0, 0, 0]; ref[fixed[0]] = fixed[1]; ref[free[0]] = FF_G[i]; ref[free[1]] = FF_G[j];
    const A = ffQ2(ref[0]), B = ffQ2(ref[1]), C = ffQ2(ref[2]), dA = ffDQ2(ref[0]), dB = ffDQ2(ref[1]), dC = ffDQ2(ref[2]);
    const t1 = [0, 0, 0], t2 = [0, 0, 0], pos = [0, 0, 0], Nv = new Float64Array(27), u = [0, 0, 0];
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const k = (g * 3 + b) * 3 + a, n = el[k], P = [S.X[n], S.Y[n], S.Z[n]], d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]];
      Nv[k] = A[a] * B[b] * C[g];
      for (let c = 0; c < 3; c++) { t1[c] += d[free[0]] * P[c]; t2[c] += d[free[1]] * P[c]; pos[c] += Nv[k] * P[c]; }
    }
    for (const k of FM) for (let c = 0; c < 3; c++) u[c] += Nv[k] * Uk[3 * k + c];
    let nr = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
    const dA_ = Math.hypot(...nr); nr = nr.map(v => v / dA_);
    if (nr[0] * (pos[0] - cx / 27) + nr[1] * (pos[1] - cy / 27) + nr[2] * (pos[2] - cz / 27) < 0) nr = nr.map(v => -v);
    const vn = lin ? 0 : (typeof F.vn === 'function' ? F.vn(pos[0] * S.Lr, pos[1] * S.Lr, pos[2] * S.Lr, nr) : F.vn) / S.Ur;
    const r = F.knS * (u[0] * nr[0] + u[1] * nr[1] + u[2] * nr[2] - vn) * FF_W[i] * FF_W[j] * dA_;
    for (const k of FM) ffAddNodal(S, R, el[k], r * Nv[k] * nr[0], r * Nv[k] * nr[1], r * Nv[k] * nr[2]);
  }
}

/** The hexahedron's tables along one axis: L[3q + a] the 1D quadratic a at Gauss point q, D its slope. FF_REF is their
 *  product (node a = ax + 3 ay + 9 az, point q = qx + 3 qy + 9 qz) -- checked here, to the last bit; null if it is not. */
const FF_TP = (() => {
  const L = new Float64Array(9), D = new Float64Array(9);
  FF_G.forEach((s, q) => { const [l, d] = FF_UFE.ufeLag1(2, s); for (let a = 0; a < 3; a++) { L[3 * q + a] = l[a]; D[3 * q + a] = d[a]; } });
  for (let q = 0; q < 27; q++) for (let a = 0; a < 27; a++) {
    const x = [q % 3, Math.floor(q / 3) % 3, Math.floor(q / 9)], y = [a % 3, Math.floor(a / 3) % 3, Math.floor(a / 9)], l = d => L[3 * x[d] + y[d]], g = d => D[3 * x[d] + y[d]];
    if (FF_REF.N[q * 27 + a] !== l(0) * l(1) * l(2) || FF_REF.Na[q * 27 + a] !== g(0) * l(1) * l(2) || FF_REF.Nb[q * 27 + a] !== l(0) * g(1) * l(2) || FF_REF.Ng[q * 27 + a] !== l(0) * l(1) * g(2)) return null;
  }
  return { L, D };
})();
/** y += J x over a block of hexahedra, the same sums as ffJacVec's element loop but factored by axis (sum factorization):
 *  the velocity and its slopes at the 27 points by three passes of 3 x 3 sums, the test functions' sums back the same way --
 *  about a seventh of the plain loop's multiplications. */
function ffJacVecHex(S, B, x, y) {
  const { geo, pOf, nU, st, fix } = S, Re = S.Re, conn = B.conn, nE = B.nE, g0 = B.g0, Ref = B.K.T, CORNER = B.K.corner;
  const L = FF_TP.L, D = FF_TP.D;
  const ue = new Float64Array(81), pe = new Float64Array(8), u = new Float64Array(27);
  // (per component: the value and its slopes along ξ, η, ζ at the 27 points; then what each point gives the test sums)
  const Uv = new Float64Array(81), Ux = new Float64Array(81), Uy = new Float64Array(81), Uz = new Float64Array(81);
  const Fx = new Float64Array(81), Fy = new Float64Array(81), Fz = new Float64Array(81), F0 = new Float64Array(81);
  const t1L = new Float64Array(27), t1D = new Float64Array(27), tLL = new Float64Array(27), tDL = new Float64Array(27), tLD = new Float64Array(27);
  const re = new Float64Array(81), rp = new Float64Array(8);
  for (let e = 0; e < nE; e++) {
    const o27 = 27 * e;
    for (let a = 0; a < 27; a++) {
      const n = conn[o27 + a];
      if (S.rot[n] < 0) for (let c = 0; c < 3; c++) ue[3 * a + c] = fix[3 * n + c] ? 0 : x[3 * n + c];
      else { const f = S.frm, o = 9 * S.rot[n], p0 = fix[3 * n] ? 0 : x[3 * n], p1 = fix[3 * n + 1] ? 0 : x[3 * n + 1], p2 = fix[3 * n + 2] ? 0 : x[3 * n + 2];
        for (let c = 0; c < 3; c++) ue[3 * a + c] = p0 * f[o + c] + p1 * f[o + 3 + c] + p2 * f[o + 6 + c]; }
    }
    for (let c = 0; c < 8; c++) { const i = nU + pOf[conn[o27 + CORNER[c]]]; pe[c] = fix[i] ? 0 : x[i]; }
    for (let c = 0; c < 3; c++) {
      for (let a = 0; a < 27; a++) u[a] = ue[3 * a + c];
      // x: (ax -> qx), for each (ay, az)
      for (let r = 0; r < 9; r++) { const b = 3 * r, u0 = u[b], u1 = u[b + 1], u2 = u[b + 2];
        for (let q = 0; q < 3; q++) { t1L[b + q] = L[3 * q] * u0 + L[3 * q + 1] * u1 + L[3 * q + 2] * u2; t1D[b + q] = D[3 * q] * u0 + D[3 * q + 1] * u1 + D[3 * q + 2] * u2; } }
      // y: (ay -> qy), for each (qx, az)
      for (let az = 0; az < 3; az++) for (let qx = 0; qx < 3; qx++) { const b = 9 * az + qx, a0 = t1L[b], a1 = t1L[b + 3], a2 = t1L[b + 6], d0 = t1D[b], d1 = t1D[b + 3], d2 = t1D[b + 6];
        for (let q = 0; q < 3; q++) { const l0 = L[3 * q], l1 = L[3 * q + 1], l2 = L[3 * q + 2], k = b + 3 * q;
          tLL[k] = l0 * a0 + l1 * a1 + l2 * a2; tDL[k] = l0 * d0 + l1 * d1 + l2 * d2; tLD[k] = D[3 * q] * a0 + D[3 * q + 1] * a1 + D[3 * q + 2] * a2; } }
      // z: (az -> qz), for each (qx, qy)
      for (let r = 0; r < 9; r++) { const a0 = tLL[r], a1 = tLL[r + 9], a2 = tLL[r + 18], d0 = tDL[r], d1 = tDL[r + 9], d2 = tDL[r + 18], e0 = tLD[r], e1 = tLD[r + 9], e2 = tLD[r + 18];
        for (let q = 0; q < 3; q++) { const l0 = L[3 * q], l1 = L[3 * q + 1], l2 = L[3 * q + 2], k = 3 * (r + 9 * q) + c;
          Uv[k] = l0 * a0 + l1 * a1 + l2 * a2; Ux[k] = l0 * d0 + l1 * d1 + l2 * d2; Uy[k] = l0 * e0 + l1 * e1 + l2 * e2; Uz[k] = D[3 * q] * a0 + D[3 * q + 1] * a1 + D[3 * q + 2] * a2; } }
    }
    rp.fill(0);
    for (let q = 0; q < 27; q++) {
      const gi = (g0 + e * 27 + q) * 10, si = (g0 + e * 27 + q) * 20, w = geo[gi + 9];
      const G0 = geo[gi], G1 = geo[gi + 1], G2 = geo[gi + 2], G3 = geo[gi + 3], G4 = geo[gi + 4], G5 = geo[gi + 5], G6 = geo[gi + 6], G7 = geo[gi + 7], G8 = geo[gi + 8];
      const k0 = 3 * q, u0 = Uv[k0], u1 = Uv[k0 + 1], u2 = Uv[k0 + 2];
      const b00 = Ux[k0] * G0 + Uy[k0] * G3 + Uz[k0] * G6, b01 = Ux[k0] * G1 + Uy[k0] * G4 + Uz[k0] * G7, b02 = Ux[k0] * G2 + Uy[k0] * G5 + Uz[k0] * G8;
      const b10 = Ux[k0 + 1] * G0 + Uy[k0 + 1] * G3 + Uz[k0 + 1] * G6, b11 = Ux[k0 + 1] * G1 + Uy[k0 + 1] * G4 + Uz[k0 + 1] * G7, b12 = Ux[k0 + 1] * G2 + Uy[k0 + 1] * G5 + Uz[k0 + 1] * G8;
      const b20 = Ux[k0 + 2] * G0 + Uy[k0 + 2] * G3 + Uz[k0 + 2] * G6, b21 = Ux[k0 + 2] * G1 + Uy[k0 + 2] * G4 + Uz[k0 + 2] * G7, b22 = Ux[k0 + 2] * G2 + Uy[k0 + 2] * G5 + Uz[k0 + 2] * G8;
      let p = 0; for (let c = 0; c < 8; c++) p += Ref.P[q * 8 + c] * pe[c];
      const mu = st[si], ka = st[si + 1], D00 = st[si + 2], D11 = st[si + 3], D22 = st[si + 4], D01 = st[si + 5], D02 = st[si + 6], D12 = st[si + 7];
      const d00 = b00, d11 = b11, d22 = b22, d01 = (b01 + b10) / 2, d02 = (b02 + b20) / 2, d12 = (b12 + b21) / 2;
      const DD = D00 * d00 + D11 * d11 + D22 * d22 + 2 * (D01 * d01 + D02 * d02 + D12 * d12), kk = ka * DD;
      const T00 = 2 * mu * d00 + kk * D00 - p, T11 = 2 * mu * d11 + kk * D11 - p, T22 = 2 * mu * d22 + kk * D22 - p;
      const T01 = 2 * mu * d01 + kk * D01, T02 = 2 * mu * d02 + kk * D02, T12 = 2 * mu * d12 + kk * D12;
      const U0 = st[si + 8], U1 = st[si + 9], U2 = st[si + 10];
      const c0 = Re * (u0 * st[si + 11] + u1 * st[si + 12] + u2 * st[si + 13] + U0 * b00 + U1 * b01 + U2 * b02);
      const c1 = Re * (u0 * st[si + 14] + u1 * st[si + 15] + u2 * st[si + 16] + U0 * b10 + U1 * b11 + U2 * b12);
      const c2 = Re * (u0 * st[si + 17] + u1 * st[si + 18] + u2 * st[si + 19] + U0 * b20 + U1 * b21 + U2 * b22);
      // (the test functions' reference derivatives' weights: dx = Na G0 + Nb G3 + Ng G6, ...)
      Fx[k0] = w * (T00 * G0 + T01 * G1 + T02 * G2); Fy[k0] = w * (T00 * G3 + T01 * G4 + T02 * G5); Fz[k0] = w * (T00 * G6 + T01 * G7 + T02 * G8); F0[k0] = w * c0;
      Fx[k0 + 1] = w * (T01 * G0 + T11 * G1 + T12 * G2); Fy[k0 + 1] = w * (T01 * G3 + T11 * G4 + T12 * G5); Fz[k0 + 1] = w * (T01 * G6 + T11 * G7 + T12 * G8); F0[k0 + 1] = w * c1;
      Fx[k0 + 2] = w * (T02 * G0 + T12 * G1 + T22 * G2); Fy[k0 + 2] = w * (T02 * G3 + T12 * G4 + T22 * G5); Fz[k0 + 2] = w * (T02 * G6 + T12 * G7 + T22 * G8); F0[k0 + 2] = w * c2;
      const div = b00 + b11 + b22;
      for (let c = 0; c < 8; c++) rp[c] -= w * Ref.P[q * 8 + c] * div;
    }
    // the test sums, factored: re = Σ_q Dx Ly Lz Fx + Lx Dy Lz Fy + Lx Ly (Lz F0 + Dz Fz)
    for (let c = 0; c < 3; c++) {
      // z: (qz -> az): Zx (-> Dx Ly), Zy (-> Lx Dy), Z0 (-> Lx Ly), into tLL/tDL/tLD (index qx + 3qy + 9az)
      for (let r = 0; r < 9; r++) { const i0 = 3 * r + c, i1 = 3 * (r + 9) + c, i2 = 3 * (r + 18) + c;
        const x0 = Fx[i0], x1 = Fx[i1], x2 = Fx[i2], y0 = Fy[i0], y1 = Fy[i1], y2 = Fy[i2], f0 = F0[i0], f1 = F0[i1], f2 = F0[i2], z0 = Fz[i0], z1 = Fz[i1], z2 = Fz[i2];
        for (let a = 0; a < 3; a++) { const l0 = L[a], l1 = L[3 + a], l2 = L[6 + a], k = r + 9 * a;
          tDL[k] = l0 * x0 + l1 * x1 + l2 * x2; tLD[k] = l0 * y0 + l1 * y1 + l2 * y2; tLL[k] = l0 * f0 + l1 * f1 + l2 * f2 + D[a] * z0 + D[3 + a] * z1 + D[6 + a] * z2; } }
      // y: (qy -> ay): Yx (-> Dx) in t1D, Y0 (-> Lx) in t1L (index qx + 3ay + 9az)
      for (let az = 0; az < 3; az++) for (let qx = 0; qx < 3; qx++) { const b = 9 * az + qx, x0 = tDL[b], x1 = tDL[b + 3], x2 = tDL[b + 6], y0 = tLD[b], y1 = tLD[b + 3], y2 = tLD[b + 6], f0 = tLL[b], f1 = tLL[b + 3], f2 = tLL[b + 6];
        for (let a = 0; a < 3; a++) { const l0 = L[a], l1 = L[3 + a], l2 = L[6 + a], k = b + 3 * a;
          t1D[k] = l0 * x0 + l1 * x1 + l2 * x2; t1L[k] = l0 * f0 + l1 * f1 + l2 * f2 + D[a] * y0 + D[3 + a] * y1 + D[6 + a] * y2; } }
      // x: (qx -> ax)
      for (let r = 0; r < 9; r++) { const b = 3 * r, x0 = t1D[b], x1 = t1D[b + 1], x2 = t1D[b + 2], f0 = t1L[b], f1 = t1L[b + 1], f2 = t1L[b + 2];
        for (let a = 0; a < 3; a++) re[3 * (b + a) + c] = D[a] * x0 + D[3 + a] * x1 + D[6 + a] * x2 + L[a] * f0 + L[3 + a] * f1 + L[6 + a] * f2; }
    }
    for (let a = 0; a < 27; a++) ffAddNodal(S, y, conn[o27 + a], re[3 * a], re[3 * a + 1], re[3 * a + 2]);
    for (let c = 0; c < 8; c++) y[nU + pOf[conn[o27 + CORNER[c]]]] += rp[c];
  }
}
/** y = J x (the Newton Jacobian at the state last given to ffResidual), element by element. Fixed rows: y = x. */
function ffJacVec(S, x, y = new Float64Array(S.nD)) {
  y.fill(0);
  const { geo, pOf, nU, st } = S, Re = S.Re;
  const fix = S.fix;
  for (const B of S.B) {
  if (B.K.hex && FF_TP) { ffJacVecHex(S, B, x, y); continue; }
  const K = B.K, nE = B.nE, Ref = K.T, npe = K.npe, nq = K.nq, npp = K.npp, CORNER = K.corner, conn = B.conn, g0 = B.g0;
  const dNx = new Float64Array(npe), dNy = new Float64Array(npe), dNz = new Float64Array(npe), ue = new Float64Array(3 * npe), pe = new Float64Array(npp), re = new Float64Array(3 * npe), rp = new Float64Array(npp);
  for (let e = 0; e < nE; e++) {
    const el = conn.subarray(npe * e, npe * e + npe);
    for (let a = 0; a < npe; a++) {
      const n = el[a];
      if (S.rot[n] < 0) for (let c = 0; c < 3; c++) ue[3 * a + c] = fix[3 * n + c] ? 0 : x[3 * n + c];
      else { const f = S.frm, o = 9 * S.rot[n], p0 = fix[3 * n] ? 0 : x[3 * n], p1 = fix[3 * n + 1] ? 0 : x[3 * n + 1], p2 = fix[3 * n + 2] ? 0 : x[3 * n + 2];
        for (let c = 0; c < 3; c++) ue[3 * a + c] = p0 * f[o + c] + p1 * f[o + 3 + c] + p2 * f[o + 6 + c]; }
    }
    for (let c = 0; c < npp; c++) { const i = nU + pOf[el[CORNER[c]]]; pe[c] = fix[i] ? 0 : x[i]; }
    re.fill(0); rp.fill(0);
    for (let q = 0; q < nq; q++) {
      const g = geo.subarray((g0 + e * nq + q) * 10, (g0 + e * nq + q) * 10 + 10), w = g[9], s = st.subarray((g0 + e * nq + q) * 20, (g0 + e * nq + q) * 20 + 20);
      let u0 = 0, u1 = 0, u2 = 0, b00 = 0, b01 = 0, b02 = 0, b10 = 0, b11 = 0, b12 = 0, b20 = 0, b21 = 0, b22 = 0;
      for (let a = 0; a < npe; a++) {
        const na = Ref.Na[q * npe + a], nb = Ref.Nb[q * npe + a], ng = Ref.Ng[q * npe + a], N = Ref.N[q * npe + a];
        const dx = na * g[0] + nb * g[3] + ng * g[6], dy = na * g[1] + nb * g[4] + ng * g[7], dz = na * g[2] + nb * g[5] + ng * g[8];
        dNx[a] = dx; dNy[a] = dy; dNz[a] = dz;
        const v0 = ue[3 * a], v1 = ue[3 * a + 1], v2 = ue[3 * a + 2];
        u0 += N * v0; u1 += N * v1; u2 += N * v2;
        b00 += v0 * dx; b01 += v0 * dy; b02 += v0 * dz; b10 += v1 * dx; b11 += v1 * dy; b12 += v1 * dz; b20 += v2 * dx; b21 += v2 * dy; b22 += v2 * dz;
      }
      let p = 0; for (let c = 0; c < npp; c++) p += Ref.P[q * npp + c] * pe[c];
      const mu = s[0], ka = s[1], D00 = s[2], D11 = s[3], D22 = s[4], D01 = s[5], D02 = s[6], D12 = s[7];
      const d00 = b00, d11 = b11, d22 = b22, d01 = (b01 + b10) / 2, d02 = (b02 + b20) / 2, d12 = (b12 + b21) / 2;
      const DD = D00 * d00 + D11 * d11 + D22 * d22 + 2 * (D01 * d01 + D02 * d02 + D12 * d12), k = ka * DD;
      const T00 = 2 * mu * d00 + k * D00 - p, T11 = 2 * mu * d11 + k * D11 - p, T22 = 2 * mu * d22 + k * D22 - p;
      const T01 = 2 * mu * d01 + k * D01, T02 = 2 * mu * d02 + k * D02, T12 = 2 * mu * d12 + k * D12;
      // inertia, linearized: Re ((δu·∇)u + (u·∇)δu)
      const U0 = s[8], U1 = s[9], U2 = s[10];
      const c0 = Re * (u0 * s[11] + u1 * s[12] + u2 * s[13] + U0 * b00 + U1 * b01 + U2 * b02);
      const c1 = Re * (u0 * s[14] + u1 * s[15] + u2 * s[16] + U0 * b10 + U1 * b11 + U2 * b12);
      const c2 = Re * (u0 * s[17] + u1 * s[18] + u2 * s[19] + U0 * b20 + U1 * b21 + U2 * b22);
      for (let a = 0; a < npe; a++) {
        const N = Ref.N[q * npe + a], dx = dNx[a], dy = dNy[a], dz = dNz[a];
        re[3 * a] += w * (T00 * dx + T01 * dy + T02 * dz + c0 * N);
        re[3 * a + 1] += w * (T01 * dx + T11 * dy + T12 * dz + c1 * N);
        re[3 * a + 2] += w * (T02 * dx + T12 * dy + T22 * dz + c2 * N);
      }
      const div = b00 + b11 + b22;
      for (let c = 0; c < npp; c++) rp[c] -= w * Ref.P[q * npp + c] * div;
    }
    for (let a = 0; a < npe; a++) ffAddNodal(S, y, el[a], re[3 * a], re[3 * a + 1], re[3 * a + 2]);
    for (let c = 0; c < npp; c++) y[nU + pOf[el[CORNER[c]]]] += rp[c];
  }
  }
  for (const F of S.fFaces) if (F.knS) ffRobinFace(S, F, x, y, true);
  for (let i = 0; i < S.nD; i++) if (fix[i]) y[i] = x[i];
  return y;
}


// ---------------------------------------------------------------------------------------------------------------------
// Sparse matrices (CSR) and smoothed-aggregation algebraic multigrid
// ---------------------------------------------------------------------------------------------------------------------
/** CSR from triplets (summing duplicates). */
function ffCSR(n, I, J, V, m = n) {
  const cnt = new Int32Array(n + 1);
  for (let k = 0; k < I.length; k++) cnt[I[k] + 1]++;
  for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
  const pos = cnt.slice(), col = new Int32Array(I.length), val = new Float64Array(I.length);
  for (let k = 0; k < I.length; k++) { const p = pos[I[k]]++; col[p] = J[k]; val[p] = V[k]; }
  // sort each row and merge duplicates
  const ptr = new Int32Array(n + 1), oc = [], ov = [];
  for (let i = 0; i < n; i++) {
    const a = cnt[i], b = cnt[i + 1], idx = []; for (let p = a; p < b; p++) idx.push(p);
    idx.sort((p, q) => col[p] - col[q]);
    let last = -1;
    for (const p of idx) { if (col[p] === last) ov[ov.length - 1] += val[p]; else { oc.push(col[p]); ov.push(val[p]); last = col[p]; } }
    ptr[i + 1] = oc.length;
  }
  return { n, m, ptr, col: Int32Array.from(oc), val: Float64Array.from(ov) };
}
const ffMatVec = (A, x, y = new Float64Array(A.n)) => { for (let i = 0; i < A.n; i++) { let s = 0; for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) s += A.val[p] * x[A.col[p]]; y[i] = s; } return y; };
function ffTranspose(A) {
  const I = [], J = [], V = [];
  for (let i = 0; i < A.n; i++) for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) { I.push(A.col[p]); J.push(i); V.push(A.val[p]); }
  return ffCSR(A.m, I, J, V, A.n);
}
/** C = A B (Gustavson). */
function ffMatMul(A, B) {
  const ptr = new Int32Array(A.n + 1), cols = [], vals = [], acc = new Float64Array(B.m), mark = new Int32Array(B.m).fill(-1);
  for (let i = 0; i < A.n; i++) {
    const row = [];
    for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) {
      const k = A.col[p], a = A.val[p];
      for (let q = B.ptr[k]; q < B.ptr[k + 1]; q++) { const j = B.col[q]; if (mark[j] !== i) { mark[j] = i; acc[j] = 0; row.push(j); } acc[j] += a * B.val[q]; }
    }
    row.sort((p, q) => p - q);
    for (const j of row) { cols.push(j); vals.push(acc[j]); }
    ptr[i + 1] = cols.length;
  }
  return { n: A.n, m: B.m, ptr, col: Int32Array.from(cols), val: Float64Array.from(vals) };
}
/** A smoothed-aggregation hierarchy for a symmetric positive (semi)definite A (rows of fixed unknowns: identity). */
function ffAMG(A, opts = {}) {
  // (θ: for 3D trilinear stencils the off-diagonals are ~6 % of the diagonal -- a 2D-style 0.08 would find no strong link;
  //  opts.agg0: the first level's aggregates given -- a prism layer's column of nodes, one; opts.smooth false: the
  //  prolongator left unsmoothed, the coarse levels as sparse as the aggregates make them)
  const theta = opts.theta ?? 0.02, nCoarse = opts.nCoarse ?? 400, smooth = opts.smooth ?? true, levels = [];
  let Ak = A;
  for (let lev = 0; lev < 20 && Ak.n > nCoarse; lev++) {
    const n = Ak.n, diag = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let p = Ak.ptr[i]; p < Ak.ptr[i + 1]; p++) if (Ak.col[p] === i) diag[i] = Ak.val[p];
    // strength: |a_ij| >= theta sqrt(a_ii a_jj)
    // strong links: negative couplings with |a_ij| >= θ sqrt(a_ii a_jj); a row with no coupling at all (a fixed unknown's
    // identity row) is left out of the coarse levels (the smoother solves it exactly)
    const isolated = new Uint8Array(n);
    const strong = i => { const out = []; let any = false; for (let p = Ak.ptr[i]; p < Ak.ptr[i + 1]; p++) { const j = Ak.col[p]; if (j === i || Ak.val[p] === 0) continue; any = true; if (Ak.val[p] < 0 && -Ak.val[p] >= theta * Math.sqrt(Math.abs(diag[i] * diag[j]))) out.push(j); } if (!any) isolated[i] = 1; return out; };
    const S = Array.from({ length: n }, (_, i) => strong(i));
    // aggregation: (1) a root and its strong neighbours, all unaggregated; (2) the rest join a neighbouring aggregate; (3) leftovers on their own
    const agg = new Int32Array(n).fill(-1); let nA = 0;
    if (lev === 0 && opts.agg0) { const id = new Map(); for (let i = 0; i < n; i++) if (!isolated[i]) { const c = opts.agg0[i]; if (!id.has(c)) id.set(c, nA++); agg[i] = id.get(c); } }
    else {
    for (let i = 0; i < n; i++) { if (isolated[i] || agg[i] >= 0 || !S[i].length) continue; if (S[i].some(j => agg[j] >= 0)) continue; agg[i] = nA; for (const j of S[i]) agg[j] = nA; nA++; }
    for (let i = 0; i < n; i++) if (agg[i] < 0 && !isolated[i]) { const j = S[i].find(j => agg[j] >= 0); if (j != null) agg[i] = agg[j]; }
    for (let i = 0; i < n; i++) if (agg[i] < 0 && !isolated[i]) agg[i] = nA++;
    }
    if (nA >= (n - isolated.reduce((s, v) => s + v, 0)) * 0.9 || nA === 0) break;   // (not coarsening: stop here)
    const TI = [], TJ = []; for (let i = 0; i < n; i++) if (agg[i] >= 0) { TI.push(i); TJ.push(agg[i]); }
    const T = ffCSR(n, TI, TJ, new Array(TI.length).fill(1), nA);
    // the prolongator smoothed by damped Jacobi: P = (I − ω D⁻¹ A) T, ω = 4 / (3 ρ(D⁻¹A))
    let P = T;
    if (smooth) {
    let v = new Float64Array(n).map((_, i) => 1 + (i % 7) / 7), rho = 1;   // (a fixed start: the same hierarchy every run)
    for (let it = 0; it < 15; it++) { const w = ffMatVec(Ak, v); let nn = 0; for (let i = 0; i < n; i++) { w[i] /= diag[i]; nn += w[i] * w[i]; } nn = Math.sqrt(nn); rho = nn / Math.sqrt(v.reduce((s, t) => s + t * t, 0)); v = w.map(t => t / nn); }
    const om = 4 / (3 * rho);
    const DA = { ...Ak, val: Ak.val.map((a, p) => a) };
    for (let i = 0; i < n; i++) for (let p = DA.ptr[i]; p < DA.ptr[i + 1]; p++) DA.val[p] = (Ak.col[p] === i ? 1 : 0) - om * Ak.val[p] / diag[i];
    P = ffMatMul(DA, T);
    }
    const R = ffTranspose(P), Ac = ffMatMul(R, ffMatMul(Ak, P));
    levels.push({ A: Ak, P, R, diag });
    Ak = Ac;
  }
  // the coarsest: dense LU (partial pivoting)
  const n = Ak.n, LU = new Float64Array(n * n), piv = new Int32Array(n);
  for (let i = 0; i < n; i++) for (let p = Ak.ptr[i]; p < Ak.ptr[i + 1]; p++) LU[i * n + Ak.col[p]] = Ak.val[p];
  for (let k = 0; k < n; k++) {
    let m = k, big = Math.abs(LU[k * n + k]); for (let i = k + 1; i < n; i++) if (Math.abs(LU[i * n + k]) > big) { big = Math.abs(LU[i * n + k]); m = i; }
    piv[k] = m; if (m !== k) for (let j = 0; j < n; j++) { const t = LU[k * n + j]; LU[k * n + j] = LU[m * n + j]; LU[m * n + j] = t; }
    const d = LU[k * n + k] || 1e-300;
    for (let i = k + 1; i < n; i++) { const f = (LU[i * n + k] /= d); if (f) for (let j = k + 1; j < n; j++) LU[i * n + j] -= f * LU[k * n + j]; }
  }
  return { levels, coarse: { A: Ak, LU, piv, n } };
}
function ffCoarseSolve(C, b) {
  const n = C.n, x = Float64Array.from(b), LU = C.LU;
  for (let k = 0; k < n; k++) { const m = C.piv[k]; if (m !== k) { const t = x[k]; x[k] = x[m]; x[m] = t; } for (let i = k + 1; i < n; i++) x[i] -= LU[i * n + k] * x[k]; }
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let j = i + 1; j < n; j++) s -= LU[i * n + j] * x[j]; x[i] = s / (LU[i * n + i] || 1e-300); }
  return x;
}
/** One Gauss–Seidel sweep on A x = b, forward or (back) backward. */
function ffGS(A, diag, b, x, back) {
  for (let t = 0; t < A.n; t++) {
    const i = back ? A.n - 1 - t : t; let s = b[i];
    for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) { const j = A.col[p]; if (j !== i) s -= A.val[p] * x[j]; }
    x[i] = s / diag[i];
  }
}
/** One V-cycle for A x = b from x = 0: a forward Gauss–Seidel sweep down, a backward one up (the cycle symmetric, as CG
 *  needs; each sweep's two passes before took a quarter longer for the same iterations). */
function ffVcycle(H, b, lev = 0) {
  if (lev === H.levels.length) return ffCoarseSolve(H.coarse, b);
  const L = H.levels[lev], x = new Float64Array(L.A.n);
  ffGS(L.A, L.diag, b, x, false);
  const r = ffMatVec(L.A, x); for (let i = 0; i < r.length; i++) r[i] = b[i] - r[i];
  const ec = ffVcycle(H, ffMatVec(L.R, r), lev + 1), e = ffMatVec(L.P, ec);
  for (let i = 0; i < x.length; i++) x[i] += e[i];
  ffGS(L.A, L.diag, b, x, true);
  return x;
}

/**
 * The preconditioner's pieces at the current state: the viscosity-weighted Laplacian on the trilinear sub-hexahedra (one
 * per velocity component: its fixed nodes' rows set to identity), each with its multigrid; the lumped pressure mass over μ.
 */
function ffPrecond(S, opts = {}) {
  const { M, nN, geo, st, nU, pOf, fix } = S;
  const I = [], J = [], V = [], VG = [], muN = new Float64Array(nN), cntN = new Float64Array(nN), m1 = new Float64Array(nN);
  const sub = [];
  for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const c = []; for (let gg = 0; gg < 2; gg++) for (let bb = 0; bb < 2; bb++) for (let aa = 0; aa < 2; aa++) c.push(((g + gg) * 3 + (b + bb)) * 3 + (a + aa)); sub.push(c);
  }
  const G1 = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const Sp = new Float64Array(S.nP), MI = [], MJ = [], MV = [];
  for (const B of S.B) {
  const K = B.K, nE = B.nE, npe = K.npe, nq = K.nq, npp = K.npp, conn = B.conn, Ref = K.T, g0 = B.g0;
  for (let e = 0; e < nE; e++) {
    const el = conn.subarray(npe * e, npe * e + npe);
    // the element's mean viscosity (over its quadrature points)
    let mu = 0; for (let q = 0; q < nq; q++) mu += st[(g0 + e * nq + q) * 20] / nq;
    // (a tetrahedron: its 8 linear sub-tetrahedra -- 4 at its corners, 4 round the inner octahedron's diagonal 6–8; a
    //  prism: its 24 -- each its exact P1 Laplacian and load)
    if (!K.hex) for (const c of K.sub) {
      const n = c.map(k => el[k]), P = n.map(i => [S.X[i], S.Y[i], S.Z[i]]), Jm = [0, 1, 2].map(r => [0, 1, 2].map(d => P[r + 1][d] - P[0][d]));
      const det = Jm[0][0] * (Jm[1][1] * Jm[2][2] - Jm[1][2] * Jm[2][1]) - Jm[0][1] * (Jm[1][0] * Jm[2][2] - Jm[1][2] * Jm[2][0]) + Jm[0][2] * (Jm[1][0] * Jm[2][1] - Jm[1][1] * Jm[2][0]), V6 = Math.abs(det);
      // (the gradients: rows of J⁻ᵀ for the corners 1–3, the first their negative sum)
      const inv = [[(Jm[1][1] * Jm[2][2] - Jm[1][2] * Jm[2][1]) / det, (Jm[0][2] * Jm[2][1] - Jm[0][1] * Jm[2][2]) / det, (Jm[0][1] * Jm[1][2] - Jm[0][2] * Jm[1][1]) / det],
        [(Jm[1][2] * Jm[2][0] - Jm[1][0] * Jm[2][2]) / det, (Jm[0][0] * Jm[2][2] - Jm[0][2] * Jm[2][0]) / det, (Jm[0][2] * Jm[1][0] - Jm[0][0] * Jm[1][2]) / det],
        [(Jm[1][0] * Jm[2][1] - Jm[1][1] * Jm[2][0]) / det, (Jm[0][1] * Jm[2][0] - Jm[0][0] * Jm[2][1]) / det, (Jm[0][0] * Jm[1][1] - Jm[0][1] * Jm[1][0]) / det]];
      const G = [1, 2, 3].map(k => [inv[0][k - 1], inv[1][k - 1], inv[2][k - 1]]); G.unshift([-G[0][0] - G[1][0] - G[2][0], -G[0][1] - G[1][1] - G[2][1], -G[0][2] - G[1][2] - G[2][2]]);
      for (let i = 0; i < 4; i++) { m1[n[i]] += V6 / 24; for (let j = 0; j < 4; j++) { const k = V6 / 6 * (G[i][0] * G[j][0] + G[i][1] * G[j][1] + G[i][2] * G[j][2]); I.push(n[i]); J.push(n[j]); V.push(mu * k); VG.push(k); } }
    }
    else for (const c of sub) {
      const n = c.map(k => el[k]), Ke = new Float64Array(64);
      for (const z of G1) for (const y of G1) for (const x of G1) {
        const dN = [], dA = [(-(1 - y) * (1 - z)), ((1 - y) * (1 - z)), (-(1 + y) * (1 - z)), ((1 + y) * (1 - z)), (-(1 - y) * (1 + z)), ((1 - y) * (1 + z)), (-(1 + y) * (1 + z)), ((1 + y) * (1 + z))].map(v => v / 8);
        const dB = [(-(1 - x) * (1 - z)), (-(1 + x) * (1 - z)), ((1 - x) * (1 - z)), ((1 + x) * (1 - z)), (-(1 - x) * (1 + z)), (-(1 + x) * (1 + z)), ((1 - x) * (1 + z)), ((1 + x) * (1 + z))].map(v => v / 8);
        const dC = [(-(1 - x) * (1 - y)), (-(1 + x) * (1 - y)), (-(1 - x) * (1 + y)), (-(1 + x) * (1 + y)), ((1 - x) * (1 - y)), ((1 + x) * (1 - y)), ((1 - x) * (1 + y)), ((1 + x) * (1 + y))].map(v => v / 8);
        const Jm = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let k = 0; k < 8; k++) { const P = [S.X[n[k]], S.Y[n[k]], S.Z[n[k]]]; for (let d = 0; d < 3; d++) { Jm[d] += dA[k] * P[d]; Jm[3 + d] += dB[k] * P[d]; Jm[6 + d] += dC[k] * P[d]; } }
        const det = Jm[0] * (Jm[4] * Jm[8] - Jm[5] * Jm[7]) - Jm[1] * (Jm[3] * Jm[8] - Jm[5] * Jm[6]) + Jm[2] * (Jm[3] * Jm[7] - Jm[4] * Jm[6]);
        const inv = [(Jm[4] * Jm[8] - Jm[5] * Jm[7]) / det, -(Jm[1] * Jm[8] - Jm[2] * Jm[7]) / det, (Jm[1] * Jm[5] - Jm[2] * Jm[4]) / det,
          -(Jm[3] * Jm[8] - Jm[5] * Jm[6]) / det, (Jm[0] * Jm[8] - Jm[2] * Jm[6]) / det, -(Jm[0] * Jm[5] - Jm[2] * Jm[3]) / det,
          (Jm[3] * Jm[7] - Jm[4] * Jm[6]) / det, -(Jm[0] * Jm[7] - Jm[1] * Jm[6]) / det, (Jm[0] * Jm[4] - Jm[1] * Jm[3]) / det];
        for (let k = 0; k < 8; k++) dN.push([dA[k] * inv[0] + dB[k] * inv[1] + dC[k] * inv[2], dA[k] * inv[3] + dB[k] * inv[4] + dC[k] * inv[5], dA[k] * inv[6] + dB[k] * inv[7] + dC[k] * inv[8]]);
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) Ke[i * 8 + j] += Math.abs(det) * (dN[i][0] * dN[j][0] + dN[i][1] * dN[j][1] + dN[i][2] * dN[j][2]);
        for (let k = 0; k < 8; k++) m1[n[k]] += Math.abs(det) * (k & 1 ? 1 + x : 1 - x) * (k & 2 ? 1 + y : 1 - y) * (k & 4 ? 1 + z : 1 - z) / 8;
      }
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { I.push(n[i]); J.push(n[j]); V.push(mu * Ke[i * 8 + j]); VG.push(Ke[i * 8 + j]); }
    }
    for (const n of el) { muN[n] += mu; cntN[n]++; }
    // the pressure mass over μ (consistent): the Schur complement's stand-in
    const pe = K.corner.map(c => pOf[el[c]]), Me = new Float64Array(npp * npp);
    for (let q = 0; q < nq; q++) { const w = geo[(g0 + e * nq + q) * 10 + 9] / st[(g0 + e * nq + q) * 20]; for (let i = 0; i < npp; i++) for (let j = 0; j < npp; j++) Me[i * npp + j] += w * Ref.P[q * npp + i] * Ref.P[q * npp + j]; }
    for (let i = 0; i < npp; i++) { Sp[pe[i]] += Me[i * npp + i]; for (let j = 0; j < npp; j++) { MI.push(pe[i]); MJ.push(pe[j]); MV.push(Me[i * npp + j]); } }
  }
  }
  // (a node in no element -- cut out of a block -- an identity row: the multigrid needs every diagonal)
  for (let n = 0; n < nN; n++) if (!cntN[n]) { I.push(n); J.push(n); V.push(1); VG.push(1); }
  const L = ffCSR(nN, I, J, V), Mp = ffCSR(S.nP, MI, MJ, MV);
  // (a free surface's implicit weight, lumped onto each axis's diagonal: kn ∫ N dA n_c²)
  const rob = [0, 1, 2].map(() => new Float64Array(nN));
  for (const F of S.fFaces) if (F.knS) { let k = 0; ffFaceNormals(M, S.X, S.Y, S.Z, F, (n, v) => { const a = Math.hypot(...v), w = [1 / 3, 4 / 3, 1 / 3][Math.floor(k / 3)] * [1 / 3, 4 / 3, 1 / 3][k % 3]; k++; for (let c = 0; c < 3; c++) rob[c][n] += F.knS * w * a * (v[c] / a) ** 2; }); }
  const comp = [0, 1, 2].map(c => {
    // fixed nodes of this component: identity rows and columns
    const A = { ...L, val: Float64Array.from(L.val) };
    const fixC = S.fixC;
    for (let i = 0; i < nN; i++) for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) { const j = A.col[p]; if (fixC[3 * i + c] || fixC[3 * j + c]) A.val[p] = i === j ? 1 : 0; else if (i === j) A.val[p] += rob[c][i]; }
    return { A, H: S.cols ? ffAMG(A, { agg0: S.cols, smooth: false }) : ffAMG(A) };
  });
  const lub = opts.lub === false ? null : ffLubrication(S, ffCSR(nN, I, J, VG), m1, muN.map((m, n) => m / (cntN[n] || 1)), Mp);
  return { comp, Sp, Mp, lub };
}

/**
 * The Schur complement's thin-film part. In a gap or a film the pressure's smooth modes see Ŝ ≈ the Reynolds operator
 * ∇·(h²/12μ ∇), far below the pressure mass over μ (by (h/L)²): the mass alone leaves them to GMRES (about a hundred hard
 * modes on the coater). Each node's response to a pressure gradient in a unidirectional flow, u = −(φ/μ) ∇p, has φ from
 * ∇²φ = −1 (φ = 0 on the walls, free on lids, mirrors and outlets): exactly y(h−y)/2 in a channel, y(2h−y)/2 in a film
 * on a wall, (R²−r²)/4 in a pipe. So Ŝ_lub = B diag(φ/μm) Bᵀ (m the lumped mass), and Ŝ⁻¹ ≈ μ Mp⁻¹ + Ŝ_lub⁻¹: the
 * mass where the flow is thick (Ŝ_lub ≫ M/μ), the film's operator where it is thin.
 */
function ffLubrication(S, Lg, m1, muN, Mp) {
  const { nN, nU, nP, geo, pOf, fix } = S;
  // φ: the geometric Laplacian (trilinear sub-hexahedra), φ = 0 where all three velocity components are given
  if (!S.phi) {
    const wall = new Uint8Array(nN); for (let n = 0; n < nN; n++) wall[n] = fix[3 * n] && fix[3 * n + 1] && fix[3 * n + 2] ? 1 : 0;
    const A = { ...Lg, val: Float64Array.from(Lg.val) };
    for (let i = 0; i < nN; i++) for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) { const j = A.col[p]; if (wall[i] || wall[j]) A.val[p] = i === j ? 1 : 0; }
    const m = new Float64Array(nN);
    // (each node's share of the volume: on hexahedra ∫ N dV; on tetrahedra and prisms, whose P2 corners' ∫ N dV is
    //  negative or zero, the linear sub-tetrahedra's lumped quarters)
    for (const B of S.B) { const K = B.K, Ref = K.T, npe = K.npe, nq = K.nq, conn = B.conn, g0 = B.g0;
      if (K.hex) { for (let e = 0; e < B.nE; e++) for (let q = 0; q < nq; q++) { const w = geo[(g0 + e * nq + q) * 10 + 9]; for (let a = 0; a < npe; a++) m[conn[npe * e + a]] += w * Ref.N[q * npe + a]; } }
      else for (let e = 0; e < B.nE; e++) for (const c of K.sub) {
        const n = c.map(k => conn[npe * e + k]), d = [1, 2, 3].map(r => [S.X[n[r]] - S.X[n[0]], S.Y[n[r]] - S.Y[n[0]], S.Z[n[r]] - S.Z[n[0]]]);
        const V = Math.abs(d[0][0] * (d[1][1] * d[2][2] - d[1][2] * d[2][1]) - d[0][1] * (d[1][0] * d[2][2] - d[1][2] * d[2][0]) + d[0][2] * (d[1][0] * d[2][1] - d[1][1] * d[2][0])) / 6;
        for (const i of n) m[i] += V / 4; } }
    // (the load on the trilinear sub-hexahedra's own functions: a 1D profile comes out exact at the nodes)
    const b = m1.map((v, n) => wall[n] ? 0 : v), H = ffAMG(A);
    S.phi = ffPCG(v => ffMatVec(A, v), v => ffVcycle(H, v), b, 200, 1e-10);
    S.mLump = m;
  }
  const phi = S.phi, m = S.mLump;
  // B (pressure × free velocity), each column scaled by φ/(μ m); then B D⁻¹ Bᵀ
  const BI = [], BJ = [], BV = [], dinv = new Float64Array(nU);
  for (let n = 0; n < nN; n++) for (let c = 0; c < 3; c++) if (!S.fixC[3 * n + c]) dinv[3 * n + c] = Math.max(phi[n], 0) / (muN[n] * m[n]);
  for (const B of S.B) {
  const K = B.K, nE = B.nE, Ref = K.T, npe = K.npe, nq = K.nq, npp = K.npp, CORNER = K.corner, conn = B.conn, g0 = B.g0;
  const be = new Float64Array(npp * 3 * npe), dNx = new Float64Array(npe), dNy = new Float64Array(npe), dNz = new Float64Array(npe);
  for (let e = 0; e < nE; e++) {
    const el = conn.subarray(npe * e, npe * e + npe); be.fill(0);
    for (let q = 0; q < nq; q++) {
      const g = geo.subarray((g0 + e * nq + q) * 10, (g0 + e * nq + q) * 10 + 10), w = g[9];
      for (let a = 0; a < npe; a++) { const na = Ref.Na[q * npe + a], nb = Ref.Nb[q * npe + a], ng = Ref.Ng[q * npe + a]; dNx[a] = na * g[0] + nb * g[3] + ng * g[6]; dNy[a] = na * g[1] + nb * g[4] + ng * g[7]; dNz[a] = na * g[2] + nb * g[5] + ng * g[8]; }
      for (let c = 0; c < npp; c++) { const P = w * Ref.P[q * npp + c]; for (let a = 0; a < npe; a++) { be[c * 3 * npe + 3 * a] -= P * dNx[a]; be[c * 3 * npe + 3 * a + 1] -= P * dNy[a]; be[c * 3 * npe + 3 * a + 2] -= P * dNz[a]; } }
    }
    for (let c = 0; c < npp; c++) { const i = pOf[el[CORNER[c]]]; if (fix[nU + i]) continue; for (let a = 0; a < npe; a++) for (let d = 0; d < 3; d++) { const j = 3 * el[a] + d; if (dinv[j]) { BI.push(i); BJ.push(j); BV.push(be[c * 3 * npe + 3 * a + d]); } } }
  }
  }
  const B = ffCSR(nP, BI, BJ, BV, nU), Bt = ffTranspose(B);
  for (let i = 0; i < Bt.n; i++) for (let p = Bt.ptr[i]; p < Bt.ptr[i + 1]; p++) Bt.val[p] *= dinv[i];
  const L0 = ffMatMul(B, Bt);
  // (plus a sliver of the mass over μ: the operator is singular in a closed box and nearly so with a small outlet; this caps
  //  the correction at 10⁴ for the smoothest, longest modes. A fixed pressure: an identity row.)
  const LI = [], LJ = [], LV = [];
  for (let i = 0; i < nP; i++) for (let p = L0.ptr[i]; p < L0.ptr[i + 1]; p++) { LI.push(i); LJ.push(L0.col[p]); LV.push(L0.val[p]); }
  for (let i = 0; i < nP; i++) for (let p = Mp.ptr[i]; p < Mp.ptr[i + 1]; p++) { LI.push(i); LJ.push(Mp.col[p]); LV.push(1e-4 * Mp.val[p]); }
  const L = ffCSR(nP, LI, LJ, LV);
  for (let i = 0; i < nP; i++) for (let p = L.ptr[i]; p < L.ptr[i + 1]; p++) if (fix[nU + i] || fix[nU + L.col[p]]) L.val[p] = i === L.col[p] ? 1 : 0;
  return { L, H: ffAMG(L) };
}

/** z = P⁻¹ r (the block-triangular preconditioner): the pressure from the Schur stand-in (the consistent pressure mass
 *  over μ, a few Jacobi-preconditioned CG steps), then the velocity from the velocity block (a few CG steps on the true
 *  block, each preconditioned by a multigrid V-cycle per component). FGMRES takes a preconditioner that varies. */
function ffApplyPrec(S, PC, r, opts = {}) {
  const z = new Float64Array(S.nD), { nN, nU, nP, fix } = S;
  const itP = opts.itP ?? 8, itU = opts.itU ?? (S.cols ? 25 : 12);   // (prism layers: the velocity block's inner solve longer)
  // pressure: −Ŝ⁻¹ r_p
  {
    const b = new Float64Array(nP); for (let i = 0; i < nP; i++) b[i] = fix[nU + i] ? 0 : r[nU + i];
    const x = ffPCG(v => { const y = ffMatVec(PC.Mp, v); for (let i = 0; i < nP; i++) if (fix[nU + i]) y[i] = v[i]; return y; }, v => v.map((t, i) => t / PC.Sp[i]), b, itP);
    // (+ the thin-film part, a few CG steps on its multigrid)
    const xl = PC.lub && opts.lub !== false ? ffPCG(v => ffMatVec(PC.lub.L, v), v => ffVcycle(PC.lub.H, v), b, opts.itL ?? 10) : null;
    for (let i = 0; i < nP; i++) z[nU + i] = fix[nU + i] ? r[nU + i] : -x[i] - (xl ? xl[i] : 0);
  }
  // velocity: Â⁻¹ (r_u − Bᵀ z_p)
  const zp = new Float64Array(S.nD); for (let i = 0; i < nP; i++) zp[nU + i] = fix[nU + i] ? 0 : z[nU + i];
  const Bt = ffJacVec(S, zp);   // (with zero velocity: Bᵀ z_p in the velocity rows)
  const rhs = new Float64Array(nU); for (let i = 0; i < nU; i++) rhs[i] = fix[i] ? r[i] : r[i] - Bt[i];
  // (per axis; a node in a frame of its own: each frame component with its nearest axis)
  const sl = S.slot, Mv = v => { const out = new Float64Array(nU); for (let c = 0; c < 3; c++) { const b = new Float64Array(nN); for (let i = 0; i < nN; i++) b[i] = v[3 * i + sl[3 * i + c]]; const x = ffVcycle(PC.comp[c].H, b); for (let i = 0; i < nN; i++) out[3 * i + sl[3 * i + c]] = x[i]; } return out; };
  const work = new Float64Array(S.nD);
  const Juu = v => { work.fill(0); for (let i = 0; i < nU; i++) work[i] = fix[i] ? 0 : v[i]; const y = ffJacVec(S, work); const out = new Float64Array(nU); for (let i = 0; i < nU; i++) out[i] = fix[i] ? v[i] : y[i]; return out; };
  const u = itU > 0 ? ffPCG(Juu, Mv, rhs, itU) : Mv(rhs);
  for (let i = 0; i < nU; i++) z[i] = u[i];
  return z;
}
/** k steps of preconditioned CG on A x = b from 0 (A, M as functions). */
function ffPCG(A, M, b, k, tol = 1e-3) {
  const n = b.length, x = new Float64Array(n), r = Float64Array.from(b);
  const b0 = Math.sqrt(b.reduce((s, v) => s + v * v, 0)); if (!b0) return x;
  let z = M(r), p = Float64Array.from(z), rz = 0; for (let i = 0; i < n; i++) rz += r[i] * z[i];
  for (let it = 0; it < k; it++) {
    const Ap = A(p); let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (!(pAp > 0)) break;
    const al = rz / pAp; let rr = 0; for (let i = 0; i < n; i++) { x[i] += al * p[i]; r[i] -= al * Ap[i]; rr += r[i] * r[i]; }
    if (Math.sqrt(rr) / b0 < tol) break;
    z = M(r); let rz2 = 0; for (let i = 0; i < n; i++) rz2 += r[i] * z[i];
    const be = rz2 / rz; for (let i = 0; i < n; i++) p[i] = z[i] + be * p[i]; rz = rz2;
  }
  return x;
}

/** Flexible GMRES(m): J z = b, right-preconditioned. Returns { x, it, res }. */
function ffFGMRES(S, PC, b, opts = {}) {
  const m = opts.restart ?? 60, tol = opts.tol ?? 1e-8, maxIt = opts.maxIt ?? 600, n = S.nD;
  const dot = (a, c) => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * c[i]; return s; }, nrm = a => Math.sqrt(dot(a, a));
  const x = new Float64Array(n), b0 = nrm(b);
  if (b0 === 0) return { x, it: 0, res: 0 };
  let it = 0, res = 1;
  while (it < maxIt) {
    const Ax = ffJacVec(S, x), r = new Float64Array(n); for (let i = 0; i < n; i++) r[i] = b[i] - Ax[i];
    let beta = nrm(r); res = beta / b0; if (res < tol) break;
    const V = [r.map(v => v / beta)], Z = [], Hm = [], cs = [], sn = [], gv = [beta];
    let k = 0;
    for (; k < m && it < maxIt; k++, it++) {
      const z = ffApplyPrec(S, PC, V[k], opts.prec); Z.push(z);
      const w = ffJacVec(S, z), h = new Float64Array(k + 2);
      for (let j = 0; j <= k; j++) { h[j] = dot(w, V[j]); for (let i = 0; i < n; i++) w[i] -= h[j] * V[j][i]; }
      h[k + 1] = nrm(w); V.push(w.map(v => v / (h[k + 1] || 1)));
      for (let j = 0; j < k; j++) { const t = cs[j] * h[j] + sn[j] * h[j + 1]; h[j + 1] = -sn[j] * h[j] + cs[j] * h[j + 1]; h[j] = t; }
      const d = Math.hypot(h[k], h[k + 1]); cs[k] = h[k] / d; sn[k] = h[k + 1] / d; h[k] = d; h[k + 1] = 0;
      gv[k + 1] = -sn[k] * gv[k]; gv[k] = cs[k] * gv[k];
      Hm.push(h); res = Math.abs(gv[k + 1]) / b0;
      if (opts.onIt) opts.onIt(it, res);
      if (res < tol) { k++; it++; break; }
    }
    // solve the small triangular system and update
    const yv = new Float64Array(k);
    for (let i = k - 1; i >= 0; i--) { let s = gv[i]; for (let j = i + 1; j < k; j++) s -= Hm[j][i] * yv[j]; yv[i] = s / Hm[i][i]; }
    for (let j = 0; j < k; j++) for (let i = 0; i < n; i++) x[i] += yv[j] * Z[j][i];
    if (res < tol) break;
  }
  return { x, it, res };
}

/** The preconditioner at the current state: the one built last when the viscosity it took is the same at every quadrature
 *  point (a constant viscosity: every Newton step's), else a new one. */
function ffPrecondAt(S) {
  const st = S.st, nQ = st.length / 20;
  if (S.pcMu && S.pcMu.length === nQ) { let same = true; for (let q = 0; q < nQ; q++) if (st[20 * q] !== S.pcMu[q]) { same = false; break; } if (same) return S.pc; }
  S.pc = ffPrecond(S); S.pcMu = new Float64Array(nQ); for (let q = 0; q < nQ; q++) S.pcMu[q] = st[20 * q];
  return S.pc;
}
/**
 * Solve: Newton from x0 (default: the fixed values, zero elsewhere), each step by FGMRES. Returns the state (SI at the
 * nodes: u, v, w, p) and the history.
 */
function ffSolve(S, opts = {}) {
  const x = opts.x0 ? Float64Array.from(opts.x0) : new Float64Array(S.nD);
  for (let i = 0; i < S.nD; i++) if (S.fix[i]) x[i] = S.val[i];
  const hist = [], maxNewton = opts.maxNewton ?? 30, tol = opts.tol ?? 1e-9;
  let R = ffResidual(S, x), r0 = Math.sqrt(R.reduce((s, v) => s + v * v, 0)), r = r0;
  const t0 = Date.now();
  for (let k = 0; k < maxNewton && r > tol * Math.max(1, r0) && r > 1e-14; k++) {
    const tp = Date.now(), PC = ffPrecondAt(S), tg = Date.now();
    const lin = ffFGMRES(S, PC, R.map(v => -v), { tol: opts.linTol ?? Math.min(1e-3, Math.max(1e-10, 0.1 * r / Math.max(r0, 1e-300))), restart: opts.restart, maxIt: opts.maxIt, onIt: opts.onLinIt });
    // (a backtracking line search: a yield stress makes the full step overshoot far from the answer)
    let al = 1, rn = Infinity; const x0 = Float64Array.from(x);
    for (let ls = 0; ls < (opts.lineSearch ? 8 : 1); ls++, al /= 2) {
      for (let i = 0; i < S.nD; i++) x[i] = S.fix[i] ? x0[i] : x0[i] + al * lin.x[i];
      R = ffResidual(S, x); rn = Math.sqrt(R.reduce((s, v) => s + v * v, 0));
      if (rn < (1 - 1e-4 * al) * r) break;
    }
    hist.push({ k, res: rn, lin: lin.it, linRes: lin.res, step: al, msPrec: tg - tp, msLin: Date.now() - tg });
    if (opts.onNewton) opts.onNewton(hist[hist.length - 1]);
    r = rn;
  }
  const { nN, nU, pOf, Ur, Pr } = S, u = new Float64Array(nN), v = new Float64Array(nN), w = new Float64Array(nN), p = new Float64Array(nN).fill(NaN);
  for (let n = 0; n < nN; n++) { const q = ffNodeU(S, x, n); u[n] = q[0] * Ur; v[n] = q[1] * Ur; w[n] = q[2] * Ur; if (pOf[n] >= 0) p[n] = x[nU + pOf[n]] * Pr; }
  return { x, u, v, w, p, hist, res: r, res0: r0, converged: r <= tol * Math.max(1, r0) || r <= 1e-14, ms: Date.now() - t0 };
}

/** The volume flow out through the faces of a tag (m³/s): ∫ u·n dA over them (n outward). */
function ffFlow(S, x, tag) {
  if (!(S.B.length === 1 && S.B[0].K.hex)) {
    let Q = 0;
    for (const F of S.M.faces) { if (F.tag !== tag) continue;
      for (const q of ffFacePoints(S, F)) { const uu = [0, 0, 0]; for (const k of q.idx) { const un = ffNodeU(S, x, q.el[k]); for (let c = 0; c < 3; c++) uu[c] += q.N[k] * un[c]; }
        Q += q.w * (uu[0] * q.n[0] + uu[1] * q.n[1] + uu[2] * q.n[2]); } }
    return Q * S.Ur * S.Lr * S.Lr;
  }
  const FMF = (typeof FM_FACES !== 'undefined' ? FM_FACES : require('./feed-mesh.js').FM_FACES);
  let Q = 0;
  for (const F of S.M.faces) {
    if (F.tag !== tag) continue;
    const el = S.M.elems.subarray(27 * F.e, 27 * F.e + 27), fixed = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]][F.f], free = [0, 1, 2].filter(k => k !== fixed[0]);
    let cx = 0, cy = 0, cz = 0; for (let k = 0; k < 27; k++) { cx += S.X[el[k]]; cy += S.Y[el[k]]; cz += S.Z[el[k]]; }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const ref = [0, 0, 0]; ref[fixed[0]] = fixed[1]; ref[free[0]] = FF_G[i]; ref[free[1]] = FF_G[j];
      const A = ffQ2(ref[0]), B = ffQ2(ref[1]), C = ffQ2(ref[2]), dA = ffDQ2(ref[0]), dB = ffDQ2(ref[1]), dC = ffDQ2(ref[2]);
      const t1 = [0, 0, 0], t2 = [0, 0, 0], pos = [0, 0, 0], uu = [0, 0, 0];
      for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const k = (g * 3 + b) * 3 + a, n = el[k], P = [S.X[n], S.Y[n], S.Z[n]], d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]], N = A[a] * B[b] * C[g];
        const un = ffNodeU(S, x, n);
        for (let c = 0; c < 3; c++) { t1[c] += d[free[0]] * P[c]; t2[c] += d[free[1]] * P[c]; pos[c] += N * P[c]; uu[c] += N * un[c]; }
      }
      let nr = [t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]];
      if (nr[0] * (pos[0] - cx / 27) + nr[1] * (pos[1] - cy / 27) + nr[2] * (pos[2] - cz / 27) < 0) nr = nr.map(v => -v);
      Q += FF_W[i] * FF_W[j] * (uu[0] * nr[0] + uu[1] * nr[1] + uu[2] * nr[2]);
    }
  }
  void FMF;
  return Q * S.Ur * S.Lr * S.Lr;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { ffKind, ffKindOf, ffBlocks, ffElem, ffFacePoints, ffNodeU, ffFaceNormals, ffTensionFace, ffRobinFace, ffSetup, ffResidual, ffJacVec, ffSolve, ffPrecond, ffApplyPrec, ffLubrication, ffPCG, ffFGMRES, ffAMG, ffVcycle, ffCSR, ffMatVec, ffFlow, FF_REF, FF_CORNER, FF_TET, FF_TET_SUB, FF_WEDGE_SUB };
