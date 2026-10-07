/*
 * um-view.js — the mesh viewer every model's Mesh step shares (MESH-T1): a um-core.js mesh of any cells (hexahedra,
 * tetrahedra, wedges, pyramids, polyhedra) drawn as
 *   - its boundary, or the cells on one side of a cut plane (whole cells, crinkle-cut, so their shapes show on the cut);
 *   - each drawn cell shrunk toward its centre (or not), so the cells stand apart;
 *   - coloured by its type or a quality measure (OpenFOAM checkMesh's: non-orthogonality, skewness, aspect ratio; the
 *     cell's volume; a tetrahedron's radius ratio; a polyhedron's face count), with the measure's histogram.
 * umvPrepare(U): the mesh's geometry and each cell's measures, once. umvArrays(V, o): the triangles, their colours and the
 * cells' edges to draw (pure: Node checks them). umvGroup(THREE, A): those as three.js objects. umvHistogram(V, key, sel).
 * Coordinates drawn in mm. Needs um-core.js.
 */

/** The measures a cell can be coloured by: key, label, unit, how to read it (higher worse or better), the warning line. */
const UMV_MEASURES = [
  { k: 'type', l: 'Cell type', cat: true },
  { k: 'nonOrtho', l: 'Non-orthogonality', u: '°', worse: 'high', warn: 70, note: 'the largest angle between a face\'s normal and the line joining the cells on either side (OpenFOAM: above 70° is severe)' },
  { k: 'skewness', l: 'Skewness', u: '', worse: 'high', warn: 4, note: 'how far the line between the cells misses the face\'s centre, over the face\'s size (OpenFOAM: above 4 is high)' },
  { k: 'aspect', l: 'Aspect ratio', u: '', worse: 'high', warn: 1000, note: 'the cell\'s longest side over its shortest (OpenFOAM\'s measure)' },
  { k: 'volume', l: 'Cell volume', u: 'mm³', scale: 1e9, worse: 'low', log: true, note: 'each cell\'s volume' },
  { k: 'rho', l: 'Radius ratio (tetrahedra)', u: '', worse: 'low', warn: 0.1, note: '3 × the inscribed sphere\'s radius over the circumscribed one\'s: 1 for the regular tetrahedron, 0 for a flat one' },
  { k: 'faces', l: 'Faces per cell', u: '', note: 'a polyhedron\'s faces (6 for a hexahedron, 4 for a tetrahedron)' },
];
/** The cell types' colours and names (VTK's numbers, as um-core.js holds them). */
const UMV_TYPES = { 12: ['#2a78d6', 'Hexahedra'], 10: ['#eb6834', 'Tetrahedra'], 13: ['#8e6bd1', 'Wedges (prisms)'], 14: ['#d6a21e', 'Pyramids'], 42: ['#1baf7a', 'Polyhedra'] };

const umvUC = () => (typeof umGeometry === 'function' ? { umGeometry, umQuality } : require('./um-core.js'));

/** The mesh made ready to draw: its geometry, each cell's measures and faces, its box. */
function umvPrepare(U) {
  const UC = umvUC(), G = UC.umGeometry(U), Q = UC.umQuality(U, G, { cells: true }), nC = U.nC;
  // (each cell's faces, CSR)
  const cnt = new Int32Array(nC + 1);
  for (let f = 0; f < U.nF; f++) { cnt[U.own[f] + 1]++; if (f < U.nIF) cnt[U.nbr[f] + 1]++; }
  for (let c = 0; c < nC; c++) cnt[c + 1] += cnt[c];
  const cf = new Int32Array(cnt[nC]), fill = cnt.slice(0, nC);
  for (let f = 0; f < U.nF; f++) { cf[fill[U.own[f]]++] = f; if (f < U.nIF) cf[fill[U.nbr[f]]++] = f; }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], P = [U.X, U.Y, U.Z];
  for (let d = 0; d < 3; d++) for (let i = 0; i < U.nP; i++) { lo[d] = Math.min(lo[d], P[d][i]); hi[d] = Math.max(hi[d], P[d][i]); }
  return { U, G, Q, cOff: cnt, cF: cf, lo, hi };
}

/** Each cell's value of a measure (a type's index for 'type'; NaN where it does not apply). */
function umvMeasure(V, key) {
  const nC = V.U.nC, C = V.Q.cell, out = new Float64Array(nC);
  if (key === 'type') { for (let c = 0; c < nC; c++) out[c] = V.U.cType[c]; return out; }
  const m = UMV_MEASURES.find(q => q.k === key), src = C[key];
  for (let c = 0; c < nC; c++) out[c] = src[c] * (m && m.scale || 1);
  return out;
}

