/*
 * feed-fem-layers.validate.js — checks of feed-fem.js on the tetrahedral mesher's meshes with prism layers on their walls
 * (MESH-T3e: um-tetlayers.js's prisms made quadratic with the tetrahedra, um-tetmesh.js's umtQuadratic; P2–P1 wedges,
 * um-fe.js's wedge18 and wedge6, beside P2–P1 tetrahedra) against exact solutions.
 * Run: node feed-fem-layers.validate.js
 *  1. The mesh: a 2 mm channel with three layers on its floor and its ceiling, made quadratic: every element positive,
 *     the volume the channel's to round-off, every face of the walls and the layers' sides tagged.
 *  2. Plane Poiseuille flow through it: the quadratic profile and the linear pressure are in both elements, so the
 *     solution is exact to round-off; the flow rate out exact.
 *  3. The Newton Jacobian against finite differences of the residual on the layered mesh bent by a smooth map (curved
 *     prisms and tetrahedra): a shear-thinning paste with a yield stress, inertia and gravity.
 *  4. A manufactured solution on the layered mesh, curved: the velocity's error falls at the elements' order (3), the
 *     pressure's at least at 2.
 *  5. The multigrid preconditioner (each prism's 24 linear sub-tetrahedra): GMRES iterations nearly level under
 *     refinement.
 */
