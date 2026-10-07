/*
 * mp-bench-ui.js — MP-W: a stage's multiphysics as Coating's models are: a page for each of 1D, 2D and 3D (the sub tabs
 * at the top, the stage's own page as its Results beside them), each in the steps Geometry › Mesh › Solve › Results.
 *
 *  Geometry  the domain drawn to scale (1D: the line through it; 2D: the section; 3D: the quarter in three dimensions),
 *            its parts and the Materials' records they are made of, its sizes.
 *  Mesh      the mesh the solve uses -- the solver's own (mp-core's structured block, built here as in the worker) --
 *            drawn, its numbers and quality; its elements and the time steps, editable.
 *  Solve     the equations solved together and their materials, the faces and what holds at each (drawn), the time,
 *            the solver; Solve, its progress, what it took and its balances.
 *  Results   the multiphysics answers: tiles, charts against time, a field at a moment (3D: on the quarter's faces too),
 *            the stage's own model against it, CSV.
 *
 * A stage plugs in an adapter, SWB_ADAPT[its step key] (stack-mp-ui.js: the pre heat treatment's stack; furnace-mp-ui.js:
 * the furnace's holder): its solver's state and inputs, its domain's parts and faces, its mesh's settings, its results.
 * A model with a mesh of its own (peel-mp-ui.js: the peel front) gives meshStats, meshHTML and its own drawing instead of
 * mp-core's block; one solved by load steps rather than in time names that card (timeTitle, timeCols).
 * The mesh and time settings are inputs like any other: saved in the project (OVEN.mp), one undo step each.
 */

