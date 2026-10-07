/*
 * feed-pool.validate.js — checks of feed-pool.js (the pool fed by falling streams in pulses) against exact solutions.
 * Run: node feed-pool.validate.js
 *  1. At rest (the web still, nothing in, nothing out): the paste still, the pressure the pool's weight, p = ρ g (h − y),
 *     at every node -- exact under a straight blade face (the elements' maps polynomial); under the round blade, the
 *     quadrature's stir there falling as the mesh is refined.
 *  2. The free top at rest, started from two heaps (one up, one down): it returns flat to the level (a free top at rest
 *     carries no stress), the steps moving it slower each time (slowest where it meets the blade: no-slip there).
 *  3. The paste's balance, in a pulse and between pulses: out through the pool edge the web's flow, in through the top
 *     the same, nothing through the walls, the web or the back edge; each stream's flow exactly the pulse's share.
 *  4. A long shallow strip of pool (mirrors for side plates), between pulses: far from its ends, the exact flow of a pool
 *     fed through its top and dragged by the web (by hand: u = U (1 − 3y/h + 3y²/2h²) + q(x) (3y/h² − 3y²/2h³),
 *     v = −w0 (3y²/2h² − y³/2h³), q′ = w0; w0 the top's speed down, q the flow along the pool per width there; q′ to the
 *     elements' local mass error, a part of U: q is the small net flow of a larger one turning in the pool).
 *  5. Paths through the cycle: in a flow steady in each part of it (one speed in a pulse, another between), the time to the
 *     pool edge exact, never stepping across a switch.
 *  6. The 2D page's pool: the same solver on a strip one element across with mirrors at its sides and the feed a band
 *     across it is a slice along the web -- no flow across, the same flow at both sides, and strips of two widths giving
 *     the same flow per width (to rounding).
 *  7. The 3D page's pool with its outlets in mirror pairs: half the pool solved (a mirror at its middle) and rebuilt is the
 *     whole pool solved on the same mesh -- every node's velocity and pressure, the flows, the paths' times.
 *  8. The tips in the paste (the 2D page's slice, a pipe a slot across it standing from above the top down into the paste):
 *     in a pulse the paste in through the bore is the pulse's, out through the pool edge the web's, the top rising with
 *     the rest, nothing through the pipe's walls; down the bore, plug where it enters, the flow between two walls: 4 bores
 *     below the entry, the exact parabola v = −(3/2) V (1 − (2ξ/d)²) (V the bore's mean speed). Between pulses the drain's
 *     balance, and the bore's paste at rest away from its mouth: the pool's stir there dies up the bore as Stokes flow in a
 *     channel does (its slowest end mode e^(−4.21 y/d), Papkovich–Fadle): 2 bores up, under 1e-3 of the stir at the mouth.
 *  9. The tips in the paste in 3D: round pipes on the coater's block mesh (the mirror half of four outlets): in a pulse the
 *     paste in through the bores is the pulse's (each bore's plug over its discrete area), out at the pool edge the web's,
 *     the top rising with the rest, nothing through the walls; down each bore, the flow in a round pipe, Poiseuille's
 *     v = −2 V (1 − r²/rb²), 3 bores below the entry, to the O-grid's accuracy (POISEUILLE_TOL of the peak).
 * 10. The 3D page's pool with the tips in the paste, at the page's mesh, shown on the pool's own grid (fplOnGrid): the flow
 *     at every node in the paste -- the pool edge's whole column too, under the blade, where the coater mesh's layers bend
 *     hard down to it -- and none only in the pipes' walls; the flow out across the pool edge, summed over the grid, the
 *     web's (to the grid's quadrature, EDGE_TOL).
 */
