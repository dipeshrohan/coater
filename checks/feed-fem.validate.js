/*
 * feed-fem.validate.js — checks of feed-fem.js (the 3D flow on the coater's block mesh) against exact solutions.
 * Run: node feed-fem.validate.js
 *  1. Plane Poiseuille flow between plates (pressure driven, Newtonian): the quadratic profile is in the elements, so the
 *     solution is exact to round-off; the flow rate exact.
 *  2. The Newton Jacobian (applied element by element) against finite differences of the residual: a shear-thinning
 *     paste with a yield stress, inertia and gravity, on a curved mesh.
 *  3. A manufactured solution (every component varying in every direction, a curved mesh, Newtonian): the velocity's error
 *     falls at the elements' order (3) and the pressure's at least at 2 as the mesh is refined.
 *  4. The multigrid preconditioner: GMRES iterations stay nearly level as the mesh is refined.
 *  5. The Schur complement's thin-film part: each node's response to a pressure gradient (φ) exact in a film and in a
 *     channel; on a thin film GMRES several times shorter with it than without, and level under refinement.
 *  6. A scraping corner (the web running under a face that takes no flow): marked 'over', nothing leaks through the face.
 *  7. Slip along a curved surface's own normal (a tilted channel): exact; nothing through the lid; the lid's normal stress.
 *  8. A free surface's tension: paste at rest under a dome, the pressure σ/R.
 *  9. Gravity tilted and a free top with its tension: Nusselt's film down an incline, exact.
 * 10. A slip surface with a given velocity through it (a pool's top moving, paste falling into it): u = b(x² + y²),
 *     v = −2bxy, p = 4μbx (shear-free everywhere) with the top's normal velocity −2bxH given; exact, level and tilted.
 * 11. A free top relaxing (a wave on a layer of paste, its bottom a wall, its weight and its tension pulling it flat): the
 *     speed of its top against the exact one (Stokes flow in the layer by hand: a 4 × 4 system for the stream function),
 *     γ = (ρ g + σ k²) G(k, d, μ); and with the free top's implicit weight over a step Δt, γ / (1 + γ_g Δt), γ_g its
 *     weight's part.
 */
const FF = require('../engine/feed-fem.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

/** A box of nx × ny × nz Q2 hexahedra in feed-mesh.js's format, nodes mapped by f; faces tagged x0, x1, y0, y1, z0, z1. */
function box(Lx, Ly, Lz, nx, ny, nz, f = (x, y, z) => [x, y, z]) {
  const NX = 2 * nx + 1, NY = 2 * ny + 1, NZ = 2 * nz + 1, nN = NX * NY * NZ, id = (i, j, k) => (k * NY + j) * NX + i;
  const X = new Float64Array(nN), Y = new Float64Array(nN), Z = new Float64Array(nN);
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const p = f(Lx * i / (NX - 1), Ly * j / (NY - 1), Lz * k / (NZ - 1)); const n = id(i, j, k); X[n] = p[0]; Y[n] = p[1]; Z[n] = p[2]; }
  const nE = nx * ny * nz, elems = new Int32Array(27 * nE), faces = [];
  let e = 0;
  for (let ez = 0; ez < nz; ez++) for (let ey = 0; ey < ny; ey++) for (let ex = 0; ex < nx; ex++, e++) {
    for (let g = 0; g < 3; g++) for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) elems[27 * e + (g * 3 + b) * 3 + a] = id(2 * ex + a, 2 * ey + b, 2 * ez + g);
    if (ex === 0) faces.push({ e, f: 0, tag: 'x0' }); if (ex === nx - 1) faces.push({ e, f: 1, tag: 'x1' });
    if (ey === 0) faces.push({ e, f: 2, tag: 'y0' }); if (ey === ny - 1) faces.push({ e, f: 3, tag: 'y1' });
    if (ez === 0) faces.push({ e, f: 4, tag: 'z0' }); if (ez === nz - 1) faces.push({ e, f: 5, tag: 'z1' });
  }
  return { X, Y, Z, elems, nE, nN, faces };
}
const norm = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0));

