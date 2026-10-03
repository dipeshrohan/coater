/*
 * um-fe.js — the element library under every model's mesh (MESH-T1): the reference elements, their quadrature, the
 * tables a solver reads at the quadrature points, the rules on an element's faces, and the isoparametric geometry.
 * The 3D solvers (feed-fem.js, cfd-fem3d.js, mp-core.js) take their elements from here, so a new element (the P2–P1
 * tetrahedron) reaches each of them the same way. Pure computation, no DOM: the page, the workers and Node.
 *
 * The elements (type: dimension, nodes):
 *   line2, line3 (1D); quad4, quad9, tri3, tri6 (2D); hex8, hex27, tet4, tet10 (3D).
 * Their nodes:
 *   tensor elements (line, quad, hex): ξ, η, ζ in [−1, 1], node (a, b, g) (0 … p along each) numbered (g n1 + b) n1 + a,
 *     the first axis fastest -- the order the solvers have always used;
 *   simplices: barycentric, VTK's order. tri3: 0 (0, 0), 1 (1, 0), 2 (0, 1); tri6 adds 3 (0–1), 4 (1–2), 5 (2–0).
 *     tet4: 0 (0, 0, 0), 1 (1, 0, 0), 2 (0, 1, 0), 3 (0, 0, 1) (right-handed: face 0 1 2 seen from 3 runs
 *     counter-clockwise); tet10 adds 4 (0–1), 5 (1–2), 6 (0–2), 7 (0–3), 8 (1–3), 9 (2–3).
 * Faces (3D) and sides (2D) of each element, each with its own element type (quad9 on hex27, tri6 on tet10, …) and
 *   its nodes in that type's order, and `out`: +1 when the face's own coordinates give the outward normal (∂x/∂s × ∂x/∂t
 *   on a face, (∂y/∂s, −∂x/∂s) on a side), −1 when they give the inward one.
 *   hex (quad): 0 ξ = −1, 1 ξ = +1, 2 η = −1, 3 η = +1, 4 ζ = −1, 5 ζ = +1, s and t along the other axes in order (the
 *   order feed-mesh.js and cfd-fem3d.js have always used); tet: 0 (corners 0 1 3), 1 (1 2 3), 2 (0 3 2), 3 (0 2 1), each
 *   counter-clockwise seen from outside (out = +1); tri: sides 0 (0 1), 1 (1 2), 2 (2 0).
 *
 * Quadrature: Gauss–Legendre (n points per axis, n = 1 … 5) on the tensor elements, in the same order as their nodes
 *   ('nodes': the two ends, weights 1, the lumped rule); on triangles degree 1, 2 or 5 (Radon's 7 points); on
 *   tetrahedra degree 1, 2 or 5 (Walkington's 14 points, all weights positive, all points inside).
 */

// ---- Gauss–Legendre on [−1, 1] ----
const UFE_GAUSS = {
  1: [[0], [2]],
  2: [[-0.5773502691896257, 0.5773502691896257], [1, 1]],
  3: [[-0.7745966692414834, 0, 0.7745966692414834], [0.5555555555555556, 0.8888888888888888, 0.5555555555555556]],
  4: [[-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526],
      [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]],
  5: [[-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664],
      [0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647, 0.23692688505618908]],
  nodes: [[-1, 1], [1, 1]],
};

/** The 1D Lagrange functions of order p on [−1, 1] (equally spaced nodes) and their slopes at s. */
function ufeLag1(p, s) {
  if (p === 1) return [[(1 - s) / 2, (1 + s) / 2], [-0.5, 0.5]];
  if (p === 2) return [[s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], [s - 0.5, -2 * s, s + 0.5]];
  throw new Error('um-fe: tensor elements of order 1 or 2 only');
}

