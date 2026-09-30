/*
 * mp-core.js — the multiphysics core (MP-0): one finite-element method for every stage's solids and films, in 1D, 2D
 * and 3D alike, so the stages share their equations, their materials and their coupling. Pure computation, no DOM:
 * the page, the workers and Node.
 *
 *  - Mesh: a structured block of tensor-product Lagrange elements of order p = 1 or 2 (lines, quadrilaterals,
 *    hexahedra), each axis made of segments (a layer: its length, its elements, graded toward either end), so the
 *    boundaries between materials (the film on its web, the pieces in a stack) are element faces. An optional map
 *    bends the block (isoparametric: the Jacobian from the nodes). Nodes are numbered with the axis that has the
 *    fewest nodes running fastest, so the band of the matrices is as narrow as the block allows.
 *  - Scalar transport (mpScalar):  C ∂u/∂t + c v·∇u = ∇·(K ∇u) + Q,  K diagonal (anisotropic: a film conducts far
 *    better along itself than through). Heat: u = T, C = ρ c_p, K = k. Water: u = X or the vapour's pressure, C the
 *    store, K the permeability. Porous flow (Darcy): u = p, K = κ / μ. On the faces: a value, a flux, a transfer
 *    coefficient (h (u − u∞)) and radiation (ε σ (T⁴ − T∞⁴), made linear about the last iterate). Advection by
 *    streamline-upwind Petrov–Galerkin. Implicit in time (θ-method), Picard iterations when C, K, Q or the faces
 *    depend on u.
 *  - Solids (mpElastic): small strain, a 3D stiffness (isotropic or transversely isotropic about any axis) with an
 *    eigenstrain (thermal α ΔT, hygral β ΔX, or any other); 3D; 2D plane strain or plane stress (σzz condensed out);
 *    faces fixed (any components, any values), a traction, a pressure; body force. Returns the displacements, the
 *    strain and stress at the nodes (averaged from the elements around each) and at the Gauss points.
 *  - Films through their thickness (mpLaminate, 1D): the classical laminate on a 1D mesh of the thickness, the
 *    in-plane strain ε0 + κ z against the eigenstrain ε*(z); free (it curls), held flat, or held at a strain. The same
 *    physics a 2D section and a 3D plate give far from their edges (mp-core.validate.js checks that they agree).
 *  - The linear systems are symmetric positive definite: a banded Cholesky (factored once while the matrix stays).
 *
 * SI throughout (m, s, K or °C, Pa, kg). Coordinates x, y, z; Voigt order xx, yy, zz, yz, xz, xy (engineering shear).
 */

const MP_SIGMA = 5.670374419e-8;   // Stefan–Boltzmann, W/(m² K⁴)

// ---- Gauss–Legendre on [-1, 1] ----
const MP_GAUSS = {
  1: [[0], [2]],
  2: [[-0.5773502691896257, 0.5773502691896257], [1, 1]],
  3: [[-0.7745966692414834, 0, 0.7745966692414834], [0.5555555555555556, 0.8888888888888888, 0.5555555555555556]],
  4: [[-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526],
      [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]],
};

/** The 1D Lagrange shape functions of order p on [-1, 1] (nodes equally spaced) and their slopes at s. */
function mpLag1(p, s) {
  if (p === 1) return [[(1 - s) / 2, (1 + s) / 2], [-0.5, 0.5]];
  if (p === 2) return [[s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], [s - 0.5, -2 * s, s + 0.5]];
  throw new Error('mp-core: elements of order 1 or 2 only');
}

/**
 * The element's shape functions (tensor products, the local x index fastest) at the local point xi (dim numbers).
 * Returns { N (npe), dN (npe × dim, row-major) }.
 */
function mpShape(p, dim, xi) {
  const n1 = p + 1, npe = Math.pow(n1, dim), N = new Float64Array(npe), dN = new Float64Array(npe * dim);
  const L = []; for (let d = 0; d < dim; d++) L.push(mpLag1(p, xi[d]));
  for (let a = 0; a < npe; a++) {
    const ix = [a % n1, Math.floor(a / n1) % n1, Math.floor(a / (n1 * n1))];
    let v = 1; for (let d = 0; d < dim; d++) v *= L[d][0][ix[d]];
    N[a] = v;
    for (let g = 0; g < dim; g++) {
      let w = 1; for (let d = 0; d < dim; d++) w *= d === g ? L[d][1][ix[d]] : L[d][0][ix[d]];
      dN[a * dim + g] = w;
    }
  }
  return { N, dN };
}

/** The element's Gauss points (nq per axis): [{ xi, w, N, dN }]. Cached per (p, dim, nq). nq 'nodes': at the linear
 *  element's nodes (Gauss–Lobatto, weights 1: its stiffness on a rectangle is the 5- or 7-point stencil, which never
 *  overshoots -- however long and thin the element). */
const MP_RULES = {};
function mpRule(p, dim, nq) {
  const key = `${p}.${dim}.${nq}`;
  if (MP_RULES[key]) return MP_RULES[key];
  const [s, w] = nq === 'nodes' ? [[-1, 1], [1, 1]] : MP_GAUSS[nq], out = [], m = Math.pow(s.length, dim);
  nq = s.length;
  for (let q = 0; q < m; q++) {
    const iq = [q % nq, Math.floor(q / nq) % nq, Math.floor(q / (nq * nq))], xi = [], wt = [1];
    for (let d = 0; d < dim; d++) { xi.push(s[iq[d]]); wt[0] *= w[iq[d]]; }
    out.push({ xi, w: wt[0], ...mpShape(p, dim, xi) });
  }
  return (MP_RULES[key] = out);
}

// ---- the mesh ----

/**
 * One axis's element edges from its segments [{ L, n, grade, end }] (grade: the element at `end` ('hi', the
 * default, or 'lo'; 'both' clusters at both ends) that many times smaller than the one at the other end; 1: even),
 * starting at x0. Returns { edges, seg } (seg: each element's segment).
 */
function mpAxisEdges(segs, x0 = 0) {
  const edges = [x0], seg = [];
  segs.forEach((S, k) => {
    const n = S.n, r = S.grade > 1 ? S.grade : 1;
    let w;
    if (r === 1 || n === 1) w = Array(n).fill(1);
    else if (S.end === 'both') {
      const h = Math.ceil(n / 2), q = Math.pow(r, 1 / Math.max(1, h - 1)), half = [];
      for (let i = 0; i < h; i++) half.push(Math.pow(q, i));
      w = []; for (let i = 0; i < n; i++) w.push(half[Math.min(i, n - 1 - i)]);
    } else {
      const q = Math.pow(1 / r, 1 / (n - 1));
      w = []; for (let i = 0; i < n; i++) w.push(Math.pow(q, i));
      if (S.end === 'lo') w.reverse();
    }
    const sum = w.reduce((a, b) => a + b, 0), a0 = edges[edges.length - 1];
    let x = a0;
    for (let i = 0; i < n; i++) { x += S.L * w[i] / sum; edges.push(i === n - 1 ? a0 + S.L : x); seg.push(k); }
  });
  return { edges, seg };
}

/**
 * A structured block mesh. o: { dim (1..3), p (1 or 2), axes: [segments for x, for y, for z] (each an array of
 * { L, n, grade, end }, or { L, n } alone), x0 ([x, y, z] of the corner), mat (ijk, seg, xc) → a material index
 * (seg: the segment of each axis the element sits in; default 0), map (x) → x (bends the block) }.
 * Returns { dim, p, n1, npe, ne [elements per axis], nn [nodes per axis], N, X (N × dim), E, conn (E × npe),
 * eijk (E × dim), mat (E), node(ix) → index, coord [each axis's node coordinates], edges [each axis's] }.
 */
