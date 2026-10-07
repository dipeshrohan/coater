'use strict';
/*
 * mix-mp.js — MP-MIX 2D and 3D: the double planetary mixer's batch in a horizontal slice and in the whole vessel (the 1D,
 * the batch taken as well mixed, is mixer.js's). Finite volumes on a fixed staggered (MAC) Cartesian grid over the vessel:
 * the velocity on the cells' faces, the pressure at their centres. The vessel's wall, the blades' bars and the disperser's
 * disc (its shaft above it) are solids moving through the fixed grid, by Brinkman penalization: on each face the share χ
 * of it inside a solid (sampled over the face's cell), a drag λ χ (u − u_s) toward the solid's own velocity u_s (the arm's
 * turn carrying the blade's or the disc's axis, plus its own spin), λ = C_λ μ_ref / h². Nothing is remeshed as they move.
 *
 * The paste: generalized Newtonian, μ(γ̇) the batch's at the program step (the 1D's table, log–log), the shear rate
 * γ̇ = √(2 D:D) from the velocity; its inertia ρ Du/Dt in time (2D), BDF2 with the convection linearized about the
 * extrapolated velocity (central, upwind where a cell's Péclet number passes 2). Per step one coupled velocity–pressure
 * solve: FGMRES, preconditioned by a multigrid V-cycle whose smoother is Vanka's coupled cell relaxation (SCGS: each
 * cell's faces and pressure together), the coarse grids rediscretized (viscosity and drag averaged), the coarsest kept
 * fine enough to see the solids.
 *
 * What it gives: the force, torque and power of each moving part (the drag the solid puts on the paste, summed); the
 * fields (speed, shear rate, viscosity, stress, the heat made, pressure); the temperature (the heat made by the shear,
 * carried by the paste, the jacket on the wall); tracers (the shear each parcel sees, dead zones, mixing).
 *
 * SI inside (m, s, kg, Pa); temperatures in °C. Pure computation, no DOM. Checked in mix-mp.validate.js.
 */

// ---------------------------------------------------------------------------------------------------------------------
// The paste's viscosity
// ---------------------------------------------------------------------------------------------------------------------
/** μ(γ̇) from a table [[γ̇, μ], ...] (rising γ̇), log–log between its points, flat beyond its ends. */
function mxLaw(tab) {
  const n = tab.length, lg = tab.map(q => Math.log(q[0])), lm = tab.map(q => Math.log(q[1]));
  return gd => {
    const x = Math.log(Math.max(gd, 1e-12));
    if (x <= lg[0]) return Math.exp(lm[0]);
    if (x >= lg[n - 1]) return Math.exp(lm[n - 1]);
    let a = 0, b = n - 1; while (b - a > 1) { const m = (a + b) >> 1; if (lg[m] <= x) a = m; else b = m; }
    return Math.exp(lm[a] + (x - lg[a]) / (lg[b] - lg[a]) * (lm[b] - lm[a]));
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The solids and how they move
// ---------------------------------------------------------------------------------------------------------------------
/**
 * The solids at time t (each: own (0 the vessel's wall, 1 … nBlade the blades, nBlade + 1 the disc), z0, z1 (its heights),
 * bb (its box in x, y), inside(x, y), vel (x, y) -> [vx, vy] (a rigid body: its axis carried round by the arm, its own spin)).
 * o: { D, ro, rs, nBlade, nBar, w, t, db, ratio, dir, No (arm, 1/s), Nd (disc, 1/s, on the arm), rD, Dd, tD, hD, hT, nT,
 * dS, phi0 (the arm's angle at t = 0), phB (each next blade's frame turned by this against the one before, rad: they
 * intermesh; default half the bars' spacing), wall: { W (its own spin, rad/s) } (the checks'), extra: [solids] (the checks') }.
 */
function mxSolids(o, t) {
  const S = [], R = o.D / 2, Wa = 2 * Math.PI * (o.No || 0), ph = (o.phi0 || 0) + Wa * t;
  // the vessel's wall: everything outside r = R (the checks may spin it)
  // (a spinning wall -- the checks' -- turns at W out to R + band, then winds down to rest by R + 2 band: any purely
  //  azimuthal velocity has no divergence, so it meets the box's still edges without pushing on the paste)
  const Ww = o.wall && o.wall.W || 0, band = o.wall && o.wall.band || 0.02 * R;
  const wf = r => (r <= R + band ? 1 : r >= R + 2 * band ? 0 : (R + 2 * band - r) / band);
  S.push({ own: 0, z0: -Infinity, z1: Infinity, outside: R, inside: (x, y) => x * x + y * y > R * R, vel: Ww ? (x, y) => { const f = Ww * wf(Math.hypot(x, y)); return [-f * y, f * x]; } : () => [0, 0] });
  if (o.extra) for (const e of o.extra) S.push(e);
  if (!(o.nBlade > 0)) return S;
  const Wb = Wa * (1 + o.dir * o.ratio), ht = o.t / 2;
  // (the gaps to the wall and the floor kept at least gapW and gapF: a grid too coarse to see a gap would close it, the bar
  //  then a scraper; the run sets them from its cells -- refined, they come back to the true gaps)
  const rsE = Math.min(o.rs, R - o.ro - (o.gapW || 0)), dbE = Math.max(o.db, o.gapF || 0);
  for (let b = 0; b < o.nBlade; b++) {
    const ab = ph + 2 * Math.PI * b / o.nBlade, cx = o.ro * Math.cos(ab), cy = o.ro * Math.sin(ab), psi = ab + (o.psi0 || 0) + b * (o.phB ?? Math.PI / o.nBar) + (Wb - Wa) * t;
    const vel = (x, y) => [-Wa * cy - Wb * (y - cy), Wa * cx + Wb * (x - cx)];
    for (let k = 0; k < o.nBar; k++) {
      const th = psi + 2 * Math.PI * k / o.nBar, ex = Math.cos(th), ey = Math.sin(th);
      const rect = (s0, s1, z0, z1) => {
        const xs = [s0 * ex - ht * ey, s0 * ex + ht * ey, s1 * ex - ht * ey, s1 * ex + ht * ey], ys = [s0 * ey + ht * ex, s0 * ey - ht * ex, s1 * ey + ht * ex, s1 * ey - ht * ex];
        S.push({ own: 1 + b, z0, z1, bb: [cx + Math.min(...xs), cy + Math.min(...ys), cx + Math.max(...xs), cy + Math.max(...ys)], poly: [0, 2, 3, 1].map(n => [cx + xs[n], cy + ys[n]]),
          inside: (x, y) => { const dx = x - cx, dy = y - cy, s = dx * ex + dy * ey, q = -dx * ey + dy * ex; return s >= s0 && s <= s1 && q >= -ht && q <= ht; }, vel });
      };
      // the vertical bar (its width radial, out to rs: the gap to the wall), from the floor's gap up; the frame's bottom bar
      // from the axis out to it, w high
      rect(o.rs - o.w, rsE, dbE, Infinity);
      rect(0, o.rs - o.w, dbE, dbE + o.w);
    }
  }
  if (o.Nd > 0 || o.discAlways) {
    const ad = ph + Math.PI / o.nBlade, cx = o.rD * Math.cos(ad), cy = o.rD * Math.sin(ad), Wd = Wa + 2 * Math.PI * o.Nd, Rd = o.Dd / 2;
    const vel = (x, y) => [-Wa * cy - Wd * (y - cy), Wa * cx + Wd * (x - cx)], own = o.nBlade + 1, sp = Wd * t;
    S.push({ own, z0: o.hD - o.tD / 2, z1: o.hD + o.tD / 2, bb: [cx - Rd, cy - Rd, cx + Rd, cy + Rd], circ: [cx, cy, Rd], inside: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= Rd * Rd, vel });
    // its teeth: tabs at the rim, alternately up and down, each half a pitch round and as thick as the disc
    for (let k = 0; k < (o.nT || 0); k++) {
      const a0 = sp + 2 * Math.PI * k / o.nT, up = k % 2 === 0;
      S.push({ own, z0: up ? o.hD : o.hD - o.hT, z1: up ? o.hD + o.hT : o.hD, bb: [cx - Rd, cy - Rd, cx + Rd, cy + Rd], vel, tooth: [cx, cy, Rd - o.tD, Rd, a0, a0 + Math.PI / o.nT],
        inside: (x, y) => { const dx = x - cx, dy = y - cy, r2 = dx * dx + dy * dy; if (r2 > Rd * Rd || r2 < (Rd - o.tD) ** 2) return false; let a = Math.atan2(dy, dx) - a0; a -= 2 * Math.PI * Math.floor(a / (2 * Math.PI)); return a <= Math.PI / o.nT; } });
    }
    const rs2 = (o.dS || 0) / 2;
    if (rs2 > 0) S.push({ own, z0: o.hD, z1: Infinity, bb: [cx - rs2, cy - rs2, cx + rs2, cy + rs2], circ: [cx, cy, rs2], shaft: true, inside: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= rs2 * rs2, vel });
  }
  return S;
}
/** The solids a horizontal slice at height zs cuts. */
const mxSlice = (S, zs) => S.filter(s => zs >= s.z0 && zs <= s.z1);

// ---------------------------------------------------------------------------------------------------------------------
// 2D: the grid, the operator, Vanka's smoother, the multigrid
// ---------------------------------------------------------------------------------------------------------------------
/** A square grid of N × N cells of side h, centred on the vessel's axis. */
function mx2Grid(N, h) { return { N, h, x0: -N * h / 2, nu: (N + 1) * N, nv: N * (N + 1), np: N * N, nk: (N + 1) * (N + 1) }; }
const mx2Vec = G => ({ u: new Float64Array(G.nu), v: new Float64Array(G.nv), p: new Float64Array(G.np) });
/**
 * A level: its grid and coefficients -- muC (cells), muK (corners), lamU, lamV (the drag λ χ on the faces), rhoA (ρ α / Δt,
 * the time derivative's), and on the finest the convecting velocity (cu at the u-faces, cv at the v-faces, rho).
 */
function mx2Diag(L) {
  const G = L.G, N = G.N, h2 = G.h * G.h, { muC, muK, lamU, lamV, rhoA } = L, au = new Float64Array(G.nu), av = new Float64Array(G.nv), cu = L.cu, cv = L.cv, rho = L.rho || 0, h = G.h;
  for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) {
    const k = i + (N + 1) * j;
    if (i === 0 || i === N) { au[k] = 0; continue; }
    let a = rhoA + lamU[k] + (2 * muC[i + N * j] + 2 * muC[i - 1 + N * j] + muK[i + (N + 1) * (j + 1)] + muK[i + (N + 1) * j]) / h2;
    if (cu && rho) { const m = (muC[i + N * j] + muC[i - 1 + N * j]) / 2, U = cu[k], V = mx2Vbar(L, i, j); if (rho * Math.abs(U) * h > 2 * m) a += rho * Math.abs(U) / h; if (rho * Math.abs(V) * h > 2 * m) a += rho * Math.abs(V) / h; }
    au[k] = a;
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) {
    const k = i + N * j;
    if (j === 0 || j === N) { av[k] = 0; continue; }
    let a = rhoA + lamV[k] + (2 * muC[i + N * j] + 2 * muC[i + N * (j - 1)] + muK[i + 1 + (N + 1) * j] + muK[i + (N + 1) * j]) / h2;
    if (cv && rho) { const m = (muC[i + N * j] + muC[i + N * (j - 1)]) / 2, V = cv[k], U = mx2Ubar(L, i, j); if (rho * Math.abs(U) * h > 2 * m) a += rho * Math.abs(U) / h; if (rho * Math.abs(V) * h > 2 * m) a += rho * Math.abs(V) / h; }
    av[k] = a;
  }
  L.au = au; L.av = av;
}
// (the convecting velocity's other component at a face: the four round it)
const mx2Vbar = (L, i, j) => { const N = L.G.N, v = L.cv; return (v[i + N * (j + 1)] + v[i - 1 + N * (j + 1)] + v[i + N * j] + v[i - 1 + N * j]) / 4; };
const mx2Ubar = (L, i, j) => { const N = L.G.N, u = L.cu; return (u[i + 1 + (N + 1) * j] + u[i + (N + 1) * j] + u[i + 1 + (N + 1) * (j - 1)] + u[i + (N + 1) * (j - 1)]) / 4; };
/**
 * The momentum equations' left sides at a face, for a level and a state: ru(i, j) at u-face (i, j), rv(i, j) at v-face
 * (i, j) (a Dirichlet face: its value). The arrays bound once (the smoother and the operator call these per face).
 */
function mx2Rows(L, X) {
  const G = L.G, N = G.N, N1 = N + 1, h = G.h, ih = 1 / h, ih2 = ih * ih, u = X.u, v = X.v, p = X.p, muC = L.muC, muK = L.muK, lamU = L.lamU, lamV = L.lamV, rhoA = L.rhoA;
  const cu = L.cu, cvv = L.cv, rho = L.rho || 0, conv = !!(cu && rho);
  const ru = (i, j) => {
    const k = i + N1 * j;
    if (i === 0 || i === N) return u[k];
    const uC = u[k], uE = u[k + 1], uW = u[k - 1], uN = j < N - 1 ? u[k + N1] : 0, uS = j > 0 ? u[k - N1] : 0;
    const c = i + N * j, mE = muC[c], mW = muC[c - 1], kk = i + N1 * j, mN = muK[kk + N1], mS = muK[kk];
    let r = (rhoA + lamU[k]) * uC - (2 * mE * (uE - uC) - 2 * mW * (uC - uW) + mN * (uN - uC + v[c + N] - v[c + N - 1]) - mS * (uC - uS + v[c] - v[c - 1])) * ih2 + (p[c] - p[c - 1]) * ih;
    if (conv) {
      const U = cu[k], V = (cvv[c + N] + cvv[c + N - 1] + cvv[c] + cvv[c - 1]) * 0.25, m2 = mE + mW;
      r += rho * (rho * (U < 0 ? -U : U) * h > m2 ? (U > 0 ? U * (uC - uW) : U * (uE - uC)) * ih : U * (uE - uW) * 0.5 * ih);
      r += rho * (rho * (V < 0 ? -V : V) * h > m2 ? (V > 0 ? V * (uC - uS) : V * (uN - uC)) * ih : V * (uN - uS) * 0.5 * ih);
    }
    return r;
  };
  const rv = (i, j) => {
    const k = i + N * j;
    if (j === 0 || j === N) return v[k];
    const vC = v[k], vN = v[k + N], vS = v[k - N], vE = i < N - 1 ? v[k + 1] : 0, vW = i > 0 ? v[k - 1] : 0;
    const mN = muC[k], mS = muC[k - N], kk = i + N1 * j, mE = muK[kk + 1], mW = muK[kk];
    let r = (rhoA + lamV[k]) * vC - (2 * mN * (vN - vC) - 2 * mS * (vC - vS) + mE * (vE - vC + u[kk + 1] - u[kk + 1 - N1]) - mW * (vC - vW + u[kk] - u[kk - N1])) * ih2 + (p[k] - p[k - N]) * ih;
    if (conv) {
      const V = cvv[k], U = (cu[kk + 1] + cu[kk] + cu[kk + 1 - N1] + cu[kk - N1]) * 0.25, m2 = mN + mS;
      r += rho * (rho * (U < 0 ? -U : U) * h > m2 ? (U > 0 ? U * (vC - vW) : U * (vE - vC)) * ih : U * (vE - vW) * 0.5 * ih);
      r += rho * (rho * (V < 0 ? -V : V) * h > m2 ? (V > 0 ? V * (vC - vS) : V * (vN - vC)) * ih : V * (vN - vS) * 0.5 * ih);
    }
    return r;
  };
  return { ru, rv };
}
const mx2RowU = (L, X, i, j) => mx2Rows(L, X).ru(i, j), mx2RowV = (L, X, i, j) => mx2Rows(L, X).rv(i, j);
/** y = A x: the momentum rows and the continuity's (−div u, so the system is symmetric without the convection). */
function mx2Apply(L, X, Y) {
  const G = L.G, N = G.N, h = G.h, { ru, rv } = mx2Rows(L, X), yu = Y.u, yv = Y.v, yp = Y.p, u = X.u, v = X.v;
  for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) yu[i + (N + 1) * j] = ru(i, j);
  for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) yv[i + N * j] = rv(i, j);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) yp[i + N * j] = -(u[i + 1 + (N + 1) * j] - u[i + (N + 1) * j] + v[i + N * (j + 1)] - v[i + N * j]) / h;
}
/** Vanka's coupled cell relaxation (SCGS): each cell's four faces and its pressure from their local system (the faces'
 *  own diagonals and the pressure's coupling), swept forward then back. */