/** The adapters, by the stage's step key ('film:stack', 'furn:runs'). */
const SWB_ADAPT = {};
/** The page's own view state: the 2D drawings true to scale or stretched through the thin layers; the 3D view's angle. */
const SWB = { scale: {}, view3: {} };
const SWB_DIMS = { 1: '1D', 2: '2D', 3: '3D' };
/** A solve's time in words: milliseconds below a tenth of a second (never "0.0 s"). */
const swbSecs = ms => (ms < 100 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`);
/** The page shown when it is a dimension page (never while the report draws the stages open). */
function swbNow() {
  if (typeof PROC_ALL !== 'undefined' && PROC_ALL) return null;
  const d = swbDimNow(), A = SWB_ADAPT[procStepKey()];
  return d && A ? { A, dim: d } : null;
}
const swbKey = (A, dim) => `${A.sk}:${dim}`;
/** A dimension page's step: as chosen, else Results once solved, else Geometry. */
function swbStep(A, dim) {
  const s = SWB_STEP[swbKey(A, dim)];
  return STEPS.some(q => q[0] === s) ? s : A.current(dim) ? 'results' : 'geometry';
}
function swbGoStep(k) {
  const n = swbNow();
  if (!n) return;
  SWB_STEP[swbKey(n.A, n.dim)] = k;
  render();
}

// ---- the mesh and time settings (OVEN.mp[stage][dim]), editable ----
/** A dimension's mesh and time settings: its own as set, over the adapter's defaults. */
function swbSettings(A, dim) {
  const def = {}; for (const f of A.meshFields(dim)) def[f.k] = f.def;
  const own = (OVEN.mp && OVEN.mp[A.key] && OVEN.mp[A.key][dim]) || {};
  const out = { ...def };
  for (const f of A.meshFields(dim)) if (Number.isFinite(own[f.k]) && own[f.k] >= f.min && own[f.k] <= f.max) out[f.k] = own[f.k];
  return out;
}
/** Set one (a value out of its range or not a whole number where one is needed: put back as it was). */
function swbSetMesh(A, dim, k, v) {
  const f = A.meshFields(dim).find(q => q.k === k);
  if (!f || !Number.isFinite(v)) return false;
  if (f.int) v = Math.round(v);
  if (v < f.min || v > f.max) return false;
  OVEN.mp = OVEN.mp || {};
  const S = OVEN.mp[A.key] = { ...(OVEN.mp[A.key] || {}) };
  S[dim] = { ...(S[dim] || {}), [k]: v };
  if (v === f.def) delete S[dim][k];
  if (!Object.keys(S[dim]).length) delete S[dim];
  if (!Object.keys(S).length) delete OVEN.mp[A.key];
  return true;
}
function swbResetMesh(A, dim) {
  if (!OVEN.mp || !OVEN.mp[A.key]) return;
  const S = { ...OVEN.mp[A.key] }; delete S[dim];
  OVEN.mp = { ...OVEN.mp, [A.key]: S };
  if (!Object.keys(S).length) { const m = { ...OVEN.mp }; delete m[A.key]; OVEN.mp = m; }
}

/** An undo step's name: the stage, the dimension and the setting changed ('Pre heat treatment 2D: elements … 16 → 24'). */
function swbUndoLabel(a, b) {
  // (the drying's: where its water leaves)
  const wa = (a.dry || {}).where || 'top', wb = (b.dry || {}).where || 'top';
  if (wa !== wb) return `Drying multiphysics: the water leaves ${wb === 'both' ? 'from the top and the underside' : 'from the top only'}`;
  for (const A of Object.values(SWB_ADAPT)) for (const dim of [1, 2, 3]) {
    const x = (a[A.key] || {})[dim] || {}, y = (b[A.key] || {})[dim] || {};
    for (const f of A.meshFields(dim)) {
      const va = x[f.k] ?? f.def, vb = y[f.k] ?? f.def;
      if (va !== vb) return `${A.t} ${SWB_DIMS[dim]}: ${undoChange(f.t.charAt(0).toLowerCase() + f.t.slice(1), va, vb)}`;
    }
  }
  return 'A multiphysics mesh';
}
// ---- the mesh, as the solver builds it ----
/** The solver's mesh for the inputs as they are (mp-core's mpMesh on the adapter's axes), cached on its key. */
const SWB_MESH = new Map();
function swbMesh(A, dim, o) {
  const ax = A.axes(dim, o), key = JSON.stringify([dim, ax.axes]);
  if (SWB_MESH.has(key)) return SWB_MESH.get(key);
  const M = mpMesh({ dim, p: 1, axes: ax.axes, mat: ax.mat });
  const out = { M, ax, stats: swbMeshStats(M, A.dofs(dim)) };
  if (SWB_MESH.size > 12) SWB_MESH.clear();
  SWB_MESH.set(key, out);
  return out;
}
/** The mesh's numbers: nodes, elements, unknowns, the band and its memory, each axis's smallest and largest element,
 *  and the elements' worst aspect ratio (their longest side over their shortest). */
function swbMeshStats(M, dpn) {
  const sizes = M.edges.map(e => { let lo = Infinity, hi = 0; for (let i = 1; i < e.length; i++) { const d = e[i] - e[i - 1]; lo = Math.min(lo, d); hi = Math.max(hi, d); } return { lo, hi }; });
  let worst = 1;
  if (M.dim > 1) {
    const d = M.edges.map(e => e.slice(1).map((x, i) => x - e[i]));
    // (a structured block: the worst element pairs one axis's longest with another's shortest -- checked element by element)
    const it = (i0, i1, i2) => { const s = [d[0][i0], d[1][i1], M.dim > 2 ? d[2][i2] : null].filter(v => v != null); return Math.max(...s) / Math.min(...s); };
    for (let i = 0; i < d[0].length; i++) for (let j = 0; j < d[1].length; j++) {
      if (M.dim === 2) worst = Math.max(worst, it(i, j));
      else for (let k = 0; k < d[2].length; k++) worst = Math.max(worst, it(i, j, k));
    }
  }
  const bw = mpBandwidth(M, dpn), unk = M.N * dpn;
  return { nodes: M.N, elems: M.E, unknowns: unk, band: bw, mb: unk * (bw + 1) * 8 / 1048576, sizes, worst };
}

// ---- drawing: a structured domain to scale ----
const swbMm = v => { const m = v * 1000; return m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : m >= 1 ? m.toFixed(2) : m.toFixed(3); };
/** A part's fill (light, its hue) and line, from its colour token. */
const swbFill = (tok, a = 0.32) => { const c = cssVar(tok) || tok, m = /^#([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return c; const v = parseInt(m[1], 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; };
/**
 * The mapping of a 2D section (x across, z up) onto the canvas: true to scale (one scale both ways, centred), or with the
 * thin layers stretched (z in bands, each band its share of the height: the adapter's). Returns { X, Z, x0, x1, z0, z1, box }.
 */
function swbFrame(w, h, L, stretched, m = { l: 104, r: 30, t: 24, b: 46 }) {
  const pw = w - m.l - m.r, ph = h - m.t - m.b, W = L.x1 - L.x0, H = L.z1 - L.z0;
  if (!stretched || !L.bands) {
    const s = Math.min(pw / W, ph / H), ox = m.l + (pw - W * s) / 2, oy = m.t + (ph + H * s) / 2;
    return { X: x => ox + (x - L.x0) * s, Z: z => oy - (z - L.z0) * s, box: [ox, oy - H * s, W * s, H * s], s };
  }
  // (stretched: the width fills the frame; up the section each band its share)
  const tot = L.bands.reduce((a, b) => a + b.share, 0), cut = [0]; L.bands.forEach(b => cut.push(cut[cut.length - 1] + b.share / tot));
  const Z = z => { for (let i = 0; i < L.bands.length; i++) { const b = L.bands[i]; if (z <= b.z1 + 1e-15 || i === L.bands.length - 1) return m.t + ph - ph * (cut[i] + (cut[i + 1] - cut[i]) * Math.max(0, Math.min(1, (z - b.z0) / (b.z1 - b.z0)))); } return m.t; };
  return { X: x => m.l + (x - L.x0) / W * pw, Z, box: [m.l, m.t, pw, ph], s: null };
}
/** A dimension line with its value: horizontal below or vertical beside the box. */
function swbDimLine(c, a, b, t, vertical, ink) {
  c.save(); c.strokeStyle = ink; c.fillStyle = ink; c.lineWidth = 1; c.font = '11.5px ' + cssVar('--mono');
  const arrow = (x, y, dx, dy) => { c.beginPath(); c.moveTo(x, y); c.lineTo(x + dx * 6 - dy * 3, y + dy * 6 + dx * 3); c.lineTo(x + dx * 6 + dy * 3, y + dy * 6 - dx * 3); c.closePath(); c.fill(); };
  c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
  if (vertical) { arrow(a[0], a[1], 0, 1); arrow(b[0], b[1], 0, -1); c.textAlign = 'right'; outlinedText(c, t, a[0] - 6, (a[1] + b[1]) / 2 + 4, ink); }
  else { arrow(a[0], a[1], 1, 0); arrow(b[0], b[1], -1, 0); c.textAlign = 'center'; outlinedText(c, t, (a[0] + b[0]) / 2, a[1] + 15, ink); }
  c.restore();
}
/**
 * A section (2D; 1D: the line drawn as a narrow strip) to scale: its parts filled, the mesh's element edges, the faces
 * and their conditions, or a field; the mirror planes dashed; the sizes. what: 'geometry' | 'mesh' | 'solve'.
 */
function swbDrawSection(cv, A, dim, o, what) {
  const L = A.layout(dim, o), stretched = SWB.scale[A.sk] === 'stretch' && !!L.bands;
  const across = dim === 1 && L.zAxis === false;   // (a 1D line along x: drawn as a strip across the page; up z: a column)
  const aspect = across ? 0.26 : dim === 1 ? 0.5 : Math.max(0.3, Math.min(0.62, stretched ? 0.5 : (L.z1 - L.z0) / (L.x1 - L.x0) + 0.12));
  const { c, w, h } = setupCanvas(cv, aspect), ink = cssVar('--ink'), mut = cssVar('--muted'), line = cssVar('--line');
  c.clearRect(0, 0, w, h);
  const F = swbFrame(w, h, L, stretched, dim === 1 && !across ? { l: w * 0.42, r: w * 0.42, t: 30, b: 30 } : undefined), X = F.X, Z = F.Z;
  // parts
  for (const p of L.parts) for (const [x0, z0, x1, z1] of p.rects) {
    c.fillStyle = what === 'mesh' ? swbFill(p.c, 0.14) : swbFill(p.c, 0.34);
    c.fillRect(X(x0), Z(z1), X(x1) - X(x0), Z(z0) - Z(z1));
    // (a stack's pieces: each piece's faces as thin lines where they show)
    if (p.layers && what === 'geometry') {
      const n = p.layers.n, dz = (z1 - z0) / n, px = Math.abs(Z(z0) - Z(z0 + dz));
      if (px >= 2.2) { c.strokeStyle = swbFill(p.c, 0.85); c.lineWidth = 0.6; c.beginPath(); for (let i = 1; i < n; i++) { const y = Z(z0 + i * dz); c.moveTo(X(x0), y); c.lineTo(X(x1), y); } c.stroke(); }
    }
    c.strokeStyle = swbFill(p.c, 0.95); c.lineWidth = 1.2; c.strokeRect(X(x0), Z(z1), X(x1) - X(x0), Z(z0) - Z(z1));
  }
  // the mesh: the element edges (a structured block: lines at the nodes' coordinates)
  if (what === 'mesh') {
    const { M } = swbMesh(A, dim, o), xs = dim === 1 ? null : M.coord[0], zs = M.coord[dim - 1], zAx = L.zAxis !== false;
    c.strokeStyle = ink; c.globalAlpha = 0.55; c.lineWidth = 0.7; c.beginPath();
    if (dim === 1) {
      // (the line's nodes, across the strip drawn for it)
      const xm0 = L.x0, xm1 = L.x1;
      for (const v of zs) { if (zAx) { c.moveTo(X(xm0), Z(v)); c.lineTo(X(xm1), Z(v)); } else { c.moveTo(X(v), Z(L.z0)); c.lineTo(X(v), Z(L.z1)); } }
    } else {
      for (const x of xs) { c.moveTo(X(x), Z(L.z0)); c.lineTo(X(x), Z(L.z1)); }
      for (const z of zs) { c.moveTo(X(L.x0), Z(z)); c.lineTo(X(L.x1), Z(z)); }
    }
    c.stroke(); c.globalAlpha = 1;
    // (the nodes, where they are far enough apart to show)
    c.fillStyle = ink;
    if (dim === 1) for (const v of zs) { const cx = zAx ? (X(L.x0) + X(L.x1)) / 2 : X(v), cy = zAx ? Z(v) : (Z(L.z0) + Z(L.z1)) / 2; c.beginPath(); c.arc(cx, cy, 2, 0, 7); c.fill(); }
  }
  // the faces and their conditions
  if (what === 'solve') {
    const faces = A.faces(dim, o);
    faces.forEach((f, i) => {
      c.save(); c.strokeStyle = f.c || ink; c.lineWidth = f.kind === 'sym' ? 1.6 : 3.2; if (f.kind === 'sym') c.setLineDash([6, 4]);
      c.beginPath(); for (const [[xa, za], [xb, zb]] of f.segs) { c.moveTo(X(xa), Z(za)); c.lineTo(X(xb), Z(zb)); } c.stroke(); c.restore();
      // (its number on the face, keyed to the table below)
      const [[xa, za], [xb, zb]] = f.segs[0], mx = (X(xa) + X(xb)) / 2, my = (Z(za) + Z(zb)) / 2;
      const ox = f.side === 'left' ? -16 : f.side === 'right' ? 16 : 0, oy = f.side === 'top' ? -14 : f.side === 'bottom' ? 16 : 0;
      c.fillStyle = f.c || ink; c.beginPath(); c.arc(mx + ox, my + oy, 9, 0, 7); c.fill();
      c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(i + 1), mx + ox, my + oy + 4);
    });
  } else {
    // the mirror planes, dashed (the domain's symmetry: the stack's middle)
    for (const s of L.mirrors || []) { c.save(); c.strokeStyle = mut; c.setLineDash([5, 4]); c.lineWidth = 1.2; c.beginPath(); c.moveTo(X(s.x0), Z(s.z0)); c.lineTo(X(s.x1), Z(s.z1)); c.stroke(); c.restore(); }
  }
  // the parts' names, beside them (geometry) -- the sizes as dimension lines
  if (what === 'geometry') {
    c.font = '600 12px ' + cssVar('--sans'); c.textAlign = 'left';
    for (const p of L.parts) { if (!p.label) continue; const [x0, z0, x1, z1] = p.rects[0], tx = p.label.at === 'out' ? X(x1) + 8 : X(x0) + 8, ty = (Z(z0) + Z(z1)) / 2 + 4;
      if (Math.abs(Z(z0) - Z(z1)) >= 14 || p.label.at === 'out') { c.textAlign = p.label.at === 'out' ? 'left' : 'left'; outlinedText(c, p.label.t, tx, ty, ink); } }
  }
  if (what !== 'solve') for (const d of L.dims || []) {
    if (d.v) { const x = X(d.at) + (d.off || -26); swbDimLine(c, [x, Z(d.a)], [x, Z(d.b)], d.t, true, mut); }
    else { const y = Z(d.at) + (d.off || 20); swbDimLine(c, [X(d.a), y], [X(d.b), y], d.t, false, mut); }
  }
  // the axes' names
  c.font = '11.5px ' + cssVar('--sans'); c.fillStyle = mut; c.textAlign = 'left';
  if (L.note) c.fillText(L.note, 8, h - 8);
  c.strokeStyle = line;
  return { X, Z, w, h };
}

// ---- drawing: a quarter in three dimensions (an isometric view, its three outer faces) ----
/**
 * The box [0, X1] × [0, Y1] × [0, Z1] seen from its outer corner (the mirror planes x = 0, y = 0 behind): its top and its
 * two outer sides, each a grid of the mesh's cells, filled by part (geometry), plain with the element edges (mesh), by
 * face condition (solve) or by a field (results: f(node index) on the faces). Returns the projection.
 */
function swbDrawIso(cv, A, o, what, field) {
  const dim = 3, L3 = A.layout(3, o), { M } = swbMesh(A, 3, o), [xs, ys, zs] = M.coord;
  const X1 = xs[xs.length - 1], Y1 = ys[ys.length - 1], Z1 = zs[zs.length - 1];
  const kz = L3.kz || 1;   // (the height drawn this many times its scale: 1, true)
  const { c, w, h } = setupCanvas(cv, 0.56), ink = cssVar('--ink'), mut = cssVar('--muted');
  c.clearRect(0, 0, w, h);
  const ca = Math.cos(Math.PI / 6), sa = Math.sin(Math.PI / 6);
  const P0 = (x, y, z) => [(x - y) * ca, (x + y) * sa - z * kz];
  const pts = [[0, 0, 0], [X1, 0, 0], [0, Y1, 0], [X1, Y1, 0], [0, 0, Z1], [X1, 0, Z1], [0, Y1, Z1], [X1, Y1, Z1]].map(p => P0(...p));
  const minX = Math.min(...pts.map(p => p[0])), maxX = Math.max(...pts.map(p => p[0])), minY = Math.min(...pts.map(p => p[1])), maxY = Math.max(...pts.map(p => p[1]));
  const m = 46, s = Math.min((w - 2 * m) / (maxX - minX), (h - 2 * m) / (maxY - minY)), ox = (w - (maxX - minX) * s) / 2 - minX * s, oy = (h - (maxY - minY) * s) / 2 - minY * s;
  const P = (x, y, z) => { const q = P0(x, y, z); return [ox + q[0] * s, oy + q[1] * s]; };
  const partAt = L3.partAt, faces = what === 'solve' ? A.faces(3, o) : null;
  const quad = (a, b, cc, d, fill, stroke) => { c.beginPath(); c.moveTo(...a); c.lineTo(...b); c.lineTo(...cc); c.lineTo(...d); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.stroke(); } };
  const lut = field ? field.lut : null;
  const colour = (ids, x, y, z, faceK) => {
    if (field) { let v = 0, n = 0; for (const id of ids) { const q = field.f(id); if (Number.isFinite(q)) { v += q; n++; } } return n ? lutColor(lut, scaleT(field.sc, v / n)) : cssVar('--soft'); }
    if (what === 'solve') { const f = faces.find(q => q.face3 && [].concat(q.face3).includes(faceK) && (!q.where || q.where(x, y, z))); return f ? swbFill(f.c || ink, 0.55) : cssVar('--soft'); }
    const p = partAt(x, y, z); return swbFill(p.c, what === 'mesh' ? 0.12 : 0.4);
  };
  const edgeC = what === 'mesh' ? swbFill(ink, 0.55) : what === 'geometry' ? null : swbFill(ink, 0.14);
  c.lineWidth = what === 'mesh' ? 0.6 : 0.4;
  // the top (z = Z1), then the side y = Y1 (its cells over x, z), then x = X1 (over y, z)
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const k = zs.length - 1, ids = [M.node([i, j, k]), M.node([i + 1, j, k]), M.node([i, j + 1, k]), M.node([i + 1, j + 1, k])];
    quad(P(xs[i], ys[j], Z1), P(xs[i + 1], ys[j], Z1), P(xs[i + 1], ys[j + 1], Z1), P(xs[i], ys[j + 1], Z1), colour(ids, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2, Z1 - 1e-12, 'z1'), edgeC);
  }
  for (let i = 0; i < xs.length - 1; i++) for (let k = 0; k < zs.length - 1; k++) {
    const j = ys.length - 1, ids = [M.node([i, j, k]), M.node([i + 1, j, k]), M.node([i, j, k + 1]), M.node([i + 1, j, k + 1])];
    quad(P(xs[i], Y1, zs[k]), P(xs[i + 1], Y1, zs[k]), P(xs[i + 1], Y1, zs[k + 1]), P(xs[i], Y1, zs[k + 1]), colour(ids, (xs[i] + xs[i + 1]) / 2, Y1 - 1e-12, (zs[k] + zs[k + 1]) / 2, 'y1'), edgeC);
  }
  for (let j = 0; j < ys.length - 1; j++) for (let k = 0; k < zs.length - 1; k++) {
    const i = xs.length - 1, ids = [M.node([i, j, k]), M.node([i, j + 1, k]), M.node([i, j, k + 1]), M.node([i, j + 1, k + 1])];
    quad(P(X1, ys[j], zs[k]), P(X1, ys[j + 1], zs[k]), P(X1, ys[j + 1], zs[k + 1]), P(X1, ys[j], zs[k + 1]), colour(ids, X1 - 1e-12, (ys[j] + ys[j + 1]) / 2, (zs[k] + zs[k + 1]) / 2, 'x1'), edgeC);
  }
  // the parts' boundaries on the visible faces (geometry and results: where the plate meets the stack)
  c.strokeStyle = swbFill(ink, 0.7); c.lineWidth = 1;
  for (const zb of L3.zLines || []) { c.beginPath(); c.moveTo(...P(0, Y1, zb)); c.lineTo(...P(X1, Y1, zb)); c.lineTo(...P(X1, 0, zb)); c.stroke(); }
  for (const xb of L3.xLines || []) { c.beginPath(); c.moveTo(...P(xb, Y1, 0)); c.lineTo(...P(xb, Y1, Z1)); c.lineTo(...P(xb, 0, Z1)); c.stroke(); }
  for (const yb of L3.yLines || []) { c.beginPath(); c.moveTo(...P(X1, yb, 0)); c.lineTo(...P(X1, yb, Z1)); c.lineTo(...P(0, yb, Z1)); c.stroke(); }
  // the box's edges; the mirror planes' edges dashed
  c.strokeStyle = ink; c.lineWidth = 1.3;
  c.beginPath(); for (const [a, b] of [[[0, Y1, 0], [X1, Y1, 0]], [[X1, Y1, 0], [X1, 0, 0]], [[X1, Y1, 0], [X1, Y1, Z1]], [[0, Y1, Z1], [X1, Y1, Z1]], [[X1, 0, Z1], [X1, Y1, Z1]], [[X1, 0, 0], [X1, 0, Z1]], [[0, Y1, 0], [0, Y1, Z1]], [[0, 0, Z1], [X1, 0, Z1]], [[0, 0, Z1], [0, Y1, Z1]]]) { c.moveTo(...P(...a)); c.lineTo(...P(...b)); } c.stroke();
  c.save(); c.setLineDash([5, 4]); c.strokeStyle = mut; c.lineWidth = 1; c.beginPath();
  for (const [a, b] of [[[0, 0, 0], [X1, 0, 0]], [[0, 0, 0], [0, Y1, 0]], [[0, 0, 0], [0, 0, Z1]]]) { c.moveTo(...P(...a)); c.lineTo(...P(...b)); } c.stroke(); c.restore();
  // the sizes along the three edges in front
  c.font = '11.5px ' + cssVar('--mono'); c.fillStyle = mut; c.textAlign = 'center';
  const lab = (a, b, t, dx, dy) => {
    const p = P(...a), q = P(...b), tw = c.measureText(t).width, al = c.textAlign;
    // (inside the panel: a label that would run off its right edge is pulled back)
    let x = (p[0] + q[0]) / 2 + dx; if (al === 'left') x = Math.min(x, w - tw - 4); else if (al === 'center') x = Math.min(Math.max(x, tw / 2 + 4), w - tw / 2 - 4);
    outlinedText(c, t, x, (p[1] + q[1]) / 2 + dy, mut);
  };
  lab([0, Y1, 0], [X1, Y1, 0], `${swbMm(X1)} mm`, -14, 18);
  lab([X1, Y1, 0], [X1, 0, 0], `${swbMm(Y1)} mm`, 16, 18);
  c.textAlign = 'left'; lab([X1, 0, 0], [X1, 0, Z1], `${swbMm(Z1)} mm${kz !== 1 ? ` (drawn ×${kz})` : ''}`, 10, 0);
  // the faces' numbers (solve), on the visible faces
  if (what === 'solve') faces.forEach((f, n) => {
    if (!f.at3) return;
    const [x, y, z] = f.at3(X1, Y1, Z1), p = P(x, y, z);
    c.fillStyle = f.c || ink; c.beginPath(); c.arc(p[0], p[1], 9, 0, 7); c.fill();
    c.fillStyle = cssVar('--surface'); c.font = '600 11px ' + cssVar('--sans'); c.textAlign = 'center'; c.fillText(String(n + 1), p[0], p[1] + 4);
  });
  return { P, w, h };
}

// ---- the page ----
/** Where each step stands, on the step bar. */
function swbStatus(A, dim, o) {
  const S = A.S(), cur = A.current(dim), busy = S.busy && S.bdim === dim, err = A.failed(dim);
  if (!o) return { geometry: { note: 'after the stage before' }, mesh: {}, solve: {}, results: {} };
  // (a model with its own mesh -- not mp-core's block -- gives its numbers itself)
  const st = A.meshStats ? A.meshStats(dim, o) : swbMesh(A, dim, o).stats;
  return {
    geometry: { state: 'done', note: A.domainShort(dim, o) },
    mesh: { state: 'done', note: `${st.nodes.toLocaleString('en')} nodes · ${st.elems.toLocaleString('en')} elements` },
    solve: { state: cur ? 'done' : busy ? 'run' : err ? 'bad' : '', note: cur ? `solved in ${swbSecs(S.res[dim].ms)}` : busy ? (S.prog ? `step ${S.prog.k} of ${S.prog.n}` : 'setting up…') : err ? 'failed' : 'not solved' },
    results: { state: cur ? '' : '', note: cur ? 'the answers' : 'nothing yet' },
  };
}
/** The step's tools: the drawing's scale (2D), Solve (and its progress), Export CSV; reset the mesh (Mesh). */
function swbTools(A, dim, step, o) {
  const S = A.S(), cur = A.current(dim), busy = S.busy && S.bdim === dim;
  const scale = dim === 2 && step !== 'results' && A.layout(2, o || A.inputs(2)).bands ? `<div class="seg seg-sm" role="tablist" aria-label="The drawing's scale" id="swbScale">${[['true', 'True scale'], ['stretch', 'Layers stretched']].map(([k, t]) => `<button type="button" role="tab" data-swbscale="${k}" aria-selected="${(SWB.scale[A.sk] || 'true') === k}">${t}</button>`).join('')}</div>` : '';
  const solve = `<button type="button" class="btn btn-primary btn-sm" id="swbSolve"${busy || cur ? ' disabled' : ''} title="${cur ? 'Solved for the inputs as they are' : !o ? `Solve the ${SWB_DIMS[dim]} (and first what it needs: the stages before it)` : dim === 3 ? A.slow3 : `Solve the ${SWB_DIMS[dim]}`}">${uiIco('play')}Solve ${SWB_DIMS[dim]}</button>`;
  const stop = busy ? `<button type="button" class="btn btn-secondary btn-sm" id="swbStop">${uiIco('stop')}Stop</button>` : '';
  const prog = busy ? `<span class="swb-prog" role="progressbar" aria-label="The solve's progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${S.prog ? Math.round(100 * S.prog.k / S.prog.n) : 0}"><i style="width:${S.prog ? (100 * S.prog.k / S.prog.n).toFixed(1) : 0}%"></i></span>` : '';
  const csv = step === 'results' ? `<button type="button" class="btn btn-secondary btn-sm" id="swbCsv"${cur ? '' : ' disabled'}>${uiIco('download')}Export CSV</button>` : '';
  const reset = step === 'mesh' ? `<button type="button" class="btn btn-secondary btn-sm" id="swbMeshReset"${OVEN.mp && OVEN.mp[A.key] && OVEN.mp[A.key][dim] ? '' : ' disabled'}>${uiIco('restart')}Default mesh</button>` : '';
  return [A.tools ? A.tools(dim, step) : '', scale, reset, step === 'solve' || step === 'results' ? solve + stop + prog : '', csv].filter(Boolean).join('');
}
/** The number tiles above a step's drawing. */
function swbTiles(A, dim, step, o) {
  if (!o) return '';
  const tile = (l, v, sub, ic) => `<div class="stat" title="${l}: ${v}"><span>${uiBadge(ic)}${l}</span><strong>${v}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const S = A.S(), r = A.current(dim) ? S.res[dim] : null;
  if (step === 'geometry') return A.geoTiles(dim, o).map(q => tile(...q)).join('');
  if (step === 'mesh' && A.meshTiles) return A.meshTiles(dim, o).map(q => tile(...q)).join('');
  const st = step === 'mesh' ? swbMesh(A, dim, o).stats : null;
  if (step === 'mesh') return [tile('Nodes', st.nodes.toLocaleString('en'), `${A.dofs(dim)} unknowns at each`, 'mesh'), tile('Elements', st.elems.toLocaleString('en'), dim === 1 ? 'linear, on a line' : dim === 2 ? 'linear quadrilaterals' : 'linear hexahedra', 'grading'),
    tile('Unknowns', st.unknowns.toLocaleString('en'), `solved together, ${A.coupled}`, 'tune'), tile('Matrix', `${st.mb < 10 ? st.mb.toFixed(1) : st.mb.toFixed(0)} MB`, `banded, ${st.band.toLocaleString('en')} wide`, 'table'),
    tile('Worst element', dim === 1 ? '—' : `${st.worst < 10 ? st.worst.toFixed(1) : st.worst.toFixed(0)} : 1`, dim === 1 ? 'a line' : 'its longest side to its shortest', 'ratio')].join('');
  if (step === 'solve') return A.solveTiles(dim, o, r).map(q => tile(...q)).join('');
  return '';
}
/** The page itself (a dimension of a stage), in moduleFrame like every page. */
function swbPage(A, dim) {
  const o = A.inputs(dim), step = swbStep(A, dim);
  if (A.S().dim !== dim) A.S().dim = dim;
  if (o && A.auto) A.auto(dim);
  const pane = (id, icon, title, aria, extra = '') => ({ id, icon, title, aria, legend: `<div id="${id}Lg"></div>${extra}` });
  const iso = dim === 3, names = A.paneTitles ? A.paneTitles(dim) : { geometry: iso ? 'The quarter in 3D, to scale' : dim === 2 ? 'The section, to scale' : 'The line through it', mesh: iso ? 'The mesh on the quarter\'s outer faces' : 'The mesh', solve: 'The faces and what holds there' };
  let panes = [], extra = '';
  if (!o) {
    // (what it needs is not solved: one panel saying so, its Solve solving that first, then this -- Phase 0, on request)
    const pend = solvePending(A.sid + dim);
    view.innerHTML = moduleFrame({ steps: stepBar('swb', step, swbStatus(A, dim, null)), panes: [], extra: `<div class="mod-extra">${emptyHint(pend ? 'Solving what it needs first…' : 'Not solved yet', `${A.why()}${pend ? '' : ' Solve solves that first, then this.'}`, pend ? '' : `<button type="button" class="btn btn-primary btn-sm" id="swbSolve">${uiIco('play')}Solve</button>`)}</div>` });
    document.getElementById('st').innerHTML = pill(`${A.t} ${SWB_DIMS[dim]}: ${pend ? 'solving what it needs first' : 'not solved yet'}`, 'muted');
    const sb = document.getElementById('swbSolve'); if (sb) sb.onclick = () => { A.request(dim); render(); };
    return;
  }
  if (step !== 'results') panes = [pane('swbCv', step === 'geometry' ? 'section' : step === 'mesh' ? 'mesh' : 'flow', names[step], `${names[step]}: ${A.domain(dim, o)}`)];
  if (step === 'geometry') extra = swbGeoHTML(A, dim, o);
  else if (step === 'mesh') extra = (A.meshHTML ? A.meshHTML(dim, o) : swbMeshHTML(A, dim, o)) + (dim === 3 && !A.meshHTML ? swbCellsHTML(A, o) : '');
  else if (step === 'solve') extra = swbSolveHTML(A, dim, o);
  else extra = A.resultsHTML(dim);
  view.innerHTML = moduleFrame({ steps: stepBar('swb', step, swbStatus(A, dim, o)), tools: swbTools(A, dim, step, o), panes, extra });
  document.getElementById('ss').innerHTML = swbTiles(A, dim, step, o);
  swbStatusPills(A, dim, o);
  if (step !== 'results') {
    const cv = document.getElementById('swbCv');
    if (A.draw) A.draw(cv, dim, o, step); else if (iso) swbDrawIso(cv, A, o, step); else swbDrawSection(cv, A, dim, o, step);
    document.getElementById('swbCvLg').innerHTML = swbLegend(A, dim, o, step);
    if (step === 'mesh' && dim === 3 && !A.meshHTML) swbCellsMount(A, o);
  } else {
    // (task 13: the results as a viewer -- its views listed, one shown, its key values beside it -- where the stage has it)
    if (A.viewer && typeof rvBuild === 'function') rvBuild(document.querySelector('#modWb .mod-extra > section'), `${A.sk}:${dim}`, A.viewNames ? A.viewNames(dim) : {});
    A.renderResults(dim);
    if (A.viewer && typeof rvAfter === 'function') rvAfter();
  }
  swbWire(A, dim);
}
/** The page's status line: where its solve stands. */
function swbStatusPills(A, dim, o) {
  const el = document.getElementById('st');
  if (!el) return;
  const S = A.S(), cur = A.current(dim), busy = S.busy && S.bdim === dim, err = A.failed(dim);
  el.innerHTML = busy ? pill(`Solving the ${SWB_DIMS[dim]}${S.prog ? `: time step ${S.prog.k} of ${S.prog.n}` : '…'}`, '')
    : cur ? pill(`Solved in ${swbSecs(S.res[dim].ms)} for the inputs as they are`, 'ok')
    : err ? pill(`The ${SWB_DIMS[dim]} could not be solved: ${dryEsc(S.error[dim])}`, 'bad')
    : S.busy ? pill(`Solving the ${SWB_DIMS[S.bdim]} first; this one next when asked`, '')
    : pill(`Not solved for the inputs as they are${dim === 3 ? ` (${A.slow3.charAt(0).toLowerCase() + A.slow3.slice(1)})` : ''}: Solve`, 'warn');
}
/** The drawing's key: the parts (geometry, mesh) or the faces' conditions (solve). */
function swbLegend(A, dim, o, step) {
  const L = A.layout(dim, o);
  if (step === 'solve') return '';
  const sw = c => `<i class="swb-sw" style="background:${swbFill(c, step === 'mesh' ? 0.3 : 0.5)};border-color:${swbFill(c, 0.95)}"></i>`;
  const parts = L.parts.filter((p, i, a) => a.findIndex(q => q.k === p.k) === i).map(p => `<span>${sw(p.c)}${p.t}</span>`).join('');
  const note = step === 'mesh' ? A.meshNote(dim, o) : A.geoNote(dim, o);
  return `<p class="swb-key">${parts}${(L.mirrors || []).length || (dim === 3 && !L.noMirror) ? '<span><i class="swb-sw swb-sw-dash"></i>a mirror plane (the domain\'s middle)</span>' : ''}</p>${note ? `<p class="fv-why">${note}</p>` : ''}`;
}
/** Geometry: the parts and their materials (each a record on Materials: open it), the domain's sizes. */
function swbGeoHTML(A, dim, o) {
  const parts = A.parts(dim, o);
  return `<div class="swb-tables">
    <section class="swb-card"><h4>${uiBadge('table')}Parts</h4>
      <table class="swb-t"><thead><tr><th scope="col">Part</th><th scope="col">Material</th><th scope="col">Size</th><th scope="col">In the ${SWB_DIMS[dim]}</th></tr></thead>
      <tbody>${parts.map(p => `<tr><th scope="row"><i class="swb-sw" style="background:${swbFill(p.c, 0.5)};border-color:${swbFill(p.c, 0.95)}"></i>${p.t}</th><td>${p.rec ? `<button type="button" class="swb-link" data-swbrec="${p.rec}" title="Open its record on Materials">${p.mat}</button>` : p.mat}</td><td>${p.size}</td><td>${p.how}</td></tr>`).join('')}</tbody></table></section>
    <section class="swb-card"><h4>${uiBadge('length')}The domain</h4>
      <table class="swb-t swb-kv"><tbody>${A.domainRows(dim, o).map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>
      <div class="prop-actions"><button type="button" class="btn btn-secondary btn-sm" data-swbinputs>${uiIco('tune')}Its inputs (inputs bar)</button></div></section>
  </div>`;
}
/** Mesh: its settings (editable: the elements, their grading, the time steps) and its numbers per axis. */
function swbMeshHTML(A, dim, o) {
  const { M, stats } = swbMesh(A, dim, o), set = swbSettings(A, dim), F = A.meshFields(dim);
  const axN = A.axisNames(dim), fmt = v => `${(v * 1000).toPrecision(3)} mm`;
  return `<div class="swb-tables">
    <section class="swb-card"><h4>${uiBadge('tune')}Mesh and time steps</h4>
      <table class="swb-t swb-set"><tbody>${F.map(f => `<tr><th scope="row"><label for="swbm_${f.k}">${f.t}</label></th><td><input type="number" id="swbm_${f.k}" data-swbm="${f.k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${set[f.k]}" aria-label="${f.t}"></td><td class="swb-u">${f.u || ''}</td><td class="swb-def">${set[f.k] === f.def ? '' : `default ${f.def}`}</td></tr>`).join('')}</tbody></table>
      <p class="fv-why">${A.meshHow(dim)}</p></section>
    <section class="swb-card"><h4>${uiBadge('grading')}Along each axis</h4>
      <table class="swb-t"><thead><tr><th scope="col">Axis</th><th scope="col">Elements</th><th scope="col">Smallest</th><th scope="col">Largest</th><th scope="col">Length</th></tr></thead>
      <tbody>${M.edges.map((e, d) => `<tr><th scope="row">${axN[d]}</th><td>${e.length - 1}</td><td>${fmt(stats.sizes[d].lo)}</td><td>${fmt(stats.sizes[d].hi)}</td><td>${fmt(e[e.length - 1] - e[0])}</td></tr>`).join('')}</tbody></table>
      <p class="fv-why">${A.extraMeshes(dim, o)}</p></section>
  </div>`;
}
/**
 * The 3D mesh in the mesh viewer (mesh-view-ui.js): the solver's own (swbMesh: mp-core's structured block of 8-node
 * hexahedra), cell by cell, before it solves; the heights drawn as the drawing above draws them (the layout's kz); first
 * coloured by aspect ratio (a block's cells are square-cornered: no non-orthogonality to show).
 */
