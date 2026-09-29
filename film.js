/*
 * film.js — the solid film (GO-4): the GO film on the fibre web from the drying to the peel, and the peeled film.
 *
 * The film is laid down layer by layer. A layer (fixed in the GO's own coordinate ζ, GO volume per area) sets --
 * carries in-plane stress -- when a skin's front passes it (drying.js: its solids reach the dry packing). It sets
 * stress-free: its natural length is the laminate's length then. After that it shrinks and swells with the water it
 * holds (β per kg/kg, in-plane) and with temperature (α_f); the web with its temperature (α_w). The set film's
 * water moves by its own diffusion: water vapour through the GO at the skin's permeability, stored by the isotherm
 * (GAB, capped at the packing's pores as in drying.js), saturated at a wet front, at the skin's outer face's (or,
 * once dry, the air's) vapour pressure at a surface; the bottom sealed when the water leaves from the top only.
 *
 * On the line the film and the web are held flat: at every step a laminate (the set layers, the web; the wet film
 * under a skin a gel that carries no in-plane stress) gives the common strain and each layer's biaxial stress.
 * From it: channel cracks (a 2D plane-strain FEM of the stack, film-FEM part), the peel (the energy balance of a
 * steady peel), the curl of the free film, winding on the core, wrinkles and blisters.
 *
 * Units SI (m, Pa, K as °C differences, kg). Used in the drying worker (with drying.js) and by film.validate.js.
 */

// ---- the film's stiffness: transversely isotropic (in-plane p, through the thickness t) ----
/**
 * The 3D stiffness of a transversely isotropic solid (isotropic in the plane x–y, axis z): in-plane E_p, ν_p, through
 * E_t, ν_pt (the through-thickness strain from an in-plane stress: ε_z = −ν_pt σ_p / E_p), the through-shear G_pt.
 * Returns the plane-strain matrix in x–z [C11, C13, C33, C55] and the biaxial in-plane modulus Q = E_p / (1 − ν_p).
 */
function fmTransIso(Ep, Et, nup, nupt, Gpt) {
  // the normal block of the compliance (x, y, z)
  const S11 = 1 / Ep, S12 = -nup / Ep, S13 = -nupt / Ep, S33 = 1 / Et;
  // invert [[S11 S12 S13] [S12 S11 S13] [S13 S13 S33]] (symmetric in x, y): C11 + C12 and C11 − C12 separately
  const a = S11 + S12, det = a * S33 - 2 * S13 * S13;
  const Cp = S33 / det, C13 = -S13 / det, C33 = a / det, Cm = 1 / (S11 - S12);   // Cp = C11 + C12, Cm = C11 − C12
  const C11 = (Cp + Cm) / 2;
  return { C11, C13, C33, C55: Gpt, Q: Ep / (1 - nup) };
}
/** An isotropic solid's the same: plane strain in x–z and the biaxial modulus. */
const fmIso = (E, nu) => fmTransIso(E, E, nu, nu, E / (2 * (1 + nu)));

// ---- the isotherm ----
const fmGAB = (a, g) => { const Ka = g.K * Math.min(Math.max(a, 0), 1); return g.Xm * g.C * Ka / ((1 - Ka) * (1 - Ka + g.C * Ka)); };
const fmGABda = (a, g) => { const d = 1e-6, lo = Math.max(0, a - d), hi = Math.min(1, a + d); return (fmGAB(hi, g) - fmGAB(lo, g)) / (hi - lo); };

/** A tridiagonal solve (a: sub, b: diagonal, c: super, d: right side), n = b.length. */
function fmTri(a, b, c, d) {
  const n = b.length, cp = new Float64Array(n), dp = new Float64Array(n), x = new Float64Array(n);
  cp[0] = c[0] / b[0]; dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) { const m = b[i] - a[i] * cp[i - 1]; cp[i] = c[i] / m; dp[i] = (d[i] - a[i] * dp[i - 1]) / m; }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/** Faces of K cells on [0, 1] clustered at both ends: the end cells a fraction a0 of the whole (geometric to the middle). */
function fmFaces(K, a0) {
  const half = K / 2, f = [0];
  // ratio r with a0 (1 + r + … + r^(half−1)) = 1/2
  let lo = 1, hi = 2;
  const sum = r => (Math.abs(r - 1) < 1e-12 ? half : (Math.pow(r, half) - 1) / (r - 1)) * a0;
  if (sum(1) >= 0.5) { for (let i = 1; i <= K; i++) f.push(i / K); return f; }
  while (sum(hi) < 0.5) hi *= 2;
  for (let it = 0; it < 200; it++) { const m = (lo + hi) / 2; if (sum(m) < 0.5) lo = m; else hi = m; }
  const r = (lo + hi) / 2;
  let x = 0, d = a0;
  for (let i = 0; i < half; i++) { x += d; f.push(x); d *= r; }
  const out = f.map(v => v / (2 * x));   // [0, 1/2], exactly
  const full = out.slice();
  for (let i = half - 1; i >= 0; i--) full.push(1 - out[i]);
  return full;
}

/**
 * The set film's water along the line and its laminate (held flat) at every step of a drying history.
 * dr: drStrip's result run with history (and the room stretch to the peel); o: the film's properties --
 *   film {Ep, Et, nup, nupt, Gpt, beta, alphaF, Xh}, web {Ew, nuw, alphaW, tw}, gab, rhoS, rhoL, skinK, K (cells).
 * Returns per step: x, the set cells' flags, water X, temperature, stress; the common strain; per cell its birth.
 */
