/*
 * um-tet.js — the app's own tetrahedral mesher (MESH-T2), written here so no GPL code (TetGen, gmsh) enters the app.
 * This part: the exact geometric predicates and the Delaunay tetrahedralization every later step builds on.
 *
 * Predicates (umtOrient, umtInSphere): a floating-point evaluation with Shewchuk's error bounds; when the bound cannot
 *   decide the sign, the same determinant again in exact integer arithmetic (BigInt, every double split into its integer
 *   mantissa and power of two), so every sign is the true one, whatever the input (coplanar, cospherical, duplicate).
 *   umtOrient(a, b, c, d) = det[b − a, c − a, d − a]: > 0 when d is on the side of (b − a) × (c − a).
 *   umtInSphere(a, b, c, d, e): > 0 when e is inside the sphere through a, b, c, d (a b c d positive).
 * Delaunay (umtDelaunay): Bowyer–Watson, the points in biased randomized order (BRIO) along a Morton curve, each located by
 *   a walk; the convex hull closed by ghost tetrahedra on a vertex at infinity (as CGAL), so the hull is exact and nothing
 *   depends on a box around the points; degenerate input (points on a grid, on a sphere, on the hull's planes) handled by
 *   growing the cavity over every face its new tetrahedra would be flat on.
 * Tetrahedra: 4 vertices each, positive (umtOrient > 0); neighbour k across the face opposite vertex k. Pure computation.
 */

const UMT_INF = -1;
// (each face k of a tetrahedron, its vertices ordered so their normal points away from vertex k)
const UMT_OUT = [[1, 2, 3], [0, 3, 2], [0, 1, 3], [0, 2, 1]];
const UMT_EPS = Math.pow(2, -53), UMT_O3D = (7 + 56 * UMT_EPS) * UMT_EPS, UMT_ISP = (16 + 224 * UMT_EPS) * UMT_EPS, UMT_C2D = (3 + 16 * UMT_EPS) * UMT_EPS;

// ---- exact arithmetic: a double as mantissa × 2^exponent ----
const umtF64 = new Float64Array(1), umtU32 = new Uint32Array(umtF64.buffer);
/** [sign·mantissa (BigInt), exponent] with x = m · 2^e exactly. */
function umtSplit(x) {
  if (x === 0) return [0n, 0];
  umtF64[0] = x; const lo = umtU32[0], hi = umtU32[1], ex = (hi >>> 20) & 0x7ff;
  let m = (BigInt((hi & 0xfffff) | (ex ? 0x100000 : 0)) << 32n) | BigInt(lo), e = (ex || 1) - 1075;
  if (hi >>> 31) m = -m;
  return [m, e];
}
/** The numbers given, as integers on one common scale (exact). */
function umtExact(vals) {
  const s = vals.map(umtSplit); let e0 = Infinity;
  for (const [m, e] of s) if (m !== 0n) e0 = Math.min(e0, e);
  return s.map(([m, e]) => (m === 0n ? 0n : m << BigInt(e - e0)));
}

