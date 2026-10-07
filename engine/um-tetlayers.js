/*
 * um-tetlayers.js — prism layers on walls under the tetrahedral mesh (MESH-T2f): thin cells along a wall, the first
 * `first` thick and each `growth` times the one before, n of them, as the app's other meshes lay them out ("Layers at the
 * web", "Layers at the blade and surface": count, first thickness, growth); the tetrahedra fill the rest.
 *
 * umlLayers(S, specs, o): S = umtSurface's output ({ X, Y, Z, tri (outward), tag }); specs = [{ tags: [...] (the walls),
 *   n, first (m), growth }]. Each wall point gets a direction into the solid: its normal, the angle-weighted mean of its
 *   wall triangles'; where the wall meets another face, that normal laid into the plane of each of that face's triangles at
 *   the point (into the line where two such planes meet; three are refused), so the layers' sides lie on the face. Its
 *   k-th layer's top lies along
 *   that direction at the layers' height so far measured along the normal (h_j = first·growth^j, j < k). Returns
 *   { S2 (the surface left for the tetrahedra: each wall replaced by its layers' top; each flat region of a face next to
 *   it meshed again (um-tri.js, o.size) inside its boundary drawn back to the tops, its boundary's points kept; tags of
 *   the tops 'layers:' + the wall's tag), map (S2's points → this object's), X, Y, Z (S's points, then the
 *   layers' points), stack (for each of S's wall points, its points from the wall to the top: n + 1), n (per point),
 *   thickness (per spec), volume (the solid's, from S's triangles) }. Errors said plainly: a wall point on three other
 *   planes, the layers too thick for the triangles next to them, a direction too slanted to the wall, two specs at a point,
 *   layers that would end in the open at a convex edge (a pipe's bore meeting its end: layer the end too).
 * umlAssemble(L, V): the layers and the tetrahedra umtVolume made of L.S2 as one mesh. Where the tetrahedra's mesher split
 *   an edge of a layers' top (its middle), the layers under it are split the same (the middle of each layer's edge), so
 *   every face is shared whole. Returns { X, Y, Z, tet (4 each), wedge (6 each: the wall's triangle, then the next layer's,
 *   VTK's order), wedgeTag (each wedge's wall), bface (faces, triangles and quadrilaterals, outward), btag, stats }.
 * umlMesh(S, specs, o): umlLayers, umtVolume (o: its options), umlAssemble.
 * Pure computation.
 */
const UML_T = typeof umtVolume === 'function' ? { umtVolume, umtInsidePoint } : require('./um-tetmesh.js');
const UML_2 = typeof utMesh === 'function' ? { utMesh } : require('./um-tri.js');

