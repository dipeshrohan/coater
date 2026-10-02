/*
 * cfd-pool-worker.js — the pool behind the blade through a pulse cycle (Coating › 2D and 3D › Pool and feed), off the page:
 * the flow during a pulse and between pulses (feed-pool.js on feed-fem.js), with the paste's own law (rheo.js), and the
 * paths from each landing to the pool edge. Message in: { id, o } (fplCycle's options, the law as { muRef, ty, n, rheoX });
 * out: { id, progress: { text, f } } while it works, then { id, ok, res, ms } or { id, ok: false, error }.
 */
importScripts('rheo.js', 'cfd-solver.js', 'feed-fem.js', 'feed-free.js', 'feed-post.js', 'feed-pool-mesh.js', 'feed-pool.js');
// (the faces' node lists feed-fem.js reads: the pool mesh's, the same faces)
var FM_FACES = FPM_FACES;
onmessage = e => {
  const { id, o } = e.data, t0 = Date.now();
  try {
    const L = o.law;
    o.muLaw = gd => muEffLocal(gd, L.muRef, L.ty, L.n, L.rheoX);
    o.plain = !(L.ty > 0) && L.n === 1 && !L.rheoX;
    const res = fplCycle(o, (text, f) => postMessage({ id, progress: { text, f } }));
    const buf = []; res.states.forEach(s => ['X', 'Y', 'Z', 'u', 'v', 'w', 'p'].forEach(k => buf.push(s[k].buffer))); res.paths.forEach(p => buf.push(p.pts.buffer));
    postMessage({ id, ok: true, res, ms: Date.now() - t0 }, buf);
  } catch (err) { postMessage({ id, ok: false, error: (err && err.message) || String(err) }); }
};
