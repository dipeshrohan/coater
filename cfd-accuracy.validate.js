/*
 * cfd-accuracy.validate.js — checks of the "Mesh to an accuracy" parts (cfd-accuracy.js):
 *  1. the error estimate is zero (to rounding) for a flow the quadratic elements hold exactly (Couette-Poiseuille);
 *  2. for a flow they do not (a sine), it tracks the true error: effectivity near 1, and it falls as h^4 (squared);
 *  3. the refinement splits the columns and rows carrying the error, and keeps neighbours within a factor of two;
 *  4. Richardson extrapolation recovers the order and the limit of f(h) = f0 + C h^p, equal and unequal ratios;
 *  5. one adaptive step on the coater: the refined mesh solves, keeps its element ends, and moves the film little;
 *  6-9. the same in 3D (27-node hexahedra): zero on a flow they hold, effectivity near 1 on a sine, splitting
 *     across the web where the error is, and one adaptive step of a 3D strip on the coater.
 * Run: node cfd-accuracy.validate.js
 */
const { accIndicator, accRefine, accRichardson, accShape, accNodes } = require('./cfd-accuracy.js');
let bad = 0;
const ok = (c, t) => { if (!c) bad++; console.log(`${c ? 'PASS' : 'FAIL'} ${t}`); };

// a mapped channel mesh: nEx x nEy quadratic elements over [0, L] x [0, h(x)], rows graded, columns graded
function channel(nEx, nEy, L, hFn, u, v, skew = 0) {
  const nx = 2 * nEx + 1, ny = 2 * nEy + 1, N = nx * ny, gx = new Float64Array(N), gy = new Float64Array(N), U = new Float64Array(N), V = new Float64Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const t = i / (nx - 1), e = j / (ny - 1), x = L * (0.6 * t + 0.4 * t * t) + skew * e * L / nEx, y = e * hFn(x), k = j * nx + i;
    gx[k] = x; gy[k] = y; U[k] = u(x, y); V[k] = v(x, y);
  }
  return { nx, ny, gx, gy, u: U, v: V };
}
// the true error of the element gradients against the exact ones (the same norm as the estimate)
function trueError(g, gradExact) {
  const G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], W = [5 / 9, 8 / 9, 5 / 9], nEx = (g.nx - 1) / 2, nEy = (g.ny - 1) / 2;
  let tot = 0;
  for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
    const K = accNodes(g, ex, ey);
    for (let q = 0; q < 3; q++) for (let r = 0; r < 3; r++) {
      const S = accShape(g, K, G[r], G[q]);
      let x = 0, y = 0, ux = 0, uy = 0, vx = 0, vy = 0;
      for (let n = 0; n < 9; n++) { x += g.gx[K[n]] * S.N[n]; y += g.gy[K[n]] * S.N[n]; ux += g.u[K[n]] * S.Nx[n]; uy += g.u[K[n]] * S.Ny[n]; vx += g.v[K[n]] * S.Nx[n]; vy += g.v[K[n]] * S.Ny[n]; }
      const e = gradExact(x, y);
      tot += ((ux - e[0]) ** 2 + (uy - e[1]) ** 2 + (vx - e[2]) ** 2 + (vy - e[3]) ** 2) * Math.abs(S.det) * W[r] * W[q];
    }
  }
  return tot;
}

