/*
 * cfd-struct.validate.js — checks of the structure carried along the 2D flow (cfd-struct.js). Run: node cfd-struct.validate.js
 *  1. Transport against the exact solution: a channel with a Couette–Poiseuille flow (straight streamlines, a
 *     different shear rate on each), rested slurry entering: lambda = lambda_e + (1 - lambda_e) exp(-(1 + gd/gdc) x / (u tb))
 *     on each streamline; on a grid slanted in x (the grid rates through the cell Jacobian) the same.
 *  2. Its limits: fast kinetics (tb tiny) steady everywhere; standing still (the blade's wall) steady at its
 *     shear rate; steady slurry entering a uniform shear stays steady.
 *  3. The coating flow with the structure fed back (flat land, the app's defaults): no contrast or fast kinetics
 *     give the steady flow's film; the default structure converges in a few outer iterations; the slurry
 *     under the blade is partly broken, the film just sheared; the film moves by the stated amount.
 */
const gap = require('../engine/cfd-gap-solver.js');
Object.assign(globalThis, { bandFactor: gap.bandFactor, bandSolve: gap.bandSolve });
const R = require('../engine/rheo.js'), S0 = require('../engine/cfd-solver.js'), FEM = require('../engine/cfd-fem.js');
Object.assign(globalThis, { femInterpolate: FEM.femInterpolate, solveCoaterFEM: FEM.solveCoaterFEM, refineCoaterFEM: FEM.refineCoaterFEM, solveFEM: FEM.solveFEM });
const { structField, solveCoaterStruct } = require('../engine/cfd-struct.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

/** A channel result: NC x NR nodes, length Lx, height Hy, u(y), shear rate |u'(y)|; x slanted by skew * y. */
function channel(NC, NR, Lx, Hy, uOf, duOf, skew = 0) {
  const N = NC * NR, x = new Float64Array(N), y = new Float64Array(N), u = new Float64Array(N), v = new Float64Array(N), gd = new Float64Array(N);
  for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) {
    const n = c * NR + k, yy = Hy * k / (NR - 1);
    x[n] = Lx * c / (NC - 1) + skew * yy; y[n] = yy; u[n] = uOf(yy); gd[n] = Math.abs(duOf(yy));
  }
  return { NC, NR, x, y, u, v, gd };
}

// 1. against the exact solution
{
  const S = { tb: 2, gdc: 1, cy: 2, ce: 2 }, Hy = 1e-3, Lx = 10e-3, U = 5e-3, G = 4000, mu = 10;
  // Couette–Poiseuille: u = U (1 - y/H) + G y (H - y) / (2 mu), always forward here
  const uOf = y => U * (1 - y / Hy) + G * y * (Hy - y) / (2 * mu), duOf = y => -U / Hy + G * (Hy - 2 * y) / (2 * mu);
  for (const skew of [0, 0.8]) {
    // (memory 40: the cut-off where the slurry forgot where it came from is e^-40 away, so the check sees the transport alone)
    const r = channel(81, 11, Lx, Hy, uOf, duOf, skew), f = structField(r, S, { lamIn: 1, memory: 40 }), fd = structField(r, S, { lamIn: 1 });
    let worst = 0, worstD = 0;
    for (let c = 0; c < r.NC; c++) for (let k = 0; k < r.NR - 1; k++) {   // (not the blade's wall, where u = 0)
      const n = c * r.NR + k, g = r.gd[n], le = 1 / (1 + g / S.gdc), xx = Lx * c / (r.NC - 1);
      const ex = le + (1 - le) * Math.exp(-(1 + g / S.gdc) * xx / (r.u[n] * S.tb));
      worst = Math.max(worst, Math.abs(f.lam[n] - ex)); worstD = Math.max(worstD, Math.abs(fd.lam[n] - ex));
    }
    check(`channel, rested slurry entering${skew ? ', grid slanted in x' : ''}: lambda = the exact solution on every streamline`, worst < 1e-10, `worst ${worst.toExponential(1)}; ${f.stats.inlet} traced to the inlet`);
    check('  with the default memory (15): within e^-15 of it', worstD < Math.exp(-15), `worst ${worstD.toExponential(1)}`);
  }
}

// 2. limits
{
  const S = { tb: 1e-7, gdc: 1, cy: 2, ce: 2 }, uOf = y => 5e-3 * (1 - y / 1e-3), duOf = () => -5;
  const r = channel(41, 9, 10e-3, 1e-3, uOf, duOf), f = structField(r, S, { lamIn: 1 });
  check('fast kinetics: steady everywhere past the inlet (its memory faded), the inlet column as it enters', f.lam.every((l, n) => n < r.NR ? l === 1 || Math.abs(l - 1 / (1 + r.gd[n])) < 1e-12 : Math.abs(l - 1 / (1 + r.gd[n])) < 1e-12) && f.stats.faded > 0);
  const f2 = structField(r, { tb: 2, gdc: 1, cy: 2, ce: 2 });
  check('  steady slurry entering a uniform shear stays steady', f2.lam.every((l, n) => Math.abs(l - 1 / 6) < 1e-12));
  const wall = [];
  for (let c = 0; c < r.NC; c++) wall.push(f2.lam[c * r.NR + r.NR - 1]);
  check('  standing still (u = 0 at the blade): steady at its shear rate', wall.every(l => Math.abs(l - 1 / 6) < 1e-12) && f2.stats.still >= r.NC - 1);
}

