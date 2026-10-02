/*
 * feed-post.js — after a solve on the coater's block mesh (feed-mesh.js, feed-fem.js): where a point is (which element,
 * at which local coordinates: the isoparametric map inverted by Newton's method), the velocity there, and streamlines
 * traced through the mesh (RK4, the step a fraction of the element's size over the speed, walking from element to
 * element by their shared faces). Pure computation, no DOM.
 */
const FP_Q2 = s => [s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], FP_DQ2 = s => [s - 0.5, -2 * s, s + 0.5];

/** Index a mesh for finding points: each element's box in a grid of bins; neighbours by shared faces. */
function fpIndex(M) {
  const nE = M.nE, box = new Float64Array(6 * nE);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let e = 0; e < nE; e++) {
    let a = Infinity, b = Infinity, c = Infinity, d = -Infinity, f = -Infinity, g = -Infinity;
    for (let k = 0; k < 27; k++) { const n = M.elems[27 * e + k]; a = Math.min(a, M.X[n]); b = Math.min(b, M.Y[n]); c = Math.min(c, M.Z[n]); d = Math.max(d, M.X[n]); f = Math.max(f, M.Y[n]); g = Math.max(g, M.Z[n]); }
    box.set([a, b, c, d, f, g], 6 * e);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b); z0 = Math.min(z0, c); x1 = Math.max(x1, d); y1 = Math.max(y1, f); z1 = Math.max(z1, g);
  }
  const nb = Math.max(4, Math.round(Math.cbrt(nE / 2))), N = [nb, Math.max(2, Math.round(nb / 2)), nb], lo = [x0, y0, z0], span = [x1 - x0, y1 - y0, z1 - z0];
  const bins = new Map(), key = (i, j, k) => (i * N[1] + j) * N[2] + k, cell = (v, d) => Math.max(0, Math.min(N[d] - 1, Math.floor((v - lo[d]) / span[d] * N[d])));
  for (let e = 0; e < nE; e++) {
    const b = box.subarray(6 * e, 6 * e + 6);
    for (let i = cell(b[0], 0); i <= cell(b[3], 0); i++) for (let j = cell(b[1], 1); j <= cell(b[4], 1); j++) for (let k = cell(b[2], 2); k <= cell(b[5], 2); k++) {
      const kk = key(i, j, k); if (!bins.has(kk)) bins.set(kk, []); bins.get(kk).push(e);
    }
  }
  // neighbours by shared faces (corner sets)
  const F = [[0, 2, 6, 8].map(i => i * 3), [0, 2, 6, 8].map(i => i * 3 + 2), [0, 2, 18, 20], [6, 8, 24, 26], [0, 2, 6, 8], [18, 20, 24, 26]];
  const FL = [[0, 6, 18, 24], [2, 8, 20, 26], [0, 2, 18, 20], [6, 8, 24, 26], [0, 2, 6, 8], [18, 20, 24, 26]];
  void F;
  const faceMap = new Map(), nbr = new Int32Array(6 * nE).fill(-1);
  for (let e = 0; e < nE; e++) for (let f = 0; f < 6; f++) {
    const k = FL[f].map(i => M.elems[27 * e + i]).sort((p, q) => p - q).join(',');
    const o = faceMap.get(k); if (o) { nbr[6 * e + f] = o.e; nbr[6 * o.e + o.f] = e; } else faceMap.set(k, { e, f });
  }
  return { M, box, bins, key, cell, nbr, last: 0 };
}

/** Local coordinates of p in element e (Newton on the isoparametric map), or null if it does not converge. */
function fpLocal(M, e, p, guess = [0, 0, 0]) {
  let xi = guess.slice();
  for (let it = 0; it < 25; it++) {
    const A = FP_Q2(xi[0]), B = FP_Q2(xi[1]), C = FP_Q2(xi[2]), dA = FP_DQ2(xi[0]), dB = FP_DQ2(xi[1]), dC = FP_DQ2(xi[2]);
    const x = [0, 0, 0], J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      const n = M.elems[27 * e + (g * 3 + b) * 3 + a], P = [M.X[n], M.Y[n], M.Z[n]], N = A[a] * B[b] * C[g], d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]];
      for (let c = 0; c < 3; c++) { x[c] += N * P[c]; for (let r = 0; r < 3; r++) J[c * 3 + r] += d[r] * P[c]; }
    }
    const r = [x[0] - p[0], x[1] - p[1], x[2] - p[2]];
    const det = J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6]);
    if (!det) return null;
    // solve J δ = r (J[c*3 + r] = dx_c/dξ_r)
    const inv = [(J[4] * J[8] - J[5] * J[7]), -(J[1] * J[8] - J[2] * J[7]), (J[1] * J[5] - J[2] * J[4]), -(J[3] * J[8] - J[5] * J[6]), (J[0] * J[8] - J[2] * J[6]), -(J[0] * J[5] - J[2] * J[3]), (J[3] * J[7] - J[4] * J[6]), -(J[0] * J[7] - J[1] * J[6]), (J[0] * J[4] - J[1] * J[3])].map(v => v / det);
    const d = [inv[0] * r[0] + inv[1] * r[1] + inv[2] * r[2], inv[3] * r[0] + inv[4] * r[1] + inv[5] * r[2], inv[6] * r[0] + inv[7] * r[1] + inv[8] * r[2]];
    xi = [xi[0] - d[0], xi[1] - d[1], xi[2] - d[2]];
    if (Math.max(...xi.map(Math.abs)) > 3) return null;
    if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) < 1e-11) return xi;
  }
  return null;
}
const fpInside = xi => xi && Math.max(Math.abs(xi[0]), Math.abs(xi[1]), Math.abs(xi[2])) <= 1 + 1e-7;

