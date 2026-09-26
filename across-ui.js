/*
 * across-ui.js — the blade across the web (Phase 4): its settings (ACR), the gap's change they make at each position
 * across the web (physics.js's localGap adds it: every page takes the gap from there), the computed bow, and the
 * design on the 1D Across the web page.
 *
 * Parts of the gap's change (µm, + = the gap larger), on top of what the sidebar always had (waviness, tilt, fibre
 * thickness): the bow (typed: its amount and shape; computed: the blade as a beam on its two ends under the slurry's
 * pressure from the 1D and its own weight), more sines (the first is today's waviness, with its crest where asked),
 * chamfered ends, a measured gap profile, a crown. The blade runs from -left to W + right: its ends relative to the
 * web's edges. Every new part is off until switched on: then the gap is today's, bit for bit.
 */
const ACR_DEFAULTS = {
  bladeEnds: { left: 0, right: 0 },                 // mm: + the blade overhangs the web's edge, - it ends inside
  bow: { on: false, mode: 'computed', um: 20, shape: 'parabola', supports: 'simple', E: 200, rhoB: 7850, h: 50, t: 20, I: null },
  crest: null,                                      // today's waviness: where its first crest is (mm); null: a quarter wavelength in
  sines: [],                                        // more sines: { a (µm), lw (mm), crest (mm or null) }
  ends: { on: false, left: { c: 15, d: 30 }, right: { c: 15, d: 30 } },
  meas: { on: false, name: '', pts: [] },           // a measured gap profile: [[z mm, change µm], ...]
  crown: { on: false, kind: 'parabola', um: 0, pts: [], name: '' },
  edgeBand: 10,                                     // mm: the crown evens the film between a band this wide at each edge
};
const ACR = JSON.parse(JSON.stringify(ACR_DEFAULTS));
const ACR_W = 300;   // the web's width (mm), as the sidebar's positions across it

/** The blade's span (mm): its left and right ends. */
const acrossSpanNow = () => acrossSpan(ACR_W, ACR.bladeEnds);
/** Is any new part on (the gap then differs from today's)? */
const acrossAny = () => !!(ACR.bow.on || ACR.sines.length || ACR.ends.on || (ACR.meas.on && ACR.meas.pts.length) || ACR.crown.on);

// ---- the gap ----
/** Today's waviness (µm), its first crest where set (physics.js's localGap). */
const acrossWave = z => acrossSine(z, P.dH, P.lw, ACR.crest);
let ACR_MEAS_F = null, ACR_CROWN_F = null;
const acrossMeasF = () => { const k = ACR.meas.pts; if (!ACR_MEAS_F || ACR_MEAS_F.k !== k) ACR_MEAS_F = { k, f: acrossPchip(k) }; return ACR_MEAS_F.f; };
const acrossCrownF = () => { const k = ACR.crown.pts; if (!ACR_CROWN_F || ACR_CROWN_F.k !== k) ACR_CROWN_F = { k, f: acrossPchip(k) }; return ACR_CROWN_F.f; };
/** The new parts, each (µm) at z; noBow: without the computed bow (the bow's own load needs the gap without it). */
function acrossParts(z, noBow = false) {
  const span = acrossSpanNow(), o = { bow: 0, sines: 0, ends: 0, meas: 0, crown: 0 };
  if (ACR.bow.on) o.bow = ACR.bow.mode === 'typed' ? acrossBowTyped(z, ACR.bow.um, ACR.bow.shape, span) : noBow ? 0 : acrossBowComputedAt(z);
  for (const s of ACR.sines) o.sines += acrossSine(z, s.a, s.lw, s.crest);
  if (ACR.ends.on) o.ends = acrossEnds(z, ACR.ends, span);
  if (ACR.meas.on && ACR.meas.pts.length) o.meas = acrossMeasF()(z);
  if (ACR.crown.on) o.crown = ACR.crown.kind === 'free' ? acrossCrownF()(z) : acrossBowTyped(z, ACR.crown.um, 'parabola', span);
  return o;
}
/** The new parts' sum (mm) at z; zero (exactly) when none is on. */
function acrossExtraMm(z, noBow = false) {
  if (!acrossAny()) return 0;
  const o = acrossParts(z, noBow || ACR_BOW_BUSY);
  return (o.bow + o.sines + o.ends + o.meas + o.crown) / 1000;
}

// ---- the computed bow ----
// (the blade as a beam on its two ends: the slurry's pressure under it from the 1D at 13 positions across the web,
// its own weight; the pressure depends on the gap and the gap on the bow, so solved again until the bow settles;
// cached on the inputs, so every page sees the same gap and it is worked out once)
let ACR_BOW = null, ACR_BOW_BUSY = false;
const ACR_BOW_N = 13, ACR_BOW_CACHE = new Map();
const acrossBowSig = () => JSON.stringify([CFG.map(c => P[c.k]), CFDG, ACR]);
function acrossBowComputed() {
  const sig = acrossBowSig();
  if (ACR_BOW && ACR_BOW.sig === sig) return ACR_BOW;
  // (a few kept: a drag draws trial settings between the real ones)
  if (ACR_BOW_CACHE.has(sig)) { ACR_BOW = ACR_BOW_CACHE.get(sig); return ACR_BOW; }
  const t0 = performance.now(), span = acrossSpanNow(), L = (span[1] - span[0]) / 1000, b = ACR.bow;
  const sec = beamSection(b), EI = b.E * 1e9 * sec.I, weight = b.rhoB * GRAVITY * sec.A;
  // (where there are both web and blade: the slurry's load; elsewhere none)
  const c0 = Math.max(0, span[0]), c1 = Math.min(ACR_W, span[1]), zs = Array.from({ length: ACR_BOW_N }, (_, k) => c0 + (c1 - c0) * k / (ACR_BOW_N - 1));
  const out = { sig, span, EI, weight, zs, loads: null, s: null, w: null, iters: 0, error: null, ms: 0 };
  ACR_BOW_BUSY = true;
  try {
    const base = zs.map(z => oneDGeoAt(z));   // (the gap there without the computed bow: ACR_BOW_BUSY)
    let wAt = () => 0, prev = null;
    for (let it = 1; it <= 30; it++) {
      const F = base.map(g => {
        const r = gapFlow1D({ ...g, H: g.H + wAt(g.z) * 1e-6 }, { nx: 40, ny: 50 });
        let f = 0; for (let i = 1; i < r.x.length; i++) f += (r.x[i] - r.x[i - 1]) * (r.p[i] + r.p[i - 1]) / 2;
        return f;
      });
      const qz = z => { if (z < c0 || z > c1) return 0; let k = 0; while (k < zs.length - 2 && zs[k + 1] < z) k++; const t = (z - zs[k]) / (zs[k + 1] - zs[k]); return F[k] + (F[k + 1] - F[k]) * t; };
      const bm = beamBow({ L, EI, supports: b.supports, q: s => qz(span[0] + s * 1000) - weight });
      const s = Array.from(bm.s, v => span[0] + v * 1000), w = Array.from(bm.w, v => v * 1e6);
      Object.assign(out, { loads: F, s, w, iters: it });
      const hMin = Math.min(...base.map(g => g.H)) * 1e6;
      if (w.some(v => !Number.isFinite(v) || Math.abs(v) > 0.5 * hMin)) { out.error = `the blade bends ${(Math.max(...w.map(Math.abs)) / 1000).toFixed(2)} mm: more than half the gap, too far for this model (a stiffer blade, or typed bow)`; break; }
      const change = prev ? Math.max(...w.map((v, i) => Math.abs(v - prev[i]))) : Infinity;
      prev = w;
      wAt = z => { if (z <= s[0]) return w[0]; if (z >= s[s.length - 1]) return w[w.length - 1]; const h = s[1] - s[0], k = Math.min(w.length - 2, Math.floor((z - s[0]) / h)), t = (z - s[k]) / h; return w[k] + (w[k + 1] - w[k]) * t; };
      if (change < 1e-4) break;
      if (it === 30) out.error = 'the bow did not settle in 30 rounds';
    }
    out.at = wAt;
  } catch (e) { out.error = e.message; out.at = () => 0; }
  finally { ACR_BOW_BUSY = false; }
  out.ms = performance.now() - t0;
  ACR_BOW = out;
  ACR_BOW_CACHE.set(sig, out);
  if (ACR_BOW_CACHE.size > 6) ACR_BOW_CACHE.delete(ACR_BOW_CACHE.keys().next().value);
  return out;
}
/** The computed bow (µm) at z; zero beyond the blade or when it could not be worked out (the page says why). */
function acrossBowComputedAt(z) {
  const B = acrossBowComputed(), sp = B.span;
  if (B.error || !B.at || z < sp[0] || z > sp[1]) return 0;
  return B.at(z);
}

