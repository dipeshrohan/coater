'use strict';
/*
 * Image export: PNG and SVG of the flow plots, the results dock's charts, a module's plots, or
 * the whole window.
 *
 * Canvases drawn through setupCanvas (draw.js) keep a log of their drawing commands. An export
 * redraws the view at the chosen resolution (window.EXPORT_DPR; the field colours are sampled
 * at it too), copies the logs, and replays them into a composed image -- title, plots, legend,
 * inputs, footer -- drawn either on a canvas (PNG) or by an SVG writer that implements the same
 * canvas calls (vector lines and text; the field colours go in as an embedded picture).
 * The whole window is captured with html2canvas, loaded from a CDN the first time.
 */

// ---------------------------------------------------------------------
// Recording: the 2D context of a canvas set up by setupCanvas logs what it draws
// ---------------------------------------------------------------------
const REC_METHODS = ['beginPath', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'rect', 'closePath', 'fill', 'stroke', 'clip',
  'fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'transform',
  'resetTransform', 'setLineDash', 'drawImage'];
const REC_PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'globalAlpha', 'font', 'textAlign', 'textBaseline',
  'lineDashOffset', 'imageSmoothingEnabled'];
const REC_MAX = 400000;   // (a canvas drawn over and over without being set up again stops recording)
const nativeGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  return type === '2d' && this._rec ? this._rec : nativeGetContext.call(this, type, ...rest);
};
/** Start (or restart) the log of a canvas just sized by setupCanvas; w, h = its size in CSS px. */
function recordCanvas(cv, w, h) {
  if (!cv._rec) {
    const real = nativeGetContext.call(cv, '2d'), rec = { log: [], real, full: false };
    const push = e => { if (rec.log.length < REC_MAX) rec.log.push(e); else rec.full = true; };
    for (const m of REC_METHODS) rec[m] = (...a) => { push([m, a]); return real[m](...a); };
    for (const p of REC_PROPS) Object.defineProperty(rec, p, { get: () => real[p], set: v => { push(['=', p, v]); real[p] = v; } });
    for (const m of ['measureText', 'getLineDash', 'createImageData', 'getImageData', 'putImageData', 'isPointInPath', 'createLinearGradient']) rec[m] = (...a) => real[m](...a);
    Object.defineProperty(rec, 'canvas', { get: () => cv });
    cv._rec = rec;
  }
  cv._rec.log.length = 0; cv._rec.full = false;
  cv._rec.w = w; cv._rec.h = h; cv._rec.k = window.EXPORT_DPR || window.devicePixelRatio || 1;
  return cv._rec;
}

/**
 * Replay a log into a context. The log's transforms are absolute (setupCanvas sets one); each is
 * mapped by x -> s x + (dx, dy), which places and scales the drawing in the composed image.
 */
