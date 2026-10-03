/*
 * um-core.js — the unstructured mesh: any cell type (hexahedra, tetrahedra, wedges, pyramids, polyhedra) as points,
 * faces (each a loop of points) and the cells on either side of each face, as OpenFOAM and Fluent hold a mesh. One layer
 * under every 3D model: its geometry, its quality, its export. Pure computation, no DOM.
 *
 * U = { nP, X, Y, Z (Float64Array per point), nC (cells), nF (faces), nIF (internal faces: the first nIF), fOff, fV (face
 *   f's points: fV[fOff[f] .. fOff[f+1]-1], ordered so its normal by the right-hand rule points out of its owner), own
 *   (per face: its owner cell), nbr (per internal face: the cell on the other side; own < nbr), patches: [{ name, type
 *   ('wall', 'patch', 'symmetryPlane', 'symmetry', 'empty', 'cyclic'), start, n }] (the boundary faces, in order after
 *   the internal ones), cType (per cell: UM_HEX, UM_TET, UM_WEDGE, UM_PYR -- VTK's numbers -- or UM_POLY), cOff, cV (a
 *   typed cell's points in VTK's order; none for a polyhedron) }.
 * The internal faces are in OpenFOAM's order (by owner, then neighbour), the boundary faces by patch then owner.
 *
 * umBuild(points, cells, bfaces, types): from cells [{ t (UM_*), v: [points] }] and boundary faces [{ v, tag }].
 * umFromFm(M): feed-mesh.js's Q2 mesh, each hexahedron as 8 linear ones on its 27 nodes (as fmFoam).
 * umFromFoam(files): an OpenFOAM polyMesh (the text of points, faces, owner, neighbour, boundary).
 * umGeometry(U): face centres and area vectors, cell centres and volumes -- OpenFOAM's construction (each face a fan of
 *   triangles about its points' mean, each cell a fan of pyramids about its faces' centres' mean), exact for any planar
 *   polygon and any polyhedron with planar faces.
 * umQuality(U, G): OpenFOAM's checkMesh measures (non-orthogonality, skewness, aspect ratio, openness, volumes) and the
 *   tetrahedra's own (radius ratio 3 r_in / r_circ, dihedral angles), and the face counts of the polyhedra.
 * umToFoam(U), umToVTK(U) (XML .vtu, polyhedra with their faces), umToFluent(U) (ASCII .msh).
 */

const UM_TET = 10, UM_HEX = 12, UM_WEDGE = 13, UM_PYR = 14, UM_POLY = 42;
// (each typed cell's faces, from VTK's point order; their orientation is set from the geometry)
const UM_FACES = {
  [UM_HEX]: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  [UM_TET]: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]],
  [UM_WEDGE]: [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]],
  [UM_PYR]: [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
};
const UM_NPTS = { [UM_HEX]: 8, [UM_TET]: 4, [UM_WEDGE]: 6, [UM_PYR]: 5 };
// (each typed cell mirrored: its points reordered so a left-handed cell becomes VTK's right-handed one)
const UM_MIRROR = { [UM_HEX]: [0, 3, 2, 1, 4, 7, 6, 5], [UM_TET]: [0, 2, 1, 3], [UM_WEDGE]: [0, 2, 1, 3, 5, 4], [UM_PYR]: [0, 3, 2, 1, 4] };

/** A typed cell's points in VTK's right-handed order: its volume by its faces as VTK lists them (outward for a right-
 *  handed cell) positive, else mirrored. */
function umOrient(t, v, P) {
  let V = 0;
  for (const f of UM_FACES[t]) { const g = umFace(i => P(v[f[i]]), f.length); V += g.a[0] * g.c[0] + g.a[1] * g.c[1] + g.a[2] * g.c[2]; }
  return V < 0 ? UM_MIRROR[t].map(k => v[k]) : v;
}

/** A polygon's centre and area vector (OpenFOAM's: a triangle fan about the points' mean, each triangle's centroid
 *  weighted by its area). P: (i) => [x, y, z]; returns { c: [3], a: [3] }. */