// ---- the reference elements ----
const UFE_TENSOR = { line2: [1, 1], line3: [1, 2], quad4: [2, 1], quad9: [2, 2], hex8: [3, 1], hex27: [3, 2] };
const UFE_SIMPLEX = { tri3: [2, 1], tri6: [2, 2], tet4: [3, 1], tet10: [3, 2] };
// (a simplex's edges by their corners, in VTK's order of the mid-edge nodes)
const UFE_TRI_EDGES = [[0, 1], [1, 2], [2, 0]], UFE_TET_EDGES = [[0, 1], [1, 2], [0, 2], [0, 3], [1, 3], [2, 3]];
// (a tetrahedron's faces, each outward: its corners counter-clockwise seen from outside)
const UFE_TET_FACES = [[0, 1, 3], [1, 2, 3], [0, 3, 2], [0, 2, 1]];

const UFE_CACHE = {};
/**
 * The reference element: { type, dim, npe, p, kind: 'tensor' | 'simplex', n1 (tensor: nodes per axis), xi (npe × dim, the
 * nodes' reference coordinates), corners (the local nodes that are vertices, in the linear element's order), linear
 * (its order-1 type), faces (3D) or sides (2D): [{ type, nodes, axis, sign (tensor) }], edges: [[i, j, mid]] }.
 */
function ufeElement(type) {
  if (UFE_CACHE[type]) return UFE_CACHE[type];
  let E;
  if (UFE_TENSOR[type]) {
    const [dim, p] = UFE_TENSOR[type], n1 = p + 1, npe = n1 ** dim, xi = new Float64Array(npe * dim);
    const ix = a => [a % n1, Math.floor(a / n1) % n1, Math.floor(a / (n1 * n1))];
    for (let a = 0; a < npe; a++) for (let d = 0; d < dim; d++) xi[a * dim + d] = -1 + 2 * ix(a)[d] / p;
    const L = (a, b, g) => (g * n1 + b) * n1 + a, corners = [];
    for (let g = 0; g < (dim > 2 ? 2 : 1); g++) for (let b = 0; b < (dim > 1 ? 2 : 1); b++) for (let a = 0; a < 2; a++) corners.push(L(a * p, b * p, g * p));
    const lin = { 1: 'line2', 2: 'quad4', 3: 'hex8' }[dim], sub = { 2: p === 1 ? 'line2' : 'line3', 3: p === 1 ? 'quad4' : 'quad9' }[dim];
    const faces = [];
    if (dim > 1) for (let axis = 0; axis < dim; axis++) for (const sign of [-1, 1]) {
      const others = [0, 1, 2].slice(0, dim).filter(d => d !== axis), nodes = [];
      for (let t = 0; t < (dim > 2 ? n1 : 1); t++) for (let s = 0; s < n1; s++) {
        const i = [0, 0, 0]; i[axis] = sign < 0 ? 0 : p; i[others[0]] = s; if (dim > 2) i[others[1]] = t;
        nodes.push(L(i[0], i[1], i[2]));
      }
      faces.push({ type: sub, nodes, axis, sign, others, out: axis === 1 ? -sign : sign });
    }
    E = { type, dim, npe, p, kind: 'tensor', n1, xi, corners, linear: lin, faces };
  } else if (UFE_SIMPLEX[type]) {
    const [dim, p] = UFE_SIMPLEX[type], nc = dim + 1, EDG = dim === 2 ? UFE_TRI_EDGES : UFE_TET_EDGES;
    const npe = p === 1 ? nc : nc + EDG.length, xi = new Float64Array(npe * dim);
    for (let c = 1; c < nc; c++) xi[c * dim + c - 1] = 1;
    if (p === 2) EDG.forEach(([i, j], k) => { for (let d = 0; d < dim; d++) xi[(nc + k) * dim + d] = (xi[i * dim + d] + xi[j * dim + d]) / 2; });
    const edgeMid = (i, j) => nc + EDG.findIndex(([a, b]) => (a === i && b === j) || (a === j && b === i));
    const corners = [...Array(nc).keys()], faces = [];
    if (dim === 3) for (const f of UFE_TET_FACES) faces.push({ type: p === 1 ? 'tri3' : 'tri6', nodes: p === 1 ? f.slice() : [...f, edgeMid(f[0], f[1]), edgeMid(f[1], f[2]), edgeMid(f[2], f[0])], out: 1 });
    else for (const [i, j] of UFE_TRI_EDGES) faces.push({ type: p === 1 ? 'line2' : 'line3', nodes: p === 1 ? [i, j] : [i, edgeMid(i, j), j], out: 1 });
    E = { type, dim, npe, p, kind: 'simplex', xi, corners, linear: dim === 2 ? 'tri3' : 'tet4', faces, edges: EDG.map(([i, j], k) => [i, j, p === 2 ? nc + k : -1]) };
  } else throw new Error(`um-fe: no element ${type}`);
  return (UFE_CACHE[type] = E);
}

