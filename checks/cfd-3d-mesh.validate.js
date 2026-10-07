/*
 * cfd-3d-mesh.validate.js — checks of cfd-3d-mesh.js (the 3D mesh's statistics and quality) against meshes whose
 * answers are known exactly. Run: node cfd-3d-mesh.validate.js
 */
const G = require('../engine/cfd-3d-mesh.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

/** A box Lx × Ly × Lz of nEx × nEy × nEz Q2 hexahedra, its nodes (c, l, k) mapped by f(x, y, z) (default: as they are). */
function box(Lx, Ly, Lz, nEx, nEy, nEz, f = (x, y, z) => [x, y, z]) {
  const NC = 2 * nEx + 1, NR = 2 * nEy + 1, NL = 2 * nEz + 1, N = NC * NL * NR, x = new Float64Array(N), y = new Float64Array(N), z = new Float64Array(N);
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
    const n = (c * NL + l) * NR + k, p = f(Lx * c / (NC - 1), Ly * k / (NR - 1), Lz * l / (NL - 1));
    x[n] = p[0]; y[n] = p[1]; z[n] = p[2];
  }
  return { NC, NL, NR, x, y, z, cCorner: nEx % 2 ? 2 * ((nEx - 1) / 2) : nEx, cCL: NC - 3 };
}

