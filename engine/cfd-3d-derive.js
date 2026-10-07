/*
 * cfd-3d-derive.js — fields derived from a solved 3D result (cfd-fem3d.js, as the app keeps it): vorticity, the pressure
 * gradient and the wall shear stress on the web (NUM-3). Pure computation, no DOM; from the solved nodal values alone
 * (x, y, z, u, v, w, p, mu), so a result solved or saved before has them too, and nothing is added to what is saved.
 *
 * The result's nodes are (c * NL + l) * NR + k: c along the flow, l across the web (stations), k up from the web; its
 * elements the solver's 27-node hexahedra, (2ex + a, 2ez + g, 2ey + b) for a, g, b in 0..2. Within an element every field
 * is its triquadratic interpolant, so its gradient at a node is the element's (isoparametric: x, y, z interpolated the
 * same way); a node shared by several elements takes the mean of theirs, as the solver's own shear rate does (the
 * pressure is linear within an element, so its gradient is exact there).
 */
const D3_T = [-1, 0, 1];
/** d/dt of the three quadratic Lagrange functions (nodes at -1, 0, 1), at node t. */
const D3_DN = D3_T.map(t => [t - 0.5, -2 * t, t + 0.5]);

/**
 * The derived fields of result R (opts.gd: also the shear rate from the averaged gradient, a check on the layout).
 * Returns { om: [ωx, ωy, ωz], gp: [∂p/∂x, ∂p/∂y, ∂p/∂z] (Float64Array per node, 1/s and Pa/m, the solve's own axes),
 * web: { tx, tz, t (NC * NL, index c * NL + l, Pa; NaN where the node is not on the web) }, skipped (element-nodes left
 * out: a degenerate element, an open side's spine collapsed on the web); opts.grad: grad, the 12 averaged gradients }.
 */
function derive3D(R, opts = {}) {
  const { NC, NL, NR } = R, NN = NC * NL * NR, nEx = (NC - 1) >> 1, nEz = (NL - 1) >> 1, nEy = (NR - 1) >> 1;
  const id = (c, l, k) => (c * NL + l) * NR + k;
  const F = [R.u, R.v, R.w, R.p];
  // the averaged gradients: velocity (9) and pressure (3) per node
  const G = Array.from({ length: 12 }, () => new Float64Array(NN)), cnt = new Uint8Array(NN);
  const gd = opts.gd ? new Float64Array(NN) : null;
  let yMax = 0; for (let n = 0; n < NN; n++) yMax = Math.max(yMax, Math.abs(R.y[n]));
  let skipped = 0;
  const loc = new Int32Array(27);
  const d = new Float64Array(3 * 7), src = [R.x, R.y, R.z, R.u, R.v, R.w, R.p], gr = new Float64Array(12);   // d: (d/dξ, d/dη, d/dζ) of x, y, z, u, v, w, p
  for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) {
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) loc[(g * 3 + b) * 3 + a] = id(2 * ex + a, 2 * ez + g, 2 * ey + b);
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
      // along each reference direction only the three nodes on that line through this node count (the basis is nodal)
      d.fill(0);
      for (let q = 0; q < 3; q++) {
        const nA = loc[(g * 3 + b) * 3 + q], nB = loc[(g * 3 + q) * 3 + a], nC = loc[(q * 3 + b) * 3 + a];
        const wA = D3_DN[a][q], wB = D3_DN[b][q], wC = D3_DN[g][q];
        for (let f = 0; f < 7; f++) { const s = src[f]; d[3 * f] += wA * s[nA]; d[3 * f + 1] += wB * s[nB]; d[3 * f + 2] += wC * s[nC]; }
      }
      // J^T g = the reference derivatives: rows (x_r, y_r, z_r) for r = ξ, η, ζ
      const a11 = d[0], a12 = d[3], a13 = d[6], a21 = d[1], a22 = d[4], a23 = d[7], a31 = d[2], a32 = d[5], a33 = d[8];
      const c11 = a22 * a33 - a23 * a32, c12 = a13 * a32 - a12 * a33, c13 = a12 * a23 - a13 * a22;
      const c21 = a23 * a31 - a21 * a33, c22 = a11 * a33 - a13 * a31, c23 = a13 * a21 - a11 * a23;
      const c31 = a21 * a32 - a22 * a31, c32 = a12 * a31 - a11 * a32, c33 = a11 * a22 - a12 * a21;
      const det = a11 * c11 + a12 * c21 + a13 * c31, n = loc[(g * 3 + b) * 3 + a];
      // (a degenerate element here -- its three directions nearly in a plane -- has no gradient: left out)
      const scale = Math.hypot(a11, a12, a13) * Math.hypot(a21, a22, a23) * Math.hypot(a31, a32, a33);
      if (!(Math.abs(det) > 1e-8 * scale)) { skipped++; continue; }
      let fin = true;
      for (let f = 3; f < 7; f++) {
        const r1 = d[3 * f], r2 = d[3 * f + 1], r3 = d[3 * f + 2], j = 3 * (f - 3);
        gr[j] = (c11 * r1 + c12 * r2 + c13 * r3) / det; gr[j + 1] = (c21 * r1 + c22 * r2 + c23 * r3) / det; gr[j + 2] = (c31 * r1 + c32 * r2 + c33 * r3) / det;
        fin = fin && Number.isFinite(gr[j]) && Number.isFinite(gr[j + 1]) && Number.isFinite(gr[j + 2]);
      }
      if (!fin) { skipped++; continue; }
      for (let j = 0; j < 12; j++) G[j][n] += gr[j];
      cnt[n]++;
      if (gd) {
        const [ux, uy, uz, vx, vy, vz, wx, wy, wz] = gr, Dxy = 0.5 * (uy + vx), Dxz = 0.5 * (uz + wx), Dyz = 0.5 * (vz + wy);
        gd[n] += Math.sqrt(2 * (ux * ux + vy * vy + wz * wz) + 4 * (Dxy * Dxy + Dxz * Dxz + Dyz * Dyz));
      }
    }
  }
  for (let n = 0; n < NN; n++) { const m = cnt[n]; if (m) { for (let j = 0; j < 12; j++) G[j][n] /= m; if (gd) gd[n] /= m; } else { for (let j = 0; j < 12; j++) G[j][n] = NaN; if (gd) gd[n] = NaN; } }
  // ω = ∇ × u
  const om = [new Float64Array(NN), new Float64Array(NN), new Float64Array(NN)];
  for (let n = 0; n < NN; n++) { om[0][n] = G[7][n] - G[5][n]; om[1][n] = G[2][n] - G[6][n]; om[2][n] = G[3][n] - G[1][n]; }
  // the web (y = 0, normal +y): the slurry's tangential traction on it, μ (∂u/∂y + ∂v/∂x) and μ (∂w/∂y + ∂v/∂z)
  const NW = NC * NL, tx = new Float64Array(NW), tz = new Float64Array(NW), t = new Float64Array(NW);
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) {
    const n = id(c, l, 0), j = c * NL + l;
    if (!(Math.abs(R.y[n]) <= 1e-6 * yMax) || !cnt[n]) { tx[j] = tz[j] = t[j] = NaN; continue; }
    tx[j] = R.mu[n] * (G[1][n] + G[3][n]); tz[j] = R.mu[n] * (G[7][n] + G[5][n]); t[j] = Math.hypot(tx[j], tz[j]);
  }
  return { om, gp: [G[9], G[10], G[11]], web: { tx, tz, t }, ...(opts.grad ? { grad: G } : {}), ...(gd ? { gd } : {}), skipped };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { derive3D };
