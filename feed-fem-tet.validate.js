/*
 * feed-fem-tet.validate.js — checks of feed-fem.js on P2–P1 tetrahedra (MESH-T3: the 3D flow on the tetrahedral mesher's
 * meshes, um-tetmesh.js's umtQuadratic) against exact solutions, and beside the same cases on hexahedra.
 * Run: node feed-fem-tet.validate.js
 *  1. Plane Poiseuille flow between plates on an unstructured mesh: the quadratic profile and the linear pressure are in
 *     the elements, so the solution is exact to round-off; the flow rate out exact.
 *  2. The Newton Jacobian against finite differences of the residual: a shear-thinning paste with a yield stress, inertia
 *     and gravity, on a curved mesh (every node moved by a smooth map: curved P2 elements).
 *  3. A manufactured solution (every component varying in every direction, a curved mesh, Newtonian): the velocity's
 *     error falls at the elements' order (3), the pressure's (its mean taken out) at least at 2.
 *  4. The multigrid preconditioner (the P2 elements' linear sub-tetrahedra): GMRES iterations nearly level under refinement.
 *  5. A square duct (fully developed flow, the exact series): the velocity against the series, its error falling at
 *     order 3 on tetrahedra, as the hexahedra's on the same duct; the pressure gradient (a least-squares line) and the
 *     pressure's RMS error; its largest error named with where it is.
 *  6. Slip along a curved surface's own normal on tetrahedra (a tilted channel, half-Poiseuille): exact; nothing through
 *     the lid.
 *  7. A free surface on tetrahedra refused, saying it is the next step (MESH-T4).
 */