function replayLog(log, ctx, s, dx, dy) {
  let depth = 0;
  ctx.save();
  for (const e of log) {
    if (e[0] === '=') { ctx[e[1]] = e[2]; continue; }
    const m = e[0], a = e[1];
    if (m === 'setTransform') ctx.setTransform(a[0] * s, a[1] * s, a[2] * s, a[3] * s, a[4] * s + dx, a[5] * s + dy);
    else if (m === 'resetTransform') ctx.setTransform(s, 0, 0, s, dx, dy);
    else if (m === 'clearRect') continue;                 // (the composed image has its own background)
    else {
      if (m === 'save') depth++;
      else if (m === 'restore') { if (!depth) continue; depth--; }
      ctx[m](...a);
    }
  }
  while (depth-- > 0) ctx.restore();
  ctx.restore();
}
/** A context's drawing state back to the canvas defaults (a replayed log assumes them). */
function resetCtx(ctx) {
  Object.assign(ctx, { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1,
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', lineDashOffset: 0 });
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------------
// SVG writer: the canvas calls used here, written as SVG (coordinates baked in, text and pictures
// with their transform)
// ---------------------------------------------------------------------
const scratchCtx = nativeGetContext.call(document.createElement('canvas'), '2d');
const xmlEsc = t => String(t).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const svgNum = v => +(+v).toFixed(2);
/** A CSS colour as an SVG colour and opacity. */
function svgColour(v) {
  if (typeof v !== 'string') return { c: '#808080', a: 1 };
  scratchCtx.fillStyle = '#000'; scratchCtx.fillStyle = v;
  const n = scratchCtx.fillStyle;
  const m = /rgba?\(([^)]+)\)/.exec(n);
  if (m) { const p = m[1].split(',').map(parseFloat); return { c: `rgb(${p[0]},${p[1]},${p[2]})`, a: p.length > 3 ? p[3] : 1 }; }
  return { c: n, a: 1 };
}
function parseFont(font) {
  const m = /^\s*(.*?)\s*(\d*\.?\d+)px(?:\s*\/\s*\S+)?\s+(.+)$/.exec(font) || [];
  const pre = m[1] || '';
  return { size: +m[2] || 10, family: (m[3] || 'sans-serif').replace(/"/g, "'"), weight: (/\b(bold|bolder|[1-9]00)\b/.exec(pre) || [])[1] || 'normal', italic: /\bitalic\b/.test(pre) };
}
const baselineShift = new Map();
/** How far below the given text baseline the alphabetic baseline lies (px), for a font. */
function toAlphabetic(font, base) {
  const key = font + '|' + base;
  if (!baselineShift.has(key)) {
    scratchCtx.font = font; scratchCtx.textBaseline = base;
    const m = scratchCtx.measureText('Mg');
    let d = Number.isFinite(m.alphabeticBaseline) ? -m.alphabeticBaseline : null;
    if (d == null) { const sz = parseFont(font).size; d = { top: 0.8, hanging: 0.75, middle: 0.3, ideographic: -0.2, bottom: -0.2 }[base] * sz || 0; }
    baselineShift.set(key, d);
  }
  return baselineShift.get(key);
}
class SvgCtx {
  constructor(w, h) {
    this.w = w; this.h = h; this.out = []; this.defs = []; this.nid = 0; this.stack = []; this.path = []; this.cur = null; this.start = null;
    this.st = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalAlpha: 1, font: '10px sans-serif',
      textAlign: 'start', textBaseline: 'alphabetic', lineDashOffset: 0, imageSmoothingEnabled: true, dash: [], m: [1, 0, 0, 1, 0, 0], clip: null };
    for (const p of REC_PROPS) Object.defineProperty(this, p, { get: () => this.st[p], set: v => { this.st[p] = v; } });
    this.images = new Map();
  }
  // transforms
  setTransform(a, b, c, d, e, f) { this.st.m = [a, b, c, d, e, f]; }
  resetTransform() { this.st.m = [1, 0, 0, 1, 0, 0]; }
  transform(a, b, c, d, e, f) { const m = this.st.m; this.st.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]]; }
  translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
  scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(t) { const c = Math.cos(t), s = Math.sin(t); this.transform(c, s, -s, c, 0, 0); }
  T(x, y) { const m = this.st.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  get k() { const m = this.st.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; }
  // state
  save() { const s = this.st; this.stack.push({ ...s, m: s.m.slice(), dash: s.dash.slice() }); }
  restore() { if (this.stack.length) this.st = this.stack.pop(); }
  setLineDash(a) { this.st.dash = [...a]; }
  getLineDash() { return this.st.dash.slice(); }
  measureText(t) { scratchCtx.font = this.st.font; return scratchCtx.measureText(t); }
  // paths
  beginPath() { this.path = []; this.cur = null; }
  pt(p) { return `${svgNum(p[0])} ${svgNum(p[1])}`; }
  moveTo(x, y) { const p = this.T(x, y); this.path.push('M' + this.pt(p)); this.cur = this.start = p; }
  lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); const p = this.T(x, y); this.path.push('L' + this.pt(p)); this.cur = p; }
  quadraticCurveTo(cx, cy, x, y) { if (!this.cur) this.moveTo(cx, cy); const p = this.T(x, y); this.path.push('Q' + this.pt(this.T(cx, cy)) + ' ' + this.pt(p)); this.cur = p; }
  bezierCurveTo(c1x, c1y, c2x, c2y, x, y) { if (!this.cur) this.moveTo(c1x, c1y); const p = this.T(x, y); this.path.push('C' + this.pt(this.T(c1x, c1y)) + ' ' + this.pt(this.T(c2x, c2y)) + ' ' + this.pt(p)); this.cur = p; }
  arc(x, y, r, a0, a1, ccw = false) {
    const TAU = 2 * Math.PI;
    let sw = a1 - a0;
    if (!ccw) sw = sw >= TAU ? TAU : ((sw % TAU) + TAU) % TAU;
    else sw = -sw >= TAU ? -TAU : -((((a0 - a1) % TAU) + TAU) % TAU);
    const n = Math.max(4, Math.ceil(Math.abs(sw) / (Math.PI / 18)));
    for (let i = 0; i <= n; i++) {
      const t = a0 + sw * i / n, px = x + r * Math.cos(t), py = y + r * Math.sin(t);
      if (i === 0 && !this.cur) this.moveTo(px, py); else this.lineTo(px, py);
    }
  }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  closePath() { if (this.cur) { this.path.push('Z'); this.cur = this.start; } }
  clipAttr() { return this.st.clip ? ` clip-path="url(#${this.st.clip})"` : ''; }
  paint(kind, rule) {
    const d = this.path.join('');
    if (!d) return;
    const s = this.st;
    if (kind === 'fill') {
      const col = svgColour(s.fillStyle), a = col.a * s.globalAlpha;
      if (a <= 0) return;
      this.out.push(`<path d="${d}" fill="${col.c}"${a < 1 ? ` fill-opacity="${svgNum(a)}"` : ''}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${this.clipAttr()}/>`);
    } else {
      const col = svgColour(s.strokeStyle), a = col.a * s.globalAlpha, k = this.k;
      if (a <= 0) return;
      const dash = s.dash.length ? ` stroke-dasharray="${s.dash.map(v => svgNum(v * k)).join(' ')}"${s.lineDashOffset ? ` stroke-dashoffset="${svgNum(s.lineDashOffset * k)}"` : ''}` : '';
      this.out.push(`<path d="${d}" fill="none" stroke="${col.c}" stroke-width="${svgNum(s.lineWidth * k)}"${s.lineCap !== 'butt' ? ` stroke-linecap="${s.lineCap}"` : ''}${s.lineJoin !== 'miter' ? ` stroke-linejoin="${s.lineJoin}"` : ''}${dash}${a < 1 ? ` stroke-opacity="${svgNum(a)}"` : ''}${this.clipAttr()}/>`);
    }
  }
  fill(rule) { this.paint('fill', rule); }
  stroke() { this.paint('stroke'); }
  clip(rule) {
    const id = 'c' + (++this.nid);
    this.defs.push(`<clipPath id="${id}"${this.st.clip ? ` clip-path="url(#${this.st.clip})"` : ''}><path d="${this.path.join('')}"${rule === 'evenodd' ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
    this.st.clip = id;
  }
  withRect(x, y, w, h, fn) { const keep = [this.path, this.cur, this.start]; this.beginPath(); this.rect(x, y, w, h); fn(); [this.path, this.cur, this.start] = keep; }
  fillRect(x, y, w, h) { this.withRect(x, y, w, h, () => this.fill()); }
  strokeRect(x, y, w, h) { this.withRect(x, y, w, h, () => this.stroke()); }
  clearRect() { /* (the composed image has its own background) */ }
  text(t, x, y, stroke) {
    const s = this.st, f = parseFont(s.font), col = svgColour(stroke ? s.strokeStyle : s.fillStyle), a = col.a * s.globalAlpha;
    if (a <= 0 || t === '' || t == null) return;
    const anchor = { center: 'middle', right: 'end', end: 'end' }[s.textAlign] || 'start';
    const y0 = y + toAlphabetic(s.font, s.textBaseline), m = s.m.map(svgNum).join(' ');
    const paint = stroke
      ? `fill="none" stroke="${col.c}" stroke-width="${svgNum(s.lineWidth)}" stroke-linejoin="${s.lineJoin}"${a < 1 ? ` stroke-opacity="${svgNum(a)}"` : ''}`
      : `fill="${col.c}"${a < 1 ? ` fill-opacity="${svgNum(a)}"` : ''}`;
    const el = `<text transform="matrix(${m})" x="${svgNum(x)}" y="${svgNum(y0)}" font-family="${f.family}" font-size="${svgNum(f.size)}"${f.weight !== 'normal' ? ` font-weight="${f.weight}"` : ''}${f.italic ? ' font-style="italic"' : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''} xml:space="preserve" ${paint}>${xmlEsc(t)}</text>`;
    this.out.push(s.clip ? `<g clip-path="url(#${s.clip})">${el}</g>` : el);
  }
  fillText(t, x, y) { this.text(t, x, y, false); }
  strokeText(t, x, y) { this.text(t, x, y, true); }
  drawImage(img, ...a) {
    let sx = 0, sy = 0, sw = img.width, sh = img.height, dx, dy, dw, dh;
    if (a.length === 2) { [dx, dy] = a; dw = sw; dh = sh; } else if (a.length === 4) [dx, dy, dw, dh] = a; else [sx, sy, sw, sh, dx, dy, dw, dh] = a;
    let src = img;
    if (sx || sy || sw !== img.width || sh !== img.height) {
      src = document.createElement('canvas'); src.width = Math.max(1, Math.round(sw)); src.height = Math.max(1, Math.round(sh));
      nativeGetContext.call(src, '2d').drawImage(img, sx, sy, sw, sh, 0, 0, src.width, src.height);
    }
    let url = this.images.get(src);
    if (!url) {
      if (src instanceof HTMLCanvasElement) url = src.toDataURL('image/png');
      else { const c = document.createElement('canvas'); c.width = src.naturalWidth || src.width; c.height = src.naturalHeight || src.height; nativeGetContext.call(c, '2d').drawImage(src, 0, 0); url = c.toDataURL('image/png'); }
      this.images.set(src, url);
    }
    const s = this.st, el = `<image transform="matrix(${s.m.map(svgNum).join(' ')})" x="${svgNum(dx)}" y="${svgNum(dy)}" width="${svgNum(dw)}" height="${svgNum(dh)}" preserveAspectRatio="none"${s.globalAlpha < 1 ? ` opacity="${svgNum(s.globalAlpha)}"` : ''} xlink:href="${url}"/>`;
    this.out.push(s.clip ? `<g clip-path="url(#${s.clip})">${el}</g>` : el);
  }
  toString() {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">\n`
      + (this.defs.length ? `<defs>${this.defs.join('\n')}</defs>\n` : '') + this.out.join('\n') + '\n</svg>\n';
  }
}

// ---------------------------------------------------------------------
// What can be exported, and a snapshot of it drawn at the export's resolution
// ---------------------------------------------------------------------
const IMG_KEY = 'bladeCoatDefectLab.imageExport.v1';
const IMG = (() => {
  const d = { fmt: 'png', scale: 2, bg: 'white', title: true, legend: true, inputs: true, footer: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(IMG_KEY) || '{}') }; } catch (e) { return d; }
})();
const saveImgPrefs = () => { try { localStorage.setItem(IMG_KEY, JSON.stringify(IMG)); } catch (e) { /* not remembered */ } };
const CAMERA_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 5.5h2.2l1.1-1.7h4.4l1.1 1.7h2.2v7h-11z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="8" cy="8.9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';

