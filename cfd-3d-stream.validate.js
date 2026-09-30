/*
 * cfd-3d-stream.validate.js — checks of the 3D streamlines (cfd-3d-stream.js). Run: node cfd-3d-stream.validate.js
 *  1. A uniform flow on a curved mesh (slanted spines, a rising top, stations not evenly spaced): every line is
 *     straight (to a millionth of its length), along the flow, from the inlet to the outlet; the seeds share the inlet
 *     flow equally.
 *  2. A node field varying quadratically in every direction is interpolated exactly.
 *  3. The coating flow on a strip with nothing varying across it (the 3D solver's own result): the lines stay at their
 *     station and are the 2D's streamlines there (the 2D stream function as constant along them as along the 2D's own).
 *  4. The same with the gap varying across the strip (flow across it): a line traced to the outlet and back against
 *     the flow returns to its seed, closer as the step shrinks.
 *  5. Open sides (a skewed blade's): a uniform flow crossing the region's side -- the lines that reach it end on it,
 *     still straight; closed (the default without skew), they stay in the region to the outlet.
 *  6. Cross-flow that grows with height (w = G y): each line leaves its plane at the slope G y / u of its own height;
 *     with w = 0 the same lines stay in their planes exactly (planar is right when the field is).
 *  7. A point located in the mesh is where the mesh puts it; points in the blade, under the web, beyond the sides: none.
 *  8. Seeds: a line across the region from its lowest z to its highest (all inside, their z spread); asked inside the
 *     blade, left out; up the gap, within the local height; a plane of them.
 *  9. A slice (a station held) stays in its plane where the volume line leaves it; the slice line follows the velocity
 *     projected on the plane.
 * 10. A line through a seed inside the flow: back to the inlet, on to the outlet, through the seed; a length limit stops it.
 */
const gap = require('./cfd-gap-solver.js');
global.bandFactor = gap.bandFactor;
global.bandSolve = gap.bandSolve;
const { solveCoater3D } = require('./cfd-fem3d.js');
const { coaterGrid } = require('./cfd-fem.js');
const { makeFlowField, traceStreamline, streamlinePsiDeviation } = require('./cfd-flowviz.js');
const { streamlines3D, traceLine3D, traceThrough3D, locate3D, seeds3D, sample3D, sl3InletSeeds, sl3Eval, sl3Work } = require('./cfd-3d-stream.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

// a mesh of NC x NL x NR nodes whose coordinates are quadratic in each node index (so the elements map it exactly)
function curvedMesh(nEx, nEz, nEy, vel, planar = false) {
  const NC = 2 * nEx + 1, NL = 2 * nEz + 1, NR = 2 * nEy + 1, N = NC * NL * NR;
  const R = { NC, NL, NR, x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N), u: new Float64Array(N), v: new Float64Array(N), w: new Float64Array(N) };
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
    const n = (c * NL + l) * NR + k, s = k / (NR - 1);
    R.x[n] = 1e-3 * c + 0.2e-3 * c * s;                         // spines slanted more downstream
    R.y[n] = (2e-3 + 0.05e-3 * c + 0.004e-3 * c * c) * s;       // the top rising along the flow
    R.z[n] = 0.5e-3 * l + 0.02e-3 * l * l + (planar ? 0 : 0.01e-3 * c * l);    // stations unevenly spaced, skewed (planar: each at its own z, as the 3D solver's)
    const [u, v, w] = vel(R.x[n], R.y[n], R.z[n]); R.u[n] = u; R.v[n] = v; R.w[n] = w;
  }
  return R;
}

