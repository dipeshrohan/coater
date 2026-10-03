/*
 * pooltet.js — the pool with its pipes in the paste on tetrahedra (MESH-T3): the app's P2–P1 finite elements
 * (feed-pool-tet.js, feed-fem.js) against OpenFOAM's simpleFoam (finite volumes) on the same tetrahedra, each split in 8 at
 * its edges' middles (so every node of the app's mesh is a point of OpenFOAM's, the curved walls' middles on the true
 * surface).
 *
 *   node pooltet.js make <case> [size (m), default 0.01] [processors, default 4] [across: elements across a bore, default 2]
 *       the app's solve (saved to <case>/app.json) and the OpenFOAM case
 *   bash runof.sh <case> <processors>
 *   node pooltet.js compare <case> [out.json] [hex,tet:0.007,...]
 *       u, v, w and p at every OpenFOAM cell centre against the app's there (its elements' own interpolation), by region
 *       (the pool, round the pipes, in the bores, under the blade); with the list, the app's other solves of the case as
 *       well (the block mesh as the Pool and feed page meshes it, other tetrahedra: tet:<size>[:<across>]), each against
 *       the same OpenFOAM cells; and OpenFOAM and each solve against Poiseuille's exact flow where the bores' is developed
 *
 * The case is feed-pool.validate.js's "tips in the paste in 3D": half the 300 mm pool (the middle a mirror), two pipes
 * (10 mm bore, 14 mm outside, tips 30 mm above the web, bores 60 mm) feeding 10 ml/s, 1.07 ml/s leaving at the pool edge,
 * a Newtonian paste of 10.5 Pa·s and 1360 kg/m³. Conditions:
 *
 *   | Patch                      | App                                   | OpenFOAM                                         |
 *   | web                        | moving at U                           | fixedValue (U, 0, 0)                             |
 *   | blade, side plate, pipes   | no slip                               | noSlip                                           |
 *   | the middle (z = W/2)       | mirror                                | symmetryPlane                                    |
 *   | back edge (the cut)        | no flow through it, no shear          | slip                                             |
 *   | top (a lid at the level)   | rising at ḣ through it, no shear      | fixedNormalSlip, (0, ḣ, 0), ḣ from its own area  |
 *   | bores' tops                | plug, the flow in exact               | fixedValue, the flow in exact on its own area    |
 *   | pool edge                  | the traction, −ρg(h − y)              | the app's velocity there (fixedValue, each face's|
 *   |                            |                                       | mean: the app's flow out);                       |
 *   |                            |                                       | the pressure's level from the app's mean         |
 *
 * Gravity is in the app's pressure: OpenFOAM's (without gravity, kinematic) times ρ is compared with p − ρg(h − y).
 */
const path = require('path'), fs = require('fs'), ROOT = path.join(__dirname, '..', '..');
const FT = require(path.join(ROOT, 'feed-pool-tet.js')), UC = require(path.join(ROOT, 'um-core.js')), UFE = require(path.join(ROOT, 'um-fe.js')), FF = require(path.join(ROOT, 'feed-fem.js'));

const R = 0.1, H = 1.725e-3, blade = x => H + R - Math.sqrt(Math.max(0, R * R - x * x)), rho = 1360, g = 9.81, U = 0.28 / 60, mu = 10.5;
const W = 0.3, xBack = 0.13, xEnd = 0.04, h = 0.0367, outlets = [37.5, 112.5, 187.5, 262.5].map(z => ({ x: -0.1, z: z / 1000 }));
const d = 0.01, Do = 0.014, tip = 0.03, bore = 6 * d, Qin = 20e-6 / 2, Qout = 2.14e-6 / 2;
const CASE = { W, half: true, xBack, xEnd, h, blade, U, rho, g, outlets, mu: () => mu, Qin, Qout, pulse: true, pipe: { d, Do, tip, bore } };

// (three lines for the figure: across the width 15 mm up, between the pipes and the back edge -- the cross-width flow w;
//  across the gap 50 mm before the edge -- u; and across the first pipe's bore 60 mm up, where its flow is developed -- v)
const LINES = { w: { c: 2, pts: Array.from({ length: 75 }, (_, i) => [-0.115, 0.015, 0.001 + 0.148 * i / 74]) },
  gap: { c: 0, pts: Array.from({ length: 41 }, (_, i) => [-0.05, blade(-0.05) * (i + 0.5) / 41, 0.075]) },
  bore: { c: 1, pts: Array.from({ length: 81 }, (_, i) => [-0.1 + (d / 2) * (i / 40 - 1) * 0.999, 0.06, 0.0375]) } };
