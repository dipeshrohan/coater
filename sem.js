'use strict';
/*
 * sem.js — the flakes' angles in an SEM cross-section of the film (GO-2, the measured side of the alignment).
 *
 * The image is a cut through the dried film: along the web's motion (MD) or across it (CD). The user marks the web's
 * line (two points; the cut may be tilted in the image) and a point on the film's top; each angle is then to the web's
 * line (−90..90°, + rising in the direction the web's line was drawn: draw it in the web's motion) and each depth a fraction of the film, 0 at the
 * web and 1 at its top (as the model's streamlines are placed).
 *  - Read automatically from the image's local structure, as ImageJ's OrientationJ does: the structure tensor
 *    J = G_w * (∇I ∇Iᵀ) (the grey levels' gradient, smoothed by a Gaussian of `sigma` px first; the tensor over a
 *    Gaussian window of `window` px); a flake edge-on is a bright or dark streak, along which the grey levels change
 *    least: its direction is J's eigenvector of the smaller eigenvalue; its coherence (λ1 − λ2) / (λ1 + λ2) says how
 *    clearly the spot is one direction (1: a clean streak, 0: no direction). Points on a grid (`step` px) inside the
 *    film, each weighted by its coherence, those with too little texture (energy λ1 + λ2 below `minEnergy` × the film's
 *    mean) or too little direction (coherence below `minCoh`) left out.
 *  - Or clicked by hand: both ends of each flake; its angle and the depth of its middle.
 * Pure functions on a grey image (Float32Array, w × h, row by row from the top): run in Node for the checks.
 */

/** Grey levels (0..1) of RGBA pixels (canvas ImageData's data): the luminance. */
function semGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = (0.2126 * data[4 * i] + 0.7152 * data[4 * i + 1] + 0.0722 * data[4 * i + 2]) / 255;
  return g;
}

/** A Gaussian blur of a (w × h) with standard deviation s px (separable; the edges held). */
function semBlur(a, w, h, s) {
  if (!(s > 0)) return Float32Array.from(a);
  const r = Math.max(1, Math.ceil(3 * s)), k = new Float32Array(2 * r + 1);
  let sum = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * s * s)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * a[y * w + Math.min(w - 1, Math.max(0, x + i))];
    t[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let i = -r; i <= r; i++) v += k[i + r] * t[Math.min(h - 1, Math.max(0, y + i)) * w + x];
    o[y * w + x] = v;
  }
  return o;
}

/**
 * The grey levels' gradient (y up) by Gaussian derivative filters of σ px (the derivative of the image smoothed by
 * the Gaussian, sampled: much the same in every direction, unlike plain differences, which read streaks at a slant
 * a degree or two toward 45°). The derivative kernel is scaled so a ramp's slope comes out exactly.
 */
function semGrad(a, w, h, s) {
  s = Math.max(0.5, s);
  const r = Math.max(2, Math.ceil(3 * s)), g = new Float32Array(2 * r + 1), d = new Float32Array(2 * r + 1);
  let sg = 0, si2 = 0;
  for (let i = -r; i <= r; i++) { g[i + r] = Math.exp(-i * i / (2 * s * s)); sg += g[i + r]; si2 += i * i * g[i + r]; }
  for (let i = -r; i <= r; i++) { d[i + r] = i * g[i + r] / si2; g[i + r] /= sg; }
  const at = (x, y) => a[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const tx = new Float32Array(w * h), ty = new Float32Array(w * h);
  // (across x: the derivative for gx, the Gaussian for gy)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let u = 0, v = 0; for (let i = -r; i <= r; i++) { const q = at(x + i, y); u += d[i + r] * q; v += g[i + r] * q; }
    tx[y * w + x] = u; ty[y * w + x] = v;
  }
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  const bt = (A, x, y) => A[Math.min(h - 1, Math.max(0, y)) * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let u = 0, v = 0; for (let i = -r; i <= r; i++) { u += g[i + r] * bt(tx, x, y + i); v += d[i + r] * bt(ty, x, y + i); }
    gx[y * w + x] = u; gy[y * w + x] = -v;   // (image rows run down: y up is minus)
  }
  return { gx, gy };
}

