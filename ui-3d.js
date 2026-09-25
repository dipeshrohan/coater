/*
 * ui-3d.js — Flow › 3D: the 3D stage's geometry and mesh (the solve is phase C). The blade is made
 * from the 2D setup (its side profile extended across the web, the gap varying there as the inputs
 * say), or read from an STL or STEP file of the blade (STEP through occt-import-js, loaded on first
 * use); either is placed over the web with its lowest point at the gap, the height of its underside
 * found by casting rays (cfd-3d-geom.js), and the slurry region meshed over a strip around one
 * location or the full web width. The view is three.js (lib/, loaded when the page first opens).
 *
 * Loaded before undo.js (its settings are undo steps) and project.js (they are saved in the project).
 */
const C3D_DEFAULTS = { source: 'made', region: 'strip', loc: 0, stripW: 20, units: 'mm', machine: '+x', up: '+z', inlet: 40,
  nxGap: 30, nxFilm: 10, ny: 6, nzStrip: 10, nzFull: 60, vscale: 5, view: 'iso', blade: true, slurry: true, web: true, mesh: true };
const C3D = JSON.parse(JSON.stringify(C3D_DEFAULTS));
/** An imported blade: { name, kind: 'stl' | 'step', tris: Float32Array (the file's units; STEP: mm), id }. */
let C3D_FILE = null;
let C3D_GEO = null;   // the built geometry, keyed by what it depends on
const C3D_OPEN = { geo: true, region: true, mesh: false };   // the setup's groups open in the inputs bar
let C3D_OCCT = null;  // the STEP reader (occt-import-js), started on first use
/** Undo labels of the settings: [label, format]. */
const C3D_UNDO = {
  source: ['3D geometry', v => v === 'made' ? 'made from the 2D setup' : 'from a file'], region: ['3D region', v => v === 'strip' ? 'strip at a location' : 'full web width'],
  loc: ['3D strip location', v => `L${v + 1}`], stripW: ['3D strip width', v => v + ' mm'], units: ['File units', v => v], machine: ['File machine direction', v => v], up: ['File up axis', v => v],
  inlet: ['Inlet upstream of the edge', v => v + ' mm'], nxGap: ['3D mesh along the gap', v => v], nxFilm: ['3D mesh along the film', v => v], ny: ['3D mesh across the gap', v => v],
  nzStrip: ['3D mesh across the strip', v => v], nzFull: ['3D mesh across the web', v => v], vscale: ['3D vertical scale', v => '×' + v],
  blade: ['3D view: blade', v => v ? 'on' : 'off'], slurry: ['3D view: slurry', v => v ? 'on' : 'off'], web: ['3D view: web', v => v ? 'on' : 'off'], mesh: ['3D view: mesh', v => v ? 'on' : 'off'],
};
/** The view settings (not part of "unsaved changes"). */
const C3D_DISPLAY = ['view', 'vscale', 'blade', 'slurry', 'web', 'mesh'];
const c3dSetupKey = () => JSON.stringify([Object.keys(C3D_DEFAULTS).filter(k => !C3D_DISPLAY.includes(k)).map(k => C3D[k]), C3D_FILE && C3D_FILE.id]);
const C3D_MESH_LIMITS = { nxGap: [6, 120], nxFilm: [2, 60], ny: [2, 24], nzStrip: [2, 80], nzFull: [6, 300], stripW: [2, 300], inlet: [1, 500] };

// ---- the files: every file imported this session, by id (undo brings one back); the project keeps the one in use ----
const C3D_FILES = new Map();
const c3dFileOut = () => C3D_FILE ? { name: C3D_FILE.name, kind: C3D_FILE.kind, id: C3D_FILE.id, tris: C3D_FILE.tris } : null;
function c3dFileIn(f) {
  C3D_FILE = f && f.tris instanceof Float32Array && f.tris.length ? { name: f.name, kind: f.kind, id: f.id || String(Date.now()), tris: f.tris } : null;
  if (C3D_FILE) C3D_FILES.set(C3D_FILE.id, C3D_FILE);
  C3D_GEO = null;
}