const firstText = el => el ? [...el.childNodes].filter(n => n.nodeType === 3 || (n.nodeType === 1 && !/^(SMALL|SPAN)$/.test(n.tagName))).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim() : '';
const cleanText = el => el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
/** The module's inputs, as shown in the model tree (label, value with unit). */
function inputsSummary() {
  const rows = [];
  for (const pr of document.querySelectorAll('#params .prop, #setupExtra .prop')) {
    if (pr.hidden || pr.closest('[hidden]')) continue;
    const label = firstText(pr.querySelector('.prop-l'));
    const num = pr.querySelector('input[type=number]'), sel = pr.querySelector('select'), seg = pr.querySelector('.seg [aria-selected="true"]');
    const val = num ? num.value : sel ? (sel.options[sel.selectedIndex] || {}).text || '' : seg ? cleanText(seg) : '';
    const unit = cleanText(pr.querySelector('.prop-u'));
    if (label && val !== '') rows.push({ label, value: val + (unit ? ' ' + unit : '') });
  }
  return rows;
}
/** A legend swatch as drawn on screen (the <i> of a legend item), for redrawing it. */
function swatchOf(i) {
  if (!i) return null;
  const cs = getComputedStyle(i);
  return { cls: i.className, w: i.offsetWidth, h: i.offsetHeight, bg: cs.backgroundColor, bc: cs.borderTopColor, bw: parseFloat(cs.borderTopWidth) || 0,
    bl: parseFloat(cs.borderLeftWidth) || 0, blc: cs.borderLeftColor, radius: cs.borderTopLeftRadius, opacity: +cs.opacity || 1 };
}
const legendItems = els => {
  const seen = new Set(), out = [];
  for (const lg of els) {
    const text = cleanText(lg);
    if (!text || seen.has(text)) continue;
    seen.add(text); out.push({ text, sw: swatchOf(lg.querySelector('i')) });
  }
  return out;
};
/** A plot's title as its caption reads, without the caption's (i) button. */
const captionText = fc => fc ? [...fc.childNodes].filter(n => !(n.nodeType === 1 && n.tagName === 'BUTTON')).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim() : '';
const chartName = (cv, fallback) => cv.getAttribute('aria-label') || captionText(cv.closest('figure') && cv.closest('figure').querySelector('figcaption')) || fallback;

