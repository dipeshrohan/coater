/*
 * cfd-blade.validate.js — checks of the blade profiles (cfd-blade.js): run with `node cfd-blade.validate.js`.
 *  1. Paths: pieces joined end to end, the direction continuous but for the joins' turns; arcs turn as asked.
 *  2. Round entry and flat land: the underside is cfd-1d.js's bladeShape; the face one straight piece.
 *  3. Bevel, edge radius, wedge, two-step: their points, corners (the angles either side), C, steep parts.
 *  4. Custom, straight: an edge radius given as points comes out smooth and on the circle; a bevel as
 *     points has its corners found (turn above 10°), a corner untoggled is rounded; M and C found; the gap
 *     at M; a corner given by a bulge arc.
 *  5. Custom, spline: through its points, smooth between corners.
 *  6. Outlines: the open profile (inlet, M, face top) from a closed outline either way round, the blade's
 *     back and top left out, a step's riser kept.
 *  7. DXF: LINE / ARC / LWPOLYLINE with bulges / POLYLINE / SPLINE read, joined, units; CSV points.
 *  8. Shapes that are not possible: an overhanging underside, a falling face, an underside on the web.
 */
const B = require('./cfd-blade.js');
const { bladeShape } = require('./cfd-1d.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const deg = Math.PI / 180, near = (a, b, t) => Math.abs(a - b) <= t;
/** Largest gap between the pieces of a path, and largest direction jump at joins that are not corners (|turn| <= 1e-5). */
function pathChecks(path) {
  let gap = 0, jump = 0;
  for (let i = 1; i < path.pieces.length; i++) {
    const a = B.pieceAt(path.pieces[i - 1], B.pieceLen(path.pieces[i - 1])), b = B.pieceAt(path.pieces[i], 0);
    gap = Math.max(gap, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  for (const j of path.joins) if (Math.abs(j.turn) <= 1e-5) jump = Math.max(jump, Math.abs(j.turn));
  return { gap, jump };
}

// 1. paths
console.log('\n1. Paths');
{
  const a = B.bladeArcFrom(1, 2, 30 * deg, 50 * deg, 0.5), b = B.bladeArcFrom(1, 2, 30 * deg, -50 * deg, 0.5);
  const a0 = B.pieceAt(a, 0), a1 = B.pieceAt(a, B.pieceLen(a)), b0 = B.pieceAt(b, 0), b1 = B.pieceAt(b, B.pieceLen(b));
  check('an arc from a point: starts there, in the given direction', Math.hypot(a0[0] - 1, a0[1] - 2) < 1e-15 && near(a0[2], 30 * deg, 1e-14) && Math.hypot(b0[0] - 1, b0[1] - 2) < 1e-15 && near(b0[2], 30 * deg, 1e-14));
  check('  and turns by the sweep (left and right)', near(a1[2], 80 * deg, 1e-14) && near(b1[2], -20 * deg, 1e-14), `${(a1[2] / deg).toFixed(9)}°, ${(b1[2] / deg).toFixed(9)}°`);
  check('  its length r x sweep; its end on the circle', near(B.pieceLen(a), 0.5 * 50 * deg, 1e-15) && near(Math.hypot(a1[0] - a.cx, a1[1] - a.cy), 0.5, 1e-15));
  const p = B.makeBladePath([B.bladeLine(0, 0, 1, 0), B.bladeArcFrom(1, 0, 0, Math.PI / 2, 0.2), B.bladeLine(1.2, 0.2, 1.2, 1), B.bladeLine(1.2, 1, 1.5, 1.3)]);
  const c = pathChecks(p);
  check('a path: pieces end to end, smooth joins with no jump', c.gap < 1e-15 && c.jump < 1e-9, `gap ${c.gap.toExponential(1)}`);
  check('  length and the direction along it', near(p.len, 1 + 0.1 * Math.PI + 0.8 + 0.3 * Math.SQRT2, 1e-14) && near(p.th(1 + 0.05 * Math.PI), Math.PI / 4, 1e-14) && near(p.th(p.len), Math.PI / 4, 1e-14));
  const corners = p.joins.filter(j => Math.abs(j.turn) > 1e-5);
  check('  one corner (the last join), turning -45°', corners.length === 1 && near(corners[0].turn, -Math.PI / 4, 1e-14) && near(corners[0].thm, Math.PI / 2, 1e-14));
  const [u, v] = B.pathSplit(p, 1.5), pu = B.makeBladePath(u), pv = B.makeBladePath(v);
  check('  split: the two parts add up, meeting at the point', near(pu.len + pv.len, p.len, 1e-14) && Math.hypot(pu.end[0] - pv.start[0], pu.end[1] - pv.start[1]) < 1e-15 && Math.hypot(pu.end[0] - p.P(1.5)[0], pu.end[1] - p.P(1.5)[1]) < 1e-15);
}

// 2. legacy shapes
console.log('\n2. Round entry and flat land');
{
  const H = 1.725e-3, r = B.bladeProfile({ shape: 'round', H, R: 0.1, Xup: 0.04, exitDeg: 90, faceLen: 8e-3 });
  const sh = bladeShape({ geometry: 'round', H, R: 0.1, Xup: 0.04 });
  let worst = 0; for (let k = 0; k <= 400; k++) { const x = 0.04 * k / 400; worst = Math.max(worst, Math.abs(r.hUnder(x) - sh.h(x))); }
  check('round entry: the underside is bladeShape\'s', worst < 1e-15 && r.legacy === 'round' && near(r.xe, 0.04, 1e-17), `worst ${worst.toExponential(1)} m`);
  check('  M at the edge with the gap H; the face straight at 90°', near(r.under.end[1], H, 1e-17) && r.straightFace && near(r.faceDeg, 90, 1e-12) && near(r.face.len, 8e-3, 1e-17));
  check('  M a corner of 90° (underside level there)', r.faceCorners.length === 1 && near(r.faceCorners[0].thm, 0, 1e-12) && near(r.faceCorners[0].thp, Math.PI / 2, 1e-15));
  const f = B.bladeProfile({ shape: 'flat', H: 1.7e-3, L: 0.01, exitDeg: 60 });
  check('flat land: level at H over L, the face at 60°', f.hUnder(0.003) === 1.7e-3 && near(f.xe, 0.01, 1e-18) && near(f.faceDeg, 60, 1e-12) && f.legacy === 'flat' && !f.steep.length);
}

// 3. the new parametric shapes
console.log('\n3. Bevel, edge radius, wedge, two-step');
{
  const H = 1.7e-3, L = 0.01;
  const bv = B.bladeProfile({ shape: 'bevel', H, L, bevelDeg: 45, bevelLen: 0.5e-3, exitDeg: 90, faceLen: 8e-3 });
  const C = bv.face.P(bv.C);
  check('bevel: C at L + b cos β, H + b sin β', near(C[0], L + 0.5e-3 * Math.SQRT1_2, 1e-17) && near(C[1], H + 0.5e-3 * Math.SQRT1_2, 1e-17) && !bv.legacy && !bv.err);
  check('  corners: M (level to 45°) and C (45° to 90°)', bv.faceCorners.length === 2 && near(bv.faceCorners[0].thp, 45 * deg, 1e-14) && near(bv.faceCorners[1].thm, 45 * deg, 1e-14) && near(bv.faceCorners[1].thp, 90 * deg, 1e-14) && near(bv.faceCorners[1].s, 0.5e-3, 1e-18));
  check('  the face: bevel then 8 mm of exit face', near(bv.face.len, 8.5e-3, 1e-17) && !bv.straightFace);
  const ra = B.bladeProfile({ shape: 'radius', H, L, r: 0.3e-3, exitDeg: 90, faceLen: 8e-3 });
  const E = ra.face.P(ra.C);
  check('edge radius: the arc ends at L + r, H + r (90° face)', near(E[0], L + 0.3e-3, 1e-17) && near(E[1], H + 0.3e-3, 1e-17) && near(ra.face.th(ra.C), Math.PI / 2, 1e-14));
  check('  no corner: M smooth (level both sides), the arc into the face smooth', ra.faceCorners.length === 1 && near(ra.faceCorners[0].turn, 0, 1e-15) && pathChecks(ra.face).jump < 1e-9);
  check('  the direction turns steadily along the arc', near(ra.face.th(ra.C / 3), 30 * deg, 1e-12) && near(ra.face.th(ra.C / 2), 45 * deg, 1e-12));
  const ra120 = B.bladeProfile({ shape: 'radius', H, L, r: 0.3e-3, exitDeg: 120, faceLen: 8e-3 });
  const E2 = ra120.face.P(ra120.C);
  check('  a 120° face: the arc turns 120°, leaning back at its end', near(ra120.face.th(ra120.C), 120 * deg, 1e-14) && near(E2[0], L + 0.3e-3 * Math.sin(120 * deg), 1e-17) && near(E2[1], H + 0.3e-3 * (1 - Math.cos(120 * deg)), 1e-17));
  const we = B.bladeProfile({ shape: 'wedge', H, L, inletGap: 3e-3, exitDeg: 90 });
  const a = Math.atan((3e-3 - H) / L);
  check('wedge: straight from the inlet gap to H', near(we.hUnder(0), 3e-3, 1e-18) && near(we.hUnder(L / 2), (3e-3 + H) / 2, 1e-18) && near(we.hUnder(L), H, 1e-18));
  check('  M: from the falling underside (-α) to the face', near(we.faceCorners[0].thm, -a, 1e-14) && near(we.faceCorners[0].thp, 90 * deg, 1e-14));
  const ts = B.bladeProfile({ shape: 'twostep', H, land1: 0.01, stepH: 0.5e-3, riserDeg: 90, L: 5e-3, exitDeg: 90 });
  check('two-step, 90° riser: the underside H + step, then H', near(ts.hUnder(0.005), H + 0.5e-3, 1e-18) && near(ts.hUnder(0.0101), H, 1e-18) && near(ts.xe, 0.015, 1e-17));
  check('  the riser is steep (a fan); its two corners -90° and +90°', ts.steep.length === 1 && near(ts.steep[0][0], 0.01, 1e-17) && near(ts.steep[0][1], 0.0105, 1e-17)
    && ts.underCorners.length === 2 && near(ts.underCorners[0].turn, -90 * deg, 1e-14) && near(ts.underCorners[1].turn, 90 * deg, 1e-14));
  const t45 = B.bladeProfile({ shape: 'twostep', H, land1: 0.01, stepH: 0.5e-3, riserDeg: 45, L: 5e-3, exitDeg: 90 });
  const t70 = B.bladeProfile({ shape: 'twostep', H, land1: 0.01, stepH: 0.5e-3, riserDeg: 70, L: 5e-3, exitDeg: 90 });
  check('  a 45° riser: not steep (vertical spines); 70°: steep', !t45.steep.length && t70.steep.length === 1 && near(t45.hUnder(0.01025), H + 0.25e-3, 1e-15));
  const bad = [B.bladeProfile({ shape: 'wedge', H, L, inletGap: 1e-3, exitDeg: 90 }), B.bladeProfile({ shape: 'twostep', H, land1: 0.01, stepH: 0.5e-3, riserDeg: 95, L: 5e-3, exitDeg: 90 }), B.bladeProfile({ shape: 'bevel', H, L, bevelDeg: 45, bevelLen: 0, exitDeg: 90 })];
  check('  impossible inputs named: inlet gap below H, riser over 90°, no bevel', bad.every(p => p.err), bad.map(p => p.err).join(' | '));
}

// 4. custom, straight
console.log('\n4. Custom profiles, straight lines');
{
  const H = 1.7e-3, r = 1e-3, verts = [];
  for (let k = 0; k <= 10; k++) verts.push({ x: 1e-3 * k, y: 5e-3 });                          // a land at y = 5 mm (any height: H sets it)
  for (let k = 1; k <= 16; k++) { const a = 90 * deg * k / 16; verts.push({ x: 0.01 + r * Math.sin(a), y: 5e-3 + r * (1 - Math.cos(a)) }); }
  for (let k = 1; k <= 6; k++) verts.push({ x: 0.011, y: 6e-3 + 1e-3 * k });
  const p = B.customProfile({ verts, join: 'straight' }, H);
  check('an edge radius as points: no corner found (every turn under 10°)', !p.err && p.auto.corners.length === 0 && p.faceCorners.length === 1 && Math.abs(p.faceCorners[0].turn) < 1e-12, p.err || '');
  check('  M: the downstream end of the land (vertex 10)', p.Mi === 10 && p.auto.M === 10);
  let dev = 0;
  for (let k = 0; k <= 200; k++) { const q = p.face.P(p.face.len * k / 200); if (q[1] < H + r && q[0] > 0.01) dev = Math.max(dev, Math.abs(Math.hypot(q[0] - 0.01, q[1] - (H + r)) - r)); }
  check('  the rounded path stays on the circle within 0.2 % of r', dev < 2e-3 * r, `${(dev / r * 100).toFixed(3)} %`);
  check('  the gap at M is H; the path smooth (no direction jumps)', near(p.under.end[1], H, 1e-17) && pathChecks(p.face).jump < 1e-9 && pathChecks(p.under).jump < 1e-9);
  // a bevel as points
  const bv = [{ x: 0, y: 3e-3 }, { x: 4e-3, y: 2e-3 }, { x: 10e-3, y: 2e-3 }, { x: 10.5e-3, y: 2.5e-3 }, { x: 10.5e-3, y: 9e-3 }];
  const q = B.customProfile({ verts: bv, join: 'straight' }, H);
  check('a bevel as points: corners at the entry, M and the bevel top', q.auto.corners.join() === '1,2,3' && q.Mi === 2 && q.Ci === 3, `corners ${q.auto.corners}`);
  check('  M a 45° corner, C the bevel top at 45° to 90°', q.faceCorners.length === 2 && near(q.faceCorners[0].turn, 45 * deg, 1e-12) && near(q.faceCorners[1].thp, 90 * deg, 1e-12) && near(q.C, 0.5e-3 * Math.SQRT2, 1e-15));
  const bv2 = bv.map((v, i) => i === 3 ? { ...v, corner: false } : v);
  const q2 = B.customProfile({ verts: bv2, join: 'straight' }, H);
  check('  the bevel top untoggled: rounded, C then M', q2.faceCorners.length === 1 && q2.Ci === 2 && q2.C === 0 && pathChecks(q2.face).jump < 1e-9);
  const q3 = B.customProfile({ verts: bv, join: 'straight', M: 3, C: 3 }, H);
  check('  M moved by hand to the bevel top: the land then 0.5 mm below the gap there', q3.Mi === 3 && q3.Ci === 3 && q3.C === 0 && near(q3.xe, 10.5e-3, 1e-17) && near(q3.hUnder(5e-3), H - 0.5e-3, 1e-17) && !q3.err, q3.err || '');
  // a bulge arc (a quarter circle of radius 0.5 mm from the land into the face), then the face
  const bu = [{ x: 0, y: 2e-3 }, { x: 10e-3, y: 2e-3, bulge: Math.tan(90 * deg / 4) }, { x: 10.5e-3, y: 2.5e-3 }, { x: 10.5e-3, y: 9e-3 }];
  const q4 = B.customProfile({ verts: bu, join: 'straight' }, H);
  const arcP = q4.face.pieces[0];
  check('a bulge: an exact arc of 0.5 mm, tangent to both sides (no corners)', arcP.kind === 'arc' && near(arcP.r, 0.5e-3, 1e-15) && q4.auto.corners.length === 0 && q4.faceCorners.length === 1 && near(q4.faceCorners[0].turn, 0, 1e-12));
}

// 5. custom, spline
console.log('\n5. Custom profiles, spline');
{
  const H = 1.7e-3, pts = [[0, 4e-3], [3e-3, 2.6e-3], [7e-3, 2.1e-3], [10e-3, 2e-3], [11e-3, 2.4e-3], [11.4e-3, 4e-3], [11.5e-3, 8e-3]];
  const p = B.customProfile({ verts: pts.map(([x, y]) => ({ x, y })), join: 'spline', cornerDeg: 60 }, H);
  let worst = 0;
  const all = B.makeBladePath([...p.under.pieces, ...p.face.pieces]), sM = p.under.len;
  p.verts.forEach((v, i) => { const q = all.P(p.vs[i] + sM); worst = Math.max(worst, Math.hypot(q[0] - v.x, q[1] - v.y)); });
  check('through its points (within 0.1 µm: the rounding of the samples)', worst < 1e-7 && !p.err, `worst ${(worst * 1e6).toFixed(3)} µm`);
  check('  smooth along both paths', pathChecks(p.under).jump < 1e-6 && pathChecks(p.face).jump < 1e-6 && p.faceCorners.length === 1 && Math.abs(p.faceCorners[0].turn) < 1e-6);
  const pc = B.customProfile({ verts: pts.map(([x, y], i) => ({ x, y, corner: i === 5 ? true : undefined })), join: 'spline', cornerDeg: 60 }, H);
  check('  a point ticked as a corner: sharp there, C', pc.faceCorners.length === 2 && Math.abs(pc.faceCorners[1].turn) > 1e-3 && pc.Ci === 5);
}

// 6. outlines
console.log('\n6. Outlines');
{
  // a two-step blade outline, counter-clockwise from the back's foot: back, land 1, riser, land 2 (M), face, notch, top
  const loop = [[0, 3.2], [8, 3.2], [8, 2.2], [14, 2.2], [14, 10], [16, 8], [16, 20], [0, 20]].map(([x, y]) => ({ x: x * 1e-3, y: y * 1e-3 }));
  const o = B.openProfile(loop, true), rev = B.openProfile(loop.slice().reverse(), true);
  const key = v => v.map(p => `${(p.x * 1e3).toFixed(1)},${(p.y * 1e3).toFixed(1)}`).join(' ');
  check('the open profile: inlet at the back\'s foot, the riser kept, up the face to the notch corner', key(o) === '0.0,3.2 8.0,3.2 8.0,2.2 14.0,2.2 14.0,10.0', key(o));
  check('  the same the other way round', key(rev) === key(o));
  const withBack = [[0, 20], [0, 3.2], [8, 3.2], [8, 2.2], [14, 2.2], [14, 10], [16, 8], [16, 20]].map(([x, y]) => ({ x: x * 1e-3, y: y * 1e-3 }));
  check('  an open chain from the blade\'s top: the back left out', key(B.openProfile(withBack, false)) === key(o));
  const p = B.customProfile({ verts: o, join: 'straight' }, 1.7e-3);
  check('  as a profile: the riser steep, two underside corners, gap H at M', !p.err && p.steep.length === 1 && p.underCorners.length === 2 && near(p.under.end[1], 1.7e-3, 1e-17) && near(p.hUnder(4e-3), 2.7e-3, 1e-15));
}

// 7. DXF and CSV
console.log('\n7. DXF and CSV');
{
  const dxf = (header, ents) => ['0', 'SECTION', '2', 'HEADER', ...header, '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', ...ents, '0', 'ENDSEC', '0', 'EOF'].join('\n');
  // the outline of an edge-radius blade in mm: land y = 2, the 0.5 mm radius into a vertical face, a notch, the top, the back
  const lw = ['0', 'LWPOLYLINE', '8', '0', '90', '7', '70', '1',
    '10', '0', '20', '2', '42', '0', '10', '10', '20', '2', '42', String(Math.tan(Math.PI / 8)), '10', '10.5', '20', '2.5', '42', '0',
    '10', '10.5', '20', '10', '42', '0', '10', '12', '20', '8', '42', '0', '10', '12', '20', '20', '42', '0', '10', '0', '20', '20', '42', '0'];
  const d = B.parseDXF(dxf(['9', '$INSUNITS', '70', '4'], lw));
  check('LWPOLYLINE: one closed chain of 7 vertices, units mm', d.chains.length === 1 && d.chains[0].closed && d.chains[0].verts.length === 7 && d.units === 1e-3);
  const o = B.openProfile(d.chains[0].verts.map(v => ({ ...v, x: v.x * 1e-3, y: v.y * 1e-3 })), true);
  const p = B.customProfile({ verts: o, join: 'straight' }, 1.7e-3);
  const arcs = p.face.pieces.filter(q => q.kind === 'arc');
  check('  its profile: the bulge an arc of 0.5 mm, no corners on the face', !p.err && arcs.length === 1 && near(arcs[0].r, 0.5e-3, 1e-15) && p.faceCorners.length === 1, p.err || '');
  // LINE + ARC entities in any order and direction, joined
  const ents = ['0', 'LINE', '8', '0', '10', '10.5', '20', '2.5', '11', '10.5', '21', '10',
    '0', 'LINE', '8', '0', '10', '10', '20', '2', '11', '0', '21', '2',
    '0', 'ARC', '8', '0', '10', '10', '20', '2.5', '40', '0.5', '50', '270', '51', '0'];
  const d2 = B.parseDXF(dxf([], ents));
  const ch = d2.chains[0];
  check('LINE and ARC: joined into one open chain; no units given', d2.chains.length === 1 && !ch.closed && ch.verts.length === 4 && d2.units === null);
  const o2 = B.openProfile(ch.verts.map(v => ({ ...v, x: v.x * 1e-3, y: v.y * 1e-3 })), false);
  const p2 = B.customProfile({ verts: o2, join: 'straight' }, 1.7e-3);
  check('  its profile matches the LWPOLYLINE\'s', !p2.err && Math.abs(p2.face.len - 0.5 * Math.PI * 0.5e-3 - 7.5e-3) < 1e-15 && near(p2.xe, 10e-3, 1e-17), `face ${p2.face.len}`);
  // POLYLINE with VERTEX entities
  const pl = ['0', 'POLYLINE', '8', '0', '66', '1', '70', '0', '0', 'VERTEX', '8', '0', '10', '0', '20', '3', '0', 'VERTEX', '8', '0', '10', '5', '20', '2', '0', 'VERTEX', '8', '0', '10', '6', '20', '9', '0', 'SEQEND'];
  const d3 = B.parseDXF(dxf([], pl));
  check('POLYLINE: its vertices', d3.chains.length === 1 && d3.chains[0].verts.length === 3 && d3.chains[0].verts[1].x === 5);
  // SPLINE: a quadratic B-spline (clamped) through its control points is a parabola between them
  const sp = ['0', 'SPLINE', '8', '0', '71', '2', '72', '6', '73', '3', '40', '0', '40', '0', '40', '0', '40', '1', '40', '1', '40', '1', '10', '0', '20', '0', '10', '1', '20', '2', '10', '2', '20', '0'];
  const d4 = B.parseDXF(dxf([], sp)), vs = d4.chains[0].verts;
  let worst = 0; for (const v of vs) worst = Math.max(worst, Math.abs(v.y - v.x * (2 - v.x)));
  check('SPLINE: the B-spline evaluated exactly (y = x (2 - x))', vs.length > 10 && worst < 1e-12, `worst ${worst.toExponential(1)}`);
  const csv = B.parsePointsCSV('x_mm,y_mm,corner\n0, 3\n5,2,1\n\n6;9\n');
  check('CSV: a header skipped, separators, a corner column', csv.length === 3 && csv[1].corner === true && csv[0].corner === undefined && csv[2].x === 6);
}

// 8. impossible shapes
console.log('\n8. Shapes that are not possible');
{
  const H = 1.7e-3, P = pts => B.customProfile({ verts: pts.map(([x, y]) => ({ x: x * 1e-3, y: y * 1e-3 })), join: 'straight' }, H);
  const over = P([[0, 3], [5, 3], [4, 2.5], [10, 2], [10, 9]]), fall = P([[0, 3], [10, 2], [11, 5], [12, 4], [12, 9]]), web = P([[0, 2.1], [5, 2.5], [10, 2], [10, 9]]);
  check('an overhanging underside', /overhang/.test(over.err || ''), over.err);
  check('a face that falls', /rise/.test(fall.err || ''), fall.err);
  const webP = B.customProfile({ verts: [[0, 0.2], [5, 4], [10, 2], [10, 9]].map(([x, y]) => ({ x: x * 1e-3, y: y * 1e-3 })), join: 'straight', M: 2 }, H);
  check('an underside that would reach the web (M by hand, the inlet 0.3 mm lower)', /touch the web/.test(webP.err || '') && !web.err, webP.err);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
