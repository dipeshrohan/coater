/*
 * cfd-mp-worker.js — the multiphysics solvers (MP) off the main thread. MP-1: the pressed stack in the pre heat treatment
 * (stack-mp.js on mp-core.js), in 1D, 2D or 3D: its heat, its water and each followed piece's stress, together.
 *
 * Message in:  { id, kind: 'stack', o } (smpStack's inputs, plain data)
 * Message out: { id, progress: { k, n } } while it works, then { id, ok: true, res, ms } or { id, ok: false, error }.
 */
importScripts('mp-core.js', 'drying.js', 'press.js', 'stack-mp.js');

/** A run, compact: the series (minutes), the sections and the pieces' fields at the snapshots, the answers, the balances. */
function mpStackCompact(r) {
  const p = (x, n) => (Number.isFinite(x) ? +(+x).toPrecision(n) : null), row = a => Array.from(a, v => p(v, 5));
  return {
    dim: r.dim, follow: r.follow, summary: r.summary, energy: r.energy, water: r.water, ms: r.ms,
    mesh: { nodes: r.mesh.nodes, elems: r.mesh.elems, unknowns: r.mesh.unknowns, stressNodes: r.mesh.stressNodes, H: r.mesh.H, Hs: r.mesh.Hs,
      x: r.dim > 1 ? row(r.mesh.coord[0]) : [0], z: row(r.mesh.coord[r.dim - 1]), sx: r.mesh.stressCoord ? row(r.mesh.stressCoord[0]) : null, sy: r.mesh.stressCoord && r.mesh.stressCoord[1] ? row(r.mesh.stressCoord[1]) : null },
    series: r.series.map(q => ({ t: p(q.t / 60, 6), stage: q.stage, Tair: q.Tair, T: Object.fromEntries(Object.entries(q.T).map(([k, v]) => [k, v == null ? null : p(v, 5)])),
      X: Object.fromEntries(Object.entries(q.X).map(([k, v]) => [k, [p(v[0], 5), p(v[1], 5)]])), pull: Object.fromEntries(Object.entries(q.pull).map(([k, v]) => [k, p(v, 4)])) })),
    snaps: r.snaps.map(s => ({ t: p(s.t / 60, 6), stage: s.stage, secT: s.secT.map(row), secX: s.secX.map(row),
      pieces: Object.fromEntries(Object.entries(s.pieces).map(([k, v]) => [k, { X: v.X ? row(v.X) : null, T: v.T ? row(v.T) : null, s1: v.s1 ? Array.from(v.s1, x => p(x / 1e6, 4)) : null, strip: v.strip ? v.strip.map(([x, sg]) => [p(x, 5), p(sg / 1e6, 4)]) : null }])) })),
  };
}

onmessage = e => {
  const { id, kind, o } = e.data, t0 = Date.now();
  try {
    if (kind !== 'stack') throw new Error(`no such multiphysics run: ${kind}`);
    let last = 0;
    const r = smpStack({ ...o, onProgress: q => { const now = Date.now(); if (now - last > 150 || q.k === q.n) { last = now; postMessage({ id, progress: q }); } } });
    postMessage({ id, ok: true, res: mpStackCompact(r), ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
