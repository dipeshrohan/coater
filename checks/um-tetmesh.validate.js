/*
 * um-tetmesh.validate.js — checks of um-tetmesh.js (the app's own tetrahedral mesh generator) on solids with flat faces.
 * Run: node um-tetmesh.validate.js
 *  1. Each solid meshed: every tetrahedron positive; the volume the solid's exactly; every cell closed; the surface whole
 *     and kept (every boundary face one of the surface's triangles, each face's points on its plane, each patch's area its
 *     face's); the quality: dihedral angles between 15° and 155°, radius ratio at least 0.2.
 *       the box gmsh meshed for um-core's checks (0.02 × 0.01 × 0.015 m) at two sizes, beside gmsh's numbers (the fixture);
 *       the box with a pipe through it (a 24-sided hole, an inner shell: the faces with a hole in them);
 *       an L-shaped prism (a re-entrant edge, not convex).
 *  2. The same input twice gives the same mesh (no hidden randomness).
 *  3. A graded size (umtSizeField): 0.5 mm along a line on the box's floor (a metering edge), growing 0.3 per unit length
 *     to 3 mm. The mesh keeps every check of 1; its edges meet the size where they are (95 % within 1.25 of it), and the
 *     mean edge rises band by band away from the line, below the size there. Beside gmsh's mesh of the same box and size
 *     (fixtures/um-tet-graded, made by its make.py): as good a worst dihedral, and the size kept where gmsh's edges pass it.
 *  4. A size box (0.6 mm over the floor's downstream corner, 3 mm elsewhere): the checks of 1, the size met inside it.
 *  5. The size field itself: its value inside a box, on a line and far from both; its slope never above grow - 1.
 *  6. A surface that is not closed (a face left out) refused, saying so -- not refined without end.
 */
const M = require('../engine/um-tetmesh.js'), UC = require('../engine/um-core.js'), fs = require('fs'), path = require('path');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

/** A prism over polygon P (2D, counter-clockwise), from z0 to z1, with polygonal holes through it (each counter-clockwise). */
function prism(P, z0, z1, holes = [], tags = {}) {
  const X = [], Y = [], Z = [], faces = [], add = (x, y, z) => { X.push(x); Y.push(y); Z.push(z); return X.length - 1; };
  const ring = (Q, z) => Q.map(([x, y]) => add(x, y, z));
  const b = ring(P, z0), t = ring(P, z1), hb = holes.map(H => ring(H, z0)), ht = holes.map(H => ring(H, z1));
  // (the bottom seen from below: the outer loop reversed, each hole's as given; the top the other way)
  faces.push({ loops: [b.slice().reverse(), ...hb], tag: tags.bottom || 'bottom' }, { loops: [t, ...ht.map(r => r.slice().reverse())], tag: tags.top || 'top' });
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; faces.push({ loops: [[b[i], b[j], t[j], t[i]]], tag: (tags.side || 'side') + i }); }
  holes.forEach((H, k) => { for (let i = 0; i < H.length; i++) { const j = (i + 1) % H.length; faces.push({ loops: [[hb[k][i], ht[k][i], ht[k][j], hb[k][j]]], tag: tags.hole || 'pipe' }); } });
  return { X, Y, Z, faces };
}
const polyArea = P => P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + (p[0] * q[1] - q[0] * p[1]) / 2; }, 0);

