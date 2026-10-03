/*
 * um-tri.js — the app's own 2D triangle mesher (MESH-T2): constrained Delaunay triangulation with Ruppert's refinement, for
 * the surface patches of the tetrahedral mesher (each meshed in its own flat parameters, which for the coater's planes,
 * cylinders and extruded blade faces are lengths, so the triangles keep their shape on the surface). No GPL code.
 *
 *   utOrient(a, b, c) = (b − a) × (c − a): > 0 when a b c run counter-clockwise; utInCircle(a, b, c, d) > 0 when d is inside
 *   the circle through a b c (counter-clockwise): floating point with Shewchuk's bounds, exact (BigInt) when they cannot tell.
 *   utMesh(G, o): G = { x, y (points), seg: [[a, b, tag]] (the boundary and any inner lines), holes: [[x, y]] (a point in
 *   each hole) }; o = { minAngle (°, default 25), size (x, y) → h or a number (the target edge), fixed (boundary points
 *   kept exactly as given: no point added on a segment -- for a patch whose edges its neighbours share), maxPoints }.
 *   Returns { x, y, tri (counter-clockwise, 3 each), seg ([a, b, tag] the boundary's pieces), onSeg (each point's segment
 *   tag, or null), stats }.
 * Points are inserted by Lawson's flips (split the triangle or edge holding the point, then flip until locally Delaunay,
 * never across a segment); segments recovered by Sloan's flips; the region by flood fill from outside and from each hole.
 */

const UT_EPS = Math.pow(2, -53), UT_CCW = (3 + 16 * UT_EPS) * UT_EPS, UT_ICC = (10 + 96 * UT_EPS) * UT_EPS;
const utExact = typeof umtExact === 'function' ? umtExact : require('./um-tet.js').umtExact;

function utOrient(ax, ay, bx, by, cx, cy) {
  const l = (bx - ax) * (cy - ay), r = (by - ay) * (cx - ax), det = l - r, perm = Math.abs(l) + Math.abs(r);
  if (det > UT_CCW * perm || -det > UT_CCW * perm) return det;
  const [Ax, Ay, Bx, By, Cx, Cy] = utExact([ax, ay, bx, by, cx, cy]), d = (Bx - Ax) * (Cy - Ay) - (By - Ay) * (Cx - Ax);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}
function utInCircle(ax, ay, bx, by, cx, cy, dx, dy) {
  const adx = ax - dx, bdx = bx - dx, cdx = cx - dx, ady = ay - dy, bdy = by - dy, cdy = cy - dy;
  const bdxcdy = bdx * cdy, cdxbdy = cdx * bdy, cdxady = cdx * ady, adxcdy = adx * cdy, adxbdy = adx * bdy, bdxady = bdx * ady;
  const al = adx * adx + ady * ady, bl = bdx * bdx + bdy * bdy, cl = cdx * cdx + cdy * cdy;
  const det = al * (bdxcdy - cdxbdy) + bl * (cdxady - adxcdy) + cl * (adxbdy - bdxady);
  const perm = (Math.abs(bdxcdy) + Math.abs(cdxbdy)) * al + (Math.abs(cdxady) + Math.abs(adxcdy)) * bl + (Math.abs(adxbdy) + Math.abs(bdxady)) * cl;
  if (det > UT_ICC * perm || -det > UT_ICC * perm) return det;
  const [Ax, Ay, Bx, By, Cx, Cy, Dx, Dy] = utExact([ax, ay, bx, by, cx, cy, dx, dy]);
  const a1 = Ax - Dx, b1 = Bx - Dx, c1 = Cx - Dx, a2 = Ay - Dy, b2 = By - Dy, c2 = Cy - Dy;
  const d = (a1 * a1 + a2 * a2) * (b1 * c2 - c1 * b2) + (b1 * b1 + b2 * b2) * (c1 * a2 - a1 * c2) + (c1 * c1 + c2 * c2) * (a1 * b2 - b1 * a2);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}