function mx2Smooth(L, X, B, sweeps, om) {
  const G = L.G, N = G.N, h = G.h, g = 1 / h, au = L.au, av = L.av, u = X.u, v = X.v, p = X.p, bu = B.u, bv = B.v, bp = B.p, { ru, rv } = mx2Rows(L, X);
  for (let s = 0; s < sweeps; s++) for (let pass = 0; pass < 2; pass++) for (let jj = 0; jj < N; jj++) for (let ii = 0; ii < N; ii++) {
    const i = pass ? N - 1 - ii : ii, j = pass ? N - 1 - jj : jj;
    const kL = i + (N + 1) * j, kR = kL + 1, kB = i + N * j, kT = kB + N;
    const aL = au[kL], aR = au[kR], aB = av[kB], aT = av[kT];
    const rL = aL ? bu[kL] - ru(i, j) : 0, rR = aR ? bu[kR] - ru(i + 1, j) : 0, rB = aB ? bv[kB] - rv(i, j) : 0, rT = aT ? bv[kT] - rv(i, j + 1) : 0;
    const rp = bp[kB] + (u[kR] - u[kL] + v[kT] - v[kB]) * g;
    let num = -rp, den = 0;
    if (aL) { num += g * rL / aL; den += g * g / aL; } if (aR) { num -= g * rR / aR; den += g * g / aR; }
    if (aB) { num += g * rB / aB; den += g * g / aB; } if (aT) { num -= g * rT / aT; den += g * g / aT; }
    const dp = den > 0 ? num / den : 0;
    if (aL) u[kL] += om * (rL - g * dp) / aL; if (aR) u[kR] += om * (rR + g * dp) / aR;
    if (aB) v[kB] += om * (rB - g * dp) / aB; if (aT) v[kT] += om * (rT + g * dp) / aT;
    p[kB] += om * dp;
  }
}
/** The next coarser level: the viscosity averaged over the four cells (corners: the coinciding fine corner), the drag
 *  over the two fine faces on each coarse face. */
function mx2Coarsen(L) {
  const G = L.G, N = G.N, n = N / 2, C = mx2Grid(n, G.h * 2), muC = new Float64Array(C.np), muK = new Float64Array(C.nk), lamU = new Float64Array(C.nu), lamV = new Float64Array(C.nv);
  for (let J = 0; J < n; J++) for (let I = 0; I < n; I++) muC[I + n * J] = (L.muC[2 * I + N * 2 * J] + L.muC[2 * I + 1 + N * 2 * J] + L.muC[2 * I + N * (2 * J + 1)] + L.muC[2 * I + 1 + N * (2 * J + 1)]) / 4;
  for (let J = 0; J <= n; J++) for (let I = 0; I <= n; I++) muK[I + (n + 1) * J] = L.muK[2 * I + (N + 1) * 2 * J];
  for (let J = 0; J < n; J++) for (let I = 0; I <= n; I++) lamU[I + (n + 1) * J] = (L.lamU[2 * I + (N + 1) * 2 * J] + L.lamU[2 * I + (N + 1) * (2 * J + 1)]) / 2;
  for (let J = 0; J <= n; J++) for (let I = 0; I < n; I++) lamV[I + n * J] = (L.lamV[2 * I + N * 2 * J] + L.lamV[2 * I + 1 + N * 2 * J]) / 2;
  const c = { G: C, muC, muK, lamU, lamV, rhoA: L.rhoA }; mx2Diag(c); return c;
}
function mx2Restrict(L, C, r) {
  const G = L.G, N = G.N, n = C.G.N, o = mx2Vec(C.G);
  for (let J = 0; J < n; J++) for (let I = 1; I < n; I++) {
    const a = jj => r.u[2 * I - 1 + (N + 1) * jj] + 2 * r.u[2 * I + (N + 1) * jj] + r.u[2 * I + 1 + (N + 1) * jj];
    o.u[I + (n + 1) * J] = (a(2 * J) + a(2 * J + 1)) / 8;
  }
  for (let J = 1; J < n; J++) for (let I = 0; I < n; I++) {
    const a = ii => r.v[ii + N * (2 * J - 1)] + 2 * r.v[ii + N * 2 * J] + r.v[ii + N * (2 * J + 1)];
    o.v[I + n * J] = (a(2 * I) + a(2 * I + 1)) / 8;
  }
  for (let J = 0; J < n; J++) for (let I = 0; I < n; I++) o.p[I + n * J] = (r.p[2 * I + N * 2 * J] + r.p[2 * I + 1 + N * 2 * J] + r.p[2 * I + N * (2 * J + 1)] + r.p[2 * I + 1 + N * (2 * J + 1)]) / 4;
  return o;
}
function mx2Prolong(L, C, e, X) {
  const N = L.G.N, n = C.G.N;
  const cu = (I, J) => (I < 0 || I > n || J < 0 || J >= n) ? 0 : e.u[I + (n + 1) * J], cv = (I, J) => (I < 0 || I >= n || J < 0 || J > n) ? 0 : e.v[I + n * J];
  for (let j = 0; j < N; j++) {
    const J = j >> 1, Jn = (j & 1) ? Math.min(J + 1, n - 1) : Math.max(J - 1, 0);
    for (let i = 1; i < N; i++) {
      const at = I => 0.75 * cu(I, J) + 0.25 * cu(I, Jn);
      X.u[i + (N + 1) * j] += (i & 1) ? (at((i - 1) >> 1) + at((i + 1) >> 1)) / 2 : at(i >> 1);
    }
  }
  for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
    const I = i >> 1, In = (i & 1) ? Math.min(I + 1, n - 1) : Math.max(I - 1, 0), at = J => 0.75 * cv(I, J) + 0.25 * cv(In, J);
    X.v[i + N * j] += (j & 1) ? (at((j - 1) >> 1) + at((j + 1) >> 1)) / 2 : at(j >> 1);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) X.p[i + N * j] += e.p[(i >> 1) + n * (j >> 1)];
}
const MX_MG = { nu: 1, om: 0.9, coarse: 20, nMin: 24 };
function mx2Vcycle(Ls, l, B, X) {
  const L = Ls[l];
  if (l === Ls.length - 1) { mx2Smooth(L, X, B, MX_MG.coarse, MX_MG.om); return; }
  mx2Smooth(L, X, B, MX_MG.nu, MX_MG.om);
  const R = mx2Vec(L.G); mx2Apply(L, X, R);
  for (const f of ['u', 'v', 'p']) { const r = R[f], b = B[f]; for (let k = 0; k < r.length; k++) r[k] = b[k] - r[k]; }
  const C = Ls[l + 1], rc = mx2Restrict(L, C, R), ec = mx2Vec(C.G);
  mx2Vcycle(Ls, l + 1, rc, ec);
  mx2Prolong(L, C, ec, X);
  mx2Smooth(L, X, B, MX_MG.nu, MX_MG.om);
}
/** The levels from the finest down while the grid stays at least MX_MG.nMin cells across (the solids seen on each). */
function mx2Levels(L) { const Ls = [L]; while (Ls[Ls.length - 1].G.N % 2 === 0 && Ls[Ls.length - 1].G.N / 2 >= MX_MG.nMin) Ls.push(mx2Coarsen(Ls[Ls.length - 1])); return Ls; }

// ---------------------------------------------------------------------------------------------------------------------
// FGMRES (flexible: the multigrid preconditioner changes nothing between calls, but it is not a fixed linear map)
// ---------------------------------------------------------------------------------------------------------------------
/** Solve A x = b; A(x, y) and M(r, z) act on flat arrays of length n. Returns { x, it, res }. */
function mxFGMRES(n, A, M, b, x0, tol = 1e-8, maxIt = 200, m = 30) {
  const x = Float64Array.from(x0); let nb = 0; for (let i = 0; i < n; i++) nb += b[i] * b[i]; nb = Math.sqrt(nb) || 1;
  let it = 0, res = 1; const w = new Float64Array(n);
  while (it < maxIt) {
    A(x, w); const r = new Float64Array(n); let beta = 0; for (let i = 0; i < n; i++) { r[i] = b[i] - w[i]; beta += r[i] * r[i]; } beta = Math.sqrt(beta); res = beta / nb;
    if (res < tol) break;
    const V = [r.map(t => t / beta)], Z = [], H = [], cs = [], sn = [], gv = [beta];
    let k = 0;
    for (; k < m && it < maxIt; k++) {
      it++;
      const z = new Float64Array(n); M(V[k], z); Z.push(z); A(z, w);
      const hk = new Float64Array(k + 2);
      for (let i = 0; i <= k; i++) { const vi = V[i]; let s = 0; for (let q = 0; q < n; q++) s += w[q] * vi[q]; hk[i] = s; for (let q = 0; q < n; q++) w[q] -= s * vi[q]; }
      let wn = 0; for (let q = 0; q < n; q++) wn += w[q] * w[q]; wn = Math.sqrt(wn); hk[k + 1] = wn; V.push(Float64Array.from(w, t => t / (wn || 1)));
      for (let i = 0; i < k; i++) { const tt = cs[i] * hk[i] + sn[i] * hk[i + 1]; hk[i + 1] = -sn[i] * hk[i] + cs[i] * hk[i + 1]; hk[i] = tt; }
      const dd = Math.hypot(hk[k], hk[k + 1]) || 1e-300; cs.push(hk[k] / dd); sn.push(hk[k + 1] / dd); hk[k] = dd; hk[k + 1] = 0;
      gv.push(-sn[k] * gv[k]); gv[k] = cs[k] * gv[k]; H.push(hk);
      res = Math.abs(gv[k + 1]) / nb; if (res < tol) { k++; break; }
    }
    const y = new Float64Array(k); for (let i = k - 1; i >= 0; i--) { let s = gv[i]; for (let j = i + 1; j < k; j++) s -= H[j][i] * y[j]; y[i] = s / H[i][i]; }
    for (let j = 0; j < k; j++) { const z = Z[j], yj = y[j]; for (let q = 0; q < n; q++) x[q] += yj * z[q]; }
    if (res < tol) break;
  }
  return { x, it, res };
}