// ---- the predicates ----
/** det[b − a, c − a, d − a]: positive when d is on the side of (b − a) × (c − a); exact in sign. */
function umtOrient(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  // (Shewchuk's orient3d about d, its sign flipped to this convention)
  const adx = ax - dx, bdx = bx - dx, cdx = cx - dx, ady = ay - dy, bdy = by - dy, cdy = cy - dy, adz = az - dz, bdz = bz - dz, cdz = cz - dz;
  const bdxcdy = bdx * cdy, cdxbdy = cdx * bdy, cdxady = cdx * ady, adxcdy = adx * cdy, adxbdy = adx * bdy, bdxady = bdx * ady;
  const det = adz * (bdxcdy - cdxbdy) + bdz * (cdxady - adxcdy) + cdz * (adxbdy - bdxady);
  const perm = (Math.abs(bdxcdy) + Math.abs(cdxbdy)) * Math.abs(adz) + (Math.abs(cdxady) + Math.abs(adxcdy)) * Math.abs(bdz) + (Math.abs(adxbdy) + Math.abs(bdxady)) * Math.abs(cdz);
  if (det > UMT_O3D * perm || -det > UMT_O3D * perm) return -det;
  // (four points with one coordinate the same lie on one plane: zero, exactly -- the flat faces' points, most of the doubtful)
  if ((adz === 0 && bdz === 0 && cdz === 0) || (ady === 0 && bdy === 0 && cdy === 0) || (adx === 0 && bdx === 0 && cdx === 0)) return 0;
  return -umtOrientExact(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
}
function umtOrientExact(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  const [Ax, Ay, Az, Bx, By, Bz, Cx, Cy, Cz, Dx, Dy, Dz] = umtExact([ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz]);
  const adx = Ax - Dx, bdx = Bx - Dx, cdx = Cx - Dx, ady = Ay - Dy, bdy = By - Dy, cdy = Cy - Dy, adz = Az - Dz, bdz = Bz - Dz, cdz = Cz - Dz;
  const d = adz * (bdx * cdy - cdx * bdy) + bdz * (cdx * ady - adx * cdy) + cdz * (adx * bdy - bdx * ady);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}
/** Positive when e is inside the sphere through a, b, c, d (a b c d positively oriented); exact in sign. */
function umtInSphere(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, ex, ey, ez) {
  const aex = ax - ex, bex = bx - ex, cex = cx - ex, dex = dx - ex, aey = ay - ey, bey = by - ey, cey = cy - ey, dey = dy - ey, aez = az - ez, bez = bz - ez, cez = cz - ez, dez = dz - ez;
  const aexbey = aex * bey, bexaey = bex * aey, bexcey = bex * cey, cexbey = cex * bey, cexdey = cex * dey, dexcey = dex * cey, dexaey = dex * aey, aexdey = aex * dey, aexcey = aex * cey, cexaey = cex * aey, bexdey = bex * dey, dexbey = dex * bey;
  const ab = aexbey - bexaey, bc = bexcey - cexbey, cd = cexdey - dexcey, da = dexaey - aexdey, ac = aexcey - cexaey, bd = bexdey - dexbey;
  const abc = aez * bc - bez * ac + cez * ab, bcd = bez * cd - cez * bd + dez * bc, cda = cez * da + dez * ac + aez * cd, dab = dez * ab + aez * bd + bez * da;
  const alift = aex * aex + aey * aey + aez * aez, blift = bex * bex + bey * bey + bez * bez, clift = cex * cex + cey * cey + cez * cez, dlift = dex * dex + dey * dey + dez * dez;
  const det = (dlift * abc - clift * dab) + (blift * cda - alift * bcd);
  const A = Math.abs, aezp = A(aez), bezp = A(bez), cezp = A(cez), dezp = A(dez);
  const perm = ((A(cexdey) + A(dexcey)) * bezp + (A(dexbey) + A(bexdey)) * cezp + (A(bexcey) + A(cexbey)) * dezp) * alift
    + ((A(dexaey) + A(aexdey)) * cezp + (A(aexcey) + A(cexaey)) * dezp + (A(cexdey) + A(dexcey)) * aezp) * blift
    + ((A(aexbey) + A(bexaey)) * dezp + (A(bexdey) + A(dexbey)) * aezp + (A(dexaey) + A(aexdey)) * bezp) * clift
    + ((A(bexcey) + A(cexbey)) * aezp + (A(cexaey) + A(aexcey)) * bezp + (A(aexbey) + A(bexaey)) * cezp) * dlift;
  // (Shewchuk's insphere is positive inside for his orientation, which is the opposite of this one)
  if (det > UMT_ISP * perm || -det > UMT_ISP * perm) return -det;
  return -umtInSphereExact(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, ex, ey, ez);
}
function umtInSphereExact(...v) {
  const [ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, ex, ey, ez] = umtExact(v);
  const aex = ax - ex, bex = bx - ex, cex = cx - ex, dex = dx - ex, aey = ay - ey, bey = by - ey, cey = cy - ey, dey = dy - ey, aez = az - ez, bez = bz - ez, cez = cz - ez, dez = dz - ez;
  const ab = aex * bey - bex * aey, bc = bex * cey - cex * bey, cd = cex * dey - dex * cey, da = dex * aey - aex * dey, ac = aex * cey - cex * aey, bd = bex * dey - dex * bey;
  const abc = aez * bc - bez * ac + cez * ab, bcd = bez * cd - cez * bd + dez * bc, cda = cez * da + dez * ac + aez * cd, dab = dez * ab + aez * bd + bez * da;
  const al = aex * aex + aey * aey + aez * aez, bl = bex * bex + bey * bey + bez * bez, cl = cex * cex + cey * cey + cez * cez, dl = dex * dex + dey * dey + dez * dez;
  const d = (dl * abc - cl * dab) + (bl * cda - al * bcd);
  return d > 0n ? 1 : d < 0n ? -1 : 0;
}
/** Whether three points lie on one line (exactly). */
function umtCollinear(ax, ay, az, bx, by, bz, cx, cy, cz) {
  // (a component of (b − a) × (c − a) surely not zero -- beyond its rounding (Shewchuk's 2D bound) -- says not; else exactly)
  { const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const n1 = uy * vz, n2 = uz * vy, n3 = uz * vx, n4 = ux * vz, n5 = ux * vy, n6 = uy * vx;
    if (Math.abs(n1 - n2) > UMT_C2D * (Math.abs(n1) + Math.abs(n2)) || Math.abs(n3 - n4) > UMT_C2D * (Math.abs(n3) + Math.abs(n4)) || Math.abs(n5 - n6) > UMT_C2D * (Math.abs(n5) + Math.abs(n6))) return false; }
  const [Ax, Ay, Az, Bx, By, Bz, Cx, Cy, Cz] = umtExact([ax, ay, az, bx, by, bz, cx, cy, cz]);
  const ux = Bx - Ax, uy = By - Ay, uz = Bz - Az, vx = Cx - Ax, vy = Cy - Ay, vz = Cz - Az;
  return uy * vz - uz * vy === 0n && uz * vx - ux * vz === 0n && ux * vy - uy * vx === 0n;
}

// ---- the order the points go in: biased randomized rounds, each along a Morton curve ----
function umtOrder(X, Y, Z, n, seed = 12345) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) { const p = [X[i], Y[i], Z[i]]; for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], p[d]); hi[d] = Math.max(hi[d], p[d]); } }
  const sp = (v, d) => Math.min(1023, Math.floor(1024 * (v - lo[d]) / ((hi[d] - lo[d]) || 1)));
  const part = v => { v = (v | (v << 16)) & 0x030000FF; v = (v | (v << 8)) & 0x0300F00F; v = (v | (v << 4)) & 0x030C30C3; v = (v | (v << 2)) & 0x09249249; return v; };
  const key = new Float64Array(n); for (let i = 0; i < n; i++) key[i] = part(sp(X[i], 0)) | (part(sp(Y[i], 1)) << 1) | (part(sp(Z[i], 2)) << 2);
  // (rounds: each point lands in round r with chance ½ for the last, ¼ the one before, …)
  let s = seed >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rounds = []; for (let i = 0; i < n; i++) { let r = 0; while (rnd() < 0.5 && r < 30) r++; (rounds[r] = rounds[r] || []).push(i); }
  const out = [];
  for (let r = rounds.length - 1; r >= 0; r--) if (rounds[r]) { const R = rounds[r].sort((a, b) => key[a] - key[b]); for (const i of R) out.push(i); }
  return out;
}