/** Mesh a solid and check everything; returns its um-core quality. */
function audit(label, G, h, exactVolume, faceArea) {
  const t0 = Date.now(), S = M.umtSurface(G, { size: h }), V = M.umtVolume(S, { size: h }), ms = Date.now() - t0;
  const nT = V.tet.length / 4, P = v => [V.X[v], V.Y[v], V.Z[v]];
  let neg = 0;
  for (let t = 0; t < nT; t++) { const [a, b, c, d] = [0, 1, 2, 3].map(k => P(V.tet[4 * t + k])), u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]), w = d.map((x, i) => x - a[i]);
    if (!(u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]) > 0)) neg++; }
  const U = UC.umBuild({ X: V.X, Y: V.Y, Z: V.Z }, Array.from({ length: nT }, (_, i) => ({ t: UC.UM_TET, v: Array.from(V.tet.subarray(4 * i, 4 * i + 4)) })),
    Array.from({ length: V.bface.length / 3 }, (_, i) => ({ v: Array.from(V.bface.subarray(3 * i, 3 * i + 3)), tag: V.btag[i] })));
  const G2 = UC.umGeometry(U), Q = UC.umQuality(U, G2);
  // the boundary: exactly the surface's triangles (umBuild found no boundary face without a tag), each patch's area its face's
  const areas = {}; for (const p of U.patches) { let A = 0; for (let f = p.start; f < p.start + p.n; f++) A += Math.hypot(G2.fa[3 * f], G2.fa[3 * f + 1], G2.fa[3 * f + 2]); areas[p.name] = A; }
  let areaErr = 0; for (const [tag, A] of Object.entries(faceArea)) areaErr = Math.max(areaErr, Math.abs((areas[tag] || 0) / A - 1));
  const surfaceKept = U.nF - U.nIF === V.bface.length / 3 && U.patches.every(p => p.name !== 'defaultFaces');
  const ok = neg === 0 && Math.abs(Q.volumeTotal / exactVolume - 1) < 1e-12 && Q.opennessMax < 1e-12 && surfaceKept && areaErr < 1e-12
    && Q.tet.dihedralMin >= 15 && Q.tet.dihedralMax <= 155 && Q.tet.rhoMin >= 0.2;
  check(`${label}: positive, volume exact, closed, the surface kept, dihedral 15–155°, radius ratio ≥ 0.2`, ok,
    `${nT} tetrahedra (${ms} ms); volume ${(Q.volumeTotal / exactVolume - 1).toExponential(1)}; patches' areas ${areaErr.toExponential(1)}; dihedral ${Q.tet.dihedralMin.toFixed(1)}–${Q.tet.dihedralMax.toFixed(1)}°, radius ratio ≥ ${Q.tet.rhoMin.toFixed(3)} (mean ${Q.tet.rhoMean.toFixed(3)}); non-orthogonality ${Q.nonOrthoMax.toFixed(1)}° (avg ${Q.nonOrthoAvg.toFixed(1)}°), skewness ${Q.skewnessMax.toFixed(2)}`);
  return { Q, V };
}

