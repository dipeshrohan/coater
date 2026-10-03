/*
 * um-tetlayers.validate.js — checks of um-tetlayers.js (prism layers on walls under the tetrahedral mesh).
 * Run: node um-tetlayers.validate.js
 *  1. A box 20 × 10 × 15 mm, three layers on its floor (0.05 mm, ×1.3): each layer's top exactly at its height (0.05,
 *     0.115, 0.1995 mm); three wedges on each of the floor's triangles; the layers' volume the floor's area times their
 *     thickness; every layer side on its face's plane; all cells positive, the mesh closed, its volume the box's, every
 *     patch there; the tetrahedra within the mesher's limits (dihedral 15–155°, radius ratio ≥ 0.2).
 *  2. A 2 mm channel, layers on its floor and its ceiling: 0.6 mm each meshed (the same checks); thicker than leaves a
 *     quarter of the size between them refused, saying how much room is left; thicker than the gap refused as overlapping;
 *     a wall in two groups, two groups at one point refused.
 *  3. The pool (round-entry blade, a pipe): layers at the web and at the blade and surface (the app's two groups, 3 from
 *     0.05 mm ×1.3): positive, closed, the volume the faceted solid's, every patch; the web's layers exactly as high, their
 *     volume the web's area times their thickness; the blade's along its true normal to 1e-5; OpenFOAM's limits
 *     (non-orthogonality under 70°, skewness under 4); the tetrahedra within the mesher's limits. Then the pipes' walls
 *     with layers too: on the bore and the outer wall alone refused (they meet the pipe's end at convex edges, where the
 *     layers would end in the open), with the end layered too accepted; every face's area as it was.
 */
