'use strict';
/*
 * drying-mp.js — MP-5: the wet film drying on its fibre web through the room and the oven, in 1D, 2D and 3D: its heat,
 * its water, the oven's air through the web and the drying stress, solved together. Pure computation, no DOM: the
 * multiphysics worker and Node.
 *
 * The domain moves with the line (time = distance / line speed):
 *  - 1D: through the web and the film at one place across the web: drying.js's strip, the web resolved.
 *  - 2D: a section across the web, its full width: the wet film's thickness across it as the coating leaves it, the
 *    bare web beyond the film's ends; through the web and the film.
 *  - 3D: a piece of the line Lx long across the web's full width, through the web and the film; each point at its own
 *    place on the line (where a zone ends, the change passes along the piece).
 * The physics:
 *  - Water (drying.js's, the same code: drWaterStep): through the film at each place, in the GO's own coordinate ζ, the
 *    flakes' collective diffusion, a skin where the solids reach the dry packing, the water leaving through the skin as
 *    vapour (its permeability) into the gas side above (and below, where the water leaves both ways). Along the film the
 *    water moves by the same diffusion over the mesh's spacing across the web: a share D t / Δy² of the water (a check
 *    value in the results, about 10⁻⁵), not stepped. The film's side faces at its ends: their heat with the oven's air;
 *    their water sealed (a side face dries the film only as far in as a skin grows, a fraction of a millimetre, and the
 *    flakes' diffusion along cannot bring water to it from further in).
 *  - Heat: the web and the film in 1D, 2D or 3D (implicit Euler, the vertex-centred finite volumes of linear elements):
 *    the film in ζ (its conductance through it k / (dz/dζ), along it k dz/dζ: the flakes lying flat, in series through
 *    and in parallel along), the web its fibres in the air (Maxwell–Eucken), the air through it carrying heat (the
 *    fluxes exponentially fitted: exact for steady flow along a link).
 *    Evaporation takes its latent heat where the water leaves: the wet surface, or a skin's front inside the film
 *    (drying.js's sinks). Faces: the top as drying.js's (still air or slot jets, the walls' radiation, IR), the bare
 *    web's top alike; the web's underside the plenum's air coming in at its temperature and natural convection under it;
 *    the film's and the web's edges the oven's air; the 3D piece's ends adiabatic (the line continues).
 *  - The air through the web (Darcy, 2D and 3D): k_D/μ ∇²p = 0 in the web; the plenum under a zone that blows at the
 *    pressure that drives its air speed through the bare web (Δp = μ u t / k_D), the bare web's top and the web's edges
 *    open (p = 0), the wet film on top sealed. 1D: drying.js's: the air passes up through the web and leaves under the
 *    film. Where the water leaves both ways, the film's underside dries into the air that came in below it (drying.js's
 *    supply) and by diffusion through the web's pores to the plenum's air.
 *  - Stress (film.js's): a layer of the film sets stress free when a skin's front passes it, then shrinks and swells with
 *    its water and temperature; the wet film under a skin a gel (its stiffness, the Film card's); the web with its
 *    temperature; held flat (the web's underside). 1D: film.js's laminate on the drying's history. 2D: plane-strain
 *    elements across the web, free along the line with no net force (generalized plane strain); 3D: the piece's elements,
 *    its ends a common strain with no net force. Each layer's natural strain from the strain it had when it set.
 * SI inside (m, s, kg, Pa); temperatures in °C.
 */
const DMP_DR = typeof drStrip === 'function' ? { drPsat, drTsat, drLatent, drAir, drNat, drGAB, drD0, drDphiZ, drDcoll, drFaces, drB, drUse, drStretches, drTopSide,
  drBottomSide, drSideState, drConstantRate, drWaterStep } : require('./drying.js');
const DMP_MP = typeof mpMesh === 'function' ? { mpMesh, mpElastic, mpRule, mpJac, mpAxisEdges, mpBand, mpAdd, mpFactor, mpBackSolve, mpFix }
  : require('./mp-core.js');
const DMP_FM = typeof fmHistory === 'function' ? { fmHistory } : typeof require === 'function' ? require('./film.js') : {};   // (the page draws with dmpAxes only)
const DMP_R = 8.314462618, DMP_MW = 0.018015268, DMP_KL = 0.6, DMP_KAIR = 0.03;   // (drying.js's: liquid water's, the skin's air's conductivity)

