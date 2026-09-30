/*
 * ui-3d.js — Coating › 3D. The blade is made from the 2D setup (its side profile extended across the
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
const C3D_DEFAULTS = { source: 'made', region: 'strip', loc: 0, stripW: 20, units: 'mm', machine: '+x', up: '+z', inlet: 40, fileFace: 'file',
  nxGap: 26, nxFace: 4, nxFilm: 16, ny: 5, nzStrip: 4, nzFull: 30, vscale: 5, view: 'iso', field: 'speed', blade: true, slurry: true, web: true, mesh: true, section: '3d',
  stream: false, streamDensity: 'medium', streamMode: 'volume', streamSeeds: 'inlet', streamPlane: 'yz', streamX: null, streamY: null, streamZ: null, streamN: 9,
  streamPts: '', streamColor: 'field', streamLen: 0, uzView: 'yz', uzX: null, step: null, zZones: null, frac3: null, zFrac: null, zFracFor: null, zoneScale: 1,
  edgeEnd: 'left', edgeW: 15, edgeNz: 8, edgeM: 3, edgeSize: 1, edgeNy: 4, webEdges: 'sym' };
const C3D = JSON.parse(JSON.stringify(C3D_DEFAULTS));
/** An imported blade: { name, kind: 'stl' | 'step', tris: Float32Array (the file's units; STEP: mm), id }. */
let C3D_FILE = null;
let C3D_GEO = null;   // the built geometry, keyed by what it depends on
const C3D_OPEN = { geo: true, region: true, mesh: false };   // the setup's groups open in the inputs bar
let C3D_OCCT = null;  // the STEP reader (occt-import-js), started on first use
/** Undo labels of the settings: [label, format]. */
const C3D_UNDO = {
  source: ['3D geometry', v => v === 'made' ? 'made from the 2D setup' : 'from a file'], region: ['3D region', v => v === 'strip' ? 'strip at a location' : v === 'edge' ? 'strip at a web edge' : 'full web width'],
  edgeEnd: ['3D edge strip at', v => v === 'left' ? 'the left end' : 'the right end'], edgeW: ['3D edge strip width', v => v + ' mm'], edgeNz: ['3D mesh across the edge strip', v => v],
  edgeM: ['3D mesh round the edge', v => v + ' elements'], edgeSize: ['3D mesh round the edge, element size', v => v + ' mm'], edgeNy: ['3D mesh across the gap, the web\'s edges open', v => v], webEdges: ['3D full width: the web\'s edges', v => v === 'open' ? 'open (edge bead)' : 'symmetry planes'],
  loc: ['3D strip location', v => `L${v + 1}`], stripW: ['3D strip width', v => v + ' mm'], units: ['File units', v => v], machine: ['File machine direction', v => v], up: ['File up axis', v => v],
  inlet: ['Inlet upstream of the edge', v => v + ' mm'], fileFace: ['Exit face of the file blade', v => v === 'file' ? 'from the file' : 'straight at the 2D\'s angle'], nxGap: ['3D mesh along the blade', v => v], nxFace: ['3D mesh up the exit face', v => v], nxFilm: ['3D mesh along the free surface', v => v],
  ny: ['3D mesh across the gap', v => v], nzStrip: ['3D mesh across the strip', v => v], nzFull: ['3D mesh across the web', v => v], vscale: ['3D vertical scale', v => '×' + v],
  field: ['3D field shown', v => (C3D_FIELDS[v] || { l: v }).l],
  blade: ['3D view: blade', v => v ? 'on' : 'off'], slurry: ['3D view: slurry', v => v ? 'on' : 'off'], web: ['3D view: web', v => v ? 'on' : 'off'], mesh: ['3D view: mesh', v => v ? 'on' : 'off'],
  stream: ['3D view: streamlines', v => v ? 'on' : 'off'], streamDensity: ['3D streamline density', v => (C3D_STREAM[v] || { l: v }).l.toLowerCase()],
  streamMode: ['3D streamlines', v => (C3D_STREAM_MODES[v] || { l: v }).l], streamSeeds: ['3D streamline seeds', v => (C3D_SEEDS[v] || { l: v }).l], streamPlane: ['3D seed plane', v => v.toUpperCase()],
  streamX: ['3D seeds at x', v => v == null ? 'auto' : v + ' mm'], streamY: ['3D seeds at y', v => v == null ? 'auto' : v + ' mm'], streamZ: ['3D seeds at z', v => v == null ? 'auto' : v + ' mm'],
  streamN: ['3D seeds, how many across', v => v], streamPts: ['3D seed points', v => v ? v.split('\n').filter(Boolean).length + ' points' : 'none'], streamColor: ['3D streamline colour', v => v === 'field' ? 'as the field' : (C3D_FIELDS[v] || { l: v }).l],
  streamLen: ['3D streamline length', v => v ? v + ' mm' : 'to the outlet'], uzView: ['3D cross-web velocity view', v => v === 'yz' ? 'Y–Z' : 'X–Z'], uzX: ['3D cross-web velocity at x', v => v == null ? 'the metering edge' : v + ' mm'],
  zZones: ['3D zones across the web', v => c3dZonesText(v)],
  frac3: ['3D mesh from meshing to an accuracy', v => v ? `adapted, ${v.b.length - 1 + v.s.length - 1} along × ${v.y.length - 1} up` : 'the counts'],
  zFrac: ['3D mesh across, from meshing to an accuracy', v => v ? `${v.length - 1} elements` : 'the counts'],
  zFracFor: ['3D mesh across: the region it was adapted for', v => v || 'none'],
  zoneScale: ['3D: the 2D zones\' sizes', v => v === 1 ? 'as set' : `÷${(+v).toFixed(2)}`],
};
/** The view settings (not part of "unsaved changes"). */
const C3D_DISPLAY = ['view', 'vscale', 'field', 'blade', 'slurry', 'web', 'mesh', 'stream', 'streamDensity', 'step', 'section', 'streamMode', 'streamSeeds', 'streamPlane', 'streamX', 'streamY', 'streamZ',
  'streamN', 'streamPts', 'streamColor', 'streamLen', 'uzView', 'uzX'];
/** Streamline densities: lines [across, up the gap] on a strip and on the full width (the full width is wide and thin). */
const C3D_STREAM = { low: { l: 'Low', strip: [5, 6], full: [10, 3] }, medium: { l: 'Medium', strip: [6, 10], full: [15, 4] }, high: { l: 'High', strip: [10, 12], full: [24, 5] } };
const c3dSetupKey = () => JSON.stringify([Object.keys(C3D_DEFAULTS).filter(k => !C3D_DISPLAY.includes(k)).map(k => C3D[k]), C3D_FILE && C3D_FILE.id]);
const C3D_MESH_LIMITS = { nxGap: [6, 80], nxFace: [1, 12], nxFilm: [6, 60], ny: [2, 10], nzStrip: [1, 8], nzFull: [6, 150], stripW: [2, 300], inlet: [1, 500],
  edgeW: [3, 150], edgeNz: [3, 24], edgeM: [2, 6], edgeSize: [0.2, 10], edgeNy: [2, 10] };
/**
 * The 3D mesh's presets: the element counts each sets, stored here and nowhere else (the Mesh step's Coarse / Medium /
 * Fine; any other counts are Custom, shown as such). Chosen from the solve's cost as c3dEstimate gives it for a 20 mm
 * strip at the app's defaults: Coarse about 110 MB and 20 s, Medium (the defaults) about 690 MB and 2 min, Fine about
 * 1.4 GB and 4.5 min (the matrix in blocks: no 2 GB limit, c3dMemWarn). Every preset has at least 3
 * elements across the strip (7 stations) and across the gap (7 velocity nodes). Medium has 5 across the gap: 4 read the
 * web's wall shear stress about 5 % low at the defaults (the rows thinner toward the blade), 5 within about 1 % (measured,
 * the strip's solve 92 s to 101 s; CFD_PLAN.md) -- the same as Fine (6 across, 1.9 GB, chosen when a page held 2 GB). An edge
 * strip's counts across (edgeNz, edgeM, edgeSize) are its own, not a preset's: its open side makes it the largest solve. So are
 * its rows across the gap wherever the web's edges are open (edgeNy, 4: at 5 an edge strip of 8 across needs 2.45 GB -- chosen
 * when a page held 2 GB; the full width's strips then take the same, its edge strips being its end strips).
 */
const C3D_MESH_PRESETS = {
  coarse: { l: 'Coarse', nxGap: 16, nxFace: 3, nxFilm: 10, ny: 3, nzStrip: 3, nzFull: 20 },
  medium: { l: 'Medium', nxGap: 26, nxFace: 4, nxFilm: 16, ny: 5, nzStrip: 4, nzFull: 30 },
  fine: { l: 'Fine', nxGap: 34, nxFace: 5, nxFilm: 22, ny: 5, nzStrip: 5, nzFull: 40 },
};
const C3D_PRESET_KEYS = ['nxGap', 'nxFace', 'nxFilm', 'ny', 'nzStrip', 'nzFull'];
/** The preset the counts are ('coarse' | 'medium' | 'fine'), or 'custom'. */
const c3dPresetOf = (c = C3D) => Object.keys(C3D_MESH_PRESETS).find(p => C3D_PRESET_KEYS.every(k => C3D_MESH_PRESETS[p][k] === c[k])) || 'custom';
/** Set a preset's counts (one undo step). */
function c3dSetPreset(p) {
  const Q = C3D_MESH_PRESETS[p];
  if (!Q || c3dPresetOf() === p) return;
  undoHint(`3D mesh: ${C3D_MESH_PRESETS[c3dPresetOf()] ? C3D_MESH_PRESETS[c3dPresetOf()].l : 'Custom'} → ${Q.l}`);
  for (const k of C3D_PRESET_KEYS) C3D[k] = Q[k];
  render();
}
/**
 * The solve's size class, from its estimated memory (c3dEstimate): the limits between the classes, bytes. Very large is
 * beyond 2 GB (kept in blocks: the computer's free memory the limit, c3dMemWarn).
 */
const C3D_SIZE_CLASSES = [[250e6, 'Small'], [1e9, 'Medium'], [2e9, 'Large'], [Infinity, 'Very large']];
const c3dSizeClass = bytes => C3D_SIZE_CLASSES.find(([b]) => bytes < b)[1];
/** Settings kept to a tenth, not whole numbers. */
const C3D_TENTHS = ['edgeSize'];
/** Fields the 3D view can colour the flow by: label, unit, value at node n of a result, diverging (signed) or not. */
const C3D_FIELDS = {
  none: { l: 'None' },
  speed: { l: 'Speed', u: 'mm/s', f: (R, n) => Math.hypot(R.u[n], R.v[n], R.w[n]) * 1000 },
  p: { l: 'Pressure', u: 'Pa', f: (R, n) => R.p[n] },
  gd: { l: 'Shear rate', u: '1/s', f: (R, n) => R.gd[n] },
  mu: { l: 'Viscosity', u: 'Pa·s', f: (R, n) => R.mu[n] },
  // (along the web and up in the machine frame -- u_x, u_y)
  ux: { l: 'u_x, along the web', u: 'mm/s', f: (R, n) => (R.skew ? R.u[n] * Math.cos(R.skew * Math.PI / 180) + R.w[n] * Math.sin(R.skew * Math.PI / 180) : R.u[n]) * 1000, div: true },
  uy: { l: 'u_y, up', u: 'mm/s', f: (R, n) => R.v[n] * 1000, div: true },
  // (across the web in the machine frame: a skewed blade's solve is in the blade's frame, w along the blade)
  w: { l: 'Cross-web speed', u: 'mm/s', f: (R, n) => (R.skew ? R.w[n] * Math.cos(R.skew * Math.PI / 180) - R.u[n] * Math.sin(R.skew * Math.PI / 180) : R.w[n]) * 1000, div: true },
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
  // (the full width with its edges open: from one end's outer side to the other's, the edge strips at its ends)
  if (C3D.region === 'full' && C3D.webEdges === 'open') { const z0 = c3dEdgeGeom('left').out / 1000, z1 = c3dEdgeGeom('right').out / 1000; return { z0, z1, zc: (z0 + z1) / 2, nz: C3D.nzFull + 2 * C3D.edgeNz }; }
  if (C3D.region === 'full') return { z0: 0, z1: ACROSS_W / 1000, zc: ACROSS_W / 2000, nz: C3D.nzFull };
  if (C3D.region === 'edge') { const r = c3dEdgeRange(); return { ...r, zc: (r.z0 + r.z1) / 2, nz: C3D.edgeNz }; }
  const zc = CFD_LOCS[C3D.loc].z / 1000, w = C3D.stripW / 1000;
  return { z0: zc - w / 2, z1: zc + w / 2, zc, nz: C3D.nzStrip };
}
/**
 * A web edge (the edge region): the blade's end and the web's edge at the chosen end (mm across the web; the blade's ends
 * from the Across the web design: + overhanging the web's edge, - ending inside it), and the strip's outer side, whichever
 * of the two is further in.
 */
function c3dEdgeGeom(end = C3D.edgeEnd) {
  const left = end === 'left', be = ACR.bladeEnds || { left: 0, right: 0 };
  const bladeEnd = left ? -(be.left || 0) : ACROSS_W + (be.right || 0), webEdge = left ? 0 : ACROSS_W;
  return { left, side: left ? 'lo' : 'hi', bladeEnd, webEdge, out: left ? Math.max(bladeEnd, webEdge) : Math.min(bladeEnd, webEdge) };
}
/** An end's edge strip across the web (m): its outer side and edgeW inward. */
function c3dEdgeRange(end = C3D.edgeEnd) {
  const g = c3dEdgeGeom(end);
  return { z0: (g.left ? g.out : g.out - C3D.edgeW) / 1000, z1: (g.left ? g.out + C3D.edgeW : g.out) / 1000 };
}
/** Whether the solve has an open web edge: the edge strip, or the full width with its edges open. */
const c3dOpenEdges = () => C3D.region === 'edge' || (C3D.region === 'full' && C3D.webEdges === 'open');
/** The rows across the gap the layout and the solve take: where the web's edges are open their own (edgeNy), else the preset's (ny). */
const c3dNy = () => c3dOpenEdges() ? C3D.edgeNy : C3D.ny;
/** The elements round the edge as used (m, their size in mm): at most one fewer than across, no larger than an even element. */
function c3dEdgeElems() {
  const n = C3D.edgeNz, m = Math.min(C3D.edgeM, n - 1), even = C3D.edgeW / n;
  return { m, size: Math.min(C3D.edgeSize, even), set: { m: C3D.edgeM, size: C3D.edgeSize }, cut: m < C3D.edgeM || C3D.edgeSize > even + 1e-9, even };
}
/** The elements round the edge in words (and what was set, when that does not fit). */
function c3dEdgeElemsText() {
  const E = c3dEdgeElems(), f = v => String(+v.toFixed(2));
  return `${E.m} element${E.m === 1 ? '' : 's'} of ${f(E.size)} mm round the edge${E.cut ? ` (set: ${E.set.m} of ${f(E.set.size)} mm; ${E.m < E.set.m ? 'at most one fewer than across' : 'no larger than an even element, ' + f(E.even) + ' mm'})` : ''}`;
}
/** Where an edge strip's inputs are sampled across the web (m): across it and 20 mm on either side (where the slurry may go). */
function c3dEdgeSamples(end = C3D.edgeEnd) {
  const r = c3dEdgeRange(end), zc = (r.z0 + r.z1) / 2, reach = (r.z1 - r.z0) / 2 + 0.02, n = 81;
  return Array.from({ length: n }, (_, k) => zc - reach + 2 * reach * k / (n - 1));
}
/** An end's open side for the solver (m, z from zc): its elements round the edge, the blade's end, the web's edge, the contact angles. */
function c3dEdgeOpen(end, zc) {
  const g = c3dEdgeGeom(end);
  return { side: g.side, m: c3dEdgeElems().m, zEnd: g.bladeEnd / 1000 - zc, zWeb: g.webEdge / 1000 - zc, thWeb: P.thw, thBlade: cfdLocalContactDeg(g.out) };
}
/** The edge strip's element ends across (m, ascending): its elements round the edge at their size, the rest evenly inward. */
function c3dEdgeEnds(end = C3D.edgeEnd) {
  const rg = c3dEdgeRange(end), g = c3dEdgeGeom(end), W = rg.z1 - rg.z0, n = C3D.edgeNz, E = c3dEdgeElems(), m = E.m;
  const e = E.size / 1000, rest = (W - m * e) / (n - m), d = [];
  for (let k = 0; k < n; k++) d.push(k < m ? e : rest);
  const out = [0]; for (const v of d) out.push(out[out.length - 1] + v);
  // (from the outer side inward: the left end's outer side is its low z, the right end's its high z)
  return g.left ? out.map(v => rg.z0 + v) : out.map(v => rg.z1 - v).reverse();
}
// ---- refinement zones across the web: smaller elements at the region's ends, or in bands (z across the web, mm) ----
// (the ends' size: none set = half the evenly spaced element's)
const C3D_ZDEF = { edges: { on: false, size: null }, bands: [], growth: 1.2 };
const c3dEvenSize = () => { const rg = c3dRegion(); return (rg.z1 - rg.z0) * 1000 / rg.nz; };
const c3dEdgeSize = z => z.edges.size ?? +(c3dEvenSize() / 2).toFixed(2);
function c3dZones(z = C3D.zZones) {
  const d = JSON.parse(JSON.stringify(C3D_ZDEF));
  if (!z) return d;
  if (z.edges) d.edges = { ...d.edges, ...z.edges };
  if (z.bands) d.bands = z.bands.map(b => ({ ...b }));
  if (z.growth) d.growth = z.growth;
  return d;
}
const c3dZActive = z => !!z && (z.edges.on || z.bands.length > 0);
function c3dZonesText(v) {
  const z = c3dZones(v), f = x => String(+(+x).toFixed(3));
  if (!c3dZActive(z)) return 'none';
  return [z.edges.on ? `the region's ends ${z.edges.size == null ? 'half an element' : f(z.edges.size) + ' mm'}` : '', ...z.bands.map((b, n) => `band ${n + 1}: z ${f(Math.min(b.z0, b.z1))}–${f(Math.max(b.z0, b.z1))} mm at ${f(b.size)} mm`)].filter(Boolean).join('; ');
}
/**
 * The element ends across the region (m, across the web): evenly spaced by the element count set, or, with
 * zones across the web, no larger than they ask (the region's ends; bands), growing away from them, spread so
 * each element spans the same integral of 1 / size -- never fewer elements than set, at most 24 on a strip
 * and 150 across the web.
 */
/** The region an adapted mesh across belongs to (its ends across are used only there). */
const c3dRegionKey = () => C3D.region === 'full' ? 'full' : C3D.region === 'edge' ? `edge ${C3D.edgeEnd} ${C3D.edgeW} mm` : `strip L${C3D.loc + 1} ${C3D.stripW} mm`;
const c3dZAdapted = () => !!C3D.zFrac && C3D.zFracFor === c3dRegionKey();
function c3dZEnds() {
  if (C3D.region === 'edge') return c3dEdgeEnds();
  // (the full width with its edges open: each end's edge strip as the Edge region lays it out, the set count evenly between)
  if (C3D.region === 'full' && C3D.webEdges === 'open') {
    const L = c3dEdgeEnds('left'), R = c3dEdgeEnds('right'), a = L[L.length - 1], b = R[0], n = C3D.nzFull;
    return [...L, ...Array.from({ length: n - 1 }, (_, k) => a + (b - a) * (k + 1) / n), ...R];
  }
  const rg = c3dRegion();
  if (c3dZAdapted()) return C3D.zFrac.map(f => rg.z0 + f * (rg.z1 - rg.z0));   // (an adapted mesh: its own ends across)
  const n0 = rg.nz, z = c3dZones(), even = Array.from({ length: n0 + 1 }, (_, k) => rg.z0 + (rg.z1 - rg.z0) * k / n0);
  if (!c3dZActive(z)) return even;
  const G = z.growth, grow = (sz, d) => sz + (G - 1) * Math.max(0, d), mm = v => v * 1000;
  const hZ = zm => {
    const zmm = mm(zm);
    let h = Infinity;
    if (z.edges.on) h = Math.min(h, grow(c3dEdgeSize(z), Math.min(zmm - mm(rg.z0), mm(rg.z1) - zmm)));
    for (const b of z.bands) h = Math.min(h, grow(b.size, Math.max(Math.min(b.z0, b.z1) - zmm, zmm - Math.max(b.z0, b.z1))));
    return h / 1000;
  };
  const K = 64, dz = (rg.z1 - rg.z0) / n0, P = [rg.z0], I = [0];
  let tot = 0;
  for (let e = 0; e < n0; e++) for (let k = 1; k <= K; k++) {
    const a = rg.z0 + e * dz + (k - 1) * dz / K, b = rg.z0 + e * dz + k * dz / K;
    tot += 0.5 * (1 / Math.min(dz, hZ(a)) + 1 / Math.min(dz, hZ(b))) * (b - a);
    P.push(b); I.push(tot);
  }
  const n = Math.min(C3D.region === 'strip' ? 24 : 150, Math.max(n0, Math.ceil(tot - 1e-6))), out = [rg.z0];
  for (let k = 1, j = 1; k < n; k++) { const t = tot * k / n; while (j < I.length - 1 && I[j] < t) j++; out.push(P[j - 1] + (t - I[j - 1]) / (I[j] - I[j - 1] || 1) * (P[j] - P[j - 1])); }
  out.push(rg.z1);
  return out;
}
/** Elements across the region: the setting, or with zones across the web, as many as they need. */
const c3dNz = () => c3dZEnds().length - 1;
/** The solve's stations (m, from the region's middle): element ends and middles. */
function c3dStations() {
  const e = c3dZEnds(), zc = (e[0] + e[e.length - 1]) / 2, out = [];
  for (let k = 0; k < e.length - 1; k++) out.push(e[k] - zc, 0.5 * (e[k] + e[k + 1]) - zc);
  out.push(e[e.length - 1] - zc);
  return out;
}
/** The gap at the metering edge at z (m) across the web: the strip's location's own gap there, varied as the shared inputs vary it. */
function c3dGapAt(z) {
  const zmm = z * 1000;
  if (C3D.region === 'strip') { const i = C3D.loc; return (cfdLocalGapMm(zmm) + (locInput(i, 'gap') - cfdLocalGapMm(CFD_LOCS[i].z))) / 1000; }
  return cfdLocalGapMm(zmm) / 1000;
}
/** The film beyond the edge (m) at distance d (m) from it, for the drawing before the 3D is solved: the 1D's film at the
 *  strip's location when solved, else its settled height; until the 1D has solved, half the gap (drawn again when it has). */
