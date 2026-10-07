/*
 * um-fe.validate.js — checks of um-fe.js (the element library) against exact results.
 * Run: node um-fe.validate.js
 *  1. Every element's functions: one at their own node and zero at the others; they sum to one and their slopes to zero
 *     everywhere; the slopes match finite differences of the functions.
 *  2. Completeness: each element reproduces the polynomials of its order exactly (the full degree p on a simplex, degree
 *     p along each axis on a tensor element).
 *  3. Quadrature: Gauss with n points integrates degree 2n − 1 exactly on [−1, 1], and the tensor rules every product of
 *     those; the triangle and tetrahedron rules every monomial up to their degree (1, 2, 5), with positive weights and
 *     every point inside; the prism rules every product of the triangle's degree and the same degree along ζ.
 *  4. Faces: each face's functions are the element's own on that face (the element's functions at a face point are the
 *     face's on the face's nodes and zero elsewhere); each face's area on the reference element; `out` gives the outward
 *     normal.
 *  5. The divergence theorem on curved elements (a hex27, a tet10 and a wedge18 with every node moved): the volume by the element's
 *     rule equals a third of the flux of x through its faces by the face rules, to round-off.
 *  6. The geometry: a parallelepiped's volume and inverse Jacobian exact; ufeGeometry and ufeJac agree on a curved
 *     element.
 *  7. The tables the three 3D solvers have always used (feed-fem.js's FF_REF, cfd-fem3d.js's points and face rules,
 *     mp-core.js's rules, feed-mesh.js's faces), written out here again by their own formulas: the library's are the same
 *     to the last bit.
 *  8. The common mesh form: feed-mesh.js's and mp-core.js's meshes read as one, their volumes exact.
 */