/**
 * The shape functions at the reference point xi: { N (npe), dN (npe × dim, row-major: dN[a dim + d] = ∂N_a/∂ξ_d) }.
 * Tensor elements as the products of the 1D functions along each axis in turn (the arithmetic the solvers have
 * always done, so their tables are the same to the last bit).
 */
function ufeShape(type, xi) {
  const E = ufeElement(type), dim = E.dim, npe = E.npe, N = new Float64Array(npe), dN = new Float64Array(npe * dim);
  if (E.kind === 'tensor') {
    const n1 = E.n1, L = []; for (let d = 0; d < dim; d++) L.push(ufeLag1(E.p, xi[d]));
    for (let a = 0; a < npe; a++) {
      const ix = [a % n1, Math.floor(a / n1) % n1, Math.floor(a / (n1 * n1))];
      let v = 1; for (let d = 0; d < dim; d++) v *= L[d][0][ix[d]];
      N[a] = v;
      for (let g = 0; g < dim; g++) { let w = 1; for (let d = 0; d < dim; d++) w *= d === g ? L[d][1][ix[d]] : L[d][0][ix[d]]; dN[a * dim + g] = w; }
    }
    return { N, dN };
  }
  // simplex: barycentric λ0 = 1 − Σ ξ, λd = ξ_{d−1}; ∂λ0/∂ξ_d = −1, ∂λ_{d+1}/∂ξ_d = 1
  const nc = dim + 1, lam = [1], dl = (c, d) => (c === 0 ? -1 : c === d + 1 ? 1 : 0);
  for (let d = 0; d < dim; d++) { lam[0] -= xi[d]; lam.push(xi[d]); }
  if (E.p === 1) {
    for (let c = 0; c < nc; c++) { N[c] = lam[c]; for (let d = 0; d < dim; d++) dN[c * dim + d] = dl(c, d); }
    return { N, dN };
  }
  for (let c = 0; c < nc; c++) { N[c] = lam[c] * (2 * lam[c] - 1); for (let d = 0; d < dim; d++) dN[c * dim + d] = (4 * lam[c] - 1) * dl(c, d); }
  E.edges.forEach(([i, j, m]) => { N[m] = 4 * lam[i] * lam[j]; for (let d = 0; d < dim; d++) dN[m * dim + d] = 4 * (dl(i, d) * lam[j] + lam[i] * dl(j, d)); });
  return { N, dN };
}

