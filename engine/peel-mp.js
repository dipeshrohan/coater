'use strict';
/*
 * peel-mp.js — MP-PEEL: the film peeled off its fibre web. Pure computation, no DOM: the multiphysics worker and Node.
 *
 * 2D, the peel front: a section along the line (x along it, z up), the film on its web where it leaves it.
 *  - The film: its layers as the drying left them at the peel (film.js), each its stiffness at the water it holds
 *    (transversely isotropic: along it, through it, the shear between its layers) and its natural strain (its water's
 *    and its temperature's since it set), as strains from the film's state bonded on the web. Plane strain: the film is
 *    hundreds of millimetres wide, its width held as it was on the web within a few millimetres of the front.
 *  - The web under it, its underside held (the web on a roller or a table: no slip, flat).
 *  - The film's hold on the web: a cohesive layer between them (bilinear: stiff until its strength, then softening to
 *    nothing at the separation that has taken the hold's energy Gi per area; one law for opening and sliding, the
 *    separation's size; pressed together it pushes back). Where the film has already left, nothing holds it.
 *  - The peeled arm turns through the peel angle: finite rotations, small strains (total Lagrangian, St Venant–Kirchhoff
 *    about the bonded state), 9-node elements, Newton with a line search. Its end pulled by the force per width f in the
 *    direction θ (from the web on the peeled side: 0 along the web, 180° folded back over the film still on it).
 * The steady peel: the force at which the hold gives way along the whole layer (the front runs): the energy the far
 * field gives up per area, f (1 − cos θ) + (f + Aₙ)² / (2A) (A the film's stiffness along it, Aₙ its natural strains'
 * force), reaches Gi. The section is solved at forces rising to just under it; J around the front (two rings) and the
 * energy the cohesive layer takes check it.
 *
 * 1D, the roll: the film wound turn by turn on the winder's core (linear elements out through the roll; each turn's pull
 * pressing the roll beneath, Hakiel's accretion, linear), then at rest its heat and water through the turns, their change
 * a natural strain along and through the turns; the turns push on each other and on the core but cannot pull (a gap opens,
 * the roll lifts off the core). A turn bent round the roll: its layers' stress against the film's strength.
 * SI (m, Pa, N/m).
 */

// ---- the film's stiffness: transversely isotropic (in-plane p, through the thickness t; the axis z) ----
/**
 * The 3D stiffness's normal block and the through-shear of a transversely isotropic solid, and its plane-strain
 * numbers with σzz = 0: Ex' = C11 − C13²/C33 (along x, its width held) and Qb = C11 + C12 − 2 C13²/C33 (the
 * biaxial modulus, E_p / (1 − ν_p): what an in-plane natural strain on both axes pushes with).
 */
function pmpTI(Ep, Et, nup, nupt, Gpt) {
  const S11 = 1 / Ep, S12 = -nup / Ep, S13 = -nupt / Ep, S33 = 1 / Et;
  const a = S11 + S12, det = a * S33 - 2 * S13 * S13;
  const Cp = S33 / det, C13 = -S13 / det, C33 = a / det, Cm = 1 / (S11 - S12);
  const C11 = (Cp + Cm) / 2, C12 = (Cp - Cm) / 2;
  return { C11, C12, C13, C33, C55: Gpt, Ex: C11 - C13 * C13 / C33, Qb: C11 + C12 - 2 * C13 * C13 / C33 };
}

// ---- the film's layers ----
/**
 * The film's layers through its thickness (bottom first): [{ t, C (pmpTI), en (its natural strain from the bonded
 * state, along and across it) }] → { h, z (each layer's bottom; z[n] = h), cells, at(z) → its cell, A, B, D (Ex' about
 * z = 0), An, Bn (Qb en), zN (the neutral plane), Dn (the bending stiffness about it) }.
 */
function pmpLayers(cells) {
  const z = [0];
  for (const c of cells) z.push(z[z.length - 1] + c.t);
  let A = 0, B = 0, D = 0, An = 0, Bn = 0;
  cells.forEach((c, i) => { const z0 = z[i], z1 = z[i + 1], E = c.C.Ex, Q = c.C.Qb;
    A += E * (z1 - z0); B += E * (z1 * z1 - z0 * z0) / 2; D += E * (z1 ** 3 - z0 ** 3) / 3; An += Q * c.en * (z1 - z0); Bn += Q * c.en * (z1 * z1 - z0 * z0) / 2; });
  const h = z[z.length - 1], zN = B / A, Dn = D - B * B / A;
  const at = zv => { let lo = 0, hi = cells.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (zv > z[m + 1]) lo = m + 1; else hi = m; } return cells[lo]; };
  return { h, z, cells, at, A, B, D, An, Bn, zN, Dn };
}

// ---- the steady peel's energy (the far field, exact for the section) ----
/**
 * The energy released per area of the front's advance, the section's far fields: G(f) = f (1 − cos θ) + (f + Aₙ)² / (2A):
 * the load's work f [(1 + ε) − cos θ] less the arm's stored energy over the bonded film's, the arm straight along θ with
 * ε = (f + Aₙ)/A along it (held straight against its natural curl: its moment then Bₙ − B ε... carried, not released).
 * pmpSteady(L, θ, Gi): the force where G = Gi (0 when the film's own natural strains release Gi: it comes off by itself).
 */
const pmpG = (L, f, th) => f * (1 - Math.cos(th)) + (f + L.An) * (f + L.An) / (2 * L.A);
function pmpSteady(L, th, Gi) {
  // a f² + b f + c = 0: f²/(2A) + f (1 − cos θ + Aₙ/A) + Aₙ²/(2A) − Gi
  const a = 1 / (2 * L.A), b = 1 - Math.cos(th) + L.An / L.A, c = L.An * L.An / (2 * L.A) - Gi;
  if (c >= 0) return 0;
  const disc = b * b - 4 * a * c, q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
  return Math.max(q / a, c / q);
}

// ---- the elastica (the arm from a clamped root): the guess the solve starts from, and its check ----
/**
 * An inextensible elastica clamped flat at s = 0, its far end pulled by f per width along θ: tan((θ − φ)/4) =
 * tan(θ/4) e^(−s/λ), λ = √(D/f); M = D φ' = 2 √(D f) sin((θ − φ)/2). Returns φ(s) and the curve (x, z) at s.
 */
function pmpElastica(f, th, D, sMax, n = 2000) {
  const lam = Math.sqrt(D / Math.max(f, 1e-30)), t4 = Math.tan(th / 4);
  const phi = s => th - 4 * Math.atan(t4 * Math.exp(-s / lam));
  const S = new Float64Array(n + 1), X = new Float64Array(n + 1), Z = new Float64Array(n + 1), P = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) S[i] = sMax * i / n;
  P[0] = phi(0);
  for (let i = 1; i <= n; i++) {
    const s0 = S[i - 1], s1 = S[i], sm = (s0 + s1) / 2, p0 = phi(s0), pm = phi(sm), p1 = phi(s1), ds = s1 - s0;
    X[i] = X[i - 1] + ds * (Math.cos(p0) + 4 * Math.cos(pm) + Math.cos(p1)) / 6;
    Z[i] = Z[i - 1] + ds * (Math.sin(p0) + 4 * Math.sin(pm) + Math.sin(p1)) / 6;
    P[i] = p1;
  }
  const at = s => { const u = Math.min(Math.max(s / sMax, 0), 1) * n, i = Math.min(n - 1, Math.floor(u)), w = u - i; return [X[i] + (X[i + 1] - X[i]) * w, Z[i] + (Z[i + 1] - Z[i]) * w, phi(s)]; };
  return { lam, phi, at, M: s => 2 * Math.sqrt(D * f) * Math.sin((th - phi(s)) / 2) };
}

// ---- the mesh ----
/** n element edges from a to b (b > a), the first (at a) d0 long, growing geometrically (even when n d0 ≥ b − a). */
function pmpGrow(a, b, n, d0) {
  const L = b - a, out = [a];
  if (!(d0 > 0) || d0 * n >= L) { for (let i = 1; i <= n; i++) out.push(a + L * i / n); return out; }
  let lo = 1, hi = 2;
  const sum = r => d0 * (Math.abs(r - 1) < 1e-12 ? n : (Math.pow(r, n) - 1) / (r - 1));
  while (sum(hi) < L) hi *= 2;
  for (let it = 0; it < 200; it++) { const m = (lo + hi) / 2; if (sum(m) < L) lo = m; else hi = m; }
  const r = (lo + hi) / 2;
  let x = a, d = d0;
  for (let i = 1; i < n; i++) { x += d; out.push(x); d *= r; }
  out.push(b);
  return out;
}
/** Element edges from a to b with the elements growing from d0 by at most the ratio g each (the fewest that do), none
 *  longer than cap: graded up to it, then even. */
function pmpGraded(a, b, d0, g, cap = Infinity) {
  const L = b - a;
  if (d0 >= L) return [a, b];
  cap = Math.max(cap, d0);
  // (graded until an element would pass the cap: that part's length, then even elements of at most the cap)
  const nG = cap > d0 ? Math.max(0, Math.floor(Math.log(cap / d0) / Math.log(g))) : 0, LG = nG > 0 ? d0 * (Math.pow(g, nG) - 1) / (g - 1) : 0;
  if (LG >= L) { const n = Math.max(1, Math.ceil(Math.log(1 + (g - 1) * L / d0) / Math.log(g))); return pmpGrow(a, b, n, d0); }
  const head = nG > 0 ? pmpGrow(a, a + LG, nG, d0) : [a], nE = Math.max(1, Math.ceil((L - LG) / cap)), out = [...head];
  for (let i = 1; i <= nE; i++) out.push(a + LG + (L - LG) * i / nE);
  return out;
}

