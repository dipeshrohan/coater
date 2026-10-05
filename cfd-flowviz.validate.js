/*
 * cfd-flowviz.validate.js — correctness checks for cfd-flowviz.js's
 * streamline tracing, seeding and metrics, on two independent fields:
 *
 *  1. The metering-gap channel (the field the app actually shows):
 *     psi must stay constant along every traced streamline (exact
 *     property of steady 2D incompressible flow), traced segments must be
 *     tangent to the interpolated velocity, no line may leave the domain
 *     (= enter the blade or web), forward lines must end on the outflow,
 *     and auto-seeds must be equally spaced in psi.
 *  2. The Re=100 lid-driven cavity (a field with real recirculation):
 *     traced lines around the vortex must close on themselves, and the
 *     detected eddy centre must match the published Ghia, Ghia & Shin
 *     (1982) primary vortex centre (0.6172, 0.7344), psi_min -0.10342.
 *  3. Paths in time (T-6: pathlines and streaklines through the flow kept at even times): against exact paths in
 *     flows given in closed form on curved Q2 grids that differ at each kept time -- a uniform flow and a rotation whose
 *     speeds change linearly in time (exact), a shear and a swinging flow that change as a sine in time (second order in
 *     the kept interval, the velocity being linear in time between kept times), the top coming down through a parcel --
 *     and on a real coating flow marched in time (cfd-fem-time.js): a ring of parcels keeps its area (the paste cannot
 *     be squeezed), and in a steady flow a parcel keeps to its streamline and takes the streamline's own time.
 *
 * Run: node cfd-flowviz.validate.js
 */
const { solveCavityNS, muEffLocal } = require('./cfd-solver.js');
const { solveGapFlow } = require('./cfd-gap-solver.js');
const { makeFlowField, sampleField, bladeHeightAt, traceStreamline, autoSeeds, flowMetrics, streamlinePsiDeviation, findEddyCentres, contourLines, meshQuality,
  streamlineTimes, tracePathline, pathAt, pathTo, traceStreakline, streakAt } = require('./cfd-flowviz.js');

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// ---------------------------------------------------------------- channel
{
  const RHO = 1020, U = 0.28 / 60, H = 1.70e-3, L = 10e-3;
  const r = solveGapFlow({ nx: 121, ny: 41, Lx: L, h: () => H, U, rho: RHO, mu: gd => muEffLocal(gd, 10.5, 5, 1), Pup: 720 });
  const f = makeFlowField(r, { rho: RHO, ty: 5 });
  console.log('\n-- metering-gap channel (defaults) --');

  const seeds = autoSeeds(f, 16, 'forward');
  check(seeds.length === 16, `16 auto seeds on the inflow line (got ${seeds.length})`);
  const psiAtSeeds = seeds.map(s => sampleField(f, f.psi, s[0], s[1]));
  const Q = f.psiLand - f.psiWeb;
  let spacingErr = 0;
  psiAtSeeds.forEach((p, m) => { spacingErr = Math.max(spacingErr, Math.abs(p - (f.psiWeb + Q * (m + 1) / 17)) / Q); });
  check(spacingErr < 1e-6, `seeds equally spaced in psi (max error ${spacingErr.toExponential(2)} of Q)`);

  const t0 = Date.now();
  const lines = seeds.map(s => traceStreamline(f, s, { direction: 'forward' }));
  const ms = Date.now() - t0;
  let maxDev = 0, maxAngle = 0, allInside = true, allOutflow = true;
  for (const ln of lines) {
    maxDev = Math.max(maxDev, streamlinePsiDeviation(f, ln));
    for (let p = 0; p < ln.points.length; p++) {
      const [x, y] = ln.points[p];
      if (x < -1e-12 || x > f.Lx + 1e-12 || y < -1e-12 || y > f.Ly + 1e-12) allInside = false;
      if (p > 0 && p < ln.points.length - 1) {
        const [x0, y0] = ln.points[p - 1], [x1, y1] = ln.points[p + 1];
        const sx = (x1 - x0) / f.dx, sy = (y1 - y0) / f.dy;
        const ux = sampleField(f, f.u, x, y) / f.dx, uy = sampleField(f, f.v, x, y) / f.dy;
        const cos = (sx * ux + sy * uy) / (Math.hypot(sx, sy) * Math.hypot(ux, uy));
        maxAngle = Math.max(maxAngle, Math.acos(Math.min(1, cos)) * 180 / Math.PI);
      }
    }
    const end = ln.points[ln.points.length - 1];
    if (!(ln.endReason === 'boundary' && Math.abs(end[0] - f.Lx) < 1e-9)) allOutflow = false;
  }
  check(maxDev < 2e-3, `psi constant along every streamline (max deviation ${(maxDev * 100).toFixed(4)}% of psi range)`);
  check(maxAngle < 2, `segments tangent to interpolated velocity (max angle ${maxAngle.toFixed(3)} deg, in grid-index space)`);
  check(allInside, 'no streamline point outside the fluid domain (blade/web)');
  check(allOutflow, 'every forward streamline ends on the outflow at the metering edge');
  console.log(`   traced 16 lines in ${ms} ms`);

  const mid = [f.Lx / 2, f.Ly * 0.4];
  const back = traceStreamline(f, mid, { direction: 'backward' });
  const both = traceStreamline(f, mid, { direction: 'both' });
  check(Math.abs(back.points[0][0]) < 1e-9, 'backward trace from mid-channel reaches the inflow');
  check(Math.abs(both.points[0][0]) < 1e-9 && Math.abs(both.points[both.points.length - 1][0] - f.Lx) < 1e-9, 'both-direction trace spans inflow to outflow');
  check(back.points[1][0] > back.points[0][0], 'backward trace returned in flow order (arrows point downstream)');

  const m = flowMetrics(f);
  check(m.reverseFraction === 0 && m.recircArea === 0, 'no reverse flow / recirculation reported in the parallel channel (correct for this domain)');
  check(m.stagnation.length === 0, 'no interior stagnation reported');
  check(Math.abs(m.meanGapVelocity * f.Ly - Q) < 1e-15, 'mean gap velocity x H = through-flow Q');
}