function umFace(P, n) {
  if (n === 3) {
    const p0 = P(0), p1 = P(1), p2 = P(2);
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    return { c: [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3],
      a: [(u[1] * v[2] - u[2] * v[1]) / 2, (u[2] * v[0] - u[0] * v[2]) / 2, (u[0] * v[1] - u[1] * v[0]) / 2] };
  }
  const m = [0, 0, 0]; for (let i = 0; i < n; i++) { const p = P(i); m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; }
  m[0] /= n; m[1] /= n; m[2] /= n;
  const sN = [0, 0, 0], sAc = [0, 0, 0]; let sA = 0;
  for (let i = 0; i < n; i++) {
    const p = P(i), q = P((i + 1) % n);
    const e = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], r = [m[0] - p[0], m[1] - p[1], m[2] - p[2]];
    const nn = [e[1] * r[2] - e[2] * r[1], e[2] * r[0] - e[0] * r[2], e[0] * r[1] - e[1] * r[0]], a = Math.hypot(nn[0], nn[1], nn[2]);
    for (let k = 0; k < 3; k++) { sN[k] += nn[k]; sAc[k] += a * (p[k] + q[k] + m[k]); }
    sA += a;
  }
  return { c: sA > 0 ? sAc.map(v => v / (3 * sA)) : m, a: sN.map(v => v / 2) };
}

/** The mesh from cells and boundary faces. points: [[x, y, z]] (or { X, Y, Z }); cells: [{ t, v }] (v: the points, in
 *  VTK's order for a typed cell; a polyhedron gives its faces instead: { t: UM_POLY, f: [[points], ...] }); bfaces:
 *  [{ v, tag }] (every boundary face, tagged), or a function (centre, outward unit normal) => tag; types: { tag: OpenFOAM
 *  patch type } (default 'patch'). Points no cell uses are dropped. */
function umBuild(points, cells, bfaces, types = {}) {
  const PX = points.X ? i => [points.X[i], points.Y[i], points.Z[i]] : i => points[i];
  const nP0 = points.X ? points.X.length : points.length;
  // (the points in use, renumbered in the order first met)
  const map = new Int32Array(nP0).fill(-1); let nP = 0;
  const use = v => { if (map[v] < 0) map[v] = nP++; return map[v]; };
  const cellFaces = [], cType = new Uint8Array(cells.length), cOff = [0], cV = [];
  cells.forEach((c, ci) => {
    cType[ci] = c.t;
    if (c.t === UM_POLY) { cellFaces.push(c.f.map(f => f.map(use))); cOff.push(cV.length); return; }
    const v = umOrient(c.t, c.v, PX).map(use); cV.push(...v); cOff.push(cV.length);
    cellFaces.push(UM_FACES[c.t].map(f => f.map(k => v[k])));
  });
  const X = new Float64Array(nP), Y = new Float64Array(nP), Z = new Float64Array(nP);
  for (let i = 0; i < nP0; i++) if (map[i] >= 0) { const p = PX(i); X[map[i]] = p[0]; Y[map[i]] = p[1]; Z[map[i]] = p[2]; }
  const P = i => [X[i], Y[i], Z[i]];
  // each cell's centre (its points' mean) to orient its faces
  const cc = cellFaces.map(fs => { const s = [0, 0, 0]; let n = 0; for (const f of fs) for (const v of f) { s[0] += X[v]; s[1] += Y[v]; s[2] += Z[v]; n++; } return s.map(x => x / n); });
  const key = f => [...f].sort((a, b) => a - b).join(',');
  const faces = new Map();
  cellFaces.forEach((fs, ci) => fs.forEach(f => {
    const k = key(f), s = faces.get(k);
    if (s) { if (s.nb >= 0) throw new Error(`a face shared by three cells (${s.own}, ${s.nb}, ${ci})`); s.nb = ci; return; }
    const g = umFace(i => P(f[i]), f.length), d = [g.c[0] - cc[ci][0], g.c[1] - cc[ci][1], g.c[2] - cc[ci][2]];
    faces.set(k, { f: g.a[0] * d[0] + g.a[1] * d[1] + g.a[2] * d[2] < 0 ? [...f].reverse() : f, own: ci, nb: -1 });
  }));
  const byFn = typeof bfaces === 'function', tagOf = new Map(), order = [];
  if (!byFn) for (const b of bfaces) { tagOf.set(key(b.v.map(v => map[v])), b.tag); if (!order.includes(b.tag)) order.push(b.tag); }
  const internal = [], bnd = [];
  for (const [k, s] of faces) {
    if (s.nb >= 0) { if (s.nb < s.own) { const t = s.own; s.own = s.nb; s.nb = t; s.f = [...s.f].reverse(); } internal.push(s); continue; }
    let tag;
    if (byFn) { const g = umFace(i => P(s.f[i]), s.f.length), m = Math.hypot(...g.a); tag = bfaces(g.c, g.a.map(x => x / m)); if (!order.includes(tag)) order.push(tag); }
    else tag = tagOf.get(k);
    if (tag === undefined) throw new Error(`a boundary face without a tag (cell ${s.own})`);
    s.tag = tag; bnd.push(s);
  }
  internal.sort((a, b) => a.own - b.own || a.nb - b.nb);
  const tags = order, ti = new Map(tags.map((t, i) => [t, i]));
  bnd.sort((a, b) => ti.get(a.tag) - ti.get(b.tag) || a.own - b.own);
  const all = [...internal, ...bnd], nF = all.length;
  const fOff = new Int32Array(nF + 1); for (let f = 0; f < nF; f++) fOff[f + 1] = fOff[f] + all[f].f.length;
  const fV = new Int32Array(fOff[nF]); all.forEach((s, f) => fV.set(s.f, fOff[f]));
  const patches = []; let start = internal.length;
  for (const t of tags) { const n = bnd.filter(b => b.tag === t).length; if (n) patches.push({ name: t, type: types[t] || 'patch', start, n }); start += n; }
  return { nP, X, Y, Z, nC: cells.length, nF, nIF: internal.length, fOff, fV, own: Int32Array.from(all, s => s.own), nbr: Int32Array.from(internal, s => s.nb),
    patches, cType, cOff: Int32Array.from(cOff), cV: Int32Array.from(cV) };
}

