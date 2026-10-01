/*
 * drying.validate.js — checks of the drying in the oven (drying.js). Run: node drying.validate.js
 *  1. Water and air: IAPWS-IF97's own check values (saturation pressure and temperature), the heat of evaporation
 *     and water's viscosity against the steam tables, air against Incropera's table.
 *  2. The flakes' diffusion: Carnahan–Starling's d(φZ)/dφ against the derivative of φZ; D0 of a thin disc.
 *  3. Natural convection: the regime by the density difference (heat and the vapour's own buoyancy), facing up or
 *     down; slot jets: Martin's correlation computed apart, its ranges.
 *  4. Evaporation through a skin: both sides of the skin's outer face give the same flux; no skin: Stefan's log law.
 *  5. The constant-rate period: the wet film's top alone reaches the wet-bulb temperature, which with forced air is
 *     the air's adiabatic saturation temperature (psychrometry, computed apart) within 1.5 K; the strip on its wet
 *     plateau against the steady state (drConstantRate).
 *  6. Water and energy conserved (both ways out, with the water condensing at the oven's entry).
 *  7. Constant diffusivity, fixed evaporation: the exact series solution (Crank) through the film; the surface's
 *     early fall at a high drying Peclet number against the semi-infinite law e0 − 2F √(t / π𝒟).
 *  8. High Peclet (flakes frozen): the skin's front against its own ODE dδ/dt = E(δ) / (ρ_L (e0 − e_s) φ_m) (the water
 *     at 80 °C: at 60 °C it would sit below the oven air's dew point and gain water).
 *  9. Low Peclet (flakes fast): uniform compaction, the skin when the whole film reaches the packing, dry after the
 *     pores empty; the dry film = wet × φ0 / φ_m; the water left = the isotherm's.
 * 10. Top and bottom alike: the film symmetric.
 * 11. The line as set up: grid and time step converged; condensation at the oven's entry flagged; strong IR boils it;
 *     jets on top dry it faster.
 */
