/*
 * drying-mp.validate.js — checks of the drying's multiphysics (drying-mp.js, MP-5). Run: node drying-mp.validate.js
 *  1. 1D against drying.js (its closures and its web lumped): the water at the exit, the temperatures along the line,
 *     where the skin forms; the water leaving from the top only and from both sides.
 *  2. Conserved: the water (what left = what the films lost) and the energy (the heat in through the faces and the air =
 *     the films' and the web's heat gained + the latent and sensible heat of the water that left), 1D, 2D, 3D.
 *  3. Heat through the film, steady (the water held): the series resistance between the jets above and the air below.
 *  4. The air through the bare web, steady: the exact exponential profile of heat carried up through it.
 *  5. The air through the web under a sealed film (Darcy): the exact series solution of the strip.
 *  6. 2D with the film even across a sealed web = 1D, place by place; 3D with every point at one place = 2D.
 *  7. The stress: the section's elements against the laminate held flat (its layers' natural strains given), free
 *     across its edges (no stress across at the edge), the piece in 3D = the section; on the drying, the layers bonded
 *     to the web against film.js's laminate.
 *  8. The mesh: finer through the film and across it, the answers converged.
 *  9. The finding: with the wet film sealing the web, the plenum's air passes the bare web and not under the film; the
 *     film's middle then dries as with no air from below.
 * 10. A place's water step in parts (where the whole step's Newton does not converge: the film's ends, heated from their
 *     sides too): every place in parts as with whole steps; the water and energy conserved; 3D with its ends heated.
 * 11. The stress's solves along the line (placed where the film sets, each layer from its strain where it set) against
 *     a solve at every step of the drying; the 3D piece as a stretch of the running line: its places coated as they
 *     pass the coater, every place's skin where the others' forms on the line, the stress smooth along the piece.
 */
const D = require('../engine/drying.js'), X = require('../engine/drying-mp.js'), MP = require('../engine/mp-core.js'), FM = require('../engine/film.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const base = (over = {}) => ({
  h0: 1.72e-3, phi0: 0.4, phiM: 0.85, rhoS: 1900, rhoL: 1000, R: 2.5e-6, mul: 1, skinK: 1e-12, kS: 0.2, cS: 850,
  emis: 0.95, irAbs: 0.9, gab: { Xm: 0.07, C: 8, K: 0.8 }, web: { mass: 0.138, cp: 1300 }, airFrac: 0.5,
  U: 0.28 / 60, Lnat: 0.15, P: 101325, Tin: 25, room: { len: 0.5, T: 25, rh: 0.5 },
  zones: [0, 1, 2].map(() => ({ len: 2, airU: 1, airT: 100, rh: 0.2, top: 'none', jetU: 10, jetT: 100, jetB: 0.005, jetH: 0.02, jetS: 0.1, ir: 5000 })),
  where: 'top', N: 80, M: 40, kIn: 1, webT: 3e-4, webEps: 0.67, webK: 1e-10, kFib: 0.2, dim: 1, mesh: { nw: 4, M: 40 }, ...over });
const eBal = e => (e.H - e.H0 - (e.Qin + (e.Qcoat || 0) - e.Qlat - e.Qsens)) / e.Qin;
const wBal = r => Math.abs(r.water.start - r.water.end - r.water.out) / r.water.out;