function mpMesh(o) {
  const dim = o.dim, p = o.p || 1, n1 = p + 1, npe = Math.pow(n1, dim);
  const ax = [], ne = [], nn = [], edges = [], segOf = [];
  for (let d = 0; d < dim; d++) {
    const segs = Array.isArray(o.axes[d]) ? o.axes[d] : [o.axes[d]];
    const A = mpAxisEdges(segs, (o.x0 || [0, 0, 0])[d]);
    const c = [];
    for (let e = 0; e < A.edges.length - 1; e++) for (let k = 0; k < p; k++) c.push(A.edges[e] + (A.edges[e + 1] - A.edges[e]) * k / p);
    c.push(A.edges[A.edges.length - 1]);
    ax.push(c); ne.push(A.edges.length - 1); nn.push(c.length); edges.push(A.edges); segOf.push(A.seg);
  }
  // the axis with the fewest nodes runs fastest (the narrowest band)
  const order = [...Array(dim).keys()].sort((a, b) => nn[a] - nn[b]), stride = Array(dim).fill(0);
  let s = 1; for (const d of order) { stride[d] = s; s *= nn[d]; }
  const N = s, node = ix => { let k = 0; for (let d = 0; d < dim; d++) k += ix[d] * stride[d]; return k; };
  const X = new Float64Array(N * dim), ix = [0, 0, 0];
  for (let k = 0; k < N; k++) {
    for (let d = 0; d < dim; d++) ix[d] = Math.floor(k / stride[d]) % nn[d];
    let x = []; for (let d = 0; d < dim; d++) x.push(ax[d][ix[d]]);
    if (o.map) x = o.map(x);
    for (let d = 0; d < dim; d++) X[k * dim + d] = x[d];
  }
  let E = 1; for (let d = 0; d < dim; d++) E *= ne[d];
  const conn = new Int32Array(E * npe), eijk = new Int32Array(E * dim), mat = new Int32Array(E);
  for (let e = 0; e < E; e++) {
    const ei = [e % ne[0], dim > 1 ? Math.floor(e / ne[0]) % ne[1] : 0, dim > 2 ? Math.floor(e / (ne[0] * ne[1])) : 0];
    for (let d = 0; d < dim; d++) eijk[e * dim + d] = ei[d];
    for (let a = 0; a < npe; a++) {
      const la = [a % n1, Math.floor(a / n1) % n1, Math.floor(a / (n1 * n1))], g = [];
      for (let d = 0; d < dim; d++) g.push(ei[d] * p + la[d]);
      conn[e * npe + a] = node(g);
    }
    if (o.mat) {
      const xc = [], seg = [];
      for (let d = 0; d < dim; d++) { xc.push((edges[d][ei[d]] + edges[d][ei[d] + 1]) / 2); seg.push(segOf[d][ei[d]]); }
      mat[e] = o.mat(ei.slice(0, dim), seg, xc) | 0;
    }
  }
  return { dim, p, n1, npe, ne, nn, N, X, E, conn, eijk, mat, node, coord: ax, edges, stride };
}

/** The nodes on a face of the block: 'x0', 'x1', 'y0', 'y1', 'z0', 'z1'. */
function mpFaceNodes(M, face) {
  const d = 'xyz'.indexOf(face[0]), hi = face[1] === '1', out = [];
  for (let k = 0; k < M.N; k++) if ((Math.floor(k / M.stride[d]) % M.nn[d]) === (hi ? M.nn[d] - 1 : 0)) out.push(k);
  return out;
}

/** The elements on a face of the block, with the face's axis and side. */
function mpFaceElems(M, face) {
  const d = 'xyz'.indexOf(face[0]), hi = face[1] === '1', out = [];
  if (d < 0 || d >= M.dim) throw new Error(`mp-core: no face ${face} in ${M.dim}D`);
  for (let e = 0; e < M.E; e++) if (M.eijk[e * M.dim + d] === (hi ? M.ne[d] - 1 : 0)) out.push(e);
  return { elems: out, axis: d, side: hi ? 1 : -1 };
}

/** The element's Jacobian at a rule point: fills dNdx (npe × dim), returns det J and the point's x. */
function mpJac(M, e, q, dNdx) {
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
  if (!(det > 0)) throw new Error(`mp-core: element ${e} is inverted or flat`);
  for (let a = 0; a < npe; a++) for (let j = 0; j < dim; j++) {
    let s = 0; for (let i = 0; i < dim; i++) s += q.dN[a * dim + i] * inv[i * dim + j];
    dNdx[a * dim + j] = s;
  }
  return { det, x: x.slice(0, dim) };
}

/**
 * The Gauss points on one face of an element (the element's own shape functions there): [{ N, w (the face's area
 * element × weight), x, n (the outward normal) }].
 */
function mpFacePoints(M, e, axis, side, nq) {
  const dim = M.dim, npe = M.npe, [s, w] = MP_GAUSS[nq], out = [];
  const others = [0, 1, 2].slice(0, dim).filter(d => d !== axis), m = Math.pow(nq, dim - 1);
  for (let q = 0; q < m; q++) {
    const xi = [0, 0, 0]; let wt = 1;
    xi[axis] = side;
    others.forEach((d, k) => { const i = Math.floor(q / Math.pow(nq, k)) % nq; xi[d] = s[i]; wt *= w[i]; });
    const S = mpShape(M.p, dim, xi.slice(0, dim)), x = [0, 0, 0], T = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let a = 0; a < npe; a++) {
      const n = M.conn[e * npe + a];
      for (let i = 0; i < dim; i++) {
        x[i] += S.N[a] * M.X[n * dim + i];
        for (let j = 0; j < dim; j++) T[j][i] += M.X[n * dim + i] * S.dN[a * dim + j];   // T[j] = ∂x/∂ξ_j
      }
    }
    let da, nrm;
    if (dim === 1) { da = 1; nrm = [side]; }
    else if (dim === 2) {
      const t = T[others[0]], len = Math.hypot(t[0], t[1]); da = len;
      // the outward normal: the axis direction's side, made perpendicular to the face
      const g = T[axis]; let nx = t[1] / len, ny = -t[0] / len;
      if ((nx * g[0] + ny * g[1]) * side < 0) { nx = -nx; ny = -ny; }
      nrm = [nx, ny];
    } else {
      const a = T[others[0]], b = T[others[1]];
      const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      da = Math.hypot(c[0], c[1], c[2]);
      const g = T[axis]; let nv = c.map(v => v / da);
      if ((nv[0] * g[0] + nv[1] * g[1] + nv[2] * g[2]) * side < 0) nv = nv.map(v => -v);
      nrm = nv;
    }
    out.push({ N: S.N, w: wt * da, x: x.slice(0, dim), n: nrm });
  }
  return out;
}

// ---- the banded symmetric positive definite matrix ----

/**
 * A band matrix: symmetric (the lower band stored row by row: a[i (bw + 1) + (i − j)], j ≤ i; factored by Cholesky)
 * or not (sym false: the whole band, a[i (2 bw + 1) + (j − i + bw)]; factored by LU without pivoting, for the
 * advective transport, whose matrix is dominated by its diagonal).
 */
function mpBand(n, bw, sym = true) { const w = sym ? bw + 1 : 2 * bw + 1; return { n, bw, w, sym, a: new Float64Array(n * w), L: null }; }
/** The band a mesh's matrix needs with dpn unknowns per node. */
function mpBandwidth(M, dpn) {
  let b = 0;
  for (let e = 0; e < M.E; e++) {
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < M.npe; a++) { const n = M.conn[e * M.npe + a]; if (n < lo) lo = n; if (n > hi) hi = n; }
    b = Math.max(b, (hi - lo) * dpn + dpn - 1);
  }
  return b;
}
const mpAdd = (B, i, j, v) => { if (!B.sym) B.a[i * B.w + (j - i + B.bw)] += v; else if (j <= i) B.a[i * B.w + (i - j)] += v; };
/** Factor in place (Cholesky A = L Lᵀ; unsymmetric: LU, L with a unit diagonal). */
function mpFactor(B) {
  const { n, bw, w, a } = B;
  if (!B.sym) {
    // (row r's entry in column j sits at r w + bw − r + j: each row's base precomputed)
    for (let k = 0; k < n; k++) {
      const bk = k * w + bw - k, pk = a[bk + k], jEnd = Math.min(n - 1, k + bw);
      if (!(Math.abs(pk) > 0) || !isFinite(pk)) throw new Error(`mp-core: a zero pivot (row ${k})`);
      for (let i = k + 1; i <= jEnd; i++) {
        const bi = i * w + bw - i, l = a[bi + k] / pk;
        if (!l) continue;
        a[bi + k] = l;
        for (let j = k + 1; j <= jEnd; j++) a[bi + j] -= l * a[bk + j];
      }
    }
    B.L = true; return B;
  }
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw), ri = i * w;
    for (let j = j0; j <= i; j++) {
      const rj = j * w, k0 = Math.max(j0, j - bw);
      let s = a[ri + (i - j)];
      for (let k = k0; k < j; k++) s -= a[ri + (i - k)] * a[rj + (j - k)];
      if (j === i) {
        if (!(s > 0)) throw new Error(`mp-core: the matrix is not positive definite (row ${i})`);
        a[ri] = Math.sqrt(s);
      } else a[ri + (i - j)] = s / a[rj];
    }
  }
  B.L = true;
  return B;
}
/** Solve with the factored band. */
function mpBackSolve(B, rhs) {
  const { n, bw, w, a } = B, y = Float64Array.from(rhs);
  if (!B.sym) {
    for (let i = 0; i < n; i++) { let s = y[i]; for (let k = Math.max(0, i - bw); k < i; k++) s -= a[i * w + (k - i + bw)] * y[k]; y[i] = s; }
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= a[i * w + (k - i + bw)] * y[k]; y[i] = s / a[i * w + bw]; }
    return y;
  }
  for (let i = 0; i < n; i++) { let s = y[i]; const ri = i * w; for (let k = Math.max(0, i - bw); k < i; k++) s -= a[ri + (i - k)] * y[k]; y[i] = s / a[ri]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= a[k * w + (k - i)] * y[k]; y[i] = s / a[i * w]; }
  return y;
}
/** The (unfactored) band times a vector. */
function mpBandMul(B, x) {
  const { n, bw, w, a } = B, y = new Float64Array(n);
  if (!B.sym) {
    for (let i = 0; i < n; i++) { let s = 0; for (let j = Math.max(0, i - bw); j <= Math.min(n - 1, i + bw); j++) s += a[i * w + (j - i + bw)] * x[j]; y[i] = s; }
    return y;
  }
  for (let i = 0; i < n; i++) {
    const ri = i * w; y[i] += a[ri] * x[i];
    for (let j = Math.max(0, i - bw); j < i; j++) { const v = a[ri + (i - j)]; y[i] += v * x[j]; y[j] += v * x[i]; }
  }
  return y;
}
/** Fix unknown d at value g: its column moved to the right side, its row and column the identity. */
function mpFix(B, rhs, d, g) {
  const { n, bw, w, a } = B;
  if (!B.sym) {
    for (let i = Math.max(0, d - bw); i <= Math.min(n - 1, d + bw); i++) {
      if (i === d) continue;
      const k = i * w + (d - i + bw); rhs[i] -= a[k] * g; a[k] = 0;
      a[d * w + (i - d + bw)] = 0;
    }
    a[d * w + bw] = 1; rhs[d] = g; return;
  }
  for (let i = Math.max(0, d - bw); i < d; i++) { const k = d * w + (d - i); rhs[i] -= a[k] * g; a[k] = 0; }
  for (let i = d + 1; i <= Math.min(n - 1, d + bw); i++) { const k = i * w + (i - d); rhs[i] -= a[k] * g; a[k] = 0; }
  a[d * w] = 1; rhs[d] = g;
}

