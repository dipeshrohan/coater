/*
 * feed-free.js — the pile's top as a free surface (Coating › 3D with the feed, stage 3), found with the flow (feed-fem.js)
 * on the block mesh (feed-mesh.js). The top is held by gravity: the flow is solved under it as a slip lid (no flow through
 * it, along its own normal); the force the lid needs to hold the paste is the paste's normal stress there, σnn; a free top
 * carries none (but its tension), so the top moves by the normal-stress update (fsPileUpdate). Its mean sets the pile's
 * level (and where the pile meets the blade: the mesh is rebuilt for it); the rest, the top's shape. Repeated with the flow
 * until the top stops moving. (The film after the blade, its free surface and its contact line: the app's 3D strip solver,
 * cfd-fem3d.js, coupled under the blade.) Pure computation, no DOM.
 */
const FS_FEM = typeof ffSetup !== 'undefined' ? null : require('./feed-fem.js');
const fsFF = name => (FS_FEM ? FS_FEM[name] : globalThis[name]);

/** Each node's share of the area of the faces tagged (∫ N dA, scaled units), as a Map. */
function fsArea(S, tags) {
  const M = S.M, out = new Map(), FM = (typeof FM_FACES !== 'undefined' ? FM_FACES : require('./feed-mesh.js').FM_FACES);
  const Q2 = t => [t * (t - 1) / 2, 1 - t * t, t * (t + 1) / 2], DQ2 = t => [t - 0.5, -2 * t, t + 0.5], G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], W = [5 / 9, 8 / 9, 5 / 9];
  for (const F of M.faces) {
    if (!tags.includes(F.tag)) continue;
    const el = M.elems.subarray(27 * F.e, 27 * F.e + 27), fixed = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]][F.f], free = [0, 1, 2].filter(k => k !== fixed[0]);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const ref = [0, 0, 0]; ref[fixed[0]] = fixed[1]; ref[free[0]] = G[i]; ref[free[1]] = G[j];
      const A = Q2(ref[0]), B = Q2(ref[1]), C = Q2(ref[2]), dA = DQ2(ref[0]), dB = DQ2(ref[1]), dC = DQ2(ref[2]), t1 = [0, 0, 0], t2 = [0, 0, 0], N = new Float64Array(27);
      for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const k = (g * 3 + b) * 3 + a, n = el[k], P = [S.X[n], S.Y[n], S.Z[n]], d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]];
        N[k] = A[a] * B[b] * C[g]; for (let c = 0; c < 3; c++) { t1[c] += d[free[0]] * P[c]; t2[c] += d[free[1]] * P[c]; }
      }
      const dAr = Math.hypot(t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]) * W[i] * W[j];
      for (const k of FM[F.f]) out.set(el[k], (out.get(el[k]) || 0) + N[k] * dAr);
    }
  }
  return out;
}

/** The paste's normal stress σnn (Pa) under a slip lid, at the lid's nodes that have a frame of their own (the force the
 *  lid holds the paste with along its normal, from the residual, over the node's share of the lid's area). */
function fsNormalStress(S, x, tags) {
  const R = fsFF('ffResidual')(S, x, undefined, { raw: true }), A = fsArea(S, tags), out = new Map();
  for (const [n, a] of A) if (S.rot[n] >= 0) out.set(n, R[3 * n] / a * S.Pr);
  return out;
}

/**
 * The pile's top moved by its normal stress, with its weight and its tension (the normal-stress update): over the top's plan
 * (9-node quadrilaterals: quads[q] = 9 node ids, a along one plan direction, b the other; xs, zs the nodes' plan places),
 *   (ρ g M + σ K) δh = −M σnn − σ K h
 * M, K: the plan's mass and stiffness (∫ v w, ∫ ∇v·∇w); σnn the paste's normal stress under the top as a lid (Pa); h the top
 * now. Its weight alone: δh = −σnn/(ρ g) (a pressure too high under the lid: the top rises); its tension resists a sharp top
 * (where the top meets the blade the stress under a lid is singular; tension keeps the top smooth there). Walls: the top
 * meets them square (nothing imposed). Returns δh per node (Float64Array over the node ids, NaN off the top) and the mean.
 */
