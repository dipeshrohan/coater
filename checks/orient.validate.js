/*
 * orient.validate.js — checks of the flake orientation engine (orient.js). Run: node orient.validate.js
 *  1. Jeffery: a flake's orbit period in simple shear, 2π (r + 1/r) / γ̇ (exact); planar extension turns every
 *     normal as the exact map e^{βDt} p (no diffusion), the flakes flat in the film's plane in the end.
 *  2. Rotary diffusion alone: ⟨P2⟩ relaxes as e^{−6 D_r t} (exact), within the ensemble's scatter.
 *  3. Folgar–Tucker: in steady planar extension the exact distribution ψ ∝ exp(β p·D·p / (2 D_r)); in steady simple
 *     shear an independent Fokker–Planck solution on a grid over the sphere (exponentially fitted fluxes, a direct
 *     banded solve, two grids).
 *  4. Doi–Hess at rest: below U = 5 back to random; above, the Maier–Saupe order S(U) from its self-consistency.
 *  5. The ensemble: its scatter falls as 1/√n; the SEM's traces: flat flakes at 0°, tilted ones at their tilt in a
 *     cut along the web and flat across it, random ones evenly spread (S2 ≈ 0).
 */
const O = require('../engine/orient.js');
const { bandFactor, bandSolve } = require('../engine/cfd-gap-solver.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const shear = g => { const L = new Float64Array(9); L[1] = g; return L; };   // u = γ̇ y
const P2 = c => 1.5 * c * c - 0.5;

// ---- 1. Jeffery ----
{
  const r = 0.2, M = { kind: 'ft', beta: O.orBeta(r), Ci: 0 }, rng = O.orRng(1);
  const E = O.orAligned(1, [0.3, 0.2, Math.sqrt(1 - 0.13)]), L = shear(1), dt = 1e-3;
  // the angle of the normal's projection on the flow plane: count its half turns (a period: two crossings of φ = 0 mod π)
  let t = 0, prevPh = Math.atan2(E.p[1], E.p[0]), crossings = [];
  while (crossings.length < 5 && t < 400) {
    O.orStep(E, L, dt, M, rng); t += dt;
    const ph = Math.atan2(E.p[1], E.p[0]);
    if (Math.sin(prevPh) * Math.sin(ph) < 0 && Math.abs(Math.sin(prevPh) - Math.sin(ph)) < 1) {
      const f = Math.sin(prevPh) / (Math.sin(prevPh) - Math.sin(ph)); crossings.push(t - dt + f * dt);
    }
    prevPh = ph;
  }
  const T = crossings[4] - crossings[2], exact = 2 * Math.PI * (r + 1 / r);
  check('Jeffery: a flake (thickness / width 0.2) turns once in 2π (r + 1/r) / γ̇ in simple shear', Math.abs(T / exact - 1) < 1e-4, `${T.toFixed(5)} vs ${exact.toFixed(5)} (${((T / exact - 1) * 100).toExponential(1)} %)`);
  // planar extension: x stretched, y squeezed
  const Lx = new Float64Array(9); Lx[0] = 1; Lx[4] = -1;
  const b = O.orBeta(1e-3), E2 = O.orEnsemble(2000, O.orRng(3)), p0 = Float64Array.from(E2.p);
  const tt = 3, M2 = { kind: 'ft', beta: b, Ci: 0 };
  // (the error of the drift's scheme at two step sizes: second order, so halving the step quarters it)
  const errAt = strain => {
    const Ek = O.orCopy({ n: E2.n, p: p0 });
    O.orRun(Ek, Lx, tt, M2, O.orRng(4), { strain });
    let w = 0;
    for (let k = 0; k < Ek.n; k++) {
      const ex = [Math.exp(b * tt) * p0[3 * k], Math.exp(-b * tt) * p0[3 * k + 1], p0[3 * k + 2]], s = Math.hypot(...ex);
      w = Math.max(w, Math.abs(ex[0] / s - Ek.p[3 * k]), Math.abs(ex[1] / s - Ek.p[3 * k + 1]), Math.abs(ex[2] / s - Ek.p[3 * k + 2]));
    }
    return { w, E: Ek };
  };
  const e1 = errAt(0.02), e2 = errAt(0.01), worst = e2.w, order = Math.log2(e1.w / e2.w);
  O.orRun(E2, Lx, tt, M2, O.orRng(4), { strain: 0.01 });
  const st = O.orStats(E2);
  check('  planar extension (no diffusion): every normal as the exact map e^{βDt} p, the error falling as the step squared', worst < 1e-4 && order > 1.8 && order < 2.2, `worst ${worst.toExponential(1)} (strain steps 0.01), ${e1.w.toExponential(1)} (0.02): order ${order.toFixed(2)}`);
  O.orRun(E2, Lx, 7, M2, O.orRng(4));
  check('  and the flakes end flat in the film\'s plane (the normals along the squeezed direction: S_y → 1)', O.orStats(E2).Sy > 0.99, `S_y ${st.Sy.toFixed(3)} at strain 3, ${O.orStats(E2).Sy.toFixed(5)} at strain 10`);
}

// ---- 2. rotary diffusion alone ----
{
  const n = 40000, M = { kind: 'ft', beta: -1, Ci: 0, Dr0: 0.5 }, E = O.orAligned(n, [0, 0, 1]), rng = O.orRng(11), L = new Float64Array(9);
  let worst = 0, info = [];
  let t = 0;
  for (const tt of [0.05, 0.15, 0.3, 0.6]) {
    O.orRun(E, L, tt - t, M, rng, { cap: 1e-3 }); t = tt;
    let s = 0; for (let k = 0; k < n; k++) s += P2(E.p[3 * k + 2]); s /= n;
    const ex = Math.exp(-6 * 0.5 * tt), sig = 0.45 / Math.sqrt(n);
    worst = Math.max(worst, Math.abs(s - ex) / sig); info.push(`${s.toFixed(4)} (${ex.toFixed(4)})`);
  }
  check('rotary diffusion alone: ⟨P2⟩ = e^{−6 D_r t}, within 3 standard errors of the ensemble', worst < 3, info.join(', '));
}

// ---- 3. Folgar–Tucker ----
{
  // steady planar extension: exact ψ ∝ exp(β p·D·p / (2 D_r)), D_r = C_i γ̇
  const Lx = new Float64Array(9); Lx[0] = 1; Lx[4] = -1;
  const M = { kind: 'ft', beta: O.orBeta(0.1), Ci: 0.1 }, Dr = O.orDr(Lx, M);
  // (steady, then the moments averaged over 4 snapshots: the scatter of one would hide the scheme's step bias)
  const steadyAvg = cap => { const E = O.orEnsemble(30000, O.orRng(5)), rng = O.orRng(6), A = new Float64Array(9); O.orRun(E, Lx, 20, M, rng, { cap }); for (let k = 0; k < 4; k++) { O.orRun(E, Lx, 5, M, rng, { cap }); O.orA(E).forEach((v, i) => { A[i] += v / 4; }); } return A; };
  const Ad = steadyAvg(Infinity), Ah = steadyAvg(0.0125);
  // the exact second moments by quadrature over the sphere
  const nt = 400, np = 800;
  let Z = 0, Axx = 0, Ayy = 0;
  for (let i = 0; i < nt; i++) for (let j = 0; j < np; j++) {
    const th = (i + 0.5) * Math.PI / nt, ph = (j + 0.5) * 2 * Math.PI / np, x = Math.sin(th) * Math.cos(ph), y = Math.sin(th) * Math.sin(ph);
    const w = Math.sin(th) * Math.exp(M.beta * (x * x - y * y) / (2 * Dr)); Z += w; Axx += w * x * x; Ayy += w * y * y;
  }
  const ok = A => Math.abs(A[0] - Axx / Z) < 0.005 && Math.abs(A[4] - Ayy / Z) < 0.005;
  check('Folgar–Tucker, steady planar extension: the exact distribution ψ ∝ exp(β p·D·p / 2D_r), at the default step and half of it', ok(Ad) && ok(Ah),
    `⟨x²⟩ ${Ad[0].toFixed(4)}, ${Ah[0].toFixed(4)} (${(Axx / Z).toFixed(4)}); ⟨y²⟩ ${Ad[4].toFixed(4)}, ${Ah[4].toFixed(4)} (${(Ayy / Z).toFixed(4)}): the step's first-order bias ${(Ayy / Z - Ad[4]).toFixed(4)} → ${(Ayy / Z - Ah[4]).toFixed(4)}`);
}
/**
 * The steady Fokker–Planck equation on the sphere, 0 = −∇·(ψ ṗ − D_r ∇ψ), finite volumes on nt × np cells in
 * (θ, φ) about the z axis (the vorticity's: the flakes' normals gather at the equator, away from the poles), each
 * face's flux exponentially fitted (exact for the face's own advection–diffusion, never oscillating), solved
 * directly (banded), one cell held at 1, then normalised. Returns ⟨pp⟩.
 */
function fpSteady(L, M, nt, np) {
  const n = nt * np, kl = np, ku = np, Wd = 2 * kl + ku + 1, A = new Float64Array(n * Wd);
  const dth = Math.PI / nt, dph = 2 * Math.PI / np, Dr = O.orDr(L, M), b = M.beta;
  const Dm = new Float64Array(9), Wm = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { Dm[3 * i + j] = 0.5 * (L[3 * i + j] + L[3 * j + i]); Wm[3 * i + j] = 0.5 * (L[3 * i + j] - L[3 * j + i]); }
  const pdot = (th, ph) => {
    const p = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    const Dp = [0, 1, 2].map(i => Dm[3 * i] * p[0] + Dm[3 * i + 1] * p[1] + Dm[3 * i + 2] * p[2]), pDp = p[0] * Dp[0] + p[1] * Dp[1] + p[2] * Dp[2];
    const v = [0, 1, 2].map(i => Wm[3 * i] * p[0] + Wm[3 * i + 1] * p[1] + Wm[3 * i + 2] * p[2] + b * (Dp[i] - pDp * p[i]));
    const et = [Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), -Math.sin(th)], ep = [-Math.sin(ph), Math.cos(ph), 0];
    return [v[0] * et[0] + v[1] * et[1] + v[2] * et[2], v[0] * ep[0] + v[1] * ep[1]];
  };
  const B = x => Math.abs(x) < 1e-8 ? 1 - x / 2 : x / Math.expm1(x);   // (the Bernoulli function)
  const add = (r, c, v) => { A[r * Wd + c - r + kl] += v; };
  const id = (i, j) => i * np + ((j % np) + np) % np;
  // a face between cells a and b (b ahead along the face's normal): the flux a -> b is (D / h) [B(−Pe) ψa − B(Pe) ψb] × length
  const face = (a, bIdx, vel, h, len) => {
    const Pe = vel * h / Dr, ca = Dr / h * B(-Pe) * len, cb = Dr / h * B(Pe) * len;
    add(a, a, ca); add(a, bIdx, -cb); add(bIdx, a, -ca); add(bIdx, bIdx, cb);
  };
  for (let i = 0; i < nt; i++) for (let j = 0; j < np; j++) {
    const th = (i + 0.5) * dth, ph = (j + 0.5) * dph;
    if (i < nt - 1) { const thf = (i + 1) * dth; face(id(i, j), id(i + 1, j), pdot(thf, ph)[0], dth, Math.sin(thf) * dph); }
    const phf = (j + 1) * dph; face(id(i, j), id(i, j + 1), pdot(th, phf)[1], Math.sin(th) * dph, dth);
  }
  // (one cell held at 1: the system is otherwise singular, by a constant)
  const fix = id(nt >> 1, 0), rhs = new Float64Array(n);
  for (let c = Math.max(0, fix - kl); c <= Math.min(n - 1, fix + ku); c++) A[fix * Wd + c - fix + kl] = 0;
  add(fix, fix, 1); rhs[fix] = 1;
  const fac = bandFactor(A, n, kl, ku); bandSolve(A, fac, n, kl, ku, rhs);
  const M2 = new Float64Array(9); let Z = 0;
  for (let i = 0; i < nt; i++) for (let j = 0; j < np; j++) {
    const th = (i + 0.5) * dth, ph = (j + 0.5) * dph, w = rhs[id(i, j)] * (Math.cos(i * dth) - Math.cos((i + 1) * dth)) * dph;
    const p = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
    Z += w; for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) M2[3 * a + c] += w * p[a] * p[c];
  }
  return M2.map(v => v / Z);
}
{
  for (const [r, Ci] of [[0.1, 0.05], [1e-3, 0.02]]) {
    const M = { kind: 'ft', beta: O.orBeta(r), Ci }, L = shear(1);
    const t0 = Date.now(), f1 = fpSteady(L, M, 60, 120), f2 = fpSteady(L, M, 90, 180), tf = Date.now() - t0;
    const fine = f2;   // (the finer grid as the reference; its change from the coarser said)
    const ss = O.orSteady(L, M, { n: 30000, seed: 9, tol: 2e-3 }), A = O.orA(ss.E);
    const dA = Math.max(Math.abs(A[0] - fine[0]), Math.abs(A[4] - fine[4]), Math.abs(A[1] - fine[1]));
    check(`Folgar–Tucker, steady simple shear (thickness / width ${r}, C_i ${Ci}): the ensemble = the Fokker–Planck solution on the sphere, within 0.006`, ss.converged && dA < 0.006,
      `⟨xx⟩ ${A[0].toFixed(4)} (${fine[0].toFixed(4)}), ⟨yy⟩ ${A[4].toFixed(4)} (${fine[4].toFixed(4)}), ⟨xy⟩ ${A[1].toFixed(4)} (${fine[1].toFixed(4)}); the grid 60×120 → 90×180 moves ⟨yy⟩ by ${Math.abs(f1[4] - f2[4]).toExponential(1)}; ${tf} ms`);
  }
}