function c3dFilm(d) {
  const L = ONE_D.res && ONE_D.res.locs[C3D.region === 'strip' ? C3D.loc : 0], F = L && L.filmToOven;
  if (F && F.x) { const xs = F.x; let k = 1; while (k < xs.length - 1 && xs[k] < d) k++; const t = Math.min(1, Math.max(0, (d - xs[k - 1]) / (xs[k] - xs[k - 1]))); return F.h[k - 1] + t * (F.h[k] - F.h[k - 1]); }
  return L ? L.film : gapHeight() / 2000;
}
/** Build (or reuse) the 3D geometry: the blade's triangles, its underside over the gap, the mesh, and the checks. */
function c3dBuild() {
  const rg = c3dRegion(), g = cfdGeometry(C3D.region === 'strip' ? C3D.loc : 0), H = c3dGapAt(rg.zc);
  const key = JSON.stringify([C3D.source, C3D.region, C3D.loc, C3D.stripW, C3D.units, C3D.machine, C3D.up, C3D.inlet, C3D.nxGap, C3D.nxFilm, c3dNy(), rg, H, C3D.zZones, C3D.frac3, C3D.zFrac,
    g.shape, g.R, g.Xup, g.L, g.exitAngle, P.face, P.dH, P.lw, P.tilt, P.dt, C3D_FILE && C3D_FILE.id, ONE_D.key, g.blade || null, C3D.fileFace]);
  if (C3D_GEO && C3D_GEO.key === key) return C3D_GEO;
  const out = { key, H, rg };
  try {
    let tris, xe;
    if (C3D.source === 'made') {
      // (a shaped blade: its profile at this gap, cfd-blade.js)
      const sp = g.blade ? bladeProfileCached({ ...g.blade, H }) : null;
      const pr = bladeSideOutline({ shape: g.shape, H, R: g.R, Xup: g.Xup, L: g.L, faceDeg: g.exitAngle, faceLen: P.face / 1000, top: 0.02, shaped: sp ? { under: pathPoints(sp.under), face: pathPoints(sp.face) } : null });
      const pad = (rg.z1 - rg.z0) * 0.02 + 1e-4;
      tris = extrudeProfile(pr.pts, rg.z0 - pad, rg.z1 + pad, Math.max(4, rg.nz), z => c3dGapAt(z) - H);
      xe = pr.xe; out.label = `made from the 2D setup (${g.shape === 'round' ? `round entry R ${CFDG.R} mm` : bladeText()}${g.shape === 'custom' ? '' : `, exit face ${g.exitAngle}°`})`;
    } else if (C3D_FILE) {
      const scale = C3D_FILE.kind === 'step' ? 1e-3 : { mm: 1e-3, cm: 1e-2, m: 1, in: 0.0254 }[C3D.units];
      xe = C3D.inlet / 1000;
      tris = placeBlade(orientTris(C3D_FILE.tris, { scale, machine: C3D.machine, up: C3D.up }), { H, xUp: xe, zc: rg.zc }).tris;
      out.label = `${C3D_FILE.name} (${(C3D_FILE.tris.length / 9).toLocaleString()} triangles)`;
    } else { out.empty = true; C3D_GEO = out; return out; }
    const xsGap = C3D.frac3 ? C3D.frac3.b.map(f => f * xe) : gradedStations(0, xe, C3D.nxGap, 1.6);
    const zs = c3dZEnds();   // (evenly spaced, or with the zones across the web)
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
    const xsFilm = C3D.frac3 ? C3D.frac3.s.map(f => xe + f * Ld) : gradedStations(xe, xe + Ld, C3D.nxFilm, 1);
    const film = (x, z) => c3dFilm(x - xe) * (C3D.region === 'full' ? c3dGapAt(z) / H : 1);
    const mesh = mesh3D({ xsGap, xsFilm, zs, under, film, ny: C3D.frac3 ? C3D.frac3.y.length - 1 : c3dNy() });
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
        <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="c3dExport">${uiIco('download')}Save the blade as STL</button></div>` : `
        <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" id="c3dImport">${uiIco('upload')}Import STL or STEP…</button><input type="file" id="c3dFile" accept=".stl,.step,.stp" hidden></div>
        <p class="prop-note">${f ? `<b>${mEsc(f.name)}</b>: ${(f.tris.length / 9).toLocaleString()} triangles, ${f.kind.toUpperCase()}.` : 'No file yet: a blade only (the app adds the web below it at the gap, and the slurry).'}</p>
        ${f && f.kind === 'stl' ? sel('Units in the file', 'units', ['mm', 'cm', 'm', 'in'].map(u => opt(u, u, C3D.units)).join('')) : ''}
        ${sel('Machine direction', 'machine', axes.replace(`value="${C3D.machine}"`, `value="${C3D.machine}" selected`))}
        ${sel('Up', 'up', axes.replace(`value="${C3D.up}"`, `value="${C3D.up}" selected`))}
        ${num('Inlet upstream of the edge', 'inlet', 'mm')}
        <p class="prop-note">The blade's lowest point is put at the gap over the web, at the metering edge; the inlet is this far upstream of it.</p>
        ${seg('Exit face', 'fileFace', [['file', 'From the file'], ['straight', 'Straight']])}
        <p class="prop-note">${C3D.fileFace === 'file' ? 'Each station across the web takes the blade\'s side section there: its underside and its own exit face (a bevel, a radius, corners), the contact line on it as in 2D (the 2D setup\'s contact-line model).' : 'The file gives the underside only; the exit face is straight at the 2D setup\'s angle.'}</p>`}
    </details>
    <details class="grp cfd-grp" data-c3dgrp="region"${C3D_OPEN.region ? ' open' : ''}><summary>3D region</summary>
      ${seg('Across the web', 'region', [['strip', 'Strip'], ['edge', 'Edge'], ['full', 'Full width']])}
      ${C3D.region === 'strip' ? sel('Around', 'loc', CFD_LOCS.map((l, i) => opt(i, `L${i + 1} · z ${l.z} mm`, C3D.loc)).join('')) + num('Strip width', 'stripW', 'mm')
        : C3D.region === 'edge' ? seg('End', 'edgeEnd', [['left', 'Left (z 0)'], ['right', `Right (z ${ACROSS_W})`]]) + num('Strip width', 'edgeW', 'mm') + `<p class="prop-note">${c3dEdgeNote()}</p>`
        : `<p class="prop-note">The full ${ACROSS_W} mm of the web, with the shared inputs (the locations' own inputs are theirs only).</p>` + seg('Web edges', 'webEdges', [['sym', 'Symmetry'], ['open', 'Open (edge bead)']]) + `<p class="prop-note">${C3D.webEdges === 'open' ? 'Each end is first solved as an edge strip (Edge), the bead pressure raised in steps from none; if both hold it, the full width is solved with its edges open, the edge strips its outer strips.' : 'No flow across the web\'s edges: the edge bead is not modelled.'}</p>`}
    </details>
    <details class="grp cfd-grp" data-c3dgrp="mesh"${C3D_OPEN.mesh ? ' open' : ''}><summary>3D mesh</summary>
      ${c3dPresetSeg()}
      ${num('Along the blade', 'nxGap', 'elements')}${num('Up the exit face', 'nxFace', 'elements')}${num('Along the free surface', 'nxFilm', 'elements')}${c3dOpenEdges() ? num('Across the gap (open edges)', 'edgeNy', 'elements') : num('Across the gap', 'ny', 'elements')}
      ${C3D.region === 'strip' ? num('Across the strip', 'nzStrip', 'elements') : C3D.region === 'edge' ? num('Across the strip', 'edgeNz', 'elements') : num('Across the web', 'nzFull', 'elements')}
      ${C3D.region === 'edge' || (C3D.region === 'full' && C3D.webEdges === 'open') ? num('Round the edge', 'edgeM', 'elements') + num('Their size across', 'edgeSize', 'mm', 0.1) : ''}
      <p class="prop-note">Hexahedral, 27 nodes each: each station across the strip is laid out as the 2D lays out its mesh (graded toward the metering edge and the contact line; the free film as long as the 2D's), and the stations joined. ${c3dEstimateText()}</p>
    </details>`);
  document.querySelectorAll('#setupExtra details[data-c3dgrp]').forEach(d => d.addEventListener('toggle', () => { C3D_OPEN[d.dataset.c3dgrp] = d.open; }));
  const ex = document.getElementById('c3dExport');
  if (ex) ex.onclick = () => { const G = c3dBuild(); if (G.tris) saveBlob(new Blob([writeSTL(G.tris.map(v => v * 1000))], { type: 'model/stl' }), 'blade-from-2D-setup-mm.stl'); };
  const imp = document.getElementById('c3dImport'), fi = document.getElementById('c3dFile');
  if (imp) imp.onclick = () => fi.click();
  if (fi) fi.onchange = () => { const file = fi.files && fi.files[0]; if (file) c3dImportFile(file); fi.value = ''; };
}
/** The presets as a segmented control (the inputs bar's 3D mesh group, the Mesh step): Custom is shown, not chosen. */
function c3dPresetSeg(id = '') {
  const cur = c3dPresetOf(), tip = p => { const Q = C3D_MESH_PRESETS[p]; return `${Q.nxGap} along the blade, ${Q.nxFace} up the exit face, ${Q.nxFilm} along the free surface, ${Q.ny} across the gap, ${Q.nzStrip} across a strip, ${Q.nzFull} across the web`; };
  const seg = `<div class="seg${id ? ' seg-full' : ''}" role="tablist" aria-label="3D mesh preset">${Object.entries(C3D_MESH_PRESETS).map(([p, Q]) => `<button type="button" role="tab" data-c3dpreset="${p}" aria-selected="${cur === p}" title="${tip(p)}">${Q.l}</button>`).join('')}<button type="button" role="tab" aria-selected="${cur === 'custom'}" disabled title="Any other counts: set them one by one">Custom</button></div>`;
  // (the Mesh step's side: the control across its width, its label above)
  return id ? `<div class="m3-preset" id="${id}"><p class="m3-sub">Preset</p>${seg}</div>` : `<div class="prop prop-seg"><span class="prop-l">Preset</span>${seg}</div>`;
}
/** What the edge strip is, in words: where it runs, what holds the slurry, the angles. */
function c3dEdgeNote() {
  const g = c3dEdgeGeom(), f = v => String(+v.toFixed(2)), over = g.left ? g.webEdge - g.bladeEnd : g.bladeEnd - g.webEdge;
  const ends = Math.abs(over) < 1e-9 ? 'the blade ends at the web\'s edge' : over > 0 ? `the blade overhangs the web's edge by ${f(over)} mm: the strip starts at the web's edge, the slurry may spill over it` : `the blade ends ${f(-over)} mm inside the web's edge: the strip starts at the blade's end, the slurry may run out onto the web`;
  return `From z ${f(g.out)} mm inward (${ends}; the blade's ends are set in Across the web). Its outer side is open: the slurry's surface round the edge is solved, held there by its viscosity and surface tension alone; its inner side is a symmetry plane. Contact angles: on the blade ${f(cfdLocalContactDeg(g.out))}°, on the web ${f(P.thw)}° (inputs). The bead pressure is raised in steps from none, while the end holds it.`;
}
/** Set a 3D setting (an undo step) and redraw. */
function c3dSet(k, v) {
  undoHint(`${C3D_UNDO[k][0]}: ${C3D_UNDO[k][1](C3D[k])} → ${C3D_UNDO[k][1](v)}`);
  C3D[k] = v; render();
}
document.addEventListener('click', e => {
  const pr = e.target.closest && e.target.closest('[data-c3dpreset]');
  if (pr) { c3dSetPreset(pr.dataset.c3dpreset); return; }
  const b = e.target.closest && e.target.closest('[data-c3dseg]');
  if (b) { const k = b.dataset.c3dseg; if (C3D[k] !== b.dataset.v) c3dSet(k, b.dataset.v); return; }
  const t = e.target.closest && e.target.closest('[data-v3tog]');
  if (t) { const k = t.dataset.v3tog; c3dSet(k, !C3D[k]); return; }
  const v = e.target.closest && e.target.closest('[data-v3view]');
  // (the Mesh step showing a section: a camera view goes back to the 3D view)
  if (v && C3D.section !== '3d' && step3D() === 'mesh') { C3D.view = v.dataset.v3view; C3D.section = '3d'; render(); return; }
  if (v) { C3D.view = v.dataset.v3view; v3Camera(); document.querySelectorAll('[data-v3view]').forEach(x => x.setAttribute('aria-selected', x === v)); }
});
document.addEventListener('change', e => {
  const el = e.target.closest && e.target.closest('[data-c3d]');
  if (!el) return;
  const k = el.dataset.c3d;
  if (el.tagName === 'SELECT') { const v = k === 'loc' || k === 'vscale' ? +el.value : el.value; if (C3D[k] !== v) c3dSet(k, v); return; }
  const [lo, hi] = C3D_MESH_LIMITS[k] || [-Infinity, Infinity], q = C3D_TENTHS.includes(k) ? 10 : 1, v = Math.round(Math.min(hi, Math.max(lo, +el.value || C3D_DEFAULTS[k])) * q) / q;
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
/** The triangles of an STL or STEP file (a Float32Array, 9 numbers per triangle, the file's units; STEP in mm). */
async function c3dReadBladeFile(file) {
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
  return { tris, kind: step ? 'step' : 'stl' };
}
/** Read an STL or STEP file of the blade (the 3D page's blade from then on). */
async function c3dImportFile(file) {
  try {
    const { tris, kind } = await c3dReadBladeFile(file);
    undoHint(`Import 3D blade ${file.name}`);
    c3dFileIn({ name: file.name, kind, tris, id: String(Date.now()) });
    C3D.source = 'file';
    imgToast(`${file.name}: ${(tris.length / 9).toLocaleString()} triangles read.`);
    render();
  } catch (e) { imgToast(`Could not import ${file.name}: ${e.message}`, 'error'); }
}
/** The 3D page's blade file oriented as its settings say (m: machine direction x, up y, across z), or null. */
function c3dOrientedFile() {
  if (!C3D_FILE) return null;
  const scale = C3D_FILE.kind === 'step' ? 1e-3 : { mm: 1e-3, cm: 1e-2, m: 1, in: 0.0254 }[C3D.units];
  return orientTris(C3D_FILE.tris, { scale, machine: C3D.machine, up: C3D.up });
}
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('could not load ' + src)); document.head.appendChild(s); });

// ---- the solve ----
/** The size of the 3D solve for the settings: unknowns, the matrix's memory, and about how long (from measured runs). */
function c3dEstimate(nEz = c3dNz()) {
  const m = c3dCounts(), NR = 2 * m.ny + 1, NL = 2 * nEz + 1, NC = 2 * m.a1 + 1;
  const col = NL * NR * 3 + (NL + 1) / 2 * (NR + 1) / 2 / 2 + NL, ND = NC * col, kl = 3 * col;
  const bytes = ND * 3 * kl * 8, flops = ND * kl * 2 * kl, secs3 = 1.3 * 4 * flops / 2.8e9;
  return { ND, bytes, secs3, secs: secs3 + NL * 1.7, NL };
}
/**
 * Memory. A solve's matrix is kept in blocks (cfd-gap-solver.js's bandAlloc), so the 2 GB one array can have in a browser is no
 * limit; the computer's free memory is. The browser tells this computer's memory in Chrome and Edge only (navigator.deviceMemory,
 * GB, at most 8). A solve above half of it (half of 8 GB when not told) is warned about, not refused; the meshes the app refines by
 * itself (the mesh study, mesh to an accuracy) stop there. A solve that finds too little free stops, and says so.
 */