// 1. plane Poiseuille: u = G y (H − y) / (2 μ), p = G (L − x); plates at y = 0, H; inflow given, outflow traction-free…
{
  const L = 4e-3, H = 1e-3, Wz = 1e-3, mu = 2, G = 1e5;    // (Pa/m)
  const M = box(L, H, Wz, 4, 2, 2);
  const ue = (x, y) => G * y * (H - y) / (2 * mu);
  const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, bc: {
    y0: { type: 'velocity', u: [0, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: (x, y) => [ue(x, y), 0, 0] },
    z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' },
    // the outlet's traction: σ·n with n = +x: (−p + 2μ ∂u/∂x, μ ∂u/∂y, 0) = (−p, μ du/dy, 0) at x = L, p = 0 there
    x1: { type: 'traction', t: (x, y) => [0, G * (H - 2 * y) / 2, 0] } } });
  const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
  let eu = 0, um = 0, ep = 0;
  for (let n = 0; n < M.nN; n++) { eu = Math.max(eu, Math.abs(R.u[n] - ue(M.X[n], M.Y[n])), Math.abs(R.v[n]), Math.abs(R.w[n])); um = Math.max(um, ue(M.X[n], M.Y[n])); if (!isNaN(R.p[n])) ep = Math.max(ep, Math.abs(R.p[n] - G * (L - M.X[n]))); }
  const Q = FF.ffFlow(S, R.x, 'x1'), Qe = G * H ** 3 / (12 * mu) * Wz;
  check('plane Poiseuille: velocity and pressure exact to round-off; Newton in one step', eu / um < 1e-9 && ep / (G * L) < 1e-8 && R.hist.length <= 2,
    `velocity ${(eu / um).toExponential(1)}, pressure ${(ep / (G * L)).toExponential(1)} (relative); Newton ${R.hist.length}, GMRES ${R.hist.map(h => h.lin).join(', ')}`);
  check('plane Poiseuille: the flow rate out exact', Math.abs(Q - Qe) / Qe < 1e-9, `${Q.toExponential(6)} against ${Qe.toExponential(6)} m³/s`);
}

// 2. the Jacobian against finite differences (shear-thinning with a yield stress, inertia, gravity, a curved mesh)
{
  const curved = (x, y, z) => [x + 0.15e-3 * Math.sin(2000 * y) * Math.cos(1500 * z), y * (1 + 0.2 * Math.sin(800 * x)), z + 0.1e-3 * Math.sin(1700 * x + 900 * y)];
  const M = box(2e-3, 1e-3, 1e-3, 2, 2, 2, curved);
  const tauY = 5, K = 8, nn = 0.6, law = gd => tauY / gd + K * Math.pow(gd, nn - 1);
  const S = FF.ffSetup({ mesh: M, mu: law, gdMin: 0.5, rho: 1400, g: 9.81, Lr: 1e-3, Ur: 5e-3, bc: { y0: { type: 'velocity', u: [5e-3, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] }, z0: { type: 'slip', normal: 'z' } } });
  const x = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) x[i] = S.fix[i] ? S.val[i] : Math.sin(1.3 * i) * (i < S.nU ? 0.8 : 3);
  const R0 = FF.ffResidual(S, x), d = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) d[i] = S.fix[i] ? 0 : Math.cos(0.7 * i);
  const Jd = FF.ffJacVec(S, d), h = 1e-6, xp = x.map((v, i) => v + h * d[i]), xm = x.map((v, i) => v - h * d[i]);
  const Rp = FF.ffResidual(S, xp).slice(), Rm = FF.ffResidual(S, xm).slice();
  const fd = Rp.map((v, i) => S.fix[i] ? d[i] : (v - Rm[i]) / (2 * h));
  const err = norm(fd.map((v, i) => v - Jd[i])) / norm(fd);
  check('the Jacobian against finite differences (yield stress, shear-thinning, inertia, gravity, curved mesh)', err < 1e-6, `relative difference ${err.toExponential(1)}`);
  void R0;
}

