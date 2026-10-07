/*
 * um-tetgeom.validate.js — checks of um-tetgeom.js (the coater's solids for the tetrahedral mesher).
 * Run: node um-tetgeom.validate.js
 *  1. A curve cut into pieces: every point on the curve exactly, none longer than the size, each middle within the chord
 *     tolerance of the curve.
 *  2. The pool with a pipe (round-entry blade R 100 mm, gap 1.725 mm, pile 10 mm, a 4 mm bore in a 6 mm pipe): every
 *     corner of the blade on its underside and every corner of a pipe on its circle, exactly; each curved part's error
 *     (the blade's underside, a pipe's circle) within the bound the chord tolerance sets, and falling with it.
 *  3. Errors said plainly: a pipe outside the pile's surface, a mouth above the pile.
 *  4. The pool meshed (um-tetmesh.js): every tetrahedron positive, closed, the surface kept, the volume the faceted
 *     solid's exactly; the quality limits of um-tetmesh.validate.js (dihedral 15–155°, radius ratio ≥ 0.2); every
 *     patch there, the pipe's wall's area its facets'. Again with the pipe cut finely (61 pieces, 0.31 mm facets beside
 *     a 2 mm size: the size round it held to its facets, else its surface is not recovered).
 *  5. The sizes: under the blade at most the gap over `across`, round the pipe at most the bore over `across`.
 *  6. A shallow crease: the blade's underside meeting the pile's surface at 156° (a pool 14 mm wide, from x −55 to −20 mm,
 *     3 mm, three across the gap -- a case where one tetrahedron takes both faces at the crease, its dihedral there the
 *     crease's, and a point at its middle, as flat as it is, leaves four slivers of 7–8°): no tetrahedron with a face on the
 *     blade and one on the pile; the quality limits of 4.
 *  7. The pool's tetrahedra made quadratic (umtQuadratic, P2, for the solver): straight, the volume the faceted solid's
 *     (to 1e-12); curved -- every node on a curved wall moved onto the true surface (the blade's underside, the pipe's
 *     circles) -- every element positive at the solver's quadrature points, none held short, every wall node on its
 *     surface; the volume the exact solid's: the blade alone to 1e-8 (the facets 2e-4 off), with the pipe falling faster
 *     than the square of the sides round it (13 → 25), every surface triangle a face of its tetrahedron.
 */
const UG = require('../engine/um-tetgeom.js'), M = require('../engine/um-tetmesh.js'), UC = require('../engine/um-core.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

const R = 0.1, Hg = 1.725e-3, bladeY = x => Hg + R - Math.sqrt(R * R - x * x);
const pool = (o = {}) => UG.umgPool({ z0: 0, z1: 0.012, xCut: -0.07, xEnd: -0.002, bladeY, H0: 0.01, outlets: [{ x: -0.055, z: 0.006, ym: 0.005, yIn: 0.013 }], d: 4e-3, Do: 6e-3, size: 4e-3, tol: 0.1e-3, across: 2, ...o });

// 1. a curve in pieces
{
  const size = 1e-3, tol = 5e-6, pts = UG.umgCurve(bladeY, -0.04, 0, size, tol);
  let on = 0, long = 0, sag = 0;
  for (let i = 0; i < pts.length; i++) { if (pts[i][1] !== bladeY(pts[i][0])) on++;
    if (i) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = (a[0] + b[0]) / 2; if (L > size * (1 + 1e-12)) long++;
      sag = Math.max(sag, Math.abs(bladeY(m) - (a[1] + b[1]) / 2) * Math.abs(b[0] - a[0]) / L); } }
  check('a curve in pieces: every point on it exactly, none longer than the size, each middle within the tolerance', on === 0 && long === 0 && sag <= tol,
    `${pts.length} points; the largest middle off the curve ${(sag * 1e6).toFixed(2)} µm (tolerance ${tol * 1e6} µm)`);
}