// 3. the coating flow with the structure fed back
{
  const H = 1.7e-3, xe = 10e-3, U = 0.28 / 60, rho = 1360, g = 9.81, gamma = 0.07;
  const law = R.rheoCompile(10.5, 5, 1), mu = gd => S0.muEffLocal(gd, 10.5, 5, 1);
  const fo = { hFn: () => H, xe, faceDeg: 90, contactDeg: 35, U, Pup: 720, rho, g, gamma, mu, gdMin: 1e-3 * U / H, Ld: 13.6e-3, nEb: 12, nEf: 6, nEs: 24, nEy: 6, fInfGuess: 1.45e-3 };
  const t0 = Date.now(), steady = FEM.solveCoaterFEM(fo), tS = Date.now() - t0;
  const film = r => r.Q / U * 1000;
  check('the steady flow (the reference)', steady.converged, `film ${film(steady).toFixed(4)} mm, ${tS} ms`);
  const none = solveCoaterStruct(fo, { tb: 30, gdc: 1, cy: 0, ce: 0 }, law, { maxOuter: 2 });
  check('no contrast: the steady flow\'s film', Math.abs(none.Q / steady.Q - 1) < 1e-8, `${film(none).toFixed(6)} vs ${film(steady).toFixed(6)} mm`);
  const fast = solveCoaterStruct(fo, { tb: 1e-6, gdc: 1, cy: 2, ce: 2 }, law, { maxOuter: 3 });
  check('fast kinetics (steady everywhere): the steady flow\'s film', Math.abs(fast.Q / steady.Q - 1) < 1e-8, `${film(fast).toFixed(8)} vs ${film(steady).toFixed(8)} mm`);
  const t1 = Date.now(), S = { tb: 30, gdc: 1, cy: 2, ce: 2 }, st = solveCoaterStruct(fo, S, law), tT = Date.now() - t1;
  const whole = FEM.solveCoaterFEM({ ...fo, muL: (gd, d) => R.rheoMuStruct(gd, Math.min(1, Math.max(0, R.rheoLamEq(gd, S) + d)), law, S), lamAt: require('../engine/cfd-struct.js').structLamAt(st, st.lam.map((l, n) => l - R.rheoLamEq(st.gd[n], S))) });
  check('the default structure: the outer iterations converge (film to 5e-4 twice, deviation to 0.02 rms); the whole flow with it agrees within 0.1 %', st.converged && st.struct.converged && !st.struct.whole && Math.abs(whole.Q / st.Q - 1) < 1e-3,
    `${st.struct.outer} flows, change rms ${st.struct.change.toExponential(1)} (largest ${st.struct.changeMax.toFixed(3)}); films ${st.struct.history.map(q => (q.Q / U * 1000).toFixed(5)).join(' → ')}; whole flow ${(whole.Q / U * 1000).toFixed(5)} mm; ${tT} ms (steady ${tS} ms)`);
  // under the blade: lambda at mid-gap mid-land, and in the film at the domain's end
  const NR = st.NR, NC = st.NC, mid = Math.floor(NC * 0.2) * NR + (NR >> 1), end = (NC - 1) * NR + (NR >> 1);
  check('  the slurry under the blade partly broken, the film just sheared: 0 < lambda < 1', st.lam[mid] > 0 && st.lam[mid] < 1 && st.lam[end] > 0 && st.lam[end] < 1, `mid-land ${st.lam[mid].toFixed(3)}, film end ${st.lam[end].toFixed(3)}`);
  const dFilm = st.Q / steady.Q - 1;
  check('  the film moves with the structure (stated)', Number.isFinite(dFilm) && Math.abs(dFilm) < 0.5, `film ${film(st).toFixed(4)} mm, ${(dFilm * 100).toFixed(2)} % from the steady flow's`);
}

// 4. the app's default blade (a round entry, R 100 mm, pool 40 mm) at location 4, the contact line up the face
{
  Object.assign(globalThis, { muEffLocal: S0.muEffLocal, shearRateFromStress: S0.shearRateFromStress, solveDownstreamFilm: S0.solveDownstreamFilm });
  const { bladeShape } = require('../engine/cfd-1d.js');
  const H = 0.001714922060834214, U = 0.28 / 60, shape = bladeShape({ geometry: 'round', H, R: 0.1, Xup: 0.04 });
  const law = R.rheoCompile(10.5, 5, 1), mu = gd => S0.muEffLocal(gd, 10.5, 5, 1);
  const fo = { hFn: shape.h, xe: shape.Lx, faceDeg: 90, contactDeg: 33.99723574146121, U, Pup: 720, rho: 1360, g: 9.81, gamma: 0.07, mu, gdMin: 1e-3 * U / H, Ld: Math.max(12e-3, 8 * H),
    nEb: 39, nEf: 6, nEs: 24, nEy: 6, gradeB: 1.6, gradeS: 1.4, gradeY: 1.5, tol: 1e-8, maxIter: 60, fInfGuess: 1.6e-3, webSlip: 337632.2135311958 };
  const t = Date.now(), steady = FEM.solveCoaterFEM(fo), st = solveCoaterStruct(fo, { tb: 30, gdc: 1, cy: 2, ce: 2 }, law), h = st.struct.history, last = h[h.length - 1];
  const tt = Date.now() - t;
  check('round entry, contact line up the face: converges, the contact line free up the face throughout', st.struct.converged && st.meniscus.mode === 'climbed',
    `${st.struct.outer} flows (${h.filter(q => q.half).length} half way, ${h.filter(q => q.whole).length} whole); films ${h.map(q => (q.Q / U * 1000).toFixed(4)).join(' → ')} mm; ${tt} ms (the whole flow again: ${st.struct.whole ? 'yes' : 'not needed'})`);
  check('  the structure thickens the slurry along the long entry: the film 3–8 % below the steady flow\'s', st.Q < steady.Q * 0.97 && st.Q > steady.Q * 0.92, `${(st.Q / U * 1000).toFixed(4)} vs ${(steady.Q / U * 1000).toFixed(4)} mm (${((st.Q / steady.Q - 1) * 100).toFixed(1)} %)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
