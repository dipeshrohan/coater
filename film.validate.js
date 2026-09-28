/*
 * film.validate.js — checks for film.js (GO-4: the solid film). node film.validate.js
 *
 *  1. Stiffness: the transversely isotropic stiffness inverts its compliance; isotropic gives Lamé's.
 *  2. The patch test: distorted 9-node elements reproduce a linear displacement field exactly.
 *  3. Laminates: Stoney's curvature for a thin film; Timoshenko's bilayer (any thickness and stiffness ratio) exactly.
 *  4. Channel cracks: a film on a like substrate, Z = 1.976 (Hutchinson–Suo, Beuth); a crack inside a solid, π/4;
 *     the app's mesh against a converged one; the crack's energy with spacing rises to the isolated crack's.
 *  5. The peel: Kendall's equation (no residual strain) solved apart; the lap (θ = 0) with a pre-strained film,
 *     f = S ε + √(2 S G); the elastica's front moment M² = 2 D f (1 − cos θ) brackets its shooting solution.
 *  6. The set film's water: diffusion against Crank's series (a slab sealed below, its top held).
 *  7. A real run (the drying to the peel): layers set stress-free; a floating skin's force zero, the bonded film's
 *     with the web's zero; a skin joining the bonded film keeps its stress; the curl linear in β; the app's crack mesh
 *     against a finer one.
 */
global.drPsat = require('./drying.js').drPsat;
const D = require('./drying.js'), F = require('./film.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// ---- 1. stiffness ----
{
  const E = 70e9, nu = 0.33, C = F.fmIso(E, nu), lam = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const e1 = Math.max(rel(C.C11, lam + 2 * mu), rel(C.C13, lam), rel(C.C33, lam + 2 * mu), rel(C.C55, mu), rel(C.Q, E / (1 - nu)));
  check('isotropic: plane strain λ + 2μ, λ, μ and the biaxial modulus E/(1 − ν)', e1 < 1e-12, e1.toExponential(1));
  // transversely isotropic: C (3×3 normal block) × S = I
  const Ep = 20e9, Et = 3e9, nup = 0.2, nupt = 0.1, T = F.fmTransIso(Ep, Et, nup, nupt, 1e9);
  const S = [[1 / Ep, -nup / Ep, -nupt / Ep], [-nup / Ep, 1 / Ep, -nupt / Ep], [-nupt / Ep, -nupt / Ep, 1 / Et]];
  const C12 = (() => { const a = S[0][0] + S[0][1], det = a * S[2][2] - 2 * S[0][2] * S[0][2]; return S[2][2] / det - T.C11; })();
  const Cm = [[T.C11, C12, T.C13], [C12, T.C11, T.C13], [T.C13, T.C13, T.C33]];
  let e2 = 0; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let v = 0; for (let k = 0; k < 3; k++) v += Cm[i][k] * S[k][j]; e2 = Math.max(e2, Math.abs(v - (i === j ? 1 : 0))); }
  check('transversely isotropic: the stiffness times the compliance is the identity', e2 < 1e-12, e2.toExponential(1));
}