// ---- scalar transport: heat, water, porous flow ----

const mpVal = (f, ...args) => (typeof f === 'function' ? f(...args) : f);

/**
 * C ∂u/∂t + C v·∇u = ∇·(K ∇u) + Q on the mesh M, one step at a time (mpTransport) or through to the output times
 * (mpScalar).
 * o: {
 *   C (m, u, x, f) → capacity (per volume; default 1), K (m, u, x, f) → a number or [Kx, Ky, Kz], Q (m, u, x, t, f) →
 *   source (f: the fields at the point, below), vel (m, x) → [vx, vy, vz] (advection, SUPG), capFlow (m) → the
 *   capacity the flow carries (default C),
 *   S (m, u, x, f) → the amount stored per volume, when it is not C u (an isotherm's water; C must then be its slope
 *   dS/du): the time term ∂S/∂t is then kept exactly (the mass-conserving Picard of Celia et al. 1990: implicit Euler),
 *   lump (true: the capacity at the nodes, each its share of the element: no overshoot at a sharp front),
 *   fields: { name: nodal array } (another solve's result, interpolated to the points; mpTransport's step can replace
 *   them for the new time),
 *   bc: [{ face, type: 'value', u (x, t) } | { face, type: 'flux', q (x, t, u): into the body } |
 *        { face, type: 'robin', h (x, t, u), uInf (x, t) } | { face, type: 'rad', eps (x, t), uInf, abs (added to u
 *        for kelvin; default 273.15) }],
 *   u0 (number, array, or (x) → u), theta (1: implicit Euler, the default; 0.5 Crank–Nicolson; S needs 1),
 *   picard (iterations when anything depends on u; default 1: linear), tol (relative; default 1e-8) }.
 * mpTransport returns { u (the field now), t, step(t, dt, fields) (to time t over dt; fields: the new time's),
 * steady(t), fluxIn(face) (the flow into the body through a face held at a value), faceIn(face) (through a face with
 * a transfer coefficient or radiation, at u now), iters }.
 */
