/*
 * mixer.js — the double planetary mixer with its high-speed disperser, the batch in time (MP-MIX's 1D, MIX-1): the
 * batch taken as well mixed and followed through the program's steps -- the power and torque at the drives, the heat in
 * the batch, the pH, the lumps of filter cake broken and dispersed (the grind gauge's reading), the flakes' size and the
 * viscosity they give. Every number is an input with an approximate default (MIX_INPUTS); the 2D and 3D (MIX-2, MIX-3)
 * and the measured logs (MIX-4) give a mixer's own constants.
 *
 * The mixer. A vessel of inside diameter D, the batch (volume V) filling it to H = V / (π D²/4), in a water jacket
 * (Tj, UA). Two planetary blades, frames of nBar vertical bars (width w, thickness t), their axes on the arm at radius ro,
 * the arm turning at No (the program's speed), each blade spinning on its axis at ratio × No relative to the arm, with
 * or against the arm (dir ±1): its absolute rate Ωb = 2π No (1 + dir ratio); the bars sweep within δw of the wall
 * (rs = D/2 − δw − ro) and the frame's bottom bar within δb of the floor. A saw-tooth disc (diameter Dd, teeth hT high)
 * at Nd on the arm.
 *
 * Power (all of it heats the batch).
 *  Blades: each bar a body of the ellipse's equivalent radius a = (w + t)/4 moving through its share of the vessel's
 *  section, a cell of radius b = D / (2 √nBars) (nBars: both blades' bars): per length the exact Stokes drag on a
 *  cylinder moving at the centre of a fixed cylinder, 4π μ V / (ln k − (k² − 1)/(k² + 1)), k = b/a (checked in
 *  mixer.validate.js against the biharmonic solution), plus the form drag ρ V² C_D a; V² the bar's mean square speed,
 *  (2π No ro)² + (Ωb rs)², over its height in the batch H − δb; μ at the cell's shear rate V/(b − a); times fB.
 *  Disperser: Np = Kp/Re + Np∞, Re = ρ Nd Dd²/μ, μ at ks Nd (Metzner–Otto); Kp = 16π²/3, the thin disc's exact Stokes
 *  torque (32/3) μ Ω R³. P = Np ρ Nd³ Dd⁵. The torques at the drives: the blades' through the arm, P_B / (2π No), the
 *  disperser's P_D / (2π Nd).
 *
 * Shear zones (where lumps and flakes are broken; each a shear rate and how often the batch passes through it):
 *  the disperser's rim, γ̇ = π Nd Dd / hT, visited Fl Nd Dd³ / V times a second (Fl its flow number);
 *  the bars at the wall, γ̇ = |2π No ro + Ωb rs| / δw, visited nBars No π D δw (H − δb) / V (each bar sweeps the whole wall
 *  once per turn of the arm); the bottom bars over the floor, γ̇ = √((2π No ro)² + Ωb² rs²/3) / δb, visited
 *  nBlade |Ωb| rs² δb / V. A zone's stress τ = μ(γ̇) γ̇. The batch's mean shear rate (collisions) from the power:
 *  τ(γ̇) γ̇ = P / V.
 *
 * Heat. m c dT/dt = P − UA (T − Tj) − ṁ L(T); c of the GO and the water by mass. Under the step's pressure p the batch
 * boils at T_sat(p) (IAPWS-IF97, drying.js): held there, the heat beyond it evaporates water. Ammonia water added at a
 * step's start mixes in at its own temperature, and the ammonium it forms releases ΔH_N per mole.
 *
 * pH. The charge balance in the batch's water: [H⁺] + [NH₄⁺] = [OH⁻] + [COO⁻] + [O⁻] + [strong acid], the GO's carboxyl
 * (q1, pK1) and phenolic (q2, pK2) groups and the strong acid left in the cake (qSA) per mass of GO, the ammonia NH₃/NH₄⁺
 * (pKN), water (pKw); solved for [H⁺] (monotone, bisection). Dosed to a target pH the ammonia follows in closed form
 * (the balance is linear in it, its water included). The GO's surface charge: its dissociated groups over both faces of
 * its sheets, 2 / (ρs t); its potential by Grahame's equation, the zeta potential at the slip plane xs (Gouy–Chapman),
 * the ionic strength the salt's (the background's, the strong acid's, the free H⁺ and OH⁻; the GO's own counter-ions
 * left out, as colloids' stability is reckoned). Two flakes' energy (Derjaguin, spheres of
 * the flakes' radius): van der Waals −A a / (12 h), the double layers 64π a n kT γ² e^(−κh) / κ²; the stability ratio
 * W = e^(Vmax/kT) / (2 κ a) (Reerink–Overbeek).
 *
 * Lumps and flakes. The filter cake's pieces (a log-normal size, median a0, spread sg; the cake's solids φL) and the
 * dispersed flakes on one grid of solids volume, v_k = v_0 2^k (v_0 a flake, its mean size squared times its thickness;
 * a lump's size a = (6 v / (π φL))^(1/3), no smaller than a flake). A share of the cake (fh) is harder (kh times
 * stronger). Per visit to a zone of stress τ a lump of strength σ(a) = σ1 (a / 1 mm)^(−β) (× kh) breaks in two with the
 * chance 1 − exp(−(τ/σ)^m) (Rumpf, Kendall: smaller lumps are stronger) and loses ℓe τ/σ off its radius (erosion: its
 * flakes go to the dispersed ones). Dispersed flakes meet in the batch's shear (orthokinetic, Smoluchowski:
 * (4/3) γ̇ (ai + aj)³ / W) and form soft clusters. The grid's fixed pivots (Kumar–Ramkrishna) keep the number and the
 * mass in every event. Lumps above the flakes' largest size count as lumps; the grind gauge reads the size above which
 * Ns of them are in its track's sample (Vg). The dispersed flakes' size (a grid in √2 steps): a flake of size d breaks
 * in two where τ > 2 t σf / d (its tension, built up over half its length, against its strength).
 *
 * Viscosity. The Materials flow law μ0(γ̇) is the mixed slurry's (no lumps, its solids, its flakes, at T_law). The
 * batch: the lumps a paste at the cake's solids (× cCake), the rest the dispersed flakes in the remaining water,
 * μ = exp(X ln μ_lumps + (1 − X) ln μ_rest) (X the lumps' share of the volume), each μ0 (φ/φ0)^mφ (no less than
 * water's); × (d50 / d50₀)^md for the flakes' size; × μ_w(T) / μ_w(T_law) for the temperature.
 *
 * SI inside (m, s, kg, Pa, mol); temperatures in °C; mol/L for the chemistry. Pure computation, no DOM.
 */
const MIX_F = 96485.33212, MIX_NA = 6.02214076e23, MIX_KB = 1.380649e-23, MIX_E = 1.602176634e-19, MIX_EPS0 = 8.8541878128e-12, MIX_MNH3 = 0.017031;

/**
 * The inputs, as the page edits them: { k, g (its group), l (label), u (unit shown), f (to SI), v (default, in u), min,
 * max, step, d (decimals), h (what it is) }; select inputs carry o: [[value, label], ...].
 */
