/*
 * cfd-sheet-worker.js — a cut piece of the film in 3D (GO-4d, sheet.js) off the main thread: the piece free (held up)
 * and lying on a table under its weight, for its film's two ways the water can leave; and (GO-4f, press.js) the pieces
 * pressed in the stack through the pre heat treatment and after it under the plate, and the piece let go out of the stack and
 * a day later.
 *
 * Message in:  { id, pieces: [{ where, plate: { A, D, nu, h, kS, kSet, p } }], Lx, Ly, n }
 *   (kS its settled natural curvature both ways, kSet the roll's set along the line; p its weight per area)
 *   or { id, kind: 'stack', pieces: [{ where, plate (film.js's, with its table by water) }], Lx, Ly,
 *   stack: { K, tau (s), tOven, tRest (s), psatOven, psatRoom (Pa) } }
 * Message out: { id, progress: { k, n } } while it works, then { id, ok: true, runs: [{ where, free, table }], ms }
 *              (or for the stack runs: [{ where, stack }]) or { id, ok: false, error }.
 */
importScripts('sheet.js', 'press.js');

/** A shape, compact: the heights on the grid (mm, rounded), the corners' and edges' heights, the middle's curvatures. */
function sheetCompact(r) {
  const p = v => +(+v).toPrecision(5);
  return { n: r.n, W: r.W.map(row => row.map(v => p(v * 1000))), corner: r.corner, edgeX: r.edgeX, edgeY: r.edgeY, middle: r.middle,
    kxMid: r.kxMid, kyMid: r.kyMid, flip: r.flip, maxSlope: r.maxSlope, E: r.E };
}

/**
 * A piece let go (shRelease on a quarter, n × n, even), compact as sheetCompact's: heights as the as-cut piece's (on a
 * table above it; held up off its middle), and its waves -- the crests along its ends and its sides (on the grid).
 */
function releaseCompact(q, n, table) {
  const W = q.W, c = n, e = 2 * n, hgt = v => table ? v : Math.abs(v - q.wMid), p = v => +(+v).toPrecision(5);
  const crests = row => { let k = 0; for (let i = 1; i < row.length - 1; i++) if (row[i] > row[i - 1] && row[i] >= row[i + 1] && row[i] - Math.min(...row) > 1e-6) k++; return k; };
  // (sign: drawn with its curl up -- held up, a piece curling away from its top is drawn top down, as the as-cut one)
  const sgn = table ? 1 : (q.kMean > 0 ? -1 : 1);
  return { n, W: W.map(row => row.map(v => p(v * 1000))), corner: hgt(W[e][e]), edgeX: hgt(W[c][e]), edgeY: hgt(W[e][c]), middle: table ? W[c][c] : 0, sign: sgn,
    flip: q.flip, maxSlope: q.maxSlope, E: q.E, high: q.high, crestsEnd: crests(W.map(row => sgn * row[e])), crestsSide: crests(W[e].map(v => sgn * v)), stable: q.stable };
}

