/*
 * mesh-view.validate.js — checks of the mesh viewer on the 3D models' Mesh steps (mesh-view-ui.js on um-view.js and
 * um-core.js) and of the meshes it is given -- each the solver's own, cell by cell -- against what is known of them
 * independently. Run: node mesh-view.validate.js
 *  1. Coating › 3D (cfd-3d-mesh.js's m3CellMesh: the 27-node elements each as the 8 cells on its nodes):
 *     a box laid out by m3Extrude: its volume and each face's area exactly the box's, every cell square (non-orthogonality
 *       0, skewness 0); the blade's faces up to the contact line, the free surface after it;
 *     under a curved top y = h(x), a parabola: the elements' own volume (m3Stats: their triquadratic map, 3 × 3 × 3 Gauss)
 *       W ∫ h dx exactly; the cells' (flat faces on the elements' nodes) converging on it at second order;
 *     a skewed blade turned into the machine's frame: the volume, non-orthogonality and skewness the same (OpenFOAM's aspect
 *       ratio is taken along the axes, so it turns with the cells), the metering edge at the middle fixed;
 *     an open edge's wedges at the web (collapsed by design): left out as the statistics (m3Stats) leave them out.
 *  2. Pool and feed 3D (feed-pool.js's fplStartMeshes: the meshes the cycle's solves start on): no cell inverted, every
 *     cell closed; the volume the elements' own (feed-mesh.js's fmStats, Gauss) to the cells' flat faces; outlets in
 *     mirror pairs: half the pool (to its middle); with the tips in the paste, the coater's mesh round the pipes: its
 *     volume the geometry's own (fmVolumeExpected: the pool, under the blade, less the pipes' walls).
 *  3. The stages' blocks (mp-core.js's mpMesh, 8-node hexahedra, graded): the volume the box's exactly, each patch's area
 *     its side's; each cell's aspect ratio OpenFOAM's for a box of its sides (max(c/a, (ab + bc + ca)/3 / (abc)^(2/3)),
 *     a ≤ b ≤ c), non-orthogonality 0.
 *  4. The viewer's parts: a mesh made ready once per key (built again only for a new one); the measures offered those the
 *     mesh has (the radius ratio with tetrahedra only); the cut's plane at its share of the box; the histogram's bars
 *     every cell kept; a measure the same in every cell said in words, not drawn as a scale.
 */
