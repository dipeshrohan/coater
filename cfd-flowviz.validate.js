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
 *
 * Run: node cfd-flowviz.validate.js
 */
const { solveCavityNS, muEffLocal } = require('./cfd-solver.js');
const { solveGapFlow } = require('./cfd-gap-solver.js');
const { makeFlowField, sampleField, bladeHeightAt, traceStreamline, autoSeeds, flowMetrics, streamlinePsiDeviation, findEddyCentres } = require('./cfd-flowviz.js');

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

console.log(fails ? `\n${fails} check(s) FAILED` : '\nALL PASS');
if (fails) process.exit(1);