// ---------------------------------------------------------------------------------------------------------------------
// 2D: the solids on the grid, the forces, the viscosity
// ---------------------------------------------------------------------------------------------------------------------
/** Each face's share of solid (sampled m × m over its cell), the solid's velocity there and whose it is. */
function mx2Mark(G, solids, m = 3) {
  const N = G.N, h = G.h, x0 = G.x0;
  const chiU = new Float64Array(G.nu), chiV = new Float64Array(G.nv), usU = new Float64Array(G.nu), usV = new Float64Array(G.nv), ownU = new Int8Array(G.nu).fill(-1), ownV = new Int8Array(G.nv).fill(-1);
  const off = Array.from({ length: m }, (_, a) => ((a + 0.5) / m - 0.5) * h), mm = m * m;
  const mark = (s, xc, yc, chi, us, own, k, comp) => {
    let c = 0; for (const dx of off) for (const dy of off) if (s.inside(xc + dx, yc + dy)) c++;
    if (!c) return;
    const f = c / mm; if (f <= chi[k] - 1e-12 && own[k] >= 0) return;
    chi[k] = Math.min(1, f); own[k] = s.own; us[k] = s.vel(xc, yc)[comp];
  };
  for (const s of solids) {
    if (s.outside) {
      // (the wall: inside r < R − h nothing to sample; beyond R + h all of it solid)
      const R = s.outside;
      for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) { const x = x0 + i * h, y = x0 + (j + 0.5) * h, r = Math.hypot(x, y), k = i + (N + 1) * j; if (r < R - h) continue; if (r > R + h) { chiU[k] = 1; ownU[k] = s.own; usU[k] = s.vel(x, y)[0]; } else mark(s, x, y, chiU, usU, ownU, k, 0); }
      for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) { const x = x0 + (i + 0.5) * h, y = x0 + j * h, r = Math.hypot(x, y), k = i + N * j; if (r < R - h) continue; if (r > R + h) { chiV[k] = 1; ownV[k] = s.own; usV[k] = s.vel(x, y)[1]; } else mark(s, x, y, chiV, usV, ownV, k, 1); }
      continue;
    }
    const [bx0, by0, bx1, by1] = s.bb;
    const i0 = Math.max(0, Math.floor((bx0 - x0) / h) - 1), i1 = Math.min(N, Math.ceil((bx1 - x0) / h) + 1), j0 = Math.max(0, Math.floor((by0 - x0) / h) - 1), j1 = Math.min(N, Math.ceil((by1 - x0) / h) + 1);
    for (let j = j0; j < Math.min(j1, N); j++) for (let i = i0; i <= i1; i++) mark(s, x0 + i * h, x0 + (j + 0.5) * h, chiU, usU, ownU, i + (N + 1) * j, 0);
    for (let j = j0; j <= j1; j++) for (let i = i0; i < Math.min(i1, N); i++) mark(s, x0 + (i + 0.5) * h, x0 + j * h, chiV, usV, ownV, i + N * j, 1);
  }
  return { chiU, chiV, usU, usV, ownU, ownV };
}
/** The shear rate at the cells' centres and corners. */
function mx2Shear(G, X) {
  const N = G.N, h = G.h, u = X.u, v = X.v, gC = new Float64Array(G.np), gK = new Float64Array(G.nk), sK = new Float64Array(G.nk);
  // (the corners' u_y + v_x; the box's edges: the velocity zero beyond)
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const uN = j < N ? u[i + (N + 1) * j] : 0, uS = j > 0 ? u[i + (N + 1) * (j - 1)] : 0, vE = i < N ? v[i + N * j] : 0, vW = i > 0 ? v[i - 1 + N * j] : 0;
    sK[i + (N + 1) * j] = (uN - uS + vE - vW) / h;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ux = (u[i + 1 + (N + 1) * j] - u[i + (N + 1) * j]) / h, vy = (v[i + N * (j + 1)] - v[i + N * j]) / h;
    const s = (sK[i + (N + 1) * j] + sK[i + 1 + (N + 1) * j] + sK[i + (N + 1) * (j + 1)] + sK[i + 1 + (N + 1) * (j + 1)]) / 4;
    gC[i + N * j] = Math.sqrt(2 * (ux * ux + vy * vy) + s * s);
  }
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    let e = 0, c = 0; for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) if (a >= 0 && b >= 0 && a < N && b < N) { const ux = (u[a + 1 + (N + 1) * b] - u[a + (N + 1) * b]) / h, vy = (v[a + N * (b + 1)] - v[a + N * b]) / h; e += 2 * (ux * ux + vy * vy); c++; }
    const s = sK[i + (N + 1) * j]; gK[i + (N + 1) * j] = Math.sqrt((c ? e / c : 0) + s * s);
  }
  return { gC, gK };
}

/**
 * The 2D level's coefficients from the marks and the shear rates: the paste's μ(γ̇) in the fluid (μ_ref inside the solids,
 * where the drag holds the velocity), the drag λ χ on the faces.
 */
function mx2Coefs(G, mk, sh, law, muRef, lam, rhoA) {
  const N = G.N, muC = new Float64Array(G.np), muK = new Float64Array(G.nk);
  for (let k = 0; k < G.np; k++) muC[k] = sh ? law(sh.gC[k]) : muRef;
  for (let k = 0; k < G.nk; k++) muK[k] = sh ? law(sh.gK[k]) : muRef;
  // (inside a solid the viscosity is the reference's: the drag holds the velocity there, a large viscosity would only stiffen it)
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const c = (mk.chiU[i + (N + 1) * j] + mk.chiU[i + 1 + (N + 1) * j] + mk.chiV[i + N * j] + mk.chiV[i + N * (j + 1)]) / 4; if (c > 0.5) muC[i + N * j] = muRef; }
  const lamU = Float64Array.from(mk.chiU, c => lam * c), lamV = Float64Array.from(mk.chiV, c => lam * c);
  return { G, muC, muK, lamU, lamV, rhoA };
}
/** The drag each solid puts on the paste (force per height, N/m), its torque about the vessel's axis and its own, the power
 *  it gives (W/m), by owner. axes: owner -> [cx, cy] (its own axis). */
function mx2Forces(G, mk, X, lam, axes, nOwn) {
  const N = G.N, h = G.h, x0 = G.x0, h2 = h * h, F = Array.from({ length: nOwn }, () => ({ Fx: 0, Fy: 0, Tq: 0, TqOwn: 0, P: 0 }));
  for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
    const k = i + (N + 1) * j, o = mk.ownU[k]; if (o < 0) continue;
    const f = lam * mk.chiU[k] * (mk.usU[k] - X.u[k]) * h2, x = x0 + i * h, y = x0 + (j + 0.5) * h, q = F[o], c = axes[o] || [0, 0];
    q.Fx += f; q.Tq += -y * f; q.TqOwn += -(y - c[1]) * f; q.P += f * mk.usU[k];
  }
  for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
    const k = i + N * j, o = mk.ownV[k]; if (o < 0) continue;
    const f = lam * mk.chiV[k] * (mk.usV[k] - X.v[k]) * h2, x = x0 + (i + 0.5) * h, y = x0 + j * h, q = F[o], c = axes[o] || [0, 0];
    q.Fy += f; q.Tq += x * f; q.TqOwn += (x - c[0]) * f; q.P += f * mk.usV[k];
  }
  return F;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2D: the slice in time
// ---------------------------------------------------------------------------------------------------------------------
/** The velocity at a point from the faces (bilinear on each component's own grid; zero beyond the box). */
function mx2VelAt(G, X, x, y) {
  const N = G.N, h = G.h, fx = (x - G.x0) / h, fy = (y - G.x0) / h;
  const bil = (arr, nx, ny, sx, sy) => {
    const a = fx - sx, b = fy - sy, i = Math.floor(a), j = Math.floor(b), s = a - i, t = b - j;
    const at = (ii, jj) => (ii < 0 || jj < 0 || ii >= nx || jj >= ny) ? 0 : arr[ii + nx * jj];
    return (1 - s) * (1 - t) * at(i, j) + s * (1 - t) * at(i + 1, j) + (1 - s) * t * at(i, j + 1) + s * t * at(i + 1, j + 1);
  };
  return [bil(X.u, N + 1, N, 0, 0.5), bil(X.v, N, N + 1, 0.5, 0)];
}
/**
 * The slice in time. o: the mixer's inputs (mxSolids's, SI), the step's speeds No, Nd (1/s), rho, the paste's law: law
 * (a function, the checks') or tab ([[γ̇, μ], …]); zs (the slice's height); mesh: { N (cells across), steps (per arm
 * turn), turns, sub (samples per face side), Cl (the drag's C_λ), snaps (how many, over the last turn), snapTimes (instead: when) }; heat: { T0,
 * Tj, hJ (the jacket's W/(m²·K)), k, cp } (none: no temperature); tracers: { n, tauC (the stress a lump breaks at) };
 * inertia (false: each moment creeping, on its own); start ('rest': from rest, else the creeping flow at t = 0); tEnd (instead of turns: seconds); onProgress.
 * Returns { G (N, h, x0), hist: [{ t, phi, P: [by owner], Tq, TqOwn, Fx, Fy, it, res, KE, T (the paste's mean) }], snaps:
 * [{ t, phi, uc, vc, gd, mu, p, dT (the rise since the start) }], tracers: { x, y, strain, tHigh, mix: [{ t, I }] }, owners, ms }.
 */