// 3. a manufactured solution: u = U0 (sin x cos y cos z, cos x sin y cos z, −2 cos x cos y sin z) in mm (divergence-free;
//    each component an eigenfunction of the Laplacian: Δu = −3 u / s²), p = P0 cos x sin(y + z); the force that makes it exact
{
  const s = 1e-3, U0 = 1e-3, P0 = 1, mu = 1;
  const uex = (X, Y, Z) => { const x = X / s, y = Y / s, z = Z / s; return [U0 * Math.sin(x) * Math.cos(y) * Math.cos(z), U0 * Math.cos(x) * Math.sin(y) * Math.cos(z), -2 * U0 * Math.cos(x) * Math.cos(y) * Math.sin(z)]; };
  const pex = (X, Y, Z) => P0 * Math.cos(X / s) * Math.sin(Y / s + Z / s);
  const force = (X, Y, Z) => { const u = uex(X, Y, Z), x = X / s, y = Y / s, z = Z / s;
    const gp = [-P0 * Math.sin(x) * Math.sin(y + z) / s, P0 * Math.cos(x) * Math.cos(y + z) / s, P0 * Math.cos(x) * Math.cos(y + z) / s];
    return [0, 1, 2].map(i => 3 * mu * u[i] / (s * s) + gp[i]); };
  const curved = (x, y, z) => [x + 0.08e-3 * Math.sin(3000 * y), y + 0.06e-3 * Math.sin(2500 * x) * Math.cos(2000 * z), z];
  const res = [];
  for (const n of [2, 4]) {
    const M = box(1e-3, 1e-3, 1e-3, n, n, n, curved);
    const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-3, fixPressure: true,
      bc: Object.fromEntries(['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].map(t => [t, { type: 'velocity', u: uex }])) });
    const fsrc = ffForce(S, M, force);
    const p0n = [...Array(M.nN).keys()].find(k => S.pOf[k] === 0); S.val[S.nU] = pex(M.X[p0n], M.Y[p0n], M.Z[p0n]) / S.Pr;
    const x0 = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) if (S.fix[i]) x0[i] = S.val[i];
    const R0 = FF.ffResidual(S, x0); for (let i = 0; i < S.nD; i++) if (!S.fix[i]) R0[i] -= fsrc[i];
    const PC = FF.ffPrecond(S), lin = FF.ffFGMRES(S, PC, R0.map(v => -v), { tol: 1e-12, restart: 80, maxIt: 800 });
    const x = x0.map((v, i) => S.fix[i] ? v : v + lin.x[i]);
    let eu = 0, nu = 0, ep = 0, np = 0;
    for (let k = 0; k < M.nN; k++) { const u = uex(M.X[k], M.Y[k], M.Z[k]); for (let c = 0; c < 3; c++) { eu += (x[3 * k + c] * S.Ur - u[c]) ** 2; nu += u[c] ** 2; } if (S.pOf[k] >= 0) { ep += (x[S.nU + S.pOf[k]] * S.Pr - pex(M.X[k], M.Y[k], M.Z[k])) ** 2; np += pex(M.X[k], M.Y[k], M.Z[k]) ** 2; } }
    // (the pressure's error with its mean taken out, and where it is largest)
    let mean = 0, cnt = 0, big = 0, bigAt = null; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) { mean += x[S.nU + S.pOf[k]] * S.Pr - pex(M.X[k], M.Y[k], M.Z[k]); cnt++; } mean /= cnt;
    let ep2 = 0; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) { const d = x[S.nU + S.pOf[k]] * S.Pr - pex(M.X[k], M.Y[k], M.Z[k]) - mean; ep2 += d * d; if (Math.abs(d) > big) { big = Math.abs(d); bigAt = [M.X[k], M.Y[k], M.Z[k]].map(v => +(v * 1000).toFixed(2)); } }
    // (all walls given: the pressure is fixed only up to a constant -- its error measured with the mean taken out, the
    //  standard measure; pinning one node only chooses the constant)
    let pm = 0; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) pm += pex(M.X[k], M.Y[k], M.Z[k]) / cnt;
    let npm = 0; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) npm += (pex(M.X[k], M.Y[k], M.Z[k]) - pm) ** 2;
    res.push({ n, eu: Math.sqrt(eu / nu), ep: Math.sqrt(ep2 / npm), it: lin.it });
  }
  const ou = Math.log2(res[0].eu / res[1].eu), op = Math.log2(res[0].ep / res[1].ep);
  check('manufactured solution: the velocity error falls at order 3 (curved mesh), the pressure (its mean taken out) at least 2', ou > 2.6 && op > 1.8,
    res.map(r => `n ${r.n}: velocity ${r.eu.toExponential(2)}, pressure ${r.ep.toExponential(2)}, GMRES ${r.it}`).join('; ') + `; orders ${ou.toFixed(2)}, ${op.toFixed(2)}`);
}

/** ∫ f · N_a dV for every velocity unknown (scaled as the residual: f Lr / Pr per scaled volume). */
function ffForce(S, M, force) {
  const F = new Float64Array(S.nD), Ref = FF.FF_REF;
  for (let e = 0; e < M.nE; e++) {
    const el = M.elems.subarray(27 * e, 27 * e + 27);
    for (let q = 0; q < 27; q++) {
      let X = 0, Y = 0, Z = 0; for (let a = 0; a < 27; a++) { const N = Ref.N[q * 27 + a]; X += N * M.X[el[a]]; Y += N * M.Y[el[a]]; Z += N * M.Z[el[a]]; }
      const w = S.geo[(e * 27 + q) * 10 + 9], f = force(X, Y, Z).map(v => v * S.Lr / S.Pr);
      for (let a = 0; a < 27; a++) { const N = Ref.N[q * 27 + a]; for (let i = 0; i < 3; i++) F[3 * el[a] + i] += w * N * f[i]; }
    }
  }
  return F;
}

