/*
 * cfd-fem-time.validate.js — checks the 2D flow in time (cfd-fem-time.js on
 * solveFEM's time step) against exact solutions.
 * Run: node cfd-fem-time.validate.js   (prints PASS/FAIL per check, "ALL PASS" at the end)
 *
 *  1. Stokes' first problem (a channel whose floor starts moving): the
 *     velocity against the exact series, second order in the time step;
 *     the step control meets its tolerance.
 *  2. The same on a mesh whose nodes slide up and down the spines while it
 *     runs (the arbitrary Lagrangian-Eulerian terms): the same answer.
 *  3. Womersley flow (a pressure difference oscillating along a channel):
 *     amplitude and phase of the velocity and of the flow rate against the
 *     exact solution.
 *  4. A capillary wave on a film on a wall (Stokes flow, surface tension):
 *     its decay rate against the exact linear rate (the film's stream
 *     function, wall to free surface); the liquid's area kept.
 *  5. A coating flow with the meniscus, the bead pressure stepped up: the
 *     march settles on the steady solve at the new pressure (film, contact
 *     line) on the mesh it ends on (it lays one out again on the way), and
 *     the liquid's area changes by what flows in minus what flows out.
 *  6. Gibbs in time: the pressure drops, the contact line comes down the
 *     face and pins at the edge (the steady solve's pinned film); the
 *     pressure comes back, it unpins and climbs to where it was.
 *  7. Navier slip: Couette-Poiseuille with slip on the top wall, exact; on
 *     the exit face of the coating flow it tends to no slip as the slip
 *     length goes to 0; in a time step the contact line moves with the
 *     liquid at it; the march with slip settles on the steady solve with it.
 *  8. The structure (thixotropy) in time (cfd-struct.js's structMarch): lambda as the slurry's memory along its path
 *     traced (filter off) -- a front coming in through the inlet of a plug flow and lambda relaxing in a uniform
 *     shear, exact at any step; a shear rate oscillating in time against the law's ODE; along a steady coating flow
 *     with a long-memory structure the march finds the steady structure solve's lambda and, marched with nothing
 *     changed, stays put; a fast-rebuilding structure the same, and after a bead-pressure step settles on the steady
 *     structure solve.
 */
const gap = require('./cfd-gap-solver.js');
global.bandFactor = gap.bandFactor;
global.bandSolve = gap.bandSolve;
const { solveFEM, solveCoaterFEM } = require('./cfd-fem.js');
const { femMarch, femArea } = require('./cfd-fem-time.js');

let allPass = true;
const check = (ok, text) => { console.log((ok ? 'PASS ' : 'FAIL ') + text); if (!ok) allPass = false; };
const section = t => console.log('\n' + t);

// complex numbers [re, im]
const cx = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
  cosh: a => [Math.cosh(a[0]) * Math.cos(a[1]), Math.sinh(a[0]) * Math.sin(a[1])],
  sinh: a => [Math.sinh(a[0]) * Math.cos(a[1]), Math.cosh(a[0]) * Math.sin(a[1])],
  abs: a => Math.hypot(a[0], a[1]), arg: a => Math.atan2(a[1], a[0]),
};

// ---------------------------------------------------------------------
// a channel of depth H and length L, nEx x nEy elements; eta: the nodes' places up the spines (may move in time)
const channel = (H, L, nEx, nEy, eta) => ({ nEx, nEy, spineFoot: c => c / (2 * nEx) * L, spineTop: c => [c / (2 * nEx) * L, H], ...(eta ? { eta } : {}) });
// a result at time t with the given nodal velocity (u(x, y)), on the mesh as it is at t (no solve)
const stateAt = (call, t, uf) => {
  const mesh = call.mesh.eta ? { ...call.mesh, eta: k => call.mesh.eta(k, { t }) } : call.mesh;
  const m = solveFEM({ ...call, mesh, maxIter: 0 });
  const u = m.x.map((x, n) => uf(x, m.y[n])), z = new Float64Array(u.length);
  return solveFEM({ ...call, mesh, maxIter: 0, initNodal: { u, v: z, p: z } });
};