const MIX_INPUTS = [
  { g: 'vessel', k: 'D', l: 'Inside diameter', u: 'mm', f: 1e-3, v: 300, min: 50, max: 3000, step: 1, d: 0 },
  { g: 'vessel', k: 'Hv', l: 'Height', u: 'mm', f: 1e-3, v: 300, min: 50, max: 3000, step: 1, d: 0 },
  { g: 'vessel', k: 'V', l: 'Batch volume', u: 'L', f: 1e-3, v: 10, min: 0.1, max: 5000, step: 0.1, d: 1 },
  { g: 'vessel', k: 'T0', l: 'Batch at the start', u: '°C', f: 1, v: 20, min: 0, max: 90, step: 0.5, d: 1 },
  { g: 'vessel', k: 'Tj', l: 'Jacket water', u: '°C', f: 1, v: 20, min: 0, max: 95, step: 0.5, d: 1 },
  { g: 'vessel', k: 'UA', l: 'Jacket UA', u: 'W/K', f: 1, v: 15, min: 0, max: 10000, step: 0.5, d: 1, h: 'the jacket\'s heat transfer coefficient times the wetted area' },
  { g: 'blades', k: 'ratio', l: 'Blade spin per arm turn', u: '', f: 1, v: 2.5, min: 0, max: 10, step: 0.05, d: 2, h: 'each blade\'s turns on its own axis, relative to the arm, per turn of the arm (75 rpm at 30 rpm: 2.5)' },
  { g: 'blades', k: 'dir', l: 'Blade spin', u: '', f: 1, v: 1, o: [[1, 'with the arm'], [-1, 'against the arm']] },
  { g: 'blades', k: 'nBlade', l: 'Blades', u: '', f: 1, v: 2, min: 1, max: 3, step: 1, d: 0 },
  { g: 'blades', k: 'nBar', l: 'Vertical bars per blade', u: '', f: 1, v: 2, min: 1, max: 4, step: 1, d: 0 },
  { g: 'blades', k: 'w', l: 'Bar width', u: 'mm', f: 1e-3, v: 40, min: 1, max: 500, step: 1, d: 0 },
  { g: 'blades', k: 't', l: 'Bar thickness', u: 'mm', f: 1e-3, v: 12, min: 1, max: 200, step: 1, d: 0 },
  { g: 'blades', k: 'ro', l: 'Blade axis from the vessel\'s axis', u: 'mm', f: 1e-3, v: 73.5, min: 5, max: 1500, step: 0.5, d: 1 },
  { g: 'blades', k: 'dw', l: 'Gap to the wall', u: 'mm', f: 1e-3, v: 3, min: 0.5, max: 50, step: 0.1, d: 1 },
  { g: 'blades', k: 'db', l: 'Gap to the floor', u: 'mm', f: 1e-3, v: 3, min: 0.5, max: 50, step: 0.1, d: 1 },
  { g: 'disp', k: 'Dd', l: 'Disc diameter', u: 'mm', f: 1e-3, v: 80, min: 10, max: 1000, step: 1, d: 0 },
  { g: 'disp', k: 'hT', l: 'Tooth height', u: 'mm', f: 1e-3, v: 8, min: 0.5, max: 100, step: 0.5, d: 1, h: 'the disc\'s rim zone is sheared at its tip speed over this height' },
  { g: 'disp', k: 'nT', l: 'Teeth', u: '', f: 1, v: 16, min: 0, max: 64, step: 1, d: 0 },
  { g: 'disp', k: 'rD', l: 'Disc axis from the vessel\'s axis', u: 'mm', f: 1e-3, v: 100, min: 0, max: 1500, step: 0.5, d: 1 },
  { g: 'disp', k: 'hD', l: 'Disc above the floor', u: 'mm', f: 1e-3, v: 40, min: 5, max: 2000, step: 1, d: 0 },
  { g: 'power', k: 'fB', l: 'Blades\' power factor', u: '×', f: 1, v: 1, min: 0.01, max: 100, step: 0.01, d: 2, h: 'on the bars\' drag as computed; the 2D/3D or your torque log set it' },
  { g: 'power', k: 'CD', l: 'Bars\' form drag C_D', u: '', f: 1, v: 2, min: 0, max: 10, step: 0.1, d: 1, h: 'a flat bar broadside: about 2' },
  { g: 'power', k: 'Kp', l: 'Disc\'s laminar constant Kp', u: '', f: 1, v: 16 * Math.PI ** 2 / 3, min: 1, max: 5000, step: 0.01, d: 2, h: 'Np Re at low Re; 16π²/3 = 52.64: a thin disc\'s exact Stokes torque' },
  { g: 'power', k: 'Npt', l: 'Disc\'s turbulent power number', u: '', f: 1, v: 0.3, min: 0, max: 10, step: 0.01, d: 2 },
  { g: 'power', k: 'ks', l: 'Disc\'s Metzner–Otto ks', u: '', f: 1, v: 11, min: 1, max: 100, step: 0.5, d: 1, h: 'its mean shear rate is ks × its speed (1/s)' },
  { g: 'power', k: 'Fl', l: 'Disc\'s flow number', u: '', f: 1, v: 0.1, min: 0.001, max: 2, step: 0.005, d: 3, h: 'the flow through its rim zone over Nd Dd³' },
  { g: 'chem', k: 'q1', l: 'Carboxyl groups', u: 'mmol/g', f: 1, v: 1, min: 0, max: 10, step: 0.05, d: 2, h: 'acid groups on the GO, per gram of GO' },
  { g: 'chem', k: 'pK1', l: 'Carboxyl pKa', u: '', f: 1, v: 4.3, min: 1, max: 8, step: 0.05, d: 2 },
  { g: 'chem', k: 'q2', l: 'Phenolic groups', u: 'mmol/g', f: 1, v: 2, min: 0, max: 10, step: 0.05, d: 2 },
  { g: 'chem', k: 'pK2', l: 'Phenolic pKa', u: '', f: 1, v: 9.8, min: 6, max: 13, step: 0.05, d: 2 },
  { g: 'chem', k: 'qSA', l: 'Strong acid left in the cake', u: 'mmol/g', f: 1, v: 0, min: 0, max: 5, step: 0.01, d: 2, h: 'sulfuric or hydrochloric acid the washing left, as H⁺ per gram of GO' },
  { g: 'chem', k: 'Ibg', l: 'Background salt', u: 'mM', f: 1e-3, v: 1, min: 0, max: 1000, step: 0.1, d: 1, h: 'ionic strength from other salts' },
  { g: 'chem', k: 'pKN', l: 'Ammonium pKa', u: '', f: 1, v: 9.25, min: 8, max: 11, step: 0.01, d: 2 },
  { g: 'chem', k: 'pKw', l: 'Water pKw', u: '', f: 1, v: 14, min: 13, max: 15, step: 0.01, d: 2 },
  { g: 'chem', k: 'wN', l: 'Ammonia water', u: 'wt%', f: 1e-2, v: 25, min: 1, max: 35, step: 0.5, d: 1 },
  { g: 'chem', k: 'rhoN', l: 'Ammonia water density', u: 'g/mL', f: 1000, v: 0.907, min: 0.85, max: 1, step: 0.001, d: 3 },
  { g: 'chem', k: 'Tadd', l: 'Ammonia water temperature', u: '°C', f: 1, v: 20, min: 0, max: 50, step: 0.5, d: 1 },
  { g: 'chem', k: 'dHN', l: 'Heat per mole of ammonium formed', u: 'kJ/mol', f: 1000, v: 52, min: 0, max: 100, step: 0.5, d: 1, h: 'NH₃ + H⁺ → NH₄⁺ releases about 52 kJ/mol' },
  { g: 'chem', k: 'AH', l: 'Hamaker constant (GO in water)', u: '×10⁻²⁰ J', f: 1e-20, v: 5, min: 0.1, max: 50, step: 0.1, d: 1 },
  { g: 'chem', k: 'xs', l: 'Slip plane', u: 'nm', f: 1e-9, v: 0.3, min: 0, max: 5, step: 0.05, d: 2, h: 'distance from the sheet where the zeta potential is' },
  { g: 'lumps', k: 'fCake', l: 'GO in cake pieces at the start', u: '%', f: 1e-2, v: 100, min: 0, max: 100, step: 1, d: 0 },
  { g: 'lumps', k: 'a0', l: 'Cake pieces, median size', u: 'mm', f: 1e-3, v: 10, min: 0.01, max: 100, step: 0.1, d: 1 },
  { g: 'lumps', k: 'sg', l: 'Cake pieces, spread', u: '×', f: 1, v: 1.5, min: 1.01, max: 5, step: 0.05, d: 2, h: 'geometric standard deviation of their size' },
  { g: 'lumps', k: 'phiL', l: 'Solids in the cake', u: 'vol%', f: 1e-2, v: 45, min: 1, max: 74, step: 0.5, d: 1, h: 'at least the slurry\'s: the cake\'s water is part of the batch\'s' },
  { g: 'lumps', k: 'sig', l: 'Cake strength at 1 mm', u: 'kPa', f: 1e3, v: 0.3, min: 0.001, max: 1000, step: 0.01, d: 3 },
  { g: 'lumps', k: 'beta', l: 'Strength against size, β', u: '', f: 1, v: 0.5, min: 0, max: 2, step: 0.05, d: 2, h: 'σ ∝ size^−β; 0.5: Kendall' },
  { g: 'lumps', k: 'mR', l: 'Breaking threshold sharpness', u: '', f: 1, v: 8, min: 1, max: 30, step: 1, d: 0, h: 'chance per visit 1 − exp(−(τ/σ)^m)' },
  { g: 'lumps', k: 'fh', l: 'Hard lumps', u: '% of the cake', f: 1e-2, v: 0.5, min: 0, max: 100, step: 0.1, d: 1 },
  { g: 'lumps', k: 'kh', l: 'Hard lumps\' strength', u: '×', f: 1, v: 5, min: 1, max: 1000, step: 0.5, d: 1 },
  { g: 'lumps', k: 'le', l: 'Erosion per visit', u: 'µm', f: 1e-6, v: 0.02, min: 0, max: 100, step: 0.005, d: 3, h: 'radius lost per visit to a zone at the lump\'s strength (τ/σ = 1)' },
  { g: 'lumps', k: 'Ns', l: 'Grind gauge: specks for a reading', u: '', f: 1, v: 5, min: 1, max: 100, step: 1, d: 0 },
  { g: 'lumps', k: 'Vg', l: 'Grind gauge: sample in its track', u: 'µL', f: 1e-9, v: 40, min: 1, max: 1000, step: 1, d: 0 },
  { g: 'lumps', k: 'gR', l: 'Grind gauge: its range', u: 'µm', f: 1e-6, v: 100, min: 10, max: 1000, step: 5, d: 0, h: 'readings above it are off the gauge' },
  { g: 'flakes', k: 'sf', l: 'Flake strength', u: 'GPa', f: 1e9, v: 10, min: 0.01, max: 100, step: 0.1, d: 2, h: 'a GO sheet\'s tensile strength, its defects included' },
  { g: 'visc', k: 'Tlaw', l: 'The flow law\'s temperature', u: '°C', f: 1, v: 20, min: 0, max: 90, step: 0.5, d: 1, h: 'where the Materials law was measured' },
  { g: 'visc', k: 'mphi', l: 'Viscosity against solids, exponent', u: '', f: 1, v: 2.5, min: 0, max: 10, step: 0.1, d: 1, h: 'μ ∝ (solids)^m' },
  { g: 'visc', k: 'md', l: 'Viscosity against flake size, exponent', u: '', f: 1, v: 1, min: 0, max: 5, step: 0.1, d: 1, h: 'μ ∝ (flake size)^m' },
  { g: 'visc', k: 'cCake', l: 'Cake\'s viscosity against the slurry\'s', u: '×', f: 1, v: 1, min: 0.01, max: 100, step: 0.01, d: 2, h: 'undispersed GO against dispersed, at the same solids' },
  { g: 'num', k: 'dtMax', l: 'Longest time step', u: 's', f: 1, v: 1, min: 0.01, max: 30, step: 0.01, d: 2 },
];
/** The program's default steps: { name, min (duration), No (arm, rpm), Nd (disperser, rpm; 0 off), p (kPa abs), dose:
 *  null | { pH } | { mL } (ammonia water at the step's start) }. */