const C3D_BLOCK_BYTES = 1 << 30;   // (the workers' cfd-gap-solver.js BAND_BLOCK_BYTES: the page does not load that file)
const c3dDeviceGB = () => (typeof navigator !== 'undefined' && navigator.deviceMemory) || null;
const c3dMemWarn = () => (c3dDeviceGB() || 8) / 2 * 1e9;
const c3dMemNote = bytes => `About ${c3dMem(bytes)} for the solve: more than half this computer's memory${c3dDeviceGB() ? ` (the browser reports ${c3dDeviceGB() >= 8 ? 'at least ' : ''}${c3dDeviceGB()} GB)` : ''}. It runs if that much is free; if not, it stops and says so.`;
/** The full width: overlapping strips (elements across each, overlap), their count, the workers solving them at once. */
const C3D_WIDE_CFG = { sub: 2, overlap: 1, maxSweeps: 12, tol: 1e-5 };
function c3dWideLayout(nEz = c3dNz(), nE = C3D.region === 'full' && C3D.webEdges === 'open' ? C3D.edgeNz : 0) {
  const sub = Math.min(C3D_WIDE_CFG.sub, nEz), ov = Math.min(C3D_WIDE_CFG.overlap, sub - 1), step = sub - ov, subs = [];
  // (the web's edges open: its end strips its two edge strips, the others between them overlapping each -- cfd-fem3d.js's wideSubs)
  const a = nE ? nE - ov : 0, b = nE ? nEz - nE + ov : nEz;
  if (nE) subs.push([0, 2 * nE]);
  for (let e0 = a; ; e0 += step) { const e1 = Math.min(b, e0 + sub); subs.push([2 * Math.max(a, e1 - sub), 2 * e1]); if (e1 === b) break; }
  if (nE) subs.push([2 * (nEz - nE), 2 * nEz]);
  const workers = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 1, subs.length));
  return { sub, ov, subs, workers };
}
const c3dTime = secs => secs < 90 ? `${Math.max(5, Math.round(secs / 5) * 5)} s` : `${Math.round(secs / 60)} min`;
const c3dMem = bytes => bytes < 1e9 ? Math.round(bytes / 1e6) + ' MB' : (bytes / 1e9).toFixed(1) + ' GB';
function c3dEstimateText() {
  if (C3D.region === 'full') {
    // (measured: the 2D at each station about 3 s; a strip's first 3D solve as estimated, the later sweeps' about 60 % of it; about 6 sweeps)
    const L = c3dWideLayout(), e = c3dEstimate(L.sub), NL = 2 * c3dNz() + 1, zE = c3dZEnds(), dz = zE.slice(1).map((z, k) => (z - zE[k]) * 500);
    const perColour = Math.ceil(Math.ceil(L.subs.length / 2) / L.workers), eE = C3D.webEdges === 'open' ? c3dEstimate(C3D.edgeNz) : null;
    // (the end strips, as large as the edge strips, in every sweep too)
    const tE = eE ? eE.NL * 1.7 + 3 * eE.secs3 : 0, secs = tE + (NL / L.workers + 4) * 3 + 2 * perColour * e.secs3 * (1 + 0.6 * 5) + (eE ? eE.secs3 * (1 + 0.6 * 5) : 0);
    if (eE) return `Each end first as an edge strip (${C3D.edgeW} mm, the bead pressure raised in steps; both at once: about ${c3dMem(2 * eE.bytes)} and ${c3dTime(tE)}); if both hold the set bead pressure, the width as ${L.subs.length} overlapping strips (the edge strips its end strips, open on their outer sides; ${L.sub} elements across the others), ${L.workers} at a time, sweep after sweep until they agree; stations every ${Math.min(...dz).toFixed(1)} to ${Math.max(...dz).toFixed(1)} mm. About ${c3dMem(Math.max(2 * eE.bytes, L.workers * e.bytes))} and ${c3dTime(secs)} in all.`;
    return `Solved as ${L.subs.length} overlapping strips (${L.sub} elements across each), ${L.workers} at a time, sweep after sweep until they agree; stations every ${Math.min(...dz) === Math.max(...dz) ? (ACROSS_W / (NL - 1)).toFixed(1) : `${Math.min(...dz).toFixed(1)} to ${Math.max(...dz).toFixed(1)}`} mm (variation across the web on a shorter scale is sampled there, not resolved); ${P.skew ? 'the web\'s edges open (each held at its own station\'s flow: the slurry carried along the skewed blade leaves and enters there freely)' : 'the web\'s edges are symmetry planes'}. About ${c3dMem(L.workers * e.bytes)} and ${c3dTime(secs)}.`;
  }
  const e = c3dEstimate();
  // (an edge: a 3D solve for each step of the bead pressure; the first, from the stations' 2D, the longest)
  if (C3D.region === 'edge') return `This mesh: about ${Math.round(e.ND / 1000)} thousand unknowns, ${c3dMem(e.bytes)} for the solve. The 2D at its ${e.NL} stations, then a 3D solve for each step of the bead pressure: the first, with none, about ${c3dTime(e.NL * 1.7 + 3 * e.secs3)}, each later one about ${c3dTime(e.secs3)} (a few steps up to the set pressure; more, halved, where the end stops holding it).${e.bytes > c3dMemWarn() ? ` <b>${c3dMemNote(e.bytes)}</b>` : ''}`;
  return `This mesh: about ${Math.round(e.ND / 1000)} thousand unknowns, ${c3dMem(e.bytes)} for the solve, about ${c3dTime(e.secs)}.${e.bytes > c3dMemWarn() ? ` <b>${c3dMemNote(e.bytes)}</b>` : ''}`;
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
/** The shared inputs (no location's own) at zc (mm; default the web's middle): the full width's reference, an edge strip's. */
function c3dSharedGeometry(zc = ACROSS_W / 2) {
  const geo = cfdGeometry(0), uses = RHEO_MODELS[CFDG.model].uses;
  const U = P.U / 60 * Math.cos(skewRad()), H = cfdLocalGapMm(zc) / 1000, ty = uses.includes('ty') ? P.ty : 0, n = uses.includes('n') ? P.n : 1;
  return { ...geo, z: zc, U, H, contactDeg: cfdLocalContactDeg(zc), Pup: P.Pup * 1000, muRef: P.mu, ty, n, muRep: muLaw(U / H, P.mu, ty, n), gamma: P.g };
}
/** What the worker(s) are sent (file: false leaves out the file's rays, for the key). Strip: around the location; full: the web, stations from its middle. */
function c3dSolveMessage(withFile = true) {
  const full = C3D.region === 'full', edgeR = C3D.region === 'edge', open = full && C3D.webEdges === 'open', i = C3D.loc, rgE = edgeR || open ? c3dRegion() : null;
  const msg = cfdWorkerMessage(full && !open ? c3dSharedGeometry() : rgE ? c3dSharedGeometry(rgE.zc * 1000) : cfdGeometry(i));
  delete msg.struct;   // (the 3D takes the steady flow curve: the structure is the 2D's)
  // (the 3D's own element counts, with the 2D's refinement zones at every station; a location's adapted 2D mesh is its 2D's only)
  const { frac, ...sv } = msg.solver;
  msg.solver = { ...sv, nEb: C3D.nxGap, nEf: C3D.nxFace, nEs: C3D.nxFilm, nEy: c3dNy() };
  // (meshing to an accuracy: the 2D zones' sizes divided (refined everywhere), or the stations' own adapted element ends)
  if (msg.solver.zones && C3D.zoneScale !== 1) msg.solver.zones = scaleZones(msg.solver.zones, C3D.zoneScale);
  if (C3D.frac3) msg.solver.frac = C3D.frac3;
  // (a skewed blade: the web's speed along it, msg.U being its speed across it)
  if (P.skew) { msg.skew = P.skew; msg.webW = msg.U * Math.tan(skewRad()); }
  let strip, W, zc, edge = null;
  if (edgeR) {
    // a web edge: the shared inputs sampled across the strip and on out past its open side (where the slurry may go)
    W = rgE.z1 - rgE.z0; zc = rgE.zc;
    const zs = c3dStations(), g0 = cfdLocalGapMm(zc * 1000), smp = c3dEdgeSamples().map(z => z - zc);
    strip = { width: W, nEz: (zs.length - 1) / 2, zs, gap: smp.map(z => [z, (cfdLocalGapMm((zc + z) * 1000) - g0) / 1000]), th: smp.map(z => [z, cfdLocalContactDeg((zc + z) * 1000)]) };
    edge = c3dEdgeOpen(C3D.edgeEnd, zc);
  } else if (open) {
    // the full width with its edges open: at each end sampled as the Edge region samples it (the same edge), between at the stations
    W = rgE.z1 - rgE.z0; zc = rgE.zc;
    const zs = c3dStations(), g0 = cfdLocalGapMm(zc * 1000), eL = c3dEdgeSamples('left'), eR = c3dEdgeSamples('right');
    const smp = [...eL, ...zs.map(z => z + zc).filter(z => z > eL[eL.length - 1] && z < eR[0]), ...eR].map(z => z - zc);
    strip = { width: W, nEz: (zs.length - 1) / 2, zs, gap: smp.map(z => [z, (cfdLocalGapMm((zc + z) * 1000) - g0) / 1000]), th: smp.map(z => [z, cfdLocalContactDeg((zc + z) * 1000)]) };
    const { side: _l, ...lo } = c3dEdgeOpen('left', zc), { side: _r, ...hi } = c3dEdgeOpen('right', zc);
    msg.open = { nE: C3D.edgeNz, lo, hi };
  } else if (full) {
    W = ACROSS_W / 1000; zc = W / 2;
    const zs = c3dStations(), g0 = cfdLocalGapMm(zc * 1000);
    // (sampled at the stations themselves: the variation between them is not resolved)
    strip = { width: W, nEz: (zs.length - 1) / 2, zs, gap: zs.map(z => [z, (cfdLocalGapMm((zc + z) * 1000) - g0) / 1000]), th: zs.map(z => [z, cfdLocalContactDeg((zc + z) * 1000)]) };
  } else {
    W = C3D.stripW / 1000; zc = CFD_LOCS[i].z / 1000;
    const smp = c3dStripSamples(i, W);
    strip = { width: W, nEz: C3D.nzStrip, gap: smp.gap, th: smp.th };
    // (zones across the strip, or its adapted mesh across: its stations, unevenly spaced)
    if (c3dZActive(c3dZones()) || c3dZAdapted()) { const zs = c3dStations(); strip.nEz = (zs.length - 1) / 2; strip.zs = zs; }
  }
  let file = null;
  if (C3D.source === 'file') {
    const fileKey = [C3D_FILE && C3D_FILE.id, C3D.units, C3D.machine, C3D.up, C3D.inlet, ...(C3D.fileFace === 'file' ? [] : ['straight face'])];
    if (!withFile) return { msg, strip, file: fileKey, edge };
    // the file's underside at the solve's stations across the region and closely along the flow
    const G = c3dBuild(), xe = G.xe, NL = 2 * strip.nEz + 1;
    // (the rays across: evenly spaced, and at the stations themselves when zones space them unevenly)
    const xs = Array.from({ length: 121 }, (_, k) => xe * k / 120), even = Array.from({ length: Math.max(NL, 9) }, (_, k) => -W / 2 + W * k / (Math.max(NL, 9) - 1));
    const zs = strip.zs ? [...new Set([...even, ...strip.zs].map(v => +v.toFixed(12)))].sort((a, b) => a - b) : even;
    const f = undersideField(G.tris, xs.map((x, k) => k === 0 ? x + 1e-7 : k === xs.length - 1 ? x - 1e-7 : x), zs.map(z => z + zc));
    file = { xs, zs, low: Array.from(f.low) };
    // (its exit face from the file: its side section at each station, opened, from the inlet at x = 0)
    if (C3D.fileFace === 'file') file.sections = c3dSections(G.tris, strip.zs || Array.from({ length: NL }, (_, l) => -W / 2 + W * l / (NL - 1)), zc);
  }
  return { msg, strip, file, edge };
}
/**
 * The file blade's side sections at the stations z (m, from the region's centre zc): each opened (inlet, metering
 * point, face; cfd-blade.js's openProfile), cut at the domain's inlet x = 0 (or extended level to it), and the gap
 * at its metering point H. Throws when a station has no blade outline.
 */
function c3dSections(tris, zs, zc) {
  return zs.map(z => {
    const loops = sectionTris(tris, z + zc), o = loops.length ? openProfile(loops[0].verts, loops[0].closed) : null;
    if (!o || o.length < 3) throw new Error(`no blade outline in the file's section at z ${((z + zc) * 1000).toFixed(1)} mm`);
    let v = o.map(q => ({ x: q.x, y: q.y, bulge: q.bulge || 0 }));
    const k = v.findIndex(q => q.x > 0);
    if (k > 0) { const a = v[k - 1], b = v[k], t = (0 - a.x) / (b.x - a.x); v = [{ x: 0, y: a.y + t * (b.y - a.y), bulge: 0 }, ...v.slice(k)]; }
    else if (k === 0 && v[0].x > 1e-9) v = [{ x: 0, y: v[0].y, bulge: 0 }, ...v];
    return { z, verts: v, H: Math.min(...v.map(q => q.y)) };
  });
}
const c3dSolveKey = () => JSON.stringify([C3D.region, C3D.region === 'strip' ? C3D.loc : null, C3D.source, c3dSolveMessage(false)]);
/** The current key for a result's own region and location (a result shown in the table while the page is set to another region). */
function c3dSolveKey3(S) {
  const keep = { region: C3D.region, loc: C3D.loc, edgeEnd: C3D.edgeEnd };
  C3D.region = S.region; if (S.region === 'strip') C3D.loc = S.loc; if (S.region === 'edge') C3D.edgeEnd = S.end;
  try { return c3dSolveKey(); } finally { Object.assign(C3D, keep); }
}
/** The result the page shows: the last solve if it was for this region (this location's strip, this end's edge, or the full width). */
function c3dShown() {
  if (!C3D_RES || C3D_RES.source !== C3D.source || C3D_RES.region !== C3D.region) return null;
  if (C3D.region === 'strip') return C3D_RES.loc === C3D.loc ? C3D_RES : null;
  if (C3D.region === 'edge') return C3D_RES.end === C3D.edgeEnd ? C3D_RES : null;
  return C3D_RES;
}
/** The 3D mesh's own settings (C3D's keys): what "Back to the mesh it was solved on" puts back. */
const C3D_MESH_KEYS = [...C3D_PRESET_KEYS, 'edgeNz', 'edgeM', 'edgeSize', 'edgeNy', 'zZones', 'frac3', 'zFrac', 'zFracFor', 'zoneScale'];
/**
 * The mesh a solve starts on, kept with its result (and so in the project), as a mesh configuration: its type, preset,
 * the global counts along the flow, the gap, the active edge, the meniscus, the upstream bead, across the web, the
 * boundary layers and the thresholds its quality is warned at -- all read from the settings the page keeps (C3D, the 2D's
 * zones), not a second copy of them; and those settings themselves (settings, zones2D), to put the mesh back.
 */
function c3dMeshRecord() {
  const z = zonesOf(solverOf(c3dZoneLoc()).zones), f = k => ({ on: z[k].on, size: z[k].size }), L = k => ({ on: z[k].on, n: z[k].n, first: z[k].first, growth: z[k].growth });
  return { meshType: 'structured hexahedra, 27 nodes (Taylor–Hood Q2–Q1), boundary-fitted on spines', preset: C3D.frac3 ? 'adapted' : c3dPresetOf(),
    global: { alongBlade: C3D.nxGap, upFace: C3D.nxFace, alongFilm: C3D.nxFilm, growth: z.growth }, gap: { cellsAcross: c3dNy() },
    activeEdge: f('edge'), meniscus: { contactLine: f('cl'), exitFace: f('face'), film: f('film') }, upstreamBead: { bands: z.bands },
    crossWeb: { region: C3D.region, cells: c3dNz(), set: c3dRegion().nz, zones: c3dZonesText(C3D.zZones) }, boundaryLayers: { web: L('web'), bladeAndSurface: L('top') },
    quality: { thresholds: { ...M3_WARN }, zoneReach: M3_ZONE_REACH },
    adapted: !!C3D.frac3 || c3dZAdapted(), zones: zonesText(solverOf(c3dZoneLoc()).zones), layers: c3dLayers(),
    settings: JSON.parse(JSON.stringify(Object.fromEntries(C3D_MESH_KEYS.map(k => [k, C3D[k] ?? null])))), zones2D: JSON.parse(JSON.stringify(solverOf(c3dZoneLoc()).zones || null)) };
}
/** Put back the mesh a result was solved on (its 3D settings; the 2D's zones are Coating › 2D's and stay as they are). One undo step. */
function c3dMeshRestore(rec) {
  if (!rec || !rec.settings) return;
  undoHint(`3D: the mesh the result was solved on (${rec.preset === 'adapted' ? 'adapted' : (C3D_MESH_PRESETS[rec.preset] || { l: 'Custom' }).l})`);
  for (const k of C3D_MESH_KEYS) if (k in rec.settings) C3D[k] = JSON.parse(JSON.stringify(rec.settings[k]));
  if (C3D.zoneScale == null) C3D.zoneScale = 1;
  C3D_GEO = null; render();
}
/** The record once solved: when (ISO), and the solved mesh's statistics in brief and its warnings' codes (the full numbers from the mesh itself). */
function c3dMeshDone(rec, R) {
  const out = { ...(rec || {}), when: new Date().toISOString() };
  if (R && R.x) {
    const S = c3dResultStats(R, out.layers).S;
    out.stats = { cells: S.cells, nEx: S.nEx, nEy: S.nEy, nEz: S.nEz, nodes: S.nodes, gapCells: S.gap.cells, qMin: S.q.min, arMax: S.ar.max, skewMax: S.skew.max, nonOrthMax: S.nonOrth.max, invalid: S.invalid, edgeMin: S.edge.min, edgeMax: S.edge.max };
    out.problems = m3Warnings(S, { where: R.region === 'full' ? 'web' : R.region === 'edge' ? 'edge strip' : 'strip' }).map(p => p.code);
  }
  return out;
}
function c3dRun(stay = false) {
  if (C3D_RUN.status === 'running') return;
  if (stay !== true) runFromSolve3D();   // (meshing to an accuracy solves from the Mesh step and stays there)
  const G = c3dBuild();
  const stop = why => { C3D_RUN.status = 'error'; C3D_RUN.error = why; render(); };
  if (G.error || G.empty) return stop(G.error || 'no blade: import an STL or STEP file of the blade');
  if (G.open || G.multi) return stop(G.open ? 'the blade does not cover the region' : 'the blade overhangs: its underside is not a single height over the web');
  // (the full width with its edges open: room for its two edge strips, and in each more elements than those round the edge,
  // where the next strip's side is held)
  if (C3D.region === 'full' && C3D.webEdges === 'open') {
    const rg = c3dRegion();
    if (!((rg.z1 - rg.z0) * 1000 > 2 * C3D.edgeW)) return stop(`the two edge strips (${C3D.edgeW} mm each) do not fit across the ${((rg.z1 - rg.z0) * 1000).toFixed(0)} mm between the blade's ends: narrower edge strips (3D mesh)`);
    if (C3D.edgeNz - c3dEdgeElems().m < 2) return stop(`each edge strip needs at least 2 elements besides the ${c3dEdgeElems().m} round the edge (3D mesh: more across the edge strip, or fewer round the edge)`);
  }
  if (P.skew && c3dOpenEdges()) return stop(`a skewed blade (${P.skew}°) with an open web edge is not modelled: set the skew to 0 (Inputs › Blade), or ${C3D.region === 'edge' ? 'solve a strip or the full width' : 'the web edges to Symmetry'}`);
  const est = c3dEstimate();
  const m = c3dSolveMessage(true), key = c3dSolveKey();
  C3D_RUN.meshRec = c3dMeshRecord();   // (the mesh this solve starts on, kept with its result)
  if (C3D.region === 'full') { c3dRunWide(m, key); return; }
  if (C3D.region === 'edge') { c3dRunEdge(m, key, est); return; }
  const id = ++C3D_RUN.id;
  const w = makeWorker('cfd-3d-worker.js');
  // (the progress bars: the stations' 2D and the 3D solve weighted by their estimated times, as the mesh settings give them)
  Object.assign(C3D_RUN, { worker: w, status: 'running', progress: null, error: null, t0: performance.now(),
    prog: prog3DStrip(est.NL, est.NL * 1.7, est.secs3, m.msg.solver.tol || TOL_DEFAULT), progZ: CFD_LOCS[C3D.loc].z, progName: `strip at L${C3D.loc + 1}` });
  const done = () => { w.terminate(); if (C3D_RUN.worker === w) C3D_RUN.worker = null; };
  w.onmessage = e => {
    if (e.data.id !== id || C3D_RUN.worker !== w) return;
    if (e.data.progress) { C3D_RUN.progress = e.data.progress; prog3DStripFeed(C3D_RUN.prog, e.data.progress); c3dBusy(); return; }
    done();
    const ms = performance.now() - C3D_RUN.t0, r = e.data.ok ? e.data.result : null;
    if (!r) { C3D_RUN.status = 'error'; C3D_RUN.error = e.data.error; }
    else if (!r.converged) { C3D_RUN.status = 'error'; C3D_RUN.error = `the 3D did not converge (residual ${r.residual.toExponential(1)} after ${r.iterations} Newton steps)`; }
    else {
      C3D_RUN.status = 'done';
      r.zOff = CFD_LOCS[C3D.loc].z / 1000; r.skew = m.msg.skew || 0;
      C3D_RES = { key, region: 'strip', loc: C3D.loc, width: C3D.stripW, source: C3D.source, fileName: C3D_FILE && C3D.source === 'file' ? C3D_FILE.name : null, ms, when: Date.now(), result: r };
      C3D_RES.mesh = c3dMeshDone(C3D_RUN.meshRec, C3D_RES.result);
      V3.key = null;
    }
    stepAfterRun3D();
    render();
  };
  w.onerror = e => { if (C3D_RUN.worker !== w) return; done(); C3D_RUN.status = 'error'; C3D_RUN.error = e.message || 'the 3D worker failed'; stepAfterRun3D(); render(); };   // (stopped: ignored)
  w.postMessage({ ...m, id });
  render();
}
/**
 * A web edge: one worker (cfd-3d-worker.js, type 'edge'): the 2D at the strip's stations, then its 3D with the outer side open,
 * the bead pressure raised in steps from none up to the set one while the end holds it (each step reported as it ends).
 */
function c3dRunEdge(m, key, est) {
  const id = ++C3D_RUN.id, w = makeWorker('cfd-3d-worker.js'), tol = m.msg.solver.tol || TOL_DEFAULT, g = c3dEdgeGeom(), end = C3D.edgeEnd, rg = c3dRegion();
  Object.assign(C3D_RUN, { worker: w, status: 'running', progress: null, error: null, t0: performance.now(), steps: [],
    prog: prog3DEdge(est.NL, est.NL * 1.7, 3 * est.secs3, tol, m.msg.Pup), progZ: rg.zc * 1000, progName: `edge at the ${end} end` });
  const done = () => { w.terminate(); if (C3D_RUN.worker === w) C3D_RUN.worker = null; };
  w.onmessage = e => {
    if (e.data.id !== id || C3D_RUN.worker !== w) return;
    if (e.data.step) { C3D_RUN.steps.push(e.data.step); prog3DEdgeStep(C3D_RUN.prog, e.data.step); c3dBusy(); return; }
    if (e.data.progress) { C3D_RUN.progress = e.data.progress; prog3DEdgeFeed(C3D_RUN.prog, e.data.progress); c3dBusy(); return; }
    done();
    const ms = performance.now() - C3D_RUN.t0, r = e.data.ok ? e.data.result : null;
    if (!r) { C3D_RUN.status = 'error'; C3D_RUN.error = e.data.error; }
    else {
      C3D_RUN.status = 'done';
      Object.assign(r, { zOff: rg.zc, skew: 0, edgeGeom: g, thBlade: m.edge.thBlade, thWeb: m.edge.thWeb });
      C3D_RES = { key, region: 'edge', end, loc: null, width: C3D.edgeW, source: C3D.source, fileName: C3D_FILE && C3D.source === 'file' ? C3D_FILE.name : null, ms, when: Date.now(), result: r };
      C3D_RES.mesh = c3dMeshDone(C3D_RUN.meshRec, C3D_RES.result);
      V3.key = null;
    }
    stepAfterRun3D();
    render();
  };
  w.onerror = e => { if (C3D_RUN.worker !== w) return; done(); C3D_RUN.status = 'error'; C3D_RUN.error = e.message || 'the 3D worker failed'; stepAfterRun3D(); render(); };   // (stopped: ignored)
  w.postMessage({ type: 'edge', ...m, id });
  render();
}
function c3dStop() {
  if (C3D_RUN.status !== 'running') return;
  if (C3D_RUN.worker) C3D_RUN.worker.terminate();
  for (const w of C3D_RUN.workers || []) w.terminate();
  Object.assign(C3D_RUN, { worker: null, workers: [], status: 'cancelled', progress: null, stepAuto: false });
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
  const { msg, strip, file } = m, NL = 2 * strip.nEz + 1, zs = strip.zs, mid = (NL - 1) >> 1, L = c3dWideLayout(strip.nEz), subs = L.subs, P = Math.max(L.workers, msg.open ? 2 : 1), open = !!msg.webW;
  const run = ++C3D_RUN.id, workers = Array.from({ length: P }, () => makeWorker('cfd-3d-worker.js'));
  // (the progress bars: the stations' 2D, then the sweeps, weighted by their estimated times as the mesh settings give them;
  // the web's edges open: each end first as an edge strip, both at once)
  const e3 = c3dEstimate(L.sub), perColour = Math.ceil(Math.ceil(subs.length / 2) / P), tol = msg.solver.tol || TOL_DEFAULT, rg = c3dRegion();
  const eE = msg.open ? c3dEstimate(C3D.edgeNz) : null;
  const prog = prog3DWide({ n2: 0, nStrips: subs.length, t2: (NL / P + 4) * 3, ts1: 2 * perColour * e3.secs3 + (eE ? eE.secs3 : 0), ts: 0.6 * (2 * perColour * e3.secs3 + (eE ? eE.secs3 : 0)), tolSweep: C3D_WIDE_CFG.tol, maxSweeps: C3D_WIDE_CFG.maxSweeps, tol,
    ...(eE ? { te: eE.NL * 1.7 + 3 * eE.secs3, phase: 'edges', fe: 0, edges: {} } : {}) });
  Object.assign(C3D_RUN, { worker: null, workers, status: 'running', progress: { stage: 'starting' }, error: null, t0: performance.now(), prog, progZ: rg.zc * 1000, progName: msg.open ? 'full width, its edges open' : 'full width' });
  const alive = () => C3D_RUN.id === run && C3D_RUN.status === 'running';
  const stage = t => { C3D_RUN.progress = { ...(C3D_RUN.progress || {}), stage: t }; c3dBusy(); };
  // a worker's station (its 2D) or strip (its 3D Newton solve): started, progressing, finished
  const track = (ctx, q) => {
    if (ctx.station != null) {
      const st = q && q.stage || '';
      // (named with its solver: a station can be solved by two at once, and the middle one by each)
      if (/^2D at /.test(st)) { if (prog.stations.has(ctx.station)) prog.done2++; prog.stations.set(ctx.station, progStation(tol, `${c3dStationName(st)} (solver ${ctx.station + 1} of ${P})`)); }
      const S = prog.stations.get(ctx.station);
      if (q && S) progStationFeed(S, q);
      if (!q && S) { prog.done2++; prog.stations.delete(ctx.station); }
    } else if (q) progSolveFeed(prog.strips.get(ctx.strip), q);
    else { prog.strips.delete(ctx.strip); prog.doneS++; }
    prog3DWideShare(prog);
  };
  let seq = 0;
  const call = (w, data, ctx) => new Promise((res, rej) => {
    const id = ++seq;
    const on = e => {
      if (e.data.id !== id) return;
      // (an edge strip: its steps of the bead pressure, and its own bars)
      if (e.data.step) { if (ctx && ctx.edge) { ctx.steps.push(e.data.step); prog3DEdgeStep(ctx.edge, e.data.step); c3dEdgesShare(); c3dBusy(); } return; }
      if (e.data.progress && ctx && ctx.edge) { prog3DEdgeFeed(ctx.edge, e.data.progress); c3dEdgesShare(); c3dBusy(); return; }
      if (e.data.progress) {
        const q = e.data.progress;
        if (ctx) track(ctx, q);
        if (Number.isFinite(q.residual)) C3D_RUN.progress = { ...C3D_RUN.progress, it: q.it, residual: q.residual };
        if (q.stage && /^2D at /.test(q.stage)) C3D_RUN.progress = { ...C3D_RUN.progress, detail: q.stage.replace(/ \(gap.*$/, '') };   // (a worker's station, while the 2D runs)
        return;
      }
      w.removeEventListener('message', on);
      if (e.data.ok && ctx && !ctx.edge) track(ctx, null);
      if (e.data.ok) res(e.data.result); else rej(new Error(e.data.error));
    };
    w.addEventListener('message', on);
    w.onerror = ev => rej(new Error(ev.message || 'the 3D worker failed'));
    w.postMessage({ ...data, id });
  });
  const c3dEdgesShare = () => { const E = Object.values(prog.edges || {}); prog.fe = E.length ? E.reduce((a, q) => a + q.share, 0) / 2 : 0; prog3DWideShare(prog); };
  render();
  try {
    // the web's edges open: each end first as the Edge region solves it (its bead pressure in steps); the region only if both hold
    let edgeRes = null;
    if (msg.open) {
      stage('each end first as an edge strip');
      const ends = ['left', 'right'], ems = ends.map(end => c3dEdgeMessage(end));
      const out = await Promise.all(ends.map((end, k) => {
        const em = ems[k], ctx = { edge: prog3DEdge(em.strip.zs.length, em.strip.zs.length * 1.7, 3 * eE.secs3, tol, em.msg.Pup), steps: [] };
        prog.edges[end] = ctx.edge;
        return call(workers[k % P], { type: 'edge', ...em, keep: true }, ctx).then(r => Object.assign(r, { zOff: em.zc, skew: 0, edgeGeom: c3dEdgeGeom(end), thBlade: em.edge.thBlade, thWeb: em.edge.thWeb, zc: em.zc }));
      }));
      if (!alive()) return;
      edgeRes = { left: out[0], right: out[1] };
      prog.phase = null; prog3DWideShare(prog);
      if (!edgeRes.left.held || !edgeRes.right.held) {
        // (an end that does not hold the set bead pressure: the width is not solved, each end shown at the most it holds)
        for (const r of out) delete r.state;
        const ms = performance.now() - C3D_RUN.t0;
        C3D_RES = { key, region: 'full', loc: null, width: ACROSS_W, source: C3D.source, fileName: C3D_FILE && C3D.source === 'file' ? C3D_FILE.name : null, ms, when: Date.now(),
          result: { region: 'full', openEdges: true, held: false, edges: edgeRes, Pset: msg.Pup, zOff: rg.zc } };
        C3D_RES.mesh = c3dMeshDone(C3D_RUN.meshRec, null);
        V3.key = null;
        C3D_RUN.status = 'done';
        return;
      }
    }
    const owner = i => Math.min(P - 1, Math.floor(i * P / subs.length)), mine = workers.map(() => new Set());
    subs.forEach(([l0, l1], i) => { for (let l = l0; l <= l1; l++) mine[owner(i)].add(l); });
    prog.n2 = mine.reduce((n, s) => n + s.size + (s.has(mid) ? 0 : 1), 0);   // (each worker solves the middle station too)
    stage(`2D at the ${NL} stations across the web`);
    const inits = await Promise.all(workers.map((w, k) => call(w, { type: 'wideInit', msg, strip, file, zs, ref: mid, stations: [...mine[k]] }, { station: k })));
    const meta = inits[0], state = new Array(NL), film2 = [], s2 = [], full2 = [];
    let top2 = null;
    inits.forEach(r => {
      for (const l in r.states) { state[l] = r.states[l]; full2[l] = r.full2[l]; }
      for (const l in r.film2) { film2[l] = r.film2[l]; s2[l] = r.s2[l]; }
      if (r.top2[mid]) top2 = r.top2[mid];
    });
    const filmOf = T => T.y ? T.y[(meta.NC - 1) * meta.NR + meta.NR - 1] : null;
    prog.H = meta.H;
    const history = [], openOut = {};
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
            // (a skewed blade: the web's edges held at their own stations' flow too, the slurry leaving and entering freely)
            prog.strips.set(i, progSolve(tol, `Strip ${i + 1} of ${subs.length}`));
            // (the web's edges open: the end strips open on their outer sides, the first sweep from their edge strips' solutions)
            const os = msg.open ? (i === 0 ? 'lo' : i === subs.length - 1 ? 'hi' : null) : null, eR = os && edgeRes[os === 'lo' ? 'left' : 'right'];
            const r = await call(w, { type: 'wideSolve', l0, l1, states, sideLo: (l0 > 0 || open) && os !== 'lo', sideHi: (l1 < NL - 1 || open) && os !== 'hi',
              ...(os ? { open: { [os]: msg.open[os] }, init: sweeps === 0 && eR.state ? { ...eR.state, zOff: eR.zc - rg.zc } : null } : {}) }, { strip: i });
            unknowns = Math.max(unknowns, r.unknowns);
            if (os) {
              openOut[os] = r.open;
              if (r.open.climb || r.open.spill) throw new Error(`the ${os === 'lo' ? 'left' : 'right'} end lets go with the width solved (sweep ${sweeps + 1}): ${r.open.climb ? 'the slurry would climb the blade\'s end face' : 'it would spill over the web\'s edge'}, though on its own it held the bead pressure`);
            }
            for (const l in r.states) {
              const T = r.states[l], old = state[l], f0 = filmOf(old), f1 = filmOf(T);
              change = Math.max(change, f0 == null ? Infinity : Math.abs(f1 - f0) / meta.H, meta.climbed ? Math.abs(T.s - old.s) / meta.H : 0);
              state[l] = T;
            }
          }
        }));
      }
      history.push(change);
      prog.hist.push(change); prog.sweep++; prog.doneS = 0; prog3DWideShare(prog);
      if (change < C3D_WIDE_CFG.tol) converged = true;
    }
    if (!alive()) return;
    if (!converged) throw new Error(`the strips did not agree after ${sweeps} sweeps (last change ${(history[history.length - 1] * meta.H * 1e6).toFixed(3)} µm)`);
    // the result, as a strip's: node arrays over every station, the stations, the middle's pressure along the top
    const NC = meta.NC, NR = meta.NR, N = NC * NL * NR, R = { region: 'full', skew: msg.skew || 0, mode: meta.mode, k: meta.k ?? null, converged: true, sweeps, history, iterations: sweeps, NC, NR, NL, cCorner: meta.cCorner, cCL: meta.cCL, xe: meta.xe, H: meta.H, frac: meta.frac,
      zOff: rg.zc, size: { unknowns, strips: subs.length, workers: P } };
    // (the web's edges open: both ends held the bead pressure; the surface round each edge from the width's own end strips)
    if (msg.open) {
      for (const r of Object.values(edgeRes)) delete r.state;
      Object.assign(R, { openEdges: true, held: true, edges: edgeRes, Pset: msg.Pup, open: openOut, thWeb: msg.open.lo.thWeb, edgeM: msg.open.lo.m });
    }
    for (const f of ['x', 'y', 'z', 'u', 'v', 'w', 'p', 'gd', 'mu']) R[f] = new Float32Array(N);
    for (let l = 0; l < NL; l++) if (!state[l].x) state[l] = { ...state[l], ...full2[l] };   // (a web edge held at its own station's flow)
    for (let l = 0; l < NL; l++) for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) {
      const n3 = (c * NL + l) * NR + k, n2 = c * NR + k;
      for (const f of ['x', 'y', 'z', 'u', 'v', 'w', 'p', 'gd', 'mu']) R[f][n3] = state[l][f][n2];
    }
    R.stations = zs.map((z, l) => ({ z, dH: 0, film: filmOf(state[l]), q: state[l].q, s: meta.climbed || meta.k ? state[l].s : 0, film2: film2[l], s2: s2[l] }));
    const T = state[mid];
    R.top = { x: [], y: [], p3: [], p2: [] };
    for (let c = 0; c < NC; c++) { const n2 = c * NR + NR - 1; R.top.x.push(T.x[n2]); R.top.y.push(T.y[n2]); R.top.p3.push(T.p[n2]); R.top.p2.push(top2 ? top2[c] : NaN); }
    const ms = performance.now() - C3D_RUN.t0;
    C3D_RES = { key, region: 'full', loc: null, width: ACROSS_W, source: C3D.source, fileName: C3D_FILE && C3D.source === 'file' ? C3D_FILE.name : null, ms, when: Date.now(), result: R };
    C3D_RES.mesh = c3dMeshDone(C3D_RUN.meshRec, C3D_RES.result);
    V3.key = null;
    C3D_RUN.status = 'done';
  } catch (e) {
    if (C3D_RUN.id === run && C3D_RUN.status === 'running') { C3D_RUN.status = 'error'; C3D_RUN.error = e.message; }
  } finally {
    for (const w of workers) w.terminate();
    if (C3D_RUN.id === run) C3D_RUN.workers = [];
    if (C3D_RUN.id === run) { stepAfterRun3D(); render(); }
  }
}
/** The Edge region's own message for one end (the full width with its edges open solves each end first as it does). */
function c3dEdgeMessage(end) {
  const keep = { region: C3D.region, edgeEnd: C3D.edgeEnd };
  C3D.region = 'edge'; C3D.edgeEnd = end;
  try { const m = c3dSolveMessage(true); m.zc = c3dRegion().zc; return m; } finally { Object.assign(C3D, keep); }
}
/** The station a progress message's stage names ("2D at X mm", X from the region's middle), by its place across the web. */
function c3dStationName(stage) {
  const m = /^2D at (-?[\d.]+) mm/.exec(stage || '');
  return m ? `Station at z ${(C3D_RUN.progZ + +m[1]).toFixed(1)} mm` : 'Station';
}
/** While the 3D solves: a bar for the whole solve and one for each station or strip being solved (≈, cfd-progress.js). */
function c3dProgCard() {
  const P = C3D_RUN.prog;
  if (C3D_RUN.status !== 'running' || !P) return '';
  const nt = (it, res) => it ? `Newton step ${it}${Number.isFinite(res) ? `, residual ${res.toExponential(0)}` : ''}` : 'starting';
  const station = (S, name) => progBar(name, S.P.share, S.pr ? `the 2D: ${cfdStageText(S.pr.stage)}${S.P.it ? ' · ' + nt(S.P.it, S.pr.residual) : ''}` : 'the 2D: starting');
  const title = `Solving the 3D (${C3D_RUN.progName})`;
  let rows;
  if (P.stations && P.phase === 'edges') {   // (the full width with its edges open: each end first as an edge strip)
    const edge = (E, name) => progBar(name, E.share, E.solve3 ? `the bead pressure at ${E.pAt} Pa (of ${E.Pset} Pa set; held so far: ${E.pOk == null ? 'none yet' : E.pOk + ' Pa'})${E.solve3.it ? ' · ' + nt(E.solve3.it, E.solve3.res) : ''}` : `the 2D at its stations: ${Math.max(0, E.n2 - 1)} of ${E.NL} done`);
    rows = [progBar(title, P.share, 'each end first as an edge strip (the width is solved only if both hold the bead pressure)'), ...Object.entries(P.edges).map(([end, E]) => edge(E, `The ${end} end`))];
  } else if (P.stations) {   // (the full width: its stations, then its sweeps, several strips at once)
    const sweeping = P.sweep > 0 || P.doneS > 0 || P.strips.size > 0, last = P.hist.filter(Number.isFinite).pop();
    rows = [progBar(title, P.share, sweeping ? `sweep ${P.sweep + 1} of about ${P.E}${last != null && P.H ? ` (the strips agree to ${(last * P.H * 1e6).toFixed(3)} µm so far)` : ''}` : `the 2D at the stations: ${P.done2} of ${P.n2} done`)];
    if (sweeping) rows.push(...[...P.strips.entries()].sort((a, b) => a[0] - b[0]).map(([, S]) => progBar(S.name, S.f, nt(S.it, S.res))));
    else rows.push(...[...P.stations.values()].map(S => station(S, S.name)));
  } else if (P.Pset != null) {   // (a web edge: its stations' 2D, then a 3D solve for each step of the bead pressure)
    rows = [progBar(title, P.share, P.solve3 ? `the bead pressure at ${P.pAt} Pa (of ${P.Pset} Pa set; held so far: ${P.pOk == null ? 'none yet' : P.pOk + ' Pa'})` : `the 2D at the stations: ${Math.max(0, P.n2 - 1)} of ${P.NL} done`)];
    if (P.solve3) rows.push(progBar(`The 3D Newton solve at ${P.pAt} Pa`, P.solve3.f, nt(P.solve3.it, P.solve3.res)));
    else if (P.station) rows.push(station(P.station, c3dStationName(P.at)));
  } else {            // (a strip: its stations' 2D, then its 3D solve)
    rows = [progBar(title, P.share, P.solve3 ? 'the 3D Newton solve (the stations\' 2D done)' : `the 2D at the stations: ${Math.max(0, P.n2 - 1)} of ${P.NL} done`)];
    if (P.solve3) rows.push(progBar('The 3D Newton solve', P.solve3.f, nt(P.solve3.it, P.solve3.res)));
    else if (P.station) rows.push(station(P.station, c3dStationName(P.at)));
  }
  return `<div class="prog-card" role="group" aria-label="3D solve progress">${rows.join('')}</div>`;
}
/** The 3D solve's share done (≈), or null when none is running (the status bar). */
const c3dProgShare = () => C3D_RUN.status === 'running' && C3D_RUN.prog ? C3D_RUN.prog.share : null;
/** While solving: the progress bars, the stage and the latest Newton residual in the verdict (no full redraw); the status bar's bar. */
function c3dBusy() {
  renderSbProg();
  const pg = document.getElementById('c3dProg');
  if (pg) pg.innerHTML = c3dProgCard();
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
  const stp = step3D();
  // (an edge that held nothing: its answer and steps, no flow to draw)
  // (the full width with its edges open: both ends' answers and views; the width's own flow only when both held)
  const S = c3dShown(), E3 = S && S.result.region === 'edge' ? S.result : null, FO = S && S.result.openEdges ? S.result : null;
  const R0 = S && (!E3 || E3.valid) && (!FO || FO.held) ? S.result : null, stale = S && S.key !== c3dSolveKey3(S), running = C3D_RUN.status === 'running';
  const R = stp === 'results' ? R0 : null;   // (the flow is drawn on Results; Geometry and Mesh show the blade and the mesh)
  const fld = C3D_FIELDS[C3D.field] || C3D_FIELDS.speed, showField = R && C3D.field !== 'none';
  const range = showField ? c3dFieldRange(R) : null;
  const pane = (id, icon, title, aria, legend = '') => `<figure class="pane"><figcaption>${uiBadge(icon)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas>${legend ? `<div class="pane-legend">${legend}</div>` : ''}</figure>`;
  const acc = cssVar('--accent'), mut = cssVar('--muted');
  const where = R && R.region === 'full' ? 'web' : R && R.region === 'edge' ? 'edge strip' : 'strip';
  const charts = R ? `<div class="v3d-charts">
      ${R.region === 'edge' ? '' : pane('c3dFilm', 'film', `Wet film across the ${where}${R.openEdges ? ', out over the edge beads (at the end of the film)' : ''}${stale ? ' (out of date)' : ''}`, `Wet film thickness across the ${where}, 3D and 2D`, oneDLegend([['3D', acc], ['2D at each station', mut, 'dash']]))}
      ${pane('c3dCL', 1, `Contact line up the exit face across the ${where}`, `Contact line height up the exit face across the ${where}${R.region === 'edge' ? '' : ', 3D and 2D'}`, R.region === 'edge' ? '' : oneDLegend([['3D', acc], ['2D at each station', mut, 'dash']]))}
      ${pane('c3dPB', 'pressure', 'Pressure on the blade', `Pressure on the blade underside, along the flow and across the ${where}`, '')}
      ${pane('c3dPX', 'pressure', `Pressure along the blade, ${R.region === 'edge' ? 'the edge strip\'s inner side' : `middle of the ${where}`}`, `Pressure along the blade and exit face at the ${R.region === 'edge' ? 'inner side' : 'middle'} of the ${where}${R.region === 'edge' ? '' : ', 3D and 2D'}`, R.region === 'edge' ? '' : oneDLegend([['3D', acc], ['2D', mut, 'dash']]))}
      ${c3dCrossFlowPane(R, stale, where)}
      ${c3dUzPane(R, stale)}
    </div>` : '';
  // (the Mesh step's sections through the mesh, instead of the 3D view: display only)
  const secOn = stp === 'mesh' && C3D.section !== '3d' && C3D_SECTIONS.some(q => q[0] === C3D.section), secT = secOn ? C3D_SECTIONS.find(q => q[0] === C3D.section) : null;
  const viewSeg = `<div class="seg" role="tablist" aria-label="View">${views.map(([v, t]) => `<button type="button" role="tab" data-v3view="${v}" aria-selected="${C3D.view === v}">${t}</button>`).join('')}</div>`;
  const vscale = `<select data-c3d="vscale" aria-label="Vertical scale" title="Heights drawn this many times larger (the gap is thin)">${[1, 2, 5, 10, 20, 50].map(v => `<option value="${v}"${v === C3D.vscale ? ' selected' : ''}>Height ×${v}</option>`).join('')}</select>`;
  const tools = {
    geometry: `${viewSeg}${tog('blade', 'Blade')}${tog('slurry', 'Slurry')}${tog('web', 'Web')}${vscale}`,
    mesh: `<div class="seg" role="tablist" aria-label="View">${views.map(([v, t]) => `<button type="button" role="tab" data-v3view="${v}" aria-selected="${!secOn && C3D.view === v}">${t}</button>`).join('')}</div>
      <span class="tb-lbl">Sections</span><div class="seg" role="tablist" aria-label="Mesh sections">${C3D_SECTIONS.filter(q => q[0] !== '3d').map(([v, t, tip]) => `<button type="button" role="tab" data-c3dsec="${v}" aria-selected="${C3D.section === v}" title="${tip}">${t}</button>`).join('')}</div>${secOn ? '' : `${tog('blade', 'Blade')}${vscale}`}`,
    solve: running ? `<button type="button" class="btn btn-secondary btn-sm" id="c3dStop">${uiIco('stop')}Stop</button>` : `<button type="button" class="btn btn-primary btn-sm" id="c3dRun">${uiIco('play')}Solve 3D</button>`,
    results: `${viewSeg}
      <label class="fv-chk">Field <select data-c3d="field"${R ? '' : ' disabled title="Solve first"'}>${Object.entries(C3D_FIELDS).map(([k, f]) => `<option value="${k}"${k === C3D.field ? ' selected' : ''}>${f.l}</option>`).join('')}</select></label>
      ${tog('blade', 'Blade')}${tog('slurry', 'Slurry')}${tog('web', 'Web')}${tog('mesh', 'Mesh')}
      <label class="fv-chk"${R ? '' : ' title="Solve first"'}><input type="checkbox" data-v3tog="stream"${C3D.stream ? ' checked' : ''}${R ? '' : ' disabled'}> Streamlines</label>
      ${R && C3D.stream ? `<select data-c3d="streamDensity" aria-label="Streamline density" title="How many streamlines">${Object.entries(C3D_STREAM).map(([k, d]) => `<option value="${k}"${k === C3D.streamDensity ? ' selected' : ''}>${d.l}</option>`).join('')}</select>` : ''}
      ${vscale}`,
  }[stp];
  const fig = `<figure class="pane v3d"><figcaption>${uiBadge(9)}${R ? `The flow in 3D${showField ? `, coloured by ${fld.l.toLowerCase()} (${c3dFmt(range.min)} to ${c3dFmt(range.max)} ${fld.u})` : ''}` : stp === 'mesh' ? `The 3D mesh${c3dSolvedMesh() ? ' as solved' : ''}${secOn ? ` — ${secT[1]}` : ''}` : 'The blade over the web and the slurry region'}${C3D.region === 'strip' ? `, strip at L${C3D.loc + 1}` : C3D.region === 'edge' ? `, edge strip at the ${C3D.edgeEnd} end` : ', full web width'}${R && stale ? ' — out of date' : ''}</figcaption>
      ${secOn ? `<div class="v3d-host m3-sec" id="c3dSecHost"><canvas id="c3dSec" role="img" aria-label="The mesh: ${secT[2]}"></canvas><div class="m3-sec-read" id="c3dSecRead" aria-live="off"></div></div>`
        : '<div class="v3d-host" id="v3dHost"><p class="v3d-msg">Loading the 3D view…</p></div>'}
      ${showField ? `<div class="v3d-bar"><span>${c3dFmt(range.min)}</span><i style="background:${c3dGradientCss(fld)}"></i><span>${c3dFmt(range.max)} ${fld.u}</span></div>` : ''}
      ${secOn ? `<div class="pane-legend"><span>${secT[2]}</span><span id="c3dSecK"></span><span>The elements' edges through their middle nodes; the metering edge and the contact line marked</span><span>Point at the section for the position</span></div></figure>` : `<div class="pane-legend"><span>x: machine direction →</span><span>y: up from the web (drawn ×${C3D.vscale})</span><span>z: across the web</span><span>Blade cut off just above the slurry</span>${R ? '<span>Mesh: as solved</span>' : ''}${(R0 ? R0.skew : P.skew) ? `<span>Blade skewed ${(R0 ? R0.skew : P.skew).toFixed(1)}° (drawn in the machine frame; the web runs along x)</span>` : ''}${R && C3D.stream ? `<span>Streamlines: from the inlet, spaced by equal flow up the gap${showField ? ', coloured by ' + fld.l.toLowerCase() : ''}${R.skew ? '; a line that leaves through the region\'s open side ends there' : ''}</span>` : ''}<span>Drag to turn, wheel to zoom, right-drag to pan</span></div></figure>`}`;
  const extra = {
    geometry: fig,
    mesh: `<div class="step-view c3d-mesh">${fig}<aside class="step-side" id="c3dMeshSide">${c3dMeshSideHTML()}</aside>${m3StudyHTML()}</div>`,
    solve: `<div id="c3dProg"></div>${c3dSolveHTML()}`,
    results: FO ? `<div id="c3dProg"></div>${c3dEndsAnswers(FO, stale)}${R0 ? fig + charts : ''}${c3dEndsHTML(FO)}<div class="oned-table" id="oneDTable"></div>`
      : R0 ? `<div id="c3dProg"></div>${E3 ? c3dEdgeHTML(E3, stale) : ''}${fig}${c3dStreamPanel(R)}${charts}<div class="oned-table" id="oneDTable"></div>`
      : E3 ? `<div id="c3dProg"></div>${c3dEdgeHTML(E3, stale)}<div class="oned-table" id="oneDTable"></div>`
      : `<div id="c3dProg"></div>${emptyHint('Nothing solved yet', 'Set the 3D geometry, region and mesh, then solve it on the Solve step.', `<button type="button" class="btn btn-primary btn-sm" data-c3dstep="solve">${uiIco('play')}Open Solve</button>`)}<div class="oned-table" id="oneDTable"></div>`,
  }[stp];
  view.innerHTML = moduleFrame({ steps: stepBar('3d', stp, stepStatus3D()), tools, panes: [], extra });
  stepBarScroll();
  const hs = view.querySelector('[data-c3dstep]'); if (hs) hs.onclick = () => goStep3D(hs.dataset.c3dstep);
  wireC3dZones(document.getElementById('c3dMeshSide'));
  wireAcc3(document.getElementById('c3dMeshSide'));
  wireM3Study(view.querySelector('.m3-study'));
  const G = c3dBuild();
  let st = '';
  if (running) st = pill('Solving the 3D…', '') + `<span class="c3d-busy" id="c3dBusy"></span>`;
  else if (R) {
    const mid = (R.NL - 1) / 2, sm = R.stations[mid], films = c3dFilmStations(R).map(s => s.film * 1000), cls = c3dFilmStations(R).map(s => s.s * 1000);
    st = pill(`3D solved: wet film ${Math.min(...films).toFixed(3)} to ${Math.max(...films).toFixed(3)} mm across the ${R.region === 'full' ? 'web' : 'strip'}`, stale ? 'warn' : 'ok')
      + (stale ? pill('Out of date: the inputs changed since (Solve 3D again)', 'warn') : '')
      + pill(R.mode === 'climbed' ? `Contact line ${Math.min(...cls).toFixed(2)} to ${Math.max(...cls).toFixed(2)} mm ${R.k != null ? 'along the face' : 'up the exit face'}` : R.k ? `Contact line pinned at corner ${R.k} of the face` : 'Contact line pinned at the edge', '')
      + pill(R.region === 'full' ? `${c3dTime(S.ms / 1000)}: ${R.size.strips} strips, ${R.sweeps} sweeps until they agreed` : `${(S.ms / 1000).toFixed(0)} s, ${R.iterations} Newton steps`, '')
      + (R.region === 'full' ? pill(R.openEdges ? 'The web\'s edges: open (the edge bead solved at each end)' : R.skew ? 'The web\'s edges: open, each held at its own station\'s flow along the skewed blade (the edge bead is not modelled)' : 'The web\'s edges: symmetry planes (the edge bead is not modelled)', '') : '')
      + (E3 ? c3dEdgePill(E3) : '') + (FO ? c3dEdgePill(FO.edges.left) + c3dEdgePill(FO.edges.right) : '');
    void sm;
  }
  if (!running && !R && E3 && stp === 'results') st = c3dEdgePill(E3) + (stale ? pill('Out of date: the inputs changed since (Solve 3D again)', 'warn') : '');
  if (!running && !R && FO && stp === 'results') st = c3dEdgePill(FO.edges.left) + c3dEdgePill(FO.edges.right) + pill('The width not solved: both ends must hold the bead pressure', 'warn') + (stale ? pill('Out of date: the inputs changed since (Solve 3D again)', 'warn') : '');
  if (!running && C3D_RUN.status === 'error') st = pill('The 3D could not be solved: ' + C3D_RUN.error, 'bad') + st;
  // (the geometry's state before solving -- not once an edge, or the width with its edges open, has its answer)
  if (!R && !running && !(stp === 'results' && (E3 || FO))) {
    if (G.error) st += pill('The geometry could not be built: ' + G.error, 'bad');
    else if (G.empty) st += pill('Import an STL or STEP file of the blade (in the inputs, 3D geometry)', 'warn');
    else st += pill(G.open ? `The blade does not cover the region at ${G.open} of ${G.rays} points` : G.multi ? `The blade overhangs at ${G.multi} of ${G.rays} points: its underside is not a single height there` : C3D.region === 'full' ? 'Geometry ready; the full-width solve is being built' : 'Geometry ready: Solve 3D', G.open ? 'bad' : G.multi ? 'warn' : 'ok')
      + pill(`Blade ${G.label}`, '') + (C3D.source === 'file' && G.mesh ? pill(C3D.fileFace === 'file' ? 'Exit face from the file (each station\'s section)' : `Exit face angle from the 2D setup (${cfdGeometry(C3D.loc).exitAngle}°)`, '') : '');
  }
  document.getElementById('st').innerHTML = st;
  c3dBusy();
  const stat = a => `<div class="stat" title="${a[0]}: ${a[1]}"><span>${tileLabel(a[0])}</span><strong>${a[1]}</strong></div>`;
  const geoTiles = G.mesh ? [
    [C3D.region === 'strip' ? `Strip at L${C3D.loc + 1}, mm` : 'Full width, mm', C3D.region === 'strip' ? String(C3D.stripW) : String(ACROSS_W)],
    ['Gap at the edge, mm', Number.isFinite(G.gMin) ? `${(G.gMin * 1000).toFixed(3)}–${(G.gMax * 1000).toFixed(3)}` : 'no blade'],
    ['Blade + film, mm', `${(G.xe * 1000).toFixed(1)} + ${(G.Ld * 1000).toFixed(1)}`],
    ['Underside', G.open ? `${G.open} open` : G.multi ? `${G.multi} overhang` : 'single layer'],
  ] : [];
  const SMv = c3dSolvedMesh(), ms = c3dMeshSize(), e3 = c3dEstimate(), hq = SMv ? c3dHexQuality(SMv.R) : null, pvq = !SMv && C3D_PV.stats && C3D_PV.key === c3dPreviewKey() ? C3D_PV.stats : null;
  const span = f => ms.a0 === ms.a1 ? f(ms.a0).toLocaleString() : `${f(ms.a0).toLocaleString()}–${f(ms.a1).toLocaleString()}`;
  const MSt = stp === 'mesh' ? c3dMeshStats() : null, MP = stp === 'mesh' ? c3dMeshProblems(MSt) : [];
  const meshTiles = [['Hexahedra', span(a => c3dHexes(a, ms))], ['Nodes', span(a => c3dNodes(a, ms))], ['Unknowns', SMv && SMv.R.size ? SMv.R.size.unknowns.toLocaleString() : `≈ ${Math.round(e3.ND / 1000)} thousand`],
    ['Quality, worst', hq ? hq.worst.toFixed(2) : pvq ? pvq.worst.toFixed(2) : '—'],
    ...(MSt ? [['Elements across the gap', String(MSt.S.gap.cells)], [`Elements across the ${c3dWhere()}`, String(MSt.S.across.cells)]] : []),
    ['Mesh problems', MP.some(p => p.level === 'error') ? `${MP.filter(p => p.level === 'error').length} error${MP.filter(p => p.level === 'error').length === 1 ? '' : 's'}` : MP.length ? `${MP.length} warning${MP.length === 1 ? '' : 's'}` : MSt ? 'none' : '—']];
  if (stp !== 'results') document.getElementById('ss').innerHTML = (stp === 'geometry' ? geoTiles : stp === 'mesh' ? meshTiles
    : [['Unknowns', meshTiles[2][1]], ...(C3D.region === 'strip' ? [['Memory for the solve', c3dMem(e3.bytes)], ['Time, about', c3dTime(e3.secs)]] : C3D.region === 'edge' ? [['Memory for the solve', c3dMem(e3.bytes)], ['Time per step, about', c3dTime(e3.secs)]] : [])]).map(stat).join('');
  else if (FO && !R) {
    // (the full width with its edges open, an end not holding the bead pressure: what each end holds, where its slurry goes)
    const past = E => { const q = E.steps.filter(x => x.ok).pop(); return q ? c3dEdgePast(E, q.web).toFixed(2) : '—'; };
    document.getElementById('ss').innerHTML = [
      ['Bead pressure held, left end, Pa', `${FO.edges.left.valid ? (+FO.edges.left.P).toFixed(1) : 'none'} of ${(+FO.Pset).toFixed(1)}`],
      ['Bead pressure held, right end, Pa', `${FO.edges.right.valid ? (+FO.edges.right.P).toFixed(1) : 'none'} of ${(+FO.Pset).toFixed(1)}`],
      ['Slurry past the blade\'s ends, left / right, mm', `${past(FO.edges.left)} / ${past(FO.edges.right)}`],
      ['Solve time', c3dTime(S.ms / 1000)],
    ].map(stat).join('');
  } else if (E3) {
    // (an edge: what holds, where the slurry goes, the bead)
    const lastOk = E3.steps.filter(q => q.ok).pop(), films = R ? R.stations.map(q => q.film * 1000) : [], inner = R ? R.stations[E3.edgeGeom.left ? R.NL - 1 : 0].film * 1000 : NaN;
    document.getElementById('ss').innerHTML = [
      ['Bead pressure held, Pa', `${E3.valid ? (+E3.P).toFixed(1) : 'none'} of ${(+E3.Pset).toFixed(1)}`],
      ['Slurry past the blade\'s end, mm', lastOk ? c3dEdgePast(E3, lastOk.web).toFixed(2) : '—'],
      ['Angle at the blade\'s end, max', lastOk ? `${lastOk.angle.toFixed(1)}° (limit ${(E3.thBlade + 90).toFixed(0)}°)` : E3.steps[0] && c3dEdgeSolved(E3.steps[0]) && Number.isFinite(E3.steps[0].angle) ? `${E3.steps[0].angle.toFixed(1)}° (limit ${(E3.thBlade + 90).toFixed(0)}°)` : '—'],
      ['Edge bead, mm', R ? `${Math.max(...films).toFixed(3)} (inside ${inner.toFixed(3)})` : '—'],
      ['Steps solved', String(E3.steps.length)],
      ['Solve time', c3dTime(S.ms / 1000)],
    ].map(stat).join('');
  } else if (R) {
    const mid = (R.NL - 1) / 2, sm = R.stations[mid];
    let wMax = 0; for (let n = 0; n < R.w.length; n++) wMax = Math.max(wMax, Math.abs(C3D_FIELDS.w.f(R, n) / 1000));
    const dev = Math.max(...c3dFilmStations(R).map(s => Math.abs(s.film / s.film2 - 1))) * 100;
    const full = R.region === 'full', films = c3dFilmStations(R).map(s => s.film * 1000);
    document.getElementById('ss').innerHTML = [
      full ? ['Wet film, mean, mm', (films.reduce((a, b) => a + b, 0) / films.length).toFixed(3)] : ['Wet film at L' + (C3D.loc + 1) + ', mm', (sm.film * 1000).toFixed(3)],
      ['3D vs 2D film, largest', dev.toFixed(2) + ' %'],
      full ? ['Film range across the web', ((Math.max(...films) - Math.min(...films)) * 1000).toFixed(1) + ' µm'] : ['Contact line at L' + (C3D.loc + 1) + ', mm', R.mode === 'climbed' ? (sm.s * 1000).toFixed(2) : R.k ? `pinned at corner ${R.k}` : 'pinned'],
      ...(R.openEdges ? [['Edge beads, left / right, mm', ['lo', 'hi'].map(k => Math.max(...R.open[k].y[R.NC - 1]) * 1000).map(v => v.toFixed(3)).join(' / ')]] : [['Flow across the web, max', (wMax * 1000).toFixed(3) + ' mm/s']]),
      full ? ['Unknowns per strip', `${R.size.unknowns.toLocaleString()} × ${R.size.strips}`] : ['Unknowns', R.size.unknowns.toLocaleString()],
      ['Solve time', full ? c3dTime(S.ms / 1000) : `${(S.ms / 1000).toFixed(0)} s`],
    ].map(stat).join('');
  }
  const odt = document.getElementById('oneDTable'); if (odt) odt.innerHTML = oneDCompareTable();
  const rb = document.getElementById('c3dRun'); if (rb) rb.onclick = () => c3dRun();
  const sb = document.getElementById('c3dStop'); if (sb) sb.onclick = c3dStop;
  if (R) { c3dCharts(R); c3dEdgeCharts(R); c3dDrawUz(R); wireC3dStream(view.querySelector('.c3d-stream')); wireC3dStream(view.querySelector('.m3-uz')); }
  if (FO && stp === 'results') { c3dEdgeCharts(c3dEndView(FO, 'left'), 'L'); c3dEdgeCharts(c3dEndView(FO, 'right'), 'R'); }
  if (stp === 'solve') { drawSolve3D(); return; }
  if (stp === 'mesh') requestMeshPreview3D();
  if (secOn) { c3dDrawSection(); return; }
  if (!document.getElementById('v3dHost')) return;
  // (the mesh: always on Mesh, never on Geometry, as chosen on Results)
  const meshOn = stp === 'mesh' ? true : stp === 'geometry' ? false : C3D.mesh;
  // (drawn at once when three.js is in: an image export redraws the page and takes the view straight away)
  if (!G.mesh && !R) document.getElementById('v3dHost').innerHTML = `<p class="v3d-msg">${G.error ? 'Nothing to show: the geometry could not be built.' : 'No blade yet: import an STL or STEP file of the blade (inputs, 3D geometry).'}</p>`;
  else if (typeof THREE !== 'undefined' && THREE.OrbitControls) v3Draw(G, R, meshOn);
  else load3DLibs().then(() => v3Draw(G, R, meshOn)).catch(e => { const h = document.getElementById('v3dHost'); if (h) h.innerHTML = `<p class="v3d-msg">The 3D view could not start: ${mEsc(e.message)}</p>`; });
}
/**
 * The cross-flow diagnostic (Results): the largest speeds along the web, up and across it in the machine's frame, and
 * across over along -- whether the 3D's flow moves across the web at all, and how much.
 */
function c3dCrossFlowPane(R, stale, where) {
  const cf = m3CrossFlow(R), v = x => `${+(x * 1000).toPrecision(3)} mm/s`, zo = R.zOff || 0;
  let zMin = Infinity, zMax = -Infinity; for (let n = 0; n < R.z.length; n++) { zMin = Math.min(zMin, R.z[n]); zMax = Math.max(zMax, R.z[n]); }
  const layers = new Set(Array.from(R.z, z => Math.round(z * 1e9))).size;
  // (what in this solve can drive flow across the web: the gap at the metering edge across the stations, a skewed blade, open edges; the sides)
  const NL = R.NL, NR = R.NR, gapAt = l => R.y[(R.cCorner * NL + l) * NR + NR - 1] - R.y[(R.cCorner * NL + l) * NR];
  let gMin = Infinity, gMax = -Infinity; for (let l = 0; l < NL; l++) { gMin = Math.min(gMin, gapAt(l)); gMax = Math.max(gMax, gapAt(l)); }
  const open = R.openEdges || R.region === 'edge', drivers = [gMax - gMin > 1e-9 * gMax ? `the gap at the metering edge varies ${+((gMax - gMin) * 1e6).toPrecision(3)} µm across (${+(gMin * 1e3).toPrecision(4)} to ${+(gMax * 1e3).toPrecision(4)} mm)` : '',
    R.skew ? `the blade is skewed ${R.skew}°` : '', open ? 'an edge is open (the edge bead)' : ''].filter(Boolean);
  const sides = open ? 'an open edge and a symmetry plane' : R.skew ? 'held at their own stations\' flow (the web moving along the skewed blade)' : 'symmetry planes (u_z = 0 on them, no shear)';
  if (C3D.stream) v3Streamlines(R);   // (the seeds of the lines drawn: kept for this result and these settings)
  const sd = C3D.stream && V3.sl ? [...new Set(V3.sl.seeds.map(q => q[2].toFixed(2)))] : null;
  return `<figure class="pane m3-xflow"><figcaption>${uiBadge('flow')}Cross-flow diagnostic${stale ? ' (out of date)' : ''}</figcaption>
    <table class="kv"><tr><td></td><td>largest · mean</td></tr><tr><td>|u<sub>x</sub>|, along the web</td><td>${v(cf.ux)} · ${v(cf.mean.ux)}</td></tr><tr><td>|u<sub>y</sub>|, up from the web</td><td>${v(cf.uy)} · ${v(cf.mean.uy)}</td></tr>
    <tr><td>|u<sub>z</sub>|, across the web</td><td>${v(cf.uz)} · ${v(cf.mean.uz)}</td></tr><tr><td>R<sub>zx</sub> = max |u<sub>z</sub>| / max |u<sub>x</sub>|</td><td>${(cf.ratio * 100).toPrecision(3)} %</td></tr>
    <tr><td>z, smallest to largest</td><td>${+((zMin + zo) * 1000).toFixed(3)} to ${+((zMax + zo) * 1000).toFixed(3)} mm</td></tr><tr><td>Node layers across (unique z)</td><td>${layers}</td></tr><tr><td>Elements across</td><td>${(R.NL - 1) / 2}</td></tr>
    ${sd ? `<tr><td>Streamline seeds, z</td><td title="${sd.join(', ')} mm">${sd.length} position${sd.length === 1 ? '' : 's'}</td></tr>` : ''}</table>
    <p class="side-note">In this solve: ${drivers.length ? drivers.join('; ') : 'nothing varies across the region'}; the sides ${sides}. ${drivers.length ? 'These drive flow across the web; the streamlines move across it as far as u<sub>z</sub> takes them.' : 'The solution is then two-dimensional: planar streamlines are correct here, not a fault of the 3D.'} R<sub>zx</sub> is a diagnostic, not a pass or fail.</p>
    <div class="pane-legend"><span>Over every node of the ${where}, in the machine's frame${R.skew ? ' (the skewed blade\'s solve turned back)' : ''}. u<sub>z</sub> is flow across the web, which the 2D cannot have: a gap or contact angle varying across, a skewed blade or an open edge drive it; with nothing varying across and the sides symmetry planes it is zero to within the solve's tolerance. </span></div></figure>`;
}
// ---- streamlines: the mode (the full 3D volume, or a slice), the seeds, the colour, the length (post-processing only) ----
/** The modes: a line through the 3D volume (u_x, u_y, u_z), or a slice -- a mesh coordinate held, the velocity along it. */
const C3D_STREAM_MODES = {
  volume: { l: '3D volume', hold: null, d: 'through the full volume with u_x, u_y and u_z' },
  xy: { l: 'X–Y slice', hold: 'L', d: 'held at the seed\'s station across the web (z fixed), the velocity projected on it: u_z left out' },
  xz: { l: 'X–Z slice', hold: 'K', d: 'held at the seed\'s share of the gap (a surface between the web and the blade or surface), the velocity along it' },
  yz: { l: 'Y–Z slice', hold: 'C', d: 'held on the seed\'s spine column across the web, the velocity along it: u_x left out' },
};
/** The seeds: what they are, and which positions they take (x along the flow, y up, z across the web). */
const C3D_SEEDS = {
  inlet: { l: 'Inlet, across the web', uses: [] },
  crossweb: { l: 'Cross-web line', uses: ['x', 'y', 'n'] },
  yline: { l: 'Up the gap', uses: ['x', 'z', 'n'] },
  plane: { l: 'Seed plane', uses: ['plane', 'at', 'n'] },
  volume: { l: 'Through the volume', uses: ['n'] },
  points: { l: 'Points (typed)', uses: ['pts'] },
  bead: { l: 'Preset: upstream bead', uses: ['n'] },
  gapEntry: { l: 'Preset: metering-gap entry', uses: ['n'] },
  edge: { l: 'Preset: active edge', uses: ['n'] },
  film: { l: 'Preset: downstream wet film', uses: ['n'] },
};
const c3dStreamKey = () => JSON.stringify(['streamDensity', 'streamMode', 'streamSeeds', 'streamPlane', 'streamX', 'streamY', 'streamZ', 'streamN', 'streamPts', 'streamLen'].map(k => C3D[k]));
const c3dStreamColorKey = () => C3D.streamColor === 'field' ? C3D.field : C3D.streamColor;
/** The result's frame (m: x from the inlet, y up, z from the region's middle; a skewed blade's solve in its own frame) to the web's (mm: z across the web), and back. */
function c3dToMachine(R, x, y, z) {
  const zo = R.zOff || 0, t = (R.skew || 0) * Math.PI / 180, dx = x - R.xe, dz = z;
  return [(R.xe + dx * Math.cos(t) + dz * Math.sin(t)) * 1000, y * 1000, (zo - dx * Math.sin(t) + dz * Math.cos(t)) * 1000];
}
function c3dToSolve(R, xmm, ymm, zmm) {
  const zo = R.zOff || 0, t = (R.skew || 0) * Math.PI / 180, X = xmm / 1000 - R.xe, Z = zmm / 1000 - zo;
  return [R.xe + X * Math.cos(t) - Z * Math.sin(t), ymm / 1000, X * Math.sin(t) + Z * Math.cos(t)];
}
/**
 * The places the presets and the defaults take (m, the result's frame), from the solved flow itself: the metering edge
 * (x_e, its gap H), the metering gap's entry (the first column along the middle station where the blade comes within 2 H
 * of the web), the upstream bead (a quarter of the way from the inlet to that entry), the wet film (halfway along it).
 */