/** The element containing p (and p's local coordinates): the last one found and its neighbours first, then the bins. */
function fpLocate(X, p) {
  const M = X.M, tryE = e => { const b = X.box.subarray(6 * e, 6 * e + 6), t = 1e-9; if (p[0] < b[0] - t || p[0] > b[3] + t || p[1] < b[1] - t || p[1] > b[4] + t || p[2] < b[2] - t || p[2] > b[5] + t) return null; const xi = fpLocal(M, e, p); return fpInside(xi) ? xi : null; };
  const near = [X.last]; for (let f = 0; f < 6; f++) { const n = X.nbr[6 * X.last + f]; if (n >= 0) near.push(n); }
  for (const e of near) { const xi = tryE(e); if (xi) { X.last = e; return { e, xi }; } }
  const L = X.bins.get(X.key(X.cell(p[0], 0), X.cell(p[1], 1), X.cell(p[2], 2))) || [];
  for (const e of L) { const xi = tryE(e); if (xi) { X.last = e; return { e, xi }; } }
  return null;
}
/** A nodal field (an array per component) at p: null outside the mesh. */
function fpField(X, F, p) {
  const at = fpLocate(X, p); if (!at) return null;
  const A = FP_Q2(at.xi[0]), B = FP_Q2(at.xi[1]), C = FP_Q2(at.xi[2]), out = F.map(() => 0);
  for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { const n = X.M.elems[27 * at.e + (g * 3 + b) * 3 + a], N = A[a] * B[b] * C[g]; for (let c = 0; c < F.length; c++) out[c] += N * F[c][n]; }
  return { v: out, e: at.e };
}
/** A streamline from p (forward), RK4: each step a fraction of the element's size over the speed; stops leaving the
 *  mesh, at a stagnant point, or after maxLen. Returns the points [x, y, z, |u|]. */
function fpStream(X, U, p0, opts = {}) {
  const frac = opts.frac ?? 0.25, maxLen = opts.maxLen ?? 1, maxSteps = opts.maxSteps ?? 20000, out = [];
  let p = p0.slice(), len = 0;
  const vel = q => { const r = fpField(X, U, q); return r ? r : null; };
  for (let s = 0; s < maxSteps && len < maxLen; s++) {
    const r1 = vel(p); if (!r1) break;
    const sp = Math.hypot(...r1.v); out.push([...p, sp]);
    if (sp < 1e-12) break;
    const b = X.box.subarray(6 * r1.e, 6 * r1.e + 6), h = Math.min(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    // (a step that would leave the mesh -- turning a wall's corner, hugging a wall -- is halved, up to 10 times, before
    //  the line is taken to have left through an outlet)
    let np = null;
    for (let dt = frac * h / sp, tries = 0; tries <= 10 && !np; tries++, dt /= 2) {
      const k1 = r1.v, r2 = vel(p.map((v, i) => v + 0.5 * dt * k1[i])); if (!r2) continue;
      const r3 = vel(p.map((v, i) => v + 0.5 * dt * r2.v[i])); if (!r3) continue;
      const r4 = vel(p.map((v, i) => v + dt * r3.v[i])); if (!r4) continue;
      const q = p.map((v, i) => v + dt / 6 * (k1[i] + 2 * r2.v[i] + 2 * r3.v[i] + r4.v[i]));
      if (fpLocate(X, q)) np = q;
    }
    if (!np) break;
    len += Math.hypot(np[0] - p[0], np[1] - p[1], np[2] - p[2]); p = np;
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fpIndex, fpLocal, fpLocate, fpField, fpStream };