// ---- 1. 1D against drying.js ----
for (const where of ['top', 'both']) {
  const a = D.drStrip(base({ where })), b = X.dmpDry(base({ where, test: { dr: true } })), c = b.cols[0];
  check(`1D (${where}): the water at the exit as drying.js's within 0.2 %`, rel(c.exit.water, a.exit.water) < 2e-3, `${c.exit.water.toFixed(5)} against ${a.exit.water.toFixed(5)} kg/m²`);
  const xs = [0.1, 0.5, 1, 2, 3, 4, 5, 6], mpS = b.series.map(s => ({ x: s.x, Ts: s.mid.Ts, Tb: s.mid.Tb }));
  const dT = Math.max(...['Ts', 'Tb'].flatMap(k => { const p = D.drSample(a.series, k, xs), q = D.drSample(mpS, k, xs); return p.map((v, i) => Math.abs(v - q[i])); }));
  check(`1D (${where}): the film's top and bottom temperatures along the line as drying.js's within 0.3 K`, dT < 0.3, `largest difference ${dT.toFixed(3)} K at ${xs.length} places`);
  check(`1D (${where}): the skin forms where drying.js's does (within 1 cm)`, Math.abs(c.events.skinTop - a.events.skinTop) < 0.01 && (where === 'top' || Math.abs(c.events.skinBottom - a.events.skinBottom) < 0.01),
    `top ${c.events.skinTop.toFixed(4)} against ${a.events.skinTop.toFixed(4)} m${where === 'both' ? `, bottom ${c.events.skinBottom.toFixed(4)} against ${a.events.skinBottom.toFixed(4)} m` : ''}`);
  check(`1D (${where}): energy conserved within 0.2 % of the heat in; water exactly`, Math.abs(eBal(b.energy)) < 2e-3 && wBal(b) < 1e-9, `energy ${eBal(b.energy).toExponential(1)}, water ${wBal(b).toExponential(1)}`);
}
// (the multiphysics' own 1D: the web resolved, the plenum's natural convection with the air through, the underside's
//  diffusion to the plenum: near drying.js's)
{
  const a = X.dmpDry(base({ where: 'both', test: { dr: true } })), b = X.dmpDry(base({ where: 'both' }));
  check('1D: the web resolved and the plenum\'s air and diffusion beside drying.js\'s lumped web: the water at the exit within 2 %', rel(b.cols[0].exit.water, a.cols[0].exit.water) < 0.02,
    `${b.cols[0].exit.water.toFixed(4)} against ${a.cols[0].exit.water.toFixed(4)} kg/m²`);
}

// ---- 3. heat through the film, steady ----
{
  // jets above (their coefficient does not depend on the surface), the air through below (drying.js's ρ c_p u), no
  // radiation, no IR, the water held (no evaporation, its diffusion all but stopped): T across the series resistances
  const Z = { len: 20, airU: 0.5, airT: 60, rh: 0, top: 'air', jetU: 10, jetT: 120, jetB: 0.005, jetH: 0.02, jetS: 0.1, ir: 0 };
  const o = base({ emis: 0, zones: [Z], room: { len: 0, T: 25, rh: 0 }, U: 0.05, test: { dr: true, Et: 0, Dconst: 1e-30 } });
  const r = X.dmpDry(o), last = r.series[r.series.length - 1].mid;
  const hT = D.drJets({ U: 10, T: 120, B: 0.005, H: 0.02, S: 0.1 }, o.P).h, hB = o.P * 0.0289647 / (8.314462618 * (60 + 273.15)) * 1007 * 0.5;
  const kW = 1 / (o.phi0 / o.kS + (1 - o.phi0) / 0.6), Rf = o.h0 / kW, q = (120 - 60) / (1 / hT + Rf + 1 / hB);
  const Ts = 120 - q / hT, Tb = 60 + q / hB;
  check('heat through the film, steady: top and bottom against the series resistances within 0.05 K', Math.abs(last.Ts - Ts) < 0.05 && Math.abs(last.Tb - Tb) < 0.05,
    `top ${last.Ts.toFixed(3)} (exact ${Ts.toFixed(3)}), bottom ${last.Tb.toFixed(3)} (exact ${Tb.toFixed(3)}) °C`);
}

