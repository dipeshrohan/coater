'use strict';
/*
 * drying.js — GO-3: the wet film drying on its fibre web, from the blade through the room to the oven and through
 * the oven's zones (time = distance / line speed); 1D through the film's thickness.
 *  - Water: in the GO's own coordinate ζ (GO volume per area below a point: 0 at the web .. Φ = φ0 h0 at the top,
 *    fixed while the film shrinks), the water per GO volume e (solids φ = 1 / (1 + e)). The water moves against the
 *    flakes by their collective diffusion: flux q = −D(φ) φ² ∂e/∂ζ, D = D0 (1 − φ)^6.55 d(φZ)/dφ (Routh–Russel;
 *    Z Carnahan–Starling, up to the dry film's packing φ_m), D0 = kT / (12 μ R) (a
 *    thin disc of the flakes' mean radius R, water's viscosity at the local temperature).
 *  - A skin: where the solids reach the dry film's packing φ_m at a surface, the flakes stop there and the water
 *    leaves as vapour through the packed skin (a GO laminate's water-vapour permeability); the skin keeps the dry
 *    GO's bound water (its sorption isotherm, GAB, at the last zone's humidity). The wet region between the skins
 *    is followed by its fronts (a front-fixing grid clustered at both ends); fluxes exponentially fitted
 *    (Scharfetter–Gummel), exact for a steady compaction layer however thin (a high drying Peclet number).
 *  - Heat: 1D through the film, the web at its bottom: the air blown up through the fibre (it leaves at the film's
 *    bottom temperature: ρ c_p u), or still air below; on top the oven's still air (natural convection with the
 *    vapour's buoyancy), slot-nozzle jets (Martin) and IR; the walls radiate at the air's temperature. Evaporation
 *    takes its heat where the water leaves; Stefan (log) diffusion on the gas side; below, the air through the
 *    fibre carries the vapour away (it leaves saturated at most).
 * Water leaves from the top only ('top') or from the top and the bottom ('both'): both are computed (Q53).
 * SI inside (m, s, kg, Pa); temperatures in °C except where radiation needs kelvin.
 */

const DR_R = 8.314462618, DR_MW = 0.018015268, DR_MA = 0.0289647, DR_SIG = 5.670374419e-8, DR_KB = 1.380649e-23, DR_G = 9.80665;
const DR_CL = 4180;   // liquid water's specific heat (J/(kg K); 4178–4216 from 20 to 100 °C)
// IAPWS-IF97, region 4: the saturation line's coefficients n1..n10
const DR_IF97 = [0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.12020824702470e5, -0.32325550322333e7,
  0.14915108613530e2, -0.48232657361591e4, 0.40511340542057e6, -0.23855557567849, 0.65017534844798e3];
// The built-in material laws' parameters (MC-1b), as the material hub edits them: water's viscosity (Vogel), its saturation
// pressure (IAPWS-IF97's coefficients), its latent heat (linear in T, y0 at T0), its specific heat; dry air's viscosity and
// conductivity (Sutherland), its molar mass, the vapour's diffusivity in it (power law in T), its specific heat. These
// are the laws' own values; a solve takes its options' (o.props) through drUse.
const DR_PROPS = Object.freeze({ waterMu: { A: 2.414e-5, B: 247.8, C: 140 }, psat: DR_IF97, waterL: { y0: 2.501e6, T0: 273.15, b: -2361 }, waterCp: DR_CL,
  airMu: { y0: 1.716e-5, T0: 273.15, S: 110.4 }, airK: { y0: 0.0241, T0: 273.15, S: 194 }, airM: DR_MA, airDv: { y0: 2.26e-5, T0: 273.15, b: 1.81 }, airCp: 1007 });
let DR_P = DR_PROPS;
/** The laws the next solve takes: props (the hub's, where they differ from these), else the built-in ones. */
function drUse(props) { DR_P = props ? { ...DR_PROPS, ...props } : DR_PROPS; }
/** Water's saturation pressure (Pa) at Tc (°C): IAPWS-IF97 eq. 30 (0 to 373.946 °C). */
function drPsat(Tc) {
  const n = DR_P.psat, T = Math.min(Math.max(Tc + 273.15, 273.15), 647.096);
  const th = T + n[8] / (T - n[9]), A = th * th + n[0] * th + n[1], B = n[2] * th * th + n[3] * th + n[4], C = n[5] * th * th + n[6] * th + n[7];
  return 1e6 * Math.pow(2 * C / (-B + Math.sqrt(B * B - 4 * A * C)), 4);
}
/** Water's boiling point (°C) at pressure P (Pa): IAPWS-IF97 eq. 31. */
function drTsat(P) {
  const n = DR_P.psat, b = Math.pow(P / 1e6, 0.25);
  const E = b * b + n[2] * b + n[5], F = n[0] * b * b + n[3] * b + n[6], G = n[1] * b * b + n[4] * b + n[7];
  const D = 2 * G / (-F - Math.sqrt(F * F - 4 * E * G));
  return (n[9] + D - Math.sqrt((n[9] + D) * (n[9] + D) - 4 * (n[8] + n[9] * D))) / 2 - 273.15;
}
/** Water's heat of evaporation (J/kg) at Tc (°C): within 0.4 % of the steam tables from 0 to 100 °C. */
const drLatent = Tc => DR_P.waterL.y0 + DR_P.waterL.b * (Tc - (DR_P.waterL.T0 - 273.15));
/** Liquid water's viscosity (Pa s) at Tc (°C) (Vogel; within 2 % from 0 to 100 °C). */
const drMuWater = Tc => DR_P.waterMu.A * Math.pow(10, DR_P.waterMu.B / (Tc + 273.15 - DR_P.waterMu.C));
/** Dry air at Tc (°C) and P (Pa): density, viscosity (Sutherland), conductivity (Sutherland form), c_p, and water vapour's diffusivity in it. */
function drAir(Tc, P) {
  const q = DR_P, m = q.airMu, kk = q.airK, dv = q.airDv, T = Tc + 273.15, rho = P * q.airM / (DR_R * T);
  const mu = m.y0 * Math.pow(T / m.T0, 1.5) * (m.T0 + m.S) / (T + m.S);
  const k = kk.y0 * Math.pow(T / kk.T0, 1.5) * (kk.T0 + kk.S) / (T + kk.S), cp = q.airCp;
  const nu = mu / rho, alpha = k / (rho * cp), Dv = dv.y0 * Math.pow(T / dv.T0, dv.b) * (101325 / P);
  return { rho, mu, k, cp, nu, alpha, Pr: nu / alpha, Dv, Sc: nu / Dv };
}
/** Moist air's density (kg/m³) at Tc (°C) with vapour pressure pv (Pa), total P. */
const drMoistRho = (Tc, pv, P) => ((P - pv) * DR_P.airM + pv * DR_MW) / (DR_R * (Tc + 273.15));
/**
 * Natural convection on a horizontal surface (length scale L = area / perimeter) facing 'up' or 'down', driven by the
 * density difference of the air at the surface (Ts, its vapour pressure pvs) and away from it (Ta, pva): heat and the
 * vapour's own buoyancy together (Gebhart). Unstable (the light air under the surface facing up, or the heavy air on
 * a surface facing down): Nu = max(0.54 Ra^1/4, 0.15 Ra^1/3); stable: Nu = 0.52 Ra^1/5 (Raithby–Hollands). The
 * mass transfer by the analogy, Sh = Nu (Sc / Pr)^n (n the correlation's exponent).
 */
