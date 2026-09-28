/*
 * cfd-film-worker.js — the film on the fibre web to the peel (GO-4: drying.js followed to the peel with its history,
 * then film.js) off the main thread: each film (the locations' and the web's mean), its water leaving from the top only
 * and from the top and the bottom (Q53, as the drying), side by side.
 *
 * Message in:  { id, base: drStrip's inputs without h0 and where (with the room stretch to the peel, `after`),
 *                films: [{ key, h0 }], fo: fmRun's film properties (SI) }
 * Message out: { id, progress: { k, n, key, where } } while it works, then
 *              { id, ok: true, runs: [{ key, h0, where, ...filmCompact }], ms } or { id, ok: false, error }.
 */
importScripts('drying.js', 'film.js');

/** A run's film, compact: the line thinned to at most 300 places, the rest as fmRun gives it (rounded). */
function filmCompact(r, dr) {
  const p = (x, n) => x == null || !Number.isFinite(x) ? x : +(+x).toPrecision(n);
  const every = Math.max(1, Math.ceil(r.line.length / 300)), keep = (arr, i) => i % every === 0 || i === arr.length - 1;
  const line = r.line.filter((q, i) => keep(r.line, i)).map(q => ({ x: p(q.x, 6), dry: q.dry, hFloat: p(q.hFloat, 4), hBond: p(q.hBond, 4), hWet: p(q.hWet, 4),
    sTopF: p(q.sTopF, 4), sTopB: p(q.sTopB, 4), sBond: p(q.sBond, 4), sWeb: p(q.sWeb, 4), GestF: p(q.GestF, 4), GestB: p(q.GestB, 4) }));
  const bl = r.blisters.line.filter((q, i) => keep(r.blisters.line, i)).map(q => ({ x: p(q.x, 6), ratio: p(q.ratio, 4) }));
  const st = S => S ? { G: p(S.G, 5), ratio: p(S.ratio, 5), h: p(S.h, 5), sMean: p(S.sMean, 5) } : null;
  const last = dr.series[dr.series.length - 1];
  return {
    line, blisterLine: bl, stations: r.stations.map(S => ({ x: p(S.x, 6), float: st(S.float), bond: st(S.bond) })),
    worst: r.worst ? { x: r.worst.x, which: r.worst.which, G: r.worst.G, ratio: r.worst.ratio, h: r.worst.h, sMean: r.worst.sMean } : null,
    spacing: r.spacing, ladder: r.ladder, firstCrack: r.firstCrack, curl: r.curl, peel: r.peel, roll: r.roll, plate: r.plate, curlBeta: r.curlBeta,
    blisters: { max: r.blisters.max, steam: r.blisters.steam }, profile: r.profile,
    peelX: r.peelX, ovenX: r.ovenX, wetAtPeel: r.wetAtPeel, hPeel: r.hPeel,
    atPeel: { waterPct: dr.exit.waterPct, dry: dr.exit.dry, Ts: last.Ts, Tb: last.Tb, h: last.h }, ovenExit: dr.ovenExit, dryAt: dr.events.dry,
  };
}

onmessage = e => {
  const { id, base, films, fo } = e.data, t0 = Date.now(), runs = [];
  try {
    const n = films.length * 2;
    for (const f of films) for (const where of ['top', 'both']) {
      postMessage({ id, progress: { k: runs.length, n, key: f.key, where } });
      const dr = drStrip({ ...base, h0: f.h0, where, history: true });
      const r = fmRun(dr, fo);
      // (the curl at β = 0 and β = 1: a measured curl read back as the β it implies)
      const k0 = fmCurlOnly(dr, { ...fo, film: { ...fo.film, beta: 0 } }), k1 = fmCurlOnly(dr, { ...fo, film: { ...fo.film, beta: 1 } });
      r.curlBeta = { atPeel: [k0.atPeel, k1.atPeel - k0.atPeel], settled: [k0.settled, k1.settled - k0.settled] };
      runs.push({ key: f.key, h0: f.h0, where, ...filmCompact(r, dr) });
    }
    postMessage({ id, ok: true, runs, ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
