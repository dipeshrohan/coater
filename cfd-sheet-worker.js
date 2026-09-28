/*
 * cfd-sheet-worker.js — a cut piece of the film in 3D (GO-4d, sheet.js) off the main thread: the piece free (held up)
 * and lying on a table under its weight, for its film's two ways the water can leave.
 *
 * Message in:  { id, pieces: [{ where, plate: { A, D, nu, h, kS, kSet, p } }], Lx, Ly, n }
 *   (kS its settled natural curvature both ways, kSet the roll's set along the line; p its weight per area)
 * Message out: { id, progress: { k, n } } while it works, then { id, ok: true, runs: [{ where, free, table }], ms }
 *              or { id, ok: false, error }.
 */
importScripts('sheet.js');

/** A shape, compact: the heights on the grid (mm, rounded), the corners' and edges' heights, the middle's curvatures. */
function sheetCompact(r) {
  const p = v => +(+v).toPrecision(5);
  return { n: r.n, W: r.W.map(row => row.map(v => p(v * 1000))), corner: r.corner, edgeX: r.edgeX, edgeY: r.edgeY, middle: r.middle,
    kxMid: r.kxMid, kyMid: r.kyMid, flip: r.flip, maxSlope: r.maxSlope, E: r.E };
}

onmessage = e => {
  const { id, pieces, Lx, Ly, n } = e.data, t0 = Date.now(), runs = [];
  try {
    const N = pieces.length * 2;
    for (const pc of pieces) {
      const P = pc.plate, base = { Lx, Ly, A: P.A, D: P.D, nu: P.nu, h: P.h, kx: P.kS + P.kSet, ky: P.kS, n: n || 8 };
      postMessage({ id, progress: { k: runs.length * 2, n: N } });
      const free = shRun({ ...base, p: 0, table: false });
      postMessage({ id, progress: { k: runs.length * 2 + 1, n: N } });
      const table = shRun({ ...base, p: P.p, table: true });
      runs.push({ where: pc.where, free: sheetCompact(free), table: sheetCompact(table) });
    }
    postMessage({ id, ok: true, runs, ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