// ---- 4. the air through the bare web, steady ----
{
  // a film in the middle, wide bare margins; the margin's middle far from the film and the web's edge: the air goes
  // straight up at the zone's speed; above it jets (no radiation, no IR). Exact: k T'' = ρ c u T' with the air coming
  // in at the plenum's temperature and natural convection under it, the jets above, the air leaving at the top.
  const W = 0.3, prof = { y: [0.1, 0.2], h: [1e-3, 1e-3] }, Z = { len: 6, airU: 0.3, airT: 80, rh: 0, top: 'air', jetU: 10, jetT: 130, jetB: 0.005, jetH: 0.02, jetS: 0.1, ir: 0 };
  const o = base({ dim: 2, W, prof, emis: 0, zones: [Z], room: { len: 0, T: 25, rh: 0 }, U: 0.05, webT: 3e-4, mesh: { nw: 24, M: 20, ny: 4, nyb: 8, grade: 4 }, test: { Et: 0, Dconst: 1e-30 }, snapX: [6] });
  const r = X.dmpDry(o), sn = r.snaps[r.snaps.length - 1], ax = r.ax, nz = ax.nz;
  const ci = r.cols.reduce((p, c, i) => (!c.film && Math.abs(c.y - 0.05) < Math.abs(r.cols[p].y - 0.05) ? i : p), 0), col = r.cols[ci];
  const Tz = ax.zw.map((_, k) => sn.T[ci * nz + k]), t = o.webT;
  const P = o.P, rho = P * 0.0289647 / (8.314462618 * (80 + 273.15)), cpa = 1007, u = col.uIn;   // (the air through it: the zone's at the plenum's viscosity, the web's at its own)
  const epsW = o.webEps, kA = D.drAir(50, P).k, kF = o.kFib, kWeb = kA * (2 * kA + kF - 2 * (1 - epsW) * (kA - kF)) / (2 * kA + kF + (1 - epsW) * (kA - kF));
  const hT = D.drJets({ U: 10, T: 130, B: 0.005, H: 0.02, S: 0.1 }, P).h, hN = D.drNat(Tz[0], 80, 0, 0, o.Lnat, P, 'down').h;
  // T = A + B e^{λ z}, λ = ρ c u / k: −k T'(0) = ρ c u (Tin − T(0)) + h_N (Ta − T(0)); k T'(t) = h_T (Tj − T(t))
  const lam = rho * cpa * u / kWeb, E = Math.exp(lam * t);
  // unknowns A, B: (ρcu + h_N) A + (ρcu + h_N + k λ) B = (ρcu + h_N) 80 ... from the two conditions
  const a11 = rho * cpa * u + hN, a12 = rho * cpa * u + hN - kWeb * lam, b1 = (rho * cpa * u + hN) * 80;
  const a21 = hT, a22 = kWeb * lam * E + hT * E, b2 = hT * 130;
  const det = a11 * a22 - a12 * a21, A = (b1 * a22 - a12 * b2) / det, B = (a11 * b2 - a21 * b1) / det;
  const err = Math.max(...ax.zw.map((z, k) => Math.abs(Tz[k] - (A + B * Math.exp(lam * z)))));
  check('the air through the bare web, steady: its temperature through the web against the exact exponential within 0.02 K', err < 0.02,
    `the air in at ${col.uIn.toFixed(3)} m/s (the zone's ${Z.airU}); bottom ${Tz[0].toFixed(2)}, top ${Tz[Tz.length - 1].toFixed(2)} °C; largest difference ${err.toFixed(3)} K (Péclet ${(lam * t).toFixed(2)})`);
}

// ---- 5. Darcy under a sealed film ----
{
  // the film across the whole web: the plenum below at Δp, the web's edges open, its top sealed. Exact (Fourier):
  // p/Δp = 1 − Σ a_n cosh(μ_n (y − W/2)) / cosh(μ_n W/2) sin(μ_n z), μ_n = (2n+1)π/(2t), a_n = 4/((2n+1)π).
  const W = 0.02, t = 3e-4, prof = { y: [0, W], h: [1e-3, 1e-3] };
  const o = base({ dim: 2, W, prof, webT: t, zones: [{ len: 0.02, airU: 1, airT: 100, rh: 0.2, top: 'none' }], room: { len: 0, T: 25, rh: 0.5 }, U: 0.05, mesh: { nw: 16, M: 10, ny: 60, grade: 40 }, test: { Et: 0, Dconst: 1e-30 } });
  const r = X.dmpDry(o), ax = r.ax, nwN = ax.nw + 1;
  // (the plenum's Δp at the zone's air: the run's own)
  const dp = r.darcy.dp.find(z => z.name === 'zone 1').dp;
  const exact = (y, z) => { let s = 0; for (let n = 0; n < 400; n++) { const m = (2 * n + 1) * Math.PI / (2 * t), a = 4 / ((2 * n + 1) * Math.PI); const arg = m * Math.abs(y - W / 2), cap = m * W / 2; s += a * (cap - arg > 700 ? 0 : Math.exp(-(cap - arg)) * (1 + Math.exp(-2 * arg)) / (1 + Math.exp(-2 * cap))) * Math.sin(m * z); } return 1 - s; };
  // the field at the run's end (the last snapshot's), the nodes within 2 mm of an edge, not at the corners
  const sn = r.snaps[r.snaps.length - 1];
  let err = 0, nn = 0;
  for (let iy = 1; iy < ax.ys.length - 1; iy++) for (let k = 1; k < ax.nw; k++) { const y = ax.ys[iy], z = ax.zw[k]; if (Math.min(y, W - y) > 2e-3) continue; const v = sn.p[iy * nwN + k] / dp, e = exact(y, z); err = Math.max(err, Math.abs(v - e)); nn++; }
  check('Darcy under a sealed film: the pressure near the open edges against the exact series within 2 % of the plenum\'s', err < 0.02, `${nn} nodes, largest ${(100 * err).toFixed(2)} %`);
  const mid = sn.p[Math.floor((ax.ys.length - 1) / 2) * nwN + ax.nw] / dp;
  check('Darcy under a sealed film: the middle at the plenum\'s pressure (no flow through), 2 mm from the edges the flow gone', Math.abs(mid - 1) < 1e-3, `p/Δp at the middle's top ${mid.toFixed(5)}`);
}