function fmHistory(dr, o) {
  const H = dr.history;
  if (!H) throw new Error('film: the drying was run without its history');
  const K = o.K || 120, Phi = H.Phi, phiM = H.phiM, M = H.M, sT = H.sT;
  const f = fmFaces(K, o.a0 || 2e-3).map(v => v * Phi), zc = new Float64Array(K), dz = new Float64Array(K);
  for (let k = 0; k < K; k++) { zc[k] = (f[k] + f[k + 1]) / 2; dz[k] = f[k + 1] - f[k]; }
  const scT = sT.slice(0, M).map((v, c) => (sT[c] + sT[c + 1]) / 2);
  const Xcap = 0.9 * H.em * o.rhoL / o.rhoS;                    // the packing's pores (as drying.js caps the skin's water)
  const Xof = a => Math.min(fmGAB(a, o.gab), Xcap);
  const dXda = a => (fmGAB(a, o.gab) >= Xcap ? 0 : fmGABda(a, o.gab));
  const psat = typeof drPsat === 'function' ? drPsat : (typeof require === 'function' ? require('./drying.js').drPsat : null);
  // the temperature at ζ at step i (drying.js's Tat)
  const Tat = (i, z) => {
    const TT = H.Tc[i], Ts = H.Ts[i], Tb = H.Tb[i];
    if (z <= scT[0]) return Tb + (TT[0] - Tb) * z / scT[0];
    if (z >= scT[M - 1]) return TT[M - 1] + (Ts - TT[M - 1]) * (z - scT[M - 1]) / (Phi - scT[M - 1]);
    let lo = 0, hi = M - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (scT[m] <= z) lo = m; else hi = m; }
    return TT[lo] + (TT[hi] - TT[lo]) * (z - scT[lo]) / (scT[hi] - scT[lo]);
  };
  const F = o.film, W = o.web;
  const Qw = W.Ew / (1 - W.nuw);
  const Ep = X => F.Ep / (1 + X / F.Xh), Qf = X => Ep(X) / (1 - F.nup);
  // state per cell
  const set = new Uint8Array(K), a = new Float64Array(K).fill(1), X = new Float64Array(K).fill(Math.min(fmGAB(1, o.gab), Xcap));
  const bornX = new Float64Array(K).fill(NaN), bornT = new Float64Array(K).fill(NaN), bornE = new Float64Array(K).fill(NaN), bornAt = new Float64Array(K).fill(NaN);
  const T0 = H.Tb[0];   // the web's natural length at the coating's temperature
  const wasFloat = new Uint8Array(K); let lastB = 0, lastF = 0;
  const steps = [];
  let eps0 = 0;
  const Kv = o.skinK * phiM;   // vapour conductance in ζ: flux = −K ∂p/∂z, z = ζ / φm
  for (let i = 0; i < H.n; i++) {
    const zt = H.zt[i], zb = H.zb[i], dry = H.dry[i] === 1;
    const isSet = k => dry || zc[k] >= zt || zc[k] <= zb;
    const T = new Float64Array(K);
    for (let k = 0; k < K; k++) T[k] = Tat(i, zc[k]);
    const born = [];
    // (born at a wet front: saturated, its water the isotherm's at saturation, capped at the pores)
    for (let k = 0; k < K; k++) if (!set[k] && isSet(k)) { set[k] = 1; a[k] = 1; X[k] = Xof(1); born.push(k); }
    // the water: regions of contiguous set cells, each with its ends' conditions
    if (i > 0) {
      const dt = H.t[i] - H.t[i - 1];
      let k = 0;
      while (k < K) {
        if (!set[k]) { k++; continue; }
        let k2 = k; while (k2 + 1 < K && set[k2 + 1]) k2++;
        // the lower end: the film's bottom (ζ = 0) or a wet front (at zt, the region's lower side)
        const lowerSurf = k === 0, upperSurf = k2 === K - 1;
        const pvB = H.pvB[i], pvT = H.pvT[i];
        const lo = lowerSurf ? (H.both ? { kind: 'p', p: Number.isFinite(pvB) ? pvB : psat(H.Tb[i]), z: 0, T: H.Tb[i] } : { kind: 'sealed' })
          : { kind: 'p', p: psat(Tat(i, zt)), z: zt, T: Tat(i, zt) };
        const hi = upperSurf ? { kind: 'p', p: Number.isFinite(pvT) ? pvT : psat(H.Ts[i]), z: Phi, T: H.Ts[i] }
          : { kind: 'p', p: psat(Tat(i, zb)), z: zb, T: Tat(i, zb) };
        solveWater(k, k2, lo, hi, dt, T);
        k = k2 + 1;
      }
    }
    // the laminate: the web and the set film bonded to it (the set cells from the web up, all of them once dry) share
    // one strain (their force balance, held flat); a skin over wet film floats -- the wet film under it carries no
    // in-plane load -- and balances its own force (its layers' stresses self-equilibrated, held flat by the film under
    // it). When the fronts meet the skin joins the bonded film with the stress it has.
    let kb = 0; while (kb < K && set[kb]) kb++;                          // bonded: 0 .. kb−1 (all when dry)
    const floating = k => set[k] && k >= kb;
    const ew = W.alphaW * (H.Tb[i] - T0);
    const en = new Float64Array(K).fill(NaN), Q = new Float64Array(K).fill(0);
    let bQ = Qw * W.tw, bQe = Qw * W.tw * ew, fQ = 0, fQe = 0;
    // (a skin that has just joined the bonded film keeps its stress: its natural strains move by the strain jump)
    if (i > 0) for (let k = 0; k < K; k++) if (set[k] && !floating(k) && wasFloat[k]) bornE[k] += lastB - lastF;
    for (let k = 0; k < K; k++) {
      if (!set[k] || born.includes(k)) continue;
      en[k] = bornE[k] + F.alphaF * (T[k] - bornT[k]) + F.beta * (X[k] - bornX[k]);
      Q[k] = Qf(X[k]); const t = dz[k] / phiM;
      if (floating(k)) { fQ += Q[k] * t; fQe += Q[k] * t * en[k]; } else { bQ += Q[k] * t; bQe += Q[k] * t * en[k]; }
    }
    const eB = bQe / bQ, eF = fQ > 0 ? fQe / fQ : eB;
    eps0 = eB;
    for (const k of born) { const e = floating(k) ? eF : eB; bornE[k] = e; bornT[k] = T[k]; bornX[k] = Xof(1); bornAt[k] = H.x[i]; en[k] = e; Q[k] = Qf(X[k]); }
    const sig = new Float64Array(K).fill(NaN);
    for (let k = 0; k < K; k++) if (set[k]) sig[k] = Q[k] * ((floating(k) ? eF : eB) - en[k]);
    for (let k = 0; k < K; k++) wasFloat[k] = floating(k) ? 1 : 0;
    lastB = eB; lastF = eF;
    steps.push({ x: H.x[i], t: H.t[i], zt, zb, dry, eps0: eB, epsF: eF, kb, ew, sigW: Qw * (eB - ew), set: Uint8Array.from(set), X: Float64Array.from(X), T, sig, en, Q });
  }
  return { steps, zc, dz, f, K, Phi, phiM, Xcap, bornX, bornT, bornE, bornAt, Xof, Qf, Ep, Qw };

  // backward Euler for cells k1..k2 in a (Newton, tridiagonal): ρS ΔX dζ / dt = Δ(Kv ∂p/∂ζ)
  function solveWater(k1, k2, lo, hi, dt, T) {
    const n = k2 - k1 + 1, Xold = X.slice(k1, k2 + 1), ps = new Float64Array(n);
    for (let j = 0; j < n; j++) ps[j] = psat(T[k1 + j]);
    const A = new Float64Array(n), B = new Float64Array(n), C = new Float64Array(n), R = new Float64Array(n);
    const g = (za, zb2) => Kv / Math.max(Math.abs(zb2 - za), 1e-3 * dz[k1]);
    for (let it = 0; it < 30; it++) {
      let mx = 0;
      for (let j = 0; j < n; j++) {
        const k = k1 + j, aj = a[k], pj = aj * ps[j];
        // storage
        R[j] = o.rhoS * (Xof(aj) - Xold[j]) * dz[k] / dt; B[j] = o.rhoS * dXda(aj) * dz[k] / dt; A[j] = 0; C[j] = 0;
        // the face below
        if (j > 0) { const G = g(zc[k - 1], zc[k]); R[j] += G * (pj - a[k - 1] * ps[j - 1]); B[j] += G * ps[j]; A[j] = -G * ps[j - 1]; }
        else if (lo.kind === 'p') { const G = g(lo.z, zc[k]); R[j] += G * (pj - lo.p); B[j] += G * ps[j]; }
        // the face above
        if (j < n - 1) { const G = g(zc[k], zc[k + 1]); R[j] += G * (pj - a[k + 1] * ps[j + 1]); B[j] += G * ps[j]; C[j] = -G * ps[j + 1]; }
        else if (hi.kind === 'p') { const G = g(zc[k], hi.z); R[j] += G * (pj - hi.p); B[j] += G * ps[j]; }
        mx = Math.max(mx, Math.abs(R[j]) / (Kv * ps[j] / Phi + 1e-30));
      }
      const d = fmTri(A, B, C, R.map(v => -v));
      let step = 0;
      for (let j = 0; j < n; j++) { const k = k1 + j, an = Math.min(1, Math.max(0, a[k] + d[j])); step = Math.max(step, Math.abs(an - a[k])); a[k] = an; }
      if (step < 1e-10) break;
    }
    for (let j = 0; j < n; j++) X[k1 + j] = Xof(a[k1 + j]);
  }
}

