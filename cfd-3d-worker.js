/*
 * cfd-3d-worker.js — runs the 3D solve of Flow › 3D off the main thread: a strip across the web around
 * one location (cfd-fem3d.js's solveCoater3D: each station in 2D at its own gap and contact angle, then
 * the stations coupled in 3D).
 *
 * Message in: { id, msg: the 2D solve's message for the location (cfd-worker.js's, the mesh counts the
 *   3D's), strip: { width (m), nEz, gap: [[z, dH]...] (m, z from the location), th: [[z, deg]...] },
 *   file: null, or a blade read from a file: { xs, zs, low } (its underside height over the web at xs
 *   along the flow and zs across, m, z from the location) with msg.Xup its inlet distance }
 * Messages out: { id, progress: { stage, it, residual } } while solving, then { id, ok: true, result } or
 *   { id, ok: false, error }.
 */
importScripts('cfd-solver.js', 'cfd-gap-solver.js', 'cfd-fem.js', 'cfd-1d.js', 'cfd-fem3d.js');

/** Linear interpolation in a sorted table of [x, y]. */
function interp(tab, x) {
  if (x <= tab[0][0]) return tab[0][1];
  if (x >= tab[tab.length - 1][0]) return tab[tab.length - 1][1];
  let k = 1; while (tab[k][0] < x) k++;
  const [x0, y0] = tab[k - 1], [x1, y1] = tab[k];
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
}

onmessage = e => {
  const { id, msg: o, strip, file } = e.data;
  try {
    const law = gd => muEffLocal(gd, o.muRef, o.ty, o.n);
    let hFn, hAt = null, xe;
    if (file) {
      // the file's underside at station z: along x from the rays, across z linear between the ray rows
      const { xs, zs, low } = file, nz = zs.length;
      xe = xs[xs.length - 1];
      hAt = z => {
        let k = 0; while (k < nz - 2 && zs[k + 1] < z) k++;
        const t = Math.min(1, Math.max(0, (z - zs[k]) / (zs[k + 1] - zs[k])));
        const row = xs.map((x, i) => [x, (1 - t) * low[i * nz + k] + t * low[i * nz + k + 1]]);
        return x => interp(row, x);
      };
      hFn = hAt(0);
    } else {
      const shape = bladeShape(o);
      hFn = shape.h; xe = shape.Lx;
    }
    const H = hFn(xe);
    // the lubrication flow rate at the middle (the 2D's starting guess for the film)
    let I2 = 0, I3 = 0; const M = 4000;
    for (let k = 0; k < M; k++) { const h = hFn((k + 0.5) * xe / M); I2 += xe / M / (h * h); I3 += xe / M / (h * h * h); }
    const qLub = (o.Pup + 6 * o.muRep * o.U * I2) / (12 * o.muRep * I3);
    let last = 0, stage = '';
    const post = (it, residual) => { const t = Date.now(); if (t - last < 150) return; last = t; postMessage({ id, progress: { stage, it, residual } }); };
    const sv = o.solver;
    const res = solveCoater3D({
      hFn, hAt, xe, faceDeg: o.exitAngle, contactDeg: o.contactDeg, U: o.U, Pup: o.Pup, rho: o.rho, g: o.g, gamma: o.gamma, mu: law, gdMin: 1e-3 * o.U / H,
      webSlip: o.webSlip || 0, Ld: Math.max(12e-3, (sv.ldGaps ?? 8) * H), nEb: sv.nEb, nEf: sv.nEf, nEs: sv.nEs, nEy: sv.nEy, gradeB: sv.gradeB, gradeS: sv.gradeS, gradeY: sv.gradeY,
      fInfGuess: qLub / o.U, tol: sv.tol, maxIter: sv.maxIter,
      width: strip.width, nEz: strip.nEz, dH: z => interp(strip.gap, z), contactAt: z => interp(strip.th, z),
      onStage: t => { stage = t; last = 0; post(0, NaN); }, onIteration3: h => post(h.it, h.residual),
    });
    if (!res.r3) throw new Error(res.error || 'no solution');
    const r3 = res.r3, NL = r3.NL, NR = r3.NR, NC = r3.NC, mid = (NL - 1) / 2, r2m = res.r2[mid], m = r2m.meshDef;
    // along the top boundary at the middle station: the 3D and its 2D (pressure on the blade and face, the surface)
    const top = { x: [], y: [], p3: [], p2: [] };
    for (let c = 0; c < NC; c++) {
      const n3 = (c * NL + mid) * NR + NR - 1, n2 = c * NR + NR - 1;
      top.x.push(r3.x[n3]); top.y.push(r3.y[n3]); top.p3.push(r3.p[n3]); top.p2.push(r2m.p[n2]);
    }
    const f32 = a => Float32Array.from(a);
    const result = {
      mode: res.mode, converged: r3.converged, iterations: r3.iterations, residual: r3.residual, history: r3.history.map(h => h.residual),
      ms2: res.ms2, ms3: res.ms3, size: r3.size, NC, NR, NL, cCorner: m.cCorner, cCL: m.cCL, xe, H,
      stations: res.stations, top,
      x: f32(r3.x), y: f32(r3.y), z: f32(r3.z), u: f32(r3.u), v: f32(r3.v), w: f32(r3.w), p: f32(r3.p), gd: f32(r3.gd), mu: f32(r3.mu),
    };
    postMessage({ id, ok: true, result }, [result.x.buffer, result.y.buffer, result.z.buffer, result.u.buffer, result.v.buffer, result.w.buffer, result.p.buffer, result.gd.buffer, result.mu.buffer]);
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
