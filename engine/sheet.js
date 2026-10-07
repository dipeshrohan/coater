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

/** n widths over L graded toward its far end (the first `ratio` times the last; 1 or none: even). */
function shWidths(L, n, ratio) {
  if (!(ratio > 1)) return Array(n).fill(L / n);
  const q = Math.pow(1 / ratio, 1 / (n - 1)), w0 = L * (1 - q) / (1 - Math.pow(q, n));
  return Array.from({ length: n }, (_, i) => w0 * Math.pow(q, i));
}
/**
 * The piece's mesh: a quarter [0, Lx/2] × [0, Ly/2] (its middle at the origin) with its two mirror lines, or (full) the
 * whole piece [−Lx/2, Lx/2] × [−Ly/2, Ly/2], the quarter's elements mirrored; nx × ny elements on the quarter, graded
 * toward the edges (grade: the middle's element over the edge's; 1 even). Dofs per node: u (4), v (4), w (4) --
 * value, ∂x, ∂y, ∂xy each. Mirror lines: at x = 0, u, u,y, v,x, v,xy, w,x, w,xy vanish; at y = 0, v, v,x, u,y, u,xy,
 * w,y, w,xy vanish. The whole piece: at its middle u, v and v,x (its in-plane rigid moves) fixed. flat: w and its
 * slopes held at 0 everywhere (the piece pressed flat in the stack).
 */
function shMesh(Lx, Ly, nx, ny, opts = {}) {
  const qx = shWidths(Lx / 2, nx, opts.grade), qy = shWidths(Ly / 2, ny, opts.grade), full = !!opts.full;
  const ax = full ? [...qx.slice().reverse(), ...qx] : qx, by = full ? [...qy.slice().reverse(), ...qy] : qy;
  const NX = ax.length, NY = by.length;
  const xs = [full ? -Lx / 2 : 0]; for (const w of ax) xs.push(xs[xs.length - 1] + w);
  const ys = [full ? -Ly / 2 : 0]; for (const w of by) ys.push(ys[ys.length - 1] + w);
  const nn = (NX + 1) * (NY + 1), ndof = nn * 12;
  const id = (i, j) => j * (NX + 1) + i;
  const fixed = new Uint8Array(ndof);
  const U = 0, V = 4, W = 8;   // (field offsets; + 0 value, 1 ∂x, 2 ∂y, 3 ∂xy)
  // (sym, on a quarter: w even ('e') or odd ('o') across the line x = 0, then across y = 0; u, v keep the mirror's
  //  symmetry either way -- the strains hold w only through w,x², w,y² and w,x w,y. Odd across x = 0: w and w,y vanish
  //  there in place of w,x and w,xy)
  const sym = opts.sym || 'ee';
  if (!full) {
    const wx0 = sym[0] === 'o' ? [W + 0, W + 2] : [W + 1, W + 3], wy0 = sym[1] === 'o' ? [W + 0, W + 1] : [W + 2, W + 3];
    for (let j = 0; j <= NY; j++) { const k = id(0, j) * 12; for (const d of [U + 0, U + 2, V + 1, V + 3, ...wx0]) fixed[k + d] = 1; }
    for (let i = 0; i <= NX; i++) { const k = id(i, 0) * 12; for (const d of [V + 0, V + 1, U + 2, U + 3, ...wy0]) fixed[k + d] = 1; }
  } else { const k = id(nx, ny) * 12; for (const d of [U + 0, V + 0, V + 1]) fixed[k + d] = 1; }
  if (opts.flat) for (let n = 0; n < nn; n++) for (let c = 0; c < 4; c++) fixed[n * 12 + W + c] = 1;
  const els = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) els.push({ i, j, a: ax[i], b: by[j], x0: xs[i], y0: ys[j], nodes: [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)] });
  // (numbered along x: the band is (a row's nodes + 2) × 12)
  return { Lx, Ly, nx: NX, ny: NY, nq: [nx, ny], full, sym: full ? null : sym, a: ax[0], b: by[0], xs, ys, nn, ndof, id, fixed, els, bw: 12 * (NX + 3), mid: full ? id(nx, ny) : 0 };
}
/** The shape functions at the Gauss points of an a × b element (cached per size). */
function shShapes(m, a, b) {
  const key = a + '|' + b;
  m.shpc = m.shpc || {};
  if (!m.shpc[key]) m.shpc[key] = SH_G.flatMap(([s, ws]) => SH_G.map(([t, wt]) => ({ ...shShape(s, t, a, b), wq: ws * wt * a * b, s, t })));
  return m.shpc[key];
}
/** Every Gauss point's place: [x, y] per element and point, in the order the energy runs over them. */
const shGaussXY = m => m.els.flatMap(el => shShapes(m, el.a, el.b).map(q => [el.x0 + q.s * el.a, el.y0 + q.t * el.b]));