const onLines = at => Object.fromEntries(Object.entries(LINES).map(([k, L]) => [k, L.pts.map(p => { const v = at(p); return v ? v[L.c] : null; })]));

const hdr = (cls, loc, obj) => `FoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       ${cls};\n    location    "${loc}";\n    object      ${obj};\n}\n\n`;
const write = (dir, rel, cls, body) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, hdr(cls, path.dirname(rel), path.basename(rel)) + body + '\n'); };
const vec = v => `(${v.map(x => +x.toPrecision(12)).join(' ')})`;

/** The app's P2 mesh as OpenFOAM's linear tetrahedra: each element's 8 (feed-fem.js's FF_TET_SUB), each face's 4. */
function split(M) {
  const cells = [], bfaces = [], FN = UFE.ufeElement('tet10').faces.map(f => f.nodes);
  for (let e = 0; e < M.nE; e++) for (const s of FF.FF_TET_SUB) cells.push({ t: UC.UM_TET, v: s.map(k => M.conn[10 * e + k]) });
  for (const F of M.faces) {
    const [a, b, c, ab, bc, ca] = FN[F.f].map(k => M.conn[10 * F.e + k]);
    for (const v of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) bfaces.push({ v, tag: F.tag });
  }
  return UC.umBuild({ X: M.X, Y: M.Y, Z: M.Z }, cells, bfaces, { side1: 'symmetryPlane', web: 'wall', blade: 'wall', side0: 'wall', 'pipe-wall': 'wall', 'pipe-end': 'wall', bore: 'wall' });
}

