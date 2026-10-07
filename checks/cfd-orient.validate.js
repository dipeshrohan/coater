/*
 * cfd-orient.validate.js — checks of the flakes' orientation along the 2D's flow (cfd-orient.js). Run: node cfd-orient.validate.js
 *  1. A Couette channel (every streamline in the same simple shear): with no diffusion each line's ensemble is the
 *     same ensemble turned in that shear for the line's own time (length / its speed), as orient.js alone gives it;
 *     with diffusion, starting steady, it stays steady (orient.js's steady state at that shear).
 *  2. At rest on the web: Folgar–Tucker keeps its orientation (no flow, no diffusion); Doi–Hess moves toward the
 *     Maier–Saupe order.
 *  3. The coating flow (the app's defaults, flat land and the round entry): the lines reach the inlet; the film
 *     leaves more aligned than it came (the flakes flat in the film's plane); the ensemble's size and the trace's
 *     step converged; the time it takes.
 *  4. Dried (GO-3): the film collapsing through its thickness flattens each flake exactly (a normal at α from the
 *     film's normal to tan α' = λ tan α; a trace in a cut to tan θ' = λ tan θ); from random, ⟨p_y²⟩ against its
 *     closed form; λ = 1 changes nothing; the coating flow's dried film flatter than at the oven.
 */
