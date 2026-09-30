/*
 * cfd-3d-mesh.js — the 3D mesh's numbers (Flow › 3D, Mesh): statistics and shape quality of the 3D solver's mesh, its
 * sections, and after a solve the cross-flow diagnostic and a mesh study's quantities.
 *
 * The mesh (cfd-fem3d.js): structured Taylor–Hood Q2–Q1 hexahedra on spines -- 27 velocity nodes each, logically a box.
 * Nodes (c, l, k): c along the flow (x), l across the web (z), k up the spine from the web (y); numbered
 * (c * NL + l) * NR + k; NC = 2 nEx + 1, NL = 2 nEz + 1, NR = 2 nEy + 1; element (ex, ez, ey) spans nodes 2ex..2ex+2,
 * 2ez..2ez+2, 2ey..2ey+2. M: { NC, NL, NR, x, y, z (m, per node), cCorner (the node column at the metering edge), cCL
 * (at the contact line) }.
 *
 * Measures (each element's):
 *  - quality: its smallest over largest Jacobian of its triquadratic map at its 27 nodes (1 undistorted; <= 0 invalid:
 *    folded or inside out) -- the measure the Mesh step has always shown (c3dHexQuality);
 *  - volume: the Jacobian integrated (3 × 3 × 3 Gauss, exact for the map);
 *  - edges: its 12 edges, each the polyline through its middle node; aspect ratio: longest over shortest (in 3D), and in
 *    the plane of the flow (x-y): its mean edge along over its mean edge up, or the inverse, whichever is larger -- the
 *    one the warnings read: across the web the elements are long by design (the flow varies slowly across it; the elements
 *    across are warned on by their number, not their shape);
 *  - skewness: equiangle, over its 6 faces -- max((θmax − 90°)/90°, (90° − θmin)/90°), θ the faces' corner angles
 *    (0 a rectangle, 1 degenerate);
 *  - non-orthogonality: at each face shared by two elements, the angle between the line joining their centres and the
 *    face's normal (0°: orthogonal).
 * Pure computation, no DOM.
 */

/** Node index of (c, l, k). */
const m3Id = (M, c, l, k) => (c * M.NL + l) * M.NR + k;
const m3Counts = M => ({ nEx: (M.NC - 1) / 2, nEz: (M.NL - 1) / 2, nEy: (M.NR - 1) / 2 });

/**
 * A 3D mesh from a station's 2D layout repeated across the stations: f2 { gx, gy (m, node (i, j) at j * nx + i), nx, ny,
 * iCorner, iCL } (cfd-steps.js's field of the 2D layout), zs (the stations across, m, 2 nEz + 1 of them), scaleY(l) (each
 * station's heights over this one's: its gap over this gap; 1 when not given). The mesh a 3D solve starts from before
 * each station's own 2D is laid out.
 */
function m3Extrude(f2, zs, scaleY) {
  const NC = f2.nx, NR = f2.ny, NL = zs.length, N = NC * NL * NR;
  const x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) {
    const s = scaleY ? scaleY(l) : 1;
    for (let k = 0; k < NR; k++) { const n = (c * NL + l) * NR + k, m = k * NC + c; x[n] = f2.gx[m]; y[n] = f2.gy[m] * s; z[n] = zs[l]; }
  }
  return { NC, NL, NR, x, y, z, cCorner: f2.iCorner, cCL: f2.iCL };
}

// (the triquadratic's functions and derivatives at t = -1, 0, 1 and at the 3-point Gauss points)
const m3Q2 = t => [t * (t - 1) / 2, 1 - t * t, t * (t + 1) / 2], m3dQ2 = t => [t - 0.5, -2 * t, t + 0.5];
const M3_NODE = [-1, 0, 1].map(t => ({ N: m3Q2(t), d: m3dQ2(t) }));
const M3_GP = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)].map((t, i) => ({ N: m3Q2(t), d: m3dQ2(t), w: [5 / 9, 8 / 9, 5 / 9][i] }));