section('1. Stokes\' first problem: the floor starts moving (exact series)');
const stokes = (() => {
  const H = 0.01, L = 0.01, U = 0.01, rho = 1000, mu = 1, nu = mu / rho, T = H * H / nu;
  const exact = (y, t) => { let u = U * (1 - y / H); for (let n = 1; n < 300; n++) u -= 2 * U / (n * Math.PI) * Math.sin(n * Math.PI * y / H) * Math.exp(-n * n * Math.PI * Math.PI * nu * t / (H * H)); return u; };
  const t0 = 0.05 * T, t1 = 0.5 * T;
  const run = (N, eta, adaptive) => {
    const call = { mesh: channel(H, L, 2, 16, eta), U, rho, mu: () => mu, Hr: H, Ur: U, inlet: { type: 'traction', p: () => 0 }, outlet: { type: 'traction', p: () => 0 } };
    const dt = (t1 - t0) / N, r0 = stateAt(call, t0, (x, y) => exact(y, t0));
    const m = adaptive ? femMarch(r0, { call, t0, tEnd: t1, dt0: 1e-3 * (t1 - t0), tol: adaptive })
      : femMarch(r0, { call, t0, tEnd: t1, dt0: dt, fixed: true, earlier: { r: stateAt(call, t0 - dt, (x, y) => exact(y, t0 - dt)), dt } });
    let e = 0, pm = 0;
    const r = m.last;
    for (let n = 0; n < r.x.length; n++) { e = Math.max(e, Math.abs(r.u[n] - exact(r.y[n], t1)) / U); pm = Math.max(pm, Math.abs(r.p[n])); }
    return { e, pm, m };
  };
  return { run, T };
})();
{
  const runs = [10, 20, 40].map(N => stokes.run(N));
  const o1 = Math.log2(runs[0].e / runs[1].e), o2 = Math.log2(runs[1].e / runs[2].e);
  check(runs.every(q => q.m.completed) && runs[2].e < 2e-4, `10, 20, 40 steps: velocity within ${runs.map(q => (q.e * 100).toFixed(4) + '%').join(', ')} of the series (of the floor's speed)`);
  check(o1 > 1.8 && o2 > 1.8, `second order in the step: ${o1.toFixed(2)}, ${o2.toFixed(2)} (2 expected)`);
  check(runs.every(q => q.pm < 1e-9), `pressure stays zero (largest ${Math.max(...runs.map(q => q.pm)).toExponential(1)} Pa)`);
  const a = stokes.run(0, null, 1e-4), b = stokes.run(0, null, 1e-5);
  check(a.m.completed && b.m.completed && a.e < 1e-3 && b.e < a.e / 3,
    `step control from an impulsive-looking start: tolerance 1e-4 -> ${a.m.steps} steps, error ${(a.e * 100).toFixed(4)}%; 1e-5 -> ${b.m.steps} steps, ${(b.e * 100).toFixed(4)}%`);
}

section('2. The same on a moving mesh (nodes sliding up and down the spines)');
{
  const T = stokes.T, nEy = 16;
  const eta = (k, st) => { const e = k / (2 * nEy); return e + 0.15 * Math.sin(Math.PI * e) * Math.sin(2 * Math.PI * ((st && st.t) || 0) / (0.2 * T)); };
  const fixed = [20, 40].map(N => stokes.run(N)), moving = [20, 40].map(N => stokes.run(N, eta));
  const o = Math.log2(moving[0].e / moving[1].e);
  check(moving.every(q => q.m.completed) && moving[1].e < 2 * fixed[1].e && o > 1.8,
    `nodes moving by up to 15% of the depth, 2.5 cycles: error ${moving.map(q => (q.e * 100).toFixed(4) + '%').join(', ')} (fixed mesh ${fixed.map(q => (q.e * 100).toFixed(4) + '%').join(', ')}), order ${o.toFixed(2)}`);
}

