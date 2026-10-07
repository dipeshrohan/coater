'use strict';
/*
 * mesh-view-ui.js — the mesh viewer on each 3D model's Mesh step (MESH-T1b): the mesh its solver takes, cell by cell,
 * before it solves -- its boundary, or the cells on one side of a plane (whole cells, so their shapes show on the cut),
 * each cell shrunk toward its centre or not, coloured by its type or a quality measure (OpenFOAM checkMesh's), with the
 * measure's histogram and the mesh's checkMesh numbers. On um-view.js (what to draw) and um-core.js (the cells, their
 * measures).
 *   mvPrep(key, build): the mesh made ready (kept by key); build() gives { mesh (um-fe.js's common form), split, info } or { U }.
 *   mvViewHTML(id, P, o): the viewer's parts (tools, the 3D view's box, its colour bar, the numbers) for a page.
 *   mvMount(id, P, o): drawn in its own 3D view (three.js), wired; o.draw instead: a page's own view draws the cells
 *     (Coating › 3D, with the blade): draw(group) puts the cells' three.js group in it.
 * Display only: the viewer's settings change nothing a solve uses, and are not saved with the project.
 */
const MV = { st: {}, prep: new Map(), gl: {} };
const MV_DEF = { mode: 'all', axis: 2, at: 0.5, keep: -1, shrink: 1, colour: 'nonOrtho', view: 'iso', vscale: null };
/** A viewer's settings (kept while the page lives); def: its own defaults (a page's first measure, say). */
const mvSt = (id, def = {}) => MV.st[id] || (MV.st[id] = { ...MV_DEF, ...def });
const MV_AX = ['x', 'y', 'z'];
const mvEsc = t => String(t ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
/** A number as read in a table: 3 significant figures, an exponent when very large or small. */
const mvFmt = (v, d = 3) => (!Number.isFinite(v) ? '—' : v !== 0 && (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) ? v.toExponential(2) : (+v.toPrecision(d)).toLocaleString('en'));
const mvInt = n => Number(n).toLocaleString('en');

/** The mesh made ready to draw (its geometry, each cell's measures), kept by key: build() runs only for a new key. */
function mvPrep(key, build) {
  if (MV.prep.has(key)) return MV.prep.get(key);
  const src = build();
  if (!src) return null;
  const U = src.U || umFromFE(src.mesh, { split: !!src.split });
  const P = { key, V: umvPrepare(U), split: !!src.split, elems: src.mesh ? (src.mesh.nE ?? src.mesh.E ?? null) : null, info: src.info || null };
  MV.prep.set(key, P);
  while (MV.prep.size > 6) MV.prep.delete(MV.prep.keys().next().value);
  return P;
}
/** The measures this mesh's cells have (the radius ratio with tetrahedra, the face count with polyhedra). */
const mvMeasures = V => UMV_MEASURES.filter(m => (m.k === 'rho' ? !!V.Q.tet : m.k === 'faces' ? !!V.Q.poly : true));
/** The settings made valid for this mesh (a measure it has). */
function mvFix(id, P, def) {
  const st = mvSt(id, def ? { colour: def } : {});
  if (!mvMeasures(P.V).some(m => m.k === st.colour)) st.colour = 'nonOrtho';
  return st;
}
/** The cut as um-view takes it (the plane at its fraction of the mesh's box along its axis), or none. */
function mvCut(V, st) {
  if (st.mode !== 'cut') return null;
  const a = st.axis;
  return { axis: a, at: V.lo[a] + st.at * (V.hi[a] - V.lo[a]), keep: st.keep };
}
/** The colours: the page's colour map (its rainbow when chosen, else its sequential one). */
const mvLut = () => (typeof getLut === 'function' ? getLut(typeof FV !== 'undefined' && FV.cmap === 'jet' ? 'jet' : 'seq') : null);
const mvRgb = (lut, t) => { const [r, g, b] = umvRamp(lut, t); return `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`; };
/** What to draw with these settings (um-view's arrays, mm). */
const mvArrays = (P, st) => umvArrays(P.V, { cut: mvCut(P.V, st), shrink: st.shrink, colour: st.colour, lut: mvLut() });

// ---- the parts on the page ----
const mvSeg = (attr, items, cur, label, off = false) => `<div class="seg" role="tablist" aria-label="${label}">${items.map(([k, t]) => `<button type="button" role="tab" data-${attr}="${k}" aria-selected="${String(k) === String(cur)}"${off ? ' disabled' : ''}>${t}</button>`).join('')}</div>`;
/** The plane's place, as read beside its slider. */
function mvAtText(V, st) { const a = st.axis, v = V.lo[a] + st.at * (V.hi[a] - V.lo[a]); return `${MV_AX[a]} = ${mvFmt(v * 1000, 4)} mm`; }
/** The tools: what is shown (the boundary or a cut), the plane, the side kept, the shrink, the colour; with its own view, its sides and height scale. */
function mvToolsHTML(id, P, o = {}) {
  const st = mvFix(id, P, o.colour), cut = st.mode === 'cut', V = P.V;
  const views = o.own ? `<span class="mv-ctl"><span class="tb-lbl">View</span>${mvSeg('mvview', [['iso', '3D'], ['side', 'Side'], ['top', 'Top'], ['front', 'Front']], st.view, 'View')}</span>` : '';
  const vs = o.own && o.height ? `<label class="mv-ctl"><select data-mvvs aria-label="Height scale" title="Heights drawn this many times larger">${[...new Set([1, 2, 5, 10, 20, 50, o.height])].sort((a, b) => a - b).map(v => `<option value="${v}"${v === (st.vscale || o.height) ? ' selected' : ''}>Height ×${v}</option>`).join('')}</select></label>` : '';
  return `<div class="mv-tools" data-mvtools="${id}">
    ${views}<span class="mv-ctl"><span class="tb-lbl">Show</span>${mvSeg('mvmode', [['all', 'Boundary'], ['cut', 'Cut']], st.mode, 'Show')}</span>
    <span class="mv-ctl${cut ? '' : ' mv-off'}"><span class="tb-lbl">Plane</span>${mvSeg('mvaxis', [[0, 'X'], [1, 'Y'], [2, 'Z']], st.axis, 'Cut plane', !cut)}</span>
    <span class="mv-ctl${cut ? '' : ' mv-off'}"><span class="tb-lbl">at</span><input type="range" data-mvat min="0" max="1000" step="1" value="${Math.round(st.at * 1000)}" aria-label="Where the plane cuts"${cut ? '' : ' disabled'}><output data-mvatout>${mvAtText(V, st)}</output></span>
    <span class="mv-ctl${cut ? '' : ' mv-off'}"><span class="tb-lbl">Keep</span>${mvSeg('mvkeep', [[-1, 'Below'], [1, 'Above']], st.keep, 'The side kept', !cut)}</span>
    <span class="mv-ctl"><span class="tb-lbl">Shrink</span><input type="range" data-mvshrink min="40" max="100" step="1" value="${Math.round(st.shrink * 100)}" aria-label="Each cell drawn at this share of its size"><output data-mvshout>${Math.round(st.shrink * 100)} %</output></span>
    <label class="mv-ctl"><span class="tb-lbl">Colour by</span><select data-mvcolour aria-label="Colour the cells by">${mvMeasures(V).map(m => `<option value="${m.k}"${m.k === st.colour ? ' selected' : ''}>${m.l}</option>`).join('')}</select></label>${vs}
  </div>`;
}
/** Over the 3D view: the colour bar (or the cell types' key), the cells drawn. */
function mvOverHTML(P, st, A) {
  const m = UMV_MEASURES.find(q => q.k === st.colour), lut = mvLut(), Q = P.V.Q;
  const key = m.cat ? `<div class="mv-key">${Object.keys(Q.types).map(t => `<span><i style="background:${(UMV_TYPES[t] || ['#9a9a9a'])[0]}"></i>${(UMV_TYPES[t] || ['', 'Other cells'])[1]}</span>`).join('')}</div>`
    : !(A.range[1] - A.range[0] > 1e-9 * Math.max(1, Math.abs(A.range[1]))) ? `<div class="mv-key"><b>${m.l}${m.u ? ` (${m.u})` : ''}</b><span>every cell drawn: ${mvFmt(A.range[0])}</span></div>`
    : `<div class="mv-key"><b>${m.l}${m.u ? ` (${m.u})` : ''}${A.log ? ', log scale' : ''}</b><i class="mv-bar" style="background:linear-gradient(90deg,${Array.from({ length: 11 }, (_, i) => `${mvRgb(lut, i / 10)} ${i * 10}%`).join(',')})"></i><span class="mv-ends"><span>${mvFmt(A.range[0])}</span><span>${mvFmt(A.range[1])}</span></span></div>`;
  return `${key}<div class="mv-count">${mvInt(A.cells)} cells drawn${st.mode === 'cut' ? ` · ${mvInt(A.kept)} of ${mvInt(Q.cells)} kept by the cut` : ''}</div>`;
}
/** A measure's state against OpenFOAM's limit: the word and its token. */
const mvState = (ok, bad = 'High') => (ok ? ['OK', '--ok'] : [bad, '--warn']);
/** The numbers: checkMesh's measures of the whole mesh; the shown measure's histogram (over the cells kept by the cut). */
function mvPanelHTML(P, st) {
  const V = P.V, Q = V.Q, m = UMV_MEASURES.find(q => q.k === st.colour), cut = mvCut(V, st), sel = cut ? umvSelect(V, cut) : null;
  const row = (k, v, s, tip = '') => `<tr${tip ? ` title="${mvEsc(tip)}"` : ''}><th scope="row">${k}</th><td>${v}</td><td>${s ? `<span class="mv-st" style="--c:var(${s[1]})"><i></i>${s[0]}</span>` : ''}</td></tr>`;
  const types = Object.entries(Q.types).map(([t, n]) => `${mvInt(n)} ${(UMV_TYPES[t] || ['', 'other cells'])[1].toLowerCase()}`).join(', ');
  const table = `<table class="mv-q"><tbody>
    ${row('Cells', mvInt(Q.cells), null, types)}${row('Faces', mvInt(Q.faces))}${row('Points', mvInt(Q.points))}
    ${row('Non-orthogonality, worst', `${mvFmt(Q.nonOrthoMax)}°`, mvState(Q.nonOrthoMax <= 70), 'OpenFOAM: above 70° is severe')}${row('Non-orthogonality, average', `${mvFmt(Q.nonOrthoAvg)}°`)}
    ${row('Skewness, worst', mvFmt(Q.skewnessMax), mvState(Q.skewnessMax <= 4), 'OpenFOAM: above 4 is high')}${row('Aspect ratio, worst', mvFmt(Q.aspectMax), mvState(Q.aspectMax <= 1000), 'OpenFOAM: above 1000 is high')}
    ${Q.tet ? row('Radius ratio, worst', mvFmt(Q.tet.rhoMin), mvState(Q.tet.rhoMin >= 0.1, 'Low'), '3 × the inscribed sphere\'s radius over the circumscribed one\'s: 1 for the regular tetrahedron') : ''}
    ${Q.poly ? row('Faces per polyhedron', `${Q.poly.facesMin} to ${Q.poly.facesMax}`) : ''}
    ${row('Cell volume', `${mvFmt(Q.volumeMin * 1e9)} to ${mvFmt(Q.volumeMax * 1e9)} mm³`)}${row('Inverted cells', mvInt(Q.negativeVolumes), mvState(Q.negativeVolumes === 0, 'Inverted'))}
  </tbody></table>`;
  return `<section class="mv-sec"><h4>${typeof uiBadge === 'function' ? uiBadge('table') : ''}The cells, by checkMesh's measures</h4>${table}</section>
    <section class="mv-sec"><h4>${typeof uiBadge === 'function' ? uiBadge('bars') : ''}${m.l}${cut ? ', the cells kept' : ''}</h4>${mvHistHTML(V, m, sel)}</section>`;
}
/** The measure's histogram (SVG, to scale): each bar its cells, the warning line where the measure has one; the types' counts for the cell type. */
function mvHistHTML(V, m, sel) {
  const H = umvHistogram(V, m.k, sel, 24), lut = mvLut();
  if (H.cat) return `<table class="mv-q"><tbody>${Object.entries(H.cat).map(([t, n]) => `<tr><th scope="row"><i class="mv-sw" style="background:${(UMV_TYPES[t] || ['#9a9a9a'])[0]}"></i>${(UMV_TYPES[t] || ['', 'Other cells'])[1]}</th><td>${mvInt(n)}</td><td></td></tr>`).join('')}</tbody></table>`;
  if (!H.n) return '<p class="mv-note">No cell has this measure.</p>';
  if (!(H.hi - H.lo > 1e-9 * Math.max(1, Math.abs(H.hi)))) return `<p class="mv-note">Every cell${sel ? ' kept' : ''}: <b>${mvFmt(H.lo)}${m.u ? ' ' + m.u : ''}</b> (${mvInt(H.n)} cells). ${mvEsc(m.note.charAt(0).toUpperCase() + m.note.slice(1))}.</p>`;
  const W = 360, Hh = 110, padB = 30, bw = W / H.counts.length, mx = Math.max(...H.counts);
  const xOf = v => (H.log ? (Math.log(v) - Math.log(H.lo)) / ((Math.log(H.hi) - Math.log(H.lo)) || 1) : (v - H.lo) / ((H.hi - H.lo) || 1)) * W;
  const edge = i => (H.log ? Math.exp(Math.log(H.lo) + (Math.log(H.hi) - Math.log(H.lo)) * i / H.counts.length) : H.lo + (H.hi - H.lo) * i / H.counts.length);
  const bars = Array.from(H.counts).map((c, i) => {
    const h = c ? Math.max(1.5, Hh * Math.sqrt(c / mx)) : 0;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(Hh - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${mvRgb(lut, (i + 0.5) / H.counts.length)}"><title>${mvFmt(edge(i))} to ${mvFmt(edge(i + 1))}${m.u ? ' ' + m.u : ''}: ${mvInt(c)} cell${c === 1 ? '' : 's'}</title></rect>`;
  }).join('');
  const wx = m.warn != null && m.warn > H.lo && m.warn < H.hi ? xOf(m.warn) : null;
  const warn = wx != null ? `<line x1="${wx.toFixed(1)}" x2="${wx.toFixed(1)}" y1="0" y2="${Hh}" stroke="var(--bad)" stroke-dasharray="3 3"/><text x="${(wx + 4).toFixed(1)}" y="10" font-size="10.5" fill="var(--bad)">limit ${m.warn}${m.u || ''}</text>` : '';
  const u = m.u ? ' ' + m.u : '';
  return `<svg class="mv-hist" viewBox="-4 -4 ${W + 8} ${Hh + padB + 4}" role="img" aria-label="${mvEsc(m.l)}: the cells' histogram">${bars}${warn}
      <line x1="0" x2="${W}" y1="${Hh}" y2="${Hh}" stroke="var(--line)"/>
      <text x="0" y="${Hh + 14}" font-size="11" fill="var(--muted)">${mvFmt(H.lo)}${u}</text><text x="${W}" y="${Hh + 14}" font-size="11" fill="var(--muted)" text-anchor="end">${mvFmt(H.hi)}${u}</text>
      <text x="${W / 2}" y="${Hh + 26}" font-size="11" fill="var(--muted)" text-anchor="middle">${mvEsc(m.l.toLowerCase())}${H.log ? ' (log scale)' : ''}; bar height: √ of the cells</text></svg>
    <p class="mv-note">${m.worse ? `Worst: <b>${mvFmt(H.worstValue)}${u}</b> (cell ${mvInt(H.worst + 1)} of ${mvInt(V.U.nC)}). ` : ''}${mvEsc(m.note.charAt(0).toUpperCase() + m.note.slice(1))}.</p>`;
}
/** The viewer on a page: its tools, the 3D view's box (o.hostId: a page's own box instead), its numbers. */
function mvViewHTML(id, P, o = {}) {
  return `<div class="mv" data-mv="${id}">${mvToolsHTML(id, P, o)}
    <div class="mv-view">${o.host || `<div class="mv-host" id="mvHost_${id}"><p class="v3d-msg">Loading the 3D view…</p></div>`}<div class="mv-over" id="mvOver_${id}"></div></div>
    <div class="mv-panel" id="mvPanel_${id}"></div></div>`;
}

// ---- drawing and wiring ----
/** The cells as three.js objects (in mm). */
const mvGroup = A => umvGroup(THREE, A, { edgeColor: cssVar('--ink'), edgeOpacity: A.cells > 20000 ? 0.18 : 0.3 });
/** Draw what the settings show: the 3D view's cells, the colour bar, the numbers. full: the numbers too (not while a slider moves). */
function mvRefresh(id, full = true) {
  const g = MV.gl[id];
  if (!g || !g.P) return;
  const st = mvFix(id, g.P), A = mvArrays(g.P, st), over = document.getElementById('mvOver_' + id), panel = document.getElementById('mvPanel_' + id);
  g.draw(mvGroup(A));
  if (over) over.innerHTML = mvOverHTML(g.P, st, A);
  if (panel && full) { panel.innerHTML = mvPanelHTML(g.P, st); if (typeof applyHelp === 'function') applyHelp(); }
}
/** The tools' events: each setting changed draws again (the sliders as they move, at most once a frame). */
function mvWire(id) {
  const root = document.querySelector(`[data-mv="${id}"]`);
  if (!root) return;
  const st = mvSt(id), g = MV.gl[id], tools = root.querySelector('.mv-tools');
  const sync = () => { const html = mvToolsHTML(id, g.P, g.o); const t = document.createElement('div'); t.innerHTML = html; tools.replaceWith(t.firstElementChild); mvWire(id); if (typeof applyHelp === 'function') applyHelp(); };
  let raf = 0;
  const later = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; mvRefresh(id); }); };
  tools.onclick = e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.mvmode) st.mode = b.dataset.mvmode;
    else if (b.dataset.mvaxis != null) { st.axis = +b.dataset.mvaxis; }
    else if (b.dataset.mvkeep) st.keep = +b.dataset.mvkeep;
    else if (b.dataset.mvview) { st.view = b.dataset.mvview; sync(); if (g.camera) g.camera(); return; }
    else return;
    sync(); mvRefresh(id);
  };
  tools.oninput = e => {
    const t = e.target;
    if (t.dataset.mvat != null) { st.at = +t.value / 1000; const out = tools.querySelector('[data-mvatout]'); if (out) out.textContent = mvAtText(g.P.V, st); later(); }
    else if (t.dataset.mvshrink != null) { st.shrink = +t.value / 100; const out = tools.querySelector('[data-mvshout]'); if (out) out.textContent = `${t.value} %`; later(); }
  };
  tools.onchange = e => {
    const t = e.target;
    if (t.dataset.mvcolour != null) { st.colour = t.value; mvRefresh(id); }
    else if (t.dataset.mvvs != null) { st.vscale = +t.value; if (g.scale) g.scale(); }
  };
}
/**
 * The viewer drawn and wired. o: { draw (a page's own 3D view draws the cells: draw(group)), up (the mesh's axis that is
 * up: 1 y, the default; 2 z), height (the default height scale, with its choice in the tools), label (the 3D view's) }.
 * Without o.draw, its own 3D view (three.js, loaded first) in #mvHost_<id>, turned with the mouse.
 */