function mx2Run(o) {
  const t0 = Date.now(), m = o.mesh || {}, N = m.N || 128, R = o.D / 2, h = o.D / (N - 4), G = mx2Grid(N, h);
  const law = o.law || mxLaw(o.tab), rho = o.inertia === false ? 0 : (o.rho || 0), sub = m.sub || 3;
  const Wa = 2 * Math.PI * (o.No || 0), Tturn = Wa ? 2 * Math.PI / Wa : 1, steps = m.steps || 240, dt = o.dt || Tturn / steps;
  const nSteps = o.nSteps || Math.max(1, Math.round((o.tEnd || (m.turns || 1) * Tturn) / dt));
  // (the drag's reference viscosity: the paste's at the bars' shear rate, their speed over their thickness)
  const Wb = Wa * (1 + (o.dir || 1) * (o.ratio || 0)), Vbar = Math.abs(Wa) * (o.ro || 0) + Math.abs(Wb) * (o.rs || 0);
  const muRef = o.muRef || law(Math.max(1e-3, o.t ? Vbar / o.t : 1)), lam = (m.Cl || 1e3) * muRef / (h * h);
  const zs = o.zs ?? 0, nOwn = (o.nBlade || 0) + 2 + (o.extra ? o.extra.length : 0);
  // (the bars kept gapCells cells from the wall at least: the gap the grid sees, gapW)
  const gapW = Math.max(o.dw || 0, (m.gapCells ?? 1.5) * h), oS = { ...o, gapW };
  const solidsAt = t => mxSlice(mxSolids(oS, t), zs);
  const axesAt = t => {
    const ph = (o.phi0 || 0) + Wa * t, ax = { 0: [0, 0] };
    for (let b = 0; b < (o.nBlade || 0); b++) { const a = ph + 2 * Math.PI * b / o.nBlade; ax[1 + b] = [o.ro * Math.cos(a), o.ro * Math.sin(a)]; }
    if (o.nBlade) { const a = ph + Math.PI / o.nBlade; ax[o.nBlade + 1] = [o.rD * Math.cos(a), o.rD * Math.sin(a)]; }
    if (o.extra) o.extra.forEach((e, q) => { ax[e.own] = e.axis || [0, 0]; });
    return ax;
  };
  const n = G.nu + G.nv + G.np, un = a => ({ u: a.subarray(0, G.nu), v: a.subarray(G.nu, G.nu + G.nv), p: a.subarray(G.nu + G.nv) });
  // one solve: the coefficients at the marks, the right side, FGMRES from the guess
  const solve = (mk, sh, rhoA, rhsU, rhsV, conv, guess, tol) => {
    const L = mx2Coefs(G, mk, sh, law, muRef, lam, rhoA);
    if (conv) { L.cu = conv.u; L.cv = conv.v; L.rho = rho; }
    mx2Diag(L); const Ls = mx2Levels(L);
    const b = new Float64Array(n);
    for (let k = 0; k < G.nu; k++) b[k] = lam * mk.chiU[k] * mk.usU[k] + (rhsU ? rhsU[k] : 0);
    for (let k = 0; k < G.nv; k++) b[G.nu + k] = lam * mk.chiV[k] * mk.usV[k] + (rhsV ? rhsV[k] : 0);
    // (the box's own faces: held at nothing)
    for (let j = 0; j < N; j++) { b[(N + 1) * j] = 0; b[N + (N + 1) * j] = 0; } for (let i = 0; i < N; i++) { b[G.nu + i] = 0; b[G.nu + i + N * N] = 0; }
    const r = mxFGMRES(n, (x, y) => mx2Apply(L, un(x), un(y)), (rr, z) => { z.fill(0); mx2Vcycle(Ls, 0, un(rr), un(z)); }, b, guess, tol, m.maxIt || 80, 30);
    // (the pressure's level: its mean over the cells nought)
    const P = r.x.subarray(G.nu + G.nv); let pm = 0; for (let k = 0; k < G.np; k++) pm += P[k]; pm /= G.np; for (let k = 0; k < G.np; k++) P[k] -= pm;
    return r;
  };
  // the start: the creeping flow at t = 0 (its viscosity by a few Picard passes)
  let mk = mx2Mark(G, solidsAt(0), sub), x = new Float64Array(n), sh = null, r0 = null;
  if (o.start === 'rest') { r0 = { it: 0, res: 0 }; sh = mx2Shear(G, un(x)); }
  else for (let it = 0; it < (m.picard || 4); it++) { r0 = solve(mk, sh, 0, null, null, null, x, 1e-7); x = r0.x; sh = mx2Shear(G, un(x)); }
  let xPrev = Float64Array.from(x);
  // the heat
  const H = o.heat || null, T = H ? new Float64Array(G.np).fill(H.T0) : null;
  const cellFluid = new Uint8Array(G.np), cellWall = new Uint8Array(G.np);
  // (the paste's cells: under half solid; the wall's: those whose centre is outside the vessel -- fixed, so the moving parts
  //  passing near it never turn a cell of paste into the jacket's or back)
  const markCells = mk => { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const c = (mk.chiU[i + (N + 1) * j] + mk.chiU[i + 1 + (N + 1) * j] + mk.chiV[i + N * j] + mk.chiV[i + N * (j + 1)]) / 4, k = i + N * j; cellWall[k] = Math.hypot(G.x0 + (i + 0.5) * h, G.x0 + (j + 0.5) * h) > R ? 1 : 0; cellFluid[k] = c < 0.5 && !cellWall[k] ? 1 : 0; } };
  const heatStep = (X, sh, dtH) => {
    // (the heat carried in flux form on the faces' own velocities (divergence-free: the heat is kept exactly, nothing made
    //  or lost by the carrying), second order upwind with the minmod limiter, in substeps that keep each one's Courant
    //  number under 0.45; the faces to the wall's cells carry nothing. Then the heat made, μ γ̇², the jacket through the
    //  faces to the wall's cells, and conduction, over the step)
    const rc = (o.rho || 1000) * H.cp, alpha = H.k / rc, N1 = N + 1;
    let vmax = 0; for (const q of X.u) vmax = Math.max(vmax, Math.abs(q)); for (const q of X.v) vmax = Math.max(vmax, Math.abs(q));
    const nsub = Math.max(1, Math.ceil(vmax * dtH / h / 0.45)), ds = dtH / nsub, Fu = new Float64Array(G.nu), Fv = new Float64Array(G.nv);
    const mm = (a, b) => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b);
    // (the faces carry the rise above the start, T − T0: the velocity is divergence-free only to the solve's tolerance, and
    //  the start's own level carried through it would make heat of that error)
    const Tc = (i, j) => T[i + N * j], open = k => !cellWall[k], T0 = H.T0;
    for (let sub = 0; sub < nsub; sub++) {
      // (the face's value from its upwind cell, its slope limited against the cells either side -- a wall's cell or the box's
      //  edge beyond it: no slope)
      for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
        const f = i + N1 * j, kl = i - 1 + N * j, kr = i + N * j; if (!open(kl) || !open(kr)) { Fu[f] = 0; continue; }
        const u = X.u[f];
        if (u >= 0) { const sl = i - 2 >= 0 && open(i - 2 + N * j) ? mm(Tc(i - 1, j) - Tc(i - 2, j), Tc(i, j) - Tc(i - 1, j)) : 0; Fu[f] = u * (T[kl] - T0 + sl / 2); }
        else { const sl = i + 1 < N && open(i + 1 + N * j) ? mm(Tc(i, j) - Tc(i + 1, j), Tc(i - 1, j) - Tc(i, j)) : 0; Fu[f] = u * (T[kr] - T0 + sl / 2); }
      }
      for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
        const f = i + N * j, kb = i + N * (j - 1), kt = i + N * j; if (!open(kb) || !open(kt)) { Fv[f] = 0; continue; }
        const v = X.v[f];
        if (v >= 0) { const sl = j - 2 >= 0 && open(i + N * (j - 2)) ? mm(Tc(i, j - 1) - Tc(i, j - 2), Tc(i, j) - Tc(i, j - 1)) : 0; Fv[f] = v * (T[kb] - T0 + sl / 2); }
        else { const sl = j + 1 < N && open(i + N * (j + 1)) ? mm(Tc(i, j) - Tc(i, j + 1), Tc(i, j - 1) - Tc(i, j)) : 0; Fv[f] = v * (T[kt] - T0 + sl / 2); }
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const k = i + N * j; if (cellWall[k]) continue;
        T[k] -= ds / h * (Fu[i + 1 + N1 * j] - Fu[i + N1 * j] + Fv[i + N * (j + 1)] - Fv[i + N * j]);
      }
    }
    const Tn = Float64Array.from(T);
    let qj = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = i + N * j; if (cellWall[k]) continue;
      let q = cellFluid[k] ? law(sh.gC[k]) * sh.gC[k] * sh.gC[k] / rc : 0, dif = 0;
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
        if (a < 0 || b < 0 || a >= N || b >= N) continue; const kb = a + N * b;
        if (cellWall[kb]) {
          // (the jacket through the face to the wall's cell, weighted by how square the face is to the wall: the staircase's
          //  faces then add up to the wall's true length)
          if (!H.hJ) continue;
          const fx = G.x0 + (i + 0.5 + (a - i) / 2) * h, fy = G.x0 + (j + 0.5 + (b - j) / 2) * h, wgt = Math.abs((a - i) * fx + (b - j) * fy) / Math.hypot(fx, fy);
          q += wgt * H.hJ * (H.Tj - Tn[k]) / h / rc; qj += wgt * H.hJ * (H.Tj - Tn[k]) * h;
        } else dif += alpha * (Tn[kb] - Tn[k]) / (h * h);
      }
      T[k] = Tn[k] + dtH * (q + dif);
    }
    for (let k = 0; k < G.np; k++) if (cellWall[k]) T[k] = H.Tj;
    Qj = qj;
  };
  // (the jacket's heat into the paste over the last step, per height (W/m); the heat held by the cells inside the wall
  //  above the start's, per height (J/m))
  let Qj = 0;
  const heatHeld = () => { let e = 0; for (let k = 0; k < G.np; k++) if (!cellWall[k]) e += T[k] - H.T0; return e * (o.rho || 1000) * H.cp * h * h; };
  if (T) markCells(mk);
  // the tracers: seeded on a lattice over the paste at t = 0
  const TR = o.tracers && o.tracers.n ? (() => {
    const nn = Math.round(Math.sqrt(o.tracers.n * 4 / Math.PI)), xs = [], ys = [];
    for (let a = 0; a < nn; a++) for (let b = 0; b < nn; b++) { const x = -R + (a + 0.5) * 2 * R / nn, y = -R + (b + 0.5) * 2 * R / nn; if (x * x + y * y < (R - 2 * h) ** 2 && !solidsAt(0).some(s => s.own && s.inside(x, y))) { xs.push(x); ys.push(y); } }
    const c = Float64Array.from(ys, y => (y > 0 ? 1 : 0));
    return { x: Float64Array.from(xs), y: Float64Array.from(ys), x0: Float64Array.from(xs), y0: Float64Array.from(ys), c, strain: new Float64Array(xs.length), tHigh: new Float64Array(xs.length), mix: [] };
  })() : null;
  const mixIndex = () => {
    // (the intensity of segregation over a lattice of bins over the vessel, about sixteen tracers to a bin: 1 unmixed, 0 even)
    const nb = Math.max(4, Math.min(16, Math.round(Math.sqrt(TR.x.length / 16 * 4 / Math.PI)))), cnt = new Float64Array(nb * nb), sum = new Float64Array(nb * nb); let cm = 0;
    for (let q = 0; q < TR.x.length; q++) { const a = Math.min(nb - 1, Math.max(0, Math.floor((TR.x[q] + R) / (2 * R) * nb))), b = Math.min(nb - 1, Math.max(0, Math.floor((TR.y[q] + R) / (2 * R) * nb))); cnt[a + nb * b]++; sum[a + nb * b] += TR.c[q]; cm += TR.c[q]; }
    cm /= TR.x.length; let v = 0, w = 0; for (let k = 0; k < cnt.length; k++) if (cnt[k] >= 4) { const c = sum[k] / cnt[k]; v += cnt[k] * (c - cm) ** 2; w += cnt[k]; }
    return w ? v / w / (cm * (1 - cm)) : 1;
  };
  const trStep = (Xa, Xb, shB, dtT) => {
    const tauC = o.tracers.tauC ?? Infinity;
    for (let q = 0; q < TR.x.length; q++) {
      const x = TR.x[q], y = TR.y[q], [u1, v1] = mx2VelAt(G, Xa, x, y), xs = x + dtT * u1, ys = y + dtT * v1, [u2, v2] = mx2VelAt(G, Xb, xs, ys);
      let xn = x + dtT / 2 * (u1 + u2), yn = y + dtT / 2 * (v1 + v2);
      const rr = Math.hypot(xn, yn); if (rr > R - h / 2) { xn *= (R - h / 2) / rr; yn *= (R - h / 2) / rr; }
      TR.x[q] = xn; TR.y[q] = yn;
      const i = Math.min(N - 1, Math.max(0, Math.floor((xn - G.x0) / h))), j = Math.min(N - 1, Math.max(0, Math.floor((yn - G.x0) / h))), g = shB.gC[i + N * j];
      TR.strain[q] += g * dtT; if (law(g) * g >= tauC) TR.tHigh[q] += dtT;
    }
  };
  // the snapshots: evenly over the last turn (or the run)
  const nSnap = m.snaps ?? 8, snapFrom = Math.max(0, nSteps - Math.round(Tturn / dt)), snapAt = new Set();
  if (m.snapTimes) for (const ts of m.snapTimes) snapAt.add(Math.min(nSteps, Math.max(1, Math.round(ts / dt))));
  else for (let q = 1; q <= nSnap; q++) snapAt.add(Math.min(nSteps, snapFrom + Math.round(q * (nSteps - snapFrom) / nSnap)));
  const snaps = [], hist = [], f32 = a => Float32Array.from(a);
  const snap = (t, X, sh) => {
    const uc = new Float32Array(G.np), vc = new Float32Array(G.np);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { uc[i + N * j] = (X.u[i + (N + 1) * j] + X.u[i + 1 + (N + 1) * j]) / 2; vc[i + N * j] = (X.v[i + N * j] + X.v[i + N * (j + 1)]) / 2; }
    const mu = Float32Array.from(sh.gC, g => law(g)), fl = new Uint8Array(G.np);
    for (let k = 0; k < G.np; k++) fl[k] = cellFluid[k] || 0;
    // (the temperature as its rise above the start: in single precision the start's own value would swamp it)
    snaps.push({ t, phi: (o.phi0 || 0) + Wa * t, uc, vc, gd: f32(sh.gC), mu, p: f32(X.p), dT: T ? Float32Array.from(T, v => v - H.T0) : null, fluid: fl });
  };
  const record = (t, X, mkk, it, res, shr) => {
    const F = mx2Forces(G, mkk, X, lam, axesAt(t), nOwn);
    // (the heat the shear makes in the paste, per height: ∫ μ γ̇² over its cells)
    let Dis = 0; if (shr) for (let k = 0; k < G.np; k++) if (cellFluid[k]) Dis += law(shr.gC[k]) * shr.gC[k] * shr.gC[k]; Dis *= h * h;
    let KE = 0; for (const q of X.u) KE += q * q; for (const q of X.v) KE += q * q;
    let Tm = 0, nf = 0; if (T) for (let k = 0; k < G.np; k++) if (cellFluid[k]) { Tm += T[k]; nf++; }
    // (the paste's angular momentum about the vessel's axis, per height: its cells inside the wall)
    let Lz = 0; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const xc = G.x0 + (i + 0.5) * h, yc = G.x0 + (j + 0.5) * h; if (xc * xc + yc * yc > (R - h) ** 2) continue; Lz += xc * (X.v[i + N * j] + X.v[i + N * (j + 1)]) / 2 - yc * (X.u[i + (N + 1) * j] + X.u[i + 1 + (N + 1) * j]) / 2; }
    hist.push({ t, phi: (o.phi0 || 0) + Wa * t, Lz: (o.rho || 0) * Lz * h * h, P: F.map(f => f.P), Tq: F.map(f => f.Tq), TqOwn: F.map(f => f.TqOwn), Fx: F.map(f => f.Fx), Fy: F.map(f => f.Fy), it, res, KE: 0.5 * (rho || o.rho || 0) * KE * h * h, T: nf ? Tm / nf : null, Dis, ...(T ? { Qj, Eh: heatHeld() } : {}) });
  };
  if (!T) markCells(mk);
  record(0, un(x), mk, r0.it, r0.res, sh);
  if (TR) TR.mix.push({ t: 0, I: mixIndex() });
  let shNow = sh;
  for (let s = 1; s <= nSteps; s++) {
    const t = s * dt, bdf2 = s > 1 && rho > 0;
    const mkN = mx2Mark(G, solidsAt(t), sub);
    // (the extrapolated velocity: the convecting one, the viscosity's, the solve's start)
    const ext = new Float64Array(n); for (let k = 0; k < n; k++) ext[k] = s > 1 ? 2 * x[k] - xPrev[k] : x[k];
    const E = un(ext), shE = mx2Shear(G, E);
    let rhoA = 0, rhsU = null, rhsV = null, conv = null;
    if (rho > 0) {
      rhoA = (bdf2 ? 1.5 : 1) * rho / dt; rhsU = new Float64Array(G.nu); rhsV = new Float64Array(G.nv);
      const Xn = un(x), Xp = un(xPrev);
      for (let k = 0; k < G.nu; k++) rhsU[k] = rho / dt * (bdf2 ? 2 * Xn.u[k] - 0.5 * Xp.u[k] : Xn.u[k]);
      for (let k = 0; k < G.nv; k++) rhsV[k] = rho / dt * (bdf2 ? 2 * Xn.v[k] - 0.5 * Xp.v[k] : Xn.v[k]);
      conv = o.noConv ? null : { u: E.u, v: E.v };
    }
    let r;
    if (rho > 0) r = solve(mkN, shE, rhoA, rhsU, rhsV, conv, ext, m.tol || 1e-6);
    else { let xx = ext, sh2 = shE; for (let it = 0; it < (m.picard || 3); it++) { r = solve(mkN, sh2, 0, null, null, null, xx, m.tol || 1e-6); xx = r.x; sh2 = mx2Shear(G, un(xx)); } }
    const Xold = un(x); xPrev = x; x = r.x; mk = mkN; markCells(mk);
    shNow = mx2Shear(G, un(x));
    if (T) heatStep(un(x), shNow, dt);
    if (TR) { trStep(Xold, un(x), shNow, dt); if (s % Math.max(1, Math.round(steps / 24)) === 0 || s === nSteps) TR.mix.push({ t, I: mixIndex() }); }
    record(t, un(x), mk, r.it, r.res, shNow);
    if (snapAt.has(s)) snap(t, un(x), shNow);
    if (o.onProgress && (s % 4 === 0 || s === nSteps)) o.onProgress({ k: s, n: nSteps });
  }
  if (!snaps.length) snap(nSteps * dt, un(x), shNow);
  return { G: { N, h, x0: G.x0 }, hist, snaps, tracers: TR ? { x: f32(TR.x), y: f32(TR.y), x0: f32(TR.x0), y0: f32(TR.y0), strain: f32(TR.strain), tHigh: f32(TR.tHigh), mix: TR.mix } : null,
    owners: nOwn, dt, nSteps, muRef, lam, gapW, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------------------------------------------------
// 3D: the whole batch, creeping, at moments over the blades' cycle
// ---------------------------------------------------------------------------------------------------------------------
/** A box of N × N × Nz cells: h across, hz up; the floor at z = 0 (no slip), the batch's top at z = Nz hz (a flat free
 *  surface: nothing through it, no shear along it). */
function mx3Grid(N, Nz, h, hz) {
  return { N, Nz, h, hz, x0: -N * h / 2, nu: (N + 1) * N * Nz, nv: N * (N + 1) * Nz, nw: N * N * (Nz + 1), np: N * N * Nz };
}
const mx3Vec = G => ({ u: new Float64Array(G.nu), v: new Float64Array(G.nv), w: new Float64Array(G.nw), p: new Float64Array(G.np) });
/** The edges' viscosity from the cells' (each the mean of the cells round it): mXY on the edges along z, mXZ along y,
 *  mYZ along x. */
function mx3Edges(G, muC) {
  const N = G.N, Nz = G.Nz, c = (i, j, k) => muC[Math.min(N - 1, Math.max(0, i)) + N * (Math.min(N - 1, Math.max(0, j)) + N * Math.min(Nz - 1, Math.max(0, k)))];
  const mXY = new Float64Array((N + 1) * (N + 1) * Nz), mXZ = new Float64Array((N + 1) * N * (Nz + 1)), mYZ = new Float64Array(N * (N + 1) * (Nz + 1));
  for (let k = 0; k < Nz; k++) for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) mXY[i + (N + 1) * (j + (N + 1) * k)] = (c(i - 1, j - 1, k) + c(i, j - 1, k) + c(i - 1, j, k) + c(i, j, k)) / 4;
  for (let k = 0; k <= Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) mXZ[i + (N + 1) * (j + N * k)] = (c(i - 1, j, k - 1) + c(i, j, k - 1) + c(i - 1, j, k) + c(i, j, k)) / 4;
  for (let k = 0; k <= Nz; k++) for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) mYZ[i + N * (j + (N + 1) * k)] = (c(i, j - 1, k - 1) + c(i, j, k - 1) + c(i, j - 1, k) + c(i, j, k)) / 4;
  return { mXY, mXZ, mYZ };
}
/**
 * The momentum rows at a face (ru, rv, rw; a Dirichlet face: its value) for a 3D level { G, muC, mXY, mXZ, mYZ, lamU,
 * lamV, lamW }. The floor: no slip (a ghost value the negative); the top: free (a ghost the same, the vertical velocity nought).
 */