/** The layers' points and the surface left for the tetrahedra (see the header). */
function umlLayers(S, specs, o = {}) {
  const nP = S.X.length, nT = S.tri.length / 3, tri = S.tri;
  const specOf = new Map();
  specs.forEach((s, i) => { for (const t of s.tags) { if (specOf.has(t)) throw new Error(`um-tetlayers: the wall '${t}' is in two layer groups`); specOf.set(t, i); }
    if (!(s.n >= 1 && s.first > 0 && s.growth > 0)) throw new Error('um-tetlayers: a layer group needs n ≥ 1, first > 0 and growth > 0'); });
  const tSpec = Int32Array.from({ length: nT }, (_, t) => (specOf.has(S.tag[t]) ? specOf.get(S.tag[t]) : -1));
  const P = i => [S.X[i], S.Y[i], S.Z[i]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = a => { const l = Math.hypot(...a); return a.map(c => c / l); };
  // each triangle's outward unit normal; the triangles at each point
  const nrm = [], at = Array.from({ length: nP }, () => []);
  for (let t = 0; t < nT; t++) { const a = P(tri[3 * t]), b = P(tri[3 * t + 1]), c = P(tri[3 * t + 2]); nrm.push(unit(cross(sub(b, a), sub(c, a)))); for (let k = 0; k < 3; k++) at[tri[3 * t + k]].push(t); }
  // the solid's volume (the divergence theorem over S)
  let volume = 0; for (let t = 0; t < nT; t++) { const a = P(tri[3 * t]), b = P(tri[3 * t + 1]), c = P(tri[3 * t + 2]); volume += dot(a, cross(b, c)) / 6; }
  // each point's group (−1 none)
  const pSpec = new Int32Array(nP).fill(-1);
  for (let t = 0; t < nT; t++) if (tSpec[t] >= 0) for (let k = 0; k < 3; k++) { const v = tri[3 * t + k];
    if (pSpec[v] >= 0 && pSpec[v] !== tSpec[t]) throw new Error(`um-tetlayers: two layer groups meet at (${P(v).map(x => (x * 1e3).toFixed(3)).join(', ')}) mm`);
    pSpec[v] = tSpec[t]; }
  // the heights: H_k = Σ_{j<k} first·growth^j
  const H = specs.map(s => { const h = [0]; for (let j = 0; j < s.n; j++) h.push(h[j] + s.first * Math.pow(s.growth, j)); return h; });
  const minCos = o.minCos ?? 0.25;
  // each wall point's direction, and its layers' points
  const X = Array.from(S.X), Y = Array.from(S.Y), Z = Array.from(S.Z), stack = new Array(nP), nOf = new Int32Array(nP);
  for (let v = 0; v < nP; v++) if (pSpec[v] >= 0) {
    const p = P(v); let nw = [0, 0, 0];
    const planes = [], others = [];
    for (const t of at[v]) {
      if (tSpec[t] >= 0) { // (the angle at v)
        const k = [0, 1, 2].find(i => tri[3 * t + i] === v), a = P(tri[3 * t + (k + 1) % 3]), b = P(tri[3 * t + (k + 2) % 3]), ang = Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(a, p)), unit(sub(b, p))))));
        nw = [nw[0] - ang * nrm[t][0], nw[1] - ang * nrm[t][1], nw[2] - ang * nrm[t][2]];
      } else { const n = nrm[t]; others.push(t); if (!planes.some(q => Math.abs(dot(q, n)) > 1 - 1e-9)) planes.push(n); }   // (each other face's plane at v: the layers' sides on it)
    }
    nw = unit(nw);
    let d;
    if (planes.length === 0) d = nw;
    else if (planes.length === 1) { const q = planes[0], s = dot(nw, q); d = unit([nw[0] - s * q[0], nw[1] - s * q[1], nw[2] - s * q[2]]); }
    else if (planes.length === 2) { d = unit(cross(planes[0], planes[1])); if (dot(d, nw) < 0) d = d.map(c => -c); }
    else throw new Error(`um-tetlayers: a wall point on three other planes at (${p.map(x => (x * 1e3).toFixed(3)).join(', ')}) mm`);
    // (the layers' sides must lie on that face: the direction pointing into its triangles at v. At a convex edge -- the
    //  face turning away from the solid, as a pipe's end from its bore -- they would lie beyond it, inside the solid,
    //  and the face's tag would wall off the paste there: refused)
    for (const q of planes) {
      let m = [0, 0, 0]; for (const t of others) { if (Math.abs(dot(nrm[t], q)) < 1 - 1e-9) continue;
        const a = P(tri[3 * t]), b = P(tri[3 * t + 1]), c = P(tri[3 * t + 2]);
        for (let k = 0; k < 3; k++) m[k] += (a[k] + b[k] + c[k]) / 3 - p[k]; }
      const s = dot(m, q); m = [m[0] - s * q[0], m[1] - s * q[1], m[2] - s * q[2]];
      if (dot(d, m) < 0) { const tw = S.tag[at[v].find(t => tSpec[t] >= 0)], to = S.tag[others.find(t => Math.abs(dot(nrm[t], q)) > 1 - 1e-9)];
        throw new Error(`um-tetlayers: the layers on '${tw}' would end in the open where it meets '${to}' at a convex edge, at (${p.map(x => (x * 1e3).toFixed(3)).join(', ')}) mm: put layers on '${to}' too`); }
    }
    const cs = dot(d, nw);
    if (!(cs >= minCos)) throw new Error(`um-tetlayers: the layers would leave the wall at ${(Math.acos(Math.max(-1, Math.min(1, cs))) * 180 / Math.PI).toFixed(0)}° from its normal at (${p.map(x => (x * 1e3).toFixed(3)).join(', ')}) mm (a face meeting it too steeply)`);
    const sp = pSpec[v], n = specs[sp].n, st = [v];
    for (let k = 1; k <= n; k++) { const s = H[sp][k] / cs; st.push(X.length); X.push(p[0] + s * d[0]); Y.push(p[1] + s * d[1]); Z.push(p[2] + s * d[2]); }
    stack[v] = st; nOf[v] = n;
  }
  const top = v => (pSpec[v] >= 0 ? stack[v][nOf[v]] : v);
  const Pall = i => [X[i], Y[i], Z[i]];
  // the surface left: walls → their tops (each kept turned the same way, not much smaller)
  const S2tri = [], S2tag = [];
  for (let t = 0; t < nT; t++) if (tSpec[t] >= 0) {
    const w = [0, 1, 2].map(k => top(tri[3 * t + k])), a = Pall(w[0]), b = Pall(w[1]), c = Pall(w[2]), n2 = cross(sub(b, a), sub(c, a));
    const A0 = Math.hypot(...cross(sub(P(tri[3 * t + 1]), P(tri[3 * t])), sub(P(tri[3 * t + 2]), P(tri[3 * t])))), A2 = Math.hypot(...n2);
    if (!(dot(n2, nrm[t]) > 0 && A2 > 0.2 * A0)) { const m = [0, 1, 2].map(d => (a[d] + b[d] + c[d]) / 3);
      throw new Error(`um-tetlayers: the layers (${specs.map((s2, i) => (H[i][s2.n] * 1e3).toFixed(3)).join(', ')} mm thick) fold over the wall triangle at (${m.map(x => (x * 1e3).toFixed(3)).join(', ')}) mm: fewer or thinner layers there`); }
    S2tri.push(...w); S2tag.push('layers:' + S.tag[t]);
  }
  // the other faces: each flat region of one face that touches a wall meshed again inside its new boundary (its wall
  // points moved to the layers' tops, in its plane), its boundary's points kept exactly so its neighbours still share
  // them; the rest as they were
  const sizeOf = typeof o.size === 'function' ? o.size : () => o.size ?? Infinity;
  const topOf2 = new Set(); stack.forEach(st => { if (st) topOf2.add(st[st.length - 1]); });
  const thick = () => specs.map((s2, i) => (H[i][s2.n] * 1e3).toFixed(3)).join(', ');
  const par = Int32Array.from({ length: nT }, (_, i) => i), find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const ek = (a, b) => (a < b ? a * nP + b : b * nP + a), eTri = new Map();
  for (let t = 0; t < nT; t++) if (tSpec[t] < 0) for (let k = 0; k < 3; k++) { const key = ek(tri[3 * t + k], tri[3 * t + (k + 1) % 3]); (eTri.get(key) || eTri.set(key, []).get(key)).push(t); }
  for (const l of eTri.values()) if (l.length === 2 && S.tag[l[0]] === S.tag[l[1]] && dot(nrm[l[0]], nrm[l[1]]) > 1 - 1e-9) par[find(l[0])] = find(l[1]);
  const regions = new Map();
  for (let t = 0; t < nT; t++) if (tSpec[t] < 0) { const r = find(t); (regions.get(r) || regions.set(r, []).get(r)).push(t); }
  let remeshed = 0;
  for (const tris of regions.values()) {
    if (!tris.some(t => [0, 1, 2].some(k => pSpec[tri[3 * t + k]] >= 0))) { for (const t of tris) { S2tri.push(tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]); S2tag.push(S.tag[t]); } continue; }
    remeshed++;
    const tag = S.tag[tris[0]], n = nrm[tris[0]];
    // its boundary: the edges it has once, in loops
    const dir = new Set(); for (const t of tris) for (let k = 0; k < 3; k++) dir.add(tri[3 * t + k] * nP + tri[3 * t + (k + 1) % 3]);
    const next = new Map();
    for (const t of tris) for (let k = 0; k < 3; k++) { const a = tri[3 * t + k], b = tri[3 * t + (k + 1) % 3]; if (dir.has(b * nP + a)) continue;
      if (next.has(a)) throw new Error(`um-tetlayers: the face '${tag}' pinched at a point: not meshed again`); next.set(a, b); }
    const loops = [], seen = new Set();
    for (const a0 of next.keys()) { if (seen.has(a0)) continue; const L = []; let a = a0; while (!seen.has(a)) { seen.add(a); L.push(top(a)); a = next.get(a); } loops.push(L); }
    // its plane's directions (u, v, n turning right-handed: counter-clockwise in (u, v) is outward)
    const o3 = Pall(loops[0][0]); let u = sub(Pall(loops[0][1]), o3); u = unit(sub(u, n.map(c => c * dot(u, n)))); const v = cross(n, u);
    const to2 = i => { const d = sub(Pall(i), o3); return [dot(d, u), dot(d, v)]; };
    const pid = [], px = [], py = [], seg = [], holes = [], local = new Map();
    const lp = i => { if (!local.has(i)) { local.set(i, pid.length); pid.push(i); const [a, b] = to2(i); px.push(a); py.push(b); } return local.get(i); };
    const area = L => { let A = 0; for (let i = 0; i < L.length; i++) { const a = to2(L[i]), b = to2(L[(i + 1) % L.length]); A += a[0] * b[1] - b[0] * a[1]; } return A / 2; };
    for (const L of loops) { for (let i = 0; i < L.length; i++) seg.push([lp(L[i]), lp(L[(i + 1) % L.length]), tag]); if (area(L) < 0) holes.push(UML_T.umtInsidePoint(L.map(to2))); }
    // (room: from each point the layers moved to the nearest piece of the boundary not its own, at least a quarter of the
    //  size there -- a sliver left between two walls' layers would be filled with ever smaller elements)
    const minRoom = o.minRoom ?? 0.25, moved = new Set(); for (const L of loops) for (const q of L) if (topOf2.has(q)) moved.add(q);
    for (let i = 0; i < pid.length; i++) { if (!moved.has(pid[i])) continue;
      let dmin = Infinity;
      for (const [a, b] of seg) { if (a === i || b === i) continue; const ax = px[a], ay = py[a], bx = px[b], by = py[b], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        const t2 = l2 > 0 ? Math.max(0, Math.min(1, ((px[i] - ax) * dx + (py[i] - ay) * dy) / l2)) : 0; dmin = Math.min(dmin, Math.hypot(px[i] - ax - t2 * dx, py[i] - ay - t2 * dy)); }
      const h = sizeOf(X[pid[i]], Y[pid[i]], Z[pid[i]]);
      if (Number.isFinite(h) && dmin < minRoom * h) throw new Error(`um-tetlayers: the layers (${thick()} mm thick) leave ${(dmin * 1e3).toFixed(3)} mm on the face '${tag}' at (${[X[pid[i]], Y[pid[i]], Z[pid[i]]].map(x => (x * 1e3).toFixed(3)).join(', ')}) mm, less than a quarter of the element size there (${(h * 1e3).toFixed(3)} mm): fewer or thinner layers, or a smaller size there`);
    }
    let M2;
    try { M2 = UML_2.utMesh({ x: px, y: py, seg, holes }, { size: (a, b) => sizeOf(o3[0] + a * u[0] + b * v[0], o3[1] + a * u[1] + b * v[1], o3[2] + a * u[2] + b * v[2]), minAngle: o.minAngle ?? 28, fixed: true }); }
    catch (e) { throw new Error(`um-tetlayers: the face '${tag}' could not be meshed inside the layers (${specs.map((s2, i) => (H[i][s2.n] * 1e3).toFixed(3)).join(', ')} mm thick): too thick for it? (${e.message})`); }
    const back = new Map(); for (let i = 0; i < pid.length; i++) back.set(px[i] + ',' + py[i], pid[i]);
    const g = new Int32Array(M2.x.length);
    for (let i = 0; i < M2.x.length; i++) { const k = back.get(M2.x[i] + ',' + M2.y[i]);
      if (k !== undefined) g[i] = k; else { g[i] = X.length; X.push(o3[0] + M2.x[i] * u[0] + M2.y[i] * v[0]); Y.push(o3[1] + M2.x[i] * u[1] + M2.y[i] * v[1]); Z.push(o3[2] + M2.x[i] * u[2] + M2.y[i] * v[2]); } }
    for (let t = 0; t < M2.tri.length; t += 3) { S2tri.push(g[M2.tri[t]], g[M2.tri[t + 1]], g[M2.tri[t + 2]]); S2tag.push(tag); }
  }
  // (room left for the tetrahedra: the surface left closed, and it and the layers together the solid -- its volume and
  //  the layers' (over the wall's triangles) the solid's; layers thicker than a gap overlap and break this)
  { const dirE = new Set(); for (let i = 0; i < S2tri.length; i += 3) for (let k = 0; k < 3; k++) dirE.add(S2tri[i + k] + ',' + S2tri[i + (k + 1) % 3]);
    let open = 0; for (const e of dirE) { const [a, b] = e.split(','); if (!dirE.has(b + ',' + a)) open++; }
    if (open) throw new Error(`um-tetlayers: the layers (${thick()} mm thick) leave no room for the tetrahedra: they overlap -- too thick for a gap (the surface left is not closed)`); }
  const tv = (a, b, c) => dot(a, cross(b, c)) / 6, quadV = q => { const m = [0, 1, 2].map(d => (q[0][d] + q[1][d] + q[2][d] + q[3][d]) / 4); let v2 = 0; for (let i = 0; i < 4; i++) v2 += tv(m, q[i], q[(i + 1) % 4]); return v2; };
  let v2 = 0; for (let i = 0; i < S2tri.length; i += 3) v2 += tv(Pall(S2tri[i]), Pall(S2tri[i + 1]), Pall(S2tri[i + 2]));
  let vl = 0; for (let t = 0; t < nT; t++) if (tSpec[t] >= 0) { const st = [0, 1, 2].map(k => stack[tri[3 * t + k]]), n = st[0].length - 1;
    for (let k = 0; k < n; k++) { const [a, b, c] = st.map(x => Pall(x[k])), [d, e, f] = st.map(x => Pall(x[k + 1]));
      vl += tv(a, b, c) - tv(d, e, f) + quadV([a, d, e, b]) + quadV([b, e, f, c]) + quadV([c, f, d, a]); } }
  if (!(Math.abs((v2 + vl) / volume - 1) < 1e-9 && v2 > 0)) throw new Error(`um-tetlayers: the layers (${thick()} mm thick) leave no room for the tetrahedra: they overlap -- too thick for a gap (volumes off by ${((v2 + vl) / volume - 1).toExponential(1)})`);
  // S2's own points (only those its triangles use)
  const idx = new Int32Array(X.length).fill(-1), map = [], SX = [], SY = [], SZ = [];
  const T2 = S2tri.map(v => { if (idx[v] < 0) { idx[v] = map.length; map.push(v); SX.push(X[v]); SY.push(Y[v]); SZ.push(Z[v]); } return idx[v]; });
  return { S2: { X: Float64Array.from(SX), Y: Float64Array.from(SY), Z: Float64Array.from(SZ), tri: Int32Array.from(T2), tag: S2tag }, map: Int32Array.from(map),
    X, Y, Z, stack, n: nOf, thickness: specs.map((s, i) => H[i][s.n]), volume, nWallPoints: stack.filter(Boolean).length, remeshed };
}

