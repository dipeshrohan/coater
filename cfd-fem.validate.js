/*
 * cfd-fem.validate.js — checks cfd-fem.js (the finite-element solver with
 * the free surface) against exact solutions and independent results.
 * Run: node cfd-fem.validate.js   (prints PASS/FAIL per check, "ALL PASS" at the end)
 *
 *  1. Flat channel, Couette-Poiseuille (Newtonian): flow rate, and the
 *     nodal shear stress, exact.
 *  2. Flat channel, yield-stress and shear-thinning fluids: flow rate
 *     against the exact 1D fully developed solution.
 *  3. Lid-driven cavity, Re = 100: Ghia, Ghia & Shin (1982) centrelines.
 *  4. Static meniscus on the exit face (no flow): the contact line's
 *     height against the exact Young-Laplace result
 *     (f_CL - f_inf)^2 = 2 Lc^2 (1 - cos phi) + (f_end - f_inf)^2, for
 *     several face and contact angles; a pinned meniscus's angle at the
 *     edge from the same first integral; convergence with the mesh.
 *  5. Coating flow with the meniscus (web moving, surface free, contact
 *     line on the face): mass conservation, the contact angle, and grid
 *     convergence of the film thickness and the contact line.
 *  6. Round entry, no meniscus: flow rate against the stream-function
 *     solver (cfd-gap-solver.js), an independent method.
 *  7. Coating flow of a yield-stress fluid with the meniscus: converges,
 *     conserves mass, and the nodal viscosity follows the law.
 *  8. Beavers-Joseph slip over the porous web: Couette-Poiseuille with the
 *     slip condition, exact; a yield-stress fluid meets the condition
 *     du/dy = (alpha / sqrt k)(u - U) pointwise, converging with the mesh;
 *     the coating flow with slip converges and conserves mass.
 */
const gap = require('./cfd-gap-solver.js');
global.bandFactor = gap.bandFactor;
global.bandSolve = gap.bandSolve;
const { solveFEM, solveCoaterFEM, coaterGrid } = require('./cfd-fem.js');
const S = require('./cfd-solver.js');

let allPass = true;
const check = (ok, text) => { console.log((ok ? 'PASS ' : 'FAIL ') + text); if (!ok) allPass = false; };
const section = t => console.log('\n' + t);
const rho = 1020, g = 9.81, gamma = 0.07, Lcap = Math.sqrt(gamma / (rho * g));

// ---------------------------------------------------------------------
section('1. Flat channel, Couette-Poiseuille, Newtonian');
{
  const H = 1e-3, L = 5e-3, U = 0.1, mu = 2, dp = 50;
  const r = solveFEM({ mesh: { nEx: 6, nEy: 4, spineFoot: c => c / 12 * L, spineTop: c => [c / 12 * L, H] }, U, rho: 0, mu: () => mu, Hr: H, Ur: U,
    inlet: { type: 'traction', p: () => dp }, outlet: { type: 'traction', p: () => 0 } });
  const G = dp / L, Qex = U * H / 2 + G * H ** 3 / (12 * mu);
  let e = 0, m = 0;
  for (let n = 0; n < r.x.length; n++) { const t = mu * (-U / H + G / (2 * mu) * (H - 2 * r.y[n])); e = Math.max(e, Math.abs(r.tauXY[n] - t)); m = Math.max(m, Math.abs(t)); }
  check(r.converged && Math.abs(r.Q / Qex - 1) < 1e-10, `flow rate ${r.Q.toExponential(6)} vs exact ${Qex.toExponential(6)} (${Math.abs(r.Q / Qex - 1).toExponential(1)})`);
  check(e / m < 1e-10, `nodal shear stress exact to ${(e / m).toExponential(1)} of its maximum`);
}

