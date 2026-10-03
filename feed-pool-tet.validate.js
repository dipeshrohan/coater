/*
 * feed-pool-tet.validate.js — the pool on tetrahedra (feed-pool-tet.js, MESH-T3): the paste behind the blade with the
 * outlets' pipes standing in it, meshed by the tetrahedral mesher and solved on P2–P1 elements, beside the same pool on
 * the coater's block mesh (feed-pool.js, Q2–Q1 hexahedra, as the Pool and feed page meshes it).
 * Run: node feed-pool-tet.validate.js
 *  1. The top's and the bores' areas as the solver weighs the flow through them (each node's ∫ N dA): the plan less the
 *     pipes' round holes, the bores' discs; on a flat face a P2 triangle's corners carry none.
 *  2. Finding points: random points in random curved elements, each found and a field there its element's own value.
 *  3. The pool with two pipes feeding it (half the 300 mm pool, a Newtonian paste): every flow balanced, the top rising
 *     with the rest; down each bore, Poiseuille's flow once developed.
 *  4. The same pool on the block mesh: the tetrahedra's flow and the hexahedra's along three lines (down a pipe's axis,
 *     along the web between the pipes, across the gap under the blade) and the pressure on the web, within 6 % RMS; the
 *     cross-width flow along a fourth line reported (OpenFOAM's benchmark judges it).
 *  5. The paste's own law (Herschel–Bulkley, the yield stress, the app's default) on tetrahedra through the cycle's
 *     continuation (the viscosity at 2.7 1/s, then the law with its γ̇ floor brought down): every stage converged, every
 *     flow balanced.
 *  6. Prism layers on the pipes (um-tetlayers.js; three, 0.3 mm first, ×1.3, on the bores, the outer walls and the ends,
 *     so the layers turn the tips' convex edges): every flow balanced; down each bore Poiseuille's flow; the jet below a
 *     tip as on the tetrahedra alone (3 % RMS), never faster than the bore's own peak.
 * The independent check against OpenFOAM is benchmarks/openfoam/pooltet.js (README: "The pool on tetrahedra").
 */
const FT = require('./feed-pool-tet.js'), FP = require('./feed-pool.js'), PO = require('./feed-post.js'), UFE = require('./um-fe.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const pc = v => `${(v * 100).toFixed(2)} %`;

const R = 0.1, H = 1.725e-3, blade = x => H + R - Math.sqrt(Math.max(0, R * R - x * x)), rho = 1360, g = 9.81, U = 0.28 / 60;
const W = 0.3, xBack = 0.13, xEnd = 0.04, h = 0.0367, outlets = [37.5, 112.5, 187.5, 262.5].map(z => ({ x: -0.1, z: z / 1000 }));
const d = 0.01, Do = 0.014, tip = 0.03, bore = 6 * d, Qin = 20e-6 / 2, Qout = 2.14e-6 / 2;
const pipe = { d, Do, tip, bore }, TET = { size: 10e-3, across: 2, tol: 0.2e-3 }, HEX = { m: 4, nLo: 4, nUp: 4, hFar: 0.02 };
const base = { W, half: true, xBack, xEnd, h, blade, U, rho, g, outlets, Qin, Qout, pulse: true, pipe };
const balance = f => Math.max(Math.abs(f.bore + Qin), Math.abs(f.end - Qout), Math.abs(f.top - (Qin - Qout)), Math.abs(f.pipe), Math.abs(f.web), Math.abs(f.back), Math.abs(f.side0), Math.abs(f.blade)) / Qout;
const t0 = Date.now(), Mt = FT.fptMesh({ ...base, mesh: TET }), M = Mt.M, msMesh = Date.now() - t0;

// 1. the areas
{
  let lo = -0.1, hi = 0; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (blade(m) > h) lo = m; else hi = m; }
  const sum = m => [...m.values()].reduce((s, a) => s + a, 0), xJ = (lo + hi) / 2;
  const top = sum(FT.fptAreas(M, ['pile'])), topEx = (xJ + xBack) * W / 2 - 2 * Math.PI * (Do / 2) ** 2, bin = sum(FT.fptAreas(M, ['bore-inlet'])), binEx = 2 * Math.PI * (d / 2) ** 2;
  // (the web: flat, straight-sided -- its triangles' corners carry nothing, their edges' middles a third each)
  const web = FT.fptAreas(M, ['web']), corner = new Set(); for (let e = 0; e < M.nE; e++) for (let k = 0; k < 4; k++) corner.add(M.conn[10 * e + k]);
  let cMax = 0, wSum = 0; for (const [n, a] of web) { wSum += a; if (corner.has(n)) cMax = Math.max(cMax, Math.abs(a)); }
  check('the top\'s and the bores\' areas as the flow through them weighs them: the plan less the round holes, the discs; a flat triangle\'s corners none',
    Math.abs(top / topEx - 1) < 1e-4 && Math.abs(bin / binEx - 1) < 1e-3 && Math.abs(wSum / ((xBack - xEnd) * W / 2) - 1) < 1e-12 && cMax < 1e-12 * wSum,
    `${M.nE} tetrahedra (${(msMesh / 1000).toFixed(1)} s); top off ${(top / topEx - 1).toExponential(1)}, bores off ${(bin / binEx - 1).toExponential(1)}, web ${(wSum / ((xBack - xEnd) * W / 2) - 1).toExponential(1)}; corners' largest ${cMax.toExponential(1)} m²`);
}