/**
 * A free laminate (no web): layers [{t, Q, en, z0 (bottom)}], its common strain and curvature with no net force or
 * moment (biaxial, z up; the strain e0 + κ z). κ > 0: its top stretched, convex (it curls away from its top); κ < 0:
 * its top concave (it curls toward its top).
 */
function fmFree(layers) {
  let A = 0, B = 0, D = 0, An = 0, Bn = 0;
  for (const L of layers) {
    if (!(L.Q > 0) || !(L.t > 0)) continue;
    const zm = L.z0 + L.t / 2;
    A += L.Q * L.t; B += L.Q * L.t * zm; D += L.Q * (L.t * zm * zm + L.t * L.t * L.t / 12);
    An += L.Q * L.t * L.en; Bn += L.Q * L.t * zm * L.en;   // (en uniform within a layer)
  }
  const det = A * D - B * B;
  const e0 = (An * D - B * Bn) / det, k = (A * Bn - B * An) / det;
  return { e0, kappa: k, A, B, D };
}

/**
 * The steady peel of a film (per width) at angle θ from the surface it leaves: the energy released per area
 * G = f (1 − (1 + ε_b) cos θ) + f² / (2 S) + U_r, f = F/b (N/m), S the film's in-plane stiffness per width (N/m),
 * ε_b its strain on the surface relative to its free state (its residual force / S), U_r the residual energy per
 * area it gives up on coming off (J/m²). The force per width needed where G reaches the interface's toughness Gi
 * (0 when U_r alone exceeds it: the film comes off by itself).
 */
function fmPeelForce(theta, S, epsB, Ur, Gi) {
  const c = Math.cos(theta), a = 1 / (2 * S), b = 1 - (1 + epsB) * c, cc = Ur - Gi;
  if (cc >= 0) return 0;
  // a f² + b f + cc = 0, the positive root (stable form)
  const disc = b * b - 4 * a * cc, q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
  const r1 = q / a, r2 = cc / q, roots = [r1, r2].filter(v => v > 0);
  return roots.length ? Math.min(...roots) : NaN;
}
/** The elastica's moment at the peel front (a stiff interface): M² = 2 D f (1 − cos θ), D the bending stiffness per width. */
const fmFrontMoment = (theta, D, f) => Math.sqrt(Math.max(0, 2 * D * f * (1 - Math.cos(theta))));


// ---- the 2D plane-strain FEM (x along the line, z up): channel cracks ----
/** A symmetric banded matrix (lower band stored row-wise: A[i][i−j], j = 0..bw) and its Cholesky solve. */
function fmBand(n, bw) { return { n, bw, a: new Float64Array(n * (bw + 1)) }; }
const fmBandAdd = (M, i, j, v) => { if (j > i) { const t = i; i = j; j = t; } const d = i - j; if (d <= M.bw) M.a[i * (M.bw + 1) + d] += v; };
function fmBandSolve(M, rhs) {
  const n = M.n, bw = M.bw, w = bw + 1, a = M.a;
  // (scaled by the diagonal first -- A' = S A S, S = diag^(-1/2): the layers' stiffnesses differ by orders of magnitude)
  const sc = new Float64Array(n);
  for (let i = 0; i < n; i++) sc[i] = 1 / Math.sqrt(Math.abs(a[i * w]) || 1);
  for (let i = 0; i < n; i++) for (let d = 0; d <= bw && i - d >= 0; d++) a[i * w + d] *= sc[i] * sc[i - d];
  rhs = Float64Array.from(rhs, (v, i) => v * sc[i]);
  // Cholesky in place: A = L Lᵀ
  for (let i = 0; i < n; i++) {
    const j0 = Math.max(0, i - bw);
    for (let j = j0; j <= i; j++) {
      let s = a[i * w + (i - j)];
      const k0 = Math.max(j0, j - bw);
      for (let k = k0; k < j; k++) s -= a[i * w + (i - k)] * a[j * w + (j - k)];
      if (j === i) { if (!(s > 0)) throw new Error('film FEM: the stiffness is not positive definite (a loose part?)'); a[i * w] = Math.sqrt(s); }
      else a[i * w + (i - j)] = s / a[j * w];
    }
  }
  const y = Float64Array.from(rhs);
  for (let i = 0; i < n; i++) { let s = y[i]; for (let k = Math.max(0, i - bw); k < i; k++) s -= a[i * w + (i - k)] * y[k]; y[i] = s / a[i * w]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k <= Math.min(n - 1, i + bw); k++) s -= a[k * w + (k - i)] * y[k]; y[i] = s / a[i * w]; }
  for (let i = 0; i < n; i++) y[i] *= sc[i];
  return y;
}
/** n points from a to b graded geometrically toward a (the first gap `first`, or uniform when that is not less). */
function fmGrade(a, b, n, first) {
  // (either way: b below a too, graded toward a)
  const L = Math.abs(b - a), sg = b >= a ? 1 : -1, out = [a];
  if (!(first > 0) || first * n >= L) { for (let i = 1; i <= n; i++) out.push(a + sg * L * i / n); return out; }
  let lo = 1, hi = 2;
  const sum = r => first * (Math.abs(r - 1) < 1e-12 ? n : (Math.pow(r, n) - 1) / (r - 1));
  while (sum(hi) < L) hi *= 2;
  for (let it = 0; it < 200; it++) { const m = (lo + hi) / 2; if (sum(m) < L) lo = m; else hi = m; }
  const r = (lo + hi) / 2;
  let x = a, d = first;
  for (let i = 1; i < n; i++) { x += sg * d; out.push(x); d *= r; }
  out.push(b);
  return out;
}
const FM_G3 = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], FM_W3 = [5 / 9, 8 / 9, 5 / 9];
const fmN3 = s => [s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], fmD3 = s => [s - 0.5, -2 * s, s + 0.5];
/**
 * A 9-node isoparametric plane-strain element's stiffness (18×18, dofs (u_x, u_z) per node, nodes a·3 + b with a
 * along x and b along z), 3×3 Gauss, the material at each point: mat(z) → {C11, C13, C33, C55}.
 */
