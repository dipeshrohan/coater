/*
 * cfd-furnace-worker.js — the pieces through the furnace (GO-5, furnace.js) off the main thread: the film shown, its
 * piece going in, the two runs; and the fits the measured graphene film gives (the puffed film's way out from its
 * thickness; the galleries' gas-tightness from the first run not puffing).
 *
 * Message in:  { id, kind: 'run', o } (o: fuRun's options)
 *              or { id, kind: 'fit', what: 'es' | 'Dgal' | 'pSt', o, target (es: the thickness, m; pSt: the first
 *              piece stuck from the top, 1 for the top) }
 * Message out: { id, progress: { k, n } } while it works, then { id, ok: true, res, ms } (a fit: { value, res }) or
 *              { id, ok: false, error }.
 */
importScripts('../engine/furnace.js');

/** A run's result, compact: the first piece's (the top) as before, every piece followed in pos, the stack's spread in batch. */
function furnCompact(r, o) {
  const top = furnPieceCompact(r, r, o);
  // (each piece's faces, GO-7e: 'plate' where it touches the holder's plate)
  top.pos = (r.pos || [r]).map(q => ({ m: q.m || 0, w: q.w == null ? 1 : q.w, load: q.load, faces: q.faces || null, ...furnPieceCompact(q, r, o) }));
  top.batch = r.batch || { hMean: r.hMean, hSD: r.hSD, faces: 1 };   // (over the stacks too, when the load's spread was given)
  // (the holder's squeeze once the stack fills its room: MPa, from when, °C; GO-7c)
  top.squeeze = r.squeeze ? { max: r.squeeze.max / 1e6, from: r.squeeze.from ? { run: r.squeeze.from.run, T: r.squeeze.from.T - FU_K0 } : null } : null;
  return top;
}
/** A piece's result, compact: its history thinned (each run's highest gas kept), the thickness across it; r the run's shared parts. */
function furnPieceCompact(q, r, o) {
  const p = v => +(+v).toPrecision(5), K0 = FU_K0;
  const hist = [];
  for (let run = 0; run < q.runs.length; run++) {
    const h = q.hist.filter(x => x.run === run), step = Math.max(1, Math.ceil(h.length / 400));
    let kPeak = 0; h.forEach((x, i) => { if (x.idxMax > h[kPeak].idxMax) kPeak = i; });
    h.forEach((x, i) => {
      if (i % step && i !== h.length - 1 && i !== kPeak) return;
      hist.push({ run, t: p(x.t / 3600), T: p(x.T - K0), kept: p(x.kept * 100), CO: p(x.CO), g: p(x.g), d: p(x.d), hMid: p((x.hc + x.Vmid) * 1e6), hEdge: p((x.hc + x.Vedge) * 1e6),
        hc: p(x.hc * 1e6), idxMid: p(x.idxMid * 100), idxMax: p(x.idxMax * 100), hold: p(x.hold / 1e3), lifted: p(x.lifted * 100) });
    });
  }
  // (the thickness at the end across the piece: along its middle line from the middle out, and to its corner)
  const g = r.grid, nP = o.nP || 12, along = [], diag = [];
  for (let i = 0; i < nP; i++) along.push([p(g.cx[i] * 1000), p(q.thick[g.id(i, 0)] * 1e6)]);
  for (let i = 0; i < nP; i++) diag.push([p(Math.hypot(g.cx[i], g.cy[i]) * 1000), p(q.thick[g.id(i, i)] * 1e6)]);
  const map = []; for (let j = 0; j < nP; j++) { const row = []; for (let i = 0; i < nP; i++) row.push(p(q.thick[g.id(i, j)] * 1e6)); map.push(row); }
  const where = k => { if (k == null) return null; const i = k % g.nx, j = Math.floor(k / g.nx); return { x: p(g.cx[i] * 1000), y: p(g.cy[j] * 1000) }; };
  return { hist, along, diag, map, half: [o.Lx * 500, o.Ly * 500],
    runs: q.runs.map(x => ({ peak: { idx: x.peak.idx, T: x.peak.T - K0, t: x.peak.t / 3600, at: where(x.peak.k) }, puffAt: x.puffAt ? { T: x.puffAt.T - K0, t: x.puffAt.t / 3600 } : null, gasMax: x.gasMax, tEnd: x.tEnd / 3600, gas: x.gas })),
    end: { h: q.hMean, hMin: q.hMin, hMax: q.hMax, hSD: q.hSD, hc: r.hc, rho: q.rho, kappa: q.kappa, kept: r.kept, CO: r.CO, O: r.O, C: r.C, g: r.g, d: r.d, La: r.La, mA: r.mA, mEnd: r.mEnd },
    split1: r.chem.split1, stages: r.stages, graph: r.graph, plane: planeCompact(q.plane) };
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
  return { hist, ratioMax: pl.ratioMax, where: at(pl.where), pcHalf: pl.pcHalf / 1e3, pcHotMax: pl.pcHotMax / 1e3, first: pl.first ? { ...at(pl.first), sc: pl.first.sc / 1e6, h: pl.first.h } : null, stuckAt: at(pl.stuckAt), stuckFrac: pl.stuckFrac,
    // (stuck to the holder's plate, GO-7e; its steps' balance)
    stuckPlAt: at(pl.stuckPlAt), stuckPlFrac: pl.stuckPlFrac == null ? null : pl.stuckPlFrac, stuckPaFrac: pl.stuckPaFrac == null ? null : pl.stuckPaFrac, resMax: pl.resMax || 0,
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
        //  (the thickness the batch's: its pieces' mean; regula falsi, Illinois, on log es: a few runs, not twenty)
        const at = es => { tick(); const r = fuRun({ ...o, es }); return r.batch ? r.batch.hMean : r.hMean; };
        let lo = Math.log(0.01), hi = Math.log(100);
        const target = e.data.target;
        let fLo = at(Math.exp(lo)) - target, fHi = at(Math.exp(hi)) - target;
        if (fLo * fHi > 0) { const a_ = fLo + target, b_ = fHi + target; throw new Error(`the thickness ${(target * 1e6).toFixed(1)} µm is outside what the puffing gives (${(Math.min(a_, b_) * 1e6).toFixed(1)}–${(Math.max(a_, b_) * 1e6).toFixed(1)} µm): not from the way out alone`); }
        let m = (lo + hi) / 2, side = 0;
        for (let i = 0; i < 40; i++) {
          m = (lo * fHi - hi * fLo) / (fHi - fLo);
          if (!(m > Math.min(lo, hi) && m < Math.max(lo, hi))) m = (lo + hi) / 2;
          const fm = at(Math.exp(m)) - target;
          if (Math.abs(fm) <= 1e-5 * target || Math.abs(hi - lo) < 1e-6) break;
          if (fm * fHi > 0) { hi = m; fHi = fm; if (side === 1) fLo /= 2; side = 1; }
          else { lo = m; fLo = fm; if (side === -1) fHi /= 2; side = -1; }
        }
        value = Math.exp(m);
      } else if (what === 'Dgal') {
        // (the least open-layer gas way that keeps the first run from puffing: the first run alone; bisection on its log)
        //  (the top piece alone: under the least load it is the first to puff, so it keeping from puffing keeps them all)
        const one = { ...o, runs: o.runs.slice(0, 1), positions: [{ m: 0, w: 1 }] };
        const peak = D => { tick(); return fuRun({ ...one, Dgal: D }).runs[0].peak.idx; };
        let lo = Math.log(1e-14), hi = Math.log(1e-4);
        if (peak(Math.exp(hi)) >= 1) throw new Error('the first run puffs however open its layers are: its gas comes faster than the film can let it out');
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (peak(Math.exp(m)) >= 1) lo = m; else hi = m; }
        value = Math.exp(hi);
      } else if (what === 'pSt') {
        // (the pressure a piece sticks from, from the first piece found stuck from the top (GO-7c): a run with that piece
        //  and the one above it followed too (no share in the batch); each's pressure once hot over half its area --
        //  sticking does not act back on the gas, so one run gives them -- and any pressure between them sticks that
        //  piece and not the one above: the middle of the two)
        const nth = Math.round(e.data.target), N = Math.max(1, Math.round(o.N || 1)), ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
        if (!(nth >= 1 && nth <= N)) throw new Error(`the piece ${nth} is not in a stack of ${N}`);
        if (nth === 1) value = 0;   // (the top stuck: every piece is, wherever pressed)
        else {
          tick();
          const P = o.positions || [{ m: 0, w: 1 }], r = fuRun({ ...o, positions: [...P, { m: nth - 2, w: 0 }, { m: nth - 1, w: 0 }] });
          const [a, b] = r.pos.slice(-2).map(q => q.plane.pcHalf), t = r.pos[0], wb = r.pos[r.pos.length - 1].load;
          // (the stuck piece pressed harder than the top by at least half the weight between them: less, and what
          //  presses them all -- the holder squeezing the stack -- drowns their weights, and no pressure found would mean
          //  anything. Next to each other two pieces differ by a piece's weight, a few pascals, near the model's own
          //  resolution: the pressure is theirs, to a piece or two)
          if (!(b - t.plane.pcHalf > 0.5 * (wb - t.load))) throw new Error(r.squeeze && r.squeeze.max > 0
            ? `the stack fills its room and the holder squeezes every piece alike (${(r.squeeze.max / 1e6).toFixed(2)} MPa): no pressure sticks the ${ord(nth)} and not the pieces above it: is there a gap left above your stack?`
            : `the ${ord(nth)} piece is pressed no harder than the top one once hot: no pressure sticks it and not the pieces above it`);
          value = b > a ? (a + b) / 2 : b * (1 - 1e-9);
          e.data.range = [Math.min(a, b), b];
        }
      } else throw new Error('unknown fit');
      const r = fuRun(what === 'es' ? { ...o, es: value } : what === 'pSt' ? { ...o, plane: { ...o.plane, pStick: value } } : { ...o, Dgal: value });
      postMessage({ id, ok: true, value, range: e.data.range || null, res: furnCompact(r, o), ms: Date.now() - t0 });
      return;
    }
    postMessage({ id, progress: { k: 0, n: o.loadSpread > 0 ? 3 : 1 } });
    // (with the load's temperature spread, its coldest and hottest stacks too: GO-7)
    const r = fuRunLoad(o, (k, n) => postMessage({ id, progress: { k, n } })), res = furnCompact(r, o);
    if (r.stacks) {
      const C = s => ({ ...s, pos: s.pos.map(p => ({ ...p, puffAt: p.puffAt.map(T => T == null ? null : T - FU_K0), stuckT: p.stuckT == null ? null : p.stuckT - FU_K0 })) });
      res.stacks = { spread: r.stacks.spread, cold: C(r.stacks.cold), mid: C(r.stacks.mid), hot: C(r.stacks.hot) };
    }
    postMessage({ id, ok: true, res, ms: Date.now() - t0 });
  } catch (err) {
    postMessage({ id, ok: false, error: err.message });
  }
};