/** The cells a cut keeps: cut { axis (0 x, 1 y, 2 z), at (m), keep (−1 the side below, +1 above) } by their centres; none: all. */
function umvSelect(V, cut) {
  const nC = V.U.nC, sel = new Uint8Array(nC);
  if (!cut) return sel.fill(1);
  for (let c = 0; c < nC; c++) { const x = V.G.cc[3 * c + cut.axis]; sel[c] = (cut.keep > 0 ? x >= cut.at : x <= cut.at) ? 1 : 0; }
  return sel;
}

/** A value's colour, 0..1 RGB: a lookup table (Uint8, n × 3) at t in 0..1, or a blue-to-red ramp when none is given. */
function umvRamp(lut, t) {
  t = Math.min(1, Math.max(0, t));
  if (lut) { const n = lut.length / 3, i = Math.round(t * (n - 1)); return [lut[3 * i] / 255, lut[3 * i + 1] / 255, lut[3 * i + 2] / 255]; }
  const S = [[0.19, 0.30, 0.62], [0.38, 0.65, 0.85], [0.95, 0.92, 0.68], [0.96, 0.56, 0.29], [0.78, 0.19, 0.16]], x = t * (S.length - 1), i = Math.min(S.length - 2, Math.floor(x)), u = x - i;
  return [0, 1, 2].map(k => S[i][k] + (S[i + 1][k] - S[i][k]) * u);
}
const umvHex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

/**
 * What to draw. o: { cut (as umvSelect), shrink (1: none; 0.7: each cell drawn at 70 % of its size about its centre),
 * colour (a UMV_MEASURES key), range ([lo, hi] for the colours; default the shown cells' own), log, lut, scale (to mm:
 * 1000) }. The faces drawn: those between a kept cell and anything not kept (the mesh's boundary, the cut); shrunk, every
 * face of each cell on that surface. Returns { pos, nrm? (none: flat), col (per vertex), edges (line pairs), cells, faces,
 * range, area (the faces' area drawn, m², unshrunk), triFace (o.trace: each triangle's face) }.
 */
function umvArrays(V, o = {}) {
  const { U, G } = V, sel = umvSelect(V, o.cut), shrink = o.shrink ?? 1, s = o.scale ?? 1000;
  const key = o.colour || 'type', val = umvMeasure(V, key), m = UMV_MEASURES.find(q => q.k === key) || {};
  // (a face is on the surface when its cells differ in being kept: one kept and the other not, or a boundary face of a kept cell)
  const surf = f => (f < U.nIF ? sel[U.own[f]] !== sel[U.nbr[f]] : sel[U.own[f]] === 1);
  const onSurf = new Uint8Array(U.nC);
  for (let f = 0; f < U.nF; f++) if (surf(f)) { if (sel[U.own[f]]) onSurf[U.own[f]] = 1; if (f < U.nIF && sel[U.nbr[f]]) onSurf[U.nbr[f]] = 1; }
  // the colour range: the shown cells' own, unless given
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < U.nC; c++) if (onSurf[c] && !isNaN(val[c])) { lo = Math.min(lo, val[c]); hi = Math.max(hi, val[c]); }
  if (o.range) [lo, hi] = o.range;
  const useLog = (o.log ?? m.log) && lo > 0;
  const tOf = v => (useLog ? (Math.log(v) - Math.log(lo)) / ((Math.log(hi) - Math.log(lo)) || 1) : (v - lo) / ((hi - lo) || 1));
  const colOf = c => {
    if (m.cat) return umvHex((UMV_TYPES[U.cType[c]] || ['#9a9a9a'])[0]);
    return isNaN(val[c]) ? [0.62, 0.62, 0.62] : umvRamp(o.lut, tOf(val[c]));
  };
  const pos = [], col = [], edges = [], tri = o.trace ? [] : null; let faces = 0, cells = 0, area = 0;
  const P = (v, c) => { const x = [U.X[v], U.Y[v], U.Z[v]]; if (shrink === 1) return x; for (let d = 0; d < 3; d++) x[d] = G.cc[3 * c + d] + shrink * (x[d] - G.cc[3 * c + d]); return x; };
  const face = (f, c) => {
    // (outward from cell c: the face's own order from its owner, reversed from its neighbour)
    const n = U.fOff[f + 1] - U.fOff[f], ids = []; for (let i = 0; i < n; i++) ids.push(U.fV[U.fOff[f] + i]);
    if (U.own[f] !== c) ids.reverse();
    const pts = ids.map(v => P(v, c)), k = colOf(c);
    // (a polygon as a fan of triangles about its centre -- OpenFOAM's: so the faces drawn enclose each cell's own volume,
    //  however warped its faces; shrunk with the cell)
    const ctr = [0, 1, 2].map(d => (shrink === 1 ? G.fc[3 * f + d] : G.cc[3 * c + d] + shrink * (G.fc[3 * f + d] - G.cc[3 * c + d])));
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (n === 3) { if (i === 0) { for (const p of pts) { pos.push(p[0] * s, p[1] * s, p[2] * s); col.push(...k); } if (tri) tri.push(f); } }
      else { for (const p of [ctr, a, b]) { pos.push(p[0] * s, p[1] * s, p[2] * s); col.push(...k); } if (tri) tri.push(f); }
      edges.push(a[0] * s, a[1] * s, a[2] * s, b[0] * s, b[1] * s, b[2] * s);
    }
    faces++; area += Math.hypot(G.fa[3 * f], G.fa[3 * f + 1], G.fa[3 * f + 2]);
  };
  if (shrink === 1) {
    for (let f = 0; f < U.nF; f++) if (surf(f)) face(f, sel[U.own[f]] ? U.own[f] : U.nbr[f]);
    for (let c = 0; c < U.nC; c++) cells += onSurf[c];
  } else {
    for (let c = 0; c < U.nC; c++) if (onSurf[c]) { cells++; for (let i = V.cOff[c]; i < V.cOff[c + 1]; i++) face(V.cF[i], c); }
  }
  return { pos: Float32Array.from(pos), col: Float32Array.from(col), edges: Float32Array.from(edges), cells, faces, area, range: [lo, hi], log: useLog, kept: sel.reduce((a, b) => a + b, 0), ...(tri ? { triFace: Int32Array.from(tri) } : {}) };
}

