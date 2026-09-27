/*
 * rheo.js — the slurry's rheology beyond Herschel–Bulkley (GO-1): the Carreau–Yasuda and Cross laws, and the
 * structure (thixotropy) model. Pure computation: loaded before cfd-solver.js in the page and in the solvers'
 * workers, required by it in Node.
 *
 * Laws, anchored as the app's others are, so the viscosity at 2.7 1/s is the sidebar's measured value muRef:
 *   Carreau–Yasuda  eta = eta_inf + (eta0 - eta_inf) [1 + (L gd)^a]^((n - 1)/a)
 *   Cross           eta = eta_inf + (eta0 - eta_inf) / (1 + (L gd)^(1 - n))
 * with eta0 from the anchor; x = { model, etaInf (Pa s), L (s), a } carries the extras (eta_inf at most half
 * of muRef). The stress tau = eta gd rises with gd for n > 0, so its inverse is one-valued: Newton on ln gd.
 *
 * Structure lambda (0 broken, 1 built), S = { tb (s), gdc (1/s), cy, ce }:
 *   d lambda / dt = (1 - lambda) / tb - lambda gd / (gdc tb)      (rebuilds at rest over tb, broken by shear)
 *   at a steady shear rate  lambda_e(gd) = 1 / (1 + gd / gdc);  over dt at a constant gd, exactly
 *   lambda(t) = lambda_e + (lambda0 - lambda_e) exp(-(1 + gd / gdc) t / tb).
 * The stress keeps the law's steady curve tau_e(gd) (yield stress ty):
 *   tau = ty (1 + cy lambda)/(1 + cy lambda_e) + (tau_e - ty)(1 + ce lambda)/(1 + ce lambda_e),
 * so at steady shear it is the law exactly; rested (lambda above lambda_e) it is stronger (cy: the yield
 * stress) and thicker (ce: the viscosity), just sheared weaker and thinner.
 */

const RHEO_EXTRA = new Set(['carreau', 'cross']);
/** The law's shape factor F(gd) (eta = eta_inf + (eta0 - eta_inf) F) and d ln F / d ln gd. */
function rheoShape(model, L, a, n, gd) {
  const t = Math.pow(L * gd, model === 'cross' ? 1 - n : a);
  if (model === 'cross') { const F = 1 / (1 + t); return [F, -(1 - n) * t * F]; }
  const F = Math.pow(1 + t, (n - 1) / a);
  return [F, (n - 1) * t / (1 + t)];
}
/**
 * A law compiled once: mu(gd) (Pa s), tau(gd) and its inverse gdOf(|tau|). Herschel–Bulkley (and power law,
 * Newtonian) as cfd-solver.js's muEffLocal; Carreau–Yasuda and Cross with the anchor muRef at 2.7 1/s.
 */