function make(dir, size, np, across = 2) {
  const t0 = Date.now(), r = FT.fptSolve({ ...CASE, mesh: { size, across, tol: 0.2e-3 }, solve: { tol: 1e-11 } });
  const M = r.M;
  console.log(`app: ${M.nE} P2 tetrahedra, ${r.S.nD} unknowns, Newton ${r.hist.length}, ${(Date.now() - t0) / 1000} s; flows (ml/s) ${JSON.stringify(Object.fromEntries(Object.entries(r.flows).map(([k, v]) => [k, +(v * 1e6).toFixed(6)])))}`);
  const Um = split(M), G = UC.umGeometry(Um), files = UC.umToFoam(Um);
  for (const [k, txt] of Object.entries(files)) { const f = path.join(dir, 'constant/polyMesh', k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, txt); }
  // (each patch's faces: their centres and areas)
  const patch = name => { const p = Um.patches.find(q => q.name === name); const out = []; for (let f = p.start; f < p.start + p.n; f++) out.push({ c: [G.fc[3 * f], G.fc[3 * f + 1], G.fc[3 * f + 2]], a: Math.hypot(G.fa[3 * f], G.fa[3 * f + 1], G.fa[3 * f + 2]) }); return out; };
  const aTop = patch('pile').reduce((s, f) => s + f.a, 0), aIn = patch('bore-inlet').reduce((s, f) => s + f.a, 0);
  const hdotOF = (Qin - Qout) / aTop, Vin = Qin / aIn;
  // (the pool edge: the app's velocity averaged over each face -- its edges' middles, exact for the quadratic it is on the
  //  flat edge -- so the flow out is the app's own)
  const X = FT.fptIndex(M), po = Um.patches.find(q => q.name === 'outlet'), outU = [];
  for (let f = po.start; f < po.start + po.n; f++) {
    const v = Array.from(Um.fV.subarray(Um.fOff[f], Um.fOff[f + 1]), i => [Um.X[i], Um.Y[i], Um.Z[i]]), s = [0, 0, 0];
    for (let k = 0; k < 3; k++) { const q = v[k].map((x, c) => (x + v[(k + 1) % 3][c]) / 2), at = FT.fptField(X, [r.u, r.v, r.w], q); if (!at) throw new Error('a point of the pool edge outside the app\'s mesh'); for (let c = 0; c < 3; c++) s[c] += at.v[c] / 3; }
    outU.push(s);
  }
  const Uin = outU.reduce((s, v, i) => s + v[0] * patch('outlet')[i].a, 0);
  console.log(`OpenFOAM: ${Um.nC} cells; top ${aTop.toFixed(6)} m² (rate ${(hdotOF * 1e3).toFixed(5)} mm/s; the app's ${(r.hdot * 1e3).toFixed(5)}), bores ${aIn.toExponential(4)} m² (${(Vin * 1e3).toFixed(4)} mm/s), the app's flow out through OpenFOAM's pool edge ${(Uin * 1e6).toFixed(5)} ml/s`);
  const wallU = 'type noSlip;', bc = {
    web: `type fixedValue; value uniform ${vec([U, 0, 0])};`, blade: wallU, side0: wallU, 'pipe-wall': wallU, 'pipe-end': wallU, bore: wallU,
    side1: 'type symmetryPlane;', inlet: 'type slip;', pile: `type fixedNormalSlip; fixedValue uniform ${vec([0, hdotOF, 0])}; value uniform (0 0 0);`,
    'bore-inlet': `type fixedValue; value uniform ${vec([0, -Vin, 0])};`, outlet: `type fixedValue; value nonuniform List<vector> ${outU.length}\n(\n${outU.map(vec).join('\n')}\n);` };
  const body = f => Um.patches.map(p => `    ${p.name}\n    {\n        ${f(p.name)}\n    }`).join('\n');
  write(dir, '0/U', 'volVectorField', `dimensions [0 1 -1 0 0 0 0];\ninternalField uniform (0 0 0);\nboundaryField\n{\n${body(n => bc[n])}\n}`);
  write(dir, '0/p', 'volScalarField', `dimensions [0 2 -2 0 0 0 0];\ninternalField uniform 0;\nboundaryField\n{\n${body(n => (n === 'side1' ? 'type symmetryPlane;' : 'type zeroGradient;'))}\n}`);
  write(dir, 'constant/transportProperties', 'dictionary', `transportModel Newtonian;\nnu ${mu / rho};`);
  write(dir, 'constant/turbulenceProperties', 'dictionary', 'simulationType laminar;');
  write(dir, 'system/controlDict', 'dictionary', 'application simpleFoam; startFrom latestTime; startTime 0; stopAt endTime; endTime 20000; deltaT 1;\nwriteControl timeStep; writeInterval 1000; purgeWrite 1; writeFormat ascii; writePrecision 12; timePrecision 6; runTimeModifiable true;');
  write(dir, 'system/fvSchemes', 'dictionary', 'ddtSchemes { default steadyState; }\ngradSchemes { default Gauss linear; }\ndivSchemes { default none; div(phi,U) bounded Gauss linearUpwind grad(U); div((nuEff*dev2(T(grad(U))))) Gauss linear; }\nlaplacianSchemes { default Gauss linear corrected; }\ninterpolationSchemes { default linear; }\nsnGradSchemes { default corrected; }');
  // (two non-orthogonal correctors and U relaxed to 0.7: with one and 0.9 the 3-across mesh's faces near 78° made SIMPLE
  //  diverge after 75 iterations. OpenFOAM's converged answer moves a little with U's relaxation -- its Rhie–Chow face
  //  fluxes carry it: on the 10 mm mesh 0.7 % of the largest speed at most -- so every case is made with these)
  write(dir, 'system/fvSolution', 'dictionary', 'solvers\n{\n    p { solver GAMG; smoother GaussSeidel; tolerance 1e-12; relTol 0.01; }\n    U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-14; relTol 0.01; }\n}\nSIMPLE { nNonOrthogonalCorrectors 2; consistent yes; pRefCell 0; pRefValue 0; residualControl { p 1e-9; U 1e-11; } }\nrelaxationFactors { equations { U 0.7; } fields { p 1; } }');
  write(dir, 'system/decomposeParDict', 'dictionary', `numberOfSubdomains ${np}; method simple; simpleCoeffs { n (${np} 1 1); delta 0.001; }`);
  // the app's fields at OpenFOAM's cell centres (the cell's own element: cells in the app's order, 8 to an element)
  const cells = [];
  for (let c = 0; c < Um.nC; c++) {
    const e = Math.floor(c / 8), P = [G.cc[3 * c], G.cc[3 * c + 1], G.cc[3 * c + 2]], xi = FT.fptLocal(M, e, P), N = UFE.ufeShape('tet10', xi).N;
    const at = f => { let s = 0; for (let a = 0; a < 10; a++) s += N[a] * f[M.conn[10 * e + a]]; return s; };
    cells.push([P[0], P[1], P[2], G.cv[c], at(r.u), at(r.v), at(r.w), at(r.p) - rho * g * (h - P[1])]);
  }
  const lines = onLines(P => { const f = FT.fptField(X, [r.u, r.v, r.w], P); return f && f.v; });
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ size, across, nE: M.nE, nD: r.S.nD, nC: Um.nC, flows: r.flows, hdot: r.hdot, hdotOF, cells, lines }));
}