// 1. uniform flow: straight lines along it
{
  const U = [1e-3, 0, 0.08e-3], R = curvedMesh(6, 3, 2, () => U);
  const { lines, seeds } = streamlines3D(R, { across: 3, up: 5 });
  let dev = 0, len = 0;
  for (const ln of lines) {
    const p = ln.pos, n = p.length / 3;
    for (let i = 0; i < n; i++) {
      const dx = p[3 * i] - p[0], dy = p[3 * i + 1] - p[1], dz = p[3 * i + 2] - p[2];
      dev = Math.max(dev, Math.abs(dy), Math.abs(dz - dx * U[2] / U[0]));
    }
    len = Math.max(len, p[p.length - 3] - p[0]);
  }
  check('uniform flow on a curved mesh: every line straight, along the flow', dev < 1e-6 * len && lines.every(l => l.end === 'outlet'), `${lines.length} lines, largest deviation ${dev.toExponential(1)} m over ${(len * 1e3).toFixed(1)} mm, all reach the outlet`);
  // the inlet is x = 0 with its height linear up the spine: equal flow = equal steps up it
  const ks = seeds.filter(s => Math.abs(s[1] - seeds[0][1]) < 1e-12).map(s => s[2]), K1 = R.NR - 1;
  const want = ks.map((_, i) => (i + 0.5) / ks.length * K1);
  check('  seeds share the inlet flow equally', ks.every((k, i) => Math.abs(k - want[i]) < 1e-3), `K ${ks.map(k => k.toFixed(3)).join(' ')}`);
}

// 5. open sides: a uniform flow crossing one
{
  const U = [1e-3, 0, 0.3e-3], R = curvedMesh(6, 3, 2, () => U), L1 = R.NL - 1;
  const open = streamlines3D(R, { across: 3, up: 4, open: true }).lines, shut = streamlines3D(R, { across: 3, up: 4 }).lines;
  let dev = 0, off = 0, len = 0;
  for (const ln of open) {
    const p = ln.pos, n = p.length / 3;
    len = Math.max(len, Math.hypot(p[p.length - 3] - p[0], p[p.length - 1] - p[2]));
    for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs(p[3 * i + 1] - p[1]), Math.abs(p[3 * i + 2] - p[2] - (p[3 * i] - p[0]) * U[2] / U[0]));
    if (ln.end === 'side') off = Math.max(off, Math.abs(ln.cc[ln.cc.length - 2] - L1));
  }
  const sides = open.filter(l => l.end === 'side').length, outs = open.filter(l => l.end === 'outlet').length;
  check('open sides: the lines that reach a side end on it, still straight; the rest reach the outlet', sides > 0 && outs > 0 && sides + outs === open.length && off === 0 && dev < 1e-6 * len,
    `${sides} end on the side (exactly on it), ${outs} at the outlet; largest deviation from straight ${dev.toExponential(1)} m over ${(len * 1e3).toFixed(1)} mm`);
  check('  closed (no skew): they stay in the region to the outlet', shut.every(l => l.end === 'outlet'), `${shut.length} lines, all to the outlet`);
}

// 2. a quadratic node field, interpolated exactly
{
  const R = curvedMesh(3, 2, 2, () => [0, 0, 0]), q = (c, l, k) => 0.3 * c * c - 1.1 * l * k + 0.7 * k * k + 2 * c - l + 5;
  const vals = new Float64Array(R.NC * R.NL * R.NR);
  for (let c = 0; c < R.NC; c++) for (let l = 0; l < R.NL; l++) for (let k = 0; k < R.NR; k++) vals[(c * R.NL + l) * R.NR + k] = q(c, l, k);
  let err = 0;
  for (let t = 0; t < 200; t++) { const C = Math.random() * (R.NC - 1), L = Math.random() * (R.NL - 1), K = Math.random() * (R.NR - 1); err = Math.max(err, Math.abs(sample3D(R, vals, C, L, K) - q(C, L, K))); }
  check('a quadratic node field is interpolated exactly', err < 1e-11, `largest error ${err.toExponential(1)} (values ~10)`);
}