// ---------------------------------------------------------------------
section('2. Flat channel, yield stress and shear thinning (vs the exact 1D solution)');
{
  const U = 0.28 / 60, H = 1.7e-3, L = 0.01, Pup = 720;
  for (const [ty, n, tol] of [[5, 1, 1e-3], [20, 0.5, 5e-3]]) {
    const r = solveFEM({ mesh: { nEx: 10, nEy: 8, spineFoot: c => c * L / 20, spineTop: c => [c * L / 20, H] },
      U, rho, g, mu: gd => S.muEffLocal(gd, 10.5, ty, n), Hr: H, Ur: U,
      inlet: { type: 'traction', p: y => Pup - rho * g * y }, outlet: { type: 'traction', p: y => -rho * g * y } });
    const p1 = S.solveFullyDeveloped1D({ Ly: H, U, G: Pup / L, muRef: 10.5, ty, n, ny: 8001 });
    let q1 = 0; for (let j = 1; j < p1.ny; j++) q1 += 0.5 * (p1.u[j - 1] + p1.u[j]) * p1.dy;
    check(r.converged && Math.abs(r.Q / q1 - 1) < tol, `ty ${ty} Pa, n ${n}: flow rate within ${(Math.abs(r.Q / q1 - 1) * 100).toFixed(3)}% of exact (limit ${tol * 100}%)`);
  }
}

// ---------------------------------------------------------------------
section('3. Lid-driven cavity, Re = 100 (Ghia, Ghia & Shin 1982)');
{
  const ghia_y = [0.9766, 0.9688, 0.9609, 0.9531, 0.8516, 0.7344, 0.6172, 0.5000, 0.4531, 0.2813, 0.1719, 0.1016, 0.0703, 0.0625, 0.0547];
  const ghia_u = [0.84123, 0.78871, 0.73722, 0.68717, 0.23151, 0.00332, -0.13641, -0.20581, -0.21090, -0.15662, -0.10150, -0.06434, -0.04775, -0.04192, -0.03717];
  const ghia_x = [0.9688, 0.9609, 0.9531, 0.9453, 0.9063, 0.8594, 0.8047, 0.5000, 0.2344, 0.2266, 0.1563, 0.0938, 0.0781, 0.0703, 0.0625];
  const ghia_v = [-0.05906, -0.07391, -0.08864, -0.10313, -0.16914, -0.22445, -0.24533, 0.05454, 0.17527, 0.17507, 0.16077, 0.12317, 0.10890, 0.10091, 0.09233];
  const nE = 16;
  const r = solveFEM({ mesh: { nEx: nE, nEy: nE, spineFoot: c => c / (2 * nE), spineTop: c => [c / (2 * nE), 1] },
    U: 0, topSpeed: 1, rho: 100, mu: () => 1, Hr: 1, Ur: 1, inlet: { type: 'wall' }, outlet: { type: 'wall' }, fixPressure: true });
  const NR = r.NR, NC = r.NC;
  const at = (arr, x, y) => { const fc = x * (NC - 1), fk = y * (NR - 1), c0 = Math.min(NC - 2, Math.floor(fc)), k0 = Math.min(NR - 2, Math.floor(fk)), a = fc - c0, b = fk - k0, q = (c, k) => arr[c * NR + k]; return (1 - a) * (1 - b) * q(c0, k0) + a * (1 - b) * q(c0 + 1, k0) + (1 - a) * b * q(c0, k0 + 1) + a * b * q(c0 + 1, k0 + 1); };
  let eu = 0, ev = 0, pm = 0;
  ghia_y.forEach((y, k) => { eu = Math.max(eu, Math.abs(at(r.u, 0.5, y) - ghia_u[k])); });
  ghia_x.forEach((x, k) => { ev = Math.max(ev, Math.abs(at(r.v, x, 0.5) - ghia_v[k])); });
  for (const p of r.psi) pm = Math.min(pm, p);
  check(r.converged && eu < 0.01 && ev < 0.01, `16 x 16 elements: centreline u within ${eu.toFixed(4)}, v within ${ev.toFixed(4)} of Ghia (limit 0.01)`);
  check(Math.abs(pm + 0.10342) < 0.001, `primary vortex psi_min ${pm.toFixed(5)} vs Ghia -0.10342`);
}

