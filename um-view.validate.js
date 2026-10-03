/*
 * um-view.validate.js — checks of um-view.js (the mesh viewer's drawing) on hexahedra, tetrahedra and polyhedra.
 * Run: node um-view.validate.js
 *  1. Whole, cut at the middle on each axis (either side kept), and shrunk: the triangles drawn make closed surfaces facing
 *     out, enclosing exactly the kept cells' volume (the divergence theorem over the triangles: V = ⅓ ∮ x · n dA); shrunk
 *     to s, each drawn cell's own volume times s³.
 *  2. The cut keeps exactly the cells whose centres lie on its side; the faces drawn are those between a kept cell and
 *     anything else, counted by hand, each face drawn once; on flat faces, each face's triangles sum to its own area.
 *  (The positions are drawn in single precision: volumes and areas to about 1e-7.)
 *  3. The histograms count every cell once; the worst cell's value is the mesh's worst (checkMesh's).
 */
const UC = require('./um-core.js'), UV = require('./um-view.js'), fs = require('fs'), path = require('path');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const fixture = name => { const dir = path.join(__dirname, 'fixtures', name), T = {}; for (const f of ['points', 'faces', 'owner', 'neighbour', 'boundary']) T[f] = fs.readFileSync(path.join(dir, f), 'utf8'); return UC.umFromFoam(T); };
/** A box of hexahedra with one corner pulled out (so its cells are not all alike). */
function hexBox(n = 4) {
  const id = (i, j, k) => (k * (n + 1) + j) * (n + 1) + i, X = [], Y = [], Z = [];
  for (let k = 0; k <= n; k++) for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const t = i * j * k / n ** 3; X.push(2e-3 * i / n + 3e-4 * t); Y.push(1e-3 * j / n); Z.push(1.5e-3 * k / n + 2e-4 * t); }
  const cells = [];
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells.push({ t: UC.UM_HEX, v: [id(i, j, k), id(i + 1, j, k), id(i + 1, j + 1, k), id(i, j + 1, k), id(i, j, k + 1), id(i + 1, j, k + 1), id(i + 1, j + 1, k + 1), id(i, j + 1, k + 1)] });
  return UC.umBuild({ X, Y, Z }, cells, (c, nrm) => (Math.abs(nrm[0]) > 0.9 ? 'x' : Math.abs(nrm[1]) > 0.9 ? 'y' : 'z'));
}
/** The volume the triangles enclose (mm³ → m³) and their summed area vector (closed: zero). */
function enclosed(A) {
  let V = 0, S = [0, 0, 0], area = 0;
  for (let t = 0; t < A.pos.length; t += 9) {
    const p = [0, 1, 2].map(k => [A.pos[t + 3 * k] / 1e3, A.pos[t + 3 * k + 1] / 1e3, A.pos[t + 3 * k + 2] / 1e3]);
    const u = [0, 1, 2].map(d => p[1][d] - p[0][d]), v = [0, 1, 2].map(d => p[2][d] - p[0][d]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];   // twice the area vector
    const c = [0, 1, 2].map(d => (p[0][d] + p[1][d] + p[2][d]) / 3);
    V += (c[0] * n[0] + c[1] * n[1] + c[2] * n[2]) / 6; for (let d = 0; d < 3; d++) S[d] += n[d] / 2; area += Math.hypot(...n) / 2;
  }
  return { V, S: Math.hypot(...S), area };
}