// 4. the preconditioner: iterations nearly level under refinement (the Stokes problem of check 1 on finer meshes, distorted)
{
  const its = [];
  for (const n of [2, 4, 6]) {
    const M = box(4e-3, 1e-3, 1e-3, 2 * n, n, n, (x, y, z) => [x + 0.1e-3 * Math.sin(3000 * y), y, z + 0.05e-3 * Math.sin(2000 * x)]);
    const S = FF.ffSetup({ mesh: M, mu: () => 2, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, fixPressure: true, bc: { y0: { type: 'velocity', u: [1e-2, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] }, z0: { type: 'velocity', u: [0, 0, 0] }, z1: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: [0, 0, 0] } } });
    const t0 = Date.now(), R = FF.ffSolve(S, { tol: 1e-10, linTol: 1e-8 });
    its.push({ n, it: R.hist[0].lin, nD: S.nD, ms: Date.now() - t0 });
  }
  check('the multigrid preconditioner: GMRES iterations nearly level under refinement', its[its.length - 1].it <= 2.5 * its[0].it + 10,
    its.map(r => `${r.nD} unknowns: ${r.it} iterations (${(r.ms / 1000).toFixed(1)} s)`).join('; '));
}

// 5. the Schur complement's thin-film part: φ (each node's response to a pressure gradient) exact in a film on a wall,
//    y (2h − y) / 2, and in a channel, y (h − y) / 2 (a mesh sheared across); and GMRES on a thin film (1 mm thick, 60 mm
//    long, side walls, a moving web) with it and without it
{
  const errs = [];
  for (const top of ['slip', 'velocity']) {
    const h = 1e-3, M = box(6e-3, h, 3e-3, 3, 4, 2, (x, y, z) => [x + 0.3e-3 * Math.sin(900 * z), y, z]);
    const S = FF.ffSetup({ mesh: M, mu: () => 1, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-3, bc: { y0: { type: 'velocity', u: [1e-3, 0, 0] }, y1: top === 'slip' ? { type: 'slip', normal: 'y' } : { type: 'velocity', u: [0, 0, 0] },
      z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' }, x0: { type: 'traction', t: [0, 0, 0] }, x1: { type: 'traction', t: [0, 0, 0] } } });
    const x = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) if (S.fix[i]) x[i] = S.val[i]; FF.ffResidual(S, x); FF.ffPrecond(S);
    let e = 0, mx = 0; for (let n = 0; n < M.nN; n++) { const y = M.Y[n] / 1e-3, ex = top === 'slip' ? y * (2 - y) / 2 : y * (1 - y) / 2; e = Math.max(e, Math.abs(S.phi[n] - ex)); mx = Math.max(mx, ex); }
    errs.push(e / mx);
  }
  check('thin-film part: φ exact in a film on a wall and in a channel (sheared mesh)', errs.every(e => e < 1e-10), `film ${errs[0].toExponential(1)}, channel ${errs[1].toExponential(1)} (relative)`);
  const its = [];
  for (const [nx, ny, nz] of [[12, 2, 4], [24, 3, 6]]) {
    const h = 1e-3, U = 5e-3, M = box(60e-3, h, 20e-3, nx, ny, nz);
    for (const lub of [false, true]) {
      const S = FF.ffSetup({ mesh: M, mu: () => 5, rho: 0, g: 0, Lr: 1e-3, Ur: U, bc: { y0: { type: 'velocity', u: [U, 0, 0] }, y1: { type: 'slip', normal: 'y' },
        z0: { type: 'velocity', u: [0, 0, 0] }, z1: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: (x, y) => [1.5 * U * (1 - y / h), 0, 0] }, x1: { type: 'traction', t: [0, 0, 0] } } });
      const x = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) if (S.fix[i]) x[i] = S.val[i];
      const R0 = FF.ffResidual(S, x), PC = FF.ffPrecond(S, { lub }), lin = FF.ffFGMRES(S, PC, R0.map(v => -v), { tol: 1e-8, restart: 200, maxIt: 400 });
      its.push({ n: S.nD, lub, it: lin.it, res: lin.res });
    }
  }
  const on = its.filter(r => r.lub), off = its.filter(r => !r.lub);
  check('thin-film part: GMRES on a thin film several times shorter with it, and level under refinement', on.every((r, i) => r.res < 1e-8 && r.it * 3 <= off[i].it) && on[1].it <= on[0].it + 5,
    its.map(r => `${r.n} unknowns ${r.lub ? 'with' : 'without'}: ${r.it}`).join('; '));
}

