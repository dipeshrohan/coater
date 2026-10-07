/*
 * cfd-dry-worker.js — the drying in the oven (drying.js) off the main thread: each film (the locations' and the
 * web's mean) as a strip through the room and the oven's zones, its water leaving from the top only and from the top
 * and the bottom (Q53: both, side by side).
 *
 * Message in:  { id, base: drStrip's inputs without h0 and where, films: [{ key, h0 }] }
 * Message out: { id, progress: { k, n, key, where } } while it works, then
 *              { id, ok: true, runs: [{ key, h0, where, ...dryCompact }], ms } or { id, ok: false, error }.
 */
importScripts('../engine/drying.js');

/** A strip's result, compact: the series along the line and the profiles through the film rounded to what is shown. */
function dryCompact(r) {
  const p = (x, n) => +(+x).toPrecision(n), r2 = x => Math.round(x * 100) / 100;
  return {
    series: r.series.map(q => ({ x: p(q.x, 6), t: p(q.t, 6), Ts: r2(q.Ts), Tb: r2(q.Tb), Tft: r2(q.Tft), Tfb: r2(q.Tfb), Et: p(q.Et, 4), Eb: p(q.Eb, 4),
      wet: p(q.wet, 5), bound: p(q.bound, 5), h: p(q.h, 5), skinT: p(q.skinT, 4), skinB: p(q.skinB, 4) })),
    profiles: r.profiles.map(q => ({ x: p(q.x, 6), label: q.label, z: q.z.map(v => p(v, 4)), phi: q.phi.map(v => p(v, 4)), T: q.T.map(r2), h: p(q.h, 5), skinTop: p(q.skinTop, 4), skinBottom: p(q.skinBottom, 4) })),
    events: r.events, exit: r.exit, W0: r.W0, evT: r.evT, evB: r.evB, mGO: r.mGO, Pe: r.Pe,
    rates: r.rates.map(q => ({ name: q.name, x0: q.x0, x1: q.x1, Ts: r2(q.Ts), Tb: r2(q.Tb), mt: p(q.mt, 4), mb: p(q.mb, 4), Pe: p(q.Pe, 4) })),
    es: r.es, swells: r.swells, aExit: r.aExit, Xb: r.Xb, Tboil: r.Tboil, xStart: r.xStart, xEnd: r.xEnd, nSteps: r.nSteps,
    Tmax: Math.max(...r.series.map(q => Math.max(q.Ts, q.Tb))),
  };
}

onmessage = e => {
  const { id, base, films } = e.data, t0 = Date.now(), runs = [];
  try {
    const n = films.length * 2;
    for (const f of films) for (const where of ['top', 'both']) {
      postMessage({ id, progress: { k: runs.length, n, key: f.key, where } });
      runs.push({ key: f.key, h0: f.h0, where, ...dryCompact(drStrip({ ...base, h0: f.h0, where })) });
    }
    postMessage({ id, ok: true, runs, ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