/** The things in the current view that can be saved as an image. */
function imageTargets() {
  const out = [], mod = TABS[tab];
  if (tab === 4) {
    if (document.querySelector('#cfdPlots .fv-main')) {
      const v = FV.view, d = SCALARS[FV.base];
      out.push({
        id: 'plots', slug: v === 'compare' ? 'flow-compare' : v === 'diff' ? `difference-L${FV.diff.b + 1}-L${FV.diff.a + 1}` : `flow-L${v + 1}`,
        label: v === 'compare' ? 'Flow plots: all four locations' : v === 'diff' ? `Difference plot: L${FV.diff.b + 1} − L${FV.diff.a + 1}` : `Flow plot: location ${v + 1}`,
        canvases: () => [...document.querySelectorAll('#cfdPlots .fv-main')],
        legend: () => document.querySelectorAll('#cfdLegend .lg'),
        title: () => v === 'compare' ? 'Flow field · all four locations' : v === 'diff' ? `Difference · location ${FV.diff.b + 1} − location ${FV.diff.a + 1}` : `Flow field · location ${v + 1}`,
        subtitle: () => v === 'diff' ? cleanText(document.querySelector('.fv-diffcap'))
          : [d ? d.label : 'geometry only', v === 'compare' ? '' : cleanText(document.querySelector('#cfdPlots .fv-caption'))].filter(Boolean).join(' · '),
      });
    }
    const panel = () => document.getElementById('dock-' + FV.dock);
    const tb = document.querySelector(`.dock-tabs button[data-dock="${FV.dock}"]`), tabName = tb ? cleanText([...tb.childNodes].find(n => n.nodeType === 3 && n.textContent.trim())) || cleanText(tb) : 'Results';
    const charts = () => [...(panel() ? panel().querySelectorAll('canvas[role="img"]') : [])];
    const legendNear = cv => { const fig = cv.closest('figure'); const own = fig && fig.querySelectorAll('.xl-legend .lg'); return own && own.length ? own : panel().querySelectorAll('.xl-legend .lg'); };
    charts().forEach((cv, n) => out.push({
      id: 'chart:' + n, slug: `chart-${FV.dock}-${n + 1}`, label: `Chart: ${chartName(cv, `${tabName} ${n + 1}`)}`,
      canvases: () => [charts()[n]].filter(Boolean), legend: () => legendNear(charts()[n]),
      title: () => tabName, subtitle: () => chartName(charts()[n], ''),
    }));
    if (charts().length > 1) out.push({ id: 'charts', slug: `charts-${FV.dock}`, label: `All charts in “${tabName}”`, canvases: charts, legend: () => panel().querySelectorAll('.xl-legend .lg'), title: () => tabName, subtitle: () => '' });
  } else {
    const panes = () => [...document.querySelectorAll('#view .pane canvas[role="img"]')];
    panes().forEach((cv, n) => out.push({
      id: 'pane:' + n, slug: `plot-${n + 1}`, label: `Plot: ${chartName(cv, `${mod} ${n + 1}`)}`,
      canvases: () => [panes()[n]].filter(Boolean), legend: () => document.querySelectorAll('#view .mod-legend .lg'), title: () => captionText(panes()[n].closest('figure').querySelector('figcaption')), subtitle: () => '',
    }));
    if (panes().length > 1) out.push({ id: 'panes', slug: 'plots', label: `All plots of “${mod}”`, canvases: panes, legend: () => document.querySelectorAll('#view .mod-legend .lg'), title: () => '', subtitle: () => '', captions: true });
  }
  out.push({ id: 'window', slug: 'window', label: 'Whole window', window: true });
  return out;
}

