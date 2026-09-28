/*
 * sheet.js — a cut piece of the peeled film in 3D (GO-4d): a thin plate that wants to curl (its natural curvature,
 * from film.js's layers) and shrink (its natural in-plane strain), free or lying on a table under its own weight.
 *
 * The plate: von Kármán (large deflection, moderate rotation), in-plane isotropic, its reference plane where its
 * stretch and bend do not couple (the layers' stiffness-weighted middle: all layers share one Poisson's ratio).
 *   energy = ∫ ½ εᵀ A ε + ½ (κ − κ̄)ᵀ D (κ − κ̄) + p w  (+ the table's push where w < 0)
 *   ε = [u,x + ½ w,x², v,y + ½ w,y², u,y + v,x + w,x w,y],  κ = −[w,xx, w,yy, 2 w,xy]
 * κ > 0 curls the plate away from its top (the top convex), as film.js's curvature. x runs along the line (as the
 * film ran), y across it.
 *
 * Finite elements: Bogner–Fox–Schmit rectangles (bicubic Hermite: the value, both slopes and the twist at each node)
 * for u, v and w alike, 4×4 Gauss; a quarter of the piece with its two mirror lines (every shape this plate takes --
 * a bowl, a tube either way, lying on a table -- is mirror-symmetric both ways). The energy is minimised by Newton
 * with a Levenberg–Marquardt shift and a line search (so it settles in a stable shape, never a saddle), the natural
 * curvature raised in steps from 0; a tiny preference (or the roll's set, which is along the line) picks which way a
 * large piece rolls up.
 */

// ---- the 1D Hermite cubics on [0, 1] and their derivatives: [value at 0, slope at 0, value at 1, slope at 1] ----
const shH = t => [1 - 3 * t * t + 2 * t * t * t, t - 2 * t * t + t * t * t, 3 * t * t - 2 * t * t * t, -t * t + t * t * t];
const shH1 = t => [-6 * t + 6 * t * t, 1 - 4 * t + 3 * t * t, 6 * t - 6 * t * t, -2 * t + 3 * t * t];
const shH2 = t => [-6 + 12 * t, -4 + 6 * t, 6 - 12 * t, -2 + 6 * t];
const SH_G = (() => {   // 4-point Gauss on [0, 1]
  const x = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526], w = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538];
  return x.map((xi, i) => [(xi + 1) / 2, w[i] / 2]);
})();

/**
 * The 16 bicubic shape functions of an a × b rectangle at (s, t) ∈ [0,1]², in the order of the element's dofs
 * (node 0 (0,0), 1 (a,0), 2 (a,b), 3 (0,b); at each: value, ∂x, ∂y, ∂xy), with their x, y, xx, yy, xy derivatives.
 */
function shShape(s, t, a, b) {
  const X = [shH(s), shH1(s), shH2(s)], Y = [shH(t), shH1(t), shH2(t)];
  const nodes = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const N = new Float64Array(16), Nx = new Float64Array(16), Ny = new Float64Array(16), Nxx = new Float64Array(16), Nyy = new Float64Array(16), Nxy = new Float64Array(16);
  let k = 0;
  for (const [i, j] of nodes) {
    // (the value's and the slope's functions at this node in x and y; the slope ones scaled by the element's size)
    const fx = [[i ? 2 : 0, 1], [i ? 3 : 1, a]], fy = [[j ? 2 : 0, 1], [j ? 3 : 1, b]];
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const [ix, sx] = fx[cx], [iy, sy] = fy[cy], sc = sx * sy;
      N[k] = sc * X[0][ix] * Y[0][iy];
      Nx[k] = sc * X[1][ix] / a * Y[0][iy];
      Ny[k] = sc * X[0][ix] * Y[1][iy] / b;
      Nxx[k] = sc * X[2][ix] / (a * a) * Y[0][iy];
      Nyy[k] = sc * X[0][ix] * Y[2][iy] / (b * b);
      Nxy[k] = sc * X[1][ix] / a * Y[1][iy] / b;
      k++;
    }
  }
  return { N, Nx, Ny, Nxx, Nyy, Nxy };
}