/** A measure's histogram over the cells (or the kept ones): { lo, hi, counts, worst (the cell), n }, on a log scale for
 *  volumes. Types: the count of each. */
function umvHistogram(V, key, sel = null, bins = 24) {
  const val = umvMeasure(V, key), m = UMV_MEASURES.find(q => q.k === key) || {}, nC = V.U.nC;
  if (m.cat) { const t = {}; for (let c = 0; c < nC; c++) if (!sel || sel[c]) t[val[c]] = (t[val[c]] || 0) + 1; return { cat: t }; }
  let lo = Infinity, hi = -Infinity, n = 0, worst = -1;
  for (let c = 0; c < nC; c++) if ((!sel || sel[c]) && !isNaN(val[c])) {
    lo = Math.min(lo, val[c]); hi = Math.max(hi, val[c]); n++;
    if (worst < 0 || (m.worse === 'low' ? val[c] < val[worst] : val[c] > val[worst])) worst = c;
  }
  const log = m.log && lo > 0, counts = new Int32Array(bins);
  const tOf = v => (log ? (Math.log(v) - Math.log(lo)) / ((Math.log(hi) - Math.log(lo)) || 1) : (v - lo) / ((hi - lo) || 1));
  for (let c = 0; c < nC; c++) if ((!sel || sel[c]) && !isNaN(val[c])) counts[Math.min(bins - 1, Math.floor(tOf(val[c]) * bins))]++;
  return { lo, hi, log, counts, n, worst, worstValue: worst >= 0 ? val[worst] : NaN };
}

/** The arrays as three.js objects: the faces (flat-shaded, coloured per cell) and the cells' edges. */
function umvGroup(THREE, A, { edgeColor = '#1d2329', edgeOpacity = 0.35 } = {}) {
  const grp = new THREE.Group(), g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(A.pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(A.col, 3)); g.computeVertexNormals();
  grp.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
  const e = new THREE.BufferGeometry(); e.setAttribute('position', new THREE.BufferAttribute(A.edges, 3));
  grp.add(new THREE.LineSegments(e, new THREE.LineBasicMaterial({ color: new THREE.Color(edgeColor), transparent: true, opacity: edgeOpacity })));
  return grp;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { UMV_MEASURES, UMV_TYPES, umvPrepare, umvMeasure, umvSelect, umvArrays, umvHistogram, umvRamp, umvGroup };