section('3. Womersley flow (oscillating pressure difference, exact)');
{
  const H = 0.01, L = 0.01, rho = 1000, mu = 1, nu = mu / rho, alpha = 3, om = Math.pow(2 * alpha / H, 2) * nu, P = 2 * Math.PI / om;
  const G = 0.01 * om * rho, P0 = G * L;                                      // amplitude about 1 cm/s
  const call = { mesh: channel(H, L, 2, 12), U: 0, rho, mu: () => mu, Hr: H, Ur: 0.01,
    inlet: { type: 'traction', p: () => 0 }, outlet: { type: 'traction', p: () => 0 } };
  const at = t => ({ inlet: { type: 'traction', p: () => P0 * Math.cos(om * t) } });
  const r0 = stateAt(call, 0, () => 0), cycles = 7;
  // exact: u = Re(U^ e^{i om t}), U^ = G/(i om rho) (1 - cosh(k(y - H/2)) / cosh(k H/2)), k = sqrt(i om / nu)
  const kk = Math.sqrt(om / (2 * nu)), k = [kk, kk], A = cx.div([G, 0], [0, om * rho]);
  const uHat = y => cx.mul(A, cx.sub([1, 0], cx.div(cx.cosh(cx.mul(k, [y - H / 2, 0])), cx.cosh(cx.mul(k, [H / 2, 0])))));
  const QHat = cx.mul(A, cx.sub([H, 0], cx.mul(cx.div([2, 0], k), cx.div(cx.sinh(cx.mul(k, [H / 2, 0])), cx.cosh(cx.mul(k, [H / 2, 0]))))));
  // nPer steps a cycle from rest; the last cycle's Fourier coefficient of each node's velocity (u ~ Re(U^ e^{i om t}))
  const run = nPer => {
  const times = Array.from({ length: cycles * nPer }, (_, i) => (i + 1) * P / nPer);
  const m = femMarch(r0, { call, at, tEnd: cycles * P, dt0: P / nPer, fixed: true, times, keep: r => ({ u: Float64Array.from(r.u), Q: r.Q }) });
  const last = m.frames.slice(-nPer), NR = r0.NR, c = 2;
  let eAmp = 0, ePh = 0, uMax = 0;
  for (let kq = 0; kq < NR; kq++) {
    const n = c * NR + kq, y = r0.y[n];
    let re = 0, im = 0;
    for (const f of last) { re += 2 / nPer * f.r.u[n] * Math.cos(om * f.t); im -= 2 / nPer * f.r.u[n] * Math.sin(om * f.t); }
    const ex = uHat(y);
    uMax = Math.max(uMax, cx.abs(ex));
    if (cx.abs(ex) > 0) { eAmp = Math.max(eAmp, Math.abs(Math.hypot(re, im) - cx.abs(ex))); if (cx.abs(ex) > 0.2 * cx.abs(uHat(H / 2))) ePh = Math.max(ePh, Math.abs(Math.atan2(im, re) - cx.arg(ex))); }
  }
  let qr = 0, qi = 0;
  for (const f of last) { qr += 2 / nPer * f.r.Q * Math.cos(om * f.t); qi -= 2 / nPer * f.r.Q * Math.sin(om * f.t); }
  return { ok: m.completed, eAmp: eAmp / uMax, ePh: ePh * 180 / Math.PI, eQ: Math.abs(Math.hypot(qr, qi) / cx.abs(QHat) - 1), phQ: Math.abs(Math.atan2(qi, qr) - cx.arg(QHat)) * 180 / Math.PI };
  };
  const a = run(40), b = run(80);
  check(a.ok && b.ok && b.eAmp < 3e-3 && a.eAmp / b.eAmp > 3.5,
    `Womersley number ${alpha}: velocity amplitude within ${(a.eAmp * 100).toFixed(3)}% (40 steps a cycle), ${(b.eAmp * 100).toFixed(3)}% (80) of the exact, of its largest; second order (x${(a.eAmp / b.eAmp).toFixed(2)})`);
  check(b.ePh < 0.1, `velocity phase within ${b.ePh.toFixed(3)}° (80 steps; the centre lags the pressure by ${(-cx.arg(uHat(H / 2)) * 180 / Math.PI).toFixed(2)}°)`);
  check(b.eQ < 3e-3 && b.phQ < 0.1, `flow rate: amplitude within ${(b.eQ * 100).toFixed(3)}%, phase within ${b.phQ.toFixed(3)}° of the exact (80 steps)`);
}