const UC = require('../engine/um-core.js'), UV = require('../engine/um-view.js'), UF = require('../engine/um-fe.js');
Object.assign(global, UC, UV, UF);
const MVU = require('../pages/mesh-view-ui.js'), M3 = require('../engine/cfd-3d-mesh.js'), FP = require('../engine/feed-pool.js'), FM = require('../engine/feed-mesh.js'), MP = require('../engine/mp-core.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a / b - 1);
const patchArea = (U, G) => { const out = {}; for (const p of U.patches) { let A = 0; for (let f = p.start; f < p.start + p.n; f++) A += Math.hypot(G.fa[3 * f], G.fa[3 * f + 1], G.fa[3 * f + 2]); out[p.name] = A; } return out; };

// 1. Coating › 3D
{
  // a 2D layout (as cfd-steps.js's field of the 2D's layout: node (i, j) at j * nx + i) over [0, L], up to top(x)
  const lay = (nx, ny, L, top) => { const gx = new Float64Array(nx * ny), gy = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = L * i / (nx - 1); gx[j * nx + i] = x; gy[j * nx + i] = top(x) * j / (ny - 1); }
    return { gx, gy, nx, ny, iCorner: 2 * Math.floor((nx - 1) / 4), iCL: 2 * Math.floor((nx - 1) / 3) }; };
  const L = 0.05, Hb = 2e-3, W = 0.02, zs = Array.from({ length: 9 }, (_, k) => -W / 2 + W * k / 8);
  const Mb = M3.m3Extrude(lay(41, 11, L, () => Hb), zs), Ub = UC.umFromFE(M3.m3CellMesh(Mb, { zo: 0.0375 }), { split: true });
  const Gb = UC.umGeometry(Ub), Qb = UC.umQuality(Ub, Gb), Ab = patchArea(Ub, Gb), cl = Mb.cCL / 2;
  const nBlade = Ub.patches.find(p => p.name === 'blade').n, nSurf = Ub.patches.find(p => p.name === 'surface').n;
  check('Coating › 3D, a box: its volume and each face\'s area exactly the box\'s; every cell square; the blade\'s faces to the contact line, the free surface after',
    rel(Qb.volumeTotal, L * Hb * W) < 1e-12 && rel(Ab.web, L * W) < 1e-12 && rel(Ab.blade + Ab.surface, L * W) < 1e-12 && rel(Ab.inlet, Hb * W) < 1e-12 && rel(Ab.outlet, Hb * W) < 1e-12
      && rel(Ab.side0, L * Hb) < 1e-12 && rel(Ab.side1, L * Hb) < 1e-12 && Qb.nonOrthoMax < 1e-6 && Qb.skewnessMax < 1e-9 && Qb.negativeVolumes === 0
      && nBlade === cl * 4 * 4 && nSurf === (20 - cl) * 4 * 4,
    `${Qb.cells} cells; volume ${rel(Qb.volumeTotal, L * Hb * W).toExponential(1)} off; web ${rel(Ab.web, L * W).toExponential(1)}; blade ${nBlade / 4} and surface ${nSurf / 4} cell faces along a row; non-orthogonality ${Qb.nonOrthoMax.toExponential(1)}°`);
  // under a curved top: the cells' volume against W ∫ h dx and the elements' own (Gauss)
  const top = x => 1.7e-3 + 6 * (x - 0.04) * (x - 0.04), exact = W * (1.7e-3 * L + 2 * ((L - 0.04) ** 3 + 0.04 ** 3));
  const err = [], egs = [];
  for (const nx of [21, 41, 81]) {
    const M = M3.m3Extrude(lay(nx, 7, L, top), zs), U = UC.umFromFE(M3.m3CellMesh(M), { split: true }), Q = UC.umQuality(U), S = M3.m3Stats(M);
    err.push(rel(Q.volumeTotal, exact)); egs.push(rel(S.vol.total, exact));
  }
  const order = Math.log2(err[1] / err[2]);
  check('Coating › 3D under a curved top (a parabola): the elements\' own volume (their triquadratic map, Gauss) W ∫ h dx exactly; the cells\' (flat faces on the elements\' nodes) converging on it at second order',
    egs.every(e => e < 1e-12) && order > 1.8 && err[2] < 1e-4,
    `the elements': ${egs.map(e => e.toExponential(1)).join(', ')} off; the cells': ${err.map(e => e.toExponential(2)).join(', ')} (order ${order.toFixed(2)})`);
  // a skewed blade turned into the machine's frame
  const Ms = M3.m3Extrude(lay(21, 7, L, top), zs), o = { zo: 0.0375, xe: 0.04 };
  const U0 = UC.umFromFE(M3.m3CellMesh(Ms, o), { split: true }), U5 = UC.umFromFE(M3.m3CellMesh(Ms, { ...o, skew: 5 }), { split: true });
  const Q0 = UC.umQuality(U0), Q5 = UC.umQuality(U5), C5 = M3.m3CellMesh(Ms, { ...o, skew: 5 });
  const mid = Ms.x.findIndex((x, n) => Math.abs(x - 0.04) < 1e-12 && Math.abs(Ms.z[n]) < 1e-12);
  check('Coating › 3D, a blade skewed 5°: turned into the machine\'s frame, the volume, non-orthogonality and skewness the same; the metering edge at the middle where it was',
    rel(Q5.volumeTotal, Q0.volumeTotal) < 1e-12 && Math.abs(Q5.nonOrthoMax - Q0.nonOrthoMax) < 1e-9 && Math.abs(Q5.skewnessMax - Q0.skewnessMax) < 1e-9 && Math.abs(Q5.nonOrthoAvg - Q0.nonOrthoAvg) < 1e-9
      && mid >= 0 && Math.abs(C5.X[mid] - 0.04) < 1e-15 && Math.abs(C5.Z[mid] - 0.0375) < 1e-15,
    `volume ${rel(Q5.volumeTotal, Q0.volumeTotal).toExponential(1)} off; non-orthogonality ${Q0.nonOrthoMax.toFixed(3)}° and ${Q5.nonOrthoMax.toFixed(3)}°, skewness ${Q0.skewnessMax.toFixed(4)} and ${Q5.skewnessMax.toFixed(4)}; the edge's middle node at (${(C5.X[mid] * 1e3).toFixed(3)}, ${(C5.Z[mid] * 1e3).toFixed(3)}) mm (OpenFOAM's aspect ratio is taken along the axes: it turns with the cells, not checked)`);
  // an open edge's wedges (a corner collapsed onto the contact line by design): left out, as m3Stats leaves them out
  const Mw = M3.m3Extrude(lay(9, 5, 0.02, () => 2e-3), Array.from({ length: 5 }, (_, k) => -0.01 + 0.005 * k)), eLw = 2;
  for (let n = 0; n < Mw.x.length; n++) if (Math.abs(Mw.z[n] + 0.01) < 1e-12 && Mw.y[n] < 0.5e-3 + 1e-12) Mw.y[n] = 0;   // (the open side's lowest nodes onto the web)
  const skipW = (ex, ez, ey) => ez === 0 && ey === 0, Cw = M3.m3CellMesh(Mw, { skip: skipW }), Qw0 = UC.umQuality(UC.umFromFE(M3.m3CellMesh(Mw), { split: true })), Qw = UC.umQuality(UC.umFromFE(Cw, { split: true }));
  const Sw = M3.m3Stats(Mw, { skip: skipW });
  check('Coating › 3D, an open edge\'s wedges at the web: left out of the cells as the statistics leave them out (their collapsed faces would swamp the skewness); the elements kept as many as measured',
    Qw0.skewnessMax > 1e6 && Qw.negativeVolumes === 0 && Qw.skewnessMax < 4 && Cw.skipped === Sw.wedges && Cw.nE === Sw.cells - Sw.wedges && Qw.cells === 8 * Cw.nE,
    `with the wedges: skewness up to ${Qw0.skewnessMax.toExponential(1)}; left out: ${Cw.skipped} elements (the statistics': ${Sw.wedges}), ${Cw.nE} kept, skewness up to ${Qw.skewnessMax.toFixed(2)}, ${Qw.negativeVolumes} inverted`);
}