function mx3Rows(L, X) {
  const G = L.G, N = G.N, Nz = G.Nz, N1 = N + 1, h = G.h, hz = G.hz, ih = 1 / h, ihz = 1 / hz, ih2 = ih * ih, ihz2 = ihz * ihz;
  const u = X.u, v = X.v, w = X.w, p = X.p, muC = L.muC, mXY = L.mXY, mXZ = L.mXZ, mYZ = L.mYZ, lamU = L.lamU, lamV = L.lamV, lamW = L.lamW, fl = L.slipFloor ? 1 : -1;
  const iu = (i, j, k) => i + N1 * (j + N * k), iv = (i, j, k) => i + N * (j + N1 * k), iw = (i, j, k) => i + N * (j + N * k), ic = iw;
  const iXY = (i, j, k) => i + N1 * (j + N1 * k), iXZ = (i, j, k) => i + N1 * (j + N * k), iYZ = (i, j, k) => i + N * (j + N1 * k);
  const ru = (i, j, k) => {
    const q = iu(i, j, k); if (i === 0 || i === N) return u[q];
    const uC = u[q], uE = u[q + 1], uW = u[q - 1], uN = j < N - 1 ? u[q + N1] : 0, uS = j > 0 ? u[q - N1] : 0;
    const uT = k < Nz - 1 ? u[q + N1 * N] : uC, uB = k > 0 ? u[q - N1 * N] : fl * uC;
    const mE = muC[ic(i, j, k)], mW = muC[ic(i - 1, j, k)], mN = mXY[iXY(i, j + 1, k)], mS = mXY[iXY(i, j, k)], mT = k < Nz - 1 ? mXZ[iXZ(i, j, k + 1)] : 0, mB = mXZ[iXZ(i, j, k)];
    const vx1 = (v[iv(i, j + 1, k)] - v[iv(i - 1, j + 1, k)]) * ih, vx0 = (v[iv(i, j, k)] - v[iv(i - 1, j, k)]) * ih;
    const wx1 = (w[iw(i, j, k + 1)] - w[iw(i - 1, j, k + 1)]) * ih, wx0 = (w[iw(i, j, k)] - w[iw(i - 1, j, k)]) * ih;
    return lamU[q] * uC - ((2 * mE * (uE - uC) - 2 * mW * (uC - uW)) * ih2 + (mN * ((uN - uC) * ih + vx1) - mS * ((uC - uS) * ih + vx0)) * ih
      + (mT * ((uT - uC) * ihz + wx1) - mB * ((uC - uB) * ihz + wx0)) * ihz) + (p[ic(i, j, k)] - p[ic(i - 1, j, k)]) * ih;
  };
  const rv = (i, j, k) => {
    const q = iv(i, j, k); if (j === 0 || j === N) return v[q];
    const vC = v[q], vN = v[q + N], vS = v[q - N], vE = i < N - 1 ? v[q + 1] : 0, vW = i > 0 ? v[q - 1] : 0;
    const vT = k < Nz - 1 ? v[q + N * N1] : vC, vB = k > 0 ? v[q - N * N1] : fl * vC;
    const mN = muC[ic(i, j, k)], mS = muC[ic(i, j - 1, k)], mE = mXY[iXY(i + 1, j, k)], mW = mXY[iXY(i, j, k)], mT = k < Nz - 1 ? mYZ[iYZ(i, j, k + 1)] : 0, mB = mYZ[iYZ(i, j, k)];
    const uy1 = (u[iu(i + 1, j, k)] - u[iu(i + 1, j - 1, k)]) * ih, uy0 = (u[iu(i, j, k)] - u[iu(i, j - 1, k)]) * ih;
    const wy1 = (w[iw(i, j, k + 1)] - w[iw(i, j - 1, k + 1)]) * ih, wy0 = (w[iw(i, j, k)] - w[iw(i, j - 1, k)]) * ih;
    return lamV[q] * vC - ((2 * mN * (vN - vC) - 2 * mS * (vC - vS)) * ih2 + (mE * ((vE - vC) * ih + uy1) - mW * ((vC - vW) * ih + uy0)) * ih
      + (mT * ((vT - vC) * ihz + wy1) - mB * ((vC - vB) * ihz + wy0)) * ihz) + (p[ic(i, j, k)] - p[ic(i, j - 1, k)]) * ih;
  };
  const rw = (i, j, k) => {
    const q = iw(i, j, k); if (k === 0 || k === Nz) return w[q];
    const wC = w[q], wT = w[q + N * N], wB = w[q - N * N], wE = i < N - 1 ? w[q + 1] : 0, wW = i > 0 ? w[q - 1] : 0, wN = j < N - 1 ? w[q + N] : 0, wS = j > 0 ? w[q - N] : 0;
    const mT = muC[ic(i, j, k)], mB = muC[ic(i, j, k - 1)], mE = mXZ[iXZ(i + 1, j, k)], mW = mXZ[iXZ(i, j, k)], mN = mYZ[iYZ(i, j + 1, k)], mS = mYZ[iYZ(i, j, k)];
    const uz1 = (u[iu(i + 1, j, k)] - u[iu(i + 1, j, k - 1)]) * ihz, uz0 = (u[iu(i, j, k)] - u[iu(i, j, k - 1)]) * ihz;
    const vz1 = (v[iv(i, j + 1, k)] - v[iv(i, j + 1, k - 1)]) * ihz, vz0 = (v[iv(i, j, k)] - v[iv(i, j, k - 1)]) * ihz;
    return lamW[q] * wC - ((2 * mT * (wT - wC) - 2 * mB * (wC - wB)) * ihz2 + (mE * ((wE - wC) * ih + uz1) - mW * ((wC - wW) * ih + uz0)) * ih
      + (mN * ((wN - wC) * ih + vz1) - mS * ((wC - wS) * ih + vz0)) * ih) + (p[ic(i, j, k)] - p[ic(i, j, k - 1)]) * ihz;
  };
  return { ru, rv, rw, iu, iv, iw, ic };
}
function mx3Diag(L) {
  const G = L.G, N = G.N, Nz = G.Nz, N1 = N + 1, ih2 = 1 / (G.h * G.h), ihz2 = 1 / (G.hz * G.hz), { muC, mXY, mXZ, mYZ } = L;
  const ic = (i, j, k) => i + N * (j + N * k), iXY = (i, j, k) => i + N1 * (j + N1 * k), iXZ = (i, j, k) => i + N1 * (j + N * k), iYZ = (i, j, k) => i + N * (j + N1 * k);
  const au = new Float64Array(G.nu), av = new Float64Array(G.nv), aw = new Float64Array(G.nw);
  for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) {
    const top = k < Nz - 1 ? mXZ[iXZ(i, j, k + 1)] : 0, bot = mXZ[iXZ(i, j, k)] * (k > 0 ? 1 : L.slipFloor ? 0 : 2);
    au[i + N1 * (j + N * k)] = L.lamU[i + N1 * (j + N * k)] + (2 * muC[ic(i, j, k)] + 2 * muC[ic(i - 1, j, k)] + mXY[iXY(i, j + 1, k)] + mXY[iXY(i, j, k)]) * ih2 + (top + bot) * ihz2;
  }
  for (let k = 0; k < Nz; k++) for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) {
    const top = k < Nz - 1 ? mYZ[iYZ(i, j, k + 1)] : 0, bot = mYZ[iYZ(i, j, k)] * (k > 0 ? 1 : L.slipFloor ? 0 : 2);
    av[i + N * (j + N1 * k)] = L.lamV[i + N * (j + N1 * k)] + (2 * muC[ic(i, j, k)] + 2 * muC[ic(i, j - 1, k)] + mXY[iXY(i + 1, j, k)] + mXY[iXY(i, j, k)]) * ih2 + (top + bot) * ihz2;
  }
  for (let k = 1; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
    aw[i + N * (j + N * k)] = L.lamW[i + N * (j + N * k)] + (2 * muC[ic(i, j, k)] + 2 * muC[ic(i, j, k - 1)]) * ihz2 + (mXZ[iXZ(i + 1, j, k)] + mXZ[iXZ(i, j, k)] + mYZ[iYZ(i, j + 1, k)] + mYZ[iYZ(i, j, k)]) * ih2;
  L.au = au; L.av = av; L.aw = aw;
}
function mx3Apply(L, X, Y) {
  const G = L.G, N = G.N, Nz = G.Nz, { ru, rv, rw, iu, iv, iw, ic } = mx3Rows(L, X), ih = 1 / G.h, ihz = 1 / G.hz;
  for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i <= N; i++) Y.u[iu(i, j, k)] = ru(i, j, k);
  for (let k = 0; k < Nz; k++) for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) Y.v[iv(i, j, k)] = rv(i, j, k);
  for (let k = 0; k <= Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Y.w[iw(i, j, k)] = rw(i, j, k);
  for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++)
    Y.p[ic(i, j, k)] = -((X.u[iu(i + 1, j, k)] - X.u[iu(i, j, k)]) * ih + (X.v[iv(i, j + 1, k)] - X.v[iv(i, j, k)]) * ih + (X.w[iw(i, j, k + 1)] - X.w[iw(i, j, k)]) * ihz);
}
function mx3Smooth(L, X, B, sweeps, om) {
  const G = L.G, N = G.N, Nz = G.Nz, gx = 1 / G.h, gz = 1 / G.hz, { au, av, aw } = L, { ru, rv, rw, iu, iv, iw, ic } = mx3Rows(L, X), u = X.u, v = X.v, w = X.w, p = X.p;
  for (let s = 0; s < sweeps; s++) for (let pass = 0; pass < 2; pass++) for (let kk = 0; kk < Nz; kk++) for (let jj = 0; jj < N; jj++) for (let ii = 0; ii < N; ii++) {
    const i = pass ? N - 1 - ii : ii, j = pass ? N - 1 - jj : jj, k = pass ? Nz - 1 - kk : kk;
    const qW = iu(i, j, k), qE = qW + 1, qS = iv(i, j, k), qN = qS + N, qB = iw(i, j, k), qT = qB + N * N, qp = ic(i, j, k);
    const aW = au[qW], aE = au[qE], aS = av[qS], aN = av[qN], aB = aw[qB], aT = aw[qT];
    const rW = aW ? B.u[qW] - ru(i, j, k) : 0, rE = aE ? B.u[qE] - ru(i + 1, j, k) : 0, rS = aS ? B.v[qS] - rv(i, j, k) : 0, rN = aN ? B.v[qN] - rv(i, j + 1, k) : 0, rB = aB ? B.w[qB] - rw(i, j, k) : 0, rT = aT ? B.w[qT] - rw(i, j, k + 1) : 0;
    const rp = B.p[qp] + (u[qE] - u[qW] + v[qN] - v[qS]) * gx + (w[qT] - w[qB]) * gz;
    let num = -rp, den = 0;
    if (aW) { num += gx * rW / aW; den += gx * gx / aW; } if (aE) { num -= gx * rE / aE; den += gx * gx / aE; }
    if (aS) { num += gx * rS / aS; den += gx * gx / aS; } if (aN) { num -= gx * rN / aN; den += gx * gx / aN; }
    if (aB) { num += gz * rB / aB; den += gz * gz / aB; } if (aT) { num -= gz * rT / aT; den += gz * gz / aT; }
    const dp = den > 0 ? num / den : 0;
    if (aW) u[qW] += om * (rW - gx * dp) / aW; if (aE) u[qE] += om * (rE + gx * dp) / aE;
    if (aS) v[qS] += om * (rS - gx * dp) / aS; if (aN) v[qN] += om * (rN + gx * dp) / aN;
    if (aB) w[qB] += om * (rB - gz * dp) / aB; if (aT) w[qT] += om * (rT + gz * dp) / aT;
    p[qp] += om * dp;
  }
}
function mx3Level(G, muC, lamU, lamV, lamW, slipFloor) { const L = { G, muC, lamU, lamV, lamW, slipFloor: !!slipFloor, ...mx3Edges(G, muC) }; mx3Diag(L); return L; }
function mx3Coarsen(L) {
  const G = L.G, N = G.N, Nz = G.Nz, n = N / 2, nz = Nz / 2, C = mx3Grid(n, nz, G.h * 2, G.hz * 2), N1 = N + 1, n1 = n + 1;
  const muC = new Float64Array(C.np), lamU = new Float64Array(C.nu), lamV = new Float64Array(C.nv), lamW = new Float64Array(C.nw), fc = (i, j, k) => L.muC[i + N * (j + N * k)];
  for (let K = 0; K < nz; K++) for (let J = 0; J < n; J++) for (let I = 0; I < n; I++) { let s = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) s += fc(2 * I + a, 2 * J + b, 2 * K + c); muC[I + n * (J + n * K)] = s / 8; }
  for (let K = 0; K < nz; K++) for (let J = 0; J < n; J++) for (let I = 0; I <= n; I++) { let s = 0; for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) s += L.lamU[2 * I + N1 * (2 * J + b + N * (2 * K + c))]; lamU[I + n1 * (J + n * K)] = s / 4; }
  for (let K = 0; K < nz; K++) for (let J = 0; J <= n; J++) for (let I = 0; I < n; I++) { let s = 0; for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) s += L.lamV[2 * I + a + N * (2 * J + N1 * (2 * K + c))]; lamV[I + n * (J + n1 * K)] = s / 4; }
  for (let K = 0; K <= nz; K++) for (let J = 0; J < n; J++) for (let I = 0; I < n; I++) { let s = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) s += L.lamW[2 * I + a + N * (2 * J + b + N * 2 * K)]; lamW[I + n * (J + n * K)] = s / 4; }
  return mx3Level(C, muC, lamU, lamV, lamW, L.slipFloor);
}
function mx3Restrict(L, C, r) {
  const G = L.G, N = G.N, Nz = G.Nz, N1 = N + 1, n = C.G.N, nz = C.G.Nz, n1 = n + 1, o = mx3Vec(C.G);
  for (let K = 0; K < nz; K++) for (let J = 0; J < n; J++) for (let I = 1; I < n; I++) { let s = 0; for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) { const q = N1 * (2 * J + b + N * (2 * K + c)); s += r.u[2 * I - 1 + q] + 2 * r.u[2 * I + q] + r.u[2 * I + 1 + q]; } o.u[I + n1 * (J + n * K)] = s / 16; }
  for (let K = 0; K < nz; K++) for (let J = 1; J < n; J++) for (let I = 0; I < n; I++) { let s = 0; for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) { const f = jj => r.v[2 * I + a + N * (jj + N1 * (2 * K + c))]; s += f(2 * J - 1) + 2 * f(2 * J) + f(2 * J + 1); } o.v[I + n * (J + n1 * K)] = s / 16; }
  for (let K = 1; K < nz; K++) for (let J = 0; J < n; J++) for (let I = 0; I < n; I++) { let s = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const f = kk => r.w[2 * I + a + N * (2 * J + b + N * kk)]; s += f(2 * K - 1) + 2 * f(2 * K) + f(2 * K + 1); } o.w[I + n * (J + n * K)] = s / 16; }
  for (let K = 0; K < nz; K++) for (let J = 0; J < n; J++) for (let I = 0; I < n; I++) { let s = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) s += r.p[2 * I + a + N * (2 * J + b + N * (2 * K + c))]; o.p[I + n * (J + n * K)] = s / 8; }
  return o;
}
function mx3Prolong(L, C, e, X) {
  const G = L.G, N = G.N, Nz = G.Nz, N1 = N + 1, n = C.G.N, nz = C.G.Nz, n1 = n + 1;
  const cu = (I, J, K) => (I < 0 || I > n || J < 0 || J >= n || K < 0 || K >= nz) ? 0 : e.u[I + n1 * (J + n * K)];
  const cv = (I, J, K) => (I < 0 || I >= n || J < 0 || J > n || K < 0 || K >= nz) ? 0 : e.v[I + n * (J + n1 * K)];
  const cw = (I, J, K) => (I < 0 || I >= n || J < 0 || J >= n || K < 0 || K > nz) ? 0 : e.w[I + n * (J + n * K)];
  // (along a face's own direction: linear between the coarse faces; across: 3/4 the coarse cell's, 1/4 its neighbour's)
  const nb = (x, m) => { const X0 = x >> 1, Xn = (x & 1) ? Math.min(X0 + 1, m - 1) : Math.max(X0 - 1, 0); return [X0, Xn]; };
  for (let k = 0; k < Nz; k++) { const [K, Kn] = nb(k, nz); for (let j = 0; j < N; j++) { const [J, Jn] = nb(j, n);
    for (let i = 1; i < N; i++) { const at = I => 0.5625 * cu(I, J, K) + 0.1875 * (cu(I, Jn, K) + cu(I, J, Kn)) + 0.0625 * cu(I, Jn, Kn); X.u[i + N1 * (j + N * k)] += (i & 1) ? (at((i - 1) >> 1) + at((i + 1) >> 1)) / 2 : at(i >> 1); } } }
  for (let k = 0; k < Nz; k++) { const [K, Kn] = nb(k, nz); for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) { const [I, In] = nb(i, n);
    const at = J => 0.5625 * cv(I, J, K) + 0.1875 * (cv(In, J, K) + cv(I, J, Kn)) + 0.0625 * cv(In, J, Kn); X.v[i + N * (j + N1 * k)] += (j & 1) ? (at((j - 1) >> 1) + at((j + 1) >> 1)) / 2 : at(j >> 1); } }
  for (let k = 1; k < Nz; k++) for (let j = 0; j < N; j++) { const [J, Jn] = nb(j, n); for (let i = 0; i < N; i++) { const [I, In] = nb(i, n);
    const at = K => 0.5625 * cw(I, J, K) + 0.1875 * (cw(In, J, K) + cw(I, Jn, K)) + 0.0625 * cw(In, Jn, K); X.w[i + N * (j + N * k)] += (k & 1) ? (at((k - 1) >> 1) + at((k + 1) >> 1)) / 2 : at(k >> 1); } }
  for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) X.p[i + N * (j + N * k)] += e.p[(i >> 1) + n * ((j >> 1) + n * (k >> 1))];
}
function mx3Vcycle(Ls, l, B, X) {
  const L = Ls[l];
  if (l === Ls.length - 1) { mx3Smooth(L, X, B, MX_MG.coarse, MX_MG.om); return; }
  mx3Smooth(L, X, B, MX_MG.nu, MX_MG.om);
  const R = mx3Vec(L.G); mx3Apply(L, X, R);
  for (const f of ['u', 'v', 'w', 'p']) { const r = R[f], b = B[f]; for (let k = 0; k < r.length; k++) r[k] = b[k] - r[k]; }
  const C = Ls[l + 1], rc = mx3Restrict(L, C, R), ec = mx3Vec(C.G);
  mx3Vcycle(Ls, l + 1, rc, ec);
  mx3Prolong(L, C, ec, X);
  mx3Smooth(L, X, B, MX_MG.nu, MX_MG.om);
}
function mx3Levels(L) { const Ls = [L]; for (;;) { const G = Ls[Ls.length - 1].G; if (G.N % 2 || G.Nz % 2 || G.N / 2 < (MX_MG.nMin3 || 16) || G.Nz / 2 < 4) break; Ls.push(mx3Coarsen(Ls[Ls.length - 1])); } return Ls; }
/** Each face's share of solid in 3D (sampled m × m × m over its cell), the solid's velocity, whose it is. */
function mx3Mark(G, solids, m = 2) {
  const N = G.N, Nz = G.Nz, h = G.h, hz = G.hz, x0 = G.x0, N1 = N + 1;
  const mk = { chiU: new Float64Array(G.nu), chiV: new Float64Array(G.nv), chiW: new Float64Array(G.nw), usU: new Float64Array(G.nu), usV: new Float64Array(G.nv), usW: new Float64Array(G.nw), ownU: new Int8Array(G.nu).fill(-1), ownV: new Int8Array(G.nv).fill(-1), ownW: new Int8Array(G.nw).fill(-1) };
  const off = Array.from({ length: m }, (_, a) => ((a + 0.5) / m - 0.5)), m3 = m * m * m;
  const mark = (s, xc, yc, zc, chi, us, own, q, comp) => {
    let c = 0; for (const dz of off) { const z = zc + dz * hz; if (z < s.z0 || z > s.z1) continue; for (const dx of off) for (const dy of off) if (s.inside3 ? s.inside3(xc + dx * h, yc + dy * h, z) : s.inside(xc + dx * h, yc + dy * h)) c++; }
    if (!c) return; const f = c / m3; if (f <= chi[q] - 1e-12 && own[q] >= 0) return;
    chi[q] = Math.min(1, f); own[q] = s.own; us[q] = comp < 2 ? s.vel(xc, yc)[comp] : 0;
  };
  for (const s of solids) {
    const R = s.outside;
    const kz0 = Math.max(0, Math.floor(s.z0 / hz) - 1), kz1 = Math.min(Nz, Math.ceil(Math.min(s.z1, Nz * hz) / hz) + 1);
    let i0 = 0, i1 = N, j0 = 0, j1 = N;
    if (!R) { const [bx0, by0, bx1, by1] = s.bb; i0 = Math.max(0, Math.floor((bx0 - x0) / h) - 1); i1 = Math.min(N, Math.ceil((bx1 - x0) / h) + 1); j0 = Math.max(0, Math.floor((by0 - x0) / h) - 1); j1 = Math.min(N, Math.ceil((by1 - x0) / h) + 1); }
    const face = (xc, yc, zc, chi, us, own, q, comp) => {
      if (R) { const r = Math.hypot(xc, yc); if (r < R - h) return; if (r > R + h) { chi[q] = 1; own[q] = s.own; us[q] = comp < 2 ? s.vel(xc, yc)[comp] : 0; return; } }
      mark(s, xc, yc, zc, chi, us, own, q, comp);
    };
    for (let k = kz0; k < Math.min(kz1, Nz); k++) for (let j = j0; j < Math.min(j1, N); j++) for (let i = i0; i <= i1; i++) face(x0 + i * h, x0 + (j + 0.5) * h, (k + 0.5) * hz, mk.chiU, mk.usU, mk.ownU, i + N1 * (j + N * k), 0);
    for (let k = kz0; k < Math.min(kz1, Nz); k++) for (let j = j0; j <= j1; j++) for (let i = i0; i < Math.min(i1, N); i++) face(x0 + (i + 0.5) * h, x0 + j * h, (k + 0.5) * hz, mk.chiV, mk.usV, mk.ownV, i + N * (j + N1 * k), 1);
    for (let k = kz0; k <= kz1; k++) for (let j = j0; j < Math.min(j1, N); j++) for (let i = i0; i < Math.min(i1, N); i++) face(x0 + (i + 0.5) * h, x0 + (j + 0.5) * h, k * hz, mk.chiW, mk.usW, mk.ownW, i + N * (j + N * k), 2);
  }
  return mk;
}
/** The shear rate at the cells' centres (the off-diagonal rates from the edges round each cell). */
function mx3Shear(G, X, slipFloor) {
  const N = G.N, Nz = G.Nz, N1 = N + 1, h = G.h, hz = G.hz, u = X.u, v = X.v, w = X.w, out = new Float64Array(G.np), fl = slipFloor ? 1 : -1;
  const U = (i, j, k) => (j < 0 || j >= N ? 0 : k < 0 ? fl * u[i + N1 * (j + N * 0)] : k >= Nz ? u[i + N1 * (j + N * (Nz - 1))] : u[i + N1 * (j + N * k)]);
  const V = (i, j, k) => (i < 0 || i >= N ? 0 : k < 0 ? fl * v[i + N * (j + N1 * 0)] : k >= Nz ? v[i + N * (j + N1 * (Nz - 1))] : v[i + N * (j + N1 * k)]);
  const W = (i, j, k) => (i < 0 || i >= N || j < 0 || j >= N ? 0 : w[i + N * (j + N * k)]);
  for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ux = (U(i + 1, j, k) - U(i, j, k)) / h, vy = (V(i, j + 1, k) - V(i, j, k)) / h, wz = (W(i, j, k + 1) - W(i, j, k)) / hz;
    let sxy = 0, sxz = 0, syz = 0;
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      sxy += (U(i + a, j + b, k) - U(i + a, j + b - 1, k)) / h + (V(i + a, j + b, k) - V(i + a - 1, j + b, k)) / h;
      sxz += (U(i + a, j, k + b) - U(i + a, j, k + b - 1)) / hz + (W(i + a, j, k + b) - W(i + a - 1, j, k + b)) / h;
      syz += (V(i, j + a, k + b) - V(i, j + a, k + b - 1)) / hz + (W(i, j + a, k + b) - W(i, j + a - 1, k + b)) / h;
    }
    sxy /= 4; sxz /= 4; syz /= 4;
    out[i + N * (j + N * k)] = Math.sqrt(2 * (ux * ux + vy * vy + wz * wz) + sxy * sxy + sxz * sxz + syz * syz);
  }
  return out;
}
/**
 * The batch in 3D at a moment: the creeping flow (no inertia: the paste's Reynolds number at the blades is a few), the
 * paste's μ(γ̇) by Picard passes. o: the mixer's inputs (as mx2Run's), H (the batch's height), mesh: { N, Nz, sub, Cl,
 * picard, tol }, floor ('slip': the checks'), t (the moment), guess (a velocity to start from). Returns { G, X (flat), F (by owner), it, shear }.
 */
