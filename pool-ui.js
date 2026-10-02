'use strict';
/*
 * pool-ui.js — Coating › 2D › Pool and feed and Coating › 3D › Pool and feed: the pool behind the blade through a pulse
 * cycle, in 2D (a slice along the web, the feed a band across it: the whole width's per width) and in 3D (the whole pool
 * between the side plates, each outlet's stream). Solved on request in a worker (cfd-pool-worker.js: feed-pool.js on
 * feed-fem.js) from the 1D's cycle (Coating › 1D › Pool and feed: the level during a pulse and between, the paste the web
 * carries away) and the feed's inputs, with the paste's own law. The page: the section through an outlet (the paste's
 * speed or pressure, its direction, the paths from the landing), from above in 3D (the paths across the web), the time
 * and height at which the paste reaches the pool edge, the speed across the pool edge, the pressure along the top.
 */
const poolNew = () => ({ key: null, pending: null, res: null, base: null, busy: false, again: false, error: null, worker: null, id: 0, prog: null, ms: 0, t0: 0 });
const POOL = { 2: poolNew(), 3: poolNew(), state: 0, show: 'speed', outlet: 0 };
/** The outlets' colours: the app's categorical slots in a fixed order (locations', then the cut lines'), repeating dashed. */
const poolColor = j => { const d = isDarkTheme() ? 'dark' : 'light', all = [...LOC_COLORS[d], ...CUT_COLORS[d]]; return all[j % all.length]; };
/** A chart's aspect on the pool pages: the section above takes the viewport, so the charts keep their own height (the page scrolls). */
const poolAspect = cv => Math.max(0.42, fitAspect(cv, 0.55));
/** The pulse marks on a time axis: 1, 2, 4, 8 … pulses, each at least an eighth of the axis from the last (their labels clear). */
function poolPulseLines(T, x1) {
  const out = [];
  for (let k = 1; k * T < x1; k *= 2) if (!out.length || (k * T - out[out.length - 1].x) >= x1 / 8) out.push({ x: k * T, c: cssVar('--muted'), t: `${k} pulse${k > 1 ? 's' : ''}` });
  return out;
}
const poolDash = j => (j >= 8 ? [5, 3] : []);

/** The pool's inputs for the 2D (2) or the 3D (3): the 1D's cycle (the levels, the web's paste), the feed's inputs, the
 *  paste's law at location 1 (the pool is one paste); null until the 1D is solved. */
function poolBase(dim) {
  if (typeof ONE_D === 'undefined' || !ONE_D.res || typeof feedNow !== 'function') return null;
  const F = feedNow();
  if (!F || F.error) return null;
  const { c, o, zs, out } = F, g = cfdGeometry(0);
  // (each part's mean level: the pulse's, between pulses')
  const mean = (a, b) => { let s = 0, d = 0; for (let i = 1; i < c.t.length; i++) if (c.t[i] > a + 1e-12 && c.t[i] <= b + 1e-12) { const dt = c.t[i] - c.t[i - 1]; s += dt * (c.h[i] + c.h[i - 1]) / 2; d += dt; } return d ? s / d : c.hBar; };
  const mesh = dim === 2 ? { hFine: P.f2H / 1000, hMax: P.f2Hm / 1000, ny: P.f2Ny } : { hFine: P.f3H / 1000, hMax: P.f3Hm / 1000, ny: P.f3Ny };
  return { dim, W: o.W, xBack: o.xBack, xEnd: g.Xup, R: F.round ? o.R : 0, H: o.H, rho: o.rho, g: o.g, U: o.U,
    law: { muRef: g.muRef, ty: g.ty || 0, n: g.n ?? 1, ...(g.rheoX ? { rheoX: g.rheoX } : {}) },
    // (the landing's radius: the stream's at landing, the smooth disc's half-height radius)
    outlets: zs.map(z => ({ x: -P.fX / 1000, z: z / 1000 })), r: out.dLand / 2 / 0.5412, Qin: o.V / o.tau, Qout: c.Qmean,
    hP: mean(0, o.tau), hD: mean(o.tau, c.T), T: c.T, tau: o.tau, mesh };
}
const poolKeyNow = dim => { const b = poolBase(dim); return b ? JSON.stringify(b) : null; };
const poolCurrent = dim => !!POOL[dim].res && POOL[dim].key === poolKeyNow(dim);
function poolStop(dim) {
  for (const d of dim ? [dim] : [2, 3]) { const S = POOL[d]; if (S.worker) { S.worker.terminate(); S.worker = null; } Object.assign(S, { busy: false, again: false, pending: null, prog: null }); }
}
/** Solve the pool for the inputs as they are (only when asked for: its Solve button, Re-solve). */
function poolRequest(dim) {
  const S = POOL[dim], id = 'pool' + dim, base = poolBase(dim);
  if (!base) return;
  const key = JSON.stringify(base);
  if (key === S.key || key === S.pending) { solveTake(id); return; }
  if (!solveMay(id)) return;
  if (S.busy) { S.again = true; return; }
  solveTake(id);
  Object.assign(S, { busy: true, again: false, pending: key, prog: null, t0: performance.now() });
  if (!S.worker) S.worker = makeWorker('cfd-pool-worker.js');
  const n = ++S.id;
  S.worker.onmessage = e => {
    const m = e.data;
    if (m.id !== n) return;
    if (m.progress) { S.prog = m.progress; poolProgPaint(dim); return; }
    Object.assign(S, { busy: false, pending: null, key, prog: null });
    if (m.ok) Object.assign(S, { res: m.res, base, error: null, ms: m.ms }); else Object.assign(S, { res: null, error: m.error });
    if (S.again) poolRequest(dim);
    if (tab === 16 || tab === 17) render();
  };
  S.worker.onerror = e => { Object.assign(S, { busy: false, pending: null, key, res: null, prog: null, error: e.message || 'the pool\'s worker failed' }); if (tab === 16 || tab === 17) render(); };
  S.worker.postMessage({ id: n, o: base });
}
/** While it solves: the status line's progress (without redrawing the page). */
function poolProgPaint(dim) {
  const el = document.getElementById('plProg');
  if (!el || tab !== (dim === 2 ? 16 : 17)) return;
  const p = POOL[dim].prog;
  el.innerHTML = p ? `${p.text} · ${Math.round(p.f * 100)} % · ${Math.round((performance.now() - POOL[dim].t0) / 1000)} s` : '';
}