// 2. finding points
{
  const f = (x, y, z) => 3 + 50 * x - 20 * y + 7 * z + 400 * x * x - 900 * y * z + 300 * x * z + 1000 * y * y;
  const F = Float64Array.from({ length: M.nN }, (_, n) => f(M.X[n], M.Y[n], M.Z[n])), X = FT.fptIndex(M);
  let rng = 7, miss = 0, worst = 0, n = 0; const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  while (n < 2000) {
    const e = Math.floor(rnd() * M.nE), b = [rnd(), rnd(), rnd()]; if (b[0] + b[1] + b[2] > 1) continue;
    const N = UFE.ufeShape('tet10', b).N, P = [0, 0, 0]; let v = 0;
    for (let k = 0; k < 10; k++) { const m = M.conn[10 * e + k]; P[0] += N[k] * M.X[m]; P[1] += N[k] * M.Y[m]; P[2] += N[k] * M.Z[m]; v += N[k] * F[m]; }
    const r = FT.fptField(X, [F], P); n++;
    if (!r) miss++; else worst = Math.max(worst, Math.abs(r.v[0] - v) / Math.abs(v));
  }
  check('finding points in curved tetrahedra: every point found, a field there its element\'s own value', miss === 0 && worst < 1e-12, `${n} points, ${miss} missed, largest difference ${worst.toExponential(1)}`);
}

// 3. the pool with its pipes on tetrahedra
const lines = {
  'down a pipe\'s axis (v)': { c: 1, pts: Array.from({ length: 29 }, (_, i) => [-0.1, tip * (i + 0.5) / 29.5, 0.0375]) },
  'along the web between the pipes, 5 mm up (u)': { c: 0, pts: Array.from({ length: 41 }, (_, i) => [-0.128 + 0.086 * i / 40, 0.005, 0.075]) },
  'across the gap 50 mm before the edge (u)': { c: 0, pts: Array.from({ length: 31 }, (_, i) => [-0.05, blade(-0.05) * (i + 0.5) / 31, 0.075]) },
  'across the width 15 mm up (w)': { c: 2, pts: Array.from({ length: 59 }, (_, i) => [-0.115, 0.015, 0.001 + 0.148 * i / 58]) },
  'the pressure on the web under a pipe, the weight taken out (p)': { c: 3, pts: Array.from({ length: 37 }, (_, i) => [-0.12 + 0.07 * i / 36, 0.0005, 0.0375]) },
};
const sample = at => Object.fromEntries(Object.entries(lines).map(([k, L]) => [k, L.pts.map(p => { const f = at(p); return f ? (L.c === 3 ? f[3] - rho * g * (h - p[1]) : f[L.c]) : NaN; })]));
const onTet = r => { const X = FT.fptIndex(r.M); return sample(p => { const f = FT.fptField(X, [r.u, r.v, r.w, r.p], p); return f && f.v; }); };
const onHex = r => { const p4 = FP.fplPressureAll(r.M, r.p), X = PO.fpIndex(r.M); return sample(p => { const f = PO.fpField(X, [r.u, r.v, r.w, p4], p); return f && f.v; }); };
const differ = (A, B) => Object.fromEntries(Object.keys(lines).map(k => { const a = A[k], b = B[k], ok = a.map((v, i) => Number.isFinite(v) && Number.isFinite(b[i]));
  const dd = a.map((v, i) => (ok[i] ? b[i] - v : 0)), scale = k.endsWith('(p)') ? Math.max(...a.filter(Number.isFinite)) - Math.min(...a.filter(Number.isFinite)) : Math.max(...a.filter(Number.isFinite).map(Math.abs));
  return [k, { rms: Math.sqrt(dd.reduce((s, v) => s + v * v, 0) / ok.filter(Boolean).length) / scale, n: ok.filter(Boolean).length, of: a.length, scale }]; }));