// ---- the settings: limits, reading and writing by path ----
/** The settings' numbers: label, unit, range, decimals; blank: what an empty entry means (else empty is refused). */
const ACR_NUM = {
  'bow.um': { l: 'Bow at the middle', u: 'µm', lo: -500, hi: 500, d: 1 },
  'bow.E': { l: 'Blade modulus E', u: 'GPa', lo: 1, hi: 1000, d: 0 },
  'bow.rhoB': { l: 'Blade density', u: 'kg/m³', lo: 100, hi: 25000, d: 0 },
  'bow.h': { l: 'Blade height (the section)', u: 'mm', lo: 0.1, hi: 1000, d: 1 },
  'bow.t': { l: 'Blade thickness (the section)', u: 'mm', lo: 0.05, hi: 500, d: 2 },
  'bow.I': { l: 'Second moment of area', u: 'mm⁴', lo: 1e-3, hi: 1e12, d: 0, blank: 'auto' },
  crest: { l: 'Waviness: first crest at', u: 'mm', lo: -1000, hi: 1000, d: 1, blank: 'auto' },
  'ends.left.c': { l: 'Left chamfer length', u: 'mm', lo: 0.5, hi: 150, d: 1 }, 'ends.left.d': { l: 'Left chamfer depth', u: 'µm', lo: 0, hi: 500, d: 1 },
  'ends.right.c': { l: 'Right chamfer length', u: 'mm', lo: 0.5, hi: 150, d: 1 }, 'ends.right.d': { l: 'Right chamfer depth', u: 'µm', lo: 0, hi: 500, d: 1 },
  'crown.um': { l: 'Crown at the middle', u: 'µm', lo: -500, hi: 500, d: 1 },
  'bladeEnds.left': { l: 'Blade\'s left end past the web\'s edge', u: 'mm', lo: -100, hi: 100, d: 1 },
  'bladeEnds.right': { l: 'Blade\'s right end past the web\'s edge', u: 'mm', lo: -100, hi: 100, d: 1 },
  edgeBand: { l: 'Crown: edge band left out', u: 'mm', lo: 0, hi: 100, d: 1 },
  'sine.a': { l: 'Sine amplitude', u: 'µm', lo: 0, hi: 500, d: 1 }, 'sine.lw': { l: 'Sine wavelength', u: 'mm', lo: 5, hi: 1000, d: 1 },
  'sine.crest': { l: 'Sine: first crest at', u: 'mm', lo: -1000, hi: 1000, d: 1, blank: 'auto' },
};
const acrGet = (o, path) => path.split('.').reduce((a, k) => a == null ? a : a[k], o);
function acrPut(o, path, v) { const ks = path.split('.'), last = ks.pop(); let a = o; for (const k of ks) a = a[k]; a[last] = v; }
const acrFmt = (v, d) => v == null ? '' : String(+(+v).toFixed(d));
/** The across control that has the keyboard focus (both panels are drawn anew with every render: ui.js's render() puts it back). */
function acrFocusSave() {
  const a = document.activeElement;
  if (!a || !a.closest || !a.closest('.acr-side, .acr-panel, .acr-svg')) return null;
  const sel = a.id ? `#${a.id}` : a.dataset.acrSeg ? `[data-acr-seg="${a.dataset.acrSeg}"][data-v="${a.dataset.v}"]` : a.dataset.acrOn ? `[data-acr-on="${a.dataset.acrOn}"]`
    : a.dataset.acrAct ? `[data-acr-act="${a.dataset.acrAct}"]${a.dataset.j != null ? `[data-j="${a.dataset.j}"]` : ''}` : a.dataset.h ? `[data-h="${a.dataset.h}"]` : null;
  return sel ? { sel, where: a.closest('.acr-side') ? '.acr-side' : a.closest('.acr-svg') ? '.acr-svg' : '.acr-panel' } : null;
}
function acrFocusRestore(f) {
  if (!f || (document.activeElement && document.activeElement !== document.body)) return;
  const el = document.querySelector(f.sel.startsWith('#') ? f.sel : `${f.where} ${f.sel}`);
  if (el) el.focus({ preventScroll: true });
}
const acrRender = () => render();
/** Change a setting (one undo step) and draw everything again. */
function acrossSet(path, v, hint) {
  undoHint(hint);
  const n = JSON.parse(JSON.stringify(ACR));
  acrPut(n, path, v);
  Object.assign(ACR, n);
  acrRender();
}
/** The sidebar's copy of the panel, in its Variation across the web group (drawn with every view). */
function acrossSidebar() {
  const grp = [...paramsContainer.querySelectorAll('details.grp')].find(d => d.querySelector('summary').textContent === 'Variation across the web');
  if (!grp) return;
  let host = grp.querySelector('.acr-side');
  if (!host) { host = document.createElement('div'); host.className = 'acr-side'; grp.appendChild(host); }
  host.innerHTML = `<div class="acr-grp">Blade across the web</div>${acrossPanelHTML('sb')}
    <div class="acr-row"><button type="button" class="btn btn-secondary btn-sm" data-acr-act="go">${uiIco('wave')}Design it on the Across the web page</button></div>`;
}
/** The settings of a project or case (none: the defaults); the parts it predates stay off. */
function applyAcross(a) {
  const d = JSON.parse(JSON.stringify(ACR_DEFAULTS));
  for (const k of Object.keys(d)) if (a && k in a) d[k] = d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && a[k] && typeof a[k] === 'object' ? { ...d[k], ...JSON.parse(JSON.stringify(a[k])) } : JSON.parse(JSON.stringify(a[k]));
  for (const k of Object.keys(ACR)) delete ACR[k];
  Object.assign(ACR, d);
}