// ---- geometry ----
/** The region across the web (m): a strip around the chosen location, or the full width. */
function c3dRegion() {
  if (C3D.region === 'full') return { z0: 0, z1: ACROSS_W / 1000, zc: ACROSS_W / 2000, nz: C3D.nzFull };
  const zc = CFD_LOCS[C3D.loc].z / 1000, w = C3D.stripW / 1000;
  return { z0: zc - w / 2, z1: zc + w / 2, zc, nz: C3D.nzStrip };
}
/** The gap at the metering edge at z (m) across the web: the strip's location's own gap there, varied as the shared inputs vary it. */
function c3dGapAt(z) {
  const zmm = z * 1000;
  if (C3D.region === 'strip') { const i = C3D.loc; return (cfdLocalGapMm(zmm) + (locInput(i, 'gap') - cfdLocalGapMm(CFD_LOCS[i].z))) / 1000; }
  return cfdLocalGapMm(zmm) / 1000;
}
/** The film beyond the edge (m) at distance d (m) from it: the 1D's film at the strip's location when solved, else its settled height. */
function c3dFilm(d) {
  const L = ONE_D.res && ONE_D.res.locs[C3D.region === 'strip' ? C3D.loc : 0], F = L && L.filmToOven;
  if (F && F.x) { const xs = F.x; let k = 1; while (k < xs.length - 1 && xs[k] < d) k++; const t = Math.min(1, Math.max(0, (d - xs[k - 1]) / (xs[k] - xs[k - 1]))); return F.h[k - 1] + t * (F.h[k] - F.h[k - 1]); }
  return L ? L.film : contactLine(gapHeight(), P.th).h / 1000;
}
/** Build (or reuse) the 3D geometry: the blade's triangles, its underside over the gap, the mesh, and the checks. */
function c3dBuild() {
  const rg = c3dRegion(), g = cfdGeometry(C3D.region === 'strip' ? C3D.loc : 0), H = c3dGapAt(rg.zc);
  const key = JSON.stringify([C3D.source, C3D.region, C3D.loc, C3D.stripW, C3D.units, C3D.machine, C3D.up, C3D.inlet, C3D.nxGap, C3D.nxFilm, C3D.ny, rg, H,
    g.shape, g.R, g.Xup, g.L, g.exitAngle, P.face, P.dH, P.lw, P.dt, C3D_FILE && C3D_FILE.id, ONE_D.key]);
  if (C3D_GEO && C3D_GEO.key === key) return C3D_GEO;
  const out = { key, H, rg };
  try {
    let tris, xe;
    if (C3D.source === 'made') {
      const pr = bladeProfile({ shape: g.shape, H, R: g.R, Xup: g.Xup, L: g.L, faceDeg: g.exitAngle, faceLen: P.face / 1000, top: 0.02 });
      const pad = (rg.z1 - rg.z0) * 0.02 + 1e-4;
      tris = extrudeProfile(pr.pts, rg.z0 - pad, rg.z1 + pad, Math.max(4, rg.nz), z => c3dGapAt(z) - H);
      xe = pr.xe; out.label = `made from the 2D setup (${g.shape === 'round' ? `round entry R ${CFDG.R} mm` : `flat land ${P.L} mm`}, exit face ${g.exitAngle}°)`;
    } else if (C3D_FILE) {
      const scale = C3D_FILE.kind === 'step' ? 1e-3 : { mm: 1e-3, cm: 1e-2, m: 1, in: 0.0254 }[C3D.units];
      xe = C3D.inlet / 1000;
      tris = placeBlade(orientTris(C3D_FILE.tris, { scale, machine: C3D.machine, up: C3D.up }), { H, xUp: xe, zc: rg.zc }).tris;
      out.label = `${C3D_FILE.name} (${(C3D_FILE.tris.length / 9).toLocaleString()} triangles)`;
    } else { out.empty = true; C3D_GEO = out; return out; }
    const xsGap = gradedStations(0, xe, C3D.nxGap, 1.6);
    const zs = Array.from({ length: rg.nz + 1 }, (_, k) => rg.z0 + (rg.z1 - rg.z0) * k / rg.nz);
    // (the first and last rays a hair inside: at the inlet and the edge themselves they would graze the blade's ends)
    const f = undersideField(tris, xsGap.map((x, i) => i === 0 ? x + 1e-7 : i === xsGap.length - 1 ? x - 1e-7 : x), zs);
    const nz = zs.length;
    let open = 0, multi = 0, gMin = Infinity, gMax = -Infinity;
    for (let v = 0; v < f.low.length; v++) { if (!Number.isFinite(f.low[v])) open++; else if (f.hits[v] > 2) multi++; }
    const iE = xsGap.length - 1;
    for (let k = 0; k < nz; k++) { const v = f.low[iE * nz + k]; if (Number.isFinite(v)) { gMin = Math.min(gMin, v); gMax = Math.max(gMax, v); } }
    // (where a ray misses the blade: the top of the gap from its neighbours along x, so the mesh still closes)
    const rowMax = i => { let m = -Infinity; for (let k = 0; k < nz; k++) { const v = f.low[i * nz + k]; if (Number.isFinite(v)) m = Math.max(m, v); } return Number.isFinite(m) ? m : H; };
    const under = (i, k) => { const v = f.low[i * nz + k]; return Number.isFinite(v) ? v : rowMax(i); };
    const Ld = Math.max(12e-3, 8 * H);
    const xsFilm = gradedStations(xe, xe + Ld, C3D.nxFilm, 1);
    const film = (x, z) => c3dFilm(x - xe) * (C3D.region === 'full' ? c3dGapAt(z) / H : 1);
    const mesh = mesh3D({ xsGap, xsFilm, zs, under, film, ny: C3D.ny });
    let top = 0; for (const v of f.low) if (Number.isFinite(v)) top = Math.max(top, v);
    Object.assign(out, { tris, xe, Ld, f, mesh, open, multi, rays: f.low.length, gMin, gMax, box: trisBox(tris), cutY: Math.max(3 * H, 1.2 * top) });
  } catch (e) { out.error = e.message; }
  C3D_GEO = out;
  return out;
}