/**
 * The structure tensor of a grey image: per pixel the streaks' direction (rad, in the image with y up: 0 along +x,
 * + counter-clockwise, −π/2..π/2), their coherence (0..1) and the texture's energy (λ1 + λ2).
 */
function semStructure(gray, w, h, { sigma = 1, window = 3 } = {}) {
  const N = w * h, { gx, gy } = semGrad(gray, w, h, sigma);
  const xx = new Float32Array(N), xy = new Float32Array(N), yy = new Float32Array(N);
  for (let i = 0; i < N; i++) { xx[i] = gx[i] * gx[i]; xy[i] = gx[i] * gy[i]; yy[i] = gy[i] * gy[i]; }
  const Jxx = semBlur(xx, w, h, window), Jxy = semBlur(xy, w, h, window), Jyy = semBlur(yy, w, h, window);
  const theta = new Float32Array(N), coh = new Float32Array(N), energy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = Jxx[i], c = Jyy[i], d = Jxy[i], tr = a + c, df = Math.sqrt((a - c) * (a - c) + 4 * d * d);
    // (the gradient's main direction: ½ atan2(2 Jxy, Jxx − Jyy); the streaks run across it)
    let t = 0.5 * Math.atan2(2 * d, a - c) + Math.PI / 2;
    if (t > Math.PI / 2) t -= Math.PI;
    theta[i] = t; energy[i] = tr; coh[i] = tr > 0 ? df / tr : 0;
  }
  return { theta, coh, energy };
}

/**
 * The film's frame in the image: geom { web: [x1, y1, x2, y2] (px, the web's line, drawn in the web's direction),
 * top: [x, y] (a point on the film's top) }. Returns { depth(x, y) (0 web .. 1 top), ang (the web line's angle, rad,
 * y up), thick (px) } or null when the top is on the web's line.
 */
function semFrame(geom) {
  const [x1, y1, x2, y2] = geom.web, dx = x2 - x1, dy = -(y2 - y1), L = Math.hypot(dx, dy);
  if (!(L > 0)) return null;
  // (the unit normal toward the top; image y down, so work with y up)
  let nx = -dy / L, ny = dx / L;
  const tx = geom.top[0] - x1, ty = -(geom.top[1] - y1);
  let thick = tx * nx + ty * ny;
  if (thick < 0) { nx = -nx; ny = -ny; thick = -thick; }
  if (!(thick > 0)) return null;
  return { ang: Math.atan2(dy, dx), tx: dx / L, ty: dy / L, thick, nx, ny, depth: (x, y) => ((x - x1) * nx + (-(y - y1)) * ny) / thick };
}
/**
 * A direction in the image (rad, y up) as its angle to the web's line in the film's own frame: along the web's line
 * as drawn and up toward the film's top (so + rises in the direction the line was drawn, whichever way that is on the
 * image, as the model's traces rise in the web's motion), degrees folded into −90..90.
 */
function semRel(t, fr) {
  const c = Math.cos(t), s = Math.sin(t);
  let a = Math.atan2(c * fr.nx + s * fr.ny, c * fr.tx + s * fr.ty) * 180 / Math.PI;
  return ((a + 90) % 180 + 180) % 180 - 90;
}

/**
 * The flakes' angles read automatically: { angles (deg to the web's line), depths (0..1), weights (coherence), xs, ys
 * (their pixels) } at the grid points inside the film. opts: sigma, window (px), step (px between points: default the window's 2σ), minCoh
 * (0.1), minEnergy (0.05 of the film's mean).
 */
