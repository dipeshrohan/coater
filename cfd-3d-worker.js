/*
 * cfd-3d-worker.js — runs the 3D solve of Flow › 3D off the main thread: a strip across the web around
 * one location (cfd-fem3d.js's solveCoater3D: each station in 2D at its own gap and contact angle, then
 * the stations coupled in 3D).
 *
 * Message in: { id, msg: the 2D solve's message for the location (cfd-worker.js's, the mesh counts the
 *   3D's), strip: { width (m), nEz, gap: [[z, dH]...] (m, z from the location), th: [[z, deg]...] },
 *   file: null, or a blade read from a file: { xs, zs, low } (its underside height over the web at xs
 *   along the flow and zs across, m, z from the location) with msg.Xup its inlet distance }
 * Messages out: { id, progress: { stage, it, residual, path, r0, add, solves } } while solving (for the progress
 *   bars: path, how far along its continuation the Newton solve is; r0, the 3D solve's first residual; add and solves,
 *   a station's 2D solves as cfd-worker.js sends them), then { id, ok: true, result } or { id, ok: false, error }.
 * A wide region (the full web width): messages with type 'wideInit' / 'wideSolve' (below).
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

// A wide region (the full web width) is solved strip by strip across several of these workers: 'wideInit' solves the
// 2D at the stations this worker's strips need (and keeps their meshes), 'wideSolve' one strip in 3D with its
// neighbours' latest solution held on its inner sides. The page runs the sweeps (cfd-fem3d.js's solveCoaterWide, in parallel).
let WIDE = null;
/**
 * Progress messages (the page's bars, cfd-progress.js), at most one every `every` ms (a new stage at once): the stage, the
 * latest Newton step and residual and how far along its continuation it is; a station's 2D solves (their residuals since
 * the last message and the solves so far); the 3D solve's first residual.
 */
function progressPoster(id, every) {
  let last = 0, stage = '', t2 = null, sent = 0, r3 = NaN;
  const P = {
    stage: t => { stage = t; if (/^2D at /.test(t)) { t2 = { r: [], solves: [] }; sent = 0; } else if (/^3D/.test(t)) t2 = null; last = 0; P.post(0, NaN, null); },
    iter2: h => { if (t2 && Number.isFinite(h.residual)) t2.r.push(h.residual); P.post(h.it, h.residual, h.path ?? h.lambda ?? null); },
    solve2: label => { if (t2) t2.solves.push([label, t2.r.length]); },
    iter3: h => { if (!(r3 > 0) && Number.isFinite(h.residual)) r3 = h.residual; P.post(h.it, h.residual, h.path ?? h.lambda ?? null); },
    post: (it, residual, path) => {
      const t = Date.now();
      if (t - last < every) return;
      last = t;
      const p = { stage, it, residual, path };
      if (r3 > 0) p.r0 = r3;
      if (t2) { p.add = t2.r.slice(sent); sent = t2.r.length; p.solves = t2.solves.slice(); }
      postMessage({ id, progress: p });
    },
  };
  return P;
}
/** A blade read from a file: its underside at station z (along x from the rays, across z linear between the ray rows). */
function fileHAt(file) {
  const { xs, zs, low } = file, nz = zs.length;
  return z => {
    let k = 0; while (k < nz - 2 && zs[k + 1] < z) k++;
    const t = Math.min(1, Math.max(0, (z - zs[k]) / (zs[k + 1] - zs[k])));
    const row = xs.map((x, i) => [x, (1 - t) * low[i * nz + k] + t * low[i * nz + k + 1]]);
    return x => interp(row, x);
  };
}
function wideOpts(o, strip, file) {
  const law = gd => muEffLocal(gd, o.muRef, o.ty, o.n);
  const hAt = file ? fileHAt(file) : null, shape = file ? null : bladeShape(o);
  const hFn = file ? hAt(0) : shape.h, xe = file ? file.xs[file.xs.length - 1] : shape.Lx, H = hFn(xe);
  let I2 = 0, I3 = 0; const M = 4000;
  for (let k = 0; k < M; k++) { const h = hFn((k + 0.5) * xe / M); I2 += xe / M / (h * h); I3 += xe / M / (h * h * h); }
  const qLub = (o.Pup + 6 * o.muRep * o.U * I2) / (12 * o.muRep * I3), sv = o.solver;
  return { hFn, hAt, xe, faceDeg: o.exitAngle, contactDeg: o.contactDeg, U: o.U, Pup: o.Pup, rho: o.rho, g: o.g, gamma: o.gamma, mu: law, gdMin: 1e-3 * o.U / H,
    webSlip: o.webSlip || 0, Ld: Math.max(12e-3, (sv.ldGaps ?? 8) * H), nEb: sv.nEb, nEf: sv.nEf, nEs: sv.nEs, nEy: sv.nEy, gradeB: sv.gradeB, gradeS: sv.gradeS, gradeY: sv.gradeY,
    fInfGuess: qLub / o.U, tol: sv.tol, maxIter: sv.maxIter, dH: z => interp(strip.gap, z), contactAt: z => interp(strip.th, z), webW: o.webW || 0 };
}
const packStation = T => { const o = {}; for (const f of ['u', 'v', 'w', 'p', 'x', 'y', 'z', 'gd', 'mu', 'h']) if (T[f]) o[f] = Float64Array.from(T[f]); o.s = T.s; o.q = T.q; return o; };
function wide(e) {
  const d = e.data, id = d.id;
  if (d.type === 'wideInit') {
    const opts = wideOpts(d.msg, d.strip, d.file);
    const pp = progressPoster(id, 300);
    Object.assign(opts, { onStage: pp.stage, onIteration: pp.iter2, onSolveStart: pp.solve2 });
    const S = coaterStations(opts, d.zs, d.ref, new Set(d.stations));
    if (S.error) { postMessage({ id, ok: false, error: S.error }); return; }
    WIDE = { opts, S };
    const states = {};
    for (const l of d.stations) states[l] = packStation(stationState(S, l));
    // (each station's 2D positions, shear rate, viscosity, flow rate: a web edge held at its own station's flow -- a skewed
    // blade -- is never solved in 3D, and the result takes it from these)
    const full2 = {};
    for (const l of d.stations) { const r = S.r2[l]; full2[l] = { x: Float64Array.from(r.x), y: Float64Array.from(r.y), z: new Float64Array(r.x.length).fill(d.zs[l]), gd: Float64Array.from(r.gd), mu: Float64Array.from(r.mu), q: r.Q }; }
    postMessage({ id, ok: true, result: { states, full2, mode: S.mode, climbed: S.climbed, NC: S.NC, NR: S.NR, cCL: S.cCL, cCorner: S.cCorner, H: S.H, xe: WIDE.opts.xe,
      film2: Object.fromEntries(d.stations.map(l => [l, S.r2[l].Q / opts.U])), s2: Object.fromEntries(d.stations.map(l => [l, S.climbed ? S.r2[l].surface.s : 0])),
      top2: Object.fromEntries(d.stations.map(l => [l, Array.from({ length: S.NC }, (_, c) => S.r2[l].p[c * S.NR + S.NR - 1])])) } });
    return;
  }
  // wideSolve: one strip l0..l1; the states of its stations (the held sides among them)
  const { l0, l1, states, sideLo, sideHi } = d, state = [];
  for (let l = l0; l <= l1; l++) state[l] = states[l];
  const pp = progressPoster(id, 300);
  const opts = { ...WIDE.opts, onStage: null, onIteration: null, onSolveStart: null, onIteration3: pp.iter3 };
  const r3 = coaterStrip3D(opts, WIDE.S, l0, l1, state, sideLo, sideHi, { label: `strip ${l0}-${l1}` });
  if (!r3.converged) { postMessage({ id, ok: false, error: `the strip from station ${l0} to ${l1} did not converge (residual ${r3.residual.toExponential(1)})` }); return; }
  const out = {};
  for (let j = sideLo ? 1 : 0; j <= (sideHi ? l1 - l0 - 1 : l1 - l0); j++) out[l0 + j] = packStation(stationFrom3D(r3, j));
  postMessage({ id, ok: true, result: { states: out, iterations: r3.iterations, unknowns: r3.size.unknowns } });
}

