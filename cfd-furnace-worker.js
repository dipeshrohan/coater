/*
 * cfd-furnace-worker.js — the pieces through the furnace (GO-5, furnace.js) off the main thread: the film shown, its
 * piece going in, the two runs; and the fits the measured graphene film gives (the puffed film's way out from its
 * thickness; the galleries' gas-tightness from the first run not puffing).
 *
 * Message in:  { id, kind: 'run', o } (o: fuRun's options)
 *              or { id, kind: 'fit', what: 'es' | 'Dgal', o, target (es: the thickness, m) }
 * Message out: { id, progress: { k, n } } while it works, then { id, ok: true, res, ms } (a fit: { value, res }) or
 *              { id, ok: false, error }.
 */
importScripts('furnace.js');

/** A run's result, compact: its history thinned (each run's highest gas kept), the thickness across the piece. */
function furnCompact(r, o) {
  const p = v => +(+v).toPrecision(5), K0 = FU_K0;
  const hist = [];
  for (let run = 0; run < r.runs.length; run++) {
    const h = r.hist.filter(q => q.run === run), step = Math.max(1, Math.ceil(h.length / 400));
    let kPeak = 0; h.forEach((q, i) => { if (q.idxMax > h[kPeak].idxMax) kPeak = i; });
    h.forEach((q, i) => {
      if (i % step && i !== h.length - 1 && i !== kPeak) return;
      hist.push({ run, t: p(q.t / 3600), T: p(q.T - K0), kept: p(q.kept * 100), CO: p(q.CO), g: p(q.g), d: p(q.d), hMid: p((q.hc + q.Vmid) * 1e6), hEdge: p((q.hc + q.Vedge) * 1e6),
        hc: p(q.hc * 1e6), idxMid: p(q.idxMid * 100), idxMax: p(q.idxMax * 100), hold: p(q.hold / 1e3), lifted: p(q.lifted * 100) });
    });
  }
  // (the thickness at the end across the piece: along its middle line from the middle out, and to its corner)
  const g = r.grid, nP = o.nP || 12, along = [], diag = [];
  for (let i = 0; i < nP; i++) along.push([p(g.cx[i] * 1000), p(r.thick[g.id(i, 0)] * 1e6)]);
  for (let i = 0; i < nP; i++) diag.push([p(Math.hypot(g.cx[i], g.cy[i]) * 1000), p(r.thick[g.id(i, i)] * 1e6)]);
  const map = []; for (let j = 0; j < nP; j++) { const row = []; for (let i = 0; i < nP; i++) row.push(p(r.thick[g.id(i, j)] * 1e6)); map.push(row); }
  const where = k => { if (k == null) return null; const i = k % g.nx, j = Math.floor(k / g.nx); return { x: p(g.cx[i] * 1000), y: p(g.cy[j] * 1000) }; };
  return { hist, along, diag, map, half: [o.Lx * 500, o.Ly * 500],
    runs: r.runs.map(q => ({ peak: { idx: q.peak.idx, T: q.peak.T - K0, t: q.peak.t / 3600, at: where(q.peak.k) }, puffAt: q.puffAt ? { T: q.puffAt.T - K0, t: q.puffAt.t / 3600 } : null, gasMax: q.gasMax, tEnd: q.tEnd / 3600, gas: q.gas })),
    end: { h: r.hMean, hMin: r.hMin, hMax: r.hMax, hSD: r.hSD, hc: r.hc, rho: r.rho, kappa: r.kappa, kept: r.kept, CO: r.CO, O: r.O, C: r.C, g: r.g, d: r.d, La: r.La, mA: r.mA, mEnd: r.mEnd },
    split1: r.chem.split1, stages: r.stages, graph: r.graph, plane: planeCompact(r.plane) };
}
/** The piece along itself (GO-5b), compact: its history thinned per run (the highest pull and squeeze kept), in h, °C, %, MPa. */
function planeCompact(pl) {
  if (!pl) return null;
  const p = v => v == null ? null : +(+v).toPrecision(5), K0 = FU_K0, at = q => q ? { run: q.run, t: p(q.t / 3600), T: p(q.T - K0), r: q.r != null ? p(q.r) : undefined } : null;
  const hist = [];
  for (let run = 0; run < 2; run++) {
    const h = pl.hist.filter(q => q.run === run), step = Math.max(1, Math.ceil(h.length / 400));
    let a = 0, b = 0; h.forEach((q, i) => { if (q.ratio > h[a].ratio) a = i; if (q.wave > h[b].wave) b = i; });
    h.forEach((q, i) => { if (i % step && i !== h.length - 1 && i !== a && i !== b) return;
      hist.push({ run, t: p(q.t / 3600), T: p(q.T - K0), eps: p(q.eps * 100), s1: p(q.s1 / 1e6), s2: p(q.s2 / 1e6), sc: p(q.sc / 1e6), sw: p(q.sw / 1e6), ratio: p(q.ratio * 100), wave: p(q.wave * 100), stuck: p(q.stuck * 100) }); });
  }
  return { hist, ratioMax: pl.ratioMax, where: at(pl.where), first: pl.first ? { ...at(pl.first), sc: pl.first.sc / 1e6, h: pl.first.h } : null, stuckAt: at(pl.stuckAt), stuckFrac: pl.stuckFrac,
    spacing: pl.spacing, waveMax: pl.waveMax, waveAt: pl.waveAt ? { ...at(pl.waveAt), lambda: pl.waveAt.lambda } : null, compMin: pl.compMin / 1e6, size: pl.size, R: pl.R,
    rings: { rm: pl.rings.rm.map(v => p(v / pl.R)), sr: pl.rings.sr.map(v => p(v / 1e6)), st: pl.rings.st.map(v => p(v / 1e6)) } };
}