// ---- 2. the patch test ----
{
  // a 3×2 patch of distorted elements (straight-sided quadrilaterals, the rows' nodes shifted differently)
  const mat = () => F.fmTransIso(20e9, 3e9, 0.2, 0.1, 1e9);
  const nxE = 3, nzE = 2, xs = [[0, 0.3, 0.55, 1], [0, 0.45, 0.62, 1], [0, 0.2, 0.7, 1]], zs = [0, 0.35, 1];
  const nxN = 2 * nxE + 1, nzN = 2 * nzE + 1, id = (i, j) => i * nzN + j;
  const PX = [], PZ = [];
  for (let I = 0; I < nxN; I++) for (let J = 0; J < nzN; J++) {
    const i = I >> 1, j = J >> 1, oi = I & 1, oj = J & 1;
    const xAt = jj => oi ? (xs[jj][i] + xs[jj][i + 1]) / 2 : xs[jj][i];
    PX[id(I, J)] = oj ? (xAt(j) + xAt(j + 1)) / 2 : xAt(j); PZ[id(I, J)] = oj ? (zs[j] + zs[j + 1]) / 2 : zs[j];
  }
  const n = 2 * nxN * nzN, K = Array.from({ length: n }, () => new Float64Array(n));
  for (let ei = 0; ei < nxE; ei++) for (let ej = 0; ej < nzE; ej++) {
    const ids = [], ex9 = [], ez9 = [];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const nd = id(2 * ei + a, 2 * ej + b); ids.push(nd); ex9.push(PX[nd]); ez9.push(PZ[nd]); }
    const ke = F.fmQ9K(ex9, ez9, mat, ei, ej);
    for (let p = 0; p < 18; p++) for (let q = 0; q < 18; q++) K[2 * ids[p >> 1] + (p & 1)][2 * ids[q >> 1] + (q & 1)] += ke[p * 18 + q];
  }
  // the linear field u = (a + b x + c z, d + e x + f z) held on the boundary; the inside nodes solved
  const U = (x, z) => [1e-3 + 2e-3 * x - 1.5e-3 * z, -0.5e-3 + 0.7e-3 * x + 1.1e-3 * z];
  const bnd = nd => { const I = Math.floor(nd / nzN), J = nd % nzN; return I === 0 || I === nxN - 1 || J === 0 || J === nzN - 1; };
  const free = [], u = new Float64Array(n);
  for (let nd = 0; nd < nxN * nzN; nd++) { const v = U(PX[nd], PZ[nd]); if (bnd(nd)) { u[2 * nd] = v[0]; u[2 * nd + 1] = v[1]; } else free.push(2 * nd, 2 * nd + 1); }
  // K_ff u_f = −K_fb u_b (dense Gauss)
  const m = free.length, A = free.map(r => free.map(c => K[r][c])), rhs = free.map(r => { let s = 0; for (let c = 0; c < n; c++) if (!free.includes(c)) s -= K[r][c] * u[c]; return s; });
  for (let c = 0; c < m; c++) { let p = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; [rhs[c], rhs[p]] = [rhs[p], rhs[c]]; for (let r = c + 1; r < m; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < m; k++) A[r][k] -= f * A[c][k]; rhs[r] -= f * rhs[c]; } }
  const x = new Float64Array(m); for (let r = m - 1; r >= 0; r--) { let s = rhs[r]; for (let k = r + 1; k < m; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  let err = 0; free.forEach((d, j) => { const nd = d >> 1, v = U(PX[nd], PZ[nd]); err = Math.max(err, Math.abs(x[j] - v[d & 1])); });
  check('the patch test: distorted 9-node elements reproduce a linear field (inside nodes)', err < 1e-12, `max error ${err.toExponential(1)} (of ~1e-3)`);
}

// ---- 3. laminates ----
{
  // Stoney: a 1 µm film pulled (it would shrink 0.1 %) on a 1 mm substrate of the same biaxial stiffness
  const Q = 1e11, hf = 1e-6, hs = 1e-3, mis = 1e-3;
  const r = F.fmFree([{ t: hs, Q, en: 0, z0: -hs }, { t: hf, Q, en: -mis, z0: 0 }]);
  const sf = Q * mis, stoney = 6 * sf * hf / (Q * hs * hs);
  check('Stoney: a thin film\'s tension curves its substrate, κ = −6 σ h_f / (M_s h_s²) (its top concave), within 0.5 %', rel(-r.kappa, stoney) < 0.005, `${r.kappa.toFixed(5)} vs −${stoney.toFixed(5)} 1/m`);
  // Timoshenko's bilayer: layer 1 below, 2 above; the top wants to expand Δε more
  let e = 0; const out = [];
  for (const [m, nq] of [[1, 1], [0.1, 10], [5, 0.2], [0.3, 0.05], [20, 3]]) {
    const t2 = 1e-4, t1 = m * t2, Q2 = 1e10, Q1 = nq * Q2, de = 2e-3, h = t1 + t2;
    const k = F.fmFree([{ t: t1, Q: Q1, en: 0, z0: -t1 }, { t: t2, Q: Q2, en: de, z0: 0 }]).kappa;
    const tim = 6 * de * (1 + m) ** 2 / (h * (3 * (1 + m) ** 2 + (1 + m * nq) * (m * m + 1 / (m * nq))));
    e = Math.max(e, rel(k, tim)); out.push(`m ${m} n ${nq}: ${k.toFixed(3)}`);
  }
  check('Timoshenko\'s bilayer curvature for any thickness and stiffness ratio (the top convex when it expands more)', e < 1e-10, `worst ${e.toExponential(1)}; ${out.join(', ')} 1/m`);
}

// ---- 4. channel cracks ----
{
  const E = 1e9, nu = 0.3, C = F.fmIso(E, nu), Eb = E / (1 - nu * nu), h = 1e-4, sig = 1e6, Zof = r => r.G * Eb / (sig * sig * h);
  const fine = { nx: 24, nz: 24, fine: h / 200, ratio: 1.5, nzCrack: 10 }, app = { nx: 8, nz: 8, fine: h / 100, ratio: 2, nzCrack: 8 };
  const edge = o => F.fmChannel({ zs: [-40 * h, 0, h], zTip: 0, mat: () => C, sig: () => sig, Lh: o.Lh || 30 * h, bottom: 'free', ...o });
  const zF = Zof(edge(fine)), zA = Zof(edge(app)), zL = Zof(edge({ ...fine, Lh: 100 * h }));
  check('channel crack, a film on a like substrate: Z = 1.976 (Hutchinson–Suo, Beuth) within 0.5 % (converged mesh)', rel(zF, 1.976) < 0.005, `Z ${zF.toFixed(4)}; ${zL.toFixed(4)} with the cracks 200 h apart`);
  check('the app\'s mesh within 1 % of it', rel(zA, 1.976) < 0.01, `Z ${zA.toFixed(4)}`);
  const buried = o => F.fmChannel({ zs: [-40 * h, 0, h, 41 * h], zTip: 0, zEnd: h, mat: () => C, sig: () => sig, Lh: 30 * h, bottom: 'free', ...o });
  const bF = Zof(buried(fine)), bA = Zof(buried(app));
  check('a crack inside a solid (a like layer\'s full depth): Z = π/4 within 0.5 % (converged), 1 % (the app\'s mesh)', rel(bF, Math.PI / 4) < 0.005 && rel(bA, Math.PI / 4) < 0.01, `${bF.toFixed(4)}, ${bA.toFixed(4)} vs ${(Math.PI / 4).toFixed(4)}`);
  // spacing: a crack midway between two at spacing s releases G(s) = [2E(s/4) − E(s/2)]/h, rising to the isolated crack's
  const Ehalf = Lh => edge({ ...app, Lh }).E, ss = [1, 2, 4, 8, 16, 60].map(v => v * h), Gs = ss.map(s => (2 * Ehalf(s / 4) - Ehalf(s / 2)) / h);
  const mono = Gs.every((g, i) => i === 0 || g >= Gs[i - 1] - 1e-9 * Math.abs(Gs[i]));
  check('a new crack between two releases more the further apart they are, up to the isolated crack\'s', mono && rel(Gs[Gs.length - 1], zA * sig * sig * h / Eb) < 0.02, Gs.map((g, i) => `s ${ss[i] / h}h: Z ${(g * Eb / (sig * sig * h)).toFixed(3)}`).join(', '));
}

// ---- 5. the peel ----
{
  const S = 16e9 * 3e-4, G = 10;
  let e = 0;
  for (const d of [5, 30, 60, 90, 120, 150, 180]) {
    const th = d * Math.PI / 180, f = F.fmPeelForce(th, S, 0, 0, G);
    let lo = 0, hi = 1e7; for (let it = 0; it < 200; it++) { const m = (lo + hi) / 2; if (m * m / (2 * S) + m * (1 - Math.cos(th)) - G > 0) hi = m; else lo = m; }
    e = Math.max(e, rel(f, (lo + hi) / 2));
  }
  check('Kendall\'s peel equation f²/(2S) + f(1 − cos θ) = G (no residual strain) from 5° to 180°', e < 1e-10, `${e.toExponential(1)}; 90°: ${F.fmPeelForce(Math.PI / 2, S, 0, 0, G).toFixed(4)} N/m (G), 180°: ${F.fmPeelForce(Math.PI, S, 0, 0, G).toFixed(4)} (G/2)`);
  let e2 = 0;
  for (const eb of [-2e-3, -5e-4, 0, 5e-4, 2e-3]) e2 = Math.max(e2, rel(F.fmPeelForce(0, S, eb, S * eb * eb / 2, G), S * eb + Math.sqrt(2 * S * G)));
  check('the lap (θ = 0) with the film pre-strained: f = S ε + √(2 S G) (the pull must first undo the film\'s own force)', e2 < 1e-10, e2.toExponential(1));
  // the elastica: D φ'' = −f sin(θ − φ)… the arm leaves the surface (φ = 0) and turns to θ; M0 = D φ'(0)
  const Dm = 16e9 * (3e-4) ** 3 / 12, f = 7, th = 1.2, M0 = F.fmFrontMoment(th, Dm, f);
  const shoot = k => { let phi = 0, dphi = k * M0 / Dm, ds = 2e-3 * Math.sqrt(Dm / f); for (let i = 0; i < 100000; i++) { const acc = s => -f * Math.sin(s - th) / Dm; // (φ'' = (f/D) sin(θ − φ))
      const k1 = dphi, l1 = -acc(phi), k2 = dphi + ds / 2 * l1, l2 = -acc(phi + ds / 2 * k1), k3 = dphi + ds / 2 * l2, l3 = -acc(phi + ds / 2 * k2), k4 = dphi + ds * l3, l4 = -acc(phi + ds * k3);
      phi += ds / 6 * (k1 + 2 * k2 + 2 * k3 + k4); dphi += ds / 6 * (l1 + 2 * l2 + 2 * l3 + l4); if (phi > th + 0.01) return 'over'; if (dphi < 0) return 'under'; } return 'on'; };
  check('the elastica\'s front moment √(2 D f (1 − cos θ)): a slightly larger start overshoots θ, a smaller one falls short', shoot(1.001) === 'over' && shoot(0.999) === 'under', `M0 ${M0.toExponential(3)} N·m/m`);
}

// ---- 6. the set film's water: diffusion against Crank's series ----
{
  // a set slab (all of it, as once dry), its bottom sealed, its top held at a lower activity; a near-linear isotherm
  // (GAB with K small: X = Xm K a / (1 − K a)); constant temperature
  const Kc = 120, Phi = 1e-4, phiM = 0.85, T = 60, ps = drPsat(T), gab = { Xm: 0.07, C: 1, K: 1e-3 }, as = 0.2, skinK = 1e-12, rhoS = 1900;
  const X0 = gab.Xm * gab.K / (1 - gab.K), Xs = gab.Xm * gab.K * as / (1 - gab.K * as), dXda = gab.Xm * gab.K / (1 - gab.K * 0.6) ** 2;
  const Dz = skinK * phiM * ps / (rhoS * dXda), tEnd = 0.08 * Phi * Phi / Dz, n = 800, M = 4;
  const sT = [0, Phi / 4, Phi / 2, 3 * Phi / 4, Phi];
  const H = { n, x: [], t: [], zt: [], zb: [], dry: [], Ts: [], Tb: [], pvT: [], pvB: [], Tc: [], sT, M, N: 10, Phi, phiM, em: 1, es: 0, both: false };
  for (let i = 0; i < n; i++) { H.x.push(i); H.t.push(tEnd * i / (n - 1)); H.zt.push(Phi); H.zb.push(0); H.dry.push(1); H.Ts.push(T); H.Tb.push(T); H.pvT.push(as * ps); H.pvB.push(NaN); H.Tc.push(new Float64Array(M).fill(T)); }
  const o = { film: { Ep: 1e10, Et: 1e9, nup: 0.2, nupt: 0.1, Gpt: 1e9, beta: 0, alphaF: 0, Xh: 1 }, web: { Ew: 1e9, nuw: 0.3, alphaW: 0, tw: 1e-4 }, gab, rhoS, rhoL: 1000, skinK, K: Kc };
  const hh = F.fmHistory({ history: H }, o), last = hh.steps[n - 1];
  const series = zeta => { let s = 0; for (let k = 0; k < 200; k++) { const m = 2 * k + 1; s += (k % 2 ? -1 : 1) / m * Math.exp(-Dz * m * m * Math.PI * Math.PI * tEnd / (4 * Phi * Phi)) * Math.cos(m * Math.PI * zeta / (2 * Phi)); } return Xs + (X0 - Xs) * 4 / Math.PI * s; };
  let e = 0; for (let k = 0; k < Kc; k += 7) e = Math.max(e, Math.abs(last.X[k] - series(hh.zc[k])) / (X0 - Xs));
  check('the set film\'s water: diffusion through it against Crank\'s series (sealed below, the top held) within 1 %', e < 0.01, `worst ${(e * 100).toFixed(2)} % of the step; the bottom at ${((last.X[0] - Xs) / (X0 - Xs)).toFixed(3)} of it (series ${((series(hh.zc[0]) - Xs) / (X0 - Xs)).toFixed(3)})`);
}

// ---- 7. a real run: the drying to the peel ----
{
  const P0 = 101325;
  const base = (over = {}) => ({ h0: 1.72e-3, phi0: 0.4, phiM: 0.85, rhoS: 1900, rhoL: 1000, R: 2.5e-6, mul: 1, skinK: 1e-12, kS: 0.2, cS: 850, emis: 0.95, irAbs: 0.9, gab: { Xm: 0.07, C: 8, K: 0.8 }, web: { mass: 0.138, cp: 1300 }, airFrac: 0.5, U: 0.28 / 60, Lnat: 0.15, P: P0, Tin: 25, room: { len: 0.5, T: 25, rh: 0.5 }, zones: [0, 1, 2].map(() => ({ len: 2, airU: 1, airT: 100, rh: 0.2, top: 'none', jetU: 10, jetT: 100, jetB: 0.005, jetH: 0.02, jetS: 0.1, ir: 5000 })), where: 'top', N: 80, M: 40, after: { len: 2, T: 25, rh: 0.5 }, history: true, ...over });
  const fo = K => ({ film: { Ep: 20e9, Et: 3e9, nup: 0.2, nupt: 0.1, Gpt: 1e9, beta: 0.08, alphaF: 0, Xh: 0.15, sigF: 100e6, GcF: 40, Gil: 20, Gi: 10, setFrac: 0 }, web: { Ew: 1e9, nuw: 0.3, alphaW: 20e-6, tw: 0.2e-3, soft: 0.1 }, gel: { Eg: 1e5 }, gab: { Xm: 0.07, C: 8, K: 0.8 }, rhoS: 1900, rhoL: 1000, skinK: K, K: 120, core: 0.076, Troom: 25, rhRoom: 0.5, sheet: 0.1, P: P0 });
  for (const over of [{}, { where: 'both', skinK: 1e-11 }]) {
    const dr = D.drStrip(base(over)), o = fo(over.skinK || 1e-12), hh = F.fmHistory(dr, o), tag = over.where ? 'top and bottom, dries' : 'top only, the defaults';
    let bornMax = 0, fMax = 0, bMax = 0, prev = null;
    hh.steps.forEach((S, i) => {
      let scale = 0, Nf = 0, Nb = S.sigW * o.web.tw;
      for (let k = 0; k < hh.K; k++) if (S.set[k]) { const t = hh.dz[k] / hh.phiM; scale += Math.abs(S.sig[k]) * t; if (k >= S.kb) Nf += S.sig[k] * t; else Nb += S.sig[k] * t; if (hh.bornAt[k] === S.x && (!prev || !prev.set[k])) bornMax = Math.max(bornMax, Math.abs(S.sig[k])); }
      // (against the film's forces and the web's own -- the balance cancels them -- with a floor of the web at a strain of 1e-9)
      const Qw = o.web.Ew / (1 - o.web.nuw), ref = scale + Qw * o.web.tw * (Math.abs(S.ew) + 1e-9);
      fMax = Math.max(fMax, Math.abs(Nf) / ref); bMax = Math.max(bMax, Math.abs(Nb) / ref);
      prev = S;
    });
    check(`layers set stress-free (${tag})`, bornMax < 1e-6, `the most a newborn layer carries: ${bornMax.toExponential(1)} Pa`);
    check(`the floating skin's force zero; the bonded film's and the web's together zero (${tag})`, fMax < 1e-9 && bMax < 1e-9, `${fMax.toExponential(1)}, ${bMax.toExponential(1)} of the film's stresses`);
    if (over.where === 'both') {
      // the skin joining: with no swelling (β = 0, α_f = 0) the layers' natural strains stay as set, so every layer of
      // the bonded film -- the old and the joined -- changes its strain (σ/Q) by the same amount, the common strain's
      const o0 = { ...o, film: { ...o.film, beta: 0, alphaF: 0 } }, h0 = F.fmHistory(dr, o0);
      const im = h0.steps.findIndex((S, i) => i > 0 && S.kb >= h0.K && h0.steps[i - 1].kb < h0.K);
      const A = h0.steps[im - 1], B = h0.steps[im];
      const d = []; let big = 0, joined = 0;
      for (let k = 0; k < h0.K; k++) if (A.set[k] && B.set[k]) { d.push(B.sig[k] / B.Q[k] - A.sig[k] / A.Q[k]); big = Math.max(big, Math.abs(A.sig[k] / A.Q[k])); if (k >= A.kb) joined++; }
      const spread = Math.max(...d) - Math.min(...d);
      check(`a skin joining the bonded film keeps its stress (${tag}, at ${B.x.toFixed(2)} m): all layers' strain changes equal`, joined > 0 && spread <= 1e-9 * big, `${joined} layers joined; the spread ${spread.toExponential(1)} of strains to ${big.toExponential(1)}; the common change ${d[0].toExponential(2)}`);
    }
    // the curl is linear in β (a measured curl read back as the β it implies): two runs give any β's
    { const c = b => F.fmCurlOnly(dr, { ...o, film: { ...o.film, beta: b } }), k0 = c(0), k1 = c(1), kb = c(o.film.beta);
      const e = Math.max(Math.abs(kb.atPeel - (k0.atPeel + o.film.beta * (k1.atPeel - k0.atPeel))) / Math.abs(kb.atPeel), Math.abs(kb.settled - (k0.settled + o.film.beta * (k1.settled - k0.settled))) / Math.max(Math.abs(kb.settled), 1e-9));
      check(`the curl is linear in β: from β = 0 and 1, exactly (${tag})`, e < 1e-9, `${e.toExponential(1)}; κ at the peel ${kb.atPeel.toFixed(4)} 1/m`); }
    // the app's crack mesh against a finer one at the worst place
    const r = F.fmRun(dr, o);
    // (GO-4f: the plate by water for the stack -- linear between its rows to 1e-3 of the plate there; its rows at the cut
    //  and the oven's water the plate's own at them)
    { const P = r.plate, at = X => { if (X <= P.tab[0][0]) return P.tab[0]; for (let i = 0; i < P.tab.length - 1; i++) if (X <= P.tab[i + 1][0]) { const f = (X - P.tab[i][0]) / (P.tab[i + 1][0] - P.tab[i][0]); return P.tab[i].map((v, c) => v + f * (P.tab[i + 1][c] - v)); } return P.tab[P.tab.length - 1]; };
      const c = at(P.Xcut), d = at(P.Xdry), e = Math.max(rel(c[1], P.A), rel(c[2], P.D), Math.abs(c[3] - P.eFlatCut) / Math.abs(P.eFlatDry - P.eFlatCut), Math.abs(d[3] - P.eFlatDry) / Math.abs(P.eFlatDry - P.eFlatCut), rel(c[4], P.kS));
      check(`the plate by water: linear between its rows within 1e-3, as the plate at the cut and the oven's water (${tag})`, P.tabErr < 1e-3 && e < 1e-3 && P.tab.length === 21, `rows ${P.tab.length}, halfway ${P.tabErr.toExponential(1)}, at the ends ${e.toExponential(1)}`); }
    if (r.worst) {
      const i = r.worst.i, L = F.fmLayout(hh, i, dr.series[i].h, o);
      const fine = F.fmCrack(L, r.worst.which, { ...o, fem: { nx: 24, nz: 24, div: 200, ratio: 1.5, nzCrack: 10 } });
      check(`the app's crack mesh within 3 % of a finer one on the real stack (${tag}: ${r.worst.which === 'float' ? 'the floating skin' : 'the bonded film'} at ${r.worst.x.toFixed(2)} m)`, rel(r.worst.G, fine.G) < 0.03, `G ${r.worst.G.toFixed(2)} vs ${fine.G.toFixed(2)} J/m²`);
    }
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
if (fails) process.exitCode = 1;