// 2. the pool's corners on the true surfaces; its volume to the exact one with the tolerance
{
  const P = pool(), G = P.G, xb = -0.002;
  let offBlade = 0, offPipe = 0, nB = 0, nP = 0;
  for (const f of G.faces) for (const L of f.loops) for (const i of L) {
    if (f.tag === 'blade') { nB++; if (G.Y[i] !== bladeY(G.X[i]) && G.Y[i] !== 0.01) offBlade++; }
    if (f.tag === 'pipe-wall' || f.tag === 'bore') { nP++; const r = Math.hypot(G.X[i] + 0.055, G.Z[i] - 0.006), want = f.tag === 'bore' ? 2e-3 : 3e-3; if (Math.abs(r / want - 1) > 1e-14) offPipe++; }
  }
  check('the pool: every corner of the blade on its underside, every corner of a pipe on its circle', offBlade === 0 && offPipe === 0, `${nB} blade corners, ${nP} pipe corners`);
  // (each curved part on its own -- their errors have opposite signs, so together they may cancel: the blade's underside
  //  with no pipes and no size held to the gap, the chords above the convex curve; a pipe's circles, the polygons inside them)
  const tols = [0.4e-3, 0.2e-3, 0.1e-3, 0.05e-3];
  const eB = tols.map(tol => { const Q = pool({ size: 1, tol, outlets: [], across: 1e-9 }); return Math.abs(Q.volumeFacets / Q.volume - 1); });
  const eC = tols.map(tol => { const n = UG.umgCircle(1, 2e-3, tol); return Math.abs(n / 2 * Math.sin(2 * Math.PI / n) / Math.PI - 1); });
  // (a chord's segment is at most 2/3 of its length times its middle's distance from the curve: the blade's error at most
  //  2/3 tol times its run along the web, over the volume's own profile area; a circle's at most 4/3 tol / r of its area)
  const Q0 = pool({ size: 1, tol: 0.4e-3, outlets: [], across: 1e-9 }), run = -0.002 - Q0.xJ, areaP = Q0.volume / 0.012;
  const okB = eB.every((e, i) => e <= 2 / 3 * tols[i] * run / areaP) && eB[3] <= eB[0] / 3.9, okC = eC.every((e, i) => e <= 4 / 3 * tols[i] / 2e-3) && eC[3] <= eC[0] / 3;
  check('  the faceted solid to the exact one: the blade\'s underside and a pipe\'s circle each within the bound the chord tolerance sets, falling with it',
    okB && okC, `the blade: ${eB.map(e => e.toExponential(2)).join(', ')} at 0.4, 0.2, 0.1, 0.05 mm (bound ${tols.map(t => (2 / 3 * t * run / areaP).toExponential(1)).join(', ')}); the bore's area: ${eC.map(e => e.toExponential(2)).join(', ')} (bound ${tols.map(t => (4 / 3 * t / 2e-3).toExponential(1)).join(', ')})`);
  void xb;
}

// 3. errors said plainly
{
  let a = '', b = '';
  try { pool({ outlets: [{ x: -0.03, z: 0.006, ym: 0.005, yIn: 0.013 }] }); } catch (e) { a = e.message; }
  try { pool({ outlets: [{ x: -0.055, z: 0.006, ym: 0.012, yIn: 0.015 }] }); } catch (e) { b = e.message; }
  check('errors said plainly: a pipe under the blade (not in the pile), a mouth above the pile', /not inside the pile's surface/.test(a) && /mouth must be in the paste/.test(b), `"${a}" / "${b}"`);
}

// 4. the pool meshed; again with the pipe cut finely (61 pieces round it, 0.31 mm facets beside a 2 mm size)
for (const [P, label] of [[pool(), 'the pool meshed'], [pool({ tol: 0.004e-3 }), `  with the pipe cut finely (${UG.umgCircle(Infinity, 3e-3, 0.004e-3)} pieces round it)`]]) {
  const t0 = Date.now(), S = M.umtSurface(P.G, { size: P.size }), V = M.umtVolume(S, { size: P.size }), ms = Date.now() - t0, nT = V.tet.length / 4;
  let neg = 0; const Pt = v => [V.X[v], V.Y[v], V.Z[v]];
  for (let t = 0; t < nT; t++) { const [a, b, c, d] = [0, 1, 2, 3].map(k => Pt(V.tet[4 * t + k])), u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i]), w = d.map((x, i) => x - a[i]);
    if (!(u[0] * (v[1] * w[2] - v[2] * w[1]) - u[1] * (v[0] * w[2] - v[2] * w[0]) + u[2] * (v[0] * w[1] - v[1] * w[0]) > 0)) neg++; }
  const U = UC.umBuild({ X: V.X, Y: V.Y, Z: V.Z }, Array.from({ length: nT }, (_, i) => ({ t: UC.UM_TET, v: Array.from(V.tet.subarray(4 * i, 4 * i + 4)) })), Array.from({ length: V.bface.length / 3 }, (_, i) => ({ v: Array.from(V.bface.subarray(3 * i, 3 * i + 3)), tag: V.btag[i] })));
  const G2 = UC.umGeometry(U), Q = UC.umQuality(U, G2);
  const area = {}; for (const p of U.patches) { let A = 0; for (let f = p.start; f < p.start + p.n; f++) A += Math.hypot(G2.fa[3 * f], G2.fa[3 * f + 1], G2.fa[3 * f + 2]); area[p.name] = A; }
  // (the pipe's wall's facets: the outer polygon's perimeter times the height from the mouth to the pile)
  const wall = P.G.faces.filter(f => f.tag === 'pipe-wall').reduce((s, f) => { const [a, b, c] = f.loops[0]; return s + Math.hypot(P.G.X[a] - P.G.X[b], P.G.Z[a] - P.G.Z[b]) * Math.abs(P.G.Y[c] - P.G.Y[b]); }, 0);
  const tags = ['web', 'outlet', 'blade', 'pile', 'inlet', 'side0', 'side1', 'pipe-wall', 'pipe-end', 'bore', 'bore-inlet'];
  check(`${label}: positive, closed, the surface kept, the volume the faceted solid's; dihedral 15–155°, radius ratio ≥ 0.2; every patch there`,
    neg === 0 && Q.opennessMax < 1e-12 && Math.abs(Q.volumeTotal / P.volumeFacets - 1) < 1e-12 && Q.tet.dihedralMin >= 15 && Q.tet.dihedralMax <= 155 && Q.tet.rhoMin >= 0.2 && tags.every(t => area[t] > 0) && U.patches.every(p => p.name !== 'defaultFaces'),
    `${nT} tetrahedra (${ms} ms); volume ${(Q.volumeTotal / P.volumeFacets - 1).toExponential(1)} (the exact solid's ${(Q.volumeTotal / P.volume - 1).toExponential(1)}); dihedral ${Q.tet.dihedralMin.toFixed(1)}–${Q.tet.dihedralMax.toFixed(1)}°, radius ratio ${Q.tet.rhoMin.toFixed(3)}`);
  check('  the pipe\'s wall\'s area its facets\'', Math.abs(area['pipe-wall'] / wall - 1) < 1e-12, `${(area['pipe-wall'] * 1e6).toFixed(4)} mm² (facets ${(wall * 1e6).toFixed(4)} mm²)`);
}