/**
 * The section's mesh. o: { L (pmpLayers), tw (the web's thickness), Lb (the bonded film behind the front), La (the arm),
 * Lw (the bare web past the front), fine (the smallest element at the front, along), zone (the length kept that fine
 * behind the front), grow (each next element at most this much longer), nzF, nzW (elements through the film, the web) }.
 * Returns { xs (node columns' x), film: { c0, c1 } (columns), web: { c0, c1 }, zF, zW (node z), nodes N, X, Z (reference),
 * id(col, part, k), elems [{ part, n: [9 ids], X9, Z9 }], pairs [{ w (web top), f (film bottom), x, wt (its area) }], ends }.
 */
function pmpMesh(o) {
  const g = o.grow || 1.15, fine = o.fine, zone = Math.min(o.zone || 20 * fine, o.Lb / 2);
  // along: the bonded film (−Lb … −zone graded, −zone … 0 even), the arm (0 … La graded); the bare web to the arm's edge nearest Lw
  const nz = Math.max(1, Math.round(zone / fine)), even = []; for (let i = 0; i <= nz; i++) even.push(-zone + zone * i / nz);
  const back = pmpGraded(0, o.Lb - zone, fine, g, o.capB).map(v => -zone - v).reverse();
  const arm = pmpGraded(0, o.La, fine, g, o.capA);
  const xe = [...back.slice(0, -1), ...even, ...arm.slice(1)];
  const iTip = back.length - 1 + nz;                                 // (the edge at x = 0)
  let iWeb = iTip; while (iWeb < xe.length - 1 && xe[iWeb] < o.Lw - 1e-15) iWeb++;
  const xs = []; for (let e = 0; e < xe.length - 1; e++) xs.push(xe[e], (xe[e] + xe[e + 1]) / 2); xs.push(xe[xe.length - 1]);
  // through: the web graded toward the film (−tw … 0), the film even unless given its own planes
  const zWe = pmpGrow(0, o.tw, o.nzW, o.tw / o.nzW / (o.webGrade || 2)).map(v => -v).reverse();
  const zFe = o.zFilm || (() => { const out = []; for (let k = 0; k <= o.nzF; k++) out.push(o.L.h * k / o.nzF); return out; })();
  const mid = e => { const out = []; for (let k = 0; k < e.length - 1; k++) out.push(e[k], (e[k] + e[k + 1]) / 2); out.push(e[e.length - 1]); return out; };
  const zW = mid(zWe), zF = mid(zFe);
  const nC = xs.length, webC1 = 2 * iWeb, nW = zW.length, nF = zF.length;
  // numbering: column by column (the narrowest band), the web's nodes then the film's
  const start = new Int32Array(nC + 1);
  for (let c = 0; c < nC; c++) start[c + 1] = start[c] + (c <= webC1 ? nW : 0) + nF;
  const N = start[nC], X = new Float64Array(N), Z = new Float64Array(N);
  const id = (c, part, k) => start[c] + (part === 'web' ? k : (c <= webC1 ? nW : 0) + k);
  for (let c = 0; c < nC; c++) {
    if (c <= webC1) for (let k = 0; k < nW; k++) { const n = id(c, 'web', k); X[n] = xs[c]; Z[n] = zW[k]; }
    for (let k = 0; k < nF; k++) { const n = id(c, 'film', k); X[n] = xs[c]; Z[n] = zF[k]; }
  }
  const elems = [];
  const add = (part, ex, ez, nzN) => {
    const n = [], X9 = new Float64Array(9), Z9 = new Float64Array(9);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const k = id(2 * ex + a, part, 2 * ez + b); n.push(k); X9[a * 3 + b] = X[k]; Z9[a * 3 + b] = Z[k]; }
    elems.push({ part, ex, ez, n, X9, Z9 });
    void nzN;
  };
  for (let ex = 0; ex < xe.length - 1; ex++) {
    if (2 * ex + 2 <= webC1) for (let ez = 0; ez < zWe.length - 1; ez++) add('web', ex, ez);
    for (let ez = 0; ez < zFe.length - 1; ez++) add('film', ex, ez);
  }
  // the cohesive layer: a spring between each web-top and film-bottom node pair, its area by Simpson's weights
  const wt = new Float64Array(nC);
  for (let ex = 0; ex < iWeb; ex++) { const L = xe[ex + 1] - xe[ex]; wt[2 * ex] += L / 6; wt[2 * ex + 1] += 2 * L / 3; wt[2 * ex + 2] += L / 6; }
  const pairs = [];
  for (let c = 0; c <= webC1; c++) pairs.push({ c, w: id(c, 'web', nW - 1), f: id(c, 'film', 0), x: xs[c], wt: wt[c] });
  // the arm's end face (Simpson's weights over its height), the left face, the web's underside
  const endW = []; for (let k = 0; k < nF; k++) endW.push(0);
  for (let e = 0; e < zFe.length - 1; e++) { const L = zFe[e + 1] - zFe[e]; endW[2 * e] += L / 6; endW[2 * e + 1] += 2 * L / 3; endW[2 * e + 2] += L / 6; }
  const ends = { arm: zF.map((_, k) => id(nC - 1, 'film', k)), armW: endW.map(v => v / o.L.h),
    left: [...zW.map((_, k) => id(0, 'web', k)), ...zF.map((_, k) => id(0, 'film', k))], under: [] };
  for (let c = 0; c <= webC1; c++) ends.under.push(id(c, 'web', 0));
  let bw = 0;
  for (const E of elems) { let lo = Infinity, hi = -Infinity; for (const k of E.n) { lo = Math.min(lo, k); hi = Math.max(hi, k); } bw = Math.max(bw, hi - lo); }
  for (const P of pairs) bw = Math.max(bw, Math.abs(P.f - P.w));
  return { xs, xe, iTip, cTip: 2 * iTip, webC1, zW, zF, zWe, zFe, nW, nF, N, X, Z, id, elems, pairs, ends, bw: 2 * bw + 1, nC };
}

// ---- the banded symmetric solve (L D Lᵀ, no pivoting: the tangent can be indefinite where the hold softens) ----
function pmpBand(n, bw) { return { n, bw, w: bw + 1, a: new Float64Array(n * (bw + 1)) }; }
const pmpAdd = (B, i, j, v) => { if (j <= i) B.a[i * B.w + (i - j)] += v; };
/** Factor in place (row i: a[i w + (i − j)] for j = i − bw … i): L (unit, below) and D (on the diagonal). */
function pmpLDL(B) {
  const { n, bw, w, a } = B, tmp = new Float64Array(bw + 1);
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    // first nonzero of row i
    let f = j0; while (f < i && a[i * w + (i - f)] === 0) f++;
    for (let j = f; j < i; j++) {
      // l_ij d_j = a_ij − Σ_k<j l_ik d_k l_jk
      let s = a[i * w + (i - j)];
      const k0 = Math.max(f, j - bw);
      for (let k = k0; k < j; k++) s -= tmp[k - j0] * a[j * w + (j - k)];
      tmp[j - j0] = s;                                    // (l_ij d_j)
      a[i * w + (i - j)] = s / a[j * w];                  // l_ij
    }
    let d = a[i * w];
    for (let j = f; j < i; j++) d -= tmp[j - j0] * a[i * w + (i - j)];
    if (!(Math.abs(d) > 0) || !Number.isFinite(d)) throw new Error('peel section: the stiffness is singular');
    a[i * w] = d;
  }
  return B;
}
function pmpLDLSolve(B, r) {
  const { n, bw, w, a } = B, x = Float64Array.from(r);
  for (let i = 0; i < n; i++) { let s = x[i]; for (let j = Math.max(0, i - bw); j < i; j++) s -= a[i * w + (i - j)] * x[j]; x[i] = s; }
  for (let i = 0; i < n; i++) x[i] /= a[i * w];
  for (let i = n - 1; i >= 0; i--) { let s = x[i]; for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= a[k * w + (k - i)] * x[k]; x[i] = s; }
  return x;
}

// ---- the elements ----
const PMP_G3 = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], PMP_W3 = [5 / 9, 8 / 9, 5 / 9];
const pmpN3 = s => [s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], pmpD3 = s => [s - 0.5, -2 * s, s + 0.5];
/** Each element's Gauss points (3×3): N, dN/dX, dN/dZ, the weight (× det), X, Z, its material. */
function pmpGauss(M, matOf) {
  for (const E of M.elems) {
    E.gp = [];
    for (let ga = 0; ga < 3; ga++) for (let gb = 0; gb < 3; gb++) {
      const s = PMP_G3[ga], t = PMP_G3[gb], Ns = pmpN3(s), Nt = pmpN3(t), Ds = pmpD3(s), Dt = pmpD3(t);
      const N = new Float64Array(9), dNs = new Float64Array(9), dNt = new Float64Array(9);
      let xs = 0, xt = 0, zs = 0, zt = 0, xg = 0, zg = 0;
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const n = a * 3 + b; N[n] = Ns[a] * Nt[b]; dNs[n] = Ds[a] * Nt[b]; dNt[n] = Ns[a] * Dt[b];
        xs += dNs[n] * E.X9[n]; xt += dNt[n] * E.X9[n]; zs += dNs[n] * E.Z9[n]; zt += dNt[n] * E.Z9[n]; xg += N[n] * E.X9[n]; zg += N[n] * E.Z9[n]; }
      const det = xs * zt - xt * zs;
      if (!(det > 0)) throw new Error('peel section: an element is folded');
      const dX = new Float64Array(9), dZ = new Float64Array(9);
      for (let n = 0; n < 9; n++) { dX[n] = (zt * dNs[n] - zs * dNt[n]) / det; dZ[n] = (-xt * dNs[n] + xs * dNt[n]) / det; }
      E.gp.push({ N, dX, dZ, w: PMP_W3[ga] * PMP_W3[gb] * det, X: xg, Z: zg, m: matOf(E.part, zg) });
    }
  }
}
/** At a Gauss point: the displacement gradient, the Green–Lagrange strain, the second Piola–Kirchhoff stress, the energy. */
function pmpPoint(E, q, u) {
  let ux = 0, uz = 0, wx = 0, wz = 0;
  for (let a = 0; a < 9; a++) { const k = E.n[a], U = u[2 * k], W = u[2 * k + 1]; ux += q.dX[a] * U; uz += q.dZ[a] * U; wx += q.dX[a] * W; wz += q.dZ[a] * W; }
  const Exx = ux + 0.5 * (ux * ux + wx * wx), Ezz = wz + 0.5 * (uz * uz + wz * wz), Gxz = uz + wx + ux * uz + wx * wz;
  const m = q.m, en = m.en, a = Exx - en, b = -en;
  const Sxx = m.C11 * a + m.C12 * b + m.C13 * Ezz, Szz = m.C13 * (a + b) + m.C33 * Ezz, Sxz = m.C55 * Gxz;
  const W = 0.5 * (m.C11 * (a * a + b * b) + 2 * m.C12 * a * b + 2 * m.C13 * Ezz * (a + b) + m.C33 * Ezz * Ezz + m.C55 * Gxz * Gxz);
  return { ux, uz, wx, wz, Exx, Ezz, Gxz, Sxx, Szz, Sxz, W };
}