// 2. Pool and feed 3D
{
  const R = 0.1, H = 1.725e-3, W = 0.3, outlets = [37.5, 112.5, 187.5, 262.5].map(z => ({ x: -0.1, z: z / 1000 }));
  const o = { dim: 3, W, xBack: 0.13, xEnd: 0.04, R, H, rho: 1360, g: 9.81, U: 0.28 / 60, law: { muRef: 10.5, ty: 5, n: 1 }, outlets, r: 6e-3, Qin: 20e-6, Qout: 2.14e-6,
    hP: 0.0372, hD: 0.0362, T: 28, tau: 3, mesh: { hFine: 3e-3, hMax: 0.02, ny: 4 } };
  const S = FP.fplStartMeshes(o), out = [];
  for (const part of ['pulse', 'drain']) {
    const M = S[part], U = UC.umFromFE(M, { split: true }), Q = UC.umQuality(U), st = FM.fmStats(M);
    let zMax = 0; for (let n = 0; n < M.nN; n++) zMax = Math.max(zMax, M.Z[n]);
    out.push({ part, Q, st, zMax, n: M.nE });
  }
  check('Pool and feed 3D, the meshes the solves start on (during a pulse, between): no cell inverted, every cell closed; the volume the elements\' own (Gauss) to the cells\' flat faces; the outlets in mirror pairs: half the pool',
    S.plan.mirror && out.every(q => q.Q.negativeVolumes === 0 && q.Q.opennessMax < 1e-9 && rel(q.Q.volumeTotal, q.st.volume) < 1e-3 && Math.abs(q.zMax - W / 2) < 1e-12) && out[0].st.volume > out[1].st.volume,
    out.map(q => `${q.part}: ${q.n} elements, ${q.Q.cells} cells, volume ${(q.Q.volumeTotal * 1e6).toFixed(3)} ml against ${(q.st.volume * 1e6).toFixed(3)} ml (${rel(q.Q.volumeTotal, q.st.volume).toExponential(1)})`).join('; '));
  // the tips in the paste: the coater's mesh round the pipes
  const od = { ...o, entry: 'dip', pipe: { d: 0.01, Do: 0.014, tip: 0.03 }, mesh: { ...o.mesh, pipes: { m: 4, nLo: 4, nUp: 4, hFar: 0.02 } } };
  const Sd = FP.fplStartMeshes(od), Md = Sd.pulse, Ud = UC.umFromFE(Md, { split: true }), Qd = UC.umQuality(Ud);
  const blade = x => H + R - Math.sqrt(Math.max(0, R * R - x * x)), Vx = FM.fmVolumeExpected({ xCut: -od.xBack, xEnd: -od.xEnd, bladeY: blade, H0: od.hP, film0: 0 }, Md);
  check('Pool and feed 3D, the tips in the paste: the coater\'s mesh round the pipes, half the pool; no cell inverted; its volume the geometry\'s own (the pool under the blade less the pipes\' walls) to the cells\' flat faces',
    Sd.plan.round && Sd.plan.mirror && Qd.negativeVolumes === 0 && Qd.opennessMax < 1e-9 && rel(Qd.volumeTotal, Vx) < 2e-3,
    `${Md.nE} elements, ${Qd.cells} cells; volume ${(Qd.volumeTotal * 1e6).toFixed(3)} ml against ${(Vx * 1e6).toFixed(3)} ml (${rel(Qd.volumeTotal, Vx).toExponential(1)})`);
}