// ---- quadrature ----
// (triangles: Radon's 7-point rule, degree 5, on the reference triangle of area 1/2)
const UFE_TRI5 = (() => {
  const r = Math.sqrt(15), a1 = (6 - r) / 21, a2 = (6 + r) / 21, w1 = (155 - r) / 2400, w2 = (155 + r) / 2400, P = [[1 / 3, 1 / 3]], W = [9 / 80];
  for (const [a, w] of [[a1, w1], [a2, w2]]) for (const pt of [[a, a], [1 - 2 * a, a], [a, 1 - 2 * a]]) { P.push(pt); W.push(w); }
  return [P, W];
})();
// (tetrahedra: Walkington's 14-point rule, degree 5, all weights positive, on the reference tetrahedron of volume 1/6)
const UFE_TET5 = (() => {
  const P = [], W = [];
  for (const [a, w] of [[0.0927352503108912264, 0.01224884051939365826], [0.3108859192633006098, 0.01878132095300264180]])
    for (let k = 0; k < 4; k++) { const l = [a, a, a, a]; l[k] = 1 - 3 * a; P.push(l.slice(1)); W.push(w); }
  const b = 0.0455037041256496495, w3 = 0.007091003462846911095, h = 0.5 - b;
  for (const [i, j] of [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]) { const l = [h, h, h, h]; l[i] = b; l[j] = b; P.push(l.slice(1)); W.push(w3); }
  return [P, W];
})();

/**
 * A quadrature rule on the element: { xi (nq × dim), w (nq), nq }. Tensor elements: n Gauss points per axis (1 … 5, or
 * 'nodes'), the first axis fastest. Simplices: the degree (1, 2 or 5) the rule integrates exactly.
 */
function ufeRule(type, n) {
  const key = `rule.${type}.${n}`;
  if (UFE_CACHE[key]) return UFE_CACHE[key];
  const E = ufeElement(type), dim = E.dim;
  let pts, ws;
  if (E.kind === 'tensor') {
    const G = UFE_GAUSS[n]; if (!G) throw new Error(`um-fe: no ${n}-point Gauss rule`);
    const [s, w] = G;
    const m = s.length, nq = m ** dim; pts = []; ws = [];
    for (let q = 0; q < nq; q++) {
      const iq = [q % m, Math.floor(q / m) % m, Math.floor(q / (m * m))], xi = []; let wt = 1;
      for (let d = 0; d < dim; d++) { xi.push(s[iq[d]]); wt *= w[iq[d]]; }
      pts.push(xi); ws.push(wt);
    }
  } else if (dim === 2) {
    if (n === 1) { pts = [[1 / 3, 1 / 3]]; ws = [0.5]; }
    else if (n === 2) { pts = [[1 / 6, 1 / 6], [2 / 3, 1 / 6], [1 / 6, 2 / 3]]; ws = [1 / 6, 1 / 6, 1 / 6]; }
    else if (n === 5) [pts, ws] = UFE_TRI5;
    else throw new Error(`um-fe: no triangle rule of degree ${n}`);
  } else {
    if (n === 1) { pts = [[0.25, 0.25, 0.25]]; ws = [1 / 6]; }
    else if (n === 2) { const a = (5 - Math.sqrt(5)) / 20, b = 1 - 3 * a; pts = [[a, a, a], [b, a, a], [a, b, a], [a, a, b]]; ws = [1 / 24, 1 / 24, 1 / 24, 1 / 24]; }
    else if (n === 5) [pts, ws] = UFE_TET5;
    else throw new Error(`um-fe: no tetrahedron rule of degree ${n}`);
  }
  const nq = pts.length, xi = new Float64Array(nq * dim);
  pts.forEach((p, q) => { for (let d = 0; d < dim; d++) xi[q * dim + d] = p[d]; });
  return (UFE_CACHE[key] = { xi, w: Float64Array.from(ws), nq, dim });
}

/**
 * The element's functions at each point of a rule, as objects: [{ xi, w, N, dN, Na, Nb, Ng, P }] (Na, Nb, Ng: ∂N/∂ξ,
 * ∂N/∂η, ∂N/∂ζ apart; P: the pressure element's functions (ptype, e.g. hex8 under hex27), when given).
 */