// 6. a scraping corner: the web runs under a face that takes no flow through it (an upstream cut); marked 'over', the
//    corner keeps no flow through the face, and nothing leaks in; left to the web's speed, the corner's row leaks
{
  const leak = over => {
    const M = box(4e-3, 1e-3, 1e-3, 4, 2, 1), U = 1e-3;
    const S = FF.ffSetup({ mesh: M, mu: () => 1, rho: 0, g: 0, Lr: 1e-3, Ur: U, bc: { y0: { type: 'velocity', u: [U, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] },
      x0: { type: 'slip', normal: 'x', over }, x1: { type: 'traction', t: [0, 0, 0] }, z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' } } });
    const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
    return { inn: FF.ffFlow(S, R.x, 'x0'), out: FF.ffFlow(S, R.x, 'x1'), drag: U * 1e-3 * 1e-3 / 2 };
  };
  const a = leak(true), b = leak(false);
  check('a scraping corner (the web under a no-flow face): nothing leaks through the face; the balance closes', Math.abs(a.inn) < 1e-12 * a.drag && Math.abs(a.out + a.inn) < 1e-9 * a.drag && Math.abs(b.inn) > 0.05 * b.drag,
    `marked over: through the face ${a.inn.toExponential(1)}, out ${a.out.toExponential(1)} m³/s; not marked: ${b.inn.toExponential(2)} m³/s (${(Math.abs(b.inn) / b.drag * 100).toFixed(0)} % of the web's drag flow)`);
}

// 7. a curved surface's slip (the pile's top, once free): a channel tilted 20°, its floor a wall, its lid slip along the
//    lid's own normal; half-Poiseuille flow along it, u' = G y'(2h − y')/2μ, p = G (L − x'), exact in the elements; nothing
//    through the lid; the force the lid holds the paste with, read from the residual, the normal stress there: −p
{
  const th = 20 * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th), L = 4e-3, h = 1e-3, Wz = 1e-3, mu = 2, G = 1e5;
  const M = box(L, h, Wz, 4, 2, 1, (x, y, z) => [x * cs - y * sn, x * sn + y * cs, z]);
  const loc = (X, Y) => [X * cs + Y * sn, -X * sn + Y * cs];   // (x', y')
  const ue = (X, Y) => { const [, yp] = loc(X, Y), u = G * yp * (2 * h - yp) / (2 * mu); return [u * cs, u * sn, 0]; };
  const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, bc: {
    y0: { type: 'velocity', u: [0, 0, 0] }, y1: { type: 'slip', normal: 'surface' }, x0: { type: 'velocity', u: ue },
    z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' },
    x1: { type: 'traction', t: (X, Y) => { const [, yp] = loc(X, Y), ty = G * (h - yp); return [-ty * sn, ty * cs, 0]; } } } });   // (μ du'/dy' along y')
  const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
  let eu = 0, um = 0; for (let n = 0; n < M.nN; n++) { const u = ue(M.X[n], M.Y[n]); eu = Math.max(eu, Math.abs(R.u[n] - u[0]), Math.abs(R.v[n] - u[1]), Math.abs(R.w[n])); um = Math.max(um, Math.hypot(u[0], u[1])); }
  const Ql = FF.ffFlow(S, R.x, 'y1'), Qo = FF.ffFlow(S, R.x, 'x1');
  // the lid's force along its normal at each node, over the node's share of the lid's area: the normal stress
  const Rr = FF.ffResidual(S, R.x, undefined, { raw: true }), area = new Map();
  for (const F of M.faces) if (F.tag === 'y1') FF.ffFaceNormals(M, S.X, S.Y, S.Z, F, () => {});
  let es = 0, sm = 0;
  for (let n = 0; n < M.nN; n++) if (S.rot[n] >= 0) area.set(n, 0);
  { // ∫ N_i dA over the lid (scaled)
    const Q2 = t => [t * (t - 1) / 2, 1 - t * t, t * (t + 1) / 2], G3 = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], W3 = [5 / 9, 8 / 9, 5 / 9];
    for (const F of M.faces) if (F.tag === 'y1') { const el = M.elems.subarray(27 * F.e, 27 * F.e + 27);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { const A = Q2(G3[i]), C = Q2(G3[j]), dA = [G3[i] - 0.5, -2 * G3[i], G3[i] + 0.5], dC = [G3[j] - 0.5, -2 * G3[j], G3[j] + 0.5];
        const t1 = [0, 0, 0], t2 = [0, 0, 0]; for (let g = 0; g < 3; g++) for (let a = 0; a < 3; a++) { const n = el[(g * 3 + 2) * 3 + a], P = [S.X[n], S.Y[n], S.Z[n]]; for (let c = 0; c < 3; c++) { t1[c] += dA[a] * C[g] * P[c]; t2[c] += A[a] * dC[g] * P[c]; } }
        const dAr = Math.hypot(t1[1] * t2[2] - t1[2] * t2[1], t1[2] * t2[0] - t1[0] * t2[2], t1[0] * t2[1] - t1[1] * t2[0]) * W3[i] * W3[j];
        for (let g = 0; g < 3; g++) for (let a = 0; a < 3; a++) { const n = el[(g * 3 + 2) * 3 + a]; if (area.has(n)) area.set(n, area.get(n) + A[a] * C[g] * dAr); } } }
  }
  for (const [n, a] of area) { const [xp] = loc(M.X[n], M.Y[n]), sx = -G * (L - xp), sv = Rr[3 * n] / a * S.Pr; if (xp > 0.3 * L && xp < 0.7 * L) { es = Math.max(es, Math.abs(sv - sx)); sm = Math.max(sm, Math.abs(sx)); } }
  check('slip along a curved surface\'s own normal: tilted half-Poiseuille exact; nothing through the lid; the lid\'s normal stress −p', eu / um < 1e-9 && Math.abs(Ql) < 1e-12 * Math.abs(Qo) && es / sm < 1e-6,
    `velocity ${(eu / um).toExponential(1)} (relative), through the lid ${Ql.toExponential(1)} against ${Qo.toExponential(3)} m³/s out, normal stress ${(es / sm).toExponential(1)} (relative, mid-lid)`);
}