const D = require('./drying.js');
let fails = 0;
const check = (name, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const P0 = 101325;
const base = (over = {}) => ({
  h0: 1.72e-3, phi0: 0.4, phiM: 0.85, rhoS: 1900, rhoL: 1000, R: 2.5e-6, mul: 1, skinK: 1e-12, kS: 0.2, cS: 850,
  emis: 0.95, irAbs: 0.9, gab: { Xm: 0.07, C: 8, K: 0.8 }, web: { mass: 0.138, cp: 1300 }, airFrac: 0.5,
  U: 0.28 / 60, Lnat: 0.15, P: P0, Tin: 25, room: { len: 0.5, T: 25, rh: 0.5 },
  zones: [0, 1, 2].map(() => ({ len: 2, airU: 1, airT: 100, rh: 0.2, top: 'none', jetU: 10, jetT: 100, jetB: 0.005, jetH: 0.02, jetS: 0.1, ir: 5000 })),
  where: 'top', N: 80, M: 40, ...over });

// ---- 1. water and air ----
{
  // IAPWS-IF97 table 35 (saturation pressure) and table 36 (saturation temperature)
  const ps = [[300, 0.353658941e-2], [500, 0.263889776e1], [600, 0.123443146e2]].map(([T, p]) => rel(D.drPsat(T - 273.15), p * 1e6));
  const ts = [[0.1, 0.372755919e3], [1, 0.453035632e3], [10, 0.584149488e3]].map(([p, T]) => Math.abs(D.drTsat(p * 1e6) + 273.15 - T));
  check('IAPWS-IF97 saturation pressure (its check values at 300, 500, 600 K) within 1e-8', Math.max(...ps) < 1e-8, ps.map(v => v.toExponential(1)).join(', '));
  check('IAPWS-IF97 saturation temperature (at 0.1, 1, 10 MPa) within 1e-6 K', Math.max(...ts) < 1e-6, ts.map(v => v.toExponential(1)).join(', '));
  const L = [[25, 2441.7e3], [50, 2382.0e3], [75, 2321.4e3], [100, 2256.4e3]].map(([T, v]) => rel(D.drLatent(T), v));
  check('heat of evaporation within 0.5 % of the steam tables from 25 to 100 °C', Math.max(...L) < 0.005, L.map(v => (v * 100).toFixed(2) + '%').join(', '));
  const mu = [[20, 1.0016e-3], [50, 0.5465e-3], [80, 0.3544e-3]].map(([T, v]) => rel(D.drMuWater(T), v));
  check('water\'s viscosity within 2.5 % (20, 50, 80 °C)', Math.max(...mu) < 0.025, mu.map(v => (v * 100).toFixed(2) + '%').join(', '));
  const a = D.drAir(26.85, P0), ref = [[a.rho, 1.1614], [a.mu, 184.6e-7], [a.k, 26.3e-3], [a.Pr, 0.707]].map(([x, y]) => rel(x, y));
  check('air at 300 K (density, viscosity, conductivity, Pr) within 1.5 % of Incropera\'s table', Math.max(...ref) < 0.015, ref.map(v => (v * 100).toFixed(2) + '%').join(', '));
  const dv = rel(D.drAir(25, P0).Dv, 0.26e-4);
  check('water vapour\'s diffusivity in air at 298 K within 3 % (0.26 cm²/s)', dv < 0.03, (dv * 100).toFixed(2) + '%');
}

// ---- 2. the flakes' diffusion ----
{
  const phiZ = p => p * (1 + p + p * p - p * p * p) / Math.pow(1 - p, 3);
  const errs = [0.05, 0.2, 0.4, 0.6, 0.8].map(p => rel(D.drDphiZ(p, 0.85), (phiZ(p + 1e-6) - phiZ(p - 1e-6)) / 2e-6));
  check('Carnahan–Starling: d(φZ)/dφ matches the derivative of φZ (1e-6), 1 at φ = 0', Math.max(...errs) < 1e-6 && Math.abs(D.drDphiZ(0, 0.85) - 1) < 1e-12, errs.map(v => v.toExponential(1)).join(', '));
  const d0 = D.drD0(25, 2.5e-6), want = 1.380649e-23 * 298.15 / (12 * D.drMuWater(25) * 2.5e-6);
  check('a thin disc\'s Brownian diffusion kT / (12 μ R)', rel(d0, want) < 1e-12, `${d0.toExponential(3)} m²/s for a 5 µm flake at 25 °C`);
}

// ---- 3. natural convection and jets ----
{
  const up = D.drNat(60, 20, 0, 0, 0.15, P0, 'up'), dn = D.drNat(60, 20, 0, 0, 0.15, P0, 'down');
  const cold = D.drNat(20, 60, 0, 0, 0.15, P0, 'up'), coldDn = D.drNat(20, 60, 0, 0, 0.15, P0, 'down');
  const nuU = Math.max(0.54 * Math.pow(up.Ra, 0.25), 0.15 * Math.cbrt(up.Ra)), nuD = 0.52 * Math.pow(dn.Ra, 0.2);
  check('natural convection: hot surface facing up unstable (0.54 Ra^1/4 or 0.15 Ra^1/3), facing down stable (0.52 Ra^1/5); a cold one the other way round',
    up.unstable && !dn.unstable && !cold.unstable && coldDn.unstable && rel(up.Nu, nuU) < 1e-12 && rel(dn.Nu, nuD) < 1e-12,
    `Ra ${up.Ra.toExponential(2)}: Nu up ${up.Nu.toFixed(2)}, down ${dn.Nu.toFixed(2)}; h up ${up.h.toFixed(2)} W/(m² K)`);
  // the vapour alone (no temperature difference): moist air is lighter, rises off a surface facing up
  const v = D.drNat(50, 50, D.drPsat(50), 0, 0.15, P0, 'up'), vd = D.drNat(50, 50, D.drPsat(50), 0, 0.15, P0, 'down');
  check('the vapour\'s own buoyancy: a wet surface at the air\'s temperature still drives convection (unstable facing up, stable facing down)',
    v.unstable && !vd.unstable && v.h > 1 && v.km > 1e-3, `h ${v.h.toFixed(2)} W/(m² K), k_m ${(v.km * 1000).toFixed(2)} mm/s`);
  // Martin's slot nozzles, computed apart
  const jet = { U: 10, T: 100, B: 0.005, H: 0.02, S: 0.1 }, j = D.drJets(jet, P0), air = D.drAir(100, P0);
  const Re = 10 * 0.01 / air.nu, f = 0.05, f0 = 1 / Math.sqrt(60 + 4 * (0.02 / 0.01 - 2) ** 2);
  const Nu = 2 / 3 * f0 ** 0.75 * (2 * Re / (f / f0 + f0 / f)) ** (2 / 3) * air.Pr ** 0.42;
  const bad = D.drJets({ ...jet, H: 0.004 }, P0);
  check('slot jets (Martin): Nu as computed apart, within its ranges; too close a nozzle (H/2B 0.4) out of them', rel(j.Nu, Nu) < 1e-12 && j.valid && !bad.valid,
    `Re ${Re.toFixed(0)}, Nu ${j.Nu.toFixed(2)}, h ${j.h.toFixed(1)} W/(m² K)`);
}

// ---- 4. evaporation through a skin ----
{
  const gas = { kind: 'log', G: 0.005, C: P0 * 0.018015268 / (8.314462618 * 350), pa: 20000 }, pf = 60000;
  const noSkin = D.drEvap(pf, 0, 1e-12, gas, P0), want = gas.G * gas.C * Math.log((P0 - gas.pa) / (P0 - pf));
  const sk = D.drEvap(pf, 1e-4, 1e-12, gas, P0), outer = gas.G * gas.C * Math.log((P0 - gas.pa) / (P0 - sk.pi)), inner = 1e-12 * (pf - sk.pi) / 1e-4;
  const sup = { kind: 'supply', G: 0.5, C: gas.C, pa: 20000 }, sp = D.drEvap(pf, 2e-4, 1e-12, sup, P0), spOut = sup.G * sup.C * (sp.pi - sup.pa) / (P0 - sp.pi);
  check('evaporation: no skin is Stefan\'s log law; with a skin the gas side and the skin carry the same flux (log and supply sides)',
    rel(noSkin.m, want) < 1e-12 && rel(outer, sk.m) < 1e-9 && rel(inner, sk.m) < 1e-9 && rel(spOut, sp.m) < 1e-9 && sk.m < noSkin.m,
    `${(noSkin.m * 1e3).toFixed(3)} g/(m² s) bare, ${(sk.m * 1e3).toFixed(4)} through 100 µm of skin`);
}

// ---- 5. the constant-rate period ----
{
  // the wet top alone under jets (forced convection, no radiation, no IR): its wet-bulb temperature ...
  const o = base({ emis: 0 }), Z = { Ta: 100, pa: 0.2 * D.drPsat(100), Tw: 100, top: { kind: 'jet', jet: { U: 10, T: 100, B: 0.005, H: 0.02, S: 0.1 } }, ir: 0 };
  const bal = T => { const s = D.drTopSide(Z, T, D.drPsat(T), o); return s.q - D.drLatent(T) * D.drEvap(D.drPsat(T), 0, 0, s.gas, P0).m; };
  let lo = 20, hi = 99.9; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (bal(m) > 0) lo = m; else hi = m; }
  const Twb = (lo + hi) / 2;
  // ... against the air's adiabatic saturation temperature (psychrometry: humid heat and the latent heat, apart)
  const Y = p => 0.62198 * p / (P0 - p), Ya = Y(Z.pa);
  const g = T => (1006 + 1860 * Ya) * (100 - T) - (Y(D.drPsat(T)) - Ya) * D.drLatent(T);
  lo = 20; hi = 99.9; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (g(m) > 0) lo = m; else hi = m; }
  const Tas = (lo + hi) / 2;
  check('wet-bulb under jets (heat–mass analogy, Stefan\'s log) within 1.5 K of the adiabatic saturation temperature (100 °C air, 20 % RH)', Math.abs(Twb - Tas) < 1.5,
    `wet-bulb ${Twb.toFixed(2)} °C, adiabatic saturation ${Tas.toFixed(2)} °C`);
  // the strip on its wet plateau (the flakes fast: no skin yet) against the steady state
  const oS = base({ mul: 1e5, room: { len: 0, T: 25, rh: 0.5 }, zones: [{ len: 0.4, airU: 1, airT: 100, rh: 0.2, top: 'air', jetU: 10, jetT: 100, jetB: 0.005, jetH: 0.02, jetS: 0.1 }], U: 0.01, profilesAt: [] });
  const r = D.drStrip(oS), sp = r.series.filter(q => q.x > 0.3 && q.x <= 0.4), q = sp[sp.length - 1];
  const phi = oS.phi0 * oS.h0 / q.h, Rf = q.h / (1 / (phi / oS.kS + (1 - phi) / 0.6));
  const Zs = D.drStretches(oS)[0], cr = D.drConstantRate(Zs, Rf, 'top', oS);
  check('the strip\'s wet plateau (no skin yet) against the steady state: top and bottom within 0.3 K, evaporation within 2 %',
    Math.abs(q.Ts - cr.Ts) < 0.3 && Math.abs(q.Tb - cr.Tb) < 0.3 && rel(q.Et, cr.mt) < 0.02 && q.skinT === 0,
    `strip ${q.Ts.toFixed(2)} / ${q.Tb.toFixed(2)} °C, ${(q.Et * 1e3).toFixed(3)} g/(m² s); steady ${cr.Ts.toFixed(2)} / ${cr.Tb.toFixed(2)} °C, ${(cr.mt * 1e3).toFixed(3)} g/(m² s)`);
}

