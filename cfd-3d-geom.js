/*
 * cfd-3d-geom.js — the geometry of Flow › 3D: the blade as triangles (made from the 2D setup, or read
 * from an STL or STEP file), placed over the web, the height of its underside over the web found by
 * casting vertical rays, and a structured hexahedral mesh of the slurry region (the gap under the
 * blade and the film beyond the metering edge) over a strip of the web or its full width.
 *
 * Axes (SI, m): x along the machine direction (0 at the inlet, the pool edge or the start of the flat
 * land; the metering edge at xe), y up from the web (the web at y = 0), z across the web.
 */

/**
 * The blade's side profile as a closed polygon [[x, y], ...] (counter-clockwise), from the 2D setup:
 * the underside (round entry from the pool edge, or the flat land) to the metering edge E, the exit
 * face (faceDeg from the web, toward +x at 90° less) up to the notch corner V, down to the dry edge D
 * (as the Contact line tab draws it), then the blade's top back over the inlet. shaped: a shaped blade's
 * { under, face } points instead (cfd-blade.js's pathPoints, m).
 */
function bladeSideOutline({ shape, H, R, Xup, L, faceDeg, faceLen, top, shaped = null }) {
  if (shaped) {
    // a shaped blade (cfd-blade.js): its underside and face as points (m, from the inlet), M between them; the notch
    // corner V at the face's end, the dry edge below it as the round entry and flat land have it
    const pts = shaped.under.map(q => q.slice()), face = shaped.face.slice(1), V = face[face.length - 1], fl = faceLen ?? 8e-3;
    pts.push(...face.slice(0, -1).map(q => q.slice()));
    const D = [V[0] + 0.55 * fl * Math.SQRT1_2, V[1] - 0.55 * fl * Math.SQRT1_2];
    const yTop = Math.max(top, V[1] + 2e-3, ...shaped.under.map(q => q[1] + 2e-3));
    pts.push(V, D, [D[0], yTop], [shaped.under[0][0], yTop]);
    return { pts, xe: shaped.under[shaped.under.length - 1][0], V, D, yTop };
  }
  const pts = [];
  const xe = shape === 'round' ? Xup : L;
  const under = shape === 'round' ? (x => H + R - Math.sqrt(R * R - (Xup - x) ** 2)) : (() => H);
  const n = shape === 'round' ? 48 : 1;
  for (let i = 0; i <= n; i++) { const x = xe * i / n; pts.push([x, under(x)]); }
  const th = faceDeg * Math.PI / 180;
  const V = [xe + faceLen * Math.cos(th), H + faceLen * Math.sin(th)];
  const D = [V[0] + 0.55 * faceLen * Math.SQRT1_2, V[1] - 0.55 * faceLen * Math.SQRT1_2];   // the dry edge, as drawn in Contact line
  const yTop = Math.max(top, V[1] + 2e-3, under(0) + 2e-3);
  pts.push(V, D, [D[0], yTop], [0, yTop]);
  return { pts, xe, V, D, yTop };
}

/** Extrude a side profile across the web from z0 to z1 (nz segments), each z shifted up by dy(z): triangles. */
function extrudeProfile(pts, z0, z1, nz, dy = () => 0) {
  const P = [], zs = Array.from({ length: nz + 1 }, (_, k) => z0 + (z1 - z0) * k / nz), m = pts.length;
  const tri = (a, b, c) => P.push(...a, ...b, ...c);
  const at = (p, k) => [p[0], p[1] + dy(zs[k]), zs[k]];
  for (let k = 0; k < nz; k++) for (let i = 0; i < m; i++) {
    const a = pts[i], b = pts[(i + 1) % m];
    tri(at(a, k), at(b, k), at(b, k + 1)); tri(at(a, k), at(b, k + 1), at(a, k + 1));
  }
  // the two end caps (the profile is convex enough near its underside; fan from its centroid)
  const cx = pts.reduce((s, p) => s + p[0], 0) / m, cy = pts.reduce((s, p) => s + p[1], 0) / m;
  for (const [k, flip] of [[0, true], [nz, false]]) for (let i = 0; i < m; i++) {
    const a = at(pts[i], k), b = at(pts[(i + 1) % m], k), c = at([cx, cy], k);
    flip ? tri(a, c, b) : tri(a, b, c);
  }
  return new Float32Array(P);
}