/** A change's name for undo / redo (a unit per setting: undo.js). */
function acrossUndoLabel(k, a, b) {
  const f = (v, d, u) => v == null ? 'auto' : `${+(+v).toFixed(d)}${u ? ' ' + u : ''}`;
  const onOff = (name, x, y) => x.on !== y.on ? `${name} ${y.on ? 'on' : 'off'}` : null;
  a = a || {}; b = b || {};
  if (k === 'bladeEnds') return `Blade's ends past the web's edges: left ${f(a.left, 1, 'mm')} → ${f(b.left, 1, 'mm')}, right ${f(a.right, 1, 'mm')} → ${f(b.right, 1, 'mm')}`;
  if (k === 'crest') return `Waviness: first crest ${a == null || typeof a === 'object' ? 'a quarter wavelength in' : f(a, 1, 'mm')} → ${b == null || typeof b === 'object' ? 'a quarter wavelength in' : f(b, 1, 'mm')}`;
  if (k === 'edgeBand') return `Crown: edge band ${f(a, 1, 'mm')} → ${f(b, 1, 'mm')}`;
  if (k === 'sines') {
    const na = (a || []).length, nb = (b || []).length;
    if (nb > na) return `Add sine ${nb + 1}`;
    if (nb < na) return `Remove a sine (${na + 1} → ${nb + 1} with the first)`;
    const j = b.findIndex((s, i) => JSON.stringify(s) !== JSON.stringify(a[i]));
    return j < 0 ? 'Sines' : `Sine ${j + 2}: ${b[j].a} µm, ${b[j].lw} mm${b[j].crest != null ? `, crest at ${b[j].crest} mm` : ''}`;
  }
  if (k === 'bow') {
    const t = onOff('Bow', a, b); if (t) return t;
    if (a.mode !== b.mode) return `Bow: ${a.mode} → ${b.mode}`;
    if (a.supports !== b.supports) return `Bow: blade ${a.supports === 'clamped' ? 'clamped' : 'simply supported'} → ${b.supports === 'clamped' ? 'clamped' : 'simply supported'} at its ends`;
    if (a.shape !== b.shape) return `Bow shape: ${a.shape} → ${b.shape}`;
    const q = ['um', 'E', 'rhoB', 'h', 't', 'I'].find(x => a[x] !== b[x]);
    return q ? `${ACR_NUM['bow.' + q].l}: ${f(a[q], ACR_NUM['bow.' + q].d, ACR_NUM['bow.' + q].u)} → ${f(b[q], ACR_NUM['bow.' + q].d, ACR_NUM['bow.' + q].u)}` : 'Bow';
  }
  if (k === 'ends') {
    const t = onOff('Chamfered ends', a, b); if (t) return t;
    const q = ['left.c', 'left.d', 'right.c', 'right.d'].find(x => acrGet(a, x) !== acrGet(b, x));
    return q ? `${ACR_NUM['ends.' + q].l}: ${f(acrGet(a, q), 1, ACR_NUM['ends.' + q].u)} → ${f(acrGet(b, q), 1, ACR_NUM['ends.' + q].u)}` : 'Chamfered ends';
  }
  if (k === 'meas') {
    const t = onOff('Measured gap', a, b); if (t) return t;
    return (b.pts || []).length ? `Measured gap: ${b.name || 'imported'} (${b.pts.length} points)` : 'Measured gap cleared';
  }
  if (k === 'crown') {
    const t = onOff('Crown', a, b); if (t) return t;
    if (a.kind !== b.kind || JSON.stringify(a.pts) !== JSON.stringify(b.pts)) return b.kind === 'free' ? `Crown: the free curve${b.name ? ` (${b.name})` : ''}` : `Crown: parabola ${f(b.um, 1, 'µm')}`;
    return `Crown at the middle: ${f(a.um, 1, 'µm')} → ${f(b.um, 1, 'µm')}`;
  }
  return k;
}