function fmQ9K(ex9, ez9, mat, ei, ej) {
  const ke = new Float64Array(18 * 18);
  for (let ga = 0; ga < 3; ga++) for (let gb = 0; gb < 3; gb++) {
    const s = FM_G3[ga], t = FM_G3[gb], Ns = fmN3(s), Nt = fmN3(t), Ds = fmD3(s), Dt = fmD3(t);
    const dNs = new Float64Array(9), dNt = new Float64Array(9);
    let xs = 0, xt = 0, zs = 0, zt = 0, zg = 0;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const n = a * 3 + b; dNs[n] = Ds[a] * Nt[b]; dNt[n] = Ns[a] * Dt[b]; xs += dNs[n] * ex9[n]; xt += dNt[n] * ex9[n]; zs += dNs[n] * ez9[n]; zt += dNt[n] * ez9[n]; zg += Ns[a] * Nt[b] * ez9[n]; }
    const det = xs * zt - xt * zs, w = FM_W3[ga] * FM_W3[gb] * det, C = mat(zg);
    if (!(det > 0)) throw new Error(`film FEM: element ${ei},${ej} folded (det ${det})`);
    const dx = new Float64Array(9), dz = new Float64Array(9);
    for (let n = 0; n < 9; n++) { dx[n] = (zt * dNs[n] - zs * dNt[n]) / det; dz[n] = (-xt * dNs[n] + xs * dNt[n]) / det; }
    for (let p = 0; p < 9; p++) for (let q = 0; q < 9; q++) {
      ke[(2 * p) * 18 + 2 * q] += w * (dx[p] * C.C11 * dx[q] + dz[p] * C.C55 * dz[q]);
      ke[(2 * p) * 18 + 2 * q + 1] += w * (dx[p] * C.C13 * dz[q] + dz[p] * C.C55 * dx[q]);
      ke[(2 * p + 1) * 18 + 2 * q] += w * (dz[p] * C.C13 * dx[q] + dx[p] * C.C55 * dz[q]);
      ke[(2 * p + 1) * 18 + 2 * q + 1] += w * (dz[p] * C.C33 * dz[q] + dx[p] * C.C55 * dx[q]);
    }
  }
  return ke;
}
/**
 * A channel crack through a layered stack (from o.zTip up to o.zEnd, the stack's top unless given): the half-cell [0, Lh] in x (the crack at x = 0, the next
 * crack's midway plane at x = Lh: symmetric), the stack in z. The crack's faces carry the relief traction σ(z) (the
 * far-field stress it frees). Returns the face's opening u(z) (half the crack's opening) and ∫σ u dz (J/m).
 * o: {zs: z-planes that must be element boundaries (sorted; bottom and top included), zTip (the crack's bottom),
 *     mat(z): {C11, C13, C33, C55}, sig(z) (Pa, the far-field stress in the cracked part), Lh, nx, nz (elements),
 *     bottom: 'supported' (u_z = 0 under the web) | 'free', fine (the smallest element at the tip, m)}
 */
function fmChannel(o) {
  // (planes closer than a millionth of the stack are one: the crack's ends snap to a layer's face they sit on)
  const tol = 1e-6 * (o.zs[o.zs.length - 1] - o.zs[0]), snap = v => { for (const q of o.zs) if (Math.abs(q - v) <= tol) return q; return v; };
  const zTip0 = snap(o.zTip), zEnd0 = o.zEnd != null ? snap(o.zEnd) : null;
  o = { ...o, zTip: zTip0, zEnd: zEnd0 };
  const zBot = o.zs[0], zTop = o.zEnd != null ? o.zEnd : o.zs[o.zs.length - 1], hc = zTop - o.zTip;
  const zMax = o.zs[o.zs.length - 1], ends = [o.zTip, ...(zTop < zMax - tol ? [zTop] : [])];
  const fine = o.fine || hc / 40;   // (the smallest element at the crack's ends)
  // rows (z-planes): every given plane; between them graded toward the crack's ends, neighbours within about 1.5×
  const gr = o.ratio || 1.5, nzT = o.nz || 24, span = zMax - zBot, G15 = L => Math.ceil(Math.log(1 + (gr - 1) * L / fine) / Math.log(gr));
  const zl = [o.zs[0]];
  const planes = [...o.zs, ...ends].sort((p, q) => p - q).filter((v, j, arr) => j === 0 || v > arr[j - 1] + tol);
  for (let i = 0; i < planes.length - 1; i++) {
    const a = planes[i], b = planes[i + 1];
    const near = v => ends.some(e => Math.abs(v - e) < 1e-15);
    const toward = near(a) && near(b) ? 'both' : near(a) ? 'a' : near(b) ? 'b' : null;
    const inCrack = a >= o.zTip - 1e-15 && b <= zTop + 1e-15;
    let n = Math.max(toward || inCrack ? (o.nzCrack || 10) : 3, Math.round(nzT * (b - a) / span));
    if (toward) n = Math.max(n, Math.min(40, G15(toward === 'both' ? (b - a) / 2 : b - a)));
    let pts;
    if (toward === 'both') { const m = (a + b) / 2, half = Math.ceil(n / 2); pts = [...fmGrade(a, m, half, fine), ...fmGrade(b, m, half, fine).reverse().slice(1)]; }
    else if (toward === 'a') pts = fmGrade(a, b, n, fine);
    else if (toward === 'b') pts = fmGrade(b, a, n, fine).reverse();
    else pts = fmGrade(a, b, n, 0);
    zl.push(...pts.slice(1));
  }
  const ez = zl.length - 1;
  // each row's spacing along the line: fine where the row is fine (near the crack's ends), coarser away -- the
  // elements stay near square around the crack and nowhere become slivers
  const rowFine = zl.map((zv, j) => { const d = Math.min(j > 0 ? zv - zl[j - 1] : Infinity, j < ez ? zl[j + 1] - zv : Infinity); return Math.max(o.fineX || fine, d); });
  const ex = Math.max(o.nx || 24, Math.min(60, G15(o.Lh * 0 + o.Lh / 1) - 0));
  // (o.fan: each row its own spacing, fine only near the crack's ends; otherwise every row the same, fine at the crack)
  const xr = o.fan ? rowFine.map(f0 => fmGrade(0, o.Lh, ex, Math.min(f0, o.Lh / ex))) : zl.map(() => fmGrade(0, o.Lh, ex, Math.min(o.fineX || fine, o.Lh / ex)));
  const nxN = 2 * ex + 1, nzN = 2 * ez + 1;
  // node positions: corners on the rows; mid-side and centre nodes between them (straight-sided quadrilaterals)
  const PX = new Float64Array(nxN * nzN), PZ = new Float64Array(nxN * nzN), id = (i, j) => i * nzN + j;
  for (let J = 0; J < nzN; J++) {
    const j = J >> 1, odd = J & 1;
    for (let I = 0; I < nxN; I++) {
      const i = I >> 1, oi = I & 1;
      const xAt = (jj) => oi ? (xr[jj][i] + xr[jj][i + 1]) / 2 : xr[jj][i];
      PX[id(I, J)] = odd ? (xAt(j) + xAt(j + 1)) / 2 : xAt(j);
      PZ[id(I, J)] = odd ? (zl[j] + zl[j + 1]) / 2 : zl[j];
    }
  }
  // (nodes numbered along the shorter side: the band is twice that side's nodes)
  const byZ = nzN <= nxN, nNode = nxN * nzN, nDof = 2 * nNode;
  const node = byZ ? (i, j) => i * nzN + j : (i, j) => j * nxN + i, bw = 2 * (2 * Math.min(nxN, nzN) + 2) + 1;
  const Kb = fmBand(nDof, bw), f = new Float64Array(nDof);
  // elements: isoparametric 9-node, 3×3 Gauss, the material at each point
  for (let ei = 0; ei < ex; ei++) for (let ej = 0; ej < ez; ej++) {
    const ids = [], ex9 = new Float64Array(9), ez9 = new Float64Array(9);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const I = 2 * ei + a, J = 2 * ej + b, n = a * 3 + b; ids.push(node(I, J)); ex9[n] = PX[id(I, J)]; ez9[n] = PZ[id(I, J)]; }
    const ke = fmQ9K(ex9, ez9, o.mat, ei, ej);
    for (let p = 0; p < 18; p++) for (let q = 0; q <= p; q++) fmBandAdd(Kb, 2 * ids[p >> 1] + (p & 1), 2 * ids[q >> 1] + (q & 1), p === q ? ke[p * 18 + q] : ke[p * 18 + q]);
    // (the loop above adds each pair (p, q ≤ p) once; fmBandAdd files it in the lower band either way round)
  }
  // the crack's face (x = 0, zTip ≤ z ≤ zTop): the relief traction, consistent loads
  const faceJ = [];
  for (let ej = 0; ej < ez; ej++) {
    const z0 = zl[ej], z1 = zl[ej + 1];
    if (z0 < o.zTip - 1e-15 || z1 > zTop + 1e-15) continue;
    const hz = (z1 - z0) / 2;
    for (let g = 0; g < 3; g++) { const t = FM_G3[g], zg = (z0 + z1) / 2 + t * hz, N = fmN3(t), sg = o.sig(zg); for (let b = 0; b < 3; b++) f[2 * node(0, 2 * ej + b)] += FM_W3[g] * hz * N[b] * sg; }
    faceJ.push(ej);
  }
  // constraints: the midway plane u_x = 0; the crack's plane outside the crack u_x = 0; under the web u_z = 0 (or one point)
  const fixed = new Uint8Array(nDof);
  for (let J = 0; J < nzN; J++) { const zv = PZ[id(0, J)]; fixed[2 * node(nxN - 1, J)] = 1; if (zv <= o.zTip + tol * 1e-3 || (zv >= zTop - tol * 1e-3 && zTop < zMax - tol)) fixed[2 * node(0, J)] = 1; }
  if (o.bottom === 'free') fixed[2 * node(nxN - 1, 0) + 1] = 1; else for (let I = 0; I < nxN; I++) fixed[2 * node(I, 0) + 1] = 1;
  const w = bw + 1;
  for (let I = 0; I < nDof; I++) {
    if (!fixed[I]) continue;
    for (let d = 0; d <= bw && I - d >= 0; d++) Kb.a[I * w + d] = 0;
    for (let d = 1; d <= bw && I + d < nDof; d++) Kb.a[(I + d) * w + d] = 0;
    Kb.a[I * w] = 1; f[I] = 0;
  }
  const u = fmBandSolve(Kb, f);
  // the face's opening and ∫ σ u dz
  let E = 0;
  const face = [];
  for (const ej of faceJ) {
    const z0 = zl[ej], z1 = zl[ej + 1], hz = (z1 - z0) / 2;
    for (let g = 0; g < 3; g++) { const t = FM_G3[g], zg = (z0 + z1) / 2 + t * hz, N = fmN3(t); let ug = 0; for (let b = 0; b < 3; b++) ug += N[b] * u[2 * node(0, 2 * ej + b)]; E += FM_W3[g] * hz * o.sig(zg) * ug; }
  }
  for (let J = 0; J < nzN; J++) { const zv = PZ[id(0, J)]; if (zv >= o.zTip - 1e-15 && zv <= zTop + 1e-15) face.push([zv, u[2 * node(0, J)]]); }
  return { E, G: E / hc, hc, face, nDof, nx: ex, nz: ez };
}


