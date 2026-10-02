// The app's solid solvers (mp-core.js: mpScalar for the heat, mpElastic for the stress -- linear elements, as the stages'
// stress meshes) on the stress benchmark's block: the temperature (steady), then the thermal stress (eigenstrain α T,
// plane strain in 2D). Writes T, the displacement and the stress at every element's centre.
// node stress_app.js <case.json> <out.json> [refine factor]
const fs = require('fs'), path = require('path');
const MP = require(path.join(__dirname, '../../../mp-core.js'));
const C = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), f = Number(process.argv[4] || 1);
const dim = C.dim, Lx = C.L[0], Lz = C.L[2];
const axes = [0, 1, 2].slice(0, dim).map(d => ({ L: C.L[d], n: Math.round(C.n[d] * f) }));
const M = MP.mpMesh({ dim, p: 1, axes });
const Ttop = x => C.dT * Math.sin(Math.PI * x[0] / Lx) * (dim === 3 ? Math.sin(Math.PI * x[2] / Lz) : 1);
const t0 = Date.now();
// the temperature: the bottom at 0 (the stress-free temperature), the top held at the sine, the sides insulated
const H = MP.mpScalar(M, { steady: true, K: () => C.k, bc: [{ face: 'y0', type: 'value', u: () => 0 }, { face: 'y1', type: 'value', u: x => Ttop(x) }] });
const T = H.u;
// the stress: clamped below, free elsewhere, the eigenstrain α T
const S = MP.mpElastic(M, {
  mats: [{ E: C.E, nu: C.nu }], plane: 'strain', fields: { T },
  eig: (m, x, fl) => { const e = C.alpha * fl.T; return [e, e, e, 0, 0, 0]; },
  bc: [{ face: 'y0', fix: dim === 2 ? [0, 1] : [0, 1, 2] }],
});
// at the element centres: T and the displacement the mean of the element's nodes (exact at the centre for linear
// elements on a box), the stress the mean of its Gauss points
const gpOf = new Map(); for (const g of S.gp) { if (!gpOf.has(g.e)) gpOf.set(g.e, []); gpOf.get(g.e).push(g.stress); }
const rows = [];
for (let e = 0; e < M.E; e++) {
  const nodes = Array.from(M.conn.subarray(e * M.npe, (e + 1) * M.npe));
  const xc = [0, 1, 2].slice(0, dim).map(d => nodes.reduce((s, n) => s + M.X[n * dim + d], 0) / M.npe);
  const Tc = nodes.reduce((s, n) => s + T[n], 0) / M.npe;
  const uc = [0, 1, 2].slice(0, dim).map(d => nodes.reduce((s, n) => s + S.u[n * dim + d], 0) / M.npe);
  const g = gpOf.get(e), sc = Array.from(g[0], (_, k) => g.reduce((s, v) => s + v[k], 0) / g.length);
  rows.push({ x: xc, T: Tc, u: uc, s: sc });
}
fs.writeFileSync(process.argv[3], JSON.stringify({ dim, refine: f, elements: M.E, rows, ms: Date.now() - t0 }));
console.log(`app: ${dim}D, ${M.E} elements, ${(Date.now() - t0) / 1000}s; max |u| ${Math.max(...S.u.map(Math.abs)).toExponential(3)} m`);
