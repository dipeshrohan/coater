/*
 * cfd-shapes.validate.js — checks of the coating-flow solver (cfd-fem.js) on shaped blades (cfd-blade.js):
 * run with `node cfd-shapes.validate.js`.
 *  1. No flow, exact Young-Laplace: the contact line on the face above a bevel, on the bevel itself, on an
 *     edge radius's arc (the local face angle sets the contact direction), and pinned at the bevel's top
 *     corner (the surface's angle there from the first integral, inside Gibbs' range).
 *  2. With flow, each place the contact line can be: on the bevel at the contact angle (full model); the
 *     simple model keeping the bevel wetted; pinned at the bevel's top; on the arc; on the face of a
 *     two-step and a wedge. Mass conserved, the contact angle met, Gibbs' range kept.
 *  3. A bevel in line with the face (no corner at its top) gives the flat land's answer: the new mesh and
 *     strategy against the old (the round entry and flat land's, unchanged).
 *  4. Mesh refinement: film and contact line converge on a bevel, an arc and a two-step with a vertical riser.
 *  5. Zones and adapted meshes on shaped blades: zones refine; an adapted mesh gives its element ends back.
 *  6. One adaptive step (cfd-accuracy.js) on shaped blades, the fixed part of the face split too: it solves,
 *     keeps its corners as element ends, and moves the film little.
 */
const gap = require('./cfd-gap-solver.js');
global.bandFactor = gap.bandFactor;
global.bandSolve = gap.bandSolve;
const N = require('./cfd-fem.js'), B = require('./cfd-blade.js');

let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rho = 1020, g = 9.81, gamma = 0.07, Lcap = Math.sqrt(gamma / (rho * g)), H = 1.7e-3, D = 180 / Math.PI;
const solve = (spec, contact, { U = 0.1, f = 1, model = 'full', fInf = 1.2e-3, extra = {} } = {}) => {
  const prof = B.bladeProfile({ H, faceLen: 8e-3, ...spec });
  const r = N.solveCoaterFEM({ hFn: prof.hUnder, xe: prof.xe, faceDeg: spec.exitDeg, contactDeg: contact, U, Pup: U ? 0 : rho * g * fInf, rho, g, gamma, mu: () => 1, Ld: 12e-3,
    nEb: Math.round(10 * f), nEf: Math.round(6 * f), nEs: Math.round(24 * f), nEy: Math.round(6 * f), fInfGuess: U ? 0.5 * H : fInf, profile: prof, clModel: model, ...extra });
  const gr = r.error ? null : N.coaterGrid(r, { xe: prof.xe, H, faceDeg: spec.exitDeg, contactDeg: contact, U });
  return { r, prof, gr };
};
const bevel = (b, beta, face = 90) => ({ shape: 'bevel', L: 5e-3, bevelDeg: beta, bevelLen: b, exitDeg: face });

// 1. no flow
console.log('\n1. No flow: the contact line against exact Young-Laplace');
{
  const fInf = 1.2e-3;
  const exactCase = (label, spec, contact, want) => {
    const { r, prof } = solve(spec, contact, { U: 0 });
    if (r.error) return check(label, false, r.error);
    const s = r.surface.s, y = prof.face.P(s)[1], th = prof.face.th(s) * D, fEnd = r.y[(r.NC - 1) * r.NR + r.NR - 1];
    const hc = 2 * Lcap * Math.sin((180 - contact - th) / 2 / D), exact = fInf + Math.hypot(hc, fEnd - fInf), err = (y - exact) / hc;
    check(label, r.converged && r.meniscus.mode === 'climbed' && r.meniscus.k === want && Math.abs(err) < 2e-3 && Math.abs(r.meniscus.leaveDeg - (contact + th - 180)) < 0.01,
      `contact line ${(y * 1e3).toFixed(4)} mm above the web vs exact ${(exact * 1e3).toFixed(4)} (${(err * 100).toFixed(3)} % of the climb), the face there at ${th.toFixed(2)}°`);
  };
  exactCase('above a 45° bevel (0.5 mm), contact 35°: on the face above its top', bevel(0.5e-3, 45), 35, 1);
  exactCase('on a 45° bevel (4 mm), contact 70°', bevel(4e-3, 45), 70, 0);
  exactCase('on an edge radius of 2 mm, contact 60°: on the arc', { shape: 'radius', L: 5e-3, r: 2e-3, exitDeg: 90 }, 60, 0);
  const { r } = solve(bevel(0.5e-3, 45, 150), 35, { U: 0 });
  const yC = H + 0.5e-3 * Math.SQRT1_2, fEnd = r.y[(r.NC - 1) * r.NR + r.NR - 1];
  const psi = -Math.acos(1 - ((yC - fInf) ** 2 - (fEnd - fInf) ** 2) / (2 * Lcap * Lcap)) * D;
  check('pinned at the top of a 45° bevel (face 150° above it)', r.converged && r.meniscus.mode === 'pinned' && r.meniscus.k === 1 && Math.abs(r.meniscus.leaveDeg - psi) < 0.05 && psi > 35 + 45 - 180 && psi < 35 + 150 - 180,
    `surface leaves at ${r.meniscus.leaveDeg.toFixed(3)}° vs exact ${psi.toFixed(3)}° (Gibbs: -100° .. 5°)`);
}