function mx3Solve(o, t, guess) {
  const m = o.mesh || {}, N = m.N || 48, Nz = m.Nz || 32, R = o.D / 2, h = o.D / (N - 4), hz = o.H / Nz, G = mx3Grid(N, Nz, h, hz), law = o.law || mxLaw(o.tab);
  const Wa = 2 * Math.PI * (o.No || 0), Wb = Wa * (1 + (o.dir || 1) * (o.ratio || 0)), Vbar = Math.abs(Wa) * (o.ro || 0) + Math.abs(Wb) * (o.rs || 0);
  const muRef = o.muRef || law(Math.max(1e-3, o.t ? Vbar / o.t : 1)), lam = (m.Cl || 1e3) * muRef / (Math.min(h, hz) ** 2);
  // (the bars kept gapCells cells from the wall and the floor at least: the gaps the grid sees)
  const gapW = Math.max(o.dw || 0, (m.gapCells ?? 1.5) * h), gapF = Math.max(o.db || 0, (m.gapCells ?? 1.5) * hz);
  const mk = mx3Mark(G, mxSolids({ ...o, gapW, gapF }, t), m.sub || 2), n = G.nu + G.nv + G.nw + G.np;
  const un = a => ({ u: a.subarray(0, G.nu), v: a.subarray(G.nu, G.nu + G.nv), w: a.subarray(G.nu + G.nv, G.nu + G.nv + G.nw), p: a.subarray(G.nu + G.nv + G.nw) });
  const b = new Float64Array(n);
  for (let q = 0; q < G.nu; q++) b[q] = lam * mk.chiU[q] * mk.usU[q];
  for (let q = 0; q < G.nv; q++) b[G.nu + q] = lam * mk.chiV[q] * mk.usV[q];
  for (let q = 0; q < G.nw; q++) b[G.nu + G.nv + q] = lam * mk.chiW[q] * mk.usW[q];
  // (the box's own faces held at nothing)
  { const B = un(b), N1 = N + 1; for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) { B.u[N1 * (j + N * k)] = 0; B.u[N + N1 * (j + N * k)] = 0; } for (let k = 0; k < Nz; k++) for (let i = 0; i < N; i++) { B.v[i + N * N1 * k] = 0; B.v[i + N * (N + N1 * k)] = 0; } for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { B.w[i + N * j] = 0; B.w[i + N * (j + N * Nz)] = 0; } }
  let x = guess && guess.length === n ? Float64Array.from(guess) : new Float64Array(n), gd = null, its = 0, res = 0;
  const cellMu = new Float64Array(G.np);
  for (let pass = 0; pass < (m.picard || 4); pass++) {
    for (let q = 0; q < G.np; q++) cellMu[q] = gd ? law(gd[q]) : muRef;
    // (inside a solid the reference viscosity: the drag holds the velocity there)
    for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = i + N * (j + N * k), c = (mk.chiU[i + (N + 1) * (j + N * k)] + mk.chiU[i + 1 + (N + 1) * (j + N * k)] + mk.chiV[i + N * (j + (N + 1) * k)] + mk.chiV[i + N * (j + 1 + (N + 1) * k)]) / 4; if (c > 0.5) cellMu[q] = muRef; }
    const L = mx3Level(G, Float64Array.from(cellMu), Float64Array.from(mk.chiU, c => lam * c), Float64Array.from(mk.chiV, c => lam * c), Float64Array.from(mk.chiW, c => lam * c), o.floor === 'slip');
    const Ls = mx3Levels(L);
    const r = mxFGMRES(n, (xx, y) => mx3Apply(L, un(xx), un(y)), (rr, z) => { z.fill(0); mx3Vcycle(Ls, 0, un(rr), un(z)); }, b, x, m.tol || 1e-6, m.maxIt || 60, 30);
    x = r.x; its += r.it; res = r.res; gd = mx3Shear(G, un(x), o.floor === 'slip');
    if (o.onPass) o.onPass(pass);
  }
  // the drag each solid puts on the paste: force, torque about the vessel's axis and its own, power (W)
  const nOwn = (o.nBlade || 0) + 2 + (o.extra ? o.extra.length : 0), F = Array.from({ length: nOwn }, () => ({ Fx: 0, Fy: 0, Fz: 0, Tq: 0, TqOwn: 0, P: 0 }));
  const X = un(x), dV = h * h * hz, N1 = N + 1;
  const axes = mx3Axes(o, t);
  for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 1; i < N; i++) { const q = i + N1 * (j + N * k), ow = mk.ownU[q]; if (ow < 0) continue; const f = lam * mk.chiU[q] * (mk.usU[q] - X.u[q]) * dV, y = G.x0 + (j + 0.5) * h, c = axes[ow] || [0, 0], Fq = F[ow]; Fq.Fx += f; Fq.Tq += -y * f; Fq.TqOwn += -(y - c[1]) * f; Fq.P += f * mk.usU[q]; }
  for (let k = 0; k < Nz; k++) for (let j = 1; j < N; j++) for (let i = 0; i < N; i++) { const q = i + N * (j + N1 * k), ow = mk.ownV[q]; if (ow < 0) continue; const f = lam * mk.chiV[q] * (mk.usV[q] - X.v[q]) * dV, xx = G.x0 + (i + 0.5) * h, c = axes[ow] || [0, 0], Fq = F[ow]; Fq.Fy += f; Fq.Tq += xx * f; Fq.TqOwn += (xx - c[0]) * f; Fq.P += f * mk.usV[q]; }
  for (let k = 1; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = i + N * (j + N * k), ow = mk.ownW[q]; if (ow < 0) continue; F[ow].Fz += lam * mk.chiW[q] * (mk.usW[q] - X.w[q]) * dV; }
  return { G, x, X, F, it: its, res, shear: gd, cellMu, mk, lam, muRef, gapW, gapF };
}
/** The cells of paste at a moment (their faces' solid share under a half). */
function mx3Fluid(G, mk) {
  const N = G.N, Nz = G.Nz, fl = new Uint8Array(G.np);
  for (let k = 0; k < Nz; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = (mk.chiU[i + (N + 1) * (j + N * k)] + mk.chiU[i + 1 + (N + 1) * (j + N * k)] + mk.chiV[i + N * (j + (N + 1) * k)] + mk.chiV[i + N * (j + 1 + (N + 1) * k)] + mk.chiW[i + N * (j + N * k)] + mk.chiW[i + N * (j + N * (k + 1))]) / 6;
    fl[i + N * (j + N * k)] = c < 0.5 ? 1 : 0;
  }
  return fl;
}
/** Each moving part's own axis at time t (the blades', the disc's; the wall's the vessel's). */
function mx3Axes(o, t) {
  const Wa = 2 * Math.PI * (o.No || 0), ph = (o.phi0 || 0) + Wa * t, ax = { 0: [0, 0] };
  for (let b = 0; b < (o.nBlade || 0); b++) { const a = ph + 2 * Math.PI * b / o.nBlade; ax[1 + b] = [o.ro * Math.cos(a), o.ro * Math.sin(a)]; }
  if (o.nBlade) { const a = ph + Math.PI / o.nBlade; ax[o.nBlade + 1] = [o.rD * Math.cos(a), o.rD * Math.sin(a)]; }
  if (o.extra) for (const e of o.extra) ax[e.own] = e.axis || [0, 0];
  return ax;
}