// ---- the cohesive layer ----
/** The hold's law: { K (its stiffness per area), d0 = σ̂/K, df = 2 Gi/σ̂ }; d(κ) the damage at the largest separation κ. */
const pmpDamage = (c, k) => (k <= c.d0 ? 0 : k >= c.df ? 1 : c.df * (k - c.d0) / (k * (c.df - c.d0)));
const pmpDamageD = (c, k) => (k <= c.d0 || k >= c.df ? 0 : c.df * c.d0 / (k * k * (c.df - c.d0)));
/** One pair: separation (film − web) → its traction on the film (t), the tangent (2×2, symmetric), the damage then. */
function pmpCohesive(c, dx, dz, kOld) {
  const dn = Math.max(dz, 0), de = Math.sqrt(dn * dn + dx * dx), k = Math.max(kOld, de), d = pmpDamage(c, k), s = (1 - d) * c.K;
  const tx = s * dx, tz = dz > 0 ? s * dz : c.K * dz;
  let Txx = s, Txz = 0, Tzz = dz > 0 ? s : c.K;
  if (de >= kOld && de > c.d0 && de < c.df) {
    const g = c.K * pmpDamageD(c, de) / de;
    Txx -= g * dx * dx; Txz -= g * dx * dn; if (dz > 0) Tzz -= g * dn * dn;
  }
  return { tx, tz, Txx, Txz, Tzz, k, d };
}

// ---- the section, solved ----
/**
 * The section's set-up for the inputs (as pmpFront takes them): the film's numbers, the hold's law, the force sought,
 * the front's lengths and the mesh's options -- the page draws the mesh the solve uses from it.
 */
function pmpPlan(o) {
  const L = pmpLayers(o.layers), th = o.theta, hold = o.hold, Cw = o.web.C;
  const fSS = pmpSteady(L, th, hold.Gi), frac = o.frac ?? 0.99, fT = o.f ?? fSS * frac;
  const K = hold.K || 50 * Cw.C33 / o.web.tw, coh = { K, d0: hold.sig / K, df: 2 * hold.Gi / hold.sig };
  if (!(coh.df > coh.d0)) throw new Error('peel section: the hold\'s strength is too high for its energy and stiffness');
  // (the front's lengths: the film's bending length at the force λ = √(D/f), the hold's process zone (a beam on its
  //  softening layer) ℓ = (D δf / σ̂)^¼, the shear lag ℓs = √(A tw / G_web): over it the bonded film hands its own pull
  //  to the web behind the front)
  const lam = Math.sqrt(L.Dn / Math.max(fT, 1e-9)), lz = Math.pow(L.Dn * coh.df / hold.sig, 0.25), ls = Math.sqrt(L.A * o.web.tw / Cw.C55);
  const ms = o.mesh || {};
  const mo = { L, tw: o.web.tw, nzF: ms.nzF || 4, nzW: ms.nzW || 4, grow: ms.grow || 1.15, webGrade: ms.webGrade || 3,
    fine: ms.fine || Math.min(L.h / 2, lz / 12), Lb: ms.Lb || Math.max(30 * lz, 8 * o.web.tw, 3 * lam, 6 * ls), La: ms.La || 7 * lam };
  mo.zone = ms.zone || Math.min(3 * lz, mo.Lb / 3);
  // (the bare web under the whole arm: J's rings may reach far along it; the elements along the arm at most λ/24)
  mo.Lw = ms.Lw || mo.La; mo.capA = ms.capA || lam / 24; mo.capB = ms.capB || Math.max(lam / 6, 2 * o.web.tw);
  return { L, th, hold, Cw, fSS, fT, coh, lam, lz, ls, mo };
}
/**
 * The peel front. o: {
 *   layers: [{ t, C: pmpTI(…), en }] (the film, bottom first), web: { tw, C },
 *   hold: { Gi, sig (its strength), K (its stiffness per area; default 50 × the web's through-thickness E / tw) },
 *   theta (rad), f (the force per width; default just under the steady peel's), frac (that fraction of it, 0.99),
 *   steps (the fractions of f solved on the way up), mesh: { Lb, La, Lw, fine, zone, nzF, nzW, grow },
 *   onProgress ({ k, n }) }.
 * Returns the solution: the mesh, the displacements, the stresses (per node: S_xx along the film, S_zz, S_xz), the hold
 * (each pair's separation, traction, damage), and the answers (see the end).
 */
