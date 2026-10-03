/*
 * feed-pool-tet.js — the pool's flow on tetrahedra (MESH-T3): the paste behind the blade, with or without the outlets'
 * pipes standing in it, meshed by the tetrahedral mesher (um-tetgeom.js's solid, um-tetmesh.js's tetrahedra, made
 * quadratic with the curved walls' nodes on their true surfaces) and solved by feed-fem.js on P2–P1 elements: the same
 * paste, web, blade, side plates, back edge, pool edge and top as feed-pool.js's on the block mesh (fplSolve with the top
 * a lid, fplSolvePipes), so the two meshes solve one problem.
 *
 * fptMesh(o): the mesh. o: { W, half, xBack, xEnd, h, blade, outlets, pipe, mesh: { size (m, or (x, y, z) -> m), tol (the
 *   curved walls' chord tolerance, m), across (elements across the gap under the blade and a pipe's bore), grow } }.
 *   Returns { M (tet10: X, Y, Z, conn, faces { e, f, tag }), G (um-tetgeom.js's solid: its exact volume), nT, minDih
 *   (degrees: the linear tetrahedra's smallest dihedral angle), Wend, pipes (the outlets meshed as pipes) }.
 * fptSolve(o): the flow. o: as fplSolvePipes's (W, half, xBack, xEnd, h, blade, U, mu, gdMin, rho, g, outlets, Qin, Qout,
 *   pulse, pipe: { d, Do, tip, bore }) -- or, without pipe, as fplSolve's with the top a lid: the streams falling onto it
 *   during a pulse (r, their landing's radius; line), sides ('wall' or 'slip', or [at z = 0, at z = W]) -- and mesh
 *   (fptMesh's options) or Mt (a mesh fptMesh made: solves on one mesh share it), solve (ffSolve's options; x0 a start).
 *   The top is a lid at the level, the paste through it at its rate ḣ n_y (ḣ from the balance over its part off the
 *   walls); a free top on tetrahedra is MESH-T4.
 *   Returns { M, Mt, S, x, u, v, w, p (at every node: the P1 pressure, linear along each edge), hdot, free (m²), flows:
 *   { top, end, back, web, blade, side0, side1, pipe, bore } (m³/s, out), hist, converged }.
 * fptAreas(M, tags): each node's ∫ N dA over the faces with those tags (Map node -> m²): its share of the area, as the
 *   discrete flow through them weighs it (a P2 triangle's corners: none).
 * fptIndex(M), fptField(X, F, p): a point's element (Newton on the curved element's map) and nodal fields there ({ v, e,
 *   xi }, or null outside the mesh).
 * Pure computation.
 */
const FPT_ = (n, f) => (typeof globalThis[n] === 'function' ? globalThis[n] : require(f)[n]);

/** The pool's solid, tetrahedra, quadratic (see the header). */
function fptMesh(o) {
  const umgPool = FPT_('umgPool', './um-tetgeom.js'), umtSurface = FPT_('umtSurface', './um-tetmesh.js'), umtVolume = FPT_('umtVolume', './um-tetmesh.js');
  const umtQuadratic = FPT_('umtQuadratic', './um-tetmesh.js'), m = o.mesh || {}, Pp = o.pipe;
  const Wend = o.half ? o.W / 2 : o.W, pipes = Pp ? o.outlets.filter(q => q.z < Wend) : [];
  if (Pp && !(Pp.tip > 0 && Pp.tip < o.h)) throw new Error('the pipes\' tips must be in the paste, above the web');
  const G = umgPool({ z0: 0, z1: Wend, xCut: -o.xBack, xEnd: -o.xEnd, bladeY: o.blade, H0: o.h,
    outlets: pipes.map(q => ({ x: q.x, z: q.z, ym: Pp.tip, yIn: Pp.tip + (Pp.bore ?? 2 * Pp.d) })), ...(Pp ? { d: Pp.d, Do: Pp.Do } : {}),
    size: m.size ?? 4e-3, tol: m.tol ?? 0.1e-3, across: m.across ?? 2, grow: m.grow });
  const S = umtSurface(G.G, { size: G.size }), V = umtVolume(S, { size: G.size }), M = umtQuadratic(V, { project: G.project });
  return { M, G, nT: M.nE, minDih: V.stats.dihedralMin, Wend, pipes };
}

