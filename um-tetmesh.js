/*
 * um-tetmesh.js — the app's own tetrahedral mesh generator (MESH-T2), on um-tet.js (exact predicates, Delaunay) and
 * um-tri.js (the 2D mesher). No GPL code.
 *
 * umtSurface(G, o): a solid bounded by flat faces, meshed on its surface. G = { X, Y, Z (corner points), faces: [{ loops:
 *   [[corner indices], …] (the outer loop counter-clockwise seen from outside, then any holes), tag }] }; o = { size (x, y, z)
 *   → h, or a number }. Every edge is divided once (equal pieces of about the size there), so the faces sharing it share its
 *   points; each face is meshed in its own plane by um-tri.js with that boundary fixed. Returns { X, Y, Z, tri (outward),
 *   tag (per triangle), corner (how many points are G's) }.
 * umtVolume(S, o): the solid inside a closed surface S (as umtSurface gives, or any closed outward triangulation, holes as
 *   inner shells) filled with tetrahedra: the surface's points' Delaunay tetrahedralization; any surface triangle missing
 *   from it gets its longest edge split (on the surface: its points stay on its faces and edges) until every one is a face;
 *   then Delaunay refinement: each tetrahedron too big for the size or too badly shaped (circumradius over its shortest
 *   edge above o.ratio, default 2) gets its circumcentre, unless that point would fall in a surface triangle's diametral
 * *   sphere -- then that surface triangle is split instead, so the surface stays in the mesh; then slivers (tetrahedra flat
 *   though their edges are fine) removed by points put near their circumcentres. Returns { X, Y, Z, tet (4 each, positive),
 *   bface (the surface's triangles, outward), btag, src (each point's index in S, or ≥ S's count for a new one), mid (the
 *   surface's new points, each the middle of an edge: triples p, a, b), stats }.
 * umtQuadratic(V, o): the tetrahedra made quadratic (um-fe.js's tet10) for the P2–P1 solver: each edge's middle a node, on a
 *   curved wall moved onto the true surface (o.project by tag); the finite-element mesh um-fe.js reads (see the function).
 * umtSizeField(spec): a size over space, (x, y, z) → h, graded: spec = { h (everywhere), grow (each size at most this
 *   many times its neighbour's, default 1.3), boxes: [{ min: [x, y, z], max: [x, y, z], h }], lines: [{ a: [x, y, z], b:
 *   [x, y, z], h, r (the size held to this distance, default 0) }], points: [{ at: [x, y, z], h, r }] }. Inside a box, or
 *   within r of a line or point, its h; away from it the size grows linearly with the distance, by grow - 1 per unit
 *   length (the gradient a mesh of ratio `grow` between neighbours has), up to h. The smallest of all at each point: a
 *   field whose slope is never above grow - 1, so the mesh grades smoothly whatever the sources.
 * Pure computation.
 */
const UMM_T = typeof umtTri === 'function' ? { umtTri, umtOrient, UMT_INF } : require('./um-tet.js');
const UMM_2 = typeof utMesh === 'function' ? { utMesh } : require('./um-tri.js');
const UMM_F = typeof ufeShape === 'function' ? { ufeShape, ufeRule } : require('./um-fe.js');

/** The surface of a solid with flat faces, meshed (see the header). */
function umtSurface(G, o = {}) {
  const hOf = typeof o.size === 'function' ? o.size : () => o.size;
  const X = Array.from(G.X), Y = Array.from(G.Y), Z = Array.from(G.Z), nC = X.length;
  // every edge divided once: its points from its lower corner to its higher
  const edgePts = new Map();
  const edge = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!edgePts.has(key)) {
      const [p, q] = a < b ? [a, b] : [b, a], L = Math.hypot(X[q] - X[p], Y[q] - Y[p], Z[q] - Z[p]), ids = [p];
      // (graded: the pieces spaced by the size along the edge -- equal steps of the integral of 1/h, by the trapezium
      //  rule over 256 samples; a constant size gives equal pieces exactly)
      const ns = 256, at = t => hOf(X[p] + t * (X[q] - X[p]), Y[p] + t * (Y[q] - Y[p]), Z[p] + t * (Z[q] - Z[p]));
      const cum = [0]; let hPrev = at(0);
      for (let i = 1; i <= ns; i++) { const hi = at(i / ns); cum.push(cum[i - 1] + L / ns * (1 / hPrev + 1 / hi) / 2); hPrev = hi; }
      const m = Math.max(1, Math.round(cum[ns])), uniform = cum.every((c, i) => Math.abs(c - cum[ns] * i / ns) <= 1e-12 * cum[ns]);
      for (let i = 1; i < m; i++) {
        let t = i / m;
        if (!uniform) { const goal = cum[ns] * i / m; let j = 1; while (cum[j] < goal) j++; t = (j - 1 + (goal - cum[j - 1]) / (cum[j] - cum[j - 1])) / ns; }
        ids.push(X.length); X.push(X[p] + t * (X[q] - X[p])); Y.push(Y[p] + t * (Y[q] - Y[p])); Z.push(Z[p] + t * (Z[q] - Z[p]));
      }
      ids.push(q); edgePts.set(key, ids);
    }
    const ids = edgePts.get(key); return a < b ? ids : ids.slice().reverse();
  };
  const tri = [], tag = [];
  for (const F of G.faces) {
    // the face's plane: its normal by Newell's rule on the outer loop; two directions in it
    const L0 = F.loops[0]; let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < L0.length; i++) { const a = L0[i], b = L0[(i + 1) % L0.length]; nx += (Y[a] - Y[b]) * (Z[a] + Z[b]); ny += (Z[a] - Z[b]) * (X[a] + X[b]); nz += (X[a] - X[b]) * (Y[a] + Y[b]); }
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    const o3 = [X[L0[0]], Y[L0[0]], Z[L0[0]]];
    let u = [X[L0[1]] - o3[0], Y[L0[1]] - o3[1], Z[L0[1]] - o3[2]]; const ud = u[0] * nx + u[1] * ny + u[2] * nz; u = [u[0] - ud * nx, u[1] - ud * ny, u[2] - ud * nz];
    const ul = Math.hypot(...u); u = u.map(c => c / ul); const v = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
    const to2 = i => { const d = [X[i] - o3[0], Y[i] - o3[1], Z[i] - o3[2]]; return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]]; };
    // the boundary: each loop's edges in their points, as segments; a point inside each hole
    const pid = [], px = [], py = [], seg = [], holes = [], local = new Map();
    const lp = i => { if (!local.has(i)) { local.set(i, pid.length); pid.push(i); const [a, b] = to2(i); px.push(a); py.push(b); } return local.get(i); };
    F.loops.forEach((loop, li) => {
      for (let i = 0; i < loop.length; i++) { const ids = edge(loop[i], loop[(i + 1) % loop.length]); for (let k = 0; k + 1 < ids.length; k++) seg.push([lp(ids[k]), lp(ids[k + 1]), F.tag]); }
      if (li > 0) holes.push(umtInsidePoint(loop.map(to2)));
    });
    const M = UMM_2.utMesh({ x: px, y: py, seg, holes }, { size: (a, b) => hOf(o3[0] + a * u[0] + b * v[0], o3[1] + a * u[1] + b * v[1], o3[2] + a * u[2] + b * v[2]), minAngle: o.minAngle ?? 28, fixed: true });
    // back to 3D: the boundary's points are the edges' own (the same numbers exactly), the inner ones new
    const back = new Map(); for (let i = 0; i < pid.length; i++) back.set(px[i] + ',' + py[i], pid[i]);
    const g = new Int32Array(M.x.length);
    for (let i = 0; i < M.x.length; i++) {
      const k = back.get(M.x[i] + ',' + M.y[i]);
      if (k !== undefined) g[i] = k; else { g[i] = X.length; X.push(o3[0] + M.x[i] * u[0] + M.y[i] * v[0]); Y.push(o3[1] + M.x[i] * u[1] + M.y[i] * v[1]); Z.push(o3[2] + M.x[i] * u[2] + M.y[i] * v[2]); }
    }
    for (let t = 0; t < M.tri.length; t += 3) { tri.push(g[M.tri[t]], g[M.tri[t + 1]], g[M.tri[t + 2]]); tag.push(F.tag); }
  }
  return { X, Y, Z, tri: Int32Array.from(tri), tag, corner: nC };
}
/** A point inside a simple polygon (2D points): the middle of an ear (a convex corner with no other corner inside). */
function umtInsidePoint(P) {
  let A = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; A += a[0] * b[1] - b[0] * a[1]; }
  const s = Math.sign(A), n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n], cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cr * s <= 0) continue;
    const inside = P.some((q, j) => { if (j === i || j === (i + 1) % n || j === (i + n - 1) % n) return false;
      const d1 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]), d2 = (c[0] - b[0]) * (q[1] - b[1]) - (c[1] - b[1]) * (q[0] - b[0]), d3 = (a[0] - c[0]) * (q[1] - c[1]) - (a[1] - c[1]) * (q[0] - c[0]);
      return d1 * s >= 0 && d2 * s >= 0 && d3 * s >= 0; });
    if (!inside) return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
  }
  throw new Error('um-tetmesh: no point inside a hole');
}

