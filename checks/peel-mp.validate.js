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
 * 1D, the roll:
 *  8. Winding: each turn's pull pressing on the roll beneath (the elements' accretion) against the closed form of each
 *     increment (u = C1 r^g + C2 r^−g on its core) summed over the turns; two turns to an element against one.
 *  9. Water through the turns: the roll's mean water against Crank's series for a slab sealed at one face (the roll
 *     thin against its radius); finer in time, closer.
 * 10. Heat through the turns: the roll's mean temperature against the series for a slab cooled at one face (β tan β = Bi).
 * 11. Swelling: a uniform change of water, the roll free on no core: no stress; drying on a rigid core: Lamé's closed form;
 *     swelling on a rigid core: the roll lifts off it, no stress; the outer turns swelling first lift off the turns beneath:
 *     no pull between any, the lifted ones a free ring.
 * 12. A turn bent round the roll: one layer (bending and the hoop force), two (Timoshenko's bimetal at its free curvature).
 */
const P = require('../engine/peel-mp.js'), F = require('../engine/film.js');
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

// ---- 8. the roll: winding ----
global.drPsat = global.drPsat || require('../engine/drying.js').drPsat;
{
  const o = { R0: 0.038, core: { E: 5e9, nu: 0.3, Ri: 0.03 }, h: 16e-6, n: 400, per: 1, Tw: 20, Er: 50e6, Eth: 20e9, nuTr: 0 };
  const r = P.pmpRoll(o);
  let worst = 0;
  for (let e = 0; e < o.n; e += 7) {
    const rr = r.r[e]; let sr = -o.Tw / (o.R0 + (e + 0.5) * o.h) / 2;
    for (let j = e + 1; j < o.n; j++) { const s = o.R0 + j * o.h; sr += P.pmpRollIncrement(o.R0, s, o.Er, o.Eth, r.kCore, o.Tw / (s + 0.5 * o.h), rr).sr; }
    worst = Math.max(worst, Math.abs(r.wound.sr[e] - sr) / Math.abs(r.wound.sr[0]));
  }
  check('the roll wound: the pressure through it against the closed-form increments summed turn by turn (a tube core)', worst < 1e-5, `${(r.coreP.wound / 1e3).toFixed(2)} kPa on the core, worst ${(worst * 100).toFixed(5)} %`);
  const big = { ...o, n: 2000, nuTr: 0.3 }, one = P.pmpRoll(big), two = P.pmpRoll({ ...big, per: 2 }), mid = k => k.wound.sr[Math.floor(k.nE / 2)];
  check('the roll\'s mesh: two turns to an element against one (2000 turns, ν_θr 0.3)', rel(two.coreP.wound, one.coreP.wound) < 0.005 && rel(mid(two), mid(one)) < 0.005,
    `${(one.coreP.wound / 1e3).toFixed(2)} · ${(two.coreP.wound / 1e3).toFixed(2)} kPa on the core, ${(mid(one) / 1e3).toFixed(2)} · ${(mid(two) / 1e3).toFixed(2)} kPa halfway`);
  const hoop = r.wound.st[o.n - 1];
  check('the outer turn keeps the hoop stress it was wound with, Tw / h', rel(hoop, o.Tw / o.h) < 1e-12, `${(hoop / 1e6).toFixed(3)} MPa`);
}
// ---- 9. the roll: water through the turns, the slab limit ----
{
  const Lr = 0.004, n = 200, h = Lr / n, lin = 0.2, rhoD = 1000, Kv = 1e-12, D = Kv * drPsat(25) / (rhoD * lin);
  const run = steps => P.pmpRoll({ R0: 10, core: { E: 0, nu: 0.3, Ri: 0 }, h, n, per: 1, Tw: 0, Er: 1e9, Eth: 1e9, nuTr: 0, tEnd: 0.3 * Lr * Lr / D, steps,
    heat: { T0: 25, k: 1, rhoc: 1e6, hOut: 10, Troom: 25 }, water: { X0: 0.02, lin, rhoD, Kv, rhRoom: 0.5 } });
  const err = r => { let w = 0; for (const q of r.series) { if (!q.t) continue; let S = 0; for (let k = 0; k < 200; k++) { const m = 2 * k + 1; S += 8 / (m * m * Math.PI * Math.PI) * Math.exp(-D * m * m * Math.PI * Math.PI * q.t / (4 * Lr * Lr)); }
    const crank = 0.02 + (0.1 - 0.02) * (1 - S), mean = q.X.reduce((a, b) => a + b, 0) / q.X.length; w = Math.max(w, Math.abs(mean - crank) / (crank - 0.02)); } return w; };
  const e1 = err(run(200)), e2 = err(run(800));
  check('the roll\'s water through its turns: its mean against Crank\'s series (a slab sealed at the core)', e2 < 0.005 && e2 < e1, `worst ${(e1 * 100).toFixed(3)} % (200 steps), ${(e2 * 100).toFixed(3)} % (800)`);
}
// ---- 10. the roll: heat through the turns, the slab limit ----
{
  const Lr = 0.004, n = 200, h = Lr / n, k = 0.2, rhoc = 1.5e6, hOut = 25, Bi = hOut * Lr / k, al = k / rhoc;
  const run = steps => P.pmpRoll({ R0: 10, core: { E: 0, nu: 0.3, Ri: 0 }, h, n, per: 1, Tw: 0, Er: 1e9, Eth: 1e9, nuTr: 0, tEnd: 0.5 * Lr * Lr / al, steps,
    heat: { T0: 60, k, rhoc, hOut, Troom: 20 } });
  // (the roots of β tan β = Bi, one in each (mπ, mπ + π/2))
  const roots = Array.from({ length: 60 }, (_, m) => { let lo = m * Math.PI + 1e-12, hi = m * Math.PI + Math.PI / 2 - 1e-12; for (let i = 0; i < 100; i++) { const c = (lo + hi) / 2; if (c * Math.tan(c) < Bi) lo = c; else hi = c; } return (lo + hi) / 2; });
  const err = r => { let w = 0; for (const q of r.series) { if (!q.t) continue; const Fo = al * q.t / (Lr * Lr); let S = 0; for (const b of roots) S += 2 * Bi * Bi / (b * b * (b * b + Bi * Bi + Bi)) * Math.exp(-b * b * Fo);
    const mean = q.T.reduce((a, b) => a + b, 0) / q.T.length, ex = 20 + 40 * S; w = Math.max(w, Math.abs(mean - ex) / (60 - ex)); } return w; };
  const e1 = err(run(200)), e2 = err(run(800));
  check('the roll\'s heat through its turns: its mean against the series for a slab cooled at one face (Bi = h L / k)', e2 < 0.005 && e2 < e1, `Bi ${Bi.toFixed(2)}, worst ${(e1 * 100).toFixed(3)} % (200 steps), ${(e2 * 100).toFixed(3)} % (800)`);
}
// ---- 11. the roll: swelling and shrinking ----
{
  const E = 1e9, bet = 0.05;
  const roll = (core, X0, X1) => P.pmpRoll({ R0: 0.038, core, h: 16e-6, n: 300, per: 1, Tw: 0, Er: E, Eth: E, nuTr: 0, tEnd: 1, steps: 5, beta: bet, betaT: bet,
    water: { X0, lin: 0.2, rhoD: 1000, Kv: 1e-2, rhRoom: X1 / 0.2 } });
  const free = roll({ E: 0, nu: 0.3, Ri: 0 }, 0.02, 0.04), big = Math.max(...free.end.sr.map(Math.abs), ...free.end.st.map(Math.abs));
  check('swelling evenly on no core, free outside: no stress (a free ring grows)', big < 1e-6 * E * bet * 0.02, `${big.toExponential(2)} Pa largest`);
  // (drying evenly on a rigid core: the turns shrink onto it -- pressed together throughout, the linear closed form)
  const X0 = 0.04, rig = roll({ E: 1e16, nu: 0.3, Ri: 0 }, X0, 0.02), R0 = 0.038, R1 = rig.R1;
  let w = 0, pos = 0;
  for (let e = 0; e < rig.nE; e++) {
    const eps = bet * (rig.series[rig.series.length - 1].X[e] - X0), A = eps / (1 + R0 * R0 / (R1 * R1)), rr = rig.r[e];
    w = Math.max(w, Math.abs(rig.end.st[e] - E * (A * (1 - R0 * R0 / (rr * rr)) - eps)) / (E * -eps), Math.abs(rig.end.sr[e] - E * (A * (1 + R0 * R0 / (rr * rr)) - eps)) / (E * -eps));
    pos = Math.max(pos, rig.end.sr[e]);
  }
  check('drying evenly on a rigid core: Lamé\'s closed form, σ_θ = E (A (1 − R0²/r²) − ε*), the turns pressed together', w < 2e-3 && pos <= 0, `worst ${(w * 100).toFixed(3)} % of E ε*`);
  // (swelling evenly on a rigid core: the roll would pull on it; it lifts off instead -- no stress)
  const up = roll({ E: 1e16, nu: 0.3, Ri: 0 }, 0.02, 0.04), bigU = Math.max(...up.end.sr.map(Math.abs), ...up.end.st.map(Math.abs)), lin = E * bet * 0.02, hu = up.hist[up.hist.length - 1];
  check('swelling evenly on a rigid core: the roll lifts off it (it cannot pull on the core), no stress', bigU < 1e-6 * lin && !hu.onCore,
    `${bigU.toExponential(2)} Pa largest (Lamé, held on, would give ${(lin / 1e6).toFixed(2)} MPa); off the core: ${!hu.onCore}`);
  // (wound, then its outer turns swelling first: they lift off the turns beneath -- no pull between any; the lifted ones a
  //  free ring, no hoop stress either)
  const sw = P.pmpRoll({ R0: 0.038, core: { E: 5e9, nu: 0.3, Ri: 0.03 }, h: 16e-6, n: 300, per: 1, Tw: 20, Er: 20e6, Eth: 16e9, nuTr: 0, tEnd: 3600, steps: 100, beta: 0.08, betaT: 1.5,
    water: { X0: 0.06, lin: 0.2, rhoD: 1000, Kv: 1e-15, rhRoom: 0.5 } });
  // (a turn free both sides -- a gap under it and over it, or the outside -- is a free ring: no stress at all)
  const hs = sw.hist[sw.hist.length - 1], tens = Math.max(...sw.end.sr), lifted = [];
  for (let e = 1; e < sw.nE; e++) if (sw.gaps[e] && (e === sw.nE - 1 || sw.gaps[e + 1])) lifted.push(Math.max(Math.abs(sw.end.st[e]), Math.abs(sw.end.sr[e])));
  const hoopL = lifted.length ? Math.max(...lifted) : NaN, ref = 16e9 * 0.08 * (0.1 - 0.06);
  check('the outer turns swelling first lift off the turns beneath: no pull between any turns, a turn lifted clear (a free ring) no stress', tens <= 1e-6 * 20e6 && hs.gaps > 0 && lifted.length > 0 && hoopL < 1e-4 * ref,
    `${hs.gaps} gaps, ${lifted.length} turns clear; the most pull between turns ${tens.toExponential(1)} Pa; stress in those clear ${hoopL.toExponential(1)} Pa (free swelling held, ${(ref / 1e6).toFixed(0)} MPa)`);
}

// ---- 12. a turn bent round the roll ----
{
  const Q = 25e9, h = 16e-6, k = 1 / 0.04, N = 20, one = P.pmpTurnStress([{ t: h, Q, en: 3e-3 }], k, N);
  const w1 = Math.max(rel(one.top, N / h + Q * k * h / 2), rel(one.bot, N / h - Q * k * h / 2));
  // (Timoshenko's bimetal, equal layers: free at κ = 3Δ/(2h), its faces ±QΔ/4, the interface ∓QΔ/2)
  const D = 2e-3, two = P.pmpTurnStress([{ t: h / 2, Q, en: 0 }, { t: h / 2, Q, en: D }], 3 * D / (2 * h), 0);
  const w2 = Math.max(rel(two.top, Q * D / 4), rel(two.bot, -Q * D / 4), rel(two.max, Q * D / 2), rel(two.min, -Q * D / 2));
  check('a turn bent round the roll: one layer against N/h ± Q κ h/2; two at Timoshenko\'s free curvature, its faces ±QΔ/4, the interface ∓QΔ/2', Math.max(w1, w2) < 1e-12, `worst ${Math.max(w1, w2).toExponential(1)}`);
}

// ---- 11. GO's own water (2c): the isotherm's C at the turn's temperature (H_c) -- at a steady 40 °C the roll's water is
//      the isotherm with its C at 40 °C, to the last bit; no T (no heat solved): the isotherm as it is ----
{
  const g2 = { Xm: 0.115, C: 200, K: 0.885, T0: 25, Hc: 20000 }, C40 = 200 * Math.exp(20000 / 8.314462618 * (1 / (40 + 273.15) - 1 / (25 + 273.15)));
  const run = (gab, heat) => P.pmpRoll({ R0: 0.038, core: { E: 0, nu: 0.3, Ri: 0 }, h: 16e-6, n: 200, per: 4, Tw: 0, Er: 1e9, Eth: 1e9, nuTr: 0, tEnd: 24 * 3600, steps: 40,
    heat, water: { X0: 0.0836, gab, rhoD: 1500, Kv: 1e-15, rhRoom: 0.5 } });
  const a = run(g2, { T0: 40, k: 0.2, rhoc: 1.5e6, hOut: 8, Troom: 40 }), b = run({ Xm: 0.115, C: C40, K: 0.885 }, { T0: 40, k: 0.2, rhoc: 1.5e6, hOut: 8, Troom: 40 });
  let d = 0; a.series.forEach((q, i) => q.X.forEach((x, e) => { d = Math.max(d, Math.abs(x - b.series[i].X[e])); }));
  const c = run(g2, null), e = run({ Xm: 0.115, C: 200, K: 0.885 }, null);
  let d2 = 0; c.series.forEach((q, i) => q.X.forEach((x, k) => { d2 = Math.max(d2, Math.abs(x - e.series[i].X[k])); }));
  const last = a.series[a.series.length - 1].X;
  check('GO\'s own water in the roll at 40 °C: the isotherm with H_c is the isotherm with its C at 40 °C; with no heat solved, the isotherm as it is', d < 1e-12 && d2 === 0,
    `${d.toExponential(1)}, ${d2} kg/kg; the outer turn at the end ${(last[last.length - 1] * 100).toFixed(2)} %, the core's ${(last[0] * 100).toFixed(2)} %`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