const FF = require('../engine/feed-fem.js'), MT = require('../engine/um-tetmesh.js'), UL = require('../engine/um-tetlayers.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

/** A box Lx × H × Wz meshed at size h with n layers (total thickness T) on its floor and ceiling, quadratic, every node
 *  then moved by f; faces x0 x1 (the ends), floor, ceiling, z0 z1. */
function layeredBox(Lx, H, Wz, h, n, T, f) {
  const G = { X: [0, Lx, Lx, 0, 0, Lx, Lx, 0], Y: [0, 0, H, H, 0, 0, H, H], Z: [0, 0, 0, 0, Wz, Wz, Wz, Wz],
    faces: [{ loops: [[0, 3, 2, 1]], tag: 'z0' }, { loops: [[4, 5, 6, 7]], tag: 'z1' }, { loops: [[0, 1, 5, 4]], tag: 'floor' }, { loops: [[3, 7, 6, 2]], tag: 'ceiling' }, { loops: [[0, 4, 7, 3]], tag: 'x0' }, { loops: [[1, 2, 6, 5]], tag: 'x1' }] };
  const first = T * 0.3 / (Math.pow(1.3, n) - 1), sp = [{ tags: ['floor'], n, first, growth: 1.3 }, { tags: ['ceiling'], n, first, growth: 1.3 }];
  const Q = MT.umtQuadratic(UL.umlMesh(MT.umtSurface(G, { size: h }), sp, { size: h }), {});
  if (f) for (let k = 0; k < Q.nN; k++) { const p = f(Q.X[k], Q.Y[k], Q.Z[k]); Q.X[k] = p[0]; Q.Y[k] = p[1]; Q.Z[k] = p[2]; }
  return Q;
}
/** ∫ f · N_a dV for every velocity unknown (scaled as the residual), over every block. */
function ffForce(S, force) {
  const F = new Float64Array(S.nD), M = S.M;
  for (const B of S.B) { const K = B.K, T = K.T;
    for (let e = 0; e < B.nE; e++) {
      const el = B.conn.subarray(K.npe * e, K.npe * e + K.npe);
      for (let q = 0; q < K.nq; q++) {
        let X = 0, Y = 0, Z = 0; for (let a = 0; a < K.npe; a++) { const N = T.N[q * K.npe + a]; X += N * M.X[el[a]]; Y += N * M.Y[el[a]]; Z += N * M.Z[el[a]]; }
        const w = S.geo[(B.g0 + e * K.nq + q) * 10 + 9], fv = force(X, Y, Z).map(v => v * S.Lr / S.Pr);
        for (let a = 0; a < K.npe; a++) { const N = T.N[q * K.npe + a]; for (let i = 0; i < 3; i++) F[3 * el[a] + i] += w * N * fv[i]; }
      }
    }
  }
  return F;
}
const count = Q => Q.blocks.map(b => `${b.nE} ${b.type === 'tet10' ? 'tetrahedra' : 'prisms'}`).join(' and ');

// 1. the mesh
const Hc = 2e-3, Lc = 20e-3, Wc = 15e-3, Q0 = layeredBox(Lc, Hc, Wc, 1e-3, 3, 0.6e-3);
{
  const S = FF.ffSetup({ mesh: Q0, mu: () => 1, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, bc: {} });
  let V = 0; for (let q = 0; q < S.geo.length / 10; q++) V += S.geo[q * 10 + 9];
  const tags = {}; for (const F of Q0.faces) tags[F.tag] = (tags[F.tag] || 0) + 1;
  check('a channel with prism layers on both walls made quadratic: every element positive, its volume the channel\'s, every boundary face tagged',
    Q0.type === 'mixed' && S.minDet > 0 && Math.abs(V * 1e-9 / (Lc * Hc * Wc) - 1) < 1e-12 && ['x0', 'x1', 'floor', 'ceiling', 'z0', 'z1'].every(t => tags[t] > 0),
    `${count(Q0)}, ${Q0.nN} nodes; volume off ${(V * 1e-9 / (Lc * Hc * Wc) - 1).toExponential(1)}; faces ${Object.entries(tags).map(([t, n]) => `${t} ${n}`).join(', ')}`);
}

// 2. plane Poiseuille: u = G y (H − y) / (2 μ), p = G (L − x); at the outlet the exact traction (0, μ u′(y), 0)
{
  const mu = 2, G = 1e4, ue = y => G * y * (Hc - y) / (2 * mu);
  const S = FF.ffSetup({ mesh: Q0, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, bc: { floor: { type: 'velocity', u: [0, 0, 0] }, ceiling: { type: 'velocity', u: [0, 0, 0] },
    x0: { type: 'velocity', u: (x, y) => [ue(y), 0, 0] }, z0: { type: 'slip', normal: 'z' }, z1: { type: 'slip', normal: 'z' }, x1: { type: 'traction', t: (x, y) => [0, G * (Hc - 2 * y) / 2, 0] } } });
  const R = FF.ffSolve(S, { tol: 1e-12, linTol: 1e-12 });
  let eu = 0, um = 0, ep = 0;
  for (let n = 0; n < Q0.nN; n++) { eu = Math.max(eu, Math.hypot(R.u[n] - ue(Q0.Y[n]), R.v[n], R.w[n])); um = Math.max(um, ue(Q0.Y[n])); if (!isNaN(R.p[n])) ep = Math.max(ep, Math.abs(R.p[n] - G * (Lc - Q0.X[n]))); }
  const Qo = FF.ffFlow(S, R.x, 'x1'), Qe = G * Hc ** 3 / (12 * mu) * Wc;
  check('plane Poiseuille through the layers and the tetrahedra: velocity and pressure exact to round-off, the flow rate out exact',
    eu / um < 1e-9 && ep / (G * Lc) < 1e-8 && Math.abs(Qo / Qe - 1) < 1e-9,
    `velocity ${(eu / um).toExponential(1)}, pressure ${(ep / (G * Lc)).toExponential(1)}, flow ${(Qo / Qe - 1).toExponential(1)}; Newton ${R.hist.length}, GMRES ${R.hist.map(h => h.lin).join(', ')}`);
}

// 3. the Jacobian against finite differences (yield stress, shear-thinning, inertia, gravity, curved elements)
{
  const bend = (x, y, z) => [x + 0.15e-3 * Math.sin(500 * y) * Math.cos(300 * z), y + 0.05e-3 * Math.sin(400 * x), z + 0.1e-3 * Math.sin(250 * x)];
  const M = layeredBox(4e-3, Hc, 3e-3, 1.2e-3, 2, 0.5e-3, bend);
  const S = FF.ffSetup({ mesh: M, mu: gd => 2 / gd + 5 * Math.pow(gd, -0.4), gdMin: 0.5, rho: 1300, g: 9.81, Lr: 1e-3, Ur: 1e-2,
    bc: { floor: { type: 'velocity', u: [1e-2, 0, 0] }, ceiling: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: [0, 0, 0] } } });
  let rng = 3; const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647 - 0.5;
  const x = new Float64Array(S.nD).map((v, i) => (S.fix[i] ? S.val[i] : rnd())), dx = new Float64Array(S.nD).map((v, i) => (S.fix[i] ? 0 : rnd()));
  FF.ffResidual(S, x); const J = FF.ffJacVec(S, dx), h = 1e-7;
  const Rp = FF.ffResidual(S, x.map((v, i) => v + h * dx[i])), Rm = FF.ffResidual(S, x.map((v, i) => v - h * dx[i]));
  let num = 0, den = 0; for (let i = 0; i < S.nD; i++) { if (S.fix[i]) continue; const fd = (Rp[i] - Rm[i]) / (2 * h); num += (J[i] - fd) ** 2; den += fd * fd; }
  const err = Math.sqrt(num / den);
  check('the Jacobian on curved prisms and tetrahedra against finite differences (yield stress, shear-thinning, inertia, gravity)', err < 1e-6, `${count(M)}; relative difference ${err.toExponential(1)}`);
}

