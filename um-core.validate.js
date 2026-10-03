/*
 * um-core.validate.js — checks of um-core.js (the unstructured mesh: geometry, quality, export) against exact geometry
 * and against OpenFOAM's own checkMesh.
 * Run: node um-core.validate.js
 *  1. A box of hexahedra (4 × 3 × 2, unequal sides): the volume, every face's area and every patch's exact; every cell
 *     closed; non-orthogonality and skewness zero; the aspect ratio OpenFOAM's formula gives for its cells.
 *  2. The box's cells cut into Kuhn tetrahedra (6 each, a cube's: dihedral angles 45, 60 and 90°; radius ratio
 *     3 r_in / r_circ = 3 (1/2 / (1 + √2)) / (√3/2), by hand) and the regular tetrahedron (radius ratio 1, every
 *     dihedral angle acos(1/3) = 70.529°): the volume still exact, the measures exactly these.
 *  3. A tetrahedral mesh and its polyhedral dual (gmsh's Delaunay cube; OpenFOAM's polyDualMesh: fixtures/um-*-cube):
 *     the counts, the total, smallest and largest volumes, the largest non-orthogonality (and its average), the largest
 *     skewness, aspect ratio and openness -- OpenFOAM checkMesh's own numbers (fixtures/um-*-cube/checkMesh.txt).
 *  4. Round trips: each mesh to OpenFOAM's files and back -- the same points, faces, cells and patches.
 *  5. The 3D page's pool with the tips in the paste (feed-mesh.js, Q2 hexahedra as 8 linear ones): every cell closed, none
 *     inverted, the volume within the curved sides' straightening of the Q2 mesh's own; the boundary closed.
 *  6. VTK and Fluent: the files hold every point, cell and face (counted back from the text); every polyhedron's faces;
 *     every typed cell (hexahedron, tetrahedron) in VTK's right-handed order (its volume by its faces as VTK lists them
 *     positive), whatever order it was given in.
 */
const UC = require('./um-core.js'), fs = require('fs'), path = require('path');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

/** A box of nx × ny × nz hexahedra, Lx × Ly × Lz; or each cut into Kuhn tetrahedra. */
function box(nx, ny, nz, Lx, Ly, Lz, tets) {
  const id = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i, P = [];
  for (let k = 0; k <= nz; k++) for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) P.push([Lx * i / nx, Ly * j / ny, Lz * k / nz]);
  const cells = [], bf = null;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const v = [id(i, j, k), id(i + 1, j, k), id(i + 1, j + 1, k), id(i, j + 1, k), id(i, j, k + 1), id(i + 1, j, k + 1), id(i + 1, j + 1, k + 1), id(i, j + 1, k + 1)];
    if (!tets) { cells.push({ t: UC.UM_HEX, v }); continue; }
    // (the cube's diagonal 0-6; six tetrahedra round it, one per path 0 → 6 along the edges)
    for (const [a, b] of [[1, 2], [2, 3], [3, 7], [7, 4], [4, 5], [5, 1]]) cells.push({ t: UC.UM_TET, v: [v[0], v[a], v[b], v[6]] });
  }
  // (the boundary tagged by where each face is and which way it faces)
  const tag = (c, n) => n[2] < -0.5 ? 'zlo' : n[2] > 0.5 ? 'zhi' : n[1] < -0.5 ? 'web' : n[1] > 0.5 ? 'top' : n[0] < -0.5 ? 'inlet' : 'outlet';
  void bf;
  return UC.umBuild(P, cells, tag, { web: 'wall', top: 'wall', zlo: 'symmetryPlane', zhi: 'symmetryPlane' });
}
const patchArea = (U, G, name) => { const p = U.patches.find(q => q.name === name); let a = 0; for (let f = p.start; f < p.start + p.n; f++) a += Math.hypot(G.fa[3 * f], G.fa[3 * f + 1], G.fa[3 * f + 2]); return a; };
const closure = (U, G) => {
  const s = new Float64Array(3 * U.nC); let worst = 0;
  for (let f = 0; f < U.nF; f++) for (let k = 0; k < 3; k++) { s[3 * U.own[f] + k] += G.fa[3 * f + k]; if (f < U.nIF) s[3 * U.nbr[f] + k] -= G.fa[3 * f + k]; }
  for (let c = 0; c < U.nC; c++) worst = Math.max(worst, Math.hypot(s[3 * c], s[3 * c + 1], s[3 * c + 2]) / Math.cbrt(G.cv[c]) ** 2);
  return worst;
};