function semAngles(gray, w, h, geom, opts = {}) {
  const fr = semFrame(geom);
  if (!fr) return { angles: [], depths: [], weights: [], xs: [], ys: [] };
  const { sigma = 1, window = 3, minCoh = 0.1, minEnergy = 0.05 } = opts, step = Math.max(1, Math.round(opts.step || 2 * window));
  const st = semStructure(gray, w, h, { sigma, window }), pts = [];
  // (away from the image's edges by the window's reach, where the blur holds the edge)
  const m = Math.ceil(3 * window + 2 * sigma);
  for (let y = m; y < h - m; y += step) for (let x = m; x < w - m; x += step) {
    const d = fr.depth(x, y);
    if (d >= 0 && d <= 1) pts.push([x, y, d]);
  }
  if (!pts.length) return { angles: [], depths: [], weights: [], xs: [], ys: [] };
  const eMean = pts.reduce((a, [x, y]) => a + st.energy[y * w + x], 0) / pts.length;
  const out = { angles: [], depths: [], weights: [], xs: [], ys: [] };
  for (const [x, y, d] of pts) {
    const i = y * w + x;
    if (st.energy[i] < minEnergy * eMean || st.coh[i] < minCoh) continue;
    out.angles.push(semRel(st.theta[i], fr)); out.depths.push(d); out.weights.push(st.coh[i]); out.xs.push(x); out.ys.push(y);
  }
  return out;
}

/** Flakes clicked by hand ([x1, y1, x2, y2] each, px): { angles (deg to the web's line), depths (of each middle), weights (1) }. */
function semHand(clicks, geom) {
  const fr = semFrame(geom), out = { angles: [], depths: [], weights: [] };
  if (!fr) return out;
  for (const [x1, y1, x2, y2] of clicks) {
    if (x1 === x2 && y1 === y2) continue;
    out.angles.push(semRel(Math.atan2(-(y2 - y1), x2 - x1), fr));
    out.depths.push(fr.depth((x1 + x2) / 2, (y1 + y2) / 2)); out.weights.push(1);
  }
  return out;
}

/**
 * A table of flake angles (text: CSV, tab or semicolon separated, a header row naming the columns): cut (MD / CD, or
 * along / across), depth (µm from the web, or a fraction 0..1 with thickness blank), angle (degrees to the web).
 * Columns found by their names (cut, depth, angle; thickness optional: the film's, µm); rows without an angle left
 * out. Returns { rows: [[cut, depth (µm or fraction), angle]], thickness (µm, or null), fraction (the depths are
 * fractions), skipped, problems }.
 */
function semTable(text) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^#/.test(l));
  const problems = [];
  if (!lines.length) return { rows: [], thickness: null, fraction: false, skipped: 0, problems: ['the table is empty'] };
  const sep = /\t/.test(lines[0]) ? '\t' : /;/.test(lines[0]) ? ';' : ',';
  const cells = l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
  const head = cells(lines[0]).map(c => c.toLowerCase());
  const col = re => head.findIndex(c => re.test(c));
  const ci = col(/cut|direction|plane/), di = col(/depth|height|^y\b|position/), ai = col(/angle|theta|°/), ti = col(/thick/);
  if (ai < 0) return { rows: [], thickness: null, fraction: false, skipped: lines.length - 1, problems: ['no angle column (a header such as angle_deg)'] };
  const rows = []; let skipped = 0, thick = null;
  for (const l of lines.slice(1)) {
    const c = cells(l), a = parseFloat((c[ai] || '').replace(',', '.'));
    if (!Number.isFinite(a)) { skipped++; continue; }
    const cutT = ci >= 0 ? (c[ci] || '').toLowerCase() : '';
    const cut = /cd|across|trans|cross/.test(cutT) ? 'cd' : 'md';
    const d = di >= 0 ? parseFloat((c[di] || '').replace(',', '.')) : NaN;
    if (ti >= 0) { const t = parseFloat((c[ti] || '').replace(',', '.')); if (Number.isFinite(t) && t > 0) thick = t; }
    rows.push([cut, d, ((a + 90) % 180 + 180) % 180 - 90]);
  }
  if (di < 0) problems.push('no depth column: the angles are taken through the whole film');
  const depths = rows.map(r => r[1]).filter(Number.isFinite);
  const fraction = !thick && depths.length > 0 && depths.every(d => d >= 0 && d <= 1);
  return { rows, thickness: thick, fraction, skipped, problems };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { semGray, semBlur, semGrad, semStructure, semFrame, semRel, semAngles, semHand, semTable };