const U = require('../engine/um-fe.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const TYPES = ['line2', 'line3', 'quad4', 'quad9', 'tri3', 'tri6', 'hex8', 'hex27', 'tet4', 'tet10', 'wedge6', 'wedge18'];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
/** A random point inside the reference element. */
function inside(E) {
  if (E.kind === 'tensor') return Array.from({ length: E.dim }, () => 2 * rnd() - 1);
  if (E.kind === 'prism') for (;;) { const a = rnd(), b = rnd(); if (a + b < 1) return [a, b, 2 * rnd() - 1]; }
  for (;;) { const p = Array.from({ length: E.dim }, () => rnd()); if (p.reduce((a, b) => a + b, 0) < 1) return p; }
}
const fact = n => (n <= 1 ? 1 : n * fact(n - 1));

// 1. the functions: Kronecker at the nodes, partition of unity, slopes against finite differences
{
  let wKron = 0, wSum = 0, wDsum = 0, wFd = 0;
  for (const t of TYPES) {
    const E = U.ufeElement(t), dim = E.dim;
    for (let b = 0; b < E.npe; b++) { const S = U.ufeShape(t, Array.from(E.xi.subarray(b * dim, b * dim + dim))); for (let a = 0; a < E.npe; a++) wKron = Math.max(wKron, Math.abs(S.N[a] - (a === b ? 1 : 0))); }
    for (let k = 0; k < 20; k++) {
      const x = inside(E), S = U.ufeShape(t, x);
      wSum = Math.max(wSum, Math.abs(S.N.reduce((a, b) => a + b, 0) - 1));
      for (let d = 0; d < dim; d++) {
        let s = 0; for (let a = 0; a < E.npe; a++) s += S.dN[a * dim + d];
        wDsum = Math.max(wDsum, Math.abs(s));
        const h = 1e-6, xp = x.slice(), xm = x.slice(); xp[d] += h; xm[d] -= h;
        const Sp = U.ufeShape(t, xp), Sm = U.ufeShape(t, xm);
        for (let a = 0; a < E.npe; a++) wFd = Math.max(wFd, Math.abs((Sp.N[a] - Sm.N[a]) / (2 * h) - S.dN[a * dim + d]));
      }
    }
  }
  check('every element: one at its own node, zero at the others', wKron < 1e-15, `worst ${wKron.toExponential(1)}`);
  check('every element: the functions sum to one and their slopes to zero, everywhere', wSum < 1e-14 && wDsum < 1e-13, `worst ${wSum.toExponential(1)}, ${wDsum.toExponential(1)}`);
  check('every element: the slopes match finite differences of the functions', wFd < 1e-8, `worst ${wFd.toExponential(1)}`);
}

// 2. completeness: the polynomials of the element's order interpolated exactly
{
  const rows = [];
  for (const t of TYPES) {
    const E = U.ufeElement(t), dim = E.dim, p = E.p;
    // the monomials the element must reproduce: simplex x^i y^j z^k with i + j + k ≤ p; tensor each exponent ≤ p; prism
    // i + j ≤ p (the triangle's) and k ≤ p (the line's)
    const mons = [];
    for (let i = 0; i <= p; i++) for (let j = 0; j <= (dim > 1 ? p : 0); j++) for (let k = 0; k <= (dim > 2 ? p : 0); k++)
      if (E.kind === 'tensor' || (E.kind === 'prism' ? i + j <= p : i + j + k <= p)) mons.push([i, j, k]);
    let worst = 0, worstD = 0;
    for (const [i, j, k] of mons) {
      const f = x => x[0] ** i * (dim > 1 ? x[1] ** j : 1) * (dim > 2 ? x[2] ** k : 1);
      const df = (x, d) => { const e = [i, j, k][d]; if (!e) return 0; const y = x.slice(); let v = e; for (let c = 0; c < dim; c++) v *= c === d ? y[c] ** (e - 1) : y[c] ** [i, j, k][c]; return v; };
      const fn = []; for (let a = 0; a < E.npe; a++) fn.push(f(Array.from(E.xi.subarray(a * dim, a * dim + dim))));
      for (let q = 0; q < 10; q++) {
        const x = inside(E), S = U.ufeShape(t, x);
        let v = 0; for (let a = 0; a < E.npe; a++) v += S.N[a] * fn[a];
        worst = Math.max(worst, Math.abs(v - f(x)));
        for (let d = 0; d < dim; d++) { let g = 0; for (let a = 0; a < E.npe; a++) g += S.dN[a * dim + d] * fn[a]; worstD = Math.max(worstD, Math.abs(g - df(x, d))); }
      }
    }
    rows.push(`${t} ${mons.length} monomials ${worst.toExponential(0)}/${worstD.toExponential(0)}`);
    if (!(worst < 1e-14 && worstD < 1e-13)) { check(`${t}: its polynomials reproduced exactly`, false, `${worst}, ${worstD}`); }
  }
  check('every element reproduces the polynomials of its order exactly (values and slopes)', true, rows.join('; '));
}

// 3. quadrature exactness
{
  // Gauss n on [−1, 1]: ∫ x^k = 2/(k+1) for even k, 0 for odd, exact up to k = 2n − 1
  let worst = 0;
  for (let n = 1; n <= 5; n++) {
    const R = U.ufeRule('line2', n);
    for (let k = 0; k <= 2 * n - 1; k++) { let s = 0; for (let q = 0; q < R.nq; q++) s += R.w[q] * R.xi[q] ** k; worst = Math.max(worst, Math.abs(s - (k % 2 ? 0 : 2 / (k + 1)))); }
  }
  check('Gauss with n points (1 … 5) integrates degree 2n − 1 exactly on [−1, 1]', worst < 1e-15, `worst ${worst.toExponential(1)}`);
  // tensor rules: every product x^i y^j z^k with each exponent ≤ 2n − 1
  worst = 0;
  for (const [t, n] of [['quad9', 3], ['hex27', 3], ['hex27', 2], ['quad4', 4], ['hex8', 5]]) {
    const R = U.ufeRule(t, n), dim = R.dim, m = 2 * n - 1, I1 = k => (k % 2 ? 0 : 2 / (k + 1));
    for (let i = 0; i <= m; i++) for (let j = 0; j <= m; j++) for (let k = 0; k <= (dim > 2 ? m : 0); k++) {
      let s = 0; for (let q = 0; q < R.nq; q++) s += R.w[q] * R.xi[q * dim] ** i * R.xi[q * dim + 1] ** j * (dim > 2 ? R.xi[q * dim + 2] ** k : 1);
      worst = Math.max(worst, Math.abs(s - I1(i) * I1(j) * (dim > 2 ? I1(k) : 1)));
    }
  }
  check('the tensor rules integrate every product of those degrees exactly (quadrilateral, hexahedron)', worst < 1e-14, `worst ${worst.toExponential(1)}`);
  // simplex rules: ∫ x^i y^j over the triangle = i! j! / (i + j + 2)!; over the tetrahedron x^i y^j z^k: i! j! k! / (i + j + k + 3)!
  const rows = [];
  for (const [t, deg] of [['tri3', 1], ['tri3', 2], ['tri3', 5], ['tet4', 1], ['tet4', 2], ['tet4', 5]]) {
    const R = U.ufeRule(t, deg), dim = R.dim;
    let w = 0, nm = 0;
    for (let i = 0; i <= deg; i++) for (let j = 0; j <= deg - i; j++) for (let k = 0; k <= (dim > 2 ? deg - i - j : 0); k++) {
      let s = 0; for (let q = 0; q < R.nq; q++) s += R.w[q] * R.xi[q * dim] ** i * R.xi[q * dim + 1] ** j * (dim > 2 ? R.xi[q * dim + 2] ** k : 1);
      const ex = dim > 2 ? fact(i) * fact(j) * fact(k) / fact(i + j + k + 3) : fact(i) * fact(j) / fact(i + j + 2);
      w = Math.max(w, Math.abs(s / ex - 1)); nm++;
    }
    let pos = true, ins = true;
    for (let q = 0; q < R.nq; q++) { if (!(R.w[q] > 0)) pos = false; let s = 0; for (let d = 0; d < dim; d++) { const v = R.xi[q * dim + d]; if (!(v > 0)) ins = false; s += v; } if (!(s < 1)) ins = false; }
    rows.push(`${t.slice(0, 3)} degree ${deg} (${R.nq} points): ${nm} monomials within ${w.toExponential(0)}`);
    if (!(w < 1e-13 && pos && ins)) check(`${t} rule of degree ${deg}`, false, `${w}, weights positive ${pos}, inside ${ins}`);
  }
  check('the triangle and tetrahedron rules integrate every monomial up to their degree; weights positive, points inside', true, rows.join('; '));
  // prisms: ∫ x^i y^j z^k = i! j! / (i + j + 2)! × ∫ z^k over [−1, 1], i + j and k up to the degree (1, 2, 5)
  const prow = [];
  for (const deg of [1, 2, 5]) {
    const R = U.ufeRule('wedge18', deg); let w = 0, nm = 0, pos = true, ins = true;
    for (let i = 0; i <= deg; i++) for (let j = 0; j <= deg - i; j++) for (let k = 0; k <= deg; k++) {
      let s = 0; for (let q = 0; q < R.nq; q++) s += R.w[q] * R.xi[3 * q] ** i * R.xi[3 * q + 1] ** j * R.xi[3 * q + 2] ** k;
      const ex = fact(i) * fact(j) / fact(i + j + 2) * (k % 2 ? 0 : 2 / (k + 1)); w = Math.max(w, Math.abs(s - ex)); nm++;
    }
    for (let q = 0; q < R.nq; q++) { if (!(R.w[q] > 0)) pos = false; if (!(R.xi[3 * q] > 0 && R.xi[3 * q + 1] > 0 && R.xi[3 * q] + R.xi[3 * q + 1] < 1 && Math.abs(R.xi[3 * q + 2]) < 1)) ins = false; }
    prow.push(`degree ${deg} (${R.nq} points): ${nm} monomials within ${w.toExponential(0)}`);
    if (!(w < 1e-14 && pos && ins)) check(`prism rule of degree ${deg}`, false, `${w}, weights positive ${pos}, inside ${ins}`);
  }
  check('the prism rules (the triangle\'s times Gauss along ζ) integrate every monomial up to their degree in each; weights positive, points inside', true, prow.join('; '));
}

// 4. faces: the element's functions on a face are the face's own; areas; the outward flag
{
  let wTrace = 0, wArea = 0, bad = [];
  for (const t of ['hex8', 'hex27', 'tet4', 'tet10', 'wedge6', 'wedge18']) {
    const E = U.ufeElement(t);
    E.faces.forEach((F, f) => {
      const R = U.ufeFaceRule(t, f, F.type.startsWith('tri') ? 5 : 3), FE = U.ufeElement(F.type);
      let area = 0;
      for (const P of R) {
        for (let a = 0; a < E.npe; a++) { const k = F.nodes.indexOf(a); wTrace = Math.max(wTrace, Math.abs(P.el.N[a] - (k >= 0 ? P.N2[k] : 0))); }
        // the face's tangents from the reference nodes, and its area element
        const ts = [0, 0, 0], tt = [0, 0, 0];
        for (let k = 0; k < FE.npe; k++) for (let d = 0; d < 3; d++) { ts[d] += P.Ns[k] * E.xi[F.nodes[k] * 3 + d]; tt[d] += P.Nt[k] * E.xi[F.nodes[k] * 3 + d]; }
        const c = [ts[1] * tt[2] - ts[2] * tt[1], ts[2] * tt[0] - ts[0] * tt[2], ts[0] * tt[1] - ts[1] * tt[0]];
        area += P.w * Math.hypot(...c);
        // outward: from the element's centre toward the face point
        const ctr = E.kind === 'tensor' ? [0, 0, 0] : E.kind === 'prism' ? [1 / 3, 1 / 3, 0] : [0.25, 0.25, 0.25], o = [0, 1, 2].map(d => P.xi[d] - ctr[d]);
        if (Math.sign(F.out * (c[0] * o[0] + c[1] * o[1] + c[2] * o[2])) !== 1) bad.push(`${t} face ${f}`);
      }
      const exact = E.kind === 'tensor' ? 4 : E.kind === 'prism' ? [0.5, 0.5, 2, 2 * Math.SQRT2, 2][f] : f === 1 ? Math.sqrt(3) / 2 : 0.5;
      wArea = Math.max(wArea, Math.abs(area - exact));
    });
  }
  check('each face: the element\'s functions there are the face\'s own on its nodes, zero elsewhere', wTrace < 1e-15, `worst ${wTrace.toExponential(1)}`);
  check('each face\'s area on the reference element (4 on a hexahedron; ½ and √3/2 on the tetrahedron; ½, 2 and 2√2 on the prism)', wArea < 1e-14, `worst ${wArea.toExponential(1)}`);
  check('each face\'s `out` gives the outward normal (hexahedra, tetrahedra and prisms, every face point)', bad.length === 0, bad.join(', '));
}

/** A curved element: the reference nodes mapped through a smooth bend, then each node moved a little at random. */
function curved(t, scale = 1e-3) {
  const E = U.ufeElement(t), X = [], Y = [], Z = [];
  for (let a = 0; a < E.npe; a++) {
    const [x, y, z] = [0, 1, 2].map(d => E.xi[a * 3 + d]);
    X.push(scale * (x + 0.15 * Math.sin(1.3 * y + 0.4) + 0.05 * (rnd() - 0.5)));
    Y.push(scale * (1.2 * y + 0.1 * x * z + 0.05 * (rnd() - 0.5)));
    Z.push(scale * (0.9 * z + 0.12 * Math.cos(x) + 0.05 * (rnd() - 0.5)));
  }
  return { E, X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z), conn: Int32Array.from(E.xi.length / 3 === E.npe ? [...Array(E.npe).keys()] : []) };
}