// 1. a box of hexahedra
{
  const Lx = 0.02, Ly = 0.009, Lz = 0.004, U = box(4, 3, 2, Lx, Ly, Lz), G = UC.umGeometry(U), Q = UC.umQuality(U, G);
  const dx = Lx / 4, dy = Ly / 3, dz = Lz / 2, arEx = Math.max(Math.max(dx * dy, dy * dz, dx * dz) / Math.min(dx * dy, dy * dz, dx * dz), (2 * (dy * dz + dx * dz + dx * dy)) / 6 / Math.pow(dx * dy * dz, 2 / 3));
  check('a box of hexahedra: the volume, each patch\'s area exact; every cell closed',
    rel(Q.volumeTotal, Lx * Ly * Lz) < 1e-14 && rel(patchArea(U, G, 'web'), Lx * Lz) < 1e-14 && rel(patchArea(U, G, 'inlet'), Ly * Lz) < 1e-14 && rel(patchArea(U, G, 'zhi'), Lx * Ly) < 1e-14 && closure(U, G) < 1e-14,
    `${Q.cells} cells, ${Q.internalFaces} internal of ${Q.faces} faces; volume off ${rel(Q.volumeTotal, Lx * Ly * Lz).toExponential(1)}; worst closure ${closure(U, G).toExponential(1)}`);
  check('a box of hexahedra: no non-orthogonality, no skewness; the aspect ratio OpenFOAM\'s formula gives', Q.nonOrthoMax < 1e-6 && Q.skewnessMax < 1e-12 && rel(Q.aspectMax, arEx) < 1e-12,
    `non-orthogonality ${Q.nonOrthoMax.toExponential(1)}°, skewness ${Q.skewnessMax.toExponential(1)}, aspect ratio ${Q.aspectMax.toFixed(6)} (by hand ${arEx.toFixed(6)})`);
}

// 2. Kuhn tetrahedra; the regular tetrahedron
{
  const U = box(4, 3, 2, 1, 1, 1, true), G = UC.umGeometry(U), Q = UC.umQuality(U, G);
  const cube = box(1, 1, 1, 1, 1, 1, true), Qc = UC.umQuality(cube), rhoK = 3 * (0.5 / (1 + Math.SQRT2)) / (Math.sqrt(3) / 2);
  check('the box in Kuhn tetrahedra: the volume exact, every cell closed and right way out', rel(Q.volumeTotal, 1) < 1e-14 && closure(U, G) < 1e-13 && Q.negativeVolumes === 0,
    `${Q.cells} tetrahedra; volume ${Q.volumeTotal.toPrecision(15)}; worst closure ${closure(U, G).toExponential(1)}`);
  const t = Qc.tet;
  check('a cube\'s Kuhn tetrahedra: radius ratio 3 (½/(1+√2)) / (√3/2) and dihedral angles 45° to 90°, by hand',
    rel(t.rhoMin, rhoK) < 1e-12 && rel(t.rhoMean, rhoK) < 1e-12 && Math.abs(t.dihedralMin - 45) < 1e-9 && Math.abs(t.dihedralMax - 90) < 1e-9,
    `radius ratio ${t.rhoMin.toFixed(12)} (by hand ${rhoK.toFixed(12)}); dihedral ${t.dihedralMin.toFixed(9)}° to ${t.dihedralMax.toFixed(9)}°`);
  const r = UC.umTetQuality([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]), da = Math.acos(1 / 3) * 180 / Math.PI;
  check('the regular tetrahedron: radius ratio 1; every dihedral angle acos(1/3)', Math.abs(r.rho - 1) < 1e-14 && r.dih.every(x => Math.abs(x - da) < 1e-10),
    `radius ratio ${r.rho.toFixed(15)}; dihedral ${r.dih[0].toFixed(10)}° (acos(1/3) = ${da.toFixed(10)}°)`);
}