/** The Jacobian (det) of element (ex, ez, ey)'s map at a point given by its three 1D rules A (along), D (across), B (up). */
function m3Jac(M, ex, ez, ey, A, D, B) {
  let xa = 0, xb = 0, xd = 0, ya = 0, yb = 0, yd = 0, za = 0, zb = 0, zd = 0;
  for (let a = 0; a < 3; a++) for (let d = 0; d < 3; d++) for (let b = 0; b < 3; b++) {
    const n = m3Id(M, 2 * ex + a, 2 * ez + d, 2 * ey + b), X = M.x[n], Y = M.y[n], Z = M.z[n];
    const wa = A.d[a] * B.N[b] * D.N[d], wb = A.N[a] * B.d[b] * D.N[d], wd = A.N[a] * B.N[b] * D.d[d];
    xa += X * wa; xb += X * wb; xd += X * wd; ya += Y * wa; yb += Y * wb; yd += Y * wd; za += Z * wa; zb += Z * wb; zd += Z * wd;
  }
  // (right-handed: x along, y up, z across -- the (a, b, d) columns in that order)
  return xa * (yb * zd - yd * zb) - xb * (ya * zd - yd * za) + xd * (ya * zb - yb * za);
}
const m3P = (M, n) => [M.x[n], M.y[n], M.z[n]];
const m3Sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], m3Len = v => Math.hypot(v[0], v[1], v[2]);
const m3Dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const m3Cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const m3Angle = (u, v) => { const L = m3Len(u) * m3Len(v); return L > 0 ? Math.acos(Math.max(-1, Math.min(1, m3Dot(u, v) / L))) * 180 / Math.PI : 0; };

/**
 * One element's measures: { q (quality), vol, emin, emax, ar (3D), arXY (in the plane of the flow), skew, hx, hy, hz (its
 * mean edge along, up, across), c (its centre) }.
 */