/** The layers and the tetrahedra as one mesh (see the header). */
function umlAssemble(L, V) {
  const nV = V.X.length, X = Array.from(V.X), Y = Array.from(V.Y), Z = Array.from(V.Z);
  // each point on a layers' top: its stack, from the wall up (its last the point itself), made when first needed
  const topOf = new Map();   // (L's point at a top → its wall point)
  L.stack.forEach((st, v) => { if (st) topOf.set(st[st.length - 1], v); });
  const nS2 = L.S2.X.length, midOf = new Map(), stk = new Map();
  for (let i = 0; i < V.mid.length; i += 3) midOf.set(V.mid[i], [V.mid[i + 1], V.mid[i + 2]]);
  const stackOf = p => {
    if (stk.has(p)) return stk.get(p);
    let st = null;
    const s = p < V.src.length ? V.src[p] : -1, w = s >= 0 && s < nS2 ? topOf.get(L.map[s]) : undefined;
    if (w !== undefined) st = L.stack[w].map((q, k, arr) => { if (k === arr.length - 1) return p; X.push(L.X[q]); Y.push(L.Y[q]); Z.push(L.Z[q]); return X.length - 1; });
    else if (midOf.has(p)) {
      // (a point made at an edge's middle: its stack the middles of its two ends' -- the same sums, so its top is the point)
      const [a, b] = midOf.get(p).map(stackOf);
      if (a && b) { if (a.length !== b.length) throw new Error('um-tetlayers: an edge split between two layer groups');
        st = a.map((q, k) => { if (k === a.length - 1) return p; X.push((X[q] + X[b[k]]) / 2); Y.push((Y[q] + Y[b[k]]) / 2); Z.push((Z[q] + Z[b[k]]) / 2); return X.length - 1; }); }
    }
    stk.set(p, st); return st;
  };
  // the boundary: the tetrahedra's, less the layers' tops; the walls under the tops; the layers' sides where a top meets
  // another face
  const nB = V.bface.length / 3, isTop = f => V.btag[f].startsWith('layers:');
  const ekey = (a, b) => (a < b ? a * nV + b : b * nV + a), edgeF = new Map();
  for (let f = 0; f < nB; f++) for (let k = 0; k < 3; k++) { const key = ekey(V.bface[3 * f + k], V.bface[3 * f + (k + 1) % 3]); (edgeF.get(key) || edgeF.set(key, []).get(key)).push(f); }
  const wedge = [], wedgeTag = [], bface = [], btag = [];
  const orient = (a, b, c, d) => { const u = [X[b] - X[a], Y[b] - Y[a], Z[b] - Z[a]], v = [X[c] - X[a], Y[c] - Y[a], Z[c] - Z[a]], w = [X[d] - X[a], Y[d] - Y[a], Z[d] - Z[a]];
    return u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]); };
  let bad = 0, nLayers = 0;
  for (let f = 0; f < nB; f++) {
    const v = [V.bface[3 * f], V.bface[3 * f + 1], V.bface[3 * f + 2]];
    if (!isTop(f)) { bface.push(v); btag.push(V.btag[f]); continue; }
    const [A, B, C] = v.map(stackOf); if (!A || !B || !C) throw new Error('um-tetlayers: a layers\' top point without its layers');
    const n = A.length - 1; nLayers = Math.max(nLayers, n);
    for (let k = 0; k < n; k++) {
      const w = [A[k], B[k], C[k], A[k + 1], B[k + 1], C[k + 1]]; wedge.push(...w); wedgeTag.push(V.btag[f].slice(7));
      // (valid: the six corner tetrahedra positive -- the wall's triangle turned away from the layer above it)
      if (!(orient(w[0], w[2], w[1], w[3]) > 0 && orient(w[1], w[0], w[2], w[4]) > 0 && orient(w[2], w[1], w[0], w[5]) > 0 && orient(w[3], w[4], w[5], w[0]) > 0 && orient(w[4], w[5], w[3], w[1]) > 0 && orient(w[5], w[3], w[4], w[2]) > 0)) bad++;
    }
    bface.push([A[0], B[0], C[0]]); btag.push(V.btag[f].slice(7));
    // (its edges on another face: the layers' sides there, on that face, turned out)
    for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3], other = edgeF.get(ekey(a, b)).find(g => g !== f);
      if (other === undefined || isTop(other)) continue;
      const Sa = stackOf(a), Sb = stackOf(b);
      for (let j = 0; j < n; j++) { bface.push([Sa[j], Sa[j + 1], Sb[j + 1], Sb[j]]); btag.push(V.btag[other]); } }
  }
  if (bad) throw new Error(`um-tetlayers: ${bad} layer cells turned inside out (the layers too thick where the wall bends)`);
  // (the cells fill the solid exactly: their volumes, each by its faces from their middles -- a shared face the same from
  //  both sides -- sum to the solid's; layers that overlap, too thick for a gap, would not)
  const o3 = [0, 1, 2].map(d => { const A = d === 0 ? X : d === 1 ? Y : Z; let lo = Infinity, hi = -Infinity; for (const x of A) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return (lo + hi) / 2; });
  const Pp = i => [X[i] - o3[0], Y[i] - o3[1], Z[i] - o3[2]], tv6 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const faceVol = f => { if (f.length === 3) return tv6(Pp(f[0]), Pp(f[1]), Pp(f[2]));
    const q = f.map(Pp), m = [0, 1, 2].map(d => q.reduce((s2, p) => s2 + p[d], 0) / q.length); let v = 0; for (let i = 0; i < q.length; i++) v += tv6(m, q[i], q[(i + 1) % q.length]); return v; };
  let vol = 0; for (let i = 0; i < V.tet.length; i += 4) { const a = Pp(V.tet[i]), b = Pp(V.tet[i + 1]), c = Pp(V.tet[i + 2]), d = Pp(V.tet[i + 3]); vol += tv6([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]], [d[0] - a[0], d[1] - a[1], d[2] - a[2]]); }
  for (let i = 0; i < wedge.length; i += 6) { const w = wedge.slice(i, i + 6); vol += faceVol([w[0], w[1], w[2]]) + faceVol([w[3], w[5], w[4]]) + faceVol([w[0], w[3], w[4], w[1]]) + faceVol([w[1], w[4], w[5], w[2]]) + faceVol([w[2], w[5], w[3], w[0]]); }
  if (!(Math.abs(vol / 6 / L.volume - 1) < 1e-9)) throw new Error(`um-tetlayers: the cells do not fill the solid (their volume ${(vol / 6 / L.volume - 1).toExponential(1)} off): the layers overlap -- too thick for a gap`);
  return { X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z), tet: V.tet, wedge: Int32Array.from(wedge), wedgeTag, bface, btag,
    stats: { ...V.stats, wedges: wedge.length / 6, layers: nLayers, layerPoints: X.length - nV } };
}

/** Layers, tetrahedra, one mesh (see the header). */
function umlMesh(S, specs, o = {}) {
  const L = umlLayers(S, specs, o), V = UML_T.umtVolume(L.S2, o), M = umlAssemble(L, V);
  M.volume = L.volume; M.thickness = L.thickness;
  return M;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { umlLayers, umlAssemble, umlMesh };