function mpTransport(M, o) {
  const dim = M.dim, npe = M.npe, N = M.N, nq = M.p + 1, rule = mpRule(M.p, dim, nq), nr = rule.length;
  const bw = mpBandwidth(M, 1), dNdx = new Float64Array(npe * dim), ke = new Float64Array(npe * npe), fe = new Float64Array(npe);
  const bcs = (o.bc || []).map(b => ({ ...b, fe: mpFaceElems(M, b.face), nodes: b.type === 'value' ? mpFaceNodes(M, b.face) : null }));
  const u = new Float64Array(N);
  if (typeof o.u0 === 'function') for (let k = 0; k < N; k++) u[k] = o.u0(Array.from(M.X.subarray(k * dim, k * dim + dim)));
  else if (o.u0 && o.u0.length === N) u.set(o.u0);
  else u.fill(o.u0 || 0);
  let fields = o.fields || {}, names = Object.keys(fields);
  const fAt = (e, Nv) => { const f = {}; for (const k of names) { let s = 0; for (let a = 0; a < npe; a++) s += Nv[a] * fields[k][M.conn[e * npe + a]]; f[k] = s; } return f; };
  const fNode = n => { const f = {}; for (const k of names) f[k] = fields[k][n]; return f; };
  const xNode = n => Array.from(M.X.subarray(n * dim, n * dim + dim));
  const Kof = (m, uq, x, f) => { const k = mpVal(o.K, m, uq, x, f); return Array.isArray(k) ? k : [k, k, k]; };
  const Cof = (m, uq, x, f) => (o.C === undefined ? 1 : mpVal(o.C, m, uq, x, f));
  const store = !!o.S, lump = !!o.lump;
  // the elements' geometric shares at their nodes (lumping): Σ_q N_a w det J
  let share = null;
  if (lump) {
    share = new Float64Array(M.E * npe);
    for (let e = 0; e < M.E; e++) for (const q of rule) { const { det } = mpJac(M, e, q, dNdx); for (let a = 0; a < npe; a++) share[e * npe + a] += q.N[a] * q.w * det; }
  }
  // the amount stored at the step's start (S): per element and point (or node, lumped)
  const Sold = store ? new Float64Array(M.E * (lump ? npe : nr)) : null;
  function keepStore() {
    for (let e = 0; e < M.E; e++) {
      const m = M.mat[e], base = e * npe;
      if (lump) for (let a = 0; a < npe; a++) { const n = M.conn[base + a]; Sold[e * npe + a] = o.S(m, u[n], xNode(n), fNode(n)); }
      else rule.forEach((q, qi) => {
        const { x } = mpJac(M, e, q, dNdx); let uq = 0; for (let a = 0; a < npe; a++) uq += q.N[a] * u[M.conn[base + a]];
        Sold[e * nr + qi] = o.S(m, uq, x, fAt(e, q.N));
      });
    }
  }
  let raw = null;   // the last system before the values were imposed (fluxIn)

  /** Assemble K + C/(θ dt) (dt null: steady) and its right side at time t from the previous u (uOld) and the iterate uk. */
  function assemble(uOld, uk, t, dt, theta) {
    const B = mpBand(N, bw, !o.vel), R = new Float64Array(N);
    for (let e = 0; e < M.E; e++) {
      const m = M.mat[e], base = e * npe;
      ke.fill(0); fe.fill(0);
      rule.forEach((q, qi) => {
        const { det, x } = mpJac(M, e, q, dNdx), W = q.w * det, f = fAt(e, q.N);
        let uq = 0; for (let a = 0; a < npe; a++) uq += q.N[a] * uk[M.conn[base + a]];
        const k = Kof(m, uq, x, f), C = Cof(m, uq, x, f), Qv = o.Q ? mpVal(o.Q, m, uq, x, t, f) : 0;
        const v = o.vel ? o.vel(m, x) : null, Cf = v ? (o.capFlow ? o.capFlow(m) : C) : 0;
        // SUPG: τ from the element's size along the flow and its Péclet number
        let tau = 0, vgrad = null;
        if (v) {
          vgrad = new Float64Array(npe);
          for (let a = 0; a < npe; a++) { let s = 0; for (let j = 0; j < dim; j++) s += v[j] * dNdx[a * dim + j]; vgrad[a] = s; }
          const vn = Math.hypot(...v.slice(0, dim));
          if (vn > 0) {
            let hs = 0; for (let a = 0; a < npe; a++) hs += Math.abs(vgrad[a]) / vn;
            const h = 2 / Math.max(hs, 1e-300), kv = (k[0] + k[1] + k[2]) / 3, Pe = Cf * vn * h / (2 * kv);
            const xi = Pe > 1e-8 ? (1 / Math.tanh(Pe) - 1 / Pe) : Pe / 3;
            tau = h / (2 * vn) * xi / M.p;
          }
        }
        const Sk = dt && store && !lump ? o.S(m, uq, x, f) : 0;
        for (let a = 0; a < npe; a++) {
          const wa = q.N[a] + (v ? tau * vgrad[a] : 0);
          for (let b = 0; b < npe; b++) {
            let s = 0; for (let j = 0; j < dim; j++) s += k[j] * dNdx[a * dim + j] * dNdx[b * dim + j];
            let kab = s * W;
            if (v) kab += wa * Cf * vgrad[b] * W;
            if (dt) {
              ke[a * npe + b] += theta * kab;
              fe[a] -= (1 - theta) * kab * uOld[M.conn[base + b]];
              if (!lump) {
                const mab = C * wa * q.N[b] * W / dt;
                ke[a * npe + b] += mab;
                // stored: C (u − u_k) + S(u_k) − S_old; else C (u − u_old)
                fe[a] += mab * (store ? uk[M.conn[base + b]] : uOld[M.conn[base + b]]);
              }
            } else ke[a * npe + b] += kab;
          }
          if (dt && store && !lump) fe[a] -= wa * (Sk - Sold[e * nr + qi]) * W / dt;
          fe[a] += wa * Qv * W;
        }
      });
      if (dt && lump) for (let a = 0; a < npe; a++) {
        const n = M.conn[base + a], xa = xNode(n), fa = fNode(n), ma = share[e * npe + a] / dt, C = Cof(m, uk[n], xa, fa);
        ke[a * npe + a] += C * ma;
        if (store) fe[a] += ma * (C * uk[n] - (o.S(m, uk[n], xa, fa) - Sold[e * npe + a]));
        else fe[a] += C * ma * uOld[n];
      }
      for (let a = 0; a < npe; a++) {
        const i = M.conn[base + a]; R[i] += fe[a];
        for (let b = 0; b < npe; b++) mpAdd(B, i, M.conn[base + b], ke[a * npe + b]);
      }
    }
    // the faces: flux, transfer, radiation (linearized about the iterate)
    for (const bc of bcs) {
      if (bc.type === 'value') continue;
      for (const e of bc.fe.elems) {
        const base = e * npe;
        for (const fp of mpFacePoints(M, e, bc.fe.axis, bc.fe.side, nq)) {
          let uq = 0; for (let a = 0; a < npe; a++) uq += fp.N[a] * uk[M.conn[base + a]];
          const [h, g] = faceHG(bc, fp, t, uq);   // the face adds h u to the operator and g to the right side
          for (let a = 0; a < npe; a++) {
            const i = M.conn[base + a];
            R[i] += fp.N[a] * g * fp.w;
            if (h) for (let b = 0; b < npe; b++) mpAdd(B, i, M.conn[base + b], (dt ? theta : 1) * h * fp.N[a] * fp.N[b] * fp.w);
            if (h && dt && theta < 1) { let uo = 0; for (let b = 0; b < npe; b++) uo += fp.N[b] * uOld[M.conn[base + b]]; R[i] -= (1 - theta) * h * fp.N[a] * uo * fp.w; }
          }
        }
      }
    }
    raw = { B: { ...B, a: Float64Array.from(B.a) }, R: Float64Array.from(R) };
    for (const bc of bcs) if (bc.type === 'value') for (const n of bc.nodes) mpFix(B, R, n, mpVal(bc.u, xNode(n), t));
    return { B, R };
  }
  /** A face's [h, g] at a point: the flow into the body there is g − h u. */
  function faceHG(bc, fp, t, uq) {
    if (bc.type === 'flux') return [0, mpVal(bc.q, fp.x, t, uq)];
    if (bc.type === 'robin') { const h = mpVal(bc.h, fp.x, t, uq); return [h, h * mpVal(bc.uInf, fp.x, t)]; }
    // radiation: ε σ (T⁴ − T∞⁴) = ε σ (T² + T∞²)(T + T∞) (T − T∞), exact at convergence
    const A = bc.abs === undefined ? 273.15 : bc.abs, T = uq + A, Ti = mpVal(bc.uInf, fp.x, t) + A, eps = mpVal(bc.eps, fp.x, t);
    const h = eps * MP_SIGMA * (T * T + Ti * Ti) * (T + Ti);
    return [h, h * (Ti - A)];
  }

  const picard = o.picard || 1, tol = o.tol || 1e-8, theta = o.theta === undefined ? 1 : o.theta;
  if (store && theta !== 1) throw new Error('mp-core: a stored amount (S) is stepped by implicit Euler (theta 1)');
  const T = { u, t: 0, iters: 0 };
  function solve(uOld, t, dt) {
    let uk = uOld;
    for (let it = 0; it < picard; it++) {
      const { B, R } = assemble(uOld, uk, t, dt, theta);
      mpFactor(B);
      const un = mpBackSolve(B, R);
      T.iters++;
      let dn = 0, nn = 0; for (let k = 0; k < N; k++) { dn = Math.max(dn, Math.abs(un[k] - uk[k])); nn = Math.max(nn, Math.abs(un[k])); }
      uk = un;
      if (dn <= tol * Math.max(nn, 1e-300)) break;
    }
    return uk;
  }
  T.step = (t, dt, newFields) => {
    if (store) keepStore();
    if (newFields) { fields = newFields; names = Object.keys(fields); }
    T.u.set(solve(Float64Array.from(T.u), t, dt)); T.t = t;
    return T.u;
  };
  T.steady = (t = 0, newFields) => {
    if (newFields) { fields = newFields; names = Object.keys(fields); }
    T.u.set(solve(Float64Array.from(T.u), t, null)); T.t = t;
    return T.u;
  };
  /**
   * The flow into the body through a face held at a value (per unit depth in 2D), from the last step's system before
   * the values were imposed: the residual (K u − f) at the face's nodes (conservative; a node on two held faces counts
   * in both).
   */
  T.fluxIn = face => {
    if (!raw) return NaN;
    const nodes = mpFaceNodes(M, face), r = mpBandMul(raw.B, T.u);
    let s = 0; for (const n of nodes) s += r[n] - raw.R[n];
    return s;
  };
  /** The flow into the body through faces with a flux, a transfer coefficient or radiation (those of bc on `face`), at u now. */
  T.faceIn = face => {
    let s = 0;
    for (const bc of bcs) {
      if (bc.face !== face || bc.type === 'value') continue;
      for (const e of bc.fe.elems) for (const fp of mpFacePoints(M, e, bc.fe.axis, bc.fe.side, nq)) {
        let uq = 0; for (let a = 0; a < npe; a++) uq += fp.N[a] * T.u[M.conn[e * npe + a]];
        const [h, g] = faceHG(bc, fp, T.t, uq); s += (g - h * uq) * fp.w;
      }
    }
    return s;
  };
  /** The amount stored in the body (∫ S, or ∫ C u), at u now. */
  T.stored = () => {
    let s = 0;
    for (let e = 0; e < M.E; e++) {
      const m = M.mat[e], base = e * npe;
      if (lump) { for (let a = 0; a < npe; a++) { const n = M.conn[base + a], xa = xNode(n), fa = fNode(n); s += share[base + a] * (store ? o.S(m, T.u[n], xa, fa) : Cof(m, T.u[n], xa, fa) * T.u[n]); } continue; }
      for (const q of rule) {
        const { det, x } = mpJac(M, e, q, dNdx), f = fAt(e, q.N); let uq = 0; for (let a = 0; a < npe; a++) uq += q.N[a] * T.u[M.conn[base + a]];
        s += (store ? o.S(m, uq, x, f) : Cof(m, uq, x, f) * uq) * q.w * det;
      }
    }
    return s;
  };
  return T;
}

/**
 * mpTransport through to the output times: o as mpTransport's, and steady (true: no time), times (the output times,
 * s), dt (the first step), dtMax, grow (the step's growth; default 1.2), onStep (t, u).
 * Returns { u (the last), t, snaps [{ t, u }] (at the output times), steps, iters, fluxIn(face), faceIn(face) }.
 */
function mpScalar(M, o) {
  const T = mpTransport(M, o), snaps = [];
  let t = 0, steps = 0;
  if (o.steady) { T.steady(0); snaps.push({ t: 0, u: Float64Array.from(T.u) }); }
  else {
    const times = (o.times || []).slice().sort((a, b) => a - b), tEnd = times[times.length - 1];
    let dt = o.dt || tEnd / 100;
    const dtMax = o.dtMax || tEnd / 20, grow = o.grow || 1.2;
    let next = 0;
    while (next < times.length && times[next] <= 0) snaps.push({ t: times[next++], u: Float64Array.from(T.u) });
    while (t < tEnd * (1 - 1e-12)) {
      const h = Math.min(dt, times[next] - t);
      T.step(t + h, h); t += h; steps++;
      if (o.onStep) o.onStep(t, T.u);
      if (Math.abs(t - times[next]) <= 1e-12 * Math.max(1, tEnd)) { snaps.push({ t: times[next], u: Float64Array.from(T.u) }); next++; }
      dt = Math.min(dtMax, dt * grow);
    }
  }
  return { u: T.u, t, snaps, steps, iters: T.iters, M, fluxIn: T.fluxIn, faceIn: T.faceIn, stored: T.stored };
}

// ---- heat and moisture together (a porous solid: its heat, its water, the latent heat between them) ----

