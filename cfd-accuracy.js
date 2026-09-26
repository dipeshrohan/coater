/*
 * cfd-accuracy.js — Flow › 2D, the Mesh step's "Mesh to an accuracy": a location solved, its mesh refined and
 * solved again, until the chosen outputs (the wet film, the contact line) change less than a target from one
 * mesh to the next. Two ways to refine:
 *  - adaptive: each element's error estimated from its velocity gradients against smoothed (recovered) ones
 *    (Zienkiewicz-Zhu, weighted by the viscosity: the error in the rate of viscous dissipation); the columns and
 *    rows carrying most of it are split in two (the mesh stays structured, so a column spans the gap and a row
 *    the length), a neighbour more than twice as large split too;
 *  - everywhere: every element count x1.25 and the refinement zones' sizes / 1.25, with Richardson extrapolation
 *    from the last three meshes (the error left, the grid convergence index).
 * The mesh reached can be kept as the location's own ("Adapted", or Custom with its zones), and its solution
 * taken as the location's result: the same settings solve to the same answer.
 * Pure parts (the error estimate, the refinement, Richardson) are Node-testable (cfd-accuracy.validate.js).
 */

// ---- the error estimate and the refinement (no page needed) ----
const ACC_Q2 = x => [0.5 * x * (x - 1), 1 - x * x, 0.5 * x * (x + 1)], ACC_DQ2 = x => [x - 0.5, -2 * x, x + 0.5];
const ACC_G3 = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], ACC_W3 = [5 / 9, 8 / 9, 5 / 9];
/** Element (ex, ey)'s nine nodes on a row-major grid (k = j nx + i). */
function accNodes(g, ex, ey) { const k = []; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) k.push((2 * ey + b) * g.nx + 2 * ex + a); return k; }
/** At (xi, eta) in an element: the shape values, their x and y derivatives, the Jacobian's determinant. */
function accShape(g, K, xi, et) {
  const qa = ACC_Q2(xi), qb = ACC_Q2(et), da = ACC_DQ2(xi), db = ACC_DQ2(et), N = new Array(9), Nx = new Array(9), Ny = new Array(9);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let b = 0, n = 0; b < 3; b++) for (let a = 0; a < 3; a++, n++) {
    N[n] = qa[a] * qb[b]; const d1 = da[a] * qb[b], d2 = qa[a] * db[b];
    x1 += g.gx[K[n]] * d1; x2 += g.gx[K[n]] * d2; y1 += g.gy[K[n]] * d1; y2 += g.gy[K[n]] * d2;
    Nx[n] = d1; Ny[n] = d2;
  }
  const det = x1 * y2 - x2 * y1;
  for (let n = 0; n < 9; n++) { const d1 = Nx[n], d2 = Ny[n]; Nx[n] = (y2 * d1 - y1 * d2) / det; Ny[n] = (-x2 * d1 + x1 * d2) / det; }
  return { N, Nx, Ny, det };
}
const accGrad = (g, K, S) => {
  let ux = 0, uy = 0, vx = 0, vy = 0;
  for (let n = 0; n < 9; n++) { const k = K[n]; ux += g.u[k] * S.Nx[n]; uy += g.u[k] * S.Ny[n]; vx += g.v[k] * S.Nx[n]; vy += g.v[k] * S.Ny[n]; }
  return [ux, uy, vx, vy];
};
/**
 * Each element's error estimate on a solved 9-node quadratic mesh g { nx, ny, gx, gy, u, v, mu? }
 * (Zienkiewicz-Zhu with superconvergent patch recovery): around every element corner, the elements sharing it
 * are sampled at their 2 x 2 Gauss points (where quadratics' gradients are most accurate), a quadratic in x, y
 * fitted to those gradients by least squares and taken at the patch's nodes (a node in several patches: the
 * mean); the recovered gradient against the element's own, integrated (3 x 3 Gauss) with the viscosity as
 * weight, is the element's squared error (its share of the error in the rate of dissipation).
 * Returns { eta2 (per element, ey nEx + ex), nEx, nEy, total }.
 */
function accIndicator(g) {
  const nEx = (g.nx - 1) / 2, nEy = (g.ny - 1) / 2, N = g.nx * g.ny;
  const G2 = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  // each element's gradient at its 2 x 2 Gauss points: [x, y, ux, uy, vx, vy]
  const samp = new Array(nEx * nEy);
  for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    const K = accNodes(g, ex, ey), pts = [];
    for (const et of G2) for (const xi of G2) {
      const S = accShape(g, K, xi, et), G = accGrad(g, K, S);
      let x = 0, y = 0; for (let n = 0; n < 9; n++) { x += g.gx[K[n]] * S.N[n]; y += g.gy[K[n]] * S.N[n]; }
      pts.push([x, y, ...G]);
    }
    samp[ey * nEx + ex] = pts;
  }
  const sum = new Float64Array(N * 4), cnt = new Float64Array(N);
  // patches: around each interior element corner, its four elements (16 samples for 6 terms); a node on the
  // boundary takes the values of the interior patches it is in (a patch cut by the boundary extrapolates badly)
  for (let jc = 1; jc < nEy; jc++) for (let ic = 1; ic < nEx; ic++) {
    const els = [[ic - 1, jc - 1], [ic, jc - 1], [ic - 1, jc], [ic, jc]];
    const kc = 2 * jc * g.nx + 2 * ic, x0 = g.gx[kc], y0 = g.gy[kc];
    // local coordinates scaled by the patch's extent in x and in y apart (the elements are long and thin: one
    // scale would leave the fit's y terms nearly singular)
    let hx = 0, hy = 0; for (const [ex, ey] of els) for (const q of samp[ey * nEx + ex]) { hx = Math.max(hx, Math.abs(q[0] - x0)); hy = Math.max(hy, Math.abs(q[1] - y0)); }
    hx = hx || 1; hy = hy || 1;
    const basis = (x, y) => { const a = (x - x0) / hx, b = (y - y0) / hy; return [1, a, b, a * a, a * b, b * b]; };
    const A = Array.from({ length: 6 }, () => new Float64Array(6)), B = Array.from({ length: 4 }, () => new Float64Array(6));
    for (const [ex, ey] of els) for (const q of samp[ey * nEx + ex]) {
      const P = basis(q[0], q[1]);
      for (let r = 0; r < 6; r++) { for (let c = 0; c < 6; c++) A[r][c] += P[r] * P[c]; for (let m = 0; m < 4; m++) B[m][r] += P[r] * q[2 + m]; }
    }
    const coef = accSolveN(A, B);
    if (!coef) continue;
    // the patch's nodes: every node of its elements
    const seen = new Set();
    for (const [ex, ey] of els) for (const k of accNodes(g, ex, ey)) {
      if (seen.has(k)) continue; seen.add(k);
      const P = basis(g.gx[k], g.gy[k]);
      for (let m = 0; m < 4; m++) { let v = 0; for (let r = 0; r < 6; r++) v += coef[m][r] * P[r]; sum[k * 4 + m] += v; }
      cnt[k]++;
    }
  }
  // (a node in no patch -- one element across: the elements' own gradients there, averaged)
  const nodeXi = [-1, 0, 1];
  for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    const K = accNodes(g, ex, ey);
    for (let n = 0; n < 9; n++) {
      const k = K[n];
      if (cnt[k] > 0) continue;
      const G = accGrad(g, K, accShape(g, K, nodeXi[n % 3], nodeXi[(n / 3) | 0]));
      for (let m = 0; m < 4; m++) sum[k * 4 + m] += G[m];
      cnt[k] -= 1;       // (negative: counted as an element average, not a patch)
    }
  }
  for (let k = 0; k < N; k++) for (let m = 0; m < 4; m++) sum[k * 4 + m] /= Math.abs(cnt[k]) || 1;
  const eta2 = new Float64Array(nEx * nEy);
  let total = 0;
  for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    const K = accNodes(g, ex, ey);
    let e = 0;
    for (let q = 0; q < 3; q++) for (let r = 0; r < 3; r++) {
      const S = accShape(g, K, ACC_G3[r], ACC_G3[q]), Gh = accGrad(g, K, S);
      let mu = 0, d = 0;
      for (let n = 0; n < 9; n++) mu += (g.mu ? g.mu[K[n]] : 1) * S.N[n];
      for (let c = 0; c < 4; c++) { let gs = 0; for (let n = 0; n < 9; n++) gs += sum[K[n] * 4 + c] * S.N[n]; d += (gs - Gh[c]) * (gs - Gh[c]); }
      e += Math.max(mu, 0) * d * Math.abs(S.det) * ACC_W3[r] * ACC_W3[q];
    }
    eta2[ey * nEx + ex] = e; total += e;
  }
  return { eta2, nEx, nEy, total };
}
/**
 * The next mesh: element ends (fractions of the blade, the exit face, the free surface, the rows: the solver's
 * meshFrac) with the columns and rows carrying most of the error split in two. Marked by their share of the
 * total (the largest first, until thetaCol / thetaRow of it; at most half of them, the rows at most maxRows),
 * then any element more than twice as long as a neighbour split too, so sizes change smoothly.
 * Returns { frac, cols, rows } (how many columns and rows were split).
 */