const M = require('./um-tetmesh.js'), L = require('./um-tetlayers.js'), UC = require('./um-core.js'), UG = require('./um-tetgeom.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const build = R => {
  const cells = []; for (let i = 0; i < R.tet.length / 4; i++) cells.push({ t: UC.UM_TET, v: Array.from(R.tet.subarray(4 * i, 4 * i + 4)) });
  for (let i = 0; i < R.wedge.length / 6; i++) cells.push({ t: UC.UM_WEDGE, v: Array.from(R.wedge.subarray(6 * i, 6 * i + 6)) });
  const U = UC.umBuild({ X: R.X, Y: R.Y, Z: R.Z }, cells, R.bface.map((v, i) => ({ v, tag: R.btag[i] }))), G = UC.umGeometry(U);
  return { U, G, Q: UC.umQuality(U, G) };
};
// (a wedge's volume, by its faces from their middles)
const wedgeVol = (R, i) => { const w = Array.from(R.wedge.subarray(6 * i, 6 * i + 6)), P = k => [R.X[k], R.Y[k], R.Z[k]];
  const tv = (a, b, c) => (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  const face = f => { const q = f.map(P); if (q.length === 3) return tv(q[0], q[1], q[2]); const m = [0, 1, 2].map(d => (q[0][d] + q[1][d] + q[2][d] + q[3][d]) / 4); let v = 0; for (let j = 0; j < 4; j++) v += tv(m, q[j], q[(j + 1) % 4]); return v; };
  return face([w[0], w[1], w[2]]) + face([w[3], w[5], w[4]]) + face([w[0], w[3], w[4], w[1]]) + face([w[1], w[4], w[5], w[2]]) + face([w[2], w[5], w[3], w[0]]); };
const limits = Q => Q.tet.dihedralMin >= 15 && Q.tet.dihedralMax <= 155 && Q.tet.rhoMin >= 0.2;
const box = (h, tags) => ({ X: [0, 0.02, 0.02, 0, 0, 0.02, 0.02, 0], Y: [0, 0, h, h, 0, 0, h, h], Z: [0, 0, 0, 0, 0.015, 0.015, 0.015, 0.015],
  faces: [{ loops: [[0, 3, 2, 1]], tag: 'back' }, { loops: [[4, 5, 6, 7]], tag: 'front' }, { loops: [[0, 1, 5, 4]], tag: 'floor' }, { loops: [[3, 7, 6, 2]], tag: tags }, { loops: [[0, 4, 7, 3]], tag: 'left' }, { loops: [[1, 2, 6, 5]], tag: 'right' }] });

// 1. the box
{
  const size = 2.5e-3, S = M.umtSurface(box(0.01, 'top'), { size }), t0 = Date.now(), R = L.umlMesh(S, [{ tags: ['floor'], n: 3, first: 0.05e-3, growth: 1.3 }], { size }), ms = Date.now() - t0;
  const want = [0, 0.05e-3, 0.115e-3, 0.1995e-3];
  let off = 0; for (let i = 0; i < R.wedge.length / 6; i++) { const k = i % 3; for (let j = 0; j < 3; j++) { off = Math.max(off, Math.abs(R.Y[R.wedge[6 * i + j]] - want[k]), Math.abs(R.Y[R.wedge[6 * i + 3 + j]] - want[k + 1])); } }
  const floorFaces = R.btag.filter(t => t === 'floor').length;
  let vl = 0; for (let i = 0; i < R.wedge.length / 6; i++) vl += wedgeVol(R, i);
  // (each layer side on its plane: x = 0 or 20 mm, z = 0 or 15 mm)
  let offPlane = 0, sides = 0; R.bface.forEach((f, i) => { if (f.length !== 4) return; sides++; const xs = f.map(p => R.X[p]), zs = f.map(p => R.Z[p]);
    if (!(xs.every(x => x === xs[0]) && (xs[0] === 0 || xs[0] === 0.02)) && !(zs.every(z => z === zs[0]) && (zs[0] === 0 || zs[0] === 0.015))) offPlane++; });
  const { U, Q } = build(R);
  check('a box, three layers on its floor: each layer\'s top exactly at its height; three wedges on each floor triangle; the layers\' volume the floor\'s area times their thickness',
    off < 1e-18 && R.wedge.length / 6 === 3 * floorFaces && Math.abs(vl / (0.02 * 0.015 * 0.1995e-3) - 1) < 1e-12,
    `${R.wedge.length / 6} wedges on ${floorFaces} floor triangles (${ms} ms); heights off by ${off.toExponential(1)} m; layers' volume ${(vl / (0.02 * 0.015 * 0.1995e-3) - 1).toExponential(1)} off`);
  check('  every layer side on its face\'s plane; positive, closed, the volume the box\'s, every patch; the tetrahedra within the mesher\'s limits',
    offPlane === 0 && sides > 0 && Q.negativeVolumes === 0 && Q.opennessMax < 1e-12 && Math.abs(Q.volumeTotal / (0.02 * 0.01 * 0.015) - 1) < 1e-12 && ['floor', 'top', 'left', 'right', 'back', 'front'].every(t => U.patches.some(p => p.name === t && p.n > 0)) && limits(Q),
    `${sides} layer sides, ${offPlane} off their plane; volume ${(Q.volumeTotal / (0.02 * 0.01 * 0.015) - 1).toExponential(1)}; ${R.tet.length / 4} tetrahedra, dihedral ${Q.tet.dihedralMin.toFixed(1)}–${Q.tet.dihedralMax.toFixed(1)}°, radius ratio ${Q.tet.rhoMin.toFixed(3)}`);
}

// 2. a 2 mm channel, layers on both walls
{
  const size = 1e-3, S = M.umtSurface(box(0.002, 'ceiling'), { size }), sp = T => { const first = T * 0.3 / (Math.pow(1.3, 3) - 1); return [{ tags: ['floor'], n: 3, first, growth: 1.3 }, { tags: ['ceiling'], n: 3, first, growth: 1.3 }]; };
  const R = L.umlMesh(S, sp(0.6e-3), { size }), { Q } = build(R);
  const msg = T => { try { L.umlMesh(S, sp(T), { size }); return ''; } catch (e) { return e.message; } };
  const a = msg(0.9e-3), b = msg(2.5e-3);
  let c = '', d = '';
  try { L.umlMesh(S, [{ tags: ['floor', 'left'], n: 2, first: 1e-4, growth: 1.2 }, { tags: ['left'], n: 2, first: 1e-4, growth: 1.2 }], { size }); } catch (e) { c = e.message; }
  try { L.umlMesh(S, [{ tags: ['floor'], n: 2, first: 1e-4, growth: 1.2 }, { tags: ['left'], n: 2, first: 1e-4, growth: 1.2 }], { size }); } catch (e) { d = e.message; }
  check('a 2 mm channel, 0.6 mm of layers on each wall: positive, closed, the volume the channel\'s; the tetrahedra within the limits',
    Q.negativeVolumes === 0 && Q.opennessMax < 1e-12 && Math.abs(Q.volumeTotal / (0.02 * 0.002 * 0.015) - 1) < 1e-12 && limits(Q),
    `${R.wedge.length / 6} wedges, ${R.tet.length / 4} tetrahedra; dihedral ${Q.tet.dihedralMin.toFixed(1)}–${Q.tet.dihedralMax.toFixed(1)}°`);
  check('  refused plainly: 0.9 mm each (0.2 mm left, under a quarter of the size), 2.5 mm each (overlapping), a wall in two groups, two groups at a point',
    /leave 0\.200 mm .* less than a quarter of the element size/.test(a) && /overlap/.test(b) && /in two layer groups/.test(c) && /two layer groups meet at/.test(d), `"${a.slice(14, 120)}…" / "${b.slice(14, 110)}…"`);
}

// 3. the pool
{
  const R0 = 0.1, Hg = 1.725e-3, bladeY = x => Hg + R0 - Math.sqrt(R0 * R0 - x * x), W = 0.012;
  const P = UG.umgPool({ z0: 0, z1: W, xCut: -0.07, xEnd: -0.002, bladeY, H0: 0.01, outlets: [{ x: -0.055, z: 0.006, ym: 0.005, yIn: 0.013 }], d: 4e-3, Do: 6e-3, size: 4e-3, tol: 0.1e-3, across: 2 });
  const S = M.umtSurface(P.G, { size: P.size }), lay = { n: 3, first: 0.05e-3, growth: 1.3 }, T = 0.1995e-3;
  const t0 = Date.now(), R = L.umlMesh(S, [{ tags: ['web'], ...lay }, { tags: ['blade', 'pile'], ...lay }], { size: P.size }), ms = Date.now() - t0, { U, Q } = build(R);
  // (the web's wedges: their corners' heights; their volume)
  let offW = 0, vw = 0; const want = [0, 0.05e-3, 0.115e-3, 0.1995e-3];
  R.wedgeTag.forEach((t, i) => { if (t !== 'web') return; const k = [0, 1, 2].map(j => R.Y[R.wedge[6 * i + j]]), lev = want.findIndex(h => Math.abs(h - k[0]) < 1e-12);
    for (let j = 0; j < 3; j++) offW = Math.max(offW, Math.abs(R.Y[R.wedge[6 * i + j]] - want[lev]), Math.abs(R.Y[R.wedge[6 * i + 3 + j]] - want[lev + 1])); vw += wedgeVol(R, i); });
  const webArea = (-0.002 + 0.07) * W;
  // (the blade's: each wall point inside the blade, its top along the true normal at the sum of the heights)
  const Ls = L.umlLayers(S, [{ tags: ['web'], ...lay }, { tags: ['blade', 'pile'], ...lay }], { size: P.size });
  let offB = 0, nB = 0;
  Ls.stack.forEach((st, v) => { if (!st) return; const x = Ls.X[v], y = Ls.Y[v], z = Ls.Z[v];
    if (!(Math.abs(y - bladeY(x)) < 1e-12 && x > P.xJ + 1e-3 && x < -0.003 && z > 1e-6 && z < W - 1e-6)) return;
    const g = -x / Math.sqrt(R0 * R0 - x * x), l = Math.hypot(g, 1), n = [-g / l, -1 / l];
    for (let k = 1; k < st.length; k++) { const h = (Ls.X[st[k]] - x) * n[0] + (Ls.Y[st[k]] - y) * n[1]; offB = Math.max(offB, Math.abs(h / want[k] - 1)); } nB++; });
  check('the pool, layers at the web and at the blade and surface: positive, closed, the volume the faceted solid\'s, every patch; the tetrahedra within the limits',
    Q.negativeVolumes === 0 && Q.opennessMax < 1e-12 && Math.abs(Q.volumeTotal / P.volumeFacets - 1) < 1e-12 && ['web', 'outlet', 'blade', 'pile', 'inlet', 'side0', 'side1', 'pipe-wall', 'pipe-end', 'bore', 'bore-inlet'].every(t => U.patches.some(p => p.name === t && p.n > 0)) && limits(Q),
    `${R.wedge.length / 6} wedges, ${R.tet.length / 4} tetrahedra (${ms} ms); volume ${(Q.volumeTotal / P.volumeFacets - 1).toExponential(1)}; dihedral ${Q.tet.dihedralMin.toFixed(1)}–${Q.tet.dihedralMax.toFixed(1)}°, radius ratio ${Q.tet.rhoMin.toFixed(3)}`);
  check('  the web\'s layers exactly as high, their volume its area times their thickness; the blade\'s along its true normal to 1e-5',
    offW < 1e-18 && Math.abs(vw / (webArea * T) - 1) < 1e-12 && nB > 50 && offB < 1e-5, `web heights off ${offW.toExponential(1)} m, volume ${(vw / (webArea * T) - 1).toExponential(1)}; ${nB} blade points, heights off ${offB.toExponential(1)}`);
  check('  OpenFOAM\'s limits: non-orthogonality under 70°, skewness under 4', Q.nonOrthoMax < 70 && Q.skewnessMax < 4, `non-orthogonality ${Q.nonOrthoMax.toFixed(1)}° (mean ${Q.nonOrthoAvg.toFixed(1)}°), skewness ${Q.skewnessMax.toFixed(2)}, aspect ${Q.aspectMax.toFixed(1)}`);
  // (the pipe's walls: its bore and outer wall meet its end at convex edges -- layers on them alone would end in the open
  //  there, their sides walled off as the end; refused, and with the end layered too they turn the corner)
  let refused = ''; try { L.umlMesh(S, [{ tags: ['web'], ...lay }, { tags: ['blade', 'pile', 'pipe-wall', 'bore'], ...lay }], { size: P.size }); } catch (e) { refused = e.message; }
  const R2 = L.umlMesh(S, [{ tags: ['web'], ...lay }, { tags: ['blade', 'pile', 'pipe-wall', 'pipe-end', 'bore'], ...lay }], { size: P.size }), B2 = build(R2);
  // (every face's area as it was: a layer's side lies on the face it meets, never beyond it)
  const areas = (X, Y, Z, faces, tags) => { const A = {}; faces.forEach((f, i) => { const q = f.map(k => [X[k], Y[k], Z[k]]); let a = 0;
    for (let j = 1; j + 1 < q.length; j++) { const u = [0, 1, 2].map(c => q[j][c] - q[0][c]), w = [0, 1, 2].map(c => q[j + 1][c] - q[0][c]); a += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; }
    A[tags[i]] = (A[tags[i]] || 0) + a; }); return A; };
  const A0 = areas(S.X, S.Y, S.Z, Array.from({ length: S.tri.length / 3 }, (_, i) => [S.tri[3 * i], S.tri[3 * i + 1], S.tri[3 * i + 2]]), S.tag);
  const offA = R0_ => { const A1 = areas(R0_.X, R0_.Y, R0_.Z, R0_.bface, R0_.btag); return Math.max(...Object.keys(A0).map(t => Math.abs((A1[t] || 0) / A0[t] - 1))); };
  const aOff = Math.max(offA(R), offA(R2));
  check('  the pipes\' walls with layers too: alone refused (they would end in the open at the pipe\'s end); with its end, turning the corner: positive, closed, the volume the faceted solid\'s; every face\'s area as it was; the limits',
    /convex edge/.test(refused) && B2.Q.negativeVolumes === 0 && B2.Q.opennessMax < 1e-12 && Math.abs(B2.Q.volumeTotal / P.volumeFacets - 1) < 1e-12 && aOff < 1e-12 && limits(B2.Q) && B2.Q.nonOrthoMax < 70 && B2.Q.skewnessMax < 4,
    `"${refused.replace(/^um-tetlayers: /, '')}"; ${R2.wedge.length / 6} wedges (${R2.wedgeTag.filter(t => ['pipe-wall', 'pipe-end', 'bore'].includes(t)).length} on the pipe), ${R2.tet.length / 4} tetrahedra; areas off ${aOff.toExponential(1)}; non-orthogonality ${B2.Q.nonOrthoMax.toFixed(1)}°, skewness ${B2.Q.skewnessMax.toFixed(2)}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