section('4. Capillary wave on a film on a wall (Stokes flow, exact linear decay)');
{
  const h0 = 1e-3, lam = 1e-2, kw = 2 * Math.PI / lam, gamma = 0.03, mu = 1, eps = 0.01 * h0;
  // exact: stream function f(y) sin kx, f = (A + B y) cosh ky + (C + D y) sinh ky; wall f = f' = 0; at the surface
  // no shear (f'' + k^2 f = 0) and the normal stress (f''' - 3 k^2 f' = -gamma k^3 eps / mu); decay rate k f(h) / eps
  const basis = y => { const C = Math.cosh(kw * y), S = Math.sinh(kw * y), k = kw;
    return [[C, k * S, k * k * C, k ** 3 * S], [y * C, C + y * k * S, 2 * k * S + y * k * k * C, 3 * k * k * C + y * k ** 3 * S],
      [S, k * C, k * k * S, k ** 3 * C], [y * S, S + y * k * C, 2 * k * C + y * k * k * S, 3 * k * k * S + y * k ** 3 * C]]; };
  const b0 = basis(0), bh = basis(h0);
  const M = [b0.map(b => b[0]), b0.map(b => b[1]), bh.map(b => b[2] + kw * kw * b[0]), bh.map(b => b[3] - 3 * kw * kw * b[1])], rhs = [0, 0, 0, -gamma * kw ** 3 * eps / mu];
  for (let i = 0; i < 4; i++) { let p = i; for (let r = i + 1; r < 4; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; [rhs[i], rhs[p]] = [rhs[p], rhs[i]];
    for (let r = i + 1; r < 4; r++) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; rhs[r] -= f * rhs[i]; } }
  const co = new Array(4);
  for (let i = 3; i >= 0; i--) { let s = rhs[i]; for (let c = i + 1; c < 4; c++) s -= M[i][c] * co[c]; co[i] = s / M[i][i]; }
  const sigma = kw * bh.reduce((s, b, i) => s + co[i] * b[0], 0) / eps, sigLub = gamma * h0 ** 3 * kw ** 4 / (3 * mu);

  const nEx = 10, NC = 2 * nEx + 1, xc = c => c / (NC - 1) * lam / 2;
  const call = { mesh: { nEx, nEy: 4, spineFoot: xc, spineTop: (c, st) => [xc(c), st.h[c]], kind: () => 'free' },
    U: 0, rho: 0, g: 0, gamma, mu: () => mu, Hr: h0, Ur: sigma * eps, inlet: { type: 'symmetry' }, outlet: { type: 'symmetry' } };
  const r0 = solveFEM({ ...call, freeze: true, h0: c => h0 + eps * Math.cos(kw * xc(c)) });
  const tEnd = 2 / sigma;
  // the decay rate from the second half of a march (fit of ln amplitude), the amplitude at the end, the largest change of area
  const decay = m => {
    const amp = m.h.map(h => (h[0] - h[NC - 1]) / 2);
    let sx = 0, sy = 0, sxx = 0, sxy = 0, nn = 0;
    m.t.forEach((t, i) => { if (t < 0.5 * tEnd) return; const y = Math.log(amp[i]); sx += t; sy += y; sxx += t * t; sxy += t * y; nn++; });
    return { sig: -(nn * sxy - sx * sy) / (nn * sxx - sx * sx), end: amp[amp.length - 1] / eps, dA: Math.max(...m.area.map(a => Math.abs(a / m.area[0] - 1))) };
  };
  const m = femMarch(r0, { call, tEnd, dt0: 1e-3 / sigma, tol: 1e-5, hScale: eps, uScale: sigma * eps }), d = decay(m);
  check(r0.converged && m.completed && Math.abs(d.sig / sigma - 1) < 1e-3,
    `k h = ${(kw * h0).toFixed(3)}: decay rate ${d.sig.toFixed(5)} 1/s vs exact ${sigma.toFixed(5)} 1/s (${((d.sig / sigma - 1) * 100).toFixed(3)}%; thin-film limit ${sigLub.toFixed(4)}), step control at 1e-5 of the amplitude: ${m.steps} steps (${m.rejected} redone)`);
  check(d.dA < 1e-9, `liquid area kept to ${d.dA.toExponential(1)} over ${(tEnd * sigma).toFixed(0)} decay times`);
  check(Math.abs(d.end - Math.exp(-sigma * tEnd)) < 2e-3 * Math.exp(-sigma * tEnd), `amplitude after ${tEnd.toFixed(3)} s: ${d.end.toFixed(5)} of the start vs exact ${Math.exp(-sigma * tEnd).toFixed(5)}`);
  const f = [50, 100].map(N => decay(femMarch(r0, { call, tEnd, dt0: tEnd / N, fixed: true })));
  const e = f.map(q => Math.abs(q.sig / sigma - 1)), o = Math.log2(e[0] / e[1]);
  check(o > 1.6, `50, 100 even steps: decay rate within ${e.map(x => (x * 100).toFixed(4) + '%').join(', ')} (order ${o.toFixed(2)}; the first step is backward Euler)`);
}