// 1. solids
{
  // the fixture's box, against gmsh's numbers for it
  const fx = name => { const dir = path.join(__dirname, 'fixtures', name), T = {}; for (const f of ['points', 'faces', 'owner', 'neighbour', 'boundary']) T[f] = fs.readFileSync(path.join(dir, f), 'utf8'); return UC.umFromFoam(T); };
  const Qg = UC.umQuality(fx('um-tet-cube'));
  const box = prism([[0, 0], [0.02, 0], [0.02, 0.01], [0, 0.01]], 0, 0.015);
  const fa = { bottom: 2e-4, top: 2e-4, side0: 3e-4, side1: 1.5e-4, side2: 3e-4, side3: 1.5e-4 };
  const a = audit('the fixture\'s box (0.02 × 0.01 × 0.015 m) at 2.6 mm', box, 2.6e-3, 3e-6, fa);
  audit('  the same at 1.5 mm', box, 1.5e-3, 3e-6, fa);
  check('  beside gmsh\'s mesh of the same box (sizes 2–4 mm): worst dihedral and radius ratio at least as good', a.Q.tet.dihedralMin >= Qg.tet.dihedralMin && a.Q.tet.rhoMin >= Qg.tet.rhoMin,
    `this: ${a.Q.cells} cells, dihedral ${a.Q.tet.dihedralMin.toFixed(1)}–${a.Q.tet.dihedralMax.toFixed(1)}°, radius ratio ${a.Q.tet.rhoMin.toFixed(3)}; gmsh: ${Qg.cells} cells, ${Qg.tet.dihedralMin.toFixed(1)}–${Qg.tet.dihedralMax.toFixed(1)}°, ${Qg.tet.rhoMin.toFixed(3)}`);
  // the box with a pipe through it
  const n = 24, r = 0.003, hole = Array.from({ length: n }, (_, i) => [0.012 + r * Math.cos(2 * Math.PI * i / n), 0.005 + r * Math.sin(2 * Math.PI * i / n)]);
  const holed = prism([[0, 0], [0.02, 0], [0.02, 0.01], [0, 0.01]], 0, 0.015, [hole]);
  const ah = polyArea(hole), side = 2 * r * Math.sin(Math.PI / n);
  audit('the box with a pipe through it (24 sides, an inner shell)', holed, 1.5e-3, (2e-4 - ah) * 0.015, { bottom: 2e-4 - ah, top: 2e-4 - ah, pipe: n * side * 0.015 });
  // an L-shaped prism (a re-entrant edge)
  const L = [[0, 0], [0.02, 0], [0.02, 0.008], [0.008, 0.008], [0.008, 0.02], [0, 0.02]];
  audit('an L-shaped prism (a re-entrant edge, not convex)', prism(L, 0, 0.006), 1.5e-3, polyArea(L) * 0.006, { bottom: polyArea(L), top: polyArea(L) });
}

// 2. the same input, the same mesh
{
  const box = prism([[0, 0], [0.02, 0], [0.02, 0.01], [0, 0.01]], 0, 0.015);
  const run = () => { const S = M.umtSurface(box, { size: 3e-3 }), V = M.umtVolume(S, { size: 3e-3 }); return [Array.from(V.X).join(), Array.from(V.tet).join()].join('|'); };
  check('the same input twice: the same mesh', run() === run());
}

// edges of a tetrahedral mesh against a size field: each edge's length over the size at its middle, and the mean edge in
// 1 mm bands of the distance d(x, y, z) from a source
function edgeStats(X, Y, Z, tet, field, d) {
  const seen = new Set(), ratio = [], bands = [];
  for (let t = 0; t < tet.length / 4; t++) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const a = tet[4 * t + i], b = tet[4 * t + j], k = a < b ? a * 1e7 + b : b * 1e7 + a; if (seen.has(k)) continue; seen.add(k);
    const L = Math.hypot(X[a] - X[b], Y[a] - Y[b], Z[a] - Z[b]), m = [(X[a] + X[b]) / 2, (Y[a] + Y[b]) / 2, (Z[a] + Z[b]) / 2];
    ratio.push(L / field(...m));
    if (d) { const bi = Math.floor(d(...m) / 1e-3); (bands[bi] = bands[bi] || [0, 0]); bands[bi][0] += L; bands[bi][1]++; }
  }
  ratio.sort((a, b) => a - b);
  return { pc: q => ratio[Math.floor(q * (ratio.length - 1))], max: ratio[ratio.length - 1], bands: bands.map(b => b && b[0] / b[1]), edges: ratio.length };
}
/** A tetrahedral mesh (points, tet) through um-core: its quality (each tetrahedron turned positive, the boundary faces found). */
function quality(X, Y, Z, tet0) {
  const tet = Array.from(tet0), nT = tet.length / 4, P = i => [X[i], Y[i], Z[i]];
  const v6 = (a, b, c, d) => { const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]), w = d.map((x, i) => x - a[i]); return u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]); };
  for (let t = 0; t < nT; t++) if (v6(...[0, 1, 2, 3].map(k => P(tet[4 * t + k]))) < 0) [tet[4 * t + 2], tet[4 * t + 3]] = [tet[4 * t + 3], tet[4 * t + 2]];
  const once = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 4; k++) {
    const f = [0, 1, 2, 3].filter(i => i !== k).map(i => tet[4 * t + i]), key = f.slice().sort((a, b) => a - b).join();
    if (once.has(key)) once.delete(key); else once.set(key, v6(...f.map(P), P(tet[4 * t + k])) > 0 ? [f[0], f[2], f[1]] : f);
  }
  const U = UC.umBuild({ X, Y, Z }, Array.from({ length: nT }, (_, i) => ({ t: UC.UM_TET, v: tet.slice(4 * i, 4 * i + 4) })), [...once.values()].map(v => ({ v, tag: 'wall' })));
  return UC.umQuality(U);
}