function mvMount(id, P, o = {}) {
  const prev = MV.gl[id], g = MV.gl[id] = { ...(prev || {}), P, o };
  if (o.draw) { g.draw = o.draw; g.camera = g.scale = null; mvWire(id); mvRefresh(id); return; }
  const host = document.getElementById('mvHost_' + id);
  if (!host) return;
  const go = () => {
    if (!document.body.contains(host)) return;
    // (one renderer for every viewer drawn in its own view -- a page shows one at a time -- each viewer its own scene and
    //  camera; the mouse turns the one shown)
    const R = MV.R || (MV.R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }));
    if (!g.scene) {
      g.scene = new THREE.Scene();
      g.cam = new THREE.PerspectiveCamera(30, 1, 0.01, 1e6);
      g.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
      const d1 = new THREE.DirectionalLight(0xffffff, 0.6); d1.position.set(0.5, 1, 0.8); g.scene.add(d1);
      const d2 = new THREE.DirectionalLight(0xffffff, 0.3); d2.position.set(-0.7, 0.3, -0.5); g.scene.add(d2);
      g.holder = new THREE.Group(); g.scene.add(g.holder);
    }
    MV.on = id;
    g.renderer = R;
    const paint = () => { if (MV.on === id) R.render(g.scene, g.cam); };
    if (MV.ctl && MV.ctlFor !== id) { MV.ctl.dispose(); MV.ctl = null; }
    if (!MV.ctl) {
      MV.ctl = new THREE.OrbitControls(g.cam, R.domElement); MV.ctlFor = id;
      if (g.target) MV.ctl.target.copy(g.target);
      MV.ctl.addEventListener('change', () => { const q = MV.gl[MV.ctlFor]; if (q && q.scene && MV.on === MV.ctlFor) { q.target = MV.ctl.target.clone(); R.render(q.scene, q.cam); } });
      MV.ctl.update();
    }
    g.controls = MV.ctl;
    host.innerHTML = ''; host.appendChild(R.domElement);
    R.domElement.setAttribute('role', 'img');
    R.domElement.setAttribute('aria-label', o.label || 'The mesh in 3D, cell by cell');
    R.setPixelRatio(window.EXPORT_DPR || window.devicePixelRatio || 1);
    R.setClearColor(new THREE.Color(cssVar('--surface')), 1);
    const size = () => { const w = host.clientWidth || 800, h = host.clientHeight || 420; R.setSize(w, h); g.cam.aspect = w / h; g.cam.updateProjectionMatrix(); };
    size();
    if (MV.ro) MV.ro.disconnect();
    if (window.ResizeObserver) { MV.ro = new ResizeObserver(() => { if (MV.on === id && host.clientWidth > 0 && host.clientHeight > 0) { size(); paint(); } }); MV.ro.observe(host); }
    // (the mesh's up axis drawn up, its heights scaled as chosen)
    const turn = () => {
      const vs = mvSt(id).vscale || o.height || 1, up = o.up || 1;
      g.holder.scale.set(1, up === 1 ? vs : 1, up === 2 ? vs : 1);
      g.holder.rotation.set(up === 2 ? -Math.PI / 2 : 0, 0, 0);
      g.holder.updateMatrixWorld(true);
    };
    g.scale = () => { turn(); g.camera(); };
    g.draw = grp => {
      if (g.grp) { g.holder.remove(g.grp); g.grp.traverse(q => { if (q.geometry) q.geometry.dispose(); if (q.material) q.material.dispose(); }); }
      g.grp = grp; g.holder.add(grp); paint();
    };
    // (the camera from the side chosen, the mesh's box filling the view)
    g.camera = () => {
      const b = new THREE.Box3().setFromObject(g.holder);
      if (b.isEmpty()) return;
      const c = b.getCenter(new THREE.Vector3()), dir = { iso: [0.9, 0.75, 1.3], side: [0, 0.02, 1], top: [0.001, 1, 0.001], front: [-1, 0.25, 0.001] }[mvSt(id).view] || [1, 1, 1];
      const v = new THREE.Vector3(...dir).normalize(), up = new THREE.Vector3(...(mvSt(id).view === 'top' ? [1, 0, 0] : [0, 1, 0]));
      const right = new THREE.Vector3().crossVectors(up, v).normalize(), upv = new THREE.Vector3().crossVectors(v, right);
      const tV = Math.tan(g.cam.fov * Math.PI / 360), tH = tV * g.cam.aspect;
      let dist = 0;
      for (let n = 0; n < 8; n++) {
        const d = new THREE.Vector3(n & 1 ? b.max.x : b.min.x, n & 2 ? b.max.y : b.min.y, n & 4 ? b.max.z : b.min.z).sub(c);
        dist = Math.max(dist, d.dot(v) + Math.abs(d.dot(right)) / tH, d.dot(v) + Math.abs(d.dot(upv)) / tV);
      }
      dist *= 1.08;
      g.cam.position.copy(c.clone().add(v.multiplyScalar(dist))); g.cam.up.copy(up);
      g.cam.near = dist / 200; g.cam.far = dist * 20; g.cam.updateProjectionMatrix();
      g.controls.target.copy(c); g.target = c.clone(); g.controls.update();
      paint();
    };
    mvWire(id);
    turn();
    mvRefresh(id);
    // (a new mesh: the view fitted to it; the same mesh drawn again keeps the view turned as it was)
    if (g.fitted !== P.key) { g.fitted = P.key; g.camera(); } else paint();
  };
  if (typeof THREE !== 'undefined' && THREE.OrbitControls) go();
  else if (typeof load3DLibs === 'function') load3DLibs().then(go).catch(e => { host.innerHTML = `<p class="v3d-msg">The 3D view could not start: ${mvEsc(e.message)}</p>`; });
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MV, mvSt, mvPrep, mvMeasures, mvFix, mvCut, mvArrays, mvToolsHTML, mvOverHTML, mvPanelHTML, mvHistHTML, mvViewHTML, mvAtText };