/** Read an STL file (binary or text) to triangles: a Float32Array of 9 numbers per triangle, in the file's units. */
function parseSTL(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf instanceof ArrayBuffer ? buf : u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length >= 84) {
    const n = dv.getUint32(80, true);
    if (84 + 50 * n === u8.length) {
      const out = new Float32Array(9 * n);
      for (let t = 0; t < n; t++) for (let j = 0; j < 9; j++) out[9 * t + j] = dv.getFloat32(84 + 50 * t + 12 + 4 * j, true);
      return out;
    }
  }
  const text = new TextDecoder().decode(u8);
  const nums = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m; while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
  if (!nums.length || nums.length % 9) throw new Error('not an STL file (no triangles found)');
  return new Float32Array(nums);
}

/** Write triangles as a binary STL (tests, and the 3D page's export of the blade made here). */
function writeSTL(tris) {
  const n = tris.length / 9, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let j = 0; j < 9; j++) dv.setFloat32(84 + 50 * t + 12 + 4 * j, tris[9 * t + j], true);
  return buf;
}

const AXES = { '+x': [0, 1], '-x': [0, -1], '+y': [1, 1], '-y': [1, -1], '+z': [2, 1], '-z': [2, -1] };
/**
 * A file's triangles to the app's axes and metres: scale (m per file unit), which file axis runs in the
 * machine direction and which is up (the third is across the web, right-handed).
 */
function orientTris(src, { scale, machine = '+x', up = '+z' }) {
  const [im, sm] = AXES[machine], [iu, su] = AXES[up];
  if (im === iu) throw new Error('the machine direction and up must be different axes');
  const iw = 3 - im - iu;
  // across the web = machine x up (right-handed: x, y up, z)
  const e = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  e[0][im] = sm; e[1][iu] = su;
  e[2] = [e[0][1] * e[1][2] - e[0][2] * e[1][1], e[0][2] * e[1][0] - e[0][0] * e[1][2], e[0][0] * e[1][1] - e[0][1] * e[1][0]];
  void iw;
  const out = new Float32Array(src.length);
  for (let v = 0; v < src.length; v += 3) for (let a = 0; a < 3; a++) out[v + a] = scale * (e[a][0] * src[v] + e[a][1] * src[v + 1] + e[a][2] * src[v + 2]);
  return out;
}

/** Bounding box of triangles: { min: [x, y, z], max: [x, y, z] }. */
function trisBox(t) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < t.length; v += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], t[v + a]); max[a] = Math.max(max[a], t[v + a]); }
  return { min, max };
}

/**
 * Place an imported blade over the web: its lowest point at height H (the gap at the metering edge)
 * and at x = xUp (so the inlet, xUp upstream of it, is x = 0), centred across the web on zc.
 * Returns the moved triangles and where the lowest point was found.
 */
function placeBlade(t, { H, xUp, zc }) {
  let k0 = 1;
  for (let v = 1; v < t.length; v += 3) if (t[v] < t[k0]) k0 = v;
  const b = trisBox(t), dx = xUp - t[k0 - 1], dy = H - t[k0], dz = zc - (b.min[2] + b.max[2]) / 2;
  const out = new Float32Array(t.length);
  for (let v = 0; v < t.length; v += 3) { out[v] = t[v] + dx; out[v + 1] = t[v + 1] + dy; out[v + 2] = t[v + 2] + dz; }
  return { tris: out, edgeX: xUp, edgeZ: t[k0 + 1] + dz };
}

/**
 * The blade's underside over the web: at each (x_i, z_k) a vertical ray from below; the lowest hit is
 * the height of the underside (Infinity where the ray misses the blade: open), and the number of hits
 * tells whether the blade is a single layer there (2 hits through a solid; more: an overhang or a pocket).
 */