function pmpFront(o) {
  const { L, th, hold, Cw, fSS, fT, coh, lam, lz, ls, mo } = pmpPlan(o);
  const M = pmpMesh(mo);
  const matOf = (part, z) => { if (part === 'web') return { ...Cw, en: 0 }; const c = L.at(z); return { ...c.C, en: c.en }; };
  pmpGauss(M, matOf);
  // (held: the web's underside; the left end (the film still on the web far behind the front) pulled by the bonded
  //  film's own stress, −Qb en, as if the film went on -- the web carries none there)
  const nd = 2 * M.N, fixed = new Uint8Array(nd);
  for (const k of M.ends.under) { fixed[2 * k] = 1; fixed[2 * k + 1] = 1; }
  // the hold: bonded behind the front (x ≤ 0), gone past it (the film already peeled there)
  const kap = new Float64Array(M.pairs.length);
  M.pairs.forEach((P, i) => { kap[i] = P.x > 1e-15 ? Infinity : 0; });
  // the loads. At the arm's end: the far arm's own stress, straight along θ (dead: its direction stays θ) -- the arm goes
  // on to the winder held straight, its pull f and its natural strains' moment carried: S(z) = Ex' ε − Qb en,
  // ε = (f + Aₙ)/A (Aₙ with the natural strains as far as they have come in), on the end face with the film's elements'
  // shape functions (3 Gauss points each). At the left end: the bonded film's, −Qb en, pulling back along the line.
  let enNow = 1;
  const Fext = (f) => {
    const F = new Float64Array(nd), cx = Math.cos(th), sz = Math.sin(th), eps = (f + enNow * L.An) / L.A, c = M.nC - 1;
    for (let e = 0; e + 1 < M.zFe.length; e++) {
      const z0 = M.zFe[e], z1 = M.zFe[e + 1], hz = (z1 - z0) / 2;
      for (let g = 0; g < 3; g++) {
        const t = PMP_G3[g], zg = (z0 + z1) / 2 + t * hz, N3 = pmpN3(t), cell = L.at(zg), S = cell.C.Ex * eps - cell.C.Qb * enNow * cell.en, Sb = -cell.C.Qb * enNow * cell.en;
        for (let b = 0; b < 3; b++) {
          const k = M.id(c, 'film', 2 * e + b), w = PMP_W3[g] * hz * N3[b] * S; F[2 * k] += w * cx; F[2 * k + 1] += w * sz;
          const kl = M.id(0, 'film', 2 * e + b); F[2 * kl] -= PMP_W3[g] * hz * N3[b] * Sb;
        }
      }
    }
    return F;
  };
  // the residual and the tangent
  const B = pmpBand(nd, M.bw), R = new Float64Array(nd);
  const ke = new Float64Array(18 * 18), fe = new Float64Array(18), Bm = new Float64Array(3 * 18);
  function assemble(u, F, withK, kTrial) {
    R.fill(0); if (withK) B.a.fill(0);
    for (const E of M.elems) {
      fe.fill(0); if (withK) ke.fill(0);
      for (const q of E.gp) {
        const P = pmpPoint(E, q, u), m = q.m, w = q.w;
        for (let a = 0; a < 9; a++) {
          const Nx = q.dX[a], Nz = q.dZ[a];
          Bm[2 * a] = (1 + P.ux) * Nx; Bm[2 * a + 1] = P.wx * Nx;
          Bm[18 + 2 * a] = P.uz * Nz; Bm[18 + 2 * a + 1] = (1 + P.wz) * Nz;
          Bm[36 + 2 * a] = (1 + P.ux) * Nz + P.uz * Nx; Bm[36 + 2 * a + 1] = P.wx * Nz + (1 + P.wz) * Nx;
        }
        for (let r = 0; r < 18; r++) fe[r] += (Bm[r] * P.Sxx + Bm[18 + r] * P.Szz + Bm[36 + r] * P.Sxz) * w;
        if (!withK) continue;
        for (let r = 0; r < 18; r++) {
          const b0 = Bm[r], b1 = Bm[18 + r], b2 = Bm[36 + r];
          const d0 = m.C11 * b0 + m.C13 * b1, d1 = m.C13 * b0 + m.C33 * b1, d2 = m.C55 * b2;
          for (let c = 0; c <= r; c++) ke[r * 18 + c] += (d0 * Bm[c] + d1 * Bm[18 + c] + d2 * Bm[36 + c]) * w;
        }
        for (let a = 0; a < 9; a++) for (let b = 0; b <= a; b++) {
          const g = (q.dX[a] * (P.Sxx * q.dX[b] + P.Sxz * q.dZ[b]) + q.dZ[a] * (P.Sxz * q.dX[b] + P.Szz * q.dZ[b])) * w;
          ke[(2 * a) * 18 + 2 * b] += g; ke[(2 * a + 1) * 18 + 2 * b + 1] += g;
          if (b < a) { /* (the upper triangle of the pair a, b is the lower of b, a: added below as its transpose) */ }
        }
      }
      for (let a = 0; a < 9; a++) for (let i = 0; i < 2; i++) {
        const r = 2 * a + i, gr = 2 * E.n[a] + i; R[gr] += fe[r];
        if (!withK) continue;
        for (let b = 0; b < 9; b++) for (let j = 0; j < 2; j++) {
          const c = 2 * b + j, gc = 2 * E.n[b] + j;
          if (gc > gr) continue;
          const v = c <= r ? ke[r * 18 + c] : ke[c * 18 + r];
          pmpAdd(B, gr, gc, v);
        }
      }
    }
    // the hold
    M.pairs.forEach((P, i) => {
      if (P.wt === 0) return;
      const dx = u[2 * P.f] - u[2 * P.w], dz = u[2 * P.f + 1] - u[2 * P.w + 1];
      if (kap[i] === Infinity && dz >= 0) { kTrial[i] = Infinity; return; }
      const c = pmpCohesive(coh, dx, dz, kap[i] === Infinity ? coh.df : kap[i]);
      kTrial[i] = kap[i] === Infinity ? Infinity : c.k;
      const tx = c.tx * P.wt, tz = c.tz * P.wt;
      R[2 * P.f] += tx; R[2 * P.f + 1] += tz; R[2 * P.w] -= tx; R[2 * P.w + 1] -= tz;
      if (!withK) return;
      const T = [[c.Txx * P.wt, c.Txz * P.wt], [c.Txz * P.wt, c.Tzz * P.wt]];
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const v = T[a][b];
        pmpAdd(B, 2 * P.f + a, 2 * P.f + b, v); pmpAdd(B, 2 * P.w + a, 2 * P.w + b, v);
        pmpAdd(B, Math.max(2 * P.f + a, 2 * P.w + b), Math.min(2 * P.f + a, 2 * P.w + b), -v);
      }
    });
    for (let i = 0; i < nd; i++) R[i] -= F[i];
    for (let i = 0; i < nd; i++) if (fixed[i]) R[i] = 0;
    if (withK) for (let i = 0; i < nd; i++) if (fixed[i]) {
      for (let d = 0; d <= M.bw && i - d >= 0; d++) B.a[i * B.w + d] = 0;
      for (let d = 1; d <= M.bw && i + d < nd; d++) B.a[(i + d) * B.w + d] = 0;
      B.a[i * B.w] = 1;
    }
  }
  const norm = v => { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; return Math.sqrt(s); };
  // the guess: the elastica from a clamped root along the arm (its neutral plane), the rest at rest (the web too)
  const u = new Float64Array(nd), webNode = new Uint8Array(M.N);
  for (let c = 0; c <= M.webC1; c++) for (let k = 0; k < M.nW; k++) webNode[M.id(c, 'web', k)] = 1;
  const shape = (f) => {
    const el = pmpElastica(f, th, L.Dn, mo.La * 1.05), eps = (f + enNow * L.An) / L.A, du = new Float64Array(nd);
    for (let k = 0; k < M.N; k++) {
      const x = M.X[k];
      if (x <= 0 || webNode[k]) continue;
      const [ex, ez, ph] = el.at(x), zeta = M.Z[k] - L.zN;
      du[2 * k] = ex * (1 + eps) - zeta * Math.sin(ph) - x; du[2 * k + 1] = L.zN + ez * (1 + eps) + zeta * Math.cos(ph) - M.Z[k];
    }
    return du;
  };
  const guess = shape;
  // the force raised in steps to the target (the front is held where it is only below the steady peel's force: there the
  // hold's softening layer takes the whole of Gi and the front may stand anywhere -- the stiffness against its moving
  // goes to nought, so the target stays a little below it); a step that finds no equilibrium is halved (three times),
  // and the last one solved stands when it is within 5 % of the target
  // (the film's natural strains come in over the first steps, at the first step's force: the arm's guess, an elastica
  //  without them, is far from its curl when they are large)
  const enHas = o.layers.some(c => c.en), ramp = enHas ? [0, 0.25, 0.5, 0.75] : [];
  const steps = o.steps || [...ramp.map(() => 0.3), 0.3, 0.6, 0.8, 0.9, 0.95, 0.975, 1], enAt = si => (si < ramp.length ? ramp[si] : 1);
  for (const E of M.elems) for (const q of E.gp) q.m.en0 = q.m.en;
  const setEn = sc => { enNow = sc; for (const E of M.elems) for (const q of E.gp) q.m.en = q.m.en0 * sc; };
  const kTrial = new Float64Array(M.pairs.length), log = [];
  let prevShape = null, iters = 0, reached = 0;
  const uOK = new Float64Array(nd);
  const solveAt = (frac) => {
    const f = fT * frac, F = Fext(f), sh = guess(f);
    // (the predictor: the arm moved by the elastica's change since the last step, beyond the front)
    if (!prevShape) u.set(sh); else for (let i = 0; i < nd; i++) u[i] += sh[i] - prevShape[i];
    let ok = false, r0 = 0, rN = 0, lastDu = Infinity;
    for (let it = 0; it < 60; it++) {
      assemble(u, F, true, kTrial);
      rN = norm(R); if (it === 0) r0 = rN;
      // (converged: the residual a billionth of the load, or the step a ten-billionth of the displacements with the
      //  residual at the round-off of the internal forces -- far above the load's when the film holds a stress)
      const scale = Math.max(norm(F), 1e-30);
      if (rN / scale < 1e-9 || (lastDu < 1e-10 * norm(u) && rN / scale < 1e-5)) { ok = true; break; }
      pmpLDL(B);
      const du = pmpLDLSolve(B, R.map(v => -v));
      for (let i = 0; i < nd; i++) if (fixed[i]) du[i] = 0;
      // a line search on the residual's size
      let a = 1, best = null;
      const u0 = Float64Array.from(u);
      for (let ls = 0; ls < 8; ls++) {
        for (let i = 0; i < nd; i++) u[i] = u0[i] + a * du[i];
        assemble(u, F, false, kTrial);
        const rr = norm(R);
        if (!best || rr < best.r) best = { a, r: rr };
        if (rr < rN * (1 - 1e-4 * a)) break;
        a /= 2;
      }
      if (best.a !== a) for (let i = 0; i < nd; i++) u[i] = u0[i] + best.a * du[i];
      lastDu = best.a * norm(du);
      if (o.debug) o.debug({ frac, it, r: rN, a: best.a, rNew: best.r, du: norm(du) });
      iters++;
    }
    log.push({ f, frac, ok, r0, r: rN });
    if (ok) { prevShape = sh; for (let i = 0; i < kap.length; i++) kap[i] = kTrial[i]; uOK.set(u); reached = frac; }
    else { u.set(uOK); }
    return ok;
  };
  for (let si = 0; si < steps.length; si++) {
    setEn(enAt(si));
    let ok = solveAt(steps[si]);
    for (let h = 0, lo = reached, hi = steps[si]; !ok && h < 3; h++) { const mid = (lo + hi) / 2; if (solveAt(mid)) { lo = mid; ok = solveAt(hi); } else hi = mid; }
    if (o.onProgress) o.onProgress({ k: si + 1, n: steps.length });
    if (!ok) break;
  }
  if (!(reached >= 0.95)) throw new Error(`peel section: no equilibrium past ${(fT * reached).toPrecision(4)} N/m (${(reached * 100).toFixed(1)} % of the force sought)`);
  const fDone = fT * reached;
  return pmpAnswers(M, L, u, coh, kap, { th, f: fDone, fSS, hold, o, mo, lam, lz, ls, iters, log, Fext, fixed });
}