// 3. the stages' blocks
{
  const axes = [[{ L: 0.04, n: 5, g: 1.4 }, { L: 0.02, n: 3 }], [{ L: 0.03, n: 4, g: 0.7 }], [{ L: 2e-4, n: 3 }, { L: 0.01, n: 4, g: 1.3 }]];
  let M;
  try { M = MP.mpMesh({ dim: 3, p: 1, axes }); } catch (e) { M = null; }
  if (!M) check('the stages\' blocks: mp-core\'s mesh built', false, 'mpMesh failed on the graded axes');
  else {
    const U = UC.umFromFE(UF.ufeMesh(M)), G = UC.umGeometry(U), Q = UC.umQuality(U, G, { cells: true }), A = patchArea(U, G);
    const [Lx, Ly, Lz] = M.edges.map(e => e[e.length - 1] - e[0]);
    let arErr = 0;
    for (let c = 0; c < U.nC; c++) {
      const v = Array.from(U.cV.subarray(U.cOff[c], U.cOff[c + 1])), span = [U.X, U.Y, U.Z].map(P => Math.max(...v.map(i => P[i])) - Math.min(...v.map(i => P[i]))).sort((p, q) => p - q);
      const [a, b, cc] = span, ar = Math.max(cc / a, (a * b + b * cc + cc * a) / 3 / Math.pow(a * b * cc, 2 / 3));
      arErr = Math.max(arErr, rel(Q.cell.aspect[c], ar));
    }
    check('the stages\' blocks (8-node hexahedra, graded): the volume the box\'s exactly, each side\'s patch its area; each cell\'s aspect ratio OpenFOAM\'s for a box of its sides; non-orthogonality 0',
      rel(Q.volumeTotal, Lx * Ly * Lz) < 1e-12 && rel(A.x0, Ly * Lz) < 1e-12 && rel(A.y1, Lx * Lz) < 1e-12 && rel(A.z0, Lx * Ly) < 1e-12 && arErr < 1e-12 && Q.nonOrthoMax < 1e-6 && Q.negativeVolumes === 0,
      `${U.nC} cells; volume ${rel(Q.volumeTotal, Lx * Ly * Lz).toExponential(1)} off; aspect ratios off by ${arErr.toExponential(1)} at most (worst ${Q.aspectMax.toFixed(1)})`);
  }
}