/** Each node's ∫ N dA over the faces with those tags (see the header). */
function fptAreas(M, tags) {
  const UFE = typeof ufeFaceRule === 'function' ? { ufeElement, ufeFaceRule } : require('./um-fe.js');
  const FN = UFE.ufeElement('tet10').faces.map(f => f.nodes), out = new Map();
  for (const F of M.faces) {
    if (!tags.includes(F.tag)) continue;
    const el = M.conn.subarray(10 * F.e, 10 * F.e + 10), fn = FN[F.f];
    for (const q of UFE.ufeFaceRule('tet10', F.f, 5)) {
      const t1 = [0, 0, 0], t2 = [0, 0, 0];
      for (let a = 0; a < 6; a++) { const n = el[fn[a]]; t1[0] += q.Ns[a] * M.X[n]; t1[1] += q.Ns[a] * M.Y[n]; t1[2] += q.Ns[a] * M.Z[n]; t2[0] += q.Nt[a] * M.X[n]; t2[1] += q.Nt[a] * M.Y[n]; t2[2] += q.Nt[a] * M.Z[n]; }
      const dA = Math.hypot(t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]) * q.w;
      for (let a = 0; a < 6; a++) { const n = el[fn[a]]; out.set(n, (out.get(n) || 0) + q.N2[a] * dA); }
    }
  }
  return out;
}

/** The P1 pressure (on the corners; NaN elsewhere) at every node of a P2 mesh: each edge's middle the mean of its ends. */
function fptPressureAll(M, p) {
  const out = Float64Array.from(p), E = [[0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9]];
  for (let e = 0; e < M.nE; e++) for (const [a, b, c] of E) { const n = M.conn[10 * e + c]; if (!Number.isFinite(out[n])) out[n] = (p[M.conn[10 * e + a]] + p[M.conn[10 * e + b]]) / 2; }
  return out;
}