function ufePoints(type, n, ptype) {
  const key = `pts.${type}.${n}.${ptype || ''}`;
  if (UFE_CACHE[key]) return UFE_CACHE[key];
  const E = ufeElement(type), R = ufeRule(type, n), dim = E.dim, npe = E.npe, out = [];
  for (let q = 0; q < R.nq; q++) {
    const xi = Array.from(R.xi.subarray(q * dim, q * dim + dim)), S = ufeShape(type, xi), o = { xi, w: R.w[q], N: S.N, dN: S.dN };
    const parts = [new Float64Array(npe), new Float64Array(npe), new Float64Array(npe)];
    for (let a = 0; a < npe; a++) for (let d = 0; d < dim; d++) parts[d][a] = S.dN[a * dim + d];
    o.Na = parts[0]; if (dim > 1) o.Nb = parts[1]; if (dim > 2) o.Ng = parts[2];
    if (ptype) o.P = ufeShape(ptype, xi).N;
    out.push(o);
  }
  return (UFE_CACHE[key] = out);
}

/**
 * The same as flat tables, point by point: { nq, npe, np, N, Na, Nb, Ng (nq × npe), P (nq × np), W (nq) } -- the layout a
 * solver reads in its inner loops.
 */
function ufeTable(type, n, ptype) {
  const key = `tab.${type}.${n}.${ptype || ''}`;
  if (UFE_CACHE[key]) return UFE_CACHE[key];
  const E = ufeElement(type), pts = ufePoints(type, n, ptype), nq = pts.length, npe = E.npe, np = ptype ? ufeElement(ptype).npe : 0;
  const T = { nq, npe, np, N: new Float64Array(nq * npe), Na: new Float64Array(nq * npe), Nb: new Float64Array(nq * npe), Ng: new Float64Array(nq * npe), P: new Float64Array(nq * np), W: new Float64Array(nq) };
  pts.forEach((o, q) => {
    T.N.set(o.N, q * npe); T.Na.set(o.Na, q * npe); if (o.Nb) T.Nb.set(o.Nb, q * npe); if (o.Ng) T.Ng.set(o.Ng, q * npe);
    if (np) T.P.set(o.P, q * np); T.W[q] = o.w;
  });
  return (UFE_CACHE[key] = T);
}

/**
 * A rule on one face of a 3D element: [{ w, N2, Ns, Nt (the face's own functions and their slopes along s and t, in
 * its nodes' order), el: { N, Na, Nb, Ng, P } (the element's functions there) }]. n: the face rule (Gauss points per
 * axis on a quadrilateral, the degree on a triangle).
 */
function ufeFaceRule(type, f, n, ptype) {
  const key = `face.${type}.${f}.${n}.${ptype || ''}`;
  if (UFE_CACHE[key]) return UFE_CACHE[key];
  const E = ufeElement(type), F = E.faces[f], R = ufeRule(F.type, n), out = [];
  if (E.dim !== 3) throw new Error('um-fe: face rules on 3D elements');
  const FE = ufeElement(F.type);
  for (let q = 0; q < R.nq; q++) {
    const st = [R.xi[2 * q], R.xi[2 * q + 1]], S = ufeShape(F.type, st), m = FE.npe;
    const N2 = S.N, Ns = new Float64Array(m), Nt = new Float64Array(m);
    for (let a = 0; a < m; a++) { Ns[a] = S.dN[2 * a]; Nt[a] = S.dN[2 * a + 1]; }
    // (the point in the element's coordinates: on a tensor face, the fixed axis and the others in order; on a
    //  tetrahedron's face, the corners' coordinates weighted by the face's own barycentric coordinates)
    let xi;
    if (E.kind === 'tensor') { xi = [0, 0, 0]; xi[F.axis] = F.sign; xi[F.others[0]] = st[0]; xi[F.others[1]] = st[1]; }
    else { const c = F.nodes.slice(0, 3), l = [1 - st[0] - st[1], st[0], st[1]]; xi = [0, 1, 2].map(d => l[0] * E.xi[c[0] * 3 + d] + l[1] * E.xi[c[1] * 3 + d] + l[2] * E.xi[c[2] * 3 + d]); }
    const el = ufeShape(type, xi), o = { N: el.N, Na: new Float64Array(E.npe), Nb: new Float64Array(E.npe), Ng: new Float64Array(E.npe) };
    for (let a = 0; a < E.npe; a++) { o.Na[a] = el.dN[3 * a]; o.Nb[a] = el.dN[3 * a + 1]; o.Ng[a] = el.dN[3 * a + 2]; }
    if (ptype) o.P = ufeShape(ptype, xi).N;
    out.push({ w: R.w[q], N2, Ns, Nt, xi, el: o });
  }
  return (UFE_CACHE[key] = out);
}

