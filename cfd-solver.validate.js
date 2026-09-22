/*
 * cfd-solver.validate.js — correctness check for cfd-solver.js against an
 * independent, published benchmark (not against this app's own formulas).
 *
 * Reference: Ghia, U., Ghia, K.N., Shin, C.T. (1982), "High-Re Solutions
 * for Incompressible Flow Using the Navier-Stokes Equations and a
 * Multigrid Method", Journal of Computational Physics, 48(3), 387-411.
 * Lid-driven square cavity, Re=100, u-velocity along the vertical
 * centerline and v-velocity along the horizontal centerline.
 *
 * Run: node cfd-solver.validate.js [gridSize]
 * Expect: max abs error shrinking as gridSize increases (the signature of
 * a convergent numerical method), landing under ~0.01 at 97-129 points.
 */
const { solveCavityNS } = require('./cfd-solver.js');

const ghia_y = [1.0000, 0.9766, 0.9688, 0.9609, 0.9531, 0.8516, 0.7344, 0.6172, 0.5000, 0.4531, 0.2813, 0.1719, 0.1016, 0.0703, 0.0625, 0.0547, 0.0000];
const ghia_u = [1.0000, 0.84123, 0.78871, 0.73722, 0.68717, 0.23151, 0.00332, -0.13641, -0.20581, -0.21090, -0.15662, -0.10150, -0.06434, -0.04775, -0.04192, -0.03717, 0.0000];
const ghia_x = [1.00000, 0.9688, 0.9609, 0.9531, 0.9453, 0.9063, 0.8594, 0.8047, 0.5000, 0.2344, 0.2266, 0.1563, 0.0938, 0.0781, 0.0703, 0.0625, 0.0000];
const ghia_v = [0.00000, -0.05906, -0.07391, -0.08864, -0.10313, -0.16914, -0.22445, -0.24533, 0.05454, 0.17527, 0.17507, 0.16077, 0.12317, 0.10890, 0.10091, 0.09233, 0.00000];

const N = parseInt(process.argv[2] || '65', 10);
const Re = 100, U = 1, L = 1, nu = U * L / Re;

console.log(`Grid: ${N}x${N}, Re=${Re}, nu=${nu}`);
const t0 = Date.now();
const sol = solveCavityNS({ nx: N, ny: N, Lx: L, Ly: L, nu, wallU: { top: U }, maxIter: 60000, tol: 1e-7 });
console.log(`converged=${sol.converged} iterations=${sol.iterations} residual=${sol.residual.toExponential(3)} elapsed=${Date.now() - t0}ms`);

function sampleU(y) {
  const j = y * (sol.ny - 1), j0 = Math.floor(j), j1 = Math.min(j0 + 1, sol.ny - 1), f = j - j0;
  const i = Math.round((sol.nx - 1) / 2);
  const u0 = sol.u[j0 * sol.nx + i], u1 = sol.u[j1 * sol.nx + i];
  return u0 + (u1 - u0) * f;
}
function sampleV(x) {
  const i = x * (sol.nx - 1), i0 = Math.floor(i), i1 = Math.min(i0 + 1, sol.nx - 1), f = i - i0;
  const j = Math.round((sol.ny - 1) / 2);
  const v0 = sol.v[j * sol.nx + i0], v1 = sol.v[j * sol.nx + i1];
  return v0 + (v1 - v0) * f;
}

let maxErrU = 0, maxErrV = 0;
for (let k = 0; k < ghia_y.length; k++) maxErrU = Math.max(maxErrU, Math.abs(sampleU(ghia_y[k]) - ghia_u[k]));
for (let k = 0; k < ghia_x.length; k++) maxErrV = Math.max(maxErrV, Math.abs(sampleV(ghia_x[k]) - ghia_v[k]));
console.log(`max abs error vs Ghia et al. (1982): u=${maxErrU.toFixed(4)}  v=${maxErrV.toFixed(4)}`);

if (!sol.converged) { console.error('FAIL: solver did not converge'); process.exit(1); }
if (maxErrU > 0.03 || maxErrV > 0.03) { console.error('FAIL: error vs published benchmark exceeds 3%'); process.exit(1); }
console.log('PASS');