function m3Element(M, ex, ez, ey) {
  let jmin = Infinity, jmax = -Infinity;
  for (const A of M3_NODE) for (const D of M3_NODE) for (const B of M3_NODE) { const J = m3Jac(M, ex, ez, ey, A, D, B); jmin = Math.min(jmin, J); jmax = Math.max(jmax, J); }
  let vol = 0;
  for (const A of M3_GP) for (const D of M3_GP) for (const B of M3_GP) vol += A.w * D.w * B.w * m3Jac(M, ex, ez, ey, A, D, B);
  const n = (a, d, b) => m3Id(M, 2 * ex + a, 2 * ez + d, 2 * ey + b), P = (a, d, b) => m3P(M, n(a, d, b));
  // (the 12 edges, each through its middle node: along (a), across (d), up (b))
  const edge = (p0, p1, p2) => m3Len(m3Sub(p1, p0)) + m3Len(m3Sub(p2, p1));
  const along = [], across = [], up = [];
  for (const d of [0, 2]) for (const b of [0, 2]) along.push(edge(P(0, d, b), P(1, d, b), P(2, d, b)));
  for (const a of [0, 2]) for (const b of [0, 2]) across.push(edge(P(a, 0, b), P(a, 1, b), P(a, 2, b)));
  for (const a of [0, 2]) for (const d of [0, 2]) up.push(edge(P(a, d, 0), P(a, d, 1), P(a, d, 2)));
  const all = [...along, ...across, ...up], emin = Math.min(...all), emax = Math.max(...all);
  // (equiangle skewness over the 6 faces: each face's 4 corners in order, the angle at each between its two edges)
  const faces = [
    [P(0, 0, 0), P(2, 0, 0), P(2, 0, 2), P(0, 0, 2)], [P(0, 2, 0), P(2, 2, 0), P(2, 2, 2), P(0, 2, 2)],   // across: its two sides
    [P(0, 0, 0), P(2, 0, 0), P(2, 2, 0), P(0, 2, 0)], [P(0, 0, 2), P(2, 0, 2), P(2, 2, 2), P(0, 2, 2)],   // up: bottom, top
    [P(0, 0, 0), P(0, 2, 0), P(0, 2, 2), P(0, 0, 2)], [P(2, 0, 0), P(2, 2, 0), P(2, 2, 2), P(2, 0, 2)],   // along: upstream, downstream
  ];
  let skew = 0;
  for (const f of faces) {
    let tmin = 180, tmax = 0;
    for (let i = 0; i < 4; i++) { const t = m3Angle(m3Sub(f[(i + 1) % 4], f[i]), m3Sub(f[(i + 3) % 4], f[i])); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
    skew = Math.max(skew, (tmax - 90) / 90, (90 - tmin) / 90);
  }
  const mean = v => v.reduce((s, q) => s + q, 0) / v.length;
  const cen = [0, 0, 0]; for (const a of [0, 2]) for (const d of [0, 2]) for (const b of [0, 2]) { const p = P(a, d, b); cen[0] += p[0] / 8; cen[1] += p[1] / 8; cen[2] += p[2] / 8; }
  const hx = mean(along), hy = mean(up), hz = mean(across);
  return { q: jmax > 0 ? Math.max(-1, jmin / jmax) : -1, jmin, vol, emin, emax, ar: emin > 0 ? emax / emin : Infinity, arXY: Math.min(hx, hy) > 0 ? Math.max(hx, hy) / Math.min(hx, hy) : Infinity, skew, hx, hy, hz, c: cen };
}

/** Elements either side of the metering edge's and the contact line's node columns that are "near" them (for the warnings). */
const M3_ZONE_REACH = 2;
/** Which regions element column ex is near: 'edge' (the active metering edge), 'meniscus' (the contact line) -- or none. */
function m3ZoneOf(M) {
  const near = c => c != null && (ex => ex >= c / 2 - M3_ZONE_REACH && ex < c / 2 + M3_ZONE_REACH);
  const E = near(M.cCorner), C = near(M.cCL);
  return ex => [...(E && E(ex) ? ['edge'] : []), ...(C && C(ex) ? ['meniscus'] : [])];
}
/**
 * The mesh's statistics. opts: { layers: { web, top } (the wall layers' thickness up the spine, as fractions of the gap,
 * from the web and from the blade / surface; 0 or none: the rows lying within them, at the metering edge's column, are
 * the layers' -- the 2D lays its rows out by the layers' sizes, so their number is what that gives), zone: (ex) => [labels] ('edge', 'meniscus': which elements along the flow
 * belong to the refinement regions whose shape is warned on; m3ZoneOf), skip: (ex, ez, ey) => true for elements left
 * out by design (an open edge's outermost at the web: wedges, a corner collapsed onto the contact line) }. Returns
 * counts, sizes, the measures' extremes and where, the gap's cells, across the web, and the invalid elements.
 */
function m3Stats(M, opts = {}) {
  const { nEx, nEz, nEy } = m3Counts(M), n = nEx * nEz * nEy, cells = new Array(n);
  let qMin = Infinity, qSum = 0, below = 0, invalid = 0, vMin = Infinity, vMax = -Infinity, vSum = 0, eMin = Infinity, eMax = 0, arMax = 0, skMax = 0, skSum = 0;
  let worst = null, arAt = null, skAt = null, used = 0, wedges = 0, arXYMax = 0, arXYAt = null;
  const hist = new Array(10).fill(0), invalidAt = [];
  const zoneMax = {};
  for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) {
    if (opts.skip && opts.skip(ex, ez, ey)) { wedges++; continue; }
    const e = m3Element(M, ex, ez, ey), i = (ex * nEz + ez) * nEy + ey;
    cells[i] = e; used++;
    qSum += e.q; if (e.q < qMin) { qMin = e.q; worst = { ex, ez, ey }; } if (e.q < 0.5) below++; hist[Math.min(9, Math.max(0, Math.floor(e.q * 10)))]++;
    if (!(e.q > 0) || !(e.vol > 0)) { invalid++; if (invalidAt.length < 20) invalidAt.push({ ex, ez, ey }); }
    vMin = Math.min(vMin, e.vol); vMax = Math.max(vMax, e.vol); vSum += e.vol; eMin = Math.min(eMin, e.emin); eMax = Math.max(eMax, e.emax);
    if (e.ar > arMax) { arMax = e.ar; arAt = { ex, ez, ey }; }
    if (e.arXY > arXYMax) { arXYMax = e.arXY; arXYAt = { ex, ez, ey }; }
    skSum += e.skew; if (e.skew > skMax) { skMax = e.skew; skAt = { ex, ez, ey }; }
    for (const zn of opts.zone ? opts.zone(ex) : []) { const Z = zoneMax[zn] || (zoneMax[zn] = { ar: 0, arXY: 0, skew: 0, n: 0 }); Z.ar = Math.max(Z.ar, e.ar); Z.arXY = Math.max(Z.arXY, e.arXY); Z.skew = Math.max(Z.skew, e.skew); Z.n++; }
  }
  // (non-orthogonality: every face shared by two elements, along, across and up. With the contact line up the exit face,
  // the faces of the elements under the face and the next M3_ZONE_REACH beyond the contact line apart too: where the
  // worst is, at.cl)
  const climbed = M.cCorner != null && M.cCL != null && M.cCL > M.cCorner;
  const underFace = ex => climbed && ex >= M.cCorner / 2 && ex < M.cCL / 2 + M3_ZONE_REACH;
  let noMax = 0, noSum = 0, noN = 0, noAt = null, noCl = 0;
  const cen = (ex, ez, ey) => { const e = cells[(ex * nEz + ez) * nEy + ey]; return e ? e.c : null; };
  const faceNormal = (ps) => m3Cross(m3Sub(ps[2], ps[0]), m3Sub(ps[3], ps[1]));
  const P = (c, l, k) => m3P(M, m3Id(M, c, l, k));
  const addFace = (c1, c2, ps, at, ex2) => {
    if (!c1 || !c2) return;
    const a = m3Angle(m3Sub(c2, c1), faceNormal(ps)), t = Math.min(a, 180 - a), cl = underFace(at.ex) || underFace(ex2);
    if (t > noMax) { noMax = t; noAt = { ...at, cl }; }
    if (cl) noCl = Math.max(noCl, t);
    noSum += t; noN++;
  };
  for (let ex = 0; ex < nEx; ex++) for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) {
    const c = 2 * ex, l = 2 * ez, k = 2 * ey;
    if (ex + 1 < nEx) addFace(cen(ex, ez, ey), cen(ex + 1, ez, ey), [P(c + 2, l, k), P(c + 2, l + 2, k), P(c + 2, l + 2, k + 2), P(c + 2, l, k + 2)], { ex, ez, ey, dir: 'along' }, ex + 1);
    if (ez + 1 < nEz) addFace(cen(ex, ez, ey), cen(ex, ez + 1, ey), [P(c, l + 2, k), P(c + 2, l + 2, k), P(c + 2, l + 2, k + 2), P(c, l + 2, k + 2)], { ex, ez, ey, dir: 'across' }, ex);
    if (ey + 1 < nEy) addFace(cen(ex, ez, ey), cen(ex, ez, ey + 1), [P(c, l, k + 2), P(c + 2, l, k + 2), P(c + 2, l + 2, k + 2), P(c, l + 2, k + 2)], { ex, ez, ey, dir: 'up' }, ex);
  }
  // (the minimum gap: up the spine at the metering edge's column, every station; its elements' heights)
  let gapCells = nEy, gapHmin = Infinity, gapHmax = 0, gap = null;
  if (M.cCorner != null) {
    const mid = (M.NL - 1) >> 1, c = M.cCorner;
    gap = M.y[m3Id(M, c, mid, M.NR - 1)] - M.y[m3Id(M, c, mid, 0)];
    for (let l = 0; l < M.NL; l += 2) for (let ey = 0; ey < nEy; ey++) { const h = M.y[m3Id(M, c, l, 2 * ey + 2)] - M.y[m3Id(M, c, l, 2 * ey)]; gapHmin = Math.min(gapHmin, h); gapHmax = Math.max(gapHmax, h); }
  }
  // (across the web: the element ends' z at the web, the first column)
  const zE = []; for (let l = 0; l < M.NL; l += 2) zE.push(M.z[m3Id(M, 0, l, 0)]);
  const dz = zE.slice(1).map((z, i) => z - zE[i]);
  // (the wall layers: the rows within their thickness, up the middle station's spine at the metering edge)
  const L = opts.layers || {}, rows = { web: 0, top: 0 };
  if (M.cCorner != null && (L.web || L.top)) {
    const mid = (M.NL - 1) >> 1, yk = k => M.y[m3Id(M, M.cCorner, mid, k)], y0 = yk(0), H = yk(M.NR - 1) - y0;
    for (let ey = 0; ey < nEy; ey++) { const a = (yk(2 * ey) - y0) / H, b = (yk(2 * ey + 2) - y0) / H; if (L.web && b <= L.web * (1 + 1e-3)) rows.web++; if (L.top && a >= 1 - L.top * (1 + 1e-3)) rows.top++; }
  }
  const lay = Math.min(nEy, rows.web + rows.top);
  return { cells: n, wedges, nodes: M.NC * M.NL * M.NR, nodesP: (nEx + 1) * (nEz + 1) * (nEy + 1), nEx, nEy, nEz,
    q: { min: qMin, mean: qSum / used, below, hist, at: worst }, invalid, invalidAt,
    vol: { min: vMin, max: vMax, total: vSum }, edge: { min: eMin, max: eMax }, ar: { max: arMax, at: arAt }, arXY: { max: arXYMax, at: arXYAt }, skew: { max: skMax, mean: skSum / used, at: skAt },
    nonOrth: { max: noMax, mean: noN ? noSum / noN : 0, faces: noN, at: noAt, cl: climbed ? noCl : null }, climbed,
    gap: { H: gap, cells: gapCells, hMin: gapHmin, hMax: gapHmax, nodes: 2 * gapCells + 1 },
    across: { width: zE[zE.length - 1] - zE[0], cells: nEz, dzMin: dz.length ? Math.min(...dz) : 0, dzMax: dz.length ? Math.max(...dz) : 0, nodes: M.NL },
    layerRows: rows, layerCells: lay * nEx * nEz, zones: zoneMax };
}