// ---- 4. Doi–Hess at rest ----
/** The Maier–Saupe order at U: S = ⟨P2⟩ with ψ ∝ exp((3/2) U S cos²θ), the nematic branch (from S = 0.9) and the isotropic one. */
function maierSaupe(U) {
  const F = S => { let z = 0, m = 0; const N = 4000; for (let k = 0; k < N; k++) { const c = (k + 0.5) / N, w = Math.exp(1.5 * U * S * c * c); z += w; m += w * P2(c); } return m / z; };
  let S = 0.9; for (let k = 0; k < 2000; k++) { const S2 = F(S); if (Math.abs(S2 - S) < 1e-12) break; S = S2; }
  return S;
}
{
  const L = new Float64Array(9), n = 20000;
  const lo = { kind: 'dh', beta: -1, Dr: 1, U: 3 }, E = O.orAligned(n, [0, 1, 0]);
  O.orRun(E, L, 3, lo, O.orRng(21));
  const s3 = O.orStats(E).S;
  check('Doi–Hess at rest, U = 3 (below 5): from lined up back to random (S → 0, the ensemble\'s floor)', s3 < 0.03, `S ${s3.toFixed(4)} (random ensemble of ${n}: about ${(1.2 / Math.sqrt(n)).toFixed(3)})`);
  for (const U of [6, 10]) {
    const M = { kind: 'dh', beta: -1, Dr: 1, U }, E2 = O.orAligned(n, [0, 1, 0]);
    O.orRun(E2, L, 8, M, O.orRng(22));   // (near the transition the order settles slowly: 8 diffusion times)
    const s = O.orStats(E2).S, ex = maierSaupe(U);
    check(`  U = ${U}: the Maier–Saupe order S(U) from its self-consistency, within 0.01`, Math.abs(s - ex) < 0.01, `S ${s.toFixed(4)} vs ${ex.toFixed(4)}`);
  }
}