section('5. Coating flow with the meniscus, bead pressure stepped up: settles on the steady solve');
const coat = (() => {
  const rho = 1020, g = 9.81, gamma = 0.07, H = 1.7e-3, xe = 5e-3, U = 0.1;
  const base = { hFn: () => H, xe, faceDeg: 90, contactDeg: 35, U, rho, g, gamma, mu: () => 1, Ld: 12e-3, nEb: 10, nEf: 6, nEs: 24, nEy: 6, fInfGuess: 0.5 * H };
  const inlet = P => ({ type: 'traction', p: y => P - rho * g * y });
  return { H, U, base, inlet, start: P => solveCoaterFEM({ ...base, Pup: P }) };
})();
{
  const { H, U, base, inlet } = coat, P1 = 150, r0 = coat.start(0), r2 = solveCoaterFEM({ ...base, Pup: P1 });
  const tEnd = 1;
  const m = femMarch(r0, { at: () => ({ inlet: inlet(P1) }), tEnd, dt0: 1e-4, tol: 1e-3 });
  // the steady solve at the new pressure on the mesh the march ended on
  const last = m.last, r1 = solveFEM({ ...m.call, init: last.state, inlet: inlet(P1) });
  const dQ = Math.abs(last.Q / r1.Q - 1), dS = Math.abs(last.surface.s - r1.surface.s);
  check(r0.converged && r1.converged && m.completed && dQ < 1e-6 && dS < 1e-5 * H,
    `film ${(r0.Q / U * 1e6).toFixed(2)} -> ${(last.Q / U * 1e6).toFixed(3)} µm after ${tEnd} s vs the steady solve ${(r1.Q / U * 1e6).toFixed(3)} µm on the same mesh (${(dQ * 100).toFixed(5)}%); contact line ${(last.surface.s * 1e3).toFixed(5)} vs ${(r1.surface.s * 1e3).toFixed(5)} mm up the face; ${m.steps} steps (${m.rejected} redone), ${m.remeshes.length} new mesh (${m.remeshes.map(q => q.why).join('; ')})`);
  const dQ2 = Math.abs(last.Q / r2.Q - 1), dS2 = Math.abs(last.surface.s - r2.surface.s);
  check(r2.converged && dQ2 < 5e-4 && dS2 < 0.02 * H,
    `and the coating solve at ${P1} Pa on its own mesh: film ${(r2.Q / U * 1e6).toFixed(3)} µm (${(dQ2 * 100).toFixed(4)}%), contact line ${(r2.surface.s * 1e3).toFixed(4)} mm (within ${(dS2 / H * 100).toFixed(2)}% of the gap; mesh limits as in cfd-fem.validate.js 5)`);
  // d(area)/dt (BDF2 over the accepted steps, on one mesh) = Qin - Qout
  let worst = 0;
  const cut = m.remeshes.map(q => q.t);
  for (let i = 2; i < m.t.length; i++) {
    if (cut.some(tc => tc >= m.t[i - 2] && tc < m.t[i])) continue;
    const dt = m.t[i] - m.t[i - 1], dt1 = m.t[i - 1] - m.t[i - 2], w = dt / dt1;
    const dA = ((1 + 2 * w) / (1 + w) * m.area[i] - (1 + w) * m.area[i - 1] + w * w / (1 + w) * m.area[i - 2]) / dt;
    worst = Math.max(worst, Math.abs(dA - (m.Qin[i] - m.Qout[i])) / Math.abs(m.Qin[i]));
  }
  check(worst < 2e-3, `the liquid's area changes by what flows in minus out, every step, within ${(worst * 100).toFixed(4)}% of the inflow`);
}

section('6. Gibbs in time: the contact line pins at the edge and climbs off it again');
{
  const { H, U, base, inlet } = coat;
  // the bead pressure drops: the contact line comes down the face and pins at the edge
  const a0 = coat.start(0), aS = solveCoaterFEM({ ...base, Pup: -400 });
  const a = femMarch(a0, { at: () => ({ inlet: inlet(-400) }), tEnd: 0.5, dt0: 1e-4, tol: 1e-3 });
  const pinT = (a.remeshes.find(q => q.mode === 'pinned') || {}).t;
  check(a.completed && a.mode[a.mode.length - 1] === 'pinned' && aS.meniscus.mode === 'pinned' && Math.abs(a.last.Q / aS.Q - 1) < 1e-4,
    `-400 Pa: climbed ${(a0.surface.s * 1e3).toFixed(4)} mm up the face, pinned at the edge at ${pinT != null ? pinT.toFixed(4) : '-'} s; film ${(a.last.Q / U * 1e6).toFixed(3)} µm vs the steady solve's (pinned) ${(aS.Q / U * 1e6).toFixed(3)} µm`);
  // and back up: pinned, the surface turns flatter than the contact angle allows, and it climbs
  const b = femMarch(aS, { at: () => ({ inlet: inlet(0) }), tEnd: 1, dt0: 1e-4, tol: 1e-3 });
  const bS = solveFEM({ ...b.call, init: b.last.state, inlet: inlet(0) }), unpin = b.remeshes.find(q => q.mode === 'climbed');
  check(b.completed && unpin && b.mode[b.mode.length - 1] === 'climbed' && Math.abs(b.last.surface.s - bS.surface.s) < 1e-5 * H && Math.abs(b.last.surface.s - a0.surface.s) < 0.02 * H,
    `0 Pa again: unpinned at ${unpin ? unpin.t.toFixed(4) : '-'} s (${unpin ? unpin.why : ''}); settles ${(b.last.surface.s * 1e3).toFixed(4)} mm up the face = the steady solve on its mesh ${(bS.surface.s * 1e3).toFixed(4)} mm (the coating solve's own: ${(a0.surface.s * 1e3).toFixed(4)} mm)`);
}