// 2. with flow
console.log('\n2. With flow (web 0.1 m/s, 1 Pa s): where the contact line settles');
const flow = {};
{
  const say = (key, label, o, want, contactAt) => {
    flow[key] = o;
    const { r, gr, prof } = o;
    if (r.error) return check(label, false, r.error);
    const m = r.meniscus, s = r.surface.s, th = prof.face.th(s) * D;
    const angleOk = m.mode === 'climbed' ? Math.abs(m.leaveDeg - (contactAt + th - 180)) < 0.01 : true;
    check(label, r.converged && m.mode === want.mode && m.k === want.k && angleOk && Math.abs(gr.massError) < 2e-4 && (!want.check || want.check(r)),
      `${m.mode} at ${m.k ? `corner ${m.k}` : 'M'}${m.mode === 'climbed' ? ` + ${((s - (m.k ? prof.faceCorners[m.k].s : 0)) * 1e3).toFixed(3)} mm` : ''}, surface leaves at ${m.leaveDeg.toFixed(3)}°, film ${(r.Q / 0.1 * 1e3).toFixed(5)} mm, mass ${gr.massError.toExponential(1)}${m.note ? `; ${m.note}` : ''}`);
  };
  say('bev', 'on a 45° bevel (1 mm), contact 70°: at the contact angle to the bevel', solve(bevel(1e-3, 45), 70), { mode: 'climbed', k: 0 }, 70);
  const lo = 70 + 45 - 180;
  say('bevS', '  the simple model: the bevel kept wetted, pinned at its top (the surface would pull back)', solve(bevel(1e-3, 45), 70, { model: 'simple' }), { mode: 'pinned', k: 1, check: r => r.meniscus.leaveDeg < lo && /simple model/.test(r.meniscus.note) }, 70);
  say('pinC', 'a 45° bevel (0.3 mm) under a face at 150°, contact 35°: pinned at its top', solve(bevel(0.3e-3, 45, 150), 35), { mode: 'pinned', k: 1, check: r => r.meniscus.leaveDeg > 35 + 45 - 180 && r.meniscus.leaveDeg < 35 + 150 - 180 }, 35);
  say('arc', 'an edge radius of 1 mm, contact 60°: on the arc', solve({ shape: 'radius', L: 5e-3, r: 1e-3, exitDeg: 90 }, 60), { mode: 'climbed', k: 0, check: r => r.surface.s < 0.5 * Math.PI * 1e-3 }, 60);
  say('step', 'a two-step with a vertical riser (0.5 mm): up the face', solve({ shape: 'twostep', land1: 3e-3, stepH: 0.5e-3, riserDeg: 90, L: 3e-3, exitDeg: 90 }, 35), { mode: 'climbed', k: 0 }, 35);
  say('wedge', 'a wedge (inlet gap 2.5 mm): up the face', solve({ shape: 'wedge', L: 5e-3, inletGap: 2.5e-3, exitDeg: 90 }, 35), { mode: 'climbed', k: 0 }, 35);
  const f2 = flow.bev.r.Q, fs = flow.bevS.r.Q;
  check('  the two models differ where they should (film)', Math.abs(fs / f2 - 1) > 1e-3, `full ${(f2 / 0.1 * 1e3).toFixed(5)} mm, simple ${(fs / 0.1 * 1e3).toFixed(5)} mm`);
}

// 3. the new code path against the old
console.log('\n3. A bevel in line with the face = the flat land (the old code path)');
{
  const a = solve(bevel(1e-3, 90), 35).r;
  const prof = B.bladeProfile({ H, faceLen: 8e-3, shape: 'flat', L: 5e-3, exitDeg: 90 });
  const b = N.solveCoaterFEM({ hFn: prof.hUnder, xe: prof.xe, faceDeg: 90, contactDeg: 35, U: 0.1, Pup: 0, rho, g, gamma, mu: () => 1, Ld: 12e-3, nEb: 10, nEf: 6, nEs: 24, nEy: 6, fInfGuess: 0.5 * H });
  const dF = a.Q / b.Q - 1, dS = a.surface.s / b.surface.s - 1;
  check('film and contact line agree', !a.error && !b.error && Math.abs(dF) < 1e-4 && Math.abs(dS) < 0.02 && a.meniscus.mode === b.meniscus.mode,
    `film ${(a.Q / 0.1 * 1e3).toFixed(5)} vs ${(b.Q / 0.1 * 1e3).toFixed(5)} mm (${(dF * 100).toFixed(4)} %), contact line ${(a.surface.s * 1e3).toFixed(4)} vs ${(b.surface.s * 1e3).toFixed(4)} mm`);
}