/** The answers from a solved section: the stresses, the hold along the front, J, the arm, the film's largest pull. */
function pmpAnswers(M, L, u, coh, kap, s) {
  const { th, f, hold } = s;
  // stresses at the nodes (each element's Gauss points' mean, averaged over the elements at a node)
  const N = M.N, Sx = new Float64Array(N), Sz = new Float64Array(N), Sxz = new Float64Array(N), cnt = new Float64Array(N);
  let top = { s: -Infinity }, bot = { s: -Infinity }, any = { s: -Infinity };
  for (const E of M.elems) {
    let mx = 0, mz = 0, mxz = 0;
    for (const q of E.gp) {
      const P = pmpPoint(E, q, u);
      mx += P.Sxx / 9; mz += P.Szz / 9; mxz += P.Sxz / 9;
      if (E.part === 'film' && P.Sxx > any.s) any = { s: P.Sxx, x: q.X, z: q.Z };
    }
    for (const k of E.n) { Sx[k] += mx; Sz[k] += mz; Sxz[k] += mxz; cnt[k]++; }
  }
  for (let k = 0; k < N; k++) if (cnt[k]) { Sx[k] /= cnt[k]; Sz[k] /= cnt[k]; Sxz[k] /= cnt[k]; }
  // the film's stress along itself on its faces: each bottom (top) row element's Gauss points through it, at each of its
  // three Gauss columns along, extrapolated to the face (the quadratic through ζ = −√0.6, 0, √0.6 at ζ = ∓1)
  const ga2 = 0.6, lo3 = [(1 + Math.sqrt(ga2)) / (2 * ga2), (ga2 - 1) / ga2, (1 - Math.sqrt(ga2)) / (2 * ga2)], hi3 = [lo3[2], lo3[1], lo3[0]];
  const faceRow = [];
  for (const E of M.elems) {
    if (E.part !== 'film' || (E.ez !== 0 && E.ez !== M.zFe.length - 2)) continue;
    for (let gx = 0; gx < 3; gx++) {
      const S3 = [0, 1, 2].map(gz => pmpPoint(E, E.gp[gx * 3 + gz], u).Sxx), x = E.gp[gx * 3 + 1].X;
      let row = faceRow.find(r => r.x === x);
      if (!row) { row = { x, bot: NaN, top: NaN }; faceRow.push(row); }
      if (E.ez === 0) row.bot = lo3[0] * S3[0] + lo3[1] * S3[1] + lo3[2] * S3[2];
      if (E.ez === M.zFe.length - 2) row.top = hi3[0] * S3[0] + hi3[1] * S3[1] + hi3[2] * S3[2];
    }
  }
  faceRow.sort((p, q) => p.x - q.x);
  for (const r of faceRow) { if (r.top > top.s) top = { s: r.top, x: r.x }; if (r.bot > bot.s) bot = { s: r.bot, x: r.x }; }
  // the hold along the front: each pair's separation, traction and damage
  const holdRow = M.pairs.map((P, i) => {
    const dx = u[2 * P.f] - u[2 * P.w], dz = u[2 * P.f + 1] - u[2 * P.w + 1];
    const k = kap[i], d = k === Infinity ? 1 : pmpDamage(coh, k), sc = (1 - d) * coh.K;
    return { x: P.x, dx, dz, tx: sc * dx, tz: dz > 0 ? sc * dz : coh.K * dz, d };
  });
  // the crack's tip (the last point fully gone, from behind) and the zone (the hold softening)
  let zoneEnd = null;
  const bonded = holdRow.filter(r => r.d < 1 - 1e-12);
  const tipX = bonded.length ? Math.max(...bonded.map(r => r.x)) : 0;
  for (const r of holdRow) if (r.d > 0 && r.d < 1 && (zoneEnd === null || r.x < zoneEnd)) zoneEnd = r.x;
  // the energy the hold took: ∫ t · ∂[[u]]/∂x dx across the zone (each segment's mean traction times its separation's change)
  let Phi = 0, PhiN = 0;
  for (let i = 0; i + 1 < holdRow.length; i++) {
    const a = holdRow[i], b = holdRow[i + 1];
    if (a.x > tipX + 1e-15) break;
    const tn = (a.tz + b.tz) / 2, tt = (a.tx + b.tx) / 2;
    PhiN += tn * (b.dz - a.dz); Phi += tn * (b.dz - a.dz) + tt * (b.dx - a.dx);
  }
  // J around the front: the domain integral with q (1 within a of the front, falling linearly to 0 at b, along X) at the
  // nodes and interpolated as the displacements are (exact rings: no element cut by a kink in q), the bulk alone
  const J = (a, b) => {
    const qn = X => { const r = Math.abs(X - tipX); return r <= a ? 1 : r >= b ? 0 : (b - r) / (b - a); };
    let v = 0;
    for (const E of M.elems) {
      const q9 = E.X9.map(qn);
      if (q9.every(t => t === q9[0])) continue;
      for (const qp of E.gp) {
        let dq = 0; for (let k = 0; k < 9; k++) dq += qp.dX[k] * q9[k];
        if (dq === 0) continue;
        const P = pmpPoint(E, qp, u);
        // (the first Piola–Kirchhoff P = F S; the front advances along −X: J = ∫ (W − P_i1 u_i,1) dq/dX dA, and the
        //  term P_i2 u_i,1 dq/dZ is nought: q does not change through the thickness)
        const F11 = 1 + P.ux, F12 = P.uz, F21 = P.wx, F22 = 1 + P.wz;
        const P11 = F11 * P.Sxx + F12 * P.Sxz, P21 = F21 * P.Sxx + F22 * P.Sxz;
        let dqz = 0; for (let k = 0; k < 9; k++) dqz += qp.dZ[k] * q9[k];
        const P12 = F11 * P.Sxz + F12 * P.Szz, P22 = F21 * P.Sxz + F22 * P.Szz;
        v += ((P.W - (P11 * P.ux + P21 * P.wx)) * dq - (P12 * P.ux + P22 * P.wx) * dqz) * qp.w;
      }
    }
    return v;
  };
  const span = Math.min(M.xs[M.webC1] - tipX, tipX - M.xs[0]);
  const Jin = J(0.1 * span, 0.3 * span), Jout = J(0.5 * span, 0.9 * span);
  // the arm: its mid-plane's angle and its moment, element column by element column at the elements' middles: the film's
  // Gauss points there (exact through the thickness), the section's line from its bottom node to its top node
  const arm = [], x0 = zoneEnd ?? tipX, filmCols = new Map();
  for (const E of M.elems) if (E.part === 'film') { if (!filmCols.has(E.ex)) filmCols.set(E.ex, []); filmCols.get(E.ex).push(E); }
  for (const [ex, Es] of [...filmCols.entries()].sort((p, q) => p[0] - q[0])) {
    const c = 2 * ex + 1;
    if (M.xs[c] < x0 - (M.xs[c + 1] - M.xs[c - 1])) continue;
    let Mo = 0, Nn = 0;
    for (const E of Es) for (let gb = 0; gb < 3; gb++) {
      const qp = E.gp[3 + gb], P = pmpPoint(E, qp, u), wz = PMP_W3[gb] * (E.Z9[2] - E.Z9[0]) / 2;
      Nn += P.Sxx * wz; Mo -= P.Sxx * (qp.Z - L.zN) * wz;
    }
    const kb = M.id(c, 'film', 0), kt = M.id(c, 'film', M.nF - 1);
    const xb = M.X[kb] + u[2 * kb], zb = M.Z[kb] + u[2 * kb + 1], xt = M.X[kt] + u[2 * kt], zt = M.Z[kt] + u[2 * kt + 1];
    // (M: the moment bending the arm up, about its neutral plane; N its pull along itself; φ the section's turn)
    arm.push({ s: M.xs[c], phi: Math.atan2(-(xt - xb), zt - zb), M: Mo, N: Nn, x: (xb + xt) / 2, z: (zb + zt) / 2 });
  }
  // the root: the arm's angle where the hold has gone (the crack's tip)
  const rootPhi = (() => { let best = null; for (const a of arm) if (a.s >= tipX - 1e-15) { best = a; break; } return best ? best.phi : 0; })();
  return {
    th, f, fSS: s.fSS, G: pmpG(L, f, th), Gi: hold.Gi, J: { inner: Jin, outer: Jout }, Phi, PhiN,
    tipX, zoneEnd, zone: zoneEnd === null ? 0 : tipX - zoneEnd, rootPhi,
    sMax: any, sTop: top, sBot: bot, lam: s.lam, lz: s.lz, ls: s.ls, iters: s.iters, log: s.log,
    mesh: { nodes: M.N, elems: M.elems.length, unknowns: 2 * M.N, band: M.bw, fine: s.mo.fine, Lb: s.mo.Lb, La: s.mo.La, Lw: s.mo.Lw, xs: M.xs, zF: M.zF, zW: M.zW, webC1: M.webC1, nW: M.nW, nF: M.nF },
    u, Sx, Sz, Sxz, holdRow, faceRow, arm, L, M,
  };
}

// ---- the 2D run the app asks for: the film as the drying left it at the peel, at the hand's angle and the winder's ----
/**
 * o: { cells: [{ t, Ep, Et, nup, nupt, Gpt, en }] (the film from the web up; en from its bonded state), web: { tw, Ew,
 * Et, nuw, nupt, G }, hold: { Gi, sig }, angles: [degrees] (the first the hand's), mesh: { nzF, nzW, grow, armN },
 * onProgress }. Returns { angles: [each angle's answers, compact], L: the film's numbers, ms }.
 */
