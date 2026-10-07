/*
 * draw.js — shared canvas/chart rendering utilities.
 *
 * Generic helpers with no physics knowledge, reused by both the static
 * charts (ui.js) and the real-time animation (simulation.js). Everything
 * here just draws what it's told; the physics lives in physics.js.
 */

/** Read a CSS custom property off :root (used to theme canvas drawing to match light/dark mode). */
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * A chart's frame with nothing to draw yet (its model not solved, solving, or failed): a short box saying so in place of
 * an empty frame (the owner's choice); drawing the canvas again (setupCanvas) takes it away. PANE_DRAWN: the canvases
 * drawn since they were made (a page's charts never drawn get the box from paneSweep).
 */
const PANE_DRAWN = new WeakSet();
function paneEmpty(cv, why) {
  const f = cv && (cv.closest('figure') || cv.parentElement);
  if (!f) return;
  f.classList.add('pane-empty'); f.dataset.empty = why || 'Not solved yet: press Solve';
}
function paneFull(cv) {
  PANE_DRAWN.add(cv);
  const f = cv.closest('figure') || cv.parentElement;
  if (f && f.classList.contains('pane-empty')) { f.classList.remove('pane-empty'); delete f.dataset.empty; }
}
/** Charts by their canvases' ids, cleared and boxed with why there is nothing to draw. */
function paneEmptyIds(ids, why) {
  for (const id of ids) { const cv = document.getElementById(id); if (!cv) continue; const cx = setupCanvas(cv, 0.2); cx.c.clearRect(0, 0, cx.w, cx.h); paneEmpty(cv, why); }
}

/**
 * Size a canvas to its container's width at a fixed aspect ratio, and scale
 * its backing store for the device pixel ratio so strokes stay crisp on
 * high-DPI screens. Returns the 2D context plus the CSS-pixel width/height
 * to draw against (the transform already absorbs the DPR scaling).
 */
function setupCanvas(cv, aspectRatio) {
  paneFull(cv);
  const par = cv.parentElement, pcs = getComputedStyle(par);
  const w = (par.clientWidth - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0)) || 600;   // (the canvas fills its parent's content box)
  const dpr = window.EXPORT_DPR || window.devicePixelRatio || 1;   // (EXPORT_DPR: drawn for an image export)
  const h = w * aspectRatio;
  cv.style.height = h + 'px';
  cv.width = w * dpr;
  cv.height = h * dpr;
  if (typeof recordCanvas === 'function') recordCanvas(cv, w, h);   // (its drawing is logged for vector / high-resolution image export)
  const c = cv.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { c, w, h };
}

/** Draw text with a background-colour outline so labels stay legible over busy fills. */
function outlinedText(c, text, x, y, color) {
  c.lineJoin = 'round';
  c.lineWidth = 3;
  c.strokeStyle = cssVar('--surface');
  c.strokeText(text, x, y);
  c.fillStyle = color;
  c.fillText(text, x, y);
}

/**
 * Draw a themed line chart onto a canvas. `opts` shape:
 *   x0,x1,y0,y1   data-space axis bounds
 *   xl,yl         axis label strings
 *   xd,yd         decimal places for axis tick labels (default 0 / 1)
 *   yf            y tick label formatter (overrides yd)
 *   bands: [{x0, x1, c}]          background bands along x
 *   s:  [{p:[[x,y],...], c:color, w?:lineWidth, dash?:[on,off]}]  one or more series
 *   hl: [{y, c:color, t:label}]   horizontal reference lines
 *   vl: [{x, c:color, t:label}]   vertical reference lines
 * Returns the {X,Y} data->pixel mapping functions in case the caller wants
 * to draw something extra on top, their inverses invX/invY and the plot rect.
 */
function plotChart(cv, aspectRatio, opts) {
  const { c, w, h } = setupCanvas(cv, aspectRatio);
  const margin = { l: 52, r: 16, t: 26, b: 36 };
  // (the left margin grows to the widest y tick label, so a long one is not cut off at the canvas's edge)
  const yticks = opts.yticks || [0, 1, 2, 3, 4].map(i => opts.y0 + (opts.y1 - opts.y0) * i / 4), yfmt = v => opts.yf ? opts.yf(v) : v.toFixed(opts.yd ?? 1);
  c.font = '12px ' + cssVar('--mono');
  margin.l = Math.max(margin.l, Math.ceil(Math.max(0, ...yticks.map(v => c.measureText(String(yfmt(v))).width))) + 8);   // (6 px to the axis, 2 px from the edge)
  const plotW = w - margin.l - margin.r;
  const plotH = h - margin.t - margin.b;
  const X = x => margin.l + (x - opts.x0) / (opts.x1 - opts.x0) * plotW;
  const Y = y => margin.t + plotH - (y - opts.y0) / (opts.y1 - opts.y0) * plotH;

  const ink = cssVar('--ink'), muted = cssVar('--muted'), line = cssVar('--line');
  c.font = '12px ' + cssVar('--mono');
  c.fillStyle = muted;
  c.strokeStyle = line;
  c.lineWidth = 1;

  // background bands along x (behind everything)
  (opts.bands || []).forEach(b => {
    const x0 = Math.max(margin.l, X(b.x0)), x1 = Math.min(margin.l + plotW, X(b.x1));
    if (x1 > x0) { c.fillStyle = b.c; c.fillRect(x0, margin.t, x1 - x0, plotH); }
  });
  c.fillStyle = muted;

  // gridlines + axis ticks (opts.yf: tick label formatter; opts.yticks: their positions, else four equal steps)
  for (const v of yticks) {
    const y = Y(v);
    c.beginPath(); c.moveTo(margin.l, y); c.lineTo(w - margin.r, y); c.stroke();
    c.textAlign = 'right'; c.fillText(yfmt(v), margin.l - 6, y + 4);
  }
  // (opts.xticks: tick positions, e.g. a factor's levels; opts.xf: their labels)
  for (const v of opts.xticks || [0, 1, 2, 3, 4].map(i => opts.x0 + (opts.x1 - opts.x0) * i / 4)) {
    c.textAlign = 'center'; c.fillText(opts.xf ? opts.xf(v) : v.toFixed(opts.xd ?? 0), X(v), h - margin.b + 16);
  }

  // axis labels
  c.textAlign = 'left'; c.fillText(opts.yl, 4, 14);
  c.textAlign = 'right'; c.fillText(opts.xl, w - margin.r, h - 4);

  // reference lines
  (opts.hl || []).forEach(ref => {
    c.strokeStyle = ref.c; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(margin.l, Y(ref.y)); c.lineTo(w - margin.r, Y(ref.y)); c.stroke();
    c.setLineDash([]);
    // (ref.left: the label at the line's left end; ref.below: under the line -- where the curves leave it clear)
    c.fillStyle = ref.c; c.textAlign = ref.left ? 'left' : 'right'; c.fillText(ref.t, ref.left ? margin.l + 4 : w - margin.r - 4, Y(ref.y) + (ref.below ? 14 : -5));
  });
  (opts.vl || []).forEach(ref => {
    c.strokeStyle = ref.c; c.setLineDash([5, 4]);
    c.beginPath(); c.moveTo(X(ref.x), margin.t); c.lineTo(X(ref.x), margin.t + plotH); c.stroke();
    c.setLineDash([]);
    // (a label that would run past the plot's right side goes on the line's left)
    const flip = X(ref.x) + 4 + c.measureText(ref.t).width > w - margin.r;
    c.fillStyle = ref.c; c.textAlign = flip ? 'right' : 'left'; c.fillText(ref.t, X(ref.x) + (flip ? -4 : 4), margin.t + 12);
  });

  // data series
  opts.s.forEach(series => {
    c.strokeStyle = series.c;
    c.lineWidth = series.w || 2;
    c.setLineDash(series.dash || []);
    // (series.line false: markers only)
    if (series.line !== false) {
      c.beginPath();
      series.p.forEach((pt, i) => {
        const x = X(pt[0]), y = Math.min(Math.max(Y(pt[1]), margin.t), margin.t + plotH);
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      });
      c.stroke();
    }
    c.setLineDash([]);
    if (series.dots) {
      // (points: 8 px markers with a surface ring)
      const surf = cssVar('--surface');
      series.p.forEach(pt => { c.beginPath(); c.arc(X(pt[0]), Y(pt[1]), 4, 0, 7); c.fillStyle = series.c; c.fill(); c.lineWidth = 1.5; c.strokeStyle = surf; c.stroke(); });
    }
  });

  // (inverse mapping and plot rectangle too, for hover read-outs)
  return { X, Y, invX: px => opts.x0 + (px - margin.l) / plotW * (opts.x1 - opts.x0), invY: py => opts.y0 + (margin.t + plotH - py) / plotH * (opts.y1 - opts.y0), rect: { l: margin.l, t: margin.t, r: margin.l + plotW, b: margin.t + plotH } };
}

/** Small status-badge HTML snippet, e.g. pill('Contact line steady', 'ok'). */
const pill = (text, kind) => `<span class="pill ${kind}">${text}</span>`;