// 1. a box: counts, every element's volume (the box's over their number), aspect ratio, no skewness, orthogonal, valid
{
  const M = box(2, 0.5, 1, 4, 2, 3), S = G.m3Stats(M);
  const vol = 2 * 0.5 * 1 / 24;
  check('a box: its counts, volumes, aspect ratio (3D and in the plane of the flow); square, orthogonal, valid', S.cells === 24 && S.nodes === 9 * 7 * 5 && S.nodesP === 5 * 4 * 3 && S.nEx === 4 && S.nEy === 2 && S.nEz === 3
    && rel(S.arXY.max, 2) < 1e-12 && rel(S.vol.min, vol) < 1e-12 && rel(S.vol.max, vol) < 1e-12 && rel(S.vol.total, 1) < 1e-12 && rel(S.ar.max, 2) < 1e-12 && S.skew.max < 1e-12 && S.nonOrth.max < 1e-9 && rel(S.q.min, 1) < 1e-12 && S.invalid === 0
    && rel(S.edge.min, 0.25) < 1e-12 && rel(S.edge.max, 0.5) < 1e-12,
    `${S.cells} elements, ${S.nodes} nodes; volumes ${S.vol.min.toFixed(6)}–${S.vol.max.toFixed(6)} (${vol.toFixed(6)}), total ${S.vol.total.toFixed(12)}; aspect ${S.ar.max}; skew ${S.skew.max.toExponential(1)}; non-orthogonal ${S.nonOrth.max.toExponential(1)}°`);
  // the gap at the metering edge's column: its elements and their heights; across the web: width, elements, Δz
  check('the gap: elements across it and their heights; across the web: its width, elements, Δz', S.gap.cells === 2 && S.gap.nodes === 5 && rel(S.gap.H, 0.5) < 1e-12 && rel(S.gap.hMin, 0.25) < 1e-12 && rel(S.gap.hMax, 0.25) < 1e-12
    && rel(S.across.width, 1) < 1e-12 && S.across.cells === 3 && rel(S.across.dzMin, 1 / 3) < 1e-12 && rel(S.across.dzMax, 1 / 3) < 1e-12 && S.across.nodes === 7,
    `gap ${S.gap.H} in ${S.gap.cells} (${S.gap.hMin}); across ${S.across.width} in ${S.across.cells}, Δz ${S.across.dzMin.toFixed(6)}`);
}
// 2. sheared 45° (x + y): face angles 45° and 135° -> equiangle skewness 0.5; the faces' normals 45° off the centres' line; volume kept
{
  const M = box(2, 0.5, 1, 4, 2, 3, (x, y, z) => [x + y, y, z]), S = G.m3Stats(M);
  check('sheared 45°: skewness 0.5, non-orthogonality 45°, the volumes kept', rel(S.skew.max, 0.5) < 1e-9 && rel(S.nonOrth.max, 45) < 1e-9 && rel(S.vol.total, 1) < 1e-12 && S.invalid === 0,
    `skew ${S.skew.max.toFixed(9)}, non-orthogonal ${S.nonOrth.max.toFixed(9)}°, total ${S.vol.total.toFixed(12)}`);
}
// 3. uneven across the web (z³-graded) and a curved top: Δz's extremes exact; volume = the integral of the height
{
  const M = box(1, 1, 1, 2, 2, 4, (x, y, z) => [x, y * (1 + 0.2 * x * x), z * z * z]), S = G.m3Stats(M);
  // (element ends across at z = (l/8)^3, l even: 0, 1/64, 8/64, 27/64, 1)
  const ends = [0, 2, 4, 6, 8].map(l => Math.pow(l / 8, 3)), dz = ends.slice(1).map((z, i) => z - ends[i]);
  // (height 1 + 0.2 x² is exact for the Q2 map; z³ is not (a quadratic per element), so the volume over the cubes' integral is not 1 + 0.2/3 exactly: only its x-part is compared on even z)
  check('uneven across the web: Δz\'s smallest and largest', rel(S.across.dzMin, Math.min(...dz)) < 1e-12 && rel(S.across.dzMax, Math.max(...dz)) < 1e-12 && S.across.cells === 4, `Δz ${S.across.dzMin.toFixed(6)}–${S.across.dzMax.toFixed(6)}`);
  const M2 = box(1, 1, 1, 2, 2, 2, (x, y, z) => [x, y * (1 + 0.2 * x * x), z]), S2 = G.m3Stats(M2);
  check('a curved top (height 1 + 0.2 x²): the volume its integral, exactly', rel(S2.vol.total, 1 + 0.2 / 3) < 1e-12, `${S2.vol.total.toFixed(12)} (${(1 + 0.2 / 3).toFixed(12)})`);
}
// 4. a folded element: invalid (an error), the others found valid
{
  const M = box(2, 0.5, 1, 4, 2, 2);
  // (the first element's downstream face pulled back upstream of its upstream face: folded)
  for (let l = 0; l < M.NL; l++) for (let k = 0; k < M.NR; k++) M.x[(2 * M.NL + l) * M.NR + k] = -0.25;
  const S = G.m3Stats(M), W = G.m3Warnings(S);
  const e = W.find(w => w.level === 'error' && w.code === 'invalid');
  check('a folded element: invalid, an error; the rest valid', S.invalid > 0 && S.invalidAt.some(a => a.ex === 0) && !S.invalidAt.some(a => a.ex >= 2) && !!e, `${S.invalid} invalid of ${S.cells}: ${e ? e.text : ''}`);
}
// 5. the warnings: 2 across the gap and 2 across the region warned (warnings, not errors); 4 and 4: none
{
  const W1 = G.m3Warnings(G.m3Stats(box(2, 0.5, 1, 4, 2, 2))), W2 = G.m3Warnings(G.m3Stats(box(2, 0.5, 1, 4, 4, 4)));
  check('warnings: 2 elements across the gap and the region warned; 4 and 4 none', W1.some(w => w.code === 'gap' && w.level === 'warning') && W1.some(w => w.code === 'z' && w.level === 'warning') && !W1.some(w => w.level === 'error') && W2.length === 0,
    W1.map(w => w.code).join(', ') + ' | ' + (W2.map(w => w.code).join(', ') || 'none'));
  // (a refinement region's shape: elements marked 'meniscus' long and thin)
  const M = box(40, 0.5, 1, 4, 2, 4), W3 = G.m3Warnings(G.m3Stats(M, { zone: ex => ex >= 2 ? ['meniscus'] : [] }));
  check('a long thin element near the meniscus: its aspect ratio warned', W3.some(w => w.code === 'arMeniscus'), W3.filter(w => w.code === 'arMeniscus').map(w => w.text).join(''));
  // (long across the web only -- 0.5 along and up, 20 across: the flow's plane square -- not warned: across, the elements' number is)
  const W4 = G.m3Warnings(G.m3Stats(box(2, 2, 80, 4, 4, 4), { zone: () => ['meniscus'] }));
  check('long across the web only: no aspect warning (its 3D aspect ratio reported)', !W4.some(w => w.code === 'arMeniscus' || w.code === 'ar') && G.m3Stats(box(2, 2, 80, 4, 4, 4)).ar.max === 40, W4.map(w => w.code).join(', ') || 'none');
  // (sheared up the gap by 3 along per 1 up: every face atan 3 = 71.57° from orthogonal, the worst taken where first met,
  // at the first element. Its contact line up the exit face there (cCorner 0, cCL 2: element 0 under the face): told
  // apart, with why; the contact line up the face further along (the worst not under it), or at the edge: the plain one)
  const shear = (x, y, z) => [x + 3 * y, y, z], t = Math.atan(3) * 180 / Math.PI, sheared = (cC, cL) => { const M = box(2, 0.5, 1, 4, 4, 4, shear); M.cCorner = cC; M.cCL = cL; return M; };
  const Sm = G.m3Stats(sheared(0, 2)), Wm = G.m3Warnings(Sm), Sn = G.m3Stats(sheared(4, 6)), Wn = G.m3Warnings(Sn), Sp = G.m3Stats(sheared(0, 0)), Wp = G.m3Warnings(Sp);
  check('non-orthogonal faces under a climbed contact line told apart (where, why); elsewhere or pinned, the plain warning',
    rel(Sm.nonOrth.max, t) < 1e-9 && rel(Sm.nonOrth.cl, t) < 1e-9 && Sm.climbed && Sm.nonOrth.at.cl && Sm.nonOrth.at.ex === 0
    && Wm.some(w => w.code === 'nonOrthMeniscus' && w.level === 'warning') && !Wm.some(w => w.code === 'nonOrth')
    && Sn.climbed && !Sn.nonOrth.at.cl && Wn.some(w => w.code === 'nonOrth') && !Wn.some(w => w.code === 'nonOrthMeniscus')
    && !Sp.climbed && Sp.nonOrth.cl === null && Wp.some(w => w.code === 'nonOrth') && !Wp.some(w => w.code === 'nonOrthMeniscus'),
    `${Sm.nonOrth.max.toFixed(3)}° (atan 3 = ${t.toFixed(3)}°) at ${JSON.stringify(Sm.nonOrth.at)}: ${Wm.map(w => w.code).join(', ')} | up the face further along: ${Wn.map(w => w.code).join(', ')} | pinned: ${Wp.map(w => w.code).join(', ')}`);
}
// 6. a station's 2D layout repeated across: the same mesh as the box built directly; each station's heights scaled
{
  const A = box(2, 0.5, 1, 4, 2, 3), nx = A.NC, ny = A.NR, gx = new Float64Array(nx * ny), gy = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { gx[j * nx + i] = 2 * i / (nx - 1); gy[j * nx + i] = 0.5 * j / (ny - 1); }
  const zs = Array.from({ length: A.NL }, (_, l) => l / (A.NL - 1)), B = G.m3Extrude({ gx, gy, nx, ny, iCorner: A.cCorner, iCL: A.cCL }, zs);
  let d = 0; for (let n = 0; n < A.x.length; n++) d = Math.max(d, Math.abs(A.x[n] - B.x[n]), Math.abs(A.y[n] - B.y[n]), Math.abs(A.z[n] - B.z[n]));
  const C = G.m3Extrude({ gx, gy, nx, ny, iCorner: A.cCorner, iCL: A.cCL }, zs, l => 1 + 0.1 * l), top = l => C.y[(0 * C.NL + l) * C.NR + C.NR - 1];
  check('a station\'s layout repeated across: the box itself; each station\'s heights by its gap', d === 0 && rel(top(6), 0.5 * 1.6) < 1e-12 && rel(top(0), 0.5) < 1e-12, `node difference ${d}; top at the last station ${top(6)}`);
}
// 7. sections: the grid lines through the element edges (2 segments an element edge), in the plane's coordinates
{
  const M = box(2, 0.5, 1, 4, 2, 3), xz = G.m3Section(M, 'xz'), xy = G.m3Section(M, 'xy'), yz = G.m3Section(M, 'yz');
  const nSeg = s => s.segs.length / 4;
  // xz: lines along x at each element end across (4) of NC-1 = 8 segments, lines across at each element end along (5) of NL-1 = 6
  check('sections: X–Z (the web), X–Y (the middle station), Y–Z (the metering edge): their lines and extents', nSeg(xz) === 4 * 8 + 5 * 6 && nSeg(xy) === 3 * 8 + 5 * 4 && nSeg(yz) === 3 * 6 + 4 * 4
    && JSON.stringify(xz.bounds) === JSON.stringify([0, 2, 0, 1]) && JSON.stringify(xy.bounds) === JSON.stringify([0, 2, 0, 0.5]) && JSON.stringify(yz.bounds) === JSON.stringify([0, 1, 0, 0.5]),
    `${nSeg(xz)}, ${nSeg(xy)}, ${nSeg(yz)} segments`);
}
// 8. the cross-flow diagnostic: the largest |u_x|, |u_y|, |u_z| and their ratio; a skewed blade's frame turned back
{
  const n = 10, R = { u: new Float64Array(n).fill(1), v: new Float64Array(n).fill(0.05), w: new Float64Array(n) };
  R.w[3] = -0.2;
  const a = G.m3CrossFlow(R), b = G.m3CrossFlow({ ...R, skew: 90 });
  check('the cross-flow diagnostic: max |u_z| / max |u_x|; a skewed blade\'s frame turned back', a.ux === 1 && a.uy === 0.05 && a.uz === 0.2 && rel(a.ratio, 0.2) < 1e-15 && a.mean.ux === 1 && rel(a.mean.uz, 0.02) < 1e-15 && rel(b.ux, 0.2) < 1e-12 && rel(b.uz, 1) < 1e-12,
    `${a.ux}, ${a.uy}, ${a.uz}: ${a.ratio}; turned 90°: ${b.ux.toFixed(3)}, ${b.uz.toFixed(3)}`);
}
// 9. a mesh study's quantities: the free surface's curvature at the contact line through its first three nodes (a circle)
{
  const NC = 7, NL = 3, NR = 3, N = NC * NL * NR, Rr = 2e-3, f = new Float64Array(N);
  const R = { NC, NL, NR, cCL: 2, cCorner: 1, x: new Float64Array(N), y: new Float64Array(N), z: f, u: f, v: f, w: f, p: new Float64Array(N).fill(5), gd: new Float64Array(N).fill(2), mu: new Float64Array(N).fill(3),
    stations: [{}, { film: 1e-4, q: 2e-6, s: 3e-4 }, {}], top: { p3: [0, 7, 0, 0, 0, 0, 0] } };
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
    const n = (c * NL + l) * NR + k, t = 0.3 * (c - 2);
    R.x[n] = Rr * Math.sin(t); R.y[n] = k === NR - 1 ? Rr * (1 - Math.cos(t)) : 0;
  }
  const m = G.m3StudyMetrics(R);
  check('a mesh study\'s quantities: the surface\'s curvature through three points on a circle, the rest as solved', rel(Math.abs(m.curv), 1 / Rr) < 1e-9 && m.pMax === 5 && m.pEdge === 7 && m.gdMax === 2 && m.wss === 6 && m.film === 1e-4 && m.cl === 3e-4,
    `curvature ${Math.abs(m.curv).toFixed(3)} 1/m (${(1 / Rr).toFixed(3)})`);
}
// 9b. the wall layers: the rows within their thickness from the web and from the top (fractions of the gap)
{
  const S0 = G.m3Stats(box(2, 1, 1, 4, 4, 3)), S = G.m3Stats(box(2, 1, 1, 4, 4, 3), { layers: { web: 0.3, top: 0.26 } });
  check('the wall layers: the rows within their thickness counted (1 at the web, 1 at the top), none without', S0.layerCells === 0 && S.layerRows.web === 1 && S.layerRows.top === 1 && S.layerCells === 2 * 4 * 3,
    `rows ${JSON.stringify(S.layerRows)}, ${S.layerCells} elements`);
}
// 10. the regions near the edge and the contact line: M3_ZONE_REACH elements either side of their node columns
{
  const f = G.m3ZoneOf({ cCorner: 8, cCL: 12 }), got = Array.from({ length: 10 }, (_, ex) => f(ex).join('+') || '-').join(' ');
  // (edge column 8: elements 2..5; contact line column 12: elements 4..7)
  check('the regions near the metering edge and the contact line', got === '- - edge edge edge+meniscus edge+meniscus meniscus meniscus - -' && G.M3_ZONE_REACH === 2, got);
}
// 11. elements left out by design (an open edge's wedges at the web): not measured, counted apart
{
  const M = box(2, 0.5, 1, 4, 2, 3, (x, y, z) => [x, z < 1e-12 && y < 0.125 + 1e-12 ? 0 : y, z]);   // (the first station's lowest middle nodes pulled onto the web: its elements there folded)
  const A = G.m3Stats(M), B = G.m3Stats(M, { skip: (ex, ez, ey) => ez === 0 && ey === 0 });
  check('elements left out by design: not measured (no invalid), counted apart', A.invalid > 0 && B.invalid === 0 && B.wedges === 4 && B.cells === 24 && Number.isFinite(B.q.mean) && B.q.min > 0,
    `without: ${A.invalid} invalid; with: ${B.invalid} invalid, ${B.wedges} left out, worst ${B.q.min.toFixed(3)}`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
if (typeof process !== 'undefined') process.exitCode = fails ? 1 : 0;