// ---- 5. the ensemble; the traces ----
{
  const M = { kind: 'ft', beta: O.orBeta(1e-3), Ci: 0.02 }, L = shear(1);
  const Ss = [];
  for (const seed of [31, 32, 33, 34, 35, 36]) Ss.push(O.orStats(O.orSteady(L, M, { n: 2000, seed, tol: 3e-3 }).E).Sy);
  const mean = Ss.reduce((a, b) => a + b, 0) / Ss.length, sd = Math.sqrt(Ss.reduce((a, b) => a + (b - mean) ** 2, 0) / (Ss.length - 1));
  const big = O.orStats(O.orSteady(L, M, { n: 32000, seed: 40, tol: 2e-3 }).E).Sy;
  check('the ensemble: 6 seeds of 2000 scatter by about 0.01 in S_y; 32000 agree with their mean within 3 of their errors', sd < 0.02 && Math.abs(big - mean) < 3 * sd / Math.sqrt(6) + 0.004, `S_y ${mean.toFixed(4)} ± ${sd.toFixed(4)} (2000), ${big.toFixed(4)} (32000)`);
  const flat = O.orAligned(10, [0, 1, 0]), tilt = O.orAligned(10, [-Math.sin(0.3), Math.cos(0.3), 0]);
  const md = O.orTraces(tilt, 'md').angles[0], cd = O.orTraces(tilt, 'cd').angles[0], f0 = O.orTraces(flat, 'md').angles[0];
  check('the SEM\'s traces: a flat flake at 0°; tilted 17.2° about the cross direction: 17.2° along the web, 0° across it', Math.abs(f0) < 1e-12 && Math.abs(md - 0.3 * 180 / Math.PI) < 1e-9 && Math.abs(cd) < 1e-9, `${f0.toFixed(3)}°, ${md.toFixed(3)}°, ${cd.toFixed(3)}°`);
  const iso = O.orEnsemble(40000, O.orRng(50)), tm = O.orTraces(iso, 'md'), tc = O.orTraces(iso, 'cd'), sm = O.orCutStats(tm.angles, tm.weights), sc = O.orCutStats(tc.angles, tc.weights);
  check('  random flakes: their traces evenly spread in either cut (S2 = ⟨cos 2θ⟩ ≈ 0, spread ≈ 52°)', Math.abs(sm.S2) < 0.02 && Math.abs(sc.S2) < 0.02 && Math.abs(sm.spread - 180 / Math.sqrt(12)) < 1.5, `S2 ${sm.S2.toFixed(4)}, ${sc.S2.toFixed(4)}; spread ${sm.spread.toFixed(1)}°`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