/** Triangles by their three point numbers in any order (a map: has, get, set): under the smallest, a short list of the
 *  other two and the value -- no strings built, no hashing. */
class UmtTriMap {
  constructor() { this.l = []; }
  set(a, b, c, v) {
    let t; if (a > b) { t = a; a = b; b = t; } if (b > c) { t = b; b = c; c = t; } if (a > b) { t = a; a = b; b = t; }
    let L = this.l[a]; if (!L) this.l[a] = L = [];
    for (let i = 0; i < L.length; i += 3) if (L[i] === b && L[i + 1] === c) { L[i + 2] = v; return; }
    L.push(b, c, v);
  }
  get(a, b, c) {
    let t; if (a > b) { t = a; a = b; b = t; } if (b > c) { t = b; b = c; c = t; } if (a > b) { t = a; a = b; b = t; }
    const L = this.l[a]; if (L) for (let i = 0; i < L.length; i += 3) if (L[i] === b && L[i + 1] === c) return L[i + 2];
    return undefined;
  }
  has(a, b, c) { return this.get(a, b, c) !== undefined; }
}
/** The faces of a tetrahedron: its corners other than the k-th. */
const UMT_FACE = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]];

/** The solid inside a closed surface, filled with tetrahedra (see the header). */
function umtVolume(S, o = {}) {
  const hOf = typeof o.size === 'function' ? o.size : () => o.size ?? Infinity;
  const ratio = o.ratio ?? 2, maxPts = o.maxPoints ?? 400000;
  const X = Array.from(S.X), Y = Array.from(S.Y), Z = Array.from(S.Z);
  // the surface: its triangles (outward), each one's diametral sphere; a hash of them by the cells their spheres touch
  let F = Array.from(S.tri), Ftag = S.tag.slice(), alive = new Array(F.length / 3).fill(true);
  // (the surface must be closed and turned one way: every edge met once each way)
  { const dir = new Map(); for (let t = 0; t < F.length; t += 3) for (let k = 0; k < 3; k++) { const key = F[t + k] + ',' + F[t + (k + 1) % 3]; dir.set(key, (dir.get(key) || 0) + 1); }
    let open = 0; for (const [key, c] of dir) { const [a, b] = key.split(','); if (c !== 1 || dir.get(b + ',' + a) !== 1) open++; }
    if (open) throw new Error(`um-tetmesh: the surface is not closed (${open} edges without one partner turned the other way)`); }
  // the surface's edges → their triangles (for splitting)
  const ekey = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
  const edgeTris = new Map();
  const eAdd = f => { for (let k = 0; k < 3; k++) { const key = ekey(F[3 * f + k], F[3 * f + (k + 1) % 3]); (edgeTris.get(key) || edgeTris.set(key, []).get(key)).push(f); } };
  const eDel = f => { for (let k = 0; k < 3; k++) { const key = ekey(F[3 * f + k], F[3 * f + (k + 1) % 3]), l = edgeTris.get(key); l.splice(l.indexOf(f), 1); } };
  for (let f = 0; f < F.length / 3; f++) eAdd(f);
  let D = UMM_T.umtTri(X, Y, Z, { seed: o.seed });
  let inside = new Uint8Array(0);   // (per tetrahedron: 1 inside, 0 outside, 255 not yet known)
  /** A surface triangle's longest edge [a, b]. */
  const longest = f => { let best = 0, bl = -1;
    for (let k = 0; k < 3; k++) { const a = F[3 * f + k], b = F[3 * f + (k + 1) % 3], l = Math.hypot(X[a] - X[b], Y[a] - Y[b], Z[a] - Z[b]); if (l > bl) { bl = l; best = k; } }
    return [F[3 * f + best], F[3 * f + (best + 1) % 3]]; };
  /** Surface triangle f split, by Rivara's longest-edge propagation: along the path of longest edges to one shared as the
   *  longest by both its triangles, that edge halved, again until f itself is split (the angles stay bounded below). */
  let nSplit = 0;
  const midOf = [];   // (each surface point made by halving an edge, and that edge's two points)
  const splitSurface = f => {
    for (let guard = 0; alive[f] && guard < 1000; guard++) {
      let g = f, e = longest(f);
      for (let step = 0; step < 1000; step++) {
        const other = edgeTris.get(ekey(e[0], e[1])).find(q => q !== g);
        if (other === undefined) break;
        const e2 = longest(other); if (ekey(...e2) === ekey(...e)) break;
        g = other; e = e2;
      }
      splitEdge(e[0], e[1]);
    }
  };
  /** The surface edge a–b halved: every surface triangle on it in two, the point into the tetrahedralization. */
  const splitEdge = (a, b) => {
    const p = X.length;
    X.push((X[a] + X[b]) / 2); Y.push((Y[a] + Y[b]) / 2); Z.push((Z[a] + Z[b]) / 2);
    for (const g of edgeTris.get(ekey(a, b)).slice()) {
      // g = (a', b', c') with the edge a–b in it: two triangles (…, p) in the same turn
      const v = [F[3 * g], F[3 * g + 1], F[3 * g + 2]], i = [0, 1, 2].find(k => (v[k] === a && v[(k + 1) % 3] === b) || (v[k] === b && v[(k + 1) % 3] === a));
      const e0 = v[i], e1 = v[(i + 1) % 3], c = v[(i + 2) % 3];
      eDel(g); alive[g] = false;
      const g1 = F.length / 3; F.push(e0, p, c); Ftag.push(Ftag[g]); alive.push(true); eAdd(g1);
      const g2 = F.length / 3; F.push(p, e1, c); Ftag.push(Ftag[g]); alive.push(true); eAdd(g2);
    }
    midOf.push(p, a, b);
    const made = D.insert(p); nSplit++;
    if (made !== -1 && inside.length) for (const m of made) if (m < inside.length) inside[m] = 255;   // (on the surface: its new tetrahedra on both sides, unknown till classified)
    return p;
  };
  /** A missing surface triangle f whose partner across an edge lies in its plane, and whose quadrilateral's other diagonal
   *  the tetrahedralization took (four points on one circle: either pair is Delaunay): the pair flipped to match. */
  const tieFlip = (f, fs) => {
    for (let k = 0; k < 3; k++) {
      const a = F[3 * f + k], b = F[3 * f + (k + 1) % 3], c = F[3 * f + (k + 2) % 3];
      const g = edgeTris.get(ekey(a, b)).find(q => q !== f); if (g === undefined || Ftag[g] !== Ftag[f]) continue;
      const d = [F[3 * g], F[3 * g + 1], F[3 * g + 2]].find(v => v !== a && v !== b);
      if (UMM_T.umtOrient(X[a], Y[a], Z[a], X[b], Y[b], Z[b], X[c], Y[c], Z[c], X[d], Y[d], Z[d]) !== 0) continue;
      if (!fs.has(a, d, c) || !fs.has(d, b, c)) continue;
      eDel(f); eDel(g); F[3 * f] = a; F[3 * f + 1] = d; F[3 * f + 2] = c; F[3 * g] = d; F[3 * g + 1] = b; F[3 * g + 2] = c; eAdd(f); eAdd(g);
      return true;
    }
    return false;
  };
  /** Every surface triangle a face of the tetrahedralization: ties flipped, else (splits allowed) split. Whether it is. */
  const recoverSurface = (splits = true) => {
    for (let round = 0; round < 80; round++) {
      const fs = faceSet(), missing = []; for (let f = 0; f < F.length / 3; f++) if (alive[f] && !fs.has(F[3 * f], F[3 * f + 1], F[3 * f + 2])) missing.push(f);
      if (!missing.length) return true;
      let flipped = false; for (const f of missing) if (alive[f] && !fs.has(F[3 * f], F[3 * f + 1], F[3 * f + 2]) && tieFlip(f, fs)) flipped = true;
      if (flipped) continue;
      if (!splits) return false;
      for (const f of missing) if (alive[f]) splitSurface(f);
    }
    return false;
  };
  // the faces of the tetrahedralization (finite ones), to find the surface triangles missing from it
  // (only those whose three corners are all the surface's: the only ones asked about)
  const faceSet = () => { const s = new UmtTriMap(), tv = D.tv, al = D.alive, on = new Uint8Array(X.length);
    for (let f = 0; f < F.length / 3; f++) if (alive[f]) { on[F[3 * f]] = 1; on[F[3 * f + 1]] = 1; on[F[3 * f + 2]] = 1; }
    for (let t = 0; t < D.nT; t++) if (al[t] && tv[4 * t] >= 0 && tv[4 * t + 1] >= 0 && tv[4 * t + 2] >= 0 && tv[4 * t + 3] >= 0
      && on[tv[4 * t]] + on[tv[4 * t + 1]] + on[tv[4 * t + 2]] + on[tv[4 * t + 3]] >= 3)
      for (let k = 0; k < 4; k++) { const [i, j, l] = UMT_FACE[k], a = tv[4 * t + i], b = tv[4 * t + j], c = tv[4 * t + l]; if (on[a] && on[b] && on[c]) s.set(a, b, c, 1); }
    return s; };
  /** The surface triangle that is tetrahedron t's face opposite its k-th corner, or undefined (sk: surfKeys()). */
  const surfFace = (sk, t, k) => { const [i, j, l] = UMT_FACE[k], a = D.tv[4 * t + i], b = D.tv[4 * t + j], c = D.tv[4 * t + l]; return a < 0 || b < 0 || c < 0 ? undefined : sk.get(a, b, c); };
  // 1. the surface into the tetrahedralization
  if (!recoverSurface()) throw new Error('um-tetmesh: the surface could not be recovered');
  let skCache = null, skN = -1;
  const surfKeysNow = () => { if (skN !== F.length) { skCache = surfKeys(); skN = F.length; } return skCache; };
  // the inside: flood from outside (the ghosts), each surface triangle crossed turning inside to outside and back
  const surfKeys = () => { const s = new UmtTriMap(); for (let f = 0; f < F.length / 3; f++) if (alive[f]) s.set(F[3 * f], F[3 * f + 1], F[3 * f + 2], f); return s; };
  const classify = () => {
    const sk = surfKeys(), tv = D.tv, tn = D.tn, al = D.alive, nT = D.nT; inside = new Uint8Array(nT).fill(255);
    const st = [];
    for (let t = 0; t < nT; t++) if (al[t] && D.infAt(t) >= 0) { inside[t] = 0; st.push(t); }
    while (st.length) { const t = st.pop(); for (let k = 0; k < 4; k++) { const s = tn[4 * t + k]; if (!al[s] || inside[s] !== 255) continue;
      const cross = surfFace(sk, t, k) !== undefined;
      inside[s] = cross ? 1 - inside[t] : inside[t]; st.push(s); } }
  };
  // 2. refinement: too big or badly shaped tetrahedra get their circumcentres; a centre in a surface triangle's sphere splits it instead
  const tetInfo = t => {
    const tv = D.tv, v0 = tv[4 * t], v1 = tv[4 * t + 1], v2 = tv[4 * t + 2], v3 = tv[4 * t + 3], ax = X[v0], ay = Y[v0], az = Z[v0];
    const b00 = X[v1] - ax, b01 = Y[v1] - ay, b02 = Z[v1] - az, b10 = X[v2] - ax, b11 = Y[v2] - ay, b12 = Z[v2] - az, b20 = X[v3] - ax, b21 = Y[v3] - ay, b22 = Z[v3] - az;
    const r0 = (b00 * b00 + b01 * b01 + b02 * b02) / 2, r1 = (b10 * b10 + b11 * b11 + b12 * b12) / 2, r2 = (b20 * b20 + b21 * b21 + b22 * b22) / 2;
    const det = b00 * (b11 * b22 - b12 * b21) - b01 * (b10 * b22 - b12 * b20) + b02 * (b10 * b21 - b11 * b20);
    const cx = (r0 * (b11 * b22 - b12 * b21) - b01 * (r1 * b22 - b12 * r2) + b02 * (r1 * b21 - b11 * r2)) / det;
    const cy = (b00 * (r1 * b22 - b12 * r2) - r0 * (b10 * b22 - b12 * b20) + b02 * (b10 * r2 - r1 * b20)) / det;
    const cz = (b00 * (b11 * r2 - r1 * b21) - b01 * (b10 * r2 - r1 * b20) + r0 * (b10 * b21 - b11 * b20)) / det;
    const d = (i, j) => Math.hypot(X[i] - X[j], Y[i] - Y[j], Z[i] - Z[j]);
    let lmin = Infinity; lmin = Math.min(lmin, d(v0, v1)); lmin = Math.min(lmin, d(v0, v2)); lmin = Math.min(lmin, d(v0, v3)); lmin = Math.min(lmin, d(v1, v2)); lmin = Math.min(lmin, d(v1, v3)); lmin = Math.min(lmin, d(v2, v3));
    return { c: [ax + cx, ay + cy, az + cz], R: Math.hypot(cx, cy, cz), lmin };
  };
  let refined = 0, skipped = 0;
  // (a tetrahedron skipped -- its point would take the surface, or fall outside -- is not tried again while it and the
  //  surface stay as they were: the same four corners, no surface triangle split since; one skipped for its shape alone
  //  -- small enough, badly shaped by the surface -- not again at all: the smoothing below takes it)
  const skippedAt = new Map(), skipKey = v => v.slice().sort((a, b) => a - b).join(), qCache = [];
  for (let pass = 0; pass < 40 && X.length < maxPts; pass++) {
    classify();
    const bad = [], tv = D.tv;
    for (let t = 0; t < D.nT; t++) if (D.alive[t] && inside[t] === 1) {
      // (each tetrahedron's measure kept from the pass it was made in: the points do not move while refining, so the same
      //  four corners give the same sphere)
      let e = qCache[t];
      if (!e || e.a !== tv[4 * t] || e.b !== tv[4 * t + 1] || e.c !== tv[4 * t + 2] || e.d !== tv[4 * t + 3]) {
        const q = tetInfo(t); e = qCache[t] = { a: tv[4 * t], b: tv[4 * t + 1], c: tv[4 * t + 2], d: tv[4 * t + 3], q, bad: q.R > 0.65 * hOf(...q.c) || q.R / q.lmin > ratio }; }
      if (e.bad) { const q = e.q; q.v = [e.a, e.b, e.c, e.d]; bad.push([t, q]); }
    }
    if (!bad.length) break;
    let changed = false;
    for (const [t, q] of bad) {
      // (still the same tetrahedron? it may have gone with an earlier point this pass)
      if (!D.alive[t] || X.length >= maxPts || !q.v.every((v, i) => D.tv[4 * t + i] === v)) continue;
      const sKey = skipKey(q.v), sAt = skippedAt.get(sKey);
      if (sAt === F.length || sAt === -1) continue;
      const tooBig = q.R > 0.65 * hOf(...q.c);
      const skip = () => { skipped++; skippedAt.set(sKey, tooBig ? F.length : -1); };
      // (one for its shape alone whose centre is outside the solid is skipped whatever its cavity takes -- no point outside,
      //  and only a tetrahedron too big splits the surface: its cavity, through the space outside, not searched)
      if (!tooBig) { const tl = D.locate(...q.c); if (D.infAt(tl) >= 0 || !(tl < inside.length && inside[tl] === 1)) { skip(); continue; } }
      // (the point may not take a surface triangle with it: one between two tetrahedra of its cavity is split instead)
      // (a surface triangle lies between a tetrahedron inside and one outside: two on the same known side need no look)
      const cav = D.cavityOf(...q.c), sk0 = surfKeysNow(), lost = new Set(), side = t => (t < inside.length ? inside[t] : 255);
      for (const c of cav) { const sc = side(c); for (let k = 0; k < 4; k++) { const nb = D.tn[4 * c + k]; if (!D.inCavity(nb) || (sc !== 255 && side(nb) === sc)) continue;
        const f = surfFace(sk0, c, k); if (f !== undefined) lost.add(f); } }
      // (only a tetrahedron too big for the size splits the surface; a badly shaped one by the surface is left to the
      //  smoothing below -- splitting the surface for shape alone runs away, smaller and smaller, toward it)
      const splittable = f => { const [a, b] = longest(f); return Math.hypot(X[a] - X[b], Y[a] - Y[b], Z[a] - Z[b]) > 0.5 * hOf((X[a] + X[b]) / 2, (Y[a] + Y[b]) / 2, (Z[a] + Z[b]) / 2); };
      if (lost.size) { if (tooBig) for (const f of lost) if (alive[f] && splittable(f)) { splitSurface(f); changed = true; } skip(); continue; }
      // (the centre must be inside: where it lands outside, the tetrahedron's own surface triangle is split instead)
      const tl = cav[0], lab = D.infAt(tl) >= 0 ? 0 : tl < inside.length ? inside[tl] : 255;
      if (lab !== 1) {
        const sk = surfKeysNow(); let fbig = -1, abig = 0;
        for (let k = 0; k < 4; k++) { const f = surfFace(sk, t, k);
          if (f !== undefined) { const a = F[3 * f], b = F[3 * f + 1], c = F[3 * f + 2], u = [X[b] - X[a], Y[b] - Y[a], Z[b] - Z[a]], v = [X[c] - X[a], Y[c] - Y[a], Z[c] - Z[a]];
            const ar = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]); if (ar > abig) { abig = ar; fbig = f; } } }
        if (fbig >= 0 && tooBig && splittable(fbig)) { splitSurface(fbig); changed = true; } else skip();
        continue;
      }
      // (a point for shape alone not crowding the corners there: none of its cavity's within a quarter of the size -- else
      //  points pile up at a corner, closer and closer; the smoothing below takes that tetrahedron)
      if (!tooBig) { const hq = 0.25 * hOf(...q.c); let near = false;
        for (const c of cav) for (let k = 0; k < 4 && !near; k++) { const w = D.tv[4 * c + k]; if (w >= 0 && Math.hypot(X[w] - q.c[0], Y[w] - q.c[1], Z[w] - q.c[2]) < hq) near = true; }
        if (near) { skip(); continue; } }
      const p = X.length; X.push(q.c[0]); Y.push(q.c[1]); Z.push(q.c[2]);
      const made = D.insert(p); if (made === -1) { skipped++; continue; }
      // (its new tetrahedra inside, as the one it landed in: the surface kept them all on one side)
      if (inside.length < D.nT) { const g = new Uint8Array(Math.max(D.nT, 2 * inside.length)).fill(255); g.set(inside); inside = g; }
      for (const m of made) inside[m] = 1;
      refined++; changed = true;
    }
    // (surface triangles split in this pass may be missing: recovered as at the start)
    if (!recoverSurface()) throw new Error('um-tetmesh: the surface was lost in refining');
    if (!changed) break;
  }
  classify();
  // 3. the inside points moved to better places, the surface's held: rounds of optimal-Delaunay smoothing (each point to
  //    the volume-weighted mean of its tetrahedra's circumcentres), then rounds of sliver perturbation (a sliver's free
  //    corners tried a little way off in random directions, the best kept); the tetrahedralization rebuilt after each
  //    round, and a round undone if any surface triangle went missing or a point left the solid
  const fixedRef = { a: new Uint8Array(X.length) }; for (let f = 0; f < F.length / 3; f++) if (alive[f]) for (let k = 0; k < 3; k++) fixedRef.a[F[3 * f + k]] = 1;
  const fixed = new Proxy({}, { get: (_, i) => fixedRef.a[i] || 0 });
  const pt = v => [X[v], Y[v], Z[v]];
  const vol6 = (a, b, c, d) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    return u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]); };
  const dihN = new Float64Array(12);
  const minDih = P => { // the smallest of the six dihedral angles (degrees)
    for (let k = 0; k < 4; k++) { const [i0, i1, i2] = UMT_FACE[k], f0 = P[i0], f1 = P[i1], f2 = P[i2], u0 = f1[0] - f0[0], u1 = f1[1] - f0[1], u2 = f1[2] - f0[2], v0 = f2[0] - f0[0], v1 = f2[1] - f0[1], v2 = f2[2] - f0[2];
      const n0 = u1 * v2 - u2 * v1, n1 = u2 * v0 - u0 * v2, n2 = u0 * v1 - u1 * v0, l = Math.hypot(n0, n1, n2); dihN[3 * k] = n0 / l; dihN[3 * k + 1] = n1 / l; dihN[3 * k + 2] = n2 / l; }
    let m = 180;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const c = Math.abs(dihN[3 * i] * dihN[3 * j] + dihN[3 * i + 1] * dihN[3 * j + 1] + dihN[3 * i + 2] * dihN[3 * j + 2]); m = Math.min(m, Math.acos(Math.min(1, c)) * 180 / Math.PI); }
    return m; };
  const insideTets = () => { const out = []; for (let t = 0; t < D.nT; t++) if (D.alive[t] && inside[t] === 1) out.push(t); return out; };
  const rebuild = (splits = false) => { D = UMM_T.umtTri(X, Y, Z, { seed: o.seed }); const ok = recoverSurface(splits); if (ok) classify(); return ok; };
  /** A round of moves: each must land inside the solid; after rebuilding, the moves near any surface triangle gone
   *  missing are undone (and the rebuild tried again), so one bad move does not cost the round; true if any kept. */
  const tryRound = moves0 => {
    const lab = new Map();
    const moves = moves0.filter(([, q]) => { const t = D.locate(...q); return D.infAt(t) < 0 && t < inside.length && inside[t] === 1; });
    if (!moves.length) return false;
    const old = new Map(moves.map(([v]) => [v, [X[v], Y[v], Z[v]]]));
    for (const [v, q] of moves) { X[v] = q[0]; Y[v] = q[1]; Z[v] = q[2]; }
    for (let attempt = 0; attempt < 4; attempt++) {
      D = UMM_T.umtTri(X, Y, Z, { seed: o.seed });
      let ok = recoverSurface(false);
      if (ok) { classify(); let vt = 0; for (const t of insideTets()) vt += vol6(...[0, 1, 2, 3].map(k => pt(D.tv[4 * t + k]))) / 6; ok = Math.abs(vt / volume0 - 1) < 1e-9; if (ok) return old.size > 0; }
      // (undo the moves near the triangles gone missing; all of them at the last try)
      const fs = faceSet(), miss = []; for (let f = 0; f < F.length / 3; f++) if (alive[f] && !fs.has(F[3 * f], F[3 * f + 1], F[3 * f + 2])) miss.push(f);
      let undone = 0;
      for (const [v, p0] of [...old]) {
        const near = attempt === 3 || !miss.length || miss.some(f => { const a = F[3 * f], b = F[3 * f + 1], c = F[3 * f + 2], cx = (X[a] + X[b] + X[c]) / 3, cy = (Y[a] + Y[b] + Y[c]) / 3, cz = (Z[a] + Z[b] + Z[c]) / 3;
          const r = Math.max(Math.hypot(X[a] - cx, Y[a] - cy, Z[a] - cz), Math.hypot(X[b] - cx, Y[b] - cy, Z[b] - cz), Math.hypot(X[c] - cx, Y[c] - cy, Z[c] - cz));
          return Math.hypot(X[v] - cx, Y[v] - cy, Z[v] - cz) < 3 * r; });
        if (near) { X[v] = p0[0]; Y[v] = p0[1]; Z[v] = p0[2]; old.delete(v); undone++; }
      }
      if (!undone) { for (const [v, p0] of old) { X[v] = p0[0]; Y[v] = p0[1]; Z[v] = p0[2]; } old.clear(); }
    }
    if (!rebuild(true)) throw new Error('um-tetmesh: the surface was lost in optimizing');
    return false;
  };
  let volume0 = 0; for (const t of insideTets()) volume0 += vol6(...[0, 1, 2, 3].map(k => pt(D.tv[4 * t + k]))) / 6;
  let smoothed = 0, perturbed = 0;
  for (let round = 0; round < (o.smooth ?? 8); round++) {
    const W = new Float64Array(X.length), C = new Float64Array(3 * X.length);
    for (const t of insideTets()) {
      const v = [0, 1, 2, 3].map(k => D.tv[4 * t + k]), q = tetInfo(t), w = Math.abs(vol6(...v.map(pt)));
      for (const i of v) if (!fixed[i]) { W[i] += w; C[3 * i] += w * q.c[0]; C[3 * i + 1] += w * q.c[1]; C[3 * i + 2] += w * q.c[2]; }
    }
    const moves = [], damp = 0.8; for (let v = 0; v < X.length; v++) if (!fixed[v] && W[v] > 0) moves.push([v, [0, 1, 2].map(d => pt(v)[d] + damp * (C[3 * v + d] / W[v] - pt(v)[d]))]);
    if (!moves.length) break;
    if (tryRound(moves)) smoothed++;
  }
  let rs = 99991;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  for (let round = 0; round < (o.perturb ?? 10); round++) {
    const tets = insideTets(), inc = new Map();
    for (const t of tets) for (let k = 0; k < 4; k++) { const v = D.tv[4 * t + k]; (inc.get(v) || inc.set(v, []).get(v)).push(t); }
    const worstAt = (v, q) => { let m = 180; for (const t of inc.get(v)) { const P = [0, 1, 2, 3].map(k => { const u = D.tv[4 * t + k]; return u === v ? q : pt(u); }); if (vol6(...P) <= 0) return -1; m = Math.min(m, minDih(P)); } return m; };
    const slivers = tets.filter(t => minDih([0, 1, 2, 3].map(k => pt(D.tv[4 * t + k]))) < (o.sliver ?? 12));
    if (!slivers.length) break;
    // (a sliver with every corner on the surface cannot be moved: a point at its middle instead, if it keeps the surface)
    let added = 0;
    for (const t of slivers) {
      const v = [0, 1, 2, 3].map(k => D.tv[4 * t + k]); if (!v.every(i => fixed[i])) continue;
      const c = [0, 1, 2].map(d => (pt(v[0])[d] + pt(v[1])[d] + pt(v[2])[d] + pt(v[3])[d]) / 4);
      const cav = D.cavityOf(...c), inCav = new Set(cav), sk = surfKeysNow(); let lose = false;
      for (const u of cav) for (let k = 0; k < 4 && !lose; k++) if (inCav.has(D.tn[4 * u + k]) && surfFace(sk, u, k) !== undefined) lose = true;
      if (lose) continue;
      const p = X.length; X.push(c[0]); Y.push(c[1]); Z.push(c[2]);
      if (D.insert(p) !== -1) added++; else { X.pop(); Y.pop(); Z.pop(); }
    }
    if (added) { const f2 = new Uint8Array(X.length); f2.set(fixed); fixedRef.a = f2; rebuild(true); perturbed++; continue; }
    const moves = new Map();
    for (const t of slivers) for (let k = 0; k < 4; k++) {
      const v = D.tv[4 * t + k]; if (fixed[v] || moves.has(v)) continue;
      let lmin = Infinity; for (const u of inc.get(v)) for (let j = 0; j < 4; j++) { const w = D.tv[4 * u + j]; if (w !== v) lmin = Math.min(lmin, Math.hypot(X[w] - X[v], Y[w] - Y[v], Z[w] - Z[v])); }
      let best = worstAt(v, pt(v)), bq = null;
      for (let trial = 0; trial < 12; trial++) {
        const th = Math.acos(2 * rnd() - 1), ph = 2 * Math.PI * rnd(), r = (0.05 + 0.2 * rnd()) * lmin;
        const q = [X[v] + r * Math.sin(th) * Math.cos(ph), Y[v] + r * Math.sin(th) * Math.sin(ph), Z[v] + r * Math.cos(th)], m = worstAt(v, q);
        if (m > best) { best = m; bq = q; }
      }
      if (bq) moves.set(v, bq);
    }
    if (!moves.size) break;
    if (tryRound([...moves])) perturbed++;
  }
  // 4. the mesh: the inside tetrahedra, renumbered; the surface's triangles
  const used = new Int32Array(X.length).fill(-1), PX = [], PY = [], PZ = [], tet = [], src = [];
  const use = v => { if (used[v] < 0) { used[v] = PX.length; PX.push(X[v]); PY.push(Y[v]); PZ.push(Z[v]); src.push(v); } return used[v]; };
  for (let t = 0; t < D.nT; t++) if (D.alive[t] && inside[t] === 1) for (let k = 0; k < 4; k++) tet.push(use(D.tv[4 * t + k]));
  const bface = [], btag = [];
  for (let f = 0; f < F.length / 3; f++) if (alive[f]) { bface.push(use(F[3 * f]), use(F[3 * f + 1]), use(F[3 * f + 2])); btag.push(Ftag[f]); }
  // (where each point came from: S's point (its index), or new (≥ S's count); the surface's new points each the middle of
  //  two others, in the mesh's numbering)
  const mid = []; for (let i = 0; i < midOf.length; i += 3) if (used[midOf[i]] >= 0) mid.push(used[midOf[i]], used[midOf[i + 1]], used[midOf[i + 2]]);
  const out = { X: Float64Array.from(PX), Y: Float64Array.from(PY), Z: Float64Array.from(PZ), tet: Int32Array.from(tet), bface: Int32Array.from(bface), btag,
    src: Int32Array.from(src), mid: Int32Array.from(mid),
    stats: { surfacePoints: S.X.length, points: PX.length, tets: tet.length / 4, surfaceSplits: nSplit, refined, skipped, smoothed, perturbed } };
  if (o.improve !== false) Object.assign(out.stats, umtImprove(out, o));
  return out;
}