function fsPileUpdate(xs, zs, quads, sn, h, o) {
  const used = new Map(); for (const q of quads) for (const n of q) if (!used.has(n)) used.set(n, used.size);
  const nn = used.size, ids = [...used.keys()], rhoG = o.rho * o.g, sg = o.sigma || 0;
  const Q2 = t => [t * (t - 1) / 2, 1 - t * t, t * (t + 1) / 2], DQ2 = t => [t - 0.5, -2 * t, t + 0.5], G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], Wg = [5 / 9, 8 / 9, 5 / 9];
  const rows = Array.from({ length: nn }, () => new Map()), Mr = Array.from({ length: nn }, () => new Map()), Kr = Array.from({ length: nn }, () => new Map());
  for (const q of quads) {
    const L = q.map(n => used.get(n));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const A = Q2(G[i]), B = Q2(G[j]), dA = DQ2(G[i]), dB = DQ2(G[j]), N = [], Na = [], Nb = [];
      for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { N.push(A[a] * B[b]); Na.push(dA[a] * B[b]); Nb.push(A[a] * dB[b]); }
      let xa = 0, xb = 0, za = 0, zb = 0; for (let k = 0; k < 9; k++) { xa += Na[k] * xs[q[k]]; xb += Nb[k] * xs[q[k]]; za += Na[k] * zs[q[k]]; zb += Nb[k] * zs[q[k]]; }
      const det = xa * zb - xb * za, w = Wg[i] * Wg[j] * Math.abs(det);
      const dx = Na.map((v, k) => (v * zb - Nb[k] * za) / det), dz = Na.map((v, k) => (-v * xb + Nb[k] * xa) / det);
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const m = w * N[r] * N[c], kk = w * (dx[r] * dx[c] + dz[r] * dz[c]), R = L[r], C = L[c];
        Mr[R].set(C, (Mr[R].get(C) || 0) + m); Kr[R].set(C, (Kr[R].get(C) || 0) + kk); rows[R].set(C, (rows[R].get(C) || 0) + rhoG * m + sg * kk);
      }
    }
  }
  // σnn at every node of the plan (nodes with none -- a wall's: no frame of its own -- take their nearest's)
  const s = new Float64Array(nn), have = ids.map((n, i) => sn.has(n) ? i : -1).filter(i => i >= 0);
  ids.forEach((n, i) => {
    if (sn.has(n)) { s[i] = sn.get(n); return; }
    let b = -1, bd = Infinity; for (const j of have) { const d = (xs[ids[j]] - xs[n]) ** 2 + (zs[ids[j]] - zs[n]) ** 2; if (d < bd) { bd = d; b = j; } } s[i] = s[b];
  });
  const hv = Float64Array.from(ids, n => h[n]), b = new Float64Array(nn);
  for (let i = 0; i < nn; i++) { let v = 0; for (const [j, m] of Mr[i]) v -= m * s[j]; for (const [j, k] of Kr[i]) v -= sg * k * hv[j]; b[i] = v; }
  // CG, Jacobi-preconditioned (symmetric positive definite)
  const A = rows.map(r => [...r]), dg = A.map((r, i) => r.find(([j]) => j === i)[1]), mv = v => Float64Array.from(A, r => r.reduce((t, [j, a]) => t + a * v[j], 0));
  const x = new Float64Array(nn), rr = Float64Array.from(b); let z = rr.map((v, i) => v / dg[i]), p = Float64Array.from(z), rz = rr.reduce((t, v, i) => t + v * z[i], 0);
  const b0 = Math.sqrt(b.reduce((t, v) => t + v * v, 0)) || 1;
  for (let it = 0; it < 5000; it++) {
    const Ap = mv(p), al = rz / p.reduce((t, v, i) => t + v * Ap[i], 0);
    for (let i = 0; i < nn; i++) { x[i] += al * p[i]; rr[i] -= al * Ap[i]; }
    if (Math.sqrt(rr.reduce((t, v) => t + v * v, 0)) < 1e-12 * b0) break;
    z = rr.map((v, i) => v / dg[i]); const rz2 = rr.reduce((t, v, i) => t + v * z[i], 0);
    for (let i = 0; i < nn; i++) p[i] = z[i] + rz2 / rz * p[i]; rz = rz2;
  }
  // the mean move (the level), by area
  let area = 0, mean = 0; for (let i = 0; i < nn; i++) { let m = 0; for (const [, v] of Mr[i]) m += v; area += m; mean += m * x[i]; }
  const dh = new Map(); ids.forEach((n, i) => dh.set(n, x[i]));
  return { dh, mean: mean / area };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fsArea, fsNormalStress, fsPileUpdate };
