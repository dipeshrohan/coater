/*
 * cfd-1d-worker.js — the 1D stage off the main thread (cfd-1d.js): each location's gap flow along
 * the blade, its film to the oven with the ripple levelling on it, the meniscus on the exit face,
 * and (when asked) the gap flow at every position across the web.
 *
 * Message in:  { id, locs: [geo], across: [geo] | null, ripple: { dHum, vibUm, lamMm } }
 *              geo: cfd-ui.js's cfdGeometry fields (SI), plus z (mm).
 * Message out: { id, ok: true, locs: [result], across: [result] | null, ms } or { id, ok: false, error }.
 * Or the crown (crownRun below): { id, crown: {...} } in, progress then { id, ok: true, crown } out.
 */
importScripts('cfd-solver.js', 'cfd-blade.js', 'cfd-1d.js', 'cfd-across.js');

/** A location: its gap flow (arrays and three velocity profiles), film to the oven, ripple, meniscus. */
function oneLocation(geo, ripple, full) {
  const r = gapFlow1D(geo);
  const out = {
    z: geo.z, q: r.q, film: r.film, qLub: r.qLub, filmLub: r.filmLub, Lx: r.Lx, converged: r.converged, worst: r.worstStation,
    x: r.x, h: r.h, p: r.p, G: r.G, tauWeb: r.tauWeb, tauBlade: r.tauBlade, H: geo.H, U: geo.U,
    men: r.blade ? meniscus1DPath(r.film, r.blade, geo.contactDeg, geo.gamma, geo.rho, geo.g) : meniscus1D(r.film, geo.H, geo.contactDeg, geo.exitAngle, geo.gamma, geo.rho, geo.g),
  };
  if (!full) return out;
  // velocity across the gap at the inlet, midway and at the metering edge
  const n = r.x.length - 1;
  out.profiles = [0, Math.round(n / 2), n].map(i => r.profile(i));
  // the film from the edge to the oven, and the ripple levelling on it (dh/dH: the film's
  // sensitivity to the gap, by solving at the gap +- 10 um)
  const f = film1D(geo, r.q);
  out.filmToOven = { x: f.x, h: f.h, hInf: f.hInf, converged: f.converged, error: f.error || null, mu: f.mu };
  const up = gapFlow1D({ ...geo, H: geo.H + 1e-5 }), dn = gapFlow1D({ ...geo, H: geo.H - 1e-5 });
  const dhdH = (up.film - dn.film) / 2e-5;
  const rp = ripple1D(geo, r.film, dhdH, ripple);
  const ts = Array.from({ length: 101 }, (_, i) => rp.tRes * 1.4 * i / 100);
  out.ripple = { dhdH, a0: rp.a0, tau: rp.tau, residual: rp.residual, asymptote: rp.asymptote, tRes: rp.tRes, mu: rp.mu, t: ts, a: ts.map(rp.at), atOven: rp.at(rp.tRes) };
  return out;
}

/**
 * The crown (Phase 4): { id, crown: { geos (each position's 1D inputs, the gap without a crown), counted, p } }. Found on a
 * lighter 1D (60 x 80: the film within 0.02 % of the page's), then each variant solved at the page's resolution.
 */
function crownRun(id, c) {
  const t0 = performance.now();
  const post = stage => postMessage({ id, progress: { stage } });
  const film = res => (k, dg) => gapFlow1D({ ...c.geos[k], H: c.geos[k].H + dg }, res).film;
  const r = crownFind({ n: c.geos.length, counted: c.counted, p: c.p, film: film({ nx: 60, ny: 80 }), progress: post });
  post('each variant at the page\'s resolution');
  const full = film({});
  const base = c.geos.map((_, k) => full(k, 0)), fa = c.geos.map((_, k) => full(k, r.parab.a * c.p[k])), fc = c.geos.map((_, k) => full(k, r.free.c[k]));
  postMessage({ id, ok: true, crown: { a: r.parab.a, c: r.free.c, s: r.s, base, parab: fa, free: fc, iters: r.free.iters,
    spread: { base: acrossSpread(base, c.counted), parab: acrossSpread(fa, c.counted), free: acrossSpread(fc, c.counted) } }, ms: performance.now() - t0 });
}

onmessage = e => {
  if (e.data.crown) { try { crownRun(e.data.id, e.data.crown); } catch (err) { postMessage({ id: e.data.id, ok: false, error: err.message }); } return; }
  const { id, locs, across, ripple } = e.data;
  try {
    const t0 = performance.now();
    const L = locs.map(g => oneLocation(g, ripple, true));
    const A = across ? across.map(g => oneLocation(g, ripple, false)) : null;
    postMessage({ id, ok: true, locs: L, across: A, ms: performance.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