// 3, 4. the coating flow on a strip (web 0.1 m/s, 1 Pa s, flat land, face 90 deg, contact angle 35 deg), as the 3D solver checks
{
  const rho = 1020, g = 9.81, gamma = 0.07, H = 1.7e-3;
  const base = { hFn: () => H, xe: 5e-3, faceDeg: 90, contactDeg: 35, U: 0.1, Pup: 0, rho, g, gamma, mu: () => 1, Ld: 12e-3, nEb: 5, nEf: 3, nEs: 12, nEy: 3, fInfGuess: 0.5 * H, width: 0.02, nEz: 2 };
  const flat = solveCoater3D(base), r3 = flat.r3, r2 = flat.r2[0];
  const f2 = makeFlowField(coaterGrid(r2, { xe: base.xe, H, faceDeg: base.faceDeg, contactDeg: base.contactDeg, U: base.U }), { rho, ty: 0 });   // (the 2D as the app post-processes it)
  const { lines } = streamlines3D(r3, { across: 3, up: 8 });
  let dL = 0, psi3 = 0, psi2 = 0, gapDev = 0;
  for (const ln of lines) {
    const n = ln.pos.length / 3, pts = [];
    for (let i = 0; i < n; i++) { dL = Math.max(dL, Math.abs(ln.cc[3 * i + 1] - ln.cc[1])); pts.push([ln.pos[3 * i], ln.pos[3 * i + 1]]); }
    psi3 = Math.max(psi3, streamlinePsiDeviation(f2, { seed: pts[0], points: pts }));
    const two = traceStreamline(f2, pts[0]);
    psi2 = Math.max(psi2, streamlinePsiDeviation(f2, two));
    // (and the same path: the 3D line's points against the 2D line, as heights at the same x)
    const tp = two.points;
    for (const [x, y] of pts) {
      let j = 1; while (j < tp.length - 1 && tp[j][0] < x) j++;
      const [xa, ya] = tp[j - 1], [xb, yb] = tp[j];
      if (xb > xa && x >= xa && x <= xb) gapDev = Math.max(gapDev, Math.abs(y - (ya + (yb - ya) * (x - xa) / (xb - xa))));
    }
  }
  check('uniform strip: the lines stay at their station (no flow across it)', dL < 1e-9, `largest move across ${dL.toExponential(1)} (in stations)`);
  check('  they are the 2D streamlines there: the 2D stream function as constant along them as along the 2D\'s own', psi3 <= psi2, `drift ${(psi3 * 100).toFixed(3)} % of its range (the 2D's own lines: ${(psi2 * 100).toFixed(3)} %)`);
  check('  and on the 2D lines\' paths (to within the 2D tracer\'s own error)', gapDev < 0.01 * H, `largest height difference ${(gapDev * 1e6).toFixed(2)} um (gap ${(H * 1e3).toFixed(1)} mm)`);

  const wave = solveCoater3D({ ...base, dH: z => 150e-6 * Math.sin(2 * Math.PI * z / 0.02) });
  const w3 = wave.r3;
  let wMax = 0; for (let n = 0; n < w3.w.length; n++) wMax = Math.max(wMax, Math.abs(w3.w[n]));
  const seeds = []; for (const L of [1.3, 2.5]) for (const K of sl3InletSeeds(w3, L, 3, 1e-3)) seeds.push([1e-3, L, K]);
  const roundTrip = step => {
    let back = 0; const ends = [];
    for (const sd of seeds) {
      const fwd = traceLine3D(w3, sd, { step }), m = fwd.cc.length;
      const bwd = traceLine3D(w3, [fwd.cc[m - 3] - 1e-9, fwd.cc[m - 2], fwd.cc[m - 1]], { step, sign: -1 }), q = bwd.pos, k = q.length;
      ends.push(fwd.end + '/' + bwd.end);
      const w = sl3Work(); sl3Eval(w3, 0, sd[1], sd[2], w);   // (the seed moved onto the inlet face, where the way back ends)
      back = Math.max(back, Math.hypot(q[k - 3] - w.x, q[k - 2] - w.y, q[k - 1] - w.z));
    }
    return { back, ends };
  };
  const a = roundTrip(0.05), b = roundTrip(0.015);
  check('gap varying across the strip: a line to the outlet and back returns to its seed', a.back < 5e-3 * H && a.ends.concat(b.ends).every(e => e === 'outlet/inlet'), `largest miss ${(a.back * 1e9).toFixed(0)} nm at the app's step (flow across the strip up to ${(wMax * 1e3).toFixed(3)} mm/s)`);
  check('  closer as the step shrinks', b.back < a.back / 3, `${(b.back * 1e9).toFixed(0)} nm at a step 3.3 times smaller`);
}