// ----------------------------------------------------------------- cavity
{
  console.log('\n-- lid-driven cavity, Re=100 (independent field with recirculation) --');
  const N = 97;
  const r = solveCavityNS({ nx: N, ny: N, Lx: 1, Ly: 1, nu: 0.01, wallU: { top: 1 }, maxIter: 80000, tol: 1e-7 });
  const f = makeFlowField(r);
  const eddies = findEddyCentres(f);
  const c = eddies[0];
  const h = 1 / (N - 1);
  const dist = Math.hypot(c.x - 0.6172, c.y - 0.7344);
  check(dist < 1.5 * h, `primary vortex centre (${c.x.toFixed(4)}, ${c.y.toFixed(4)}) vs Ghia (0.6172, 0.7344): ${(dist / h).toFixed(2)} cells`);
  check(Math.abs(c.psi - (-0.10342)) / 0.10342 < 0.03, `psi_min ${c.psi.toFixed(5)} vs Ghia -0.10342 (${(Math.abs(c.psi + 0.10342) / 0.10342 * 100).toFixed(2)}%)`);

  const seeds = autoSeeds(f, 8, 'forward');
  const eddySeeds = seeds.slice(8);
  check(eddySeeds.length >= 3, `auto-seeding adds seeds inside the eddy (${eddySeeds.length})`);
  const loops = eddySeeds.map(s => traceStreamline(f, s, { direction: 'forward' }));
  const closed = loops.filter(l => l.endReason === 'closed').length;
  check(closed === loops.length, `eddy streamlines close on themselves (${closed}/${loops.length})`);
  const dev = Math.max(...loops.map(l => streamlinePsiDeviation(f, l)));
  check(dev < 5e-3, `psi constant around the closed loops (max ${(dev * 100).toFixed(3)}% of psi range)`);

  const m = flowMetrics(f);
  const nearCentre = m.stagnation.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 3 * h);
  check(nearCentre, `a stagnation point is found at the vortex centre (${m.stagnation.length} region(s) total)`);
  check(m.recircFraction > 0.9, `recirculation covers the closed cavity (${(m.recircFraction * 100).toFixed(1)}% of area)`);
}