function undersideField(t, xs, zs) {
  const nx = xs.length, nz = zs.length, low = new Float64Array(nx * nz).fill(Infinity), hits = new Uint8Array(nx * nz);
  // bin the triangles over the x-z grid
  const x0 = xs[0], x1 = xs[nx - 1], z0 = zs[0], z1 = zs[nz - 1];
  const BX = Math.max(1, Math.min(200, nx)), BZ = Math.max(1, Math.min(200, nz)), bins = Array.from({ length: BX * BZ }, () => []);
  const bx = x => Math.max(0, Math.min(BX - 1, Math.floor((x - x0) / ((x1 - x0) || 1) * BX))), bz = z => Math.max(0, Math.min(BZ - 1, Math.floor((z - z0) / ((z1 - z0) || 1) * BZ)));
  for (let f = 0; f < t.length; f += 9) {
    const xa = Math.min(t[f], t[f + 3], t[f + 6]), xb = Math.max(t[f], t[f + 3], t[f + 6]), za = Math.min(t[f + 2], t[f + 5], t[f + 8]), zb = Math.max(t[f + 2], t[f + 5], t[f + 8]);
    if (xb < x0 || xa > x1 || zb < z0 || za > z1) continue;
    for (let i = bx(xa); i <= bx(xb); i++) for (let k = bz(za); k <= bz(zb); k++) bins[i * BZ + k].push(f);
  }
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const px = xs[i], pz = zs[k], ys = [];
    for (const f of bins[bx(px) * BZ + bz(pz)]) {
      // barycentric in the x-z plane
      const ax = t[f], az = t[f + 2], bxx = t[f + 3], bzz = t[f + 5], cx = t[f + 6], cz = t[f + 8];
      const d = (bzz - cz) * (ax - cx) + (cx - bxx) * (az - cz);
      if (Math.abs(d) < 1e-24) continue;
      const l1 = ((bzz - cz) * (px - cx) + (cx - bxx) * (pz - cz)) / d, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d, l3 = 1 - l1 - l2;
      const e = -1e-9;
      if (l1 < e || l2 < e || l3 < e) continue;
      ys.push(l1 * t[f + 1] + l2 * t[f + 4] + l3 * t[f + 7]);
    }
    if (!ys.length) continue;
    ys.sort((a, b) => a - b);
    // (hits within a hair of each other are one crossing through a shared edge)
    const uniq = ys.filter((y, j) => j === 0 || y - ys[j - 1] > 1e-9);
    low[i * nz + k] = uniq[0]; hits[i * nz + k] = uniq.length;
  }
  return { nx, nz, xs, zs, low, hits };
}

/**
 * The structured hexahedral mesh of the slurry region: x stations over the gap (inlet to the
 * metering edge, graded toward the edge) and over the film beyond it; ny layers from the web to the
 * top (the blade's underside in the gap, the film's surface beyond: film(x, z)); z stations across.
 * Returns the node coordinates and counts, and the edges of its outer faces (for drawing).
 */
function mesh3D({ xsGap, xsFilm, zs, under, film, ny }) {
  const xs = [...xsGap, ...xsFilm.slice(1)], nx = xs.length, nz = zs.length, nj = ny + 1;
  const top = (i, k) => i < xsGap.length ? under(i, k) : film(xs[i], zs[k]);
  const N = nx * nj * nz, pos = new Float32Array(3 * N), id = (i, j, k) => (i * nz + k) * nj + j;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const h = top(i, k);
    for (let j = 0; j < nj; j++) { const p = 3 * id(i, j, k); pos[p] = xs[i]; pos[p + 1] = h * (j / ny); pos[p + 2] = zs[k]; }
  }
  // outer faces' grid lines: the web (j = 0), the top (j = ny), the sides (k = 0, nz-1), the inlet and outlet (i = 0, nx-1)
  const L = [];
  const seg = (a, b) => L.push(a, b);
  for (const j of [0, ny]) { for (let i = 0; i < nx; i++) for (let k = 0; k < nz - 1; k++) seg(id(i, j, k), id(i, j, k + 1)); for (let k = 0; k < nz; k++) for (let i = 0; i < nx - 1; i++) seg(id(i, j, k), id(i + 1, j, k)); }
  for (const k of [0, nz - 1]) { for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) seg(id(i, j, k), id(i, j + 1, k)); for (let j = 1; j < ny; j++) for (let i = 0; i < nx - 1; i++) seg(id(i, j, k), id(i + 1, j, k)); }
  for (const i of [0, nx - 1]) { for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) seg(id(i, j, k), id(i, j + 1, k)); for (let j = 1; j < ny; j++) for (let k = 0; k < nz - 1; k++) seg(id(i, j, k), id(i, j, k + 1)); }
  return { pos, lines: new Uint32Array(L), nx, ny, nz, nodes: N, cells: (nx - 1) * ny * (nz - 1), xs, zs };
}

