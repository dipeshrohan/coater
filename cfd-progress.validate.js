/*
 * cfd-progress.validate.js — checks of the progress estimates (cfd-progress.js). Run: node cfd-progress.validate.js
 *  1. A Newton solve's share: 0 at its first residual, 1 at the tolerance, half way on a log scale half way; its
 *     continuation's path when that is further; within 0..1.
 *  2. The 2D: a run that stays pinned at the edge (two solves) and one that climbs (many), fed as the worker sends them:
 *     the share never goes back and stays below 100 %; the edge's two solves reach PROG.pin; each solve on the face
 *     takes PROG.climb of what is left.
 *  3. The 3D strip: the stations' 2D then the 3D solve, weighted by their times: never back, the stations' part done
 *     at the 3D's start, 100 % at the 3D's tolerance.
 *  4. The full width: the sweeps expected from how fast the change falls; the share never back, below 100 %.
 */
const { PROG, progNewton, prog2D, prog2DFeed, prog3DStrip, prog3DStripFeed, progSweeps, prog3DWide, prog3DWideShare, progStation, progSolve } = require('./cfd-progress.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const close = (a, b, e = 1e-12) => Math.abs(a - b) <= e;

// 1. a Newton solve
{
  const tol = 1e-8, r0 = 1;
  const at = [progNewton(r0, r0, tol), progNewton(r0, 1e-4, tol), progNewton(r0, tol, tol), progNewton(r0, 1e-12, tol), progNewton(r0, 10, tol)];
  check('a Newton solve: 0 at its first residual, half way on a log scale, 1 at the tolerance and below, 0 above its start', close(at[0], 0) && close(at[1], 0.5) && at[2] === 1 && at[3] === 1 && at[4] === 0, at.map(v => v.toFixed(3)).join(' '));
  check('  its continuation\'s path when further; nothing known: 0', progNewton(r0, 1e-2, tol, 0.9) === 0.9 && close(progNewton(r0, 1e-2, tol, 0.1), 0.25) && progNewton(NaN, NaN, tol) === 0);
}

// a 2D run as the worker sends it: solves one after another, each a residual history falling to the tolerance
function run2D(labels, iters = 6, tol = 1e-8) {
  const P = prog2D(tol), live = { r: [], solves: [] }, shares = [];
  for (const lab of labels) {
    live.solves = [...live.solves, [lab, live.r.length]];
    for (let k = 0; k < iters; k++) {
      live.r.push(Math.pow(10, -8 * k / (iters - 1)) * (k === iters - 1 ? 0.5 : 1));
      prog2DFeed(P, { stage: lab, it: k, residual: live.r[live.r.length - 1], path: null }, live);
      shares.push(P.share);
    }
  }
  return { P, shares };
}
const mono = s => s.every((v, k) => k === 0 || v >= s[k - 1]);

// 2. the 2D
{
  const pinned = run2D(['contact line at the edge: flow, surface frozen', 'contact line at the edge: surface and flow coupled']);
  check('2D, pinned at the edge: never back, the edge\'s two solves reach PROG.pin', mono(pinned.shares) && close(pinned.P.share, PROG.pin), `${pinned.shares.map(v => Math.round(100 * v)).join(' ')} %`);
  const face = ['contact line free on the face (from 0.170 mm): flow, surface frozen (warm start)', 'contact line free on the face (from 0.170 mm): surface and flow coupled'];
  const climbs = run2D(['contact line at the edge: flow, surface frozen', 'contact line at the edge: surface and flow coupled', ...face, ...face, ...face, ...face]);
  const want = PROG.pin + (1 - PROG.pin) * (1 - Math.pow(1 - PROG.climb, 8));
  check('2D, climbing the face (8 more solves): never back, below 100 %, each solve PROG.climb of what is left', mono(climbs.shares) && climbs.P.share < 1 && close(climbs.P.share, want, 1e-9), `ends at ${(100 * climbs.P.share).toFixed(1)} % (expected ${(100 * want).toFixed(1)} %)`);
}

// 3. the 3D strip
{
  const NL = 5, tol = 1e-8, P = prog3DStrip(NL, 10, 30, tol), shares = [];
  const feed = pr => { prog3DStripFeed(P, pr); shares.push(P.share); };
  for (let l = 0; l < NL; l++) {
    feed({ stage: `2D at ${(l * 5 - 10).toFixed(1)} mm`, it: 0, residual: NaN });
    const solves = [];
    for (const lab of ['contact line at the edge: flow, surface frozen', 'contact line at the edge: surface and flow coupled']) {
      solves.push([lab, solves.length * 4]);
      for (let k = 0; k < 4; k++) feed({ stage: lab, it: k, residual: Math.pow(10, -8 * k / 3) * (k === 3 ? 0.5 : 1), add: [Math.pow(10, -8 * k / 3) * (k === 3 ? 0.5 : 1)], solves: solves.slice() });
    }
  }
  const before3 = P.share;
  feed({ stage: '3D: 5000 nodes', it: 0, residual: NaN });
  const at3 = P.share;
  for (let k = 0; k < 5; k++) feed({ stage: '3D: 5000 nodes', it: k, residual: Math.pow(10, -2 * k) * (k === 4 ? 0.5 : 1), r0: 1 });
  check('3D strip: never back; the stations\' share at the 3D\'s start; 100 % at the 3D\'s tolerance', mono(shares) && close(at3, 10 / 40, 1e-9) && before3 <= at3 && P.share === 1,
    `after the stations ${(100 * at3).toFixed(1)} % (their weight 10 of 40), at the end ${(100 * P.share).toFixed(0)} %`);
}

// 4. the full width
{
  const E = progSweeps([Infinity, 1e-2, 1e-3], 3, 1e-5, 12);
  check('full width: sweeps expected from how fast the change falls', E === 5 && progSweeps([Infinity], 1, 1e-5, 12) === PROG.sweeps && progSweeps([Infinity, 1e-3, 2e-3], 3, 1e-5, 12) === 12 && progSweeps([Infinity, 1e-2, 1e-3], 11, 1e-5, 12) === 12,
    `a change falling 10 times a sweep, at 1e-3 after 3 sweeps, 1e-5 wanted: ${E} sweeps in all`);
  const P = prog3DWide({ n2: 8, nStrips: 6, t2: 20, ts1: 40, ts: 24, tolSweep: 1e-5, maxSweeps: 12, tol: 1e-8 }), shares = [];
  const step = () => { prog3DWideShare(P); shares.push(P.share); };
  for (let w = 0; w < 2; w++) for (let s = 0; s < 4; s++) { P.stations.set(w, progStation(1e-8, 'st')); P.stations.get(w).P.share = 0.3; step(); P.stations.get(w).P.share = 0.35; step(); P.stations.delete(w); P.done2++; step(); }
  let ch = 1e-1;
  for (let sw = 0; sw < 5; sw++) {
    for (let i = 0; i < 6; i++) { P.strips.set(i, progSolve(1e-8, 's')); P.strips.get(i).f = 0.5; step(); P.strips.delete(i); P.doneS++; step(); }
    P.hist.push(sw ? ch : Infinity); P.sweep++; P.doneS = 0; step(); ch /= 10;
  }
  check('full width: the share never back, below 100 % until done', mono(shares) && P.share < 1 && P.share > 0.9, `${shares.filter((_, k) => k % 6 === 0).map(v => Math.round(100 * v)).join(' ')} %, last ${(100 * P.share).toFixed(1)} %`);
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
