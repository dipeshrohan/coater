/*
 * cfd-across.js — the blade across the web (Phase 4): the parts of the gap's change at each position across the
 * web, and the beam that bows under its loads. Pure computation, no DOM: the main thread (the gap every page
 * uses) and the 1D worker (the crown).
 *
 * Positions z in mm from the web's left edge (0 .. W); gap changes in µm, + = the gap larger. The blade runs
 * from -oL to W + oR: its ends relative to the web's edges (+ it overhangs the edge, - it ends inside).
 */

/** The blade's span across the web (mm): [its left end, its right end]. */
const acrossSpan = (W, ends) => [-(ends ? ends.left || 0 : 0), W + (ends ? ends.right || 0 : 0)];

/** A sine across the web (µm): amplitude a (µm), wavelength lw (mm), its first crest at crest mm (null: lw / 4, as
 *  the waviness always had it: a sin(2 pi z / lw)). */
function acrossSine(z, a, lw, crest) {
  if (crest == null) return a * Math.sin(2 * Math.PI * z / lw);
  return a * Math.sin(2 * Math.PI * (z - crest + lw / 4) / lw);
}

/** The typed bow (µm) at z: um at the blade's middle, zero at its ends; shape 'parabola', 'arc' (a circular arc
 *  through the ends) or 'cosine'. Beyond the blade: zero. */
function acrossBowTyped(z, um, shape, span) {
  const zc = (span[0] + span[1]) / 2, a = (span[1] - span[0]) / 2, x = z - zc;
  if (!(a > 0) || Math.abs(x) > a || !um) return 0;
  const u = x / a;
  if (shape === 'cosine') return um * Math.cos(Math.PI * u / 2);
  if (shape === 'arc') {
    // a circle through the ends with the sagitta s at the middle: s - x^2 / (R + sqrt(R^2 - x^2)), R = (a^2 + s^2) / 2s (mm)
    const s = Math.abs(um) / 1000, R = (a * a + s * s) / (2 * s);
    return Math.sign(um) * 1000 * (s - x * x / (R + Math.sqrt(R * R - x * x)));
  }
  return um * (1 - u * u);
}

/** Chamfered ends (µm) at z: over the last c mm from each of the blade's ends the gap grows straight to d µm at the
 *  end. ends: { left: { c, d }, right: { c, d } }. */
function acrossEnds(z, ends, span) {
  let v = 0;
  const L = ends.left, R = ends.right;
  if (L && L.c > 0 && L.d) { const t = z - span[0]; if (t >= 0 && t < L.c) v += L.d * (1 - t / L.c); }
  if (R && R.c > 0 && R.d) { const t = span[1] - z; if (t >= 0 && t < R.c) v += R.d * (1 - t / R.c); }
  return v;
}

/**
 * A smooth curve through points [[z, v], ...] (sorted by z, at least one): monotone cubic Hermite (Fritsch-Carlson):
 * through every point, no overshoot between them; flat beyond the first and last. Returns z => v.
 */
function acrossPchip(pts) {
  const p = pts.filter(q => Number.isFinite(q[0]) && Number.isFinite(q[1])).slice().sort((a, b) => a[0] - b[0]);
  // (repeated z: their mean)
  const P = [];
  for (const q of p) { const l = P[P.length - 1]; if (l && Math.abs(q[0] - l[0]) < 1e-12) { l[1] = (l[1] * l[2] + q[1]) / (l[2] + 1); l[2]++; } else P.push([q[0], q[1], 1]); }
  const n = P.length;
  if (!n) return () => 0;
  if (n === 1) return () => P[0][1];
  const x = P.map(q => q[0]), y = P.map(q => q[1]), h = [], d = [], m = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) { h.push(x[i + 1] - x[i]); d.push((y[i + 1] - y[i]) / h[i]); }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  // (the end slopes: the one-sided three-point estimate, kept within the monotone range)
  if (n > 2) {
    const e = (h0, h1, d0, d1) => { let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (Math.sign(s) !== Math.sign(d0)) s = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0; return s; };
    m[0] = e(h[0], h[1], d[0], d[1]); m[n - 1] = e(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  }
  return z => {
    if (z <= x[0]) return y[0];
    if (z >= x[n - 1]) return y[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const md = (lo + hi) >> 1; if (x[md] <= z) lo = md; else hi = md; }
    const t = (z - x[lo]) / h[lo], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[lo] + (t3 - 2 * t2 + t) * h[lo] * m[lo] + (-2 * t3 + 3 * t2) * y[hi] + (t3 - t2) * h[lo] * m[hi];
  };
}

/**
 * The beam's deflection under a unit load (Green's function, per EI): L its length (m), supports 'simple' (pinned
 * at both ends) or 'clamped' (held rigidly at both ends); z and a (m, from its left end): where it is measured,
 * where the load is. Classical Euler-Bernoulli (Roark's formulas).
 */
function beamGreen(L, supports) {
  if (supports === 'clamped') return (z, a) => {
    if (z > a) { z = L - z; a = L - a; }
    const b = L - a;
    return b * b * z * z * (3 * a * L - z * (3 * a + b)) / (6 * L * L * L);
  };
  return (z, a) => {
    if (z > a) { z = L - z; a = L - a; }
    const b = L - a;
    return b * z * (L * L - b * b - z * z) / (6 * L);
  };
}

/**
 * The bow of a beam of length L (m) with EI (N m^2) under a load per length q(s) (N/m, + upward, s from its left
 * end in m), at n + 1 points evenly along it: w (m, + upward). The integral of the Green's function against the load
 * by Simpson's rule on nq intervals (even).
 */
function beamBow({ L, EI, supports, q, n = 120, nq = 600 }) {
  const G = beamGreen(L, supports), hq = L / nq, qs = Float64Array.from({ length: nq + 1 }, (_, k) => q(k * hq));
  const s = Float64Array.from({ length: n + 1 }, (_, i) => L * i / n), w = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    let sum = 0;
    for (let k = 0; k <= nq; k++) sum += (k === 0 || k === nq ? 1 : k % 2 ? 4 : 2) * G(s[i], k * hq) * qs[k];
    w[i] = sum * hq / 3 / EI;
  }
  return { s, w };
}

/** The beam's section from the blade's height h and thickness t (mm), or I typed (mm^4): I (m^4), area (m^2). */
const beamSection = (b) => ({ I: (b.I > 0 ? b.I : b.t * Math.pow(b.h, 3) / 12) * 1e-12, A: b.t * b.h * 1e-6 });

if (typeof module !== 'undefined' && module.exports) module.exports = { acrossSpan, acrossSine, acrossBowTyped, acrossEnds, acrossPchip, beamGreen, beamBow, beamSection };