function pmpRun2D(o) {
  const t0 = Date.now(), cells = o.cells.map(c => ({ t: c.t, C: pmpTI(c.Ep, c.Et, c.nup, c.nupt, c.Gpt), en: c.en }));
  const web = { tw: o.web.tw, C: pmpTI(o.web.Ew, o.web.Et, o.web.nuw, o.web.nupt, o.web.G) }, L = pmpLayers(cells);
  const n = o.angles.length, ms = o.mesh || {}, out = [];
  o.angles.forEach((deg, i) => {
    const th = deg * Math.PI / 180, lam = Math.sqrt(L.Dn / Math.max(pmpSteady(L, th, o.hold.Gi) * 0.99, 1e-9));
    const t1 = Date.now();
    const r = pmpFront({ layers: cells, web, hold: o.hold, theta: th,
      mesh: { nzF: ms.nzF, nzW: ms.nzW, grow: ms.grow, capA: ms.armN ? lam / ms.armN : undefined },
      onProgress: q => { if (o.onProgress) o.onProgress({ k: i * 10 + q.k, n: n * 10 }); } });
    out.push(pmpCompact(r, deg, Date.now() - t1));
    if (o.onProgress) o.onProgress({ k: (i + 1) * 10, n: n * 10 });
  });
  return { angles: out, L: { h: L.h, A: L.A, An: L.An, Bn: L.Bn, zN: L.zN, Dn: L.Dn, kFree: (L.A * L.Bn - L.B * L.An) / (L.A * L.D - L.B * L.B) }, ms: Date.now() - t0 };
}
/** One angle's answers, compact (rounded; the section near the front kept for the drawings). */
function pmpCompact(r, deg, ms) {
  const p = (x, k = 5) => (Number.isFinite(x) ? +(+x).toPrecision(k) : null), M = r.M, u = r.u;
  // (the section drawn: the columns within a window round the front -- the hold's zone, the arm's turn -- every node)
  const w = Math.max(1.6 * r.lam, 12 * r.lz);
  const cols = [];
  // (the elements' corners: every second column, every second node through)
  for (let c = 0; c < M.nC; c += 2) {
    const x = M.xs[c];
    if (x < r.tipX - w || x > r.tipX + 3 * w) continue;
    const film = [], web = [];
    for (let k = 0; k < M.nF; k += 2) { const id = M.id(c, 'film', k); film.push([p(M.X[id] + u[2 * id], 6), p(M.Z[id] + u[2 * id + 1], 6), p(r.Sx[id] / 1e6, 4)]); }
    if (c <= M.webC1) for (let k = 0; k < M.nW; k += 2) { const id = M.id(c, 'web', k); web.push([p(M.X[id] + u[2 * id], 6), p(M.Z[id] + u[2 * id + 1], 6), p(r.Sx[id] / 1e6, 4)]); }
    cols.push({ x: p(x, 6), film, web });
  }
  const near = q => q.x > r.tipX - w && q.x < r.tipX + 3 * w;
  return {
    deg, f: p(r.f), fSS: p(r.fSS), G: p(r.G), Gi: r.Gi, J: { inner: p(r.J.inner), outer: p(r.J.outer) }, Phi: p(r.Phi), PhiN: p(r.PhiN),
    tipX: p(r.tipX), zone: p(r.zone), rootPhi: p(r.rootPhi), lam: p(r.lam), lz: p(r.lz), ls: p(r.ls), iters: r.iters, ms,
    sMax: { s: p(r.sMax.s), x: p(r.sMax.x), z: p(r.sMax.z) }, sBot: { s: p(r.sBot.s), x: p(r.sBot.x) }, sTop: { s: p(r.sTop.s), x: p(r.sTop.x) },
    mesh: { nodes: r.mesh.nodes, elems: r.mesh.elems, unknowns: r.mesh.unknowns, band: r.mesh.band, fine: p(r.mesh.fine), Lb: p(r.mesh.Lb), La: p(r.mesh.La), nF: M.nF, nW: M.nW,
      nxE: M.xe.length - 1, zFe: M.zFe.map(v => p(v, 6)), zWe: M.zWe.map(v => p(v, 6)) },
    face: r.faceRow.filter(near).map(q => [p(q.x, 6), p(q.bot / 1e6, 4), p(q.top / 1e6, 4)]),
    hold: r.holdRow.filter(near).map(q => [p(q.x, 6), p(q.tz / 1e6, 4), p(q.tx / 1e6, 4), p(q.d, 4), p(q.dz, 4), p(q.dx, 4)]),
    arm: r.arm.map(a => [p(a.s, 6), p(a.phi, 5), p(a.M, 5), p(a.N, 5), p(a.x, 6), p(a.z, 6)]),
    cols,
  };
}

// ---- 1D, the roll: wound turn by turn on its core, then its heat and its water through the turns ----
/**
 * A turn's stiffness in the roll (plane stress across its width, σz = 0), cylindrically orthotropic: along it (hoop,
 * E_θ), through the turns (radial, E_r), ν_θr the radial strain a hoop stress gives (ε_r = −ν_θr σ_θ/E_θ; ν_rθ = ν_θr E_r/E_θ).
 * Returns Q (σ = Q ε, [r, θ]) as [Qrr, Qrθ, Qθθ].
 */
function pmpRollQ(Er, Eth, nuTr) {
  const Srr = 1 / Er, Stt = 1 / Eth, Srt = -nuTr / Eth, det = Srr * Stt - Srt * Srt;
  return [Stt / det, -Srt / det, Srr / det];
}
/** The core's stiffness against a pressure on it (per radian, per width: p R0 = k u's inward push): a tube of bore Ri. */
const pmpCoreK = (E, nu, R0, Ri) => (E > 0 ? E / ((R0 * R0 + Ri * Ri) / (R0 * R0 - Ri * Ri) - nu) : 0);
/**
 * The roll's 1D mesh: element e from R0 + e H to R0 + (e + 1) H (H the turns it holds × a turn's thickness), linear,
 * two Gauss points. The stiffness of elements 0 … nE − 1 (each its Q) and the core's spring; the loads of an eigenstrain.
 */
function pmpRollK(R0, H, Qs, nE, kCore) {
  const n = nE + 1, K = { d: new Float64Array(n), o: new Float64Array(n) };   // (tridiagonal: diagonal, the one above)
  const g = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  for (let e = 0; e < nE; e++) {
    const r0 = R0 + e * H, Q = Qs[e];
    let k00 = 0, k01 = 0, k11 = 0;
    for (const t of g) {
      const r = r0 + H * (1 + t) / 2, N0 = (1 - t) / 2, N1 = (1 + t) / 2, w = H / 2 * r;
      // B rows: ε_r = (u1 − u0)/H, ε_θ = (N0 u0 + N1 u1)/r
      const b = [[-1 / H, 1 / H], [N0 / r, N1 / r]];
      const k = (i, j) => (b[0][i] * (Q[0] * b[0][j] + Q[1] * b[1][j]) + b[1][i] * (Q[1] * b[0][j] + Q[2] * b[1][j])) * w;
      k00 += k(0, 0); k01 += k(0, 1); k11 += k(1, 1);
    }
    K.d[e] += k00; K.d[e + 1] += k11; K.o[e] += k01;
  }
  K.d[0] += kCore;
  return K;
}
/** A symmetric tridiagonal solve (d diagonal, o the one above), n unknowns. */
function pmpTriSym(K, f, n) {
  const c = new Float64Array(n), x = new Float64Array(n);
  let den = K.d[0]; c[0] = K.o[0] / den; x[0] = f[0] / den;
  for (let i = 1; i < n; i++) { den = K.d[i] - K.o[i - 1] * c[i - 1]; c[i] = i < n - 1 ? K.o[i] / den : 0; x[i] = (f[i] - K.o[i - 1] * x[i - 1]) / den; }
  for (let i = n - 2; i >= 0; i--) x[i] -= c[i] * x[i + 1];
  return x;
}
/** Each element's stress at its middle (σ_r, σ_θ) from the displacements u and its eigenstrain [ε*_r, ε*_θ]. */
function pmpRollStress(R0, H, Qs, nE, u, eig) {
  const sr = new Float64Array(nE), st = new Float64Array(nE);
  for (let e = 0; e < nE; e++) {
    const r = R0 + (e + 0.5) * H, er = (u[e + 1] - u[e]) / H - (eig ? eig[e][0] : 0), et = (u[e] + u[e + 1]) / 2 / r - (eig ? eig[e][1] : 0), Q = Qs[e];
    sr[e] = Q[0] * er + Q[1] * et; st[e] = Q[1] * er + Q[2] * et;
  }
  return { sr, st };
}
/**
 * The roll. o: {
 *   R0 (the core's radius), core: { E, nu, Ri }, h (a turn: the film, and the liner if one goes with it), n (turns), per
 *   (turns an element holds), Tw (the pull per width it is wound with, N/m), Er, Eth, nuTr (a turn's stiffnesses through
 *   the roll and along it; ν_θr), the time after: tEnd (s), steps; heat: { T0 (as wound), k, rhoc, hOut, Troom };
 *   water: { X0 (as wound), gab: { Xm, C, K, T0, Hc }, Xcap (if any), rhoD (GO per volume of turn), Kv (vapour permeability through the
 *   turns, kg/(m s Pa)), rhRoom }, beta, betaT (a turn's swelling along it and through it per kg/kg of water), alpha,
 *   alphaT (per K), onProgress }.
 * Winding: each element's turns added in turn, their pull pressing on the roll beneath, p = Σ Tw / r (Hakiel's accretion,
 * linear here: the stiffnesses held); each turn keeps the hoop stress it was wound with, Tw / h. Then the roll at rest:
 * its heat and its water through the turns (implicit; the outer turn to the room, the core sealed), each step's change
 * of temperature and water a natural strain (along: β ΔX + α ΔT; through: β_t ΔX + α_t ΔT) the roll takes, the outside
 * free, the core's spring holding. The turns cannot pull on each other or on the core: where they would, they lift apart
 * (a gap, nothing through it) or off the core, until they close again.
 * Returns { r (element middles), wound: { sr, st }, end: { sr, st }, series: [{ t, T: [..], X: [..], sr: [..], st: [..] }]
 * (at the snapshots), hist: [{ t, coreP, X, T, pMax, gaps, onCore }] (each step: the core's pressure, the mean water and
 * temperature, the largest pressure, the gaps between elements, on the core or lifted off it), gaps (1 where element i
 * has lifted off element i − 1), onCore, coreP (the pressure on the core after winding and at the end), R1, n, H, ms }.
 */