/** feed-mesh.js's Q2 hexahedra, each as 8 linear hexahedra on its 27 nodes; the boundary faces' tags its own. */
function umFromFm(M, types = {}) {
  const L = (a, b, g) => (g * 3 + b) * 3 + a, cells = [], bfaces = [];
  for (let e = 0; e < M.nE; e++) for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
    const n = (aa, bb, gg) => M.elems[27 * e + L(a + aa, b + bb, g + gg)];
    // (VTK's hexahedron: a quad, then the one above it; the right-handedness is fixed by the faces' orientation)
    cells.push({ t: UM_HEX, v: [n(0, 0, 0), n(1, 0, 0), n(1, 0, 1), n(0, 0, 1), n(0, 1, 0), n(1, 1, 0), n(1, 1, 1), n(0, 1, 1)] });
  }
  const FMF = (typeof FM_FACES !== 'undefined' ? FM_FACES : require('./feed-mesh.js').FM_FACES);
  for (const { e, f, tag } of M.faces) {
    const ids = FMF[f].map(i => M.elems[27 * e + i]);
    for (let t = 0; t < 2; t++) for (let s = 0; s < 2; s++) bfaces.push({ v: [ids[t * 3 + s], ids[t * 3 + s + 1], ids[(t + 1) * 3 + s + 1], ids[(t + 1) * 3 + s]], tag });
  }
  return umBuild({ X: M.X, Y: M.Y, Z: M.Z }, cells, bfaces, types);
}

/** Every face's centre and area vector, every cell's centre and volume (OpenFOAM's primitiveMesh construction). */
function umGeometry(U) {
  const { nF, nC, fOff, fV, X, Y, Z, own, nbr, nIF } = U;
  const fc = new Float64Array(3 * nF), fa = new Float64Array(3 * nF);
  for (let f = 0; f < nF; f++) {
    const o = fOff[f], g = umFace(i => { const v = fV[o + i]; return [X[v], Y[v], Z[v]]; }, fOff[f + 1] - o);
    fc.set(g.c, 3 * f); fa.set(g.a, 3 * f);
  }
  // (each cell: an estimate, its faces' centres' mean; then the pyramids from it to each face)
  const est = new Float64Array(3 * nC), cnt = new Float64Array(nC);
  const add = (c, f) => { for (let k = 0; k < 3; k++) est[3 * c + k] += fc[3 * f + k]; cnt[c]++; };
  for (let f = 0; f < nF; f++) { add(own[f], f); if (f < nIF) add(nbr[f], f); }
  for (let c = 0; c < nC; c++) for (let k = 0; k < 3; k++) est[3 * c + k] /= cnt[c];
  const cv = new Float64Array(nC), cc = new Float64Array(3 * nC);
  const pyr = (c, f, sgn) => {
    let v = 0; for (let k = 0; k < 3; k++) v += fa[3 * f + k] * (fc[3 * f + k] - est[3 * c + k]); v *= sgn;
    for (let k = 0; k < 3; k++) cc[3 * c + k] += v * (0.75 * fc[3 * f + k] + 0.25 * est[3 * c + k]);
    cv[c] += v;
  };
  for (let f = 0; f < nF; f++) { pyr(own[f], f, 1); if (f < nIF) pyr(nbr[f], f, -1); }
  for (let c = 0; c < nC; c++) { const v = Math.abs(cv[c]) > 1e-300 ? cv[c] : 1e-300; for (let k = 0; k < 3; k++) cc[3 * c + k] /= v; cv[c] /= 3; }
  return { fc, fa, cc, cv };
}

