/*
 * ui-3d.js — Flow › 3D. The blade is made from the 2D setup (its side profile extended across the
 * web, the gap varying there as the inputs say), or read from an STL or STEP file of the blade (STEP
 * through occt-import-js, loaded on first use); either is placed over the web with its lowest point at
 * the gap, the height of its underside found by casting rays (cfd-3d-geom.js). Solve runs the 3D flow
 * on a strip around one location in a worker (cfd-3d-worker.js: each station across the strip in 2D,
 * then coupled in 3D by cfd-fem3d.js); the page shows the flow in 3D coloured by a field, the film and
 * the contact line across the strip, the pressure on the blade, and the 3D column of the 1D / 2D / 3D
 * table. The view is three.js (lib/, loaded when the page first opens).
 *
 * Loaded before undo.js (its settings are undo steps) and project.js (they and the result are saved in the project).
 */
const C3D_DEFAULTS = { source: 'made', region: 'strip', loc: 0, stripW: 20, units: 'mm', machine: '+x', up: '+z', inlet: 40,
  nxGap: 26, nxFace: 4, nxFilm: 16, ny: 4, nzStrip: 2, nzFull: 30, vscale: 5, view: 'iso', field: 'speed', blade: true, slurry: true, web: true, mesh: true,
  stream: false, streamDensity: 'medium' };
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
  inlet: ['Inlet upstream of the edge', v => v + ' mm'], nxGap: ['3D mesh along the blade', v => v], nxFace: ['3D mesh up the exit face', v => v], nxFilm: ['3D mesh along the free surface', v => v],
  ny: ['3D mesh across the gap', v => v], nzStrip: ['3D mesh across the strip', v => v], nzFull: ['3D mesh across the web', v => v], vscale: ['3D vertical scale', v => '×' + v],
  field: ['3D field shown', v => (C3D_FIELDS[v] || { l: v }).l],
  blade: ['3D view: blade', v => v ? 'on' : 'off'], slurry: ['3D view: slurry', v => v ? 'on' : 'off'], web: ['3D view: web', v => v ? 'on' : 'off'], mesh: ['3D view: mesh', v => v ? 'on' : 'off'],
  stream: ['3D view: streamlines', v => v ? 'on' : 'off'], streamDensity: ['3D streamline density', v => (C3D_STREAM[v] || { l: v }).l.toLowerCase()],
};
/** The view settings (not part of "unsaved changes"). */
const C3D_DISPLAY = ['view', 'vscale', 'field', 'blade', 'slurry', 'web', 'mesh', 'stream', 'streamDensity'];
/** Streamline densities: lines [across, up the gap] on a strip and on the full width (the full width is wide and thin). */
const C3D_STREAM = { low: { l: 'Low', strip: [5, 6], full: [10, 3] }, medium: { l: 'Medium', strip: [6, 10], full: [15, 4] }, high: { l: 'High', strip: [10, 12], full: [24, 5] } };
const c3dSetupKey = () => JSON.stringify([Object.keys(C3D_DEFAULTS).filter(k => !C3D_DISPLAY.includes(k)).map(k => C3D[k]), C3D_FILE && C3D_FILE.id]);
const C3D_MESH_LIMITS = { nxGap: [6, 80], nxFace: [1, 12], nxFilm: [6, 60], ny: [2, 10], nzStrip: [1, 8], nzFull: [6, 150], stripW: [2, 300], inlet: [1, 500] };
/** Fields the 3D view can colour the flow by: label, unit, value at node n of a result, diverging (signed) or not. */
const C3D_FIELDS = {
  none: { l: 'None' },
  speed: { l: 'Speed', u: 'mm/s', f: (R, n) => Math.hypot(R.u[n], R.v[n], R.w[n]) * 1000 },
  p: { l: 'Pressure', u: 'Pa', f: (R, n) => R.p[n] },
  gd: { l: 'Shear rate', u: '1/s', f: (R, n) => R.gd[n] },
  mu: { l: 'Viscosity', u: 'Pa·s', f: (R, n) => R.mu[n] },
  w: { l: 'Cross-web speed', u: 'mm/s', f: (R, n) => R.w[n] * 1000, div: true },
};

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
    g.shape, g.R, g.Xup, g.L, g.exitAngle, P.face, P.dH, P.lw, P.tilt, P.dt, C3D_FILE && C3D_FILE.id, ONE_D.key]);
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
      ${C3D.region === 'strip' ? sel('Around', 'loc', CFD_LOCS.map((l, i) => opt(i, `L${i + 1} · z ${l.z} mm`, C3D.loc)).join('')) + num('Strip width', 'stripW', 'mm') : `<p class="prop-note">The full ${ACROSS_W} mm of the web, with the shared inputs (the locations' own inputs are theirs only).</p>`}
    </details>
    <details class="grp cfd-grp" data-c3dgrp="mesh"${C3D_OPEN.mesh ? ' open' : ''}><summary>3D mesh</summary>
      ${num('Along the blade', 'nxGap', 'elements')}${num('Up the exit face', 'nxFace', 'elements')}${num('Along the free surface', 'nxFilm', 'elements')}${num('Across the gap', 'ny', 'elements')}
      ${C3D.region === 'strip' ? num('Across the strip', 'nzStrip', 'elements') : num('Across the web', 'nzFull', 'elements')}
      <p class="prop-note">Hexahedral, 27 nodes each: each station across the strip is laid out as the 2D lays out its mesh (graded toward the metering edge and the contact line; the free film as long as the 2D's), and the stations joined. ${c3dEstimateText()}</p>
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

/** The STEP reader (occt-import-js). Opened as a file (file://) the browser won't fetch its WebAssembly: it then comes
 *  from lib/occt-import-js.wasm.js, the same binary as text (build-occt.js), loaded like a script. */
async function c3dOcct() {
  if (location.protocol !== 'file:') return occtimportjs({ locateFile: n => 'lib/' + n });
  if (typeof self.OCCT_WASM === 'undefined') await loadScript('lib/occt-import-js.wasm.js');
  const s = atob(self.OCCT_WASM), wasmBinary = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) wasmBinary[i] = s.charCodeAt(i);
  delete self.OCCT_WASM;   // (the text is not needed once decoded)
  return occtimportjs({ wasmBinary });
}
/** Read an STL or STEP file of the blade. */
async function c3dImportFile(file) {
  try {
    const buf = await file.arrayBuffer(), step = /\.(step|stp)$/i.test(file.name);
    let tris;
    if (step) {
      imgToast('Reading the STEP file…');
      if (typeof occtimportjs === 'undefined') await loadScript('lib/occt-import-js.js');
      if (!C3D_OCCT) C3D_OCCT = c3dOcct();
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

// ---- the solve ----
/** The size of the 3D solve for the settings: unknowns, the matrix's memory, and about how long (from measured runs). */
function c3dEstimate(nEz = C3D.region === 'strip' ? C3D.nzStrip : C3D.nzFull) {
  const NR = 2 * C3D.ny + 1, NL = 2 * nEz + 1, NC = 2 * (C3D.nxGap + C3D.nxFace + C3D.nxFilm) + 1;
  const col = NL * NR * 3 + (NL + 1) / 2 * (NR + 1) / 2 / 2 + NL, ND = NC * col, kl = 3 * col;
  const bytes = ND * 3 * kl * 8, flops = ND * kl * 2 * kl, secs3 = 1.3 * 4 * flops / 2.8e9;
  return { ND, bytes, secs3, secs: secs3 + NL * 1.7, NL };
}
const C3D_MAX_BYTES = 2e9;
/** The full width: overlapping strips (elements across each, overlap), their count, the workers solving them at once. */
const C3D_WIDE_CFG = { sub: 2, overlap: 1, maxSweeps: 12, tol: 1e-5 };
function c3dWideLayout(nEz = C3D.nzFull) {
  const sub = Math.min(C3D_WIDE_CFG.sub, nEz), ov = Math.min(C3D_WIDE_CFG.overlap, sub - 1), step = sub - ov, subs = [];
  for (let e0 = 0; ; e0 += step) { const e1 = Math.min(nEz, e0 + sub); subs.push([2 * Math.max(0, e1 - sub), 2 * e1]); if (e1 === nEz) break; }
  const workers = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1, subs.length));
  return { sub, ov, subs, workers };
}
const c3dTime = secs => secs < 90 ? `${Math.max(5, Math.round(secs / 5) * 5)} s` : `${Math.round(secs / 60)} min`;
const c3dMem = bytes => bytes < 1e9 ? Math.round(bytes / 1e6) + ' MB' : (bytes / 1e9).toFixed(1) + ' GB';
function c3dEstimateText() {
  if (C3D.region === 'full') {
    // (measured: the 2D at each station about 3 s; a strip's first 3D solve as estimated, the later sweeps' about 60 % of it; about 6 sweeps)
    const L = c3dWideLayout(), e = c3dEstimate(L.sub), NL = 2 * C3D.nzFull + 1;
    const perColour = Math.ceil(Math.ceil(L.subs.length / 2) / L.workers), secs = (NL / L.workers + 4) * 3 + 2 * perColour * e.secs3 * (1 + 0.6 * 5);
    return `Solved as ${L.subs.length} overlapping strips (${L.sub} elements across each), ${L.workers} at a time, sweep after sweep until they agree; stations every ${(ACROSS_W / (NL - 1)).toFixed(1)} mm (variation across the web on a shorter scale is sampled there, not resolved); the web's edges are symmetry planes. About ${c3dMem(L.workers * e.bytes)} and ${c3dTime(secs)}.`;
  }
  const e = c3dEstimate();
  return `This mesh: about ${Math.round(e.ND / 1000)} thousand unknowns, ${c3dMem(e.bytes)} for the solve, about ${c3dTime(e.secs)}.${e.bytes > C3D_MAX_BYTES ? ' <b>More memory than a browser can give one page: fewer elements across the strip or the gap.</b>' : ''}`;
}
const C3D_RUN = { worker: null, id: 0, status: 'idle', progress: null, error: null, t0: 0 };
let C3D_RES = null;   // the last 3D solve: { key, loc, width, source, fileName, ms, when, result }
/** Sampled across the strip (m, from the location): the gap's change and the contact angle, as the 2D sees them at each z. */
function c3dStripSamples(i, W) {
  const zc = CFD_LOCS[i].z, gap = [], th = [], n = 81;
  const gOff = locInput(i, 'gap') - cfdLocalGapMm(zc), tOff = locInput(i, 'th') - cfdLocalContactDeg(zc), g0 = cfdLocalGapMm(zc);
  for (let k = 0; k < n; k++) {
    const zr = -W / 2 + W * k / (n - 1), zmm = zc + zr * 1000;
    gap.push([zr, (cfdLocalGapMm(zmm) - g0) / 1000]); th.push([zr, cfdLocalContactDeg(zmm) + tOff]);
  }
  return { gap, th, gOff };
}
/** The shared inputs at the web's middle (no location's own): the full width's reference. */
function c3dSharedGeometry() {
  const zc = ACROSS_W / 2, geo = cfdGeometry(0), uses = RHEO_MODELS[CFDG.model].uses;
  const U = P.U / 60, H = cfdLocalGapMm(zc) / 1000, ty = uses.includes('ty') ? P.ty : 0, n = uses.includes('n') ? P.n : 1;
  return { ...geo, z: zc, U, H, contactDeg: cfdLocalContactDeg(zc), Pup: P.Pup * 1000, muRef: P.mu, ty, n, muRep: muLaw(U / H, P.mu, ty, n), gamma: P.g };
}
/** What the worker(s) are sent (file: false leaves out the file's rays, for the key). Strip: around the location; full: the web, stations from its middle. */
function c3dSolveMessage(withFile = true) {
  const full = C3D.region === 'full', i = C3D.loc;
  const msg = cfdWorkerMessage(full ? c3dSharedGeometry() : cfdGeometry(i));
  msg.solver = { ...msg.solver, nEb: C3D.nxGap, nEf: C3D.nxFace, nEs: C3D.nxFilm, nEy: C3D.ny };
  let strip, W, zc;
  if (full) {
    W = ACROSS_W / 1000; zc = W / 2;
    const NL = 2 * C3D.nzFull + 1, zs = Array.from({ length: NL }, (_, l) => -W / 2 + W * l / (NL - 1)), g0 = cfdLocalGapMm(zc * 1000);
    // (sampled at the stations themselves: the variation between them is not resolved)
    strip = { width: W, nEz: C3D.nzFull, zs, gap: zs.map(z => [z, (cfdLocalGapMm((zc + z) * 1000) - g0) / 1000]), th: zs.map(z => [z, cfdLocalContactDeg((zc + z) * 1000)]) };
  } else {
    W = C3D.stripW / 1000; zc = CFD_LOCS[i].z / 1000;
    const smp = c3dStripSamples(i, W);
    strip = { width: W, nEz: C3D.nzStrip, gap: smp.gap, th: smp.th };
  }
  let file = null;
  if (C3D.source === 'file') {
    const fileKey = [C3D_FILE && C3D_FILE.id, C3D.units, C3D.machine, C3D.up, C3D.inlet];
    if (!withFile) return { msg, strip, file: fileKey };
    // the file's underside at the solve's stations across the region and closely along the flow
    const G = c3dBuild(), xe = G.xe, NL = 2 * strip.nEz + 1;
    const xs = Array.from({ length: 121 }, (_, k) => xe * k / 120), zs = Array.from({ length: Math.max(NL, 9) }, (_, k) => -W / 2 + W * k / (Math.max(NL, 9) - 1));
    const f = undersideField(G.tris, xs.map((x, k) => k === 0 ? x + 1e-7 : k === xs.length - 1 ? x - 1e-7 : x), zs.map(z => z + zc));
    file = { xs, zs, low: Array.from(f.low) };
  }
  return { msg, strip, file };
}
const c3dSolveKey = () => JSON.stringify([C3D.region, C3D.region === 'full' ? null : C3D.loc, C3D.source, c3dSolveMessage(false)]);
/** The current key for a result's own region and location (a result shown in the table while the page is set to another region). */
function c3dSolveKey3(S) {
  const keep = { region: C3D.region, loc: C3D.loc };
  C3D.region = S.region === 'full' ? 'full' : 'strip'; if (S.region !== 'full') C3D.loc = S.loc;
  try { return c3dSolveKey(); } finally { Object.assign(C3D, keep); }
}
/** The result the page shows: the last solve if it was for this region (this location's strip, or the full width). */
function c3dShown() {
  if (!C3D_RES || C3D_RES.source !== C3D.source) return null;
  if (C3D.region === 'full') return C3D_RES.region === 'full' ? C3D_RES : null;
  return C3D_RES.region !== 'full' && C3D_RES.loc === C3D.loc ? C3D_RES : null;
}
function c3dRun() {
  if (C3D_RUN.status === 'running') return;
  const G = c3dBuild();
  const stop = why => { C3D_RUN.status = 'error'; C3D_RUN.error = why; render(); };
  if (G.error || G.empty) return stop(G.error || 'no blade: import an STL or STEP file of the blade');
  if (G.open || G.multi) return stop(G.open ? 'the blade does not cover the region' : 'the blade overhangs: its underside is not a single height over the web');
  const est = c3dEstimate();
  if (C3D.region !== 'full' && est.bytes > C3D_MAX_BYTES) return stop('this mesh needs more memory than a browser can give one page (3D mesh, in the inputs)');
  const m = c3dSolveMessage(true), key = c3dSolveKey();
  if (C3D.region === 'full') { c3dRunWide(m, key); return; }
  const id = ++C3D_RUN.id;
  const w = makeWorker('cfd-3d-worker.js');
  Object.assign(C3D_RUN, { worker: w, status: 'running', progress: null, error: null, t0: performance.now() });
  const done = () => { w.terminate(); if (C3D_RUN.worker === w) C3D_RUN.worker = null; };
  w.onmessage = e => {
    if (e.data.id !== id) return;
    if (e.data.progress) { C3D_RUN.progress = e.data.progress; c3dBusy(); return; }
    done();
    const ms = performance.now() - C3D_RUN.t0, r = e.data.ok ? e.data.result : null;
    if (!r) { C3D_RUN.status = 'error'; C3D_RUN.error = e.data.error; }
    else if (!r.converged) { C3D_RUN.status = 'error'; C3D_RUN.error = `the 3D did not converge (residual ${r.residual.toExponential(1)} after ${r.iterations} Newton steps)`; }
    else {
      C3D_RUN.status = 'done';
      r.zOff = CFD_LOCS[C3D.loc].z / 1000;
      C3D_RES = { key, region: 'strip', loc: C3D.loc, width: C3D.stripW, source: C3D.source, fileName: C3D_FILE && C3D.source === 'file' ? C3D_FILE.name : null, ms, when: Date.now(), result: r };
      V3.key = null;
    }
    render();
  };
  w.onerror = e => { done(); C3D_RUN.status = 'error'; C3D_RUN.error = e.message || 'the 3D worker failed'; render(); };
  w.postMessage({ ...m, id });
  render();
}
function c3dStop() {
  if (C3D_RUN.status !== 'running') return;
  if (C3D_RUN.worker) C3D_RUN.worker.terminate();
  for (const w of C3D_RUN.workers || []) w.terminate();
  Object.assign(C3D_RUN, { worker: null, workers: [], status: 'cancelled', progress: null });
  render();
}

/**
 * The full width: overlapping strips (c3dWideLayout) in parallel workers. Each worker solves the 2D at the
 * stations of its strips (the middle station first, the same everywhere: it sets the face elements), then,
 * sweep after sweep, its strips of one colour and then of the other (alternate strips: they share only held
 * sides), each with its neighbours' latest solution held on its inner sides -- until nothing changes
 * (cfd-fem3d.js's solveCoaterWide, run in parallel).
 */
async function c3dRunWide(m, key) {
  const { msg, strip, file } = m, NL = 2 * strip.nEz + 1, zs = strip.zs, mid = (NL - 1) >> 1, L = c3dWideLayout(strip.nEz), subs = L.subs, P = L.workers;
  const run = ++C3D_RUN.id, workers = Array.from({ length: P }, () => makeWorker('cfd-3d-worker.js'));
  Object.assign(C3D_RUN, { worker: null, workers, status: 'running', progress: { stage: 'starting' }, error: null, t0: performance.now() });
  const alive = () => C3D_RUN.id === run && C3D_RUN.status === 'running';
  const stage = t => { C3D_RUN.progress = { ...(C3D_RUN.progress || {}), stage: t }; c3dBusy(); };
  let seq = 0;
  const call = (w, data) => new Promise((res, rej) => {
    const id = ++seq;
    const on = e => {
      if (e.data.id !== id) return;
      if (e.data.progress) {
        const q = e.data.progress;
        if (Number.isFinite(q.residual)) C3D_RUN.progress = { ...C3D_RUN.progress, it: q.it, residual: q.residual };
        if (q.stage && /^2D at /.test(q.stage)) C3D_RUN.progress = { ...C3D_RUN.progress, detail: q.stage.replace(/ \(gap.*$/, '') };   // (a worker's station, while the 2D runs)
        return;
      }
      w.removeEventListener('message', on);
      if (e.data.ok) res(e.data.result); else rej(new Error(e.data.error));
    };
    w.addEventListener('message', on);
    w.onerror = ev => rej(new Error(ev.message || 'the 3D worker failed'));
    w.postMessage({ ...data, id });
  });
  render();
  try {
    // (each worker a run of neighbouring strips: its stations one block, each solved in 2D once or twice, not by every worker)
    const owner = i => Math.min(P - 1, Math.floor(i * P / subs.length)), mine = workers.map(() => new Set());
    subs.forEach(([l0, l1], i) => { for (let l = l0; l <= l1; l++) mine[owner(i)].add(l); });
    stage(`2D at the ${NL} stations across the web`);
    const inits = await Promise.all(workers.map((w, k) => call(w, { type: 'wideInit', msg, strip, file, zs, ref: mid, stations: [...mine[k]] })));
    const meta = inits[0], state = new Array(NL), film2 = [], s2 = [];
    let top2 = null;
    inits.forEach(r => {
      for (const l in r.states) state[l] = r.states[l];
      for (const l in r.film2) { film2[l] = r.film2[l]; s2[l] = r.s2[l]; }
      if (r.top2[mid]) top2 = r.top2[mid];
    });
    const filmOf = T => T.y ? T.y[(meta.NC - 1) * meta.NR + meta.NR - 1] : null;
    const history = [];
    let converged = false, sweeps = 0, unknowns = 0;
    for (; sweeps < C3D_WIDE_CFG.maxSweeps && !converged; sweeps++) {
      let change = 0, doneN = 0;
      for (const colour of [0, 1]) {
        const todo = workers.map(() => []);
        subs.forEach((_, i) => { if (i % 2 === colour) todo[owner(i)].push(i); });
        await Promise.all(workers.map(async (w, k) => {
          for (const i of todo[k]) {
            if (!alive()) throw new Error('stopped');
            const [l0, l1] = subs[i];
            const lastCh = history.length ? history[history.length - 1] : Infinity;
            stage(`sweep ${sweeps + 1}${Number.isFinite(lastCh) ? ` (last change ${(lastCh * meta.H * 1e6).toFixed(3)} µm)` : ''}: strip ${++doneN} of ${subs.length}`);
            const states = {};
            for (let l = l0; l <= l1; l++) states[l] = state[l];
            const r = await call(w, { type: 'wideSolve', l0, l1, states, sideLo: l0 > 0, sideHi: l1 < NL - 1 });
            unknowns = Math.max(unknowns, r.unknowns);
            for (const l in r.states) {
              const T = r.states[l], old = state[l], f0 = filmOf(old), f1 = filmOf(T);
              change = Math.max(change, f0 == null ? Infinity : Math.abs(f1 - f0) / meta.H, meta.climbed ? Math.abs(T.s - old.s) / meta.H : 0);
              state[l] = T;
            }
          }
        }));
      }
      history.push(change);
      if (change < C3D_WIDE_CFG.tol) converged = true;
    }
    if (!alive()) return;
    if (!converged) throw new Error(`the strips did not agree after ${sweeps} sweeps (last change ${(history[history.length - 1] * meta.H * 1e6).toFixed(3)} µm)`);
    // the result, as a strip's: node arrays over every station, the stations, the middle's pressure along the top
    const NC = meta.NC, NR = meta.NR, N = NC * NL * NR, R = { region: 'full', mode: meta.mode, converged: true, sweeps, history, iterations: sweeps, NC, NR, NL, cCorner: meta.cCorner, cCL: meta.cCL, xe: meta.xe, H: meta.H,
      zOff: ACROSS_W / 2000, size: { unknowns, strips: subs.length, workers: P } };
    for (const f of ['x', 'y', 'z', 'u', 'v', 'w', 'p', 'gd', 'mu']) R[f] = new Float32Array(N);
    for (let l = 0; l < NL; l++) for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) {
      const n3 = (c * NL + l) * NR + k, n2 = c * NR + k;
      for (const f of ['x', 'y', 'z', 'u', 'v', 'w', 'p', 'gd', 'mu']) R[f][n3] = state[l][f][n2];
    }
    R.stations = zs.map((z, l) => ({ z, dH: 0, film: filmOf(state[l]), q: state[l].q, s: meta.climbed ? state[l].s : 0, film2: film2[l], s2: s2[l] }));
    const T = state[mid];
    R.top = { x: [], y: [], p3: [], p2: [] };
    for (let c = 0; c < NC; c++) { const n2 = c * NR + NR - 1; R.top.x.push(T.x[n2]); R.top.y.push(T.y[n2]); R.top.p3.push(T.p[n2]); R.top.p2.push(top2 ? top2[c] : NaN); }
    const ms = performance.now() - C3D_RUN.t0;
    C3D_RES = { key, region: 'full', loc: null, width: ACROSS_W, source: C3D.source, fileName: C3D_FILE && C3D.source === 'file' ? C3D_FILE.name : null, ms, when: Date.now(), result: R };
    V3.key = null;
    C3D_RUN.status = 'done';
  } catch (e) {
    if (C3D_RUN.id === run && C3D_RUN.status === 'running') { C3D_RUN.status = 'error'; C3D_RUN.error = e.message; }
  } finally {
    for (const w of workers) w.terminate();
    if (C3D_RUN.id === run) C3D_RUN.workers = [];
    if (C3D_RUN.id === run) render();
  }
}
/** While solving: the stage and the latest Newton residual in the verdict (no full redraw). */
function c3dBusy() {
  const el = document.getElementById('c3dBusy');
  if (!el || C3D_RUN.status !== 'running') return;
  const pr = C3D_RUN.progress, t = ((performance.now() - C3D_RUN.t0) / 1000).toFixed(0);
  el.textContent = `Solving the 3D (${t} s): ${pr ? pr.stage + (pr.stage.startsWith('3D') && Number.isFinite(pr.residual) ? `, Newton step ${pr.it + 1}, residual ${pr.residual.toExponential(1)}` : '') + (pr.detail && /^2D at the/.test(pr.stage) ? ` (${pr.detail.replace(/^2D /, '')})` : '') : 'starting'}`;
}
setInterval(c3dBusy, 1000);

// ---- the page ----
function view3D() {
  c3dSetupTree();
  oneDRequest(false);
  const tog = (k, t) => `<label class="fv-chk"><input type="checkbox" data-v3tog="${k}"${C3D[k] ? ' checked' : ''}> ${t}</label>`;
  const views = [['iso', '3D'], ['side', 'Side'], ['top', 'Top'], ['front', 'Front']];
  const S = c3dShown(), R = S && S.result, stale = S && S.key !== c3dSolveKey3(S), running = C3D_RUN.status === 'running';
  const fld = C3D_FIELDS[C3D.field] || C3D_FIELDS.speed, showField = R && C3D.field !== 'none';
  const range = showField ? c3dFieldRange(R) : null;
  const pane = (id, title, aria, legend = '') => `<figure class="pane"><figcaption>${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas>${legend ? `<div class="pane-legend">${legend}</div>` : ''}</figure>`;
  const acc = cssVar('--accent'), mut = cssVar('--muted');
  const where = R && R.region === 'full' ? 'web' : 'strip';
  const charts = R ? `<div class="v3d-charts">
      ${pane('c3dFilm', `Wet film across the ${where}${stale ? ' (out of date)' : ''}`, `Wet film thickness across the ${where}, 3D and 2D`, oneDLegend([['3D', acc], ['2D at each station', mut, 'dash']]))}
      ${pane('c3dCL', `Contact line up the exit face across the ${where}`, `Contact line height up the exit face across the ${where}, 3D and 2D`, oneDLegend([['3D', acc], ['2D at each station', mut, 'dash']]))}
      ${pane('c3dPB', 'Pressure on the blade', `Pressure on the blade underside, along the flow and across the ${where}`, '')}
      ${pane('c3dPX', `Pressure along the blade, middle of the ${where}`, `Pressure along the blade and exit face at the middle of the ${where}, 3D and 2D`, oneDLegend([['3D', acc], ['2D', mut, 'dash']]))}
    </div>` : '';
  view.innerHTML = moduleFrame({
    tools: `<div class="seg" role="tablist" aria-label="View">${views.map(([v, t]) => `<button type="button" role="tab" data-v3view="${v}" aria-selected="${C3D.view === v}">${t}</button>`).join('')}</div>
      <label class="fv-chk">Field <select data-c3d="field"${R ? '' : ' disabled title="Solve first"'}>${Object.entries(C3D_FIELDS).map(([k, f]) => `<option value="${k}"${k === C3D.field ? ' selected' : ''}>${f.l}</option>`).join('')}</select></label>
      ${tog('blade', 'Blade')}${tog('slurry', 'Slurry')}${tog('web', 'Web')}${tog('mesh', 'Mesh')}
      <label class="fv-chk"${R ? '' : ' title="Solve first"'}><input type="checkbox" data-v3tog="stream"${C3D.stream ? ' checked' : ''}${R ? '' : ' disabled'}> Streamlines</label>
      ${R && C3D.stream ? `<select data-c3d="streamDensity" aria-label="Streamline density" title="How many streamlines">${Object.entries(C3D_STREAM).map(([k, d]) => `<option value="${k}"${k === C3D.streamDensity ? ' selected' : ''}>${d.l}</option>`).join('')}</select>` : ''}
      <select data-c3d="vscale" aria-label="Vertical scale" title="Heights drawn this many times larger (the gap is thin)">${[1, 2, 5, 10, 20, 50].map(v => `<option value="${v}"${v === C3D.vscale ? ' selected' : ''}>Height ×${v}</option>`).join('')}</select>
      ${running ? '<button type="button" class="btn btn-secondary btn-sm" id="c3dStop">Stop</button>' : `<button type="button" class="btn btn-primary btn-sm" id="c3dRun">Solve 3D</button>`}`,
    panes: [],
    extra: `<figure class="pane v3d"><figcaption>${R ? `The flow in 3D${showField ? `, coloured by ${fld.l.toLowerCase()} (${c3dFmt(range.min)} to ${c3dFmt(range.max)} ${fld.u})` : ''}` : 'The blade over the web and the slurry region'}${C3D.region === 'strip' ? `, strip at L${C3D.loc + 1}` : ', full web width'}${R && stale ? ' — out of date' : ''}</figcaption>
      <div class="v3d-host" id="v3dHost"><p class="v3d-msg">Loading the 3D view…</p></div>
      ${showField ? `<div class="v3d-bar"><span>${c3dFmt(range.min)}</span><i style="background:${c3dGradientCss(fld)}"></i><span>${c3dFmt(range.max)} ${fld.u}</span></div>` : ''}
      <div class="pane-legend"><span>x: machine direction →</span><span>y: up from the web (drawn ×${C3D.vscale})</span><span>z: across the web</span><span>Blade cut off just above the slurry</span>${R ? '<span>Mesh: as solved</span>' : ''}${R && C3D.stream ? `<span>Streamlines: from the inlet, spaced by equal flow up the gap${showField ? ', coloured by ' + fld.l.toLowerCase() : ''}</span>` : ''}<span>Drag to turn, wheel to zoom, right-drag to pan</span></div></figure>
      ${charts}
      <div class="oned-table" id="oneDTable"></div>`,
  });
  const G = c3dBuild();
  let st = '';
  if (running) st = pill('Solving the 3D…', '') + `<span class="c3d-busy" id="c3dBusy"></span>`;
  else if (R) {
    const mid = (R.NL - 1) / 2, sm = R.stations[mid], films = R.stations.map(s => s.film * 1000), cls = R.stations.map(s => s.s * 1000);
    st = pill(`3D solved: wet film ${Math.min(...films).toFixed(3)} to ${Math.max(...films).toFixed(3)} mm across the ${R.region === 'full' ? 'web' : 'strip'}`, stale ? 'warn' : 'ok')
      + (stale ? pill('Out of date: the inputs changed since (Solve 3D again)', 'warn') : '')
      + pill(R.mode === 'climbed' ? `Contact line ${Math.min(...cls).toFixed(2)} to ${Math.max(...cls).toFixed(2)} mm up the exit face` : 'Contact line pinned at the edge', '')
      + pill(R.region === 'full' ? `${c3dTime(S.ms / 1000)}: ${R.size.strips} strips, ${R.sweeps} sweeps until they agreed` : `${(S.ms / 1000).toFixed(0)} s, ${R.iterations} Newton steps`, '')
      + (R.region === 'full' ? pill('The web\'s edges: symmetry planes (the edge bead is not modelled)', '') : '');
    void sm;
  }
  if (!running && C3D_RUN.status === 'error') st = pill('The 3D could not be solved: ' + C3D_RUN.error, 'bad') + st;
  if (!R && !running) {
    if (G.error) st += pill('The geometry could not be built: ' + G.error, 'bad');
    else if (G.empty) st += pill('Import an STL or STEP file of the blade (in the inputs, 3D geometry)', 'warn');
    else st += pill(G.open ? `The blade does not cover the region at ${G.open} of ${G.rays} points` : G.multi ? `The blade overhangs at ${G.multi} of ${G.rays} points: its underside is not a single height there` : C3D.region === 'full' ? 'Geometry ready; the full-width solve is being built' : 'Geometry ready: Solve 3D', G.open ? 'bad' : G.multi ? 'warn' : 'ok')
      + pill(`Blade ${G.label}`, '') + (C3D.source === 'file' && G.mesh ? pill(`Exit face angle from the 2D setup (${cfdGeometry(C3D.loc).exitAngle}°)`, '') : '');
  }
  document.getElementById('st').innerHTML = st;
  c3dBusy();
  const stat = a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${a[0]}</span><strong>${a[1]}</strong></div>`;
  if (R) {
    const mid = (R.NL - 1) / 2, sm = R.stations[mid];
    let wMax = 0; for (let n = 0; n < R.w.length; n++) wMax = Math.max(wMax, Math.abs(R.w[n]));
    const dev = Math.max(...R.stations.map(s => Math.abs(s.film / s.film2 - 1))) * 100;
    const full = R.region === 'full', films = R.stations.map(s => s.film * 1000);
    document.getElementById('ss').innerHTML = [
      full ? ['Wet film, mean, mm', (films.reduce((a, b) => a + b, 0) / films.length).toFixed(3)] : ['Wet film at L' + (C3D.loc + 1) + ', mm', (sm.film * 1000).toFixed(3)],
      ['3D vs 2D film, largest', dev.toFixed(2) + ' %'],
      full ? ['Film range across the web', ((Math.max(...films) - Math.min(...films)) * 1000).toFixed(1) + ' µm'] : ['Contact line at L' + (C3D.loc + 1) + ', mm', R.mode === 'climbed' ? (sm.s * 1000).toFixed(2) : 'pinned'],
      ['Flow across the web, max', (wMax * 1000).toFixed(3) + ' mm/s'],
      full ? ['Unknowns per strip', `${R.size.unknowns.toLocaleString()} × ${R.size.strips}`] : ['Unknowns', R.size.unknowns.toLocaleString()],
      ['Solve time', full ? c3dTime(S.ms / 1000) : `${(S.ms / 1000).toFixed(0)} s`],
    ].map(stat).join('');
  } else if (G.mesh) document.getElementById('ss').innerHTML = [
    [C3D.region === 'strip' ? `Strip at L${C3D.loc + 1}, mm` : 'Full width, mm', C3D.region === 'strip' ? String(C3D.stripW) : String(ACROSS_W)],
    ['Gap at the edge, mm', Number.isFinite(G.gMin) ? `${(G.gMin * 1000).toFixed(3)}–${(G.gMax * 1000).toFixed(3)}` : 'no blade'],
    ['Blade + film, mm', `${(G.xe * 1000).toFixed(1)} + ${(G.Ld * 1000).toFixed(1)}`],
    ['Hexahedra', G.mesh.cells.toLocaleString()],
    ['Nodes', G.mesh.nodes.toLocaleString()],
    ['Underside', G.open ? `${G.open} open` : G.multi ? `${G.multi} overhang` : 'single layer'],
  ].map(stat).join('');
  document.getElementById('oneDTable').innerHTML = oneDCompareTable();
  const rb = document.getElementById('c3dRun'); if (rb) rb.onclick = c3dRun;
  const sb = document.getElementById('c3dStop'); if (sb) sb.onclick = c3dStop;
  if (R) c3dCharts(R);
  // (drawn at once when three.js is in: an image export redraws the page and takes the view straight away)
  if (!G.mesh && !R) document.getElementById('v3dHost').innerHTML = `<p class="v3d-msg">${G.error ? 'Nothing to show: the geometry could not be built.' : 'No blade yet: import an STL or STEP file of the blade (inputs, 3D geometry).'}</p>`;
  else if (typeof THREE !== 'undefined' && THREE.OrbitControls) v3Draw(G, R);
  else load3DLibs().then(() => v3Draw(G, R)).catch(e => { const h = document.getElementById('v3dHost'); if (h) h.innerHTML = `<p class="v3d-msg">The 3D view could not start: ${mEsc(e.message)}</p>`; });
}
const c3dFmt = v => { const a = Math.abs(v); return a === 0 ? '0' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toExponential(1); };
/** The colour map for a field: the 2D's choice (jet or blue) for magnitudes, diverging blue-red around zero for signed fields. */
const c3dLut = f => getLut(f.div ? 'div' : FV.cmap === 'jet' ? 'jet' : 'seq');
function c3dFieldRange(R) {
  const f = C3D_FIELDS[C3D.field];
  let min = Infinity, max = -Infinity;
  for (let n = 0; n < R.x.length; n++) { const v = f.f(R, n); if (v < min) min = v; if (v > max) max = v; }
  if (f.div) { const m = Math.max(Math.abs(min), Math.abs(max)) || 1; return { min: -m, max: m }; }
  return { min, max: max > min ? max : min + 1 };
}
function c3dGradientCss(f) {
  const lut = c3dLut(f);
  return `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(', ')})`;
}

// ---- the charts ----
function c3dCharts(R) {
  const acc = cssVar('--accent'), mut = cssVar('--muted');
  const full = R.region === 'full', zs = R.stations.map(s => (s.z + (full ? R.zOff : 0)) * 1000), x0 = zs[0], x1 = zs[zs.length - 1];
  const line = (id, a, b, yl, d) => {
    const cv = document.getElementById(id); if (!cv) return;
    const all = [...a, ...b], lo = Math.min(...all), hi = Math.max(...all), pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 2e-4, 1e-6);
    plotChart(cv, fitAspect(cv, 0.5), { x0, x1, y0: lo - pad, y1: hi + pad, yl, xl: full ? 'z across the web (mm)' : `z across the strip (mm), 0 = L${C3D.loc + 1}`, yd: d, xd: full ? 0 : 1,
      s: [{ p: zs.map((z, k) => [z, b[k]]), c: mut, w: 1.6, dash: [5, 4], dots: !full }, { p: zs.map((z, k) => [z, a[k]]), c: acc, w: 2.2, dots: !full }] });
  };
  line('c3dFilm', R.stations.map(s => s.film * 1000), R.stations.map(s => s.film2 * 1000), 'wet film (mm)', 4);
  if (R.mode === 'climbed') line('c3dCL', R.stations.map(s => s.s * 1000), R.stations.map(s => s.s2 * 1000), 'contact line up the face (mm)', 3);
  else { const cv = document.getElementById('c3dCL'); if (cv) { const { c, w, h } = setupCanvas(cv, 0.3); c.fillStyle = mut; c.font = '13px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText('Pinned at the metering edge at every station', w / 2, h / 2); } }
  c3dPressureMap(R);
  // pressure along the blade and face at the middle station: 3D and its station's 2D (up to the contact line)
  const cv = document.getElementById('c3dPX');
  if (cv) {
    const T = R.top, n = R.cCL + 1, xs = T.x.slice(0, n).map(x => x * 1000), a = T.p3.slice(0, n), b = T.p2.slice(0, n);
    const all = [...a, ...b], lo = Math.min(0, ...all), hi = Math.max(...all);
    plotChart(cv, fitAspect(cv, 0.5), { x0: 0, x1: xs[xs.length - 1], y0: lo - 0.05 * (hi - lo), y1: hi + 0.08 * (hi - lo), yl: 'pressure (Pa)', xl: 'x along the blade (mm); the last points up the exit face', yd: 0,
      s: [{ p: xs.map((x, k) => [x, b[k]]), c: mut, w: 1.6, dash: [5, 4] }, { p: xs.map((x, k) => [x, a[k]]), c: acc, w: 2.2 }] });
  }
}
/** Pressure on the blade's underside: along the flow (inlet to the metering edge) and across the strip, with its colour bar. */
function c3dPressureMap(R) {
  const cv = document.getElementById('c3dPB');
  if (!cv) return;
  const { c, w, h } = setupCanvas(cv, fitAspect(cv, 0.5));
  const NL = R.NL, NR = R.NR, nc = R.cCorner + 1, node = (cc, l) => (cc * NL + l) * NR + NR - 1;
  let lo = Infinity, hi = -Infinity;
  for (let cc = 0; cc < nc; cc++) for (let l = 0; l < NL; l++) { const v = R.p[node(cc, l)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const lut = c3dLut({ div: lo < 0 }), rng = lo < 0 ? { min: -Math.max(-lo, hi), max: Math.max(-lo, hi) } : { min: lo, max: hi > lo ? hi : lo + 1 };
  const m = { l: 52, r: 78, t: 24, b: 36 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  const zo = R.region === 'full' ? R.zOff : 0, xMax = R.xe * 1000, z0 = (R.stations[0].z + zo) * 1000, z1 = (R.stations[NL - 1].z + zo) * 1000;
  const X = x => m.l + x / xMax * pw, Y = z => m.t + ph - (z - z0) / (z1 - z0) * ph;
  // cells between neighbouring nodes, each filled by the mean of its four corners
  for (let cc = 0; cc < nc - 1; cc++) for (let l = 0; l < NL - 1; l++) {
    const v = (R.p[node(cc, l)] + R.p[node(cc + 1, l)] + R.p[node(cc, l + 1)] + R.p[node(cc + 1, l + 1)]) / 4;
    const xa = X(R.x[node(cc, l)] * 1000), xb = X(R.x[node(cc + 1, l)] * 1000), ya = Y((R.z[node(cc, l)] + zo) * 1000), yb = Y((R.z[node(cc, l + 1)] + zo) * 1000);
    c.fillStyle = lutColor(lut, (v - rng.min) / (rng.max - rng.min));
    c.fillRect(Math.min(xa, xb), Math.min(ya, yb), Math.abs(xb - xa) + 0.6, Math.abs(yb - ya) + 0.6);
  }
  const ink = cssVar('--muted');
  c.strokeStyle = cssVar('--line'); c.strokeRect(m.l, m.t, pw, ph);
  c.fillStyle = ink; c.font = '12px ' + cssVar('--mono');
  for (let k = 0; k <= 4; k++) { const x = xMax * k / 4; c.textAlign = 'center'; c.fillText(x.toFixed(0), X(x), h - m.b + 16); }
  for (let k = 0; k <= 2; k++) { const z = z0 + (z1 - z0) * k / 2; c.textAlign = 'right'; c.fillText(z.toFixed(zo ? 0 : 1), m.l - 6, Y(z) + 4); }
  c.textAlign = 'left'; c.fillText('z (mm)', 4, 12);
  c.textAlign = 'right'; c.fillText('x along the blade (mm), metering edge at the right', w - m.r, h - 4);
  // colour bar
  const bx = w - m.r + 18, bw = 12;
  for (let k = 0; k < ph; k++) { c.fillStyle = lutColor(lut, 1 - k / ph); c.fillRect(bx, m.t + k, bw, 1.2); }
  c.strokeRect(bx, m.t, bw, ph);
  c.fillStyle = ink; c.textAlign = 'left';
  c.fillText(c3dFmt(rng.max), bx + bw + 4, m.t + 9); c.fillText(c3dFmt(rng.min), bx + bw + 4, m.t + ph); c.fillText('Pa', bx + bw + 4, m.t + ph / 2 + 4);
}

// ---- the 3D view (three.js) ----
const V3 = { ready: null, renderer: null, scene: null, camera: null, controls: null, group: null, key: null, bounds: null };
function load3DLibs() { if (!V3.ready) V3.ready = loadScript('lib/three.min.js').then(() => loadScript('lib/OrbitControls.js')); return V3.ready; }
function v3Draw(G, R) {
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
  const S = R ? c3dShown() : null;
  const key = JSON.stringify([G.key, C3D.vscale, C3D.blade, C3D.slurry, C3D.web, C3D.mesh, isDarkTheme(), S && S.when, R ? C3D.field : '', FV.cmap, R && C3D.stream ? C3D.streamDensity : '']);
  if (key !== V3.key) { v3Scene(G, R); const firstView = V3.key === null || !V3.sameRegion(G); V3.key = key; V3.region = G.key; if (firstView) v3Camera(); }
  v3Render();
}
V3.sameRegion = G => V3.region && G.key && JSON.parse(V3.region).slice(0, 4).join() === JSON.parse(G.key).slice(0, 4).join();
function v3Render() { if (V3.renderer) V3.renderer.render(V3.scene, V3.camera); }
/** Build the scene from the geometry (and a solved result: its own mesh, coloured by the field): in mm, the heights drawn C3D.vscale times larger. */
function v3Scene(G, R) {
  if (V3.group) { V3.scene.remove(V3.group); V3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  const grp = new THREE.Group(); grp.scale.set(1, C3D.vscale, 1); V3.group = grp; V3.scene.add(grp);
  if (R) { v3SceneSolved(G, R, grp); return; }
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
/** The solved flow: the region's outer faces (the blade's underside, the exit face and the free surface on top; the
 * web below; the strip's two sides; inlet and outlet) coloured by the field at the nodes, the element edges on them. */
function v3SceneSolved(G, R, grp) {
  const NC = R.NC, NR = R.NR, NL = R.NL, N = R.x.length, id = (c, l, k) => (c * NL + l) * NR + k;
  // (the solve's z is from the region's middle: placed where the region is across the web, as the blade is)
  const pos = new Float32Array(3 * N), zo = R.zOff || 0;
  for (let n = 0; n < N; n++) { pos[3 * n] = R.x[n] * 1000; pos[3 * n + 1] = R.y[n] * 1000; pos[3 * n + 2] = (R.z[n] + zo) * 1000; }
  const col = v => new THREE.Color(cssVar(v)), lines = C3D.stream ? v3Streamlines(R) : null, see = C3D.field !== 'none' || !!lines;
  if (C3D.blade && G.tris) {
    const g = new THREE.BufferGeometry(); const mm = Float32Array.from(G.tris, v => v * 1000);
    g.setAttribute('position', new THREE.BufferAttribute(mm, 3)); g.computeVertexNormals();
    const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), G.cutY * 1000 * C3D.vscale);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col('--blade'), roughness: 0.65, metalness: 0.15, side: THREE.DoubleSide, flatShading: true, clippingPlanes: [cut], transparent: see, opacity: see ? 0.22 : 1, depthWrite: !see })));
  }
  const faces = [];   // [a, b, c, d] node quads
  for (let c = 0; c < NC - 1; c++) for (let l = 0; l < NL - 1; l++) { faces.push([id(c, l, NR - 1), id(c + 1, l, NR - 1), id(c + 1, l + 1, NR - 1), id(c, l + 1, NR - 1)]); faces.push([id(c, l, 0), id(c + 1, l, 0), id(c + 1, l + 1, 0), id(c, l + 1, 0)]); }
  for (const l of [0, NL - 1]) for (let c = 0; c < NC - 1; c++) for (let k = 0; k < NR - 1; k++) faces.push([id(c, l, k), id(c + 1, l, k), id(c + 1, l, k + 1), id(c, l, k + 1)]);
  for (const c of [0, NC - 1]) for (let l = 0; l < NL - 1; l++) for (let k = 0; k < NR - 1; k++) faces.push([id(c, l, k), id(c, l + 1, k), id(c, l + 1, k + 1), id(c, l, k + 1)]);
  if (C3D.slurry) {
    const idx = []; for (const [a, b, c, d] of faces) idx.push(a, b, c, a, c, d);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (C3D.field !== 'none') {
      const f = C3D_FIELDS[C3D.field], rng = c3dFieldRange(R), lut = c3dLut(f), cols = new Float32Array(3 * N);
      for (let n = 0; n < N; n++) {
        const t = Math.round(Math.min(1, Math.max(0, (f.f(R, n) - rng.min) / (rng.max - rng.min))) * 255) * 3;
        // (the colour map's own colours, in linear light for three.js)
        const cc = new THREE.Color(`rgb(${lut[t]},${lut[t + 1]},${lut[t + 2]})`);
        cols[3 * n] = cc.r; cols[3 * n + 1] = cc.g; cols[3 * n + 2] = cc.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: !!lines, opacity: lines ? 0.16 : 1, depthWrite: !lines })));
    } else grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x4f8fe8, transparent: true, opacity: lines ? 0.14 : 0.42, side: THREE.DoubleSide, depthWrite: false })));
  }
  if (C3D.mesh) {
    // element edges on the outer faces: every other node line (the elements are 3 nodes a side)
    const li = [], seg = (a, b) => li.push(a, b);
    for (const k of [0, NR - 1]) { for (let c = 0; c < NC; c += 2) for (let l = 0; l < NL - 1; l++) seg(id(c, l, k), id(c, l + 1, k)); for (let l = 0; l < NL; l += 2) for (let c = 0; c < NC - 1; c++) seg(id(c, l, k), id(c + 1, l, k)); }
    for (const l of [0, NL - 1]) { for (let c = 0; c < NC; c += 2) for (let k = 0; k < NR - 1; k++) seg(id(c, l, k), id(c, l, k + 1)); for (let k = 0; k < NR; k += 2) for (let c = 0; c < NC - 1; c++) seg(id(c, l, k), id(c + 1, l, k)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(li);
    grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col('--ink'), transparent: true, opacity: C3D.field !== 'none' ? 0.25 : 0.35 })));
  }
  if (lines) grp.add(v3Tubes(R, lines, pos));
  let xMax = 0, yMax = 0, zMin = Infinity, zMax = -Infinity;
  for (let n = 0; n < N; n++) { xMax = Math.max(xMax, pos[3 * n]); yMax = Math.max(yMax, pos[3 * n + 1]); zMin = Math.min(zMin, pos[3 * n + 2]); zMax = Math.max(zMax, pos[3 * n + 2]); }
  if (C3D.web) {
    const x0 = -2, x1 = xMax + 2, z0 = zMin - 2, z1 = zMax + 2;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, -0.001, (z0 + z1) / 2);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col('--fibre'), roughness: 0.9, side: THREE.DoubleSide })));
  }
  V3.bounds = new THREE.Box3(new THREE.Vector3(-1, 0, zMin), new THREE.Vector3(xMax + 1, Math.min(yMax, G.cutY ? G.cutY * 1000 : yMax) * C3D.vscale, zMax));
}
/** The streamlines of a result (cfd-3d-stream.js), kept for it and the density. */
function v3Streamlines(R) {
  const S = c3dShown(), key = `${S && S.when}|${C3D.streamDensity}`;
  if (V3.sl && V3.sl.key === key) return V3.sl.lines;
  const [across, up] = (C3D_STREAM[C3D.streamDensity] || C3D_STREAM.medium)[R.region === 'full' ? 'full' : 'strip'];
  const lines = streamlines3D(R, { across, up }).lines.filter(l => l.pos.length >= 6);
  V3.sl = { key, lines, up };
  return lines;
}
/** The streamlines as round tubes (in the scene's mm, heights drawn C3D.vscale times larger; the tube's own scale undoes
 *  the group's so its section stays round), coloured along their length by the field shown on the same scale as the faces. */
function v3Tubes(R, lines, pos) {
  const vs = C3D.vscale, zo = R.zOff || 0, NL = R.NL, NR = R.NR, id = (c, l, k) => (c * NL + l) * NR + k;
  let xMax = 0, yMax = 0, zMin = Infinity, zMax = -Infinity, hEdge = Infinity;
  for (let n = 0; n < pos.length / 3; n++) { xMax = Math.max(xMax, pos[3 * n]); yMax = Math.max(yMax, pos[3 * n + 1]); zMin = Math.min(zMin, pos[3 * n + 2]); zMax = Math.max(zMax, pos[3 * n + 2]); }
  for (let l = 0; l < NL; l++) hEdge = Math.min(hEdge, R.y[id(R.cCorner, l, NR - 1)] * 1000 * vs);
  // (thick enough to see, thin enough that neighbours up the gap at the metering edge don't touch)
  const rad = Math.min(0.0035 * Math.hypot(xMax, yMax * vs, zMax - zMin), 0.3 * hEdge / (V3.sl.up || 10)), SEG = 8;
  const f = C3D_FIELDS[C3D.field], showF = C3D.field !== 'none', vals = showF ? new Float64Array(R.x.length) : null;
  if (showF) for (let n = 0; n < vals.length; n++) vals[n] = f.f(R, n);
  const rng = showF ? c3dFieldRange(R) : null, lut = showF ? c3dLut(f) : null, plain = new THREE.Color(cssVar('--ink'));
  const P = [], N = [], Cl = [], I = [];
  for (const ln of lines) {
    // the points drawn: at least a radius apart on screen (the tracing's are much closer)
    const pts = [], cc = ln.cc, p = ln.pos, n = p.length / 3;
    for (let i = 0; i < n; i++) {
      const q = [p[3 * i] * 1000, p[3 * i + 1] * 1000 * vs, (p[3 * i + 2] + zo) * 1000];
      const last = pts[pts.length - 1];
      if (i && i < n - 1 && last && Math.hypot(q[0] - last.q[0], q[1] - last.q[1], q[2] - last.q[2]) < rad) continue;
      pts.push({ q, i });
    }
    if (pts.length < 2) continue;
    let nrm = null;
    const base = P.length / 3;
    pts.forEach(({ q, i }, j) => {
      const a = pts[Math.max(0, j - 1)].q, b = pts[Math.min(pts.length - 1, j + 1)].q;
      const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      // (the ring turned along the line without twisting: the last normal, made square to the new direction)
      if (!nrm) { nrm = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); }
      nrm.sub(t.clone().multiplyScalar(nrm.dot(t))).normalize();
      const bi = new THREE.Vector3().crossVectors(t, nrm);
      let cr = plain;
      if (showF) {
        const v = sample3D(R, vals, cc[3 * i], cc[3 * i + 1], cc[3 * i + 2]);
        const k = Math.round(Math.min(1, Math.max(0, (v - rng.min) / (rng.max - rng.min))) * 255) * 3;
        cr = new THREE.Color(`rgb(${lut[k]},${lut[k + 1]},${lut[k + 2]})`);
      }
      for (let s = 0; s < SEG; s++) {
        const an = 2 * Math.PI * s / SEG, cs = Math.cos(an), sn = Math.sin(an);
        const dx = nrm.x * cs + bi.x * sn, dy = nrm.y * cs + bi.y * sn, dz = nrm.z * cs + bi.z * sn;
        P.push(q[0] + rad * dx, q[1] + rad * dy, q[2] + rad * dz); N.push(dx, dy, dz); Cl.push(cr.r, cr.g, cr.b);
      }
      if (j) for (let s = 0; s < SEG; s++) {
        const a0 = base + (j - 1) * SEG + s, a1 = base + (j - 1) * SEG + (s + 1) % SEG, b0 = a0 + SEG, b1 = a1 + SEG;
        I.push(a0, b0, a1, a1, b0, b1);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cl, 3));
  g.setIndex(I);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }));
  mesh.scale.set(1, 1 / vs, 1);   // (the group draws heights vs times larger; the tubes are in those coordinates already)
  return mesh;
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