// 5. the divergence theorem on curved elements: V = (1/3) ∮ x · n dA
{
  const rows = [];
  for (const [t, nv, nf] of [['hex27', 3, 3], ['hex8', 2, 2], ['tet10', 5, 5], ['tet4', 1, 1], ['wedge18', 5, 5], ['wedge6', 2, 2]]) {
    const C = curved(t), T = U.ufeTable(t, nv), G = U.ufeGeometry(T, C.X, C.Y, C.Z, C.conn, 1);
    let V = 0; for (let q = 0; q < T.nq; q++) V += G.geo[q * 10 + 9];
    let flux = 0;
    C.E.faces.forEach((F, f) => {
      for (const P of U.ufeFaceRule(t, f, F.type.startsWith('quad') && C.E.kind === 'prism' ? Math.min(nf, 3) : nf)) {
        const ts = [0, 0, 0], tt = [0, 0, 0], x = [0, 0, 0], FE = U.ufeElement(F.type);
        for (let k = 0; k < FE.npe; k++) { const n = F.nodes[k], p = [C.X[n], C.Y[n], C.Z[n]]; for (let d = 0; d < 3; d++) { ts[d] += P.Ns[k] * p[d]; tt[d] += P.Nt[k] * p[d]; x[d] += P.N2[k] * p[d]; } }
        const c = [ts[1] * tt[2] - ts[2] * tt[1], ts[2] * tt[0] - ts[0] * tt[2], ts[0] * tt[1] - ts[1] * tt[0]];
        flux += F.out * P.w * (x[0] * c[0] + x[1] * c[1] + x[2] * c[2]);
      }
    });
    const err = Math.abs(flux / 3 / V - 1);
    rows.push(`${t} ${err.toExponential(1)}`);
    if (!(err < 1e-13)) check(`${t}: the divergence theorem`, false, `${V} against ${flux / 3}`);
  }
  check('curved elements (every node moved): the volume equals a third of the flux of x through the faces', true, rows.join('; '));
}