/** The tetrahedron's radius ratio (3 r_in / r_circ: 1 for the regular one) and its six dihedral angles (degrees). */
function umTetQuality(p) {
  const s = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], nrm = a => Math.hypot(a[0], a[1], a[2]);
  const a = s(p[0], p[1]), b = s(p[0], p[2]), c = s(p[0], p[3]), six = dot(a, cr(b, c)), V = Math.abs(six) / 6;
  // (the circumcentre from p0: (|a|²(b×c) + |b|²(c×a) + |c|²(a×b)) / (2 a·(b×c)))
  const A2 = dot(a, a), B2 = dot(b, b), C2 = dot(c, c), bc = cr(b, c), ca = cr(c, a), ab = cr(a, b);
  const o = [0, 1, 2].map(k => (A2 * bc[k] + B2 * ca[k] + C2 * ab[k]) / (2 * six)), R = nrm(o);
  const F = [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]], fn = F.map(f => cr(s(p[f[0]], p[f[1]]), s(p[f[0]], p[f[2]])));
  const area = fn.reduce((t, n) => t + nrm(n) / 2, 0), r = 3 * V / area;
  // (each edge: the two faces that do not hold the opposite pair of points; the dihedral angle π − the angle between
  //  their outward normals; normals made outward by the fourth point)
  const out = F.map((f, i) => { const n = fn[i], q = p[i]; return dot(n, s(p[f[0]], q)) > 0 ? n.map(x => -x) : n; });
  const dih = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const cos = dot(out[i], out[j]) / (nrm(out[i]) * nrm(out[j]));
    dih.push(180 - Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI);
  }
  return { rho: 3 * r / R, dih, V };
}

/** OpenFOAM checkMesh's measures (primitiveMeshTools: faceOrthogonality -- its average the angle of the internal faces'
 *  mean cosine, as checkMesh prints it -- faceSkewness, cellClosedness), the volumes,
 *  the tetrahedra's radius ratios and dihedral angles, the polyhedra's face counts. */