function drNat(Ts, Ta, pvs, pva, L, P, facing) {
  // (the vapour at a surface never above the total pressure: a dry skin's outer face may be hotter than boiling)
  const pv = Math.min(pvs, 0.999 * P);
  const Tf = (Ts + Ta) / 2, air = drAir(Tf, P), rs = drMoistRho(Ts, pv, P), ra = drMoistRho(Ta, Math.min(pva, 0.999 * P), P);
  const dr = ra - rs, Ra = DR_G * Math.abs(dr) / ((rs + ra) / 2) * L * L * L / (air.nu * air.alpha);
  const unstable = facing === 'up' ? dr > 0 : dr < 0;
  // the vapour by the same correlation at its own Rayleigh number Ra Sc/Pr (laminar or turbulent by that: one branch
  // for the heat and the other for the vapour between the two switches, the transfer continuous through them)
  const law = R => (unstable ? Math.max(0.54 * Math.pow(R, 0.25), 0.15 * Math.cbrt(R)) : 0.52 * Math.pow(R, 0.2));
  const Nu = law(Ra), Sh = law(Ra * air.Sc / air.Pr);
  return { h: Nu * air.k / L, km: Sh * air.Dv / L, Ra, Nu, Sh, unstable, air };
}
/**
 * An array of slot nozzles blowing onto the film (Martin 1977; VDI Heat Atlas): slot width B, pitch S, height H above
 * the film, jet speed U at the nozzle, air at Tj. Nu (on 2B) = 2/3 f0^3/4 (2 Re / (f/f0 + f0/f))^2/3 Pr^0.42,
 * f = B/S, f0 = [60 + 4 (H/2B − 2)²]^−1/2; Sh by Sh/Nu = (Sc/Pr)^0.42. valid: Martin's ranges (1500 ≤ Re ≤ 40000,
 * 0.008 ≤ f ≤ 2.5 f0, 1 ≤ H/2B ≤ 40).
 */
function drJets(jet, P) {
  const air = drAir(jet.T, P), D = 2 * jet.B, Re = jet.U * D / air.nu, f = jet.B / jet.S, hr = jet.H / D;
  const f0 = 1 / Math.sqrt(60 + 4 * (hr - 2) * (hr - 2));
  const Nu = 2 / 3 * Math.pow(f0, 0.75) * Math.pow(2 * Re / (f / f0 + f0 / f), 2 / 3) * Math.pow(air.Pr, 0.42);
  const valid = Re >= 1500 && Re <= 40000 && f >= 0.008 && f <= 2.5 * f0 && hr >= 1 && hr <= 40;
  return { h: Nu * air.k / D, km: Nu * Math.pow(air.Sc / air.Pr, 0.42) * air.Dv / D, Nu, Re, f, f0, valid, air };
}
/** The GAB sorption isotherm: water per dry mass (kg/kg) at water activity a. */
// (at a temperature T (°C): its C as exp(Hc/RT) from its value at T0 -- warm GO holds less at the same humidity; no T,
//  or no Hc (J/mol): the isotherm as it is)
const drGabC = (g, T) => (g.Hc && Number.isFinite(T) ? g.C * Math.exp(g.Hc / 8.314462618 * (1 / (T + 273.15) - 1 / ((Number.isFinite(g.T0) ? g.T0 : 25) + 273.15))) : g.C);
const drGAB = (a, g, T) => { const Ka = g.K * Math.min(Math.max(a, 0), 1), C = drGabC(g, T); return g.Xm * C * Ka / ((1 - Ka) * (1 - Ka + C * Ka)); };

// ---- the flakes' collective diffusion ----
/** d(φ Z)/dφ, Z Carnahan–Starling (hard spheres), up to the packing φm (finite there: the skin forms in a finite time). */
function drDphiZ(phi, phiM) {
  const p = Math.min(Math.max(phi, 0), phiM), q = 1 - p;
  return (1 + 4 * p + 4 * p * p - 4 * p * p * p + p * p * p * p) / (q * q * q * q);
}
/** The flakes' Brownian diffusion alone (m²/s): a thin disc of radius R in water at Tc, kT / (12 μ R) (orientation averaged). */
const drD0 = (Tc, R) => DR_KB * (Tc + 273.15) / (12 * drMuWater(Tc) * R);
/** Their collective diffusion at solids φ (m²/s): D0 (1 − φ)^6.55 d(φZ)/dφ × mul (mul: the card's factor). */
const drDcoll = (phi, Tc, R, phiM, mul = 1) => drD0(Tc, R) * Math.pow(1 - Math.min(phi, 0.999), 6.55) * drDphiZ(phi, phiM) * mul;