// ---------------------------------------------------------------------
section('4. Static meniscus on the exit face (exact Young-Laplace)');
const H = 1.7e-3, fInf = 1.2e-3, xe0 = 5e-3;
const staticCase = (face, contact, f = 1) => {
  const r = solveCoaterFEM({ hFn: () => H, xe: xe0, faceDeg: face, contactDeg: contact, U: 0, Pup: rho * g * fInf, rho, g, gamma, mu: () => 10, Ld: 12e-3,
    nEb: 10 * f, nEf: 6 * f, nEs: 24 * f, nEy: 6 * f, fInfGuess: fInf });
  const NR = r.NR, NC = r.NC, fEnd = r.y[(NC - 1) * NR + NR - 1];
  return { r, fEnd };
};
{
  for (const [face, contact] of [[90, 35], [90, 60], [120, 35], [60, 40], [90, 15]]) {
    const { r, fEnd } = staticCase(face, contact);
    const phi = (180 - contact - face) * Math.PI / 180, hc = 2 * Lcap * Math.sin(phi / 2);
    const yCL = H + r.surface.s * Math.sin(face * Math.PI / 180), exact = fInf + Math.hypot(hc, fEnd - fInf);
    const err = (yCL - exact) / hc;
    check(r.converged && r.meniscus.mode === 'climbed' && Math.abs(err) < 2e-3,
      `face ${face}°, contact ${contact}°: contact line ${(yCL * 1e3).toFixed(4)} mm above the web vs exact ${(exact * 1e3).toFixed(4)} (${(err * 100).toFixed(3)}% of the climb, limit 0.2%)`);
  }
  // pinned: first integral at the edge, (H - fInf)^2 = 2 Lc^2 (1 - cos psi) + (fEnd - fInf)^2
  const { r, fEnd } = staticCase(90, 80);
  const psi = -Math.acos(1 - ((H - fInf) ** 2 - (fEnd - fInf) ** 2) / (2 * Lcap * Lcap)) * 180 / Math.PI;
  check(r.converged && r.meniscus.mode === 'pinned' && Math.abs(r.meniscus.leaveDeg - psi) < 0.05 && psi <= r.meniscus.alphaMaxDeg,
    `face 90°, contact 80°: pinned at the edge (Gibbs: ${psi.toFixed(2)}° ≤ ${r.meniscus.alphaMaxDeg}°), surface leaves at ${r.meniscus.leaveDeg.toFixed(3)}° vs exact ${psi.toFixed(3)}°`);
  // mesh convergence
  const errs = [1, 2].map(f => {
    const { r: q, fEnd: fe } = staticCase(90, 35, f), hc = 2 * Lcap * Math.sin(55 * Math.PI / 360);
    return Math.abs(H + q.surface.s - fInf - Math.hypot(hc, fe - fInf)) / hc;
  });
  check(errs[1] < errs[0] / 2, `mesh doubled: contact-line error ${(errs[0] * 100).toFixed(4)}% -> ${(errs[1] * 100).toFixed(4)}% of the climb`);
}

// ---------------------------------------------------------------------
section('5. Coating flow with the meniscus (web 0.1 m/s, 1 Pa s, Ca 1.4)');
{
  const run = f => {
    const r = solveCoaterFEM({ hFn: () => H, xe: xe0, faceDeg: 90, contactDeg: 35, U: 0.1, Pup: 0, rho, g, gamma, mu: () => 1, Ld: 12e-3,
      nEb: 10 * f, nEf: 6 * f, nEs: 24 * f, nEy: 6 * f, fInfGuess: 0.5 * H });
    return { r, gr: coaterGrid(r, { xe: xe0, H, faceDeg: 90, contactDeg: 35, U: 0.1 }) };
  };
  const a = run(1), b = run(2);
  check(a.r.converged && b.r.converged, `converged (${a.r.meniscus.mode}, contact line ${(a.r.surface.s * 1e3).toFixed(3)} mm up the face)`);
  check(Math.abs(a.gr.massError) < 1e-4 && Math.abs(b.gr.massError) < 1e-4, `mass: outflow vs inflow ${(a.gr.massError * 100).toFixed(4)}%, ${(b.gr.massError * 100).toFixed(4)}% (fine mesh)`);
  const hEnd = a.gr.hEnd, Qu = a.r.Q / 0.1;
  check(Math.abs(hEnd / Qu - 1) < 1e-4, `film at the outlet ${(hEnd * 1e3).toFixed(5)} mm = Q/U ${(Qu * 1e3).toFixed(5)} mm (plug flow there)`);
  check(Math.abs(a.r.meniscus.leaveDeg - (-55)) < 1e-4, `surface leaves the contact line at ${a.r.meniscus.leaveDeg.toFixed(5)}° = contact angle 35° off the face`);
  const dFilm = Math.abs(a.r.Q / b.r.Q - 1);
  check(dFilm < 5e-4, `film thickness, mesh doubled: ${(a.r.Q / 0.1 * 1e3).toFixed(5)} -> ${(b.r.Q / 0.1 * 1e3).toFixed(5)} mm (${(dFilm * 100).toFixed(3)}%)`);
  const dCL = Math.abs(a.r.surface.s - b.r.surface.s);
  check(dCL < 0.02 * H, `contact line, mesh doubled: ${(a.r.surface.s * 1e3).toFixed(3)} -> ${(b.r.surface.s * 1e3).toFixed(3)} mm up the face (within ${(dCL * 1e3).toFixed(3)} mm, limit 2% of the gap)`);
}