/**
 * The finished mesh improved in place, its connectivity no longer held to Delaunay's: flips (two tetrahedra on a face into
 * three round an edge, and three into two) and moves of the inner points, each kept only if it raises the smallest
 * dihedral angle among the tetrahedra it touches; a bad tetrahedron none of those mend (every corner on the surface,
 * or its inner ones held by their other tetrahedra) gets a new inner point -- in it, or below a crease where two of its faces are on the surface -- with the cavity of
 * tetrahedra the point sees, kept only if the tetrahedra it leaves are better than those it took away, else undone. The
 * surface's points and faces never change. M = { X, Y, Z, tet, bface } (umtVolume's); the tetrahedra rewritten (and the
 * new points added). Returns { flips23, flips32, moves, splits (new points kept), dihedralMin }.
 */
function umtImprove(M, o = {}) {
  let X = M.X, Y = M.Y, Z = M.Z; const target = o.dihedral ?? 18, useRho = o.radiusRatio !== false;
  const X2 = m => { X = m.X; Y = m.Y; Z = m.Z; };
  let T = Array.from(M.tet), nT = T.length / 4, aliveT = new Array(nT).fill(true);
  let fixed = new Uint8Array(X.length); for (const v of M.bface) fixed[v] = 1;
  const fixedSet = f => { fixed = f; };
  const P = v => [X[v], Y[v], Z[v]];
  const vol = (a, b, c, d) => { const u0 = b[0] - a[0], u1 = b[1] - a[1], u2 = b[2] - a[2], v0 = c[0] - a[0], v1 = c[1] - a[1], v2 = c[2] - a[2], w0 = d[0] - a[0], w1 = d[1] - a[1], w2 = d[2] - a[2];
    return u0 * (v1 * w2 - v2 * w1) - u1 * (v0 * w2 - v2 * w0) + u2 * (v0 * w1 - v1 * w0); };
  /** A tetrahedron's worst dihedral angle (degrees, as min(θ, 180° − θ) over its six) given its four corners; −1 if it is
   *  inverted or flat. */
  const qN = new Float64Array(12), qL = new Float64Array(4);
  const q = Q => {
    if (!(vol(Q[0], Q[1], Q[2], Q[3]) > 0)) return -1;
    // (each face's unit normal, and its doubled area)
    for (let k = 0; k < 4; k++) { const [i0, i1, i2] = UMT_FACE[k], f0 = Q[i0], f1 = Q[i1], f2 = Q[i2], u0 = f1[0] - f0[0], u1 = f1[1] - f0[1], u2 = f1[2] - f0[2], w0 = f2[0] - f0[0], w1 = f2[1] - f0[1], w2 = f2[2] - f0[2];
      const n0 = u1 * w2 - u2 * w1, n1 = u2 * w0 - u0 * w2, n2 = u0 * w1 - u1 * w0, l = Math.hypot(n0, n1, n2); qN[3 * k] = n0 / l; qN[3 * k + 1] = n1 / l; qN[3 * k + 2] = n2 / l; qL[k] = l; }
    // (each dihedral θ counted as min(θ, 180° − θ): its sine's angle, small for a sliver's near-0° and near-180° alike)
    let m = 90; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) m = Math.min(m, Math.acos(Math.min(1, Math.abs(qN[3 * i] * qN[3 * j] + qN[3 * i + 1] * qN[3 * j + 1] + qN[3 * i + 2] * qN[3 * j + 2]))) * 180 / Math.PI);
    if (!useRho) return m;
    // (and its radius ratio 3 r_in / r_circ, 1 for the regular tetrahedron: the worse of the two, on the dihedral's scale)
    const V6 = vol(Q[0], Q[1], Q[2], Q[3]); let A = 0;
    for (let k = 0; k < 4; k++) A += qL[k] / 2;
    const a = Q[0], b00 = Q[1][0] - a[0], b01 = Q[1][1] - a[1], b02 = Q[1][2] - a[2], b10 = Q[2][0] - a[0], b11 = Q[2][1] - a[1], b12 = Q[2][2] - a[2], b20 = Q[3][0] - a[0], b21 = Q[3][1] - a[1], b22 = Q[3][2] - a[2];
    const r0 = (b00 * b00 + b01 * b01 + b02 * b02) / 2, r1 = (b10 * b10 + b11 * b11 + b12 * b12) / 2, r2 = (b20 * b20 + b21 * b21 + b22 * b22) / 2;
    const cx = (r0 * (b11 * b22 - b12 * b21) - b01 * (r1 * b22 - b12 * r2) + b02 * (r1 * b21 - b11 * r2)) / V6;
    const cy = (b00 * (r1 * b22 - b12 * r2) - r0 * (b10 * b22 - b12 * b20) + b02 * (b10 * r2 - r1 * b20)) / V6;
    const cz = (b00 * (b11 * r2 - r1 * b21) - b01 * (b10 * r2 - r1 * b20) + r0 * (b10 * b21 - b11 * b20)) / V6;
    const rho = 3 * (V6 / 2 / A) / Math.hypot(cx, cy, cz);   // (r_in = 3 V / A = V6 / (2 A))
    return Math.min(m, rho * 70.528779);
  };
  const QB = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const qt = t => { for (let k = 0; k < 4; k++) { const v = T[4 * t + k]; QB[k][0] = X[v]; QB[k][1] = Y[v]; QB[k][2] = Z[v]; } return q(QB); };
  // faces → tetrahedra, vertices → tetrahedra
  const fkey = (a, b, c) => { const s3 = [a, b, c].sort((x, y) => x - y); return s3[0] + ',' + s3[1] + ',' + s3[2]; };
  const faces = new Map(), vt = new Map();
  const add = t => { for (let k = 0; k < 4; k++) { const f = [0, 1, 2, 3].filter(i => i !== k).map(i => T[4 * t + i]), key = fkey(...f); (faces.get(key) || faces.set(key, []).get(key)).push(t);
    const v = T[4 * t + k]; (vt.get(v) || vt.set(v, new Set()).get(v)).add(t); } };
  let log = null;   // (while a new point is tried: the tetrahedra deleted and made, to undo it)
  const del = t => { if (log) log.push(-1 - t); aliveT[t] = false; for (let k = 0; k < 4; k++) { const f = [0, 1, 2, 3].filter(i => i !== k).map(i => T[4 * t + i]), key = fkey(...f), l = faces.get(key); l.splice(l.indexOf(t), 1); if (!l.length) faces.delete(key); vt.get(T[4 * t + k]).delete(t); } };
  const make = (a, b, c, d) => { const t = T.length / 4; T.push(a, b, c, d); aliveT.push(true); add(t); if (log) log.push(t); return t; };
  for (let t = 0; t < nT; t++) add(t);
  let flips23 = 0, flips32 = 0, moves = 0;
  /** Two tetrahedra on face a b c (apexes d, e) into three round the edge d–e, if better. */
  const flip23 = (t, k) => {
    const f = [0, 1, 2, 3].filter(i => i !== k).map(i => T[4 * t + i]), key = fkey(...f), l = faces.get(key); if (!l || l.length !== 2) return false;
    const u = l[0] === t ? l[1] : l[0], d = T[4 * t + k], e = [0, 1, 2, 3].map(i => T[4 * u + i]).find(v => !f.includes(v));
    // (oriented: t = (…) positive; the three new ones (d, e, a, b) style, each checked)
    const [a, b, c] = vol(P(f[0]), P(f[1]), P(f[2]), P(d)) > 0 ? f : [f[0], f[2], f[1]];
    const nw = [[a, b, e, d], [b, c, e, d], [c, a, e, d]].map(v => (vol(...v.map(P)) > 0 ? v : [v[1], v[0], v[2], v[3]]));
    const oldQ = Math.min(qt(t), qt(u)), newQ = Math.min(...nw.map(v => q(v.map(P))));
    if (!(newQ > oldQ + 1e-9) || nw.some(v => !(vol(...v.map(P)) > 0))) return false;
    // (the three must fill exactly the two: the volumes equal)
    const v0 = vol(...[0, 1, 2, 3].map(i => P(T[4 * t + i]))) + vol(...[0, 1, 2, 3].map(i => P(T[4 * u + i]))), v1 = nw.reduce((sum, v) => sum + vol(...v.map(P)), 0);
    if (Math.abs(v1 - v0) > 1e-12 * Math.abs(v0)) return false;
    del(t); del(u); for (const v of nw) make(...v); flips23++; return true;
  };
  /** Three tetrahedra round an inner edge d–e into two on the face of their other three corners, if better. */
  const flip32 = (d, e) => {
    const ring = [...vt.get(d)].filter(t => [0, 1, 2, 3].some(i => T[4 * t + i] === e)); if (ring.length !== 3) return false;
    const others = [...new Set(ring.flatMap(t => [0, 1, 2, 3].map(i => T[4 * t + i]).filter(v => v !== d && v !== e)))]; if (others.length !== 3) return false;
    // (an inner edge: each face round it shared by two of the ring)
    for (const t of ring) for (let k = 0; k < 4; k++) { const v = T[4 * t + k]; if (v === d || v === e) continue; const f = [0, 1, 2, 3].filter(i => i !== k).map(i => T[4 * t + i]); if (f.includes(d) && f.includes(e) && (faces.get(fkey(...f)) || []).length !== 2) return false; }
    const [a, b, c] = others, t1 = vol(P(a), P(b), P(c), P(d)) > 0 ? [a, b, c, d] : [a, c, b, d], t2 = vol(P(a), P(b), P(c), P(e)) > 0 ? [a, b, c, e] : [a, c, b, e];
    if (!(vol(...t1.map(P)) > 0 && vol(...t2.map(P)) > 0)) return false;
    const oldQ = Math.min(...ring.map(qt)), newQ = Math.min(q(t1.map(P)), q(t2.map(P)));
    if (!(newQ > oldQ + 1e-9)) return false;
    const v0 = ring.reduce((sum, t) => sum + vol(...[0, 1, 2, 3].map(i => P(T[4 * t + i]))), 0), v1 = vol(...t1.map(P)) + vol(...t2.map(P));
    if (Math.abs(v1 - v0) > 1e-12 * Math.abs(v0)) return false;
    for (const t of ring) del(t); make(...t1); make(...t2); flips32++; return true;
  };
  let rs = 4242; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  let splits = 0;
  /** A new inner point c put in: the tetrahedra it must replace (a cavity grown from `seeds` across each face c does not
   *  see, or would make a tetrahedron worse than `goal` with -- never across the surface), each of the cavity's faces
   *  joined to c; then c moved and the new tetrahedra flipped as they can. Returns the worst of the tetrahedra taken away
   *  and of those left, and how to undo it (the point and every tetrahedron as they were); null if it cannot be done. */
  const tryPoint = (c, seeds, goal) => {
    const nT0 = T.length / 4, inC = new Set(seeds);
    const faceOf = (t, k) => { const f = [0, 1, 2, 3].filter(i => i !== k).map(i => T[4 * t + i]); return vol(P(f[0]), P(f[1]), P(f[2]), P(T[4 * t + k])) > 0 ? f : [f[0], f[2], f[1]]; };
    const across = (t, f) => { const l = faces.get(fkey(...f)); return l.length === 2 ? (l[0] === t ? l[1] : l[0]) : -1; };
    for (let it = 0; it < 64; it++) {
      let grow = -1;
      for (const t of inC) { for (let k = 0; k < 4 && grow < 0; k++) { const f = faceOf(t, k), u = across(t, f); if (u >= 0 && inC.has(u)) continue;
          const m = q([P(f[0]), P(f[1]), P(f[2]), c]);
          if (u < 0 && m < 0) return null;   // (c behind the surface)
          if (u >= 0 && m < goal) grow = u; }
        if (grow >= 0) break; }
      if (grow < 0) break; inC.add(grow);
    }
    // (c sees every face of the cavity, keeps every point of it, and the new tetrahedra fill exactly the old)
    const bnd = [], kept = new Set();
    for (const t of inC) for (let k = 0; k < 4; k++) { const f = faceOf(t, k), u = across(t, f); if (u >= 0 && inC.has(u)) continue;
      if (!(vol(P(f[0]), P(f[1]), P(f[2]), c) > 0)) return null; bnd.push(f); for (const w of f) kept.add(w); }
    for (const t of inC) for (let k = 0; k < 4; k++) if (!kept.has(T[4 * t + k])) return null;
    const v0 = [...inC].reduce((sum, t) => sum + vol(...[0, 1, 2, 3].map(i => P(T[4 * t + i]))), 0), v1 = bnd.reduce((sum, f) => sum + vol(P(f[0]), P(f[1]), P(f[2]), c), 0);
    if (Math.abs(v1 - v0) > 1e-10 * v0) return null;
    const p = X.length, fixed0 = fixed, X0 = M.X, Y0 = M.Y, Z0 = M.Z, counts = [flips23, moves];
    // (the coordinate arrays are typed: grown by copying)
    const grow = A => { const B = new Float64Array(A.length + 1); B.set(A); return B; };
    M.X = grow(M.X); M.Y = grow(M.Y); M.Z = grow(M.Z); X2(M); X[p] = c[0]; Y[p] = c[1]; Z[p] = c[2];
    const f2 = new Uint8Array(p + 1); f2.set(fixed); fixedSet(f2);
    log = [];
    for (const t of inC) del(t);
    const nw = bnd.map(f => make(f[0], f[1], f[2], p));
    smooth(p);
    for (const u of nw) if (aliveT[u]) for (let k = 0; k < 4; k++) if (aliveT[u] && T[4 * u + k] !== p) flip23(u, k);
    // (the old: those taken away that were there before, at the corners they had, none of which moved; the new: those
    //  made that are still there)
    const L = log; log = null;
    let old = 180, now = 180;
    for (const e of L) if (e < 0 && -1 - e < nT0) old = Math.min(old, qt(-1 - e));
    for (const e of L) if (e >= 0 && aliveT[e]) now = Math.min(now, qt(e));
    const undo = () => {
      // (last first: a made one deleted again, a deleted one put back)
      for (let i = L.length - 1; i >= 0; i--) { const e = L[i]; if (e >= 0) del(e); else { aliveT[-1 - e] = true; add(-1 - e); } }
      T.length = 4 * nT0; aliveT.length = nT0; vt.delete(p);
      M.X = X0; M.Y = Y0; M.Z = Z0; X2(M); fixedSet(fixed0); [flips23, moves] = counts;
    };
    return { old, now, undo };
  };
  /** A bad tetrahedron no flip or move mends (every corner on the surface, or its inner ones held): a point tried at its middle (its
   *  cavity at least the tetrahedron: four at least) and, where two of its faces are on the surface, below their common
   *  edge, into the solid along the two faces' inward bisector -- a crease's only tetrahedron has the crease's dihedral
   *  there whatever its corners do, and a point inside it, as flat as it is, only makes flat ones. The best kept if the
   *  tetrahedra it leaves are better than those it took away. */
  const insertFor = t => {
    const Pv = [0, 1, 2, 3].map(k => P(T[4 * t + k])), cands = [[0, 1, 2].map(d => (Pv[0][d] + Pv[1][d] + Pv[2][d] + Pv[3][d]) / 4)];
    const inward = k => { const f = [0, 1, 2, 3].filter(i => i !== k); if (faces.get(fkey(...f.map(i => T[4 * t + i]))).length !== 1) return null;
      const [a, b, d] = f.map(i => Pv[i]), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n);
      if ((Pv[k][0] - a[0]) * n[0] + (Pv[k][1] - a[1]) * n[1] + (Pv[k][2] - a[2]) * n[2] < 0) n = n.map(x => -x); return n.map(x => x / l); };
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const [k, l] = [0, 1, 2, 3].filter(m => m !== i && m !== j), nk = inward(k), nl = inward(l); if (!nk || !nl) continue;
      const bis = [nk[0] + nl[0], nk[1] + nl[1], nk[2] + nl[2]], bl = Math.hypot(...bis); if (!(bl > 1e-9)) continue;
      const m = [0, 1, 2].map(d => (Pv[i][d] + Pv[j][d]) / 2), L = Math.hypot(Pv[j][0] - Pv[i][0], Pv[j][1] - Pv[i][1], Pv[j][2] - Pv[i][2]);
      for (const s of [0.2, 0.35, 0.5, 0.7]) cands.push(m.map((x, d) => x + s * L * bis[d] / bl));
    }
    let best = null;
    for (const c of cands) { const r0 = rs, r = tryPoint(c, [t], target); if (!r) continue; r.undo();
      if (r.now > r.old + 1e-9 && (!best || r.now > best.now)) best = { c, r0, now: r.now }; }
    if (!best) return false;
    // (done again as it was tried: the same random moves)
    rs = best.r0; const r = tryPoint(best.c, [t], target);
    if (r && r.now > r.old + 1e-9) { splits++; return true; }
    if (r) r.undo(); return false;
  };
  /** An inner point moved (random tries about it, the best kept) if the worst tetrahedron round it gets better. */
  const smooth = v => {
    if (fixed[v]) return false;
    const ring = [...vt.get(v)], worst = p => { let m = 180; for (const t of ring) { const Q = [0, 1, 2, 3].map(i => (T[4 * t + i] === v ? p : P(T[4 * t + i]))); const qq = q(Q); if (qq < 0) return -1; m = Math.min(m, qq); } return m; };
    let lmin = Infinity; for (const t of ring) for (let i = 0; i < 4; i++) { const w = T[4 * t + i]; if (w !== v) lmin = Math.min(lmin, Math.hypot(X[w] - X[v], Y[w] - Y[v], Z[w] - Z[v])); }
    // (first the centroid of the ring's points, then random steps)
    let best = worst(P(v)), bp = null;
    const nb = new Set(); for (const t of ring) for (let i = 0; i < 4; i++) if (T[4 * t + i] !== v) nb.add(T[4 * t + i]);
    const c = [0, 1, 2].map(d => [...nb].reduce((sum, w) => sum + P(w)[d], 0) / nb.size), mc = worst(c); if (mc > best) { best = mc; bp = c; }
    for (let tr = 0; tr < 16; tr++) {
      const base = bp || P(v), th = Math.acos(2 * rnd() - 1), ph = 2 * Math.PI * rnd(), r = (0.02 + 0.2 * rnd()) * lmin;
      const p = [base[0] + r * Math.sin(th) * Math.cos(ph), base[1] + r * Math.sin(th) * Math.sin(ph), base[2] + r * Math.cos(th)], m = worst(p);
      if (m > best + 1e-9) { best = m; bp = p; }
    }
    if (!bp) return false;
    X[v] = bp[0]; Y[v] = bp[1]; Z[v] = bp[2]; moves++; return true;
  };
  for (let round = 0; round < (o.improveRounds ?? 12); round++) {
    const bad = []; for (let t = 0; t < T.length / 4; t++) if (aliveT[t]) { const m = qt(t); if (m < target) bad.push([m, t]); }
    if (!bad.length) break;
    bad.sort((a, b) => a[0] - b[0]);
    let any = false;
    for (const [, t] of bad) {
      if (!aliveT[t]) continue;
      let done = false;
      for (let k = 0; k < 4 && !done; k++) done = flip23(t, k);
      for (let i = 0; i < 4 && !done; i++) for (let j = i + 1; j < 4 && !done; j++) done = flip32(T[4 * t + i], T[4 * t + j]);
      if (!done) for (let k = 0; k < 4 && !done; k++) done = smooth(T[4 * t + k]);
      // (no flip or move helps -- every corner on the surface, or the inner ones held where they are: a new point, in it
      //  or below a crease it spans, kept only if better)
      if (!done) done = insertFor(t);
      if (done) any = true;
    }
    if (!any) break;
  }
  const out = []; for (let t = 0; t < T.length / 4; t++) if (aliveT[t]) out.push(T[4 * t], T[4 * t + 1], T[4 * t + 2], T[4 * t + 3]);
  M.tet = Int32Array.from(out);
  let dmin = 90; for (let t = 0; t < M.tet.length / 4; t++) dmin = Math.min(dmin, q([0, 1, 2, 3].map(k => P(M.tet[4 * t + k]))));   // (the worse of the dihedral and 70.5° × the radius ratio)
  return { flips23, flips32, moves, splits, dihedralMin: dmin };
}

