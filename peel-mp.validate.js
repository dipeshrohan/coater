/*
 * peel-mp.validate.js — checks for peel-mp.js (MP-PEEL: the film peeled off its web). node peel-mp.validate.js
 *
 * 2D, the peel front:
 *  1. Stiffness: pmpTI against film.js's transversely isotropic stiffness; the biaxial modulus E_p / (1 − ν_p).
 *  2. The banded L D Lᵀ solve (indefinite: a softening hold) against a dense solve.
 *  3. The bonded film far behind the front holds the laminate's stress, −Qb en, layer by layer.
 *  4. The energy balance (Kendall's, the section's far fields): J on two rings round the front and the energy the hold's
 *     layer took, against G(f) = f (1 − cos θ) + (f + Aₙ)²/(2A), at 30°, 90° and 180°; the film with natural strains
 *     (in tension; a gradient that curls it) at 90° and 180°.
 *  5. The arm (finite rotation): its moment against the elastica's, M = 2 √(D f) sin((θ − φ)/2) + M∞, beyond the hold.
 *  6. The steady peel: past the force where G reaches Gi there is no equilibrium (the front runs).
 *  7. The mesh: the film's stress at the front on the default mesh against a finer one; the beam's (6 M₀/h² + f/h).
 */
const P = require('./peel-mp.js'), F = require('./film.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const deg = d => d * Math.PI / 180;

// ---- 1. stiffness ----
{
  const Ep = 20e9, Et = 3e9, nup = 0.2, nupt = 0.1, Gpt = 1e9, C = P.pmpTI(Ep, Et, nup, nupt, Gpt), T = F.fmTransIso(Ep, Et, nup, nupt, Gpt);
  const e = Math.max(rel(C.C11, T.C11), rel(C.C13, T.C13), rel(C.C33, T.C33), rel(C.C55, T.C55), rel(C.Qb, T.Q), rel(C.Qb, Ep / (1 - nup)));
  check('stiffness: film.js\'s C11, C13, C33, C55 and the biaxial modulus E_p/(1 − ν_p)', e < 1e-12, e.toExponential(1));
  // plane strain with σzz = 0: the stiffness along x with the width held, E_p/(1 − ν_p²) less the through-coupling
  const S = [[1 / Ep, -nup / Ep, -nupt / Ep], [-nup / Ep, 1 / Ep, -nupt / Ep], [-nupt / Ep, -nupt / Ep, 1 / Et]];
  // (εyy = 0, σzz = 0: σxx / εxx from the compliance's x–y block with z free: 1 / (S11 − S12² / S11 ... ) by elimination)
  const a = S[0][0], b = S[0][1];   // with σzz = 0 the z row drops: εxx = a σxx + b σyy, 0 = b σxx + a σyy
  const Ex = 1 / (a - b * b / a);
  check('stiffness: along x with its width held (plane strain, σzz = 0) = 1/(S11 − S12²/S11)', rel(C.Ex, Ex) < 1e-12, `${(C.Ex / 1e9).toFixed(4)} GPa`);
}

// ---- 2. the banded L D Lᵀ ----
{
  const n = 40, bw = 5, B = P.pmpBand(n, bw), A = Array.from({ length: n }, () => new Float64Array(n));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (let i = 0; i < n; i++) for (let j = Math.max(0, i - bw); j <= i; j++) { const v = i === j ? (i % 7 === 3 ? -3 : 4) + rnd() : rnd(); A[i][j] = v; A[j][i] = v; P.pmpAdd(B, i, j, v); }
  const x0 = Array.from({ length: n }, (_, i) => Math.sin(i + 1)), r = A.map(row => row.reduce((s, v, j) => s + v * x0[j], 0));
  P.pmpLDL(B); const x = P.pmpLDLSolve(B, r);
  const e = Math.max(...x.map((v, i) => Math.abs(v - x0[i])));
  check('L D Lᵀ: an indefinite banded system solved (some pivots negative)', e < 1e-10, e.toExponential(1));
}

// ---- the sections ----
const Cf = P.pmpTI(20e9, 3e9, 0.2, 0.1, 1e9), Cs = P.pmpTI(10e9, 2e9, 0.2, 0.1, 0.5e9), Cw = P.pmpTI(1e9, 0.1e9, 0.3, 0.1, 0.05e9);
const web = { tw: 200e-6, C: Cw }, hold = { Gi: 10, sig: 2e6 };
const plain = [{ t: 16e-6, C: Cf, en: 0 }], tension = [{ t: 8e-6, C: Cf, en: -2e-3 }, { t: 8e-6, C: Cs, en: -1e-3 }], curl = [{ t: 8e-6, C: Cf, en: 1e-3 }, { t: 8e-6, C: Cs, en: -2e-3 }];
const runs = {};
const run = (k, layers, d, extra = {}) => { const t0 = Date.now(); const r = P.pmpFront({ layers, web, hold, theta: deg(d), ...extra }); r.ms = Date.now() - t0; runs[k] = r; return r; };

// ---- 3. far behind the front: the laminate's stress ----
{
  const r = run('tension90', tension, 90), M = r.M;
  let e = 0;
  // the same through the answers: the film's top and bottom far behind (the face rows), against −Qb en of their layers
  // (the bonded film six shear lags long, √(A tw / G_web): its own pull handed to the web over them -- the last few
  //  per cent of it at the far end, as the far field)
  const far = r.faceRow.filter(q => q.x < M.xs[0] * 0.98);
  const want = { bot: -tension[0].C.Qb * tension[0].en, top: -tension[1].C.Qb * tension[1].en };
  for (const q of far) e = Math.max(e, rel(q.bot, want.bot), rel(q.top, want.top));
  check('far behind the front: each layer holds the laminate\'s stress −Qb en (in tension, two layers)', far.length > 0 && e < 5e-3, `${(want.bot / 1e6).toFixed(2)} and ${(want.top / 1e6).toFixed(2)} MPa, worst ${(e * 100).toFixed(2)} % (${far.length} points, the shear lag ${(r.ls * 1000).toFixed(2)} mm)`);
}

// ---- 4. the energy balance ----
{
  const show = (r) => `G ${r.G.toFixed(3)}, J ${r.J.inner.toFixed(3)} · ${r.J.outer.toFixed(3)}, the hold ${r.Phi.toFixed(3)} J/m² (${(r.ms / 1000).toFixed(1)} s)`;
  for (const d of [30, 90, 180]) {
    const r = run('plain' + d, plain, d), e = Math.max(rel(r.J.inner, r.G), rel(r.J.outer, r.G), rel(r.Phi, r.G));
    check(`energy balance at ${d}°: J on two rings and the hold's energy = f (1 − cos θ) + f²/(2A)`, e < 5e-3, show(r) + `, worst ${(e * 100).toFixed(2)} %`);
  }
  for (const [k, layers, name] of [['tension', tension, 'in tension (Aₙ = −500 N/m)'], ['curl', curl, 'curling (radius 3 mm free)']]) for (const d of [90, 180]) {
    const r = runs[k + d] || run(k + d, layers, d), e = Math.max(rel(r.J.inner, r.G), rel(r.J.outer, r.G), rel(r.Phi, r.G));
    check(`energy balance at ${d}°, the film ${name}: J and the hold's energy = f (1 − cos θ) + (f + Aₙ)²/(2A)`, e < 5e-3, show(r) + `, worst ${(e * 100).toFixed(2)} %`);
  }
}

// ---- 5. the arm: the elastica ----
{
  for (const k of ['plain90', 'plain180', 'curl180']) {
    const r = runs[k], L = r.L, Minf = L.Bn - L.An * L.zN;
    const beyond = r.arm.filter(a => a.s > r.tipX + 3 * r.zone && a.phi < r.th - 0.02);
    let e = 0; for (const a of beyond) e = Math.max(e, Math.abs(a.M - (2 * Math.sqrt(L.Dn * r.f) * Math.sin((r.th - a.phi) / 2) + Minf)) / (2 * Math.sqrt(L.Dn * r.f)));
    check(`the arm (${k}): its moment against the elastica's, 2 √(D f) sin((θ − φ)/2) + M∞, beyond the hold`, beyond.length > 8 && e < 0.01, `${beyond.length} sections, worst ${(e * 100).toFixed(2)} % of 2 √(D f)`);
  }
}

// ---- 6. the steady peel: no equilibrium past it ----
{
  const fSS = P.pmpSteady(P.pmpLayers(plain), deg(90), hold.Gi);
  const r = run('over', plain, 90, { f: 1.03 * fSS });
  check('past the steady peel\'s force there is no equilibrium: the solve stops at it (the front runs)', r.f <= fSS * 1.002 && r.f >= 0.97 * fSS, `asked ${(1.03 * fSS).toFixed(3)} N/m, held up to ${r.f.toFixed(3)} (steady ${fSS.toFixed(3)})`);
  const film = F.fmPeelForce(deg(90), P.pmpLayers(plain).cells[0].C.Ex * 16e-6, 0, 0, hold.Gi);
  check('the steady force against film.js\'s peel (no natural strain: the same equation)', rel(fSS, film) < 1e-6, `${fSS.toFixed(4)} · ${film.toFixed(4)} N/m`);
}

// ---- 7. the mesh ----
{
  const a = runs.plain180, b = run('fine180', plain, 180, { mesh: { capA: a.lam / 48, fine: a.mesh.fine / 2, nzF: 6, grow: 1.1 } });
  const L = a.L, M0 = Math.sqrt(2 * L.Dn * a.f * (1 - Math.cos(a.th))), beam = 6 * M0 / (16e-6) ** 2 + a.f / 16e-6;
  check('the film\'s stress at the front: the default mesh against a finer one', rel(a.sBot.s, b.sBot.s) < 0.01, `${(a.sBot.s / 1e6).toFixed(1)} · ${(b.sBot.s / 1e6).toFixed(1)} MPa (${a.mesh.unknowns} · ${b.mesh.unknowns} unknowns)`);
  check('at 180° the front\'s stress is the beam\'s, 6 M₀/h² + f/h (the hold turns it little: sin(θ − φ)/2 ≈ 1)', rel(a.sBot.s, beam) < 0.02, `${(a.sBot.s / 1e6).toFixed(1)} · ${(beam / 1e6).toFixed(1)} MPa, the root turned ${(a.rootPhi * 180 / Math.PI).toFixed(1)}°`);
  const c = runs.plain90, M90 = Math.sqrt(2 * L.Dn * c.f * (1 - Math.cos(c.th))), beam90 = 6 * M90 / (16e-6) ** 2 + c.f / 16e-6;
  check('at 90° the hold lets the root turn: the front\'s stress below the beam\'s (clamped root)', c.sBot.s < beam90 && c.sBot.s > 0.7 * beam90, `${(c.sBot.s / 1e6).toFixed(1)} · ${(beam90 / 1e6).toFixed(1)} MPa, the root turned ${(c.rootPhi * 180 / Math.PI).toFixed(1)}°`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
