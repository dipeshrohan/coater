/*
 * cfd-paths-worker.js — the paths of paste parcels through a 2D run in time (T-6), off the main thread: the flow kept at
 * even times (the run's frames) made into flow fields, then from each seed the pathline (a parcel let out at the first
 * kept time) and the streakline (the paste let out there without a break), cfd-flowviz.js's tracePathline and
 * traceStreakline.
 *
 * Message in:  { id, frames: [{ t, g }] (g: the kept time's grid -- grid, nx, ny, gx, gy, u, v, gd), seeds: [[x, y]],
 *                path (true: the pathlines), streak (true: the streaklines) }
 * Message out: { id, ok: true, path: [pathline] | null, streak: [streakline] | null, ms } or { id, ok: false, error }.
 */
importScripts('../engine/cfd-ode.js', '../engine/cfd-flowviz.js');

onmessage = e => {
  const o = e.data;
  try {
    const t0 = Date.now();
    const frames = o.frames.map(q => ({ t: q.t, f: makeFlowField(q.g, {}) }));
    const path = o.path ? o.seeds.map(s => tracePathline(frames, s)) : null;
    const streak = o.streak ? o.seeds.map(s => traceStreakline(frames, s)) : null;
    postMessage({ id: o.id, ok: true, path, streak, ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id: o.id, ok: false, error: err.message });
  }
};
