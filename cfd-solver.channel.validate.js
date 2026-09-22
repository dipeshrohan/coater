/*
 * cfd-solver.channel.validate.js — correctness check for solveChannelNS
 * (the open-channel / real coating-gap solver) against the exact analytic
 * Couette-Poiseuille solution for fully-developed parallel flow.
 *
 * Why this is a real check and not circular: the inlet boundary condition
 * IS the analytic profile (by construction), but the interior 2D solve
 * knows nothing about "staying parallel" -- it discovers that on its own
 * from the momentum balance, wall conditions and outlet extrapolation. If
 * the numerics were wrong (bad BC, spurious diffusion, an outlet that
 * pollutes the interior, etc.) the solved field would develop x-dependence
 * and drift away from the inlet profile before reaching the outlet. A
 * solution that stays equal to the analytic profile at every x, to
 * shrinking error as the grid refines, is the correctness signature.
 *
 * Process defaults mirrored from physics.js's CFG (not required from it,
 * to keep this a standalone Node check -- physics.js is a browser file):
 *   U=0.28 m/min, Hm=1.90mm, tf=0.20mm, mu=10.5 Pa.s @2.7 1/s, ty=5 Pa,
 *   n=1 (Newtonian), Pup=0.72 kPa, L=10mm, rho=1020 kg/m3.
 *
 * Run: node cfd-solver.channel.validate.js [nx] [ny]
 */
const { solveChannelNS } = require('./cfd-solver.js');

const RHO = 1020;
const U_mpermin = 0.28, Hm_mm = 1.90, tf_mm = 0.20, mu0 = 10.5, ty = 5, n = 1, Pup_kPa = 0.72, L_mm = 10;

const U = U_mpermin / 60;            // m/s
const H = (Hm_mm - tf_mm) / 1000;    // m (gapHeight())
const L = L_mm / 1000;               // m
const gd = U / H;                    // representative shear rate, matches filmThickness()'s own convention
const base = Math.max(mu0 - ty / 2.7, 0.05 * mu0);
const mu = ty / gd + base * Math.pow(gd / 2.7, n - 1); // muEff(gd)
const nu = mu / RHO;
const G = (Pup_kPa * 1000) / L;      // Pa/m, physics.js's dpdx convention

console.log(`U=${U.toExponential(3)} m/s  H=${H.toExponential(3)} m  L=${L.toExponential(3)} m  mu=${mu.toFixed(3)} Pa.s  nu=${nu.toExponential(3)} m2/s  G=${G.toFixed(0)} Pa/m`);

const Re = RHO * U * H / mu;
console.log(`Reynolds number (RHO*U*H/mu) = ${Re.toExponential(3)} -- expect << 1, lubrication regime`);

const nx = parseInt(process.argv[2] || '81', 10);
const ny = parseInt(process.argv[3] || '41', 10);

const t0 = Date.now();
const sol = solveChannelNS({ nx, ny, Lx: L, Ly: H, nu, mu, U, dpdxFavorable: G, maxIter: 200000, tol: 1e-7 });
const elapsed = Date.now() - t0;
console.log(`\nGrid ${nx}x${ny}: converged=${sol.converged} iterations=${sol.iterations} residual=${sol.residual.toExponential(3)} elapsed=${elapsed}ms`);

// Compare u(y) at three x-stations (near inlet, mid-channel, near outlet)
// against the analytic profile -- should all coincide if the flow stays
// fully developed, as the exact solution requires.
function profileAt(iCol) {
  const out = [];
  for (let j = 0; j < ny; j++) out.push(sol.u[j * nx + iCol]);
  return out;
}
function maxErr(iCol) {
  const prof = profileAt(iCol);
  let e = 0;
  for (let j = 0; j < ny; j++) {
    const y = j * sol.dy;
    e = Math.max(e, Math.abs(prof[j] - sol.uIn(y)));
  }
  return e;
}
const iNearIn = 2, iMid = Math.round((nx - 1) / 2), iNearOut = nx - 3;
const errIn = maxErr(iNearIn), errMid = maxErr(iMid), errOut = maxErr(iNearOut);
console.log(`max |u - analytic| (m/s):  near-inlet=${errIn.toExponential(3)}  mid-channel=${errMid.toExponential(3)}  near-outlet=${errOut.toExponential(3)}`);
console.log(`as fraction of U:          near-inlet=${(errIn/U).toExponential(3)}  mid-channel=${(errMid/U).toExponential(3)}  near-outlet=${(errOut/U).toExponential(3)}`);

// Integrated flow rate at the outlet vs. physics.js's own filmThickness()-implied q = U*H/2 + G*H^3/(12*mu)
function flowRateAt(iCol) {
  let q = 0;
  for (let j = 1; j < ny; j++) {
    const y0 = (j - 1) * sol.dy, y1 = j * sol.dy;
    q += 0.5 * (sol.u[(j - 1) * nx + iCol] + sol.u[j * nx + iCol]) * sol.dy;
  }
  return q;
}
const qOutlet = flowRateAt(nx - 1);
const qLubrication = U * H / 2 + G * H * H * H / (12 * mu);
console.log(`\nflow rate q (m^2/s): 2D solve at outlet=${qOutlet.toExponential(4)}  physics.js lubrication formula=${qLubrication.toExponential(4)}  rel.diff=${(Math.abs(qOutlet-qLubrication)/qLubrication*100).toFixed(3)}%`);

if (!sol.converged) { console.error('\nFAIL: solver did not converge'); process.exit(1); }
if (errMid / U > 0.01) { console.error('\nFAIL: mid-channel profile deviates from the analytic solution by more than 1% of U'); process.exit(1); }
console.log('\nPASS');