/**
 * The tetrahedra made quadratic (P2, 10 nodes, um-fe.js's tet10): a node at each edge's middle, shared by the tetrahedra
 * on it; on a curved wall every node -- corners (which the mesher left on the wall's flat facets) and edges' middles --
 * moved onto the true surface (o.project: { tag: (x, y, z) → [x, y, z] }, each wall's own; a node on two walls takes each
 * one's in turn, the flat ones having none, so it lands where they meet), the inner mid-edge nodes beside it following. V: umtVolume's
 * output (or umlAssemble's tetrahedra). Returns the finite-element mesh um-fe.js reads: { type: 'tet10', nN, nE, X, Y, Z,
 * conn (10 each), faces: [{ e, f (um-fe.js's face number), tag }] (the surface's triangles), moved (mid-edge nodes moved
 * onto a curved wall, corners and edges' middles), maxMove, limited (of them, those held short of it so no element folds -- each element touched is
 * positive at the solver's quadrature points and its ten nodes), short (the farthest one held short, m) }.
 */
function umtQuadratic(V, o = {}) {
  const nP = V.X.length, nT = V.tet.length / 4, proj = o.project || {};
  // (the surface's edges and points, and the walls they lie on)
  const ek = (a, b) => (a < b ? a * nP + b : b * nP + a), edgeTags = new Map(), ptTags = new Map();
  for (let f = 0; f < V.bface.length / 3; f++) for (let k = 0; k < 3; k++) {
    const key = ek(V.bface[3 * f + k], V.bface[3 * f + (k + 1) % 3]), l = edgeTags.get(key) || edgeTags.set(key, []).get(key); if (!l.includes(V.btag[f])) l.push(V.btag[f]);
    const v = V.bface[3 * f + k], m = ptTags.get(v) || ptTags.set(v, []).get(v); if (!m.includes(V.btag[f])) m.push(V.btag[f]); }
  const onWall = (p, tags) => { let q = p; for (const tg of tags || []) if (proj[tg]) q = proj[tg](q[0], q[1], q[2]); return q; };
  // each node: its straight place (a corner: where the mesher put it; a mid-edge node: its edge's middle, from its ends as
  // they stand) and its move onto the curved wall (a corner on a curved wall's facet lies on the chord: it moves too, so
  // the wall is the true surface at its corners and its edges' middles alike)
  const X = Array.from(V.X), Y = Array.from(V.Y), Z = Array.from(V.Z), X0 = X.slice(), Y0 = Y.slice(), Z0 = Z.slice();
  const disp = new Map(), ends = new Map(), wallMoved = new Set(), onSurf = new Set();
  for (const [v, tags] of ptTags) { const q = onWall([X[v], Y[v], Z[v]], tags); if (q[0] !== X[v] || q[1] !== Y[v] || q[2] !== Z[v]) { disp.set(v, [q[0] - X[v], q[1] - Y[v], q[2] - Z[v]]); wallMoved.add(v); } }
  const mid = new Map(), conn = new Int32Array(10 * nT), EDG = [[0, 1], [1, 2], [0, 2], [0, 3], [1, 3], [2, 3]];
  const at = (v, s) => { const d = disp.get(v), f = s.get(v) ?? 1; return d ? [X0[v] + f * d[0], Y0[v] + f * d[1], Z0[v] + f * d[2]] : [X0[v], Y0[v], Z0[v]]; };
  const scale = new Map();
  for (let t = 0; t < nT; t++) {
    const v = [V.tet[4 * t], V.tet[4 * t + 1], V.tet[4 * t + 2], V.tet[4 * t + 3]];
    for (let k = 0; k < 4; k++) conn[10 * t + k] = v[k];
    EDG.forEach(([i, j], k) => {
      const key = ek(v[i], v[j]); let m = mid.get(key);
      if (m === undefined) {
        const a = at(v[i], scale), b = at(v[j], scale), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], tags = edgeTags.get(key);
        m = X.length; X.push(c[0]); Y.push(c[1]); Z.push(c[2]); X0.push(0); Y0.push(0); Z0.push(0); mid.set(key, m); ends.set(m, [v[i], v[j]]);
        if (tags) { onSurf.add(m); const q = onWall(c, tags); if (q[0] !== c[0] || q[1] !== c[1] || q[2] !== c[2]) { disp.set(m, [q[0] - c[0], q[1] - c[1], q[2] - c[2]]); wallMoved.add(m); } }
      }
      conn[10 * t + 4 + k] = m;
    });
  }
  let moved = 0, maxMove = 0; for (const n of wallMoved) { moved++; maxMove = Math.max(maxMove, Math.hypot(...disp.get(n))); }
  // (the walls' bend carried into the elements beside them: each inner mid-edge node moved by the mean of its elements'
  //  other nodes' moves -- the inner corners not moving, the surface's nodes as set (moved or not) -- a few sweeps: an
  //  element lying along a curved wall bends with it rather than fold)
  if (wallMoved.size) {
    const nb = new Map();
    for (let e = 0; e < nT; e++) { let near = false; for (let i = 0; i < 10; i++) if (wallMoved.has(conn[10 * e + i])) near = true; if (!near) continue;
      for (let i = 4; i < 10; i++) { const n = conn[10 * e + i]; if (onSurf.has(n)) continue; const l = nb.get(n) || nb.set(n, []).get(n); for (let j = 0; j < 10; j++) if (j !== i) l.push(conn[10 * e + j]); } }
    for (let sweep = 0; sweep < (o.bendSweeps ?? 8); sweep++) {
      const next = new Map();
      for (const [n, l] of nb) { let dx = 0, dy = 0, dz = 0; for (const m of l) { const d = disp.get(m); if (d) { dx += d[0]; dy += d[1]; dz += d[2]; } } next.set(n, [dx / l.length, dy / l.length, dz / l.length]); }
      for (const [n, d] of next) disp.set(n, d);
    }
  }
  // (each node where it stands: a corner its place plus its move; a mid-edge node its ends' middle plus its own)
  const place = n => { if (ends.has(n)) { const [i, j] = ends.get(n), a = at(i, scale), b = at(j, scale), d = disp.get(n), f = scale.get(n) ?? 1;
      X[n] = (a[0] + b[0]) / 2 + (d ? f * d[0] : 0); Y[n] = (a[1] + b[1]) / 2 + (d ? f * d[1] : 0); Z[n] = (a[2] + b[2]) / 2 + (d ? f * d[2] : 0); }
    else { const q = at(n, scale); X[n] = q[0]; Y[n] = q[1]; Z[n] = q[2]; } };
  for (let n = 0; n < X.length; n++) if (disp.has(n) || ends.has(n)) place(n);
  // (every element with a moved node positive throughout -- its Jacobian at the solver's quadrature points and at its
  //  ten nodes; one that is not has its moves halved, again until it is: counted, never left folded)
  const pts = []; { const R = UMM_F.ufeRule('tet10', 5); for (let q = 0; q < R.nq; q++) pts.push(Array.from(R.xi.subarray(3 * q, 3 * q + 3)));
    for (const xi of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0, 0.5], [0, 0.5, 0.5]]) pts.push(xi); }
  const dN = pts.map(xi => UMM_F.ufeShape('tet10', xi).dN);
  const ok = e => { for (const d of dN) { let a = 0, b = 0, c = 0, f = 0, g = 0, h = 0, k = 0, l = 0, m = 0;
      for (let i = 0; i < 10; i++) { const n = conn[10 * e + i], x = X[n], y = Y[n], z = Z[n], d0 = d[3 * i], d1 = d[3 * i + 1], d2 = d[3 * i + 2];
        a += x * d0; b += x * d1; c += x * d2; f += y * d0; g += y * d1; h += y * d2; k += z * d0; l += z * d1; m += z * d2; }
      if (!(a * (g * m - h * l) - b * (f * m - h * k) + c * (f * l - g * k) > 0)) return false; } return true; };
  let limited = 0, short = 0;
  if (disp.size) {
    const touch = [], users = new Map();
    for (let e = 0; e < nT; e++) { let near = false; for (let i = 0; i < 10; i++) { const n = conn[10 * e + i]; if (disp.has(n)) near = true; } if (near) touch.push(e); }
    for (const [m, [i, j]] of ends) for (const v of [i, j]) if (disp.has(v)) (users.get(v) || users.set(v, []).get(v)).push(m);
    for (let it = 0; it < 40; it++) {
      const bad = touch.filter(e => !ok(e)); if (!bad.length) break;
      const redo = new Set();
      for (const e of bad) for (let i = 0; i < 10; i++) { const n = conn[10 * e + i]; if (!disp.has(n)) continue; scale.set(n, (scale.get(n) ?? 1) / 2); redo.add(n); for (const m of users.get(n) || []) redo.add(m); }
      for (const n of redo) place(n);
    }
    for (const [n, f] of scale) { if (!wallMoved.has(n)) continue; limited++; short = Math.max(short, (1 - f) * Math.hypot(...disp.get(n))); }
    { const still = touch.filter(e => !ok(e)); if (still.length) { const e = still[0], c = [0, 1, 2, 3].map(i => conn[10 * e + i]);
        const P = i => [X0[i], Y0[i], Z0[i]], [a, b, c2, d] = c.map(P), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const v6 = u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]);
        throw new Error(`um-tetmesh: ${still.length} curved elements stayed folded (the first: its straight volume × 6 ${v6.toExponential(2)}, scales ${Array.from(conn.subarray(10 * e, 10 * e + 10)).map(n => (scale.get(n) ?? (disp.has(n) ? 1 : '-'))).join(' ')})`); } }
  }
  // the surface's triangles as faces of their tetrahedra (um-fe.js's: 0 (0 1 3), 1 (1 2 3), 2 (0 3 2), 3 (0 2 1))
  const FACE = [[0, 1, 3], [1, 2, 3], [0, 3, 2], [0, 2, 1]], fkey = (a, b, c) => { const s3 = [a, b, c].sort((x, y) => x - y); return s3[0] * nP * nP + s3[1] * nP + s3[2]; };
  const fat = new Map();
  for (let t = 0; t < nT; t++) for (let f = 0; f < 4; f++) fat.set(fkey(...FACE[f].map(i => V.tet[4 * t + i])), [t, f]);
  const faces = [];
  for (let f = 0; f < V.bface.length / 3; f++) { const ef = fat.get(fkey(V.bface[3 * f], V.bface[3 * f + 1], V.bface[3 * f + 2]));
    if (!ef) throw new Error('um-tetmesh: a surface triangle that is no tetrahedron\'s face'); faces.push({ e: ef[0], f: ef[1], tag: V.btag[f] }); }
  return { type: 'tet10', nN: X.length, nE: nT, X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z), conn, faces, moved, maxMove, limited, short };
}