/** The mesh (see the header). */
function utMesh(G, o = {}) {
  const X = [], Y = [], T = [], N = [], C = [], R = [];   // points; per triangle: 3 vertices, 3 neighbours (−1 none), 3 segment tags (null), region (1 inside)
  const B = Math.max(1, 1 / (2 * Math.sin((o.minAngle ?? 25) * Math.PI / 180)));
  const hOf = typeof o.size === 'function' ? o.size : (() => o.size ?? Infinity);
  const onSeg = [], input = [];
  const P = v => [X[v], Y[v]];
  const orient = (a, b, c) => utOrient(X[a], Y[a], X[b], Y[b], X[c], Y[c]);
  // ---- the box around everything: two triangles, its corners far outside ----
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < G.x.length; i++) { x0 = Math.min(x0, G.x[i]); x1 = Math.max(x1, G.x[i]); y0 = Math.min(y0, G.y[i]); y1 = Math.max(y1, G.y[i]); }
  const L = Math.max(x1 - x0, y1 - y0) || 1, bx = [x0 - 3 * L, x1 + 3 * L, x1 + 3 * L, x0 - 3 * L], by = [y0 - 3 * L, y0 - 3 * L, y1 + 3 * L, y1 + 3 * L];
  for (let k = 0; k < 4; k++) { X.push(bx[k]); Y.push(by[k]); onSeg.push(null); input.push(false); }
  const addTri = (a, b, c) => { const t = T.length / 3; T.push(a, b, c); N.push(-1, -1, -1); C.push(null, null, null); R.push(0); return t; };
  { const t0 = addTri(0, 1, 2), t1 = addTri(0, 2, 3); N[3 * t0 + 1] = t1; N[3 * t1 + 2] = t0; }   // (edge 0–2: opposite vertex 1 of t0 and vertex 3 (index 2) of t1)
  const edgeIdx = (t, a, b) => { for (let k = 0; k < 3; k++) { const u = T[3 * t + (k + 1) % 3], v = T[3 * t + (k + 2) % 3]; if ((u === a && v === b) || (u === b && v === a)) return k; } return -1; };
  const link = (t, k, s, j) => { N[3 * t + k] = s; if (s >= 0) N[3 * s + j] = t; };
  let last = 0, walkSeed = 7;
  /** The triangle holding (px, py), walking from last; returns [t, where]: where −1 inside, k on edge k, 'v' + vertex if a vertex. */
  const locate = (px, py) => {
    let t = last, guard = 0;
    for (;;) {
      if (++guard > 4 * T.length + 100) throw new Error('um-tri: the walk did not end');
      // (the edge tried first chosen at random: a walk that always tries them in one order can circle for ever)
      let moved = false; walkSeed = (Math.imul(walkSeed, 1664525) + 1013904223) >>> 0; const r = walkSeed % 3;
      for (let q = 0; q < 3; q++) {
        const k = (q + r) % 3, a = T[3 * t + (k + 1) % 3], b = T[3 * t + (k + 2) % 3];
        if (utOrient(X[a], Y[a], X[b], Y[b], px, py) < 0) { const s = N[3 * t + k]; if (s < 0) return [-1, -1]; t = s; moved = true; break; }   // (off the box: outside everything)
      }
      if (!moved) break;
    }
    last = t;
    for (let k = 0; k < 3; k++) { const v = T[3 * t + k]; if (X[v] === px && Y[v] === py) return [t, 'v', v]; }
    for (let k = 0; k < 3; k++) { const a = T[3 * t + (k + 1) % 3], b = T[3 * t + (k + 2) % 3]; if (utOrient(X[a], Y[a], X[b], Y[b], px, py) === 0) return [t, k]; }
    return [t, -1];
  };
  /** Flip the edge opposite vertex k of t (with its neighbour); returns the two triangles. */
  const flip = (t, k) => {
    const s = N[3 * t + k], j = N.slice(3 * s, 3 * s + 3).indexOf(t);
    const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3], c = T[3 * t + (k + 2) % 3], d = T[3 * s + j];
    // t = (a, b, c), s holds c, b and d opposite: after the flip t = (a, b, d), s = (a, d, c)
    const nbA = N[3 * t + (k + 1) % 3], cA = C[3 * t + (k + 1) % 3];   // (t's edge c–a)
    const nbB = N[3 * t + (k + 2) % 3], cB = C[3 * t + (k + 2) % 3];   // (t's edge a–b)
    const jb = s === -1 ? -1 : [0, 1, 2].find(i => T[3 * s + i] === b), jc = [0, 1, 2].find(i => T[3 * s + i] === c);
    const nbS_bd = N[3 * s + jc], cS_bd = C[3 * s + jc];   // (s's edge b–d: opposite c)
    const nbS_dc = N[3 * s + jb], cS_dc = C[3 * s + jb];   // (s's edge d–c: opposite b)
    const reg = R[t];
    T[3 * t] = a; T[3 * t + 1] = b; T[3 * t + 2] = d; T[3 * s] = a; T[3 * s + 1] = d; T[3 * s + 2] = c;
    const set = (u, i, nb, cc) => { N[3 * u + i] = nb; C[3 * u + i] = cc; if (nb >= 0) { const q = [0, 1, 2].find(z => { const p1 = T[3 * nb + (z + 1) % 3], p2 = T[3 * nb + (z + 2) % 3], e1 = T[3 * u + (i + 1) % 3], e2 = T[3 * u + (i + 2) % 3]; return (p1 === e1 && p2 === e2) || (p1 === e2 && p2 === e1); }); N[3 * nb + q] = u; } };
    // t = (a, b, d): edge opposite a is b–d, opposite b is d–a (shared with s), opposite d is a–b
    set(t, 0, nbS_bd, cS_bd); N[3 * t + 1] = s; C[3 * t + 1] = null; set(t, 2, nbB, cB);
    // s = (a, d, c): opposite a is d–c, opposite d is c–a, opposite c is a–d (shared with t)
    set(s, 0, nbS_dc, cS_dc); set(s, 1, nbA, cA); N[3 * s + 2] = t; C[3 * s + 2] = null;
    R[s] = reg;
    return [t, s];
  };
  /** Flip until every edge round the new point p is locally Delaunay (segments never flipped). */
  const legalize = stack => {
    while (stack.length) {
      const [t, p] = stack.pop(), k = [0, 1, 2].find(i => T[3 * t + i] === p);
      if (k === undefined) continue;
      const s = N[3 * t + k]; if (s < 0 || C[3 * t + k] !== null) continue;
      const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3], c = T[3 * t + (k + 2) % 3], j = [0, 1, 2].find(i => N[3 * s + i] === t), d = T[3 * s + j];
      if (utInCircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], X[d], Y[d]) > 0) { const [u, v] = flip(t, k); stack.push([u, p], [v, p]); }
    }
  };
  /** Insert a point; returns its index (an existing one if it is there already). */
  const insert = (px, py, tag = null, isInput = false) => {
    const [t, where, v] = locate(px, py);
    if (where === 'v') return v;
    const p = X.length; X.push(px); Y.push(py); onSeg.push(tag); input.push(isInput);
    if (where === -1) {
      const [a, b, c] = T.slice(3 * t, 3 * t + 3), na = N[3 * t], nb = N[3 * t + 1], nc = N[3 * t + 2], ca = C[3 * t], cb = C[3 * t + 1], cc = C[3 * t + 2], reg = R[t];
      // t → (p, b, c), t1 = (a, p, c), t2 = (a, b, p)
      T[3 * t] = p; const t1 = addTri(a, p, c), t2 = addTri(a, b, p); R[t1] = R[t2] = reg;
      N[3 * t] = na; C[3 * t] = ca; N[3 * t + 1] = t1; C[3 * t + 1] = null; N[3 * t + 2] = t2; C[3 * t + 2] = null;
      N[3 * t1] = t; N[3 * t1 + 1] = nb; C[3 * t1 + 1] = cb; N[3 * t1 + 2] = t2;
      N[3 * t2] = t; N[3 * t2 + 1] = t1; N[3 * t2 + 2] = nc; C[3 * t2 + 2] = cc;
      if (nb >= 0) N[3 * nb + N.slice(3 * nb, 3 * nb + 3).indexOf(t)] = t1;
      if (nc >= 0) N[3 * nc + N.slice(3 * nc, 3 * nc + 3).indexOf(t)] = t2;
      legalize([[t, p], [t1, p], [t2, p]]);
      last = t; return p;
    }
    return splitEdge(t, where, p);
  };
  /** Point p (already in X, Y) put on edge k of t: both triangles sharing it split (a segment keeps its tag in both halves).
   *  A segment's split point lands here by its edge, not by where rounding puts it (a hair off the line). */
  const splitEdge = (t, k, p) => {
    const s = N[3 * t + k], segTag = C[3 * t + k];
    const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3], c = T[3 * t + (k + 2) % 3];
    const nTb = N[3 * t + (k + 1) % 3], cTb = C[3 * t + (k + 1) % 3], nTc = N[3 * t + (k + 2) % 3], cTc = C[3 * t + (k + 2) % 3], regT = R[t];
    // t = (a, b, c), edge b–c split at p: t → (a, b, p), t1 = (a, p, c)
    T[3 * t] = a; T[3 * t + 1] = b; T[3 * t + 2] = p;
    const t1 = addTri(a, p, c); R[t1] = regT;
    N[3 * t] = -1; C[3 * t] = segTag; N[3 * t + 1] = t1; C[3 * t + 1] = null; N[3 * t + 2] = nTc; C[3 * t + 2] = cTc;
    N[3 * t1] = -1; C[3 * t1] = segTag; N[3 * t1 + 1] = nTb; C[3 * t1 + 1] = cTb; N[3 * t1 + 2] = t;
    if (nTb >= 0) N[3 * nTb + N.slice(3 * nTb, 3 * nTb + 3).indexOf(t)] = t1;
    const stack = [[t, p], [t1, p]];
    if (s >= 0) {
      const j = N.slice(3 * s, 3 * s + 3).indexOf(t), d = T[3 * s + j], regS = R[s];
      // s = (d, c, b) in some rotation: its vertex d opposite the edge; split into (d, c, p) and (d, p, b)
      const ic = [0, 1, 2].find(i => T[3 * s + i] === c), ib = [0, 1, 2].find(i => T[3 * s + i] === b);
      const nSb = N[3 * s + ic], cSb = C[3 * s + ic];   // (edge d–b, opposite c)
      const nSc = N[3 * s + ib], cSc = C[3 * s + ib];   // (edge d–c, opposite b)
      T[3 * s] = d; T[3 * s + 1] = c; T[3 * s + 2] = p;
      const s1 = addTri(d, p, b); R[s1] = regS;
      // s = (d, c, p): opposite d is c–p (with t1), opposite c is p–d (with s1), opposite p is d–c
      N[3 * s] = t1; C[3 * s] = segTag; N[3 * s + 1] = s1; C[3 * s + 1] = null; N[3 * s + 2] = nSc; C[3 * s + 2] = cSc;
      // s1 = (d, p, b): opposite d is p–b (with t), opposite p is b–d, opposite b is d–p (with s)
      N[3 * s1] = t; C[3 * s1] = segTag; N[3 * s1 + 1] = nSb; C[3 * s1 + 1] = cSb; N[3 * s1 + 2] = s;
      if (nSb >= 0) N[3 * nSb + N.slice(3 * nSb, 3 * nSb + 3).indexOf(s)] = s1;
      N[3 * t] = s1; N[3 * t1] = s;
      stack.push([s, p], [s1, p]);
    }
    legalize(stack); last = t; return p;
  };
  const insertOnEdge = (t, k, px, py, tag) => { const p = X.length; X.push(px); Y.push(py); onSeg.push(tag); input.push(false); return splitEdge(t, k, p); };
  // ---- the input points, then the segments ----
  const id = G.x.map((_, i) => insert(G.x[i], G.y[i], null, true));
  const segs = (G.seg || []).map(([a, b, tag]) => [id[a], id[b], tag ?? 'seg']);
  /** The edge a–b as a piece of segment sid: present already, or recovered by flipping every edge crossing it (Sloan). */
  const recover = (a, b, tag) => {
    for (let guard = 0; guard < 100000; guard++) {
      // is a–b an edge? (the triangles round a)
      const around = []; for (let t = 0; t < T.length / 3; t++) if (T[3 * t] === a || T[3 * t + 1] === a || T[3 * t + 2] === a) around.push(t);
      for (const t of around) { const k = edgeIdx(t, a, b); if (k >= 0) { C[3 * t + k] = tag; const s = N[3 * t + k]; if (s >= 0) C[3 * s + edgeIdx(s, a, b)] = tag; return; } }
      // a point exactly on a–b: the segment through it, in two
      for (let v = 4; v < X.length; v++) if (v !== a && v !== b && orient(a, b, v) === 0) {
        const dot = (X[v] - X[a]) * (X[b] - X[a]) + (Y[v] - Y[a]) * (Y[b] - Y[a]), len = (X[b] - X[a]) ** 2 + (Y[b] - Y[a]) ** 2;
        if (dot > 0 && dot < len) { recover(a, v, tag); recover(v, b, tag); return; }
      }
      // the edges crossing a–b: flip each whose quadrilateral is convex
      let flipped = false;
      for (let t = 0; t < T.length / 3 && !flipped; t++) for (let k = 0; k < 3; k++) {
        const u = T[3 * t + (k + 1) % 3], w = T[3 * t + (k + 2) % 3], s = N[3 * t + k];
        if (s < 0 || u === a || u === b || w === a || w === b) continue;
        if (Math.sign(orient(a, b, u)) * Math.sign(orient(a, b, w)) >= 0 || Math.sign(orient(u, w, a)) * Math.sign(orient(u, w, b)) >= 0) continue;
        if (C[3 * t + k] !== null) throw new Error('um-tri: two segments cross');
        const p0 = T[3 * t + k], j = N.slice(3 * s, 3 * s + 3).indexOf(t), d = T[3 * s + j];
        if (orient(p0, d, u) * orient(p0, d, w) < 0) { flip(t, k); flipped = true; break; }   // (convex: the other diagonal crosses this one)
      }
      if (!flipped) throw new Error('um-tri: a segment could not be recovered');
    }
  };
  segs.forEach(([a, b], i) => recover(a, b, i));   // (each edge holds its segment's index; the tags at the end)
  // the sharp corners: two segments meeting at an input point at less than 60°. A triangle with an edge across such a corner,
  // its ends about as far from it, cannot be made better by splitting (its angle is the corner's): left alone (Shewchuk), so
  // the refinement does not run into the corner for ever
  const wedge = new Map();   // ('s1,s2' → the corner's point)
  id.forEach(v => {
    const inc = []; segs.forEach(([a, b], i) => { if (a === v || b === v) { const w = a === v ? b : a; inc.push([Math.atan2(Y[w] - Y[v], X[w] - X[v]), i]); } });
    inc.sort((p1, p2) => p1[0] - p2[0]);
    for (let i = 0; i < inc.length && inc.length > 1; i++) { const j = (i + 1) % inc.length; let d = inc[j][0] - inc[i][0]; if (d <= 0) d += 2 * Math.PI;
      if (d < Math.PI / 3) wedge.set(Math.min(inc[i][1], inc[j][1]) + ',' + Math.max(inc[i][1], inc[j][1]), v); }
  });
  const segsOf = v => (onSeg[v] !== null ? [onSeg[v]] : input[v] ? segs.map((q, i) => (q[0] === v || q[1] === v ? i : -1)).filter(i => i >= 0) : []);
  const acrossCorner = (u, w) => {
    if (!wedge.size) return false;
    for (const s1 of segsOf(u)) for (const s2 of segsOf(w)) {
      if (s1 === s2) continue; const c = wedge.get(Math.min(s1, s2) + ',' + Math.max(s1, s2)); if (c === undefined) continue;
      const ru = Math.hypot(X[u] - X[c], Y[u] - Y[c]), rw = Math.hypot(X[w] - X[c], Y[w] - Y[c]);
      if (ru > 0 && rw > 0 && Math.max(ru, rw) <= 2.01 * Math.min(ru, rw)) return true;
    }
    return false;
  };
  // the Delaunay property again away from the segments (the flips above may have left edges that are not)
  const relegal = () => { let any = true; while (any) { any = false; for (let t = 0; t < T.length / 3; t++) for (let k = 0; k < 3; k++) {
    const s = N[3 * t + k]; if (s < 0 || C[3 * t + k] !== null) continue;
    const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3], c = T[3 * t + (k + 2) % 3], j = N.slice(3 * s, 3 * s + 3).indexOf(t), d = T[3 * s + j];
    if (utInCircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], X[d], Y[d]) > 0) { flip(t, k); any = true; } } } };
  relegal();
  // ---- the region: flood from the box's corners and from each hole, never across a segment ----
  const flood = (t0, val) => { const st = [t0]; R[t0] = val; while (st.length) { const t = st.pop(); for (let k = 0; k < 3; k++) { const s = N[3 * t + k]; if (s >= 0 && C[3 * t + k] === null && R[s] !== val) { R[s] = val; st.push(s); } } } };
  for (let t = 0; t < T.length / 3; t++) R[t] = 1;
  for (let t = 0; t < T.length / 3; t++) if (T[3 * t] < 4 || T[3 * t + 1] < 4 || T[3 * t + 2] < 4) if (R[t] === 1) flood(t, 0);
  for (const [hx, hy] of G.holes || []) { const [t] = locate(hx, hy); if (R[t] === 1) flood(t, 0); }
  // ---- Ruppert's refinement ----
  const maxPts = o.maxPoints ?? 200000;
  const circ = t => { const [a, b, c] = T.slice(3 * t, 3 * t + 3), ax = X[a], ay = Y[a], bx2 = X[b] - ax, by2 = Y[b] - ay, cx2 = X[c] - ax, cy2 = Y[c] - ay, d = 2 * (bx2 * cy2 - by2 * cx2);
    const ux = (cy2 * (bx2 * bx2 + by2 * by2) - by2 * (cx2 * cx2 + cy2 * cy2)) / d, uy = (bx2 * (cx2 * cx2 + cy2 * cy2) - cx2 * (bx2 * bx2 + by2 * by2)) / d; return [ax + ux, ay + uy, Math.hypot(ux, uy)]; };
  const shortest = t => { let m = Infinity; for (let k = 0; k < 3; k++) { const a = T[3 * t + k], b = T[3 * t + (k + 1) % 3]; m = Math.min(m, Math.hypot(X[a] - X[b], Y[a] - Y[b])); } return m; };
  const encroached = (t, k, px, py) => { const a = T[3 * t + (k + 1) % 3], b = T[3 * t + (k + 2) % 3]; return (X[a] - px) * (X[b] - px) + (Y[a] - py) * (Y[b] - py) < 0; };
  /** Split segment piece a–b (in t, opposite k): at its middle, or (near a sharp input corner) on a circle about it. */
  const splitSeg = (t, k) => {
    const a = T[3 * t + (k + 1) % 3], b = T[3 * t + (k + 2) % 3], tag = C[3 * t + k]; let f = 0.5;
    if (acrossCorner(a, T[3 * t + k]) && acrossCorner(b, T[3 * t + k]) && Math.hypot(X[b] - X[a], Y[b] - Y[a]) < 0.5 * hOf(X[a], Y[a])) return false;
    const shell = (v, w) => { const L0 = Math.hypot(X[w] - X[v], Y[w] - Y[v]), r = Math.pow(2, Math.round(Math.log2(L0 / 2))); return r / L0; };
    if (input[a] && !input[b]) f = shell(a, b); else if (input[b] && !input[a]) f = 1 - shell(b, a);
    insertOnEdge(t, k, X[a] + f * (X[b] - X[a]), Y[a] + f * (Y[b] - Y[a]), tag);
    return true;
  };
  let inserted = 0, skipped = 0;
  for (let pass = 0; pass < 60 && X.length < maxPts; pass++) {
    let changed = false;
    // encroached segment pieces first (unless the boundary is fixed)
    if (!o.fixed) for (let t = 0; t < T.length / 3; t++) for (let k = 0; k < 3; k++) {
      if (C[3 * t + k] === null || R[t] !== 1) continue;
      const v = T[3 * t + k], a = T[3 * t + (k + 1) % 3], b = T[3 * t + (k + 2) % 3];
      const L0 = Math.hypot(X[b] - X[a], Y[b] - Y[a]), h = hOf((X[a] + X[b]) / 2, (Y[a] + Y[b]) / 2);
      if ((encroached(t, k, X[v], Y[v]) || L0 > 1.5 * h) && splitSeg(t, k)) { changed = true; inserted++; }
    }
    // bad triangles: too skinny or too big; the circumcentre unless it encroaches a segment piece (then that is split)
    const nT = T.length / 3;
    for (let t = 0; t < nT && X.length < maxPts; t++) {
      if (R[t] !== 1) continue;
      const [cx, cy, r] = circ(t), sh = shortest(t), h = hOf(cx, cy);
      if (!(r / sh > B || r > 0.65 * h)) continue;
      if (r <= 0.65 * h && [0, 1, 2].some(k => acrossCorner(T[3 * t + (k + 1) % 3], T[3 * t + (k + 2) % 3]))) { skipped++; continue; }
      // the segment pieces near the centre: those of the triangles whose circles hold it, reached without crossing one
      let enc = null;
      const seen = new Set([t]), st = [t];
      while (st.length && !enc) { const u = st.pop(); for (let k = 0; k < 3; k++) {
        const s = N[3 * u + k];
        if (C[3 * u + k] !== null) { if (encroached(u, k, cx, cy)) { enc = [u, k]; break; } continue; }
        if (s >= 0 && !seen.has(s)) { const [a, b, c] = T.slice(3 * s, 3 * s + 3); if (utInCircle(X[a], Y[a], X[b], Y[b], X[c], Y[c], cx, cy) > 0) { seen.add(s); st.push(s); } }
      } }
      if (!enc) { const [tc] = locate(cx, cy); if (tc < 0 || R[tc] !== 1) { skipped++; continue; } }
      if (enc) { if (o.fixed || !splitSeg(enc[0], enc[1])) { skipped++; continue; } changed = true; inserted++; continue; }
      insert(cx, cy, null); changed = true; inserted++;
    }
    if (!changed) break;
  }
  // ---- the mesh: the inside triangles, renumbered; the boundary's pieces ----
  const keep = new Int32Array(X.length).fill(-1), xs = [], ys = [], tri = [], outSeg = [], os = [];
  const use = v => { if (keep[v] < 0) { keep[v] = xs.length; xs.push(X[v]); ys.push(Y[v]); os.push(onSeg[v] === null ? (input[v] ? (segsOf(v).length ? segs[segsOf(v)[0]][2] : null) : null) : segs[onSeg[v]][2]); } return keep[v]; };
  for (let t = 0; t < T.length / 3; t++) if (R[t] === 1) {
    tri.push(use(T[3 * t]), use(T[3 * t + 1]), use(T[3 * t + 2]));
    for (let k = 0; k < 3; k++) if (C[3 * t + k] !== null) { const a = T[3 * t + (k + 1) % 3], b = T[3 * t + (k + 2) % 3], s = N[3 * t + k]; if (s < 0 || R[s] !== 1 || a < b) outSeg.push([use(a), use(b), segs[C[3 * t + k]][2]]); }
  }
  return { x: Float64Array.from(xs), y: Float64Array.from(ys), tri: Int32Array.from(tri), seg: outSeg, onSeg: os, stats: { inserted, skipped, B } };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { utOrient, utInCircle, utMesh };