/** Redraw what the view shows (the CFD plots and dock, or the module). */
const rerenderView = () => { if (tab === 4) renderCFD(); else render(); };
/** Switch to the light theme for a white background; returns the undo. */
function exportTheme(bg) {
  const root = document.documentElement, was = root.dataset.theme;
  if (bg !== 'white' || !isDarkTheme()) return () => {};
  root.dataset.theme = 'light';
  return () => { if (was) root.dataset.theme = was; else delete root.dataset.theme; };
}
/** Draw the view at k times its CSS size and copy what the image needs: the canvases' logs (or pixels), their places, the legend, texts, colours. */
function snapshotTarget(target, k, bg) {
  const undoTheme = exportTheme(bg);
  window.EXPORT_DPR = k;
  try {
    rerenderView();
    const cvs = target.canvases();
    if (!cvs.length) throw new Error('nothing to export');
    const boxes = cvs.map(cv => cv.getBoundingClientRect());
    const caps = target.captions ? cvs.map(cv => { const fc = cv.closest('figure') && cv.closest('figure').querySelector('figcaption'); return fc ? { text: captionText(fc), r: fc.getBoundingClientRect() } : null; }).filter(Boolean) : [];
    const all = boxes.concat(caps.map(c => c.r));
    const x0 = Math.min(...all.map(r => r.left)), y0 = Math.min(...all.map(r => r.top));
    const x1 = Math.max(...all.map(r => r.right)), y1 = Math.max(...all.map(r => r.bottom));
    const parts = cvs.map((cv, n) => {
      const r = boxes[n], rec = cv._rec;
      let bitmap = null;
      if (!rec || rec.full) { bitmap = document.createElement('canvas'); bitmap.width = cv.width; bitmap.height = cv.height; nativeGetContext.call(bitmap, '2d').drawImage(cv, 0, 0); }
      // (a log is replayed at the canvas's drawn size, scaled to its size on screen should they differ)
      return { x: r.left - x0, y: r.top - y0, w: r.width, h: r.height, log: bitmap ? null : rec.log.slice(), k: rec ? rec.k : 1, sx: rec && rec.w ? r.width / rec.w : 1, bitmap };
    });
    const pal = { ink: cssVar('--ink'), muted: cssVar('--muted'), line: cssVar('--line'), surface: cssVar('--surface'), sans: cssVar('--sans') || 'sans-serif', mono: cssVar('--mono') || 'monospace' };
    return {
      parts, w: x1 - x0, h: y1 - y0, pal, dark: isDarkTheme(), bg: bg === 'white' ? '#ffffff' : pal.surface,
      captions: caps.map(c => ({ text: c.text, x: c.r.left - x0, y: c.r.top - y0, h: c.r.height })),
      legend: legendItems(target.legend()), title: target.title(), subtitle: target.subtitle(), inputs: inputsSummary(), module: TABS[tab],
    };
  } finally {
    window.EXPORT_DPR = 0;
    undoTheme();
    rerenderView();
  }
}

// ---------------------------------------------------------------------
// Composition: the same drawing calls on a canvas (PNG) or the SVG writer
// ---------------------------------------------------------------------
function drawSwatch(ctx, sw, x, cy, dark) {
  if (!sw) return;
  const cls = sw.cls || '';
  ctx.save();
  ctx.globalAlpha = sw.opacity;
  if (/\blg-arrow\b/.test(cls)) {
    ctx.fillStyle = sw.blc; ctx.beginPath(); ctx.moveTo(x + 5, cy - 4); ctx.lineTo(x + 5 + (sw.bl || 7), cy); ctx.lineTo(x + 5, cy + 4); ctx.closePath(); ctx.fill();
  } else if (/\blg-vec\b/.test(cls)) {
    ctx.strokeStyle = ctx.fillStyle = sw.bg; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + 13, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 12, cy - 3.5); ctx.lineTo(x + 17, cy); ctx.lineTo(x + 12, cy + 3.5); ctx.closePath(); ctx.fill();
  } else if (/\blg-nodata\b/.test(cls)) {
    ctx.fillStyle = dark ? '#222220' : '#dadad5'; ctx.fillRect(x + 2, cy - 5, 14, 10);
    ctx.beginPath(); ctx.rect(x + 2, cy - 5, 14, 10); ctx.clip();
    ctx.strokeStyle = dark ? '#5c5c5c' : '#aaaaa6'; ctx.lineWidth = 1.2;
    for (let d = -10; d < 16; d += 3.5) { ctx.beginPath(); ctx.moveTo(x + 2 + d, cy + 5); ctx.lineTo(x + 12 + d, cy - 5); ctx.stroke(); }
  } else if (/\bby-value\b/.test(cls)) {
    ['#00f', '#0ff', '#ff0', '#f00'].forEach((c, n) => { ctx.fillStyle = c; ctx.fillRect(x + n * 4.5, cy - 1, 4.5, 2); });
  } else {
    const w = Math.min(18, Math.max(2, sw.w)), h = Math.min(12, Math.max(1, sw.h)), x0 = x + (18 - w) / 2, y0 = cy - h / 2;
    const r = Math.min(/%$/.test(sw.radius) ? parseFloat(sw.radius) / 100 * Math.min(w, h) : parseFloat(sw.radius) || 0, w / 2, h / 2);
    const shape = () => {
      ctx.beginPath();
      if (r >= Math.min(w, h) / 2 - 0.01 && Math.abs(w - h) < 0.5) { ctx.arc(x0 + w / 2, cy, w / 2, 0, 7); return; }
      ctx.moveTo(x0 + r, y0); ctx.lineTo(x0 + w - r, y0); ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r); ctx.lineTo(x0 + w, y0 + h - r);
      ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h); ctx.lineTo(x0 + r, y0 + h); ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
      ctx.lineTo(x0, y0 + r); ctx.quadraticCurveTo(x0, y0, x0 + r, y0); ctx.closePath();
    };
    const transparent = c => !c || /rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent';
    if (!transparent(sw.bg)) { ctx.fillStyle = sw.bg; shape(); ctx.fill(); }
    if (sw.bw > 0 && !transparent(sw.bc)) { ctx.strokeStyle = sw.bc; ctx.lineWidth = sw.bw; shape(); ctx.stroke(); }
  }
  ctx.restore();
}
/**
 * Lay out (ctx null: measure only) and draw the image: title, subtitle, the plots, the legend,
 * the inputs, a footer. Sizes in CSS px; mode.svg or mode.k (the PNG's pixels per CSS px).
 */