// ---- one drying run's film: the line, the cracks, the peel, the curl, the roll, blisters ----
/**
 * The film at step i laid out through its thickness (z up from the web's top; the web below 0): each set cell's
 * place and thickness, the wet film between the bonded part and a floating skin, and the materials and far-field
 * stresses at z. hs: the film's physical thickness then (the drying's series).
 */
function fmLayout(hh, i, hs, o) {
  const S = hh.steps[i], K = hh.K, phiM = hh.phiM, W = o.web, F = o.film;
  const tSet = k => hh.dz[k] / phiM, kb = S.kb;
  let ft = K; while (ft > kb && S.set[ft - 1]) ft--;                 // the floating skin: ft .. K−1 (none when ft = K)
  let hB = 0, hF = 0;
  for (let k = 0; k < kb; k++) hB += tSet(k);
  for (let k = ft; k < K; k++) hF += tSet(k);
  const hWet = kb >= K ? 0 : Math.max(hs - hB - hF, 0);
  const z0 = new Float64Array(K).fill(NaN);
  let z = 0;
  for (let k = 0; k < kb; k++) { z0[k] = z; z += tSet(k); }
  z = hB + hWet;
  for (let k = ft; k < K; k++) { z0[k] = z; z += tSet(k); }
  const hFilm = hB + hWet + hF;
  // the set cell at z (binary search over the placed cells), −1: the wet film, −2: the web
  const placed = []; for (let k = 0; k < K; k++) if (Number.isFinite(z0[k])) placed.push(k);
  const at = zv => {
    if (zv < 0) return -2;
    let lo = 0, hi = placed.length - 1;
    if (hi < 0) return -1;
    while (lo <= hi) { const m = (lo + hi) >> 1, k = placed[m]; if (zv < z0[k]) hi = m - 1; else if (zv > z0[k] + tSet(k)) lo = m + 1; else return k; }
    return -1;
  };
  const soft = X => 1 / (1 + X / F.Xh);
  const webC = fmTransIso(W.Ew, W.Ew * W.soft, W.nuw, 0.1, W.Ew * W.soft / 2);
  const gelC = fmIso(o.gel.Eg, 0.45);
  const cellC = new Map();
  const mat = zv => { const k = at(zv); if (k === -2) return webC; if (k === -1) return gelC;
    if (!cellC.has(k)) { const f = soft(S.X[k]); cellC.set(k, fmTransIso(F.Ep * f, F.Et * f, F.nup, F.nupt, F.Gpt * f)); } return cellC.get(k); };
  const sigAll = zv => { const k = at(zv); return k >= 0 ? S.sig[k] : 0; };
  return { S, K, kb, ft, hB, hF, hWet, hFilm, z0, tSet, at, mat, sigAll, dry: kb >= K };
}

/**
 * A part's tension zone from its exposed face inward: the bonded film's (its top: the film's top once dry, else the
 * face under the wet film) or the floating skin's (the film's top). {cells, zTip, zEnd, h, sMean, Eb} or null.
 */