// 3. a graded size along a line, beside gmsh's mesh of the same
{
  const box = prism([[0, 0], [0.02, 0], [0.02, 0.01], [0, 0.01]], 0, 0.015);
  const H = 3e-3, hl = 0.5e-3, grow = 1.3, field = M.umtSizeField({ h: H, grow, lines: [{ a: [0.01, 0, 0], b: [0.01, 0, 0.015], h: hl }] });
  const d = (x, y) => Math.hypot(x - 0.01, y);
  const { Q, V } = audit('graded: 0.5 mm along a line on the floor, growing 0.3 per unit length to 3 mm', box, field, 3e-6, { bottom: 2e-4, top: 2e-4, side0: 3e-4, side1: 1.5e-4, side2: 3e-4, side3: 1.5e-4 });
  const E = edgeStats(V.X, V.Y, V.Z, V.tet, field, d);
  // (the bands where the size still grows: 0 to 8 mm from the line)
  const bands = E.bands.slice(0, 8), hBand = b => Math.min(H, hl + (grow - 1) * (b + 0.5) * 1e-3);
  const rising = bands.every((m, b) => b === 0 || m > bands[b - 1]), under = bands.every((m, b) => m <= hBand(b));
  check('  the size met: 95 % of edges within 1.25 of the size at their middle, none over 2; the mean edge rising band by band from the line, below the size there',
    E.pc(0.95) <= 1.25 && E.max <= 2 && rising && under,
    `edge / size: median ${E.pc(0.5).toFixed(2)}, 95 % ${E.pc(0.95).toFixed(2)}, max ${E.max.toFixed(2)}; mean edge by mm from the line ${bands.map(m => (m * 1e3).toFixed(2)).join(', ')} mm`);
  const G = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'um-tet-graded', 'gmsh.json'), 'utf8')), Qg = quality(G.X, G.Y, G.Z, G.tet), Eg = edgeStats(G.X, G.Y, G.Z, G.tet, field, d);
  check('  beside gmsh\'s mesh of the same box and size: worst dihedral at least as good, the size kept where gmsh\'s edges pass it',
    Q.tet.dihedralMin >= Qg.tet.dihedralMin && Q.tet.dihedralMax <= Qg.tet.dihedralMax && E.pc(0.95) <= Eg.pc(0.95) && Math.abs(Qg.volumeTotal / 3e-6 - 1) < 1e-12,
    `this: ${Q.cells} cells, dihedral ${Q.tet.dihedralMin.toFixed(1)}–${Q.tet.dihedralMax.toFixed(1)}°, radius ratio ${Q.tet.rhoMin.toFixed(3)}, edge / size median ${E.pc(0.5).toFixed(2)} (95 % ${E.pc(0.95).toFixed(2)}); gmsh ${G.gmsh}: ${Qg.cells} cells, ${Qg.tet.dihedralMin.toFixed(1)}–${Qg.tet.dihedralMax.toFixed(1)}°, ${Qg.tet.rhoMin.toFixed(3)}, median ${Eg.pc(0.5).toFixed(2)} (95 % ${Eg.pc(0.95).toFixed(2)})`);
}