/** A symmetric banded matrix (lower band) and its Cholesky solve; null when it is not positive definite. */
function shBand(n, bw) { return { n, bw, a: new Float64Array(n * (bw + 1)) }; }
function shBandSolve(M, rhs, shift = 0) {
  const n = M.n, bw = M.bw, w = bw + 1, a = Float64Array.from(M.a);
  for (let i = 0; i < n; i++) a[i * w] += shift * (M.diag ? M.diag[i] : 1);
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let s = a[i * w + (i - j)];
      for (let k = Math.max(j0, j - bw); k < j; k++) s -= a[i * w + (i - k)] * a[j * w + (j - k)];
      if (j === i) { if (!(s > 0)) return null; a[i * w] = Math.sqrt(s); }
      else a[i * w + (i - j)] = s / a[j * w];
    }
  }
  const y = Float64Array.from(rhs);
  for (let i = 0; i < n; i++) { let s = y[i]; for (let k = Math.max(0, i - bw); k < i; k++) s -= a[i * w + (i - k)] * y[k]; y[i] = s / a[i * w]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= a[k * w + (k - i)] * y[k]; y[i] = s / a[i * w]; }
  return y;
}

/**
 * The piece: a quarter [0, Lx/2] × [0, Ly/2] (its middle at the origin), nx × ny elements. Dofs per node: u (4), v
 * (4), w (4) -- value, ∂x, ∂y, ∂xy each. Mirror lines: at x = 0, u, u,y, v,x, v,xy, w,x, w,xy vanish; at y = 0,
 * v, v,x, u,y, u,xy, w,y, w,xy vanish. Free (no table): w = 0 at the middle.
 */
function shMesh(Lx, Ly, nx, ny) {
  const a = Lx / 2 / nx, b = Ly / 2 / ny, nn = (nx + 1) * (ny + 1), ndof = nn * 12;
  const id = (i, j) => j * (nx + 1) + i;
  const fixed = new Uint8Array(ndof);
  const U = 0, V = 4, W = 8;   // (field offsets; + 0 value, 1 ∂x, 2 ∂y, 3 ∂xy)
  for (let j = 0; j <= ny; j++) { const k = id(0, j) * 12; for (const d of [U + 0, U + 2, V + 1, V + 3, W + 1, W + 3]) fixed[k + d] = 1; }
  for (let i = 0; i <= nx; i++) { const k = id(i, 0) * 12; for (const d of [V + 0, V + 1, U + 2, U + 3, W + 2, W + 3]) fixed[k + d] = 1; }
  const els = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) els.push({ i, j, nodes: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)] });
  // (numbered along the shorter side: the band is (the shorter side's nodes + 2) × 12)
  return { Lx, Ly, nx, ny, a, b, nn, ndof, id, fixed, els, bw: 12 * (nx + 3) };
}

/**
 * The energy, its gradient and (if asked) its stiffness at dofs d. o: { A, nu, D, kx, ky (natural curvatures),
 * p (weight per area, N/m²; 0 = free), table (a table at w = 0 under it), kc (the table's stiffness per area) }.
 */
