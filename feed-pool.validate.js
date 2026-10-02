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
 */
const FP = require('./feed-pool.js'), PM = require('./feed-pool-mesh.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const R = 0.1, H = 1.725e-3, blade = x => H + R - Math.sqrt(Math.max(0, R * R - x * x)), rho = 1360, g = 9.81, U = 0.28 / 60;
const W = 0.3, xBack = 0.13, xEnd = 0.04, h = 0.0367, outlets = [37.5, 112.5, 187.5, 262.5].map(z => ({ x: -0.1, z: z / 1000 }));
const coarse = { hFine: 6e-3, hMax: 25e-3, ny: 3 }, newt = () => 10.5;
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
    const FS = require('./feed-free.js'), A = FS.fsArea({ M: r.M, X: r.M.X, Y: r.M.Y, Z: r.M.Z }, ['pile']);
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

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