/** The pool's flow on tetrahedra (see the header). */
function fptSolve(o) {
  const ffSetup = FPT_('ffSetup', './feed-fem.js'), ffSolve = FPT_('ffSolve', './feed-fem.js'), ffFlow = FPT_('ffFlow', './feed-fem.js');
  const ffFaceNormals = FPT_('ffFaceNormals', './feed-fem.js'), fplStreams = FPT_('fplStreams', './feed-pool.js');
  const Mt = o.Mt || fptMesh(o), M = Mt.M, rg = o.rho * o.g, Pp = o.pipe;
  // (each side: 'wall' a side plate, 'slip' a mirror; half the pool: its middle a mirror)
  const sideT = o.half ? ['wall', 'slip'] : Array.isArray(o.sides) ? o.sides : [o.sides || 'wall', o.sides || 'wall'];
  const wallTags = new Set(['blade', 'pipe-wall', ...(sideT[0] === 'wall' ? ['side0'] : []), ...(sideT[1] === 'wall' ? ['side1'] : [])]);
  // the top's free nodes (off the walls), their normals, their shares of its plan
  const FN = FPT_('ufeElement', './um-fe.js')('tet10').faces.map(f => f.nodes);
  const onWall = new Set(); for (const f of M.faces) if (wallTags.has(f.tag)) for (const k of FN[f.f]) onWall.add(M.conn[10 * f.e + k]);
  const nrm = new Map(); for (const f of M.faces) if (f.tag === 'pile') ffFaceNormals(M, M.X, M.Y, M.Z, f, (n, v) => { const a = nrm.get(n) || [0, 0, 0]; for (let c = 0; c < 3; c++) a[c] += v[c]; nrm.set(n, a); });
  for (const [n, a] of nrm) { const l = Math.hypot(...a); nrm.set(n, a.map(v => v / l)); }
  const top = [...fptAreas(M, ['pile'])].filter(([n]) => !onWall.has(n)).map(([n, a]) => [n, a * nrm.get(n)[1]]);
  const free = top.reduce((s, [, a]) => s + a, 0), qIn = o.pulse ? o.Qin : 0, hdot = (qIn - o.Qout) / free;
  // (the paste in: through the pipes' bores, a plug at their tops inside their rims -- the bore's wall holds its rim, so
  //  no paste crosses the wall where the curved wall's elements meet the plug -- over the discrete area of the nodes it
  //  moves, so the flow in is exact; or the streams landing on the top)
  const rim = new Set(); if (Pp) for (const f of M.faces) if (f.tag === 'bore') for (const k of FN[f.f]) rim.add(M.conn[10 * f.e + k]);
  const inA = Pp ? [...fptAreas(M, ['bore-inlet'])].reduce((s, [n, a]) => s + (rim.has(n) ? 0 : a), 0) : 0, V = Pp ? qIn / inA : 0;
  const stream = o.pulse && !Pp && o.outlets.length ? fplStreams(top, M, o.outlets, o.r, qIn / o.outlets.length, o.line) : () => 0;
  const byPos = new Map(); for (const [n, v] of nrm) byPos.set(`${M.X[n]},${M.Y[n]},${M.Z[n]}`, v[1]);
  const wall = { type: 'velocity', u: [0, 0, 0] }, side = s => (s === 'slip' ? { type: 'slip', normal: 'z' } : wall);
  const bc = { web: { type: 'velocity', u: [o.U, 0, 0] }, blade: wall, side0: side(sideT[0]), side1: side(sideT[1]),
    inlet: { type: 'slip', normal: 'x', over: true }, outlet: { type: 'traction', t: (x, y) => [-rg * (o.h - y), 0, 0] },
    pile: { type: 'slip', normal: 'surface', un: (x, y, z) => (hdot - stream(x, y, z)) * (byPos.get(`${x},${y},${z}`) ?? 1) },
    ...(Pp ? { 'bore-inlet': { type: 'velocity', u: [0, -V, 0] }, 'pipe-wall': wall, 'pipe-end': wall, bore: wall } : {}) };   // (the walls after the plug: the rim theirs)
  const S = ffSetup({ mesh: M, mu: o.mu, gdMin: o.gdMin, rho: o.rho, g: o.g, Lr: 1e-3, Ur: o.U || 1e-3, bc });
  const R = ffSolve(S, { tol: 1e-8, ...(o.solve || {}) });
  const fl = t => (M.faces.some(f => f.tag === t) ? ffFlow(S, R.x, t) : 0);
  const flows = { top: fl('pile'), end: fl('outlet'), back: fl('inlet'), web: fl('web'), blade: fl('blade'), side0: fl('side0'), side1: fl('side1'),
    pipe: fl('pipe-wall') + fl('pipe-end') + fl('bore'), bore: fl('bore-inlet') };
  return { M, Mt, S, x: R.x, u: R.u, v: R.v, w: R.w, p: fptPressureAll(M, R.p), hdot, free, flows, hist: R.hist, converged: R.converged, V, stream };
}

