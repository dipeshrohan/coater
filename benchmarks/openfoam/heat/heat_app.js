// The app's heat solvers on the benchmark stack, heat only: mp-core.js mpHeatMoisture (linear elements, nodal
// integration, BDF2 -- as the Pre heat and Drying stages call it) or, with "solver": "transport", mpTransport (as the
// Furnace stage calls it: lumped capacity, implicit Euler). Writes T at every element's centre at the
// output times. node heat_app.js <case.json> <out.json>
const fs = require('fs'), path = require('path');
const MP = require(path.join(__dirname, '../../../engine/mp-core.js'));
const C = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const dim = C.dim, L = C.layers, X = C.x, Z = C.z;
const seg = (a, f) => a.breaks.slice(1).map((b, i) => ({ L: b - a.breaks[i], n: Math.round(a.n[i] * f) }));
const f = C.refine || 1;
const axes = [seg(X, f), L.map(l => ({ L: l.t, n: Math.round(l.n * f) }))];
if (dim === 3) axes.push(seg(Z, f));
const M = MP.mpMesh({ dim, p: 1, axes, mat: (ijk, s) => s[1] });
// the heated patch (the faces are integrated at their Gauss points: none falls on the patch's edge, so the heated faces
// are exactly those of the patch)
const heated = x => x[0] < C.heat.x1 && (dim === 2 || x[2] < C.heat.z1);
const t0 = Date.now();
const bcT = [
  { face: 'y1', type: 'robin', h: x => (heated(x) ? C.heat.h : 0), uInf: () => C.heat.Tinf },
  { face: 'y0', type: 'robin', h: () => C.cool.h, uInf: () => C.cool.Tinf },
];
// the solver: 'heatMoisture' (default: the Pre heat and Drying stages' mpHeatMoisture, dry: heat only; BDF2) or
// 'transport' (the Furnace stage's mpTransport: lumped capacity, the conduction assembled once a step; implicit Euler)
const hm = C.solver === 'transport'
  ? (() => { const T = MP.mpTransport(M, { K: m => L[m].k, C: m => L[m].rho * L[m].cp, lump: true, Kstep: true, bc: bcT, u0: C.T0, theta: 1 }); return { get T() { return T.u; }, step: (t, h) => T.step(t, h) }; })()
  : MP.mpHeatMoisture(M, {
    kT: m => L[m].k, CT: m => L[m].rho * L[m].cp,
    Kv: () => 0, S: () => 0, L: 0, wet: () => false,
    T0: C.T0, p0: 0, bcT,
    iters: 40, tol: 1e-10, nodal: true, bdf2: true,
  });
// T at the element centres (the mean of a linear element's nodes is its value there)
const cen = () => {
  const out = [];
  for (let e = 0; e < M.E; e++) {
    let s = 0; for (let a = 0; a < M.npe; a++) s += hm.T[M.conn[e * M.npe + a]];
    const ijk = Array.from(M.eijk.subarray(e * dim, e * dim + dim)), xc = ijk.map((i, d) => (M.edges[d][i] + M.edges[d][i + 1]) / 2);
    out.push([...xc, s / M.npe]);
  }
  return out;
};
const snaps = {}; let t = 0;
for (const tout of C.times) {
  while (t < tout - 1e-9) { const h = Math.min(C.dt, tout - t); hm.step(t + h, h); t += h; }
  snaps[tout] = cen();
}
fs.writeFileSync(process.argv[3], JSON.stringify({ dim, refine: f, elements: M.E, nodes: M.N, ne: M.ne, snaps, ms: Date.now() - t0 }));
console.log(`app: ${dim}D, ${M.E} elements, ${M.N} nodes, ${(Date.now() - t0) / 1000}s`);