// ---- 6. 2D = 1D, 3D = 2D ----
{
  const W = 0.3, prof = { y: [0, W], h: [1.72e-3, 1.72e-3] }, Zs = [0, 1, 2].map(() => ({ len: 2, airU: 0, airT: 100, rh: 0.2, top: 'none' }));
  const a = X.dmpDry(base({ zones: Zs })), b = X.dmpDry(base({ dim: 2, W, prof, zones: Zs, mesh: { nw: 4, M: 40, ny: 6 }, test: { sides: false } }));
  const d = Math.max(...b.cols.map(c => rel(c.exit.water, a.cols[0].exit.water)));
  check('2D with the film even across a sealed web, its edges sealed: every place as the 1D within 1e-8', d < 1e-8, `largest ${d.toExponential(1)}`);
  check('2D: water and energy conserved', wBal(b) < 1e-9 && Math.abs(eBal(b.energy)) < 1e-3, `water ${wBal(b).toExponential(1)}, energy ${eBal(b.energy).toExponential(1)}`);
  const Z1 = [{ len: 6, airU: 1, airT: 100, rh: 0.2, top: 'none' }], prof2 = { y: [0.02, 0.28], h: [1.72e-3, 1.72e-3] }, mesh = { nw: 4, M: 40, ny: 6, nyb: 2, nx: 2, Lx: 0.001 };
  const c2 = X.dmpDry(base({ dim: 2, W, prof: prof2, zones: Z1, mesh })), c3 = X.dmpDry(base({ dim: 3, W, prof: prof2, zones: Z1, mesh, test: { sameX: true } }));
  let m = 0; for (const c of c3.cols) if (c.film) m = Math.max(m, rel(c.exit.water, c2.cols.find(q => q.iy === c.iy).exit.water));
  check('3D, every point at the piece\'s middle\'s place: as the 2D within 1e-8', m < 1e-8, `largest ${m.toExponential(1)}`);
  check('3D: water and energy conserved', wBal(c3) < 1e-9 && Math.abs(eBal(c3.energy)) < 1e-3, `water ${wBal(c3).toExponential(1)}, energy ${eBal(c3.energy).toExponential(1)}`);
}