function umQuality(U, G = umGeometry(U)) {
  const { nF, nIF, nC, own, nbr, fOff, fV, X, Y, Z } = U, { fc, fa, cc, cv } = G;
  const d3 = (i, A, j, B) => [A[3 * i] - B[3 * j], A[3 * i + 1] - B[3 * j + 1], A[3 * i + 2] - B[3 * j + 2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], mag = a => Math.hypot(a[0], a[1], a[2]);
  let noMax = 0, noSum = 0, noSevere = 0, skMax = 0;
  // (skewness, OpenFOAM's: the face centre's offset from where the line d through it meets the face, over the face's
  //  extent that way -- the largest of its points' distances from its centre along the offset, and k |d|)
  const Cpf = f => d3(f, fc, own[f], cc);
  const skew = (f, C, d, k) => {
    const S = [fa[3 * f], fa[3 * f + 1], fa[3 * f + 2]], t = dot(S, C) / (dot(S, d) + 1e-300);
    const sv = [C[0] - t * d[0], C[1] - t * d[1], C[2] - t * d[2]], m = mag(sv), h = sv.map(x => x / (m + 1e-300));
    let fd = k * mag(d) + 1e-300;
    for (let i = fOff[f]; i < fOff[f + 1]; i++) { const v = fV[i]; fd = Math.max(fd, Math.abs(h[0] * (X[v] - fc[3 * f]) + h[1] * (Y[v] - fc[3 * f + 1]) + h[2] * (Z[v] - fc[3 * f + 2]))); }
    return m / fd;
  };
  for (let f = 0; f < nF; f++) {
    const S = [fa[3 * f], fa[3 * f + 1], fa[3 * f + 2]];
    if (f < nIF) {
      const d = d3(nbr[f], cc, own[f], cc), c = dot(d, S) / (mag(d) * mag(S)), ang = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
      noMax = Math.max(noMax, ang); noSum += Math.max(-1, Math.min(1, c)); if (ang > 70) noSevere++;
      skMax = Math.max(skMax, skew(f, Cpf(f), d, 0.2));
    } else {
      const C = Cpf(f), n = S.map(x => x / (mag(S) + 1e-300)), dn = dot(n, C);
      skMax = Math.max(skMax, skew(f, C, n.map(x => x * dn), 0.4));
    }
  }
  // (closedness and aspect ratio: each cell's face area vectors summed, and their components' magnitudes summed)
  const sC = new Float64Array(3 * nC), sM = new Float64Array(3 * nC);
  for (let f = 0; f < nF; f++) for (let k = 0; k < 3; k++) {
    sC[3 * own[f] + k] += fa[3 * f + k]; sM[3 * own[f] + k] += Math.abs(fa[3 * f + k]);
    if (f < nIF) { sC[3 * nbr[f] + k] -= fa[3 * f + k]; sM[3 * nbr[f] + k] += Math.abs(fa[3 * f + k]); }
  }
  let openMax = 0, arMax = 0, vMin = Infinity, vMax = -Infinity, vTot = 0, neg = 0;
  for (let c = 0; c < nC; c++) {
    let op = 0, mn = Infinity, mx = -Infinity;
    for (let k = 0; k < 3; k++) { op = Math.max(op, Math.abs(sC[3 * c + k]) / (sM[3 * c + k] + 1e-150)); mn = Math.min(mn, sM[3 * c + k]); mx = Math.max(mx, sM[3 * c + k]); }
    const v = Math.max(1e-150, cv[c]);
    const ar = Math.max(mx / (mn + 1e-150), (sM[3 * c] + sM[3 * c + 1] + sM[3 * c + 2]) / 6 / Math.pow(v, 2 / 3));
    openMax = Math.max(openMax, op); arMax = Math.max(arMax, ar);
    vMin = Math.min(vMin, cv[c]); vMax = Math.max(vMax, cv[c]); vTot += cv[c]; if (!(cv[c] > 0)) neg++;
  }
  // the cell types; each tetrahedron's radius ratio and dihedral angles; each polyhedron's face count
  const nFc = new Int32Array(nC); for (let f = 0; f < nF; f++) { nFc[own[f]]++; if (f < nIF) nFc[nbr[f]]++; }
  const types = {}; for (let c = 0; c < nC; c++) { const t = U.cType[c]; types[t] = (types[t] || 0) + 1; }
  let rhoMin = Infinity, rhoSum = 0, nTet = 0, dMin = Infinity, dMax = -Infinity, pfMin = Infinity, pfMax = 0, pfSum = 0, nPoly = 0;
  for (let c = 0; c < nC; c++) {
    if (U.cType[c] === UM_TET && U.cOff[c + 1] - U.cOff[c] === 4) {
      const p = [0, 1, 2, 3].map(k => { const v = U.cV[U.cOff[c] + k]; return [X[v], Y[v], Z[v]]; }), q = umTetQuality(p);
      rhoMin = Math.min(rhoMin, q.rho); rhoSum += q.rho; nTet++; dMin = Math.min(dMin, ...q.dih); dMax = Math.max(dMax, ...q.dih);
    } else if (U.cType[c] === UM_POLY) { pfMin = Math.min(pfMin, nFc[c]); pfMax = Math.max(pfMax, nFc[c]); pfSum += nFc[c]; nPoly++; }
  }
  return {
    cells: nC, faces: nF, internalFaces: nIF, points: U.nP, types,
    nonOrthoMax: noMax, nonOrthoAvg: nIF ? Math.acos(noSum / nIF) * 180 / Math.PI : 0, nonOrthoSevere: noSevere, skewnessMax: skMax, aspectMax: arMax, opennessMax: openMax,
    volumeMin: vMin, volumeMax: vMax, volumeTotal: vTot, negativeVolumes: neg,
    ...(nTet ? { tet: { n: nTet, rhoMin, rhoMean: rhoSum / nTet, dihedralMin: dMin, dihedralMax: dMax } } : {}),
    ...(nPoly ? { poly: { n: nPoly, facesMin: pfMin, facesMax: pfMax, facesMean: pfSum / nPoly } } : {}),
  };
}

// ---- OpenFOAM ----

const UM_HDR = (cls, obj) => `FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       ${cls};\n    location    "constant/polyMesh";\n    object      ${obj};\n}\n\n`;

/** The mesh as OpenFOAM's polyMesh files (text): { points, faces, owner, neighbour, boundary }. */
function umToFoam(U) {
  const nums = (n, f) => { const out = new Array(n); for (let i = 0; i < n; i++) out[i] = f(i); return out.join('\n'); };
  const g = v => String(+v.toPrecision(15));
  return {
    points: UM_HDR('vectorField', 'points') + `${U.nP}\n(\n` + nums(U.nP, i => `(${g(U.X[i])} ${g(U.Y[i])} ${g(U.Z[i])})`) + '\n)\n',
    faces: UM_HDR('faceList', 'faces') + `${U.nF}\n(\n` + nums(U.nF, f => `${U.fOff[f + 1] - U.fOff[f]}(${Array.from(U.fV.subarray(U.fOff[f], U.fOff[f + 1])).join(' ')})`) + '\n)\n',
    owner: UM_HDR('labelList', 'owner') + `${U.nF}\n(\n` + nums(U.nF, f => U.own[f]) + '\n)\n',
    neighbour: UM_HDR('labelList', 'neighbour') + `${U.nIF}\n(\n` + nums(U.nIF, f => U.nbr[f]) + '\n)\n',
    boundary: UM_HDR('polyBoundaryMesh', 'boundary') + `${U.patches.length}\n(\n` + U.patches.map(p =>
      `    ${p.name}\n    {\n        type            ${p.type};\n        nFaces          ${p.n};\n        startFace       ${p.start};\n    }\n`).join('') + ')\n',
  };
}

/** An OpenFOAM polyMesh (the files' text) as the mesh. Each cell typed by its faces (4 triangles: a tetrahedron, 6
 *  quadrilaterals: a hexahedron, 2 triangles and 3 quadrilaterals: a wedge, 1 and 4: a pyramid; else a polyhedron); a
 *  tetrahedron's points recovered in VTK's right-handed order (the others are kept as their faces). */
function umFromFoam(T) {
  const body = t => { t = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''); const h = t.indexOf('FoamFile'); if (h >= 0) t = t.slice(t.indexOf('}', h) + 1); return t; };
  const tok = t => body(t).match(/-?[0-9.eE+-]+|\(|\)/g) || [];
  // points: n ( (x y z) ... )
  const tp = tok(T.points); let i = 0; const nP = +tp[i++]; i++;
  const X = new Float64Array(nP), Y = new Float64Array(nP), Z = new Float64Array(nP);
  for (let p = 0; p < nP; p++) { i++; X[p] = +tp[i++]; Y[p] = +tp[i++]; Z[p] = +tp[i++]; i++; }
  // faces: n ( k(a b c ...) ... ) -- a face of more than 10 points written over several lines reads the same
  const tf = tok(T.faces); i = 0; const nF = +tf[i++]; i++;
  const fOff = new Int32Array(nF + 1), fv = [];
  for (let f = 0; f < nF; f++) { const k = +tf[i++]; i++; for (let j = 0; j < k; j++) fv.push(+tf[i++]); i++; fOff[f + 1] = fv.length; }
  const list = t => { const a = tok(t); const n = +a[0]; return Int32Array.from(a.slice(2, 2 + n), Number); };
  const own = list(T.owner), nbr = list(T.neighbour), nIF = nbr.length;
  let nC = 0; for (let f = 0; f < nF; f++) nC = Math.max(nC, own[f] + 1); for (let f = 0; f < nIF; f++) nC = Math.max(nC, nbr[f] + 1);
  const patches = []; const b = body(T.boundary);
  for (const m of b.matchAll(/(\w+)\s*\{([^}]*)\}/g)) {
    const typ = (m[2].match(/\btype\s+(\w+);/) || [])[1], n = (m[2].match(/\bnFaces\s+(\d+);/) || [])[1], s = (m[2].match(/\bstartFace\s+(\d+);/) || [])[1];
    if (typ && n !== undefined && s !== undefined) patches.push({ name: m[1], type: typ, start: +s, n: +n });
  }
  const U = { nP, X, Y, Z, nC, nF, nIF, fOff, fV: Int32Array.from(fv), own, nbr, patches, cType: new Uint8Array(nC), cOff: new Int32Array(nC + 1), cV: null };
  // (each cell's faces, to type it)
  const cf = Array.from({ length: nC }, () => []);
  for (let f = 0; f < nF; f++) { cf[own[f]].push(f); if (f < nIF) cf[nbr[f]].push(f); }
  const cV = [];
  for (let c = 0; c < nC; c++) {
    const n3 = cf[c].filter(f => fOff[f + 1] - fOff[f] === 3).length, n4 = cf[c].filter(f => fOff[f + 1] - fOff[f] === 4).length, nf = cf[c].length;
    let t = UM_POLY;
    if (nf === 4 && n3 === 4) t = UM_TET; else if (nf === 6 && n4 === 6) t = UM_HEX; else if (nf === 5 && n3 === 2 && n4 === 3) t = UM_WEDGE; else if (nf === 5 && n3 === 4 && n4 === 1) t = UM_PYR;
    U.cType[c] = t;
    if (t === UM_TET) {
      // (a face's three points, then the fourth: any order makes a tetrahedron for its measures)
      const f0 = cf[c][0], v = Array.from(U.fV.subarray(fOff[f0], fOff[f0 + 1]));
      for (const f of cf[c]) for (const p of U.fV.subarray(fOff[f], fOff[f + 1])) if (!v.includes(p)) v.push(p);
      cV.push(...umOrient(UM_TET, v, p => [X[p], Y[p], Z[p]]));
    }
    U.cOff[c + 1] = cV.length;
  }
  U.cV = Int32Array.from(cV);
  return U;
}