/**
 * The Delaunay tetrahedralization of points X, Y, Z (n). Returns { nT, tv (4 per tetrahedron), tn (4 neighbours: −1 the
 * hull's outside), hull (the hull's triangles, outward), dup (for each point a duplicate of, its first; else −1), nGhost } --
 * finite tetrahedra only, every one positive. opts.keep: the working structure as well (ghosts included), for the next steps.
 */
function umtDelaunay(X, Y, Z, opts = {}) { return umtTri(X, Y, Z, opts).finite(opts); }

/**
 * The Delaunay tetrahedralization as a working object, for meshing: built from points X, Y, Z (arrays the caller may grow),
 * then insert(p) adds point p (its coordinates pushed first) and returns the tetrahedra made (or −1: a duplicate);
 * locate(x, y, z), the arrays (tv, tn, alive, nT: ghosts carry UMT_INF), and finite() (as umtDelaunay returns).
 */
function umtTri(X, Y, Z, opts = {}) {
  const n = X.length;
  let cap = Math.max(64, 8 * n), tv = new Int32Array(4 * cap), tn = new Int32Array(4 * cap), alive = new Uint8Array(cap), nT = 0;
  const free = [];
  const grow = () => { const c2 = cap * 2, a = new Int32Array(4 * c2), b = new Int32Array(4 * c2), c = new Uint8Array(c2); a.set(tv); b.set(tn); c.set(alive); tv = a; tn = b; alive = c; cap = c2; };
  const newTet = () => { if (free.length) return free.pop(); if (nT >= cap) grow(); return nT++; };
  const P = (v, d) => (d === 0 ? X[v] : d === 1 ? Y[v] : Z[v]);
  // (a face of t (opposite k), outward from t, against point p: > 0 when p is beyond it; ghosts' finite faces face inward)
  const side = (t, k, p) => { const f = UMT_OUT[k], a = tv[4 * t + f[0]], b = tv[4 * t + f[1]], c = tv[4 * t + f[2]];
    return umtOrient(X[a], Y[a], Z[a], X[b], Y[b], Z[b], X[c], Y[c], Z[c], X[p], Y[p], Z[p]); };
  const infAt = t => { for (let k = 0; k < 4; k++) if (tv[4 * t + k] === UMT_INF) return k; return -1; };
  const inSph = (t, p) => { const a = tv[4 * t], b = tv[4 * t + 1], c = tv[4 * t + 2], d = tv[4 * t + 3];
    return umtInSphere(X[a], Y[a], Z[a], X[b], Y[b], Z[b], X[c], Y[c], Z[c], X[d], Y[d], Z[d], X[p], Y[p], Z[p]); };
  /** Whether p conflicts with t: inside its sphere; a ghost: beyond its hull face, or on its plane inside its circle. */
  const conflict = (t, p) => {
    const j = infAt(t); if (j < 0) return inSph(t, p) > 0;
    const s = side(t, j, p); if (s < 0) return true; if (s > 0) return false;
    return inSph(tn[4 * t + j], p) > 0;
  };
  const order = umtOrder(X, Y, Z, n, opts.seed);
  let dup = new Int32Array(n).fill(-1);
  // the first tetrahedron: four points not on one plane (its ghosts around it)
  const first = [order[0]];
  for (let i = 1; i < n && first.length < 4; i++) {
    const v = order[i], f = first;
    if (f.length === 1) { if (X[v] !== X[f[0]] || Y[v] !== Y[f[0]] || Z[v] !== Z[f[0]]) f.push(v); }
    else if (f.length === 2) { if (!umtCollinear(X[f[0]], Y[f[0]], Z[f[0]], X[f[1]], Y[f[1]], Z[f[1]], X[v], Y[v], Z[v])) f.push(v); }
    else if (umtOrient(X[f[0]], Y[f[0]], Z[f[0]], X[f[1]], Y[f[1]], Z[f[1]], X[f[2]], Y[f[2]], Z[f[2]], X[v], Y[v], Z[v]) !== 0) f.push(v);
  }
  if (first.length < 4) throw new Error('um-tet: the points all lie on one plane');
  { let [a, b, c, d] = first; if (umtOrient(X[a], Y[a], Z[a], X[b], Y[b], Z[b], X[c], Y[c], Z[c], X[d], Y[d], Z[d]) < 0) [b, c] = [c, b];
    const t0 = newTet(); tv.set([a, b, c, d], 4 * t0); alive[t0] = 1;
    // (a ghost on each face: the far vertex replaced by infinity and two others swapped, so infinity, outside, lies on the
    //  negative side of its face as every tetrahedron's vertex does of its own: a ghost's hull face faces into the hull)
    const all = [t0];
    for (let k = 0; k < 4; k++) {
      const t = newTet(), o = [0, 1, 2, 3].filter(i => i !== k);
      for (let i = 0; i < 4; i++) tv[4 * t + i] = i === k ? UMT_INF : tv[4 * t0 + i];
      [tv[4 * t + o[0]], tv[4 * t + o[1]]] = [tv[4 * t + o[1]], tv[4 * t + o[0]]];
      alive[t] = 1; all.push(t);
    }
    // (the five joined face to face: each face matched by its vertices)
    const fm = new Map();
    for (const t of all) for (let k = 0; k < 4; k++) {
      const key = [0, 1, 2, 3].filter(i => i !== k).map(i => tv[4 * t + i]).sort((x, y) => x - y).join();
      const o = fm.get(key); if (o) { tn[4 * t + k] = o[0]; tn[4 * o[0] + o[1]] = t; fm.delete(key); } else fm.set(key, [t, k]);
    }
    if (fm.size) throw new Error('um-tet: the first tetrahedron\'s ghosts do not close');
  }
  const inFirst = new Set(first);
  let last = 0;
  let markArr = new Int32Array(cap), stamp = 0, cavStamp = -1;
  // (the new tetrahedra's edges, matched in pairs: an open-addressed table of (lower point, higher point) → tetrahedron
  //  and face, cleared by a stamp; sized for the cavity at hand)
  let hCap = 1024, hA = new Int32Array(hCap), hB = new Int32Array(hCap), hV = new Int32Array(hCap), hS = new Int32Array(hCap), hStamp = 0, hOpen = 0;
  const hReset = need => { hStamp++; hOpen = 0; if (2 * need > hCap) { while (2 * need > hCap) hCap *= 2; hA = new Int32Array(hCap); hB = new Int32Array(hCap); hV = new Int32Array(hCap); hS = new Int32Array(hCap); hStamp = 1; } };
  /** Edge a < b of new tetrahedron-face v (4 t + q): the one met before on it (−1 if none, this one kept). */
  const hMatch = (a, b, v) => {
    for (let i = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77)) & (hCap - 1); ; i = (i + 1) & (hCap - 1)) {
      if (hS[i] !== hStamp) { hS[i] = hStamp; hA[i] = a; hB[i] = b; hV[i] = v; hOpen++; return -1; }
      if (hA[i] === a && hB[i] === b && hV[i] >= 0) { const o = hV[i]; hV[i] = -1; hOpen--; return o; }
    }
  };
  // (for corners k and q of a tetrahedron, its other two, in order)
  const REST = [];
  for (let k = 0; k < 4; k++) for (let q = 0; q < 4; q++) REST.push([0, 1, 2, 3].filter(i => i !== k && i !== q));
  /** The tetrahedron (or ghost) holding point p: a walk across any face p is beyond. */
  const locate = (p, from = last) => {
    let t = from, guard = 0;
    walk: for (;;) {
      if (++guard > 10 * (nT + 10)) throw new Error('um-tet: the walk did not end');
      const j = infAt(t);
      if (j >= 0) break;   // (a ghost reached across its hull face: p is beyond it, in conflict)
      const r = (guard * 7) & 3;
      for (let q = 0; q < 4; q++) { const k = (q + r) & 3; if (side(t, k, p) > 0) { t = tn[4 * t + k]; continue walk; } }
      break;
    }
    return t;
  };
  const insert = p => {
    let t = locate(p);
    // a duplicate point: skipped
    if (infAt(t) < 0) { let d = -1; for (let k = 0; k < 4; k++) { const v = tv[4 * t + k]; if (X[v] === X[p] && Y[v] === Y[p] && Z[v] === Z[p]) d = v; } if (d >= 0) { dup[p] = d; return -1; } }
    // the cavity: every tetrahedron in conflict, connected to t; then grown over any face a new tetrahedron would be flat on
    if (markArr.length < cap) { const m2 = new Int32Array(cap); m2.set(markArr); markArr = m2; }
    stamp++;
    const cav = [t]; markArr[t] = stamp;
    for (let i = 0; i < cav.length; i++) { const c = cav[i]; for (let k = 0; k < 4; k++) { const nb = tn[4 * c + k]; if (markArr[nb] !== stamp && conflict(nb, p)) { markArr[nb] = stamp; cav.push(nb); } } }
    let faces;
    for (let pass = 0; ; pass++) {
      faces = []; let grew = false;
      for (let ci = 0; ci < cav.length; ci++) { const c = cav[ci], j = infAt(c); for (let k = 0; k < 4; k++) {
        const nb = tn[4 * c + k]; if (markArr[nb] === stamp) continue;
        let ok;
        if (j < 0 || j === k) ok = side(c, k, p) < 0;
        else { const f = UMT_OUT[k].filter(i => i !== j).map(i => tv[4 * c + i]); ok = !umtCollinear(X[f[0]], Y[f[0]], Z[f[0]], X[f[1]], Y[f[1]], Z[f[1]], X[p], Y[p], Z[p]); }
        if (!ok) { markArr[nb] = stamp; cav.push(nb); grew = true; }
        else faces.push(c, k);
      } }
      if (!grew) break;
      if (pass > 1000) throw new Error('um-tet: the cavity did not close');
    }
    // the new tetrahedra: each boundary face joined to p
    hReset(3 * faces.length / 2);
    const made = [];
    for (let i = 0; i < faces.length; i += 2) {
      const c = faces[i], k = faces[i + 1], nb = tn[4 * c + k], t2 = newTet();
      if (markArr.length < cap) { const m2 = new Int32Array(cap); m2.set(markArr); markArr = m2; }
      for (let q = 0; q < 4; q++) tv[4 * t2 + q] = q === k ? p : tv[4 * c + q];
      alive[t2] = 1; markArr[t2] = 0;
      tn[4 * t2 + k] = nb;
      for (let q = 0; q < 4; q++) if (tn[4 * nb + q] === c) tn[4 * nb + q] = t2;
      made.push(t2);
      // (its other faces each hold p and an edge of the boundary face: matched with the new tetrahedron on the other side)
      for (let q = 0; q < 4; q++) if (q !== k) {
        const r = REST[4 * k + q], e0 = tv[4 * t2 + r[0]], e1 = tv[4 * t2 + r[1]], o = e0 < e1 ? hMatch(e0, e1, 4 * t2 + q) : hMatch(e1, e0, 4 * t2 + q);
        if (o >= 0) { tn[4 * t2 + q] = o >> 2; tn[4 * (o >> 2) + (o & 3)] = t2; }
      }
    }
    if (hOpen) throw new Error('um-tet: the cavity\'s new tetrahedra do not close');
    for (const c of cav) { alive[c] = 0; free.push(c); }
    last = made.find(q => infAt(q) < 0) ?? made[0];
    return made;
  };
  for (const p of order) if (!inFirst.has(p)) insert(p);
  /** The finite tetrahedra, renumbered; the hull from the ghosts. */
  const finite = (o2 = {}) => {
  const id = new Int32Array(nT).fill(-1); let m = 0, nGhost = 0;
  for (let t = 0; t < nT; t++) if (alive[t]) { if (infAt(t) < 0) id[t] = m++; else nGhost++; }
  const TV = new Int32Array(4 * m), TN = new Int32Array(4 * m), hull = [];
  for (let t = 0; t < nT; t++) if (id[t] >= 0) for (let k = 0; k < 4; k++) { TV[4 * id[t] + k] = tv[4 * t + k]; const nb = tn[4 * t + k]; TN[4 * id[t] + k] = id[nb]; if (id[nb] < 0) hull.push(...UMT_OUT[k].map(i => tv[4 * t + i])); }
  return { nT: m, tv: TV, tn: TN, hull: Int32Array.from(hull), dup, nGhost, id, ...(o2.keep ? { work: { tv, tn, alive, nT } } : {}) };
  };
  return {
    insert: p => { if (dup.length <= p) { const d2 = new Int32Array(Math.max(2 * dup.length, p + 1)).fill(-1); d2.set(dup); dup = d2; } return insert(p); },
    /** The tetrahedron (or ghost) holding (x, y, z): the walk started at tetrahedron hint if given (alive, not a ghost),
     *  else at the last made. */
    locate: (x, y, z, hint) => { const p = X.length; X.push(x); Y.push(y); Z.push(z);
      const t = locate(p, hint !== undefined && hint >= 0 && hint < nT && alive[hint] && infAt(hint) < 0 ? hint : last); X.pop(); Y.pop(); Z.pop(); return t; },
    /** The tetrahedra a point at (x, y, z) would replace (its conflict cavity), without inserting it: [located, …]. Until
     *  the next cavityOf or insert, inCavity(t) says whether t is in it. */
    cavityOf: (x, y, z) => {
      const p = X.length; X.push(x); Y.push(y); Z.push(z);
      if (markArr.length < cap) { const m2 = new Int32Array(cap); m2.set(markArr); markArr = m2; }
      const t = locate(p), cav = [t]; stamp++; markArr[t] = stamp;
      for (let i = 0; i < cav.length; i++) { const c = cav[i]; for (let k = 0; k < 4; k++) { const nb = tn[4 * c + k]; if (markArr[nb] !== stamp && conflict(nb, p)) { markArr[nb] = stamp; cav.push(nb); } } }
      X.pop(); Y.pop(); Z.pop(); cavStamp = stamp; return cav;
    },
    inCavity: t => markArr[t] === cavStamp && cavStamp === stamp,
    finite, infAt, conflict,
    get tv() { return tv; }, get tn() { return tn; }, get alive() { return alive; }, get nT() { return nT; }, get dup() { return dup; },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { UMT_OUT, umtOrient, umtInSphere, umtOrientExact, umtInSphereExact, umtCollinear, umtExact, umtSplit, umtDelaunay, umtTri };