function shEnergy(m, d, o, withK) {
  const { a, b } = m, Am = o.A / (1 - o.nu * o.nu), Db = o.D / (1 - o.nu * o.nu), nu = o.nu;
  const g = new Float64Array(m.ndof), K = withK ? shBand(m.ndof, m.bw) : null;
  let E = 0;
  if (!m.shp) m.shp = SH_G.flatMap(([s, ws]) => SH_G.map(([t, wt]) => ({ ...shShape(s, t, a, b), wq: ws * wt * a * b })));
  const ue = new Float64Array(16), ve = new Float64Array(16), we = new Float64Array(16), dofs = new Int32Array(48);
  const ke = withK ? new Float64Array(48 * 48) : null, fe = new Float64Array(48);
  // (the strains' gradients over the 48 dofs, flat: membrane rows 0–2 at 0, 48, 96; bending rows over w's 16 only)
  const Bm = new Float64Array(144), Bb = new Float64Array(48), CBm = new Float64Array(144), CBb = new Float64Array(48);
  const Cm = [Am, Am * nu, 0, Am * nu, Am, 0, 0, 0, Am * (1 - nu) / 2], Cb = [Db, Db * nu, 0, Db * nu, Db, 0, 0, 0, Db * (1 - nu) / 2];
  for (const el of m.els) {
    for (let n = 0; n < 4; n++) for (let c = 0; c < 4; c++) {
      const k = el.nodes[n] * 12;
      dofs[n * 4 + c] = k + c; dofs[16 + n * 4 + c] = k + 4 + c; dofs[32 + n * 4 + c] = k + 8 + c;
      ue[n * 4 + c] = d[k + c]; ve[n * 4 + c] = d[k + 4 + c]; we[n * 4 + c] = d[k + 8 + c];
    }
    fe.fill(0); if (ke) ke.fill(0);
    for (const q of m.shp) {
      let ux = 0, uy = 0, vx = 0, vy = 0, w = 0, wx = 0, wy = 0, wxx = 0, wyy = 0, wxy = 0;
      for (let k = 0; k < 16; k++) {
        ux += q.Nx[k] * ue[k]; uy += q.Ny[k] * ue[k]; vx += q.Nx[k] * ve[k]; vy += q.Ny[k] * ve[k];
        w += q.N[k] * we[k]; wx += q.Nx[k] * we[k]; wy += q.Ny[k] * we[k]; wxx += q.Nxx[k] * we[k]; wyy += q.Nyy[k] * we[k]; wxy += q.Nxy[k] * we[k];
      }
      const e1 = ux + 0.5 * wx * wx, e2 = vy + 0.5 * wy * wy, e3 = uy + vx + wx * wy;
      const k1 = -wxx - o.kx, k2 = -wyy - o.ky, k3 = -2 * wxy;
      const N1 = Am * (e1 + nu * e2), N2 = Am * (e2 + nu * e1), N3 = Am * (1 - nu) / 2 * e3;
      const M1 = Db * (k1 + nu * k2), M2 = Db * (k2 + nu * k1), M3 = Db * (1 - nu) / 2 * k3;
      let pe = 0.5 * (N1 * e1 + N2 * e2 + N3 * e3) + 0.5 * (M1 * k1 + M2 * k2 + M3 * k3) + (o.p || 0) * w;
      let fc = 0, kcq = 0;
      if (o.table && w < 0) { pe += 0.5 * o.kc * w * w; fc = o.kc * w; kcq = o.kc; }
      E += pe * q.wq;
      if (!withK && !g) continue;
      Bm.fill(0);
      for (let k = 0; k < 16; k++) {
        Bm[k] = q.Nx[k]; Bm[32 + k] = wx * q.Nx[k];
        Bm[48 + 16 + k] = q.Ny[k]; Bm[48 + 32 + k] = wy * q.Ny[k];
        Bm[96 + k] = q.Ny[k]; Bm[96 + 16 + k] = q.Nx[k]; Bm[96 + 32 + k] = wx * q.Ny[k] + wy * q.Nx[k];
      }
      const wq = q.wq;
      for (let r = 0; r < 48; r++) fe[r] += wq * (Bm[r] * N1 + Bm[48 + r] * N2 + Bm[96 + r] * N3);
      for (let k = 0; k < 16; k++) fe[32 + k] += wq * (-q.Nxx[k] * M1 - q.Nyy[k] * M2 - 2 * q.Nxy[k] * M3 + ((o.p || 0) + fc) * q.N[k]);
      if (ke) {
        for (let i = 0; i < 3; i++) for (let c = 0; c < 48; c++) CBm[i * 48 + c] = Cm[i * 3] * Bm[c] + Cm[i * 3 + 1] * Bm[48 + c] + Cm[i * 3 + 2] * Bm[96 + c];
        for (let c = 0; c < 16; c++) { const b0 = -q.Nxx[c], b1 = -q.Nyy[c], b2 = -2 * q.Nxy[c]; Bb[c] = b0; Bb[16 + c] = b1; Bb[32 + c] = b2;
          CBb[c] = Cb[0] * b0 + Cb[1] * b1; CBb[16 + c] = Cb[3] * b0 + Cb[4] * b1; CBb[32 + c] = Cb[8] * b2; }
        for (let r = 0; r < 48; r++) {
          const m0 = Bm[r], m1 = Bm[48 + r], m2 = Bm[96 + r], row = r * 48;
          if (m0 || m1 || m2) for (let c = 0; c <= r; c++) ke[row + c] += wq * (m0 * CBm[c] + m1 * CBm[48 + c] + m2 * CBm[96 + c]);
        }
        // (bending, and the membrane forces' geometric stiffness and the table's, over w's 16)
        for (let r = 0; r < 16; r++) {
          const row = (32 + r) * 48 + 32, b0 = Bb[r], b1 = Bb[16 + r], b2 = Bb[32 + r], nx = q.Nx[r], ny = q.Ny[r], nr = q.N[r];
          for (let c = 0; c <= r; c++)
            ke[row + c] += wq * (b0 * CBb[c] + b1 * CBb[16 + c] + b2 * CBb[32 + c] + N1 * nx * q.Nx[c] + N2 * ny * q.Ny[c] + N3 * (nx * q.Ny[c] + ny * q.Nx[c]) + kcq * nr * q.N[c]);
        }
      }
    }
    for (let r = 0; r < 48; r++) {
      const gr = dofs[r];
      g[gr] += fe[r];
      if (ke) for (let c = 0; c <= r; c++) { const v = ke[r * 48 + c]; if (!v) continue; let i = gr, j = dofs[c]; if (j > i) { const t = i; i = j; j = t; } K.a[i * (K.bw + 1) + (i - j)] += v; }
    }
  }
  // (the fixed dofs out: their rows and columns zero, their diagonal 1)
  for (let i = 0; i < m.ndof; i++) if (m.fixed[i]) g[i] = 0;
  if (K) {
    const w = K.bw + 1;
    for (let i = 0; i < m.ndof; i++) for (let dd = 0; dd <= K.bw && i - dd >= 0; dd++) if (m.fixed[i] || m.fixed[i - dd]) K.a[i * w + dd] = dd === 0 && m.fixed[i] ? 1 : 0;
    K.diag = Float64Array.from({ length: m.ndof }, (_, i) => Math.abs(K.a[i * w]) || 1);
  }
  return { E, g, K };
}