// ---- 7. the stress ----
{
  // the section: a web and three film layers, even across, held flat; each layer's natural strain given (the same
  // across and along). Laminate: ε0 = Σ Q t ε* / Σ Q t, σ = Q (ε0 − ε*), Q = E / (1 − ν) in the plane (σ through = 0).
  const W = 0.05, tw = 3e-4, tl = [2e-5, 2e-5, 2e-5], en = [-1e-3, -2e-3, -3e-3], Ew = 1e9, nuw = 0.3, Ef = 20e9, nuf = 0.2;
  const web = { Ep: Ew, Et: Ew * 0.1, nup: nuw, nupt: 0.1, Gpt: Ew * 0.05 }, film = { Ep: Ef, Et: 3e9, nup: nuf, nupt: 0.1, Gpt: 1e9 };
  const zAx = [{ L: tw, n: 4 }, ...tl.map(L => ({ L, n: 2 }))];
  const layerOf = z => (z < tw ? -1 : Math.min(2, Math.floor((z - tw) / tl[0])));
  const Q = [Ew / (1 - nuw), Ef / (1 - nuf)], sumQt = Q[0] * tw + tl.reduce((s, t) => s + Q[1] * t, 0), e0 = tl.reduce((s, t, i) => s + Q[1] * t * en[i], 0) / sumQt;
  const run = dim => {
    const axes = dim === 2 ? [[{ L: W, n: 60, grade: 200, end: 'both' }], zAx] : [[{ L: 0.002, n: 2 }], [{ L: W, n: 20, grade: 10, end: 'both' }], zAx];
    const Ms = MP.mpMesh({ dim, p: 1, axes, mat: (ijk, seg) => (seg[dim - 1] === 0 ? 0 : 1) });
    const eig = (m, x) => { if (m === 0) return [0, 0, 0, 0, 0, 0]; const v = en[layerOf(x[dim - 1])]; return dim === 2 ? [v, 0, v, 0, 0, 0] : [v, v, 0, 0, 0, 0]; };
    const bc = [{ face: dim === 2 ? 'y0' : 'z0', fix: [dim - 1] }, { node: Ms.node(dim === 2 ? [Math.round((Ms.nn[0] - 1) / 2), 0] : [0, Math.round((Ms.nn[1] - 1) / 2), 0]), fix: [dim === 2 ? 0 : 1] }];
    if (dim === 3) bc.push({ face: 'x0', fix: [0] });
    return { Ms, r: X.dmpSection(Ms, [web, film], eig, null, bc, 0.002) };
  };
  const s2 = run(2), at = (S, yW, layer, comp) => { let best = null, bd = Infinity; for (const g of S.r.gp) { const dim = S.Ms.dim, y = g.x[dim === 2 ? 0 : 1], z = g.x[dim - 1]; if (layerOf(z) !== layer) continue; const d = Math.abs(y - yW); if (d < bd) { bd = d; best = g; } } return best.stress[comp]; };
  const errs = [0, 1, 2].map(i => { const ex = Q[1] * (e0 - en[i]); return Math.max(rel(at(s2, W / 2, i, 0), ex), rel(at(s2, W / 2, i, 2), ex)); });
  check('the section held flat, its middle: each film layer\'s stress across and along as the laminate\'s within 0.5 %', Math.max(...errs) < 5e-3, errs.map((e, i) => `layer ${i + 1} ${(Q[1] * (e0 - en[i]) / 1e6).toFixed(2)} MPa, ${(100 * e).toFixed(3)} %`).join('; '));
  check('the section: along the line its strain the laminate\'s (no net force)', rel(s2.r.eps0, e0) < 5e-3, `${s2.r.eps0.toExponential(4)} against ${e0.toExponential(4)}`);
  // (free across its edges: at every place across, the section's force across -- its stress across through its
  //  thickness -- nothing, the edge's element column included)
  const rule = MP.mpRule(1, 2, 2), dN = new Float64Array(8), Nx = new Map();
  for (const g of s2.r.gp) { const iy = s2.Ms.eijk[g.e * 2], j = MP.mpJac(s2.Ms, g.e, rule[g.qi], dN), wdt = s2.Ms.edges[0][iy + 1] - s2.Ms.edges[0][iy]; Nx.set(iy, (Nx.get(iy) || 0) + g.stress[0] * rule[g.qi].w * j.det / wdt); }
  const scaleN = Q[0] * tw * Math.abs(e0) + tl.reduce((sm, t, i) => sm + Q[1] * t * Math.abs(e0 - en[i]), 0), worst = Math.max(...[...Nx.values()].map(Math.abs)) / scaleN;
  check('the section free across its edges: its force across nothing at every place across (the edge\'s elements too), within 1 % of its layers\'', worst < 0.01, `largest ${(100 * worst).toFixed(3)} % over ${Nx.size} element columns`);
  const s3 = run(3), e3 = [0, 1, 2].map(i => Math.max(rel(at(s3, W / 2, i, 0), Q[1] * (e0 - en[i])), rel(at(s3, W / 2, i, 1), Q[1] * (e0 - en[i]))));
  check('the piece (3D) held flat, its middle: as the laminate within 1 %', Math.max(...e3) < 0.01, e3.map(e => (100 * e).toFixed(3) + ' %').join(', '));
}
{
  // on the drying (2D, the film across the whole web, its edges sealed): the layers bonded to the web (the underside's
  // skin) against film.js's laminate on the same place's history; the skin over the wet film held along the line
  const W = 0.3, prof = { y: [0, W], h: [1.72e-3, 1.72e-3] }, stress = { film: { Ep: 20e9, Et: 3e9, nup: 0.2, nupt: 0.1, Gpt: 1e9, beta: 0.08, alphaF: 0, Xh: 0.15 },
    web: { Ew: 1e9, nuw: 0.3, alphaW: 20e-6, tw: 3e-4, soft: 0.1, nupt: 0.1 }, gel: { Eg: 1e5, nu: 0.45 }, gab: { Xm: 0.07, C: 8, K: 0.8 }, rhoS: 1900, rhoL: 1000, skinK: 1e-12, K: 60 };
  let dbg = null;
  X.dmpDry(base({ where: 'both', dim: 2, W, prof, mesh: { nw: 4, M: 40, ny: 4 }, stress, stressN: 48, test: { sides: false }, debugStress: d => { dbg = d; } }));
  const bottom = dbg.fe.filter(p => p[0] < dbg.kb), lam = new Map(dbg.lam.map(p => [p[0], p[1]]));
  const big = Math.max(...[...lam.values()].filter(Number.isFinite).map(Math.abs)), e = Math.max(...bottom.map(p => Math.abs(p[1] - lam.get(p[0])) / big));
  check('on the drying: the layers bonded to the web, their stress across as film.js\'s laminate within 10 % of its largest', e < 0.1, `${bottom.length} points, largest difference ${(100 * e).toFixed(1)} %`);
}

