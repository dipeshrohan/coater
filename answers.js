'use strict';
/*
 * answers.js — one answer per quantity (WF-1). The coating's wet film, flow rate and contact line, each from the most
 * detailed model solved for the inputs as they are, and saying which:
 *  - at a location (L1–L4): the 3D (a strip there, or the full width's station nearest it), else the 2D, else the 1D;
 *  - across the web: the 1D's profile (61 positions), scaled at each position to the more detailed models where they
 *    are solved -- the ratio (theirs / the 1D's at that place, like for like) interpolated linearly between those places
 *    and held beyond them; with none solved, the 1D's own.
 * Every page that shows these (Results, Process and its chain, the report, the web edge, the scope checks) asks here.
 * Loaded after ui-1d.js (ONE_D, twoDAt, threeDAt, oneDAcrossNow) and before process-ui.js and ui.js.
 */

/** A model's name as the pages show it. */
const ANS_SRC = { '3D': '3D', '2D': '2D CFD', '1D': '1D' };

/** At location i: { film (m), q (m²/s), s (m up the exit face; 0 pinned at the metering edge), src ('3D' | '2D' | '1D') }
 *  from the most detailed model solved for the inputs as they are; null while the 1D solves. */
function ansAt(i) {
  const th = threeDAt(i), st = th && !th.stale && Number.isInteger(th.m) && th.m >= 0 ? th.R.stations[th.m] : null;
  if (st && Number.isFinite(st.film)) return { film: st.film, q: st.q, s: Number.isFinite(st.s) ? st.s : 0, src: '3D' };   // (a station's s is 0 unless it climbed)
  const two = twoDAt(i);
  if (two && !two.stale) return { film: two.r.Q / two.geo.U, q: two.r.Q, s: two.r.mode === 'climbed' ? two.r.sCL : 0, src: '2D' };
  return ansAt1D(i);
}
/** At location i, the 1D's own (the like-for-like reference the scaling across the web uses); null while it solves. */
function ansAt1D(i) {
  const R = ONE_D.res, L = R && oneDCurrent() ? R.locs[i] : null;
  return L ? { film: L.film, q: L.q, s: L.men.pinned ? 0 : L.men.s, src: '1D' } : null;
}

/** Linear interpolation of ys over the increasing xs at x, held at the ends. */
function ansInterp(xs, ys, x) {
  if (!xs.length) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let k = 1; while (xs[k] < x) k++;
  const t = (x - xs[k - 1]) / (xs[k] - xs[k - 1]);
  return ys[k - 1] + t * (ys[k] - ys[k - 1]);
}

/**
 * Across the web: { z (mm), film (m), s (m), src ('1D' | '2D' | '3D': the most detailed model it is scaled to), label,
 * anchors: [{ z (mm), src, film, film1D, s, s1D }] (where the scaling was taken) } or null while the 1D solves.
 * The film and the contact line are scaled alike: 1D shape, the level of the model solved there. Where the 1D is pinned
 * (s = 0) the contact line stays pinned; a place where the other model is pinned and the 1D is not scales it to 0.
 */
function ansAcross() {
  const A = oneDAcrossNow();
  if (!A || !A.length) return null;
  const z = A.map(r => r.z), f1 = A.map(r => r.film), s1 = A.map(r => r.men.pinned ? 0 : r.men.s);
  const anchors = [];
  for (let i = 0; i < CFD_LOCS.length; i++) {
    const a = ansAt(i), o = ansAt1D(i);
    if (!a || !o || a.src === '1D') continue;
    anchors.push({ z: CFD_LOCS[i].z, src: a.src, film: a.film, film1D: o.film, s: a.s, s1D: o.s });
  }
  if (!anchors.length) return { z, film: f1, s: s1, src: '1D', label: '1D across the web', anchors };
  anchors.sort((p, q) => p.z - q.z);
  const az = anchors.map(p => p.z), rf = anchors.map(p => p.film / p.film1D);
  const rs = anchors.map(p => p.s1D > 0 ? p.s / p.s1D : 1);   // (the 1D pinned: nothing to scale)
  const film = z.map((x, k) => f1[k] * ansInterp(az, rf, x)), s = z.map((x, k) => s1[k] * ansInterp(az, rs, x));
  const src = anchors.some(p => p.src === '3D') ? '3D' : '2D', where = anchors.map(p => `L${CFD_LOCS.findIndex(l => l.z === p.z) + 1}`).join(', ');
  return { z, film, s, src, label: `1D across the web, scaled to the ${ANS_SRC[src]} at ${where}`, anchors };
}
/** The across-the-web answer at z (mm): { film (m), s (m) }, interpolated; null while the 1D solves. */
function ansAcrossAt(z) {
  const X = ansAcross();
  return X ? { film: ansInterp(X.z, X.film, z), s: ansInterp(X.z, X.s, z), src: X.src, label: X.label } : null;
}

/**
 * The ripple on the film levelling from the blade to the oven at location i (the 1D's model, cfd-1d.js's ripple1D, on
 * that location's inputs), on the answer's film there: { ...ripple1D's, h (m), src }. The film's sensitivity to the gap
 * (dh/dH) is the 1D's; the structure's rebuilding starts from the 1D's at the edge. Null while the 1D solves.
 */
function ansRippleAt(i) {
  const a = ansAt(i), R = ONE_D.res, L = R && oneDCurrent() ? R.locs[i] : null;
  if (!a || !L || !L.ripple) return null;
  const lam0 = L.struct ? L.struct.exit : null;
  const rp = ripple1D(oneDGeo(i), a.film, L.ripple.dhdH, oneDRipple(), lam0);
  return { ...rp, h: a.film, dhdH: L.ripple.dhdH, src: a.src };
}

/** A solve finished (a 2D location, the 3D): the pages that show these answers are drawn again (the others as they were). */
function ansRefresh() { if ([1, 2, 3, 6, 7, 12].includes(tab)) render(); }

/** A short "from the …" note for a value's source (the pages' captions and tiles). */
const ansFrom = src => `from the ${ANS_SRC[src] || src}`;

if (typeof module !== 'undefined' && module.exports) module.exports = { ansInterp };