// ---- 6. water and energy conserved ----
for (const where of ['top', 'both']) {
  const r = D.drStrip(base({ where })), E = r.energy;
  const wb = Math.abs(r.evT + r.evB - r.lost) / r.W0, acc = Math.abs(r.W0 - r.exit.free - r.exit.bound - r.lost) / r.W0;
  const eb = Math.abs((E.H - E.H0) - (E.Qin - E.Qlat - E.Qsens)) / E.Qin;
  check(`${where === 'top' ? 'top only' : 'top and bottom'}: water conserved (evaporated = the film's loss within 1e-8; start = left + lost within 1e-12), energy within 0.5 %`,
    wb < 1e-8 && acc < 1e-12 && eb < 0.005 && r.events.condense != null,
    `water ${wb.toExponential(1)}, ${acc.toExponential(1)}; energy ${(eb * 100).toFixed(3)} % of ${(E.Qin / 1e6).toFixed(2)} MJ/m² in (water condensed at x = ${r.events.condense.toFixed(4)} m)`);
}

// ---- 7. constant diffusivity: the exact series; the surface's early fall ----
{
  const Dc = 8e-11, Ekg = 2e-4, F = Ekg / 1000, U = 0.01, ts = [100, 400, 1000];
  const o = base({ phiM: 0.99, room: { len: 0, T: 25, rh: 0.5 }, zones: [{ len: 10, airU: 1, airT: 100, rh: 0.2, top: 'none' }], U,
    h0: 1e-3, test: { T: 50, Et: Ekg, Dconst: Dc }, profilesAt: ts.map(t => t * U), dtScale: 0.25 });
  const r = D.drStrip(o), Phi = o.phi0 * o.h0, e0 = (1 - o.phi0) / o.phi0;
  const exact = (s, t) => { let sum = 0; for (let n = 1; n < 400; n++) sum += (n % 2 ? -1 : 1) / (n * n) * Math.exp(-n * n * Math.PI * Math.PI * Dc * t / (Phi * Phi)) * Math.cos(n * Math.PI * s);
    return e0 - F * t / Phi - F * Phi / Dc * ((3 * s * s - 1) / 6 - 2 / (Math.PI * Math.PI) * sum); };
  let err = 0;
  ts.forEach((t, i) => { const p = r.profiles[i]; p.zeta.forEach((z, j) => { err = Math.max(err, Math.abs(p.e[j] - exact(z / Phi, t))); }); });
  check('constant diffusivity, fixed evaporation: the water through the film against the exact series (Crank) within 0.002 (e0 1.5)', err < 2e-3,
    `max error ${err.toExponential(2)} at t = ${ts.join(', ')} s (Peclet F Φ / 𝒟 = ${(F * Phi / Dc).toFixed(1)})`);
  // high Peclet, early: e_surface = e0 − 2F √(t / (π 𝒟))
  const Dh = 1e-13, th = [0.05, 0.2, 0.5], Uh = 0.001;
  const oh = base({ phiM: 0.99, room: { len: 0, T: 25, rh: 0.5 }, zones: [{ len: 0.001, airU: 1, airT: 100, rh: 0.2, top: 'none' }], U: Uh, h0: 1e-3,
    test: { T: 50, Et: Ekg, Dconst: Dh }, profilesAt: th.map(t => t * Uh), dt0: 1e-5, dtScale: 0.1 });
  const rh = D.drStrip(oh), Phh = oh.phi0 * oh.h0;
  const errs = th.map((t, i) => { const p = rh.profiles[i], n = p.e.length, hh = Phh - p.zeta[n - 1], es = p.e[n - 1] - F * hh / Dh;
    const want = e0 - 2 * F * Math.sqrt(t / (Math.PI * Dh)); return { es, want, err: Math.abs(es - want) / (e0 - want) }; });
  check('high Peclet (F Φ / 𝒟 = 800): the surface\'s early fall e0 − 2F √(t / π𝒟) within 2 %', errs.every(q => q.err < 0.02),
    errs.map((q, i) => `t ${th[i]} s: ${q.es.toFixed(4)} vs ${q.want.toFixed(4)}`).join('; '));
}

