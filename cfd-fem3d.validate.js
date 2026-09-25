/*
 * cfd-fem3d.validate.js — checks of the 3D finite-element solver (cfd-fem3d.js). Run: node cfd-fem3d.validate.js
 *  1. Rectangular duct, pressure driven (Newtonian): flow rate and centre velocity against the
 *     exact series solution.
 *  2. A manufactured 3D solution (every velocity component and every direction varying, a
 *     shear-thinning fluid, inertia) on a curved mesh (a curved top, bent spines, uneven rows),
 *     velocity given on five faces and the exact stress on the sixth: the error falls at the
 *     order of the elements as the mesh is refined, and Newton converges quadratically.
 *  3. The coating flow with the meniscus on a strip with nothing varying across it: the 2D
 *     solution at every station is already the 3D solution (the 3D residual there is below the
 *     tolerance before any Newton step).
 *  4. The same with the gap varying slowly across the strip (a 40 mm wave): the film and the
 *     contact line at every station as the 2D solves at those gaps (nothing to couple at that
 *     scale), and Newton converging quadratically with the free surface and the contact line.
 *  5. Flow under a round-entry blade whose gap varies across the web on the scale of the blade
 *     (no meniscus): the flow rate at every station against the Reynolds equation over the web's
 *     plane, which carries the flow across the web -- and clearly unlike station-by-station
 *     solutions, which do not.
 *  6. A region solved strip by strip (overlapping strips, each with its neighbours' latest solution
 *     held on its inner sides, sweep after sweep): converges to the 3D solve of the whole region.
 */