// ------------------------------------------------------------ round entry
{
  console.log('\n-- round entry onto the metering edge (curved blade, returning flow) --');
  const RHO = 1020, U = 0.28 / 60, H = 1.70e-3, R = 0.1, X = 0.04;
  const r = solveGapFlow({
    nx: 121, ny: 41, Lx: X, U, rho: RHO, mu: () => 10.5, Pup: 720,
    h: x => H + R - Math.sqrt(R * R - (X - x) ** 2), hx: x => -(X - x) / Math.sqrt(R * R - (X - x) ** 2), hxx: x => R * R / Math.pow(R * R - (X - x) ** 2, 1.5),
  });
  const f = makeFlowField(r, { rho: RHO, ty: 0 });
  const seeds = autoSeeds(f, 16, 'forward');
  const lines = seeds.map(s => traceStreamline(f, s, { direction: 'forward' }));
  const through = lines.slice(0, 16), back = lines.slice(16);
  let maxDev = 0, inside = true;
  for (const ln of lines) {
    maxDev = Math.max(maxDev, streamlinePsiDeviation(f, ln));
    for (const [x, y] of ln.points) if (y < -1e-12 || y > bladeHeightAt(f, x) * (1 + 1e-9)) inside = false;
  }
  check(maxDev < 3e-3, `psi constant along every streamline (max deviation ${(maxDev * 100).toFixed(4)}% of psi range)`);
  check(inside, 'no streamline point inside the curved blade or below the web');
  check(through.every(ln => Math.abs(ln.points[ln.points.length - 1][0] - f.Lx) < 1e-9), 'every through-flow line ends at the metering edge');
  check(back.length >= 2 && back.every(ln => ln.points[ln.points.length - 1][0] < 1e-9), `returning-flow lines (${back.length}) turn back and leave toward the pool`);
  const m = flowMetrics(f);
  check(m.reverseFraction > 0, `reverse flow found in the converging entry (${(m.reverseFraction * 100).toFixed(1)}% of area)`);
  check(Math.abs(m.meanGapVelocity * f.Hedge - r.Q) < 1e-15, 'mean velocity at the edge x edge gap = through-flow Q');
}

console.log('\n-- contour lines and mesh quality (display helpers) --');
{
  // f = x^2 + y^2 on a sheared grid: every contour point on its circle (to the edges' linear interpolation), one line per level
  const nx = 41, ny = 21, gx = new Float64Array(nx * ny), gy = new Float64Array(nx * ny), a = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; gx[k] = i / (nx - 1) + 0.1 * j / (ny - 1); gy[k] = j / (ny - 1); a[k] = gx[k] ** 2 + gy[k] ** 2; }
  const res = contourLines({ nx, ny, gx, gy }, a, 1, [0.25, 0.5, 1]);
  let err = 0;
  for (const { v, lines } of res) for (const l of lines) for (const [x, y] of l) err = Math.max(err, Math.abs(x * x + y * y - v));
  check(res.every(r => r.lines.length === 1) && err < 1e-3, `contours of x^2 + y^2: one line per level, on the circle to ${err.toExponential(1)}`);
  // cells with no data (NaN nodes) are skipped: no NaN points, and lines stop at the gap
  const holed = Float64Array.from(a, (v, k) => gx[k] > 0.5 ? NaN : v);
  const rh = contourLines({ nx, ny, gx, gy }, holed, 1, [0.25, 0.5]);
  const finite = rh.every(r => r.lines.every(l => l.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));
  const inHalf = rh.every(r => r.lines.every(l => l.every(([x]) => x <= 0.5 + 1e-9)));
  check(finite && inHalf && rh.every(r => r.lines.length >= 1), 'contours skip cells with no data (NaN): finite points, none past the gap');
  // mesh quality: an undistorted (parallelogram) grid is 1 everywhere; a bent one below 1
  const q1 = meshQuality({ nx, ny, gx, gy });
  const bent = Float64Array.from(gy, (y, k) => y * (1 + 0.5 * gx[k]));
  const q2 = meshQuality({ nx, ny, gx, gy: bent });
  check(Math.abs(q1.worst - 1) < 1e-12 && q2.worst < 0.99 && q2.worst > 0, `mesh quality: parallelogram grid ${q1.worst.toFixed(6)}, tapered grid worst ${q2.worst.toFixed(3)}`);
}

