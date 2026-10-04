'use strict';
/*
 * mix-mp.validate.js — MP-MIX 2D and 3D's checks (mix-mp.js): the moving solids by penalization on the fixed staggered grid,
 * the paste's inertia in time, its generalized-Newtonian viscosity, the heat it makes, the tracers, against independent
 * solutions.
 *  1. 2D: a cylinder spinning inside the still wall (circular Couette): its torque against the exact one, and closer on a
 *     finer grid.
 *  2. 2D: the same in a power-law paste (n = 1/2): the exact torque.
 *  3. 2D: a cylinder moving across the middle of the still wall: its drag against the exact Stokes drag (mixer.js's).
 *  4. 2D: a cylinder spinning off the vessel's axis (Jeffery's problem): its torque against OpenFOAM's (simpleFoam,
 *     body-fitted, three meshes, extrapolated).
 *  5. 2D in time: the paste in a vessel set spinning, from rest (its spin-up): the exact series (Bessel functions).
 *  6. 2D: the heat the shear makes: all of it against the power put in (the energy kept), and between the cylinders against
 *     the exact μ γ̇² of the Couette flow, closer on a finer grid; the jacket's heat through the wall against h ΔT 2πR, and
 *     the heat kept exactly.
 *  7. 2D: tracers in the paste turning as a solid body come back where they started after a turn; nothing mixes.
 *  8. 3D: a sphere spinning in a still spherical shell: the exact torque, closer on each finer grid.
 *  9. 3D: a tall cylinder spinning in the vessel (the floor slipping): the 2D's exact torque per height.
 * 10. 3D: a sphere moving through a still spherical container: the exact drag (Haberman and Sayre).
 */
const X = require('./mix-mp.js'), MX = require('./mixer.js');
// (OpenFOAM's torque per length on the off-axis spinning cylinder, check 4: a = 0.1, b = 0.25, e = 0.06 m, Ω = 1 rad/s,
//  μ = 1 Pa·s: 0.170925, 0.166608, 0.164329 N·m/m on its three meshes (each converged to its residual), the observed order
//  0.92, extrapolated (Richardson) -- see check 4)
const MX_OF_ECC = 0.16178;
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
const pc = v => `${(v * 100).toFixed(2)} %`;
Object.assign(X.MX_MG, { nu: 1, coarse: 20, om: 0.9 });

// a steady 2D solve (no inertia) with the extra solids given: its forces by owner
function steady2(N, R2, extra, law, picard = 1, sub = 4) {
  const r = X.mx2Run({ D: 2 * R2, extra, law, muRef: law(1), inertia: false, dt: 1, nSteps: 1, start: 'rest', mesh: { N, snaps: 1, sub, picard, tol: 1e-9, maxIt: 200 } });
  return { F: r.hist[r.hist.length - 1], r };
}
const spinning = (R1, Om, c = [0, 0], own = 1) => ({ own, axis: c, z0: -Infinity, z1: Infinity, bb: [c[0] - R1, c[1] - R1, c[0] + R1, c[1] + R1], inside: (x, y) => (x - c[0]) ** 2 + (y - c[1]) ** 2 < R1 * R1, vel: (x, y) => [-Om * (y - c[1]), Om * (x - c[0])] });