function composeImage(ctx, shot, opt, mode) {
  const P = shot.pal, pad = 18, W = Math.ceil(shot.w + 2 * pad), inner = W - 2 * pad;
  const M = scratchCtx, width = (t, font) => { M.font = font; return M.measureText(t).width; };
  const text = (t, x, y, font, color, align = 'left') => { if (!ctx) return; ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.fillText(t, x, y); };
  const wrap = (t, font) => {
    const lines = []; let cur = '';
    for (const w of t.split(' ')) { const nx = cur ? cur + ' ' + w : w; if (cur && width(nx, font) > inner) { lines.push(cur); cur = w; } else cur = nx; }
    if (cur) lines.push(cur);
    return lines;
  };
  if (ctx && mode.H) { ctx.fillStyle = shot.bg; ctx.fillRect(0, 0, W, mode.H); }
  let y = pad;
  if (opt.title) {
    const fT = `600 16px ${P.sans}`, fS = `12px ${P.sans}`;
    text(shot.title ? `${shot.module} — ${shot.title}` : shot.module, pad, y + 14, fT, P.ink); y += 22;
    if (shot.subtitle) for (const l of wrap(shot.subtitle, fS)) { text(l, pad, y + 12, fS, P.muted); y += 16; }
    y += 8;
  }
  const oy = y;
  for (const c of shot.captions) text(c.text, pad + c.x, oy + c.y + c.h - 3, `600 11.5px ${P.sans}`, P.ink);
  if (ctx) for (const p of shot.parts) {
    const x = pad + p.x, py = oy + p.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, py, p.w, p.h); ctx.clip();
    if (p.log) { resetCtx(ctx); if (mode.svg) replayLog(p.log, ctx, p.sx / p.k, x, py); else replayLog(p.log, ctx, mode.k * p.sx / p.k, x * mode.k, py * mode.k); }
    else ctx.drawImage(p.bitmap, x, py, p.w, p.h);
    ctx.restore();
  }
  y = oy + shot.h + 10;
  if (opt.legend && shot.legend.length) {
    const fL = `12px ${P.sans}`, rowH = 19;
    let x = pad;
    for (const it of shot.legend) {
      const iw = 24 + width(it.text, fL);
      if (x > pad && x + iw > W - pad) { x = pad; y += rowH; }
      if (ctx) drawSwatch(ctx, it.sw, x, y + 9, shot.dark);
      text(it.text, x + 24, y + 13, fL, P.ink);
      x += iw + 18;
    }
    y += rowH + 8;
  }
  if (opt.inputs && shot.inputs.length) {
    const fH = `600 12px ${P.sans}`, fI = `11px ${P.sans}`, lh = 15;
    if (ctx) { ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, y + 0.5); ctx.lineTo(W - pad, y + 0.5); ctx.stroke(); }
    y += 8;
    text('Inputs', pad, y + 12, fH, P.ink); y += 20;
    const cols = Math.max(1, Math.min(4, Math.floor(inner / 250))), colW = inner / cols, rows = Math.ceil(shot.inputs.length / cols);
    shot.inputs.forEach((r, n) => {
      const cx = pad + Math.floor(n / rows) * colW, cy = y + (n % rows) * lh + 11;
      const vw = width(r.value, fI);
      let lab = r.label;
      while (lab.length > 4 && width(lab, fI) > colW - vw - 30) lab = lab.slice(0, -2).trimEnd() + '…';
      text(lab, cx, cy, fI, P.muted);
      text(r.value, cx + colW - 16, cy, fI, P.ink, 'right');
    });
    y += rows * lh + 8;
  }
  if (opt.footer) {
    const fF = `11px ${P.sans}`, now = new Date(), two = v => String(v).padStart(2, '0');
    if (ctx) { ctx.strokeStyle = P.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, y + 0.5); ctx.lineTo(W - pad, y + 0.5); ctx.stroke(); }
    y += 16;
    text(`Blade Coat Defect Lab · ${shot.module}`, pad, y, fF, P.muted);
    text(`${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`, W - pad, y, fF, P.muted, 'right');
    y += 4;
  }
  return { W, H: Math.ceil(y + pad) };
}

