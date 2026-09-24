/*
 * cfd-plot.js — CFD post-processing view of one solved 2D field: a colour
 * raster of a scalar over the fluid domain drawn to physical scale (mm
 * axes, stated vertical exaggeration), the solids drawn as geometry (the
 * blade above -- its surface y = h(x), flat land or round entry -- with its
 * exit face at the metering edge, the moving web below, the active
 * metering edge marked), a colorbar, and streamline / velocity-vector /
 * seed overlays.
 *
 * A curvilinear field (the finite-element domain with the meniscus) is
 * drawn from its own mesh: the fluid is the mesh outline, the blade runs
 * along the top boundary to the contact line and its exit face continues
 * above it, and the free surface from the contact line to the domain end
 * is drawn as a line with air above.
 *
 * Canvas 2D only (the app has no plotting library -- see draw.js); reads
 * theme tokens via cssVar so it follows light/dark like the other tabs.
 * Pure drawing: never touches the solver. Depends on draw.js (setupCanvas,
 * cssVar) and cfd-flowviz.js (sampleField, sampleIdx, fieldOutline).
 */

// ---- colour ramps -----------------------------------------------------
// Magnitude fields: one hue, light -> dark (the dataviz rule for sequential
// data), the validated blue ramp steps 100..700; flipped in dark mode so
// low values recede toward the dark surface. Signed fields: diverging
// blue <-> red with a neutral grey midpoint, poles matched in lightness.
const SEQ_BLUE = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];

const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const toSrgb = c => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
function rgbToOklab([r, g, b]) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
const withL = (lab, L) => { const c = Math.hypot(lab[1], lab[2]), h = Math.atan2(lab[2], lab[1]); return [L, c * Math.cos(h), c * Math.sin(h)]; };
const mixLab = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const LUT_N = 256;
function buildLut(stopsLab) {
  const lut = new Uint8ClampedArray(LUT_N * 3);
  for (let n = 0; n < LUT_N; n++) {
    const t = n / (LUT_N - 1), seg = t * (stopsLab.length - 1);
    const i = Math.min(Math.floor(seg), stopsLab.length - 2);
    const c = oklabToRgb(mixLab(stopsLab[i], stopsLab[i + 1], seg - i));
    lut[n * 3] = c[0]; lut[n * 3 + 1] = c[1]; lut[n * 3 + 2] = c[2];
  }
  return lut;
}
const LUTS = {};
function isDarkTheme() {
  const L = rgbToOklab(hexRgb(normalizeHex(cssVar('--surface'))))[0];
  return L < 0.5;
}
function normalizeHex(c) {
  c = c.trim();
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
  return /^#[0-9a-f]{6}$/i.test(c) ? c : '#ffffff';
}
function getLut(kind) {
  const dark = isDarkTheme(), key = kind + (dark ? ':d' : ':l');
  if (LUTS[key]) return LUTS[key];
  if (kind === 'jet') {
    // the classic CFD rainbow (MATLAB jet): dark blue, blue, cyan, yellow, red, dark red -- piecewise linear in RGB
    const st = [[0, 0, 0.5], [0, 0, 1], [0, 1, 1], [1, 1, 0], [1, 0, 0], [0.5, 0, 0]], at = [0, 0.125, 0.375, 0.625, 0.875, 1];
    const lut = new Uint8ClampedArray(LUT_N * 3);
    for (let n = 0; n < LUT_N; n++) {
      const t = n / (LUT_N - 1);
      let i = 0; while (i < at.length - 2 && t > at[i + 1]) i++;
      const u = (t - at[i]) / (at[i + 1] - at[i]);
      for (let ch = 0; ch < 3; ch++) lut[n * 3 + ch] = Math.round(255 * (st[i][ch] + (st[i + 1][ch] - st[i][ch]) * u));
    }
    LUTS[key] = lut;
  } else if (kind === 'seq') {
    const stops = SEQ_BLUE.map(h => rgbToOklab(hexRgb(h)));
    LUTS[key] = buildLut(dark ? stops.slice().reverse() : stops);
  } else {
    const mid = rgbToOklab(hexRgb(dark ? '#383835' : '#f0efec'));
    const cool = rgbToOklab(hexRgb(dark ? '#86b6ef' : '#104281'));
    const warm = withL(rgbToOklab(hexRgb(normalizeHex(cssVar('--bad')))), cool[0]);
    LUTS[key] = buildLut([cool, mixLab(cool, mid, 0.5), mid, mixLab(warm, mid, 0.5), warm]);
  }
  return LUTS[key];
}
/**
 * Where a value falls on a colour scale sc ({ min, max, log?, levels? }), 0..1: linear, or
 * logarithmic (sc.log; values below min pinned to it), then banded into sc.levels steps
 * (0 or 1 = smooth).
 */