// ---------------------------------------------------------------- NUM-2: the adaptive integrator
// Solid-body rotation on a uniform grid: the velocity is linear, so the bilinear interpolation is exact and the
// streamlines are exact circles -- what is left of the drift is the integrator's own.
{
  console.log('\n-- adaptive streamline integration (Dormand-Prince 5(4)) on an exact rotation --');
  const n = 41, dx = 0.025, xc = 0.5, yc = 0.5, N = n * n, u = new Float64Array(N), v = new Float64Array(N);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; u[k] = -(j * dx - yc); v[k] = i * dx - xc; }
  const f = makeFlowField({ nx: n, ny: n, dx, dy: dx, u, v }, {});
  const run = r0 => { const seed = [xc + r0, yc], drift = ln => Math.max(...ln.points.map(([x, y]) => Math.abs(Math.hypot(x - xc, y - yc) - r0))) / r0;
    const o = { direction: 'forward', maxCells: 200 }, rk4 = traceStreamline(f, seed, o), a6 = traceStreamline(f, seed, { ...o, integrator: 'rk45', tol: 1e-6 }), a9 = traceStreamline(f, seed, { ...o, integrator: 'rk45', tol: 1e-9 });
    return { rk4, a6, a9, d4: drift(rk4), d6: drift(a6), d9: drift(a9) }; };
  const big = run(0.3), tight = run(0.05), seed = [xc + 0.3, yc], rk4 = big.rk4;
  check([big, tight].every(q => q.rk4.endReason === 'closed' && q.a6.endReason === 'closed' && q.a9.endReason === 'closed'), `the circles close on themselves with either integrator (radius 12 cells: RK4 ${big.rk4.points.length} points, RK45 ${big.a6.points.length})`);
  check(big.d6 < 1e-6 && big.d9 < 1e-7 && big.a6.points.length < big.rk4.points.length, `RK45 on a gentle curve (12 cells): within its tolerance in longer steps (drift ${big.d6.toExponential(1)}, ${big.a6.points.length} points against RK4's ${big.rk4.points.length}, drift ${big.d4.toExponential(1)})`);
  check(tight.d9 < 1e-7 && tight.d9 < tight.d6 && tight.d6 < 1e-4, `RK45 on a tight curve (2 cells): the drift falls with the tolerance (1e-6: ${tight.d6.toExponential(2)}, 1e-9: ${tight.d9.toExponential(2)}; RK4 at its fixed step: ${tight.d4.toExponential(2)})`);
  const def = traceStreamline(f, seed, { direction: 'forward', maxCells: 200, integrator: 'rk4' });
  check(def.points.length === rk4.points.length && def.points.every((p, k) => p[0] === rk4.points[k][0] && p[1] === rk4.points[k][1]), 'Automatic is the fixed-step RK4, point for point');
}
// ---------------------------------------------------------------- T-6: paths in time
{
  console.log('\n-- paths in time: pathlines and streaklines against exact paths --');
  // a curved Q2 grid over [0, Lx] x [0, top], its inner nodes moved (a wave, its phase different at each kept time), the
  // velocity vel(x, y) at its nodes
  const grid = (nx, ny, Lx, top, phase, vel) => {
    const N = nx * ny, gx = new Float64Array(N), gy = new Float64Array(N), u = new Float64Array(N), v = new Float64Array(N);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, s = i / (nx - 1), e = j / (ny - 1);
      gx[k] = Lx * s + 0.4 * Lx / nx * Math.sin(Math.PI * s) * Math.sin(Math.PI * e + phase);
      gy[k] = top * e + 0.4 * top / ny * Math.sin(Math.PI * e) * Math.sin(2 * Math.PI * s + phase);
      [u[k], v[k]] = vel(gx[k], gy[k]);
    }
    return makeFlowField({ grid: 'curvilinear', nx, ny, gx, gy, u, v, gd: new Float64Array(N) }, {});
  };
  const framesOf = (n, T, mk) => Array.from({ length: n }, (_, k) => { const t = T * k / (n - 1); return { t, f: mk(t, k) }; });
  const worst = (p, exact) => Math.max(...p.points.map(([x, y], m) => { const [ex, ey] = exact(p.t[m]); return Math.hypot(x - ex, y - ey); }));
  {
    // uniform, its speed linear in time: x = x0 + U0 t + a t^2 / 2 (the velocity's blend in time is then exact)
    const T = 2, U0 = 0.3, a = 0.2, V0 = 0.05, b = -0.04, fr = framesOf(11, T, (t, k) => grid(41, 21, 2, 1, 0.7 * k, () => [U0 + a * t, V0 + b * t]));
    const p = tracePathline(fr, [0.2, 0.3]), e = worst(p, t => [0.2 + U0 * t + a * t * t / 2, 0.3 + V0 * t + b * t * t / 2]);
    check(p.reason === 'time' && Math.abs(p.tEnd - T) < 1e-15 && e < 1e-12, `uniform flow speeding up in time: on the exact path to ${e.toExponential(1)} m over ${p.points.length - 1} steps, to the last kept time`);
  }
  {
    // rotation, the rate linear in time: on its circle, at the angle w0 t + a t^2 / 2
    const T = 3, w0 = 1, a = 0.5, xc = 1, yc = 0.5, r0 = 0.3;
    const fr = framesOf(7, T, (t, k) => grid(41, 21, 2, 1, 0.9 * k, (x, y) => { const w = w0 + a * t; return [-w * (y - yc), w * (x - xc)]; }));
    const p = tracePathline(fr, [xc + r0, yc]), e = worst(p, t => { const th = w0 * t + a * t * t / 2; return [xc + r0 * Math.cos(th), yc + r0 * Math.sin(th)]; }) / r0;
    check(p.reason === 'time' && e < 1e-6, `rotation turning faster in time (${((w0 * T + a * T * T / 2) / (2 * Math.PI)).toFixed(2)} turns): on the exact circle and angle to ${e.toExponential(1)} of the radius`);
  }
  {
    // shear, a sine in time: x = x0 + y0 g0 T/pi (1 - cos(pi t / T)); between kept times the blend is linear: second order
    const T = 1, g0 = 2, x0 = 0.2, y0 = 0.6;
    const e = [11, 21, 41].map(n => worst(tracePathline(framesOf(n, T, (t, k) => grid(41, 21, 3, 1, 0.5 * k, (x, y) => [g0 * Math.sin(Math.PI * t / T) * y, 0])), [x0, y0], { tol: 1e-8 }),
      t => [x0 + y0 * g0 * T / Math.PI * (1 - Math.cos(Math.PI * t / T)), y0]));
    const o = [Math.log2(e[0] / e[1]), Math.log2(e[1] / e[2])];
    check(o.every(q => Math.abs(q - 2) < 0.1) && e[2] < 5e-4, `shear changing as a sine in time: 10, 20, 40 kept intervals ${e.map(q => q.toExponential(2)).join(', ')} m (order ${o.map(q => q.toFixed(2)).join(', ')})`);
  }
  {
    // the top coming down through a parcel (a free surface moving): the parcel goes on with the flow while either kept
    // time around it has it, and leaves within one kept interval after the top passes it (t = 0.5)
    const T = 1, U = 0.5, yp = 0.8, fr = framesOf(21, T, (t, k) => grid(41, 21, 2, 1 - 0.4 * t, 0.3 * k, () => [U, 0]));
    const p = tracePathline(fr, [0.1, yp]), e = worst(p, t => [0.1 + U * t, yp]);
    check(p.reason === 'left' && p.out === 'wall' && p.tEnd >= 0.5 && p.tEnd <= 0.55 + 1e-12 && e < 1e-12, `the top comes down through a parcel: on its path to ${e.toExponential(1)} m, leaves at t = ${p.tEnd.toFixed(3)} (the top passes it at 0.500, kept every 0.050)`);
  }
  {
    // the textbook case: u = U, v = V0 sin(w t). The parcel let out at tau is at time t at (xs + U (t - tau),
    // ys + V0/w (cos w tau - cos w t)): the streakline at t is a wave, the pathline from t = 0 another curve, the
    // streamline at t a straight line
    const T = 2, U = 0.5, V0 = 0.2, w = 2 * Math.PI / T, xs = 0.1, ys = 0.5;
    const res = [11, 21, 41].map(n => {
      const fr = framesOf(n, T, (t, k) => grid(41, 21, 2, 1, 0.4 * k, () => [U, V0 * Math.sin(w * t)]));
      const s = traceStreakline(fr, [xs, ys], { tol: 1e-8, every: T / 40 }), at = t => streakAt(s, t);
      let es = 0, count = 0;
      for (const tt of [T / 2, T]) for (const l of at(tt)) for (const [x, y] of l) { const tau = tt - (x - xs) / U; es = Math.max(es, Math.abs(y - (ys + V0 / w * (Math.cos(w * tau) - Math.cos(w * tt))))); count++; }
      const pl = tracePathline(fr, [xs, ys], { tol: 1e-8 }), ep = worst(pl, t => [xs + U * t, ys + V0 / w * (1 - Math.cos(w * t))]);
      const half = pathTo(pl, T / 2), ex = [xs + U * T / 2, ys + V0 / w * (1 - Math.cos(w * T / 2))];
      return { es, ep, count, lines: at(T).length, n: at(T)[0].length, half: Math.hypot(half.at[0] - ex[0], half.at[1] - ex[1]), last: half.points[half.points.length - 1][0] === half.at[0] && half.points[half.points.length - 1][1] === half.at[1] };
    });
    const os = Math.log2(res[1].es / res[2].es), op = Math.log2(res[1].ep / res[2].ep);
    check(res.every(r => r.lines === 1 && r.n === 41) && Math.abs(os - 2) < 0.1 && res[2].es < 5e-4, `swinging flow, the streakline (41 parcels let out over the time) on the exact wave: ${res.map(r => r.es.toExponential(2)).join(', ')} m for 10, 20, 40 kept intervals (order ${os.toFixed(2)})`);
    check(Math.abs(op - 2) < 0.1 && res[2].ep < 5e-4 && res.every(r => r.half < 2 * r.ep + 1e-12 && r.last), `and the pathline from t = 0 on its own exact curve: ${res.map(r => r.ep.toExponential(2)).join(', ')} m (order ${op.toFixed(2)}); the path drawn to half time ends where the parcel is then`);
  }
  {
    // pathAt before the release and after the parcel has gone: none
    const fr = framesOf(5, 1, (t, k) => grid(21, 11, 1, 1, k, () => [2, 0])), p = tracePathline(fr, [0.5, 0.5], { t0: 0.25 });
    check(p.reason === 'left' && p.out === 'outlet' && pathAt(p, 0.1) === null && pathAt(p, 0.9) === null && Math.abs(pathAt(p, 0.4)[0] - 0.8) < 1e-12 && Math.abs(p.tEnd - 0.5) < 1e-6,
      `a parcel let out at t = 0.25 leaves through the outflow at ${p.tEnd.toFixed(6)} (exact 0.5): no place before it is let out, nor after it has gone`);
  }

  // a real coating flow (cfd-fem-time.js 5's: web 0.1 m/s, 1 Pa s), its bead pressure stepped from 0 to 150 Pa, kept 20 times over 0.2 s
  const gap = require('./cfd-gap-solver.js');
  global.bandFactor = gap.bandFactor; global.bandSolve = gap.bandSolve;
  const { solveCoaterFEM, coaterGrid } = require('./cfd-fem.js');
  const { femMarch } = require('./cfd-fem-time.js');
  const rho = 1020, g = 9.81, H = 1.7e-3, xe = 5e-3, U = 0.1, geo = { xe, H, faceDeg: 90, contactDeg: 35, U };
  const base = { hFn: () => H, xe, faceDeg: 90, contactDeg: 35, U, rho, g, gamma: 0.07, mu: () => 1, Ld: 12e-3, nEb: 10, nEf: 6, nEs: 24, nEy: 6, fInfGuess: 0.5 * H };
  const r0 = solveCoaterFEM({ ...base, Pup: 0 }), tEnd = 0.2, n = 20;
  const m = femMarch(r0, { at: () => ({ inlet: { type: 'traction', p: y => 150 - rho * g * y } }), tEnd, dt0: 1e-4, tol: 1e-3, times: Array.from({ length: n }, (_, k) => (k + 1) * tEnd / n),
    keep: (rr, t, info) => coaterGrid(info ? { ...rr, meshInfo: info.meshInfo, meniscus: { ...r0.meniscus, mode: info.mode, s: rr.surface.s } } : rr, geo) });
  const frames = [{ t: 0, f: makeFlowField(coaterGrid(r0, geo), { rho, ty: 0 }) }, ...m.frames.map(q => ({ t: q.t, f: makeFlowField(q.r, { rho, ty: 0 }) }))];
  {
    // a ring of 400 parcels in the gap, under the edge and at the inlet: the area it holds stays (incompressible); at t = 0
    // the polygon's own area, 1 - (2 pi^2 / 3) / 400^2 of the circle's
    const K = 400, drift = [];
    for (const [cx, cy, rr] of [[2.5e-3, 0.8e-3, 0.2e-3], [4.5e-3, 1.2e-3, 0.15e-3], [1.0e-3, 0.4e-3, 0.2e-3]]) {
      const paths = Array.from({ length: K }, (_, k) => tracePathline(frames, [cx + rr * Math.cos(2 * Math.PI * k / K), cy + rr * Math.sin(2 * Math.PI * k / K)], { t1: 0.05 }));
      const area = t => { const P = paths.map(p => pathAt(p, t)); let A = 0; for (let k = 0; k < K; k++) A += P[k][0] * P[(k + 1) % K][1] - P[(k + 1) % K][0] * P[k][1]; return A / 2; };
      const A0 = area(0);
      drift.push(Math.max(...[0.01, 0.02, 0.05].map(t => Math.abs(area(t) / A0 - 1))));
    }
    check(m.completed && Math.max(...drift) < 2e-3, `coating flow, bead pressure stepped (${m.frames.length} kept times, ${m.remeshes.length} new mesh): rings of 400 parcels keep their area to ${drift.map(d => (d * 100).toFixed(3) + '%').join(', ')} over 0.05 s`);
  }
  {
    // the steady flow (the same kept field at both ends): each parcel stays on its streamline (psi) and reaches the end of
    // the 2D domain in the streamline's own time (streamlineTimes)
    const f = frames[0].f, st = [{ t: 0, f }, { t: 1, f }];
    let range = 0; for (const q of f.psi) range = Math.max(range, Math.abs(q));
    let dev = 0, dT = 0, out = true;
    for (const s of autoSeeds(f, 12, 'both')) {
      const p = tracePathline(st, s), p0 = sampleField(f, f.psi, s[0], s[1]);
      for (const [x, y] of p.points) dev = Math.max(dev, Math.abs(sampleField(f, f.psi, x, y) - p0) / range);
      const sl = traceStreamline(f, s, { direction: 'forward', integrator: 'rk45', tol: 1e-8 }), ts = streamlineTimes(f, sl);
      dT = Math.max(dT, Math.abs(p.tEnd / ts[ts.length - 1] - 1));
      out = out && p.reason === 'left' && p.out === 'outlet' && sl.endReason === 'boundary';
    }
    check(out && dev < 1e-3 && dT < 1e-3, `steady coating flow: 12 parcels from under the edge keep to their streamlines (psi within ${(dev * 100).toFixed(4)}% of its range) and leave the 2D domain in the streamline's time (within ${(dT * 100).toFixed(4)}%)`);
  }
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASS');
if (fails) process.exit(1);