// ---------------------------------------------------------------------
section('6. Round entry, no meniscus: against the stream-function solver');
{
  const U = 0.28 / 60, Hg = 1.7e-3, R = 0.1, X = 0.04, Pup = 720;
  const h = x => Hg + R - Math.sqrt(R * R - (X - x) ** 2);
  const law = gd => S.muEffLocal(gd, 10.5, 0, 1);
  const psiR = gap.solveGapFlow({ nx: 121, ny: 41, Lx: X, h, hx: x => -(X - x) / Math.sqrt(R * R - (X - x) ** 2), hxx: x => R * R / Math.pow(R * R - (X - x) ** 2, 1.5), U, rho, mu: law, Pup });
  const xOf = c => X * (1 - Math.pow(1 - c / 120, 2));
  const r = solveFEM({ mesh: { nEx: 60, nEy: 10, spineFoot: xOf, spineTop: c => [xOf(c), h(xOf(c))] },
    U, rho, g, mu: law, Hr: Hg, Ur: U, inlet: { type: 'traction', p: y => Pup - rho * g * y }, outlet: { type: 'traction', p: y => -rho * g * y } });
  const d = r.Q / psiR.Q - 1;
  check(r.converged && Math.abs(d) < 0.006, `film ${(r.Q / U * 1e3).toFixed(4)} mm vs ${(psiR.Q / U * 1e3).toFixed(4)} mm (${(d * 100).toFixed(2)}%; the two treat the open inlet differently: traction here, a developed profile there, which alone moves the film about 0.4%)`);
}

// ---------------------------------------------------------------------
section('7. Coating flow of a yield-stress fluid with the meniscus');
{
  const ty = 5, K = 0.5, n = 0.6, law = gd => ty / Math.max(gd, 1e-12) + K * Math.pow(Math.max(gd, 1e-12), n - 1);
  const U = 0.1, r = solveCoaterFEM({ hFn: () => H, xe: xe0, faceDeg: 90, contactDeg: 35, U, Pup: 0, rho, g, gamma, mu: law, gdMin: 1e-3 * U / H, Ld: 12e-3,
    nEb: 10, nEf: 6, nEs: 24, nEy: 6, fInfGuess: 0.5 * H });
  const gr = coaterGrid(r, { xe: xe0, H, faceDeg: 90, contactDeg: 35, U });
  check(r.converged && Math.abs(gr.massError) < 1e-4, `converged, ${r.meniscus.mode} ${(r.surface.s * 1e3).toFixed(3)} mm up the face, film ${(r.Q / U * 1e3).toFixed(4)} mm, mass ${(gr.massError * 100).toFixed(4)}%`);
  let e = 0;
  const eps = 1e-3 * U / H;
  for (let k = 0; k < r.mu.length; k++) e = Math.max(e, Math.abs(r.mu[k] / law(Math.sqrt(r.gd[k] ** 2 + eps * eps)) - 1));
  check(e < 1e-12, `nodal viscosity = the law at the nodal shear rate (${e.toExponential(1)})`);
}

