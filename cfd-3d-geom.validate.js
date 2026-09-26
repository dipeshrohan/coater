/*
 * cfd-3d-geom.validate.js — checks of the 3D geometry (cfd-3d-geom.js): run with `node cfd-3d-geom.validate.js`.
 *  1. The blade made from the 2D setup: its underside, found by casting rays, is the 2D's blade shape
 *     (cfd-1d.js's bladeShape) plus the shift across the web, and a single layer over the gap.
 *  2. STL: binary written and read back exactly; the text form read.
 *  3. Axes and units: a file's machine / up axes map to the app's, right-handed, scaled to metres.
 *  4. Placement: the lowest point at the gap height, at the metering edge, centred across the web.
 *  5. An overhanging blade is detected (more than one layer over the web).
 *  6. The mesh: node and cell counts, the top on the underside, the layers evenly spread.
 *  7. Shaped blades (cfd-blade.js): extruded, their underside by rays is the profile's; a side section of the
 *     triangles, opened (inlet, metering point, face), gives the profile back -- a bevel, an edge radius, a
 *     two-step with a vertical riser.
 */
const G = require('./cfd-3d-geom.js');
const { bladeShape } = require('./cfd-1d.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

// 1. the blade made from the 2D setup (round entry R 100 mm, pool edge 40 mm, gap 1.725 mm, exit face 90°)
{
  const o = { shape: 'round', H: 1.725e-3, R: 0.1, Xup: 0.04, L: 0.01, faceDeg: 90, faceLen: 8e-3, top: 0.02 };
  const pr = G.bladeSideOutline(o);
  const dy = z => 30e-6 * Math.sin(2 * Math.PI * z / 0.12);      // a waviness of the gap across the web
  const tris = G.extrudeProfile(pr.pts, 0.0275, 0.0475, 20, dy);
  const xs = G.gradedStations(0, pr.xe * 0.999, 40, 1.4), zs = Array.from({ length: 21 }, (_, k) => 0.0276 + 0.0198 * k / 20);
  const f = G.undersideField(tris, xs, zs);
  const shape = bladeShape({ geometry: 'round', H: o.H, R: o.R, Xup: o.Xup });
  let worst = 0, single = true, miss = 0;
  for (let i = 0; i < xs.length; i++) for (let k = 0; k < zs.length; k++) {
    const v = f.low[i * zs.length + k];
    if (!Number.isFinite(v)) { miss++; continue; }
    worst = Math.max(worst, Math.abs(v - (shape.h(xs[i]) + dy(zs[k]))));
    if (f.hits[i * zs.length + k] !== 2) single = false;
  }
  check('made from the 2D setup: underside = the 2D blade shape + the shift across the web', worst < 5e-6 && miss === 0, `worst ${(worst * 1e6).toFixed(2)} µm over ${xs.length * zs.length} rays, ${miss} missed`);
  check('  a single layer over the gap (2 hits per ray)', single);
  check('  metering edge at xe with the gap H', Math.abs(pr.xe - o.Xup) < 1e-12 && Math.abs(shape.h(pr.xe) - o.H) < 1e-12);
  const flat = G.bladeSideOutline({ ...o, shape: 'flat' });
  const ft = G.extrudeProfile(flat.pts, 0, 0.01, 4), ff = G.undersideField(ft, G.gradedStations(0, 0.0099, 10), [0.001, 0.005, 0.009]);
  check('flat land: underside at the gap everywhere', [...ff.low].every(v => Math.abs(v - o.H) < 1e-7));
}
// 2. STL
{
  const t = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]);
  const back = G.parseSTL(G.writeSTL(t));
  check('binary STL: written and read back exactly', back.length === t.length && back.every((v, i) => v === t[i]));
  const txt = 'solid s\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid s\n';
  const tt = G.parseSTL(new TextEncoder().encode(txt).buffer);
  check('text STL read', tt.length === 9 && tt[3] === 1 && tt[7] === 1);
  let threw = false; try { G.parseSTL(new TextEncoder().encode('hello').buffer); } catch (e) { threw = true; }
  check('not an STL: a clear error', threw);
}
// 3. axes and units: a CAD file with x machine, z up (so y across), in mm
{
  const t = new Float32Array([10, 20, 30, 0, 0, 0, 0, 0, 0]);
  const o = G.orientTris(t, { scale: 1e-3, machine: '+x', up: '+z' });
  // app x = file x, app y (up) = file z, app z = x cross y = file (x) cross (z) = -file y
  check('axes: machine +x, up +z -> (x, up, across) = (x, z, -y), mm -> m', Math.abs(o[0] - 0.01) < 1e-9 && Math.abs(o[1] - 0.03) < 1e-9 && Math.abs(o[2] + 0.02) < 1e-9, `${o[0]}, ${o[1]}, ${o[2]}`);
  const o2 = G.orientTris(t, { scale: 1, machine: '-y', up: '+x' });
  check('axes: machine -y, up +x', Math.abs(o2[0] + 20) < 1e-9 && Math.abs(o2[1] - 10) < 1e-9 && Math.abs(Math.abs(o2[2]) - 30) < 1e-9, `${o2[0]}, ${o2[1]}, ${o2[2]}`);
  let threw = false; try { G.orientTris(t, { scale: 1, machine: '+z', up: '-z' }); } catch (e) { threw = true; }
  check('axes: the same axis twice is refused', threw);
}
// 4. placement
{
  const pr = G.bladeSideOutline({ shape: 'round', H: 5e-3, R: 0.1, Xup: 0.04, L: 0.01, faceDeg: 90, faceLen: 8e-3, top: 0.02 });
  const t = G.extrudeProfile(pr.pts.map(([x, y]) => [x + 0.3, y + 0.2]), -0.5, 0.5, 4);
  const p = G.placeBlade(t, { H: 1.7e-3, xUp: 0.04, zc: 0.0375 });
  const b = G.trisBox(p.tris);
  check('placement: lowest point at the gap, at the metering edge, centred on the location', Math.abs(b.min[1] - 1.7e-3) < 1e-9 && Math.abs(p.edgeX - 0.04) < 1e-12 && Math.abs((b.min[2] + b.max[2]) / 2 - 0.0375) < 1e-6);
  // a flat land (a run of lowest points, in any order): its downstream end at the metering edge
  const pf = G.bladeSideOutline({ shape: 'flat', H: 5e-3, R: 0.1, Xup: 0.04, L: 0.01, faceDeg: 90, faceLen: 8e-3, top: 0.02 });
  for (const rev of [false, true]) {
    let tf = G.extrudeProfile(pf.pts.map(([x, y]) => [x + 0.3, y + 0.2]), -0.5, 0.5, 4);
    if (rev) { const r = new Float32Array(tf.length); for (let f = 0; f < tf.length; f += 9) r.set(tf.subarray(tf.length - 9 - f, tf.length - f), f); tf = r; }
    const q = G.placeBlade(tf, { H: 1.7e-3, xUp: 0.01, zc: 0 }), bq = G.trisBox(q.tris);
    let xLow = -Infinity; for (let v = 1; v < q.tris.length; v += 3) if (q.tris[v] < bq.min[1] + 1e-9) xLow = Math.max(xLow, q.tris[v - 1]);
    check(`placement of a flat land${rev ? ' (triangles reversed)' : ''}: the land's downstream end at the metering edge, the land upstream of it`, Math.abs(xLow - 0.01) < 1e-8 && Math.abs(bq.min[0] - 0) < 1e-8 && Math.abs(bq.min[1] - 1.7e-3) < 1e-9, `lowest points to x ${xLow}, blade from x ${bq.min[0]}`);
  }
}
// 5. overhang: a blade whose exit face leans back over the gap, and one with a pocket
{
  const pr = G.bladeSideOutline({ shape: 'flat', H: 1.7e-3, R: 0.1, Xup: 0.04, L: 0.01, faceDeg: 90, faceLen: 8e-3, top: 0.02 });
  // a C-shaped profile: a lip below a pocket
  const cpts = [[0, 1.7e-3], [0.01, 1.7e-3], [0.01, 4e-3], [0.004, 4e-3], [0.004, 6e-3], [0.012, 6e-3], [0.012, 0.02], [0, 0.02]];
  const t = G.extrudeProfile(cpts, 0, 0.01, 2), f = G.undersideField(t, G.gradedStations(0.001, 0.0115, 20), [0.005]);
  check('a pocket over the web is detected (more than 2 hits)', [...f.hits].some(h => h > 2) && Math.min(...f.low) > 1.6e-3);
  const t2 = G.extrudeProfile(pr.pts, 0, 0.01, 2), f2 = G.undersideField(t2, G.gradedStations(0.0005, 0.0095, 20), [0.005]);
  check('  and not for a plain blade', [...f2.hits].every(h => h === 2));
}
// 6. the mesh
{
  const xsGap = G.gradedStations(0, 0.04, 30, 1.6), xsFilm = G.gradedStations(0.04, 0.054, 10), zs = G.gradedStations(0.0275, 0.0475, 8);
  const shape = bladeShape({ geometry: 'round', H: 1.725e-3, R: 0.1, Xup: 0.04 });
  const m = G.mesh3D({ xsGap, xsFilm, zs, under: i => shape.h(xsGap[i]), film: () => 1.75e-3, ny: 6 });
  check('mesh counts: nodes = nx (ny + 1) nz, cells = (nx - 1) ny (nz - 1)', m.nodes === 41 * 7 * 9 && m.cells === 40 * 6 * 8, `${m.nodes} nodes, ${m.cells} cells`);
  const id = (i, j, k) => (i * m.nz + k) * (m.ny + 1) + j;
  let topOk = true, evenOk = true;
  for (let i = 0; i < xsGap.length; i++) for (let k = 0; k < m.nz; k++) {
    if (Math.abs(m.pos[3 * id(i, m.ny, k) + 1] - shape.h(xsGap[i])) > 1e-9) topOk = false;
    for (let j = 0; j <= m.ny; j++) if (Math.abs(m.pos[3 * id(i, j, k) + 1] - shape.h(xsGap[i]) * j / m.ny) > 1e-9) evenOk = false;
  }
  check('  the top follows the underside over the gap', topOk);
  check('  layers evenly spread from the web up', evenOk);
  check('  the drawn outer-face edges index real nodes', m.lines.every(v => v < m.nodes) && m.lines.length > 0);
}
// 7. shaped blades: extruded, rays, and a section back
{
  const Bl = require('./cfd-blade.js');
  for (const [label, spec] of [['bevel', { shape: 'bevel', L: 0.01, bevelDeg: 45, bevelLen: 0.5e-3 }], ['edge radius', { shape: 'radius', L: 0.01, r: 0.4e-3 }], ['two-step', { shape: 'twostep', land1: 0.008, stepH: 0.5e-3, riserDeg: 90, L: 0.005 }]]) {
    const p = Bl.bladeProfile({ H: 1.7e-3, exitDeg: 90, faceLen: 8e-3, ...spec });
    const pr = G.bladeSideOutline({ faceLen: 8e-3, top: 0.02, shaped: { under: Bl.pathPoints(p.under), face: Bl.pathPoints(p.face) } });
    const tris = G.extrudeProfile(pr.pts, 0, 0.01, 4);
    const xs = G.gradedStations(0, p.xe * 0.999, 60, 1.2).map((x, i) => i ? x : 1e-7), f = G.undersideField(tris, xs, [0.005]);
    let worst = 0; xs.forEach((x, i) => { if (Math.abs(x - 0.008) > 1e-5) worst = Math.max(worst, Math.abs(f.low[i] - p.hUnder(x))); });
    check(`${label}: extruded, its underside by rays is the profile's`, worst < 2e-6, `worst ${(worst * 1e6).toFixed(2)} µm`);
    const sec = G.sectionTris(tris, 0.005), open = Bl.openProfile(sec[0].verts, sec[0].closed);
    const q = Bl.customProfile({ verts: open, join: 'straight', cornerDeg: 10 }, 1.7e-3);
    let dU = 0; for (let k = 0; k <= 200; k++) { const x = q.xe * k / 200; if (Math.abs(x - 0.008) > 1e-5) dU = Math.max(dU, Math.abs(q.hUnder(x) - p.hUnder(x))); }
    const nC = q.faceCorners.length, nP = p.faceCorners.length;
    check(`${label}: its section, opened, gives the profile back`, !q.err && Math.abs(q.xe - p.xe) < 2e-6 && dU < 5e-6 && Math.abs(q.face.len - p.face.len) < 0.02 * p.face.len && (label === 'edge radius' ? nC === 1 : nC === nP),
      `metering point ${(q.xe * 1e3).toFixed(4)} vs ${(p.xe * 1e3).toFixed(4)} mm, underside within ${(dU * 1e6).toFixed(2)} µm, face ${(q.face.len * 1e3).toFixed(3)} vs ${(p.face.len * 1e3).toFixed(3)} mm, corners on the face ${nC} vs ${nP}`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