// 4. mesh refinement
console.log('\n4. Mesh refinement (x1, x1.5, x2)');
{
  for (const [label, spec, contact] of [['on a 45° bevel', bevel(1e-3, 45), 70], ['on an edge radius', { shape: 'radius', L: 5e-3, r: 1e-3, exitDeg: 90 }, 60], ['two-step, vertical riser', { shape: 'twostep', land1: 3e-3, stepH: 0.5e-3, riserDeg: 90, L: 3e-3, exitDeg: 90 }, 35]]) {
    const rs = [1, 1.5, 2].map(f => solve(spec, contact, { f }).r);
    if (rs.some(r => r.error)) { check(label, false, rs.map(r => r.error).join(' | ')); continue; }
    const F = rs.map(r => r.Q), S = rs.map(r => r.surface.s), dF1 = Math.abs(F[1] / F[0] - 1), dF2 = Math.abs(F[2] / F[1] - 1), dS2 = Math.abs(S[2] / S[1] - 1);
    check(`${label}: film within 0.1 %, contact line within 5 % from x1.5 to x2`, dF2 < 1e-3 && dS2 < 0.05 && rs.every(r => r.meniscus.mode === rs[0].meniscus.mode && r.meniscus.k === rs[0].meniscus.k),
      `film ${F.map(v => (v / 0.1 * 1e3).toFixed(6)).join(', ')} mm (changes ${(dF1 * 100).toFixed(3)} %, ${(dF2 * 100).toFixed(3)} %); contact line ${S.map(v => (v * 1e3).toFixed(4)).join(', ')} mm`);
  }
}

// 5. zones and adapted meshes
console.log('\n5. Zones and adapted meshes');
{
  const same = (p, q) => !p === !q && (!p || (p.length === q.length && p.every((v, i) => Math.abs(v - q[i]) < 1e-12)));
  for (const [label, spec, contact] of [['pinned at a bevel\'s top', bevel(0.3e-3, 45, 150), 35], ['two-step', { shape: 'twostep', land1: 3e-3, stepH: 0.5e-3, riserDeg: 90, L: 3e-3, exitDeg: 90 }, 35]]) {
    const base = solve(spec, contact).r;
    const z = solve(spec, contact, { extra: { meshZones: { edge: 0.1e-3, cl: 0.05e-3, web: { n: 3, first: 0.05e-3, growth: 1.3 }, bands: [{ x0: 2.5e-3, x1: 3.5e-3, size: 0.2e-3 }], growth: 1.2 } } }).r;
    const fr = z.meshInfo.frac, a = solve(spec, contact, { extra: { meshFrac: fr } }).r;
    const back = ['b', 'f', 'fk', 's', 'y'].every(k => same(fr[k], a.meshInfo.frac[k]));
    check(`${label}: zones refine; an adapted mesh gives its ends back and the same answer (a climbing contact line: within 0.01 %, its layout follows where it settles)`, !z.error && !a.error && z.NC > base.NC && z.NR > base.NR && back && Math.abs(a.Q / z.Q - 1) < 1e-4,
      `${base.NC}x${base.NR} -> ${z.NC}x${z.NR}; film ${(z.Q / 0.1 * 1e3).toFixed(6)} vs ${(a.Q / 0.1 * 1e3).toFixed(6)} mm`);
  }
}

// 6. one adaptive step
console.log('\n6. One adaptive step (mesh to an accuracy)');
{
  const { accIndicator, accRefine } = require('./cfd-accuracy.js');
  for (const [label, spec, contact] of [['pinned at a bevel\'s top', bevel(0.3e-3, 45, 150), 35], ['on a 45° bevel', bevel(1e-3, 45), 70], ['two-step', { shape: 'twostep', land1: 3e-3, stepH: 0.5e-3, riserDeg: 90, L: 3e-3, exitDeg: 90 }, 35]]) {
    const a = solve(spec, contact), ref = accRefine(a.gr.mesh.frac, accIndicator(a.gr));
    const b = solve(spec, contact, { extra: { meshFrac: ref.frac } });
    const kept = ['b', 'f', 'fk', 's', 'y'].every(k => !ref.frac[k] || ref.frac[k].every((v, i) => Math.abs(v - b.r.meshInfo.frac[k][i]) < 1e-12) && ref.frac[k].length === b.r.meshInfo.frac[k].length);
    const cornersKept = !a.r.meshInfo.frac.fk || a.r.meshInfo.frac.fk.every(v => ref.frac.fk.some(w => Math.abs(v - w) < 1e-15));
    const d = b.r.Q / a.r.Q - 1;
    check(`${label}: ${ref.cols} columns and ${ref.rows} rows split; solves, its ends kept (corners too), film moves ${(d * 100).toFixed(3)} %`, !b.r.error && b.r.converged && b.r.NC > a.r.NC && kept && cornersKept && Math.abs(d) < 5e-3 && b.r.meniscus.k === a.r.meniscus.k,
      `${a.r.NC}x${a.r.NR} -> ${b.r.NC}x${b.r.NR}`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