/**
 * The warnings on a mesh's statistics: [{ level: 'error' | 'warning', code, text }]. Errors: elements that are invalid
 * (folded, inside out: the solve cannot use them). Warnings (the solve still runs; each names what it can cost): few
 * elements across the minimum gap or across the web, strong skewness, aspect ratio or non-orthogonality -- at the
 * thresholds in M3_WARN, each explained there.
 */
const M3_WARN = {
  // (Q2 elements: 2 across the gap are 5 velocity nodes -- a quadratic profile across it exactly, a shear-thinning one coarsely)
  gapCells: 3,
  // (across the web: 2 elements are 5 stations; lateral pressure and cross-web flow need more to be followed)
  zCells: 3,
  // (equiangle skewness above 0.85 is poor by common practice; FE Q2 elements tolerate more, but not near the edge's gradients)
  skew: 0.85,
  // (near the meniscus the surface's curvature is taken from the elements' shape in the plane of the flow: long thin ones there degrade it)
  arMeniscus: 20,
  // (anywhere, in the plane of the flow: beyond 100 the element's shape dominates its conditioning)
  ar: 100,
  // (a face's normal more than 70° from the line joining the cells' centres; near a contact line up the exit face, told apart)
  nonOrth: 70,
};
function m3Warnings(S, ctx = {}) {
  const out = [], f = v => String(+(+v).toPrecision(3));
  if (S.invalid) out.push({ level: 'error', code: 'invalid', text: `${S.invalid} element${S.invalid === 1 ? ' is' : 's are'} invalid (folded or inside out: a Jacobian at or below 0) -- the solve cannot use ${S.invalid === 1 ? 'it' : 'them'}.` });
  if (S.gap.cells < M3_WARN.gapCells) out.push({ level: 'warning', code: 'gap', text: `Only ${S.gap.cells} element${S.gap.cells === 1 ? '' : 's'} (${S.gap.nodes} velocity nodes) across the minimum metering gap: a shear-thinning profile across it is resolved coarsely.` });
  if (!ctx.twoD && S.across.cells < M3_WARN.zCells) out.push({ level: 'warning', code: 'z', text: `Only ${S.across.cells} element${S.across.cells === 1 ? '' : 's'} (${S.across.nodes} stations) across the ${ctx.where || 'region'}: 3D lateral flow (u_z, pressure across the web) may not be resolved.` });
  const Ze = S.zones.edge, Zm = S.zones.meniscus;
  if (Ze && Ze.skew > M3_WARN.skew) out.push({ level: 'warning', code: 'skewEdge', text: `High skewness near the active metering edge: ${f(Ze.skew)} (above ${M3_WARN.skew}).` });
  else if (S.skew.max > M3_WARN.skew) out.push({ level: 'warning', code: 'skew', text: `High skewness: ${f(S.skew.max)} at its worst (above ${M3_WARN.skew}).` });
  if (Zm && Zm.arXY > M3_WARN.arMeniscus) out.push({ level: 'warning', code: 'arMeniscus', text: `Extreme aspect ratio near the meniscus: ${f(Zm.arXY)} in the plane of the flow (above ${M3_WARN.arMeniscus}): the surface's curvature there, and so its capillary pressure, is taken from long thin elements.` });
  if (S.arXY.max > M3_WARN.ar) out.push({ level: 'warning', code: 'ar', text: `Extreme aspect ratio: ${f(S.arXY.max)} in the plane of the flow at its worst (above ${M3_WARN.ar}).` });
  // (the worst under the exit face, the contact line up it: the liquid there is a fan of spines from the web up to the
  // face, its rows following the face, so the two cross at small angles -- the layout's shape there, which refining keeps)
  if (S.nonOrth.max > M3_WARN.nonOrth && S.nonOrth.at && S.nonOrth.at.cl) out.push({ level: 'warning', code: 'nonOrthMeniscus', text: `Strongly non-orthogonal faces at the contact line: ${f(S.nonOrth.max)}° at the worst (above ${M3_WARN.nonOrth}°). The contact line has climbed the exit face, and the liquid under the face is meshed as a fan of spines from the web up to the face with rows that follow the face, so the two cross at small angles there. Refining does not remove it. The elements stay valid; what it can cost is accuracy at the contact line, which the mesh study measures.` });
  else if (S.nonOrth.max > M3_WARN.nonOrth) out.push({ level: 'warning', code: 'nonOrth', text: `Strongly non-orthogonal faces: ${f(S.nonOrth.max)}° at the worst (above ${M3_WARN.nonOrth}°).` });
  return out;
}