// ---- 8. high Peclet: the skin's front ----
{
  const U = 0.005, len = 1.5;
  const o = base({ room: { len: 0, T: 25, rh: 0.5 }, zones: [{ len, airU: 1, airT: 100, rh: 0.2, top: 'none' }], U, test: { T: 80, Dconst: 1e-22 }, profilesAt: [0.25, 0.75, 1.5 - 1e-6], dtScale: 0.1 });
  const r = D.drStrip(o), Z = D.drStretches(o)[0], e0 = (1 - o.phi0) / o.phi0;
  const Edel = d => D.drSideState(D.drTopSide, Z, 80, 80, d, o).m;
  // the front's ODE: dδ/dt = E(δ) / (ρ_L (e0 − e_s) φ_m), from δ = 0 (RK4, fine steps)
  const f = d => Edel(d) / (o.rhoL * (e0 - r.es) * o.phiM);
  let d = 0, t = 0; const dtO = 0.05, marks = [0.25, 0.75, 1.5 - 1e-6].map(x => x / U), want = [];
  for (const tm of marks) { while (t < tm - 1e-9) { const h = Math.min(dtO, tm - t), k1 = f(d), k2 = f(d + h / 2 * k1), k3 = f(d + h / 2 * k2), k4 = f(d + h * k3); d += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4); t += h; } want.push(d); }
  const got = r.profiles.slice(0, 3).map(p => p.skinTop), errs = got.map((g, i) => rel(g, want[i]));
  check('flakes frozen (high Peclet): the skin grows as its own ODE says, E(δ) / (ρ_L (e0 − e_s) φ_m), within 0.5 %', errs.every(v => v < 0.005),
    got.map((g, i) => `${(g * 1e6).toFixed(2)} vs ${(want[i] * 1e6).toFixed(2)} µm`).join('; '));
}