const gap = require('./cfd-gap-solver.js');
global.bandFactor = gap.bandFactor;
global.bandSolve = gap.bandSolve;
const { solveFEM3D, solveCoater3D, solveCoaterWide } = require('./cfd-fem3d.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

// 1. duct: width a (z), height b (y), length L (x); pressure drop dp
{
  const a = 2e-3, b = 1e-3, L = 2e-3, mu = 1.5, dp = 30;
  const G = dp / L;
  let S = 0; for (let n = 1; n < 200; n += 2) S += Math.tanh(n * Math.PI * a / (2 * b)) / n ** 5;
  const Qex = G * b ** 3 * a / (12 * mu) * (1 - 192 * b / (Math.PI ** 5 * a) * S);
  let uc = G / (2 * mu) * (b / 2) * (b / 2);
  for (let n = 1; n < 200; n += 2) uc -= 4 * G * b * b / (mu * Math.PI ** 3) / n ** 3 / Math.cosh(n * Math.PI * a / (2 * b)) * Math.sin(n * Math.PI / 2);
  for (const [nEy, nEz] of [[4, 6], [6, 10]]) {
    const nEx = 2;
    const t0 = Date.now();
    const r = solveFEM3D({
      mesh: { nEx, nEy, nEz, spineFoot: c => L * c / (2 * nEx), spineTop: c => [L * c / (2 * nEx), b], z: l => -a / 2 + a * l / (2 * nEz), kind: () => 'wall' },
      U: 0, rho: 0, mu: () => mu, Hr: b, Ur: Qex / (a * b), sides: 'wall',
      inlet: { type: 'traction', p: () => dp }, outlet: { type: 'traction', p: () => 0 }, tol: 1e-10,
    });
    // flow rate through the outlet: int q dz (q = int u dy per station), Simpson over the stations
    const NL = r.NL, c = r.NC - 1;
    let Q = 0; for (let l = 0; l + 2 < NL; l += 2) { const dz = r.z[(c * NL + l + 2) * r.NR] - r.z[(c * NL + l) * r.NR]; Q += dz / 6 * (r.q[c * NL + l] + 4 * r.q[c * NL + l + 1] + r.q[c * NL + l + 2]); }
    const ucN = r.u[((1 * NL) + (NL - 1) / 2) * r.NR + (r.NR - 1) / 2];
    check(`duct ${nEy}x${nEz} elements: flow rate = the series`, r.converged && Math.abs(Q / Qex - 1) < (nEz >= 10 ? 2e-4 : 2e-3), `${(Q / Qex - 1) * 100 > 0 ? '+' : ''}${((Q / Qex - 1) * 100).toFixed(4)} %  (${r.size.unknowns} unknowns, band ${r.size.band}, ${Date.now() - t0} ms)`);
    check(`  centre velocity = the series`, Math.abs(ucN / uc - 1) < (nEz >= 10 ? 2e-4 : 2e-3), `${((ucN / uc - 1) * 100).toFixed(4)} %`);
  }
}

// 2. manufactured solution
{
  // velocity: two divergence-free fields, everything varying; pressure: smooth
  const k1 = 1.3, k2 = 1.1, k3 = 0.9, k4 = 1.2, k5 = 1.4;
  const ex = (x, y, z) => [
    Math.sin(k1 * x) * Math.cos(k2 * y) * Math.cos(k3 * z) / k1,
    -Math.cos(k1 * x) * Math.sin(k2 * y) * Math.cos(k3 * z) / k2 + Math.sin(k4 * y) * Math.cos(k5 * z) * Math.cos(x) / k4,
    -Math.cos(k4 * y) * Math.sin(k5 * z) * Math.cos(x) / k5,
  ];
  const pex = (x, y, z) => Math.cos(x) * Math.sin(y) * (1 + z);
  const Re = 2, nPow = 0.7;
  const muLaw = gd => Math.pow(Math.sqrt(gd * gd + 1e-6) / Math.sqrt(1 + 1e-6), nPow - 1);   // (mu(1) = 1: the solver's units are the problem's)
  const h = 1e-4;
  const grad = (x, y, z) => {
    const g = [];
    for (let j = 0; j < 3; j++) g.push([0, 0, 0]);
    const P = [[h, 0, 0], [0, h, 0], [0, 0, h]];
    for (let i = 0; i < 3; i++) {
      const a = ex(x + P[i][0], y + P[i][1], z + P[i][2]), b = ex(x - P[i][0], y - P[i][1], z - P[i][2]);
      for (let j = 0; j < 3; j++) g[j][i] = (a[j] - b[j]) / (2 * h);
    }
    return g;
  };
  const tau = (x, y, z) => {
    const g = grad(x, y, z), D = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { D[i][j] = 0.5 * (g[i][j] + g[j][i]); s += D[i][j] * D[i][j]; }
    const m = muLaw(Math.sqrt(2 * s));
    return D.map(r => r.map(v => 2 * m * v));
  };
  const H2 = 1e-3;
  const force = (x, y, z) => {
    const u = ex(x, y, z), g = grad(x, y, z), P = [[H2, 0, 0], [0, H2, 0], [0, 0, H2]];
    const divT = [0, 0, 0], gp = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const a = tau(x + P[i][0], y + P[i][1], z + P[i][2]), b = tau(x - P[i][0], y - P[i][1], z - P[i][2]);
      for (let j = 0; j < 3; j++) divT[j] += (a[j][i] - b[j][i]) / (2 * H2);
      gp[i] = (pex(x + P[i][0], y + P[i][1], z + P[i][2]) - pex(x - P[i][0], y - P[i][1], z - P[i][2])) / (2 * H2);
    }
    return [0, 1, 2].map(j => Re * (u[0] * g[j][0] + u[1] * g[j][1] + u[2] * g[j][2]) + gp[j] - divT[j]);
  };
  const errs = [], sizes = [];
  let quad = null;
  for (const n of [2, 3, 4]) {
    const topY = (x, z) => 1 + 0.15 * Math.sin(Math.PI * x) * Math.cos(0.5 * Math.PI * z);
    const t0 = Date.now();
    const r = solveFEM3D({
      mesh: {
        nEx: n, nEy: n, nEz: n,
        spineFoot: c => c / (2 * n), z: l => l / (2 * n), kind: () => 'wall',
        spineTop: (c, l) => [c / (2 * n) + 0.08 * Math.sin(Math.PI * c / (2 * n)), topY(c / (2 * n), l / (2 * n))],
        spineSlope: (c, l) => 0.1 * Math.sin(Math.PI * c / (2 * n)),
        eta: k => { const t = k / (2 * n); return t * (1.2 - 0.2 * t); },
      },
      U: 0, rho: Re, mu: gd => muLaw(gd), Hr: 1, Ur: 1, gdMin: 1e-10,
      // (velocity on five faces, the exact stress on the outlet: with velocity on every face and one pressure pinned, the
      // pinned vertex's mass balance is dropped and the boundary data's discrete flux imbalance lands there)
      inlet: { type: 'wall' }, outlet: { type: 'stress', sigma: (x, y, z) => { const T = tau(x, y, z), p = pex(x, y, z); return T.map((r, i) => r.map((v, j) => v - (i === j ? p : 0))); } }, sides: 'wall',
      force, exactBC: (x, y, z) => ex(x, y, z), tol: 1e-11, maxIter: 30,
    });
    let e = 0, ep = 0;
    for (let m = 0; m < r.x.length; m++) {
      const E = ex(r.x[m], r.y[m], r.z[m]);
      e = Math.max(e, Math.abs(r.u[m] - E[0]), Math.abs(r.v[m] - E[1]), Math.abs(r.w[m] - E[2]));
    }
    // (pressure at the vertices: the solver's own unknowns)
    for (let c = 0; c < r.NC; c += 2) for (let l = 0; l < r.NL; l += 2) for (let k = 0; k < r.NR; k += 2) { const m = (c * r.NL + l) * r.NR + k; ep = Math.max(ep, Math.abs(r.p[m] - pex(r.x[m], r.y[m], r.z[m]))); }
    errs.push([e, ep]); sizes.push(1 / n);
    if (n === 3) quad = r.history.map(h => h.residual);
    check(`manufactured solution, ${n}^3 elements: converged`, r.converged, `velocity error ${e.toExponential(2)}, pressure ${ep.toExponential(2)}, ${r.iterations} Newton steps, ${r.size.unknowns} unknowns, ${Date.now() - t0} ms`);
  }
  const order = (i, j, k) => Math.log(errs[i][k] / errs[j][k]) / Math.log(sizes[i] / sizes[j]);
  check('  velocity error falls at order >= 2.7 (Q2: 3)', order(1, 2, 0) > 2.7, `order ${order(0, 1, 0).toFixed(2)}, ${order(1, 2, 0).toFixed(2)}`);
  check('  pressure error falls at order >= 1.8 (Q1: 2)', order(1, 2, 1) > 1.8, `order ${order(0, 1, 1).toFixed(2)}, ${order(1, 2, 1).toFixed(2)}`);
  // quadratic convergence: each residual about the square of the one before (once close)
  const tail = quad.filter(v => v < 1e-2 && v > 1e-12);
  const rates = []; for (let i = 1; i < tail.length; i++) rates.push(Math.log(tail[i]) / Math.log(tail[i - 1]));
  check('  Newton converges quadratically (the Jacobian is exact)', rates.length > 0 && Math.max(...rates) > 1.6, `residuals ${quad.map(v => v.toExponential(1)).join(' ')}`);
}

