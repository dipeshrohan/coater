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
 */
const gap = require('./cfd-gap-solver.js');
global.bandFactor = gap.bandFactor;
global.bandSolve = gap.bandSolve;
const { solveCoater3D } = require('./cfd-fem3d.js');
const { coaterGrid } = require('./cfd-fem.js');
const { makeFlowField, traceStreamline, streamlinePsiDeviation } = require('./cfd-flowviz.js');
const { streamlines3D, traceLine3D, sample3D, sl3InletSeeds, sl3Eval, sl3Work } = require('./cfd-3d-stream.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

// a mesh of NC x NL x NR nodes whose coordinates are quadratic in each node index (so the elements map it exactly)
function curvedMesh(nEx, nEz, nEy, vel) {
  const NC = 2 * nEx + 1, NL = 2 * nEz + 1, NR = 2 * nEy + 1, N = NC * NL * NR;
  const R = { NC, NL, NR, x: new Float64Array(N), y: new Float64Array(N), z: new Float64Array(N), u: new Float64Array(N), v: new Float64Array(N), w: new Float64Array(N) };
  for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
    const n = (c * NL + l) * NR + k, s = k / (NR - 1);
    R.x[n] = 1e-3 * c + 0.2e-3 * c * s;                         // spines slanted more downstream
    R.y[n] = (2e-3 + 0.05e-3 * c + 0.004e-3 * c * c) * s;       // the top rising along the flow
    R.z[n] = 0.5e-3 * l + 0.02e-3 * l * l + 0.01e-3 * c * l;    // stations unevenly spaced, skewed
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

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