/**
 * Heat and moisture transport solved together, T (°C) and the vapour's pressure p (Pa) at every node (Künzel's
 * formulation, vapour only): the water held S(p, T) (kg/m³, its isotherm at the local temperature), the heat in the
 * solid C_T T; the liquid held is below the vapour by the latent heat L:
 *   ∂(C_T T − L S)/∂t = ∇·(k ∇T) + Q          (the enthalpy: drying takes L where the water leaves the pores)
 *   ∂S/∂t = ∇·(K_v ∇p)                        (the vapour moves down its pressure)
 * Implicit Euler; each step Newton on the storage (∂S/∂p, ∂S/∂T) and Picard on the faces' coefficients; the storage
 * at the nodes (lumped: each node its share of its elements). Where no element holds water (wet (m) false) p is held.
 * o: { kT (m, T, x) → k or [kx, ky, kz], CT (m, T, x) → ρ c_p (J/(m³ K)), Kv (m, T, x) → K_v or [..] (kg/(m s Pa)),
 *   S (m, p, T, x) → kg/m³, dS (m, p, T, x) → [∂S/∂p, ∂S/∂T] (default: finite differences), L (T) → J/kg, Q (m, T, x, t),
 *   wet (m) → whether material m holds water (default all),
 *   bcT: mpTransport's faces for the heat, bcV: [{ face, type: 'value', u (x, t), where (x) → bool } | { face, type:
 *   'robin', h (x, t, T) (a mass transfer coefficient per pressure, kg/(m² s Pa)), uInf (x, t), where }],
 *   T0, p0 (numbers, arrays or (x) → …), iters (default 30), tol (default 1e-9), chord (false: refactor every iteration),
 *   nodal (linear elements: the flows integrated at the nodes -- no overshoot on long thin elements), bdf2 (second order
 *   in time: variable-step BDF2, its first step implicit Euler) }.
 * Returns { T, p, t, step(t, dt), heatIn(face) (through faces with air or radiation), vapourIn(face) (through
 * faces held at a value or with a transfer coefficient, kg/s), enthalpy() (∫ C_T T − L S), water() (∫ S), iters }.
 */
function mpHeatMoisture(M, o) {
  const dim = M.dim, npe = M.npe, N = M.N, nq = M.p + 1, rule = mpRule(M.p, dim, nq), dNdx = new Float64Array(npe * dim);
  if (o.nodal && M.p !== 1) throw new Error('mp-core: nodal integration is for linear elements');
  const frule = o.nodal ? mpRule(1, dim, 'nodes') : rule;   // (the conduction's and the vapour's)
  const bw = 2 * mpBandwidth(M, 1) + 1, nd = 2 * N;
  const xNode = n => Array.from(M.X.subarray(n * dim, n * dim + dim));
  const init = (v, d) => { const a = new Float64Array(N); for (let k = 0; k < N; k++) a[k] = typeof v === 'function' ? v(xNode(k)) : v && v.length === N ? v[k] : (v === undefined ? d : v); return a; };
  const T = init(o.T0, 20), P = init(o.p0, 1000);
  const wet = o.wet || (() => true), Lof = typeof o.L === 'function' ? o.L : () => o.L;
  const vec = k => (Array.isArray(k) ? k : [k, k, k]);
  const dS = o.dS || ((m, p, t, x) => { const hp = Math.max(1e-6 * Math.abs(p), 1e-3), ht = 1e-4; return [(o.S(m, p + hp, t, x) - o.S(m, p - hp, t, x)) / (2 * hp), (o.S(m, p, t + ht, x) - o.S(m, p, t - ht, x)) / (2 * ht)]; });
  // each element's share at its nodes, the nodes that hold water, each node's (wet) element for its material
  const share = new Float64Array(M.E * npe), wetNode = new Uint8Array(N), nodeMat = new Int32Array(N).fill(-1);
  for (let e = 0; e < M.E; e++) {
    for (const q of rule) { const { det } = mpJac(M, e, q, dNdx); for (let a = 0; a < npe; a++) share[e * npe + a] += q.N[a] * q.w * det; }
    if (wet(M.mat[e])) for (let a = 0; a < npe; a++) { const n = M.conn[e * npe + a]; wetNode[n] = 1; nodeMat[n] = M.mat[e]; }
  }
  const prep = list => (list || []).map(b => ({ ...b, fe: mpFaceElems(M, b.face), nodes: b.type === 'value' ? mpFaceNodes(M, b.face).filter(n => !b.where || b.where(xNode(n))) : null }));
  const bcT = prep(o.bcT), bcV = prep(o.bcV);
  const R = { T, p: P, t: 0, iters: 0, factors: 0 };
  /** the stored water at a node (its wet material's), and the node's enthalpy's parts */
  const Snode = (n, p, t) => (wetNode[n] ? o.S(nodeMat[n], p, t, xNode(n)) : 0);
  // (each node's share of the elements that hold water -- a node on a wet element's face next to a dry one holds water
  //  for its wet side only -- and its heat capacity from all its elements)
  const nodeShare = new Float64Array(N), nodeCT = new Float64Array(N);
  /** Each node's ∫ S and ∫ (C_T T − L S) over its share, at the state now (no side effects but the shares). */
  function levels() {
    nodeShare.fill(0); nodeCT.fill(0);
    for (let e = 0; e < M.E; e++) for (let a = 0; a < npe; a++) {
      const n = M.conn[e * npe + a], w = share[e * npe + a];
      if (wet(M.mat[e])) nodeShare[n] += w;
      nodeCT[n] += w * o.CT(M.mat[e], T[n], xNode(n));
    }
    const S = new Float64Array(N), H = new Float64Array(N);
    for (let n = 0; n < N; n++) { const s = Snode(n, P[n], T[n]); S[n] = nodeShare[n] * s; H[n] = nodeCT[n] * T[n] - Lof(T[n]) * nodeShare[n] * s; }
    return { S, H };
  }
  // BDF2 (variable steps, o.bdf2): the level before the last and its step; the first step implicit Euler
  let prev = null, dtPrev = 0;
  function faceHG(bc, fp, t, u) {
    if (bc.type === 'flux') return [0, mpVal(bc.q, fp.x, t, u)];
    if (bc.type === 'robin') { const h = mpVal(bc.h, fp.x, t, u); return [h, h * mpVal(bc.uInf, fp.x, t)]; }
    const A = bc.abs === undefined ? 273.15 : bc.abs, Tk = u + A, Ti = mpVal(bc.uInf, fp.x, t) + A, eps = mpVal(bc.eps, fp.x, t);
    const h = eps * MP_SIGMA * (Tk * Tk + Ti * Ti) * (Tk + Ti);
    return [h, h * (Ti - A)];
  }
  R.step = (t, dt) => {
    const cur = levels();
    // the time derivative (a0 X^{n+1} − a1 X^n + a2 X^{n−1}) / dt: BDF2 with ω = dt / dt_prev, else implicit Euler
    let a0 = 1, a1 = 1, a2 = 0;
    if (o.bdf2 && prev) { const w = dt / dtPrev; a0 = (1 + 2 * w) / (1 + w); a1 = 1 + w; a2 = w * w / (1 + w); }
    const Sold = new Float64Array(N), Hold = new Float64Array(N);   // the history part: a1 X^n − a2 X^{n−1}
    for (let n = 0; n < N; n++) { Sold[n] = a1 * cur.S[n] - (a2 ? a2 * prev.S[n] : 0); Hold[n] = a1 * cur.H[n] - (a2 ? a2 * prev.H[n] : 0); }
    const Tk = Float64Array.from(T), Pk = Float64Array.from(P), iters = o.iters || 30, tol = o.tol || 1e-9;
    let F = null, slow = false, lastSize = null;
    for (let it = 0; it < iters; it++) {
      const B = mpBand(nd, bw, false), rhs = new Float64Array(nd);
      // conduction and vapour flow (consistent; or at the nodes: nodal)
      for (let e = 0; e < M.E; e++) {
        const m = M.mat[e], base = e * npe, isWet = wet(m);
        for (const q of frule) {
          const { det, x } = mpJac(M, e, q, dNdx), W = q.w * det;
          let tq = 0; for (let a = 0; a < npe; a++) tq += q.N[a] * Tk[M.conn[base + a]];
          const kt = vec(mpVal(o.kT, m, tq, x)), kv = isWet ? vec(mpVal(o.Kv, m, tq, x)) : null, Qv = o.Q ? mpVal(o.Q, m, tq, x, t) : 0;
          for (let a = 0; a < npe; a++) {
            const ia = M.conn[base + a];
            rhs[2 * ia] += q.N[a] * Qv * W;
            for (let b = 0; b < npe; b++) {
              const ib = M.conn[base + b];
              let st = 0, sv = 0;
              for (let j = 0; j < dim; j++) { const g = dNdx[a * dim + j] * dNdx[b * dim + j]; st += kt[j] * g; if (kv) sv += kv[j] * g; }
              mpAdd(B, 2 * ia, 2 * ib, st * W);
              if (kv) mpAdd(B, 2 * ia + 1, 2 * ib + 1, sv * W);
            }
          }
        }
      }
      // storage at the nodes, linearized (Newton): S ≈ S_k + S_p (p − p_k) + S_T (T − T_k)
      for (let n = 0; n < N; n++) {
        const w = a0 * nodeShare[n] / dt, L = Lof(Tk[n]);
        const cT = a0 * nodeCT[n] / dt;
        if (!wetNode[n]) {
          mpAdd(B, 2 * n, 2 * n, cT); rhs[2 * n] += Hold[n] / dt;
          continue;
        }
        const x = xNode(n), m = nodeMat[n], Sk = o.S(m, Pk[n], Tk[n], x), [Sp, ST] = dS(m, Pk[n], Tk[n], x);
        // heat: [C_T T − L (S_k + S_p (p − p_k) + S_T (T − T_k))] share / dt − H_old / dt
        mpAdd(B, 2 * n, 2 * n, cT - L * ST * w);
        mpAdd(B, 2 * n, 2 * n + 1, -L * Sp * w);
        rhs[2 * n] += Hold[n] / dt + L * w * (Sk - Sp * Pk[n] - ST * Tk[n]);
        // water: (S_k + S_p (p − p_k) + S_T (T − T_k)) share / dt − S_old / dt
        mpAdd(B, 2 * n + 1, 2 * n + 1, Sp * w);
        mpAdd(B, 2 * n + 1, 2 * n, ST * w);
        rhs[2 * n + 1] += Sold[n] / dt - w * (Sk - Sp * Pk[n] - ST * Tk[n]);
      }
      // the faces: heat (air, radiation, flux), vapour (a transfer coefficient)
      for (const [list, off] of [[bcT, 0], [bcV, 1]]) for (const bc of list) {
        if (bc.type === 'value') continue;
        for (const e of bc.fe.elems) for (const fp of mpFacePoints(M, e, bc.fe.axis, bc.fe.side, nq)) {
          if (bc.where && !bc.where(fp.x)) continue;
          let uq = 0, tq = 0; for (let a = 0; a < npe; a++) { const n = M.conn[e * npe + a]; uq += fp.N[a] * (off ? Pk[n] : Tk[n]); tq += fp.N[a] * Tk[n]; }
          const [h, g] = faceHG(bc, fp, t, off ? tq : uq);
          for (let a = 0; a < npe; a++) {
            const i = M.conn[e * npe + a]; rhs[2 * i + off] += fp.N[a] * g * fp.w;
            if (h) for (let b = 0; b < npe; b++) mpAdd(B, 2 * i + off, 2 * M.conn[e * npe + b] + off, h * fp.N[a] * fp.N[b] * fp.w);
          }
        }
      }
      R.raw = { B: { ...B, a: Float64Array.from(B.a) }, rhs: Float64Array.from(rhs) };
      for (const bc of bcT) if (bc.type === 'value') for (const n of bc.nodes) mpFix(B, rhs, 2 * n, mpVal(bc.u, xNode(n), t));
      for (const bc of bcV) if (bc.type === 'value') for (const n of bc.nodes) if (wetNode[n]) mpFix(B, rhs, 2 * n + 1, mpVal(bc.u, xNode(n), t));
      for (let n = 0; n < N; n++) if (!wetNode[n]) mpFix(B, rhs, 2 * n + 1, Pk[n]);
      // the correction from the residual B u_k − rhs; the chord method: the step's first factors reused while they
      // converge fast (the matrix changes little within a step), refactored when they do not
      const uk = new Float64Array(nd); for (let n = 0; n < N; n++) { uk[2 * n] = Tk[n]; uk[2 * n + 1] = Pk[n]; }
      const res = mpBandMul(B, uk); for (let i = 0; i < nd; i++) res[i] = rhs[i] - res[i];
      if (!F || slow) { F = mpFactor(B); R.factors++; }
      const du = mpBackSolve(F, res);
      R.iters++;
      let dT = 0, dP = 0, sP = 0;
      for (let n = 0; n < N; n++) {
        dT = Math.max(dT, Math.abs(du[2 * n])); dP = Math.max(dP, Math.abs(du[2 * n + 1]));
        Tk[n] += du[2 * n]; Pk[n] += du[2 * n + 1]; sP = Math.max(sP, Math.abs(Pk[n]));
      }
      if (!Tk.every(Number.isFinite) || !Pk.every(Number.isFinite)) throw new Error('mp-core: the heat and moisture step did not converge');
      if (dT < tol * 100 && dP <= tol * Math.max(sP, 1)) break;
      // (slow: the correction did not at least halve against the last one)
      const size = dT / 100 + dP / Math.max(sP, 1);
      slow = o.chord === false || (lastSize !== null && size > 0.5 * lastSize);
      lastSize = size;
    }
    T.set(Tk); P.set(Pk); R.t = t;
    // the step's change of what is held, as the scheme counts it (a0 X^{n+1} − a1 X^n + a2 X^{n−1}): the heat and the
    // water that came in over the step, dt × the faces' flows, exactly (the discrete balance)
    const nw = levels(); let dH = 0, dW = 0;
    for (let n = 0; n < N; n++) { dH += a0 * nw.H[n] - Hold[n]; dW += a0 * nw.S[n] - Sold[n]; }
    R.stepHeld = { H: dH, W: dW };
    prev = cur; dtPrev = dt;
    return R;
  };
  /** The heat into the body through a face with air, radiation or a flux (W; per unit depth in 2D), at T now. */
  R.heatIn = face => {
    let s = 0;
    for (const bc of bcT) {
      if (bc.face !== face || bc.type === 'value') continue;
      for (const e of bc.fe.elems) for (const fp of mpFacePoints(M, e, bc.fe.axis, bc.fe.side, nq)) {
        let u = 0; for (let a = 0; a < npe; a++) u += fp.N[a] * T[M.conn[e * npe + a]];
        const [h, g] = faceHG(bc, fp, R.t, u); s += (g - h * u) * fp.w;
      }
    }
    return s;
  };
  /** The heat into the body through a face held at a temperature (the residual of the last step's system there). */
  R.heatInHeld = face => {
    if (!R.raw) return 0;
    const u = new Float64Array(nd); for (let n = 0; n < N; n++) { u[2 * n] = T[n]; u[2 * n + 1] = P[n]; }
    const r = mpBandMul(R.raw.B, u); let s = 0;
    for (const n of mpFaceNodes(M, face)) s += r[2 * n] - R.raw.rhs[2 * n];
    return s;
  };
  /**
   * The water into the body through faces (kg/s; per unit depth in 2D; a face or a list): held at a value (the residual
   * at their nodes, each node once however many of the faces it is on) or with a transfer coefficient.
   */
  R.vapourIn = faces => {
    const list = Array.isArray(faces) ? faces : [faces], held = new Set();
    let s = 0;
    for (const bc of bcV) {
      if (!list.includes(bc.face)) continue;
      if (bc.type === 'value') { for (const n of bc.nodes) if (wetNode[n]) held.add(n); continue; }
      for (const e of bc.fe.elems) for (const fp of mpFacePoints(M, e, bc.fe.axis, bc.fe.side, nq)) {
        if (bc.where && !bc.where(fp.x)) continue;
        let u = 0, tq = 0; for (let a = 0; a < npe; a++) { u += fp.N[a] * P[M.conn[e * npe + a]]; tq += fp.N[a] * T[M.conn[e * npe + a]]; }
        const [h, g] = faceHG(bc, fp, R.t, tq); s += (g - h * u) * fp.w;
      }
    }
    if (held.size && R.raw) {
      const u = new Float64Array(nd); for (let n = 0; n < N; n++) { u[2 * n] = T[n]; u[2 * n + 1] = P[n]; }
      const r = mpBandMul(R.raw.B, u);
      for (const n of held) s += r[2 * n + 1] - R.raw.rhs[2 * n + 1];
    }
    return s;
  };
  R.water = () => levels().S.reduce((a, v) => a + v, 0);
  R.enthalpy = () => levels().H.reduce((a, v) => a + v, 0);
  R.wetNode = wetNode;
  return R;
}