/** Minimise the energy from d (in place): Newton with a Levenberg–Marquardt shift and a backtracking line search. */
function shMinimise(m, d, o, { tol = 1e-9, maxIt = 60 } = {}) {
  let cur = shEnergy(m, d, o, true), mu = 0, it = 0;
  const gnorm = g => { let s = 0; for (let i = 0; i < g.length; i++) s += g[i] * g[i]; return Math.sqrt(s); };
  const g0 = Math.max(gnorm(cur.g), 1e-30), scaleE = Math.abs(cur.E) + 1e-30;
  for (; it < maxIt; it++) {
    const gn = gnorm(cur.g);
    if (gn < tol * Math.max(1, g0) || gn < 1e-14) break;
    let step = null;
    for (let tries = 0; tries < 30 && !step; tries++) {
      step = shBandSolve(cur.K, cur.g.map(v => -v), mu);
      if (!step) mu = mu ? mu * 10 : 1e-8;
    }
    if (!step) throw new Error('the piece: no descent direction');
    // (a line search on the energy)
    let t = 1, next = null;
    for (let ls = 0; ls < 30; ls++) {
      const trial = d.map((v, i) => v + t * step[i]);
      const e = shEnergy(m, trial, o, false).E;
      if (e <= cur.E + 1e-4 * t * step.reduce((s, v, i) => s + v * cur.g[i], 0) || Math.abs(e - cur.E) < 1e-14 * scaleE) { next = trial; break; }
      t /= 2;
    }
    if (!next) { mu = mu ? mu * 10 : 1e-6; if (mu > 1e12) break; continue; }
    d.set(next);
    cur = shEnergy(m, d, o, true);
    mu = t === 1 ? mu / 10 : mu;
    if (mu < 1e-12) mu = 0;
  }
  return { E: cur.E, gnorm: gnorm(cur.g), it };
}

/**
 * A piece of the film: { Lx, Ly (m), A = Σ E t (N/m), D = Σ E (t z² + t³/12) about its neutral plane (N m), nu,
 * kx, ky (its natural curvatures, 1/m; κ > 0 away from its top), p (its weight per area, N/m²), table (lying on a
 * table: its curl up, resting on the table under it), n (elements along each half), steps (the curvature raised in
 * that many steps), bias (a tiny extra curvature along x picking which way a large piece rolls) }.
 * Returns its shape over the whole piece (w on an (2n+1)² grid, mirrored), the corners' and edges' lift, the
 * curvatures at its middle, its energy and how it lies.
 */