/** The last time's internal field of U or p (ascii). */
function readField(dir, name) {
  const times = fs.readdirSync(dir).filter(t => /^\d+(\.\d+)?$/.test(t) && t !== '0').sort((a, b) => +a - +b), t = times[times.length - 1];
  const txt = fs.readFileSync(path.join(dir, t, name), 'utf8'), i = txt.indexOf('internalField'), j = txt.indexOf('(', txt.indexOf('>', i)), n = +txt.slice(txt.indexOf('>', i) + 1, j).trim();
  const body = txt.slice(j + 1, txt.indexOf('\n)', j)), nums = body.replace(/[()]/g, ' ').trim().split(/\s+/).map(Number);
  return { t, n, nums };
}

/** Another of the app's solves of the same case (hex: the block mesh as the Pool and feed page meshes it; tet:<size>) at
 *  OpenFOAM's cell centres: [u, v, w, p − ρg(h − y)] per cell (null where a centre is outside its mesh). */
function other(which, cells) {
  const t0 = Date.now();
  let r, at;
  if (which === 'hex') {
    const FP = require(path.join(ROOT, 'feed-pool.js')), PO = require(path.join(ROOT, 'feed-post.js'));
    r = FP.fplSolvePipes({ ...CASE, mesh: { m: 4, nLo: 4, nUp: 4, hFar: 0.02 }, solve: { tol: 1e-11 } });
    const p = FP.fplPressureAll(r.M, r.p), X = PO.fpIndex(r.M); at = P => { const f = PO.fpField(X, [r.u, r.v, r.w, p], P); return f && f.v; };
  } else {
    r = FT.fptSolve({ ...CASE, mesh: { size: +which.split(':')[1], across: +(which.split(':')[2] || 2), tol: 0.2e-3 }, solve: { tol: 1e-11 } });
    const X = FT.fptIndex(r.M); at = P => { const f = FT.fptField(X, [r.u, r.v, r.w, r.p], P); return f && f.v; };
  }
  const out = cells.map(c => { const v = at([c[0], c[1], c[2]]); return v ? [v[0], v[1], v[2], v[3] - rho * g * (h - c[1])] : null; }), lines = onLines(at);
  console.log(`${which}: ${r.M.nE} elements, ${r.S.nD} unknowns, ${((Date.now() - t0) / 1000).toFixed(0)} s; ${out.filter(v => !v).length} of ${cells.length} cell centres outside its mesh`);
  return { name: which === 'hex' ? `hexahedra (${r.M.nE} Q2–Q1)` : `tetrahedra ${(+which.split(':')[1] * 1e3).toFixed(0)} mm, ${+(10 / +(which.split(':')[2] || 2)).toFixed(1)} mm round the pipes (${r.M.nE} P2–P1)`, nE: r.M.nE, nD: r.S.nD, vals: out, lines };
}