// ---- the solved fields: a section, the top, the pool edge ----
/** The node (i, j, k) of a solved state. */
const plId = (I, i, j, k) => (k * I.NY + j) * I.NX + i;
/** The section shown: the plane of nodes nearest the outlet shown (3D), the slice's middle (2D); corner nodes when even. */
function poolPlane(res, even) {
  const I = res.states[0].info;
  if (res.dim === 2) return even ? 0 : 1;
  const outs = (POOL[3].base || poolBase(3) || { outlets: [{ z: I.W / 2 }] }).outlets, z = outs[Math.min(POOL.outlet, outs.length - 1)].z;
  let best = 0; for (let k = 0; k < I.NZ; k += even ? 2 : 1) if (Math.abs(res.states[0].Z[plId(I, 0, 0, k)] - z) < Math.abs(res.states[0].Z[plId(I, 0, 0, best)] - z)) best = k;
  return best;
}
/** The paste's speed (mm/s) or its pressure over the pool's weight (Pa) at node n of a state. */
const poolVal = (s, n, rhoG) => (POOL.show === 'pressure' ? s.p[n] - rhoG * (s.info.h - s.Y[n]) : 1e3 * Math.hypot(s.u[n], s.v[n], s.w[n]));

/** The section through the outlet shown (true scale): the field, its direction, the blade, the web, the stream, the paths. */
function poolSectionDraw(cv, res, base) {
  const s = res.states[POOL.state], I = s.info, NX = I.NX, NY = I.NY, k = poolPlane(res, POOL.show === 'pressure');
  const x0 = -I.xBack, x1 = -I.xEnd, topMax = Math.max(...Array.from({ length: NX }, (_, i) => s.Y[plId(I, i, NY - 1, k)]));
  const yMax = Math.max(topMax * 1.12, (base.R > 0 ? 1.18 : 1.05) * I.h);
  const mL = 48, mR = 14, mT = 14, mB = 56, w0 = (cv.parentElement.clientWidth || 800), sc = (w0 - mL - mR) / (x1 - x0);
  const { c, w, h } = setupCanvas(cv, (yMax * sc + mT + mB) / w0);
  const X = x => mL + (x - x0) * sc, Y = y => h - mB - y * sc, rhoG = base.rho * base.g;
  const ink = cssVar('--ink'), muted = cssVar('--muted'), surf = cssVar('--surface');
  // (the field: each pixel from its column of nodes, bilinear between them; sampled by corner nodes for the pressure)
  const st = POOL.show === 'pressure' ? 2 : 1, cols = [], val = (i, j) => poolVal(s, plId(I, i, j, k), rhoG);
  for (let i = 0; i < NX; i += st) cols.push(i);
  let vmin = Infinity, vmax = -Infinity;
  for (const i of cols) for (let j = 0; j < NY; j += st) { const v = val(i, j); if (Number.isFinite(v)) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); } }
  const pres = POOL.show === 'pressure', lim = Math.max(Math.abs(vmin), Math.abs(vmax), 1e-9);
  const scl = pres ? { min: -lim, max: lim } : { min: Math.max(vmax * 1e-3, 1e-3), max: Math.max(vmax, 1e-3), log: true }, lut = getLut(pres ? 'div' : 'seq');
  const W = Math.ceil(X(x1) - X(x0)), Hh = Math.ceil(Y(0) - Y(yMax)), off = document.createElement('canvas'); off.width = W; off.height = Hh;
  const oc = off.getContext('2d'), img = oc.createImageData(W, Hh);
  const XN = cols.map(i => s.X[plId(I, i, 0, k)]);
  for (let px = 0; px < W; px++) {
    const x = x0 + (px + 0.5) / sc;
    let a = 0; while (a < XN.length - 2 && XN[a + 1] < x) a++;
    const t = Math.min(1, Math.max(0, (x - XN[a]) / (XN[a + 1] - XN[a]))), ia = cols[a], ib = cols[a + 1];
    const top = (1 - t) * s.Y[plId(I, ia, NY - 1, k)] + t * s.Y[plId(I, ib, NY - 1, k)];
    for (let py = 0; py < Hh; py++) {
      const y = yMax - (py + 0.5) / sc; if (y < 0 || y > top) continue;
      const sg = y / top; let j = 0; while (j < NY - 1 - st && s.Y[plId(I, ia, j + st, k)] / s.Y[plId(I, ia, NY - 1, k)] < sg) j += st;
      const ya = s.Y[plId(I, ia, j, k)] / s.Y[plId(I, ia, NY - 1, k)], yb = s.Y[plId(I, ia, j + st, k)] / s.Y[plId(I, ia, NY - 1, k)], u = Math.min(1, Math.max(0, (sg - ya) / (yb - ya)));
      const v = (1 - t) * (1 - u) * val(ia, j) + t * (1 - u) * val(ib, j) + (1 - t) * u * val(ia, j + st) + t * u * val(ib, j + st);
      if (!Number.isFinite(v)) continue;
      const q = Math.round(scaleT(scl, v) * (LUT_N - 1)) * 3, o = (py * W + px) * 4;
      img.data[o] = lut[q]; img.data[o + 1] = lut[q + 1]; img.data[o + 2] = lut[q + 2]; img.data[o + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0); c.drawImage(off, X(x0), Y(yMax), W, Hh);
  // the direction (in the section's plane): arrows on a grid, the same length
  if (!pres) {
    const step = 26;
    for (let py = Y(yMax) + step / 2; py < Y(0) - 4; py += step) for (let px = X(x0) + step / 2; px < X(x1) - 4; px += step) {
      const x = x0 + (px - mL) / sc, y = (h - mB - py) / sc;
      let a = 0; while (a < NX - 2 && s.X[plId(I, a + 1, 0, k)] < x) a++;
      const top = s.Y[plId(I, a, NY - 1, k)]; if (y > top * 0.97) continue;
      let j = 0; while (j < NY - 2 && s.Y[plId(I, a, j + 1, k)] < y) j++;
      const n = plId(I, a, j, k), ux = s.u[n], uy = s.v[n], m = Math.hypot(ux, uy); if (!(m > 0)) continue;
      drawVectorArrow(c, px - 7 * ux / m, py + 7 * uy / m, px + 7 * ux / m, py - 7 * uy / m, '#ffffff', 'rgba(0,0,0,.35)', 4);
    }
  }
  // the blade over the pool (its face down to the pool edge), the web, the top, the pool edge
  if (base.R > 0) {
    c.beginPath(); c.moveTo(X(x1), Y(yMax));
    const xJ = I.xJ;
    for (let q = 0; q <= 60; q++) { const x = x1 + (xJ - x1) * q / 60; c.lineTo(X(x), Y(Math.min(yMax, base.H + base.R - Math.sqrt(Math.max(0, base.R * base.R - x * x))))); }
    c.lineTo(X(xJ), Y(yMax)); c.closePath(); c.fillStyle = cssVar('--blade'); c.fill();
  }
  c.strokeStyle = ink; c.lineWidth = 2.2; c.beginPath(); c.moveTo(X(x0) - 6, Y(0)); c.lineTo(X(x1) + 6, Y(0)); c.stroke();
  c.lineWidth = 1.2; c.beginPath(); for (let i = 0; i < NX; i++) { const n = plId(I, i, NY - 1, k); i ? c.lineTo(X(s.X[n]), Y(s.Y[n])) : c.moveTo(X(s.X[n]), Y(s.Y[n])); } c.stroke();
  c.setLineDash([5, 4]); c.strokeStyle = muted; c.beginPath(); c.moveTo(X(x1), Y(0)); c.lineTo(X(x1), Y(yMax)); c.stroke(); c.setLineDash([]);
  // the stream (during a pulse), the outlet shown
  const ox = base.outlets[0].x;
  if (POOL.state === 0) { c.strokeStyle = cssVar('--warn'); c.lineWidth = 2; c.beginPath(); c.moveTo(X(ox), Y(yMax)); c.lineTo(X(ox), Y(I.h) - 3); c.stroke();
    c.beginPath(); c.moveTo(X(ox), Y(I.h) - 1); c.lineTo(X(ox) - 4, Y(I.h) - 8); c.lineTo(X(ox) + 4, Y(I.h) - 8); c.closePath(); c.fillStyle = cssVar('--warn'); c.fill(); }
  // the paths from the landing (the outlet shown; the 2D's all)
  for (const p of res.paths) {
    if (res.dim === 3 && p.outlet !== POOL.outlet) continue;
    c.beginPath();
    for (let q = 0; q < p.pts.length; q += 4) { const px = X(p.pts[q]), py = Y(p.pts[q + 1]); q ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.globalAlpha = 0.75; c.strokeStyle = surf; c.lineWidth = 3.4; c.stroke(); c.globalAlpha = 1;
    c.strokeStyle = cssVar('--ink'); c.lineWidth = 1.3; c.setLineDash(poolDash(p.outlet)); c.stroke(); c.setLineDash([]);
    if (p.out) { const L = p.pts.length - 4; c.beginPath(); c.arc(X(p.pts[L]), Y(p.pts[L + 1]), 4, 0, 7); c.fillStyle = poolColor(p.outlet); c.fill(); c.lineWidth = 1.5; c.strokeStyle = surf; c.stroke(); c.beginPath(); c.arc(X(p.pts[L]), Y(p.pts[L + 1]), 5.5, 0, 7); c.lineWidth = 1; c.strokeStyle = cssVar('--ink'); c.stroke(); }
  }
  // axes: mm along the web and up
  c.fillStyle = muted; c.font = '11px ' + cssVar('--mono'); c.textAlign = 'center';
  for (const v of niceTicks(x0 * 1e3, x1 * 1e3, 6)) { if (v / 1e3 < x0 - 1e-9 || v / 1e3 > x1 + 1e-9) continue; c.fillText(String(+v.toPrecision(6)), X(v / 1e3), Y(0) + 15); }
  c.textAlign = 'right'; for (const v of niceTicks(0, yMax * 1e3, 4)) if (v / 1e3 <= yMax) c.fillText(String(+v.toPrecision(6)), mL - 6, Y(v / 1e3) + 4);
  c.textAlign = 'left'; c.fillText('x along the web (mm, 0 at the metering edge)', mL, Y(0) + 30); c.save(); c.translate(12, Y(yMax / 2)); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('y (mm)', 0, 0); c.restore();
  // the colour scale
  const bx = Math.max(mL, w - mR - 260), by = h - 16, bw = 180;
  for (let q = 0; q < bw; q++) { c.fillStyle = lutColor(lut, q / (bw - 1)); c.fillRect(bx + q, by - 8, 1, 8); }
  c.fillStyle = muted; c.textAlign = 'right'; c.fillText(pres ? `${(-lim).toPrecision(2)}` : `${scl.min.toPrecision(2)}`, bx - 4, by);
  c.textAlign = 'left'; c.fillText(pres ? `+${lim.toPrecision(2)} Pa` : `${scl.max.toPrecision(3)} mm/s`, bx + bw + 4, by);
  return { k, z: s.Z[plId(I, 0, 0, k)], vmax, lim };
}

/** The pool from above (3D): the side plates, the back edge, where the top meets the blade, the pool edge; each outlet and
 *  the paths from it (the web runs down the page). */
function poolPlanDraw(cv, res, base) {
  const I = res.states[0].info, x0 = -I.xBack, x1 = -I.xEnd, W = I.W, w0 = cv.parentElement.clientWidth || 600;
  const mL = 46, mR = 12, mT = 12, mB = 40, sc = (w0 - mL - mR) / W, { c, w, h } = setupCanvas(cv, ((x1 - x0) * sc + mT + mB) / w0);
  const Xp = z => mL + z * sc, Yp = x => mT + (x - x0) * sc, ink = cssVar('--ink'), muted = cssVar('--muted'), surf = cssVar('--surface');
  c.fillStyle = cssVar('--soft'); c.fillRect(Xp(0), Yp(x0), W * sc, (I.xJ - x0) * sc);
  c.fillStyle = cssVar('--blade'); c.globalAlpha = 0.55; c.fillRect(Xp(0), Yp(I.xJ), W * sc, (x1 - I.xJ) * sc); c.globalAlpha = 1;
  c.strokeStyle = ink; c.lineWidth = 2.4; c.beginPath(); c.moveTo(Xp(0), Yp(x0)); c.lineTo(Xp(0), Yp(x1)); c.moveTo(Xp(W), Yp(x0)); c.lineTo(Xp(W), Yp(x1)); c.moveTo(Xp(0), Yp(x0)); c.lineTo(Xp(W), Yp(x0)); c.stroke();
  c.setLineDash([5, 4]); c.strokeStyle = muted; c.lineWidth = 1; c.beginPath(); c.moveTo(Xp(0), Yp(x1)); c.lineTo(Xp(W), Yp(x1)); c.moveTo(Xp(0), Yp(I.xJ)); c.lineTo(Xp(W), Yp(I.xJ)); c.stroke(); c.setLineDash([]);
  for (const p of res.paths) {
    c.strokeStyle = poolColor(p.outlet); c.lineWidth = 1; c.globalAlpha = 0.85; c.setLineDash(poolDash(p.outlet)); c.beginPath();
    for (let q = 0; q < p.pts.length; q += 4) { const px = Xp(p.pts[q + 2]), py = Yp(p.pts[q]); q ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke(); c.setLineDash([]); c.globalAlpha = 1;
    if (p.out) { const L = p.pts.length - 4; c.beginPath(); c.arc(Xp(p.pts[L + 2]), Yp(p.pts[L]), 3, 0, 7); c.fillStyle = poolColor(p.outlet); c.fill(); c.lineWidth = 1; c.strokeStyle = surf; c.stroke(); }
  }
  base.outlets.forEach((q, j) => { c.beginPath(); c.arc(Xp(q.z), Yp(q.x), 7, 0, 7); c.fillStyle = poolColor(j); c.fill(); c.lineWidth = j === POOL.outlet ? 2.5 : 1.5; c.strokeStyle = j === POOL.outlet ? ink : surf; c.stroke();
    c.fillStyle = '#fff'; c.font = '600 10px ' + cssVar('--mono'); c.textAlign = 'center'; c.fillText(String(j + 1), Xp(q.z), Yp(q.x) + 3.5); });
  c.fillStyle = muted; c.font = '11px ' + cssVar('--mono'); c.textAlign = 'center';
  for (const v of niceTicks(0, W * 1e3, 6)) c.fillText(String(+v.toPrecision(6)), Xp(v / 1e3), Yp(x1) + 15);
  c.textAlign = 'right'; for (const v of niceTicks(x0 * 1e3, x1 * 1e3, 4)) if (v / 1e3 >= x0 && v / 1e3 <= x1) c.fillText(String(+v.toPrecision(6)), mL - 6, Yp(v / 1e3) + 4);
  c.textAlign = 'left'; c.fillText('z across the web (mm; side plates at 0 and ' + (W * 1e3).toFixed(0) + ')', mL, Yp(x1) + 30);
  c.save(); c.translate(12, Yp((x0 + x1) / 2)); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.fillText('x (mm) · the web runs down', 0, 0); c.restore();
}

/** The paths' numbers: the time to the pool edge and the height there (those that reach it). */
function poolPathStats(res) {
  const ok = res.paths.filter(p => p.out), t = ok.map(p => p.t), y = ok.map(p => p.pts[p.pts.length - 3]);
  return { n: res.paths.length, out: ok.length, tMin: Math.min(...t), tMax: Math.max(...t), yMin: Math.min(...y), yMax: Math.max(...y) };
}

// ---- the page ----
const poolTools = dim => {
  const seg = (lab, key, items, cur) => `<div class="seg" role="tablist" aria-label="${lab}">${items.map(([v, t]) => `<button type="button" role="tab" data-pl${key}="${v}" aria-selected="${String(v) === String(cur)}">${t}</button>`).join('')}</div>`;
  const b = POOL[3].base || poolBase(3), n = dim === 3 && b ? b.outlets.length : 0;
  return seg('Part of the cycle', 'state', [[0, 'During a pulse'], [1, 'Between pulses']], POOL.state) + seg('Field', 'show', [['speed', 'Speed'], ['pressure', 'Pressure']], POOL.show)
    + (n > 1 ? `<span class="vp-ctl">Section through</span>` + seg('Outlet', 'outlet', Array.from({ length: n }, (_, j) => [j, `${j + 1}`]), Math.min(POOL.outlet, n - 1)) : '');
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-plstate],[data-plshow],[data-ploutlet]');
  if (!b || !(tab === 16 || tab === 17)) return;
  if (b.dataset.plstate != null) POOL.state = +b.dataset.plstate;
  if (b.dataset.plshow != null) POOL.show = b.dataset.plshow;
  if (b.dataset.ploutlet != null) POOL.outlet = +b.dataset.ploutlet;
  render();
});
const view2DFeed = () => viewPoolFeed(2);
const view3DFeed = () => viewPoolFeed(3);
function viewPoolFeed(dim) {
  const S = POOL[dim], id = 'pool' + dim, warn = cssVar('--warn'), acc = cssVar('--accent');
  poolRequest(dim);
  const what = dim === 2 ? 'a slice along the web (the feed a band across it)' : 'the whole pool between the side plates';
  view.innerHTML = moduleFrame({
    tools: poolTools(dim),
    cols: workbenchFits() ? 2 : 1,
    top: `<div class="pl-top${dim === 3 ? ' pl-two' : ''}"><section class="pl-view"><h3>${uiBadge('section')}The pool ${dim === 3 ? 'through an outlet' : 'along the web'} <span class="acr-sub" id="plSecSub">${what}</span></h3><div class="pl-canvas"><canvas id="plSec" role="img" aria-label="The pool's section: the paste's speed or pressure, its direction and the paths from the landing"></canvas></div><p class="fd-cap" id="plCap"></p></section>
      ${dim === 3 ? `<section class="pl-view"><h3>${uiBadge('top')}From above <span class="acr-sub">the paths from each outlet; the web runs down</span></h3><div class="pl-canvas"><canvas id="plPlan" role="img" aria-label="The pool from above: the outlets and the paths from each"></canvas></div></section>` : ''}</div>`,
    panes: [
      { id: 'pq1', icon: 'period', title: 'To the pool edge', aria: 'Time from the landing to the pool edge against the height at which the paste reaches it', legend: '<span id="pq1lg"></span>',
        note: 'Each path starts just under a landing, half a pulse in, and follows the flow through the cycle: the pulse\'s flow while a pulse lasts, the drain\'s between. It ends where it reaches the pool edge, where the 2D under the blade starts.' },
      { id: 'pq2', icon: 'profile', title: 'Across the pool edge', aria: 'The paste\'s speed along the web across the pool edge, against the height', legend: oneDLegend([['during a pulse', warn], ['between pulses', acc, 'dash']]),
        note: 'The speed along the web where the pool meets the 2D under the blade (across the width, on average): out near the web, back above it (the pool\'s vortex).' },
      { id: 'pq3', icon: 'pressure', title: 'Pressure along the top', aria: 'The pressure under the top, over the pool\'s weight, along the web', legend: oneDLegend([['during a pulse', warn], ['between pulses', acc]]),
        note: 'The pressure the top holds the paste with, over the pool\'s weight, in the section shown. Under a stream the paste is pushed into the pool: the top there carries this push, and a free top rises into a heap.' },
    ],
  });
  const st = document.getElementById('st'), ss = document.getElementById('ss');
  const ctl = solvePending(id) ? pill('Solving…', '') + `<span class="pl-prog" id="plProg"></span>` : solveCtl(id);
  if (!S.res) {
    st.innerHTML = (S.error ? pill('The pool could not be solved: ' + S.error, 'bad') : pill(poolBase(dim) ? 'The pool through a pulse cycle: solve it to see the paste\'s paths' : 'The pool needs the 1D\'s pulse cycle: Solve solves the 1D first', '')) + ctl;
    ss.innerHTML = '';
    if (S.busy) poolProgPaint(dim);
    return;
  }
  const res = S.res, base = S.base, s0 = res.states[0], s1 = res.states[1], I = s0.info, share = res.W / base.W, rhoG = base.rho * base.g;
  const sec = poolSectionDraw(document.getElementById('plSec'), res, base);
  if (dim === 3) poolPlanDraw(document.getElementById('plPlan'), res, base);
  const ps = poolPathStats(res);
  document.getElementById('plCap').textContent = `${POOL.state ? 'Between pulses' : 'During a pulse'}: ${POOL.show === 'pressure' ? 'the pressure over the pool\'s weight' : 'the paste\'s speed (log scale) and its direction in the section'}${dim === 3 ? `, at z = ${(sec.z * 1e3).toFixed(1)} mm (outlet ${POOL.outlet + 1})` : ''}. Dashed: the pool edge (the 2D under the blade starts there). Lines: the paths from the landing, released half a pulse in; dots: where they reach the pool edge. True scale.`;
  // the charts: the paths, the pool edge, the top
  const lg = document.getElementById('pq1lg'); if (lg) lg.innerHTML = oneDLegend(base.outlets.slice(0, dim === 2 ? 1 : 12).map((q, j) => [dim === 2 ? 'the band of paste' : `outlet ${j + 1}`, poolColor(j), 'dot']));
  const byOut = new Map(); res.paths.filter(p => p.out).forEach(p => { if (!byOut.has(p.outlet)) byOut.set(p.outlet, []); byOut.get(p.outlet).push([p.t, p.pts[p.pts.length - 3] * 1e3]); });
  const c1 = document.getElementById('pq1');
  if (ps.out) plotChart(c1, poolAspect(c1), { x0: 0, x1: ps.tMax * 1.08, y0: 0, y1: Math.max(1, ps.yMax * 1e3 * 1.25), yticks: niceTicks(0, Math.max(1, ps.yMax * 1e3 * 1.25), 5), yf: v => String(+v.toPrecision(6)), xticks: niceTicks(0, ps.tMax * 1.08, 6), xf: v => String(+v.toPrecision(6)),
    yl: 'height at the pool edge (mm)', xl: 'time from the landing (s)', s: [...byOut].map(([j, pts]) => ({ p: pts, c: poolColor(j), line: false, dots: true })), vl: poolPulseLines(base.T, ps.tMax * 1.08) });
  // (across the pool edge: the last column, across the width on average)
  const edge = s => { const out = []; for (let j = 0; j < I.NY; j++) { let a = 0, y = 0; for (let k = 0; k < I.NZ; k++) { const n = plId(I, I.NX - 1, j, k); a += s.u[n]; y += s.Y[n]; } out.push([a / I.NZ * 1e3, y / I.NZ * 1e3]); } return out; };
  const e0 = edge(s0), e1 = edge(s1), uLo = Math.min(...e0.map(q => q[0]), ...e1.map(q => q[0])), uHi = Math.max(...e0.map(q => q[0]), ...e1.map(q => q[0])), yE = Math.max(...e0.map(q => q[1]));
  const c2 = document.getElementById('pq2');
  plotChart(c2, poolAspect(c2), { x0: uLo - 0.1 * (uHi - uLo), x1: uHi + 0.1 * (uHi - uLo), y0: 0, y1: yE * 1.05, yticks: niceTicks(0, yE * 1.05, 5), yf: v => String(+v.toPrecision(6)), xticks: niceTicks(uLo, uHi, 5), xf: v => String(+v.toPrecision(6)),
    yl: 'y at the pool edge (mm)', xl: 'speed along the web (mm/s)', s: [{ p: e0, c: warn, w: 4 }, { p: e1, c: acc, w: 2, dash: [6, 4] }], vl: [{ x: 0, c: cssVar('--muted'), t: '' }] });
  // (along the top: its corner nodes in the section shown)
  const kk = poolPlane(res, true), topP = s => { const out = []; for (let i = 0; i < I.NX; i += 2) { const n = plId(I, i, I.NY - 1, kk); if (s.X[n] > I.xJ + 1e-9) break; const v = s.p[n] - rhoG * (s.info.h - s.Y[n]); if (Number.isFinite(v)) out.push([s.X[n] * 1e3, v]); } return out; };
  const t0 = topP(s0), t1 = topP(s1), pLo = Math.min(0, ...t0.map(q => q[1]), ...t1.map(q => q[1])), pHi = Math.max(0, ...t0.map(q => q[1]), ...t1.map(q => q[1]));
  const c3 = document.getElementById('pq3');
  plotChart(c3, poolAspect(c3), { x0: -I.xBack * 1e3, x1: I.xJ * 1e3, y0: pLo - 0.08 * (pHi - pLo || 1), y1: pHi + 0.08 * (pHi - pLo || 1), yticks: niceTicks(pLo, pHi, 5), yf: v => String(+v.toPrecision(6)), xticks: niceTicks(-I.xBack * 1e3, I.xJ * 1e3, 6), xf: v => String(+v.toPrecision(6)),
    yl: 'pressure under the top (Pa)', xl: 'x along the web (mm)', s: [{ p: t0, c: warn, w: 2 }, { p: t1, c: acc, w: 2 }], vl: [{ x: base.outlets[0].x * 1e3, c: cssVar('--muted'), t: 'the stream' }] });
  // the answer, the numbers
  const qOut = s0.flows.end / share, qTop = -s0.flows.top / share, pushMax = Math.max(...t0.map(q => q[1]));
  let html = ps.out ? pill(`The paste reaches the pool edge ${ps.tMin.toFixed(0)}–${ps.tMax.toFixed(0)} s after it lands (${(ps.tMin / base.T).toFixed(1)}–${(ps.tMax / base.T).toFixed(1)} pulses), ${(ps.yMin * 1e3).toFixed(1)}–${(ps.yMax * 1e3).toFixed(1)} mm above the web`, '')
    : pill('No path reached the pool edge in the time followed', 'warn');
  html += Math.abs(qOut / base.Qout - 1) < 1e-3 ? pill(`Paste in = out: ${(qTop * 1e6).toFixed(3)} ml/s through the top, ${(qOut * 1e6).toFixed(3)} ml/s to the blade, the 1D's ${(base.Qout * 1e6).toFixed(3)}`, 'ok') : pill(`Paste out ${(qOut * 1e6).toFixed(3)} ml/s against the 1D's ${(base.Qout * 1e6).toFixed(3)}`, 'warn');
  html += pill(`The top held at the level: under each stream it carries ${(pushMax / 1000).toFixed(2)} kPa — a free top there rises into the heap`, 'warn');
  if (typeof matStruct === 'function' && matStruct()) html += pill('The paste\'s flow curve: the structure model is not carried in the pool', 'warn');
  if (!poolCurrent(dim)) html += solvePending(id) ? pill('Solving for the inputs as they are…', '') + `<span class="pl-prog" id="plProg"></span>` : solveCtl(id);
  st.innerHTML = html;
  ss.innerHTML = [
    ['Paste reaches the pool edge', ps.out ? `${ps.tMin.toFixed(0)} to ${ps.tMax.toFixed(0)} s` : '—'],
    ['Pulses it stays in the pool', ps.out ? `${(ps.tMin / base.T).toFixed(1)} to ${(ps.tMax / base.T).toFixed(1)}` : '—'],
    ['Height at the pool edge', ps.out ? `${(ps.yMin * 1e3).toFixed(1)} to ${(ps.yMax * 1e3).toFixed(1)} mm` : '—'],
    ['Push under each stream', `${(pushMax / 1000).toFixed(2)} kPa`],
    ['Out to the blade', `${(qOut * 1e6).toFixed(3)} ml/s`],
    ['Mesh', `${I.nE} Q2 hexahedra`],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`).join('');
}

/** The report's section for the pool in 2D and 3D (what is solved). */
function poolReportHTML(dim) {
  const S = POOL[dim];
  if (!S.res || !poolCurrent(dim)) return `<p class="cap">The pool in ${dim}D: not solved for these inputs.</p>`;
  const ps = poolPathStats(S.res), b = S.base, I = S.res.states[0].info, q = S.res.states[0].flows.end / (S.res.W / b.W);
  return `<table class="rep-t"><tbody>
    <tr><th>The pool in ${dim}D</th><td>${dim === 2 ? 'a slice along the web, the feed a band across it' : 'the whole pool between the side plates, ' + b.outlets.length + ' outlets'}; ${I.nE} Q2 hexahedra</td></tr>
    <tr><th>Paste from a landing to the pool edge</th><td>${ps.out ? `${ps.tMin.toFixed(0)} to ${ps.tMax.toFixed(0)} s (${(ps.tMin / b.T).toFixed(1)} to ${(ps.tMax / b.T).toFixed(1)} pulses), ${(ps.yMin * 1e3).toFixed(1)} to ${(ps.yMax * 1e3).toFixed(1)} mm above the web` : 'no path reached it'}</td></tr>
    <tr><th>Out to the blade</th><td>${(q * 1e6).toFixed(3)} ml/s (the 1D's ${(b.Qout * 1e6).toFixed(3)})</td></tr></tbody></table>`;
}