const MIX_STEPS = [
  { name: 'Blades only', min: 5, No: 30, Nd: 0, p: 101.325, dose: { pH: 7 } },
  { name: 'Blades and disperser', min: 30, No: 30, Nd: 1500, p: 10, dose: null },
];
/** The inputs' defaults in SI (the program as MIX_STEPS). */
function mixDefaults() { return mixInSI(mixInDefaults()); }
/** The inputs as the page keeps them (each in the unit it shows, OVEN.mix): the defaults and the program. */
function mixInDefaults() {
  const o = {}; for (const q of MIX_INPUTS) o[q.k] = q.v;
  o.steps = MIX_STEPS.map(s => ({ ...s, dose: s.dose ? { ...s.dose } : null }));
  return o;
}
/** The page's inputs (its units) in SI, for mixRun (an input missing: its default). */
function mixInSI(d) {
  const o = {}; for (const q of MIX_INPUTS) o[q.k] = (Number.isFinite(d[q.k]) ? d[q.k] : q.v) * q.f;
  o.steps = (d.steps || MIX_STEPS).map(s => ({ ...s, dose: s.dose ? { ...s.dose } : null }));
  return o;
}

// ---- water (drying.js's laws, as the material hub sets them) ----
// (the page: drying.js's names in the scripts' shared scope -- some are constants, not the window's; Node: required)
const mixDR = () => (typeof drTsat === 'function' && typeof drLatent === 'function' ? { drPsat, drTsat, drLatent, drMuWater } : require('./drying.js'));
const mixPsat = Tc => mixDR().drPsat(Tc), mixTsat = p => mixDR().drTsat(p);
const mixLatent = Tc => mixDR().drLatent(Tc), mixMuW = Tc => mixDR().drMuWater(Tc);
const MIX_CW = 4180;

/** Drag per length and speed over μ of a cylinder (radius a) moving at the centre of a fixed cylinder (radius b), 2D
 *  Stokes: 4π / (ln k − (k² − 1)/(k² + 1)). */
