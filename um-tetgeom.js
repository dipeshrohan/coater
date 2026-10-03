/*
 * um-tetgeom.js — the coater's solids as um-tetmesh.js meshes them (MESH-T2e): bounded by flat faces, its curved surfaces
 * (the blade's underside, the pipes' walls) cut into facets whose corners lie on the true surface, as fine as the size and a
 * chord tolerance ask (the facets' middles within the tolerance of the surface).
 *
 * umgCurve(f, x0, x1, size, tol): points [x, f(x)] from x0 to x1 along a curve y = f(x): each piece no longer than the size
 *   there and its middle within tol of the curve (pieces halved until both hold). Every point exactly on the curve.
 * umgCircle(n, size, r, tol): the number of pieces round a circle of radius r: at least 8, none longer than the size, the
 *   chord's middle within tol of the circle.
 * umgPool(o): the paste behind (and under) the blade, with the outlets' pipes standing in it, as fmMesh (feed-mesh.js)
 *   models it -- G for umtSurface and the exact volume. Coordinates (m): x along the web (the metering edge at 0), y up from
 *   the web, z across. o: { z0, z1 (across the web), xCut (the cut upstream, < 0), xEnd (the domain's end: before the edge,
 *   under the blade; after it, the film's end), bladeY(x) (the underside's height, x <= 0), H0 (the pile's surface), film0
 *   (the film after the edge, when xEnd > 0), outlets: [{ x, z, ym (the mouth), yIn (the bore's inlet) }], d (bore), Do (the
 *   pipe's outer diameter), size ((x, y, z) -> h, or a number), tol (the chord tolerance), across (at least this many
 *   elements across the gap under the blade and across a pipe's bore, default 3: the size there at most the gap's height,
 *   or the bore, over it), grow (the size's growth away from a pipe, default 1.3) }.
 *   The profile along the web (web, outlet or film, the exit face, the blade's underside, the pile's surface, the inlet)
 *   extruded across; each pipe: its outer wall from the mouth up to the pile's surface (a hole in it), the wall's end (a
 *   ring) at the mouth, the bore's wall from the mouth up to its inlet, the inlet (a disc). Tags: web, outlet, film, face,
 *   blade, pile, inlet, side0, side1, pipe-wall, pipe-end, bore, bore-inlet.
 *   Returns { G, size (the size to mesh it with: o.size, held under the blade to the gap's height over `across`), volume
 *   (the exact solid's, the blade's underside integrated), volumeFacets (the faceted solid's, exact), xJ (where the pile's
 *   surface meets the blade) }.
 * Pure computation.
 */

/** Points along y = f(x) from x0 to x1 (see the header). */
function umgCurve(f, x0, x1, size, tol) {
  const hOf = typeof size === 'function' ? size : () => size;
  const out = [[x0, f(x0)]];
  const piece = (a, b, depth) => {
    const m = [(a[0] + b[0]) / 2, f((a[0] + b[0]) / 2)], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const sag = Math.abs(m[1] - (a[1] + b[1]) / 2) * Math.abs(b[0] - a[0]) / Math.max(len, 1e-300);   // (the middle's distance from the chord)
    if (depth < 40 && (len > hOf(m[0], m[1]) || sag > tol)) { piece(a, m, depth + 1); piece(m, b, depth + 1); } else out.push(b);
  };
  piece(out[0], [x1, f(x1)], 0);
  return out;
}

/** Pieces round a circle of radius r (see the header). */
function umgCircle(size, r, tol) {
  const byTol = tol > 0 && tol < r ? Math.PI / Math.acos(1 - tol / r) : 8;
  return Math.max(8, Math.ceil(2 * Math.PI * r / size), Math.ceil(byTol));
}