function scaleT(sc, v) {
  let t = sc.log ? (Math.log(Math.max(v, sc.min)) - Math.log(sc.min)) / ((Math.log(sc.max) - Math.log(sc.min)) || 1) : (v - sc.min) / ((sc.max - sc.min) || 1);
  t = Math.min(1, Math.max(0, t));
  return sc.levels > 1 ? Math.min(sc.levels - 1, Math.floor(t * sc.levels)) / (sc.levels - 1) : t;
}
/** Tick values for a colour scale: nice linear ticks, or on a log scale 1-2-5 steps (or whole decades when it spans many). */
function scaleTicks(sc, count) {
  if (!sc.log) return niceTicks(sc.min, sc.max, count);
  const out = [], d0 = Math.floor(Math.log10(sc.min)), d1 = Math.ceil(Math.log10(sc.max));
  const mult = d1 - d0 > 3 ? [1] : d1 - d0 > 1 ? [1, 3] : [1, 2, 5];
  for (let d = d0; d <= d1; d++) for (const m of mult) { const v = m * 10 ** d; if (v >= sc.min * 0.999 && v <= sc.max * 1.001) out.push(v); }
  return out;
}

function lutColor(lut, t) {
  const n = Math.round(Math.min(1, Math.max(0, t)) * (LUT_N - 1)) * 3;
  return `rgb(${lut[n]},${lut[n + 1]},${lut[n + 2]})`;
}