function mixCellDrag(a, b) { const k = b / a; return 4 * Math.PI / (Math.log(k) - (k * k - 1) / (k * k + 1)); }

/** The mixer's geometry (see the header). */
function mixGeom(o) {
  const R = o.D / 2, A = Math.PI * R * R, H = o.V / A, rs = R - o.dw - o.ro, nBars = o.nBlade * o.nBar;
  const a = (o.w + o.t) / 4, b = o.D / (2 * Math.sqrt(nBars)), Hb = Math.max(0, H - o.db);
  const err = !(rs > 0) ? 'the blades\' axes are too far out: the bars do not fit between the axis and the wall'
    : !(H <= o.Hv) ? 'the batch does not fit in the vessel' : !(b > a * 1.05) ? 'the bars are too wide for the vessel'
      : !(o.rD + o.Dd / 2 < R) ? 'the disc does not fit in the vessel' : null;
  // (the disc sits on the arm halfway between two blades: its rim's clearance to their sweep, to the wall)
  const da = Math.PI / o.nBlade, cB = Math.sqrt(o.ro * o.ro + o.rD * o.rD - 2 * o.ro * o.rD * Math.cos(da)) - rs - o.Dd / 2, cW = R - o.rD - o.Dd / 2;
  const warn = !err && cB < 0 ? `the disc reaches ${(-cB * 1000).toFixed(1)} mm into the blades' sweep: they would hit it unless they clear it in height` : null;
  return { R, A, H, rs, nBars, a, b, Hb, Awet: Math.PI * o.D * H + A, cB, cW, err, warn };
}

/** The power at a moment: { PB, PD (W), TqB, TqD (N m at the arm and the disperser's shaft), ReB, ReD, NpD, zones:
 *  [{ k, gd, tau, f }], gdBulk }. mu: γ̇ -> Pa s (the batch now); rho (kg/m³); No, Nd (1/s). */
function mixPower(o, G, mu, rho, No, Nd, V) {
  const Wo = 2 * Math.PI * No, Wb = Wo * (1 + o.dir * o.ratio);
  // the blades: every bar's drag in its cell
  const V2 = (Wo * o.ro) ** 2 + (Wb * G.rs) ** 2, Vb = Math.sqrt(V2), gdB = Vb / (G.b - G.a), muB = No > 0 ? mu(gdB) : 0;
  const PB = No > 0 ? o.fB * G.nBars * G.Hb * (mixCellDrag(G.a, G.b) * muB * V2 + rho * o.CD * G.a * V2 * Vb) : 0;
  // the disperser
  const gdD = o.ks * Nd, muD = Nd > 0 ? mu(gdD) : 0, ReD = Nd > 0 ? rho * Nd * o.Dd * o.Dd / muD : 0, NpD = Nd > 0 ? o.Kp / ReD + o.Npt : 0;
  const PD = Nd > 0 ? NpD * rho * Nd ** 3 * o.Dd ** 5 : 0;
  const zones = [];
  if (Nd > 0) { const gd = Math.PI * Nd * o.Dd / o.hT; zones.push({ k: 'disc', gd, tau: mu(gd) * gd, f: o.Fl * Nd * o.Dd ** 3 / V }); }
  if (No > 0) {
    const gw = Math.abs(Wo * o.ro + Wb * G.rs) / o.dw, gf = Math.sqrt((Wo * o.ro) ** 2 + Wb * Wb * G.rs * G.rs / 3) / o.db;
    zones.push({ k: 'wall', gd: gw, tau: mu(gw) * gw, f: G.nBars * No * Math.PI * o.D * o.dw * G.Hb / V });
    zones.push({ k: 'floor', gd: gf, tau: mu(gf) * gf, f: o.nBlade * Math.abs(Wb) * G.rs * G.rs * o.db / V });
  }
  // the batch's mean shear rate: τ(γ̇) γ̇ = P / V (monotone in γ̇: bisection in its logarithm)
  const eps = (PB + PD) / V; let gdBulk = 0;
  if (eps > 0) { let lo = -12, hi = 8; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2, g = Math.exp(m); if (mu(g) * g * g > eps) hi = m; else lo = m; } gdBulk = Math.exp((lo + hi) / 2); }
  return { PB, PD, TqB: No > 0 ? PB / Wo : 0, TqD: Nd > 0 ? PD / (2 * Math.PI * Nd) : 0, ReB: muB > 0 ? rho * Vb * 2 * G.a / muB : 0, ReD, NpD, Vb, zones, gdBulk };
}

// ---- chemistry ----
/** The batch's water chemistry: Q (mol in the batch: carboxyl Q1, phenolic Q2, strong acid QSA, ammonia NT), VW (L of
 *  water). Returns { pH, h (mol/L), th1, th2 (the groups' dissociated shares), NH4 (mol), I (mol/L) }. */
function mixSpecies(o, Q, VW) {
  const K1 = 10 ** -o.pK1, K2 = 10 ** -o.pK2, KN = 10 ** -o.pKN, Kw = 10 ** -o.pKw;
  // (in moles: H⁺ + NH₄⁺ = OH⁻ + COO⁻ + O⁻ + the strong acid's anion; rising in [H⁺])
  const f = lh => { const h = 10 ** lh; return h * VW + Q.NT * h / (h + KN) - Kw / h * VW - Q.Q1 * K1 / (K1 + h) - Q.Q2 * K2 / (K2 + h) - Q.QSA; };
  let lo = -16, hi = 2; for (let i = 0; i < 200 && hi - lo > 1e-14; i++) { const m = (lo + hi) / 2; if (f(m) > 0) hi = m; else lo = m; }
  const lh = (lo + hi) / 2, h = 10 ** lh;
  // (the ionic strength that screens the sheets: the salt in the water -- the background's, the strong acid's, the free
  //  H⁺ and OH⁻ -- the GO's own counter-ions left out, as the colloids' stability is reckoned)
  return { pH: -lh, h, th1: K1 / (K1 + h), th2: K2 / (K2 + h), NH4: Q.NT * h / (h + KN), I: o.Ibg + Q.QSA / VW + (h + Kw / h) / 2 };
}
/** The ammonia (mol, total) that brings the batch to pH: the balance linear in it, the water it brings in (c L per mol)
 *  included; never less than what is there (NT0). */
function mixDoseFor(o, Q, VW0, pH, c) {
  const K1 = 10 ** -o.pK1, K2 = 10 ** -o.pK2, KN = 10 ** -o.pKN, Kw = 10 ** -o.pKw, h = 10 ** -pH, s = h / (h + KN), wv = Kw / h - h;
  // (NT s = wv VW + rest, VW = VW0 + c (NT − NT0))
  const rest = Q.Q1 * K1 / (K1 + h) + Q.Q2 * K2 / (K2 + h) + Q.QSA;
  const NT = (wv * (VW0 - c * Q.NT) + rest) / (s - wv * c);
  return Math.max(Q.NT, NT);
}
/** The GO's surface: charge (C/m²), potential (V), zeta (V), Debye length (m), the stability ratio W of two flakes of
 *  radius a at T (°C). sp: mixSpecies's. */