// 5. the sizes under the blade and round the pipe
{
  const P = pool({ size: 1, across: 3 });
  const gap = [-0.03, -0.01, -0.003].every(x => Math.abs(P.size(x, 1e-3, 0.006) - bladeY(x) / 3) < 1e-15);
  const pipe = Math.abs(P.size(-0.055, 0.008, 0.006) - 4e-3 / 3) < 1e-15 && P.size(-0.055, 0.008, 0.006 + 3e-3 + 1e-3) <= 4e-3 / 3 + 0.3 * 1e-3 + 1e-15;
  check('the sizes: under the blade the gap over `across`, round the pipe the bore over `across`, growing away from it', gap && pipe,
    `under the blade at x −30, −10, −3 mm: ${[-0.03, -0.01, -0.003].map(x => (P.size(x, 1e-3, 0.006) * 1e3).toFixed(3)).join(', ')} mm; in the pipe ${(P.size(-0.055, 0.008, 0.006) * 1e3).toFixed(3)} mm`);
}

// 6. a shallow crease
{
  const P = pool({ z1: 0.014, xCut: -0.055, xEnd: -0.02, outlets: [], size: 3e-3, across: 3 }), S = M.umtSurface(P.G, { size: P.size }), V = M.umtVolume(S, { size: P.size }), nT = V.tet.length / 4;
  const slope = -P.xJ / Math.sqrt(R * R - P.xJ * P.xJ), crease = 180 - Math.atan(slope) * 180 / Math.PI;
  const tagOf = new Map(); for (let f = 0; f < V.bface.length / 3; f++) tagOf.set(Array.from(V.bface.subarray(3 * f, 3 * f + 3)).sort((a, b) => a - b).join(','), V.btag[f]);
  let both = 0;
  for (let t = 0; t < nT; t++) { const v = Array.from(V.tet.subarray(4 * t, 4 * t + 4)), tg = new Set();
    for (let k = 0; k < 4; k++) { const g = tagOf.get(v.filter((_, i) => i !== k).sort((a, b) => a - b).join(',')); if (g) tg.add(g); }
    if (tg.has('blade') && tg.has('pile')) both++; }
  const U = UC.umBuild({ X: V.X, Y: V.Y, Z: V.Z }, Array.from({ length: nT }, (_, i) => ({ t: UC.UM_TET, v: Array.from(V.tet.subarray(4 * i, 4 * i + 4)) })), Array.from({ length: V.bface.length / 3 }, (_, i) => ({ v: Array.from(V.bface.subarray(3 * i, 3 * i + 3)), tag: V.btag[i] })));
  const Q = UC.umQuality(U, UC.umGeometry(U));
  check(`a shallow crease (the blade meeting the pile's surface at ${crease.toFixed(1)}°): no tetrahedron on both; positive, closed, the volume the faceted solid's; dihedral 15–155°, radius ratio ≥ 0.2`,
    both === 0 && Q.opennessMax < 1e-12 && Math.abs(Q.volumeTotal / P.volumeFacets - 1) < 1e-12 && Q.tet.dihedralMin >= 15 && Q.tet.dihedralMax <= 155 && Q.tet.rhoMin >= 0.2,
    `${nT} tetrahedra, ${both} on both; dihedral ${Q.tet.dihedralMin.toFixed(1)}–${Q.tet.dihedralMax.toFixed(1)}°, radius ratio ${Q.tet.rhoMin.toFixed(3)}; points put in for creases and slivers ${V.stats.splits}`);
}