const FF = require('./feed-fem.js'), MT = require('./um-tetmesh.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const norm = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0));

/** A box Lx × Ly × Lz in tetrahedra of about size h, made quadratic, every node then moved by f; faces x0 … z1. */
function tetBox(Lx, Ly, Lz, h, f) {
  const G = { X: [0, Lx, Lx, 0, 0, Lx, Lx, 0], Y: [0, 0, Ly, Ly, 0, 0, Ly, Ly], Z: [0, 0, 0, 0, Lz, Lz, Lz, Lz],
    faces: [{ loops: [[0, 3, 2, 1]], tag: 'z0' }, { loops: [[4, 5, 6, 7]], tag: 'z1' }, { loops: [[0, 1, 5, 4]], tag: 'y0' }, { loops: [[3, 7, 6, 2]], tag: 'y1' }, { loops: [[0, 4, 7, 3]], tag: 'x0' }, { loops: [[1, 2, 6, 5]], tag: 'x1' }] };
  const S = MT.umtSurface(G, { size: h }), Q = MT.umtQuadratic(MT.umtVolume(S, { size: h }), {});
  if (f) for (let n = 0; n < Q.nN; n++) { const p = f(Q.X[n], Q.Y[n], Q.Z[n]); Q.X[n] = p[0]; Q.Y[n] = p[1]; Q.Z[n] = p[2]; }
  return Q;
}
/** A box of nx × ny × nz Q2 hexahedra in feed-mesh.js's format (as feed-fem.validate.js's), faces x0 … z1. */
function hexBox(Lx, Ly, Lz, nx, ny, nz, f = (x, y, z) => [x, y, z]) {
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
/** ∫ f · N_a dV for every velocity unknown (scaled as the residual), on either element. */
function ffForce(S, force) {
  const F = new Float64Array(S.nD), K = S.K, T = K.T, M = S.M;
  for (let e = 0; e < S.nE; e++) {
    const el = K.conn.subarray(K.npe * e, K.npe * e + K.npe);
    for (let q = 0; q < K.nq; q++) {
      let X = 0, Y = 0, Z = 0; for (let a = 0; a < K.npe; a++) { const N = T.N[q * K.npe + a]; X += N * M.X[el[a]]; Y += N * M.Y[el[a]]; Z += N * M.Z[el[a]]; }
      const w = S.geo[(e * K.nq + q) * 10 + 9], f = force(X, Y, Z).map(v => v * S.Lr / S.Pr);
      for (let a = 0; a < K.npe; a++) { const N = T.N[q * K.npe + a]; for (let i = 0; i < 3; i++) F[3 * el[a] + i] += w * N * f[i]; }
    }
  }
  return F;
}

// 1. plane Poiseuille: u = G y (H − y) / (2 μ), p = G (L − x)
{
  const L = 4e-3, H = 1e-3, Wz = 1e-3, mu = 2, G = 1e5, M = tetBox(L, H, Wz, 0.5e-3);
  const ue = (x, y) => G * y * (H - y) / (2 * mu);
  const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, bc: {
    y0: { type: 'velocity', u: [0, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: (x, y) => [ue(x, y), 0, 0] },
    z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' }, x1: { type: 'traction', t: (x, y) => [0, G * (H - 2 * y) / 2, 0] } } });
  const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
  let eu = 0, um = 0, ep = 0;
  for (let n = 0; n < M.nN; n++) { eu = Math.max(eu, Math.abs(R.u[n] - ue(M.X[n], M.Y[n])), Math.abs(R.v[n]), Math.abs(R.w[n])); um = Math.max(um, ue(M.X[n], M.Y[n])); if (!isNaN(R.p[n])) ep = Math.max(ep, Math.abs(R.p[n] - G * (L - M.X[n]))); }
  const Q = FF.ffFlow(S, R.x, 'x1'), Qe = G * H ** 3 / (12 * mu) * Wz;
  check('plane Poiseuille on tetrahedra: velocity and pressure exact to round-off, the flow rate out exact; Newton in one step', eu / um < 1e-9 && ep / (G * L) < 1e-8 && Math.abs(Q / Qe - 1) < 1e-9 && R.hist.length <= 2,
    `${M.nE} tetrahedra; velocity ${(eu / um).toExponential(1)}, pressure ${(ep / (G * L)).toExponential(1)}, flow ${(Q / Qe - 1).toExponential(1)}; Newton ${R.hist.length}, GMRES ${R.hist.map(h => h.lin).join(', ')}`);
}

// 2. the Jacobian against finite differences (yield stress, shear-thinning, inertia, gravity, curved elements)
{
  const curved = (x, y, z) => [x + 0.15e-3 * Math.sin(2000 * y) * Math.cos(1500 * z), y * (1 + 0.2 * Math.sin(800 * x)), z + 0.1e-3 * Math.sin(1700 * x + 900 * y)];
  const M = tetBox(2e-3, 1e-3, 1e-3, 0.5e-3, curved);
  const tauY = 5, Kc = 8, nn = 0.6, law = gd => tauY / gd + Kc * Math.pow(gd, nn - 1);
  const S = FF.ffSetup({ mesh: M, mu: law, gdMin: 0.5, rho: 1400, g: 9.81, Lr: 1e-3, Ur: 5e-3, bc: { y0: { type: 'velocity', u: [5e-3, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] }, z0: { type: 'slip', normal: 'z' } } });
  const x = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) x[i] = S.fix[i] ? S.val[i] : Math.sin(1.3 * i) * (i < S.nU ? 0.8 : 3);
  FF.ffResidual(S, x); const d = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) d[i] = S.fix[i] ? 0 : Math.cos(0.7 * i);
  const Jd = FF.ffJacVec(S, d), h = 1e-6, Rp = FF.ffResidual(S, x.map((v, i) => v + h * d[i])).slice(), Rm = FF.ffResidual(S, x.map((v, i) => v - h * d[i])).slice();
  const fd = Rp.map((v, i) => S.fix[i] ? d[i] : (v - Rm[i]) / (2 * h)), err = norm(fd.map((v, i) => v - Jd[i])) / norm(fd);
  check('the Jacobian on curved tetrahedra against finite differences (yield stress, shear-thinning, inertia, gravity)', err < 1e-6, `${M.nE} tetrahedra; relative difference ${err.toExponential(1)}`);
}

// 3. a manufactured solution: u = U0 (sin x cos y cos z, cos x sin y cos z, −2 cos x cos y sin z) (x in mm), p = P0 cos x sin(y + z)
{
  const s = 1e-3, U0 = 1e-3, P0 = 1, mu = 1;
  const uex = (X, Y, Z) => { const x = X / s, y = Y / s, z = Z / s; return [U0 * Math.sin(x) * Math.cos(y) * Math.cos(z), U0 * Math.cos(x) * Math.sin(y) * Math.cos(z), -2 * U0 * Math.cos(x) * Math.cos(y) * Math.sin(z)]; };
  const pex = (X, Y, Z) => P0 * Math.cos(X / s) * Math.sin(Y / s + Z / s);
  const force = (X, Y, Z) => { const u = uex(X, Y, Z), x = X / s, y = Y / s, z = Z / s;
    const gp = [-P0 * Math.sin(x) * Math.sin(y + z) / s, P0 * Math.cos(x) * Math.cos(y + z) / s, P0 * Math.cos(x) * Math.cos(y + z) / s];
    return [0, 1, 2].map(i => 3 * mu * u[i] / (s * s) + gp[i]); };
  const curved = (x, y, z) => [x + 0.04e-3 * Math.sin(3000 * y), y + 0.03e-3 * Math.sin(2500 * x) * Math.cos(2000 * z), z];
  const res = [];
  for (const h of [0.4e-3, 0.2e-3]) {
    const M = tetBox(1e-3, 1e-3, 1e-3, h, curved);
    const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-3, fixPressure: true, bc: Object.fromEntries(['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].map(t => [t, { type: 'velocity', u: uex }])) });
    const fsrc = ffForce(S, force), p0n = [...Array(M.nN).keys()].find(k => S.pOf[k] === 0); S.val[S.nU] = pex(M.X[p0n], M.Y[p0n], M.Z[p0n]) / S.Pr;
    const x0 = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) if (S.fix[i]) x0[i] = S.val[i];
    const R0 = FF.ffResidual(S, x0); for (let i = 0; i < S.nD; i++) if (!S.fix[i]) R0[i] -= fsrc[i];
    const lin = FF.ffFGMRES(S, FF.ffPrecond(S), R0.map(v => -v), { tol: 1e-12, restart: 80, maxIt: 1200 }), x = x0.map((v, i) => S.fix[i] ? v : v + lin.x[i]);
    let eu = 0, nu = 0; for (let k = 0; k < M.nN; k++) { const u = uex(M.X[k], M.Y[k], M.Z[k]); for (let c = 0; c < 3; c++) { eu += (x[3 * k + c] * S.Ur - u[c]) ** 2; nu += u[c] ** 2; } }
    let mean = 0, cnt = 0, pm = 0; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) { mean += x[S.nU + S.pOf[k]] * S.Pr - pex(M.X[k], M.Y[k], M.Z[k]); pm += pex(M.X[k], M.Y[k], M.Z[k]); cnt++; } mean /= cnt; pm /= cnt;
    let ep = 0, np = 0; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) { ep += (x[S.nU + S.pOf[k]] * S.Pr - pex(M.X[k], M.Y[k], M.Z[k]) - mean) ** 2; np += (pex(M.X[k], M.Y[k], M.Z[k]) - pm) ** 2; }
    // (the mesh size: the cube root of the mean element volume -- the meshes are unstructured)
    res.push({ h: Math.cbrt(1e-9 / M.nE), nE: M.nE, eu: Math.sqrt(eu / nu), ep: Math.sqrt(ep / np), it: lin.it, res: lin.res });
  }
  const r = res[0].h / res[1].h, ou = Math.log(res[0].eu / res[1].eu) / Math.log(r), op = Math.log(res[0].ep / res[1].ep) / Math.log(r);
  check('manufactured solution on curved tetrahedra: the velocity error falls at order 3, the pressure (its mean taken out) at least 2', ou > 2.6 && op > 1.8 && res.every(q => q.res < 1e-10),
    res.map(q => `${q.nE} tetrahedra: velocity ${q.eu.toExponential(2)}, pressure ${q.ep.toExponential(2)}, GMRES ${q.it}`).join('; ') + `; orders ${ou.toFixed(2)}, ${op.toFixed(2)}`);
}

// 4. the preconditioner: GMRES iterations nearly level under refinement (a driven box, distorted)
{
  const its = [];
  for (const h of [0.5e-3, 0.33e-3, 0.25e-3]) {
    const M = tetBox(4e-3, 1e-3, 1e-3, h, (x, y, z) => [x + 0.1e-3 * Math.sin(3000 * y), y, z + 0.05e-3 * Math.sin(2000 * x)]);
    const S = FF.ffSetup({ mesh: M, mu: () => 2, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, fixPressure: true, bc: { y0: { type: 'velocity', u: [1e-2, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] }, z0: { type: 'velocity', u: [0, 0, 0] }, z1: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: [0, 0, 0] } } });
    const t0 = Date.now(), R = FF.ffSolve(S, { tol: 1e-10, linTol: 1e-8 });
    its.push({ it: R.hist[0].lin, nD: S.nD, ms: Date.now() - t0 });
  }
  check('the multigrid preconditioner on tetrahedra: GMRES iterations nearly level under refinement', its[its.length - 1].it <= 2.5 * its[0].it + 10,
    its.map(q => `${q.nD} unknowns: ${q.it} iterations (${(q.ms / 1000).toFixed(1)} s)`).join('; '));
}