function pmpRoll(o) {
  const t0 = Date.now(), per = Math.max(1, Math.round(o.per || 1)), nE = Math.max(1, Math.ceil(o.n / per)), H = per * o.h, R0 = o.R0, R1 = R0 + nE * H;
  const Q = pmpRollQ(o.Er, o.Eth, o.nuTr || 0), Qs = Array.from({ length: nE }, () => Q);
  const kC = pmpCoreK(o.core.E, o.core.nu ?? 0.3, R0, Math.min(o.core.Ri ?? 0, R0 * 0.999));
  const rM = Float64Array.from({ length: nE }, (_, e) => R0 + (e + 0.5) * H);
  // ---- winding ----
  const sr = new Float64Array(nE), st = new Float64Array(nE), uW = new Float64Array(nE + 1);
  for (let e = 0; e < nE; e++) {
    // (the element's turns' pull: Tw / r at each, onto the roll beneath, R0 … r_e)
    const rIn = R0 + e * H;
    let p = 0; for (let j = 0; j < per; j++) p += o.Tw / (rIn + (j + 0.5) * o.h);
    if (e > 0) {
      const K = pmpRollK(R0, H, Qs, e, kC), f = new Float64Array(e + 1);
      f[e] = -p * rIn;
      const du = pmpTriSym(K, f, e + 1), d = pmpRollStress(R0, H, Qs, e, du, null);
      for (let i = 0; i < e; i++) { sr[i] += d.sr[i]; st[i] += d.st[i]; }
      for (let i = 0; i <= e; i++) uW[i] += du[i];
    } else if (kC > 0) uW[0] += -p * R0 / kC;
    // (the new element: its turns' wound-in hoop stress; through it from the next turns' pressure to none: its mean)
    st[e] = o.Tw / o.h; sr[e] = -p / 2;
    if (o.onProgress && (e % 20 === 0 || e === nE - 1)) o.onProgress({ k: e + 1, n: nE + (o.steps || 0) });
  }
  const wound = { sr: Float64Array.from(sr), st: Float64Array.from(st) };
  const coreW = -(sr[0] + (sr[0] - (nE > 1 ? sr[1] : sr[0])) / 2);   // (σ_r extrapolated to the core: its pressure)
  // ---- at rest: heat and water through the turns, each step's change a natural strain ----
  const steps = o.steps || 0, series = [];
  const T = new Float64Array(nE).fill(o.heat ? o.heat.T0 : 0), a = new Float64Array(nE), X = new Float64Array(nE);
  const W = o.water, Hh = o.heat;
  const psat = typeof drPsat === 'function' ? drPsat : (typeof require === 'function' ? require('./drying.js').drPsat : null);
  // (the isotherm: GO's own water, GAB at the turn's temperature (with the heat solved), capped at Xcap if given; or a
  //  straight line X = lin · a, the checks')
  const Xof = (q, Tq) => (W && W.lin ? W.lin * q : Math.min(pmpGAB(q, W.gab, Tq), W.Xcap ?? Infinity)), dXda = (q, Tq) => { if (W.lin) return W.lin; const d = 1e-6, lo = Math.max(0, q - d), hi = Math.min(1, q + d); return Xof(hi, Tq) - Xof(lo, Tq) > 0 ? (Xof(hi, Tq) - Xof(lo, Tq)) / (hi - lo) : 1e-9; };
  const Tiso = e => (Hh ? T[e] : undefined);
  if (W) { const a0 = W.lin ? Math.min(1, W.X0 / W.lin) : pmpGABinv(Math.min(W.X0, W.Xcap ?? Infinity), W.gab, Tiso(0)); a.fill(a0); X.fill(Xof(a0, Tiso(0))); }
  const X0 = Float64Array.from(X), Tst = Float64Array.from(T);
  // (at rest, each element's stiffness on its own two nodes; elements i − 1 and i share a node where they touch, their push
  //  on each other as wound sW -- each side's own nodal force from its stress as wound, their mean -- let go where a gap
  //  opens; the core's spring pushes only)
  const gp = [-1 / Math.sqrt(3), 1 / Math.sqrt(3)], gapOpen = new Uint8Array(nE), sW = new Float64Array(nE);
  const Kel = { d: new Float64Array(2 * nE), o: new Float64Array(2 * nE) }, fW = new Float64Array(2 * nE);
  for (let e = 0; e < nE; e++) {
    const r0 = R0 + e * H; let k00 = 0, k01 = 0, k11 = 0;
    for (const t of gp) {
      const r = r0 + H * (1 + t) / 2, N0 = (1 - t) / 2, N1 = (1 + t) / 2, w = H / 2 * r, b = [[-1 / H, 1 / H], [N0 / r, N1 / r]];
      const kk = (i, j) => (b[0][i] * (Q[0] * b[0][j] + Q[1] * b[1][j]) + b[1][i] * (Q[1] * b[0][j] + Q[2] * b[1][j])) * w;
      k00 += kk(0, 0); k01 += kk(0, 1); k11 += kk(1, 1);
      fW[2 * e] += (-1 / H * wound.sr[e] + N0 / r * wound.st[e]) * w; fW[2 * e + 1] += (1 / H * wound.sr[e] + N1 / r * wound.st[e]) * w;
    }
    Kel.d[2 * e] += k00; Kel.d[2 * e + 1] += k11; Kel.o[2 * e] += k01;
  }
  for (let i = 1; i < nE; i++) sW[i] = (fW[2 * i] - fW[2 * i - 1]) / 2;
  const tolS = 1e-9 * (Q[0] * R0 + Math.max(0, ...sW.map(Math.abs)));
  let coreOn = kC > 0 ? 1 : 0;
  const snapAt = new Set(); for (const f of [0, 0.1, 0.25, 0.5, 1]) snapAt.add(Math.round(f * steps));
  const snap = (k, t) => series.push({ t, T: Array.from(T), X: Array.from(X), sr: Array.from(sr), st: Array.from(st) });
  // (each step's few numbers: the core's pressure, the roll's mean water and temperature, the largest pressure in it)
  const hist = [], corePOf = () => -(sr[0] + (sr[0] - (nE > 1 ? sr[1] : sr[0])) / 2);
  const histAdd = t => { let xm = 0, tm = 0, w = 0, pm = 0, nOpen = 0; for (let e = 0; e < nE; e++) { xm += X[e] * rM[e]; tm += T[e] * rM[e]; w += rM[e]; pm = Math.max(pm, -sr[e]); nOpen += gapOpen[e]; } hist.push({ t, coreP: coreOn ? corePOf() : 0, X: xm / w, T: tm / w, pMax: pm, gaps: nOpen, onCore: coreOn }); };
  if (steps) { snap(0, 0); histAdd(0); }
  const dt = steps ? o.tEnd / steps : 0;
  // (finite volumes on the elements: their faces at R0 + e H; the outer turn's face to the room)
  const solveTri = (A, B, C, Rr) => { const n = B.length, cp = new Float64Array(n), dp = new Float64Array(n), x = new Float64Array(n); cp[0] = C[0] / B[0]; dp[0] = Rr[0] / B[0]; for (let i = 1; i < n; i++) { const m = B[i] - A[i] * cp[i - 1]; cp[i] = C[i] / m; dp[i] = (Rr[i] - A[i] * dp[i - 1]) / m; } x[n - 1] = dp[n - 1]; for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1]; return x; };
  for (let k = 1; k <= steps; k++) {
    const Xn = Float64Array.from(X);
    // heat: ρc ∂T/∂t = (1/r) ∂/∂r (r k ∂T/∂r), the outside h (T − T_room), the core sealed
    if (Hh) {
      const A = new Float64Array(nE), B = new Float64Array(nE), C = new Float64Array(nE), Rr = new Float64Array(nE);
      for (let e = 0; e < nE; e++) {
        const vol = rM[e] * H, cap = Hh.rhoc * vol / dt;
        B[e] = cap; Rr[e] = cap * T[e];
        if (e > 0) { const G = Hh.k * (R0 + e * H) / H; A[e] = -G; B[e] += G; }
        if (e < nE - 1) { const G = Hh.k * (R0 + (e + 1) * H) / H; C[e] = -G; B[e] += G; }
        else { const G = R1 / (1 / Hh.hOut + H / 2 / Hh.k); B[e] += G; Rr[e] += G * Hh.Troom; }
      }
      T.set(solveTri(A, B, C, Rr));
    }
    // water: ρ_D dX/da ∂a/∂t = (1/r) ∂/∂r (r K_v p_sat ∂a/∂r), the outside held at the room's humidity; Newton on a
    if (W) {
      for (let it = 0; it < 30; it++) {
        const A = new Float64Array(nE), B = new Float64Array(nE), C = new Float64Array(nE), Rr = new Float64Array(nE);
        for (let e = 0; e < nE; e++) {
          const ps = psat(T[e]), vol = rM[e] * H;
          Rr[e] = W.rhoD * (Xof(a[e], Tiso(e)) - Xn[e]) * vol / dt; B[e] = W.rhoD * dXda(a[e], Tiso(e)) * vol / dt;
          if (e > 0) { const G = W.Kv * (R0 + e * H) / H, pl = psat(T[e - 1]); Rr[e] += G * (a[e] * ps - a[e - 1] * pl); B[e] += G * ps; A[e] = -G * pl; }
          if (e < nE - 1) { const G = W.Kv * (R0 + (e + 1) * H) / H, pr = psat(T[e + 1]); Rr[e] += G * (a[e] * ps - a[e + 1] * pr); B[e] += G * ps; C[e] = -G * pr; }
          else { const G = W.Kv * R1 / (H / 2), pr = W.rhRoom * psat(Hh ? Hh.Troom : T[e]); Rr[e] += G * (a[e] * ps - pr); B[e] += G * ps; }
        }
        const d = solveTri(A, B, C, Rr.map(v => -v));
        let mx = 0; for (let e = 0; e < nE; e++) { const an = Math.min(1, Math.max(0, a[e] + d[e])); mx = Math.max(mx, Math.abs(an - a[e])); a[e] = an; }
        if (mx < 1e-11) break;
      }
      for (let e = 0; e < nE; e++) X[e] = Xof(a[e], Tiso(e));
    }
    // the stress since the roll was wound: its stress as wound, and what the change of water and heat since gives (the
    // outside free, the core's spring). The turns cannot pull on each other or on the core: neighbouring elements share a
    // node only while they push on each other (a gap opens where they would pull, closes where they would overlap), and the
    // core's spring pushes only (the roll lifts off it). Solved in total each step, the gaps and the core's contact
    // found again until they hold; the as-wound state's own imbalance (the mesh's) taken off: no change, no stress change
    const dEr = new Float64Array(nE), dEt = new Float64Array(nE);
    // (element e's own nodal force at its bottom (j 0) or top (1) from its stress: as wound, less its natural strain's, and
    //  the displacement's since)
    const nodalF = (e, u, j) => {
      const r0 = R0 + e * H; let F = 0;
      for (const t of gp) {
        const r = r0 + H * (1 + t) / 2, N0 = (1 - t) / 2, N1 = (1 + t) / 2, w = H / 2 * r, er = (u[2 * e + 1] - u[2 * e]) / H - dEr[e], et = (N0 * u[2 * e] + N1 * u[2 * e + 1]) / r - dEt[e];
        const sR = wound.sr[e] + Q[0] * er + Q[1] * et, sT = wound.st[e] + Q[1] * er + Q[2] * et;
        F += (j ? 1 / H * sR + N1 / r * sT : -1 / H * sR + N0 / r * sT) * w;
      }
      return F;
    };
    let any = false;
    for (let e = 0; e < nE; e++) { const dX = X[e] - X0[e], dT = T[e] - Tst[e]; dEr[e] = (o.betaT || 0) * dX + (o.alphaT || 0) * dT; dEt[e] = (o.beta || 0) * dX + (o.alpha || 0) * dT; any = any || !!(dEr[e] || dEt[e]); }
    if (any || gapOpen.some(v => v) || !coreOn) {
      const nD = 2 * nE, Fs = new Float64Array(nD);
      // (the natural strains' load, element by element on its own two nodes)
      for (let e = 0; e < nE; e++) {
        const r0 = R0 + e * H, sR = Q[0] * dEr[e] + Q[1] * dEt[e], sT = Q[1] * dEr[e] + Q[2] * dEt[e];
        for (const t of gp) { const r = r0 + H * (1 + t) / 2, N0 = (1 - t) / 2, N1 = (1 + t) / 2, w = H / 2 * r; Fs[2 * e] += (-1 / H * sR + N0 / r * sT) * w; Fs[2 * e + 1] += (1 / H * sR + N1 / r * sT) * w; }
      }
      const now = Uint8Array.from(gapOpen);
      let cNow = coreOn, u = null, map = null;
      for (let it = 0; it < 80; it++) {
        // (the nodes: an element's bottom shares the one under it where they touch, its own where a gap is)
        map = new Int32Array(nD); let nd = 0;
        for (let e = 0; e < nE; e++) { map[2 * e] = e === 0 ? nd++ : now[e] ? nd++ : map[2 * e - 1]; map[2 * e + 1] = nd++; }
        const K = { d: new Float64Array(nd), o: new Float64Array(nd) }, f = new Float64Array(nd);
        for (let e = 0; e < nE; e++) { const a0 = map[2 * e], a1 = map[2 * e + 1]; K.d[a0] += Kel.d[2 * e]; K.d[a1] += Kel.d[2 * e + 1]; K.o[a0] += Kel.o[2 * e]; f[a0] += Fs[2 * e]; f[a1] += Fs[2 * e + 1]; }
        for (let i = 1; i < nE; i++) if (now[i]) { f[map[2 * i - 1]] += sW[i]; f[map[2 * i]] -= sW[i]; }
        if (cNow) K.d[0] += kC; else f[0] += kC * uW[0];
        const v = pmpTriSym(K, f, nd);
        u = Float64Array.from(map, q => v[q]);
        // (where they touch, the push between them: each side's own nodal force from its stress, their mean; where a gap
        //  is, the gap)
        let changed = false;
        for (let i = 1; i < nE; i++) {
          let want;
          if (now[i]) want = u[2 * i] - u[2 * i - 1] > 1e-9 * H ? 1 : 0;
          else { const fTop = nodalF(i - 1, u, 1), fBot = nodalF(i, u, 0); want = (fBot - fTop) / 2 < -tolS ? 1 : 0; }
          if (want !== now[i]) { now[i] = want; changed = true; }
        }
        const cWant = kC > 0 && uW[0] + u[0] <= 0 ? 1 : 0;
        if (cWant !== cNow) { cNow = cWant; changed = true; }
        if (!changed) break;
      }
      coreOn = cNow; gapOpen.set(now);
      for (let e = 0; e < nE; e++) {
        const er = (u[2 * e + 1] - u[2 * e]) / H - dEr[e], et = (u[2 * e] + u[2 * e + 1]) / 2 / rM[e] - dEt[e];
        sr[e] = wound.sr[e] + Q[0] * er + Q[1] * et; st[e] = wound.st[e] + Q[1] * er + Q[2] * et;
      }
    }
    if (snapAt.has(k)) snap(k, k * dt);
    histAdd(k * dt);
    if (o.onProgress && (k % 10 === 0 || k === steps)) o.onProgress({ k: nE + k, n: nE + steps });
  }
  const coreE = coreOn ? corePOf() : 0;
  return { r: Array.from(rM), wound: { sr: Array.from(wound.sr), st: Array.from(wound.st) }, end: { sr: Array.from(sr), st: Array.from(st) }, series, hist, coreP: { wound: coreW, end: coreE },
    gaps: Array.from(gapOpen), onCore: coreOn,
    R0, R1, n: nE * per, nE, per, H, kCore: kC, X0: Array.from(X0), T0: Array.from(Tst), ms: Date.now() - t0 };
}
/**
 * A turn of film on the roll, bent round it (its top out: κ = 1/r stretches the top) and carrying the hoop force N (per
 * width, N/m) the roll gives it: each layer's stress σ = Q (e0 + κ z − en) at its faces, e0 from the force, z up from its
 * underside; layers [{ t, Q, en }] from its underside up (film.js's roll at the core: N = 0, κ = 2/D). Returns
 * { top, bot, max, min } (Pa).
 */