// 3. against OpenFOAM's checkMesh: a Delaunay cube and its polyhedral dual
const fixture = name => { const dir = path.join(__dirname, 'fixtures', name), T = {}; for (const f of ['points', 'faces', 'owner', 'neighbour', 'boundary']) T[f] = fs.readFileSync(path.join(dir, f), 'utf8'); return { T, log: fs.readFileSync(path.join(dir, 'checkMesh.txt'), 'utf8') }; };
const ofNumbers = log => { const n = re => parseFloat((log.match(re) || [])[1]);
  return { points: n(/points:\s+(\d+)/), faces: n(/^faces:\s+(\d+)/m), internalFaces: n(/internal faces:\s+(\d+)/), cells: n(/cells:\s+(\d+)/),
    opennessMax: n(/Max cell openness = ([-0-9.e+]+)/), aspectMax: n(/Max aspect ratio = ([-0-9.e+]+)/), volumeMin: n(/Min volume = ([-0-9.e+]+)/),
    volumeMax: n(/Max volume = ([-0-9.e+]+)/), volumeTotal: n(/Total volume = ([-0-9.e+]+)/), nonOrthoMax: n(/non-orthogonality Max: ([-0-9.e+]+)/),
    nonOrthoAvg: n(/average: ([-0-9.e+]+)/), skewnessMax: n(/Max skewness = ([-0-9.e+]+)/) }; };
const meshes = {};
for (const [name, label] of [['um-tet-cube', 'the Delaunay cube (gmsh)'], ['um-poly-cube', 'its polyhedral dual (OpenFOAM\'s polyDualMesh)']]) {
  const { T, log } = fixture(name), U = UC.umFromFoam(T), Q = UC.umQuality(U), O = ofNumbers(log);
  meshes[name] = { U, T };
  const counts = ['points', 'faces', 'internalFaces', 'cells'].every(k => Q[k] === O[k]);
  // (OpenFOAM prints 12 significant figures; its openness is round-off, compared as round-off)
  const near = ['volumeMin', 'volumeMax', 'volumeTotal', 'nonOrthoMax', 'nonOrthoAvg', 'skewnessMax', 'aspectMax'].map(k => [k, rel(Q[k], O[k])]);
  const worst = near.reduce((a, b) => (b[1] > a[1] ? b : a));
  check(`${label}: OpenFOAM checkMesh's counts and measures`, counts && worst[1] < 1e-9 && Q.opennessMax < 1e-14 && O.opennessMax < 1e-14,
    `${Q.cells} cells (${Object.entries(Q.types).map(([t, n]) => `${n} of type ${t}`).join(', ')}); largest difference ${worst[0]} ${worst[1].toExponential(1)}; non-orthogonality ${Q.nonOrthoMax.toFixed(6)}° (OpenFOAM ${O.nonOrthoMax}), skewness ${Q.skewnessMax.toFixed(6)} (${O.skewnessMax}), aspect ${Q.aspectMax.toFixed(6)} (${O.aspectMax})`);
}
{
  const Q = UC.umQuality(meshes['um-poly-cube'].U), Qt = UC.umQuality(meshes['um-tet-cube'].U);
  check('the dual\'s polyhedra one per tetrahedral mesh point, their faces counted; the tetrahedra\'s radius ratios and angles',
    Q.poly && Q.poly.n === Qt.points && Q.poly.facesMin >= 4 && Qt.tet && Qt.tet.n === Qt.cells && Qt.tet.rhoMin > 0 && Qt.tet.dihedralMin > 0 && Qt.tet.dihedralMax < 180,
    `${Q.poly.n} polyhedra, ${Q.poly.facesMin} to ${Q.poly.facesMax} faces (mean ${Q.poly.facesMean.toFixed(1)}); tetrahedra: radius ratio ${Qt.tet.rhoMin.toFixed(3)} worst, ${Qt.tet.rhoMean.toFixed(3)} mean; dihedral ${Qt.tet.dihedralMin.toFixed(1)}° to ${Qt.tet.dihedralMax.toFixed(1)}°`);
}