// 4. the viewer's parts
{
  let builds = 0;
  const box = () => { builds++; return { mesh: UF.ufeMesh(MP.mpMesh({ dim: 3, p: 1, axes: [{ L: 0.02, n: 4 }, { L: 0.01, n: 2 }, { L: 0.004, n: 2 }] })) }; };
  const P1 = MVU.mvPrep('t-box', box), P2 = MVU.mvPrep('t-box', box), P3 = MVU.mvPrep('t-box2', box);
  check('a mesh made ready once for its key: built again only for a new key', P1 === P2 && P3 !== P1 && builds === 2, `${builds} builds for 3 asks`);
  // tetrahedra: the radius ratio offered; hexahedra: not
  const T = require('../engine/um-tetmesh.js'), prism = { X: [0, 0.02, 0.02, 0, 0, 0.02, 0.02, 0], Y: [0, 0, 0.01, 0.01, 0, 0, 0.01, 0.01], Z: [0, 0, 0, 0, 0.01, 0.01, 0.01, 0.01],
    faces: [{ loops: [[3, 2, 1, 0]], tag: 'bottom' }, { loops: [[4, 5, 6, 7]], tag: 'top' }, { loops: [[0, 1, 5, 4]], tag: 's0' }, { loops: [[1, 2, 6, 5]], tag: 's1' }, { loops: [[2, 3, 7, 6]], tag: 's2' }, { loops: [[3, 0, 4, 7]], tag: 's3' }] };
  const Vt = T.umtVolume(T.umtSurface(prism, { size: 4e-3 }), { size: 4e-3 }), nT = Vt.tet.length / 4;
  const Ut = UC.umBuild({ X: Vt.X, Y: Vt.Y, Z: Vt.Z }, Array.from({ length: nT }, (_, i) => ({ t: UC.UM_TET, v: Array.from(Vt.tet.subarray(4 * i, 4 * i + 4)) })), Array.from({ length: Vt.bface.length / 3 }, (_, i) => ({ v: Array.from(Vt.bface.subarray(3 * i, 3 * i + 3)), tag: Vt.btag[i] })));
  const Pt = MVU.mvPrep('t-tet', () => ({ U: Ut }));
  const kh = MVU.mvMeasures(P1.V).map(m => m.k), kt = MVU.mvMeasures(Pt.V).map(m => m.k);
  const toolsT = MVU.mvToolsHTML('t-tet', Pt, { own: true, height: 1 }), toolsH = MVU.mvToolsHTML('t-box', P1, {});
  check('the measures offered: the radius ratio with tetrahedra only; the colour list and the height scale in the tools as asked',
    kt.includes('rho') && !kh.includes('rho') && !kh.includes('faces') && /value="rho"/.test(toolsT) && !/value="rho"/.test(toolsH) && /data-mvvs/.test(toolsT) && !/data-mvvs/.test(toolsH) && /data-mvview/.test(toolsT) && !/data-mvview/.test(toolsH),
    `hexahedra: ${kh.join(', ')}; tetrahedra: ${kt.join(', ')}`);
  // the cut: its plane at its share of the box; the histogram's bars every cell kept
  const st = MVU.mvSt('t-tet'); Object.assign(st, { mode: 'cut', axis: 0, at: 0.25, keep: -1, colour: 'rho' });
  const cut = MVU.mvCut(Pt.V, st), sel = UV.umvSelect(Pt.V, cut), kept = sel.reduce((a, b) => a + b, 0), H = UV.umvHistogram(Pt.V, 'rho', sel, 24);
  const hist = MVU.mvHistHTML(Pt.V, UV.UMV_MEASURES.find(m => m.k === 'rho'), sel), bars = [...hist.matchAll(/: (\d[\d,]*) cells?<\/title>/g)].reduce((s, m) => s + +m[1].replace(/,/g, ''), 0);
  const A = MVU.mvArrays(Pt, st), over = MVU.mvOverHTML(Pt, st, A), panel = MVU.mvPanelHTML(Pt, st);
  check('the cut: the plane at its share of the box, the cells by their centres; the histogram\'s bars every cell kept; the numbers the mesh\'s',
    Math.abs(cut.at - (Pt.V.lo[0] + 0.25 * (Pt.V.hi[0] - Pt.V.lo[0]))) < 1e-15 && kept > 0 && kept < Ut.nC && H.n === kept && bars === kept && A.kept === kept
      && over.includes(`${kept.toLocaleString('en')} of ${Ut.nC.toLocaleString('en')} kept`) && panel.includes(Ut.nC.toLocaleString('en')) && /Radius ratio, worst/.test(panel),
    `${kept} of ${Ut.nC} tetrahedra kept by x ≤ ${(cut.at * 1e3).toFixed(2)} mm; ${bars} in the bars; ${A.cells} drawn`);
  // a measure the same in every cell: in words
  const sb = MVU.mvSt('t-box'); Object.assign(sb, { colour: 'nonOrtho', mode: 'all' });
  const Ab = MVU.mvArrays(P1, sb), ob = MVU.mvOverHTML(P1, sb, Ab), hb = MVU.mvHistHTML(P1.V, UV.UMV_MEASURES.find(m => m.k === 'nonOrtho'), null);
  check('a measure the same in every cell (a block\'s non-orthogonality): said in words, no scale or bars drawn', /every cell drawn: 0/.test(ob) && !/mv-bar/.test(ob) && /Every cell: <b>0/.test(hb) && !/<rect/.test(hb), '');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