function pmpTurnStress(layers, kappa, N) {
  let A = 0, B = 0, An = 0, z = 0;
  const zs = layers.map(L => { const z0 = z; z += L.t; return z0; });
  layers.forEach((L, i) => { const zm = zs[i] + L.t / 2; A += L.Q * L.t; B += L.Q * L.t * zm; An += L.Q * L.t * L.en; });
  const e0 = (An + N - B * kappa) / A;
  let max = -Infinity, min = Infinity;
  layers.forEach((L, i) => { for (const zz of [zs[i], zs[i] + L.t]) { const s = L.Q * (e0 + kappa * zz - L.en); max = Math.max(max, s); min = Math.min(min, s); } });
  const Lt = layers[layers.length - 1], Lb = layers[0];
  return { top: Lt.Q * (e0 + kappa * z - Lt.en), bot: Lb.Q * (e0 - Lb.en), max, min };
}
/** The isotherm (GAB, as drying.js's) and its inverse (the activity at a water content), by bisection. */
// (GO's own water at activity a; at a temperature T (°C) its C as exp(Hc/RT) from its value at T0; no T or no Hc:
//  the isotherm as it is)
const pmpGabC = (g, T) => (g.Hc && Number.isFinite(T) ? g.C * Math.exp(g.Hc / 8.314462618 * (1 / (T + 273.15) - 1 / ((Number.isFinite(g.T0) ? g.T0 : 25) + 273.15))) : g.C);
const pmpGAB = (a, g, T) => { const Ka = g.K * Math.min(Math.max(a, 0), 1), C = pmpGabC(g, T); return g.Xm * C * Ka / ((1 - Ka) * (1 - Ka + C * Ka)); };
function pmpGABinv(X, g, T) { let lo = 0, hi = 1; if (X >= pmpGAB(1, g, T)) return 1; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (pmpGAB(m, g, T) < X) lo = m; else hi = m; } return (lo + hi) / 2; }
/**
 * The pressure a pull's increment on the outer turn at radius s gives at r in a roll R0 … s of constant stiffnesses with
 * ν_θr = 0 on a core of stiffness kC (closed form: u = C1 r^g + C2 r^−g, g² = E_θ/E_r; σ_r(s) = −δp, σ_r(R0) = kC u(R0) / R0).
 * The independent check of the winding's accretion.
 */
function pmpRollIncrement(R0, s, Er, Eth, kC, dp, r) {
  const g = Math.sqrt(Eth / Er);
  // σ_r = Er g (C1 r^(g−1) − C2 r^(−g−1)); u = C1 r^g + C2 r^−g
  // at s: Er g (C1 s^(g−1) − C2 s^(−g−1)) = −dp; at R0: Er g (C1 R0^(g−1) − C2 R0^(−g−1)) = kC (C1 R0^(g−1) + C2 R0^(−g−1))
  const a11 = Er * g * Math.pow(s, g - 1), a12 = -Er * g * Math.pow(s, -g - 1);
  const a21 = (Er * g - kC) * Math.pow(R0, g - 1), a22 = -(Er * g + kC) * Math.pow(R0, -g - 1);
  const det = a11 * a22 - a12 * a21, C1 = (-dp * a22) / det, C2 = (a11 * 0 - a21 * -dp) / det;
  return { sr: Er * g * (C1 * Math.pow(r, g - 1) - C2 * Math.pow(r, -g - 1)), st: Eth * (C1 * Math.pow(r, g - 1) + C2 * Math.pow(r, -g - 1)) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { pmpRoll, pmpTurnStress, pmpRollQ, pmpCoreK, pmpRollIncrement, pmpGAB, pmpGABinv, pmpRun2D, pmpCompact, pmpPlan, pmpTI, pmpLayers, pmpG, pmpSteady, pmpElastica, pmpGrow, pmpGraded, pmpMesh, pmpBand, pmpAdd, pmpLDL, pmpLDLSolve, pmpCohesive, pmpDamage, pmpFront, pmpAnswers };