function accRefine(frac, ind, o = {}) {
  const nB = frac.b.length - 1, nF = frac.f.length - 1, nS = frac.s.length - 1, nY = frac.y.length - 1;
  if (nB + nF + nS !== ind.nEx || nY !== ind.nEy) throw new Error('the mesh and its element ends do not match');
  const col = new Float64Array(ind.nEx), row = new Float64Array(ind.nEy);
  for (let ey = 0; ey < ind.nEy; ey++) for (let ex = 0; ex < ind.nEx; ex++) { const e = ind.eta2[ey * ind.nEx + ex]; col[ex] += e; row[ey] += e; }
  const mc = accMark(col, o.thetaCol ?? 0.5, Math.ceil(0.5 * ind.nEx));
  const mr = accMark(row, o.thetaRow ?? 0.3, Math.max(0, Math.min(Math.ceil(0.5 * ind.nEy), (o.maxRows ?? 40) - ind.nEy)));
  const b = accSplit(frac.b, mc.subarray(0, nB)), f = nF ? accSplit(frac.f, mc.subarray(nB, nB + nF)) : { out: frac.f.slice(), n: 0 };
  const s = accSplit(frac.s, mc.subarray(nB + nF)), y = accSplit(frac.y, mr);
  return { frac: { b: b.out, f: f.out, s: s.out, y: y.out }, cols: b.n + f.n + s.n, rows: y.n };
}
/** Mark the largest of E until theta of their total (at most cap of them). */
function accMark(E, theta, cap) {
  const idx = [...E.keys()].sort((a, b) => E[b] - E[a]), tot = E.reduce((a, b) => a + b, 0), m = new Uint8Array(E.length);
  let acc = 0, n = 0;
  for (const k of idx) { if (acc >= theta * tot || n >= cap) break; m[k] = 1; acc += E[k]; n++; }
  return m;
}
/** Element ends E with the marked elements split in two, and any more than twice as long as a neighbour (after the split) too. */
function accSplit(E, m0) {
  const m = Uint8Array.from(m0), h = k => E[k + 1] - E[k], after = k => h(k) / (m[k] ? 2 : 1);
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let k = 0; k < m.length; k++) {
      if (m[k]) continue;
      if ((k > 0 && h(k) > 2.01 * after(k - 1)) || (k < m.length - 1 && h(k) > 2.01 * after(k + 1))) { m[k] = 1; changed = true; }
    }
    if (!changed) break;
  }
  const out = [E[0]];
  let n = 0;
  for (let k = 0; k < m.length; k++) { if (m[k]) { out.push(0.5 * (E[k] + E[k + 1])); n++; } out.push(E[k + 1]); }
  return { out, n };
}

// ---- the same in 3D: the 27-node hexahedra of a 3D solve (nodes (c NL + l) NR + k: c along the flow, l across, k up) ----
/** Hexahedron (ex, ey, ez)'s 27 nodes, ordered a (along) fastest, then b (up), then d (across). */
function accNodes3(R, ex, ey, ez) {
  const K = [];
  for (let d = 0; d < 3; d++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) K.push(((2 * ex + a) * R.NL + 2 * ez + d) * R.NR + 2 * ey + b);
  return K;
}
function accShape3(R, K, xi, et, ze) {
  const qa = ACC_Q2(xi), qb = ACC_Q2(et), qd = ACC_Q2(ze), da = ACC_DQ2(xi), db = ACC_DQ2(et), dd = ACC_DQ2(ze);
  const N = new Array(27), D = [new Array(27), new Array(27), new Array(27)], J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let d = 0, n = 0; d < 3; d++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++, n++) {
    N[n] = qa[a] * qb[b] * qd[d];
    const g1 = da[a] * qb[b] * qd[d], g2 = qa[a] * db[b] * qd[d], g3 = qa[a] * qb[b] * dd[d], x = R.x[K[n]], y = R.y[K[n]], z = R.z[K[n]];
    D[0][n] = g1; D[1][n] = g2; D[2][n] = g3;
    J[0] += x * g1; J[1] += x * g2; J[2] += x * g3; J[3] += y * g1; J[4] += y * g2; J[5] += y * g3; J[6] += z * g1; J[7] += z * g2; J[8] += z * g3;
  }
  // (J = d(x, y, z) / d(xi, eta, zeta); the shape gradients = J^-T times the local ones)
  const [a, b, c, d, e, f, g, h, i] = J, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  const inv = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  const Nx = new Array(27), Ny = new Array(27), Nz = new Array(27);
  for (let n = 0; n < 27; n++) {
    const l1 = D[0][n], l2 = D[1][n], l3 = D[2][n];
    Nx[n] = inv[0] * l1 + inv[3] * l2 + inv[6] * l3; Ny[n] = inv[1] * l1 + inv[4] * l2 + inv[7] * l3; Nz[n] = inv[2] * l1 + inv[5] * l2 + inv[8] * l3;
  }
  return { N, Nx, Ny, Nz, det };
}
const accGrad3 = (R, K, S) => {
  const G = new Array(9).fill(0);
  for (let n = 0; n < 27; n++) {
    const k = K[n], u = R.u[k], v = R.v[k], w = R.w[k];
    G[0] += u * S.Nx[n]; G[1] += u * S.Ny[n]; G[2] += u * S.Nz[n]; G[3] += v * S.Nx[n]; G[4] += v * S.Ny[n]; G[5] += v * S.Nz[n]; G[6] += w * S.Nx[n]; G[7] += w * S.Ny[n]; G[8] += w * S.Nz[n];
  }
  return G;
};
/**
 * The 3D error estimate, as accIndicator: around each interior hexahedron corner its eight hexahedra sampled at
 * 2 x 2 x 2 Gauss points, a quadratic in x, y, z (10 terms) fitted to the velocity gradients and taken at their
 * nodes; the recovered gradient against each hexahedron's own, weighted by the viscosity (3 x 3 x 3 Gauss).
 * Returns { eta2 (per hexahedron, (ez nEy + ey) nEx + ex), nEx, nEy, nEz, total }.
 */