const meshes = [['hexahedra (a box, one corner pulled)', hexBox()], ['tetrahedra (gmsh\'s Delaunay cube)', fixture('um-tet-cube')], ['polyhedra (its dual)', fixture('um-poly-cube')]];
for (const [label, U] of meshes) {
  const V = UV.umvPrepare(U), cv = V.G.cv;
  let wV = 0, wS = 0, wA = 0, wSel = 0, nCase = 0, nFlat = 0;
  const cuts = [null]; for (let a = 0; a < 3; a++) for (const keep of [-1, 1]) cuts.push({ axis: a, at: (V.lo[a] + V.hi[a]) / 2, keep });
  for (const cut of cuts) {
    const sel = UV.umvSelect(V, cut), A = UV.umvArrays(V, { cut, colour: 'nonOrtho', trace: true }), E = enclosed(A);
    // (each face's triangles summed against its area vector; the faces between a kept cell and anything else, by hand)
    const sum = new Map();
    for (let t = 0; t < A.triFace.length; t++) {
      const p = [0, 1, 2].map(k => [0, 1, 2].map(d => A.pos[9 * t + 3 * k + d] / 1e3)), u = [0, 1, 2].map(d => p[1][d] - p[0][d]), v = [0, 1, 2].map(d => p[2][d] - p[0][d]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], f = A.triFace[t], a = sum.get(f) || [0, 0, 0];
      for (let d = 0; d < 3; d++) a[d] += n[d] / 2; sum.set(f, a);
    }
    // (a flat face, its points within 1e-9 of their plane: its triangles' area its own)
    for (const [f, a] of sum) {
      const A0 = Math.hypot(V.G.fa[3 * f], V.G.fa[3 * f + 1], V.G.fa[3 * f + 2]), nn = [0, 1, 2].map(d => V.G.fa[3 * f + d] / A0);
      let flat = true; for (let i = U.fOff[f]; i < U.fOff[f + 1]; i++) { const v = U.fV[i]; if (Math.abs(nn[0] * (U.X[v] - V.G.fc[3 * f]) + nn[1] * (U.Y[v] - V.G.fc[3 * f + 1]) + nn[2] * (U.Z[v] - V.G.fc[3 * f + 2])) > 1e-9 * Math.sqrt(A0)) flat = false; }
      if (flat) { wA = Math.max(wA, Math.abs(Math.hypot(...a) / A0 - 1)); nFlat++; }
    }
    let nf = 0; for (let f = 0; f < U.nF; f++) if (f < U.nIF ? sel[U.own[f]] !== sel[U.nbr[f]] : sel[U.own[f]]) nf++;
    wSel = Math.max(wSel, Math.abs(nf - A.faces), Math.abs(sum.size - nf));
    let Vk = 0; for (let c = 0; c < U.nC; c++) if (sel[c]) Vk += cv[c];
    // (the kept cells: those whose centres are on the cut's side, counted by hand)
    let k = 0; for (let c = 0; c < U.nC; c++) { const x = V.G.cc[3 * c + (cut ? cut.axis : 0)]; if (!cut || (cut.keep > 0 ? x >= cut.at : x <= cut.at)) k++; }
    wSel = Math.max(wSel, Math.abs(k - A.kept));
    wV = Math.max(wV, Math.abs(E.V / Vk - 1)); wS = Math.max(wS, E.S / E.area); nCase++;
  }
  check(`${label}: whole and cut on each axis, either side kept: closed surfaces facing out, enclosing the kept cells' volume exactly`, wV < 1e-6 && wS < 1e-6 && wSel === 0,
    `${nCase} views; volume ${wV.toExponential(1)}, open ${wS.toExponential(1)} (relative)`);
  check(`  the faces drawn: exactly those between a kept cell and anything else, each once; a flat face's triangles its own area`, wA < 1e-5 && wSel === 0, `${nFlat} flat faces drawn, area within ${wA.toExponential(1)}`);
  // shrunk: each cell on the surface drawn closed at s³ its volume
  const s = 0.7, A = UV.umvArrays(V, { shrink: s, colour: 'type' }), E = enclosed(A), A1 = UV.umvArrays(V, {});
  let Vs = 0; const on = new Uint8Array(U.nC); for (let f = U.nIF; f < U.nF; f++) on[U.own[f]] = 1; for (let c = 0; c < U.nC; c++) if (on[c]) Vs += cv[c] * s ** 3;
  check(`  shrunk to 70 %: every cell on the surface drawn whole, closed, at 0.7³ its volume`, Math.abs(E.V / Vs - 1) < 1e-6 && A.cells === A1.cells, `${A.cells} cells; ${Math.abs(E.V / Vs - 1).toExponential(1)}`);
  // histograms
  const Q = V.Q; let ok = true;
  for (const [key, tot] of [['nonOrtho', Q.nonOrthoMax], ['skewness', Q.skewnessMax], ['aspect', Q.aspectMax], ['volume', Q.volumeMin * 1e9]]) {
    const H = UV.umvHistogram(V, key); ok = ok && H.counts.reduce((a, b) => a + b, 0) === U.nC && Math.abs(H.worstValue / tot - 1) < 1e-14;
  }
  const Ht = UV.umvHistogram(V, 'type');
  check(`  histograms: every cell counted once; the worst cell's value the mesh's worst; the types counted`, ok && Object.values(Ht.cat).reduce((a, b) => a + b, 0) === U.nC, Object.entries(Ht.cat).map(([t, n]) => `${n} ${UV.UMV_TYPES[t][1].toLowerCase()}`).join(', '));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