// 6. cross-flow growing with height: w = G y
{
  const U0 = 1e-3, G = 0.02, R = curvedMesh(6, 3, 2, (x, y) => [U0, 0, G * y]), R0 = curvedMesh(6, 3, 2, () => [U0, 0, 0]);
  const L = streamlines3D(R, { across: 2, up: 4 }).lines, L0 = streamlines3D(R0, { across: 2, up: 4 }).lines;
  let dev = 0, moved = 0, flat = 0;
  for (const ln of L) { const p = ln.pos, n = p.length / 3, slope = G * p[1] / U0; for (let i = 0; i < n; i++) dev = Math.max(dev, Math.abs(p[3 * i + 2] - p[2] - slope * (p[3 * i] - p[0]))); moved = Math.max(moved, Math.abs(p[p.length - 1] - p[2])); }
  for (const ln of L0) { const p = ln.pos; for (let i = 2; i < p.length; i += 3) flat = Math.max(flat, Math.abs(p[i] - p[2])); }
  check('cross-flow growing with height: each line leaves its plane at its own slope G y / u', dev < 1e-6 * moved && moved > 1e-4, `moved up to ${(moved * 1e3).toFixed(3)} mm across, off the slope by ${dev.toExponential(1)} m`);
  check('  w = 0: the same lines stay in their planes', flat < 1e-9, `largest move across ${flat.toExponential(1)} m`);
}
// 7. locating points
{
  const R = curvedMesh(6, 3, 2, () => [1e-3, 0, 0]), w = sl3Work();
  let err = 0, n = 0;
  for (const [C, L, K] of [[0.3, 0.2, 0.1], [5.5, 3.7, 3.2], [11.9, 5.99, 3.99], [7.25, 1.5, 0.5]]) { sl3Eval(R, C, L, K, w); const q = locate3D(R, w.x, w.y, w.z); err = Math.max(err, Math.abs(q[0] - C), Math.abs(q[1] - L), Math.abs(q[2] - K)); n++; }
  sl3Eval(R, 6, 3, 4, w); const above = locate3D(R, w.x, w.y * 1.05, w.z), under = locate3D(R, w.x, -1e-5, w.z);
  sl3Eval(R, 6, 6, 2, w); const beyond = locate3D(R, w.x, w.y, w.z + 1e-4);
  check('a point located in the mesh is where the mesh puts it; in the blade, under the web or beyond a side: none', err < 1e-9 && above === null && under === null && beyond === null, `${n} points to ${err.toExponential(1)}; above ${above}, under ${under}, beyond ${beyond}`);
}
// 8. seeds
{
  const R = curvedMesh(6, 3, 2, () => [1e-3, 0, 0]), w = sl3Work();
  sl3Eval(R, 6, 3, 2, w);
  const xL = w.x, yL = w.y * 0.5, S = seeds3D(R, { kind: 'zline', x: xL, y: yL, n: 7 }), zs = S.seeds.map(q => { sl3Eval(R, q[0], q[1], q[2], w); return w.z; });
  // (the region's sides at that x and y: z at its first and last station there)
  const q0 = locate3D(R, xL, yL, 2e-3); sl3Eval(R, q0[0], 0, q0[2], w); const zMin = w.z; sl3Eval(R, q0[0], R.NL - 1, q0[2], w); const zMax = w.z;
  check('a seed line across the region: from its side to its side at x and y, every seed inside the flow', S.seeds.length === 7 && S.outside.length === 0 && Math.abs(Math.min(...zs) - zMin) < 1e-8 && Math.abs(Math.max(...zs) - zMax) < 1e-8 && new Set(zs.map(z => z.toFixed(9))).size === 7,
    `z ${zs.map(z => (z * 1e3).toFixed(3)).join(' ')} mm (region ${(zMin * 1e3).toFixed(3)} to ${(zMax * 1e3).toFixed(3)})`);
  sl3Eval(R, 6, 3, 4, w);
  const P = seeds3D(R, { kind: 'point', pts: [[w.x, w.y * 0.5, w.z], [w.x, w.y * 1.2, w.z]] });
  check('  a point asked inside the blade (above the flow): left out, reported', P.seeds.length === 1 && P.outside.length === 1, `${P.seeds.length} in, ${P.outside.length} outside`);
  const x0 = w.x, z0 = w.z, Y = seeds3D(R, { kind: 'yline', x: x0, z: z0, n: 5 }), ys = Y.seeds.map(q => { sl3Eval(R, q[0], q[1], q[2], w); return [w.x, w.y, w.z]; });
  // (the fluid's height at x0, z0: on the top row, where its x is x0)
  let a = 0, b = R.NC - 1; const L0 = Y.seeds[0][1]; for (let i = 0; i < 60; i++) { const m = (a + b) / 2; sl3Eval(R, m, L0, R.NR - 1, w); if (w.x < x0) a = m; else b = m; } sl3Eval(R, (a + b) / 2, L0, R.NR - 1, w); const top = w.y;
  check('  up the gap at x, z: 5 seeds evenly within the local height there, all at that x and z', Y.seeds.length === 5 && ys.every((q, i) => Math.abs(q[1] - top * (i + 0.5) / 5) < 1e-9 * top && Math.abs(q[0] - x0) < 1e-12 && Math.abs(q[2] - z0) < 1e-12), ys.map(q => (q[1] * 1e3).toFixed(4)).join(' ') + ` (height ${(top * 1e3).toFixed(4)} mm)`);
  const Pl = seeds3D(R, { kind: 'plane', plane: 'yz', at: 5e-3, n1: 4, n2: 3 });
  check('  a Y–Z plane of seeds at x 5 mm: every one inside, on that plane', Pl.seeds.length + Pl.outside.length === 12 && Pl.seeds.length > 0 && Pl.seeds.every(q => { sl3Eval(R, q[0], q[1], q[2], w); return Math.abs(w.x - 5e-3) < 1e-9; }), `${Pl.seeds.length} of 12 inside`);
}
// 9. a slice
{
  const U0 = 1e-3, R = curvedMesh(6, 3, 2, () => [U0, 0.02e-3, 0.3e-3], true), seed = [1e-3, 3, 2];
  const vol = traceLine3D(R, seed), sl = traceLine3D(R, seed, { hold: 'L' });
  let dz = 0, dL = 0, slope = 0;
  for (let i = 2; i < sl.pos.length; i += 3) dz = Math.max(dz, Math.abs(sl.pos[i] - sl.pos[2]));
  for (let i = 1; i < sl.cc.length; i += 3) dL = Math.max(dL, Math.abs(sl.cc[i] - 3));
  const n = sl.pos.length / 3; slope = (sl.pos[3 * (n - 1) + 1] - sl.pos[1]) / (sl.pos[3 * (n - 1)] - sl.pos[0]);
  const vz = Math.abs(vol.pos[vol.pos.length - 1] - vol.pos[2]);
  check('an X–Y slice (a station held): stays in its plane where the volume line leaves it', dz < 1e-15 && dL === 0 && vz > 1e-4 && sl.end === 'outlet', `slice ${dz.toExponential(1)} m off its plane; the volume line ${(vz * 1e3).toFixed(3)} mm across`);
  check('  and follows the velocity projected on it (v / u)', Math.abs(slope - 0.02) < 1e-6, `slope ${slope.toFixed(8)} (0.02)`);
}
// 10. through a seed; a length limit
{
  const R = curvedMesh(6, 3, 2, () => [1e-3, 0, 0.05e-3]), seed = [6.2, 3, 2], w = sl3Work();
  const T = traceThrough3D(R, seed); sl3Eval(R, ...seed, w);
  const sp = [T.pos[3 * T.seedAt], T.pos[3 * T.seedAt + 1], T.pos[3 * T.seedAt + 2]];
  check('a line through a seed: back to the inlet, on to the outlet, through the seed', T.start === 'inlet' && T.end === 'outlet' && Math.hypot(sp[0] - w.x, sp[1] - w.y, sp[2] - w.z) < 1e-15 && T.cc[0] < 1e-9 && T.cc[T.cc.length - 3] > R.NC - 1 - 1e-9, `${T.pos.length / 3} points`);
  const S = traceLine3D(R, [1e-3, 3, 2], { maxLength: 3e-3 }); let len = 0; for (let i = 3; i < S.pos.length; i += 3) len += Math.hypot(S.pos[i] - S.pos[i - 3], S.pos[i + 1] - S.pos[i - 2], S.pos[i + 2] - S.pos[i - 1]);
  check('  a length limit stops a line (3 mm)', S.end === 'length' && len >= 3e-3 && len < 3.5e-3, `${(len * 1e3).toFixed(3)} mm, ${S.end}`);
}