// 6. geometry: a parallelepiped exact; ufeGeometry against ufeJac on a curved element
{
  const A = [[2e-3, 0.3e-3, 0.1e-3], [0.2e-3, 1e-3, -0.1e-3], [0.1e-3, 0.2e-3, 1.5e-3]], E = U.ufeElement('hex27');
  const X = new Float64Array(27), Y = new Float64Array(27), Z = new Float64Array(27);
  for (let a = 0; a < 27; a++) { const p = [0, 1, 2].map(d => E.xi[a * 3 + d]); X[a] = A[0][0] * p[0] + A[0][1] * p[1] + A[0][2] * p[2]; Y[a] = A[1][0] * p[0] + A[1][1] * p[1] + A[1][2] * p[2]; Z[a] = A[2][0] * p[0] + A[2][1] * p[1] + A[2][2] * p[2]; }
  const T = U.ufeTable('hex27', 3), G = U.ufeGeometry(T, X, Y, Z, Int32Array.from([...Array(27).keys()]), 1);
  const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  let V = 0, wI = 0;
  for (let q = 0; q < 27; q++) {
    V += G.geo[q * 10 + 9];
    // ∂N/∂x from the stored inverse applied to the map's own derivatives must give the identity: Σ_a x_a ∂N_a/∂x_c = δ
    for (const [c, P] of [[0, X], [1, Y], [2, Z]]) for (let r = 0; r < 3; r++) {
      let s = 0; for (let a = 0; a < 27; a++) s += P[a] * (T.Na[q * 27 + a] * G.geo[q * 10 + r] + T.Nb[q * 27 + a] * G.geo[q * 10 + 3 + r] + T.Ng[q * 27 + a] * G.geo[q * 10 + 6 + r]);
      wI = Math.max(wI, Math.abs(s - (c === r ? 1 : 0)));
    }
  }
  check('a parallelepiped: volume 8 det A, and ∂x/∂x = I at every point', Math.abs(V / (8 * det) - 1) < 1e-14 && wI < 1e-13, `${(V / (8 * det) - 1).toExponential(1)}, ${wI.toExponential(1)}`);
  const C = curved('hex27'), Gc = U.ufeGeometry(U.ufeTable('hex27', 3), C.X, C.Y, C.Z, C.conn, 1), pts = U.ufePoints('hex27', 3);
  const Mi = { dim: 3, npe: 27, conn: C.conn, X: new Float64Array(81) }; for (let a = 0; a < 27; a++) { Mi.X[3 * a] = C.X[a]; Mi.X[3 * a + 1] = C.Y[a]; Mi.X[3 * a + 2] = C.Z[a]; }
  let wd = 0, wg = 0; const dNdx = new Float64Array(81);
  pts.forEach((P, q) => {
    const r = U.ufeJac(Mi, 0, P, dNdx); wd = Math.max(wd, Math.abs(r.det * P.w / Gc.geo[q * 10 + 9] - 1));
    for (let a = 0; a < 27; a++) for (let c = 0; c < 3; c++) { const g = Gc.geo.subarray(q * 10, q * 10 + 10), v = P.Na[a] * g[c] + P.Nb[a] * g[3 + c] + P.Ng[a] * g[6 + c]; wg = Math.max(wg, Math.abs(v - dNdx[a * 3 + c]) * 1e-3); }
  });
  check('a curved hex27: the stored geometry and the general Jacobian agree (det J, ∂N/∂x)', wd < 1e-13 && wg < 1e-12, `${wd.toExponential(1)}, ${wg.toExponential(1)}`);
}