// 8. a free surface's tension: paste at rest under a dome (a circular arc, radius Rc), no gravity, walls round it: the
//    pressure σ/Rc, the paste still (what stirs it is the arc's approximation by the elements)
{
  const L = 4e-3, H = 1e-3, Rc = 5e-3, sigma = 0.07, mu = 1;
  const yTop = x => H + Math.sqrt(Rc * Rc - (x - L / 2) ** 2) - Math.sqrt(Rc * Rc - (L / 2) ** 2);
  const res = [];
  for (const n of [4, 8]) {
    const M = box(L, H, 0.5e-3, n, 2, 1, (x, y, z) => [x, y / H * yTop(x), z]);
    const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-3, bc: { y0: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: [0, 0, 0] }, x1: { type: 'velocity', u: [0, 0, 0] },
      z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' }, y1: { type: 'free', sigma } } });
    const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
    let pm = 0, cnt = 0, um = 0; for (let k = 0; k < M.nN; k++) { if (!isNaN(R.p[k])) { pm += R.p[k]; cnt++; } um = Math.max(um, Math.hypot(R.u[k], R.v[k], R.w[k])); }
    res.push({ n, p: pm / cnt, um });
  }
  const pe = sigma / Rc, e = res.map(r => Math.abs(r.p - pe) / pe);
  // (the stirring measured against σ/μ, the speed tension alone would drive)
  check('a free surface\'s tension: under a dome the pressure σ/Rc, the paste nearly still, both closer on a finer mesh', e[1] < 1e-3 && e[1] < e[0] && res[1].um < 1e-4 * sigma / mu && res[1].um < res[0].um,
    res.map((r, i) => `${r.n} elements across: p ${r.p.toFixed(4)} Pa against ${pe.toFixed(4)} (${(e[i] * 100).toExponential(1)} %), largest speed ${(r.um / (sigma / mu)).toExponential(1)} σ/μ`).join('; '));
}