function fmTension(L, which, o) {
  const cells = [];
  if (which === 'float') { for (let k = L.K - 1; k >= L.ft; k--) { if (!(L.S.sig[k] > 0)) break; cells.push(k); } }
  else { for (let k = L.kb - 1; k >= 0; k--) { if (!(L.S.sig[k] > 0)) break; cells.push(k); } }
  if (!cells.length) return null;
  const inner = cells[cells.length - 1], outer = cells[0];
  const zTip = L.z0[inner], zEnd = L.z0[outer] + L.tSet(outer);
  let N = 0, Eb = 0;
  for (const k of cells) { const t = L.tSet(k), f = 1 / (1 + L.S.X[k] / o.film.Xh); N += L.S.sig[k] * t; Eb += o.film.Ep * f / (1 - o.film.nup * o.film.nup) * t; }
  const h = zEnd - zTip;
  return { cells, zTip, zEnd, h, sMean: N / h, Eb: Eb / h };
}

/** The steady-state channel crack through a tension zone (FEM on the part and what holds it: the web, or the wet film under a skin). */
function fmCrack(L, which, o, Lh) {
  const tz = fmTension(L, which, o);
  if (!tz) return null;
  const W = o.web, fem = o.fem || {};
  const sig = zv => (zv >= tz.zTip - 1e-15 && zv <= tz.zEnd + 1e-15 ? L.sigAll(zv) : 0);
  let zs, bottom;
  if (which === 'float') {
    // the skin over the wet film (cut off below, where the crack no longer reaches); held flat under it
    const L0 = Lh || 30 * tz.h, dg = Math.min(L.hWet, Math.max(4 * tz.h, 2 * L0));
    zs = [L.hB + L.hWet - dg, L.hB + L.hWet, tz.zTip, L.hFilm];
    bottom = 'supported';
    Lh = L0;
  } else {
    // the bonded film on the web (the wet film over it cut off above the crack's reach)
    const top = L.dry ? L.hFilm : L.hB + Math.min(L.hWet, Math.max(4 * tz.h, 2 * (Lh || 30 * tz.h)));
    zs = [-W.tw, 0, tz.zTip, tz.zEnd, top];
    bottom = o.bottom || 'supported';
    Lh = Lh || Math.max(30 * tz.h, 3 * (L.hB + W.tw));
  }
  zs = zs.sort((p, q) => p - q);
  const tol = 1e-6 * (zs[zs.length - 1] - zs[0]);
  zs = zs.filter((v, j, arr) => j === 0 || v > arr[j - 1] + tol);
  const r = fmChannel({ zs, zTip: tz.zTip, zEnd: tz.zEnd, mat: L.mat, sig, Lh, nx: fem.nx || 8, nz: fem.nz || 8, bottom, fine: tz.h / (fem.div || 100), ratio: fem.ratio || 2, nzCrack: fem.nzCrack || 8 });
  return { ...r, tz, Lh };
}

/**
 * The film's mechanics for one drying run (drStrip with its history and the room stretch to the peel). o: the
 * film's properties (fmHistory's, and gel {Eg}, web.soft, film {sigF, GcF, Gil, Gi, setFrac}, core (m), Troom, rhRoom,
 * sheet (m, for an edge's lift), fem {nx, nz}, stations (FEM places along the line)). Returns the line, the cracks,
 * the peel, the curl, the roll, blisters.
 */