function accIndicator3(R) {
  const nEx = (R.NC - 1) / 2, nEy = (R.NR - 1) / 2, nEz = (R.NL - 1) / 2, N = R.NC * R.NR * R.NL, G2 = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const eid = (ex, ey, ez) => (ez * nEy + ey) * nEx + ex;
  const samp = new Array(nEx * nEy * nEz);
  for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    const K = accNodes3(R, ex, ey, ez), pts = [];
    for (const zt of G2) for (const et of G2) for (const xi of G2) {
      const S = accShape3(R, K, xi, et, zt);
      let x = 0, y = 0, z = 0; for (let n = 0; n < 27; n++) { x += R.x[K[n]] * S.N[n]; y += R.y[K[n]] * S.N[n]; z += R.z[K[n]] * S.N[n]; }
      pts.push([x, y, z, ...accGrad3(R, K, S)]);
    }
    samp[eid(ex, ey, ez)] = pts;
  }
  const sum = new Float64Array(N * 9), cnt = new Float64Array(N);
  for (let lc = 1; lc < nEz; lc++) for (let jc = 1; jc < nEy; jc++) for (let ic = 1; ic < nEx; ic++) {
    const els = [];
    for (const dz of [-1, 0]) for (const dy of [-1, 0]) for (const dx of [-1, 0]) els.push([ic + dx, jc + dy, lc + dz]);
    const kc = ((2 * ic) * R.NL + 2 * lc) * R.NR + 2 * jc, x0 = R.x[kc], y0 = R.y[kc], z0 = R.z[kc];
    let hx = 0, hy = 0, hz = 0;
    for (const [ex, ey, ez] of els) for (const q of samp[eid(ex, ey, ez)]) { hx = Math.max(hx, Math.abs(q[0] - x0)); hy = Math.max(hy, Math.abs(q[1] - y0)); hz = Math.max(hz, Math.abs(q[2] - z0)); }
    hx = hx || 1; hy = hy || 1; hz = hz || 1;
    const basis = (x, y, z) => { const a = (x - x0) / hx, b = (y - y0) / hy, c = (z - z0) / hz; return [1, a, b, c, a * a, b * b, c * c, a * b, b * c, c * a]; };
    const A = Array.from({ length: 10 }, () => new Float64Array(10)), B = Array.from({ length: 9 }, () => new Float64Array(10));
    for (const [ex, ey, ez] of els) for (const q of samp[eid(ex, ey, ez)]) {
      const P = basis(q[0], q[1], q[2]);
      for (let r = 0; r < 10; r++) { for (let c = 0; c < 10; c++) A[r][c] += P[r] * P[c]; for (let m = 0; m < 9; m++) B[m][r] += P[r] * q[3 + m]; }
    }
    const coef = accSolveN(A, B);
    if (!coef) continue;
    const seen = new Set();
    for (const [ex, ey, ez] of els) for (const k of accNodes3(R, ex, ey, ez)) {
      if (seen.has(k)) continue; seen.add(k);
      const P = basis(R.x[k], R.y[k], R.z[k]);
      for (let m = 0; m < 9; m++) { let v = 0; for (let r = 0; r < 10; r++) v += coef[m][r] * P[r]; sum[k * 9 + m] += v; }
      cnt[k]++;
    }
  }
  // (a node in no patch -- one element across: the hexahedra's own gradients there, averaged)
  const nd = [-1, 0, 1];
  for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    const K = accNodes3(R, ex, ey, ez);
    for (let n = 0; n < 27; n++) {
      const k = K[n];
      if (cnt[k] > 0) continue;
      const G = accGrad3(R, K, accShape3(R, K, nd[n % 3], nd[((n / 3) | 0) % 3], nd[(n / 9) | 0]));
      for (let m = 0; m < 9; m++) sum[k * 9 + m] += G[m];
      cnt[k] -= 1;
    }
  }
  for (let k = 0; k < N; k++) for (let m = 0; m < 9; m++) sum[k * 9 + m] /= Math.abs(cnt[k]) || 1;
  const eta2 = new Float64Array(nEx * nEy * nEz);
  let total = 0;
  for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    const K = accNodes3(R, ex, ey, ez);
    let e = 0;
    for (let q = 0; q < 3; q++) for (let p = 0; p < 3; p++) for (let r = 0; r < 3; r++) {
      const S = accShape3(R, K, ACC_G3[r], ACC_G3[p], ACC_G3[q]), Gh = accGrad3(R, K, S);
      let mu = 0, d = 0;
      for (let n = 0; n < 27; n++) mu += (R.mu ? R.mu[K[n]] : 1) * S.N[n];
      for (let m = 0; m < 9; m++) { let gs = 0; for (let n = 0; n < 27; n++) gs += sum[K[n] * 9 + m] * S.N[n]; d += (gs - Gh[m]) * (gs - Gh[m]); }
      e += Math.max(mu, 0) * d * Math.abs(S.det) * ACC_W3[r] * ACC_W3[p] * ACC_W3[q];
    }
    eta2[eid(ex, ey, ez)] = e; total += e;
  }
  return { eta2, nEx, nEy, nEz, total };
}
/**
 * The next 3D mesh: the stations' element ends along the flow and up the gap (split where the hexahedra's error,
 * summed across, is largest -- as accRefine) and the element ends across (zFrac, fractions of the region; split
 * where the error summed along and up is largest, at most half, the whole at most maxZ).
 */