// ---- VTK (XML unstructured grid) ----

/** The mesh as a VTK XML unstructured grid (.vtu, ASCII): the typed cells by their points, every other cell a
 *  polyhedron (VTK_POLYHEDRON) with its faces; cell data: the cell type and volume. */
function umToVTK(U, G = umGeometry(U)) {
  const conn = [], offs = [], types = [], faces = [], foffs = [];
  const cf = Array.from({ length: U.nC }, () => []);
  for (let f = 0; f < U.nF; f++) { cf[U.own[f]].push(f); if (f < U.nIF) cf[U.nbr[f]].push(f); }
  for (let c = 0; c < U.nC; c++) {
    const t = U.cType[c], n = U.cOff[c + 1] - U.cOff[c];
    if (t !== UM_POLY && n === UM_NPTS[t] && t !== UM_TET || (t === UM_TET && n === 4)) {
      for (let k = 0; k < n; k++) conn.push(U.cV[U.cOff[c] + k]);
      types.push(t); foffs.push(-1);
    } else {
      // (a polyhedron: its points once each, then its faces, each outward)
      const pts = []; for (const f of cf[c]) for (const p of U.fV.subarray(U.fOff[f], U.fOff[f + 1])) if (!pts.includes(p)) pts.push(p);
      conn.push(...pts); types.push(UM_POLY);
      faces.push(cf[c].length);
      for (const f of cf[c]) { const v = Array.from(U.fV.subarray(U.fOff[f], U.fOff[f + 1])); if (U.own[f] !== c) v.reverse(); faces.push(v.length, ...v); }
      foffs.push(faces.length);
    }
    offs.push(conn.length);
  }
  const arr = (name, type, nc, data) => `        <DataArray type="${type}" Name="${name}"${nc ? ` NumberOfComponents="${nc}"` : ''} format="ascii">\n          ${data.join(' ')}\n        </DataArray>\n`;
  const pts = []; for (let i = 0; i < U.nP; i++) pts.push(U.X[i], U.Y[i], U.Z[i]);
  const poly = faces.length > 0;
  return '<?xml version="1.0"?>\n<VTKFile type="UnstructuredGrid" version="0.1" byte_order="LittleEndian">\n  <UnstructuredGrid>\n' +
    `    <Piece NumberOfPoints="${U.nP}" NumberOfCells="${U.nC}">\n      <Points>\n` + arr('Points', 'Float64', 3, pts) + '      </Points>\n      <Cells>\n' +
    arr('connectivity', 'Int64', 0, conn) + arr('offsets', 'Int64', 0, offs) + arr('types', 'UInt8', 0, types) +
    (poly ? arr('faces', 'Int64', 0, faces) + arr('faceoffsets', 'Int64', 0, foffs) : '') + '      </Cells>\n      <CellData>\n' +
    arr('cellType', 'Int32', 0, Array.from(U.cType)) + arr('volume', 'Float64', 0, Array.from(G.cv)) + '      </CellData>\n    </Piece>\n  </UnstructuredGrid>\n</VTKFile>\n';
}