/** The value of a nodal field at a point x (found by searching the elements' boxes; for maps, the unmapped box). */
function mpAt(M, u, x) {
  const dim = M.dim, ei = [], xi = [];
  for (let d = 0; d < dim; d++) {
    const E = M.edges[d]; let i = 0;
    while (i < E.length - 2 && x[d] > E[i + 1]) i++;
    ei.push(i); xi.push(Math.max(-1, Math.min(1, 2 * (x[d] - E[i]) / (E[i + 1] - E[i]) - 1)));
  }
  let e = ei[0]; if (dim > 1) e += ei[1] * M.ne[0]; if (dim > 2) e += ei[2] * M.ne[0] * M.ne[1];
  const S = mpShape(M.p, dim, xi); let v = 0;
  for (let a = 0; a < M.npe; a++) v += S.N[a] * u[M.conn[e * M.npe + a]];
  return v;
}

// ---- solids ----

/**
 * The 3D stiffness (6 × 6, Voigt xx yy zz yz xz xy, engineering shear) of an isotropic solid ({ E, nu }) or a
 * transversely isotropic one ({ Ep, nup, Et, nupt, Gpt, axis }: isotropic in the plane normal to `axis` (0, 1, 2;
 * default the last of the mesh's), ν_pt: the strain along the axis from a stress in the plane, ε_t = −ν_pt σ_p / E_p).
 */