// ---- the setup in the inputs bar ----
function c3dSetupTree() {
  const opt = (v, t, cur) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
  const num = (label, k, unit, step = 1) => `<div class="prop"><label class="prop-l" for="c3d_${k}">${label}</label><span class="prop-v"><input type="number" id="c3d_${k}" data-c3d="${k}" min="${(C3D_MESH_LIMITS[k] || [])[0] ?? ''}" max="${(C3D_MESH_LIMITS[k] || [])[1] ?? ''}" step="${step}" value="${C3D[k]}"><span class="prop-u">${unit}</span></span></div>`;
  const sel = (label, k, opts) => `<div class="prop prop-sel"><label class="prop-l" for="c3d_${k}">${label}</label><span class="prop-v"><select id="c3d_${k}" data-c3d="${k}">${opts}</select></span></div>`;
  const seg = (label, k, items) => `<div class="prop prop-seg"><span class="prop-l">${label}</span><div class="seg" role="tablist" aria-label="${label}">${items.map(([v, t]) => `<button type="button" role="tab" data-c3dseg="${k}" data-v="${v}" aria-selected="${C3D[k] === v}">${t}</button>`).join('')}</div></div>`;
  const axes = ['+x', '-x', '+y', '-y', '+z', '-z'].map(a => opt(a, a, null)).join('');
  const f = C3D_FILE;
  oneDSetupTree();   // (the 2D setup the 1D and the blade made here use, read-only, with Edit in 2D)
  document.getElementById('setupExtra').insertAdjacentHTML('beforeend', `
    <div class="tree-sep">3D setup</div>
    <details class="grp cfd-grp" data-c3dgrp="geo"${C3D_OPEN.geo ? ' open' : ''}><summary>3D geometry</summary>
      ${seg('Blade', 'source', [['made', 'From the 2D setup'], ['file', 'From a file']])}
      ${C3D.source === 'made' ? `<p class="prop-note">The 2D's blade profile (entry, exit face, notch face length) extended across the region; its gap varies across the web with the inputs under Variation across the web.</p>
        <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="c3dExport">Save the blade as STL</button></div>` : `
        <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="c3dImport">Import STL or STEP…</button><input type="file" id="c3dFile" accept=".stl,.step,.stp" hidden></div>
        <p class="prop-note">${f ? `<b>${mEsc(f.name)}</b>: ${(f.tris.length / 9).toLocaleString()} triangles, ${f.kind.toUpperCase()}.` : 'No file yet: a blade only (the app adds the web below it at the gap, and the slurry).'}</p>
        ${f && f.kind === 'stl' ? sel('Units in the file', 'units', ['mm', 'cm', 'm', 'in'].map(u => opt(u, u, C3D.units)).join('')) : ''}
        ${sel('Machine direction', 'machine', axes.replace(`value="${C3D.machine}"`, `value="${C3D.machine}" selected`))}
        ${sel('Up', 'up', axes.replace(`value="${C3D.up}"`, `value="${C3D.up}" selected`))}
        ${num('Inlet upstream of the edge', 'inlet', 'mm')}
        <p class="prop-note">The blade's lowest point is put at the gap over the web, at the metering edge; the inlet is this far upstream of it.</p>`}
    </details>
    <details class="grp cfd-grp" data-c3dgrp="region"${C3D_OPEN.region ? ' open' : ''}><summary>3D region</summary>
      ${seg('Across the web', 'region', [['strip', 'Strip'], ['full', 'Full width']])}
      ${C3D.region === 'strip' ? sel('Around', 'loc', CFD_LOCS.map((l, i) => opt(i, `L${i + 1} · z ${l.z} mm`, C3D.loc)).join('')) + num('Strip width', 'stripW', 'mm') : `<p class="prop-note">The full ${ACROSS_W} mm of the web.</p>`}
    </details>
    <details class="grp cfd-grp" data-c3dgrp="mesh"${C3D_OPEN.mesh ? ' open' : ''}><summary>3D mesh</summary>
      ${num('Along the gap', 'nxGap', 'elements')}${num('Along the film', 'nxFilm', 'elements')}${num('Across the gap', 'ny', 'elements')}
      ${C3D.region === 'strip' ? num('Across the strip', 'nzStrip', 'elements') : num('Across the web', 'nzFull', 'elements')}
      <p class="prop-note">Hexahedral: rows graded toward the metering edge; the film beyond it as long as the 2D's (at least 12 mm).</p>
    </details>`);
  document.querySelectorAll('#setupExtra details[data-c3dgrp]').forEach(d => d.addEventListener('toggle', () => { C3D_OPEN[d.dataset.c3dgrp] = d.open; }));
  const ex = document.getElementById('c3dExport');
  if (ex) ex.onclick = () => { const G = c3dBuild(); if (G.tris) saveBlob(new Blob([writeSTL(G.tris.map(v => v * 1000))], { type: 'model/stl' }), 'blade-from-2D-setup-mm.stl'); };
  const imp = document.getElementById('c3dImport'), fi = document.getElementById('c3dFile');
  if (imp) imp.onclick = () => fi.click();
  if (fi) fi.onchange = () => { const file = fi.files && fi.files[0]; if (file) c3dImportFile(file); fi.value = ''; };
}
/** Set a 3D setting (an undo step) and redraw. */
function c3dSet(k, v) {
  undoHint(`${C3D_UNDO[k][0]}: ${C3D_UNDO[k][1](C3D[k])} → ${C3D_UNDO[k][1](v)}`);
  C3D[k] = v; render();
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-c3dseg]');
  if (b) { const k = b.dataset.c3dseg; if (C3D[k] !== b.dataset.v) c3dSet(k, b.dataset.v); return; }
  const t = e.target.closest && e.target.closest('[data-v3tog]');
  if (t) { const k = t.dataset.v3tog; c3dSet(k, !C3D[k]); return; }
  const v = e.target.closest && e.target.closest('[data-v3view]');
  if (v) { C3D.view = v.dataset.v3view; v3Camera(); document.querySelectorAll('[data-v3view]').forEach(x => x.setAttribute('aria-selected', x === v)); }
});
document.addEventListener('change', e => {
  const el = e.target.closest && e.target.closest('[data-c3d]');
  if (!el) return;
  const k = el.dataset.c3d;
  if (el.tagName === 'SELECT') { const v = k === 'loc' || k === 'vscale' ? +el.value : el.value; if (C3D[k] !== v) c3dSet(k, v); return; }
  const [lo, hi] = C3D_MESH_LIMITS[k] || [-Infinity, Infinity], v = Math.round(Math.min(hi, Math.max(lo, +el.value || C3D_DEFAULTS[k])));
  el.value = v;
  if (C3D[k] !== v) c3dSet(k, v);
});

/** Read an STL or STEP file of the blade. */
async function c3dImportFile(file) {
  try {
    const buf = await file.arrayBuffer(), step = /\.(step|stp)$/i.test(file.name);
    let tris;
    if (step) {
      imgToast('Reading the STEP file…');
      if (typeof occtimportjs === 'undefined') await loadScript('lib/occt-import-js.js');
      if (!C3D_OCCT) C3D_OCCT = occtimportjs({ locateFile: n => 'lib/' + n });
      const occt = await C3D_OCCT;
      const r = occt.ReadStepFile(new Uint8Array(buf), { linearUnit: 'millimeter' });
      if (!r || !r.success || !r.meshes.length) throw new Error('the STEP file could not be read');
      const out = [];
      for (const m of r.meshes) { const p = m.attributes.position.array, idx = m.index.array; for (const i of idx) out.push(p[3 * i], p[3 * i + 1], p[3 * i + 2]); }
      tris = new Float32Array(out);
    } else tris = parseSTL(buf);
    if (!tris.length) throw new Error('no triangles in the file');
    undoHint(`Import 3D blade ${file.name}`);
    c3dFileIn({ name: file.name, kind: step ? 'step' : 'stl', tris, id: String(Date.now()) });
    C3D.source = 'file';
    imgToast(`${file.name}: ${(tris.length / 9).toLocaleString()} triangles read.`);
    render();
  } catch (e) { imgToast(`Could not import ${file.name}: ${e.message}`, 'error'); }
}
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });

// ---- the page ----
function view3D() {
  c3dSetupTree();
  oneDRequest(false);
  const tog = (k, t) => `<label class="fv-chk"><input type="checkbox" data-v3tog="${k}"${C3D[k] ? ' checked' : ''}> ${t}</label>`;
  const views = [['iso', '3D'], ['side', 'Side'], ['top', 'Top'], ['front', 'Front']];
  view.innerHTML = moduleFrame({
    tools: `<div class="seg" role="tablist" aria-label="View">${views.map(([v, t]) => `<button type="button" role="tab" data-v3view="${v}" aria-selected="${C3D.view === v}">${t}</button>`).join('')}</div>
      ${tog('blade', 'Blade')}${tog('slurry', 'Slurry')}${tog('web', 'Web')}${tog('mesh', 'Mesh')}
      <label class="fv-chk">Vertical <select data-c3d="vscale">${[1, 2, 5, 10, 20, 50].map(v => `<option value="${v}"${v === C3D.vscale ? ' selected' : ''}>×${v}</option>`).join('')}</select></label>`,
    panes: [],
    extra: `<figure class="pane v3d"><figcaption>The blade over the web and the slurry region${C3D.region === 'strip' ? `, strip at L${C3D.loc + 1}` : ', full web width'}</figcaption>
      <div class="v3d-host" id="v3dHost"><p class="v3d-msg">Loading the 3D view…</p></div>
      <div class="pane-legend"><span>x: machine direction →</span><span>y: up from the web (drawn ×${C3D.vscale})</span><span>z: across the web</span><span>Blade cut off just above the slurry</span><span>Drag to turn, wheel to zoom, right-drag to pan</span></div></figure>
      <div class="oned-table" id="oneDTable"></div>`,
  });
  const G = c3dBuild();
  let st;
  if (G.error) st = pill('The geometry could not be built: ' + G.error, 'bad');
  else if (G.empty) st = pill('Import an STL or STEP file of the blade (in the inputs, 3D geometry)', 'warn');
  else {
    st = pill(G.open ? `The blade does not cover the region at ${G.open} of ${G.rays} points` : G.multi ? `The blade overhangs at ${G.multi} of ${G.rays} points: its underside is not a single height there` : 'Geometry and mesh ready', G.open ? 'bad' : G.multi ? 'warn' : 'ok')
      + pill(`Blade ${G.label}`, '') + pill('The 3D solve comes next (not built yet)', '');
  }
  document.getElementById('st').innerHTML = st;
  if (G.mesh) document.getElementById('ss').innerHTML = [
    [C3D.region === 'strip' ? `Strip at L${C3D.loc + 1}, mm` : 'Full width, mm', C3D.region === 'strip' ? String(C3D.stripW) : String(ACROSS_W)],
    ['Gap at the edge, mm', Number.isFinite(G.gMin) ? `${(G.gMin * 1000).toFixed(3)}–${(G.gMax * 1000).toFixed(3)}` : 'no blade'],
    ['Blade + film, mm', `${(G.xe * 1000).toFixed(1)} + ${(G.Ld * 1000).toFixed(1)}`],
    ['Hexahedra', G.mesh.cells.toLocaleString()],
    ['Nodes', G.mesh.nodes.toLocaleString()],
    ['Underside', G.open ? `${G.open} open` : G.multi ? `${G.multi} overhang` : 'single layer'],
  ].map(a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${a[0]}</span><strong>${a[1]}</strong></div>`).join('');
  document.getElementById('oneDTable').innerHTML = oneDCompareTable();
  // (drawn at once when three.js is in: an image export redraws the page and takes the view straight away)
  if (!G.mesh) document.getElementById('v3dHost').innerHTML = `<p class="v3d-msg">${G.error ? 'Nothing to show: the geometry could not be built.' : 'No blade yet: import an STL or STEP file of the blade (inputs, 3D geometry).'}</p>`;
  else if (typeof THREE !== 'undefined' && THREE.OrbitControls) v3Draw(G);
  else load3DLibs().then(() => v3Draw(G)).catch(e => { const h = document.getElementById('v3dHost'); if (h) h.innerHTML = `<p class="v3d-msg">The 3D view could not start: ${mEsc(e.message)}</p>`; });
}