/**
 * A section through the mesh, as line segments in its plane (m): 'xy' at the middle station across (x along, y up),
 * 'xz' on the web (x along, z across), 'yz' at the metering edge's column (z across, y up); each element's edges drawn
 * through their middle nodes. Returns { segs: Float64Array (x0, y0, x1, y1 each), bounds: [u0, u1, v0, v1] }.
 */
function m3Section(M, kind) {
  const s = [];
  const P = (c, l, k) => { const n = m3Id(M, c, l, k); return kind === 'xy' ? [M.x[n], M.y[n]] : kind === 'xz' ? [M.x[n], M.z[n]] : [M.z[n], M.y[n]]; };
  const line = pts => { for (let i = 0; i + 1 < pts.length; i++) s.push(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); };
  const mid = (M.NL - 1) >> 1, cE = M.cCorner != null ? M.cCorner : (M.NC - 1) >> 1;
  if (kind === 'xy') {
    for (let k = 0; k < M.NR; k += 2) line(Array.from({ length: M.NC }, (_, c) => P(c, mid, k)));
    for (let c = 0; c < M.NC; c += 2) line(Array.from({ length: M.NR }, (_, k) => P(c, mid, k)));
  } else if (kind === 'xz') {
    for (let l = 0; l < M.NL; l += 2) line(Array.from({ length: M.NC }, (_, c) => P(c, l, 0)));
    for (let c = 0; c < M.NC; c += 2) line(Array.from({ length: M.NL }, (_, l) => P(c, l, 0)));
  } else {
    for (let k = 0; k < M.NR; k += 2) line(Array.from({ length: M.NL }, (_, l) => P(cE, l, k)));
    for (let l = 0; l < M.NL; l += 2) line(Array.from({ length: M.NR }, (_, k) => P(cE, l, k)));
  }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < s.length; i += 2) { u0 = Math.min(u0, s[i]); u1 = Math.max(u1, s[i]); v0 = Math.min(v0, s[i + 1]); v1 = Math.max(v1, s[i + 1]); }
  return { segs: Float64Array.from(s), bounds: [u0, u1, v0, v1], mid, cE };
}