// 7. bit for bit: the tables the solvers have always used, by their own formulas
{
  const same = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const G3 = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], W3 = [5 / 9, 8 / 9, 5 / 9];
  const q2 = s => [s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], dq2 = s => [s - 0.5, -2 * s, s + 0.5], q1 = s => [(1 - s) / 2, (1 + s) / 2];
  // feed-fem.js's and cfd-fem3d.js's element at 3 × 3 × 3 Gauss (ζ slowest), Q1 pressure
  const pts = U.ufePoints('hex27', 3, 'hex8'), T = U.ufeTable('hex27', 3, 'hex8');
  let ok = true, q = 0;
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++, q++) {
    const A = q2(G3[i]), B = q2(G3[j]), C = q2(G3[k]), dA = dq2(G3[i]), dB = dq2(G3[j]), dC = dq2(G3[k]), N = [], Na = [], Nb = [], Ng = [], P = [];
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { N.push(A[a] * B[b] * C[g]); Na.push(dA[a] * B[b] * C[g]); Nb.push(A[a] * dB[b] * C[g]); Ng.push(A[a] * B[b] * dC[g]); }
    const pa = q1(G3[i]), pb = q1(G3[j]), pc = q1(G3[k]);
    for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) P.push(pa[a] * pb[b] * pc[g]);
    const o = pts[q];
    ok = ok && same(o.N, N) && same(o.Na, Na) && same(o.Nb, Nb) && same(o.Ng, Ng) && same(o.P, P) && Object.is(o.w, W3[i] * W3[j] * W3[k])
      && same(T.N.subarray(q * 27, q * 27 + 27), N) && same(T.Na.subarray(q * 27, q * 27 + 27), Na) && same(T.Nb.subarray(q * 27, q * 27 + 27), Nb) && same(T.Ng.subarray(q * 27, q * 27 + 27), Ng) && same(T.P.subarray(q * 8, q * 8 + 8), P) && Object.is(T.W[q], W3[i] * W3[j] * W3[k]);
  }
  const corner = []; for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) corner.push((2 * g * 3 + 2 * b) * 3 + 2 * a);
  check('feed-fem.js\'s and cfd-fem3d.js\'s Q2–Q1 element at its 27 points (N, its slopes, the Q1 pressure, weights), and the corners: the same to the last bit', ok && same(U.ufeElement('hex27').corners, corner));
  // cfd-fem3d.js's face rules: 2D Q2 on the face, s along the first free axis, and the element's functions there
  ok = true;
  for (const [f, fix, val] of [[2, 'eta', -1], [3, 'eta', 1], [0, 'xi', -1], [1, 'xi', 1], [4, 'zeta', -1], [5, 'zeta', 1]]) {
    const R = U.ufeFaceRule('hex27', f, 3, 'hex8'); let k = 0;
    for (let gt = 0; gt < 3; gt++) for (let gs = 0; gs < 3; gs++, k++) {
      const s = G3[gs], t = G3[gt], S = q2(s), Tt = q2(t), dS = dq2(s), dT = dq2(t), N2 = [], Ns = [], Nt = [];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { N2.push(S[i] * Tt[j]); Ns.push(dS[i] * Tt[j]); Nt.push(S[i] * dT[j]); }
      const xi = fix === 'eta' ? [s, val, t] : fix === 'zeta' ? [s, t, val] : [val, s, t];
      const A = q2(xi[0]), B = q2(xi[1]), C = q2(xi[2]), dA = dq2(xi[0]), dB = dq2(xi[1]), dC = dq2(xi[2]), N = [], Na = [], Nb = [], Ng = [], P = [];
      for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { N.push(A[a] * B[b] * C[g]); Na.push(dA[a] * B[b] * C[g]); Nb.push(A[a] * dB[b] * C[g]); Ng.push(A[a] * B[b] * dC[g]); }
      const pa = q1(xi[0]), pb = q1(xi[1]), pc = q1(xi[2]);
      for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) P.push(pa[a] * pb[b] * pc[g]);
      const r = R[k];
      ok = ok && Object.is(r.w, W3[gs] * W3[gt]) && same(r.N2, N2) && same(r.Ns, Ns) && same(r.Nt, Nt) && same(r.el.N, N) && same(r.el.Na, Na) && same(r.el.Nb, Nb) && same(r.el.Ng, Ng) && same(r.el.P, P);
    }
  }
  check('cfd-fem3d.js\'s six face rules (the face\'s Q2 functions, the element\'s functions and pressure there, weights): the same to the last bit', ok);
  // feed-mesh.js's faces: a = 0, 2; b = 0, 2; g = 0, 2, s fastest
  const L = (a, b, g) => (g * 3 + b) * 3 + a, face = fx => { const o = []; for (let t = 0; t < 3; t++) for (let s = 0; s < 3; s++) o.push(fx(s, t)); return o; };
  const FMF = [face((s, t) => L(0, s, t)), face((s, t) => L(2, s, t)), face((s, t) => L(s, 0, t)), face((s, t) => L(s, 2, t)), face((s, t) => L(s, t, 0)), face((s, t) => L(s, t, 2))];
  check('feed-mesh.js\'s six faces of the 27-node element (their nodes, in order)', FMF.every((F, f) => same(U.ufeElement('hex27').faces[f].nodes, F)));
  // mp-core.js's rules: Gauss literals, the x index fastest, the weight a running product, the functions likewise
  const GA = { 1: [[0], [2]], 2: [[-0.5773502691896257, 0.5773502691896257], [1, 1]], 3: [[-0.7745966692414834, 0, 0.7745966692414834], [0.5555555555555556, 0.8888888888888888, 0.5555555555555556]], 4: [[-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526], [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538]] };
  const lag = (p, s) => (p === 1 ? [[(1 - s) / 2, (1 + s) / 2], [-0.5, 0.5]] : [[s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], [s - 0.5, -2 * s, s + 0.5]]);
  ok = true; let nRules = 0;
  for (const p of [1, 2]) for (const dim of [1, 2, 3]) for (const nq of [1, 2, 3, 4, 'nodes']) {
    const type = { 1: ['line2', 'line3'], 2: ['quad4', 'quad9'], 3: ['hex8', 'hex27'] }[dim][p - 1], P = U.ufePoints(type, nq);
    const [s, w] = nq === 'nodes' ? [[-1, 1], [1, 1]] : GA[nq], m = s.length ** dim, n1 = p + 1, npe = n1 ** dim;
    for (let q = 0; q < m; q++) {
      const iq = [q % s.length, Math.floor(q / s.length) % s.length, Math.floor(q / (s.length * s.length))], xi = []; let wt = 1;
      for (let d = 0; d < dim; d++) { xi.push(s[iq[d]]); wt *= w[iq[d]]; }
      const Ls = xi.map(x => lag(p, x)), N = [], dN = [];
      for (let a = 0; a < npe; a++) {
        const ix = [a % n1, Math.floor(a / n1) % n1, Math.floor(a / (n1 * n1))];
        let v = 1; for (let d = 0; d < dim; d++) v *= Ls[d][0][ix[d]]; N.push(v);
        for (let g = 0; g < dim; g++) { let u = 1; for (let d = 0; d < dim; d++) u *= d === g ? Ls[d][1][ix[d]] : Ls[d][0][ix[d]]; dN.push(u); }
      }
      ok = ok && same(P[q].xi, xi) && Object.is(P[q].w, wt) && same(P[q].N, N) && same(P[q].dN, dN);
    }
    nRules++;
  }
  check(`mp-core.js's rules (orders 1 and 2; 1D, 2D, 3D; 1 to 4 Gauss points and the nodes' rule): the same to the last bit`, ok, `${nRules} rules`);
}