// 4. a manufactured solution: u = U0 (sin x cos y cos z, cos x sin y cos z, −2 cos x cos y sin z) (x in mm), p = P0 cos x sin(y + z)
{
  const s = 1e-3, U0 = 1e-3, P0 = 1, mu = 1;
  const uex = (X, Y, Z) => { const x = X / s, y = Y / s, z = Z / s; return [U0 * Math.sin(x) * Math.cos(y) * Math.cos(z), U0 * Math.cos(x) * Math.sin(y) * Math.cos(z), -2 * U0 * Math.cos(x) * Math.cos(y) * Math.sin(z)]; };
  const pex = (X, Y, Z) => P0 * Math.cos(X / s) * Math.sin(Y / s + Z / s);
  const force = (X, Y, Z) => { const u = uex(X, Y, Z), x = X / s, y = Y / s, z = Z / s;
    const gp = [-P0 * Math.sin(x) * Math.sin(y + z) / s, P0 * Math.cos(x) * Math.cos(y + z) / s, P0 * Math.cos(x) * Math.cos(y + z) / s];
    return [0, 1, 2].map(i => 3 * mu * u[i] / (s * s) + gp[i]); };
  const curved = (x, y, z) => [x + 0.04e-3 * Math.sin(3000 * y), y + 0.03e-3 * Math.sin(2500 * x) * Math.cos(2000 * z), z];
  const res = [];
  for (const [h, T] of [[0.5e-3, 0.3e-3], [0.25e-3, 0.15e-3]]) {
    const M = layeredBox(1e-3, 1e-3, 1e-3, h, 2, T, curved), all = ['x0', 'x1', 'floor', 'ceiling', 'z0', 'z1'];
    const S = FF.ffSetup({ mesh: M, mu: () => mu, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-3, fixPressure: true, bc: Object.fromEntries(all.map(t => [t, { type: 'velocity', u: uex }])) });
    const fsrc = ffForce(S, force), p0n = [...Array(M.nN).keys()].find(k => S.pOf[k] === 0); S.val[S.nU] = pex(M.X[p0n], M.Y[p0n], M.Z[p0n]) / S.Pr;
    const x0 = new Float64Array(S.nD); for (let i = 0; i < S.nD; i++) if (S.fix[i]) x0[i] = S.val[i];
    const R0 = FF.ffResidual(S, x0); for (let i = 0; i < S.nD; i++) if (!S.fix[i]) R0[i] -= fsrc[i];
    const lin = FF.ffFGMRES(S, FF.ffPrecond(S), R0.map(v => -v), { tol: 1e-12, restart: 80, maxIt: 1500 }), x = x0.map((v, i) => S.fix[i] ? v : v + lin.x[i]);
    let eu = 0, nu = 0; for (let k = 0; k < M.nN; k++) { const u = uex(M.X[k], M.Y[k], M.Z[k]); for (let c = 0; c < 3; c++) { eu += (x[3 * k + c] * S.Ur - u[c]) ** 2; nu += u[c] ** 2; } }
    let mean = 0, cnt = 0, pm = 0; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) { mean += x[S.nU + S.pOf[k]] * S.Pr - pex(M.X[k], M.Y[k], M.Z[k]); pm += pex(M.X[k], M.Y[k], M.Z[k]); cnt++; } mean /= cnt; pm /= cnt;
    let ep = 0, np = 0; for (let k = 0; k < M.nN; k++) if (S.pOf[k] >= 0) { ep += (x[S.nU + S.pOf[k]] * S.Pr - pex(M.X[k], M.Y[k], M.Z[k]) - mean) ** 2; np += (pex(M.X[k], M.Y[k], M.Z[k]) - pm) ** 2; }
    res.push({ h, M, eu: Math.sqrt(eu / nu), ep: Math.sqrt(ep / np), it: lin.it, res: lin.res });
  }
  const r = res[0].h / res[1].h, ou = Math.log(res[0].eu / res[1].eu) / Math.log(r), op = Math.log(res[0].ep / res[1].ep) / Math.log(r);
  check('a manufactured solution on curved prisms and tetrahedra: the velocity error falls at order 3, the pressure (its mean taken out) at least 2', ou > 2.6 && op > 1.8 && res.every(q => q.res < 1e-10),
    res.map(q => `${count(q.M)}: velocity ${q.eu.toExponential(2)}, pressure ${q.ep.toExponential(2)}, GMRES ${q.it}`).join('; ') + `; orders ${ou.toFixed(2)}, ${op.toFixed(2)} (the size halved, the layers with it)`);
}

// 5. the preconditioner: GMRES iterations nearly level under refinement (a driven channel with layers, distorted)
{
  const its = [];
  for (const h of [1e-3, 0.7e-3, 0.5e-3]) {
    const M = layeredBox(6e-3, Hc, 3e-3, h, 3, 0.3e-3, (x, y, z) => [x + 0.1e-3 * Math.sin(1500 * y), y, z + 0.05e-3 * Math.sin(1000 * x)]);
    const S = FF.ffSetup({ mesh: M, mu: () => 2, rho: 0, g: 0, Lr: 1e-3, Ur: 1e-2, fixPressure: true, bc: { floor: { type: 'velocity', u: [1e-2, 0, 0] }, ceiling: { type: 'velocity', u: [0, 0, 0] }, z0: { type: 'velocity', u: [0, 0, 0] }, z1: { type: 'velocity', u: [0, 0, 0] }, x0: { type: 'velocity', u: [0, 0, 0] } } });
    const t0 = Date.now(), R = FF.ffSolve(S, { tol: 1e-10, linTol: 1e-8 });
    its.push({ it: R.hist[0].lin, nD: S.nD, ms: Date.now() - t0 });
  }
  check('the multigrid preconditioner on prisms and tetrahedra: GMRES iterations nearly level under refinement', its[its.length - 1].it <= 2.5 * its[0].it + 10,
    its.map(q => `${q.nD} unknowns: ${q.it} iterations (${(q.ms / 1000).toFixed(1)} s)`).join('; '));
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