/** A graded size over space (see the header): (x, y, z) → h. */
function umtSizeField(spec) {
  const H = spec.h, g = (spec.grow ?? 1.3) - 1, boxes = spec.boxes || [], lines = spec.lines || [], points = spec.points || [];
  const dBox = (B, x, y, z) => Math.hypot(Math.max(B.min[0] - x, 0, x - B.max[0]), Math.max(B.min[1] - y, 0, y - B.max[1]), Math.max(B.min[2] - z, 0, z - B.max[2]));
  const dLine = (Ln, x, y, z) => {
    const d = [Ln.b[0] - Ln.a[0], Ln.b[1] - Ln.a[1], Ln.b[2] - Ln.a[2]], dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = dd > 0 ? Math.min(1, Math.max(0, ((x - Ln.a[0]) * d[0] + (y - Ln.a[1]) * d[1] + (z - Ln.a[2]) * d[2]) / dd)) : 0;
    return Math.hypot(x - Ln.a[0] - t * d[0], y - Ln.a[1] - t * d[1], z - Ln.a[2] - t * d[2]);
  };
  return (x, y, z) => {
    let h = H;
    for (const B of boxes) h = Math.min(h, B.h + g * dBox(B, x, y, z));
    for (const Ln of lines) h = Math.min(h, Ln.h + g * Math.max(0, dLine(Ln, x, y, z) - (Ln.r || 0)));
    for (const P of points) h = Math.min(h, P.h + g * Math.max(0, Math.hypot(x - P.at[0], y - P.at[1], z - P.at[2]) - (P.r || 0)));
    return h;
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { umtSurface, umtVolume, umtImprove, umtInsidePoint, umtSizeField, umtQuadratic };
