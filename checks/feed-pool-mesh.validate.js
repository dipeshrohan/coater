/*
 * feed-pool-mesh.validate.js — checks of feed-pool-mesh.js (the pool for the paste falling onto its top). Run: node feed-pool-mesh.validate.js
 *  1. Where the pool meets a round blade: on the blade's face at the pool's level; a column of nodes there.
 *  2. The pool's volume (the Q2 elements' Jacobians) = the exact one, W (h (xJ + xBack) + ∫ blade dx), to the curve's
 *     interpolation, and closer on a finer mesh.
 *  3. Each tagged face's area = the exact one: the top (pile), the blade's face (its arc length), the web, the back edge,
 *     the pool edge (end), the side plates.
 *  4. Every element valid (the Jacobian positive at every quadrature point).
 *  5. Finer where the streams land: the elements around each outlet no larger than asked, in x and in z.
 */
const PM = require('../engine/feed-pool-mesh.js'), FS = require('../engine/feed-free.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const R = 0.1, H = 1.725e-3, blade = x => H + R - Math.sqrt(Math.max(0, R * R - x * x)), dBlade = x => x / Math.sqrt(R * R - x * x);
const W = 0.3, xBack = 0.13, xEnd = 0.04, h = 0.0367, outlets = [37.5, 112.5, 187.5, 262.5].map(z => ({ x: -0.1, z: z / 1000 }));
const G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], Wg = [5 / 9, 8 / 9, 5 / 9], Q2 = t => [t * (t - 1) / 2, 1 - t * t, t * (t + 1) / 2], DQ2 = t => [t - 0.5, -2 * t, t + 0.5];
/** The mesh's volume and its smallest Jacobian (relative to the element's mean). */
function volume(M) {
  let V = 0, worst = Infinity;
  for (let e = 0; e < M.nE; e++) {
    const el = M.elems.subarray(27 * e, 27 * e + 27); let ve = 0; const dets = [];
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const A = Q2(G[i]), B = Q2(G[j]), C = Q2(G[k]), dA = DQ2(G[i]), dB = DQ2(G[j]), dC = DQ2(G[k]), J = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
        const n = el[(g * 3 + b) * 3 + a], P = [M.X[n], M.Y[n], M.Z[n]], d = [dA[a] * B[b] * C[g], A[a] * dB[b] * C[g], A[a] * B[b] * dC[g]];
        for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) J[c * 3 + r] += d[r] * P[c];
      }
      const det = J[0] * (J[4] * J[8] - J[5] * J[7]) - J[1] * (J[3] * J[8] - J[5] * J[6]) + J[2] * (J[3] * J[7] - J[4] * J[6]);
      dets.push(det); ve += det * Wg[i] * Wg[j] * Wg[k];
    }
    V += ve; worst = Math.min(worst, Math.min(...dets) / (ve / 8));
  }
  return { V, worst };
}
const integ = (f, a, b, n = 20000) => { let s = 0; for (let i = 0; i < n; i++) { const x0 = a + (b - a) * i / n, x1 = a + (b - a) * (i + 1) / n; s += (x1 - x0) * (f(x0) + 4 * f((x0 + x1) / 2) + f(x1)) / 6; } return s; };

const M = PM.fpmMesh({ W, xBack, xEnd, h, blade, outlets, r: 3e-3 }), M2 = PM.fpmMesh({ W, xBack, xEnd, h, blade, outlets, r: 3e-3, hFine: 1e-3, hMax: 6e-3, ny: 10 });
const xJ = M.info.xJ;
// 1. where the pool meets the blade
check('where the pool meets the round blade: on its face at the level; a column of nodes there', Math.abs(blade(xJ) - h) < 1e-12 && M.info.xs.some(x => Math.abs(x - xJ) < 1e-15),
  `${(-xJ * 1e3).toFixed(3)} mm upstream of the edge, the face there ${(blade(xJ) * 1e3).toFixed(6)} mm high`);
// 2. the volume
const Vex = W * (h * (xJ + xBack) + integ(blade, xJ, -xEnd)), v1 = volume(M), v2 = volume(M2);
const e1 = Math.abs(v1.V / Vex - 1), e2 = Math.abs(v2.V / Vex - 1);
check('the pool\'s volume = the exact one, closer on a finer mesh', e1 < 1e-5 && e2 < e1, `${(Vex * 1e6).toFixed(3)} ml exact; ${M.nE} elements ${e1.toExponential(1)}, ${M2.nE} elements ${e2.toExponential(1)}`);
// 3. the faces' areas
const S = { M, X: M.X, Y: M.Y, Z: M.Z }, area = tag => [...FS.fsArea(S, [tag]).values()].reduce((a, b) => a + b, 0);
const ex = { pile: W * (xJ + xBack), blade: W * integ(x => Math.sqrt(1 + dBlade(x) ** 2), xJ, -xEnd), web: W * (xBack - xEnd), back: W * h, end: W * blade(-xEnd),
  side0: h * (xJ + xBack) + integ(blade, xJ, -xEnd), side1: h * (xJ + xBack) + integ(blade, xJ, -xEnd) };
const errs = Object.fromEntries(Object.entries(ex).map(([t, v]) => [t, Math.abs(area(t) / v - 1)]));
check('each tagged face\'s area = the exact one (top, blade, web, back edge, pool edge, side plates)', Object.values(errs).every(v => v < 1e-5),
  Object.entries(errs).map(([t, v]) => `${t} ${v.toExponential(0)}`).join(', '));
// 4. every element valid
check('every element valid: the Jacobian positive at every quadrature point', v1.worst > 0.05 && v2.worst > 0.05, `smallest, relative to the element's mean: ${v1.worst.toFixed(3)}, ${v2.worst.toFixed(3)}`);
// 5. finer where the streams land
// (the elements wholly inside each landing's zone, ±r; those across its edge grow with the size function)
const near = (a, c, r) => { let m = 0; for (let i = 0; i + 1 < a.length; i++) if (a[i] >= c - r - 1e-12 && a[i + 1] <= c + r + 1e-12) m = Math.max(m, a[i + 1] - a[i]); return m; };
const dx = near(M.info.xs, -0.1, 3e-3), dz = Math.max(...outlets.map(q => near(M.info.zs, q.z, 3e-3))), far = Math.max(...M.info.zs.slice(1).map((z, i) => z - M.info.zs[i]));
check('finer where the streams land: inside each landing\'s zone no larger than asked, in x and in z', dx > 0 && dz > 0 && dx <= 2e-3 * 1.02 && dz <= 2e-3 * 1.02 && far > 3 * dz,
  `around the outlets ${(dx * 1e3).toFixed(2)} mm (x), ${(dz * 1e3).toFixed(2)} mm (z); elsewhere up to ${(far * 1e3).toFixed(1)} mm; ${M.nE} elements, ${M.nN} nodes`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