// 4. round trips through OpenFOAM's files
const same = (A, B) => A.nP === B.nP && A.nF === B.nF && A.nIF === B.nIF && A.nC === B.nC &&
  A.fV.length === B.fV.length && A.fV.every((v, i) => v === B.fV[i]) && A.own.every((v, i) => v === B.own[i]) && A.nbr.every((v, i) => v === B.nbr[i]) &&
  ['X', 'Y', 'Z'].every(k => A[k].every((v, i) => Math.abs(v - B[k][i]) <= 1e-14 * Math.max(1, Math.abs(v)))) &&
  A.patches.length === B.patches.length && A.patches.every((p, i) => p.name === B.patches[i].name && p.type === B.patches[i].type && p.start === B.patches[i].start && p.n === B.patches[i].n);
{
  const H = box(4, 3, 2, 0.02, 0.009, 0.004), K = box(3, 2, 2, 1, 1, 1, true), Pm = meshes['um-poly-cube'].U;
  const rt = U => UC.umFromFoam(UC.umToFoam(U));
  check('round trips through OpenFOAM\'s files: the hexahedra, the tetrahedra, the polyhedra the same', same(H, rt(H)) && same(K, rt(K)) && same(Pm, rt(Pm)),
    `${H.nC} hexahedra, ${K.nC} tetrahedra, ${Pm.nC} polyhedra: points, faces, owners, neighbours and patches`);
}

// 5. the 3D page's pool with the tips in the paste
{
  const FM = require('./feed-mesh.js'), R = 0.1, H = 1.725e-3, blade = x => H + R - Math.sqrt(Math.max(0, R * R - x * x));
  const o = { W: 0.3, half: true, d: 0.01, t: 0.002, xCut: -0.13, xEnd: -0.04, bladeY: blade, H0: 0.0375, film0: 0,
    outlets: [37.5, 112.5, 187.5, 262.5].map(z => ({ z: z / 1000, ym: 0.03, yIn: 0.05 })), xP: -0.1, m: 4, nLo: 4, nUp: 4, hFar: 0.02 };
  const M = FM.fmMesh(o), S = FM.fmStats(M), U = UC.umFromFm(M, { web: 'wall', blade: 'wall', side0: 'wall', pipeOut: 'wall', pipeEnd: 'wall', pipeInner: 'wall', sym: 'symmetryPlane' });
  const G = UC.umGeometry(U), Q = UC.umQuality(U, G);
  const bc = [0, 0, 0]; for (let f = U.nIF; f < U.nF; f++) for (let k = 0; k < 3; k++) bc[k] += G.fa[3 * f + k];
  const bA = U.patches.reduce((s, p) => s + patchArea(U, G, p.name), 0);
  check('the 3D page\'s pool (Q2 hexahedra as 8 linear ones): every cell closed, none inverted; the volume the Q2 mesh\'s to the straightened sides; the boundary closed',
    Q.negativeVolumes === 0 && closure(U, G) < 1e-12 && rel(Q.volumeTotal, S.volume) < 2e-3 && Math.hypot(...bc) / bA < 1e-14,
    `${M.nE} Q2 → ${Q.cells} hexahedra, ${U.patches.length} patches; volume ${(Q.volumeTotal * 1e6).toFixed(3)} cm³ against ${(S.volume * 1e6).toFixed(3)} (${(rel(Q.volumeTotal, S.volume) * 100).toFixed(3)} %); non-orthogonality ${Q.nonOrthoMax.toFixed(1)}° max, ${Q.nonOrthoAvg.toFixed(1)}° mean; skewness ${Q.skewnessMax.toFixed(2)}`);
  meshes.pool = { U };
}