function mixSurface(o, sp, Tc, a) {
  const T = Tc + 273.15, kT = MIX_KB * T, epsr = 87.74 - 0.40008 * Tc + 9.398e-4 * Tc * Tc - 1.41e-6 * Tc ** 3, eps = epsr * MIX_EPS0;
  const n = sp.I * 1000 * MIX_NA, kap = Math.sqrt(2 * n * MIX_E * MIX_E / (eps * kT));
  const Aspec = 2 / (o.rhoS * o.tF), sigma = -MIX_F * (sp.th1 * o.q1 + sp.th2 * o.q2) / Aspec;   // (the groups' charge is negative)
  const psi0 = 2 * kT / MIX_E * Math.asinh(sigma / Math.sqrt(8 * eps * n * kT));
  const g0 = Math.tanh(MIX_E * psi0 / (4 * kT)), gs = g0 * Math.exp(-kap * o.xs), zeta = 4 * kT / MIX_E * Math.atanh(gs);
  // (two flakes' energy, the barrier's top over h from 0.2 nm)
  const Vh = hh => -o.AH * a / (12 * hh) + 64 * Math.PI * a * n * kT * g0 * g0 * Math.exp(-kap * hh) / (kap * kap);
  let Vmax = -Infinity; for (let i = 0; i <= 400; i++) { const hh = 2e-10 * Math.pow(500, i / 400); Vmax = Math.max(Vmax, Vh(hh)); }
  const x = Vmax / kT, W = x > 700 ? Infinity : Math.max(1, Math.exp(x) / (2 * kap * a));
  return { sigma, psi0, zeta, debye: 1 / kap, Vmax: x, W };
}

// ---- the population balance ----
/**
 * A population on a grid of class volumes v (rising). opts: { S (k -> breakage rate, 1/s), daughters ('halves' |
 * 'uniform'), R (k -> rate a particle moves down to k − 1 by erosion, its lost volume to class 0), beta (i, j -> the
 * aggregation kernel over the volume, 1/s per particle pair) }. Returns rhs(N, out) and the most a particle can leave
 * a class per second, at N.
 */
function mixPBE(v, opts) {
  const K = v.length;
  // (fixed pivots: a volume x between v[k] and v[k+1] puts (v[k+1] − x)/(v[k+1] − v[k]) of a particle at k, the rest at
  //  k + 1 -- the number and the volume kept; above the grid all of it at the top, its number from its volume)
  const place = x => {
    if (x >= v[K - 1]) return [[K - 1, x / v[K - 1]]];
    if (x <= v[0]) return [[0, x / v[0]]];
    let k = 0; while (v[k + 1] <= x) k++;
    const e = (v[k + 1] - x) / (v[k + 1] - v[k]); return [[k, e], [k + 1, 1 - e]];
  };
  const agg = []; for (let i = 0; i < K; i++) for (let j = i; j < K; j++) agg.push([i, j, place(v[i] + v[j])]);
  // breakage: daughters per break of class k into class i
  const B = Array.from({ length: K }, () => new Float64Array(K));
  for (let k = 1; k < K; k++) {
    if (opts.daughters === 'uniform') {
      // (b(x | v_k) = 2 / v_k on (0, v_k): each class's share by the pivots' hat functions, in closed form)
      const hat = (i, lo, hi) => { // ∫_lo^hi of the hat at i times 2/v_k
        let s = 0; const vi = v[i], vl = i > 0 ? v[i - 1] : 0, vr = i < K - 1 ? v[i + 1] : Infinity;
        const seg = (a, b, f) => { const A = Math.max(a, lo), Bq = Math.min(b, hi); if (Bq > A) s += f(A, Bq); };
        seg(vl, vi, (A, Bq) => (i > 0 ? ((Bq * Bq - A * A) / 2 - vl * (Bq - A)) / (vi - vl) : ((Bq * Bq - A * A) / 2) / vi));
        seg(vi, vr, (A, Bq) => ((vr * (Bq - A)) - (Bq * Bq - A * A) / 2) / (vr - vi));
        return s * 2 / v[k];
      };
      for (let i = 0; i <= k; i++) B[k][i] = hat(i, 0, v[k]);
    } else for (const [i, e] of place(v[k] / 2)) B[k][i] += 2 * e;
  }
  return {
    rhs(N, out, rates) {
      out.fill(0); let lmax = 0;
      const S = rates.S, R = rates.R, beta = rates.beta;
      for (let k = 0; k < K; k++) {
        const nk = N[k]; let loss = 0;
        if (S && S[k] > 0) { loss += S[k]; const r = S[k] * nk; out[k] -= r; const b = B[k]; for (let i = 0; i < k; i++) if (b[i]) out[i] += b[i] * r; if (b[k]) out[k] += b[k] * r; }
        if (R && R[k] > 0 && k > 0) { loss += R[k]; const r = R[k] * nk; out[k] -= r; out[k - 1] += r; out[0] += r * (v[k] - v[k - 1]) / v[0]; }
        lmax = Math.max(lmax, loss);
      }
      if (beta) for (const [i, j, to] of agg) {
        const bij = beta(i, j); if (!(bij > 0)) continue;
        const r = (i === j ? 0.5 : 1) * bij * N[i] * N[j]; if (!(r > 0)) continue;
        out[i] -= r; out[j] -= r; for (const [k, e] of to) out[k] += e * r;
        lmax = Math.max(lmax, bij * N[j], bij * N[i]);
      }
      return lmax;
    },
    /** The rates' Jacobian at N (dense, row-major K × K): d(rhs_i)/dN_j. */
    jac(N, rates) {
      const Jm = new Float64Array(K * K), S = rates.S, R = rates.R, beta = rates.beta;
      for (let k = 0; k < K; k++) {
        if (S && S[k] > 0) { Jm[k * K + k] -= S[k]; for (let i = 0; i <= k; i++) if (B[k][i]) Jm[i * K + k] += B[k][i] * S[k]; }
        if (R && R[k] > 0 && k > 0) { Jm[k * K + k] -= R[k]; Jm[(k - 1) * K + k] += R[k]; Jm[k] += R[k] * (v[k] - v[k - 1]) / v[0]; }
      }
      if (beta) for (const [i, j, to] of agg) {
        const bij = beta(i, j); if (!(bij > 0)) continue;
        // (r = c β Ni Nj: its derivative in Ni and in Nj, each spread by the event's stoichiometry)
        const dI = i === j ? bij * N[i] : bij * N[j], dJ = i === j ? 0 : bij * N[i];
        for (const [m, d] of [[i, dI], [j, dJ]]) { if (!d) continue; Jm[i * K + m] -= d; Jm[j * K + m] -= d; for (const [k, e] of to) Jm[k * K + m] += e * d; }
      }
      return Jm;
    },
    /** One backward-Euler step, N ← N + dt (rhs(N_new) + src), by Newton: for rates far faster than the step (stiff). */
    implicit(N, dt, rates, src) {
      const N0 = Float64Array.from(N), out = new Float64Array(K), F = new Float64Array(K);
      let mass = 0; for (let k = 0; k < K; k++) mass += N0[k] * v[k];
      for (let it = 0; it < 50; it++) {
        this.rhs(N, out, rates);
        for (let k = 0; k < K; k++) F[k] = -(N[k] - N0[k] - dt * (out[k] + (src ? src[k] : 0)));
        const A = this.jac(N, rates); for (let q = 0; q < K * K; q++) A[q] *= -dt; for (let k = 0; k < K; k++) A[k * K + k] += 1;
        const d = mixSolve(A, F, K);
        // (damped so no class that holds any of the mass goes below zero by more than half its value; the nearly empty ones
        //  may overshoot -- they are cut at zero after)
        let lam = 1; for (let k = 0; k < K; k++) if (d[k] < 0 && N[k] + d[k] < 0 && N[k] * v[k] > 1e-12 * mass) lam = Math.min(lam, 0.5 * N[k] / -d[k]);
        let dv = 0; for (let k = 0; k < K; k++) { N[k] += lam * d[k]; dv += Math.abs(d[k]) * v[k]; }
        if (dv < 1e-13 * mass && lam === 1) return it + 1;
      }
      return -1;
    },
    v, K, B,
  };
}