// 1. Couette
{
  const R1 = 0.1, R2 = 0.25, Om = 1, mu = 1, ex = 4 * Math.PI * mu * Om * R1 * R1 * R2 * R2 / (R2 * R2 - R1 * R1);
  const e = [64, 128, 256].map(N => steady2(N, R2, [spinning(R1, Om)], () => mu).F.TqOwn[1] / ex - 1);
  check('2D: a cylinder spinning inside the still wall: its torque against the exact (circular Couette)', Math.abs(e[1]) < 0.03 && Math.abs(e[2]) < Math.abs(e[0]),
    `64, 128, 256 cells across: ${e.map(pc).join(', ')}`);
}
// 2. power-law Couette
{
  const R1 = 0.1, R2 = 0.25, Om = 1, K = 1, n = 0.5, law = gd => K * Math.pow(Math.max(gd, 1e-3), n - 1);
  const ex = 2 * Math.PI * K * Math.pow(2 * Om / (n * (Math.pow(R1, -2 / n) - Math.pow(R2, -2 / n))), n);
  const e = steady2(128, R2, [spinning(R1, Om)], law, 6).F.TqOwn[1] / ex - 1;
  check('2D: the same in a power-law paste (n = ½): the exact torque', Math.abs(e) < 0.04, `128 cells across: ${pc(e)}`);
}
// 3. a cylinder moving across the middle
{
  const a = 0.05, b = 0.25, U = 0.01, mu = 1, ex = mu * U * MX.mixCellDrag(a, b);
  const mover = { own: 1, axis: [0, 0], z0: -Infinity, z1: Infinity, bb: [-a, -a, a, a], inside: (x, y) => x * x + y * y < a * a, vel: () => [U, 0] };
  const e = [64, 128].map(N => steady2(N, b, [mover], () => mu).F.Fx[1] / ex - 1);
  check('2D: a cylinder moving across the middle of the still wall: its drag against the exact Stokes drag', Math.abs(e[1]) < 0.05 && Math.abs(e[1]) < Math.abs(e[0]) + 0.005,
    `64, 128 cells across: ${e.map(pc).join(', ')}`);
}
// 4. Jeffery's problem against OpenFOAM
{
  // (OpenFOAM v1912, simpleFoam with ν = 1 (Stokes), the eccentric annulus meshed body-fitted (4 blocks between the inner
  //  and the outer circles' arcs), 160 × 40, 320 × 80 and 640 × 160 cells; the inner wall's torque per length from the
  //  wall shear (τ_rθ = μ a d(u_θ/r)/dr there, the pressure acting through its centre), extrapolated (Richardson))
  const R1 = 0.1, R2 = 0.25, e = 0.06, Om = 1, mu = 1, ref = MX_OF_ECC;
  const v = [128, 256].map(N => steady2(N, R2, [spinning(R1, Om, [e, 0])], () => mu).F.TqOwn[1] / ref - 1);
  check('2D: a cylinder spinning off the vessel\'s axis (Jeffery\'s problem): its torque against OpenFOAM\'s body-fitted solve, closer on the finer grid', Math.abs(v[1]) < 0.03 && Math.abs(v[1]) < Math.abs(v[0]),
    `e = 0.4 of the gap; OpenFOAM ${ref.toFixed(5)} N·m/m; 128, 256 cells across: ${v.map(pc).join(', ')}`);
}
// 5. spin-up
{
  const J = (n, z) => { let s = 0; const M = 400; for (let k = 0; k < M; k++) { const th = (k + 0.5) * Math.PI / M; s += Math.cos(n * th - z * Math.sin(th)); } return s / M; };
  const zeros = []; { let a = 0.5; while (zeros.length < 40) { const b = a + 0.05; if (J(1, a) * J(1, b) < 0) { let lo = a, hi = b; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (J(1, lo) * J(1, m) <= 0) hi = m; else lo = m; } zeros.push((lo + hi) / 2); } a = b; } }
  const R = 0.25, mu = 1, rho = 1000, nu = mu / rho, Om = 1;
  const exactU = (r, t) => Om * r + 2 * Om * R * zeros.reduce((s, l) => s + J(1, l * r / R) / (l * J(0, l)) * Math.exp(-l * l * nu * t / (R * R)), 0);
  const res = X.mx2Run({ D: 2 * R, wall: { W: Om }, law: () => mu, rho, muRef: mu, start: 'rest', dt: 0.5, tEnd: 15, mesh: { N: 64, snapTimes: [1, 2, 5, 10, 15], sub: 4 } });
  const G = res.G, j = G.N / 2; let ev = 0;
  for (const sn of res.snaps) for (const rf of [0.25, 0.5, 0.75, 0.9]) { const i = Math.round((rf * R - G.x0) / G.h - 0.5), x = G.x0 + (i + 0.5) * G.h; ev = Math.max(ev, Math.abs(sn.vc[i + G.N * j] - exactU(x, sn.t)) / (Om * R)); }
  check('2D in time: the paste in a vessel set spinning from rest: its velocity against the exact series', ev < 0.025,
    `largest difference ${pc(ev)} of the wall's speed, at a quarter to nine tenths of the radius, 1 to 15 s (ν t / R² up to 0.24)`);
}
// 6. the heat the shear makes
{
  const R1 = 0.1, R2 = 0.25, Om = 1, mu = 1, rho = 1, cp = 1, dt = 1, A = Om * R1 * R1 * R2 * R2 / (R2 * R2 - R1 * R1);
  const run = N => {
    const r = X.mx2Run({ D: 2 * R2, extra: [spinning(R1, Om)], law: () => mu, muRef: mu, rho, inertia: false, dt, nSteps: 1, start: 'rest', heat: { T0: 20, Tj: 20, hJ: 0, k: 0, cp }, mesh: { N, snaps: 1, sub: 4, picard: 1, tol: 1e-9, maxIt: 200 } });
    const G = r.G, sn = r.snaps[0], j = G.N / 2; let e = 0, cnt = 0, heat = 0;
    for (let i = G.N / 2; i < G.N; i++) { const x = G.x0 + (i + 0.5) * G.h; if (x < R1 + 5 * G.h || x > R2 - 5 * G.h) continue; const gd = 2 * A / (x * x), want = mu * gd * gd * dt / (rho * cp); e = Math.max(e, Math.abs(sn.dT[i + G.N * j] / want - 1)); cnt++; }
    // (all the heat made in the paste over the step against the power the cylinder put in: Stokes flow keeps no energy)
    for (let k = 0; k < G.N * G.N; k++) if (sn.fluid[k]) heat += sn.dT[k] * rho * cp / dt * G.h * G.h;
    return { e, cnt, eb: heat / r.hist[r.hist.length - 1].P[1] - 1 };
  };
  const q = [128, 256].map(run);
  check('2D: the heat the shear makes: all of it against the power the spinning cylinder puts in, and between the cylinders against the exact μ γ̇² of the Couette flow, closer on the finer grid', Math.abs(q[1].eb) < 0.04 && q[1].e < 0.1 && q[1].e < q[0].e && q[1].cnt > 10,
    `128, 256 cells across: the heat made ${q.map(v => pc(v.eb)).join(', ')} off the power put in; between them (5 cells clear of each wall) at most ${q.map(v => pc(v.e)).join(', ')} off the exact`);
}
// 6b. the jacket and the heat kept: a still paste warmer than the jacket
{
  const R = 0.25, hJ = 150, T0 = 30, Tj = 20, rho = 1000, cp = 4000, dt = 0.5;
  const r = X.mx2Run({ D: 2 * R, law: () => 1, muRef: 1, rho, inertia: false, dt, nSteps: 4, start: 'rest', heat: { T0, Tj, hJ, k: 0.6, cp }, mesh: { N: 128, snaps: 1, sub: 3, picard: 1 } });
  const H = r.hist, q1 = H[1].Qj, ex = hJ * (Tj - T0) * 2 * Math.PI * R, eq = q1 / ex - 1;
  let src = 0; for (let i = 1; i < H.length; i++) src += (H[i].Dis + H[i].Qj) * (H[i].t - H[i - 1].t);
  const kept = H[H.length - 1].Eh / src - 1;
  check('2D: the jacket\'s heat through the staircase of cells against its exact h ΔT 2πR, and the heat kept (the paste\'s against the jacket\'s and the shear\'s)', Math.abs(eq) < 0.01 && Math.abs(kept) < 1e-9,
    `the jacket ${q1.toFixed(1)} W/m against ${ex.toFixed(1)} (${pc(eq)}); the heat held against what came in and was made: ${kept.toExponential(1)}`);
}
// 7. tracers in a solid-body turn
{
  const R = 0.25, Om = 1, T = 2 * Math.PI / Om;
  const r = X.mx2Run({ D: 2 * R, wall: { W: Om }, law: () => 1, muRef: 1, inertia: false, dt: T / 120, nSteps: 120, start: 'rest', tracers: { n: 3000, tauC: Infinity }, mesh: { N: 64, snaps: 1, sub: 4, picard: 1 } });
  const t = r.tracers; let e = 0, n = 0; for (let q = 0; q < t.x.length; q++) { if (Math.hypot(t.x0[q], t.y0[q]) > 0.85 * R) continue; e = Math.max(e, Math.hypot(t.x[q] - t.x0[q], t.y[q] - t.y0[q])); n++; }
  const I = t.mix[t.mix.length - 1].I;
  check('2D: tracers in paste turning as a solid body come back where they started after a turn; nothing mixes', e / R < 0.03 && I > 0.97, `${n} tracers: the farthest ${pc(e / R)} of the radius from its start; mixing index ${I.toFixed(3)} (1 unmixed)`);
}
// a steady 3D solve with extra solids: its forces by owner
const steady3 = (N, D, H, extra, floor) => X.mx3Solve({ D, H, extra, law: () => 1, muRef: 1, floor, mesh: { N, Nz: Math.round(H / (D / (N - 4)) / 2) * 2, sub: 3, picard: 1, tol: 1e-8, maxIt: 120 } }, 0);
// 8. sphere in a spherical shell
{
  const a = 0.08, b = 0.2, Om = 1, D = 2 * b * 1.08, zc = D / 2, ex = 8 * Math.PI * Om * a ** 3 / (1 - (a / b) ** 3);
  const sphere = { own: 1, axis: [0, 0], z0: zc - a, z1: zc + a, bb: [-a, -a, a, a], inside: () => false, inside3: (x, y, z) => x * x + y * y + (z - zc) ** 2 < a * a, vel: (x, y) => [-Om * y, Om * x] };
  const shell = { own: 2, axis: [0, 0], z0: -Infinity, z1: Infinity, bb: [-D, -D, D, D], inside: () => false, inside3: (x, y, z) => x * x + y * y + (z - zc) ** 2 > b * b, vel: () => [0, 0] };
  const runs = [32, 48, 64].map(N => { const r = steady3(N, D, D, [sphere, shell]); return { h: r.G.h, e: r.F[1].TqOwn / ex - 1 }; });
  check('3D: a sphere spinning in a still spherical shell: its torque against the exact, closer on each finer grid', runs.every((q, i) => !i || Math.abs(q.e) < Math.abs(runs[i - 1].e)) && Math.abs(runs[runs.length - 1].e) < 0.08,
    `${(a * 1000).toFixed(0)} mm sphere in a ${(b * 1000).toFixed(0)} mm shell; cells ${runs.map(q => (q.h * 1000).toFixed(1)).join(', ')} mm: ${runs.map(q => pc(q.e)).join(', ')}`);
}
// 9. tall spinning cylinder = 2D Couette
{
  const R1 = 0.1, R2 = 0.25, Om = 1, H = 0.2, ex = 4 * Math.PI * Om * R1 * R1 * R2 * R2 / (R2 * R2 - R1 * R1) * H;
  const r = steady3(48, 2 * R2, H, [spinning(R1, Om)], 'slip');
  const e = r.F[1].TqOwn / ex - 1;
  check('3D: a tall cylinder spinning in the vessel (the floor and the top slipping): the 2D\'s exact torque per height', Math.abs(e) < 0.05, `48 cells across: ${pc(e)}`);
}
// 10. a sphere moving through a spherical container
{
  const a = 0.06, b = 0.2, U = 0.01, D = 2 * b * 1.08, zc = D / 2, k = a / b;
  const ex = 6 * Math.PI * a * U * (1 - k ** 5) / (1 - 9 / 4 * k + 5 / 2 * k ** 3 - 9 / 4 * k ** 5 + k ** 6);
  const sphere = { own: 1, axis: [0, 0], z0: zc - a, z1: zc + a, bb: [-a, -a, a, a], inside: () => false, inside3: (x, y, z) => x * x + y * y + (z - zc) ** 2 < a * a, vel: () => [U, 0] };
  const shell = { own: 2, axis: [0, 0], z0: -Infinity, z1: Infinity, bb: [-D, -D, D, D], inside: () => false, inside3: (x, y, z) => x * x + y * y + (z - zc) ** 2 > b * b, vel: () => [0, 0] };
  const runs = [32, 48].map(N => { const r = steady3(N, D, D, [sphere, shell]); return { h: r.G.h, e: r.F[1].Fx / ex - 1 }; });
  const e0 = runs[1].e - runs[1].h * (runs[0].e - runs[1].e) / (runs[0].h - runs[1].h);
  check('3D: a sphere moving through a still spherical container: its drag against the exact (Haberman and Sayre), extrapolated', Math.abs(runs[1].e) < Math.abs(runs[0].e) && Math.abs(e0) < 0.04,
    `a/b = ${k}; cells ${runs.map(q => (q.h * 1000).toFixed(1)).join(', ')} mm: ${runs.map(q => pc(q.e)).join(', ')}; extrapolated ${pc(e0)}`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