const O = require('../engine/orient.js');
const { orientAlong, orientRest, orientStart, orientFromGrid, orientCompact, orCollapse } = require('../engine/cfd-orient.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };

/** A Couette channel NC × NR: the web (y = 0) at U, the wall (y = H) still, length Lx; viscosity mu; the FEM result's fields. */
function couette(NC, NR, Lx, H, Uw, mu) {
  const N = NC * NR, f = () => new Float64Array(N), r = { NC, NR, x: f(), y: f(), u: f(), v: f(), psi: f(), mu: f(), tauXX: f(), tauXY: f(), tauYY: f(), omega: f(), gd: f() };
  const dudy = -Uw / H;
  for (let c = 0; c < NC; c++) for (let k = 0; k < NR; k++) {
    const n = c * NR + k, y = H * k / (NR - 1);
    r.x[n] = Lx * c / (NC - 1); r.y[n] = y; r.u[n] = Uw * (1 - y / H); r.psi[n] = Uw * (y - y * y / (2 * H));
    r.mu[n] = mu; r.tauXY[n] = mu * dudy; r.omega[n] = -dudy; r.gd[n] = Math.abs(dudy);
  }
  return r;
}
{
  const H = 1e-3, Lx = 20e-3, Uw = 5e-3, r = couette(41, 21, Lx, H, Uw, 10), g = Uw / H;
  const L = new Float64Array(9); L[1] = -g;
  const M = { kind: 'ft', beta: O.orBeta(0.2), Ci: 0 };
  const res = orientAlong(r, M, { nLines: 6, n: 400, seed: 3, start: 'random' });
  let worst = 0;
  res.lines.forEach((l, j) => {
    const y = l.yOut, u = Uw * (1 - y / H), t = Lx / u;
    const E = O.orEnsemble(400, O.orRng(3 + 7919 * j));
    O.orRun(E, L, t, M, O.orRng(1), { strain: 0.01 });
    const A = O.orA(E); for (let i = 0; i < 9; i++) worst = Math.max(worst, Math.abs(A[i] - l.out.A[i]));
  });
  check('Couette channel, no diffusion: each line = the same flakes turned in that shear for the line\'s own time', worst < 2e-3 && res.lines.every(l => l.how === 'inlet'), `worst ⟨pp⟩ difference ${worst.toExponential(1)}; times ${res.lines.map(l => l.tPath.toFixed(1)).join(', ')} s`);
  // with diffusion, starting steady: stays steady
  const M2 = { kind: 'ft', beta: O.orBeta(1e-3), Ci: 0.02 };
  const res2 = orientAlong(r, M2, { nLines: 4, n: 4000, seed: 5 });
  const st = O.orStats(O.orSteady(L, M2, { n: 16000, seed: 77 }).E).Sy;
  const d = Math.max(...res2.lines.map(l => Math.abs(l.out.Sy - st)));
  check('  with diffusion, starting steady: every line stays at the steady order of that shear (within the ensemble\'s scatter)', d < 0.03, `S_y ${res2.lines.map(l => l.out.Sy.toFixed(3)).join(', ')} vs ${st.toFixed(3)}`);
  // at rest on the web
  const res3 = orientAlong(r, M2, { nLines: 2, n: 1000, seed: 5, tRest: 100 });
  check('at rest on the web: Folgar–Tucker keeps its orientation (no flow, no diffusion)', res3.lines.every(l => l.out.A.every((a, i) => a === l.oven.A[i])));
  const Md = { kind: 'dh', beta: O.orBeta(1e-3), Dr: 0.5, U: 8 };
  const one = (L, j) => O.orSteady(L, Md, { n: 4000, seed: 5 + j, maxStretches: 6 }).E;
  const res4 = orientAlong(r, Md, { nLines: 2, n: 4000, seed: 5, tRest: 20, start: one });
  check('  Doi–Hess moves toward its own order at rest (U = 8: S about 0.83)', res4.lines.every(l => Math.abs(l.oven.S - 0.83) < 0.03), res4.lines.map(l => `${l.out.S.toFixed(3)} → ${l.oven.S.toFixed(3)}`).join(', '));
  // at rest it stops once settled: the rest of the time changes nothing but the finite ensemble's own slow drift of its
  // direction (its mean field is its own ⟨pp⟩: n flakes wander together, the slower the more there are; a real film's
  // direction does not move at rest): the same order, and the direction's difference from running all of it falls with n
  {
    const Mr = { kind: 'dh', beta: O.orBeta(1e-3), Dr: 0.1, U: 8 }, L = new Float64Array(9); L[1] = -0.4;
    const rows = [];
    for (const n of [1000, 4000, 16000]) {
      const E1 = O.orSteady(L, Mr, { n, seed: 21, maxStretches: 6 }).E, E2 = O.orCopy(E1);
      const ran = orientRest([E1], 100, Mr, O.orRng(22));
      O.orRun(E2, new Float64Array(9), 100, Mr, O.orRng(23));
      const a = O.orStats(E1), b = O.orStats(E2), c = Math.abs(a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2]);
      rows.push({ n, ran, dS: Math.abs(a.S - b.S), ang: Math.acos(Math.min(1, c)) * 180 / Math.PI, S: a.S });
    }
    check('  it stops once settled at rest: the same order as running all 100 s; the direction apart only by the finite ensemble\'s drift (falls with n)',
      rows.every(x => x.dS < 0.01 && x.ran < 100) && rows[2].ang < rows[0].ang / 2,
      rows.map(x => `n ${x.n}: S ${x.S.toFixed(3)} (±${x.dS.toFixed(3)}), direction ${x.ang.toFixed(1)}° apart, ran ${x.ran.toFixed(1)} s`).join('; '));
  }
}
// the start where a line enters (orientStart)
{
  const shear = g => { const L = new Float64Array(9); L[1] = -g; return L; };
  // Folgar–Tucker and Doi–Hess below U = 5: one group, orient.js's steady state
  const Mf = { kind: 'ft', beta: O.orBeta(2e-4), Ci: 0.01 }, Mp = { kind: 'dh', beta: O.orBeta(2e-4), Dr: 0.1, U: 4 };
  const sf = orientStart(shear(1), Mf, 1000, 3, O.orRng(4)), sp = orientStart(shear(1), Mp, 1000, 3, O.orRng(4));
  const ref = O.orSteady(shear(1), Mf, { n: 1000, seed: 3 }).E;
  check('the start: Folgar–Tucker and Doi–Hess below U = 5 settle; one group, the steady state', sf.groups === 1 && sp.groups === 1 && !sf.turning && !sp.turning && sf.Es[0].p.every((v, i) => v === ref.p[i]) && sp.settled,
    `Doi–Hess U 4: S ${O.orStats(sp.Es[0]).S.toFixed(3)}`);
  // Doi–Hess above 5 in a slow shear: it keeps turning
  const Md = { kind: 'dh', beta: O.orBeta(2e-4), Dr: 0.1, U: 8 };
  const meanA = Es => { const m = new Float64Array(9); Es.forEach(E => O.orA(E).forEach((v, i) => m[i] += v / Es.length)); return m; };
  const dmax = (a, b) => Math.max(...Array.from(a).map((v, i) => Math.abs(v - b[i])));
  // the groups (one turn of one set of 1000 flakes) vary from set to set as the turns do: their mean over 4 sets = the
  // same with 4000 flakes averaged over their first turn (4 sets) within 0.03, each set within 0.06
  const firstTurn = (g, seed, n, dS) => {
    const L = shear(g), E = O.orSteady(L, Md, { n, seed, maxStretches: 6 }).E, rng = O.orRng(seed + 50);
    const m = new Float64Array(9); let prev = O.orStats(E).n, phi = 0, k = 0;
    while (Math.abs(phi) < Math.PI && k < 4000) {
      O.orRun(E, L, dS / g, Md, rng); k++; const st = O.orStats(E); let nv = st.n;
      if (nv[0] * prev[0] + nv[1] * prev[1] + nv[2] * prev[2] < 0) nv = nv.map(x => -x);
      phi += Math.atan2(prev[0] * nv[1] - prev[1] * nv[0], prev[0] * nv[0] + prev[1] * nv[1] + prev[2] * nv[2]); prev = nv;
      st.A.forEach((v, i) => m[i] += v);
    }
    return { A: m.map(v => v / k), T: k * dS };
  };
  for (const Pe of [2, 5, 10]) {
    const sets = [11, 12, 13, 14].map(sd => orientStart(shear(Pe * 0.1), Md, 1000, sd, O.orRng(sd + 50)));
    const each = sets.map(st => meanA(st.Es)), avg = new Float64Array(9); each.forEach(a => a.forEach((v, i) => avg[i] += v / each.length));
    const refs = [31, 32, 33, 34].map(sd => firstTurn(Pe * 0.1, sd, 4000, 0.1)), ref = new Float64Array(9); refs.forEach(x => x.A.forEach((v, i) => ref[i] += v / refs.length));
    const d = dmax(avg, ref), worst = Math.max(...each.map(a => dmax(a, ref)));
    check(`  Doi–Hess U 8, shear ${Pe} D_r: it keeps turning; 12 groups over one turn: 4 sets' mean = 4000 flakes over their first turn within 0.03, each within 0.06`,
      sets.every(st => st.turning && st.groups === 12 && st.Es.every(E => E.n === 1000)) && d < 0.03 && worst < 0.06,
      `turn ${sets.map(st => st.turn).join(', ')} strain units (4000: ${refs.map(x => x.T.toFixed(1)).join(', ')}); ⟨pp⟩ mean within ${d.toFixed(3)}, each within ${worst.toFixed(3)}: yy ${avg[4].toFixed(3)} (${ref[4].toFixed(3)}), xx ${avg[0].toFixed(3)} (${ref[0].toFixed(3)}), zz ${avg[8].toFixed(3)} (${ref[8].toFixed(3)})`);
  }
  // fast shear: it lines up with the flow and stays (no turn): the groups = its steady state
  {
    const g = 60 * 0.1, st = orientStart(shear(g), Md, 1000, 11, O.orRng(12));
    const L = shear(g), E = O.orSteady(L, Md, { n: 4000, seed: 41 }).E, rng = O.orRng(42), m = new Float64Array(9);
    for (let k = 0; k < 40; k++) { O.orRun(E, L, 2 / g, Md, rng); O.orA(E).forEach((v, i) => m[i] += v / 40); }
    const d = dmax(meanA(st.Es), m);
    check('  Doi–Hess U 8, shear 60 D_r: no turn (lined up with the flow): one group, the steady state within 0.03', !st.turning && st.groups === 1 && d < 0.03, `⟨pp⟩ within ${d.toFixed(3)}: yy ${meanA(st.Es)[4].toFixed(3)} (${m[4].toFixed(3)})`);
  }
  // near the turning's edge (shear 20 D_r) it rocks without turning over: 12 groups over the window; their mean = 4000 flakes
  // over the same 60 strain units within 0.03; lined up at 60 D_r its wandering is its own scatter (one group, above)
  {
    const g = 20 * 0.1, sets = [21, 22].map(sd => orientStart(shear(g), Md, 1000, sd, O.orRng(sd + 50)));
    const L = shear(g), E = O.orSteady(L, Md, { n: 4000, seed: 51, maxStretches: 6 }).E, rng = O.orRng(52), m = new Float64Array(9);
    for (let k = 0; k < 240; k++) { O.orRun(E, L, 0.25 / g, Md, rng); O.orA(E).forEach((v, i) => m[i] += v / 240); }
    const d = Math.max(...sets.map(st => dmax(meanA(st.Es), m)));
    check('  Doi–Hess U 8, shear 20 D_r: it rocks without turning over (its ⟨pp⟩ wanders far beyond its scatter): 12 groups over the window, their mean = 4000 flakes over it within 0.03',
      sets.every(st => !st.turning && st.groups === 12) && d < 0.03, `⟨pp⟩ within ${d.toFixed(3)}: yy ${meanA(sets[0].Es)[4].toFixed(3)} (${m[4].toFixed(3)})`);
  }
  // below the floor (shear 2 D_r) the turn is taken at the floor: the same start as at 2 D_r
  {
    const L0 = shear(0.05), Lf = L0.map(v => v * (2 * 0.1) / O.orGammaDot(L0));
    const a = orientStart(L0, Md, 1000, 11, O.orRng(12)), b = orientStart(Lf, Md, 1000, 11, O.orRng(12));
    check('  below a shear of 2 D_r: taken at 2 D_r (the same groups)', a.Es.every((E, k) => E.p.every((v, i) => v === b.Es[k].p[i])) && a.turn === b.turn, `turn ${a.turn} strain units`);
  }
}
// dried: the film's collapse
{
  const lam = 0.4 / 0.85, rng = O.orRng(5), E = O.orEnsemble(20000, rng), Ed = orCollapse(E, lam);
  // each normal: in the (x, y) plane at α from y it goes to tan α' = λ tan α; in general (x, y / λ, z) renormalised
  let worst = 0, worstT = 0;
  const md = O.orTraces(E, 'md'), mdD = O.orTraces(Ed, 'md');
  for (let k = 0; k < E.n; k++) {
    const x = E.p[3 * k], y = E.p[3 * k + 1], z = E.p[3 * k + 2], s = Math.hypot(x, y / lam, z);
    worst = Math.max(worst, Math.abs(Ed.p[3 * k] - x / s), Math.abs(Ed.p[3 * k + 1] - y / lam / s), Math.abs(Ed.p[3 * k + 2] - z / s));
  }
  md.angles.forEach((a, i) => { const want = Math.atan(lam * Math.tan(a * Math.PI / 180)) * 180 / Math.PI; worstT = Math.max(worstT, Math.abs(mdD.angles[i] - want)); });
  // from random: ⟨p_y²⟩ = (1 + a)/a (1 − atan(√a)/√a), a = 1/λ² − 1
  const a = 1 / (lam * lam) - 1, want = (1 + a) / a * (1 - Math.atan(Math.sqrt(a)) / Math.sqrt(a));
  let m = 0, m2 = 0; for (let k = 0; k < Ed.n; k++) { const v = Ed.p[3 * k + 1] ** 2; m += v; m2 += v * v; }
  m /= Ed.n; const se = Math.sqrt((m2 / Ed.n - m * m) / Ed.n);
  const same = orCollapse(E, 1).p.every((v, i) => Math.abs(v - E.p[i]) < 1e-15);
  check('dried: each flake flattened exactly (normals, and traces in a cut tan θ\' = λ tan θ); from random, ⟨p_y²⟩ within 3 standard errors of its closed form; λ = 1 nothing',
    worst < 1e-15 && worstT < 1e-9 && Math.abs(m - want) < 3 * se && same, `λ ${lam.toFixed(4)}: ⟨p_y²⟩ ${m.toFixed(4)} vs ${want.toFixed(4)} (±${se.toExponential(1)}), 1/3 before`);
}
// the coating flow
{
  const gap = require('../engine/cfd-gap-solver.js');
  Object.assign(globalThis, { bandFactor: gap.bandFactor, bandSolve: gap.bandSolve });
  const S0 = require('../engine/cfd-solver.js'), FEM = require('../engine/cfd-fem.js');
  Object.assign(globalThis, { muEffLocal: S0.muEffLocal, shearRateFromStress: S0.shearRateFromStress });
  const { bladeShape } = require('../engine/cfd-1d.js');
  const U = 0.28 / 60, mu = gd => S0.muEffLocal(gd, 10.5, 5, 1);
  const cases = [
    ['flat land', { hFn: () => 1.7e-3, xe: 10e-3, nEb: 12, fInfGuess: 1.45e-3 }, 1.7e-3],
    ['round entry', (() => { const sh = bladeShape({ geometry: 'round', H: 1.7149e-3, R: 0.1, Xup: 0.04 }); return { hFn: sh.h, xe: sh.Lx, nEb: 39, gradeB: 1.6, gradeS: 1.4, gradeY: 1.5, fInfGuess: 1.6e-3 }; })(), 1.7149e-3],
  ];
  for (const [name, f2, H] of cases) {
    const fo = { ...f2, faceDeg: 90, contactDeg: 35, U, Pup: 720, rho: 1360, g: 9.81, gamma: 0.07, mu, gdMin: 1e-3 * U / H, Ld: Math.max(12e-3, 8 * H), nEf: 6, nEs: 24, nEy: 6 };
    const r = FEM.solveCoaterFEM(fo);
    for (const M of [{ kind: 'ft', beta: O.orBeta(1e-3 / 5), Ci: 0.01 }, { kind: 'dh', beta: O.orBeta(1e-3 / 5), Dr: 0.025, U: 8 }]) {
      const t0 = Date.now(), a = orientAlong(r, M, { nLines: 24, n: 1000, seed: 1, tRest: 100, collapse: 0.4 / 0.85 }), ta = Date.now() - t0;
      const b = orientAlong(r, M, { nLines: 24, n: 4000, seed: 2, tRest: 100 }), c = orientAlong(r, M, { nLines: 24, n: 1000, seed: 1, tRest: 100, h: 0.125 });
      const sIn = a.lines.reduce((s, l) => s + l.start.Sy, 0) / a.lines.length;
      if (M.kind === 'ft') {
        // redone later on the stored result (the app's grid, cfd-fem.js's coaterGrid): the fields back exactly, the same alignment
        const g = FEM.coaterGrid(r, { xe: f2.xe, H, faceDeg: 90, contactDeg: 35, U }), rb = orientFromGrid(g);
        const same = ['x', 'y', 'u', 'v', 'psi', 'mu', 'tauXX', 'tauXY', 'tauYY', 'omega'].every(k => rb[k].every((v, i) => v === r[k][i]));
        const a2 = orientAlong(rb, M, { nLines: 24, n: 1000, seed: 1, tRest: 100, collapse: 0.4 / 0.85 });
        check('  redone from the stored result\'s grid: the flow\'s fields back exactly, the same alignment', same && rb.NC === r.NC && rb.NR === r.NR && JSON.stringify(a2.film) === JSON.stringify(a.film), `${r.NC} × ${r.NR} nodes`);
      }
      check(`${name}, ${M.kind === 'ft' ? 'Folgar–Tucker' : 'Doi–Hess'}: every line traced to the inlet`, a.lines.every(l => l.how === 'inlet'),
        `S_y entering ${sIn.toFixed(3)}, leaving ${a.film.out.Sy.toFixed(3)} (director ${a.film.out.angle.toFixed(1)}° from the web's normal), at the oven ${a.film.oven.Sy.toFixed(3)}; cuts: along ${a.cuts.md.S2.toFixed(3)} (spread ${a.cuts.md.spread.toFixed(1)}°), across ${a.cuts.cd.S2.toFixed(3)} (${a.cuts.cd.spread.toFixed(1)}°); ${ta} ms, ${a.stats.steps} steps`);
      // dried: flatter than at the oven, both cuts more ordered; the compact result carries it
      const cmp = orientCompact(a);
      check('  dried (collapsed to 0.4 / 0.85 of its thickness): flatter than at the oven, both cuts more ordered, every line flatter; carried by the compact result',
        a.film.dried.Sy > a.film.oven.Sy && a.cuts.dried.md.S2 > a.cuts.md.S2 && a.cuts.dried.cd.S2 > a.cuts.cd.S2 && a.lines.every(l => l.dried.Sy >= l.oven.Sy - 1e-12)
          && cmp.film.dried && cmp.cuts.dried && cmp.lines.every(l => l.dried && l.mdD && l.cdD) && cmp.collapse > 0,
        `S_y at the oven ${a.film.oven.Sy.toFixed(3)} -> dried ${a.film.dried.Sy.toFixed(3)}; along ${a.cuts.md.S2.toFixed(3)} -> ${a.cuts.dried.md.S2.toFixed(3)} (spread ${a.cuts.md.spread.toFixed(1)}° -> ${a.cuts.dried.md.spread.toFixed(1)}°), across ${a.cuts.cd.S2.toFixed(3)} -> ${a.cuts.dried.cd.S2.toFixed(3)}`);
      check('  1000 flakes a line within 0.02 of 4000; the trace\'s step halved within 0.02', Math.abs(a.film.out.Sy - b.film.out.Sy) < 0.02 && Math.abs(a.film.out.Sy - c.film.out.Sy) < 0.02,
        `S_y ${a.film.out.Sy.toFixed(4)}, ${b.film.out.Sy.toFixed(4)} (4000), ${c.film.out.Sy.toFixed(4)} (half step)`);
      if (M.kind === 'ft' && name === 'flat land') {
        // mid-land the flow is simple shear (fully developed): Folgar–Tucker's steady state there does not depend on the
        // shear rate, so every line (it entered steady and has sheared since) = orient.js's steady state in simple shear
        // (the shear's sign flips across the gap's middle: S_y and |⟨xy⟩| compared)
        const L = new Float64Array(9); L[1] = -1;
        const st = O.orStats(O.orSteady(L, M, { n: 16000, seed: 9 }).E);
        let worst = 0;
        for (const l of a.lines) {
          const q = l.samples.reduce((b, x) => Math.abs(x.x - 5e-3) < Math.abs(b.x - 5e-3) ? x : b);
          worst = Math.max(worst, Math.abs((3 * q.A[4] - 1) / 2 - st.Sy), Math.abs(Math.abs(q.A[1]) - Math.abs(st.A[1])));
        }
        check('  mid-land (simple shear): every line at Folgar–Tucker\'s steady state in simple shear, within 0.04 (1000 flakes\' scatter)', worst < 0.04, `worst ${worst.toFixed(3)}; steady S_y ${st.Sy.toFixed(3)}, ⟨xy⟩ ${st.A[1].toFixed(3)}`);
      }
      if (M.kind === 'dh') {
        // where it keeps turning: the floor of the turn's shear (2 D_r) against 1 D_r: the film within 0.02
        const t1 = Date.now(), e = orientAlong(r, M, { nLines: 24, n: 1000, seed: 1, tRest: 100, peMin: 1 }), te = Date.now() - t1;
        const nt = a.lines.filter(l => l.start.turning).length, nb = a.lines.filter(l => l.start.gd < 2 * M.Dr).length;
        check('  Doi–Hess (U 8, D_r 0.025 1/s, the defaults): lines that keep turning start as 12 groups; the floor of the turn\'s shear at 1 D_r instead of 2: the film within 0.02',
          a.lines.every(l => !l.start.turning || l.start.groups === 12) && Math.abs(a.film.out.Sy - e.film.out.Sy) < 0.02 && Math.abs(a.film.oven.Sy - e.film.oven.Sy) < 0.02,
          `${nt} of 24 lines turning (${nb} below 2 D_r); S_y leaving ${a.film.out.Sy.toFixed(4)} vs ${e.film.out.Sy.toFixed(4)}, at the oven ${a.film.oven.Sy.toFixed(4)} vs ${e.film.oven.Sy.toFixed(4)}; ${te} ms`);
      }
    }
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