function c3dSeedPlaces(R) {
  const NL = R.NL, NR = R.NR, mid = (NL - 1) >> 1, top = c => R.y[(c * NL + mid) * NR + NR - 1], xt = c => R.x[(c * NL + mid) * NR + NR - 1];
  const H = top(R.cCorner), xe = xt(R.cCorner);
  let cE = 0; while (cE < R.cCorner && top(cE) > 2 * H) cE++;
  const xEntry = xt(cE), xEnd = xt(R.NC - 1);
  return { H, xe, xEntry, bead: 0.25 * xEntry, edge: xe - 0.5 * H, film: xe + 0.5 * (xEnd - xe) };
}
/** The seed specification for cfd-3d-stream.js (the result's frame, m) from the settings, and its label. */
function c3dSeedSpec(R) {
  const k = C3D.streamSeeds, Pl = c3dSeedPlaces(R), n = Math.max(1, Math.min(40, C3D.streamN || 9));
  const zo = R.zOff || 0, zDef = zo * 1000, S = (x, y, z) => c3dToSolve(R, x, y, z);
  const X = C3D.streamX ?? +(Pl.edge * 1000).toFixed(3), Y = C3D.streamY ?? +(0.5 * Pl.H * 1000).toFixed(4), Z = C3D.streamZ ?? +zDef.toFixed(3);
  // (a preset: a Y–Z grid of seeds at its x -- up the local height at each of n across, 3 up)
  const grid = xm => {
    let zMin = Infinity, zMax = -Infinity; for (let i = 0; i < R.z.length; i++) { zMin = Math.min(zMin, R.z[i]); zMax = Math.max(zMax, R.z[i]); }
    const specs = []; for (let i = 0; i < n; i++) { const zs = zMin + (zMax - zMin) * (n === 1 ? 0.5 : (i + 0.5) / n), [xs, , z2] = S(xm * 1000, 0, (zs + zo) * 1000); specs.push({ kind: 'yline', x: xs, z: z2, n: 3 }); }
    return { kind: 'multi', specs };
  };
  if (k === 'crossweb') { const [x, y, z] = S(X, Y, Z); return { spec: { kind: 'zline', x, y, n, z }, label: `a line across the web at x ${X} mm, y ${Y} mm` }; }
  if (k === 'yline') { const [x, , z] = S(X, 0, Z); return { spec: { kind: 'yline', x, z, n }, label: `up the gap at x ${X} mm, z ${Z} mm` }; }
  if (k === 'plane') {
    const pl = C3D.streamPlane, at = pl === 'yz' ? S(X, 0, zDef)[0] : pl === 'xz' ? Y / 1000 : S(Pl.xe * 1000, 0, Z)[2];
    return { spec: { kind: 'plane', plane: pl, at, n1: n, n2: Math.max(2, Math.round(n / 2)) }, label: `a ${pl.toUpperCase()} plane at ${pl === 'yz' ? `x ${X}` : pl === 'xz' ? `y ${Y}` : `z ${Z}`} mm` };
  }
  if (k === 'volume') return { spec: { kind: 'volume', n1: n, n2: Math.max(2, Math.round(n / 2)), n3: 3 }, label: 'a regular grid through the volume' };
  if (k === 'points') {
    const pts = String(C3D.streamPts || '').split(/\n/).map(t => t.split(/[,;\s]+/).filter(Boolean).map(Number)).filter(q => q.length === 3 && q.every(Number.isFinite)).map(([x, y, z]) => S(x, y, z));
    return { spec: { kind: 'point', pts }, label: `${pts.length} typed point${pts.length === 1 ? '' : 's'}` };
  }
  const pre = { bead: ['bead', 'the upstream bead'], gapEntry: ['xEntry', 'the metering gap\'s entry'], edge: ['edge', 'the active metering edge'], film: ['film', 'the downstream wet film'] }[k];
  if (pre) return { spec: grid(Pl[pre[0]]), label: `${pre[1]}: x ${(Pl[pre[0]] * 1000).toFixed(2)} mm, ${n} across × 3 up` };
  return { spec: null, label: 'the inlet, spaced by equal flow up the gap, across the web' };
}
/** The streamline panel (Results, streamlines on): mode, seeds and their positions, colour, length, what was seeded, the lines as a CSV. */
function c3dStreamPanel(R) {
  if (!R || !C3D.stream) return '';
  v3Streamlines(R);
  const sl = V3.sl, Pl = c3dSeedPlaces(R), uses = (C3D_SEEDS[C3D.streamSeeds] || C3D_SEEDS.inlet).uses, mode = C3D_STREAM_MODES[C3D.streamMode] || C3D_STREAM_MODES.volume;
  const opt = (v, t, c) => `<option value="${v}"${v === c ? ' selected' : ''}>${t}</option>`;
  const num = (k, ph, label) => `<label>${label} <input type="number" class="zone-in" data-c3ds="${k}" step="any" value="${C3D[k] ?? ''}" placeholder="${ph}" aria-label="${label}, mm"> mm</label>`;
  const zs = sl ? [...new Set(sl.seeds.map(q => q[2].toFixed(2)))] : [];
  const pos = [uses.includes('x') ? num('streamX', +(Pl.edge * 1000).toFixed(3), 'x') : '', uses.includes('y') ? num('streamY', +(0.5 * Pl.H * 1000).toFixed(4), 'y') : '', uses.includes('z') ? num('streamZ', +((R.zOff || 0) * 1000).toFixed(3), 'z') : '',
    uses.includes('plane') ? `<label>Plane <select data-c3ds="streamPlane">${opt('yz', 'Y–Z (at x)', C3D.streamPlane)}${opt('xz', 'X–Z (at y)', C3D.streamPlane)}${opt('xy', 'X–Y (at z)', C3D.streamPlane)}</select></label>` + (C3D.streamPlane === 'yz' ? num('streamX', +(Pl.edge * 1000).toFixed(3), 'x') : C3D.streamPlane === 'xz' ? num('streamY', +(0.5 * Pl.H * 1000).toFixed(4), 'y') : num('streamZ', +((R.zOff || 0) * 1000).toFixed(3), 'z')) : '',
    uses.includes('n') ? `<label>Across <input type="number" class="zone-in" data-c3ds="streamN" min="1" max="40" step="1" value="${C3D.streamN}" aria-label="Seeds across"></label>` : ''].join('');
  return `<section class="pane c3d-stream"><figcaption>${uiBadge('flow')}Streamlines: ${mode.l}${mode.hold ? ' — a slice, not a 3D streamline' : ''}</figcaption>
    <div class="acc3-bar">
      <label>Mode <select data-c3ds="streamMode">${Object.entries(C3D_STREAM_MODES).map(([k, m]) => opt(k, m.l, C3D.streamMode)).join('')}</select></label>
      <label>Seeds <select data-c3ds="streamSeeds">${Object.entries(C3D_SEEDS).map(([k, m]) => opt(k, m.l, C3D.streamSeeds)).join('')}</select></label>
      ${pos}
      <label>Colour by <select data-c3ds="streamColor">${opt('field', 'As the field shown', C3D.streamColor)}${['speed', 'ux', 'uy', 'w', 'p', 'gd', 'mu'].map(k => opt(k, C3D_FIELDS[k].l, C3D.streamColor)).join('')}</select></label>
      <label>Length <input type="number" class="zone-in" data-c3ds="streamLen" min="0" step="any" value="${C3D.streamLen || ''}" placeholder="to the outlet" aria-label="Largest streamline length, mm"> mm</label>
      <button type="button" class="btn btn-secondary btn-sm" id="c3dStreamCsv">${uiIco('download')}Streamlines, CSV</button>
    </div>
    ${uses.includes('pts') ? `<textarea class="c3d-pts" data-c3ds="streamPts" rows="3" placeholder="x, y, z in mm, one point a line (x from the inlet, y up from the web, z across the web)" aria-label="Seed points">${mEsc(C3D.streamPts || '')}</textarea>` : ''}
    <p class="side-note">${mode.l}: ${mode.d}. Seeds: ${sl ? escAttr(sl.label) : ''} — ${sl ? sl.seeds.length : 0} in the flow at ${zs.length} z position${zs.length === 1 ? '' : 's'} (${zs.slice(0, 12).join(', ')}${zs.length > 12 ? ', …' : ''} mm)${sl && sl.outside ? `; ${sl.outside} asked for outside it (in the blade, above the surface or beyond the region) left out` : ''}.
      Seeds inside the flow are traced back to where their line came from and on to where it goes. Lines follow the solved velocity only: a line moves across the web as far as u<sub>z</sub> takes it; with u<sub>z</sub> zero it stays in its plane. Changing these redraws the lines from the same solve.</p></section>`;
}
function wireC3dStream(host) {
  if (!host) return;
  host.querySelectorAll('[data-c3ds]').forEach(el => {
    el.onchange = () => {
      const k = el.dataset.c3ds; let v = el.value;
      if (el.type === 'number') v = v === '' ? (k === 'streamN' ? C3D_DEFAULTS.streamN : k === 'streamLen' ? 0 : null) : +v;
      if (k === 'streamN') v = Math.max(1, Math.min(40, Math.round(v)));
      if (k === 'streamLen') v = Math.max(0, v || 0);
      if (C3D[k] !== v) c3dSet(k, v);
    };
  });
  const b = host.querySelector('#c3dStreamCsv');
  if (b) b.onclick = () => {
    const S = c3dShown(), R = S && S.result; if (!R || !V3.sl) return;
    const rows = ['line,point,x_mm,y_mm,z_mm,u_x_mm_s,u_y_mm_s,u_z_mm_s,end'], t = (R.skew || 0) * Math.PI / 180;
    V3.sl.lines.forEach((ln, i) => { for (let j = 0; j < ln.pos.length / 3; j++) {
      const m = c3dToMachine(R, ln.pos[3 * j], ln.pos[3 * j + 1], ln.pos[3 * j + 2]), u = ln.vel[3 * j], v = ln.vel[3 * j + 1], w = ln.vel[3 * j + 2];
      rows.push([i + 1, j + 1, ...m.map(q => q.toFixed(6)), ((u * Math.cos(t) + w * Math.sin(t)) * 1000).toFixed(6), (v * 1000).toFixed(6), ((w * Math.cos(t) - u * Math.sin(t)) * 1000).toFixed(6), ln.end].join(','));
    } });
    rows.push('', 'seed,x_mm,y_mm,z_mm'); V3.sl.seeds.forEach((q, i) => rows.push([i + 1, ...q.map(v => v.toFixed(6))].join(',')));
    saveBlob(new Blob([rows.join('\n')], { type: 'text/csv' }), `streamlines-3d-${C3D.streamMode}.csv`);
  };
}