function accRefine3(frac, zFrac, ind, o = {}) {
  const e2 = new Float64Array(ind.nEx * ind.nEy), lay = new Float64Array(ind.nEz);
  for (let ez = 0; ez < ind.nEz; ez++) for (let ey = 0; ey < ind.nEy; ey++) for (let ex = 0; ex < ind.nEx; ex++) {
    const e = ind.eta2[(ez * ind.nEy + ey) * ind.nEx + ex]; e2[ey * ind.nEx + ex] += e; lay[ez] += e;
  }
  const r2 = accRefine(frac, { eta2: e2, nEx: ind.nEx, nEy: ind.nEy }, o);
  if (zFrac.length - 1 !== ind.nEz) throw new Error('the mesh across and its element ends do not match');
  const z = accSplit(zFrac, accMark(lay, o.thetaZ ?? 0.4, Math.max(0, Math.min(Math.ceil(0.5 * ind.nEz), (o.maxZ ?? 24) - ind.nEz))));
  return { ...r2, zFrac: z.out, layers: z.n };
}
/** A small dense system with several right-hand sides (Gaussian elimination, partial pivoting); null if singular. */
function accSolveN(A0, B0) {
  const n = A0.length, A = A0.map(r => Float64Array.from(r)), B = B0.map(r => Float64Array.from(r));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (!(Math.abs(A[p][c]) > 1e-12 * Math.abs(A0[0][0]))) return null;
    if (p !== c) { [A[p], A[c]] = [A[c], A[p]]; for (const b of B) [b[p], b[c]] = [b[c], b[p]]; }
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      for (const b of B) b[r] -= f * b[c];
    }
  }
  return B.map(b => { const x = new Float64Array(n); for (let r = n - 1; r >= 0; r--) { let v = b[r]; for (let k = r + 1; k < n; k++) v -= A[r][k] * x[k]; x[r] = v / A[r][r]; } return x; });
}
/**
 * Richardson extrapolation from three meshes (f1 the coarsest, f3 the finest; rC = h1 / h2, rF = h2 / h3, the
 * refinement ratios): the observed order p (Celik et al. 2008, for unequal ratios), the extrapolated value, and
 * the fine mesh's grid convergence index (the error band, as a fraction). null when the changes swap sign
 * (not converging monotonically: no order to find).
 */