/** Linear interpolation of ys over xs (sorted) at x, held at the ends. */
function dmpInterp(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  const n = xs.length - 1;
  if (x >= xs[n]) return ys[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
}

/**
 * drying.js's drEvap with the gas side made of paths side by side (the film's underside: the air that came in below it,
 * 'supply', and diffusion through the web's pores to the plenum's air, 'log'): evaporation (kg/(m² s)) from water at pf
 * through a skin delta thick (K: its permeability) into the paths [{ kind, G, C, pa }] (one air: one pa).
 */
function dmpEvap(pf, delta, K, gases, P) {
  const Pm = P * (1 - 1e-12), cap = p => Math.min(p, Pm), pa = gases[0].pa;
  const out = p => { let s = 0; for (const g of gases) s += g.kind === 'log' ? g.G * g.C * Math.log((P - g.pa) / (P - cap(p))) : g.G * g.C * (cap(p) - g.pa) / (P - cap(p)); return s; };
  if (!(delta > 0)) return { m: out(pf), pi: cap(pf) };
  const kd = K / delta, g = p => out(p) - kd * (pf - p);
  let lo = Math.min(pf, pa), hi = Math.min(Math.max(pf, pa), Pm);
  if (g(lo) > 0) return { m: out(lo), pi: lo };
  if (g(hi) < 0) return { m: out(hi), pi: hi };
  let p = 0.5 * (lo + hi);
  for (let it = 0; it < 60; it++) {
    const gv = g(p);
    if (gv > 0) hi = p; else lo = p;
    const dp = Math.max(1e-9 * P, 1e-6 * p), dg = (g(Math.min(p + dp, Pm)) - gv) / dp;
    let pn = p - gv / dg;
    if (!(pn > lo && pn < hi)) pn = 0.5 * (lo + hi);
    if (Math.abs(pn - p) < 1e-10 * P) { p = pn; break; }
    p = pn;
  }
  return { m: kd * (pf - p), pi: p };
}
/** The film's underside's gas side at Tb with the vapour pressure pvs there: the air in at uIn (m/s) below it, and the web's pores to the plenum's air. */
function dmpBotGases(Z, Tb, pvs, o, uIn) {
  const P = o.P, n = DMP_DR.drNat(Tb, Z.Ta, pvs, Z.pa, o.Lnat, P, 'down'), a = DMP_DR.drAir((Tb + Z.Ta) / 2, P);
  const gd = 1 / (1 / n.km + o.webT / (Math.pow(o.webEps, 1.5) * a.Dv));   // (the pores: Bruggeman's ε^1.5)
  return [{ kind: 'supply', G: o.airFrac * Math.max(uIn, 0), C: P * DMP_MW / (DMP_R * (Z.Ta + 273.15)), pa: Z.pa },
    { kind: 'log', G: o.airFrac * gd, C: P * DMP_MW / (DMP_R * ((Tb + Z.Ta) / 2 + 273.15)), pa: Z.pa }];
}
/** The film's underside: evaporation (kg/(m² s)) from water at Tf under a skin delta thick, the surface at Tsurf, and the surface's vapour pressure. */
function dmpBotState(Z, Tf, Tsurf, delta, o, uIn) {
  const pf = DMP_DR.drPsat(Tf), P = o.P;
  if (!(delta > 0)) return { m: dmpEvap(pf, 0, 0, dmpBotGases(Z, Tsurf, pf, o, uIn), P).m, pv: pf };
  let pv = Math.min(pf, DMP_DR.drPsat(Tsurf)), r;
  for (let k = 0; k < 2; k++) { r = dmpEvap(pf, delta, o.skinK, dmpBotGases(Z, Tsurf, pv, o, uIn), P); pv = r.pi; }
  return { m: r.m, pv };
}

/**
 * The domain and its mesh (the solve's and the page's drawings). o: dmpDry's (dim, W, webT, h0 (1D) or prof {y, h} (2D,
 * 3D: the wet film across the web, m), mesh { ny (across the film), nyb (across each bare margin), grade, nw (through
 * the web), M (through the film), nx, Lx (3D: along the line) }).
 * Returns { dim, W, a, b (the film's ends), ys, xs (the places' positions), h0 (the wet film at each across), zw (the web's
 * nodes), nw, M, sF (the film's nodes through it, 0..1 of its GO), nz (nodes per place), nCol, nxN, nyN }.
 */
function dmpAxes(o) {
  const dim = o.dim, ms = o.mesh || {}, W = dim === 1 ? 0 : o.W, nw = ms.nw || 6, M = 2 * Math.ceil((ms.M || 40) / 2);
  let a = 0, b = W;
  const prof = o.prof;
  if (dim > 1) {
    if (!prof || prof.y.length < 2) throw new Error('drying multiphysics: no wet film across the web');
    a = Math.max(0, prof.y[0]); b = Math.min(W, prof.y[prof.y.length - 1]);
    if (!(b > a)) throw new Error('drying multiphysics: the film is not on the web');
  }
  const gr = ms.grade || 6, segs = [];
  if (a > 1e-9) segs.push({ L: a, n: ms.nyb || 4, grade: gr, end: 'hi' });
  segs.push({ L: b - a, n: ms.ny || 24, grade: gr, end: 'both' });
  if (W - b > 1e-9) segs.push({ L: W - b, n: ms.nyb || 4, grade: gr, end: 'lo' });
  const ys = dim === 1 ? [0] : DMP_MP.mpAxisEdges(segs, 0).edges;
  const Lx = dim === 3 ? (ms.Lx || 0.1) : 0, xs = dim === 3 ? DMP_MP.mpAxisEdges([{ L: Lx, n: ms.nx || 4 }], 0).edges : [0];
  const h0 = ys.map(y => (dim === 1 ? o.h0 : y < a - 1e-12 || y > b + 1e-12 ? 0 : Math.max(0, dmpInterp(prof.y, prof.h, y))));
  const zw = DMP_MP.mpAxisEdges([{ L: o.webT, n: nw }], 0).edges, sF = DMP_DR.drFaces(M, 1e-3);
  const nxN = xs.length, nyN = ys.length;
  return { dim, W, a, b, ys, xs, Lx, h0, zw, nw, M, sF, nz: nw + M + 1, nCol: nxN * nyN, nxN, nyN };
}

/**
 * The film on its web through the room and the oven (and the room after it, when asked). o: drying.js's strip inputs
 * (phi0, phiM, rhoS, rhoL, R, mul, skinK, kS, cS, emis, irAbs, gab, web { mass, cp }, airFrac, U, Lnat, P, Tin, room,
 * zones, after, where 'top' | 'both', N (water cells), props), and
 *   dim, h0 (1D: the wet film, m) or prof { y, h } (2D, 3D: across the web, m) and W (the web's width, m), kIn (GO's
 *   conductivity along the film), webT (the web's thickness, m), webEps (its porosity), webK (its permeability, m²),
 *   kFib (its fibres' conductivity), mesh (dmpAxes's), dtScale, snapX ([line positions, m]: the fields kept there),
 *   stress: film.js's opts { film, web, gel, gab, rhoS, rhoL, skinK, K } (null: none), stressN (2D, 3D: the solves),
 *   test: { dr (drying.js's closures and its web lumped: the 1D checks), sides: false (the edges sealed and adiabatic), sameX
 *   (3D: every point at the piece's middle's place on the line: the check against the 2D),
 *   T, Et, Eb, Dconst, noSkinR (drying.js's) }, onProgress ({ k, n }).
 * Returns { dim, ax, series, snaps, cols (each place's events, exit), summary, energy, water, darcy, stress, mesh, ms }.
 */
function dmpDry(o) {
  const tStart = Date.now();
  DMP_DR.drUse(o.props);
  const cw = o.props && Number.isFinite(o.props.waterCp) ? o.props.waterCp : 4180, cpa = o.props && Number.isFinite(o.props.airCp) ? o.props.airCp : 1007;
  const dim = o.dim, P = o.P, TT = o.test || {}, ax = dmpAxes(o), { nw, M, sF, nz, nCol, nxN, nyN, xs, ys, zw } = ax;
  const N = 2 * Math.ceil((o.N || 80) / 2), phiM = o.phiM, em = (1 - phiM) / phiM, e0 = (1 - o.phi0) / o.phi0, rhoL = o.rhoL, rhoS = o.rhoS;
  const both = o.where === 'both', Tboil = DMP_DR.drTsat(P);
  if (!(phiM > o.phi0 * 1.001)) throw new Error(`the dry film's packing (${phiM}) is not above the slurry's solids (${+(o.phi0 * 100).toFixed(2)} vol%): the film would not shrink as it dries (Materials)`);
  if (!(o.U > 0)) throw new Error('the line is not moving');
  const Zs = DMP_DR.drStretches(o), xEnd = Zs[Zs.length - 1].x1, xStart = Zs[0].x0;
  const Zl = [...Zs].reverse().find(Z => Z.name !== 'after'), aExit = Math.min(1, Zl.pa / DMP_DR.drPsat(Zl.Ta)), Xb = DMP_DR.drGAB(aExit, o.gab, Zl.Ta);
  const xOven = Zs.filter(Z => Z.name !== 'after').pop().x1;
  const es = Math.min(Xb * rhoS / rhoL, 0.9 * em);
  const stretchAt = xv => { for (const Z of Zs) if (xv < Z.x1 - 1e-12) return Z; return Zs[Zs.length - 1]; };
  // ---- the web ----
  const tf = o.webT, epsW = TT.dr ? 0.5 : o.webEps, rhoW = o.web.mass / tf;   // (its fibres per volume of web)
  const kA = DMP_DR.drAir(50, P).k, kF = o.kFib;
  const kWeb = TT.dr ? 1e3 : kA * (2 * kA + kF - 2 * (1 - epsW) * (kA - kF)) / (2 * kA + kF + (1 - epsW) * (kA - kF));   // (Maxwell–Eucken, the air around the fibres)
  const cWeb = rhoW * o.web.cp + (TT.dr ? 0 : epsW * DMP_DR.drAir(50, P).rho * cpa);
  // ---- the places (columns) ----
  const dxD = xs.map((_, i) => (dim < 3 ? 1 : ((xs[Math.min(i + 1, nxN - 1)] - xs[Math.max(i - 1, 0)]) / 2)));
  const dyD = ys.map((_, i) => (dim < 2 ? 1 : ((ys[Math.min(i + 1, nyN - 1)] - ys[Math.max(i - 1, 0)]) / 2)));
  const colOf = (ix, iy) => ix + nxN * iy, node = (c, k) => c * nz + k;
  const Dphi = ev => { const p = Math.min(1 / (1 + Math.max(ev, 0)), phiM); return Math.exp(6.55 * Math.log1p(-p)) * DMP_DR.drDphiZ(p, phiM) * p * p; };
  const D0T = Tv => DMP_DR.drD0(Tv, o.R) * o.mul;
  const Dz = (ev, Tv) => (TT.Dconst ? TT.Dconst : D0T(Tv) * Dphi(ev));
  const stats = { water: 0, newton: 0, picard: 0, rejected: 0, gmres: 0, sub: 0 };
  const cols = [];
  for (let iy = 0; iy < nyN; iy++) for (let ix = 0; ix < nxN; ix++) {
    const h0 = ax.h0[iy], Phi = o.phi0 * h0, film = Phi > 0;
    const c = { ix, iy, x: TT.sameX ? 0 : xs[ix] - ax.Lx / 2, y: ys[iy], A: dxD[ix] * dyD[iy], h0, Phi, film, sT: sF.map(v => v * Phi),
      // (the film's end: its side face to the oven's air -- where the place across has no film beside it)
      end: film && dim > 1 && TT.sides !== false && (iy === 0 || iy === nyN - 1 || !(ax.h0[iy - 1] > 0) || !(ax.h0[iy + 1] > 0)),
      edge: dim > 1 && (iy === 0 || iy === nyN - 1), uIn: 0, events: { skinTop: null, skinBottom: null, dry: null, boil: null, condense: null },
      evT: 0, evB: 0, lost: 0, hist: null };
    if (film) {
      // drying.js's wet grid: its thinnest cell from the drying Peclet numbers the stretches give this film
      const Rf = h0 / (1 / (o.phi0 / o.kS + (1 - o.phi0) / DMP_KL));
      let peMax = 1;
      if (TT.Dconst) peMax = Math.abs(TT.Et != null ? TT.Et : 1e-3) / rhoL * Phi / TT.Dconst;
      else for (const Z of Zs) { const r = DMP_DR.drConstantRate(Z, Rf, o.where, o), Tm = (r.Ts + r.Tb) / 2; peMax = Math.max(peMax, Math.abs(h0 * (r.mt + r.mb) / rhoL / DMP_DR.drDcoll(o.phi0, Tm, o.R, phiM, o.mul)) || 0); }
      const aWet = o.aWet || Math.min(0.02, Math.max(2e-6, 0.01 / peMax)), s = DMP_DR.drFaces(N, aWet), sc = new Float64Array(N), ds = new Float64Array(N);
      for (let j = 0; j < N; j++) { sc[j] = (s[j] + s[j + 1]) / 2; ds[j] = s[j + 1] - s[j]; }
      Object.assign(c, { s, sc, ds, aWet, Pe: peMax, e: new Float64Array(N).fill(e0), zt: Phi, zb: 0, modeT: 'free', modeB: both ? 'free' : 'none', dry: false, wt: 0, wb: 0, W0: e0 * Phi * rhoL,
        hist: { x: [], t: [], zt: [], zb: [], dry: [], Ts: [], Tb: [], pvT: [], pvB: [], Tc: [], zone: [], H: [] } });
      const sideTop = (Z, Tf, Tsurf, delta) => DMP_DR.drSideState(DMP_DR.drTopSide, Z, Tf, Tsurf, TT.noSkinR ? 0 : delta, o);
      const sideBot = (Z, Tf, Tsurf, delta) => (TT.dr ? DMP_DR.drSideState(DMP_DR.drBottomSide, Z, Tf, Tsurf, TT.noSkinR ? 0 : delta, o) : dmpBotState(Z, Tf, Tsurf, TT.noSkinR ? 0 : delta, o, c.uIn));
      c.sideTop = sideTop; c.sideBot = sideBot;
      c.evapTop = (Z, Tf, Tsurf, delta) => (TT.Et != null ? TT.Et : sideTop(Z, Tf, Tsurf, delta).m);
      c.evapBot = (Z, Tf, Tsurf, delta) => (TT.Eb != null ? TT.Eb : sideBot(Z, Tf, Tsurf, delta).m);
      c.G = { N, s, sc, ds, Phi, phiM, em, es, e0, rhoL, both, T: TT, D0T, Dphi, evapTop: c.evapTop, evapBot: c.evapBot, stats };
    }
    cols.push(c);
  }
  const filmCols = cols.filter(c => c.film);
  if (!filmCols.length) throw new Error('drying multiphysics: no wet film');
  // the water of a place's film (kg/m²): the wet region's, the skins'; its thickness (m)
  const wetWater = (c, S = c) => { let w = 0; const L = S.zt - S.zb; for (let j = 0; j < N; j++) w += S.e[j] * L * c.ds[j]; return w * rhoL; };
  const skinWater = (c, S = c) => es * (c.Phi - (S.zt - S.zb)) * rhoL;
  // ---- per place: the layers through it (the heat's half cells about each node) ----
  const kWetThr = phi => 1 / (phi / o.kS + (1 - phi) / DMP_KL), kWetIn = phi => phi * o.kIn + (1 - phi) * DMP_KL;
  const sk = Math.max(0, 1 - phiM - es * phiM), kSkinThr = 1 / (phiM / o.kS + es * phiM / DMP_KL + sk / DMP_KAIR), kSkinIn = phiM * o.kIn + es * phiM * DMP_KL + sk * DMP_KAIR;
  const cSkin = rhoS * o.cS + es * rhoL * cw;
  /** Over [za, zb2] of ζ in place c with the water S: physical thickness, heat capacity (J/(m² K)), resistance through (m² K/W), conductance along (W/K). */
  function seg(c, S, za, zb2, out) {
    let dz = 0, C = 0, R = 0, g = 0;
    const add = (dzeta, ev, skin) => {
      if (!(dzeta > 0)) return;
      if (skin) { const d = dzeta / phiM; dz += d; C += dzeta * cSkin; R += d / kSkinThr; g += d * kSkinIn; return; }
      const d = dzeta * (1 + ev), phi = 1 / (1 + ev); dz += d; C += dzeta * (rhoS * o.cS + ev * rhoL * cw); R += d / kWetThr(phi); g += d * kWetIn(phi);
    };
    add(Math.min(zb2, S.zb) - za, 0, true);
    add(zb2 - Math.max(za, S.zt), 0, true);
    const lo = Math.max(za, S.zb), hi = Math.min(zb2, S.zt), L = S.zt - S.zb;
    if (hi > lo && L > 0) {
      let a = 0, b = N - 1;   // (the first wet cell reaching past lo)
      while (a < b) { const m = (a + b) >> 1; if (S.zb + L * c.s[m + 1] <= lo) a = m + 1; else b = m; }
      for (let j = a; j < N; j++) { const z1 = S.zb + L * c.s[j], z2 = S.zb + L * c.s[j + 1]; if (z1 >= hi) break; add(Math.min(hi, z2) - Math.max(lo, z1), S.e[j], false); }
    }
    out[0] = dz; out[1] = C; out[2] = R; out[3] = g;
  }
  // per node: heat capacity per area (cap), resistance per area of its half below (rlo) and above (rhi), conductance along (gin), height (hgt)
  const NN = nCol * nz, cap = new Float64Array(NN), rlo = new Float64Array(NN), rhi = new Float64Array(NN), gin = new Float64Array(NN), hgt = new Float64Array(NN);
  const active = new Uint8Array(NN);
  for (const c of cols) for (let k = 0; k < nz; k++) active[node(cols.indexOf(c), k)] = k <= nw || c.film ? 1 : 0;
  const tmp = [0, 0, 0, 0];
  function layers(ci, S) {
    const c = cols[ci], b0 = ci * nz;
    for (let k = 0; k <= nw; k++) {
      const dlo = k > 0 ? (zw[k] - zw[k - 1]) / 2 : 0, dhi = k < nw ? (zw[k + 1] - zw[k]) / 2 : 0, n = b0 + k;
      cap[n] = cWeb * (dlo + dhi); rlo[n] = dlo / kWeb; rhi[n] = dhi / kWeb; gin[n] = kWeb * (dlo + dhi); hgt[n] = dlo + dhi;
    }
    if (!c.film || !c.coated) return;
    for (let j = 0; j <= M; j++) {
      const n = b0 + nw + j, z = c.sT[j], zl = j > 0 ? (c.sT[j - 1] + z) / 2 : z, zh = j < M ? (z + c.sT[j + 1]) / 2 : z;
      seg(c, S, zl, z, tmp); const dzl = tmp[0], Cl = tmp[1], Rl = tmp[2], gl = tmp[3];
      seg(c, S, z, zh, tmp);
      if (j === 0) { cap[n] += Cl + tmp[1]; rhi[n] = tmp[2]; gin[n] = tmp[3]; hgt[n] = tmp[0]; }   // (the web's top half below it)
      else { cap[n] = Cl + tmp[1]; rlo[n] = Rl; rhi[n] = tmp[2]; gin[n] = gl + tmp[3]; hgt[n] = dzl + tmp[0]; }
    }
  }
  // the temperature at ζ in place c (the film's nodes)
  const Tz = (c, Tv, z) => { const b0 = cols.indexOf(c) * nz + nw; if (z <= 0) return Tv[b0]; if (z >= c.Phi) return Tv[b0 + M]; let lo = 0, hi = M; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c.sT[m] <= z) lo = m; else hi = m; } return Tv[b0 + lo] + (Tv[b0 + hi] - Tv[b0 + lo]) * (z - c.sT[lo]) / (c.sT[hi] - c.sT[lo]); };
  const ciOf = new Map(cols.map((c, i) => [c, i]));
  const Tsurf = (c, Tv) => Tv[ciOf.get(c) * nz + nw + M], Tbot = (c, Tv) => Tv[ciOf.get(c) * nz + nw];
  // ---- the links along the web and the film (2D, 3D): [node a, node b, the face's length across the link, the distance] ----
  const links = [];
  for (let iy = 0; iy < nyN; iy++) for (let ix = 0; ix < nxN; ix++) {
    const c = colOf(ix, iy);
    if (iy + 1 < nyN) { const d = colOf(ix, iy + 1); for (let k = 0; k < nz; k++) if (active[node(c, k)] && active[node(d, k)]) links.push([node(c, k), node(d, k), dxD[ix], ys[iy + 1] - ys[iy], k]); }
    if (ix + 1 < nxN) { const d = colOf(ix + 1, iy); for (let k = 0; k < nz; k++) if (active[node(c, k)] && active[node(d, k)]) links.push([node(c, k), node(d, k), dyD[iy], xs[ix + 1] - xs[ix], k]); }
  }
  // (each node's links: CSR, for the solver's matrix along)
  const nbStart = new Int32Array(NN + 1), nbList = [];
  { const per = Array.from({ length: NN }, () => []); links.forEach((L, li) => { per[L[0]].push(li); per[L[1]].push(li); }); for (let n = 0; n < NN; n++) { nbStart[n] = nbList.length; for (const li of per[n]) nbList.push(li); } nbStart[NN] = nbList.length; }
  // ---- the air through the web ----
  const nwN = nw + 1, darcy = { Fv: new Float64Array(nCol * nw), Fl: new Float64Array(links.length), Fin: new Float64Array(nCol), p: new Float64Array(nCol * nwN), dp: 0, under: 0, total: 0 };
  const dpOf = Z => (Z.bottom.kind === 'air' ? DMP_DR.drAir(Z.Ta, P).mu * Z.bottom.ua * tf / o.webK : 0);
  function solveDarcy(Tv, Zc) {
    darcy.Fv.fill(0); darcy.Fl.fill(0); darcy.Fin.fill(0);
    if (TT.dr) { /* (drying.js: its bottom's own) */ return; }
    if (dim === 1) {
      const u = Zc[0].bottom.kind === 'air' ? Zc[0].bottom.ua : 0;
      for (let k = 0; k < nw; k++) darcy.Fv[k] = u * cols[0].A;
      darcy.Fin[0] = u * cols[0].A; cols[0].uIn = u; darcy.total = darcy.under = u; return;
    }
    if (!Zc.some(Z => Z.bottom.kind === 'air')) { for (const c of cols) c.uIn = 0; darcy.under = darcy.total = 0; return; }
    // web nodes: wn = c nwN + k (k fastest, then the places, x before y)
    const nW = nCol * nwN, bw = nwN * nxN, B = DMP_MP.mpBand(nW, bw, true), R = new Float64Array(nW), mu = T => DMP_DR.drAir(T, P).mu;
    const Tv_ = (c, k) => Tv[c * nz + k];
    const add = (i, j, t) => { DMP_MP.mpAdd(B, i, i, t); DMP_MP.mpAdd(B, j, j, t); DMP_MP.mpAdd(B, Math.max(i, j), Math.min(i, j), -t); };
    const tv = new Float64Array(nCol * nw), tl = new Float64Array(links.length);
    for (let c = 0; c < nCol; c++) for (let k = 0; k < nw; k++) { const t = o.webK / mu((Tv_(c, k) + Tv_(c, k + 1)) / 2) * cols[c].A / (zw[k + 1] - zw[k]); tv[c * nw + k] = t; add(c * nwN + k, c * nwN + k + 1, t); }
    links.forEach((L, li) => { const k = L[4]; if (k > nw) return; const ca = Math.floor(L[0] / nz), cb = Math.floor(L[1] / nz), h = (hgt[L[0]] + hgt[L[1]]) / 2;
      const t = o.webK / mu((Tv[L[0]] + Tv[L[1]]) / 2) * h * L[2] / L[3]; tl[li] = t; add(ca * nwN + k, cb * nwN + k, t); });
    const fixed = new Map();
    for (let c = 0; c < nCol; c++) {
      const C = cols[c];
      fixed.set(c * nwN, dpOf(Zc[c]));                                         // the plenum
      if (!C.film) fixed.set(c * nwN + nw, 0);                                  // the bare web's top: the oven's air
      if (C.edge && TT.sides !== false) for (let k = 1; k <= nw; k++) fixed.set(c * nwN + k, 0);   // the web's edges
    }
    for (const [d, g] of fixed) DMP_MP.mpFix(B, R, d, g);
    DMP_MP.mpFactor(B);
    const p = DMP_MP.mpBackSolve(B, R);
    darcy.p.set(p);
    for (let c = 0; c < nCol; c++) for (let k = 0; k < nw; k++) darcy.Fv[c * nw + k] = tv[c * nw + k] * (p[c * nwN + k] - p[c * nwN + k + 1]);
    links.forEach((L, li) => { const k = L[4]; if (k > nw) return; darcy.Fl[li] = tl[li] * (p[Math.floor(L[0] / nz) * nwN + k] - p[Math.floor(L[1] / nz) * nwN + k]); });
    // the plenum's air into each place's underside: its node's balance
    const net = new Float64Array(nCol * nwN);
    for (let c = 0; c < nCol; c++) for (let k = 0; k < nw; k++) { const f = darcy.Fv[c * nw + k]; net[c * nwN + k] += f; net[c * nwN + k + 1] -= f; }
    links.forEach((L, li) => { const k = L[4]; if (k > nw) return; const f = darcy.Fl[li]; net[Math.floor(L[0] / nz) * nwN + k] += f; net[Math.floor(L[1] / nz) * nwN + k] -= f; });
    let under = 0, aUnder = 0, total = 0, aTot = 0;
    for (let c = 0; c < nCol; c++) {
      const f = net[c * nwN]; darcy.Fin[c] = f; cols[c].uIn = f / cols[c].A;
      total += f; aTot += cols[c].A;
      if (cols[c].film) { under += f; aUnder += cols[c].A; }
    }
    darcy.under = aUnder > 0 ? under / aUnder : 0; darcy.total = total / aTot; darcy.net = net;
  }
  // ---- the heat: a step's system (linear about the iterate) and its solve ----
  const Dd = new Float64Array(NN), Lo = new Float64Array(NN), Up = new Float64Array(NN), Rh = new Float64Array(NN), Al = new Float64Array(links.length * 2);
  const rhoAin = Z => P * 0.0289647 / (DMP_R * (Z.Ta + 273.15));
  /**
   * The heat step's system at the iterate Ti from Told over dtv with the places' water W (their steps' or their state),
   * their stretches Zc: fills Dd, Lo, Up, Al (along: per link, the a→b and b→a coefficients), Rh.
   */
  function heatSystem(Told, Ti, dtv, W, Zc) {
    Dd.fill(0); Lo.fill(0); Up.fill(0); Rh.fill(0); Al.fill(0);
    for (let ci = 0; ci < nCol; ci++) layers(ci, W[ci] || cols[ci]);
    for (let ci = 0; ci < nCol; ci++) {
      const c = cols[ci], b0 = ci * nz, A = c.A, Z = Zc[ci], film = c.film && c.coated, top = b0 + (film ? nw + M : nw);
      for (let k = 0; k < nz; k++) { const n = b0 + k; if (!active[n]) { Dd[n] = 1; continue; } Dd[n] += cap[n] * A / dtv; Rh[n] += cap[n] * A * Told[n] / dtv; }
      // (a place not coated yet: its film's nodes held at the slurry's temperature, apart from everything)
      if (c.film && !film) for (let k = nw + 1; k < nz; k++) { const n = b0 + k; Dd[n] = 1; Rh[n] = o.Tin; }
      // through: conduction between neighbours up the place, and in the web the air carrying heat with it (the flux
      // exponentially fitted: exact for steady flow along the link, conduction alone without the air, the air's
      // heat alone without conduction)
      const rc = TT.dr ? 0 : rhoAin(Z) * cpa;
      for (let k = 0; k < top - b0; k++) {
        const n = b0 + k, G = A / (rhi[n] + rlo[n + 1]), Pe = k < nw && rc > 0 ? rc * darcy.Fv[ci * nw + k] / G : 0;
        const bm = Pe ? DMP_DR.drB(-Pe) : 1, bp = Pe ? DMP_DR.drB(Pe) : 1;
        Dd[n] += G * bm; Up[n] -= G * bp; Dd[n + 1] += G * bp; Lo[n + 1] -= G * bm;
      }
      // the air in at the underside at the plenum's temperature, out where it leaves (the web's open faces; in 1D under the film)
      if (rc > 0) {
        const fin = darcy.Fin[ci];
        if (fin > 0) Rh[b0] += rc * fin * Z.Ta; else Dd[b0] -= rc * fin;
        if (dim === 1) Dd[b0 + nw] += rc * Math.max(0, darcy.Fv[nw - 1]);
        else if (darcy.net) for (let k = 1; k <= nw; k++) { const f = darcy.net[ci * nwN + k]; if (f < 0) Dd[b0 + k] -= rc * f; }
      }
      // the underside: natural convection to the air under it (drying.js's own bottom on its checks)
      const fBot = Tb => (TT.dr ? DMP_DR.drBottomSide(Z, Tb, DMP_DR.drPsat(Tb), o).q : DMP_DR.drNat(Tb, Z.Ta, Z.pa, Z.pa, o.Lnat, P, 'down').h * (Z.Ta - Tb));
      robin(b0, fBot, Ti, A);
      // the edges' side faces: the oven's air (no IR)
      if (dim > 1 && TT.sides !== false) {
        const fSideQ = Ts => DMP_DR.drTopSide(Z, Ts, Z.pa, o).q - Z.ir;
        if (c.edge) for (let k = 0; k <= nw; k++) robin(b0 + k, fSideQ, Ti, hgt[b0 + k] * dxD[c.ix]);
        if (c.end && film) for (let j = 1; j <= M; j++) robin(b0 + nw + j, fSideQ, Ti, hgt[b0 + nw + j] * dxD[c.ix]);
      }
      if (!film) { robin(top, Ts => DMP_DR.drTopSide(Z, Ts, Z.pa, o).q, Ti, A); continue; }
      // the film's top (and its evaporation where it is the wet film's own), its underside's evaporation, the fronts' sinks
      const Wc = W[ci] || c, dry = c.dry, Phi = c.Phi, delT = (Phi - Wc.zt) / phiM, delB = Wc.zb / phiM;
      const freeT = !dry && (c.modeT !== 'skin' || !(delT > 0)), freeB = !dry && (c.modeB === 'free' || (c.modeB === 'skin' && !(delB > 0)));
      const TsI = Ti[top], TfT = Tz(c, Ti, Wc.zt), TfB = Tz(c, Ti, Wc.zb);
      const qTop = Tsv => { if (dry) return DMP_DR.drTopSide(Z, Tsv, Z.pa, o).q;
        if (freeT) { const st = c.sideTop(Z, Tsv, Tsv, 0); return st.q - DMP_DR.drLatent(Tsv) * (TT.Et != null ? TT.Et : st.m); }
        return c.sideTop(Z, TfT, Tsv, delT).q; };
      robin(top, qTop, Ti, A);
      if (freeB) { const bn = b0 + nw; robin(bn, Tbv => -DMP_DR.drLatent(Tbv) * c.evapBot(Z, Tbv, Tbv, 0), Ti, A); }
      if (!dry && c.modeT === 'skin' && delT > 0) sink(c, b0, Wc.zt, Tf => c.evapTop(Z, Tf, TsI, delT), Ti, A);
      if (!dry && c.modeB === 'skin' && delB > 0) sink(c, b0, Wc.zb, Tf => c.evapBot(Z, Tf, Ti[b0 + nw], delB), Ti, A);
    }
    // along the web and the film: conduction, and in the web the air's heat (exponentially fitted, as through)
    links.forEach((L, li) => {
      const [a, b, len, dist, k] = L;
      if (k > nw && !(cols[Math.floor(a / nz)].coated && cols[Math.floor(b / nz)].coated)) return;   // (a film not coated yet)
      const G = (gin[a] + gin[b]) / 2 * len / dist;
      const Pe = k <= nw && !TT.dr && darcy.Fl[li] ? rhoAin(Zc[Math.floor(a / nz)]) * cpa * darcy.Fl[li] / G : 0, bm = Pe ? DMP_DR.drB(-Pe) : 1, bp = Pe ? DMP_DR.drB(Pe) : 1;
      Dd[a] += G * bm; Al[2 * li] -= G * bp; Dd[b] += G * bp; Al[2 * li + 1] -= G * bm;
    });
  }
  /** A face's heat into node n (W/m² → × area), q(T) made linear about the iterate. */
  function robin(n, qf, Ti, area) {
    const T0 = Ti[n], q0 = qf(T0), qd = (qf(T0 + 1e-3) - q0) / 1e-3;
    Rh[n] += area * (q0 - qd * T0); Dd[n] -= area * qd;
  }
  /** A front inside the film at ζ zf: its evaporation's latent heat mf(Tf) (kg/(m² s)), Tf between the nodes about it, made linear. */
  function sink(c, b0, zf, mf, Ti, A) {
    let j = 0; while (j < M - 1 && c.sT[j + 1] < zf) j++;
    const n1 = b0 + nw + j, n2 = n1 + 1, w2 = Math.min(1, Math.max(0, (zf - c.sT[j]) / (c.sT[j + 1] - c.sT[j]))), w1 = 1 - w2;
    const Tf0 = w1 * Ti[n1] + w2 * Ti[n2], m0 = mf(Tf0), dm = (mf(Tf0 + 1e-3) - m0) / 1e-3, Lv = DMP_DR.drLatent(Tf0);
    // −Lv (m0 + dm (Tf − Tf0)) shared to the two nodes by the weights
    for (const [n, w] of [[n1, w1], [n2, w2]]) {
      if (!(w > 0)) continue;
      Rh[n] -= A * w * Lv * (m0 - dm * Tf0);
      const cpl = A * w * Lv * dm;
      if (n === n1) { Dd[n1] += cpl * w1; Up[n1] += cpl * w2; } else { Dd[n2] += cpl * w2; Lo[n2] += cpl * w1; }
    }
  }
  // the matrix times x, and the places' tridiagonal solves (the preconditioner; exact in 1D)
  function matVec(x, y) {
    for (let n = 0; n < NN; n++) y[n] = Dd[n] * x[n] + (n > 0 ? Lo[n] * x[n - 1] : 0) + (n < NN - 1 ? Up[n] * x[n + 1] : 0);
    for (let li = 0; li < links.length; li++) { const a = links[li][0], b = links[li][1]; y[a] += Al[2 * li] * x[b]; y[b] += Al[2 * li + 1] * x[a]; }
  }
  const cp_ = new Float64Array(nz), dp_ = new Float64Array(nz);
  function precond(r, z) {
    for (let ci = 0; ci < nCol; ci++) {
      const b0 = ci * nz;
      let m = Dd[b0]; cp_[0] = Up[b0] / m; dp_[0] = r[b0] / m;
      for (let k = 1; k < nz; k++) { const n = b0 + k, lo = Lo[n], up = k < nz - 1 ? Up[n] : 0; m = Dd[n] - lo * cp_[k - 1]; cp_[k] = up / m; dp_[k] = (r[n] - lo * dp_[k - 1]) / m; }
      z[b0 + nz - 1] = dp_[nz - 1];
      for (let k = nz - 2; k >= 0; k--) z[b0 + k] = dp_[k] - cp_[k] * z[b0 + k + 1];
    }
  }
  /** GMRES (right preconditioned by the places' solves), restarted: Ax = Rh from x. */
  function solveHeat(x) {
    if (!links.length) { precond(Rh, x); return x; }
    const m = 30, r = new Float64Array(NN), w = new Float64Array(NN), zt = new Float64Array(NN);
    let bn = 0; for (let n = 0; n < NN; n++) bn += Rh[n] * Rh[n]; bn = Math.sqrt(bn) || 1;
    for (let cyc = 0; cyc < 20; cyc++) {
      matVec(x, w); let rn = 0; for (let n = 0; n < NN; n++) { r[n] = Rh[n] - w[n]; rn += r[n] * r[n]; } rn = Math.sqrt(rn);
      if (rn <= 1e-12 * bn) return x;
      const V0 = new Float64Array(NN); for (let n = 0; n < NN; n++) V0[n] = r[n] / rn;
      const V = [V0], H = [], g = [rn], cs = [], sn = [];
      let j = 0;
      for (; j < m; j++) {
        stats.gmres++;
        precond(V[j], zt); matVec(zt, w);
        const h = new Float64Array(j + 2);
        for (let i = 0; i <= j; i++) { let s = 0; const Vi = V[i]; for (let n = 0; n < NN; n++) s += w[n] * Vi[n]; h[i] = s; for (let n = 0; n < NN; n++) w[n] -= s * Vi[n]; }
        let wn = 0; for (let n = 0; n < NN; n++) wn += w[n] * w[n]; wn = Math.sqrt(wn); h[j + 1] = wn;
        for (let i = 0; i < j; i++) { const t = cs[i] * h[i] + sn[i] * h[i + 1]; h[i + 1] = -sn[i] * h[i] + cs[i] * h[i + 1]; h[i] = t; }
        const den = Math.hypot(h[j], h[j + 1]) || 1e-300; cs[j] = h[j] / den; sn[j] = h[j + 1] / den;
        h[j] = cs[j] * h[j] + sn[j] * h[j + 1]; h[j + 1] = 0; g[j + 1] = -sn[j] * g[j]; g[j] = cs[j] * g[j];
        H.push(h);
        if (Math.abs(g[j + 1]) <= 1e-12 * bn || wn === 0) { j++; break; }
        const Vj = new Float64Array(NN); for (let n = 0; n < NN; n++) Vj[n] = w[n] / wn; V.push(Vj);
      }
      const y = new Float64Array(j);
      for (let i = j - 1; i >= 0; i--) { let s = g[i]; for (let k = i + 1; k < j; k++) s -= H[k][i] * y[k]; y[i] = s / H[i][i]; }
      const u = new Float64Array(NN); for (let i = 0; i < j; i++) { const Vi = V[i]; for (let n = 0; n < NN; n++) u[n] += y[i] * Vi[n]; }
      precond(u, zt); for (let n = 0; n < NN; n++) x[n] += zt[n];
    }
    return x;
  }
  // ---- the state ----
  let Tn = new Float64Array(NN).fill(TT.T != null ? TT.T : o.Tin);
  // (the film coated as each place passes the coater, the line's start: in 3D the piece's places along the line one
  //  after the other, the one ahead first -- every place with the line's history, shifted, as on the running line)
  const coatX = c => xStart - c.x, xBegin = Math.min(...cols.map(coatX));
  let x = xBegin, t = 0, dt = o.dt0 || 1e-3;
  for (const c of cols) c.coated = c.film && coatX(c) <= x + 1e-12;
  const lineX = c => x + c.x, ZcOf = () => cols.map(c => stretchAt(lineX(c)));
  // the stops: each place's stretch ends and the snapshots, as the piece's (its middle's) positions
  const snapX = (o.snapX || []).filter(v => v >= xStart && v <= xEnd).sort((p, q) => p - q);
  const stops = [...new Set([...Zs.flatMap(Z => cols.map(c => Z.x1 - c.x)), ...cols.map(coatX), ...snapX])].filter(v => v > xBegin && v <= xEnd).sort((p, q) => p - q);
  const series = [], snaps = [], webTs = [];
  const follow = { mid: null, endL: null, endR: null, bare: null };
  { const fc = filmCols.filter(c => c.ix === Math.floor((nxN - 1) / 2)), ym = (ax.a + ax.b) / 2;
    follow.mid = cols.indexOf(fc.reduce((p, q) => (Math.abs(q.y - ym) < Math.abs(p.y - ym) ? q : p)));
    if (dim > 1) { follow.endL = cols.indexOf(fc[0]); follow.endR = cols.indexOf(fc[fc.length - 1]); const bare = cols.filter(c => !c.film && c.ix === fc[0].ix && c.y < ax.a); if (bare.length) follow.bare = cols.indexOf(bare.reduce((p, q) => (Math.abs(q.y - ax.a / 2) < Math.abs(p.y - ax.a / 2) ? q : p))); } }
  const thickness = (c, S = c) => { if (!c.film) return 0; const L = S.zt - S.zb; let h = (c.Phi - L) / phiM; for (let j = 0; j < N; j++) h += L * c.ds[j] * (1 + S.e[j]); return h; };
  const at = (ci, Z) => {
    const c = cols[ci]; if (!c) return null;
    const Ts = Tn[ci * nz + (c.film ? nw + M : nw)], Tb = Tn[ci * nz + nw], Tu = Tn[ci * nz];
    if (!c.film) return { Ts, Tb, Tu, uIn: c.uIn };
    return { Ts, Tb, Tu, Tft: c.modeT === 'skin' && !c.dry ? Tz(c, Tn, c.zt) : Ts, Et: c.lastE ? c.lastE[0] : 0, Eb: c.lastE ? c.lastE[1] : 0,
      wet: c.dry ? 0 : wetWater(c), bound: skinWater(c), h: thickness(c), skinT: (c.Phi - c.zt) / phiM, skinB: c.zb / phiM, dry: c.dry, uIn: c.uIn, zone: Z ? Z.name : null };
  };
  const record = Zc => {
    const row = { x, t, zone: Zc[follow.mid].name, under: darcy.under, total: darcy.total };
    for (const [k, ci] of Object.entries(follow)) if (ci != null) row[k] = at(ci, Zc[ci]);
    let w = 0, a = 0; for (const c of filmCols) { w += (c.dry ? 0 : wetWater(c)) * c.A + skinWater(c) * c.A; a += c.A; } row.water = w / a;
    series.push(row);
    // each place's history (the stress's): drying.js's
    for (const c of filmCols) {
      const H = c.hist, Z = Zc[cols.indexOf(c)], Ts = Tsurf(c, Tn), Tb = Tbot(c, Tn), ci = cols.indexOf(c);
      const Tft = c.modeT === 'skin' ? Tz(c, Tn, c.zt) : Ts, Tfb = c.modeB === 'skin' ? Tz(c, Tn, c.zb) : Tb;
      const pvT = c.dry ? Z.pa : c.modeT === 'skin' && c.zt < c.Phi ? c.sideTop(Z, Tft, Ts, (c.Phi - c.zt) / phiM).pv : NaN;
      const pvB = !both ? NaN : c.dry ? Z.pa : c.modeB === 'skin' && c.zb > 0 ? c.sideBot(Z, Tfb, Tb, c.zb / phiM).pv : NaN;
      const Tc = new Float64Array(M), Hh = new Float32Array(M + 1);
      for (let j = 0; j < M; j++) Tc[j] = (Tn[ci * nz + nw + j] + Tn[ci * nz + nw + j + 1]) / 2;
      // (the film's nodes' heights above the web)
      let zz = 0; Hh[0] = 0;
      for (let j = 1; j <= M; j++) { seg(c, c, c.sT[j - 1], c.sT[j], tmp); zz += tmp[0]; Hh[j] = zz; }
      H.x.push(lineX(c)); H.t.push(t); H.zt.push(c.zt); H.zb.push(c.zb); H.dry.push(c.dry ? 1 : 0); H.Ts.push(Ts); H.Tb.push(Tb);
      H.pvT.push(pvT); H.pvB.push(pvB); H.Tc.push(Tc); H.zone.push(Z.name); H.H.push(Hh);
    }
    // (every place's web, its mean temperature: the web's own strain in the stress)
    const wt = new Float32Array(nCol);
    for (let ci = 0; ci < nCol; ci++) { let s = 0, h = 0; for (let k = 0; k < nw; k++) { const d = zw[k + 1] - zw[k]; s += d * (Tn[ci * nz + k] + Tn[ci * nz + k + 1]) / 2; h += d; } wt[ci] = s / h; }
    webTs.push(wt);
  };
  // the snapshot: the fields at the nodes
  const snap = Zc => {
    const X = new Float32Array(NN).fill(NaN), phi = new Float32Array(NN).fill(NaN), zp = new Float32Array(NN);
    for (let ci = 0; ci < nCol; ci++) {
      const c = cols[ci], b0 = ci * nz;
      for (let k = 0; k <= nw; k++) zp[b0 + k] = zw[k];
      if (!c.film) { for (let j = 1; j <= M; j++) zp[b0 + nw + j] = tf; continue; }
      let zz = tf; zp[b0 + nw] = tf;
      for (let j = 0; j <= M; j++) {
        const zl = j > 0 ? (c.sT[j - 1] + c.sT[j]) / 2 : 0, zh = j < M ? (c.sT[j] + c.sT[j + 1]) / 2 : c.Phi;
        // (the water per GO in the node's extent, and its solids)
        seg(c, c, zl, zh, tmp); const dzeta = zh - zl, water = (tmp[1] - dzeta * rhoS * o.cS) / (rhoL * cw);
        X[b0 + nw + j] = dzeta > 0 ? water * rhoL / (dzeta * rhoS) : NaN; phi[b0 + nw + j] = dzeta > 0 && tmp[0] > 0 ? dzeta / tmp[0] : NaN;
        if (j > 0) { seg(c, c, c.sT[j - 1], c.sT[j], tmp); zz += tmp[0]; zp[b0 + nw + j] = zz; }
      }
    }
    snaps.push({ x, t, zone: Zc[follow.mid].name, T: Float32Array.from(Tn), X, phi, z: zp, p: Float32Array.from(darcy.p), uIn: Float32Array.from(cols.map(c => c.uIn)),
      thick: Float32Array.from(cols.map(c => thickness(c))), dry: cols.map(c => (c.film ? (c.dry ? 1 : 0) : -1)) });
  };
  // ---- stepping ----
  let Zc = ZcOf();
  solveDarcy(Tn, Zc);
  for (let ci = 0; ci < nCol; ci++) layers(ci, cols[ci]);
  const enthalpy = () => { let h = 0; for (let ci = 0; ci < nCol; ci++) { layers(ci, cols[ci]); for (let k = 0; k < nz; k++) { const n = ci * nz + k; if (active[n]) h += cap[n] * cols[ci].A * Tn[n]; } } return h; };
  const H0 = enthalpy(); let Qin = 0, Qlat = 0, Qsens = 0, Qcoat = 0;
  const waterAll = () => { let w = 0; for (const c of filmCols) w += ((c.dry ? 0 : wetWater(c)) + skinWater(c)) * c.A; return w; };
  const Wstart = waterAll(); let evTot = 0;
  record(Zc);
  if (snapX.length && snapX[0] <= x + 1e-9) { snap(Zc); snapX.shift(); }
  /** A skin's front back at its surface (the film wet to it again): the place free there, its water kept. */
  const rewet = (c, S) => {
    const top = S.modeT === 'skin' && S.zt >= c.Phi, bot = S.modeB === 'skin' && S.zb <= 0;
    if (!top && !bot) return;
    const w0 = wetWater(c, S) + skinWater(c, S);
    if (top) { S.zt = c.Phi; S.modeT = 'free'; S.wt = 0; }
    if (bot) { S.zb = 0; S.modeB = 'free'; S.wb = 0; }
    const w1 = wetWater(c, S), want = w0 - skinWater(c, S);
    if (w1 > 0) { S.e = Float64Array.from(S.e); for (let j = 0; j < N; j++) S.e[j] *= want / w1; }
  };
  /**
   * A place's water over the step at the temperatures Ti: drying.js's step. Where its Newton does not converge (a
   * place the step is too long for: the film's ends, heated from their sides too), the same step in 2, 4, ... 32
   * parts, the temperatures held, its evaporation the parts' mean -- instead of every place's step again shorter.
   */
  function waterOf(c, Z, dtv, Ti, start) {
    const tAt = z => Tz(c, Ti, z), Ts = Tsurf(c, Ti), Tb = Tbot(c, Ti);
    const W1 = TT.parts ? null : DMP_DR.drWaterStep(c.G, c, Z, dtv, tAt, Ts, Tb, start);   // (the checks: always in parts)
    if (W1 || TT.noSub) return W1;
    for (let parts = TT.parts || 2; parts <= Math.max(32, TT.parts || 0); parts *= 2) {
      stats.sub++;
      const S = { e: c.e, zt: c.zt, zb: c.zb, wt: c.wt, wb: c.wb, modeT: c.modeT, modeB: c.modeB };
      let Et = 0, Eb = 0, Wp = null;
      for (let p = 0; p < parts; p++) {
        Wp = DMP_DR.drWaterStep(c.G, S, Z, dtv / parts, tAt, Ts, Tb, null);
        if (!Wp) break;
        Et += Wp.Et / parts; Eb += Wp.Eb / parts;
        Object.assign(S, { e: Wp.e, zt: Wp.zt, zb: Wp.zb, wt: Wp.wt, wb: Wp.wb });
        rewet(c, S);
      }
      if (Wp) return { e: S.e, zt: S.zt, zb: S.zb, wt: S.wt, wb: S.wb, modeT: S.modeT, modeB: S.modeB, Et, Eb, parts };
    }
    return null;
  }
  let nSteps = 0, nFail = 0;
  const maxSteps = o.maxSteps || 200000, span = xEnd - xBegin;
  while (x < xEnd - 1e-12 && nSteps < maxSteps) {
    // the places reaching the coater: their film laid, with the slurry's heat (the energy's account)
    if (filmCols.some(c => !c.coated && coatX(c) <= x + 1e-12)) {
      const Hb = enthalpy();
      for (const c of filmCols) if (!c.coated && coatX(c) <= x + 1e-12) c.coated = true;
      Qcoat += enthalpy() - Hb;
    }
    Zc = ZcOf();
    const xNext = stops.find(v => v > x + 1e-12) ?? xEnd;
    let dtv = Math.min(dt, (xNext - x) / o.U, (xOven - xStart) / 150 * (o.dtScale || 1) / o.U);
    solveDarcy(Tn, Zc);
    // skins form where a surface's water reaches the packing's
    for (const c of filmCols) {
      if (c.dry || !c.coated) continue;
      const ci = cols.indexOf(c), Z = Zc[ci], Ts = Tsurf(c, Tn), Tb = Tbot(c, Tn);
      if (c.modeT === 'free') { const L = c.zt - c.zb, h = L * (1 - c.sc[N - 1]), Et = c.evapTop(Z, Ts, Ts, 0) / rhoL, D = Dz(c.e[N - 1], Ts);
        if (c.e[N - 1] - Et * h / D <= em && Et > 0) { c.modeT = 'skin'; if (c.events.skinTop == null) c.events.skinTop = lineX(c); } }
      if (c.modeB === 'free') { const L = c.zt - c.zb, h = L * c.sc[0], Eb = c.evapBot(Z, Tb, Tb, 0) / rhoL, D = Dz(c.e[0], Tb);
        if (c.e[0] - Eb * h / D <= em && Eb > 0) { c.modeB = 'skin'; if (c.events.skinBottom == null) c.events.skinBottom = lineX(c); } }
    }
    // Picard between the water (the temperatures held) and the heat (the water held)
    let Ti = Tn, W = new Array(nCol).fill(null), conv = false, failed = false;
    for (let it = 0; it < 40; it++) {
      stats.picard++;
      for (const c of filmCols) {
        if (c.dry || !c.coated) continue;
        const ci = cols.indexOf(c);
        const Wn = waterOf(c, Zc[ci], dtv, Ti, W[ci] && !W[ci].parts ? W[ci] : null);
        if (!Wn) { failed = true; break; }
        W[ci] = Wn;
      }
      if (failed) break;
      heatSystem(Tn, Ti, dtv, W, Zc);
      const Tnew = solveHeat(Float64Array.from(Ti));
      let dT = 0; for (let n = 0; n < NN; n++) if (active[n]) dT = Math.max(dT, Math.abs(Tnew[n] - Ti[n]));
      for (let ci = 0; ci < nCol; ci++) if (!cols[ci].film) for (let k = nw + 1; k < nz; k++) Tnew[ci * nz + k] = Tnew[ci * nz + nw];
      Ti = Tnew;
      if (TT.T != null) { Ti.fill(TT.T); conv = true; break; }
      if (dT < 1e-4) { conv = true; break; }
    }
    // (a place's water step or the coupling not converging: the step a quarter as long; given up after 40 in a row -- with
    //  many places one of them now and then needs a shorter step than the rest)
    if (!conv) { dt = dtv / 4; nFail++; if (nFail > 40 || dt < 1e-9) throw new Error(`drying multiphysics: the step would not converge at x = ${x.toFixed(4)} m`); continue; }
    nFail = 0;
    // the step's size: drying.js's measures, the most any place changes
    let chg = 0;
    for (const c of filmCols) {
      const Wc = W[cols.indexOf(c)]; if (!Wc) continue;
      let l1 = 0, mx = 0;
      for (let j = 0; j < N; j++) { l1 += Math.abs(Wc.e[j] - c.e[j]) * c.ds[j]; mx = Math.max(mx, Math.abs(1 / (1 + Wc.e[j]) - 1 / (1 + c.e[j]))); }
      chg = Math.max(chg, l1 / (0.01 * e0), mx / (0.25 * (phiM - o.phi0 + 0.02)));
      const L0 = c.zt - c.zb, L1 = Wc.zt - Wc.zb;
      chg = Math.max(chg, Math.abs(L1 - L0) / (0.05 * Math.max(L0, 1e-30)));
    }
    let dTm = 0; for (let n = 0; n < NN; n++) if (active[n]) dTm = Math.max(dTm, Math.abs(Ti[n] - Tn[n]));
    chg = Math.max(chg, dTm / 2) / (o.dtScale || 1);
    if (chg > 2) { stats.rejected++; dt = dtv / Math.min(4, chg); continue; }
    // accept: each place's water, the energy's and the water's accounts
    for (const c of filmCols) {
      const ci = cols.indexOf(c), Wc = W[ci], Z = Zc[ci];
      if (c.dry || !Wc) { c.lastE = [0, 0]; continue; }
      const before = wetWater(c) + skinWater(c);
      c.e = Float64Array.from(Wc.e); c.zt = Wc.zt; c.zb = Wc.zb; c.wt = Wc.wt; c.wb = Wc.wb;
      if (Wc.modeT) { c.modeT = Wc.modeT; c.modeB = Wc.modeB; }
      rewet(c, c);
      c.lost += before - (wetWater(c) + skinWater(c));
      c.evT += Wc.Et * dtv; c.evB += Wc.Eb * dtv; evTot += (Wc.Et + Wc.Eb) * dtv * c.A;
      c.lastE = [Wc.Et, Wc.Eb];
      if (TT.T == null) {
        const Tft = c.modeT === 'skin' && c.zt < c.Phi ? Tz(c, Ti, c.zt) : Tsurf(c, Ti), Tfb = c.modeB === 'skin' && c.zb > 0 ? Tz(c, Ti, c.zb) : Tbot(c, Ti);
        Qlat += (DMP_DR.drLatent(Tft) * Wc.Et + DMP_DR.drLatent(Tfb) * Wc.Eb) * dtv * c.A; Qsens += cw * (Tft * Wc.Et + Tfb * Wc.Eb) * dtv * c.A;
        if (c.events.boil == null && Math.max(Tft, Tfb) >= Tboil - 0.05) c.events.boil = lineX(c) + dtv * o.U;
      }
      if (c.events.condense == null && (Wc.Et < 0 || Wc.Eb < 0)) c.events.condense = lineX(c);
      if ((c.zt - c.zb) < 1e-5 * c.Phi || wetWater(c) < 1e-7 * c.W0) { c.dry = true; c.events.dry = lineX(c) + dtv * o.U; }
    }
    if (TT.T == null) Qin += faceHeat(Ti) * dtv;
    Tn = Ti; x += dtv * o.U; t += dtv; nSteps++;
    record(Zc);
    while (snapX.length && snapX[0] <= x + 1e-9) { snap(Zc); snapX.shift(); }
    if (o.onProgress) o.onProgress({ k: Math.round(900 * (x - xBegin) / span), n: 1000 });
    dt = dtv * Math.min(1.6, Math.max(0.3, 1 / Math.max(chg, 1e-3)));
  }
  if (nSteps >= maxSteps) throw new Error('drying multiphysics: too many steps');
  if (!snaps.length || snaps[snaps.length - 1].x < x - 1e-9) snap(Zc);
  /** The faces' heat in (W) at the temperatures Tv: tops, undersides, edges, the air into the web (its enthalpy against 0 °C, out where it leaves). */
  function faceHeat(Tv) {
    let q = 0;
    for (let ci = 0; ci < nCol; ci++) {
      const c = cols[ci], b0 = ci * nz, A = c.A, Z = Zc[ci], film = c.film && c.coated, top = b0 + (film ? nw + M : nw);
      q += A * (TT.dr ? DMP_DR.drBottomSide(Z, Tv[b0], DMP_DR.drPsat(Tv[b0]), o).q : DMP_DR.drNat(Tv[b0], Z.Ta, Z.pa, Z.pa, o.Lnat, P, 'down').h * (Z.Ta - Tv[b0]));
      if (!film || c.dry) q += A * DMP_DR.drTopSide(Z, Tv[top], Z.pa, o).q;
      else {
        const delT = (c.Phi - c.zt) / phiM, freeT = c.modeT !== 'skin' || !(delT > 0);
        q += A * (freeT ? c.sideTop(Z, Tv[top], Tv[top], 0).q : c.sideTop(Z, Tz(c, Tv, c.zt), Tv[top], delT).q);
      }
      if (dim > 1 && TT.sides !== false) {
        const qs = Ts => DMP_DR.drTopSide(Z, Ts, Z.pa, o).q - Z.ir;
        if (c.edge) for (let k = 0; k <= nw; k++) q += qs(Tv[b0 + k]) * hgt[b0 + k] * dxD[c.ix];
        if (c.end && film) for (let j = 1; j <= M; j++) q += qs(Tv[b0 + nw + j]) * hgt[b0 + nw + j] * dxD[c.ix];
      }
      if (!TT.dr) { const rc = rhoAin(Z) * cpa; if (darcy.Fin[ci] > 0) q += rc * darcy.Fin[ci] * Z.Ta; else q += rc * darcy.Fin[ci] * Tv[b0]; }
    }
    // the air leaving: through the open nodes (the bare web's top, the edges) and, in 1D, under the film
    if (!TT.dr) {
      if (dim === 1) q -= rhoAin(Zc[0]) * cpa * darcy.Fv[nw - 1] * Tv[nw];
      else if (darcy.net) for (let ci = 0; ci < nCol; ci++) for (let k = 1; k <= nw; k++) { const f = darcy.net[ci * nwN + k]; if (f < 0) q += rhoAin(Zc[ci]) * cpa * f * Tv[ci * nz + k]; }
    }
    return q;
  }
  // ---- the answers ----
  const Hend = enthalpy(), Wend = waterAll();
  const exitOf = c => { const w = c.dry ? 0 : wetWater(c), b = skinWater(c); return { free: w, bound: b, water: w + b, waterPct: 100 * (w + b) / (c.Phi * rhoS), h: thickness(c), dry: c.dry }; };
  const colsOut = cols.map((c, ci) => ({ ix: c.ix, iy: c.iy, x: c.x, y: c.y, h0: c.h0, film: c.film, uIn: c.uIn, events: c.events, exit: c.film ? exitOf(c) : null, Pe: c.Pe, evT: c.evT, evB: c.evB, lost: c.lost, W0: c.W0 }));
  const along = (() => { const dy = Math.min(...dyD.filter((_, i) => ax.h0[i] > 0)); return dim > 1 ? DMP_DR.drD0(60, o.R) * o.mul * t / (dy * dy) : 0; })();
  const out = {
    dim, ax, series, snaps, webTs, cols: colsOut, follow, phi0: o.phi0, rhoS, xStart, xEnd, xOven, Tboil, es, aExit, Xb, nSteps, stats,
    energy: TT.T == null ? { H0, H: Hend, Qin, Qlat, Qsens, Qcoat } : null,
    water: { start: Wstart, end: Wend, out: evTot },
    darcy: { under: darcy.under, total: darcy.total, dp: Zs.map(Z => ({ name: Z.name, dp: dpOf(Z) })) },
    along,
    mesh: { nodes: NN, active: active.reduce((a, b) => a + b, 0), cols: nCol, nz, links: links.length, waterCells: N * filmCols.length },
  };
  out.summary = dmpSummary(out);
  if (o.stress) out.stress = dmpStress(out, cols, o, (k, n) => o.onProgress && o.onProgress({ k: 900 + Math.round(100 * k / n), n: 1000 }));
  out.ms = Date.now() - tStart;
  return out;
}