/**
 * The energy, its gradient and (if asked) its stiffness at dofs d. o: { A, nu, D, kx, ky (natural curvatures),
 * p (weight per area, N/m²; 0 = free), table (a table at w = 0 under it), kc (the table's stiffness per area),
 * and per Gauss point (in shGaussXY's order): eb, kb (natural strain and curvature, 3 each), sA, sD (the stretch and
 * bending stiffness over A and D, 1 each) }.
 */
function shEnergy(m, d, o, withK) {
  const Am = o.A / (1 - o.nu * o.nu), Db = o.D / (1 - o.nu * o.nu), nu = o.nu;
  const g = new Float64Array(m.ndof), K = withK ? shBand(m.ndof, m.bw) : null;
  // (natural fields per Gauss point, 3 each: eb its natural in-plane strain [εx, εy, γxy], kb its natural curvature
  //  [κx, κy, 2κxy]; without them no natural stretch and the uniform kx, ky)
  const eb = o.eb || null, kb = o.kb || null, sA = o.sA || null, sD = o.sD || null;
  let E = 0, gi = 0;
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
    for (const q of shShapes(m, el.a, el.b)) {
      const gq = gi++, bq = 3 * gq, fA = sA ? sA[gq] : 1, fD = sD ? sD[gq] : 1;
      let ux = 0, uy = 0, vx = 0, vy = 0, w = 0, wx = 0, wy = 0, wxx = 0, wyy = 0, wxy = 0;
      for (let k = 0; k < 16; k++) {
        ux += q.Nx[k] * ue[k]; uy += q.Ny[k] * ue[k]; vx += q.Nx[k] * ve[k]; vy += q.Ny[k] * ve[k];
        w += q.N[k] * we[k]; wx += q.Nx[k] * we[k]; wy += q.Ny[k] * we[k]; wxx += q.Nxx[k] * we[k]; wyy += q.Nyy[k] * we[k]; wxy += q.Nxy[k] * we[k];
      }
      const e1 = ux + 0.5 * wx * wx - (eb ? eb[bq] : 0), e2 = vy + 0.5 * wy * wy - (eb ? eb[bq + 1] : 0), e3 = uy + vx + wx * wy - (eb ? eb[bq + 2] : 0);
      const k1 = -wxx - (kb ? kb[bq] : o.kx), k2 = -wyy - (kb ? kb[bq + 1] : o.ky), k3 = -2 * wxy - (kb ? kb[bq + 2] : 0);
      const Aq = fA * Am, Dq = fD * Db;
      const N1 = Aq * (e1 + nu * e2), N2 = Aq * (e2 + nu * e1), N3 = Aq * (1 - nu) / 2 * e3;
      const M1 = Dq * (k1 + nu * k2), M2 = Dq * (k2 + nu * k1), M3 = Dq * (1 - nu) / 2 * k3;
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
        for (let i = 0; i < 3; i++) for (let c = 0; c < 48; c++) CBm[i * 48 + c] = fA * (Cm[i * 3] * Bm[c] + Cm[i * 3 + 1] * Bm[48 + c] + Cm[i * 3 + 2] * Bm[96 + c]);
        for (let c = 0; c < 16; c++) { const b0 = -q.Nxx[c], b1 = -q.Nyy[c], b2 = -2 * q.Nxy[c]; Bb[c] = b0; Bb[16 + c] = b1; Bb[32 + c] = b2;
          CBb[c] = fD * (Cb[0] * b0 + Cb[1] * b1); CBb[16 + c] = fD * (Cb[3] * b0 + Cb[4] * b1); CBb[32 + c] = fD * Cb[8] * b2; }
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
function shMinimise(m, d, o, { tol = 1e-9, maxIt = 60, log = null, remember = false } = {}) {
  // (remember: when the plain step fails, start the shift from a tenth of the last that worked, not from 1e-8 -- fewer
  //  failed factorizations deep past buckling; the let-go pieces use it, the as-cut piece keeps its path)
  let cur = shEnergy(m, d, o, true), mu = 0, it = 0, muOk = 0;
  const gnorm = g => { let s = 0; for (let i = 0; i < g.length; i++) s += g[i] * g[i]; return Math.sqrt(s); };
  const g0 = Math.max(gnorm(cur.g), 1e-30), scaleE = Math.abs(cur.E) + 1e-30;
  for (; it < maxIt; it++) {
    const gn = gnorm(cur.g);
    if (gn < tol * Math.max(1, g0) || gn < 1e-14) break;
    let step = null;
    for (let tries = 0; tries < 30 && !step; tries++) {
      step = shBandSolve(cur.K, cur.g.map(v => -v), mu);
      if (!step) mu = mu ? mu * 10 : (remember && muOk > 0 ? Math.max(1e-8, muOk / 10) : 1e-8);
    }
    if (mu > 0) muOk = mu;
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
    if (log) log({ it, gn, mu, t, E: cur.E });
    mu = t === 1 ? mu / 10 : mu;
    if (mu < 1e-12) mu = 0;
  }
  return { E: cur.E, gnorm: gnorm(cur.g), it, K: cur.K };
}

/**
 * The strains at every Gauss point (shGaussXY's order), 7 each: the stretch [εx, εy, γxy] (w's part in), the
 * curvature [κx, κy, 2κxy] (κ = −w,xx, …) and w.
 */
function shGP(m, d) {
  const out = new Float64Array(7 * m.els.length * SH_G.length * SH_G.length);
  const ue = new Float64Array(16), ve = new Float64Array(16), we = new Float64Array(16);
  let o = 0;
  for (const el of m.els) {
    for (let n = 0; n < 4; n++) for (let c = 0; c < 4; c++) { const k = el.nodes[n] * 12; ue[n * 4 + c] = d[k + c]; ve[n * 4 + c] = d[k + 4 + c]; we[n * 4 + c] = d[k + 8 + c]; }
    for (const q of shShapes(m, el.a, el.b)) {
      let ux = 0, uy = 0, vx = 0, vy = 0, w = 0, wx = 0, wy = 0, wxx = 0, wyy = 0, wxy = 0;
      for (let k = 0; k < 16; k++) {
        ux += q.Nx[k] * ue[k]; uy += q.Ny[k] * ue[k]; vx += q.Nx[k] * ve[k]; vy += q.Ny[k] * ve[k];
        w += q.N[k] * we[k]; wx += q.Nx[k] * we[k]; wy += q.Ny[k] * we[k]; wxx += q.Nxx[k] * we[k]; wyy += q.Nyy[k] * we[k]; wxy += q.Nxy[k] * we[k];
      }
      out[o++] = ux + 0.5 * wx * wx; out[o++] = vy + 0.5 * wy * wy; out[o++] = uy + vx + wx * wy;
      out[o++] = -wxx; out[o++] = -wyy; out[o++] = -2 * wxy; out[o++] = w;
    }
  }
  return out;
}

/**
 * The piece held flat (w = 0): its stretch alone, a linear problem solved at once -- the energy ½ ∫ (ε − eb)ᵀ C sA
 * (ε − eb), ε = [u,x, v,y, u,y + v,x]. o: { A, nu, eb, sA } per Gauss point as shEnergy's. Returns the dofs (in the
 * mesh's layout, w zero) and the strains at the Gauss points as shGP's.
 */
function shFlat(m, o) {
  const nn = m.nn, N = nn * 8, bw = 8 * (m.nx + 3), w1 = bw + 1, Am = o.A / (1 - o.nu * o.nu), nu = o.nu;
  const Kb = new Float64Array(N * w1), f = new Float64Array(N), ids = new Int32Array(32);
  const fixed = new Uint8Array(N);
  for (let k = 0; k < nn; k++) for (let c = 0; c < 8; c++) fixed[k * 8 + c] = m.fixed[k * 12 + c];
  const ke = new Float64Array(32 * 32), fe = new Float64Array(32), B = new Float64Array(96);
  let gi = 0;
  for (const el of m.els) {
    for (let n = 0; n < 4; n++) for (let c = 0; c < 4; c++) { ids[n * 4 + c] = el.nodes[n] * 8 + c; ids[16 + n * 4 + c] = el.nodes[n] * 8 + 4 + c; }
    ke.fill(0); fe.fill(0);
    for (const q of shShapes(m, el.a, el.b)) {
      const g = gi++, a = (o.sA ? o.sA[g] : 1) * Am * q.wq, e1 = o.eb ? o.eb[3 * g] : 0, e2 = o.eb ? o.eb[3 * g + 1] : 0, e3 = o.eb ? o.eb[3 * g + 2] : 0;
      B.fill(0);
      for (let k = 0; k < 16; k++) { B[k] = q.Nx[k]; B[32 + 16 + k] = q.Ny[k]; B[64 + k] = q.Ny[k]; B[64 + 16 + k] = q.Nx[k]; }
      const s1 = a * (e1 + nu * e2), s2 = a * (e2 + nu * e1), s3 = a * (1 - nu) / 2 * e3;
      for (let r = 0; r < 32; r++) {
        const b0 = B[r], b1 = B[32 + r], b2 = B[64 + r];
        fe[r] += b0 * s1 + b1 * s2 + b2 * s3;
        const c0 = a * (b0 + nu * b1), c1 = a * (b1 + nu * b0), c2 = a * (1 - nu) / 2 * b2;
        for (let c = 0; c <= r; c++) ke[r * 32 + c] += c0 * B[c] + c1 * B[32 + c] + c2 * B[64 + c];
      }
    }
    for (let r = 0; r < 32; r++) {
      const gr = ids[r];
      f[gr] += fe[r];
      for (let c = 0; c <= r; c++) { const v = ke[r * 32 + c]; if (!v) continue; let i = gr, j = ids[c]; if (j > i) { const t = i; i = j; j = t; } Kb[i * w1 + (i - j)] += v; }
    }
  }
  for (let i = 0; i < N; i++) {
    if (fixed[i]) f[i] = 0;
    for (let dd = 0; dd <= bw && i - dd >= 0; dd++) if (fixed[i] || fixed[i - dd]) Kb[i * w1 + dd] = dd === 0 && fixed[i] ? 1 : 0;
  }
  const M = { n: N, bw, a: Kb, diag: null };
  const x = shBandSolve(M, f, 0);
  if (!x) throw new Error('the piece held flat: its stiffness is not positive definite');
  const d = new Float64Array(m.ndof);
  for (let k = 0; k < nn; k++) for (let c = 0; c < 8; c++) d[k * 12 + c] = x[k * 8 + c];
  return { d, st: shGP(m, d) };
}

/** Is the stiffness at d positive definite (a stable shape, not a saddle)? */
const shStable = (m, d, o) => !!shBandSolve(shEnergy(m, d, o, true).K, new Float64Array(m.ndof));

/**
 * A small smooth disturbance of w (a seeded sum of waves in the mesh's symmetry), as nodal dofs added to d: to start a
 * flat piece off a saddle. amp (m) its largest height.
 */
function shSeed(m, d, amp, seed = 1) {
  let r = seed >>> 0 || 1;
  const rnd = () => { r = (Math.imul(r, 1664525) + 1013904223) >>> 0; return r / 4294967296 * 2 - 1; };
  const cls = m.full ? null : m.sym, M = 6, modes = [];
  // (the waves in ξ = 2x/Lx: cos(kπξ/2) with k even is even, sin(kπξ/2) is odd; a whole piece takes both)
  const kinds = c => c === 'e' ? [0] : c === 'o' ? [1] : [0, 1];
  for (let i = 0; i <= M; i++) for (let j = 0; j <= M; j++) for (const kx of kinds(cls ? cls[0] : null)) for (const ky of kinds(cls ? cls[1] : null)) {
    if ((kx === 0 && i % 2) || (ky === 0 && j % 2) || (kx === 1 && !i) || (ky === 1 && !j)) continue;
    if (!i && !j) continue;
    modes.push({ i, j, kx, ky, c: rnd() / (1 + i * i + j * j) });
  }
  const f = (x, y) => {
    let v = 0, vx = 0, vy = 0, vxy = 0;
    for (const md of modes) {
      const ax = md.i * Math.PI / m.Lx, ay = md.j * Math.PI / m.Ly;
      const X = md.kx ? [Math.sin(ax * x), ax * Math.cos(ax * x)] : [Math.cos(ax * x), -ax * Math.sin(ax * x)];
      const Y = md.ky ? [Math.sin(ay * y), ay * Math.cos(ay * y)] : [Math.cos(ay * y), -ay * Math.sin(ay * y)];
      v += md.c * X[0] * Y[0]; vx += md.c * X[1] * Y[0]; vy += md.c * X[0] * Y[1]; vxy += md.c * X[1] * Y[1];
    }
    return [v, vx, vy, vxy];
  };
  let big = 0; const vals = [];
  for (let j = 0; j <= m.ny; j++) for (let i = 0; i <= m.nx; i++) { const q = f(m.xs[i], m.ys[j]); vals.push(q); big = Math.max(big, Math.abs(q[0])); }
  const sc = big > 0 ? amp / big : 0;
  vals.forEach((q, n) => { for (let c = 0; c < 4; c++) if (!m.fixed[n * 12 + 8 + c]) d[n * 12 + 8 + c] += sc * q[c]; });
}

/**
 * A piece let go (GO-4f): natural fields over it, released free or onto a table. o: { Lx, Ly, A, D, nu, p, table, h,
 * kc, n (elements along each half), grade, sym ('ee', 'eo', 'oe', 'oo' on a quarter; 'full' the whole piece),
 * fields (x, y) → { e: [εx, εy, γxy] natural strain, k: [κx, κy, 2κxy] natural curvature, sA, sD (stiffness over A
 * and D) } -- or gp: the same per Gauss point of the mesh, as arrays { eb, kb, sA, sD } --, steps, seed (the
 * disturbance's height, m) }. The fields raised in steps from 0; after each, a saddle is left by a fresh disturbance.
 * Returns the shape on the nodes (xs, ys, W over the whole piece), its energy, the heights.
 */
function shRelease(o) {
  const n = o.n || 8, full = o.sym === 'full', m = shMesh(o.Lx, o.Ly, n, n, { grade: o.grade, full, sym: full ? 'ee' : (o.sym || 'ee') });
  const G = shGaussXY(m), ng = G.length;
  let eb, kb, sA, sD;
  if (o.gp) ({ eb, kb, sA, sD } = o.gp);
  else {
    eb = new Float64Array(3 * ng); kb = new Float64Array(3 * ng); sA = new Float64Array(ng); sD = new Float64Array(ng);
    G.forEach(([x, y], g) => { const F = o.fields(x, y); for (let c = 0; c < 3; c++) { eb[3 * g + c] = F.e[c]; kb[3 * g + c] = F.k[c]; } sA[g] = F.sA == null ? 1 : F.sA; sD[g] = F.sD == null ? 1 : F.sD; });
  }
  // (the stretch's uniform part out -- a size change only, taken up exactly by u and v; the stiffness-weighted mean)
  const wts = m.els.flatMap(el => shShapes(m, el.a, el.b).map(q => q.wq));
  let s1 = 0, s2 = 0, sw = 0; for (let g = 0; g < ng; g++) { const w = wts[g] * sA[g]; s1 += w * eb[3 * g]; s2 += w * eb[3 * g + 1]; sw += w; }
  const e0 = [s1 / sw, s2 / sw];
  let kMean = 0, kw = 0; for (let g = 0; g < ng; g++) { kMean += wts[g] * (kb[3 * g] + kb[3 * g + 1]); kw += 2 * wts[g]; }
  kMean /= kw;
  // (on a table it lies with its curl up)
  const flip = o.table && kMean > 0 ? -1 : 1;
  const eb0 = Float64Array.from(eb, (v, i) => v - (i % 3 === 2 ? 0 : e0[i % 3])), kb0 = Float64Array.from(kb, v => flip * v);
  const d = new Float64Array(m.ndof);
  // (held up: no weight, its rigid moves out -- the middle's height, and its tilts where its symmetry allows them
  //  (w = a x is odd across x = 0). On a table: its weight, the table under it; only a shape even both ways (or the
  //  whole piece) can lie on a table -- an odd one would dip below it on one side)
  if (o.table && !full && m.sym !== 'ee') throw new Error('the piece: only a shape even both ways can lie on a table');
  if (!o.table) { const k = m.mid * 12 + 8; if (full || m.sym === 'ee') m.fixed[k] = 1; if (full || m.sym === 'oe') m.fixed[k + 1] = 1; if (full || m.sym === 'eo') m.fixed[k + 2] = 1; }
  const kc = o.table ? (o.kc || 1e4 * Math.max(o.p || 0, 1) / Math.max(1e-6, o.h || 1e-3)) : 0;
  // (the fields raised geometrically, doubling from 2^−(steps−1): past buckling the shape grows as the root of the
  //  field's excess, so each step starts from the last one's w times √2 and u, v times 2)
  const steps = o.steps || 9, amp = o.seed || 0.05 * (o.h || 1e-4), hist = [];
  let res = null, seeds = 0, lamOld = 0;
  shSeed(m, d, amp, 1);
  for (let s = 1; s <= steps; s++) {
    const lam = Math.pow(2, s - steps);
    if (lamOld > 0) { const fu = lam / lamOld, fw = Math.sqrt(fu); for (let i = 0; i < m.ndof; i++) if (!m.fixed[i]) d[i] *= (i % 12) >= 8 ? fw : fu; }
    const oo = { A: o.A, D: o.D, nu: o.nu, p: o.table ? o.p || 0 : 0, table: o.table, kc, eb: eb0.map(v => lam * v), kb: kb0.map(v => lam * v), sA, sD, kx: 0, ky: 0 };
    // (stable: its stiffness where it settled positive definite -- the minimiser's last, no new assembly)
    const settled = () => { res = shMinimise(m, d, oo, { maxIt: o.maxIt || 100, remember: true }); return !!shBandSolve(res.K, new Float64Array(m.ndof)); };
    let stable = settled();
    for (let k = 0; k < 4 && !stable; k++) { shSeed(m, d, amp, 2 + seeds++); stable = settled(); }
    hist.push({ lam, E: res.E, it: res.it, gnorm: res.gnorm, stable });
    lamOld = lam;
  }
  // (the shape over the whole piece: a quarter mirrored, w's sign by its symmetry)
  const sx = full ? null : (m.sym[0] === 'o' ? -1 : 1), sy = full ? null : (m.sym[1] === 'o' ? -1 : 1);
  const xs = full ? m.xs.slice() : [...m.xs.slice(1).reverse().map(v => -v), ...m.xs];
  const ys = full ? m.ys.slice() : [...m.ys.slice(1).reverse().map(v => -v), ...m.ys];
  const W = [];
  const NXq = m.nx, NYq = m.ny;
  for (let j = 0; j < ys.length; j++) {
    const row = [];
    for (let i = 0; i < xs.length; i++) {
      if (full) { row.push(d[m.id(i, j) * 12 + 8]); continue; }
      const iq = Math.abs(i - NXq), jq = Math.abs(j - NYq), sg = (i < NXq ? sx : 1) * (j < NYq ? sy : 1);
      row.push(sg * d[m.id(iq, jq) * 12 + 8]);
    }
    W.push(row);
  }
  const wMid = d[m.mid * 12 + 8];
  let top = -Infinity, bot = Infinity; for (const row of W) for (const v of row) { top = Math.max(top, v); bot = Math.min(bot, v); }
  let maxSlope = 0; for (let k = 0; k < m.nn; k++) maxSlope = Math.max(maxSlope, Math.hypot(d[k * 12 + 9], d[k * 12 + 10]));
  return { m, d, xs, ys, W, E: res.E, gnorm: res.gnorm, hist, flip, e0, kMean, stable: hist[hist.length - 1].stable, high: o.table ? top : top - bot, wMid, maxSlope, seeds, gp: { eb: eb0, kb: kb0, sA, sD } };
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

if (typeof module !== 'undefined') module.exports = { shH, shH1, shH2, shShape, shBand, shBandSolve, shWidths, shMesh, shShapes, shGaussXY, shEnergy, shMinimise, shGP, shFlat, shStable, shSeed, shRelease, shRun, shPlate };