// 1. Couette-Poiseuille in a straight channel (u quadratic in y, v = 0): held exactly
{
  const H = 1e-3, g = channel(8, 4, 0.01, () => H, (x, y) => 0.01 * (y / H) + 0.02 * (y / H) * (1 - y / H), () => 0);
  const ind = accIndicator(g), energy = trueError({ ...g, u: new Float64Array(g.u.length), v: new Float64Array(g.v.length) }, () => [0, 0, 0, 0]) || 0;
  // (the flow's own gradient energy, for scale: the same integral with the exact gradients against zero)
  const own = trueError({ ...g, u: new Float64Array(g.u.length), v: new Float64Array(g.v.length) }, (x, y) => [0, 0.01 / H + 0.02 * (1 - 2 * y / H) / H, 0, 0]);
  ok(ind.total < 1e-20 * own, `Couette-Poiseuille, straight channel: error estimate ${ind.total.toExponential(1)} against the flow's gradient energy ${own.toExponential(1)} (zero to rounding)`);
}
// 2. a sine the elements cannot hold: effectivity and rate
{
  const k = 2 * Math.PI / 0.004, H = 1e-3;
  const u = (x, y) => Math.sin(k * x) * y / H, v = (x, y) => 0.3 * Math.cos(k * x) * y * (H - y) / (H * H);
  const gradE = (x, y) => [k * Math.cos(k * x) * y / H, Math.sin(k * x) / H, -0.3 * k * Math.sin(k * x) * y * (H - y) / (H * H), 0.3 * Math.cos(k * x) * (H - 2 * y) / (H * H)];
  const res = [];
  for (const [nEx, nEy] of [[16, 4], [32, 8], [64, 16]]) {
    const g = channel(nEx, nEy, 0.01, () => H, u, v);
    res.push({ n: nEx, est: accIndicator(g).total, tru: trueError(g, gradE) });
  }
  for (const r of res) ok(r.est / r.tru > 0.5 && r.est / r.tru < 2, `sine, ${r.n} columns: estimate / true error ${(r.est / r.tru).toFixed(3)} (effectivity near 1)`);
  const rate = Math.log(res[1].est / res[2].est) / Math.log(2);
  ok(rate > 3.5 && rate < 4.5, `sine: the estimate falls as h^${rate.toFixed(2)} (squared error of quadratics: h^4)`);
  // a curved, skewed mesh: still near 1
  const g = channel(32, 8, 0.01, x => H * (1 + 0.3 * Math.sin(300 * x)), u, v, 0.2);
  const e = accIndicator(g).total / trueError(g, gradE);
  ok(e > 0.5 && e < 2, `sine on a curved, skewed mesh: effectivity ${e.toFixed(3)}`);
}
// 3. the refinement
{
  const frac = { b: [0, 0.3, 0.55, 0.75, 0.9, 1], f: [0, 0.5, 1], s: [0, 0.2, 0.5, 1], y: [0, 0.4, 0.7, 0.9, 1] };
  const nEx = 5 + 2 + 3, nEy = 4, eta2 = new Float64Array(nEx * nEy).fill(1e-6);
  for (let ey = 0; ey < nEy; ey++) eta2[ey * nEx + 4] = 1;      // the last blade column carries the error
  eta2[3 * nEx + 5] = 3;                                          // and the top row's first face element
  const r = accRefine(frac, { eta2, nEx, nEy });
  const has = (a, v) => a.some(x => Math.abs(x - v) < 1e-12);
  // (marked from the largest until half the column total: the blade's last column (4 of about 7) is enough, so the
  // face column (3) is not; rows until 0.3 of the total: the top row (4 of 7))
  ok(has(r.frac.b, 0.95) && r.frac.f.length === 3 && has(r.frac.y, 0.95), `splits the columns and rows carrying most of the error (the blade's last column, the top row; not the face column below the share): ${r.cols} columns, ${r.rows} rows split (with their neighbours)`);
  const smooth = a => { let m = 1; for (let k = 1; k < a.length - 1; k++) { const p = a[k] - a[k - 1], q = a[k + 1] - a[k]; m = Math.max(m, p / q, q / p); } return m; };
  ok([r.frac.b, r.frac.f, r.frac.s, r.frac.y].every(a => a.every((x, k) => !k || x > a[k - 1]) && a[0] === 0 && a[a.length - 1] === 1), 'element ends still increasing from 0 to 1');
  ok(smooth(r.frac.b) <= 2.01 && smooth(r.frac.y) <= 2.01, `neighbours within ×2 (blade ×${smooth(r.frac.b).toFixed(2)}, rows ×${smooth(r.frac.y).toFixed(2)})`);
  let threw = false; try { accRefine(frac, { eta2, nEx: nEx + 1, nEy }); } catch (e) { threw = true; }
  ok(threw, 'refusing element ends that do not match the mesh');
}
// 4. Richardson
{
  const f = h => 1.5 + 0.8 * h * h;
  const a = accRichardson(f(1), f(0.8), f(0.64), 1.25, 1.25);
  ok(a && Math.abs(a.p - 2) < 1e-6 && Math.abs(a.extrapolated - 1.5) < 1e-9, `f0 + C h^2, ratios 1.25: order ${a.p.toFixed(6)}, limit ${a.extrapolated.toFixed(9)}`);
  const g = h => 2 - 0.3 * Math.pow(h, 1.5);
  const b = accRichardson(g(1), g(0.7), g(0.4), 1 / 0.7, 0.7 / 0.4);
  ok(b && Math.abs(b.p - 1.5) < 1e-5 && Math.abs(b.extrapolated - 2) < 1e-7, `f0 - C h^1.5, unequal ratios: order ${b.p.toFixed(6)}, limit ${b.extrapolated.toFixed(8)}`);
  ok(accRichardson(1, 1.1, 1.05, 1.25, 1.25) === null, 'changes swapping sign: no order (null)');
}
// 5. one adaptive step on the coater
{
  const gap = require('./cfd-gap-solver.js'); global.bandFactor = gap.bandFactor; global.bandSolve = gap.bandSolve;
  const { muEffLocal } = require('./cfd-solver.js');
  const { solveCoaterFEM, coaterGrid } = require('./cfd-fem.js');
  const { bladeShape } = require('./cfd-1d.js');
  const o = { geometry: 'flat', H: 1.7e-3, L: 0.01, exitAngle: 90, contactDeg: 35 };
  const shape = bladeShape(o), xe = shape.Lx, H = shape.h(xe), U = 0.28 / 60, law = gd => muEffLocal(gd, 10.5, 5, 1);
  const fo = { hFn: shape.h, xe, faceDeg: 90, contactDeg: 35, U, Pup: 720, rho: 1020, g: 9.81, gamma: 0.07, mu: law, gdMin: 1e-3 * U / H, webSlip: 0,
    Ld: Math.max(12e-3, 8 * H), nEb: 12, nEf: 3, nEs: 12, nEy: 4, fInfGuess: H * 0.9 };
  const geo = { xe, H, faceDeg: 90, contactDeg: 35, U };
  const t0 = Date.now(), r0 = solveCoaterFEM(fo), g0 = coaterGrid(r0, geo);
  const ind = accIndicator(g0), ref = accRefine(g0.mesh.frac, ind);
  const r1 = solveCoaterFEM({ ...fo, meshFrac: ref.frac }), g1 = coaterGrid(r1, geo);
  const d = (g1.Q - g0.Q) / g0.Q;
  // where the error is: the columns next to the metering edge carry more than the average
  const nEx = ind.nEx, col = new Float64Array(nEx);
  for (let ey = 0; ey < ind.nEy; ey++) for (let ex = 0; ex < nEx; ex++) col[ex] += ind.eta2[ey * nEx + ex];
  const iEdge = g0.iCorner / 2, near = col[iEdge - 1] + col[iEdge], mean = col.reduce((a, b) => a + b, 0) / nEx;
  ok(r0.converged && r1.converged && g1.mesh.nEx > g0.mesh.nEx, `coater, flat land: ${g0.mesh.nEx} × ${g0.mesh.nEy} → ${g1.mesh.nEx} × ${g1.mesh.nEy} elements (split ${ref.cols} columns, ${ref.rows} rows), both converged (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  ok(near > 2 * mean, `the error sits at the metering edge: the two columns beside it carry ${(near / mean).toFixed(1)} × the mean column's`);
  ok(Math.abs(d) < 0.01, `the refined mesh moves the wet film ${(d * 100).toFixed(3)} %`);
  const back = g1.mesh.frac, same = ['b', 's', 'y'].every(k => back[k].length === ref.frac[k].length && back[k].every((x, j) => Math.abs(x - ref.frac[k][j]) < 1e-12));
  ok(same, 'the solved mesh keeps the element ends it was given');
}
// 6-8. the 3D: 27-node hexahedra on a box (graded, x along the flow, y up, z across)
{
  const { accIndicator3, accRefine3, accShape3, accNodes3 } = require('./cfd-accuracy.js');
  const box = (nEx, nEy, nEz, L, H, W, u, v, w) => {
    const NC = 2 * nEx + 1, NR = 2 * nEy + 1, NL = 2 * nEz + 1, N = NC * NR * NL, R = { NC, NR, NL };
    for (const f of ['x', 'y', 'z', 'u', 'v', 'w', 'mu']) R[f] = new Float64Array(N);
    for (let c = 0; c < NC; c++) for (let l = 0; l < NL; l++) for (let k = 0; k < NR; k++) {
      const t = c / (NC - 1), e = k / (NR - 1), q = l / (NL - 1), n = (c * NL + l) * NR + k;
      const x = L * (0.6 * t + 0.4 * t * t), y = H * e * (1 + 0.1 * t), z = W * (q - 0.5);
      R.x[n] = x; R.y[n] = y; R.z[n] = z; R.u[n] = u(x, y, z); R.v[n] = v(x, y, z); R.w[n] = w(x, y, z); R.mu[n] = 1;
    }
    return R;
  };
  const true3 = (R, gradE) => {
    const G = [-Math.sqrt(0.6), 0, Math.sqrt(0.6)], Wt = [5 / 9, 8 / 9, 5 / 9], nEx = (R.NC - 1) / 2, nEy = (R.NR - 1) / 2, nEz = (R.NL - 1) / 2;
    let tot = 0;
    for (let ez = 0; ez < nEz; ez++) for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) {
      const K = accNodes3(R, ex, ey, ez);
      for (let q = 0; q < 3; q++) for (let p = 0; p < 3; p++) for (let r = 0; r < 3; r++) {
        const S = accShape3(R, K, G[r], G[p], G[q]);
        let x = 0, y = 0, z = 0; const g = new Array(9).fill(0);
        for (let n = 0; n < 27; n++) {
          const k = K[n]; x += R.x[k] * S.N[n]; y += R.y[k] * S.N[n]; z += R.z[k] * S.N[n];
          g[0] += R.u[k] * S.Nx[n]; g[1] += R.u[k] * S.Ny[n]; g[2] += R.u[k] * S.Nz[n]; g[3] += R.v[k] * S.Nx[n]; g[4] += R.v[k] * S.Ny[n]; g[5] += R.v[k] * S.Nz[n]; g[6] += R.w[k] * S.Nx[n]; g[7] += R.w[k] * S.Ny[n]; g[8] += R.w[k] * S.Nz[n];
        }
        const e = gradE(x, y, z);
        let d = 0; for (let m = 0; m < 9; m++) d += (g[m] - e[m]) ** 2;
        tot += d * Math.abs(S.det) * Wt[r] * Wt[p] * Wt[q];
      }
    }
    return tot;
  };
  const H = 1e-3, W = 4e-3, L = 0.01;
  // 6. a flow the hexahedra hold (quadratic up, linear across): zero
  {
    const R = box(6, 3, 3, L, H, W, (x, y) => 0.02 * (y / H) * (1 - y / H) + 0.01 * y / H, () => 0, (x, y, z) => 0.003 * z / W + 0.001 * y / H);
    const est = accIndicator3(R).total, own = true3({ ...R, u: new Float64Array(R.u.length), v: new Float64Array(R.u.length), w: new Float64Array(R.u.length) }, () => [0, 0.02, 0, 0, 0, 0, 0, 1, 0.75]);
    ok(est < 1e-18 * own, `3D, a flow the hexahedra hold: error estimate ${est.toExponential(1)} against ${own.toExponential(1)} (zero to rounding)`);
  }
  // 7. a sine along the flow and across: effectivity
  {
    const k = 2 * Math.PI / 0.004, m = 2 * Math.PI / W;
    const u = (x, y, z) => Math.sin(k * x) * Math.cos(m * z) * y / H, v = () => 0, w = (x, y, z) => 0.2 * Math.sin(m * z) * y / H;
    const gE = (x, y, z) => [k * Math.cos(k * x) * Math.cos(m * z) * y / H, Math.sin(k * x) * Math.cos(m * z) / H, -m * Math.sin(k * x) * Math.sin(m * z) * y / H, 0, 0, 0, 0, 0.2 * Math.sin(m * z) / H, 0.2 * m * Math.cos(m * z) * y / H];
    // (the coarse mesh, 6 hexahedra per wavelength across, over-estimates; as the mesh is refined the estimate approaches the true error)
    const eff = [[16, 3, 6], [32, 4, 12]].map(([a, b, c]) => { const R = box(a, b, c, L, H, W, u, v, w); return { n: `${a} × ${b} × ${c}`, e: accIndicator3(R).total / true3(R, gE) }; });
    ok(eff[1].e > 0.5 && eff[1].e < 2 && Math.abs(eff[1].e - 1) < Math.abs(eff[0].e - 1), `3D sine: estimate / true error ${eff.map(q => `${q.e.toFixed(3)} on ${q.n}`).join(', ')} (approaching 1 as the mesh is refined)`);
  }
  // 8. splitting across where the error sits
  {
    const frac = { b: [0, 0.5, 1], f: [0], s: [0, 1], y: [0, 0.5, 1] }, nEx = 3, nEy = 2, nEz = 4, eta2 = new Float64Array(nEx * nEy * nEz).fill(1e-6);
    for (let ey = 0; ey < nEy; ey++) for (let ex = 0; ex < nEx; ex++) eta2[(3 * nEy + ey) * nEx + ex] = 1;   // the last layer across
    const r = accRefine3(frac, [0, 0.25, 0.5, 0.75, 1], { eta2, nEx, nEy, nEz });
    ok(r.zFrac.some(z => Math.abs(z - 0.875) < 1e-12) && r.layers >= 1 && r.zFrac.length > 5, `3D: splits the layer across that carries the error (ends ${r.zFrac.map(z => z.toFixed(3)).join(', ')})`);
  }
  // 9. one adaptive step of a 3D strip on the coater
  {
    const gap = require('./cfd-gap-solver.js'); global.bandFactor = gap.bandFactor; global.bandSolve = gap.bandSolve;
    const { muEffLocal } = require('./cfd-solver.js'), FEM = require('./cfd-fem.js'); Object.assign(global, FEM);
    const { solveCoater3D } = require('./cfd-fem3d.js'), { bladeShape } = require('./cfd-1d.js');
    const o = { geometry: 'flat', H: 1.7e-3, L: 0.01, exitAngle: 90, contactDeg: 35 };
    const shape = bladeShape(o), xe = shape.Lx, Hh = shape.h(xe), U = 0.28 / 60, law = gd => muEffLocal(gd, 10.5, 5, 1);
    const fo = { hFn: shape.h, xe, faceDeg: 90, contactDeg: 35, U, Pup: 720, rho: 1020, g: 9.81, gamma: 0.07, mu: law, gdMin: 1e-3 * U / Hh, webSlip: 0,
      Ld: Math.max(12e-3, 8 * Hh), nEb: 10, nEf: 2, nEs: 8, nEy: 2, fInfGuess: Hh * 0.9, width: 0.004, nEz: 2, dH: z => 20e-6 * z / 0.002 };
    const t0 = Date.now(), a = solveCoater3D(fo);
    const R = a.r3, frac = a.r2[2].meshDef.frac, zF = [0, 0.5, 1];
    const ind = accIndicator3(R), ref = accRefine3(frac, zF, ind);
    const zsE = ref.zFrac.map(f => -0.002 + 0.004 * f), zs = []; for (let e = 0; e < zsE.length - 1; e++) zs.push(zsE[e], 0.5 * (zsE[e] + zsE[e + 1])); zs.push(zsE[zsE.length - 1]);
    const b = solveCoater3D({ ...fo, meshFrac: ref.frac, nEz: (zs.length - 1) / 2, zs });
    const mid = s => s.stations[(s.stations.length - 1) >> 1].film, d = (mid(b) - mid(a)) / mid(a);
    ok(a.r3.converged && b.r3 && b.r3.converged && b.r3.NC > a.r3.NC, `3D strip: ${(a.r3.NC - 1) / 2} × ${(a.r3.NR - 1) / 2} × ${(a.r3.NL - 1) / 2} → ${(b.r3.NC - 1) / 2} × ${(b.r3.NR - 1) / 2} × ${(b.r3.NL - 1) / 2} hexahedra, both converged; middle film moves ${(d * 100).toFixed(3)} % (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}
console.log(bad ? `${bad} FAILED` : 'ALL PASS');
process.exit(bad ? 1 : 0);
