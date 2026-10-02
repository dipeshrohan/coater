/*
 * feed-mesh.validate.js — checks of feed-mesh.js (the coater with its feed, meshed) against the geometry it is built from.
 * Run: node feed-mesh.validate.js
 *  1. The default coater (4 outlets, mirror symmetric: half the width, 2 pipes): every element valid; the volume the exact
 *     geometry's; each boundary's area its exact value (the web, the pipes' inlets, ends, inner and outer walls, the cut,
 *     the sides); the boundary closed (its outward normal integrates to zero); half the width with the mirror plane.
 *  2. Three outlets (one on the middle: the full width) and three placed unevenly (no mirror: the full width): the same.
 *  3. Refined at the edge: more elements, the same volume and areas.
 *  4. What the mesher refuses: a pipe that would cut into the blade, two squares overlapping, a square past a side wall,
 *     a mouth above the pile's surface.
 */
const F = require('./feed-mesh.js');
let fails = 0;
const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

const R = 0.1, g = 1.9e-3, bladeY = x => x <= -R ? Infinity : g + R - Math.sqrt(R * R - x * x);
const base = { W: 0.3, xCut: -0.13, xEnd: 0.015, bladeY, H0: 0.0367, film0: 1.55e-3, xP: -0.095, sq: 2, d: 0.01, t: 0.002 };
const even = N => Array.from({ length: N }, (_, i) => ({ z: base.W * (i + 0.5) / N, ym: 0.01 }));

/** Build, measure, and check one coater against its exact geometry. */
function coater(label, o) {
  const t0 = Date.now(), M = F.fmMesh(o), S = F.fmStats(M), ms = Date.now() - t0, I = M.info, nP = I.pipes.length;
  const V = F.fmVolumeExpected(o, M), A = S.area, rb = o.d / 2, ro = rb + o.t;
  const ex = {
    web: (o.xEnd - o.xCut) * I.Wend,
    pipeIn: nP * Math.PI * rb * rb,
    pipeEnd: nP * Math.PI * (ro * ro - rb * rb),
    pipeInner: I.pipes.reduce((s, q) => s + 2 * Math.PI * rb * (q.yIn - q.ym), 0),
    pipeOut: I.pipes.reduce((s, q) => s + 2 * Math.PI * ro * (o.H0 - q.ym), 0),
    cut: o.H0 * I.Wend,
  };
  const total = Object.values(A).reduce((s, v) => s + v, 0), clo = Math.hypot(...S.closure) / total;
  check(`${label}: every element valid (none inverted), its quality`, S.invalid === 0 && S.qMin > 0.2,
    `${S.elements} elements, ${S.unknowns} unknowns; quality worst ${S.qMin.toFixed(3)}, mean ${S.qMean.toFixed(3)}; built and measured in ${ms} ms`);
  check(`${label}: its volume the exact geometry's`, rel(S.volume, V) < 5e-5, `${(S.volume * 1e6).toFixed(4)} against ${(V * 1e6).toFixed(4)} cm³ (${(rel(S.volume, V) * 100).toExponential(1)} %)`);
  check(`${label}: the web's area exact; the cut's`, rel(A.web, ex.web) < 1e-12 && rel(A.cut, ex.cut) < 1e-12, `web ${(A.web * 1e6).toFixed(3)} mm², cut ${(A.cut * 1e6).toFixed(3)} mm²`);
  check(`${label}: the pipes' inlets, ends, inner and outer walls (the circles' exact areas)`,
    ['pipeIn', 'pipeEnd', 'pipeInner', 'pipeOut'].every(k => rel(A[k], ex[k]) < 1e-4),
    ['pipeIn', 'pipeEnd', 'pipeInner', 'pipeOut'].map(k => `${k} ${(rel(A[k], ex[k]) * 100).toExponential(1)} %`).join(', '));
  check(`${label}: the boundary closed (its normal integrates to zero)`, clo < 1e-12, `${clo.toExponential(1)} of its area`);
  return { M, S };
}