// ---------------------------------------------------------------------
section('8. Beavers-Joseph slip over the porous web');
{
  const Hc = 1e-3, L = 5e-3, U = 0.1, mu = 2, dp = 50, G = dp / L;
  for (const lam of [1e3, 1e5]) {
    const r = solveFEM({ mesh: { nEx: 6, nEy: 4, spineFoot: c => c / 12 * L, spineTop: c => [c / 12 * L, Hc] }, U, rho: 0, mu: () => mu, Hr: Hc, Ur: U, webSlip: lam,
      inlet: { type: 'traction', p: () => dp }, outlet: { type: 'traction', p: () => 0 }, tol: 1e-12 });
    // exact: u = -G y^2 / (2 mu) + B y + C, u(H) = 0, u'(0) = lam (u(0) - U)
    const C = (G * Hc * Hc / (2 * mu) + lam * U * Hc) / (1 + lam * Hc), B = lam * (C - U), Qex = -G * Hc ** 3 / (6 * mu) + B * Hc * Hc / 2 + C * Hc;
    let e = 0;
    for (let n = 0; n < r.x.length; n++) e = Math.max(e, Math.abs(r.u[n] - (-G * r.y[n] ** 2 / (2 * mu) + B * r.y[n] + C)));
    check(r.converged && Math.abs(r.Q / Qex - 1) < 1e-9 && e / U < 1e-9, `slip length ${(1e6 / lam).toFixed(0)} um: flow rate and velocity exact (${Math.abs(r.Q / Qex - 1).toExponential(1)}, ${(e / U).toExponential(1)}), slip ${((C - U) / U * 100).toFixed(2)}% of U`);
  }
  const Ug = 0.28 / 60, Hg = 1.7e-3, Lg = 0.01, lam = 2e4, errs = [];
  for (const nEy of [8, 16, 32]) {
    const r = solveFEM({ mesh: { nEx: 10, nEy, spineFoot: c => c * Lg / 20, spineTop: c => [c * Lg / 20, Hg] }, U: Ug, rho, g, mu: gd => S.muEffLocal(gd, 10.5, 5, 0.6), Hr: Hg, Ur: Ug, webSlip: lam,
      inlet: { type: 'traction', p: y => 720 - rho * g * y }, outlet: { type: 'traction', p: y => -rho * g * y } });
    let w = 0;
    for (let c = 4; c < r.NC - 4; c++) { const n = c * r.NR; w = Math.max(w, Math.abs(r.tauXY[n] / r.mu[n] - lam * (r.u[n] - Ug)) / Math.abs(lam * (r.u[n] - Ug))); }
    errs.push(r.converged ? w : Infinity);
  }
  check(errs[1] < errs[0] / 3 && errs[2] < errs[1] / 3 && errs[2] < 1e-3, `yield-stress fluid: du/dy - (alpha/sqrt k)(u - U) at the web ${errs.map(e => (e * 100).toFixed(3) + '%').join(' -> ')} as the rows double`);
  const r = solveCoaterFEM({ hFn: () => H, xe: xe0, faceDeg: 90, contactDeg: 35, U: 0.1, Pup: 0, rho, g, gamma, mu: () => 1, Ld: 12e-3,
    nEb: 10, nEf: 6, nEs: 24, nEy: 6, fInfGuess: 0.5 * H, webSlip: 1 / 20e-6 });
  const gr = coaterGrid(r, { xe: xe0, H, faceDeg: 90, contactDeg: 35, U: 0.1 });
  check(r.converged && Math.abs(gr.massError) < 1e-4 && Math.abs(gr.uWeb[gr.nx - 1] - 0.1) < 1e-12,
    `coating flow with 20 um slip length: converged, ${r.meniscus.mode}, film ${(r.Q / 0.1 * 1e3).toFixed(4)} mm, mass ${(gr.massError * 100).toFixed(4)}%, plug (no slip) at the outlet`);
}

console.log(allPass ? '\nALL PASS' : '\nSOME CHECKS FAILED');
process.exitCode = allPass ? 0 : 1;