section('7. Slip on the exit face (Navier) and the contact line moving with the liquid');
{
  // Couette-Poiseuille with Navier slip on the top wall, u(H) = -lambda u'(H): exact in the Q2 space
  const H = 1e-3, L = 5e-3, U = 0.1, mu = 2, dp = 50, NC = 13;
  let eQ = 0, eW = 0;
  for (const lr of [0.1, 0.5, 2]) {
    const lam = lr * H, r = solveFEM({ mesh: channel(H, L, 6, 4), U, rho: 0, mu: () => mu, Hr: H, Ur: U,
      inlet: { type: 'traction', p: () => dp }, outlet: { type: 'traction', p: () => 0 }, faceSlip: lam, slipSpan: [-1, NC] });
    const A = -dp / L / (2 * mu), B = -(U + A * H * (H + 2 * lam)) / (H + lam), Q = A * H ** 3 / 3 + B * H * H / 2 + U * H;
    eQ = Math.max(eQ, Math.abs(r.Q / Q - 1));
    for (let c = 0; c < NC; c++) eW = Math.max(eW, Math.abs(r.u[c * r.NR + r.NR - 1] - (A * H * H + B * H + U)) / U);
  }
  check(eQ < 1e-10 && eW < 1e-10, `Couette-Poiseuille with slip lengths 0.1, 0.5, 2 gaps on the top wall: flow rate exact to ${eQ.toExponential(1)}, slip speed to ${eW.toExponential(1)}`);
  // the coating flow: slip on the face tends to no slip as lambda -> 0
  const { U: Uc, inlet } = coat, Hc = coat.H, r0 = solveCoaterFEM({ ...coat.base, Pup: 150 });
  const sl = [1e-3, 1e-2].map(f => solveFEM({ ...r0.call, init: r0.state, faceSlip: f * Hc }));
  const dF = sl.map(q => Math.abs(q.Q / r0.Q - 1)), dS = sl.map(q => Math.abs(q.surface.s - r0.surface.s) / Hc);
  check(sl.every(q => q.converged) && dF[0] < dF[1] && dS[0] < dS[1] && dF[0] < 5e-5 && dS[0] < 2e-3,
    `coating flow, slip length 0.01 / 0.001 gap on the face: film off no slip by ${(dF[1] * 100).toFixed(4)}% / ${(dF[0] * 100).toFixed(4)}%, contact line by ${(dS[1] * 100).toFixed(3)}% / ${(dS[0] * 100).toFixed(3)}% of the gap`);
  // a time step: the contact line moves with the liquid there (its node's velocity = the line's speed up the face)
  const a0 = coat.start(0), dt = 2e-3;
  const st = solveFEM({ ...a0.call, init: a0.state, inlet: inlet(150), faceSlip: 0.03 * Hc, time: { t: dt, dt, prev: [a0] } });
  const nCL = a0.meshInfo.cCL * st.NR + st.NR - 1, vCL = (st.surface.s - a0.surface.s) / dt;
  check(st.converged && Math.abs(st.v[nCL] - vCL) < 1e-9 * Math.abs(vCL) + 1e-15 && Math.abs(st.u[nCL]) < 1e-12 && vCL > 0,
    `one step of ${dt * 1e3} ms: the contact line climbs at ${(vCL * 1e3).toFixed(4)} mm/s, the liquid at it ${(st.v[nCL] * 1e3).toFixed(4)} mm/s up the face, ${Math.abs(st.u[nCL]).toExponential(1)} across it`);
  // the march with slip on the face settles on the steady solve with the same slip
  const ms = femMarch(a0, { at: () => ({ inlet: inlet(150) }), tEnd: 1, dt0: 1e-4, tol: 1e-3, faceSlip: 0.03 * Hc });
  const ss = solveFEM({ ...ms.call, init: ms.last.state, inlet: inlet(150) });
  check(ms.completed && ss.converged && Math.abs(ms.last.Q / ss.Q - 1) < 1e-6 && Math.abs(ms.last.surface.s - ss.surface.s) < 1e-5 * Hc,
    `slip 0.03 gap: the march settles on film ${(ms.last.Q / Uc * 1e6).toFixed(3)} µm, contact line ${(ms.last.surface.s * 1e3).toFixed(5)} mm = the steady solve with that slip ${(ss.Q / Uc * 1e6).toFixed(3)} µm, ${(ss.surface.s * 1e3).toFixed(5)} mm`);
}