/** Index a tetrahedral mesh for finding points: each element's box in a grid of bins. */
function fptIndex(M) {
  const nE = M.nE, npe = 10, box = new Float64Array(6 * nE), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let e = 0; e < nE; e++) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < npe; k++) { const n = M.conn[npe * e + k], P = [M.X[n], M.Y[n], M.Z[n]]; for (let c = 0; c < 3; c++) { b[c] = Math.min(b[c], P[c]); b[3 + c] = Math.max(b[3 + c], P[c]); } }
    box.set(b, 6 * e); for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], b[c]); hi[c] = Math.max(hi[c], b[3 + c]); }
  }
  const nb = Math.max(4, Math.round(Math.cbrt(nE / 2))), span = [0, 1, 2].map(c => hi[c] - lo[c]), N = [0, 1, 2].map(c => Math.max(2, Math.round(nb * span[c] / Math.max(...span) * 2)));
  const key = (i, j, k) => (i * N[1] + j) * N[2] + k, cell = (v, d) => Math.max(0, Math.min(N[d] - 1, Math.floor((v - lo[d]) / span[d] * N[d])));
  const bins = new Map();
  for (let e = 0; e < nE; e++) {
    const b = box.subarray(6 * e, 6 * e + 6);
    for (let i = cell(b[0], 0); i <= cell(b[3], 0); i++) for (let j = cell(b[1], 1); j <= cell(b[4], 1); j++) for (let k = cell(b[2], 2); k <= cell(b[5], 2); k++) {
      const kk = key(i, j, k); if (!bins.has(kk)) bins.set(kk, []); bins.get(kk).push(e);
    }
  }
  return { M, box, bins, key, cell };
}
/** p's reference coordinates in element e: from the straight element's, then Newton on the curved map. */
function fptLocal(M, e, p) {
  const ufeShape = FPT_('ufeShape', './um-fe.js'), el = M.conn.subarray(10 * e, 10 * e + 10), P = k => [M.X[el[k]], M.Y[el[k]], M.Z[el[k]]];
  const solve3 = (J, r) => {   // (J[c][d] = ∂x_c/∂ξ_d: J⁻¹ r by Cramer)
    const det = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
    if (!det) return null;
    return [0, 1, 2].map(d => { const A = J.map((row, c) => row.map((v, k) => (k === d ? r[c] : v))); return (A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0])) / det; });
  };
  const p0 = P(0), Jl = [0, 1, 2].map(c => [1, 2, 3].map(k => P(k)[c] - p0[c]));
  let xi = solve3(Jl, [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]]); if (!xi) return null;
  for (let it = 0; it < 20; it++) {
    const S = ufeShape('tet10', xi), x = [0, 0, 0], J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let a = 0; a < 10; a++) { const Q = P(a); for (let c = 0; c < 3; c++) { x[c] += S.N[a] * Q[c]; for (let d = 0; d < 3; d++) J[c][d] += S.dN[3 * a + d] * Q[c]; } }
    const dxi = solve3(J, [p[0] - x[0], p[1] - x[1], p[2] - x[2]]); if (!dxi) return null;
    xi = xi.map((v, d) => v + dxi[d]);
    if (Math.abs(dxi[0]) + Math.abs(dxi[1]) + Math.abs(dxi[2]) < 1e-12) break;
    if (Math.max(...xi.map(Math.abs)) > 3) return null;
  }
  return xi;
}
/** Nodal fields F (an array per component) at p: { v, e, xi }, or null outside the mesh. */
function fptField(X, F, p) {
  const ufeShape = FPT_('ufeShape', './um-fe.js'), M = X.M, inBox = e => { const b = X.box.subarray(6 * e, 6 * e + 6), t = 1e-9; return !(p[0] < b[0] - t || p[0] > b[3] + t || p[1] < b[1] - t || p[1] > b[4] + t || p[2] < b[2] - t || p[2] > b[5] + t); };
  for (const e of X.bins.get(X.key(X.cell(p[0], 0), X.cell(p[1], 1), X.cell(p[2], 2))) || []) {
    if (!inBox(e)) continue;
    const xi = fptLocal(M, e, p); if (!xi || Math.min(xi[0], xi[1], xi[2], 1 - xi[0] - xi[1] - xi[2]) < -1e-7) continue;
    const N = ufeShape('tet10', xi).N, v = F.map(f => { let s = 0; for (let a = 0; a < 10; a++) s += N[a] * f[M.conn[10 * e + a]]; return s; });
    return { v, e, xi };
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fptMesh, fptAreas, fptPressureAll, fptSolve, fptIndex, fptLocal, fptField };