function swbCellMesh(A, o) {
  const { M, ax } = swbMesh(A, 3, o);
  return mvPrep(JSON.stringify(['swb', A.key, ax.axes]), () => ({ mesh: ufeMesh(M), split: false }));
}
const swbKz = (A, o) => A.layout(3, o).kz || 1;
function swbCellsHTML(A, o) {
  const P = swbCellMesh(A, o), id = 'swb_' + A.key, kz = swbKz(A, o);
  return `<figure class="pane swb-cells"><figcaption>${uiBadge('mesh')}<span>The mesh, cell by cell <span class="acr-sub">the quarter the solve takes · ${P.elems.toLocaleString('en')} hexahedra of 8 nodes</span></span></figcaption>
    ${mvViewHTML(id, P, { own: true, height: kz, colour: 'aspect' })}
    <div class="pane-legend"><span>x: along the line</span><span>y: across</span><span>z: up${kz > 1 ? ` (drawn ×${kz} at first)` : ''}</span><span>The mirror planes x = 0, y = 0 at the back</span><span>Cells: checkMesh's measures, on the true heights</span><span>Drag to turn, wheel to zoom, right-drag to pan</span></div></figure>`;
}
function swbCellsMount(A, o) {
  const P = swbCellMesh(A, o), id = 'swb_' + A.key;
  if (document.querySelector(`[data-mv="${id}"]`)) mvMount(id, P, { own: true, up: 2, height: swbKz(A, o), colour: 'aspect', label: `${A.t} in 3D: the mesh, cell by cell` });
}
/** Solve: the physics (their equations and materials), the faces (keyed to the drawing), the time and the solver; after a
 *  solve, its balances. */