// ---- the parts panel (the page's side and the sidebar's Variation across the web group) ----
/** The panel: where 'pg' (the page: every part, the sidebar's variation inputs too) or 'sb' (the sidebar: the new parts). */
function acrossPanelHTML(where) {
  const pg = where === 'pg', b = ACR.bow, id = p => `acr_${where}_${p.replace(/\./g, '_')}`;
  const num = (path, v, extra = '') => { const m = ACR_NUM[path.startsWith('sines.') ? 'sine.' + path.split('.')[2] : path]; return `<input type="number" class="acr-in" id="${id(path)}" data-acr="${path}" value="${acrFmt(v, m.d)}" step="any" min="${m.lo}" max="${m.hi}"${m.blank ? ` placeholder="${m.blank}"` : ''} aria-label="${escAttr(m.l)}${m.u ? ', ' + m.u : ''}"${extra}>`; };
  const pnum = k => { const c = CFG.find(q => q.k === k); return `<input type="number" class="acr-in" id="acr_${where}_p_${k}" data-acrp="${k}" value="${(+P[k]).toFixed(c.d)}" step="${c.step}" min="${c.min}" max="${c.max}" aria-label="${escAttr(c.l)}, ${c.u}">`; };
  const chk = (k, on, label, sw) => `<label class="acr-chk"><input type="checkbox" data-acr-on="${k}"${on ? ' checked' : ''}>${sw ? `<i class="acr-sw" style="background:${sw}"></i>` : ''}${label}</label>`;
  const seg = (path, cur, items, label) => `<div class="seg acr-seg" role="tablist" aria-label="${label}">${items.map(([v, t]) => `<button type="button" role="tab" data-acr-seg="${path}" data-v="${v}" aria-selected="${cur === v}">${t}</button>`).join('')}</div>`;
  const row = (l, v, cls = '') => `<div class="acr-row${cls ? ' ' + cls : ''}"><span class="acr-l">${l}</span><span class="acr-v">${v}</span></div>`;
  const col = ACROSS_COLS;
  let h = `<div class="acr-grp">The blade</div>`;
  // bow
  h += `<div class="acr-part">${chk('bow', b.on, 'Bow', col.bow)}${b.on ? seg('bow.mode', b.mode, [['computed', 'Computed'], ['typed', 'Typed']], 'Bow: computed or typed') : ''}</div>`;
  if (b.on && b.mode === 'typed') h += row('at the middle', `${num('bow.um', b.um)}<span class="u">µm</span>`) + row('shape', `<select data-acr="bow.shape" id="${id('bow.shape')}" aria-label="Bow shape">${[['parabola', 'parabola'], ['arc', 'circular arc'], ['cosine', 'cosine']].map(([v, t]) => `<option value="${v}"${b.shape === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`);
  if (b.on && b.mode === 'computed') {
    const B = acrossBowComputed(), sec = beamSection(b);
    h += row('held', seg('bow.supports', b.supports, [['simple', 'Simply supported'], ['clamped', 'Clamped']], 'Blade held at its ends'))
      + row('section h × t', `${num('bow.h', b.h)}<span class="u">×</span>${num('bow.t', b.t)}<span class="u">mm</span>`)
      + row('I', `${num('bow.I', b.I)}<span class="u">mm⁴</span>`) + row('E · density', `${num('bow.E', b.E)}<span class="u">GPa</span>${num('bow.rhoB', b.rhoB)}<span class="u">kg/m³</span>`)
      + `<p class="acr-note">${B.error ? `<span class="warn-text">${escAttr(B.error)}</span>` : `Bow ${fmtUm(B.at((B.span[0] + B.span[1]) / 2))} at the middle: the slurry pushes up ${(B.loads.reduce((a, v) => a + v, 0) / B.loads.length).toFixed(1)} N/m, the blade weighs ${B.weight.toFixed(1)} N/m (EI ${fmtSig(B.EI)} N·m², I ${fmtSig(sec.I * 1e12)} mm⁴); ${B.iters} round${B.iters === 1 ? '' : 's'}, ${B.ms.toFixed(0)} ms.`}</p>`;
  }
  // tilt, waviness (the sidebar has these as its own rows above)
  if (pg) h += `<div class="acr-part"><span class="acr-chk"><i class="acr-sw" style="background:${col.tilt}"></i>Tilt</span></div>` + row('edge to edge', `${pnum('tilt')}<span class="u">µm</span>`);
  h += `<div class="acr-part"><span class="acr-chk"><i class="acr-sw" style="background:${col.wave}"></i>Waviness</span></div>`;
  if (pg) h += row('amplitude', `${pnum('dH')}<span class="u">µm</span>`) + row('wavelength', `${pnum('lw')}<span class="u">mm</span>`);
  h += row('first crest at', `${num('crest', ACR.crest)}<span class="u">mm</span>`);
  if (ACR.sines.length) h += `<div class="acr-row acr-sine acr-sine-h"><span class="acr-l">more sines</span><span class="acr-v"><span>µm</span><span>mm</span><span>crest, mm</span><span class="acr-del-sp"></span></span></div>`;
  ACR.sines.forEach((s, j) => { h += row(`sine ${j + 2}`, `${num(`sines.${j}.a`, s.a)}${num(`sines.${j}.lw`, s.lw)}${num(`sines.${j}.crest`, s.crest)}<button type="button" class="icon-btn acr-del" data-acr-act="sine-del" data-j="${j}" title="Remove sine ${j + 2}" aria-label="Remove sine ${j + 2}">${uiIco('trash')}</button>`, 'acr-sine'); });
  h += `<div class="acr-row"><button type="button" class="btn btn-secondary btn-sm" data-acr-act="sine-add">${uiIco('plus')}Sine</button><span class="acr-hint">another sine across the web</span></div>`;
  // chamfered ends
  h += `<div class="acr-part">${chk('ends', ACR.ends.on, 'Chamfered ends', col.ends)}</div>`;
  if (ACR.ends.on) h += row('left', `${num('ends.left.c', ACR.ends.left.c)}<span class="u">mm ×</span>${num('ends.left.d', ACR.ends.left.d)}<span class="u">µm</span>`)
    + row('right', `${num('ends.right.c', ACR.ends.right.c)}<span class="u">mm ×</span>${num('ends.right.d', ACR.ends.right.d)}<span class="u">µm</span>`)
    + `<p class="acr-note">Over the last length at each end the gap grows straight to the depth at the blade's end.</p>`;
  // measured gap
  const m = ACR.meas;
  h += `<div class="acr-part">${m.pts.length ? chk('meas', m.on, 'Measured gap', col.meas) : `<span class="acr-chk"><i class="acr-sw" style="background:${col.meas}"></i>Measured gap</span>`}</div>`
    + `<div class="acr-row"><button type="button" class="btn btn-secondary btn-sm" data-acr-act="meas-import">${uiIco('upload')}${m.pts.length ? 'Import another…' : 'Import CSV…'}</button>${m.pts.length ? `<span class="acr-hint">${escAttr(m.name || 'imported')}: ${m.pts.length} points</span><button type="button" class="icon-btn acr-del" data-acr-act="meas-clear" title="Clear the measured gap" aria-label="Clear the measured gap">${uiIco('trash')}</button>` : ''}</div>`;
  // crown
  const c = ACR.crown;
  h += `<div class="acr-part">${chk('crown', c.on, 'Crown', col.crown)}${c.on && c.pts.length ? seg('crown.kind', c.kind, [['parabola', 'Parabola'], ['free', 'Free curve']], 'Crown: parabola or free curve') : ''}</div>`;
  if (c.on && c.kind === 'parabola') h += row('at the middle', `${num('crown.um', c.um)}<span class="u">µm</span>`);
  if (c.on && c.kind === 'free') h += `<p class="acr-note">The free curve found${c.name ? ` (${escAttr(c.name)})` : ''}: ${c.pts.length} points.</p>`;
  if (pg) h += `<div class="acr-part"><span class="acr-chk">Skew</span></div>` + row('to the cross direction', `${pnum('skew')}<span class="u">°</span>`);
  // the blade's ends
  h += `<div class="acr-part"><span class="acr-chk">Blade's ends</span></div>`
    + row('left · right, past the web\'s edges', `${num('bladeEnds.left', ACR.bladeEnds.left)}${num('bladeEnds.right', ACR.bladeEnds.right)}<span class="u">mm</span>`)
    + `<p class="acr-note">+ the blade overhangs the web's edge, − it ends inside. The bow and the chamfers are measured from the blade's ends.</p>`;
  if (pg) h += `<div class="acr-grp">The web and the wetting</div>` + row('Fibre thickness variation', `${pnum('dt')}<span class="u">µm</span>`) + row('Wetting variation on blade', `${pnum('dth')}<span class="u">°</span>`);
  return h;
}
const fmtUm = v => `${v >= 0 ? '+' : '−'}${Math.abs(v) >= 10 ? Math.abs(v).toFixed(1) : Math.abs(v) >= 0.1 ? Math.abs(v).toFixed(2) : Math.abs(v).toFixed(4)} µm`;
const fmtSig = v => Math.abs(v) >= 1e5 || Math.abs(v) < 1e-2 ? v.toExponential(2) : String(+v.toPrecision(3));
/** The parts' colours (the front view, the panel's swatches). */
const ACROSS_COLS = { bow: '#d97706', tilt: '#7c3aed', wave: '#0891b2', ends: '#dc2626', meas: '#16a34a', crown: '#db2777', fibre: '#94a3b8' };

// (one set of listeners for both panels: the page's and the sidebar's)
document.addEventListener('change', e => {
  const el = e.target;
  if (!el.closest) return;
  if (el.dataset.acrOn) { const k = el.dataset.acrOn; acrossSet(`${k}.on`, el.checked, `${{ bow: 'Bow', ends: 'Chamfered ends', meas: 'Measured gap', crown: 'Crown' }[k]} ${el.checked ? 'on' : 'off'}`); return; }
  if (el.dataset.acrp) {
    const k = el.dataset.acrp, c = CFG.find(q => q.k === k);
    guardNumber(el, { label: c.l, lo: c.min, hi: c.max, unit: c.u }, v => { undoHint(`${c.l}: ${(+P[k]).toFixed(c.d)} → ${(+v).toFixed(c.d)} ${c.u}`); setInput(k, v); acrRender(); });
    return;
  }
  const path = el.dataset.acr;
  if (!path) return;
  if (el.tagName === 'SELECT') { acrossSet(path, el.value, `Bow shape: ${acrGet(ACR, path)} → ${el.value}`); return; }
  const m = ACR_NUM[path.startsWith('sines.') ? 'sine.' + path.split('.')[2] : path];
  guardNumber(el, { label: m.l, lo: m.lo, hi: m.hi, unit: m.u, allowEmpty: !!m.blank }, v => {
    const old = acrGet(ACR, path);
    if (v === old) return;
    const blank = { auto: path.includes('crest') ? 'a quarter wavelength in' : 'from the section' }[m.blank] || m.blank;
    acrossSet(path, v, `${m.l}: ${old == null ? blank : `${+(+old).toFixed(m.d)} ${m.u}`} → ${v == null ? blank : `${+(+v).toFixed(m.d)} ${m.u}`}`);
  });
});
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-acr-seg], [data-acr-act]');
  if (!t) return;
  if (t.dataset.acrSeg) {
    const path = t.dataset.acrSeg, v = t.dataset.v, old = acrGet(ACR, path);
    if (v !== old) acrossSet(path, v, { 'bow.mode': `Bow: ${old} → ${v}`, 'bow.supports': `Bow: blade ${v === 'clamped' ? 'clamped' : 'simply supported'} at its ends`, 'crown.kind': `Crown: ${v === 'free' ? 'the free curve' : 'parabola'}` }[path] || path);
    return;
  }
  const act = t.dataset.acrAct;
  if (act === 'sine-add') { const n = ACR.sines.length; acrossSet('sines', [...ACR.sines, { a: 5, lw: Math.max(10, Math.round(P.lw / (n + 2))), crest: null }], `Add sine ${n + 2}`); }
  else if (act === 'sine-del') { const j = +t.dataset.j; acrossSet('sines', ACR.sines.filter((_, i) => i !== j), `Remove sine ${j + 2}`); }
  else if (act === 'meas-clear') acrossSet('meas', { on: false, name: '', pts: [] }, 'Measured gap cleared');
  else if (act === 'meas-import') acrossMeasDialog();
  else if (act === 'go') { tab = 11; render(); }
});