/** The answers: where each followed place's skin forms and where it is dry, the water at the oven's exit, the hottest film, the air under the film. */
function dmpSummary(r) {
  const f = k => (r.follow[k] != null ? r.cols[r.follow[k]] : null), last = r.series[r.series.length - 1];
  const atOven = r.series.reduce((p, q) => (Math.abs(q.x - r.xOven) < Math.abs(p.x - r.xOven) ? q : p));
  let Tmax = -Infinity; for (const s of r.series) for (const k of ['mid', 'endL', 'endR']) if (s[k]) Tmax = Math.max(Tmax, s[k].Ts, s[k].Tb);
  const wPct = c => (c && c.exit ? c.exit.waterPct : null);
  return {
    mid: f('mid') && { skin: f('mid').events.skinTop, dry: f('mid').events.dry, waterPct: wPct(f('mid')), h: f('mid').exit.h },
    endL: f('endL') && { skin: f('endL').events.skinTop, dry: f('endL').events.dry, waterPct: wPct(f('endL')) },
    endR: f('endR') && { skin: f('endR').events.skinTop, dry: f('endR').events.dry, waterPct: wPct(f('endR')) },
    waterOven: atOven.water, waterEnd: last.water, Tmax,
    under: Math.max(...r.series.map(s => s.under || 0)), total: Math.max(...r.series.map(s => s.total || 0)),
  };
}

