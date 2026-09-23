/*
 * cfd-plot.js — CFD post-processing view of one solved 2D field: a colour
 * raster of a scalar over the fluid domain drawn to physical scale (mm
 * axes, stated vertical exaggeration), the solids drawn as geometry (blade
 * land above, moving web below, active metering edge marked), a colorbar,
 * and streamline / velocity-vector / seed overlays.
 *
 * Canvas 2D only (the app has no plotting library -- see draw.js); reads
 * theme tokens via cssVar so it follows light/dark like the other tabs.
 * Pure drawing: never touches the solver. Depends on draw.js (setupCanvas,
 * cssVar) and cfd-flowviz.js (sampleField).
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
  if (kind === 'seq') {
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
 *   lineScalar   same shape, or null  -- colour streamlines by this instead (raster then off)
 *   vectorColor  boolean -- colour vectors by |V| using `vectorScalar`
 *   vectorScalar same shape as scalar (|V|), used when vectorColor
 *   streamlines  [{points:[[x,y]...]}] | null
 *   lineWidth, arrows
 *   vectorSample (nCols, nRows) => [{x,y,u,v,speed}] | null -- called with a lattice sized from
 *                vectorSpacing (px), so arrows are evenly spaced on screen; plus vectorScale,
 *                vectorNormalize, vectorVmax (shared across plots in comparison mode)
 *   seeds        [[x,y]...], manualSeeds boolean
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
  plotH = Math.max(compact ? 70 : 110, Math.min(plotH, compact ? 190 : 420));
  const exaggeration = (plotH / plotW) * (xRange / yRange);

  const T = titleH + bladeBand;
  const totalH = T + plotH + webBand + axisH;
  const { c, w } = setupCanvas(cv, totalH / w0);

  const X = x => L + x / xRange * plotW;
  const Y = y => T + plotH - y / yRange * plotH;
  const ink = cssVar('--ink'), muted = cssVar('--muted'), surface = cssVar('--surface');
  const mono = cssVar('--mono'), fsz = compact ? 10.5 : 11.5;
  c.clearRect(0, 0, w, totalH);

  const yTop = Y(f.Ly), yBot = Y(0), xL = X(0), xR = X(f.Lx);

  // vectors on a lattice with even spacing on screen (so density is the
  // same visually whatever the vertical exaggeration)
  const vectors = s.vectorSample
    ? s.vectorSample(Math.max(4, Math.round((xR - xL) / s.vectorSpacing)), Math.max(2, Math.round((yBot - yTop) / s.vectorSpacing)))
    : null;

  // ---- colour carrier: one colour scale per plot --------------------
  const carrier = s.lineScalar || (s.vectorColor && vectors ? s.vectorScalar : null) || s.scalar;
  const rasterOn = !!s.scalar && !s.lineScalar && !(s.vectorColor && vectors);

  // fluid background
  c.fillStyle = surface; c.fillRect(xL, yTop, xR - xL, yBot - yTop);
  if (rasterOn) {
    const sc = s.scalar, pw = Math.round(xR - xL), ph = Math.max(1, Math.round(yBot - yTop));
    let perField = rasterCache.get(f);
    if (!perField) { perField = new Map(); rasterCache.set(f, perField); }
    const dark = isDarkTheme();
    const key = [sc.key, pw, ph, sc.min, sc.max, sc.kind, dark].join('|');
    let off = perField.get(key);
    if (!off) {
      off = document.createElement('canvas'); off.width = pw; off.height = ph;
      const oc = off.getContext('2d'), img = oc.createImageData(pw, ph), lut = getLut(sc.kind);
      const span = sc.max - sc.min || 1;
      for (let py = 0; py < ph; py++) {
        const y = (1 - (py + 0.5) / ph) * f.Ly;
        for (let px = 0; px < pw; px++) {
          const x = (px + 0.5) / pw * f.Lx;
          const val = sampleField(f, sc.arr, x, y) * sc.scale;
          const n = Math.round(Math.min(1, Math.max(0, (val - sc.min) / span)) * (LUT_N - 1)) * 3;
          const p = (py * pw + px) * 4;
          img.data[p] = lut[n]; img.data[p + 1] = lut[n + 1]; img.data[p + 2] = lut[n + 2]; img.data[p + 3] = 255;
        }
      }
      oc.putImageData(img, 0, 0);
      perField.set(key, off);
    }
    c.imageSmoothingEnabled = true;
    c.drawImage(off, xL, yTop, xR - xL, yBot - yTop);
  }

  // ---- solids as geometry --------------------------------------------
  // blade land: from the band above the plot down to this location's gap
  const bladeTop = T - bladeBand;
  c.save();
  c.beginPath(); c.rect(xL, bladeTop, xR - xL, yTop - bladeTop); c.clip();
  c.fillStyle = cssVar('--blade'); c.fillRect(xL, bladeTop, xR - xL, yTop - bladeTop);
  c.strokeStyle = ink; c.globalAlpha = 0.22; c.lineWidth = 1;
  for (let x = xL - (yTop - bladeTop); x < xR; x += 7) { c.beginPath(); c.moveTo(x, yTop); c.lineTo(x + (yTop - bladeTop), bladeTop); c.stroke(); }
  c.restore();
  c.strokeStyle = ink; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(xL, yTop); c.lineTo(xR, yTop); c.lineTo(xR, bladeTop); c.stroke();

  // moving web
  c.save();
  c.beginPath(); c.rect(xL, yBot, xR - xL, webBand); c.clip();
  c.fillStyle = cssVar('--fibre'); c.fillRect(xL, yBot, xR - xL, webBand);
  c.strokeStyle = muted; c.globalAlpha = 0.55; c.lineWidth = 1;
  for (let x = xL - webBand; x < xR; x += 9) { c.beginPath(); c.moveTo(x, yBot + webBand); c.lineTo(x + webBand * 0.45, yBot); c.stroke(); }
  c.restore();
  c.strokeStyle = ink; c.lineWidth = 1.6;
  c.beginPath(); c.moveTo(xL, yBot); c.lineTo(xR, yBot); c.stroke();

  c.font = `${fsz}px ${mono}`; c.textBaseline = 'middle';
  if (!compact) {
    // labels only where they fit (the edge marker also has a legend entry below the plot)
    const bl = 'blade land (fixed)', me = 'active metering edge';
    labelOn(c, bl, xL + 8, bladeTop + bladeBand / 2, ink, 'left');
    if (c.measureText(bl).width + c.measureText(me).width + 40 < xR - xL) labelOn(c, me, xR - 12, bladeTop + bladeBand / 2, ink, 'right');
    labelOn(c, `web →  U = ${(s.webSpeed * 1000).toFixed(2)} mm/s`, xL + 8, yBot + webBand / 2 + 0.5, ink, 'left');
  }
  // active metering edge marker (downstream end of the land)
  c.fillStyle = cssVar('--bad'); c.strokeStyle = surface; c.lineWidth = 2;
  c.beginPath(); c.arc(xR, yTop, compact ? 3.5 : 5, 0, 7); c.fill(); c.stroke();

  // ---- overlays --------------------------------------------------------
  const lw = s.lineWidth || 1.4;
  const lineLut = s.lineScalar ? getLut(s.lineScalar.kind) : null;
  if (s.streamlines) {
    c.save(); c.beginPath(); c.rect(xL, yTop - 1, xR - xL, yBot - yTop + 2); c.clip();
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
          c.strokeStyle = lutColor(lineLut, (sampleField(f, sc.arr, xm, ym) * sc.scale - sc.min) / span);
          c.beginPath(); c.moveTo(X(pts[i - 1][0]), Y(pts[i - 1][1])); c.lineTo(X(pts[i][0]), Y(pts[i][1])); c.stroke();
        }
      } else {
        c.strokeStyle = ink; c.lineWidth = lw; c.stroke();
      }
      // arrows staggered line to line (golden-ratio offset) so parallel
      // streamlines don't line their arrows up into a grid of columns
      const spacing = compact ? 150 : 170;
      if (s.arrows) drawLineArrows(c, pts, X, Y, spacing, spacing * (0.25 + ((li * 0.618) % 1) * 0.75), compact ? 3.5 : 4.5, lineLut ? null : ink, surface, lineLut, s.lineScalar, f);
    });
    c.restore();
  }

  if (vectors) {
    const sx = plotW / xRange, sy = plotH / yRange; // px per metre, incl. vertical exaggeration
    const vecLut = s.vectorColor ? getLut('seq') : null;
    const vs = s.vectorScalar;
    for (const q of vectors) {
      const px = X(q.x), py = Y(q.y);
      const ex = q.u * sx, ey = -q.v * sy, em = Math.hypot(ex, ey);
      if (!(em > 0) || !(q.speed > 0)) continue;
      const len = s.vectorNormalize ? 0.72 * s.vectorSpacing : 0.9 * s.vectorSpacing * (q.speed / s.vectorVmax) * (s.vectorScale || 1);
      if (len < 1.5) { c.fillStyle = ink; c.fillRect(px - 0.75, py - 0.75, 1.5, 1.5); continue; }
      const dxs = ex / em * len, dys = ey / em * len;
      const col = vecLut ? lutColor(vecLut, (q.speed * vs.scale - vs.min) / ((vs.max - vs.min) || 1)) : ink;
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

  // ---- axes ------------------------------------------------------------
  c.fillStyle = muted; c.strokeStyle = cssVar('--line'); c.lineWidth = 1;
  c.font = `${fsz}px ${mono}`;
  c.textAlign = 'center'; c.textBaseline = 'top';
  const xTickY = yBot + webBand + 3;
  const tickTxt = (t, ticks) => {
    const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
    return t.toFixed(Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9) + (step / Math.pow(10, Math.floor(Math.log10(step))) % 1 ? 1 : 0))));
  };
  const xt = niceTicks(0, f.Lx * 1000, compact ? 5 : 8);
  for (const t of xt) {
    const px = X(t / 1000);
    c.beginPath(); c.moveTo(px, yBot + webBand); c.lineTo(px, yBot + webBand + 3); c.stroke();
    c.fillText(tickTxt(t, xt), px, xTickY + 2);
  }
  c.textAlign = 'right'; c.textBaseline = 'middle';
  const yt = niceTicks(0, yRange * 1000, compact ? 2 : 4);
  for (const t of yt) {
    if (t / 1000 > f.Ly * 1.0001) continue;
    const py = Y(t / 1000);
    c.beginPath(); c.moveTo(xL - 3, py); c.lineTo(xL, py); c.stroke();
    c.fillText(tickTxt(t, yt), xL - 5, py);
  }
  if (!compact) {
    c.textBaseline = 'top'; c.textAlign = 'center';
    const mid = 'x (mm), machine direction →', inl = 'inflow from bead', outl = 'outflow at edge';
    const roomy = c.measureText(mid).width + c.measureText(inl).width + c.measureText(outl).width + 40 < xR - xL;
    c.fillText(roomy ? mid : 'x (mm) →', (xL + xR) / 2, xTickY + 17);
    if (roomy) {
      c.textAlign = 'left'; c.fillText(inl, xL, xTickY + 17);
      c.textAlign = 'right'; c.fillText(outl, xR, xTickY + 17);
    }
    c.save(); c.translate(12, (yTop + yBot) / 2); c.rotate(-Math.PI / 2); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('y (mm)', 0, 0); c.restore();
  }
  // stated vertical exaggeration -- the plot is never silently stretched
  // (single view states the vertical exaggeration in its HTML caption line)
  if (compact) {
    c.fillStyle = muted; c.textAlign = 'right'; c.textBaseline = 'alphabetic';
    c.fillText(exaggeration > 1.05 ? `y ×${exaggeration.toFixed(1)}` : 'true scale', xR, titleH - 6);
    if (s.title) { c.textAlign = 'left'; c.fillStyle = ink; c.font = `500 11.5px ${mono}`; c.fillText(s.title, xL, titleH - 6); }
  }

  // ---- colorbar ----------------------------------------------------------
  if (carrier) {
    const bx = xR + 16, bw = compact ? 9 : 11, by0 = yTop, by1 = yBot, lut = getLut(carrier.kind);
    for (let py = Math.floor(by0); py < by1; py++) {
      c.fillStyle = lutColor(lut, 1 - (py - by0) / (by1 - by0));
      c.fillRect(bx, py, bw, 1);
    }
    c.strokeStyle = cssVar('--line'); c.lineWidth = 1; c.strokeRect(bx + 0.5, by0 + 0.5, bw - 1, by1 - by0 - 1);
    c.fillStyle = muted; c.font = `${compact ? 9.5 : 10.5}px ${mono}`; c.textAlign = 'left'; c.textBaseline = 'middle';
    const ticks = niceTicks(carrier.min, carrier.max, compact ? 3 : 4);
    for (const t of ticks) {
      const py = by1 - (t - carrier.min) / ((carrier.max - carrier.min) || 1) * (by1 - by0);
      if (py < by0 - 0.5 || py > by1 + 0.5) continue;
      c.fillText(Math.abs(t) >= 1e4 ? t.toExponential(1) : tickTxt(t, ticks), bx + bw + 4, py);
    }
    c.textBaseline = 'alphabetic'; c.fillStyle = ink;
    c.fillText(carrier.short + (carrier.capped ? ' ↑cap' : ''), bx, by0 - (compact ? 4 : 16));
    if (!compact) { c.fillStyle = muted; c.fillText(carrier.unit, bx, by0 - 4); }
  }

  return {
    left: xL, right: xR, top: yTop, bottom: yBot, exaggeration,
    toPhys(px, py) {
      if (px < xL || px > xR || py < yTop || py > yBot) return null;
      return [(px - xL) / plotW * xRange, (T + plotH - py) / plotH * yRange];
    },
    toScreen: (x, y) => [X(x), Y(y)],
  };
}

function labelOn(c, text, x, y, color, align) {
  c.textAlign = align; c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = cssVar('--surface');
  c.globalAlpha = 0.9; c.strokeText(text, x, y); c.globalAlpha = 1;
  c.fillStyle = color; c.fillText(text, x, y);
}

/** Direction chevrons at regular screen-space intervals along a streamline (points are in flow order). */
function drawLineArrows(c, pts, X, Y, spacing, firstAt, size, color, halo, lut, sc, f) {
  let acc = firstAt;
  for (let i = 1; i < pts.length; i++) {
    const x0 = X(pts[i - 1][0]), y0 = Y(pts[i - 1][1]), x1 = X(pts[i][0]), y1 = Y(pts[i][1]);
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (seg === 0) continue;
    while (acc <= seg) {
      const t = acc / seg, ax = x0 + (x1 - x0) * t, ay = y0 + (y1 - y0) * t;
      const ang = Math.atan2(y1 - y0, x1 - x0);
      let col = color;
      if (lut) { const span = sc.max - sc.min || 1; col = lutColor(lut, (sampleField(f, sc.arr, pts[i][0], pts[i][1]) * sc.scale - sc.min) / span); }
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