function fmRun(dr, o) {
  const hh = fmHistory(dr, o), F = o.film, W = o.web, n = hh.steps.length;
  const psat = typeof drPsat === 'function' ? drPsat : require('./drying.js').drPsat;
  const lay = i => fmLayout(hh, i, dr.series[i].h, o);
  // along the line: each part's tension zone and a crack's estimate (Z of a film on a like substrate)
  const est = tz => (tz ? 1.976 * tz.sMean * tz.sMean * tz.h / tz.Eb : 0);
  const line = hh.steps.map((S, i) => {
    const L = lay(i), tf = fmTension(L, 'float', o), tb = fmTension(L, 'bond', o);
    let Nb = 0, hb = 0, Eb = 0;
    for (let k = 0; k < L.kb; k++) { const t = L.tSet(k), f = 1 / (1 + S.X[k] / F.Xh); Nb += S.sig[k] * t; hb += t; Eb += F.Ep * f / (1 - F.nup * F.nup) * t; }
    return { x: S.x, dry: L.dry, hFloat: L.hF, hBond: L.hB, hWet: L.hWet, sTopF: L.ft < L.K ? S.sig[L.K - 1] : null, sTopB: L.kb > 0 ? S.sig[L.kb - 1] : null,
      sBond: hb > 0 ? Nb / hb : null, EbBond: hb > 0 ? Eb / hb : 0, sWeb: S.sigW, GestF: est(tf), GestB: est(tb) };
  });
  // the FEM where a crack is likeliest (each part's estimate's peaks), the oven's exit and the peel
  const nSt = o.stations || 4, pick = new Set([n - 1]);
  const peaks = key => line.map((Lr, i) => [Lr[key], i]).filter(([g]) => g > 0).sort((p, q) => q[0] - p[0]);
  const spread = (list, m) => { const out = []; for (const [, i] of list) { if (out.length >= m) break; if (out.every(j => Math.abs(line[j].x - line[i].x) > 0.25)) out.push(i); } return out; };
  spread(peaks('GestF'), nSt).forEach(i => pick.add(i));
  spread(peaks('GestB'), nSt).forEach(i => pick.add(i));
  const iOven = hh.steps.reduce((b, S, i) => Math.abs(S.x - dr.xOven) < Math.abs(hh.steps[b].x - dr.xOven) ? i : b, 0);
  pick.add(iOven);
  const stations = [...pick].sort((p, q) => p - q).map(i => {
    const L = lay(i), out = { i, x: line[i].x };
    for (const which of ['float', 'bond']) {
      const r = fmCrack(L, which, o);
      out[which] = r ? { G: r.G, ratio: r.G / F.GcF, h: r.tz.h, sMean: r.tz.sMean, face: r.face, Lh: r.Lh } : null;
    }
    return out;
  });
  let worst = null;
  for (const S of stations) for (const w of ['float', 'bond']) if (S[w] && (!worst || S[w].ratio > worst.ratio)) worst = { ...S[w], i: S.i, x: S.x, which: w };
  // the crack spacing where the worst crack forms: a crack midway between two at spacing s releases
  // G(s) = [2 ∫σu(s/4 half-cell) − ∫σu(s/2 half-cell)] / h; cracks keep forming while G(s) ≥ the toughness
  let spacing = null, ladder = null;
  if (worst && worst.G > 0) {
    // half-cells doubling from h/8: G at spacing s = 4 Lh_j is [2E(Lh_j) − E(Lh_(j+1))]/h, rising with s; where cracks
    // form (G_ss above the toughness), the smallest spacing that still cracks: its crossing (log-linear between rungs)
    const L = lay(worst.i), h = worst.h, Es = [];
    for (let Lh = h / 8; Lh <= 2 * worst.Lh * 1.0001; Lh *= 2) Es.push([Lh, fmCrack(L, worst.which, o, Lh).E]);
    ladder = []; for (let j = 0; j + 1 < Es.length; j++) ladder.push([4 * Es[j][0], (2 * Es[j][1] - Es[j + 1][1]) / h]);
    // (a crack only just above the toughness crosses it at wide spacings: the ladder goes on until it does, 12 rungs at most)
    for (let more = 0; worst.ratio >= 1 && more < 12 && !(ladder.length && ladder[ladder.length - 1][1] >= F.GcF); more++) {
      const Lh = Es[Es.length - 1][0] * 2; Es.push([Lh, fmCrack(L, worst.which, o, Lh).E]);
      const j = Es.length - 2; ladder.push([4 * Es[j][0], (2 * Es[j][1] - Es[j + 1][1]) / h]);
    }
    if (worst.ratio >= 1) {
      if (ladder.length && ladder[0][1] >= F.GcF) spacing = { lo: ladder[0][0], hi: 2 * ladder[0][0], below: true };
      else for (let j = 1; j < ladder.length; j++) if (ladder[j][1] >= F.GcF) {
        const [s0, g0] = ladder[j - 1], [s1, g1] = ladder[j], f = (F.GcF - g0) / (g1 - g0), sc = s0 * Math.pow(s1 / s0, Math.min(Math.max(f, 0), 1));
        spacing = { lo: sc, hi: 2 * sc };
        break;
      }
    }
  }
  const firstCrack = (() => { for (const S of stations) for (const w of ['float', 'bond']) if (S[w] && S[w].ratio >= 1) return { x: S.x, which: w }; return null; })();

  // ---- the film at the peel ----
  const iP = n - 1, SP = hh.steps[iP], LP = lay(iP);
  // (each set layer: its stiffness at the water it holds then -- as at the peel, or settled)
  const layers = (en, Xv = SP.X) => {
    const out = [];
    for (let k = 0; k < hh.K; k++) if (SP.set[k]) { const f = 1 / (1 + Xv[k] / F.Xh), Ek = F.Ep * f; out.push({ k, t: LP.tSet(k), z0: LP.z0[k], E: Ek, Q: Ek / (1 - F.nup), en: en[k] }); }
    return out;
  };
  // (the natural strains: as at the peel; settled in the room -- its humidity's water, its temperature)
  const Xroom = Math.min(fmGAB(o.rhRoom, o.gab), hh.Xcap);
  const enAt = (Xv, Tv) => { const e = new Float64Array(hh.K).fill(NaN); for (let k = 0; k < hh.K; k++) if (SP.set[k]) e[k] = hh.bornE[k] + F.alphaF * (Tv[k] - hh.bornT[k]) + F.beta * (Xv[k] - hh.bornX[k]); return e; };
  const XroomA = new Float64Array(hh.K).fill(Xroom), TroomA = new Float64Array(hh.K).fill(o.Troom);
  const Lp = layers(enAt(SP.X, SP.T)), Ls = layers(enAt(XroomA, TroomA), XroomA);
  const free = fmFree(Lp), settled = fmFree(Ls);
  const lift = (kap, Lv) => { if (Math.abs(kap) < 1e-12) return 0; const R = 1 / Math.abs(kap); return Lv / 2 < Math.PI * R ? R * (1 - Math.cos(Lv / (2 * R))) : 2 * R; };
  const sheet = o.sheet || 0.1;
  const curl = { atPeel: { kappa: free.kappa, R: 1 / free.kappa, lift: lift(free.kappa, sheet) }, settled: { kappa: settled.kappa, R: 1 / settled.kappa, lift: lift(settled.kappa, sheet) }, sheet, Xroom };
  // the peel: the bonded film's residual force and energy, its stiffness; the force against the angle
  let N = 0, Sx = 0, Ub = 0, hF = 0, Dz = 0;
  for (const Lr of Lp) { const sg = SP.sig[Lr.k]; N += sg * Lr.t; Sx += Lr.E * Lr.t; Ub += sg * sg / Lr.Q * Lr.t; hF += Lr.t; }
  const zn = Lp.reduce((acc, Lr) => acc + Lr.E * Lr.t * (Lr.z0 + Lr.t / 2), 0) / Sx;
  for (const Lr of Lp) { const zm = Lr.z0 + Lr.t / 2 - zn; Dz += Lr.E / (1 - F.nup * F.nup) * (Lr.t * zm * zm + Lr.t * Lr.t * Lr.t / 12); }
  let Uf = 0;
  for (const Lr of Lp) { const zm = Lr.z0 + Lr.t / 2, e = free.e0 + free.kappa * zm - Lr.en; Uf += Lr.Q * (e * e * Lr.t + free.kappa * free.kappa * Lr.t * Lr.t * Lr.t / 12); }
  const epsB = N / Lp.reduce((acc, Lr) => acc + Lr.Q * Lr.t, 0), Ur = Math.max(0, Ub - Uf);
  const smaxB = Math.max(0, ...Lp.map(Lr => SP.sig[Lr.k]));
  const peelAt = d => {
    const th = d * Math.PI / 180, f = fmPeelForce(th, Sx, epsB, Ur, F.Gi);
    const M0 = fmFrontMoment(th, Dz, f), sFront = smaxB + f / hF + 6 * M0 / (hF * hF);
    return { deg: d, f, sFront, tears: sFront >= F.sigF };
  };
  const byAngle = []; for (let d = 0; d <= 180; d += 5) byAngle.push(peelAt(d));
  const peel = { byAngle, hand: peelAt(180), N, epsB, Ur, S: Sx, D: Dz, h: hF, bits: F.Gi > F.Gil, selfPeel: Ur >= F.Gi, wet: !LP.dry };
  // the roll: the film bent round the core, its top out (stretched, convex: κ = +2/D), from its state at the peel
  const kW = 2 / o.core, An = Lp.reduce((acc, Lr) => acc + Lr.Q * Lr.t * Lr.en, 0), e0w = (An - free.B * kW) / free.A;
  let sRollMax = -Infinity;
  for (const Lr of Lp) for (const zz of [Lr.z0, Lr.z0 + Lr.t]) sRollMax = Math.max(sRollMax, Lr.Q * (e0w + kW * zz - Lr.en));
  const topL = Lp[Lp.length - 1], sRollTop = topL ? topL.Q * (e0w + kW * (topL.z0 + topL.t) - topL.en) : 0;
  const roll = { core: o.core, kappa: kW, sMax: sRollMax, sTop: sRollTop, cracks: sRollMax >= F.sigF, strainTop: hF / o.core, set: (F.setFrac || 0) * (kW - free.kappa) };
  // the plate a piece cut from the roll is (GO-4d, sheet.js), as cut: on the roll its water evens out through it but
  // stays in (the turns seal each other; only the roll's ends breathe), at the room's temperature -- its stiffnesses
  // about its neutral plane, its natural curvature both ways (+ the roll's set along the line), its weight. Pressed
  // flat, its natural strain as cut and after the pre heat treatment (Q72: dried through at the oven's temperature, its air
  // the room's heated -- the isotherm's water there -- then cooled to the room's)
  // (eX: the part of the flat strain per unit β -- it is linear in β -- so a measured size reads back as a β)
  const plateOf = (Ls2, Xv) => { let S2 = 0, Sz = 0; for (const Lr of Ls2) { S2 += Lr.E * Lr.t; Sz += Lr.E * Lr.t * (Lr.z0 + Lr.t / 2); }
    const zn = Sz / S2; let D2 = 0, An2 = 0, Bn2 = 0, EX2 = 0;
    for (const Lr of Ls2) { const zm = Lr.z0 + Lr.t / 2 - zn; D2 += Lr.E * (Lr.t * zm * zm + Lr.t * Lr.t * Lr.t / 12); An2 += Lr.E * Lr.t * Lr.en; Bn2 += Lr.E * Lr.t * zm * Lr.en; EX2 += Lr.E * Lr.t * (Xv[Lr.k] - hh.bornX[Lr.k]); }
    return { A: S2, D: D2, eFlat: An2 / S2, eX: EX2 / S2, kappa: Bn2 / D2 }; };
  let tX = 0, xX = 0; for (const Lr of Lp) { tX += Lr.t; xX += Lr.t * SP.X[Lr.k]; }
  const Xcut = tX > 0 ? xX / tX : Xroom, XcutA = new Float64Array(hh.K).fill(Xcut);
  const Tdry = Number.isFinite(o.Tdry) ? o.Tdry : 100, rhDry = Math.min(1, o.rhRoom * psat(o.Troom) / psat(Tdry));
  const Xdry = Math.min(fmGAB(rhDry, o.gab), hh.Xcap), XdryA = new Float64Array(hh.K).fill(Xdry);
  const pC = plateOf(layers(enAt(XcutA, TroomA), XcutA), XcutA), pD = plateOf(layers(enAt(XdryA, TroomA), XdryA), XdryA), phiM = 1 / (1 + dr.history.em);
  // (GO-4f, the pieces in the pressed stack: the plate at a uniform water from the oven's dry to the room's, as rows
  //  [X, A, D, eFlat, κ, eX] (press.js goes linearly between them; tabErr the worst of that halfway between rows); the
  //  GO's mass per film volume, the isotherm and its cap, the room's water)
  const plateAt = X => { const XA = new Float64Array(hh.K).fill(X), q = plateOf(layers(enAt(XA, TroomA), XA), XA); return [X, q.A, q.D, q.eFlat, q.kappa, q.eX]; };
  const Xlo = Math.min(Xdry, Xroom, Xcut), Xhi = Math.max(Xdry, Xroom, Xcut), tab = [];
  for (let i = 0; i <= 20; i++) tab.push(plateAt(Xlo + (Xhi - Xlo) * i / 20));
  let tabErr = 0;
  for (let i = 0; i < 20; i++) { const mid = plateAt((tab[i][0] + tab[i + 1][0]) / 2); for (const c of [1, 2, 3, 4, 5]) tabErr = Math.max(tabErr, Math.abs((tab[i][c] + tab[i + 1][c]) / 2 - mid[c]) / Math.max(1e-30, Math.abs(c === 3 || c === 5 ? tab[20][c] - tab[0][c] : mid[c]) || 1e-30)); }
  const plate = { A: pC.A, D: pC.D, nu: F.nup, h: hF, kS: pC.kappa, kSet: roll.set, p: o.rhoS * phiM * (1 + Xcut) * 9.81 * hF,
    eFlatCut: pC.eFlat, eFlatDry: pD.eFlat, eXCut: pC.eX, eXDry: pD.eX, kDry: pD.kappa, Xcut, Xdry, Tdry, rhDry,
    tab, tabErr, Xroom, rhoG: o.rhoS * phiM, gab: o.gab, Xcap: hh.Xcap, Troom: o.Troom, rhRoom: o.rhRoom };
  // blisters: the bonded film compressed on the web buckles off it (buckle-delamination: the most a straight blister
  // releases, (1 − ν²) σ² h / (2E), against the interface's toughness; the narrowest that can buckle), and steam under a skin
  const bl = line.map(Lr => {
    const sv = Lr.sBond, t = Lr.hBond;
    if (!(sv < 0) || !(t > 0)) return { x: Lr.x, ratio: 0 };
    const G0 = sv * sv * t / (2 * Lr.EbBond), bMin = Math.PI * t / Math.sqrt(12) * Math.sqrt(Lr.EbBond / -sv);
    return { x: Lr.x, ratio: G0 / F.Gi, G0, bMin, s: sv };
  });
  const blMax = bl.reduce((b, w) => w.ratio > b.ratio ? w : b, { ratio: 0 });
  let steam = null;
  if (dr.events.boilSkin) { let Tmax = -Infinity; for (const q of dr.series) Tmax = Math.max(Tmax, q.Tft, q.Tfb); steam = { x: dr.events.boil, dp: psat(Tmax) - (o.P || 101325) }; }
  // through the film at the peel (z up from the web): each set layer's stress and water; the wet film between, if any
  const profile = { cells: Lp.map(Lr => ({ z0: Lr.z0, t: Lr.t, sig: SP.sig[Lr.k], X: SP.X[Lr.k] })), hB: LP.hB, hWet: LP.hWet, hFilm: LP.hFilm };
  return { line, stations, worst, spacing, ladder, firstCrack, curl, peel, roll, plate, blisters: { max: blMax, line: bl, steam },
    peelX: SP.x, ovenX: dr.xOven, wetAtPeel: !LP.dry, hPeel: hF, Xcap: hh.Xcap, profile };
}