// 5. a square duct: fully developed flow, the exact series (cross-section −a < y' < a, −a < z' < a)
{
  const a = 0.5e-3, L = 2e-3, mu = 1, G = 2e4;
  const series = (y, z) => { let u = 0; for (let n = 1; n < 80; n += 2) { const k = n * Math.PI / (2 * a); u += (n % 4 === 1 ? 1 : -1) * (1 - Math.cosh(k * z) / Math.cosh(k * a)) * Math.cos(k * y) / n ** 3; } return 16 * a * a * G / (mu * Math.PI ** 3) * u; };
  const ue = (x, y, z) => series(y - a, z - a);
  // (the exact traction at the outlet: (−p, μ ∂u/∂y, μ ∂u/∂z), p = 0 there -- by differences of the series)
  const dd = 1e-9, tOut = (x, y, z) => [0, mu * (ue(x, y + dd, z) - ue(x, y - dd, z)) / (2 * dd), mu * (ue(x, y, z + dd) - ue(x, y, z - dd)) / (2 * dd)];
  const bc = { y0: { type: 'velocity', u: [0, 0, 0] }, y1: { type: 'velocity', u: [0, 0, 0] }, z0: { type: 'velocity', u: [0, 0, 0] }, z1: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: (x, y, z) => [ue(x, y, z), 0, 0] }, x1: { type: 'traction', t: tOut } };
  // the velocity's error against the series; the pressure: its gradient by a least-squares line through every pressure
  // node, its RMS error, and its largest error and where (the inlet's corners, where the imposed profile meets two walls)
  const run = M => { const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, bc }), R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-11 });
    let e = 0, n2 = 0, em = 0, km = -1, e2 = 0, np = 0, sx = 0, sp = 0, sxx = 0, sxp = 0;
    for (let k = 0; k < M.nN; k++) { const u = ue(M.X[k], M.Y[k], M.Z[k]); e += (R.u[k] - u) ** 2 + R.v[k] ** 2 + R.w[k] ** 2; n2 += u * u;
      if (isNaN(R.p[k])) continue;
      const d = Math.abs(R.p[k] - G * (L - M.X[k])); if (d > em) { em = d; km = k; } e2 += d * d; np++;
      sx += M.X[k]; sp += R.p[k]; sxx += M.X[k] ** 2; sxp += M.X[k] * R.p[k]; }
    const slope = (np * sxp - sx * sp) / (np * sxx - sx * sx);
    return { e: Math.sqrt(e / n2), eG: Math.abs(-slope / G - 1), eRms: Math.sqrt(e2 / np) / (G * L), eMax: em / (G * L), at: [M.X[km], M.Y[km], M.Z[km]], nE: M.nE }; };
  const T = [0.3e-3, 0.2e-3].map(h => { const M = tetBox(L, 2 * a, 2 * a, h); return { h: Math.cbrt(2 * a * 2 * a * L / M.nE), ...run(M) }; });
  const Hx = [2, 4].map(n => ({ h: 2 * a / n, ...run(hexBox(L, 2 * a, 2 * a, 2 * n, n, n)) }));
  const ot = Math.log(T[0].e / T[1].e) / Math.log(T[0].h / T[1].h), oh = Math.log(Hx[0].e / Hx[1].e) / Math.log(Hx[0].h / Hx[1].h);
  const corner = p => p[0] === 0 && (p[1] === 0 || Math.abs(p[1] - 2 * a) < 1e-15) && (p[2] === 0 || Math.abs(p[2] - 2 * a) < 1e-15);
  const pr = q => `gradient off ${q.eG.toExponential(1)}, RMS ${q.eRms.toExponential(1)}, largest ${q.eMax.toExponential(1)}${corner(q.at) ? ' at an inlet corner' : ` at (${q.at.map(v => (v * 1e3).toFixed(2)).join(', ')}) mm`}`;
  check('a square duct (the exact series): the velocity\'s error falling at order 3 on tetrahedra, as on hexahedra; the pressure gradient G, the pressure\'s RMS error under 1 %',
    ot > 2.5 && oh > 2.5 && [T[1], Hx[1]].every(q => q.eG < 2e-3 && q.eRms < 0.01),
    `tetrahedra: ${T.map(q => `${q.nE} elements, ${q.e.toExponential(2)}`).join(', ')} (order ${ot.toFixed(2)}; pressure ${pr(T[1])}); hexahedra: ${Hx.map(q => `${q.nE} elements, ${q.e.toExponential(2)}`).join(', ')} (order ${oh.toFixed(2)}; pressure ${pr(Hx[1])})`);
}