function swbSolveHTML(A, dim, o) {
  const faces = A.faces(dim, o), S = A.S(), r = A.current(dim) ? S.res[dim] : null;
  return `<div class="swb-tables swb-tables-1">
    <section class="swb-card"><h4>${uiBadge('method')}Physics, solved together</h4>
      <table class="swb-t"><thead><tr><th scope="col">Physics</th><th scope="col">Equation</th><th scope="col">Materials</th></tr></thead>
      <tbody>${A.physics(dim, o).map(([a, b, cc]) => `<tr><th scope="row">${a}</th><td class="mp-eq">${b}</td><td>${cc}</td></tr>`).join('')}</tbody></table>
      <p class="mp-couple"><b>Coupling</b> ${A.coupling(dim)} <button type="button" class="swb-link" data-swbready="${A.ready}">What it reads (Materials)</button></p></section>
    <section class="swb-card"><h4>${uiBadge('flow')}Boundary conditions</h4>
      <table class="swb-t"><thead><tr><th scope="col">#</th><th scope="col">Face</th>${A.bcCols.map(t => `<th scope="col">${t}</th>`).join('')}</tr></thead>
      <tbody>${faces.map((f, i) => `<tr><td><i class="swb-n" style="background:${f.c || cssVar('--ink')}">${i + 1}</i></td><th scope="row">${f.t}</th>${f.bc.map(v => `<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></section>
    <div class="swb-tables">
      <section class="swb-card"><h4>${uiBadge('period')}${A.timeTitle || 'Time'}</h4>
        <table class="swb-t"><thead><tr>${(A.timeCols || ['Stage', 'For', 'Conditions', 'Steps']).map(t => `<th scope="col">${t}</th>`).join('')}</tr></thead>
        <tbody>${A.time(dim, o).map(q => `<tr>${q.map((v, n) => n ? `<td>${v}</td>` : `<th scope="row">${v}</th>`).join('')}</tr>`).join('')}</tbody></table></section>
      <section class="swb-card"><h4>${uiBadge('tolerance')}Solver</h4>
        <table class="swb-t swb-kv"><tbody>${A.solver(dim, o, r).map(([k, v]) => `<tr><th scope="row">${k}</th><td>${v}</td></tr>`).join('')}</tbody></table></section>
    </div>
  </div>`;
}
/** The page's controls (wired once per draw: the page is drawn anew each time). */
function swbWire(A, dim) {
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.onclick = f; };
  on('swbSolve', () => { A.request(dim); render(); });
  on('swbStop', () => { A.stop(); render(); });
  on('swbCsv', () => A.csv(dim));
  on('swbMeshReset', () => { swbResetMesh(A, dim); undoCommit(); render(); });
  if (A.wire) A.wire(dim);
  view.querySelectorAll('[data-swbscale]').forEach(b => { b.onclick = () => { SWB.scale[A.sk] = b.dataset.swbscale; render(); }; });
  view.querySelectorAll('[data-swbrec]').forEach(b => { b.onclick = () => { HUB.view = 'lib'; HUB.sel = b.dataset.swbrec; HUB.tab = 'props'; navGo('materials'); }; });
  view.querySelectorAll('[data-swbinputs]').forEach(b => { b.onclick = () => A.openInputs(); });
  // (the materials it reads: the hub's readiness, this multiphysics' own opened -- MH-5)
  view.querySelectorAll('[data-swbready]').forEach(b => { b.onclick = () => hubShow({ view: 'ready', ready: b.dataset.swbready }); });
  view.querySelectorAll('input[data-swbm]').forEach(el => {
    el.onchange = () => {
      const ok = swbSetMesh(A, dim, el.dataset.swbm, parseFloat(el.value));
      if (!ok) { el.value = swbSettings(A, dim)[el.dataset.swbm]; return; }
      // (drawn again once the change event is over: it may come as the box loses its focus, and the page is drawn anew)
      undoCommit(); setTimeout(render, 0);
    };
  });
}
// (the step bar: cfd-steps.js routes a click on a 'swb' bar here)
/** A page of the stage sk (its step key) is shown. */
const swbOn = sk => { const n = swbNow(); return tab === 12 && !!n && n.A.sk === sk; };
/** A solve finished: the page drawn again when one of its stage's pages is shown (true then; else false, nothing done). */
function swbRefresh(sk) {
  if (!swbOn(sk)) return false;
  processPage(true); applyHelp();
  if (typeof decorateImageButtons === 'function') decorateImageButtons();
  return true;
}
/** While a solve runs: its progress on the page, without drawing it all again. */
function swbProgress() {
  const n = swbNow();
  if (!n) return;
  const S = n.A.S(), bar = document.querySelector('.swb-prog'), busy = S.busy && S.bdim === n.dim;
  if (!busy || !bar) { render(); return; }
  const f = S.prog ? S.prog.k / S.prog.n : 0;
  bar.firstElementChild.style.width = `${(f * 100).toFixed(1)}%`; bar.setAttribute('aria-valuenow', String(Math.round(100 * f)));
  swbStatusPills(n.A, n.dim, n.A.inputs(n.dim));
  const sb = document.querySelector('.step-bar [data-step="solve"] small'); if (sb && S.prog) sb.textContent = `step ${S.prog.k} of ${S.prog.n}`;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { swbMeshStats };