// ---- the cross-web velocity u_z on a section (Results): Y–Z across the web at an x, or X–Z at half the local gap ----
function c3dUzPane(R, stale) {
  const Pl = c3dSeedPlaces(R), x0 = C3D.uzX ?? +(Pl.xe * 1000 - 0.05 * Pl.H * 1000).toFixed(3);
  return `<figure class="pane m3-uz"><figcaption>${uiBadge('flow')}<span>Cross-web velocity u<sub>z</sub>${stale ? ' (out of date)' : ''}</span></figcaption>
    <div class="acc3-bar"><div class="seg" role="tablist" aria-label="u_z section"><button type="button" role="tab" data-c3duz="yz" aria-selected="${C3D.uzView === 'yz'}">Y–Z at x</button><button type="button" role="tab" data-c3duz="xz" aria-selected="${C3D.uzView === 'xz'}">X–Z, half the gap</button></div>
    ${C3D.uzView === 'yz' ? `<label>x <input type="number" class="zone-in" data-c3ds="uzX" step="any" value="${C3D.uzX ?? ''}" placeholder="${x0}" aria-label="x of the Y–Z section, mm"> mm</label>` : ''}</div>
    <div class="m3-uz-host"><canvas id="c3dUz" role="img" aria-label="Cross-web velocity u_z on a section"></canvas></div>
    <div class="pane-legend" id="c3dUzLeg"></div></figure>`;
}
/** Draw the u_z section: its colour diverging about 0 (blue -, red +), on a Y–Z section the in-plane velocity (u_z, u_y) as arrows. */
function c3dDrawUz(R) {
  const cv = document.getElementById('c3dUz'); if (!cv) return;
  const host = cv.parentElement, W = Math.max(240, host.clientWidth), Hh = Math.max(180, host.clientHeight || 260), dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = Hh * dpr; cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const t = (R.skew || 0) * Math.PI / 180, wz = (u, w) => w * Math.cos(t) - u * Math.sin(t), w = sl3Work(), lut = getLut('div'), Pl = c3dSeedPlaces(R);
  const cells = [];   // [u0, v0, u1, v1 (the drawing's axes, m), value, (arrow) a, b]
  let yz = C3D.uzView === 'yz', uLab, vLab, K = 1;
  if (yz) {
    // (Y–Z at x: the machine frame's x -- points located in the flow; the column's local height from the top row there)
    const xm = C3D.uzX ?? +(Pl.xe * 1000 - 0.05 * Pl.H * 1000).toFixed(3);
    let zMin = Infinity, zMax = -Infinity; for (let i = 0; i < R.z.length; i++) { zMin = Math.min(zMin, R.z[i]); zMax = Math.max(zMax, R.z[i]); }
    const nz = 60, ny = 24, zo = R.zOff || 0;
    for (let i = 0; i < nz; i++) {
      const zc = zMin + (zMax - zMin) * (i + 0.5) / nz, [xs, , zs] = c3dToSolve(R, xm, 0, (zc + zo) * 1000), sd = seeds3D(R, { kind: 'yline', x: xs, z: zs, n: ny });
      for (let j = 0; j < sd.seeds.length; j++) { const q = sd.seeds[j]; sl3Eval(R, q[0], q[1], q[2], w); const hgt = w.y / ((j + 0.5) / ny); cells.push([(zc - (zMax - zMin) / nz / 2 + zo) * 1000, hgt * j / ny * 1000, (zc + (zMax - zMin) / nz / 2 + zo) * 1000, hgt * (j + 1) / ny * 1000, wz(w.u, w.w) * 1000, wz(w.u, w.w), w.v]); }
    }
    uLab = 'z across the web, mm'; vLab = 'y up, mm';
  } else {
    // (X–Z: at half the local gap, K the middle row; positions as solved, in the machine frame)
    const nx = Math.min(160, R.NC - 1), nz = Math.min(60, 2 * (R.NL - 1)), Kh = (R.NR - 1) / 2;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const C = (R.NC - 1) * (i + 0.5) / nx, L = (R.NL - 1) * (j + 0.5) / nz; sl3Eval(R, C, L, Kh, w); const v = wz(w.u, w.w) * 1000;
      const c = [[C - 0.5 * (R.NC - 1) / nx, L - 0.5 * (R.NL - 1) / nz], [C + 0.5 * (R.NC - 1) / nx, L + 0.5 * (R.NL - 1) / nz]].map(([a, b]) => { sl3Eval(R, Math.max(0, a), Math.max(0, b), Kh, w); return c3dToMachine(R, w.x, w.y, w.z); });
      cells.push([c[0][0], c[0][2], c[1][0], c[1][2], v]);
    }
    uLab = 'x along the flow, mm'; vLab = 'z across the web, mm';
  }
  if (!cells.length) return;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, m = 0;
  for (const c of cells) { u0 = Math.min(u0, c[0], c[2]); u1 = Math.max(u1, c[0], c[2]); v0 = Math.min(v0, c[1], c[3]); v1 = Math.max(v1, c[1], c[3]); m = Math.max(m, Math.abs(c[4])); }
  const pl = 56, pr = 12, pt = 10, pb = 34, pw = W - pl - pr, ph = Hh - pt - pb, du = u1 - u0 || 1, dv = v1 - v0 || 1;
  let sx = Math.min(pw / du, ph / dv); if (dv * sx < 0.5 * ph) { const room = ph / (dv * sx); for (const k of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]) if (k <= room) K = k; }
  const sy = sx * K, ox = pl + (pw - du * sx) / 2, oy = pt + (ph + dv * sy) / 2, X = u => ox + (u - u0) * sx, Y = v => oy - (v - v0) * sy;
  for (const c of cells) { g.fillStyle = m > 0 ? lutColor(lut, 0.5 + 0.5 * c[4] / m) : lutColor(lut, 0.5); g.fillRect(X(c[0]), Y(c[3]), Math.max(1, X(c[2]) - X(c[0]) + 0.5), Math.max(1, Y(c[1]) - Y(c[3]) + 0.5)); }
  // (Y–Z: arrows of the in-plane velocity (u_z, u_y) at every 4th cell across and 6th up, to the largest's length a cell and a half)
  if (yz) {
    let am = 0; for (const c of cells) am = Math.max(am, Math.hypot(c[5], c[6]));
    const len = 1.5 * Math.max(8, (X(cells[0][2]) - X(cells[0][0])) * 4);
    g.strokeStyle = cssVar('--ink'); g.lineWidth = 1;
    cells.forEach((c, i) => { if (i % 24 % 6 !== 3 || Math.floor(i / 24) % 4 !== 2 || !(am > 0)) return; const cx = (X(c[0]) + X(c[2])) / 2, cy = (Y(c[1]) + Y(c[3])) / 2, a = c[5] / am * len, b = -c[6] / am * len;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + a, cy + b); g.stroke(); const an = Math.atan2(b, a); g.beginPath(); g.moveTo(cx + a, cy + b); g.lineTo(cx + a - 4 * Math.cos(an - 0.5), cy + b - 4 * Math.sin(an - 0.5)); g.lineTo(cx + a - 4 * Math.cos(an + 0.5), cy + b - 4 * Math.sin(an + 0.5)); g.closePath(); g.fillStyle = cssVar('--ink'); g.fill(); });
    V3.uzArrow = am;
  }
  g.strokeStyle = cssVar('--line'); g.strokeRect(X(u0), Y(v1), du * sx, dv * sy);
  g.fillStyle = cssVar('--muted'); g.font = '11px ' + (cssVar('--mono') || 'monospace'); g.textAlign = 'center'; g.textBaseline = 'top';
  const fm = v => String(+v.toPrecision(4));
  g.fillText(fm(u0), X(u0), Y(v0) + 4); g.fillText(fm(u1), X(u1), Y(v0) + 4); g.fillText(uLab, (X(u0) + X(u1)) / 2, Hh - 14);
  g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(fm(v0), X(u0) - 4, Y(v0)); g.fillText(fm(v1), X(u0) - 4, Y(v1));
  g.save(); g.translate(10, (Y(v0) + Y(v1)) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(vLab, 0, 0); g.restore();
  const leg = document.getElementById('c3dUzLeg');
  if (leg) leg.innerHTML = `<span class="v3d-bar"><span>${fm(-m)}</span><i style="background:${c3dGradientCss({ div: true })}"></i><span>${fm(m)} mm/s</span></span><span>u<sub>z</sub> on this section, ${m > 0 ? `largest ${fm(m)} mm/s` : 'zero'}${yz && V3.uzArrow > 0 ? `; arrows: (u<sub>z</sub>, u<sub>y</sub>), the longest ${fm(V3.uzArrow * 1000)} mm/s` : ''}</span><span>${K > 1 ? `${yz ? 'Heights' : 'Across'} drawn ×${K}` : 'Drawn to scale'}</span>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-c3duz]');
  if (b && C3D.uzView !== b.dataset.c3duz) c3dSet('uzView', b.dataset.c3duz);
});
// ---- the Mesh step's sections through the mesh (display only: the mesh is the one the Mesh step's statistics are of) ----
/** The views: key, label, what it shows. */
const C3D_SECTIONS = [['3d', '3D', 'the mesh\'s outer faces in 3D'], ['xy', 'X–Y', 'X–Y: along the flow and up, at the middle station across'],
  ['xz', 'X–Z', 'X–Z, from the top: along the flow and across, on the web'], ['yz', 'Y–Z', 'Y–Z: across and up, at the metering edge'],
  ['gap', 'Gap', 'X–Y at the middle station, round the metering gap (upstream of the edge, the gap\'s height)'],
  ['edge', 'Edge', 'X–Y at the middle station, round the active metering edge and the meniscus']];
/** The section and the window drawn (m): the whole section, or for the zooms, round the gap and round the edge and the meniscus. */
function c3dSectionView(M, kind) {
  const sec = m3Section(M, kind === 'gap' || kind === 'edge' ? 'xy' : kind);
  let [u0, u1, v0, v1] = sec.bounds;
  if (kind === 'gap' || kind === 'edge') {
    const id = (c, k) => m3Id(M, c, sec.mid, k), cE = M.cCorner, xE = M.x[id(cE, M.NR - 1)], H = M.y[id(cE, M.NR - 1)] - M.y[id(cE, 0)];
    if (kind === 'gap') { u0 = xE - 8 * H; u1 = xE + 2 * H; v0 = -0.05 * H; v1 = 1.3 * H; }
    else { const cL = M.cCL ?? cE, xL = M.x[id(cL, M.NR - 1)], yL = M.y[id(cL, M.NR - 1)]; u0 = xE - 2 * H; u1 = Math.max(xL, xE) + 4 * H; v0 = -0.05 * H; v1 = 1.3 * Math.max(yL, H); }
    u0 = Math.max(u0, sec.bounds[0]); u1 = Math.min(u1, sec.bounds[1]);
  }
  return { sec, win: [u0, u1, v0, v1] };
}
/** Draw the section chosen (C3D.section) of the Mesh step's mesh (c3dMeshStats: the solved one while up to date, else the starting layout). */
function c3dDrawSection() {
  const host = document.getElementById('c3dSecHost'), cv = host && host.querySelector('canvas');
  if (!cv) return;
  const ms = c3dMeshStats(), kind = C3D.section, xz = kind === 'xz', yz = kind === 'yz';
  let msg = host.querySelector('.v3d-msg');
  if (!ms) {
    if (!msg) { msg = document.createElement('p'); msg.className = 'v3d-msg'; host.appendChild(msg); }
    msg.textContent = C3D.source === 'made' ? 'Laying out the stations…' : 'A blade from a file: its stations are laid out from the file when solved; the sections then.';
    return;
  }
  if (msg) msg.remove();
  const M = ms.M, { sec, win } = c3dSectionView(M, kind), [u0, u1, v0, v1] = win;
  const dpr = window.devicePixelRatio || 1, W = Math.max(200, host.clientWidth), Hh = Math.max(160, host.clientHeight);
  cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, Hh);
  const pl = 64, pr = 18, pt = 16, pb = 40, pw = W - pl - pr, ph = Hh - pt - pb, du = (u1 - u0) || 1e-9, dv = (v1 - v0) || 1e-9;
  // (to scale, unless thin: then its heights drawn K times larger, K a round number, so it fills the height it can)
  let sx = Math.min(pw / du, ph / dv), K = 1;
  if (dv * sx < 0.5 * ph) { const room = ph / (dv * sx); for (const k of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]) if (k <= room) K = k; }
  const sy = sx * K, ox = pl + (pw - du * sx) / 2, oy = pt + (ph + dv * sy) / 2, X = u => ox + (u - u0) * sx, Y = v => oy - (v - v0) * sy;
  const ink = cssVar('--ink'), mut = cssVar('--muted'), acc = cssVar('--accent'), line = cssVar('--line');
  // the frame and its ticks (mm; µm on a span under 1 mm)
  const fx0 = X(u0), fx1 = X(u1), fy0 = Y(v1), fy1 = Y(v0);
  g.strokeStyle = line; g.lineWidth = 1; g.strokeRect(fx0 - 0.5, fy0 - 0.5, fx1 - fx0 + 1, fy1 - fy0 + 1);
  const unit = span => span < 1e-3 ? ['µm', 1e6] : ['mm', 1e3], [uu, uf] = unit(du), [vu, vf] = unit(dv);
  const ticks = (a, b, n) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / n))), m = [1, 2, 5, 10].find(k => (b - a) / (st * k) <= n) * st, out = []; for (let t = Math.ceil(a / m) * m; t <= b + 1e-12 * (b - a); t += m) out.push(t); return out; };
  g.fillStyle = mut; g.font = '11px ' + (cssVar('--mono') || 'monospace'); g.textAlign = 'center'; g.textBaseline = 'top';
  const fmt = v => String(+v.toPrecision(4));
  for (const t of ticks(u0, u1, 6)) { const x = X(t); g.fillText(fmt(t * uf), x, fy1 + 5); g.beginPath(); g.moveTo(x, fy1); g.lineTo(x, fy1 + 3); g.stroke(); }
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const t of ticks(v0, v1, 4)) { const y = Y(t); g.fillText(fmt(t * vf), fx0 - 6, y); g.beginPath(); g.moveTo(fx0 - 3, y); g.lineTo(fx0, y); g.stroke(); }
  g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillText(`${yz ? 'z across the web' : 'x along the flow'}, ${uu}`, (fx0 + fx1) / 2, Hh - 4);
  g.save(); g.translate(12, (fy0 + fy1) / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'top'; g.fillText(`${xz ? 'z across the web' : 'y up from the web'}, ${vu}`, 0, 0); g.restore();
  // the elements' edges
  g.save(); g.beginPath(); g.rect(fx0, fy0, fx1 - fx0, fy1 - fy0); g.clip();
  const S = sec.segs; g.strokeStyle = ink; g.globalAlpha = 0.55; g.lineWidth = S.length / 4 > 6000 ? 0.6 : 0.9; g.beginPath();
  for (let i = 0; i < S.length; i += 4) { g.moveTo(X(S[i]), Y(S[i + 1])); g.lineTo(X(S[i + 2]), Y(S[i + 3])); }
  g.stroke(); g.globalAlpha = 1;
  // the metering edge and the contact line (X–Y: their points on the top; X–Z: their columns across)
  const top = c => m3Id(M, c, sec.mid, M.NR - 1), marks = [[M.cCorner, 'metering edge'], ...(M.cCL != null && M.cCL !== M.cCorner ? [[M.cCL, 'contact line']] : [])];
  g.strokeStyle = acc; g.fillStyle = acc; g.lineWidth = 1.5; g.font = '600 11px ' + (cssVar('--sans') || 'sans-serif'); g.textAlign = 'left'; g.textBaseline = 'bottom';
  if (!yz) for (const [c, t] of marks) {
    if (c == null) continue;
    if (xz) { const x = X(M.x[m3Id(M, c, 0, 0)]); g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, fy0); g.lineTo(x, fy1); g.stroke(); g.setLineDash([]); g.fillText(t, x + 4, fy0 + 14); }
    else { const n = top(c), x = X(M.x[n]), y = Y(M.y[n]); g.beginPath(); g.arc(x, y, 4, 0, 2 * Math.PI); g.fill(); g.fillText(t, x + 6, y - 4); }
  }
  g.restore();
  const kEl = document.getElementById('c3dSecK');
  if (kEl) kEl.textContent = K > 1 ? `${xz ? 'Across the web' : 'Heights'} drawn ×${K}` : 'Drawn to scale';
  cv._map = { X0: ox, Y0: oy, sx, sy, u0, v0, uu, uf, vu, vf, fx0, fx1, fy0, fy1 };
  if (!cv._wired) {
    cv._wired = true;
    const rd = document.getElementById('c3dSecRead');
    cv.addEventListener('pointermove', ev => {
      const m = cv._map, r = cv.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
      if (!rd || px < m.fx0 || px > m.fx1 || py < m.fy0 || py > m.fy1) { if (rd) rd.textContent = ''; return; }
      const u = m.u0 + (px - m.X0) / m.sx, v = m.v0 + (m.Y0 - py) / m.sy, L = C3D.section === 'yz' ? 'z' : 'x', V = C3D.section === 'xz' ? 'z' : 'y';
      rd.textContent = `${L} ${fmt(u * m.uf)} ${m.uu} · ${V} ${fmt(v * m.vf)} ${m.vu}`;
    });
    cv.addEventListener('pointerleave', () => { if (rd) rd.textContent = ''; });
    if (typeof ResizeObserver !== 'undefined') { let w0 = host.clientWidth, h0 = host.clientHeight; new ResizeObserver(() => { if (host.clientWidth !== w0 || host.clientHeight !== h0) { w0 = host.clientWidth; h0 = host.clientHeight; c3dDrawSection(); } }).observe(host); }
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-c3dsec]');
  if (b && C3D.section !== b.dataset.c3dsec) { C3D.section = b.dataset.c3dsec; render(); }
});
const c3dFmt = v => { const a = Math.abs(v); return a === 0 ? '0' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toExponential(1); };
/** The colour map for a field: the 2D's choice (jet or blue) for magnitudes, diverging blue-red around zero for signed fields. */
const c3dLut = f => getLut(f.div ? 'div' : FV.cmap === 'jet' ? 'jet' : 'seq');
function c3dFieldRange(R, key = C3D.field) {
  const f = C3D_FIELDS[key];
  let min = Infinity, max = -Infinity;
  for (let n = 0; n < R.x.length; n++) { const v = f.f(R, n); if (v < min) min = v; if (v > max) max = v; }
  if (f.div) { const m = Math.max(Math.abs(min), Math.abs(max)) || 1; return { min: -m, max: m }; }
  return { min, max: max > min ? max : min + 1 };
}
function c3dGradientCss(f) {
  const lut = c3dLut(f);
  return `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map(t => lutColor(lut, t)).join(', ')})`;
}

// ---- a web edge's results ----
/** Why the end stopped holding, in words. */
const C3D_EDGE_WHY = { climb: 'the slurry would wet and climb the blade\'s end face (not modelled)', spill: 'the slurry would spill over the web\'s edge (not modelled)', steady: 'the 3D finds no steady edge (its Newton solve does not converge, in smaller steps too)' };
/** A step's own numbers: only from a converged solve (one that did not converge has no edge to measure). */
const c3dEdgeSolved = s => s.ok || s.why === 'climb' || s.why === 'spill';
/** How far the slurry reaches out past the blade's end on the web (mm; - inside it), from its contact line there (m, the strip's z). */
const c3dEdgePast = (R, web) => { const g = R.edgeGeom, z = (web + R.zOff) * 1000; return g.left ? g.bladeEnd - z : z - g.bladeEnd; };
/** The edge's answer (held or not, up to what bead pressure, why), its charts and its steps. */
/** An edge's verdict in words: held or not, up to what bead pressure, why. */
function c3dEdgeAnswer(R) {
  const end = R.edgeGeom.left ? 'left' : 'right', lim = R.thBlade + 90, f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2);
  const s0 = R.steps[0] || {}, last = R.fromWidth ? { web: R.open.web, angle: Math.max(...R.open.angleTop.filter(Number.isFinite)) } : R.steps.filter(s => s.ok).pop();
  let ans;
  if (R.held) ans = `<b>The ${end} end holds the set bead pressure (${f1(R.Pset)} Pa)${R.fromWidth ? ', the width solved with it' : ''}.</b> The slurry ${c3dEdgePast(R, last.web) >= 0 ? `reaches ${f2(c3dEdgePast(R, last.web))} mm past the blade's end` : `stays ${f2(-c3dEdgePast(R, last.web))} mm inside the blade's end`} on the web; at the blade's end it leaves the blade at up to ${f1(last.angle)}° (the limit there, the blade's contact angle + 90°, is ${f1(lim)}°).`;
  else if (R.valid) ans = `<b>The ${end} end holds up to ${f1(R.P)} Pa of the ${f1(R.Pset)} Pa set.</b> Past it ${C3D_EDGE_WHY[R.limit] || 'it stops'}. Shown: the edge at ${f1(R.P)} Pa, the most it holds.`;
  else ans = `<b>The ${end} end does not hold the slurry even with no bead pressure</b> (${f1(R.Pset)} Pa set): ${C3D_EDGE_WHY[R.limit] || 'it stops'}${c3dEdgeSolved(s0) && Number.isFinite(s0.angle) ? ` (with none, it would leave the blade's end at ${f1(s0.angle)}°; the limit is ${f1(lim)}°)` : ''}. No edge to show.`;
  // (why, from the 2D at the blade's end with no bead pressure: the flow's own pressure under the blade against about the most
  // a meniscus across the gap holds there, 2 gamma / h)
  const q = R.squeeze;
  if (q && !R.held && q.p > q.cap) ans += ` With no bead pressure the flow itself raises the pressure under the blade to ${q.p.toFixed(0)} Pa, ${((q.xe - q.x) * 1000).toFixed(1)} mm before the metering edge, where the gap is ${(q.h * 1000).toFixed(2)} mm (the 2D at the blade's end): more than the about ${q.cap.toFixed(0)} Pa (2γ/h) a surface across that gap can hold.`;
  return ans;
}
/**
 * An edge's answer, its four views and its steps (o.sfx: the canvases' id suffix, two edges on one page; o.answer false: no
 * answer, it is given above; o.title: a heading).
 */