onmessage = e => {
  const { id, kind, o } = e.data, t0 = Date.now();
  try {
    if (kind === 'fit') {
      const what = e.data.what, N = 24; let k = 0;
      const tick = () => postMessage({ id, progress: { k: Math.min(++k, N - 1), n: N } });
      let value;
      if (what === 'es') {
        // (the puffed film's way out that gives the measured thickness: the later its way out opens, the thicker the
        //  film; its direction from the two ends; bisection on its log)
        const at = es => { tick(); return fuRun({ ...o, es }).hMean; };
        let lo = Math.log(0.01), hi = Math.log(100);
        const hLo = at(Math.exp(lo)), hHi = at(Math.exp(hi)), target = e.data.target, up = hHi > hLo;
        if (!(target >= Math.min(hLo, hHi) && target <= Math.max(hLo, hHi))) throw new Error(`the thickness ${(target * 1e6).toFixed(1)} µm is outside what the puffing gives (${(Math.min(hLo, hHi) * 1e6).toFixed(1)}–${(Math.max(hLo, hHi) * 1e6).toFixed(1)} µm): not from the way out alone`);
        for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if ((at(Math.exp(m)) < target) === up) lo = m; else hi = m; }
        value = Math.exp((lo + hi) / 2);
      } else if (what === 'Dgal') {
        // (the least open-layer gas way that keeps the first run from puffing: the first run alone; bisection on its log)
        const one = { ...o, runs: o.runs.slice(0, 1) };
        const peak = D => { tick(); return fuRun({ ...one, Dgal: D }).runs[0].peak.idx; };
        let lo = Math.log(1e-14), hi = Math.log(1e-4);
        if (peak(Math.exp(hi)) >= 1) throw new Error('the first run puffs however open its layers are: its gas comes faster than the film can let it out');
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (peak(Math.exp(m)) >= 1) lo = m; else hi = m; }
        value = Math.exp(hi);
      } else throw new Error('unknown fit');
      const r = fuRun(what === 'es' ? { ...o, es: value } : { ...o, Dgal: value });
      postMessage({ id, ok: true, value, res: furnCompact(r, o), ms: Date.now() - t0 });
      return;
    }
    postMessage({ id, progress: { k: 0, n: 1 } });
    const r = fuRun(o);
    postMessage({ id, ok: true, res: furnCompact(r, o), ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