/**
 * The cross-flow diagnostic of a solved 3D flow R (x, y, z, u, v, w per node, m/s; R.skew: a blade skewed across the web,
 * its solve in the blade's frame -- turned back into the machine's): the largest |u_x|, |u_y|, |u_z|, |u_z| / |u_x|, and the means
 * of |u_x|, |u_y|, |u_z| over the nodes.
 * Not a mesh measure: whether the flow found moves across the web at all (a uniform strip between symmetry planes moves
 * nowhere across, by its conditions).
 */
function m3CrossFlow(R) {
  const t = (R.skew || 0) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  let ux = 0, uy = 0, uz = 0, mx = 0, my = 0, mz = 0;
  for (let n = 0; n < R.u.length; n++) {
    const a = R.u[n], b = R.w[n], X = t ? a * c + b * s : a, Z = t ? b * c - a * s : b;
    ux = Math.max(ux, Math.abs(X)); uy = Math.max(uy, Math.abs(R.v[n])); uz = Math.max(uz, Math.abs(Z));
    mx += Math.abs(X); my += Math.abs(R.v[n]); mz += Math.abs(Z);
  }
  const N = R.u.length || 1;
  return { ux, uy, uz, ratio: ux > 0 ? uz / ux : 0, mean: { ux: mx / N, uy: my / N, uz: mz / N } };
}