// ---- 8. the mesh ----
{
  const W = 0.3, prof = { y: [0.02, 0.28], h: [1.4e-3, 1.8e-3] }, Z1 = [{ len: 3, airU: 1, airT: 100, rh: 0.2, top: 'none' }];
  const run = mesh => X.dmpDry(base({ dim: 2, W, prof, zones: Z1, mesh: { nw: 4, nyb: 2, ...mesh } }));
  const a = run({ M: 20, ny: 8 }), b = run({ M: 40, ny: 8 }), c = run({ M: 40, ny: 16 });
  const mid = r => r.cols[r.follow.mid].exit.water, ws = r => r.water.end;
  check('the mesh through the film (20 → 40 nodes): the middle\'s water at the exit within 0.5 %', rel(mid(a), mid(b)) < 5e-3, `${mid(a).toFixed(4)} → ${mid(b).toFixed(4)} kg/m²`);
  check('the mesh across (8 → 16 elements): the film\'s mean water at the exit within 0.5 %', rel(ws(b), ws(c)) < 5e-3, `${ws(b).toFixed(4)} → ${ws(c).toFixed(4)} kg/m²`);
}

// ---- 10. a place's water in parts ----
{
  const W = 0.3, prof = { y: [0.02, 0.28], h: [1.4e-3, 1.8e-3] }, Z1 = [{ len: 3, airU: 1, airT: 100, rh: 0.2, top: 'none' }];
  const run = (dim, test, mesh = {}) => X.dmpDry(base({ dim, W, prof, zones: Z1, mesh: { nw: 4, M: 20, ny: 8, nyb: 2, nx: 3, Lx: 0.1, ...mesh }, test }));
  const a = run(2, {}), b = run(2, { parts: 4 }), at = (r, k) => r.cols[r.follow[k]].exit.water;
  const e = Math.max(...['mid', 'endL', 'endR'].map(k => rel(at(b, k), at(a, k))));
  check('a place\'s water in 4 parts each step: the middle and the film\'s ends at the exit as with whole steps within 0.5 %', e < 5e-3,
    `middle ${at(b, 'mid').toFixed(4)} against ${at(a, 'mid').toFixed(4)}, ends ${at(b, 'endL').toFixed(4)} against ${at(a, 'endL').toFixed(4)} kg/m²`);
  check('in parts: water conserved to the water step\'s own tolerance (1e-7), energy within 0.2 %', wBal(b) < 1e-7 && Math.abs(eBal(b.energy)) < 2e-3, `water ${wBal(b).toExponential(1)}, energy ${eBal(b.energy).toExponential(1)}`);
  const c = run(3, {});
  check('3D with the film\'s ends heated from their sides: water and energy conserved', wBal(c) < 1e-7 && Math.abs(eBal(c.energy)) < 2e-3,
    `water ${wBal(c).toExponential(1)}, energy ${eBal(c.energy).toExponential(1)}; ${c.nSteps} steps, ${c.stats.sub} places in parts`);
}