function rheoCompile(muRef, ty, n, x) {
  if (!x || !RHEO_EXTRA.has(x.model)) {
    const base = Math.max(muRef - ty / 2.7, 0.05 * muRef);
    const mu = gd => { gd = Math.max(gd, 1e-9); return ty / gd + base * Math.pow(gd / 2.7, n - 1); };
    const gdOf = t => t <= ty ? 0 : Math.pow((t - ty) / base, 1 / n) * Math.pow(2.7, (n - 1) / n);
    return { model: x && x.model || 'hb', mu, tau: gd => mu(gd) * gd, gdOf, ty, n, muRef };
  }
  const model = x.model, L = x.L, a = model === 'cross' ? 1 : x.a;
  const ei = Math.min(Math.max(x.etaInf || 0, 0), 0.5 * muRef);
  const e0 = ei + (muRef - ei) / rheoShape(model, L, a, n, 2.7)[0];
  const mu = gd => { gd = Math.max(gd, 1e-9); return ei + (e0 - ei) * rheoShape(model, L, a, n, gd)[0]; };
  // (ln tau against ln gd: slope 1 + (e0 - ei) F dlnF / eta, between n and 1)
  const gdOf = t => {
    if (!(t > 0)) return 0;
    let s = Math.log(t / e0), lo = -60, hi = 60;   // (start: the Newtonian plateau)
    for (let k = 0; k < 60; k++) {
      const g = Math.exp(s), [F, dl] = rheoShape(model, L, a, n, g), eta = ei + (e0 - ei) * F;
      const f = Math.log(eta * g / t);
      if (f > 0) hi = s; else lo = s;
      if (Math.abs(f) < 1e-14) break;
      const d = 1 + (e0 - ei) * F * dl / eta;
      let sn = s - f / d;
      if (!(sn > lo && sn < hi)) sn = (lo + hi) / 2;
      if (Math.abs(sn - s) < 1e-15) { s = sn; break; }
      s = sn;
    }
    return Math.exp(s);
  };
  return { model, mu, tau: gd => mu(gd) * gd, gdOf, ty: 0, n, muRef, eta0: e0, etaInf: ei };
}
// (compiled laws cached by their inputs: the solvers call muEffLocal with the same extras many times)
const RHEO_CACHE = new Map(), RHEO_LAST = { x: null };
function rheoCached(muRef, ty, n, x) {
  const L = RHEO_LAST;
  if (L.x === x && L.muRef === muRef && L.ty === ty && L.n === n && L.m === x.model && L.ei === x.etaInf && L.L === x.L && L.a === x.a) return L.c;
  const k = `${x.model}|${muRef}|${ty}|${n}|${x.etaInf}|${x.L}|${x.a}`;
  let c = RHEO_CACHE.get(k);
  if (!c) { if (RHEO_CACHE.size > 64) RHEO_CACHE.clear(); c = rheoCompile(muRef, ty, n, x); RHEO_CACHE.set(k, c); }
  Object.assign(L, { x, muRef, ty, n, m: x.model, ei: x.etaInf, L: x.L, a: x.a, c });
  return c;
}

// ---- the structure (thixotropy) ----
/** lambda at a steady shear rate. */
const rheoLamEq = (gd, S) => 1 / (1 + Math.abs(gd) / S.gdc);
/** lambda after dt at a constant shear rate gd (exact). */
function rheoLamStep(lam, gd, dt, S) {
  const le = rheoLamEq(gd, S);
  return le + (lam - le) * Math.exp(-(1 + Math.abs(gd) / S.gdc) * dt / S.tb);
}
/** lambda after resting t (gd = 0) from lam0. */
const rheoRest = (lam0, t, S) => 1 - (1 - lam0) * Math.exp(-t / S.tb);
/** d lambda / dt at lambda, gd. */
const rheoLamRate = (lam, gd, S) => ((1 - lam) - lam * Math.abs(gd) / S.gdc) / S.tb;
/** The stress at gd with structure lam (law: compiled; its steady curve tau_e and yield stress ty kept at lambda_e). */
function rheoTauStruct(gd, lam, law, S) {
  gd = Math.abs(gd);
  const le = rheoLamEq(gd, S), te = law.tau(Math.max(gd, 1e-9)), ty = law.ty || 0;
  return ty * (1 + S.cy * lam) / (1 + S.cy * le) + (te - ty) * (1 + S.ce * lam) / (1 + S.ce * le);
}
/** The apparent viscosity tau / gd with structure lam. */
const rheoMuStruct = (gd, lam, law, S) => rheoTauStruct(Math.max(Math.abs(gd), 1e-9), lam, law, S) / Math.max(Math.abs(gd), 1e-9);
/** The yield stress with structure lam (lambda_e = 1 at rest). */
const rheoYieldStruct = (lam, law, S) => (law.ty || 0) * (1 + S.cy * lam) / (1 + S.cy);
/**
 * The integral over resting time t of 1 / m(lambda(s)), lambda rebuilding at rest from lam0 (rheoRest), for m linear in
 * lambda (as rheoMuStruct is at a fixed shear rate): m(s) = M - B exp(-s / tb), M = m(1), B = M - m(lam0), so exactly
 *   t / M + (tb / M) ln((M - B exp(-t / tb)) / m(lam0)).
 */
