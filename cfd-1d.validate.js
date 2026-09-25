/*
 * cfd-1d.validate.js — checks of the 1D gap flow (cfd-1d.js) against exact answers:
 * run with `node cfd-1d.validate.js`.
 *  1. Newtonian, flat land, no slip: the Couette–Poiseuille flow rate q = U H / 2 + Pup H^3 / (12 mu L).
 *  2. Newtonian, round entry, no slip: the Reynolds-equation flow rate for that gap shape.
 *  3. Newtonian with Beavers–Joseph slip at the web: the closed-form profile and flow rate.
 *  4. Herschel–Bulkley and power law: a station's profile equals the exact fully developed profile
 *     (cfd-solver.js's solveFullyDeveloped1D) for the same pressure gradient, and recovers that gradient.
 *  5. The pressure: Pup at the inlet, 0 at the metering edge; the film is q / U.
 *  6. Speed of a full solve, and (reported, not a pass mark) how far the 1D is from the 2D at the defaults.
 */
const { muEffLocal, shearRateFromStress, solveFullyDeveloped1D, solveDownstreamFilm } = require('./cfd-solver.js');
Object.assign(globalThis, { muEffLocal, shearRateFromStress, solveDownstreamFilm });
const { bladeShape, station1D, solveStation1D, gapFlow1D, film1D, meniscus1D } = require('./cfd-1d.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// defaults as the app has them (cfdGeometry at location 1, SI)
const base = { shape: 'flat', U: 0.28 / 60, H: 1.7e-3, L: 10e-3, R: 0.1, Xup: 0.04, Pup: 720, muRef: 10.5, ty: 0, n: 1, webSlip: 0,
  gamma: 0.07, rho: 1020, g: 9.81, ovenDistance: 0.5 };

// 1. Newtonian flat land
{
  const g = { ...base };
  const r = gapFlow1D(g);
  const exact = g.U * g.H / 2 + g.Pup * g.H ** 3 / (12 * g.muRef * g.L);
  check('Newtonian flat land: q = U H / 2 + Pup H^3 / (12 mu L)', rel(r.q, exact) < 1e-6, `q ${r.q.toExponential(6)} exact ${exact.toExponential(6)} (${(rel(r.q, exact) * 100).toExponential(1)} %)`);
  check('  every station converged', r.converged, `worst residual ${r.worstStation.toExponential(1)}`);
  const Gexact = (r.q - g.U * g.H / 2) * 12 * g.muRef / g.H ** 3;
  check('  pressure gradient uniform, = (q - U H / 2) 12 mu / H^3', r.G.every(G => rel(G, Gexact) < 1e-6));
}
// 2. Newtonian round entry: Reynolds equation, q = (Pup + 6 mu U I2) / (12 mu I3), I_k = integral of h^-k
{
  const g = { ...base, shape: 'round' };
  const r = gapFlow1D(g, { nx: 400 });
  const shape = bladeShape({ geometry: 'round', H: g.H, R: g.R, Xup: g.Xup });
  let I2 = 0, I3 = 0; const M = 200000;
  for (let k = 0; k < M; k++) { const h = shape.h((k + 0.5) * shape.Lx / M); I2 += shape.Lx / M / (h * h); I3 += shape.Lx / M / (h * h * h); }
  const exact = (g.Pup + 6 * g.muRef * g.U * I2) / (12 * g.muRef * I3);
  check('Newtonian round entry: Reynolds-equation q', rel(r.q, exact) < 2e-4, `q ${r.q.toExponential(6)} exact ${exact.toExponential(6)} (${(rel(r.q, exact) * 100).toFixed(4)} %)`);
  const r2 = gapFlow1D(g, { nx: 800 });
  check('  converges with more stations', rel(r2.q, exact) < rel(r.q, exact) + 1e-12, `400: ${(rel(r.q, exact) * 100).toFixed(5)} %, 800: ${(rel(r2.q, exact) * 100).toFixed(5)} %`);
}
// 3. Newtonian with slip: u = A + B y - G y^2 / (2 mu), A = U + B / lam, u(h) = 0
{
  const lam = 1 / 3e-6, h = 1.7e-3, U = base.U, mu = base.muRef, G = 40000;
  const B = (G * h * h / (2 * mu) - U) / (h + 1 / lam), A = U + B / lam;
  const qExact = A * h + B * h * h / 2 - G * h ** 3 / (6 * mu);
  const s = solveStation1D(h, U, lam, { muRef: mu, ty: 0, n: 1 }, qExact, null);
  check('Newtonian with web slip: recovers the pressure gradient for its flow rate', rel(s.G, G) < 1e-6, `G ${s.G.toFixed(3)} exact ${G}`);
  check('  and the web stress mu B', rel(s.tau0, mu * B) < 1e-6);
  const r = gapFlow1D({ ...base, webSlip: lam });
  const r0 = gapFlow1D(base);
  check('  slip adds flow (the web surface moves the slurry less, the pressure more)', Number.isFinite(r.q) && r.converged, `q with slip ${r.q.toExponential(5)}, without ${r0.q.toExponential(5)}`);
}
// 4. Herschel–Bulkley and power law: against the exact fully developed profile
for (const law of [{ muRef: 10.5, ty: 5, n: 1, t: 'Bingham (ty 5 Pa)' }, { muRef: 10.5, ty: 5, n: 0.6, t: 'Herschel–Bulkley (ty 5, n 0.6)' }, { muRef: 10.5, ty: 0, n: 0.5, t: 'power law (n 0.5)' }, { muRef: 10.5, ty: 20, n: 0.8, t: 'Herschel–Bulkley (ty 20, n 0.8)' }]) {
  const h = 1.7e-3, U = base.U, G = 60000;
  const ex = solveFullyDeveloped1D({ Ly: h, U, G, muRef: law.muRef, ty: law.ty, n: law.n, ny: 20001 });
  let qEx = 0; for (let j = 0; j < ex.ny - 1; j++) qEx += ex.dy * (ex.u[j] + ex.u[j + 1]) / 2;
  const s = solveStation1D(h, U, 0, law, qEx, null, 400);
  check(`${law.t}: station recovers G for the exact profile's flow rate`, rel(s.G, G) < 2e-4 && s.converged, `G ${s.G.toFixed(2)} vs ${G} (${(rel(s.G, G) * 100).toFixed(4)} %), residual ${s.residual.toExponential(1)}`);
  const pr = station1D(h, U, 0, law, s.tau0, s.G, 400, true);
  let maxd = 0; for (let j = 0; j <= 400; j++) { const y = j * h / 400, k = Math.min(ex.ny - 1, Math.round(y / ex.dy)); maxd = Math.max(maxd, Math.abs(pr.u[j] - ex.u[k])); }
  check('  profile matches the exact one', maxd < 2e-3 * U, `max |du| ${(maxd / U * 100).toFixed(4)} % of U`);
}
// 5. pressure ends, film
{
  const g = { ...base, shape: 'round', ty: 5, n: 1 };
  const r = gapFlow1D(g);
  check('pressure: Pup at the inlet, 0 at the metering edge', Math.abs(r.p[0] - g.Pup) < 1e-9 && Math.abs(r.pEdgeResidual) < 1e-6 * g.Pup, `p(0) ${r.p[0]}, p(edge) ${r.pEdgeResidual.toExponential(2)} Pa`);
  check('film = q / U', Math.abs(r.film - r.q / g.U) < 1e-15);
  check('every station converged (Bingham, round entry)', r.converged, `worst ${r.worstStation.toExponential(1)}`);
  const f = film1D(g, r.q);
  check('film to the oven reaches q / U', f.converged && rel(f.h[f.h.length - 1], r.q / g.U) < 1e-3, `h at the oven ${(f.h[f.h.length - 1] * 1000).toFixed(4)} mm, q/U ${(r.q / g.U * 1000).toFixed(4)} mm`);
  const m = meniscus1D(r.film, g.H, 35, 45, g.gamma, g.rho, g.g);
  const lc = Math.sqrt(g.gamma / (g.rho * g.g)), hc = 2 * lc * Math.sin((135 - 35) * Math.PI / 360);
  check('meniscus on a 45° face: the Contact line tab\'s formula', Math.abs(m.hc - hc) < 1e-12);
}
// 6. speed, and 1D vs 2D at the defaults (reported)
{
  const g = { ...base, shape: 'round', ty: 5, n: 1, webSlip: 0 };
  let t = performance.now(); const r = gapFlow1D(g); t = performance.now() - t;
  console.log(`time: one location ${t.toFixed(0)} ms (${r.x.length} stations, ${r.iterations} flow-rate iterations)`);
  check('one location solves in under 300 ms', t < 300);
  let t2 = performance.now(); for (let z = 0; z < 61; z++) gapFlow1D({ ...g, H: g.H * (0.95 + 0.1 * z / 60) }); t2 = performance.now() - t2;
  console.log(`time: 61 positions across the web ${t2.toFixed(0)} ms`);
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