/**
 * The drying stress (film.js's rule) on the solved drying: 1D film.js's laminate (fmHistory) on the place's history;
 * 2D and 3D the section's or the piece's elements at stressN times, each layer's natural strain from the strain it had
 * when it set. Returns { kind, times, series [{ x, t, mid, endL, endR (the set film's largest in-plane stress, Pa), web }],
 * fields (at the snapshots: the nodes' stress across and along, Pa), lam (each followed place's laminate) }.
 */
function dmpStress(r, cols, o, prog) {
  const so = o.stress, F = so.film, Wb = so.web, ax = r.ax, { nw, M, nz, nxN, nyN, xs, ys, zw } = ax, dim = r.dim;
  const filmIdx = cols.map((c, i) => (c.film ? i : -1)).filter(i => i >= 0);
  // each place's set film, its water and temperature at every step (film.js), from its drying history
  const hh = new Map();
  for (const ci of filmIdx) {
    const c = cols[ci], H = c.hist, n = H.x.length;
    const dr = { history: { ...H, sT: Array.from(c.sT), M, N: c.G.N, Phi: c.Phi, phiM: o.phiM, em: (1 - o.phiM) / o.phiM, es: r.es, n, both: o.where === 'both' } };
    hh.set(ci, DMP_FM.fmHistory(dr, { ...so, K: so.K || 60 }));
  }
  const lamOf = ci => { const h = hh.get(ci); return h ? h.steps.map(s => { let mx = -Infinity; for (let k = 0; k < h.K; k++) if (s.set[k] && s.sig[k] > mx) mx = s.sig[k]; return { x: s.x, t: s.t, sMax: Number.isFinite(mx) ? mx : null, sigW: s.sigW }; }) : null; };
  const lam = {}; for (const [k, ci] of Object.entries(r.follow)) if (ci != null && cols[ci].film) lam[k] = lamOf(ci);
  if (dim === 1) {
    const L = lam.mid;
    return { kind: 'laminate', series: L.map(s => ({ x: s.x, t: s.t, mid: s.sMax, web: s.sigW })), lam, peak: Math.max(...L.map(s => s.sMax ?? -Infinity)) };
  }
  // ---- 2D and 3D: the elements ----
  const nSt = r.series.length, h0 = hh.get(filmIdx[0]);
  // (the first step any layer sets; the solves from the step before it to the end, and the snapshots')
  let first = nSt; for (const ci of filmIdx) { const b = hh.get(ci).bornAt; for (const v of b) if (Number.isFinite(v)) { const i = r.series.findIndex(s => s.x >= v - 1e-12 - cols[ci].x); if (i >= 0) first = Math.min(first, i); } }
  if (first >= nSt) return { kind: 'elements', series: [], fields: [], lam, peak: null };
  const nS = Math.max(4, o.stressN || 24), steps = new Set([Math.max(0, first - 1), nSt - 1]);
  // (the solves: by where on the line and by how much of the film sets -- half each: every place's layers, where they
  //  set; not by the drying's steps, many of them at the oven's entry where nothing sets)
  { const xS = r.series.map(s => s.x), x0 = xS[first], x1 = xS[nSt - 1], setX = [];
    for (const ci of filmIdx) for (const v of hh.get(ci).bornAt) if (Number.isFinite(v)) setX.push(v - cols[ci].x);
    setX.sort((a, b) => a - b);
    let ns = 0;
    const meas = xs_ => { while (ns < setX.length && setX[ns] <= xs_ + 1e-12) ns++; const fx = x1 > x0 ? (xs_ - x0) / (x1 - x0) : 1; return 0.5 * fx + 0.5 * (setX.length ? ns / setX.length : fx); };
    let k = 0;
    for (let i = first; i < nSt && k <= nS; i++) { const m = meas(xS[i]); while (k <= nS && m >= k / nS - 1e-12) { steps.add(i); k++; } }
  }
  for (const sn of r.snaps) { const i = r.series.findIndex(s => Math.abs(s.x - sn.x) < 1e-9); if (i >= first - 1 && i >= 0) steps.add(i); }
  const order = [...steps].filter(i => i >= 0 && i < nSt).sort((a, b) => a - b);
  void h0;
  // the mesh's places (x along fastest), its levels: the web's, the film's (in 3D every second of the heat's: o.stressSub)
  const soft = X => 1 / (1 + X / F.Xh);
  const sub = Math.max(1, Math.round(o.stressSub || (dim === 3 ? Math.ceil(M / 15) : 1))), lev = [];
  for (let k = 0; k <= nw; k++) lev.push(k);
  for (let j = sub; j < M; j += sub) lev.push(nw + j);
  lev.push(nw + M);
  const nLev = lev.length, Eg = so.gel.Eg;
  const webMat = { Ep: Wb.Ew, Et: Wb.Ew * Wb.soft, nup: Wb.nuw, nupt: Wb.nupt ?? 0.1, Gpt: Wb.Ew * Wb.soft / 2 };
  const filmMat = { Ep: F.Ep, Et: F.Et, nup: F.nup, nupt: F.nupt, Gpt: F.Gpt };
  const T0 = r.webTs[0][r.follow.mid];   // (the web's natural length at the coating's temperature, film.js's)
  const born = new Map(), fresh = new Map();   // (element, point) → the total strain when that point set; those set since the last solve
  let prev = null, prevX = -Infinity;
  const series = [], fields = [];
  order.forEach((i, si) => {
    prog(si, order.length);
    // the places' film heights at step i (their history), their set layers (film.js)
    const Hc = cols.map((c, ci) => (c.film ? c.hist.H[i] : null));
    const fm = cols.map((c, ci) => (c.film ? hh.get(ci) : null));
    const fmS = fm.map(h => (h ? h.steps[i] : null));
    // the film's level j at a place: its height above the web
    const zOf = (ci, kk) => { const k = lev[kk]; return k <= nw ? zw[k] : ax.zw[nw] + (Hc[ci] ? Hc[ci][k - nw] : 1e-12 * (k - nw)); };
    // the mesh: the places as its first one or two axes, the levels its last; mapped to the heights
    const axes = dim === 2 ? [[{ L: 1, n: nyN - 1 }], [{ L: 1, n: nLev - 1 }]] : [[{ L: 1, n: nxN - 1 }], [{ L: 1, n: nyN - 1 }], [{ L: 1, n: nLev - 1 }]];
    const idx = (v, n) => Math.round(v * n);
    const map = p => {
      if (dim === 2) { const iy = idx(p[0], nyN - 1), k = idx(p[1], nLev - 1); return [ys[iy], zOf(iy, k)]; }
      const ix = idx(p[0], nxN - 1), iy = idx(p[1], nyN - 1), k = idx(p[2], nLev - 1), ci = ix + nxN * iy; return [xs[ix], ys[iy], zOf(ci, k)];
    };
    // the elements' materials: 0 the web, 1 the film (its points set or gel), 2 nothing (over the bare web)
    const mat = (ijk) => { const k = ijk[dim - 1]; if (k < nw) return 0; const iy = ijk[dim === 2 ? 0 : 1], ix = dim === 3 ? ijk[0] : 0;
      const a = cols[ix + nxN * iy], b = cols[ix + nxN * (iy + 1)], c2 = dim === 3 ? cols[ix + 1 + nxN * iy] : a, d2 = dim === 3 ? cols[ix + 1 + nxN * (iy + 1)] : b;
      return a.film && b.film && c2.film && d2.film ? 1 : 2; };
    const Ms = DMP_MP.mpMesh({ dim, p: 1, axes, map, mat });
    // per point: its place (the nearest of the element's), its layer's cell in film.js's grid
    const rule = DMP_MP.mpRule(1, dim, 2), dN = new Float64Array(Ms.npe * dim);
    const ptData = new Map();
    const dataAt = (e, qi) => {
      const key = e * rule.length + qi; let d = ptData.get(key); if (d) return d;
      const ijk = Array.from(Ms.eijk.subarray(e * dim, e * dim + dim)), q = rule[qi];
      // (the point's local coordinates: its place by the nearer corner, its height fraction in the element's level)
      const loc = q.xi || q.x || q.p;
      const fr = dd => (loc ? (loc[dd] + 1) / 2 : 0.5);
      const iy = ijk[dim === 2 ? 0 : 1] + (fr(dim === 2 ? 0 : 1) > 0.5 ? 1 : 0), ix = dim === 3 ? ijk[0] + (fr(0) > 0.5 ? 1 : 0) : 0, k = ijk[dim - 1];
      const ci = ix + nxN * iy, c = cols[ci];
      d = { ci, k };
      if (k >= nw && c.film && fmS[ci]) {
        const j0 = lev[k] - nw, j1 = lev[k + 1] - nw, s = ax.sF[j0] + (ax.sF[j1] - ax.sF[j0]) * fr(dim - 1), z = s * c.Phi, h = fm[ci];
        let a = 0, b = h.K - 1; while (a < b) { const m = (a + b) >> 1; if (h.f[m + 1] <= z) a = m + 1; else b = m; }
        d.cell = a;
      }
      ptData.set(key, d); return d;
    };
    void dN;
    const eigOf = (m, xq, f, e, qi) => {
      const d = dataAt(e, qi), key = e * rule.length + qi;
      if (m === 0) { const ew = Wb.alphaW * (r.webTs[i][d.ci] - T0); return dim === 2 ? [ew, 0, ew, 0, 0, 0] : [ew, ew, 0, 0, 0, 0]; }
      if (m === 2 || d.cell == null) return [0, 0, 0, 0, 0, 0];
      const S = fmS[d.ci], h = fm[d.ci], kk = d.cell;
      if (!S.set[kk]) return [0, 0, 0, 0, 0, 0];
      let b = born.get(key);
      if (!b) {
        // (set since the last solve: first the last solve's strain; then, solved, its strain where it set -- between
        //  the last solve's and this one's, by where on the line it set)
        const p0 = prev ? (prev.get(key) || [0, 0, 0, 0, 0, 0]) : [0, 0, 0, 0, 0, 0], xb = h.bornAt[kk] - cols[d.ci].x, xc = r.series[i].x;
        b = p0.slice(); born.set(key, b); fresh.set(key, { p0, b, w: xc > prevX ? Math.min(1, Math.max(0, (xb - prevX) / (xc - prevX))) : 1 });
      }
      const nat = F.alphaF * (S.T[kk] - h.bornT[kk]) + F.beta * (S.X[kk] - h.bornX[kk]);
      return dim === 2 ? [b[0] + nat, b[1], b[2] + nat, b[3], b[4], b[5]] : [b[0] + nat, b[1] + nat, b[2], b[3], b[4], b[5]];
    };
    const scaleOf = (m, xq, f, e, qi) => {
      if (m !== 1) return 1;
      const d = dataAt(e, qi); if (d.cell == null) return Eg / F.Ep;
      const S = fmS[d.ci]; return S.set[d.cell] ? soft(S.X[d.cell]) : Eg / F.Ep;
    };
    const mats = [{ ...webMat }, { ...filmMat }, { E: Wb.Ew * 1e-9, nu: 0.3 }];
    // supports: the web's underside held flat; nothing over the bare web held; across (and along, 3D) no rigid motion
    const bc = [{ face: dim === 2 ? 'y0' : 'z0', fix: [dim - 1] }];
    const midY = r.follow.mid != null ? cols[r.follow.mid].iy : 0;
    bc.push({ node: Ms.node(dim === 2 ? [midY, 0] : [0, midY, 0]), fix: [dim - 2] });   // (across: 2D's first axis, 3D's second)
    if (dim === 3) bc.push({ face: 'x0', fix: [0] });
    // (the nodes no element of web or film holds: over the bare web, above it)
    const used = new Uint8Array(Ms.N);
    for (let e = 0; e < Ms.E; e++) if (Ms.mat[e] !== 2) for (let a = 0; a < Ms.npe; a++) used[Ms.conn[e * Ms.npe + a]] = 1;
    for (let n = 0; n < Ms.N; n++) if (!used[n]) bc.push({ node: n, fix: dim === 2 ? [0, 1] : [0, 1, 2] });
    let res = dmpSection(Ms, mats, eigOf, scaleOf, bc, xs[nxN - 1]);
    for (let it = 0; it < (o.stressCorr ?? 2) && fresh.size; it++) {
      const cur = new Map(); for (const g of res.gp) cur.set(g.e * rule.length + g.qi, g.strain);
      for (const [key, q] of fresh) { const c = cur.get(key); if (c) for (let a = 0; a < 6; a++) q.b[a] = q.p0[a] + q.w * (c[a] - q.p0[a]); }
      res = dmpSection(Ms, mats, eigOf, scaleOf, bc, xs[nxN - 1], res);
    }
    fresh.clear(); prevX = r.series[i].x;
    const eps0 = res.eps0;
    // keep each point's total strain: a layer that sets before the next solve takes it as its natural strain
    prev = new Map(); for (const g of res.gp) prev.set(g.e * rule.length + g.qi, Array.from(g.strain));
    // the answers: at each place its set film's top layer's in-plane stress (where a crack starts; the larger of across
    // and along), the points of that place's elements; the largest of the places'
    const inPlane = s => (dim === 2 ? Math.max(s[0], s[2]) : Math.max(s[0], s[1]));
    const top = new Map();   // place → { cell, sum, n }
    for (const g of res.gp) {
      const d = dataAt(g.e, g.qi);
      if (d.cell == null || !fmS[d.ci] || !fmS[d.ci].set[d.cell]) continue;
      let q = top.get(d.ci); if (!q || d.cell > q.cell) { q = { cell: d.cell, sum: 0, n: 0 }; top.set(d.ci, q); }
      if (d.cell === q.cell) { q.sum += inPlane(g.stress); q.n++; }
    }
    const sTop = ci => { const q = top.get(ci); return q && q.n ? q.sum / q.n : null; };
    let any = null, anyAt = null; for (const ci of top.keys()) { const v = sTop(ci); if (v != null && !(any >= v)) { any = v; anyAt = ci; } }
    if (o.debugStress && i === nSt - 1) {
      const ci = r.follow.mid, prof = [];
      for (const g of res.gp) { const d = dataAt(g.e, g.qi); if (d.ci === ci && d.cell != null && fmS[ci].set[d.cell]) prof.push([d.cell, g.stress[0], g.stress[2], g.strain[0], g.strain[2]]); }
      prof.sort((p, q) => p[0] - q[0]);
      const S = fmS[ci], h = fm[ci];
      o.debugStress({ fe: prof, lam: Array.from(S.sig).map((v, k) => [k, v, S.set[k], S.en[k], h.bornE[k]]), eB: S.eps0, epsF: S.epsF, eps0, kb: S.kb });
    }
    if (o.debugTop && i === nSt - 1) {
      const bAt = new Map(); for (const g of res.gp) { const d = dataAt(g.e, g.qi); const q = top.get(d.ci); if (q && d.cell === q.cell && !bAt.has(d.ci)) bAt.set(d.ci, [born.get(g.e * rule.length + g.qi), Array.from(g.strain), Array.from(g.stress)]); }
      o.debugTop([...top.keys()].map(ci => [cols[ci].ix, cols[ci].iy, sTop(ci), top.get(ci).cell, top.get(ci).n, bAt.get(ci)]));
    }
    const row = { x: r.series[i].x, t: r.series[i].t, i, eps0, mid: sTop(r.follow.mid), endL: r.follow.endL != null ? sTop(r.follow.endL) : null, endR: r.follow.endR != null ? sTop(r.follow.endR) : null, any, anyAt: anyAt != null ? [cols[anyAt].ix, cols[anyAt].iy] : null };
    series.push(row);
    if (r.snaps.some(sn => Math.abs(sn.x - r.series[i].x) < 1e-9) || i === nSt - 1) {
      const nodeS = new Float32Array(Ms.N * 2), nodeZ = new Float32Array(Ms.N), nodeY = new Float32Array(Ms.N);
      for (let n = 0; n < Ms.N; n++) { const s = res.stress.subarray ? res.stress.subarray(n * 6, n * 6 + 6) : res.stress.slice(n * 6, n * 6 + 6);
        nodeS[n * 2] = dim === 2 ? s[0] : s[1]; nodeS[n * 2 + 1] = dim === 2 ? s[2] : s[0]; nodeZ[n] = Ms.X[n * dim + dim - 1]; nodeY[n] = Ms.X[n * dim + (dim === 2 ? 0 : 1)]; }
      fields.push({ x: r.series[i].x, i, s: nodeS, z: nodeZ, y: nodeY, nn: Ms.nn.slice(), stride: Ms.stride.slice(), lev: lev.slice(), used: Uint8Array.from(used) });
    }
  });
  prog(order.length, order.length);
  const peak = Math.max(...series.map(s => s.any ?? -Infinity));
  return { kind: 'elements', series, fields, lam, peak: Number.isFinite(peak) ? peak : null };
}