// ---- numerics ----
/** Faces 0..N (N even) on [0, 1], cells growing geometrically from both ends (the first a, relative) to the middle. */
function drFaces(N, a) {
  const n = N >> 1;
  let lo = 1 + 1e-9, hi = 3;
  const sum = r => a * (Math.pow(r, n) - 1) / (r - 1);
  if (a * n >= 0.5) { return Array.from({ length: N + 1 }, (_, k) => k / N); }
  for (let it = 0; it < 200; it++) { const m = (lo + hi) / 2; if (sum(m) > 0.5) hi = m; else lo = m; }
  const r = (lo + hi) / 2, s = [0];
  for (let k = 0; k < n; k++) s.push(s[k] + a * Math.pow(r, k));
  const half = s.slice(), scale = 0.5 / half[n];
  const out = half.map(v => v * scale);
  for (let k = n - 1; k >= 0; k--) out.push(1 - out[k]);
  return out;
}
/** Bernoulli function x / (e^x − 1) (1 at 0; stable for large |x|). */
function drB(x) {
  if (Math.abs(x) < 1e-6) return 1 - x / 2;
  if (x > 700) return x * Math.exp(-x);
  if (x < -700) return -x;
  return x / Math.expm1(x);
}
/** Scharfetter–Gummel flux (upward) between a value below (eLo) and one above (eHi) a distance h apart: diffusion D, the medium moving up at v. */
const drSG = (D, h, v, eLo, eHi) => { const P = v * h / D; return D / h * (drB(-P) * eLo - drB(P) * eHi); };
/** Tridiagonal solve (Thomas): a sub, b diagonal, c super, d right side; returns x (into out when given). */
const DR_TRI = new Map();
function drTri(a, b, c, d, out) {
  const n = b.length;
  let w = DR_TRI.get(n); if (!w) { w = [new Float64Array(n), new Float64Array(n)]; DR_TRI.set(n, w); }
  const [cp, dp] = w, x = out || new Float64Array(n);
  let m = b[0]; cp[0] = c[0] / m; dp[0] = d[0] / m;
  for (let i = 1; i < n; i++) { m = b[i] - a[i] * cp[i - 1]; cp[i] = c[i] / m; dp[i] = (d[i] - a[i] * dp[i - 1]) / m; }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

// ---- evaporation through a skin and the gas side ----
/**
 * Evaporation (kg/(m² s)) from water at pf (its vapour pressure, Pa) through a skin (thickness delta, permeability
 * K kg/(m s Pa): flux K (pf − pi) / delta) into the gas side, which takes it as
 *   'log':    G C ln((P − pa) / (P − pi))       (Stefan diffusion, conductance G m/s, C = P M_w / (R T))
 *   'supply': G C (pi − pa) / (P − pi)          (air arriving at G m³/(m² s) leaves with the vapour at pi)
 * pi, at the skin's outer face, balances the two. Negative: water condenses.
 */
function drEvap(pf, delta, K, gas, P) {
  const Pm = P * (1 - 1e-12), cap = p => Math.min(p, Pm);
  const out = p => gas.kind === 'log' ? gas.G * gas.C * Math.log((P - gas.pa) / (P - cap(p))) : gas.G * gas.C * (cap(p) - gas.pa) / (P - cap(p));
  if (!(delta > 0)) return { m: out(pf), pi: cap(pf) };
  // g(p) = out(p) − K (pf − p) / delta: increasing in p; the root between min(pf, pa) and min(max(pf, pa), Pm)
  const kd = K / delta, g = p => out(p) - kd * (pf - p);
  let lo = Math.min(pf, gas.pa), hi = Math.min(Math.max(pf, gas.pa), Pm);
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

// ---- the stretches along the line: the room before the oven, then the zones ----
/**
 * The conditions along the line: [{x0, x1 (m from the oven's entry; the room negative), Ta, pa (the air's vapour
 * pressure), Tw (walls), top: {kind 'nat' | 'jet', jet}, ir (W/m² absorbed), bottom: {kind 'air' | 'nat', ua}, name}].
 */
function drStretches(o) {
  drUse(o.props);
  const out = [], P = o.P;
  if (o.room.len > 0) out.push({ name: 'room', x0: -o.room.len, x1: 0, Ta: o.room.T, pa: o.room.rh * drPsat(o.room.T), Tw: o.room.T, top: { kind: 'nat' }, ir: 0, bottom: { kind: 'nat', ua: 0 } });
  let x = 0;
  o.zones.forEach((z, i) => {
    const top = z.top || 'none', air = top === 'air' || top === 'air+ir', ir = top === 'ir' || top === 'air+ir';
    out.push({ name: `zone ${i + 1}`, zone: i, x0: x, x1: x + z.len, Ta: z.airT, pa: z.rh * drPsat(z.airT), Tw: z.airT,
      top: air ? { kind: 'jet', jet: { U: z.jetU, T: z.jetT, B: z.jetB, H: z.jetH, S: z.jetS } } : { kind: 'nat' },
      ir: ir ? o.irAbs * z.ir : 0, bottom: z.airU > 0 ? { kind: 'air', ua: z.airU } : { kind: 'nat', ua: 0 } });
    x += z.len;
  });
  // (after the oven, when asked: the room again, to the peel -- still air above and below, nothing blown)
  if (o.after && o.after.len > 0) out.push({ name: 'after', x0: x, x1: x + o.after.len, Ta: o.after.T, pa: o.after.rh * drPsat(o.after.T), Tw: o.after.T, top: { kind: 'nat' }, ir: 0, bottom: { kind: 'nat', ua: 0 } });
  void P;
  return out;
}

/**
 * The top's heat (W/m², into the film, without evaporation) and the gas side for its vapour at surface temperature Ts
 * (°C) with the vapour pressure pvs there: convection (still air or jets) + the walls' radiation + IR.
 */
function drTopSide(Z, Ts, pvs, o) {
  const P = o.P;
  let h, km, Tair;
  if (Z.top.kind === 'jet') { const j = drJets(Z.top.jet, P); h = j.h; km = j.km; Tair = Z.top.jet.T; }
  else { const n = drNat(Ts, Z.Ta, pvs, Z.pa, o.Lnat, P, 'up'); h = n.h; km = n.km; Tair = Z.Ta; }
  const Tk = Ts + 273.15, Twk = Z.Tw + 273.15;
  const q = h * (Tair - Ts) + o.emis * DR_SIG * (Twk * Twk * Twk * Twk - Tk * Tk * Tk * Tk) + Z.ir;
  const Tg = (Ts + Tair) / 2 + 273.15;
  return { q, gas: { kind: 'log', G: km, C: P * DR_MW / (DR_R * Tg), pa: Z.pa } };
}
/** The bottom's heat (W/m², into the film) and gas side at the film's bottom temperature Tb: the air up through the fibre, or still air below. */
function drBottomSide(Z, Tb, pvs, o) {
  const P = o.P;
  if (Z.bottom.kind === 'air') {
    const Tin = Z.Ta, rho = P * DR_MA / (DR_R * (Tin + 273.15));
    return { q: rho * 1007 * Z.bottom.ua * (Tin - Tb), gas: { kind: 'supply', G: o.airFrac * Z.bottom.ua, C: P * DR_MW / (DR_R * (Tin + 273.15)), pa: Z.pa } };
  }
  const n = drNat(Tb, Z.Ta, pvs, Z.pa, o.Lnat, P, 'down');
  return { q: n.h * (Z.Ta - Tb), gas: { kind: 'log', G: o.airFrac * n.km, C: P * DR_MW / (DR_R * ((Tb + Z.Ta) / 2 + 273.15)), pa: Z.pa } };
}

/**
 * A side (drTopSide or drBottomSide) of stretch Z with the water at Tf under a skin delta thick (0: none), the surface
 * at Tsurf: evaporation m (kg/(m² s)), the side's heat q (W/m², without evaporation), the surface's vapour pressure.
 * (The gas side's natural convection feels the vapour at the surface: through a skin, its outer face's pressure.)
 */
function drSideState(side, Z, Tf, Tsurf, delta, o) {
  const pf = drPsat(Tf), P = o.P;
  if (!(delta > 0)) { const g = side(Z, Tsurf, pf, o); return { m: drEvap(pf, 0, 0, g.gas, P).m, q: g.q, pv: pf }; }
  // the outer face's vapour pressure pv: drEvap's balance (through the skin = into the air) with the gas side taken at
  // pv itself, solved for pv -- h(pv) = drEvap's pv − pv, bracketed between the air's and the water's pressures (drEvap
  // stays between them), secant steps kept inside the bracket
  const at = pv => { const g = side(Z, Tsurf, pv, o), r = drEvap(pf, delta, o.skinK, g.gas, P); return { pv, g, r, h: r.pi - pv }; };
  let a = at(Math.min(pf, drPsat(Tsurf)));
  const pa = a.g.gas.pa, tol = 1e-11 * P;
  let lo = Math.min(pf, pa), hi = Math.min(Math.max(pf, pa), P * (1 - 1e-12));
  if (a.h > 0) lo = Math.max(lo, a.pv); else hi = Math.min(hi, a.pv);
  let b = Math.abs(a.h) <= tol ? a : at(Math.min(Math.max(a.r.pi, lo), hi));
  for (let it = 0; it < 60 && Math.abs(b.h) > tol && hi - lo > tol; it++) {
    if (b.h > 0) lo = Math.max(lo, b.pv); else hi = Math.min(hi, b.pv);
    let pn = b.h !== a.h ? b.pv - b.h * (b.pv - a.pv) / (b.h - a.h) : NaN;
    if (!(pn > lo && pn < hi)) pn = 0.5 * (lo + hi);
    a = b; b = at(pn);
  }
  return { m: b.r.m, q: b.g.q, pv: b.r.pi };
}

/**
 * The film's steady state if its surfaces stayed wet (the constant-rate period) in stretch Z: top and bottom
 * temperatures and evaporation (kg/(m² s)) with the film's conduction between them (resistance Rf, m² K/W).
 * where: 'top' (the bottom sealed) or 'both'.
 */
function drConstantRate(Z, Rf, where, o) {
  const f = ([Ts, Tb]) => {
    const pt = drPsat(Ts), pb = drPsat(Tb), t = drTopSide(Z, Ts, pt, o), b = drBottomSide(Z, Tb, pb, o);
    const mt = drEvap(pt, 0, 0, t.gas, o.P).m, mb = where === 'both' ? drEvap(pb, 0, 0, b.gas, o.P).m : 0, qc = (Tb - Ts) / Rf;
    return { r: [t.q + qc - drLatent(Ts) * mt, b.q - qc - drLatent(Tb) * mb], mt, mb };
  };
  const Tbp = drTsat(o.P) - 1e-6;
  let x = [Math.min(Z.Ta, Tbp) - 5, Math.min(Z.Ta, Tbp) - 2];
  for (let it = 0; it < 100; it++) {
    const f0 = f(x), J = [[0, 0], [0, 0]], d = 1e-4;
    for (let k = 0; k < 2; k++) { const y = x.slice(); y[k] += d; const f1 = f(y).r; J[0][k] = (f1[0] - f0.r[0]) / d; J[1][k] = (f1[1] - f0.r[1]) / d; }
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    let dx = [(-f0.r[0] * J[1][1] + f0.r[1] * J[0][1]) / det, (-f0.r[1] * J[0][0] + f0.r[0] * J[1][0]) / det];
    const lim = 10, mx = Math.max(Math.abs(dx[0]), Math.abs(dx[1]));
    if (mx > lim) dx = dx.map(v => v * lim / mx);
    x = [Math.min(x[0] + dx[0], Tbp), Math.min(x[1] + dx[1], Tbp)];
    if (mx < 1e-9) break;
  }
  const r = f(x);
  return { Ts: x[0], Tb: x[1], mt: r.mt, mb: r.mb };
}

/**
 * One water step of a strip through the film (drStrip's; the stage multiphysics' columns): Newton on the wet region's
 * water e (and the fronts' speeds) with the temperatures held, implicit over dtv. G: the column's grid and constants
 * { N, s, sc, ds (the wet region's faces, centres, widths on [0, 1]), Phi, phiM, em, es, e0, rhoL, both, T (the tests'),
 * D0T (Tv) (the flakes' D0 at Tv, × the card's factor), Dphi (ev) (its solids' part), evapTop / evapBot (Z, Tf, Tsurf,
 * delta) (kg/(m² s)), stats }; S: its state { e, zt, zb, modeT, modeB, wt, wb (the fronts' last speeds) }, unchanged;
 * tAt (ζ): the temperature there; TsV, TbV: the surfaces'. Returns the step's water { e, wt, wb, Et, Eb, zt, zb, FN, F0 }
 * or null (Newton did not converge).
 */
/** drWaterStep's working arrays, kept per grid size (a step neither nests nor keeps them). */
const DR_WSCR = new Map();
function drWaterScratch(N) {
  let w = DR_WSCR.get(N);
  if (!w) {
    const n2 = N + 2, f = k => new Float64Array(k);
    w = { F: f(N + 1), fLo: f(N + 1), fHi: f(N + 1), fF: f(N + 1), fOk: new Uint8Array(N + 1), D0f: f(N + 1), X: f(n2), R0: f(n2), R1: f(n2),
      A: f(N), Bd: f(N), Cu: f(N), Y: f(n2), hs: f(N), colT: f(n2), colB: f(n2), rowT: f(N), rowB: f(N), rhs: f(N), dx: f(n2), Xn: f(n2), xe: f(N), ys0: f(N), ys1: f(N) };
    DR_WSCR.set(N, w);
  }
  return w;
}
function drWaterStep(G, S, Z, dtv, tAt, TsV, TbV, start) {
  const { N, s, sc, ds, Phi, phiM, em, es, e0, rhoL, both, T, D0T, Dphi, stats } = G, { e, zt, zb, modeT, modeB } = S;
  stats.water++;
  // (within a step the sides' evaporation changes only with the skin's thickness, and a face's flux only with the
  //  water on its two sides and the fronts: each kept for the inputs it was worked out for -- the Jacobian's columns
  //  move a third of the cells at a time -- and worked out again when an input differs in any bit)
  const memo = f => { const m = new Map(); return (Zz, Tf, Ts, d) => { let v = m.get(d); if (v === undefined) { v = f(Zz, Tf, Ts, d); m.set(d, v); } return v; }; };
  const evapTop = memo(G.evapTop), evapBot = memo(G.evapBot);
  const nb = (modeT === 'skin' ? 1 : 0) + (modeB === 'skin' ? 1 : 0), n = N + nb;
  const iT = modeT === 'skin' ? N : -1, iB = modeB === 'skin' ? N + (modeT === 'skin' ? 1 : 0) : -1;
  // the temperatures at the faces (old positions) for D
  const W_ = drWaterScratch(N), sub = (a, k) => a.subarray(0, k);
  const L0 = zt - zb, D0f = W_.D0f;
  for (let k = 0; k <= N; k++) D0f[k] = D0T(T.T != null ? T.T : tAt(zb + L0 * s[k]));
  const Dk = (ev, k) => T.Dconst ? T.Dconst : D0f[k] * Dphi(ev);
  const TfT = T.T != null ? T.T : modeT === 'skin' ? tAt(zt) : TsV;
  const TfB = T.T != null ? T.T : modeB === 'skin' ? tAt(zb) : TbV;
  const { F, fLo, fHi, fF, fOk } = W_;
  let fL = NaN, fWt = NaN, fWb = NaN;
  let Eused = [0, 0];   // the evaporation (kg/(m² s)) the last residual used: top, bottom
  const res = (X, R) => {
    const wt = iT >= 0 ? X[iT] : 0, wb = iB >= 0 ? X[iB] : 0;
    const zt1 = modeT === 'skin' ? zt + wt * dtv : Phi, zb1 = modeB === 'skin' ? zb + wb * dtv : 0, L = zt1 - zb1;
    if (!(Object.is(L, fL) && Object.is(wt, fWt) && Object.is(wb, fWb))) { fOk.fill(0); fL = L; fWt = wt; fWb = wb; }
    for (let k = 1; k < N; k++) {
      if (fOk[k] && Object.is(fLo[k], X[k - 1]) && Object.is(fHi[k], X[k])) { F[k] = fF[k]; continue; }
      const h = L * (sc[k] - sc[k - 1]), D = Dk(0.5 * (X[k - 1] + X[k]), k);
      F[k] = drSG(D, h, -(wb + s[k] * (wt - wb)), X[k - 1], X[k]);
      fLo[k] = X[k - 1]; fHi[k] = X[k]; fF[k] = F[k]; fOk[k] = 1;
    }
    let rT = 0, rB = 0;
    if (modeT === 'skin') {
      const h = L * (1 - sc[N - 1]), D = Dk(0.5 * (X[N - 1] + em), N);
      F[N] = drSG(D, h, -wt, X[N - 1], em);
      const E = evapTop(Z, TfT, TsV, (Phi - zt1) / phiM) / rhoL;
      rT = F[N] - (E - es * wt); Eused[0] = E * rhoL;
    } else { F[N] = evapTop(Z, TfT, TsV, 0) / rhoL; Eused[0] = F[N] * rhoL; }
    if (modeB === 'skin') {
      const h = L * sc[0], D = Dk(0.5 * (X[0] + em), 0);
      F[0] = drSG(D, h, -wb, em, X[0]);
      const E = evapBot(Z, TfB, TbV, zb1 / phiM) / rhoL;
      rB = F[0] - (-E - es * wb); Eused[1] = E * rhoL;
    } else { F[0] = modeB === 'free' ? -evapBot(Z, TfB, TbV, 0) / rhoL : 0; Eused[1] = -F[0] * rhoL; }
    for (let j = 0; j < N; j++) R[j] = (X[j] * L - e[j] * L0) * ds[j] / dtv - (F[j] - F[j + 1]);
    if (iT >= 0) R[iT] = rT;
    if (iB >= 0) R[iB] = rB;
    return R;
  };
  // the unknowns' start: e as it is, the fronts' last speeds
  const X = sub(W_.X, n);
  for (let j = 0; j < N; j++) X[j] = start ? start.e[j] : e[j];
  if (iT >= 0) X[iT] = start ? start.wt : S.wt || 0;
  if (iB >= 0) X[iB] = start ? start.wb : S.wb || 0;
  const wScale = Math.max(1e-12, Math.abs(evapTop(Z, TfT, TsV, 0)) / rhoL / Math.max(em, 1e-3), both ? Math.abs(evapBot(Z, TfB, TbV, 0)) / rhoL / Math.max(em, 1e-3) : 0);
  const R0 = sub(W_.R0, n), R1 = sub(W_.R1, n);
  // (the residual in flux units against the water a step moves through the film: the thin cells hold little water
  // and their round-off must not rule)
  const fScale = Math.max(wScale * (e0 + 1), e0 * L0 / dtv * 1e-3);
  const norm = R => { let m = 0; for (let j = 0; j < N; j++) m = Math.max(m, Math.abs(R[j])); if (iT >= 0) m = Math.max(m, Math.abs(R[iT])); if (iB >= 0) m = Math.max(m, Math.abs(R[iB])); return m / fScale; };
  let ok = false;
  const { A, Bd, Cu, hs } = W_, Y = sub(W_.Y, n);
  A[0] = 0; Cu[N - 1] = 0;   // (never set below: as a new array's)
  const colT = iT >= 0 ? sub(W_.colT, n) : null, colB = iB >= 0 ? sub(W_.colB, n) : null;
  const rowT = iT >= 0 ? W_.rowT.fill(0) : null, rowB = iB >= 0 ? W_.rowB.fill(0) : null;
  let rAt = false;   // (R1 holds the residual at X: the line search's last, accepted point)
  for (let it = 0; it < 30; it++) {
    stats.newton++;
    if (rAt) R0.set(R1); else res(X, R0);
    // the Jacobian: tridiagonal in e (three colours), the fronts' columns, their rows
    for (let col = 0; col < 3; col++) {
      Y.set(X);
      for (let j = col; j < N; j += 3) { hs[j] = 1e-7 * (1 + Math.abs(X[j])); Y[j] += hs[j]; }
      res(Y, R1);
      for (let j = col; j < N; j += 3) {
        Bd[j] = (R1[j] - R0[j]) / hs[j];
        if (j > 0) Cu[j - 1] = (R1[j - 1] - R0[j - 1]) / hs[j];
        if (j < N - 1) A[j + 1] = (R1[j + 1] - R0[j + 1]) / hs[j];
        if (iT >= 0 && j === N - 1) rowT[j] = (R1[iT] - R0[iT]) / hs[j];
        if (iB >= 0 && j === 0) rowB[j] = (R1[iB] - R0[iB]) / hs[j];
      }
    }
    for (const [idx, colv] of [[iT, colT], [iB, colB]]) {
      if (idx < 0) continue;
      Y.set(X); const hw = 1e-6 * (Math.abs(X[idx]) + wScale);
      Y[idx] += hw; res(Y, R1);
      for (let r = 0; r < n; r++) colv[r] = (R1[r] - R0[r]) / hw;
    }
    // solve [A B; C D] [de; dw] = −R
    const rhs = W_.rhs;
    for (let j = 0; j < N; j++) rhs[j] = -R0[j];
    const xe = drTri(A, Bd, Cu, rhs, W_.xe);
    const dx = sub(W_.dx, n);
    if (nb === 0) { for (let j = 0; j < N; j++) dx[j] = xe[j]; }
    else {
      const idxs = [iT, iB].filter(i => i >= 0), cols = idxs.map(i => i === iT ? colT : colB), rows = idxs.map(i => i === iT ? rowT : rowB);
      const Ys = cols.map((cv, b) => drTri(A, Bd, Cu, cv.subarray(0, N), b ? W_.ys1 : W_.ys0));
      const S = idxs.map((ri, a) => idxs.map((ci, b) => { let v = cols[b][ri]; for (let j = 0; j < N; j++) v -= rows[a][j] * Ys[b][j]; return v; }));
      const g = idxs.map((ri, a) => { let v = -R0[ri]; for (let j = 0; j < N; j++) v -= rows[a][j] * xe[j]; return v; });
      let dw;
      if (idxs.length === 1) dw = [g[0] / S[0][0]];
      else { const det = S[0][0] * S[1][1] - S[0][1] * S[1][0]; dw = [(g[0] * S[1][1] - g[1] * S[0][1]) / det, (g[1] * S[0][0] - g[0] * S[1][0]) / det]; }
      for (let j = 0; j < N; j++) { let v = xe[j]; for (let b = 0; b < idxs.length; b++) v -= Ys[b][j] * dw[b]; dx[j] = v; }
      idxs.forEach((i, b) => { dx[i] = dw[b]; });
    }
    // damped update: the residual's norm must fall
    const n0 = norm(R0);
    let lam = 1, Xn;
    rAt = false;
    for (let ls = 0; ls < 12; ls++) {
      Xn = sub(W_.Xn, n); Xn.set(X);
      for (let r = 0; r < n; r++) Xn[r] += lam * dx[r];
      let bad = false;
      for (let j = 0; j < N; j++) if (!(Xn[j] > -0.5 * em)) { bad = true; break; }
      if (modeT === 'skin' && !(zt + Xn[iT] * dtv > zb + (modeB === 'skin' ? Xn[iB] * dtv : 0))) bad = true;
      rAt = false;
      if (!bad) { const nn = norm(res(Xn, R1)); rAt = true; if (nn < n0 || nn < 1e-11) break; }
      lam /= 2;
    }
    let step = 0;
    for (let j = 0; j < N; j++) step = Math.max(step, Math.abs(Xn[j] - X[j]) / (1 + Math.abs(X[j])));
    for (const i of [iT, iB]) if (i >= 0) step = Math.max(step, Math.abs(Xn[i] - X[i]) / (wScale * 10));
    X.set(Xn);
    if (step < 1e-9) { ok = true; break; }
  }
  if (!ok) { const nf = norm(res(X, R0)); ok = nf < 1e-9; }
  if (!ok) return null;
  const wt = iT >= 0 ? X[iT] : 0, wb = iB >= 0 ? X[iB] : 0;
  res(X, R0);
  return { e: Float64Array.from(X.subarray(0, N)), wt, wb, Et: Eused[0], Eb: Eused[1], zt: modeT === 'skin' ? zt + wt * dtv : Phi, zb: modeB === 'skin' ? zb + wb * dtv : 0, FN: F[N], F0: F[0] };
}

/**
 * One strip through the line. o (SI):
 *   h0 wet film (m), phi0 solids, phiM the dry film's packing, rhoS / rhoL (kg/m³), R flake radius (m), mul (the
 *   collective diffusion's factor), skinK (kg/(m s Pa)), kS (GO's conductivity through the film), cS (J/(kg K)),
 *   emis, irAbs, gab {Xm, C, K}, web {mass kg/m², cp}, airFrac (the fibre's open top), U line speed (m/s), Lnat
 *   (natural convection's length, m), P (Pa), Tin (°C), room {len, T, rh}, zones [{len, airU, airT, rh (0..1), top,
 *   jetU, jetT, jetB, jetH, jetS (m), ir (W/m²)}], where 'top' | 'both', N (water cells), M (temperature cells),
 *   profilesAt: [x...] (m) where to keep the profiles.
 *   test (validation only): {T: fixed temperature, Et / Eb: fixed evaporation (kg/(m² s)), Dconst: the water's
 *   diffusivity in ζ fixed (m²/s), noSkinR: no skin resistance}.
 * Returns the series along the line, events, the state at the exit, profiles.
 */
function drStrip(o) {
  drUse(o.props);
  const N = 2 * Math.ceil((o.N || 80) / 2), M = 2 * Math.ceil((o.M || 40) / 2), P = o.P, T = o.test || {};
  const phiM = o.phiM, em = (1 - phiM) / phiM, e0 = (1 - o.phi0) / o.phi0, Phi = o.phi0 * o.h0;
  const rhoL = o.rhoL, rhoS = o.rhoS, Tboil = drTsat(P);
  if (!(phiM > o.phi0 * 1.001)) throw new Error(`the dry film's packing (${phiM}) is not above the slurry's solids (${+(o.phi0 * 100).toFixed(2)} vol%): the film would not shrink as it dries (Materials)`);
  if (!(o.h0 > 0) || !(o.U > 0)) throw new Error('no wet film, or the line not moving');
  const Zs = drStretches(o), xEnd = Zs[Zs.length - 1].x1, xStart = Zs[0].x0;
  // the skin's bound water: the dry GO's isotherm at the last zone's humidity (kept below the packing's pores)
  const Zl = [...Zs].reverse().find(Z => Z.name !== 'after'), aExit = Math.min(1, Zl.pa / drPsat(Zl.Ta)), Xb = drGAB(aExit, o.gab, Zl.Ta);
  const xOven = Zs.filter(Z => Z.name !== 'after').pop().x1;   // (the oven's exit; the line's end when nothing follows it)
  const es = Math.min(Xb * rhoS / rhoL, 0.9 * em), swells = Xb * rhoS / rhoL > 0.9 * em;
  // each stretch's constant rate (the wet film's steady state were its surfaces to stay wet) and its drying Peclet
  // number h0 E / D(φ0) there
  const Rf = o.h0 / (1 / (o.phi0 / o.kS + (1 - o.phi0) / 0.6));
  const rates = Zs.map(Z => { const c = drConstantRate(Z, Rf, o.where, o), Tm = (c.Ts + c.Tb) / 2;
    return { name: Z.name, x0: Z.x0, x1: Z.x1, ...c, Pe: o.h0 * (c.mt + c.mb) / rhoL / drDcoll(o.phi0, Tm, o.R, phiM, o.mul) }; });
  const Pe = (rates.find(r => r.name !== 'room') || rates[0]).Pe;
  // grids: the wet region's (front-fixing, clustered at both ends: the thinnest cell a hundredth of the thinnest
  // compaction layer the Peclet numbers make, 1/Pe of the film) and the temperature's (fixed in ζ)
  const peMax = T.Dconst ? Math.abs(T.Et != null ? T.Et : 1e-3) / rhoL * Phi / T.Dconst : Math.max(1, ...rates.map(r => Math.abs(r.Pe) || 0));
  const aWet = o.aWet || Math.min(0.02, Math.max(2e-6, 0.01 / peMax));
  const s = drFaces(N, aWet), sc = new Float64Array(N), ds = new Float64Array(N);
  for (let j = 0; j < N; j++) { sc[j] = (s[j] + s[j + 1]) / 2; ds[j] = s[j + 1] - s[j]; }
  const sT = drFaces(M, 1e-3).map(v => v * Phi), scT = new Float64Array(M);
  for (let c = 0; c < M; c++) scT[c] = (sT[c] + sT[c + 1]) / 2;
  const both = o.where === 'both';
  // state
  let e = new Float64Array(N).fill(e0), zt = Phi, zb = 0, modeT = 'free', modeB = both ? 'free' : 'none', dry = false;
  const Tin = T.T != null ? T.T : o.Tin;   // (a fixed temperature (validation) from the start)
  let Tc = new Float64Array(M).fill(Tin), Ts = Tin, Tb = Tin;
  let x = xStart, t = 0, dt = o.dt0 || 1e-3;
  const W0 = e0 * Phi * rhoL;       // water per area at the start (kg/m²)
  let evT = 0, evB = 0, lost = 0;   // evaporated through the top / the bottom (kg/m², the fluxes); the film's loss (its balance)
  const wetWater = () => { let w = 0; const L = zt - zb; for (let j = 0; j < N; j++) w += e[j] * L * ds[j]; return w * rhoL; };
  const skinWater = () => es * (Phi - (zt - zb)) * rhoL;
  // the water's diffusivity in ζ (D φ²) at water content ev, temperature Tv
  // (split: D0 at the temperature, times the solids' part (1 − φ)^6.55 d(φZ)/dφ φ²)
  const Dphi = ev => { const p = Math.min(1 / (1 + Math.max(ev, 0)), phiM); return Math.exp(6.55 * Math.log1p(-p)) * drDphiZ(p, phiM) * p * p; };
  const D0T = Tv => drD0(Tv, o.R) * o.mul;
  const Dz = (ev, Tv) => T.Dconst ? T.Dconst : D0T(Tv) * Dphi(ev);
  // the temperature at ζ (interpolated between the temperature cells' centres; the surfaces beyond)
  const Tat = (z, TT, TsV, TbV) => {
    if (z <= scT[0]) return TbV + (TT[0] - TbV) * z / scT[0];
    if (z >= scT[M - 1]) return TT[M - 1] + (TsV - TT[M - 1]) * (z - scT[M - 1]) / (Phi - scT[M - 1]);
    let lo = 0, hi = M - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (scT[m] <= z) lo = m; else hi = m; }
    return TT[lo] + (TT[hi] - TT[lo]) * (z - scT[lo]) / (scT[hi] - scT[lo]);
  };
  const stretchAt = xv => { for (const Z of Zs) if (xv < Z.x1 - 1e-12) return Z; return Zs[Zs.length - 1]; };

  // evaporation at the fronts for given temperatures and skin thicknesses (kg/(m² s))
  const sideState = (side, Z, Tf, Tsurf, delta) => drSideState(side, Z, Tf, Tsurf, T.noSkinR ? 0 : delta, o);
  const evapTop = (Z, Tf, TsV, delta) => T.Et != null ? T.Et : sideState(drTopSide, Z, Tf, TsV, delta).m;
  const evapBot = (Z, Tf, TbV, delta) => T.Eb != null ? T.Eb : sideState(drBottomSide, Z, Tf, TbV, delta).m;

  // ---- the water step: Newton on e (and the fronts' speeds) with the temperatures held ----
  function waterStep(Z, dtv, TT, TsV, TbV, start) {
    return drWaterStep({ N, s, sc, ds, Phi, phiM, em, es, e0, rhoL, both, T, D0T, Dphi, evapTop, evapBot, stats },
      { e, zt, zb, modeT, modeB, wt: waterStep.wt, wb: waterStep.wb }, Z, dtv, z => Tat(z, TT, TsV, TbV), TsV, TbV, start);
  }

  // ---- the temperature step: the heat equation through the film (fixed ζ cells), sinks where the water leaves ----
  const kL = 0.6;   // liquid water's conductivity (W/(m K); 0.60–0.68 from 20 to 100 °C)
  const kWet = phi => 1 / (phi / o.kS + (1 - phi) / kL);                          // flakes lying flat: in series
  const kSkin = () => 1 / (phiM / o.kS + es * phiM / kL + Math.max(0, 1 - phiM - es * phiM) / 0.03);
  /** Per temperature cell: its thickness, heat capacity and resistance from the water's state (e, zb, zt). */
  function cells(ev, zbv, ztv) {
    const dz = new Float64Array(M), C = new Float64Array(M), R = new Float64Array(M), L = ztv - zbv;
    const add = (c, dzeta, eloc, skin) => {
      if (dzeta <= 0) return;
      if (skin) { const d = dzeta / phiM; dz[c] += d; C[c] += dzeta * (rhoS * o.cS + es * rhoL * DR_P.waterCp); R[c] += d / kSkin(); }
      else { const d = dzeta * (1 + eloc); dz[c] += d; C[c] += dzeta * (rhoS * o.cS + eloc * rhoL * DR_P.waterCp); R[c] += d / kWet(1 / (1 + eloc)); }
    };
    for (let c = 0; c < M; c++) {
      const a = sT[c], b = sT[c + 1];
      add(c, Math.min(b, zbv) - a, 0, true);                       // the bottom skin
      add(c, b - Math.max(a, ztv), 0, true);                       // the top skin
      const lo = Math.max(a, zbv), hi = Math.min(b, ztv);
      if (hi > lo && L > 0) {
        // the wet cells overlapping [lo, hi]
        let j = 0; while (j < N - 1 && zbv + L * s[j + 1] <= lo) j++;
        for (; j < N; j++) { const za = zbv + L * s[j], zb2 = zbv + L * s[j + 1]; if (za >= hi) break; add(c, Math.min(hi, zb2) - Math.max(lo, za), ev[j], false); }
      }
    }
    C[0] += o.web.mass * o.web.cp;
    return { dz, C, R };
  }
  /** The surface's flux into the film as a + b T_cell (linearised about Tsurf0), and the surface temperature after. */
  function robin(qf, Tsurf0, r) {
    const q0 = qf(Tsurf0), d = 1e-3, qd = (qf(Tsurf0 + d) - q0) / d, den = 1 - qd * r;
    return { a: (q0 - qd * Tsurf0) / den, b: qd / den };
  }
  function tempStep(Z, dtv, W, TT, TsV, TbV) {
    if (T.T != null) return { TT: new Float64Array(M).fill(T.T), Ts: T.T, Tb: T.T };
    const { C, R } = cells(W.e, W.zb, W.zt), Lz = W.zt - W.zb;
    const a = new Float64Array(M), b = new Float64Array(M), c = new Float64Array(M), d = new Float64Array(M);
    for (let k = 0; k < M; k++) { b[k] = C[k] / dtv; d[k] = C[k] * Tc[k] / dtv; }
    for (let k = 0; k < M - 1; k++) { const G = 1 / (R[k] / 2 + R[k + 1] / 2); b[k] += G; b[k + 1] += G; c[k] -= G; a[k + 1] -= G; }
    // top: the surface's heat, and its evaporation when it is the film's own (no skin)
    const rT = R[M - 1] / 2, delT = (Phi - W.zt) / phiM, freeT = !dry && (modeT !== 'skin' || !(delT > 0));
    const qTop = Tsv => { if (dry) return drTopSide(Z, Tsv, Z.pa, o).q;
      if (freeT) { const st = sideState(drTopSide, Z, Tsv, Tsv, 0); return st.q - (dry ? 0 : drLatent(Tsv) * (T.Et != null ? T.Et : st.m)); }
      return sideState(drTopSide, Z, Tat(W.zt, TT, TsV, TbV), Tsv, delT).q; };
    const top = robin(qTop, TsV, rT);
    d[M - 1] += top.a; b[M - 1] -= top.b;
    // bottom: the air's heat, and the bottom's own evaporation (both ways, no skin)
    const rB = R[0] / 2, delB = W.zb / phiM, freeB = !dry && (modeB === 'free' || (modeB === 'skin' && !(delB > 0)));
    const qBot = Tbv => { if (modeB === 'none' || dry) return drBottomSide(Z, Tbv, drPsat(Tbv), o).q;
      if (freeB) { const st = sideState(drBottomSide, Z, Tbv, Tbv, 0); return st.q - (dry ? 0 : drLatent(Tbv) * (T.Eb != null ? T.Eb : st.m)); }
      return sideState(drBottomSide, Z, Tat(W.zb, TT, TsV, TbV), Tbv, delB).q; };
    const bot = robin(qBot, TbV, rB);
    d[0] += bot.a; b[0] -= bot.b;
    // fronts inside the film (skins): the heat of evaporation there, linearised in the front's temperature
    const sink = (zf, mf) => {
      let k = 0; while (k < M - 1 && sT[k + 1] < zf) k++;
      let k1, k2;
      if (zf <= scT[k]) { k1 = Math.max(k - 1, 0); k2 = k; } else { k1 = k; k2 = Math.min(k + 1, M - 1); }
      const w2 = k1 === k2 ? 0 : (zf - scT[k1]) / (scT[k2] - scT[k1]), w1 = 1 - w2;
      const Tf0 = w1 * TT[k1] + w2 * TT[k2], m0 = mf(Tf0), dm = (mf(Tf0 + 1e-3) - m0) / 1e-3, Lv = drLatent(Tf0);
      d[k] -= Lv * (m0 - dm * Tf0);
      const add = (col, v) => { if (col === k) b[k] += v; else if (col === k - 1) a[k] += v; else c[k] += v; };
      add(k1, Lv * dm * w1); if (k2 !== k1) add(k2, Lv * dm * w2);
    };
    if (!dry && modeT === 'skin' && delT > 0) sink(W.zt, Tf => evapTop(Z, Tf, TsV, delT));
    if (!dry && modeB === 'skin' && delB > 0) sink(W.zb, Tf => evapBot(Z, Tf, TbV, delB));
    const Tn = drTri(a, b, c, d);
    const Tsn = Tn[M - 1] + (top.a + top.b * Tn[M - 1]) * rT, Tbn = Tn[0] + (bot.a + bot.b * Tn[0]) * rB;
    return { TT: Tn, Ts: Tsn, Tb: Tbn, C };
  }

  // ---- stepping ----
  const series = [], profiles = [], events = { skinTop: null, skinBottom: null, dry: null, boil: null, boilSkin: null, condense: null };
  const profX = (o.profilesAt || []).filter(v => v > xStart && v < xEnd).sort((p, q) => p - q);
  const stops = [...new Set([...Zs.map(z => z.x1), ...profX])].sort((p, q) => p - q);
  const profile = (label) => {
    const L = zt - zb, z = [], phi = [], TT = [];
    let depth = 0;
    const pt = (ph, dzv, zeta) => { z.push(depth); phi.push(ph); TT.push(Tat(zeta, Tc, Ts, Tb)); depth += dzv; };
    if (zb > 0) { pt(phiM, zb / phiM, zb / 2); }
    if (!dry) for (let j = 0; j < N; j++) pt(1 / (1 + e[j]), L * ds[j] * (1 + e[j]), zb + L * sc[j]);
    if (zt < Phi) pt(phiM, (Phi - zt) / phiM, (zt + Phi) / 2);
    z.push(depth); phi.push(phi[phi.length - 1]); TT.push(Ts);
    const zeta = dry ? [] : Array.from(sc, v => zb + L * v), ew = dry ? [] : Array.from(e);
    return { x, label, z, phi, T: TT, h: depth, skinTop: (Phi - zt) / phiM, skinBottom: zb / phiM, zeta, e: ew, zt, zb, Phi };
  };
  const thickness = () => { const L = zt - zb; let h = (Phi - L) / phiM; if (!dry) for (let j = 0; j < N; j++) h += L * ds[j] * (1 + e[j]); return h; };
  let lastE = { t: 0, b: 0 };
  // (o.history: what the film's mechanics needs at every step -- the fronts, the temperatures through the film (the
  // fixed ζ cells), the vapour pressure at each set surface: a skin's outer face, the air's once dry; NaN where the
  // surface is the wet film's own, or sealed (the bottom when the water leaves from the top only))
  const hist = o.history ? { x: [], t: [], zt: [], zb: [], dry: [], Ts: [], Tb: [], pvT: [], pvB: [], Tc: [], zone: [] } : null;
  const record = (Z, Et, Eb) => {
    const Tft = modeT === 'skin' ? Tat(zt, Tc, Ts, Tb) : Ts, Tfb = modeB === 'skin' ? Tat(zb, Tc, Ts, Tb) : Tb;
    series.push({ x, t, Ts, Tb, Tft, Tfb, Et, Eb, wet: dry ? 0 : wetWater(), bound: skinWater(), h: thickness(), skinT: (Phi - zt) / phiM, skinB: zb / phiM, zone: Z.name });
    if (hist) {
      const pvT = dry ? Z.pa : modeT === 'skin' && zt < Phi ? sideState(drTopSide, Z, Tft, Ts, (Phi - zt) / phiM).pv : NaN;
      const pvB = !both ? NaN : dry ? Z.pa : modeB === 'skin' && zb > 0 ? sideState(drBottomSide, Z, Tfb, Tb, zb / phiM).pv : NaN;
      hist.x.push(x); hist.t.push(t); hist.zt.push(zt); hist.zb.push(zb); hist.dry.push(dry ? 1 : 0); hist.Ts.push(Ts); hist.Tb.push(Tb);
      hist.pvT.push(pvT); hist.pvB.push(pvB); hist.Tc.push(Float64Array.from(Tc)); hist.zone.push(Z.name);
    }
  };
  let ovenExit = null;
  const atOven = () => { const w = dry ? 0 : wetWater(), b = skinWater(); ovenExit = { x, free: w, bound: b, water: w + b, waterPct: 100 * (w + b) / (Phi * rhoS), h: thickness(), Ts, Tb, dry }; };
  record(Zs[0], 0, 0);
  // energy (J/m²): the film's enthalpy (from 0 °C), the heat in at the surfaces, the heat of the water that left
  const enthalpy = CC => { let h = 0; for (let k = 0; k < M; k++) h += CC[k] * Tc[k]; return h; };
  const H0 = enthalpy(cells(e, zb, zt).C);
  let Qin = 0, Qlat = 0, Qsens = 0;
  const heatIn = (Z, TsV, TbV, TT) => {
    const top = dry ? drTopSide(Z, TsV, Z.pa, o).q : modeT === 'skin' && zt < Phi ? sideState(drTopSide, Z, Tat(zt, TT, TsV, TbV), TsV, (Phi - zt) / phiM).q : sideState(drTopSide, Z, TsV, TsV, 0).q;
    const bot = dry || modeB === 'none' ? drBottomSide(Z, TbV, drPsat(TbV), o).q : modeB === 'skin' && zb > 0 ? sideState(drBottomSide, Z, Tat(zb, TT, TsV, TbV), TbV, zb / phiM).q : sideState(drBottomSide, Z, TbV, TbV, 0).q;
    return top + bot;
  };
  let nSteps = 0, nFail = 0;
  const stats = { water: 0, newton: 0, picard: 0, rejected: 0 };
  const maxSteps = o.maxSteps || 200000;
  while (x < xEnd - 1e-12 && nSteps < maxSteps) {
    const Z = stretchAt(x);
    // the next stop (a stretch's end or a profile's place) caps the step
    const xNext = stops.find(v => v > x + 1e-12) ?? xEnd;
    let dtv = Math.min(dt, (xNext - x) / o.U, (xOven - xStart) / 150 * (o.dtScale || 1) / o.U);   // (sized by the oven's line: a stretch after it leaves the oven's steps as they were)
    if (!dry) {
      // a skin forms where the surface's water reaches the packing's (the surface value from the last face's flux)
      if (modeT === 'free') {
        const L = zt - zb, h = L * (1 - sc[N - 1]), Et = evapTop(Z, Ts, Ts, 0) / rhoL, D = Dz(e[N - 1], Ts);
        const eSurf = e[N - 1] - Et * h / D;
        if (eSurf <= em && Et > 0) { modeT = 'skin'; if (events.skinTop == null) events.skinTop = x; }
      }
      if (modeB === 'free') {
        const L = zt - zb, h = L * sc[0], Eb = evapBot(Z, Tb, Tb, 0) / rhoL, D = Dz(e[0], Tb);
        const eSurf = e[0] - Eb * h / D;
        if (eSurf <= em && Eb > 0) { modeB = 'skin'; if (events.skinBottom == null) events.skinBottom = x; }
      }
    }
    // Picard between the water (temperatures held) and the heat (the water's state held)
    let W = dry ? { e, zt, zb, wt: 0, wb: 0 } : null, TT = Tc, TsV = Ts, TbV = Tb, conv = false;
    for (let it = 0; it < 40; it++) {
      stats.picard++;
      if (!dry) { W = waterStep(Z, dtv, TT, TsV, TbV, W); if (!W) break; }
      const Tn = tempStep(Z, dtv, W, TT, TsV, TbV);
      let dT = Math.abs(Tn.Ts - TsV) + Math.abs(Tn.Tb - TbV);
      for (let k = 0; k < M; k++) dT = Math.max(dT, Math.abs(Tn.TT[k] - TT[k]));
      TT = Tn.TT; TsV = Tn.Ts; TbV = Tn.Tb;
      if (dT < 1e-4) { conv = true; break; }
    }
    // (a step that fails is retried at a quarter; one that fails 60 times running, or below a nanosecond, stops the run --
    //  the count starts again at every accepted step: a dilute film's sharp compaction front fails now and then)
    if (!conv) { dt = dtv / 4; nFail++; if (nFail > 60 || dt < 1e-9) throw new Error(`drying: the step would not converge at x = ${x.toFixed(4)} m (${Z.name})`); continue; }
    // the step's size: water, fronts and temperatures change a little per step
    let chg = 0;
    if (!dry) {
      // (the film's water by 1 % of it, any cell's solids by a quarter of the way to the packing: the thin cells at a
      // surface follow it quasi-steadily, as the implicit step lets them)
      let l1 = 0, mx = 0;
      for (let j = 0; j < N; j++) { l1 += Math.abs(W.e[j] - e[j]) * ds[j]; mx = Math.max(mx, Math.abs(1 / (1 + W.e[j]) - 1 / (1 + e[j]))); }
      chg = Math.max(l1 / (0.01 * e0), mx / (0.25 * (phiM - o.phi0 + 0.02)));
      const L0 = zt - zb, L1 = W.zt - W.zb;
      chg = Math.max(chg, Math.abs(L1 - L0) / (0.05 * Math.max(L0, 1e-30)));
    }
    let dTm = Math.abs(TsV - Ts) + 0 * TbV;
    for (let k = 0; k < M; k++) dTm = Math.max(dTm, Math.abs(TT[k] - Tc[k]));
    chg = Math.max(chg, dTm / 2) / (o.dtScale || 1);
    if (chg > 2) { stats.rejected++; dt = dtv / Math.min(4, chg); continue; }
    // accept
    nFail = 0;
    // (the evaporation the water step used: the film's water balance holds with it exactly)
    const Et = dry ? 0 : W.Et, Eb = dry ? 0 : W.Eb;
    if (!dry) {
      // the water that left: the fluxes over the step (evT, evB), and the film's own balance apart (lost)
      const before = wetWater() + skinWater();
      e = Float64Array.from(W.e); zt = W.zt; zb = W.zb;
      waterStep.wt = W.wt; waterStep.wb = W.wb;
      // a skin gone again (water condensing on it re-wets it): the wet region back to the surface, its water kept
      if ((modeT === 'skin' && zt >= Phi) || (modeB === 'skin' && zb <= 0)) {
        const w0 = wetWater() + skinWater();
        if (modeT === 'skin' && zt >= Phi) { zt = Phi; modeT = 'free'; waterStep.wt = 0; }
        if (modeB === 'skin' && zb <= 0) { zb = 0; modeB = 'free'; waterStep.wb = 0; }
        const w1 = wetWater(), wantWet = w0 - skinWater();
        if (w1 > 0) for (let j = 0; j < N; j++) e[j] *= wantWet / w1;
      }
      lost += before - (wetWater() + skinWater());
      evT += Et * dtv; evB += Eb * dtv;
      // dry: the wet region is gone (a sliver left counts as water left)
      if ((zt - zb) < 1e-5 * Phi || wetWater() < 1e-7 * W0) { dry = true; events.dry = x + dtv * o.U; }
    }
    Tc = TT; Ts = TsV; Tb = TbV;
    if (T.T == null) {
      const Tft = modeT === 'skin' && zt < Phi ? Tat(zt, Tc, Ts, Tb) : Ts, Tfb = modeB === 'skin' && zb > 0 ? Tat(zb, Tc, Ts, Tb) : Tb;
      Qin += heatIn(Z, Ts, Tb, Tc) * dtv; Qlat += (drLatent(Tft) * Et + drLatent(Tfb) * Eb) * dtv; Qsens += DR_P.waterCp * (Tft * Et + Tfb * Eb) * dtv;
    }
    x += dtv * o.U; t += dtv; nSteps++;
    if (!dry && events.boil == null) {
      const Tft = modeT === 'skin' ? Tat(zt, Tc, Ts, Tb) : Ts, Tfb = modeB === 'skin' ? Tat(zb, Tc, Ts, Tb) : Tb;
      if (Math.max(Tft, Tfb) >= Tboil - 0.05) { events.boil = x; events.boilSkin = (modeT === 'skin' && Tft >= Tboil - 0.05) || (modeB === 'skin' && Tfb >= Tboil - 0.05); }
    }
    if (events.condense == null && (Et < 0 || Eb < 0)) events.condense = x;
    lastE = { t: Et, b: Eb };
    record(Z, Et, Eb);
    if (ovenExit == null && Math.abs(x - xOven) < 1e-9) atOven();
    if (profX.some(v => Math.abs(v - x) < 1e-9)) profiles.push(profile(`${x.toFixed(2)} m`));
    // the next step
    dt = dtv * Math.min(1.6, Math.max(0.3, 1 / Math.max(chg, 1e-3)));
  }
  if (nSteps >= maxSteps) throw new Error('drying: too many steps');
  void lastE;
  const exit = series[series.length - 1];
  profiles.push(profile('exit'));
  const mGO = Phi * rhoS, free = dry ? 0 : wetWater(), bound = skinWater();
  if (ovenExit == null) atOven();
  return {
    series, profiles, events, nSteps, stats,
    exit: { free, bound, water: free + bound, waterPct: 100 * (free + bound) / mGO, h: exit.h, Ts: exit.Ts, Tb: exit.Tb, dry }, aWet,
    energy: T.T == null ? { H0, H: enthalpy(cells(e, zb, zt).C), Qin, Qlat, Qsens } : null,
    W0, evT, evB, lost, mGO, Pe, rates, es, swells, aExit, Xb, Tboil, xStart, xEnd, xOven, ovenExit,
    history: hist ? { ...hist, sT: Array.from(sT), M, N, Phi, phiM, em, es, n: hist.x.length, both } : null,
  };
}

/** A series' quantity key at the places xs (linear between its points). */
function drSample(series, key, xs) {
  return xs.map(xv => {
    if (xv <= series[0].x) return series[0][key];
    let lo = 0, hi = series.length - 1;
    if (xv >= series[hi].x) return series[hi][key];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (series[m].x <= xv) lo = m; else hi = m; }
    const a = series[lo], b = series[hi], f = (xv - a.x) / (b.x - a.x);
    return a[key] + (b[key] - a[key]) * f;
  });
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  drSample,
  drPsat, drTsat, drLatent, drMuWater, drAir, drUse, DR_PROPS, drMoistRho, drNat, drJets, drGAB, drGabC, drDphiZ, drD0, drDcoll, drFaces, drB, drSG, drTri,
  drEvap, drStretches, drTopSide, drBottomSide, drSideState, drConstantRate, drWaterStep, drStrip,
};