/** The stack for one piece: its water and stress through the oven and under the plate, its size, and its shapes let go. */
function stackRun(P, Lx, Ly, S, tick) {
  const n = 8, tO = S.tOven, tR = S.tRest;
  const saveO = [60, 300, 900, 1800, tO].filter((t, i, a) => t <= tO && a.indexOf(t) === i), saveR = [600, 1800, tR].filter((t, i, a) => t <= tR && a.indexOf(t) === i);
  const stages = [{ tEnd: tO, psat: S.psatOven, aEdge: P.rhDry, creep: true, saveAt: saveO }];
  if (tR > 0) stages.push({ tEnd: tR, psat: S.psatRoom, aEdge: P.rhRoom, creep: false, saveAt: saveR });
  const r = prPress({ Lx, Ly, nx: 30, ny: 30, grade: 40, X0: P.Xcut, rhoS: P.rhoG, gab: P.gab, Xcap: P.Xcap, K: S.K, tab: P.tab, nu: P.nu, kSet: P.kSet, tau: S.tau, n, pgrade: 1, stages });
  tick();
  const p0 = prProps(P.tab, P.Xcut), last = r.stages[r.stages.length - 1], ng = last.Xg.length;
  // (the natural fields let go: its water as it is, the creep the stack left; the stretch from as cut)
  const gpOf = Xat => {
    const eb = new Float64Array(3 * ng), kb = new Float64Array(3 * ng), sA = new Float64Array(ng), sD = new Float64Array(ng);
    for (let g = 0; g < ng; g++) {
      const q = prProps(P.tab, Xat(g)), kn = [q[4] + P.kSet, q[4], 0];
      sA[g] = q[1] / p0[1]; sD[g] = q[2] / p0[2];
      for (let c = 0; c < 3; c++) { eb[3 * g + c] = (c < 2 ? q[3] - p0[3] : 0) + last.ec[3 * g + c]; kb[3 * g + c] = kn[c] + last.kc[3 * g + c]; }
    }
    return { eb, kb, sA, sD };
  };
  const out = gpOf(g => last.Xg[g]), day = gpOf(() => P.Xroom);
  // (a day later, pressed flat: its size -- the creep's mean with the room's water)
  const fl = shFlat(r.m, { A: p0[1], nu: P.nu, eb: day.eb, sA: day.sA });
  const sizeDay = [2 * fl.d[r.m.id(r.m.nx, 0) * 12] / Lx, 2 * fl.d[r.m.id(0, r.m.ny) * 12 + 4] / Ly];
  const shapes = {};
  for (const [k, gp] of [['out', out], ['day', day]]) for (const table of [false, true]) {
    const q = shRelease({ Lx, Ly, A: p0[1], D: p0[2], nu: P.nu, p: P.p, table, h: P.h, n, grade: 1, sym: 'ee', gp });
    shapes[k + (table ? 'Table' : 'Free')] = releaseCompact(q, n, table);
    tick();
  }
  // (the water: its mean and the middle's through time, the profiles along the middle line from the edge in; the stress)
  const p4 = v => +(+v).toPrecision(4), thin = (a, k) => a.filter((_, i) => i % Math.max(1, Math.ceil(a.length / k)) === 0 || i === a.length - 1);
  let t0 = 0; const mean = [], prof = [];
  r.stages.forEach((st, si) => {
    for (const [t, X] of st.dry.mean) mean.push([p4((t0 + t) / 60), p4(X)]);
    for (const sv of st.dry.saved) prof.push({ stage: si, t: p4((t0 + sv.t) / 60), x: [...st.dry.cx.map(c => p4((Lx / 2 - c) * 1000)), 0], X: [...Array.from({ length: st.dry.nx }, (_, i) => p4(sv.X[i])), p4(st.dry.XE)] });
    t0 += st.dry.t;
  });
  const hist = thin(r.hist, 160).map(q => ({ t: p4(q.t / 60), stage: q.stage, MPa: p4(q.N / P.h / 1e6), Xmid: p4(q.Xmid), size: p4(q.sizeX) }));
  const dryTo = P.Xdry + 0.1 * (P.Xcut - P.Xdry), dryAt = r.hist.find(q => q.stage === 0 && q.Xmid <= dryTo);
  return { mean: thin(mean, 200), prof, hist, peak: { MPa: r.peak.N / P.h / 1e6, t: r.peak.t / 60, x: r.peak.x, y: r.peak.y, stage: r.peak.stage },
    dryThrough: dryAt ? dryAt.t / 60 : null, Xend: r.stages.map(st => st.dry.mean[st.dry.mean.length - 1][1]), XmidEnd: r.stages.map(st => st.dry.X[0]),
    sizeOut: [last.sizeX, last.sizeY], sizeDay, shapes, rest: tR > 0,
    // (its natural curl near the middle, along the line and across, as cut and after the stack's creep)
    curl: { cut: [p0[4] + P.kSet, p0[4]], out: [out.kb[0], out.kb[1]], day: [day.kb[0], day.kb[1]] } };
}

onmessage = e => {
  const { id, pieces, Lx, Ly, n } = e.data, t0 = Date.now(), runs = [];
  try {
    if (e.data.kind === 'stack') {
      const N = pieces.length * 5; let k = 0;
      const tick = () => postMessage({ id, progress: { k: Math.min(++k, N - 1), n: N } });
      postMessage({ id, progress: { k: 0, n: N } });
      for (const pc of pieces) runs.push({ where: pc.where, stack: stackRun(pc.plate, Lx, Ly, e.data.stack, tick) });
      postMessage({ id, ok: true, runs, ms: Date.now() - t0 });
      return;
    }
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