function mpStiffness(m, axis = 2) {
  const S = Array.from({ length: 6 }, () => new Float64Array(6));
  if (m.E !== undefined) {
    const E = m.E, nu = m.nu, G = E / (2 * (1 + nu));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] = i === j ? 1 / E : -nu / E;
    for (let i = 3; i < 6; i++) S[i][i] = 1 / G;
  } else {
    const ax = m.axis === undefined ? axis : m.axis, p = [0, 1, 2].filter(d => d !== ax);
    const Gp = m.Ep / (2 * (1 + m.nup));
    S[p[0]][p[0]] = S[p[1]][p[1]] = 1 / m.Ep; S[p[0]][p[1]] = S[p[1]][p[0]] = -m.nup / m.Ep;
    S[ax][ax] = 1 / m.Et; S[ax][p[0]] = S[p[0]][ax] = S[ax][p[1]] = S[p[1]][ax] = -m.nupt / m.Ep;
    // shear: the in-plane shear (Voigt of the pair p) at Gp, the two through the axis at Gpt
    const vo = (i, j) => (i + j === 1 ? 5 : i + j === 2 ? 4 : 3);   // xy 5, xz 4, yz 3
    S[vo(p[0], p[1])][vo(p[0], p[1])] = 1 / Gp;
    S[vo(ax, p[0])][vo(ax, p[0])] = 1 / m.Gpt; S[vo(ax, p[1])][vo(ax, p[1])] = 1 / m.Gpt;
  }
  return mpInv6(S);
}
/** A symmetric positive definite 6 × 6 inverted (Gauss–Jordan). */
function mpInv6(S) {
  const n = S.length, A = S.map((r, i) => { const x = new Float64Array(2 * n); x.set(r); x[n + i] = 1; return x; });
  for (let c = 0; c < n; c++) {
    let pr = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[pr][c])) pr = r;
    [A[c], A[pr]] = [A[pr], A[c]];
    const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c]; if (f) for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
  }
  return A.map(r => r.slice(n));
}

/**
 * The stiffness and the strain's map for the mesh's dimension. 3D: the 6 × 6. 2D ('strain': εzz = 0; 'stress':
 * σzz = 0, condensed) on [xx, yy, xy]. Returns { D (nv × nv), sel (the Voigt rows kept), cz (the condensation's
 * −C_zz⁻¹ C_z,sel, for εzz in plane stress) }.
 */
function mpReduce(C, dim, plane) {
  if (dim === 3) return { D: C, sel: [0, 1, 2, 3, 4, 5], cz: null };
  const sel = [0, 1, 5];
  if (plane === 'strain') return { D: sel.map(i => sel.map(j => C[i][j])), sel, cz: null };
  const D = sel.map(i => sel.map(j => C[i][j] - C[i][2] * C[2][j] / C[2][2]));
  return { D, sel, cz: sel.map(j => -C[2][j] / C[2][2]) };
}

/**
 * Linear elasticity on M (2D or 3D; 1D films: mpLaminate).
 * o: {
 *   mats: [{ E, nu } | { Ep, nup, Et, nupt, Gpt, axis }] (by the elements' material index),
 *   plane: 'strain' | 'stress' (2D), eig (m, x, f, e, qi) → the eigenstrain, Voigt 6 (f: the fields at the point; e,
 *   qi: the element and its Gauss point, for what is kept per point: a creep strain),
 *   fields: { name: nodal array } (interpolated to the Gauss points for eig), body (m, x) → force per volume,
 *   scale (m, x, f, e, qi) → a factor on the stiffness at the point (a modulus with the water; a creep step's),
 *   bc: [{ face, fix: [components], value (x) → [displacements] (default 0) } | { face, traction (x) → [t] } |
 *        { face, pressure (x) → p (pushing in) } | { node, fix, value }],
 * }.
 * Returns { u (N × dim), strain, stress (N × 6, nodal averages of the elements' Gauss points: extrapolated for
 * p = 1 by the element mean), gp: [{ e, qi, x, stress, strain, elastic (the strain less the eigenstrain) }], vm (N: von Mises), s1 (N: the largest principal),
 * reaction(face) (the force the supports put on the body through a face, per component) }.
 */
function mpElastic(M, o) {
  const dim = M.dim; if (dim === 1) throw new Error('mp-core: a 1D film is mpLaminate');
  const npe = M.npe, N = M.N, nd = N * dim, nq = M.p + 1, rule = mpRule(M.p, dim, nq);
  const bw = mpBandwidth(M, dim), B = mpBand(nd, bw), R = new Float64Array(nd), dNdx = new Float64Array(npe * dim);
  const Cm = o.mats.map(m => mpStiffness(m, dim - 1)), red = Cm.map(c => mpReduce(c, dim, o.plane || 'strain'));
  const nv = dim === 3 ? 6 : 3, Bm = new Float64Array(nv * npe * dim);
  const fieldNames = Object.keys(o.fields || {});
  const atGp = (e, q) => { const f = {}; for (const k of fieldNames) { let s = 0; for (let a = 0; a < npe; a++) s += q.N[a] * o.fields[k][M.conn[e * npe + a]]; f[k] = s; } return f; };
  /** The strain–displacement matrix at the point (rows: the reduced Voigt). */
  function strainB(npe_) {
    Bm.fill(0);
    for (let a = 0; a < npe_; a++) {
      const c = a * dim, gx = dNdx[a * dim], gy = dNdx[a * dim + 1], gz = dim === 3 ? dNdx[a * dim + 2] : 0;
      if (dim === 2) {
        Bm[0 * npe * 2 + c] = gx; Bm[1 * npe * 2 + c + 1] = gy; Bm[2 * npe * 2 + c] = gy; Bm[2 * npe * 2 + c + 1] = gx;
      } else {
        const L = npe * 3;
        Bm[0 * L + c] = gx; Bm[1 * L + c + 1] = gy; Bm[2 * L + c + 2] = gz;
        Bm[3 * L + c + 1] = gz; Bm[3 * L + c + 2] = gy;   // yz
        Bm[4 * L + c] = gz; Bm[4 * L + c + 2] = gx;       // xz
        Bm[5 * L + c] = gy; Bm[5 * L + c + 1] = gx;       // xy
      }
    }
  }
  const ne = npe * dim, ke = new Float64Array(ne * ne), fe = new Float64Array(ne), DB = new Float64Array(nv * ne);
  for (let e = 0; e < M.E; e++) {
    const m = M.mat[e], { D, sel } = red[m];
    ke.fill(0); fe.fill(0);
    for (let qi = 0; qi < rule.length; qi++) { const q = rule[qi];
      const { det, x } = mpJac(M, e, q, dNdx), W0 = q.w * det;
      // (a stiffness scaled at the point: a modulus that goes with the water, a creep step's relaxed stiffness)
      const sc = o.scale ? o.scale(m, x, atGp(e, q), e, qi) : 1, W = W0 * sc;
      strainB(npe);
      for (let i = 0; i < nv; i++) for (let c = 0; c < ne; c++) { let s = 0; for (let k = 0; k < nv; k++) s += D[i][k] * Bm[k * ne + c]; DB[i * ne + c] = s; }
      for (let r = 0; r < ne; r++) for (let c = 0; c < ne; c++) { let s = 0; for (let k = 0; k < nv; k++) s += Bm[k * ne + r] * DB[k * ne + c]; ke[r * ne + c] += s * W; }
      if (o.eig) {
        const e6 = o.eig(m, x, atGp(e, q), e, qi), es = sel.map(i => e6[i]);
        // plane strain: the eigenstrain along z still pushes in the plane (σ = C (ε − ε*), εzz = 0)
        const extra = dim === 2 && (o.plane || 'strain') === 'strain' ? Cm[m] : null;
        for (let r = 0; r < ne; r++) {
          let s = 0;
          for (let i = 0; i < nv; i++) {
            let si = 0; for (let k = 0; k < nv; k++) si += D[i][k] * es[k];
            if (extra) si += extra[sel[i]][2] * e6[2];
            s += Bm[i * ne + r] * si;
          }
          fe[r] += s * W;
        }
      }
      if (o.body) { const b = o.body(m, x); for (let a = 0; a < npe; a++) for (let d = 0; d < dim; d++) fe[a * dim + d] += q.N[a] * b[d] * W0; }
    }
    for (let a = 0; a < npe; a++) for (let d = 0; d < dim; d++) {
      const i = M.conn[e * npe + a] * dim + d; R[i] += fe[a * dim + d];
      for (let b = 0; b < npe; b++) for (let d2 = 0; d2 < dim; d2++) mpAdd(B, i, M.conn[e * npe + b] * dim + d2, ke[(a * dim + d) * ne + b * dim + d2]);
    }
  }
  // tractions and pressures
  for (const bc of o.bc || []) {
    if (!(bc.traction || bc.pressure)) continue;
    const F = mpFaceElems(M, bc.face);
    for (const e of F.elems) for (const fp of mpFacePoints(M, e, F.axis, F.side, nq)) {
      const t = bc.traction ? bc.traction(fp.x) : fp.n.map(v => -v * bc.pressure(fp.x));
      for (let a = 0; a < npe; a++) for (let d = 0; d < dim; d++) R[M.conn[e * npe + a] * dim + d] += fp.N[a] * t[d] * fp.w;
    }
  }
  const raw = { ...B, a: Float64Array.from(B.a) }, R0 = Float64Array.from(R);   // for the reactions
  const fixed = [];
  for (const bc of o.bc || []) {
    if (!bc.fix) continue;
    const nodes = bc.node !== undefined ? [bc.node] : mpFaceNodes(M, bc.face);
    for (const n of nodes) {
      const x = Array.from(M.X.subarray(n * dim, n * dim + dim)), v = bc.value ? bc.value(x) : null;
      for (const c of bc.fix) { const d = n * dim + c; mpFix(B, R, d, v ? v[c] : 0); fixed.push(d); }
    }
  }
  mpFactor(B);
  const u = mpBackSolve(B, R);
  // strain and stress at the Gauss points, averaged to the nodes
  const strain = new Float64Array(N * 6), stress = new Float64Array(N * 6), cnt = new Float64Array(N), gp = [];
  for (let e = 0; e < M.E; e++) {
    const m = M.mat[e], { sel, cz } = red[m], C = Cm[m];
    const em = new Float64Array(6), sm = new Float64Array(6);
    for (let qi = 0; qi < rule.length; qi++) { const q = rule[qi];
      const { x } = mpJac(M, e, q, dNdx);
      strainB(npe);
      const ev = new Float64Array(6);
      for (let i = 0; i < nv; i++) { let s = 0; for (let a = 0; a < npe; a++) for (let d = 0; d < dim; d++) s += Bm[i * ne + a * dim + d] * u[M.conn[e * npe + a] * dim + d]; ev[sel[i]] = s; }
      const e6 = o.eig ? o.eig(m, x, atGp(e, q), e, qi) : [0, 0, 0, 0, 0, 0];
      if (dim === 2 && cz) { let s = e6[2]; for (let k = 0; k < 3; k++) s += cz[k] * (ev[sel[k]] - e6[sel[k]]); ev[2] = s; }   // plane stress: εzz
      const el = ev.map((v, i) => v - e6[i]), sv = new Float64Array(6), sc = o.scale ? o.scale(m, x, atGp(e, q), e, qi) : 1;
      for (let i = 0; i < 6; i++) { let s = 0; for (let k = 0; k < 6; k++) s += C[i][k] * el[k]; sv[i] = s * sc; }
      if (dim === 2) { sv[3] = sv[4] = 0; if (cz) sv[2] = 0; }
      gp.push({ e, qi, x, stress: sv, strain: ev, elastic: el });
      for (let i = 0; i < 6; i++) { em[i] += ev[i] / rule.length; sm[i] += sv[i] / rule.length; }
    }
    for (let a = 0; a < npe; a++) { const n = M.conn[e * npe + a]; cnt[n]++; for (let i = 0; i < 6; i++) { strain[n * 6 + i] += em[i]; stress[n * 6 + i] += sm[i]; } }
  }
  for (let n = 0; n < N; n++) for (let i = 0; i < 6; i++) { strain[n * 6 + i] /= cnt[n]; stress[n * 6 + i] /= cnt[n]; }
  const vm = new Float64Array(N), s1 = new Float64Array(N);
  for (let n = 0; n < N; n++) { const s = stress.subarray(n * 6, n * 6 + 6); vm[n] = mpVonMises(s); s1[n] = mpPrincipal(s)[0]; }
  /** The force the supports put on the body through a face (per component; per unit depth in 2D). */
  const Ku = mpBandMul(raw, u);
  function reaction(face) {
    const f = new Float64Array(dim);
    for (const n of mpFaceNodes(M, face)) for (let d = 0; d < dim; d++) f[d] += Ku[n * dim + d] - R0[n * dim + d];
    return Array.from(f);
  }
  return { u, strain, stress, gp, vm, s1, M, reaction };
}