function c3dEdgeHTML(R, stale, o = {}) {
  const sfx = o.sfx || '', f1 = v => (+v).toFixed(1), f2 = v => (+v).toFixed(2), ans = c3dEdgeAnswer(R);
  const acc = cssVar('--accent'), cols = LOC_COLORS[isDarkTheme() ? 'dark' : 'light'];
  const pane = (id, n, title, aria, legend = '') => `<figure class="pane"><figcaption>${uiBadge(n)}${title}</figcaption><canvas id="${id}" role="img" aria-label="${aria}"></canvas>${legend ? `<div class="pane-legend">${legend}</div>` : ''}</figure>`;
  const secs = R.valid ? c3dEdgeSections(R) : [];
  const steps = `<table class="kv c3d-steps"><thead><tr><th>Bead pressure</th><th>Held?</th><th>Slurry past the blade's end</th><th>Angle at the blade's end</th><th>Newton steps</th></tr></thead><tbody>${R.steps.map(s => `<tr><td>${f1(s.P)} Pa</td><td>${s.ok ? 'yes' : s.why === 'steady' ? 'no: no steady edge' : s.why === 'climb' ? 'no: climbs the end face' : 'no: spills over the web\'s edge'}</td><td>${c3dEdgeSolved(s) && Number.isFinite(s.web) ? f2(c3dEdgePast(R, s.web)) + ' mm' : '—'}</td><td>${c3dEdgeSolved(s) && Number.isFinite(s.angle) ? f1(s.angle) + '°' : '—'}</td><td>${s.it}${c3dEdgeSolved(s) ? '' : ' (not converged)'}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="c3d-edge">${o.title ? `<h4 class="c3d-end-title">${o.title}</h4>` : ''}
    ${o.answer === false ? '' : `<div class="edge-answer ${R.held ? 'ok' : 'bad'}">${ans}${stale ? ' <i>(out of date: the inputs changed since)</i>' : ''}</div>`}
    ${R.valid ? `<div class="v3d-charts">
      ${pane('c3dEdgeX' + sfx, 'film', 'The slurry round the edge, cut across the web', 'Cross-sections of the slurry round the edge at places along the flow', oneDLegend(secs.map((q, i) => [q.name, cols[i]])))}
      ${pane('c3dEdgeFilm' + sfx, 'film', 'The film across the edge, at the end of the film', 'The film surface across the edge strip where it leaves the model: the edge bead', oneDLegend([['film', acc]]))}
      ${pane('c3dEdgePlan' + sfx, 9, 'Where the slurry is, from above', 'Plan view along the flow: the contact line on the web, the top contact point under the blade, the blade\'s end and the web\'s edge', oneDLegend([['contact line on the web', acc], ['top contact point under the blade', cols[2], 'dash']]))}
      ${pane('c3dEdgeAng' + sfx, 'angle', 'The angle at the blade\'s end, along the blade', 'The slurry\'s angle with the blade at the top contact point along the blade, against the Gibbs limit', oneDLegend([['angle', acc]]))}
    </div>` : ''}
    <figure class="pane c3d-steps-pane"><figcaption>${uiBadge('table')}The bead pressure, step by step</figcaption>${steps}<p class="side-note">Solved with none, then raised step by step to the set bead pressure while the end holds it (a step that fails is halved).</p></figure>
  </div>`;
}
/**
 * The full width with its edges open: one end as an edge's view (for its four views), from the width's own solution when it
 * was solved (both ends held), else from that end's edge strip -- its steps always from the edge strip.
 */
function c3dEndView(F, end) {
  const E = F.edges[end];
  if (!F.held) return E;
  const side = end === 'left' ? 'lo' : 'hi', nE = 2 * C3D.edgeNz, NL = F.NL, l0 = side === 'lo' ? 0 : NL - 1 - nE, n = nE + 1, NC = F.NC, NR = F.NR;
  const sub = f => { const a = new Float32Array(NC * n * NR); for (let c = 0; c < NC; c++) for (let j = 0; j < n; j++) for (let k = 0; k < NR; k++) a[(c * n + j) * NR + k] = F[f][(c * NL + l0 + j) * NR + k]; return a; };
  const O = F.open[side];
  return { ...E, region: 'edge', held: true, valid: true, P: F.Pset, NC, NR, NL: n, steps: E.steps.map(q => ({ ...q, web: q.web + E.zOff - F.zOff })), cCorner: F.cCorner, cCL: F.cCL, zOff: F.zOff, x: sub('x'), y: sub('y'), z: sub('z'),
    stations: F.stations.slice(l0, l0 + n), open: { ...O, stations: O.stations.map(l => l - l0) }, fromWidth: true };
}
/** The full width with its edges open: each end's answer, side by side. */
function c3dEndsAnswers(F, stale) {
  return `<div class="c3d-ends-ans">${['left', 'right'].map(end => { const E = c3dEndView(F, end); return `<div class="edge-answer ${E.held ? 'ok' : 'bad'}">${c3dEdgeAnswer(E)}</div>`; }).join('')}</div>${stale ? '<p class="side-note"><i>Out of date: the inputs changed since.</i></p>' : ''}${F.held ? '' : '<p class="side-note">The width is solved only when both ends hold the set bead pressure: each end is shown at the most it holds.</p>'}`;
}
/** ... and each end's four views and steps, side by side. */
function c3dEndsHTML(F) {
  return `<div class="c3d-ends">${['left', 'right'].map(end => { const E = c3dEndView(F, end);
    return c3dEdgeHTML(E, false, { sfx: end === 'left' ? 'L' : 'R', answer: false, title: `The ${end} end${F.held ? ' (the width\'s own solution)' : E.valid ? ` at ${(+E.P).toFixed(1)} Pa, the most it holds (its edge strip)` : ' (its edge strip)'}` }); }).join('')}</div>`;
}
/** The stations with a film of their own: all but the edge blocks' (an edge strip; the full width with its edges open). */
const c3dFilmStations = R => R.openEdges ? R.stations.slice(2 * R.edgeM, R.NL - 2 * R.edgeM)
  : R.region === 'edge' && R.open ? R.stations.filter((_, l) => !R.open.stations.slice(1).includes(l)) : R.stations;
/** The edge's verdict as a status pill. */
const c3dEdgePill = R => R.held ? pill(`The ${R.edgeGeom.left ? 'left' : 'right'} end holds the set bead pressure (${(+R.Pset).toFixed(1)} Pa)`, 'ok')
  : pill(`The ${R.edgeGeom.left ? 'left' : 'right'} end holds ${R.valid ? `up to ${(+R.P).toFixed(1)} Pa` : 'no bead pressure'} of the ${(+R.Pset).toFixed(1)} Pa set`, 'bad');
/** The columns the cross-sections are cut at: the inlet, the metering edge, the contact line on the face, the end of the film. */
function c3dEdgeSections(R) {
  const NC = R.NC, x = c => R.x[(c * R.NL) * R.NR] * 1000;
  return [[0, 'inlet'], [R.cCorner, 'metering edge'], [R.cCL, 'contact line on the face'], [NC - 1, 'end of the film']]
    .filter((q, i, a) => a.findIndex(o => o[0] === q[0]) === i).map(([c, t]) => ({ c, name: `${t} (x ${x(c).toFixed(1)} mm)` }));
}
function c3dEdgeCharts(R, sfx = '') {
  if (R.region !== 'edge' || !R.valid) return;
  const acc = cssVar('--accent'), mut = cssVar('--muted'), bad = cssVar('--bad') || '#dc2626', cols = LOC_COLORS[isDarkTheme() ? 'dark' : 'light'], g = R.edgeGeom;
  const NL = R.NL, NR = R.NR, NC = R.NC, top = (c, l) => (c * NL + l) * NR + NR - 1, zmm = v => (v + R.zOff) * 1000;
  const refs = [{ x: g.bladeEnd, c: bad, t: 'blade\'s end' }, ...(Math.abs(g.webEdge - g.bladeEnd) > 1e-9 ? [{ x: g.webEdge, c: mut, t: 'web\'s edge' }] : [])];
  // 1: cross-sections, the slurry's top boundary (under the blade, then round the edge) at each
  { const cv = document.getElementById('c3dEdgeX' + sfx), secs = c3dEdgeSections(R);
    if (cv) {
      const lines = secs.map(q => Array.from({ length: NL }, (_, l) => [zmm(R.z[top(q.c, l)]), R.y[top(q.c, l)] * 1000]));
      const zs = lines.flat().map(p => p[0]).concat(refs.map(r => r.x)), ys = lines.flat().map(p => p[1]);
      plotChart(cv, fitAspect(cv, 0.5), { x0: Math.min(...zs), x1: Math.max(...zs), y0: 0, y1: Math.max(...ys) * 1.1, yl: 'height above the web (mm)', xl: 'z across the web (mm)', yd: 2, xd: 1, vl: refs,
        s: lines.map((p, i) => ({ p, c: cols[i], w: 2 })) });
    } }
  // 2: the film across at the end of the film, the bead against the film inside
  { const cv = document.getElementById('c3dEdgeFilm' + sfx);
    if (cv) {
      const p = Array.from({ length: NL }, (_, l) => [zmm(R.z[top(NC - 1, l)]), R.y[top(NC - 1, l)] * 1000]).sort((a, b) => a[0] - b[0]);
      const inner = R.stations[g.left ? NL - 1 : 0].film * 1000, bead = Math.max(...p.map(q => q[1])), zs = p.map(q => q[0]).concat(refs.map(r => r.x));
      const M = plotChart(cv, fitAspect(cv, 0.5), { x0: Math.min(...zs), x1: Math.max(...zs), y0: 0, y1: bead * 1.15, yl: 'film (mm)', xl: 'z across the web (mm)', yd: 3, xd: 1, vl: refs,
        hl: [{ y: inner, c: mut, t: `film inside ${inner.toFixed(3)} mm` }], s: [{ p, c: acc, w: 2.2 }] });
      const c = cv.getContext('2d'), kb = p.findIndex(q => q[1] === bead);
      c.fillStyle = acc; c.globalAlpha = 0.12; c.beginPath(); c.moveTo(M.X(p[0][0]), M.Y(0)); p.forEach(q => c.lineTo(M.X(q[0]), M.Y(q[1]))); c.lineTo(M.X(p[p.length - 1][0]), M.Y(0)); c.closePath(); c.fill(); c.globalAlpha = 1;
      c.fillStyle = bad; c.beginPath(); c.arc(M.X(p[kb][0]), M.Y(bead), 4, 0, 7); c.fill();
      // (the label below the point, clear of the lines' own labels along the top)
      c.font = '12px ' + cssVar('--sans'); c.textAlign = 'left'; c.fillText(`bead ${bead.toFixed(3)} mm (${((bead / inner - 1) * 100).toFixed(1)} % above)`, M.X(p[kb][0]) + 8, M.Y(bead) + 18);
    } }
  // 3: from above: the contact line on the web along the flow, the top contact point under the blade
  { const cv = document.getElementById('c3dEdgePlan' + sfx);
    if (cv) {
      const xs = Array.from({ length: NC }, (_, c) => R.x[(c * NL) * NR] * 1000), web = zmm(R.open.web), topZ = R.open.top.map(zmm), wall = xs.map((_, c) => Number.isFinite(R.open.angleTop[c]));
      const zAll = [web, ...topZ.filter((_, c) => wall[c]), g.bladeEnd, g.webEdge, zmm(R.stations[g.left ? NL - 1 : 0].z)];
      plotChart(cv, fitAspect(cv, 0.5), { x0: 0, x1: xs[NC - 1], y0: Math.min(...zAll) - 0.5, y1: Math.max(...zAll) + 0.5, yl: 'z across the web (mm)', xl: 'x along the flow (mm)', yd: 1, xd: 0,
        hl: [{ y: g.bladeEnd, c: bad, t: 'blade\'s end' }, ...(Math.abs(g.webEdge - g.bladeEnd) > 1e-9 ? [{ y: g.webEdge, c: mut, t: 'web\'s edge' }] : [])], vl: [{ x: xs[R.cCL], c: mut, t: 'exit face' }],
        s: [{ p: xs.map(x => [x, web]), c: acc, w: 2.2 }, { p: xs.filter((_, c) => wall[c]).map((x, i) => [x, topZ.filter((_, c) => wall[c])[i]]), c: cols[2], w: 2, dash: [5, 4] }] });
    } }
  // 4: the angle at the blade's end along the blade, against the Gibbs limit
  { const cv = document.getElementById('c3dEdgeAng' + sfx);
    if (cv) {
      const pts = []; for (let c = 0; c < NC; c++) if (Number.isFinite(R.open.angleTop[c])) pts.push([R.x[(c * NL) * NR] * 1000, R.open.angleTop[c]]);
      const lim = R.thBlade + 90, ys = pts.map(p => p[1]);
      plotChart(cv, fitAspect(cv, 0.5), { x0: 0, x1: pts[pts.length - 1][0], y0: Math.min(R.thBlade, ...ys) - 5, y1: Math.max(lim, ...ys) + 5, yl: 'angle (°)', xl: 'x along the blade (mm)', yd: 0, xd: 0,
        hl: [{ y: lim, c: bad, t: `${lim.toFixed(0)}°: it would climb the end face above` }, { y: R.thBlade, c: mut, t: `${R.thBlade.toFixed(0)}°: it would draw in along the blade below` }], s: [{ p: pts, c: acc, w: 2.2 }] });
    } }
}

// ---- the charts ----
function c3dCharts(R) {
  const acc = cssVar('--accent'), mut = cssVar('--muted');
  const full = R.region === 'full', edge = R.region === 'edge', zs = R.stations.map(s => (s.z + (full || edge ? R.zOff : 0)) * 1000), x0 = Math.min(...zs), x1 = Math.max(...zs);
  // (an edge: the 3D only -- its stations' 2D were solved with no bead pressure, to start from)
  const line = (id, a, b, yl, d) => {
    const cv = document.getElementById(id); if (!cv) return;
    const all = [...a, ...b].filter(Number.isFinite), lo = Math.min(...all), hi = Math.max(...all), pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 2e-4, 1e-6);
    plotChart(cv, fitAspect(cv, 0.5), { x0, x1, y0: lo - pad, y1: hi + pad, yl, xl: full || edge ? 'z across the web (mm)' : `z across the strip (mm), 0 = L${C3D.loc + 1}`, yd: d, xd: full ? 0 : 1,
      s: [...(b.some(Number.isFinite) ? [{ p: zs.map((z, k) => [z, b[k]]), c: mut, w: 1.6, dash: [5, 4], dots: !full }] : []), { p: zs.map((z, k) => [z, a[k]]), c: acc, w: 2.2, dots: !full }] });
  };
  if (R.openEdges) {
    // (the web's edges open: the film's surface where it leaves the model, out over each edge bead to the web; the 2D at the
    // stations with a film of their own)
    const cv = document.getElementById('c3dFilm');
    if (cv) {
      const top = l => ((R.NC - 1) * R.NL + l) * R.NR + R.NR - 1, a = Array.from({ length: R.NL }, (_, l) => [(R.z[top(l)] + R.zOff) * 1000, R.y[top(l)] * 1000]).sort((p, q) => p[0] - q[0]);
      const b = c3dFilmStations(R).map(st => [(st.z + R.zOff) * 1000, st.film2 * 1000]).filter(p => Number.isFinite(p[1])), ys = [...a, ...b].map(p => p[1]);
      plotChart(cv, fitAspect(cv, 0.5), { x0: a[0][0], x1: a[a.length - 1][0], y0: 0, y1: Math.max(...ys) * 1.08, yl: 'wet film (mm)', xl: 'z across the web (mm)', yd: 3, xd: 0,
        vl: ['left', 'right'].map(end => ({ x: R.edges[end].edgeGeom.bladeEnd, c: mut, t: 'blade\'s end' })), s: [{ p: b, c: mut, w: 1.6, dash: [5, 4] }, { p: a, c: acc, w: 2.2 }] });
    }
  } else line('c3dFilm', R.stations.map(s => s.film * 1000), R.stations.map(s => s.film2 * 1000), 'wet film (mm)', 4);
  if (R.mode === 'climbed') line('c3dCL', R.stations.map(s => s.s * 1000), R.stations.map(s => s.s2 * 1000), R.k != null ? 'contact line along the face (mm)' : 'contact line up the face (mm)', 3);
  else { const cv = document.getElementById('c3dCL'); if (cv) { const { c, w, h } = setupCanvas(cv, 0.3); c.fillStyle = mut; c.font = '13px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText('Pinned at the metering edge at every station', w / 2, h / 2); } }
  c3dPressureMap(R);
  // pressure along the blade and face at the middle station: 3D and its station's 2D (up to the contact line)
  const cv = document.getElementById('c3dPX');
  if (cv) {
    const T = R.top, n = R.cCL + 1, xs = T.x.slice(0, n).map(x => x * 1000), a = T.p3.slice(0, n), b = T.p2.slice(0, n);
    const all = [...a, ...b].filter(Number.isFinite), lo = Math.min(0, ...all), hi = Math.max(...all);
    plotChart(cv, fitAspect(cv, 0.5), { x0: 0, x1: xs[xs.length - 1], y0: lo - 0.05 * (hi - lo), y1: hi + 0.08 * (hi - lo), yl: 'pressure (Pa)', xl: 'x along the blade (mm); the last points up the exit face', yd: 0,
      s: [...(b.some(Number.isFinite) ? [{ p: xs.map((x, k) => [x, b[k]]), c: mut, w: 1.6, dash: [5, 4] }] : []), { p: xs.map((x, k) => [x, a[k]]), c: acc, w: 2.2 }] });
  }
}
/** Pressure on the blade's underside: along the flow (inlet to the metering edge) and across the strip, with its colour bar. */
function c3dPressureMap(R) {
  const cv = document.getElementById('c3dPB');
  if (!cv) return;
  const { c, w, h } = setupCanvas(cv, fitAspect(cv, 0.5));
  const NL = R.NL, NR = R.NR, nc = R.cCorner + 1, node = (cc, l) => (cc * NL + l) * NR + NR - 1;
  // (an edge: its stations whose tops are on the blade only -- beyond the top contact point, the meniscus)
  const opens = R.region === 'edge' && R.open ? [R.open] : R.openEdges && R.open ? [R.open.lo, R.open.hi] : [];
  const off = new Set(opens.flatMap(O => O.stations.slice(3))), on = Array.from({ length: NL }, (_, l) => l).filter(l => !off.has(l));
  let lo = Infinity, hi = -Infinity;
  for (let cc = 0; cc < nc; cc++) for (const l of on) { const v = R.p[node(cc, l)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const lut = c3dLut({ div: lo < 0 }), rng = lo < 0 ? { min: -Math.max(-lo, hi), max: Math.max(-lo, hi) } : { min: lo, max: hi > lo ? hi : lo + 1 };
  const m = { l: 52, r: 78, t: 24, b: 36 }, pw = w - m.l - m.r, ph = h - m.t - m.b;
  const zo = R.region === 'full' || R.region === 'edge' ? R.zOff : 0, xMax = R.xe * 1000, zOn = on.map(l => (R.z[node(0, l)] + zo) * 1000), z0 = Math.min(...zOn), z1 = Math.max(...zOn);
  const X = x => m.l + x / xMax * pw, Y = z => m.t + ph - (z - z0) / (z1 - z0) * ph;
  // cells between neighbouring nodes, each filled by the mean of its four corners
  for (let cc = 0; cc < nc - 1; cc++) for (let l = 0; l < NL - 1; l++) {
    if (off.has(l) || off.has(l + 1)) continue;
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
function v3Draw(G, R, mesh = C3D.mesh) {
  V3.mesh = mesh;   // (the step decides: v3Scene draws the mesh by it)
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
  const key = JSON.stringify([G.key, C3D.vscale, C3D.blade, C3D.slurry, C3D.web, mesh, isDarkTheme(), S && S.when, R ? C3D.field : '', FV.cmap, R && C3D.stream ? c3dStreamKey() + C3D.streamColor : '', R ? '' : P.skew]);
  if (key !== V3.key) { v3Scene(G, R); const firstView = V3.key === null || !V3.sameRegion(G); V3.key = key; V3.region = G.key; if (firstView) v3Camera(); }
  v3Render();
}
V3.sameRegion = G => V3.region && G.key && JSON.parse(V3.region).slice(0, 4).join() === JSON.parse(G.key).slice(0, 4).join();
function v3Render() { if (V3.renderer) V3.renderer.render(V3.scene, V3.camera); }
/** A skewed blade drawn in the machine frame (the web along x): positions in mm (x, y, z triples) turned in place by skew degrees about
 *  the metering edge at the region's middle (x0, z0, mm) -- the solve is in the blade's frame. None: nothing turned. */
function v3Machine(skew, x0, z0) {
  if (!skew) return null;
  const a = skew * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  return arr => { for (let i = 0; i < arr.length; i += 3) { const dx = arr[i] - x0, dz = arr[i + 2] - z0; arr[i] = x0 + dx * cs + dz * sn; arr[i + 2] = z0 - dx * sn + dz * cs; } return arr; };
}
/** Build the scene from the geometry (and a solved result: its own mesh, coloured by the field): in mm, the heights drawn C3D.vscale times larger. */
function v3Scene(G, R) {
  if (V3.group) { V3.scene.remove(V3.group); V3.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
  const grp = new THREE.Group(); grp.scale.set(1, C3D.vscale, 1); V3.group = grp; V3.scene.add(grp);
  if (R) { v3SceneSolved(G, R, grp); return; }
  if (!G.mesh) return;
  const turn = v3Machine(P.skew, G.xe * 1000, (G.rg.z0 + G.rg.z1) / 2 * 1000);
  const mm = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * 1000; return turn ? turn(o) : o; };
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
  if (V3.mesh ?? C3D.mesh) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(Array.from(m.lines));
    grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col('--ink'), transparent: true, opacity: 0.35 })));
  }
  // (the web and the view's bounds around the region as drawn: turned with a skewed blade)
  let bx0 = 0, bx1 = (G.xe + G.Ld) * 1000, bz0 = G.rg.z0 * 1000, bz1 = G.rg.z1 * 1000;
  if (turn) { bx0 = bz0 = Infinity; bx1 = bz1 = -Infinity; for (let i = 0; i < pos.length; i += 3) { bx0 = Math.min(bx0, pos[i]); bx1 = Math.max(bx1, pos[i]); bz0 = Math.min(bz0, pos[i + 2]); bz1 = Math.max(bz1, pos[i + 2]); } }
  if (C3D.web) {
    const x0 = bx0 - 2, x1 = bx1 + 2, z0 = bz0 - 2, z1 = bz1 + 2;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, -0.001, (z0 + z1) / 2);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col('--fibre'), roughness: 0.9, side: THREE.DoubleSide })));
  }
  // the bounds the camera fits: the slurry region and the blade near it (in the scaled scene)
  const b = new THREE.Box3(new THREE.Vector3(bx0 - 1, 0, bz0), new THREE.Vector3(bx1 + 1, Math.min(G.box.max[1], G.cutY) * 1000 * C3D.vscale, bz1));
  V3.bounds = b;
}
/** The solved flow: the region's outer faces (the blade's underside, the exit face and the free surface on top; the
 * web below; the strip's two sides; inlet and outlet) coloured by the field at the nodes, the element edges on them. */
function v3SceneSolved(G, R, grp) {
  const NC = R.NC, NR = R.NR, NL = R.NL, N = R.x.length, id = (c, l, k) => (c * NL + l) * NR + k;
  // (the solve's z is from the region's middle: placed where the region is across the web, as the blade is)
  const pos = new Float32Array(3 * N), zo = R.zOff || 0;
  for (let n = 0; n < N; n++) { pos[3 * n] = R.x[n] * 1000; pos[3 * n + 1] = R.y[n] * 1000; pos[3 * n + 2] = (R.z[n] + zo) * 1000; }
  const turn = v3Machine(R.skew, R.xe * 1000, zo * 1000);   // (the result's own skew)
  if (turn) turn(pos);
  const col = v => new THREE.Color(cssVar(v)), lines = C3D.stream ? v3Streamlines(R) : null, see = C3D.field !== 'none' || !!lines;
  if (C3D.blade && G.tris) {
    const g = new THREE.BufferGeometry(); const mm = Float32Array.from(G.tris, v => v * 1000);
    if (turn) turn(mm);
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
  if (V3.mesh ?? C3D.mesh) {
    // element edges on the outer faces: every other node line (the elements are 3 nodes a side)
    const li = [], seg = (a, b) => li.push(a, b);
    for (const k of [0, NR - 1]) { for (let c = 0; c < NC; c += 2) for (let l = 0; l < NL - 1; l++) seg(id(c, l, k), id(c, l + 1, k)); for (let l = 0; l < NL; l += 2) for (let c = 0; c < NC - 1; c++) seg(id(c, l, k), id(c + 1, l, k)); }
    for (const l of [0, NL - 1]) { for (let c = 0; c < NC; c += 2) for (let k = 0; k < NR - 1; k++) seg(id(c, l, k), id(c, l, k + 1)); for (let k = 0; k < NR; k += 2) for (let c = 0; c < NC - 1; c++) seg(id(c, l, k), id(c + 1, l, k)); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(li);
    grp.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: col('--ink'), transparent: true, opacity: C3D.field !== 'none' ? 0.25 : 0.35 })));
  }
  if (lines) grp.add(v3Tubes(R, lines, pos, turn));
  let xMin = Infinity, xMax = 0, yMax = 0, zMin = Infinity, zMax = -Infinity;
  for (let n = 0; n < N; n++) { xMin = Math.min(xMin, pos[3 * n]); xMax = Math.max(xMax, pos[3 * n]); yMax = Math.max(yMax, pos[3 * n + 1]); zMin = Math.min(zMin, pos[3 * n + 2]); zMax = Math.max(zMax, pos[3 * n + 2]); }
  xMin = Math.min(0, xMin);
  if (C3D.web) {
    const x0 = xMin - 2, x1 = xMax + 2, z0 = zMin - 2, z1 = zMax + 2;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, -0.001, (z0 + z1) / 2);
    grp.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col('--fibre'), roughness: 0.9, side: THREE.DoubleSide })));
  }
  V3.bounds = new THREE.Box3(new THREE.Vector3(xMin - 1, 0, zMin), new THREE.Vector3(xMax + 1, Math.min(yMax, G.cutY ? G.cutY * 1000 : yMax) * C3D.vscale, zMax));
}
/** The streamlines of a result (cfd-3d-stream.js), kept for it and the density. */
function v3Streamlines(R) {
  const S = c3dShown(), key = `${S && S.when}|${c3dStreamKey()}`;
  if (V3.sl && V3.sl.key === key) return V3.sl.lines;
  const [across, up] = (C3D_STREAM[C3D.streamDensity] || C3D_STREAM.medium)[R.region === 'full' ? 'full' : 'strip'];
  const sp = c3dSeedSpec(R), mode = C3D_STREAM_MODES[C3D.streamMode] || C3D_STREAM_MODES.volume;
  const res = streamlines3D(R, { across, up, seeds: sp.spec, hold: mode.hold, maxLength: C3D.streamLen > 0 ? C3D.streamLen / 1000 : Infinity });
  const lines = res.lines.filter(l => l.pos.length >= 6);
  // (the seeds where they are, in the web's frame, mm; and those asked for outside the flow)
  const w = sl3Work(), seedsMm = res.seeds.map(q => { sl3Eval(R, q[0], q[1], q[2], w); return c3dToMachine(R, w.x, w.y, w.z); });
  V3.sl = { key, lines, up, seeds: seedsMm, outside: res.outside.length, label: sp.label, mode: C3D.streamMode };
  return lines;
}
/** The streamlines as round tubes (in the scene's mm, heights drawn C3D.vscale times larger; the tube's own scale undoes
 *  the group's so its section stays round), coloured along their length by the field shown on the same scale as the faces. */
function v3Tubes(R, lines, pos, turn) {
  const vs = C3D.vscale, zo = R.zOff || 0, NL = R.NL, NR = R.NR, id = (c, l, k) => (c * NL + l) * NR + k;
  let xMax = 0, yMax = 0, zMin = Infinity, zMax = -Infinity, hEdge = Infinity;
  for (let n = 0; n < pos.length / 3; n++) { xMax = Math.max(xMax, pos[3 * n]); yMax = Math.max(yMax, pos[3 * n + 1]); zMin = Math.min(zMin, pos[3 * n + 2]); zMax = Math.max(zMax, pos[3 * n + 2]); }
  for (let l = 0; l < NL; l++) hEdge = Math.min(hEdge, R.y[id(R.cCorner, l, NR - 1)] * 1000 * vs);
  // (thick enough to see, thin enough that neighbours up the gap at the metering edge don't touch)
  const rad = Math.min(0.0035 * Math.hypot(xMax, yMax * vs, zMax - zMin), 0.3 * hEdge / (V3.sl.up || 10)), SEG = 8;
  // (coloured as the flow's faces, or by a field of their own)
  const ck = c3dStreamColorKey(), f = C3D_FIELDS[ck], showF = ck !== 'none', vals = showF ? new Float64Array(R.x.length) : null;
  if (showF) for (let n = 0; n < vals.length; n++) vals[n] = f.f(R, n);
  const rng = showF ? c3dFieldRange(R, ck) : null, lut = showF ? c3dLut(f) : null, plain = new THREE.Color(cssVar('--ink'));
  const P = [], N = [], Cl = [], I = [];
  for (const ln of lines) {
    // the points drawn: at least a radius apart on screen (the tracing's are much closer)
    const pts = [], cc = ln.cc, p = ln.pos, n = p.length / 3;
    for (let i = 0; i < n; i++) {
      const q = [p[3 * i] * 1000, p[3 * i + 1] * 1000 * vs, (p[3 * i + 2] + zo) * 1000];
      if (turn) turn(q);
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