function accRichardson(f1, f2, f3, rC, rF) {
  const eC = f2 - f1, eF = f3 - f2;
  if (!(eC * eF > 0) || Math.abs(eF) < 1e-15 * Math.abs(f3)) return null;
  const sgn = Math.sign(eC / eF);
  let p = 1;
  for (let it = 0; it < 50; it++) {
    const q = Math.log((Math.pow(rF, p) - sgn) / (Math.pow(rC, p) - sgn));
    const pn = Math.abs(Math.log(Math.abs(eC / eF)) + q) / Math.log(rF);
    if (!Number.isFinite(pn)) break;
    if (Math.abs(pn - p) < 1e-9) { p = pn; break; }
    p = pn;
  }
  p = Math.min(8, Math.max(0.3, p));
  const d = Math.pow(rF, p) - 1;
  return { p, extrapolated: f3 + eF / d, gci: 1.25 * Math.abs(eF / f3) / d };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { accIndicator, accRefine, accRichardson, accShape, accNodes, accIndicator3, accRefine3, accShape3, accNodes3, accSplit, accMark };

// ---- the page (Flow › 2D, Mesh step: the "Mesh to an accuracy" tab) ----
/** The panel's settings and the runs (each chosen location's meshes). */
const ACC = { loc: 0, method: 'adaptive', target: 0.5, film: true, cl: true, max: 5, runs: {} };
const ACC_METHODS = { adaptive: 'Adaptive: refine where the error is', everywhere: 'Refine everywhere ×1.25' };
/** A location's trial settings for a mesh k steps finer than its own everywhere (counts ×1.25^k, zone sizes ÷1.25^k). */
function accEverywhere(i, k) {
  const s = solverOf(i), g = cfdGeometry(i), f = Math.pow(1.25, k), c = scaleCounts(g.solver, f), z = zonesOf(s.zones);
  for (const [q] of ZONE_FEATURES) z[q].size = +(z[q].size / f).toPrecision(6);
  for (const [q] of ZONE_LAYERS) z[q].first = +(z[q].first / f).toPrecision(6);
  z.bands.forEach(b => { b.size = +(b.size / f).toPrecision(6); });
  return { ...s, mesh: 'custom', ...c, frac: undefined, zones: zonesActive(z) ? z : s.zones };
}
/** Run: each chosen location's loop (they run side by side, each in its own worker). */
function runAccuracy() {
  if (Object.values(ACC.runs).some(r => r.status === 'running')) return;
  if (!ACC.film && !ACC.cl) { ACC.film = true; }
  const locs = ACC.loc === 'all' ? CFD_LOCS.map((_, i) => i) : [ACC.loc];
  ACC.runs = {};
  for (const i of locs) accStart(i);
  renderAccuracy();
}
function accStart(i) {
  const geo = cfdGeometry(i), H = geo.H;
  const st = { i, geo, key: cfdInputsKey(geo), method: ACC.method, target: ACC.target / 100, outs: { film: ACC.film, cl: ACC.cl }, max: ACC.max, cycles: [], status: 'running', t0: performance.now(), H };
  ACC.runs[i] = st;
  logCFD(i, `mesh to an accuracy started: ${ACC_METHODS[st.method].toLowerCase()}, until ${[st.outs.film ? 'the wet film' : '', st.outs.cl ? 'the contact line' : ''].filter(Boolean).join(' and ')} change${st.outs.film && st.outs.cl ? '' : 's'} less than ${ACC.target} %`);
  const run0 = cfdRuns[i];
  // (the first mesh is the location's own: its result is used when up to date)
  if (run0.status === 'done' && run0.field && run0.key === st.key && run0.result.mesh.frac) accCycleDone(st, { r: run0.result, settings: solverOf(i), ms: run0.elapsedMs, reused: true });
  else accSolve(st, solverOf(i));
}
function accSolve(st, settings) {
  const solver = solverFromSettings(settings, st.H), w = makeWorker('cfd-worker.js'), t0 = performance.now();
  st.worker = w; st.progress = null; st.tNow = t0;
  st.live = { r: [], solves: [], t0, tol: solver.tol };
  w.onmessage = e => {
    if (e.data.progress) { st.progress = e.data.progress; liveAdd(st.live, st.progress); accStatus(); return; }
    w.terminate(); st.worker = null;
    const r = e.data.ok ? e.data.result : null;
    if (st.status !== 'running') return;
    if (!r) { st.status = 'error'; st.error = e.data.error || 'no solution'; accEnded(st); return; }
    if (!r.converged && !(r.stalled && r.residual < 1e-4)) { st.status = 'error'; st.error = `did not converge on mesh ${st.cycles.length + 1} (residual ${r.residual.toExponential(1)})`; accEnded(st); return; }
    accCycleDone(st, { r, settings, ms: performance.now() - t0 });
  };
  w.onerror = e => { w.terminate(); st.worker = null; if (st.status !== 'running') return; st.status = 'error'; st.error = e.message || 'worker error'; accEnded(st); };
  w.postMessage(cfdWorkerMessage(st.geo, solver));
  renderAccuracy();
}
/** A mesh solved: its outputs and their change from the previous mesh; then stop (met, or as many meshes as allowed) or refine. */
function accCycleDone(st, c) {
  const r = c.r, U = st.geo.U;
  const cyc = { elements: r.mesh.nEx * r.mesh.nEy, nEx: r.mesh.nEx, nEy: r.mesh.nEy, film: r.Q / U, sCL: r.mode === 'climbed' ? r.sCL : 0, mode: r.mode, ms: c.ms, reused: !!c.reused, r, settings: c.settings };
  const prev = st.cycles[st.cycles.length - 1];
  if (prev) {
    cyc.dFilm = (cyc.film - prev.film) / Math.abs(cyc.film);
    // (the contact line's change relative to its height, at least 5 % of the gap: a line near the edge is not divided by nearly nothing)
    cyc.dCL = cyc.mode !== prev.mode ? Infinity : (cyc.sCL - prev.sCL) / Math.max(Math.abs(cyc.sCL), 0.05 * st.H);
  }
  st.cycles.push(cyc);
  if (st.method === 'everywhere' && st.cycles.length >= 3) {
    const [a, b, d] = st.cycles.slice(-3), rC = Math.sqrt(b.elements / a.elements), rF = Math.sqrt(d.elements / b.elements);
    st.rich = { film: accRichardson(a.film, b.film, d.film, rC, rF), cl: d.mode === 'climbed' && a.mode === d.mode && b.mode === d.mode ? accRichardson(a.sCL, b.sCL, d.sCL, rC, rF) : null };
  }
  const met = prev && (!st.outs.film || Math.abs(cyc.dFilm) < st.target) && (!st.outs.cl || Math.abs(cyc.dCL) < st.target);
  logCFD(st.i, `mesh to an accuracy, mesh ${st.cycles.length}: ${cyc.nEx} × ${cyc.nEy} elements, wet film ${(cyc.film * 1000).toFixed(5)} mm${prev ? ` (${accPct(cyc.dFilm)})` : ''}, contact line ${cyc.mode === 'climbed' ? `${(cyc.sCL * 1000).toFixed(4)} mm` : 'pinned'}${prev && Number.isFinite(cyc.dCL) ? ` (${accPct(cyc.dCL)})` : ''}`);
  if (met) { st.status = 'met'; accEnded(st); return; }
  if (st.cycles.length >= st.max) { st.status = 'notmet'; accEnded(st); return; }
  let next;
  if (st.method === 'adaptive') {
    const ref = accRefine(r.mesh.frac, accIndicator(r), { maxRows: 40 });
    cyc.split = ref;
    next = { ...solverOf(st.i), mesh: 'adapted', frac: ref.frac };
  } else next = accEverywhere(st.i, st.cycles.length);
  accSolve(st, next);
}
const accPct = d => Number.isFinite(d) ? `${d >= 0 ? '+' : '−'}${Math.abs(d * 100) < 0.01 ? Math.abs(d * 100).toExponential(1) : Math.abs(d * 100).toFixed(2)} %` : 'mode changed';
function accEnded(st) {
  st.ms = performance.now() - st.t0;
  const last = st.cycles[st.cycles.length - 1];
  logCFD(st.i, st.status === 'met' ? `mesh to an accuracy: met after ${st.cycles.length} meshes (${last.nEx} × ${last.nEy} elements)`
    : st.status === 'notmet' ? `mesh to an accuracy: not met after ${st.cycles.length} meshes (the last changed ${accPct(last.dFilm)} wet film)`
      : st.status === 'stopped' ? 'mesh to an accuracy stopped' : `mesh to an accuracy failed: ${st.error}`, st.status === 'met' ? 'ok' : st.status === 'error' ? 'bad' : 'warn');
  renderAccuracy();
}
function stopAccuracy() {
  for (const st of Object.values(ACC.runs)) if (st.status === 'running') { if (st.worker) { st.worker.terminate(); st.worker = null; } st.status = 'stopped'; accEnded(st); }
}
/**
 * Keep the last mesh for its location: its settings as the location's own (Adapted: its element ends; refined
 * everywhere: Custom counts with the zones scaled), and its solution as the location's result (the same settings
 * solve to the same answer, so it is up to date).
 */
function accUse(i) {
  const st = ACC.runs[i], last = st && st.cycles[st.cycles.length - 1];
  if (!last) return;
  const s = last.settings, own = { ...CFD_LOCS[i].solver };
  if (s.mesh === 'adapted') { own.mesh = 'adapted'; own.frac = s.frac; delete own.nEb; delete own.nEs; delete own.nEy; }
  else if (s.mesh === 'custom' && !last.reused) { Object.assign(own, { mesh: 'custom', nEb: s.nEb, nEf: s.nEf, nEs: s.nEs, nEy: s.nEy }); if (s.zones) own.zones = s.zones; delete own.frac; }
  undoHint(`L${i + 1}: the mesh from meshing to an accuracy (${last.nEx} × ${last.nEy} elements)`);
  CFD_LOCS[i].solver = own;
  const geo = cfdGeometry(i), run = cfdRuns[i];
  if (!last.reused && JSON.stringify(geo.solver) === JSON.stringify(solverFromSettings(s, geo.H))) {
    Object.assign(run, { status: 'done', error: null, result: last.r, geo, key: cfdInputsKey(geo), elapsedMs: last.ms, field: makeFlowField(last.r, { rho: geo.rho, ty: geo.ty }), streamCache: new Map() });
    run.metrics = flowMetrics(run.field);
  }
  logCFD(i, `mesh from meshing to an accuracy kept: ${MESH_PRESETS[own.mesh].l.toLowerCase()}, ${last.nEx} × ${last.nEy} elements`);
  renderCFD();
}
/** While solving: each running location's line only. */
function accStatus() {
  for (const st of Object.values(ACC.runs)) {
    const el = document.querySelector(`#cfdAccuracy [data-acc-now="${st.i}"]`);
    if (el && st.status === 'running') el.textContent = accNowText(st);
  }
}
const accNowText = st => `mesh ${st.cycles.length + 1}: ${((performance.now() - st.tNow) / 1000).toFixed(0)} s · ${st.progress ? cfdStageText(st.progress.stage) : 'starting…'}`;
function renderAccuracy() {
  const host = document.getElementById('cfdAccuracy');
  if (!host) return;
  const running = Object.values(ACC.runs).some(r => r.status === 'running');
  const opt = (v, t, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`;
  const head = `<div class="fv-bar acc-bar">
    <label class="fv-ctl">Location <select id="accLoc"${running ? ' disabled' : ''}>${CFD_LOCS.map((l, i) => opt(i, `L${l.id} · z ${l.z} mm`, ACC.loc)).join('')}${opt('all', 'All four', ACC.loc)}</select></label>
    <label class="fv-ctl">Method <select id="accMethod"${running ? ' disabled' : ''}>${Object.entries(ACC_METHODS).map(([k, t]) => opt(k, t, ACC.method)).join('')}</select></label>
    <label class="fv-ctl">Target <input type="number" id="accTarget" min="0.01" max="10" step="0.05" value="${ACC.target}"${running ? ' disabled' : ''} aria-label="Target change, %"> %</label>
    <label class="fv-ctl"><input type="checkbox" id="accFilm"${ACC.film ? ' checked' : ''}${running ? ' disabled' : ''}> Wet film</label>
    <label class="fv-ctl"><input type="checkbox" id="accCL"${ACC.cl ? ' checked' : ''}${running ? ' disabled' : ''}> Contact line</label>
    <label class="fv-ctl">Meshes at most <input type="number" id="accMax" min="2" max="8" step="1" value="${ACC.max}"${running ? ' disabled' : ''} aria-label="Meshes at most"></label>
    ${running ? '<button type="button" class="btn btn-secondary btn-sm" id="accStop">Stop</button>' : '<button type="button" class="btn btn-primary btn-sm" id="accRun">Run</button>'}</div>
    <p class="fv-why">${ACC.method === 'adaptive' ? 'Solves the location, estimates each element\'s error from its velocity gradients against smoothed ones, splits the columns and rows carrying most of it, and solves again,' : 'Solves the location, refines every element count by 1.25 (and the zones\' sizes), and solves again,'} until the chosen outputs change less than the target from one mesh to the next. Each mesh takes longer than the one before (more rows cost the most).</p>`;
  const runs = Object.values(ACC.runs);
  if (!runs.length) { host.innerHTML = head + '<p class="cap">Not run yet. It solves one location (or all four, side by side) on finer and finer meshes until the wet film and contact line stop changing, then its mesh can be kept.</p>'; accWire(host); return; }
  const body = runs.map(st => {
    const own0 = CFD_LOCS[st.i].solver, last0 = st.cycles[st.cycles.length - 1];
    const kept0 = last0 && last0.settings && ((last0.settings.mesh === 'adapted' && own0.frac === last0.settings.frac) || (last0.settings.mesh === 'custom' && own0.mesh === 'custom' && own0.nEb === last0.settings.nEb && own0.nEy === last0.settings.nEy));
    // (its mesh kept: the location's settings changed to it, which is not "out of date")
    const stale = !kept0 && cfdInputsKey(cfdGeometry(st.i)) !== st.key;
    const rows = st.cycles.map((c, n) => `<tr><td>${n + 1}${c.reused ? ' <small>(its result)</small>' : ''}</td><td>${c.nEx} × ${c.nEy} = ${c.elements.toLocaleString()}</td><td>${(c.film * 1000).toFixed(5)}</td><td class="${c.dFilm != null && Math.abs(c.dFilm) >= st.target ? 'warn-text' : ''}">${c.dFilm != null ? accPct(c.dFilm) : ''}</td>
      <td>${c.mode === 'climbed' ? (c.sCL * 1000).toFixed(4) : 'pinned'}</td><td class="${c.dCL != null && !(Math.abs(c.dCL) < st.target) ? 'warn-text' : ''}">${c.dCL != null ? accPct(c.dCL) : ''}</td><td>${c.reused ? '—' : `${(c.ms / 1000).toFixed(0)} s`}</td><td>${c.split ? `split ${c.split.cols} columns, ${c.split.rows} rows` : ''}</td></tr>`).join('');
    const now = st.status === 'running' ? `<tr><td>${st.cycles.length + 1}</td><td colspan="7" data-acc-now="${st.i}">${accNowText(st)}</td></tr>` : '';
    const rich = st.rich && st.rich.film ? `<p class="fv-note">Richardson extrapolation from the last three meshes: wet film → ${(st.rich.film.extrapolated * 1000).toFixed(5)} mm (order ${st.rich.film.p.toFixed(2)}, grid convergence index ${(st.rich.film.gci * 100).toFixed(3)} %)${st.rich.cl ? `; contact line → ${(st.rich.cl.extrapolated * 1000).toFixed(4)} mm (order ${st.rich.cl.p.toFixed(2)}, index ${(st.rich.cl.gci * 100).toFixed(2)} %)` : ''}.</p>` : st.method === 'everywhere' && st.cycles.length >= 3 ? '<p class="fv-note">Richardson extrapolation: the changes swap sign, so no order of convergence can be found.</p>' : '';
    const last = st.cycles[st.cycles.length - 1];
    const verdict = st.status === 'met' ? `<span class="ok-text">Met</span> on mesh ${st.cycles.length}: the ${[st.outs.film ? `wet film changed ${accPct(last.dFilm)}` : '', st.outs.cl ? `contact line ${accPct(last.dCL)}` : ''].filter(Boolean).join(', ')} (target ${(st.target * 100).toFixed(2)} %).`
      : st.status === 'notmet' ? `<span class="warn-text">Not met</span> after ${st.cycles.length} meshes. Allow more meshes, a looser target, or add zones where the mesh is coarse.`
        : st.status === 'stopped' ? 'Stopped.' : st.status === 'error' ? `<span class="warn-text">Failed:</span> ${escAttr(st.error)}` : '';
    const own = CFD_LOCS[st.i].solver, kept = last && last.settings && ((last.settings.mesh === 'adapted' && own.frac === last.settings.frac) || (last.settings.mesh === 'custom' && own.nEb === last.settings.nEb && own.nEy === last.settings.nEy && own.mesh === 'custom'));
    const use = last && st.status !== 'running' && !last.reused ? `<button type="button" class="btn btn-secondary btn-sm" data-acc-use="${st.i}"${kept || stale ? ' disabled' : ''}>${kept ? 'Kept' : `Use this mesh for L${st.i + 1}`}</button>` : '';
    return `<div class="acc-loc"><h5><i class="loc-dot" style="background:${locColor(st.i)}"></i>L${st.i + 1} · ${ACC_METHODS[st.method]}${stale ? ' <span class="warn-text">(inputs changed since)</span>' : ''}</h5>
      <div class="table-wrap"><table class="cfd-table nowrap-table"><thead><tr><th>Mesh</th><th>Elements</th><th>Wet film, mm</th><th>Change</th><th>Contact line, mm</th><th>Change</th><th>Time</th><th>Next</th></tr></thead><tbody>${rows}${now}</tbody></table></div>
      ${rich}<p class="acc-verdict">${verdict} ${use}</p></div>`;
  }).join('');
  host.innerHTML = head + body;
  accWire(host);
}
function accWire(host) {
  const g = id => host.querySelector('#' + id);
  if (g('accLoc')) g('accLoc').onchange = e => { ACC.loc = e.target.value === 'all' ? 'all' : +e.target.value; renderAccuracy(); };
  if (g('accMethod')) g('accMethod').onchange = e => { ACC.method = e.target.value; renderAccuracy(); };
  if (g('accTarget')) g('accTarget').onchange = e => guardNumber(e.target, { label: 'Mesh to an accuracy: target', lo: 0.01, hi: 10, unit: '%' }, v => { ACC.target = v; });
  if (g('accMax')) g('accMax').onchange = e => guardNumber(e.target, { label: 'Mesh to an accuracy: meshes at most', lo: 2, hi: 8 }, v => { ACC.max = Math.round(v); });
  if (g('accFilm')) g('accFilm').onchange = e => { ACC.film = e.target.checked; if (!ACC.film && !ACC.cl) { ACC.cl = true; renderAccuracy(); } };
  if (g('accCL')) g('accCL').onchange = e => { ACC.cl = e.target.checked; if (!ACC.film && !ACC.cl) { ACC.film = true; renderAccuracy(); } };
  if (g('accRun')) g('accRun').onclick = runAccuracy;
  if (g('accStop')) g('accStop').onclick = stopAccuracy;
  host.querySelectorAll('[data-acc-use]').forEach(b => { b.onclick = () => accUse(+b.dataset.accUse); });
}

// ---- Flow › 3D, Mesh step: the same for the 3D, driving the page's own 3D solve a mesh at a time ----
/**
 * The trial meshes are set on the page without undo steps (the page solves them as it would); at the end the
 * page gets back the mesh and the result it had, and "Use this mesh" takes the last one (one undo step).
 * Adaptive: the hexahedra's error estimate (accIndicator3) splits the stations' columns and rows (every station
 * alike: their element ends, frac3) and the layers across (zFrac). Everywhere: every count x1.25 (within the
 * inputs' limits) and every zone's size / 1.25, the 2D's zones too (zoneScale).
 */
const ACC3 = { method: 'adaptive', target: 1, film: true, cl: true, max: 4, cycles: [], status: 'idle', stop: false };
const ACC3_KEYS = ['nxGap', 'nxFace', 'nxFilm', 'ny', 'nzStrip', 'nzFull', 'zZones', 'frac3', 'zFrac', 'zFracFor', 'zoneScale'];
const acc3Snap = () => Object.fromEntries(ACC3_KEYS.map(k => [k, JSON.parse(JSON.stringify(C3D[k] ?? null))]));
async function acc3Set(v) { await undoQuiet(() => { Object.assign(C3D, JSON.parse(JSON.stringify(v))); if (C3D.zoneScale == null) C3D.zoneScale = 1; C3D_GEO = null; }); }
/** A 3D result's outputs: the film and the contact line at the strip's middle station, or their means across the web. */
function acc3Outputs(res) {
  const R = res.result, st = R.stations, full = res.region === 'full', mid = (st.length - 1) >> 1;
  const mean = f => st.reduce((a, q) => a + f(q), 0) / st.length;
  return { film: full ? mean(q => q.film) : st[mid].film, s: full ? mean(q => q.s || 0) : st[mid].s || 0, mode: R.mode, H: R.H,
    hexes: ((R.NC - 1) / 2) * ((R.NR - 1) / 2) * ((R.NL - 1) / 2), dims: `${(R.NC - 1) / 2} × ${(R.NR - 1) / 2} × ${(R.NL - 1) / 2}` };
}
/** A 3D result's element ends across, as fractions of its region. */
function acc3ZFrac(R) {
  const z = []; for (let l = 0; l < R.NL; l += 2) z.push(R.z[l * R.NR]);
  return z.map(v => (v - z[0]) / (z[z.length - 1] - z[0]));
}
async function acc3Run() {
  if (ACC3.status === 'running' || C3D_RUN.status === 'running') return;
  Object.assign(ACC3, { status: 'running', stop: false, cycles: [], orig: acc3Snap(), origRes: C3D_RES, final: null, kept: false, error: null, rich: null,
    run: { method: ACC3.method, target: ACC3.target / 100, outs: { film: ACC3.film, cl: ACC3.cl }, max: ACC3.max, region: C3D.region, loc: C3D.loc } });
  const run = ACC3.run;
  render();
  try {
    for (let k = 0; ; k++) {
      let res, reused = false;
      if (k === 0 && C3D_RES && C3D_RES.key === c3dSolveKey() && C3D_RES.result.frac) { res = C3D_RES; reused = true; }
      else { ACC3.tNow = performance.now(); res = await acc3Solve(); if (!res) break; }
      const o = acc3Outputs(res), prev = ACC3.cycles[ACC3.cycles.length - 1];
      const cyc = { ...o, ms: reused ? null : res.ms, reused, settings: acc3Snap(), res };
      if (prev) { cyc.dFilm = (o.film - prev.film) / Math.abs(o.film); cyc.dCL = o.mode !== prev.mode ? Infinity : (o.s - prev.s) / Math.max(Math.abs(o.s), 0.05 * o.H); }
      ACC3.cycles.push(cyc);
      if (run.method === 'everywhere' && ACC3.cycles.length >= 3) {
        const [a, b, c] = ACC3.cycles.slice(-3), rC = Math.cbrt(b.hexes / a.hexes), rF = Math.cbrt(c.hexes / b.hexes);
        ACC3.rich = { film: accRichardson(a.film, b.film, c.film, rC, rF), cl: c.mode === 'climbed' && a.mode === c.mode && b.mode === c.mode ? accRichardson(a.s, b.s, c.s, rC, rF) : null };
      }
      const met = prev && (!run.outs.film || Math.abs(cyc.dFilm) < run.target) && (!run.outs.cl || Math.abs(cyc.dCL) < run.target);
      if (met) { ACC3.status = 'met'; break; }
      if (ACC3.cycles.length >= run.max) { ACC3.status = 'notmet'; break; }
      if (ACC3.stop) { ACC3.status = 'stopped'; break; }
      let next;
      if (run.method === 'adaptive') {
        const R = res.result, ref = accRefine3(R.frac, acc3ZFrac(R), accIndicator3(R), { maxRows: C3D_MESH_LIMITS.ny[1], maxZ: C3D.region === 'strip' ? 24 : 150 });
        cyc.split = ref;
        next = { ...acc3Snap(), frac3: ref.frac, zFrac: ref.zFrac, zFracFor: c3dRegionKey() };
      } else {
        const f = Math.pow(1.25, ACC3.cycles.length), O = ACC3.orig, lim = (q, v) => Math.max(C3D_MESH_LIMITS[q][0], Math.min(C3D_MESH_LIMITS[q][1], Math.round(v)));
        const z = c3dZones(O.zZones);
        z.edges.size = +(z.edges.size / f).toPrecision(6); z.bands.forEach(b => { b.size = +(b.size / f).toPrecision(6); });
        next = { ...O, nxGap: lim('nxGap', O.nxGap * f), nxFace: lim('nxFace', O.nxFace * f), nxFilm: lim('nxFilm', O.nxFilm * f), ny: lim('ny', O.ny * f),
          nzStrip: lim('nzStrip', O.nzStrip * f), nzFull: lim('nzFull', O.nzFull * f), zZones: O.zZones ? z : null, frac3: null, zFrac: null, zFracFor: null, zoneScale: (O.zoneScale || 1) * f };
      }
      await acc3Set(next);
      // (a strip's next mesh beyond what a browser page can hold: stop here, the last mesh kept on offer)
      if (C3D.region !== 'full' && c3dEstimate().bytes > C3D_MAX_BYTES) { ACC3.status = 'limit'; break; }
    }
  } catch (e) { ACC3.status = 'error'; ACC3.error = e.message; }
  if (ACC3.status === 'running') ACC3.status = 'stopped';
  // (the page back to its own mesh and result; "Use this mesh" takes the last one)
  const last = ACC3.cycles[ACC3.cycles.length - 1];
  ACC3.final = last && !last.reused ? { settings: last.settings, res: last.res } : null;
  await acc3Set(ACC3.orig);
  C3D_RES = ACC3.origRes; V3.key = null;
  render();
}
/** One 3D solve of the page's current settings, from the Mesh step: its result (C3D_RES), or null (stopped, failed). */
function acc3Solve() {
  return new Promise(done => {
    c3dRun(true);
    if (C3D_RUN.status !== 'running') { ACC3.status = 'error'; ACC3.error = C3D_RUN.error || 'the 3D could not start'; done(null); return; }
    const t = setInterval(() => {
      if (C3D_RUN.status === 'running') { acc3Status(); return; }
      clearInterval(t);
      if (C3D_RUN.status === 'done' && C3D_RES) { done(C3D_RES); return; }
      if (ACC3.status === 'running') { ACC3.status = ACC3.stop ? 'stopped' : 'error'; ACC3.error = ACC3.stop ? null : C3D_RUN.error || 'the 3D failed'; }
      done(null);
    }, 400);
  });
}
function acc3Stop() { if (ACC3.status !== 'running') return; ACC3.stop = true; c3dStop(); }
/** Keep the last mesh: the 3D mesh settings it was solved with, and its result (one undo step). */
function acc3Use() {
  const F = ACC3.final;
  if (!F) return;
  undoHint('3D: the mesh from meshing to an accuracy');
  Object.assign(C3D, JSON.parse(JSON.stringify(F.settings))); C3D_GEO = null;
  C3D_RES = F.res; V3.key = null; ACC3.kept = true;
  render();
}
/** Back to the element counts (the adapted 3D mesh set aside; one undo step). */
function acc3Counts() {
  undoHint('3D: the mesh from the element counts');
  C3D.frac3 = null; C3D.zFrac = null; C3D.zFracFor = null; C3D.zoneScale = 1; C3D_GEO = null;
  render();
}
function acc3Status() {
  const el = document.getElementById('acc3Now');
  if (el && ACC3.status === 'running') el.textContent = `mesh ${ACC3.cycles.length + 1}: ${((performance.now() - (ACC3.tNow || performance.now())) / 1000).toFixed(0)} s · solving ≈ ${Math.floor(100 * (c3dProgShare() || 0))} %`;
}
/** The 3D Mesh step's "Mesh to an accuracy" section. */
function acc3HTML() {
  const running = ACC3.status === 'running', dis = running ? ' disabled' : '', opt = (v, t, c) => `<option value="${v}"${v === c ? ' selected' : ''}>${t}</option>`;
  const rows = ACC3.cycles.map((c, n) => `<tr><td>${n + 1}${c.reused ? '*' : ''}</td><td>${c.hexes.toLocaleString()}</td><td>${(c.film * 1000).toFixed(4)}${c.dFilm != null ? `<small>${accPct(c.dFilm)}</small>` : ''}</td><td>${c.mode === 'climbed' ? (c.s * 1000).toFixed(3) : 'pinned'}${c.dCL != null ? `<small>${accPct(c.dCL)}</small>` : ''}</td><td>${c.reused ? '—' : `${Math.round(c.ms / 1000)} s`}</td></tr>`).join('');
  const r = ACC3.run, last = ACC3.cycles[ACC3.cycles.length - 1];
  const verdict = ACC3.status === 'met' ? `<span class="ok-text">Met</span> on mesh ${ACC3.cycles.length} (target ${(r.target * 100).toFixed(2)} %).`
    : ACC3.status === 'notmet' ? `<span class="warn-text">Not met</span> after ${ACC3.cycles.length} meshes.`
      : ACC3.status === 'limit' ? `<span class="warn-text">Not met</span> after ${ACC3.cycles.length} meshes: the next would need more memory than a browser can give one page.` : ACC3.status === 'stopped' ? 'Stopped.' : ACC3.status === 'error' ? `<span class="warn-text">Failed:</span> ${escAttr(ACC3.error || '')}` : '';
  const rich = ACC3.rich && ACC3.rich.film ? `<p class="side-note">Richardson: film → ${(ACC3.rich.film.extrapolated * 1000).toFixed(4)} mm (order ${ACC3.rich.film.p.toFixed(2)}, index ${(ACC3.rich.film.gci * 100).toFixed(3)} %).</p>` : '';
  const adapted = C3D.frac3 || c3dZAdapted() || C3D.zoneScale !== 1;
  return `<h4>${uiBadge('tolerance')}Mesh to an accuracy</h4>
    <div class="acc3-bar"><label>Method <select id="acc3Method"${dis}>${opt('adaptive', 'Adaptive', ACC3.method)}${opt('everywhere', 'Refine everywhere ×1.25', ACC3.method)}</select></label>
      <label>Target <input type="number" class="zone-in" id="acc3Target" min="0.05" max="20" step="0.1" value="${ACC3.target}"${dis} aria-label="Target change, %"> %</label>
      <label><input type="checkbox" id="acc3Film"${ACC3.film ? ' checked' : ''}${dis}> Wet film</label><label><input type="checkbox" id="acc3CL"${ACC3.cl ? ' checked' : ''}${dis}> Contact line</label>
      <label>Meshes at most <input type="number" class="zone-in" id="acc3Max" min="2" max="6" step="1" value="${ACC3.max}"${dis} aria-label="Meshes at most"></label>
      ${running ? `<button type="button" class="btn btn-secondary btn-sm" id="acc3Stop">${uiIco('stop')}Stop</button>` : `<button type="button" class="btn btn-primary btn-sm" id="acc3Run">${uiIco('play')}Run</button>`}</div>
    <p class="side-note">Solves the ${C3D.region === 'strip' ? 'strip' : 'full width (slow: each mesh is a full-width solve)'}, ${ACC3.method === 'adaptive' ? 'splits the columns, rows and layers across whose hexahedra carry most of the error' : 'refines every count by 1.25'}, and solves again, until the ${C3D.region === 'strip' ? 'middle station\'s' : 'mean'} wet film and contact line change less than the target.</p>
    ${ACC3.cycles.length || running ? `<div class="table-wrap"><table class="cfd-table acc3-table"><thead><tr><th>Mesh</th><th>Hexahedra</th><th>Film, mm</th><th>Contact line</th><th>Time</th></tr></thead><tbody>${rows}${running ? `<tr><td colspan="5" id="acc3Now">mesh ${ACC3.cycles.length + 1}: starting…</td></tr>` : ''}</tbody></table></div>` : ''}
    ${rich}${verdict ? `<p class="acc-verdict">${verdict} ${ACC3.final ? `<button type="button" class="btn btn-secondary btn-sm" id="acc3Use"${ACC3.kept ? ' disabled' : ''}>${ACC3.kept ? 'Kept' : 'Use this mesh'}</button>` : ''}</p>` : ''}
    ${adapted ? `<p class="side-note">The 3D mesh is the adapted one from meshing to an accuracy (${c3dCounts().a1} along, ${c3dCounts().ny} up, ${c3dNz()} across); the element counts in the inputs are not used. <button type="button" class="linkish" id="acc3Counts">Back to the counts</button></p>` : ''}`;
}
function wireAcc3(host) {
  if (!host) return;
  const g = id => host.querySelector('#' + id);
  if (g('acc3Method')) g('acc3Method').onchange = e => { ACC3.method = e.target.value; render(); };
  if (g('acc3Target')) g('acc3Target').onchange = e => guardNumber(e.target, { label: '3D mesh to an accuracy: target', lo: 0.05, hi: 20, unit: '%' }, v => { ACC3.target = v; });
  if (g('acc3Max')) g('acc3Max').onchange = e => guardNumber(e.target, { label: '3D mesh to an accuracy: meshes at most', lo: 2, hi: 6 }, v => { ACC3.max = Math.round(v); });
  if (g('acc3Film')) g('acc3Film').onchange = e => { ACC3.film = e.target.checked; if (!ACC3.film && !ACC3.cl) { ACC3.cl = true; render(); } };
  if (g('acc3CL')) g('acc3CL').onchange = e => { ACC3.cl = e.target.checked; if (!ACC3.film && !ACC3.cl) { ACC3.film = true; render(); } };
  if (g('acc3Run')) g('acc3Run').onclick = () => acc3Run();
  if (g('acc3Stop')) g('acc3Stop').onclick = acc3Stop;
  if (g('acc3Use')) g('acc3Use').onclick = acc3Use;
  if (g('acc3Counts')) g('acc3Counts').onclick = acc3Counts;
}