// 6. VTK and Fluent: everything written
{
  const Pm = meshes['um-poly-cube'].U, K = box(3, 2, 2, 1, 1, 1, true);
  const vtu = UC.umToVTK(Pm), vt = UC.umToVTK(K);
  const da = (x, n) => { const m = x.match(new RegExp(`Name="${n}"[^>]*>\\s*([^<]*)<`)); return m ? m[1].trim().split(/\s+/).map(Number) : []; };
  const pf = da(vtu, 'faces'), pfo = da(vtu, 'faceoffsets');
  let ok = da(vtu, 'types').length === Pm.nC && da(vtu, 'types').every(t => t === UC.UM_POLY) && da(vtu, 'Points').length === 3 * Pm.nP && pfo.length === Pm.nC && pfo[pfo.length - 1] === pf.length;
  // (each polyhedron's faces counted back: every face once from each side)
  let nFaces = 0; for (let c = 0, i = 0; c < Pm.nC; c++) { const k = pf[i++]; nFaces += k; for (let j = 0; j < k; j++) i += pf[i] + 1; }
  ok = ok && nFaces === 2 * Pm.nIF + (Pm.nF - Pm.nIF) && da(vt, 'types').every(t => t === UC.UM_TET) && da(vt, 'connectivity').length === 4 * K.nC;
  const msh = UC.umToFluent(Pm), lines = msh.split('\n');
  const hdr = lines.filter(l => /^\(13 \([0-9a-f]+ [0-9a-f]+ [0-9a-f]+ [0-9a-f]+ 0\)\($/.test(l)), nWritten = hdr.reduce((s, l) => { const [, , a, b] = l.match(/\(13 \(([0-9a-f]+) ([0-9a-f]+) ([0-9a-f]+)/); return s + parseInt(b, 16) - parseInt(a, 16) + 1; }, 0);
  ok = ok && nWritten === Pm.nF && msh.includes(`(10 (0 1 ${Pm.nP.toString(16)} 0 3))`) && msh.includes(`(12 (0 1 ${Pm.nC.toString(16)} 0))`);
  check('VTK (.vtu) and Fluent (.msh): every point, cell and face written; each polyhedron with its faces', ok,
    `.vtu ${(vtu.length / 1024).toFixed(0)} KB (${Pm.nC} polyhedra, ${nFaces} cell faces); .msh ${(msh.length / 1024).toFixed(0)} KB (${hdr.length} face zones, ${nWritten} faces)`);
}

{
  // (a typed cell's volume by its faces as VTK lists them: positive for VTK's right-handed order)
  const vtkVol = (U, c) => { const t = U.cType[c], v = Array.from(U.cV.subarray(U.cOff[c], U.cOff[c + 1])); let V = 0;
    for (const f of UC.UM_FACES[t]) { const g = UC.umFace(i => [U.X[v[f[i]]], U.Y[v[f[i]]], U.Z[v[f[i]]]], f.length); V += (g.a[0] * g.c[0] + g.a[1] * g.c[1] + g.a[2] * g.c[2]) / 3; } return V; };
  // (the same cube's Kuhn tetrahedra given left-handed: every one mirrored)
  const mir = box(2, 2, 2, 1, 1, 1, true), cells = [];
  for (let c = 0; c < mir.nC; c++) { const v = Array.from(mir.cV.subarray(mir.cOff[c], mir.cOff[c + 1])); cells.push({ t: UC.UM_TET, v: [v[0], v[2], v[1], v[3]] }); }
  const L = UC.umBuild({ X: mir.X, Y: mir.Y, Z: mir.Z }, cells, (c, n) => 'wall');
  const all = (U) => { let worst = Infinity; for (let c = 0; c < U.nC; c++) worst = Math.min(worst, vtkVol(U, c)); return worst; };
  const sets = [['the pool\'s hexahedra', meshes.pool.U], ['the Delaunay cube\'s tetrahedra (read from OpenFOAM)', meshes['um-tet-cube'].U], ['tetrahedra given left-handed', L]];
  check('every typed cell in VTK\'s right-handed order (its volume by VTK\'s faces positive), whatever order it came in', sets.every(([, U]) => all(U) > 0),
    sets.map(([n, U]) => `${n}: smallest ${all(U).toExponential(2)} m³`).join('; '));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