section('8. The structure (thixotropy) in time: lambda as the slurry\'s memory along its path');
{
  const FEM = require('./cfd-fem.js');
  Object.assign(globalThis, { femInterpolate: FEM.femInterpolate, solveCoaterFEM: FEM.solveCoaterFEM, refineCoaterFEM: FEM.refineCoaterFEM, solveFEM: FEM.solveFEM });
  const RH = require('./rheo.js'), { solveCoaterStruct, structMarch, structColumn } = require('./cfd-struct.js');
  // a given flow on a rectangle (slanted inlet by skew), nothing solved
  const flow = (NC, NR, L, Hh, uf, gdf, skew = 0, t = 0) => {
    const N = NC * NR, x = new Float64Array(N), y = new Float64Array(N), u = new Float64Array(N), v = new Float64Array(N), gd = new Float64Array(N);
    for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) { const n = c * NR + k, X = c / (NC - 1) * L, Y = k / (NR - 1) * Hh; x[n] = X + skew * Y; y[n] = Y; u[n] = uf(X, Y, t); gd[n] = gdf(X, Y, t); }
    return { NC, NR, x, y, u, v, gd };
  };
  const walk = (cm, rAt, T, dt) => { let t = 0, r = rAt(0), lam; while (t < T - 1e-12) { const r1 = rAt(t + dt); lam = cm.correct(r, t, r1, dt, null).lam; cm.accept(r1, t + dt); t += dt; r = r1; } return lam; };
  const S = { tb: 2, gdc: 1, cy: 1, ce: 1 }, lawN = RH.rheoCompile(1, 0, 1);
  // A: plug flow, a structure front (0.5) coming in at a slanted inlet into 0.2
  {
    const U = 1e-3, L = 0.02, NC = 81, NR = 5, T = 10, rr = flow(NC, NR, L, 1e-3, () => U, () => 0, 0.2);
    let worst = 0;
    for (const dt of [0.5, 0.1]) {
      const cm = structMarch(S, lawN, { lamIn: 0.5, filter: false }); cm.start({ ...rr, lam: new Float64Array(NC * NR).fill(0.2) }, 0);
      const lam = walk(cm, () => rr, T, dt);
      for (let m = 0; m < lam.length; m++) { const X = rr.x[m] - 0.2 * rr.y[m], ex = X > U * T ? 1 - 0.8 * Math.exp(-T / S.tb) : 1 - 0.5 * Math.exp(-X / (U * S.tb)); if (Math.abs(X - U * T) > 1e-6) worst = Math.max(worst, Math.abs(lam[m] - ex)); }
    }
    check(worst < 1e-12, `a front coming in through the inlet of a plug flow: lambda exact ahead of it and behind it, steps of 0.5 and 0.1 s (${worst.toExponential(1)}; nothing re-interpolated from step to step)`);
  }
  // B: a uniform shear rate switched on: lambda(t) exact
  {
    const gd0 = 3, Hh = 1e-3, L = 0.05, NC = 41, NR = 9, T = 4, rr = flow(NC, NR, L, Hh, (X, Y) => gd0 * Y, () => gd0);
    const cm = structMarch(S, lawN, { filter: false }); cm.start({ ...rr, lam: new Float64Array(NC * NR).fill(0.9) }, 0);
    const lam = walk(cm, () => rr, T, 0.1);
    const le = RH.rheoLamEq(gd0, S), ex = le + (0.9 - le) * Math.exp(-(1 + gd0 / S.gdc) * T / S.tb);
    let e = 0; for (let m = 0; m < lam.length; m++) if (rr.x[m] > gd0 * Hh * T * 1.05) e = Math.max(e, Math.abs(lam[m] - ex));
    check(e < 1e-12, `shear ${gd0} 1/s from lambda 0.9: ${ex.toFixed(6)} after ${T} s, exact to ${e.toExponential(1)}`);
  }
  // C: the shear rate oscillating in time: lambda against the law's ODE (RK4)
  {
    const Hh = 1e-3, L = 0.05, NC = 41, NR = 9, T = 3, gdt = t => 2 * (1 + Math.sin(2 * Math.PI * t / 1.3)), errs = [];
    let l = 0.9, tt = 0; const h = 1e-4, f = (q, ll) => ((1 - ll) - ll * gdt(q) / S.gdc) / S.tb;
    while (tt < T - 1e-12) { const k1 = f(tt, l), k2 = f(tt + h / 2, l + h / 2 * k1), k3 = f(tt + h / 2, l + h / 2 * k2), k4 = f(tt + h, l + h * k3); l += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4); tt += h; }
    for (const dt of [0.1, 0.025]) {
      const rAt = t => flow(NC, NR, L, Hh, (X, Y) => gdt(t) * Y, () => gdt(t), 0, t);
      const cm = structMarch(S, lawN, { filter: false }); cm.start({ ...rAt(0), lam: new Float64Array(NC * NR).fill(0.9) }, 0);
      const lam = walk(cm, rAt, T, dt);
      let e = 0; for (let m = 0; m < lam.length; m++) if (m % NR === 0 && Math.floor(m / NR) > NC / 2) e = Math.max(e, Math.abs(lam[m] - l));
      errs.push(e);
    }
    check(errs[0] < 2e-3 && errs[1] < 3e-4, `shear rate 2 (1 + sin 2 pi t / 1.3 s) 1/s: lambda ${l.toFixed(5)} after ${T} s (ODE), within ${errs[0].toExponential(1)} / ${errs[1].toExponential(1)} at steps of 0.1 / 0.025 s`);
  }
  // F: a structure with a long memory (30 s) on the coating flow of 5 at a slow web: along the steady flow the march
  // follows each path as the steady structure solve does, so it finds the steady solve's own lambda, and with nothing
  // changed the flow stays put
  {
    const { base, inlet } = coat, Uf = 0.005, Sl = { tb: 30, gdc: 1, cy: 2, ce: 2 };
    const rf = solveCoaterStruct({ ...base, U: Uf, mu: lawN.mu, Pup: 0 }, Sl, lawN);
    const cm = structMarch(Sl, lawN, { filter: false }); cm.start(rf, -1000); cm.accept(rf, 0);
    const lam = cm.correct(rf, -1e-9, rf, 1e-9, null).lam;
    let mx = 0, s2 = 0; for (let n = 0; n < lam.length; n++) { const d = Math.abs(lam[n] - rf.lam[n]); s2 += d * d; mx = Math.max(mx, d); }
    const rms = Math.sqrt(s2 / lam.length), lo = Math.min(...rf.lam), hi = Math.max(...rf.lam);
    check(rf.converged && rms < 2e-3 && mx < 0.04, `lambda ${lo.toFixed(3)} to ${hi.toFixed(3)} along the steady flow (web ${Uf * 1e3} mm/s, rebuild 30 s): traced back 1000 s through the march's kept flows = the steady structure solve's to ${rms.toExponential(1)} rms (${mx.toExponential(1)} at most, where paths pass stagnation points)`);
    const m0 = femMarch(rf, { at: () => ({ inlet: inlet(0) }), tEnd: 2, dt0: 1e-3, tol: 1e-3, carry: structMarch(Sl, lawN) });
    const dQ = Math.abs(m0.last.Q / rf.Q - 1), dS = Math.abs(m0.last.surface.s - rf.surface.s);
    check(m0.completed && dQ < 2e-4 && dS < 1e-3 * coat.H, `and marched with nothing changed for 2 s: film ${(rf.Q / Uf * 1e6).toFixed(3)} -> ${(m0.last.Q / Uf * 1e6).toFixed(3)} µm (${(dQ * 100).toFixed(4)}%), contact line moved ${(dS * 1e6).toFixed(2)} µm; ${m0.steps} steps`);
  }
  // D, E: the coating flow of 5 with a structure that rebuilds in 0.05 s
  {
    const { H, U, base, inlet } = coat, Ss = { tb: 0.05, gdc: 50, cy: 0, ce: 2 }, P1 = 150;
    const bs = { ...base, mu: lawN.mu }, edge = (r, c) => structColumn(r, r.lam, c);
    const r0 = solveCoaterStruct({ ...bs, Pup: 0 }, Ss, lawN), r1 = solveCoaterStruct({ ...bs, Pup: P1 }, Ss, lawN);
    const track = (r, info) => edge(r, (info.meshInfo || r0.meshInfo).cCorner);
    const m0 = femMarch(r0, { at: () => ({ inlet: inlet(0) }), tEnd: 0.3, dt0: 1e-3, tol: 1e-3, carry: structMarch(Ss, lawN), track });
    const dQ0 = Math.abs(m0.last.Q / r0.Q - 1), dL0 = Math.abs(m0.track[m0.track.length - 1] - edge(r0, r0.meshInfo.cCorner));
    check(r0.converged && m0.completed && dQ0 < 1e-4 && dL0 < 2e-3, `nothing changed for 0.3 s (6 rebuild times): film ${(r0.Q / U * 1e6).toFixed(3)} -> ${(m0.last.Q / U * 1e6).toFixed(3)} µm (${(dQ0 * 100).toFixed(4)}%), lambda leaving the edge ${edge(r0, r0.meshInfo.cCorner).toFixed(5)} -> ${m0.track[m0.track.length - 1].toFixed(5)}`);
    const m = femMarch(r0, { at: () => ({ inlet: inlet(P1) }), tEnd: 1, dt0: 1e-4, tol: 1e-3, carry: structMarch(Ss, lawN), track });
    const L = m.last, l0 = edge(r0, r0.meshInfo.cCorner), l1 = edge(r1, r1.meshInfo.cCorner), lE = m.track[m.track.length - 1];
    const dQ = Math.abs(L.Q / r1.Q - 1), dL = Math.abs(lE - l1) / Math.abs(l1 - l0), dS = Math.abs(L.surface.s - r1.surface.s);
    check(r1.converged && m.completed && dQ < 5e-4 && dL < 0.03 && dS < 0.02 * H,
      `bead pressure 0 -> ${P1} Pa: after 1 s film ${(L.Q / U * 1e6).toFixed(3)} µm vs the steady structure solve ${(r1.Q / U * 1e6).toFixed(3)} µm (${(dQ * 100).toFixed(4)}%), lambda leaving the edge ${l0.toFixed(5)} -> ${lE.toFixed(5)} vs ${l1.toFixed(5)} (${(dL * 100).toFixed(1)}% of its change), contact line within ${(dS / H * 100).toFixed(2)}% of the gap (each on its own mesh); ${m.steps} steps, ${m.corrected} solved again with the structure they carried`);
  }
}

console.log('\n' + (allPass ? 'ALL PASS' : 'SOME CHECKS FAILED'));
if (!allPass) process.exitCode = 1;