// ---- 11. the stress's solves; the 3D piece on the running line ----
{
  const W = 0.3, prof = { y: [0, W], h: [1.6e-3, 1.6e-3] }, Z1 = [{ len: 3, airU: 1, airT: 100, rh: 0.2, top: 'none' }];
  const stress = { film: { Ep: 20e9, Et: 3e9, nup: 0.2, nupt: 0.1, Gpt: 1e9, beta: 0.08, alphaF: 0, Xh: 0.15 },
    web: { Ew: 1e9, nuw: 0.3, alphaW: 20e-6, tw: 3e-4, soft: 0.1, nupt: 0.1 }, gel: { Eg: 1e5, nu: 0.45 }, gab: { Xm: 0.07, C: 8, K: 0.8 }, rhoS: 1900, rhoL: 1000, skinK: 1e-12, K: 60 };
  const at = (stressN, dim = 2, mesh = {}, more = {}) => X.dmpDry(base({ dim, W, prof, zones: Z1, mesh: { nw: 4, M: 30, ny: 8, grade: 20, nx: 4, Lx: 0.1, ...mesh }, N: 60, stress, stressN, ...more }));
  const last = r => r.stress.series[r.stress.series.length - 1];
  const a = at(48), ref = at(100000), em = rel(last(a).mid, last(ref).mid), ea = rel(last(a).any, last(ref).any);
  check('the stress\'s 48 solves along the line: the middle\'s and the largest set-film stress at the exit as a solve at every drying step\'s within 1 %', em < 0.01 && ea < 0.01,
    `middle ${(last(a).mid / 1e6).toFixed(3)} against ${(last(ref).mid / 1e6).toFixed(3)} MPa (${ref.stress.series.length} solves), largest ${(last(a).any / 1e6).toFixed(3)} against ${(last(ref).any / 1e6).toFixed(3)} MPa`);
  let top = null;
  const p3 = at(24, 3, { ny: 6 }, { debugTop: d => { top = d; } }), iyM = 3;
  // (coated all at once, they would form 100 mm apart -- the piece's length; the skin is found at a step's start, so
  //  within the drying's largest step along the line)
  const sk = p3.cols.filter(c => c.film && c.iy === iyM).map(c => c.events.skinTop), spread = Math.max(...sk) - Math.min(...sk), step = (p3.xOven - p3.xStart) / 150;
  check('3D, the piece on the running line (coated as it passes the coater): its places\' skins form at one place on the line, within the drying\'s largest step along it', spread <= step + 1e-9,
    `${sk.length} places along the 100 mm piece: from ${Math.min(...sk).toFixed(4)} to ${Math.max(...sk).toFixed(4)} m (largest step ${(1000 * step).toFixed(1)} mm)`);
  const along = top.filter(t => t[1] === iyM).sort((p, q) => p[0] - q[0]).map(t => t[2]), big = Math.max(...along.map(Math.abs));
  const jump = Math.max(...along.slice(1).map((v, i) => Math.abs(v - along[i]))) / big;
  check('3D: the set film\'s stress along the piece smooth (neighbouring places within 10 % of the largest)', jump < 0.1, along.map(v => (v / 1e6).toFixed(2)).join(', ') + ' MPa');
}

// ---- 9. the finding: the air through the web under the wet film ----
{
  const W = 0.3, prof = { y: [0.02, 0.28], h: [1.72e-3, 1.72e-3] };
  const a = X.dmpDry(base({ zones: base().zones.map(z => ({ ...z, airU: 0 })) })), b = X.dmpDry(base({ dim: 2, W, prof, mesh: { nw: 4, M: 40, ny: 12, nyb: 3 } }));
  const s = b.series.find(q => q.zone === 'zone 2');
  check('with the wet film sealing the web, the plenum\'s air passes the bare web and hardly under the film', s.under < 1e-3 * 1 && s.bare && s.bare.uIn > 0.9,
    `under the film ${(s.under * 1000).toFixed(3)} mm/s, through the bare web ${s.bare.uIn.toFixed(2)} m/s (the zone's 1 m/s)`);
  check('the film\'s middle then dries as with no air from below (1D, the zones\' air speed 0) within 1 %', rel(b.cols[b.follow.mid].exit.water, a.cols[0].exit.water) < 0.01,
    `${b.cols[b.follow.mid].exit.water.toFixed(4)} against ${a.cols[0].exit.water.toFixed(4)} kg/m²`);
}

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exitCode = fails ? 1 : 0;