// ---- the front view: the gap across the web, each part and their sum, with handles ----
/** The front view's curves (µm) at n + 1 points over [zA, zB] (mm): each part where it applies, the sum where web and blade both are. */
function acrossCurves(zA, zB, n = 360, acr = ACR) {
  const keep = JSON.stringify(ACR);
  if (acr !== ACR) Object.assign(ACR, JSON.parse(JSON.stringify(acr)));   // (a drag's trial settings)
  try {
    const span = acrossSpanNow(), g0 = gapHeight() * 1000, out = { z: [], wave: [], tilt: [], fibre: [], bow: [], ends: [], meas: [], crown: [], sum: [] };
    for (let i = 0; i <= n; i++) {
      const z = zA + (zB - zA) * i / n, onWeb = z >= 0 && z <= ACR_W, onBlade = z >= span[0] && z <= span[1], pt = onBlade ? acrossParts(z) : null;
      out.z.push(z);
      out.wave.push(onBlade ? acrossWave(z) + pt.sines : NaN);
      out.tilt.push(onBlade ? P.tilt * (z / 300 - 0.5) : NaN);
      out.fibre.push(onWeb ? -P.dt * spatialNoise(z, 1.7) : NaN);
      for (const k of ['bow', 'ends', 'meas', 'crown']) out[k].push(onBlade ? pt[k] : NaN);
      out.sum.push(onWeb && onBlade ? localGap(z) * 1000 - g0 : NaN);
    }
    return out;
  } finally { if (acr !== ACR) { for (const k of Object.keys(ACR)) delete ACR[k]; Object.assign(ACR, JSON.parse(keep)); } }
}
/** The front view (SVG) for a box w x h px; acr: the settings drawn (a drag's trial ones), p: the sidebar inputs drawn. */
function acrossFrontSVG(w, h, acr = ACR, fixed = null) {
  const sp = acrossSpan(ACR_W, acr.bladeEnds), zA = Math.min(0, sp[0]) - 6, zB = Math.max(ACR_W, sp[1]) + 6;
  const C = acrossCurves(zA, zB, 360, acr), col = ACROSS_COLS;
  const on = { bow: acr.bow.on, ends: acr.ends.on, meas: acr.meas.on && acr.meas.pts.length > 0, crown: acr.crown.on };
  const series = [['wave', true], ['tilt', !!P.tilt], ['fibre', !!P.dt], ['bow', on.bow], ['ends', on.ends], ['meas', on.meas], ['crown', on.crown]].filter(q => q[1]).map(q => q[0]);
  let lo = 0, hi = 0;
  for (const k of [...series, 'sum']) for (const v of C[k]) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const pad = Math.max(8, 0.2 * (hi - lo)); lo -= pad; hi += pad;
  if (fixed) { lo = Math.min(lo, fixed.lo); hi = Math.max(hi, fixed.hi); }   // (a drag: the scale it started with, widened only if the curves leave it)
  const L = 58, R = 18, T = 16, B = 44, X = z => L + (w - L - R) * (z - zA) / (zB - zA), Y = v => T + (h - T - B) * (hi - v) / (hi - lo), f = n => n.toFixed(1);
  const path = (k, cls, extra = '') => { let d = '', pen = false; C[k].forEach((v, i) => { if (!Number.isFinite(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f(X(C.z[i]))} ${f(Y(v))}`; pen = true; }); return d ? `<path class="${cls}" d="${d}"${extra}/>` : ''; };
  const g = [];
  const yWeb = h - B + 8;
  // the blade (hatched above its edge) and the web below
  let body = '', first = null;
  C.sum.forEach((v, i) => { const z = C.z[i]; if (z < sp[0] || z > sp[1]) return; const vv = Number.isFinite(v) ? v : (C.bow[i] || 0) + (C.ends[i] || 0) + (C.crown[i] || 0) + (C.wave[i] || 0) + (C.tilt[i] || 0) + (C.meas[i] || 0); body += `${first == null ? 'M' : 'L'}${f(X(z))} ${f(Y(vv))}`; if (first == null) first = z; });
  if (body) g.push(`<path class="acr-blade" d="${body}L${f(X(sp[1]))} ${T} L${f(X(sp[0]))} ${T} Z"/>`);
  g.push(`<rect class="acr-web" x="${f(X(0))}" y="${f(yWeb)}" width="${f(X(ACR_W) - X(0))}" height="10"/><line class="acr-webline" x1="${f(X(0))}" x2="${f(X(ACR_W))}" y1="${f(yWeb)}" y2="${f(yWeb)}"/>`);
  g.push(`<text class="acr-t" x="${f(X(ACR_W / 2))}" y="${f(yWeb + 24)}" text-anchor="middle">position across the web, mm · the web ${gapHeight().toFixed(3)} mm below the dashed line (the nominal gap)</text>`);
  // axes
  g.push(`<line class="acr-zero" x1="${L}" x2="${w - R}" y1="${f(Y(0))}" y2="${f(Y(0))}"/>`);
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find(s => (hi - lo) / s <= 6) || 1000;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) g.push(`<text class="acr-t" x="${L - 6}" y="${f(Y(v) + 4)}" text-anchor="end">${v > 0 ? '+' : ''}${v}</text><line class="acr-grid" x1="${L}" x2="${w - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/>`);
  g.push(`<text class="acr-t" x="14" y="${f((T + h - B) / 2)}" transform="rotate(-90 14 ${f((T + h - B) / 2)})" text-anchor="middle">gap change, µm</text>`);
  for (let z = 0; z <= ACR_W; z += 50) g.push(`<text class="acr-t" x="${f(X(z))}" y="${f(yWeb - 4)}" text-anchor="middle">${z}</text>`);
  // the locations (the 2D's four)
  CFD_LOCS.forEach((l, i) => g.push(`<line class="acr-loc" x1="${f(X(l.z))}" x2="${f(X(l.z))}" y1="${T}" y2="${f(yWeb)}"/><text class="acr-t acr-loct" x="${f(X(l.z) + 3)}" y="${T + 10}">L${i + 1}</text>`));
  // beyond the blade's ends (it ends inside the web): no metering there
  if (sp[0] > 0) g.push(`<rect class="acr-nob" x="${f(X(0))}" y="${T}" width="${f(X(sp[0]) - X(0))}" height="${f(yWeb - T)}"/>`);
  if (sp[1] < ACR_W) g.push(`<rect class="acr-nob" x="${f(X(sp[1]))}" y="${T}" width="${f(X(ACR_W) - X(sp[1]))}" height="${f(yWeb - T)}"/>`);
  // the parts, then their sum
  for (const k of series) g.push(path(k, 'acr-part-line', ` stroke="${col[k]}"`));
  g.push(path('sum', 'acr-sum'));
  // the blade's ends: tabs at the top to drag sideways (under the other handles)
  g.push(`<line class="acr-endl" x1="${f(X(sp[0]))}" x2="${f(X(sp[0]))}" y1="${T}" y2="${f(yWeb)}"/><line class="acr-endl" x1="${f(X(sp[1]))}" x2="${f(X(sp[1]))}" y1="${T}" y2="${f(yWeb)}"/>`);
  g.push(`<rect class="acr-endh" data-h="bladeL" x="${f(X(sp[0]) - 6)}" y="${T}" width="12" height="26" rx="3" tabindex="0" role="slider" aria-label="The blade's left end: drag sideways"><title>The blade's left end, ${acr.bladeEnds.left} mm past the web's edge: drag sideways</title></rect>`);
  g.push(`<rect class="acr-endh" data-h="bladeR" x="${f(X(sp[1]) - 6)}" y="${T}" width="12" height="26" rx="3" tabindex="0" role="slider" aria-label="The blade's right end: drag sideways"><title>The blade's right end, ${acr.bladeEnds.right} mm past the web's edge: drag sideways</title></rect>`);
  // handles
  const hd = (k, z, v, title, cls = '') => `<circle class="acr-h${cls ? ' ' + cls : ''}" data-h="${k}" cx="${f(X(z))}" cy="${f(Y(v))}" r="7" tabindex="0" role="slider" aria-label="${escAttr(title)}"><title>${escAttr(title)}</title></circle>`;
  const zc = (sp[0] + sp[1]) / 2;
  if (on.bow && acr.bow.mode === 'typed') g.push(hd('bow', zc, acrossBowTyped(zc, acr.bow.um, acr.bow.shape, sp), `Bow ${acr.bow.um} µm at the middle: drag up or down`), `<text class="acr-ht" x="${f(X(zc))}" y="${f(Y(acr.bow.um) - 12)}" text-anchor="middle" fill="${col.bow}">bow ${+acr.bow.um.toFixed(1)} µm</text>`);
  if (on.crown && acr.crown.kind === 'parabola') g.push(hd('crown', zc + (sp[1] - sp[0]) * 0.12, acrossBowTyped(zc + (sp[1] - sp[0]) * 0.12, acr.crown.um, 'parabola', sp), `Crown ${acr.crown.um} µm at the middle: drag up or down`));
  g.push(hd('tilt', ACR_W, P.tilt / 2, `Tilt ${P.tilt} µm edge to edge: drag up or down`), `<text class="acr-ht" x="${f(X(ACR_W) - 10)}" y="${f(Y(P.tilt / 2) + 20)}" text-anchor="end" fill="${col.tilt}">tilt ${P.tilt} µm</text>`);
  const cz = acr.crest ?? P.lw / 4;
  if (P.dH > 0 || acr.crest != null) g.push(hd('wave', cz, P.dH, `Waviness ${P.dH} µm, first crest at ${+cz.toFixed(1)} mm: drag up or down for the amplitude, sideways for the crest`), `<text class="acr-ht" x="${f(X(cz))}" y="${f(Y(P.dH) - 12)}" text-anchor="middle" fill="${col.wave}">waviness ${P.dH} µm</text>`);
  if (on.ends) {
    const e = acr.ends;
    g.push(hd('endLd', sp[0], e.left.d, `Left chamfer depth ${e.left.d} µm: drag up or down`), hd('endLc', sp[0] + e.left.c, 0, `Left chamfer length ${e.left.c} mm: drag sideways`, 'acr-hx'));
    g.push(hd('endRd', sp[1], e.right.d, `Right chamfer depth ${e.right.d} µm: drag up or down`), hd('endRc', sp[1] - e.right.c, 0, `Right chamfer length ${e.right.c} mm: drag sideways`, 'acr-hx'));
  }
  // the legend (below the drawing, HTML)
  const names = { wave: 'waviness', tilt: 'tilt', fibre: 'fibre thickness (the web)', bow: acr.bow.mode === 'computed' ? 'bow (computed)' : 'bow', ends: 'chamfered ends', meas: 'measured gap', crown: 'crown' };
  const legend = series.map(k => `<span><i class="acr-lg" style="border-color:${col[k]}"></i>${names[k]}</span>`).join('') + `<span><i class="acr-lg acr-lg-sum"></i>the blade's edge: their sum</span>`;
  return { svg: `<svg class="acr-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="The gap across the web, seen from the front">${g.join('')}</svg>`, legend, X, Y, lo, hi, inv: { z: px => zA + (px - L) * (zB - zA) / (w - L - R), v: py => hi - (py - T) * (hi - lo) / (h - T - B) } };
}
/** Draw the front view in host, and let its handles be dragged (the value set when let go: one undo step). */
function drawAcrossFront(host) {
  if (!host) return;
  const w = Math.max(420, host.clientWidth), h = Math.max(200, Math.min(300, (host.clientHeight || 270) - 24));
  let F = acrossFrontSVG(w, h);
  host.innerHTML = F.svg + `<div class="acr-legend">${F.legend}</div>`;
  const svg = host.querySelector('svg');
  const onDown = e => {
    const hEl = e.target.closest('[data-h]');
    if (!hEl) return;
    e.preventDefault();
    const k = hEl.dataset.h, r = svg.getBoundingClientRect(), trial = JSON.parse(JSON.stringify(ACR)), p0 = { tilt: P.tilt, dH: P.dH };
    const pc = k => CFG.find(q => q.k === k), clampP = (k, v) => { const c = pc(k); return Math.min(c.max, Math.max(c.min, Math.round(v / c.step) * c.step)); };
    const cl = (path, v) => { const m = ACR_NUM[path]; return Math.min(m.hi, Math.max(m.lo, v)); };
    // (the change follows the pointer's movement from where the handle was grabbed: no jump on grabbing it)
    const F0 = F, z0 = F0.inv.z(e.clientX - r.left), v0 = F0.inv.v(e.clientY - r.top), a0 = JSON.parse(JSON.stringify(ACR)), sp0 = acrossSpan(ACR_W, a0.bladeEnds);
    const cz0 = a0.crest ?? P.lw / 4, xc = (z0 - (sp0[0] + sp0[1]) / 2) / ((sp0[1] - sp0[0]) / 2), fc = 1 - Math.min(0.95, xc * xc);
    const move = ev => {
      const dz = F0.inv.z(ev.clientX - r.left) - z0, dv = F0.inv.v(ev.clientY - r.top) - v0;   // (the mapping it was grabbed with)
      if (k === 'bow') trial.bow.um = +cl('bow.um', a0.bow.um + dv).toFixed(1);
      else if (k === 'crown') trial.crown.um = +cl('crown.um', a0.crown.um + dv / fc).toFixed(1);
      else if (k === 'tilt') P.tilt = clampP('tilt', p0.tilt + 2 * dv);
      else if (k === 'wave') { P.dH = clampP('dH', p0.dH + dv); trial.crest = Math.abs(dz) < 0.5 && a0.crest == null ? null : +cl('crest', cz0 + dz).toFixed(1); }
      else if (k === 'endLd') trial.ends.left.d = +cl('ends.left.d', a0.ends.left.d + dv).toFixed(1);
      else if (k === 'endRd') trial.ends.right.d = +cl('ends.right.d', a0.ends.right.d + dv).toFixed(1);
      else if (k === 'endLc') trial.ends.left.c = +cl('ends.left.c', a0.ends.left.c + dz).toFixed(1);
      else if (k === 'endRc') trial.ends.right.c = +cl('ends.right.c', a0.ends.right.c - dz).toFixed(1);
      else if (k === 'bladeL') trial.bladeEnds.left = +cl('bladeEnds.left', a0.bladeEnds.left - dz).toFixed(1);
      else if (k === 'bladeR') trial.bladeEnds.right = +cl('bladeEnds.right', a0.bladeEnds.right + dz).toFixed(1);
      F = acrossFrontSVG(w, h, trial, F0);
      svg.innerHTML = new DOMParser().parseFromString(F.svg, 'image/svg+xml').documentElement.innerHTML;
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      const pNow = { tilt: P.tilt, dH: P.dH };
      P.tilt = p0.tilt; P.dH = p0.dH;   // (set again below as inputs, so their sliders and undo see it)
      const acrChanged = JSON.stringify(trial) !== JSON.stringify(ACR), pChanged = pNow.tilt !== p0.tilt || pNow.dH !== p0.dH;
      if (!acrChanged && !pChanged) { drawAcrossFront(host); return; }
      undoHint({ bow: `Bow at the middle: ${ACR.bow.um} → ${trial.bow.um} µm`, crown: `Crown at the middle: ${ACR.crown.um} → ${trial.crown.um} µm`, tilt: `Tilt: ${p0.tilt} → ${pNow.tilt} µm`,
        wave: `Waviness: ${p0.dH} µm, crest ${ACR.crest ?? 'a quarter wavelength in'} → ${pNow.dH} µm, crest at ${trial.crest} mm`, endLd: 'Left chamfer depth', endRd: 'Right chamfer depth', endLc: 'Left chamfer length', endRc: 'Right chamfer length',
        bladeL: `Blade's left end: ${ACR.bladeEnds.left} → ${trial.bladeEnds.left} mm past the web's edge`, bladeR: `Blade's right end: ${ACR.bladeEnds.right} → ${trial.bladeEnds.right} mm past the web's edge` }[k]);
      if (pChanged) { setInput('tilt', pNow.tilt); setInput('dH', pNow.dH); }
      if (acrChanged) Object.assign(ACR, trial);
      render();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  };
  svg.addEventListener('pointerdown', onDown);
  // (arrow keys on a focused handle: small steps, shift: larger)
  svg.addEventListener('keydown', e => {
    const hEl = e.target.closest('[data-h]');
    if (!hEl || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const k = hEl.dataset.h, s = (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1);
    const nudge = { bow: ['bow.um', 1], crown: ['crown.um', 1], endLd: ['ends.left.d', 1], endRd: ['ends.right.d', 1], endLc: ['ends.left.c', 0.5], endRc: ['ends.right.c', 0.5], bladeL: ['bladeEnds.left', 0.5], bladeR: ['bladeEnds.right', 0.5] }[k];
    if (nudge) { const [path, st] = nudge, m = ACR_NUM[path], v = Math.min(m.hi, Math.max(m.lo, +(acrGet(ACR, path) + s * st).toFixed(2))); acrossSet(path, v, `${m.l}: ${acrGet(ACR, path)} → ${v} ${m.u}`); }
    else if (k === 'tilt' || k === 'wave') { const pk = k === 'tilt' ? 'tilt' : 'dH', c = CFG.find(q => q.k === pk), v = Math.min(c.max, Math.max(c.min, P[pk] + s * c.step)); undoHint(`${c.l}: ${P[pk]} → ${v} ${c.u}`); setInput(pk, v); render(); }
    const again = document.querySelector(`.acr-svg [data-h="${k}"]`); if (again) again.focus();
  });
}

// ---- a measured gap profile: z (mm) and the gap, pasted or from a file ----
function acrossMeasDialog() {
  const st = { text: '', name: 'pasted', vals: 'um' };
  const conv = { um: ['gap change, µm', v => v], mm: ['gap, mm (the nominal gap taken off)', v => (v - gapHeight()) * 1000], umAbs: ['gap, µm (the nominal gap taken off)', v => v - gapHeight() * 1000] };
  const read = () => parsePointsCSV(st.text).map(p => [p.x, conv[st.vals][1](p.y)]);
  custDialog('acrMeasDlg', 'Measured gap across the web', () => {
    const pts = read(), zs = pts.map(p => p[0]), vs = pts.map(p => p[1]);
    return `<p class="fv-note">One reading per line: the position across the web (mm from the left edge) and the gap there (commas, semicolons, tabs or spaces; a header line is skipped). Between readings a smooth curve that does not overshoot them; beyond the first and last, their values. It is added to the other parts (switch them off to use it alone).</p>
      <textarea id="acrMeasText" rows="10" class="mono cust-text" spellcheck="false" aria-label="Readings">${custEsc(st.text)}</textarea>
      <div class="cust-opts"><label class="fv-ctl">Values <select id="acrMeasVals">${Object.entries(conv).map(([k, [l]]) => `<option value="${k}"${k === st.vals ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-secondary btn-sm" id="acrMeasLoad">${uiIco('upload')}Load a file…</button><input type="file" id="acrMeasFile" accept=".csv,.txt,.tsv" hidden>
        <span class="fv-why" id="acrMeasN">${pts.length ? `${pts.length} readings, ${Math.min(...zs).toFixed(1)} to ${Math.max(...zs).toFixed(1)} mm, ${fmtUm(Math.min(...vs))} to ${fmtUm(Math.max(...vs))}` : 'no readings yet'}</span></div>
      <div class="img-actions"><button type="button" class="btn btn-secondary btn-sm" data-close>Cancel</button><button type="submit" class="btn btn-primary btn-sm" id="acrMeasGo">Use these readings</button></div>`;
  }, (dlg, draw) => {
    const ta = dlg.querySelector('#acrMeasText'), n = dlg.querySelector('#acrMeasN');
    const count = () => { const pts = read(); n.textContent = pts.length ? `${pts.length} readings, ${Math.min(...pts.map(p => p[0])).toFixed(1)} to ${Math.max(...pts.map(p => p[0])).toFixed(1)} mm` : 'no readings yet'; };
    ta.oninput = () => { st.text = ta.value; st.name = 'pasted'; count(); };
    dlg.querySelector('#acrMeasVals').onchange = e => { st.vals = e.target.value; draw(); };
    const fi = dlg.querySelector('#acrMeasFile');
    dlg.querySelector('#acrMeasLoad').onclick = () => fi.click();
    fi.onchange = async () => { const f = fi.files && fi.files[0]; fi.value = ''; if (!f) return; st.text = await f.text(); st.name = f.name; draw(); };
    dlg.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const pts = read().sort((a, b) => a[0] - b[0]);
      if (pts.length < 2) { imgToast('At least 2 readings are needed.', 'error'); return; }
      acrossSet('meas', { on: true, name: st.name, pts }, `Measured gap: ${st.name} (${pts.length} points)`);
      dlg.close();
    };
  });
}

// ---- the parts in words (the report, the model tree) ----
/** Each part on, in words: [[name, value], ...]. */
function acrossRows() {
  const f = (v, d = 1) => +(+v).toFixed(d), sp = acrossSpanNow(), rows = [];
  if (ACR.bow.on) {
    if (ACR.bow.mode === 'typed') rows.push(['Bow', `typed: ${f(ACR.bow.um)} µm at the middle, ${ACR.bow.shape === 'arc' ? 'circular arc' : ACR.bow.shape}`]);
    else { const B = acrossBowComputed(), b = ACR.bow; rows.push(['Bow', B.error ? `computed: not possible (${B.error})` : `computed: ${fmtUm(B.at((sp[0] + sp[1]) / 2))} at the middle; the blade ${b.supports === 'clamped' ? 'clamped' : 'simply supported'} at its ends, section ${f(b.h)} × ${f(b.t, 2)} mm${b.I ? ` (I ${fmtSig(b.I)} mm⁴)` : ''}, E ${f(b.E, 0)} GPa, ${f(b.rhoB, 0)} kg/m³; slurry load ${f(B.loads.reduce((a, v) => a + v, 0) / B.loads.length, 2)} N/m up, weight ${f(B.weight, 2)} N/m`]); }
  }
  rows.push(['Tilt', `${P.tilt} µm edge to edge`]);
  rows.push(['Waviness', `${P.dH} µm, ${P.lw} mm, first crest at ${ACR.crest == null ? `${f(P.lw / 4)} mm (a quarter wavelength)` : `${f(ACR.crest)} mm`}`]);
  ACR.sines.forEach((s, j) => rows.push([`Sine ${j + 2}`, `${f(s.a)} µm, ${f(s.lw)} mm${s.crest != null ? `, first crest at ${f(s.crest)} mm` : ''}`]));
  if (ACR.ends.on) rows.push(['Chamfered ends', `left ${f(ACR.ends.left.c)} mm × ${f(ACR.ends.left.d)} µm, right ${f(ACR.ends.right.c)} mm × ${f(ACR.ends.right.d)} µm`]);
  if (ACR.meas.on && ACR.meas.pts.length) rows.push(['Measured gap', `${ACR.meas.name || 'imported'}: ${ACR.meas.pts.length} readings`]);
  if (ACR.crown.on) rows.push(['Crown', ACR.crown.kind === 'free' ? `free curve${ACR.crown.name ? ` (${ACR.crown.name})` : ''}, ${ACR.crown.pts.length} points` : `parabola, ${f(ACR.crown.um)} µm at the middle`]);
  rows.push(['Skew', `${P.skew}°`]);
  rows.push(['Blade\'s ends past the web\'s edges', `left ${f(ACR.bladeEnds.left)} mm, right ${f(ACR.bladeEnds.right)} mm`]);
  return rows;
}
/** An SVG on the page as an image (its styles written into it), for the report. */
function svgImage(svg) {
  const c = svg.cloneNode(true), src = [svg, ...svg.querySelectorAll('*')], dst = [c, ...c.querySelectorAll('*')];
  const keys = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-family', 'font-size', 'font-weight'];
  src.forEach((el, i) => { const cs = getComputedStyle(el); dst[i].setAttribute('style', keys.map(k => `${k}:${cs.getPropertyValue(k)}`).join(';')); });
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(c))));
}
/** The report's part for the Across the web page: the parts and the front view. */
function acrossReportHTML() {
  const svg = document.querySelector('#acrFront svg');
  return '<h3>The blade across the web</h3>' + repRows(acrossRows().map(([a, b]) => [repEsc(a), repEsc(b)]), ['Part', 'Setting'])
    + (svg ? `<figure><img src="${svgImage(svg)}" alt="The gap across the web, seen from the front" style="max-width:${svg.getAttribute('width')}px;background:#fff"><figcaption>The gap's change across the web, seen from the front: each part (dashed) and their sum, the blade's edge (solid).</figcaption></figure>` : '');
}