function shRun(o) {
  const n = o.n || 8, m = shMesh(o.Lx, o.Ly, n, n);
  const d = new Float64Array(m.ndof);
  // (lying on a table, the piece lies with its curl up: the curvature's sign so its edges rise; free, as it is)
  const flip = o.table && (o.kx + o.ky) > 0 ? -1 : 1;
  const kx = flip * o.kx, ky = flip * o.ky;
  const free = !o.table;
  if (free) m.fixed[0 * 12 + 8] = 1;   // (w = 0 at the middle)
  const kc = o.table ? (o.kc || 1e4 * Math.max(o.p || 0, 1) / Math.max(1e-6, o.h || 1e-3)) : 0;
  const steps = o.steps || 8, bias = o.bias == null ? 0.02 : o.bias;
  const hist = [];
  let res = null;
  for (let s = 1; s <= steps; s++) {
    const lam = s / steps;
    const oo = { A: o.A, D: o.D, nu: o.nu, kx: lam * kx * (1 + bias), ky: lam * ky, p: o.p || 0, table: o.table, kc };
    res = shMinimise(m, d, oo);
    hist.push({ lam, E: res.E, it: res.it });
  }
  // (a last pass with no bias)
  res = shMinimise(m, d, { A: o.A, D: o.D, nu: o.nu, kx, ky, p: o.p || 0, table: o.table, kc });
  // the shape on the whole piece: w at the nodes, mirrored
  const W = [];
  for (let j = -n; j <= n; j++) { const row = []; for (let i = -n; i <= n; i++) row.push(d[m.id(Math.abs(i), Math.abs(j)) * 12 + 8]); W.push(row); }
  const wAt = (i, j) => d[m.id(i, j) * 12 + 8];
  // (heights: on a table, above the table; free, from its middle -- how far each part stands off the middle's plane)
  const hgt = v => o.table ? v : Math.abs(v - wAt(0, 0));
  // (the curvatures at the middle from the element there: κ = −w,xx etc. at its corner node (0, 0))
  const q0 = shShape(0, 0, m.a, m.b), el0 = m.els[0];
  let cxx = 0, cyy = 0;
  for (let nn = 0; nn < 4; nn++) for (let c = 0; c < 4; c++) { const v = d[el0.nodes[nn] * 12 + 8 + c]; cxx += q0.Nxx[nn * 4 + c] * v; cyy += q0.Nyy[nn * 4 + c] * v; }
  const out = {
    n, Lx: o.Lx, Ly: o.Ly, flip, W,
    corner: hgt(wAt(n, n)), edgeX: hgt(wAt(n, 0)), edgeY: hgt(wAt(0, n)), middle: o.table ? wAt(0, 0) : 0,
    kxMid: -cxx * flip, kyMid: -cyy * flip, E: res.E, gnorm: res.gnorm, hist,
    maxSlope: 0,
  };
  // (the steepest slope over the piece: von Kármán holds while it is moderate)
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const k = m.id(i, j) * 12 + 8; out.maxSlope = Math.max(out.maxSlope, Math.hypot(d[k + 1], d[k + 2])); }
  return out;
}

/**
 * The layers of film.js's free film (each { z0, t, E, Q, en }) as the plate's values: its stiffnesses about the
 * neutral plane, its natural curvature and its in-plane natural strain (the size it takes pressed flat).
 */
function shPlate(layers, nu) {
  let S = 0, Sz = 0, An = 0;
  for (const L of layers) { const Et = L.E * L.t; S += Et; Sz += Et * (L.z0 + L.t / 2); }
  const zn = Sz / S;
  let D = 0, Bn = 0;
  for (const L of layers) { const zm = L.z0 + L.t / 2 - zn; D += L.E * (L.t * zm * zm + L.t * L.t * L.t / 12); An += L.E * L.t * L.en; Bn += L.E * L.t * zm * L.en; }
  // (the free plate: equibiaxial -- its natural in-plane strain and curvature, each the stiffness-weighted mean)
  return { A: S, D, nu, zn, eFlat: An / S, kappa: Bn / D, h: layers.reduce((s, L) => s + L.t, 0) };
}

if (typeof module !== 'undefined') module.exports = { shH, shH1, shH2, shShape, shBand, shBandSolve, shMesh, shEnergy, shMinimise, shRun, shPlate };