// ---- Fluent (ASCII .msh) ----

/** The mesh as a Fluent mesh file (ASCII): the points, the cells (one fluid zone, mixed), the faces (the internal
 *  ones, then one zone per patch), each face by its points and the cells on either side (Fluent's c0 the cell its
 *  right-hand normal points away from: the owner, c1 the neighbour or 0 on the boundary). */
function umToFluent(U, name = 'fluid') {
  const hx = n => n.toString(16), out = [];
  const BC = { wall: 3, patch: 5, symmetryPlane: 7, symmetry: 7, empty: 7, cyclic: 12 };
  out.push(`(0 "um-core.js: ${U.nC} cells, ${U.nF} faces, ${U.nP} points")`, '(2 3)');
  out.push(`(10 (0 1 ${hx(U.nP)} 0 3))`, `(10 (1 1 ${hx(U.nP)} 1 3)(`);
  for (let i = 0; i < U.nP; i++) out.push(`${U.X[i].toPrecision(15)} ${U.Y[i].toPrecision(15)} ${U.Z[i].toPrecision(15)}`);
  out.push('))', `(12 (0 1 ${hx(U.nC)} 0))`);
  // (the cells' element types, Fluent's: 2 tetrahedron, 4 hexahedron, 5 pyramid, 6 wedge, 7 polyhedron; one type for
  //  the zone, or 0 'mixed' and each cell's)
  const FT = { [UM_TET]: 2, [UM_HEX]: 4, [UM_PYR]: 5, [UM_WEDGE]: 6, [UM_POLY]: 7 }, ct = Array.from(U.cType, t => FT[t] || 7);
  if (ct.every(t => t === ct[0])) out.push(`(12 (2 1 ${hx(U.nC)} 1 ${ct[0]}))`);
  else { out.push(`(12 (2 1 ${hx(U.nC)} 1 0)(`); for (let i = 0; i < ct.length; i += 20) out.push(ct.slice(i, i + 20).join(' ')); out.push('))'); }
  out.push(`(13 (0 1 ${hx(U.nF)} 0))`);
  const face = f => { const v = Array.from(U.fV.subarray(U.fOff[f], U.fOff[f + 1])); return `${hx(v.length)} ${v.map(p => hx(p + 1)).join(' ')} ${hx(U.own[f] + 1)} ${f < U.nIF ? hx(U.nbr[f] + 1) : 0}`; };
  // (Fluent's right-hand rule: the normal points from c1 to c0 -- so each face is written reversed, its normal into the owner)
  const faceRev = f => { const v = Array.from(U.fV.subarray(U.fOff[f], U.fOff[f + 1])).reverse(); return `${hx(v.length)} ${v.map(p => hx(p + 1)).join(' ')} ${hx(U.own[f] + 1)} ${f < U.nIF ? hx(U.nbr[f] + 1) : 0}`; };
  void face;
  const zones = [{ id: 3, type: 2, name: 'interior', label: 'interior', start: 0, n: U.nIF }, ...U.patches.map((p, k) => ({ id: 4 + k, type: BC[p.type] || 5, name: p.name, label: p.type === 'wall' ? 'wall' : p.type === 'patch' ? 'pressure-outlet' : 'symmetry', start: p.start, n: p.n }))];
  for (const z of zones) {
    if (!z.n) continue;
    out.push(`(13 (${hx(z.id)} ${hx(z.start + 1)} ${hx(z.start + z.n)} ${hx(z.type)} 0)(`);
    for (let f = z.start; f < z.start + z.n; f++) out.push(faceRev(f));
    out.push('))');
  }
  out.push(`(45 (2 fluid ${name})())`);
  for (const z of zones) if (z.n) out.push(`(45 (${z.id} ${z.label} ${z.name})())`);
  return out.join('\n') + '\n';
}

if (typeof module !== 'undefined' && module.exports) module.exports = { UM_TET, UM_HEX, UM_WEDGE, UM_PYR, UM_POLY, UM_FACES, umFace, umOrient, umBuild, umFromFm, umGeometry, umTetQuality, umQuality, umToFoam, umFromFoam, umToVTK, umToFluent };