// ---- the 3D view (three.js) ----
const V3 = { ready: null, renderer: null, scene: null, camera: null, controls: null, group: null, key: null, bounds: null };
function load3DLibs() { if (!V3.ready) V3.ready = loadScript('lib/three.min.js').then(() => loadScript('lib/OrbitControls.js')); return V3.ready; }
function v3Draw(G) {
  const host = document.getElementById('v3dHost');
  if (!host || typeof THREE === 'undefined') return;
  if (!V3.renderer) {
    V3.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    V3.renderer.localClippingEnabled = true;
    V3.scene = new THREE.Scene();
    V3.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    V3.controls = new THREE.OrbitControls(V3.camera, V3.renderer.domElement);
    V3.controls.addEventListener('change', v3Render);
    V3.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const d = new THREE.DirectionalLight(0xffffff, 0.75); d.position.set(0.6, 1, 0.8); V3.scene.add(d);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.3); d2.position.set(-0.8, 0.4, -0.6); V3.scene.add(d2);
  }
  host.innerHTML = ''; host.appendChild(V3.renderer.domElement);
  // (the view follows the size of its box: the window, the inputs bar opened or closed)
  if (!V3.ro && window.ResizeObserver) V3.ro = new ResizeObserver(es => { const r = es[0].contentRect; if (r.width > 0 && r.height > 0) { V3.renderer.setSize(r.width, r.height); V3.camera.aspect = r.width / r.height; V3.camera.updateProjectionMatrix(); v3Render(); } });
  if (V3.ro) { V3.ro.disconnect(); V3.ro.observe(host); }
  V3.renderer.domElement.setAttribute('role', 'img');
  V3.renderer.domElement.setAttribute('aria-label', '3D view of the blade over the web and the slurry region');
  V3.renderer.setPixelRatio(window.EXPORT_DPR || window.devicePixelRatio || 1);   // (an image export draws it at its scale)
  const w = host.clientWidth || 800, h = host.clientHeight || 420;
  V3.renderer.setSize(w, h); V3.camera.aspect = w / h; V3.camera.updateProjectionMatrix();
  V3.renderer.setClearColor(new THREE.Color(cssVar('--surface')), 1);
  const key = JSON.stringify([G.key, C3D.vscale, C3D.blade, C3D.slurry, C3D.web, C3D.mesh, isDarkTheme()]);
  if (key !== V3.key) { v3Scene(G); const firstView = V3.key === null || !V3.sameRegion(G); V3.key = key; V3.region = G.key; if (firstView) v3Camera(); }
  v3Render();
}
V3.sameRegion = G => V3.region && JSON.parse(V3.region).slice(0, 4).join() === JSON.parse(G.key).slice(0, 4).join();
function v3Render() { if (V3.renderer) V3.renderer.render(V3.scene, V3.camera); }
/** Build the scene from the geometry: in mm, the heights drawn C3D.vscale times larger. */
function v3Scene(G) {
  if (V3.group) { V3.scene.remove(V3.group); V3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  const grp = new THREE.Group(); grp.scale.set(1, C3D.vscale, 1); V3.group = grp; V3.scene.add(grp);
  if (!G.mesh) return;
  const mm = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * 1000; return o; };
  const col = v => new THREE.Color(cssVar(v));
  if (C3D.blade) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(mm(G.tris), 3)); g.computeVertexNormals();
    // (cut off a little above the slurry's top: the flow is under it, and the rest would fill the view)
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), G.cutY * 1000 * C3D.vscale);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col('--blade'), roughness: 0.65, metalness: 0.15, side: THREE.DoubleSide, flatShading: true, clippingPlanes: [cut] })));
  }
  const m = G.mesh, pos = mm(m.pos), id = (i, j, k) => (i * m.nz + k) * (m.ny + 1) + j;
  if (C3D.slurry) {
    // the slurry region's outer faces: top, the two sides, inlet and outlet
    const idx = [], quad = (a, b, c, d) => idx.push(a, b, c, a, c, d);
    for (let i = 0; i < m.nx - 1; i++) for (let k = 0; k < m.nz - 1; k++) quad(id(i, m.ny, k), id(i + 1, m.ny, k), id(i + 1, m.ny, k + 1), id(i, m.ny, k + 1));
    for (const k of [0, m.nz - 1]) for (let i = 0; i < m.nx - 1; i++) for (let j = 0; j < m.ny; j++) quad(id(i, j, k), id(i + 1, j, k), id(i + 1, j + 1, k), id(i, j + 1, k));
    for (const i of [0, m.nx - 1]) for (let k = 0; k < m.nz - 1; k++) for (let j = 0; j < m.ny; j++) quad(id(i, j, k), id(i, j, k + 1), id(i, j + 1, k + 1), id(i, j + 1, k));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4f8fe8, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })));
  }
  if (C3D.mesh) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(Array.from(m.lines));
    grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col('--ink'), transparent: true, opacity: 0.35 })));
  }
  if (C3D.web) {
    const x0 = -2, x1 = (G.xe + G.Ld) * 1000 + 2, z0 = G.rg.z0 * 1000 - 2, z1 = G.rg.z1 * 1000 + 2;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, -0.001, (z0 + z1) / 2);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col('--fibre'), roughness: 0.9, side: THREE.DoubleSide })));
  }
  // the bounds the camera fits: the slurry region and the blade near it (in the scaled scene)
  const b = new THREE.Box3(new THREE.Vector3(-1, 0, G.rg.z0 * 1000), new THREE.Vector3((G.xe + G.Ld) * 1000 + 1, Math.min(G.box.max[1], G.cutY) * 1000 * C3D.vscale, G.rg.z1 * 1000));
  V3.bounds = b;
}
/** Point the camera at the region from the chosen side. */
function v3Camera() {
  if (!V3.camera || !V3.bounds) return;
  const b = V3.bounds, c = b.getCenter(new THREE.Vector3());
  const dir = { iso: [0.9, 0.75, 1.3], side: [0, 0.02, 1], top: [0.001, 1, 0.001], front: [-1, 0.25, 0.001] }[C3D.view] || [1, 1, 1];
  const v = new THREE.Vector3(...dir).normalize(), up = new THREE.Vector3(...(C3D.view === 'top' ? [1, 0, 0] : [0, 1, 0]));
  // (the distance that fits the box's corners in the view, across and up)
  const right = new THREE.Vector3().crossVectors(up, v).normalize(), upv = new THREE.Vector3().crossVectors(v, right);
  const tV = Math.tan(V3.camera.fov * Math.PI / 360), tH = tV * V3.camera.aspect;
  let dist = 0;
  for (let n = 0; n < 8; n++) {
    const d = new THREE.Vector3(n & 1 ? b.max.x : b.min.x, n & 2 ? b.max.y : b.min.y, n & 4 ? b.max.z : b.min.z).sub(c);
    dist = Math.max(dist, d.dot(v) + Math.abs(d.dot(right)) / tH, d.dot(v) + Math.abs(d.dot(upv)) / tV);
  }
  dist *= 1.08;
  V3.camera.position.copy(c.clone().add(v.multiplyScalar(dist)));
  V3.camera.up.copy(up);
  V3.camera.near = dist / 1000; V3.camera.far = dist * 20; V3.camera.updateProjectionMatrix();
  V3.controls.target.copy(c); V3.controls.update();
  v3Render();
}