// 11. NUM-2, the adaptive integrator (Dormand-Prince 5(4)): a rotation about an axis across the web on the curved mesh (the
// velocity linear in x and y, the mesh's map quadratic: both interpolated exactly), so each line is an exact circle in its
// station's plane -- what is left of the drift is the integrator's
{
  const xc = 6e-3, yc = 1.1e-3, om = 1, R = curvedMesh(6, 2, 3, (x, y) => [-(y - yc) * om, (x - xc) * om, 0], true), r0 = 0.6e-3;
  const at = locate3D(R, xc + r0, yc, R.z[(0 * R.NL + 2) * R.NR]), L = 2 * Math.PI * r0;
  const drift = ln => { let d = 0; for (let i = 0; i < ln.pos.length; i += 3) d = Math.max(d, Math.abs(Math.hypot(ln.pos[i] - xc, ln.pos[i + 1] - yc) - r0)); return d / r0; };
  const rk4 = traceLine3D(R, at, { maxLength: L }), a6 = traceLine3D(R, at, { maxLength: L, integrator: 'rk45', tol: 1e-6 }), a9 = traceLine3D(R, at, { maxLength: L, integrator: 'rk45', tol: 1e-9 });
  check('adaptive integration (RK45): a rotation\'s lines are circles, the drift falling with the tolerance', at && a9.end === 'length' && drift(a9) < 1e-7 && drift(a9) < drift(a6),
    `drift of the radius over a turn: tolerance 1e-6 ${drift(a6).toExponential(2)}, 1e-9 ${drift(a9).toExponential(2)} (${a9.pos.length / 3} points); RK4 at its fixed step ${drift(rk4).toExponential(2)} (${rk4.pos.length / 3} points)`);
  const def = traceLine3D(R, at, { maxLength: L, integrator: 'rk4' });
  check('  Automatic is the fixed-step RK4, point for point', def.pos.length === rk4.pos.length && def.pos.every((v, i) => v === rk4.pos[i]));
  // (the uniform flow of 1: straight with the adaptive integrator too)
  const U = [1e-3, 0, 0.08e-3], Ru = curvedMesh(6, 3, 2, () => U), ln = traceLine3D(Ru, [0, 3, 2], { integrator: 'rk45' }), p = ln.pos;
  let dev = 0; for (let i = 0; i < p.length; i += 3) dev = Math.max(dev, Math.abs(p[i + 1] - p[1]), Math.abs(p[i + 2] - p[2] - (p[i] - p[0]) * U[2] / U[0]));
  check('  a uniform flow: straight to the outlet with it too', ln.end === 'outlet' && dev < 1e-6 * (p[p.length - 3] - p[0]), `deviation ${dev.toExponential(1)} m`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