// ---- small helpers ----------------------------------------------------
function niceTicks(min, max, count) {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
function fmtNum(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  if (a < 1) return v.toFixed(3);
  if (a < 10) return v.toFixed(2);
  if (a < 100) return v.toFixed(1);
  return v.toFixed(0);
}

const rasterCache = new WeakMap();

/**
 * Draw one field plot. `s` (spec):
 *   f            flow field (cfd-flowviz makeFlowField)
 *   webSpeed     U, m/s (for the web label)
 *   yMax         displayed y range, m (>= f.Ly; shared in comparison mode)
 *   yScale       'true' | 'exaggerated'
 *   compact      small-multiple layout (comparison mode)
 *   title        compact-mode title
 *   scalar       { key, arr, label, unit, scale, min, max, kind: 'seq'|'div', capped } | null  -- colour raster
 *   lineScalar   same shape, or null  -- colour streamlines by this instead (raster then off);
 *                perLine: true colours by each line's own times, line.t (per point)
 *   vectorColor  boolean -- colour vectors by |V| using `vectorScalar`
 *   vectorScalar same shape as scalar (|V|), used when vectorColor
 *   streamlines  [{points:[[x,y]...]}] | null
 *   lineWidth, arrows
 *   vectorSample (nCols, nRows) => [{x,y,u,v,speed}] | null -- called with a lattice sized from
 *                vectorSpacing (px), so arrows are evenly spaced on screen; plus vectorScale,
 *                vectorNormalize, vectorVmax (shared across plots in comparison mode)
 *   seeds        [[x,y]...], manualSeeds boolean
 *   probes       [{name, x, y, inside}] -- named probe points (filled when inside this field's fluid)
 *   exitAngle    blade exit face at the edge, degrees from the web (machine direction); default 90
 *   bladeLabel   text for the blade
 *   maxH         the canvas's whole height may not exceed this (px): the plot then fills it
 *   view         { x0, x1, y0, y1 } (m): the window shown (zoom); omitted = the whole domain. The plot
 *                keeps its size; the window fills it (so its shape sets the vertical scale)
 *   fast         draw the colour raster at half resolution (while zooming / panning)
 *   mesh         { quality: meshQuality(f) | null } -- draw the finite elements' edges (curved through
 *                their mid nodes) and nodes over the field; with quality, the elements are filled by
 *                their quality instead of the field colours (the colour bar then shows it)
 * Returns the mapping for hit-testing and overlays.
 */
function drawFlowPlot(cv, s) {
  const f = s.f, compact = !!s.compact;
  const w0 = cv.parentElement.clientWidth || 640;
  const L = compact ? 44 : 50, R = compact ? 70 : 82;
  const bladeBand = compact ? 14 : 26, webBand = compact ? 12 : 22;
  const titleH = compact ? 20 : 4, axisH = compact ? 24 : 42;
  const plotW = Math.max(120, w0 - L - R);
  const xRange = f.Lx, yRange = Math.max(s.yMax || f.Ly, f.Ly);
  let plotH;
  if (s.yScale === 'true') plotH = plotW * yRange / xRange;
  else plotH = plotW * (compact ? 0.26 : 0.5);
  plotH = Math.max(compact ? 70 : 110, Math.min(plotH, s.maxH ? s.maxH - titleH - bladeBand - webBand - axisH : compact ? 190 : 420));
  const full = { x0: 0, x1: xRange, y0: 0, y1: yRange };
  const v = s.view ? clampView(s.view, full) : full, zoomed = !!s.view;
  const vw = v.x1 - v.x0, vh = v.y1 - v.y0;
  const exaggeration = (plotH / plotW) * (vw / vh);

  const T = titleH + bladeBand;
  const totalH = T + plotH + webBand + axisH;
  const { c, w } = setupCanvas(cv, totalH / w0);

  const X = x => L + (x - v.x0) / vw * plotW;
  const Y = y => T + plotH - (y - v.y0) / vh * plotH;
  const pl = L, pr = L + plotW, pt = T, pb = T + plotH;          // the plot's rectangle on screen
  const eps = 1e-12;
  // what may be drawn on: the plot, plus the blade band above it / the web band below it / the
  // right margin when the window reaches the domain's top / bottom / downstream end
  const CR = { l: pl, r: pr + (v.x1 >= full.x1 - eps ? 14 : 0), t: pt - (v.y1 >= full.y1 - eps ? bladeBand : 0), b: pb + (v.y0 <= eps ? webBand : 0) };
  const ink = cssVar('--ink'), muted = cssVar('--muted'), surface = cssVar('--surface');
  const mono = cssVar('--mono'), fsz = compact ? 10.5 : 11.5;
  c.clearRect(0, 0, w, totalH);

  const yTop = Y(f.Ly), yBot = Y(0), xL = X(0), xR = X(f.Lx);
  // the part of the domain in view, on screen
  const vl = Math.max(pl, xL), vr = Math.min(pr, xR), vt = Math.max(pt, yTop), vb = Math.min(pb, yBot);
  // blade surface on screen, one point per column (curvilinear: the top boundary up to the contact line)
  const topRow = f.curv ? Array.from({ length: f.nx }, (_, i) => [X(f.gx[(f.ny - 1) * f.nx + i]), Y(f.gy[(f.ny - 1) * f.nx + i])]) : null;
  const surf = f.curv ? topRow.slice(0, f.iCL + 1) : Array.from(f.h, (h, i) => [X(i * f.dx), Y(h)]);
  const outline = f.curv ? fieldOutline(f).map(([x, y]) => [X(x), Y(y)]) : null;
  const fluidPath = () => {
    c.beginPath();
    if (outline) { outline.forEach(([px, py], k) => k ? c.lineTo(px, py) : c.moveTo(px, py)); c.closePath(); return; }
    c.moveTo(xL, yBot);
    for (const [px, py] of surf) c.lineTo(px, py);
    c.lineTo(xR, yBot); c.closePath();
  };

  // vectors on a lattice with even spacing on screen (so density is the
  // same visually whatever the vertical exaggeration)
  const vectors = s.vectorSample
    ? s.vectorSample(Math.max(4, Math.round((vr - vl) / s.vectorSpacing)), Math.max(2, Math.round((vb - vt) / s.vectorSpacing)),
      { x0: v.x0 + (vl - pl) / plotW * vw, x1: v.x0 + (vr - pl) / plotW * vw, y0: v.y0 + (pb - vb) / plotH * vh, y1: v.y0 + (pb - vt) / plotH * vh })
    : null;

  // ---- colour carrier: one colour scale per plot --------------------
  const mq = s.mesh && s.mesh.quality && f.curv ? s.mesh.quality : null;
  const qCarrier = mq ? { short: 'quality', unit: 'J min/max', kind: 'seq', reverse: true, min: Math.min(0.9, Math.floor(Math.max(0, mq.worst) * 10) / 10), max: 1, capped: false } : null;
  const carrier = qCarrier || s.lineScalar || (s.vectorColor && vectors ? s.vectorScalar : null) || s.scalar;
  const rasterOn = !!s.scalar && !mq && !s.lineScalar && !(s.vectorColor && vectors);

  c.save();
  c.beginPath(); c.rect(CR.l, CR.t, CR.r - CR.l, CR.b - CR.t); c.clip();
  // fluid background
  c.fillStyle = surface; fluidPath(); c.fill();
  if (rasterOn && vr > vl && vb > vt) {
    // sampled over the part of the domain in view (half resolution while zooming / panning)
    const q = s.fast ? 0.5 : 1;
    const sc = s.scalar, pw = Math.max(1, Math.round((vr - vl) * q)), ph = Math.max(1, Math.round((vb - vt) * q));
    let perField = rasterCache.get(f);
    if (!perField) { perField = new Map(); rasterCache.set(f, perField); }
    const dark = isDarkTheme();
    const key = [sc.key, pw, ph, sc.min, sc.max, sc.kind, sc.log ? 'log' : 'lin', sc.levels || 0, dark, zoomed ? [v.x0, v.x1, v.y0, v.y1].join(',') : 'full'].join('|');
    let off = perField.get(key);
    if (!off) {
      // (only the whole-domain rasters are kept; a zoomed one replaces the last zoomed one)
      if (zoomed) for (const k of [...perField.keys()]) if (!k.endsWith('|full')) perField.delete(k);
      off = document.createElement('canvas'); off.width = pw; off.height = ph;
      const oc = off.getContext('2d'), img = oc.createImageData(pw, ph), lut = getLut(sc.kind);
      const gx0 = v.x0 + (vl - pl) / plotW * vw, gxs = (vr - vl) / plotW * vw, gy1 = v.y0 + (pb - vt) / plotH * vh, gys = (vb - vt) / plotH * vh;
      for (let py = 0; py < ph; py++) {
        const y = gy1 - (py + 0.5) / ph * gys;
        for (let px = 0; px < pw; px++) {
          const x = gx0 + (px + 0.5) / pw * gxs;
          let val;
          if (f.curv) { const at = f.locate(x, y); if (!at) continue; val = sampleIdx(f, sc.arr, at[0], at[1]) * sc.scale; } // outside: blade or air
          else { if (y > bladeHeightAt(f, x)) continue; val = sampleField(f, sc.arr, x, y) * sc.scale; } // inside the blade: drawn as solid below
          const n = Math.round(scaleT(sc, val) * (LUT_N - 1)) * 3;
          const p = (py * pw + px) * 4;
          img.data[p] = lut[n]; img.data[p + 1] = lut[n + 1]; img.data[p + 2] = lut[n + 2]; img.data[p + 3] = 255;
        }
      }
      oc.putImageData(img, 0, 0);
      perField.set(key, off);
    }
    c.imageSmoothingEnabled = true;
    c.drawImage(off, vl, vt, vr - vl, vb - vt);
  }

  // mesh quality: each element filled by its quality (worse = stronger colour)
  const node = k => [X(f.gx[k]), Y(f.gy[k])];
  const elemPath = (ex, ey) => {
    const k = (i, j) => (2 * ey + j) * f.nx + 2 * ex + i, ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
    c.beginPath(); ring.forEach(([i, j], n) => { const [px, py] = node(k(i, j)); n ? c.lineTo(px, py) : c.moveTo(px, py); }); c.closePath();
  };
  if (mq) {
    const lut = getLut('seq'), lo = qCarrier.min;
    for (let ey = 0; ey < mq.nEy; ey++) for (let ex = 0; ex < mq.nEx; ex++) {
      elemPath(ex, ey); c.fillStyle = lutColor(lut, 1 - (mq.q[ex + mq.nEx * ey] - lo) / (1 - lo)); c.fill();
    }
  }

  // ---- solids as geometry --------------------------------------------
  // blade: everything above its surface y = h(x), from the band above the
  // plot down to the surface, bounded downstream by its exit face
  const bladeTop = Math.min(T - bladeBand, yTop - 2);
  const th = (s.exitAngle ?? 90) * Math.PI / 180;
  const sx = plotW / xRange, sy = plotH / yRange;
  // exit face, screen direction (right, up) including the vertical
  // exaggeration: from the metering edge (the domain ends there), or, with
  // the meniscus in the domain, on from the contact line (the face below it
  // is the mesh's top boundary). A face leaning downstream past the plot's
  // right end is drawn at most 12 px into the margin (the colorbar lives
  // there), then straight up.
  const dX = Math.cos(th) * sx, dY = Math.sin(th) * sy;
  const [xF0, yF0] = surf[surf.length - 1];
  const edgePx = f.curv ? topRow[f.iCorner] : [xR, yF0];
  const face = [[xF0, yF0]];
  {
    const tTop = (yF0 - bladeTop) / dY, xTop = xF0 + tTop * dX;
    if (xTop > xR + 12) { const t = (xR + 12 - xF0) / dX; face.push([xR + 12, yF0 - t * dY], [xR + 12, bladeTop]); }
    else if (xTop < xL) { const t = (xL - xF0) / dX; face.push([xL, yF0 - t * dY]); }
    else face.push([xTop, bladeTop]);
  }
  const bladePath = () => {
    c.beginPath(); c.moveTo(xL, bladeTop);
    for (const [px, py] of surf) c.lineTo(px, py);
    for (const [px, py] of face.slice(1)) c.lineTo(px, py);
    c.closePath();
  };
  c.save();
  bladePath(); c.clip();
  // (filled and hatched over what may be drawn on only: when zoomed the blade extends far off screen)
  c.fillStyle = cssVar('--blade'); c.fillRect(CR.l, CR.t, CR.r - CR.l, CR.b - CR.t);
  c.strokeStyle = ink; c.globalAlpha = 0.22; c.lineWidth = 1;
  const hh = CR.b - CR.t;
  for (let x = CR.l - hh; x < CR.r; x += 7) { c.beginPath(); c.moveTo(x, CR.b); c.lineTo(x + hh, CR.t); c.stroke(); }
  c.restore();
  c.strokeStyle = ink; c.lineWidth = 1.6;
  c.beginPath(); surf.forEach(([px, py], k) => k ? c.lineTo(px, py) : c.moveTo(px, py));
  for (const [px, py] of face.slice(1)) c.lineTo(px, py);
  c.stroke();
  if (f.curv) {
    // free surface, contact line to the domain end (air above it)
    c.strokeStyle = ink; c.lineWidth = 1.3;
    c.beginPath(); topRow.slice(f.iCL).forEach(([px, py], k) => k ? c.lineTo(px, py) : c.moveTo(px, py)); c.stroke();
    if (f.iCL !== f.iCorner) {
      // contact line
      c.fillStyle = surface; c.strokeStyle = ink; c.lineWidth = 1.5;
      c.beginPath(); c.arc(xF0, yF0, compact ? 2.5 : 3.5, 0, 7); c.fill(); c.stroke();
    }
  }

  // moving web
  const wl = Math.max(xL, CR.l), wr = Math.min(xR, CR.r);
  c.save();
  c.beginPath(); c.rect(wl, yBot, wr - wl, webBand); c.clip();
  c.fillStyle = cssVar('--fibre'); c.fillRect(wl, yBot, wr - wl, webBand);
  c.strokeStyle = muted; c.globalAlpha = 0.55; c.lineWidth = 1;
  for (let x = wl - webBand; x < wr; x += 9) { c.beginPath(); c.moveTo(x, yBot + webBand); c.lineTo(x + webBand * 0.45, yBot); c.stroke(); }
  c.restore();
  c.strokeStyle = ink; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(wl, yBot); c.lineTo(wr, yBot); c.stroke();

  c.font = `${fsz}px ${mono}`; c.textBaseline = 'middle';
  if (!compact && !zoomed) {
    // labels only where they fit (the edge marker also has a legend entry below the plot)
    const bl = s.bladeLabel || 'blade (fixed)', me = 'active metering edge';
    labelOn(c, bl, xL + 8, bladeTop + bladeBand / 2, ink, 'left');
    if (c.measureText(bl).width + c.measureText(me).width + 40 < edgePx[0] - xL) labelOn(c, me, edgePx[0] - 12, bladeTop + bladeBand / 2, ink, 'right');
    if (f.curv) labelOn(c, 'air', xR - 8, Math.max(yTop + 10, topRow[f.nx - 1][1] - 10), muted, 'right');
    labelOn(c, `web →  U = ${(s.webSpeed * 1000).toFixed(2)} mm/s`, xL + 8, yBot + webBand / 2 + 0.5, ink, 'left');
  }
  // active metering edge marker (downstream end of the land)
  c.fillStyle = cssVar('--bad'); c.strokeStyle = surface; c.lineWidth = 2;
  c.beginPath(); c.arc(edgePx[0], edgePx[1], compact ? 3.5 : 5, 0, 7); c.fill(); c.stroke();

  // ---- mesh: element edges (quadratic, through the mid nodes) and nodes --------
  if (s.mesh && f.curv) {
    const k = (i, j) => j * f.nx + i;
    const curve = (a, m, b) => { const [ax, ay] = node(a), [mx, my] = node(m), [bx, by] = node(b); c.quadraticCurveTo(2 * mx - (ax + bx) / 2, 2 * my - (ay + by) / 2, bx, by); };
    c.save();
    c.strokeStyle = ink; c.globalAlpha = mq ? 0.55 : 0.38; c.lineWidth = compact ? 0.5 : 0.7;
    c.beginPath();
    for (let j = 0; j < f.ny; j += 2) { c.moveTo(...node(k(0, j))); for (let i = 0; i + 2 < f.nx; i += 2) curve(k(i, j), k(i + 1, j), k(i + 2, j)); }
    for (let i = 0; i < f.nx; i += 2) { c.moveTo(...node(k(i, 0))); for (let j = 0; j + 2 < f.ny; j += 2) curve(k(i, j), k(i, j + 1), k(i, j + 2)); }
    c.stroke();
    // nodes: corner nodes filled, mid nodes smaller and hollow
    c.globalAlpha = mq ? 0.7 : 0.55;
    const rc = compact ? 1.1 : 1.5, rm = compact ? 0.8 : 1.1;
    c.fillStyle = ink; c.beginPath();
    for (let j = 0; j < f.ny; j += 2) for (let i = 0; i < f.nx; i += 2) { const [px, py] = node(k(i, j)); c.moveTo(px + rc, py); c.arc(px, py, rc, 0, 7); }
    c.fill();
    c.strokeStyle = ink; c.lineWidth = 0.8; c.beginPath();
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) { if (i % 2 === 0 && j % 2 === 0) continue; const [px, py] = node(k(i, j)); c.moveTo(px + rm, py); c.arc(px, py, rm, 0, 7); }
    c.stroke();
    c.restore();
    if (mq) {
      // the worst element, and any below 0.2, outlined
      c.save(); c.strokeStyle = cssVar('--bad'); c.lineWidth = 2;
      for (let ey = 0; ey < mq.nEy; ey++) for (let ex = 0; ex < mq.nEx; ex++) {
        const e = ex + mq.nEx * ey;
        if (e === mq.worstAt || mq.q[e] < 0.2) { elemPath(ex, ey); c.stroke(); }
      }
      c.restore();
    }
  }

  // ---- overlays --------------------------------------------------------
  const lw = s.lineWidth || 1.4;
  const lineLut = s.lineScalar ? getLut(s.lineScalar.kind) : null;
  if (s.streamlines) {
    c.save(); fluidPath(); c.clip();
    c.lineJoin = 'round'; c.lineCap = 'round';
    s.streamlines.forEach((ln, li) => {
      const pts = ln.points;
      if (pts.length < 2) return;
      c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1])));
      c.strokeStyle = surface; c.globalAlpha = 0.7; c.lineWidth = lw + 1.8; c.stroke(); c.globalAlpha = 1;
      if (lineLut) {
        const sc = s.lineScalar, span = sc.max - sc.min || 1;
        c.lineWidth = lw;
        for (let i = 1; i < pts.length; i++) {
          const xm = (pts[i][0] + pts[i - 1][0]) / 2, ym = (pts[i][1] + pts[i - 1][1]) / 2;
          const val = sc.perLine ? 0.5 * (ln.t[i] + ln.t[i - 1]) : sampleField(f, sc.arr, xm, ym);
          c.strokeStyle = lutColor(lineLut, scaleT(sc, sc.perLine ? val : val * sc.scale));
          c.beginPath(); c.moveTo(X(pts[i - 1][0]), Y(pts[i - 1][1])); c.lineTo(X(pts[i][0]), Y(pts[i][1])); c.stroke();
        }
      } else {
        c.strokeStyle = ink; c.lineWidth = lw; c.stroke();
      }
      // arrows staggered line to line (golden-ratio offset) so parallel
      // streamlines don't line their arrows up into a grid of columns
      const spacing = compact ? 150 : 170;
      if (s.arrows) drawLineArrows(c, pts, X, Y, spacing, spacing * (0.25 + ((li * 0.618) % 1) * 0.75), compact ? 3.5 : 4.5, lineLut ? null : ink, surface, lineLut, s.lineScalar, f, ln.t);
    });
    c.restore();
  }

  if (vectors) {
    const sx = plotW / xRange, sy = plotH / yRange; // px per metre, incl. vertical exaggeration
    const vecLut = s.vectorColor ? getLut(s.vectorScalar.kind) : null;
    const vs = s.vectorScalar;
    for (const q of vectors) {
      const px = X(q.x), py = Y(q.y);
      const ex = q.u * sx, ey = -q.v * sy, em = Math.hypot(ex, ey);
      if (!(em > 0) || !(q.speed > 0)) continue;
      const len = s.vectorNormalize ? 0.72 * s.vectorSpacing : 0.9 * s.vectorSpacing * (q.speed / s.vectorVmax) * (s.vectorScale || 1);
      if (len < 1.5) { c.fillStyle = ink; c.fillRect(px - 0.75, py - 0.75, 1.5, 1.5); continue; }
      const dxs = ex / em * len, dys = ey / em * len;
      const col = vecLut ? lutColor(vecLut, scaleT(vs, q.speed * vs.scale)) : ink;
      drawVectorArrow(c, px - dxs / 2, py - dys / 2, px + dxs / 2, py + dys / 2, col, surface, compact ? 3.5 : 4.5);
    }
  }

  // auto seeds are omitted in the small multiples (a column of dots on the inflow edge is all they'd add there)
  if (s.seeds && (s.manualSeeds || !compact)) {
    for (const [x, y] of s.seeds) {
      c.beginPath(); c.arc(X(x), Y(y), s.manualSeeds ? 4 : 2, 0, 7);
      c.fillStyle = surface; c.fill(); c.lineWidth = s.manualSeeds ? 2 : 1.3; c.strokeStyle = s.manualSeeds ? cssVar('--accent') : ink; c.stroke();
    }
  }

  // named probes: a diamond and the name (hollow where the point is outside this location's fluid)
  if (s.probes) {
    c.font = `${compact ? 9.5 : 10.5}px ${mono}`; c.textBaseline = 'middle';
    for (const q of s.probes) {
      const px = X(q.x), py = Y(q.y), r = compact ? 4 : 5;
      if (px < CR.l - 1 || px > CR.r + 1 || py < CR.t - 1 || py > CR.b + 1) continue;
      c.beginPath(); c.moveTo(px, py - r); c.lineTo(px + r, py); c.lineTo(px, py + r); c.lineTo(px - r, py); c.closePath();
      c.lineWidth = 3; c.strokeStyle = surface; c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = ink; c.stroke();
      if (q.inside) { c.fillStyle = cssVar('--warn'); c.fill(); }
      labelOn(c, q.name, px + r + 3, py, ink, 'left');
    }
  }

  c.restore();   // (end of the drawable area's clip)

  // ---- axes ------------------------------------------------------------
  c.fillStyle = muted; c.strokeStyle = cssVar('--line'); c.lineWidth = 1;
  c.font = `${fsz}px ${mono}`;
  c.textAlign = 'center'; c.textBaseline = 'top';
  const xTickY = pb + webBand + 3;
  const tickTxt = (t, ticks) => {
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    return t.toFixed(Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9) + (step / Math.pow(10, Math.floor(Math.log10(step))) % 1 ? 1 : 0))));
  };
  const xt = niceTicks(v.x0 * 1000, v.x1 * 1000, compact ? 5 : 8);
  for (const t of xt) {
    const px = X(t / 1000);
    if (px < pl - 0.5 || px > pr + 0.5) continue;
    c.beginPath(); c.moveTo(px, pb + webBand); c.lineTo(px, pb + webBand + 3); c.stroke();
    c.fillText(tickTxt(t, xt), px, xTickY + 2);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  const yt = niceTicks(v.y0 * 1000, v.y1 * 1000, compact ? 2 : 4);
  for (const t of yt) {
    if (t / 1000 > f.Ly * 1.0001) continue;
    const py = Y(t / 1000);
    if (py < pt - 0.5 || py > pb + 0.5) continue;
    c.beginPath(); c.moveTo(pl - 3, py); c.lineTo(pl, py); c.stroke();
    c.fillText(tickTxt(t, yt), pl - 5, py);
  }
  if (!compact) {
    c.textBaseline = 'top'; c.textAlign = 'center';
    const mid = 'x (mm), machine direction →', inl = 'inflow from bead', outl = f.curv ? 'film outflow' : 'outflow at edge';
    const roomy = !zoomed && c.measureText(mid).width + c.measureText(inl).width + c.measureText(outl).width + 40 < xR - xL;
    c.fillText(roomy || zoomed ? mid : 'x (mm) →', (pl + pr) / 2, xTickY + 17);
    if (roomy) {
      c.textAlign = 'left'; c.fillText(inl, xL, xTickY + 17);
      c.textAlign = 'right'; c.fillText(outl, xR, xTickY + 17);
    }
    c.save(); c.translate(12, (vt + vb) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('y (mm)', 0, 0); c.restore();
  }
  // stated vertical exaggeration -- the plot is never silently stretched
  // (single view states the vertical exaggeration in its HTML caption line)
  if (compact) {
    c.fillStyle = muted; c.textAlign = 'right'; c.textBaseline = 'alphabetic';
    c.fillText((zoomed ? 'zoomed · ' : '') + (exaggeration > 1.05 ? `y ×${exaggeration.toFixed(1)}` : exaggeration < 0.95 ? `y ×${exaggeration.toFixed(2)}` : 'true scale'), pr, titleH - 6);
    if (s.title) { c.textAlign = 'left'; c.fillStyle = ink; c.font = `500 11.5px ${mono}`; c.fillText(s.title, pl, titleH - 6); }
  }

  // ---- colorbar ----------------------------------------------------------
  let cbar = null;   // (its area on screen, returned: a click there opens the colour controls)
  if (carrier) {
    const bx = pr + 16, bw = compact ? 9 : 11, by0 = vt, by1 = vb, lut = getLut(carrier.kind);
    // (the bar is linear in the scale's own coordinate: log values on a log scale; bands as bands)
    const band = t => carrier.levels > 1 ? Math.min(carrier.levels - 1, Math.floor(t * carrier.levels)) / (carrier.levels - 1) : t;
    for (let py = Math.floor(by0); py < by1; py++) {
      const rel = band(Math.min(1, Math.max(0, 1 - (py + 0.5 - by0) / (by1 - by0))));
      c.fillStyle = lutColor(lut, carrier.reverse ? 1 - rel : rel);   // (reverse: low values in the strong colour)
      c.fillRect(bx, py, bw, 1);
    }
    c.strokeStyle = cssVar('--line'); c.lineWidth = 1; c.strokeRect(bx + 0.5, by0 + 0.5, bw - 1, by1 - by0 - 1);
    c.fillStyle = muted; c.font = `${compact ? 9.5 : 10.5}px ${mono}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    const ticks = scaleTicks(carrier, compact ? 3 : 4);
    const relOf = t => carrier.log ? (Math.log(t) - Math.log(carrier.min)) / ((Math.log(carrier.max) - Math.log(carrier.min)) || 1) : (t - carrier.min) / ((carrier.max - carrier.min) || 1);
    for (const t of ticks) {
      const py = by1 - relOf(t) * (by1 - by0);
      if (py < by0 - 0.5 || py > by1 + 0.5) continue;
      c.fillText(Math.abs(t) >= 1e4 || (carrier.log && Math.abs(t) < 1e-2) ? t.toExponential(0) : carrier.log ? String(+t.toPrecision(2)) : tickTxt(t, ticks), bx + bw + 4, py);
    }
    c.textBaseline = 'alphabetic'; c.fillStyle = ink;
    c.fillText(carrier.short + (carrier.capped ? ' ↑cap' : '') + (carrier.log ? ' (log)' : ''), bx, by0 - (compact ? 5 : 20));
    if (!compact) { c.fillStyle = muted; c.fillText(carrier.unit, bx, by0 - 8); }
    cbar = { x: bx - 4, y: by0 - (compact ? 16 : 30), w: w - bx + 4, h: by1 - by0 + (compact ? 20 : 36) };
  }

  return {
    left: vl, right: vr, top: vt, bottom: vb, exaggeration, zoomed, view: v, full, cbar,
    plot: { l: pl, r: pr, t: pt, b: pb },
    toPhys(px, py) {
      if (px < vl || px > vr || py < vt || py > vb) return null;
      return [v.x0 + (px - pl) / plotW * vw, v.y0 + (pb - py) / plotH * vh];
    },
    // (any screen point, inside the plot or not: for dragging and boxes)
    toPhysAny: (px, py) => [v.x0 + (px - pl) / plotW * vw, v.y0 + (pb - py) / plotH * vh],
    toScreen: (x, y) => [X(x), Y(y)],
  };
}

/** A zoom window kept inside the domain `full` and no smaller than 1/2000 of it in either direction. */
function clampView(v, full) {
  const fw = full.x1 - full.x0, fh = full.y1 - full.y0;
  let w = Math.min(fw, Math.max(fw / 2000, v.x1 - v.x0)), h = Math.min(fh, Math.max(fh / 2000, v.y1 - v.y0));
  let x0 = (v.x0 + v.x1) / 2 - w / 2, y0 = (v.y0 + v.y1) / 2 - h / 2;
  x0 = Math.min(full.x1 - w, Math.max(full.x0, x0)); y0 = Math.min(full.y1 - h, Math.max(full.y0, y0));
  return { x0, x1: x0 + w, y0, y1: y0 + h };
}

function labelOn(c, text, x, y, color, align) {
  c.textAlign = align; c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = cssVar('--surface');
  c.globalAlpha = 0.9; c.strokeText(text, x, y); c.globalAlpha = 1;
  c.fillStyle = color; c.fillText(text, x, y);
}

/** Direction chevrons at regular screen-space intervals along a streamline (points are in flow order). */
function drawLineArrows(c, pts, X, Y, spacing, firstAt, size, color, halo, lut, sc, f, times) {
  let acc = firstAt;
  for (let i = 1; i < pts.length; i++) {
    const x0 = X(pts[i - 1][0]), y0 = Y(pts[i - 1][1]), x1 = X(pts[i][0]), y1 = Y(pts[i][1]);
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg === 0) continue;
    while (acc <= seg) {
      const t = acc / seg, ax = x0 + (x1 - x0) * t, ay = y0 + (y1 - y0) * t;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      let col = color;
      if (lut) { const val = sc.perLine ? times[i] : sampleField(f, sc.arr, pts[i][0], pts[i][1]) * sc.scale; col = lutColor(lut, scaleT(sc, val)); }
      c.save(); c.translate(ax, ay); c.rotate(ang);
      c.beginPath(); c.moveTo(size, 0); c.lineTo(-size, -size * 0.8); c.lineTo(-size * 0.4, 0); c.lineTo(-size, size * 0.8); c.closePath();
      c.lineWidth = 2; c.strokeStyle = halo; c.stroke(); c.fillStyle = col; c.fill();
      c.restore();
      acc += spacing;
    }
    acc -= seg;
  }
}

function drawVectorArrow(c, x0, y0, x1, y1, color, halo, head) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const len = Math.hypot(x1 - x0, y1 - y0), hd = Math.min(head, len * 0.45);
  const bx = x1 - Math.cos(ang) * hd, by = y1 - Math.sin(ang) * hd;
  c.lineCap = 'round';
  c.strokeStyle = halo; c.lineWidth = 3; c.beginPath(); c.moveTo(x0, y0); c.lineTo(bx, by); c.stroke();
  c.strokeStyle = color; c.lineWidth = 1.3; c.beginPath(); c.moveTo(x0, y0); c.lineTo(bx, by); c.stroke();
  c.beginPath(); c.moveTo(x1, y1);
  c.lineTo(x1 - hd * Math.cos(ang - 0.45), y1 - hd * Math.sin(ang - 0.45));
  c.lineTo(x1 - hd * Math.cos(ang + 0.45), y1 - hd * Math.sin(ang + 0.45));
  c.closePath(); c.lineWidth = 1.5; c.strokeStyle = halo; c.stroke(); c.fillStyle = color; c.fill();
}