/**
 * The free film's curl only (right after the peel and settled in the room), without the cracks and the peel: the
 * layers' history and the free laminate. The curl is linear in β (every strain source enters linearly; the stiffnesses
 * depend on the water, not on β), so two of these (β = 0, β = 1) give it for any β.
 */
function fmCurlOnly(dr, o) {
  const hh = fmHistory(dr, o), F = o.film, n = hh.steps.length, SP = hh.steps[n - 1], LP = fmLayout(hh, n - 1, dr.series[n - 1].h, o);
  const Xroom = Math.min(fmGAB(o.rhRoom, o.gab), hh.Xcap);
  const lay = (Xv, Tv) => { const out = []; for (let k = 0; k < hh.K; k++) if (SP.set[k]) { const f = 1 / (1 + Xv[k] / F.Xh), Ek = F.Ep * f;
    out.push({ t: LP.tSet(k), z0: LP.z0[k], Q: Ek / (1 - F.nup), en: hh.bornE[k] + F.alphaF * (Tv[k] - hh.bornT[k]) + F.beta * (Xv[k] - hh.bornX[k]) }); } return out; };
  return { atPeel: fmFree(lay(SP.X, SP.T)).kappa, settled: fmFree(lay(new Float64Array(hh.K).fill(Xroom), new Float64Array(hh.K).fill(o.Troom))).kappa };
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  fmTransIso, fmIso, fmGAB, fmTri, fmFaces, fmHistory, fmFree, fmPeelForce, fmFrontMoment,
  fmBand, fmBandAdd, fmBandSolve, fmGrade, fmQ9K, fmChannel, fmLayout, fmTension, fmCrack, fmRun, fmCurlOnly,
};