// 9. a film flowing down an incline (gravity tilted 10°, the plate at rest, the top free with its tension): Nusselt's film,
//    u = ρ g sin α (h y − y²/2)/μ, p = ρ g cos α (h − y), exact in the elements; a flat surface's tension adds nothing
{
  const al = 10 * Math.PI / 180, rho = 1300, g = 9.81, mu = 2, h = 1e-3, L = 4e-3, sigma = 0.07;
  const ue = (x, y) => [rho * g * Math.sin(al) * (h * y - y * y / 2) / mu, 0, 0], pe = y => rho * g * Math.cos(al) * (h - y);
  const M = box(L, h, 1e-3, 4, 2, 1);
  const S = FF.ffSetup({ mesh: M, mu: () => mu, rho, g, gdir: [Math.sin(al), -Math.cos(al), 0], Lr: 1e-3, Ur: 1e-2, bc: {
    y0: { type: 'velocity', u: [0, 0, 0] }, y1: { type: 'free', sigma }, x0: { type: 'velocity', u: ue }, z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' },
    x1: { type: 'traction', t: (x, y) => [-pe(y), rho * g * Math.sin(al) * (h - y), 0] } } });
  const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
  let eu = 0, um = 0, ep = 0; for (let n = 0; n < M.nN; n++) { const u = ue(M.X[n], M.Y[n]); eu = Math.max(eu, Math.abs(R.u[n] - u[0]), Math.abs(R.v[n]), Math.abs(R.w[n])); um = Math.max(um, u[0]); if (!isNaN(R.p[n])) ep = Math.max(ep, Math.abs(R.p[n] - pe(M.Y[n]))); }
  check('gravity tilted, a free top with its tension: Nusselt\'s film exact (velocity, pressure); nothing through the surface', eu / um < 1e-9 && ep / pe(0) < 1e-8 && Math.abs(FF.ffFlow(S, R.x, 'y1')) < 1e-12 * FF.ffFlow(S, R.x, 'x1'),
    `velocity ${(eu / um).toExponential(1)}, pressure ${(ep / pe(0)).toExponential(1)} (relative); through the surface ${FF.ffFlow(S, R.x, 'y1').toExponential(1)} m³/s`);
}