function rheoRestInv(mOf, lam0, S, t) {
  const M = mOf(1), m0 = mOf(lam0), B = M - m0;
  return t / M + (S.tb / M) * Math.log((M - B * Math.exp(-t / S.tb)) / m0);
}
/**
 * Levelling on the web after the blade, the slurry rebuilding at rest from lam0 (lambda(t) = rheoRest): an amplitude A
 * relaxes toward the residual R a yield stress holds, dA/dt = -(A - R) / tau, while above it, and stays once the
 * rebuilding yield stress holds it (A <= R; R only grows as lambda rebuilds). tauOf(lam), resOf(lam): the levelling time
 * and the residual at structure lam. Integrated on demand, in steps at most a two-hundredth of tb and a fifth of tau long
 * (not below 1e-9 tb), each exact for tau and R at its middle; once lambda is within e^-40 of rebuilt, tau and R are
 * constant and one step covers the rest. Held, too, once within 1e-12 a0 of the residual (with no yield stress: gone).
 * (Some 8000 steps at most where tau is the longer; where it is the shorter, each step takes the ripple a fifth of tau
 * nearer, so within some 140 steps it is held or gone.)
 * Returns { at(t) (t in s; A non-increasing), frozen() (the time the yield stress holds it, or null), final() (what it
 * settles to) }.
 */
function rheoLevel(a0, lam0, S, tauOf, resOf) {
  const T = [0], A = [a0], Rm = [], Tm = [], settle = 40 * S.tb;
  let tFrozen = a0 > resOf(lam0) ? null : 0;
  const extend = tt => {
    while (tFrozen === null && T[T.length - 1] < tt) {
      const t = T[T.length - 1], a = A[A.length - 1];
      // (the yield stress holds it from here -- or it is within 1e-12 of the start from its residual: as good as there)
      if (!(a - resOf(rheoRest(lam0, t, S)) > 1e-12 * a0)) { tFrozen = t; break; }
      const dt = t < settle ? Math.min(S.tb / 200, Math.max(0.2 * tauOf(rheoRest(lam0, t, S)), S.tb * 1e-9), settle - t) || S.tb / 200 : Math.max(tt - t, S.tb);
      const lm = rheoRest(lam0, t + dt / 2, S), R = resOf(lm), tau = tauOf(lm);
      // (not up toward a residual above it: the yield stress never raises the ripple)
      const r = a > R ? R : a, tm = a > R ? tau : Infinity;
      Rm.push(r); Tm.push(tm); T.push(t + dt); A.push(r + (a - r) * Math.exp(-dt / tm));
    }
  };
  const at = t => {
    if (!(t > 0)) return a0;
    extend(t);
    const n = Rm.length;
    if (t >= T[n]) return A[n];                                                // (held since tFrozen)
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t) lo = m; else hi = m - 1; }
    return Rm[lo] + (A[lo] - Rm[lo]) * Math.exp(-(t - T[lo]) / Tm[lo]);
  };
  const final = () => { extend(settle); return tFrozen !== null ? A[A.length - 1] : Math.min(A[A.length - 1], resOf(1)); };
  return { at, frozen: () => tFrozen, final };
}
/**
 * A thixotropy test (3ITT) as a rheometer runs it: intervals [{ gd (1/s), dur (s), n (points) }] at constant
 * shear rates, the structure starting from lam0 (default: steady at the first interval's rate). Returns the
 * points { t, gd, lam, eta } at the end of each of the interval's n equal steps.
 */
function rheo3ITT(intervals, law, S, lam0) {
  let lam = lam0 ?? rheoLamEq(intervals[0].gd, S), t = 0;
  const out = [];
  for (const iv of intervals) {
    const n = iv.n || 30, dt = iv.dur / n;
    for (let k = 0; k < n; k++) {
      lam = rheoLamStep(lam, iv.gd, dt, S); t += dt;
      out.push({ t, gd: iv.gd, lam, eta: rheoMuStruct(iv.gd, lam, law, S) });
    }
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { RHEO_EXTRA, rheoShape, rheoCompile, rheoCached, rheoLamEq, rheoLamStep, rheoRest, rheoLamRate, rheoTauStruct, rheoMuStruct, rheoYieldStruct, rheoRestInv, rheoLevel, rheo3ITT };