// ---- 9. low Peclet: uniform compaction, then the pores empty ----
{
  const Ekg = 1e-3, U = 0.01;
  const o = base({ room: { len: 0, T: 25, rh: 0.5 }, zones: [{ len: 20, airU: 1, airT: 100, rh: 0.2, top: 'none' }], U, h0: 5e-4, test: { T: 50, Et: Ekg, Dconst: 1e-8 }, dtScale: 0.25 });
  const r = D.drStrip(o), Phi = o.phi0 * o.h0, e0 = (1 - o.phi0) / o.phi0, em = (1 - o.phiM) / o.phiM;
  const tSkin = (e0 - em) * Phi * o.rhoL / Ekg, tDry = tSkin + (em - r.es) * Phi * o.rhoL / Ekg;
  const gotSkin = r.events.skinTop / U, gotDry = r.events.dry / U;
  check('flakes fast (low Peclet): the skin when the whole film reaches the packing, dry when its pores have emptied (each within 1 %)',
    rel(gotSkin, tSkin) < 0.01 && rel(gotDry, tDry) < 0.01, `skin at ${gotSkin.toFixed(1)} s (${tSkin.toFixed(1)}), dry at ${gotDry.toFixed(1)} s (${tDry.toFixed(1)})`);
  // (dry: once the wet region is under 1e-5 of the film; that sliver's water stays counted)
  check('dry: the film = wet × φ0 / φ_m, the water left = the isotherm\'s at the last zone\'s humidity (each within 1e-4)',
    r.exit.dry && rel(r.exit.h, o.h0 * o.phi0 / o.phiM) < 1e-4 && rel(r.exit.waterPct, 100 * r.es * o.rhoL / o.rhoS) < 1e-4 && rel(r.exit.waterPct, 100 * r.Xb) < 1e-4,
    `${(r.exit.h * 1e6).toFixed(3)} µm, water left ${r.exit.waterPct.toFixed(3)} % of the GO (GAB at ${(r.aExit * 100).toFixed(0)} % humidity)`);
}