/**
 * A solved 3D strip's quantities for a mesh study (m, Pa, 1/s, m²/s): the wet film and the flow rate at the middle
 * station, the largest pressure, the pressure on the blade at the metering edge (middle station), the largest shear rate,
 * the largest wall shear stress on the web (μ γ̇ at its nodes), the contact line's height up the exit face and the free
 * surface's curvature there (the circle through its first three nodes on the surface, middle station), the largest |u_z|.
 */
function m3StudyMetrics(R) {
  const NC = R.NC, NL = R.NL, NR = R.NR, mid = (NL - 1) >> 1, id = (c, l, k) => (c * NL + l) * NR + k;
  let pMax = -Infinity, gdMax = 0, wss = 0;
  for (let n = 0; n < R.p.length; n++) { pMax = Math.max(pMax, R.p[n]); gdMax = Math.max(gdMax, R.gd[n]); }
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) { const n = id(c, l, 0); wss = Math.max(wss, R.mu[n] * R.gd[n]); }
  const st = R.stations && R.stations[mid] || {};
  let curv = NaN;
  if (R.cCL != null && R.cCL + 2 < NC) {
    const p = [0, 1, 2].map(j => { const n = id(R.cCL + j, mid, NR - 1); return [R.x[n], R.y[n]]; });
    const a = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), b = Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]), c = Math.hypot(p[2][0] - p[0][0], p[2][1] - p[0][1]);
    const cr = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    curv = a * b * c > 0 ? 2 * cr / (a * b * c) : NaN;
  }
  const pEdge = R.top && R.cCorner != null ? R.top.p3[R.cCorner] : NaN;
  return { film: st.film, q: st.q, pMax, pEdge, gdMax, wss, cl: st.s, curv, uz: m3CrossFlow(R).uz };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { m3Id, m3Counts, m3Extrude, m3Element, m3Stats, m3ZoneOf, M3_ZONE_REACH, m3Warnings, M3_WARN, m3Section, m3CrossFlow, m3StudyMetrics, m3Jac };