function compare(dir, outFile, withList) {
  const A = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'))), Uf = readField(dir, 'U'), pf = readField(dir, 'p'), n = A.cells.length;
  if (Uf.n !== n || pf.n !== n) throw new Error('cell counts differ');
  const sols = [{ name: `tetrahedra ${(A.size * 1e3).toFixed(0)} mm, ${+(10 / (A.across || 2)).toFixed(1)} mm round the pipes (${A.nE} P2–P1, OpenFOAM's own)`, nE: A.nE, nD: A.nD, vals: A.cells.map(c => c.slice(4, 8)), lines: A.lines },
    ...(withList ? withList.split(',').map(w => other(w, A.cells)) : [])];
  // (the pressure's level: OpenFOAM's has none of its own here -- every boundary's velocity is given -- so each is compared
  //  about its volume mean, over the cells every solution reaches)
  const ok = A.cells.map((c, k) => sols.every(S => S.vals[k]));
  const mean = f => { let V = 0, m = 0; A.cells.forEach((c, k) => { if (ok[k]) { V += c[3]; m += c[3] * f(k); } }); return m / V; };
  const mO = mean(k => rho * pf.nums[k]);
  const rAx = c => Math.min(Math.hypot(c[0] + 0.1, c[2] - 0.0375), Math.hypot(c[0] + 0.1, c[2] - 0.1125)), inBore = c => rAx(c) < d / 2 && c[1] >= tip;
  const regions = { 'everywhere': () => true, 'the pool away from the pipes and the pool edge': c => rAx(c) > 0.015 && c[0] < -0.055,
    'round the pipes, outside the bores (within 15 mm of an axis)': c => rAx(c) <= 0.015 && !inBore(c), 'in the bores': inBore, 'under the blade near the pool edge (x > −55 mm)': c => c[0] >= -0.055 };
  let uMax = 0, pLo = Infinity, pHi = -Infinity; A.cells.forEach((c, k) => { if (!ok[k]) return; const q = Uf.nums.slice(3 * k, 3 * k + 3); uMax = Math.max(uMax, Math.hypot(...q)); pLo = Math.min(pLo, rho * pf.nums[k] - mO); pHi = Math.max(pHi, rho * pf.nums[k] - mO); });
  const res = { time: Uf.t, cells: n, compared: ok.filter(Boolean).length, uMax, pRange: pHi - pLo, solutions: [] };
  console.log(`OpenFOAM time ${Uf.t}, ${n} cells (${res.compared} compared); its largest speed ${(uMax * 1e3).toFixed(3)} mm/s, pressure range ${(pHi - pLo).toFixed(2)} Pa (without the hydrostatic part)`);
  for (const S of sols) {
    const mA = mean(k => S.vals[k][3]), row = { name: S.name, nE: S.nE, nD: S.nD, regions: {} };
    console.log(`  ${S.name}, ${S.nD} unknowns:`);
    for (const [name, inR] of Object.entries(regions)) {
      let V = 0, eu = 0, ep = 0, mu_ = 0, mp = 0;
      A.cells.forEach((c, k) => { if (!ok[k] || !inR(c)) return; const a = S.vals[k], w = c[3], du = Math.hypot(a[0] - Uf.nums[3 * k], a[1] - Uf.nums[3 * k + 1], a[2] - Uf.nums[3 * k + 2]), dp = (a[3] - mA) - (rho * pf.nums[k] - mO);
        V += w; eu += w * du * du; ep += w * dp * dp; mu_ = Math.max(mu_, du); mp = Math.max(mp, Math.abs(dp)); });
      row.regions[name] = { volume: V, uRms: Math.sqrt(eu / V) / uMax, uMax: mu_ / uMax, pRms: Math.sqrt(ep / V) / (pHi - pLo), pMax: mp / (pHi - pLo) };
      const v = row.regions[name];
      console.log(`    ${name}: velocity RMS ${(v.uRms * 100).toFixed(2)} % (largest ${(v.uMax * 100).toFixed(1)} %), pressure RMS ${(v.pRms * 100).toFixed(2)} % (largest ${(v.pMax * 100).toFixed(1)} %)`);
    }
    res.solutions.push(row);
  }
  // (the bores where the flow is fully developed -- 10 mm below their tops to 10 mm above the tips: Poiseuille's exact
  //  v = −2V̄(1 − r²/R²) there, V̄ a pipe's flow over πR²; OpenFOAM's and each solution's RMS and largest difference from it,
  //  as a share of its peak 2V̄)
  const Rb = d / 2, Vb = Qin / 2 / (Math.PI * Rb * Rb), dev = [], at = [];
  A.cells.forEach((c, k) => { if (rAx(c) < Rb && c[1] >= tip + 0.01 && c[1] <= tip + bore - 0.01) at.push(k); });
  const off = val => { let V = 0, e = 0, m = 0; for (const k of at) { const c = A.cells[k], v = val(k), ex = -2 * Vb * (1 - (rAx(c) / Rb) ** 2), q = Math.hypot(v[0], v[1] - ex, v[2]); V += c[3]; e += c[3] * q * q; m = Math.max(m, q); } return { rms: Math.sqrt(e / V) / (2 * Vb), max: m / (2 * Vb) }; };
  // (and the pressure's gradient down them: Poiseuille's 8μV̄/R² for p − ρg(h − y) -- OpenFOAM's has no gravity -- the
  //  least-squares slope over the same cells)
  const slope = val => { let n = 0, sy = 0, sp = 0, syy = 0, syp = 0; for (const k of at) { const y = A.cells[k][1], p = val(k); n++; sy += y; sp += p; syy += y * y; syp += y * p; } return (n * syp - sy * sp) / (n * syy - sy * sy); };
  const G = 8 * mu * Vb / (Rb * Rb);
  res.poiseuille = { cells: at.length, peak: 2 * Vb, dpdy: G, openfoam: { ...off(k => Uf.nums.slice(3 * k, 3 * k + 3)), dpdy: slope(k => rho * pf.nums[k]) },
    solutions: sols.map(S => ({ name: S.name, ...off(k => S.vals[k]), dpdy: slope(k => S.vals[k][3]) })) };
  const pg = v => `${((v / G - 1) * 100).toFixed(2)} %`;
  console.log(`  the bores' fully developed part (${at.length} cells) off Poiseuille (velocity RMS, largest, of its peak ${(2 * Vb * 1e3).toFixed(1)} mm/s; the pressure's gradient, of its ${(G / 1e3).toFixed(1)} kPa/m): OpenFOAM ${(res.poiseuille.openfoam.rms * 100).toFixed(2)} %, ${(res.poiseuille.openfoam.max * 100).toFixed(1)} %, ${pg(res.poiseuille.openfoam.dpdy)}; ` +
    res.poiseuille.solutions.map(s => `${s.name.split(' (')[0]} ${(s.rms * 100).toFixed(2)} %, ${(s.max * 100).toFixed(1)} %, ${pg(s.dpdy)}`).join('; '));
  // (for the figure: OpenFOAM's cell values along the lines -- the cell holding each point: the app's element, then which of
  //  its 8 -- and every solution's; the cells by the plane through the first pipe's axis)
  const M = FT.fptMesh({ ...CASE, mesh: { size: A.size, across: A.across || 2, tol: 0.2e-3 } }).M, X = FT.fptIndex(M), zero = new Float64Array(M.nN);
  const ofAt = p => { const f = FT.fptField(X, [zero], p); if (!f) return null;
    for (let s = 0; s < 8; s++) { const P = FF.FF_TET_SUB[s].map(k => { const n = M.conn[10 * f.e + k]; return [M.X[n], M.Y[n], M.Z[n]]; });
      const T = [0, 1, 2].map(c => [P[1][c] - P[0][c], P[2][c] - P[0][c], P[3][c] - P[0][c]]), b = [0, 1, 2].map(c => p[c] - P[0][c]);
      const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
      const D = det(T), l = [0, 1, 2].map(k => det(T.map((r, c) => r.map((x, j) => (j === k ? b[c] : x)))) / D);
      if (Math.min(l[0], l[1], l[2], 1 - l[0] - l[1] - l[2]) > -1e-9) { const c = 8 * f.e + s; return Uf.nums.slice(3 * c, 3 * c + 3); } }
    return null; };
  res.lines = { pts: LINES, openfoam: onLines(ofAt), solutions: sols.map(S => ({ name: S.name, ...S.lines })) };
  res.plane = []; A.cells.forEach((c, k) => { if (Math.abs(c[2] - 0.0375) < 1.5e-3) res.plane.push([c[0], c[1], Math.hypot(c[4], c[5], c[6]), Math.hypot(Uf.nums[3 * k], Uf.nums[3 * k + 1], Uf.nums[3 * k + 2])]); });
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(res));
}

const [cmd, dir, a1, a2] = process.argv.slice(2);
if (cmd === 'make') make(dir, +(a1 || 0.01), +(a2 || 4), +(process.argv[6] || 2));
else if (cmd === 'compare') compare(dir, a1, a2);
else console.log('node pooltet.js make <case> [size] [np] | compare <case> [out.json] [hex,tet:0.007]');