/** Solve A x = b (dense, row-major n × n; Gauss with partial pivoting; A and b overwritten). */
function mixSolve(A, b, n) {
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k * n + i]) > Math.abs(A[p * n + i])) p = k;
    if (p !== i) { for (let j = 0; j < n; j++) { const t = A[i * n + j]; A[i * n + j] = A[p * n + j]; A[p * n + j] = t; } const t = b[i]; b[i] = b[p]; b[p] = t; }
    const d = A[i * n + i]; if (d === 0) continue;
    for (let k = i + 1; k < n; k++) { const f = A[k * n + i] / d; if (!f) continue; for (let j = i; j < n; j++) A[k * n + j] -= f * A[i * n + j]; b[k] -= f * b[i]; }
  }
  const x = new Float64Array(n); for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j]; x[i] = A[i * n + i] ? s / A[i * n + i] : 0; }
  return x;
}

/** A log-normal size distribution's volume share between sizes lo and hi (median m, geometric spread sg). */
function mixLogNormalShare(lo, hi, m, sg) {
  const erf = x => { const s = Math.sign(x), t = 1 / (1 + 0.3275911 * Math.abs(x)); return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
  const cdf = x => (x <= 0 ? 0 : 0.5 * (1 + erf(Math.log(x / m) / (Math.log(sg) * Math.SQRT2))));
  return cdf(hi) - cdf(lo);
}

/**
 * The batch through the program. o: mixDefaults()'s keys (SI) plus the slurry's: phi (solids, volume share), rhoS,
 * rhoL (kg/m³), d50 (the flakes' median size, m), dMin, dMax (m), tF (a flake's thickness, m), cS (the GO's specific
 * heat), law (γ̇ -> Pa s, the Materials flow law), and steps. Returns the history and the end (see the end of it), or
 * { error }.
 */
function mixRun(o) {
  const G = mixGeom(o); if (G.err) return { error: G.err };
  if (!(o.phiL >= o.phi)) return { error: 'the cake\'s solids must be at least the slurry\'s: its water is part of the batch\'s' };
  if (!o.steps || !o.steps.length) return { error: 'the program has no steps' };
  // the charge: the card's slurry, its GO in the cake's pieces (fCake of it)
  const mGO = o.phi * o.V * o.rhoS; let mW = (1 - o.phi) * o.V * o.rhoL;
  const Q = { Q1: o.q1 * mGO, Q2: o.q2 * mGO, QSA: o.qSA * mGO, NT: 0 };
  const cN = (1 - o.wN) * MIX_MNH3 / o.wN / o.rhoL * 1000;   // (L of water per mol of NH₃ in the ammonia water)
  // the lumps' grid: v0 a flake, doubling to the largest piece
  const v0 = o.d50 * o.d50 * o.tF, aOf = v => Math.max(o.d50, Math.cbrt(6 * v / (Math.PI * o.phiL)));
  const vTop = Math.PI / 6 * o.phiL * (o.a0 * Math.pow(o.sg, 3.5)) ** 3;
  const K = Math.max(8, Math.ceil(Math.log2(vTop / v0)) + 2), v = Array.from({ length: K }, (_, k) => v0 * 2 ** k), a = v.map(aOf);
  const lump = v.map((x, k) => a[k] > o.dMax);   // (above the flakes' largest size: a lump)
  // the cake's pieces: their volume share by size class (class edges midway in size)
  const edge = k => (k <= 0 ? 0 : Math.sqrt(a[k - 1] * a[k]));
  const N = new Float64Array(K), Nh = new Float64Array(K), Vs = o.fCake * mGO / o.rhoS;
  for (let k = 1; k < K; k++) { const s = mixLogNormalShare(edge(k), k < K - 1 ? edge(k + 1) : Infinity, o.a0, o.sg); N[k] = (1 - o.fh) * Vs * s / v[k]; Nh[k] = o.fh * Vs * s / v[k]; }
  N[0] += (1 - o.fCake) * mGO / o.rhoS / v0;
  // the flakes' sizes (√2 steps; their median o.d50, the spread from the card's range: ±2 geometric deviations)
  const sgF = Math.max(1.01, Math.exp(Math.log(o.dMax / o.dMin) / 4)), J = 24, dj = Array.from({ length: J }, (_, j) => o.d50 * Math.pow(2, (j - 14) / 2));
  const F0 = dj.map((d, j) => mixLogNormalShare(j ? Math.sqrt(dj[j - 1] * d) : 0, j < J - 1 ? Math.sqrt(d * dj[j + 1]) : Infinity, o.d50, sgF));
  const dispVol = () => { let s = N[0] * v0; for (let k = 1; k < K; k++) if (!lump[k]) s += (N[k] + Nh[k]) * v[k]; return s; };
  const Gf = new Float64Array(J); { const vd = dispVol(); for (let j = 0; j < J; j++) Gf[j] = vd * F0[j]; }
  const pbe = mixPBE(v, { daughters: 'halves' }), pbeF = mixPBE(dj.map(d => d * d), { daughters: 'halves' });
  const sOf = (k, hard) => o.sig * (hard ? o.kh : 1) * Math.pow(a[k] / 1e-3, -o.beta);
  const d50Of = () => { let s = 0, tot = 0; for (const g of Gf) tot += g; if (!(tot > 0)) return o.d50; for (let j = 0; j < J; j++) { if (s + Gf[j] >= tot / 2) { const f = (tot / 2 - s) / Gf[j]; return dj[j] * Math.pow(Math.SQRT2, f - 0.5); } s += Gf[j]; } return dj[J - 1]; };
  const cSl = () => { const w = mGO / (mGO + mW); return w * o.cS + (1 - w) * MIX_CW; };
  // the viscosity now: the lumps a paste at the cake's solids, the rest the dispersed flakes in the remaining water
  const state = T => {
    const Vb = mGO / o.rhoS + mW / o.rhoL; let Vl = 0; for (let k = 1; k < K; k++) if (lump[k]) Vl += (N[k] + Nh[k]) * v[k] / o.phiL;
    const X = Math.min(1, Vl / Vb), phiR = X < 1 ? Math.max(0, (mGO / o.rhoS - Vl * o.phiL) / (Vb - Vl)) : 0;
    const fT = mixMuW(T) / mixMuW(o.Tlaw), fd = Math.pow(d50Of() / o.d50, o.md), muW = mixMuW(T);
    const fL = o.cCake * Math.pow(o.phiL / o.phi, o.mphi), fR = Math.pow(phiR / o.phi, o.mphi);
    const mu = gd => { const m0 = o.law(gd) * fT * fd; return Math.exp(X * Math.log(Math.max(m0 * fL, muW)) + (1 - X) * Math.log(Math.max(m0 * fR, muW))); };
    return { Vb, X, phiR, mu, rho: (mGO + mW) / Vb, phiNow: mGO / o.rhoS / Vb };
  };
  const grind = () => {
    // (the size above which Ns lumps are in the sample: counted from the top, spread evenly in log size over each class)
    //  -- fewer lumps than that in a sample, the size above which one is; fewer than one, the sample a piece of cake: the
    //  lumps' median size by volume)
    const Vb = mGO / o.rhoS + mW / o.rhoL;
    const above = need => { let c = 0;
      for (let k = K - 1; k >= 1; k--) { if (!lump[k]) break; const n = (N[k] + Nh[k]) / Vb, lo = Math.sqrt(a[k - 1] * a[k]), hi = k < K - 1 ? Math.sqrt(a[k] * a[k + 1]) : a[k] * Math.SQRT2;
        if (n > 0 && c + n >= need) return hi * Math.pow(lo / hi, (need - c) / n); c += n; }
      return null; };
    const r = above(o.Ns / o.Vg) ?? above(1 / o.Vg); if (r != null) return r;
    let tot = 0, s = 0; for (let k = 1; k < K; k++) if (lump[k]) tot += (N[k] + Nh[k]) * v[k];
    if (!(tot > 0)) return 0;
    for (let k = 1; k < K; k++) if (lump[k]) { s += (N[k] + Nh[k]) * v[k]; if (s >= tot / 2) return a[k]; }
    return 0;
  };
  let T = o.T0, t = 0, evap = 0, addW = 0, heatN = 0;
  const hist = { t: [], T: [], PB: [], PD: [], TqB: [], TqD: [], pH: [], zeta: [], W: [], mu27: [], grind: [], lumps: [], d50: [], phi: [], gdBulk: [], step: [] };
  const zonesAt = [], doses = [];
  const chem = () => mixSpecies(o, Q, mW / o.rhoL * 1000);
  const rec = (P, s, i) => {
    const sp = chem(), sf = mixSurface(o, sp, T, o.d50 / 2), st = state(T);
    let lv = 0, tot = 0; for (let k = 1; k < K; k++) { const x = (N[k] + Nh[k]) * v[k]; tot += x; if (lump[k]) lv += x; } tot += N[0] * v0;
    hist.t.push(t); hist.T.push(T); hist.PB.push(P.PB); hist.PD.push(P.PD); hist.TqB.push(P.TqB); hist.TqD.push(P.TqD); hist.pH.push(sp.pH);
    hist.zeta.push(sf.zeta); hist.W.push(sf.W); hist.mu27.push(st.mu(2.7)); hist.grind.push(grind()); hist.lumps.push(lv / tot); hist.d50.push(d50Of());
    hist.phi.push(st.phiNow); hist.gdBulk.push(P.gdBulk); hist.step.push(i);
  };
  const y = new Float64Array(2 * K + J), dy = new Float64Array(2 * K + J), k1 = new Float64Array(y.length), k2 = new Float64Array(y.length), k3 = new Float64Array(y.length), k4 = new Float64Array(y.length), ys = new Float64Array(y.length);
  const outN = new Float64Array(K), outH = new Float64Array(K), outF = new Float64Array(J);
  let steps = 0, hImp = 0, tRec = -Infinity;
  // (the history every 1/600 of the program at most, every step's start and end)
  const dRec = o.steps.reduce((q, s) => q + s.min * 60, 0) / 600;
  // (the flakes sticking at nearly every touch -- a charge too low to keep them apart -- flocculate the paste within a
  //  fraction of a second, into flocs beyond the grid: outside what the batch's population balance follows; said plainly)
  const flocked = (i, lmax) => { const sp = chem(), W = mixSurface(o, sp, T, o.d50 / 2).W;
    return { error: `in step ${i + 1} (${o.steps[i].name}) at pH ${sp.pH.toFixed(1)} the GO's charge does not keep its flakes apart (stability ratio ${Number.isFinite(W) ? W.toPrecision(2) : '∞'}): they flocculate within ${(1e3 / lmax).toPrecision(1)} ms, beyond what the batch model follows -- add the ammonia earlier or raise its target pH`, flocculated: { step: i, pH: sp.pH, W, t } }; };
  for (let i = 0; i < o.steps.length; i++) {
    const s = o.steps[i], No = s.No / 60, Nd = s.Nd / 60, p = s.p * 1000, dur = s.min * 60;
    // the step's ammonia, at its start
    if (s.dose && (s.dose.pH != null || s.dose.mL > 0)) {
      const before = chem(), n0 = Q.NT;
      const NT = s.dose.pH != null ? mixDoseFor(o, Q, mW / o.rhoL * 1000, s.dose.pH, cN) : n0 + s.dose.mL * 1e-6 * o.rhoN * o.wN / MIX_MNH3;
      const dn = NT - n0, mSol = dn * MIX_MNH3 / o.wN, mWadd = mSol * (1 - o.wN);
      // (mixed in at its own temperature; the ammonium it forms releases its heat)
      const c0 = cSl() * (mGO + mW); mW += mWadd; addW += mWadd; Q.NT = NT;
      const after = chem(), q = (after.NH4 - before.NH4) * o.dHN;
      T = (c0 * T + mSol * MIX_CW * o.Tadd + q) / (c0 + mSol * MIX_CW); heatN += q;
      doses.push({ step: i, mol: dn, mL: mSol / o.rhoN * 1e6, g: mSol * 1000, pH: after.pH, heat: q });
    }
    // (the batch above its boiling point under the step's pressure flashes down to it)
    const flash = () => { const Tb = mixTsat(p); if (T > Tb) { const m = cSl() * (mGO + mW), e = m * (T - Tb) / mixLatent(Tb); mW -= e; evap += e; T = Tb; } };
    flash();
    let te = 0, P = null;
    const rates = (st, Pw) => {
      const S = new Float64Array(K), Sh = new Float64Array(K), R = new Float64Array(K), Rh = new Float64Array(K);
      for (let k = 1; k < K; k++) for (const z of Pw.zones) {
        for (const [hard, Sx, Rx] of [[false, S, R], [true, Sh, Rh]]) {
          const x = z.tau / sOf(k, hard); Sx[k] += z.f * (1 - Math.exp(-Math.pow(x, o.mR)));
          if (lump[k] && a[k] > a[k - 1]) Rx[k] += z.f * o.le * x / (a[k] - a[k - 1]);
        }
      }
      const SF = new Float64Array(J); for (let j = 1; j < J; j++) for (const z of Pw.zones) SF[j] += z.f * (1 - Math.exp(-Math.pow(z.tau * dj[j] / (2 * o.tF * o.sf), o.mR)));
      const sp = chem(), W = mixSurface(o, sp, T, o.d50 / 2).W, gb = Pw.gdBulk;
      const beta = Number.isFinite(W) && gb > 0 ? (ii, jj) => (4 / 3) * gb * (a[ii] + a[jj]) ** 3 / W / st.Vb : null;
      return { soft: { S, R, beta }, hard: { S: Sh, R: Rh }, fl: { S: SF } };
    };
    const f = (yy, out, rt) => {
      const n = yy.subarray(0, K), nh = yy.subarray(K, 2 * K), g = yy.subarray(2 * K);
      let l = pbe.rhs(n, outN, rt.soft); l = Math.max(l, pbe.rhs(nh, outH, rt.hard)); pbeF.rhs(g, outF, rt.fl);
      // (the hard lumps' flakes eroded or broken off to single flakes: class 0 is the soft population's)
      outN[0] += outH[0]; outH[0] = 0;
      out.set(outN, 0); out.set(outH, K); out.set(outF, 2 * K);
      return l;
    };
    while (te < dur - 1e-9) {
      const st = state(T); P = mixPower(o, G, st.mu, st.rho, No, Nd, st.Vb);
      if (te === 0) { rec(P, st, i); tRec = t; }
      const rt = rates(st, P);
      y.set(N, 0); y.set(Nh, K); y.set(Gf, 2 * K);
      const lmax = f(y, k1, rt), slow = Math.max(pbe.rhs(Nh, outH, rt.hard), pbeF.rhs(Gf, outF, rt.fl));
      const span = Math.min(o.dtMax, dur - te);
      let dt = Math.min(span, lmax > 0 ? 0.5 / lmax : Infinity);
      const stage = (src, h, dst) => { for (let q = 0; q < y.length; q++) ys[q] = y[q] + h * src[q]; f(ys, dst, rt); };
      if (dt >= span / 20) {
        // RK4 on the populations
        stage(k1, dt / 2, k2); stage(k2, dt / 2, k3); stage(k3, dt, k4);
        for (let q = 0; q < y.length; q++) y[q] = Math.max(0, y[q] + dt / 6 * (k1[q] + 2 * k2[q] + 2 * k3[q] + k4[q]));
        N.set(y.subarray(0, K)); Nh.set(y.subarray(K, 2 * K)); Gf.set(y.subarray(2 * K));
      } else {
        if (lmax > 1e7) return flocked(i, lmax);
        // collisions far faster than the step (the flakes flocculating): the hard lumps and the flakes' sizes by RK4 at their
        //  own pace, the soft population by backward Euler, the singles the hard lumps let go a source over the step
        dt = Math.min(span, slow > 0 ? 0.5 / slow : Infinity);
        const sub = (arr, P, r, h) => { const n = arr.length, a1 = new Float64Array(n), a2 = new Float64Array(n), a3 = new Float64Array(n), a4 = new Float64Array(n), w = new Float64Array(n);
          P.rhs(arr, a1, r); for (let q = 0; q < n; q++) w[q] = arr[q] + h / 2 * a1[q]; P.rhs(w, a2, r); for (let q = 0; q < n; q++) w[q] = arr[q] + h / 2 * a2[q]; P.rhs(w, a3, r);
          for (let q = 0; q < n; q++) w[q] = arr[q] + h * a3[q]; P.rhs(w, a4, r); for (let q = 0; q < n; q++) arr[q] = Math.max(0, arr[q] + h / 6 * (a1[q] + 2 * a2[q] + 2 * a3[q] + a4[q])); };
        sub(Nh, pbe, rt.hard, dt); sub(Gf, pbeF, rt.fl, dt);
        // (what the hard lumps let go over the step, gathered in their class 0, comes in as singles at an even rate)
        const src = new Float64Array(K); src[0] = Nh[0] / dt; Nh[0] = 0;
        // (backward Euler in steps that start at the collisions' own time and grow as they settle; a step that fails is
        //  retried at a quarter)
        //  -- the step size kept from one time step to the next)
        let tau = 0, tries = 0; const keep = new Float64Array(K);
        if (!(hImp > 0)) hImp = 2 / lmax;
        while (tau < dt * (1 - 1e-12)) {
          const h = Math.min(hImp, dt - tau); keep.set(N);
          if (pbe.implicit(N, h, rt.soft, src) < 0) { N.set(keep); hImp = h / 4; if (++tries > 8 || hImp < 1e-6) return flocked(i, lmax); continue; }
          for (let k = 0; k < K; k++) if (N[k] < 0) N[k] = 0;
          tau += h; hImp = Math.min(2 * h, o.dtMax); tries = 0;
        }
      }
      // (the dispersed flakes' sizes: what the lumps let go comes in at the cake's sizes; what they take back, from all)
      { let tot = 0; for (const x of Gf) tot += x; const vd = dispVol(), dv = vd - tot;
        if (dv > 0) for (let j = 0; j < J; j++) Gf[j] += dv * F0[j]; else if (tot > 0) for (let j = 0; j < J; j++) Gf[j] *= vd / tot; }
      // heat: the power held over the step (it changes slowly against the populations), the jacket's exponential approach
      //  exact; then the boiling cap
      const Ptot = P.PB + P.PD, mc = cSl() * (mGO + mW);
      if (o.UA > 0) { const Te = o.Tj + Ptot / o.UA; T = Te + (T - Te) * Math.exp(-o.UA * dt / mc); } else T += Ptot * dt / mc;
      flash();
      te += dt; t += dt; steps++;
      if (steps > 2e6) return { error: 'too many time steps' };
      if (t - tRec >= dRec && te < dur - 1e-9) { const sr = state(T); rec(mixPower(o, G, sr.mu, sr.rho, No, Nd, sr.Vb), sr, i); tRec = t; }
    }
    const st = state(T); P = mixPower(o, G, st.mu, st.rho, No, Nd, st.Vb);
    zonesAt.push(P.zones.map(z => ({ ...z })));
    rec(P, st, i); tRec = t;
  }
  // the end
  const st = state(T), sp = chem(), sf = mixSurface(o, sp, T, o.d50 / 2), T20 = o.Tlaw;
  const muAt = gd => st.mu(gd) * mixMuW(T20) / mixMuW(T);   // (at the flow law's temperature, as a rheometer would)
  const dist = { a: Array.from(a), vol: Array.from(v, (x, k) => (N[k] + Nh[k]) * x), lump: lump.slice() };
  const flakes = { d: dj, vol: Array.from(Gf) };
  let lv = 0, tot = 0; for (let k = 0; k < K; k++) { const x = (N[k] + Nh[k]) * v[k]; tot += x; if (lump[k]) lv += x; }
  const end = { t, T, pH: sp.pH, zeta: sf.zeta, sigma: sf.sigma, debye: sf.debye, W: sf.W, I: sp.I, grind: grind(), lumps: lv / tot, d50: d50Of(),
    mu27: muAt(2.7), mu27T: st.mu(2.7), phi: st.phiNow, rho: st.rho, evap, addW, heatN, mGO, mW, goVol: tot, goVol0: mGO / o.rhoS, steps };
  return { G, hist, end, doses, zones: zonesAt, dist, flakes, muAt, NT: Q.NT };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MIX_INPUTS, MIX_STEPS, mixDefaults, mixInDefaults, mixInSI, mixCellDrag, mixGeom, mixPower, mixSpecies, mixDoseFor, mixSurface, mixPBE, mixLogNormalShare, mixRun };