/** The pool with its pipes (see the header). */
function umgPool(o) {
  const h0 = typeof o.size === 'function' ? o.size : () => o.size, tol = o.tol ?? Infinity, across = o.across ?? 3;
  const { z0, z1, xCut, xEnd, bladeY, H0 } = o, film0 = o.film0 ?? 0;
  // (under the blade, the size at most the gap's height over `across`; its slope there that of the underside over `across`)
  // (round each pipe, from its mouth to its inlet, the size at most the bore over `across`, growing away at grow - 1)
  const g = (o.grow ?? 1.3) - 1, hPipe = o.d / across, axes = (o.outlets || []).map(q => ({ x: q.x, z: q.z, y0: q.ym, y1: q.yIn }));
  const hOf = (x, y, z) => {
    let h = h0(x, y, z);
    if (x > xCut && x <= Math.min(0, xEnd) && bladeY(x) < H0) h = Math.min(h, bladeY(x) / across);
    for (const a of axes) h = Math.min(h, hPipe + g * Math.max(0, Math.hypot(Math.hypot(x - a.x, z - a.z) - o.Do / 2 > 0 ? Math.hypot(x - a.x, z - a.z) - o.Do / 2 : 0, Math.max(a.y0 - y, 0, y - a.y1))));
    return h;
  };
  // where the pile's surface meets the blade
  let lo = xCut, hi = Math.min(0, xEnd);
  if (!(bladeY(lo) > H0)) throw new Error('um-tetgeom: the blade is below the pile\'s surface at the cut');
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (bladeY(m) > H0) lo = m; else hi = m; }
  const xJ = (lo + hi) / 2;
  // the profile (counter-clockwise seen from +z), each piece's tag
  const P = [], tags = [];
  const add = (p, tag) => { P.push(p); tags.push(tag); };   // (tag: of the piece from this point to the next)
  add([xCut, 0], 'web');
  const xb = Math.min(0, xEnd);
  if (xEnd > 0) { add([xEnd, 0], 'outlet'); add([xEnd, film0], 'film'); if (bladeY(0) > film0) add([0, film0], 'face'); }
  else add([xEnd, 0], 'outlet');
  const blade = umgCurve(bladeY, xb, xJ, (x, y) => hOf(x, y, (z0 + z1) / 2), tol);
  blade.forEach((q, i) => { if (i < blade.length - 1) add(q, 'blade'); });
  add([xJ, H0], 'pile'); add([xCut, H0], 'inlet');
  // corners: the profile at z0 and at z1
  const X = [], Y = [], Z = [], pt = (x, y, z) => { X.push(x); Y.push(y); Z.push(z); return X.length - 1; };
  const b = P.map(([x, y]) => pt(x, y, z0)), t = P.map(([x, y]) => pt(x, y, z1)), n = P.length;
  const faces = [{ loops: [b.slice().reverse()], tag: 'side0' }, { loops: [t], tag: 'side1' }];
  const pileI = tags.indexOf('pile');
  const ro = o.Do / 2, rb = o.d / 2, outlets = o.outlets || [];
  // (each pipe stands in the pile: its wall inside the pile's surface, its mouth in the paste, its inlet above the mouth)
  outlets.forEach((q, i) => {
    if (!(q.x - ro > xCut && q.x + ro < xJ && q.z - ro > z0 && q.z + ro < z1)) throw new Error(`um-tetgeom: pipe ${i + 1} (x ${(q.x * 1e3).toFixed(1)} mm, z ${(q.z * 1e3).toFixed(1)} mm) is not inside the pile's surface (x ${(xCut * 1e3).toFixed(1)} to ${(xJ * 1e3).toFixed(1)} mm, where the blade meets it)`);
    if (!(q.ym > 0 && q.ym < H0 && q.yIn > q.ym && rb < ro)) throw new Error(`um-tetgeom: pipe ${i + 1}: its mouth must be in the paste (0 < ym < H0), its inlet above it, its bore inside its wall`);
  });
  // each pipe's circles (shared by the faces that meet there)
  const circ = (q, r, y, m) => Array.from({ length: m }, (_, k) => pt(q.x + r * Math.cos(2 * Math.PI * k / m), y, q.z + r * Math.sin(2 * Math.PI * k / m)));
  const pipes = outlets.map(q => {
    const mo = umgCircle(hOf(q.x, q.ym, q.z), ro, tol), mb = umgCircle(hOf(q.x, q.ym, q.z), rb, tol);
    return { q, outerM: circ(q, ro, q.ym, mo), outerH: circ(q, ro, H0, mo), boreM: circ(q, rb, q.ym, mb), boreIn: circ(q, rb, q.yIn, mb) };
  });
  // a loop turned so that seen from outside (along `out`) it runs counter-clockwise
  const newell = L => { let nx = 0, ny = 0, nz = 0; for (let i = 0; i < L.length; i++) { const a = L[i], c = L[(i + 1) % L.length]; nx += (Y[a] - Y[c]) * (Z[a] + Z[c]); ny += (Z[a] - Z[c]) * (X[a] + X[c]); nz += (X[a] - X[c]) * (Y[a] + Y[c]); } return [nx, ny, nz]; };
  const facing = (L, out) => { const nv = newell(L); return nv[0] * out[0] + nv[1] * out[1] + nv[2] * out[2] >= 0 ? L : L.slice().reverse(); };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, L = [b[i], b[j], t[j], t[i]];
    if (i === pileI && pipes.length) {
      // the pile's surface: its outward normal +y, the pipes' outer walls through it as holes (turned the other way)
      faces.push({ loops: [facing(L, [0, 1, 0]), ...pipes.map(p => facing(p.outerH, [0, -1, 0]))], tag: tags[i] });
    } else faces.push({ loops: [L], tag: tags[i] });
  }
  for (const p of pipes) {
    const { q } = p, m = p.outerM.length, k = p.boreM.length;
    // the outer wall (the paste outside it: its outward normal toward the axis)
    for (let a = 0; a < m; a++) { const c = (a + 1) % m, L = [p.outerM[a], p.outerM[c], p.outerH[c], p.outerH[a]];
      const mid = [(X[L[0]] + X[L[1]]) / 2 - q.x, 0, (Z[L[0]] + Z[L[1]]) / 2 - q.z]; faces.push({ loops: [facing(L, mid.map(v => -v))], tag: 'pipe-wall' }); }
    // the wall's end at the mouth (the paste below: +y), the bore through it
    faces.push({ loops: [facing(p.outerM, [0, 1, 0]), facing(p.boreM, [0, -1, 0])], tag: 'pipe-end' });
    // the bore's wall (the paste inside: outward from the axis), its inlet (+y)
    for (let a = 0; a < k; a++) { const c = (a + 1) % k, L = [p.boreM[a], p.boreM[c], p.boreIn[c], p.boreIn[a]];
      const mid = [(X[L[0]] + X[L[1]]) / 2 - q.x, 0, (Z[L[0]] + Z[L[1]]) / 2 - q.z]; faces.push({ loops: [facing(L, mid)], tag: 'bore' }); }
    faces.push({ loops: [facing(p.boreIn, [0, 1, 0])], tag: 'bore-inlet' });
  }
  // the volumes: exact (the underside integrated, the pipes round) and the faceted solid's (polygons)
  const W = z1 - z0, K = 20000;
  let under = 0; for (let i = 0; i < K; i++) { const x = xJ + (xb - xJ) * (i + 0.5) / K; under += bladeY(x) * (xb - xJ) / K; }
  const film = xEnd > 0 ? film0 * xEnd : 0;
  const volume = W * (H0 * (xJ - xCut) + under + film) + outlets.reduce((s, q) => s - Math.PI * ro * ro * (H0 - q.ym) + Math.PI * rb * rb * (q.yIn - q.ym), 0);
  const polyA = L => { let A = 0; for (let i = 0; i < L.length; i++) { const a = L[i], c = L[(i + 1) % L.length]; A += X[a] * Z[c] - X[c] * Z[a]; } return Math.abs(A) / 2; };
  let area = 0; for (let i = 0; i < n; i++) { const a = P[i], c = P[(i + 1) % n]; area += (a[0] * c[1] - c[0] * a[1]) / 2; }
  const volumeFacets = W * area + pipes.reduce((s, p) => s - polyA(p.outerH) * (H0 - p.q.ym) + polyA(p.boreIn) * (p.q.yIn - p.q.ym), 0);
  return { G: { X, Y, Z, faces }, size: hOf, volume, volumeFacets, xJ };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { umgCurve, umgCircle, umgPool };