// 10. a slip surface with a given velocity through it: u = b (x² + y²), v = −2 b x y, w = 0, p = 4 μ b x -- Stokes, and its
//     shear stress is zero everywhere, so the top (y = H) is shear-free with the velocity through it −2 b x H, varying along
//     it; the bottom (y = 0) no flow through it, shear-free; x = 0 the velocity given; x = L traction-free (the exact one).
//     Quadratic velocity, linear pressure: in the elements, so exact to round-off -- level, and tilted 20° (the surfaces then
//     not along the axes: their own normals)
{
  const L = 4e-3, H = 1.5e-3, Wz = 1e-3, mu = 3, b = 2;   // (1/(m s))
  for (const deg of [0, 20]) {
    const th = deg * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    const rot = (x, y) => [c * x - sn * y, sn * x + c * y], back = (X, Y) => [c * X + sn * Y, -sn * X + c * Y];
    const M = box(L, H, Wz, 4, 3, 1, (x, y, z) => [...rot(x, y), z]);
    const uL = (x, y) => [b * (x * x + y * y), -2 * b * x * y], uE = (X, Y) => { const [x, y] = back(X, Y), [u, v] = uL(x, y); return [c * u - sn * v, sn * u + c * v, 0]; };
    const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-5, bc: {
      x0: { type: 'velocity', u: (X, Y) => uE(X, Y) }, x1: { type: 'traction', t: [0, 0, 0] },
      y0: deg ? { type: 'slip', normal: 'surface' } : { type: 'slip', normal: 'y' },
      y1: { type: 'slip', normal: 'surface', un: (X, Y) => -2 * b * back(X, Y)[0] * H },
      z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' } } });
    const R = FF.ffSolve(S, { tol: 1e-13, linTol: 1e-13 });
    let eu = 0, um = 0, ep = 0;
    for (let n = 0; n < M.nN; n++) {
      const e = uE(M.X[n], M.Y[n]); um = Math.max(um, Math.hypot(...e));
      eu = Math.max(eu, Math.hypot(R.u[n] - e[0], R.v[n] - e[1], R.w[n]));
      if (!isNaN(R.p[n])) ep = Math.max(ep, Math.abs(R.p[n] - 4 * mu * b * back(M.X[n], M.Y[n])[0]));
    }
    const qTop = FF.ffFlow(S, R.x, 'y1'), qEx = -b * L * L * H * Wz;   // (∫ −2 b x H dx dz over the top)
    check(`a slip surface with a given velocity through it (${deg ? `tilted ${deg}°` : 'level'}): exact; the flow through it the given one`,
      eu / um < 1e-9 && ep / (4 * mu * b * L) < 1e-8 && Math.abs(qTop / qEx - 1) < 1e-9,
      `velocity ${(eu / um).toExponential(1)}, pressure ${(ep / (4 * mu * b * L)).toExponential(1)} of their scales; through the top ${(qTop * 1e9).toFixed(6)} mm³/s (exact ${(qEx * 1e9).toFixed(6)})`);
  }
}

// 11. a free top relaxing: η = A cos(k x) on a layer d deep (its bottom a wall; mirrors at the ends and the sides), the
//     paste at rest at first; the top's speed down, by hand: ψ = f(y) sin kx, f = (a + b y) cosh ky + (c + e y) sinh ky,
//     f(0) = f'(0) = 0 (the wall), f'' + k² f = 0 at d (no shear), (μ/k)(f''' − k² f') − 2 μ k f' = −(ρ g + σ k²) at d
//     (the normal stress the top's weight and tension leave): γ = k f(d)
{
  const mu = 10.5, rho = 1360, g = 9.81, sg = 0.07, d = 0.0367, L = 0.09, k = Math.PI / L, A = 5e-5, Dt = 0.05;
  const G = (() => {   // (the top's speed for a unit load: unknowns b, c, e; a = 0, b = −k c)
    const ch = Math.cosh(k * d), sh = Math.sinh(k * d);
    // f, f', f'', f''' at d as linear forms in (c, e), with b = −k c
    const fv = [-k * d * ch + sh, d * sh], f1 = [-k * ch - k * k * d * sh + k * ch, sh + k * d * ch];
    const f2 = [-2 * k * k * sh - k ** 3 * d * ch + k * k * sh, 2 * k * ch + k * k * d * sh], f3 = [-3 * k ** 3 * ch - k ** 4 * d * sh + k ** 3 * ch, 3 * k * k * sh + k ** 3 * d * ch];
    const r1 = [f2[0] + k * k * fv[0], f2[1] + k * k * fv[1]], r2 = [(mu / k) * (f3[0] - k * k * f1[0]) - 2 * mu * k * f1[0], (mu / k) * (f3[1] - k * k * f1[1]) - 2 * mu * k * f1[1]];
    const det = r1[0] * r2[1] - r1[1] * r2[0], c = (0 * r2[1] - r1[1] * -1) / det, e = (r1[0] * -1 - 0 * r2[0]) / det;
    return k * (fv[0] * c + fv[1] * e);
  })();
  const gG = rho * g * G, gS = sg * k * k * G, gam = gG + gS;
  const M = box(L, d, 4e-3, 10, 5, 1, (x, y, z) => [x, y / d * (d + A * Math.cos(k * x)), z]), out = [];
  for (const kn of [0, rho * g * Dt]) {
    const S = FF.ffSetup({ mesh: M, mu: () => mu, rho, g, Lr: 1e-3, Ur: 1e-3, bc: { y0: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'slip', normal: 'x' }, x1: { type: 'slip', normal: 'x' },
      z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' }, y1: { type: 'free', sigma: sg, kn, vn: 0 } } });
    const R = FF.ffSolve(S, { tol: 1e-10 });
    // the top's speed through it, over its slope (the top's rise), projected on cos kx along the top (Simpson)
    const NX = 21, NY = 11, top = i => (0 * NY + NY - 1) * NX + i;
    let num = 0, den = 0;
    for (let i = 0; i < NX; i++) {
      const n = top(i), x = M.X[n], w = (i === 0 || i === NX - 1 ? 1 : i % 2 ? 4 : 2) * L / (NX - 1) / 3, sl = -A * k * Math.sin(k * x);
      const V = (R.v[n] - R.u[n] * sl);   // (u·n / n_y, n ∝ (−η′, 1))
      num += w * V * Math.cos(k * x); den += w * Math.cos(k * x) ** 2;
    }
    out.push({ kn, amp: num / den, exact: kn ? -gam * A / (1 + gG * Dt) : -gam * A, conv: R.converged });
  }
  const errs = out.map(o => Math.abs(o.amp / o.exact - 1));
  check('a free top relaxing (a wave on a layer of paste: its weight and tension): its speed exact; with its implicit weight over a step, γ/(1 + γ_g Δt)', errs.every(e => e < 2e-3) && out.every(o => o.conv),
    `γ = ${gam.toFixed(4)} 1/s (weight ${gG.toFixed(4)}, tension ${gS.toFixed(4)}); the top's speed ${out.map((o, i) => `${(o.amp * 1e6).toFixed(4)} µm/s (exact ${(o.exact * 1e6).toFixed(4)}, off ${errs[i].toExponential(1)})`).join('; ')}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