// 1. the default: 4 outlets, mirror symmetric -> half the width, 2 pipes
{
  const { M, S } = coater('4 outlets', { ...base, outlets: even(4) });
  check('4 outlets: half the width (the mirror plane in the middle), 2 pipes; the sides equal', M.info.half && M.info.pipes.length === 2 && rel(S.area.side0, S.area.sym) < 1e-12,
    `side wall ${(S.area.side0 * 1e6).toFixed(2)} mm², mirror plane ${(S.area.sym * 1e6).toFixed(2)} mm²`);
  // the pile meets the blade where its underside is at the pile's height
  check('the pile meets the blade where the blade is at the pile\'s height', Math.abs(bladeY(M.info.xJ) - base.H0) < 1e-12, `x = ${(M.info.xJ * 1000).toFixed(3)} mm`);
  const tags = new Set(M.faces.map(f => f.tag));
  check('every boundary named: web, pile, blade, film, cut, end, side wall, mirror, the pipes\' inlet, end, inner and outer walls',
    ['web', 'pile', 'blade', 'film', 'cut', 'end', 'side0', 'sym', 'pipeIn', 'pipeEnd', 'pipeInner', 'pipeOut'].every(t => tags.has(t)) && tags.size === 12, [...tags].join(' '));
}
// 2. three outlets: one on the middle -> the full width; and uneven
{
  const { M } = coater('3 outlets', { ...base, outlets: even(3) });
  check('3 outlets: the full width (one sits on the middle), 3 pipes, two side walls', !M.info.half && M.info.pipes.length === 3 && M.faces.some(f => f.tag === 'side1'));
  const { M: M2 } = coater('3 outlets placed unevenly', { ...base, outlets: [{ z: 0.05, ym: 0.008 }, { z: 0.12, ym: 0.012 }, { z: 0.24, ym: 0.01 }] });
  check('uneven outlets (and mouths at different heights): the full width', !M2.info.half && M2.info.pipes.length === 3);
}
// 3. refined at the edge
{
  const a = F.fmStats(F.fmMesh({ ...base, outlets: even(4) })), { S } = coater('refined at the edge (0.25 mm)', { ...base, outlets: even(4), hEdge: 0.25e-3 });
  check('refined: more elements, the same volume', S.elements > a.elements && rel(S.volume, a.volume) < 5e-5, `${a.elements} → ${S.elements} elements`);
}
// 3b. ending under the blade (the region beyond solved on its own): the end face under the blade, the volume exact
{
  const { M, S } = coater('ending 30 mm before the metering edge', { ...base, xEnd: -0.03, outlets: even(4) });
  const xs = M.faces.filter(f => f.tag === 'end'), hEnd = bladeY(-0.03);
  check('ending under the blade: its end face the blade\'s height there across the width; no film', xs.length > 0 && Math.abs(S.area.end - hEnd * M.info.Wend) < 1e-9 * S.area.end && !M.faces.some(f => f.tag === 'film'),
    `end ${(S.area.end * 1e6).toFixed(3)} mm² against ${(hEnd * M.info.Wend * 1e6).toFixed(3)}`);
}
// 4. what it refuses
{
  const refuse = (o, re) => { try { F.fmMesh(o); return false; } catch (e) { return re.test(e.message); } };
  check('refused: a pipe that would cut into the blade (80 mm before the edge, the blade at the pile\'s height at 75.8 mm)', refuse({ ...base, xP: -0.08, outlets: even(4) }, /in front of the blade/));
  check('refused: two outlets\' squares overlapping', refuse({ ...base, outlets: [{ z: 0.05, ym: 0.01 }, { z: 0.07, ym: 0.01 }, { z: 0.23, ym: 0.01 }, { z: 0.25, ym: 0.01 }] }, /overlap/));
  check('refused: a square past a side wall', refuse({ ...base, outlets: [{ z: 0.01, ym: 0.01 }, { z: 0.29, ym: 0.01 }] }, /past a side/));
  check('refused: a mouth above the pile\'s surface', refuse({ ...base, outlets: even(4).map(q => ({ ...q, ym: 0.05 })) }, /between the web and the pile/));
}
console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