/** The velocity at a point in 3D from the faces (trilinear on each component's own grid; the floor's and the box's
 *  faces as the grid holds them). */
function mx3VelAt(G, X, x, y, z) {
  const N = G.N, Nz = G.Nz, h = G.h, hz = G.hz, fx = (x - G.x0) / h, fy = (y - G.x0) / h, fz = z / hz;
  const tri = (arr, nx, ny, nz, sx, sy, sz) => {
    const a = fx - sx, b = fy - sy, c = fz - sz, i = Math.floor(a), j = Math.floor(b), k = Math.max(0, Math.min(nz - 2, Math.floor(c))), s = a - i, t = b - j, q = Math.max(0, Math.min(1, c - k));
    const at = (ii, jj, kk) => (ii < 0 || jj < 0 || ii >= nx || jj >= ny || kk < 0 || kk >= nz) ? 0 : arr[ii + nx * (jj + ny * kk)];
    let r = 0; for (const [di, dj, dk, w] of [[0, 0, 0, (1 - s) * (1 - t) * (1 - q)], [1, 0, 0, s * (1 - t) * (1 - q)], [0, 1, 0, (1 - s) * t * (1 - q)], [1, 1, 0, s * t * (1 - q)], [0, 0, 1, (1 - s) * (1 - t) * q], [1, 0, 1, s * (1 - t) * q], [0, 1, 1, (1 - s) * t * q], [1, 1, 1, s * t * q]]) if (w) r += w * at(i + di, j + dj, k + dk);
    return r;
  };
  return [tri(X.u, N + 1, N, Nz, 0, 0.5, 0.5), tri(X.v, N, N + 1, Nz, 0.5, 0, 0.5), tri(X.w, N, N, Nz + 1, 0.5, 0.5, 0)];
}
/**
 * The whole batch over the blades' cycle: the creeping flow at nAng moments evenly over the time the blades' frames take to
 * come back to the same place against the arm (2π / (ratio · nBar) of the arm's turn); each moment's power and torque by
 * part. Then, as the flow at a moment follows from where the parts are, the flow at any time is the cycle's (turned with
 * the arm): tracers and the temperature carried through it over the arm's turns asked for. o: as mx3Solve's, mesh: { …,
 * nAng, turns (the tracers' and the heat's), steps (per arm turn) }, heat, tracers, levels (the heights of the horizontal
 * sections: the floor gap's, the disc's, the middle). Returns { G, moments: [{ phi, t, P, Tq, TqOwn, it }], sections,
 * shear: { dead (the batch's share never sheared above gdDead), high (its share sheared above tauC at some moment) },
 * tracers, heat, ms }.
 */