// ---- 10. top and bottom alike ----
{
  const o = base({ where: 'both', room: { len: 0, T: 25, rh: 0.5 }, zones: [{ len: 1, airU: 1, airT: 100, rh: 0.2, top: 'none' }], U: 0.01, test: { T: 50, Et: 3e-4, Eb: 3e-4, Dconst: 3e-14 }, profilesAt: [0.5] });
  const r = D.drStrip(o), p = r.profiles[0], n = p.e.length;
  let asym = 0; for (let j = 0; j < n; j++) asym = Math.max(asym, Math.abs(p.e[j] - p.e[n - 1 - j]));
  check('water leaving top and bottom alike: the film symmetric (skins equal, water mirror-image)', asym < 1e-7 && rel(p.skinTop, p.skinBottom) < 1e-6 && p.skinTop > 0,
    `skins ${(p.skinTop * 1e6).toFixed(3)} / ${(p.skinBottom * 1e6).toFixed(3)} µm, largest difference ${asym.toExponential(1)}`);
}

// ---- 11. the line as set up ----
{
  const at3 = r => D.drSample(r.series, 'skinT', [3])[0];
  const runs = [40, 80, 160].map(N => D.drStrip(base({ N, M: N / 2 })));
  const half = D.drStrip(base({ dtScale: 0.5 }));
  const w = runs.map(r => r.exit.waterPct), dw = Math.max(Math.abs(w[0] - w[2]), Math.abs(w[1] - w[2])), dt = Math.abs(half.exit.waterPct - runs[1].exit.waterPct);
  const ds = Math.max(...runs.map(r => rel(at3(r), at3(runs[2]))));
  check('the line as set up: grid (40, 80, 160 cells) and half the time step each within 0.1 %-points of water left, the skin at 3 m within 1 %',
    dw < 0.1 && dt < 0.1 && ds < 0.01, `water left ${w.map(v => v.toFixed(3)).join(', ')} %, half step ${half.exit.waterPct.toFixed(3)} %; skin at 3 m ${runs.map(r => (at3(r) * 1e6).toFixed(1)).join(', ')} µm`);
  const r0 = runs[1], dew = D.drTsat(0.2 * D.drPsat(100));
  check('the cold film into the humid oven: water condenses at the entry (the air\'s dew point above the film)', r0.events.condense != null && r0.events.condense < 0.05 && dew > 25,
    `dew point ${dew.toFixed(1)} °C, condensing from x = ${r0.events.condense.toFixed(4)} m`);
  const ir = D.drStrip(base({ zones: base().zones.map(z => ({ ...z, top: 'ir', ir: 40000 })) }));
  check('strong IR (40 kW/m²): the water under the skin reaches its boiling point (flagged)', ir.events.boil != null && ir.events.boilSkin, `boils at x = ${ir.events.boil && ir.events.boil.toFixed(3)} m`);
  const jets = D.drStrip(base({ zones: base().zones.map(z => ({ ...z, top: 'air' })) }));
  const w1 = r => D.drSample(r.series, 'wet', [1])[0];
  check('hot air blown on top dries faster than still air above', w1(jets) < w1(r0), `water at 1 m: ${(w1(jets) * 1e3).toFixed(0)} vs ${(w1(r0) * 1e3).toFixed(0)} g/m²`);
}