let RT, RH;
// (down each bore, a bore's length round three bores below its entry -- the flow there developed: Poiseuille's parabola
//  at every node inside the bore's wall; each pipe its equal share of the flow in, so each bore's parabola fitted by
//  least squares has Poiseuille's peak)
function borePoiseuille(Mq, r) {
  const Mm = Mq.M, rb = d / 2, V = Qin / 2 / (Math.PI * rb * rb), yq = tip + bore - 3 * d; let e = 0, n = 0; const peaks = [];
  for (const q of Mq.pipes) {
    let sv = 0, sf = 0, nq = 0;
    for (let i = 0; i < Mm.nN; i++) { const rr = Math.hypot(Mm.X[i] - q.x, Mm.Z[i] - q.z), f = 1 - rr * rr / (rb * rb); if (rr > rb * (1 - 1e-6) || Math.abs(Mm.Y[i] - yq) > d / 2) continue; e = Math.max(e, Math.abs(r.v[i] + 2 * V * f) / (2 * V)); sv -= r.v[i] * f; sf += f * f; n++; nq++; }
    peaks.push(nq ? sv / sf / (2 * V) : NaN);
  }
  return { e, n, peaks };
}
{
  const t = Date.now(); RT = FT.fptSolve({ ...base, mu: () => 10.5, Mt, solve: { tol: 1e-10 } });
  const ms = Date.now() - t, { e, n, peaks } = borePoiseuille(Mt, RT);
  check('the pool with its pipes on tetrahedra (half the pool, two pipes): every flow balanced, the top rising with the rest; down each bore, Poiseuille\'s flow',
    balance(RT.flows) < 1e-9 && RT.converged && e < 0.02 && peaks.every(a => Math.abs(a - 1) < 0.005),
    `${M.nE} tetrahedra, ${RT.S.nD} unknowns, Newton ${RT.hist.length}, ${(ms / 1000).toFixed(0)} s; flows off ${balance(RT.flows).toExponential(1)} of the web's; ${n} nodes inside the bores, off Poiseuille by ${pc(e)} of its peak at most; each bore's fitted peak ${peaks.map(a => a.toFixed(4)).join(', ')} of Poiseuille's`);
}

// 4. the same pool on the block mesh
{
  const t = Date.now(); RH = FP.fplSolvePipes({ ...base, mu: () => 10.5, mesh: HEX, solve: { tol: 1e-10 } });
  const D = differ(onHex(RH), onTet(RT)), ms = Date.now() - t;
  // (the main flow -- down the pipe, along the web, across the gap -- and the pressure asserted; the cross-width flow,
  //  small and where the block mesh is coarsest between the pipes, reported: OpenFOAM's benchmark finds the tetrahedra the
  //  nearer of the two there)
  check('the same pool on the block mesh (Q2–Q1 hexahedra): the two meshes\' main flow alike along three lines, the pressure on the web alike',
    balance(RH.flows) < 1e-9 && Object.values(D).every(v => v.n === v.of) && Object.entries(D).every(([k, v]) => k.endsWith('(w)') || v.rms < 0.06),
    `${RH.M.nE} hexahedra, ${RH.S.nD} unknowns, ${(ms / 1000).toFixed(0)} s; RMS differences: ${Object.entries(D).map(([k, v]) => `${k} ${pc(v.rms)}`).join('; ')}`);
}