// 3, 4. the coating flow with the meniscus on a strip (web 0.1 m/s, 1 Pa s, flat land, face 90 deg, contact angle 35 deg)
{
  const rho = 1020, g = 9.81, gamma = 0.07, H = 1.7e-3;
  const base = { hFn: () => H, xe: 5e-3, faceDeg: 90, contactDeg: 35, U: 0.1, Pup: 0, rho, g, gamma, mu: () => 1, Ld: 12e-3, nEb: 5, nEf: 3, nEs: 12, nEy: 3, fInfGuess: 0.5 * H, width: 0.02, nEz: 2 };
  const flat = solveCoater3D(base);
  const r3 = flat.r3, r2 = flat.r2[0];
  let du = 0, umax = 0;
  for (let c = 0; c < r3.NC; c++) for (let l = 0; l < r3.NL; l++) for (let k = 0; k < r3.NR; k++) {
    const n3 = (c * r3.NL + l) * r3.NR + k, n2 = c * r3.NR + k;
    du = Math.max(du, Math.hypot(r3.u[n3] - r2.u[n2], r3.v[n3] - r2.v[n2], r3.w[n3])); umax = Math.max(umax, Math.abs(r2.u[n2]));
  }
  check('uniform strip: the 2D solution at every station is the 3D solution', r3.converged && r3.iterations === 0 && du / umax < 1e-12 && flat.stations.every(st => st.s === r2.surface.s),
    `3D residual there ${r3.residual.toExponential(1)}, ${flat.mode}, contact line ${(r2.surface.s * 1e3).toFixed(4)} mm, film ${(flat.stations[0].film * 1e3).toFixed(5)} mm`);
  const wave = solveCoater3D({ ...base, dH: z => 30e-6 * Math.sin(2 * Math.PI * z / 0.04) });
  const w3 = wave.r3, worstF = Math.max(...wave.stations.map(st => Math.abs(st.film / st.film2 - 1))), worstS = Math.max(...wave.stations.map(st => Math.abs(st.s - st.s2)));
  check('gap varying slowly across the strip (+-30 um, 40 mm wave): film at every station = the 2D at that gap', w3.converged && worstF < 1e-3,
    `within ${(worstF * 100).toFixed(3)} %: ${wave.stations.map(st => (st.film * 1e3).toFixed(4)).join(', ')} mm`);
  check('  contact line at every station = the 2D at that gap', worstS < 2e-6, `within ${(worstS * 1e6).toFixed(2)} um`);
  const hs = w3.history.map(h => h.residual).filter(v => v > 1e-13);
  const rates = []; for (let i = 1; i < hs.length; i++) if (hs[i - 1] < 1e-2) rates.push(Math.log(hs[i]) / Math.log(hs[i - 1]));
  check('  Newton with the free surface and the contact line converges quadratically', rates.length > 0 && Math.min(...rates) > 1.6, `residuals ${w3.history.map(h => h.residual.toExponential(1)).join(' ')}`);
}
// 5. round entry, gap varying across the web on the blade's scale: against the Reynolds equation over the web's plane
{
  const R0 = 0.1, Xup = 0.04, H = 1.7e-3, A = 0.4e-3, lam = 0.04, Wd = lam / 2, U = 0.28 / 60, mu = 10, Pin = 700;
  const hb = x => H + R0 - Math.sqrt(R0 * R0 - (Xup - x) ** 2), dH = z => A * Math.cos(2 * Math.PI * z / lam);
  // Reynolds: d/dx(h^3 p_x) + d/dz(h^3 p_z) = 6 mu U h_x (coupled), or the z term left out (station by station); flux form, banded
  const reynolds = (nx, nz, coupled) => {
    const dx = Xup / (nx - 1), dz = Wd / (nz - 1), N = nx * nz, id = (i, k) => i * nz + k, kl = nz, W = 3 * kl + 1;
    const M = new Float64Array(N * W), b = new Float64Array(N), put = (r, c, v) => { M[r * W + c - r + kl] += v; }, h = (x, z) => hb(x) + dH(z);
    for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
      const r = id(i, k), x = i * dx, z = k * dz;
      if (i === 0 || i === nx - 1) { put(r, r, 1); b[r] = i === 0 ? Pin : 0; continue; }
      const cw = h(x - dx / 2, z) ** 3, ce = h(x + dx / 2, z) ** 3;
      put(r, id(i - 1, k), cw / dx ** 2); put(r, id(i + 1, k), ce / dx ** 2); put(r, r, -(cw + ce) / dx ** 2);
      if (coupled) { const cm = h(x, z - dz / 2) ** 3, cp = h(x, z + dz / 2) ** 3; put(r, id(i, k === 0 ? 1 : k - 1), cm / dz ** 2); put(r, id(i, k === nz - 1 ? nz - 2 : k + 1), cp / dz ** 2); put(r, r, -(cm + cp) / dz ** 2); }
      b[r] = 6 * mu * U * (h(x + dx / 2, z) - h(x - dx / 2, z)) / dx;
    }
    bandSolve(M, bandFactor(M, N, kl, kl), N, kl, kl, b);
    return k => { const hh = h(Xup, k * dz), px = (3 * b[id(nx - 1, k)] - 4 * b[id(nx - 2, k)] + b[id(nx - 3, k)]) / (2 * dx); return -(hh ** 3) / (12 * mu) * px + U * hh / 2; };
  };
  const nz = 161, RC = reynolds(1601, nz, true), RL = reynolds(1601, nz, false);
  const nEx = 16, nEz = 4, xOf = c => Xup * (1 - Math.pow(1 - c / (2 * nEx), 1.6));
  const r = solveFEM3D({
    mesh: { nEx, nEy: 4, nEz, spineFoot: c => xOf(c), spineTop: (c, l) => [xOf(c), hb(xOf(c)) + dH(Wd * l / (2 * nEz))], z: l => Wd * l / (2 * nEz), kind: () => 'wall' },
    U, rho: 0, mu: () => mu, Hr: H, Ur: U, inlet: { type: 'traction', p: () => Pin }, outlet: { type: 'traction', p: () => 0 }, sides: 'symmetry', tol: 1e-10,
  });
  let wC = 0, wL = 0;
  for (let l = 0; l < r.NL; l++) { const k = Math.round((nz - 1) * l / (r.NL - 1)), q = r.q[(r.NC - 1) * r.NL + l]; wC = Math.max(wC, Math.abs(q / RC(k) - 1)); wL = Math.max(wL, Math.abs(q / RL(k) - 1)); }
  check('round entry, gap +-0.4 mm across the web (40 mm wave): flow rate at every station = Reynolds with the flow across the web', r.converged && wC < 0.01, `within ${(wC * 100).toFixed(2)} % (the lubrication approximation's own error; unchanged on a finer mesh)`);
  check('  and unlike station-by-station solutions (no flow across the web)', wL > 0.04, `up to ${(wL * 100).toFixed(1)} % apart`);
}

