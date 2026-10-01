/*
 * cfd-mp-worker.js — the multiphysics solvers (MP) off the main thread. MP-1: the pressed stack in the pre heat treatment
 * (stack-mp.js on mp-core.js), in 1D, 2D or 3D: its heat, its water and each followed piece's stress, together. MP-2:
 * the furnace's stack (furnace-mp.js): its heat with its chemistry's, its gas and each followed piece's stress. MP-5: the
 * film drying on its web (drying-mp.js): its heat, its water, the air through the web and the drying stress.
 *
 * Message in:  { id, kind: 'stack' | 'furnace' | 'dry', o } (smpStack's, fmpStack's or dmpDry's inputs, plain data)
 * Message out: { id, progress: { k, n } } while it works, then { id, ok: true, res, ms } or { id, ok: false, error }.
 */
importScripts('matlib.js', 'mp-core.js', 'drying.js', 'press.js', 'stack-mp.js', 'furnace.js', 'furnace-mp.js', 'film.js', 'drying-mp.js');

/** A run, compact: the series (minutes), the sections and the pieces' fields at the snapshots, the answers, the balances. */
function mpStackCompact(r) {
  const p = (x, n) => (Number.isFinite(x) ? +(+x).toPrecision(n) : null), row = a => Array.from(a, v => p(v, 5));
  return {
    dim: r.dim, follow: r.follow, summary: r.summary, energy: r.energy, water: r.water, ms: r.ms,
    mesh: { nodes: r.mesh.nodes, elems: r.mesh.elems, unknowns: r.mesh.unknowns, stressNodes: r.mesh.stressNodes, H: r.mesh.H, Hs: r.mesh.Hs,
      x: r.dim > 1 ? row(r.mesh.coord[0]) : [0], z: row(r.mesh.coord[r.dim - 1]), sx: r.mesh.stressCoord ? row(r.mesh.stressCoord[0]) : null, sy: r.mesh.stressCoord && r.mesh.stressCoord[1] ? row(r.mesh.stressCoord[1]) : null },
    series: r.series.map(q => ({ t: p(q.t / 60, 6), stage: q.stage, Tair: q.Tair, T: Object.fromEntries(Object.entries(q.T).map(([k, v]) => [k, v == null ? null : p(v, 5)])),
      X: Object.fromEntries(Object.entries(q.X).map(([k, v]) => [k, [p(v[0], 5), p(v[1], 5)]])), pull: Object.fromEntries(Object.entries(q.pull).map(([k, v]) => [k, p(v, 4)])) })),
    snaps: r.snaps.map(s => ({ t: p(s.t / 60, 6), stage: s.stage, secT: s.secT.map(row), secX: s.secX.map(row), ...(r.dim === 3 ? { T3: row(s.T), X3: row(s.X) } : {}),
      pieces: Object.fromEntries(Object.entries(s.pieces).map(([k, v]) => [k, { X: v.X ? row(v.X) : null, T: v.T ? row(v.T) : null, s1: v.s1 ? Array.from(v.s1, x => p(x / 1e6, 4)) : null, strip: v.strip ? v.strip.map(([x, sg]) => [p(x, 5), p(sg / 1e6, 4)]) : null }])) })),
  };
}

/** The furnace's run, compact: the series (hours), the sections and the followed pieces' maps at the snapshots, the answers, the balances. */
function mpFurnCompact(r) {
  const p = (x, n) => (Number.isFinite(x) ? +(+x).toPrecision(n) : null), row = a => Array.from(a, v => p(v, 5));
  const pc = v => ({ mid: p(v.mid, 5), edge: p(v.edge, 5), aM: p(v.aM, 4), aE: p(v.aE, 4), oM: p(v.oM, 4), oE: p(v.oE, 4), under: p(v.under, 4), middle: p(v.middle, 4), hold: p(v.hold, 4), pull: p(v.pull, 4) });
  return {
    dim: r.dim, follow: r.follow, summary: r.summary, energy: r.energy, substeps: r.substeps, ms: r.ms,
    mesh: { nodes: r.mesh.nodes, elems: r.mesh.elems, goNodes: r.mesh.goNodes, stressNodes: r.mesh.stressNodes, H: r.mesh.H, Hs: r.mesh.Hs, plT: r.mesh.plT, zPiece: r.mesh.zPiece,
      x: row(r.mesh.coord[0]), z: r.dim > 1 ? row(r.mesh.coord[r.dim - 1]) : null, gx: row(r.mesh.gasCoord[0]), gy: r.mesh.gasCoord[1] ? row(r.mesh.gasCoord[1]) : null,
      sx: r.mesh.stressCoord ? row(r.mesh.stressCoord[0]) : null, sy: r.mesh.stressCoord && r.mesh.stressCoord[1] ? row(r.mesh.stressCoord[1]) : null },
    series: r.series.map(q => ({ t: p(q.t / 3600, 7), run: q.run, Tprog: p(q.Tprog, 5), lo: p(q.lo, 5), hi: p(q.hi, 5), aRef: p(q.aRef, 4), oRef: p(q.oRef, 4), pieces: Object.fromEntries(Object.entries(q.pieces).map(([k, v]) => [k, pc(v)])) })),
    snaps: r.snaps.map(s => ({ t: p(s.t / 3600, 7), run: s.run, Tprog: p(s.Tprog, 5), mark: s.mark || null, secT: s.secT.map(row), secA: s.secA.map(row), secO: s.secO.map(row), ...(r.dim === 3 ? { T3: row(s.T) } : {}),
      pieces: Object.fromEntries(Object.entries(s.pieces).map(([k, v]) => [k, { gas: row(v.gas), hold: p(v.hold, 5), s1: v.s1 ? Array.from(v.s1, x => p(x / 1e6, 4)) : null, strip: v.strip ? v.strip.map(([x, sg]) => [p(x, 5), p(sg / 1e6, 4)]) : null }])) })),
  };
}

/** The drying's run, compact: what the pages draw (each place's own history, the stress's, stays here). */
function mpDryCompact(r) {
  const { webTs, ...rest } = r;
  void webTs;
  return { ...rest, phi0: r.phi0, rhoS: r.rhoS };
}

onmessage = e => {
  const { id, kind, o } = e.data, t0 = Date.now();
  try {
    if (kind !== 'stack' && kind !== 'furnace' && kind !== 'dry') throw new Error(`no such multiphysics run: ${kind}`);
    let last = 0;
    const onProgress = q => { const now = Date.now(); if (now - last > 150 || q.k === q.n) { last = now; postMessage({ id, progress: q }); } };
    const res = kind === 'stack' ? mpStackCompact(smpStack({ ...o, onProgress })) : kind === 'dry' ? mpDryCompact(dmpDry({ ...o, onProgress })) : mpFurnCompact(fmpStack({ ...o, onProgress }));
    postMessage({ id, ok: true, res, ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