// 4. a size box over the floor's downstream corner
{
  const box = prism([[0, 0], [0.02, 0], [0.02, 0.01], [0, 0.01]], 0, 0.015), B = { min: [0.014, 0, 0], max: [0.02, 0.003, 0.015], h: 0.6e-3 };
  const field = M.umtSizeField({ h: 3e-3, grow: 1.3, boxes: [B] });
  const { V } = audit('a size box: 0.6 mm over the floor\'s downstream corner, 3 mm elsewhere', box, field, 3e-6, { bottom: 2e-4, top: 2e-4, side0: 3e-4, side1: 1.5e-4, side2: 3e-4, side3: 1.5e-4 });
  const inB = (x, y, z) => x >= B.min[0] && x <= B.max[0] && y >= B.min[1] && y <= B.max[1] && z >= B.min[2] && z <= B.max[2];
  const Ein = edgeStats(V.X, V.Y, V.Z, V.tet, field), r = [];
  { const seen = new Set(); for (let t = 0; t < V.tet.length / 4; t++) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const a = V.tet[4 * t + i], b = V.tet[4 * t + j], k = a < b ? a * 1e7 + b : b * 1e7 + a; if (seen.has(k)) continue; seen.add(k);
    const m = [(V.X[a] + V.X[b]) / 2, (V.Y[a] + V.Y[b]) / 2, (V.Z[a] + V.Z[b]) / 2]; if (inB(...m)) r.push(Math.hypot(V.X[a] - V.X[b], V.Y[a] - V.Y[b], V.Z[a] - V.Z[b]) / B.h); } }
  r.sort((a, b) => a - b);
  check('  the size met inside the box: 95 % of its edges within 1.25 of 0.6 mm; over the whole mesh 95 % within 1.25 of the size there',
    r.length > 100 && r[Math.floor(0.95 * (r.length - 1))] <= 1.25 && Ein.pc(0.95) <= 1.25,
    `${r.length} edges in the box: median ${(r[Math.floor(0.5 * (r.length - 1))] * 0.6).toFixed(2)} mm, 95 % ${(r[Math.floor(0.95 * (r.length - 1))] * 0.6).toFixed(2)} mm; the whole mesh's edge / size 95 % ${Ein.pc(0.95).toFixed(2)}`);
}

// 5. the size field itself
{
  const grow = 1.25, F = M.umtSizeField({ h: 4e-3, grow, boxes: [{ min: [0, 0, 0], max: [1e-3, 1e-3, 1e-3], h: 0.2e-3 }], lines: [{ a: [0.01, 0, 0], b: [0.01, 0.01, 0], h: 0.3e-3, r: 0.5e-3 }], points: [{ at: [0, 0.01, 0.01], h: 0.4e-3 }] });
  let slope = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 10000; i++) { const a = [rnd(), rnd(), rnd()].map(v => v * 0.02), b = a.map(v => v + (rnd() - 0.5) * 2e-3), L = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); slope = Math.max(slope, Math.abs(F(...a) - F(...b)) / L); }
  check('the size field: the box\'s size inside it, the line\'s within its radius, the point\'s at it, the size far away; its slope never above grow - 1',
    F(0.5e-3, 0.5e-3, 0.5e-3) === 0.2e-3 && F(0.0104, 0.005, 0) === 0.3e-3 && F(0, 0.01, 0.01) === 0.4e-3 && F(0.02, 0.02, 0.02) === 4e-3 && slope <= grow - 1 + 1e-9,
    `largest slope over 10,000 random pairs ${slope.toFixed(4)} (grow - 1 = ${(grow - 1).toFixed(2)})`);
}

// 6. an open surface refused
{
  const box = prism([[0, 0], [0.02, 0], [0.02, 0.01], [0, 0.01]], 0, 0.015);
  const S = M.umtSurface({ ...box, faces: box.faces.filter(f => f.tag !== 'top') }, { size: 4e-3 });
  let msg = ''; try { M.umtVolume(S, { size: 4e-3 }); } catch (e) { msg = e.message; }
  check('a surface with a face left out: refused, saying it is not closed', /not closed/.test(msg), `"${msg}"`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