// ---- geometry ----

/**
 * The isoparametric geometry of a fixed 3D mesh at a table's points: geo (nE × nq × 10): per point the inverse
 * Jacobian stored g[3 r + c] = (J⁻¹)[c][r], so ∂N/∂x = Na g0 + Nb g3 + Ng g6, ∂N/∂y = Na g1 + Nb g4 + Ng g7,
 * ∂N/∂z = Na g2 + Nb g5 + Ng g8, and g9 = det J × weight. X, Y, Z: the nodes' coordinates (already scaled); conn: each
 * element's nodes (npe each). Throws on an element inverted at a point. Returns { geo, minDet }.
 */
function ufeGeometry(T, X, Y, Z, conn, nE) {
  const nq = T.nq, npe = T.npe, geo = new Float64Array(nE * nq * 10);
  let minDet = Infinity;
  for (let e = 0; e < nE; e++) {
    const el = conn.subarray(npe * e, npe * e + npe);
    for (let q = 0; q < nq; q++) {
      let j00 = 0, j01 = 0, j02 = 0, j10 = 0, j11 = 0, j12 = 0, j20 = 0, j21 = 0, j22 = 0;
      for (let a = 0; a < npe; a++) {
        const n = el[a], na = T.Na[q * npe + a], nb = T.Nb[q * npe + a], ng = T.Ng[q * npe + a];
        j00 += na * X[n]; j01 += na * Y[n]; j02 += na * Z[n]; j10 += nb * X[n]; j11 += nb * Y[n]; j12 += nb * Z[n]; j20 += ng * X[n]; j21 += ng * Y[n]; j22 += ng * Z[n];
      }
      const det = j00 * (j11 * j22 - j12 * j21) - j01 * (j10 * j22 - j12 * j20) + j02 * (j10 * j21 - j11 * j20);
      if (!(det > 0)) throw new Error(`element ${e} is inverted at a quadrature point (det ${det})`);
      minDet = Math.min(minDet, det);
      const g = geo.subarray((e * nq + q) * 10, (e * nq + q) * 10 + 10), id = 1 / det;
      const i00 = (j11 * j22 - j12 * j21) * id, i01 = (j02 * j21 - j01 * j22) * id, i02 = (j01 * j12 - j02 * j11) * id;
      const i10 = (j12 * j20 - j10 * j22) * id, i11 = (j00 * j22 - j02 * j20) * id, i12 = (j02 * j10 - j00 * j12) * id;
      const i20 = (j10 * j21 - j11 * j20) * id, i21 = (j01 * j20 - j00 * j21) * id, i22 = (j00 * j11 - j01 * j10) * id;
      g[0] = i00; g[1] = i10; g[2] = i20; g[3] = i01; g[4] = i11; g[5] = i21; g[6] = i02; g[7] = i12; g[8] = i22;
      g[9] = det * T.W[q];
    }
  }
  return { geo, minDet };
}

/**
 * The Jacobian of element e at a rule point q ({ N, dN }) on a mesh { dim, npe, conn, X (N × dim, interleaved) } of any
 * dimension: fills dNdx (npe × dim) and returns { det, x }. Throws on an inverted or flat element.
 */