onmessage = e => {
  if (e.data.type) { try { wide(e); } catch (err) { postMessage({ id: e.data.id, ok: false, error: err.message }); } return; }
  const { id, msg: o, strip, file } = e.data;
  try {
    const law = gd => muEffLocal(gd, o.muRef, o.ty, o.n);
    let hFn, hAt = null, xe;
    if (file) {
      hAt = fileHAt(file); xe = file.xs[file.xs.length - 1]; hFn = hAt(0);
    } else {
      const shape = bladeShape(o);
      hFn = shape.h; xe = shape.Lx;
    }
    const H = hFn(xe);
    // the lubrication flow rate at the middle (the 2D's starting guess for the film)
    let I2 = 0, I3 = 0; const M = 4000;
    for (let k = 0; k < M; k++) { const h = hFn((k + 0.5) * xe / M); I2 += xe / M / (h * h); I3 += xe / M / (h * h * h); }
    const qLub = (o.Pup + 6 * o.muRep * o.U * I2) / (12 * o.muRep * I3);
    const pp = progressPoster(id, 150);
    const sv = o.solver;
    const res = solveCoater3D({
      hFn, hAt, xe, faceDeg: o.exitAngle, contactDeg: o.contactDeg, U: o.U, Pup: o.Pup, rho: o.rho, g: o.g, gamma: o.gamma, mu: law, gdMin: 1e-3 * o.U / H,
      webSlip: o.webSlip || 0, Ld: Math.max(12e-3, (sv.ldGaps ?? 8) * H), nEb: sv.nEb, nEf: sv.nEf, nEs: sv.nEs, nEy: sv.nEy, gradeB: sv.gradeB, gradeS: sv.gradeS, gradeY: sv.gradeY,
      fInfGuess: qLub / o.U, tol: sv.tol, maxIter: sv.maxIter, webW: o.webW || 0,
      width: strip.width, nEz: strip.nEz, dH: z => interp(strip.gap, z), contactAt: z => interp(strip.th, z),
      onStage: pp.stage, onIteration: pp.iter2, onSolveStart: pp.solve2, onIteration3: pp.iter3,
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