// ---- 9. the built-in laws as inputs (MC-1b, the material hub's): none given or the solver's own given -- the same
//         result to the last bit; each law as given equals matlib's own evaluation of it; the balances hold with them ----
{
  const ML = require('./matlib.js'), small = over => base({ N: 40, M: 20, ...over });
  const r0 = JSON.stringify(D.drStrip(small())), r1 = JSON.stringify(D.drStrip(small({ props: JSON.parse(JSON.stringify(D.DR_PROPS)) })));
  const ed = { waterCp: 3800, airCp: 1012, airMu: { y0: 1.8e-5, T0: 273.15, S: 120 } }, rx = D.drStrip(small({ props: ed })), r2 = JSON.stringify(D.drStrip(small()));
  check('laws as inputs: none given, or the solver\'s own given: the same result to the last bit; after a solve with others, its own again', r0 === r1 && r0 === r2 && JSON.stringify(rx) !== r0);
  const E = rx.energy, eb = Math.abs((E.H - E.H0) - (E.Qin - E.Qlat - E.Qsens)) / E.Qin, wb = Math.abs(rx.evT + rx.evB - rx.lost) / rx.W0;
  check('  water\'s c_p 3800, air\'s 1012 J/(kg K) and its Sutherland S 120 K given: water conserved within 1e-8, energy within 0.5 %', wb < 1e-8 && eb < 0.005, `water ${wb.toExponential(1)}; energy ${(eb * 100).toFixed(3)} %`);
  const q = (law, params, T, p = P0) => ML.mlQEval({ kind: 'law', law, params }, { T: T + 273.15, p });
  const g = { waterMu: { A: 3.0e-5, B: 250, C: 135 }, waterL: { y0: 2.45e6, T0: 273.15, b: -2400 }, airMu: { y0: 1.75e-5, T0: 273.15, S: 115 }, airK: { y0: 0.025, T0: 273.15, S: 200 },
    airDv: { y0: 2.2e-5, T0: 273.15, b: 1.75 }, airM: 0.029, airCp: 1010, psat: D.DR_PROPS.psat.map((x, i) => (i === 9 ? 650.2 : x)) };
  D.drUse(g);
  let e = 0;
  for (const T of [5, 25, 60, 95]) {
    const a = D.drAir(T, P0);
    e = Math.max(e, rel(D.drMuWater(T), q('vogel', g.waterMu, T)), rel(D.drLatent(T), q('linearT', g.waterL, T)), rel(D.drPsat(T), q('iapwsPsat', { n: g.psat }, T)),
      rel(a.mu, q('sutherland', g.airMu, T)), rel(a.k, q('sutherland', g.airK, T)), rel(a.rho, q('idealGas', { M: g.airM }, T)), rel(a.Dv, q('powerT', g.airDv, T)), rel(a.cp, 1010));
  }
  D.drUse();
  check('  each law given (Vogel, IAPWS-IF97\'s coefficients, linear latent heat, Sutherland μ and k, ideal gas M, D_v ∝ T^b, c_p) = matlib\'s evaluation of it, 5–95 °C', e < 1e-14, `max rel ${e.toExponential(1)}`);
  check('  and back to its own: drMuWater(20 °C) 1.0016 mPa·s', Math.abs(D.drMuWater(20) - 2.414e-5 * Math.pow(10, 247.8 / (293.15 - 140))) === 0);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