// 5. the paste's own law
{
  const ty = 5, baseMu = 10.5 - ty / 2.7, law = gd => ty / gd + baseMu, gd0 = U / H, rows = [];
  let x0 = null, all = true, bal = 0;
  const t = Date.now();
  for (const f of [null, 1e-1, 1e-2, 1e-3]) {
    const r = FT.fptSolve({ ...base, mu: f == null ? () => law(2.7) : law, gdMin: f == null ? undefined : f * gd0, Mt, solve: { x0, tol: 1e-8, ...(f == null ? {} : { lineSearch: true, maxNewton: 40 }) } });
    x0 = r.x; all = all && r.converged; bal = Math.max(bal, balance(r.flows));
    rows.push(`${f == null ? '10.5 Pa·s' : `floor ${(f * gd0).toPrecision(2)} 1/s`}: Newton ${r.hist.length}`);
  }
  check('the paste\'s own law (Herschel–Bulkley, 5 Pa yield stress) on tetrahedra through the cycle\'s continuation: every stage converged, every flow balanced',
    all && bal < 1e-9, `${rows.join(', ')} (${((Date.now() - t) / 1000).toFixed(0)} s); flows off ${bal.toExponential(1)} of the web's`);
}

// 6. prism layers on the pipes
{
  // (three layers, 0.3 mm first, ×1.3, on the bores, the pipes' outer walls and their ends -- the ends layered too, so
  //  the layers turn the tips' convex edges instead of ending in the paste there)
  const lay = { n: 3, first: 0.3e-3, growth: 1.3 }, t = Date.now();
  const ML = FT.fptMesh({ ...base, mesh: { ...TET, layers: [{ tags: ['bore', 'pipe-wall', 'pipe-end'], ...lay }] } });
  const RL = FT.fptSolve({ ...base, mu: () => 10.5, Mt: ML, solve: { tol: 1e-10 } }), ms = Date.now() - t, { e, n, peaks } = borePoiseuille(ML, RL);
  // (down the first pipe's axis from the web to its tip, against the tetrahedra alone; the jet out of a tip never faster
  //  than the bore's own Poiseuille peak)
  const k = 'down a pipe\'s axis (v)', A = onTet(RL)[k], B = onTet(RT)[k], ok = A.map((v, i) => Number.isFinite(v) && Number.isFinite(B[i]));
  const sc = Math.max(...B.filter(Number.isFinite).map(Math.abs)), rms = Math.sqrt(A.reduce((s2, v, i) => s2 + (ok[i] ? (v - B[i]) ** 2 : 0), 0) / ok.filter(Boolean).length) / sc;
  const peak2 = 2 * Qin / 2 / (Math.PI * (d / 2) ** 2), jet = Math.max(...A.filter(Number.isFinite).map(Math.abs));
  check('prism layers on the pipes (their tips wrapped): every flow balanced; down each bore Poiseuille\'s flow; the jet below a tip as on tetrahedra alone, never faster than the bore\'s peak',
    RL.converged && balance(RL.flows) < 1e-9 && e < 0.005 && peaks.every(a => Math.abs(a - 1) < 0.001) && ok.every(Boolean) && rms < 0.03 && jet < peak2,
    `${ML.nT} tetrahedra, ${ML.nW} prisms, ${RL.S.nD} unknowns, Newton ${RL.hist.length}, ${(ms / 1000).toFixed(0)} s; flows off ${balance(RL.flows).toExponential(1)}; ${n} nodes inside the bores, off Poiseuille by ${pc(e)} at most, fitted peaks ${peaks.map(a => a.toFixed(5)).join(', ')}; down the axis ${pc(rms)} RMS from the tetrahedra alone, its fastest ${(jet * 1e3).toFixed(1)} mm/s (the bore's peak ${(peak2 * 1e3).toFixed(1)} mm/s)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