/** Von Mises of a Voigt stress. */
const mpVonMises = s => Math.sqrt(0.5 * ((s[0] - s[1]) ** 2 + (s[1] - s[2]) ** 2 + (s[2] - s[0]) ** 2) + 3 * (s[3] * s[3] + s[4] * s[4] + s[5] * s[5]));
/** The principal stresses of a Voigt stress, largest first (the symmetric 3 × 3's eigenvalues, trigonometric). */
function mpPrincipal(s) {
  const [a, b, c, d, e, f] = s;   // xx yy zz yz xz xy
  const p1 = f * f + e * e + d * d, q = (a + b + c) / 3;
  if (p1 < 1e-30 * (a * a + b * b + c * c + 1e-300)) return [a, b, c].sort((x, y) => y - x);
  const p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1, p = Math.sqrt(p2 / 6);
  const B = [(a - q) / p, f / p, e / p, f / p, (b - q) / p, d / p, e / p, d / p, (c - q) / p];
  const detB = B[0] * (B[4] * B[8] - B[5] * B[7]) - B[1] * (B[3] * B[8] - B[5] * B[6]) + B[2] * (B[3] * B[7] - B[4] * B[6]);
  const r = Math.max(-1, Math.min(1, detB / 2)), phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi), e3 = q + 2 * p * Math.cos(phi + 2 * Math.PI / 3);
  return [e1, 3 * q - e1 - e3, e3];
}

// ---- a film through its thickness (1D) ----

/**
 * The laminate on a 1D mesh of the thickness (x of the mesh is z, up): each layer in-plane isotropic, stiffness
 * Q (m) (biaxial: E_p / (1 − ν_p); a strip bent one way: E_p / (1 − ν_p²) for the width held, E_p alone for a beam),
 * against the in-plane eigenstrain epsStar (m, z, f) (f: the fields at the point).
 * o: { Q (m) → modulus, epsStar, fields, hold: 'free' (curls: ε0 and κ from N = M = 0) | 'flat' (κ = 0, N = 0) |
 *      'clamped' (ε0 = eps0, κ = 0), eps0, N, Mo (applied force and moment per width) }.
 * The strain in the plane is ε0 + κ z (film.js's convention: κ > 0 stretches the top, convex: it curls away from its
 * top). Returns { eps0, kappa (1/m), sigma [{ z, s }] (at the Gauss points), zn, sn (at each element's ends: the
 * stress either side of a layer's boundary), A, Bc, D, N, M }.
 */
function mpLaminate(M, o) {
  if (M.dim !== 1) throw new Error('mp-core: mpLaminate takes a 1D mesh of the thickness');
  const npe = M.npe, nq = M.p + 2, rule = mpRule(M.p, 1, nq), dN = new Float64Array(npe);
  let A = 0, Bc = 0, D = 0, Ns = 0, Ms = 0;
  const fieldNames = Object.keys(o.fields || {});
  const pts = [];
  for (let e = 0; e < M.E; e++) {
    const m = M.mat[e];
    for (const q of rule) {
      const { det, x } = mpJac(M, e, q, dN), W = q.w * det, z = x[0];
      const f = {}; for (const k of fieldNames) { let s = 0; for (let a = 0; a < npe; a++) s += q.N[a] * o.fields[k][M.conn[e * npe + a]]; f[k] = s; }
      const Q = mpVal(o.Q, m), es = o.epsStar ? o.epsStar(m, z, f) : 0;
      A += Q * W; Bc += Q * z * W; D += Q * z * z * W; Ns += Q * es * W; Ms += Q * es * z * W;
      pts.push({ e, m, z, Q, es });
    }
  }
  const Nx = o.N || 0, Mx = o.Mo || 0, hold = o.hold || 'free';
  let eps0, kappa;
  // σ = Q (ε0 + κ z − ε*): N = A ε0 + Bc κ − Ns, M = Bc ε0 + D κ − Ms
  if (hold === 'free') {
    const det = A * D - Bc * Bc, n = Nx + Ns, mm = Mx + Ms;
    eps0 = (D * n - Bc * mm) / det; kappa = (A * mm - Bc * n) / det;
  } else if (hold === 'flat') { kappa = 0; eps0 = (Nx + Ns) / A; }
  else { kappa = 0; eps0 = o.eps0 || 0; }
  const sigma = pts.map(p => ({ z: p.z, s: p.Q * (eps0 + kappa * p.z - p.es) }));
  // at each element's ends (the stress either side of a layer's boundary)
  const zn = [], sn = [];
  for (let e = 0; e < M.E; e++) for (const s of [-1, 1]) {
    const S = mpShape(M.p, 1, [s]); let z = 0; const f = {};
    for (let a = 0; a < npe; a++) z += S.N[a] * M.X[M.conn[e * npe + a]];
    for (const k of fieldNames) { let v = 0; for (let a = 0; a < npe; a++) v += S.N[a] * o.fields[k][M.conn[e * npe + a]]; f[k] = v; }
    const m = M.mat[e], Q = mpVal(o.Q, m), es = o.epsStar ? o.epsStar(m, z, f) : 0;
    zn.push(z); sn.push(Q * (eps0 + kappa * z - es));
  }
  return { eps0, kappa, sigma, zn, sn, A, Bc, D, N: A * eps0 + Bc * kappa - Ns, M: Bc * eps0 + D * kappa - Ms };
}

if (typeof module !== 'undefined') module.exports = {
  MP_SIGMA, MP_GAUSS, mpLag1, mpShape, mpRule, mpAxisEdges, mpMesh, mpFaceNodes, mpFaceElems, mpJac, mpFacePoints,
  mpBand, mpBandwidth, mpFactor, mpBackSolve, mpBandMul, mpFix, mpTransport, mpScalar, mpHeatMoisture, mpAt, mpStiffness, mpInv6, mpReduce, mpElastic,
  mpVonMises, mpPrincipal, mpLaminate,
};