// ---------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------
const imgStamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
const canvasBlob = cv => new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('the image is too large for this browser')), 'image/png'));
function imgToast(msg, kind = '') {
  let t = document.getElementById('imgToast');
  if (!t) { t = document.createElement('div'); t.id = 'imgToast'; t.className = 'img-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.className = 'img-toast' + (kind ? ' ' + kind : ''); t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); if (kind !== 'busy') t._h = setTimeout(() => { t.hidden = true; }, 3500);
}

let h2cLoading = null;
function loadHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return h2cLoading || (h2cLoading = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
    s.onload = () => window.html2canvas ? res(window.html2canvas) : rej(new Error('html2canvas did not load'));
    s.onerror = () => { h2cLoading = null; s.remove(); rej(new Error('could not load the page-capture library (html2canvas) from cdnjs: check the internet connection')); };
    document.head.appendChild(s);
  }));
}
// html2canvas reads colours as rgb / hex only: colours written with color-mix() and the like
// (computed as color(srgb ...)) become plain rgba in the page copy it draws
const MODERN_COLOUR = /\b(?:color|color-mix|oklch|oklab|lab|lch|hwb)\((?:[^()]|\([^()]*\))*\)/g;
const pixCtx = nativeGetContext.call(Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), '2d', { willReadFrequently: true });
function plainColour(v) {
  pixCtx.clearRect(0, 0, 1, 1); pixCtx.fillStyle = '#000'; pixCtx.fillStyle = v; pixCtx.fillRect(0, 0, 1, 1);
  const d = pixCtx.getImageData(0, 0, 1, 1).data;
  return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${+(d[3] / 255).toFixed(3)})`;
}
const COLOUR_PROPS = ['color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'box-shadow', 'fill', 'stroke', 'caret-color', 'column-rule-color'];
function plainColours(doc) {
  const win = doc.defaultView;
  for (const el of doc.querySelectorAll('*')) {
    const cs = win.getComputedStyle(el);
    for (const p of COLOUR_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && /\b(?:color|color-mix|oklch|oklab|lab|lch|hwb)\(/.test(v)) el.style.setProperty(p, v.replace(MODERN_COLOUR, plainColour), 'important');
    }
  }
}
/** The page copy html2canvas draws: plain colours; closed <details> without their content and sliders as a track and thumb (it would draw both wrongly). */
function prepareClone(doc) {
  plainColours(doc);
  // (html2canvas draws a closed <details>'s content)
  for (const d of doc.querySelectorAll('details:not([open])')) for (const ch of d.children) if (ch.tagName !== 'SUMMARY') ch.style.setProperty('display', 'none', 'important');
  const win = doc.defaultView, root = win.getComputedStyle(doc.documentElement);
  const accent = plainColour(root.getPropertyValue('--accent').trim() || '#1f5bd8'), line = plainColour(root.getPropertyValue('--line').trim() || '#d3d9e2');
  const surface = plainColour(root.getPropertyValue('--surface').trim() || '#fff');
  for (const r of doc.querySelectorAll('input[type=range]')) {
    const cs = win.getComputedStyle(r);
    if (cs.display === 'none' || !r.offsetWidth) continue;
    const min = +r.min || 0, max = r.max === '' ? 100 : +r.max, f = Math.max(0, Math.min(100, (+r.value - min) / ((max - min) || 1) * 100));
    const box = doc.createElement('div');
    box.style.cssText = `position:relative;display:${cs.display === 'inline-block' ? 'inline-block' : 'block'};width:${r.offsetWidth}px;height:${r.offsetHeight}px;margin:${cs.margin};grid-column:${cs.gridColumn};`;
    box.innerHTML = `<div style="position:absolute;left:0;right:0;top:calc(50% - 2px);height:4px;border-radius:2px;background:linear-gradient(to right, ${accent} ${f}%, ${line} ${f}%)"></div>`
      + `<div style="position:absolute;left:calc(${f}% - 7px);top:calc(50% - 7px);width:10px;height:10px;border-radius:50%;background:${surface};border:2px solid ${accent}"></div>`;
    r.replaceWith(box);
  }
  // inline SVG icons as pictures, their currentColor resolved (some are otherwise left out)
  for (const svg of doc.querySelectorAll('svg')) {
    const b = svg.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const cs = win.getComputedStyle(svg), col = plainColour(cs.color);
    const cp = svg.cloneNode(true);
    cp.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); cp.setAttribute('width', b.width); cp.setAttribute('height', b.height);
    const img = doc.createElement('img');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(cp.outerHTML.replace(/currentColor/g, col));
    img.style.cssText = `width:${b.width}px;height:${b.height}px;display:${cs.display === 'block' ? 'block' : 'inline-block'};vertical-align:${cs.verticalAlign};margin:${cs.margin};flex:none;`;
    svg.replaceWith(img);
  }
  // (nor the pictures inside a <summary>: they become its background)
  for (const sm of doc.querySelectorAll('summary')) {
    const sr = sm.getBoundingClientRect(), layers = [];
    for (const im of sm.querySelectorAll('img')) {
      const r = im.getBoundingClientRect();
      if (!r.width) continue;
      layers.push([`url("${im.src}")`, `${r.left - sr.left - sm.clientLeft}px ${r.top - sr.top - sm.clientTop}px`, `${r.width}px ${r.height}px`]);
      im.style.visibility = 'hidden';
    }
    if (!layers.length) continue;
    sm.style.backgroundImage = layers.map(l => l[0]).join(', ');
    sm.style.backgroundPosition = layers.map(l => l[1]).join(', ');
    sm.style.backgroundSize = layers.map(l => l[2]).join(', ');
    sm.style.backgroundRepeat = 'no-repeat';
  }
}
async function exportWindow(opt) {
  const h2c = await loadHtml2canvas();
  const undoTheme = exportTheme(opt.bg);
  window.EXPORT_DPR = opt.scale;
  try {
    rerenderView();
    const app = document.querySelector('.app');
    const cv = await h2c(app, { scale: opt.scale, backgroundColor: opt.bg === 'white' ? '#ffffff' : null, logging: false, onclone: prepareClone,
      ignoreElements: el => el.id === 'imgToast' || el.id === 'imgDlg' || el.id === 'helpCard' || (el.classList && el.classList.contains('img-btn')) });
    return cv;
  } finally {
    window.EXPORT_DPR = 0;
    undoTheme();
    rerenderView();
  }
}

/** Make the image for a target and save it. */
async function exportImage(target, opt) {
  const name = `blade-coat-${target.slug}-${imgStamp()}.${opt.fmt}`;
  imgToast('Saving the image…', 'busy');
  await new Promise(r => setTimeout(r, 30));            // (the message shows before the work)
  try {
    if (target.window) {
      const cv = await exportWindow(opt);
      if (opt.fmt === 'png') saveBlob(await canvasBlob(cv), name);
      else {
        const w = cv.width / opt.scale, h = cv.height / opt.scale;
        const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" xlink:href="${cv.toDataURL('image/png')}"/></svg>\n`;
        saveBlob(new Blob([svg], { type: 'image/svg+xml' }), name);
      }
    } else {
      const shot = snapshotTarget(target, opt.scale, opt.bg);
      const { W, H } = composeImage(null, shot, opt, {});
      if (opt.fmt === 'png') {
        const k = opt.scale, cv = document.createElement('canvas');
        cv.width = Math.round(W * k); cv.height = Math.round(H * k);
        const ctx = nativeGetContext.call(cv, '2d');
        ctx.setTransform(k, 0, 0, k, 0, 0);
        composeImage(ctx, shot, opt, { k, H });
        saveBlob(await canvasBlob(cv), name);
      } else {
        const svg = new SvgCtx(W, H);
        composeImage(svg, shot, opt, { svg: true, H });
        saveBlob(new Blob([svg.toString()], { type: 'image/svg+xml' }), name);
      }
    }
    imgToast(`Saved ${name}`);
  } catch (e) {
    imgToast(`Image not saved: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------------
// The dialog (title bar button, and the camera buttons on plots and charts)
// ---------------------------------------------------------------------
function openImageDialog(preset) {
  let dlg = document.getElementById('imgDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'imgDlg'; dlg.className = 'img-dlg'; dlg.setAttribute('aria-labelledby', 'imgDlgH'); document.body.appendChild(dlg); }
  const targets = imageTargets();
  const sel = targets.find(t => t.id === preset) || targets[0];
  const radio = (name, v, label, cur, extra = '') => `<label class="img-opt"><input type="radio" name="${name}" value="${v}"${String(v) === String(cur) ? ' checked' : ''}${extra}> <span>${label}</span></label>`;
  const chk = (k, label) => `<label class="fv-chk"><input type="checkbox" data-inc="${k}"${IMG[k] ? ' checked' : ''}> ${label}</label>`;
  dlg.innerHTML = `<form method="dialog" class="img-form">
    <div class="img-head"><h2 id="imgDlgH">Save as image</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>
    <fieldset class="img-what"><legend>What</legend>${targets.map(t => radio('what', t.id, t.label, sel.id)).join('')}</fieldset>
    <div class="img-grid">
      <fieldset><legend>Format</legend>${radio('fmt', 'png', 'PNG', IMG.fmt)}${radio('fmt', 'svg', 'SVG', IMG.fmt)}</fieldset>
      <fieldset><legend>Resolution</legend>${[1, 2, 4].map(k => radio('scale', k, k + '×', IMG.scale)).join('')}</fieldset>
      <fieldset><legend>Background</legend>${radio('bg', 'white', 'White', IMG.bg)}${radio('bg', 'theme', 'Theme', IMG.bg)}</fieldset>
    </div>
    <fieldset class="img-inc"><legend>Include</legend>${chk('title', 'Title')}${chk('legend', 'Legend')}${chk('inputs', 'Inputs summary')}${chk('footer', 'Date and app name')}</fieldset>
    <p class="fv-note" id="imgNote"></p>
    <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Cancel</button><button type="submit" class="btn btn-primary btn-sm" id="imgGo">Save image</button></div>
  </form>`;
  const form = dlg.querySelector('form');
  const cur = () => targets.find(t => t.id === form.elements.what.value) || sel;
  const note = () => {
    const t = cur(), svg = form.elements.fmt.value === 'svg';
    dlg.querySelectorAll('.img-inc input').forEach(i => { i.disabled = !!t.window; i.closest('label').classList.toggle('is-off', !!t.window); });
    dlg.querySelector('#imgNote').textContent = (t.window
      ? 'The whole window as it is shown (the page-capture library is loaded from the internet the first time).' + (svg ? ' SVG: a picture of the window wrapped in an SVG file, not editable vectors.' : '')
      : svg ? 'SVG: lines and text stay vectors; the field colours are an embedded picture at the chosen resolution.' : 'PNG at the chosen resolution: 2× suits reports and slides, 4× print.')
      + (form.elements.bg.value === 'white' && isDarkTheme() ? ' White: drawn in the light theme.' : '');
  };
  form.addEventListener('change', note);
  note();
  dlg.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => dlg.close(); });
  form.onsubmit = e => {
    e.preventDefault();
    IMG.fmt = form.elements.fmt.value; IMG.scale = +form.elements.scale.value; IMG.bg = form.elements.bg.value;
    dlg.querySelectorAll('[data-inc]').forEach(i => { IMG[i.dataset.inc] = i.checked; });
    saveImgPrefs();
    const t = cur();
    dlg.close();
    exportImage(t, { ...IMG });
  };
  if (!dlg.open) dlg.showModal();
  const first = form.querySelector('input[name="what"]:checked'); if (first) first.focus();
}
/** A camera button on each chart in the results dock and each module plot (the flow plots have theirs in the zoom bar). */
function decorateImageButtons() {
  const add = (cv, id, what) => {
    const host = cv.parentElement;
    if (!host || host.querySelector(':scope > .img-btn')) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'img-btn'; b.title = `Save this ${what} as an image`; b.setAttribute('aria-label', b.title); b.innerHTML = CAMERA_SVG;
    b.onclick = e => { e.stopPropagation(); openImageDialog(id()); };
    host.appendChild(b);
  };
  document.querySelectorAll('#view .dock-panel canvas[role="img"]').forEach(cv => add(cv, () => { const p = cv.closest('.dock-panel'); return 'chart:' + [...p.querySelectorAll('canvas[role="img"]')].indexOf(cv); }, 'chart'));
  document.querySelectorAll('#view .pane canvas[role="img"]').forEach(cv => add(cv, () => 'pane:' + [...document.querySelectorAll('#view .pane canvas[role="img"]')].indexOf(cv), 'plot'));
}
document.getElementById('imgBtn').onclick = () => openImageDialog();
