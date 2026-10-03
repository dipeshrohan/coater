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
 */
const M = require('./um-tetmesh.js'), UC = require('./um-core.js'), fs = require('fs'), path = require('path');
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

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
