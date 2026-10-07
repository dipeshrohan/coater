'use strict';
/*
 * cut-mp.validate.js — MP-CUT's checks (cut-mp.js): the film cut with a knife, its cut edge in 1D, 2D and 3D, against
 * independent solutions.
 *  1. 1D: a thin film on a thick substrate parting from it (steady state): Hutchinson and Suo's (1 − ν²) σ² h / (2E).
 *  2. 1D: a film whose layers all want the same size carries no stress and releases nothing at any interface.
 *  3. 1D: two layers' curl: Timoshenko's bimetal.
 *  4. 1D: the energy released at an interface, by its definition (the energy before less after), against the parts'
 *     forces and moments set to zero independently (their energy a minimum: a small change in either part's stretch or
 *     curl raises it).
 *  5. 2D: far in from the cut, the layers' stress is the 1D's (laminate theory); the cut's face carries no force or
 *     moment; layers all wanting the same size: no stress anywhere.
 *  6. 2D: the shear between the layers a quarter of the film's thickness in from the cut settles as the mesh is refined.
 *  7. 3D: a piece curling one way only: a cylinder, exactly (sheet.js's plate).
 */
const C = require('../engine/cut-mp.js');
let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
const pct = v => `${(v * 100).toFixed(4)} %`;

// 1. Hutchinson–Suo
{
  const E = 5e9, nu = 0.3, h1 = 1e-6, em = 1e-3;
  for (const h2 of [1e-3, 1e-2]) {
    const r = C.cutRun1({ layers: [{ t: h2, E, nu, en: 0 }, { t: h1, E, nu, en: -em }] });
    const sig = E * em / (1 - nu), G = (1 - nu * nu) * sig * sig * h1 / (2 * E), e = Math.abs(r.G[0].G / G - 1);
    check(`1D: a thin film (1 µm) parting from a ${h2 * 1000} mm substrate: (1 − ν²) σ² h / (2E)`, e < (h2 > 5e-3 ? 1e-3 : 1e-2), `${r.G[0].G.toExponential(4)} against ${G.toExponential(4)} J/m² (${pct(e)}: the substrate's own give)`);
  }
}
// 2. uniform
{
  const r = C.cutRun1({ layers: Array.from({ length: 6 }, () => ({ t: 1e-5, E: 5e9, nu: 0.3, en: 2e-3 })) });
  const sMax = Math.max(...r.free.at.flatMap(a => [Math.abs(a.s0), Math.abs(a.s1)])), gMax = Math.max(...r.G.map(g => Math.abs(g.G)));
  check('1D: layers all wanting the same size: no stress, nothing released at any interface', sMax < 1 && gMax < 1e-15, `stress ${sMax.toExponential(1)} Pa, G ${gMax.toExponential(1)} J/m² (E ε* ${(5e9 * 2e-3 / 1e6).toFixed(0)} MPa)`);
}
// 3. Timoshenko
{
  const t1 = 2e-5, t2 = 3e-5, E1 = 4e9, E2 = 7e9, nu = 0.25, de = 1e-3;
  const r = C.cutRun1({ layers: [{ t: t1, E: E1, nu, en: 0 }, { t: t2, E: E2, nu, en: de }] });
  const m = t1 / t2, n = E1 / E2, h = t1 + t2, k = 6 * de * (1 + m) ** 2 / (h * (3 * (1 + m) ** 2 + (1 + m * n) * (m * m + 1 / (m * n))));
  check('1D: two layers\' curl against Timoshenko\'s bimetal', Math.abs(r.free.kappa / k - 1) < 1e-10, `${r.free.kappa.toFixed(6)} against ${k.toFixed(6)} 1/m`);
}
// 4. the parts at their energy's minimum
{
  const L = [{ t: 1e-5, E: 4e9, nu: 0.3, en: 0 }, { t: 1.5e-5, E: 5e9, nu: 0.28, en: 1e-3 }, { t: 1e-5, E: 6e9, nu: 0.32, en: -5e-4 }, { t: 0.8e-5, E: 5.5e9, nu: 0.3, en: 4e-4 }];
  const F = C.cutFree(L), { z0 } = C.cutZ(L);
  let worst = Infinity;
  for (let j = 1; j < L.length; j++) for (const [lo, hi, zz] of [[0, j, z0.slice(0, j)], [j, L.length, z0.slice(j)]]) {
    const part = L.slice(lo, hi), a = C.cutArm(part, zz, F.e0, F.kappa), W = C.cutEnergy(part, zz, a.ex, a.kx, F.e0, F.kappa);
    for (const [dx, dk] of [[1e-5, 0], [-1e-5, 0], [0, 1], [0, -1]]) worst = Math.min(worst, C.cutEnergy(part, zz, a.ex + dx, a.kx + dk, F.e0, F.kappa) - W);
  }
  check('1D: each part parted is at its energy\'s minimum (its force and moment across the cut none)', worst > 0, `the least rise from a nudge ${worst.toExponential(2)} J/m²`);
}
// 5. 2D far field, the cut's face, uniform
const L3 = [{ t: 1e-5, E: 4e9, nu: 0.3, en: 0 }, { t: 1e-5, E: 5e9, nu: 0.3, en: 1e-3 }, { t: 1e-5, E: 6e9, nu: 0.3, en: -5e-4 }];
{
  const r = C.cutRun2({ layers: L3, mesh: { nx: 30, grade: 300, Lh: 20, nzL: 4 } }), F = C.cutFree(L3), zs = r.mesh.coord[1];
  let err = 0, ref = 0;
  for (let k = 0; k < zs.length; k++) {
    const z = zs[k], i = Math.min(2, Math.floor(z / 1e-5 + 1e-9));
    if (Math.abs(z / 1e-5 - Math.round(z / 1e-5)) < 1e-6) continue;   // (the interfaces: a node there averages both layers)
    const a = F.at[i], s = a.s0 + (a.s1 - a.s0) * (z - a.z0) / (a.z1 - a.z0);
    err = Math.max(err, Math.abs(r.far[k].sxx - s)); ref = Math.max(ref, Math.abs(s));
  }
  check('2D: far in from the cut, the layers\' stress σ_xx is the 1D\'s (laminate theory)', err / ref < 1e-6, `largest difference ${pct(err / ref)} of ${(ref / 1e6).toFixed(3)} MPa`);
  check('2D: the cut\'s face carries no force and no moment (its σ_xx through the film, integrated)', Math.abs(r.edgeN / r.farN) < 2e-3, `force ${pct(Math.abs(r.edgeN / r.farN))} of the far end's |σ| through the film`);
  const u = C.cutRun2({ layers: L3.map(q => ({ ...q, en: 1e-3 })).map(q => ({ ...q, E: 5e9 })), mesh: { nx: 20, grade: 100, Lh: 20, nzL: 2 } });
  const mx = Math.max(...u.sxx.map(Math.abs), ...u.szz.map(Math.abs), ...u.sxz.map(Math.abs), ...u.syy.map(Math.abs));
  check('2D: layers all wanting the same size: no stress anywhere', mx < 1e-6 * 5e9 * 1e-3, `largest ${mx.toExponential(2)} Pa`);
}
// 6. 2D mesh
{
  const sh = [2, 4, 8].map(nzL => C.cutRun2({ layers: L3, mesh: { nx: 30, grade: 300, Lh: 20, nzL } }).shear.v);
  const d1 = Math.abs(sh[1] - sh[0]), d2 = Math.abs(sh[2] - sh[1]);
  check('2D: the shear between the layers a quarter of the film in from the cut settles as the elements through each layer double', d2 < d1 / 2, sh.map(v => (v / 1e6).toFixed(4)).join(' → ') + ' MPa');
}
// 7. 3D: a cylinder
{
  let ok = true, info = '';
  try {
    const nu = 0.3, E = 5e9, h = 5e-5, D = E * h ** 3 / (12 * (1 - nu * nu)), A = E * h / (1 - nu * nu);
    const r = C.cutRun3({ plate: { A, D, nu, h, kS: 0, kSet: 0.8, p: 0 }, Lx: 0.1, Ly: 0.05, n: 4 });
    const ex = 0.8 * (0.05) ** 2 / 2;
    ok = Math.abs(r.free.kxMid / 0.8 - 1) < 1e-6 && Math.abs(r.free.edgeX / ex - 1) < 1e-3;
    info = `κ ${r.free.kxMid.toFixed(6)} (0.8), the end's rise ${(r.free.edgeX * 1000).toFixed(4)} mm (${(ex * 1000).toFixed(4)})`;
  } catch (e) { ok = false; info = e.message; }
  check('3D: the piece curling one way only (the roll\'s set) is a cylinder (sheet.js\'s plate)', ok, info);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
