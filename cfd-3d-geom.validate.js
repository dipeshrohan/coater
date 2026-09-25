/*
 * cfd-3d-geom.validate.js — checks of the 3D geometry (cfd-3d-geom.js): run with `node cfd-3d-geom.validate.js`.
 *  1. The blade made from the 2D setup: its underside, found by casting rays, is the 2D's blade shape
 *     (cfd-1d.js's bladeShape) plus the shift across the web, and a single layer over the gap.
 *  2. STL: binary written and read back exactly; the text form read.
 *  3. Axes and units: a file's machine / up axes map to the app's, right-handed, scaled to metres.
 *  4. Placement: the lowest point at the gap height, at the metering edge, centred across the web.
 *  5. An overhanging blade is detected (more than one layer over the web).
 *  6. The mesh: node and cell counts, the top on the underside, the layers evenly spread.
 */
const G = require('./cfd-3d-geom.js');
const { bladeShape } = require('./cfd-1d.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

// 1. the blade made from the 2D setup (round entry R 100 mm, pool edge 40 mm, gap 1.725 mm, exit face 90°)
{
  const o = { shape: 'round', H: 1.725e-3, R: 0.1, Xup: 0.04, L: 0.01, faceDeg: 90, faceLen: 8e-3, top: 0.02 };
  const pr = G.bladeProfile(o);
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
  const flat = G.bladeProfile({ ...o, shape: 'flat' });
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
  const pr = G.bladeProfile({ shape: 'round', H: 5e-3, R: 0.1, Xup: 0.04, L: 0.01, faceDeg: 90, faceLen: 8e-3, top: 0.02 });
  const t = G.extrudeProfile(pr.pts.map(([x, y]) => [x + 0.3, y + 0.2]), -0.5, 0.5, 4);
  const p = G.placeBlade(t, { H: 1.7e-3, xUp: 0.04, zc: 0.0375 });
  const b = G.trisBox(p.tris);
  check('placement: lowest point at the gap, at the metering edge, centred on the location', Math.abs(b.min[1] - 1.7e-3) < 1e-9 && Math.abs(p.edgeX - 0.04) < 1e-12 && Math.abs((b.min[2] + b.max[2]) / 2 - 0.0375) < 1e-6);
}
// 5. overhang: a blade whose exit face leans back over the gap, and one with a pocket
{
  const pr = G.bladeProfile({ shape: 'flat', H: 1.7e-3, R: 0.1, Xup: 0.04, L: 0.01, faceDeg: 90, faceLen: 8e-3, top: 0.02 });
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
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