/** Stations from a to b, n intervals, crowded toward b by grade (1 = even). */
const gradedStations = (a, b, n, grade = 1) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * (1 - Math.pow(1 - i / n, grade)));

/**
 * The blade's side section at z = z0 (across the web, in the triangles' own frame after orientTris): every triangle
 * crossing the plane gives a segment; joined end to end (within 1e-7 of the part's size) they make loops (closed) or
 * chains. Points where the section runs straight on are dropped. Returns [{ verts: [{ x, y }], closed }], the one
 * with the lowest point first.
 */
function sectionTris(t, z0) {
  const b = trisBox(t), size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-9), eps = 1e-9 * size;
  // (the plane nudged off any corner of a triangle lying on it)
  let zz = z0;
  for (let tries = 0; tries < 8; tries++) { let on = false; for (let v = 2; v < t.length && !on; v += 3) on = Math.abs(t[v] - zz) < eps; if (!on) break; zz += 7.3 * eps; }
  const segs = [];
  for (let f = 0; f < t.length; f += 9) {
    const pts = [];
    for (const [a, c] of [[0, 1], [1, 2], [2, 0]]) {
      const A = f + 3 * a, C = f + 3 * c, za = t[A + 2] - zz, zc = t[C + 2] - zz;
      if ((za < 0) !== (zc < 0)) { const s = za / (za - zc); pts.push([t[A] + s * (t[C] - t[A]), t[A + 1] + s * (t[C + 1] - t[A + 1])]); }
    }
    if (pts.length === 2 && Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) > eps) segs.push(pts);
  }
  // join the segments at their ends (a grid of the tolerance, its neighbours too)
  const tol = 1e-7 * size, key = p => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`, grid = new Map();
  const near = p => { const out = [], i = Math.round(p[0] / tol), j = Math.round(p[1] / tol); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const e of grid.get(`${i + di},${j + dj}`) || []) out.push(e); return out; };
  segs.forEach((sg, n) => { for (const e of [0, 1]) { const k = key(sg[e]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([n, e]); } });
  const used = new Uint8Array(segs.length), out = [];
  const same = (p, q) => Math.abs(p[0] - q[0]) <= 2 * tol && Math.abs(p[1] - q[1]) <= 2 * tol;
  for (let n0 = 0; n0 < segs.length; n0++) {
    if (used[n0]) continue;
    used[n0] = 1;
    const chain = [segs[n0][0], segs[n0][1]];
    for (const end of ['tail', 'head']) {
      for (;;) {
        const tip = end === 'tail' ? chain[chain.length - 1] : chain[0];
        const nx = near(tip).find(([m, e]) => !used[m] && same(segs[m][e], tip));
        if (!nx) break;
        const [m, e] = nx; used[m] = 1;
        const other = segs[m][1 - e];
        if (end === 'tail') chain.push(other); else chain.unshift(other);
      }
    }
    const closed = chain.length > 3 && same(chain[0], chain[chain.length - 1]);
    if (closed) chain.pop();
    // (points where it runs straight on dropped)
    const v = [];
    for (let k = 0; k < chain.length; k++) {
      const a = chain[(k - 1 + chain.length) % chain.length], p = chain[k], c = chain[(k + 1) % chain.length];
      const ends = !closed && (k === 0 || k === chain.length - 1);
      const cross = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]), l = Math.hypot(p[0] - a[0], p[1] - a[1]) * Math.hypot(c[0] - p[0], c[1] - p[1]);
      if (ends || Math.abs(cross) > 1e-9 * l) v.push({ x: p[0], y: p[1] });
    }
    out.push({ verts: v, closed });
  }
  const low = c => Math.min(...c.verts.map(q => q.y));
  return out.filter(c => c.verts.length >= 2).sort((a, b) => low(a) - low(b));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { bladeSideOutline, extrudeProfile, sectionTris, parseSTL, writeSTL, orientTris, trisBox, placeBlade, undersideField, mesh3D, gradedStations };