/**
 * The section's (2D: x across, y up, the line out of its plane) or the piece's (3D: x along the line, y across, z up)
 * elastic solve, free along the line with no net force there: plane strain (2D) or the piece's end x = Lx held at a
 * common strain (3D), twice (the eigenstrains; a unit strain along the line), superposed. Ms: mp-core's mesh, mats,
 * eig and scale (mpElastic's), bc (the supports). Returns { gp [{ e, qi, x, stress, strain }], stress (nodal), eps0 }.
 */
function dmpSection(Ms, mats, eig, scale, bc, Lx, again) {
  const dim = Ms.dim, rule = DMP_MP.mpRule(1, dim, 2), dN = new Float64Array(Ms.npe * dim);
  // (again: this section's solve before, the same stiffness: its matrix factored once, the unit stretch along kept)
  const solve = (eg, extra, factored) => DMP_MP.mpElastic(Ms, { mats, plane: 'strain', eig: eg, scale, bc: bc.concat(extra || []), factored });
  let A, B, NA = 0, NB = 0;
  if (dim === 2) {
    A = solve(eig, null, again && again.factored); B = again ? again.B : solve(() => [0, 0, -1, 0, 0, 0], null, A.factored);
    A.gp.forEach((g, gi) => { const w = rule[g.qi].w * DMP_MP.mpJac(Ms, g.e, rule[g.qi], dN).det; NA += g.stress[2] * w; NB += B.gp[gi].stress[2] * w; });
  } else {
    A = solve(eig, [{ face: 'x1', fix: [0] }], again && again.factored); B = again ? again.B : solve(() => [0, 0, 0, 0, 0, 0], [{ face: 'x1', fix: [0], value: () => [Lx, 0, 0] }], A.factored);
    NA = A.reaction('x1')[0]; NB = B.reaction('x1')[0];
  }
  const eps0 = -NA / NB, al = dim === 2 ? 2 : -1;
  return { eps0, gp: A.gp.map((g, gi) => ({ e: g.e, qi: g.qi, x: g.x, stress: g.stress.map((v, c) => v + eps0 * B.gp[gi].stress[c]), strain: g.strain.map((v, c) => v + eps0 * B.gp[gi].strain[c] + (c === al ? eps0 : 0)) })),
    stress: A.stress.map((v, c) => v + eps0 * B.stress[c]), factored: A.factored, B };
}

if (typeof module !== 'undefined') module.exports = { dmpDry, dmpAxes, dmpSection, dmpEvap, dmpBotGases, dmpBotState, dmpSummary, dmpStress, dmpInterp };