// 8. the common mesh form
{
  const FM = require('../engine/feed-mesh.js'), MP = require('../engine/mp-core.js');
  // an mp-core block (order 2, bent) read as hex27: its volume by the geometry, its six block faces
  const Mb = MP.mpMesh({ dim: 3, p: 2, axes: [[{ L: 3e-3, n: 3 }], [{ L: 1e-3, n: 2 }], [{ L: 2e-3, n: 2, grade: 2 }]] });
  const C = U.ufeMesh(Mb), G = U.ufeGeometry(U.ufeTable(C.type, 3), C.X, C.Y, C.Z, C.conn, C.nE);
  let V = 0; for (let i = 9; i < G.geo.length; i += 10) V += G.geo[i];
  const tags = {}; for (const F of C.faces) tags[F.tag] = (tags[F.tag] || 0) + 1;
  check('mp-core.js\'s block read in the common form: hex27, its volume exact, its six faces tagged', C.type === 'hex27' && Math.abs(V / 6e-9 - 1) < 1e-13 && tags.x0 === 4 && tags.x1 === 4 && tags.y0 === 6 && tags.y1 === 6 && tags.z0 === 6 && tags.z1 === 6,
    `${(V / 6e-9 - 1).toExponential(1)}; faces ${JSON.stringify(tags)}`);
  const Ml = U.ufeMesh(MP.mpMesh({ dim: 3, p: 1, axes: [{ L: 1, n: 2 }, { L: 1, n: 2 }, { L: 1, n: 2 }] }));
  check('  and of order 1: hex8', Ml.type === 'hex8' && Ml.nE === 8 && Ml.faces.length === 24);
  // feed-mesh.js's mesh: the common form is the same object's arrays
  const fm = { nN: 27, nE: 1, X: new Float64Array(27), Y: new Float64Array(27), Z: new Float64Array(27), elems: Int32Array.from([...Array(27).keys()]), faces: [{ e: 0, f: 3, tag: 'top' }] };
  const Cf = U.ufeMesh(fm);
  check('feed-mesh.js\'s mesh read in the common form: hex27, the same arrays (no copy)', Cf.type === 'hex27' && Cf.conn === fm.elems && Cf.X === fm.X && Cf.faces[0].tag === 'top' && typeof FM.fmMesh === 'function');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