// 7. quadratic (P2) tetrahedra on the curved walls
{
  const FE = require('../engine/um-fe.js'), T = FE.ufeTable('tet10', 5, 'tet4');
  const vol = Q => { const { geo } = FE.ufeGeometry(T, Q.X, Q.Y, Q.Z, Q.conn, Q.nE); let v = 0; for (let i = 0; i < Q.nE * T.nq; i++) v += geo[10 * i + 9]; return v; };
  const B = pool({ outlets: [] }), SB = M.umtSurface(B.G, { size: B.size }), VB = M.umtVolume(SB, { size: B.size });
  const Q0 = M.umtQuadratic(VB, {}), QB = M.umtQuadratic(VB, { project: B.project });
  const FT = FE.ufeElement('tet10').faces; let offB = 0, nB = 0;
  for (const fc of QB.faces) if (fc.tag === 'blade') for (const a of FT[fc.f].nodes) { const n = QB.conn[10 * fc.e + a]; offB = Math.max(offB, Math.abs(QB.Y[n] - bladeY(QB.X[n]))); nB++; }
  const e0 = vol(Q0) / B.volumeFacets - 1, eB = vol(QB) / B.volume - 1, eF = B.volumeFacets / B.volume - 1;
  check('quadratic tetrahedra: straight, the faceted solid\'s volume; curved onto the blade, every node on it, positive, the exact solid\'s volume to 1e-8',
    Math.abs(e0) < 1e-12 && Math.abs(eB) < 1e-8 && offB === 0 && QB.limited === 0 && QB.faces.length === VB.bface.length / 3,
    `straight ${e0.toExponential(1)}; curved ${eB.toExponential(1)} (the facets ${eF.toExponential(1)}); ${nB} blade-face nodes, off by ${offB.toExponential(1)} m; ${QB.moved} nodes moved onto the wall (up to ${(QB.maxMove * 1e6).toFixed(1)} µm)`);
  const eP = [0.1e-3, 0.025e-3].map(tol => { const P = pool({ tol }), S = M.umtSurface(P.G, { size: P.size }), V = M.umtVolume(S, { size: P.size }), Q = M.umtQuadratic(V, { project: P.project });
    let offP = 0; for (const fc of Q.faces) if (fc.tag === 'pipe-wall' || fc.tag === 'bore') { const r = fc.tag === 'bore' ? 2e-3 : 3e-3; for (const a of FT[fc.f].nodes) { const n = Q.conn[10 * fc.e + a]; offP = Math.max(offP, Math.abs(Math.hypot(Q.X[n] + 0.055, Q.Z[n] - 0.006) / r - 1)); } }
    return { e: vol(Q) / P.volume - 1, f: P.volumeFacets / P.volume - 1, n: UG.umgCircle(1, 3e-3, tol), offP, limited: Q.limited }; });
  check('  with the pipe: every pipe-wall and bore node on its circle; the volume\'s error falling faster than the square of the sides (13 → 25)',
    eP.every(r => r.offP < 1e-14 && r.limited === 0) && Math.abs(eP[1].e) * Math.pow(eP[1].n / eP[0].n, 2.5) < Math.abs(eP[0].e),
    eP.map(r => `${r.n} sides: ${r.e.toExponential(2)} (facets ${r.f.toExponential(2)}), nodes off their circle ${r.offP.toExponential(1)}`).join('; ') + `; order ${(Math.log(Math.abs(eP[0].e / eP[1].e)) / Math.log(eP[1].n / eP[0].n)).toFixed(2)}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