// 6. strip by strip against the whole region at once (60 mm, the gap and the contact angle varying across it)
{
  const rho = 1020, g = 9.81, gamma = 0.07, H = 1.7e-3;
  const base = { hFn: () => H, xe: 5e-3, faceDeg: 90, contactDeg: 35, U: 0.1, Pup: 0, rho, g, gamma, mu: () => 1, Ld: 12e-3, nEb: 5, nEf: 3, nEs: 12, nEy: 3, fInfGuess: 0.5 * H,
    width: 0.06, nEz: 6, dH: z => 60e-6 * Math.sin(2 * Math.PI * z / 0.04), contactAt: z => 35 + 3 * Math.cos(2 * Math.PI * z / 0.03) };
  const one = solveCoater3D(base);
  const wide = solveCoaterWide({ ...base, sub: 4, overlap: 2, tolSweep: 1e-8 });
  const dF = Math.max(...wide.stations.map((st, l) => Math.abs(st.film - one.stations[l].film))), dS = Math.max(...wide.stations.map((st, l) => Math.abs(st.s - one.stations[l].s)));
  check('region strip by strip (3 overlapping strips): converges to the whole region solved at once', one.r3.converged && wide.converged && dF < 1e-9 && dS < 1e-9,
    `${wide.sweeps} sweeps (changes ${wide.history.map(v => v.toExponential(0)).join(', ')} of the gap); film within ${(dF * 1e9).toFixed(2)} nm, contact line within ${(dS * 1e9).toFixed(2)} nm`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