// 6. slip along a curved surface's own normal on tetrahedra: a channel tilted 20°, its floor a wall, its lid slip along the
//    lid's own normal; half-Poiseuille along it, u' = G y'(2h − y')/(2μ), p = G (L − x') -- exact in the elements
{
  const th = 20 * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th), L = 3e-3, h = 1e-3, Wz = 1e-3, mu = 1, G = 1e4;
  const M = tetBox(L, h, Wz, 0.4e-3, (x, y, z) => [x * c - y * sn, x * sn + y * c, z]);
  const loc = (X, Y) => [X * c + Y * sn, -X * sn + Y * c];
  const uex = (X, Y) => { const [, yy] = loc(X, Y), u = G * yy * (2 * h - yy) / (2 * mu); return [u * c, u * sn, 0]; };
  const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, bc: {
    y0: { type: 'velocity', u: [0, 0, 0] }, y1: { type: 'slip', normal: 'surface' }, x0: { type: 'velocity', u: (X, Y) => uex(X, Y) },
    z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' },
    x1: { type: 'traction', t: (X, Y) => { const [, yy] = loc(X, Y), tau = G * (h - yy); return [-tau * sn, tau * c, 0]; } } } });
  const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
  let eu = 0, um = 0; for (let k = 0; k < M.nN; k++) { const u = uex(M.X[k], M.Y[k]); eu = Math.max(eu, Math.abs(R.u[k] - u[0]), Math.abs(R.v[k] - u[1]), Math.abs(R.w[k])); um = Math.max(um, Math.hypot(u[0], u[1])); }
  const Ql = FF.ffFlow(S, R.x, 'y1'), Qo = FF.ffFlow(S, R.x, 'x1');
  check('slip along a tilted surface\'s own normal on tetrahedra: half-Poiseuille exact, nothing through the lid', eu / um < 1e-9 && Math.abs(Ql) < 1e-10 * Math.abs(Qo),
    `${M.nE} tetrahedra; velocity ${(eu / um).toExponential(1)}; through the lid ${(Ql / Qo).toExponential(1)} of the outflow`);
}

// 7. a free surface on tetrahedra: refused, saying so
{
  const M = tetBox(2e-3, 1e-3, 1e-3, 0.5e-3); let msg = '';
  try { FF.ffSetup({ mesh: M, mu: () => 1, Lr: 1e-3, Ur: 1e-2, bc: { y1: { type: 'free', sigma: 0.05 }, y0: { type: 'velocity', u: [0, 0, 0] } } }); } catch (e) { msg = e.message; }
  check('a free surface on tetrahedra refused, plainly', /free surface .* on tetrahedra: not yet/.test(msg), `"${msg}"`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