const FP = require('../engine/feed-pool.js'), PM = require('../engine/feed-pool-mesh.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const R = 0.1, H = 1.725e-3, blade = x => H + R - Math.sqrt(Math.max(0, R * R - x * x)), rho = 1360, g = 9.81, U = 0.28 / 60;
const W = 0.3, xBack = 0.13, xEnd = 0.04, h = 0.0367, outlets = [37.5, 112.5, 187.5, 262.5].map(z => ({ x: -0.1, z: z / 1000 }));
const coarse = { hFine: 6e-3, hMax: 25e-3, ny: 3 }, newt = () => 10.5;
// (check 9: the round pipes' mesh -- feed-mesh.js's options: half a bore per layer up the 6-bore channel -- and how near
//  Poiseuille its bores' flow must come)
const PIPE_MESH = { nUp: 12 }, POISEUILLE_TOL = 1e-3;
// (check 10: the 3D page's own meshes -- the coater's round the pipes and the pool's grid -- at their defaults)
const PAGE_PIPES = { m: 4, nLo: 4, nUp: 4, hFar: 0.02 }, PAGE_GRID = { hFine: 1.5e-3, hMax: 0.02, ny: 4 }, EDGE_TOL = 5e-3;
const base = { W, xBack, xEnd, h, blade, rho, g, outlets, r: 6e-3, mu: newt, mesh: coarse };

// 1. at rest: exact under a straight blade face; under the round blade the stir falls with the mesh
{
  const line = x => 0.01 + 0.5 * (-xEnd - x), still = (bl, mesh) => {
    const r = FP.fplSolve({ ...base, blade: bl, mesh, U: 0, Qin: 0, Qout: 0, pulse: false });
    let um = 0, pe = 0; for (let n = 0; n < r.M.nN; n++) { um = Math.max(um, Math.hypot(r.u[n], r.v[n], r.w[n])); if (Number.isFinite(r.p[n])) pe = Math.max(pe, Math.abs(r.p[n] - rho * g * (h - r.M.Y[n]))); }
    return { um, pe, nE: r.M.nE };
  };
  const a = still(line, coarse), b = still(blade, coarse), c = still(blade, { hFine: 3e-3, hMax: 12.5e-3, ny: 6 });
  check('at rest: the paste still, the pressure the pool\'s weight ρ g (h − y) at every node (exact under a straight blade face; under the round one, small and falling with the mesh)',
    a.um < 1e-12 && a.pe < 1e-9 * rho * g * h && c.um < b.um / 2 && c.pe < b.pe && c.um < 1e-5 * rho * g * h * h / 10.5 && c.pe < 3e-3 * rho * g * h,
    `straight: fastest ${a.um.toExponential(1)} m/s, pressure off ${a.pe.toExponential(1)} Pa; round: ${b.um.toExponential(1)} → ${c.um.toExponential(1)} m/s (of ρgh²/μ ${(rho * g * h * h / 10.5).toFixed(2)} m/s), ${b.pe.toExponential(1)} → ${c.pe.toExponential(1)} Pa (${b.nE} → ${c.nE} elements)`);
}

// 2. the free top at rest returns flat
{
  const M0 = PM.fpmMesh({ W, xBack, xEnd, h, blade, outlets, r: 6e-3, ...coarse }), I = M0.info, NX = I.NX, wts = FP.fplPlanWeights(I);
  const XN = i => M0.X[i], ZN = k => M0.Z[(k * I.NY) * NX], b = (x, z, cx, cz, a) => { const d2 = ((x - cx) ** 2 + (z - cz) ** 2) / (a * a); return d2 < 1 ? (1 - d2) ** 2 : 0; };
  const iJ = 2 * I.xs.findIndex(v => Math.abs(v - I.xJ) < 1e-12), eta = new Float64Array(NX * I.NZ), b2 = new Float64Array(NX * I.NZ);
  for (let k = 0; k < I.NZ; k++) for (let i = 0; i < iJ; i++) { eta[k * NX + i] = 2e-3 * b(XN(i), ZN(k), -0.1, 0.1, 0.02); b2[k * NX + i] = b(XN(i), ZN(k), -0.1, 0.2, 0.02); }
  // (the second heap down, so the top's mean is the level)
  const s1 = eta.reduce((s, v, j) => s + wts[j] * v, 0), s2 = b2.reduce((s, v, j) => s + wts[j] * v, 0);
  for (let j = 0; j < eta.length; j++) eta[j] -= s1 / s2 * b2[j];
  const e0 = Math.max(...eta.map(Math.abs)), r = FP.fplSolve({ ...base, U: 0, Qin: 0, Qout: 0, pulse: false, eta, free: { sigma: 0.07, dtMax: 0.4, steps: 30, tol: 1e-12 } });
  // (where the top meets the blade, a no-slip wall, the paste barely moves and the top settles slowest: two elements
  //  apart from it, the rest)
  const away = j => I.xJ - XN(j % NX) > 2 * coarse.hFine, e1 = Math.max(...r.eta.map((v, j) => (away(j) ? Math.abs(v) : 0))), e2 = Math.max(...r.eta.map(Math.abs));
  const sp = r.tops.map(t => t.speed), slower = sp.every((m, i) => i === 0 || m < sp[i - 1]);
  check('the free top at rest, started from two heaps (2 mm up, 2 mm down): it returns flat to the level, each step slower', e1 < 1e-3 * e0 && e2 < 3e-3 * e0 && slower,
    `the heaps ${(e0 * 1e3).toFixed(2)} mm → ${(e1 * 1e6).toFixed(3)} µm (${(e2 * 1e6).toFixed(3)} µm next to the blade) after ${r.tops.length} steps (${r.tops[r.tops.length - 1].t.toFixed(2)} s); the top's speed ${sp.filter((m, i) => i % 3 === 0).map(m => (m * 1e6).toExponential(1)).join(', ')} µm/s (every third step)`);
}

// 3. the paste's balance
{
  const Qin = 20e-6, Qout = 2.14e-6, out = [];
  for (const pulse of [true, false]) {
    const r = FP.fplSolve({ ...base, U, Qin, Qout, pulse }), f = r.flows, walls = Math.max(...['back', 'web', 'blade', 'side0', 'side1'].map(t => Math.abs(f[t])));
    // each stream's flow through the top: the stream's velocity over its disc, the top's own shares of area
    const FS = require('../engine/feed-free.js'), A = FS.fsArea({ M: r.M, X: r.M.X, Y: r.M.Y, Z: r.M.Z }, ['pile']);
    const each = outlets.map(q => { let s = 0; for (const [n, a] of A) if ((r.M.X[n] - q.x) ** 2 + (r.M.Z[n] - q.z) ** 2 < base.r ** 2) s += a * r.stream(r.M.X[n], r.M.Y[n], r.M.Z[n]); return s; });
    out.push({ pulse, f, walls, each, ok: Math.abs(f.end / Qout - 1) < 1e-9 && Math.abs(f.top / Qout + 1) < 1e-9 && walls < 1e-12 * Qout && (!pulse || each.every(s => Math.abs(s / (Qin / 4) - 1) < 1e-12)) });
  }
  check('the paste\'s balance, in a pulse and between: out through the pool edge the web\'s flow, in through the top the same, nothing through the walls', out.every(o => o.ok),
    out.map(o => `${o.pulse ? 'pulse' : 'between'}: edge ${(o.f.end * 1e6).toFixed(9)}, top ${(o.f.top * 1e6).toFixed(9)} ml/s, walls ≤ ${o.walls.toExponential(0)}${o.pulse ? `; streams ${o.each.map(s => (s * 1e6).toFixed(9)).join(', ')} ml/s` : ''}`).join('; '));
}

// 4. a long shallow strip of pool (mirrors at its sides): the exact flow far from its ends
{
  const hs = 0.012, xb = 0.2, Qout = 2e-6, r = FP.fplSolve({ W, xBack: xb, xEnd, h: hs, blade, rho, g, outlets: [], r: 6e-3, mu: newt, U, Qin: 0, Qout, pulse: false, sides: 'slip', mesh: { hFine: 3e-3, hMax: 20e-3, ny: 6 } });
  const M = r.M, I = M.info, NX = I.NX, NY = I.NY, xm = (-xb + I.xJ) / 2, w0 = -r.hdot;
  // the plan's node nearest the middle (x, and z = W/2)
  let i = 0; for (let a = 0; a < NX; a++) if (Math.abs(M.X[a] - xm) < Math.abs(M.X[i] - xm)) i = a;
  let k = 0; for (let c = 0; c < I.NZ; c++) if (Math.abs(M.Z[c * NY * NX] - W / 2) < Math.abs(M.Z[k * NY * NX] - W / 2)) k = c;
  const col = Array.from({ length: NY }, (_, j) => (k * NY + j) * NX + i), ys = col.map(n => M.Y[n]);
  // q: the flow along the pool per width, from the column (Simpson on each Q2 element: exact for the quadratic u)
  let q = 0; for (let j = 0; j + 2 < NY; j += 2) q += (ys[j + 2] - ys[j]) * (r.u[col[j]] + 4 * r.u[col[j + 1]] + r.u[col[j + 2]]) / 6;
  const f0 = y => 1 - 3 * y / hs + 1.5 * y * y / (hs * hs), f1 = y => 3 * y / (hs * hs) - 1.5 * y * y / hs ** 3, F1 = y => 1.5 * y * y / (hs * hs) - 0.5 * y ** 3 / hs ** 3;
  let eu = 0, ev = 0; col.forEach((n, j) => { eu = Math.max(eu, Math.abs(r.u[n] - (U * f0(ys[j]) + q * f1(ys[j])))); ev = Math.max(ev, Math.abs(r.v[n] + w0 * F1(ys[j]))); });
  // q′ = w0: the flow along the pool grows by what comes through the top (its slope over ±40 mm, least squares on the
  //  elements' boundaries: the elements keep the paste on average over each, not at every point)
  const qAt = ii => { const c = col.map(n => n - i + ii); let s = 0; for (let j = 0; j + 2 < NY; j += 2) s += (M.Y[c[j + 2]] - M.Y[c[j]]) * (r.u[c[j]] + 4 * r.u[c[j + 1]] + r.u[c[j + 2]]) / 6; return s; };
  const fit = []; for (let ii = 0; ii < NX; ii += 2) if (Math.abs(M.X[ii] - xm) <= 0.04) fit.push([M.X[ii], qAt(ii)]);
  const mx = fit.reduce((a, p) => a + p[0], 0) / fit.length, mq = fit.reduce((a, p) => a + p[1], 0) / fit.length;
  const dq = fit.reduce((a, p) => a + (p[0] - mx) * (p[1] - mq), 0) / fit.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  // (q is the small net flow of a much larger one turning in the pool, U h / 3 each way: the elements' local mass error is
  //  of that one's, so q′ = w0 to a part of U, not of w0)
  check('a long shallow strip of pool between pulses: far from its ends, the exact flow of a pool fed through its top and dragged by the web', eu < 1e-4 * U && ev < 1e-3 * w0 && Math.abs(dq - w0) < 1e-4 * U,
    `at ${(xm * 1e3).toFixed(0)} mm, ${(hs * 1e3).toFixed(0)} mm deep: u off by ${(eu / U).toExponential(1)} U, v by ${(ev / w0).toExponential(1)} w0; q′ − w0 ${((dq - w0) / U).toExponential(1)} U (q′/w0 ${(dq / w0).toFixed(4)}); the top's speed ${(w0 * 1e6).toFixed(3)} µm/s; ${M.nE} elements`);
}

// 5. paths through the cycle in a flow steady in each part of it
{
  const M = PM.fpmMesh({ W, xBack, xEnd, h, blade, outlets, r: 6e-3, ...coarse }), a = 2e-3, b = 0.5e-3, T = 10, tau = 3;
  const fld = s => ({ M, u: new Float64Array(M.nN).fill(s), v: new Float64Array(M.nN), w: new Float64Array(M.nN) });
  // by hand: from x0 at t0, a while a pulse lasts, b after, to −xEnd
  const exact = (x0, t0) => { let x = x0, t = t0; for (let it = 0; it < 1000; it++) { const ph = ((t % T) + T) % T, on = ph < tau, s = on ? a : b, d = on ? tau - ph : T - ph; if (x + s * d >= -xEnd) return t + (-xEnd - x) / s - t0; x += s * d; t += d; } return NaN; };
  const starts = [[-0.1, 0.006, 0.15], [-0.125, 0.003, 0.05]], t0s = [1, 7.5];   // (below the blade's face at the pool edge, 10 mm)
  let err = 0, ok = true; const info = [];
  for (const t0 of t0s) {
    const P = FP.fplPaths(fld(a), fld(b), starts, { T, tau, t0, xEnd });
    P.forEach((p, j) => { const te = exact(starts[j][0], t0); err = Math.max(err, Math.abs(p.t - te)); ok = ok && p.out && p.pts.every(q => Math.abs(q[1] - starts[j][1]) < 1e-15 && Math.abs(q[2] - starts[j][2]) < 1e-15); info.push(`${p.t.toFixed(4)} s (exact ${te.toFixed(4)})`); });
  }
  check('paths through the cycle (2 mm/s in a pulse, 0.5 mm/s between): the time to the pool edge exact, never across a switch', ok && err < 1e-9, info.join(', ') + ` (off ${err.toExponential(1)} s)`);
}

// 6. the 2D page's pool: the 3D solver on a strip one element across, mirrors at its sides, the feed a band across it — a
//  slice along the web: nothing across, the same flow at both sides, and the same flow per width for any strip
{
  const Qin = 20e-6, Qout = 2.14e-6, run = Ws => FP.fplSolve({ W: Ws, xBack, xEnd, h, blade, rho, g, outlets: [{ x: -0.1, z: Ws / 2 }], r: 6e-3, line: true, mu: newt,
    U, Qin: Qin * Ws / W, Qout: Qout * Ws / W, pulse: true, sides: 'slip', mesh: { ...coarse, nz: 1, sideFine: false }, solve: { tol: 1e-12 } });
  const A = run(0.02), B = run(0.045), I = A.M.info, NX = I.NX, NY = I.NY, rgh = rho * g * h;
  let wMax = 0, side = 0, sideP = 0, wid = 0, widP = 0, same = I.NZ === 3 && B.M.info.NX === NX && B.M.info.NY === NY;
  for (const r of [A, B]) for (let n = 0; n < r.M.nN; n++) wMax = Math.max(wMax, Math.abs(r.w[n]));
  for (let j = 0; j < NY && same; j++) for (let i = 0; i < NX; i++) {
    const a = j * NX + i;
    same = same && A.M.X[a] === B.M.X[a] && A.M.Y[a] === B.M.Y[a];
    // (the pressure where it lives: the elements' corner nodes, both sides)
    const pd = (x, y) => (Number.isFinite(x) || Number.isFinite(y) ? Math.abs(x - y) : 0);
    for (const r of [A, B]) for (const k of [1, 2]) { const b = (k * NY + j) * NX + i; side = Math.max(side, Math.abs(r.u[b] - r.u[a]), Math.abs(r.v[b] - r.v[a])); if (k === 2) sideP = Math.max(sideP, pd(r.p[b], r.p[a])); }
    wid = Math.max(wid, Math.abs(A.u[a] - B.u[a]), Math.abs(A.v[a] - B.v[a])); widP = Math.max(widP, pd(A.p[a], B.p[a]));
  }
  const qa = A.flows.end / 0.02, qb = B.flows.end / 0.045;
  check('the 2D page\'s pool (a strip one element across, mirrors at its sides, the feed a band across it): a slice along the web, the same for any strip', same && Number.isFinite(sideP + widP) && wMax < 1e-9 * U && side < 1e-9 * U && sideP < 1e-9 * rgh && wid < 1e-9 * U && widP < 1e-9 * rgh && Math.abs(qa / qb - 1) < 1e-9,
    `across: ${(wMax / U).toExponential(1)} U; side to side: u, v ${(side / U).toExponential(1)} U, p ${(sideP / rgh).toExponential(1)} ρgh; strips 20 and 45 mm wide: u, v ${(wid / U).toExponential(1)} U, p ${(widP / rgh).toExponential(1)} ρgh, out per width ${(qa * 1e3).toFixed(9)} and ${(qb * 1e3).toFixed(9)} ml/s per mm; ${A.M.nE} elements`);
}

// 7. the 3D page's pool with its outlets in mirror pairs: half the pool solved, mirrored at the middle, and rebuilt -- the
//  same as the whole pool solved on the same mesh (fields at every node, flows, paths)
{
  const cyc = { dim: 3, W, xBack, xEnd, R, H, rho, g, U, law: { muRef: 10.5, ty: 0, n: 1 }, outlets, r: 6e-3, Qin: 20e-6, Qout: 2.14e-6,
    hP: h + 1.5e-3, hD: h - 1.5e-3, T: 28, tau: 3, tMax: 3000, solveTol: 1e-11 };
  const half = outlets.filter(q => q.z < W / 2), zsH = PM.fpmMesh({ W: W / 2, xBack, xEnd, h: cyc.hP, blade, outlets: half, r: 6e-3, ...coarse, sideFine: [true, false] }).info.zs;
  const zsF = [...zsH, ...zsH.slice(0, -1).reverse().map(z => W - z)];
  const A = FP.fplCycle({ ...cyc, mesh: coarse }), B = FP.fplCycle({ ...cyc, mirror: false, mesh: { ...coarse, zs: zsF } });
  let same = A.mirror && !B.mirror, du = 0, dp = 0, dq = 0, umax = 0, dt = 0, nP = 0;
  for (let s = 0; s < 2; s++) {
    const a = A.states[s], b = B.states[s], rgh = rho * g * a.info.h;
    same = same && a.X.length === b.X.length;
    for (let n = 0; n < Math.min(a.X.length, b.X.length); n++) {
      // (the nodes kept to single precision: one unit in its last place at 0.3 m is 3e-8 m)
      same = same && Math.abs(a.X[n] - b.X[n]) < 1e-7 && Math.abs(a.Y[n] - b.Y[n]) < 1e-7 && Math.abs(a.Z[n] - b.Z[n]) < 1e-7;
      umax = Math.max(umax, Math.hypot(b.u[n], b.v[n], b.w[n]));
      du = Math.max(du, Math.abs(a.u[n] - b.u[n]), Math.abs(a.v[n] - b.v[n]), Math.abs(a.w[n] - b.w[n]));
      if (Number.isFinite(a.p[n]) && Number.isFinite(b.p[n])) dp = Math.max(dp, Math.abs(a.p[n] - b.p[n]) / rgh);
    }
    for (const t of ['top', 'end', 'back', 'web', 'blade']) dq = Math.max(dq, Math.abs(a.flows[t] - b.flows[t]) / cyc.Qout);
  }
  // (each path and its partner: the same outlet, the same start)
  const key = p => `${p.outlet}:${p.out}:${Math.round(p.pts[0] * 1e7)}:${Math.round(p.pts[2] * 1e7)}`, bm = new Map(B.paths.map(p => [key(p), p]));
  for (const p of A.paths) { const q = bm.get(key(p)); if (!q) { same = false; continue; } nP++; if (p.out) dt = Math.max(dt, Math.abs(p.t - q.t) / q.t); }
  check('the 3D page\'s pool with its outlets in mirror pairs: half solved and mirrored is the whole pool solved (fields, flows, paths)', same && nP === B.paths.length && du < 1e-6 * umax && dp < 1e-6 && dq < 1e-9 && dt < 1e-4,
    `${A.states[0].info.nESolved} of ${B.states[0].info.nE} elements solved; velocity off ${(du / umax).toExponential(1)} of its largest, pressure ${dp.toExponential(1)} ρgh (the fields kept to single precision), flows ${dq.toExponential(1)} of the web's; ${nP} paths, times off ${dt.toExponential(1)}`);
}

// 8. the tips in the paste: a pipe across the 2D's slice, the paste in through its bore -- the balance, and the bore's
//  flow between its walls the exact parabola once developed
{
  const Ws = 0.01, sh = Ws / W, d = 0.01, tip = 0.03, bore = 6 * d, Qin = 20e-6 * sh, Qout = 2.14e-6 * sh, V = Qin / (d * Ws);
  const so = { W: Ws, xBack, xEnd, h, blade, U, rho, g, outlets: [{ x: -0.1, z: Ws / 2 }], r: 3e-3, line: true, mu: newt, Qin, Qout, sides: 'slip',
    pipes: [{ x: -0.1, d, Do: 0.014, tip, bore }], mesh: { hFine: 1e-3, hMax: 10e-3, ny: 6, nz: 1, sideFine: false }, solve: { tol: 1e-11 } };
  const A = FP.fplSolve({ ...so, pulse: true }), B = FP.fplSolve({ ...so, pulse: false }), fa = A.flows, fb = B.flows;
  const bal = Math.max(Math.abs(fa.bore + Qin), Math.abs(fa.end - Qout), Math.abs(fa.top - (Qin - Qout)), Math.abs(fa.pipe), Math.abs(fa.web), Math.abs(fa.back),
    Math.abs(fb.bore), Math.abs(fb.end - Qout), Math.abs(fb.top + Qout), Math.abs(fb.pipe)) / Qout;
  // (the row of nodes 4 bores below the entry, 2 above the tip, across the bore; and the bore at rest between pulses)
  const M = A.M, yq = tip + bore - 4 * d; let e = 0, n = 0, mouth = 0, rest = 0;
  for (let i = 0; i < M.nN; i++) {
    const xi = M.X[i] + 0.1; if (Math.abs(M.Z[i]) > 1e-12 || Math.abs(xi) > d / 2 + 1e-12) continue;
    // (between pulses: the stir at the mouth, and up the bore from 2 bores above the tip)
    if (Math.abs(M.Y[i] - tip) < 1e-9) mouth = Math.max(mouth, Math.hypot(B.u[i], B.v[i]));
    if (M.Y[i] >= tip + 2 * d - 1e-9) rest = Math.max(rest, Math.hypot(B.u[i], B.v[i]));
    if (Math.abs(M.Y[i] - yq) > 1e-9) continue;
    e = Math.max(e, Math.abs(A.v[i] + 1.5 * V * (1 - (2 * xi / d) ** 2)) / (1.5 * V)); n++;
  }
  check('the tips in the paste (a pipe across the 2D\'s slice): the paste in through its bore in a pulse, out at the pool edge, the top rising with the rest; the bore\'s flow the exact parabola once developed; between pulses its paste at rest away from the mouth',
    bal < 1e-6 && n >= 11 && e < 1e-3 && mouth > 0 && rest < 1e-3 * mouth,
    `${M.nE} elements; flows off ${bal.toExponential(1)} of the web's; ${n} nodes across the bore 4 bores below its entry, off the parabola by ${e.toExponential(1)} of its peak; between pulses the stir at the mouth ${(mouth / V).toExponential(1)} of the bore's pulse speed, 2 bores up ${(rest / mouth).toExponential(1)} of it`);
}

// 9. the tips in the paste in 3D: round pipes on the coater's block mesh -- the balance; down each bore, Poiseuille
{
  const d = 0.01, tip = 0.03, bore = 6 * d, Qin = 20e-6 / 2, Qout = 2.14e-6 / 2, rb = d / 2;
  const r = FP.fplSolvePipes({ W, half: true, xBack, xEnd, h, blade, U, rho, g, outlets: outlets.map(q => ({ x: -0.1, z: q.z })), mu: newt, Qin, Qout, pulse: true,
    pipe: { d, Do: 0.014, tip, bore }, mesh: PIPE_MESH, solve: { tol: 1e-11 } });
  const f = r.flows, M = r.M, nP = M.info.pipes.length, V = Qin / nP / (Math.PI * rb * rb), yq = tip + bore - 3 * d;
  const bal = Math.max(Math.abs(f.bore + Qin), Math.abs(f.end - Qout), Math.abs(f.top - (Qin - Qout)), Math.abs(f.pipe), Math.abs(f.web), Math.abs(f.back), Math.abs(f.side0)) / Qout;
  let e = 0, n = 0;
  for (const q of M.info.pipes) {
    let best = Infinity; for (let i = 0; i < M.nN; i++) if (Math.hypot(M.X[i] + 0.1, M.Z[i] - q.z) <= rb + 1e-9) best = Math.min(best, Math.abs(M.Y[i] - yq));
    for (let i = 0; i < M.nN; i++) { const rr = Math.hypot(M.X[i] + 0.1, M.Z[i] - q.z); if (rr > rb + 1e-9 || Math.abs(Math.abs(M.Y[i] - yq) - best) > 1e-9) continue;
      e = Math.max(e, Math.abs(r.v[i] + 2 * V * (1 - rr * rr / (rb * rb))) / (2 * V)); n++; }
  }
  check('the tips in the paste in 3D (round pipes on the coater\'s block mesh, half the pool): the paste in through the bores, out at the pool edge, the top rising with the rest; down each bore, Poiseuille\'s flow',
    bal < 1e-6 && n >= 2 * 100 && e < POISEUILLE_TOL,
    `${M.nE} elements, ${nP} pipes; flows off ${bal.toExponential(1)} of the web's; ${n} nodes across the bores 3 bores below their entry, off Poiseuille by ${e.toExponential(1)} of its peak`);
}

// 10. the 3D page's pool with the tips in the paste on the pool's own grid: the flow everywhere in the paste, none in the walls
{
  const d = 0.01, Do = 0.014, tip = 0.03, Qin = 20e-6 / 2, Qout = 2.14e-6 / 2, half = outlets.filter(q => q.z < W / 2);
  const r = FP.fplSolvePipes({ W, half: true, xBack, xEnd, h, blade, U, rho, g, outlets, mu: newt, Qin, Qout, pulse: true, pipe: { d, Do, tip }, mesh: PAGE_PIPES });
  const G = PM.fpmMesh({ W: W / 2, xBack, xEnd, h, blade, outlets: half, r: Do / 2, ...PAGE_GRID }), [u] = FP.fplOnGrid(r, G);
  const wallAt = i => G.Y[i] > tip - 1e-9 && half.some(q => { const rr = Math.hypot(G.X[i] - q.x, G.Z[i] - q.z); return rr > d / 2 - 1e-9 && rr < Do / 2 + 1e-9; });
  let none = 0, noneOut = 0, edgeNone = 0;
  for (let i = 0; i < G.nN; i++) if (!Number.isFinite(u[i])) { none++; if (!wallAt(i)) noneOut++; if (Math.abs(G.X[i] + xEnd) < 1e-12) edgeNone++; }
  // (across the pool edge: the grid's last column, its Q2 elements' quadratics through each three nodes, up each line of
  //  nodes and then across the half -- the grid's own interpolant integrated exactly)
  const quad3 = (a, b, c, fa, fb, fc) => {            // (the quadratic through three points, integrated from a to c)
    const P = x => x * x * x / 3, Q = x => x * x / 2, I = (m, n, k) => (P(c) - P(a) - (m + n) * (Q(c) - Q(a)) + m * n * (c - a)) / k;
    return fa * I(b, c, (a - b) * (a - c)) + fb * I(a, c, (b - a) * (b - c)) + fc * I(a, b, (c - a) * (c - b)); };
  const quad = (t, f) => { let s = 0; for (let j = 0; j + 2 < t.length; j += 2) s += quad3(t[j], t[j + 1], t[j + 2], f[j], f[j + 1], f[j + 2]); return s; };
  const byZ = new Map(); for (let i = 0; i < G.nN; i++) if (Math.abs(G.X[i] + xEnd) < 1e-12) { if (!byZ.has(G.Z[i])) byZ.set(G.Z[i], []); byZ.get(G.Z[i]).push(i); }
  const zq = [...byZ.keys()].sort((a, b) => a - b), perZ = zq.map(z => { const c = byZ.get(z).sort((a, b) => G.Y[a] - G.Y[b]); return quad(c.map(i => G.Y[i]), c.map(i => u[i])); });
  const q = quad(zq, perZ);
  const qe = Math.abs(q - r.flows.end) / r.flows.end;
  check('the tips in the paste in 3D at the page\'s meshes, on the pool\'s own grid: the flow at every node in the paste (the pool edge\'s whole column under the blade too), none only in the pipes\' walls; the flow across the pool edge the web\'s',
    none > 0 && noneOut === 0 && edgeNone === 0 && Number.isFinite(qe) && qe < EDGE_TOL,
    `${G.nN} grid nodes on ${r.M.nE} elements: ${none} without flow (${noneOut} of them outside the walls, ${edgeNone} at the pool edge); across the pool edge ${(q * 1e6).toFixed(4)} ml/s, the web's ${(r.flows.end * 1e6).toFixed(4)} (off ${(qe * 100).toFixed(2)} %)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