function ufeJac(M, e, q, dNdx) {
  const dim = M.dim, npe = M.npe, J = [0, 0, 0, 0, 0, 0, 0, 0, 0], x = [0, 0, 0];
  for (let a = 0; a < npe; a++) {
    const n = M.conn[e * npe + a];
    for (let i = 0; i < dim; i++) {
      const xi = M.X[n * dim + i];
      x[i] += q.N[a] * xi;
      for (let j = 0; j < dim; j++) J[i * 3 + j] += xi * q.dN[a * dim + j];   // ∂x_i/∂ξ_j
    }
  }
  let det, inv;
  if (dim === 1) { det = J[0]; inv = [1 / det]; }
  else if (dim === 2) {
    det = J[0] * J[4] - J[1] * J[3];
    inv = [J[4] / det, -J[1] / det, -J[3] / det, J[0] / det];   // ∂ξ_i/∂x_j, row-major 2×2
  } else {
    const a = J[0], b = J[1], c = J[2], d = J[3], f = J[4], g = J[5], h = J[6], k = J[7], l = J[8];
    det = a * (f * l - g * k) - b * (d * l - g * h) + c * (d * k - f * h);
    inv = [(f * l - g * k) / det, (c * k - b * l) / det, (b * g - c * f) / det,
           (g * h - d * l) / det, (a * l - c * h) / det, (c * d - a * g) / det,
           (d * k - f * h) / det, (b * h - a * k) / det, (a * f - b * d) / det];
  }
  if (!(det > 0)) throw new Error(`element ${e} is inverted or flat`);
  for (let a = 0; a < npe; a++) for (let j = 0; j < dim; j++) {
    let s = 0; for (let i = 0; i < dim; i++) s += q.dN[a * dim + i] * inv[i * dim + j];
    dNdx[a * dim + j] = s;
  }
  return { det, x: x.slice(0, dim) };
}

// ---- the finite-element mesh every 3D model hands over ----

/**
 * A finite-element mesh in the common form: { type, nN, nE, X, Y, Z, conn (nE × npe), faces: [{ e, f, tag }] }. From
 * feed-mesh.js's mesh (hex27, elems), from mp-core.js's block (2D quads or 3D hexahedra of order 1 or 2, X interleaved,
 * its six block faces tagged x0 … z1), or one already in this form.
 */
function ufeMesh(M) {
  if (M.type && M.conn) return M;
  if (M.elems && M.nE != null) return { type: 'hex27', nN: M.nN, nE: M.nE, X: M.X, Y: M.Y, Z: M.Z, conn: M.elems, faces: M.faces || [] };
  if (M.npe && M.conn && M.dim === 3) {
    const type = M.p === 2 ? 'hex27' : 'hex8', X = new Float64Array(M.N), Y = new Float64Array(M.N), Z = new Float64Array(M.N), faces = [];
    for (let n = 0; n < M.N; n++) { X[n] = M.X[3 * n]; Y[n] = M.X[3 * n + 1]; Z[n] = M.X[3 * n + 2]; }
    for (let e = 0; e < M.E; e++) for (let d = 0; d < 3; d++) {
      const i = M.eijk[e * 3 + d];
      if (i === 0) faces.push({ e, f: 2 * d, tag: 'xyz'[d] + '0' });
      if (i === M.ne[d] - 1) faces.push({ e, f: 2 * d + 1, tag: 'xyz'[d] + '1' });
    }
    return { type, nN: M.N, nE: M.E, X, Y, Z, conn: M.conn, faces, mat: M.mat };
  }
  throw new Error('um-fe: not a mesh this library reads');
}

if (typeof module !== 'undefined') {
  module.exports = { UFE_GAUSS, UFE_TET_FACES, UFE_TET_EDGES, ufeLag1, ufeElement, ufeShape, ufeRule, ufePoints, ufeTable, ufeFaceRule, ufeGeometry, ufeJac, ufeMesh };
}