function mx3Run(o) {
  const t0 = Date.now(), m = o.mesh || {}, nAng = Math.max(1, m.nAng || 4), Wa = 2 * Math.PI * (o.No || 0);
  const per = Wa && o.ratio > 0 ? 2 * Math.PI / (o.ratio * o.nBar) : 2 * Math.PI, law = o.law || mxLaw(o.tab);
  const moments = [], fields = [];
  let guess = null, G = null;
  // (the progress: a step for each moment, then each of the tracers' steps)
  const nTrS = m.turns > 0 && Wa ? Math.round(m.turns * (m.steps || 120)) : 0, nProg = nAng + nTrS;
  for (let a = 0; a < nAng; a++) {
    const phi = per * a / nAng, t = Wa ? phi / Wa : 0;
    const r = mx3Solve({ ...o, law }, t, guess);
    G = r.G; guess = r.x;
    // (the heat the shear makes in the paste: ∫ μ γ̇² over its cells, against the power the parts put in)
    const flm = mx3Fluid(r.G, r.mk); let Dis = 0; for (let q = 0; q < r.G.np; q++) if (flm[q]) Dis += law(r.shear[q]) * r.shear[q] * r.shear[q];
    Dis *= r.G.h * r.G.h * r.G.hz;
    moments.push({ phi, t, P: r.F.map(f => f.P), Tq: r.F.map(f => f.Tq), TqOwn: r.F.map(f => f.TqOwn), Fz: r.F.map(f => f.Fz), it: r.it, res: r.res, Dis, gapW: r.gapW, gapF: r.gapF });
    fields.push({ X: { u: Float64Array.from(r.X.u), v: Float64Array.from(r.X.v), w: Float64Array.from(r.X.w), p: Float64Array.from(r.X.p) }, gd: r.shear, mu: r.cellMu, mk: r.mk });
    if (o.onProgress) o.onProgress({ k: a + 1, n: nProg, what: 'moment' });
  }
  const N = G.N, Nz = G.Nz, h = G.h, hz = G.hz, R = o.D / 2, f32 = a => Float32Array.from(a);
  // the cells' fluid (not in a solid at any moment would be too strict: at the moment)
  const fl0 = fields.map(F => mx3Fluid(G, F.mk));
  // the shear the batch sees over the cycle: never above gdDead (a dead zone), above tauC at some moment (lumps break there)
  const gdDead = o.gdDead ?? 1, tauC = o.tracers && o.tracers.tauC != null ? o.tracers.tauC : Infinity;
  let nf = 0, nDead = 0, nHigh = 0;
  for (let q = 0; q < G.np; q++) {
    if (!fl0[0][q]) continue; nf++;
    let gmax = 0, tmax = 0; for (const F of fields) { gmax = Math.max(gmax, F.gd[q]); tmax = Math.max(tmax, law(F.gd[q]) * F.gd[q]); }
    if (gmax < gdDead) nDead++; if (tmax >= tauC) nHigh++;
  }
  // the sections: horizontal at the levels asked for (each cell's centre), and vertical through the arm (the plane holding
  //  the vessel's axis and the blades' axes at the first moment), each moment's speed, shear rate, viscosity
  const levels = o.levels || [o.db / 2, o.hD, (o.H || Nz * hz) / 2];
  const sections = fields.map((F, a) => {
    const cellVel = (i, j, k) => { const X = F.X, q = i + N * (j + N * k); return [(X.u[i + (N + 1) * (j + N * k)] + X.u[i + 1 + (N + 1) * (j + N * k)]) / 2, (X.v[i + N * (j + (N + 1) * k)] + X.v[i + N * (j + 1 + (N + 1) * k)]) / 2, (X.w[q] + X.w[q + N * N]) / 2]; };
    const horiz = levels.map(z => {
      const k = Math.max(0, Math.min(Nz - 1, Math.floor(z / hz))), ux = new Float32Array(N * N), uy = new Float32Array(N * N), uz = new Float32Array(N * N), gd = new Float32Array(N * N), mu = new Float32Array(N * N), fl = new Uint8Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const [a1, b1, c1] = cellVel(i, j, k), q = i + N * (j + N * k), c = i + N * j; ux[c] = a1; uy[c] = b1; uz[c] = c1; gd[c] = F.gd[q]; mu[c] = law(F.gd[q]); fl[c] = fl0[a][q]; }
      return { z: (k + 0.5) * hz, ux, uy, uz, gd, mu, fluid: fl };
    });
    // the vertical one: s across the vessel along the arm's direction at this moment, z up
    const ph = (o.phi0 || 0) + moments[a].phi, ex = Math.cos(ph), ey = Math.sin(ph), ns = N, us = new Float32Array(ns * Nz), wz = new Float32Array(ns * Nz), gv = new Float32Array(ns * Nz), un = new Float32Array(ns * Nz), fv = new Uint8Array(ns * Nz);
    for (let k = 0; k < Nz; k++) for (let q = 0; q < ns; q++) {
      const sc = -R + (q + 0.5) * 2 * R / ns, x = sc * ex, y = sc * ey, z = (k + 0.5) * hz, [vx, vy, vz] = mx3VelAt(G, F.X, x, y, z);
      const i = Math.min(N - 1, Math.max(0, Math.floor((x - G.x0) / h))), j = Math.min(N - 1, Math.max(0, Math.floor((y - G.x0) / h)));
      us[q + ns * k] = vx * ex + vy * ey; un[q + ns * k] = -vx * ey + vy * ex; wz[q + ns * k] = vz; gv[q + ns * k] = F.gd[i + N * (j + N * k)]; fv[q + ns * k] = fl0[a][i + N * (j + N * k)];
    }
    return { phi: moments[a].phi, horiz, vert: { ns, s: 2 * R, us, un, wz, gd: gv, fluid: fv } };
  });
  // the flow at time t: the cycle's moment before and after (turned with the arm by whole cycles), linear between them
  const velAt = (x, y, z, t) => {
    const ph = Wa * t, c = Math.floor(ph / per), loc = ph - c * per, f = loc / per * nAng, a0 = Math.floor(f) % nAng, wgt = f - Math.floor(f);
    const rot = c * per, cr = Math.cos(-rot), sr = Math.sin(-rot), xr = cr * x - sr * y, yr = sr * x + cr * y;
    const v0 = mx3VelAt(G, fields[a0].X, xr, yr, z);
    let v1;
    if (a0 + 1 < nAng) v1 = mx3VelAt(G, fields[a0 + 1].X, xr, yr, z);
    else { const c2 = Math.cos(-per), s2 = Math.sin(-per), x2 = c2 * xr - s2 * yr, y2 = s2 * xr + c2 * yr, w = mx3VelAt(G, fields[0].X, x2, y2, z), cb = Math.cos(per), sb = Math.sin(per); v1 = [cb * w[0] - sb * w[1], sb * w[0] + cb * w[1], w[2]]; }
    const vx = (1 - wgt) * v0[0] + wgt * v1[0], vy = (1 - wgt) * v0[1] + wgt * v1[1], vz = (1 - wgt) * v0[2] + wgt * v1[2], cb = Math.cos(rot), sb = Math.sin(rot);
    return [cb * vx - sb * vy, sb * vx + cb * vy, vz];
  };
  const gdAt = (x, y, z, t) => {
    const ph = Wa * t, c = Math.floor(ph / per), loc = ph - c * per, a0 = Math.round(loc / per * nAng) % nAng, rot = c * per, cr = Math.cos(-rot), sr = Math.sin(-rot), xr = cr * x - sr * y, yr = sr * x + cr * y;
    const i = Math.min(N - 1, Math.max(0, Math.floor((xr - G.x0) / h))), j = Math.min(N - 1, Math.max(0, Math.floor((yr - G.x0) / h))), k = Math.min(Nz - 1, Math.max(0, Math.floor(z / hz)));
    return fields[a0].gd[i + N * (j + N * k)];
  };
  // tracers through the cycle's flow over the turns asked for: seeded on a lattice through the paste
  let tracers = null; const turns = m.turns || 0, Hb = o.H || Nz * hz;
  if (turns > 0 && Wa) {
    const steps = m.steps || 120, dt = 2 * Math.PI / Wa / steps, nS = Math.round(turns * steps), nTr = (o.tracers && o.tracers.n) || 3000;
    const nn = Math.max(4, Math.round(Math.cbrt(nTr * 4 / Math.PI * (2 * R) / Hb) * 1)), nzT = Math.max(2, Math.round(nn * Hb / (2 * R)));
    const X = [], Y = [], Z = [];
    const S0 = mxSolids(o, 0);
    for (let a = 0; a < nn; a++) for (let b = 0; b < nn; b++) for (let c = 0; c < nzT; c++) {
      const x = -R + (a + 0.5) * 2 * R / nn, y = -R + (b + 0.5) * 2 * R / nn, z = (c + 0.5) * Hb / nzT;
      if (x * x + y * y < (R - h) ** 2 && !S0.some(s => s.own && z >= s.z0 && z <= s.z1 && (s.inside3 ? s.inside3(x, y, z) : s.inside(x, y)))) { X.push(x); Y.push(y); Z.push(z); }
    }
    const n = X.length, tx = Float64Array.from(X), ty = Float64Array.from(Y), tz = Float64Array.from(Z), col = Float64Array.from(Z, z => (z > Hb / 2 ? 1 : 0)), strain = new Float64Array(n), mix = [];
    const mixIndex = () => {
      const nb = 6, nbz = 6, cnt = new Float64Array(nb * nb * nbz), sum = new Float64Array(nb * nb * nbz); let cm = 0;
      for (let q = 0; q < n; q++) { const a = Math.min(nb - 1, Math.max(0, Math.floor((tx[q] + R) / (2 * R) * nb))), b = Math.min(nb - 1, Math.max(0, Math.floor((ty[q] + R) / (2 * R) * nb))), c = Math.min(nbz - 1, Math.max(0, Math.floor(tz[q] / Hb * nbz))), k = a + nb * (b + nb * c); cnt[k]++; sum[k] += col[q]; cm += col[q]; }
      cm /= n; let v = 0, w = 0; for (let k = 0; k < cnt.length; k++) if (cnt[k] >= 4) { const c = sum[k] / cnt[k]; v += cnt[k] * (c - cm) ** 2; w += cnt[k]; }
      return w ? v / w / (cm * (1 - cm)) : 1;
    };
    mix.push({ t: 0, I: mixIndex() });
    for (let s = 0; s < nS; s++) {
      const t = s * dt;
      for (let q = 0; q < n; q++) {
        const [u1, v1, w1] = velAt(tx[q], ty[q], tz[q], t), xs = tx[q] + dt * u1, ys = ty[q] + dt * v1, zs = tz[q] + dt * w1, [u2, v2, w2] = velAt(xs, ys, zs, t + dt);
        let xn = tx[q] + dt / 2 * (u1 + u2), yn = ty[q] + dt / 2 * (v1 + v2), zn = tz[q] + dt / 2 * (w1 + w2);
        const rr = Math.hypot(xn, yn); if (rr > R - h / 2) { xn *= (R - h / 2) / rr; yn *= (R - h / 2) / rr; }
        zn = Math.min(Hb - hz / 4, Math.max(hz / 4, zn));
        tx[q] = xn; ty[q] = yn; tz[q] = zn; strain[q] += gdAt(xn, yn, zn, t + dt) * dt;
      }
      if ((s + 1) % Math.max(1, Math.round(steps / 12)) === 0) mix.push({ t: t + dt, I: mixIndex() });
      if (o.onProgress && (s % 10 === 9 || s === nS - 1)) o.onProgress({ k: nAng + s + 1, n: nProg, what: 'tracers' });
    }
    // (the strain each tracer gathered: its median, the share below the cut a parcel needs (strainLow))
    const sorted = Float64Array.from(strain).sort(), sLow = o.strainLow ?? 100;
    let low = 0; for (const v of strain) if (v < sLow) low++;
    tracers = { n, x: f32(tx), y: f32(ty), z: f32(tz), x0: f32(X), y0: f32(Y), z0: f32(Z), strain: f32(strain), mix, median: sorted[Math.floor(n / 2)], lowShare: low / n, sLow, turns };
  }
  return { G: { N, Nz, h, hz, x0: G.x0 }, moments, sections, levels, per, shear: { dead: nf ? nDead / nf : 0, high: nf ? nHigh / nf : 0, gdDead, tauC }, tracers, ms: Date.now() - t0 };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { mx3Fluid, mx3VelAt, mx3Run, mx3Grid, mx3Vec, mx3Rows, mx3Apply, mx3Smooth, mx3Level, mx3Levels, mx3Vcycle, mx3Mark, mx3Shear, mx3Solve, mx3Axes, mx2VelAt, mx2Run, mxLaw, mxSolids, mxSlice, mx2Grid, mx2Vec, mx2Diag, mx2Apply, mx2Smooth, mx2Coarsen, mx2Levels, mx2Vcycle, mxFGMRES, mx2Mark, mx2Shear, mx2Coefs, mx2Forces, MX_MG };
